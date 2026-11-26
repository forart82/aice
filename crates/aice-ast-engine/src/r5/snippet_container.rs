use aice_lang_registry::LanguageId;
use crate::r5::snippet_js_lex::{JsLexState, StepQuote};

pub(crate) use crate::r5::snippet_hdr::{
    has_depth0_assign, is_cpp_lambda_hdr, is_rust_let_struct_pat, is_rust_struct_lit_hdr,
};
use crate::r5::snippet_hdr::{has_depth0_arrow, has_unclosed_rust_angle, trim_after_last_sep};
use crate::r5::snippet_container_compat::is_cpp_lambda_capture_before_paren;
use crate::r5::snippet_synth::strip_comments_strings;
use crate::r5::snippet_ts_cls::{
    is_non_ctrl_words, is_ts_class_static_block, is_ts_iface_sig_hdr,
    is_ts_obj_method_body_hdr, ts_class_member_tail,
};
use crate::r5::snippet_ts_expr::{is_js_expr_brace_hdr, is_ts_quoted_method_hdr};
use crate::r5::snippet_ts_gen_ctx::TsGenMemberCtx;
use crate::r5::snippet_ts_hdr::{is_decorator_call_hdr, is_ts_obj_shorthand_method_hdr};
use crate::r5::snippet_ts_type::{
    has_depth0_assign_outside_angles, has_obj_prop_colon_before_angle,
    is_ts_type_annotation_tail_in_list, is_ts_type_bracket_hdr_in_ctx, tail_after_depth0_comma,
};
use crate::r5::snippet_type_body::{TB_ENUM, TB_IFACE, TB_PARAM, TB_STRUCT};
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PrefixContainer {
    TopLevel, TypeBody(u8), ClassOrTraitBody, RustTypeParen, ValueParen, TypeParen,
    ValueBracket, TypeBracket, ValueBrace, StructLit, StmtBlock, MatchOrSwitch,
}
impl PrefixContainer {
    pub(crate) fn is_scoped_non_stmt(self) -> bool {
        matches!(self, Self::TypeBody(_) | Self::ClassOrTraitBody | Self::RustTypeParen | Self::ValueParen | Self::TypeParen | Self::ValueBracket | Self::TypeBracket | Self::ValueBrace | Self::StructLit)
    }
}
fn classify_hdr(lang: LanguageId, delim: u8, raw_hdr: &str, parent: PrefixContainer) -> PrefixContainer {
    let clean = strip_comments_strings(lang, raw_hdr, true);
    let hdr = trim_after_last_sep(&clean).trim();
    let kw_src = if delim == b'{' && crate::r5::snippet_js_lex::is_js_like(lang) { tail_after_depth0_comma(hdr).trim() } else { hdr };
    let words: Vec<&str> = kw_src.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    let (has_kw, has_assign) = (|kw: &str| words.contains(&kw), has_depth0_assign(kw_src));
    if let Some(ts_res) = classify_ts_paren_or_brace(lang, delim, hdr, raw_hdr, parent) { return ts_res; }
    if delim == b'[' { return PrefixContainer::ValueBracket; }
    if delim == b'(' {
        if lang == LanguageId::Rust {
            if words.last() == Some(&"fn") && hdr.trim_end().ends_with("fn") { return PrefixContainer::TypeBody(TB_PARAM); }
            if words.last().is_some_and(|w| matches!(*w, "Fn" | "FnMut" | "FnOnce")) || has_unclosed_rust_angle(hdr) || has_depth0_arrow(hdr) || has_kw("where")
                || words.iter().any(|w| matches!(*w, "struct" | "enum" | "union" | "trait" | "impl"))
                || matches!(parent, PrefixContainer::TypeBody(TB_STRUCT | TB_ENUM) | PrefixContainer::RustTypeParen) { return PrefixContainer::RustTypeParen; }
        }
        let is_fn = match lang {
            LanguageId::Rust => has_kw("fn"), LanguageId::Go => has_kw("func"), LanguageId::Python => has_kw("def"),
            LanguageId::Kotlin => has_kw("fun"), LanguageId::Php => has_kw("function"), _ => false,
        };
        if is_fn { return PrefixContainer::TypeBody(TB_PARAM); }
        let non_ctrl = !words.iter().any(|w| matches!(*w, "if" | "for" | "while" | "switch" | "catch" | "return" | "throw" | "new" | "sizeof"));
        if matches!(lang, LanguageId::C | LanguageId::Cpp | LanguageId::Java | LanguageId::CSharp | LanguageId::Dart)
            && matches!(parent, PrefixContainer::TopLevel | PrefixContainer::ClassOrTraitBody) && !has_assign && non_ctrl && words.len() >= 2 { return PrefixContainer::TypeBody(TB_PARAM); }
        if lang == LanguageId::Cpp && is_cpp_lambda_capture_before_paren(hdr) { return PrefixContainer::TypeBody(TB_PARAM); }
        return PrefixContainer::ValueParen;
    }
    let in_plain_stmt_ctx = !matches!(parent, PrefixContainer::TypeBody(TB_IFACE) | PrefixContainer::ClassOrTraitBody);
    if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && is_js_expr_brace_hdr(hdr, &words, in_plain_stmt_ctx) { return PrefixContainer::ValueBrace; }
    if is_rust_let_struct_pat(lang, hdr, &words, has_assign) { return PrefixContainer::StructLit; }
    if words.iter().any(|w| matches!(*w, "match" | "switch")) { return PrefixContainer::MatchOrSwitch; }
    if words.iter().any(|w| matches!(*w, "if" | "else" | "for" | "while" | "loop" | "try" | "catch" | "finally" | "do" | "fn" | "function" | "func" | "fun" | "def")) || is_cpp_lambda_hdr(lang, hdr) {
        if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && hdr.trim_end().ends_with(',')
            && !words.iter().any(|w| matches!(*w, "fn" | "function" | "func" | "fun" | "def")) { return PrefixContainer::ValueBrace; }
        return PrefixContainer::StmtBlock;
    }
    if matches!(lang, LanguageId::C | LanguageId::Cpp) && has_assign && !has_kw("class") && !has_kw("template") { return PrefixContainer::ValueBrace; }
    if has_kw("enum") { return PrefixContainer::TypeBody(TB_ENUM); }
    if has_kw("struct") || has_kw("union") { return PrefixContainer::TypeBody(TB_STRUCT); }
    if has_kw("interface") && lang != LanguageId::JavaScript {
        return if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) { PrefixContainer::TypeBody(TB_IFACE) } else { PrefixContainer::ClassOrTraitBody };
    }
    if words.iter().any(|w| matches!(*w, "class" | "trait" | "impl" | "object") || (!crate::r5::snippet_js_lex::is_js_like(lang) && matches!(*w, "namespace" | "module"))) {
        return PrefixContainer::ClassOrTraitBody;
    }
    if lang == LanguageId::Rust && parent == PrefixContainer::TypeBody(TB_ENUM) && !hdr.is_empty() { return PrefixContainer::TypeBody(TB_STRUCT); }
    if lang == LanguageId::Rust && is_rust_struct_lit_hdr(hdr, &words) { return PrefixContainer::StructLit; }
    if has_assign {
        if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
            && (crate::r5::snippet_hdr_ts::is_ts_js_missing_arrow_fn_hdr(hdr) || crate::r5::snippet_ts_gen_ambig::is_ts_var_decl_lt_without_assign(lang, raw_hdr)) {
            return PrefixContainer::StmtBlock;
        }
        return if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) && has_kw("type") { PrefixContainer::TypeBody(TB_IFACE) } else { PrefixContainer::ValueBrace };
    }
    if matches!(parent, PrefixContainer::ValueParen | PrefixContainer::ValueBracket | PrefixContainer::ValueBrace)
        && (hdr.is_empty() || hdr.ends_with([',', '(', ':', '[']) || (matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && (hdr.ends_with('?') || hdr.ends_with("||") || hdr.ends_with("&&") || hdr.ends_with("??")))) {
        return PrefixContainer::ValueBrace;
    }
    PrefixContainer::StmtBlock
}

