use crate::ir_domain_db::{DbMigrationDecl, DbQueryDecl, DbQueryKind, DbSchemaDecl, GraphQlField};
use crate::printer::{PrintCtx, print_item};
use crate::printer_expr::escape_str;

pub(crate) fn print_db_schema(c: &mut PrintCtx<'_>, ds: &DbSchemaDecl, d: usize) {
    match ds {
        DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia } => {
            c.emit_trivia(trivia, d);
            let ine = if *if_not_exists { "if_not_exists " } else { "" };
            c.line_tr(d, &format!("table {ine}\"{}\":", escape_str(name)), trivia);
            for col in columns {
                c.emit_trivia(&col.trivia, d + 1);
                let mut line = format!("col \"{}\": \"{}\"", escape_str(&col.name), escape_str(&col.sql_type));
                for cc in &col.constraints {
                    line.push_str(&format!(" | \"{}\"", escape_str(cc)));
                }
                if let Some(ref def) = col.default {
                    line.push_str(&format!(" | = \"{}\"", escape_str(def)));
                }
                c.line_tr(d + 1, &line, &col.trivia);
            }
            for con in constraints { c.line(d + 1, &format!("constraint: \"{}\"", escape_str(con))); }
            for opt in options { c.line(d + 1, &format!("option: \"{}\"", escape_str(opt))); }
        }
        DbSchemaDecl::View { name, materialized, query_sql, trivia } => {
            c.emit_trivia(trivia, d);
            let mat = if *materialized { "materialized " } else { "" };
            c.line_tr(d, &format!("view {mat}\"{}\": \"{}\"", escape_str(name), escape_str(query_sql)), trivia);
        }
        DbSchemaDecl::Index { name, unique, table, cols, trivia } => {
            c.emit_trivia(trivia, d);
            let uq = if *unique { "unique " } else { "" };
            let cs: Vec<String> = cols.iter().map(|x| format!("\"{}\"", escape_str(x))).collect();
            c.line_tr(d, &format!("index {uq}\"{}\" on \"{}\": {}", escape_str(name), escape_str(table), cs.join(", ")), trivia);
        }
        DbSchemaDecl::Procedure { dialect, is_fn, name, params, returns, lang_tag, declares, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            let fkw = if *is_fn { "fn " } else { "" };
            let ps: Vec<String> = params.iter().map(|p| format!("\"{}\"", escape_str(p))).collect();
            let ret = returns.as_ref().map(|r| format!(" -> \"{}\"", escape_str(r))).unwrap_or_default();
            let lt = lang_tag.as_ref().map(|l| format!(" [\"{}\"]", escape_str(l))).unwrap_or_default();
            c.line_tr(d, &format!("proc \"{}\" {fkw}\"{}\"({}){ret}{lt}:", dialect.canonical_name(), escape_str(name), ps.join(", ")), trivia);
            for dec in declares { c.line(d + 1, &format!("declare: \"{}\"", escape_str(dec))); }
            for bl in body_lines { c.line(d + 1, &format!("body: \"{}\"", escape_str(bl))); }
        }
        DbSchemaDecl::Trigger { name, timing, events, table, for_each, body_lines, trivia } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("trig \"{}\" \"{}\" \"{}\" \"{}\":", escape_str(name), escape_str(timing), escape_str(&events.join(", ")), escape_str(table)), trivia);
            if let Some(fe) = for_each { c.line(d + 1, &format!("for_each: \"{}\"", escape_str(fe))); }
            for bl in body_lines { c.line(d + 1, &format!("body: \"{}\"", escape_str(bl))); }
        }
        DbSchemaDecl::TypeDef { name, is_enum, members, trivia } => {
            c.emit_trivia(trivia, d);
            let ek = if *is_enum { "enum " } else { "" };
            c.line_tr(d, &format!("dbtype {ek}\"{}\":", escape_str(name)), trivia);
            for m in members { c.line(d + 1, &format!("\"{}\"", escape_str(m))); }
        }
        DbSchemaDecl::PrismaBlock { kind, name, fields, attrs, trivia } => {
            c.emit_trivia(trivia, d);
            let kw = if kind == "enum" { "prisma_enum" } else { kind.as_str() };
            c.line_tr(d, &format!("{kw} \"{}\":", escape_str(name)), trivia);
            for f in fields {
                c.emit_trivia(&f.trivia, d + 1);
                let mut l = format!("field \"{}\": \"{}\"", escape_str(&f.name), escape_str(&f.field_type));
                for a in &f.attrs { l.push_str(&format!(" | \"{}\"", escape_str(a))); }
                c.line_tr(d + 1, &l, &f.trivia);
            }
            for a in attrs { c.line(d + 1, &format!("attr: \"{}\"", escape_str(a))); }
        }
        DbSchemaDecl::GraphQlType { kind, name, implements, directives, fields, trivia } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("gql \"{}\" \"{}\":", escape_str(kind), escape_str(name)), trivia);
            if !implements.is_empty() {
                let imps: Vec<String> = implements.iter().map(|i| format!("\"{}\"", escape_str(i))).collect();
                c.line(d + 1, &format!("implements: {}", imps.join(", ")));
            }
            for dir in directives { c.line(d + 1, &format!("directive: \"{}\"", escape_str(dir))); }
            for f in fields { print_gql_field(c, f, d + 1); }
        }
        DbSchemaDecl::RawDdl { text, trivia } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("ddl: \"{}\"", escape_str(text)), trivia);
        }
    }
}

