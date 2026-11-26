use aice_lang_registry::LanguageId;

use crate::hybrid_lower_types::{CodeTok, PunctKind};

pub(crate) fn prev_non_ws<'a>(toks: &'a [CodeTok<'a>]) -> Option<&'a CodeTok<'a>> {
    toks.iter().rev().find(|t| !matches!(t, CodeTok::Ws(_)))
}

pub(crate) fn next_non_ws_idx(toks: &[CodeTok<'_>], mut i: usize) -> usize {
    while i < toks.len() && matches!(toks[i], CodeTok::Ws(_)) {
        i += 1;
    }
    i
}

pub(crate) fn is_ret_stmt(toks: &[CodeTok<'_>], after_idx: usize) -> bool {
    if !matches!(
        toks.get(after_idx),
        None | Some(CodeTok::Ws(_) | CodeTok::Punct(PunctKind::Semi | PunctKind::RBrace))
    ) {
        return false;
    }
    let j = next_non_ws_idx(toks, after_idx);
    match toks.get(j) {
        Some(CodeTok::Punct(
            PunctKind::Eq | PunctKind::ColonEq | PunctKind::ColonColonEq
            | PunctKind::Question | PunctKind::Comma | PunctKind::Colon
            | PunctKind::ColonColon | PunctKind::Arrow | PunctKind::FatArrow
            | PunctKind::Caret,
        )) => false,
        Some(CodeTok::Punct(PunctKind::Other('.' | '<' | '>' | '/' | '%' | '|'))) => false,
        Some(CodeTok::Punct(PunctKind::Other('!')))
            if matches!(toks.get(j + 1), Some(CodeTok::Punct(PunctKind::Eq))) => false,
        Some(CodeTok::Punct(PunctKind::Star))
            if matches!(toks.get(j + 1), Some(CodeTok::Ws(_) | CodeTok::Punct(PunctKind::Eq)))
                || (matches!(toks.get(j + 1), Some(CodeTok::Punct(PunctKind::Star)))
                    && matches!(
                        toks.get(j + 2),
                        Some(CodeTok::Ws(_) | CodeTok::Num(_) | CodeTok::Punct(PunctKind::Eq))
                    )) => false,
        Some(CodeTok::Punct(PunctKind::Other('+' | '-')))
            if matches!(toks.get(j + 1), Some(CodeTok::Ws(_) | CodeTok::Punct(PunctKind::Eq))) => false,
        Some(CodeTok::Punct(PunctKind::Other('&')))
            if matches!(
                toks.get(j + 1),
                Some(CodeTok::Ws(_) | CodeTok::Punct(PunctKind::Eq | PunctKind::Other('&')))
            ) => false,
        _ => true,
    }
}

pub(crate) fn has_stmt_decl_kw(out: &[CodeTok<'_>]) -> bool {
    for t in out.iter().rev() {
        match t {
            CodeTok::Punct(PunctKind::Semi | PunctKind::LBrace | PunctKind::RBrace | PunctKind::FatArrow | PunctKind::Eq) => {
                return false;
            }
            CodeTok::Word("let" | "const" | "var" | "val" | "mut" | "final" | "auto") => return true,
            _ => {}
        }
    }
    false
}

pub(crate) fn find_binding_insert_pos(out: &[CodeTok<'_>]) -> Option<usize> {
    let mut k = out.len();
    while k > 0 && matches!(out[k - 1], CodeTok::Ws(_)) {
        k -= 1;
    }
    if k == 0 { return None; }
    let mut stmt_start = k;
    while stmt_start > 0 {
        if matches!(
            out[stmt_start - 1],
            CodeTok::Punct(PunctKind::Semi | PunctKind::LBrace | PunctKind::RBrace | PunctKind::FatArrow)
        ) {
            break;
        }
        stmt_start -= 1;
    }
    while stmt_start < k && matches!(out[stmt_start], CodeTok::Ws(_)) {
        stmt_start += 1;
    }
    if stmt_start < k && matches!(out[stmt_start], CodeTok::Word(_)) {
        Some(stmt_start)
    } else {
        None
    }
}

pub(crate) fn is_vis_modifier(toks: &[CodeTok<'_>], i: usize, prev: Option<&CodeTok<'_>>) -> bool {
    if matches!(
        prev,
        Some(CodeTok::Punct(PunctKind::Other('.') | PunctKind::ColonColon | PunctKind::Arrow)
            | CodeTok::Word("const" | "let" | "var" | "val" | "mut"))
    ) {
        return false;
    }
    let j = next_non_ws_idx(toks, i + 1);
    let j2 = next_non_ws_idx(toks, j + 1);
    matches!(
        toks.get(j),
        Some(CodeTok::Word(
            "fn" | "cls" | "class" | "type" | "struct" | "enum" | "trait" | "interface"
                | "const" | "let" | "var" | "val" | "async" | "static" | "mut"
                | "readonly" | "def" | "func" | "fun" | "function" | "mod" | "use"
        ))
    ) || (matches!(toks.get(j), Some(CodeTok::Word(_)))
        && matches!(toks.get(j2), Some(CodeTok::Punct(PunctKind::Colon | PunctKind::Question) | CodeTok::Word(_))))
}

pub(crate) fn is_fn_kw(
    toks: &[CodeTok<'_>],
    i: usize,
    prev: Option<&CodeTok<'_>>,
    target: LanguageId,
) -> bool {
    if matches!(
        prev,
        Some(CodeTok::Punct(PunctKind::Other('.') | PunctKind::ColonColon | PunctKind::Arrow)
            | CodeTok::Word("const" | "let" | "var" | "val" | "mut"))
    ) {
        return false;
    }
    let j = next_non_ws_idx(toks, i + 1);
    if target == LanguageId::Php && matches!(toks.get(j), Some(CodeTok::Punct(PunctKind::LParen))) {
        return false;
    }
    if matches!(
        toks.get(j),
        None | Some(CodeTok::Punct(
            PunctKind::Eq | PunctKind::ColonEq | PunctKind::ColonColonEq | PunctKind::Semi
                | PunctKind::Comma | PunctKind::RParen | PunctKind::RBrack | PunctKind::Other('.')
        ))
    ) {
        return false;
    }
    if matches!(toks.get(j), Some(CodeTok::Punct(PunctKind::LParen))) {
        let mut depth = 0isize;
        let mut k = j;
        while k < toks.len() {
            match toks[k] {
                CodeTok::Punct(PunctKind::LParen) => depth += 1,
                CodeTok::Punct(PunctKind::RParen) => {
                    depth -= 1;
                    if depth == 0 {
                        let after = next_non_ws_idx(toks, k + 1);
                        return matches!(
                            toks.get(after),
                            Some(CodeTok::Punct(
                                PunctKind::FatArrow | PunctKind::Arrow | PunctKind::LBrace | PunctKind::Colon
                            ))
                        );
                    }
                }
                _ => {}
            }
            k += 1;
        }
        return false;
    }
    true
}
