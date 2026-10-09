# Feature TDD Specification: 20-Floor Progression and Multi-Boss Escalation

> **Feature Identifier:** `docs/tdd/twenty_floor_progression_and_multi_boss_escalation.tdd.md`  
> **Status:** Complete / Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Expand the campaign and simulation architecture for 20-floor progression and multi-boss escalation in endless/higher floors.
- **Target Systems:**
  - `src/sim/GameEngine.ts`: Default `MaxFloors = 20`, `ActiveBosses: Boss[]` array, multi-boss perimeter spawning on floors 21+, multi-boss defeat handling, floor clear / victory gating.
  - `src/sim/Boss.ts`: Support explicit archetype injection and custom spawn coordinates.
  - `src/render/GameRenderer.ts`: Multi-boss canvas rendering iterating over all `engine.ActiveBosses`.
  - `src/ui/HudView.ts`: Composite multi-boss and primary boss health bar presentation.
  - `src/sim/CombatSystem.ts` & `src/sim/World.ts`: Multi-boss collision, damage, projectile, and lifecycle handling.
- **Mechanics Reference:** [`ORACLE.md#5.3`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/TwentyFloorProgressionAndMultiBossEscalation.test.ts`
- **Assertions:**
  1. Default `GameEngine.MaxFloors` is 20.
  2. `ActiveBosses` array exists on `GameEngine` and `World`, with `Boss` getter/setter delegating to `ActiveBosses[0]`.
  3. `SpawnBoss()` on Floors 1-20 spawns 1 Boss (`GameData.BossForFloor(floor)`).
  4. `SpawnBoss()` on Floors 21+ spawns multiple bosses:
     - Floors 21-30: 2 bosses
     - Floors 31-40: 3 bosses
     - Floors 41-50: 4 bosses
     - Floors 51-60: 5 bosses
     - Floors 61+: 6 bosses (capped at 6)
  5. Boss spawn positions are safely distributed across arena bounds with safe perimeter margins ($\ge 60\text{px}$).
  6. `OnBossDefeated(boss)` removes the specified defeated boss from `ActiveBosses`, awards score/Ouro/food/helmets, records defeat type in `Combat.DefeatedBossTypes` and `Combat.BossKillsByType`, and triggers floor clear / victory only when `ActiveBosses.length === 0`.
  7. `GameRenderer.ts` draws every active boss in `ActiveBosses`.
  8. `HudView.ts` renders composite health bar and horde details when multiple bosses are active.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/GameEngine.ts`: Updated `MaxFloors = 20`, `ActiveBosses` collection, multi-boss `SpawnBoss`, `OnBossDefeated`, and `Step` lifecycle.
  - `src/sim/Boss.ts`: Extended constructor with `specificTypeOrArchetype` resolution and perimeter `startX`, `startY`.
  - `src/sim/World.ts`: Declared `ActiveBosses`, `Bosses`, `bosses`, `activeBosses`, and `Boss` accessors.
  - `src/sim/CombatSystem.ts`: Multi-boss projectile hit testing, bite collision cooldowns, and `DefeatedBossTypes` tracking.
  - `src/render/GameRenderer.ts`: Canvas rendering pass iterating and drawing all active bosses with coordinate validation.
  - `src/ui/HudView.ts`: Adaptive single-boss or multi-boss composite health bar calculation and phase text.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/TwentyFloorProgressionAndMultiBossEscalation.test.ts
# Result: 10/10 PASS

./verify
# Result: 100% PASS (Strict Typecheck + 56 Vitest suites [741 tests] + Production Bundle Build)
```
