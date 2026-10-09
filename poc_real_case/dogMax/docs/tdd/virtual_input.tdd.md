# Feature TDD Specification: Virtual Input (Rule 11 Abstraction Layer)

- **Feature Identifier:** `virtual_input`
- **Oracle Reference:** `ORACLE.md#7-audit-backlog--known-gaps-against-the-new-rules` (row *"Gameplay binds `sf::Keyboard` directly; no `VirtualInput`"*), `ORACLE.md#31-determinism--binding`
- **Target Component:** `src/input/VirtualInput.hpp` *(does not exist yet — this spec defines it)*
- **Test File Path:** `tests/input/virtual_input_test.cpp`
- **Status:** `DRAFT`

> **Honesty note.** Nothing in this document has been built or run. Section 4 is
> deliberately empty: the tests do not exist, so there is no execution evidence to
> record. Every claim in §0 is a citation into the tree as it stands at
> `0bfaf27`; every claim in §1–§3 is a requirement, not an observation.

---

## 0. Audit — how the hero is driven today

### 0.1 Raw-device call sites in the **gameplay** path (Rule 11 violations)

| # | Site | What it does |
| :--- | :--- | :--- |
| V-1 | `src/app/GameSession_Input.cpp:54-55` | Polls `LControl`/`RControl` to suppress movement while the Ctrl+W catalog combo is held. |
| V-2 | `src/app/GameSession_Input.cpp:56-59` | Polls `W`/`A`/`S`/`D` straight into `Inputable::isPressedW..D`. **This is the entire movement input of the game.** |
| V-3 | `src/app/GameSession.cpp:388` | Polls `Q` per simulation tick to drive `vitalityTank->transferTo(...)` — a held-button gameplay action. |
| V-4 | `src/app/GameSession_Events.cpp:379-391` | `sf::Event::KeyPressed` / `K::Space` triggers the dodge dash: reads `hero.inputable().resolveDirection()` and calls `hero.triggerDash(...)`. Raw event → gameplay, no abstraction. |
| V-5 | `src/app/GameSession_Input.cpp:64` | `sf::Mouse::getPosition(window)` → `currentCursorWorld`, consumed by hover/pickup logic. Borderline: it feeds UI hover, but it is the only cursor source and would have to be faked to drive a pointer-based action. |
| V-6 | `src/app/GameSession_Input.cpp:23-29` | `options.isSelfTestMoving` **hard-codes a fake input** (`S`+`D` held) inside production code so the render smoke test can move the hero. This is a scripted input source implemented as an `if` in the wrong layer — the clearest possible evidence the abstraction is missing. |

### 0.2 Raw-device call sites that are **UI / editor chrome** (out of Rule 11 scope)

Recorded so a later reader does not mistake them for a gap:

- `src/app/GameSession_Events.cpp:77-...` — the whole `handleKeyPressed` router: panel toggles (`I`, `G`, `P`), console (`Grave`, `Escape`, `Enter`, `Backspace`), Ctrl-chords (`Ctrl+M/O/H/E/R`), `F1`, `Alt+Q`, `Tab`, `Num1..3`. These bind *chrome*, not gameplay; they may keep using raw events.
- `src/app/GameSession_MouseEvents.cpp:60-65` — Ctrl/Shift/Alt polling for **WorldEditor** modifiers.
- `src/app/GameSession_MouseEvents.cpp:34` — cursor position used to finish an in-flight inventory drag when Help opens.
- `src/render/WorldEditor.cpp:901` — editor's own key polling.
- `X` (`GameSession_Events.cpp:370-373`) destroys the hovered inventory item. Inventory management, not combat — chrome by the same test.
- **The whole mouse-event surface.** `GameSession_MouseEvents.cpp` routes
  `MouseMoved` (:133), `MouseButtonPressed` (:167), `MouseButtonReleased` (:508)
  and `MouseWheelScrolled` (:554); every terminal call is either an
  `InteractionController` inventory/loot operation (:151-154, :287, :326, :349,
  :502-504, :537, :549) or `camera->zoomBy` (:96, :608). **No mouse path reaches
  the hero, aiming or combat** — aim is derived from the movement direction
  (`HeroManager.cpp:94`), not the cursor. The mouse therefore stays outside
  `VirtualInput` in this slice.

> **Method disclosure.** Raw *polling* (§0.1) is enumerated exhaustively by
> `grep -rn "sf::Keyboard::isKeyPressed\|sf::Mouse::isButtonPressed\|sf::Mouse::getPosition\|sf::Joystick" src/`
> — that grep returns exactly the sites listed above and nothing else. The
> event-shaped paths were audited by targeted grep plus reading the key router and
> the mouse-event dispatch, **not** by a full read of all ~700 lines of
> `GameSession_MouseEvents.cpp`. The conclusion "no mouse gameplay" rests on every
> terminal call in that file resolving to `InteractionController` or `Camera`, which
> the grep above does establish.

