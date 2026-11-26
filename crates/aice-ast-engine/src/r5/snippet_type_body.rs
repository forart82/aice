use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::snippet_closed::closed_non_op_completable_ok;
use crate::r5::snippet_cst::cst_defect_profile;
use crate::r5::snippet_hunk::strip_hunk_trailing_comment;
use crate::r5::snippet_probe::min_snippet_errors;
use crate::ts_pool::ParserPool;

pub(crate) const TB_STRUCT: u8 = 1;
pub(crate) const TB_ENUM: u8 = 2;
pub(crate) const TB_IFACE: u8 = 4;
pub(crate) const TB_PARAM: u8 = 8;
pub(crate) const TB_TYPE_MASK: u8 = TB_STRUCT | TB_ENUM | TB_IFACE;

fn type_body_wrappers(lang: LanguageId, joined: &str, mask: u8) -> Vec<(u8, String)> {
    let mut cands = Vec::new();
    if mask & TB_STRUCT != 0 {
        if lang == LanguageId::Go {
            cands.push((TB_STRUCT, format!("package _aice\ntype _S struct {{\n{joined}\n}}\n")));
        } else {
            cands.push((TB_STRUCT, format!("struct _S {{\n{joined}\n}}")));
        }
    }
    if mask & TB_ENUM != 0 {
        cands.push((TB_ENUM, format!("enum _E {{\n{joined}\n}}")));
    }
    if mask & TB_IFACE != 0 && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
        cands.push((TB_IFACE, format!("interface _I {{\n{joined}\n}}")));
    }
    if mask & TB_PARAM != 0 {
        match lang {
            LanguageId::Rust => cands.push((TB_PARAM, format!("fn _aice_(\n{joined}\n) {{}}"))),
            LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
                cands.push((TB_PARAM, format!("function _aice_(\n{joined}\n) {{}}")));
            }
            LanguageId::C
            | LanguageId::Cpp
            | LanguageId::Java
            | LanguageId::CSharp
            | LanguageId::Dart => {
                cands.push((TB_PARAM, format!("void _aice_(\n{joined}\n) {{}}")));
            }
            LanguageId::Go => {
                cands.push((TB_PARAM, format!("package _aice\nfunc _aice_(\n{joined}\n) {{}}\n")));
            }
            LanguageId::Python => {
                cands.push((TB_PARAM, format!("def _aice_(\n{joined}\n): pass")));
            }
            LanguageId::Php => {
                cands.push((TB_PARAM, format!("<?php function _aice_(\n{joined}\n) {{}}")));
            }
            _ => {}
        }
    }
    cands
}

pub(crate) fn is_type_body_compatible_for(
    lang: LanguageId,
    joined: &str,
    mask: u8,
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if mask == 0 {
        return false;
    }
    type_body_wrappers(lang, joined, mask).into_iter().any(|(_, cand)| {
        let p = cst_defect_profile(lang, &cand, path, pool);
        p.min_errs == 0 && p.unclosed_quotes == 0
    })
}

pub(crate) fn bh_type_body_mask(
    lang: LanguageId,
    bh: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> u8 {
    if bh.is_empty() {
        return 0;
    }
    let joined = bh.join("\n");
    if min_snippet_errors(lang, &joined, path, pool) == 0 {
        let kw_stmt = |t: &str, kw: &str| {
            t.strip_prefix(kw).is_some_and(|r| r.is_empty() || r.starts_with(|c: char| c.is_whitespace() || c == ';'))
        };
        if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
            let looks_ts_prop = bh.iter().any(|l| {
                strip_hunk_trailing_comment(lang, l).trim().contains(':')
            }) && !bh.iter().any(|l| {
                let t = strip_hunk_trailing_comment(lang, l).trim();
                (t.contains('(') && !t.contains(':'))
                    || t.starts_with("let ")
                    || t.starts_with("const ")
                    || t.starts_with("var ")
                    || kw_stmt(t, "return")
                    || kw_stmt(t, "break")
                    || kw_stmt(t, "continue")
                    || kw_stmt(t, "debugger")
                    || kw_stmt(t, "throw")
                    || t.starts_with("case ")
                    || t.starts_with("default:")
                    || t.starts_with("if ")
                    || t.starts_with("for ")
                    || t.starts_with("while ")
                    || (t.contains('=') && !t.contains("=>"))
            });
            if looks_ts_prop
                && min_snippet_errors(lang, &format!("interface _I {{\n{joined}\n}}"), path, pool) == 0
            {
                return TB_IFACE;
            }
        }
        return 0;
    }
    let mut mask = 0u8;
    for (kind, cand) in type_body_wrappers(lang, &joined, TB_TYPE_MASK | TB_PARAM) {
        if min_snippet_errors(lang, &cand, path, pool) == 0 {
            mask |= kind;
        }
    }
    if mask & TB_TYPE_MASK != 0 {
        mask &= !TB_PARAM;
    }
    mask
}

