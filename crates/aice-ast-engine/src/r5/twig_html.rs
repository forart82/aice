use crate::r5::checks::{ErrorSpan, collect_ts_error_spans};
use crate::r5::checks_tags::{check_html, check_unclosed_rawtext_tags, find_rawtext_close, scan_tag_name};
use crate::r5::twig_branches::build_twig_if_plan;
use crate::r5::twig_html_balance::check_control_html_balance;
use crate::r5::twig_lexer::{TwigTok, TwigTokKind};
use crate::ts_pool::{GrammarSlot, ParserPool};

#[derive(Debug, Clone, Copy)]
pub struct TwigSpan {
    pub start: usize,
    pub end: usize,
    pub is_output: bool,
}

fn rawtext_tag_name(s: &str, ts: usize, gt: usize) -> Option<String> {
    let te = scan_tag_name(s.as_bytes(), ts).min(gt);
    if te <= ts || s[te..gt].trim_end().ends_with('/') {
        return None;
    }
    let name = s[ts..te].to_ascii_lowercase();
    matches!(name.as_str(), "script" | "style" | "textarea" | "title").then_some(name)
}

pub fn mask_twig_for_html(src: &str, spans: &[TwigSpan]) -> String {
    let mut out = src.as_bytes().to_vec();
    let b = src.as_bytes();
    let mut in_tag_unquoted = vec![false; b.len()];
    let mut in_tag_name_span = vec![false; spans.len()];
    let (mut i, mut span_idx, mut in_html_tag, mut in_tag_name) = (0, 0, false, false);
    let (mut attr_quote, mut tag_start): (Option<u8>, Option<usize>) = (None, None);

    while i < b.len() {
        while span_idx < spans.len() && i >= spans[span_idx].end {
            span_idx += 1;
        }
        if span_idx < spans.len() && i >= spans[span_idx].start && i < spans[span_idx].end {
            if in_html_tag && attr_quote.is_none() {
                for flag in &mut in_tag_unquoted[spans[span_idx].start..spans[span_idx].end] {
                    *flag = true;
                }
                if in_tag_name && spans[span_idx].is_output {
                    in_tag_name_span[span_idx] = true;
                }
            }
            i = spans[span_idx].end;
            continue;
        }
        if !in_html_tag {
            if b[i..].starts_with(b"<!--") {
                if let Some(rel) = src[i + 4..].find("-->") {
                    i += 4 + rel + 3;
                    continue;
                }
                break;
            }
            if b[i] == b'<'
                && b.get(i + 1)
                    .is_some_and(|&c| c.is_ascii_alphabetic() || matches!(c, b'/' | b'!' | b'?' | b'{'))
            {
                in_html_tag = true;
                in_tag_name = true;
                tag_start = b[i + 1].is_ascii_alphabetic().then_some(i + 1);
            }
        } else if let Some(q) = attr_quote {
            if b[i] == q {
                attr_quote = None;
            }
        } else if b[i] == b'"' || b[i] == b'\'' {
            attr_quote = Some(b[i]);
            in_tag_name = false;
        } else if b[i] == b'>' {
            in_html_tag = false;
            in_tag_name = false;
            if let Some(ts) = tag_start.take()
                && let Some(raw) = rawtext_tag_name(src, ts, i)
                && let Some(rel) = find_rawtext_close(&src[i + 1..], &raw)
            {
                i += 1 + rel;
                continue;
            }
        } else if b[i].is_ascii_whitespace() || b[i] == b'=' {
            in_tag_name = false;
        }
        i += 1;
    }

    for (idx, sp) in spans.iter().enumerate() {
        let single_tag_name = in_tag_name_span[idx]
            && b.get(sp.end).is_none_or(|&c| c.is_ascii_whitespace() || c == b'>' || c == b'/');
        let mut wrote_x = false;
        for pos in sp.start..sp.end {
            if out[pos] == b'\n' || out[pos] == b'\r' {
                continue;
            }
            if !sp.is_output || !in_tag_unquoted[pos] {
                out[pos] = b' ';
            } else if single_tag_name {
                out[pos] = if !wrote_x { wrote_x = true; b'x' } else { b' ' };
            } else {
                out[pos] = b'x';
            }
        }
    }
    String::from_utf8(out).unwrap_or_else(|_| src.to_string())
}

pub fn verify_masked_html(
    masked: &str,
    _spans: &[TwigSpan],
    tokens: &[TwigTok],
    has_control_branches: bool,
    pool: &mut ParserPool,
) -> Vec<ErrorSpan> {
    let mut errors = Vec::new();
    if let Ok(tree) = pool.parse_slot(GrammarSlot::Html, masked) {
        errors.extend(collect_ts_error_spans(&tree, masked));
    }
    if has_control_branches {
        errors.extend(check_unclosed_rawtext_tags(masked));
        errors.extend(check_control_html_balance(masked, tokens, 0));
    } else {
        errors.extend(check_html(masked));
    }
    errors
}

