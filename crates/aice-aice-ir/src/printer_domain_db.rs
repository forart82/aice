use crate::ir_domain_db::{DbSchemaDecl, GraphQlField};
use crate::printer::PrintCtx;
use crate::printer_compact::{
    compact_sql_ws, compress_sql_constraint, fmt_db_segment, fmt_db_type, fmt_db_word,
    is_clean_db_expr_tail, is_clean_db_word,
};
pub(crate) use crate::printer_domain_db_q::{print_db_migration, print_db_query};
use crate::printer_expr::escape_str;

pub(crate) fn emit_raw_lines(c: &mut PrintCtx<'_>, d: usize, text: &str) {
    for line in text.split('\n') {
        if line.is_empty() { c.line(d, "|"); } else { c.line(d, &format!("| {line}")); }
    }
}

fn fmt_proc_param(p: &str) -> String {
    let clean = !p.is_empty()
        && !p.contains('\n') && !p.contains('\r') && !p.contains(',')
        && !p.contains('(') && !p.contains(')') && !p.contains('"')
        && !p.contains('\'') && !p.contains('`') && !p.contains('\\')
        && !crate::printer_compact::has_comment_hazard(p)
        && p.bytes().all(|b| b.is_ascii_graphic() || b == b' ');
    if clean { p.to_string() } else { format!("\"{}\"", escape_str(p)) }
}

fn can_inline_gql_type(fields: &[GraphQlField], implements: &[String], directives: &[String]) -> bool {
    implements.is_empty()
        && directives.is_empty()
        && !fields.is_empty()
        && fields.len() <= 8
        && fields.iter().all(|f| {
            f.args.is_empty()
                && f.directives.is_empty()
                && f.children.is_empty()
                && f.trivia.is_empty()
                && is_clean_db_word(&f.name)
                && (f.field_type.is_empty() || (is_clean_db_expr_tail(&f.field_type) && !f.field_type.contains(',')))
        })
}

