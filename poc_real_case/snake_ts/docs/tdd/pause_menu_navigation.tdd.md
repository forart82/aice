# Feature TDD Specification: Main Menu Navigation from Pause Mode

> **Feature Identifier:** `docs/tdd/pause_menu_navigation.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Enable players to seamlessly navigate back to the Main Menu directly from the in-game Pause screen (`PauseSettingsScreen.ts`), rather than only having the option to resume or abandon to the Game Over screen.
- **Target Systems:**
  - `src/ui/screens/PauseSettingsScreen.ts`: Add `.btn-main-menu` button to the modal actions row. Attach event handler that saves settings, plays UI audio, triggers `engine.showMenu()`, and shows `modal-main-menu`.
  - `src/sim/GameEngine.ts`: Verify `showMenu()` / `ShowMenu()` resets `State` to `GameState.Menu`, banks shards via `AbandonRun()`, and routes UI to `modal-main-menu`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) — State transitions & UI modal lifecycle.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/PauseMenuNavigation.test.ts`
- **Assertions:**
  1. **Button Presence:** `PauseSettingsScreen` modal actions row contains `<button class="cyber-btn btn-danger btn-main-menu">...Main Menu</button>`.
  2. **Engine Navigation & State Transition:** Clicking `.btn-main-menu` when paused invokes `engine.showMenu()` and transitions `engine.State` to `GameState.Menu`.
  3. **Modal Dismissal & Main Menu Presentation:** Clicking `.btn-main-menu` dismisses `modal-pause` (`display: none` / inactive) and displays `modal-main-menu` (`uiRoot.activeScreenId === 'modal-main-menu'`).
  4. **Run Abandonment & Audio/Settings:** Run is cleanly abandoned/committed without entering `GameOver` screen, UI sound is played, and settings are preserved.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/pause_menu_navigation.tdd.md`
  - `src/tests/PauseMenuNavigation.test.ts`
  - `src/ui/screens/PauseSettingsScreen.ts`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/PauseMenuNavigation.test.ts
# ✓ src/tests/PauseMenuNavigation.test.ts (6 tests) 36ms
# Test Files  1 passed (1)
# Tests       6 passed (6)
```

All 6 test cases passed:
1. `PauseSettingsScreen` contains a dedicated Main Menu button (`.btn-main-menu`) with class `btn-danger`.
2. Clicking `.btn-main-menu` calls `engine.showMenu()`.
3. Clicking `.btn-main-menu` resets `engine.State` to `GameState.Menu`.
4. Clicking `.btn-main-menu` dismisses `modal-pause` overlay and displays `modal-main-menu`.
5. Clicking `.btn-main-menu` plays UI audio, persists settings, and cleanly abandons active expedition without triggering Game Over.
6. Responsive layout test confirms `.btn-main-menu` integrates smoothly into the actions row across mobile and desktop viewports.
