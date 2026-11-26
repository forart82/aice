use crate::r5::{snippet_ts_gen_chk::prev_is_ctrl_hdr, snippet_ts_hdr::{is_balanced_computed_prop, is_only_ts_modifiers, peel_ts_method_modifiers, skip_balanced_delim, strip_leading_ts_decorators}};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TsGenMemberCtx { None, ClassOrType, IfaceType, ObjBrace }
impl TsGenMemberCtx { pub(crate) fn is_class_or_type(self) -> bool { matches!(self, Self::ClassOrType | Self::IfaceType) } }

pub(crate) fn before_lt_allows_anon_generic(pre: &str) -> bool {
    let t = pre.trim_end();
    if t.is_empty() || t.ends_with(['=', '(', '[', ',', ':', ';', '?']) || t.ends_with("=>") { return true; }
    let mut words = t.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).filter(|w| !w.is_empty()).rev();
    match words.next().unwrap_or("") {
        "function" | "class" | "interface" | "type" | "return" => true,
        "async" => !matches!(words.next(), Some("export" | "declare")),
        "default" => words.next() == Some("export"),
        _ => false,
    }
}

pub(crate) fn last_depth0_assign_pos(s: &str) -> Option<usize> {
    let (b, mut pd, mut bd, mut cd, mut last_eq) = (s.as_bytes(), 0usize, 0usize, 0usize, None);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 && !matches!(i.checked_sub(1).and_then(|k| b.get(k)).copied(), Some(b'=' | b'!' | b'<' | b'>')) && !matches!(b.get(i + 1).copied(), Some(b'=' | b'>')) => last_eq = Some(i),
            _ => {}
        }
    }
    last_eq
}

pub(crate) fn has_assign_with_rhs_before_lt(pre_lt: &str) -> bool {
    let tail = isolate_asi_tail_before_lt(pre_lt, true, TsGenMemberCtx::None);
    last_depth0_assign_pos(tail).is_some_and(|p| !tail[p + 1..].trim().is_empty())
}

pub(crate) fn stmt_starts_var_decl(s: &str) -> bool {
    let mut rem = isolate_asi_tail_before_lt(s, true, TsGenMemberCtx::None).trim_start();
    loop {
        let w = rem.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        if matches!(w, "export" | "declare") { rem = rem[w.len()..].trim_start(); continue; }
        return matches!(w, "const" | "let" | "var");
    }
}

pub(crate) fn is_single_lower_ident(pre: &str) -> bool {
    let callee = pre.trim_end().rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    callee.len() == 1 && callee.as_bytes()[0].is_ascii_lowercase()
}

pub(crate) fn pre_lt_has_heritage_kw(pre_lt: &str) -> bool {
    let prefix = pre_lt.trim_end().trim_end_matches(|c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '$' | '.'));
    prefix.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$'))
        .rfind(|w| !w.is_empty()).is_some_and(|w| matches!(w, "extends" | "implements"))
}
fn split_words_and_star(s: &str) -> Option<Vec<&str>> {
    let mut toks = Vec::new();
    let (b, mut i) = (s.as_bytes(), 0usize);
    while i < b.len() {
        if b[i].is_ascii_whitespace() { i += 1; }
        else if b[i] == b'*' { toks.push("*"); i += 1; }
        else if b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$') {
            let start = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || matches!(b[i], b'_' | b'$')) { i += 1; }
            toks.push(&s[start..i]);
        } else { return None; }
    }
    Some(toks)
}

