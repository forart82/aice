use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_container::{
    PrefixContainer, is_cpp_lambda_hdr, is_rust_let_struct_pat, is_rust_struct_lit_hdr,
};
use crate::r5::snippet_hdr::{has_depth0_arrow, has_unclosed_rust_angle, trim_after_last_sep};
use crate::r5::snippet_js_lex::is_js_like;
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_ts_cls::{
    is_ts_class_static_block, is_ts_obj_method_body_hdr, ts_class_member_tail,
};
use crate::r5::snippet_ts_expr::is_js_expr_brace_hdr;
use crate::r5::snippet_ts_gen_ctx::TsGenMemberCtx;
use crate::r5::snippet_ts_multi::{ts_multi_delim_cands, ts_single_opener_cands};
use crate::r5::snippet_ts_type::{is_ts_type_alias_hdr, is_ts_type_annotation_tail_with_raw};
use crate::r5::snippet_type_body::{TB_IFACE, TB_PARAM};
pub(crate) fn strip_comments_strings(lang: LanguageId, s: &str, keep_nl: bool) -> String {
    let b = s.as_bytes();
    let (slash, hash) = (has_slash_comments(lang), has_hash_comments(lang));
    let (mut i, mut js, mut out) = (0usize, JsLexState::new(), String::with_capacity(s.len()));
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); out.push(if keep_nl { '\n' } else { ' ' }); i += 1; continue; }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { out.push(' '); continue; }
            StepQuote::EnteredInterp => { out.push_str("${"); continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(lang, b, &mut i) { out.push(' '); continue; }
        if let Some((end, _)) = js.match_special(lang, b, i) { out.push(' '); i = end; continue; }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//")) || (hash && is_hash_comment_at(b, i)) {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            out.push(' '); continue;
        }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; };
            out.push(' '); i = after; continue;
        }
        let prev = i;
        if is_js_like(lang) {
            js.step_byte(lang, b, &mut i);
            out.push_str(&s[prev..i]);
        } else {
            let ch = s[prev..].chars().next().unwrap_or(' ');
            out.push(ch);
            i += ch.len_utf8();
        }
    }
    out
}

