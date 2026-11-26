use crate::r5::checks::ErrorSpan;
use crate::r6::mysql_opt::{is_opt_val, is_query_start};
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;

pub(crate) fn validate_partition_by(
    tail: &[SqlTok], i: usize, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    let mut j = validate_part_method(tail, i + 2, true, src, errs)?;
    if tail.get(j).is_some_and(|t| t.is_kw(src, "PARTITIONS")) {
        if !tail.get(j + 1).is_some_and(|t| t.kind == SqlTokKind::Number) {
            errs.push(sp(tail[j].line, tail[j].col, "Expected partition count after PARTITIONS"));
            return None;
        }
        j += 2;
    }
    if tail.get(j).is_some_and(|t| t.is_kw(src, "SUBPARTITION"))
        && tail.get(j + 1).is_some_and(|t| t.is_kw(src, "BY"))
    {
        j = validate_part_method(tail, j + 2, false, src, errs)?;
        if tail.get(j).is_some_and(|t| t.is_kw(src, "SUBPARTITIONS")) {
            if !tail.get(j + 1).is_some_and(|t| t.kind == SqlTokKind::Number) {
                errs.push(sp(tail[j].line, tail[j].col, "Expected count after SUBPARTITIONS"));
                return None;
            }
            j += 2;
        }
    }
    if tail.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let rp = find_matching_rp(tail, j)?;
        if rp == j + 1 {
            errs.push(sp(tail[j].line, tail[j].col, "Empty partition definition list"));
            return None;
        }
        for item in split_comma_top(&tail[j + 1..rp]) {
            if !validate_partition_item(item, &tail[j], src, errs) {
                return None;
            }
        }
        j = rp + 1;
    }
    if j < tail.len() {
        if tail[j].is_kw(src, "AS") && is_query_start(tail, j + 1, src) { return Some(j + 1); }
        if is_query_start(tail, j, src) { return Some(j); }
        errs.push(sp(tail[j].line, tail[j].col, format!("Unexpected token '{}' in PARTITION BY", tail[j].slice(src))));
    }
    None
}

fn validate_partition_item(
    item: &[SqlTok], anchor: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    if item.len() < 2 || !item[0].is_kw(src, "PARTITION") || !is_part_ident(&item[1]) {
        let a = item.first().unwrap_or(anchor);
        errs.push(sp(a.line, a.col, "Invalid partition definition"));
        return false;
    }
    let mut p = 2usize;
    if item.get(p).is_some_and(|t| t.is_kw(src, "VALUES")) {
        p += 1;
        if item.get(p).is_some_and(|t| t.is_kw(src, "LESS"))
            && item.get(p + 1).is_some_and(|t| t.is_kw(src, "THAN"))
        {
            p += 2;
            if item.get(p).is_some_and(|t| t.is_kw(src, "MAXVALUE")) {
                p += 1;
            } else if let Some(next_p) = validate_part_value_list(item, p, true, src, errs) {
                p = next_p;
            } else {
                return false;
            }
        } else if item.get(p).is_some_and(|t| t.is_kw(src, "IN")) {
            let Some(next_p) = validate_part_value_list(item, p + 1, false, src, errs) else {
                return false;
            };
            p = next_p;
        } else {
            let a = item.get(p).unwrap_or(&item[p - 1]);
            errs.push(sp(a.line, a.col, "Expected LESS THAN or IN after VALUES"));
            return false;
        }
    }
    while p < item.len() {
        if item[p].kind == SqlTokKind::LParen {
            let Some(rp) = find_matching_rp(item, p) else {
                errs.push(sp(item[p].line, item[p].col, "Unclosed '(' in subpartition list"));
                return false;
            };
            if rp == p + 1 {
                errs.push(sp(item[p].line, item[p].col, "Empty subpartition definition list"));
                return false;
            }
            for sub in split_comma_top(&item[p + 1..rp]) {
                if !validate_subpartition_item(sub, &item[p], src, errs) {
                    return false;
                }
            }
            p = rp + 1;
            if p < item.len() {
                errs.push(sp(item[p].line, item[p].col, format!("Unexpected token '{}' after subpartitions", item[p].slice(src))));
                return false;
            }
            break;
        }
        if !parse_part_opt(item, &mut p, src, errs) {
            return false;
        }
    }
    true
}

fn validate_subpartition_item(
    sub: &[SqlTok], anchor: &SqlTok, src: &str, errs: &mut Vec<ErrorSpan>,
) -> bool {
    if sub.len() < 2 || !sub[0].is_kw(src, "SUBPARTITION") || !is_part_ident(&sub[1]) {
        let a = sub.first().unwrap_or(anchor);
        errs.push(sp(a.line, a.col, "Invalid subpartition definition"));
        return false;
    }
    let mut p = 2usize;
    while p < sub.len() {
        if !parse_part_opt(sub, &mut p, src, errs) {
            return false;
        }
    }
    true
}

fn validate_part_value_list(
    item: &[SqlTok], lp: usize, allow_maxvalue: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if !item.get(lp).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let a = item.get(lp).unwrap_or(&item[lp - 1]);
        errs.push(sp(a.line, a.col, "Expected '(' in partition VALUES list"));
        return None;
    }
    let rp = find_matching_rp(item, lp)?;
    let inner = &item[lp + 1..rp];
    if inner.is_empty() {
        errs.push(sp(item[lp].line, item[lp].col, "Empty '()' in partition VALUES"));
        return None;
    }
    for v in split_comma_top(inner) {
        if v.is_empty() {
            errs.push(sp(item[lp].line, item[lp].col, "Empty entry in partition VALUES"));
            return None;
        }
        if allow_maxvalue && v.len() == 1 && v[0].is_kw(src, "MAXVALUE") {
            continue;
        }
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(v, src, &mut idx, 0, &[]) {
            errs.push(e);
            return None;
        }
        if idx < v.len() {
            errs.push(sp(v[idx].line, v[idx].col, format!("Unexpected token '{}' in partition VALUES", v[idx].slice(src))));
            return None;
        }
    }
    Some(rp + 1)
}

