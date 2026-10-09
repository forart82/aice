# Feature TDD Specification: Multi-Bot Swarm Sweeps & Simulation Edge-Case Hardening

> **Feature Identifier:** `docs/tdd/multi_bot_swarm_sweeps_and_edge_case_hardening.tdd.md`  
> **Status:** Complete / Green Verified (100% Quality Gate PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive multi-bot autonomous simulation sweep across 50+ seeds (60 discrete seeds evaluated), all 5 serpent classes (`emerald`, `stalker`, `hydra`, `storm`, `solar`), and all 4 game modes (`rogue`, `endless`, `bossrush`, `daily`), coupled with rigorous stress tests for state transition deadlocks, vector math NaNs, food starvation, and Cranial Lab level caps.
- **Target Systems:**
  - `src/sim/GameEngine.ts`: Fixed-step loop, floor progression, multi-boss resolution, food starvation prevention, arena bounds.
  - `src/sim/SnakePlayer.ts`: Inverse kinematics (IK) segment constraint stability, deflection math, Cranial Lab module/augment level caps, Ouro wallet integrity.
  - `src/sim/ai/AutonomousBotPlayer.ts`: Potential field navigation, threat repulsion, food priority weighting, tactical dashes and skills.
  - `src/sim/Boss.ts` & `src/sim/Enemy.ts`: Target null-safety, multi-boss phase handling, projectile/hazard emission.
  - `src/sim/CombatSystem.ts`: Multi-boss bite resolution, echo strike, damage pipelines, status effect application.
  - `src/tests/MultiBotSwarmSweeps.test.ts`: Comprehensive Vitest test suite executing 60 seed sweeps (12 seeds x 5 classes) and deep edge-case bug stress suites.
- **Mechanics Reference:** [`ORACLE.md#simulation-engine`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/MultiBotSwarmSweeps.test.ts` (23 tests)
- **Assertions:**
  1. **50+ Seed Multi-Bot Swarms Across All 5 Classes:**
     - 60 discrete random seeds evaluated across Emerald (12), Stalker (12), Hydra (12), Storm (12), and Solar (12).
     - Bots successfully steer, eat food, survive waves, and maintain valid non-NaN positions, velocities, and angles across 100% of runs.
  2. **All 4 Game Modes Execution Matrix:**
     - `rogue`: 10 floors traversed, draft upgrades picked, Floor 10 Victory triggered.
     - `endless`: Traverses beyond Floor 20 without crash, dual bosses on F21-30, tri-bosses on F31-40.
     - `bossrush`: Immediate boss spawns with 0 food target and sequential floor progression.
     - `daily`: Seeded run unlocking and escalating 4-tier Cosmic Special Capacities at levels 5, 10, 15, 20.
  3. **State Transition Deadlock Stress Tests:**
     - Multi-boss simultaneous elimination in a single tick resolves without state deadlocks or array corruption.
     - Tri-boss simultaneous death in a single step without array splice deadlocks.
     - Floor clear timer expiry advances cleanly to next floor without stuck state.
     - Calling `OnBossDefeated` with null / empty active bosses is completely idempotent.
  4. **Vector Math NaN & IK Constraint Stress Tests:**
     - Segments with 0 distance (`dx=0, dy=0`), collinear segments, and zero-velocity inputs do not produce `NaN`.
     - Potential field with threat/food placed exactly at player coordinates resolves to finite unit vectors.
     - Deflections against arena borders and sharp corners maintain valid finite angles in `(-PI, PI]`.
  5. **Food Starvation & Positioning Stress Tests:**
     - Spawning food when food array is empty recovers immediately with emergency food spawn.
     - `RandomArenaPoint` with narrow / compact arena dimensions clamps margins safely.
  6. **Cranial Lab & Level Cap Bounds Stress Tests:**
     - `InstallHeadModule` and `InstallHeadAugment` strictly enforce max level (Tier 3) cap.
     - `SpendOuro` rejects `NaN`, or infinite values without corrupting wallet balance, while handling zero/negative no-op costs safely.
     - Rapid consecutive purchases deplete Ouro wallet safely without negative balances.

---

## 3. Implementation Details & Bug Fixes (Green Phase)

1. **`SnakePlayer.ts`:**
   - **Inverse Kinematics Stabilization:** In `UpdateSegments(_dt)`, added non-finite coordinate fallback (`seg.X = px; seg.Y = py;`) and `dist > 0.0001` division-by-zero protection.
   - **Cranial Lab Tier 3 Cap:** Guarded stat upgrades with `if (cur < 3)` and clamped module/augment levels via `Math.min(3, cur + 1)` while preserving purchase count pacing.
   - **Wallet Spending Bounds:** Hardened `SpendOuro` to reject `NaN` or `Infinity` inputs while handling non-positive costs as no-ops.
2. **`AutonomousBotPlayer.ts`:**
   - **Potential Field Heading Fallback:** Added safe fallback to forward serpent angle `p.Angle` when forces cancel out to zero magnitude or evaluate to non-finite numbers.
3. **`GameEngine.ts`:**
   - **Arena Boundary Margin Clamping:** Clamped `RandomArenaPoint` margins to `Math.min(m, this.ArenaW * 0.5)` preventing inverted coordinate ranges on small arena sizes.
4. **`Boss.ts` & `Enemy.ts`:**
   - **Null-Target Safety:** Added early return guards `if (!target || !world) return;` preventing crash when entities are updated after target cleanup.
   - **Multi-Boss Scale Rounding:** Aligned `unscaledHp` rounding before applying `MultiBossScale`.

---

## 4. Verification & Quality Check (100% PASS)

```bash
# Multi-Bot Swarm Sweeps Test Suite
npx vitest run src/tests/MultiBotSwarmSweeps.test.ts
# Result: 23 passed (23) — Duration: 3.95s

# Full Repository Quality Gate
./verify
# [1/3] Strict TypeScript Typecheck: 100% PASS (Zero Errors)
# [2/3] Vitest Conformance Suites: 76 passed (76) | 983 passed (983) — Duration: 54.79s
# [3/3] Production Bundle Build: 100% PASS — Built in 2.07s
```
