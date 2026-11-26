use aice_lang_registry::LanguageId;
use crate::r5::snippet_ts_gen_ctx::{
    TsGenMemberCtx, has_assign_with_rhs_before_lt, is_valid_ts_ident,
    isolate_asi_tail_before_lt, stmt_starts_var_decl,
};
use crate::r5::snippet_ts_hdr::{is_only_ts_modifiers, strip_leading_ts_decorators};

pub(crate) fn pre_lt_has_cmp_ctx(pre_lt: &str, in_var_decl: bool) -> bool {
    let tail = isolate_asi_tail_before_lt(pre_lt, true, TsGenMemberCtx::None);
    if !in_var_decl && !stmt_starts_var_decl(tail) && has_assign_with_rhs_before_lt(tail) { return true; }
    let (b, mut i, mut pd, mut bd, mut cd) = (tail.as_bytes(), 0usize, 0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b',' if !in_var_decl && pd == 0 && bd == 0 && cd == 0 => return true,
            b'=' if pd == 0 && bd == 0 && cd == 0 && b.get(i + 1) == Some(&b'>') => return true,
            c if pd == 0 && bd == 0 && cd == 0 && is_id(c) => {
                let start = i;
                while i < b.len() && is_id(b[i]) { i += 1; }
                if matches!(&tail[start..i], "return" | "throw" | "yield" | "await" | "case" | "if" | "while" | "else" | "for") { return true; }
                continue;
            }
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn is_valid_ts_type_param_head(param: &str) -> bool {
    let mut head = param.trim();
    let (b, mut i, mut pd, mut bd, mut cd, mut ad) = (head.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    let is_id = |c: u8| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$');
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if b.get(i + 1) == Some(&b'=') { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => { head = head[..i].trim(); break; }
            b'e' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b[i..].starts_with(b"extends")
                && (i == 0 || !is_id(b[i - 1])) && b.get(i + 7).is_none_or(|&c| !is_id(c)) => { head = head[..i].trim(); break; }
            _ => {}
        }
        i += 1;
    }
    let mut words = head.split_whitespace().peekable();
    while words.peek().is_some_and(|w| matches!(*w, "const" | "in" | "out")) { words.next(); }
    words.next().is_some_and(is_valid_ts_ident) && words.next().is_none()
}

pub(crate) fn all_depth0_params_valid(params: &str) -> bool {
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut start) = (params.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if b.get(i + 1) == Some(&b'=') { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b',' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                if !is_valid_ts_type_param_head(&params[start..i]) { return false; }
                start = i + 1;
            }
            _ => {}
        }
        i += 1;
    }
    is_valid_ts_type_param_head(&params[start..])
}

pub(crate) fn has_ts_type_signal(after_lt: &str, attached: bool, allow_ambig_ident: bool, allow_ambig_lit: bool) -> bool {
    let inner = after_lt.trim_end().strip_suffix(',').unwrap_or(after_lt);
    if allow_ambig_lit && inner.split(',').any(|a| a.trim() == "\"_\"") { return true; }
    let is_strong_kw = |w: &str| matches!(
        w,
        "string" | "number" | "boolean" | "unknown" | "never" | "any" | "void"
            | "object" | "symbol" | "bigint" | "undefined" | "null" | "readonly" | "keyof" | "typeof" | "infer"
    );
    let is_pascal = |w: &str| w.bytes().next().is_some_and(|c| c.is_ascii_uppercase()) && w.bytes().any(|c| c.is_ascii_lowercase());
    let is_single_upper_gen = |w: &str| attached && w.len() == 1 && w.as_bytes()[0].is_ascii_uppercase();
    let is_ambig_ident = |w: &str| attached && w.bytes().next().is_some_and(|c| c.is_ascii_uppercase());
    let is_ambig_lit = |w: &str| matches!(w, "true" | "false" | "this") || (!w.is_empty() && w.bytes().all(|c| c.is_ascii_digit()));
    after_lt.contains("[]") || after_lt.contains("=>")
        || after_lt.as_bytes().iter().any(|&c| matches!(c, b'|' | b'&' | b'{' | b':' | b'>'))
        || after_lt.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).any(|w| {
            is_strong_kw(w) || is_pascal(w) || is_single_upper_gen(w)
                || (allow_ambig_ident && is_ambig_ident(w))
                || (allow_ambig_lit && is_ambig_lit(w))
        })
}
pub(crate) fn ts_paren_type_ok(after: &str) -> bool {
    after.contains("[]") || after.contains("=>")
        || after.as_bytes().iter().any(|&c| matches!(c, b'|' | b'&' | b'{' | b':' | b'>'))
        || after.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).any(|w| {
            matches!(w, "string" | "number" | "boolean" | "unknown" | "never" | "any" | "void"
                | "object" | "symbol" | "bigint" | "undefined" | "null" | "readonly" | "keyof" | "typeof" | "infer")
                || (w.len() == 1 && w.as_bytes()[0].is_ascii_uppercase())
        })
}
pub(crate) fn prev_is_ctrl_hdr(prev: &str) -> bool {
    let t = prev.trim();
    let is_id = |c: char| c.is_ascii_alphanumeric() || matches!(c, '_' | '$');
    if t == "else" || (t.ends_with("else") && t[..t.len() - 4].ends_with(|c: char| !is_id(c))) {
        return true;
    }
    if !t.ends_with(')') { return false; }
    let b = t.as_bytes();
    let (mut i, mut pd) = (b.len(), 0usize);
    while i > 0 {
        i -= 1;
        if b[i] == b')' { pd += 1; }
        else if b[i] == b'(' {
            pd -= 1;
            if pd == 0 {
                let pre = t[..i].trim_end();
                let kw = pre.rsplit(|c: char| !is_id(c)).next().unwrap_or("");
                let before_kw = pre[..pre.len() - kw.len()].trim_end();
                if before_kw.ends_with('.') { return false; }
                return matches!(kw, "if" | "while" | "for")
                    || (kw == "await" && before_kw.rsplit(|c: char| !is_id(c)).next() == Some("for"));
            }
        }
    }
    false
}