pub(crate) fn print_db_schema(c: &mut PrintCtx<'_>, ds: &DbSchemaDecl, d: usize) {
    match ds {
        DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia } => {
            c.emit_trivia(trivia, d);
            let ine = if *if_not_exists { "if_not_exists " } else { "" };
            c.line_tr(d, &format!("table {ine}\"{}\":", escape_str(name)), trivia);
            for col in columns {
                c.emit_trivia(&col.trivia, d + 1);
                let cname = fmt_db_word(&col.name);
                let need_kw = !is_clean_db_word(&col.name)
                    || matches!(col.name.as_str(), "col" | "constraint" | "option" | "con" | "opt");
                let pfx = if need_kw { "col " } else { "" };
                let stype = fmt_db_type(&col.sql_type);
                let sep = if need_kw || !c.opts.compact { ": " } else { " " };
                let mut line = format!("{pfx}{cname}{sep}{stype}");
                let all_clean_c = !col.constraints.is_empty()
                    && !stype.starts_with('"')
                    && col.constraints.iter().all(|cc| is_clean_db_expr_tail(cc));
                if all_clean_c {
                    for cc in &col.constraints {
                        let c2 = if c.opts.compact { compress_sql_constraint(cc) } else { cc.clone() };
                        line.push(' ');
                        line.push_str(&c2);
                    }
                    if let Some(ref def) = col.default {
                        let d2 = if c.opts.compact { compress_sql_constraint(def) } else { def.clone() };
                        let s = if is_clean_db_expr_tail(&d2) { d2 } else { format!("\"{}\"", escape_str(&d2)) };
                        line.push_str(&format!(" | = {s}"));
                    }
                } else {
                    for cc in &col.constraints {
                        let c2 = if c.opts.compact { compress_sql_constraint(cc) } else { cc.clone() };
                        let s = if is_clean_db_expr_tail(&c2) { c2 } else { format!("\"{}\"", escape_str(&c2)) };
                        line.push_str(&format!(" | {s}"));
                    }
                    if let Some(ref def) = col.default {
                        let d2 = if c.opts.compact { compress_sql_constraint(def) } else { def.clone() };
                        let s = if is_clean_db_expr_tail(&d2) { d2 } else { format!("\"{}\"", escape_str(&d2)) };
                        line.push_str(&format!(" | = {s}"));
                    }
                }
                c.line_tr(d + 1, &line, &col.trivia);
            }
            for con in constraints {
                if !con.contains('\n') { c.line(d + 1, &format!("con| {con}")); }
                else { c.line(d + 1, &format!("constraint: \"{}\"", escape_str(con))); }
            }
            for opt in options {
                if !opt.contains('\n') { c.line(d + 1, &format!("opt| {opt}")); }
                else { c.line(d + 1, &format!("option: \"{}\"", escape_str(opt))); }
            }
        }
        DbSchemaDecl::View { name, materialized, query_sql, trivia } => {
            c.emit_trivia(trivia, d);
            let mat = if *materialized { "materialized " } else { "" };
            if trivia.trailing.is_none() && query_sql.contains('\n') && !query_sql.contains("\"\"\"") {
                c.line(d, &format!("view {mat}{}: \"\"\"\n{query_sql}\n\"\"\"", fmt_db_word(name)));
            } else {
                c.line_tr(d, &format!("view {mat}{}:", fmt_db_word(name)), trivia);
                emit_raw_lines(c, d + 1, query_sql);
            }
        }
        DbSchemaDecl::Index { name, unique, table, cols, trivia } => {
            c.emit_trivia(trivia, d);
            let uq = if *unique { "unique " } else { "" };
            let cs: Vec<String> = cols.iter().map(|x| fmt_db_segment(x)).collect();
            c.line_tr(d, &format!("index {uq}{} on {}: {}", fmt_db_word(name), fmt_db_word(table), cs.join(", ")), trivia);
        }
        DbSchemaDecl::Procedure { dialect, is_fn, name, params, returns, lang_tag, declares, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            let fkw = if *is_fn { "fn " } else { "" };
            let ps: Vec<String> = params.iter().map(|p| fmt_proc_param(p)).collect();
            let ret = returns.as_ref().map(|r| format!(" -> {}", fmt_db_segment(r))).unwrap_or_default();
            let lt = lang_tag.as_ref().map(|l| format!(" [{}]", fmt_db_word(l))).unwrap_or_default();
            let hdr = format!("proc \"{}\" {fkw}\"{}\"({}){ret}{lt}:", dialect.canonical_name(), escape_str(name), ps.join(", "));
            let raw_body = body_lines.join("\n");
            let compact_body = if c.opts.compact { compact_sql_ws(&raw_body) } else { raw_body };
            if declares.is_empty() && trivia.trailing.is_none() && !compact_body.is_empty() {
                if !compact_body.contains('\n') {
                    c.line(d, &format!("{hdr}| {compact_body}"));
                    return;
                }
                if !compact_body.contains("\"\"\"") {
                    c.line(d, &format!("{hdr} \"\"\"\n{compact_body}\n\"\"\""));
                    return;
                }
            }
            c.line_tr(d, &hdr, trivia);
            for dec in declares {
                if !dec.contains('\n') { c.line(d + 1, &format!("dec| {dec}")); }
                else { c.line(d + 1, &format!("declare: \"{}\"", escape_str(dec))); }
            }
            for bl in body_lines { emit_raw_lines(c, d + 1, bl); }
        }
        DbSchemaDecl::Trigger { name, timing, events, table, for_each, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            let evs = events.join(", ");
            c.line_tr(d, &format!("trig {} {} {} {}:", fmt_db_word(name), fmt_db_word(timing), fmt_db_word(&evs), fmt_db_word(table)), trivia);
            if let Some(fe) = for_each { c.line(d + 1, &format!("for_each: {}", fmt_db_segment(fe))); }
            for bl in body_lines { emit_raw_lines(c, d + 1, bl); }
        }
        DbSchemaDecl::TypeDef { name, is_enum, members, trivia } => {
            c.emit_trivia(trivia, d);
            let ek = if *is_enum { "enum " } else { "" };
            c.line_tr(d, &format!("dbtype {ek}{}:", fmt_db_word(name)), trivia);
            for m in members { c.line(d + 1, &fmt_db_segment(m)); }
        }
        DbSchemaDecl::PrismaBlock { kind, name, fields, attrs, trivia } => {
            c.emit_trivia(trivia, d);
            let kw = if kind == "enum" { "prisma_enum" } else { kind.as_str() };
            let is_ds = kind == "datasource" || kind == "generator";
            c.line_tr(d, &format!("{kw} \"{}\":", escape_str(name)), trivia);
            for f in fields {
                c.emit_trivia(&f.trivia, d + 1);
                if f.field_type.is_empty() && f.attrs.is_empty() {
                    c.line_tr(d + 1, &fmt_db_word(&f.name), &f.trivia);
                    continue;
                }
                let fname = fmt_db_word(&f.name);
                let pfx = if matches!(f.name.as_str(), "attr" | "field" | "con") || !is_clean_db_word(&f.name) { "field " } else { "" };
                let fty = if is_clean_db_expr_tail(&f.field_type) { f.field_type.clone() } else { format!("\"{}\"", escape_str(&f.field_type)) };
                let sep = if is_ds || !pfx.is_empty() { ": " } else { " " };
                let mut l = format!("{pfx}{fname}{sep}{fty}");
                for a in &f.attrs {
                    let as_ = if is_clean_db_expr_tail(a) { a.clone() } else { format!("\"{}\"", escape_str(a)) };
                    if a.starts_with('@') && is_clean_db_expr_tail(a) { l.push(' '); l.push_str(&as_); }
                    else { l.push_str(&format!(" | {as_}")); }
                }
                c.line_tr(d + 1, &l, &f.trivia);
            }
            for a in attrs {
                if !a.contains('\n') { c.line(d + 1, &format!("con| {a}")); }
                else { c.line(d + 1, &format!("attr: \"{}\"", escape_str(a))); }
            }
        }
        DbSchemaDecl::GraphQlType { kind, name, implements, directives, fields, trivia } => {
            c.emit_trivia(trivia, d);
            let hdr = format!("gql \"{}\" \"{}\":", escape_str(kind), escape_str(name));
            if c.opts.compact && trivia.trailing.is_none() && can_inline_gql_type(fields, implements, directives) {
                let parts: Vec<String> = fields.iter().map(|f| {
                    if f.field_type.is_empty() { f.name.clone() } else { format!("{}:{}", f.name, f.field_type) }
                }).collect();
                c.line_tr(d, &format!("{hdr} {}", parts.join(", ")), trivia);
                return;
            }
            c.line_tr(d, &hdr, trivia);
            if !implements.is_empty() {
                let imps: Vec<String> = implements.iter().map(|i| fmt_db_word(i)).collect();
                c.line(d + 1, &format!("implements: {}", imps.join(", ")));
            }
            for dir in directives { c.line(d + 1, &format!("directive: {}", fmt_db_segment(dir))); }
            for f in fields { print_gql_field(c, f, d + 1); }
        }
        DbSchemaDecl::RawDdl { text, trivia } => {
            c.emit_trivia(trivia, d);
            let body = if c.opts.compact { compact_sql_ws(text) } else { text.clone() };
            if trivia.trailing.is_none() && !body.contains('\n') {
                c.line(d, &format!("ddl| {body}"));
            } else if trivia.trailing.is_none() && body.contains('\n') && !body.contains("\"\"\"") {
                c.line(d, &format!("ddl \"\"\"\n{body}\n\"\"\""));
            } else {
                c.line_tr(d, &format!("ddl: \"{}\"", escape_str(text)), trivia);
            }
        }
    }
}

