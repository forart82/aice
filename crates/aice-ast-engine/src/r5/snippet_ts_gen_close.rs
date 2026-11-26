use aice_lang_registry::LanguageId;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_js_lex::{JsLexState, StepQuote};
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_type::has_depth0_assign_outside_angles;
pub(crate) use crate::r5::snippet_ts_gen::{ctx_needs_ts_generic_gt, has_ts_unclosed_lt_closed_without_gt};

fn is_direct_callee_obj_lt(lang: LanguageId, pre_lb: &str) -> bool {
    let pre = strip_comments_strings(lang, pre_lb, true);
    pre.trim_end().strip_suffix('<').map(str::trim_end).is_some_and(|p| {
        !p.ends_with('<')
            && ((p.ends_with(')') && crate::r5::snippet_ts_cast::has_matching_non_ctrl_paren(p))
                || (p.ends_with(']') && crate::r5::snippet_ts_cast::has_matching_open_bracket_at_end(p)))
    })
}

pub(crate) fn push_ts_generic_brace_cands(lang: LanguageId, joined: &str, closers: &str, cands: &mut Vec<String>) {
    if !matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) || !closers.contains('}')
        || !strip_comments_strings(lang, joined, false).contains('<') { return; }
    let mut stk = Vec::new();
    let (mut i, mut js, b) = (0usize, JsLexState::new(), joined.as_bytes());
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); i += 1; continue; }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote { continue; }
        if js.open_quote(lang, b, &mut i) { continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; }; i = a; continue; }
        if b[i] == b'{' { stk.push(i); } else if b[i] == b'}' { stk.pop(); }
        js.step_byte(lang, b, &mut i);
    }
    if let Some(&lb) = stk.last()
        && matches!(ts_refine_body_signals(lang, &joined[lb + 1..]), (true, ..) | (_, _, true, ..))
    {
        if is_direct_callee_obj_lt(lang, &joined[..lb]) {
            cands.push(format!("{joined}\n{closers}"));
            cands.push(format!("{joined}\n{closers};"));
            if let Some(p) = closers.find('}').filter(|&p| p > 0) {
                cands.push(format!("{joined}\n{};\n{}", &closers[..p], &closers[p..]));
            }
        }
        return;
    }
    let is_cast = stk.last().is_some_and(|&lb| crate::r5::snippet_ts_gen_ambig::is_ts_angle_cast_prefix(lang, &joined[..lb]));
    for (k, &ch) in closers.as_bytes()[..closers.len().min(4)].iter().enumerate() {
        if ch != b'}' { continue; }
        let (pre_c, post_c) = (&closers[..=k], &closers[k + 1..]);
        if post_c.is_empty() {
            for suf in [">();", ">;", ">", ">()", ">() => {};"] { cands.push(format!("{joined}\n{pre_c}{suf}")); }
            if is_cast { cands.push(format!("{joined}\n{pre_c}>_aice_;")); }
        } else {
            for sep in ["", "\n"] { cands.push(format!("{joined}\n{pre_c}>();{sep}{post_c}")); cands.push(format!("{joined}\n{pre_c}>(): any;{sep}{post_c}")); cands.push(format!("{joined}\n{pre_c}>() => {{}}{sep}{post_c};")); cands.push(format!("{joined}\n{pre_c}>(){sep}{post_c};")); cands.push(format!("{joined}\n{pre_c}>{sep}{post_c};")); }
            if is_cast { cands.push(format!("{joined}\n{pre_c}>_aice_;{post_c}")); cands.push(format!("{joined}\n{pre_c}>_aice_{post_c} {{}}")); }
        }
    }
}

pub(crate) fn is_ts_broken_paren_placeholder(rhs: &str) -> bool {
    let t = rhs.trim();
    t.starts_with('(') && t.ends_with(')') && t[1..t.len() - 1].trim().ends_with('*')
}

