# Feature TDD Specification: Visual Parity Test Harness & Pixel Diff Engine

> **Feature Identifier:** `docs/tdd/visual_parity_diff_engine.tdd.md`  
> **Status:** Draft / Red Phase  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Automated, deterministic visual regression and pixel-diff testing engine comparing Native Canvas2D (`?canvas2d=true`) against WebGL (`?gl=true`) across the entire application.
- **Target Systems:**
  - `scratch/visual_parity_diff.js`: Standalone CLI execution script.
  - `src/tests/VisualParityPixelDiff.test.ts`: Vitest automated test suite.
  - `src/render/VisualParityHarness.ts`: Deterministic scene setup engine.
  - `docs/tdd/visual_parity_pixel_diff_report.md`: Summary report of diff percentages.
- **14 Deterministic Scenes:**
  1. `01_title` (Title screen)
  2. `02_class` (Class select screen)
  3. `03_emerald_healthy` (Emerald snake with 12 segments moving right)
  4. `04_emerald_damaged` (Emerald snake with headHp 30/50 and bodyHp 12/25 to verify damage rings and cranial arc)
  5. `05_stalker` (Stalker phantom serpent)
  6. `06_hydra` (Hydra tri-skull serpent)
  7. `07_storm` (Storm serpent)
  8. `08_solar` (Solar serpent)
  9. `09_food_grid` (All 8 food pickups in an isolated plate: apple, golden, shard, potion, shield, bomb, chrono, magnet)
  10. `10_enemy_grid` (All 6 enemies: spitter, drone, phantom, bruiser, swarmling, scarab)
  11. `11_boss_centipede` (Centipede Behemoth with danger telegraph)
  12. `12_backdrop_floor1` (Nebula, grid, stars for Floor 1)
  13. `13_sanctuary` (Sanctuary screen)
  14. `14_lab` (Cranial Mutation Lab)
- **Artifacts:**
  - Capture `canvas2d.png` and `webgl.png`.
  - Compute exact pixel diff (count and percentage).
  - Generate high-contrast `diff_<scene>.png` highlighting mismatched pixels in bright magenta (`#ff00ff`).
  - Generate markdown summary report.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/VisualParityPixelDiff.test.ts`
- **Assertions:**
  1. `VisualParityHarness` registers all 14 scenes with valid names and setup functions.
  2. Pure pixel diff utility correctly detects color differences and marks mismatched pixels with magenta `#ff00ff`.
  3. Pixel diff engine outputs deterministic statistics (total pixels, diff count, diff percentage).
  4. Playwright visual comparison successfully executes across all 14 scenes against Vite server `http://localhost:3001`.
  5. Summary markdown report is generated at `docs/tdd/visual_parity_pixel_diff_report.md`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/VisualParityHarness.ts`: Authoritative 14-scene generator and state isolator.
  - `scratch/visual_parity_diff.js`: Standalone Node/Playwright runner.
  - `src/tests/VisualParityPixelDiff.test.ts`: Vitest test suite.
  - `src/main.ts`: Expose `renderFrame()`, `VisualParityHarness`, and URL query parameter `?scene=<name>`.
  - `docs/tdd/visual_parity_pixel_diff_report.md`: Markdown summary report.

---

## 4. Verification & Quality Check

```bash
node scratch/visual_parity_diff.js
npx vitest run src/tests/VisualParityPixelDiff.test.ts
npm run typecheck
```