pub(crate) fn is_valid_ts_num_member(w: &str) -> bool {
    let b = w.as_bytes();
    if b.is_empty() || b.ends_with(b"_") { return false; }
    if let Some((r, hex)) = w.strip_prefix("0x").or_else(|| w.strip_prefix("0X")).map(|r| (r, true))
        .or_else(|| w.strip_prefix("0b").or_else(|| w.strip_prefix("0B")).map(|r| (r, false)))
    { return !r.is_empty() && !r.starts_with('_') && r.bytes().all(|c| c == b'_' || if hex { c.is_ascii_hexdigit() } else { matches!(c, b'0' | b'1') }); }
    if let Some(r) = w.strip_prefix("0o").or_else(|| w.strip_prefix("0O")) { return !r.is_empty() && !r.starts_with('_') && r.bytes().all(|c| matches!(c, b'0'..=b'7' | b'_')); }
    if !b[0].is_ascii_digit() && !(b[0] == b'.' && b.get(1).is_some_and(u8::is_ascii_digit)) { return false; }
    let (m, exp) = w.split_once(['e', 'E']).map_or((w, None), |(a, e)| (a, Some(e)));
    m.bytes().filter(|&c| c == b'.').count() <= 1 && m.bytes().all(|c| c.is_ascii_digit() || matches!(c, b'.' | b'_'))
        && exp.is_none_or(|e| { let e = e.strip_prefix(['+', '-']).unwrap_or(e); !e.is_empty() && !e.starts_with('_') && e.bytes().all(|c| c.is_ascii_digit() || c == b'_') })
}
pub(crate) fn is_valid_ts_ident(w: &str) -> bool {
    !w.is_empty() && w.bytes().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$')) && w.bytes().all(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$'))
}
fn is_valid_ts_member_ident(w: &str, member_ctx: TsGenMemberCtx) -> bool {
    let bare = if member_ctx.is_class_or_type() { w.strip_prefix('#').unwrap_or(w) } else { w };
    is_valid_ts_ident(bare) && !(member_ctx == TsGenMemberCtx::None && matches!(bare, "as" | "satisfies" | "implements"))
        && !matches!(bare, "if" | "for" | "while" | "switch" | "catch" | "return" | "throw" | "new" | "typeof" | "void" | "delete" | "else" | "export" | "import" | "extends" | "in" | "instanceof" | "of")
}
fn is_ts_decl_or_mod_start(s: &str, member_ctx: TsGenMemberCtx, attached: bool) -> bool {
    let trimmed_raw = s.trim_start();
    let mut t = strip_leading_ts_decorators(trimmed_raw).trim_start();
    if trimmed_raw.starts_with('@') && member_ctx.is_class_or_type() { t = t.strip_prefix('*').unwrap_or(t).trim_start(); }
    if t.is_empty() { return false; }
    if member_ctx != TsGenMemberCtx::None && is_valid_ts_num_member(t.trim_end()) { return true; }
    if t.as_bytes()[0].is_ascii_digit() || matches!(t.as_bytes()[0], b'+' | b'-' | b'/' | b'%' | b'&' | b'|' | b'^' | b'=' | b'?' | b':' | b',' | b'.' | b')' | b']' | b'}') { return false; }
    if member_ctx != TsGenMemberCtx::None {
        if member_ctx.is_class_or_type() && let Some(rest) = t.strip_prefix('#') && is_valid_ts_ident(rest.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("")) { return true; }
        if t.starts_with('[') && let Some(end) = skip_balanced_delim(t.as_bytes(), 0, b'[', b']') && (t[end..].trim().is_empty() || t[end..].trim_start().starts_with('<')) { return true; }
    }
    let first = t.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    if matches!(first, "export" | "declare" | "abstract" | "async" | "function" | "class" | "interface" | "type" | "return" | "throw" | "yield" | "await" | "const" | "let" | "var") { return true; }
    (attached || member_ctx != TsGenMemberCtx::None) && (is_valid_ts_member_ident(first, member_ctx) || (member_ctx != TsGenMemberCtx::None && t.trim_end() == first && is_valid_ts_ident(first)))
}
pub(crate) fn ends_with_ts_cont_kw(prev: &str, allow_bare: bool) -> bool {
    let kw = prev.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    let Some(before) = prev.strip_suffix(kw).map(str::trim_end) else { return false; };
    !kw.is_empty() && !before.ends_with('.')
        && (matches!(kw, "extends" | "implements" | "in" | "instanceof")
            || ((allow_bare || !before.is_empty()) && matches!(kw, "keyof" | "infer"))
            || (!before.is_empty() && !before.ends_with(['=', '(', '[', ',', ':', ';', '?']) && !before.ends_with("=>")
                && matches!(kw, "as" | "satisfies" | "is" | "of")))
}
pub(crate) fn isolate_asi_tail_before_lt(pre_lt: &str, attached: bool, member_ctx: TsGenMemberCtx) -> &str {
    let (b, mut pd, mut bd, mut cd, mut last) = (pre_lt.as_bytes(), 0usize, 0usize, 0usize, 0usize);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 => {
                let prev = pre_lt[last..i].trim();
                let dec_rest = strip_leading_ts_decorators(prev);
                let prev_inc = prev.is_empty() || dec_rest.is_empty() || is_only_ts_modifiers(dec_rest, true)
                    || prev_is_ctrl_hdr(prev) || prev.ends_with("=>") || ends_with_ts_cont_kw(prev, member_ctx == TsGenMemberCtx::None)
                    || prev.ends_with(['=', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', ',', '(', '[', '<', '.']);
                if !prev_inc && (is_ts_decl_or_mod_start(&pre_lt[i + 1..], member_ctx, attached)
                    || (member_ctx == TsGenMemberCtx::IfaceType && !attached && pre_lt[i + 1..].trim().is_empty())) { last = i + 1; }
            }
            _ => {}
        }
    }
    &pre_lt[last..]
}

pub(crate) fn last_expr_rhs_slice(s: &str, check_kw: bool) -> (bool, &str) {
    let (b, mut i, mut pd, mut bd, mut cd, mut cut) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, None);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if next == Some(b'>') { cut = Some(i + 2); i += 2; continue; }
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && next != Some(b'=') { cut = Some(i + 1); }
            }
            b'?' if pd == 0 && bd == 0 && cd == 0 => {
                if b.get(i + 1) == Some(&b'?') { cut = Some(i + 2); i += 2; continue; }
                if b.get(i + 1) != Some(&b'.') { cut = Some(i + 1); }
            }
            b':' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => cut = Some(i + 1),
            b'&' | b'|' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) == Some(&b[i]) => { cut = Some(i + 2); i += 2; continue; }
            _ => {}
        }
        i += 1;
    }
    if let Some(p) = cut { return (true, &s[p..]); }
    if check_kw {
        let t = s.trim_start();
        for kw in ["return", "throw", "yield", "await"] {
            if let Some(rest) = t.strip_prefix(kw) && (rest.is_empty() || rest.as_bytes()[0].is_ascii_whitespace()) { return (true, rest); }
        }
    }
    (false, s)
}

