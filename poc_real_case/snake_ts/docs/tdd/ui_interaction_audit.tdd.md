# Feature TDD Specification: Deep UI Screens, Buttons & Interactive Conformance Audit

> **Feature Identifier:** `docs/tdd/ui_interaction_audit.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Programmatic simulation and behavioral validation for EVERY UI screen, modal, button, slider, and interactive element across the game shell.
- **Target Systems:**
  - `src/ui/screens/MenuScreen.ts` (Mode buttons, Sanctuary, Mutation Lab, Settings, Multi-Screen)
  - `src/ui/screens/ClassSelectScreen.ts` (5 Archetype cards, locked/unlocked state, shard purchase, Back, Ascend Now)
  - `src/ui/screens/DraftScreen.ts` (Card selection 1..3, rarity cards, Re-roll button, Skip button)
  - `src/ui/screens/SnakeLabScreen.ts` (Part selector -2/-1/0..N, Socket selector L1/C1/R1, Module install, Upgrade, Replace confirmation 2-step banner, Clear socket, Cranial augments, Drag-pan, Wheel zoom, Pagination tabs [All]/[1-10]..., Prev/Next navigation buttons, Deploy button)
  - `src/ui/screens/SanctuaryScreen.ts` (Blessing upgrades, Shard balance deductions, Armed 2-step progress erase confirmation, Return to menu)
  - `src/ui/screens/SettingsScreen.ts` (SFX & Music volume sliders, Mute checkbox, Screen shake slider, Quality dropdown, CRT checkbox, FPS toggle, Touch scheme selector, Lefty mode toggle, Save & close)
  - `src/ui/screens/FloorClearScreen.ts` (Stats telemetry display, Next Floor descent button)
  - `src/ui/screens/GameOverScreen.ts` (Defeat summary telemetry, Rise Again retry button, Sanctuary shortcut, Main menu button)
  - `src/ui/screens/MultiScreenModal.ts` (Companion QR & URL copy, Multi-monitor popout window, Close modal)
  - `src/ui/HudView.ts` (Layered health & shield bars, XP counter, Dash/Skill cooldown sweep percentages, Combo & multiplier meters, Floor progress bar, Lab button, Pause button, Boss health bar, FPS counter)
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:**
  - `src/tests/UiLayoutAudit.test.ts`
  - `src/tests/MutationLabAndDamageFeedback.test.ts`
- **Assertions:**
  1. **MenuScreen**: Simulating clicks on all 4 game mode buttons (`rogue`, `endless`, `bossrush`, `daily`) triggers `Services.Sound.playUi()` and delegates to `engine.chooseMode()`. Sub-row buttons (`.btn-sanctuary`, `.btn-lab`, `.btn-multiscreen`, `.btn-settings`) trigger sound and open corresponding screens in `UiRoot`.
  2. **ClassSelectScreen**: Simulates selecting unlocked class cards (`emerald`, `stalker`, `hydra`, `storm`, `solar`), purchasing locked class cards with shards (with `playLevelUp()` or `playError()`), double-clicking to ascend, clicking Back button to return to menu, and clicking Ascend Now button.
  3. **DraftScreen**: Simulates drafting cards 1..3 across rarities, triggers `playLevelUp()` and invokes `engine.selectUpgradeCard()`. Re-roll button decrements remaining rerolls and triggers `engine.rerollDraft()`. Skip button grants +25 HP and triggers `engine.skipDraft()`.
  4. **SnakeLabScreen Interactive Matrix**:
     - Anatomical part selection (-2 Overview, -1 Cranial Head, 0..N-1 Body parts).
     - Prev / Next navigation cycles through all body nodes seamlessly.
     - Sockets L1 / C1 / R1 tab switching.
     - Module installation and leveling with XP cost calculation.
     - 2-step armed replacement confirmation modal/banner with cancel and confirm paths.
     - Socket clearing (remove module).
     - Head cranial augment installation and upgrade.
     - Pagination tabs (`[All]`, `[1-10]`, `[11-20]`...) for snakes with 50+ segments.
     - Canvas coordinate transformation (`screenToWorld`), drag-pan, and wheel zoom clamping.
     - Deploy button resuming active run or starting run.
  5. **SanctuaryScreen**:
     - Upgrading each of the sanctuary blessings (`vitality`, `chitin`, `frenzy`, `magnet`, `potency`, etc.), verifying level increments, shard balance deductions, and `playLevelUp()`.
     - Erase All Progress button: 1st click arms confirmation, 2nd click executes reset with `playExplosion()`.
     - Return to Menu button transitions to `modal-main-menu`.
  6. **SettingsScreen**:
     - Sliders (SFX, Music, Shake) update settings model, label text, and platform audio/fx hooks.
     - Checkboxes (Mute, CRT filter, Show FPS, Lefty pad) mutate settings and update DOM/InputManager.
     - Selects (Quality, Touch scheme) apply render quality and control schemes.
     - Save & Close button persists settings and hides modal.
  7. **FloorClearScreen & GameOverScreen**:
     - FloorClearScreen renders telemetry and Next Floor button invokes `engine.nextFloor()`.
     - GameOverScreen renders defeat telemetry, Retry button invokes `engine.restartRun()`, Sanctuary button opens sanctuary, Menu button opens main menu.
  8. **MultiScreenModal**:
     - Copy URL button copies companion link to clipboard.
     - Popout window button opens companion window.
     - Close button hides modal.
  9. **HudView Interactive & Visual State**:
     - Lab icon button (`.btn-lab`) and Pause icon button (`.btn-pause`) play sound and trigger engine callbacks.
     - Health bar percentage and critical HP warning class updates.
     - XP counter, Dash/Skill cooldown sweep widths, Combo timer, Boss health bar updates.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/HudView.ts`: Direct `Services.Sound.playUi()` invocations and clean sound pipeline.
  - `src/ui/screens/SnakeLabScreen.ts`: `GameState.LevelUp` lifecycle check support.
  - `src/tests/MockDom.ts`: Full headless DOM mock harness with event dispatching, compound selector traversal, style management, and 2D canvas context.
  - `src/tests/UiLayoutAudit.test.ts`: Expanded to 55 tests covering programmatic clicks, state transitions, and audio checks across all screens.
  - `src/tests/MutationLabAndDamageFeedback.test.ts`: Expanded to 20 tests covering socket selector tabs, module install/upgrade, 2-step replace confirmation, module removal, cranial augments, pagination, and deploy button.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/UiLayoutAudit.test.ts
npx vitest run src/tests/MutationLabAndDamageFeedback.test.ts
npm run typecheck
./verify
```
