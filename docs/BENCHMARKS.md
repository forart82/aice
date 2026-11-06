# AIL 2.0 Honest, Clean & Trustworthy Benchmark Report

> **Verified Status**: **470 / 470 (100.0%)** AIL On-the-Fly Win Rate across **15 Languages & File Types (30 Cases/Lang = 450)** + **20 Complex Multi-Language Full-Stack Scenarios**
> **Overall Apples-to-Apples Token Savings**: **-77.1%** (`6 054 526` native tokens -> `1 387 019` AIL On-the-Fly tokens)
> **Zero `.ail` Files Left on Disk**: `true` | **Strict Complexity Monotonicity (`#001 < ... < #030`)**: `true`

---

## 1. Methodology: 100% Honest Apples-to-Apples Accounting

- **Zero Fake Multipliers**: Every token count is measured directly on the actual strings via `estimateTokens()` (`1.0x`). All legacy `2.2x` and `1.5x + 400` multipliers have been permanently removed.
- **Zero Full-File Double-Charging**: Surgical updates and deletes compare `ail splice` against realistic `replace_file_content` patches (`TargetContent` + `ReplacementContent`), never charging native workflows for rewriting untouched lines.
- **Zero Artificial Dependency Padding**: Every single-language benchmark tests the target module and its real project `$idiom` refactor peers without padding 20 unrelated files.
- **Full CRUD + Multi-File Refactor Coverage**:
  1. **Write (From `0` / Greenfield)**: Writing new modules/apps in AIL On-the-Fly (compiled directly to native disk with `0` `.ail` files left behind) vs. raw native code from `0`.
  2. **Read (Discovery + Context)**: `ail outline` + `ail context <file> --symbol <sym>` (with `$idioms` collapsed) vs. `read_file` of the target module.
  3. **Update (Bug Fix / Feature Update / New Feature Insert)**: `ail splice <file> --symbol <sym> --code "<new AIL>"` (or `--insert-after`) vs. `replace_file_content` (`TargetContent` + `ReplacementContent`).
  4. **Delete (Surgical Removal)**: `ail splice <file> --symbol <sym> --delete` vs. `replace_file_content` (`TargetContent` of the obsolete block).
  5. **Multi-File Refactor**: `1` `ail idiom update $name "<new template>"` call propagated across `N` files vs. `N` separate `replace_file_content` edits.

---

## 2. Per-Language Summary (`15 Languages × 30 Cases = 450 Benchmarks`)

| Language / File Type | Ext | Cases | Win Rate | Write (`0->1`) | Read (`Context`) | Update (`Splice`) | Delete (`--delete`) | Refactor (`Idiom`) | Total Native | Total AIL | Overall Savings |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | :---: |
| **TypeScript (.ts)** | `.ts` | 30 | **30/30 (100%)** | -66.3% | -88.8% | -83.0% | -94.7% | -96.2% | 147 958 | 26 002 | **-82.4%** |
| **React TSX (.tsx)** | `.tsx` | 30 | **30/30 (100%)** | -59.9% | -89.4% | -81.0% | -94.9% | -96.4% | 153 732 | 30 209 | **-80.3%** |
| **JavaScript (.js)** | `.js` | 30 | **30/30 (100%)** | -65.7% | -90.5% | -82.7% | -94.6% | -96.1% | 145 166 | 25 042 | **-82.8%** |
| **Python (.py)** | `.py` | 30 | **30/30 (100%)** | -61.5% | -86.2% | -79.9% | -93.9% | -95.6% | 128 870 | 26 452 | **-79.5%** |
| **Go (.go)** | `.go` | 30 | **30/30 (100%)** | -66.3% | -61.3% | -82.9% | -94.6% | -96.2% | 147 576 | 39 872 | **-73.0%** |
| **Rust (.rs)** | `.rs` | 30 | **30/30 (100%)** | -67.7% | -88.7% | -83.6% | -94.9% | -96.3% | 154 284 | 26 302 | **-83.0%** |
| **C++20 (.cpp)** | `.cpp` | 30 | **30/30 (100%)** | -66.3% | -88.3% | -85.7% | -94.6% | -96.2% | 150 002 | 26 242 | **-82.5%** |
| **C# (.cs)** | `.cs` | 30 | **30/30 (100%)** | -68.3% | -59.1% | -84.0% | -95.0% | -96.4% | 156 948 | 42 272 | **-73.1%** |
| **Kotlin (.kt)** | `.kt` | 30 | **30/30 (100%)** | -65.4% | -82.5% | -82.7% | -94.6% | -96.0% | 144 050 | 28 927 | **-79.9%** |
| **PHP 8 (.php)** | `.php` | 30 | **30/30 (100%)** | -68.6% | -84.3% | -84.2% | -95.1% | -96.4% | 158 434 | 28 822 | **-81.8%** |
| **CSS3 (.css)** | `.css` | 30 | **30/30 (100%)** | -62.9% | -91.2% | -75.9% | -93.9% | -95.8% | 126 490 | 23 340 | **-81.5%** |
| **HTML5 (.html)** | `.html` | 30 | **30/30 (100%)** | -55.9% | -56.4% | -79.8% | -94.8% | -96.3% | 150 240 | 48 846 | **-67.5%** |
| **JSON (.json)** | `.json` | 30 | **30/30 (100%)** | -67.8% | -71.2% | -83.6% | -95.5% | -96.7% | 179 036 | 41 211 | **-77.0%** |
| **YAML (.yaml)** | `.yaml` | 30 | **30/30 (100%)** | -57.7% | -62.1% | -78.0% | -93.9% | -95.8% | 135 914 | 41 151 | **-69.7%** |
| **Twig (.twig)** | `.twig` | 30 | **30/30 (100%)** | -59.0% | -60.1% | -81.9% | -94.3% | -96.3% | 118 326 | 35 498 | **-70.0%** |

