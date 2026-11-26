use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};

const EXPR_PREFIX_KWS: &[&str] = &[
    "SELECT", "FROM", "WHERE", "SET", "AND", "OR", "ON", "HAVING", "BY", "INTO", "VALUES",
    "AS", "CASE", "WHEN", "THEN", "ELSE", "NOT", "IS", "IN", "BETWEEN", "LIKE", "UPDATE",
    "DELETE", "INSERT",
];

const FORBIDDEN_COLLATION_KWS: &[&str] = &[
    "NOT", "NULL", "DEFAULT", "PRIMARY", "UNIQUE", "KEY", "INDEX", "AUTO_INCREMENT", "COMMENT",
    "REFERENCES", "CHECK", "CONSTRAINT", "FOREIGN", "GENERATED", "AS", "ON", "UPDATE", "DELETE",
    "COLLATE", "CHARSET", "CHARACTER", "SET", "UNSIGNED", "ZEROFILL", "USING", "ENGINE", "SELECT",
    "FROM", "WHERE", "GROUP", "ORDER", "HAVING", "LIMIT", "OFFSET", "UNION", "INTO", "VALUES",
    "CREATE", "ALTER", "DROP", "TABLE", "VIEW", "COLUMN", "ADD", "MODIFY", "CHANGE", "END",
    "BEGIN", "THEN", "ELSE", "WHEN", "CASE", "AND", "OR", "IS", "IN", "EXISTS",
];

const NUMERIC_TYPE_KWS: &[&str] = &[
    "TINYINT", "SMALLINT", "MEDIUMINT", "INT", "INTEGER", "BIGINT", "FLOAT", "DOUBLE",
    "PRECISION", "REAL", "DECIMAL", "DEC", "NUMERIC", "FIXED", "BIT", "UNSIGNED", "ZEROFILL",
    "SIGNED",
];

fn is_ident(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent)
}

fn is_valid_charset_or_collation(t: &SqlTok, src: &str) -> bool {
    match t.kind {
        SqlTokKind::StringLit => t.slice(src).len() > 2,
        SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent => !t.ident_name(src).is_empty(),
        SqlTokKind::Word => !FORBIDDEN_COLLATION_KWS.iter().any(|k| t.is_kw(src, k)),
        _ => false,
    }
}

fn is_clause_position(toks: &[SqlTok], i: usize, src: &str) -> bool {
    if i == 0 {
        return false;
    }
    let prev = &toks[i - 1];
    if matches!(prev.kind, SqlTokKind::Dot | SqlTokKind::LParen | SqlTokKind::Comma | SqlTokKind::Op) {
        return false;
    }
    !EXPR_PREFIX_KWS.iter().any(|k| prev.is_kw(src, k))
}

fn is_table_constraint_kw(toks: &[SqlTok], idx: usize, src: &str) -> bool {
    let Some(t) = toks.get(idx) else { return false; };
    if (t.is_kw(src, "FOREIGN") || t.is_kw(src, "PRIMARY"))
        && toks.get(idx + 1).is_some_and(|n| n.is_kw(src, "KEY"))
    {
        return true;
    }
    t.is_kw(src, "UNIQUE") || t.is_kw(src, "CHECK")
}

pub(crate) fn validate_mysql_lock_tables(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if stmt.len() >= 2 && stmt[0].is_kw(src, "UNLOCK") && (stmt[1].is_kw(src, "TABLES") || stmt[1].is_kw(src, "TABLE")) {
        if stmt.len() > 2 {
            errs.push(sp(stmt[2].line, stmt[2].col, "Unexpected token after UNLOCK TABLES"));
        }
        return true;
    }
    if stmt.len() >= 2 && stmt[0].is_kw(src, "LOCK") && (stmt[1].is_kw(src, "TABLES") || stmt[1].is_kw(src, "TABLE")) {
        let mut i = 2usize;
        if i >= stmt.len() {
            errs.push(sp(stmt[1].line, stmt[1].col, "Expected table lock specification after LOCK TABLES"));
            return true;
        }
        loop {
            if !stmt.get(i).is_some_and(is_ident) {
                let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
                errs.push(sp(a.line, a.col, "Expected table name in LOCK TABLES"));
                return true;
            }
            i += 1;
            if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
                if !stmt.get(i + 1).is_some_and(is_ident) {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Expected table name after '.' in LOCK TABLES"));
                    return true;
                }
                i += 2;
            }
            if stmt.get(i).is_some_and(|t| t.is_kw(src, "AS")) {
                if !stmt.get(i + 1).is_some_and(is_ident) {
                    errs.push(sp(stmt[i].line, stmt[i].col, "Expected alias after AS in LOCK TABLES"));
                    return true;
                }
                i += 2;
            } else if stmt.get(i).is_some_and(|t| {
                is_ident(t) && !t.is_kw(src, "READ") && !t.is_kw(src, "WRITE") && !t.is_kw(src, "LOW_PRIORITY")
            }) {
                i += 1;
            }
            if stmt.get(i).is_some_and(|t| t.is_kw(src, "READ")) {
                i += 1;
                if stmt.get(i).is_some_and(|t| t.is_kw(src, "LOCAL")) { i += 1; }
            } else {
                if stmt.get(i).is_some_and(|t| t.is_kw(src, "LOW_PRIORITY")) { i += 1; }
                if !stmt.get(i).is_some_and(|t| t.is_kw(src, "WRITE")) {
                    let a = stmt.get(i).unwrap_or(&stmt[i - 1]);
                    errs.push(sp(a.line, a.col, "Expected READ or WRITE lock type in LOCK TABLES"));
                    return true;
                }
                i += 1;
            }
            if stmt.get(i).is_some_and(|t| t.kind == SqlTokKind::Comma) {
                i += 1;
                continue;
            }
            if i < stmt.len() {
                errs.push(sp(stmt[i].line, stmt[i].col, format!("Unexpected token '{}' in LOCK TABLES", stmt[i].slice(src))));
            }
            return true;
        }
    }
    false
}

