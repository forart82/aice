# Agent TDD Protocol & Development Guidelines: Ouroboros Ascension (TypeScript Edition)

> **Protocol Version:** 3.0 — TypeScript & Multi-Screen Edition  
> **Target:** AI Autonomous Agents & Assistant Workflows (Gemini Code / CLI / IDE Agent)  
> **Target Directory:** `/home/forart/dev/snake_ts`  
> **Technology Stack:** Modern TypeScript 5.8+, Vite 6, Vitest 3, Pure WebGL 2.0 (`WebGL2RenderingContext`), Web Audio API, Responsive Layout Engine  
> **Standard:** Strict Test-Driven Development (TDD), The Oracle SSOT, Commercial Viability & Multi-Platform Publishing Readiness  
> **Rule Level:** Mandatory & Non-Negotiable  

---

## 1. Executive Summary & Core Directive

This document defines the strict, non-negotiable development protocol for autonomous AI agents working on **Ouroboros Ascension** in `/home/forart/dev/snake_ts`.

The project rests upon two immutable pillars:
1. **The TDD Protocol (`AGENTS.md` / `GEMINI.md`):** Every single task, bug fix, refactor, and feature implementation **must follow Test-Driven Development (TDD)** without exception, guided by dedicated Feature TDD Files ([`docs/tdd/<feature-name>.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/TEMPLATE.tdd.md)).
2. **The Oracle ([`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md)):** The absolute **Single Source of Truth (SSOT)** containing the entire mechanical specification, game formulas, balance tables, and historical design chronology.

**Production code must never be written before the corresponding test is written, executed, and confirmed to fail.**

---

## 2. Fundamental Rules for Agents

