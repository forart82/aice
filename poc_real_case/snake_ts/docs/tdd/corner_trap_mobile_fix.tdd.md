# Feature TDD Specification: Corner Trap Mobile Fix

> **Feature Identifier:** `docs/tdd/corner_trap_mobile_fix.tdd.md`  
> **Status:** Green (100% Passing)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix the mobile corner trap bug where the snake gets stuck and pinned against arena corners (specifically bottom-right `arenaW - m, arenaH - m`, bottom-left, top-right, and top-left).
- **Root Cause:**
  1. Simultaneous boundary violations on both X and Y axes (`X >= arenaW - m` and `Y >= arenaH - m`) triggered independent sequential orthogonal deflections `Deflect(-1, 0)` and `Deflect(0, -1)`.
  2. The second deflection saw the head-on sliding velocity from the first deflection, triggering the perpendicular head-on fallback `else` branch in `Deflect`.
  3. The head-on fallback contained a bug (`tangentY = nx !== 0 ? nx : 1`) which forced `(1, 1)` -> `π/4` angle into the bottom-right corner, while unconditionally wiping out `TargetAngle` (`this.TargetAngle = this.Angle`), overriding the player's inward steering.
  4. Without separation nudging, `X` and `Y` remained pinned to `arenaW - m, arenaH - m`, oscillating or locking infinitely.
- **Target Systems:** `src/sim/SnakePlayer.ts`, `src/input/VirtualStick.ts`, `src/input/TouchControls.ts`.
- **Mechanics Reference:** [`ORACLE.md#serpent-kinematics`](file:///home/forart/dev/snake_ts/ORACLE.md).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/CornerTrapMobileFix.test.ts`
- **Assertions:**
  1. Snake placed in bottom-right corner (`X = arenaW - m, Y = arenaH - m`) facing into corner (`Angle = π/4`), with inward steering towards arena center (`steer = (-1, -1)`), smoothly turns towards the arena center and escapes the corner within 60 ticks without getting trapped or locked.
  2. Snake placed in bottom-right corner without steering input (hands off / coasting) deflects safely and escapes along the wall perimeter without infinite oscillation or freezing in the corner.
  3. All 4 corners (top-left, top-right, bottom-left, bottom-right) are verified for both active inward steering escape and passive deflection escape.
  4. Perpendicular head-on collision in `Deflect` calculates true geometric tangents `(-ny, nx)` and preserves inward player steering (`tdot >= 0`).
  5. VirtualStick touch steering integration verifies analog joystick input cleanly escapes the corner.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SnakePlayer.ts`:
    - Detected simultaneous dual-axis corner collision when `(hitLeft || hitRight) && (hitTop || hitBottom)`.
    - Computed composite diagonal inward normal `(nx * Math.SQRT1_2, ny * Math.SQRT1_2)`.
    - Applied inward separation nudge of `1.0px` (`m + 1.0` / `arenaW - m - 1.0`) so the serpent head unpins from both wall bounding planes.
    - Updated `Deflect(nx, ny)` to calculate true orthogonal tangent `(-ny, nx)` on head-on collision.
    - Guarded `this.TargetAngle = this.Angle` with `if (tdot < 0)` so that active inward player steering (`tdot >= 0`) is strictly preserved and never overridden.
  - `src/tests/CornerTrapMobileFix.test.ts`:
    - Comprehensive 9-test conformance suite covering all 4 corners, passive coasting, active steering, and virtual touch stick integration.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/CornerTrapMobileFix.test.ts
# Result: 9 passed (100%)
npx vitest run src/tests/DeepBugFixes.test.ts src/tests/MultiBotSwarmSweeps.test.ts src/tests/SelfTest.test.ts src/tests/Input.test.ts
# Result: 66 passed (100%)
```

