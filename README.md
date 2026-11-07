# AICE: AI Context Engine & Bidirectional Transpiler Engine

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

**AICE 2.0 (AI Context Engine)** solves this by providing:
1. **25% to 63% Token Compression**: BPE-tuned syntax minimizing subword fragmentation across OpenAI `o200k_base`, `cl100k_base`, Claude, and Llama tokenizers.
2. **Side-by-Side Zero-Folder-Disruption Architecture**: Target files (`*.ts`, `*.cpp`, `*.py`) and AICE files (`*.aice`) coexist in their **exact original locations**, keeping existing build pipelines (Vite, Cargo, CMake, Bun, Next.js), relative imports, and git history 100% intact while rendering target files completely invisible and read-only to AI agents.
3. **Lossless Bidirectional Lens Engine**: Mathematical Put/Get lens preservation ($Put(Get(c), \Omega) == c$) with Concrete Syntax Tree (CST) Trivia Tables preserving all comments, docstrings, formatting, and license headers with **100% bit-identical fidelity**.
4. **Sub-5ms Incremental Watch Daemon**: Real-time transpilation with atomic permission locks ensuring instant Hot Module Reloading (HMR) for existing dev servers.
5. **Sound Static Type System & Self-Repair Telemetry**: Single-root machine-readable JSON diagnostics with visual caret slices and unified diff candidate repair patches for autonomous 1-shot self-healing.

---

## 📊 Empirical Tokenomics Benchmarks

### Table 1: All 14 Reference Examples (`examples/`)
Audited with `--check-drift` enforcing **100% zero target drift**:

| File | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |
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

| Project | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| `dogMax` (27 files) | C++20 | 8,349 | 4,488 | **-46.2%** | 8,364 | 4,488 | **-46.3%** | -56.1% |
| `snake_pp` (22 files) | C++20 | 8,065 | 2,948 | **-63.4%** | 8,183 | 2,989 | **-63.5%** | -66.8% |
| `snake_ts` (18 files) | TypeScript | 87,759 | 65,333 | **-25.6%** | 87,962 | 65,481 | **-25.6%** | -27.9% |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **TOTAL (3 Projects / 67 Files)** | **Aggregated** | **104,173** | **72,769** | **-30.1%** | **104,509** | **72,958** | **-30.2%** | **-33.8%** |

### Table 3: Real AI Agent Benchmarks — 30 Live Autonomous Agent Transcripts (`docs/BENCHMARKS.md`)
Verified by running **30 real autonomous AI agent (`agy -p`) sessions** (`10 scenarios × 3 modes`) in isolated temporary workspaces on disk and parsing ground-truth telemetry from each agent's `.system_generated/logs/transcript.jsonl` (`PLANNER_RESPONSE` turns, `tool_calls`, working payload tokens, `output_tokens`, `input_tokens`, and `cache_read_tokens`), with **100% on-disk native mutation verification** and **0 `.aice` files left on disk**:

