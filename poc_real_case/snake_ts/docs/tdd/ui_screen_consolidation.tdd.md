# Feature TDD Specification: UI / UX Screen Consolidation & Modal Shell Architecture

> **Feature Identifier:** `docs/tdd/ui_screen_consolidation.tdd.md`  
> **Status:** Green / Completed & Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Consolidate and standardize the UI modal architecture across Ouroboros Ascension. Unify run conclusion screens (`GameOverScreen` and `FloorClearScreen`) into a polymorphic `RunSummaryScreen` supporting `defeat`, `floor_clear`, and `victory` modes; introduce a dedicated `PauseSettingsScreen` for seamless in-game pause overlays with instant controls and run abandonment; standardize `Widgets` with rich glassmorphic components; introduce `BaseModalScreen` for uniform modal lifecycle and DOM structure; and guarantee 100% non-regression across all modal navigation, alias resolutions, responsive metrics, and touch dock controls.
- **Target Systems:** `src/ui/`, `src/ui/screens/`, `src/sim/`, `src/tests/`
- **Mechanics & Architectural Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md), [`AGENTS.md`](file:///home/forart/dev/snake_ts/AGENTS.md)

### Key Requirements & Deliverables

1. **`BaseModalScreen` & `ModalShell` Architecture (`src/ui/BaseModalScreen.ts`)**:
   - Abstract modal base class providing standardized DOM creation, class toggles (`modal-overlay`), lifecycle hooks (`show`, `hide`, `refresh`, `onShow`, `onHide`), and shell generation.
   - Built-in support for safe-area insets, responsive scale propagation, and keyboard/touch event delegation.

2. **Standardized Glassmorphic UI Widgets (`src/ui/Widgets.ts`)**:
   - Numeric formatters: `grouped(n)` (thousands separator), `plain(n)`.
   - Structural components: `createGlassPanel(maxWidth, extraClass)`, `createModalHeader(title, subtitle, titleClass)`, `createStatCard(label, val, color, valClass)`, `createStatGrid(cards, extraClass)`, `createActionsRow(...buttons)`.
   - Form & setting controls: `createSliderRow(...)`, `createCheckboxRow(...)`, `createSelectRow(...)`, `createButton(...)`, `createBadge(...)`, `createMeter(...)`.

3. **Polymorphic `RunSummaryScreen` (`src/ui/screens/RunSummaryScreen.ts`)**:
   - Single unified screen handling three distinct telemetry states:
     - `'defeat'`: Serpent Dissolution, failure subtitle, red title, final floor, total score, max combo, essence collected, hostiles killed, Retry ("Rise Again ⚡"), Sanctuary, Main Menu.
     - `'floor_clear'`: Floor X Cleared, cleansing subtitle, gold/cyan title, shards earned, current score, kills, peak combo, Next Floor ("Descend to Next Floor ⚡").
     - `'victory'`: Great Serpent Ascension, cosmic completion subtitle, victory title, total floors, final score, max combo, banked essence, total kills, Ascend Again, Sanctuary, Main Menu.
   - Dynamic mode switching via payload (`'defeat'`, `'floor_clear'`, `'victory'`) or automatic inference from `GameEngine` combat stats and run state.
   - 100% backwards compatibility with legacy query selectors (`.victory-floor-num`, `.shards-earned-val`, `.score-earned-val`, `.kills-val`, `.combo-peak-val`, `.btn-next-floor`, `.end-floor-val`, `.end-score-val`, `.end-combo-val`, `.end-shards-val`, `.end-kills-val`, `.btn-retry`, `.btn-sanctuary`, `.btn-menu`).
   - `GameOverScreen` and `FloorClearScreen` subclass / delegate to `RunSummaryScreen` with matching default modes and screen IDs (`modal-game-over`, `modal-floor-clear`, `modal-summary`).

4. **Dedicated In-Game Pause Overlay (`src/ui/screens/PauseSettingsScreen.ts` & `src/ui/screens/SettingsScreen.ts`)**:
   - Dedicated pause screen registered under `modal-pause`.
   - Quick Resume button (`.btn-resume` / `.btn-close-settings`) with hotkey `[P]` / `Escape` support that resumes gameplay, unpauses audio, and clears modals.
   - Real-time audio & screen shake sliders (SFX volume, Music volume, Mute toggle, Screen Shake scale) with instant dispatch to `Services.Sound` and `Services.Fx`.
   - Quick "Abandon Expedition" button (`.btn-abandon` / `.btn-danger`) triggering dissolution / defeat handling and returning cleanly.
   - Quick jumper button to Codex/Help (`.btn-settings-codex`) and Full Settings (`.btn-full-settings`).

5. **Modal Navigation Stack, Alias Resolution & Touch Dock Integrity**:
   - Robust alias mapping in `UiRoot.ts` for `modal-summary`, `modal-game-over`, `modal-floor-clear`, `modal-pause`, `modal-settings`, `modal-draft`, `modal-level-up`, `modal-codex`, `modal-guide`, `modal-help`, `modal-checklist`, `modal-dev-checklist`.
   - Multi-layer modal navigation stack push/pop preserving previous screen history without blank or orphaned screens.
   - Automatic touch joystick/dock hiding when modals are active, with proper reactivation on touch devices upon modal dismissal.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/UiScreenConsolidation.test.ts`
- **Assertions:**
  1. **Standardized Widgets & BaseModalScreen**:
     - `BaseModalScreen` renders `.modal-overlay` container with custom modal ID and handles `show()` / `hide()` lifecycle callbacks.
     - `Widgets.grouped()` formats thousands correctly (`12500` -> `'12,500'`).
     - `Widgets.createGlassPanel()` creates element with `.modal-panel.glass-panel` and configurable max-width.
     - `Widgets.createModalHeader()` creates title and subtitle elements with cybernetic typography styling.
     - `Widgets.createStatCard()` creates label, value, and exposes `setValue()` updater.
     - `Widgets.createSliderRow()`, `createCheckboxRow()`, `createSelectRow()`, `createActionsRow()` build fully interactive form rows with live callbacks.
  2. **Polymorphic RunSummaryScreen (`modal-summary`)**:
     - Mode `'defeat'`: Displays "SERPENT DISSOLUTION", renders stats (`.end-floor-val`, `.end-score-val`, `.end-combo-val`, `.end-shards-val`, `.end-kills-val`), and action buttons (`.btn-retry`, `.btn-sanctuary`, `.btn-menu`). Clicking retry triggers `engine.restartRun()`.
     - Mode `'floor_clear'`: Displays "FLOOR X CLEARED!", renders stats (`.victory-floor-num`, `.shards-earned-val`, `.score-earned-val`, `.kills-val`, `.combo-peak-val`), and next floor button (`.btn-next-floor`). Clicking next floor triggers `engine.nextFloor()`.
     - Mode `'victory'`: Displays "GREAT SERPENT ASCENSION", renders all victory metrics and action buttons (`.btn-retry`, `.btn-sanctuary`, `.btn-menu`).
     - Dynamic payload switching: Invoking `show({ mode: 'floor_clear' })` dynamically reconstructs/updates the screen to floor clear state; invoking `show({ mode: 'defeat' })` transitions to defeat state.
     - Legacy wrappers `GameOverScreen` and `FloorClearScreen` maintain exact ID, DOM structure, and behavior.
  3. **Dedicated In-Game Pause Overlay (`PauseSettingsScreen`)**:
     - Registers with ID `modal-pause` and renders "SYSTEM PAUSED" / "GAME PAUSED".
     - Resume button (`.btn-resume` / `.btn-close-settings`) resumes `GameState.Playing`, unpauses audio engine, and closes modal.
     - Live audio sliders (SFX, Music, Mute, Shake) update settings in real time and trigger sound/FX service methods.
     - Abandon button (`.btn-abandon`) triggers `engine.handleGameOver(false)` and cleans up pause state.
     - Codex button (`.btn-settings-codex`) transitions to `modal-help` with back navigation to pause screen.
  4. **UiRoot Navigation Stack & Non-Regression**:
     - `resolveId` correctly maps all aliases bidirectionally (`modal-summary` <-> `modal-game-over`, `modal-pause` <-> `modal-settings`, `modal-codex` -> `modal-help`, etc.).
     - Multi-level screen stack preserves history and restores parent screen on `hideScreen()`.
     - Touch dock is hidden when modals are open and restored when modals close on touch devices.
     - 100% pass rate across all existing test suites (`npm test`).

---

## 3. Implementation Details (Green Phase)

- **Files Created:**
  - `src/ui/BaseModalScreen.ts`: Abstract base class with lifecycle and DOM shell builders.
  - `src/ui/screens/RunSummaryScreen.ts`: Consolidated polymorphic run summary screen.
  - `src/ui/screens/PauseSettingsScreen.ts`: Dedicated in-game pause screen.
  - `src/tests/UiScreenConsolidation.test.ts`: Vitest comprehensive test suite (22 tests).
- **Files Modified:**
  - `src/ui/Widgets.ts`: Standardized UI helpers and component generators.
  - `src/ui/screens/GameOverScreen.ts`: Subclasses `RunSummaryScreen` with default mode `'defeat'`.
  - `src/ui/screens/FloorClearScreen.ts`: Subclasses `RunSummaryScreen` with default mode `'floor_clear'`.
  - `src/ui/screens/SettingsScreen.ts`: Enhanced pause support and standardized helper bindings.
  - `src/ui/UiRoot.ts`: Bidirectional alias resolution and payload delegation.
  - `src/ui/HudView.ts`: Added `touchControlsVisible` state getter.
  - `src/ui/ResponsiveLayout.ts`: Standardized `setMetricsForTesting()` helper.
  - `src/main.ts`: Registered `RunSummaryScreen` and `PauseSettingsScreen`.

---

## 4. Verification & Quality Check

```bash
# 1. New Feature Conformance Suite
npx vitest run src/tests/UiScreenConsolidation.test.ts
# Result: 22 passed (22 tests, 100% PASS)

# 2. Complete UI Test Matrix (12 test files, 199 tests)
npx vitest run src/tests/UiScreenConsolidation.test.ts src/tests/UiLayoutAudit.test.ts src/tests/ModalNavigationAndUnpause.test.ts src/tests/HelpScreenMobilePolishAndDevChecklist.test.ts src/tests/InteractiveCodexHelpScreen.test.ts src/tests/SmartphoneHudAndLabClarity.test.ts src/tests/MobileTouchControls.test.ts src/tests/GalaxyMainMenuAndMultiScreen.test.ts src/tests/DeviceTierUiLayout.test.ts src/tests/UiTextOverlapAndAlignment.test.ts src/tests/PlatformAndUiIntegrity.test.ts src/tests/SelfTest.test.ts
# Result: 12 passed (199 tests, 100% PASS, 0 regressions)

# 3. Strict Type Safety Check
npm run typecheck
# Result: 100% PASS (Zero TypeScript errors)
```

