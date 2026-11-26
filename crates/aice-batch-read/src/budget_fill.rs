use crate::budget::count_cl100k_exact;
pub use crate::budget_fill_cand::BudgetCandidate;
use crate::budget_fill_cand::{
    ActiveSlot, append_omitted_notice, content_line_count, footer_reserve_for,
    is_viable_candidate, min_kept_lines, minimal_target_tokens, trim_candidate_to_quota,
};

pub struct BudgetFillOutcome {
    pub bundle: String,
    pub included_indices: Vec<usize>,
    pub any_compacted: bool,
    pub any_truncated: bool,
}

pub fn water_fill_quotas(demands: &[usize], budget: usize) -> Vec<usize> {
    let n = demands.len();
    if n == 0 || budget == 0 {
        return vec![0; n];
    }
    let mut order: Vec<usize> = (0..n).collect();
    order.sort_by_key(|&i| (demands[i], i));
    let (mut quotas, mut remaining, mut rem_count) = (vec![0usize; n], budget, n);

    for (pos, &idx) in order.iter().enumerate() {
        let fair = remaining / rem_count;
        if demands[idx] <= fair {
            quotas[idx] = demands[idx];
            remaining -= demands[idx];
            rem_count -= 1;
        } else {
            let (base, mut extra) = (remaining / rem_count, remaining % rem_count);
            let mut rest: Vec<usize> = order[pos..].to_vec();
            rest.sort_unstable();
            for r_idx in rest {
                let add = usize::from(extra > 0);
                extra = extra.saturating_sub(1);
                quotas[r_idx] = base + add;
            }
            break;
        }
    }
    quotas
}

pub fn apply_water_fill_budget(
    items: &[BudgetCandidate],
    max_tokens: usize,
    topo_priority: bool,
) -> BudgetFillOutcome {
    if items.is_empty() || max_tokens == 0 {
        return BudgetFillOutcome {
            bundle: String::new(),
            included_indices: Vec::new(),
            any_compacted: false,
            any_truncated: !items.is_empty(),
        };
    }

    let full_joined = items.iter().map(|it| it.emitted.as_str()).collect::<Vec<_>>().join("\n");
    if count_cl100k_exact(&full_joined) <= max_tokens {
        return BudgetFillOutcome {
            bundle: full_joined,
            included_indices: (0..items.len()).collect(),
            any_compacted: false,
            any_truncated: false,
        };
    }

    let viable: Vec<usize> =
        (0..items.len()).filter(|&i| is_viable_candidate(&items[i], max_tokens)).collect();
    if viable.is_empty() {
        return BudgetFillOutcome {
            bundle: append_omitted_notice(String::new(), items.len(), max_tokens),
            included_indices: Vec::new(),
            any_compacted: false,
            any_truncated: true,
        };
    }

    const MIN_TARGET_TOKENS: usize = 8;
    let init_fit = (max_tokens / MIN_TARGET_TOKENS).max(1).min(viable.len());
    let mut slots: Vec<ActiveSlot> =
        viable[..init_fit].iter().map(|&idx| ActiveSlot::new(idx, &items[idx])).collect();
    let mut next_viable = init_fit;
    let mut any_compacted = false;
    let mut any_truncated = viable.len() < items.len() || next_viable < viable.len();

    loop {
        compact_overflowing(&mut slots, items, max_tokens, topo_priority, &mut any_compacted);
        let alive: Vec<usize> = (0..slots.len()).filter(|&i| slots[i].kept).collect();
        if alive.is_empty() {
            break;
        }
        let alive_toks: Vec<usize> = alive.iter().map(|&i| slots[i].tok).collect();
        let omit_now = items.len().saturating_sub(alive.len());
        let min_alive = alive
            .iter()
            .filter_map(|&i| minimal_target_tokens(&items[slots[i].orig_idx]))
            .min()
            .unwrap_or(0);
        let r_avail = max_tokens.saturating_sub(
            alive.len().saturating_sub(1)
                + footer_reserve_for(omit_now, alive.len(), max_tokens, min_alive),
        );
        if alive_toks.iter().sum::<usize>() <= r_avail {
            break;
        }
        let quota = water_fill_quotas(&alive_toks, r_avail);
        let mut updates: Vec<(usize, String, bool)> = Vec::new();
        let mut failed: Vec<usize> = Vec::new();
        for (pos, &s_idx) in alive.iter().enumerate() {
            if slots[s_idx].tok <= quota[pos] {
                continue;
            }
            let cand = &items[slots[s_idx].orig_idx];
            if let Some((trimmed, trunc)) =
                trim_candidate_to_quota(cand, &slots[s_idx].current, slots[s_idx].full_tok, quota[pos])
            {
                updates.push((s_idx, trimmed, trunc));
            } else {
                failed.push(s_idx);
            }
        }
        if failed.is_empty() {
            for (s_idx, s, trunc) in updates {
                slots[s_idx].tok = count_cl100k_exact(&s);
                slots[s_idx].current = s;
                any_truncated |= trunc;
            }
            break;
        }
        let drop_one = (failed.len() > 1).then(|| {
            *failed
                .iter()
                .max_by_key(|&&s_idx| {
                    let cand = &items[slots[s_idx].orig_idx];
                    (
                        minimal_target_tokens(cand).unwrap_or(usize::MAX),
                        slots[s_idx].tok,
                        count_cl100k_exact(&cand.header),
                        s_idx,
                    )
                })
                .unwrap()
        });
        for s_idx in failed {
            if drop_one.is_none_or(|d| d == s_idx) {
                slots[s_idx].kept = false;
                slots[s_idx].current.clear();
                any_truncated = true;
            }
        }
        if next_viable < viable.len() {
            let idx = viable[next_viable];
            slots.push(ActiveSlot::new(idx, &items[idx]));
            next_viable += 1;
            any_truncated = true;
        }
    }

    for slot in &mut slots {
        let cand = &items[slot.orig_idx];
        if slot.kept && !cand.header.is_empty() && content_line_count(cand, &slot.current) == 0 {
            slot.kept = false;
            slot.current.clear();
            any_truncated = true;
        }
    }

    let mut joined = join_kept(&slots);
    while count_cl100k_exact(&joined) > max_tokens {
        let pick = (0..slots.len())
            .filter(|&i| {
                let cand = &items[slots[i].orig_idx];
                slots[i].kept
                    && slots[i].current.lines().count() > min_kept_lines(cand)
                    && (cand.header.is_empty() || content_line_count(cand, &slots[i].current) > 1)
            })
            .max_by_key(|&i| (slots[i].current.lines().count(), i));
        let Some(idx) = pick else {
            if let Some(drop_idx) = slots.iter().rposition(|s| s.kept) {
                slots[drop_idx].kept = false;
                slots[drop_idx].current.clear();
                any_truncated = true;
                joined = join_kept(&slots);
                continue;
            }
            joined.clear();
            break;
        };
        let mut lines: Vec<&str> = slots[idx].current.lines().collect();
        if lines.len() > 2
            && lines.last().is_some_and(|l| l.starts_with("// ... [truncated") || *l == "// ...")
        {
            lines.remove(lines.len() - 2);
        } else {
            lines.pop();
        }
        slots[idx].current = format!("{}\n", lines.join("\n"));
        any_truncated = true;
        joined = join_kept(&slots);
    }

    let included_indices: Vec<usize> = slots.iter().filter(|s| s.kept).map(|s| s.orig_idx).collect();
    let total_omitted = items.len().saturating_sub(included_indices.len());
    if total_omitted > 0 {
        joined = append_omitted_notice(joined, total_omitted, max_tokens);
    }

    BudgetFillOutcome { bundle: joined, included_indices, any_compacted, any_truncated }
}