fn classify_ts_paren_or_brace(lang: LanguageId, delim: u8, hdr: &str, raw_hdr: &str, parent: PrefixContainer) -> Option<PrefixContainer> {
    let is_ts = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx);
    let member_ctx = match parent {
        PrefixContainer::TypeBody(TB_IFACE) => TsGenMemberCtx::IfaceType,
        PrefixContainer::TypeBody(TB_PARAM) | PrefixContainer::ClassOrTraitBody => TsGenMemberCtx::ClassOrType,
        PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace,
        _ => TsGenMemberCtx::None,
    };
    let (in_val_paren, ts_parent_type) = (parent == PrefixContainer::ValueParen, matches!(parent, PrefixContainer::TypeBracket | PrefixContainer::TypeParen));
    let is_ts_type_ctx = ts_parent_type || (is_ts && is_ts_type_annotation_tail_in_list(hdr, Some(raw_hdr), member_ctx, true, in_val_paren, matches!(parent, PrefixContainer::ValueBracket | PrefixContainer::ValueParen)));
    let in_type_member_ctx = member_ctx.is_class_or_type();
    let is_ts_bracket_ctx = is_ts_type_ctx && (ts_parent_type || in_type_member_ctx || in_val_paren || !has_obj_prop_colon_before_angle(hdr));
    if delim == b'[' {
        return Some(if is_ts && is_ts_type_bracket_hdr_in_ctx(hdr, is_ts_bracket_ctx, in_val_paren) { PrefixContainer::TypeBracket } else { PrefixContainer::ValueBracket });
    }
    if delim == b'(' {
        if is_ts && is_ts_type_bracket_hdr_in_ctx(hdr, is_ts_bracket_ctx, in_val_paren) {
            return Some(PrefixContainer::TypeParen);
        }
        if !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) { return None; }
        let cls = parent == PrefixContainer::ClassOrTraitBody;
        let (mh, mr) = if cls { ts_class_member_tail(hdr, raw_hdr) } else { (hdr, raw_hdr) };
        let quoted_method = is_ts_quoted_method_hdr(mr, cls);
        if matches!(parent, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(TB_IFACE)) && quoted_method {
            return Some(PrefixContainer::TypeBody(TB_PARAM));
        }
        if matches!(parent, PrefixContainer::ClassOrTraitBody | PrefixContainer::TypeBody(TB_IFACE))
            && !has_depth0_assign_outside_angles(mh) && is_non_ctrl_words(mh) && !mh.is_empty()
            && (!is_decorator_call_hdr(mh) || quoted_method)
        {
            return Some(PrefixContainer::TypeBody(TB_PARAM));
        }
        if is_ts && parent == PrefixContainer::TypeBody(TB_IFACE) && is_ts_iface_sig_hdr(hdr) {
            return Some(PrefixContainer::TypeBody(TB_PARAM));
        }
        if is_ts && parent == PrefixContainer::ValueBrace && (is_ts_obj_shorthand_method_hdr(hdr) || quoted_method) {
            return Some(PrefixContainer::TypeBody(TB_PARAM));
        }
        return None;
    }
    if is_ts && crate::r5::snippet_ts_gen_ambig::is_ts_invalid_kw_lt_hdr_ctx(lang, raw_hdr, member_ctx, matches!(parent, PrefixContainer::TopLevel | PrefixContainer::StmtBlock | PrefixContainer::MatchOrSwitch), ts_parent_type, in_val_paren) { return Some(PrefixContainer::StmtBlock); }
    if is_ts && (is_ts_type_ctx || (parent == PrefixContainer::TypeBody(TB_IFACE) && !has_depth0_assign_outside_angles(hdr) && hdr.ends_with("=>"))) {
        return Some(PrefixContainer::TypeBody(TB_IFACE));
    }
    if hdr.ends_with("=>") { return Some(PrefixContainer::StmtBlock); }
    if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
        && matches!(parent, PrefixContainer::ClassOrTraitBody | PrefixContainer::ValueBrace)
    {
        let cls = parent == PrefixContainer::ClassOrTraitBody;
        let (mh, mr) = if cls { ts_class_member_tail(hdr, raw_hdr) } else { (hdr, raw_hdr) };
        if (cls && is_ts_class_static_block(mh)) || is_ts_obj_method_body_hdr(mh, mr, cls) {
            return Some(PrefixContainer::StmtBlock);
        }
    }
    None
}