fn print_gql_field(c: &mut PrintCtx<'_>, root: &GraphQlField, init_d: usize) {
    let mut stack = vec![(root, init_d)];
    while let Some((f, d)) = stack.pop() {
        c.emit_trivia(&f.trivia, d);
        if f.field_type.is_empty() && f.args.is_empty() && f.directives.is_empty() && f.children.is_empty() {
            c.line_tr(d, &fmt_db_word(&f.name), &f.trivia);
            continue;
        }
        let args = if f.args.is_empty() { String::new() } else {
            let ps: Vec<String> = f.args.iter().map(|a| {
                if is_clean_db_expr_tail(a) && !a.contains(',') { a.clone() } else { format!("\"{}\"", escape_str(a)) }
            }).collect();
            format!("({})", ps.join(", "))
        };
        let pfx = if matches!(f.name.as_str(), "implements" | "directive" | "field") || !is_clean_db_word(&f.name) { "field " } else { "" };
        let mut l = if f.field_type.is_empty() {
            format!("{pfx}{}{args}", fmt_db_word(&f.name))
        } else {
            let fty = if is_clean_db_expr_tail(&f.field_type) { f.field_type.clone() } else { format!("\"{}\"", escape_str(&f.field_type)) };
            format!("{pfx}{}{args}{}{fty}", fmt_db_word(&f.name), c.colon_sep())
        };
        for dir in &f.directives { l.push_str(&format!(" | {}", fmt_db_segment(dir))); }
        c.line_tr(d, &l, &f.trivia);
        for ch in f.children.iter().rev() { stack.push((ch, d + 1)); }
    }
}
