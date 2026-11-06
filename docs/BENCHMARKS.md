# AIL 2.0 Real-World Benchmark Report (10 Scenarios — Without & With Idioms)

- **Evaluation Mode**: 3-Way Apples-to-Apples (`Without AIL` vs `AIL Without Idioms` vs `AIL With Idioms`)
- **Total Real-World Benchmarks**: **10** (`RW-01` .. `RW-10`)
- **AIL Without Idioms Win Rate**: **10 / 10 (100.0%)**
- **AIL With Idioms Win Rate**: **10 / 10 (100.0%)**
- **Languages & File Types Covered (15)**: `.ts`, `.html`, `.css`, `.json`, `.py`, `.yaml`, `.php`, `.js`, `.twig`, `.tsx`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`
- **Engineering Scenarios Covered (5)**: `from_zero_window_app`, `from_zero_non_window_app`, `bug_fix`, `new_feature`, `update_feature`
- **Application Surfaces Covered (2)**: `window`, `non_window`
- **Zero `.ail` Files Left on Disk**: **PASS (0 .ail files)**

---

## 1. Aggregate Operation Breakdown (Across All 10 Real-World Benchmarks)

| Operation | Without AIL (Tokens) | AIL Without Idioms (Tokens) | Savings Without Idioms | AIL With Idioms (Tokens) | Savings With Idioms | Extra Idiom Boost |
| :--- | ---: | ---: | ---: | ---: | ---: | ---: |
| **Write (Create from 0)** *(incl. idiom defs)* | 27 959 | 22 323 | **-20.2%** | 13 991 | **-50.0%** | **+29.8%** |
| **Read (Discovery + Context)** | 15 956 | 8 359 | **-47.6%** | 5 261 | **-67.0%** | **+19.4%** |
| **Update (Bug Fix / Feature)** | 15 173 | 7 553 | **-50.2%** | 3 642 | **-76.0%** | **+25.8%** |
| **Delete (Obsolete Symbol)** | 2 157 | 162 | **-92.5%** | 162 | **-92.5%** | **+0.0%** |
| **Refactor (Multi-Site / Multi-File)** | 57 519 | 23 700 | **-58.8%** | 2 429 | **-95.8%** | **+37.0%** |
| **TOTAL LIFECYCLE** | **118 764** | **62 097** | **-47.7%** | **25 485** | **-78.5%** | **+30.8%** |

---

## 2. All 10 Real-World Benchmarks Summary Table

| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Idiom / Idiom) | Read (No Idiom / Idiom) | Update (No Idiom / Idiom) | Delete | Refactor (No Idiom / Idiom) | Total Without AIL | Total AIL (No Idioms) | Total AIL (With Idioms) |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)** | `window` | `from_zero_window_app` | `.ts .html .css .json` | -20.7% / **-51.6%** | -56.8% / **-74.0%** | -55.3% / **-77.7%** | **-91.8%** | -59.0% / **-96.7%** | 10 227 | 5 122 (**-49.9%**) | 2 112 (**-79.3%**) |
| `RW-02` | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)** | `non_window` | `from_zero_non_window_app` | `.py .yaml .json` | -15.5% / **-52.5%** | -56.0% / **-74.0%** | -44.8% / **-74.2%** | **-92.4%** | -55.3% / **-96.1%** | 7 969 | 4 299 (**-46.0%**) | 1 644 (**-79.4%**) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)** | `window` | `bug_fix` | `.php .js .twig .css .html .yaml .json` | -20.9% / **-47.4%** | -49.8% / **-66.2%** | -53.5% / **-77.8%** | **-92.0%** | -59.6% / **-94.9%** | 11 652 | 5 976 (**-48.7%**) | 2 661 (**-77.2%**) |
| `RW-04` | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)** | `window` | `new_feature` | `.ts .tsx .css .html .json .yaml` | -20.1% / **-46.0%** | -53.5% / **-72.5%** | -27.4% / **-64.2%** | **-92.8%** | -59.2% / **-96.2%** | 11 691 | 6 094 (**-47.9%**) | 2 419 (**-79.3%**) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)** | `non_window` | `update_feature` | `.go .rs .yaml .json` | -22.8% / **-54.1%** | -52.7% / **-71.9%** | -50.5% / **-77.1%** | **-92.7%** | -60.3% / **-95.8%** | 8 788 | 4 413 (**-49.8%**) | 1 732 (**-80.3%**) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)** | `window` | `bug_fix` | `.cpp .ts .html .css .json` | -20.8% / **-47.3%** | -50.3% / **-69.0%** | -55.9% / **-77.5%** | **-92.5%** | -59.7% / **-95.8%** | 9 291 | 4 725 (**-49.1%**) | 2 037 (**-78.1%**) |
| `RW-07` | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)** | `non_window` | `new_feature` | `.cs .kt .yaml .json` | -21.2% / **-52.9%** | -44.9% / **-58.7%** | -25.6% / **-64.6%** | **-93.6%** | -59.0% / **-96.5%** | 9 222 | 4 898 (**-46.9%**) | 1 876 (**-79.7%**) |
| `RW-08` | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)** | `window` | `update_feature` | `.py .tsx .twig .css .json .yaml` | -17.6% / **-44.4%** | -50.1% / **-70.4%** | -50.9% / **-75.4%** | **-91.5%** | -57.7% / **-95.1%** | 10 368 | 5 521 (**-46.8%**) | 2 408 (**-76.8%**) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)** | `non_window` | `bug_fix` | `.rs .cpp .py .go .yaml .json` | -20.7% / **-52.5%** | -42.2% / **-65.8%** | -53.3% / **-78.0%** | **-93.8%** | -58.9% / **-95.7%** | 12 224 | 6 430 (**-47.4%**) | 2 526 (**-79.3%**) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)** | `window` | `update_feature` | `.ts .tsx .js .py .go .rs .cpp .cs .kt .php .css .html .json .yaml .twig` | -20.4% / **-50.7%** | -36.7% / **-58.8%** | -54.9% / **-78.5%** | **-93.5%** | -58.6% / **-95.5%** | 27 332 | 14 619 (**-46.5%**) | 6 070 (**-77.8%**) |

---

## 3. Per-Benchmark Module & Operation Breakdown

### RW-01: HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)

- **Description**: Complete interactive browser game built from 0 with TypeScript game loop & collision engine, Canvas HUD renderer, HTML5 arcade shell, CSS3 neon cabinet theme, and JSON level config.
- **Scenario**: `from_zero_window_app` | **Surface**: `window` | **Files**: 5 (`.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$clamp_step`, `$html_row`, `$css_card`, `$json_row` (Definition Cost Charged on Write from 0: **198 tokens**)
- **Lifecycle Totals**: Without AIL = **10 227** | AIL Without Idioms = **5 122 (-49.9%)** | AIL With Idioms = **2 112 (-79.3%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `engine.ts` | `.ts` | 719 | 576 | -19.9% | 253 | **-64.8%** |
| `renderer.ts` | `.ts` | 458 | 368 | -19.6% | 160 | **-65.1%** |
| `index.html` | `.html` | 489 | 439 | -10.2% | 235 | **-51.9%** |
| `styles.css` | `.css` | 503 | 365 | -27.4% | 242 | **-51.9%** |
| `game_config.json` | `.json` | 410 | 297 | -27.6% | 160 | **-61.0%** |

### RW-02: Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)

- **Description**: Non-window background queue daemon & CLI tool created from 0 with Python retry backoff scheduler, worker pool controller, YAML service deployment topology, and JSON ingestion schema.
- **Scenario**: `from_zero_non_window_app` | **Surface**: `non_window` | **Files**: 4 (`.py`, `.yaml`, `.json`)
- **Idioms Used**: `$py_step`, `$yaml_row`, `$json_row` (Definition Cost Charged on Write from 0: **171 tokens**)
- **Lifecycle Totals**: Without AIL = **7 969** | AIL Without Idioms = **4 299 (-46.0%)** | AIL With Idioms = **1 644 (-79.4%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `worker.py` | `.py` | 655 | 594 | -9.3% | 265 | **-59.5%** |
| `cli.py` | `.py` | 417 | 375 | -10.1% | 164 | **-60.7%** |
| `pipeline.yaml` | `.yaml` | 469 | 379 | -19.2% | 158 | **-66.3%** |
| `schema.json` | `.json` | 419 | 309 | -26.3% | 172 | **-59.0%** |

### RW-03: Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)

- **Description**: Full server & client e-commerce storefront fixing a negative discount/tax rounding bug in CheckoutController.php while synchronizing client cart JS, Twig summary template, CSS styles, HTML modal, YAML routes, and JSON shipping tiers.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 7 (`.php`, `.js`, `.twig`, `.css`, `.html`, `.yaml`, `.json`)
- **Idioms Used**: `$php_step`, `$clamp_step`, `$twig_row`, `$css_card`, `$html_row`, `$yaml_row`, `$json_row` (Definition Cost Charged on Write from 0: **356 tokens**)
- **Lifecycle Totals**: Without AIL = **11 652** | AIL Without Idioms = **5 976 (-48.7%)** | AIL With Idioms = **2 661 (-77.2%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `CheckoutController.php` | `.php` | 809 | 612 | -24.4% | 279 | **-65.5%** |
| `cart-client.js` | `.js` | 461 | 380 | -17.6% | 166 | **-64.0%** |
| `checkout.twig` | `.twig` | 288 | 251 | -12.8% | 128 | **-55.6%** |
| `checkout.css` | `.css` | 411 | 298 | -27.5% | 202 | **-50.9%** |
| `shell.html` | `.html` | 225 | 206 | -8.4% | 115 | **-48.9%** |
| `routes.yaml` | `.yaml` | 310 | 254 | -18.1% | 108 | **-65.2%** |
| `shipping_rates.json` | `.json` | 273 | 197 | -27.8% | 107 | **-60.8%** |

### RW-04: Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)

- **Description**: Modern frontend workspace adding a new cohort retention & live sparkline feature across the TypeScript metrics store, React TSX dashboard panel, CSS grid cards, HTML shell, JSON bundle budget, and YAML preview pipeline.
- **Scenario**: `new_feature` | **Surface**: `window` | **Files**: 6 (`.ts`, `.tsx`, `.css`, `.html`, `.json`, `.yaml`)
- **Idioms Used**: `$clamp_step`, `$tsx_row`, `$css_card`, `$html_row`, `$json_row`, `$yaml_row` (Definition Cost Charged on Write from 0: **318 tokens**)
- **Lifecycle Totals**: Without AIL = **11 691** | AIL Without Idioms = **6 094 (-47.9%)** | AIL With Idioms = **2 419 (-79.3%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `metrics-store.ts` | `.ts` | 738 | 595 | -19.4% | 266 | **-64.0%** |
| `DashboardPanel.tsx` | `.tsx` | 590 | 478 | -19.0% | 249 | **-57.8%** |
| `dashboard.css` | `.css` | 413 | 301 | -27.1% | 205 | **-50.4%** |
| `index.html` | `.html` | 234 | 215 | -8.1% | 124 | **-47.0%** |
| `bundle_budgets.json` | `.json` | 277 | 202 | -27.1% | 112 | **-59.6%** |
| `vite_pipeline.yaml` | `.yaml` | 314 | 258 | -17.8% | 112 | **-64.3%** |

### RW-05: Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)

- **Description**: Cloud-native backend updating quorum consensus timeout and adaptive rate limiting across a Go API gateway, Rust write-ahead log compaction engine, YAML Raft cluster config, and JSON tenant burst quotas.
- **Scenario**: `update_feature` | **Surface**: `non_window` | **Files**: 4 (`.go`, `.rs`, `.yaml`, `.json`)
- **Idioms Used**: `$go_step`, `$rs_step`, `$yaml_row`, `$json_row` (Definition Cost Charged on Write from 0: **222 tokens**)
- **Lifecycle Totals**: Without AIL = **8 788** | AIL Without Idioms = **4 413 (-49.8%)** | AIL With Idioms = **1 732 (-80.3%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `gateway.go` | `.go` | 757 | 596 | -21.3% | 267 | **-64.7%** |
| `wal_engine.rs` | `.rs` | 796 | 599 | -24.8% | 268 | **-66.3%** |
| `cluster.yaml` | `.yaml` | 316 | 259 | -18.0% | 113 | **-64.2%** |
| `limits.json` | `.json` | 282 | 207 | -26.6% | 117 | **-58.5%** |

### RW-06: C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)

- **Description**: Hybrid native/web desktop viewport engine fixing a sub-pixel AABB collision tunneling clamp bug in C++20 while updating the TypeScript inspector bridge, HTML HUD overlay, CSS dock panel, and JSON solver settings.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 5 (`.cpp`, `.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$cpp_step`, `$clamp_step`, `$html_row`, `$css_card`, `$json_row` (Definition Cost Charged on Write from 0: **249 tokens**)
- **Lifecycle Totals**: Without AIL = **9 291** | AIL Without Idioms = **4 725 (-49.1%)** | AIL With Idioms = **2 037 (-78.1%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `viewport_sim.cpp` | `.cpp` | 738 | 584 | -20.9% | 261 | **-64.6%** |
| `inspector.ts` | `.ts` | 486 | 396 | -18.5% | 175 | **-64.0%** |
| `overlay.html` | `.html` | 237 | 218 | -8.0% | 127 | **-46.4%** |
| `overlay.css` | `.css` | 414 | 303 | -26.8% | 207 | **-50.0%** |
| `engine_settings.json` | `.json` | 281 | 207 | -26.3% | 117 | **-58.4%** |

### RW-07: C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)

- **Description**: Enterprise fintech backend adding instant payout fee calculation and real-time velocity risk scoring across C# .NET settlement services, Kotlin Ktor fraud evaluators, YAML clearing routing, and JSON risk rule weights.
- **Scenario**: `new_feature` | **Surface**: `non_window` | **Files**: 4 (`.cs`, `.kt`, `.yaml`, `.json`)
- **Idioms Used**: `$cs_step`, `$kt_step`, `$yaml_row`, `$json_row` (Definition Cost Charged on Write from 0: **222 tokens**)
- **Lifecycle Totals**: Without AIL = **9 222** | AIL Without Idioms = **4 898 (-46.9%)** | AIL With Idioms = **1 876 (-79.7%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `SettlementEngine.cs` | `.cs` | 808 | 614 | -24.0% | 276 | **-65.8%** |
| `FraudScorer.kt` | `.kt` | 711 | 587 | -17.4% | 263 | **-63.0%** |
| `settlement_policy.yaml` | `.yaml` | 324 | 267 | -17.6% | 121 | **-62.6%** |
| `risk_rules.json` | `.json` | 284 | 209 | -26.4% | 119 | **-58.1%** |

### RW-08: Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)

- **Description**: Multi-tenant SaaS billing & reporting portal updating multi-currency tax rounding and usage quota gauges across Python FastAPI services, React TSX usage charts, Twig invoice templates, CSS print/screen rules, JSON plan tiers, and YAML cron workers.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 6 (`.py`, `.tsx`, `.twig`, `.css`, `.json`, `.yaml`)
- **Idioms Used**: `$py_step`, `$tsx_row`, `$twig_row`, `$css_card`, `$json_row`, `$yaml_row` (Definition Cost Charged on Write from 0: **305 tokens**)
- **Lifecycle Totals**: Without AIL = **10 368** | AIL Without Idioms = **5 521 (-46.8%)** | AIL With Idioms = **2 408 (-76.8%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `billing_service.py` | `.py` | 666 | 605 | -9.2% | 276 | **-58.6%** |
| `UsageChart.tsx` | `.tsx` | 485 | 395 | -18.6% | 216 | **-55.5%** |
| `invoice_email.twig` | `.twig` | 288 | 251 | -12.8% | 128 | **-55.6%** |
| `billing.css` | `.css` | 412 | 299 | -27.4% | 203 | **-50.7%** |
| `plans.json` | `.json` | 283 | 209 | -26.1% | 119 | **-58.0%** |
| `worker_cron.yaml` | `.yaml` | 317 | 261 | -17.7% | 115 | **-63.7%** |

### RW-09: High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)

- **Description**: Ultra-low-latency non-window trading & risk pipeline fixing a self-trade price collar boundary bug across a Rust matching engine, C++20 intraday margin calculator, Python compliance daemon, Go market feed normalizer, YAML venue feeds, and JSON collar bands.
- **Scenario**: `bug_fix` | **Surface**: `non_window` | **Files**: 6 (`.rs`, `.cpp`, `.py`, `.go`, `.yaml`, `.json`)
- **Idioms Used**: `$rs_step`, `$cpp_step`, `$py_step`, `$go_step`, `$yaml_row`, `$json_row` (Definition Cost Charged on Write from 0: **324 tokens**)
- **Lifecycle Totals**: Without AIL = **12 224** | AIL Without Idioms = **6 430 (-47.4%)** | AIL With Idioms = **2 526 (-79.3%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `matcher.rs` | `.rs` | 798 | 601 | -24.7% | 270 | **-66.2%** |
| `margin_calc.cpp` | `.cpp` | 521 | 413 | -20.7% | 183 | **-64.9%** |
| `risk_daemon.py` | `.py` | 431 | 389 | -9.7% | 172 | **-60.1%** |
| `feed_ingest.go` | `.go` | 495 | 383 | -22.6% | 170 | **-65.7%** |
| `exchange_feeds.yaml` | `.yaml` | 318 | 263 | -17.3% | 117 | **-63.2%** |
| `collar_bands.json` | `.json` | 279 | 205 | -26.5% | 115 | **-58.8%** |

### RW-10: Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)

- **Description**: Polyglot enterprise control plane integrating all 15 supported languages and file types (.ts, .tsx, .js, .py, .go, .rs, .cpp, .cs, .kt, .php, .css, .html, .json, .yaml, .twig) in a single cohesive multi-service architecture.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 15 (`.ts`, `.tsx`, `.js`, `.py`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`, `.php`, `.css`, `.html`, `.json`, `.yaml`, `.twig`)
- **Idioms Used**: `$clamp_step`, `$tsx_row`, `$py_step`, `$go_step`, `$rs_step`, `$cpp_step`, `$cs_step`, `$kt_step`, `$php_step`, `$css_card`, `$html_row`, `$json_row`, `$yaml_row`, `$twig_row` (Definition Cost Charged on Write from 0: **715 tokens**)
- **Lifecycle Totals**: Without AIL = **27 332** | AIL Without Idioms = **14 619 (-46.5%)** | AIL With Idioms = **6 070 (-77.8%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `telemetry_router.ts` | `.ts` | 581 | 469 | -19.3% | 209 | **-64.0%** |
| `ClusterHud.tsx` | `.tsx` | 477 | 387 | -18.9% | 209 | **-56.2%** |
| `widget_embed.js` | `.js` | 455 | 374 | -17.8% | 163 | **-64.2%** |
| `anomaly_worker.py` | `.py` | 418 | 376 | -10.1% | 165 | **-60.5%** |
| `mesh_proxy.go` | `.go` | 488 | 376 | -22.9% | 168 | **-65.6%** |
| `trace_ring.rs` | `.rs` | 530 | 394 | -25.7% | 173 | **-67.4%** |
| `packet_filter.cpp` | `.cpp` | 502 | 392 | -21.9% | 176 | **-64.9%** |
| `AuditLedger.cs` | `.cs` | 507 | 378 | -25.4% | 165 | **-67.5%** |
| `AlertDispatcher.kt` | `.kt` | 457 | 379 | -17.1% | 168 | **-63.2%** |
| `TenantPortal.php` | `.php` | 518 | 390 | -24.7% | 173 | **-66.6%** |
| `console.css` | `.css` | 413 | 302 | -26.9% | 206 | **-50.1%** |
| `console.html` | `.html` | 237 | 218 | -8.0% | 127 | **-46.4%** |
| `service_catalog.json` | `.json` | 281 | 207 | -26.3% | 117 | **-58.4%** |
| `mesh_topology.yaml` | `.yaml` | 317 | 261 | -17.7% | 115 | **-63.7%** |
| `status_digest.twig` | `.twig` | 169 | 151 | -10.7% | 80 | **-52.7%** |

