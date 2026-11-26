use std::collections::HashMap;

pub(crate) fn lines_ref(src: &str) -> Vec<&str> {
    if src.is_empty() {
        return Vec::new();
    }
    let mut v: Vec<&str> = src.split('\n').map(|l| l.strip_suffix('\r').unwrap_or(l)).collect();
    if src.ends_with('\n') && v.last().is_some_and(|l| l.is_empty()) {
        v.pop();
    }
    v
}

pub(crate) fn line_starts(src: &str) -> Vec<usize> {
    if src.is_empty() {
        return Vec::new();
    }
    let mut starts = vec![0usize];
    for (i, &b) in src.as_bytes().iter().enumerate() {
        if b == b'\n' {
            starts.push(i + 1);
        }
    }
    if src.ends_with('\n') {
        starts.pop();
    }
    starts
}

pub(crate) fn leading_ws_len(line: &str) -> usize {
    line.bytes().take_while(|b| matches!(b, b' ' | b'\t')).count()
}

pub(crate) fn delim_delta(line: &str) -> i32 {
    let (mut bal, mut in_sq, mut in_dq, mut esc) = (0i32, false, false, false);
    for b in line.bytes() {
        if esc {
            esc = false;
            continue;
        }
        if (in_sq || in_dq) && b == b'\\' {
            esc = true;
            continue;
        }
        if !in_dq && b == b'\'' {
            in_sq = !in_sq;
            continue;
        }
        if !in_sq && b == b'"' {
            in_dq = !in_dq;
            continue;
        }
        if in_sq || in_dq {
            continue;
        }
        if b == b'#' {
            break;
        }
        match b {
            b'(' | b'[' | b'{' => bal += 1,
            b')' | b']' | b'}' => bal -= 1,
            _ => {}
        }
    }
    bal
}

fn dp_spans(b: &[&str], c: &[&str], c_off: usize, out: &mut Vec<(usize, usize)>) {
    let (m, n) = (b.len(), c.len());
    let mut dp = vec![vec![0u16; n + 1]; m + 1];
    for i in (0..m).rev() {
        for j in (0..n).rev() {
            dp[i][j] = if b[i] == c[j] {
                dp[i + 1][j + 1] + 1
            } else {
                dp[i + 1][j].max(dp[i][j + 1])
            };
        }
    }
    let (mut matched, mut i, mut j) = (vec![false; n], 0, 0);
    while i < m && j < n {
        if b[i] == c[j] {
            matched[j] = true;
            i += 1;
            j += 1;
        } else if dp[i + 1][j] >= dp[i][j + 1] {
            i += 1;
        } else {
            j += 1;
        }
    }
    let mut k = 0;
    while k < n {
        if matched[k] {
            k += 1;
            continue;
        }
        let s = k;
        while k < n && !matched[k] {
            k += 1;
        }
        out.push((c_off + s + 1, c_off + k));
    }
}

fn patience_lis(pairs: &[(usize, usize)]) -> Vec<(usize, usize)> {
    let mut tails: Vec<usize> = Vec::new();
    let mut tail_idx: Vec<usize> = Vec::new();
    let mut prev: Vec<usize> = vec![usize::MAX; pairs.len()];
    for (idx, &(bi, _ci)) in pairs.iter().enumerate() {
        let pos = tails.binary_search(&bi).unwrap_or_else(|p| p);
        if pos == tails.len() {
            tails.push(bi);
            tail_idx.push(idx);
        } else {
            tails[pos] = bi;
            tail_idx[pos] = idx;
        }
        if pos > 0 {
            prev[idx] = tail_idx[pos - 1];
        }
    }
    let mut lis = Vec::new();
    let mut cur = tail_idx.last().copied();
    while let Some(idx) = cur {
        lis.push(pairs[idx]);
        cur = (prev[idx] != usize::MAX).then_some(prev[idx]);
    }
    lis.reverse();
    lis
}

fn diff_spans(b: &[&str], c: &[&str], c_off: usize, out: &mut Vec<(usize, usize)>) {
    let min_len = b.len().min(c.len());
    let p = b.iter().zip(c.iter()).take_while(|(x, y)| x == y).count();
    let s = b.iter().rev().zip(c.iter().rev()).take(min_len - p).take_while(|(x, y)| x == y).count();
    let (b, c, c_off) = (&b[p..b.len() - s], &c[p..c.len() - s], c_off + p);
    if c.is_empty() {
        return;
    }
    if b.is_empty() {
        out.push((c_off + 1, c_off + c.len()));
        return;
    }
    if b.len() <= 256 && c.len() <= 256 {
        dp_spans(b, c, c_off, out);
        return;
    }
    let mut map: HashMap<&str, (u32, u32, usize)> = HashMap::with_capacity(b.len().min(c.len()));
    for (i, &line) in b.iter().enumerate() {
        let e = map.entry(line).or_insert((0, 0, i));
        e.0 += 1;
        e.2 = i;
    }
    for &line in c {
        if let Some(e) = map.get_mut(line) {
            e.1 += 1;
        }
    }
    let mut pairs = Vec::new();
    for (j, &line) in c.iter().enumerate() {
        if let Some(&(1, 1, bi)) = map.get(line) {
            pairs.push((bi, j));
        }
    }
    let lis = patience_lis(&pairs);
    if !lis.is_empty() {
        let (mut bp, mut cp) = (0usize, 0usize);
        for (bi, ci) in lis {
            diff_spans(&b[bp..bi], &c[cp..ci], c_off + cp, out);
            bp = bi + 1;
            cp = ci + 1;
        }
        diff_spans(&b[bp..], &c[cp..], c_off + cp, out);
        return;
    }
    let best = c.iter().copied().filter_map(|line| {
        let &(cb, cc, _) = map.get(line)?;
        (cb > 0 && cc > 0).then_some((cb + cc, cb, cc, line))
    }).min_by_key(|t| t.0);
    if let Some((_, cb, cc, target)) = best
        && let Some(bi) = b.iter().enumerate().filter(|(_, l)| **l == target).nth((cb as usize) / 2).map(|(i, _)| i)
        && let Some(ci) = c.iter().enumerate().filter(|(_, l)| **l == target).nth((cc as usize) / 2).map(|(j, _)| j)
    {
        diff_spans(&b[..bi], &c[..ci], c_off, out);
        diff_spans(&b[bi + 1..], &c[ci + 1..], c_off + ci + 1, out);
        return;
    }
    out.push((c_off + 1, c_off + c.len()));
}

pub(crate) fn changed_line_spans(base: Option<&str>, cand: &str) -> Vec<(usize, usize)> {
    let cand_lines = lines_ref(cand);
    let Some(base_src) = base else {
        return (!cand_lines.is_empty()).then_some((1, cand_lines.len())).into_iter().collect();
    };
    let base_lines = lines_ref(base_src);
    let mut out = Vec::new();
    diff_spans(&base_lines, &cand_lines, 0, &mut out);
    let mut merged: Vec<(usize, usize)> = Vec::with_capacity(out.len());
    for (s, e) in out {
        if let Some(last) = merged.last_mut() && s <= last.1 + 1 {
            last.1 = last.1.max(e);
        } else {
            merged.push((s, e));
        }
    }
    merged
}