fn merge_masks(masks: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut sorted = masks.to_vec();
    sorted.sort_unstable();
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(sorted.len());
    for (s, e) in sorted {
        if let Some(last) = merged.last_mut()
            && s <= last.1
        {
            last.1 = last.1.max(e);
        } else {
            merged.push((s, e));
        }
    }
    merged
}

fn in_masks(merged: &[(usize, usize)], s: usize, e: usize) -> bool {
    let idx = merged.partition_point(|m| m.0 <= s);
    idx > 0 && s >= merged[idx - 1].0 && e <= merged[idx - 1].1
}

fn filter_variant_tokens(tokens: &[TwigTok], masks: &[(usize, usize)], resolved_tags: &[usize]) -> (Vec<TwigTok>, bool) {
    let merged = merge_masks(masks);
    let mut rtags = resolved_tags.to_vec();
    rtags.sort_unstable();
    let active: Vec<TwigTok> = tokens
        .iter()
        .filter(|t| !in_masks(&merged, t.start_byte, t.end_byte) && rtags.binary_search(&t.start_byte).is_err())
        .cloned()
        .collect();
    let has_ctrl = active.iter().any(|t| {
        matches!(&t.kind, TwigTokKind::Tag { keyword, .. } if matches!(keyword.as_str(), "if" | "for" | "elseif" | "else"))
    });
    (active, has_ctrl)
}

fn filter_variant_spans(spans: &[TwigSpan], masks: &[(usize, usize)], resolved_tags: &[usize]) -> Vec<TwigSpan> {
    let merged = merge_masks(masks);
    let mut rtags = resolved_tags.to_vec();
    rtags.sort_unstable();
    spans
        .iter()
        .copied()
        .filter(|sp| !in_masks(&merged, sp.start, sp.end) && rtags.binary_search(&sp.start).is_err())
        .collect()
}

pub fn verify_twig_html(
    src: &str,
    tokens: &[TwigTok],
    spans: &[TwigSpan],
    has_control_branches: bool,
    pool: &mut ParserPool,
) -> Vec<ErrorSpan> {
    let masked = mask_twig_for_html(src, spans);
    let plan = build_twig_if_plan(&masked, tokens, is_in_html_tag);
    if plan.variants.is_empty() {
        return verify_masked_html(&masked, spans, tokens, has_control_branches, pool);
    }
    for vp in &plan.variants {
        let mut variant = masked.as_bytes().to_vec();
        for &(bs, be) in &vp.masks {
            for byte in &mut variant[bs..be] {
                if *byte != b'\n' && *byte != b'\r' {
                    *byte = b' ';
                }
            }
        }
        let v_str = String::from_utf8(variant).unwrap_or_else(|_| masked.clone());
        let (v_tokens, v_has_ctrl, v_spans) = if plan.has_unexpanded_ctrl {
            let (vt, vc) = filter_variant_tokens(tokens, &vp.masks, &vp.resolved_tags);
            let vs = if vc { filter_variant_spans(spans, &vp.masks, &vp.resolved_tags) } else { Vec::new() };
            (vt, vc, vs)
        } else {
            (Vec::new(), false, Vec::new())
        };
        let errs = verify_masked_html(&v_str, &v_spans, &v_tokens, v_has_ctrl, pool);
        if !errs.is_empty() {
            return errs;
        }
    }
    Vec::new()
}

fn is_in_html_tag(masked: &str, pos: usize) -> bool {
    let b = masked.as_bytes();
    let limit = pos.min(b.len());
    let (mut i, mut in_tag, mut quote, mut tag_start) = (0, false, None::<u8>, None::<usize>);
    while i < limit {
        if !in_tag {
            if b[i..].starts_with(b"<!--") {
                if let Some(rel) = masked[i + 4..].find("-->") {
                    i += 4 + rel + 3;
                    continue;
                }
                return false;
            }
            if b[i] == b'<'
                && b.get(i + 1).is_some_and(|&c| c.is_ascii_alphabetic() || matches!(c, b'/' | b'!' | b'?'))
            {
                in_tag = true;
                tag_start = b[i + 1].is_ascii_alphabetic().then_some(i + 1);
            }
        } else if let Some(q) = quote {
            if b[i] == q {
                quote = None;
            }
        } else if b[i] == b'"' || b[i] == b'\'' {
            quote = Some(b[i]);
        } else if b[i] == b'>' {
            in_tag = false;
            if let Some(ts) = tag_start.take()
                && let Some(raw) = rawtext_tag_name(masked, ts, i)
            {
                if let Some(rel) = find_rawtext_close(&masked[i + 1..limit], &raw) {
                    i += 1 + rel;
                    continue;
                }
                return false;
            }
        }
        i += 1;
    }
    in_tag && quote.is_none()
}
