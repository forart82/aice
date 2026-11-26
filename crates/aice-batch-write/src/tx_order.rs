use std::collections::BTreeMap;
use std::path::PathBuf;

use aice_governance::Governed;

use crate::hunk::has_hunk_markers;
use crate::line_splice::parse_line_range_selector;
use crate::tx_commit::resolve_authorized;
use crate::types::BatchSpliceItem;

fn is_full_file_reset(item: &BatchSpliceItem) -> bool {
    if item.delete
        || item.insert_after.is_some()
        || item.insert_before.is_some()
        || item.clone_from.is_some()
        || has_hunk_markers(&item.payload)
    {
        return false;
    }
    match item.symbol.as_deref() {
        None => true,
        Some(s) => matches!(
            s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(),
            "" | "create" | "overwrite" | "*"
        ),
    }
}

struct LineRangeSpec {
    ranges: Vec<(usize, usize)>,
    pure: bool,
}

fn item_line_ranges(item: &BatchSpliceItem) -> Result<Option<LineRangeSpec>, String> {
    if item.clone_from.is_some() || item.insert_after.is_some() || item.insert_before.is_some() {
        return Ok(None);
    }
    let Some(ref sym_raw) = item.symbol else {
        return Ok(None);
    };
    if item.delete {
        let parts: Vec<&str> = sym_raw.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
        let mut ranges = Vec::new();
        let mut all_ranges = !parts.is_empty();
        for part in parts {
            if let Some(lr) = parse_line_range_selector(part) {
                ranges.push(lr?);
            } else {
                all_ranges = false;
            }
        }
        return Ok((!ranges.is_empty()).then_some(LineRangeSpec { ranges, pure: all_ranges }));
    }
    if let Some(lr) = parse_line_range_selector(sym_raw) {
        return Ok(Some(LineRangeSpec { ranges: vec![lr?], pure: true }));
    }
    Ok(None)
}

fn order_segment(items: &[BatchSpliceItem], seg: &[usize], display: &str) -> Result<Vec<usize>, String> {
    if seg.len() <= 1 {
        return Ok(seg.to_vec());
    }
    let mut all_ranges: Vec<(usize, usize)> = Vec::new();
    let mut line_items: Vec<(usize, usize)> = Vec::new();
    let mut other_items: Vec<usize> = Vec::new();
    for &idx in seg {
        match item_line_ranges(&items[idx])? {
            Some(spec) => {
                let min_s = spec.ranges.iter().map(|&(s, _)| s).min().unwrap_or(0);
                all_ranges.extend(spec.ranges);
                if spec.pure {
                    line_items.push((min_s, idx));
                } else {
                    other_items.push(idx);
                }
            }
            None => other_items.push(idx),
        }
    }
    all_ranges.sort_unstable();
    for w in all_ranges.windows(2) {
        if w[0].1 >= w[1].0 {
            return Err(format!(
                "Overlapping line-range edits L{}-L{} and L{}-L{} in {display}",
                w[0].0, w[0].1, w[1].0, w[1].1
            ));
        }
    }
    line_items.sort_by(|a, b| b.0.cmp(&a.0).then(a.1.cmp(&b.1)));
    let mut out: Vec<usize> = line_items.into_iter().map(|(_, idx)| idx).collect();
    out.extend(other_items);
    Ok(out)
}

pub(crate) fn build_execution_order(
    governed: &Governed,
    items: &[BatchSpliceItem],
) -> Result<Vec<usize>, String> {
    let mut by_file: BTreeMap<PathBuf, Vec<usize>> = BTreeMap::new();
    let mut file_order: Vec<PathBuf> = Vec::new();
    for (idx, item) in items.iter().enumerate() {
        let ap = resolve_authorized(governed, &item.file_path)?;
        let entry = by_file.entry(ap.canonical.clone()).or_insert_with(|| {
            file_order.push(ap.canonical.clone());
            Vec::new()
        });
        entry.push(idx);
    }
    let mut ordered = Vec::with_capacity(items.len());
    for canon in file_order {
        let indices = &by_file[&canon];
        if indices.len() <= 1 {
            ordered.extend_from_slice(indices);
            continue;
        }
        let display = &items[indices[0]].requested_display;
        let mut seg = Vec::new();
        for &idx in indices {
            if is_full_file_reset(&items[idx]) {
                if !seg.is_empty() {
                    ordered.extend(order_segment(items, &seg, display)?);
                    seg.clear();
                }
                ordered.push(idx);
            } else {
                seg.push(idx);
            }
        }
        if !seg.is_empty() {
            ordered.extend(order_segment(items, &seg, display)?);
        }
    }
    Ok(ordered)
}
