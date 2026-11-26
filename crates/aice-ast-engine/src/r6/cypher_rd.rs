use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{LineIndex, sp};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum CK {
    Word, Str, Backtick, Num, Param, Op, LP, RP, LB, RB, LC, RC, Comma, Semi,
}

#[derive(Debug, Clone, Copy)]
struct CTok { kind: CK, start: usize, end: usize, line: usize, col: usize }

impl CTok {
    fn sl<'a>(&self, s: &'a str) -> &'a str { s.get(self.start..self.end).unwrap_or("") }
    fn kw(&self, s: &str, k: &str) -> bool { self.kind == CK::Word && self.sl(s).eq_ignore_ascii_case(k) }
}

pub fn verify_cypher_rd(src: &str) -> Vec<ErrorSpan> {
    let (toks, mut errs) = lex_cypher(src);
    check_cypher_delims(&toks, &mut errs);
    for stmt in split_semi(&toks) {
        for seg in split_union(stmt, src) {
            validate_segment(seg, src, &mut errs);
        }
    }
    errs
}

fn lex_cypher(src: &str) -> (Vec<CTok>, Vec<ErrorSpan>) {
    let li = LineIndex::new(src);
    let b = src.as_bytes();
    let (mut toks, mut errs, mut i) = (Vec::new(), Vec::new(), 0usize);
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; continue; }
        let (line, col) = li.line_col(i);
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'/' {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i] == b'/' && i + 1 < b.len() && b[i + 1] == b'*' {
            if let Some(rel) = src[i + 2..].find("*/") { i += 4 + rel; continue; }
            errs.push(sp(line, col, "Unterminated '/*' comment in Cypher"));
            break;
        }
        if b[i] == b'\'' || b[i] == b'"' || b[i] == b'`' {
            let q = b[i];
            let kind = if q == b'`' { CK::Backtick } else { CK::Str };
            let start = i;
            i += 1;
            let mut closed = false;
            while i < b.len() {
                if q != b'`' && b[i] == b'\\' && i + 1 < b.len() {
                    let step = if b[i + 1] >= 0x80 { 1 + src[i + 1..].chars().next().map_or(1, char::len_utf8) } else { 2 };
                    i += step;
                    continue;
                }
                if b[i] == q {
                    if q == b'`' && i + 1 < b.len() && b[i + 1] == b'`' { i += 2; continue; }
                    i += 1; closed = true; break;
                }
                i += if b[i] >= 0x80 { src[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
            }
            if !closed { errs.push(sp(line, col, "Unterminated string or backtick in Cypher")); }
            else { toks.push(CTok { kind, start, end: i, line, col }); }
            continue;
        }
        if b[i] == b'$' {
            let start = i; i += 1;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_') { i += 1; }
            toks.push(CTok { kind: CK::Param, start, end: i, line, col });
            continue;
        }
        if b[i].is_ascii_digit() {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'.' || b[i] == b'_') { i += 1; }
            toks.push(CTok { kind: CK::Num, start, end: i, line, col });
            continue;
        }
        if b[i].is_ascii_alphabetic() || b[i] == b'_' || (b[i] >= 0x80 && src[i..].chars().next().is_some_and(char::is_alphabetic)) {
            let start = i;
            while i < b.len() {
                if b[i].is_ascii_alphanumeric() || b[i] == b'_' { i += 1; }
                else if b[i] >= 0x80 {
                    let ch = src[i..].chars().next().unwrap_or('\0');
                    if ch.is_alphanumeric() { i += ch.len_utf8(); } else { break; }
                } else { break; }
            }
            toks.push(CTok { kind: CK::Word, start, end: i, line, col });
            continue;
        }
        let two = src.get(i..i + 2).unwrap_or("");
        if matches!(two, "->" | "<-" | "<>" | "!=" | "<=" | ">=" | "=~" | "+=" | "..") {
            toks.push(CTok { kind: CK::Op, start: i, end: i + 2, line, col });
            i += 2;
            continue;
        }
        let kind = match b[i] {
            b'(' => CK::LP, b')' => CK::RP, b'[' => CK::LB, b']' => CK::RB,
            b'{' => CK::LC, b'}' => CK::RC, b',' => CK::Comma, b';' => CK::Semi,
            _ => CK::Op,
        };
        let step = if b[i] >= 0x80 { src[i..].chars().next().map_or(1, char::len_utf8) } else { 1 };
        toks.push(CTok { kind, start: i, end: i + step, line, col });
        i += step;
    }
    (toks, errs)
}

