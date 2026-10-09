# Feature TDD Specification: Cranial Mutation Lab Entry Costs Rebalance & Dev Helpers

> **Feature Identifier:** `docs/tdd/cranial_mutation_lab_entry_costs_and_dev_helpers.tdd.md`  
> **Target Files:**
> - `src/sim/SnakePlayer.ts`
> - `src/ui/screens/SnakeLabScreen.ts`
> - `src/main.ts`
> - `src/data/CodexData.ts`
> - `src/data/GameData.ts`
> - `ORACLE.md`
> - `src/tests/InRunOuroEconomyAndCranialLabRebalance.test.ts`
> - `src/tests/CranialLabAndBossHelmets.test.ts`
> **Protocol:** Strict TDD (Red-Green-Refactor) & Rule 10 In-Code Documentation

---

## 1. Specification & High Concept

### 1.1 Calibrated Cranial Mutation Lab Entry Costs
To lower the barrier to early experimentation while preserving healthy mid-to-late run progression scaling, the Cranial Mutation Lab entry costs are recalibrated:
1. **Base Module Cost (Weapons & Defensive Bio-Organs):**
   - Base Cost: `25 Ouro`
   - Purchase Scaling: `+15 Ouro` per head purchase
   - Formula: $\text{Cost}_{\text{module}}(\text{targetLevel}, \text{purchases}) = 25 \times \text{targetLevel} + \text{purchases} \times 15$
   - Progression pacing:
     - 1st weapon purchase ($p=0, \text{lvl}=1$): $25 \times 1 + 0 \times 15 = 25 \text{ Ouro}$ (affordable after 5 standard apples or ~3 early enemy kills).
     - 2nd weapon purchase ($p=1, \text{lvl}=1$): $25 \times 1 + 1 \times 15 = 40 \text{ Ouro}$.
     - 3rd weapon purchase ($p=2, \text{lvl}=1$): $25 \times 1 + 2 \times 15 = 55 \text{ Ouro}$.
2. **Base Cranial Augment Cost:**
   - Base Cost: `30 Ouro`
   - Purchase Scaling: `+20 Ouro` per head purchase
   - Formula: $\text{Cost}_{\text{augment}}(\text{targetLevel}, \text{purchases}) = 30 \times \text{targetLevel} + \text{purchases} \times 20$
   - Progression pacing:
     - 1st augment ($p=0, \text{lvl}=1$): $30 \times 1 + 0 \times 20 = 30 \text{ Ouro}$.
     - 1st augment at $p=1$: $30 \times 1 + 1 \times 20 = 50 \text{ Ouro}$.
     - 1st augment at $p=2$: $30 \times 1 + 2 \times 20 = 70 \text{ Ouro}$.
     - Lv2 augment at $p=2$: $30 \times 2 + 2 \times 20 = 100 \text{ Ouro}$.

3. **Static Constants & Class Updates:**
   - `SnakeLabScreen.ModuleBaseCost = 25`
   - `SnakeLabScreen.HeadAugmentBaseCost = 30`
   - Fallback button cost expressions in `SnakeLabScreen.ts` updated to use `+ p * 15` for modules and `+ p * 20` for augments.
   - `SnakePlayer.GetHeadModuleCost` and `SnakePlayer.GetHeadAugmentCost` methods updated to the new formula.
   - Parity aliases `AddOuro` / `addOuro` added to `SnakePlayer`.

### 1.2 Developer Console Testing Helper
In `src/main.ts` `boot()` routine (when `window` exists):
- Expose `(window as any).addOuro = (amount: number = 100) => { ... }` so testing Ouro purchases and Lab upgrades in the browser devtools console is effortless.
- Supports granting Ouro to the active `app.engine.player` instance, logging current total Ouro to console, and returning the resulting balance.

### 1.3 Single Source of Truth Synchronization
- Update `ORACLE.md` sections 3.11, 4 (Formula Table) with `25 * lvl + p * 15` and `30 * lvl + p * 20`.
- Update `src/data/CodexData.ts` `classes_cranial_lab` entry stat pills, bullet points, and formula drawers.

---

## 2. Test Plan & Matrix

- [x] **Test 1: Static Constants Check** (`SnakeLabScreen.ModuleBaseCost === 25`, `SnakeLabScreen.HeadAugmentBaseCost === 30`).
- [x] **Test 2: Module Cost Scaling** ($p=0 \to 25$, $p=1 \to 40$, $p=1, \text{lvl}=2 \to 65$, $p=2 \to 55$).
- [x] **Test 3: Augment Cost Scaling** ($p=0 \to 30$, $p=1 \to 50$, $p=2 \to 70$, $p=2, \text{lvl}=2 \to 100$).
- [x] **Test 4: Parity & Regression** (`CranialLabAndBossHelmets.test.ts`, `InRunOuroEconomyAndCranialLabRebalance.test.ts`, full `./verify` suite).
- [x] **Test 5: Developer Helper Registration** (`window.addOuro` grants currency to active player).

---

## 3. Red Phase: Failing Tests

Running test suites before production logic updates confirms test failures for new expectations.

---

## 4. Green Phase: Implementation & Verification

Apply code updates across `SnakePlayer.ts`, `SnakeLabScreen.ts`, `main.ts`, `CodexData.ts`, `ORACLE.md`.

---

## 5. Refactor & Quality Gate

- **Execution Command**: `./verify`
- **Strict TypeScript Typecheck**: 100% PASS (Zero errors)
- **Vitest Conformance Suites**: 53/53 files passed, 699/699 tests passed (100%)
  - `src/tests/InRunOuroEconomyAndCranialLabRebalance.test.ts`: 12/12 PASS
  - `src/tests/CranialLabAndBossHelmets.test.ts`: 21/21 PASS
  - `src/tests/MutationLabAndDamageFeedback.test.ts`: 17/17 PASS
  - `src/tests/InRunBioLabAndSnakeLengthChallenges.test.ts`: 5/5 PASS
  - `src/tests/OuroCurrencyAndCodexTerminology.test.ts`: 11/11 PASS
  - `src/tests/ParityTest.test.ts`: 15/15 golden traces bit-exact PASS
  - `src/tests/PlayTest.test.ts`: 5/5 20-seed sweeps PASS
- **Production Bundle Build**: 100% PASS (Vite 6)
- **Quality Gate**: 100% PASS
