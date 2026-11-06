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
| **Write (Create from 0)** *(incl. idiom defs)* | 33 034 | 26 816 | **-18.8%** | 19 545 | **-40.8%** | **+22.0%** |
| **Read (Discovery + Context)** | 14 867 | 9 950 | **-33.1%** | 7 128 | **-52.0%** | **+19.0%** |
| **Update (Bug Fix / Feature)** | 17 205 | 8 174 | **-52.5%** | 4 911 | **-71.5%** | **+19.0%** |
| **Delete (Obsolete Symbol)** | 2 233 | 162 | **-92.8%** | 162 | **-92.8%** | **+0.0%** |
| **Refactor (Multi-Site / Multi-File)** | 59 778 | 26 685 | **-55.4%** | 2 522 | **-95.8%** | **+40.4%** |
| **TOTAL LIFECYCLE** | **127 117** | **71 787** | **-43.5%** | **34 268** | **-73.0%** | **+29.5%** |

---

## 2. All 10 Real-World Benchmarks Summary Table

| ID | Real-World Benchmark Scenario | Surface | Task Kind | File Types | Write (No Idiom / Idiom) | Read (No Idiom / Idiom) | Update (No Idiom / Idiom) | Delete | Refactor (No Idiom / Idiom) | Total Without AIL | Total AIL (No Idioms) | Total AIL (With Idioms) |
| :--- | :--- | :--- | :--- | :--- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `RW-01` | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)** | `window` | `from_zero_window_app` | `.ts .html .css .json` | -21.1% / **-46.1%** | -36.5% / **-57.4%** | -57.1% / **-75.0%** | **-91.6%** | -56.9% / **-96.9%** | 11 038 | 5 944 (**-46.1%**) | 2 709 (**-75.5%**) |
| `RW-02` | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)** | `non_window` | `from_zero_non_window_app` | `.py .yaml .json` | -13.0% / **-37.9%** | -26.1% / **-45.3%** | -47.0% / **-67.5%** | **-90.1%** | -51.3% / **-96.4%** | 7 852 | 4 791 (**-39.0%**) | 2 274 (**-71.0%**) |
| `RW-03` | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)** | `window` | `bug_fix` | `.php .js .twig .css .html .yaml .json` | -19.0% / **-39.8%** | -31.6% / **-49.5%** | -55.7% / **-74.2%** | **-92.8%** | -56.7% / **-95.1%** | 12 061 | 6 659 (**-44.8%**) | 3 285 (**-72.8%**) |
| `RW-04` | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)** | `window` | `new_feature` | `.ts .tsx .css .html .json .yaml` | -19.1% / **-40.7%** | -40.6% / **-60.2%** | -27.5% / **-57.2%** | **-93.7%** | -55.0% / **-95.1%** | 10 303 | 6 023 (**-41.5%**) | 2 895 (**-71.9%**) |
| `RW-05` | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)** | `non_window` | `update_feature` | `.go .rs .yaml .json` | -25.4% / **-45.0%** | -38.6% / **-56.6%** | -52.4% / **-72.0%** | **-93.5%** | -55.3% / **-96.0%** | 9 697 | 5 269 (**-45.7%**) | 2 495 (**-74.3%**) |
| `RW-06` | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)** | `window` | `bug_fix` | `.cpp .ts .html .css .json` | -18.9% / **-40.5%** | -36.3% / **-56.5%** | -57.7% / **-74.5%** | **-93.3%** | -56.1% / **-95.8%** | 10 193 | 5 596 (**-45.1%**) | 2 638 (**-74.1%**) |
| `RW-07` | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)** | `non_window` | `new_feature` | `.cs .kt .yaml .json` | -18.4% / **-40.2%** | -23.1% / **-36.5%** | -27.9% / **-54.3%** | **-94.3%** | -54.4% / **-95.9%** | 8 652 | 5 204 (**-39.9%**) | 2 557 (**-70.5%**) |
| `RW-08` | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)** | `window` | `update_feature` | `.py .tsx .twig .css .json .yaml` | -14.6% / **-38.3%** | -32.0% / **-54.9%** | -52.7% / **-72.6%** | **-92.5%** | -53.4% / **-95.2%** | 10 787 | 6 321 (**-41.4%**) | 2 981 (**-72.4%**) |
| `RW-09` | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)** | `non_window` | `bug_fix` | `.rs .cpp .py .go .yaml .json` | -18.3% / **-40.8%** | -34.8% / **-53.3%** | -55.7% / **-72.6%** | **-94.4%** | -55.1% / **-96.0%** | 14 268 | 8 000 (**-43.9%**) | 3 755 (**-73.7%**) |
| `RW-10` | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)** | `window` | `update_feature` | `.ts .tsx .js .py .go .rs .cpp .cs .kt .php .css .html .json .yaml .twig` | -18.9% / **-39.9%** | -30.6% / **-49.2%** | -56.6% / **-73.7%** | **-94.3%** | -56.2% / **-95.7%** | 32 266 | 17 980 (**-44.3%**) | 8 679 (**-73.1%**) |