pub(crate) fn collect_mysql_clause_masks(
    toks: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>,
) -> Vec<(usize, usize)> {
    let is_ddl = toks.first().is_some_and(|t| t.is_kw(src, "CREATE") || t.is_kw(src, "ALTER"));
    let mut masks = Vec::new();
    let mut depth = 0usize;
    let mut i = 0usize;

    while i < toks.len() {
        let t = &toks[i];
        match t.kind {
            SqlTokKind::LParen => { depth += 1; i += 1; continue; }
            SqlTokKind::RParen => { depth = depth.saturating_sub(1); i += 1; continue; }
            _ => {}
        }
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;

        // COLLATE <ident>
        if t.is_kw(src, "COLLATE") && is_clause_position(toks, i, src) {
            let mut v = i + 1;
            if is_ddl && depth == 0 && toks.get(v).is_some_and(|n| n.is_op(src, "=")) {
                v += 1;
            }
            if toks.get(v).is_some_and(|n| is_valid_charset_or_collation(n, src)) {
                masks.push((t.start, toks[v].end));
                i = v + 1;
            } else {
                errs.push(sp(t.line, t.col, "Expected collation name after COLLATE"));
                i += 1;
            }
            continue;
        }

        // CHARACTER SET <ident>
        if not_dot && t.is_kw(src, "CHARACTER") && toks.get(i + 1).is_some_and(|n| n.is_kw(src, "SET")) {
            let mut v = i + 2;
            if is_ddl && depth == 0 && toks.get(v).is_some_and(|n| n.is_op(src, "=")) {
                v += 1;
            }
            if toks.get(v).is_some_and(|n| is_valid_charset_or_collation(n, src)) {
                masks.push((t.start, toks[v].end));
                i = v + 1;
            } else {
                errs.push(sp(t.line, t.col, "Expected charset name after CHARACTER SET"));
                i += 2;
            }
            continue;
        }

        // CHARSET <ident>
        if t.is_kw(src, "CHARSET") && is_clause_position(toks, i, src) {
            let mut v = i + 1;
            if is_ddl && depth == 0 && toks.get(v).is_some_and(|n| n.is_op(src, "=")) {
                v += 1;
            }
            if toks.get(v).is_some_and(|n| is_valid_charset_or_collation(n, src)) {
                masks.push((t.start, toks[v].end));
                i = v + 1;
            } else {
                errs.push(sp(t.line, t.col, "Expected charset name after CHARSET"));
                i += 1;
            }
            continue;
        }

        // UNSIGNED / ZEROFILL in DDL column definitions (never CAST(x AS UNSIGNED))
        if is_ddl && i > 0 && (t.is_kw(src, "UNSIGNED") || t.is_kw(src, "ZEROFILL")) {
            let prev = &toks[i - 1];
            let after_num_type = prev.kind == SqlTokKind::RParen
                || NUMERIC_TYPE_KWS.iter().any(|k| prev.is_kw(src, k));
            if after_num_type {
                masks.push((t.start, t.end));
                i += 1;
                continue;
            }
        }

        // ON UPDATE CURRENT_TIMESTAMP[([fsp])]
        if is_ddl && not_dot && t.is_kw(src, "ON")
            && toks.get(i + 1).is_some_and(|n| n.is_kw(src, "UPDATE"))
            && toks.get(i + 2).is_some_and(|n| {
                n.is_kw(src, "CURRENT_TIMESTAMP") || n.is_kw(src, "LOCALTIME") || n.is_kw(src, "LOCALTIMESTAMP")
            })
        {
            if toks.get(i + 3).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                if toks.get(i + 4).is_some_and(|n| n.kind == SqlTokKind::RParen) {
                    masks.push((t.start, toks[i + 4].end));
                    i += 5;
                } else if toks.get(i + 4).is_some_and(|n| n.kind == SqlTokKind::Number)
                    && toks.get(i + 5).is_some_and(|n| n.kind == SqlTokKind::RParen)
                {
                    masks.push((t.start, toks[i + 5].end));
                    i += 6;
                } else {
                    errs.push(sp(toks[i + 3].line, toks[i + 3].col, "Invalid precision argument in ON UPDATE CURRENT_TIMESTAMP"));
                    i += 3;
                }
            } else {
                masks.push((t.start, toks[i + 2].end));
                i += 3;
            }
            continue;
        }

        // USING BTREE | HASH in DDL (CREATE/ALTER TABLE/INDEX)
        if is_ddl && not_dot && t.is_kw(src, "USING")
            && toks.get(i + 1).is_some_and(|n| n.is_kw(src, "BTREE") || n.is_kw(src, "HASH"))
        {
            masks.push((t.start, toks[i + 1].end));
            i += 2;
            continue;
        }

        // Named table constraints inside CREATE TABLE (...): CONSTRAINT <name> FOREIGN KEY / PRIMARY KEY / UNIQUE / CHECK
        if is_ddl && depth == 1 && i > 0 && t.is_kw(src, "CONSTRAINT")
            && matches!(toks[i - 1].kind, SqlTokKind::Comma | SqlTokKind::LParen)
            && toks.get(i + 1).is_some_and(|n| is_ident(n) && !is_table_constraint_kw(toks, i + 1, src))
            && is_table_constraint_kw(toks, i + 2, src)
        {
            masks.push((t.start, toks[i + 1].end));
            i += 2;
            continue;
        }

        i += 1;
    }
    masks
}
