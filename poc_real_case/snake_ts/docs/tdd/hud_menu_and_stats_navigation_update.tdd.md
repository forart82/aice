# Feature TDD Specification: Unified HUD, Main Menu & Stats Navigation Update

> **Feature Identifier:** `docs/tdd/hud_menu_and_stats_navigation_update.tdd.md`  
> **Status:** Green (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Unify the HUD, Main Menu, and Modal Navigation system between `HudView`, `StatsModalScreen`, `MenuScreen`, `UiRoot`, and `RootLayout`:
  1. **HudView (`src/ui/HudView.ts`):**
     - Unified Lab & Stats HUD triggers:
       - `🧬 [L]` button: opens `this.root.showScreen('modal-snake-lab', { tab: 'lab' })`.
       - `📊 [T]` button: opens `this.root.showScreen('modal-snake-lab', { tab: 'telemetry' })`.
       - Hotkey `KeyL`: opens Lab tab (`this.root.showScreen('modal-snake-lab', { tab: 'lab' })`).
       - Hotkey `KeyT`: opens Telemetry/Challenges tab (`this.root.showScreen('modal-snake-lab', { tab: 'telemetry' })`).
  2. **StatsModalScreen (`src/ui/screens/StatsModalScreen.ts`):**
     - When opened during an active run without explicit global mode request, seamlessly delegates to `this.root.showScreen('modal-snake-lab', { tab: 'telemetry' })`.
     - When opened from the Main Menu (`📊 Stats` button) or with `{ mode: 'global' }`, exclusively renders `📈 GLOBAL CAREER RECORDS` (lifetime stats, total runs, victories, win rate, high floors, high scores, lifetime bestiary, class masteries).
  3. **MenuScreen (`src/ui/screens/MenuScreen.ts`):**
     - `📊 Stats` button opens `modal-stats` with `{ mode: 'global' }`.
  4. **UiRoot & RootLayout (`src/ui/UiRoot.ts`, `src/ui/RootLayout.ts`):**
     - Screen routing, history stack, and registration parity for `modal-snake-lab` and `modal-stats`.
- **Target Systems:** `src/ui/HudView.ts`, `src/ui/screens/StatsModalScreen.ts`, `src/ui/screens/MenuScreen.ts`, `src/ui/UiRoot.ts`, `src/ui/RootLayout.ts`.
- **Mechanics Reference:** [`ORACLE.md#3.6`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/HudMenuAndStatsNavigationUpdate.test.ts`
- **Assertions:**
  1. `HudView` `.btn-lab` (`🧬 [L]`) triggers `root.showScreen('modal-snake-lab', { tab: 'lab' })`.
  2. `HudView` `.btn-stats` (`📊 [T]`) triggers `root.showScreen('modal-snake-lab', { tab: 'telemetry' })`.
  3. `HudView` hotkey `KeyL` opens `modal-snake-lab` on the `'lab'` tab.
  4. `HudView` hotkey `KeyT` opens `modal-snake-lab` on the `'telemetry'` tab.
  5. `StatsModalScreen` seamlessly delegates to `modal-snake-lab` (`{ tab: 'telemetry' }`) when opened during an active run.
  6. `StatsModalScreen` exclusively renders `📈 GLOBAL CAREER RECORDS` when invoked with `{ mode: 'global' }` or from the Main Menu.
  7. `MenuScreen` `.btn-global-stats` / `.btn-stats` opens `modal-stats` with `{ mode: 'global' }`.
  8. `RootLayout` initializes and resolves `modal-stats` and `modal-snake-lab` properly.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/HudView.ts`
  - `src/ui/screens/StatsModalScreen.ts`
  - `src/ui/screens/MenuScreen.ts`
  - `src/ui/UiRoot.ts`
  - `src/ui/RootLayout.ts`
  - `src/tests/HudMenuAndStatsNavigationUpdate.test.ts`
  - `src/tests/StatsModalScreen.test.ts`

---

## 4. Verification & Quality Check

```bash
# Test execution
npx vitest run src/tests/HudMenuAndStatsNavigationUpdate.test.ts
# Complete Quality Gate
./verify
```

- **Actual Results:**
  - `HudMenuAndStatsNavigationUpdate.test.ts`: 8/8 PASS
  - `StatsModalScreen.test.ts`: 15/15 PASS
  - `./verify`: 100% PASS (Strict Typecheck + 78 Test Suites / 987 Tests + Production Bundle Build)
