# Feature TDD Specification: WebGL Zero-Allocation Performance Prober & Mobile Budget Quality Gate

> **Feature Identifier:** `docs/tdd/webgl_zero_allocation_performance_prober.tdd.md`  
> **Status:** Green / Verified  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Rule Reference:** [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-6`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-10`](file:///home/forart/dev/snake_ts/AGENTS.md) & [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  

---

## 1. Feature Overview & Requirements

- **High Concept:** Strict quality gate verification and performance probing for the pure WebGL 2D rendering pipeline (`WebGLGameRenderer`), asserting Google Pixel 6 mobile performance budget (<16.66ms frame time, zero per-frame canvas allocation, zero GC churn) under extreme combat load (200 segments, 50 enemies, 50 foods, 100 particles).
- **Target Systems:** `src/render/webgl/WebGLGameRenderer.ts`, `src/render/webgl/GLBatch.ts`, `src/render/webgl/WebGLContext.ts`, `src/tests/WebGLZeroAllocationBenchmark.test.ts`
- **Performance Invariants:**
  1. CPU frame execution time on host PC: $\le 1.50\text{ ms}$ under peak combat stress.
  2. Projected frame execution time on Google Pixel 6 (Mali-G78 MP20): $\le 3.90\text{ ms}$ ($\le 16.66\text{ ms}$ budget for 60 FPS).
  3. Zero calls to `document.createElement('canvas')` in the hot rendering loop.
  4. Zero per-frame `texImage2D` full-canvas texture uploads.
  5. 100% Quality Gate pass (`./verify`: 0 type errors, 120+ test suites, 1,550+ tests, clean production build).

---

## 2. Test Plan & Assertions (Red Phase)

- **Test Suite Location:** `src/tests/WebGLZeroAllocationBenchmark.test.ts`
- **Assertions:**
  1. High-load combat scenario setup (200 snake segments, 50 enemies, 50 foods, 100 particles, hazards, projectiles).
  2. Performance probe executes $\ge 50$ consecutive `WebGLGameRenderer.draw()` frames measuring nanosecond CPU execution times.
  3. Average CPU frame time on host is $\le 1.50\text{ ms}$.
  4. Projected Pixel 6 CPU frame time is $\le 3.90\text{ ms}$.
  5. Spying on `document.createElement` verifies 0 canvas element creations during active rendering.
  6. Spying on `gl.texImage2D` verifies 0 full-canvas uploads during steady-state frame rendering.
  7. Heap memory allocation differential across 100 frames confirms zero steady-state GC churn.

---

## 3. Implementation Details (Green Phase)

- **Files Created/Modified:**
  - `src/render/webgl/WebGLGameRenderer.ts` (Removed legacy offscreen canvas and per-frame `texImage2D` upload; dispatch directly to pure `renderWithBatch`)
  - `src/tests/WebGLZeroAllocationBenchmark.test.ts` (Performance probe & zero-allocation assertion test suite)
  - `docs/tdd/webgl_zero_allocation_performance_prober.tdd.md` (TDD Specification)

---

## 4. Verification & Quality Check

```bash
# 1. Zero-Allocation Performance Benchmark Suite
npx vitest run src/tests/WebGLZeroAllocationBenchmark.test.ts

# 2. Strict Typecheck
npm run typecheck

# 3. Full Quality Gate Verification
./verify
```
