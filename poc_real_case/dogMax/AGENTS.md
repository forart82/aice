# Agent TDD Protocol & Development Guidelines — dogmax

> **Protocol Version:** 2.3 (ported from dogV6 `0c8259a`, retargeted to C++23 / SFML 3)
> **Target:** AI Autonomous Agents & Assistant Workflows (Claude Code, Codex, Gemini)
> **Standard:** Strict Test-Driven Development (TDD), The Oracle SSOT, Commercial Viability & Cross-Platform Publishing Readiness
> **Rule Level:** Mandatory & Non-Negotiable

---

## 0. Port note — what changed from the original ruleset

These rules arrived from the dogV6 TypeScript/Phaser project. The rules are
unchanged in force; only the **technology bindings** were retargeted:

| dogV6 (TypeScript) | dogmax (C++23 / SFML 3) |
|---|---|
| TypeScript modules | C++23 translation units under `src/` |
| Phaser 3 / Three.js | SFML 3 |
| Vitest | **doctest** (MIT, header-only) |
| `npm run verify` | **`./verify`** (configure + build + ctest) |
| `npx vitest run <file>` | `ctest --test-dir build-test -R <name>` |
| `vite build` → `dist/` | CMake `Release` build → `build/` + `dogmax-<ts>` snapshot |
| `tsc --noEmit` | compiler warnings-as-errors on the test target |
| Browser / PWA / Capacitor | native desktop (Linux first), see `docs/PUBLISHING.md` |

**Two rules from the original set do not survive contact with a native desktop
build and are re-scoped rather than pretended:** Rule 10's smartphone
safe-areas, and Rule 13's *browser* audio-unlock lifecycle. Both are addressed
honestly in their sections below.

---

## 1. Executive Summary & Core Directive

This project rests on two immutable pillars:

1. **The TDD Protocol (this file):** Every task, bug fix, refactor and feature
   **must follow Test-Driven Development**, guided by a Feature TDD file
   (`docs/tdd/<feature>.tdd.md`).
2. **The Oracle (`ORACLE.md`):** The absolute **Single Source of Truth** for game
   rules, mechanics, formulas and balance.

**Production code must never be written before the corresponding test is
written, executed, and confirmed to fail.**

### ⚠️ This REPLACES the previous testing rule

`CLAUDE.md` previously mandated *"a test is written only when a bug is found —
no proactive tests, no exceptions"*. That rule is **revoked**. It is the exact
inverse of Rule 1 and the two cannot coexist. Anything written under the old
rule is legacy, not precedent.

---

## 2. Fundamental Rules

### Rule 1: The Zero-Code Without Test Policy
- **Never write, modify, or refactor production logic without a failing test in place.**
- A reported bug gets a reproduction test that **fails first**, before any fix.
- A requested feature gets its TDD spec completed, tests authored, failure
  observed — and only then production code.

### Rule 2: Dedicated Feature TDD Document Mandate
- Every feature has a spec at `docs/tdd/<feature_identifier>.tdd.md`.
- Use `docs/tdd/TEMPLATE.tdd.md`.
- It is a living document, updated across Red, Green and Refactor.

### Rule 3: The Red-Green-Refactor State Machine

```
1. SPECIFY   draft/update docs/tdd/<feature>.tdd.md
      ↓
2. RED       write test; run; CONFIRM FAILURE for the expected reason
      ↓
3. GREEN     minimal implementation; run; confirm PASS
      ↓
4. REFACTOR  clean up, keep every test green
      ↓
5. RECORD    paste real runner output into the TDD file
```

### Rule 4: No Test Tampering
Tests represent requirements. Never weaken an assertion, delete a check, or mock
away the logic under test to get green. If a test fails unexpectedly, debug the
**production code** — unless the requirement itself genuinely changed, in which
case update the Oracle first.

### Rule 5: Deterministic & Isolated Tests
Idempotent, deterministic, order-independent, no side effects. This project has
an enormous advantage here and it must not be squandered: `DeterministicRandom`
is seeded and bit-reproducible, and the simulation runs on a fixed timestep, so
gameplay logic is *exactly* testable. Never introduce wall-clock time or
unseeded randomness into a testable path.

### Rule 6: Architectural Separation
- **Decoupled core domain:** damage formulas, luck curves, level curves, loot
  rolls, dice, collision, inventory, scoring and input mapping are pure C++ with
  **no SFML types in their headers**, so they compile and run headlessly.
- **Headless testing:** domain logic runs under doctest in milliseconds, with no
  window and no GL context.
