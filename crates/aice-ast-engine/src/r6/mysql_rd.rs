use crate::r5::checks::ErrorSpan;
use crate::r6::sql_expr::strip_comments;
use crate::r6::sql_lex::{LexOpts, LineIndex, SqlTok, SqlTokKind, lex_sql, sp};

pub const MYSQL_LEX: LexOpts = LexOpts {
    allow_brackets: false,
    allow_backtick: true,
    allow_dollar: false,
    allow_hash_comment: true,
    nested_block_comments: false,
    backslash_escape: true,
    allow_at_var: true,
};

pub struct StmtChunk {
    pub start: usize,
    pub end: usize,
}

pub fn split_mysql_batches(src: &str, li: &LineIndex, errs: &mut Vec<ErrorSpan>) -> Vec<StmtChunk> {
    let mut chunks = Vec::new();
    let mut delim = ";".to_string();
    let mut stmt_start = 0usize;
    let b = src.as_bytes();
    let mut i = 0usize;
    let mut in_sq = false;
    let mut in_dq = false;
    let mut in_bt = false;
    let mut in_blk = false;
    let mut at_line_start = true;

    while i < b.len() {
        if !in_sq && !in_dq && !in_bt && !in_blk && at_line_start {
            let line_end = src[i..].find('\n').map_or(b.len(), |r| i + r);
            let trimmed = src[i..line_end].trim();
            if let Some(new_d) = parse_delimiter_directive(trimmed, i, li, errs) {
                if has_code_tokens(&src[stmt_start..i]) {
                    chunks.push(StmtChunk { start: stmt_start, end: i });
                }
                delim = new_d;
                i = if line_end < b.len() { line_end + 1 } else { b.len() };
                stmt_start = i;
                at_line_start = true;
                continue;
            }
        }
        let ch = b[i];
        at_line_start = ch == b'\n';
        if in_blk {
            if ch == b'*' && i + 1 < b.len() && b[i + 1] == b'/' { in_blk = false; i += 2; }
            else { i += 1; }
            continue;
        }
        if in_sq {
            if ch == b'\\' && i + 1 < b.len() { i += 2; continue; }
            if ch == b'\'' { if i + 1 < b.len() && b[i + 1] == b'\'' { i += 2; continue; } in_sq = false; }
            i += 1;
            continue;
        }
        if in_dq {
            if ch == b'"' { if i + 1 < b.len() && b[i + 1] == b'"' { i += 2; continue; } in_dq = false; }
            i += 1;
            continue;
        }
        if in_bt {
            if ch == b'`' { if i + 1 < b.len() && b[i + 1] == b'`' { i += 2; continue; } in_bt = false; }
            i += 1;
            continue;
        }
        if ch == b'-' && i + 1 < b.len() && b[i + 1] == b'-' {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if ch == b'#' {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if ch == b'/' && i + 1 < b.len() && b[i + 1] == b'*' { in_blk = true; i += 2; continue; }
        if ch == b'\'' { in_sq = true; i += 1; continue; }
        if ch == b'"' { in_dq = true; i += 1; continue; }
        if ch == b'`' { in_bt = true; i += 1; continue; }

        if !delim.is_empty() && src[i..].starts_with(&delim) {
            if has_code_tokens(&src[stmt_start..i]) {
                chunks.push(StmtChunk { start: stmt_start, end: i });
            }
            i += delim.len();
            stmt_start = i;
            at_line_start = false;
            continue;
        }
        i += if ch >= 0x80 { src[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
    }
    if stmt_start < b.len() && has_code_tokens(&src[stmt_start..]) {
        chunks.push(StmtChunk { start: stmt_start, end: b.len() });
    }
    chunks
}

fn parse_delimiter_directive(
    trimmed: &str, line_byte: usize, li: &LineIndex, errs: &mut Vec<ErrorSpan>,
) -> Option<String> {
    let head = trimmed.get(..9)?;
    if !head.eq_ignore_ascii_case("DELIMITER") { return None; }
    let rest = &trimmed[9..];
    if !rest.is_empty() && !rest.starts_with(char::is_whitespace) { return None; }
    let (line, col) = li.line_col(line_byte);
    let parts: Vec<&str> = rest.split_whitespace().collect();
    if parts.is_empty() {
        errs.push(sp(line, col, "Missing delimiter token after DELIMITER"));
        return Some(";".to_string());
    }
    if parts.len() > 1 {
        errs.push(sp(line, col, "Unexpected extra tokens in DELIMITER directive"));
    }
    Some(parts[0].to_string())
}

fn has_code_tokens(s: &str) -> bool {
    let (toks, _, _) = lex_sql(s, MYSQL_LEX);
    !strip_comments(&toks).is_empty()
}

pub(crate) fn validate_mysql_set_special(stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    let is_name_or_str = |t: &SqlTok| {
        matches!(
            t.kind,
            SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent | SqlTokKind::StringLit
        )
    };
    if stmt[1].is_kw(src, "NAMES") {
        let ok = stmt.get(2).is_some_and(is_name_or_str)
            && (stmt.len() == 3 || (stmt.len() == 5 && stmt[3].is_kw(src, "COLLATE") && is_name_or_str(&stmt[4])));
        if !ok {
            let a = stmt.get(3).or(stmt.get(2)).unwrap_or(&stmt[1]);
            errs.push(sp(a.line, a.col, "Malformed MySQL SET NAMES statement"));
        }
        return;
    }
    if stmt[1].is_kw(src, "CHARSET") || stmt[1].is_kw(src, "CHARACTER") {
        let val_idx = if stmt[1].is_kw(src, "CHARSET") { 2 } else { 3 };
        if stmt.len() != val_idx + 1 || !stmt.get(val_idx).is_some_and(is_name_or_str) {
            let a = stmt.get(val_idx).unwrap_or(&stmt[1]);
            errs.push(sp(a.line, a.col, "Malformed MySQL SET CHARACTER SET statement"));
        }
        return;
    }
    let tx_idx = if stmt[1].is_kw(src, "TRANSACTION") { 1 } else { 2 };
    let rest = &stmt[tx_idx + 1..];
    if rest.is_empty() {
        errs.push(sp(stmt[tx_idx].line, stmt[tx_idx].col, "Incomplete SET TRANSACTION statement"));
        return;
    }
    for item in rest.split(|t| t.kind == SqlTokKind::Comma) {
        let valid = match item {
            [a, b] => a.is_kw(src, "READ") && (b.is_kw(src, "WRITE") || b.is_kw(src, "ONLY")),
            [a, b, c] => a.is_kw(src, "ISOLATION") && b.is_kw(src, "LEVEL") && c.is_kw(src, "SERIALIZABLE"),
            [a, b, c, d] => a.is_kw(src, "ISOLATION") && b.is_kw(src, "LEVEL")
                && ((c.is_kw(src, "REPEATABLE") && d.is_kw(src, "READ"))
                    || (c.is_kw(src, "READ") && (d.is_kw(src, "COMMITTED") || d.is_kw(src, "UNCOMMITTED")))),
            _ => false,
        };
        if !valid {
            let a = item.first().unwrap_or(&stmt[tx_idx]);
            errs.push(sp(a.line, a.col, "Invalid SET TRANSACTION characteristic"));
            return;
        }
    }
}

pub(crate) fn find_single_stmt_body_start(
    clean: &[SqlTok], kind_str: &str, kw_idx: usize, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let mut i = kw_idx + 1;
    if clean.get(i).is_some_and(|t| t.is_kw(src, "IF"))
        && clean.get(i + 1).is_some_and(|t| t.is_kw(src, "NOT"))
        && clean.get(i + 2).is_some_and(|t| t.is_kw(src, "EXISTS"))
    {
        i += 3;
    }
    if i >= clean.len() { return None; }
    i += 1;
    if clean.get(i).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        i += 2.min(clean.len() - i);
    }
    if kind_str == "event" {
        let mut d = 0usize;
        while i < clean.len() {
            if clean[i].kind == SqlTokKind::LParen { d += 1; }
            else if clean[i].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
            else if d == 0 && clean[i].is_kw(src, "DO") { return Some(i + 1); }
            i += 1;
        }
        errs.push(sp(clean[kw_idx].line, clean[kw_idx].col, "Expected DO in CREATE EVENT"));
        return None;
    }
    if kind_str == "trigger" {
        while i + 2 < clean.len() {
            if clean[i].is_kw(src, "FOR") && clean[i + 1].is_kw(src, "EACH") && clean[i + 2].is_kw(src, "ROW") {
                let mut k = i + 3;
                if clean.get(k).is_some_and(|t| t.is_kw(src, "FOLLOWS") || t.is_kw(src, "PRECEDES"))
                    && k + 1 < clean.len()
                {
                    k += 2;
                }
                return Some(k);
            }
            i += 1;
        }
        errs.push(sp(clean[kw_idx].line, clean[kw_idx].col, "Expected FOR EACH ROW in CREATE TRIGGER"));
        return None;
    }
    if !clean.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        if kind_str == "function" && clean.iter().any(|t| t.is_kw(src, "SONAME")) { return None; }
        errs.push(sp(clean[kw_idx].line, clean[kw_idx].col, "Expected '(' in MySQL routine signature"));
        return None;
    }
    let mut d = 0usize;
    while i < clean.len() {
        if clean[i].kind == SqlTokKind::LParen { d += 1; }
        else if clean[i].kind == SqlTokKind::RParen { d -= 1; if d == 0 { i += 1; break; } }
        i += 1;
    }
    if d != 0 { return None; }
    if kind_str == "function" {
        if !clean.get(i).is_some_and(|t| t.is_kw(src, "RETURNS")) {
            errs.push(sp(clean[kw_idx].line, clean[kw_idx].col, "Expected RETURNS in CREATE FUNCTION"));
            return None;
        }
        i += 2.min(clean.len() - i);
        while i < clean.len() {
            if clean[i].kind == SqlTokKind::LParen {
                let mut pd = 0usize;
                while i < clean.len() {
                    if clean[i].kind == SqlTokKind::LParen { pd += 1; }
                    else if clean[i].kind == SqlTokKind::RParen { pd -= 1; if pd == 0 { i += 1; break; } }
                    i += 1;
                }
            } else if ["PRECISION", "VARYING", "SIGNED", "UNSIGNED", "ZEROFILL", "BINARY", "ASCII", "UNICODE"]
                .iter().any(|k| clean[i].is_kw(src, k))
            {
                i += 1;
            } else if clean[i].is_kw(src, "CHARACTER") && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "SET")) {
                i += 3.min(clean.len() - i);
            } else if clean[i].is_kw(src, "CHARSET") || clean[i].is_kw(src, "COLLATE") {
                i += 2.min(clean.len() - i);
            } else {
                break;
            }
        }
    }
    skip_routine_characteristics(clean, i, src)
}

