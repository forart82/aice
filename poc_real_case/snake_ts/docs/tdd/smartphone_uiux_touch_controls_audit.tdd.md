# Feature TDD Specification: Smartphone UI/UX & Touch Controls Audit (11 Views)

> **Feature Identifier:** `docs/tdd/smartphone_uiux_touch_controls_audit.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

Comprehensive smartphone UI/UX, touch controls, and accessibility audit across all 11 views in Ouroboros Ascension:
1. **Menu View (`MenuScreen.ts`)**: Title layout, mode selectors, sub-row buttons, telemetry pills, and touch accessibility.
2. **Combat View (`HudView.ts`, `TouchControls.ts`, `VirtualStick.ts`)**: Layered vitals, top actions ([L] Lab, [P] Pause), dynamic mission reflow, combo meter, virtual joystick radial drag steering, dual action buttons (Dash, Skill), safe area notch/home bar insets.
3. **Class Select View (`ClassSelectScreen.ts`)**: 5 Archetype cards, locked shard affordance, responsive 1-column mobile grid, helmet loadout vault, back and start action buttons.
4. **Sanctuary View (`SanctuaryScreen.ts`)**: Permanent shard upgrades, progressive level pips, armed two-step progress reset button, return navigation.
5. **Lab View (`SnakeLabScreen.ts`)**: 3 segregated tab views (Mutations, Helmets, Statistics), 6 quick stat chips, in-lab toast alert banners, deploy serpent action button, accessible close button.
6. **Codex View (`HelpScreen.ts` / `CodexModalScreen.ts`)**: Exclusive single-accordion hierarchy, uniform card lines, search filtering, category tabs, and accessible close/back buttons.
7. **Stats View (`StatsModalScreen.ts` / `StatsScreen.ts`)**: Dual-mode in-run live telemetry and global career statistics, bestiary grid, food pill breakdown, accessible close buttons.
8. **Checklist View (`DevChecklistScreen.ts`)**: Subsystem verification checklist, search filtering, status toggles, accessible search clear button, category tabs, return to game action.
9. **Settings View (`SettingsScreen.ts`)**: Audio sliders, screen shake, visual quality dropdown, CRT toggle, FPS counter, touch control scheme, lefty mode inversion, Save & Close.
10. **Pause View (`PauseSettingsScreen.ts`)**: Quick audio & shake sliders, deep link to Codex/Settings, Abandon run trigger, prominent Resume Run button.
11. **Draft View (`DraftScreen.ts`)**: 3-card mutation draft layout, vertical stacking on mobile portrait, re-roll counter, skip upgrade reward.

### Core Audit Points & Targets:
- **Mobile Touch Target Accessibility (WCAG 2.5.5 / Apple HIG / Material Guidelines)**: All touch targets, buttons, tabs, toggles, and close targets must measure at least 44x44 px (or min-height 44px for full-width row buttons).
- **Safe Area Insets**: Full coverage of `env(safe-area-inset-top)`, `env(safe-area-inset-bottom)`, `env(safe-area-inset-left)`, `env(safe-area-inset-right)` across overlays and HUD.
- **Virtual Stick & Touch Zones**: Responsive positioning, non-intersecting bounds, ambidextrous/lefty mode support, and elevated bottom row on touch mode so perks never collide with on-screen touch pads.
- **Rule 12 Pure WebGL Compliance**: Total elimination of all banished HTML5 Canvas 2D methods (`CanvasRenderingContext2D`) in `TouchControls.ts` and `VirtualStick.ts`.
- **Modal Stacking & z-index Order**: Consistent base `z-index: 50` across all modal overlays with zero stacking inversion.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/UiLayoutAudit.test.ts`
- **Assertions:**
  1. Accessibility touch target sizing: Verify `.cyber-btn`, `.hud-icon-btn`, close buttons (`.btn-close-lab`, `.btn-close-stats`, `.btn-close-top`), and tabs meet minimum 44px touch targets on mobile/phone tier.
  2. Safe area insets: Verify touch controls, bottom HUD elevation, and modal paddings incorporate top and bottom safe area insets.
  3. Virtual stick and touch zones: Verify stick bounds, action bounds, and lefty inversion calculations.
  4. Viewport non-overlap and horizontal scroll clipping: Verify all 11 views enforce `overflow-x: hidden`, `overflow-y: auto`, and `word-break: break-word`.
  5. Modal z-index consistency: Verify all modal overlays share unified base z-index.
  6. Rule 12 Pure WebGL compliance: Verify zero occurrences of `CanvasRenderingContext2D` in `src/input/TouchControls.ts` and `src/input/VirtualStick.ts`.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `index.html`: Update `.tier-phone .cyber-btn`, `.cyber-btn` media queries, `.btn-codex-back`, `.btn-close-top`, `.codex-search-clear`, `.btn-expand-all`, `.btn-codex-tab`, `.btn-accordion-toggle`, `.btn-jumper-*`, `.btn-scroll-top`, `.btn-tab-*`, `.btn-close-main`, `.dev-search-clear`, `.btn-dev-tab` to enforce `>= 44px` touch targets. Fix `.hud-layer.tier-phone.touch-active .hud-bottom-row` to preserve safe bottom lift. Standardize modal overlay `z-index: 50`.
  - `src/input/TouchControls.ts`: Remove banished Canvas2D methods (`render`, `drawButton`, etc.) under Rule 12.
  - `src/input/VirtualStick.ts`: Remove banished Canvas2D method (`render`) under Rule 12.
  - `src/ui/screens/SnakeLabScreen.ts`: Update `.btn-close-lab` inline touch target to `min-width: 44px; min-height: 44px;`.
  - `src/ui/screens/StatsModalScreen.ts`: Update `.btn-close-stats` inline touch target to `min-width: 44px; min-height: 44px;`.
  - `src/ui/screens/ClassSelectScreen.ts`: Nest `.class-lock-badge` cleanly inside the flex header without fragile `padding-right: 68px`.
  - `src/tests/UiLayoutAudit.test.ts`: Expand suite to audit all 11 views, touch targets, and Rule 12 compliance.

---

## 4. Verification & Quality Check

```bash
npm run typecheck
npx vitest run src/tests/UiLayoutAudit.test.ts
./verify
```

---

## 5. Actual Results & Record

- **TypeScript Compilation:** 100% PASS (`tsc --noEmit` clean with 0 errors).
- **UiLayoutAudit Test Suite:** 100% PASS (72/72 tests passed).
- **Master Conformance Gate (`./verify`):** 100% PASS across all 137 test suites (1726 tests passed) + Production Bundle Build passed.
- **Rule 10 In-Code Documentation:** Architectural comments added documenting touch target sizes and safe area calculations.
- **Rule 12 Pure WebGL Compliance:** 100% PASS; zero occurrences of `CanvasRenderingContext2D` across `TouchControls.ts` and `VirtualStick.ts`.