pub(crate) fn depth0_colon_pos(s: &str) -> Option<usize> {
    let (b, mut i, mut pd, mut bd, mut cd, mut ad) = (s.as_bytes(), 0usize, 0usize, 0usize, 0usize, 0usize);
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'<' if pd == 0 && bd == 0 && cd == 0 => { if matches!(b.get(i + 1), Some(b'=' | b'<')) { i += 2; continue; } ad += 1; }
            b'>' if pd == 0 && bd == 0 && cd == 0 && (i == 0 || !matches!(b[i - 1], b'-' | b'=')) => ad = ad.saturating_sub(1),
            b':' if pd == 0 && bd == 0 && cd == 0 && ad == 0 && b.get(i + 1) != Some(&b':') && (i == 0 || b[i - 1] != b':') => return Some(i),
            _ => {}
        }
        i += 1;
    }
    None
}

thread_local! { static TS_BODY_PARSERS: std::cell::RefCell<[Option<tree_sitter::Parser>; 2]> = const { std::cell::RefCell::new([None, None]) }; }

fn tree_has_err(n: tree_sitter::Node<'_>) -> bool {
    if n.is_error() || n.is_missing() { return true; }
    let mut c = n.walk();
    c.goto_first_child() && loop {
        if tree_has_err(c.node()) { break true; }
        if !c.goto_next_sibling() { break false; }
    }
}

fn type_probe_rejected(n: tree_sitter::Node<'_>, src: &str) -> bool {
    match n.kind() {
        "intersection_type" | "union_type" => {
            let want = if n.kind() == "union_type" { b"||" } else { b"&&" };
            let mut c = n.walk();
            if c.goto_first_child() { loop {
                let ch = c.node();
                if ch.kind() == n.kind() && ch.start_byte() >= 1 && src.as_bytes().get(ch.start_byte() - 1..=ch.start_byte()) == Some(want) { return true; }
                if !c.goto_next_sibling() { break; }
            } }
        }
        "function_type" => if let (Some(p), Some(r)) = (n.child_by_field_name("parameters"), n.child_by_field_name("return_type"))
            && p.named_child_count() == 0 && r.kind() == "literal_type" { return true; },
        "lookup_type" => if let (Some(b), Some(idx)) = (n.child(0), n.child(2)) && b.kind() == "type_identifier" && idx.kind() == "literal_type"
            && src.get(b.start_byte()..b.end_byte()).is_some_and(|t| t.as_bytes().first().is_some_and(u8::is_ascii_lowercase))
            && idx.child(0).is_some_and(|x| x.kind() == "number") { return true; },
        _ => {}
    }
    let mut c = n.walk();
    c.goto_first_child() && loop {
        if type_probe_rejected(c.node(), src) { break true; }
        if !c.goto_next_sibling() { break false; }
    }
}

fn dual_probe_ts_flags(lang: LanguageId, body_tail: &str, clean_body: Option<&str>, do_obj: bool, do_type: bool) -> (bool, bool) {
    let owned_clean;
    let clean = match clean_body { Some(c) => c, None => { owned_clean = strip_comments_strings(lang, body_tail, false); &owned_clean } };
    let mut stk = Vec::new();
    for &ch in clean.as_bytes() { match ch {
        b'(' | b'[' | b'{' => stk.push(ch),
        b')' | b']' | b'}' => if let Some(p) = stk.iter().rposition(|&c| c == match ch { b')' => b'(', b']' => b'[', _ => b'{' }) { stk.remove(p); },
        _ => {}
    } }
    let closers: String = stk.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
    let idx = usize::from(lang == LanguageId::Tsx);
    TS_BODY_PARSERS.with(|cell| {
        let mut arr = cell.borrow_mut();
        let parser = arr[idx].get_or_insert_with(|| {
            let mut p = tree_sitter::Parser::new();
            let _ = p.set_language(&if idx == 1 { crate::ts_pool::GrammarSlot::Tsx } else { crate::ts_pool::GrammarSlot::TypeScript }.language_fn().into()); p
        });
        let obj_ok = do_obj && parser.parse(format!("async function* _f() {{ return {{\n{body_tail}\n{closers}\n}}; }}"), None).is_some_and(|t| !tree_has_err(t.root_node()));
        let type_ok = do_type && { let s = format!("type _T = {{\n{body_tail}\n{closers}\n}};"); parser.parse(&s, None).is_some_and(|t| !tree_has_err(t.root_node()) && !type_probe_rejected(t.root_node(), &s)) };
        (obj_ok, type_ok)
    })
}