---

## 3. Engineering Scenario & Application Surface Breakdown

### 3.1 By Engineering Task Scenario

| Engineering Scenario | Cases | Win Rate | Total Savings |
| :--- | :---: | :---: | :---: |
| **Bug Fix (`bug_fix`)** | 94 | **94/94 (100%)** | **-76.3%** |
| **New Feature (`new_feature`)** | 94 | **94/94 (100%)** | **-77.6%** |
| **Update Feature (`update_feature`)** | 94 | **94/94 (100%)** | **-76.8%** |
| **From-0 Window App (`from_zero_window_app`)** | 95 | **95/95 (100%)** | **-77.5%** |
| **From-0 Non-Window App (`from_zero_non_window_app`)** | 93 | **93/93 (100%)** | **-77.1%** |

### 3.2 Window vs. Non-Window Applications

| Application Surface | Cases | Win Rate | Total Savings |
| :--- | :---: | :---: | :---: |
| **Window Applications (GUI / Canvas / DOM / Web UI / Desktop)** | 238 | **238/238 (100%)** | **-77.0%** |
| **Non-Window Applications (Headless CLI / Daemon / Backend API / Worker)** | 232 | **232/232 (100%)** | **-77.2%** |

---

## 4. Dedicated From-`0` Multi-Module Applications (Window vs. Non-Window)

### 4.1 HTML5 Canvas Snake Arcade Game (Window Application)
- **Description**: 5-module HTML5 Canvas Snake Window Application (`types.ts`, `grid.ts`, `engine.ts`, `renderer.ts`, `input.ts`) created from 0 in AIL On-the-Fly
- **Write From `0`**: `997` native tokens -> `363` AIL tokens (**-63.6%**)
- **Read Context**: `263` -> `77` (**-70.7%**)
- **Surgical Update**: `310` -> `61` (**-80.3%**)
- **Surgical Delete**: `108` -> `7` (**-93.5%**)
- **Multi-File Refactor**: `550` -> `40` (**-92.7%**)
- **Full App Lifecycle Savings**: **-75.4%** (`0` `.ail` files left on disk: `true`)

### 4.2 Headless CLI Task Queue & Telemetry Daemon (Non-Window Application)
- **Description**: 5-module Headless Python CLI & Worker Daemon (`schema.py`, `queue.py`, `worker.py`, `pipeline.py`, `cli.py`) created from 0 in AIL On-the-Fly
- **Write From `0`**: `724` native tokens -> `284` AIL tokens (**-60.8%**)
- **Read Context**: `245` -> `96` (**-60.8%**)
- **Surgical Update**: `266` -> `63` (**-76.3%**)
- **Surgical Delete**: `95` -> `7` (**-92.6%**)
- **Multi-File Refactor**: `475` -> `40` (**-91.6%**)
- **Full App Lifecycle Savings**: **-72.8%** (`0` `.ail` files left on disk: `true`)

---

## 5. 20 Complex Multi-Language & Multi-Filetype Full-Stack Benchmarks

