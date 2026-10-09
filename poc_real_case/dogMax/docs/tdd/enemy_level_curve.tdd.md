# Feature TDD Specification: Enemy Level Curve (SE1)

- **Feature Identifier:** `enemy_level_curve`
- **Oracle Reference:** **NONE YET — see §0.** `ORACLE.md` §4 has no row for this
  curve; `ORACLE.md` §7 already logs *"Oracle formula/entity tables incomplete"*
  as a known Rule 8 gap. §5 of this document proposes the rows the Oracle should
  gain so that gap can be closed.
- **Target Component:** `src/combat/EnemyLevelCurve.hpp` / `.cpp`
- **Test File Path:** `tests/combat/level_curve_test.cpp`
- **Status:** `CHARACTERISATION (verified against a standalone harness; pending
  the dispatcher's ./verify run)`

---

## 0. Honesty preamble — why the Status field is not one of the template's four

The template offers `DRAFT | RED | GREEN | REFACTORED`. **None of them is true
here**, and picking the least-wrong one would misrepresent how this code came to
exist.

`EnemyLevelCurve` was written **before** the TDD protocol was adopted
(`ORACLE.md` §6, 2026-08-20). The tests in `tests/combat/level_curve_test.cpp`
were written **after** the implementation, by reading it. There was no RED
phase: no failing test ever drove a line of this curve into being. These are
**characterisation tests** — they pin existing behaviour so it becomes
enforceable and cannot drift silently, which is the correct treatment for legacy
code and is *not* Red-Green-Refactor.

Rule 1 (no production code without a failing test first) binds **new** work from
the adoption date onward. This document exists so the curve stops being
undocumented, not to claim a TDD cycle that never happened.

Two further limits, stated plainly rather than papered over:

1. **No `./verify` run backs this document.** This work was done under a process
   constraint forbidding use of the shared build directories (parallel agents
   share them). The execution log in §4 is from a **standalone doctest harness
   compiled into `/tmp`** against the same sources — real output, honestly
   labelled, but *not* the Rule 14 quality gate. `./verify` remains the
   authoritative gate and has not yet run on these tests.
2. **The template's §2.1 "Execution Command" field is stale** — it still reads
   `npx vitest run [file]`, an artefact of the dogV6 TypeScript port that the
   C++ retarget missed. The correct command is given in §2.1 below.

---

## 1. Feature Specification (What it does)

### 1.1 Summary & Business Objective

`EnemyLevelCurve` maps the hero's **walked distance** to the **level of enemies
spawned around them**. It is the game's sole difficulty-over-time ramp: dogmax
has no wave counter and no timer-driven escalation, so this curve alone decides
how quickly a run gets harder and therefore how long the game lasts.

It replaces a flat `ENEMY_LEVEL_DISTANCE_STEP` constant, which could not express
"fast early progress, slow late grind" — the shape a ~40-hour playable target
needs. The curve is **piecewise over three bands**: linear, then exponential,
then a second shallower exponential.

The cumulative distance table is built **once at construction** from five
tunables in `configs/enemy_levels.yaml`. Per-spawn cost is a bounded backwards
walk over that table, so the hot path does no `pow` and no allocation.

> Rule 6 status: **compliant.** `EnemyLevelCurve.hpp` names no SFML type — it
> forward-declares only `dof::loaders::ConfigLoader`. The curve runs with no
> window and no GL context. (The test binary still links `dogcore`, which links
> SFML by design so domain code is tested as shipped; "headless" here means no
> window or context is created, not that SFML is absent from the link line.)

### 1.2 Functional Requirements

- **FR-1:** `levelFromDistance(d)` returns a level in `[1, maxLevel()]` for any
  finite `d`, including zero and negative input.
- **FR-2:** Level 1 is free — `cumulativeForLevel(1) == 0`, so every run starts
  at level 1.
- **FR-3:** Band L2..`LINEAR_END` advances by a constant `LINEAR_STEP` px per level.
- **FR-4:** Band `LINEAR_END+1`..`EXP1_END` advances by
  `LINEAR_STEP × EXP1_FACTOR^(N − LINEAR_END)` px per level.