| ID | Real-World Benchmark Scenario | Languages & Files | LLM Turns (No AICE / Pure AICE / +Idioms) | Tool Calls (No AICE / Pure AICE / +Idioms) | Working Tokens (No AICE / Pure AICE / +Idioms) | LLM Output Tokens (No AICE / Pure AICE / +Idioms) | Total API Context Tokens (No AICE / Pure AICE / +Idioms) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window App (from 0)** | `ts, html, css, json` (5) | 20 / **4** (-80%) / **3** (-85%) | 23 / **3** (-87%) / **2** (-91%) | 29,427 / **6,968** (-76.3%) / **2,980** (-89.9%) | 9,998 / **3,539** (-64.6%) / **923** (-90.8%) | 687,185 / **106,111** (-84.6%) / **70,390** (-89.8%) |
| `RW-02` | **Headless Python CLI Queue & Worker Daemon (from 0)** | `py, yaml, json` (4) | 7 / **4** (-43%) / **3** (-57%) | 9 / **3** (-67%) / **2** (-78%) | 13,435 / **6,311** (-53.0%) / **2,656** (-80.2%) | 5,478 / **3,196** (-41.7%) / **848** (-84.5%) | 203,341 / **104,793** (-48.5%) / **70,072** (-65.5%) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront** | `php, js, twig, css, html, yaml, json` (7) | 11 / **4** (-64%) / **3** (-73%) | 16 / **3** (-81%) / **2** (-88%) | 20,790 / **7,479** (-64.0%) / **3,692** (-82.2%) | 8,144 / **4,212** (-48.3%) / **1,399** (-82.8%) | 358,966 / **111,669** (-68.9%) / **73,297** (-79.6%) |
| `RW-04` | **Vite + TS + React TSX + CSS + HTML + JSON + YAML Dashboard** | `ts, tsx, css, html, json, yaml` (6) | 9 / **4** (-56%) / **3** (-67%) | 13 / **3** (-77%) / **2** (-85%) | 19,550 / **8,217** (-58.0%) / **3,539** (-81.9%) | 7,882 / **4,844** (-38.5%) / **1,317** (-83.3%) | 287,304 / **111,379** (-61.2%) / **72,688** (-74.7%) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Ledger Mesh** | `go, rs, yaml, json` (4) | 7 / **4** (-43%) / **3** (-57%) | 10 / **3** (-70%) / **2** (-80%) | 15,754 / **6,444** (-59.1%) / **2,618** (-83.4%) | 6,484 / **3,275** (-49.5%) / **814** (-87.5%) | 211,587 / **104,895** (-50.4%) / **69,875** (-67.0%) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TS Inspector Overlay** | `cpp, ts, html, css, json` (5) | 9 / **4** (-56%) / **3** (-67%) | 12 / **3** (-75%) / **2** (-83%) | 17,658 / **6,946** (-60.7%) / **2,666** (-84.9%) | 6,812 / **3,424** (-49.7%) / **922** (-86.5%) | 276,946 / **105,049** (-62.1%) / **70,256** (-74.6%) |
| `RW-07` | **C# .NET Payment Settlement + Kotlin Fraud Scoring Engine** | `cs, kt, yaml, json` (4) | 7 / **4** (-43%) / **3** (-57%) | 10 / **3** (-70%) / **2** (-80%) | 15,737 / **7,252** (-53.9%) / **2,629** (-83.3%) | 7,078 / **4,055** (-42.7%) / **841** (-88.1%) | 203,470 / **106,716** (-47.5%) / **69,969** (-65.6%) |
| `RW-08` | **Python FastAPI + TSX + Twig Invoice Studio + CSS + JSON + YAML** | `py, tsx, twig, css, json, yaml` (6) | 14 / **4** (-71%) / **3** (-79%) | 13 / **3** (-77%) / **2** (-85%) | 18,074 / **7,325** (-59.5%) / **3,353** (-81.5%) | 6,978 / **4,054** (-41.9%) / **1,110** (-84.1%) | 404,815 / **110,500** (-72.7%) / **72,396** (-82.1%) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon** | `rs, cpp, py, go, yaml, json` (6) | 9 / **4** (-56%) / **3** (-67%) | 13 / **3** (-77%) / **2** (-85%) | 21,916 / **8,062** (-63.2%) / **3,819** (-82.6%) | 8,839 / **4,827** (-45.4%) / **1,520** (-82.8%) | 303,664 / **113,673** (-62.6%) / **73,355** (-75.8%) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability Control Plane** | `All 15 (.ts..twig)` (15) | 33 / **4** (-88%) / **3** (-91%) | 32 / **3** (-91%) / **2** (-94%) | 53,049 / **14,264** (-73.1%) / **5,053** (-90.5%) | 20,591 / **10,800** (-47.5%) / **2,538** (-87.7%) | 1,473,502 / **135,281** (-90.8%) / **81,209** (-94.5%) |
| **TOTAL** | **All 10 Scenarios (`10/10` Wins — 30 Real Agent Sessions)** | **15/15 Languages** | **126** / **40** (-68.3%) / **30** (-76.2%) | **151** / **30** (-80.1%) / **20** (-86.8%) | **225,390** / **79,268** (-64.8%) / **33,005** (-85.4%) | **88,284** / **46,226** (-47.6%) / **12,232** (-86.1%) | **4,410,780** / **1,110,066** (-74.8%) / **723,507** (-83.6%) |

Full 30-session ground-truth audit trail (including all `conversationId` UUIDs and raw `transcript.jsonl` metrics): see [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) and [`benchmarks/real-agent-results.json`](benchmarks/real-agent-results.json) (`npm run benchmark` / `npm run benchmark:agents`).