fn is_ts_param_lhs(lhs: &str) -> bool {
    let l = lhs.trim().strip_suffix('?').unwrap_or(lhs.trim()).trim_end();
    let l = l.strip_prefix("...").unwrap_or(l).trim_start();
    if l.ends_with(['}', ']']) { return true; }
    let mut ws = l.split_whitespace();
    while let Some(w) = ws.next() {
        if matches!(w, "public" | "private" | "protected" | "readonly" | "override") { continue; }
        return is_valid_ts_ident(w) && ws.next().is_none();
    }
    false
}
pub(crate) fn ts_type_pos_tail(cur: &str, member_ctx: TsGenMemberCtx) -> Option<&str> { ts_type_pos_tail_in(cur, member_ctx, false, false) }
pub(crate) fn ts_type_pos_tail_in(cur: &str, member_ctx: TsGenMemberCtx, in_type_delim: bool, in_val_paren: bool) -> Option<&str> {
    if member_ctx == TsGenMemberCtx::ObjBrace { return None; }
    let (b, mut i, mut pd, mut bd, mut cd, mut ad) = (cur.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    let (mut col, mut eq, mut saw_q) = (None::<usize>, None::<usize>, None::<usize>);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b'.') => saw_q = Some(i),
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => {
                if let Some(q) = saw_q.take() && !cur[q + 1..i].trim().is_empty() {} else if col.is_none() { col = Some(i); }
            }
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if next == Some(b'>') {
                    if let Some(c) = col && member_ctx == TsGenMemberCtx::None && cur[..c].trim_end().ends_with(')') { return None; }
                    i += 2; continue;
                }
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && next != Some(b'=') {
                    if col.is_some() { return None; }
                    if eq.is_none() { eq = Some(i); }
                }
            }
            _ => {}
        }
        i += 1;
    }
    let is_type_alias = member_ctx == TsGenMemberCtx::None && eq.is_some() && cur
        .split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$'))
        .find(|w| !w.is_empty() && !matches!(*w, "export" | "declare")) == Some("type");
    let start = if is_type_alias { eq? + 1 } else if let Some(c) = col {
        let lhs = &cur[..c];
        if member_ctx.is_class_or_type() || in_type_delim || stmt_starts_var_decl(lhs) || lhs.trim_end().ends_with(')') || (in_val_paren && is_ts_param_lhs(lhs)) { c + 1 } else { return None; }
    } else if in_type_delim && eq.is_none() { 0 } else { return None; };
    let expr = &cur[start..];
    let (eb, mut j, mut cut, mut e_ad, mut e_cd) = (expr.as_bytes(), 0usize, 0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while j < eb.len() {
        match eb[j] {
            b'{' => e_cd += 1, b'}' => e_cd = e_cd.saturating_sub(1),
            b'<' if e_cd == 0 => { if matches!(eb.get(j + 1), Some(b'=' | b'<')) { j += 2; continue; } e_ad += 1; }
            b'>' if e_cd == 0 && (j == 0 || !matches!(eb[j - 1], b'-' | b'=')) => e_ad = e_ad.saturating_sub(1),
            b'=' if e_cd == 0 && e_ad == 0 && eb.get(j + 1) == Some(&b'>') => { cut = j + 2; j += 2; continue; }
            b'|' | b'&' | b'(' | b'[' | b',' | b'?' | b':' if e_cd == 0 && e_ad == 0 => cut = j + 1,
            b'e' if e_cd == 0 && e_ad == 0 && eb[j..].starts_with(b"extends")
                && (j == 0 || !is_id(eb[j - 1])) && eb.get(j + 7).is_none_or(|&c| !is_id(c)) => { cut = j + 7; j += 7; continue; }
            _ => {}
        }
        j += 1;
    }
    Some(expr[cut..].trim())
}
pub(crate) fn is_ts_type_param_head_tail(t_tail: &str) -> bool {
    let mut ws = t_tail.split_whitespace();
    matches!((ws.next(), ws.next(), ws.next()), (None, ..) | (Some("new" | "readonly"), None, _) | (Some("abstract"), Some("new"), None))
}
pub(crate) fn is_invalid_ts_type_pos_lt(pre_lt: &str, member_ctx: TsGenMemberCtx, in_type_delim: bool, in_val_paren: bool, has_def_ext: bool, has_comma_tail: bool, after_lt_empty: bool) -> Option<bool> {
    let attached = pre_lt.len() == pre_lt.trim_end().len();
    let cur = if member_ctx == TsGenMemberCtx::ObjBrace { pre_lt.trim_end() } else { isolate_asi_tail_before_lt(pre_lt, attached, member_ctx).trim_end() };
    let t_tail = ts_type_pos_tail_in(cur, member_ctx, in_type_delim, in_val_paren)?;
    if t_tail.ends_with([')', ']']) { return Some(true); }
    let ws: Vec<&str> = t_tail.split_whitespace().collect();
    if ws.is_empty() { return Some(!has_def_ext); }
    if matches!(ws.as_slice(), ["new"] | ["abstract", "new"] | ["readonly"]) { return Some(!has_def_ext || has_comma_tail || after_lt_empty); }
    if ws.len() >= 2 || has_def_ext { return Some(true); }
    Some(ws[0].ends_with('*') || matches!(ws[0], "const" | "typeof" | "keyof" | "infer" | "abstract" | "readonly" | "new"
        | "any" | "boolean" | "never" | "number" | "object" | "string" | "symbol" | "undefined" | "unique" | "unknown" | "void"
        | "function" | "class" | "interface" | "import" | "export" | "declare" | "return" | "throw" | "yield" | "delete" | "else" | "case" | "default"))
}
pub(crate) fn allows_generic_default_before_lt(pre_lt: &str, attached: bool, member_ctx: TsGenMemberCtx) -> bool { allows_generic_default_before_lt_in(pre_lt, attached, member_ctx, false, false) }
pub(crate) fn allows_generic_default_before_lt_in(pre_lt: &str, attached: bool, member_ctx: TsGenMemberCtx, in_type_delim: bool, in_val_paren: bool) -> bool {
    let cur = if member_ctx == TsGenMemberCtx::ObjBrace { pre_lt } else { isolate_asi_tail_before_lt(pre_lt, attached, member_ctx) };
    if let Some(t_tail) = ts_type_pos_tail_in(cur, member_ctx, in_type_delim, in_val_paren) { return is_ts_type_param_head_tail(t_tail); }
    let (has_expr_prefix, rhs_raw) = last_expr_rhs_slice(cur, member_ctx == TsGenMemberCtx::None);
    let rhs = strip_leading_ts_decorators(rhs_raw.trim());
    if has_expr_prefix {
        if rhs.is_empty() { return !attached; }
        let Some(toks) = split_words_and_star(rhs) else { return false; };
        if toks.is_empty() { return false; }
        if !attached && toks == ["async"] { return true; }
        let mut idx = usize::from(toks.first() == Some(&"async"));
        if toks.get(idx) == Some(&"function") {
            idx += 1 + usize::from(toks.get(idx + 1) == Some(&"*"));
            return idx == toks.len() || (idx + 1 == toks.len() && is_valid_ts_ident(toks[idx]));
        }
        return idx == 0 && toks.first() == Some(&"class") && (toks.len() == 1 || (toks.len() == 2 && is_valid_ts_ident(toks[1])));
    }
    if !attached && member_ctx == TsGenMemberCtx::None { return before_lt_allows_anon_generic(cur); }
    if member_ctx == TsGenMemberCtx::None && let Some(toks) = split_words_and_star(rhs)
        && let Some(dk) = toks.iter().position(|w| matches!(*w, "function" | "class" | "interface" | "type"))
    {
        let mods_ok = toks[..dk].iter().all(|w| matches!(*w, "export" | "default" | "declare" | "abstract" | "async" | "*"));
        let r = &toks[dk + 1..];
        return mods_ok && (r.is_empty() || (toks[dk] == "function" && r == ["*"]) || (r.len() == 1 && is_valid_ts_ident(r[0])) || (toks[dk] == "function" && r.len() == 2 && r[0] == "*" && is_valid_ts_ident(r[1])));
    }
    if member_ctx == TsGenMemberCtx::None { return false; }
    if member_ctx == TsGenMemberCtx::IfaceType && rhs.is_empty() { return true; }
    let rem = peel_ts_method_modifiers(rhs, member_ctx.is_class_or_type());
    is_balanced_computed_prop(rem) || is_valid_ts_member_ident(rem, member_ctx) || is_valid_ts_num_member(rem) || is_valid_ts_ident(rem.strip_prefix('#').filter(|_| member_ctx.is_class_or_type()).unwrap_or(rem))
}
