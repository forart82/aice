use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_container::PrefixContainer;
use crate::r5::snippet_cst::{cst_defect_profile, line_delim_detail, strip_trailing_comment};
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_type_body::{TB_ENUM, TB_IFACE, TB_PARAM, TB_STRUCT};
use crate::ts_pool::ParserPool;

pub(crate) fn container_compatible_for(
    lang: LanguageId,
    code: &str,
    ctx: PrefixContainer,
    has_suffix: bool,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if cst_defect_profile(lang, code, path, pool).unclosed_quotes > 0 {
        return false;
    }
    let expected = match ctx {
        PrefixContainer::ValueParen
        | PrefixContainer::TypeParen
        | PrefixContainer::TypeBody(TB_PARAM)
        | PrefixContainer::RustTypeParen => Some(b')'),
        PrefixContainer::ValueBracket | PrefixContainer::TypeBracket => Some(b']'),
        PrefixContainer::TypeBody(TB_STRUCT | TB_ENUM | TB_IFACE)
        | PrefixContainer::ClassOrTraitBody
        | PrefixContainer::ValueBrace
        | PrefixContainer::StructLit => Some(b'}'),
        _ => None,
    };
    let Some(closer) = expected else { return true; };
    let (stk, unm) = line_delim_detail(lang, code, path, pool);
    let closes_self = unm == [closer];
    if !stk.is_empty() || (!unm.is_empty() && !closes_self) {
        return false;
    }
    let allow_eof_comma = matches!(
        ctx,
        PrefixContainer::ValueParen
            | PrefixContainer::TypeParen
            | PrefixContainer::ValueBracket
            | PrefixContainer::TypeBracket
            | PrefixContainer::TypeBody(TB_PARAM)
            | PrefixContainer::RustTypeParen
    );
    let add_ph = !closes_self
        && (has_suffix || allow_eof_comma)
        && strip_trailing_comment(lang, code, pool).ends_with(',');
    let mut cands: Vec<String> = Vec::new();
    let mut push_wrap = |pre: &str, post: &str, ph: Option<&str>| {
        if closes_self {
            cands.push(format!("{pre}\n{code}{}", post.strip_prefix(closer as char).unwrap_or(post)));
        } else {
            cands.push(format!("{pre}\n{code}\n{post}"));
            if add_ph && let Some(p) = ph {
                cands.push(format!("{pre}\n{code}\n{p}\n{post}"));
            }
        }
    };
    match ctx {
        PrefixContainer::TypeBody(TB_STRUCT) => match lang {
            LanguageId::Go => push_wrap("package _aice\ntype _S struct {", "}\n", None),
            LanguageId::C | LanguageId::Cpp => push_wrap("struct _S {", "};", None),
            _ => push_wrap("struct _S {", "}", None),
        },
        PrefixContainer::TypeBody(TB_ENUM) => match lang {
            LanguageId::Kotlin => push_wrap("enum class _E {", "}", None),
            LanguageId::C | LanguageId::Cpp => push_wrap("enum _E {", "};", None),
            _ => push_wrap("enum _E {", "}", None),
        },
        PrefixContainer::TypeBody(TB_IFACE) => push_wrap("interface _I {", "}", None),
        PrefixContainer::TypeBody(TB_PARAM) => match lang {
            LanguageId::Rust => push_wrap("fn _aice_(", ") {}", None),
            LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => {
                push_wrap("function _aice_(", ") {}", None);
            }
            LanguageId::Go => push_wrap("package _aice\nfunc _aice_(", ") {}\n", None),
            LanguageId::Python => push_wrap("def _aice_(", "): pass", None),
            LanguageId::Kotlin => push_wrap("fun _aice_(", ") {}", None),
            LanguageId::Php => push_wrap("<?php function _aice_(", ") {}", None),
            _ => push_wrap("void _aice_(", ") {}", Some("int _aice_")),
        },
        PrefixContainer::ClassOrTraitBody => match lang {
            LanguageId::Rust => {
                push_wrap("trait _T {", "}", None);
                push_wrap("impl _S {", "}", None);
            }
            LanguageId::Go => push_wrap("package _aice\ntype _I interface {", "}\n", None),
            LanguageId::Php => push_wrap("<?php class _C {", "}", None),
            _ => {
                push_wrap("class _C {", "}", None);
                if matches!(lang, LanguageId::Java | LanguageId::CSharp) {
                    push_wrap("interface _I {", "}", None);
                }
            }
        },
        PrefixContainer::RustTypeParen => {
            push_wrap("struct _S(", ");", None);
        }
        PrefixContainer::ValueParen => match lang {
            LanguageId::Php => push_wrap("<?php _aice_(", ");", Some("$_aice_")),
            _ => {
                push_wrap("_aice_(", ")", Some("_aice_"));
                push_wrap("_aice_(", ");", Some("_aice_"));
            }
        },
        PrefixContainer::ValueBracket => match lang {
            LanguageId::Php => push_wrap("<?php [", "];", Some("$_aice_")),
            LanguageId::C | LanguageId::Cpp => {
                push_wrap("void _aice_() { _aice_[", "]; }", Some("_aice_"));
                if !closes_self {
                    push_wrap("void _aice_() { _aice_[(", ")]; }", Some("_aice_"));
                }
            }
            _ => {
                push_wrap("[", "]", Some("_aice_"));
                push_wrap("[", "];", Some("_aice_"));
                push_wrap("let _v = [", "];", Some("_aice_"));
            }
        },
        PrefixContainer::TypeParen => {
            push_wrap("type _T = (", ");", None);
            push_wrap("type _T = (", ") => void;", None);
        }
        PrefixContainer::TypeBracket => push_wrap("type _T = [", "];", None),
        PrefixContainer::ValueBrace => match lang {
            LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => {
                push_wrap("const _v = {", "};", None);
            }
            LanguageId::Rust => {
                push_wrap("{", "}", None);
                push_wrap("let _v = _S {", "};", None);
            }
            LanguageId::C | LanguageId::Cpp => push_wrap("int _v[] = {", "};", Some("0")),
            LanguageId::Java | LanguageId::CSharp => {
                push_wrap("int[] _v = {", "};", Some("0"));
                push_wrap("Object[] _v = {", "};", Some("null"));
            }
            LanguageId::Php => push_wrap("<?php [", "];", Some("$_aice_")),
            _ => {
                push_wrap("{", "}", Some("_aice_"));
                push_wrap("_v = {", "};", Some("_aice_"));
            }
        },
        PrefixContainer::StructLit => push_wrap("let _v = _S {", "};", None),
        _ => return true,
    }
    let is_js_value_paren = matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx)
        && ctx == PrefixContainer::ValueParen;
    cands.iter().any(|c| {
        if is_js_value_paren {
            let raw_ok = collect_r5_error_spans(lang, c, path, pool).is_ok_and(|s| s.is_empty())
                || collect_r5_error_spans(
                    lang,
                    &format!("function _aice_probe_() {{\n{c}\n}}"),
                    path,
                    pool,
                )
                .is_ok_and(|s| s.is_empty());
            raw_ok && cst_defect_profile(lang, c, path, pool).unclosed_quotes == 0
        } else {
            let p = cst_defect_profile(lang, c, path, pool);
            p.min_errs == 0 && p.unclosed_quotes == 0
        }
    })
}

