# AICE Architecture: 2-Pillar Unified Context & Mutation Engine

> **Status**: Official Technical Architecture Specification  
> **Target Runtimes**: Node.js 22/24+, Bun 1.4+, TypeScript 5.8+  
> **Supported Targets**: 20 Languages & 33 File Extensions  
> **Author**: [@forart82](https://github.com/forart82)

---

## 1. Architectural Blueprint: The 2-Pillar Unified Engine

AICE (AI Context Engine) replaces fragmented, multi-tool AI coding agent interactions with a streamlined, **2-Pillar Unified Architecture**:

1. **Pillar 1: Unified Read (`aice context` / `aice outline`)** — A single, token-bounded inspection pipeline featuring **Adaptive Sibling Outlining**, **4-Tier Search Ranking**, AST-level symbol extraction, deduplicated dependency contracts, and downstream caller discovery.
2. **Pillar 2: Unified Write (`aice splice` / `aice write`)** — A single, multi-mode mutation pipeline combining **Greenfield Auto-Creation**, **Lossless Surgical AST Splicing**, **Full-File Overwrite**, and unified multi-file batch streaming under a universal alias (`aice write` $\equiv$ `aice splice`).

```
┌─────────────────────────────────────────────────────────────────────────────────────────────────┐
│                                 AICE 2-PILLAR UNIFIED ARCHITECTURE                              │
├────────────────────────────────────────────────┬────────────────────────────────────────────────┤
│            PILLAR 1: UNIFIED READ              │            PILLAR 2: UNIFIED WRITE             │
│        (aice context / aice outline)           │          (aice splice / aice write)            │
├────────────────────────────────────────────────┼────────────────────────────────────────────────┤
│  Incoming Inspection Request                   │  Incoming Mutation Request                     │
│  ├─ Target: symbol, range, testId, or regex    │  ├─ Payload: new file, AST splice, or overwrite│
│  ▼                                             │  ▼                                             │
│  ┌──────────────────────────────────────────┐  │  ┌──────────────────────────────────────────┐  │
│  │   File & Workspace Scanner (In-RAM AST)  │  │  │         Target Existence Check           │  │
│  └────────────────────┬─────────────────────┘  │  └────────────────────┬─────────────────────┘  │
│                       │                        │                       │                        │
│          ┌────────────┴────────────┐           │         ┌─────────────┴─────────────┐          │
│          ▼                         ▼           │         ▼                           ▼          │
│  ┌───────────────┐       ┌──────────────────┐  │  ┌───────────────┐         ┌────────────────┐  │
│  │ Exact Symbol  │       │ Regex/Pattern    │  │  │ File Exists?  │         │ File Missing?  │  │
│  │ Resolution    │       │ Search (4 Tiers) │  │  └───────┬───────┘         └───────┬────────┘  │
│  └───────┬───────┘       └─────────┬────────┘  │          │                         │           │
│          │                         │           │          ▼                         ▼           │
│          │               ┌─────────┴────────┐  │  ┌───────────────┐         ┌────────────────┐  │
│          │               │ 4-TIER RANKING   │  │  │ Selector or   │         │ Auto-Create    │  │
│          │               │ Tier 1: Defs     │  │  │ Hunk Present? │         │ Parent Dirs &  │  │
│          │               │ Tier 2: Code     │  │  └───────┬───────┘         │ Greenfield     │  │
│          │               │ Tier 3: Comments │  │          │                 │ File on Disk   │  │
│          │               │ Tier 4: Mocks    │  │     ┌────┴─────┐           └────────────────┘  │
│          │               └─────────┬────────┘  │     ▼          ▼                               │
│          ▼                         ▼           │  ┌──────┐  ┌──────────────┐                    │
│  ┌──────────────────────────────────────────┐  │  │ Yes  │  │ No           │                    │
│  │       Adaptive Sibling Outlining         │  │  └──┬───┘  └──────┬───────┘                    │
│  │  - Enclosing Class / Interface context   │  │     │             │                            │
│  │  - Guarded: max 20 symbols / ~150 tokens │  │     ▼             ▼                            │
│  │  - "(+ N other methods)" truncation      │  │  ┌──────────────┐ ┌────────────────┐           │
│  └────────────────────┬─────────────────────┘  │  │ Surgical AST │ │ Full-File      │           │
│                       │                        │  │ Splice       │ │ Overwrite      │           │
│                       ▼                        │  │ (CST Trivia) │ │ (Atomic Write) │           │
│  ┌──────────────────────────────────────────┐  │  └──────┬───────┘ └───────┬────────┘           │
│  │      Deduplicated Dependency Pack        │  │         │                 │                    │
│  │  - Inline contracts + caller call-sites  │  │         ▼                 ▼                    │
│  └────────────────────┬─────────────────────┘  │  ┌──────────────────────────────────────────┐  │
│                       │                        │  │      Atomic In-Place Disk Mutation       │  │
│                       ▼                        │  │   Zero .aice artifacts / RAM -> Disk     │  │
│  ┌──────────────────────────────────────────┐  │  └──────────────────────────────────────────┘  │
│  │ 70–90% Token-Savings Context Stream      │  │                                                │
│  └──────────────────────────────────────────┘  │                                                │
└────────────────────────────────────────────────┴────────────────────────────────────────────────┘
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

### 2.3 Deduplicated Dependency Contracts & Downstream Callers

For any inspected symbol, AICE automatically traverses imports and references:
- **Dependency Contracts**: Merges type signatures and exported contracts from imported modules into a compact deduplicated header.
- **Downstream Callers**: Detects call-sites across the project and surfaces caller locations with exact line indicators (`[L14]`), allowing the agent to understand upstream ripple effects before modifying code.

---

## 3. Pillar 2: Unified Write Engine (`aice splice` / `aice write`)

The **Unified Write Engine** eliminates the friction of choosing between different file modification commands (`write_file`, `edit_file`, `create_file`, custom patch scripts). Under the universal command **`aice splice`** (and its identical alias **`aice write`**), mutations are handled deterministically across all states of the codebase.

### 3.1 Greenfield Auto-Creation

When an agent needs to create a new file, it no longer needs a separate creation command:
1. **Target Detection**: AICE checks if the destination file path exists on disk.
2. **Recursive Directory Synthesis**: If the target does not exist, AICE automatically creates all necessary parent directories (`mkdir -p` semantics).
3. **Greenfield Compilation**: The provided code payload is compiled and written atomically to disk.
4. **Consistency**: Greenfield creation works identically whether invoked as `aice splice path/to/new.ts -c "..."` or `aice write path/to/new.ts -c "..."`.

### 3.2 Lossless Surgical AST Splicing (<50% Changes)

For modifications to existing files, AICE uses Concrete Syntax Tree (CST) Trivia Lenses and AST parsers to replace only the targeted subtree:
- **Symbol Targeting**: Target methods or classes (`-s "Class.method"` or `-s "functionName"`).
- **AST-Scoped Hunks**: Patch targeted lines within a symbol using `<<< / === / >>>` blocks, immune to surrounding line shifts.
- **Line Ranges**: Splice numbered line ranges (`-s "L35-L42"`).
- **Heading Replacement**: Update Markdown sections cleanly by heading (`-s "Quick Start"`).
- **Imports & Appends**: Splicing `:imports` merges top-level module imports; splicing `:eof` appends safely to the end of the file.
- **Trivia Preservation**: Preserves comments, indentation, docstrings, and formatting around the modified node.

### 3.3 Full-File Overwrite Fallback (>50% Changes)

When an agent needs to completely rewrite an existing file (e.g. substantial architectural redesign or schema overhaul):
- **Selector-Free Invocation**: If the file exists and **no selector** (`-s`) or hunk (`<<<`) is provided, AICE performs a clean, atomic full-file overwrite.
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

---

## 4. End-to-End Execution & Memory Lifecycle

```
Agent Tool Request
       │
       ▼
┌─────────────────────────┐
│ Path & Sandbox Resolver │  Enforces workspace boundaries & directory isolation
└────────────┬────────────┘
             │
             ▼
┌─────────────────────────┐
│ AICE Config Gate        │  Checks aice.config.json ("enabled": true/false)
└────────────┬────────────┘
             │
             ├─────────────────────────────────────────────────┐
             │ Enabled                                         │ Disabled / Fallback
             ▼                                                 ▼
┌─────────────────────────┐                       ┌─────────────────────────┐
│ In-RAM Decompiler & AST │                       │ Native Filesystem Tools │
│ (20 Languages / 33 Ext) │                       │ (Standard OS I/O)       │
└────────────┬────────────┘                       └─────────────────────────┘
             │
             ├─────────────────────────────────────────────────┐
             │ Pillar 1: Read                                  │ Pillar 2: Write
             ▼                                                 ▼
┌─────────────────────────┐                       ┌─────────────────────────┐
│ Unified Read Pipeline   │                       │ Unified Write Pipeline  │
│ - Sibling Outlining     │                       │ - Auto-Create / Overwrite│
│ - 4-Tier Search Ranking │                       │ - CST Trivia AST Splice │
│ - Contract Resolution   │                       │ - Multi-file Stream     │
└────────────┬────────────┘                       └────────────┬────────────┘
             │                                                 │
             ▼                                                 ▼
┌─────────────────────────┐                       ┌─────────────────────────┐
│ BPE Token Telemetry     │                       │ Atomic Disk Commit      │
│ (cl100k / o200k)        │                       │ (Zero .aice disk files) │
└─────────────────────────┘                       └─────────────────────────┘
```

1. **Zero `.aice` Artifacts on Disk**: AICE operates purely in memory. Decompilation, `$idiom` collapsing, and CST trivia transformations occur in RAM, emitting native source code directly to disk.
2. **Ephemeral Telemetry Suppression**: Operations in sandboxes (`/tmp`, `/var/tmp`, `swarm-*` worktrees) are automatically isolated to prevent test pollution of production telemetry ledgers.
3. **Atomic Writes**: All disk mutations use atomic write patterns (`.tmp` $\to$ rename) to guard against file corruption during sudden interrupts.

---

## 5. Summary of Key Architectural Advantages

- **70%–85% Context Reduction**: Eliminates verbose AST syntax, curly brace boilerplate, and irrelevant test decoy matches through 4-Tier Ranking and Adaptive Sibling Outlining.
- **90%+ Edit Token Savings**: Surgical AST splicing targets exact symbols and hunks without rewriting unaffected code.
- **1-Turn Agent Workflows**: Replaces tedious file-by-file loops with unified multi-file `--stdin` and `--batch` streams.
- **Zero Tool Friction**: `aice write` and `aice splice` cover all write operations; `aice context` and `aice outline` cover all read operations.
- **Empirically Verified Across 33 Live Adversarial Agent Sessions**: Wins **10/10** multi-file 3-layer scenarios (`RW-01`..`RW-10`) plus the hostile 1-file 0-idiom `RW-11` Lone Needle scenario (`22/22` AICE runs 100% verified on disk), cutting LLM output tokens by **70.4%–87.2%**, working payload tokens by **65.9%–77.1%**, LLM turns by **70.6%–72.7%**, and real API cost by **74.4%–78.9%** (see [`BENCHMARKS.md`](./BENCHMARKS.md) and [`BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)).

