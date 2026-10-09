# 🧪 Feature TDD Specification: Render & Simulation Performance Optimization + Pure-DOM Snake Lab

> **Feature Identifier:** `render_performance_optimization_and_pure_dom_lab`  
> **Rule Reference:** [`AGENTS.md#rule-1`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-2`](file:///home/forart/dev/snake_ts/AGENTS.md), [`AGENTS.md#rule-3`](file:///home/forart/dev/snake_ts/AGENTS.md), [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)  
> **Status:** VERIFIED & COMPLETE (100% QUALITY GATE PASS)  
> **Created:** 2026-08-27  

---

## 1. Architectural Scope & Problem Statement

### 1.1 Canvas2D Glow Leak & Rendering Bottlenecks
- **Pass 2B Glow Leak in `SnakeRenderer.ts`:** `ctx.glow(10, col)` was activated on the flesh ribbon and remained enabled across Pass 2B (vertebrae discs) and Pass 6 (scale ticks), forcing the browser 2D rasterizer to perform 100+ Gaussian blur convolution passes per frame on long snakes.
- **Unbatched State Calls:** Per-socket `ctx.save()`/`restore()` and `shadowBlur` operations in module loops.
- **Runtime Gradient Allocations:** Food and projectile renderers allocating `createRadialGradient` objects on every frame.
- **Font Thrashing in `FxFloatingText`:** Dynamic float scaling continuously recomputed and assigned `raw.font` on every floating text item, flushing glyph layout caches.

### 1.2 Simulation Self-Bite Cascade in `CombatSystem.ts`
- **Double-Spawning Amplification:** `DamageSegment` and `resolveSelfCollision` both emitted particle bursts, floating texts, and audio simultaneously, thrashing the FX pools.
- **Rate-Limiting:** Added `_lastSelfHitFxTime` to throttle self-hit audio, particle, and floating text emissions to a healthy rate.

### 1.3 Pure-DOM Snake Lab Modal (`SnakeLabScreen.ts`)
- **Purge Canvas Animation:** Removed the canvas preview, camera transform state, drag panning listeners, and `requestAnimationFrame` loop.
- **Maximized Upgrade Workspace:** Expanded the scrollable action drawer to full modal height with clean glassmorphism sections for Cranial Bio-Augmentations, Offensive Head Weapons, Defensive Bio-Organs, and the Boss Helmet Vault.

---

## 2. Benchmark Verification Results

```
[1000-Segment 100% Damaged Benchmark Telemetry]
  PC Avg Tick: 0.2927 ms (Budget: 0.8333 ms)
  PC Total Frame: 4.39 ms -> Projected FPS: 228.0 FPS (Budget: 60 FPS)
  Pixel 10 Sim (2 Ticks): 1.29 ms, Total Frame: 7.79 ms -> Projected FPS: 128.4 FPS (Budget: 60 FPS)
  Pixel 6 Sim (2 Ticks): 2.81 ms, Total Frame: 11.31 ms -> Projected FPS: 88.4 FPS (Budget: 60 FPS)
```

---

## 3. Implementation Checklist

- [x] Draft TDD feature specification file.
- [x] Optimize `src/render/Ctx2D.ts` with state dirty-checking.
- [x] Optimize `src/render/SnakeRenderer.ts` (plug glow leak, batch paths, eliminate per-socket state mutations).
- [x] Optimize `src/render/FoodRenderer.ts` and `src/render/ProjectileRenderer.ts` (remove runtime `createRadialGradient` allocations).
- [x] Optimize `src/render/FxManager.ts` (cache font assignments, eliminate font string invalidation).
- [x] Optimize `src/sim/CombatSystem.ts` (rate-limit self-hit FX, silent damage mode to prevent double emission).
- [x] Refactor `src/ui/screens/SnakeLabScreen.ts` into a pure-DOM modal without canvas animation.
- [x] Update `src/tests/MutationLabAndDamageFeedback.test.ts` and verify all test suites.
- [x] Run full `./verify` quality gate (21 test suites, 241 tests passing, production build passing).
