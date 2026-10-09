# Feature TDD Specification: Mobile 1-Card-Per-Line Responsive Layout CSS

> **Feature Identifier:** `docs/tdd/mobile_one_card_per_line_layout_css.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Update CSS in `index.html` for 1-card-per-line mobile layout across `.lab-card-grid`, `.challenge-tracker-list`, and `.helmet-grid`.
- **Target Systems:** `index.html`, `src/ui/screens/SnakeLabScreen.ts`, `src/ui/screens/ClassSelectScreen.ts`.
- **Key Specifications:**
  1. Desktop / Tablet (> 680px):
     - For `.lab-card-grid`, `.challenge-tracker-list`, `.helmet-grid`:
       `display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; width: 100%;`
  2. Mobile / Narrow Screens:
     - Media query `@media (max-width: 680px)` and `.tier-phone .lab-card-grid`, `.tier-phone .challenge-tracker-list`, `.tier-phone .helmet-grid`:
       `grid-template-columns: 1fr !important; gap: 8px; width: 100%;`
  3. 1-Column Layout Mobile Ergonomics:
     - Card takes 100% width (`width: 100% !important; box-sizing: border-box !important;`).
     - Title, level badge, description, progress bar with target/percentage, and buy buttons fit with generous spacing, high contrast, and zero horizontal overflow (`overflow-x: hidden !important;`).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/MobileOneCardPerLineLayoutCss.test.ts`
- **Assertions:**
  1. Verifies `.lab-card-grid`, `.challenge-tracker-list`, and `.helmet-grid` have 2-column grid definition for desktop (> 680px).
  2. Verifies `@media (max-width: 680px)` overrides `.lab-card-grid`, `.challenge-tracker-list`, and `.helmet-grid` to 1-column `1fr !important; gap: 8px; width: 100%`.
  3. Verifies `.tier-phone` selectors enforce 1-column `1fr !important` on `.lab-card-grid`, `.challenge-tracker-list`, and `.helmet-grid`.
  4. Verifies card styling ensures 100% width, high contrast, no horizontal overflow (`overflow-x: hidden`), and responsive spacing.

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `index.html`: Added desktop 2-column grid rule for `.lab-card-grid, .challenge-tracker-list, .helmet-grid, .lab-docked-card-grid, .run-challenges-section`; added `@media (max-width: 680px)` 1-column layout; added `.tier-phone` 1-column rules; added `.helmet-card` styling.
  - `src/ui/screens/SnakeLabScreen.ts`: Updated grid class names to use `.helmet-grid .lab-card-grid` and `.lab-card-grid .challenge-tracker-list` without hardcoded inline overrides; ensured `box-sizing: border-box` on cards.
  - `src/ui/screens/ClassSelectScreen.ts`: Updated helmet vault container to use `.helmet-grid .lab-card-grid` classes.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/MobileOneCardPerLineLayoutCss.test.ts
./verify
```

**Quality Gate Result:** 100% PASS across all 89 test suites (1105 tests), 0 type errors, and clean production build.
