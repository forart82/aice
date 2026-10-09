# Feature TDD Specification: Unified Cranial Mutation Lab & Expedition Hub CSS Styling

> **Feature Identifier:** `docs/tdd/unified_cranial_lab_and_expedition_hub_css.tdd.md`  
> **Status:** Green & Refactored (100% PASS)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Sleek cybernetic CSS styling in `index.html` for the unified Cranial Mutation Lab (`SnakeLabScreen.ts`) and Expedition Hub / Telemetry (`StatsModalScreen.ts`, `RunSummaryScreen.ts`).
- **Target Systems:** `index.html` (`<style>`), `src/ui/screens/SnakeLabScreen.ts`, `src/ui/screens/StatsModalScreen.ts`, `src/ui/screens/RunSummaryScreen.ts`.
- **Key Deliverables:**
  1. **Tab Group with Glowing Active State:**
     - Sleek cybernetic segmented tab container (`.lab-tab-group`, `.stats-tab-bar`, `.stats-tab-group`) with dark obsidian backdrop (`rgba(10, 18, 34, 0.9)`), inset shadow, and subtle neon border.
     - Active tab state (`.btn-primary`): glowing cyan-emerald gradient `linear-gradient(135deg, rgba(0, 240, 181, 0.28), rgba(0, 240, 181, 0.12))`, neon cyan border `1.5px solid var(--cyan)`, intense outer and inner glow (`box-shadow: 0 0 16px rgba(0, 240, 181, 0.45), inset 0 0 8px rgba(0, 240, 181, 0.25)`), and text glow `text-shadow: 0 0 8px rgba(0, 240, 181, 0.8)`.
     - Inactive tab state (`.btn-secondary`): translucent slate glass with smooth hover highlight transitions.
  2. **Challenge Cards Grid:**
     - 2-column grid on desktop and tablet viewports (`repeat(2, minmax(0, 1fr))`).
     - Responsive 1-column layout on mobile viewports (`@media (max-width: 768px)`).
     - Cybernetic card containers (`.challenge-row-card`) with hover elevation and glowing borders, with distinct styling for `.unlocked` (cyan theme) and `.locked` (amber/dark theme).
  3. **Challenge Progress Bars & Percentage Chips:**
     - Dual glowing gradient: cyber-amber-to-cyan `linear-gradient(90deg, #f59e0b, #ffd166, #00f0b5)` for in-progress challenges with amber glow `box-shadow: 0 0 10px rgba(255, 209, 102, 0.6)`, and cyan `linear-gradient(90deg, #00a880, #00f0b5)` for completed challenges.
     - Percentage chips (`.challenge-status.in-progress` and `.challenge-status.completed`) with glowing neon borders and text shadows.
     - Clear category tags and descriptors (Length, Foods, Kills, Bosses, Combo).
  4. **Telemetry Breakdown Cards:**
     - Compact bestiary tiles (`.bestiary-grid`, `.bestiary-pill`) with hover elevations.
     - Food item pill badges (`.food-breakdown-grid`, `.food-pill`) with neon borders.
     - Apex Guardian defeats list (`.boss-defeats-list`) and installed cranial module chips (`.installed-modules-list`, `.module-chip`).
  5. **Responsive Scrolling & Zero Horizontal Overflow on Mobile (393px, 540px):**
     - Full-width constraints (`box-sizing: border-box`, `max-width: 100%`, `overflow-x: hidden`).
     - Responsive grid columns (2 columns for bestiary/foods/vitals on <= 768px and <= 420px) preventing horizontal overflow.
     - Smooth touch scrolling with customized cybernetic scrollbars.

---

## 2. Test Plan & Assertions (Red-Green-Refactor)

- **Test Suite Location:** `src/tests/UnifiedCranialLabAndExpeditionHubCss.test.ts`
- **Assertions:**
  1. Verifies tab group styling with glowing active state for `.lab-tab-group`, `.stats-tab-bar`, `.stats-tab-group` in `index.html`.
  2. Verifies challenge grid 2-column default and 1-column mobile breakpoint in `index.html`.
  3. Verifies challenge progress bars with glowing gradients and percentage status chips in `index.html`.
  4. Verifies telemetry breakdown cards (bestiary tiles, food item pills, module chips) in `index.html`.
  5. Verifies responsive scrolling rules and zero horizontal overflow constraints for 393px and 540px mobile viewports.

---

## 3. Implementation Details

- **Files Modified:**
  - `index.html`: Added comprehensive CSS styling for the unified Cranial Mutation Lab & Expedition Hub and responsive media queries.

---

## 4. Verification & Quality Check Results

- `npx vitest run src/tests/UnifiedCranialLabAndExpeditionHubCss.test.ts`: **5/5 PASS**
- `./verify` Quality Gate: **100% PASS** (76 test files, 979 tests, TypeScript typecheck, Production Vite build).
