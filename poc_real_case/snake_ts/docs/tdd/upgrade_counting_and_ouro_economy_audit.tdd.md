# Feature TDD Specification: Upgrade Counting & Ouro Economy Audit

> **Feature Identifier:** `docs/tdd/upgrade_counting_and_ouro_economy_audit.tdd.md`  
> **Status:** Active / In Progress (Red-Green-Refactor)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive audit and architectural synchronization for in-run spendable Ouro wallet currency, Cranial Lab purchase deductions, serpent length counting (`segments.length + 1`), and live telemetry challenge evaluation metrics.
- **Specification Targets:**
  1. **Purified Ouro Wallet Economy**:
     - Eating food (all 9 types) or slaying enemies (all 6 hostile types + bosses) increases spendable Ouro wallet balance (`player.ouro`, `player.Ouro`, `player.xp`, `player.Xp`) without ANY arbitrary subtraction, drain, or reset upon reaching level-up thresholds.
     - Level progression thresholds are evaluated against monotonic total collection (`TotalXpCollected` / `TotalOuroCollected`), allowing the spendable wallet to be dedicated exclusively to Cranial Mutation Lab upgrades and in-run economy.
  2. **Cranial Lab Atomic Deductions & HUD Synchronization**:
     - Cranial Mutation Lab spending atomically validates and deducts exact costs (`player.SpendOuro(cost)` / `player.spendOuro(cost)`).
     - Head augment purchases (base 40 Ouro, +20/purchase) and socket module purchases (base 30 Ouro, +15/purchase) deduct exact costs and immediately synchronize `.lab-stat-chip-ouro` and HUD `.hud-ouro-val`.
     - Insufficient funds trigger error feedback, audio rejection, and prevent deduction.
  3. **Serpent Length Counting Consistency (`segments + 1`)**:
     - Serpent total length represents the whole serpent (1 head + body segments = `segments.length + 1`).
     - Exposed via `SnakePlayer.length`, `SnakePlayer.Length`, `SnakePlayer.totalLength`, and `SnakePlayer.TotalLength`.
     - Consistent across `SnakePlayer`, `HudView`, `SnakeLabScreen` (`📏 ${segCount} Segs`), `StatsModalScreen` (`.stat-length-val`), and `MetaProgression.IsTierUnlocked`.
  4. **Telemetry & Challenge Metric Parity**:
     - Food, kill, boss, and combo counts in `StatsModalScreen` match `MetaProgression` challenge evaluation and `CombatSystem` state.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) (Section 4.1 & 4.2).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/UpgradeCountingAndOuroEconomyAudit.test.ts`](file:///home/forart/dev/snake_ts/src/tests/UpgradeCountingAndOuroEconomyAudit.test.ts)
- **Suite Breakdown:**
  1. `1. Spendable Ouro Wallet Economy & No Arbitrary Drain`:
     - Food ingestion Ouro accumulation without drain across levels.
     - Enemy kill Ouro awards with relic (Soul Harvest) and perk (Gourmand) scaling.
     - Level threshold crossing retains all spendable Ouro.
  2. `2. Cranial Lab Atomic Deductions & HUD Synchronization`:
     - `SpendOuro` / `spendOuro` boundary validation.
     - Head augment and module purchase deduction and HUD synchronicity.
     - Insufficient funds error rejection.
  3. `3. Serpent Length Counting (segments + 1) Consistency`:
     - `SnakePlayer.length` / `Length` / `totalLength` / `TotalLength` matching `Segments.length + 1`.
     - Growth tracking consistency between player, lab screen, stats screen, and MetaProgression.
  4. `4. StatsModalScreen & MetaProgression Challenge Parity`:
     - Food, kill, boss, and combo telemetry consistency with challenge unlocking.
     - Live progress bars in stats modal reflecting exact MetaProgression challenge targets.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SnakePlayer.ts`
  - `src/ui/screens/SnakeLabScreen.ts`
  - `src/ui/screens/StatsModalScreen.ts`
  - `src/data/MetaProgression.ts`
  - `src/tests/UpgradeCountingAndOuroEconomyAudit.test.ts`
  - `src/tests/OuroWalletAndDeductions.test.ts`
  - `src/tests/OuroCurrencyAndCodexTerminology.test.ts`
  - `src/tests/XpCounterAndProgressionAudit.test.ts`
  - `src/tests/SmartphoneXpCounterHud.test.ts`
  - `src/tests/StatsModalScreen.test.ts`

---

## 4. Verification & Quality Gate

```bash
npx vitest run src/tests/UpgradeCountingAndOuroEconomyAudit.test.ts
./verify
```
