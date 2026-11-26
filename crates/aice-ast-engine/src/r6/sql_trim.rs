use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;

struct TrimSpan {
    trim_i: usize,
    lp: usize,
    rp: usize,
    from_pos: Option<usize>,
    has_spec: bool,
}

pub(crate) fn validate_and_collect_trim_masks(
    stmt: &[SqlTok], src: &str, errs: &mut Vec<ErrorSpan>,
) -> Vec<(usize, usize)> {
    let mut stack: Vec<Option<usize>> = Vec::new();
    let mut trims: Vec<TrimSpan> = Vec::new();
    for (k, tok) in stmt.iter().enumerate() {
        if tok.kind == SqlTokKind::LParen {
            let is_trim = k > 0 && stmt[k - 1].is_kw(src, "TRIM")
                && (k < 2 || stmt[k - 2].kind != SqlTokKind::Dot);
            let slot = is_trim.then(|| {
                let idx = trims.len();
                trims.push(TrimSpan { trim_i: k - 1, lp: k, rp: 0, from_pos: None, has_spec: false });
                idx
            });
            stack.push(slot);
        } else if tok.kind == SqlTokKind::RParen {
            if let Some(Some(slot)) = stack.pop() {
                let lp = trims[slot].lp;
                trims[slot].rp = k;
                trims[slot].has_spec = lp + 1 < k && (stmt[lp + 1].is_kw(src, "BOTH")
                    || stmt[lp + 1].is_kw(src, "LEADING")
                    || stmt[lp + 1].is_kw(src, "TRAILING"));
            }
        } else if tok.is_kw(src, "FROM")
            && (k == 0 || stmt[k - 1].kind != SqlTokKind::Dot)
            && let Some(&Some(slot)) = stack.last()
            && trims[slot].from_pos.is_none()
        {
            trims[slot].from_pos = Some(k);
        }
    }
    let mut masks = Vec::new();
    let (mut validated_until, mut masked_until) = (0usize, 0usize);
    for tr in trims {
        if tr.rp == 0 { continue; }
        if tr.rp == tr.lp + 1 {
            if tr.trim_i >= validated_until {
                errs.push(sp(stmt[tr.trim_i].line, stmt[tr.trim_i].col, "Empty arguments in TRIM()"));
                validated_until = tr.rp + 1;
            }
            continue;
        }
        if tr.has_spec && tr.from_pos.is_none() {
            if tr.trim_i >= validated_until {
                errs.push(sp(stmt[tr.lp + 1].line, stmt[tr.lp + 1].col, "Expected FROM in TRIM expression"));
                validated_until = tr.rp + 1;
            }
            continue;
        }
        if tr.trim_i >= validated_until {
            let mut idx = tr.trim_i;
            if let Err(e) = validate_pratt_expr(&stmt[..=tr.rp], src, &mut idx, 0, &[]) {
                errs.push(e);
            } else if idx <= tr.rp {
                errs.push(sp(stmt[idx].line, stmt[idx].col, "Unexpected token in TRIM expression"));
            }
            validated_until = tr.rp + 1;
        }
        if let Some(fp) = tr.from_pos {
            let (s, e) = (stmt[tr.lp].end, stmt[fp].end);
            if e > masked_until {
                let ms = s.max(masked_until);
                if ms < e { masks.push((ms, e)); }
                masked_until = e;
            }
        }
    }
    masks
}

pub(crate) fn validate_and_mask_trim_calls(
    stmt: &[SqlTok], src: &str, masked: &mut [u8], errs: &mut Vec<ErrorSpan>,
) {
    for (s, e) in validate_and_collect_trim_masks(stmt, src, errs) {
        for b in &mut masked[s..e] {
            if *b != b'\n' { *b = b' '; }
        }
    }
}
