use crate::py_walrus_cst::{WalrusHit, WalrusKind, scan_cst_raw};
use crate::py_walrus_diff::{changed_line_spans, delim_delta, leading_ws_len, line_starts, lines_ref};

fn tree_allows_tier1(src: &str, es: usize, ee: usize) -> bool {
    let Ok(tree) = aice_ast_engine::parse_slot(aice_ast_engine::GrammarSlot::Python, src) else {
        return true;
    };
    let root = tree.root_node();
    if !root.has_error() {
        return true;
    }
    let (mut has_err, mut max_pre_end, mut st) = (false, 0usize, vec![root]);
    while let Some(n) = st.pop() {
        if (n.is_error() || n.is_missing()) && n.start_position().row < ee {
            has_err = true;
            if n.start_position().row + 1 < es {
                max_pre_end = max_pre_end.max(n.end_position().row + 1);
            }
        }
        for i in (0..n.child_count()).rev() {
            if let Some(c) = n.child(i) { st.push(c); }
        }
    }
    if !has_err {
        return true;
    }
    let mut st2 = vec![root];
    while let Some(n) = st2.pop() {
        if matches!(n.kind(), "function_definition" | "class_definition") {
            let (sl, el) = (n.start_position().row + 1, n.end_position().row + 1);
            if sl > max_pre_end && sl <= es && el >= ee && !n.has_error() {
                return true;
            }
        }
        for i in (0..n.child_count()).rev() {
            if let Some(c) = n.child(i) { st2.push(c); }
        }
    }
    false
}

pub(crate) fn build_wrapped_slice(slice: &[&str], force_def_wrap: bool) -> (String, usize, usize, usize) {
    let min_i = slice.iter().filter(|l| !l.trim().is_empty()).map(|l| leading_ws_len(l)).min().unwrap_or(0);
    let dedented: Vec<&str> = slice.iter().map(|l| {
        if l.trim().is_empty() { "" } else { &l[min_i.min(leading_ws_len(l))..] }
    }).collect();
    let first_tr = dedented.iter().find(|l| !l.trim().is_empty()).map(|l| l.trim_start()).unwrap_or("");
    let (prefix, syn_lines, add_bytes) = if first_tr.starts_with("elif ") || first_tr.starts_with("else:") {
        ("if _aice_:\n    pass\n", 2usize, 0usize)
    } else if first_tr.starts_with("except") || first_tr.starts_with("finally:") {
        ("try:\n    pass\n", 2usize, 0usize)
    } else if first_tr.starts_with("case ") {
        ("match _aice_:\n", 1usize, 0usize)
    } else if (min_i > 0 || force_def_wrap)
        && !first_tr.starts_with("def ") && !first_tr.starts_with("async def ")
        && !first_tr.starts_with("class ") && !first_tr.starts_with('@')
    {
        ("async def _aice_():\n", 1usize, 4usize)
    } else {
        ("", 0usize, 0usize)
    };
    let mut out = String::from(prefix);
    for l in dedented {
        if !l.trim().is_empty() && add_bytes > 0 {
            out.push_str("    ");
        }
        out.push_str(l);
        out.push('\n');
    }
    (out, min_i, syn_lines, add_bytes)
}

fn has_err_before_line(src: &str, rel_es: usize) -> bool {
    let Ok(tree) = aice_ast_engine::parse_slot(aice_ast_engine::GrammarSlot::Python, src) else {
        return false;
    };
    let mut st = vec![tree.root_node()];
    while let Some(n) = st.pop() {
        if (n.is_error() || n.is_missing()) && n.start_position().row + 1 < rel_es {
            return true;
        }
        for i in (0..n.child_count()).rev() {
            if let Some(c) = n.child(i) { st.push(c); }
        }
    }
    false
}

