# Feature TDD Specification: In-Run & Global Statistics Screens

> **Feature Identifier:** `docs/tdd/run_and_global_stats_screens.tdd.md`  
> **Status:** Red (Test Authoring Phase)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

1. **Dual-Mode Stats Modal Screen (`src/ui/screens/StatsModalScreen.ts`):**
   - **Mode 'run' (In-Run Live Telemetry):**
     - Header: `📊 EXPEDITION TELEMETRY (FLOOR ${floor})`
     - Vitals: Current Score, Ouro Wallet, Serpent Length, Peak Length, High Combo.
     - Food Eaten Breakdown: Apples, Golden Apples, Potions, Shards, Prisms.
     - Bestiary Kills Breakdown: Swarmlings, Scarabs, Spitters, Phantoms, Arc Drones, Magma Brutes.
     - Boss Defeats: List of defeated colossal bosses with floor numbers.
     - Installed Cranial Modules & Augments.
     - 🎯 Live In-Run Challenge Progress Tracker: Locked Cranial Lab upgrades with exact live progress bars (e.g. `🔥 Magma Vent: Length 18 / 25`, `🪓 Ramming Horns: Kills 14 / 20`, `🧲 Bio-Magnet: Foods 22 / 30`).
   - **Mode 'global' (Global Career Statistics):**
     - Header: `📈 GLOBAL CAREER RECORDS`
     - Summary: Total Runs, Victories, Win Rate %, Highest Floor, Peak Length, High Score.
     - Lifetime Totals: Total Kills, Total Bosses, Total Food Ingested, Total Ouro Earned, Total Shards Collected.
     - Armory / Class mastery summary.

2. **HUD View Integration (`src/ui/HudView.ts`):**
   - Add `<button class="hud-icon-btn btn-stats" type="button" aria-label="Run Statistics" title="Run Statistics [T]">📊 <span class="btn-hotkey">[T]</span></button>` in HUD top actions row.
   - Click / pointerdown listener opens `this.root.showScreen('modal-stats', { mode: 'run' })`.
   - Add hotkey `KeyT` in input handling.

3. **Menu Screen Integration (`src/ui/screens/MenuScreen.ts`):**
   - Add `<button class="cyber-btn btn-ghost btn-global-stats">📊 Stats</button>` in `.menu-sub-row`.
   - Click listener opens `this.root.showScreen('modal-stats', { mode: 'global' })`.

4. **RootLayout & UiRoot Integration (`src/ui/RootLayout.ts` & `src/ui/UiRoot.ts`):**
   - Register `modal-stats` with `StatsModalScreen`.
   - Handle modal aliases `modal-stats`, `modal-run-stats`, `modal-global-stats`, `modal-records`.

5. **HTML & CSS Integration (`index.html`):**
   - Container `<div id="modal-stats" class="screen-modal modal-stats"></div>` and cybernetic glassmorphic styles.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/StatsModalScreen.test.ts`
- **Assertions:**
  1. `StatsModalScreen` instantiates cleanly with ID `'modal-stats'` and builds dual-mode segmented tabs.
  2. Mode 'run' renders live telemetry vitals (score, ouro, length, peak length, combo).
  3. Mode 'run' renders food breakdown (apples, golden, potions, shards, prisms) and bestiary kills breakdown (swarmlings, scarabs, spitters, phantoms, drones, brutes).
  4. Mode 'run' renders defeated bosses list and installed cranial modules/augments/helmet.
  5. Mode 'run' calculates and renders live progress bars for locked cranial upgrades.
  6. Mode 'global' renders career summary (total runs, victories, win rate %, highest floor, high score) and lifetime tallies.
  7. Segmented tab switching smoothly transitions between 'run' and 'global' modes.
  8. HUD view contains `.btn-stats` button and opens `modal-stats` with `{ mode: 'run' }`.
  9. Menu screen contains `.btn-global-stats` button and opens `modal-stats` with `{ mode: 'global' }`.
  10. Hotkey `KeyT` is handled by `InputManager` and toggles stats screen in `GameEngine`.
  11. `RootLayout` exports and registers `modal-stats` screen.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/screens/StatsModalScreen.ts` (New Screen)
  - `src/ui/RootLayout.ts` (New Module & Re-export)
  - `src/ui/HudView.ts` (Modified)
  - `src/ui/screens/MenuScreen.ts` (Modified)
  - `src/ui/UiRoot.ts` (Modified)
  - `src/sim/CombatSystem.ts` (Modified: tracked food & kill breakdowns)
  - `src/sim/SnakePlayer.ts` (Modified: tracked peak length)
  - `src/sim/GameEngine.ts` (Modified: stats toggle & hotkey handling)
  - `src/input/InputManager.ts` (Modified: KeyT hotkey)
  - `src/core/Contracts.ts` (Modified: IInput & ScriptedInput stats methods)
  - `src/data/Types.ts` (Modified: HelmetDef compatibility)
  - `src/main.ts` (Modified: screen registration & URL routing)
  - `index.html` (Modified: CSS and modal container)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/StatsModalScreen.test.ts src/tests/RunAndGlobalStatsScreens.test.ts
./verify
```

### Actual Results:
- **Strict TypeScript Typecheck**: 100% Pass (zero errors).
- **Vitest Conformance Suites**: 63/63 test files passed, 809/809 tests passed (100% Green).
  - `src/tests/StatsModalScreen.test.ts`: 11/11 tests passed.
  - `src/tests/RunAndGlobalStatsScreens.test.ts`: 10/10 tests passed.
- **Production Bundle Build**: 100% Pass (Vite production build verified).

