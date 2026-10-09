# CLAUDE.md — Project Rules for dogmax

## Agent Model — tier by task class, with a mandatory quality floor

Match model + effort to what the task actually needs. Default to the **cheapest
tier that fits** so delegated work stays fast — but **never downgrade the tiers
that ship or verify output**. This replaces the old blanket "everything is
opus+max" rule, which wasted the top tier on lookups and typo fixes (opus+max on
every subagent multiplies cost/latency ×N for no gain).

| Task class | Tool | Model | Effort |
|---|---|---|---|
| locate / search / map code | `cavecrew-investigator` | its default (`haiku`) | inherit |
| 1–2 file mechanical edit | `cavecrew-builder` | `sonnet` | `medium` |
| diff / branch / file review | `cavecrew-reviewer` | its default (`haiku`) | inherit |
| 3+ files / design / cross-cutting judgment | full `Agent` (e.g. `HERO`) | **`opus`** | **`high`** |
| verify / adversarial check / final "am I done" / conflict resolution | full `Agent` | **`opus`** | **`max`** |

**This table is about *delegated* work — it is not an instruction to delegate.**
Under the single-agent working style (see "Working Style" below), doing the work
yourself, inline, is the default; a 3+ file judgment task is normally you, not a
dispatch. The table says which tier to pick **once you have decided to delegate**.

**Mandatory floor — this is the part that never overrides:**
- Any delegated task needing real judgment, or touching 3+ files, MUST run
  `model: "opus"` at **at least** `effort: "high"`.
- Any **verification, adversarial check, final done-gate, or merge-conflict
  resolution** that is delegated MUST run `model: "opus"` with `effort: "max"`.
  Never downgrade these — they decide what ships.

```
// judgment / multi-file
Agent({ model: "opus", effort: "high", ... })
// verify / adversarial / final gate
Agent({ model: "opus", effort: "max", ... })
```

Everything above the floor (locate, mechanical edit, review) is free to — and
SHOULD — run the cheaper tier. See "Agent Speed → Subagent selection" below; the
two sections are deliberately consistent. This rule survives session resets,
system-prompt changes, and model updates because it lives in this file.

## Build & Run

CMake project (C++23, SFML 3). The build directory is `build/`; it defaults to a
`Release` (`-O3`) configuration. Two targets: `dogcore` (STATIC library holding
every game source under `src/`) and `dogmax` (the executable, `src/main.cpp`
only). The `dogmax` target copies `configs/` and `assets/` into `build/`, so the
binary must run with `build/` as the working directory.

```bash
# Configure (first time, or after editing CMakeLists.txt)
cmake -S . -B build

# Build the game — always through ./bt so the snapshot is stamped
./bt                 # release build (build/) + stamp a dogmax-<ts> snapshot
./bt dev             # fast build (build-dev/, -O1 -g0), no snapshot
./bt <target>        # build a single target

# Run the game (must cd into build/ first)
(cd build && ./dogmax)
# …or launch the newest stamped snapshot from the repo root
./runGame
```

## Build Artifact Naming & Rotation — mandatory

Every build of the game binary is published to the repo root under a **timestamped
name**, never as a bare `dogmax`:

- The artifact is named `dogmax-<UTC timestamp>` — `dogmax-YYYYMMDDHHMMSS` in UTC.
  Each build is a distinct, dated, chronologically-sortable snapshot.
- After each successful build, the freshly built binary is **copied** from
  `build/` to the repo root as `dogmax-<timestamp>`. Only the **5 most recent**
  snapshots are kept; older ones are pruned automatically (by mtime).