fn fn_block_opener(lang: LanguageId, indent: &str) -> String {
    match lang {
        LanguageId::Rust => format!("{indent}fn _aice_() {{"),
        LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => format!("{indent}function _aice_() {{"),
        LanguageId::Go => format!("{indent}func _aice_() {{"),
        LanguageId::Kotlin => format!("{indent}fun _aice_() {{"),
        LanguageId::Php => format!("{indent}<?php function _aice_() {{"),
        LanguageId::C | LanguageId::Cpp | LanguageId::Java | LanguageId::CSharp | LanguageId::Dart => format!("{indent}void _aice_() {{"),
        _ => format!("{indent}{{"),
    }
}
fn single_brace_cands(lang: LanguageId, hdr: &[&str], indent: &str, pctx: PrefixContainer) -> Vec<Vec<String>> {
    let parent_in_val_paren = pctx == PrefixContainer::ValueParen;
    let member_ctx = match pctx {
        PrefixContainer::TypeBody(TB_IFACE) => TsGenMemberCtx::IfaceType,
        PrefixContainer::TypeBracket | PrefixContainer::TypeParen
        | PrefixContainer::TypeBody(TB_PARAM) | PrefixContainer::ClassOrTraitBody => TsGenMemberCtx::ClassOrType,
        PrefixContainer::ValueBrace => TsGenMemberCtx::ObjBrace,
        _ => TsGenMemberCtx::None,
    };
    let raw_hdr = hdr.join("\n");
    let raw_pre_brace = raw_hdr.trim_end().strip_suffix('{').unwrap_or(&raw_hdr).trim_end();
    let clean = strip_comments_strings(lang, &raw_hdr, true);
    let pre_brace = clean.trim_end().strip_suffix('{').unwrap_or(&clean).trim_end();
    let pb = trim_after_last_sep(pre_brace).trim();
    if is_js_like(lang) && crate::r5::snippet_hdr_ts::is_ts_js_missing_arrow_fn_hdr(pb) {
        return Vec::new();
    }
    let kw_src = if is_js_like(lang) { crate::r5::snippet_ts_type::tail_after_depth0_comma(pb).trim() } else { pre_brace };
    let words: Vec<&str> = kw_src.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    let has_kw = |kw: &str| words.contains(&kw);
    let has_assign = kw_src.as_bytes().windows(2).any(|w| w[0] == b'=' && w[1] != b'>' && w[1] != b'=')
        || kw_src.trim_end().ends_with('=');
    let mut out = Vec::new();
    if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
        && (has_kw("interface")
            || is_ts_type_alias_hdr(pre_brace, &words, has_assign)
            || is_ts_type_annotation_tail_with_raw(
                pre_brace, Some(raw_pre_brace), member_ctx, parent_in_val_paren, parent_in_val_paren,
            ))
    {
    } else if (lang == LanguageId::Rust && is_rust_struct_lit_hdr(pre_brace, &words))
        || is_rust_let_struct_pat(lang, pre_brace, &words, has_assign)
    {
        out.push(vec![format!("{indent}let _v = _S {{")]);
        return out;
    } else if matches!(lang, LanguageId::C | LanguageId::Cpp)
        && has_assign && !has_kw("class") && !has_kw("template") && !is_cpp_lambda_hdr(lang, pre_brace)
    {
        out.push(vec![format!("{indent}int _v[] = {{")]);
        return out;
    } else if has_kw("enum") {
        out.push(vec![format!("{indent}enum _E {{")]);
    } else if has_kw("class") {
        out.push(vec![format!("{indent}class _C {{")]);
    } else if has_kw("struct") {
        let line = if lang == LanguageId::Go { "type _S struct {" } else { "struct _S {" };
        out.push(vec![format!("{indent}{line}")]);
    } else if has_kw("switch") {
        let line = if lang == LanguageId::Go { "switch _aice_ {" } else { "switch (_aice_) {" };
        out.push(vec![format!("{indent}{line}")]);
    } else if (has_assign
        || (matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && {
            let pw: Vec<&str> = pb.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
            is_js_expr_brace_hdr(pb, &pw, true)
                || (!pw.iter().any(|w| matches!(*w, "if" | "for" | "while" | "switch" | "catch"))
                    && (pb.ends_with('?') || pb.ends_with("||") || pb.ends_with("&&") || pb.ends_with("??")))
        }))
        && !has_kw("function") && !has_kw("fn") && !has_kw("func") && !has_kw("fun")
        && !pre_brace.ends_with("=>")
        && !crate::r5::snippet_ts_gen_ambig::is_ts_var_decl_lt_without_assign(lang, raw_pre_brace)
        && !(is_js_like(lang) && matches!(pctx, PrefixContainer::ClassOrTraitBody | PrefixContainer::ValueBrace) && {
            let raw_pb = raw_hdr.trim_end().strip_suffix('{').unwrap_or(&raw_hdr);
            let cls = pctx == PrefixContainer::ClassOrTraitBody;
            let (ms, mr) = if cls { ts_class_member_tail(pb, raw_pb) } else { (pb, raw_pb) };
            if cls && is_ts_class_static_block(ms) { return vec![vec![format!("{indent}class _C {{"), format!("{indent}  static {{")]]; }
            if !cls && is_ts_obj_method_body_hdr(ms, mr, false) { return vec![vec![format!("{indent}const _v = {{"), format!("{indent}  _aice_() {{")]]; }
            cls && is_ts_obj_method_body_hdr(ms, mr, true)
        })
    {
        let line = if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) {
            "const _v = {"
        } else { "{" };
        out.push(vec![format!("{indent}{line}")]);
    }
    if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
        && !has_kw("function")
        && !pre_brace.ends_with("=>")
        && !words.iter().any(|w| matches!(
            *w,
            "if" | "else" | "for" | "while" | "do" | "switch" | "try" | "catch" | "finally" | "interface" | "type" | "enum" | "class"
        ))
    {
        let m_line = format!("{indent}_aice_() {{");
        if !out.iter().any(|v| v.len() == 1 && v[0] == m_line) {
            out.push(vec![m_line]);
        }
    }
    let bare = format!("{indent}{{");
    if !out.iter().any(|v| v.len() == 1 && v[0] == bare) {
        out.push(vec![bare]);
    }
    out
}

