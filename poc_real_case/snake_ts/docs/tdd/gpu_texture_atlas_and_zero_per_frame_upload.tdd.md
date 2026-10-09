# Feature TDD Specification: GPU Texture Atlas & Zero-Per-Frame-Upload Engine for Pure WebGL

> **Feature Identifier:** `docs/tdd/gpu_texture_atlas_and_zero_per_frame_upload.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Eliminate 100% of per-frame Canvas2D rasterization and per-frame `texImage2D` uploads across the WebGL rendering pipeline, while preserving exact pixel-level visual identity for food pickups and cosmic backdrops.
- **Target Systems:**
  - `src/render/webgl/WebGLAssetAtlas.ts`: Unified GPU Texture Atlas (512x512) for all 8 Food varieties (Normal Apple, Golden Apple, Essence Shard, Healing Potion, Shield Capsule, Cosmic Bomb, Chrono Hourglass, Magnetic Dipole) with UV bounding rectangles `[u0, v0, u1, v1]`, plus static pre-baked floor nebula backdrop textures for floors 1..5.
  - `src/render/webgl/WebGLGameRenderer.ts`: Full integration of `WebGLAssetAtlas` with zero per-frame canvas allocation (`document.createElement`), zero `texImage2D` during frame rendering (0 MB/s bus bandwidth), `drawFood` batch texture quad drawing using atlas UVs, and `drawBackdrop` using static floor nebula textures.
- **Mechanics Reference:** [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) & [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md)

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/GPUTextureAtlasAndZeroUpload.test.ts`
- **Assertions:**
  1. `WebGLAssetAtlas.initFoodAtlas` builds a 512x512 atlas containing all 8 Food varieties (Normal Apple, Golden Apple, Essence Shard, Healing Potion, Shield Capsule, Cosmic Bomb, Chrono Hourglass, Magnetic Dipole) and uploads to GPU once.
  2. `WebGLAssetAtlas.getFoodUV` returns accurate `[u0, v0, u1, v1]` coordinates for all 8 varieties with non-overlapping sub-rectangles inside `[0, 1]` UV space.
  3. `WebGLAssetAtlas.prebakeBackdrops` bakes floor 1..5 nebula textures once and caches them.
  4. `WebGLGameRenderer.draw` and `WebGLGameRenderer.render` render scene directly via pure WebGL batches without invoking `document.createElement('canvas')` or `GameRenderer.drawCanvas2D`.
  5. `drawFood` renders using `batch.drawTexture(atlasTexture, x - r, y - r, r * 2, r * 2, alpha, undefined, [u0, v0], [u1, v1])`.
  6. `drawBackdrop` renders using `batch.drawTexture(backdropTexture, 0, 0, w, h, 1.0)`.
  7. Verification that zero texture uploads (`texImage2D`) happen during the render loop (0 MB/s bus bandwidth).

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLAssetAtlas.ts`: Created the GPU Texture Atlas engine managing 512x512 food atlas, UV coordinate registration, and static floor nebula backdrop pre-baking.
  - `src/render/webgl/WebGLGameRenderer.ts`: Eliminated per-frame `document.createElement('canvas')` and `texImage2D` in `draw()`; updated `drawFood()` to draw with `batch.drawTexture(atlasTexture, x - r, y - r, r * 2, r * 2, alpha, undefined, [u0, v0], [u1, v1])`; updated `drawBackdrop()` to draw with `batch.drawTexture(backdropTexture, 0, 0, w, h, 1.0)`.
  - `src/render/WebGLGameRenderer.ts`: Re-exported `WebGLAssetAtlas`.
  - `src/tests/GPUTextureAtlasAndZeroUpload.test.ts`: Authored comprehensive conformance suite verifying atlas baking, UV ranges, static backdrop textures, and 0 uploads / 0 canvas allocations per frame.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/GPUTextureAtlasAndZeroUpload.test.ts # PASS (8/8 tests)
npx vitest run src/tests/WebGL*                             # PASS (60/60 tests)
npm run typecheck                                            # PASS (0 errors)
./verify                                                     # PASS (123/123 test files, 1570 tests, production build PASS)
```