- The runnable binary **stays in `build/`** — the game resolves its config dir
  **relative to the executable** (`AppOptions` reads `argv[0]`'s parent), and
  `build/configs/` holds the dest-only `version_build.yaml` (build number +
  timestamp) plus the live configs the CMake POST_BUILD step populates. The root
  snapshot is a rotating history/quick-access artifact, not a standalone run target.
- **Launch the newest snapshot any time with the root `./runGame` script.** It
  finds the most recent `dogmax-*` and execs it from `build/` **with
  `--config-dir=<repo>/build/configs`** — because config resolution is
  exe-relative, a root snapshot would otherwise read the source `configs/` (no
  `version_build.yaml`) and the version HUD would show `v0.1.0` with no timestamp.
  (Playing from the build tree directly still works too: `(cd build && ./dogmax)`.)
- Rotation is enforced by `./bt` (`stamp_build`), which runs on every
  dogmax-producing build (`./bt`, `./bt dogmax`). Always build through
  `./bt` so the snapshot is taken; do not hand-roll a bare `cmake --build` that
  skips it.

## Commits

- Every commit must include a comprehensive message describing **what** changed and **why**.
- Message format: a short imperative subject line, then a blank line, then a body with context and motivation.
- Never commit with vague messages like "fix", "update", or "wip".

## Core Code Principles

- **KISS (Keep It Simple, Stupid)**: Choose the most straightforward, linear
  solution. Do not abstract code prematurely or write "clever" one-liners.
- **DRY (Don't Repeat Yourself)**: Avoid copy-pasting logic, but apply the Rule
  of Three — only refactor into a shared function if the exact same code
  appears in 3 or more distinct places.
- **YAGNI (You Ain't Gonna Need It)**: Write code only for the current,
  immediate requirement. Do not add boilerplate, "future-proofing," or
  placeholders for features down the road.

## Clean Architecture

- **RoC (Rule of Least Surprise)**: Write code that behaves exactly how a
  developer expects it to. Do not use hidden side-effects, unconventional
  naming, or bizarre workarounds.
- **SoC (Separation of Concerns)**: Keep modules focused — each file, class,
  function, and module has exactly one reason to change. A rendering system
  should only handle drawing things; a physics system should only handle
  movement. Do not mix responsibilities; if a unit does more than one thing,
  split it.
- **Crash Early (Fail-Fast)**: Do not hide errors with silent catch-all blocks.
  If an asset fails to load or a parameter is invalid, let the program log
  clearly and crash immediately during development.

## AI Workflow Boundaries

- **Incremental Steps**: Make one functional change, compile it, test it, and
  verify it works before touching any other code.
- **Diffs Only**: Do not rewrite or replace a whole file if you only need to
  change a few lines of code. Use precise, targeted edits.

## Configuration & Variables

- Every configuration value, tunable parameter, and externalized variable (including URLs, timeouts, feature flags, game balance constants, thresholds, and credentials) must be represented in a dedicated `*.yaml` file under `configs/`.
- Hard-coding values or defining configuration constants within source code is strictly forbidden.
- The game and application modules must exclusively read from these configuration files to access and utilize these values. Source files consume configuration; they never define or default it internally.
- Config files use flat YAML mapping format: one `KEY: value` pair per line, `#` for full-line comments. No nested structures.
- **Flat file content, but the directory has sub-directories** — and each is
  loaded by a different call site. `dof::loaders::ConfigLoader::loadDirectory`
  uses `std::filesystem::directory_iterator`, so it is **non-recursive**: it
  reads only the top-level `configs/*.yaml`. Sub-directories are opt-in merges:
  - `configs/effects/` — merged into the same flat keyspace by a second
    `loadDirectoryPreservingOverrides` call (`GameSession_Setup.cpp`). Its files
    carry unique `EFX_*` / `CEF_*` / `LEF_*` prefixes so the merge never collides.
  - `configs/anim/` — hero skeletal-animation clips, same merge pattern with
    unique `ANM_*` prefixes, loaded before the `WorldRenderer` ctor. **The load
    site exists but the directory does not yet** (it is `exists()`-guarded), so
    creating `configs/anim/*.yaml` is all it takes to activate it.
  - `configs/enemies/` — **not** read by `ConfigLoader` at all. It is a separate
    per-entity registry loaded by `EnemyTemplateRegistry::loadDirectory`, pointed
    at by the `ENEMY_TEMPLATE_DIR` key in `configs/enemy.yaml`.
  A new sub-directory therefore does nothing until a load call is added for it.

## Rebuild Context & Legacy Configs — reference only, never inherit

- This codebase is on its **4th from-scratch rebuild** (restart #4, 2026-06-10).
  Earlier rewrites were abandoned for a bad UI design and then for rushing
  un-testable headless code. The prior build's `src/` + `tests/` were wiped; the
  whole prior tree is preserved twice as an **adviser** for open questions — on
  the remote-only `backup-rebuild-4` git branch, and on disk under
  `archive/legacy-rebuild/` (`src/`, `assets/`, `configs/`, `third_party/`, its
  own `CMakeLists.txt`, and `rebuild_cards.yaml`).
- Archived tuning is **not** loaded by the app. It moved from `backup/` to
  `archive/` in the 2026-07-07 archive consolidation (`c2716e3`) — **`backup/`
  no longer exists**; every path below is the live one. Two layers under
  `archive/legacy-rebuild/legacy-configs/`: `*.config` at that level (26 files,
  the oldest pre-rewrite tuning) and `rebuild3/*.config` (the 29 configs of the
  wiped build — palette hues, XP/level/luck curves, drop weights, quality
  thresholds, etc.). A **third** archive sits outside that tree at
  `archive/legacy-rebuild/configs/*.config` — 27 configs frozen by a 2026-06-12
  reorg commit; a distinct snapshot with its own filenames and values, not a
  copy of either `legacy-configs/` layer. The prior `kanban.yaml` is at
  `archive/legacy-rebuild/kanban/kanban-rebuild3-2026-06-10.yaml`; the retired
  restart-#4 kanban is at `archive/kanban/kanban.yaml` — both are dead history,
  see "Source of Truth" below.
- Those archived files are a **reference to MINE for ideas, never an authority to
  copy** — and **interpretation is allowed/expected**. A number existing in an
  archive is **not** a reason to use it: it was tuned for a rejected design under
  old constraints. Anything promoted into the live `configs/` must be
  **re-evaluated and re-authored deliberately** against the current design; look in
  both archive layers for a better idea, then re-judge.
- `configs/` **started empty at restart #4** and is populated incrementally: only
  what the live app actually consumes belongs there; each task authors the config
  it needs fresh from `GameDesign.md`, pulling reference values from the archives
  only after re-judging them. It now holds ~51 top-level `*.yaml` plus the
  `effects/` and `enemies/` sub-directories described above.
  (`dof::loaders::ConfigLoader` reads only the live `configs/` directory — never
  `archive/`.)
- **UI toolkit: settled as bespoke SFML** (R3-01 decision, 2026-06-07), the
  `ui::` namespace under `src/render/ui/` — under active development, not RmlUi.
  The prior rebuild used **RmlUi**, and that was part of what failed (its GL2
  path blocked gradients and shadows); RmlUi was dropped, not revived. Any
  RmlUi-shaped value in a legacy config — e.g. the old `*_RENDERER=rmlui` flags —
  reflects the abandoned build and carries **no weight** for anything live.

## Rule Violations — Correct Immediately

- Before touching any file, check whether it already violates a rule (mixed responsibilities, hard-coded config, unclear naming, etc.).
- If a violation is found, fix it in the same commit — do not defer it.
- Never leave a codebase in a state where a known rule violation exists.

## Bugs — Resolve Immediately

- Every bug must be resolved the moment it is discovered — never deferred,
  shelved, worked around, or filed for "later".
- This applies to any bug surfaced from any source: a failing bug-triggered test
  (see "Tests" below — there's no standing suite, but an existing regression test
  can still fail), a crash, a user report, or a defect noticed in passing while
  doing unrelated work.
- A bug found mid-task is fixed in the same commit (or its own immediately
  preceding commit) — the working tree is never left with a known bug in it.
- If a bug cannot be fixed instantly (genuinely blocked — missing dependency,
  ambiguous spec, needs a user decision), it is the single highest priority:
  surface it to the user at once and treat it before resuming any lower-priority work.

## Tests — strict TDD (REVERSED on 2026-08-20)

**This section previously said the exact opposite** — "a test is written only
when a bug is found, no exceptions; no standing test suite, test target, or
testing framework is maintained". That rule is **revoked**.

The project adopted the dogV6 TDD + Oracle protocol. `AGENTS.md` is now the
binding authority and it mandates the inverse:

- **No production code without a failing test first** (Rule 1). A bug gets a
  reproduction test that fails before the fix; a feature gets its spec, tests and
  observed failure before any implementation.
- **Every feature has a spec** at `docs/tdd/<feature>.tdd.md` (Rule 2), advanced
  through SPECIFY → RED → GREEN → REFACTOR → RECORD (Rule 3).
- **A standing suite IS maintained**: doctest under `tests/`, built by the
  `DOGMAX_TESTS` CMake option, run through CTest.
- **Quality gate before every commit**: `./verify` (Rule 14) — build the tests
  with warnings-as-errors, run the full headless suite, then build the release
  binary.

Tests written before the reversal date are characterisation tests for legacy
code, not TDD, and are labelled as such in the files themselves. Rule 1 binds
work from the adoption date forward.

Read `AGENTS.md` and `ORACLE.md` before writing code. Where this file and those
two disagree, **they win** — this file carries project facts, not authority.

## Naming

- Names must be clear, precise, and self-documenting at every level: files, directories, namespaces, classes, functions, and variables.
- Abbreviations are forbidden unless they are universally understood in the domain (e.g. `id`, `url`).
- Boolean names must start with `is`, `has`, `can`, or `should`.
- Function names must start with a verb that describes the action performed.

## Source of Truth — Git Commits + `docs/`

Two layers, no overlap. **Git commits are the source of truth for
implementation** — what the code actually does, and why it got that way.
**`docs/` is the source of truth for direction** — what the game is trying to be
and what is worked next. `CURRENT_GAME_STATE.md` states the split itself:
*"Git history remains the authority for exact implementation details."*

Every piece of implementation work is captured entirely in the commit history:
- The commit subject names the task.
- The commit body records what changed and why.
- The commit hash is the permanent identifier for that unit of work.

The direction layer (added 2026-07-07 in `1ee144f`, kept deliberately small):

| Doc | Holds |
|---|---|
| `docs/CURRENT_GAME_STATE.md` | short factual snapshot of what dogmax is today |
| `docs/ROADMAP.md` | **one** active product goal at a time — not a kanban replacement |
| `docs/GAME_PILLARS.md` | the non-negotiables the game is built around |
| `docs/TARGET_EXPERIENCE.md` | what a session should feel like |
| `docs/DECISIONS.md` | settled decisions + their reasoning (append-only log) |
| `docs/FEATURE_SPECS/*.md` | per-system specs: world, combat, enemies, loot, ui, audio, progression |

Read the direction docs before starting product work; update them **only** when
direction actually changes, never as routine bookkeeping. `GameDesign.md` (242K)
remains the deep design reference behind them.

**Kanban is dead.** `kanban.yaml` is no longer maintained and must not be read,
written, or consulted by the AI (retired in `5b7a869`). The files still on disk
under `archive/kanban/` and `archive/legacy-rebuild/kanban/` are frozen history —
finding them is not permission to use them.

**"Work the task list" protocol** (when the user says "work the todo list", "work
the task list", or any equivalent):
1. The user states what to work on (in conversation or by pointing at a list/notes).
2. Report a terse numbered list of tasks with scope before touching any code.
3. Treat each task end-to-end (code + build verification), then commit.
4. Work the list in order, one task at a time, finishing each before starting the
   next. Commit per task = clean at every boundary. Keep going until the list is
   empty or a task hits a genuine blocker.

## Working Style — single agent, small slices

**One agent owns the session.** The multi-agent workflow this file used to
mandate — many peer agents running in parallel worktrees, fanning out by
default — is **retired**. It was a bad practice here: it produced more merge
surface, more review load, and more half-finished branches than it produced
working game.

The posture now:
- **One active product goal at a time** (`docs/ROADMAP.md` holds it), and one
  small, coherent implementation slice inside that goal.
- Prefer one player-visible improvement per session, one verification path, and
  a doc update only when direction actually changes.
- Keep scope small unless the user explicitly asks for a bigger pass.
- **FIFO on user tasks.** If a new task arrives while earlier ones are
  unfinished, finish the older ones first, then take the newest.
- Treat "after this", "later", "next time" as a **deferred** task, not
  permission to start it now. Finish and report the active task, then wait.
- For a non-trivial task, restate the goal, the intended small scope, and any
  tradeoff that affects the owner before starting.
- Optimize for the owner's clarity and overview, not for throughput. The owner
  has limited daily time on this project.

**Subagents are still allowed — one agent fanning out is fine.** They are a tool
this agent may reach for, not a mandate:
- Use them when the work genuinely splits into disjoint pieces, or for
  read-only investigation that would burn main context. Not by default.
- No cap when you do fan out — spawn as many as the work naturally divides into.
- **Hard constraint, unchanged**: subagents must never overlap. Assign each an
  explicitly disjoint scope (files, directories, or class hierarchies) and write
  that scope into its prompt. Two agents editing the same file corrupt the tree.
- If a task cannot be split without overlap, do it yourself, sequentially.
- What is retired is *peer agents working the project in parallel*, not the
  Agent tool.

### Shared orientation briefing — dispatcher runs discovery ONCE

Applies **when you do fan out** (see above — fan-out is optional now, but this is
how to do it well). Cold-starting graphify + file reads inside every agent
repeats the same discovery N times. The dispatcher does it **once**, up front,
and hands each agent a ready scope so agents skip orientation and go straight to
editing.

Before fanning out:
1. Run the graph **once** for the whole task (`retrieve`, or `community_overview`
   / `impact` as fits) — one call, not one per agent.
2. Write a per-agent briefing file to the scratchpad
   (`$CLAUDE_JOB_DIR/tmp/brief-<agent>.md`): its disjoint file/dir scope, the
   exact symbols/lines it owns, and the one-line goal. Disjoint scopes come from
   the single graph pass, so they are guaranteed non-overlapping.
3. Each agent's prompt names **only** its briefing file — the agent reads that,
   not the graph. Its exploration budget (1 graphify + ≤2 reads) is spent only
   if the brief is insufficient, not by default.

This turns N cold orientations into 1 shared pass; per-agent startup drops to a
single file read.

## Worktree Merge-Back — mandatory after every worktree task

Worktrees are now the exception rather than the norm (single-agent working style
— see "Working Style" above), but the rule is unchanged when one is used: after
finishing work in a worktree, **run `/cu`** before the task is considered done.
This is not optional and must never be deferred.

`/cu` handles everything: enqueuing in the merge queue, waiting for turn, building,
testing, merging with `--no-ff`, pushing, and cleaning up the worktree. The merge
queue (`.claude/MERGE_QUEUE`) ensures only one agent merges at a time — never
corrupt each other's work.

A Stop hook in `.claude/hooks/auto-merge-on-stop.sh` also fires automatically when
a session ends inside a worktree: it enqueues the branch and launches `/cu` in the
background. Manual invocation is still preferred because `/cu` needs Claude
intelligence for conflict resolution; the hook is a safety net.

**Conflict resolution rule** (applies inside `/cu`): always preserve _both_
developments. Understand what the conflicting lines do in each branch before
resolving. Never blindly `--ours` or `--theirs`. If a conflict is between two
completed features, keep both; if between a finished feature and one in progress,
keep the finished feature intact and integrate the in-progress work around it. Read
the commit messages on both sides (`git log --oneline origin/main..HEAD` and the
reverse) before resolving.

## Project Slash Commands — `.claude/commands/`

Four project-local commands. They are project behaviour, not personal aliases:

| Command | Does |
|---|---|
| `/cu` | worktree merge-back — the mandatory flow described above |
| `/next` | resume from the latest direction docs and continue the current product goal |
| `/q` | quick question: answer only, no action taken |
| `/qa` | Q&A: answer only, never change or create anything |

`/q` and `/qa` are **read-only contracts** — when the user invokes them, answer
and stop. Do not edit, build, or commit, however obvious the fix looks.

## `AGENTS.md` — Codex guidance, same posture

`AGENTS.md` at the repo root is guidance for **Codex**, not Claude, and it is
where the single-slice working style was written down first (2026-07-19). As of
2026-08-05 this file adopted the same posture on the owner's instruction, so the
two no longer conflict: single agent, small slices, FIFO tasks, no default
parallel agents.

`AGENTS.md` remains shorter and Codex-specific (request classification, its own
verification rules). `CLAUDE.md` (this file) stays authoritative for Claude Code
and carries the project facts both tools rely on. When the working style
changes, change **both** — a divergence between them is a bug, not a design.

## Phase-Completion Protocol

Kanban is retired, so the trigger is now doc-based: run this protocol when the
**active product goal in `docs/ROADMAP.md` is finished** and before picking up
the next one — in order, each step finishing before the next:

1. **Full-folder audit.** Scan the **entire project folder** — source code,
   `configs/`, `assets/`, everything — for bugs and incoherences. This is the one
   place fan-out earns its keep: a read-only audit splits cleanly, so dispatching
   subagents with disjoint slices (no overlapping files/areas) is the right call
   here. **Fix everything they surface** in this same pass, yourself, in the main
   session — verify each finding against the source first, subagent "bugs" are
   often false positives (see prior deep-scan lessons). Do not defer fixes.
2. **Regenerate graphify.** Re-run the knowledge-graph generation (`graphify-ts
   generate src`, scoped to `src/` — not `.`) so the graph reflects the new code.
   The MCP server auto-reloads.
3. **Update the durable record.** Refresh `docs/CURRENT_GAME_STATE.md` (it carries
   an `Updated:` date — bump it), advance the `Now` section of `docs/ROADMAP.md`,
   append to `docs/DECISIONS.md` if anything was actually decided, and refresh the
   `MEMORY.md` index plus any affected memory files. No kanban update — git
   history plus `docs/` is the record.
4. **Hand off to a fresh session, carrying the context forward.** After 1–3 are
   done, start a new session but preserve continuity: the docs written in step 3
   ARE the handoff (that is exactly what `/next` reads), so the next context
   window resumes where this one ended. A finished goal is the right place for
   this reset — it never interrupts work in flight.

## graphify-ts

IMPORTANT: This project has a graphify-ts knowledge graph. You MUST follow these rules:

The server is pinned in `.mcp.json`: `@mohammednagy/graphify-ts@0.20.0`, serving
`graphify-out/graph.json` with `GRAPHIFY_TOOL_PROFILE: core`. **The `core`
profile exposes exactly six tools** — the list below is the whole set. Anything
not listed does not resolve (`relevant_files`, `feature_map`, `risk_map`, and
`implementation_checklist` were mandated here until 2026-08-05 and never
existed under this profile; changing the profile in `.mcp.json` is the only way
to get more).

1. **BEFORE answering ANY codebase question**, start with the graph tool that matches the question:
   - `retrieve` for "how does X work?" and other direct codebase questions — the default
   - `impact` for "what breaks if I change X?"
   - `call_chain` for "what path connects A to B?"
   - `community_overview` for "what parts of the codebase are involved?" / orientation
   - `graph_stats` for size + shape of the graph
   - `pr_impact` for the blast radius of a diff
2. **Do NOT use Glob, Grep, Bash, Read, or dispatch Agent/Explore subagents first** for codebase questions.
3. **Only fall back to raw file tools** if the graph tools cannot answer the question or the MCP server is unavailable. In that case, read graphify-out/GRAPH_REPORT.md first.
4. **Do NOT dispatch Explore or research agents** for codebase questions — the knowledge graph already has the structural context they would spend tokens discovering.
5. **1-call cap**: if the graphify call hasn't produced a usable answer, fall back to raw file tools immediately — do not chain a second graph call.

## Agent Speed — mandatory

These rules exist to prevent agents spending 10+ turns on exploration and build overhead:

### Build
- **Always use `./bt`** from project root instead of raw `cmake` chains.
  - `./bt dev` — **fast iteration loop** (build-dev/, `-O1 -g0`, no debug info →
    max ccache hits, no snapshot). Use this for the edit→build loop.
  - `./bt` — release build (build/); stamps the `-O3` debug snapshot. Use before
    a commit / for the dated artifact.
  - `./bt <target>` — build one target only
- **Never rebuild from scratch** (`cmake -S . -B build`) unless CMakeLists.txt changed. Incremental build is default.
- **After a `configs/` or `assets/` edit, just build** — `./bt`'s `sync_runtime`
  mirrors both into the build dir, deleting stale files and preserving the
  generated `build/configs/version_build.yaml`. A manual
  `cp -r configs assets build/` is only for re-running `build/dogmax` *without*
  rebuilding; it merges instead of mirroring, so deleted files survive it.
- **`./bt` launches the game.** A plain `./bt` ends in `launch_release`, which
  opens a visible window on the user's desktop. Use `DOGMAX_NO_AUTORUN=1 ./bt`
  when you only want to compile.
- **Don't compile for non-game-file changes.** A change that touches only
  non-game files never affects the binary, so skip the build (and the snapshot
  stamp) entirely. Game-application files are `src/`, `include/`, `assets/`,
  `configs/`, `cmake/`, `third_party/`, `CMakeLists.txt`, and any `*.cmake`;
  everything else — `.claude/`, docs, `*.md`, `.gitignore`, the `bt`/`runGame`
  tooling — is non-game. `/cu` enforces this automatically (it builds only when
  the merge touches a game file); apply the same judgment to manual per-task
  build verification.

### Subagent selection — pick the cheapest tool that fits
Same tier table as "Agent Model" at the top of this file — that table is the one
source of truth for which tool/model/effort a task class gets; this is a
pick-the-tool cheat sheet, not a second copy to keep in sync:
- **1-2 file surgical edit** → `cavecrew-builder`, not a full `Agent`. Saves cold-start cost.
- **Code search / symbol location** → `cavecrew-investigator`, not `Explore`. ~60% fewer tokens returned.
- **Diff / file review** → `cavecrew-reviewer`.
- **Full `Agent`** only when the task spans 3+ files or needs judgment.
- **Verify / adversarial / final done-gate / conflict resolution** → full `Agent` at the mandatory floor — never downgrade.

### advisor() — skip when the next step is obvious
Call `advisor()` **only** when:
- Design decision is ambiguous (two valid approaches, tradeoffs not clear).
- Task touches 3+ files and the interaction is non-trivial.
- You are about to declare done on a multi-step task.

**Skip** `advisor()` for: single-file bug fixes, config changes, mechanical renames, or any task where the next action is dictated directly by a compiler error.

### Exploration budget
- Max **1 graphify call + 2 file reads** for orientation before writing code. If that isn't enough, pick the most likely file and start — wrong guesses are cheaper than extended discovery.
- Never read more than 3 files to understand context before acting. Act, then correct if wrong.
