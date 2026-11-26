use std::path::Path;
use aice_lang_registry::LanguageId;
use crate::r5::checks::{collect_r5_error_spans, is_dtd_path};
use crate::r5::checks_tags::{find_rawtext_close, is_html_void};
use crate::r5::snippet_del_suf::{find_xml_decl_end, step_nl_check, step_nl_slice, xml_pi_valid};
use crate::ts_pool::ParserPool;

fn xml_scan_core(
    lang: LanguageId,
    lines: &[&str],
    skip_rawtext: bool,
    build_skel: bool,
    stop_base: Option<usize>,
) -> (Vec<(usize, String)>, usize, usize, String, Option<usize>) {
    let (is_xml, src) = (lang == LanguageId::Xml, lines.join("\n"));
    let (b, mut i, mut ln_idx, mut stk, mut unm, mut top) =
        (src.as_bytes(), 0usize, 0usize, Vec::<(usize, String)>::new(), 0usize, 0usize);
    let (mut saw_d0, mut saw_dt, mut skel) = (false, false, String::new());
    if is_xml && src.starts_with('\u{FEFF}') {
        if build_skel { skel.push('\u{FEFF}'); }
        i = 3;
    }
    while i < b.len() {
        let at_d0 = stk.is_empty();
        if b[i] != b'<' {
            if is_xml && at_d0 && !b[i].is_ascii_whitespace() {
                let st = i;
                while i < b.len() && b[i] != b'<' {
                    if b[i] == b'\n' && let Some(end) = step_nl_check(&mut ln_idx, stop_base, at_d0) {
                        return (stk, unm, top, skel, Some(end));
                    }
                    i += 1;
                }
                unm += 1;
                saw_d0 = true;
                if build_skel { skel.push_str(&src[st..i]); }
                continue;
            }
            if b[i] == b'\n' && let Some(end) = step_nl_check(&mut ln_idx, stop_base, at_d0) {
                return (stk, unm, top, skel, Some(end));
            }
            if build_skel && at_d0 { skel.push(b[i] as char); }
            i += 1;
            continue;
        }
        if b[i..].starts_with(b"<!--") {
            let Some(r) = b[i + 4..].windows(3).position(|w| w == b"-->") else {
                unm += 1;
                if let Some(end) = step_nl_slice(&b[i + 4..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                if build_skel && at_d0 { skel.push_str(&src[i..]); }
                break;
            };
            if let Some(end) = step_nl_slice(&b[i + 4..i + 7 + r], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
            if is_xml && at_d0 { saw_d0 = true; }
            if build_skel && at_d0 { skel.push_str(&src[i..i + 7 + r]); }
            i += 7 + r;
            continue;
        }
        if b[i..].starts_with(b"<![CDATA[") {
            if is_xml && at_d0 { unm += 1; saw_d0 = true; }
            let Some(r) = b[i + 9..].windows(3).position(|w| w == b"]]>") else {
                unm += 1;
                if let Some(end) = step_nl_slice(&b[i + 9..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                if build_skel && at_d0 { skel.push_str(&src[i..]); }
                break;
            };
            if let Some(end) = step_nl_slice(&b[i + 9..i + 12 + r], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
            if build_skel && at_d0 { skel.push_str(&src[i..i + 12 + r]); }
            i += 12 + r;
            continue;
        }
        if b[i..].starts_with(b"<?") {
            if !is_xml {
                let Some(r) = b[i + 2..].iter().position(|&c| c == b'>') else {
                    unm += 1;
                    if let Some(end) = step_nl_slice(&b[i + 2..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                    break;
                };
                if let Some(end) = step_nl_slice(&b[i + 2..i + 3 + r], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                i += 3 + r;
                continue;
            }
            let Some(r) = b[i + 2..].windows(2).position(|w| w == b"?>") else {
                unm += 1;
                if let Some(end) = step_nl_slice(&b[i + 2..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                if build_skel && at_d0 { skel.push_str(&src[i..]); }
                break;
            };
            if !xml_pi_valid(&src[i + 2..i + 2 + r], at_d0 && top == 0 && !saw_d0) { unm += 1; }
            if at_d0 { saw_d0 = true; }
            if build_skel && at_d0 { skel.push_str(&src[i..i + 4 + r]); }
            if let Some(end) = step_nl_slice(&b[i + 2..i + 4 + r], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
            i += 4 + r;
            continue;
        }
        if b[i..].starts_with(b"<!") {
            if !is_xml {
                let Some(r) = b[i + 2..].iter().position(|&c| c == b'>') else {
                    unm += 1;
                    if let Some(end) = step_nl_slice(&b[i + 2..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                    break;
                };
                if let Some(end) = step_nl_slice(&b[i + 2..i + 3 + r], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                i += 3 + r;
                continue;
            }
            let Some(g) = find_xml_decl_end(b, i + 2) else {
                unm += 1;
                if let Some(end) = step_nl_slice(&b[i + 2..], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
                if build_skel && at_d0 { skel.push_str(&src[i..]); }
                break;
            };
            let is_dt = src[i + 2..g].strip_prefix("DOCTYPE").is_some_and(|r| r.as_bytes().first().is_some_and(u8::is_ascii_whitespace));
            if !is_dt || !at_d0 || top > 0 || saw_dt { unm += 1; }
            if is_dt { saw_dt = true; }
            if at_d0 { saw_d0 = true; }
            if build_skel && at_d0 { skel.push_str(&src[i..=g]); }
            if let Some(end) = step_nl_slice(&b[i + 2..=g], &mut ln_idx, stop_base, at_d0) { return (stk, unm, top, skel, Some(end)); }
            i = g + 1;
            continue;
        }
        let close = b[i..].starts_with(b"</");
        let (ns, mut ne) = (i + 1 + usize::from(close), i + 1 + usize::from(close));
        while ne < b.len() && (b[ne].is_ascii_alphanumeric() || matches!(b[ne], b'-' | b'_' | b':' | b'.')) { ne += 1; }
        if ne == ns || !b.get(ns).is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_') {
            if is_xml && at_d0 { unm += 1; saw_d0 = true; }
            if build_skel && at_d0 { skel.push('<'); }
            i += 1;
            continue;
        }
        let (tag_ln, mut j, mut q, mut gt) = (ln_idx, ne, 0u8, None);
        while j < b.len() {
            if b[j] == b'\n' && let Some(end) = step_nl_check(&mut ln_idx, stop_base, at_d0) {
                return (stk, unm, top, skel, Some(end));
            }
            if q != 0 { if b[j] == q { q = 0; } }
            else if matches!(b[j], b'"' | b'\'') { q = b[j]; }
            else if b[j] == b'<' { break; }
            else if b[j] == b'>' { gt = Some(j); break; }
            j += 1;
        }
        let Some(g) = gt else {
            unm += 1;
            if is_xml && at_d0 { saw_d0 = true; }
            if build_skel && at_d0 { skel.push_str(&src[i..j]); }
            i = j;
            continue;
        };
        let tag = &src[ns..ne];
        if close {
            if let Some(p) = stk.iter().rposition(|(_, n)| if is_xml { n == tag } else { n.eq_ignore_ascii_case(tag) }) {
                unm += stk.len() - 1 - p;
                stk.truncate(p);
            } else {
                unm += 1;
                if is_xml && at_d0 { saw_d0 = true; }
                if build_skel && at_d0 { skel.push_str(&src[i..=g]); }
            }
        } else {
            if is_xml && at_d0 {
                top += 1;
                saw_d0 = true;
                if build_skel { skel.push_str("<_aice_/>"); }
            }
            if b[g - 1] != b'/' {
                if skip_rawtext && !is_xml && (tag.eq_ignore_ascii_case("script") || tag.eq_ignore_ascii_case("style")
                    || tag.eq_ignore_ascii_case("textarea") || tag.eq_ignore_ascii_case("title"))
                {
                    let norm = tag.to_ascii_lowercase();
                    if let Some(end_rel) = find_rawtext_close(&src[g + 1..], &norm) {
                        ln_idx += b[g + 1..g + 1 + end_rel].iter().filter(|&&c| c == b'\n').count();
                        i = g + 1 + end_rel;
                        continue;
                    }
                    stk.push((tag_ln, norm));
                    break;
                }
                if is_xml { stk.push((tag_ln, tag.to_string())); }
                else { let norm = tag.to_ascii_lowercase(); if !is_html_void(&norm) { stk.push((tag_ln, norm)); } }
            }
        }
        i = g + 1;
    }
    (stk, unm, top, skel, None)
}

pub(crate) fn xml_suf_close_end(lang: LanguageId, pfx_s: &[&str], raw_base: &[&str], suf: &[&str]) -> usize {
    let head_lines = pfx_s.len() + raw_base.len();
    if suf.is_empty() || head_lines == 0 { return 0; }
    xml_scan_core(lang, &[pfx_s, raw_base, suf].concat(), true, false, Some(head_lines - 1)).4.unwrap_or(suf.len())
}

pub(crate) fn html_scan_tags(lang: LanguageId, lines: &[&str], skip_rawtext: bool) -> (Vec<(usize, String)>, usize, usize) {
    let (stk, unm, top, _, _) = xml_scan_core(lang, lines, skip_rawtext, false, None); (stk, unm, top)
}
pub(crate) fn scan_html_open_tags(lang: LanguageId, lines: &[&str]) -> Vec<(usize, String)> { html_scan_tags(lang, lines, true).0 }
pub(crate) fn html_del_increases_imbalance(lang: LanguageId, pfx: &[&str], raw_base: &[&str], suf: &[&str], path: &Path) -> bool {
    if lang == LanguageId::Xml && is_dtd_path(path) { return false; }
    let (bs, bu, bt) = html_scan_tags(lang, &[pfx, raw_base, suf].concat(), true);
    let (cs, cu, ct) = html_scan_tags(lang, &[pfx, suf].concat(), true);
    cs.len() + cu > bs.len() + bu || (lang == LanguageId::Xml && bt >= 1 && ct == 0)
}
pub(crate) fn html_edit_increases_imbalance(lang: LanguageId, pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], path: &Path) -> bool {
    if lang == LanguageId::Xml && is_dtd_path(path) { return false; }
    let (bs, bu, bt) = html_scan_tags(lang, &[pfx, raw_base, suf].concat(), true);
    let (cs, cu, ct) = html_scan_tags(lang, &[pfx, raw_cand, suf].concat(), true);
    cs.len() + cu > bs.len() + bu || cu > bu || (lang == LanguageId::Xml && ((ct > 1 && ct > bt) || (bt >= 1 && ct == 0)))
}
pub(crate) fn html_xml_eof_close_ok(lang: LanguageId, pfx: &[&str], raw_cand: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
    if !matches!(lang, LanguageId::Html | LanguageId::Xml) || raw_cand.is_empty() || !raw_cand.join("\n").contains("</") { return false; }
    let stk = scan_html_open_tags(lang, pfx);
    let mut s_cands = Vec::new();
    for &(ln, _) in stk.iter().rev() { if !s_cands.contains(&ln) { s_cands.push(ln); if s_cands.len() == 6 { break; } } }
    for s in s_cands {
        let pfx_rem = scan_html_open_tags(lang, &pfx[s..]);
        let mut lines: Vec<&str> = pfx[s..].to_vec(); lines.extend_from_slice(raw_cand);
        let rem = scan_html_open_tags(lang, &lines);
        if rem.len() < pfx_rem.len() && rem.iter().all(|(ln, _)| *ln < pfx[s..].len()) {
            let mut probe = lines.join("\n");
            for (_, t) in rem.iter().rev() { probe.push_str(&format!("\n</{t}>")); }
            if collect_r5_error_spans(lang, &probe, path, pool).is_ok_and(|e| e.is_empty()) { return true; }
        }
    }
    false
}
#[allow(clippy::too_many_arguments)]
pub(crate) fn xml_midfile_fallback(
    er: Option<bool>, path: &Path, pool: &mut ParserPool,
    pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str],
) -> Option<bool> {
    if raw_cand.is_empty() || is_dtd_path(path) { return er; }
    if er != Some(false) && html_edit_increases_imbalance(LanguageId::Xml, pfx, raw_base, raw_cand, suf, path) { return Some(true); }
    let (pfx_stk, pfx_unm, pfx_top) = html_scan_tags(LanguageId::Xml, pfx, true);
    let scan_in = |sl: &[&str]| {
        if pfx_stk.is_empty() { return html_scan_tags(LanguageId::Xml, sl, true); }
        let (mut stk, unm, top) = html_scan_tags(LanguageId::Xml, &[&["<_aice_>"], sl].concat(), true);
        if stk.first().is_some_and(|(_, t)| t == "_aice_") { stk.remove(0); (stk, unm, top) } else { (Vec::new(), unm + 1, top) }
    };
    let (b_stk, b_unm, b_top) = if raw_base.is_empty() { (Vec::new(), 0, 0) } else { scan_in(raw_base) };
    let (c_stk, c_unm, c_top) = scan_in(raw_cand);
    let stk_same = b_unm == 0 && c_unm == 0 && b_stk.len() == c_stk.len() && b_stk.iter().zip(&c_stk).all(|(a, b)| a.1 == b.1);
    let close_xml = |sl: &[&str], stk: &[(usize, String)], wrap: bool| {
        let mut s = if wrap { format!("<_aice_>\n{}", sl.join("\n")) } else { sl.join("\n") };
        for (_, t) in stk.iter().rev() { s.push_str(&format!("\n</{t}>")); }
        if wrap { s.push_str("\n</_aice_>"); } else { s.push('\n'); }
        s
    };
    if pfx_stk.is_empty() && stk_same {
        let (_, _, _, base_skel, _) = xml_scan_core(LanguageId::Xml, &[pfx, raw_base, suf].concat(), true, true, None);
        let (_, _, _, cand_skel, _) = xml_scan_core(LanguageId::Xml, &[pfx, raw_cand, suf].concat(), true, true, None);
        let base_e = collect_r5_error_spans(LanguageId::Xml, &format!("{base_skel}\n"), path, pool).map_or(1, |e| e.len());
        let cand_e = collect_r5_error_spans(LanguageId::Xml, &format!("{cand_skel}\n"), path, pool).map_or(1, |e| e.len());
        if base_e == 0 && (cand_e > 0 || (c_stk.is_empty() && c_top == 0)) { return Some(cand_e > 0); }
        let wrap_d0 = |sl: &[&str], stk: &[(usize, String)], top: usize| {
            if !stk.is_empty() || top > 0 {
                let s = close_xml(sl, stk, false);
                if pfx_top == 0 { s } else { format!("<_aice_/>\n{s}") }
            } else if pfx_top == 0 { format!("{}\n<_aice_/>\n", sl.join("\n")) } else { format!("<_aice_/>\n{}\n", sl.join("\n")) }
        };
        let cb_e = if raw_base.is_empty() { 0 } else { collect_r5_error_spans(LanguageId::Xml, &wrap_d0(raw_base, &b_stk, b_top), path, pool).map_or(1, |e| e.len()) };
        if cb_e == 0 {
            return Some(collect_r5_error_spans(LanguageId::Xml, &wrap_d0(raw_cand, &c_stk, c_top), path, pool).map_or(1, |e| e.len()) > 0);
        }
        return er;
    }
    if er == Some(true) && pfx_unm == 0 && !pfx_stk.is_empty() && stk_same
        && (raw_base.is_empty() || collect_r5_error_spans(LanguageId::Xml, &close_xml(raw_base, &b_stk, true), path, pool).is_ok_and(|e| e.is_empty()))
    {
        return Some(collect_r5_error_spans(LanguageId::Xml, &close_xml(raw_cand, &c_stk, true), path, pool).map_or(1, |e| e.len()) > 0);
    }
    er
}
