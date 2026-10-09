# Feature TDD Specification: Food Pickups Visual Parity & Atlas Bleed Prevention

> **Feature Identifier:** `docs/tdd/food_pickups_visual_parity_and_atlas_bleed.tdd.md`  
> **Status:** Green  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Achieve 100% visual parity between Canvas2D (`FoodRenderer.ts`) and WebGL (`WebGLAssetAtlas.ts`, `WebGLGameRenderer.ts`) for all 8 food pickups and nutrient shards, while eliminating all quad edge clipping and texture atlas bleed artifacts.
- **Target Systems:**
  - `src/render/webgl/WebGLAssetAtlas.ts`: Procedural rasterization of food atlas stamps (`renderFoodStamp`) for all 8 pickup varieties + bonus items, matching `FoodRenderer.ts` lines 40-110:
    - Normal Apple: Base core + inner bioluminescent core + specular highlight (`rgba(255, 255, 255, 0.72)`) + outer halo (`2.0 * baseR`).
    - Golden Apple: Solar corona ring (`rgba(255, 255, 255, 0.65)`).
    - Shard: Diamond crystal geometry (`#fff3c4`).
    - Potion: Medical cross (`#ffffff`).
    - Bomb: Dark void core (`#111827`, radius `0.4 * baseR`) + fuse line (`#ffb703`).
    - Shield: Concentric capsule ring (`#ffffff`, radius `0.55 * baseR`).
    - Chrono: Clock hands (`#ffffff`).
    - Magnet / Dipole: Canvas2D parity (no opposing red/blue arcs; clean bioluminescent orb).
    - Cell bounds: Ensure all halos and decorations stay strictly within `cellSize * 0.46` (58.88px in 128x128 cell) with 2px UV safety gutter so zero quad edge artifacts or bilinear filter bleed occur.
  - `src/render/webgl/WebGLGameRenderer.ts` (`drawFood`):
    - Food quad drawing with exact radius scaling matching Canvas2D (`dim = r * 4.5`, centered at `x - dim * 0.5, y - dim * 0.5`).
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/FoodPickupsVisualParityAndAtlasBleed.test.ts`
- **Assertions:**
  1. `WebGLAssetAtlas.renderFoodStamp` removes custom red/blue arcs for magnet/dipole, rendering as a clean orb matching `FoodRenderer.ts`.
  2. `WebGLAssetAtlas.renderFoodStamp` matches the exact morphological decorations, radii, and color styles of `FoodRenderer.ts` lines 40-110 for normal, golden, shard, potion, bomb, shield, chrono.
  3. Strict bounding check: In a 128x128 cell, all drawn elements across all food varieties (including halos, rings, diamonds, crossarms, fuse lines) stay strictly within `cellSize * 0.46` (<= 58.88px radius from center), leaving >= 3.12px transparent buffer to the 2px UV safety gutter and >= 5.12px margin to cell border.
  4. Exact radius scaling in `WebGLGameRenderer.drawFood`: Quad is rendered with `dim = r * 4.5` centered at `(x - dim * 0.5, y - dim * 0.5)`, rendering core at world radius `r` and halo at world radius `2.0 * r`, matching Canvas2D `FoodRenderer.draw`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLAssetAtlas.ts`: Aligned `renderFoodStamp` with `FoodRenderer.ts`, removed red/blue magnet arcs, ensured `haloR = baseR * 2.0 <= cellSize * 0.46`, and updated base radius.
  - `src/render/webgl/WebGLGameRenderer.ts`: Updated `drawFood` atlas quad blitting to `dim = r * 4.5`.
  - `src/tests/FoodPickupsVisualParityAndAtlasBleed.test.ts`: Added unit tests verifying visual parity, strict bounding margins, and quad scaling.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/FoodPickupsVisualParityAndAtlasBleed.test.ts # PASS (8/8 tests)
npx vitest run src/tests/WebGL* src/tests/GPUTextureAtlasAndZeroUpload.test.ts # PASS (74/74 tests)
npm run typecheck # PASS (0 errors)
```

