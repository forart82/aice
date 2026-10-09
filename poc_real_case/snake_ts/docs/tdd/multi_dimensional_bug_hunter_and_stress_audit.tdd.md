# Feature TDD Specification: Bot 2 Multi-Dimensional Bug Hunter, Fuzzing & Auto-Fixer Audit

> **Feature Identifier:** `docs/tdd/multi_dimensional_bug_hunter_and_stress_audit.tdd.md`  
> **Status:** Green / 100% PASS (Quality Gate Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep automated fuzzing, multi-boss combat simulation hardening, and extreme stress testing for Ouroboros Ascension engine.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: Physics & Kinematics at extreme lengths ($L=100$ to $L=10,000+$), angular turn rates ($\omega = 4.2$ to $15.0$ rad/s), cascading autotomy cuts, segment HP synchronization.
  - `src/sim/CombatModules.ts`, `src/sim/CombatAuras.ts`, `src/sim/CombatSkills.ts`, `src/sim/CombatSystem.ts`: Multi-boss combat simulation (2 to 6 concurrent bosses on Floor 21+), out-of-order defeat sequence, dynamic weapon retargeting, multi-boss relic aura & skill coverage.
  - `src/sim/SpatialHashGrid.ts`: 18,000+ item saturation across all 5 physical simulation layers, dynamic capacity growth, zero-allocation flat buffer traversal, cell boundary crossing accuracy.
  - `src/input/VirtualStick.ts`, `src/input/TouchControls.ts`, `src/input/InputManager.ts`, `src/ui/ResponsiveLayout.ts`, `src/sim/GameEngine.ts`: Touch cancellation, ambidextrous layout switching, and modal unpause state transitions.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/MultiDimensionalBugHunterAndStressAudit.test.ts`
- **Assertions:**
  1. **Dimension 1: Physics & Kinematics Fuzzing**:
     - 1.1 Simulates extreme serpent length ($L=10,000$) with sharp angular steering ($\omega = 4.2$ to $15.0$ rad/s), verifying finite coordinates, angles, and strict Gauss-Seidel IK distance constraints: $\text{dist}(P_{i-1}, P_i) \le 1.0001 \times \text{spacing}$.
     - 1.2 Executes cascading autotomy cuts down from $L=10,000$ to $L=1$ under active velocity, confirming exact segment counts and invariant preservation.
     - 1.3 Verifies segment HP synchronization, segment damage propagation, and Phoenix Revive restoration.
     - 1.4 Verifies tangential velocity and tail whip damage multiplier scaling monotonically up to $L=10,000$.
  2. **Dimension 2: Multi-Boss Simulation & Dynamic Retargeting**:
     - 2.1 Spawns 2, 3, 4, 5, and 6 concurrent bosses on Floor 21+ with 0.75 multi-boss HP scaling.
     - 2.2 Handles out-of-order boss defeat (defeating boss 2, then boss 0, then boss 1) without state corruption, correctly transitioning floor state only upon final boss defeat.
     - 2.3 Dynamic Weapon Retargeting: Verifies `tesla`, `laser`/`tachyon`, and `sonic` modules hit and damage all active bosses in range.
     - 2.4 Multi-Boss Auras & Skills: Verifies Frostbite Aura, Eternal Coil contact DPS, Orbital Fangs, Stun Roar, Supernova, Cryo Nova, and Hazard pools damage and affect all concurrent active bosses in range.
     - 2.5 Multi-Boss Bullet Hell Density: Simulates 6 concurrent bosses generating 1000+ simultaneous projectiles, testing collision, absorption, and evasion.
  3. **Dimension 3: Spatial Hash Saturation & Performance**:
     - 3.1 Inserts 18,000+ entities across all 5 spatial layers with zero memory leaks and dynamic buffer scaling.
     - 3.2 Validates 100% circular query precision and recall against brute force under saturation.
     - 3.3 Verifies sub-millisecond execution for 500 spatial queries in dense grid.
     - 3.4 Tests Amanatides & Woo fast DDA raymarching traversal across dense multi-layer grids.
  4. **Dimension 4: UI, Touch, & State Machine Robustness**:
     - 4.1 Tests `VirtualStick` and `TouchControls` touch cancellation (`onTouchCancel`) and release transitions.
     - 4.2 Tests dynamic ambidextrous layout switching (Righty <-> Lefty) across standard and extreme aspect ratios.
     - 4.3 Fuzzes 300+ modal pause/unpause and state transitions, asserting zero deadlocks and bounded accumulator.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/multi_dimensional_bug_hunter_and_stress_audit.tdd.md` (This spec)
  - `src/tests/MultiDimensionalBugHunterAndStressAudit.test.ts` (Comprehensive 16-test suite)
  - `src/sim/CombatModules.ts` (Updated `tesla`, `laser`/`tachyon`, `sonic`, `cryo_carapace`, `heatsink`, `emp_coil` to iterate over all active bosses)
  - `src/sim/CombatAuras.ts` (Updated Frostbite Aura, Eternal Coil, Orbital Fangs to affect all active bosses)
  - `src/sim/CombatSkills.ts` (Updated `skillTitanRoar` and `skillSupernova` to affect all active bosses)
  - `src/sim/CombatSystem.ts` (Updated `updateHazards`, `cryoNova`, `checkConstriction`, and `chainLightning` multi-boss tracking)

---

## 4. Verification & Quality Check

```bash
# Direct test suite execution
npx vitest run src/tests/MultiDimensionalBugHunterAndStressAudit.test.ts # 16/16 PASS

# Full Quality Gate: Strict Typecheck + 112 Conformance Test Suites + Production Bundle Build
./verify # 100% PASS (112 test files, 1,462 tests)
```
