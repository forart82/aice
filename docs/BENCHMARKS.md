# AICE 2.0 — Real AI Agent Benchmark Suite Report (10 Scenarios — Without & With Idioms)

> **Ground-Truth Real AI Agent Proof**: Every number in this report comes from **30 real autonomous AI agent (`agy -p`) executions** (`10 scenarios × 3 modes`) running against isolated temporary workspaces on disk and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: Real AI Agents vs Deterministic Offline Suite

| Metric (Across All 10 Scenarios `RW-01` .. `RW-10`) | Without AICE (Native Tools) | AICE Without Idioms (Pure AICE) | AICE With Idioms (`$idiom` AST Macros) | AICE Win Rate |
| :--- | :---: | :---: | :---: | :---: |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 189 turns | **35 turns (-81.5%)** | **32 turns (-83.1%)** | **10/10 (100%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 204 calls | **25 calls (-87.8%)** | **22 calls (-89.2%)** | **10/10 (100%)** |
| **Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 207,372 | **64,380 (-69.0%)** | **33,839 (-83.7%)** | **10/10 (100%)** |
| **Real Agent LLM Output Tokens** (`output_tokens`) | 68,108 | **37,100 (-45.5%)** | **11,680 (-82.8%)** | **10/10 (100%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 895,923 | **227,015 (-74.7%)** | **150,257 (-83.2%)** | **10/10 (100%)** |
| **Real Agent Total API Context Tokens** (`input + cache + output`) | 6,587,895 | **969,363 (-85.3%)** | **782,293 (-88.1%)** | **10/10 (100%)** |
| **Real Agent Wall-Clock Duration** | 683.2s | **226.7s** | **195.3s** | **10/10 (100%)** |
| **Offline Deterministic Suite Tokens** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 127,021 | **71,877 (-43.4%)** | **34,042 (-73.2%)** | **10/10 (100%)** |
| **Offline Deterministic Suite Turns** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 502 turns | **206 turns (-59.0%)** | **154 turns (-69.3%)** | **10/10 (100%)** |

## 2. Methodology & How Real Agent Telemetry Is Measured

For each of the 10 real-world scenarios (`RW-01` .. `RW-10`), 3 independent `agy` agent sessions were spawned in isolated temporary directories containing the native source files:
1. **Without AICE (`without_aice`)**: The agent uses standard native IDE tools (`grep_search`, `view_file`, `replace_file_content`) to locate symbols, read files, update target symbols, delete obsolete symbols, and apply the multi-file pattern refactor across the workspace.
2. **AICE Without Idioms (`aice_no_idioms`)**: The agent uses AICE On-the-Fly CLI in pure AICE mode (`aice context . -s "..." --no-idioms` and `aice splice --no-idioms --batch '[...]'`).
3. **AICE With Idioms (`aice_with_idioms`)**: The agent uses AICE On-the-Fly CLI with project `$idiom` macros (`aice context . -s "..." --idioms`, `aice splice --idioms --batch '[...]'`, and `aice idioms update --batch '[...]'`).

After each agent finishes, its ground-truth transcript at `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` is parsed and the workspace on disk is verified:
- **LLM Turns (`llmTurns`)**: Exact count of `PLANNER_RESPONSE` entries in `transcript.jsonl`.
- **Tool Calls (`toolCalls`)**: Exact count of `tool_calls` invoked across all `PLANNER_RESPONSE` turns.
- **Working Payload Tokens (`workingTokens`)**: `toolCallTokens + toolResultTokens + outputTokens` (measured with `o200k_base` on tool arguments/outputs plus exact `PLANNER_RESPONSE.output_tokens`), isolating the actual code/context/edit payload from the static IDE system prompt.
- **Billable API Tokens (`billableTokens`)**: Exact sum of `input_tokens + output_tokens` reported by the LLM API across all turns.
- **Total API Context Tokens (`apiTotalTokens`)**: Exact sum of `input_tokens + cache_read_tokens + output_tokens` across all turns (invariant to server-side prompt cache warmth).
- **On-Disk Verification (`verifiedOnDisk` & `zeroAiceFilesLeftOnDisk`)**: Confirms every target symbol update, obsolete symbol deletion, and multi-file pattern refactor is present in the native files on disk, with `0` `.aice` files left behind.

## 3. All 10 Real-World Scenarios — Real AI Agent Results

| ID | Scenario & Languages | Turns (No AICE / Pure AICE / +Idioms) | Tool Calls (No AICE / Pure AICE / +Idioms) | Working Tokens (No AICE / Pure AICE / +Idioms) | LLM Output Tokens (No AICE / Pure AICE / +Idioms) | Total API Context Tokens (No AICE / Pure AICE / +Idioms) | Verified |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 13 / **3** (-77%) / **3** (-77%) | 16 / **2** (-88%) / **2** (-88%) | 18,827 / **5,294** (-71.9%) / **2,835** (-84.9%) | 5,853 / **2,867** (-51.0%) / **945** (-83.8%) | 414,985 / **77,797** (-81.3%) / **70,214** (-83.1%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 9 / **3** (-67%) / **3** (-67%) | 14 / **2** (-86%) / **2** (-86%) | 12,028 / **4,705** (-60.9%) / **2,432** (-79.8%) | 3,288 / **2,542** (-22.7%) / **826** (-74.9%) | 249,685 / **76,316** (-69.4%) / **69,500** (-72.2%) | ✅ 100% |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 18 / **3** (-83%) / **3** (-83%) | 23 / **2** (-91%) / **2** (-91%) | 17,222 / **5,710** (-66.8%) / **3,274** (-81.0%) | 4,909 / **3,433** (-30.1%) / **1,190** (-75.8%) | 579,533 / **80,162** (-86.2%) / **71,908** (-87.6%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 23 / **3** (-87%) / **3** (-87%) | 22 / **2** (-91%) / **2** (-91%) | 23,311 / **6,369** (-72.7%) / **3,138** (-86.5%) | 8,375 / **4,047** (-51.7%) / **1,139** (-86.4%) | 734,104 / **80,983** (-89.0%) / **71,525** (-90.3%) | ✅ 100% |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 20 / **3** (-85%) / **3** (-85%) | 19 / **2** (-89%) / **2** (-89%) | 21,422 / **4,662** (-78.2%) / **2,388** (-88.8%) | 6,512 / **2,481** (-61.9%) / **780** (-88.0%) | 659,277 / **75,916** (-88.5%) / **69,300** (-89.5%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 12 / **3** (-75%) / **3** (-75%) | 15 / **2** (-87%) / **2** (-87%) | 12,325 / **5,185** (-57.9%) / **2,785** (-77.4%) | 3,980 / **2,761** (-30.6%) / **915** (-77.0%) | 349,963 / **76,925** (-78.0%) / **70,240** (-79.9%) | ✅ 100% |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 12 / **3** (-75%) / **3** (-75%) | 13 / **2** (-85%) / **2** (-85%) | 12,799 / **5,331** (-58.4%) / **2,611** (-79.6%) | 4,153 / **3,055** (-26.4%) / **892** (-78.5%) | 353,669 / **77,170** (-78.2%) / **69,818** (-80.3%) | ✅ 100% |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 17 / **3** (-82%) / **3** (-82%) | 16 / **2** (-88%) / **2** (-88%) | 13,409 / **5,507** (-58.9%) / **3,193** (-76.2%) | 4,061 / **3,242** (-20.2%) / **1,131** (-72.2%) | 479,182 / **79,427** (-83.4%) / **71,468** (-85.1%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 15 / **3** (-80%) / **3** (-80%) | 17 / **2** (-88%) / **2** (-88%) | 17,185 / **6,054** (-64.8%) / **3,092** (-82.0%) | 5,374 / **3,830** (-28.7%) / **1,124** (-79.1%) | 459,474 / **81,598** (-82.2%) / **71,588** (-84.4%) | ✅ 100% |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 50 / **8** (-84%) / **5** (-90%) | 49 / **7** (-86%) / **4** (-92%) | 58,844 / **15,563** (-73.5%) / **8,091** (-86.3%) | 21,603 / **8,842** (-59.1%) / **2,738** (-87.3%) | 2,308,023 / **263,069** (-88.6%) / **146,732** (-93.6%) | ✅ 100% |
| **TOTAL** | **All 10 Scenarios (15/15 Languages)** | **189** / **35** (-81.5%) / **32** (-83.1%) | **204** / **25** (-87.8%) / **22** (-89.2%) | **207,372** / **64,380** (-69.0%) / **33,839** (-83.7%) | **68,108** / **37,100** (-45.5%) / **11,680** (-82.8%) | **6,587,895** / **969,363** (-85.3%) / **782,293** (-88.1%) | ✅ **30/30** |

## 4. Ground-Truth Conversation ID Audit Trail (30 Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | LLM Turns | Tool Calls | Tool Call Tokens | Tool Result Tokens | LLM Output Tokens | Working Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | Duration | Disk Verified |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AICE | `3e8c1da8-ac9f-4644-b078-06ffbdfc1847` | 13 | 16 | 5 541 | 7 433 | 5 853 | **18 827** | 77 043 | 414 985 | 46.3s | ✅ |
| **RW-01** | AICE No Idioms | `c9135238-e694-487c-9d37-0a9ac8250402` | 3 | 2 | 901 | 1 526 | 2 867 | **5 294** | 16 617 | 77 797 | 17.3s | ✅ |
| **RW-01** | AICE With Idioms | `17f67d0b-abb3-45b0-ac7b-836f030619b0` | 3 | 2 | 994 | 896 | 945 | **2 835** | 13 134 | 70 214 | 19.3s | ✅ |
| **RW-02** | Without AICE | `1c04e3fd-ed73-44bd-9fcf-6ee6f273e41b` | 9 | 14 | 2 625 | 6 115 | 3 288 | **12 028** | 46 085 | 249 685 | 35.1s | ✅ |
| **RW-02** | AICE No Idioms | `0d61fd7f-d290-4a78-8197-ec932285f628` | 3 | 2 | 795 | 1 368 | 2 542 | **4 705** | 15 141 | 76 316 | 18.3s | ✅ |
| **RW-02** | AICE With Idioms | `a8aec2b9-34d6-410d-9ab9-479bf7366d2f` | 3 | 2 | 869 | 737 | 826 | **2 432** | 12 423 | 69 500 | 17.6s | ✅ |
| **RW-03** | Without AICE | `65fe8013-89eb-4274-82d9-8e6a97d5b7d9` | 18 | 23 | 4 391 | 7 922 | 4 909 | **17 222** | 87 276 | 579 533 | 54.7s | ✅ |
| **RW-03** | AICE No Idioms | `c6f54cc2-df3f-4b53-acdf-c7de30febb13` | 3 | 2 | 879 | 1 398 | 3 433 | **5 710** | 18 977 | 80 162 | 22.0s | ✅ |
| **RW-03** | AICE With Idioms | `e3810446-8381-4a18-b870-8d409fdbe6d2` | 3 | 2 | 980 | 1 104 | 1 190 | **3 274** | 14 823 | 71 908 | 19.6s | ✅ |
| **RW-04** | Without AICE | `a2cd4a5f-b964-4920-8e2d-b4d132503f01` | 23 | 22 | 7 481 | 7 455 | 8 375 | **23 311** | 107 450 | 734 104 | 80.0s | ✅ |
| **RW-04** | AICE No Idioms | `d0635f89-517e-49a7-8a37-308f2b3f4f8e` | 3 | 2 | 850 | 1 472 | 4 047 | **6 369** | 19 797 | 80 983 | 21.9s | ✅ |
| **RW-04** | AICE With Idioms | `2fab6580-b35c-409d-9d08-df3abc4adc61` | 3 | 2 | 960 | 1 039 | 1 139 | **3 138** | 14 441 | 71 525 | 20.1s | ✅ |
| **RW-05** | Without AICE | `ba9085e7-869e-496f-a38f-1f2a34ede71a` | 20 | 19 | 4 887 | 10 023 | 6 512 | **21 422** | 105 644 | 659 277 | 74.2s | ✅ |
| **RW-05** | AICE No Idioms | `a1d4d5c0-efae-4bb0-8c54-0f890f50a3b9` | 3 | 2 | 818 | 1 363 | 2 481 | **4 662** | 18 821 | 75 916 | 16.7s | ✅ |
| **RW-05** | AICE With Idioms | `22456023-112d-42ab-8773-a18d8afbf3de` | 3 | 2 | 851 | 757 | 780 | **2 388** | 12 223 | 69 300 | 16.8s | ✅ |
| **RW-06** | Without AICE | `9237ffb0-efa2-4b59-b4b8-b28caea70bda` | 12 | 15 | 3 613 | 4 732 | 3 980 | **12 325** | 52 829 | 349 963 | 41.8s | ✅ |
| **RW-06** | AICE No Idioms | `e2718125-9a77-415a-8ff7-7ce371a7e5a5` | 3 | 2 | 891 | 1 533 | 2 761 | **5 185** | 15 748 | 76 925 | 21.7s | ✅ |
| **RW-06** | AICE With Idioms | `80886fe4-e6d1-4a0c-96da-9dd3d8c9a855` | 3 | 2 | 982 | 888 | 915 | **2 785** | 13 160 | 70 240 | 17.5s | ✅ |
| **RW-07** | Without AICE | `e7556050-58da-4f5b-a8bc-dd756b7fc712` | 12 | 13 | 2 794 | 5 852 | 4 153 | **12 799** | 52 273 | 353 669 | 42.0s | ✅ |
| **RW-07** | AICE No Idioms | `71e236e7-9175-4a8c-ab82-1d986e3bd0b3` | 3 | 2 | 868 | 1 408 | 3 055 | **5 331** | 32 306 | 77 170 | 19.2s | ✅ |
| **RW-07** | AICE With Idioms | `68b6920c-e72d-4440-8db3-4ff2fe717f65` | 3 | 2 | 949 | 770 | 892 | **2 611** | 12 739 | 69 818 | 17.2s | ✅ |
| **RW-08** | Without AICE | `8c42e341-7be7-47c3-b96b-6129a465b151` | 17 | 16 | 3 797 | 5 551 | 4 061 | **13 409** | 76 241 | 479 182 | 55.5s | ✅ |
| **RW-08** | AICE No Idioms | `c2996771-179f-4ecd-b768-8c80e92e23a7` | 3 | 2 | 883 | 1 382 | 3 242 | **5 507** | 18 244 | 79 427 | 19.8s | ✅ |
| **RW-08** | AICE With Idioms | `2632ed80-7c2d-4e8d-98a5-851ea6188616` | 3 | 2 | 994 | 1 068 | 1 131 | **3 193** | 14 383 | 71 468 | 17.5s | ✅ |
| **RW-09** | Without AICE | `0fb49627-0489-4109-bc62-3049ec77da26` | 15 | 17 | 4 622 | 7 189 | 5 374 | **17 185** | 76 810 | 459 474 | 56.2s | ✅ |
| **RW-09** | AICE No Idioms | `092bd566-e029-4148-b953-0c38a661da11` | 3 | 2 | 899 | 1 325 | 3 830 | **6 054** | 20 409 | 81 598 | 20.0s | ✅ |
| **RW-09** | AICE With Idioms | `5e5c922a-46d9-4745-97e0-dc7373c04d22` | 3 | 2 | 941 | 1 027 | 1 124 | **3 092** | 14 503 | 71 588 | 16.9s | ✅ |
| **RW-10** | Without AICE | `d543e0e1-1966-4b1c-b912-c6efb777ecd4` | 50 | 49 | 20 976 | 16 265 | 21 603 | **58 844** | 214 272 | 2 308 023 | 197.4s | ✅ |
| **RW-10** | AICE No Idioms | `817b84b7-2f15-4939-b54f-399275d54f1f` | 8 | 7 | 1 224 | 5 497 | 8 842 | **15 563** | 50 955 | 263 069 | 49.8s | ✅ |
| **RW-10** | AICE With Idioms | `b8323091-5235-4a05-a37e-1c2cacb45b4d` | 5 | 4 | 1 322 | 4 031 | 2 738 | **8 091** | 28 428 | 146 732 | 32.7s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

Why do both the **Real AI Agent Suite** (`docs/BENCHMARKS.md`) and the **Deterministic Offline Suite** ([`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)) show strong, consistent wins across all 10 scenarios?

| ID | Scenario | Offline Token Savings (Pure AICE / +Idioms) | Real Agent Working Token Savings (Pure AICE / +Idioms) | Offline Turn Savings (Pure AICE / +Idioms) | Real Agent Turn Savings (Pure AICE / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -46.1% / **-75.4%** | -71.9% / **-84.9%** | -63.0% / **-71.7%** | -76.9% / **-76.9%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -39.0% / **-71.0%** | -60.9% / **-79.8%** | -62.2% / **-70.3%** | -66.7% / **-66.7%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -44.7% / **-73.5%** | -66.8% / **-81.0%** | -58.2% / **-69.1%** | -83.3% / **-83.3%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -41.5% / **-71.8%** | -72.7% / **-86.5%** | -59.2% / **-69.4%** | -87.0% / **-87.0%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -45.7% / **-74.2%** | -78.2% / **-88.8%** | -61.1% / **-69.4%** | -85.0% / **-85.0%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -44.7% / **-73.9%** | -57.9% / **-77.4%** | -56.4% / **-66.7%** | -75.0% / **-75.0%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -39.9% / **-71.3%** | -58.4% / **-79.6%** | -61.1% / **-69.4%** | -75.0% / **-75.0%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -41.4% / **-72.3%** | -58.9% / **-76.2%** | -59.2% / **-69.4%** | -82.3% / **-82.3%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -43.6% / **-73.5%** | -64.8% / **-82.0%** | -57.5% / **-68.1%** | -80.0% / **-80.0%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -44.1% / **-73.5%** | -73.5% / **-86.3%** | -56.5% / **-69.4%** | -84.0% / **-90.0%** |

## 6. Architectural Analysis: When & Why AICE On-the-Fly Is Better (and Honest Trade-Offs)

### A. 100% Fair, Uncoached Benchmark Design
- **Identical Plain-English Engineering Task**: All 3 modes (`without_aice`, `aice_no_idioms`, `aice_with_idioms`) receive the exact same plain-English engineering specification (`buildTaskSpecText` in [`benchmarks/run-real-agents.ts`](../benchmarks/run-real-agents.ts)). Zero pre-written `.aice` code snippets, zero `$idiom(...)` macro calls, and zero pre-filled `-s` symbol lists are leaked in the prompt.
- **Autonomous Symbol & Idiom Discovery**: Every agent must discover the workspace symbols, obsolete/legacy declarations, and (in idiom mode) active `$idiom` templates on its own using its allowed toolset (`grep_search`/`view_file`/`replace_file_content` for `without_aice`; `aice context`, `aice outline`, `aice splice`, `aice idioms` for the AICE modes).

### B. Why AICE On-the-Fly WITH Idioms (`aice_with_idioms`) Wins 10/10 Across Every Metric
1. **1-Turn Multi-File Context + AST Macro Compression (`aice context . -s "..." --idioms`)**: Instead of issuing 6–25 separate `view_file` / `grep_search` calls across native files, the agent inspects the workspace `// symbols:` headers, decompiled AICE slices (collapsed into 1-line `$idiom(...)` calls), and active idiom definitions in 1 command (`-83.7%` working payload tokens and `-82.8%` LLM output tokens).
2. **O(1) Workspace-Wide Pattern Refactoring (`aice splice --idioms --batch` / `aice idioms update --batch`)**: When a structural pattern changes across a codebase (e.g., updating clamping step math across 10+ functions, changing JSX/HTML/Twig class names, or updating JSON/YAML policy fields), `Without AICE` must read and edit every file individually (`50` turns on the 15-language suite `RW-10`). With Project Idioms, the agent updates the shared `$idiom` templates once in a single batch command and AICE atomically re-emits all native call sites (`5` turns on `RW-10`, `-90.0%` turns and `-87.3%` output tokens).
3. **Batch Surgical AST Splicing (`aice splice --idioms --batch`)**: Target symbol updates, new feature insertions (`insertAfter`), and obsolete symbol deletions (`delete: true`) across multiple languages are applied atomically in 1 batch command with `0` `.aice` files left on disk.

### C. Why Pure AICE WITHOUT Idioms (`aice_no_idioms`) Wins 10/10 — and Why Idioms Still Matter
- **Where Pure AICE Wins (`10/10` scenarios)**: Even without `$idiom` macros, `aice context . -s "*" --no-idioms` (with compact 1-line guard/layout slices) and `aice splice --no-idioms --batch` beat `Without AICE` in all 10 scenarios across **LLM Turns (`189 -> 35`, `-81.5%`)**, **Tool Calls (`204 -> 25`, `-87.8%`)**, **Working Payload Tokens (`207,372 -> 64,380`, `-69.0%`)**, **LLM Output Tokens (`68,108 -> 37,100`, `-45.5%`)**, **Billable API Tokens (`895,923 -> 227,015`, `-74.7%`)**, and **Total API Context Tokens (`6,587,895 -> 969,363`, `-85.3%`)**.
- **Honest Granularity Comparison (`aice_no_idioms` vs `aice_with_idioms`)**: Because `aice splice --no-idioms` splices at the *symbol* boundary (`fn`, `component`, `style`, `config.<key>`), refactoring a pattern across 15–20 declarations without `$idiom` macros requires including each modified declaration's compact AICE slice in the batch JSON payload (`37,100` output tokens across the suite). Enabling Project Idioms (`--idioms`) collapses those repetitive declarations into 1-line `$idiom(...)` calls and O(1) template updates, cutting LLM output tokens by an additional **`-68.5%`** (`37,100 -> 11,680`) and working payload tokens by **`-47.4%`** (`64,380 -> 33,839`).
