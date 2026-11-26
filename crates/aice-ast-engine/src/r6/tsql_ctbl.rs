use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;
use crate::r6::tsql_dml::{is_dml_ident, validate_col_list};
use crate::r6::tsql_query::is_tsql_ident_tok;
use crate::r6::tsql_stmt::{matching_rparen, split_comma_top};

fn is_fg_tok(t: &SqlTok, src: &str) -> bool {
    (is_tsql_ident_tok(t) || t.kind == SqlTokKind::StringLit) && !t.ident_name(src).is_empty()
        && !(t.kind == SqlTokKind::Word && ["ON", "TEXTIMAGE_ON", "FILESTREAM_ON", "WITH", "AS"].iter().any(|kw| t.is_kw(src, kw)))
}

pub(crate) fn validate_ctbl_tail(tail: &[SqlTok], allow_as: bool, src: &str, errs: &mut Vec<ErrorSpan>) {
    let (mut seen_on, mut seen_ti, mut seen_fs, mut seen_with, mut seen_as) = (false, false, false, false, false);
    let mut k = 0usize;
    while k < tail.len() {
        let t = &tail[k];
        if !seen_on && t.is_kw(src, "ON") {
            seen_on = true;
            if !tail.get(k + 1).is_some_and(|n| is_fg_tok(n, src)) {
                opt_err(tail.get(k + 1).unwrap_or(t), "Expected filegroup or partition scheme after ON in CREATE TABLE", errs); return;
            }
            k += 2;
            if tail.get(k).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                let Some(rp) = matching_rparen(tail, k) else { return; };
                let inner = &tail[k + 1..rp];
                if inner.len() != 1 || !is_tsql_ident_tok(&inner[0]) || inner[0].ident_name(src).is_empty() {
                    opt_err(&tail[k], "Invalid partition column in CREATE TABLE ON clause", errs); return;
                }
                k = rp + 1;
            }
        } else if (!seen_ti && t.is_kw(src, "TEXTIMAGE_ON")) || (!seen_fs && t.is_kw(src, "FILESTREAM_ON")) {
            if t.is_kw(src, "TEXTIMAGE_ON") { seen_ti = true; } else { seen_fs = true; }
            if !tail.get(k + 1).is_some_and(|n| is_fg_tok(n, src)) {
                opt_err(tail.get(k + 1).unwrap_or(t), format!("Expected filegroup after {} in CREATE TABLE", t.slice(src)), errs); return;
            }
            k += 2;
        } else if !seen_with && t.is_kw(src, "WITH") {
            seen_with = true;
            if !tail.get(k + 1).is_some_and(|n| n.kind == SqlTokKind::LParen) {
                opt_err(tail.get(k + 1).unwrap_or(t), "Expected '(' after WITH in CREATE TABLE", errs); return;
            }
            let Some(rp) = matching_rparen(tail, k + 1) else { return; };
            if !validate_ctbl_with(&tail[k + 2..rp], &tail[k + 1], src, errs) { return; }
            k = rp + 1;
        } else if allow_as && !seen_as && t.is_kw(src, "AS") {
            seen_as = true;
            if !tail.get(k + 1).is_some_and(|n| n.is_kw(src, "NODE") || n.is_kw(src, "EDGE")) {
                opt_err(tail.get(k + 1).unwrap_or(t), "Expected NODE or EDGE after AS in CREATE TABLE", errs); return;
            }
            k += 2;
        } else {
            opt_err(t, format!("Unexpected token '{}' in CREATE TABLE", t.slice(src)), errs); return;
        }
    }
}

fn opt_err(t: &SqlTok, msg: impl Into<String>, errs: &mut Vec<ErrorSpan>) -> bool {
    errs.push(sp(t.line, t.col, msg));
    false
}

