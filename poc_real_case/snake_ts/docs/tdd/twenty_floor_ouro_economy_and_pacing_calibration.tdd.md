# Feature TDD Specification: 20-Floor In-Run Ouro Economy & Cranial Lab Pacing Calibration

> **Feature Identifier:** `docs/tdd/twenty_floor_ouro_economy_and_pacing_calibration.tdd.md`  
> **Status:** Green / Refactored (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Calibrate the in-run Ouro economy and Cranial Lab cost curves across all 20 floors to ensure a balanced, rewarding pacing curve.
- **Key Economy Drivers:**
  1. **Per-Floor Income Target (60–90 Ouro/floor):**
     - Balanced food ingestion (Apple +1, Golden +4, Potion +2, Shield +2, Bomb +3, Chrono +3, Shard +4; average ~1.815 Ouro/item $\to$ 20–35 Ouro/floor).
     - Hostile mob kills (Swarmling +1, Scarab +2, Spitter +3, Phantom +3, Drone +4, Brute +6 $\to$ 15–30 Ouro/floor).
     - Boss Defeat Reward (+35 Ouro flat bonus + bonus drop items $\to$ 35 Ouro/floor).
     - Combined yield: 60–90 Ouro per floor (mean ~75 Ouro/floor).
  2. **Cranial Lab Cost Curves:**
     - Module Pricing: $\text{Cost}(\text{lvl}, p) = 30 \times \text{lvl} + p \times 15 \text{ Ouro}$
     - Augment Pricing: $\text{Cost}(\text{lvl}, p) = 40 \times \text{lvl} + p \times 20 \text{ Ouro}$
  3. **Player Wallet Accumulation & Pacing Tiers:**
     - **Floor 1–3 (Starter):** Cumulative income ~180–240 Ouro. Enables purchase of 1–2 starter weapon/defense modules (30–45 Ouro) and 1 starter cranial augment (40–60 Ouro).
     - **Floor 4–8 (Tier 2 Progression):** Cumulative income ~500–640 Ouro. Enables upgrading starter arsenal to Tier 2 (75–105 Ouro) and acquiring newly unlocked challenge modules.
     - **Floor 9–15 (Synergies & Fusions):** Cumulative income ~1,000–1,250 Ouro. Enables building specialized 2-module elemental synergies (Cryo, Plasma, Magma, Tachyon at 120–180 Ouro) and tier 2 cranial augments.
     - **Floor 16–20+ (Endgame Mastery):** Cumulative income ~1,500–1,800+ Ouro. Enables acquiring Tier 3 mastery capstones (210–255 Ouro) and high-tier cranial augments for the final gauntlet and Floor 20 (The Eternal Ouroboros).

- **Target Systems:**
  - `src/data/GameData.ts`: Tables for Foods, Enemies, Bosses, Modules, Fusions.
  - `src/sim/FoodItem.ts`: Nutrient drops and Ouro yield.
  - `src/sim/Enemy.ts`: Hostile bestiary XP/Ouro values.
  - `src/sim/Boss.ts`: Boss Guardian rewards (+35 Ouro).
  - `src/sim/SnakePlayer.ts`: Spendable in-run wallet and scaled cost calculation methods.
  - `ORACLE.md`: Comprehensive 20-Floor Economy Balance Tables and Pacing Calibration documentation.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/TwentyFloorOuroEconomyPacing.test.ts`
- **Assertions:**
  1. **Currency Flow Analysis:** Verify per-floor baseline income satisfies the 60–90 Ouro target from food ingestion (20–35), mob kills (15–30), and boss defeat (+35).
  2. **Cranial Lab Cost Verification:** Verify `GetHeadModuleCost(key, lvl)` and `GetHeadAugmentCost(key, lvl)` yield exact costs for purchases $p=0 \dots 12$.
  3. **Floor 1–3 Starter Phase Pacing:** Verify player with ~220 Ouro can purchase 2 starter modules (30 + 45 Ouro) and 1 augment (80 Ouro) with positive remaining wallet balance.
  4. **Floor 4–8 Tier 2 Phase Pacing:** Verify player accumulating ~380 additional Ouro can upgrade to Tier 2 modules and unlock new tactical hardpoints.
  5. **Floor 9–15 Specialized Synergy Phase Pacing:** Verify player wallet supports multi-module alchemical fusions (e.g. Superconductor, Glacial Rot, Obsidian) and Tier 2 augments.
  6. **Floor 16–20+ Endgame Mastery Phase Pacing:** Verify total wallet accumulation reaching 1,500–1,800 Ouro funds Tier 3 capstones and prepares player for Floor 20.
  7. **Full 20-Floor Progression Trace:** Simulate 20 continuous floors verifying deterministic Ouro accumulation, transactions, and state integrity.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/TwentyFloorOuroEconomyPacing.test.ts`: Authored comprehensive test suite.
  - `src/data/GameData.ts`: Verified and documented all tables.
  - `src/sim/FoodItem.ts`: Enhanced in-code documentation and formulas.
  - `src/sim/Enemy.ts`: Enhanced in-code documentation and formulas.
  - `src/sim/Boss.ts`: Enhanced in-code documentation and formulas.
  - `src/sim/SnakePlayer.ts`: Enhanced in-code documentation and formulas.
  - `ORACLE.md`: Added Section 3.3.1 with complete 20-Floor economy calibration and balance tables.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/TwentyFloorOuroEconomyPacing.test.ts
npm run typecheck
./verify
```
