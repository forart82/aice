# 🤖 GEMINI CODE & AGENT QUICK REFERENCE: Ouroboros Ascension (TypeScript Edition)

> **Workspace:** `/home/forart/dev/snake_ts`  
> **Stack:** Modern TypeScript 5.8+, Vite 6, Vitest 3, Pure WebGL 2.0 (`WebGL2RenderingContext`), Web Audio API  
> **Status:** 100% TDD Verified & Zero-Error Compilation  

---

## ⚡ Essential Commands

```bash
# 1. Run Complete Quality Gate (Strict Typecheck + 116 Conformance Tests)
./verify

# 2. Start Live Development Server with Hot Module Replacement (HMR)
npm run dev

# 3. Execute Vitest Test Suites Headlessly
npm test
npm run test:selftest    # Conformance matrix (81 tests)
npm run test:parity      # 15 Golden replay traces
npm run test:playtest    # 20-seed balance probe sweeps

# 4. Strict TypeScript Typecheck
npm run typecheck

# 5. Production Web Build
npm run build

# 6. Build Android APK Package (4.4 MB)
npm run build:apk
```

---

## 🏛️ Repository Architecture

- `ORACLE.md`: Absolute Single Source of Truth (SSOT) for mechanics, math, and balance.
- `AGENTS.md`: Mandatory TDD Protocol 3.0 (Red-Green-Refactor, zero-code-without-tests, Rule 10 In-Code Commenting, Rule 12 Pure WebGL Mandate).
- `verify`: Executable verification script enforcing 100% Quality Gate PASS.
- `docs/`: Architecture guides, device specifications, multi-screen contracts, publishing blueprints, and TDD feature specs.
- `src/core/`: Decoupled math, PRNG, and dependency-injected service contracts (`ISound`, `IFx`, `ISaveIO`, `IInput`).
- `src/data/`: Game data definitions, all 36 cards, 26 relics, 5 serpent classes, 6 enemy types, 3 bosses, and sanctuary upgrades.
- `src/sim/`: Headless, deterministic 120 Hz game simulation engine.
- `src/render/`: Pure WebGL 2.0 renderer (`WebGLGameRenderer`, `GLBatch`) with custom GLSL shaders, batched draw calls, and zero-allocation pipelines.
- `src/ui/`: ResponsiveLayout engine adapting to all aspect ratios (16:9, 21:9 ultrawide, 4:3, 9:16 mobile portrait, multi-window).
- `src/audio/`: 100% procedural Web Audio synthesizer and dynamic music sequencer.
- `src/input/`: Unified input manager supporting Keyboard, Gamepad API, and Virtual Touch Joystick.
- `src/platform/`: LocalStorage/IndexedDB persistence, BroadcastChannel multi-screen, and WebRTC companion pairing.
- `src/tests/`: Vitest test suites.

---

## 🚫 Rule 12: Absolute Pure WebGL Mandate & Permanent Canvas2D Prohibition

- **HTML5 Canvas 2D Banished**: `CanvasRenderingContext2D`, `Ctx2D`, `getContext('2d')`, and `OffscreenCanvas.getContext('2d')` are permanently banished from the entire project.
- **Immediate Treatment on Sight**: Any AI agent or developer encountering Canvas 2D code must immediately treat it (rewrite it into pure WebGL 2.0 shaders/batches or suppress/delete it) with zero tolerance.
- **Exclusive WebGL 2.0 Pipeline**: All graphics, HUD, and effects must flow exclusively through `WebGLGameRenderer.ts` and `GLBatch.ts`.

