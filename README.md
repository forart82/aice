# AIL: Abstract Intermediate Language & Bidirectional Transpiler Engine

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript 5.8+](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](https://www.typescriptlang.org/)
[![Bun 1.4+](https://img.shields.io/badge/Bun-1.4%2B-black)](https://bun.sh/)
[![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-green)](https://nodejs.org/)
[![Tests Passing](https://img.shields.io/badge/Tests-1%2C623%20passing-brightgreen)](tests/)
[![Token Savings](https://img.shields.io/badge/Token%20Savings-25%25%20--%2098%25-orange)](src/tokenomics/)

> **A token-efficient, strongly-typed, homoiconic bidirectional programming language and transpiler engine engineered for autonomous AI code generation, zero-loss roundtripping, and non-invasive side-by-side adoption.**

---

## ⚡ Executive Summary

Modern Large Language Models (LLMs) spend **30% to 50% of their context windows and token budget on syntactic noise**: closing XML/HTML tags (`</div>`, `</section>`), redundant curly braces (`{ ... }`), semicolon line terminators (`;`), duplicated type interfaces, and repetitive boilerplate keywords (`function`, `interface`, `public`, `return`).

**AIL 2.0 (Abstract Intermediate Language)** solves this by providing:
1. **25% to 63% Token Compression**: BPE-tuned syntax minimizing subword fragmentation across OpenAI `o200k_base`, `cl100k_base`, Claude, and Llama tokenizers.
2. **Side-by-Side Zero-Folder-Disruption Architecture**: Target files (`*.ts`, `*.cpp`, `*.py`) and AIL files (`*.ail`) coexist in their **exact original locations**, keeping existing build pipelines (Vite, Cargo, CMake, Bun, Next.js), relative imports, and git history 100% intact while rendering target files completely invisible and read-only to AI agents.
3. **Lossless Bidirectional Lens Engine**: Mathematical Put/Get lens preservation ($Put(Get(c), \Omega) == c$) with Concrete Syntax Tree (CST) Trivia Tables preserving all comments, docstrings, formatting, and license headers with **100% bit-identical fidelity**.
4. **Sub-5ms Incremental Watch Daemon**: Real-time transpilation with atomic permission locks ensuring instant Hot Module Reloading (HMR) for existing dev servers.
5. **Sound Static Type System & Self-Repair Telemetry**: Single-root machine-readable JSON diagnostics with visual caret slices and unified diff candidate repair patches for autonomous 1-shot self-healing.

---

## 📊 Empirical Tokenomics Benchmarks

### Table 1: All 14 Reference Examples (`examples/`)
Audited with `--check-drift` enforcing **100% zero target drift**:

| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `design_system_tokens.css` | CSS3 | 4,097 | 3,312 | **-19.2%** | 4,098 | 3,331 | **-18.7%** | -35.0% |
| `enterprise_theme.css` | CSS3 | 6,297 | 4,869 | **-22.7%** | 6,299 | 4,935 | **-21.7%** | -40.1% |
| `style.css` | CSS3 | 67 | 59 | **-11.9%** | 67 | 59 | **-11.9%** | -31.9% |
| `gateway_service.go` | Go | 514 | 246 | **-52.1%** | 523 | 253 | **-51.6%** | -52.3% |
| `enterprise_portal.html` | HTML5 | 7,102 | 4,873 | **-31.4%** | 7,094 | 4,855 | **-31.6%** | -26.1% |
| `page.html` | HTML5 | 171 | 132 | **-22.8%** | 172 | 132 | **-23.3%** | -12.3% |
| `data_pipeline_models.py` | Python | 4,096 | 3,415 | **-16.6%** | 4,093 | 3,618 | **-11.6%** | -23.2% |
| `server.py` | Python | 143 | 128 | **-10.5%** | 146 | 129 | **-11.6%** | -20.4% |
| `stream_processor_engine.py` | Python | 5,048 | 4,180 | **-17.2%** | 4,927 | 4,196 | **-14.8%** | -22.1% |
| `dashboard_card.tsx` | React TSX | 106 | 47 | **-55.7%** | 112 | 48 | **-57.1%** | -58.2% |
| `order_engine.rs` | Rust | 562 | 343 | **-39.0%** | 565 | 348 | **-38.4%** | -46.3% |
| `auth_service.ts` | TypeScript | 263 | 175 | **-33.5%** | 274 | 181 | **-33.9%** | -41.1% |
| `ecommerce_domain.ts` | TypeScript | 5,429 | 3,567 | **-34.3%** | 5,438 | 3,649 | **-32.9%** | -39.7% |
| `order_processing_service.ts` | TypeScript | 5,834 | 4,234 | **-27.4%** | 5,799 | 4,282 | **-26.2%** | -33.5% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (14 Projects)** | **Aggregated** | **39,729** | **29,580** | **-25.5%** | **39,607** | **30,016** | **-24.2%** | **-31.8%** |

### Table 2: Real-World Case Studies (`poc_real_case/`)
Audited across 67 production modules from Raylib C++, SFML C++, and Canvas TypeScript games:

| Project | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `dogMax` (27 files) | C++20 | 8,349 | 4,488 | **-46.2%** | 8,364 | 4,488 | **-46.3%** | -56.1% |
| `snake_pp` (22 files) | C++20 | 8,065 | 2,948 | **-63.4%** | 8,183 | 2,989 | **-63.5%** | -66.8% |
| `snake_ts` (18 files) | TypeScript | 87,759 | 65,333 | **-25.6%** | 87,962 | 65,481 | **-25.6%** | -27.9% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (3 Projects / 67 Files)** | **Aggregated** | **104,173** | **72,769** | **-30.1%** | **104,509** | **72,958** | **-30.2%** | **-33.8%** |

### Table 3: Consolidated 1,520-Case Honest CRUD & Polyglot Benchmark (`docs/BENCHMARKS.md`)
Evaluated with **100% honest apples-to-apples token accounting** (**zero fake multipliers**, **zero full-file double-charging**, **zero dependency padding**) across **15 languages & file types (`15 × 100 = 1,500` cases across 10 progressive waves)** + **20 complex multi-language full-stack scenarios (`1,520` total benchmarks)** covering **Write (`0->1`)**, **Read (`outline` + `context`)**, **Update (`splice` bug fix / feature update / `--insert-after` new feature)**, **Delete (`splice --delete`)**, and **Multi-File Refactor (`idiom update`)** across both **Window Applications** and **Non-Window Applications**:

| Language / File Type | Ext | Cases | Win Rate | Write (`0->1`) | Read (`Context`) | Update (`Splice`) | Delete (`--delete`) | Refactor (`Idiom`) | Total Native | Total AIL | Overall Savings |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | :---: |
| **TypeScript (.ts)** | `.ts` | 100 | **100/100 (100%)** | -72.0% | -95.5% | -86.4% | -97.4% | -97.8% | 2,298,044 | 342,640 | **-85.1%** |
| **React TSX (.tsx)** | `.tsx` | 100 | **100/100 (100%)** | -64.8% | -95.8% | -84.0% | -97.5% | -97.9% | 2,397,844 | 432,100 | **-82.0%** |
| **JavaScript (.js)** | `.js` | 100 | **100/100 (100%)** | -71.7% | -96.3% | -86.3% | -97.3% | -97.7% | 2,278,440 | 334,190 | **-85.3%** |
| **Python (.py)** | `.py` | 100 | **100/100 (100%)** | -67.6% | -94.7% | -83.9% | -96.9% | -97.4% | 1,986,068 | 344,140 | **-82.7%** |
| **Go (.go)** | `.go` | 100 | **100/100 (100%)** | -71.8% | -69.6% | -86.4% | -97.3% | -97.7% | 2,285,864 | 603,540 | **-73.6%** |
| **Rust (.rs)** | `.rs` | 100 | **100/100 (100%)** | -72.3% | -95.3% | -86.7% | -97.4% | -97.8% | 2,332,522 | 345,390 | **-85.2%** |
| **C++20 (.cpp)** | `.cpp` | 100 | **100/100 (100%)** | -71.8% | -95.4% | -87.7% | -97.3% | -97.8% | 2,293,656 | 343,440 | **-85.0%** |
| **C# (.cs)** | `.cs` | 100 | **100/100 (100%)** | -73.3% | -69.6% | -87.2% | -97.5% | -97.9% | 2,414,998 | 620,290 | **-74.3%** |
| **Kotlin (.kt)** | `.kt` | 100 | **100/100 (100%)** | -71.3% | -93.4% | -86.2% | -97.3% | -97.7% | 2,241,668 | 362,890 | **-83.8%** |
| **PHP 8 (.php)** | `.php` | 100 | **100/100 (100%)** | -73.8% | -94.0% | -87.4% | -97.5% | -97.9% | 2,456,552 | 362,190 | **-85.3%** |
| **CSS3 (.css)** | `.css` | 100 | **100/100 (100%)** | -66.9% | -96.8% | -79.3% | -97.1% | -97.6% | 2,060,304 | 346,110 | **-83.2%** |
| **HTML5 (.html)** | `.html` | 100 | **100/100 (100%)** | -58.8% | -59.0% | -81.8% | -97.5% | -97.9% | 2,402,294 | 887,318 | **-63.1%** |
| **JSON (.json)** | `.json` | 100 | **100/100 (100%)** | -69.5% | -72.0% | -85.3% | -97.9% | -98.2% | 2,956,680 | 779,690 | **-73.6%** |
| **YAML (.yaml)** | `.yaml` | 100 | **100/100 (100%)** | -60.4% | -63.6% | -80.5% | -97.2% | -97.7% | 2,272,340 | 779,490 | **-65.7%** |
| **Twig (.twig)** | `.twig` | 100 | **100/100 (100%)** | -62.4% | -63.0% | -83.8% | -97.2% | -97.9% | 1,914,278 | 642,564 | **-66.4%** |
| **20 Polyglot Full-Stack Apps** | `All 15` | 20 | **20/20 (100%)** | -67.9% | -80.8% | -82.1% | -97.9% | -98.2% | 3,857,450 | 896,831 | **-76.8%** |
| **TOTAL (1,520 Benchmarks)** | **All** | **1,520** | **1,520/1,520 (100%)** | **-68.6%** | **-81.2%** | **-84.8%** | **-97.4%** | **-97.8%** | **38,449,002** | **8,422,813** | **-78.1%** |

Full breakdown by engineering scenario (`bug_fix`, `new_feature`, `update_feature`, `from_zero_window_app`, `from_zero_non_window_app`), Window Snake App vs. Non-Window CLI Daemon from `0`, and all 20 Polyglot Full-Stack scenarios: see [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) and run `npm run benchmark`.


---

## ⚡ Twinless On-the-Fly Mode (`mode: "twinless"`) & Side-by-Side Architecture

AIL 2.0 supports two complementary operational modes:

### Mode A: Twinless On-the-Fly Mode (`mode: "twinless"` — Zero `.ail` Files on Disk)
- **Zero `.ail` Disk Pollution**: Native files (`*.ts`, `*.py`, `*.go`, `*.rs`, `*.cpp`, `*.cs`, `*.kt`, `*.php`, `*.css`, `*.html`) remain the sole source files on disk.
- **In-RAM Decompilation & `$idiom` Collapsing**: `ail outline <file>` and `ail context <file> [-s <symbol>]` decompile native files in RAM on-the-fly and automatically collapse active project `$idioms` from `ail.config.json`.
- **Smart Multi-File Idioms**: `ail idioms scan` mines repeated expressions and statement blocks across native files using structural anti-unification and caches SHA-256 provenance in `.ail-cache/idioms.json`. `ail idioms read $name` lists every occurrence across files (`file:line` + bound arguments), and `ail idioms update $name "<newTemplate>"` rewrites all occurrences across all native files in a single atomic operation.
- **Forgiving Direct-to-Native Surgical Splice**: `ail splice <nativeFile> -s <Class.method>` accepts pure AIL, AIL with `$idioms`, raw native code, or hybrid "Frankenstein" syntax, expanding `$idioms` and replacing only the exact AST byte-span of the target symbol while preserving 100% of surrounding comments, decorators, and formatting.

### Mode B: Side-by-Side Zero-Folder-Disruption Architecture
In real-world development, moving files into quarantine/shadow folders breaks bundlers, relative imports, and git history. AIL solves this by keeping target files and AIL files **side-by-side** in the exact same directory, backed by a **4-Layer Defense-in-Depth System**:

```
src/sim/
├── Boss.ts           <-- Read-only lock (chmod 444). Hidden from AI by files.exclude & .cursorignore
└── Boss.ts.ail       <-- VISIBLE to AI as single authoritative source of truth
```

### The 4-Layer Defense Mechanism:
1. **Layer 1: IDE Sibling Conditional Exclusion (`.vscode/settings.json`)**:
   Uses native IDE conditional when-clauses (`"**/*.ts": { "when": "$(basename).ts.ail" }`). In Cursor, VS Code, and Windsurf, `Boss.ts` completely disappears from the file tree, fuzzy finders, and symbol indexing whenever `Boss.ts.ail` exists alongside it.
2. **Layer 2: Universal AI Agent Ignores (`.cursorignore`, `.geminiignore`, `.aiderignore`, `.agentignore`)**:
   Prevents AI tool search calls (`list_dir`, `find`, `grep`) and codebase vector embeddings from indexing target files.
3. **Layer 3: Cognitive Lockdown Directives (`AGENTS.md`, `.cursorrules`)**:
   Informs AI agents that this project is authoritatively written in AIL (`*.ail`), target files are machine-generated read-only build artifacts, and direct edits to target files are prohibited.
4. **Layer 4: Filesystem Protection & Live Watch Daemon (`chmod 444` + `ail watch`)**:
   Generated target files are marked read-only on disk (`0o444`). If an AI agent attempts a raw write or edit, the OS raises `EACCES: permission denied`. When `Boss.ts.ail` is saved, the `ail watch` daemon atomically unlocks `Boss.ts`, recompiles it in $< 5\text{ms}$, and relocks it, triggering instant Hot Module Reloading (HMR).

---

## 🚀 Quick Start & Installation

### Option 1: Local Link (Recommended for Development)
Link directly to your local AIL repository so any compiler updates are instantly live everywhere:
```bash
cd /path/to/ail
ln -sf $(pwd)/bin/ail.mjs ~/.local/bin/ail
```
*(Or with Bun: `bun link`)*

### Option 2: Standalone Single Binary (Zero Dependencies)
Compile into a standalone Linux executable (no Node or Bun required in target projects):
```bash
bun build --compile /path/to/ail/bin/ail.ts --outfile ~/.local/bin/ail
```

Verify installation:
```bash
ail --version
ail --help
```

---

## 💻 CLI Command Reference

### Adoption, Companion & Bidirectional Sync
```bash
# 1. Adopt an existing codebase into side-by-side AIL architecture:
# (Decompiles targets in parallel, injects AI shield rules, and locks targets to chmod 444)
ail adopt [dir] [-c <concurrency>]

# 2. Adopt into an isolated companion twin workspace with project idioms:
ail adopt [companionDir] --companion [targetDir] --idioms

# 3. Start the high-speed incremental watch daemon during active coding:
# (Listens to *.ail changes, recompiles to targets in <5ms, and preserves HMR)
ail watch [dir]
ail dev [dir]

# 4. Bidirectional companion watch (watches target files and reverse-syncs external edits into .ail):
ail watch [dir] --bidirectional

# 5. One-shot bidirectional sync from targets back to .ail:
ail sync [dir]

# 6. Eject side-by-side mode and restore standard project state:
# (Unlocks target files back to chmod 644 and removes AI shield rules)
ail eject [dir]
ail eject [dir] --remove-ail   # Optional: deletes .ail source files

# 7. Fine-grained shield management (including Twinless On-the-Fly shield):
ail shield apply [dir] --twinless  # Configure Twinless mode (zero .ail files on disk)
ail shield status [dir]            # Check active shield rules and locks
ail shield lock [dir]              # Lock target files to chmod 444
ail shield unlock [dir]            # Unlock target files to chmod 644
ail shield apply [dir]             # Deploy .cursorignore, settings.json, and AGENTS.md
ail shield remove [dir]            # Remove shield rules
```

### Smart Multi-File Idioms (`$idioms`)
```bash
# Scan native or .ail workspace to discover repetitive AST templates & build .ail-cache/idioms.json:
ail idioms scan [dir] --min-occurrences 3 --min-savings 10

# Inspect an idiom's template, parameters, and every file:line occurrence across the project:
ail idioms read '$clamp' [dir]

# Mutate an idiom's template and rewrite all occurrences across all native files atomically:
ail idioms update '$clamp' "Math.max($1, Math.min($2, $0))" [dir]
ail idioms update '$clamp' "Math.max($1, Math.min($2, $0)) * $3" --params '$0,$1,$2,$3=1.0' [dir]

# Instant toggle of on-the-fly $idiom collapsing in ail.config.json:
ail idioms on [dir]
ail idioms off [dir]

# Synthesize discovered idioms into .ail files (Side-by-Side mode) or expand back:
ail idioms apply [dir]
ail idioms list [dir]
ail idioms expand [dir]
```

### AI Agent On-the-Fly Context, Surgical Splicing, MCP & Evolution
```bash
# Generate 1-turn token-bounded context pack from a native file (or single symbol with -s):
ail context src/sim/Hazard.ts --depth 2 --max-tokens 4000
ail context src/sim/Hazard.ts -s HazardManager.calculateDamage --idioms

# Generate structural skeleton outline of any native or .ail file/directory (85-95% token reduction):
ail outline src/sim/Hazard.ts --stats

# Surgically replace or delete AST symbols directly in native files (accepts AIL, $idioms, raw, or hybrid):
ail splice src/sim/Hazard.ts -s HazardManager.calculateDamage -c "pub fn calculateDamage(d: int) -> int: ret $clamp(d * 2, 0, 100)"
ail splice src/sim/Hazard.ts -s HazardManager.calculateDamage --body "ret d * 2"
ail splice src/sim/Hazard.ts -s HazardManager.obsoleteHelper --delete
ail splice --batch '[{"filePath":"src/a.ts","symbol":"fnA","code":"pub fn fnA() -> int: ret 1"}]'

# Run the Consolidated 1,520-Case Honest CRUD & Polyglot Benchmark Suite:
npm run benchmark

# Run test suite with symbol-mapped runtime stack trace translation and auto-recompilation:
ail test
ail test tests/unit/service.test.ts --json

# Launch the First-Class Model Context Protocol (MCP) server over stdio:
ail mcp

# Run the 5-Gate Differential Fuzzing & Autonomous Self-Healing Evolution Campaign:
ail evolve --restarts 100 --cycles 10
ail evolve --cycles 50 --seed 1337 --json
```

### Compilation & Decompilation
```bash
# Compile a single .ail file to its target language:
ail compile src/Boss.ts.ail

# Recursively compile all .ail files across a project:
ail compile-all ./src

# Clean all generated target files:
ail clean ./src

# Decompile a target file (.ts, .tsx, .css, .html, .go, .rs, .py, .kt, etc.) into .ail:
ail decompile src/Boss.ts --trivia
```

### Verification & Autonomous Self-Repair
```bash
# Verify syntax, immutability, and type soundness without emitting:
ail verify src/Boss.ts.ail

# Output machine-readable JSON telemetry for AI agents:
ail verify src/Boss.ts.ail --json

# Autonomously repair fixable violations (mutability, division by zero, truthiness):
ail fix src/Boss.ts.ail
ail fix src/Boss.ts.ail --dry-run

# Audit token efficiency and compression density for a specific file or folder (with subfolders):
ail tokens src/sim/Hazard.ts
ail tokens src/sim/Hazard.ts --check-drift
ail tokens src/sim
ail efficiency ./src

# Audit tokenomics and enforce zero target drift:
ail verify-tokenomics examples --check-drift
ail verify-tokenomics poc_real_case --projects
```

### Bidirectional Roundtrip & Language Server
```bash
# Verify Put/Get roundtrip stability (Put(Get(c), Omega) == c):
ail roundtrip src/Boss.ts

# Launch the AIL Language Server Protocol (LSP) daemon over stdio:
ail lsp
```

---

## 📐 Language Syntax & Grammar Features

### 1. Keywordless Variable & Mutable Binding
Eliminates `let`, `const`, and `var` keywords using standard Go/Ocaml style bindings:
```python
# Immutable binding (replaces 'let x = 42' or 'const x = 42')
x := 42
name: str := "Alice"

# Mutable binding (replaces 'let mut y = 0' or 'let y = 0')
count ::= 0
buffer: [int] ::= []
```

### 2. Dual-Case Property Compaction (`prop X, x`)
Collapses repetitive TypeScript getter/setter boilerplate into a single declaration:
```python
class SnakeSegment:
  prop X, x: float = 0.0      # Emits field X, get x() { return this.X; }, set x(v) { this.X = v; }
  prop Y, y: float = 0.0
  prop Speed, speed: int = 10
```

### 3. Vector & Arithmetic Compression DSL
Built-in global math functions and vector destructuring eliminate repetitive `Math.` prefixes:
```python
# Vector destructuring:
[x, y] := [10, 20]
[x, y] += [dx, dy]

# Built-in math functions (automatically mapped to target math libraries):
dist := hypot(dx, dy)
clamped := clamp(val, 0, 100)
snapped := floor(pos / 16.0)
```

### 4. Single-Token BPE Dictionary Types & Sigils
Uses single-token primitive keywords avoiding subword splitting:
- Types: `int`, `str`, `float`, `bool`, `num`, `byte`, `char`, `void`, `nil`.
- Field Sigils: `!s` (string), `!i` (int), `!f` (float), `!b` (bool), `!` (required), `?` (optional).
```python
type User: id!s, name!s, score!i = 0, active!b = true, avatar?
```

### 5. Declarative UI Component DSL (56% Savings vs JSX)
Zero closing XML tags (`</div>`, `</Card>`), Emmet-style contextual tag inference, and `_` inline modifier:
```python
component DashboardCard(title: str, value: int):
  .card.p-4:
    h2 _ title
    .metric-row:
      span.text-muted _ "Count"
      span.font-bold _ value.toString()
```

### 6. CSS Multi-Value Packs & Unit Deduplication
Namespace unit inheritance and layout macros:
```python
# Unit deduplication (appends rem automatically to unitless numbers)
tokens spacing[rem]:
  xs: 0.25
  sm: 0.5
  md: 1.0
  lg: 1.5

# Layout macro shorthand
style ".flex-container":
  fl-row           # Emits display: flex; flex-direction: row;
  gap: 1rem
```

### 7. Algebraic Error Handling (`Result[T, E]` and `?`)
Replaces unchecked `try/catch` with sound algebraic results and postfix unwrap:
```python
fn fetchAccount(id: str) -> Result[Account, NetworkError]:
  data := httpGet(`/accounts/${id}`)?
  user := parseAccount(data)?
  ret Ok(user)
```

### 8. Project-Specific BPE-Gated Idioms ($idioms)
Repetitive expression or statement patterns across a workspace are automatically synthesized into parameterized project idioms (`$idiom($0, $1)`) whenever they pass the positive net BPE token-savings gate ($\text{NetSavings} = (\text{TemplateTokens} - \text{CallTokens}) \times \text{Occurrences} - \text{DefinitionOverhead} \ge 10$ tokens using `cl100k_base`):
```python
# Raw repetitive code (e.g., Euclidean distance or boundary clamping repeated 15 times):
d := hypot(a.x - b.x, a.y - b.y)

# Automatically collapsed with active project idiom $dist2d($0, $1):
d := $dist2d(a, b)

# Idiom definition stored in ail.config.json and expanded losslessly during target compilation:
# "$dist2d": { "params": ["$0", "$1"], "templateAil": "hypot($0.x - $1.x, $0.y - $1.y)" }
```

---

## 🔬 The Bidirectional Lens Theorem

AIL 2.0 implements formal asymmetric lenses over Concrete Syntax Trees:

$$\text{Get} : \mathcal{C} \to \mathcal{A}$$
$$\text{Put} : \mathcal{A} \times \Omega \to \mathcal{C}$$

Where $\mathcal{C}$ is the target language concrete syntax, $\mathcal{A}$ is the AIL abstract syntax, and $\Omega$ is the CST Trivia Table. Every roundtrip satisfies:

$$\text{Put}(\text{Get}(c)) \equiv c$$

All comments, JSDoc blocks, and docstrings are inlined directly into `*.ail` source files as standard `#` comments, ensuring humans and AI coding models can read and edit documentation directly without polluting repositories with external sidecar `.json` files.

---

## 🛠️ Project Structure

```
ail/
├── bin/
│   ├── ail.ts                 # Full CLI command suite
│   └── ail.mjs                # Node/Bun executable wrapper
├── docs/
│   ├── AIL_SPEC.md            # Normative language specification (EBNF)
│   ├── AI_SYSTEM_PROMPT.md    # System prompt for LLM code generation
│   └── CST_TRIVIA_SPEC.md     # Lens and trivia table technical spec
├── examples/                  # 14 reference multi-language examples
├── poc_real_case/             # 67 real-world case study modules
│   ├── dogMax/                # Raylib C++ game combat subsystem
│   ├── snake_pp/              # SFML C++ snake engine
│   └── snake_ts/              # Canvas TypeScript simulation engine
├── src/
│   ├── cache/                 # Fast persistent CST & AST disk caching engine
│   ├── config/                # Project config (ail.config.json), mode resolver & paths
│   ├── core/                  # Lexer, Pratt Parser, AST, Tokens, Span, Trivia
│   ├── decompiler/            # Universal reverse transpiler (Go, Rust, Python, Kotlin, PHP, C++, C#, TS/TSX/JS, CSS, HTML)
│   ├── emitters/              # Multi-target code generators (TS/TSX/JS, Py, Go, Rust, Kotlin, PHP, C++, C#, CSS, HTML, JSON, YAML, Twig)
│   ├── evolve/                # 5-Gate differential fuzzing, self-healing & evolution loop
│   ├── idioms/                # Project-specific BPE-gated idiom miner & AST transform
│   ├── lsp/                   # Language Server Protocol daemon with rich actions & idioms
│   ├── mcp/                   # First-Class Model Context Protocol (MCP) server & tools
│   ├── runner/                # Test runner, symbol-error formatter & ConcurrencyPool TUI
│   ├── shield/                # AI Exclusion Rules & Permission Locker
│   ├── tokenomics/            # TikToken BPE benchmark & drift auditor
│   ├── tools/                 # Token-dense tools: context, outline, splice, fmt, diff, patch
│   ├── transpiler/            # Side-by-Side & Companion Parallel Ingest Engine
│   ├── typechecker/           # Sound TypeChecker & Autonomous Self-Repair
│   └── watcher/               # High-Speed Incremental & Bidirectional Watch Daemon
└── tests/
    ├── unit/                  # 1,546 unit and integration tests across 63 suites
    └── integration/           # End-to-end bidirectional fidelity & multi-round suites
```

---

## 📜 License

Apache License 2.0. Copyright (c) 2026.
