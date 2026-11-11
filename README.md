![AICE — AI Context Engine](assets/aice-banner.jpg)

# AICE: On-the-Fly AI Context Engine & Multi-Language `$idioms` Splicer

[![Version: 0.9.24](https://img.shields.io/badge/Version-0.9.24-00bcd4.svg)](https://github.com/forart82/aice/releases)
[![Author: @forart82](https://img.shields.io/badge/Author-%40forart82-181717.svg?logo=github)](https://github.com/forart82)
[![GitHub Stars](https://img.shields.io/github/stars/forart82/aice?style=social)](https://github.com/forart82/aice/stargazers)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript 5.8+](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](https://www.typescriptlang.org/)
[![Bun 1.4+](https://img.shields.io/badge/Bun-1.4%2B-black)](https://bun.sh/)
[![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-green)](https://nodejs.org/)
[![Tests Passing](https://img.shields.io/badge/Tests-1%2C415%20passing-brightgreen)](tests/)
[![Token Savings](https://img.shields.io/badge/Token%20Savings-43%25%20--%2088%25-orange)](docs/BENCHMARKS.md)

> **A pure on-the-fly AST context packager, BPE-gated `$idiom` compressor, and surgical multi-language code splicer engineered for autonomous AI coding agents — with zero `.aice` files on disk.**

---

## ⚡ Executive Summary

Modern Large Language Models (LLMs) spend **40% to 85% of their context windows, tool calls, and output token budgets on syntactic noise and full-file re-reads**: closing XML/HTML tags (`</div>`, `</section>`), redundant curly braces (`{ ... }`), verbose ceremony (`std::cout << ... << std::endl`, `export interface`, `public readonly`), and repetitive multi-file boilerplate.

**AICE (AI Context Engine)** is a pure **On-the-Fly AI Context & Mutation Tool** that operates directly on native source files in RAM across **20 languages & 33 file extensions** with zero `.aice` files left on disk:

### Supported Languages & Formats (33 Extensions)
- **Web & Application**: TypeScript (`.ts`, `.tsx`, `.d.ts`), JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), PHP (`.php`), Kotlin (`.kt`, `.kts`), C# (`.cs`)
- **Systems & Backend**: Python (`.py`, `.pyi`), Go (`.go`), Rust (`.rs`), C++20 (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`)
- **Markup, Templates & Styling**: HTML (`.html`), CSS (`.css`), Twig (`.twig`), Markdown (`.md`, `.markdown`)
- **Data & Configuration**: JSON (`.json`), YAML (`.yaml`, `.yml`)
- **Shell & Scripting**: Shell (`.sh`, `.bash`, `.zsh`), PowerShell (`.ps1`), Batch (`.cmd`, `.bat`), AIPL (`.aipl`)

### Core Capability Matrix

| Tool & Phase | Key Capabilities | Eliminates / Replaces | Token Savings |
| :--- | :--- | :--- | :---: |
| **`aice create`**<br>_Greenfield Creation_ | Compiles compact AICE, inline `@idiom` macros, hybrid brace syntax, or unified multi-file `--stdin` streams (`=== <filePath> ===`) directly into clean native files. | Monolithic multi-turn file creation loops | **40–75%**<br>write tokens |
| **`aice outline`**<br>_In-RAM AST Decompilation_ | Summarizes files or workspaces (`aice outline src tests`) into structural skeletons with `[Lstart-Lend]` line ranges, named `test "..."` / `describe "..."` blocks, Markdown ATX headings, shell functions/labels, and syntax diagnostics. | Blind `ls`, `ls -la`, and full-file inspection | **85–90%**<br>read tokens |
| **`aice context`**<br>_1-Turn Context Stream_ | Extracts targets (`f1:s1 f2:s2`), `Class.method`, test IDs (`-s "TC-MENU-001"`), Markdown sections (`-s "Quick Start"`), exact line ranges (`-s "L180-L240"`), or regex searches (`-s "/pattern/"`) with deduplicated dependency contracts and **caller call-sites** (`[L14]`). | `grep -n`, `grep -rn`, `sed -n`, and `cat` | **70–85%**<br>context tokens |
| **`aice splice`**<br>_Lossless AST Splicing_ | Surgical in-place edits in RAM by symbol (`:Class.method`), AST hunks (`<<< / === / >>>`), clones (`@clone`), test IDs, Markdown headings, scripts, ranges (`:Lstart-Lend`), `:imports`, or `:eof`. Preserves leading JSDoc/docstrings via CST Trivia Lenses. | Fragile whole-file overwrites & search-replace | **90%+**<br>write tokens |
| **`aice idioms`**<br>_Smart Multi-File Macros_ | Automatically discovers or defines parameterized project-wide AST macros (e.g. `$clamp($0, $1, $2)`). Collapses occurrences into 1-line calls during inspection and mutates entire codebases in **1 turn** via `aice idioms update`. | Repetitive multi-file boilerplate edits | **60%+**<br>extra output savings |

---

## 🛠️ End-to-End C++20 On-the-Fly Workflow Example

![AICE End-to-End C++20 Workflow](assets/aice-cpp-workflow.jpg)

AICE reads native C++20 directly into RAM, compresses verbose C++ syntax and repetitive patterns into compact AICE + `$idioms` for the AI agent, and surgically splices the AI's compact edit back into the native `.cpp` file on disk.

### Built-In Idioms vs. Project-Specific Custom Idioms (`aice.config.json` / `.aice-idioms.json`)

AICE combines two layers of idiom compression:
- **Built-In Language Idioms**: Verbose standard-library constructs are automatically lowered and raised by the C++20 decompiler/emitter without configuration — for example, `std::cout << "[CARD] Sessions=" << sessions << std::endl;` automatically decompiles to `print("[CARD] Sessions=", sessions)` and compiles back to `std::cout << ... << std::endl;`.
- **Project-Specific Custom Idioms (`aice.config.json` / `.aice-idioms.json`)**: Repeating multi-statement bounds checks (`$clampBand`), metric formatters (`$fmtMetric`), or custom project wrappers (such as `givemeabigstring::out(msg)` $\leftrightarrow$ `$big_out(msg)`) are mined automatically via `aice idioms scan --save` or declared in `aice.config.json`:

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

### Step 1: Native C++20 Source File on Disk (`src/telemetry_report.cpp` — Panel 1)

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

### Step 2: Inspect Symbol-Scoped Context (`aice context --symbol buildNodeReport --idioms` — Panel 2)

The AI agent requests `buildNodeReport`. AICE decompiles the C++20 function in RAM and collapses the repeating bounds checks into `$clampBand(...)` and the string metric formatter into `$fmtMetric(...)` (`-71.3%` context tokens):

```bash
$ aice context src/telemetry_report.cpp --symbol buildNodeReport --idioms --no-callers
```

```aice
// Decompiled & $idiom-collapsed in RAM
pub fn buildNodeReport(cpu:int, mem:int, jit:int) -> str:
  $clampBand(cpu, 0, 100)
  $clampBand(mem, 128, 65536)

  header := "[Hello World]"
  lineCpu := $fmtMetric("cpu", cpu)
  ret header + " " + lineCpu

// Active Project Idioms:
// $clampBand(v, lo, hi)
// $fmtMetric(k, v) -> k + "=" + str(v)
```

### Step 3: Apply Surgical Edit in AICE (`aice splice --symbol buildNodeReport --idioms` — Panel 3)

The AI agent writes a compact AICE + `$idioms` edit that keeps `cpu` and `mem`, adds `$clampBand(jit, 5, 250)` and `lineJit := $fmtMetric("jit", jit)`, updates `header := "[Hello Peter]"`, and splices it directly into `src/telemetry_report.cpp` (`-74.2%` output tokens):

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

### Step 4: Updated Native C++20 on Disk (`src/telemetry_report.cpp` — Panel 4)

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

`src/telemetry_report.cpp` is updated atomically in-place on disk with valid C++20 (`g++ -std=c++20 -fsyntax-only` verified) and **zero `.aice` files created**.

---

## 📊 Empirical Benchmarks

AICE is rigorously benchmarked across both live adversarial AI coding agent sessions and deterministic offline suites:

- **Live Autonomous AI Agents ([`docs/BENCHMARKS.md`](docs/BENCHMARKS.md))**: In 33 live adversarial sessions across 15 languages, AICE reduced LLM turns by **68.5% to 78.5%**, working payload tokens by **59.3% to 77.5%**, LLM output tokens by **40.4% to 82.6%**, and real API cost by **66.0% to 81.2%**. Full audit trail: [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).
- **Deterministic Offline Suite ([`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md))**: Evaluated across 10 production scenarios covering all 15 languages, achieving **-43.4% to -73.2%** token reductions and **-59.0% to -69.3%** turn reductions. Full breakdown: [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md).

---

## 🚀 Quick Start & Universal Linux Installation

### Option 1: One-Line Git Clone & Universal Linux Installer (`./install.sh` — Recommended)
Automatically detects your Linux distro (`apt-get`, `dnf`/`yum`, `pacman`, `zypper`, `apk`), verifies/installs `git`, `curl`, `node >= 20`, and `npm`, detects installed vs. local vs. `origin/main` versions, registers `~/.local/bin/aice`, regenerates MCP tool schemas (`~/.gemini/antigravity-cli/mcp/aice/`), refreshes AICE rule blocks across all existing AICE-enabled projects in `~/dev/*`, and wires `aice mcp` + system instructions into your installed CLI coding agents:

```bash
git clone https://github.com/forart82/aice.git && cd aice && ./install.sh

# In-place update & non-interactive / CI flags (works even when AICE is already installed):
./install.sh --update           # Pull newest origin/main (if ahead) & refresh binary, MCP schemas, global agents & ~/dev/* rules
./install.sh --yes              # Auto-confirm dependencies, git update & Zsh cheatsheet
./install.sh --no-update        # Skip remote git check and refresh local working tree in-place
./install.sh --no-cheatsheet    # Skip Zsh startup cheatsheet prompt
./install.sh --no-agents        # Skip automatic CLI agent configuration
./install.sh --dry-run          # Preview all actions without mutating disk
```

### Universal Linux Uninstaller (`./uninstall.sh`)
Cleanly removes the `~/.local/bin/aice` symlink, CLI coding agent MCP/prompt registrations (`aice agents remove`), the Zsh startup cheatsheet in `~/.zshrc`, global `~/.aice` telemetry state, and all `aice.config.json` files across your projects:

```bash
./uninstall.sh

# Optional flags:
./uninstall.sh --projects-dir ~/dev     # Scan a specific root directory for aice.config.json files
./uninstall.sh --keep-project-configs   # Preserve project aice.config.json files
./uninstall.sh --keep-telemetry         # Preserve ~/.aice telemetry ledger
./uninstall.sh --dry-run                # Preview all files/configs that would be removed
```

### Option 2: Manual Symlink or Standalone Single Binary
```bash
# Manual symlink:
cd /path/to/aice
ln -sf "$(pwd)/bin/aice.mjs" ~/.local/bin/aice

# Or compile a standalone single binary with Bun:
bun build --compile /path/to/aice/bin/aice.ts --outfile ~/.local/bin/aice
```

> **Note for standalone binary distribution:** When distributing standalone binaries compiled with `bun build --compile`, accompany the executable with [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt) to satisfy third-party licenses (MIT, BSD, ISC, Apache-2.0, Bun runtime).

Verify installation & agent integration:
```bash
aice --version
aice agents status
aice gain
```

---

## 🤖 Automatic CLI Coding Agent Integration (`aice agents`)

`aice agents` automatically registers the global `aice mcp` stdio server and injects the canonical versioned `<!-- AICE:START v0.9.24 --> ... <!-- AICE:END -->` system directive across major Linux CLI coding agents so they automatically use AICE across all 33 supported file extensions (`.ts`, `.tsx`, `.d.ts`, `.js`, `.jsx`, `.mjs`, `.cjs`, `.py`, `.pyi`, `.rs`, `.go`, `.cpp`, `.hpp`, `.cc`, `.cxx`, `.h`, `.cs`, `.html`, `.css`, `.json`, `.yaml`, `.yml`, `.twig`, `.php`, `.kt`, `.kts`, `.sh`, `.bash`, `.zsh`, `.ps1`, `.cmd`, `.bat`, `.md`, `.markdown`, `.aipl`):

| CLI Coding Agent | MCP Server Config | System Prompt / Rules |
| :--- | :--- | :--- |
| **Claude Code (`claude`)** | `~/.claude.json` & `~/.claude/settings.json` (`mcpServers.aice`) | `~/.claude/CLAUDE.md` |
| **Antigravity / Gemini CLI (`agy` / `gemini`)** | `~/.gemini/config/mcp_config.json` & `~/.gemini/settings.json` (`mcpServers.aice`) | `~/.gemini/GEMINI.md` & `~/.gemini/config/rules/aice.md` |
| **OpenAI Codex CLI (`codex`)** | `~/.codex/config.toml` (`[mcp_servers.aice]`) | `~/.codex/AGENTS.md` |
| **OpenCode (`opencode`)** | `~/.config/opencode/opencode.json` (`mcp.aice` & `mcpServers.aice`) | `~/.config/opencode/AGENTS.md` |
| **Aider (`aider`)** | `~/.aider.conf.yml` (`read:` conventions list) | `~/.aider/CONVENTIONS.md` |
| **Goose CLI (`goose`)** | `~/.config/goose/config.yaml` (`extensions.aice`) | MCP tool descriptions |
| **Cursor Agent (`cursor`)** | `~/.cursor/mcp.json` (`mcpServers.aice`) | MCP tool descriptions |

```bash
aice agents setup               # Configure installed CLI coding agents idempotently
aice agents setup --all         # Pre-configure all 8 agent targets
aice agents status [--json]     # Inspect binary detection, MCP config, and rule version sync status (v0.9.24)
aice agents remove              # Cleanly strip AICE entries without losing user settings
```

---

## ⚙️ Project-Level Controls (`aice.config.json`) & First-Class MCP Server (`aice mcp`)

Every CLI command and all **7 First-Class MCP tools** (`aice_context`, `aice_outline`, `aice_splice`, `aice_create`, `aice_idioms`, `aice_gain`, `aice_project_config`) enforce strict workspace path sandboxing and respect project-level configuration in `aice.config.json` (or `.aicerc` / `package.json#aice`):

| MCP Tool | Capabilities |
| :--- | :--- |
| `aice_context` | Single or multi-file context stream (`paths` array or space-separated `path` with inline `:symbol` / `:Lstart-Lend` / `:/pattern/` selectors), deduplicated dependency contracts, and `[Lline]` downstream callers |
| `aice_outline` | Structural skeleton outlines across one or more files or directories (`path` / `paths`) with `[Lstart-Lend]` spans, `compact` mode, `depth`, and syntax diagnostics |
| `aice_splice` | Surgical in-place AST replacement, deletion, `<<< / === / >>>` hunk patching, `@clone(SourceSym)` cloning, or unified multi-file `=== <filePath>:<symbol> ===` / `edits` / `files` batch streams (`dryRun`, `preserveDocs`, `insertBefore`/`insertAfter`) |
| `aice_create` | Greenfield single-file or multi-file `=== <filePath> ===` / `files` batch creation across all 20 languages & 33 extensions with inline `@idiom` expansion (`dryRun`, `overwrite`) |
| `aice_idioms` | Project `$idiom` lifecycle: `scan`, `list`, `read`, `update`, `apply`, `expand`, `on`, and `off` |
| `aice_gain` | Honest signed `cl100k_base` & `o200k_base` BPE token-savings telemetry (`project` drill-down, `unique` SHA-256 deduplication, `json` export) |
| `aice_project_config` | Inspect or toggle `enabled` & `idiomsEnabled` (`enable`, `disable`, `status`), `configFileExists`, and workspace `AGENTS.md` rule version sync (`v0.9.24`) |

- **Disable AICE completely for a project (`"enabled": false`)**:
  ```json
  {
    "enabled": false
  }
  ```
  Or toggle via CLI:
  ```bash
  aice disable [dir]            # Sets "enabled": false and strips workspace AICE rules
  aice enable [dir]             # Sets "enabled": true and injects AGENTS.md & .agents/rules/aice.md
  aice config [dir]             # Inspect current project AICE & $idioms status
  ```
- **Disable only `$idioms` while keeping AICE AST tools active (`"idiomsEnabled": false` or `"idioms": false`)**:
  ```json
  {
    "enabled": true,
    "idiomsEnabled": false
  }
  ```
  Or toggle via CLI:
  ```bash
  aice idioms off [dir]         # Sets "idiomsEnabled": false
  aice idioms on [dir]          # Sets "idiomsEnabled": true
  ```

---

## 📈 Honest BPE Token-Savings Telemetry & Session Analyzer (`aice gain` & `aice analyze`)

`aice gain` (aliases `aice gains`, `aice stats`, and MCP tool `aice_gain`) tracks real-world token reductions in `~/.aice/telemetry/gains.jsonl` using exact `cl100k_base` and `o200k_base` BPE tokenizers with **100% honest signed accounting** (never clamping negative overhead calls to zero and never double-counting MCP-to-CLI internal calls). `aice analyze` reconstructs post-session agent transcripts alongside `~/.aice/telemetry` (including CLI/MCP failure & error telemetry) to audit session count, LLM turns, thinking vs. working payload tokens, AICE compliance rate, and tool friction:

```bash
aice gain                                 # Global summary banner, operation/surface table, language table & ranked projects
aice gain <project-name-or-.>             # Per-project drill-down: read/write/idiom split, top files & last 15 operations
aice gain --unique                        # Deduplicate repeated identical operations by SHA-256 contentHash
aice gain --json                          # Emit full structured JSON telemetry report
aice gain --reset --yes                   # Clear telemetry ledger

aice analyze [project-or-dir]             # Reconstruct sessions, token split, AICE compliance & failure/friction audit
aice analyze <project> --json             # Emit structured JSON post-session & error-telemetry analysis report
aice analyze . --transcripts-dir <dir>    # Scan a custom agent conversation transcripts directory
```

---

## 💻 CLI Command Reference

### 1. Greenfield File Creation, On-the-Fly Context, Skeleton Outlines & Surgical Splicing
```bash
# Create brand-new native files from compact AICE, hybrid braces, or multi-file --stdin across 33 extensions:
aice create src/renderer.ts -c '@idiom $clamp($0,$1,$2) = Math.min(Math.max($0,$1),$2)\npub fn bound(x:num) -> num => $clamp(x, 0, 100)'
aice create --batch '[{"filePath":"src/a.ts","code":"pub fn fnA() -> int => 1"},{"filePath":"src/b.py","code":"fn fnB() -> int => 2"}]'
aice create src/config.ts -c 'export const MAX_RETRIES = 5;' --overwrite

# Generate structural skeleton outline across files or multiple directories (replaces 'ls src tests' & 'grep -n'):
aice outline src tests
aice outline src tests --compact
aice outline tests/app.test.ts                          # Emits named test "..." # [Lstart-Lend] & describe "..." # [Lstart-Lend]
aice outline install.sh README.md                       # Emits shell functions, batch :labels, and Markdown ATX headings

# Generate 1-turn token-bounded context stream (replaces 'sed -n', 'grep -n', and 'grep -rn'):
aice context src/a.ts:fnA,fnB src/b.ts:L10-L50          # 1-turn multi-file stream with deduplicated dependency contracts
aice context src/app.ts -s "GameApp.getCoreConstants"   # Includes Downstream Callers with exact call-site [L14]
aice context tests/app.test.ts -s "TC-MENU-001"         # Extract test block by test ID or title prefix
aice context src/app.ts -s "L180-L240"                  # Zero-bloat fast-path 1-based numbered line range (180│ ...)
aice context src -s "/OracleIncoherenceAuditor/"        # 1-turn regex/substring search across file or directory
aice context README.md -s "Quick Start"                 # Extract Markdown section by heading

# 1-turn unified mixed create + surgical splice stream (:Class.method, @clone, :testId, :Heading, :Lstart-Lend, :eof, :imports, :overwrite):
aice splice --stdin << 'EOF'
=== src/new_helper.ts ===
export const BONUS_MULTIPLIER = 2;
=== src/constants.ts:eof ===
export const COMBO_BONUS = 50;
=== src/app.ts:imports ===
import { BONUS_MULTIPLIER } from "./new_helper.js";
=== src/board.ts:Board.isBoardEmpty ===
public isBoardEmpty(): boolean {
  return this.grid.every((row) => row.every((cell) => cell === null));
}
=== tests/board.test.ts:TC-BOARD-002 @clone(TC-BOARD-001) ===
"empty" -> "initialized"
true -> false
=== src/app.ts:L35-L42 ===
const scaledScore = baseScore * BONUS_MULTIPLIER;
=== src/generated.ts:overwrite ===
export const SCHEMA_VERSION = 2;
EOF

# AST-scoped hunk splicing (<<< / === / >>> inside :symbol — strictly scoped to AST span & immune to line shifts):
aice splice src/engine.ts -s GameEngine.step -c $'<<<\n  this.tickCount += 1;\n===\n  this.tickCount += BONUS_MULTIPLIER;\n>>>'

# Single-target splice, JSDoc/docstring replacement (@replace-docs / --no-preserve-docs), Markdown heading & symbol deletion:
aice splice src/telemetry_report.cpp -s buildNodeReport -c "pub fn buildNodeReport(m: TelemetryMetrics) -> str: ..." --idioms --in-place
aice splice src/tax.ts -s calculateTax -c "// @replace-docs\nexport function calculateTax(n: number): number { return n * 1.2; }"
aice splice src/tax.ts -s calculateTax -c "export function calculateTax(n: number): number { return n * 1.2; }" --no-preserve-docs
aice splice README.md -s "Quick Start" -c "## Quick Start\nRun ./install.sh -y"
aice splice src/sim/Hazard.ts -s HazardManager.obsoleteHelper --delete
```

### 2. Smart Multi-File Idioms (`$idioms`) & Project Toggles
```bash
# Scan native workspace to discover repetitive AST templates & persist to aice.config.json / .aice-cache/idioms.json:
aice idioms scan [dir] --save --min-occurrences 3 --min-savings 10

# Inspect an idiom's template, parameters, and every file:line occurrence across the project:
aice idioms read '$clamp' [dir]
aice idioms list [dir]

# Mutate an idiom's template and rewrite all occurrences across all native files atomically:
aice idioms update '$clamp' -c "Math.max($1, Math.min($2, $0))" [dir]
aice idioms update --batch '[{"name":"$clamp","code":"Math.max($1, Math.min($2, $0))"}]' [dir]

# Toggle project-level AICE or $idiom collapsing in aice.config.json:
aice enable [dir]
aice disable [dir]
aice idioms on [dir]
aice idioms off [dir]
```

### 3. Telemetry, Session Analyzer, Agent Integration, Semantic Diff, Patch & MCP Server
```bash
# Inspect honest BPE token-savings telemetry & post-session friction/error analysis:
aice gain
aice gain <project>
aice analyze [project]
aice analyze <project> --json

# Manage global CLI coding agent integrations:
aice agents setup
aice agents status
aice agents remove

# Structural AST diff & reversible patch application:
aice diff src/old.ts src/new.ts
aice patch src/target.ts patch.json

# Audit token efficiency and roundtrip parity:
aice tokens src/
aice verify --parity src/

# Launch the First-Class Model Context Protocol (MCP) server over stdio:
aice mcp

# Run the Offline & Real-Agent Benchmark Suites:
npm run benchmark:offline
npm run benchmark
```

---

## 🛠️ Project Structure

```
aice/
├── LICENSE                     # Apache-2.0 license
├── NOTICE                      # Apache-2.0 attribution notice (@forart82)
├── CITATION.cff                # GitHub academic / software citation metadata (v0.9.24)
├── AGENTS.md                   # Canonical workspace AICE 2.0 mandatory agent rules
├── vitest.config.ts            # Vitest test runner configuration
├── install.sh                  # Universal Linux installer & optional Zsh startup cheatsheet
├── uninstall.sh                # Universal Linux uninstaller & project config cleaner
├── .agents/
│   └── rules/aice.md           # Always-on workspace agent rule file
├── assets/
│   ├── aice-banner.jpg         # Official wide title banner
│   ├── aice-cpp-workflow.jpg   # End-to-End C++20 On-the-Fly Workflow diagram
│   └── aice-logo.jpg           # Official square logo
├── benchmarks/
│   ├── index.ts                # Benchmark suite public exports
│   ├── offline-suite.ts        # Deterministic 10-scenario / 15-language BPE benchmark engine
│   ├── real-agent-suite.ts     # Live 33-session autonomous agent benchmark verifier
│   ├── run-offline.ts          # CLI runner for offline benchmarks
│   ├── run-real-agents.ts      # CLI runner for live adversarial cold-start agent sessions
│   └── run.ts                  # CLI runner for full benchmark suite
├── bin/
│   ├── aice.ts                 # AICE CLI entrypoint
│   └── aice.mjs                # Node/Bun executable wrapper (symlink-safe)
├── docs/
│   ├── AICE_SPEC.md            # Normative language & AST specification (EBNF)
│   ├── AI_SYSTEM_PROMPT.md     # System prompt for LLM code generation & CLI usage
│   ├── BENCHMARKS.md           # Real AI agent benchmark report (33 live sessions)
│   ├── BENCHMARKS_OFFLINE.md   # Deterministic offline benchmark report
│   ├── CST_TRIVIA_SPEC.md      # Bidirectional lens and CST trivia table specification
│   └── RESEARCH_SYNTHESIS.md   # Tokenomics and AST anti-unification research synthesis
├── src/
│   ├── agents/                 # Global CLI coding agent integration engine (8 targets)
│   ├── cache/                  # Persistent AST & idiom provenance disk cache
│   ├── compat/                 # TypeScript compiler API compatibility layer
│   ├── config/                 # Project config (aice.config.json / enabled / idiomsEnabled) & path resolver
│   ├── core/                   # Lexer, Pratt Parser, AST, Tokens, Span, CST Trivia Lens
│   ├── decompiler/             # On-the-fly reverse transpilers across 20 languages / 33 extensions
│   ├── emitters/               # Multi-target native code generators across 20 languages / 33 extensions
│   ├── idioms/                 # BPE-gated AST anti-unification idiom miner & transformer
│   ├── mcp/                    # Workspace-sandboxed Model Context Protocol (MCP) stdio server (7 tools)
│   ├── rules/                  # Canonical versioned mandatory agent rules SSOT (mandatory-rules.ts)
│   ├── telemetry/              # Honest BPE token-savings ledger (aice gain) & session analyzer (aice analyze)
│   ├── tokenomics/             # TikToken BPE (`cl100k_base` / `o200k_base`) tokenomics engine
│   ├── tools/                  # On-the-fly tools: create, outline, context, splice, diff-patch, fmt, parity-gate
│   ├── typechecker/            # Static typechecker & autonomous self-repair engine
│   └── version.ts              # Single source of truth for AICE_VERSION (0.9.24)
└── tests/
    ├── unit/                   # Unit test suites
    └── integration/            # Multi-file roundtrip & operator pipeline integration suites
```

---

## 👤 Author, Citation & Support

- **Author**: Created and maintained by **[@forart82](https://github.com/forart82)**
- **Repository**: [https://github.com/forart82/aice](https://github.com/forart82/aice)
- **Star on GitHub**: If AICE saves you tokens, turns, and API cost across your AI coding agents, please consider giving [**forart82/aice**](https://github.com/forart82/aice) a ⭐ on GitHub!

### BibTeX Citation

```bibtex
@software{forart82_aice_2026,
  author       = {forart82},
  title        = {{AICE: On-the-Fly AI Context Engine \& Multi-Language \$idioms Splicer}},
  year         = {2026},
  version      = {0.9.24},
  publisher    = {GitHub},
  url          = {https://github.com/forart82/aice},
  license      = {Apache-2.0}
}
```

---

## 📜 License

Licensed under the [Apache License 2.0](LICENSE) (see also [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)).
Copyright (c) 2026 [forart82](https://github.com/forart82).

## 📊 Empirical Benchmarks

AICE is rigorously benchmarked across both live adversarial AI coding agent sessions and deterministic offline suites:

- **Live Autonomous AI Agents ([`docs/BENCHMARKS.md`](docs/BENCHMARKS.md))**: Evaluated across 33 live adversarial sessions in a 3-layer progressive lifecycle (Baseline, Feature Add, Cross-Cutting Telemetry/Persistence) across 15 languages. AICE achieved a **100% verification rate (11/11 scenarios)** vs 72.7% for native tools, reducing agent turns by up to **71.4%**, LLM output tokens by up to **78.4%**, and real API costs by up to **76.0%**. Full audit trail: [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md).
- **Deterministic Offline Suite ([`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md))**: Evaluated across 10 production scenarios covering all 15 languages, achieving **-43.4% to -73.2%** token reductions and **-59.0% to -69.3%** turn reductions. Full breakdown: [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md).