pub(crate) fn skip_routine_characteristics(clean: &[SqlTok], mut i: usize, src: &str) -> Option<usize> {
    while i < clean.len() {
        if clean[i].is_kw(src, "SONAME") { return None; }
        if clean[i].is_kw(src, "COMMENT") {
            if !clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::StringLit) { break; }
            i += 2;
        } else if clean[i].is_kw(src, "LANGUAGE") {
            if !clean.get(i + 1).is_some_and(|n| n.kind == SqlTokKind::Word) { break; }
            i += 2;
        } else if clean[i].is_kw(src, "DETERMINISTIC") {
            i += 1;
        } else if (clean[i].is_kw(src, "NOT") && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "DETERMINISTIC")))
            || ((clean[i].is_kw(src, "CONTAINS") || clean[i].is_kw(src, "NO"))
                && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "SQL")))
        {
            i += 2;
        } else if (clean[i].is_kw(src, "READS") || clean[i].is_kw(src, "MODIFIES"))
            && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "SQL"))
            && clean.get(i + 2).is_some_and(|n| n.is_kw(src, "DATA"))
        {
            i += 3;
        } else if clean[i].is_kw(src, "SQL") && clean.get(i + 1).is_some_and(|n| n.is_kw(src, "SECURITY")) {
            if !clean.get(i + 2).is_some_and(|n| n.is_kw(src, "DEFINER") || n.is_kw(src, "INVOKER")) { break; }
            i += 3;
        } else {
            break;
        }
    }
    Some(i)
}