fn parse_part_opt(item: &[SqlTok], p: &mut usize, src: &str, errs: &mut Vec<ErrorSpan>) -> bool {
    let t = &item[*p];
    if (t.is_kw(src, "STORAGE") && item.get(*p + 1).is_some_and(|n| n.is_kw(src, "ENGINE")))
        || ((t.is_kw(src, "DATA") || t.is_kw(src, "INDEX"))
            && item.get(*p + 1).is_some_and(|n| n.is_kw(src, "DIRECTORY")))
    {
        *p += 2;
    } else if ["ENGINE", "COMMENT", "MAX_ROWS", "MIN_ROWS", "NODEGROUP", "TABLESPACE", "CONNECTION"]
        .iter().any(|k| t.is_kw(src, k))
    {
        *p += 1;
    } else {
        errs.push(sp(t.line, t.col, format!("Unexpected token '{}' in partition definition", t.slice(src))));
        return false;
    }
    if item.get(*p).is_some_and(|n| n.is_op(src, "=")) { *p += 1; }
    if !item.get(*p).is_some_and(is_opt_val) {
        let a = item.get(*p).unwrap_or(&item[*p - 1]);
        errs.push(sp(a.line, a.col, "Expected value for partition option"));
        return false;
    }
    *p += 1;
    true
}

fn validate_part_method(
    tail: &[SqlTok], mut j: usize, allow_range_list: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if tail.get(j).is_some_and(|t| t.is_kw(src, "LINEAR")) { j += 1; }
    let Some(m) = tail.get(j) else {
        errs.push(sp(tail.last()?.line, tail.last()?.col, "Incomplete PARTITION BY clause"));
        return None;
    };
    if m.is_kw(src, "HASH") {
        validate_part_paren(tail, j + 1, false, false, src, errs)
    } else if m.is_kw(src, "KEY") {
        j += 1;
        if tail.get(j).is_some_and(|t| t.is_kw(src, "ALGORITHM")) {
            j += 1;
            if tail.get(j).is_some_and(|t| t.is_op(src, "=")) { j += 1; }
            if !tail.get(j).is_some_and(|t| t.kind == SqlTokKind::Number) {
                errs.push(sp(m.line, m.col, "Expected ALGORITHM number in PARTITION BY KEY"));
                return None;
            }
            j += 1;
        }
        validate_part_paren(tail, j, true, true, src, errs)
    } else if allow_range_list && (m.is_kw(src, "RANGE") || m.is_kw(src, "LIST")) {
        j += 1;
        if tail.get(j).is_some_and(|t| t.is_kw(src, "COLUMNS")) {
            validate_part_paren(tail, j + 1, true, false, src, errs)
        } else {
            validate_part_paren(tail, j, false, false, src, errs)
        }
    } else {
        errs.push(sp(m.line, m.col, format!("Invalid PARTITION BY method '{}'", m.slice(src))));
        None
    }
}

fn validate_part_paren(
    tail: &[SqlTok], j: usize, is_cols: bool, allow_empty: bool, src: &str, errs: &mut Vec<ErrorSpan>,
) -> Option<usize> {
    if !tail.get(j).is_some_and(|t| t.kind == SqlTokKind::LParen) {
        let a = tail.get(j).or(tail.last())?;
        errs.push(sp(a.line, a.col, "Expected '(' in PARTITION BY clause"));
        return None;
    }
    let rp = find_matching_rp(tail, j)?;
    let inner = &tail[j + 1..rp];
    if inner.is_empty() {
        if allow_empty { return Some(rp + 1); }
        errs.push(sp(tail[j].line, tail[j].col, "Empty '()' in PARTITION BY"));
        return None;
    }
    if is_cols {
        if inner.len().is_multiple_of(2) || !inner.iter().enumerate().all(|(k, t)| {
            if k % 2 == 0 { is_part_ident(t) } else { t.kind == SqlTokKind::Comma }
        }) {
            errs.push(sp(inner[0].line, inner[0].col, "Invalid column list in PARTITION BY"));
            return None;
        }
    } else {
        let mut idx = 0;
        if let Err(e) = validate_pratt_expr(inner, src, &mut idx, 0, &[]) { errs.push(e); return None; }
        if idx < inner.len() {
            errs.push(sp(inner[idx].line, inner[idx].col, "Unexpected trailing token in PARTITION BY"));
            return None;
        }
    }
    Some(rp + 1)
}

fn is_part_ident(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent)
}

fn split_comma_top(toks: &[SqlTok]) -> Vec<&[SqlTok]> {
    let (mut out, mut start, mut d) = (Vec::new(), 0usize, 0usize);
    for (i, t) in toks.iter().enumerate() {
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if t.kind == SqlTokKind::Comma && d == 0 {
            out.push(&toks[start..i]);
            start = i + 1;
        }
    }
    out.push(&toks[start..]);
    out
}

fn find_matching_rp(toks: &[SqlTok], lp: usize) -> Option<usize> {
    let mut d = 0usize;
    for (k, t) in toks.iter().enumerate().skip(lp) {
        if t.kind == SqlTokKind::LParen { d += 1; }
        else if t.kind == SqlTokKind::RParen { d -= 1; if d == 0 { return Some(k); } }
    }
    None
}
