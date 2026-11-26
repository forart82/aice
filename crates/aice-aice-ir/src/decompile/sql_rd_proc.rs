use aice_lang_registry::LanguageId;

use crate::decompile::sql_rd_tbl::{extract_keyword_val, extract_paren_list};
use crate::ir::Trivia;
use crate::ir_domain_db::DbSchemaDecl;

pub(crate) fn try_parse_create_routine(
    lang: LanguageId,
    stmt: &str,
    trimmed: &str,
    trivia: Trivia,
) -> Option<DbSchemaDecl> {
    let (is_fn, after_kw) = find_routine_keyword(trimmed)?;
    let after = trimmed[after_kw..].trim_start();
    let (name, rest) = split_routine_name(after);
    let after_name = rest.trim_start();
    let params = if after_name.starts_with('(') {
        extract_paren_list(after_name)
    } else if lang == LanguageId::TSql {
        extract_tsql_params(after_name)
    } else {
        Vec::new()
    };
    let returns = extract_keyword_val(stmt, "RETURNS");
    let lang_tag = extract_keyword_val(stmt, "LANGUAGE");
    Some(DbSchemaDecl::Procedure {
        dialect: lang,
        is_fn,
        name,
        params,
        returns,
        lang_tag,
        declares: Vec::new(),
        body_lines: vec![trimmed.into()],
        trivia,
    })
}

fn find_routine_keyword(s: &str) -> Option<(bool, usize)> {
    let mut i = skip_ws_and_comments(s, 0);
    let (w, next) = read_word(s, i)?;
    if !w.eq_ignore_ascii_case("CREATE") {
        return None;
    }
    i = next;
    loop {
        i = skip_ws_and_comments(s, i);
        let (tok, end) = read_word(s, i)?;
        if tok.eq_ignore_ascii_case("FUNCTION") {
            return Some((true, end));
        }
        if tok.eq_ignore_ascii_case("PROCEDURE") || tok.eq_ignore_ascii_case("PROC") {
            return Some((false, end));
        }
        if tok.eq_ignore_ascii_case("OR")
            || tok.eq_ignore_ascii_case("REPLACE")
            || tok.eq_ignore_ascii_case("ALTER")
            || tok.eq_ignore_ascii_case("TEMP")
            || tok.eq_ignore_ascii_case("TEMPORARY")
            || tok.eq_ignore_ascii_case("AGGREGATE")
        {
            i = end;
            continue;
        }
        if tok.eq_ignore_ascii_case("DEFINER") {
            i = skip_ws_and_comments(s, end);
            if s.as_bytes().get(i) == Some(&b'=') {
                i = skip_ws_and_comments(s, i + 1);
                i = skip_definer_val(s, i);
                continue;
            }
        }
        return None;
    }
}

fn skip_definer_val(s: &str, mut i: usize) -> usize {
    let b = s.as_bytes();
    let (mut in_sq, mut in_bq) = (false, false);
    while i < b.len() {
        let c = b[i];
        if !in_sq && !in_bq && c.is_ascii_whitespace() {
            break;
        }
        if c == b'\'' && !in_bq { in_sq = !in_sq; }
        else if c == b'`' && !in_sq { in_bq = !in_bq; }
        i += 1;
    }
    i
}

fn split_routine_name(s: &str) -> (String, &str) {
    let b = s.as_bytes();
    let (mut i, mut in_bracket, mut in_dq, mut in_bq) = (0usize, false, false, false);
    while i < b.len() {
        let c = b[i];
        if in_bracket {
            if c == b']' { in_bracket = false; }
        } else if in_dq {
            if c == b'"' { in_dq = false; }
        } else if in_bq {
            if c == b'`' { in_bq = false; }
        } else if c == b'[' {
            in_bracket = true;
        } else if c == b'"' {
            in_dq = true;
        } else if c == b'`' {
            in_bq = true;
        } else if c == b'(' || c == b';' || c.is_ascii_whitespace() {
            break;
        }
        i += 1;
    }
    let name = s[..i].trim();
    let name = if name.is_empty() { "routine".to_string() } else { name.to_string() };
    (name, &s[i..])
}

fn extract_tsql_params(after_name: &str) -> Vec<String> {
    let header = slice_until_proc_body(after_name);
    let mut params = Vec::new();
    for raw in split_commas_sql(header) {
        let norm = normalize_sql_param(raw);
        if norm.starts_with('@') {
            params.push(norm);
        }
    }
    params
}

