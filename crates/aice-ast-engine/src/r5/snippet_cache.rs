use std::cell::RefCell;
use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_blk::{ends_in_block_comment_with_regex, find_blk_comment_close};
use crate::r5::snippet_container::{PrefixContainer, classify_prefix_container_with_openers};
use crate::r5::snippet_cst::{resolve_slot, strip_trailing_comment, walk_cst_defects_cursor};
use crate::r5::snippet_ctx_scan::prefix_unclosed_openers_with_masked;
use crate::r5::snippet_lex::{has_hash_comments, has_slash_comments, is_code_lang, is_hash_comment_at};
use crate::r5::snippet_lit::{JsLexState, StepQuote, is_js_like};
use crate::ts_pool::{GrammarSlot, ParserPool};

type MaskCache = (Option<GrammarSlot>, String, Vec<(usize, usize)>, Vec<(usize, usize, bool)>);
thread_local! {
    static LAST_MASK_CACHE: RefCell<Option<MaskCache>> = const { RefCell::new(None) };
}

pub(crate) struct PrefixCache {
    pub(crate) joined: String,
    pub(crate) openers: Vec<(u8, usize, usize)>,
    pub(crate) blk_depth: usize,
    pub(crate) prefix_ctx: PrefixContainer,
    pub(crate) ctx_status: Option<(Option<Vec<String>>, bool)>,
    pub(crate) ts_arrow_ok: Option<bool>,
}

fn can_reuse_prefix_tree<'a>(
    full_base: &str,
    joined: &str,
    base_tree: Option<&'a tree_sitter::Tree>,
) -> Option<&'a tree_sitter::Tree> {
    let tree = base_tree?;
    if full_base.contains('\r') || full_base.get(..joined.len()) != Some(joined) {
        return None;
    }
    if joined.len() == full_base.len() {
        return Some(tree);
    }
    if full_base.as_bytes().get(joined.len()) != Some(&b'\n') {
        return None;
    }
    if joined.len() + 1 == full_base.len() {
        return Some(tree);
    }
    if joined.ends_with('\\') {
        return None;
    }
    let root = tree.root_node();
    if root
        .descendant_for_byte_range(joined.len(), joined.len() + 1)
        .is_some_and(|n| n.id() == root.id())
    {
        return Some(tree);
    }
    let tail = &full_base[joined.len()..];
    if !tail.contains("*/") && !tail.contains('/') && !tail.contains(['"', '\'', '`']) {
        let mut cur = (!joined.is_empty())
            .then(|| root.descendant_for_byte_range(joined.len() - 1, joined.len()))
            .flatten();
        while let Some(n) = cur {
            let k = n.kind();
            if (k == "regex" || k == "regex_literal" || k.contains("comment") || k.contains("string"))
                && n.end_byte() > joined.len()
            {
                return None;
            }
            cur = n.parent();
        }
        return Some(tree);
    }
    None
}

impl PrefixCache {
    pub(crate) fn new(
        lang: LanguageId,
        prefix_lines: &[&str],
        full_base: &str,
        _base_is_full_prefix: bool,
        base_tree: Option<&tree_sitter::Tree>,
        path: &Path,
        pool: &mut ParserPool,
    ) -> Self {
        let joined = prefix_lines.join("\n");
        let (mut masked, mut regex) = (Vec::new(), Vec::new());
        if is_code_lang(lang) {
            let slot_opt = resolve_slot(lang, &joined, path);
            let cache_hit = joined.len() >= 1024 && LAST_MASK_CACHE.with(|c| {
                if let Some((cs, cj, cm, cr)) = c.borrow().as_ref()
                    && *cs == slot_opt && cj == &joined
                {
                    masked = cm.clone();
                    regex = cr.clone();
                    true
                } else {
                    false
                }
            });
            if !cache_hit {
                let reuse_tree = can_reuse_prefix_tree(full_base, &joined, base_tree);
                let owned_tree = if reuse_tree.is_some() {
                    None
                } else {
                    slot_opt.and_then(|s| pool.parse_slot(s, &joined).ok())
                };
                if let Some(tree) = owned_tree.as_ref().or(reuse_tree) {
                    let (mut e, mut m) = (0, 0);
                    walk_cst_defects_cursor(
                        tree, 0, joined.len(), &mut e, &mut m, &mut masked, Some(&mut regex),
                    );
                }
            }
        }
        let openers = if is_code_lang(lang) {
            prefix_unclosed_openers_with_masked(lang, &joined, &masked)
        } else {
            Vec::new()
        };
        let blk_depth = if has_slash_comments(lang) && prefix_lines.iter().any(|l| l.contains("/*")) {
            ends_in_block_comment_with_regex(lang, &joined, &regex)
        } else {
            0
        };
        let prefix_ctx = if is_code_lang(lang) && !openers.is_empty() {
            classify_prefix_container_with_openers(lang, &joined, &openers)
        } else {
            PrefixContainer::TopLevel
        };
        Self {
            joined,
            openers,
            blk_depth,
            prefix_ctx,
            ctx_status: None,
            ts_arrow_ok: None,
        }
    }
}

pub(crate) fn last_code_line_idx(
    lang: LanguageId,
    lines: &[&str],
    pool: &mut ParserPool,
) -> Option<usize> {
    last_code_line_idx_with_tree(lang, lines, "", None, pool)
}

