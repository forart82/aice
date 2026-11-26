use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::collect_r5_error_spans;
use crate::r5::snippet_blk::find_blk_comment_close;
use crate::r5::snippet_cst::{cst_defect_profile, line_delim_detail};
use crate::r5::snippet_hdr::{has_depth0_assign, has_unclosed_rust_angle};
use crate::r5::snippet_lit::{JsLexState, StepQuote};
use crate::r5::snippet_rs_angle::{
    has_depth0_single_colon, strip_rust_comments_strings, unclosed_rust_angles_after,
};
use crate::r5::snippet_rs_attr::{rust_attr_no_close_verdict, rust_attr_tail_start};
use crate::r5::snippet_rs_hdr::{is_rust_type_hdr, scan_rust_hdr_to};
use crate::r5::snippet_rs_probe::{
    rust_fresh_cand_verdict, rust_in_ctx_probe, rust_suffix_close_prefix, rust_try_trailing_impl_item,
};
use crate::r5::snippet_rs_tail::{rust_enum_tail_ends_with_attr, rust_scan_container_tail};
use crate::ts_pool::ParserPool;

fn rust_tail_after_rbrace(cand_clean: &str, rbraces: usize) -> bool {
    let (mut d, mut seen) = (0usize, 0usize);
    for (idx, &ch) in cand_clean.as_bytes().iter().enumerate() {
        if ch == b'{' { d += 1; }
        else if ch == b'}' {
            if d > 0 { d -= 1; }
            else {
                seen += 1;
                if seen == rbraces { return !cand_clean[idx + 1..].trim().is_empty(); }
            }
        }
    }
    false
}