pub(crate) fn is_cpp_lambda_capture_before_paren(hdr: &str) -> bool {
    let t = hdr.trim_end();
    if !t.ends_with(']') { return false; }
    let b = t.as_bytes();
    let (mut i, mut bd, mut pd, mut cd, mut lb_pos) = (b.len() - 1, 0usize, 0usize, 0usize, None);
    loop {
        match b[i] {
            b']' => bd += 1,
            b'[' => { bd = bd.saturating_sub(1); if bd == 0 && pd == 0 && cd == 0 { lb_pos = Some(i); break; } }
            b')' => pd += 1,
            b'(' => pd = pd.saturating_sub(1),
            b'}' => cd += 1,
            b'{' => cd = cd.saturating_sub(1),
            _ => {}
        }
        if i == 0 { break; }
        i -= 1;
    }
    let Some(lb) = lb_pos else { return false; };
    let pre = t[..lb].trim_end();
    let Some(last) = pre.chars().next_back() else { return true; };
    if matches!(last, ')' | ']' | '>') { return false; }
    if !last.is_ascii_alphanumeric() && last != '_' { return true; }
    let word = pre.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').next_back().unwrap_or("");
    matches!(word, "return" | "throw" | "co_return" | "co_yield" | "case" | "else")
}

pub(crate) fn classify_prefix_container(
    lang: LanguageId,
    prefix_lines: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> PrefixContainer {
    if !crate::r5::snippet_lex::is_code_lang(lang) || prefix_lines.is_empty() {
        return PrefixContainer::TopLevel;
    }
    let openers = crate::r5::snippet_ctx_scan::prefix_unclosed_openers(lang, prefix_lines, path, pool);
    if openers.is_empty() {
        return PrefixContainer::TopLevel;
    }
    let joined = prefix_lines.join("\n");
    crate::r5::snippet_container::classify_prefix_container_with_openers(lang, &joined, &openers)
}

pub(crate) fn unclosed_delim_positions_raw(lang: LanguageId, raw: &str) -> Vec<(u8, usize)> {
    let b = raw.as_bytes();
    let (slash, hash, mut i, mut js) = (has_slash_comments(lang), has_hash_comments(lang), 0usize, JsLexState::new());
    let mut stack: Vec<(u8, usize)> = Vec::new();
    let align = |idx: &mut usize| while *idx < b.len() && !raw.is_char_boundary(*idx) { *idx += 1; };
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); i += 1; continue; }
        match js.step_quote(lang, b, &mut i) {
            StepQuote::Consumed => { align(&mut i); continue; }
            StepQuote::EnteredInterp => { align(&mut i); stack.push((b'{', i.saturating_sub(1))); continue; }
            StepQuote::NotInQuote => {}
        }
        if js.open_quote(lang, b, &mut i) { align(&mut i); continue; }
        if let Some((mut end, _)) = js.match_special(lang, b, i) { align(&mut end); i = end; continue; }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//")) || (hash && is_hash_comment_at(b, i)) {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if slash && b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; };
            i = after; continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') { stack.push((b[i], i)); }
        else if matches!(b[i], b')' | b']' | b'}') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = stack.iter().rposition(|&(d, _)| d == want) { stack.remove(pos); }
        }
        js.step_byte(lang, b, &mut i);
        align(&mut i);
    }
    stack
}