# Feature TDD Specification: Modal Navigation Stack & In-Game Pause/Resume

> **Feature ID:** `modal_navigation_and_unpause`  
> **Status:** Red $\rightarrow$ Green $\rightarrow$ Refactor  
> **Target Files:**
> - `src/ui/UiRoot.ts`
> - `src/ui/screens/SettingsScreen.ts`
> - `src/sim/GameEngine.ts`
> - `src/tests/ModalNavigationAndUnpause.test.ts`

---

## 1. Problem Statement & User Requirements

1. **Bug 1 (Main Menu Settings Return):**
   - When in the Main Menu (`modal-main-menu`), opening Settings (`modal-settings`) and clicking "Save & Close" (`btn-close-settings`) closes the modal but leaves the user on a blank screen without returning to the Main Menu.
2. **Bug 2 (In-Game Pause Modal Stuck in Pause):**
   - When in-game and pressing 'P' (or tapping Pause), the settings/pause modal opens and the game enters `GameState.Paused`.
   - Clicking "Save & Close" closes the modal, but the game engine remains stuck in `GameState.Paused`, requiring the player to press 'P' a second time to resume.
3. **Universal Screen Navigation Stack & Go-Back Requirement:**
   - Every modal / popup screen (`modal-settings`, `modal-sanctuary`, `modal-class-select`, `modal-snake-lab`, `modal-multiscreen`, `modal-level-up`, `modal-floor-clear`, `modal-game-over`) must participate in an authoritative navigation history stack.
   - Closing any modal must cleanly return to its parent screen or seamlessly unpause active gameplay.

---

## 2. Test Matrix Specifications (`ModalNavigationAndUnpause.test.ts`)

1. **Test 1:** Main Menu $\rightarrow$ Settings $\rightarrow$ Save & Close $\implies$ returns to Main Menu (`activeScreenId === 'modal-main-menu'`).
2. **Test 2:** In-Game (`GameState.Playing`) $\rightarrow$ Pause ('P' / HUD) $\rightarrow$ Settings modal shown $\rightarrow$ Click Save & Close $\implies$ modal closed, engine unpaused (`engine.State === GameState.Playing`, `engine.paused === false`).
3. **Test 3:** In-Game $\rightarrow$ Pause $\rightarrow$ Press 'P' again $\implies$ unpauses and resumes gameplay.
4. **Test 4:** Main Menu $\rightarrow$ Sanctuary $\rightarrow$ Settings $\rightarrow$ Save & Close $\implies$ returns to Sanctuary $\rightarrow$ Return to Menu $\implies$ returns to Main Menu.
5. **Test 5:** Main Menu $\rightarrow$ Class Select $\rightarrow$ Back $\implies$ returns to Main Menu.
6. **Test 6:** Main Menu $\rightarrow$ MultiScreen $\rightarrow$ Close $\implies$ returns to Main Menu.
7. **Test 7:** In-Game $\rightarrow$ Snake Lab $\rightarrow$ Deploy / Close $\implies$ unpauses and returns to playing state.
8. **Test 8:** Main Menu $\rightarrow$ Snake Lab $\rightarrow$ Close $\implies$ returns to Main Menu.
9. **Test 9:** Modal stack depth management (deep nested modal navigation handles multiple pop/push transitions without orphan screens or memory leaks).

---

## 3. Implementation Plan

1. In `UiRoot.ts`:
   - Introduce `_navigationStack: string[] = []`.
   - In `showScreen(id, payload)`: If an active screen was open and the new screen is a overlay/modal, push the old `activeScreenId` onto `_navigationStack`.
   - In `hideScreen(id)`: When closing a screen, pop and return to previous screen from `_navigationStack` if available, or fall back to `'modal-main-menu'` if `GameState.Menu`.
2. In `SettingsScreen.ts`:
   - In `btn-close-settings` click listener, if `this.root.engine && (this.root.engine.state === GameState.Paused || this.root.engine.State === GameState.Paused)`, invoke `this.root.engine.Resume()` / `resume()` to automatically unpause the game.
   - Call `this.root.hideScreen('modal-settings')`.
3. In `GameEngine.ts`:
   - Ensure `Resume()` cleanly clears modals, restores HUD, and sets `State = GameState.Playing`.