fn lex_ts_body(lang: LanguageId, s: &str, compact: bool) -> (String, Vec<(usize, usize)>) {
    let (b, mut i, mut js, mut d0, mut angles) = (s.as_bytes(), 0usize, JsLexState::new(), Vec::new(), Vec::new());
    let mut out = String::with_capacity(if compact { s.len().min(32768) } else { s.len() });
    let (mut pd, mut bd, mut cd, mut qd, mut q_seg) = (0usize, 0usize, 0usize, 0usize, None::<usize>);
    while i < b.len() {
        if b[i] == b'\n' {
            let ended_q = js.on_newline(lang);
            if compact && let Some(qs) = q_seg { if ended_q { q_seg = None; out.push_str(&s[qs..i]); } else { i += 1; continue; } }
            out.push('\n'); i += 1; continue;
        }
        let prev = i;
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => {
                if compact && js.quote.is_none() && let Some(qs) = q_seg.take() {
                    out.push_str(if i - qs > 16 { match b[qs] { b'"' => "\"_\"", b'\'' => "'_'", b'`' => "`_`", _ => "}_`" } } else { &s[qs..i] });
                } else if !compact && b[prev..i].contains(&b'\n') { out.extend(b[prev..i].iter().filter(|&&c| c == b'\n').map(|_| '\n')); }
                continue;
            }
            StepQuote::EnteredInterp => {
                cd += 1;
                if compact && let Some(qs) = q_seg.take() {
                    out.push_str(if i - qs > 16 { if b[qs] == b'`' { "`_${" } else { "}_${" } } else { &s[qs..i] });
                } else { out.push_str("${"); }
                continue;
            }
            StepQuote::NotInQuote => {}
        }
        let was_q = js.quote.is_some();
        if js.open_quote(lang, b, &mut i) { if compact { q_seg = Some(prev); } else { out.push('_'); } continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { out.push_str(if compact { &s[i..end] } else { " " }); i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } out.push(' '); continue; }
        if b[i..].starts_with(b"/*") { let (Some(a), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; }; for &c in &b[i..a] { if c == b'\n' { out.push('\n'); } } out.push(' '); i = a; continue; }
        js.step_byte(lang, b, &mut i);
        let ch = &s[prev..i];
        match ch {
            "(" => pd += 1, ")" => pd = pd.saturating_sub(1), "[" => bd += 1, "]" => bd = bd.saturating_sub(1), "{" => cd += 1, "}" => cd = cd.saturating_sub(1),
            "," if pd == 0 && bd == 0 && cd == 0 => d0.push((out.len() + 1, i)),
            "<" if pd == 0 && bd == 0 && cd == 0 && !matches!(b.get(i), Some(b'=' | b'<')) => angles.push(d0.len()),
            ">" if pd == 0 && bd == 0 && cd == 0 && (prev == 0 || !matches!(b[prev - 1], b'-' | b'=')) => if let Some(m) = angles.pop() { d0.truncate(m); },
            "?" if pd == 0 && bd == 0 && cd == 0 && !angles.is_empty() => qd += 1,
            ":" if pd == 0 && bd == 0 && cd == 0 => if qd > 0 { qd -= 1; } else if b.get(i) != Some(&b':') && (prev == 0 || b[prev - 1] != b':') { angles.clear(); },
            ";" if pd == 0 && bd == 0 && cd == 0 => { angles.clear(); qd = 0; }
            _ => {}
        }
        if compact && !was_q && js.quote.is_some() { q_seg = Some(prev); } else { out.push_str(ch); }
    }
    if compact && let Some(qs) = q_seg.take() { out.push_str(&s[qs..]); }
    (out, d0)
}