fn slice_until_proc_body(s: &str) -> &str {
    let b = s.as_bytes();
    let (mut i, mut depth, mut in_sq, mut in_dq) = (0usize, 0usize, false, false);
    while i < b.len() {
        if !in_sq && !in_dq {
            if b[i] == b'-' && b.get(i + 1) == Some(&b'-') {
                while i < b.len() && b[i] != b'\n' { i += 1; }
                continue;
            }
            if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') { i += 1; }
                i = (i + 2).min(b.len());
                continue;
            }
            if b[i] == b'(' { depth += 1; i += 1; continue; }
            if b[i] == b')' { depth = depth.saturating_sub(1); i += 1; continue; }
            if depth == 0 {
                if b[i] == b';' { return &s[..i]; }
                if (i == 0 || !is_word_byte(b[i - 1]))
                    && let Some((w, _)) = read_word(s, i)
                    && (w.eq_ignore_ascii_case("AS")
                        || w.eq_ignore_ascii_case("WITH")
                        || w.eq_ignore_ascii_case("FOR")
                        || w.eq_ignore_ascii_case("BEGIN"))
                {
                    return &s[..i];
                }
            }
        }
        if b[i] == b'\'' && !in_dq {
            if in_sq && b.get(i + 1) == Some(&b'\'') { i += 2; continue; }
            in_sq = !in_sq;
        } else if b[i] == b'"' && !in_sq {
            in_dq = !in_dq;
        }
        i += 1;
    }
    s
}

fn split_commas_sql(s: &str) -> Vec<&str> {
    let b = s.as_bytes();
    let (mut out, mut start, mut depth, mut in_sq, mut in_dq) = (Vec::new(), 0usize, 0usize, false, false);
    let mut i = 0usize;
    while i < b.len() {
        if !in_sq && !in_dq {
            if b[i] == b'-' && b.get(i + 1) == Some(&b'-') {
                while i < b.len() && b[i] != b'\n' { i += 1; }
                continue;
            }
            if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') { i += 1; }
                i = (i + 2).min(b.len());
                continue;
            }
            if b[i] == b'(' { depth += 1; }
            else if b[i] == b')' { depth = depth.saturating_sub(1); }
            else if b[i] == b',' && depth == 0 {
                out.push(&s[start..i]);
                start = i + 1;
            }
        }
        if b[i] == b'\'' && !in_dq {
            if in_sq && b.get(i + 1) == Some(&b'\'') { i += 2; continue; }
            in_sq = !in_sq;
        } else if b[i] == b'"' && !in_sq {
            in_dq = !in_dq;
        }
        i += 1;
    }
    if start < s.len() { out.push(&s[start..]); }
    out
}

fn normalize_sql_param(raw: &str) -> String {
    let b = raw.as_bytes();
    let (mut out, mut i, mut in_sq, mut in_dq, mut prev_ws) = (String::new(), 0usize, false, false, true);
    while i < b.len() {
        if !in_sq && !in_dq {
            if b[i] == b'-' && b.get(i + 1) == Some(&b'-') {
                while i < b.len() && b[i] != b'\n' { i += 1; }
                continue;
            }
            if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                i += 2;
                while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') { i += 1; }
                i = (i + 2).min(b.len());
                continue;
            }
            if b[i].is_ascii_whitespace() {
                if !prev_ws { out.push(' '); prev_ws = true; }
                i += 1;
                continue;
            }
        }
        if b[i] == b'\'' && !in_dq { in_sq = !in_sq; }
        else if b[i] == b'"' && !in_sq { in_dq = !in_dq; }
        let ch = raw[i..].chars().next().unwrap_or(' ');
        out.push(ch);
        prev_ws = false;
        i += ch.len_utf8();
    }
    out.trim().to_string()
}

fn skip_ws_and_comments(s: &str, mut i: usize) -> usize {
    let b = s.as_bytes();
    while i < b.len() {
        if b[i].is_ascii_whitespace() {
            i += 1;
        } else if b[i] == b'-' && b.get(i + 1) == Some(&b'-') {
            while i < b.len() && b[i] != b'\n' { i += 1; }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            i += 2;
            while i + 1 < b.len() && !(b[i] == b'*' && b[i + 1] == b'/') { i += 1; }
            i = (i + 2).min(b.len());
        } else {
            break;
        }
    }
    i
}

fn is_word_byte(c: u8) -> bool {
    c.is_ascii_alphanumeric() || c == b'_'
}

fn read_word(s: &str, start: usize) -> Option<(&str, usize)> {
    let b = s.as_bytes();
    if start >= b.len() || !is_word_byte(b[start]) {
        return None;
    }
    let mut end = start + 1;
    while end < b.len() && is_word_byte(b[end]) {
        end += 1;
    }
    Some((&s[start..end], end))
}
