# Feature TDD Specification: WebGL 2D Rendering Pipeline & Automatic Headless Fallback

> **Feature Identifier:** `docs/tdd/webgl_rendering_pipeline_and_fallback.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** High-performance hardware-accelerated WebGL 2D rendering pipeline (`WebGLGameRenderer`, `GLBatch`, `WebGLContext`) with zero-allocation batch vertex buffers, cybernetic neon shaders, and seamless automatic fallback to `Ctx2D` when WebGL is unavailable (headless Node.js, Vitest test runs, or browsers lacking WebGL2/WebGL1).
- **Target Systems:** `src/render/WebGLGameRenderer.ts`, `src/render/webgl/`, `src/render/GameRenderer.ts`, `src/main.ts`
- **Key Requirements:**
  1. `WebGLGameRenderer.isSupported(canvas)` detects genuine WebGL context availability safely in all runtime environments.
  2. Complete WebGL render pipeline rendering Backdrop, Hazards, Foods, Helmet Drops, Projectiles, Enemies, Bosses, Player Snake, Particle FX, and Screen Overlays with high-performance batching.
  3. `GameRenderer.draw(target, engine, fx)` and `GameRenderer.render(target, engine, fx)` seamlessly support both `Ctx2D` and `WebGLGameRenderer`.
  4. `App` in `src/main.ts` automatically attempts WebGL initialization and safely falls back to `Ctx2D` when running headlessly or if WebGL context creation fails.
  5. Responsive resizing updates both projection matrices and viewport dimensions accurately.
  6. 100% test pass rate across all Vitest suites and zero-error TypeScript compilation.

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLRenderingPipelineAndFallback.test.ts`
- **Assertions:**
  1. `WebGLGameRenderer.isSupported` returns `false` when context cannot be created or WebGL methods are absent.
  2. `WebGLGameRenderer` initializes shaders, program, vertex buffer, and handles viewport resizing when given a WebGL context mock/implementation.
  3. `WebGLGameRenderer.render(engine, fx)` executes all render passes (backdrop, hazards, foods, projectiles, enemies, boss, player, particles, overlay) without throwing or allocating new objects.
  4. `GameRenderer.draw` routes seamlessly to `WebGLGameRenderer` when passed a WebGL renderer instance, and to `Ctx2D` when passed a 2D context.
  5. `App` initializes with automatic fallback: in headless/Vitest test environment, it initializes `ctx: Ctx2D` while `webglRenderer` is null or safely bypassed.
  6. WebGL shader compilation and uniform matrix updates map world coordinates to clip space correctly ($[-1, 1]$).
  7. Batch buffer dynamically flushes or manages capacity safely without memory leaks.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `docs/tdd/webgl_rendering_pipeline_and_fallback.tdd.md` (Specification)
  - `src/tests/WebGLRenderingPipelineAndFallback.test.ts` (Integration test suite)
  - `src/render/webgl/WebGLContext.ts` (WebGL Context & unified shader matrix pipeline)
  - `src/render/webgl/GLBatch.ts` (Dynamic interleaved vertex buffer batcher)
  - `src/render/webgl/WebGLGameRenderer.ts` (Full WebGL game render pass pipeline)
  - `src/render/WebGLGameRenderer.ts` (Top-level re-export facade)
  - `src/render/GameRenderer.ts` (Unified routing supporting both 2D and WebGL)
  - `src/main.ts` (App bootstrap WebGL auto-detection & Ctx2D fallback loop)

---

## 4. Verification & Quality Check

```bash
# 1. Individual WebGL test suites (38/38 PASS)
npx vitest run src/tests/WebGLRenderer.test.ts
npx vitest run src/tests/WebGLGameRenderer.test.ts
npx vitest run src/tests/WebGLRenderingPipelineAndFallback.test.ts

# 2. Strict Typecheck (Zero Errors)
npm run typecheck

# 3. Full Quality Gate (118/118 suites PASS, 1523/1523 tests PASS, Production Bundle Built)
./verify
```