| ID | Polyglot Full-Stack Scenario | Stack Filetypes | Surface | Scenario | Write | Read | Update | Delete | Refactor | Total Native | Total AIL | Savings |
| :---: | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | :---: |
| `POLY-01` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront** | `.php .js .twig .css .html .yaml .json` | `window` | `from_zero_window_app` | -63.8% | -75.3% | -78.8% | -95.9% | -97.5% | 55 448 | 13 256 | **-76.1%** |
| `POLY-02` | **Vite + TypeScript + Component UI + CSS + HTML + JSON + YAML Workspace** | `.ts .tsx .css .html .json .yaml` | `window` | `from_zero_window_app` | -63.0% | -77.5% | -78.9% | -95.9% | -97.5% | 54 730 | 13 121 | **-76.0%** |
| `POLY-03` | **Go Microservice + React TSX + CSS + JSON + YAML Telemetry Dashboard** | `.go .tsx .ts .css .json .yaml` | `window` | `new_feature` | -65.8% | -79.9% | -79.8% | -96.7% | -97.5% | 72 096 | 16 723 | **-76.8%** |
| `POLY-04` | **Python FastAPI + JS + Twig + CSS + HTML + YAML + JSON Analytics Portal** | `.py .js .twig .css .html .yaml .json` | `window` | `bug_fix` | -63.9% | -76.0% | -79.5% | -96.6% | -97.4% | 87 641 | 22 715 | **-74.1%** |
| `POLY-05` | **Rust Actix + TypeScript + HTML5 + CSS3 + JSON + YAML Systems Monitor** | `.rs .ts .html .css .json .yaml` | `window` | `update_feature` | -65.9% | -79.0% | -80.1% | -97.2% | -98.0% | 103 828 | 24 980 | **-75.9%** |
| `POLY-06` | **C++20 Desktop Viewport Engine + HTML/CSS Overlay + JSON/YAML Configs** | `.cpp .ts .html .css .json .yaml` | `window` | `from_zero_window_app` | -65.8% | -78.9% | -80.8% | -97.2% | -98.0% | 111 501 | 27 115 | **-75.7%** |
| `POLY-07` | **C# .NET Enterprise API + TSX Admin + CSS + HTML + JSON + YAML** | `.cs .tsx .ts .css .html .json .yaml` | `window` | `bug_fix` | -66.2% | -78.0% | -80.7% | -97.6% | -97.9% | 162 390 | 40 846 | **-74.8%** |
| `POLY-08` | **Kotlin Ktor + TypeScript + TSX + CSS + HTML + JSON + YAML Companion App** | `.kt .ts .tsx .css .html .json .yaml` | `window` | `new_feature` | -65.9% | -81.3% | -80.8% | -97.6% | -97.9% | 171 305 | 41 074 | **-76.0%** |
| `POLY-09` | **Full-Stack Multiplayer Snake Tournament Platform** | `.ts .tsx .php .go .css .html .json .yaml` | `window` | `from_zero_window_app` | -67.3% | -80.5% | -81.5% | -97.9% | -98.3% | 241 569 | 57 398 | **-76.2%** |
| `POLY-10` | **Multi-Tenant SaaS Billing & Invoice Designer Studio** | `.py .php .tsx .twig .css .json .yaml` | `window` | `update_feature` | -66.7% | -82.7% | -81.2% | -97.8% | -98.2% | 214 004 | 49 511 | **-76.9%** |
| `POLY-11` | **Headless Distributed Job Queue & Worker Mesh Daemon** | `.go .rs .py .json .yaml` | `non_window` | `from_zero_non_window_app` | -66.7% | -76.5% | -81.5% | -96.7% | -97.4% | 65 710 | 16 076 | **-75.5%** |
| `POLY-12` | **Polyglot Monorepo Build & Release CLI Orchestrator** | `.ts .js .py .rs .json .yaml` | `non_window` | `new_feature` | -67.9% | -84.6% | -81.8% | -97.2% | -97.9% | 102 620 | 21 339 | **-79.2%** |
| `POLY-13` | **High-Frequency Trading Risk Engine & Audit Pipeline** | `.cpp .rs .go .py .json .yaml` | `non_window` | `bug_fix` | -68.5% | -80.7% | -82.7% | -97.6% | -97.9% | 136 608 | 31 296 | **-77.1%** |
| `POLY-14` | **Enterprise IAM & Zero-Trust Policy Sync Daemon** | `.cs .kt .go .json .yaml` | `non_window` | `update_feature` | -68.9% | -72.9% | -82.9% | -97.6% | -97.9% | 125 443 | 32 946 | **-73.7%** |
| `POLY-15` | **Legacy PHP + Go + Python Zero-Downtime ETL Migration CLI** | `.php .go .py .ts .json .yaml` | `non_window` | `from_zero_non_window_app` | -69.3% | -81.1% | -82.8% | -97.9% | -98.2% | 180 001 | 40 643 | **-77.4%** |
| `POLY-16` | **Real-Time Collaborative IDE & Layout Preview Workbench** | `.rs .ts .tsx .css .html .json .yaml` | `window` | `new_feature` | -66.8% | -82.3% | -81.2% | -98.1% | -98.3% | 264 278 | 62 443 | **-76.4%** |
| `POLY-17` | **Smart Factory IoT Edge Gateway & Twig/JS Operator Console** | `.cpp .py .js .twig .css .html .yaml .json` | `window` | `bug_fix` | -66.6% | -79.9% | -81.5% | -98.0% | -98.2% | 301 520 | 74 959 | **-75.1%** |
| `POLY-18` | **Cloud-Native Kubernetes Operator & Fleet Auditor CLI** | `.go .rs .py .ts .json .yaml` | `non_window` | `update_feature` | -69.7% | -81.8% | -83.2% | -98.3% | -98.5% | 275 563 | 62 257 | **-77.4%** |
| `POLY-19` | **Cross-Platform Game Asset Baker & Shader Pipeline CLI** | `.cpp .cs .kt .py .json .yaml` | `non_window` | `from_zero_non_window_app` | -69.7% | -81.5% | -83.7% | -98.3% | -98.5% | 288 611 | 65 723 | **-77.2%** |
| `POLY-20` | **Unified 15-Language Enterprise Polyglot Super-Platform** | `.ts .tsx .js .py .go .rs .cpp .cs .kt .php .css .html .json .yaml .twig` | `window` | `from_zero_window_app` | -69.6% | -84.5% | -83.7% | -98.4% | -98.5% | 842 634 | 182 410 | **-78.3%** |