---

## 3. Per-Benchmark Module & Operation Breakdown

### RW-01: HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)

- **Description**: Complete interactive browser game built from 0 with TypeScript game loop & collision engine, Canvas HUD renderer, HTML5 arcade shell, CSS3 neon cabinet theme, and JSON level config.
- **Scenario**: `from_zero_window_app` | **Surface**: `window` | **Files**: 5 (`.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$guard_band_step`, `$html_metric_row`, `$css_card`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **218 tokens**)
- **Lifecycle Totals**: Without AIL = **11 038** | AIL Without Idioms = **5 944 (-46.1%)** | AIL With Idioms = **2 709 (-75.5%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
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
- **Lifecycle Totals**: Without AIL = **7 852** | AIL Without Idioms = **4 791 (-39.0%)** | AIL With Idioms = **2 274 (-71.0%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `worker.py` | `.py` | 934 | 847 | -9.3% | 515 | **-44.9%** |
| `cli.py` | `.py` | 583 | 519 | -11.0% | 323 | **-44.6%** |
| `pipeline.yaml` | `.yaml` | 264 | 247 | -6.4% | 152 | **-42.4%** |
| `schema.json` | `.json` | 351 | 241 | -31.3% | 152 | **-56.7%** |

### RW-03: Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)

- **Description**: Full server & client e-commerce storefront fixing a negative discount/tax rounding bug in CheckoutController.php while synchronizing client cart JS, Twig summary template, CSS styles, HTML modal, YAML routes, and JSON shipping tiers.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 7 (`.php`, `.js`, `.twig`, `.css`, `.html`, `.yaml`, `.json`)
- **Idioms Used**: `$round_money_band`, `$clamp_cart_line`, `$twig_summary_line`, `$css_card`, `$html_metric_row`, `$yaml_service_tier`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **389 tokens**)
- **Lifecycle Totals**: Without AIL = **12 061** | AIL Without Idioms = **6 659 (-44.8%)** | AIL With Idioms = **3 285 (-72.8%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
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
- **Lifecycle Totals**: Without AIL = **10 303** | AIL Without Idioms = **6 023 (-41.5%)** | AIL With Idioms = **2 895 (-71.9%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
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
- **Lifecycle Totals**: Without AIL = **9 697** | AIL Without Idioms = **5 269 (-45.7%)** | AIL With Idioms = **2 495 (-74.3%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `gateway.go` | `.go` | 1117 | 823 | -26.3% | 503 | **-55.0%** |
| `wal_engine.rs` | `.rs` | 1156 | 846 | -26.8% | 506 | **-56.2%** |
| `cluster.yaml` | `.yaml` | 181 | 173 | -4.4% | 111 | **-38.7%** |
| `limits.json` | `.json` | 245 | 170 | -30.6% | 112 | **-54.3%** |

### RW-06: C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)

- **Description**: Hybrid native/web desktop viewport engine fixing a sub-pixel AABB collision tunneling clamp bug in C++20 while updating the TypeScript inspector bridge, HTML HUD overlay, CSS dock panel, and JSON solver settings.
- **Scenario**: `bug_fix` | **Surface**: `window` | **Files**: 5 (`.cpp`, `.ts`, `.html`, `.css`, `.json`)
- **Idioms Used**: `$solve_axis_impulse`, `$guard_band_step`, `$html_metric_row`, `$css_card`, `$json_policy_rule` (Definition Cost Charged on Write from 0: **287 tokens**)
- **Lifecycle Totals**: Without AIL = **10 193** | AIL Without Idioms = **5 596 (-45.1%)** | AIL With Idioms = **2 638 (-74.1%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
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
- **Lifecycle Totals**: Without AIL = **8 652** | AIL Without Idioms = **5 204 (-39.9%)** | AIL With Idioms = **2 557 (-70.5%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `SettlementEngine.cs` | `.cs` | 1082 | 854 | -21.1% | 515 | **-52.4%** |
| `FraudScorer.kt` | `.kt` | 952 | 810 | -14.9% | 480 | **-49.6%** |
| `settlement_policy.yaml` | `.yaml` | 187 | 179 | -4.3% | 117 | **-37.4%** |
| `risk_rules.json` | `.json` | 239 | 164 | -31.4% | 106 | **-55.6%** |

### RW-08: Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)

- **Description**: Multi-tenant SaaS billing & reporting portal updating multi-currency tax rounding and usage quota gauges across Python FastAPI services, React TSX usage charts, Twig invoice templates, CSS print/screen rules, JSON plan tiers, and YAML cron workers.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 6 (`.py`, `.tsx`, `.twig`, `.css`, `.json`, `.yaml`)
- **Idioms Used**: `$enforce_quota_band`, `$tsx_kpi_tile`, `$twig_summary_line`, `$css_card`, `$json_policy_rule`, `$yaml_service_tier` (Definition Cost Charged on Write from 0: **328 tokens**)
- **Lifecycle Totals**: Without AIL = **10 787** | AIL Without Idioms = **6 321 (-41.4%)** | AIL With Idioms = **2 981 (-72.4%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
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
- **Lifecycle Totals**: Without AIL = **14 268** | AIL Without Idioms = **8 000 (-43.9%)** | AIL With Idioms = **3 755 (-73.7%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `matcher.rs` | `.rs` | 1100 | 887 | -19.4% | 499 | **-54.6%** |
| `margin_calc.cpp` | `.cpp` | 700 | 555 | -20.7% | 333 | **-52.4%** |
| `risk_daemon.py` | `.py` | 654 | 588 | -10.1% | 357 | **-45.4%** |
| `feed_ingest.go` | `.go` | 693 | 545 | -21.4% | 317 | **-54.3%** |
| `exchange_feeds.yaml` | `.yaml` | 182 | 174 | -4.4% | 112 | **-38.5%** |
| `collar_bands.json` | `.json` | 239 | 165 | -31.0% | 107 | **-55.2%** |

### RW-10: Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)

- **Description**: Polyglot enterprise control plane integrating all 15 supported languages and file types (.ts, .tsx, .js, .py, .go, .rs, .cpp, .cs, .kt, .php, .css, .html, .json, .yaml, .twig) in a single cohesive multi-service architecture.
- **Scenario**: `update_feature` | **Surface**: `window` | **Files**: 15 (`.ts`, `.tsx`, `.js`, `.py`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`, `.php`, `.css`, `.html`, `.json`, `.yaml`, `.twig`)
- **Idioms Used**: `$guard_band_step`, `$tsx_kpi_tile`, `$clamp_cart_line`, `$enforce_quota_band`, `$bounded_quorum_step`, `$advance_wal_cursor`, `$solve_axis_impulse`, `$settle_ledger_window`, `$score_risk_signal`, `$round_money_band`, `$css_card`, `$html_metric_row`, `$json_policy_rule`, `$yaml_service_tier`, `$twig_summary_line` (Definition Cost Charged on Write from 0: **932 tokens**)
- **Lifecycle Totals**: Without AIL = **32 266** | AIL Without Idioms = **17 980 (-44.3%)** | AIL With Idioms = **8 679 (-73.1%)**

| File | Type | Native Tokens | AIL (No Idioms) | Savings (No Idioms) | AIL (With Idioms) | Savings (With Idioms) |
| :--- | :--- | ---: | ---: | ---: | ---: | ---: |
| `telemetry_router.ts` | `.ts` | 780 | 643 | -17.6% | 360 | **-53.9%** |
| `ClusterHud.tsx` | `.tsx` | 567 | 492 | -13.2% | 258 | **-54.5%** |
| `widget_embed.js` | `.js` | 601 | 495 | -17.6% | 293 | **-51.3%** |
| `anomaly_worker.py` | `.py` | 644 | 569 | -11.7% | 343 | **-46.7%** |
| `mesh_proxy.go` | `.go` | 653 | 495 | -24.2% | 302 | **-53.8%** |
| `trace_ring.rs` | `.rs` | 682 | 534 | -21.7% | 312 | **-54.3%** |
| `packet_filter.cpp` | `.cpp` | 684 | 538 | -21.4% | 328 | **-52.0%** |
| `AuditLedger.cs` | `.cs` | 669 | 522 | -22.0% | 318 | **-52.5%** |
| `AlertDispatcher.kt` | `.kt` | 594 | 500 | -15.8% | 307 | **-48.3%** |
| `TenantPortal.php` | `.php` | 699 | 532 | -23.9% | 309 | **-55.8%** |
| `console.css` | `.css` | 413 | 302 | -26.9% | 206 | **-50.1%** |
| `console.html` | `.html` | 241 | 222 | -7.9% | 135 | **-44.0%** |
| `service_catalog.json` | `.json` | 241 | 167 | -30.7% | 109 | **-54.8%** |
| `mesh_topology.yaml` | `.yaml` | 183 | 175 | -4.4% | 113 | **-38.3%** |
| `status_digest.twig` | `.twig` | 191 | 173 | -9.4% | 90 | **-52.9%** |