pub(crate) fn rust_type_container_insert_verdict(
    lang: LanguageId,
    prefix_lines: &[&str],
    cand_norm: &[&str],
    suffix_lines: &[&str],
    path: &Path,
    pool: &mut ParserPool,
) -> Option<bool> {
    if lang != LanguageId::Rust || prefix_lines.is_empty() || cand_norm.is_empty() {
        return None;
    }
    let prefix = prefix_lines.join("\n");
    let b = prefix.as_bytes();
    let (mut i, mut js, mut lbraces, mut delims, mut unclosed_sp) = (0usize, JsLexState::new(), Vec::new(), Vec::new(), false);
    while i < b.len() {
        if b[i] == b'\n' { js.on_newline(lang); i += 1; continue; }
        if js.step_quote(lang, b, &mut i) != StepQuote::NotInQuote { continue; }
        if let Some((end, closed)) = js.match_special(lang, b, i) { if !closed { unclosed_sp = true; } i = end; continue; }
        if js.open_quote(lang, b, &mut i) { continue; }
        if b[i..].starts_with(b"//") {
            while i < b.len() && b[i] != b'\n' { i += 1; }
            continue;
        }
        if b[i..].starts_with(b"/*") {
            let (Some(after), _) = find_blk_comment_close(lang, b, i + 2, 1) else { return None; };
            i = after;
            continue;
        }
        if matches!(b[i], b'(' | b'[' | b'{') {
            delims.push((b[i], i));
            if b[i] == b'{' { lbraces.push(i); }
        } else if matches!(b[i], b')' | b']' | b'}') {
            let want = match b[i] { b')' => b'(', b']' => b'[', _ => b'{' };
            if let Some(pos) = delims.iter().rposition(|&(d, _)| d == want) {
                if b[i] == b'}' {
                    delims.truncate(pos);
                    lbraces.pop();
                } else {
                    delims.remove(pos);
                }
            }
        }
        js.step_byte(lang, b, &mut i);
    }
    let has_unclosed_quote = unclosed_sp || js.active_quote_start().is_some();
    let &open_pos = lbraces.last()?;
    let line_idx = prefix[..open_pos].bytes().filter(|&c| c == b'\n').count();
    let hdr = scan_rust_hdr_to(prefix_lines, &prefix, open_pos, line_idx, 0);
    let (mut full_hdr, mut base_layers) = if is_rust_type_hdr(&hdr) {
        (hdr, 1usize)
    } else if lbraces.len() >= 2 {
        let outer_pos = lbraces[lbraces.len() - 2];
        let outer_line = prefix[..outer_pos].bytes().filter(|&c| c == b'\n').count();
        let outer_hdr = scan_rust_hdr_to(prefix_lines, &prefix, outer_pos, outer_line, 0);
        let inner_hdr = scan_rust_hdr_to(prefix_lines, &prefix, open_pos, line_idx, outer_pos + 1);
        let is_enum = is_rust_type_hdr(&outer_hdr)
            && strip_rust_comments_strings(&outer_hdr)
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .any(|w| w == "enum");
        let clean_hdr = strip_rust_comments_strings(&inner_hdr);
        let is_variant = clean_hdr
            .trim_start()
            .as_bytes()
            .first()
            .is_some_and(|&c| c.is_ascii_alphabetic() || c == b'_' || c == b'#')
            && !clean_hdr
                .split(|c: char| !c.is_ascii_alphanumeric() && c != '_')
                .any(|w| matches!(w, "fn" | "if" | "else" | "match" | "loop" | "for" | "while" | "let"));
        if !(is_enum && is_variant) {
            return None;
        }
        (format!("{outer_hdr}\n{inner_hdr}"), 2usize)
    } else {
        return None;
    };
    let cand_joined = cand_norm.join("\n");
    let cand_prof = cst_defect_profile(lang, &cand_joined, path, pool);
    let (c_stack, c_unm) = line_delim_detail(lang, &cand_joined, path, pool);
    if cand_prof.unclosed_quotes > 0 { return Some(false); }
    let open_after: Vec<(u8, usize)> = delims.iter().copied().filter(|&(d, pos)| pos > open_pos && matches!(d, b'(' | b'[')).collect();
    let unclosed_lts = if open_after.is_empty() { unclosed_rust_angles_after(&prefix, open_pos) } else { Vec::new() };
    let hdr_clean = strip_rust_comments_strings(&full_hdr);
    let hdr_words: Vec<&str> = hdr_clean.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').filter(|w| !w.is_empty()).collect();
    let is_enum = base_layers == 1 && hdr_words.contains(&"enum");
    let is_impl_trait = hdr_words.iter().any(|w| matches!(*w, "trait" | "impl"));
    let is_rust_container = is_impl_trait || hdr_words.iter().any(|w| matches!(*w, "struct" | "enum" | "union"));
    let rbraces = c_unm.iter().filter(|&&c| c == b'}').count();
    let cand_clean = strip_rust_comments_strings(&cand_joined);
    if rbraces >= base_layers && lbraces.len() >= rbraces {
        let tail_after_close = lbraces.len() > rbraces && rust_tail_after_rbrace(&cand_clean, rbraces);
        let target_layers = if tail_after_close { rbraces + 1 } else { rbraces };
        if target_layers > base_layers && target_layers <= lbraces.len() {
            let mut outers: Vec<String> = lbraces[lbraces.len() - target_layers..lbraces.len() - base_layers]
                .iter()
                .map(|&pos| scan_rust_hdr_to(prefix_lines, &prefix, pos, prefix[..pos].bytes().filter(|&c| c == b'\n').count(), 0))
                .collect();
            outers.push(full_hdr);
            full_hdr = outers.join("\n");
            base_layers = target_layers;
        }
    }
    let ok_snippet = |s: &str, p: &mut ParserPool| collect_r5_error_spans(lang, s, path, p).is_ok_and(|e| e.is_empty());
    let line_ctx = |op_pos: usize| {
        let op_line = prefix[..op_pos].bytes().filter(|&c| c == b'\n').count();
        let le = prefix[op_pos + 1..].find('\n').map_or(prefix.len(), |k| op_pos + 1 + k);
        let (sep, _) = rust_scan_container_tail(&prefix[open_pos + 1..op_pos], is_enum);
        let item_start = open_pos + 1 + sep;
        let bc = strip_rust_comments_strings(&prefix[item_start..op_pos]);
        let ac = strip_rust_comments_strings(&prefix[op_pos + 1..le]);
        (op_line, item_start, bc, ac)
    };
    let ctx_tail_for = |first_op_pos: usize| -> String {
        let (sep, _) = rust_scan_container_tail(&prefix[open_pos + 1..first_op_pos], is_enum);
        prefix[open_pos + 1 + sep..].to_string()
    };
    let verdict = (|| -> Option<bool> {
        if !open_after.is_empty() {
            if open_after.len() > 1 {
                if !is_rust_container { return None; }
                let (sep_after, _) = rust_scan_container_tail(&prefix[open_pos + 1..], is_enum);
                let last_op_pos = open_after.last().unwrap().1;
                let after_jump = open_pos + 1 + sep_after > last_op_pos;
                if after_jump && let Some(v) = rust_in_ctx_probe(&full_hdr, base_layers, is_impl_trait, &prefix[open_pos + 1 + sep_after..], &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                let last_in_attr = !after_jump && strip_rust_comments_strings(&prefix[open_pos + 1 + sep_after..last_op_pos]).rsplit(']').next().is_some_and(|s| s.contains('#'));
                if last_in_attr && !c_unm.contains(&b']') {
                    return rust_attr_no_close_verdict(&full_hdr, base_layers, has_unclosed_quote, &prefix[open_pos + 1..], cand_norm, &cand_joined, suffix_lines, path, pool);
                }
                let after_op = if after_jump { open_pos + 1 + sep_after } else { last_op_pos + 1 };
                if let Some(v) = rust_try_trailing_impl_item(&full_hdr, base_layers, is_impl_trait, last_in_attr, &prefix, after_op, &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                if !last_in_attr && let Some(v) = rust_fresh_cand_verdict(&full_hdr, base_layers, is_impl_trait, is_enum, &prefix[open_pos + 1 + sep_after..], &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                if after_jump { return None; }
                let tail_start = rust_attr_tail_start(&prefix, open_pos, last_op_pos, sep_after, is_enum, last_in_attr, &c_unm);
                return rust_in_ctx_probe(&full_hdr, base_layers, is_impl_trait, &prefix[tail_start..], &cand_joined, suffix_lines, path, pool);
            }
            let (op_d, op_pos) = open_after[0];
            let (op_line, _, before_clean, after_clean) = line_ctx(op_pos);
            let in_attr = before_clean.rsplit(']').next().is_some_and(|s| s.contains('#'));
            let tail = &prefix_lines[op_line + 1..];
            let tail_has_code = tail.iter().any(|l| !l.trim().is_empty());
            let after_attr = before_clean.rsplit(']').next().unwrap_or(&before_clean).trim();
            let looks_field_or_variant = has_depth0_single_colon(&before_clean)
                || (is_enum && op_d == b'(' && !after_attr.is_empty() && after_attr.bytes().all(|c| c.is_ascii_alphanumeric() || c == b'_'));
            let is_trivial_prebroken = !in_attr
                && !has_unclosed_rust_angle(&before_clean)
                && looks_field_or_variant
                && matches!(after_clean.trim(), "," | ";")
                && tail_has_code
                && ok_snippet(&format!("{full_hdr}\n{}\n{}", tail.join("\n"), "}".repeat(base_layers)), pool);
            if !is_trivial_prebroken {
                if !is_rust_container { return None; }
                let (sep_after, _) = rust_scan_container_tail(&prefix[open_pos + 1..], is_enum);
                let after_jump = open_pos + 1 + sep_after > op_pos;
                if after_jump && let Some(v) = rust_in_ctx_probe(&full_hdr, base_layers, is_impl_trait, &prefix[open_pos + 1 + sep_after..], &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                if !after_jump && in_attr && !c_unm.contains(&b']') {
                    return rust_attr_no_close_verdict(&full_hdr, base_layers, has_unclosed_quote, &prefix[open_pos + 1..], cand_norm, &cand_joined, suffix_lines, path, pool);
                }
                let trail_in_attr = !after_jump && in_attr;
                let after_op = if after_jump { open_pos + 1 + sep_after } else { op_pos + 1 };
                if let Some(v) = rust_try_trailing_impl_item(&full_hdr, base_layers, is_impl_trait, trail_in_attr, &prefix, after_op, &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                if !trail_in_attr && let Some(v) = rust_fresh_cand_verdict(&full_hdr, base_layers, is_impl_trait, is_enum, &prefix[open_pos + 1 + sep_after..], &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
                if after_jump { return None; }
                let has_type_kw = before_clean.split(|c: char| !c.is_ascii_alphanumeric() && c != '_').any(|w| w == "type");
                if is_impl_trait && !in_attr && !has_unclosed_rust_angle(&before_clean) && has_depth0_assign(&before_clean) && !has_type_kw {
                    return None;
                }
                let ctx_tail = ctx_tail_for(op_pos);
                return rust_in_ctx_probe(&full_hdr, base_layers, is_impl_trait, &ctx_tail, &cand_joined, suffix_lines, path, pool);
            }
        } else if !unclosed_lts.is_empty() {
            let op_pos = unclosed_lts[0];
            let (op_line, _, before_clean, after_clean) = line_ctx(op_pos);
            let in_attr = before_clean.rsplit(']').next().is_some_and(|s| s.contains('#'));
            let tail = &prefix_lines[op_line + 1..];
            let tail_has_code = tail.iter().any(|l| !l.trim().is_empty());
            let looks_field = has_depth0_single_colon(&before_clean);
            let is_trivial_prebroken = !in_attr
                && looks_field
                && matches!(after_clean.trim(), "," | ";")
                && tail_has_code
                && ok_snippet(&format!("{full_hdr}\n{}\n{}", tail.join("\n"), "}".repeat(base_layers)), pool);
            if !is_trivial_prebroken && is_rust_container {
                let ctx_tail = ctx_tail_for(op_pos);
                if let Some(v) = rust_in_ctx_probe(&full_hdr, base_layers, is_impl_trait, &ctx_tail, &cand_joined, suffix_lines, path, pool) {
                    return Some(v);
                }
            }
        }
        if is_rust_container && open_after.is_empty() {
            let (sep, saw_eq) = rust_scan_container_tail(&prefix[open_pos + 1..], is_enum);
            if saw_eq {
                let tail_item = &prefix[open_pos + 1 + sep..];
                if is_enum && rust_enum_tail_ends_with_attr(tail_item)
                    && let Some(v) = rust_fresh_cand_verdict(&full_hdr, base_layers, is_impl_trait, is_enum, tail_item, &cand_joined, suffix_lines, path, pool)
                {
                    return Some(v);
                }
                let has_code_suf = suffix_lines.iter().any(|l| !strip_rust_comments_strings(l).trim().is_empty());
                if has_code_suf {
                    let outer_r = "\n}".repeat(base_layers);
                    let Some(close_suf) = rust_suffix_close_prefix(tail_item, suffix_lines, false) else {
                        return Some(false);
                    };
                    let tail_clean = strip_rust_comments_strings(tail_item);
                    let tail_incomplete = tail_clean.trim_end().ends_with([
                        '<', '>', '+', '-', '*', '/', '%', '&', '|', '^', '=', '(', '[', '.', ',', ':',
                    ]);
                    if !tail_incomplete && !ok_snippet(&format!("{full_hdr}\n{tail_item}\n{close_suf}{outer_r}"), pool) {
                        return Some(false);
                    }
                    return Some(ok_snippet(&format!("{full_hdr}\n{tail_item}\n{cand_joined}\n{close_suf}{outer_r}"), pool));
                }
                if rbraces > base_layers { return Some(false); }
                let outer_r = "\n}".repeat(base_layers - rbraces);
                let term = if is_enum { "," } else { ";" };
                return Some(
                    ok_snippet(&format!("{full_hdr}\n{tail_item}\n{cand_joined}{outer_r}"), pool)
                        || ok_snippet(&format!("{full_hdr}\n{tail_item}\n{cand_joined}{term}{outer_r}"), pool),
                );
            }
        }
        if !ok_snippet(&format!("{full_hdr}{}", "\n}".repeat(base_layers)), pool) {
            return None;
        }
        if !c_stack.is_empty() || c_unm.len() > lbraces.len() || c_unm.iter().any(|&c| c != b'}') {
            return None;
        }
        let rem_closers = "\n}".repeat(base_layers - rbraces);
        Some(ok_snippet(&format!("{full_hdr}\n{cand_joined}{rem_closers}"), pool))
    })();
    if verdict == Some(false) && rbraces > 0 && !ok_snippet(&format!("{full_hdr}{}", "\n}".repeat(base_layers)), pool) {
        return None;
    }
    verdict
}