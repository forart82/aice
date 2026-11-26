use crate::error::StorageError;

#[derive(Debug, Clone)]
pub struct TokenBucket {
    capacity: u64,
    tokens: u64,
    refill_per_sec: u64,
    last_tick_ms: u64,
}

impl TokenBucket {
    pub fn new(capacity: u64, refill_per_sec: u64, now_ms: u64) -> Result<Self, StorageError> {
        if capacity == 0 {
            return Err(StorageError::CapacityExceeded {
                requested: 1,
                available: 0,
            });
        }
        if refill_per_sec == 0 {
            return Err(StorageError::InvalidRefillRate);
        }
        Ok(Self {
            capacity,
            tokens: capacity,
            refill_per_sec,
            last_tick_ms: now_ms,
        })
    }

    pub fn refill(&mut self, now_ms: u64) {
        if now_ms <= self.last_tick_ms {
            return;
        }
        let elapsed_ms = now_ms - self.last_tick_ms;
        let added = (elapsed_ms.saturating_mul(self.refill_per_sec)) / 1_000;
        if added > 0 {
            self.tokens = self.tokens.saturating_add(added).min(self.capacity);
            self.last_tick_ms = now_ms;
        }
    }

    /// Attempts to acquire `cost` tokens at `now_ms` without waiting.
    pub fn try_acquire(&mut self, cost: u64, now_ms: u64) -> Result<u64, StorageError> {
        self.refill(now_ms);
        if cost == 0 {
            return Ok(self.tokens);
        }
        if cost > self.capacity || cost > self.tokens {
            return Err(StorageError::CapacityExceeded {
                requested: cost,
                available: self.tokens,
            });
        }
        self.tokens -= cost;
        Ok(self.tokens)
    }

    pub fn reserve_or_wait_ms(&mut self, cost: u64, now_ms: u64) -> Result<u64, StorageError> {
        self.refill(now_ms);
        if cost > self.capacity {
            return Err(StorageError::CapacityExceeded {
                requested: cost,
                available: self.capacity,
            });
        }
        if self.tokens >= cost {
            self.tokens -= cost;
            return Ok(0);
        }
        let deficit = cost - self.tokens;
        let wait_ms = (deficit.saturating_mul(1_000)).div_ceil(self.refill_per_sec);
        Ok(wait_ms)
    }

    pub fn available(&self) -> u64 {
        self.tokens
    }

    pub fn capacity(&self) -> u64 {
        self.capacity
    }

    pub fn drain_all(&mut self, now_ms: u64) -> u64 {
        self.refill(now_ms);
        let drained = self.tokens;
        self.tokens = 0;
        drained
    }

    pub fn set_refill_rate(&mut self, refill_per_sec: u64, now_ms: u64) -> Result<(), StorageError> {
        if refill_per_sec == 0 {
            return Err(StorageError::InvalidRefillRate);
        }
        self.refill(now_ms);
        self.refill_per_sec = refill_per_sec;
        Ok(())
    }
}
