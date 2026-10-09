# Feature TDD Specification: Mobile Zero Overlap CSS Audit and Styling Enhancements

> **Feature Identifier:** `docs/tdd/mobile_css_zero_overlap_audit.tdd.md`  
> **Status:** Refactored / Complete  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive audit and enhancement of CSS styling in `index.html` to guarantee zero overlapping elements across the entire game on mobile devices (`@media (max-width: 680px)` and `.tier-phone`).
- **Target Systems:** `index.html`, `src/ui/` presentation styles.
- **Key Requirements:**
  1. Card Blocks cleanup (`.lab-docked-card`, `.card-status-header`, `.card-stat-summary`, `.card-challenge-wrap`, `.card-buy-row`):
     - Eliminate absolute positioning or cramped flex containers that permit text collision.
     - Enforce `flex-direction: column; width: 100%; box-sizing: border-box; overflow: hidden;` on card blocks.
  2. Global mobile rules (`@media (max-width: 680px)` and `.tier-phone`):
     - Modal panels (`.modal-panel`, `.lab-panel`, `.stats-panel`, `.sanctuary-panel`, `.settings-panel`, `.codex-panel`): `width: 95vw; max-width: 95vw; box-sizing: border-box; padding: 10px; overflow-x: hidden;`.
     - All grid containers: `grid-template-columns: 1fr !important; width: 100%;`.
     - Text elements: `word-break: break-word; overflow-wrap: break-word;`.
     - Buttons: `min-height: 40px; touch-action: manipulation; box-sizing: border-box;`.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/MobileZeroOverlapCssAudit.test.ts`
- **Assertions:**
  1. Card blocks enforce `flex-direction: column`, `width: 100%`, `box-sizing: border-box`, and `overflow: hidden`.
  2. Card headers, stat summaries, challenge wraps, and buy rows prevent overlapping and text collision.
  3. Modal panels on mobile (`@media (max-width: 680px)` and `.tier-phone`) enforce `width: 95vw`, `max-width: 95vw`, `padding: 10px`, `overflow-x: hidden`, and `box-sizing: border-box`.
  4. Grid containers on mobile enforce `grid-template-columns: 1fr !important` and `width: 100%`.
  5. Text elements on mobile have `word-break: break-word` and `overflow-wrap: break-word`.
  6. Buttons on mobile enforce `min-height: 40px`, `touch-action: manipulation`, and `box-sizing: border-box`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `index.html`:
    - Updated `.class-card-header` and `.class-lock-badge` to remove absolute positioning overlap and guarantee flexible responsiveness.
    - Updated `.lab-docked-card`, `.card-status-header`, `.card-stat-summary`, `.card-challenge-wrap`, and `.card-buy-row` with `flex-direction: column; width: 100%; box-sizing: border-box; overflow: hidden;` and text wrapping.
    - Enhanced global `.tier-phone` rules to enforce modal sizing (`width: 95vw; max-width: 95vw; box-sizing: border-box; padding: 10px; overflow-x: hidden;`), 1-column grid layout, text wrapping, and button sizing.
    - Enhanced global `@media (max-width: 680px)` media query to enforce modal sizing, 1-column grid layout, text wrapping (`word-break: break-word; overflow-wrap: break-word;`), and button sizing (`min-height: 40px; touch-action: manipulation; box-sizing: border-box;`).
  - `src/tests/MobileZeroOverlapCssAudit.test.ts`:
    - Conformance test suite verifying all mobile layout rules.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/MobileZeroOverlapCssAudit.test.ts
./verify
```

**Quality Gate Results:**
- TypeScript Strict Typecheck: 100% PASS
- Vitest Conformance Matrix: 93/93 test suites passed (1,161/1,161 tests passed)
- Production Web Bundle: 100% PASS