### Rule 1: The Zero-Code Without Test Policy
- **Never write, modify, or refactor production logic without a failing test in place.**
- If a bug is reported, first write a reproduction test case in the test harness ([`src/tests/SelfTest.test.ts`](file:///home/forart/dev/snake_ts/src/tests/SelfTest.test.ts) or dedicated test suite) that fails before touching any application logic.
- If a feature is requested, complete the Feature TDD Specification file ([`docs/tdd/<feature>.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/TEMPLATE.tdd.md)), author the failing test assertions, observe them fail, and only then write production TypeScript code.

### Rule 2: Dedicated Feature TDD Document Mandate
- Every feature must have an associated TDD specification file stored in [`docs/tdd/<feature_identifier>.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/TEMPLATE.tdd.md).
- Created from the standardized [`docs/tdd/TEMPLATE.tdd.md`](file:///home/forart/dev/snake_ts/docs/tdd/TEMPLATE.tdd.md).
- The TDD file is a living document updated across all phases (Red, Green, Refactor).

### Rule 3: The Red-Green-Refactor State Machine
```
┌─────────────────────────────────────────────────────────────┐
│ 1. SPECIFY: Draft / Update the docs/tdd/<feature>.tdd.md    │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 2. RED: Write unit/integration test; Run & confirm FAILURE   │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 3. GREEN: Implement minimal code; Run & confirm PASS        │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 4. REFACTOR: Clean code, optimize, keep all tests GREEN     │
└──────────────────────────────┬──────────────────────────────┘
                               │
                               ▼
┌─────────────────────────────────────────────────────────────┐
│ 5. RECORD: Document actual results in <feature>.tdd.md      │
└──────────────────────────────┘
```

### Rule 4: No Test Tampering
- Tests must accurately represent game requirements and specifications.
- Never weaken assertions, remove checks, or mock away critical simulation logic simply to make tests pass.
- If a test fails unexpectedly during implementation, debug the production code, not the test.

### Rule 5: Deterministic & Isolated Tests
- Tests must be idempotent, deterministic, and isolated.
- Mock or stub external systems (file I/O, platform clocks, audio output) using standard decoupling patterns (`SaveIO`, `Services.Fx`, `Services.Sound`, `ScriptedInput`).
- Tests must produce identical results regardless of execution order and leave zero side effects.

### Rule 6: Architectural Separation for Web / TypeScript Game Development
- **Strictly Decoupled Core Simulation**:
  - `src/core/`: Vector math (`Vec2`), utilities (`MathX`, `ColorX`), PRNG (`Rng`), service contracts.
  - `src/data/`: Generated game data tables, meta-progression state models.
  - `src/sim/`: Snake player logic, combat system, enemies, bosses, hazards, floor progression, game engine accumulator.
  - ⛔ **ABSOLUTE HEADLESS INDEPENDENCE**: **NO DOM/browser types** (`window`, `document`, `HTMLCanvasElement`) are permitted in `src/core`, `src/data`, or `src/sim`. All pure simulation runs in `number` (float64) precision headlessly in Vitest and Node.js.
- **Presentation & Platform Shell Layer**:
  - `src/render/`: Pure WebGL 2.0 renderer (`WebGLGameRenderer`, `GLBatch`), shader pipelines, `FxManager`, and GPU entity renderers.
  - `src/ui/`: `ResponsiveLayout` engine, `HudView`, interactive modal screens (`MenuScreen`, `ClassSelectScreen`, `DraftScreen`, `SanctuaryScreen`, `SettingsScreen`, `SnakeLabScreen`).
  - `src/input/`: `InputManager`, `VirtualStick`, `TouchControls`.
  - `src/audio/`: `Synth` procedural Web Audio synthesizer, `SoundEngine`, `MusicPlayer`.
  - `src/platform/`: `SaveIO` (LocalStorage/IndexedDB with v1->v2 migrations), `MultiScreen` (`BroadcastChannel` & `WindowManagement`), `CompanionSync`.

### Rule 7: Commercial Viability, Zero Copyright Infringement & Legal Safety
- **100% Commercial Usability**: The entire codebase, procedural synth audio, vector graphics, fonts, third-party npm packages, and tools must be legally safe for commercial distribution, monetization, and publication across PC (Steam, Itch.io), Mobile (Google Play, Apple App Store), and Web.
- **Permissive Open-Source Licenses Only**: Only dependencies with commercial-friendly permissive licenses are allowed (MIT, Apache-2.0, BSD-2/3-Clause, ISC, CC0, SIL OFL).
  - ⛔ **STRICTLY FORBIDDEN**: Copyleft or viral licenses (GPL, AGPL, LGPL with static linking restrictions, CC-BY-NC, CC-BY-ND) or unauthorized proprietary assets.
- **Zero Copyright Infringement**: No ripped, stolen, or unauthorized binary assets. 100% procedural vector rendering and Web Audio synthesis.
- **Privacy & Regulatory Compliance**: Zero unauthorized telemetry or non-compliant tracking.

### Rule 8: The Oracle Mandate (Single Source of Truth - SSOT)
- [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) is the absolute Single Source of Truth for game design, mechanics, mathematical formulas, entity stats, and balance curves.
- Whenever [`ORACLE.md`](file:///home/forart/dev/snake_ts/ORACLE.md) is updated, ensure corresponding TDD feature specs and automated tests are updated and passing.

### Rule 9: Quality Verification Quality Gate
- 100% clean check on [`./verify`](file:///home/forart/dev/snake_ts/verify) (Typecheck + Vitest suites).

### Rule 10: Strict In-Code Commenting & Architectural Documentation Standard
- **Mandatory In-Code Explanations**: All complex simulation logic, kinematic inverse kinematics (IK), broadphase spatial grids, rendering passes, Canvas 2D matrix transformations, Web Audio DSP pipelines, responsive UI formulas, and platform storage migrations must feature comprehensive, crystal-clear docstrings and in-line explanatory comments.
- **Simulation & Math**: Every vector transform, distance constraint, angular interpolation, drag decay factor, collision query, and damage pipeline stage must document its physical and mathematical formula.
- **Rendering & Transforms**: Every matrix push/pop (`save()`, `restore()`, `translate()`, `rotate()`, `scale()`), DPR compensation factor, camera coordinate conversion, and composite blend mode must document *why* the transform is applied and its coordinate space (world vs. screen vs. viewport).
- **Procedural Audio & DSP**: Every Web Audio node connection, ADSR curve timing parameter, PolyBLEP bandlimiting algorithm, filter cutoff calculation, and lookahead audio scheduler step must explicitly document its acoustic rationale and mathematical formula.
- **Responsive Layout & Touch Math**: Touch bounding box derivations, safe-area inset compensations, ambidextrous layouts, dynamic scale curves, and pointer tracking must contain clear geometric explanations.
- **Persistence & Migrations**: Every save migration step (e.g. schema v1 -> v2), CRC32 checksum computation, fallback deserialization path, and companion WebRTC/BroadcastChannel packet serialization must describe its backward-compatibility strategy and failure guarantees.

### Rule 11: Strict Human-Equivalent Bot Action Standard (No Cheating Rule)
- **Zero Cheating & Zero Direct State Mutation**: Autonomous bots, spectator AI, and automated test runners cannot mutate player or game state fields directly (no out-of-band stat modifications, free gold injections, unearned cards, or socket hacks).
- **Physical Input Compliance**: All bot movement, steering, dashing, and active skills must flow strictly through standard controller interfaces (`IInput` / `ScriptedInput` / `InputManager`) obeying kinematic turn rate limits ($\omega_{\text{turn}}$) and real action cooldowns.
- **UI & Modal Interaction Parity**: Card drafting on floor progression must pick strictly from the active PRNG-offered cards in `CurrentDraftCards`. Cranial Mutation Lab purchases must validate challenge unlock requirements and execute atomic wallet deductions via `SpendOuro(cost)`. Boss helmets may only be equipped if legitimately unlocked in the `MetaProgression` vault.
- **Strict Head-Centric Serpentine Architecture**: Body segment sockets/wagon pod upgrades are permanently eliminated from the entire game engine. All weapons, defensive bio-organs, and cranial augments reside strictly on the Serpent Head.

### Rule 12: Absolute Pure WebGL Mandate & Permanent Canvas2D Prohibition
- **HTML5 Canvas 2D Banished**: The HTML5 Canvas 2D API (`CanvasRenderingContext2D`, `Ctx2D`, `canvas.getContext('2d')`, `OffscreenCanvas.getContext('2d')`) is permanently, totally, and unconditionally banished from the entire project.
- **Immediate Treatment on Sight**: Any AI agent or human developer encountering Canvas 2D code, fallbacks, shims, or imports MUST immediately treat it with zero tolerance: rewrite it into pure WebGL 2.0 shaders/batches or suppress/delete it on the spot. Under no circumstances may Canvas 2D code be introduced, preserved, or tolerated.
- **Exclusive WebGL 2.0 Pipeline**: All graphics, arena rendering, HUD elements, serpentine meshes, particles, telegraphs, and visual effects must flow exclusively through `WebGLGameRenderer.ts` and `GLBatch.ts` utilizing high-performance WebGL 2.0 shader pipelines (`src/render/webgl/`).

