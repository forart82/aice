# Feature TDD Specification: Simulation Edge Cases, Division-by-Zero, NaN & State Desynchronization Audit

> **Feature Identifier:** `docs/tdd/simulation_edge_cases_and_nan_audit.tdd.md`  
> **Status:** Completed (100% Pass)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Deep simulation audit and comprehensive defect resolution covering division-by-zero, NaN propagation, negative health edge cases, off-by-one segment array operations, spatial hash bounds clamping, and rapid state desynchronization.
- **Target Systems:**
  - `src/core/MathX.ts` & `src/core/Vec2.ts`
  - `src/sim/SpatialHashGrid.ts`
  - `src/sim/SnakePlayer.ts`
  - `src/sim/Boss.ts`
  - `src/sim/GameEngine.ts`
  - `src/sim/CombatSystem.ts`
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) §3 (Kinematics & Serpentine Body Physics), §4 (Progression & Economy), §5 (Apex Boss Encounters).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SimulationEdgeCasesAndNanAudit.test.ts`
- **Assertions:**
  1. **Division-by-Zero & NaN in MathX & Vec2**:
     - `MathX.clamp(NaN, 0, 1)` must safely return `0` (or `lo`) instead of propagating `NaN`.
     - `MathX.angleDelta` and `MathX.wrapAngle` with `NaN` or non-finite inputs must return `0`.
     - `MathX.safeLen` with infinite or NaN inputs must return `1e-6`.
     - `MathX.pointToSegmentDist` with degenerate zero-length segments or non-finite points must not return `NaN`.
     - `Vec2.normalized` and `Vec2.withLength` on zero-vector, NaN-vector, or infinite vector must return `Vec2(0, 0)`.
     - `Vec2.div(0)` or `Vec2.div(NaN)` must safely return `Vec2(0, 0)`.
     - `Vec2.distanceTo`, `distanceSquaredTo`, `angleTo`, `dot`, `cross` must safely handle null, undefined, or non-finite arguments.
  2. **Spatial Hash Grid Boundary & NaN Protection**:
     - `insertSegments` with segments having `NaN` x/y coordinates must not corrupt `_gridHead` or `_gridNext`.
     - `insert` and `queryRadius` with extreme out-of-bounds coordinates (e.g. -10,000, 100,000) must clamp cleanly to boundary bins without throwing.
     - `queryNearest` with out-of-bounds coordinates must evaluate bounds without unbounded loops.
     - `queryRay` with origin far outside arena bounds must handle ray bounds cleanly.
  3. **SnakePlayer Health, Array Index & Kinematics Defenses**:
     - Setting `player.Hp = NaN` or `player.MaxHp = NaN` must not set `HeadHp` or segment `Hp` to `NaN`.
     - `DamageSegment(NaN, 10)` must not throw `TypeError: Cannot read properties of undefined (reading 'Hp')`.
     - `SeverFrom(NaN)` must not sever the entire snake at index 0.
     - `SwapSegments(NaN, 0)` must not insert `undefined` into the segments array.
     - `ReorderSegment(NaN, 0)` must safely reject NaN indices.
     - `GetSegmentTangentialSpeed(NaN)` and `ResolveTailWhipCollision(NaN, enemy)` must safely return base values.
     - `player.Update` with `NaN` angles or positions must recover to safe finite values rather than exploding into permanent NaN coordinates.
     - `Deflect(nx, ny)` with `(0, 0)` or `(NaN, NaN)` must not set heading to `NaN`.
  4. **Boss Health, Segment & Kinematic Protections**:
     - Setting `boss.Hp = NaN` must not propagate `NaN` to `HeadHp` or body segments.
     - `boss.DamageSegment(NaN, 10)` must not throw `TypeError: Cannot read properties of undefined (reading 'Hp')`.
     - `boss.SeverFrom(NaN)` must safely reject NaN indices.
     - `boss.UpdateSegments` with non-finite boss positions must recover without propagating `NaN`.
     - All 20 Boss AI dispatch routines properly map archetype identifiers (including `chronowyrm` and `superconductor_boss`).
  5. **State Desynchronization & Rapid State Transitions**:
     - Unpausing via `Resume()` or `TogglePause()` when player is dead (`!player.Alive`) or during `GameState.GameOver` must not set state back to `GameState.Playing`.
     - Calling `CloseSnakeLab()` after player death must not transition engine to `GameState.Playing`.
     - `AdvanceFloor()` must cleanly reset active dash state (`IsDashing = false`, `DashTimer = 0`, `DashHitIds.clear()`, `AgilitySurgeTimer = 0`).
  6. **CombatSystem Guarding**:
     - `explodeAt` and `chainLightning` with NaN damage or coordinates must return cleanly without generating NaN damage or floating-point crashes.

---

## 3. Implementation Details (Green & Refactor Phases)

- **Files Modified:**
  - `src/core/MathX.ts`:
    - `clamp`: Added `if (Number.isNaN(v)) return lo;` while properly handling `Infinity` and `-Infinity`.
    - `angleDelta` & `wrapAngle`: Return `0` on non-finite angular inputs.
    - `safeLen`: Returns `1e-6` on non-finite inputs or degenerate results.
    - `pointToSegmentDist`: Guards degenerate segment lengths ($l^2 \le 10^{-12}$) and non-finite inputs.
  - `src/core/Vec2.ts`:
    - `normalized` & `withLength`: Zero-safe, NaN-safe fallback returning `new Vec2(0, 0)`.
    - `div`: Divisor finiteness check returning `new Vec2(0, 0)` on division by zero or NaN.
    - `distanceTo`, `distanceSquaredTo`, `angleTo`, `dot`, `cross`: Parameter null/undefined/finite validation.
  - `src/sim/SpatialHashGrid.ts`:
    - `insertSegments`: Coordinate validation using `Number.isFinite` before bin calculation, preventing NaN cell indexing that corrupted `gridHead`.
    - `queryNearest` & `queryRay`: Extreme boundary clamp and ray direction zero checks.
  - `src/sim/SnakePlayer.ts`:
    - `set Hp` & `set MaxHp`: Numerical sanitization enforcing finite non-negative values.
    - `DamageHead`, `DamageSegment`, `SeverFrom`, `SwapSegments`, `ReorderSegment`: Integer index guards (`!Number.isInteger(index)`) preventing JS `NaN` fall-through property access and accidental `splice(NaN) -> splice(0)` whole-snake severance.
    - `GetSegmentTangentialSpeed` & `ResolveTailWhipCollision`: Guarded against invalid segment indices.
    - `Update`: Non-finite recovery for position coordinates and angles, plus `dt <= 0` early return.
    - `Deflect`: Normalization check guarding against `(0, 0)` or non-finite normal vectors.
  - `src/sim/Boss.ts`:
    - `set Hp`: Validates finite values and distributes safely to `HeadHp` and segments.
    - `DamageSegment` & `SeverFrom`: Integer index validation preventing undefined accesses.
    - `UpdateSegments`: Recovers non-finite boss positions safely.
    - Boss dispatch table: Added `'chronowyrm'` and `'superconductor_boss'` to AI dispatch mappings.
  - `src/sim/GameEngine.ts`:
    - Constructor: Fixed options detection so passing `{ headless: true }` does not inadvertently overwrite `Services.Fx` with a non-FX object.
    - `TogglePause` & `Resume`: Guarded against returning to `GameState.Playing` when player is dead or game over has occurred.
    - `CloseSnakeLab`: Guarded against unpausing when player is dead.
    - `AdvanceFloor`: Reset `IsDashing = false`, `DashTimer = 0`, `DashHitIds.clear()`, `AgilitySurgeTimer = 0`.
    - `StartRun`: Safe call `this.Fx?.Clear?.()`.
  - `src/sim/CombatSystem.ts`:
    - `explodeAt`: Parameter validation ensuring finite positive damage and coordinates, with defensive `Services.fx?.explosion` / `ringShockwave` dispatch.
    - `chainLightning`: Parameter validation ensuring finite positive damage, range, and jumps.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SimulationEdgeCasesAndNanAudit.test.ts
# Result: 26 passed (26)

npx vitest run src/tests/AllSerpentineBossesIntegrity.test.ts
# Result: 37 passed (37)

npx vitest run src/tests/SelfTest.test.ts src/tests/ParityTest.test.ts src/tests/PlayTest.test.ts
# Result: 43 passed (43)

npm run typecheck
# Result: 0 errors
```
