# AICE Deterministic Offline Benchmark Report (10 Scenarios — Without & With Idioms)

- **Evaluation Engine**: Deterministic Offline AST & Tooling Harness (Exact API Calls & Character/Token Accounting — No Live LLM Agent Calls)
- **Evaluation Mode**: 3-Way Apples-to-Apples (`Without AICE` vs `AICE Without Idioms` vs `AICE With Idioms`)
- **Total Real-World Benchmarks**: **10** (`RW-01` .. `RW-10`)
- **AICE Without Idioms Win Rate**: **10 / 10 (100.0%)**
- **AICE With Idioms Win Rate**: **10 / 10 (100.0%)**
- **Total Lifecycle Turns (10 Benchmarks)**: Without AICE = **502 turns** | AICE Without Idioms = **206 turns (-59.0%)** | AICE With Idioms = **154 turns (-69.3%)**
- **Languages & File Types Covered (15)**: `.ts`, `.html`, `.css`, `.json`, `.py`, `.yaml`, `.php`, `.js`, `.twig`, `.tsx`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`
- **Engineering Scenarios Covered (5)**: `from_zero_window_app`, `from_zero_non_window_app`, `bug_fix`, `new_feature`, `update_feature`
- **Application Surfaces Covered (2)**: `window`, `non_window`
- **Zero `.aice` Files Left on Disk**: **PASS (0 .aice files)**

---

## 1. Aggregate Operation Breakdown (Tokens & Turns Across All 10 Real-World Benchmarks)

### Token Breakdown Across All 10 Real-World Benchmarks

| Operation | Without AICE (Tokens) | AICE Without Idioms (Tokens) | Savings Without Idioms | AICE With Idioms (Tokens) | Savings With Idioms | Extra Idiom Boost |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** *(incl. idiom defs)* | 33,018 | 26,816 | **-18.8%** | 19,545 | **-40.8%** | **+22.0%** |
| **Read (Discovery + Context)** | 14,853 | 11,841 | **-20.3%** | 8,742 | **-41.1%** | **+20.9%** |
| **Update (Bug Fix / Feature)** | 16,994 | 8,174 | **-51.9%** | 4,911 | **-71.1%** | **+19.2%** |
| **Delete (Obsolete Symbol)** | 2,234 | 162 | **-92.8%** | 162 | **-92.8%** | **+0.0%** |
| **Refactor (Multi-Site / Multi-File)** | 59,912 | 26,784 | **-55.3%** | 2,582 | **-95.7%** | **+40.4%** |
| **TOTAL LIFECYCLE** | **127,011** | **73,777** | **-41.9%** | **35,942** | **-71.7%** | **+29.8%** |

### Agent Turns Breakdown Across All 10 Real-World Benchmarks

| Operation | Without AICE (Turns) | AICE Without Idioms (Turns) | Turn Savings Without Idioms | AICE With Idioms (Turns) | Turn Savings With Idioms | Extra Idiom Turn Boost |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 62 | 62 | **0.0%** | 62 | **0.0%** | **+0.0%** |
| **Read (Discovery + Context)** | 124 | 62 | **-50.0%** | 62 | **-50.0%** | **+0.0%** |
| **Update (Bug Fix / Feature)** | 62 | 10 | **-83.9%** | 10 | **-83.9%** | **+0.0%** |
| **Delete (Obsolete Symbol)** | 40 | 10 | **-75.0%** | 10 | **-75.0%** | **+0.0%** |
| **Refactor (Multi-Site / Multi-File)** | 214 | 62 | **-71.0%** | 10 | **-95.3%** | **+24.3%** |
| **TOTAL LIFECYCLE** | **502** | **206** | **-59.0%** | **154** | **-69.3%** | **+10.4%** |

---

## 2. All 10 Real-World Benchmarks Summary Table (Offline Deterministic Suite)

| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Idiom / Idiom) | Read (No Idiom / Idiom) | Update (No Idiom / Idiom) | Delete | Refactor (No Idiom / Idiom) | Tokens Without AICE | Tokens AICE (No Idioms) | Tokens AICE (With Idioms) | Turns Without AICE | Turns AICE (No Idioms) | Turns AICE (With Idioms) |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)** | `window` | `from_zero_window_app` | `.ts .html .css .json` | -21.1% / **-46.1%** | -26.0% / **-46.9%** | -57.1% / **-75.0%** | **-91.6%** | -56.9% / **-96.8%** | 11,038 | 6,078 (**-44.9%**) | 2,847 (**-74.2%**) | 46 | 17 (**-63.0%**) | 13 (**-71.7%**) |
| `RW-02` | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)** | `non_window` | `from_zero_non_window_app` | `.py .yaml .json` | -13.0% / **-37.9%** | -9.7% / **-28.9%** | -47.0% / **-67.5%** | **-90.1%** | -51.3% / **-96.3%** | 7,852 | 4,935 (**-37.1%**) | 2,421 (**-69.2%**) | 37 | 14 (**-62.2%**) | 11 (**-70.3%**) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)** | `window` | `bug_fix` | `.php .js .twig .css .html .yaml .json` | -19.0% / **-39.8%** | -21.4% / **-45.6%** | -55.7% / **-74.2%** | **-92.8%** | -56.4% / **-95.0%** | 12,097 | 6,831 (**-43.5%**) | 3,343 (**-72.4%**) | 55 | 23 (**-58.2%**) | 17 (**-69.1%**) |
| `RW-04` | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)** | `window` | `new_feature` | `.ts .tsx .css .html .json .yaml` | -19.1% / **-40.7%** | -30.9% / **-50.5%** | -27.5% / **-57.2%** | **-93.7%** | -55.0% / **-95.0%** | 10,303 | 6,152 (**-40.3%**) | 3,030 (**-70.6%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)** | `non_window` | `update_feature` | `.go .rs .yaml .json` | -25.2% / **-44.9%** | -10.8% / **-28.8%** | -52.4% / **-72.0%** | **-93.5%** | -55.3% / **-95.9%** | 9,689 | 5,582 (**-42.4%**) | 2,812 (**-71.0%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)** | `window` | `bug_fix` | `.cpp .ts .html .css .json` | -18.9% / **-40.5%** | -27.7% / **-47.9%** | -55.5% / **-73.3%** | **-93.3%** | -56.1% / **-95.7%** | 10,119 | 5,699 (**-43.7%**) | 2,746 (**-72.9%**) | 39 | 17 (**-56.4%**) | 13 (**-66.7%**) |
| `RW-07` | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)** | `non_window` | `new_feature` | `.cs .kt .yaml .json` | -18.6% / **-40.4%** | -13.5% / **-34.2%** | -28.1% / **-54.5%** | **-94.3%** | -54.4% / **-95.8%** | 8,706 | 5,308 (**-39.0%**) | 2,581 (**-70.3%**) | 36 | 14 (**-61.1%**) | 11 (**-69.4%**) |
| `RW-08` | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)** | `window` | `update_feature` | `.py .tsx .twig .css .json .yaml` | -14.6% / **-38.3%** | -18.3% / **-41.2%** | -52.7% / **-72.6%** | **-92.5%** | -53.4% / **-95.1%** | 10,787 | 6,502 (**-39.7%**) | 3,168 (**-70.6%**) | 49 | 20 (**-59.2%**) | 15 (**-69.4%**) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)** | `non_window` | `bug_fix` | `.rs .cpp .py .go .yaml .json` | -18.1% / **-40.6%** | -18.7% / **-37.3%** | -54.1% / **-71.6%** | **-94.4%** | -55.1% / **-95.9%** | 14,178 | 8,265 (**-41.7%**) | 4,026 (**-71.6%**) | 47 | 20 (**-57.5%**) | 15 (**-68.1%**) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)** | `window` | `update_feature` | `.ts .tsx .js .py .go .rs .cpp .cs .kt .php .css .html .json .yaml .twig` | -18.9% / **-39.8%** | -20.0% / **-42.0%** | -56.0% / **-73.3%** | **-94.3%** | -56.1% / **-95.6%** | 32,242 | 18,425 (**-42.9%**) | 8,968 (**-72.2%**) | 108 | 47 (**-56.5%**) | 33 (**-69.4%**) |
| **TOTAL** | **All 10 Real-World Scenarios (`10/10` Wins)** | **Both** | **All 5** | **All 15** | -18.8% / **-40.8%** | -20.3% / **-41.1%** | -51.9% / **-71.1%** | **-92.8%** | -55.3% / **-95.7%** | **127,011** | **73,777 (-41.9%)** | **35,942 (-71.7%)** | **502** | **206 (-59.0%)** | **154 (-69.3%)** |

---

## 3. Per-Benchmark Module & Operation Breakdown

### RW-01: HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)

- **Description**: Complete interactive browser game built from 0 with TypeScript game loop & collision engine, Canvas HUD renderer, HTML5 arcade shell, CSS3 neon cabinet theme, and JSON level config.
- **Scenario**: `from_zero_window_app` | **Surface**: `window` | **Files**: 5 (`.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$guard_band_step`, `$html_metric_row`, `$css_card`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **218 tokens**)
- **Lifecycle Tokens**: Without AICE = **11,038** | AICE Without Idioms = **6,078 (-44.9%)** | AICE With Idioms = **2,847 (-74.2%)**
- **Lifecycle Turns**: Without AICE = **46 turns** | AICE Without Idioms = **17 turns (-63.0%)** | AICE With Idioms = **13 turns (-71.7%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 3,011 tok / 5 turns | 2,375 tok / 5 turns | 1,623 tok / 5 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,270 tok / 10 turns | 940 tok / 5 turns | 675 tok / 5 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 1,435 tok / 5 turns | 615 tok / 1 turns | 358 tok / 1 turns | -80.0% / **-80.0%** |
| **Delete (Surgical)** | 415 tok / 8 turns | 35 tok / 1 turns | 35 tok / 1 turns | -87.5% / **-87.5%** |
| **Refactor (Pattern)** | 4,907 tok / 18 turns | 2,113 tok / 5 turns | 156 tok / 1 turns | -72.2% / **-94.4%** |
| **TOTAL** | **11,038 tok / 46 turns** | **6,078 tok / 17 turns** | **2,847 tok / 13 turns** | **-63.0% / -71.7%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `engine.ts` | `.ts` | 1025 | 803 | -21.7% | 472 | **-54.0%** |
| `renderer.ts` | `.ts` | 647 | 531 | -17.9% | 299 | **-53.8%** |
| `index.html` | `.html` | 494 | 444 | -10.1% | 249 | **-49.6%** |
| `styles.css` | `.css` | 503 | 365 | -27.4% | 242 | **-51.9%** |
| `game_config.json` | `.json` | 342 | 232 | -32.2% | 143 | **-58.2%** |

### RW-02: Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)

- **Description**: Non-window background queue daemon & CLI tool created from 0 with Python retry backoff scheduler, worker pool controller, YAML service deployment topology, and JSON ingestion schema.
- **Scenario**: `from_zero_non_window_app` | **Surface**: `non_window` | **Files**: 4 (`.py`, `.yaml`, `.json`)
- **Idioms Used**: `$enforce_quota_band`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **182 tokens**)
- **Lifecycle Tokens**: Without AICE = **7,852** | AICE Without Idioms = **4,935 (-37.1%)** | AICE With Idioms = **2,421 (-69.2%)**
- **Lifecycle Turns**: Without AICE = **37 turns** | AICE Without Idioms = **14 turns (-62.2%)** | AICE With Idioms = **11 turns (-70.3%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,132 tok / 4 turns | 1,854 tok / 4 turns | 1,324 tok / 4 turns | 0.0% / 0.0% |
| **Read (Context)** | 877 tok / 8 turns | 792 tok / 4 turns | 624 tok / 4 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 963 tok / 4 turns | 510 tok / 1 turns | 313 tok / 1 turns | -75.0% / **-75.0%** |
| **Delete (Surgical)** | 284 tok / 6 turns | 28 tok / 1 turns | 28 tok / 1 turns | -83.3% / **-83.3%** |
| **Refactor (Pattern)** | 3,596 tok / 15 turns | 1,751 tok / 4 turns | 132 tok / 1 turns | -73.3% / **-93.3%** |
| **TOTAL** | **7,852 tok / 37 turns** | **4,935 tok / 14 turns** | **2,421 tok / 11 turns** | **-62.2% / -70.3%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `worker.py` | `.py` | 934 | 847 | -9.3% | 515 | **-44.9%** |
| `cli.py` | `.py` | 583 | 519 | -11.0% | 323 | **-44.6%** |
| `pipeline.yaml` | `.yaml` | 264 | 247 | -6.4% | 152 | **-42.4%** |
| `schema.json` | `.json` | 351 | 241 | -31.3% | 152 | **-56.7%** |

### RW-03: Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)

- **Description**: Full server & client e-commerce storefront fixing a negative discount/tax rounding bug in CheckoutController.php while synchronizing client cart JS, Twig summary template, CSS styles, HTML modal, YAML routes, and JSON shipping tiers.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 7 (`.php`, `.js`, `.twig`, `.css`, `.html`, `.yaml`, `.json`)
- **Idioms Used**: `$round_money_band`, `$clamp_cart_line`, `$twig_summary_line`, `$css_card`, `$html_metric_row`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **389 tokens**)
- **Lifecycle Tokens**: Without AICE = **12,097** | AICE Without Idioms = **6,831 (-43.5%)** | AICE With Idioms = **3,343 (-72.4%)**
- **Lifecycle Turns**: Without AICE = **55 turns** | AICE Without Idioms = **23 turns (-58.2%)** | AICE With Idioms = **17 turns (-69.1%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 3,095 tok / 7 turns | 2,507 tok / 7 turns | 1,864 tok / 7 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,334 tok / 14 turns | 1,048 tok / 7 turns | 725 tok / 7 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 1,762 tok / 7 turns | 780 tok / 1 turns | 454 tok / 1 turns | -85.7% / **-85.7%** |
| **Delete (Surgical)** | 222 tok / 4 turns | 16 tok / 1 turns | 16 tok / 1 turns | -75.0% / **-75.0%** |
| **Refactor (Pattern)** | 5,684 tok / 23 turns | 2,480 tok / 7 turns | 284 tok / 1 turns | -69.6% / **-95.7%** |
| **TOTAL** | **12,097 tok / 55 turns** | **6,831 tok / 23 turns** | **3,343 tok / 17 turns** | **-58.2% / -69.1%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `CheckoutController.php` | `.php` | 1117 | 877 | -21.5% | 497 | **-55.5%** |
| `cart-client.js` | `.js` | 599 | 503 | -16.0% | 298 | **-50.3%** |
| `checkout.twig` | `.twig` | 321 | 284 | -11.5% | 140 | **-56.4%** |
| `checkout.css` | `.css` | 411 | 298 | -27.5% | 202 | **-50.9%** |
| `shell.html` | `.html` | 229 | 210 | -8.3% | 123 | **-46.3%** |
| `routes.yaml` | `.yaml` | 177 | 170 | -4.0% | 108 | **-39.0%** |
| `shipping_rates.json` | `.json` | 241 | 165 | -31.5% | 107 | **-55.6%** |

### RW-04: Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)

- **Description**: Modern frontend workspace adding a new cohort retention & live sparkline feature across the TypeScript metrics store, React TSX dashboard panel, CSS grid cards, HTML shell, JSON bundle budget, and YAML preview pipeline.
- **Scenario**: `new_feature` | **Surface**: `window` | **Files**: 6 (`.ts`, `.tsx`, `.css`, `.html`, `.json`, `.yaml`)
- **Idioms Used**: `$guard_band_step`, `$tsx_kpi_tile`, `$css_card`, `$html_metric_row`, `$json_policy_rule`, `$yaml_service_tier` (Definition Cost Charged on Write from 0: **336 tokens**)
- **Lifecycle Tokens**: Without AICE = **10,303** | AICE Without Idioms = **6,152 (-40.3%)** | AICE With Idioms = **3,030 (-70.6%)**
- **Lifecycle Turns**: Without AICE = **49 turns** | AICE Without Idioms = **20 turns (-59.2%)** | AICE With Idioms = **15 turns (-69.4%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,877 tok / 6 turns | 2,329 tok / 6 turns | 1,707 tok / 6 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,324 tok / 12 turns | 915 tok / 6 turns | 656 tok / 6 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 947 tok / 6 turns | 687 tok / 1 turns | 405 tok / 1 turns | -83.3% / **-83.3%** |
| **Delete (Surgical)** | 253 tok / 4 turns | 16 tok / 1 turns | 16 tok / 1 turns | -75.0% / **-75.0%** |
| **Refactor (Pattern)** | 4,902 tok / 21 turns | 2,205 tok / 6 turns | 246 tok / 1 turns | -71.4% / **-95.2%** |
| **TOTAL** | **10,303 tok / 49 turns** | **6,152 tok / 20 turns** | **3,030 tok / 15 turns** | **-59.2% / -69.4%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `metrics-store.ts` | `.ts` | 1105 | 868 | -21.4% | 498 | **-54.9%** |
| `DashboardPanel.tsx` | `.tsx` | 701 | 605 | -13.7% | 320 | **-54.4%** |
| `dashboard.css` | `.css` | 413 | 301 | -27.1% | 205 | **-50.4%** |
| `index.html` | `.html` | 238 | 219 | -8.0% | 132 | **-44.5%** |
| `bundle_budgets.json` | `.json` | 237 | 163 | -31.2% | 105 | **-55.7%** |
| `vite_pipeline.yaml` | `.yaml` | 183 | 173 | -5.5% | 111 | **-39.3%** |

### RW-05: Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)

- **Description**: Cloud-native backend updating quorum consensus timeout and adaptive rate limiting across a Go API gateway, Rust write-ahead log compaction engine, YAML Raft cluster config, and JSON tenant burst quotas.
- **Scenario**: `update_feature` | **Surface**: `non_window` | **Files**: 4 (`.go`, `.rs`, `.yaml`, `.json`)
- **Idioms Used**: `$bounded_quorum_step`, `$advance_wal_cursor`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **251 tokens**)
- **Lifecycle Tokens**: Without AICE = **9,689** | AICE Without Idioms = **5,582 (-42.4%)** | AICE With Idioms = **2,812 (-71.0%)**
- **Lifecycle Turns**: Without AICE = **36 turns** | AICE Without Idioms = **14 turns (-61.1%)** | AICE With Idioms = **11 turns (-69.4%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,691 tok / 4 turns | 2,012 tok / 4 turns | 1,483 tok / 4 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,126 tok / 8 turns | 1,004 tok / 4 turns | 802 tok / 4 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 1,177 tok / 4 turns | 560 tok / 1 turns | 330 tok / 1 turns | -75.0% / **-75.0%** |
| **Delete (Surgical)** | 247 tok / 4 turns | 16 tok / 1 turns | 16 tok / 1 turns | -75.0% / **-75.0%** |
| **Refactor (Pattern)** | 4,448 tok / 16 turns | 1,990 tok / 4 turns | 181 tok / 1 turns | -75.0% / **-93.8%** |
| **TOTAL** | **9,689 tok / 36 turns** | **5,582 tok / 14 turns** | **2,812 tok / 11 turns** | **-61.1% / -69.4%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `gateway.go` | `.go` | 1113 | 823 | -26.1% | 503 | **-54.8%** |
| `wal_engine.rs` | `.rs` | 1152 | 846 | -26.6% | 506 | **-56.1%** |
| `cluster.yaml` | `.yaml` | 181 | 173 | -4.4% | 111 | **-38.7%** |
| `limits.json` | `.json` | 245 | 170 | -30.6% | 112 | **-54.3%** |

### RW-06: C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)

- **Description**: Hybrid native/web desktop viewport engine fixing a sub-pixel AABB collision tunneling clamp bug in C++20 while updating the TypeScript inspector bridge, HTML HUD overlay, CSS dock panel, and JSON solver settings.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 5 (`.cpp`, `.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$solve_axis_impulse`, `$guard_band_step`, `$html_metric_row`, `$css_card`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **287 tokens**)
- **Lifecycle Tokens**: Without AICE = **10,119** | AICE Without Idioms = **5,699 (-43.7%)** | AICE With Idioms = **2,746 (-72.9%)**
- **Lifecycle Turns**: Without AICE = **39 turns** | AICE Without Idioms = **17 turns (-56.4%)** | AICE With Idioms = **13 turns (-66.7%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,567 tok / 5 turns | 2,081 tok / 5 turns | 1,528 tok / 5 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,201 tok / 10 turns | 868 tok / 5 turns | 626 tok / 5 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 1,417 tok / 5 turns | 630 tok / 1 turns | 379 tok / 1 turns | -80.0% / **-80.0%** |
| **Delete (Surgical)** | 120 tok / 2 turns | 8 tok / 1 turns | 8 tok / 1 turns | -50.0% / **-50.0%** |
| **Refactor (Pattern)** | 4,814 tok / 17 turns | 2,112 tok / 5 turns | 205 tok / 1 turns | -70.6% / **-94.1%** |
| **TOTAL** | **10,119 tok / 39 turns** | **5,699 tok / 17 turns** | **2,746 tok / 13 turns** | **-56.4% / -66.7%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `viewport_sim.cpp` | `.cpp` | 1023 | 847 | -17.2% | 482 | **-52.9%** |
| `inspector.ts` | `.ts` | 639 | 534 | -16.4% | 300 | **-53.0%** |
| `overlay.html` | `.html` | 245 | 226 | -7.8% | 139 | **-43.3%** |
| `overlay.css` | `.css` | 414 | 303 | -26.8% | 207 | **-50.0%** |
| `engine_settings.json` | `.json` | 246 | 171 | -30.5% | 113 | **-54.1%** |

### RW-07: C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)

- **Description**: Enterprise fintech backend adding instant payout fee calculation and real-time velocity risk scoring across C# .NET settlement services, Kotlin Ktor fraud evaluators, YAML clearing routing, and JSON risk rule weights.
- **Scenario**: `new_feature` | **Surface**: `non_window` | **Files**: 4 (`.cs`, `.kt`, `.yaml`, `.json`)
- **Idioms Used**: `$settle_ledger_window`, `$score_risk_signal`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **252 tokens**)
- **Lifecycle Tokens**: Without AICE = **8,706** | AICE Without Idioms = **5,308 (-39.0%)** | AICE With Idioms = **2,581 (-70.3%)**
- **Lifecycle Turns**: Without AICE = **36 turns** | AICE Without Idioms = **14 turns (-61.1%)** | AICE With Idioms = **11 turns (-69.4%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,465 tok / 4 turns | 2,007 tok / 4 turns | 1,470 tok / 4 turns | 0.0% / 0.0% |
| **Read (Context)** | 857 tok / 8 turns | 741 tok / 4 turns | 564 tok / 4 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 771 tok / 4 turns | 554 tok / 1 turns | 351 tok / 1 turns | -75.0% / **-75.0%** |
| **Delete (Surgical)** | 247 tok / 4 turns | 14 tok / 1 turns | 14 tok / 1 turns | -75.0% / **-75.0%** |
| **Refactor (Pattern)** | 4,366 tok / 16 turns | 1,992 tok / 4 turns | 182 tok / 1 turns | -75.0% / **-93.8%** |
| **TOTAL** | **8,706 tok / 36 turns** | **5,308 tok / 14 turns** | **2,581 tok / 11 turns** | **-61.1% / -69.4%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `SettlementEngine.cs` | `.cs` | 1082 | 854 | -21.1% | 515 | **-52.4%** |
| `FraudScorer.kt` | `.kt` | 957 | 810 | -15.4% | 480 | **-49.8%** |
| `settlement_policy.yaml` | `.yaml` | 187 | 179 | -4.3% | 117 | **-37.4%** |
| `risk_rules.json` | `.json` | 239 | 164 | -31.4% | 106 | **-55.6%** |

### RW-08: Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)

- **Description**: Multi-tenant SaaS billing & reporting portal updating multi-currency tax rounding and usage quota gauges across Python FastAPI services, React TSX usage charts, Twig invoice templates, CSS print/screen rules, JSON plan tiers, and YAML cron workers.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 6 (`.py`, `.tsx`, `.twig`, `.css`, `.json`, `.yaml`)
- **Idioms Used**: `$enforce_quota_band`, `$tsx_kpi_tile`, `$twig_summary_line`, `$css_card`, `$json_policy_rule`, `$yaml_service_tier` (Definition Cost Charged on Write from 0: **328 tokens**)
- **Lifecycle Tokens**: Without AICE = **10,787** | AICE Without Idioms = **6,502 (-39.7%)** | AICE With Idioms = **3,168 (-70.6%)**
- **Lifecycle Turns**: Without AICE = **49 turns** | AICE Without Idioms = **20 turns (-59.2%)** | AICE With Idioms = **15 turns (-69.4%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 2,783 tok / 6 turns | 2,378 tok / 6 turns | 1,717 tok / 6 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,320 tok / 12 turns | 1,078 tok / 6 turns | 776 tok / 6 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 1,523 tok / 6 turns | 720 tok / 1 turns | 417 tok / 1 turns | -83.3% / **-83.3%** |
| **Delete (Surgical)** | 199 tok / 4 turns | 15 tok / 1 turns | 15 tok / 1 turns | -75.0% / **-75.0%** |
| **Refactor (Pattern)** | 4,962 tok / 21 turns | 2,311 tok / 6 turns | 243 tok / 1 turns | -71.4% / **-95.2%** |
| **TOTAL** | **10,787 tok / 49 turns** | **6,502 tok / 20 turns** | **3,168 tok / 15 turns** | **-59.2% / -69.4%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `billing_service.py` | `.py` | 1052 | 955 | -9.2% | 560 | **-46.8%** |
| `UsageChart.tsx` | `.tsx` | 571 | 496 | -13.1% | 262 | **-54.1%** |
| `invoice_email.twig` | `.twig` | 321 | 284 | -11.5% | 140 | **-56.4%** |
| `billing.css` | `.css` | 412 | 299 | -27.4% | 203 | **-50.7%** |
| `plans.json` | `.json` | 243 | 169 | -30.4% | 111 | **-54.3%** |
| `worker_cron.yaml` | `.yaml` | 184 | 175 | -4.9% | 113 | **-38.6%** |

### RW-09: High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)

- **Description**: Ultra-low-latency non-window trading & risk pipeline fixing a self-trade price collar boundary bug across a Rust matching engine, C++20 intraday margin calculator, Python compliance daemon, Go market feed normalizer, YAML venue feeds, and JSON collar bands.
- **Scenario**: `bug_fix` | **Surface**: `non_window` | **Files**: 6 (`.rs`, `.cpp`, `.py`, `.go`, `.yaml`, `.json`)
- **Idioms Used**: `$advance_wal_cursor`, `$solve_axis_impulse`, `$enforce_quota_band`, `$bounded_quorum_step`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **389 tokens**)
- **Lifecycle Tokens**: Without AICE = **14,178** | AICE Without Idioms = **8,265 (-41.7%)** | AICE With Idioms = **4,026 (-71.6%)**
- **Lifecycle Turns**: Without AICE = **47 turns** | AICE Without Idioms = **20 turns (-57.5%)** | AICE With Idioms = **15 turns (-68.1%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 3,560 tok / 6 turns | 2,914 tok / 6 turns | 2,114 tok / 6 turns | 0.0% / 0.0% |
| **Read (Context)** | 1,687 tok / 12 turns | 1,371 tok / 6 turns | 1,057 tok / 6 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 2,002 tok / 6 turns | 918 tok / 1 turns | 569 tok / 1 turns | -83.3% / **-83.3%** |
| **Delete (Surgical)** | 125 tok / 2 turns | 7 tok / 1 turns | 7 tok / 1 turns | -50.0% / **-50.0%** |
| **Refactor (Pattern)** | 6,804 tok / 21 turns | 3,055 tok / 6 turns | 279 tok / 1 turns | -71.4% / **-95.2%** |
| **TOTAL** | **14,178 tok / 47 turns** | **8,265 tok / 20 turns** | **4,026 tok / 15 turns** | **-57.5% / -68.1%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `matcher.rs` | `.rs` | 1096 | 887 | -19.1% | 499 | **-54.5%** |
| `margin_calc.cpp` | `.cpp` | 700 | 555 | -20.7% | 333 | **-52.4%** |
| `risk_daemon.py` | `.py` | 654 | 588 | -10.1% | 357 | **-45.4%** |
| `feed_ingest.go` | `.go` | 689 | 545 | -20.9% | 317 | **-54.0%** |
| `exchange_feeds.yaml` | `.yaml` | 182 | 174 | -4.4% | 112 | **-38.5%** |
| `collar_bands.json` | `.json` | 239 | 165 | -31.0% | 107 | **-55.2%** |

### RW-10: Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)

- **Description**: Polyglot enterprise control plane integrating all 15 supported languages and file types (.ts, .tsx, .js, .py, .go, .rs, .cpp, .cs, .kt, .php, .css, .html, .json, .yaml, .twig) in a single cohesive multi-service architecture.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 15 (`.ts`, `.tsx`, `.js`, `.py`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`, `.php`, `.css`, `.html`, `.json`, `.yaml`, `.twig`)
- **Idioms Used**: `$guard_band_step`, `$tsx_kpi_tile`, `$clamp_cart_line`, `$enforce_quota_band`, `$bounded_quorum_step`, `$advance_wal_cursor`, `$solve_axis_impulse`, `$settle_ledger_window`, `$score_risk_signal`, `$round_money_band`, `$css_card`, `$html_metric_row`, `$json_policy_rule`, `$yaml_service_tier`, `$twig_summary_line` (Definition Cost Charged on Write from 0: **932 tokens**)
- **Lifecycle Tokens**: Without AICE = **32,242** | AICE Without Idioms = **18,425 (-42.9%)** | AICE With Idioms = **8,968 (-72.2%)**
- **Lifecycle Turns**: Without AICE = **108 turns** | AICE Without Idioms = **47 turns (-56.5%)** | AICE With Idioms = **33 turns (-69.4%)**

