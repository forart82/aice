# AICE Architecture: 2-Pillar Unified Context & Mutation Engine

> **Status**: Official Technical Architecture Specification  
> **Target Runtimes**: Node.js 22/24+, Bun 1.4+, TypeScript 5.8+  
> **Supported Targets**: 20 Languages & 33 File Extensions  
> **Author**: [@forart82](https://github.com/forart82)

---

## 1. Architectural Blueprint: The 2-Pillar Unified Engine

AICE (AI Context Engine) replaces fragmented, multi-tool AI coding agent interactions with a streamlined, **2-Pillar Unified Architecture**:

1. **Pillar 1: Unified Read (`aice context` / `aice outline`)** — A single, token-bounded inspection pipeline splitting exact symbol resolution (`In-RAM AST` $\to$ **Adaptive Sibling Outlining** $\to$ pruned dependency contracts & callers) from fast-path search & line ranges (`/regex/` **4-Tier Search Ranking** and `Lstart-Lend` bypassing AST & outlining directly to output).
2. **Pillar 2: Unified Write (`aice splice` / `aice write`)** — A single, multi-mode mutation pipeline combining **Greenfield Auto-Creation**, **Lossless Surgical CST/AST/Hunk/Range Splicing**, and **Guarded Full-File Overwrite**, gated by differential pre-write syntax validation, transactional `spliceBatch` rollback, and atomic `.tmp` $\to$ `rename` disk commits (`aice write` $\equiv$ `aice splice`).

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                         AICE 2-PILLAR UNIFIED ARCHITECTURE                                          │
├──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│                  PILLAR 1: UNIFIED READ                  │                 PILLAR 2: UNIFIED WRITE                  │
│              (aice context / aice outline)               │                (aice splice / aice write)                │
├──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │             Incoming Inspection Request              │ │ │              Incoming Mutation Request               │ │
│ │ (Class.method, @first, TC-id, Lstart-Lend, /regex/)  │ │ │ (new file, CST/AST/hunk/range splice, or overwrite)  │ │
│ └──────────────────────────┬───────────────────────────┘ │ └──────────────────────────┬───────────────────────────┘ │
│                            ▼                             │                            ▼                             │
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │             Selector & Fast-Path Router              │ │ │                Target Existence Check                │ │
│ └──────────────────────────┬───────────────────────────┘ │ └──────────────────────────┬───────────────────────────┘ │
│              ┌─────────────┴──────────────┐              │                   ┌────────┴───────────────────┐         │
│              ▼                            ▼              │                   ▼                            ▼         │
│ ┌─────────────────────────┐  ┌─────────────────────────┐ │ ┌──────────────────────────────────┐  ┌────────────────┐ │
│ │ Exact Symbol Path       │  │ Fast-Path Search/Ranges │ │ │           File Exists?           │  │ File Missing?  │ │
│ │ Class.method, @1, TC-id │  │ /pattern/, Lstart-Lend  │ │ └─────────────────┬────────────────┘  └────────┬───────┘ │
│ │ In-RAM AST Decompiler   │  │ Bypasses AST & Sibling  │ │                   ▼                            ▼         │
│ │ (+ numbered fallback)   │  │ Outlining (depth=0)     │ │ ┌──────────────────────────────────┐  ┌────────────────┐ │
│ └────────────┬────────────┘  └────────────┬────────────┘ │ │    Selector or Hunk Present?     │  │ Auto-Create    │ │
│              ▼                            ▼              │ └─────────────────┬────────────────┘  │ Parent Dirs &  │ │
│ ┌─────────────────────────┐  ┌─────────────────────────┐ │         ┌─────────┴────────┐          │ Greenfield     │ │
│ │ Adaptive Sibling        │  │ 4-TIER RANKING          │ │         ▼                  ▼          │ File           │ │
│ │ Outlining               │  │ Tier 1: Defs            │ │ ┌───────────────┐  ┌───────────────┐  └────────┬───────┘ │
│ │ max 20 syms / ~150 tok  │  │  +1000 file / +500 decl │ │ │ Yes: Surgical │  │ No: Guarded   │           │         │
│ │ "(+ N other methods)"   │  │ Tier 2: Code +300       │ │ │ CST/AST/Hunk/ │  │ Full-File     │           │         │
│ └────────────┬────────────┘  │ Tier 3: Comments +100   │ │ │ Range Splice  │  │ Overwrite     │           │         │
│              ▼               │ Tier 4: Test/Mock 10–50 │ │ └───────┬───────┘  └───────┬───────┘           │         │
│ ┌─────────────────────────┐  └────────────┬────────────┘ │         └──────────────────┼───────────────────┘         │
│ │ Pruned Dependency Pack  │               │ (direct)     │                            ▼                             │
│ │ Contracts & Callers     │               │ depth=0      │ ┌──────────────────────────────────────────────────────┐ │
│ │ [L14] (unused pruned)   │               │              │ │        Pre-Write Syntax Gate & Batch Rollback        │ │
│ └────────────┬────────────┘               │              │ │    (validateNativeSyntax + spliceBatch rollback)     │ │
│              └─────────────┬──────────────┘              │ └──────────────────────────┬───────────────────────────┘ │
│                            ▼                             │                            ▼                             │
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │         70–90% Token-Savings Context Stream          │ │ │   Atomic .tmp -> rename Commit (Zero .aice files)    │ │
│ └──────────────────────────────────────────────────────┘ │ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 2. Pillar 1: Unified Read Engine (`aice context` & `aice outline`)

The **Unified Read Engine** is engineered to replace blind `ls`, `grep -n`, `grep -rn`, `sed -n`, and monolithic full-file reads with precision-targeted, token-economized context extraction directly in RAM.

### 2.1 Adaptive Sibling Outlining

When an AI coding agent requests a specific symbol (e.g. `GameEngine.tick`, `AuthService.login`, or `UserRepository.find`), providing only the isolated method body leaves the agent blind to adjacent helper methods, leading to duplicate implementations or awkward architectural seams. Conversely, dumping the full parent class floods the context window.

**Adaptive Sibling Outlining** resolves this dilemma dynamically:

1. **Enclosing Entity Detection**: When resolving a symbol member inside a class, interface, struct, or namespace, AICE automatically parses the enclosing entity's AST span in RAM.
2. **Sibling Extraction**: All sibling methods, properties, and signatures are collected into a lightweight, one-line-per-member outline appended directly below the target symbol's body.
3. **Anti-Bloat Guardrail**: To prevent "God Class" pollution (e.g. classes with 100+ methods), the sibling outline enforces strict hard bounds:
   - **Maximum symbols**: Capped at **20 symbols**.
   - **Maximum token budget**: Capped at approximately **150 tokens**.
   - **Truncation Notice**: If siblings exceed these thresholds, AICE gracefully appends `(+ N other methods)` to signal omitted siblings without overflowing context.

#### Output Example:
```typescript
// Target Symbol Body
public step(deltaMs: number): void {
  this.tickCount += 1;
  this.updatePhysics(deltaMs);
}

// Adaptive Sibling Outline (guarded at 20 symbols / ~150 tokens)
// Siblings in GameEngine:
//   - constructor(config: EngineConfig)
//   - init(): Promise<void>
//   - updatePhysics(dt: number): void
//   - render(): void
//   - reset(): void
//   (+ 14 other methods)
```

### 2.2 4-Tier Search Ranking & Noise Suppression

When scanning directories or codebases using regex or substring selectors (`aice context src -s "/RiskEngine/"`), raw grep tools return dozens of irrelevant matches scattered across mock generators, test fixtures, docstrings, and temporary test files.

AICE incorporates an automated **4-Tier Target Prioritization Engine** that scores and sorts candidate match windows:

| Tier | Priority Level | Category & Criteria | Base Score |
| :--- | :---: | :--- | :---: |
| **Tier 1** | **Top Priority** | **Production Declarations & Filename Resonance**<br>Primary definition sites (`class`, `interface`, `function`, `type`, `enum`, `fn`, `def`, `pub`, `export`, etc.) in production source code, boosted by direct filename-query resonance (`+1000 pts`). | **1,500+ pts** |
| **Tier 2** | **High Priority** | **Production Executable Code**<br>Active logic, call-sites, assignments, and expressions in production source code. | **300–1,300 pts** |
| **Tier 3** | **Medium Priority** | **Production Comments & Documentation**<br>Docstrings, markdown documentation, and inline comments within production files. | **100 pts** |
| **Tier 4** | **De-Prioritized** | **Tests, Mocks & Test Fixtures**<br>Matches residing in `tests/`, `__tests__/`, `mocks/`, `fixtures/`, or matching `*.test.*` / `*_spec.*`. Suppressed unless the query is an explicit test search. | **10–50 pts** |

#### Scoring Weight Formulation:
```
Score = FileNameBonus + LineCategoryScore + LineTieBreaker

Where:
  FileNameBonus:
    - Production file matching query keyword: +1000
    - Test / Mock file matching query keyword: +20
    - Otherwise: 0

  LineCategoryScore (Production Path):
    - Has Declaration (class, fn, interface, export, etc.): 500
    - Has Executable Code: 300
    - All Comments / Docstrings: 100

  LineCategoryScore (Test/Mock Path):
    - Has Declaration: 50
    - Has Executable Code: 30
    - All Comments: 10

  LineTieBreaker:
    - max(0, 10 - startLine / 100)  [Favors earlier declarations in file]
```

### 2.3 Pruned Dependency Contracts & Downstream Callers

For any inspected symbol, AICE automatically traverses imports and references:
- **Symbol-Scoped Unused-Import Pruning (`currentDepth === 0`)**: At hop `0` of dependency BFS, when a symbol selector is active, AICE filters imported specifiers against whole-word identifiers actually referenced in the sliced `targetContent`, dropping unused imports and unreferenced module contracts entirely (and skipping circular self-imports).
- **Deduplicated Dependency Contracts**: Merges exported type signatures and contracts from referenced modules into a single deduplicated header.
- **Downstream Callers**: Detects call-sites across the project and surfaces caller locations with exact line indicators (`[L14]`), allowing the agent to understand upstream ripple effects before modifying code.

### 2.4 Fast-Path AST Bypass & Numbered Native Fallback

To guarantee low latency and resilience across arbitrary real-world repositories:
- **Fast-Path AST Bypass (`Lstart-Lend`, `/regex/`, `>50 KB` Symbol Queries)**: Pure line-range selectors (`Lstart-Lend`), pure `/regex/` queries (when not matching `$idiom` macros), and symbol queries on large files (`>50 KB`) skip full-file In-RAM AST decompilation, syntax diagnostics, and sibling/file outlining. Fast-path `/regex/` and `Lstart-Lend` selectors also default `depth` to `0`, routing ranked windows or numbered line slices directly into the context stream.
- **Numbered Native Fallback on Parser Error**: If the In-RAM decompiler or foreign-language symbol extractor encounters broken or unsupported syntax on an exact symbol query, AICE never aborts the read turn — `buildFallbackNativeSlice` locates the native declaration span (`locateNativeDeclarationSpan`) and returns a clean `N│ ` line-numbered native source slice.

---

## 3. Pillar 2: Unified Write Engine (`aice splice` / `aice write`)

The **Unified Write Engine** eliminates the friction of choosing between different file modification commands (`write_file`, `edit_file`, `create_file`, custom patch scripts). Under the universal command **`aice splice`** (and its identical alias **`aice write`**), mutations are handled deterministically across all states of the codebase.

### 3.1 Greenfield Auto-Creation

When an agent needs to create a new file, it no longer needs a separate creation command:
1. **Target Detection**: AICE checks if the destination file path exists on disk.
2. **Recursive Directory Synthesis**: If the target does not exist, AICE automatically creates all necessary parent directories (`mkdir -p` semantics).
3. **Greenfield Compilation**: The provided code payload is compiled, syntax-checked, and written atomically to disk.
4. **Consistency**: Greenfield creation works identically whether invoked as `aice splice path/to/new.ts -c "..."` or `aice write path/to/new.ts -c "..."`.

### 3.2 Lossless Surgical AST Splicing (<50% Changes)

For modifications to existing files, AICE uses Concrete Syntax Tree (CST) Trivia Lenses and AST parsers to replace only the targeted subtree:
- **Symbol Targeting**: Target methods, classes, first actionable symbol (`@first` / `@1`), or test blocks (`-s "Class.method"`, `-s "TC-MENU-001"`).
- **AST-Scoped Hunks**: Patch targeted lines within a symbol using `<<< / === / >>>` blocks, immune to surrounding line shifts.
- **Line Ranges**: Splice numbered line ranges (`-s "L35-L42"`), automatically stripping `35│ ` gutter prefixes.
- **Heading Replacement**: Update Markdown sections cleanly by heading (`-s "Quick Start"`).
- **Imports & Appends**: Splicing `:imports` merges top-level module imports; splicing `:eof` appends safely to the end of the file.
- **Trivia Preservation**: Preserves comments, indentation, docstrings, and formatting around the modified node.

### 3.3 Guarded Full-File Overwrite (>50% Changes)

When an agent needs to completely rewrite an existing file (e.g. substantial architectural redesign or schema overhaul):
- **Selector-Free Invocation**: If the file exists and **no selector** (`-s`) or hunk (`<<<`) is provided, AICE routes through the greenfield compiler for an atomic full-file overwrite.
- **Empty-Payload Guard**: Accidental empty-string (`""`) overwrites on existing files are rejected unless explicit `--overwrite`, `--force`, `--create`, or `:overwrite` intent is provided.
- **Batch Streams**: In multi-file batch streams (`--stdin`), targeting `=== <filePath> ===` (or `=== <filePath>:overwrite ===`) signals full-file overwrite, while `=== <filePath>:<symbol> ===` signals surgical splicing.

### 3.4 Unified Multi-File Batch Stream Protocol

AICE allows agents to batch multiple creations, surgical splices, and full rewrites into a single atomic turn via `--stdin`:

```bash
aice write --stdin << 'EOF'
=== src/services/PaymentService.ts ===
export class PaymentService {
  public process(amount: number): boolean { return amount > 0; }
}
=== src/constants.ts:eof ===
export const MAX_PAYMENT_RETRIES = 3;
=== src/engine.ts:GameEngine.step ===
<<<
  this.tickCount += 1;
===
  this.tickCount += BONUS_MULTIPLIER;
>>>
=== src/legacy.ts:overwrite ===
export const DEPRECATED = true;
EOF
```

### 3.5 Universal Alias System: `aice write` $\equiv$ `aice splice`

To streamline agent ergonomics, `write` is a first-class, bidirectional alias to `splice`:
- **CLI**: `aice write ...` and `aice splice ...` execute the identical dispatch handler.
- **MCP Server**: The MCP tool `aice_write` mirrors `aice_splice` with identical parameter validation, schemas, and return structures.

### 3.6 Production Hardening, Self-Healing & Transactional Guarantees

- **`±40`-Line Shifted-Header Self-Healer (`:Lstart-Lend`)**: When a line-range splice starts with an explicit named declaration header (`export`, `function`, `class`, `def`, `fn`, `pub`, etc.) whose target line numbers shifted (or failed literal syntax validation), AICE scans a `±40`-line window (`[startLine - 40, startLine + 40]`) for a unique matching header with identical brace/paren balance, scores token overlap with distance decay, and relocates the span only if `validateNativeSyntax` passes on the candidate. Unbalanced range splices on valid files are rejected with an actionable hint to use AST-scoped `<<< / === / >>>` hunks.
- **Two-Pass `forceLosslessPreprocess` Retry**: `spliceNativeSource` executes an optimistic first pass (applying non-overlapping multi-edits bottom-to-top in reverse offset order, or sequential re-anchored resolution when spans overlap) and checks `validateNativeSyntax`; if validation fails, it automatically retries a second pass with `forceLosslessPreprocess = true` (full lossless hybrid/`$idiom` preprocessing).
- **TS/JS Sibling Auto-Import Wiring**: After splicing `.ts`, `.tsx`, or `.js` files, AICE lexically masks strings and comments, identifies newly introduced uppercase/exported identifiers missing from local scope, inspects existing relative sibling imports (`./...`, `../...`), and automatically merges any missing specifier uniquely exported by a single imported sibling (`owners.length === 1`).
- **Differential Pre-Write Syntax Gate & Transactional `spliceBatch` Rollback**: Before touching disk, `splice` runs differential `validateNativeSyntax` (plus Python duplicate-parameter checks): if the original file was valid and the mutated code introduces syntax errors (without `--force`), the write is aborted. Across `--stdin` / `--batch` streams, `spliceBatch` snapshots pre-existing files (`backups`), config/idiom caches (`aice.config.json`, `.aice-idioms.json`, `.aice-cache/idioms.json`), and `newlyCreatedFiles`, deferring telemetry until full batch completion and restoring every created/modified file and config snapshot byte-for-byte if any item fails.

---

## 4. End-to-End Execution & Memory Lifecycle

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                       END-TO-END EXECUTION & MEMORY LIFECYCLE                                       │
├─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┤
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │            Agent Tool Request (CLI / MCP)             │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                                                          ▼                                                          │
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │                Path & Sandbox Resolver                │                              │
│                              │  (workspace bounds & ephemeral telemetry isolation)   │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                                                          ▼                                                          │
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │          AICE Config Gate (aice.config.json)          │                              │
│                              │    "enabled": true (Pillar 1 | Pillar 2) vs false     │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                       ┌──────────────────────────────────┴─────────┬───────────────────────────────────┐            │
│        Enabled (Read) │                            Enabled (Write) │                          Disabled │            │
│                       ▼                                            ▼                                   ▼            │
│  ┌────────────────────────────────────────┐  ┌──────────────────────────────────────────┐  ┌──────────────────────┐ │
│  │         PILLAR 1: UNIFIED READ         │  │         PILLAR 2: UNIFIED WRITE          │  │  Native Filesystem   │ │
│  │     (aice context / aice outline)      │  │   (aice splice / aice write / create)    │  │    Tools (Bypass)    │ │
│  ├────────────────────────────────────────┤  ├──────────────────────────────────────────┤  ├──────────────────────┤ │
│  │ 1. Exact Symbol Route:                 │  │ 1. Mutation Mode Dispatch:               │  │ - Standard OS I/O    │ │
│  │   - In-RAM AST Decompiler (+ fallback) │  │   - Greenfield Auto-Create (mkdir -p)    │  │ - Zero AICE AST or   │ │
│  │   - Adaptive Sibling Outlining         │  │   - Guarded Full-File Overwrite          │  │   $idiom overhead    │ │
│  │     (<=20 syms / ~150 tok max)         │  │   - Surgical CST-AST-Hunk-Range Splice   │  └──────────────────────┘ │
│  │   - Pruned Contracts & Callers [L14]   │  │   - +-40L Range Healer & Auto-Imports    │                           │
│  │ 2. Fast-Path (/regex/, Lstart-Lend):   │  └─────────────────────┬────────────────────┘                           │
│  │   - Bypasses AST & Outlining (depth=0) │                        ▼                                                │
│  │   - 4-Tier Search Ranking              │  ┌──────────────────────────────────────────┐                           │
│  └────────────────────┬───────────────────┘  │    Differential Pre-Write Syntax Gate    │                           │
│                       │                      │   & Transactional spliceBatch Rollback   │                           │
│                       │                      │   (2-pass lossless retry + snapshots)    │                           │
│                       │                      └─────────────────────┬────────────────────┘                           │
│                       ▼                                            ▼                                                │
│  ┌────────────────────────────────────────┐  ┌──────────────────────────────────────────┐                           │
│  │  BPE Token Telemetry & Context Stream  │  │    Atomic .tmp -> rename Disk Commit     │                           │
│  │ (cl100k / o200k | 70–90% read savings) │  │    (Zero .aice files | BPE Telemetry)    │                           │
│  └────────────────────────────────────────┘  └──────────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Zero `.aice` Artifacts on Disk**: AICE operates purely in memory across all 20 languages and 33 file extensions. Decompilation, `$idiom` collapsing/expansion, and CST trivia transformations happen in RAM, emitting native source code directly to disk.
2. **Differential Pre-Write Gate & Transactional Rollback**: Every write route validates output syntax before disk mutation and rolls back multi-file `spliceBatch` streams (files + config/idiom snapshots) atomically on failure.
3. **Ephemeral Telemetry Suppression**: Operations in sandboxes (`/tmp`, `/var/tmp`, `swarm-*` worktrees) are automatically isolated to prevent test pollution of production telemetry ledgers, and batch telemetry is committed only after all items succeed.
4. **Atomic Commits**: All disk writes use randomized sibling `.tmp` $\to$ `rename` commits to guard against partial writes or corruption during interrupts.

---

## 5. Summary of Key Architectural Advantages

- **70%–85% Context Reduction**: Eliminates verbose AST syntax, curly brace boilerplate, and irrelevant test decoy matches through 4-Tier Ranking and Adaptive Sibling Outlining.
- **90%+ Edit Token Savings**: Surgical AST splicing targets exact symbols and hunks without rewriting unaffected code.
- **1-Turn Agent Workflows**: Replaces tedious file-by-file loops with unified multi-file `--stdin` and `--batch` streams.
- **Zero Tool Friction**: `aice write` and `aice splice` cover all write operations; `aice context` and `aice outline` cover all read operations.
- **Empirically Verified Across 33 Live Adversarial Agent Sessions**: Wins **10/10** multi-file 3-layer scenarios (`RW-01`..`RW-10`) plus the hostile 1-file 0-idiom `RW-11` Lone Needle scenario (`22/22` AICE runs 100% verified on disk), cutting LLM output tokens by **70.4%–87.2%**, working payload tokens by **65.9%–77.1%**, LLM turns by **70.6%–72.7%**, and real API cost by **74.4%–78.9%** (see [`BENCHMARKS.md`](./BENCHMARKS.md) and [`BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)).

