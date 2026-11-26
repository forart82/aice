use aice_lang_registry::LanguageId;

use crate::decompile::trivia::clean_comment;
use crate::ir::{TranspileOpts, Trivia, TriviaComment, TriviaKind};
use crate::ir_domain_db::{DbColumn, DbSchemaDecl};

pub(crate) fn push_utf8_char(line: &str, i: usize, cur: &mut String) -> usize {
    let cl = line[i..].chars().next().map(char::len_utf8).unwrap_or(1);
    cur.push_str(&line[i..i + cl]);
    i + cl
}

pub(crate) fn parse_create_table_text(
    stmt: &str,
    lang: LanguageId,
    trivia: Trivia,
    opts: &TranspileOpts,
) -> DbSchemaDecl {
    let up = stmt.to_ascii_uppercase();
    let if_not_exists = up.contains("IF NOT EXISTS");
    let lp = stmt.find('(').unwrap_or(stmt.len());
    let name = stmt[..lp].split_whitespace().last().unwrap_or("table").to_string();
    let rp = find_matching_rparen(stmt, lp).unwrap_or_else(|| stmt.rfind(')').unwrap_or(stmt.len()));
    let body = if lp < rp { &stmt[lp + 1..rp] } else { "" };
    let options_raw = stmt.get(rp + 1..).unwrap_or("").trim();
    let options = if options_raw.is_empty() { Vec::new() } else { vec![options_raw.to_string()] };
    let (mut columns, mut constraints) = (Vec::new(), Vec::new());
    for (p, ctr) in split_table_entries_with_trivia(body, lang, opts) {
        let pup = p.to_ascii_uppercase();
        if is_table_constraint_entry(&pup) {
            constraints.push(p);
        } else {
            let mut toks = p.split_whitespace();
            let cname = toks.next().unwrap_or("col").to_string();
            let ctype = toks.next().unwrap_or("TEXT").to_string();
            let rest: Vec<&str> = toks.collect();
            let cons = if rest.is_empty() { Vec::new() } else { vec![rest.join(" ")] };
            columns.push(DbColumn { name: cname, sql_type: ctype, constraints: cons, default: None, trivia: ctr });
        }
    }
    DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia }
}

fn is_table_constraint_entry(pup: &str) -> bool {
    if pup.starts_with("PRIMARY KEY")
        || pup.starts_with("FOREIGN KEY")
        || pup.starts_with("CONSTRAINT ")
        || pup.starts_with("UNIQUE ")
        || pup.starts_with("UNIQUE(")
        || pup.starts_with("CHECK ")
        || pup.starts_with("CHECK(")
        || pup.starts_with("FULLTEXT KEY ")
        || pup.starts_with("FULLTEXT KEY(")
        || pup.starts_with("FULLTEXT INDEX ")
        || pup.starts_with("FULLTEXT INDEX(")
        || pup.starts_with("FULLTEXT ")
        || pup.starts_with("FULLTEXT(")
        || pup.starts_with("SPATIAL KEY ")
        || pup.starts_with("SPATIAL KEY(")
        || pup.starts_with("SPATIAL INDEX ")
        || pup.starts_with("SPATIAL INDEX(")
        || pup.starts_with("SPATIAL ")
        || pup.starts_with("SPATIAL(")
        || pup.starts_with("KEY(")
        || pup.starts_with("INDEX(")
    {
        return true;
    }
    if let Some(rest) = pup.strip_prefix("KEY ").or_else(|| pup.strip_prefix("INDEX ")) {
        let mut toks = rest.split_whitespace();
        let Some(t1) = toks.next() else { return false; };
        if t1.starts_with('(') {
            return true;
        }
        if let Some(t2) = toks.next() {
            return t2.starts_with('(') || t2 == "USING";
        }
    }
    false
}