- **Presentation layer:** `src/render/**` reads domain state and draws. It never
  owns simulation state.

### Rule 7: Commercial Viability, Zero Copyright Infringement & Legal Safety
- **100% commercial usability** for the entire codebase, art, audio, fonts,
  dependencies and tools.
- **Permissive licenses only:** MIT, Apache-2.0, BSD-2/3-Clause, ISC, Zlib,
  BSL-1.0, CC0, CC-BY (with attribution), **OFL-1.1**, **Ubuntu Font Licence
  1.0**, **Bitstream Vera / DejaVu**.
  - *Amended 2026-08-20.* The last three are font licences the project already
    depends on and the original allowlist — written for a web project using
    webfonts — omitted them. They are commercially safe in substance: all three
    permit bundling, embedding and sale of the software, and restrict only the
    resale of the fonts *as fonts*. The amendment is recorded rather than made
    silently because it widens a rule, and a widened rule that nobody noticed is
    how the next real violation gets waved through. Note this was not optional:
    `assets/fonts/DejaVuSans.ttf` is the one font that actually ships in
    gameplay, so "delete it" was never an available answer.
  - ⛔ **FORBIDDEN:** GPL, AGPL, LGPL where static linking complicates packaging,
    CC-BY-NC, CC-BY-ND, or any proprietary/restricted asset.
- **Zero copyright infringement:** no ripped, scraped or unauthorised assets.
- **Privacy compliance:** GDPR / COPPA / CCPA. No telemetry without consent.
- **Current dependency status:** SFML is **Zlib/png** licensed — permissive and
  commercially safe. doctest is **MIT**. Both clear.

### Rule 8: The Oracle Mandate (SSOT)
- `ORACLE.md` is binding for design, mechanics, formulas, stats and balance.
  - **Mechanic invariant:** a mechanic in the Oracle **must** exist in the game.
  - **Formula invariant:** a formula or constant in the Oracle **must** be the
    one the code uses.
  - **History ledger:** every design change is recorded chronologically.
- **dogmax-specific binding:** the Oracle's formula table and
  `configs/*.yaml` must agree. A constant lives in config (never hard-coded in
  source) and is *documented* in the Oracle. If they disagree, that is a bug.
- `GameDesign.md` (242K) remains the deep design reference; the Oracle is the
  **authoritative extract** — what is binding, in a form tests can assert.

### Rule 9: Asset Provenance & License Manifest Mandate
- Every sound, music track, sprite, texture and font must be catalogued in
  [`docs/ASSETS.md`](docs/ASSETS.md) with Asset Key, File Path, Author/Source,
  Verified Commercial License and monetization permission.
- Never add an uncredited or unverified binary asset.

### Rule 10: Viewport, Scaling & Safe Areas
- The game renders at a fixed design resolution (`GLOBAL_SCREEN_WIDTH` /
  `GLOBAL_SCREEN_HEIGHT` in `configs/`) and letterboxes to the window, which the
  existing `WorldRenderSurface` and `Letterbox` already implement.
- Critical HUD must stay inside the safe margins in
  [`docs/DEVICE_SPECS.md`](docs/DEVICE_SPECS.md).
- **Re-scoped honestly:** the original rule targeted smartphone notches and
  gesture bars. This is a native desktop build; SFML has no supported browser
  target and only experimental Android support. Notch handling is therefore
  **deferred, not silently dropped** — see `docs/DEVICE_SPECS.md`.

### Rule 11: Unified Abstract Input Protocol
- Gameplay must never bind directly to `sf::Keyboard`, `sf::Mouse` or
  `sf::Joystick`.
- All control funnels through a testable `VirtualInput` layer normalising
  keyboard, gamepad and touch into direction and action vectors.
- **This is currently a gap** — see the audit backlog. Making input abstract is
  what allows a *test* to drive the hero.

### Rule 12: Versioned State Serialization & Save Migration Integrity
- Persistent data carries `schemaVersion: N`, with migration functions and
  matching migration tests, per [`docs/SAVE_SCHEMA.md`](docs/SAVE_SCHEMA.md).
- **This is currently a gap** — dogmax has no save system at all. The rule is
  binding the moment one is added.

### Rule 13: 60 FPS Performance & Resource Lifecycle
- **Pooling:** high-frequency entities (damage text, effect bursts, floor items,
  enemies) must recycle rather than allocate per-frame.
- **Perf budget:** 60 FPS with the 5000-enemy harness available; run it before
  large render/sim changes.