fn check_cypher_delims(toks: &[CTok], errs: &mut Vec<ErrorSpan>) {
    let mut stack = Vec::new();
    for t in toks {
        match t.kind {
            CK::LP => stack.push((CK::RP, t.line, t.col)),
            CK::LB => stack.push((CK::RB, t.line, t.col)),
            CK::LC => stack.push((CK::RC, t.line, t.col)),
            CK::RP | CK::RB | CK::RC if stack.pop().is_none_or(|(e, _, _)| e != t.kind) => {
                errs.push(sp(t.line, t.col, "Mismatched closing delimiter in Cypher"));
            }
            _ => {}
        }
    }
    while let Some((e, l, c)) = stack.pop() {
        let ch = match e { CK::RP => '(', CK::RB => '[', _ => '{' };
        errs.push(sp(l, c, format!("Unclosed '{ch}' in Cypher")));
    }
}

fn split_semi(toks: &[CTok]) -> Vec<&[CTok]> {
    let (mut out, mut start, mut d) = (Vec::new(), 0usize, 0usize);
    for (i, t) in toks.iter().enumerate() {
        match t.kind {
            CK::LP | CK::LB | CK::LC => d += 1,
            CK::RP | CK::RB | CK::RC => d = d.saturating_sub(1),
            CK::Semi if d == 0 => { if start < i { out.push(&toks[start..i]); } start = i + 1; }
            _ => {}
        }
    }
    if start < toks.len() { out.push(&toks[start..]); }
    out
}