fn find_matching_rparen(s: &str, lp: usize) -> Option<usize> {
    if lp >= s.len() { return None; }
    let b = s.as_bytes();
    let (mut i, mut depth) = (lp, 0usize);
    let (mut in_sq, mut in_dq, mut in_blk) = (false, false, false);
    while i < b.len() {
        if in_blk {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { in_blk = false; i += 2; }
            else { i += s[i..].chars().next().map(char::len_utf8).unwrap_or(1); }
            continue;
        }
        if !in_sq && !in_dq {
            if b[i] == b'-' && b.get(i + 1) == Some(&b'-') {
                while i < b.len() && b[i] != b'\n' { i += 1; }
                continue;
            }
            if b[i] == b'/' && b.get(i + 1) == Some(&b'*') { in_blk = true; i += 2; continue; }
            if b[i] == b'(' { depth += 1; }
            else if b[i] == b')' {
                depth = depth.saturating_sub(1);
                if depth == 0 { return Some(i); }
            }
        }
        if b[i] == b'\'' && !in_dq { in_sq = !in_sq; }
        else if b[i] == b'"' && !in_sq { in_dq = !in_dq; }
        i += s[i..].chars().next().map(char::len_utf8).unwrap_or(1);
    }
    None
}

fn split_table_entries_with_trivia(
    body: &str,
    lang: LanguageId,
    opts: &TranspileOpts,
) -> Vec<(String, Trivia)> {
    let mut entries: Vec<(String, Trivia)> = Vec::new();
    let (mut cur_code, mut blk_buf) = (String::new(), String::new());
    let (mut pending_leading, mut cur_leading) = (Vec::new(), Vec::new());
    let mut cur_trailing: Option<String> = None;
    let (mut in_sq, mut in_dq, mut in_blk) = (false, false, false);
    let (mut blk_had_code, mut blk_closed_idx, mut paren_depth) = (false, None::<usize>, 0usize);

    for raw_line in body.split('\n') {
        let line = raw_line.strip_suffix('\r').unwrap_or(raw_line);
        let mut just_closed_on_line: Option<usize> = None;
        if !in_blk && !cur_code.trim().is_empty() && !cur_code.ends_with(' ') {
            cur_code.push(' ');
        }
        let b = line.as_bytes();
        let mut i = 0usize;
        while i < b.len() {
            if in_blk {
                if b[i] == b'*' && b.get(i + 1) == Some(&b'/') {
                    in_blk = false;
                    if opts.preserve_docs {
                        let txt = clean_comment(&format!("/*{blk_buf}*/"));
                        if !txt.is_empty() {
                            if blk_had_code {
                                if cur_trailing.is_none() { cur_trailing = Some(txt); }
                            } else if let Some(idx) = blk_closed_idx.take() {
                                if entries[idx].1.trailing.is_none() { entries[idx].1.trailing = Some(txt); }
                            } else {
                                pending_leading.push(TriviaComment { kind: TriviaKind::Line, text: txt });
                            }
                        }
                    }
                    blk_buf.clear();
                    i += 2;
                    continue;
                }
                i = push_utf8_char(line, i, &mut blk_buf);
                continue;
            }
            if !in_sq && !in_dq {
                if (b[i] == b'-' && b.get(i + 1) == Some(&b'-')) || (lang == LanguageId::MySql && b[i] == b'#') {
                    if opts.preserve_docs {
                        let txt = clean_comment(&line[i..]);
                        if !txt.is_empty() {
                            if !cur_code.trim().is_empty() {
                                if cur_trailing.is_none() { cur_trailing = Some(txt); }
                            } else if let Some(idx) = just_closed_on_line {
                                if entries[idx].1.trailing.is_none() { entries[idx].1.trailing = Some(txt); }
                            } else {
                                pending_leading.push(TriviaComment { kind: TriviaKind::Line, text: txt });
                            }
                        }
                    }
                    break;
                }
                if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
                    in_blk = true;
                    blk_buf.clear();
                    blk_had_code = !cur_code.trim().is_empty();
                    blk_closed_idx = if !blk_had_code { just_closed_on_line } else { None };
                    i += 2;
                    continue;
                }
                if b[i] == b'(' { paren_depth += 1; }
                else if b[i] == b')' { paren_depth = paren_depth.saturating_sub(1); }
                else if b[i] == b',' && paren_depth == 0 {
                    if !cur_code.trim().is_empty() {
                        let tr = Trivia { leading: std::mem::take(&mut cur_leading), trailing: cur_trailing.take(), blank_lines_before: 0 };
                        entries.push((cur_code.trim().to_string(), tr));
                        just_closed_on_line = Some(entries.len() - 1);
                    }
                    cur_code.clear();
                    i += 1;
                    continue;
                }
            }
            if b[i] == b'\'' && !in_dq { in_sq = !in_sq; }
            else if b[i] == b'"' && !in_sq { in_dq = !in_dq; }
            if !b[i].is_ascii_whitespace() && cur_code.trim().is_empty() {
                cur_leading = std::mem::take(&mut pending_leading);
                just_closed_on_line = None;
            }
            i = push_utf8_char(line, i, &mut cur_code);
        }
        if in_blk { blk_buf.push('\n'); }
    }
    if !cur_code.trim().is_empty() {
        let tr = Trivia { leading: cur_leading, trailing: cur_trailing, blank_lines_before: 0 };
        entries.push((cur_code.trim().to_string(), tr));
    }
    entries
}

