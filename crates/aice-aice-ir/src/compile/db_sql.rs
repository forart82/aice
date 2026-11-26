use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_domain_db::{DbQueryDecl, DbSchemaDecl};

pub(crate) fn compile_sql_or_migration(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::SqlDash);
    emit_items(&module.items, target, &mut ec);
    Ok(ec.out)
}

fn emit_items(roots: &[AiceItem], root_target: LanguageId, ec: &mut EmitCtx) {
    enum SqlTask<'a> {
        Item(&'a AiceItem, LanguageId),
        Line(String),
        Blank,
    }
    let mut tasks: Vec<SqlTask<'_>> = roots.iter().rev().map(|it| SqlTask::Item(it, root_target)).collect();
    while let Some(t) = tasks.pop() {
        match t {
            SqlTask::Line(s) => ec.line(&s),
            SqlTask::Blank => ec.blank(),
            SqlTask::Item(it, target) => match it {
                AiceItem::DbMigration(dm) => {
                    ec.emit_trivia(&dm.trivia, CommentStyle::SqlDash);
                    for (sname, items) in dm.sections.iter().rev() {
                        let marker = match dm.tool.as_str() {
                            "goose" => format!("-- +goose {sname}"),
                            "migrate" => format!("-- +migrate {sname}"),
                            "dbmate" => format!("-- migrate:{}", sname.to_ascii_lowercase()),
                            _ => format!("-- {sname}"),
                        };
                        tasks.push(SqlTask::Blank);
                        for sub in items.iter().rev() { tasks.push(SqlTask::Item(sub, LanguageId::AnsiSql)); }
                        tasks.push(SqlTask::Line(marker));
                    }
                }
                AiceItem::DbSchema(ds) => emit_db_schema(ds, target, ec),
                AiceItem::DbQuery(dq) => emit_db_query(dq, ec),
                _ => {}
            },
        }
    }
}

fn emit_db_schema(ds: &DbSchemaDecl, target: LanguageId, ec: &mut EmitCtx) {
    match ds {
        DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::SqlDash);
            let ine = if *if_not_exists { "IF NOT EXISTS " } else { "" };
            ec.line(&format!("CREATE TABLE {ine}{name} ("));
            ec.push();
            let mut defs: Vec<String> = columns.iter().map(|c| {
                let mut s = format!("{} {}", c.name, c.sql_type);
                for cc in &c.constraints { s.push(' '); s.push_str(cc); }
                if let Some(ref d) = c.default { s.push_str(&format!(" DEFAULT {d}")); }
                s
            }).collect();
            defs.extend(constraints.iter().cloned());
            for (i, d) in defs.iter().enumerate() {
                let comma = if i + 1 < defs.len() { "," } else { "" };
                ec.line(&format!("{d}{comma}"));
            }
            ec.pop();
            let opts_s = if options.is_empty() { String::new() } else { format!(" {}", options.join(" ")) };
            ec.line(&format!("){opts_s};"));
        }
        DbSchemaDecl::View { name, materialized, query_sql, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::SqlDash);
            let mat = if *materialized { "MATERIALIZED " } else { "" };
            ec.line(&format!("CREATE {mat}VIEW {name} AS {query_sql};"));
        }
        DbSchemaDecl::Index { name, unique, table, cols, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::SqlDash);
            let uq = if *unique { "UNIQUE " } else { "" };
            ec.line(&format!("CREATE {uq}INDEX {name} ON {table} ({});", cols.join(", ")));
        }
        DbSchemaDecl::Procedure { dialect, body_lines, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::SqlDash);
            let body = body_lines.join("\n");
            let eff = if *dialect == LanguageId::AnsiSql { target } else { *dialect };
            if eff == LanguageId::MySql && !body.to_ascii_uppercase().contains("DELIMITER") {
                ec.line("DELIMITER //");
                ec.line(&format!("{} //", body.trim_end_matches(';')));
                ec.line("DELIMITER ;");
            } else if eff == LanguageId::TSql {
                ec.line(body.trim());
                if !body.trim_end().to_ascii_uppercase().ends_with("GO") { ec.line("GO"); }
            } else {
                let s = body.trim();
                if s.ends_with(';') { ec.line(s); } else { ec.line(&format!("{s};")); }
            }
        }
        DbSchemaDecl::RawDdl { text, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::SqlDash);
            let s = text.trim();
            let up = s.to_ascii_uppercase();
            if target == LanguageId::MySql
                && !up.contains("DELIMITER")
                && has_sql_word(&up, "BEGIN")
                && has_sql_word(&up, "END")
            {
                ec.line("DELIMITER //");
                ec.line(&format!("{} //", s.trim_end_matches(';')));
                ec.line("DELIMITER ;");
            } else if s.ends_with(';') || is_comment_only_sql(s) {
                ec.line(s);
            } else {
                ec.line(&format!("{s};"));
            }
        }
        _ => {}
    }
}

fn is_comment_only_sql(s: &str) -> bool {
    let mut rem = s.trim();
    while !rem.is_empty() {
        if let Some(after) = rem.strip_prefix("/*") {
            let Some(end) = after.find("*/") else { return true; };
            rem = after[end + 2..].trim();
        } else if rem.starts_with("--") {
            match rem.find('\n') {
                Some(nl) => rem = rem[nl + 1..].trim(),
                None => return true,
            }
        } else {
            return false;
        }
    }
    true
}

fn has_sql_word(up: &str, kw: &str) -> bool {
    let b = up.as_bytes();
    let kb = kw.as_bytes();
    let mut i = 0usize;
    while let Some(rel) = up[i..].find(kw) {
        let pos = i + rel;
        let left_ok = pos == 0 || (!b[pos - 1].is_ascii_alphanumeric() && b[pos - 1] != b'_');
        let right_ok = pos + kb.len() == b.len()
            || (!b[pos + kb.len()].is_ascii_alphanumeric() && b[pos + kb.len()] != b'_');
        if left_ok && right_ok {
            return true;
        }
        i = pos + 1;
    }
    false
}

fn emit_db_query(dq: &DbQueryDecl, ec: &mut EmitCtx) {
    ec.emit_trivia(&dq.trivia, CommentStyle::SqlDash);
    if !dq.ctes.is_empty() {
        let mut cte_parts = Vec::new();
        for (nm, q) in &dq.ctes { cte_parts.push(format!("{nm} AS ({q})")); }
        ec.line(&format!("WITH {}", cte_parts.join(", ")));
    }
    for (_, sql) in &dq.clauses {
        let s = sql.trim();
        if s.ends_with(';') { ec.line(s); } else { ec.line(&format!("{s};")); }
    }
}
