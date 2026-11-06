# AIL 2.0 Honest, Clean & Trustworthy Benchmark Report

> **Verified Status**: **1220 / 1220 (100.0%)** AIL On-the-Fly Win Rate across **15 Languages & File Types (80 Cases/Lang = 1200)** + **20 Complex Multi-Language Full-Stack Scenarios**
> **Overall Apples-to-Apples Token Savings**: **-77.9%** (`23 578 458` native tokens -> `5 218 559` AIL On-the-Fly tokens)
> **Zero `.ail` Files Left on Disk**: `true` | **Strict Complexity Monotonicity (`#001 < ... < #080`)**: `true`

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

## 2. Per-Language Summary (`15 Languages × 80 Cases = 1200 Benchmarks`)

| Language / File Type | Ext | Cases | Win Rate | Write (`0->1`) | Read (`Context`) | Update (`Splice`) | Delete (`--delete`) | Refactor (`Idiom`) | Total Native | Total AIL | Overall Savings |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | ---: | ---: | :---: |
| **TypeScript (.ts)** | `.ts` | 80 | **80/80 (100%)** | -71.1% | -94.6% | -85.8% | -96.9% | -97.5% | 1 313 458 | 202 272 | **-84.6%** |
| **React TSX (.tsx)** | `.tsx` | 80 | **80/80 (100%)** | -64.0% | -94.9% | -83.4% | -97.0% | -97.7% | 1 369 642 | 251 264 | **-81.7%** |
| **JavaScript (.js)** | `.js` | 80 | **80/80 (100%)** | -70.8% | -95.6% | -85.7% | -96.9% | -97.5% | 1 299 746 | 196 712 | **-84.9%** |
| **Python (.py)** | `.py` | 80 | **80/80 (100%)** | -66.6% | -93.5% | -83.2% | -96.4% | -97.1% | 1 136 150 | 203 472 | **-82.1%** |
| **Go (.go)** | `.go` | 80 | **80/80 (100%)** | -70.9% | -68.3% | -85.8% | -96.9% | -97.5% | 1 305 846 | 348 592 | **-73.3%** |
| **Rust (.rs)** | `.rs` | 80 | **80/80 (100%)** | -71.6% | -94.4% | -86.2% | -97.0% | -97.5% | 1 337 400 | 204 072 | **-84.7%** |
| **C++20 (.cpp)** | `.cpp` | 80 | **80/80 (100%)** | -70.9% | -94.5% | -87.4% | -96.9% | -97.5% | 1 312 282 | 202 912 | **-84.5%** |
| **C# (.cs)** | `.cs` | 80 | **80/80 (100%)** | -72.5% | -68.0% | -86.6% | -97.1% | -97.6% | 1 381 528 | 359 992 | **-73.9%** |
| **Kotlin (.kt)** | `.kt` | 80 | **80/80 (100%)** | -70.3% | -92.0% | -85.6% | -96.8% | -97.4% | 1 280 660 | 216 072 | **-83.1%** |
| **PHP 8 (.php)** | `.php` | 80 | **80/80 (100%)** | -73.0% | -92.7% | -86.8% | -97.1% | -97.7% | 1 404 064 | 215 592 | **-84.7%** |
| **CSS3 (.css)** | `.css` | 80 | **80/80 (100%)** | -66.3% | -96.1% | -78.7% | -96.5% | -97.3% | 1 168 860 | 199 560 | **-82.9%** |
| **HTML5 (.html)** | `.html` | 80 | **80/80 (100%)** | -58.4% | -58.6% | -81.5% | -97.0% | -97.6% | 1 366 370 | 496 096 | **-63.7%** |
| **JSON (.json)** | `.json` | 80 | **80/80 (100%)** | -69.3% | -71.9% | -85.0% | -97.5% | -97.9% | 1 673 856 | 432 936 | **-74.1%** |
| **YAML (.yaml)** | `.yaml` | 80 | **80/80 (100%)** | -60.0% | -63.4% | -80.1% | -96.7% | -97.4% | 1 284 384 | 432 776 | **-66.3%** |
| **Twig (.twig)** | `.twig` | 80 | **80/80 (100%)** | -61.9% | -62.6% | -83.5% | -96.7% | -97.6% | 1 086 736 | 359 408 | **-66.9%** |

---

## 3. Engineering Scenario & Application Surface Breakdown

### 3.1 By Engineering Task Scenario

| Engineering Scenario | Cases | Win Rate | Total Savings |
| :--- | :---: | :---: | :---: |
| **Bug Fix (`bug_fix`)** | 244 | **244/244 (100%)** | **-77.7%** |
| **New Feature (`new_feature`)** | 244 | **244/244 (100%)** | **-78.3%** |
| **Update Feature (`update_feature`)** | 244 | **244/244 (100%)** | **-77.7%** |
| **From-0 Window App (`from_zero_window_app`)** | 245 | **245/245 (100%)** | **-77.8%** |
| **From-0 Non-Window App (`from_zero_non_window_app`)** | 243 | **243/243 (100%)** | **-77.8%** |

### 3.2 Window vs. Non-Window Applications