pub(crate) fn synthetic_opener_cands(
    lang: LanguageId,
    hdr: &[&str],
    delims: &[u8],
    pctx: PrefixContainer,
) -> Vec<Vec<String>> {
    let first_non_empty = hdr.iter().find(|l| !l.trim().is_empty()).or_else(|| hdr.last()).copied().unwrap_or("");
    let indent: String = first_non_empty.chars().take_while(|c| c.is_whitespace()).collect();
    let raw_hdr = hdr.join("\n");
    let clean = strip_comments_strings(lang, &raw_hdr, false);
    let words: Vec<&str> = clean.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    let has_kw = |kw: &str| words.contains(&kw);
    if delims.len() == 1 {
        if matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
            && matches!(delims[0], b'(' | b'[')
        {
            return ts_single_opener_cands(lang, &raw_hdr, &clean, &words, delims[0], &indent, pctx);
        }
        return match delims[0] {
            b'(' => {
                if lang == LanguageId::Python && has_kw("def") {
                    let mut v = vec![vec![format!("{indent}def _aice_(")]];
                    if !indent.is_empty() { v.push(vec!["def _aice_(".to_string()]); }
                    return v;
                }
                if lang == LanguageId::Php && has_kw("function") {
                    return vec![vec![format!("{indent}function _aice_(")], vec![format!("{indent}<?php function _aice_(")]];
                }
                let pre_paren = clean.trim_end().strip_suffix('(').unwrap_or(&clean).trim_end();
                if lang == LanguageId::Rust {
                    let is_fn_ptr = words.last() == Some(&"fn") && pre_paren.ends_with("fn");
                    let is_fn_trait = words.last().is_some_and(|w| matches!(*w, "Fn" | "FnMut" | "FnOnce"));
                    if is_fn_ptr { return vec![vec![format!("{indent}fn _aice_(")]]; }
                    if is_fn_trait || has_unclosed_rust_angle(&clean) || has_depth0_arrow(pre_paren)
                        || has_kw("where") || words.iter().any(|w| matches!(*w, "struct" | "enum" | "union" | "trait" | "impl"))
                    {
                        return Vec::new();
                    }
                    if has_kw("fn") { return vec![vec![format!("{indent}fn _aice_(")]]; }
                }
                if lang == LanguageId::Go && has_kw("func") { return vec![vec![format!("{indent}func _aice_(")]]; }
                let mut v = vec![vec![format!("{indent}_aice_(")]];
                if lang == LanguageId::Python && !indent.is_empty() { v.push(vec!["_aice_(".to_string()]); }
                v
            }
            b'[' => {
                let mut v = vec![vec![format!("{indent}[")]];
                if lang == LanguageId::Python && !indent.is_empty() { v.push(vec!["[".to_string()]); }
                v
            }
            _ => single_brace_cands(lang, hdr, &indent, pctx),
        };
    }
    let pre_brace = clean.trim_end().strip_suffix('{').unwrap_or(&clean).trim_end();
    if is_js_like(lang)
        && let Some(cands) = ts_multi_delim_cands(lang, &raw_hdr, &clean, delims, &indent, pctx)
    {
        return cands;
    }
    let is_rs_lit = lang == LanguageId::Rust && is_rust_struct_lit_hdr(pre_brace, &words);
    let mut lines = Vec::with_capacity(delims.len());
    for (idx, &d) in delims.iter().enumerate() {
        let pad = if idx == 0 { indent.as_str() } else { "" };
        match d {
            b'(' => lines.push(format!("{pad}_aice_(")),
            b'[' if matches!(lang, LanguageId::C | LanguageId::Cpp) => lines.push(format!("{pad}_aice_[")),
            b'[' => lines.push(format!("{pad}[")),
            _ if is_rs_lit && idx == 0 => lines.push(format!("{pad}let _v = _S {{")),
            _ if is_rs_lit => lines.push(format!("{pad}_S {{")),
            _ if idx == 0 => lines.push(fn_block_opener(lang, pad)),
            _ => lines.push(format!("{pad}{{")),
        }
    }
    vec![lines]
}

pub(crate) fn js_last_asi_stmt(pre: &str, in_class: bool) -> &str {
    let (b, mut pd, mut bd, mut cd, mut cut) = (pre.as_bytes(), 0usize, 0usize, 0usize, 0usize);
    for (i, &c) in b.iter().enumerate() {
        match c {
            b'(' => pd += 1, b')' => pd = pd.saturating_sub(1),
            b'[' => bd += 1, b']' => bd = bd.saturating_sub(1),
            b'{' => cd += 1, b'}' => cd = cd.saturating_sub(1),
            b'\n' if pd == 0 && bd == 0 && cd == 0 => {
                let (prev, next) = (pre[cut..i].trim(), pre[i + 1..].trim_start());
                let ws: Vec<&str> = prev.split(|ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '_' | '$')).filter(|w| !w.is_empty()).collect();
                let next_w = next.split(|ch: char| !ch.is_ascii_alphanumeric() && !matches!(ch, '_' | '$')).next().unwrap_or("");
                let exp_asi = !in_class && ((ws == ["export"] && next_w != "default")
                    || (ws == ["export", "default", "declare"] && !prev[..prev.find("default").unwrap()].contains('\n')));
                let asi_prev = !prev.is_empty() && !next.is_empty() && !prev.ends_with(['=', '+', '-', '*', '/', '%', '&', '|', '^', '?', ':', ',', '(', '[', '<', '.', '>'])
                    && (exp_asi || ws == ["declare"] || ws == ["abstract"] || (in_class && (ws == ["static", "declare"] || (ws == ["async", "declare"] && prev.contains('\n'))))
                        || !matches!(ws.last().copied(),
                            Some("export" | "default" | "const" | "let" | "var" | "function" | "class" | "interface" | "namespace" | "module" | "enum" | "static" | "declare" | "async")));
                if asi_prev && !matches!(next.as_bytes()[0], b'.' | b',' | b';' | b')' | b']' | b'}' | b'<' | b'>' | b'?' | b':' | b'=' | b'+' | b'-' | b'*' | b'/' | b'%' | b'&' | b'|' | b'^' | b'(' | b'[')
                    && !matches!(next_w, "in" | "instanceof" | "of")
                { cut = i + 1; }
            }
            _ => {}
        }
    }
    &pre[cut..]
}
