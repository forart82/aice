pub struct Engine {
    pub tick: u64,
}

impl Engine {
    pub fn new() -> Self {
        Self { tick: 0 }
    }

    pub fn step(&mut self, delta: u64) -> u64 {
        self.tick += delta;
        self.tick
    }
}