pub(crate) fn bh_looks_like_type_body(
    lang: LanguageId,
    bh: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    bh_type_body_mask(lang, bh, path, pool) != 0
}

fn is_ident_str(s: &str) -> bool {
    !s.is_empty()
        && (s.as_bytes()[0].is_ascii_alphabetic() || s.as_bytes()[0] == b'_')
        && s.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'_')
}

fn is_enum_variant_line(t: &str) -> bool {
    let core = t.strip_suffix(',').unwrap_or(t).trim_end();
    if is_ident_str(core) {
        return true;
    }
    if let Some((lhs, rhs)) = core.split_once('=')
        && !rhs.starts_with(['=', '>'])
        && !lhs.ends_with(['!', '<', '>'])
    {
        return is_ident_str(lhs.trim()) && !rhs.trim().is_empty();
    }
    if core.ends_with(')') && let Some((lhs, _)) = core.split_once('(') {
        return is_ident_str(lhs.trim());
    }
    if core.ends_with('}') && let Some((lhs, _)) = core.split_once('{') {
        return is_ident_str(lhs.trim());
    }
    false
}

fn bh_looks_like_ts_iface_props(lang: LanguageId, bh: &[&str]) -> bool {
    matches!(lang, LanguageId::TypeScript | LanguageId::Tsx)
        && bh.iter().all(|l| {
            let t = strip_hunk_trailing_comment(lang, l).trim();
            if t.is_empty() {
                return true;
            }
            if t.contains('=') {
                return false;
            }
            let body = t.strip_suffix([',', ';']).unwrap_or(t).trim_end();
            let Some((lhs, rhs)) = body.split_once(':') else { return false; };
            let key = lhs.trim();
            let key = key
                .strip_prefix("readonly")
                .filter(|r| r.starts_with(char::is_whitespace))
                .map_or(key, str::trim_start);
            let key = key.strip_suffix('?').unwrap_or(key).trim_end();
            let val = rhs.trim();
            is_ident_str(key)
                && !val.is_empty()
                && !val.bytes().all(|b| b.is_ascii_digit())
                && !val.starts_with(['"', '\''])
        })
}

pub(crate) fn bh_looks_like_container_body(
    lang: LanguageId,
    bh: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> bool {
    if bh.is_empty() {
        return false;
    }
    if bh_looks_like_ts_iface_props(lang, bh)
        && (bh_type_body_mask(lang, bh, path, pool) & TB_IFACE != 0)
    {
        return false;
    }
    let joined = bh.join("\n");
    if min_snippet_errors(lang, &joined, path, pool) > 0 {
        let is_enum_shape = bh.iter().all(|l| {
            let t = strip_hunk_trailing_comment(lang, l).trim();
            t.is_empty() || is_enum_variant_line(t)
        });
        if is_enum_shape && (bh_type_body_mask(lang, bh, path, pool) & TB_ENUM != 0) {
            return false;
        }
        return closed_non_op_completable_ok(lang, &joined, false, true, path, pool);
    }
    let has_container_cue = bh.iter().any(|l| {
        strip_hunk_trailing_comment(lang, l).trim().ends_with(',')
    });
    has_container_cue
        && !bh.iter().any(|l| {
            let t = strip_hunk_trailing_comment(lang, l).trim();
            t.ends_with(';')
                || t.starts_with("let ")
                || t.starts_with("const ")
                || t.starts_with("var ")
                || t.starts_with("return ")
        })
}