pub(crate) fn remap_hits(
    raw_hits: Vec<WalrusHit>,
    lines: &[&str],
    starts: &[usize],
    w_starts: &[usize],
    map: (usize, usize, usize, usize),
) -> Vec<WalrusHit> {
    let (s_offset, syn_lines, min_i, add_bytes) = map;
    raw_hits.into_iter().filter_map(|h| {
        if h.line <= syn_lines { return None; }
        let w_idx = h.line - 1;
        let orig_idx = w_idx + s_offset - syn_lines;
        let orig_line = lines.get(orig_idx)?;
        let strip = min_i.min(leading_ws_len(orig_line));
        let add = if orig_line.trim().is_empty() { 0 } else { add_bytes };
        let col0 = strip + h.byte_offset.saturating_sub(*w_starts.get(w_idx)?).saturating_sub(add);
        Some(WalrusHit { line: orig_idx + 1, col: col0 + 1, byte_offset: starts.get(orig_idx)? + col0, kind: h.kind })
    }).collect()
}

fn isolate_and_classify(cand_lines: &[&str], cand_starts: &[usize], es: usize, ee: usize) -> Vec<WalrusHit> {
    if cand_lines.is_empty() || es == 0 || es > cand_lines.len() {
        return Vec::new();
    }
    let ee = ee.min(cand_lines.len()).max(es);
    let (es0, ee0) = (es - 1, ee - 1);
    let mut min_ind = cand_lines[es0..=ee0].iter().filter(|l| !l.trim().is_empty()).map(|l| leading_ws_len(l)).min().unwrap_or(usize::MAX);
    let (mut hdr_idx, mut i) = (None, es0);
    loop {
        let tr = cand_lines[i].trim_start();
        if !tr.is_empty() && !tr.starts_with('#') {
            let ind = leading_ws_len(cand_lines[i]);
            if (i == es0 || ind < min_ind) && (tr.starts_with("def ") || tr.starts_with("async def ") || tr.starts_with("class ")) {
                let mut h = i;
                while h > 0 && cand_lines[h - 1].trim_start().starts_with('@') && leading_ws_len(cand_lines[h - 1]) == ind {
                    h -= 1;
                }
                hdr_idx = Some(h);
                break;
            }
            min_ind = min_ind.min(ind);
            if min_ind == 0 && i < es0 && !tr.starts_with('@') { break; }
        }
        if i == 0 { break; }
        i -= 1;
    }
    let floor = hdr_idx.unwrap_or(0);
    let win_start = floor.max(es0.saturating_sub(64));
    let mut cands: Vec<usize> = hdr_idx.into_iter().flat_map(|h| [h, (h + 1).min(es0)]).collect();
    if let Some(tq) = (floor..win_start).rev().take(512).find(|&k| cand_lines[k].contains("\"\"\"") || cand_lines[k].contains("'''")) {
        cands.push(tq);
    }
    for k in win_start..=es0 {
        if k == win_start || k == es0 || cand_lines[k - 1].trim().is_empty()
            || cand_lines[k].contains("\"\"\"") || cand_lines[k].contains("'''")
            || (k < es0 && (leading_ws_len(cand_lines[k]) < leading_ws_len(cand_lines[k + 1]) || delim_delta(cand_lines[k]) > 0))
        {
            cands.push(k);
        }
    }
    cands.sort_unstable();
    cands.dedup();
    for &s in &cands {
        let s_ind = cand_lines[s..=ee0].iter().find(|l| !l.trim().is_empty()).map(|l| leading_ws_len(l)).unwrap_or(0);
        let s_tr = cand_lines[s].trim_start();
        let is_compound = s_tr.starts_with("if ") || s_tr.starts_with("elif ") || s_tr.starts_with("try:") || s_tr.starts_with("except") || s_tr.starts_with("match ");
        let (mut dq3, mut sq3) = cand_lines[s..=ee0].iter().filter(|l| !l.trim_start().starts_with('#'))
            .fold((0usize, 0usize), |(d, q), l| (d + l.matches("\"\"\"").count(), q + l.matches("'''").count()));
        let mut bal: i32 = cand_lines[s..=ee0].iter().map(|l| delim_delta(l)).sum();
        let mut e = ee0;
        for (k, line) in cand_lines.iter().enumerate().take((ee0 + 128).min(cand_lines.len() - 1) + 1).skip(ee0 + 1) {
            let kt = line.trim_start();
            let k_ind = leading_ws_len(line);
            let cont = dq3 % 2 == 1 || sq3 % 2 == 1 || bal > 0 || kt.is_empty() || kt.starts_with('#') || k_ind > s_ind
                || kt.starts_with([')', ']', '}']) || kt.starts_with("\"\"\"") || kt.starts_with("'''")
                || (is_compound && k_ind == s_ind && (kt.starts_with("elif ") || kt.starts_with("else:") || kt.starts_with("except") || kt.starts_with("finally:") || kt.starts_with("case ")));
            if !cont { break; }
            e = k;
            bal += delim_delta(line);
            if !kt.starts_with('#') { dq3 += line.matches("\"\"\"").count(); sq3 += line.matches("'''").count(); }
        }
        while e > ee0 && cand_lines[e].trim().is_empty() { e -= 1; }
        let (wrapped, min_i, syn_lines, add_bytes) = build_wrapped_slice(&cand_lines[s..=e], false);
        let (rel_es, rel_ee) = ((es0 - s) + 1 + syn_lines, (ee0 - s) + 1 + syn_lines);
        if s < es0 && has_err_before_line(&wrapped, rel_es) { continue; }
        let w_starts = line_starts(&wrapped);
        return remap_hits(scan_cst_raw(&wrapped, Some((rel_es, rel_ee)), true), cand_lines, cand_starts, &w_starts, (s, syn_lines, min_i, add_bytes));
    }
    Vec::new()
}