### Table 4: Deterministic Offline Benchmarks — Without Idioms vs. With Idioms (`docs/BENCHMARKS_OFFLINE.md`)
Evaluated deterministically offline (exact `o200k_base` BPE token & turn accounting across `Write from 0` incl. `$idiom` definition cost, `Read`, `Surgical Update`, `Surgical Delete`, and `Multi-File Refactor`):

| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Id / Id) | Read (No Id / Id) | Update (No Id / Id) | Delete | Refactor (No Id / Id) | Tokens Without AICE | Tokens AICE (No Id) | Tokens AICE (With Id) | Turns Without AICE | Turns AICE (No Id) | Turns AICE (With Id) |
| :--- | :--- | :---: | :---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window App (from 0)** | `window` | `from_zero_window_app` | `.ts .html .css .json` | -21.1% / **-46.1%** | -36.9% / **-60.1%** | -57.1% / **-75.0%** | **-91.6%** | -56.9% / **-96.9%** | 11,038 | 5,934 (**-46.2%**) | 2,638 (**-76.1%**) | 46 | 17 (**-63.0%**) | 13 (**-71.7%**) |
| `RW-02` | **Headless Python CLI Queue & Worker Daemon (from 0)** | `non_window` | `from_zero_non_window_app` | `.py .yaml .json` | -13.0% / **-37.9%** | -26.5% / **-47.9%** | -47.0% / **-67.5%** | **-90.1%** | -51.3% / **-96.4%** | 7,852 | 4,783 (**-39.1%**) | 2,226 (**-71.7%**) | 37 | 14 (**-62.2%**) | 11 (**-70.3%**) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront** | `window` | `bug_fix` | `.php .js .twig .css .html .yaml .json` | -19.5% / **-39.8%** | -28.0% / **-51.5%** | -55.7% / **-74.2%** | **-92.8%** | -56.7% / **-95.1%** | 12,061 | 6,731 (**-44.2%**) | 3,225 (**-73.3%**) | 55 | 23 (**-58.2%**) | 17 (**-69.1%**) |
| `RW-04` | **Vite + TS + React TSX + CSS + HTML + JSON + YAML Dashboard** | `window` | `new_feature` | `.ts .tsx .css .html .json .yaml` | -19.1% / **-40.7%** | -41.0% / **-62.6%** | -27.5% / **-57.2%** | **-93.7%** | -55.0% / **-95.1%** | 10,303 | 6,011 (**-41.7%**) | 2,835 (**-72.5%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Ledger Mesh** | `non_window` | `update_feature` | `.go .rs .yaml .json` | -25.4% / **-45.0%** | -39.0% / **-59.0%** | -52.4% / **-72.0%** | **-93.5%** | -55.3% / **-96.0%** | 9,697 | 5,261 (**-45.8%**) | 2,447 (**-74.8%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TS Inspector Overlay** | `window` | `bug_fix` | `.cpp .ts .html .css .json` | -18.9% / **-40.5%** | -36.7% / **-59.2%** | -57.8% / **-74.6%** | **-93.3%** | -56.1% / **-95.8%** | 10,195 | 5,586 (**-45.2%**) | 2,567 (**-74.8%**) | 39 | 17 (**-56.4%**) | 13 (**-66.7%**) |
| `RW-07` | **C# .NET Payment Settlement + Kotlin Fraud Scoring Engine** | `non_window` | `new_feature` | `.cs .kt .yaml .json` | -18.9% / **-40.2%** | -23.5% / **-41.7%** | -25.1% / **-51.9%** | **-94.3%** | -54.4% / **-95.9%** | 8,696 | 5,235 (**-39.8%**) | 2,528 (**-70.9%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-08` | **Python FastAPI + TSX + Twig Invoice Studio + CSS + JSON + YAML** | `window` | `update_feature` | `.py .tsx .twig .css .json .yaml` | -14.6% / **-38.3%** | -32.5% / **-57.1%** | -52.7% / **-72.6%** | **-92.5%** | -53.4% / **-95.2%** | 10,787 | 6,309 (**-41.5%**) | 2,921 (**-72.9%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon** | `non_window` | `bug_fix` | `.rs .cpp .py .go .yaml .json` | -18.3% / **-40.8%** | -35.2% / **-55.4%** | -55.8% / **-72.6%** | **-94.4%** | -55.1% / **-96.0%** | 14,270 | 7,988 (**-44.0%**) | 3,695 (**-74.1%**) | 47 | 20 (**-57.5%**) | 15 (**-68.1%**) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability Control Plane** | `window` | `update_feature` | `All 15 (.ts..twig)` | -19.2% / **-39.9%** | -29.8% / **-50.9%** | -56.6% / **-73.7%** | **-94.3%** | -56.2% / **-95.7%** | 32,344 | 18,039 (**-44.2%**) | 8,900 (**-72.5%**) | 108 | 47 (**-56.5%**) | 33 (**-69.4%**) |
| **TOTAL** | **All 10 Real-World Scenarios (`10/10` Wins)** | **Both** | **All 5** | **All 15** | **-18.9% / -40.8%** | **-32.9% / -54.5%** | **-52.2% / -71.3%** | **-92.8%** | **-55.4% / -95.8%** | **127,243** | **71,877 (-43.5%)** | **33,982 (-73.3%)** | **502** | **206 (-59.0%)** | **154 (-69.3%)** |

Full offline deterministic per-module breakdown: see [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md) (`npm run benchmark:offline`).



---

## ⚡ Twinless On-the-Fly Mode (`mode: "twinless"`) & Side-by-Side Architecture

AICE 2.0 supports two complementary operational modes:

### Mode A: Twinless On-the-Fly Mode (`mode: "twinless"` — Zero `.aice` Files on Disk)
- **Zero `.aice` Disk Pollution**: Native files (`*.ts`, `*.py`, `*.go`, `*.rs`, `*.cpp`, `*.cs`, `*.kt`, `*.php`, `*.css`, `*.html`) remain the sole source files on disk.
- **In-RAM Decompilation & `$idiom` Collapsing**: `aice outline <file>` and `aice context <file> [-s <symbol>]` decompile native files in RAM on-the-fly and automatically collapse active project `$idioms` from `aice.config.json`.
- **Smart Multi-File Idioms**: `aice idioms scan` mines repeated expressions and statement blocks across native files using structural anti-unification and caches SHA-256 provenance in `.aice-cache/idioms.json`. `aice idioms read $name` lists every occurrence across files (`file:line` + bound arguments), and `aice idioms update $name "<newTemplate>"` rewrites all occurrences across all native files in a single atomic operation.
- **Forgiving Direct-to-Native Surgical Splice**: `aice splice <nativeFile> -s <Class.method>` accepts pure AICE, AICE with `$idioms`, raw native code, or hybrid "Frankenstein" syntax, expanding `$idioms` and replacing only the exact AST byte-span of the target symbol while preserving 100% of surrounding comments, decorators, and formatting.

### Mode B: Side-by-Side Zero-Folder-Disruption Architecture
In real-world development, moving files into quarantine/shadow folders breaks bundlers, relative imports, and git history. AICE solves this by keeping target files and AICE files **side-by-side** in the exact same directory, backed by a **4-Layer Defense-in-Depth System**:

```
src/sim/
├── Boss.ts           <-- Read-only lock (chmod 444). Hidden from AI by files.exclude & .cursorignore
└── Boss.ts.aice       <-- VISIBLE to AI as single authoritative source of truth
```

### The 4-Layer Defense Mechanism:
1. **Layer 1: IDE Sibling Conditional Exclusion (`.vscode/settings.json`)**:
   Uses native IDE conditional when-clauses (`"**/*.ts": { "when": "$(basename).ts.aice" }`). In Cursor, VS Code, and Windsurf, `Boss.ts` completely disappears from the file tree, fuzzy finders, and symbol indexing whenever `Boss.ts.aice` exists alongside it.
2. **Layer 2: Universal AI Agent Ignores (`.cursorignore`, `.geminiignore`, `.aiderignore`, `.agentignore`)**:
   Prevents AI tool search calls (`list_dir`, `find`, `grep`) and codebase vector embeddings from indexing target files.
3. **Layer 3: Cognitive Lockdown Directives (`AGENTS.md`, `.cursorrules`)**:
   Informs AI agents that this project is authoritatively written in AICE (`*.aice`), target files are machine-generated read-only build artifacts, and direct edits to target files are prohibited.
4. **Layer 4: Filesystem Protection & Live Watch Daemon (`chmod 444` + `aice watch`)**:
   Generated target files are marked read-only on disk (`0o444`). If an AI agent attempts a raw write or edit, the OS raises `EACCES: permission denied`. When `Boss.ts.aice` is saved, the `aice watch` daemon atomically unlocks `Boss.ts`, recompiles it in $< 5\text{ms}$, and relocks it, triggering instant Hot Module Reloading (HMR).

---

## 🚀 Quick Start & Installation

### Option 1: Local Link (Recommended for Development)
Link directly to your local AICE repository so any compiler updates are instantly live everywhere:
```bash
cd /path/to/aice
ln -sf $(pwd)/bin/aice.mjs ~/.local/bin/aice
```
*(Or with Bun: `bun link`)*

### Option 2: Standalone Single Binary (Zero Dependencies)
Compile into a standalone Linux executable (no Node or Bun required in target projects):
```bash
bun build --compile /path/to/aice/bin/aice.ts --outfile ~/.local/bin/aice
```

Verify installation:
```bash
aice --version
aice --help
```

---

## 💻 CLI Command Reference

### Adoption, Companion & Bidirectional Sync
```bash
# 1. Adopt an existing codebase into side-by-side AICE architecture:
# (Decompiles targets in parallel, injects AI shield rules, and locks targets to chmod 444)
aice adopt [dir] [-c <concurrency>]

# 2. Adopt into an isolated companion twin workspace with project idioms:
aice adopt [companionDir] --companion [targetDir] --idioms

# 3. Start the high-speed incremental watch daemon during active coding:
# (Listens to *.aice changes, recompiles to targets in <5ms, and preserves HMR)
aice watch [dir]
aice dev [dir]

# 4. Bidirectional companion watch (watches target files and reverse-syncs external edits into .aice):
aice watch [dir] --bidirectional

# 5. One-shot bidirectional sync from targets back to .aice:
aice sync [dir]

# 6. Eject side-by-side mode and restore standard project state:
# (Unlocks target files back to chmod 644 and removes AI shield rules)
aice eject [dir]
aice eject [dir] --remove-aice   # Optional: deletes .aice source files

# 7. Fine-grained shield management (including Twinless On-the-Fly shield):
aice shield apply [dir] --twinless  # Configure Twinless mode (zero .aice files on disk)
aice shield status [dir]            # Check active shield rules and locks
aice shield lock [dir]              # Lock target files to chmod 444
aice shield unlock [dir]            # Unlock target files to chmod 644
aice shield apply [dir]             # Deploy .cursorignore, settings.json, and AGENTS.md
aice shield remove [dir]            # Remove shield rules
```

### Smart Multi-File Idioms (`$idioms`)
```bash
# Scan native or .aice workspace to discover repetitive AST templates & build .aice-cache/idioms.json:
aice idioms scan [dir] --min-occurrences 3 --min-savings 10

# Inspect an idiom's template, parameters, and every file:line occurrence across the project:
aice idioms read '$clamp' [dir]

# Mutate an idiom's template and rewrite all occurrences across all native files atomically:
aice idioms update '$clamp' "Math.max($1, Math.min($2, $0))" [dir]
aice idioms update '$clamp' "Math.max($1, Math.min($2, $0)) * $3" --params '$0,$1,$2,$3=1.0' [dir]

# Instant toggle of on-the-fly $idiom collapsing in aice.config.json:
aice idioms on [dir]
aice idioms off [dir]

# Synthesize discovered idioms into .aice files (Side-by-Side mode) or expand back:
aice idioms apply [dir]
aice idioms list [dir]
aice idioms expand [dir]
```

### AI Agent On-the-Fly Context, Surgical Splicing, MCP & Evolution
```bash
# Generate 1-turn token-bounded context pack from a native file (or single symbol with -s):
aice context src/sim/Hazard.ts --depth 2 --max-tokens 4000
aice context src/sim/Hazard.ts -s HazardManager.calculateDamage --idioms

# Generate structural skeleton outline of any native or .aice file/directory (85-95% token reduction):
aice outline src/sim/Hazard.ts --stats

# Surgically replace or delete AST symbols directly in native files (accepts AICE, $idioms, raw, or hybrid):
aice splice src/sim/Hazard.ts -s HazardManager.calculateDamage -c "pub fn calculateDamage(d: int) -> int: ret $clamp(d * 2, 0, 100)"
aice splice src/sim/Hazard.ts -s HazardManager.calculateDamage --body "ret d * 2"
aice splice src/sim/Hazard.ts -s HazardManager.obsoleteHelper --delete
aice splice --batch '[{"filePath":"src/a.ts","symbol":"fnA","code":"pub fn fnA() -> int: ret 1"}]'

# Run the 10 Real-World Benchmarks Suite (Without Idioms & With Idioms):
npm run benchmark

# Run test suite with symbol-mapped runtime stack trace translation and auto-recompilation:
aice test
aice test tests/unit/service.test.ts --json

# Launch the First-Class Model Context Protocol (MCP) server over stdio:
aice mcp

# Run the 5-Gate Differential Fuzzing & Autonomous Self-Healing Evolution Campaign:
aice evolve --restarts 100 --cycles 10
aice evolve --cycles 50 --seed 1337 --json
```

### Compilation & Decompilation
```bash
# Compile a single .aice file to its target language:
aice compile src/Boss.ts.aice

# Recursively compile all .aice files across a project:
aice compile-all ./src

# Clean all generated target files:
aice clean ./src

# Decompile a target file (.ts, .tsx, .css, .html, .go, .rs, .py, .kt, etc.) into .aice:
aice decompile src/Boss.ts --trivia
```

### Verification & Autonomous Self-Repair
```bash
# Verify syntax, immutability, and type soundness without emitting:
aice verify src/Boss.ts.aice

# Output machine-readable JSON telemetry for AI agents:
aice verify src/Boss.ts.aice --json

# Autonomously repair fixable violations (mutability, division by zero, truthiness):
aice fix src/Boss.ts.aice
aice fix src/Boss.ts.aice --dry-run

# Audit token efficiency and compression density for a specific file or folder (with subfolders):
aice tokens src/sim/Hazard.ts
aice tokens src/sim/Hazard.ts --check-drift
aice tokens src/sim
aice efficiency ./src

# Audit tokenomics and enforce zero target drift:
aice verify-tokenomics examples --check-drift
aice verify-tokenomics poc_real_case --projects
```

### Bidirectional Roundtrip & Language Server
```bash
# Verify Put/Get roundtrip stability (Put(Get(c), Omega) == c):
aice roundtrip src/Boss.ts

# Launch the AICE Language Server Protocol (LSP) daemon over stdio:
aice lsp
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

# Idiom definition stored in aice.config.json and expanded losslessly during target compilation:
# "$dist2d": { "params": ["$0", "$1"], "templateAice": "hypot($0.x - $1.x, $0.y - $1.y)" }
```

---

## 🔬 The Bidirectional Lens Theorem

AICE 2.0 implements formal asymmetric lenses over Concrete Syntax Trees:

$$\text{Get} : \mathcal{C} \to \mathcal{A}$$
$$\text{Put} : \mathcal{A} \times \Omega \to \mathcal{C}$$

Where $\mathcal{C}$ is the target language concrete syntax, $\mathcal{A}$ is the AICE abstract syntax, and $\Omega$ is the CST Trivia Table. Every roundtrip satisfies:

$$\text{Put}(\text{Get}(c)) \equiv c$$

All comments, JSDoc blocks, and docstrings are inlined directly into `*.aice` source files as standard `#` comments, ensuring humans and AI coding models can read and edit documentation directly without polluting repositories with external sidecar `.json` files.

---

## 🛠️ Project Structure

```
aice/
├── bin/
│   ├── aice.ts                 # Full CLI command suite
│   └── aice.mjs                # Node/Bun executable wrapper
├── docs/
│   ├── AICE_SPEC.md            # Normative language specification (EBNF)
│   ├── AI_SYSTEM_PROMPT.md    # System prompt for LLM code generation
│   └── CST_TRIVIA_SPEC.md     # Lens and trivia table technical spec
├── examples/                  # 14 reference multi-language examples
├── poc_real_case/             # 67 real-world case study modules
│   ├── dogMax/                # Raylib C++ game combat subsystem
│   ├── snake_pp/              # SFML C++ snake engine
│   └── snake_ts/              # Canvas TypeScript simulation engine
├── src/
│   ├── cache/                 # Fast persistent CST & AST disk caching engine
│   ├── config/                # Project config (aice.config.json), mode resolver & paths
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
