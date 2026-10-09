# Feature TDD Specification: Ouro Currency Aliases & Codex Terminology

> **Feature Identifier:** `docs/tdd/ouro_currency_aliases_and_codex_terminology.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Expose dual camelCase and PascalCase `ouro` / `Ouro` getters and setters on [`SnakePlayer`](file:///home/forart/dev/snake_ts/src/sim/SnakePlayer.ts) reflecting the continuous in-run currency balance (`this.Xp` / `this.TotalXpCollected`), provide helper methods `gainOuro(amount)` and `GainOuro(amount)` aliasing `GainXp(amount)`, update in-game codex entries in [`CodexData.ts`](file:///home/forart/dev/snake_ts/src/data/CodexData.ts) replacing in-run "XP" references with "Ouro", update all user-facing card descriptions in [`GameData.ts`](file:///home/forart/dev/snake_ts/src/data/GameData.ts) (Gourmand, Combo Surge, Soul Harvest), update [`Helmets.ts`](file:///home/forart/dev/snake_ts/src/data/Helmets.ts) stat formatters, update dev checklist specifications in [`DevChecklistData.ts`](file:///home/forart/dev/snake_ts/src/data/DevChecklistData.ts), and update [`SnakeLabScreen.ts`](file:///home/forart/dev/snake_ts/src/ui/screens/SnakeLabScreen.ts) telemetry chips and action labels to pure Ouro.
- **Target Systems:**
  - `src/sim/SnakePlayer.ts`: `ouro`, `Ouro`, `totalOuroCollected`, `TotalOuroCollected`, `gainOuro()`, `GainOuro()`.
  - `src/ui/screens/SnakeLabScreen.ts`: `🪙 ${Math.floor(ouro)} Ouro` chip telemetry, button cost badges `(cost Ouro)`.
  - `src/data/GameData.ts`: Card descriptions (Gourmand: `+20% Ouro Gained`, Combo Surge: `+15% Ouro Gained`, Soul Harvest: `+60% kill Ouro`).
  - `src/data/CodexData.ts`: In-run currency and formula references updated from "XP" to "Ouro".
  - `src/data/DevChecklistData.ts`: Subtitles, technical analysis, subtasks, and diagnostic checks updated from "XP" to "Ouro".
  - `src/data/Helmets.ts`: `xpMultiplier` formatted as `+X% Ouro`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** [`src/tests/OuroCurrencyAndCodexTerminology.test.ts`](file:///home/forart/dev/snake_ts/src/tests/OuroCurrencyAndCodexTerminology.test.ts)
- **Assertions:**
  1. `SnakePlayer` exposes `ouro` and `Ouro` getters/setters that get and set the active currency balance (`Xp`).
  2. `SnakePlayer` exposes `totalOuroCollected` and `TotalOuroCollected` getters/setters aliasing `TotalXpCollected`.
  3. `SnakePlayer` exposes `gainOuro(amount)` and `GainOuro(amount)` methods that properly invoke `GainXp(amount)` and return level-up status.
  4. `CodexData.Entries` contains updated in-run references replacing "XP" with "Ouro" for ambient drops, Cranial Lab costs, Frenzy multipliers, Card Draft descriptions, and master equations formulas (`Ouro_{req}`).
  5. `GameData.CardPool` card definitions (Gourmand, Combo Surge, Soul Harvest) state "+Ouro Gained" / "+Ouro" and zero references to "XP".
  6. `formatHelmetStatDescription` formats `xpMultiplier` as "+X% Ouro".
  7. `DevChecklistData` subtitles, subtasks, and diagnostic failure signatures reference Ouro with zero "XP" references.
  8. `SnakeLabScreen` renders `🪙 ${Math.floor(ouro)} Ouro` stat chips and `(cost Ouro)` button labels.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/sim/SnakePlayer.ts`:
    - Added `ouro` / `Ouro` getters and setters accessing `this.Xp`.
    - Added `totalOuroCollected` / `TotalOuroCollected` getters and setters accessing `this.TotalXpCollected`.
    - Added `GainOuro(amount)` and `gainOuro(amount)` helper methods aliasing `GainXp(amount)`.
  - `src/ui/screens/SnakeLabScreen.ts`:
    - Updated quick stats pill bar from `⚡ ${xp} XP` to `🪙 ${Math.floor(ouro)} Ouro`.
    - Updated augment action buttons from `(${cost} ⚡)` to `(${cost} Ouro)`.
  - `src/data/GameData.ts`:
    - Updated Gourmand: `+20% Ouro Gained`.
    - Updated Combo Surge: `+50% Combo Window, +15% Ouro Gained`.
    - Updated Soul Harvest: `Kills drop soul orbs, +60% kill Ouro`.
  - `src/data/CodexData.ts`:
    - Updated `rules_food_economy` summary, TL;DR, tips, and pill badges to display +Ouro gains for all 9 ambient drops.
    - Updated `rules_combo_overdrive` to state "double Ouro".
    - Updated `classes_cranial_lab` module and augment purchase costs to "Ouro".
    - Updated `combat_constriction` Astral Prism fusion bonus to "+300% Ouro".
    - Updated `combat_card_drafts` Gourmand and Soul Harvest card descriptions to Ouro, formula to `Ouro_{req}`.
    - Updated `formulas_master_equations` to specify Ouro level-up curves (`Ouro_{req}`).
  - `src/data/DevChecklistData.ts`:
    - Updated cranial bio item subtitle, summary, subtasks, and diagnostics from XP to Ouro.
    - Updated lab UX item technical analysis from XP to Ouro.
  - `src/data/Helmets.ts`:
    - Updated `formatHelmetStatDescription` to output `+${Math.round(stats.xpMultiplier * 100)}% Ouro`.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/OuroCurrencyAndCodexTerminology.test.ts
npm run typecheck
./verify
```

- **Vitest Suite Result:** 100% PASS (10/10 tests passed).
- **TypeScript Typecheck:** Zero errors (`tsc --noEmit`).
- **Quality Gate:** Full conformance verification passed.
