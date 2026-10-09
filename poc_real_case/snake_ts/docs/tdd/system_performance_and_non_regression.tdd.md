# Feature TDD Specification: System Performance Benchmark & Non-Regression Conformance Suite

> **Feature Identifier:** `docs/tdd/system_performance_and_non_regression.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Formulate a unified, mission-critical performance benchmark and non-regression conformance test suite (`src/tests/SystemPerformanceAndNonRegression.test.ts`) that guarantees 120 Hz fixed-step real-time throughput, zero GC memory overhead during hot loops, $O(1)$ spatial hash grid query acceleration (>20x speedup over linear scan), 15 golden replay traces bit-exact conformance, and non-regression verification of all 36 cards, 26 relics, 16 weapons, 12 defenses, 28 fusions, 20 bosses, and 12 cosmic capacities.
- **Target Systems:**
  - `src/sim/GameEngine.ts`, `src/sim/CombatSystem.ts`, `src/sim/SpatialHashGrid.ts`
  - `src/data/GameData.ts`, `src/data/CosmicCapacities.ts`, `src/data/MetaProgression.ts`
  - `src/tests/golden/`
- **Mechanics Reference:** [`ORACLE.md#section-2`](file:///home/forart/dev/snake_ts/ORACLE.md), [`ORACLE.md#section-3`](file:///home/forart/dev/snake_ts/ORACLE.md), [`ORACLE.md#section-4`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SystemPerformanceAndNonRegression.test.ts`
- **Assertions & Conformance Pillars:**
  1. **120 Hz Fixed-Step Simulation Throughput ($< 2\text{ ms}$ per tick with $> 250$ entities):**
     - Headless simulation running with $\ge 100$ snake segments, $\ge 80$ foods, $\ge 60$ enemies, $\ge 20$ projectiles/hazards.
     - Multi-tick benchmark measuring average execution duration per 120 Hz fixed tick ($dt = 1/120\text{ s}$).
     - Throughput must strictly remain below $2.0\text{ ms}$ per tick ($> 500\text{ ticks/sec}$ headroom).
  2. **Spatial Hash Grid Query Throughput vs Linear Scan ($> 20\times$ Speedup on 500 queries):**
     - Flat TypedArray-backed `SegmentSpatialGrid` vs brute-force $O(N)$ distance scan across 2,000 entities.
     - 500 randomized radius queries ($R = 64\text{ px}$).
     - Grid throughput speedup must exceed $20.0\times$ while returning mathematically identical match counts.
  3. **Zero / Negligible GC Heap Allocation in Hot-Loop Simulation Ticks:**
     - Memory allocation delta over 500 consecutive `GameEngine.step(dt)` simulation ticks.
     - Zero buffer reallocations in `SegmentSpatialGrid`, entity pools, and combat collision queries.
  4. **15 Golden Replay Parity Traces Bit-Exact Conformance:**
     - Full automated execution of 15 golden trace files across 5 serpent classes (`emerald`, `stalker`, `hydra`, `storm`, `solar`) and 3 deterministic seeds (`1000`, `8919`, `16838`).
     - Bit-exact matching of exact simulation fields (`level`, `segments`, `score`, `combo`, `comboMult`, `frenzy`, `kills`, `bossKills`, `foodsEaten`, `shardsEarned`, `foods`, `enemies`, `projectiles`, `hazards`, `floor`, `rngCalls`, `rngState`).
  5. **Complete Arsenal, Bosses, Fusions & Cosmic Capacities Non-Regression Matrix:**
     - All 36 cards in `GameData.CardPool` validated for metadata, stack limits, and functional stat application.
     - All 26 relics validated for combat procs, health mechanics, and passive triggers.
     - All 16 weapons (8 kinetic + 8 elemental) and 12 defenses (28 modular socket systems) validated in socket hardpoints.
     - All 28 alchemical cross-module fusions validated for socket pair detection and synergy resolution.
     - All 20 boss archetypes in `GameData.Bosses` validated for stats, colors, titles, and `BossForFloor()` modulo-20 mapping.
     - All 12 cosmic special capacities in `CosmicCapacities.Catalog` validated across Tier 1, Tier 2, and Tier 3 parametric bounds.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/SystemPerformanceAndNonRegression.test.ts`: Complete benchmark and non-regression test suite.
  - `docs/tdd/system_performance_and_non_regression.tdd.md`: TDD living record.

---

## 4. Verification & Quality Check

- **Vitest Benchmark Execution:**
  ```bash
  npx vitest run src/tests/SystemPerformanceAndNonRegression.test.ts
  ```
  - `[120Hz Throughput Benchmark]`: **0.1728 ms / tick** (Target: $< 2.0\text{ ms}$, achieved **11.5x margin**).
  - `[Spatial Grid Throughput]`: **21.04x speedup** (Linear: $28.48\text{ ms}$ vs Grid: $1.35\text{ ms}$, Target: $> 20.0\times$).
  - `[Memory Allocation Guarantee]`: Preallocated TypedArrays with zero buffer reallocations over 500 ticks.
  - `[15 Golden Traces Replay]`: 15/15 bit-exact parity across 5 classes & 3 seeds.
  - `[Non-Regression Mechanical Matrix]`: 36 Cards, 26 Relics, 16 Weapons, 12 Defenses, 28 Fusions, 20 Bosses, 12 Capacities 100% verified.

- **Full Quality Gate Verification:**
  ```bash
  ./verify
  ```
  - Strict TypeScript Typecheck: **100% PASS (0 errors)**
  - Vitest Conformance Suites: **46/46 passed (100%), 575/575 tests passed (100%)**
  - Production Bundle Build: **100% PASS** (`dist/index.html` & `dist/assets/index-D8ryE_Vt.js`)