pub(crate) fn parse_create_index_text(stmt: &str, unique: bool, trivia: Trivia) -> DbSchemaDecl {
    let lp = stmt.find('(').unwrap_or(stmt.len());
    let rp = stmt.rfind(')').unwrap_or(stmt.len());
    let parts: Vec<&str> = stmt[..lp].split_whitespace().collect();
    let on_pos = parts.iter().position(|w| w.eq_ignore_ascii_case("ON"));
    let name = on_pos.and_then(|i| parts.get(i.saturating_sub(1))).copied().unwrap_or("idx").to_string();
    let table = on_pos.and_then(|i| parts.get(i + 1)).copied().unwrap_or("tbl").to_string();
    let cols = if lp < rp { stmt[lp + 1..rp].split(',').map(|s| s.trim().to_string()).collect() } else { Vec::new() };
    DbSchemaDecl::Index { name, unique, table, cols, trivia }
}

pub(crate) fn split_top_commas(s: &str) -> Vec<&str> {
    let (mut out, mut depth, mut start) = (Vec::new(), 0usize, 0usize);
    for (i, b) in s.bytes().enumerate() {
        if b == b'(' { depth += 1; }
        else if b == b')' { depth = depth.saturating_sub(1); }
        else if b == b',' && depth == 0 { out.push(&s[start..i]); start = i + 1; }
    }
    if start < s.len() { out.push(&s[start..]); }
    out
}

pub(crate) fn extract_paren_list(s: &str) -> Vec<String> {
    let Some(lp) = s.find('(') else { return Vec::new(); };
    let mut depth = 0usize;
    let rp = s[lp..].bytes().enumerate().find_map(|(i, b)| {
        if b == b'(' { depth += 1; } else if b == b')' { depth = depth.saturating_sub(1); if depth == 0 { return Some(lp + i); } }
        None
    });
    let Some(rp) = rp else { return Vec::new(); };
    split_top_commas(&s[lp + 1..rp]).into_iter().map(|x| x.trim().to_string()).filter(|x| !x.is_empty()).collect()
}

pub(crate) fn extract_keyword_val(s: &str, kw: &str) -> Option<String> {
    let up = s.to_ascii_uppercase();
    let idx = up.find(&format!("{kw} "))?;
    let rest = s[idx + kw.len() + 1..].trim();
    rest.split_whitespace().next().map(|w| w.trim_end_matches(';').to_string())
}
