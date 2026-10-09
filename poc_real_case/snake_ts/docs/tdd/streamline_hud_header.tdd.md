# Feature TDD Specification: Streamlined HUD Header & Key Action Hotkeys

> **Feature Identifier:** `docs/tdd/streamline_hud_header.tdd.md`  
> **Status:** Green (100% Conformance Verified & Quality Gate Passed)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Streamline the top-right HUD header actions (`.hud-top-actions`) in `HudView.ts` to reduce visual clutter and maximize gameplay viewport area on both desktop and mobile screens.
- **Key Changes:**
  1. **DOM Markup Streamlining (`.hud-top-actions`):**
     - Removed `btn-codex` (`📖 [H]`) and `btn-stats` (`📊 [T]`) icon buttons from the DOM template.
     - Kept exclusively two primary HUD action buttons:
       1. `🧬 [L]` (`.btn-lab`): Opens Cranial Mutation Lab Hub (`modal-snake-lab`).
       2. `⏸️ [P]` (`.btn-pause`): Opens Pause Menu Overlay (`modal-pause`).
  2. **Hotkey Preservation in `handleKeyDown` (`src/ui/HudView.ts`):**
     - Maintained and extended full keyboard hotkey support in the active HUD layer:
       - `KeyL`: opens `modal-snake-lab` on `'lab'` tab (`{ tab: 'lab' }`).
       - `KeyT`: opens `modal-snake-lab` on `'telemetry'` / `'stats'` tab (`{ tab: 'telemetry' }`).
       - `KeyP` / `Escape`: toggles Pause menu (`engine.togglePause()` or `modal-pause`).
       - `KeyH`: opens Codex guide (`engine.showHelp()` or `modal-help`).
- **Target Systems:** `src/ui/HudView.ts`, `src/tests/StreamlineHudHeader.test.ts`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/StreamlineHudHeader.test.ts`
- **Assertions:**
  1. `HudView` DOM contains `.btn-lab` and `.btn-pause` in `.hud-top-actions`.
  2. `HudView` DOM does NOT contain `.btn-codex` or `.btn-stats`.
  3. Clicking `.btn-lab` opens `modal-snake-lab` with `{ tab: 'lab' }` and triggers UI sound.
  4. Clicking `.btn-pause` invokes `engine.togglePause()` or opens `modal-pause` and triggers UI sound.
  5. `handleKeyDown` dispatches `KeyL` to `modal-snake-lab` on `'lab'`.
  6. `handleKeyDown` dispatches `KeyT` to `modal-snake-lab` on `'telemetry'` / `'stats'`.
  7. `handleKeyDown` dispatches `KeyP` and `Escape` to toggle Pause (`engine.togglePause()` / `modal-pause`).
  8. `handleKeyDown` dispatches `KeyH` to Codex guide (`engine.showHelp()` / `modal-help`).
  9. `handleKeyDown` safely ignores input when HUD is hidden (`display: none`) or when typing into an input / textarea.

---

## 3. Implementation Details (Green Phase)

- **Files Modified/Created:**
  - `src/ui/HudView.ts`:
    - Cleaned up top-right HUD action DOM markup in `build()`.
    - Removed unused button queries and listeners for `.btn-codex` and `.btn-stats`.
    - Maintained and cleaned listener handlers for `.btn-lab` and `.btn-pause`.
    - Enhanced `handleKeyDown` to handle `KeyL`, `KeyT`, `KeyP`, `Escape`, and `KeyH` with comprehensive Rule 10 docstrings and audio dispatch.
  - `src/tests/StreamlineHudHeader.test.ts`:
    - Comprehensive 10-test suite verifying clean DOM and all hotkeys.
  - `src/tests/RunAndGlobalStatsScreens.test.ts`:
    - Updated test 3.1 to verify hotkey `KeyT` dispatch and absence of `.btn-stats` in HUD DOM.
  - `src/tests/StatsModalScreen.test.ts`:
    - Updated test 8 to verify hotkey `KeyT` dispatch and absence of `.btn-stats` in HUD DOM.

---

## 4. Verification & Quality Gate

```bash
npx vitest run src/tests/StreamlineHudHeader.test.ts
./verify
```

- **Actual Results:**
  - `StreamlineHudHeader.test.ts`: 10/10 PASS
  - `HudMenuAndStatsNavigationUpdate.test.ts`: 10/10 PASS
  - `RunAndGlobalStatsScreens.test.ts`: 10/10 PASS
  - `StatsModalScreen.test.ts`: 13/13 PASS
  - `./verify`: 100% PASS (Typecheck 0 errors + 87 Test Files / 1,097 Tests + Production Bundle Build)
