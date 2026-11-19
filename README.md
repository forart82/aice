![AICE — AI Context Engine](assets/aice-banner.jpg)

# AICE: On-the-Fly AI Context Engine & Surgical Code Splicer

[![Version: 0.9.52](https://img.shields.io/badge/Version-0.9.52-00bcd4.svg)](https://github.com/forart82/aice/releases)
[![Author: @forart82](https://img.shields.io/badge/Author-%40forart82-181717.svg?logo=github)](https://github.com/forart82)
[![GitHub Stars](https://img.shields.io/github/stars/forart82/aice?style=social)](https://github.com/forart82/aice/stargazers)
[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](LICENSE)
[![TypeScript 5.8+](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](https://www.typescriptlang.org/)
[![Bun 1.4+](https://img.shields.io/badge/Bun-1.4%2B-black)](https://bun.sh/)
[![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-green)](https://nodejs.org/)
[![Tests Passing](https://img.shields.io/badge/Tests-1%2C620%2B%20passing-brightgreen)](tests/)
[![End-to-End Quota Savings](https://img.shields.io/badge/Net%20Quota%20Saved-%2B17%25%20--%20%2B25%25-00a86b)](docs/BENCHMARKS.md)

> **A pure on-the-fly context engine and atomic multi-file splicer for autonomous AI coding agents — cut wasted reads, output tokens, and broken disk writes with zero `.aice` files on disk.**

![How AICE Works](assets/aice-workflow.svg)

---

## ⚡ What Is AICE? (In 30 Seconds)

AI coding agents burn most of their token quota in two invisible ways:
1. **Context Bloat**: Stuffing entire 1,000-line files into chat history — where every wasted line gets **replayed across ~20+ subsequent turns** and pushes your session into the compaction wall early.
2. **Edit Repetition**: Re-emitting unchanged `Target` blocks or rewriting large files during edits, burning **4x-priced output tokens** and risking silent off-by-one line deletions.

**AICE (AI Context Engine)** gives your AI agent **2 smart tools** — **`aice read`** (MCP: `aice_read`, plus `aice search` / `aice find`) and **`aice splice`** (MCP: `aice_splice`, alias `aice write`) — that read files surgically and edit multiple files atomically in RAM, leaving **zero `.aice` files on disk** and zero changes to your builds or git history.

```mermaid
flowchart LR
    subgraph NoAICE["Without AICE (Multi-Turn Context Bloat)"]
        direction LR
        N1["Dump whole files + grep chains"] --> N2["Re-emit Target blocks in edits"]
        N2 --> N3["196K avg context -> early compaction"]
    end
    subgraph WithAICE["With AICE (1-Turn Surgical Loop)"]
        direction LR
        A1["aice read (9 KB cap, X-Ray, @focus)"] --> A2["aice splice (hunks or :L-R / --stdin)"]
        A2 --> A3["Syntax + :L guard — 0 broken writes"]
    end
    NoAICE -. "Switch to 2-tool AICE" .-> WithAICE
```

---

## 📊 What You Actually Win in Production (Live Measured Data)

### At a Glance

| Everyday Impact | What Changes for Your Agent | How AICE Makes It Automatic |
| :--- | :--- | :--- |
| **Leaner Reads Stay Out of History** | **`-43% to -56%`** smaller read payloads | `>120L` Monolith X-Ray outlines, `:sym@keyword` focus slices, `>110L` blank/import elision, and an aligned `9 KB` anti-spill ceiling. |
| **Nearly Half the Output Tokens** | **`-44% to -47%`** fewer `4x`-priced edit tokens | Multi-file `--stdin` batch streams (`<<< === >>>` or `:Lstart-Lend`) skip repeating unchanged `Target` blocks. |
| **Zero Wasted Slice & Retry Turns** | **`0`** extra pagination or flag-retry turns | Symbol/search hints instead of linear `:L` breadcrumbs, priority 1-turn multi-target batch packing (`aice read f1:sym f2 f3`), and an anti-pagination `AGENTS.md` rule settle reads in 1 turn. |
| **Longer Sessions Before Compaction** | **`119K`** avg window vs `196K` (`-39%`) | Agents run **~35% longer** before hitting the `200K` compaction wall. |
| **Zero Broken Disk Writes** | **`0`** broken files written to disk | Pre-write native syntax validation, inclusive `:L` off-by-one guard, and atomic `.tmp` -> `rename` commits. |

### Live Production Scorecard (`923` Real Calls / `633` AI Turns on `aipl_dog`)

Measured across **`13` autonomous workers** on real production tasks, priced in honest end-to-end billable quota (**`1x`** new input, **`0.1x`** cached history replay, **`4x`** output) after subtracting all AICE taxes (rule card, CLI wrapper, pagination, and retry turns):

| Metric | `v0.9.47 – v0.9.48` (880 calls / 543 turns) | `v0.9.49+` (Zero-Friction Engine) | Why It Matters |
| :--- | :---: | :---: | :--- |
| **Read / Search Payload vs Native** | `1.61M` vs `~2.82M` (`-43%`) | `49K` vs `~111K` (`-56%`) | Smaller reads stay out of chat history across ~23 subsequent turns. |
| **Edit Output Tokens (`splice` vs `edit_file`)** | `110K` vs `196K` (`-44%`) | `11.4K` vs `21.4K` (`-47%`) | Cuts **output tokens** (4x more expensive & slowest part of replies). |
| **Broken Files Written to Disk** | **`0` / 72 edits** | **`0` / 12 edits** | Pre-write syntax & `:L` guard caught **11** broken edits before disk write. |
| **Extra `9 KB` Pagination / Retry Turns** | `28` slice + `19` retry turns | **`0` wasted turns** | Coalescing, partial `9 KB` fill & flag normalization eliminated retry tax. |
| **Average Context Window Size** | `196K` tok / turn | **`119K` tok / turn (`-39%`)** | Agents work ~35% longer before hitting the `200K` compaction wall. |
| **Real Net End-to-End Quota Saved** | **`+5% to +11%` Net** | **`+17% to +25%` Net** | Honest bottom-line savings on your real LLM quota meter. |

> Controlled cold-start lab benchmarks (`RW-01`..`RW-11`, `11/11` wins) and full production telemetry breakdowns live in [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) and [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md).

---

## 🚀 60-Second Install & Easy Daily Guide (`./install.sh`)

### 1. Install (or Update) Globally

```bash
git clone https://github.com/forart82/aice.git && cd aice && ./install.sh

# Common update, non-interactive & uninstall flags:
./install.sh --update        # Pull origin/main & refresh binary, MCP schemas, agents & ~/dev/* rules
./install.sh -y              # Auto-confirm dependencies, git update & Zsh cheatsheet
./install.sh --dry-run       # Preview every step without mutating disk
./uninstall.sh               # Cleanly remove binary, MCP configs, Zsh block & optional project configs
```

**What `./install.sh` sets up automatically:**
- Detects your Linux package manager (`apt`, `dnf`/`yum`, `pacman`, `zypper`, `apk`), checks `git`, `curl`, `node >= 20`, `npm`, builds the bundle, and installs **`~/.local/bin/aice`**.
- Regenerates MCP tool schemas (`aice mcp --generate-schemas`) and wires the strict 2-tool **`aice mcp`** stdio server into installed CLI coding agents (`aice agents setup`).
- Refreshes single-file `AGENTS.md` rules across AICE-enabled projects in `~/dev/*` (strictly respecting `"enabled": false`).
- Optionally adds the **`aice-cheat`** startup cheatsheet box to `~/.zshrc` (skip anytime with `--no-cheatsheet`).

| CLI Coding Agent | Auto-Configured MCP / Config Path | Project Rule Footprint |
| :--- | :--- | :--- |
| **Claude Code (`claude`)** | `~/.claude.json` & `~/.claude/settings.json` (`mcpServers.aice`) | `AGENTS.md` *(+ existing `CLAUDE.md`)* |
| **Antigravity / Gemini CLI (`agy` / `gemini`)** | `~/.gemini/config/mcp_config.json` & `~/.gemini/settings.json` | `AGENTS.md` *(purges legacy duplicates)* |
| **OpenAI Codex CLI (`codex`)** | `~/.codex/config.toml` (`[mcp_servers.aice]`) | `AGENTS.md` |
| **OpenCode (`opencode`)** | `~/.config/opencode/opencode.json` (`mcp.aice`) | `AGENTS.md` |
| **Aider (`aider`)** | `~/.aider.conf.yml` (`read:` conventions list) | `CONVENTIONS.md` |
| **Goose CLI (`goose`)** | `~/.config/goose/config.yaml` (`extensions.aice`) | MCP tool descriptions |
| **Cursor Agent (`cursor`)** | `~/.cursor/mcp.json` (`mcpServers.aice`) | MCP tool descriptions |

<details>
<summary>Alternative: manual symlink or Bun standalone single binary</summary>

```bash
ln -sf "$(pwd)/bin/aice.mjs" ~/.local/bin/aice
# Or compile a standalone binary with Bun (include THIRD-PARTY-NOTICES.txt when distributing):
bun build --compile "$(pwd)/bin/aice.ts" --outfile ~/.local/bin/aice
```

</details>

Verify installation & agent integration anytime:

```bash
aice --version && aice agents status
```

### 2. Turn AICE On or Off Per Project

AICE is **opt-in per workspace** via `aice.config.json` and maintains a single compact **`<= 300`-token `AGENTS.md`** (`v0.9.52`) instruction card with explicit anti-pagination guardrails (automatically stripping legacy duplicate `GEMINI.md` / `.agents/rules/aice.md` blocks):

```bash
aice enable ~/dev/my-project    # Writes "enabled": true in aice.config.json + <=300-tok AGENTS.md
aice disable ~/dev/my-project   # Sets "enabled": false and strips AICE blocks cleanly
aice config ~/dev/my-project    # Inspect active settings (project $idioms are OFF by default)
```

> **Opt-in `$idioms` & `--dsl`**: Project `$idioms` (`"idiomsEnabled": false` by default) and AICE shorthand decompilation (`--dsl`) stay off unless explicitly enabled per call (`--dsl --idioms`) or per project (`aice idioms on`).

### 3. How Your AI Agent Uses It (Everyday Cheat-Sheet)

Autonomous agents see **strictly 2 MCP tools** (`aice_read` and `aice_splice`) — mirrored on the CLI by `aice read` (plus ergonomic `aice search` / `aice find`) and `aice splice` (alias `aice write`):

| Task | CLI Shortcut | MCP Tool (`tools/list`: strictly 2) |
| :--- | :--- | :--- |
| **List files (`< 20ms`, zero AST)** | `aice find "*.ts" src` *(alias: `tree`)* | `aice_read({ path: "src", filesOnly: true })` |
| **4-Tier ranked search (`<=40L` AST / `±10L`)** | `aice search "validateToken" src -C 5` *(alias: `grep`)* | `aice_read({ path: "src", search: "validateToken", contextLines: 5 })` |
| **1-Turn numbered native read (`<= 9 KB`)** | `aice read src/file.ts:sym@kw` | `aice_read({ path: "src/file.ts:sym@kw" })` |
| **Multi-file create & surgical splice** | `aice splice --stdin << 'EOF'` *(alias: `write`)* | `aice_splice({ code: "=== file:sym ===..." })` |

```bash
# 1. Fast workspace map (<20ms zero-AST file list) & ranked search
aice find "*.ts" src
aice search "validateToken" src -C 5

# 2. Smart 1-turn reads (9 KB cap, 1-based line numbers, zero linear :L pagination)
aice read src/app.ts                         # Bare file inline if <= 9 KB, or auto-outline + batch symbol/search hint
aice read src/monolith.ts:outline            # >120L Monolith X-Ray with internal landmarks
aice read src/monolith.ts:bigFn@keyword      # Focus slice inside a giant symbol around @keyword
aice read src/file.ts:fnA src/file.ts:fnB    # Batch symbols in 1 call (never walk :L1-L150 -> :L151-L300 across turns)
aice read src/a.ts:fnA src/big.ts src/b.ts   # 1-turn batch packing: explicit/small targets inline + oversized bare file auto-outlined

# 3. Surgical edits & multi-file --stdin batches (without repeating Target blocks)
aice splice src/engine.ts -s GameEngine.step -c $'<<<\n  this.tick += 1;\n===\n  this.tick += BONUS;\n>>>'

aice splice --stdin << 'EOF'
=== src/new_helper.ts ===
export const BONUS = 2;
=== src/constants.ts:eof ===
export const MAX_RETRIES = 3;
=== src/engine.ts:GameEngine.step ===
<<<
  this.tick += 1;
===
  this.tick += BONUS;
>>>
=== tests/app.test.ts:TC-02 @clone(TC-01) ===
"old" -> "new"
=== src/app.ts:L35-L42 ===
const scaled = base * BONUS;
EOF
```

### 4. Built-In Guardrails & Real Savings Telemetry (`aice gain` & `aice analyze`)

- **Anti-Pagination & 1-Turn Batch Packing (`v0.9.52`)**: Oversized or budget-capped files emit `batch symbols: aice read <file>:<sym1> <file>:<sym2> or aice search <pat> <file>` hints instead of linear `:L1-L140` breadcrumbs; `aice read f1:sym f2 f3` packs explicit selectors and small files first while auto-outlining oversized bare files in **1 turn**; and the `<= 300`-token `AGENTS.md` rule forbids sequential `:L1-L150` -> `:L151-L300` paging across turns.
- **Zero Broken Disk Writes**: Pre-write native syntax validation, an inclusive `:L` off-by-one guard, whitespace-resilient `<<< === >>>` dedent matching, `±5`-line syntax error context, and atomic `.tmp` -> `rename` commits roll back failed `--stdin` batches cleanly.
- **Smart Self-Healing Diagnostics**: Missing symbols trigger Levenshtein `Did you mean` hints, invalid regex patterns fall back safely to literal search, and MCP-style flags (`--files-only=true`, `--context-lines=5`) passed to CLI calls normalize automatically.
- **Honest Signed BPE Accounting**: Tracks `cl100k_base` & `o200k_base` deltas in a `< 250 B/event` numeric ledger (`~/.aice/telemetry/gains.jsonl`, zero raw source stored on disk), isolating `/tmp/*` and `swarm-*` sandboxes automatically.

```bash
aice gain              # Global summary, Rule Break-Even & <90s Repeat-Read Turn Warnings (alias: aice stats)
aice gain my-project   # Per-project drill-down & last 15 operations
aice analyze .         # Post-session readLoopAudit & Context Replay Token Tax report
aice gain --reset --yes
```

> **Optional Opt-In DSL & Custom `$idioms`**: Default `aice read` emits exact 1-based disk-numbered native code (`1│ ...`) for zero-translation 1-turn splicing. Pass `--dsl --idioms` (or enable `"idiomsEnabled": true` in `aice.config.json`) when you want compact AICE shorthand + project `$idioms` macro compression (see the full C++20 `$clampBand` walkthrough in [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md)).

---

## 🌍 Supported Languages (20 Languages, 33 Extensions)

| Domain | Languages & Extensions |
| :--- | :--- |
| **Web & App** | TypeScript (`.ts`, `.tsx`, `.d.ts`), JavaScript (`.js`, `.jsx`, `.mjs`, `.cjs`), PHP (`.php`), Kotlin (`.kt`, `.kts`), C# (`.cs`) |
| **Systems & Backend** | Python (`.py`, `.pyi`), Go (`.go`), Rust (`.rs`), C++20 (`.cpp`, `.cc`, `.cxx`, `.hpp`, `.h`) |
| **Markup & Styling** | HTML (`.html`), CSS (`.css`), Twig (`.twig`), Markdown (`.md`, `.markdown`) |
| **Data & Config** | JSON (`.json`), YAML (`.yaml`, `.yml`) |
| **Shell & Agents** | Shell (`.sh`, `.bash`, `.zsh`), PowerShell (`.ps1`), Batch (`.cmd`, `.bat`), AIPL (`.aipl`) |

---

## 📚 Deep-Dive Documentation (Advanced & Internal Details)

| Document | What It Covers |
| :--- | :--- |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Unified 2-tool engine, `9 KB` CLI/MCP water-filling budgets, `>120L` X-Ray, `:sym@pattern`, `>110L` elision, `>65L` search focus, inclusive `:L` guard, flag normalization & C++20 `--dsl --idioms` walkthrough. |
| [`docs/AICE_SPEC.md`](docs/AICE_SPEC.md) | Normative AICE EBNF grammar, canonical standard library, refinement calculus, lens theorems & CLI/MCP contract. |
| [`docs/AI_SYSTEM_PROMPT.md`](docs/AI_SYSTEM_PROMPT.md) | Full LLM system prompt & canonical `<= 300`-token `AGENTS.md` cheat-card specification. |
| [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) | Live 33-session adversarial benchmark (`RW-01`..`RW-11`) + 923-call `aipl_dog` multi-worker production ledger. |
| [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md) | Deterministic 10-scenario / 15-language offline BPE (`o200k_base`) benchmark breakdown. |
| [`docs/CST_TRIVIA_SPEC.md`](docs/CST_TRIVIA_SPEC.md) | Bidirectional lens & lossless Concrete Syntax Tree (CST) trivia table specification. |
| [`docs/RESEARCH_SYNTHESIS.md`](docs/RESEARCH_SYNTHESIS.md) | BPE pre-tokenization economics, Dyck-$k$ theory & the Symmetric Billable Quota Equation. |

### Project Layout

```text
aice/
├── bin/          # CLI entrypoint (read, search/grep, find/tree, splice/write)
├── src/
│   ├── tools/    # Unified read (9 KB cap, X-Ray, @focus, elision) & resilient splice engine
│   ├── mcp/      # Strict 2-tool MCP stdio server (aice_read, aice_splice)
│   ├── rules/    # Single-file <= 300-token AGENTS.md rule SSOT (mandatory-rules.ts)

---

## 👤 Author, Citation & License

- **Author**: Created and maintained by **[@forart82](https://github.com/forart82)**
- **Repository**: [https://github.com/forart82/aice](https://github.com/forart82/aice)
- **Support**: If AICE saves you tokens and turns across your coding agents, please star [**forart82/aice**](https://github.com/forart82/aice)!

### BibTeX Citation

```bibtex
@software{forart82_aice_2026,
  author       = {forart82},
  title        = {{AICE: On-the-Fly AI Context Engine \& Multi-Language \$idioms Splicer}},
  year         = {2026},
  version = {0.9.52},
  publisher    = {GitHub},
  url          = {https://github.com/forart82/aice},
  license      = {Apache-2.0}
}
```

Licensed under the [Apache License 2.0](LICENSE) (see also [NOTICE](NOTICE) and [THIRD-PARTY-NOTICES.txt](THIRD-PARTY-NOTICES.txt)).
Copyright (c) 2026 [forart82](https://github.com/forart82).