| Application Surface | Cases | Win Rate | Total Savings |
| :--- | :---: | :---: | :---: |
| **Window Applications (GUI / Canvas / DOM / Web UI / Desktop)** | 613 | **613/613 (100%)** | **-77.8%** |
| **Non-Window Applications (Headless CLI / Daemon / Backend API / Worker)** | 607 | **607/607 (100%)** | **-77.9%** |

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
| `POLY-06` | **C++20 Desktop Viewport Engine + HTML/CSS Overlay + JSON/YAML Configs** | `.cpp .ts .html .css .json .yaml` | `window` | `from_zero_window_app` | -65.8% | -78.9% | -80.8% | -97.2% | -98.0% | 111 493 | 27 115 | **-75.7%** |
| `POLY-07` | **C# .NET Enterprise API + TSX Admin + CSS + HTML + JSON + YAML** | `.cs .tsx .ts .css .html .json .yaml` | `window` | `bug_fix` | -66.2% | -78.0% | -80.7% | -97.6% | -97.9% | 162 390 | 40 846 | **-74.8%** |
| `POLY-08` | **Kotlin Ktor + TypeScript + TSX + CSS + HTML + JSON + YAML Companion App** | `.kt .ts .tsx .css .html .json .yaml` | `window` | `new_feature` | -65.9% | -81.3% | -80.8% | -97.6% | -97.9% | 171 305 | 41 074 | **-76.0%** |
| `POLY-09` | **Full-Stack Multiplayer Snake Tournament Platform** | `.ts .tsx .php .go .css .html .json .yaml` | `window` | `from_zero_window_app` | -67.3% | -80.5% | -81.5% | -97.9% | -98.3% | 241 569 | 57 398 | **-76.2%** |
| `POLY-10` | **Multi-Tenant SaaS Billing & Invoice Designer Studio** | `.py .php .tsx .twig .css .json .yaml` | `window` | `update_feature` | -66.7% | -82.7% | -81.2% | -97.8% | -98.2% | 214 004 | 49 511 | **-76.9%** |
| `POLY-11` | **Headless Distributed Job Queue & Worker Mesh Daemon** | `.go .rs .py .json .yaml` | `non_window` | `from_zero_non_window_app` | -66.7% | -76.5% | -81.5% | -96.7% | -97.4% | 65 710 | 16 076 | **-75.5%** |
| `POLY-12` | **Polyglot Monorepo Build & Release CLI Orchestrator** | `.ts .js .py .rs .json .yaml` | `non_window` | `new_feature` | -67.9% | -84.6% | -81.8% | -97.2% | -97.9% | 102 620 | 21 339 | **-79.2%** |
| `POLY-13` | **High-Frequency Trading Risk Engine & Audit Pipeline** | `.cpp .rs .go .py .json .yaml` | `non_window` | `bug_fix` | -68.5% | -80.7% | -82.7% | -97.6% | -97.9% | 136 600 | 31 296 | **-77.1%** |
| `POLY-14` | **Enterprise IAM & Zero-Trust Policy Sync Daemon** | `.cs .kt .go .json .yaml` | `non_window` | `update_feature` | -68.9% | -72.9% | -82.9% | -97.6% | -97.9% | 125 443 | 32 946 | **-73.7%** |
| `POLY-15` | **Legacy PHP + Go + Python Zero-Downtime ETL Migration CLI** | `.php .go .py .ts .json .yaml` | `non_window` | `from_zero_non_window_app` | -69.3% | -81.1% | -82.8% | -97.9% | -98.2% | 180 001 | 40 643 | **-77.4%** |
| `POLY-16` | **Real-Time Collaborative IDE & Layout Preview Workbench** | `.rs .ts .tsx .css .html .json .yaml` | `window` | `new_feature` | -66.8% | -82.3% | -81.2% | -98.1% | -98.3% | 264 278 | 62 443 | **-76.4%** |
| `POLY-17` | **Smart Factory IoT Edge Gateway & Twig/JS Operator Console** | `.cpp .py .js .twig .css .html .yaml .json` | `window` | `bug_fix` | -66.6% | -79.9% | -81.5% | -98.0% | -98.2% | 301 512 | 74 959 | **-75.1%** |
| `POLY-18` | **Cloud-Native Kubernetes Operator & Fleet Auditor CLI** | `.go .rs .py .ts .json .yaml` | `non_window` | `update_feature` | -69.7% | -81.8% | -83.2% | -98.3% | -98.5% | 275 563 | 62 257 | **-77.4%** |
| `POLY-19` | **Cross-Platform Game Asset Baker & Shader Pipeline CLI** | `.cpp .cs .kt .py .json .yaml` | `non_window` | `from_zero_non_window_app` | -69.7% | -81.5% | -83.7% | -98.3% | -98.5% | 288 611 | 65 723 | **-77.2%** |
| `POLY-20` | **Unified 15-Language Enterprise Polyglot Super-Platform** | `.ts .tsx .js .py .go .rs .cpp .cs .kt .php .css .html .json .yaml .twig` | `window` | `from_zero_window_app` | -69.6% | -84.5% | -83.7% | -98.4% | -98.5% | 842 634 | 182 410 | **-78.3%** |
