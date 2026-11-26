pub struct LedgerStats {
    pub count: usize,
    pub total: i64,
}

pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {
    stats.count += 1;
    stats.total += delta;
    stats.total
}