pub(crate) use crate::r5::snippet_container_compat::classify_prefix_container;

pub(crate) fn classify_prefix_container_with_openers(lang: LanguageId, joined: &str, openers: &[(u8, usize, usize)]) -> PrefixContainer {
    let filtered = crate::r5::snippet_rs_attr::filter_ctx_openers(lang, joined, openers);
    if filtered.is_empty() { return PrefixContainer::TopLevel; }
    let mut cur = PrefixContainer::TopLevel;
    for (idx, &(delim, _, op_byte)) in filtered.iter().enumerate() {
        let start = if idx == 0 { 0 } else { (filtered[idx - 1].2 + 1).min(op_byte) };
        let raw_hdr = joined.get(start..op_byte).unwrap_or("");
        cur = classify_hdr(lang, delim, raw_hdr, cur);
        if delim == b'{' {
            let next_b = filtered.get(idx + 1).map_or(joined.len(), |x| x.2);
            cur = crate::r5::snippet_ts_gen::refine_ts_ambig_brace_ctx(lang, cur, raw_hdr, joined.get(op_byte + 1..next_b).unwrap_or(""));
        }
    }
    cur
}

fn tsx_rbrace_needs_semi(lines: &[&str], pool: &mut crate::ts_pool::ParserPool) -> bool {
    let (raw, mut i, mut js) = (lines.join("\n"), 0usize, JsLexState::new());
    let (b, mut pd, mut bd, mut cd, mut stmt_start, mut open_b, mut blocks, mut last_code_raw) = (raw.as_bytes(), 0usize, 0usize, 0usize, 0usize, None, Vec::new(), 0usize);
    while i < b.len() {
        if b[i] == b'\n' {
            let was_open = js.has_open_quote();
            js.on_newline(LanguageId::Tsx);
            if !was_open && !js.has_open_quote() && pd == 0 && bd == 0 && cd == 0 {
                let tail_end = if raw[i + 1..].trim_start().starts_with("/*") { raw.len() } else { raw[i + 1..].char_indices().nth(256).map_or(raw.len(), |(o, _)| i + 1 + o) };
                let (prev, next) = (strip_comments_strings(LanguageId::Tsx, &raw[stmt_start..i], false), strip_comments_strings(LanguageId::Tsx, &raw[i + 1..tail_end], false));
                let nw = next.trim_start().split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
                if !matches!(nw, "else" | "catch" | "finally" | "while") && crate::r5::snippet_ts_gen_chk::is_ts_asi_frame_reset(&prev, &next, TsGenMemberCtx::None) { stmt_start = i + 1; blocks.clear(); }
            }
            i += 1; continue;
        }
        let p0 = i;
        if js.step_quote(LanguageId::Tsx, b, &mut i) != StepQuote::NotInQuote { if !b[p0].is_ascii_whitespace() { last_code_raw = i; } continue; }
        if !js.has_open_quote() {
            if let Some((end, _)) = js.match_special(LanguageId::Tsx, b, i) { i = end; last_code_raw = i; continue; }
            if js.open_quote(LanguageId::Tsx, b, &mut i) { last_code_raw = i; continue; }
            if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } continue; }
            if b[i..].starts_with(b"/*") {
                let Some(a) = crate::r5::snippet_blk::find_blk_comment_close(LanguageId::Tsx, b, i + 2, 1).0 else { break; };
                for &ch in &b[i + 2..a] { if ch == b'\n' { js.on_newline(LanguageId::Tsx); } }
                i = a; continue;
            }
            match b[i] {
                b'(' => pd += 1, b')' => pd = pd.saturating_sub(1), b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
                b';' if pd == 0 && bd == 0 && cd == 0 => { stmt_start = i + 1; blocks.clear(); }
                b'{' if pd == 0 && bd == 0 => { if cd == 0 { open_b = Some(i); } cd += 1; }
                b'}' if pd == 0 && bd == 0 => {
                    cd = cd.saturating_sub(1);
                    if cd == 0 {
                        if let Some(o) = open_b.take() { blocks.push((o, i)); }
                        let mut j = i + 1;
                        while j < b.len() {
                            if matches!(b[j], b' ' | b'\t') { j += 1; }
                            else if b[j..].starts_with(b"/*") && let Some(a) = crate::r5::snippet_blk::find_blk_comment_close(LanguageId::Tsx, b, j + 2, 1).0 && !b[j + 2..a].contains(&b'\n') { j = a; }
                            else { break; }
                        }
                        if j < b.len() && !b[j..].starts_with(b"//") && !matches!(b[j], b'\n' | b';' | b'}' | b'.' | b'[' | b'(' | b',' | b':' | b'?' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'=' | b'<' | b'>' | b'!') {
                            let w = raw[j..].split(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
                            if !matches!(w, "else" | "catch" | "finally" | "while" | "as" | "satisfies" | "instanceof" | "in") { stmt_start = i + 1; blocks.clear(); }
                        }
                    }
                }
                _ => {}
            }
        }
        let p0 = i; js.step_byte(LanguageId::Tsx, b, &mut i);
        if !b[p0].is_ascii_whitespace() { last_code_raw = i; }
    }
    let end = last_code_raw.max(stmt_start);
    let (mut collapsed, mut pos) = (String::with_capacity(end - stmt_start), stmt_start);
    for (o, c) in blocks { if o >= pos && c < end { collapsed.push_str(&raw[pos..o]); collapsed.push_str("{}"); pos = c + 1; } }
    collapsed.push_str(&raw[pos..end]);
    let mut min_err = |s: &str| [s.to_string(), format!("function _f_() {{\n{s}\n}}"), format!("async function* _f_() {{\n{s}\n}}")].into_iter()
        .map(|p| crate::r5::checks::collect_r5_error_spans(LanguageId::Tsx, &p, std::path::Path::new("_aice_.tsx"), pool).map_or(1, |e| e.len()))
        .min().unwrap_or(1);
    min_err(&format!("{collapsed}\n<div>_aice_</div>")) > min_err(&format!("{collapsed};\n<div>_aice_</div>"))
}
fn strip_tsx_cmts_keep_q(s: &str) -> String {
    let (b, mut i, mut js, mut out) = (s.as_bytes(), 0usize, JsLexState::new(), String::with_capacity(s.len()));
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(LanguageId::Tsx); out.push('\n'); i += 1; continue; }
        match js.step_quote(LanguageId::Tsx, b, &mut i) {
            StepQuote::Consumed => { if !js.has_open_quote() { out.push('_'); } continue; }
            StepQuote::EnteredInterp => { out.push_str("${"); continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(LanguageId::Tsx, b, &mut i) { continue; }
        if let Some((end, _)) = js.match_special(LanguageId::Tsx, b, i) { out.push('_'); i = end; continue; }
        if b[i..].starts_with(b"//") { while i < b.len() && b[i] != b'\n' { i += 1; } out.push(' '); continue; }
        if b[i..].starts_with(b"/*") {
            let Some(a) = crate::r5::snippet_blk::find_blk_comment_close(LanguageId::Tsx, b, i + 2, 1).0 else { break; };
            for &ch in &b[i + 2..a] { if ch == b'\n' { js.on_newline(LanguageId::Tsx); } }
            out.push(' '); i = a; continue;
        }
        let p = i; js.step_byte(LanguageId::Tsx, b, &mut i); out.push_str(&s[p..i]);
    }
    out
}
pub(crate) fn tsx_unclosed_jsx_tail_info(prefix_lines: &[&str], last_op_end: usize, last_op_byte: Option<usize>, last_idx: Option<usize>, compute_no_semi: bool, pool: &mut crate::ts_pool::ParserPool) -> Option<(usize, usize, bool)> {
    let end = last_idx.filter(|&i| i >= last_op_end)?;
    let seg = prefix_lines[last_op_end..=end].join("\n");
    let after_op = if last_op_end > 0 && let Some(ob) = last_op_byte {
        let off: usize = prefix_lines[..last_op_end - 1].iter().map(|l| l.len() + 1).sum();
        prefix_lines[last_op_end - 1].get(ob.saturating_sub(off) + 1..).unwrap_or("")
    } else { "" };
    let scan_src = if after_op.is_empty() { seg.clone() } else { format!("{after_op}\n{seg}") };
    let (_, _, Some(tag_byte)) = crate::r5::snippet_ctx::tsx_scan_closers(&scan_src, None, true) else { return None; };
    let in_op = !after_op.is_empty() && tag_byte <= after_op.len();
    let seg_tag = if after_op.is_empty() { tag_byte } else { tag_byte.saturating_sub(after_op.len() + 1) };
    let jsx_ln = if in_op { last_op_end - 1 } else { last_op_end + seg[..seg_tag].bytes().filter(|&b| b == b'\n').count() };
    let pre_clean = strip_tsx_cmts_keep_q(&scan_src[..tag_byte]);
    let same_pre = pre_clean.rsplit('\n').next().unwrap_or("").trim_end();
    if in_op && same_pre.is_empty() { return None; }
    let check_pc = |pc: &str, rbrace_lines: &[&str], p: &mut crate::ts_pool::ParserPool| -> bool {
        let pw = pc.rsplit(|c: char| !c.is_ascii_alphanumeric() && !matches!(c, '_' | '$')).next().unwrap_or("");
        if pc.ends_with('}') { tsx_rbrace_needs_semi(rbrace_lines, p) } else {
            !pc.is_empty() && !pc.ends_with([';', '{', '}', ':', ',', '(', '[', '=']) && !(pc.ends_with('?') && !pc.ends_with("?."))
                && !pc.ends_with("=>") && crate::r5::snippet_ops::trailing_binary_op(LanguageId::Tsx, pc).is_none() && !crate::r5::snippet_ts_gen_chk::prev_is_ctrl_hdr(pc)
                && !matches!(pw, "return" | "throw" | "yield" | "await" | "else" | "do" | "export" | "default" | "case")
        }
    };
    if !same_pre.is_empty() { return Some((jsx_ln, jsx_ln, compute_no_semi && (same_pre.ends_with('>') || check_pc(same_pre, &[&scan_src[..tag_byte]], pool)))); }
    if jsx_ln == last_op_end { return Some((last_op_end, jsx_ln, compute_no_semi && pre_clean.trim_end().ends_with('>'))); }
    let Some(pi) = crate::r5::snippet_cache::last_code_line_idx(LanguageId::Tsx, &prefix_lines[last_op_end..jsx_ln], pool) else { return Some((last_op_end, jsx_ln, false)); };
    let prev_ln = last_op_end + pi;
    if !compute_no_semi { return Some((prev_ln, jsx_ln, false)); }
    let pc = crate::r5::snippet_cst::strip_trailing_comment(LanguageId::Tsx, prefix_lines[prev_ln], pool);
    Some((prev_ln, jsx_ln, check_pc(pc, &prefix_lines[last_op_end..=prev_ln], pool)))
}