fn compact_overflowing(
    slots: &mut [ActiveSlot],
    items: &[BudgetCandidate],
    max_tokens: usize,
    topo_priority: bool,
    any_compacted: &mut bool,
) {
    loop {
        let alive: Vec<usize> = (0..slots.len()).filter(|&i| slots[i].kept).collect();
        if alive.is_empty() {
            break;
        }
        let omit_now = items.len().saturating_sub(alive.len());
        let min_alive = alive
            .iter()
            .filter_map(|&i| minimal_target_tokens(&items[slots[i].orig_idx]))
            .min()
            .unwrap_or(0);
        let avail = max_tokens.saturating_sub(
            alive.len().saturating_sub(1)
                + footer_reserve_for(omit_now, alive.len(), max_tokens, min_alive),
        );
        let sum: usize = alive.iter().map(|&i| slots[i].tok).sum();
        if sum <= avail {
            break;
        }
        let alive_toks: Vec<usize> = alive.iter().map(|&i| slots[i].tok).collect();
        let quota = water_fill_quotas(&alive_toks, avail);
        let overflowing: Vec<usize> = alive
            .iter()
            .enumerate()
            .filter(|&(pos, &i)| slots[i].tok > quota[pos] && !slots[i].compacted && slots[i].outline.is_some())
            .map(|(_, &i)| i)
            .collect();
        if overflowing.is_empty() {
            break;
        }
        let pick = if topo_priority {
            *overflowing.iter().max_by_key(|&&i| (items[slots[i].orig_idx].is_expanded as u8, i)).unwrap()
        } else {
            *overflowing
                .iter()
                .max_by_key(|&&i| {
                    let ot = slots[i].outline.as_ref().map_or(slots[i].tok, |x| x.1);
                    (slots[i].tok.saturating_sub(ot), i)
                })
                .unwrap()
        };
        if let Some((out_str, out_tok)) = slots[pick].outline.clone() {
            slots[pick].current = out_str;
            slots[pick].tok = out_tok;
            slots[pick].compacted = true;
            *any_compacted = true;
        }
    }
}

fn join_kept(slots: &[ActiveSlot]) -> String {
    slots
        .iter()
        .filter(|s| s.kept && !s.current.is_empty())
        .map(|s| s.current.as_str())
        .collect::<Vec<_>>()
        .join("\n")
}
