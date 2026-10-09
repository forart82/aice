# Feature TDD Specification: Deep Fuzzing & Multi-Dimensional Stress Testing

> **Feature Identifier:** `docs/tdd/deep_fuzz_and_stress_test_audit.tdd.md`  
> **Status:** Green / 100% PASS (Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep, multi-iteration stress-testing, fuzzing, and edge-case hardening across the entire Ouroboros Ascension engine.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: Physics & Kinematics (L=100..1000 segments, $\omega \ge 4.2$ rad/s turns, autotomy triggers).
  - `src/sim/SpatialHashGrid.ts`: Saturation stress (1000+ simultaneous entities across 5 layers, $O(1)$ query performance, zero missed broadphase collisions, fast DDA raymarching).
  - `src/sim/GameEngine.ts`: State Machine fuzzing (`Menu`, `ClassSelect`, `Playing`, `Paused`, `LevelUp`, `Draft`, `FloorClear`, `Victory`, `GameOver`), zero deadlocks, zero accumulator drift.
  - `src/ui/ResponsiveLayout.ts` & `src/ui/HudView.ts`: Viewport fuzzing (320x480 to 5120x1440 32:9 and 3840x2160 4K UHD), safe-area insets, non-overlapping touch controls.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/DeepFuzzAndStressTestAudit.test.ts`
- **Assertions:**
  1. **Physics & Kinematics Fuzzing**:
     - 1.1 Tests extreme serpent lengths (L=100, 250, 500, 1000 segments) with sharp angular turns ($\omega = 4.2$ rad/s, $\omega = 9.5$ rad/s, $\omega = 15.0$ rad/s).
     - 1.2 Verifies zero NaN, zero Infinity coordinates, angles, and velocities across 240 simulation steps.
     - 1.3 Verifies strict IK distance constraint satisfaction: $\|P_{i-1} - P_i\| \le 1.0001 \times \text{SegmentSpacing}$ for all $1 \le i < L$.
     - 1.4 Tests autotomy triggers at $L=1000$, $L=500$, $L=250$, $L=100$, and boundary $L=1, 0$, verifying exact segment counts and invariant preservation.
     - 1.5 Verifies tangential velocity and tail-whip damage multiplier formulas remain strictly finite and positive.
  2. **Spatial Grid & Collision Saturation**:
     - 2.1 Spawns 1000+ simultaneous projectiles, hazards, and collectibles across layers 0 to 4.
     - 2.2 Verifies zero memory leaks, dynamic buffer capacity growth, and buffer reuse.
     - 2.3 Verifies zero missed broadphase proximity collisions with 100% precision and recall against brute-force baseline.
     - 2.4 Verifies $O(1)$ cell lookup and nearest-neighbor query performance with sub-millisecond execution under 1000+ item saturation.
     - 2.5 Tests extreme coordinates: negative coordinates, outside arena bounds, exact cell borders, $0$-radius items, large radius items.
     - 2.6 Tests Amanatides & Woo fast DDA raymarching traversal through dense multi-layer grids.
  3. **State Machine Fuzzing**:
     - 3.1 Executes 500+ randomized state transition cycles (`Menu` -> `ClassSelect` -> `Playing` -> `Paused` -> `LevelUp` -> `Draft` -> `FloorClear` -> `Victory` -> `GameOver` -> `Sanctuary` -> `Settings` -> `SnakeLab` -> `Help` -> `Records`).
     - 3.2 Injects random event interrupts (simultaneous pause/unpause, rapid floor advance, death during draft, rapid input triggers).
     - 3.3 Verifies zero deadlocks: engine always recovers to a valid playable state or cleanly resets.
     - 3.4 Verifies zero accumulator drift: accumulator remains strictly bounded ($\le \text{FixedStep} \times \text{MaxStepsPerFrame}$).
  4. **Responsive UI & Text Layout Fuzzing**:
     - 4.1 Fuzzes 100+ randomized and standard viewport dimensions (320x480, 360x780, 390x844, 412x915, 844x390, 1024x768, 1280x720, 1920x1080, 2560x1080, 3840x2160, 5120x1440, 10x10, 10000x10000).
     - 4.2 Verifies UI scale factor $s \in [0.60, 3.05]$, zero NaN, finite metrics.
     - 4.3 Verifies strict safe-area insets, non-overlapping touch controls (dash vs skill buttons, joystick vs action zones).
     - 4.4 Verifies `HudView` metric updates and DOM reflow without throwing unhandled exceptions.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/DeepFuzzAndStressTestAudit.test.ts` (Comprehensive 17-test stress & fuzzing matrix)
  - `src/sim/GameEngine.ts` (Added `OpenSnakeLab`, `CloseSnakeLab`, `EndRun`, `World`/`world` getters, `update`/`Update` aliases)
  - `src/ui/HudView.ts` (Added `onResize` alias and multi-argument `update` compatibility)
  - `src/core/Rng.ts` (Added `rangeInt` and `RangeInt` aliases for integer generation)

---

## 4. Verification & Quality Check

```bash
# Direct test suite execution
npx vitest run src/tests/DeepFuzzAndStressTestAudit.test.ts # 17/17 PASS

# Full Quality Gate: Typecheck + 106 Conformance Test Suites + Production Bundle Build
./verify # 100% PASS (106 test files, 1,399 tests)
```