pub(crate) fn last_code_line_idx_with_tree(
    lang: LanguageId,
    lines: &[&str],
    full_base: &str,
    base_tree: Option<&tree_sitter::Tree>,
    pool: &mut ParserPool,
) -> Option<usize> {
    if lines.is_empty() {
        return None;
    }
    if !is_code_lang(lang) {
        return lines.iter().rposition(|l| !l.trim().is_empty());
    }
    let slash = has_slash_comments(lang);
    for idx in (0..lines.len()).rev() {
        let l = lines[idx];
        if l.trim().is_empty() {
            continue;
        }
        if slash && l.contains("*/") {
            return last_code_line_forward(lang, lines, full_base, base_tree, pool)
                .or_else(|| lines.iter().rposition(|x| !x.trim().is_empty()));
        }
        if !strip_trailing_comment(lang, l, pool).is_empty() {
            return Some(idx);
        }
    }
    lines.iter().rposition(|l| !l.trim().is_empty())
}

fn last_code_line_forward(
    lang: LanguageId,
    lines: &[&str],
    full_base: &str,
    base_tree: Option<&tree_sitter::Tree>,
    pool: &mut ParserPool,
) -> Option<usize> {
    let joined = lines.join("\n");
    let masked = if is_js_like(lang) && lines.iter().any(|l| l.contains("/*")) {
        let mut rx = Vec::new();
        let reuse_tree = can_reuse_prefix_tree(full_base, &joined, base_tree);
        let owned_tree = if reuse_tree.is_some() {
            None
        } else {
            resolve_slot(lang, &joined, Path::new("")).and_then(|s| pool.parse_slot(s, &joined).ok())
        };
        if let Some(tree) = owned_tree.as_ref().or(reuse_tree) {
            let (mut e, mut m, mut masked_all) = (0, 0, Vec::new());
            walk_cst_defects_cursor(tree, 0, joined.len(), &mut e, &mut m, &mut masked_all, Some(&mut rx));
            if joined.len() >= 1024
                && let Some(slot) = resolve_slot(lang, &joined, Path::new(""))
            {
                LAST_MASK_CACHE.with(|c| {
                    *c.borrow_mut() = Some((Some(slot), joined.clone(), masked_all, rx.clone()));
                });
            }
        }
        rx
    } else {
        Vec::new()
    };
    let b = joined.as_bytes();
    let (slash, hash) = (has_slash_comments(lang), has_hash_comments(lang));
    let (mut js, mut i, mut m_idx, mut line_idx) = (JsLexState::new(), 0usize, 0usize, 0usize);
    let mut last_code: Option<usize> = None;
    let mut last_byte: Option<u8> = None;
    let mut rbrace_slash_bracket = false;
    while i < b.len() {
        while m_idx < masked.len() && masked[m_idx].1 <= i {
            m_idx += 1;
        }
        if m_idx < masked.len() && i == masked[m_idx].0 {
            let (s, end, is_rx) = masked[m_idx];
            if !is_rx
                || (js.saw_paren_nl_decl && last_byte != Some(b'}') && !rbrace_slash_bracket)
            {
                let prev = i;
                let mut tmp = 0;
                js.step_masked(lang, b, &mut tmp, &[(s, end)], &mut i);
                m_idx += 1;
                rbrace_slash_bracket = false;
                last_code = Some(line_idx);
                line_idx += b[prev..i].iter().filter(|&&c| c == b'\n').count();
                if end > 0 && end <= b.len() { last_byte = Some(b[end - 1]); }
                continue;
            }
        }
        if b[i] == b'\n' {
            rbrace_slash_bracket = false;
            js.on_newline(lang);
            line_idx += 1;
            i += 1;
            continue;
        }
        let prev_q = i;
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote {
            rbrace_slash_bracket = false;
            last_code = Some(line_idx);
            line_idx += b[prev_q..i].iter().filter(|&&c| c == b'\n').count();
            if i > 0 { last_byte = Some(b[i - 1]); }
            continue;
        }
        if let Some((end, _)) = js.match_special(lang, b, i) {
            rbrace_slash_bracket = false;
            last_code = Some(line_idx);
            line_idx += b[i..end].iter().filter(|&&c| c == b'\n').count();
            i = end;
            if i > 0 { last_byte = Some(b[i - 1]); }
            continue;
        }
        if js.open_quote(lang, b, &mut i) {
            rbrace_slash_bracket = false;
            last_code = Some(line_idx);
            if i > 0 { last_byte = Some(b[i - 1]); }
            continue;
        }
        if (slash && lang != LanguageId::Css && b[i..].starts_with(b"//")) || (hash && is_hash_comment_at(b, i)) {
            rbrace_slash_bracket = false;
            js.just_closed_paren_nl_decl = false;
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if slash && b[i..].starts_with(b"/*") {
            rbrace_slash_bracket = false;
            js.just_closed_paren_nl_decl = false;
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { break; };
            line_idx += b[i..after].iter().filter(|&&c| c == b'\n').count();
            i = after;
            continue;
        }
        let prev = i;
        let was_rbrace = last_byte == Some(b'}');
        js.step_byte(lang, b, &mut i);
        if let Some(&last) = b[prev..i].iter().rfind(|c| !c.is_ascii_whitespace()) {
            if was_rbrace && last == b'/' && b.get(i) == Some(&b'[') {
                rbrace_slash_bracket = true;
            } else if !(rbrace_slash_bracket && last == b'[') {
                rbrace_slash_bracket = false;
            }
            last_code = Some(line_idx);
            last_byte = Some(last);
        }
    }
    last_code
}
