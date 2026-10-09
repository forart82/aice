# Feature TDD Specification: Application-Wide Mobile UI Overlap & Responsive Conformance Audit

> **Feature Identifier:** `docs/tdd/application_wide_mobile_overlap_audit.tdd.md`  
> **Status:** Green / Refactored (100% Conformance Verified)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Complete, application-wide audit of all UI screens, HUD elements, touch gamepads, responsive layout formulas, and DOM modal containers across compact Android (360×780), standard iPhone (393×852), large Android (412×915), foldable outer screen (540×960), compact legacy (320×480), and mobile landscape (844×390).
- **Target Systems:** `src/ui/`, `src/ui/screens/`, `src/input/`, `index.html`, `src/tests/`
- **Core Requirements:**
  1. Strict 0-collision between left vitals and right action/combo indicators on narrow portrait screens (360px).
  2. Strict single-column card stacking (`grid-template-columns: 1fr !important; gap: 8px !important;`) on mobile phones.
  3. Single-scroll container architecture: fixed headers (`flex-shrink: 0;`), internal scrollable body (`flex: 1 1 auto; min-height: 0; overflow-y: auto;`), and pinned action footers (`flex-shrink: 0; margin-top: auto;`).
  4. Safe-area compensation for top dynamic islands/notches, bottom home indicator gestures, and landscape side cutouts.
  5. MultiScreen companion modal responsive text scaling (`clamp(14px, 4.5vw, 24px)`).
  6. BaseModalScreen `.modal-content-area` and Widget classes (`.cyber-badge`, `.meter-container`, `.meter-fill`) registered in global CSS.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/MobileScreensOverlapAudit.test.ts`
- **Assertions:**
  1. `ClassSelectScreen`: Archetype cards, locked price badges, helmet vault loadout, and Start/Back buttons render without collision across all mobile viewports.
  2. `DraftScreen`: 3-4 mutation cards stack vertically with 1-column layout, non-overlapping rarity tags/stats, and pinned Reroll/Skip buttons.
  3. `SanctuaryScreen`: Shard banner pinned at top, upgrade nodes in 1-column scroll, pinned Erase/Return buttons.
  4. `SettingsScreen`: Sliders, toggles, dropdowns render cleanly with 45%/55% flex budget.
  5. `StatsModalScreen`: Mode `'run'` 2-column vitals and mode `'global'` career records render with pinned action bar.
  6. `MenuScreen`: Title banner, mode buttons, sub-row utility buttons render cleanly and scroll on short landscape.
  7. `CodexModalScreen` / `HelpScreen`: Level 1-3 navigation, exclusive accordion, and touch table wrappers render cleanly.
  8. `SnakeLabScreen`: 6 quick stat chips wrap cleanly, mutation cards stack in 1 column, helmet cards render cleanly.
  9. `DevChecklistScreen`: Category tabs scroll horizontally (`overflow-x: auto`), item cards and diagnostic grid collapse to 1 column.
  10. `GameOverScreen` / `FloorClearScreen` / `RunSummaryScreen`: Polymorphic modes (`defeat`, `floor_clear`, `victory`) stack stat cards in 1 column with pinned action buttons.
  11. `PauseSettingsScreen`: Settings controls body scrolls with pinned Resume / Abandon buttons.
  12. `MultiScreenModal`: QR code box, companion URL input, and copy button render with responsive typography.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/MobileScreensOverlapAudit.test.ts`
  - `src/ui/screens/MultiScreenModal.ts`
  - `index.html`

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/MobileScreensOverlapAudit.test.ts
./verify
```
