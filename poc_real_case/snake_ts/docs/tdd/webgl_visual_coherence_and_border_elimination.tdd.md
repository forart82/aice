# Feature TDD Specification: WebGL Visual Incoherence & White Border/Rectangle Elimination

> **Feature Identifier:** `docs/tdd/webgl_visual_coherence_and_border_elimination.tdd.md`  
> **Status:** Refactored (100% Verified & Passing)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Correct WebGL visual incoherences and eliminate white borders, rectangular bounding artifacts, and atlas bleed in WebGL mode compared to Native Canvas 2D:
  1. **Food Texture Atlas Bleed & Square Edges (`WebGLAssetAtlas.ts`)**:
     - Previously in `renderFoodStamp()`, the outer spore-light halo radius was `r * 1.85 = 99.45px` in a 128x128 cell (center 64), which exceeded the 64px half-width and bled 35px into neighboring cells, creating harsh square clipped boundaries.
     - Clamped the outer halo and all elements to stay strictly within `cellSize * 0.46` (with at least 5-6px padding from cell edge).
     - Added a 2-pixel safety gutter clamping UVs to `[px + 2, py + 2, px + cellSize - 2, py + cellSize - 2] / atlasSize` so bilinear texture filtering never samples outside the cell.
     - In `WebGLContext.ts` fragment shader for `primType == 5` (Textured Quad), added:
       `if (texCol.a <= 0.002) discard;` to eliminate any faint square bounding boxes.
  2. **Hard White/Cyan Border Ring Around Snake Head & Spheres (`WebGLContext.ts`)**:
     - In `primType == 3` (Sphere), `if (v_glow > 0.0)` was adding glow with alpha 0.88-1.0 right up to `radialDist = 1.05` where it abruptly discarded, creating a razor-sharp high-contrast ring outline around the head.
     - Smoothly anti-aliased sphere edge to alpha 0 at `radialDist = 1.0` (`smoothstep(0.96, 1.0, radialDist)`), and discarded strictly when `radialDist > 1.0` so no hard outer border ever forms.
     - Modulated glow with `edgeAlpha` so that both color and alpha gracefully fade to zero at `radialDist = 1.0`.
  3. **Ingame Entity Geometries & Primitives (`WebGLGameRenderer.ts`)**:
     - Replaced rectangular quad orbital markers with triangular fangs using `batch.drawTriangle` matching Canvas 2D.
     - Replaced flat rectangular quad helmet base shells with smooth 3D spheres (`GLPrimitive.Sphere`) matching head geometry.
- **Target Systems:** `src/render/webgl/WebGLAssetAtlas.ts`, `src/render/webgl/WebGLContext.ts`, `src/render/webgl/WebGLGameRenderer.ts`, `src/render/webgl/GLBatch.ts`.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) (Zero Visual Regression & Rendering Engine Parity).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLVisualCoherenceAndBorderElimination.test.ts`
- **Assertions:**
  1. Food atlas UV coordinates must include safety gutters `[px + 2, py + 2, px + cellSize - 2, py + cellSize - 2] / atlasSize`. (PASS)
  2. Default UV coordinates and regions must also reflect safety gutter offsets. (PASS)
  3. Food atlas cell canvas rasterization must never write non-zero alpha into cell border margins (all elements <= `cellSize * 0.46`). (PASS)
  4. WebGL fragment shader source must discard fragments where `texCol.a <= 0.002` in textured quads (`primType == 5`). (PASS)
  5. WebGL fragment shader source must discard spheres at `radialDist > 1.0` and anti-alias smoothly with `smoothstep(0.96, 1.0, radialDist)`. (PASS)
  6. Spheres with `glow > 0` must have zero alpha at `radialDist = 1.0` with no cliff or sharp edge at 1.05. (PASS)
  7. Orbital markers are rendered using triangular geometry rather than rectangular quads. (PASS)

---

## 3. Implementation Details (Green Phase)

- **Files Modified:**
  - `src/render/webgl/WebGLAssetAtlas.ts`:
    - Updated `initFoodAtlas()` to compute UVs with a 2-pixel safety gutter `[px + 2, py + 2, px + cellSize - 2, py + cellSize - 2] / atlasSize`.
    - Updated `_defaultUV` and `_defaultRegion` to respect 2-pixel gutter.
    - Updated `renderFoodStamp()` to clamp `maxR = cellSize * 0.46`, `baseR = Math.min(r, maxR * 0.65)`, `haloR = Math.min(baseR * 1.5, maxR)`.
    - Clamped all type-specific morphological ornaments (diamond, corona ring, cross, clock hands, flux arcs) within `maxR`.
  - `src/render/webgl/WebGLContext.ts`:
    - In `primType == 5` (Textured Quad): added `if (texCol.a <= 0.002) discard;`.
    - In `primType == 3` (Sphere): changed discard condition to `if (radialDist > 1.0) discard;` and anti-aliasing to `1.0 - smoothstep(0.96, 1.0, radialDist)`.
    - Modulated sphere glow by `edgeAlpha` and added low-alpha discard check `if (col.a <= 0.002) discard;`.
    - Modulated circle and ring glow by `alpha` with low-alpha discard checks.
  - `src/render/webgl/WebGLGameRenderer.ts`:
    - Rendered orbitals with `batch.drawTriangle(...)` matching Canvas2D triangular fangs.
    - Replaced `GLPrimitive.Quad` base shells with `GLPrimitive.Sphere` for Colossus and Void helmets.
- **Files Created:**
  - `src/tests/WebGLVisualCoherenceAndBorderElimination.test.ts` (6 comprehensive unit tests).

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/WebGLVisualCoherenceAndBorderElimination.test.ts
npm run typecheck
./verify
```

**Quality Gate Results:**
- Strict TypeScript Typecheck (`tsc --noEmit`): 100% PASS (Zero Errors).
- Vitest Conformance Suite: 126 test files, 1,592 tests: 100% PASS.
- Production Vite Build: 100% PASS.