fn print_gql_field(c: &mut PrintCtx<'_>, root: &GraphQlField, init_d: usize) {
    let mut stack = vec![(root, init_d)];
    while let Some((f, d)) = stack.pop() {
        c.emit_trivia(&f.trivia, d);
        let args = if f.args.is_empty() {
            String::new()
        } else {
            let ps: Vec<String> = f.args.iter().map(|a| format!("\"{}\"", escape_str(a))).collect();
            format!("({})", ps.join(", "))
        };
        let mut l = format!("field \"{}\"{args}: \"{}\"", escape_str(&f.name), escape_str(&f.field_type));
        for dir in &f.directives { l.push_str(&format!(" | \"{}\"", escape_str(dir))); }
        c.line_tr(d, &l, &f.trivia);
        for ch in f.children.iter().rev() { stack.push((ch, d + 1)); }
    }
}

pub(crate) fn print_db_query(c: &mut PrintCtx<'_>, dq: &DbQueryDecl, d: usize) {
    c.emit_trivia(&dq.trivia, d);
    let kind_s = match dq.kind {
        DbQueryKind::Select => "select", DbQueryKind::Insert => "insert",
        DbQueryKind::Update => "update", DbQueryKind::Delete => "delete",
        DbQueryKind::Pragma => "pragma", DbQueryKind::DoBlock => "do",
        DbQueryKind::Exec => "exec", DbQueryKind::GraphQlOp => "gql",
        DbQueryKind::Cypher => "cypher",
    };
    let nm = dq.name.as_ref().map(|n| format!(" \"{}\"", escape_str(n))).unwrap_or_default();
    if dq.kind == DbQueryKind::Cypher && dq.name.is_none() {
        c.line_tr(d, "cypher:", &dq.trivia);
    } else {
        c.line_tr(d, &format!("query \"{}\" \"{kind_s}\"{nm}:", dq.dialect.canonical_name()), &dq.trivia);
    }
    for (k, v) in &dq.ctes { c.line(d + 1, &format!("with \"{}\": \"{}\"", escape_str(k), escape_str(v))); }
    for (k, v) in &dq.clauses { c.line(d + 1, &format!("clause \"{}\": \"{}\"", escape_str(k), escape_str(v))); }
}

pub(crate) fn print_db_migration(c: &mut PrintCtx<'_>, root: &DbMigrationDecl, init_d: usize) {
    enum Task<'a> {
        Mig(&'a DbMigrationDecl, usize),
        Sec(&'a str, &'a [crate::ir::AiceItem], usize),
        Item(&'a crate::ir::AiceItem, usize),
    }
    let mut stack = vec![Task::Mig(root, init_d)];
    while let Some(t) = stack.pop() {
        match t {
            Task::Mig(dm, d) => {
                c.emit_trivia(&dm.trivia, d);
                c.line_tr(d, &format!("migration \"{}\":", escape_str(&dm.tool)), &dm.trivia);
                for (sname, items) in dm.sections.iter().rev() {
                    stack.push(Task::Sec(sname, items, d + 1));
                }
            }
            Task::Sec(sname, items, d) => {
                c.line(d, &format!("section \"{}\":", escape_str(sname)));
                for it in items.iter().rev() { stack.push(Task::Item(it, d + 1)); }
            }
            Task::Item(it, d) => {
                if let crate::ir::AiceItem::DbMigration(dm) = it {
                    stack.push(Task::Mig(dm, d));
                } else {
                    print_item(c, it, d);
                }
            }
        }
    }
}
