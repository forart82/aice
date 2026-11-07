![AICE — AI Context Engine](assets/aice-banner.jpg)

# AICE: On-the-Fly AI Context Engine & Multi-Language `$idioms` Splicer

[![License: Apache-2.0](https://img.shields.io/badge/License-Apache_2.0-blue.svg)](https://opensource.org/licenses/Apache-2.0)
[![TypeScript 5.8+](https://img.shields.io/badge/TypeScript-5.8%2B-blue)](https://www.typescriptlang.org/)
[![Bun 1.4+](https://img.shields.io/badge/Bun-1.4%2B-black)](https://bun.sh/)
[![Node.js 22/24](https://img.shields.io/badge/Node.js-22%20%7C%2024-green)](https://nodejs.org/)
[![Tests Passing](https://img.shields.io/badge/Tests-1%2C240%20passing-brightgreen)](tests/)
[![Token Savings](https://img.shields.io/badge/Token%20Savings-43%25%20--%2088%25-orange)](docs/BENCHMARKS.md)

> **A pure on-the-fly AST context packager, BPE-gated `$idiom` compressor, and surgical multi-language code splicer engineered for autonomous AI coding agents — with zero `.aice` files on disk.**

---

## ⚡ Executive Summary

Modern Large Language Models (LLMs) spend **40% to 85% of their context windows, tool calls, and output token budgets on syntactic noise and full-file re-reads**: closing XML/HTML tags (`</div>`, `</section>`), redundant curly braces (`{ ... }`), verbose language ceremony (`std::cout << ... << std::endl`, `export interface`, `public readonly`), and repetitive multi-file patterns.

**AICE (AI Context Engine)** is a pure **On-the-Fly AI Context & Mutation Tool** that operates directly on native source files in RAM across **15 languages** (`TypeScript`, `TSX`, `JavaScript`, `Python`, `Go`, `Rust`, `C++20`, `C#`, `Kotlin`, `PHP`, `CSS`, `HTML`, `Twig`, `JSON`, `YAML`):

1. **Zero `.aice` Files on Disk**: Your native codebase (`*.ts`, `*.cpp`, `*.py`, `*.rs`, `*.go`, etc.) remains 100% untouched by companion or shadow files. No watchers, no file permission locks, and no build-pipeline disruption.
2. **In-RAM AST Decompilation & Skeleton Outlines (`aice outline`)**: Summarizes any native file or workspace into a compact AICE structural skeleton in milliseconds (`65%` to `92%` token reduction).
3. **1-Turn Symbol-Scoped Context Packs (`aice context`)**: Extracts just the target symbol, its imported dependency contracts, and active `$idioms` in a single turn (`-69.0%` to `-83.7%` working payload tokens).
4. **Built-In & Project-Specific `$idioms` (`aice idioms`)**: Automatically collapses both language-level ceremony (e.g., C++ `std::cout << a << b << std::endl` $\leftrightarrow$ `print(a, b)`) and project-specific multi-file AST patterns (`$clampBand`, `$guard`, `$big_out` via `.aice-idioms.json` / `aice.config.json`) using structural anti-unification.
5. **Surgical Direct-to-Native AST Splicing (`aice splice`)**: Accepts compact AICE + `$idioms`, raw native code, or hybrid syntax and splices the expanded native AST directly into the exact byte-span of the target symbol on disk — preserving 100% of surrounding comments, formatting, and headers.

---

## 🛠️ End-to-End C++20 On-the-Fly Workflow Example

![AICE End-to-End C++20 Workflow](assets/aice-cpp-workflow.jpg)

AICE reads native C++20 directly into RAM, compresses verbose C++ syntax and repetitive patterns into compact AICE + `$idioms` for the AI agent, and surgically splices the AI's compact edit back into the native `.cpp` file on disk.

### Built-In Idioms vs. Project-Specific Custom Idioms (`.aice-idioms.json`)

AICE combines two layers of idiom compression:
- **Built-In Language Idioms**: Verbose standard-library constructs are automatically lowered and raised by the C++20 decompiler/emitter without configuration — for example, `std::cout << "[CARD] Sessions=" << m.activeSessions << std::endl;` automatically decompiles to `print("[CARD] Sessions=", m.activeSessions)` and compiles back to `std::cout << ... << std::endl;`.
- **Project-Specific Custom Idioms (`.aice-idioms.json` / `aice.config.json`)**: Custom project wrappers or domain patterns (such as a custom C++ stream helper `givemeabigstring::out(msg)` or repeated bounds checks like `$clampBand`) can be mined automatically via `aice idioms scan` or declared in `.aice-idioms.json`:

```json
{
  "idiomsEnabled": true,
  "idioms": {
    "$big_out": {
      "name": "$big_out",
      "kind": "stmt",
      "params": [{ "name": "$0" }],
      "templateAice": "givemeabigstring.out($0)",
      "description": "Custom C++ stream wrapper givemeabigstring::out(msg)"
    }
  }
}
```

### Step 1: Native C++20 Source File on Disk (`src/telemetry_report.cpp`)

```cpp
#include <iostream>
#include <string>

struct TelemetryMetrics {
    int activeSessions;
    double latencyMs;
    std::string recipient;
};

int calculateLoadScore(int activeSessions, int threshold) {
    if (activeSessions <= 0) {
        return 0;
    }
    if (activeSessions > threshold) {
        return activeSessions * 2;
    }
    return activeSessions;
}

void renderDashboardCard(const TelemetryMetrics& m) {
    std::cout << "[CARD] Sessions=" << m.activeSessions << std::endl;
    givemeabigstring::out(m.recipient);
    if (m.latencyMs > 100.0) {
        std::cout << "[WARN] High latency=" << m.latencyMs << std::endl;
    }
}
```

### Step 2: Inspect File Skeleton Outline (`aice outline --idioms`)

The AI agent inspects the module structure without reading function bodies (`-68.1%` tokens):

```bash
$ aice outline src/telemetry_report.cpp --idioms --stats
```

```aice
type TelemetryMetrics:
  activeSessions: int
  latencyMs: num
  recipient: str

fn calculateLoadScore(activeSessions: int, threshold: int) -> int: ...

fn renderDashboardCard(m: TelemetryMetrics) -> void: ...

📊 Token Reduction Metrics for src/telemetry_report.cpp:
  Original tokens: 166
  Outline tokens:  53
  Token savings:   113 tokens (68.1%)
```

### Step 3: Extract Symbol-Scoped Context (`aice context --symbol renderDashboardCard --idioms`)

The AI agent requests only `renderDashboardCard`. AICE decompiles `std::cout << ... << std::endl` to `print(...)` and collapses `givemeabigstring::out(m.recipient)` into `$big_out(m.recipient)`:

```bash
$ aice context src/telemetry_report.cpp --symbol renderDashboardCard --idioms --no-callers
```

```markdown
# AICE Context Pack: src/telemetry_report.cpp

## Imported Dependency Contracts (0):
None

## Target File Content:
```aice
module telemetry_report

fn renderDashboardCard(m:TelemetryMetrics) -> void:
  print("[CARD] Sessions=", m.activeSessions)
  $big_out(m.recipient)
  if m.latencyMs > 100.0:
    print("[WARN] High latency=", m.latencyMs)
```

### Active Project Idioms
- `$big_out($0)` -> `givemeabigstring.out($0)`
```

### Step 4: Preview Surgical Edit (`aice splice --symbol renderDashboardCard --idioms --dry-run`)

The AI agent writes a compact AICE + `$idioms` update adding a critical latency branch and previews the native C++20 diff with `--dry-run --diff`:

```bash
$ aice splice src/telemetry_report.cpp \
    --symbol renderDashboardCard \
    --idioms \
    --dry-run \
    --diff \
    --code 'fn renderDashboardCard(m: TelemetryMetrics):
  print("[CARD] Sessions=", m.activeSessions)
  $big_out(m.recipient)
  if m.latencyMs > 250.0:
    print("[CRITICAL] Latency spike=", m.latencyMs)
  elif m.latencyMs > 100.0:
    print("[WARN] High latency=", m.latencyMs)'
```

```diff
--- a/src/telemetry_report.cpp
+++ b/src/telemetry_report.cpp
@@ -20,7 +20,10 @@
 void renderDashboardCard(const TelemetryMetrics& m) {
     std::cout << "[CARD] Sessions=" << m.activeSessions << std::endl;
     givemeabigstring::out(m.recipient);
-    if (m.latencyMs > 100.0) {
+    if ((m.latencyMs > 250.0f)) {
+        std::cout << "[CRITICAL] Latency spike=" << m.latencyMs << std::endl;
+    }
+    else if ((m.latencyMs > 100.0f)) {
         std::cout << "[WARN] High latency=" << m.latencyMs << std::endl;
     }
 }
```

### Step 5: Apply Surgical Edit In-Place (`aice splice --symbol renderDashboardCard --idioms --in-place`)

```bash
$ aice splice src/telemetry_report.cpp \
    --symbol renderDashboardCard \
    --idioms \
    --in-place \
    --code 'fn renderDashboardCard(m: TelemetryMetrics):
  print("[CARD] Sessions=", m.activeSessions)
  $big_out(m.recipient)
  if m.latencyMs > 250.0:
    print("[CRITICAL] Latency spike=", m.latencyMs)
  elif m.latencyMs > 100.0:
    print("[WARN] High latency=", m.latencyMs)'
```

```text
✔ Spliced symbol 'renderDashboardCard' in src/telemetry_report.cpp (84 tokens saved)
```

`src/telemetry_report.cpp` is updated atomically in-place on disk with valid C++20 (`std::cout`, `givemeabigstring::out`, `const TelemetryMetrics& m`) and **zero `.aice` files created**.

---

## 📊 Empirical Benchmarks (Real AI Agents & Deterministic Offline)

### Table 1: Real AI Agent Benchmarks — 30 Live Uncoached Autonomous Agent Transcripts (`docs/BENCHMARKS.md`)

Verified by running **30 real autonomous AI agent (`agy -p`) sessions** (`10 scenarios × 3 modes`) in isolated temporary workspaces on disk under a **100% fair, uncoached plain-English task specification** (zero pre-written `.aice` snippets, zero `$idiom` leakage, and zero pre-filled symbol lists in the prompt). Ground-truth telemetry is parsed directly from each agent's `.system_generated/logs/transcript.jsonl` (`PLANNER_RESPONSE` turns, `tool_calls`, working payload tokens, `output_tokens`, `input_tokens`, and `cache_read_tokens`), with **100% on-disk native mutation verification** and **0 `.aice` files left on disk**:

| ID | Real-World Benchmark Scenario | Languages & Files | LLM Turns (No AICE / Pure AICE / +Idioms) | Tool Calls (No AICE / Pure AICE / +Idioms) | Working Tokens (No AICE / Pure AICE / +Idioms) | LLM Output Tokens (No AICE / Pure AICE / +Idioms) | Total API Context Tokens (No AICE / Pure AICE / +Idioms) |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window App (from 0)** | `ts, html, css, json` (5) | 13 / **3** (-77%) / **3** (-77%) | 16 / **2** (-88%) / **2** (-88%) | 18,827 / **5,294** (-71.9%) / **2,835** (-84.9%) | 5,853 / **2,867** (-51.0%) / **945** (-83.8%) | 414,985 / **77,797** (-81.3%) / **70,214** (-83.1%) |
| `RW-02` | **Headless Python CLI Queue & Worker Daemon (from 0)** | `py, yaml, json` (4) | 9 / **3** (-67%) / **3** (-67%) | 14 / **2** (-86%) / **2** (-86%) | 12,028 / **4,705** (-60.9%) / **2,432** (-79.8%) | 3,288 / **2,542** (-22.7%) / **826** (-74.9%) | 249,685 / **76,316** (-69.4%) / **69,500** (-72.2%) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront** | `php, js, twig, css, html, yaml, json` (7) | 18 / **3** (-83%) / **3** (-83%) | 23 / **2** (-91%) / **2** (-91%) | 17,222 / **5,710** (-66.8%) / **3,274** (-81.0%) | 4,909 / **3,433** (-30.1%) / **1,190** (-75.8%) | 579,533 / **80,162** (-86.2%) / **71,908** (-87.6%) |
| `RW-04` | **Vite + TS + React TSX + CSS + HTML + JSON + YAML Dashboard** | `ts, tsx, css, html, json, yaml` (6) | 23 / **3** (-87%) / **3** (-87%) | 22 / **2** (-91%) / **2** (-91%) | 23,311 / **6,369** (-72.7%) / **3,138** (-86.5%) | 8,375 / **4,047** (-51.7%) / **1,139** (-86.4%) | 734,104 / **80,983** (-89.0%) / **71,525** (-90.3%) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Ledger Mesh** | `go, rs, yaml, json` (4) | 20 / **3** (-85%) / **3** (-85%) | 19 / **2** (-89%) / **2** (-89%) | 21,422 / **4,662** (-78.2%) / **2,388** (-88.8%) | 6,512 / **2,481** (-61.9%) / **780** (-88.0%) | 659,277 / **75,916** (-88.5%) / **69,300** (-89.5%) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TS Inspector Overlay** | `cpp, ts, html, css, json` (5) | 12 / **3** (-75%) / **3** (-75%) | 15 / **2** (-87%) / **2** (-87%) | 12,325 / **5,185** (-57.9%) / **2,785** (-77.4%) | 3,980 / **2,761** (-30.6%) / **915** (-77.0%) | 349,963 / **76,925** (-78.0%) / **70,240** (-79.9%) |
| `RW-07` | **C# .NET Payment Settlement + Kotlin Fraud Scoring Engine** | `cs, kt, yaml, json` (4) | 12 / **3** (-75%) / **3** (-75%) | 13 / **2** (-85%) / **2** (-85%) | 12,799 / **5,331** (-58.4%) / **2,611** (-79.6%) | 4,153 / **3,055** (-26.4%) / **892** (-78.5%) | 353,669 / **77,170** (-78.2%) / **69,818** (-80.3%) |
| `RW-08` | **Python FastAPI + TSX + Twig Invoice Studio + CSS + JSON + YAML** | `py, tsx, twig, css, json, yaml` (6) | 17 / **3** (-82%) / **3** (-82%) | 16 / **2** (-88%) / **2** (-88%) | 13,409 / **5,507** (-58.9%) / **3,193** (-76.2%) | 4,061 / **3,242** (-20.2%) / **1,131** (-72.2%) | 479,182 / **79,427** (-83.4%) / **71,468** (-85.1%) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon** | `rs, cpp, py, go, yaml, json` (6) | 15 / **3** (-80%) / **3** (-80%) | 17 / **2** (-88%) / **2** (-88%) | 17,185 / **6,054** (-64.8%) / **3,092** (-82.0%) | 5,374 / **3,830** (-28.7%) / **1,124** (-79.1%) | 459,474 / **81,598** (-82.2%) / **71,588** (-84.4%) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability Control Plane** | `All 15 (.ts..twig)` (15) | 50 / **8** (-84%) / **5** (-90%) | 49 / **7** (-86%) / **4** (-92%) | 58,844 / **15,563** (-73.5%) / **8,091** (-86.3%) | 21,603 / **8,842** (-59.1%) / **2,738** (-87.3%) | 2,308,023 / **263,069** (-88.6%) / **146,732** (-93.6%) |
| **TOTAL** | **All 10 Scenarios (`10/10` Wins — 30 Real Agent Sessions)** | **15/15 Languages** | **189** / **35** (-81.5%) / **32** (-83.1%) | **204** / **25** (-87.8%) / **22** (-89.2%) | **207,372** / **64,380** (-69.0%) / **33,839** (-83.7%) | **68,108** / **37,100** (-45.5%) / **11,680** (-82.8%) | **6,587,895** / **969,363** (-85.3%) / **782,293** (-88.1%) |

- **Why AICE On-the-Fly With Idioms (`--idioms`) wins `10/10` across every metric**: `aice context . -s "..." --idioms` collapses repetitive multi-line AST patterns into 1-line `$idiom(...)` calls (`-83.7%` working payload tokens), `aice splice --idioms --batch` / `aice idioms update --batch` propagates workspace-wide pattern refactors in $O(1)$ across all 15 languages alongside surgical target updates/insertions/deletions (`5` turns vs `50` turns on `RW-10`, `-82.8%` LLM output tokens, `-83.2%` billable API tokens, `-88.1%` total API context tokens).
- **Why Pure AICE (`--no-idioms`) wins `10/10` across every metric — and why Idioms still matter**: Even without `$idiom` macros, `aice context . -s "*" --no-idioms` and `aice splice --no-idioms --batch` beat `Without AICE` in all 10 scenarios across turns (`-81.5%`), tool calls (`-87.8%`), working tokens (`-69.0%`), output tokens (`-45.5%`), billable tokens (`-74.7%`), and total API context tokens (`-85.3%`). Enabling Project Idioms (`--idioms`) cuts LLM output tokens by an additional **`-68.5%`** (`37,100 -> 11,680`) and working payload tokens by an additional **`-47.4%`** (`64,380 -> 33,839`).
- Full 30-session ground-truth audit trail: see [`docs/BENCHMARKS.md`](docs/BENCHMARKS.md) and [`benchmarks/real-agent-results.json`](benchmarks/real-agent-results.json) (`npm run benchmark`).

### Table 2: Deterministic Offline Benchmarks — Without Idioms vs. With Idioms (`docs/BENCHMARKS_OFFLINE.md`)

Evaluated deterministically offline (exact `o200k_base` BPE token & turn accounting across `Write from 0` incl. `$idiom` definition cost, `Read`, `Surgical Update`, `Surgical Delete`, and `Multi-File Refactor`):

| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Id / Id) | Read (No Id / Id) | Update (No Id / Id) | Delete | Refactor (No Id / Id) | Tokens Without AICE | Tokens AICE (No Id) | Tokens AICE (With Id) | Turns Without AICE | Turns AICE (No Id) | Turns AICE (With Id) |
| :--- | :--- | :---: | :---: | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window App (from 0)** | `window` | `from_zero_window_app` | `.ts .html .css .json` | -21.1% / **-46.1%** | -36.5% / **-57.4%** | -57.1% / **-75.0%** | **-91.6%** | -56.9% / **-96.8%** | 11,038 | 5,944 (**-46.1%**) | 2,713 (**-75.4%**) | 46 | 17 (**-63.0%**) | 13 (**-71.7%**) |
| `RW-02` | **Headless Python CLI Queue & Worker Daemon (from 0)** | `non_window` | `from_zero_non_window_app` | `.py .yaml .json` | -13.0% / **-37.9%** | -26.1% / **-45.3%** | -47.0% / **-67.5%** | **-90.1%** | -51.3% / **-96.3%** | 7,852 | 4,791 (**-39.0%**) | 2,277 (**-71.0%**) | 37 | 14 (**-62.2%**) | 11 (**-70.3%**) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront** | `window` | `bug_fix` | `.php .js .twig .css .html .yaml .json` | -19.0% / **-39.8%** | -31.6% / **-55.9%** | -55.7% / **-74.2%** | **-92.8%** | -56.4% / **-95.0%** | 12,097 | 6,695 (**-44.7%**) | 3,207 (**-73.5%**) | 55 | 23 (**-58.2%**) | 17 (**-69.1%**) |
| `RW-04` | **Vite + TS + React TSX + CSS + HTML + JSON + YAML Dashboard** | `window` | `new_feature` | `.ts .tsx .css .html .json .yaml` | -19.1% / **-40.7%** | -40.6% / **-60.2%** | -27.5% / **-57.2%** | **-93.7%** | -55.0% / **-95.0%** | 10,303 | 6,023 (**-41.5%**) | 2,901 (**-71.8%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Ledger Mesh** | `non_window` | `update_feature` | `.go .rs .yaml .json` | -25.4% / **-45.0%** | -38.6% / **-56.6%** | -52.4% / **-72.0%** | **-93.5%** | -55.3% / **-95.9%** | 9,697 | 5,269 (**-45.7%**) | 2,499 (**-74.2%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TS Inspector Overlay** | `window` | `bug_fix` | `.cpp .ts .html .css .json` | -18.9% / **-40.5%** | -36.3% / **-56.5%** | -55.5% / **-73.3%** | **-93.3%** | -56.1% / **-95.7%** | 10,119 | 5,596 (**-44.7%**) | 2,643 (**-73.9%**) | 39 | 17 (**-56.4%**) | 13 (**-66.7%**) |
| `RW-07` | **C# .NET Payment Settlement + Kotlin Fraud Scoring Engine** | `non_window` | `new_feature` | `.cs .kt .yaml .json` | -18.4% / **-40.2%** | -23.5% / **-44.2%** | -27.9% / **-54.3%** | **-94.3%** | -54.3% / **-95.8%** | 8,688 | 5,222 (**-39.9%**) | 2,495 (**-71.3%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-08` | **Python FastAPI + TSX + Twig Invoice Studio + CSS + JSON + YAML** | `window` | `update_feature` | `.py .tsx .twig .css .json .yaml` | -14.6% / **-38.3%** | -32.0% / **-54.9%** | -52.7% / **-72.6%** | **-92.5%** | -53.4% / **-95.1%** | 10,787 | 6,321 (**-41.4%**) | 2,987 (**-72.3%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon** | `non_window` | `bug_fix` | `.rs .cpp .py .go .yaml .json` | -18.3% / **-40.8%** | -34.8% / **-53.3%** | -54.1% / **-71.6%** | **-94.4%** | -55.1% / **-95.9%** | 14,194 | 8,000 (**-43.6%**) | 3,761 (**-73.5%**) | 47 | 20 (**-57.5%**) | 15 (**-68.1%**) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability Control Plane** | `window` | `update_feature` | `All 15 (.ts..twig)` | -18.9% / **-39.9%** | -30.8% / **-52.7%** | -56.0% / **-73.3%** | **-94.3%** | -56.1% / **-95.6%** | 32,246 | 18,016 (**-44.1%**) | 8,559 (**-73.5%**) | 108 | 47 (**-56.5%**) | 33 (**-69.4%**) |
| **TOTAL** | **All 10 Real-World Scenarios (`10/10` Wins)** | **Both** | **All 5** | **All 15** | **-18.8% / -40.8%** | **-33.0% / -54.2%** | **-52.0% / -71.2%** | **-92.8%** | **-55.3% / -95.7%** | **127,021** | **71,877 (-43.4%)** | **34,042 (-73.2%)** | **502** | **206 (-59.0%)** | **154 (-69.3%)** |

Full offline deterministic per-module breakdown: see [`docs/BENCHMARKS_OFFLINE.md`](docs/BENCHMARKS_OFFLINE.md) (`npm run benchmark:offline`).

---

## 🚀 Quick Start & Installation

### Option 1: Local Link (Recommended for Development)
```bash
cd /path/to/aice
ln -sf $(pwd)/bin/aice.mjs ~/.local/bin/aice
```
*(Or with Bun: `bun link`)*

### Option 2: Standalone Single Binary (Zero Dependencies)
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

### 1. On-the-Fly Context, Skeleton Outlines & Surgical Splicing
```bash
# Generate structural skeleton outline of any native file or directory (65-92% token reduction):
aice outline src/telemetry_report.cpp --idioms --stats

# Generate 1-turn token-bounded context pack from a native file (or single symbol with -s):
aice context src/telemetry_report.cpp --symbol renderDashboardCard --idioms
aice context . --symbol "*" --idioms

# Preview surgical AST replacement with unified diff (--dry-run --diff):
aice splice src/telemetry_report.cpp -s renderDashboardCard -c "fn renderDashboardCard(m: TelemetryMetrics): ..." --idioms --dry-run --diff

# Apply surgical AST replacement in-place directly on the native file:
aice splice src/telemetry_report.cpp -s renderDashboardCard -c "fn renderDashboardCard(m: TelemetryMetrics): ..." --idioms --in-place
aice splice src/sim/Hazard.ts -s HazardManager.obsoleteHelper --delete
aice splice --batch '[{"filePath":"src/a.ts","symbol":"fnA","code":"pub fn fnA() -> int: ret 1"}]' --idioms
```

### 2. Smart Multi-File Idioms (`$idioms`)
```bash
# Scan native workspace to discover repetitive AST templates & build .aice-cache/idioms.json:
aice idioms scan [dir] --min-occurrences 3 --min-savings 10

# Inspect an idiom's template, parameters, and every file:line occurrence across the project:
aice idioms read '$clamp' [dir]
aice idioms list [dir]

# Mutate an idiom's template and rewrite all occurrences across all native files atomically:
aice idioms update '$clamp' "Math.max($1, Math.min($2, $0))" [dir]
aice idioms update --batch '[{"name":"$clamp","newTemplate":"Math.max($1, Math.min($2, $0))"}]' [dir]

# Toggle on-the-fly $idiom collapsing in aice.config.json / .aice-idioms.json:
aice idioms on [dir]
aice idioms off [dir]
```

### 3. Semantic Diff, Patch, Tokenomics & MCP Server
```bash
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
├── assets/
│   ├── aice-banner.jpg         # Official wide title banner
│   ├── aice-cpp-workflow.jpg   # End-to-End C++20 On-the-Fly Workflow diagram
│   └── aice-logo.jpg           # Official square logo
├── benchmarks/
│   ├── offline-suite.ts        # Deterministic 10-scenario / 15-language BPE benchmark engine
│   ├── real-agent-suite.ts     # Live 30-session autonomous agent benchmark verifier
│   ├── run-offline.ts          # CLI runner for offline benchmarks
│   └── run.ts                  # CLI runner for full benchmark suite
├── bin/
│   ├── aice.ts                 # AICE CLI entrypoint
│   └── aice.mjs                # Node/Bun executable wrapper
├── docs/
│   ├── AICE_SPEC.md            # Normative language & AST specification (EBNF)
│   ├── AI_SYSTEM_PROMPT.md     # System prompt for LLM code generation & CLI usage
│   ├── BENCHMARKS.md           # Real AI agent benchmark report (30 live sessions)
│   ├── BENCHMARKS_OFFLINE.md   # Deterministic offline benchmark report
│   ├── CST_TRIVIA_SPEC.md      # Bidirectional lens and CST trivia table specification
│   └── RESEARCH_SYNTHESIS.md   # Tokenomics and AST anti-unification research synthesis
├── src/
│   ├── cache/                  # Persistent AST & idiom provenance disk cache
│   ├── config/                 # Project config (aice.config.json / .aice-idioms.json) & path resolver
│   ├── core/                   # Lexer, Pratt Parser, AST, Tokens, Span, CST Trivia
│   ├── decompiler/             # On-the-fly reverse transpilers across 15 languages
│   ├── emitters/               # Multi-target native code generators across 15 languages
│   ├── idioms/                 # BPE-gated AST anti-unification idiom miner & transformer
│   ├── mcp/                    # Model Context Protocol (MCP) stdio server
│   ├── tokenomics/             # TikToken BPE (`cl100k_base` / `o200k_base`) tokenomics engine
│   ├── tools/                  # On-the-fly tools: outline, context, splice, fmt, parity-gate
│   └── typechecker/            # Static typechecker & autonomous self-repair engine
└── tests/
    ├── unit/                   # 43 unit test suites
    └── integration/            # 3 multi-file roundtrip & operator pipeline integration suites
```

---

## 📜 License

Apache License 2.0. Copyright (c) 2026.
