# DogMax Bug and Incoherence Repair Plan

## Summary

Repair the active game without restoring the intentionally removed full test/automation suite. The scan found these priority issues:

- Fresh clean build passes, but `--headless --self-test-duration=0.1` crashes by touching SFML shader/display state.
- `README.md`, audit docs, and some comments still claim doctests, E2E, AutomationServer, CommandDispatcher, GIF artifacts, river systems, and old test counts that no longer exist.
- `build/` and `build-dev/` contain stale `dogtests` artifacts from before test removal, which can mislead local validation.
- Active Doge/Dodge is incoherent: current gameplay is Spacebar dash, while old Active Evasion helper/config/spec remains as dead intent.
- `configs/automation.yaml` is mostly stale after automation removal; only `AUTOMATION_OFFSCREEN_FPS_CAP` is still read.
- Compiler warnings remain around fixed-size `snprintf` buffers and one unused function.
- `EnemyManager.cpp` is slightly over the 500-line rule at 504 lines.

## Key Changes

- Fix true headless startup:
  - Move shader capability checks and shader loading out of `GameSession` construction and into the window/render setup path.
  - Ensure `--headless` constructs gameplay state, steps simulation, respects `--self-test-duration`, and exits without creating any SFML window or GL/display-dependent object.
  - Keep `--offscreen` as display/GL-backed hidden-window mode.

- Reconcile test/build reality:
  - Update `README.md` build instructions so `./bt` is described as "build application" and no longer claims unit/E2E tests.
  - Remove or rewrite active docs that claim `dogtests`, `tests_e2e`, AutomationServer, CommandDispatcher, and GIF artifacts still ship.
  - Add a small smoke-check script or documented command set for current validation: clean configure, clean build, headless self-test.
  - Do not restore the removed full doctest/E2E/automation suite.

- Remove stale automation surface:
  - Remove `--automation`, `automationPort`, `isAutomationEnabled`, and stale `SyntheticInput` automation comments unless a live non-test caller exists.
  - Rename `AUTOMATION_OFFSCREEN_FPS_CAP` to an offscreen/render key, for example `OFFSCREEN_FPS_CAP`, update the one reader in `GameSession.cpp`, and delete `configs/automation.yaml` if no other live keys remain.

- Make Spacebar dash canonical:
  - Remove `src/combat/ActiveEvasion.hpp` and `ACTIVE_EVASION_WINDOW` / `ACTIVE_EVASION_BONUS`.
  - Update `GameDesign.md`, comments, and config comments so "Active Doge" means the current charge-based movement dash, not the old evade-bonus tap.
  - Keep `DodgeSystem` and `configs/dodge.yaml` as the authoritative implementation/config.

- Clean code warnings and rule violations:
  - Replace warning-prone fixed buffers in effect/catalog key builders with `std::format` or `std::ostringstream`/string concatenation.
  - Remove the unused `fadedAlpha` helper in `EnemyDesignEditor_Preview.cpp`.
  - Split a small cohesive slice out of `EnemyManager.cpp` so it drops below 500 lines without changing behavior.

- Archive stale audit truth:
  - Leave old audit files as historical artifacts, but add a current audit note dated July 6, 2026 explaining that tests/automation/river systems were intentionally removed and older audit results are not current validation.
  - Fix current top-level docs first; historical docs do not need line-by-line rewrites.

## Test Plan

- Clean configure in a fresh directory:
  - `cmake -S . -B /tmp/dogmax-clean -G Ninja -DDOGMAX_FAST=ON`
- Clean build:
  - `cmake --build /tmp/dogmax-clean -j$(nproc)`
- Headless smoke:
  - `/tmp/dogmax-clean/dogmax --headless --self-test-duration=0.1`
  - Expected: exits `0`, no X11/display error.
- Existing dev build:
  - `./bt dev`
- Static checks:
  - Literal config-key scan has no missing unguarded `config.get*("KEY")` keys.
  - `rg` confirms no active docs claim removed `dogtests`, `tests_e2e`, AutomationServer, or old Active Evasion behavior.
  - Source line-count check confirms no active `.cpp/.hpp` exceeds 500 lines.

## Assumptions

- Honor the July 1 commit that intentionally removed the full test suite and TCP automation API.
- Canonical Spacebar behavior is the current charge-based dash.
- Old river/water/bridge references in active docs are stale unless explicitly marked historical or planned.
- Build directories are generated state; stale `dogtests` artifacts should be ignored or cleaned locally, not treated as source of truth.
