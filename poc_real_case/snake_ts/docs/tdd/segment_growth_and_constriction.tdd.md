# Feature TDD Specification: Segment Growth Incentives & Ouroboros Constriction

> **Feature Identifier:** `docs/tdd/segment_growth_and_constriction.tdd.md`  
> **Status:** Completed (100% Green & Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Transform Snake growth from a mere size penalty into a primary pillar of player power by adding innate segment bonuses (+15 Max HP, +3% Armor per segment), Ouroboros Constriction crushing loops, tail deflection, and crystal-clear UI indicators in the Snake Lab and HUD.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: Innate Max HP, Armor calculation based on segment count, Tail Deflection logic.
  - `src/sim/CombatSystem.ts`: Ouroboros Constriction loop detection algorithm (polygon point-in-polygon check for closed snake body loops).
  - `src/ui/screens/SnakeLabScreen.ts`: High-visibility "+ Add Segment" benefit badges (`+15 Max HP`, `+3% Armor`, `+3 Module Sockets`, `Expands Constriction Area`), serpent length power banner.
  - `src/render/FxManager.ts` & `src/render/GameRenderer.ts`: Constriction loop glowing shockwave ring FX and floating "CONSTRICTION CRUSH!" combat feedback.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/SelfTest.test.ts`
- **Assertions:**
  1. `SnakePlayer.Segments.length` increases base `Stats.MaxHp` by `+15` per segment.
  2. `SnakePlayer.Armor` or damage reduction scales with `Segments.length * 0.03`.
  3. `CombatSystem.checkConstrictionLoop` detects closed loops formed by the serpent head and trailing segments and damages enclosed enemies.
  4. Snake Lab "+ Add Segment" drawer displays clear benefit tooltips and badges.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SnakePlayer.ts`: Add `SegmentHpBonus` (+15/seg), `SegmentArmorBonus` (+3%/seg), segment count recalculation.
  - `src/sim/CombatSystem.ts`: Implement polygon encirclement test `checkConstrictionLoop(player, world)`.
  - `src/ui/screens/SnakeLabScreen.ts`: Update "+ Add Segment" UI card with prominent benefit badges and serpent power summary.

---

## 4. Verification & Quality Check

```bash
./verify
```
