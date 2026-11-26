use crate::ir_domain_db::{DbMigrationDecl, DbQueryDecl, DbQueryKind};
use crate::printer::{PrintCtx, print_item};
use crate::printer_compact::{compact_sql_ws, fmt_db_word, is_clean_db_word};
use crate::printer_domain_db::emit_raw_lines;
use crate::printer_expr::escape_str;

fn strip_cypher_prefix<'a>(k: &str, v: &'a str) -> Option<&'a str> {
    if !matches!(k, "MATCH" | "RETURN" | "MERGE" | "WITH" | "CREATE" | "DELETE" | "SET" | "UNWIND") { return None; }
    let head = v.get(..k.len())?;
    if !head.eq_ignore_ascii_case(k) { return None; }
    let rest = &v[k.len()..];
    if let Some(after) = rest.strip_prefix(' ') { Some(after) } else if rest.starts_with('\n') { Some(rest) } else { None }
}

pub(crate) fn print_db_query(c: &mut PrintCtx<'_>, dq: &DbQueryDecl, d: usize) {
    c.emit_trivia(&dq.trivia, d);
    if dq.kind == DbQueryKind::Pragma && dq.name.is_none() && dq.ctes.is_empty()
        && dq.clauses.len() == 1 && dq.trivia.trailing.is_none() && !dq.clauses[0].1.contains('\n')
    {
        let raw = dq.clauses[0].1.trim();
        let body = raw.get(..7).filter(|p| p.eq_ignore_ascii_case("PRAGMA ")).map(|_| raw[7..].trim()).unwrap_or(raw);
        c.line(d, &format!("pragma| {body}"));
        return;
    }
    if matches!(
        dq.kind,
        DbQueryKind::Insert | DbQueryKind::Update | DbQueryKind::Delete | DbQueryKind::DoBlock | DbQueryKind::Exec
    ) && dq.name.is_none()
        && dq.ctes.is_empty()
        && dq.clauses.len() == 1
        && dq.clauses[0].0 == "sql"
        && dq.trivia.trailing.is_none()
    {
        let body = if c.opts.compact { compact_sql_ws(&dq.clauses[0].1) } else { dq.clauses[0].1.clone() };
        if !body.contains('\n') {
            c.line(d, &format!("sql:| {body}"));
            return;
        }
        if !body.contains("\"\"\"") {
            c.line(d, &format!("sql: \"\"\"\n{body}\n\"\"\""));
            return;
        }
    }
    let kind_s = match dq.kind {
        DbQueryKind::Select => "select", DbQueryKind::Insert => "insert", DbQueryKind::Update => "update",
        DbQueryKind::Delete => "delete", DbQueryKind::Pragma => "pragma", DbQueryKind::DoBlock => "do",
        DbQueryKind::Exec => "exec", DbQueryKind::GraphQlOp => "gql", DbQueryKind::Cypher => "cypher",
    };
    let nm = dq.name.as_ref().map(|n| format!(" \"{}\"", escape_str(n))).unwrap_or_default();
    let hdr = if dq.kind == DbQueryKind::Cypher && dq.name.is_none() {
        "cypher:".to_string()
    } else {
        format!("query \"{}\" \"{kind_s}\"{nm}:", dq.dialect.canonical_name())
    };
    if dq.ctes.is_empty() && dq.clauses.len() == 1 && dq.kind != DbQueryKind::Cypher
        && matches!(dq.clauses[0].0.as_str(), "sql" | "query" | "mutation" | "subscription")
    {
        let body = if c.opts.compact { compact_sql_ws(&dq.clauses[0].1) } else { dq.clauses[0].1.clone() };
        if dq.trivia.trailing.is_none() && !body.contains('\n') {
            c.line(d, &format!("{hdr}| {body}"));
            return;
        }
        if dq.trivia.trailing.is_none() && body.contains('\n') && !body.contains("\"\"\"") {
            c.line(d, &format!("{hdr} \"\"\"\n{body}\n\"\"\""));
            return;
        }
        c.line_tr(d, &hdr, &dq.trivia);
        emit_raw_lines(c, d + 1, &body);
        return;
    }
    c.line_tr(d, &hdr, &dq.trivia);
    for (k, v) in &dq.ctes {
        let mut lines = v.split('\n');
        c.line(d + 1, &format!("with \"{}\"| {}", escape_str(k), lines.next().unwrap_or("")));
        for rest in lines { c.line(d + 1, &format!("| {rest}")); }
    }
    for (k, v) in &dq.clauses {
        let raw_body = if dq.kind == DbQueryKind::Cypher { strip_cypher_prefix(k, v).unwrap_or(v.as_str()) } else { v.as_str() };
        let body = if dq.kind == DbQueryKind::Cypher && c.opts.compact { compact_sql_ws(raw_body) } else { raw_body.to_string() };
        if dq.kind == DbQueryKind::Cypher && k != "MATCH" && is_clean_db_word(k) && !body.contains('\n') {
            c.line(d + 1, &format!("{k}:| {body}"));
        } else if !body.contains('\n') {
            c.line(d + 1, &format!("clause \"{}\":| {body}", escape_str(k)));
        } else if !body.contains("\"\"\"") {
            c.line(d + 1, &format!("clause \"{}\": \"\"\"\n{body}\n\"\"\"", escape_str(k)));
        } else {
            let mut lines = body.split('\n');
            c.line(d + 1, &format!("clause \"{}\"| {}", escape_str(k), lines.next().unwrap_or("")));
            for rest in lines { c.line(d + 1, &format!("| {rest}")); }
        }
    }
}

pub(crate) fn print_db_migration(c: &mut PrintCtx<'_>, root: &DbMigrationDecl, init_d: usize) {
    enum Task<'a> { Mig(&'a DbMigrationDecl, usize), Sec(&'a str, &'a [crate::ir::AiceItem], usize), Item(&'a crate::ir::AiceItem, usize) }
    let mut stack = vec![Task::Mig(root, init_d)];
    while let Some(t) = stack.pop() {
        match t {
            Task::Mig(dm, d) => {
                c.emit_trivia(&dm.trivia, d);
                c.line_tr(d, &format!("migration \"{}\":", escape_str(&dm.tool)), &dm.trivia);
                for (sname, items) in dm.sections.iter().rev() { stack.push(Task::Sec(sname, items, d + 1)); }
            }
            Task::Sec(sname, items, d) => {
                c.line(d, &format!("section {}:", fmt_db_word(sname)));
                for it in items.iter().rev() { stack.push(Task::Item(it, d + 1)); }
            }
            Task::Item(it, d) => {
                if let crate::ir::AiceItem::DbMigration(dm) = it { stack.push(Task::Mig(dm, d)); }
                else { print_item(c, it, d); }
            }
        }
    }
}