pub(crate) fn is_ts_asi_frame_reset(prev_raw: &str, rest_raw: &str, member_ctx: TsGenMemberCtx) -> bool {
    let rest = rest_raw.trim_start_matches([' ', '\t']);
    if rest.is_empty() || rest.starts_with('\n') { return false; }
    let prev = prev_raw.trim();
    let dec_rest = strip_leading_ts_decorators(prev);
    let prev_incomplete = prev.is_empty()
        || dec_rest.is_empty()
        || is_only_ts_modifiers(dec_rest, member_ctx.is_class_or_type())
        || prev_is_ctrl_hdr(prev)
        || prev.ends_with(['=', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', ',', '(', '[', '<', '.'])
        || prev.ends_with("=>");
    if prev_incomplete { return false; }
    let last_w = prev.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    let is_member_prop = !last_w.is_empty() && {
        let before = prev[..prev.len() - last_w.len()].trim_end();
        (before.ends_with('.') && !before.ends_with("..")) || before.ends_with('#')
    };
    if !is_member_prop && matches!(last_w,
        "extends" | "implements" | "keyof" | "typeof" | "infer" | "readonly" | "unique"
            | "in" | "out" | "const" | "let" | "var" | "return" | "throw" | "yield" | "await"
            | "new" | "delete" | "void" | "case" | "of" | "instanceof" | "as" | "satisfies"
            | "is" | "asserts" | "import" | "export" | "default" | "function" | "class" | "interface" | "type" | "abstract" | "async"
    ) { return false; }
    if matches!(rest.as_bytes()[0],
        b'.' | b',' | b';' | b')' | b']' | b'}' | b'<' | b'>' | b'?' | b':' | b'=' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'(' | b'['
    ) { return false; }
    let next_w = rest.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    !matches!(next_w, "extends" | "implements" | "in" | "out" | "instanceof" | "as" | "satisfies" | "is" | "of")
}

pub(crate) fn ts_anon_generic_ok(pre: &str) -> bool {
    if crate::r5::snippet_ts_gen_ctx::before_lt_allows_anon_generic(pre) { return true; }
    let t = pre.trim_end();
    let w = t.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    w == "else" && {
        let bt = t[..t.len() - 4].trim_end();
        !(bt.ends_with('.') && !bt.ends_with("..")) && !bt.ends_with('#')
    }
}
pub(crate) fn ts_generic_default_ok(pre_lt: &str, attached: bool, member_ctx: TsGenMemberCtx) -> bool {
    crate::r5::snippet_ts_gen_ctx::allows_generic_default_before_lt(pre_lt, attached, member_ctx)
        || (member_ctx == TsGenMemberCtx::None && !attached && (ts_anon_generic_ok(pre_lt) || prev_is_ctrl_hdr(pre_lt)))
}

pub(crate) fn is_ts_for_of_hdr(bt: &str) -> bool {
    let (b, mut pd, mut bd, mut cd) = (bt.as_bytes(), 0usize, 0usize, 0usize);
    let mut i = b.len();
    while i > 0 {
        i -= 1;
        match b[i] {
            b')' => pd += 1,
            b'(' if pd == 0 && bd == 0 && cd == 0 => {
                let pre = bt[..i].trim_end();
                let kw = pre.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
                let bk = pre[..pre.len() - kw.len()].trim_end();
                let not_mem = |s: &str| !(s.ends_with('.') && !s.ends_with("..")) && !s.ends_with('#');
                let is_for = (kw == "for" && not_mem(bk))
                    || (kw == "await"
                        && bk.strip_suffix("for").is_some_and(|bf| {
                            bf.bytes().next_back().is_none_or(|c| !c.is_ascii_alphanumeric() && !matches!(c, b'_' | b'$'))
                                && not_mem(bf.trim_end())
                        }));
                return is_for && !has_depth0_assign_or_type_colon(&bt[i + 1..]);
            }
            b'(' => pd -= 1,
            b']' => bd += 1, b'[' if bd > 0 => bd -= 1, b'[' => return false,
            b'}' => cd += 1, b'{' if cd > 0 => cd -= 1, b'{' => return false,
            b';' if pd == 0 && bd == 0 && cd == 0 => return false,
            _ => {}
        }
    }
    false
}

pub(crate) fn has_depth0_non_method_op(s: &str) -> bool {
    let (b, mut i, mut pd, mut bd, mut cd, mut ad) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if b.get(i + 1) == Some(&b'=') { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b':' | b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => return true,
            b'&' | b'|' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) == Some(&b[i]) => return true,
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn has_depth0_assign_or_type_colon(s: &str) -> bool {
    let (b, mut i, mut pd, mut bd, mut cd, mut ad, mut saw_q) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize, false);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b'?' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b'.') => saw_q = true,
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => {
                if saw_q { saw_q = false; } else { return true; }
            }
            b'=' if pd == 0 && bd == 0 && cd == 0 && ad == 0 => {
                let (prev, next) = (i.checked_sub(1).and_then(|k| b.get(k)).copied(), b.get(i + 1).copied());
                if !matches!(prev, Some(b'=' | b'!' | b'<' | b'>')) && !matches!(next, Some(b'=' | b'>')) { return true; }
            }
            _ => {}
        }
        i += 1;
    }
    false
}

pub(crate) fn is_js_invalid_iface_hdr_in(lang: LanguageId, hdr: &[&str], in_class: bool) -> bool {
    if lang != LanguageId::JavaScript { return false; }
    let raw_hdr = hdr.join("\n");
    let clean = if in_class && raw_hdr.contains(['"', '\'', '`']) {
        crate::r5::snippet_ts_cls::clean_ts_preserving_quoted_method_lt(&raw_hdr, TsGenMemberCtx::None)
    } else {
        crate::r5::snippet_synth::strip_comments_strings(lang, &raw_hdr, true)
    };
    let pre = crate::r5::snippet_hdr::trim_after_last_sep(&clean).trim();
    let pre = crate::r5::snippet_ts_type::tail_after_depth0_comma(pre.strip_suffix('{').unwrap_or(pre).trim()).trim();
    let mut rem = crate::r5::snippet_synth::js_last_asi_stmt(pre, in_class).trim();
    fn peel<'a>(s: &'a str, kw: &str) -> Option<&'a str> { s.strip_prefix(kw).filter(|r| r.starts_with(char::is_whitespace)).map(str::trim_start) }
    if in_class {
        rem = peel(rem, "static").unwrap_or(rem);
        if let Some(r) = peel(rem, "async") && !r.starts_with(['(', '=']) { rem = r; }
    } else if let Some(r) = peel(rem, "export") { rem = peel(r, "default").unwrap_or(r); }
    if let Some(r) = peel(rem, "declare") {
        let w = r.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        return (!w.is_empty() && !matches!(w, "in" | "instanceof" | "of")) || (in_class && r.starts_with(['#', '[', '*', '"']));
    }
    if let Some(before_col) = rem.strip_suffix(':').map(str::trim_end) {
        let first_w = before_col.split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        return (in_class && !has_depth0_assign_or_type_colon(before_col) && !before_col.contains('?'))
            || (!in_class && matches!(first_w, "const" | "let" | "var") && before_col.len() > first_w.len());
    }
    let kl = rem.bytes().take_while(|c| c.is_ascii_alphanumeric() || matches!(c, b'_' | b'$')).count();
    let (kw, after) = (&rem[..kl], rem[kl..].trim_start());
    if in_class && matches!(kw, "readonly" | "private" | "public" | "protected" | "override" | "abstract") {
        return !after.is_empty() && !after.starts_with(['(', '=']);
    }
    let next_id = after.bytes().next().is_some_and(|c| c.is_ascii_alphabetic() || matches!(c, b'_' | b'$'));
    matches!(kw, "interface" | "namespace" | "module" | "abstract") && next_id
}