fn bounded_ts_probe(lang: LanguageId, body_tail: &str, clean_body: &str, last_c: Option<(usize, usize)>) -> (bool, bool) {
    let probe_small = |raw: &str, cln: Option<&str>, lc: Option<(usize, usize)>| {
        let (mut ok, mut tok) = dual_probe_ts_flags(lang, raw, cln, true, true);
        if !ok && !tok && let Some((cc, rc)) = lc && cln.map_or_else(|| !raw[rc..].trim().is_empty(), |c| !c[cc..].trim().is_empty()) {
            (ok, tok) = dual_probe_ts_flags(lang, &raw[..rc], cln.map(|c| &c[..cc]), true, true);
        }
        (ok, tok)
    };
    if body_tail.len() <= 16384 { return probe_small(body_tail, Some(clean_body), last_c); }
    let (comp, comp_d0) = lex_ts_body(lang, body_tail, true);
    let comp_lc = comp_d0.last().copied().filter(|&(c, _)| !comp[c..].trim().is_empty()).map(|(c, _)| (c, c));
    if comp.len() <= 16384 { return probe_small(&comp, None, comp_lc); }
    let (end, mut all_ok, mut all_tok, mut pos) = (comp_lc.map_or(comp.len(), |(c, _)| c), true, true, 0usize);
    while pos < end && (all_ok || all_tok) {
        let si = comp_d0.partition_point(|&(p, _)| p <= pos);
        let ei = si + comp_d0[si..].partition_point(|&(p, _)| p <= pos + 32768);
        let mut next_pos = if pos + 32768 >= end { end } else { comp_d0[si..ei].iter().rev().map(|&(p, _)| p).find(|&p| {
            let fl = comp[p..end].trim_start().split('\n').next().unwrap_or(""); fl.starts_with("...") || fl.starts_with("readonly ") || depth0_colon_pos(fl).is_some()
        }).or_else(|| comp_d0[si..ei].last().map(|&(p, _)| p)).unwrap_or_else(|| comp_d0.get(si).map_or(end, |&(p, _)| p)) };
        if next_pos <= pos { next_pos = end; }
        let (o, t) = dual_probe_ts_flags(lang, &comp[pos..next_pos], None, all_ok, all_tok);
        all_ok &= o; all_tok &= t; pos = next_pos;
    }
    (all_ok, all_tok)
}

fn rhs_is_broken_js(rhs: &str) -> bool {
    if rhs.is_empty() { return false; }
    let (b, mut i, mut pd, mut bd, mut cd, mut angles) = (rhs.as_bytes(), 0usize, 0usize, 0usize, 0usize, Vec::new());
    let is_sci = |p: usize| p >= 2 && matches!(b[p - 1], b'e' | b'E') && b[p - 2] != b'_' && b.get(p + 1).is_some_and(u8::is_ascii_digit) && {
        let k = (0..p - 1).rev().take_while(|&j| b[j].is_ascii_digit() || matches!(b[j], b'.' | b'_')).last().unwrap_or(p - 1);
        k < p - 1 && (b[k].is_ascii_digit() || (b[k] == b'.' && b[k + 1..p - 1].iter().any(u8::is_ascii_digit)))
            && (k == 0 || (!b[k - 1].is_ascii_alphanumeric() && !matches!(b[k - 1], b'_' | b'$')))
    };
    while i < b.len() {
        match b[i] {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'*' | b'/' | b'%' | b'~' | b'!' => return true,
            b'+' if !is_sci(i) => return true,
            b'-' if !is_sci(i) && !(b[..i].iter().rposition(|c| !c.is_ascii_whitespace()).is_none_or(|p|
                matches!(b[p], b'(' | b'[' | b'{' | b',' | b':' | b';' | b'|' | b'&' | b'<' | b'?' | b'=') || (b[p] == b'>' && p > 0 && b[p - 1] == b'='))
                && b[i + 1..].iter().position(|c| !c.is_ascii_whitespace()).is_some_and(|o| { let j = i + 1 + o; b[j].is_ascii_digit() || (b[j] == b'.' && b.get(j + 1).is_some_and(u8::is_ascii_digit)) })) => return true,
            b'&' | b'|' | b'?' | b'=' if b.get(i + 1) == Some(&b[i]) => return true,
            b'<' if b.get(i + 1) == Some(&b'<') => return true,
            b'<' if b.get(i + 1) != Some(&b'=') => angles.push((pd, bd, cd)),
            b'>' if i == 0 || !matches!(b[i - 1], b'-' | b'=') => if angles.last().copied() == Some((pd, bd, cd)) { angles.pop(); } else { return true; },
            _ => {}
        }
        i += 1;
    }
    if rhs.ends_with(['&', '|', '^', '?', '=', '<']) { return true; }
    let last_w = rhs.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
    !last_w.is_empty() && !rhs[..rhs.len() - last_w.len()].trim_end().ends_with('.')
        && (rhs == "void" || matches!(last_w, "await" | "typeof" | "delete" | "yield" | "new" | "in" | "instanceof" | "as" | "satisfies"))
}

