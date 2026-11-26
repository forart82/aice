use crate::r5::checks::ErrorSpan;
use crate::r6::mysql_part::validate_partition_by;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};

const MYSQL_TBL_OPT_KWS: &[&str] = &[
    "ENGINE", "CHARSET", "COLLATE", "AUTO_INCREMENT", "AUTOEXTEND_SIZE", "COMMENT",
    "ROW_FORMAT", "AVG_ROW_LENGTH", "MAX_ROWS", "MIN_ROWS", "KEY_BLOCK_SIZE",
    "CHECKSUM", "PAGE_CHECKSUM", "TRANSACTIONAL", "DELAY_KEY_WRITE", "COMPRESSION",
    "ENCRYPTION", "PACK_KEYS", "STATS_AUTO_RECALC", "STATS_PERSISTENT",
    "STATS_SAMPLE_PAGES", "INSERT_METHOD", "CONNECTION",
];

pub(crate) fn is_query_start(toks: &[SqlTok], mut i: usize, src: &str) -> bool {
    while toks.get(i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        i += 1;
    }
    toks.get(i).is_some_and(|t| t.is_kw(src, "SELECT") || t.is_kw(src, "WITH"))
}

pub(crate) fn find_table_tail_start(stmt: &[SqlTok], src: &str) -> Option<usize> {
    if !stmt.first().is_some_and(|t| t.is_kw(src, "CREATE"))
        || !stmt.get(1).is_some_and(|t| t.is_kw(src, "TABLE"))
    {
        return None;
    }
    let mut k = 2usize;
    if stmt.get(k).is_some_and(|t| t.is_kw(src, "IF")) {
        if stmt.get(k + 1).is_some_and(|t| t.is_kw(src, "NOT"))
            && stmt.get(k + 2).is_some_and(|t| t.is_kw(src, "EXISTS"))
        {
            k += 3;
        } else {
            return None;
        }
    }
    let is_name = |t: &SqlTok| matches!(
        t.kind,
        SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent
    );
    if !stmt.get(k).is_some_and(is_name) { return None; }
    k += 1;
    if stmt.get(k).is_some_and(|t| t.kind == SqlTokKind::Dot) {
        if !stmt.get(k + 1).is_some_and(is_name) { return None; }
        k += 2;
    }
    (k < stmt.len()).then_some(k)
}

pub(crate) fn validate_mysql_table_options(tail: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    let mut i = 0usize;
    let mut saw_comma = false;
    while i < tail.len() {
        if !saw_comma {
            if (tail[i].is_kw(src, "IGNORE") || tail[i].is_kw(src, "REPLACE"))
                && (is_query_start(tail, i + 1, src)
                    || (tail.get(i + 1).is_some_and(|n| n.is_kw(src, "AS")) && is_query_start(tail, i + 2, src)))
            {
                i += 1;
                continue;
            }
            if tail[i].is_kw(src, "AS") && is_query_start(tail, i + 1, src) {
                return Some(i + 1);
            }
            if is_query_start(tail, i, src) {
                return Some(i);
            }
        }
        saw_comma = false;
        if tail[i].kind == SqlTokKind::Comma {
            i += 1;
            if i >= tail.len() {
                errs.push(sp(tail[i - 1].line, tail[i - 1].col, "Trailing ',' in MySQL table options"));
                return None;
            }
            saw_comma = true;
            continue;
        }
        if tail[i].is_kw(src, "DEFAULT") {
            if tail.get(i + 1).is_some_and(|n| n.is_kw(src, "CHARACTER") || n.is_kw(src, "CHARSET") || n.is_kw(src, "COLLATE")) {
                i += 1;
                continue;
            }
            errs.push(sp(tail[i].line, tail[i].col, "Expected CHARSET or COLLATE after DEFAULT in MySQL table options"));
            return None;
        }
        if (tail[i].is_kw(src, "CHARACTER") && tail.get(i + 1).is_some_and(|n| n.is_kw(src, "SET")))
            || ((tail[i].is_kw(src, "DATA") || tail[i].is_kw(src, "INDEX"))
                && tail.get(i + 1).is_some_and(|n| n.is_kw(src, "DIRECTORY")))
        {
            i += 2;
        } else if tail[i].is_kw(src, "TABLESPACE") {
            i += 1;
            if !tail.get(i).is_some_and(is_opt_val) {
                errs.push(sp(tail[i - 1].line, tail[i - 1].col, "Expected tablespace name"));
                return None;
            }
            i += 1;
            if tail.get(i).is_some_and(|n| n.is_kw(src, "STORAGE")) && tail.get(i + 1).is_some_and(is_opt_val) {
                i += 2;
            }
            continue;
        } else if tail[i].is_kw(src, "PARTITION") && tail.get(i + 1).is_some_and(|n| n.is_kw(src, "BY")) {
            return validate_partition_by(tail, i, src, errs);
        } else if tail[i].is_kw(src, "UNION") {
            i += 1;
            if tail.get(i).is_some_and(|n| n.is_op(src, "=")) { i += 1; }
            if tail.get(i).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let mut d = 0usize;
                while i < tail.len() {
                    if tail[i].kind == SqlTokKind::LParen { d += 1; }
                    else if tail[i].kind == SqlTokKind::RParen { d -= 1; if d == 0 { i += 1; break; } }
                    i += 1;
                }
                continue;
            }
            errs.push(sp(tail[i - 1].line, tail[i - 1].col, "Expected '(...)' after UNION table option"));
            return None;
        } else if MYSQL_TBL_OPT_KWS.iter().any(|k| tail[i].is_kw(src, k)) {
            i += 1;
        } else {
            errs.push(sp(tail[i].line, tail[i].col, format!("Invalid MySQL table option '{}'", tail[i].slice(src))));
            return None;
        }
        if tail.get(i).is_some_and(|n| n.is_op(src, "=")) { i += 1; }
        if !tail.get(i).is_some_and(is_opt_val) {
            let a = tail.get(i).unwrap_or(&tail[i - 1]);
            errs.push(sp(a.line, a.col, "Expected value for MySQL table option"));
            return None;
        }
        i += 1;
    }
    None
}

pub(crate) fn is_opt_val(t: &SqlTok) -> bool {
    matches!(
        t.kind,
        SqlTokKind::Word | SqlTokKind::Number | SqlTokKind::StringLit | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent
    )
}