`src/render/InteractionController.*` is **already clean**: it contains no
`sf::Keyboard`/`sf::Mouse`/`sf::Joystick` reference at all and receives
already-mapped `sf::Vector2f` cursor coordinates. It is the shape the input layer
should copy, not a site that needs changing.

### 0.3 The current data path

```
sf::Keyboard::isKeyPressed        (GameSession_Input.cpp:56-59)
        ↓  four raw bools
dof::abilities::Inputable         (Inputable.hpp:8-12)
        ↓  resolveDirection()     (Inputable.cpp:7-19 — normalises, and MUTATES
        │                          lastNonZeroDirection as a side effect)
        ├─ HeroManager::update    (HeroManager.cpp:88-95 → approachVelocityFromDirection, aimAlong)
        ├─ dash trigger           (GameSession_Events.cpp:383)
        └─ facing for the renderer(WorldRenderer_EntityDraw.cpp:98 reads lastNonZeroDirection)
```

Ordering: `GameSession::run` drains window events once per rendered frame, then
runs `while (clock.consumeStep()) stepSimulation(clock.fixedDt())`
(`GameSession.cpp:258-261`). `applyKeyboardInputsToHero()` is called **inside**
`stepSimulation` (`GameSession.cpp:368`), so the OS keyboard is re-polled once per
*fixed tick* — twice in one frame whenever the accumulator yields two steps. For
held state that is merely redundant; for any edge-detected button it would be
wrong (one press could be seen twice, or a press-and-release inside one frame lost
entirely). The abstraction must fix the sampling point, not inherit it.

### 0.4 What a test would have to fake today

To drive the hero from a doctest, a test must reach
`worldInstance->hero().inputable()` and write the four bools by hand. That means
constructing a `GameSession` — which needs `AppOptions`, a `ConfigLoader` over the
real `configs/` tree, a `World`, and (for anything past movement) a
`sf::RenderWindow`. **There is no seam below `GameSession`.** The only supported
way to move the hero without a window is the `--self-test-moving` flag
(V-6), which can express exactly one input: south-east, forever.

Consequently: **no test can currently express "walk north for 30 ticks, then
dash".** That is the concrete cost of the gap.

### 0.5 Defects found during the audit

These are reported, not fixed — this task's scope is a specification, and the fixes
belong to the GREEN phase of this feature (§1.2, FR-5/FR-6). They are listed so
they are not silently inherited by the new layer.

- **D-1 — the movement gate and the action gate disagree.** The WASD guard
  (`GameSession_Input.cpp:42-44`) blocks on `worldEditor->isOpen()`,
  `isHelpVisible`, `isConsoleFocused`, `isSettingsOpen`, `isConfigEditActive`.
  The `Q` guard (`GameSession.cpp:380-386`) blocks on `isHeadless`,
  `isConsoleFocused`, `isSettingsOpen`, `isDebugSearchFocused`,
  `isLootFilterQualityFocused`, `isLootFilterLevelFocused`, `isConfigEditActive`.
  The sets are neither equal nor nested. Observable consequence: **typing into the
  debug-panel search field or a loot-filter field walks the hero** (`a`, `s`, `d`,
  `w` are all plausible search text), because those three flags appear only in the
  `Q` guard. Symmetrically, `Q` is not blocked while the Help overlay is open.
- **D-2 — no `FocusLost` handling.** `GameSession_Events.cpp:38` handles
  `FocusGained`; `grep -rn "FocusLost" src/` returns nothing. `sf::Keyboard::isKeyPressed`
  reports **global OS key state**, not window-focused state, so on the SFML 3
  semantics the hero keeps walking after an Alt+Tab with `W` held, and typing `w`
  in another application walks it. *Not empirically confirmed — I did not run the
  game (this run is build-forbidden). It follows from the documented SFML
  semantics plus the absence of any focus gate, and TC-EDGE-01/02 exist to settle
  it.*
- **D-3 — `resolveDirection()` is a query with a side effect.** It writes
  `lastNonZeroDirection` (`Inputable.cpp:17`) and is called from three places
  (`HeroManager.cpp:88`, `GameSession_Events.cpp:383`, and the renderer's read of
  the member at `WorldRenderer_EntityDraw.cpp:98`). Calling it an extra time is
  harmless today only because it is idempotent for a fixed key state; it violates
  the Rule-of-Least-Surprise and makes the facing state untestable in isolation.