- **FR-5:** Band `EXP1_END+1`..`ENEMY_LEVEL_MAX` advances by
  `step(EXP1_END) × EXP2_FACTOR^(N − EXP1_END)` px per level, where
  `step(EXP1_END) = LINEAR_STEP × EXP1_FACTOR^(EXP1_END − LINEAR_END)`.
- **FR-6:** `cumulativeForLevel` is the exact inverse of `levelFromDistance` on
  every valid level, and clamps out-of-range levels to the nearest valid one.
- **FR-7:** Every tunable is read from config. **No curve constant is hard-coded
  in source** (Rule 8).

### 1.3 Inputs & Outputs

- **Inputs (construction):** a `ConfigLoader` supplying
  `ENEMY_LEVEL_LINEAR_STEP` (float), `ENEMY_LEVEL_LINEAR_END` (int),
  `ENEMY_LEVEL_EXP1_FACTOR` (float), `ENEMY_LEVEL_EXP1_END` (int),
  `ENEMY_LEVEL_EXP2_FACTOR` (float), `ENEMY_LEVEL_MAX` (int).
- **Inputs (query):** `float distance` — hero-relative walked distance in px.
- **Outputs:** `int levelFromDistance(float)`, `float cumulativeForLevel(int)`,
  `int maxLevel()`. The object is immutable after construction; no state
  changes, no events emitted.

### 1.4 Invariants & Edge Cases

- **INV-1 — monotonic:** the cumulative table never decreases. It holds *by
  construction*, because every band accumulates onto `cumulative[level - 1]`
  rather than recomputing from scratch, so even a misordered band configuration
  cannot produce a decreasing table.
- **INV-2 — round-trip:** `levelFromDistance(cumulativeForLevel(N)) == N` for
  every `N` in `[1, maxLevel()]`, while the table is *strictly* increasing.
- **INV-3 — threshold is inclusive:** the test is `distance >= cumulative[level]`,
  so landing exactly on a threshold **promotes** to that level.
- **Edge Case — zero / negative distance:** early-out returns level 1.
- **Edge Case — distance past the last threshold:** saturates at `maxLevel()`.
- **Edge Case — `ENEMY_LEVEL_MAX ≤ 0`:** clamped to 1 by `std::max(1, …)`. This
  is a deliberate safety clamp: without it the `size_t` cast would underflow into
  a huge allocation and `cumulative[1]` would be an out-of-bounds write.
- **Edge Case — zero `LINEAR_STEP`:** every step becomes 0, the whole table is 0,
  and ties resolve **upward** (the walk starts at `maxLevelValue`). One pixel
  past the origin the player faces max-level enemies. Plausible mis-tune,
  documented so it is recognisable rather than mysterious.
- **Edge Case — bands ordered backwards** (`EXP1_END < LINEAR_END`): the exp1
  loop runs zero times and the exp2 loop overwrites levels the linear loop
  already filled. INV-1 and INV-2 still hold; it degrades rather than crashing.
- **⚠ Known wart — the step JUMPS at each band boundary.** Each exponential
  band's first step uses `factor^1`, not `factor^0`, so step size is
  discontinuous exactly at the seam. In the suite's synthetic curve the step
  jumps 100 → 200 at `LINEAR_END+1` and 400 → 1200 at `EXP1_END+1`. A continuous
  stitch would use `factor^0` for each band's first level. **This is
  characterised, not endorsed** — changing it is a balance decision that needs an
  Oracle entry and a retune, not a silent fix.
- **Frame-rate / high-delta:** not applicable. The curve is a pure function of
  accumulated distance and never sees `dt`.

---

## 2. Test Strategy (How it will be tested)

### 2.1 Test Environment & Harness

- **Framework:** doctest 2.4.11 (MIT, header-only, vendored at
  `third_party/doctest/` — Rule 7 clear).
- **Mocks & Stubs:** a `ConfigLoader` built **in memory via `setRaw`** — never
  `loadDirectory`. Nothing touches disk, so the suite has no working-directory
  dependence and no coupling to live balance values. No window, no GL context,
  no RNG (this module has none), no clock.
