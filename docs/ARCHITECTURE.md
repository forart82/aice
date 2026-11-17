# AICE Architecture: Strict 2-Tool Surface & 2-Pillar Unified Engine

> **Status**: Official Technical Architecture Specification  
> **Target Runtimes**: Node.js 22/24+, Bun 1.4+, TypeScript 5.8+  
> **Supported Targets**: 20 Languages & 33 File Extensions  
> **Author**: [@forart82](https://github.com/forart82)

---

## 1. Architectural Blueprint: Strict 2-Tool AI Surface & 2-Pillar Engine

AICE (AI Context Engine) eliminates multi-tool cognitive load, prompt bloat, multi-turn read amplification, and stdout spillover by exposing a **Strict 2-Tool MCP Surface** (`tools/list`: strictly `["aice_read", "aice_splice"]`) paired with a **single-file `<= 650`-token `AGENTS.md` workspace rule footprint** and ergonomic CLI read/write entry points (`aice read` + `aice search`/`grep` + `aice find`/`tree` routing into `read()`, and `aice splice` / `aice write`). Every lower-level operation — 1-turn disk-numbered native reads (`--dsl` opt-in), dynamic water-filling byte/token budgeting, AST-snapped pagination, AST-aware search windows, `< 20ms` zero-AST workspace discovery, greenfield file creation, opt-in `$idiom` compression/expansion, whitespace- and brace-resilient surgical splicing, and syntax verification — is routed **automatically inside the engine**:

1. **Pillar 1: Unified Read (`aice read` / MCP `aice_read`, CLI aliases `context`, `ctx` + `aice search`/`grep` & `aice find`/`tree`)** — Single inspection entry point governed by **`resolveEffectiveReadBudgets()`** & **`computeDynamicReadBudget()`** (**`9,216 B` (`9 KB`) aligned CLI & MCP ceiling**, `8,704 B` (`8.5 KB`) soft cap, `5,000`-token ceiling / `4,600`-token soft cap; `28,672 B` / `7,000`-token programmatic fallback; `--full` / `--max-tokens` override) and **`computeDynamicSliceSpan()`** (**`6,912 B` (`6.75 KB`) CLI/MCP slice budget**, elision-aware `80..180` line spans snapped to complete top-level AST symbol boundaries; `18,432 B` / `80..650L` programmatic fallback):
   - **Default 1-Turn Numbered Native Output (`rawNative: true`, `--dsl` opt-in)**: Emits exact **1-based disk-numbered native source lines** (`<lineNo>│ <rawDiskLine>`) on **both** `:symbol` queries (all lengths, including `<= 25` lines and `> 25` lines, while preserving Adaptive Sibling Outlining, dependency contracts, and `[L14]` callers) **and** inline bare files (with **partial `9 KB` budget fill**, **same-file multi-range coalescing**, **`> 120L` Monolith X-Ray landmarks**, **`:sym@pattern` focus slicing**, and **`> 110L` blank/divider/import elision**) so agents immediately run `aice splice` without a second `:Lstart-Lend` read (`--dsl` / MCP `dsl: true` opts into AICE shorthand decompilation).
   - **AST-Aware Search (`>65L` Monolith Focus) & `< 20ms` Zero-AST Discovery**: Plain regex or auto-escaped literal searches (`aice search` / `grep`, `aice read --search`, MCP `search`) expand Tier 1 & 2 matches to complete enclosing AST declarations (`<= 40` lines), **`> 65L` monolith focus sub-windows** (signature header + merged `±5L` hit regions), or `±10` numbered native lines (`-C` / `contextLines` override) within the `9 KB` ceiling; workspace file discovery (`aice find` / `tree`, `aice read --files`, MCP `filesOnly: true`) emits `<relPath> (<lines>L, <sizeKB>KB)` in `< 20ms` with zero AST parsing, aided by **MCP-to-CLI flag normalization** in `bin/aice.ts`.
2. **Pillar 2: Unified Write (`aice splice` / MCP `aice_splice`, CLI alias `aice write`)** — Single mutation & creation entry point with internal auto-routing: missing files or `:create` targets route to greenfield `create` (recursive parent directories, passthrough formats, opt-in `$idioms`, and AICE DSL compilation); existing files with selectors or `<<<` hunks route to **Resilient Surgical CST/AST/Hunk/Range Splicing** (whitespace-resilient `<<< === >>>` hunks, **half-open `[start, end)` `:L` off-by-one guard**, `±2`-line brace-safe `:Lstart-Lend` alignment, `±5` numbered error context lines, and `maskSourceLexically` null-guards); and existing files without selectors (or `:overwrite`) route to **Guarded Full-File Overwrite**, all gated by pre-write syntax validation, transactional `spliceBatch` rollback, and atomic `.tmp` $\to$ `rename` disk commits.

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 AICE STRICT 2-TOOL / 2-PILLAR UNIFIED ARCHITECTURE                                  │
├──────────────────────────────────────────────────────────┬──────────────────────────────────────────────────────────┤
│                  PILLAR 1: UNIFIED READ                  │                 PILLAR 2: UNIFIED WRITE                  │
│  (MCP: aice_read | CLI: read + search/grep & find/tree)  │     (aice splice / MCP: aice_splice | alias: write)      │
├──────────────────────────────────────────────────────────┼──────────────────────────────────────────────────────────┤
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │                Incoming Read Request                 │ │ │                Incoming Write Request                │ │
│ │ (dir, find, search, :outline, :sym@kw, :L-R, bare)   │ │ │ (new file, CST/AST/hunk/range splice, or overwrite)  │ │
│ └──────────────────────────┬───────────────────────────┘ │ └──────────────────────────┬───────────────────────────┘ │
│                            ▼                             │                            ▼                             │
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │  Internal Read Auto-Router + MCP->CLI Flag Norm      │ │ │  Internal Write Auto-Router (create | splice | ovw)  │ │
│ └──────────────────────────┬───────────────────────────┘ │ └──────────────────────────┬───────────────────────────┘ │
│              ┌─────────────┴──────────────┐              │              ┌─────────────┴──────────────┐              │
│              ▼                            ▼              │              ▼                            ▼              │
│ ┌─────────────────────────┐  ┌─────────────────────────┐ │ ┌─────────────────────────┐  ┌─────────────────────────┐ │
│ │ 1-Turn Numbered Native  │  │ Search, X-Ray & Elision │ │ │ Auto-Create / Overwrite │  │ Surgical AST/CST Splice │ │
│ │ • N│ lines (:sym + bare)│  │ • >120L X-Ray landmarks │ │ │ • Missing file / :create│  │ • :sym, indent-safe <<< │ │
│ │ • Same-file coalescing  │  │ • :sym@kw & >65L focus  │ │ │ • Or bare :overwrite    │  │ • Half-open :L guard    │ │
│ │ • Partial 9KB fill      │  │ • >110L blank/imp elide │ │ │ • mkdir -p, AICE DSL &  │  │ • +-2L brace, +-5L err  │ │
│ │ • --dsl shorthand opt-in│  │ • <20ms 0-AST find/tree │ │ │   opt-in --idioms       │  │ • Trivia & null-guards  │ │
│ └────────────┬────────────┘  └────────────┬────────────┘ │ └────────────┬────────────┘  └────────────┬────────────┘ │
│              └─────────────┬──────────────┘              │              └─────────────┬──────────────┘              │
│                            ▼                             │                            ▼                             │
│ ┌──────────────────────────────────────────────────────┐ │ ┌──────────────────────────────────────────────────────┐ │
│ │ <=9KB CLI/MCP Water-Fill + 6.75KB 80..180L Snapped   │ │ │   Pre-Write Syntax Gate + Batch Rollback + Atomic    │ │
│ │ (28KB / 80..650L API Fallback | 0 Spill Truncation)  │ │ │     .tmp -> rename Commit (Zero .aice on Disk)       │ │
│ └──────────────────────────────────────────────────────┘ │ └──────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────┴──────────────────────────────────────────────────────────┘
```

---

## 2. Pillar 1: Unified Read Engine (`aice read` / MCP `aice_read` + CLI `search`/`grep` & `find`/`tree`)

The **Unified Read Engine** replaces blind `ls`, `find`, `rg`, `grep -rn`, `sed -n`, and multi-turn `:symbol` $\to$ `:Lstart-Lend` line hunting with one precision-targeted engine: **`read()`** (`aice read`, CLI aliases `context`, `ctx`, `aice search` / `grep`, `aice find` / `tree`; MCP **`aice_read`**).

### 2.1 Default 1-Turn Numbered Native Output, Dynamic Water-Filling Budget & AST-Snapped Slices

The AI agent invokes `aice read` (`aice_read`), `aice search` (`grep`), or `aice find` (`tree`); `normalizeReadTargets()`, `computeDynamicReadBudget()`, and `computeDynamicSliceSpan()` inspect each target in RAM:

1. **Default 1-Turn Numbered Native Output (`rawNative: true` in `read()`, `--dsl` Opt-In)**:
   - When invoked via `read()` without `dsl: true` (`--dsl`), **both** `file:symbol` queries (across all symbol lengths, including `<= 25` lines and `> 25` lines) **and** inline bare files emit **exact 1-based disk-numbered native source lines** (`<lineNo>│ <rawDiskLine>`) directly usable in `aice splice` (`<<< === >>>` hunks or `:Lstart-Lend` ranges) in **1 turn**, while preserving dependency contracts, `[L14]` callers, and Adaptive Sibling Outlining on `:Class.method` symbol reads.
   - Passing `--dsl` (MCP `dsl: true`) sets `rawNative = false` to opt into AICE shorthand decompilation; direct legacy `generateContext()` calls default `rawNative` to `false` when omitted so decompiler/lens callers remain 100% compatible.
2. **Dynamic Water-Filling Byte/Token Budget, Partial Fill & Multi-Range Coalescing (`resolveEffectiveReadBudgets()` / `computeDynamicReadBudget()`)**:
   - Enforces aligned surface-aware budgeting via `resolveEffectiveReadBudgets(options)`:
     - **CLI & MCP (`surface: "cli" | "mcp"`, default)**: `DEFAULT_CLI_READ_MAX_BYTES = 9_216` (**`9 KB`** ceiling, strictly below host `9,892 B` middle-truncation threshold), `DEFAULT_CLI_READ_SOFT_BYTE_CAP = 8_704` (`8.5 KB`), `DEFAULT_CLI_READ_MAX_TOKENS = 5_000`, `DEFAULT_CLI_READ_SOFT_TOKEN_CAP = 4_600`.
     - **Programmatic / Unbounded Fallback (`--max-tokens` / interactive `--full` / direct `aiceRead()` without CLI/MCP surface)**: `DEFAULT_READ_MAX_BYTES = 28_672` (`28 KB`), `DEFAULT_READ_SOFT_BYTE_CAP = 26_624`, `DEFAULT_READ_MAX_TOKENS = 7_000`, `DEFAULT_READ_SOFT_TOKEN_CAP = 6_500`.
   - **Smallest-First Water-Filling + Partial `9 KB` Budget Fill**: Estimates each bare file's numbered output size (`rawBytes + lineCount * 6`), allocates budget smallest-first across targets, and when an overflow target meets `remainingBytes >= 1_500 && remainingTokens >= 300`, emits as many complete numbered lines as fit inside `remainingBytes - 240` (closing any unclosed Markdown fence) with an exact `// [9 KB ... budget reached — next slice: aice read <file>:L<last+1>-L<end>]` hint instead of wasting turn 1 on a bare outline.
   - **Same-File Space-Separated Multi-Range Coalescing (`normalizeReadTargets()`)**: Automatically merges space-separated same-file selectors (e.g. `aice read src/app.ts:L10-L40 src/app.ts:L200-L230`) into one coalesced target (`src/app.ts:L10-L40,L200-L230`) so headers/contracts are emitted once and combined spans evaluate accurately.
3. **Elision-Aware AST-Snapped Dynamic Pagination (`computeDynamicSliceSpan()`) & `> 110L` Elision**:
   - Computes `computeDynamicSliceSpan(diskPath, rawSource, startLine, sliceByteBudget)` using **`DEFAULT_CLI_SLICE_BYTE_BUDGET = 6_912` (`6.75 KB`)** on CLI & MCP (with `effectiveSliceBudget = Math.min(8_000, sliceByteBudget + 1_088)` and `80..180` line cap in elision mode) vs **`DEFAULT_SLICE_BYTE_BUDGET = 18_432` (`80..650` lines)** for programmatic fallback. Snaps `endLine` to the last complete top-level AST symbol boundary so `Next slice: aice read <file>:L<start>-L<end>` never cuts a function in half.
   - **`> 110L` Blank/Divider/Import Elision (`formatLargeLineRangeWithElision()`)**: When `:Lstart-Lend` (or coalesced multi-ranges) exceeds `110` lines under budget enforcement, strips blank lines and pure decorative divider comments (`===`, `---`), and folds contiguous import blocks (`// [Lstart-Lend: N import lines folded — use :imports to expand]`) while preserving true 1-based disk line numbers (`N│ ...`).
4. **Monolith X-Ray (`> 120L`), `:sym@pattern` Focus Slicing & MCP-to-CLI Flag Normalization**:
   - **`> 120L` Monolith X-Ray (`shouldExtractInternalLandmarks()` in `outline.ts`)**: Functions/methods spanning `> 120` lines emit indented internal landmarks in `:outline` (initial local setup cluster, section banner comments, major control blocks `for`/`while`/`if`/`match`/`switch`, and key calls) so agents jump straight to the right line range.
   - **`:sym@pattern` Focus Slicing (`parseSymbolPatternSelector()` in `context.ts`)**: Extracts only the signature/setup header plus matching `±5L` sub-windows inside a giant symbol (`file.ts:bigFn@keyword`), preserving `@first`, `@1`, `@clone(...)`, and `@replace-docs`.
   - **MCP-to-CLI Flag Normalization (`normalizeCliContextFlag()` in `bin/aice.ts`)**: Normalizes MCP-style camel/kebab/boolean flags on CLI `read`/`search`/`find` (`--files-only=true`, `--filesOnly`, `--context-lines=5`, `--contextLines=5`, `--include-deps=false`, `--outlineTarget`, `-c5`, `--dsl=true`) so mixed MCP/CLI invocations never burn retry turns on `unknown option` errors.
5. **Quoted Glob Expansion & `< 20ms` Zero-AST Workspace Discovery (`aice find` / `tree` / `--files` / MCP `filesOnly`)**:
   - `normalizeReadTargets()` expands quoted globs (`"src/**/*.ts"`, `"tests/*.test.ts"`) deterministically while skipping `node_modules`, `.git`, and `dist`.
   - `filesOnly: true` (`aice find [pattern] [targets...]`, alias `tree`, `aice read --files`, MCP `filesOnly`) runs a fast `< 20ms` zero-AST filesystem scan filtered by optional glob/substring (`filePattern ?? search`), emitting compact `<relPath> (<lines>L, <sizeKB>KB)` entries within the `9 KB` ceiling (plus `--json`) without AST parsing or 15-file truncation.
6. **Zero-Envelope Fast Path (`:Lstart-Lend`, Searches, Config/Doc Files & Small Bare Files)**:
   - Line-range slices (`:Lstart-Lend`), pattern searches (`--search` / `:/pattern/`), config/doc/passthrough files (`.json`, `.yaml`, `.md`, `.css`, `.html`, `.twig`, `.sh`, etc.), and small bare files emit **only** a minimal `// === <file> ===` header + numbered native lines (`depth = 0`, `includeCallers = false`, no sibling/contract wrapper unless `--deps` or `--callers` is passed). Project `$idiom` collapsing defaults to **off** (`DEFAULT_PROJECT_CONFIG.idiomsEnabled = false`) unless `--idioms` or `"idiomsEnabled": true` is active.

### 2.2 Adaptive Sibling Outlining

When an AI coding agent requests a code symbol (e.g. `GameEngine.step`, `AuthService.login`, or `UserRepository.find`), providing only the isolated method body leaves the agent blind to adjacent helper methods, whereas dumping the full parent class floods context. **Adaptive Sibling Outlining** resolves this on symbol-scoped code reads while keeping the target body in 1-based disk-numbered native lines:

1. **Enclosing Entity Detection**: Parses the enclosing class, interface, struct, or namespace AST span in RAM.
2. **Sibling Extraction**: Appends sibling methods, properties, and signatures as one-line summaries alongside the numbered native target symbol body.
3. **Anti-Bloat Guardrail**: Capped at **20 symbols** and **`~150` tokens**, appending `(+ N other methods)` when truncated (and skipped entirely on Zero-Envelope Fast-Path slices).

#### Output Example:
```typescript
// Target Symbol Body (1-based disk-numbered native lines by default)
42│   public step(deltaMs: number): void {
43│     this.tickCount += 1;
44│     this.updatePhysics(deltaMs);
45│   }

// Adaptive Sibling Outline (guarded at 20 symbols / ~150 tokens)
// Siblings in GameEngine:
//   - constructor(config: EngineConfig)
//   - init(): Promise<void>
//   - updatePhysics(dt: number): void
//   - render(): void
//   - reset(): void
//   (+ 14 other methods)
```

### 2.3 4-Tier Search Ranking, AST-Aware Context Windows & Ergonomic `aice search` (`grep`)

When scanning directories or codebases via `aice search <pattern> [targets...]` (alias `grep`), `aice read --search <pattern>`, `aice read src -s "/RiskEngine/"`, or MCP `aice_read({ search })`:
- **Plain Regex or Auto-Escaped Literal Ergonomics**: `search` accepts plain regex OR literal patterns without requiring `/.../` wrappers (automatically escaping invalid regex syntax to literal match instead of throwing, defaulting `[targets...]` to `["."]`, and supporting `-l, --files-with-matches` for concise matching path lists).
- **AST-Aware Search Context Windows & `> 65L` Monolith Search Focus**: Instead of narrow 5-line (`±2`) peepholes that force follow-up reads, Tier 1 & Tier 2 code/declaration hits automatically inspect the enclosing AST function/method/declaration span: if **`<= 40` lines**, the match window expands to the **complete enclosing declaration (`[decl.startLine, decl.endLine]`)**; if **`> 65` lines** (and `!full && !dsl`), **`computeMonolithFocusSubWindows()`** groups hits per monolith and emits the signature header (`symStart..symStart+3`) + merged `±5L` sub-windows separated by `// ... [L...-L... skipped — N unrelated lines] ...` markers (falling back to full body when coverage `>= 65%`); otherwise it expands to **`±10` numbered native lines (`~21`-line window)**. Explicit `-C, --context <lines>` (MCP `contextLines`) overrides the radius on demand. Overlapping windows within the same file merge cleanly and respect the `9 KB` CLI/MCP stdout ceiling (`28 KB` programmatic fallback).

AICE scores and sorts candidate match windows across **4 Tiers**:

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

### 2.4 Pruned Dependency Contracts & Downstream Callers (`:symbol` & Code Context Reads, or `--deps` / `--callers`)

For symbol-scoped code queries (`file:Class.method`), code context reads, or any read where `--deps` / `--callers` is explicitly passed:
- **Symbol-Scoped Unused-Import Pruning (`currentDepth === 0`)**: Filters hop-0 imported specifiers against whole-word identifiers referenced in `targetContent`, dropping unused imports and skipping circular self-imports.
- **Deduplicated Dependency Contracts**: Merges exported type signatures and contracts from referenced modules into a single deduplicated header.
- **Downstream Callers**: Surfaces project-wide caller sites with exact line indicators (`[L14]`).

### 2.5 Fast-Path AST Bypass & `--dsl` Resilience

- **Zero-Envelope, Zero-AST `filesOnly` & Large-File AST Bypass**: `filesOnly` (`aice find` / `tree` / `--files`) skips AST parsing altogether (`< 20ms`); line slices (`:Lstart-Lend`), searches, config/doc/passthrough files, and small bare files bypass wrapper envelopes (`depth=0`, `includeCallers=false`); and `:symbol` reads on `>50 KB` files skip full-file AST decompilation for sub-50ms responsiveness.
- **Numbered Native Default & `--dsl` Fallback**: Default `read()` emits exact 1-based numbered native slices directly, and even when `--dsl` (`dsl: true`) is requested on broken foreign syntax, `buildFallbackNativeSlice` locates the native span (`locateNativeDeclarationSpan`) and returns a clean `N│ ` numbered slice.

---

## 3. Pillar 2: Unified Write Engine (`aice splice` / MCP `aice_splice`, Alias `aice write`)

The **Unified Write Engine** eliminates the friction of choosing between separate file creation, whole-file rewrite, and AST editing tools (`write_file`, `edit_file`, `create_file`, custom patch scripts). Under the single AI tool **`aice splice`** (MCP **`aice_splice`**, CLI alias **`aice write`**), the engine automatically applies greenfield `create` when creating or overwriting files and resilient surgical AST/CST `splice` when mutating existing symbols, hunks, or line ranges.

### 3.1 Greenfield Auto-Creation (Internal `create` Routing)

When an agent creates a new file or targets `:create`, `aice splice` automatically invokes the internal greenfield `create` pipeline:
1. **Target Detection & Recursive Directory Synthesis**: Detects missing destination paths and creates all missing parent directories (`mkdir -p` semantics).
2. **DSL, Opt-In `$idioms` & Lossless Native Compilation**: Expands inline `@idiom` definitions and opt-in project `$idioms` (when `--idioms` or `"idiomsEnabled": true` is set), compiles compact AICE shorthand DSL (`pub fn`, `pub class`, `from "..." import ...`) into idiomatic target code while passing valid native source and passthrough extensions cleanly, validates native syntax, and commits atomically.
3. **Unified Invocation**: Works identically via `aice splice path/to/new.ts -c "..."`, `aice write path/to/new.ts -c "..."`, `aice splice --stdin`, or MCP `aice_splice`.

### 3.2 Lossless & Self-Healing Surgical AST Splicing (<50% Changes)

When mutating an existing file with a selector (`-s`) or hunk (`<<<`), `aice splice` uses Concrete Syntax Tree (CST) Trivia Lenses, AST parsers, and boundary alignment guards to replace only the targeted subtree:
- **Symbol Targeting**: Target methods, classes, first actionable symbol (`@first` / `@1`), or test blocks (`-s "Class.method"`, `-s "TC-MENU-001"`).
- **Whitespace-Resilient AST-Scoped Hunks**: Patch targeted lines using `<<< / === / >>>` blocks; if exact whitespace misses, falls back to unambiguous dedent-normalized matching within the target file/`:symbol` span while preserving target indentation.
- **Brace-Safe Line Ranges (`:Lstart-Lend`)**: Strips `35│ ` gutter prefixes, heals `±40`-line shifted headers, auto-aligns unambiguous `±1..±2`-line brace boundary offsets, and emits `±5` numbered context lines on syntax rejection.
- **Heading, `:imports`, `:eof` & Trivia Preservation**: Updates Markdown headings cleanly, merges top-level `:imports`, appends `:eof`, and preserves surrounding comments, docstrings, and formatting.

### 3.3 Guarded Full-File Overwrite (>50% Changes)

When an agent needs to completely rewrite an existing file (e.g. substantial architectural redesign or schema overhaul):
- **Selector-Free Invocation**: If the file exists and **no selector** (`-s`) or hunk (`<<<`) is provided (or `:overwrite` is specified), `aice splice` automatically routes through the greenfield `create` pipeline for an atomic full-file overwrite.
- **Empty-Payload Guard**: Accidental empty-string (`""`) overwrites on existing files are rejected unless explicit `--overwrite`, `--force`, or `:overwrite` intent is provided.
- **Batch Streams**: In multi-file batch streams (`--stdin`), targeting `=== <filePath> ===` (or `=== <filePath>:overwrite ===`) signals greenfield creation or full-file overwrite, while `=== <filePath>:<symbol> ===` signals surgical splicing.
### 3.4 Unified Multi-File Batch Stream Protocol

AICE allows agents to batch multiple greenfield creations, surgical splices, and full rewrites into a single atomic turn via `aice splice --stdin` (or `aice write --stdin` / MCP `aice_splice`):

```bash
aice splice --stdin << 'EOF'
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

### 3.5 Strict 2-Tool MCP Surface, CLI Discovery Aliases & Backward-Compatible Dispatch

To minimize LLM schema tokens while providing zero-friction CLI ergonomics:
- **MCP Discovery (`tools/list`)**: `AiceMcpServer.getToolDefinitions()` exposes **strictly 2 tools** — `aice_read` and `aice_splice` — extending `aice_read` with optional `search` (`string`), `filesOnly` (`boolean`), `contextLines` (`number`), and `dsl` (`boolean`) properties (defaulting `targets` to `["."]` when `search` or `filesOnly` is passed and keeping `rawNative: true` unless `dsl: true`), while `executeToolCall` retains backward-compatible alias dispatch for legacy callers.
- **CLI Surface (`aice --help`)**: Pairs `aice read` (aliases `context`, `ctx`; flags `--search`, `-C, --context`, `--files`, `--dsl`) and `aice splice` (alias `write`) with first-class CLI aliases **`aice search <pattern> [targets...]`** (alias `grep`, `-C`, `-l`, `--full`, `--json`, `--max-tokens`) and **`aice find [pattern] [targets...]`** (alias `tree`, `--json`, `--max-tokens`) routing directly into `read()`, while keeping low-level internal engine subcommands (`outline`, `create`, `compile`, `decompile`, `fmt`, `diff`, `patch`, etc.) hidden for backward-compatible scripting.

### 3.6 Production Hardening, Self-Healing & Transactional Guarantees

- **Whitespace-Resilient `<<< / === / >>>` Hunk Matching**: When an exact hunk search block misses inside the target file or `:symbol` span, `splice.ts` falls back to unambiguous dedent / leading-whitespace-normalized line matching within the scoped span and shifts the replacement block's base indentation by the matched target indentation delta (rejecting ambiguous multi-matches).
- **Half-Open `[start, end)` `:L` Splice Guard (`guardHalfOpenInclusiveLineRangeSplice()`)**: Before touching disk, inspects raw `:Lstart-Lend` replacements (`origSpan >= 4`) where `replLines.length === origSpan - 1` and assignment LHS targets match `Lstart..L(end-1)` 1-for-1, catching accidental Python-style half-open `[start, end)` off-by-one payloads that would silently delete a live code line at `Lend` and emitting an exact inclusive `:Lstart-L(end-1)` / `<<< === >>>` remediation diagnostic.
- **Brace-Safe `±2`-Line `:Lstart-Lend` Auto-Alignment & `±5`-Line Error Context**: Alongside the `±40`-line shifted-header self-healer, if an exact `:Lstart-Lend` splice causes off-by-one/two brace imbalance or syntax failure (`±1..±2` lines on `startLine`/`endLine`), AICE probes candidate boundary alignments and auto-aligns **only** when a single unambiguous candidate restores brace balance and passes native syntax validation. Whenever surgical validation fails, the thrown diagnostic includes the exact surrounding **`±5` numbered lines (`<lineNo>│ <lineContent>`)** from the original file so the agent repairs in 1 turn without an extra `aice read` round-trip.
- **Lexer Null-Guard & Malformed Batch Header Diagnostics**: `maskSourceLexically(source ?? "")` in `src/tools/preprocessor.ts` guards against `null`/`undefined`/empty inputs without throwing `TypeError`, and empty or malformed `=== ... ===` headers in `--stdin` streams return descriptive validation diagnostics.
- **Missing Sibling Auto-Imports & Two-Pass Lossless Syntax Gate**: Automatically wires missing local sibling TS/JS imports and validates every mutated file before disk write, rolling back the entire `spliceBatch` transaction on failure.

---

## 4. Workspace Rule Footprint, Execution Lifecycle & Honest Telemetry

### 4.1 Single-File `AGENTS.md` (`<= 650`-Token) Rule Injection & Legacy Cleanup

To prevent CLI coding agents (such as Antigravity and Gemini CLI) from concatenating multiple copies of workspace instructions into `<user_rules>` on every turn, `syncProjectWorkspaceRules(projectDir, enabled)` in `src/config/project-config.ts` enforces a **1x Single-File Rule Architecture**:
- **Single-File `AGENTS.md` Injection (`<= 650` BPE Tokens)**: When `enabled === true`, AICE writes the compact `MANDATORY_AGENT_RULES_MARKDOWN` (strictly `<= 650` BPE tokens across both `cl100k_base` and `o200k_base`) **only** to `AGENTS.md` (and to `CLAUDE.md` **only** if `CLAUDE.md` already exists on disk without `@AGENTS.md` / `@./AGENTS.md`).
- **Automatic Legacy Duplicate Purge**: On **both** `enabled === true` (`aice enable`) and `enabled === false` (`aice disable`), AICE automatically strips stale `<!-- AICE:START -->...<!-- AICE:END -->` blocks from `GEMINI.md` and `.GEMINI.md` (removing the file if empty, or preserving user-authored content) and deletes `.agents/rules/aice.md` (pruning empty `.agents/rules` and `.agents` directories). This eliminates the legacy 3x prompt tax (`~10,650` tokens $\to$ `<= 650` tokens, `-94%+`).
- **Disabled-Project & Non-Coding Bypass**: `tools/bump-version.ts` delegates to `syncProjectWorkspaceRules(rootDir, isProjectAiceEnabled(rootDir))` so `"enabled": false` workspaces remain 100% rule-free across version bumps, and `MANDATORY_AGENT_RULES_MARKDOWN` explicitly exempts non-coding Q&A sessions and board-only swarm monitors/coordinators from AICE ceremony.

### 4.2 End-to-End Execution, Memory & Turn-Amplification Telemetry Lifecycle

```text
┌─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┐
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │   Strict 2-Tool MCP & Ergonomic CLI Request Entry     │                              │
│                              │  CLI: read|search|find|splice • MCP: aice_read|splice │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                                                          ▼                                                          │
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │         Path, Glob & Sandbox Telemetry Filter         │                              │
│                              │ (quoted globs + cwd/projectRoot/targetPath /tmp gate) │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                                                          ▼                                                          │
│                              ┌───────────────────────────────────────────────────────┐                              │
│                              │      AICE Config Gate (aice.config.json + 1x Rule)    │                              │
│                              │  "enabled": true • "idiomsEnabled": false (opt-in)    │                              │
│                              └───────────────────────────┬───────────────────────────┘                              │
│                       ┌──────────────────────────────────┴─────────┬───────────────────────────────────┐            │
│        Enabled (Read) │                            Enabled (Write) │                          Disabled │            │
│                       ▼                                            ▼                                   ▼            │
│  ┌────────────────────────────────────────┐  ┌──────────────────────────────────────────┐  ┌──────────────────────┐ │
│  │         PILLAR 1: UNIFIED READ         │  │         PILLAR 2: UNIFIED WRITE          │  │  Native Filesystem   │ │
│  │ (aice read|search|find / MCP aice_read)│  │   (aice splice / aice_splice | write)    │  │    Tools (Bypass)    │ │
│  ├────────────────────────────────────────┤  ├──────────────────────────────────────────┤  ├──────────────────────┤ │
│  │ 1. 1-Turn Numbered Native (:sym, bare) │  │ 1. Internal Write Auto-Router:           │  │ - Standard OS I/O    │ │
│  │    + <=20 Siblings, Deps, Refs (--dsl) │  │   - Greenfield Create (mkdir -p, DSL)    │  │ - Zero AICE rule or  │ │
│  │ 2. >120L X-Ray, :sym@kw & >110L Elide  │  │   - Guarded Full-File Overwrite          │  │   envelope overhead  │ │
│  │ 3. <=40L AST / >65L Focus / <20ms Find │  │   - Indent-Safe <<< & Half-Open :L Guard │  └──────────────────────┘ │
│  │ 4. <=9KB Water-Fill + 80..180L Hints   │  │   - +-2L Brace & +-5L Error Diagnostics  │                           │
│  └────────────────────┬───────────────────┘  └─────────────────────┬────────────────────┘                           │
│                       │                                            ▼                                                │
│                       │                      ┌──────────────────────────────────────────┐                           │
│                       │                      │    Differential Pre-Write Syntax Gate    │                           │
│                       │                      │   & Transactional spliceBatch Rollback   │                           │
│                       │                      │   (2-pass lossless retry + snapshots)    │                           │
│                       │                      └─────────────────────┬────────────────────┘                           │
│                       ▼                                            ▼                                                │
│  ┌────────────────────────────────────────┐  ┌──────────────────────────────────────────┐                           │
│  │ Signed <250B Ledger & Loop Forensics   │  │    Atomic .tmp -> rename Disk Commit     │                           │
│  │ (<90s Repeat-Read + readLoopAudit Tax) │  │    (Zero .aice files | Signed Telemetry) │                           │
│  └────────────────────────────────────────┘  └──────────────────────────────────────────┘                           │
└─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────┘
```

1. **Zero `.aice` Artifacts on Disk & Opt-In `$idioms`**: AICE operates purely in memory across all 20 languages and 33 file extensions. `DEFAULT_PROJECT_CONFIG.idiomsEnabled` defaults to `false` so `$idiom` collapsing/expansion activates only when `--idioms` or `"idiomsEnabled": true` is explicitly opted in.
2. **Compact `< 250 B/Event` Numeric Telemetry & Streaming Compaction**: `src/telemetry/index.ts` persists compact numeric JSONL lines (`< 250` bytes/event) in `~/.aice/telemetry/gains.jsonl` with **zero raw source strings** on disk, while `compactTelemetryLedger()` streams 4 MB chunks across multi-gigabyte ledgers to strip raw text and `/tmp` records atomically.
3. **Honest Signed Accounting, `< 90s` Repeat-Read Detection & `readLoopAudit` Forensics**: Zero `Math.max(0, ...)` clamping exists anywhere in `read.ts`, `context.ts`, `splice.ts`, or `telemetry/index.ts`. `:Lstart-Lend` reads baseline against the requested `±10`-line slice, `:/pattern/` and `search` queries baseline against `rg -n`-equivalent match lines, failed CLI invocations log negative `<cli-error>` overhead, and `isEphemeralWorkspace` filters `cwd`, `projectRoot`, and `targetPath` (`/tmp/*`, `/var/tmp/*`, `swarm-*`). In addition:
   - **`aice gain` (`repeatReadCalls` & `Repeat-Read Turn Warnings`)**: Detects back-to-back read events on the same `(projectRoot, filePath)` within **`< 90s`** in `gains.jsonl` (`repeatReadCalls`), surfacing `Repeat-Read Turn Warnings` alongside `Rule Overhead Break-Even` so multi-turn line-hunting loops are never hidden behind positive per-call stdout deltas.
   - **`aice analyze` (`ProjectAnalyzeReport.readLoopAudit` & Context Replay Token Tax)**: Parses all `aice` transcript calls (`read`, `write`, `search`, `grep`, `find`, `tree`, `splice`, etc.) and computes `readLoopAudit`: `readTurns`, `totalTurns`, `readTurnRatioPct`, `maxConsecutiveReadStreak`, `sameFileRepeatReadChains` (files read in `>= 2` consecutive turns before any `splice`), and the estimated **Context Replay Token Tax** (`extraReadTurns * avgSessionContextTokens`).
4. **Differential Pre-Write Gate & Atomic Commits**: Every write route validates output syntax before disk mutation, rolls back multi-file `spliceBatch` streams atomically on failure, and writes via sibling `.tmp` $\to$ `rename` commits.

---

## 5. Deep-Dive Walkthrough: Opt-In `--dsl --idioms` C++20 Transformation (`$clampBand` / `$fmtMetric`)

While default `aice read` emits 1-based disk-numbered native code (`3│ ...`) for zero-translation 1-turn splicing, agents working on repetitive boilerplate can explicitly opt into AICE shorthand + project `$idioms` (`--dsl --idioms` or `"idiomsEnabled": true` in `aice.config.json`). AICE mines repeating patterns via `aice idioms scan --save`, collapses them in RAM during `--dsl --idioms` reads, and expands them cleanly during `aice splice --idioms` with zero `.aice` files on disk:

```json
{
  "idiomsEnabled": true,
  "idioms": {
    "$clampBand": {
      "name": "$clampBand",
      "kind": "stmt",
      "params": [{ "name": "$0" }, { "name": "$1" }, { "name": "$2" }],
      "templateAice": "if $0 < $1:\n  $0 = $1\nif $0 > $2:\n  $0 = $2"
    },
    "$fmtMetric": {
      "name": "$fmtMetric",
      "kind": "expr",
      "params": [{ "name": "$0" }, { "name": "$1" }],
      "templateAice": "std.string($0 + \"=\") + std.to_string($1)"
    }
  }
}
```

### Step 1: Native C++20 Source File on Disk (`src/telemetry_report.cpp`)

```cpp
#include <string>

std::string buildNodeReport(int cpu, int mem, int jit) {
    if (cpu < 0) { cpu = 0; }
    if (cpu > 100) { cpu = 100; }
    if (mem < 128) { mem = 128; }
    if (mem > 65536) { mem = 65536; }

    const auto header = std::string("[Hello World]");
    const auto lineCpu = std::string("cpu=") + std::to_string(cpu);

    return header + " " + lineCpu;
}
```

### Step 2: Opt-In Decompiled Read (`aice read --symbol buildNodeReport --dsl --idioms`)

```bash
$ aice read src/telemetry_report.cpp --symbol buildNodeReport --dsl --idioms --no-callers
```

```aice
// Decompiled & $idiom-collapsed in RAM
pub fn buildNodeReport(cpu:int, mem:int, jit:int) -> str:
  $clampBand(cpu, 0, 100)
  $clampBand(mem, 128, 65536)

  header := "[Hello World]"
  lineCpu := $fmtMetric("cpu", cpu)
  ret header + " " + lineCpu
```

### Step 3: Surgical AICE + `$idioms` Splice (`aice splice --symbol buildNodeReport --idioms`)

```bash
$ aice splice src/telemetry_report.cpp \
    --symbol buildNodeReport \
    --idioms \
    --in-place \
    --code 'pub fn buildNodeReport(cpu:int, mem:int, jit:int) -> str:
  $clampBand(cpu, 0, 100)
  $clampBand(mem, 128, 65536)
  $clampBand(jit, 5, 250)

  header := "[Hello Peter]"
  lineCpu := $fmtMetric("cpu", cpu)
  lineJit := $fmtMetric("jit", jit)
  ret header + " " + lineCpu + " " + lineJit'
```

### Step 4: Verified Native C++20 on Disk (`g++ -std=c++20 -fsyntax-only` Passed)

```cpp
#include <string>

std::string buildNodeReport(int cpu, int mem, int jit) {
    if (cpu < 0) { cpu = 0; }
    if (cpu > 100) { cpu = 100; }
    if (mem < 128) { mem = 128; }
    if (mem > 65536) { mem = 65536; }
    if (jit < 5) { jit = 5; }
    if (jit > 250) { jit = 250; }

    const auto header = std::string("[Hello Peter]");
    const auto lineCpu = std::string("cpu=") + std::to_string(cpu);
    const auto lineJit = std::string("jit=") + std::to_string(jit);

    return header + " " + lineCpu + " " + lineJit;
}
```

---

## 6. Summary of Key Architectural Advantages

- **Strict 2-Tool MCP Surface + Ergonomic CLI Discovery + 1x `<= 650`-Token `AGENTS.md`**: MCP exposes strictly **`aice_read`** (with optional `search`, `filesOnly`, `contextLines`, `dsl`) and **`aice_splice`**, paired on the CLI with `aice read`, `aice search` (`grep`), `aice find` (`tree`), and `aice splice` (`write`) under a single `<= 650`-token `AGENTS.md` footprint (`-94%` rule overhead vs legacy 3-file injection), plus MCP-to-CLI flag normalization in `bin/aice.ts`.
- **1-Turn Numbered Native Reads, `9 KB` Aligned CLI/MCP Budgets & Monolith Controls**: Default `<lineNo>│ <rawDiskLine>` output on `:symbol` (all lengths `<=25L` & `>25L`) and inline bare files (`--dsl` opt-in), `resolveEffectiveReadBudgets()` / `computeDynamicReadBudget()` (`9,216 B` (`9 KB`) aligned CLI & MCP ceiling, `8,704 B` soft cap, `5,000`-token cap; `28,672 B` programmatic fallback), `computeDynamicSliceSpan()` (`6,912 B` / `6.75 KB` slice budget, `80..180L` elision-aware spans; `18,432 B` / `80..650L` programmatic fallback), partial `9 KB` budget fill, same-file range coalescing, `> 120L` Monolith X-Ray landmarks, `:sym@pattern` focus slicing, `> 110L` blank/divider/import elision, and `> 65L` monolith search focus eliminate 2-turn line hunting and spillover truncation.
- **Self-Healing Surgical Splicing & Pre-Write Safety**: Combines whitespace-resilient `<<< / === / >>>` hunks, half-open `[start, end)` `:L` off-by-one guard (`guardHalfOpenInclusiveLineRangeSplice`), `±2`-line brace-safe `:Lstart-Lend` auto-alignment, `±5` numbered error context lines, and `maskSourceLexically` null-guards.
- **100% Honest Signed & Loop-Aware Telemetry**: `< 250 B` numeric ledger, realistic slice/search baselines, `< 90s` `repeatReadCalls` / `Repeat-Read Turn Warnings` in `aice gain`, and `readLoopAudit` + **Context Replay Token Tax** in `aice analyze`.
- **Empirically Verified Across Live Production & Cold-Start Lab Benchmarks**: Measured `+17% to +25%` real net quota savings (`923` live calls / `633` turns on `aipl_dog`, `0` broken disk writes) alongside **11/11** cold-start adversarial wins (`RW-01`..`RW-11`, see [`BENCHMARKS.md`](./BENCHMARKS.md) and [`BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)).
