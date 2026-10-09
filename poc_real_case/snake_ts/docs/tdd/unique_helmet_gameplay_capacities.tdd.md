# Feature TDD Specification: Unique Helmet Active Capacities

> **Feature Identifier:** `docs/tdd/unique_helmet_gameplay_capacities.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Unique Helmets possess distinctive gold-brown cosmetic styling and powerful active in-simulation gameplay capacities:
  - **Titan Gorging** (Maw of the Behemoth / Abyssal Titan `unique_helm_abyssal_leviathan`): Eating any food temporarily doubles head size and bite radius (2x HeadRadius) for 3.0 seconds, returning to 1.0x on timer expiration.
  - **Harvest Feast** (Carapace of the Nanite Hivequeen `unique_helm_nanite_hivequeen`): Slain enemies burst into 2 to 3 extra juicy apples scattered with a random offset around the defeat coordinates.
  - **Gold-Brown Color Theme:** All 8 Unique Helmets and the 9th Omni-Helmet define gold-brown aesthetic metadata (`color: '#d4af37'`, `glowColor: '#b8860b'`, `borderColor: '#8c6239'`).
  - **Omni-Helmet Synthesis:** The 9th Omni-Helmet ("The Celestial Crown of the Eternal Ouroboros") combines all capacities across the 8 unique helmets, actively executing both Titan Gorging on food consumption and Harvest Feast on enemy elimination.
- **Target Systems:**
  - `src/data/Types.ts` (Color/GlowColor/BorderColor on HelmetDef)
  - `src/data/UniqueHelmetsData.ts` (Aesthetic metadata, capacity descriptions, omni synthesis)
  - `src/sim/SnakePlayer.ts` (`HeadRadiusMultiplier`, `TitanGorgingTimer`, `triggerTitanGorging()`, `headRadius` dynamic scaling, `Update(dt)` countdown, and `BiteHeads()` bite radius scaling)
  - `src/sim/CombatSystem.ts` (`eatFood()` Titan Gorging trigger and FX popup; `handleEnemyKill()` / `onEnemyKilled()` Harvest Feast extra apple drops)
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) — Unique Helmets & Galaxy Jump Transcendence.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/UniqueHelmetGameplayCapacities.test.ts`
- **Assertions:**
  1. **Gold-Brown Metadata Conformance:**
     - All 8 Unique Helmets in `UNIQUE_HELMETS` contain `color: '#d4af37'`, `glowColor: '#b8860b'`, and `borderColor: '#8c6239'`.
     - The 9th Omni-Helmet from `forgeOmniHelmet()` and `CELESTIAL_OUROBOROS_HELMET` possesses the same gold-brown styling and combines all capacities.
  2. **Titan Gorging Simulation (Maw of the Behemoth):**
     - Equipping Maw of the Behemoth (`unique_helm_abyssal_leviathan`) and eating food activates Titan Gorging.
     - `HeadRadiusMultiplier` becomes 2.0, doubling `headRadius` (e.g. from 14 to 28) and `BiteHeads()[0].R`.
     - `TitanGorgingTimer` is set to 3.0 seconds.
     - Calling `Update(1.5)` decreases timer to 1.5 with `headRadius` remaining 2.0x.
     - Advancing by another 1.6 seconds (timer expires) resets `HeadRadiusMultiplier` to 1.0 and `headRadius` to 14.
  3. **Harvest Feast Simulation (Nanite Hivequeen):**
     - Equipping Nanite Hivequeen (`unique_helm_nanite_hivequeen`) and eliminating an enemy spawns 2-3 extra apples (3-4 total food items dropped).
     - Without the helmet, enemy elimination drops standard single food item (plus standard relic procs).
  4. **Omni-Helmet Dual-Capacity Synthesis:**
     - Equipping `CELESTIAL_OUROBOROS_HELMET` activates Titan Gorging upon food consumption (2x head radius for 3.0s).
     - Equipping `CELESTIAL_OUROBOROS_HELMET` activates Harvest Feast upon enemy kill (spawning 2-3 extra apples).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - [`src/data/Types.ts`](file:///home/forart/dev/snake_ts/src/data/Types.ts): Added optional `Color`, `GlowColor`, `BorderColor` and camelCase aliases to `HelmetDef`.
  - [`src/data/UniqueHelmetsData.ts`](file:///home/forart/dev/snake_ts/src/data/UniqueHelmetsData.ts): Added gold-brown metadata (`#d4af37` / `#b8860b` / `#8c6239`) to all 8 unique helmets and `forgeOmniHelmet()`. Explicitly defined Titan Gorging on Maw of the Behemoth (`unique_helm_abyssal_leviathan`) and Harvest Feast on Carapace of the Nanite Hivequeen (`unique_helm_nanite_hivequeen`).
  - [`src/sim/SnakePlayer.ts`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts): Added `HeadRadiusMultiplier`, `TitanGorgingTimer`, `triggerTitanGorging(duration)`, dynamic `headRadius` multiplier return, timer tickdown and expiration reset in `Update(dt)`, and bite radius synchronization in `BiteHeads()`.
  - [`src/sim/CombatSystem.ts`](file:///home/forart/dev/snake_ts/src/sim/CombatSystem.ts): In `eatFood()`, triggered `player.triggerTitanGorging(3.0)` and spawned `'TITAN GORGING! 2X SIZE'` text popup when wearing Maw of the Behemoth or Omni-Helmet. In `handleEnemyKill()`, spawned 2-3 extra apples when wearing Nanite Hivequeen or Omni-Helmet. Provided `onEnemyKilled()` / `OnEnemyKilled()` aliases.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/UniqueHelmetGameplayCapacities.test.ts
npm run typecheck
./verify
```

- **Vitest Conformance:** 147 test files (1,824 tests) passed with 100% PASS rate.
- **Strict Typecheck:** 0 errors on `tsc --noEmit`.
- **Production Build:** `dist/` compiled cleanly with zero errors.