fn validate_ctbl_with(inner: &[SqlTok], lp: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if inner.is_empty() { return opt_err(lp, "Empty '()' in CREATE TABLE WITH", errs); }
    for item in split_comma_top(inner) {
        if item.is_empty() { return opt_err(lp, "Empty option in CREATE TABLE WITH", errs); }
        if item[0].kind != SqlTokKind::Word {
            return opt_err(&item[0], format!("Invalid option '{}' in CREATE TABLE WITH", item[0].slice(src)), errs);
        }
        let ok = if item.get(1).is_some_and(|t| t.is_op(src, "=")) { validate_kv_opt(item, src, errs) }
        else { validate_bare_opt(item, src, errs) };
        if !ok { return false; }
    }
    true
}

fn exact_rparen(s: &[SqlTok], lp_i: usize, non_empty: bool, ctx: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if !s.get(lp_i).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        opt_err(s.get(lp_i).unwrap_or(&s[lp_i.saturating_sub(1)]), format!("Expected '(' in {ctx}"), errs);
        return None;
    }
    let rp = matching_rparen(s, lp_i).or_else(|| { opt_err(&s[lp_i], format!("Unclosed '(' in {ctx}"), errs); None })?;
    if non_empty && rp == lp_i + 1 { opt_err(&s[lp_i], format!("Empty '()' in {ctx}"), errs); return None; }
    Some(rp)
}

fn check_trailing(s: &[SqlTok], pos: usize, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    pos >= s.len() || opt_err(&s[pos], format!("Unexpected token '{}' in {ctx}", s[pos].slice(src)), errs)
}

fn check_enum_val(val: &[SqlTok], allowed: &[&str], ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if !allowed.iter().any(|k| val[0].is_kw(src, k)) {
        return opt_err(&val[0], format!("Invalid value '{}' in {ctx}", val[0].slice(src)), errs);
    }
    check_trailing(val, 1, ctx, src, errs)
}