pub(crate) fn classify_delta_hits(base: Option<&str>, cand: &str, explicit_span: Option<(usize, usize)>, filter_base: bool) -> Vec<WalrusHit> {
    if !cand.contains(":=") { return Vec::new(); }
    let (cand_lines, cand_starts, base_lines) = (lines_ref(cand), line_starts(cand), base.map(lines_ref));
    if cand_lines.is_empty() { return Vec::new(); }
    let spans = match explicit_span {
        Some((es, ee)) if base.is_some() && ee.saturating_sub(es) > 16 => changed_line_spans(base, cand)
            .into_iter()
            .filter(|&(s, e)| s <= ee && e >= es)
            .map(|(s, e)| (s.max(es), e.min(ee)))
            .collect(),
        Some(s) => vec![s],
        None => changed_line_spans(base, cand),
    };
    if spans.is_empty() { return Vec::new(); }
    let mut out = Vec::new();
    for (es, ee) in spans {
        if es == 0 || es > cand_lines.len() { continue; }
        let ee = ee.min(cand_lines.len()).max(es);
        let mut hits = if tree_allows_tier1(cand, es, ee) {
            scan_cst_raw(cand, Some((es, ee)), true)
        } else {
            isolate_and_classify(&cand_lines, &cand_starts, es, ee)
        };
        if filter_base && let (Some(b_src), Some(bl)) = (base, base_lines.as_ref()) {
            let delta = cand_lines.len() as isize - bl.len() as isize;
            hits.retain(|h| {
                if h.kind != WalrusKind::Illegal || (h.line >= es && h.line <= ee) { return true; }
                let b_ln = if h.line < es { h.line } else { (h.line as isize - delta).max(1) as usize };
                !classify_delta_hits(None, b_src, Some((b_ln, b_ln)), false).iter().any(|bh| bh.kind == WalrusKind::Illegal)
            });
        }
        out.extend(hits);
    }
    out.sort_unstable_by_key(|h| (h.byte_offset, h.kind == WalrusKind::Illegal));
    out.dedup_by_key(|h| (h.byte_offset, h.kind));
    out
}
