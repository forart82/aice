# Feature TDD Specification: In-Run Ouro Economy & Cranial Mutation Lab Rebalance

> **Feature Identifier:** `docs/tdd/in_run_ouro_economy_and_cranial_lab_rebalance.tdd.md`  
> **Status:** Green / Refactored (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Rebalance the in-run Ouro collection economy against Cranial Mutation Lab upgrade costs to create challenging and rewarding gameplay. Rebalances Ouro drops for all 9 food items, all 6 enemy types, Boss Defeat bonus (+35 Ouro), and scales Cranial Mutation Lab base costs and purchase increments.
- **Target Systems:**
  - `src/sim/FoodItem.ts` & `src/data/GameData.ts`: Rebalanced food item Ouro/XP drop values.
    - Apple: +1 Ouro
    - Golden Apple: +4 Ouro
    - Potion: +2 Ouro
    - Shield Orb: +2 Ouro
    - Bomb Fruit: +3 Ouro
    - Chrono Shard: +3 Ouro
    - Essence Shard: +4 Ouro
    - Soul Remnant: +5 Ouro
    - Astral Prism: +15 Ouro
  - `src/sim/Enemy.ts` & `src/data/GameData.ts` & `src/sim/GameEngine.ts`: Rebalanced enemy kill Ouro and boss defeat rewards.
    - Swarmling: +1 Ouro
    - Scarab: +2 Ouro
    - Spitter: +3 Ouro
    - Phantom: +3 Ouro
    - Arc Drone: +4 Ouro
    - Magma Brute: +6 Ouro
    - Boss Defeat: +35 Ouro
  - `src/sim/SnakePlayer.ts` & `src/ui/screens/SnakeLabScreen.ts`: Rebalanced Cranial Mutation Lab cost curves.
    - ModuleBaseCost: 30 Ouro (scaling +15 Ouro per purchase)
    - HeadAugmentBaseCost: 40 Ouro (scaling +20 Ouro per purchase)
    - `SnakeLabScreen.HeadAugmentBaseCost = 40`, `SnakeLabScreen.ModuleBaseCost = 30`.
    - `SnakePlayer.GetHeadModuleCost(key, targetLvl)`: `30 * lvl + purchases * 15`.
    - `SnakePlayer.GetHeadAugmentCost(key, targetLvl)`: `40 * lvl + purchases * 20`.
  - `src/data/CodexData.ts` & `ORACLE.md`: Updated authoritative SSOT tables and codex descriptions.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/InRunOuroEconomyAndCranialLabRebalance.test.ts`
- **Assertions:**
  1. All 9 food item types yield their exact rebalanced Ouro values upon creation and ingestion.
  2. All 6 enemy archetypes possess exact rebalanced Ouro values upon spawn and defeat.
  3. Defeating a floor boss grants +35 Ouro to the active player.
  4. `SnakePlayer.GetHeadModuleCost` computes `30 * nextLvl + purchases * 15`.
  5. `SnakePlayer.GetHeadAugmentCost` computes `40 * nextLvl + purchases * 20`.
  6. `SnakeLabScreen.ModuleBaseCost` is 30 and `SnakeLabScreen.HeadAugmentBaseCost` is 40 with correct fallback purchase increment formulas.
  7. `ORACLE.md` and `CodexData.ts` document the exact rebalanced values and formulas.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/FoodItem.ts` & `src/data/GameData.ts`: Updated `buildFoods()` and `buildEnemies()` with rebalanced Ouro/XP drop values.
  - `src/sim/Boss.ts`: Added `XpValue = 35` and `xpValue` property.
  - `src/sim/GameEngine.ts`: Awarded +35 Ouro on boss defeat (`OnBossDefeated`).
  - `src/sim/SnakePlayer.ts`: Updated `GetHeadModuleCost` (`30 * lvl + p * 15`) and `GetHeadAugmentCost` (`40 * lvl + p * 20`).
  - `src/ui/screens/SnakeLabScreen.ts`: Updated `ModuleBaseCost = 30`, `HeadAugmentBaseCost = 40`, and fallback button calculations.
  - `src/data/CodexData.ts`: Updated articles and formulas for Food Economy and Cranial Lab.
  - `ORACLE.md`: Updated Section 3.3, 3.11, 3.12, 4, and 5.2.
  - Updated all dependent conformance test suites (`CranialLabAndBossHelmets.test.ts`, `XpCounterAndProgressionAudit.test.ts`, `InRunBioLabAndSnakeLengthChallenges.test.ts`, `MutationLabAndDamageFeedback.test.ts`, `SystemPerformanceAndNonRegression.test.ts`).

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/InRunOuroEconomyAndCranialLabRebalance.test.ts # 10/10 PASS
npm run typecheck                                                     # 100% PASS
./verify                                                              # 100% PASS
```
