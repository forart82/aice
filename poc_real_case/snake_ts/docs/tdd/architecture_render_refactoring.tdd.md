# Feature TDD Specification: WebGL 2.0 Renderer & Graphics Architecture Refactoring

> **Feature Identifier:** `docs/tdd/architecture_render_refactoring.tdd.md`  
> **Status:** Green (100% Passing & Refactored)  
> **Target Directory:** `/home/forart/dev/snake_ts/src/render/`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-12`](file:///home/forart/dev/snake_ts/AGENTS.md), & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Architectural Objectives

This refactoring targets the WebGL 2.0 rendering subsystem in `src/render/` to elevate code architecture, maintainability, type safety, and GPU pipeline efficiency without regressing visual parity or performance:

1. **GPU State Encapsulation & VAO Acceleration**:
   - Integrate WebGL 2.0 Vertex Array Object (VAO) support in `WebGLContext` and `GLBatch` to cache interleaved vertex attribute pointers (`a_position`, `a_uv`, `a_color`, `a_params`) and element buffers.
   - Implement static / contextual shader program caching (`WeakMap<object, Map<string, WebGLProgram>>`) to avoid redundant shader compilation and link operations across contexts.
   - Encapsulate WebGL context acquisition and context loss/restoration handling with typed interfaces.

2. **De-duplication of Render Routines**:
   - **Geometric Extrusion**: Extract unified perpendicular normal extrusion (`drawExtrudedSegment`) in `GLBatch` to eliminate duplicated math across lasers, lines, corridors, and beam segments.
   - **Danger Telegraphs**: Refactor `TelegraphRenderer.ts` from empty suppressed stubs into the canonical pure-WebGL danger telegraph renderer, delegating from `WebGLGameRenderer.drawTelegraph` and `WebGLGameRenderer.drawHazard`.
   - **Particle FX Drawing**: Provide unified particle drawing routines (`GLBatch.drawParticle`, `FxManager.render`) connecting `FxParticle` shape rendering cleanly to `GLBatch` without inline duplicate logic.

3. **Type Strengthening & Strict Decoupling**:
   - Replace loose `any` casts with precise interfaces: `WebGLRenderingContext | WebGL2RenderingContext`, `ITelegraphAttack`, `IHazardRenderData`, `IEnemyRenderData`, `IBossRenderData`, `IFoodRenderData`, `IHelmetDropRenderData`, `IProjectileRenderData`.
   - Add strongly-typed function overloads to `GameRenderer.render` and `GameRenderer.draw`.

4. **Rule 12 Absolute Pure WebGL Mandate**:
   - Ensure zero Canvas 2D references or legacy APIs remain across `src/render/` (purging dead Canvas 2D gradient methods in `ArenaBackdrop.ts`).

---

## 2. Test Plan & Assertions (Red Phase)

**Test Suite Location:** `src/tests/RenderArchitectureRefactoring.test.ts`

### Assertions:
1. **WebGLContext Shader Program & VAO Lifecycle**:
   - Context compiles and caches unified SDF shader program without recompilation on repeat requests.
   - If WebGL 2.0 or `OES_vertex_array_object` is available, VAO creation and binding succeeds, caching vertex attributes.
   - Viewport resizing correctly sets resolution uniform `u_resolution`.
2. **GLBatch Extrusion & State Encapsulation**:
   - `drawExtrudedSegment` generates correct quad vertices and miter normals for varying angles and widths.
   - Blend mode switching properly flushes pending quads and synchronizes GPU state.
   - VAO binding occurs during batch flush when supported, avoiding redundant attribute pointer calls.
3. **Unified TelegraphRenderer Pure WebGL Delegation**:
   - `TelegraphRenderer.draw` correctly renders circle, cone, line, and ring telegraphs directly to `GLBatch`.
   - `TelegraphRenderer.drawHazard` correctly renders charging and armed hazard zones.
   - `WebGLGameRenderer.drawTelegraph` and `drawHazard` delegate seamlessly with 100% equivalence.
4. **Unified Particle Drawing via FxManager**:
   - `GLBatch.drawParticle` renders all particle shapes (circle, square, ring, spark, shard, plasma).
   - `FxManager.render(batch, w, h)` renders active particles and electric jitter beams without throwing.
5. **Atlas & Strong Typing Invariants**:
   - `WebGLAssetAtlas` returns valid UVs and regions for all food items.
   - Type definitions accept strongly typed entity interfaces across all draw methods.

---

## 3. Implementation Details (Green Phase)

### Files Created/Modified:
- `src/tests/RenderArchitectureRefactoring.test.ts`: Comprehensive test suite verifying all architectural invariants (19/19 tests passing).
- `src/render/webgl/WebGLContext.ts`: WeakMap-scoped shader program caching, VAO support, typed context management.
- `src/render/webgl/GLBatch.ts`: `drawExtrudedSegment`, `drawParticle`, VAO-aware flushing, strengthened types.
- `src/render/TelegraphRenderer.ts`: Full pure-WebGL implementation for all telegraph varieties and hazards.
- `src/render/FxManager.ts`: `render(batch, w, h)` pure-WebGL implementation, strongly typed interfaces.
- `src/render/GameRenderer.ts`: Strong typing and overloads with zero Canvas 2D fallback.
- `src/render/webgl/WebGLGameRenderer.ts`: Delegation to `TelegraphRenderer` and `FxManager`, strengthened typing.
- `src/render/webgl/WebGLAssetAtlas.ts`: Strong typing on `WebGLRenderingContext | WebGL2RenderingContext`.
- `src/render/ArenaBackdrop.ts`: Complete removal of legacy Canvas2D gradient code.

---

## 4. Verification & Quality Gate Results

```bash
# 1. Target Refactoring and Stress Suites
npx vitest run src/tests/RenderArchitectureRefactoring.test.ts src/tests/WebGLZeroAllocationBenchmark.test.ts src/tests/WebGLRendererStressAndPerformanceOptimization.test.ts
# Result: 3 passed files, 30 passed tests (0 failures)

# 2. Comprehensive WebGL Subsystem Conformance Matrix
npx vitest run src/tests/PureWebGLSerpentineRibbonAndHead.test.ts src/tests/Rule12PureWebGLAudit.test.ts src/tests/WebGLGameRenderer.test.ts src/tests/WebGLRenderer.test.ts src/tests/WebGLRenderingPipelineAndFallback.test.ts src/tests/WebGLTextureCache.test.ts src/tests/WebGLVisualCoherenceAndBorderElimination.test.ts src/tests/WebGLVisualPolishAndRestoration.test.ts src/tests/RenderingPrimitivesAndTelegraphs.test.ts
# Result: 9 passed files, 135 passed tests (0 failures)

# 3. TypeScript Type Safety
npx tsc --noEmit (scoped to src/render/)
# Result: 0 errors across entire src/render/ subsystem
```
