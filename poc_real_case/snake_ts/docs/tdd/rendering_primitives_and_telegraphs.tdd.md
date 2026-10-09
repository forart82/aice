# Feature TDD Specification: Rendering Primitives, Sphere Gradients, Unified Telegraphs & FX Optimization

> **Feature Identifier:** `docs/tdd/rendering_primitives_and_telegraphs.tdd.md`  
> **Status:** Green / Refactored  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Unify 2D Canvas rendering primitives, pseudo-3D spherical specular gradients, attack telegraph visualizers (boss attacks, hazard zones, mob charge and warp rings), and optimize the particle FX rendering pipeline via shape-bucketed single-pass iteration.
- **Target Systems:**
  - `src/render/Ctx2D.ts`: Standardized `createSphereGradient(x, y, r, color, outerRadiusMul)` radial gradient generator with specular highlights.
  - `src/render/TelegraphRenderer.ts`: Unified modular telegraph renderer for circle, cone, line telegraphs, arena hazards, warp rings, and mob charge rings.
  - `src/render/SnakeRenderer.ts`, `src/render/BossRenderer.ts`, `src/render/EnemyRenderer.ts`: Unified 3D sphere gradient calculations.
  - `src/render/GameRenderer.ts`: Integrated unified hazard and telegraph rendering.
  - `src/render/FxManager.ts`: Shape-bucketed particle iteration (`circle`, `square`, `ring`, `spark`) eliminating redundant 4-pass traversals.
- **Mechanics Reference:** [`ORACLE.md#section-rendering-and-visual-effects`](file:///home/forart/dev/snake_ts/ORACLE.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/RenderingPrimitivesAndTelegraphs.test.ts`
- **Assertions:**
  1. `Ctx2D.createSphereGradient`:
     - Creates radial gradient with specular highlight origin `(x - 0.34*r, y - 0.38*r)`, highlight radius `0.08*r`, outer center `(x, y)`, and outer radius `r * outerRadiusMul`.
     - Applies three standard color stops: 0.0 (+0.55 shade highlight), 0.42 (base color), 1.0 (-0.62 shade shadow rim).
     - Clamps non-positive radii safely without NaN.
  2. `TelegraphRenderer`:
     - Circle telegraph: renders warning perimeter ring and progressive inner blast fill.
     - Cone telegraph: renders angular sector warning perimeter and progressive inner sector fill.
     - Line telegraph: renders directional beam warning vector with progress-scaled alpha.
     - Hazard rendering: handles charging state (`telegraph > 0`) and active state (`telegraph <= 0`) with proper palette mapping.
     - Warp ring rendering: renders expanding/contracting warp rings with alpha interpolation.
     - Charge ring rendering: renders oscillating charge indicator.
     - `BossRenderer.drawTelegraph`: retains full backward-compatibility bridging to `TelegraphRenderer`.
  3. `FxManager` Shape Bucketing:
     - Correctly buckets particles into `circle`, `square`, `ring`, and `spark` index buffers in a single pass.
     - Ignores inactive or zero-alpha particles during bucketing.
     - Sets line width and render state efficiently per bucket.
     - Handles 700 mixed particles under high load without frame drops or GC allocations.
  4. Non-Regression & Integration:
     - `SnakeRenderer.draw`, `BossRenderer.draw`, `EnemyRenderer.draw`, and `GameRenderer.draw` execute cleanly with unified sphere gradients and telegraph renderers.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/Ctx2D.ts`: Added `createSphereGradient` with standard specular offset math and ColorX shading.
  - `src/render/TelegraphRenderer.ts`: Created new unified static renderer with `draw`, `drawTelegraph`, `drawHazard`, `drawWarpRing`, `drawChargeRing`, `drawCircleTelegraph`, `drawConeTelegraph`, and `drawLineTelegraph`.
  - `src/render/SnakeRenderer.ts`: Replaced duplicated radial gradient with `ctx.createSphereGradient(0, 0, headR, col, 1.2)`.
  - `src/render/BossRenderer.ts`: Replaced segment and head gradients with `ctx.createSphereGradient`, delegated `drawTelegraph` to `TelegraphRenderer.drawTelegraph`, and re-exported `ITelegraphAttack`.
  - `src/render/EnemyRenderer.ts`: Replaced body gradient with `ctx.createSphereGradient(0, 0, r, col, 1.05)`, and used `TelegraphRenderer.drawWarpRing` and `TelegraphRenderer.drawChargeRing`.
  - `src/render/GameRenderer.ts`: Swapped manual hazard rendering loop for `TelegraphRenderer.drawHazard(ctx, hz)`.
  - `src/render/FxManager.ts`: Added pre-allocated `Int32Array` index buffers (`_circleIndices`, `_squareIndices`, `_ringIndices`, `_sparkIndices`) and single-pass particle classification loop.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/RenderingPrimitivesAndTelegraphs.test.ts
```

### Test Results
- `src/tests/RenderingPrimitivesAndTelegraphs.test.ts`: 15/15 tests passing (100%).
- Full rendering suite parity (`AllSerpentineBossesIntegrity.test.ts`, `MenuOuroborosBackdropAnimation.test.ts`, `IntricateOuroborosKnotAndBackdrop.test.ts`, `GalacticStarfieldPerformance.test.ts`, `ParityTest.test.ts`): 89/89 tests passing (100%).