#### Operation Breakdown (Tokens & Turns)

| Operation | Without AICE | AICE Without Idioms | AICE With Idioms | Turn Savings (No Id / Id) |
| :--- | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** | 7,837 tok / 15 turns | 6,359 tok / 15 turns | 4,715 tok / 15 turns | 0.0% / 0.0% |
| **Read (Context)** | 3,857 tok / 30 turns | 3,084 tok / 15 turns | 2,237 tok / 15 turns | -50.0% / **-50.0%** |
| **Update (Surgical)** | 4,997 tok / 15 turns | 2,200 tok / 1 turns | 1,335 tok / 1 turns | -93.3% / **-93.3%** |
| **Delete (Surgical)** | 122 tok / 2 turns | 7 tok / 1 turns | 7 tok / 1 turns | -50.0% / **-50.0%** |
| **Refactor (Pattern)** | 15,429 tok / 46 turns | 6,775 tok / 15 turns | 674 tok / 1 turns | -67.4% / **-97.8%** |
| **TOTAL** | **32,242 tok / 108 turns** | **18,425 tok / 47 turns** | **8,968 tok / 33 turns** | **-56.5% / -69.4%** |

#### Module File Breakdown

| File | Type | Native Tokens | AICE (No Idioms) | Savings (No Idioms) | AICE (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `telemetry_router.ts` | `.ts` | 780 | 643 | -17.6% | 360 | **-53.9%** |
| `ClusterHud.tsx` | `.tsx` | 567 | 492 | -13.2% | 258 | **-54.5%** |
| `widget_embed.js` | `.js` | 601 | 495 | -17.6% | 293 | **-51.3%** |
| `anomaly_worker.py` | `.py` | 644 | 569 | -11.7% | 343 | **-46.7%** |
| `mesh_proxy.go` | `.go` | 649 | 495 | -23.7% | 302 | **-53.5%** |
| `trace_ring.rs` | `.rs` | 678 | 534 | -21.2% | 312 | **-54.0%** |
| `packet_filter.cpp` | `.cpp` | 684 | 538 | -21.4% | 328 | **-52.0%** |
| `AuditLedger.cs` | `.cs` | 669 | 522 | -22.0% | 318 | **-52.5%** |
| `AlertDispatcher.kt` | `.kt` | 597 | 500 | -16.3% | 307 | **-48.6%** |
| `TenantPortal.php` | `.php` | 699 | 532 | -23.9% | 309 | **-55.8%** |
| `console.css` | `.css` | 413 | 302 | -26.9% | 206 | **-50.1%** |
| `console.html` | `.html` | 241 | 222 | -7.9% | 135 | **-44.0%** |
| `service_catalog.json` | `.json` | 241 | 167 | -30.7% | 109 | **-54.8%** |
| `mesh_topology.yaml` | `.yaml` | 183 | 175 | -4.4% | 113 | **-38.3%** |
| `status_digest.twig` | `.twig` | 191 | 173 | -9.4% | 90 | **-52.9%** |

