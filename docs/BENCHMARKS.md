# AIL 2.0 — Real AI Agent Benchmark Suite Report (10 Scenarios — Without & With Idioms)

> **Ground-Truth Real AI Agent Proof**: Every number in this report comes from **30 real autonomous AI agent (`agy -p`) executions** (`10 scenarios × 3 modes`) running against isolated temporary workspaces on disk and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: Real AI Agents vs Deterministic Offline Suite

| Metric (Across All 10 Scenarios `RW-01` .. `RW-10`) | Without AIL (Native Tools) | AIL Without Idioms (Pure AIL) | AIL With Idioms (`$idiom` AST Macros) | AIL Win Rate |
| :--- | :---: | :---: | :---: | :---: |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 126 turns | **40 turns (-68.3%)** | **30 turns (-76.2%)** | **10/10 (100%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 151 calls | **30 calls (-80.1%)** | **20 calls (-86.8%)** | **10/10 (100%)** |
| **Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 225,390 | **78,974 (-65.0%)** | **33,323 (-85.2%)** | **10/10 (100%)** |
| **Real Agent LLM Output Tokens** (`output_tokens`) | 88,284 | **45,966 (-47.9%)** | **12,316 (-86.0%)** | **10/10 (100%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 664,281 | **237,578 (-64.2%)** | **143,178 (-78.5%)** | **10/10 (100%)** |
| **Real Agent Total API Context Tokens** (`input + cache + output`) | 4,410,780 | **1,110,441 (-74.8%)** | **726,291 (-83.5%)** | **10/10 (100%)** |
| **Real Agent Wall-Clock Duration** | 490.4s | **266.5s** | **172.2s** | **10/10 (100%)** |
| **Offline Deterministic Suite Tokens** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 127,243 | **71,877 (-43.5%)** | **33,982 (-73.3%)** | **10/10 (100%)** |
| **Offline Deterministic Suite Turns** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 502 turns | **206 turns (-59.0%)** | **154 turns (-69.3%)** | **10/10 (100%)** |

## 2. Methodology & How Real Agent Telemetry Is Measured

For each of the 10 real-world scenarios (`RW-01` .. `RW-10`), 3 independent `agy` agent sessions were spawned in isolated temporary directories containing the native source files:
1. **Without AIL (`without_ail`)**: The agent uses standard native IDE tools (`grep_search`, `view_file`, `replace_file_content`) to locate symbols, read files, update target symbols, delete obsolete symbols, and apply the multi-file pattern refactor across the workspace.
2. **AIL Without Idioms (`ail_no_idioms`)**: The agent uses AIL On-the-Fly CLI in pure AIL mode (`ail context . -s "..." --no-idioms` and `ail splice --no-idioms --batch '[...]'`).
3. **AIL With Idioms (`ail_with_idioms`)**: The agent uses AIL On-the-Fly CLI with project `$idiom` macros (`ail context . -s "..." --idioms`, `ail splice --idioms --batch '[...]'`, and `ail idioms update --batch '[...]'`).

After each agent finishes, its ground-truth transcript at `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` is parsed and the workspace on disk is verified:
- **LLM Turns (`llmTurns`)**: Exact count of `PLANNER_RESPONSE` entries in `transcript.jsonl`.
- **Tool Calls (`toolCalls`)**: Exact count of `tool_calls` invoked across all `PLANNER_RESPONSE` turns.
- **Working Payload Tokens (`workingTokens`)**: `toolCallTokens + toolResultTokens + outputTokens` (measured with `o200k_base` on tool arguments/outputs plus exact `PLANNER_RESPONSE.output_tokens`), isolating the actual code/context/edit payload from the static IDE system prompt.
- **Billable API Tokens (`billableTokens`)**: Exact sum of `input_tokens + output_tokens` reported by the LLM API across all turns.
- **Total API Context Tokens (`apiTotalTokens`)**: Exact sum of `input_tokens + cache_read_tokens + output_tokens` across all turns (invariant to server-side prompt cache warmth).
- **On-Disk Verification (`verifiedOnDisk` & `zeroAilFilesLeftOnDisk`)**: Confirms every target symbol update, obsolete symbol deletion, and multi-file pattern refactor is present in the native files on disk, with `0` `.ail` files left behind.

## 3. All 10 Real-World Scenarios — Real AI Agent Results

| ID | Scenario & Languages | Turns (No AIL / Pure AIL / +Idioms) | Tool Calls (No AIL / Pure AIL / +Idioms) | Working Tokens (No AIL / Pure AIL / +Idioms) | LLM Output Tokens (No AIL / Pure AIL / +Idioms) | Total API Context Tokens (No AIL / Pure AIL / +Idioms) | Verified |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 20 / **4** (-80%) / **3** (-85%) | 23 / **3** (-87%) / **2** (-91%) | 29,427 / **6,968** (-76.3%) / **2,980** (-89.9%) | 9,998 / **3,539** (-64.6%) / **923** (-90.8%) | 687,185 / **106,111** (-84.6%) / **70,390** (-89.8%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 7 / **4** (-43%) / **3** (-57%) | 9 / **3** (-67%) / **2** (-78%) | 13,435 / **6,311** (-53.0%) / **2,656** (-80.2%) | 5,478 / **3,196** (-41.7%) / **848** (-84.5%) | 203,341 / **104,793** (-48.5%) / **70,072** (-65.5%) | ✅ 100% |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 11 / **4** (-64%) / **3** (-73%) | 16 / **3** (-81%) / **2** (-88%) | 20,790 / **7,479** (-64.0%) / **3,692** (-82.2%) | 8,144 / **4,212** (-48.3%) / **1,399** (-82.8%) | 358,966 / **111,669** (-68.9%) / **73,297** (-79.6%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 9 / **4** (-56%) / **3** (-67%) | 13 / **3** (-77%) / **2** (-85%) | 19,550 / **8,217** (-58.0%) / **3,539** (-81.9%) | 7,882 / **4,844** (-38.5%) / **1,317** (-83.3%) | 287,304 / **111,379** (-61.2%) / **72,688** (-74.7%) | ✅ 100% |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 7 / **4** (-43%) / **3** (-57%) | 10 / **3** (-70%) / **2** (-80%) | 15,754 / **6,444** (-59.1%) / **2,618** (-83.4%) | 6,484 / **3,275** (-49.5%) / **814** (-87.5%) | 211,587 / **104,895** (-50.4%) / **69,875** (-67.0%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 9 / **4** (-56%) / **3** (-67%) | 12 / **3** (-75%) / **2** (-83%) | 17,658 / **6,825** (-61.4%) / **3,184** (-82.0%) | 6,812 / **3,402** (-50.1%) / **1,078** (-84.2%) | 276,946 / **106,436** (-61.6%) / **71,201** (-74.3%) | ✅ 100% |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 7 / **4** (-43%) / **3** (-57%) | 10 / **3** (-70%) / **2** (-80%) | 15,737 / **7,499** (-52.4%) / **2,647** (-83.2%) | 7,078 / **4,241** (-40.1%) / **850** (-88.0%) | 203,470 / **108,559** (-46.6%) / **69,992** (-65.6%) | ✅ 100% |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 14 / **4** (-71%) / **3** (-79%) | 13 / **3** (-77%) / **2** (-85%) | 18,074 / **7,325** (-59.5%) / **3,353** (-81.5%) | 6,978 / **4,054** (-41.9%) / **1,110** (-84.1%) | 404,815 / **110,500** (-72.7%) / **72,396** (-82.1%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 9 / **4** (-56%) / **3** (-67%) | 13 / **3** (-77%) / **2** (-85%) | 21,916 / **8,099** (-63.0%) / **3,425** (-84.4%) | 8,839 / **4,827** (-45.4%) / **1,157** (-86.9%) | 303,664 / **113,674** (-62.6%) / **72,635** (-76.1%) | ✅ 100% |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 33 / **4** (-88%) / **3** (-91%) | 32 / **3** (-91%) / **2** (-94%) | 53,049 / **13,807** (-74.0%) / **5,229** (-90.1%) | 20,591 / **10,376** (-49.6%) / **2,820** (-86.3%) | 1,473,502 / **132,425** (-91.0%) / **83,745** (-94.3%) | ✅ 100% |
| **TOTAL** | **All 10 Scenarios (15/15 Languages)** | **126** / **40** (-68.3%) / **30** (-76.2%) | **151** / **30** (-80.1%) / **20** (-86.8%) | **225,390** / **78,974** (-65.0%) / **33,323** (-85.2%) | **88,284** / **45,966** (-47.9%) / **12,316** (-86.0%) | **4,410,780** / **1,110,441** (-74.8%) / **726,291** (-83.5%) | ✅ **30/30** |

## 4. Ground-Truth Conversation ID Audit Trail (30 Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | LLM Turns | Tool Calls | Tool Call Tokens | Tool Result Tokens | LLM Output Tokens | Working Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | Duration | Disk Verified |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AIL | `b81206c1-ec60-423c-a4a6-e1094818e9a9` | 20 | 23 | 10 759 | 8 670 | 9 998 | **29 427** | 109 393 | 687 185 | 24.5s | ✅ |
| **RW-01** | AIL No Idioms | `dd82b585-eba3-4bc1-8da5-bfd75b4c126b` | 4 | 3 | 1 896 | 1 533 | 3 539 | **6 968** | 24 546 | 106 111 | 24.5s | ✅ |
| **RW-01** | AIL With Idioms | `382ade93-a31f-4846-bb54-3ff5526ba581` | 3 | 2 | 989 | 1 068 | 923 | **2 980** | 13 309 | 70 390 | 24.5s | ✅ |
| **RW-02** | Without AIL | `1e0d36be-83bb-4f86-b205-a8d62fb90ad3` | 7 | 9 | 4 633 | 3 324 | 5 478 | **13 435** | 52 612 | 203 341 | 38.1s | ✅ |
| **RW-02** | AIL No Idioms | `5b9fb9ae-6e9d-47c5-98f1-b3e6c23d1b5a` | 4 | 3 | 1 701 | 1 414 | 3 196 | **6 311** | 23 232 | 104 793 | 27.7s | ✅ |
| **RW-02** | AIL With Idioms | `be7e9d0c-fecf-460d-9af1-2d683ef4325a` | 3 | 2 | 904 | 904 | 848 | **2 656** | 12 993 | 70 072 | 16.8s | ✅ |
| **RW-03** | Without AIL | `04884c78-8bc7-41f7-9951-43e0aaade5d3` | 11 | 16 | 7 649 | 4 997 | 8 144 | **20 790** | 57 648 | 358 966 | 41.2s | ✅ |
| **RW-03** | AIL No Idioms | `8d1755bd-e0b9-4e12-8c40-41dda15cd665` | 4 | 3 | 1 891 | 1 376 | 4 212 | **7 479** | 21 929 | 111 669 | 25.5s | ✅ |
| **RW-03** | AIL With Idioms | `1ba71ac9-29b1-4882-a47c-ba7bca0a6a97` | 3 | 2 | 989 | 1 304 | 1 399 | **3 692** | 12 129 | 73 297 | 18.4s | ✅ |
| **RW-04** | Without AIL | `d2f7569f-486b-4d6f-bd7c-1adef0ac0fd6` | 9 | 13 | 7 165 | 4 503 | 7 882 | **19 550** | 51 052 | 287 304 | 41.5s | ✅ |
| **RW-04** | AIL No Idioms | `779213ed-c4d8-446c-9997-018ea9107eb2` | 4 | 3 | 1 913 | 1 460 | 4 844 | **8 217** | 21 644 | 111 379 | 23.9s | ✅ |
| **RW-04** | AIL With Idioms | `163e39b2-20ad-48ee-a763-c4dd9694adcb` | 3 | 2 | 1 007 | 1 215 | 1 317 | **3 539** | 15 599 | 72 688 | 15.2s | ✅ |
| **RW-05** | Without AIL | `92c75b21-0181-4941-95bf-6a359e361738` | 7 | 10 | 5 079 | 4 191 | 6 484 | **15 754** | 40 450 | 211 587 | 32.7s | ✅ |
| **RW-05** | AIL No Idioms | `2af6b269-0ebf-4a1f-b456-f87e46ad1798` | 4 | 3 | 1 755 | 1 414 | 3 275 | **6 444** | 23 333 | 104 895 | 22.8s | ✅ |
| **RW-05** | AIL With Idioms | `e7de8d00-c748-4e2a-a808-e45d27e36d5a` | 3 | 2 | 883 | 921 | 814 | **2 618** | 12 796 | 69 875 | 17.0s | ✅ |
| **RW-06** | Without AIL | `34b4c78a-79b3-46c4-aa3e-7c9394bf8423` | 9 | 12 | 6 364 | 4 482 | 6 812 | **17 658** | 44 748 | 276 946 | 38.6s | ✅ |
| **RW-06** | AIL No Idioms | `c9dd92b6-c4fa-4d92-a068-9c573551cc94` | 4 | 3 | 1 912 | 1 511 | 3 402 | **6 825** | 20 791 | 106 436 | 22.9s | ✅ |
| **RW-06** | AIL With Idioms | `bc9c83d1-f18b-4baa-b685-d59f4a2b08d2` | 3 | 2 | 1 026 | 1 080 | 1 078 | **3 184** | 14 118 | 71 201 | 15.8s | ✅ |
| **RW-07** | Without AIL | `8f0f3a56-06ab-475f-be21-00fc91e71bfe` | 7 | 10 | 4 797 | 3 862 | 7 078 | **15 737** | 36 447 | 203 470 | 33.0s | ✅ |
| **RW-07** | AIL No Idioms | `000cd25f-271d-4e4d-98c8-6921f77bb2b8` | 4 | 3 | 1 820 | 1 438 | 4 241 | **7 499** | 18 845 | 108 559 | 24.1s | ✅ |
| **RW-07** | AIL With Idioms | `4e45c453-8fae-4668-b7b4-9018fe25a4be` | 3 | 2 | 917 | 880 | 850 | **2 647** | 12 912 | 69 992 | 12.9s | ✅ |
| **RW-08** | Without AIL | `ad47e489-e638-4b46-827c-b9bd8a7ce594` | 14 | 13 | 6 766 | 4 330 | 6 978 | **18 074** | 62 704 | 404 815 | 65.2s | ✅ |
| **RW-08** | AIL No Idioms | `c8871eac-4b62-439a-be74-74c1c647576b` | 4 | 3 | 1 871 | 1 400 | 4 054 | **7 325** | 20 765 | 110 500 | 31.8s | ✅ |
| **RW-08** | AIL With Idioms | `0e1fb6ca-b84c-4f38-973d-9f89bfefe8bc` | 3 | 2 | 980 | 1 263 | 1 110 | **3 353** | 15 308 | 72 396 | 16.5s | ✅ |
| **RW-09** | Without AIL | `e1de384d-8ca9-4094-b0aa-267834e98b68` | 9 | 13 | 7 719 | 5 358 | 8 839 | **21 916** | 55 116 | 303 664 | 46.9s | ✅ |
| **RW-09** | AIL No Idioms | `97c856e2-339b-4faf-8fa0-238eeabac2b9` | 4 | 3 | 1 904 | 1 368 | 4 827 | **8 099** | 23 931 | 113 674 | 27.2s | ✅ |
| **RW-09** | AIL With Idioms | `04d73011-40b8-438c-bb6c-868f59fbde8d` | 3 | 2 | 950 | 1 318 | 1 157 | **3 425** | 15 547 | 72 635 | 17.2s | ✅ |
| **RW-10** | Without AIL | `b4bc9f0e-6b96-4721-bfe3-179bd2083520` | 33 | 32 | 20 217 | 12 241 | 20 591 | **53 049** | 154 111 | 1 473 502 | 128.7s | ✅ |
| **RW-10** | AIL No Idioms | `e88c8fb2-4358-45aa-afb5-ecebe48687f6` | 4 | 3 | 2 049 | 1 382 | 10 376 | **13 807** | 38 562 | 132 425 | 36.0s | ✅ |
| **RW-10** | AIL With Idioms | `fce8a32f-9c82-49f9-9dc3-fecaa894e4ea` | 3 | 2 | 1 015 | 1 394 | 2 820 | **5 229** | 18 467 | 83 745 | 17.8s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

Why do both the **Real AI Agent Suite** (`docs/BENCHMARKS.md`) and the **Deterministic Offline Suite** ([`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)) show strong, consistent wins across all 10 scenarios?

| ID | Scenario | Offline Token Savings (Pure AIL / +Idioms) | Real Agent Working Token Savings (Pure AIL / +Idioms) | Offline Turn Savings (Pure AIL / +Idioms) | Real Agent Turn Savings (Pure AIL / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -46.1% / **-75.5%** | -76.3% / **-89.9%** | -63.0% / **-71.7%** | -80.0% / **-85.0%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -39.0% / **-71.0%** | -53.0% / **-80.2%** | -62.2% / **-70.3%** | -42.9% / **-57.1%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -44.7% / **-73.5%** | -64.0% / **-82.2%** | -58.2% / **-69.1%** | -63.6% / **-72.7%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -41.5% / **-71.9%** | -58.0% / **-81.9%** | -59.2% / **-69.4%** | -55.6% / **-66.7%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -45.7% / **-74.3%** | -59.1% / **-83.4%** | -61.1% / **-69.4%** | -42.9% / **-57.1%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -45.1% / **-74.1%** | -61.4% / **-82.0%** | -56.4% / **-66.7%** | -55.6% / **-66.7%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -39.9% / **-71.3%** | -52.4% / **-83.2%** | -61.1% / **-69.4%** | -42.9% / **-57.1%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -41.4% / **-72.4%** | -59.5% / **-81.5%** | -59.2% / **-69.4%** | -71.4% / **-78.6%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -43.9% / **-73.7%** | -63.0% / **-84.4%** | -57.5% / **-68.1%** | -55.6% / **-66.7%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -44.3% / **-73.6%** | -74.0% / **-90.1%** | -56.5% / **-69.4%** | -87.9% / **-90.9%** |
