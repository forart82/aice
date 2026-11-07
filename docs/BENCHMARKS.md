# AICE 2.0 — Real AI Agent Benchmark Suite Report (Adversarial Cold-Start Scenarios — Without & With Idioms)

> **Ground-Truth Adversarial Real AI Agent Proof**: Every number in this report comes from **real autonomous AI agent (`agy -p`) executions** running against **cold-start, procedurally seeded, decoy-minefielded workspaces** on disk under **blind issue prompts** (zero symbol name leakage, zero positional `@first` shortcuts, zero pre-baked `aice.config.json`) and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: 4 Bulletproof Metrics (Real AI Agents vs Deterministic Offline Suite)

| Metric (Across All 10 Multi-File Scenarios `RW-01` .. `RW-10`) | Without AICE (Native Tools) | AICE Without Idioms (Pure AICE) | AICE With Idioms (Cold-Start `$idiom` Scan + Splice) | AICE Win Rate |
| :--- | :---: | :---: | :---: | :---: |
| **1. Real Agent LLM Output Tokens** (`output_tokens`, 4x API cost weight) | 65,433 | **39,034 (-40.4%)** | **11,402 (-82.6%)** | **10/10 (100%)** |
| **2. Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 196,142 | **79,848 (-59.3%)** | **44,185 (-77.5%)** | **10/10 (100%)** |
| **3. Real API Dollar Cost (USD)** (`$0.15/1M in, $0.0375/1M cache, $0.60/1M out`) | $0.3575 | **$0.1216 (-66.0%)** | **$0.0673 (-81.2%)** | **10/10 (100%)** |
| **4. Real Agent Total API Context Tokens** (`input + cache + output`) | 6,222,636 | **1,916,465 (-69.2%)** | **1,078,095 (-82.7%)** | **10/10 (100%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 842,097 | **286,272 (-66.0%)** | **193,097 (-77.1%)** | **10/10 (100%)** |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 181 turns | **57 turns (-68.5%)** | **39 turns (-78.5%)** | **10/10 (100%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 184 calls | **47 calls (-74.5%)** | **29 calls (-84.2%)** | **10/10 (100%)** |
| **Real Agent Wall-Clock Duration** | 666.2s | **302.0s** | **187.3s** | **10/10 (100%)** |
| **Offline Deterministic Suite Tokens** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 127,021 | **71,877 (-43.4%)** | **34,042 (-73.2%)** | **10/10 (100%)** |
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
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 16 / **4** (-75%) / **3** (-81%) | 13,270 / **5,796** (-56.3%) / **3,490** (-73.7%) | 4,216 / **2,998** (-28.9%) / **904** (-78.6%) | $0.0268 / **$0.0075** (-72.0%) / **$0.0050** (-81.5%) | 459,272 / **102,248** (-77.7%) / **73,246** (-84.0%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 15 / **4** (-73%) / **4** (-73%) | 12,236 / **5,263** (-57.0%) / **3,595** (-70.6%) | 3,379 / **2,585** (-23.5%) / **845** (-75.0%) | $0.0290 / **$0.0071** (-75.4%) / **$0.0061** (-78.9%) | 475,790 / **101,001** (-78.8%) / **96,299** (-79.8%) | ✅ 100% |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 20 / **3** (-85%) / **3** (-85%) | 16,782 / **5,736** (-65.8%) / **3,584** (-78.6%) | 4,886 / **3,464** (-29.1%) / **1,120** (-77.1%) | $0.0354 / **$0.0064** (-82.1%) / **$0.0048** (-86.4%) | 609,263 / **80,908** (-86.7%) / **74,687** (-87.7%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 20 / **4** (-80%) / **3** (-85%) | 17,086 / **6,918** (-59.5%) / **3,636** (-78.7%) | 5,337 / **4,196** (-21.4%) / **1,142** (-78.6%) | $0.0353 / **$0.0081** (-77.0%) / **$0.0048** (-86.4%) | 603,769 / **105,837** (-82.5%) / **74,521** (-87.7%) | ✅ 100% |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 9 / **3** (-67%) / **3** (-67%) | 12,927 / **4,756** (-63.2%) / **3,069** (-76.3%) | 3,938 / **2,534** (-35.6%) / **738** (-81.3%) | $0.0164 / **$0.0058** (-64.9%) / **$0.0047** (-71.3%) | 259,271 / **76,634** (-70.4%) / **71,873** (-72.3%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 15 / **3** (-80%) / **3** (-80%) | 12,602 / **5,200** (-58.7%) / **3,433** (-72.8%) | 4,013 / **2,778** (-30.8%) / **862** (-78.5%) | $0.0247 / **$0.0060** (-75.7%) / **$0.0048** (-80.4%) | 421,282 / **77,529** (-81.6%) / **72,534** (-82.8%) | ✅ 100% |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 18 / **3** (-83%) / **3** (-83%) | 20,469 / **5,508** (-73.1%) / **3,252** (-84.1%) | 7,689 / **3,194** (-58.5%) / **805** (-89.5%) | $0.0337 / **$0.0063** (-81.3%) / **$0.0048** (-85.8%) | 574,518 / **78,263** (-86.4%) / **72,233** (-87.4%) | ✅ 100% |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 13 / **3** (-77%) / **3** (-77%) | 14,515 / **5,582** (-61.5%) / **3,483** (-76.0%) | 4,348 / **3,325** (-23.5%) / **1,061** (-75.6%) | $0.0239 / **$0.0066** (-72.2%) / **$0.0052** (-78.3%) | 396,330 / **80,093** (-79.8%) / **74,097** (-81.3%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 12 / **3** (-75%) / **3** (-75%) | 16,424 / **6,078** (-63.0%) / **3,456** (-79.0%) | 5,533 / **3,840** (-30.6%) / **1,025** (-81.5%) | $0.0237 / **$0.0068** (-71.4%) / **$0.0048** (-79.7%) | 379,342 / **82,542** (-78.2%) / **74,840** (-80.3%) | ✅ 100% |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 43 / **27** (-37%) / **11** (-74%) | 59,831 / **29,011** (-51.5%) / **13,187** (-78.0%) | 22,094 / **10,120** (-54.2%) / **2,900** (-86.9%) | $0.1087 / **$0.0611** (-43.8%) / **$0.0223** (-79.5%) | 2,043,799 / **1,131,410** (-44.6%) / **393,765** (-80.7%) | ✅ 100% |
| **TOTAL (`RW-01..10`)** | **All 10 Multi-File Scenarios (15/15 Languages)** | **181** / **57** (-68.5%) / **39** (-78.5%) | **196,142** / **79,848** (-59.3%) / **44,185** (-77.5%) | **65,433** / **39,034** (-40.4%) / **11,402** (-82.6%) | **$0.3575** / **$0.1216** (-66.0%) / **$0.0673** (-81.2%) | **6,222,636** / **1,916,465** (-69.2%) / **1,078,095** (-82.7%) | ✅ **30/30** |
| **RW-11 (Hostile 0-Idiom)** | **Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)**<br/>`ts` (1 file, **0 idioms**) | 5 / **3** (-40%) / **3** (-40%) | 2,028 / **1,183** (-41.7%) / **1,133** (-44.1%) | 499 / **256** (-48.7%) / **240** (-51.9%) | $0.0066 / **$0.0042** (-36.6%) / **$0.0042** (-36.8%) | 112,930 / **66,956** (-40.7%) / **66,940** (-40.7%) | ✅ 100% |

## 4. Ground-Truth Conversation ID Audit Trail (Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | Seed | Turns | Tool Calls | Working Tokens | LLM Output Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | API Cost (USD) | Duration | Verified & Decoys Intact |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AICE | `65d545da-ffdb-4435-bbc4-5d91b822dfd5` | `69295299` | 16 | 15 | **13,270** | 4,216 | 68,424 | 459,272 | $0.0268 | 37.5s | ✅ |
| **RW-01** | AICE No Idioms | `70d632fc-a99b-4957-a37b-bd56363740fd` | `69295299` | 4 | 3 | **5,796** | 2,998 | 20,696 | 102,248 | $0.0075 | 19.4s | ✅ |
| **RW-01** | AICE With Idioms | `e66c07d0-d3aa-430a-9048-74ec9445c7f2` | `69295299` | 3 | 2 | **3,490** | 904 | 16,155 | 73,246 | $0.0050 | 12.4s | ✅ |
| **RW-02** | Without AICE | `780e6031-9c76-4cb1-81f9-72cc25e01e9f` | `69295299` | 15 | 14 | **12,236** | 3,379 | 85,745 | 475,790 | $0.0290 | 82.4s | ✅ |
| **RW-02** | AICE No Idioms | `b5aab4a0-3d78-4779-8795-cb28488b39c4` | `69295299` | 4 | 3 | **5,263** | 2,585 | 19,451 | 101,001 | $0.0071 | 18.3s | ✅ |
| **RW-02** | AICE With Idioms | `6a67f806-12bf-420d-9a78-32a520cc1acf` | `69295299` | 4 | 3 | **3,595** | 845 | 18,838 | 96,299 | $0.0061 | 15.4s | ✅ |
| **RW-03** | Without AICE | `f1a58af8-d4aa-463a-9391-47d2f42838e5` | `69295299` | 20 | 19 | **16,782** | 4,886 | 92,367 | 609,263 | $0.0354 | 52.2s | ✅ |
| **RW-03** | AICE No Idioms | `91db7ba1-5718-49f7-a30a-74d2bdc8790f` | `69295299` | 3 | 2 | **5,736** | 3,464 | 15,642 | 80,908 | $0.0064 | 16.5s | ✅ |
| **RW-03** | AICE With Idioms | `78f413a8-1562-4abc-9bc2-716855f8b257` | `69295299` | 3 | 2 | **3,584** | 1,120 | 13,513 | 74,687 | $0.0048 | 18.0s | ✅ |
| **RW-04** | Without AICE | `cd7a0983-62db-4c06-bb92-01fe6dd41b80` | `69295299` | 20 | 19 | **17,086** | 5,337 | 90,973 | 603,769 | $0.0353 | 48.9s | ✅ |
| **RW-04** | AICE No Idioms | `59d53592-9e13-48c9-81f9-4440bdf0bb5a` | `69295299` | 4 | 3 | **6,918** | 4,196 | 20,197 | 105,837 | $0.0081 | 20.4s | ✅ |
| **RW-04** | AICE With Idioms | `88b23aff-a5aa-4fa1-b5f8-3a95101ec22e` | `69295299` | 3 | 2 | **3,636** | 1,142 | 13,347 | 74,521 | $0.0048 | 13.3s | ✅ |
| **RW-05** | Without AICE | `192b1b9e-7a1c-4349-89ad-be3164c44806` | `69295299` | 9 | 12 | **12,927** | 3,938 | 43,366 | 259,271 | $0.0164 | 34.0s | ✅ |
| **RW-05** | AICE No Idioms | `6e4d304a-2c0c-4a01-9c24-a1515fedb43f` | `69295299` | 3 | 2 | **4,756** | 2,534 | 15,458 | 76,634 | $0.0058 | 15.8s | ✅ |
| **RW-05** | AICE With Idioms | `fc4ecd2b-598f-43e9-9729-d9be46d96b63` | `69295299` | 3 | 2 | **3,069** | 738 | 14,786 | 71,873 | $0.0047 | 14.0s | ✅ |
| **RW-06** | Without AICE | `76d421f2-65d2-4bf0-befc-0bfd637c06d6` | `69295299` | 15 | 14 | **12,602** | 4,013 | 62,992 | 421,282 | $0.0247 | 56.0s | ✅ |
| **RW-06** | AICE No Idioms | `4dc04164-761a-493f-bf59-8cf9e57304f6` | `69295299` | 3 | 2 | **5,200** | 2,778 | 16,350 | 77,529 | $0.0060 | 18.7s | ✅ |
| **RW-06** | AICE With Idioms | `b594cbee-18fd-430b-853b-472422b085cb` | `69295299` | 3 | 2 | **3,433** | 862 | 15,445 | 72,534 | $0.0048 | 17.0s | ✅ |
| **RW-07** | Without AICE | `3e48d206-79a6-49ab-9926-9589f1b3caea` | `69295299` | 18 | 17 | **20,469** | 7,689 | 77,683 | 574,518 | $0.0337 | 70.6s | ✅ |
| **RW-07** | AICE No Idioms | `041b6523-8587-495b-bef3-912853f7764e` | `69295299` | 3 | 2 | **5,508** | 3,194 | 17,084 | 78,263 | $0.0063 | 18.0s | ✅ |
| **RW-07** | AICE With Idioms | `a31d5464-1ee7-460d-9188-0bd0ee7740d5` | `69295299` | 3 | 2 | **3,252** | 805 | 15,145 | 72,233 | $0.0048 | 13.0s | ✅ |
| **RW-08** | Without AICE | `93c25116-1a84-4730-842e-ec0ac577aa9f` | `69295299` | 13 | 17 | **14,515** | 4,348 | 62,581 | 396,330 | $0.0239 | 50.0s | ✅ |
| **RW-08** | AICE No Idioms | `4d80f859-b8ab-4d7c-a062-cf53724183c0` | `69295299` | 3 | 2 | **5,582** | 3,325 | 18,908 | 80,093 | $0.0066 | 19.4s | ✅ |
| **RW-08** | AICE With Idioms | `3630fc66-e6e3-4499-b49d-edcb14577ab7` | `69295299` | 3 | 2 | **3,483** | 1,061 | 17,004 | 74,097 | $0.0052 | 15.1s | ✅ |
| **RW-09** | Without AICE | `b4bbd693-a406-455d-bf37-086814382599` | `69295299` | 12 | 15 | **16,424** | 5,533 | 61,679 | 379,342 | $0.0237 | 51.3s | ✅ |
| **RW-09** | AICE No Idioms | `6cda441e-6334-4d88-9046-084408dd75a5` | `69295299` | 3 | 2 | **6,078** | 3,840 | 17,272 | 82,542 | $0.0068 | 20.8s | ✅ |
| **RW-09** | AICE With Idioms | `1a71812d-7206-4719-ba65-75e51551c2e2` | `69295299` | 3 | 2 | **3,456** | 1,025 | 13,666 | 74,840 | $0.0048 | 16.3s | ✅ |
| **RW-10** | Without AICE | `5b4512ec-3a1c-442f-9454-bf8d7e4a073d` | `69295299` | 43 | 42 | **59,831** | 22,094 | 196,287 | 2,043,799 | $0.1087 | 183.3s | ✅ |
| **RW-10** | AICE No Idioms | `a856f56f-1499-45f8-b65e-4390ff2bfe6e` | `69295299` | 27 | 26 | **29,011** | 10,120 | 125,214 | 1,131,410 | $0.0611 | 134.7s | ✅ |
| **RW-10** | AICE With Idioms | `78dcaead-37bc-4d85-b398-e8864cccef06` | `69295299` | 11 | 10 | **13,187** | 2,900 | 55,198 | 393,765 | $0.0223 | 52.7s | ✅ |
| **RW-11** | Without AICE | `3107d3d4-1ec8-441a-bf0b-b4fafe5dacaf` | `69295299` | 5 | 4 | **2,028** | 499 | 19,212 | 112,930 | $0.0066 | 18.4s | ✅ |
| **RW-11** | AICE No Idioms | `eaa3ea68-569a-42bd-9c89-a578dfcd246a` | `69295299` | 3 | 2 | **1,183** | 256 | 13,964 | 66,956 | $0.0042 | 14.9s | ✅ |
| **RW-11** | AICE With Idioms | `0fbb33f4-f2c4-4bab-9031-6d1a9f4911f9` | `69295299` | 3 | 2 | **1,133** | 240 | 13,948 | 66,940 | $0.0042 | 16.8s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

| ID | Scenario | Offline Token Savings (Pure AICE / +Idioms) | Real Agent Working Token Savings (Pure AICE / +Idioms) | Real Agent API Cost Savings (Pure AICE / +Idioms) | Real Agent Turn Savings (Pure AICE / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -46.1% / **-75.4%** | -56.3% / **-73.7%** | -72.0% / **-81.5%** | -75.0% / **-81.3%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -39.0% / **-71.0%** | -57.0% / **-70.6%** | -75.4% / **-78.9%** | -73.3% / **-73.3%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -44.7% / **-73.5%** | -65.8% / **-78.6%** | -82.1% / **-86.4%** | -85.0% / **-85.0%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -41.5% / **-71.8%** | -59.5% / **-78.7%** | -77.0% / **-86.4%** | -80.0% / **-85.0%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -45.7% / **-74.2%** | -63.2% / **-76.3%** | -64.9% / **-71.3%** | -66.7% / **-66.7%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -44.7% / **-73.9%** | -58.7% / **-72.8%** | -75.7% / **-80.4%** | -80.0% / **-80.0%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -39.9% / **-71.3%** | -73.1% / **-84.1%** | -81.3% / **-85.8%** | -83.3% / **-83.3%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -41.4% / **-72.3%** | -61.5% / **-76.0%** | -72.2% / **-78.3%** | -76.9% / **-76.9%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -43.6% / **-73.5%** | -63.0% / **-79.0%** | -71.4% / **-79.7%** | -75.0% / **-75.0%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -44.1% / **-73.5%** | -51.5% / **-78.0%** | -43.8% / **-79.5%** | -37.2% / **-74.4%** |

## 6. Architectural Analysis: Why AICE Wins Even on Unfair, Cold-Start, 0-Idiom & Decoy-Minefield Workspaces

### A. Adversarial Hostile-to-AICE Design (Zero Coaching, Zero Pre-Baked Idioms, Zero Positional Shortcuts)
- **Cold-Start Idiom Discovery Paid In-Session**: `setupWorkspace` writes zero `aice.config.json` files. The `aice_with_idioms` agent must discover and persist `aice.config.json` during its live session via `aice context . -s "*" --idioms` (or `aice idioms scan --save`), paying the full cold-start AST mining cost and still beating both `Without AICE` and `AICE Without Idioms` across all 10 multi-file scenarios.
- **Non-First Seeded Targets + Decoy Sentinels**: Target declarations are procedurally selected at non-first indices (`targetIdx >= 1`) and identified only by their domain parameters/attributes, while every code file contains a seeded `verifyDecoySentinel_<hex>` function and `DECOY_SENTINEL_<hex>` comment that fail verification if altered.
- **Hostile 1-File, 0-Idiom "Lone Needle" (`RW-11`)**: Even when stripped of multi-file batching (1 file) and repeating idioms (`0` idioms discovered), AICE (`aice_no_idioms` and `aice_with_idioms`) still beats `Without AICE` across turns (`-40.0%`), tool calls (`-50.0%`), working payload tokens (`-41.7%`), LLM output tokens (`-48.7%`), and real API cost.

### B. Why AICE On-the-Fly WITH Idioms (`aice_with_idioms`) Wins 10/10 Multi-File Scenarios Across All 4 Bulletproof Metrics
1. **Cold-Start AST Mining + Compact Context Pack (`aice context . -s "*" --idioms` / `aice idioms scan --save`)**: In 1 turn, AICE mines repetitive AST patterns across all 15 languages, lists every file's symbol headers (`// symbols:`), and collapses repeating AST blocks into 1-line `$idiom(...)` calls (`-77.5%` working payload tokens and `-82.6%` LLM output tokens).
2. **O(1) AST-Safe Pattern Refactoring (`aice splice --idioms --batch`)**: Updating the mined `$guard`, `$tsx_kpi_tile`, `$css_card`, `$html_metric_row`, `$twig_summary_line`, `$rec_id`, and `$rec_worker` templates re-emits all matching AST call sites across the workspace while leaving `verifyDecoySentinel_*` functions 100% untouched (`-81.2%` real API dollar cost and `-82.7%` total context tokens).

### C. Why Pure AICE WITHOUT Idioms (`aice_no_idioms`) Wins 10/10 — and Why Idioms Cut Output Tokens by Another 60%+
- **Where Pure AICE Wins (`10/10` scenarios + `RW-11` Lone Needle)**: Even without `$idiom` macros, `aice context . -s "*" --no-idioms` and `aice splice --no-idioms --batch` beat `Without AICE` across **LLM Turns (`181 -> 57`, `-68.5%`)**, **Working Payload Tokens (`196,142 -> 79,848`, `-59.3%`)**, **LLM Output Tokens (`65,433 -> 39,034`, `-40.4%`)**, **Real API Dollar Cost (`$0.3575 -> $0.1216`, `-66.0%`)**, and **Total API Context Tokens (`6,222,636 -> 1,916,465`, `-69.2%`)**.
- **Granularity Advantage of Cold-Start Idioms (`aice_no_idioms` vs `aice_with_idioms`)**: Without idioms, refactoring 15–20 declarations requires splicing each symbol's compact AICE body in the batch JSON payload (`39,034` output tokens). Discovering idioms on the fly collapses those repetitive bodies into O(1) template updates, cutting LLM output tokens by an additional **`-70.8%`** (`39,034 -> 11,402`) and working payload tokens by **`-44.7%`** (`79,848 -> 44,185`).
