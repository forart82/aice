# Feature TDD Specification: WebGL Texture Cache & Offscreen Stamp Uploader

> **Feature Identifier:** `docs/tdd/webgl_texture_cache_and_stamp_uploader.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Dynamic WebGL texture creation, caching, and offscreen canvas blitting pipeline in `WebGLContext` and `GLBatch`, enabling 100% pixel-perfect Canvas2D stamp blitting for food items and backdrop surfaces.
- **Target Systems:** `src/render/webgl/WebGLContext.ts`, `src/render/webgl/GLBatch.ts`, `src/render/FoodRenderer.ts`, `src/render/ArenaBackdrop.ts`, `src/render/webgl/WebGLGameRenderer.ts`
- **Key Requirements:**
  1. **Dynamic Texture Creation & Upload in `WebGLContext`:**
     - `createTextureFromCanvas(canvas: HTMLCanvasElement | OffscreenCanvas | any): WebGLTexture | null` creates and configures WebGL textures with `CLAMP_TO_EDGE` wrap and `LINEAR` filtering.
     - `updateTextureFromCanvas(texture: WebGLTexture, canvas: HTMLCanvasElement | OffscreenCanvas | any): void` dynamically re-uploads canvas contents.
     - Texture caching with `getOrCreateTexture(key: string, canvas: any)` and `clearTextureCache()`.
     - Creation of 1x1 default white texture during `init()` to ensure texture unit 0 safety.
  2. **Textured Quad Batching in `GLBatch`:**
     - `drawTexture(texture: WebGLTexture, x: number, y: number, w: number, h: number, alpha?: number, blendMode?: GLBlendMode, uvMin?: [number, number], uvMax?: [number, number], glow?: number): void`
     - `drawRotatedTexture(texture: WebGLTexture, cx: number, cy: number, w: number, h: number, angle: number, alpha?: number, blendMode?: GLBlendMode, glow?: number): void`
     - Automatic batch flushing when switching bound textures or changing blend modes.
  3. **GPU Fragment Shader Texture Sampling in `WebGLContext`:**
     - `uniform sampler2D u_texture;` in fragment shader.
     - Primitive branch for `GLPrimitive.Texture` (Type 5) sampling `u_texture` using standard `v_uv` in $[0, 1]$ coordinates with vertex color/alpha modulation.
  4. **Integration with `FoodRenderer` & `ArenaBackdrop`:**
     - `FoodRenderer.getStamp(type, color, glow)` made public and connected to WebGL texture uploads.
     - `ArenaBackdrop.getCanvas(w, h, floor)` returns the pre-baked canvas and can be uploaded to WebGL textures for backdrop rendering.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLRenderer.test.ts` & `src/tests/WebGLTextureCache.test.ts`
- **Assertions:**
  1. `WebGLContext.createTextureFromCanvas` creates a valid `WebGLTexture` with appropriate texture parameters (`CLAMP_TO_EDGE`, `LINEAR`).
  2. `WebGLContext` manages cached textures by key and disposes them cleanly on `dispose()`.
  3. `GLBatch.drawTexture` encodes quad vertices with `GLPrimitive.Texture` (Type 5), $[0, 1]$ UVs, and 24 float32 words.
  4. `GLBatch.drawTexture` automatically flushes prior geometry when the bound texture changes.
  5. `GLBatch.drawRotatedTexture` applies angular rotation to corners while maintaining proper texture mapping.
  6. Fragment shader compiles with `sampler2D u_texture` and handles Type 5 sampling correctly.
  7. `FoodRenderer.getStamp` returns a valid offscreen canvas that can be uploaded to a WebGL texture.
  8. `ArenaBackdrop.getCanvas` returns a backdrop canvas that can be uploaded and rendered via `drawTexture`.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLContext.ts`: Added `GLPrimitive.Texture = 5`, `u_texture` uniform, texture creation/binding/caching methods, and fragment shader branch.
  - `src/render/webgl/GLBatch.ts`: Added `drawTexture`, `drawRotatedTexture`, `setTexture`, and texture-switch auto-flush.
  - `src/render/FoodRenderer.ts`: Made `getStamp` public and added optional texture caching helper.
  - `src/render/ArenaBackdrop.ts`: Added `getCanvas(w, h, floor)` alias/helper and `getTexture` integration.
  - `src/render/webgl/WebGLGameRenderer.ts`: Integrated textured stamp fast-paths for foods and backdrop blitting.
  - `src/tests/WebGLRenderer.test.ts`: Added unit tests for texture creation, caching, and batch rendering.
  - `src/tests/WebGLTextureCache.test.ts`: Dedicated test suite for texture stamp uploads and Canvas2D parity.

---

## 4. Verification & Quality Check

```bash
npx vitest run src/tests/WebGLRenderer.test.ts
npx vitest run src/tests/WebGLTextureCache.test.ts
npm run typecheck
./verify
```
