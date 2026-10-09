# Feature TDD Specification: HUD & In-Game Touch Controls Audit

> **Feature Identifier:** `docs/tdd/hud_and_touch_controls_audit.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive audit and structural refinement of the in-game HUD (`HudView.ts`) and Root Layout (`RootLayout.ts`) to ensure 100% responsive safety across all mobile portrait viewports (393x852, 360x640) and touch screen devices.
- **Target Systems:** `src/ui/HudView.ts`, `src/ui/RootLayout.ts`, `src/tests/HudAndTouchControlsAudit.test.ts`
- **Key Requirements:**
  1. **Top Header Row Architecture:**
     - Left vitals panel: HP bar (`.hp-bar-wrap`), Shield bar (`.shield-bar-wrap`), Ouro currency counter (`.hud-ouro-badge` / `.hud-xp-badge`), Cooldown chips (`.hud-cooldowns-grid`, `.cooldown-chip.dash-chip`, `.cooldown-chip.skill-chip`).
     - Center mission banner: Floor title (`.floor-title`), Subtitle (`.floor-subtitle`), Progress bar (`.floor-bar-wrap`).
     - Right action buttons: 🧬 Mutation Lab (`.btn-lab` `[L]`) and ⏸️ Pause (`.btn-pause` `[P]`) in `.hud-top-actions` alongside combo badge and score tracker.
  2. **Mobile Portrait Separation & Anti-Collision:**
     - In mobile portrait mode (`isPortraitHud = true`, 393x852, 360x640), `.hud-top-row` does NOT collide with the mission banner. The mission banner reflows into `.hud-mission-portrait-row` within `.hud-header-group`.
     - `.hud-vitals` (left) and `.hud-top-actions` (right) maintain horizontal clearance without colliding on ultra-narrow 360px mobile viewports.
  3. **Dedicated Non-Overlapping Touch Zones:**
     - Virtual joystick pad (`.stick-pad` / `.touch-stick-pad`), Dash button (`.touch-btn.btn-dash` / `.touch-btn-dash`), and Skill button (`.touch-btn.btn-skill` / `.touch-btn-skill`) have dedicated bounding zones.
     - Joystick touch dragging ignores action button touches and HUD header panels.
     - Touch actions handle pointercancel / touchcancel cleanly.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/HudAndTouchControlsAudit.test.ts`
- **Assertions:**
  1. Top header row contains all vitals, mission, and top action buttons with standard and aliased CSS class selectors (`.stick-pad`, `.touch-btn.btn-dash`, `.touch-btn.btn-skill`).
  2. Mobile portrait mode reflows mission progress banner to `.hud-mission-portrait-row` without top-row overlap.
  3. Left vitals and right action buttons maintain separated zones on mobile portrait (393x852 and 360x640).
  4. Virtual joystick and touch action buttons have distinct touch hit zones and don't overlap bottom HUD hints.
  5. Touch action buttons handle pointer/touch press, release, and cancellation events.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/ui/HudView.ts`: Added standard and aliased class names (`.stick-pad`, `.touch-btn.btn-dash`, `.touch-btn.btn-skill`), added `pointercancel` and `touchcancel` handlers, enhanced JSDocs.
  - `src/ui/RootLayout.ts`: Audited container instantiation and StatsModalScreen registration.
  - `src/tests/MockDom.ts`: Added standard DOM `contains` method to `MockElement`.
  - `src/tests/HudAndTouchControlsAudit.test.ts`: 10 comprehensive tests covering all requirements.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/HudAndTouchControlsAudit.test.ts
./verify
```

- **Actual Results:** 10/10 tests PASS in `HudAndTouchControlsAudit.test.ts`, 100% PASS on `./verify` (Strict Typecheck + Vitest Conformance Suite + Production Build).