pub(crate) fn ts_refine_body_signals(lang: LanguageId, body_tail: &str) -> (bool, bool, bool, bool, bool) {
    let (clean_body, d0) = lex_ts_body(lang, body_tail, false);
    let (mut has_iface, mut has_obj_expr, mut has_obj_paren_op, mut has_obj_lit) = (false, false, false, false);
    for l in clean_body.split('\n').map(str::trim).filter(|l| !l.is_empty()) {
        let is_kw = ["const ", "let ", "var ", "return ", "if ", "for ", "while ", "switch ", "throw "]
            .iter().any(|k| l.strip_prefix(k).is_some_and(|r| { let rt = r.trim_start(); !rt.starts_with(':') && !rt.starts_with("?:") }));
        if l.starts_with("...") || has_depth0_assign_outside_angles(l) || is_kw { return (true, has_iface, has_obj_expr, has_obj_paren_op, has_obj_lit); }
        if l.starts_with("readonly ") || l.starts_with("readonly\t") || l.contains("?:") || (l.ends_with(';') && l.contains(':') && !l.contains("::")) { has_iface = true; }
    }
    let (mut arith_op, mut prev) = (false, 0usize);
    let mut inspect_item = |seg: &str| {
        let (mut pd, mut bd, mut cd, mut semi) = (0usize, 0usize, 0usize, None);
        for (i, &c) in seg.as_bytes().iter().enumerate() { match c { b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1), b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1), b';' if pd == 0 && bd == 0 && cd == 0 => semi = Some(i), _ => {} } }
        let item = semi.map_or(seg, |p| &seg[p + 1..]).trim();
        if item.is_empty() { return; }
        let rhs = depth0_colon_pos(item).map_or(item, |c| item[c + 1..].trim());
        if is_ts_broken_paren_placeholder(rhs) { has_obj_paren_op = true; } else if rhs_is_broken_js(rhs) { arith_op = true; }
    };
    for &(c, _) in &d0 { inspect_item(&clean_body[prev..c - 1]); prev = c; }
    inspect_item(&clean_body[prev..]);
    if !has_iface && !has_obj_paren_op && clean_body.split('\n').any(|l| !l.trim().is_empty()) {
        let (obj_ok, type_ok) = bounded_ts_probe(lang, body_tail, &clean_body, d0.last().copied());
        if arith_op || (!d0.is_empty() && obj_ok && !type_ok) { has_obj_expr = true; }
        else if !obj_ok && type_ok { has_iface = true; } else if !d0.is_empty() && obj_ok && type_ok { has_obj_lit = true; }
    }
    (false, has_iface, has_obj_expr, has_obj_paren_op, has_obj_lit)
}