fn parse_ident_parts(val: &[SqlTok], max_parts: usize, full: bool, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> Option<usize> {
    if !is_dml_ident(&val[0], src) { opt_err(&val[0], format!("Expected identifier in {ctx}"), errs); return None; }
    let (mut i, mut parts) = (1usize, 1usize);
    while i < val.len() && val[i].kind == SqlTokKind::Dot {
        if parts >= max_parts { opt_err(&val[i], format!("Too many qualifier parts in {ctx}"), errs); return None; }
        if !val.get(i + 1).is_some_and(|t| is_tsql_ident_tok(t) && !t.ident_name(src).is_empty()) {
            opt_err(&val[i], format!("Expected identifier after '.' in {ctx}"), errs);
            return None;
        }
        i += 2;
        parts += 1;
    }
    (!full || check_trailing(val, i, ctx, src, errs)).then_some(i)
}

fn check_pratt_list(inner: &[SqlTok], allow_empty: bool, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if inner.is_empty() { return allow_empty; }
    for arg in split_comma_top(inner) {
        if arg.is_empty() { return opt_err(&inner[0], format!("Empty expression in {ctx}"), errs); }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(arg, src, &mut idx, 0, &[]) { errs.push(e); return false; }
        if !check_trailing(arg, idx, ctx, src, errs) { return false; }
    }
    true
}

fn validate_bare_opt(item: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let k0 = &item[0];
    if k0.is_kw(src, "HEAP") { return check_trailing(item, 1, "CREATE TABLE WITH HEAP", src, errs); }
    if k0.is_kw(src, "CLUSTERED") && item.get(1).is_some_and(|t| t.is_kw(src, "COLUMNSTORE")) {
        if !item.get(2).is_some_and(|t| t.is_kw(src, "INDEX")) {
            return opt_err(item.get(2).unwrap_or(&item[1]), "Expected INDEX after CLUSTERED COLUMNSTORE", errs);
        }
        if item.len() == 3 { return true; }
        if !item[3].is_kw(src, "ORDER") { return opt_err(&item[3], format!("Unexpected token '{}' in CREATE TABLE WITH", item[3].slice(src)), errs); }
        let Some(rp) = exact_rparen(item, 4, true, "CLUSTERED COLUMNSTORE INDEX ORDER", errs) else { return false; };
        return validate_col_list(&item[5..rp], &item[4], "CLUSTERED COLUMNSTORE INDEX ORDER", src, errs)
            && check_trailing(item, rp + 1, "CLUSTERED COLUMNSTORE INDEX ORDER", src, errs);
    }
    if k0.is_kw(src, "CLUSTERED") && item.get(1).is_some_and(|t| t.is_kw(src, "INDEX")) {
        let Some(rp) = exact_rparen(item, 2, true, "CLUSTERED INDEX", errs) else { return false; };
        for col in split_comma_top(&item[3..rp]) {
            let ok = !col.is_empty() && is_tsql_ident_tok(&col[0]) && !col[0].ident_name(src).is_empty()
                && (col.len() == 1 || (col.len() == 2 && (col[1].is_kw(src, "ASC") || col[1].is_kw(src, "DESC"))));
            if !ok { return opt_err(col.first().unwrap_or(&item[2]), "Invalid column in CLUSTERED INDEX", errs); }
        }
        return check_trailing(item, rp + 1, "CLUSTERED INDEX", src, errs);
    }
    if k0.is_kw(src, "PARTITION") {
        let Some(rp) = exact_rparen(item, 1, true, "PARTITION", errs) else { return false; };
        if !check_trailing(item, rp + 1, "PARTITION", src, errs) { return false; }
        let inner = &item[2..rp];
        if !is_dml_ident(&inner[0], src) || !inner.get(1).is_some_and(|t| t.is_kw(src, "RANGE")) {
            return opt_err(&inner[0], "Invalid PARTITION specification in CREATE TABLE WITH", errs);
        }
        let p = if inner.get(2).is_some_and(|t| t.is_kw(src, "LEFT") || t.is_kw(src, "RIGHT")) { 3 } else { 2 };
        if !inner.get(p).is_some_and(|t| t.is_kw(src, "FOR")) || !inner.get(p + 1).is_some_and(|t| t.is_kw(src, "VALUES")) {
            return opt_err(inner.get(p).unwrap_or(&inner[p - 1]), "Expected FOR VALUES in PARTITION", errs);
        }
        let Some(vrp) = exact_rparen(inner, p + 2, false, "PARTITION FOR VALUES", errs) else { return false; };
        return check_trailing(inner, vrp + 1, "PARTITION", src, errs) && check_pratt_list(&inner[p + 3..vrp], true, "PARTITION FOR VALUES", src, errs);
    }
    opt_err(k0, format!("Invalid option '{}' in CREATE TABLE WITH", k0.slice(src)), errs)
}

fn validate_kv_opt(item: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if item.len() < 3 { return opt_err(&item[1], "Expected value after '=' in CREATE TABLE WITH", errs); }
    let (k, val) = (&item[0], &item[2..]);
    if k.is_kw(src, "DATA_COMPRESSION") || k.is_kw(src, "XML_COMPRESSION") {
        let allowed: &[&str] = if k.is_kw(src, "XML_COMPRESSION") { &["ON", "OFF"] }
        else { &["NONE", "ROW", "PAGE", "COLUMNSTORE", "COLUMNSTORE_ARCHIVE"] };
        if !allowed.iter().any(|x| val[0].is_kw(src, x)) { return opt_err(&val[0], format!("Invalid {} value", k.slice(src)), errs); }
        return val.len() == 1 || validate_on_partitions(&val[1..], src, errs);
    }
    if k.is_kw(src, "MEMORY_OPTIMIZED") { return check_enum_val(val, &["ON", "OFF"], "MEMORY_OPTIMIZED", src, errs); }
    if k.is_kw(src, "DURABILITY") { return check_enum_val(val, &["SCHEMA_ONLY", "SCHEMA_AND_DATA"], "DURABILITY", src, errs); }
    if k.is_kw(src, "FILETABLE_DIRECTORY") {
        if val[0].kind == SqlTokKind::StringLit || is_dml_ident(&val[0], src) || val[0].is_kw(src, "NULL") {
            return check_trailing(val, 1, "FILETABLE_DIRECTORY", src, errs);
        }
        return opt_err(&val[0], "Invalid FILETABLE_DIRECTORY value", errs);
    }
    if k.is_kw(src, "FILETABLE_COLLATE_FILENAME") || k.is_kw(src, "LOCATION") {
        if is_dml_ident(&val[0], src) || val[0].kind == SqlTokKind::StringLit {
            return check_trailing(val, 1, k.slice(src), src, errs);
        }
        return opt_err(&val[0], format!("Invalid {} value", k.slice(src)), errs);
    }
    if k.is_kw(src, "FILETABLE_PRIMARY_KEY_CONSTRAINT_NAME")
        || k.is_kw(src, "FILETABLE_STREAMID_UNIQUE_CONSTRAINT_NAME")
        || k.is_kw(src, "FILETABLE_FULLPATH_UNIQUE_CONSTRAINT_NAME") { return parse_ident_parts(val, 1, true, k.slice(src), src, errs).is_some(); }
    if k.is_kw(src, "DISTRIBUTION") {
        if val[0].is_kw(src, "HASH") {
            let Some(rp) = exact_rparen(val, 1, true, "DISTRIBUTION HASH", errs) else { return false; };
            return validate_col_list(&val[2..rp], &val[1], "DISTRIBUTION HASH", src, errs) && check_trailing(val, rp + 1, "DISTRIBUTION HASH", src, errs);
        }
        return check_enum_val(val, &["ROUND_ROBIN", "REPLICATE"], "DISTRIBUTION", src, errs);
    }
    if let Some(&ctx) = ["SYSTEM_VERSIONING", "LEDGER", "DATA_DELETION"].iter().find(|&&x| k.is_kw(src, x)) {
        return check_on_off_nested(val, false, ctx, src, errs);
    }
    if k.is_kw(src, "REMOTE_DATA_ARCHIVE") { return check_on_off_nested(val, true, "REMOTE_DATA_ARCHIVE", src, errs); }
    opt_err(k, format!("Unknown option '{}' in CREATE TABLE WITH", k.slice(src)), errs)
}

fn validate_on_partitions(tail: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if !tail[0].is_kw(src, "ON") || !tail.get(1).is_some_and(|t| t.is_kw(src, "PARTITIONS")) {
        return opt_err(&tail[0], "Unexpected token after compression value", errs);
    }
    let Some(rp) = exact_rparen(tail, 2, true, "ON PARTITIONS", errs) else { return false; };
    if !check_trailing(tail, rp + 1, "ON PARTITIONS", src, errs) { return false; }
    let is_int = |t: &SqlTok| t.kind == SqlTokKind::Number && t.slice(src).bytes().all(|b| b.is_ascii_digit());
    for p in split_comma_top(&tail[3..rp]) {
        if !((p.len() == 1 && is_int(&p[0])) || (p.len() == 3 && is_int(&p[0]) && p[1].is_kw(src, "TO") && is_int(&p[2]))) {
            return opt_err(p.first().unwrap_or(&tail[2]), "Invalid partition range in ON PARTITIONS", errs);
        }
    }
    true
}

fn check_on_off_nested(val: &[SqlTok], allow_off_paren: bool, ctx: &str, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let (is_on, is_off) = (val[0].is_kw(src, "ON"), val[0].is_kw(src, "OFF"));
    if !is_on && !is_off { return opt_err(&val[0], format!("Expected ON or OFF in {ctx}"), errs); }
    if val.len() == 1 { return true; }
    if is_off && !allow_off_paren { return check_trailing(val, 1, ctx, src, errs); }
    let Some(rp) = exact_rparen(val, 1, true, ctx, errs) else { return false; };
    if !check_trailing(val, rp + 1, ctx, src, errs) { return false; }
    for sub in split_comma_top(&val[2..rp]) {
        if sub.is_empty() || sub[0].kind != SqlTokKind::Word || !sub.get(1).is_some_and(|t| t.is_op(src, "=")) || sub.len() < 3 {
            return opt_err(sub.first().unwrap_or(&val[1]), format!("Invalid sub-option in {ctx}"), errs);
        }
        let (sk, sv) = (&sub[0], &sub[2..]);
        let ok = match ctx {
            "SYSTEM_VERSIONING" if sk.is_kw(src, "HISTORY_TABLE") => parse_ident_parts(sv, 2, true, "HISTORY_TABLE", src, errs).is_some(),
            "SYSTEM_VERSIONING" if sk.is_kw(src, "DATA_CONSISTENCY_CHECK") => check_enum_val(sv, &["ON", "OFF"], "DATA_CONSISTENCY_CHECK", src, errs),
            "SYSTEM_VERSIONING" if sk.is_kw(src, "HISTORY_RETENTION_PERIOD") => check_retention(sv, src, errs),
            "LEDGER" if sk.is_kw(src, "APPEND_ONLY") => check_enum_val(sv, &["ON", "OFF"], "APPEND_ONLY", src, errs),
            "LEDGER" if sk.is_kw(src, "LEDGER_VIEW") => validate_ledger_view(sv, src, errs),
            "REMOTE_DATA_ARCHIVE" if sk.is_kw(src, "MIGRATION_STATE") => check_enum_val(sv, &["OUTBOUND", "INBOUND", "PAUSED"], "MIGRATION_STATE", src, errs),
            "REMOTE_DATA_ARCHIVE" if sk.is_kw(src, "FILTER_PREDICATE") && !is_off => validate_filter_pred(sv, src, errs),
            "DATA_DELETION" if sk.is_kw(src, "FILTER_COLUMN") => parse_ident_parts(sv, 1, true, "FILTER_COLUMN", src, errs).is_some(),
            "DATA_DELETION" if sk.is_kw(src, "RETENTION_PERIOD") => check_retention(sv, src, errs),
            _ => opt_err(sk, format!("Unknown sub-option '{}' in {ctx}", sk.slice(src)), errs),
        };
        if !ok { return false; }
    }
    true
}

fn check_retention(sv: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if sv[0].is_kw(src, "INFINITE") { return check_trailing(sv, 1, "RETENTION_PERIOD", src, errs); }
    let units = ["DAY", "DAYS", "WEEK", "WEEKS", "MONTH", "MONTHS", "YEAR", "YEARS"];
    if sv[0].kind == SqlTokKind::Number && sv[0].slice(src).bytes().all(|b| b.is_ascii_digit())
        && sv.get(1).is_some_and(|u| units.iter().any(|k| u.is_kw(src, k))) { return check_trailing(sv, 2, "RETENTION_PERIOD", src, errs); }
    opt_err(&sv[0], "Invalid retention period in CREATE TABLE WITH", errs)
}

fn validate_ledger_view(sv: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let Some(i) = parse_ident_parts(sv, 2, false, "LEDGER_VIEW", src, errs) else { return false; };
    if i == sv.len() { return true; }
    let Some(rp) = exact_rparen(sv, i, true, "LEDGER_VIEW", errs) else { return false; };
    if !check_trailing(sv, rp + 1, "LEDGER_VIEW", src, errs) { return false; }
    let keys = ["TRANSACTION_ID_COLUMN_NAME", "SEQUENCE_NUMBER_COLUMN_NAME", "OPERATION_TYPE_COLUMN_NAME", "OPERATION_TYPE_DESC_COLUMN_NAME"];
    for col in split_comma_top(&sv[i + 1..rp]) {
        if col.len() < 3 || !keys.iter().any(|k| col[0].is_kw(src, k)) || !col[1].is_op(src, "=") {
            return opt_err(col.first().unwrap_or(&sv[i]), "Invalid column option in LEDGER_VIEW", errs);
        }
        if parse_ident_parts(&col[2..], 1, true, "LEDGER_VIEW", src, errs).is_none() { return false; }
    }
    true
}

fn validate_filter_pred(sv: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    if sv[0].is_kw(src, "NULL") { return check_trailing(sv, 1, "FILTER_PREDICATE", src, errs); }
    let Some(i) = parse_ident_parts(sv, 2, false, "FILTER_PREDICATE", src, errs) else { return false; };
    let Some(rp) = exact_rparen(sv, i, true, "FILTER_PREDICATE", errs) else { return false; };
    check_trailing(sv, rp + 1, "FILTER_PREDICATE", src, errs) && check_pratt_list(&sv[i + 1..rp], false, "FILTER_PREDICATE", src, errs)
}