- **Re-scoped honestly:** the browser audio-unlock and `visibilitychange`
  requirements are web-only and do not exist here. The native equivalent that
  *does* apply is releasing audio and GPU resources on window focus loss/close.

### Rule 14: Automated Quality Gate (`./verify`)
Before concluding a task, merging, or building a release:

```bash
./verify
```

which runs:
1. Configure + build with **warnings as errors** on the test target
2. Full headless doctest suite via `ctest`
3. Release build of the game binary (bundle validation equivalent)

### Rule 15: Mandatory Git Repository & Detailed Task Completion Commits
- The repository is active and every completed task is committed **after**
  `./verify` passes.
- **Commit structure:** concise imperative header line; one blank line; then a
  thorough body covering rationale and design decisions, files touched, test
  suites added with proof of green, and edge cases/invariants preserved.

---

## 3. The Feature TDD File Standard

```
project-root/
├── ORACLE.md              # Absolute SSOT
├── AGENTS.md              # This protocol
├── CLAUDE.md              # Claude Code project facts (subordinate to the above)
├── docs/
│   ├── ASSETS.md          # Asset provenance & license registry
│   ├── DEVICE_SPECS.md    # Viewport, scaling, safe areas
│   ├── PUBLISHING.md      # Multi-platform publishing blueprint
│   ├── SAVE_SCHEMA.md     # Save schema & migration rules
│   └── tdd/
│       ├── TEMPLATE.tdd.md
│       └── <feature>.tdd.md
├── src/
│   ├── combat/ abilities/ entities/ core/   # pure domain — headless testable
│   └── render/ app/                          # presentation
└── tests/
    └── <area>/            # doctest suites
```

---

## 4. Operational Workflow

**Step 1 — Requirement analysis & TDD file.** Cross-reference `ORACLE.md`. Update
it if new mechanics or formulas are introduced. Create or extend
`docs/tdd/<feature>.tdd.md` from the template and complete Section 1.

**Step 2 — Test cases & expected results.** Complete Sections 2 and 3 with
explicit IDs (`TC-01`, `TC-EDGE-01`), exact inputs and assertable outputs, drawn
from the Oracle's formulas.

**Step 3 — RED.** Write the tests under `tests/`. Run
`ctest --test-dir build-test -R <name>` (or `./verify`). **Confirm failure for
the expected reason.** Paste the output into Section 4.1.

**Step 4 — GREEN.** Minimal production code. Any new dependency or asset must
clear Rules 7 and 9. Iterate until the new tests and every legacy test pass.

**Step 5 — REFACTOR.** Clean up with tests green, re-running after each edit.

**Step 6 — Quality gate.** Capture real runner output into Section 4.2/4.3 and
run `./verify`.

**Step 7 — Commit.** Stage everything; commit per Rule 15.

---

## 5. Task Completion Checklist

- [ ] **Oracle synchronised** — mechanics, formulas and history recorded.
- [ ] **TDD file created/updated** in `docs/tdd/`.
- [ ] **Specification explicit** — behaviour, I/O, edge cases (Section 1).
- [ ] **Test strategy detailed** — cases, mocks, commands (Section 2).
- [ ] **Assertions defined** — expected outputs and boundaries (Section 3).
- [ ] **RED confirmed** — failing output captured before production code.
- [ ] **GREEN confirmed** — new and legacy tests pass.
- [ ] **Commercial & IP cleared** (Rule 7).
- [ ] **Asset manifest updated** (Rule 9).
- [ ] **Input abstracted & viewport safe** (Rules 10, 11).
- [ ] **Save schema versioned + migration tested** if state changed (Rule 12).
- [ ] **Refactor complete** with tests green.
- [ ] **Execution log updated** with real output (Section 4).
- [ ] **Quality gate passed** — `./verify` clean (Rule 14).
- [ ] **Committed** with detailed body (Rule 15).

---

## 6. Working style (retained from the previous AGENTS.md)

These survive because they do not conflict with the protocol above:

- **One agent owns the session.** Peer agents working in parallel worktrees is
  retired. Subagents remain a tool for disjoint, non-overlapping work.
- **One active product goal at a time** (`docs/ROADMAP.md`), one small coherent
  slice inside it.
- **FIFO on user tasks.** Finish older tasks before newer ones. "Later" means
  deferred, not "start now".
- **Configuration is sacred.** Every tunable lives in `configs/*.yaml`.
  Hard-coding a constant in source is forbidden; the loader crashes early on a
  missing key rather than defaulting.
- **Fix rule violations in the same commit** you find them in.
