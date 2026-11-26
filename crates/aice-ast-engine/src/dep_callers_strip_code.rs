use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_abort::{BashAbortState, BashBufs};
use crate::dep_callers_bash_hd::HeredocSubKind;
use crate::dep_callers_bash_lines::strip_bash_source;
use crate::dep_callers_bash_strip::BashStripState;
use crate::dep_callers_heredoc::HeredocTracker;
use crate::dep_callers_js_lex::JsRegexCtx;
use crate::dep_callers_lang_scan::{copy_single_quote, detect_rust_raw, rust_char_lit_len};
use crate::dep_callers_span::StripCfg;
use crate::dep_callers_strip::{ScanState, strip_line_inner};
use crate::dep_callers_tsx_step::step_jsx_text;

pub(crate) fn strip_comments_and_strings(src: &str, lang: LanguageId) -> (Vec<String>, Vec<String>) {
    let cfg = StripCfg::for_lang(lang);
    if lang == LanguageId::Bash {
        return strip_bash_source(src, &cfg);
    }
    let mut state = ScanState::Code;
    let mut tpl_stack = Vec::new();
    let mut bash = BashStripState::new();
    let mut abort = BashAbortState::default();
    let mut js_ctx = JsRegexCtx::new();
    let mut heredoc = HeredocTracker::default();
    let (mut imp_lines, mut code_lines) = (Vec::new(), Vec::new());
    for raw in src.lines() {
        let (imp, code) = if matches!(state, ScanState::Code) && heredoc.consume_line_if_active(lang, raw) {
            (String::new(), String::new())
        } else {
            let (mut imp, mut code) = (String::with_capacity(raw.len()), String::with_capacity(raw.len()));
            let mut dummy_il = Vec::new();
            let mut dummy_cl = Vec::new();
            let mut bufs = BashBufs {
                imp_lines: &mut dummy_il,
                code_lines: &mut dummy_cl,
                imp: &mut imp,
                code: &mut code,
            };
            strip_line_inner(
                raw, 0, &cfg, &mut state, &mut tpl_stack, &mut bash, &mut abort, &mut js_ctx,
                &mut heredoc, None, None, 0, true, &mut bufs,
            );
            (imp, code)
        };
        heredoc.flush_pending();
        imp_lines.push(imp);
        code_lines.push(code);
    }
    (imp_lines, code_lines)
}

#[allow(clippy::too_many_arguments)]
pub(crate) fn strip_line_bash(
    raw: &str,
    start_i: usize,
    cfg: &StripCfg,
    state: &mut ScanState,
    bash: &mut BashStripState,
    abort: &mut BashAbortState,
    heredoc: &mut HeredocTracker,
    prev_joined: Option<u8>,
    stop_kind: Option<HeredocSubKind>,
    skip_imp_bs: usize,
    allow_eol_cont: bool,
    bufs: &mut BashBufs<'_>,
) -> (Option<usize>, Option<usize>) {
    let mut tpl_stack = Vec::new();
    let mut js_ctx = JsRegexCtx::new();
    strip_line_inner(
        raw, start_i, cfg, state, &mut tpl_stack, bash, abort, &mut js_ctx, heredoc,
        prev_joined, stop_kind, skip_imp_bs, allow_eol_cont, bufs,
    )
}

#[allow(clippy::too_many_arguments)]
pub(super) fn step_non_bash_code_char(
    raw: &str,
    b: &[u8],
    i: usize,
    cfg: &StripCfg,
    state: &mut ScanState,
    tpl_stack: &mut Vec<usize>,
    js_ctx: &mut JsRegexCtx,
    imp: &mut String,
    code: &mut String,
) -> Option<usize> {
    if cfg.is_tsx && js_ctx.tsx.in_jsx_text() {
        return Some(step_jsx_text(raw, b, i, js_ctx, tpl_stack, imp, code));
    }
    if cfg.backtick_tpl && !tpl_stack.is_empty() {
        if b[i] == b'{' {
            if let Some(d) = tpl_stack.last_mut() { *d += 1; }
        } else if b[i] == b'}' && let Some(d) = tpl_stack.last_mut() {
            if *d == 0 {
                tpl_stack.pop();
                *state = ScanState::Backtick;
                if cfg.is_js { js_ctx.on_rbrace(); }
                imp.push('}');
                code.push('}');
                return Some(i + 1);
            }
            *d -= 1;
        }
    }
    if cfg.allow_triple && (raw[i..].starts_with("\"\"\"") || raw[i..].starts_with("'''")) {
        *state = ScanState::Triple { double: b[i] == b'"' };
        return Some(i + 3);
    }
    if cfg.lang == LanguageId::Rust && let Some((plen, hashes)) = detect_rust_raw(b, i) {
        *state = ScanState::RustRaw { hashes };
        imp.push('"');
        code.push('"');
        return Some(i + plen);
    }
    if cfg.lang == LanguageId::Rust && b[i] == b'\'' && let Some(len) = rust_char_lit_len(raw, i) {
        for out in [&mut *imp, &mut *code] {
            out.push('\''); for _ in 0..len.saturating_sub(2) { out.push(' '); } out.push('\'');
        }
        return Some(i + len);
    }
    if cfg.allow_backtick && b[i] == b'`' {
        if cfg.is_tsx { js_ctx.tsx.on_before_quote(true); }
        *state = ScanState::Backtick;
        imp.push('`');
        code.push('`');
        return Some(i + 1);
    }
    if cfg.lang != LanguageId::Bash && (b[i] == b'"' || (cfg.allow_sq && b[i] == b'\'')) {
        if cfg.is_tsx { js_ctx.tsx.on_before_quote(false); }
        let ni = copy_single_quote(raw, b, i, imp, code);
        if cfg.is_js { js_ctx.on_expr_end(); }
        return Some(ni);
    }
    None
}
