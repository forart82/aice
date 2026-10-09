# Feature TDD Specification: Fresh Run Cranial Lab Starter Cards & Live Challenge Tracking

> **Feature Identifier:** `docs/tdd/fresh_run_cranial_lab_starters_and_live_challenges.tdd.md`  
> **Status:** Verified (Green / Refactor Complete) — 100% Quality Gate PASS  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Ensure that on a fresh run, the Cranial Mutation Lab displays:
  1. Exactly 1 unlocked Offensive Weapon: `turret` (Attack Spitter).
  2. Exactly 1 unlocked Defensive Bio-Organ: `shield` (Carapace Shield).
  3. ALL other cards across the 21-card Cranial Arsenal (9 offensive weapons, 5 defensive bio-organs, 5 cranial bio-augmentations = 19 locked cards) locked with `🔒 [TIER 1 LOCKED]`, displaying their respective in-card live challenge progress bars with exact ratio and percentage.
  4. Live challenge tracking and instant purchase unlocks work seamlessly when in-run challenge conditions (kills, combo streak, food ingestion, potion consumption, boss defeats, serpent length) are fulfilled.
- **Target Systems:** [`src/ui/screens/SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts)
- **Mechanics Reference:** [`ORACLE.md#section-3.11`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/FreshRunCranialLabStartersAndLiveChallenges.test.ts`](file:///home/forart/dev/snake_ts/src/tests/FreshRunCranialLabStartersAndLiveChallenges.test.ts)
- **Assertions:**
  1. On a fresh run (Floor 1, 0 kills, 0 combo, 0 potions, 0 bosses), the Cranial Mutation Lab renders exactly 1 unlocked offensive weapon (`turret`), exactly 1 unlocked defensive bio-organ (`shield`), and all other 19 cards locked (`🔒 [TIER 1 LOCKED]`).
  2. All 19 locked cards render their respective challenge descriptions, live progress bars, exact count ratios, and percentage completions.
  3. In-run actions (e.g. killing 15 Swarmlings, reaching a 20x Combo Streak, drinking 2 Potions, defeating Floor Bosses) instantly unlock their corresponding cards in real time.
  4. When unlocked and affordable, clicking instant-purchases the module, deducts Ouro, installs the upgrade, and increments module levels.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - [`src/ui/screens/SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts):
    - Implemented `isModuleTierUnlocked(type: string, tier: number): boolean` to enforce strict fresh run starters (`turret` and `shield` only) while dynamically checking live run telemetry and meta unlocks.
    - Implemented `getChallengeDescription(type: string, tier: number): string` integrating authoritative challenge text across all tiers.
    - Enhanced `addIntegratedHeadModuleCard()` and `addIntegratedHeadAugmentCard()` with live in-card challenge progress bars, cost/ouro calculations, and atomic purchases.
  - [`src/tests/FreshRunCranialLabStartersAndLiveChallenges.test.ts`](file:///home/forart/dev/snake_ts/src/tests/FreshRunCranialLabStartersAndLiveChallenges.test.ts): Conformance test suite.

---

## 4. Verification & Quality Check

```bash
# Targeted suite
npx vitest run src/tests/FreshRunCranialLabStartersAndLiveChallenges.test.ts

# Complete repository Quality Gate
./verify
```

**Verification Results:**
- TypeScript Typecheck: 0 errors
- Vitest Conformance Matrix: 84 test suites (1,065 tests) 100% PASS
- Production Bundle Build: 100% PASS