fn split_union<'a>(stmt: &'a [CTok], src: &str) -> Vec<&'a [CTok]> {
    let (mut out, mut start, mut d, mut i) = (Vec::new(), 0usize, 0usize, 0usize);
    while i < stmt.len() {
        match stmt[i].kind {
            CK::LP | CK::LB | CK::LC => d += 1,
            CK::RP | CK::RB | CK::RC => d = d.saturating_sub(1),
            CK::Word if d == 0 && stmt[i].kw(src, "UNION") => {
                out.push(&stmt[start..i]);
                i += 1;
                if stmt.get(i).is_some_and(|n| n.kw(src, "ALL")) { i += 1; }
                start = i;
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    if start <= stmt.len() { out.push(&stmt[start..]); }
    out
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum CState { Start, MatchLike, Merge, With, Call, Yield, Mutate, Return, PostReturn }

fn validate_segment(seg: &[CTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    if seg.is_empty() { return; }
    let mut clauses: Vec<(&str, &[CTok])> = Vec::new();
    let mut d = 0usize;
    let mut i = 0usize;
    let mut cur_name: Option<&str> = None;
    let mut cur_start = 0usize;

    while i < seg.len() {
        let t = &seg[i];
        match t.kind {
            CK::LP | CK::LB | CK::LC => d += 1,
            CK::RP | CK::RB | CK::RC => d = d.saturating_sub(1),
            CK::Word if d == 0 && !(i > 0 && matches!(seg[i - 1].sl(src), "." | ":")) => {
                if let Some((cname, adv)) = match_clause_kw(seg, i, src) {
                    if let Some(prev) = cur_name {
                        clauses.push((prev, &seg[cur_start..i]));
                    } else if i > 0 {
                        errs.push(sp(seg[0].line, seg[0].col, "Cypher query must start with a valid clause"));
                    }
                    cur_name = Some(cname);
                    cur_start = i + adv;
                    i += adv;
                    continue;
                }
            }
            _ => {}
        }
        i += 1;
    }
    if let Some(prev) = cur_name { clauses.push((prev, &seg[cur_start..])); }
    else { errs.push(sp(seg[0].line, seg[0].col, "Invalid Cypher query: missing clause")); return; }

    let mut state = CState::Start;
    for (idx, (cname, body)) in clauses.iter().enumerate() {
        let anchor = body.first().unwrap_or(&seg[0]);
        state = match (*cname, state) {
            ("MATCH" | "OPTIONAL MATCH" | "UNWIND" | "FOREACH", s) if s != CState::Return && s != CState::PostReturn => CState::MatchLike,
            ("CREATE", s) if s != CState::Return && s != CState::PostReturn => CState::Mutate,
            ("MERGE", s) if s != CState::Return && s != CState::PostReturn => CState::Merge,
            ("WITH", s) if s != CState::Return && s != CState::PostReturn => CState::With,
            ("CALL", s) if s != CState::Return && s != CState::PostReturn => CState::Call,
            ("YIELD", CState::Call) => CState::Yield,
            ("WHERE", CState::MatchLike | CState::With | CState::Yield) => CState::MatchLike,
            ("ON CREATE SET" | "ON MATCH SET", CState::Merge | CState::Mutate) => CState::Merge,
            ("SET" | "DELETE" | "DETACH DELETE" | "REMOVE", s) if !matches!(s, CState::Start | CState::Return | CState::PostReturn) => CState::Mutate,
            ("RETURN", s) if !matches!(s, CState::Start | CState::Return | CState::PostReturn) => CState::Return,
            ("ORDER BY" | "SKIP" | "LIMIT", CState::With) => CState::With,
            ("ORDER BY" | "SKIP" | "LIMIT", CState::Return | CState::PostReturn) => CState::PostReturn,
            _ => {
                errs.push(sp(anchor.line, anchor.col, format!("Invalid Cypher clause order at '{cname}'")));
                state
            }
        };
        if body.is_empty() && !(*cname == "CALL" && idx + 1 < clauses.len()) {
            errs.push(sp(anchor.line, anchor.col, format!("Empty Cypher '{cname}' clause")));
        }
        check_clause_ops(body, src, errs);
    }
}

fn match_clause_kw(seg: &[CTok], i: usize, src: &str) -> Option<(&'static str, usize)> {
    let t = &seg[i];
    if t.kw(src, "OPTIONAL") && seg.get(i + 1).is_some_and(|n| n.kw(src, "MATCH")) { return Some(("OPTIONAL MATCH", 2)); }
    if t.kw(src, "DETACH") && seg.get(i + 1).is_some_and(|n| n.kw(src, "DELETE")) { return Some(("DETACH DELETE", 2)); }
    if t.kw(src, "ORDER") && seg.get(i + 1).is_some_and(|n| n.kw(src, "BY")) { return Some(("ORDER BY", 2)); }
    if t.kw(src, "ON") && seg.get(i + 1).is_some_and(|n| n.kw(src, "CREATE")) && seg.get(i + 2).is_some_and(|n| n.kw(src, "SET")) { return Some(("ON CREATE SET", 3)); }
    if t.kw(src, "ON") && seg.get(i + 1).is_some_and(|n| n.kw(src, "MATCH")) && seg.get(i + 2).is_some_and(|n| n.kw(src, "SET")) { return Some(("ON MATCH SET", 3)); }
    for (kw, lbl) in [
        ("MATCH", "MATCH"), ("CREATE", "CREATE"), ("MERGE", "MERGE"), ("WHERE", "WHERE"),
        ("WITH", "WITH"), ("UNWIND", "UNWIND"), ("RETURN", "RETURN"), ("SET", "SET"),
        ("DELETE", "DELETE"), ("REMOVE", "REMOVE"), ("CALL", "CALL"), ("YIELD", "YIELD"),
        ("SKIP", "SKIP"), ("LIMIT", "LIMIT"), ("FOREACH", "FOREACH"),
    ] {
        if t.kw(src, kw) { return Some((lbl, 1)); }
    }
    None
}

fn check_clause_ops(body: &[CTok], src: &str, errs: &mut Vec<ErrorSpan>) {
    for (i, t) in body.iter().enumerate() {
        let is_bin_op = t.kind == CK::Op && matches!(t.sl(src), "=" | "<>" | "!=" | "<" | ">" | "<=" | ">=" | "=~" | "+=" | "/" | "%");
        let is_logic = t.kw(src, "AND") || t.kw(src, "OR") || t.kw(src, "XOR");
        if is_bin_op || is_logic {
            let next = body.get(i + 1);
            let prev = if i > 0 { Some(&body[i - 1]) } else { None };
            if next.is_none() || next.is_some_and(|n| n.kind == CK::Comma || n.kind == CK::RP || n.kw(src, "AND") || n.kw(src, "OR")) {
                errs.push(sp(t.line, t.col, format!("Dangling operator '{}' in Cypher", t.sl(src))));
            } else if prev.is_none() || prev.is_some_and(|p| p.kind == CK::Comma || p.kind == CK::LP) {
                errs.push(sp(t.line, t.col, format!("Missing left operand for '{}'", t.sl(src))));
            }
        }
    }
}
