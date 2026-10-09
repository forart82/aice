# DogMax Bug and Incoherence Deep Scan & Repair Plan
**Date**: July 6, 2026

## 1. Deep Scan Findings: Bugs & Incoherences

A comprehensive codebase scan of `src/`, `configs/`, `docs/`, and `README.md` was conducted. Below are the verified issues, architectural bugs, compiler warnings, dead code, and documentation discrepancies.

---

### A. Core Architectural Bugs

#### 1. Headless Startup Crash (`SIGABRT`)
- **Problem**: Running the game with `--headless --self-test-duration=0.1` on headless environments (like CI pipelines or machines without X11/OpenGL display drivers) results in a `SIGABRT` crash.
- **Root Cause**: The `GameSession` constructor (defined in [GameSession_Setup.cpp](file:///home/forart/dev/dogMax/src/app/GameSession_Setup.cpp#L106)) immediately invokes `initializeShaders()`. This function executes `shaderLoader.hasSystemSupport()`. 
  The `ShaderLoader` constructor (in [ShaderLoader.cpp](file:///home/forart/dev/dogMax/src/loaders/ShaderLoader.cpp#L9)) initializes `isSystemSupported` by calling `sf::Shader::isAvailable()`.
  In SFML 3, `sf::Shader::isAvailable()` queries OpenGL capabilities and extensions. In a headless context with no active X11 display or GL context initialized, this query crashes or aborts the program.
- **Why it matters**: Headless smoke tests are used to verify simulation steps and progression logic without launching a GUI. This crash blocks headless automated runs entirely.

#### 2. Stale Build Artifacts
- **Problem**: The local build trees (`build/` and `build-dev/`) may contain leftover artifacts of `dogtests` and unit tests from before the test suite was deleted.
- **Root Cause**: The entire C++ unit test suite and the TCP automation API were removed on July 1st (commits `470b5d9` and `ab85db0`), but local build directories are not automatically purged. Leftover binaries can mislead developers into trying to run tests that are no longer part of the source tree.

---

### B. Dead Code & Dead Configurations

#### 1. Stale Evasion Logic (`src/combat/ActiveEvasion.hpp`)
- **Problem**: The header [ActiveEvasion.hpp](file:///home/forart/dev/dogMax/src/combat/ActiveEvasion.hpp) defines `activeEvasionChance()`, but is **never included** or compiled in the production code.
- **Root Cause**: Active Evasion (evade-chance bonus on key tap) is an obsolete feature. The current game canonicalized the refilling charge-based movement dash (`DodgeSystem`) bound to the Spacebar.
- **Related Dead Keys**: The following keys in `configs/evasion.yaml` are defined but never read by any production system:
  - `ACTIVE_EVASION_WINDOW`
  - `ACTIVE_EVASION_BONUS`

#### 2. Stale Automation Seams
- **Problem**: Stale parser logic, CLI switches, and variables exist for the removed automation API:
  - `configs/automation.yaml` defines `AUTOMATION_HOST`, `AUTOMATION_PORT`, `AUTOMATION_ACCEPT_TIMEOUT_MS`, `AUTOMATION_READ_TIMEOUT_MS`, and `AUTOMATION_BACKLOG`, which are completely unread.
  - `AppOptions::isAutomationEnabled` and `AppOptions::automationPort` are parsed in [AppOptions.cpp](file:///home/forart/dev/dogMax/src/app/AppOptions.cpp#L46-L79) but never read.
  - `SyntheticInput` struct (in [SyntheticInput.hpp](file:///home/forart/dev/dogMax/src/app/SyntheticInput.hpp)) and its member check `syntheticInput.isActive` (in `GameSession_Input.cpp`) are dead logic paths.

---

### C. Rule Violations (Hardcoded Styling & Layout)

The project rules specify: *"Every configuration value, tunable parameter, and externalized variable... must be represented in a dedicated `*.yaml` file under `configs/`. Hard-coding values or defining configuration constants within source code is strictly forbidden."*

The scan found several violations:
1. **Debug Tab Colors**: In `ConfigTab.cpp` and `PerformanceTab.cpp`, panel backgrounds and text colors (e.g. `sf::Color{20, 20, 28, 220}`) are hardcoded rather than reading from `theme.yaml`.
2. **WorldRenderer VFX Constants**: Color and timing parameters for jump shadows, berserk pulses, telegraph rings, and landing shockwaves in `WorldRenderer.cpp:227-287` are hardcoded literals (e.g. `sf::Color(255, 220, 0, alpha)`).
3. **Inventory Renderer Dimensions & Colors**: Dimension offsets and fallback slot colors remain hardcoded in `InventoryRenderer.cpp` instead of using the config loader.

---

### D. Documentation Staleness & Incoherences

#### 1. Stale `README.md`
- **Build Instructions**: Describes `./bt` as running unit tests and `./bt e2e` as running E2E. These targets do not exist.
- **Automation / Tests Sections**: Lists "## AUTOMATION API" and "## TESTS" sections detailing doctests, Python test runner, and GifRecorder, which were deleted.
- **Stale Config Lists**: References deleted config files (like `forge.yaml` and `automation.yaml` keys).

#### 2. GameDesign.md / Code Incoherence
- **Active Doge**: `GameDesign.md` still defines "Active Doge" as the Spacebar evade-chance tap, contradicting the production code where Spacebar is bound to `DodgeSystem` movement dash.

---

### E. Compiler Warnings

1. **Unused Functions**: `fadedAlpha` in [EnemyDesignEditor_Preview.cpp](file:///home/forart/dev/dogMax/src/render/EnemyDesignEditor_Preview.cpp#L31) is defined in an anonymous namespace but never used.
2. **Format Truncation Warnings**: Small `char idx[8]` buffers formatted via `std::snprintf` with `%03d` (in `EffectsCatalogWindow.cpp`, `EffectsComposer.cpp`, `EffectsRenderer.cpp`, and `GroupedEffectsCatalog.cpp`) trigger `-Wformat-truncation` warnings because the compiler assumes an arbitrary `int` could exceed 8 characters.

---

## 2. Step-by-Step Repair & Correction Plan

To resolve these issues without violating workspace boundaries or modifying unrelated files, follow this targeted plan:

### Phase 1: Fix Headless Crash & Clean Dead Code
1. **Defer OpenGL Calls**:
   - Refactor `ShaderLoader` constructor so it initializes `isSystemSupported = false` (or does not call `sf::Shader::isAvailable()` at construction).
   - Add a lazy-loading query or check: query `sf::Shader::isAvailable()` only when `initializeShaders()` or shader loading is triggered.
   - Guard `initializeShaders()` call: do not call it in `GameSession` constructor. Instead, call it inside `applyConfigToRenderers()` or directly inside `run()` only if `wantWindow` is true. This guarantees `--headless` will never run any OpenGL query or display setup.
2. **Remove Dead Combat Code**:
   - Delete `src/combat/ActiveEvasion.hpp`.
   - Remove references to `ACTIVE_EVASION_WINDOW` and `ACTIVE_EVASION_BONUS` from `configs/evasion.yaml`.
3. **Remove Dead Automation Code**:
   - Remove `options.isAutomationEnabled` and `options.automationPort` parsing from [AppOptions.cpp](file:///home/forart/dev/dogMax/src/app/AppOptions.cpp).
   - Delete the dead `SyntheticInput` logic in `GameSession_Input.cpp`.
   - Remove unused keys from `configs/automation.yaml`, leaving only `AUTOMATION_OFFSCREEN_FPS_CAP` (or rename it to `OFFSCREEN_FPS_CAP` and place it in `window.yaml` or `ui.yaml` to delete `configs/automation.yaml` entirely).

### Phase 2: Resolve Warnings and Rule Violations
1. **Clean Up Compiler Warnings**:
   - Delete the unused `fadedAlpha` helper from [EnemyDesignEditor_Preview.cpp](file:///home/forart/dev/dogMax/src/render/EnemyDesignEditor_Preview.cpp#L31).
   - Increase the size of the truncation-warning buffer from `char idx[8]` to `char idx[16]` (or use `std::to_string` / `std::format`) in `EffectsCatalogWindow.cpp`, `EffectsComposer.cpp`, `EffectsRenderer.cpp`, and `GroupedEffectsCatalog.cpp` to silence compiler warnings.
2. **Externalize Hardcoded Colors**:
   - Move debug tab backgrounds and text colors from `ConfigTab.cpp` and `PerformanceTab.cpp` into `configs/theme.yaml`.
   - Move world VFX timing/colors from `WorldRenderer.cpp` into `configs/enemy_body_vfx.yaml`.

### Phase 3: Reconcile Documentation
1. **Clean up `README.md`**:
   - Rewrite the "Build & Run" section to reflect only the live `./bt` build script options.
   - Delete the "## AUTOMATION API" and "## TESTS" sections.
   - Clean up stale config lists.
2. **Update Game Design Docs**:
   - Clarify the active Spacebar dash in `GameDesign.md` and mark the old evasion window mechanics as deprecated/removed.
