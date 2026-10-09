# Feature TDD Specification: Single-Page Unified Lab, Challenge Cards & Telemetry CSS

> **Feature Identifier:** `docs/tdd/single_page_unified_lab_and_challenge_cards_css.tdd.md`  
> **Status:** Green / Refactored (100% Conformance Gate Pass)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Complete cybernetic CSS styling suite in `index.html` for the Single-Page Unified Lab, Challenge Cards with integrated in-card progress bars, action buttons, card states, and top telemetry with compact vitals and collapsible food/bestiary pills.
- **Target Systems:** `index.html` (Native HTML5 Canvas/CSS UI layer), `src/ui/screens/SnakeLabScreen.ts`, `src/ui/screens/StatsModalScreen.ts`.
- **Mechanics Reference:** [`ORACLE.md#section-4`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md).

### Core Components & Classes:
1. **Lab Docked Card Styling (`.lab-docked-card`)**:
   - Sleek cybernetic container border, status header (`.card-status-header`), and stat summary (`.card-stat-summary`).
   - Integrated In-card `.challenge-progress-bar-wrap`: dual-glowing gradient (`#f59e0b` -> `#ffd166` -> `#00f0b5`), percentage badge (`.challenge-pct-badge`), and target label (`.challenge-target-label`) right inside the upgrade card.
   - Embedded action button `.btn-buy-module` when unlocked.
   - State modifiers:
     - `.card-locked`: amber/obsidian styling with clear challenge text and lock affordances.
     - `.card-unlocked`: cyber-cyan glowing accent with subtle gradient background.
     - `.card-max`: radiant golden accent with level cap badge and golden border.
2. **Top Telemetry Section**:
   - Compact vitals grid (`.stats-vitals-grid`, `.lab-telemetry-vitals`, `.vitals-grid`) with cybernetic stat cards.
   - Collapsible food and bestiary pills (`.food-breakdown-grid`, `.bestiary-grid`, `.food-pill`, `.bestiary-pill`, `.telemetry-collapsible`).
3. **Responsive Layout & Mobile Hardening**:
   - Zero horizontal overflow (`overflow-x: hidden`, `max-width: 100%`, `box-sizing: border-box`).
   - Mobile breakpoint optimizations for portrait/phone viewports (393px, 540px, 768px).

---

## 2. Test Plan & Assertions (Red Phase -> Green Phase)

- **Test Suite Location:** `src/tests/SinglePageUnifiedLabAndChallengeCardsCss.test.ts`
- **Assertions:**
  1. Verifies `.lab-docked-card` container styling with cybernetic borders, status header, and stat summary.
  2. Verifies in-card `.challenge-progress-bar-wrap` with dual-glowing gradient (`#f59e0b` -> `#ffd166` -> `#00f0b5`), percentage badge (`.challenge-pct-badge`), and target label (`.challenge-target-label`).
  3. Verifies `.btn-buy-module` action button embedded styling inside the card.
  4. Verifies state classes `.card-locked` (amber/obsidian), `.card-unlocked` (cyber-cyan glow), and `.card-max` (radiant gold).
  5. Verifies top telemetry compact vitals grid and collapsible food/bestiary pills.
  6. Verifies mobile and desktop responsive layout with zero horizontal overflow constraints.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/tests/SinglePageUnifiedLabAndChallengeCardsCss.test.ts` (New TDD Conformance Suite)
  - `index.html` (Complete cybernetic CSS styles for docked cards, in-card progress bars, telemetry pills, responsive media queries)
  - `src/ui/screens/SnakeLabScreen.ts` (Integrated progress bar markup & badge bindings)

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/SinglePageUnifiedLabAndChallengeCardsCss.test.ts
./verify
```
Result: 100% PASS across 80 test files, 1016 tests, strict TypeScript check, and production bundle build.
