# AICE 2.0 — Real AI Agent Benchmark Suite Report (Adversarial Cold-Start Scenarios — Without & With Idioms)

> **Ground-Truth Adversarial Real AI Agent Proof**: Every number in this report comes from **real autonomous AI agent (`agy -p`) executions** running against **cold-start, procedurally seeded, decoy-minefielded workspaces** on disk under **blind issue prompts** (zero symbol name leakage, zero positional `@first` shortcuts, zero pre-baked `aice.config.json`) and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: 4 Bulletproof Metrics (Real AI Agents vs Deterministic Offline Suite)

| Metric (Across All 10 Multi-File Scenarios `RW-01` .. `RW-10`) | Without AICE (Native Tools) | AICE Without Idioms (Pure AICE) | AICE With Idioms (Cold-Start `$idiom` Scan + Splice) | AICE Win Rate |
| :--- | :---: | :---: | :---: | :---: |
| **1. Real Agent LLM Output Tokens** (`output_tokens`, 4x API cost weight) | 146,803 | **43,417 (-70.4%)** | **18,842 (-87.2%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **2. Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 470,790 | **160,340 (-65.9%)** | **107,713 (-77.1%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **3. Real API Dollar Cost (USD)** (`$0.15/1M in, $0.0375/1M cache, $0.60/1M out`) | $1.1045 | **$0.2831 (-74.4%)** | **$0.2329 (-78.9%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **4. Real Agent Total API Context Tokens** (`input + cache + output`) | 20,781,794 | **4,553,395 (-78.1%)** | **3,824,861 (-81.6%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 2,303,135 | **825,156 (-64.2%)** | **720,259 (-68.7%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 439 turns | **129 turns (-70.6%)** | **120 turns (-72.7%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 435 calls | **99 calls (-77.2%)** | **90 calls (-79.3%)** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **Real Agent Wall-Clock Duration** | 6766.1s | **1969.9s** | **1606.8s** | Pure 10/10 | **+Idioms 10/10 (100%)** |
| **Offline Deterministic Suite Tokens** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 127,021 | **74,015 (-41.7%)** | **36,180 (-71.5%)** | **10/10 (100%)** |
| **Offline Deterministic Suite Turns** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 502 turns | **206 turns (-59.0%)** | **154 turns (-69.3%)** | **10/10 (100%)** |

## 2. Adversarial Cold-Start Methodology & How Real Agent Telemetry Is Measured

To eliminate any possibility of prompt coaching, pre-computed idioms, positional shortcuts, or regex hacks, every live benchmark run enforces **6 adversarial fairness guarantees**:
1. **Zero Pre-Baked Idioms (100% Cold-Start Repository)**: `setupWorkspace` writes **only** raw native source files (`.ts`, `.py`, `.go`, `.rs`, `.cpp`, `.cs`, `.kt`, `.php`, `.js`, `.tsx`, `.css`, `.html`, `.twig`, `.json`, `.yaml`) to disk. No `aice.config.json` or `.aice-idioms.json` exists when the session starts. In `aice_with_idioms` mode, idioms are discovered and persisted to `aice.config.json` during the live run.
2. **Procedurally Seeded Non-First Target Symbols & Parameters (Zero Positional Shortcuts)**: Each CLI run generates a fresh random seed (`generateFreshBenchmarkSeed()`) that selects a **non-first declaration (`targetIdx >= 1`)** in every file and randomizes its numeric scale, offset, and band bounds. Prompts never use `@first` or positional indices; instead, targets are described in plain English by their unique domain signature/attributes.
3. **Blind Issue Prompts & Un-Handcuffed Baseline**: `buildTaskSpecText` never leaks any target symbol name or obsolete symbol name, `without_aice` has full access to `multi_replace_file_content` alongside `grep_search, find_by_name, view_file, replace_file_content`, and AICE prompts provide only a neutral CLI flag/schema reference without step-by-step command recipes.
4. **Procedurally Seeded Decoy Minefields (`verifyDecoySentinel_<seed>` + `DECOY_SENTINEL_<seed>`)**: Every code module is procedurally injected with a seeded sentinel function (`verifyDecoySentinel_<hex>(probe) -> probe + <step>`) and decoy comment (`DECOY_SENTINEL_<hex>: legacy_deprecated_obsolete_probe + <step>`) that must remain intact. Naive global regex/`sed` replacements or blind `legacy` deletions corrupt the decoys and fail `verifyWorkspaceOnDisk` (`decoysIntact === false`).
5. **Hostile 1-File, 0-Idiom "Lone Needle" Scenario (`RW-11`) & Real Compiler Verification**: In addition to `RW-01`..`RW-10`, the suite includes `RW-11` (`ledger_reconciler.ts`), a single-file TypeScript bug-fix with **14 heterogeneous functions and 0 repeated project idioms** where cross-file `--batch` and `$idiom` templates provide zero advantage. Every modified workspace is verified with real compilers/parsers (`node --check`, `python3 -m py_compile`, `php -l`, `g++ -std=c++20 -fsyntax-only`, `rustc`, `JSON.parse`, and AICE AST decompilation).
6. **4-Metric Ground-Truth Telemetry (`transcript.jsonl`)**: Parsed directly from `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl`: **LLM Output Tokens (`outputTokens`)**, **Working Payload Tokens (`workingTokens`)**, **Real API Dollar Cost (`apiCostUsd`)**, and **Total API Context Tokens (`apiTotalTokens`) & LLM Turns (`llmTurns`)**.

## 3. All Adversarial Scenarios — Real AI Agent Results (`RW-01` .. `RW-10` + `RW-11` Hostile Lone Needle)

| ID | Scenario & Languages | Turns (No AICE / Pure AICE / +Idioms) | Working Tokens (No AICE / Pure AICE / +Idioms) | LLM Output Tokens (No AICE / Pure AICE / +Idioms) | Real API Cost USD (No AICE / Pure AICE / +Idioms) | Total API Context Tokens (No AICE / Pure AICE / +Idioms) | Verified (Compiler + Decoys) |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 30 / **9** (-70%) / **9** (-70%) | 28,193 / **13,174** (-53.3%) / **7,863** (-72.1%) | 7,634 / **3,585** (-53.0%) / **1,538** (-79.8%) | $0.0655 / **$0.0195** (-70.3%) / **$0.0174** (-73.4%) | 1,169,778 / **287,258** (-75.4%) / **264,318** (-77.4%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 42 / **9** (-79%) / **10** (-76%) | 46,040 / **10,452** (-77.3%) / **7,174** (-84.4%) | 8,461 / **2,862** (-66.2%) / **1,340** (-84.2%) | $0.1021 / **$0.0189** (-81.5%) / **$0.0186** (-81.7%) | 1,992,126 / **279,259** (-86.0%) / **291,436** (-85.4%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 51 / **10** (-80%) / **14** (-73%) | 82,111 / **14,797** (-82.0%) / **11,343** (-86.2%) | 43,002 / **4,230** (-90.2%) / **2,370** (-94.5%) | $0.1595 / **$0.0220** (-86.2%) / **$0.0280** (-82.4%) | 2,826,456 / **332,830** (-88.2%) / **445,380** (-84.2%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 45 / **15** (-67%) / **14** (-69%) | 56,595 / **18,192** (-67.9%) / **14,366** (-74.6%) | 22,985 / **4,756** (-79.3%) / **1,997** (-91.3%) | $0.1026 / **$0.0315** (-69.3%) / **$0.0272** (-73.4%) | 1,756,810 / **526,048** (-70.1%) / **469,020** (-73.3%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 44 / **9** (-80%) / **16** (-64%) | 43,043 / **9,791** (-77.3%) / **11,882** (-72.4%) | 9,886 / **2,776** (-71.9%) / **1,470** (-85.1%) | $0.1087 / **$0.0185** (-83.0%) / **$0.0273** (-74.8%) | 2,189,072 / **270,932** (-87.6%) / **513,905** (-76.5%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 36 / **11** (-69%) / **9** (-75%) | 38,640 / **13,164** (-65.9%) / **7,698** (-80.1%) | 6,209 / **3,424** (-44.9%) / **1,506** (-75.7%) | $0.0862 / **$0.0245** (-71.6%) / **$0.0171** (-80.2%) | 1,532,069 / **351,341** (-77.1%) / **265,091** (-82.7%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 42 / **21** (-50%) / **10** (-76%) | 32,575 / **19,645** (-39.7%) / **8,434** (-74.1%) | 8,845 / **4,165** (-52.9%) / **1,408** (-84.1%) | $0.0890 / **$0.0430** (-51.7%) / **$0.0192** (-78.4%) | 1,657,906 / **741,085** (-55.3%) / **295,154** (-82.2%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 45 / **9** (-80%) / **9** (-80%) | 29,943 / **13,261** (-55.7%) / **7,726** (-74.2%) | 6,136 / **3,592** (-41.5%) / **1,466** (-76.1%) | $0.1005 / **$0.0203** (-79.8%) / **$0.0173** (-82.8%) | 1,840,018 / **292,936** (-84.1%) / **266,963** (-85.5%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 28 / **9** (-68%) / **17** (-39%) | 34,059 / **14,221** (-58.3%) / **11,308** (-66.8%) | 10,265 / **4,065** (-60.4%) / **2,212** (-78.5%) | $0.0633 / **$0.0204** (-67.8%) / **$0.0320** (-49.5%) | 1,105,539 / **301,255** (-72.8%) / **545,609** (-50.6%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 76 / **27** (-64%) / **12** (-84%) | 79,591 / **33,643** (-57.7%) / **19,919** (-75.0%) | 23,380 / **9,962** (-57.4%) / **3,535** (-84.9%) | $0.2272 / **$0.0646** (-71.6%) / **$0.0287** (-87.4%) | 4,712,020 / **1,170,451** (-75.2%) / **467,985** (-90.1%) | ✅ AICE 2/2 (Base ⚠️) |
| **TOTAL (`RW-01..10`)** | **All 10 Multi-File Scenarios (15/15 Languages)** | **439** / **129** (-70.6%) / **120** (-72.7%) | **470,790** / **160,340** (-65.9%) / **107,713** (-77.1%) | **146,803** / **43,417** (-70.4%) / **18,842** (-87.2%) | **$1.1045** / **$0.2831** (-74.4%) / **$0.2329** (-78.9%) | **20,781,794** / **4,553,395** (-78.1%) / **3,824,861** (-81.6%) | ✅ **24/30 (AICE 20/20)** |
| **RW-11 (Hostile 0-Idiom)** | **Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)**<br/>`ts` (1 file, **0 idioms**) | 24 / **9** (-63%) / **8** (-67%) | 12,104 / **3,217** (-73.4%) / **2,556** (-78.9%) | 1,855 / **539** (-70.9%) / **469** (-74.7%) | $0.0404 / **$0.0156** (-61.4%) / **$0.0142** (-64.9%) | 709,043 / **233,791** (-67.0%) / **206,299** (-70.9%) | ✅ 100% |

### 3b. 3-Layer Progressive Lifecycle Breakdown (Live Telemetry)

| Scenario | Mode | L1 Baseline | L2 Feature Add | L3 Cross-Cutting | Total Turns | Working Tokens | LLM Output Tokens | Real Cost (USD) | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | `without_aice` | 13t / $0.0277 / ✅ | 11t / $0.0238 / ✅ | 6t / $0.0139 / ✅ | **30** | **28,193** | **7,634** | **$0.0655** | ✅ 100% |
| **RW-01** | **`aice_no_idioms`** | 3t / $0.0088 / ✅ | 3t / $0.0051 / ✅ | 3t / $0.0056 / ✅ | **9** | **13,174** | **3,585** | **$0.0195** | ✅ 100% |
| **RW-01** | **`aice_with_idioms`** | 3t / $0.0073 / ✅ | 3t / $0.0052 / ✅ | 3t / $0.0050 / ✅ | **9** | **7,863** | **1,538** | **$0.0174** | ✅ 100% |
| **RW-02** | `without_aice` | 17t / $0.0331 / ✅ | 25t / $0.0690 / ❌ | — | **42** | **46,040** | **8,461** | **$0.1021** | ⚠️ Partial |
| **RW-02** | **`aice_no_idioms`** | 3t / $0.0085 / ✅ | 3t / $0.0051 / ✅ | 3t / $0.0053 / ✅ | **9** | **10,452** | **2,862** | **$0.0189** | ✅ 100% |
| **RW-02** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 4t / $0.0067 / ✅ | 3t / $0.0048 / ✅ | **10** | **7,174** | **1,340** | **$0.0186** | ✅ 100% |
| **RW-03** | `without_aice` | 27t / $0.0572 / ✅ | 17t / $0.0680 / ✅ | 7t / $0.0343 / ✅ | **51** | **82,111** | **43,002** | **$0.1595** | ✅ 100% |
| **RW-03** | **`aice_no_idioms`** | 3t / $0.0089 / ✅ | 4t / $0.0072 / ✅ | 3t / $0.0060 / ✅ | **10** | **14,797** | **4,230** | **$0.0220** | ✅ 100% |
| **RW-03** | **`aice_with_idioms`** | 3t / $0.0073 / ✅ | 8t / $0.0151 / ✅ | 3t / $0.0056 / ✅ | **14** | **11,343** | **2,370** | **$0.0280** | ✅ 100% |
| **RW-04** | `without_aice` | 18t / $0.0225 / ✅ | 20t / $0.0561 / ✅ | 7t / $0.0240 / ❌ | **45** | **56,595** | **22,985** | **$0.1026** | ⚠️ Partial |
| **RW-04** | **`aice_no_idioms`** | 4t / $0.0109 / ✅ | 8t / $0.0144 / ✅ | 3t / $0.0062 / ✅ | **15** | **18,192** | **4,756** | **$0.0315** | ✅ 100% |
| **RW-04** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 8t / $0.0141 / ✅ | 3t / $0.0060 / ✅ | **14** | **14,366** | **1,997** | **$0.0272** | ✅ 100% |
| **RW-05** | `without_aice` | 15t / $0.0325 / ✅ | 21t / $0.0538 / ✅ | 8t / $0.0224 / ✅ | **44** | **43,043** | **9,886** | **$0.1087** | ✅ 100% |
| **RW-05** | **`aice_no_idioms`** | 4t / $0.0097 / ✅ | 3t / $0.0051 / ✅ | 2t / $0.0036 / ✅ | **9** | **9,791** | **2,776** | **$0.0185** | ✅ 100% |
| **RW-05** | **`aice_with_idioms`** | 3t / $0.0047 / ✅ | 10t / $0.0168 / ✅ | 3t / $0.0058 / ✅ | **16** | **11,882** | **1,470** | **$0.0273** | ✅ 100% |
| **RW-06** | `without_aice` | 12t / $0.0242 / ✅ | 24t / $0.0620 / ❌ | — | **36** | **38,640** | **6,209** | **$0.0862** | ⚠️ Partial |
| **RW-06** | **`aice_no_idioms`** | 3t / $0.0086 / ✅ | 5t / $0.0103 / ✅ | 3t / $0.0056 / ✅ | **11** | **13,164** | **3,424** | **$0.0245** | ✅ 100% |
| **RW-06** | **`aice_with_idioms`** | 3t / $0.0072 / ✅ | 4t / $0.0064 / ✅ | 2t / $0.0035 / ✅ | **9** | **7,698** | **1,506** | **$0.0171** | ✅ 100% |
| **RW-07** | `without_aice` | 25t / $0.0490 / ✅ | 17t / $0.0400 / ❌ | — | **42** | **32,575** | **8,845** | **$0.0890** | ⚠️ Partial |
| **RW-07** | **`aice_no_idioms`** | 5t / $0.0119 / ✅ | 14t / $0.0269 / ✅ | 2t / $0.0042 / ✅ | **21** | **19,645** | **4,165** | **$0.0430** | ✅ 100% |
| **RW-07** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 4t / $0.0069 / ✅ | 3t / $0.0053 / ✅ | **10** | **8,434** | **1,408** | **$0.0192** | ✅ 100% |
| **RW-08** | `without_aice` | 11t / $0.0192 / ✅ | 23t / $0.0538 / ✅ | 11t / $0.0275 / ✅ | **45** | **29,943** | **6,136** | **$0.1005** | ✅ 100% |
| **RW-08** | **`aice_no_idioms`** | 3t / $0.0092 / ✅ | 3t / $0.0053 / ✅ | 3t / $0.0058 / ✅ | **9** | **13,261** | **3,592** | **$0.0203** | ✅ 100% |
| **RW-08** | **`aice_with_idioms`** | 3t / $0.0070 / ✅ | 3t / $0.0053 / ✅ | 3t / $0.0050 / ✅ | **9** | **7,726** | **1,466** | **$0.0173** | ✅ 100% |
| **RW-09** | `without_aice` | 22t / $0.0486 / ✅ | 6t / $0.0147 / ❌ | — | **28** | **34,059** | **10,265** | **$0.0633** | ⚠️ Partial |
| **RW-09** | **`aice_no_idioms`** | 3t / $0.0094 / ✅ | 3t / $0.0054 / ✅ | 3t / $0.0056 / ✅ | **9** | **14,221** | **4,065** | **$0.0204** | ✅ 100% |
| **RW-09** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 11t / $0.0196 / ✅ | 3t / $0.0053 / ✅ | **17** | **11,308** | **2,212** | **$0.0320** | ✅ 100% |
| **RW-10** | `without_aice` | 44t / $0.1127 / ✅ | 32t / $0.1144 / ❌ | — | **76** | **79,591** | **23,380** | **$0.2272** | ⚠️ Partial |
| **RW-10** | **`aice_no_idioms`** | 21t / $0.0498 / ✅ | 3t / $0.0072 / ✅ | 3t / $0.0076 / ✅ | **27** | **33,643** | **9,962** | **$0.0646** | ✅ 100% |
| **RW-10** | **`aice_with_idioms`** | 6t / $0.0155 / ✅ | 3t / $0.0064 / ✅ | 3t / $0.0067 / ✅ | **12** | **19,919** | **3,535** | **$0.0287** | ✅ 100% |
| **RW-11** | `without_aice` | 8t / $0.0131 / ✅ | 8t / $0.0128 / ✅ | 8t / $0.0145 / ✅ | **24** | **12,104** | **1,855** | **$0.0404** | ✅ 100% |
| **RW-11** | **`aice_no_idioms`** | 3t / $0.0065 / ✅ | 3t / $0.0049 / ✅ | 3t / $0.0043 / ✅ | **9** | **3,217** | **539** | **$0.0156** | ✅ 100% |
| **RW-11** | **`aice_with_idioms`** | 3t / $0.0065 / ✅ | 3t / $0.0050 / ✅ | 2t / $0.0027 / ✅ | **8** | **2,556** | **469** | **$0.0142** | ✅ 100% |

## 4. Ground-Truth Conversation ID Audit Trail (Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | Seed | Turns | Tool Calls | Working Tokens | LLM Output Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | API Cost (USD) | Duration | Verified & Decoys Intact |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AICE | `60e3eafa-fcbe-47ef-bbba-1dd001869587` | `74218651` | 30 | 34 | **28,193** | 7,634 | 161,476 | 1,169,778 | $0.0655 | 288.2s | ✅ |
| **RW-01** | AICE No Idioms | `60e9cd47-e97a-451e-aeee-9aefe7e859da` | `74218651` | 9 | 6 | **13,174** | 3,585 | 63,022 | 287,258 | $0.0195 | 106.8s | ✅ |
| **RW-01** | AICE With Idioms | `48dd24e2-0ad0-43f9-b2ed-66f31cf485bd` | `74218651` | 9 | 6 | **7,863** | 1,538 | 60,551 | 264,318 | $0.0174 | 81.4s | ✅ |
| **RW-02** | Without AICE | `9252cdd5-5c0c-4328-abb3-4456f50f5fa6` | `39949385` | 42 | 40 | **46,040** | 8,461 | 209,854 | 1,992,126 | $0.1021 | 470.4s | ❌ |
| **RW-02** | AICE No Idioms | `b658cd74-56ba-4c26-92fc-a4994b4c3734` | `39949385` | 9 | 6 | **10,452** | 2,862 | 63,207 | 279,259 | $0.0189 | 87.5s | ✅ |
| **RW-02** | AICE With Idioms | `a0210df6-747b-40d0-a879-b4d9fcda156c` | `39949385` | 10 | 7 | **7,174** | 1,340 | 63,266 | 291,436 | $0.0186 | 125.3s | ✅ |
| **RW-03** | Without AICE | `58e781aa-0625-46d2-8f16-785da39c3f1c` | `83725873` | 51 | 48 | **82,111** | 43,002 | 303,418 | 2,826,456 | $0.1595 | 950.7s | ✅ |
| **RW-03** | AICE No Idioms | `a97edce9-d94b-447a-a12b-5dcbfa8c9f3d` | `83725873` | 10 | 7 | **14,797** | 4,230 | 67,814 | 332,830 | $0.0220 | 200.9s | ✅ |
| **RW-03** | AICE With Idioms | `b016ffdc-9f22-4bb4-a683-46a7eace70dd` | `83725873` | 14 | 11 | **11,343** | 2,370 | 91,252 | 445,380 | $0.0280 | 239.1s | ✅ |
| **RW-04** | Without AICE | `ff3f8587-dfa2-4d4b-b2f6-d6da60721edd` | `41407941` | 45 | 45 | **56,595** | 22,985 | 234,272 | 1,756,810 | $0.1026 | 812.5s | ❌ |
| **RW-04** | AICE No Idioms | `83f201c5-cb0e-4f3c-8b6f-6d3a04969c1b` | `41407941` | 15 | 12 | **18,192** | 4,756 | 85,922 | 526,048 | $0.0315 | 164.7s | ✅ |
| **RW-04** | AICE With Idioms | `209eb919-81fe-41f4-b01a-17d8e85cd2c4` | `41407941` | 14 | 11 | **14,366** | 1,997 | 77,826 | 469,020 | $0.0272 | 134.9s | ✅ |
| **RW-05** | Without AICE | `38efa118-57b5-493c-83d3-bd549a513590` | `63784452` | 44 | 49 | **43,043** | 9,886 | 196,871 | 2,189,072 | $0.1087 | 735.4s | ✅ |
| **RW-05** | AICE No Idioms | `6a55142b-75d3-46f0-aa66-26af1bd88a43` | `63784452` | 9 | 6 | **9,791** | 2,776 | 63,063 | 270,932 | $0.0185 | 126.4s | ✅ |
| **RW-05** | AICE With Idioms | `0b679e37-6204-4b81-b767-1ba0f145f139` | `63784452` | 16 | 13 | **11,882** | 1,470 | 65,876 | 513,905 | $0.0273 | 209.0s | ✅ |
| **RW-06** | Without AICE | `0bf28cc6-12b4-4e60-9832-b141ca1c5c7a` | `65951738` | 36 | 37 | **38,640** | 6,209 | 230,695 | 1,532,069 | $0.0862 | 659.7s | ❌ |
| **RW-06** | AICE No Idioms | `9b639b14-e3bf-4658-8a97-0a20ea40b338` | `65951738` | 11 | 8 | **13,164** | 3,424 | 86,697 | 351,341 | $0.0245 | 182.5s | ✅ |
| **RW-06** | AICE With Idioms | `4b8824f2-8029-419a-8673-19ab69e41475` | `65951738` | 9 | 6 | **7,698** | 1,506 | 57,245 | 265,091 | $0.0171 | 163.2s | ✅ |
| **RW-07** | Without AICE | `4df26b10-f5fc-434b-a77b-97b6ad453e4e` | `60336606` | 42 | 40 | **32,575** | 8,845 | 203,153 | 1,657,906 | $0.0890 | 400.5s | ❌ |
| **RW-07** | AICE No Idioms | `39b2f496-12de-4271-92a2-5e8a1f500439` | `60336606` | 21 | 18 | **19,645** | 4,165 | 118,091 | 741,085 | $0.0430 | 173.8s | ✅ |
| **RW-07** | AICE With Idioms | `50978efb-1627-41cb-8f81-301195d4e6e2` | `60336606` | 10 | 7 | **8,434** | 1,408 | 66,967 | 295,154 | $0.0192 | 142.8s | ✅ |
| **RW-08** | Without AICE | `9e6b28e7-e774-4219-a4af-f2a9955f99fd` | `55134763` | 45 | 41 | **29,943** | 6,136 | 255,340 | 1,840,018 | $0.1005 | 880.9s | ✅ |
| **RW-08** | AICE No Idioms | `c995de94-0acf-49b0-83b7-de4e01b98a30` | `55134763` | 9 | 6 | **13,261** | 3,592 | 68,679 | 292,936 | $0.0203 | 142.0s | ✅ |
| **RW-08** | AICE With Idioms | `2d301907-9d3a-41fd-80ce-19e51dea4a8d` | `41695622` | 9 | 6 | **7,726** | 1,466 | 59,107 | 266,963 | $0.0173 | 112.7s | ✅ |
| **RW-09** | Without AICE | `28ae59bb-ea97-4a97-99ab-ebeb2db596c0` | `35691899` | 28 | 26 | **34,059** | 10,265 | 152,965 | 1,105,539 | $0.0633 | 353.9s | ❌ |
| **RW-09** | AICE No Idioms | `33231f69-178a-4599-8f81-b13500c82b2e` | `35691899` | 9 | 6 | **14,221** | 4,065 | 64,735 | 301,255 | $0.0204 | 154.8s | ✅ |
| **RW-09** | AICE With Idioms | `c65104f5-7a5a-4122-b872-ea315e7a4da3` | `35691899` | 17 | 14 | **11,308** | 2,212 | 93,612 | 545,609 | $0.0320 | 267.0s | ✅ |
| **RW-10** | Without AICE | `b951c01d-f6d6-41e9-967d-a792d315f330` | `34777329` | 76 | 75 | **79,591** | 23,380 | 355,091 | 4,712,020 | $0.2272 | 1213.8s | ❌ |
| **RW-10** | AICE No Idioms | `55206026-d1d2-480e-9fd6-b31d995e029f` | `34777329` | 27 | 24 | **33,643** | 9,962 | 143,926 | 1,170,451 | $0.0646 | 630.5s | ✅ |
| **RW-10** | AICE With Idioms | `73e7cd07-d610-4756-9685-63a87d1ed49c` | `34777329` | 12 | 9 | **19,919** | 3,535 | 84,557 | 467,985 | $0.0287 | 131.6s | ✅ |
| **RW-11** | Without AICE | `6760981c-d470-45ed-8b46-1db712bdc364` | `67646133` | 24 | 21 | **12,104** | 1,855 | 115,534 | 709,043 | $0.0404 | 221.5s | ✅ |
| **RW-11** | AICE No Idioms | `1fef7524-101e-4424-9fbd-6d7978dbfea0` | `67646133` | 9 | 6 | **3,217** | 539 | 58,675 | 233,791 | $0.0156 | 77.0s | ✅ |
| **RW-11** | AICE With Idioms | `b5a99393-88f9-4903-925c-f0ef0753deab` | `67646133` | 8 | 5 | **2,556** | 469 | 55,593 | 206,299 | $0.0142 | 119.3s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

| ID | Scenario | Offline Token Savings (Pure AICE / +Idioms) | Real Agent Working Token Savings (Pure AICE / +Idioms) | Real Agent API Cost Savings (Pure AICE / +Idioms) | Real Agent Turn Savings (Pure AICE / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -44.8% / **-74.1%** | -53.3% / **-72.1%** | -70.3% / **-73.4%** | -70.0% / **-70.0%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -37.0% / **-69.0%** | -77.3% / **-84.4%** | -81.5% / **-81.7%** | -78.6% / **-76.2%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -43.3% / **-72.2%** | -82.0% / **-86.2%** | -86.2% / **-82.4%** | -80.4% / **-72.5%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -40.1% / **-70.4%** | -67.9% / **-74.6%** | -69.3% / **-73.4%** | -66.7% / **-68.9%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -42.3% / **-70.8%** | -77.3% / **-72.4%** | -83.0% / **-74.8%** | -79.5% / **-63.6%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -43.5% / **-72.7%** | -65.9% / **-80.1%** | -71.6% / **-80.2%** | -69.4% / **-75.0%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -38.7% / **-70.1%** | -39.7% / **-74.1%** | -51.7% / **-78.4%** | -50.0% / **-76.2%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -39.5% / **-70.4%** | -55.7% / **-74.2%** | -79.8% / **-82.8%** | -80.0% / **-80.0%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -41.6% / **-71.4%** | -58.3% / **-66.8%** | -67.8% / **-49.5%** | -67.9% / **-39.3%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -42.7% / **-72.0%** | -57.7% / **-75.0%** | -71.6% / **-87.4%** | -64.5% / **-84.2%** |

## 6. Architectural Analysis: Why AICE Wins Even on Unfair, Cold-Start, 0-Idiom & Decoy-Minefield Workspaces

### A. Adversarial Hostile-to-AICE Design (Zero Coaching, Zero Pre-Baked Idioms, Zero Positional Shortcuts)
- **Cold-Start Idiom Discovery Paid In-Session**: `setupWorkspace` writes zero `aice.config.json` files. The `aice_with_idioms` agent must discover and persist `aice.config.json` during its live session via `aice context . -s "*" --idioms` (or `aice idioms scan --save`), paying the full cold-start AST mining cost and still beating `Without AICE` in the suite aggregate (10/10 strict all-metric scenario wins).
- **Non-First Seeded Targets + Decoy Sentinels**: Target declarations are procedurally selected at non-first indices (`targetIdx >= 1`) and identified only by their domain parameters/attributes, while every code file contains a seeded `verifyDecoySentinel_<hex>` function and `DECOY_SENTINEL_<hex>` comment that fail verification if altered.
- **Hostile 1-File, 0-Idiom "Lone Needle" (`RW-11`)**: Even when stripped of multi-file batching (1 file) and repeating idioms (`0` idioms discovered), AICE (`aice_with_idioms`) beats `Without AICE` across turns (`-66.7%`), tool calls (`-76.2%`), working payload tokens (`-78.9%`), LLM output tokens (`-74.7%`), and real API cost.

### B. Why AICE On-the-Fly WITH Idioms (`aice_with_idioms`) Wins 10/10 Multi-File Scenarios & Suite Aggregate
1. **Cold-Start AST Mining + Compact Context Pack (`aice context . -s "*" --idioms` / `aice idioms scan --save`)**: In 1 turn, AICE mines repetitive AST patterns across all 15 languages, lists every file's symbol headers (`// symbols:`), and collapses repeating AST blocks into 1-line `$idiom(...)` calls (`-77.1%` working payload tokens and `-87.2%` LLM output tokens).
2. **O(1) AST-Safe Pattern Refactoring (`aice splice --idioms --batch` / `--stdin`)**: Updating the mined `$guard`, `$tsx_kpi_tile`, `$css_card`, `$html_metric_row`, `$twig_summary_line`, `$rec_id`, and `$rec_worker` templates re-emits all matching AST call sites across the workspace while leaving `verifyDecoySentinel_*` functions 100% untouched (`-78.9%` real API dollar cost and `-81.6%` total context tokens).

### C. Why Pure AICE WITHOUT Idioms (`aice_no_idioms`) Wins 10/10 — and Why Idioms Cut Output Tokens Further
- **Where Pure AICE Wins (`10/10` scenarios, 100% verified across all 10 multi-file scenarios)**: Even without `$idiom` macros, `aice context` and `aice splice` beat `Without AICE` in the suite aggregate across **LLM Turns (`439 -> 129`, `-70.6%`)**, **Working Payload Tokens (`470,790 -> 160,340`, `-65.9%`)**, **LLM Output Tokens (`146,803 -> 43,417`, `-70.4%`)**, **Real API Dollar Cost (`$1.1045 -> $0.2831`, `-74.4%`)**, and **Total API Context Tokens (`20,781,794 -> 4,553,395`, `-78.1%`)**.
- **Granularity Advantage of Cold-Start Idioms (`aice_no_idioms` vs `aice_with_idioms`)**: Without idioms, refactoring 15–20 declarations requires splicing each symbol's compact AICE body (`43,417` output tokens). Discovering idioms on the fly collapses those repetitive bodies into O(1) template updates, changing LLM output tokens by **`-56.6%`** (`43,417 -> 18,842`) and working payload tokens by **`-32.8%`** (`160,340 -> 107,713`).
