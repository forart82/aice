# Feature TDD Specification: Leveling & XP Curve Game Balance Audit

> **Feature Identifier:** `docs/tdd/leveling_xp_curve_audit.tdd.md`  
> **Status:** Red / Active Probe  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive automated simulation sweep (50+ seeds x 5 serpent classes = 250+ full campaigns) auditing leveling progression, XP curve scaling, food/enemy/boss XP yields, class-specific XP passives, and edge cases across Floors 1–20.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts` (XP accumulation, level thresholds, wallet synchronization)
  - `src/sim/GameEngine.ts` (LevelUp trigger, floor progression, food targets, boss rewards)
  - `src/sim/CombatSystem.ts` (Food consumption, enemy kill XP, relic scaling, Overdrive Frenzy)
  - `src/data/GameData.ts` (Classes, enemy stats, food stats, perks, relics)
- **Mechanics Reference:** [`ORACLE.md#section-4`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/LevelingAndXpCurveAuditProbe.test.ts`
- **Audit Assertions:**
  1. **Formula Comparison:** Evaluates mathematical congruence between ORACLE.md ($\lfloor 100 \times L^{1.45} \rfloor$), standard geometric 1.25x scaling, and simulation recurrence ($XpToNext = \lfloor 1.32 \times XpToNext + 45 \rceil$).
  2. **Automated Bot Simulation (50 Seeds x 5 Classes = 250 Runs):** Evaluates floor-by-floor leveling pacing (Floors 1–20) across `emerald`, `stalker`, `hydra`, `storm`, and `solar`.
  3. **XP Ingestion Breakdown:** Analyzes proportion of XP derived from Food vs Enemies vs Bosses vs Soul Remnants vs Perks.
  4. **Class-Specific Passives:** Quantifies the impact of Solar's Magma Trail food cooking (+4 XP vs +1 XP), Emerald's bio-magnet range, Stalker's crit burst, Hydra's multi-bite, and Storm's lightning arcs.
  5. **Edge Cases:** Negative XP input validation, float64 precision preservation, massive XP injection ($10^{15}$) overflow resistance, and LevelUp state triggers during Boss defeat and FloorClear transitions.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/LevelingAndXpCurveAuditProbe.test.ts` (Comprehensive 250-seed simulation & mathematical audit suite)
  - `docs/tdd/leveling_xp_curve_audit.tdd.md` (Living TDD audit documentation)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/LevelingAndXpCurveAuditProbe.test.ts
./verify
```
