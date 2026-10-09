# Feature TDD Specification: Mobile Overlap E2E Playwright Test Suite

> **Feature Identifier:** `docs/tdd/mobile_overlap_e2e_playwright_suite.tdd.md`  
> **Status:** Red Phase (Spec & Test Authoring)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Comprehensive Playwright E2E Mobile Overlap Test Suite verifying zero element bounding box collisions, text truncation, or UI element overlap across 4 standard mobile viewports:
  - `360 x 640` (Compact Android 16:9 / 9:16)
  - `393 x 852` (Standard Modern Smartphone / iPhone 14)
  - `412 x 915` (Modern Large Android / Google Pixel & Samsung Galaxy)
  - `540 x 960` (qHD Mobile Display)
- **Target Systems:** `e2e/`, `src/ui/`, `src/ui/screens/`, `src/ui/HudView.ts`, `src/ui/ResponsiveLayout.ts`.
- **Target Screens Audited:**
  1. **Test 1: Main Menu & Sub-Row Navigation:** Title banner, best score chips, game mode selector column, and sub-row buttons (Sanctuary, Stats, Codex, Settings) with 0 bounding box intersections.
  2. **Test 2: Class Selection & Serpent Archetypes:** Modal headers, 5 serpent archetype cards (header, passive, skill, stats preview), helmet vault, and Start/Back action buttons.
  3. **Test 3: Cranial Mutation Lab Across All 3 Tabs:** Mutations (`lab`), Helmets (`helmets`), and Statistics (`telemetry`/`stats`). Explicitly asserting that card title, status badge, description, progress bar, and buy button have strictly non-overlapping bounding boxes (`rectA.bottom <= rectB.top || rectA.right <= rectB.left`).
  4. **Test 4: Sanctuary Screen & Meta Upgrades:** Shards currency counter, meta upgrade cards (icon, name, level, bonus, pips row, buy button), and bottom actions.
  5. **Test 5: Settings & Codex / Help Screen:** Audio/Graphics/Controls setting rows and Codex accordion guides.
  6. **Test 6: In-Game HUD & Touch Controls:** Touch joystick pad, Dash button, Skill button, Player Vitals, and Mission Header ensuring zero touch obstruction or vitals overlap.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `e2e/mobile-overlap-audit.spec.ts`
- **Assertions:**
  1. Multi-viewport matrix tests all 4 mobile viewports: `360 x 640`, `393 x 852`, `412 x 915`, `540 x 960`.
  2. 2D Axis-Aligned Bounding Box (AABB) intersection formula:
     $$\text{Overlap} \iff \max(0, \min(A.r, B.r) - \max(A.l, B.l)) > \epsilon \land \max(0, \min(A.b, B.b) - \max(A.t, B.t)) > \epsilon$$
  3. Every screen element must have non-zero dimensions and be fully contained within viewport bounds with 0 collisions against adjacent siblings.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `e2e/mobile-overlap-audit.spec.ts`
  - `docs/tdd/mobile_overlap_e2e_playwright_suite.tdd.md`

---

## 4. Verification & Quality Check

```bash
# 1. Run Complete Playwright E2E Suites
npx playwright test

# 2. Run Strict Verification Script (Typecheck + 116 Vitest Conformance Tests)
./verify
```
