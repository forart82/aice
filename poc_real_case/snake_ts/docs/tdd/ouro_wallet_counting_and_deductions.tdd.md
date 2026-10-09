# Feature TDD Specification: Ouro Wallet Counting & Deductions

> **Feature Identifier:** `docs/tdd/ouro_wallet_counting_and_deductions.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Fix the spendable Ouro wallet currency system across simulation and UI.
  1. In [`SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts):
     - In `GainXp(amount)` and `GainOuro(amount)`: Removed the `while (this.Xp >= this.XpToNext)` loop that was inadvertently draining the player's spendable Ouro wallet balance upon reaching level thresholds. Gaining XP/Ouro strictly accumulates `amount * (this.Stats?.XpGain ?? 1.0)` into `this.Xp` and `this.TotalXpCollected`.
     - Added atomic deduction methods `SpendOuro(cost: number): boolean` and `spendOuro(cost: number): boolean`:
       - If `cost <= 0`, return `true` immediately without modifying `this.Xp`.
       - If `this.Xp < cost`, return `false` without modifying `this.Xp`.
       - If `this.Xp >= cost`, deduct `cost` from `this.Xp` and return `true`.
     - Exposed `Length`, `length`, `TotalLength`, and `totalLength` getters returning total serpent length (`this.Segments.length + 1`).
  2. In [`SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts):
     - Replaced manual property subtractions with atomic `player.SpendOuro(cost)` / `player.spendOuro(cost)` on head augment and module purchases.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: `GainXp`, `GainOuro`, `SpendOuro`, `spendOuro`, `Length`, `TotalLength`, `length`, `totalLength`.
  - `src/ui/screens/SnakeLabScreen.ts`: Cranial Lab purchase callbacks for head augments and head modules.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/OuroWalletAndDeductions.test.ts`](file:///home/forart/dev/snake_ts/src/tests/OuroWalletAndDeductions.test.ts)
- **Assertions:**
  1. `GainXp` / `GainOuro` adds `amount * (this.Stats?.XpGain ?? 1.0)` strictly to `this.Xp` and `this.TotalXpCollected` without draining or resetting `this.Xp`.
  2. `SpendOuro` / `spendOuro` returns `true` when cost <= 0, returns `false` when funds are insufficient without altering wallet, and deducts cost atomically when funds are sufficient.
  3. `Length`, `length`, `TotalLength`, and `totalLength` accurately return `this.Segments.length + 1`.
  4. `SnakeLabScreen` head augment and head module purchases deduct Ouro atomically using `player.SpendOuro(cost)`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SnakePlayer.ts`:
    - Updated `GainXp` and `GainOuro` to strictly accumulate currency without while-loop drain.
    - Added `SpendOuro(cost: number): boolean` and `spendOuro(cost: number): boolean`.
    - Added `Length`, `length`, `TotalLength`, and `totalLength` getters returning `this.Segments.length + 1`.
  - `src/ui/screens/SnakeLabScreen.ts`:
    - Updated `addHeadAugmentOption` and `addHeadModuleOption` purchase handlers to invoke `player.SpendOuro(cost)` / `player.spendOuro(cost)`.
  - `src/tests/OuroWalletAndDeductions.test.ts`: Authored comprehensive unit/integration test suite.
  - `src/tests/OuroCurrencyAndCodexTerminology.test.ts`: Updated test assertions for non-draining Ouro wallet accumulation.
  - `src/tests/XpCounterAndProgressionAudit.test.ts`: Updated test assertions for non-draining Ouro wallet accumulation.
  - `src/tests/UpgradeCountingAndOuroEconomyAudit.test.ts`: Updated chip lookup and dynamic length requirement.

---

## 4. Verification & Quality Check

```bash
./verify
```

- **Vitest Suites Result:** 100% PASS (65/65 test suites, 837/837 tests passed).
- **Strict TypeScript Typecheck:** 0 errors (`tsc --noEmit`).
- **Production Bundle Build:** 100% PASS.