- **Execution Command** (correcting the template's stale `npx vitest run`):

  ```bash
  ./verify                                  # full Rule 14 gate
  ctest --test-dir build-test -R dogmax_suite --output-on-failure
  ```

  doctest's own filter narrows to this feature inside the single suite binary:

  ```bash
  ./build-test/dogmax_tests -tc="EnemyLevelCurve*"
  ```

- **Fixture rationale:** the shipped tuning is **hard-coded into the test** rather
  than read from `configs/enemy_levels.yaml`. A test that follows the config
  would always pass and prove nothing about the curve. Consequence, stated up
  front: **a deliberate retune is *meant* to fail these tests.** That failure is
  the signal to update the assertions and the Oracle — it is not a flake, and
  deleting the test is the wrong response.

### 2.2 Test Case Matrix

| Test ID | Category | Scenario / Description | Test Case Name |
| :--- | :--- | :--- | :--- |
| **TC-01** | Happy Path | Synthetic curve builds the exact expected table across all three bands | `…builds the exact cumulative table for a synthetic curve` |
| **TC-02** | Happy Path | `levelFromDistance` selects the correct band | same case, `TC-02` subcase |
| **TC-03** | Boundary | Distance exactly on a threshold promotes | same case, `TC-03` subcase |
| **TC-04** | Invariant | Step discontinuity at both band seams is pinned | same case, `TC-EDGE-01` subcase |
| **TC-05** | Invariant | Round-trip holds at all levels, synthetic **and** shipped | `…round-trips distance and level in both directions` |
| **TC-06** | Invariant | Shipped table is strictly increasing across all 99 levels | same case, `TC-03` subcase |
| **TC-07** | Edge | Zero / negative distance → level 1 | `…clamps every out-of-range input instead of faulting` |
| **TC-08** | Edge | Distance past the last threshold saturates | same case, `TC-EDGE-02` |
| **TC-09** | Edge | `cumulativeForLevel` clamps both directions | same case, `TC-EDGE-03` |
| **TC-10** | Edge | `ENEMY_LEVEL_MAX` of 0 / −5 lifted to a 1-level curve | same case, `TC-EDGE-04` |
| **TC-11** | Edge | Zero step ⇒ every non-zero distance is max level | same case, `TC-EDGE-05` |
| **TC-12** | Edge | Backwards band order degrades safely | same case, `TC-EDGE-06` |
| **TC-13** | Balance | Shipped tuning lands in its documented 28–30 M px band | `…shipped tuning lands inside its documented 40-hour band` |

---

## 3. Expected Results & Assertions

### 3.1 Scenario Assertions Matrix

The synthetic fixture is `LINEAR_STEP=100, LINEAR_END=4, EXP1_FACTOR=2.0,
EXP1_END=6, EXP2_FACTOR=3.0, ENEMY_LEVEL_MAX=8`. Every cumulative value is a
small whole number, exactly representable in `float32`, so `==` is legitimate
rather than `Approx`:

```
level:  1     2     3     4     5     6      7      8
cum:    0   100   200   300   500   900   2100   5700
step:       100   100   100   200   400   1200   3600
                              ^band seam    ^band seam
```

| Test ID | Input / Setup | Execution Call | Expected Output / Assertion |
| :--- | :--- | :--- | :--- |
| **TC-01** | synthetic config | `cumulativeForLevel(1..8)` | exactly `0,100,200,300,500,900,2100,5700` |
| **TC-02** | synthetic config | `levelFromDistance(150/350/600/2500)` | `2 / 4 / 5 / 7` |
| **TC-03** | synthetic config | `levelFromDistance(100/900/5700)` | `2 / 6 / 8` (inclusive threshold) |
| **TC-04** | synthetic config | consecutive step deltas | `100→200` at L5, `400→1200` at L7 |
| **TC-05** | both configs | `levelFromDistance(cumulativeForLevel(N))` | `== N` for every `N` |
| **TC-06** | shipped config | pairwise compare all 99 entries | strictly increasing |
| **TC-07** | synthetic config | `levelFromDistance(0 / −1 / −1e9)` | `1` |
| **TC-08** | synthetic config | `levelFromDistance(5700.1 / 1e9)` | `8` (= `maxLevel()`) |
| **TC-09** | synthetic config | `cumulativeForLevel(0 / −7 / 9 / 100000)` | `0 / 0 / cum[8] / cum[8]` |
| **TC-10** | `ENEMY_LEVEL_MAX=0`, then `−5` | `maxLevel()`, queries | `1`; all lookups return level `1`, cum `0` |
| **TC-11** | `LINEAR_STEP=0` | `levelFromDistance(0 / 0.5 / 1e9)` | `1 / 8 / 8` |
| **TC-12** | `LINEAR_END=10, EXP1_END=5, MAX=12` | monotonic + round-trip sweep | no crash; INV-1 and INV-2 hold |
| **TC-13** | shipped config | `cumulativeForLevel(2 / 10 / 11 / 40 / 99)` | `30000` and `270000` exactly; `≈302400`; `3.9–4.0 M`; `28–30 M` |

**On exactness — why the synthetic table may use `==` but the shipped one may
not.** Both run through `std::pow`, so the distinction is *not* "pow versus no
pow":

- **Synthetic (TC-01, `==`):** every `pow` call has an integral base and an
  integral exponent with a small exactly-representable result — `powf(2,1)`,
  `powf(2,2)`, `powf(3,1)`, `powf(3,2)`. Every real libm returns those exactly,
  and each partial sum stays a whole number far below `2^24`, so `float32` holds
  the entire table without rounding.
- **Shipped, linear band (TC-13, `==`):** `cum[2]` and `cum[10]` never touch
  `pow` at all — they are repeated additions of an exact integer (`30000 × k`,
  well under `2^24`).
- **Shipped, exponential bands (TC-13, `Approx` / coarse band):** `cum[11]`
  upward evaluates `powf(1.08f, N)`, a genuine transcendental approximation whose
  last bits are a libm implementation detail rather than a guarantee. These use
  `Approx` or a band wide enough to survive libm variation and narrow enough to
  catch a real curve change.

---

## 4. Execution Log & Validation Proof

### 4.1 RED Phase Execution (Initial Failure Confirmation)

**No RED phase exists, and none is fabricated here.**

The implementation predates the protocol (see §0). These are characterisation
tests written against working code; they passed on first run, which is the
expected and correct outcome for characterisation. Pasting an invented failure
trace to fill this section would be exactly the kind of false claim Rule 4 and
the honesty requirement exist to prevent.

### 4.2 GREEN Phase Execution (Passing Confirmation)

- **Execution Date/Time:** `2026-08-22`
- **Harness — read this before trusting the numbers:** the shared build
  directories were off-limits for this run (parallel agents share them), so this
  output comes from a **standalone doctest binary compiled into `/tmp`** against
  the same sources, not from `ctest`:

  ```bash
  g++ -std=c++23 -O1 -Wall -Wextra -Wpedantic -Werror -ffp-contract=off \
      -mfpmath=sse -msse2 -Isrc -Ithird_party/doctest -o /tmp/lc_verify/suite \
      /tmp/lc_verify/main.cpp tests/combat/level_curve_test.cpp \
      src/combat/EnemyLevelCurve.cpp src/loaders/ConfigLoader.cpp \
      src/helpers/StringHelper.cpp   # …plus the sibling suites and their deps
  /tmp/lc_verify/suite -tc="EnemyLevelCurve*"
  ```

- **Output (level-curve cases only):**

```text
[doctest] doctest version is "2.4.11"
[doctest] run with "--help" for options
===============================================================================
[doctest] test cases:   4 |   4 passed | 0 failed | 9 skipped
[doctest] assertions: 282 | 282 passed | 0 failed |
[doctest] Status: SUCCESS!
```

- **Output (whole combat characterisation set — this suite plus the sibling
  `kill_streak` and `loot_rolls` suites authored alongside it):**

```text
[doctest] doctest version is "2.4.11"
[doctest] run with "--help" for options
===============================================================================
[doctest] test cases:  13 |  13 passed | 0 failed | 0 skipped
[doctest] assertions: 1824 | 1824 passed | 0 failed |
[doctest] Status: SUCCESS!
```

The compile ran with `-Wall -Wextra -Wpedantic -Werror`, matching the flags the
`dogmax_tests` target applies, so the suite is warnings-clean under the gate's
own strictness.

### 4.3 Refactor Verification & Regression Sweep

- **Full Suite Command:** `./verify`
- **Result:** **NOT RUN.** Deliberately not executed — see §0. The dispatcher
  owns the build and the Rule 14 gate for this run.
- **Sign-off Status:** `PENDING — awaiting ./verify`. Not approved, and not
  claimed to be.

---

## 5. Proposed Oracle entries (closing part of the §7 Rule 8 gap)

This is the part that earns the document its keep. `ORACLE.md` §4 currently has
no row for the level curve, so Rule 8's formula invariant has nothing to bind.
The rows below are drafted from the implementation and the shipped config, ready
for a maintainer to paste into §4 after review — **they are a proposal, not an
edit; `ORACLE.md` is outside this task's write scope.**

| ID | Applies to | Formula | Config keys |
| :--- | :--- | :--- | :--- |
| `FORMULA_ENEMY_LEVEL_STEP` | Distance cost of level `N` | piecewise: `LINEAR_STEP` for `2 ≤ N ≤ LINEAR_END`; `LINEAR_STEP × EXP1_FACTOR^(N−LINEAR_END)` for `LINEAR_END < N ≤ EXP1_END`; `step(EXP1_END) × EXP2_FACTOR^(N−EXP1_END)` for `N > EXP1_END` | `ENEMY_LEVEL_LINEAR_STEP`, `ENEMY_LEVEL_LINEAR_END`, `ENEMY_LEVEL_EXP1_FACTOR`, `ENEMY_LEVEL_EXP1_END`, `ENEMY_LEVEL_EXP2_FACTOR` |
| `FORMULA_ENEMY_LEVEL_CUM` | Distance to reach level `N` | `cum(1) = 0`, `cum(N) = cum(N−1) + step(N)` | as above |
| `FORMULA_ENEMY_LEVEL_LOOKUP` | Distance → spawn level | `max{ N : cum(N) ≤ distance }`, clamped to `[1, ENEMY_LEVEL_MAX]`; ties resolve to the **highest** N | `ENEMY_LEVEL_MAX` |

Accompanying notes the Oracle should carry with them:

- **Why piecewise:** a single flat step cannot deliver both quick early levelling
  and a 40-hour tail. The bands buy fast onboarding (~6 h to L10), a steepening
  mid-game (~14 h to L40), then a long shallow grind (~40 h to L99).
- **Logged spec discrepancy (already in the config, worth promoting):**
  `GameDesign.md` proposes `EXP2_FACTOR = 1.05` *in the same paragraph* that pins
  `cum[99] ≈ 28–30 M px`. The two are mutually exclusive — `1.05^59 ≈ 17.8` puts
  `cum[99]` near 110 M, roughly 4× the stated target. The user-confirmed
  resolution honours the stated **intent** (28–30 M ≈ 38–40 h) by tuning the
  factor to `1.01`. The Oracle should record the resolution, not the
  contradiction.
- **Shipped tuning, verified by TC-13:** `cum[10] = 270 000`,
  `cum[40] ≈ 3.94 M`, `cum[99] ≈ 28.3 M` px.
- **Wart to decide on, not to inherit silently:** the band-seam step
  discontinuity described in §1.4. It should be either ratified in the Oracle or
  fixed with a retune — but not left undocumented, which is its current state.

---

## 6. Related files

| File | Role |
| :--- | :--- |
| `src/combat/EnemyLevelCurve.hpp` / `.cpp` | implementation under characterisation |
| `configs/enemy_levels.yaml` | the five tunables (Rule 8: no curve constant in source) |
| `tests/combat/level_curve_test.cpp` | this spec's suite |
| `ORACLE.md` §4, §7 | where §5's proposed rows belong; §7 logs the gap they close |