- **D-4 — Rule 6 letter violation.** `src/abilities/Inputable.hpp:3` includes
  `<SFML/System/Vector2.hpp>`. Domain headers must be SFML-free. (Rule 6's
  *purpose* — headless execution — is satisfied, since `Vector2` is header-only
  math with no GL or window dependency, which is why `tests/combat/damage_formula_test.cpp`
  links `dogcore` and runs headless today. The letter is still broken, and the same
  include appears in `Moveable.hpp`, `Dashable.hpp`, `Aimable.hpp`. See §1.5.)

---

## 1. Feature Specification (What it does)

### 1.1 Summary & Business Objective

`VirtualInput` is the single seam between "a human pressed something" and "the
simulation received an intent". Gameplay code stops asking the OS what is held and
starts reading a per-tick **`InputFrame`**: a normalised movement vector plus
button held/pressed/released sets. Where that frame comes from — a keyboard, a
gamepad, a test script, a recorded replay — is invisible to the simulation.

Three things this buys, in order of value to the project:

1. **Testability (Rule 11's stated purpose).** A doctest can drive the hero with
   no window, no GL context and no `GameSession`, which is the precondition for
   ever TDD-ing movement, dash, i-frames or the vitality drain.
2. **Reproducible bug reports.** The Oracle already guarantees a bit-reproducible
   RNG (`ORACLE.md §3.1`: xoshiro128\*\* seeded by SplitMix64) and a fixed
   timestep. The only remaining non-determinism in a run is the human. Capture the
   input stream and **seed + recorded input = the exact run, replayed frame for
   frame**. This is the highest-leverage part of the design and the reason a replay
   source is specified now rather than "later".
3. **Gamepad/rebinding without touching gameplay.** A second source is a new file,
   not an edit to `HeroManager`.

Non-goals (YAGNI): gamepad support itself, touch, rebinding UI, and any change to
the chrome key router in §0.2. This slice defines the layer, the keyboard source
and the scripted source, and moves the four gameplay bindings onto it.

> Domain code under test must be free of SFML types in its header (Rule 6), or it
> cannot run headlessly.

### 1.2 Functional Requirements

- **FR-1 — Source-agnostic interface.** `dof::input::InputSource` is an abstract
  interface with a single sampling method returning an `InputFrame`. It has **no
  SFML type in its header**, and no knowledge of who or what produces the frame.
- **FR-2 — Normalised movement vector.** `InputFrame::moveDirection` is either the
  zero vector or a unit vector. Producers never hand out un-normalised or
  over-length vectors; consumers may assume `|v| ∈ {0, 1}` without re-checking.
- **FR-3 — Action buttons with edges.** `InputFrame` carries three bitmasks over
  `GameplayButton`: `held`, `pressed` (down this tick, not the previous),
  `released` (up this tick, down the previous). Edge computation happens in
  **one** place — `VirtualInput`, from consecutive raw held-masks — never in a
  source and never at a call site.
- **FR-4 — Keyboard source.** `dof::app::KeyboardInputSource` is the **only**
  gameplay code permitted to name `sf::Keyboard`. Its physical bindings and the
  modifier-suppression rule come from `configs/input.yaml` (see §1.6); no key
  literal appears in source (Rule 8).
- **FR-5 — Single gameplay gate.** `VirtualInput` owns one
  `isGameplayInputBlocked` predicate. On the tick the gate **closes** it emits the
  **neutral frame** (zero vector, empty `held`/`pressed`, `released` for everything
  that was held) and zeroes its previous-held state; it stays neutral while
  blocked. On the tick the gate **re-opens** it **re-baselines** previous-held from
  the current raw mask *before* computing edges — adopting the raw state rather
  than zeroing it — so a button still physically down through the block produces no
  `pressed`. This retires D-1 by construction: there is exactly one gate and it
  cannot diverge from itself.
- **FR-6 — Focus release.** Focus loss and focus regain use exactly the FR-5
  mechanism: loss zeroes previous-held (which is what emits the `released` edges),
  regain re-baselines previous-held from the raw mask. A key still physically down
  across an Alt+Tab therefore resumes moving the hero without firing a `pressed`
  edge — no phantom dash on re-entry. Zeroing on *regain* would manufacture the
  very phantom press this requirement exists to prevent; the baseline must be
  adopted, not cleared. This retires D-2.
- **FR-7 — Scripted source.** `dof::input::ScriptedInputSource` replays an ordered
  sequence of raw frames, one per `sample()` call, and reports exhaustion. It is
  pure — no SFML, no clock, no I/O — and is the test double for every input-driven
  test in the project.
- **FR-8 — Replay source and recorder.** A run is reproducible from
  `{ rngSeed, simTickHz, orderedRawFrames }`. `InputRecorder` appends the raw
  per-tick mask+axes; `ReplayInputSource` is a `ScriptedInputSource` constructed
  from that record. The record is persistent state and therefore carries
  `schemaVersion` per Rule 12 (`docs/SAVE_SCHEMA.md`).
- **FR-9 — One sample per tick.** `VirtualInput::advance()` is called exactly once
  per fixed simulation tick, before any consumer reads the frame; `InputFrame`
  reads within a tick are pure and repeatable. The device is polled once per
  rendered frame and its snapshot is held for every fixed step in that frame, so
  a double-step frame cannot double-count an edge (§0.3).
- **FR-10 — Consumers read the frame, not the device.** `HeroManager`,
  the dash trigger and the vitality drain take their input from the frame.
  `--self-test-moving` (V-6) becomes a `ScriptedInputSource` constructed in
  `GameSession_Setup`, deleting the hard-coded branch from `GameSession_Input.cpp`.

### 1.3 Inputs & Outputs

**Inputs**

| Name | Type | Meaning |
| :--- | :--- | :--- |
| raw held mask | `std::uint32_t` | bitset over `GameplayButton`, produced by a source |
| raw axes | `InputVector2` | pre-normalisation axis pair from an analogue source; keyboard sources leave it zero and let the button mask drive movement |
| `isBlocked` | `bool` | resolved gate state, pushed in by the app layer once per tick |
| `hasFocus` | `bool` | pushed in by the app layer on `FocusLost`/`FocusGained` |

**Outputs — `InputFrame`**

| Field | Type | Guarantee |
| :--- | :--- | :--- |
| `moveDirection` | `InputVector2` | zero vector, or unit length within `INPUT_UNIT_EPSILON` |
| `held` | `std::uint32_t` | buttons down this tick |
| `pressed` | `std::uint32_t` | `held & ~previousHeld` |
| `released` | `std::uint32_t` | `previousHeld & ~held` |
| `lastNonZeroDirection` | `InputVector2` | last non-zero `moveDirection`; seeded from config, never reset to zero |

**`GameplayButton`** — the whole gameplay surface, deliberately small:
`MoveUp`, `MoveDown`, `MoveLeft`, `MoveRight`, `Dash`, `VitalityDrain`.
Everything in §0.2 stays out.

### 1.4 Invariants & Edge Cases

- **INV-1 — Unit or zero.** `|moveDirection| == 0` or `|moveDirection| == 1 ± INPUT_UNIT_EPSILON`. In particular a diagonal is `(±√½, ±√½)`, never `(±1, ±1)`: a hero holding two keys must not travel 41 % faster than one holding one.
- **INV-2 — Opposite directions cancel per axis.** `MoveLeft`+`MoveRight` → `x = 0`; it is *not* "last key wins" and *not* "first key wins". Both axes opposed → the zero vector.
- **INV-3 — Facing persists.** `lastNonZeroDirection` is written only when `moveDirection` is non-zero. Releasing every key must leave the hero facing where it was (`WorldRenderer_EntityDraw.cpp:98` depends on this) and must never leave it facing `(0,0)`.
- **INV-4 — Edges are exact.** A button held across N ticks yields exactly one `pressed` (tick 1) and one `released` (the tick after the last held one). Never two, never zero.
- **INV-5 — Blocked is neutral, and re-entry is edge-free.** While blocked: zero vector, empty `held`/`pressed`. Un-blocking with a button still physically down emits **no** `pressed`, because previous-held is re-baselined from the raw mask on the re-opening tick (FR-5), not zeroed.
- **INV-6 — Focus loss releases; focus regain does not press.** See FR-6. No input survives a focus loss, and none is invented on the way back.
- **INV-7 — Determinism.** For a fixed seed and a fixed scripted frame sequence, the resulting simulation state is bit-identical across runs and machines (`ORACLE.md §3.1`). No wall clock, no unseeded RNG, no OS query on the scripted path.
- **INV-8 — Headless purity.** `src/input/**` headers include no SFML header. A test linking `dogcore` can construct and drive `VirtualInput` with no window.
- **Edge case — modifier chord.** `Ctrl` held must suppress movement (V-1: Ctrl+W is the catalog window). The suppression list is config-driven, and it suppresses the *movement axes only*, never the whole frame.
- **Edge case — simultaneous press and release in one tick.** A source that reports a button as both newly-down and newly-up in the same tick is impossible by construction: edges derive from two consecutive held-masks, so `pressed & released == 0` always.
- **Edge case — frame drops / high delta time.** Input is per-tick, not per-second. A frame producing three fixed steps must not multiply a single `pressed` into three (FR-9). A frame producing zero steps must not lose one.
- **Edge case — scripted exhaustion.** A `ScriptedInputSource` that runs out of frames reports exhausted and thereafter returns the neutral raw frame. It never wraps, never asserts, never re-reads the last frame — a test that over-runs its script must see the hero stop, not drift.
- **Edge case — replay/live divergence.** A replay whose `simTickHz` or `schemaVersion` disagrees with the current build is **rejected loudly** (Rule: crash early), not silently replayed at the wrong rate.

### 1.5 Open design question — the vector type (needs an owner decision)

Rule 6 forbids SFML types in domain headers. Every existing ability header breaks
this already (`Inputable.hpp:3`, `Moveable.hpp`, `Dashable.hpp`, `Aimable.hpp` all
include `<SFML/System/Vector2.hpp>`), so there are two honest options and I will not
pretend one is free:

- **(A) `dof::input::InputVector2 { float x, y; }` — a 12-line POD in `src/input/`.**
  Rule-6-clean by the letter. Costs one conversion at each boundary where the frame
  meets ability code — realistically two sites (`HeroManager::update`, the dash
  trigger). Introduces a second 2-vector type into a codebase that has one.
- **(B) Keep `sf::Vector2f`.** Zero conversions, consistent with every neighbouring
  header, still genuinely headless. Leaves the Rule 6 letter broken and makes this
  feature complicit in it.

**This spec assumes (A)** — it is the option Rule 11 and Rule 6 read together
demand, and two conversion calls is a small price for a domain layer that is
provably SFML-free. If the owner prefers (B), only §1.3, §3 and the type name
change; no test case is invalidated. Migrating the other ability headers to (A) is
explicitly **out of scope** here.

### 1.6 Configuration surface (Rule 8 — new file, authored in GREEN)

`configs/input.yaml` does not exist yet. It must be created before the keyboard
source compiles, because no key literal may live in source:

| Key | Meaning |
| :--- | :--- |
| `INPUT_KEY_MOVE_UP` / `_DOWN` / `_LEFT` / `_RIGHT` | physical key names for the four axes |
| `INPUT_KEY_DASH` | dash button (currently `Space`) |
| `INPUT_KEY_VITALITY_DRAIN` | held drain button (currently `Q`) |
| `INPUT_SUPPRESS_MOVEMENT_WITH_CONTROL` | `0/1` — the Ctrl+W guard of V-1 |
| `INPUT_UNIT_EPSILON` | tolerance for the unit-length invariant |
| `INPUT_FACING_DEFAULT_X` / `_Y` | seed for `lastNonZeroDirection` (today hard-coded `{0,1}` at `Inputable.hpp:12` — itself a Rule 8 violation) |
| `INPUT_REPLAY_SCHEMA_VERSION` | Rule 12 version stamp for recordings |

*Writing that file is outside this task's exclusive scope (spec only) and is the
first step of the GREEN phase.*

---

## 2. Test Strategy (How it will be tested)

### 2.1 Test Environment & Harness

- **Framework:** doctest (MIT, header-only), vendored at `third_party/doctest`.
- **Mocks & Stubs:** `ScriptedInputSource` **is** the mock — no mocking framework is
  needed or wanted. Determinism tests use a seeded `DeterministicRandom` and
  `Clock` at a fixed `SIM_TICK_HZ`. Config values are passed to the unit under test
  explicitly rather than read through a live `ConfigLoader`, matching the precedent
  set in `tests/combat/damage_formula_test.cpp:29-34` — a test that follows the
  config would always pass and prove nothing about the behaviour.
- **Never:** a real window, a GL context, `sf::Keyboard`, or wall-clock time.
  `KeyboardInputSource` is the one component this suite does **not** cover; it is
  presentation-layer glue with no logic beyond a config lookup, and testing it
  would require the very window Rule 6 forbids.
- **Execution Command:** `ctest --test-dir build-test -R dogmax_suite --output-on-failure`
  (the template's `npx vitest run` line is a leftover from the dogV6 port; the
  C++ binding is the one in `AGENTS.md §0`). The suite is picked up automatically —
  `CMakeLists.txt:161-162` globs `tests/*.cpp` recursively, so a new
  `tests/input/` directory needs no build edit.

### 2.2 Test Case Matrix

| Test ID | Category | Scenario / Description | Test Method Name |
| :--- | :--- | :--- | :--- |
| **TC-01** | Happy Path | Single axis held → unit vector along that axis | `test_should_emit_unit_vector_for_single_axis` |
| **TC-02** | Happy Path | Two perpendicular axes held → normalised diagonal | `test_should_normalise_diagonal_to_unit_length` |
| **TC-03** | Happy Path | No axis held → zero vector | `test_should_emit_zero_vector_when_idle` |
| **TC-04** | Happy Path | Button held 3 ticks then released → one `pressed`, one `released` | `test_should_emit_exactly_one_edge_per_transition` |
| **TC-05** | Happy Path | Scripted source drives the hero north for 30 ticks | `test_should_drive_hero_from_scripted_source` |
| **TC-06** | Boundary | Facing retained after every key released | `test_should_retain_last_non_zero_direction` |
| **TC-07** | Boundary | All four axes held simultaneously → zero vector | `test_should_cancel_when_all_four_axes_held` |
| **TC-08** | Boundary | Script exhausted → neutral frame, exhaustion reported | `test_should_report_exhaustion_and_go_neutral` |
| **TC-09** | Determinism | Same seed + same script, run twice → identical hero state | `test_should_reproduce_run_from_seed_and_script` |
| **TC-10** | Determinism | Recorded frames replayed → identical to the recording run | `test_should_replay_recording_bit_identically` |
| **TC-EDGE-01** | Error / Edge | Focus lost with a movement key held | `test_should_release_all_input_on_focus_loss` |
| **TC-EDGE-02** | Error / Edge | Focus regained with the key still down → no phantom `pressed` | `test_should_not_synthesise_press_on_focus_regain` |
| **TC-EDGE-03** | Error / Edge | Opposite axes held simultaneously | `test_should_cancel_opposite_axes_per_axis` |
| **TC-EDGE-04** | Error / Edge | Gate blocked while a button is held, then unblocked | `test_should_stay_edge_free_across_gate_release` |
| **TC-EDGE-05** | Error / Edge | Movement suppressed while the Ctrl modifier is held | `test_should_suppress_movement_under_control_modifier` |
| **TC-EDGE-06** | Error / Edge | Dash requested with zero movement direction | `test_should_reject_dash_without_direction` |
| **TC-EDGE-07** | Error / Edge | One rendered frame consuming three fixed steps | `test_should_not_duplicate_edge_across_multi_step_frame` |
| **TC-EDGE-08** | Error / Edge | Replay with a mismatched `schemaVersion` | `test_should_reject_replay_with_wrong_schema_version` |

### 2.3 Cases deliberately **not** covered, and why

- **Gamepad / touch.** Not implemented (YAGNI). The interface admits them; nothing asserts them.
- **`KeyboardInputSource` key mapping.** Needs a window to press a real key. See §2.1.
- **Chrome keys (§0.2).** Out of Rule 11's scope by the gameplay/chrome split; they are not moving to `VirtualInput` and there is nothing new to assert about them.

---

## 3. Expected Results & Assertions (What are the results)

### 3.1 Scenario Assertions Matrix

| Test ID | Input / Setup | Execution Call | Expected Output / State Assertion |
| :--- | :--- | :--- | :--- |
| **TC-01** | Script frame: `held = MoveUp` | `input.advance(); input.frame()` | `moveDirection == (0, -1)`; `held == MoveUp`; `pressed == MoveUp` |
| **TC-02** | `held = MoveUp \| MoveRight` | `advance(); frame()` | `moveDirection ≈ (0.70710678, -0.70710678)`; `length ≈ 1.0` within a tolerance **pinned as a literal in the test** (`constexpr float kUnitEpsilon`), mirroring `tests/combat/damage_formula_test.cpp:29-34` — a test that read `INPUT_UNIT_EPSILON` live would widen itself when the config widened and prove nothing |
| **TC-03** | `held = 0` | `advance(); frame()` | `moveDirection == (0, 0)`; `held == 0`; `pressed == 0` |
| **TC-04** | `Dash` held on ticks 1–3, absent on tick 4 | 4 × `advance()` | tick 1 `pressed == Dash`; ticks 2–3 `pressed == 0`, `held == Dash`; tick 4 `released == Dash`, `held == 0`; total presses over 4 ticks == 1 |
| **TC-05** | Script: 30 × `MoveUp`, seeded RNG, fixed dt | 30 × `heroManager.update(hero, dt)` | `hero.moveable().position.y` strictly decreases every tick after easing engages; final `y < initial y`; `x` unchanged (bit-equal) |
| **TC-06** | `MoveLeft` for 2 ticks, then `held = 0` | 3 × `advance()` | tick 3 `moveDirection == (0,0)` **and** `lastNonZeroDirection == (-1, 0)` |
| **TC-07** | `held = MoveUp\|MoveDown\|MoveLeft\|MoveRight` | `advance(); frame()` | `moveDirection == (0, 0)`; `lastNonZeroDirection` unchanged from its prior value |
| **TC-08** | Script of 2 frames | 4 × `advance()` | ticks 3–4: neutral frame, `isExhausted() == true`; no assert, no throw, no repeat of frame 2 |
| **TC-09** | Seed `S`, identical 200-frame script, two fresh worlds | full 200-tick sim ×2 | hero position/health/RNG draw count bit-identical between runs (`==`, not `Approx`) |
| **TC-10** | Recorder captures run A; `ReplayInputSource` built from the record drives run B with seed `S` | 200 ticks each | run B state bit-identical to run A at every checkpoint tick (1, 50, 200) |
| **TC-EDGE-01** | `MoveUp` held, then `setFocus(false)` | `advance()` after focus loss | `moveDirection == (0,0)`; `held == 0`; `released == MoveUp`; `lastNonZeroDirection` preserved |
| **TC-EDGE-02** | Continue TC-EDGE-01: still `MoveUp` in the raw mask, `setFocus(true)` | 2 × `advance()` | first tick after regain: `pressed == 0`, `held == MoveUp`, `moveDirection == (0,-1)` — previous-held was re-baselined from the raw mask, so the still-down key is a continuation, not a new press. Asserted explicitly: this is the assertion an implementer who zeroed on regain would be tempted to weaken (Rule 4) |
| **TC-EDGE-03** | `held = MoveLeft \| MoveRight \| MoveUp` | `advance(); frame()` | `moveDirection == (0, -1)` — x cancels exactly, y survives, result still unit length |
| **TC-EDGE-04** | `Dash` held; `setBlocked(true)` for 3 ticks; `setBlocked(false)` with `Dash` still held | 5 × `advance()` | blocked ticks neutral (`held == 0`, `pressed == 0`); the unblock tick emits `held == Dash, pressed == 0` (re-baselined, FR-5); a genuine release-then-press afterwards **does** emit `pressed == Dash` |
| **TC-EDGE-05** | `held = MoveUp`, `isControlHeld = true`, `INPUT_SUPPRESS_MOVEMENT_WITH_CONTROL = 1` | `advance(); frame()` | `moveDirection == (0,0)`; non-movement buttons in `held` are unaffected |
| **TC-EDGE-06** | `pressed == Dash` while `moveDirection == (0,0)` | dash-trigger unit under test | no dash armed; dodge charge **not** consumed (pins the current behaviour at `GameSession_Events.cpp:383-388`) |
| **TC-EDGE-07** | One device snapshot with `Dash` newly down, consumed by 3 fixed steps | `advance()` ×1, `frame()` ×3 | exactly one tick reports `pressed == Dash`; the other two report `held == Dash, pressed == 0` |
| **TC-EDGE-08** | Replay record with `schemaVersion = current + 1` | construct `ReplayInputSource` | rejected loudly — throws / returns an error the caller must handle; **never** replays at the wrong schema |

### 3.2 Oracle synchronisation required alongside GREEN

- `ORACLE.md §7` — the row *"Gameplay binds `sf::Keyboard` directly; no `VirtualInput`"* flips from **Pending** only when FR-1…FR-10 are all green. Partial completion must leave it Pending.
- `ORACLE.md §3.1` gains the sentence that closes the determinism loop: a run is reproducible from **seed + recorded input frames**, which is only true once FR-8 lands.
- `ORACLE.md §6` gains a history row for the decision taken in §1.5 (A or B).
- `docs/SAVE_SCHEMA.md` gains the replay-record schema (Rule 12).

---

## 4. Execution Log & Validation Proof

*Empty by design. The tests in §2.2 have not been written or run — there is no
RED, no GREEN and no `./verify` output to record, and inventing any would be
fabricated evidence. This section is filled in only from real runner output, per
`AGENTS.md` Rule 3 step 5.*

### 4.1 RED Phase Execution (Initial Failure Confirmation)
- **Execution Date/Time:** `not yet run`
- **Command:** `ctest --test-dir build-test -R dogmax_suite --output-on-failure`
- **Output:** *(pending)*

### 4.2 GREEN Phase Execution (Passing Confirmation)
- **Execution Date/Time:** `not yet run`
- **Command:** `ctest --test-dir build-test -R dogmax_suite --output-on-failure`
- **Output:** *(pending)*

### 4.3 Refactor Verification & Regression Sweep
- **Full Suite Command:** `./verify`
- **Result:** *(pending)*
- **Sign-off Status:** `NOT SUBMITTED`

---

## 5. Refactor size — an honest estimate

**Verdict: medium, and incremental. It does not need one atomic change.** The
reason is that `Inputable` is a struct of plain bools with exactly three readers;
it can be *fed* by the new layer long before it is *replaced* by it.

### 5.1 Files that change

| File | Change | Size |
| :--- | :--- | :--- |
| `src/input/InputVector2.hpp` | new POD | trivial |
| `src/input/GameplayButton.hpp` | new enum + mask helpers | trivial |
| `src/input/InputFrame.hpp` | new struct | trivial |
| `src/input/InputSource.hpp` | new interface | trivial |
| `src/input/VirtualInput.{hpp,cpp}` | normalisation, edges, gate, focus | ~150 lines, all of the logic |
| `src/input/ScriptedInputSource.{hpp,cpp}` | test/replay source | small |
| `src/input/InputRecorder.{hpp,cpp}` | FR-8, second slice | small |
| `src/app/KeyboardInputSource.{hpp,cpp}` | new; absorbs `GameSession_Input.cpp:54-59` | small |
| `configs/input.yaml` | new (§1.6) | trivial |
| `src/app/GameSession_Input.cpp:17-60` | `applyKeyboardInputsToHero` shrinks to "sample, gate, publish"; V-6 branch deleted | net negative |
| `src/app/GameSession.cpp:368, 373-377, 380-388` | Q poll → `frame().held & VitalityDrain`; the editor-branch key clearing → the gate | small |
| `src/app/GameSession_Events.cpp:379-391` | Space → `frame().pressed & Dash`; add a `FocusLost` arm next to `FocusGained` at :38 | small |
| `src/app/GameSession.hpp` | owns a `VirtualInput` + an `InputSource` pointer | trivial |
| `src/app/GameSession_Setup.cpp` | picks the source (keyboard / scripted / replay) from `AppOptions` | small |
| `src/managers/HeroManager.cpp:88-95` | reads the frame instead of `inputable().resolveDirection()` | small |
| `src/abilities/Inputable.{hpp,cpp}` | slice 3: the four bools and `resolveDirection` disappear; only `lastNonZeroDirection` survives, written by the frame | net negative |
| `src/render/WorldRenderer_EntityDraw.cpp:98` | follows wherever `lastNonZeroDirection` lands | one line |
| `tests/input/virtual_input_test.cpp` | new | the deliverable |

No `CMakeLists.txt` edit: `src/*.cpp` and `tests/*.cpp` are both globbed
(`CMakeLists.txt:88-90`, `:161-162`).

### 5.2 Suggested slicing (each slice compiles, runs and is committable)

1. **Slice 1 — the layer, dark.** Add `src/input/**` and the full test suite of
   §2.2 against `ScriptedInputSource`. Nothing in the game calls it yet. This is
   the only slice that is pure TDD in the Rule 1 sense (no production logic exists
   to characterise), and it is where the value is.
2. **Slice 2 — movement.** `KeyboardInputSource` + `configs/input.yaml`;
   `applyKeyboardInputsToHero` writes the frame into `Inputable`'s bools.
   Behaviour-neutral by design, so a manual playtest is the check. D-1's gate
   unification and D-2's `FocusLost` arm land here — both are bug fixes and get
   their reproduction tests (TC-EDGE-01/04) green in this slice.
3. **Slice 3 — actions.** Dash and vitality drain move onto `pressed`/`held`;
   `--self-test-moving` becomes a scripted source; `Inputable`'s bools are deleted
   and `HeroManager` reads the frame directly (D-3, D-4).
4. **Slice 4 — replay (optional, high value).** `InputRecorder`, the record format
   in `docs/SAVE_SCHEMA.md`, and TC-10/TC-EDGE-08.

### 5.3 Risks

- **The gate is the risky part, not the vector math.** Unifying the two divergent
  guards of D-1 *changes behaviour* — typing in the debug search will stop walking
  the hero, and `Q` will stop draining while Help is open. Both are the intended
  fix, but they are user-visible and belong in the commit body.
- **Movement feel must not change.** `Moveable::approachVelocityFromDirection`
  easing (`ORACLE.md §3.3`) is downstream of the direction vector and is untouched.
  Slice 2 is only correct if the hero feels identical; a diagonal that quietly
  became `(1,1)` would be a 41 % speed-up that no compiler warns about — which is
  exactly what TC-02 exists to prevent.
- **Slice 1 is worthless if slices 2–3 never land.** An abstraction nothing calls
  is dead code (YAGNI). The Oracle row stays **Pending** until slice 3 is done.
