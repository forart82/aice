# Feature TDD Specification: Concurrent Bots Isolation & Multi-Agent Thread Safety

> **Feature Identifier:** `docs/tdd/concurrent_bots_isolation.tdd.md`  
> **Status:** Red / Green Phase  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive test suite validating concurrent execution of multiple autonomous bot agents running in parallel (`Promise.all()`) across discrete configurations:
  - **Bot A:** Emerald class, Seed 101, Rogue mode (`'rogue'`)
  - **Bot B:** Stalker class, Seed 202, Endless mode (`'endless'`)
  - **Bot C:** Hydra class, Seed 303, Boss Rush mode (`'bossrush'`)
  - **Bot D:** Solar class, Seed 404, Daily mode (`'daily'`)
- **Target Systems:**
  - `src/sim/GameEngine.ts`: Isolated engine instances, combat loops, floor progression, food harvesting, boss combat.
  - `src/sim/SnakePlayer.ts`: Atomic Ouro wallet transactions, segment growth, Cranial Lab module/augment installations, stat recalculations.
  - `src/data/MetaProgression.ts`: In-run tier unlocks, challenge criteria, Daily Special Capacity milestone escalations.
  - `src/sim/ai/AutonomousBotPlayer.ts`: Autonomous potential field navigation, tactical combat triggers, synergistic lab purchases.
  - `src/tests/ConcurrentBotsIsolation.test.ts`: Dedicated Vitest suite executing concurrent `Promise.all()` simulation passes.
- **Mechanics Reference:** [`ORACLE.md#simulation-engine`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`ORACLE.md#meta-progression`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/ConcurrentBotsIsolation.test.ts`
- **Assertions:**
  1. **Parallel Execution via `Promise.all()`:**
     - Bot A (Emerald/Seed 101/Rogue), Bot B (Stalker/Seed 202/Endless), Bot C (Hydra/Seed 303/Boss Rush), and Bot D (Solar/Seed 404/Daily) run concurrently.
     - Asynchronous execution interleaves simulation ticks, food consumption, boss fights, and Cranial Lab shopping over 200+ simulated frames.
  2. **Cross-Bot Mutation Isolation (Zero Cross-Talk):**
     - Bot A spending Ouro, unlocking tiers, and equipping modules never modifies Bot B's, C's, or D's wallet balances, unlocked tiers, or segment counts.
     - Bot B eating food items and gaining segments never impacts Bot A, C, or D serpent lengths or stats.
     - Bot C slaying multiple bosses in Boss Rush mode never triggers floor clears or boss kill increments on Bot A, B, or D.
     - Bot D unlocking Daily Challenge Cosmic Special Capacities never leaks capacities or stats into Bot A, B, or C.
  3. **Deterministic Reproducibility & Race-Condition Freedom:**
     - Parallel execution yields bit-for-bit deterministic outcomes identical to isolated single-threaded runs for identical seeds and inputs.
     - Zero `NaN` coordinates, velocities, or angles across all concurrent bot instances.
  4. **Atomic Ouro Wallet & Lab Isolation Under Load:**
     - Concurrent high-frequency wallet operations (GainOuro, SpendOuro, AddOuro) across all 4 bots maintain exact conservation and zero negative balances.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/concurrent_bots_isolation.tdd.md`
  - `src/tests/ConcurrentBotsIsolation.test.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/ConcurrentBotsIsolation.test.ts
npm run typecheck
./verify
```
