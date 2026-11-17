# AICE — Real AI Agent Benchmark Suite Report (Adversarial Cold-Start Scenarios — Without & With Idioms)

> **Ground-Truth Adversarial Real AI Agent Proof**: Every number in this report comes from **real autonomous AI agent (`agy -p`) executions** running against **cold-start, procedurally seeded, decoy-minefielded workspaces** on disk under **blind issue prompts** (zero symbol name leakage, zero positional `@first` shortcuts, zero pre-baked `aice.config.json`) and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: 4 Bulletproof Metrics (11/11 Live Adversarial Scenarios + Deterministic Offline Suite)

| Metric (10 Multi-File Scenarios `RW-01`..`RW-10` + `RW-11` Lone Needle; Totals Shown for `RW-01`..`RW-10`) | Without AICE (Native Tools) | AICE Without Idioms (Default Pure AICE) | AICE With Opt-In Idioms (`--idioms` Scan + Splice) | AICE Win Rate (`RW-01`..`RW-11`) |
| :--- | :---: | :---: | :---: | :---: |
| **1. Real Agent LLM Output Tokens** (`output_tokens`, 4x API cost weight) | 118,005 | **43,780 (-62.9%)** | **18,585 (-84.3%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **2. Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 381,115 | **160,793 (-57.8%)** | **104,277 (-72.6%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **3. Real API Dollar Cost (USD)** (`$0.15/1M in, $0.0375/1M cache, $0.60/1M out`) | $0.7960 | **$0.2309 (-71.0%)** | **$0.2106 (-73.5%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **4. Real Agent Total API Context Tokens** (`input + cache + output`) | 14,240,183 | **3,490,537 (-75.5%)** | **3,417,652 (-76.0%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 1,856,368 | **713,750 (-61.5%)** | **658,490 (-64.5%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 328 turns | **102 turns (-68.9%)** | **108 turns (-67.1%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 346 calls | **72 calls (-79.2%)** | **78 calls (-77.5%)** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **Real Agent Wall-Clock Duration** | 1340.3s | **553.9s** | **526.5s** | Pure **11/11** \| +Idioms **11/11 (100%)** |
| **Offline Deterministic Suite Tokens** ([BENCHMARKS_OFFLINE.md](./BENCHMARKS_OFFLINE.md)) | 127,011 | **74,015 (-41.7%)** | **36,180 (-71.5%)** | **10/10 (100%)** |
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
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 41 / **10** (-76%) / **9** (-78%) | 39,169 / **18,261** (-53.4%) / **7,937** (-79.7%) | 12,300 / **6,171** (-49.8%) / **1,576** (-87.2%) | $0.0942 / **$0.0235** (-75.0%) / **$0.0175** (-81.4%) | 1,756,021 / **340,137** (-80.6%) / **265,039** (-84.9%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 23 / **10** (-57%) / **10** (-57%) | 24,406 / **11,602** (-52.5%) / **7,723** (-68.4%) | 8,177 / **2,962** (-63.8%) / **1,475** (-82.0%) | $0.0479 / **$0.0210** (-56.2%) / **$0.0188** (-60.6%) | 816,317 / **317,462** (-61.1%) / **295,376** (-63.8%) | ✅ 100% |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 54 / **12** (-78%) / **10** (-81%) | 45,388 / **17,786** (-60.8%) / **11,055** (-75.6%) | 11,640 / **3,955** (-66.0%) / **2,031** (-82.5%) | $0.1293 / **$0.0264** (-79.6%) / **$0.0198** (-84.7%) | 2,540,133 / **423,796** (-83.3%) / **315,134** (-87.6%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 37 / **10** (-73%) / **10** (-73%) | 47,962 / **16,989** (-64.6%) / **10,199** (-78.7%) | 15,743 / **4,712** (-70.1%) / **2,161** (-86.3%) | $0.0903 / **$0.0223** (-75.3%) / **$0.0192** (-78.8%) | 1,616,602 / **339,111** (-79.0%) / **307,703** (-81.0%) | ✅ 100% |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 19 / **10** (-47%) / **12** (-37%) | 28,982 / **13,244** (-54.3%) / **9,803** (-66.2%) | 9,977 / **2,946** (-70.5%) / **1,477** (-85.2%) | $0.0430 / **$0.0213** (-50.5%) / **$0.0223** (-48.2%) | 693,551 / **322,517** (-53.5%) / **367,176** (-47.1%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 26 / **9** (-65%) / **10** (-62%) | 38,380 / **12,758** (-66.8%) / **8,817** (-77.0%) | 11,339 / **3,206** (-71.7%) / **1,598** (-85.9%) | $0.0684 / **$0.0195** (-71.5%) / **$0.0193** (-71.7%) | 1,108,042 / **288,657** (-74.0%) / **301,411** (-72.8%) | ✅ 100% |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 19 / **10** (-47%) / **14** (-26%) | 19,044 / **14,172** (-25.6%) / **11,868** (-37.7%) | 5,217 / **3,549** (-32.0%) / **1,598** (-69.4%) | $0.0446 / **$0.0218** (-51.1%) / **$0.0268** (-40.0%) | 690,795 / **327,401** (-52.6%) / **445,701** (-35.5%) | ✅ 100% |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 42 / **9** (-79%) / **9** (-79%) | 32,453 / **13,281** (-59.1%) / **6,973** (-78.5%) | 10,691 / **3,553** (-66.8%) / **1,453** (-86.4%) | $0.0869 / **$0.0204** (-76.5%) / **$0.0172** (-80.3%) | 1,582,782 / **293,324** (-81.5%) / **265,902** (-83.2%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 34 / **9** (-74%) / **10** (-71%) | 37,681 / **14,245** (-62.2%) / **10,093** (-73.2%) | 8,774 / **4,068** (-53.6%) / **1,691** (-80.7%) | $0.0793 / **$0.0204** (-74.2%) / **$0.0175** (-77.9%) | 1,493,580 / **301,372** (-79.8%) / **313,597** (-79.0%) | ✅ 100% |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 33 / **13** (-61%) / **14** (-58%) | 67,650 / **28,455** (-57.9%) / **19,809** (-70.7%) | 24,147 / **8,658** (-64.1%) / **3,525** (-85.4%) | $0.1122 / **$0.0344** (-69.3%) / **$0.0322** (-71.3%) | 1,942,360 / **536,760** (-72.4%) / **540,613** (-72.2%) | ✅ 100% |
| **TOTAL (`RW-01..10`)** | **All 10 Multi-File Scenarios (15/15 Languages)** | **328** / **102** (-68.9%) / **108** (-67.1%) | **381,115** / **160,793** (-57.8%) / **104,277** (-72.6%) | **118,005** / **43,780** (-62.9%) / **18,585** (-84.3%) | **$0.7960** / **$0.2309** (-71.0%) / **$0.2106** (-73.5%) | **14,240,183** / **3,490,537** (-75.5%) / **3,417,652** (-76.0%) | ✅ **30/30** |
| **RW-11 (Hostile 0-Idiom)** | **Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)**<br/>`ts` (1 file, **0 idioms**) | 18 / **9** (-50%) / **9** (-50%) | 8,018 / **3,145** (-60.8%) / **3,350** (-58.2%) | 1,599 / **510** (-68.1%) / **529** (-66.9%) | $0.0302 / **$0.0154** (-48.9%) / **$0.0155** (-48.9%) | 511,105 / **235,824** (-53.9%) / **235,946** (-53.8%) | ✅ 100% |

### 3b. 3-Layer Progressive Lifecycle Breakdown (Live Telemetry)

| Scenario | Mode | L1 Baseline | L2 Feature Add | L3 Cross-Cutting | Total Turns | Working Tokens | LLM Output Tokens | Real Cost (USD) | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | `without_aice` | 22t / $0.0468 / ✅ | 11t / $0.0264 / ✅ | 8t / $0.0210 / ✅ | **41** | **39,169** | **12,300** | **$0.0942** | ✅ 100% |
| **RW-01** | **`aice_no_idioms`** | 4t / $0.0121 / ✅ | 3t / $0.0054 / ✅ | 3t / $0.0060 / ✅ | **10** | **18,261** | **6,171** | **$0.0235** | ✅ 100% |
| **RW-01** | **`aice_with_idioms`** | 3t / $0.0073 / ✅ | 3t / $0.0052 / ✅ | 3t / $0.0051 / ✅ | **9** | **7,937** | **1,576** | **$0.0175** | ✅ 100% |
| **RW-02** | `without_aice` | 8t / $0.0164 / ✅ | 9t / $0.0177 / ✅ | 6t / $0.0138 / ✅ | **23** | **24,406** | **8,177** | **$0.0479** | ✅ 100% |
| **RW-02** | **`aice_no_idioms`** | 3t / $0.0084 / ✅ | 4t / $0.0071 / ✅ | 3t / $0.0055 / ✅ | **10** | **11,602** | **2,962** | **$0.0210** | ✅ 100% |
| **RW-02** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 4t / $0.0065 / ✅ | 3t / $0.0052 / ✅ | **10** | **7,723** | **1,475** | **$0.0188** | ✅ 100% |
| **RW-03** | `without_aice` | 27t / $0.0571 / ✅ | 18t / $0.0465 / ✅ | 9t / $0.0258 / ✅ | **54** | **45,388** | **11,640** | **$0.1293** | ✅ 100% |
| **RW-03** | **`aice_no_idioms`** | 3t / $0.0089 / ✅ | 6t / $0.0112 / ✅ | 3t / $0.0063 / ✅ | **12** | **17,786** | **3,955** | **$0.0264** | ✅ 100% |
| **RW-03** | **`aice_with_idioms`** | 3t / $0.0072 / ✅ | 4t / $0.0068 / ✅ | 3t / $0.0057 / ✅ | **10** | **11,055** | **2,031** | **$0.0198** | ✅ 100% |
| **RW-04** | `without_aice` | 16t / $0.0313 / ✅ | 12t / $0.0305 / ✅ | 9t / $0.0285 / ✅ | **37** | **47,962** | **15,743** | **$0.0903** | ✅ 100% |
| **RW-04** | **`aice_no_idioms`** | 4t / $0.0109 / ✅ | 3t / $0.0053 / ✅ | 3t / $0.0061 / ✅ | **10** | **16,989** | **4,712** | **$0.0223** | ✅ 100% |
| **RW-04** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 4t / $0.0065 / ✅ | 3t / $0.0055 / ✅ | **10** | **10,199** | **2,161** | **$0.0192** | ✅ 100% |
| **RW-05** | `without_aice` | 9t / $0.0186 / ✅ | 5t / $0.0119 / ✅ | 5t / $0.0124 / ✅ | **19** | **28,982** | **9,977** | **$0.0430** | ✅ 100% |
| **RW-05** | **`aice_no_idioms`** | 3t / $0.0083 / ✅ | 4t / $0.0074 / ✅ | 3t / $0.0055 / ✅ | **10** | **13,244** | **2,946** | **$0.0213** | ✅ 100% |
| **RW-05** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 6t / $0.0100 / ✅ | 3t / $0.0052 / ✅ | **12** | **9,803** | **1,477** | **$0.0223** | ✅ 100% |
| **RW-06** | `without_aice` | 10t / $0.0224 / ✅ | 9t / $0.0265 / ✅ | 7t / $0.0194 / ✅ | **26** | **38,380** | **11,339** | **$0.0684** | ✅ 100% |
| **RW-06** | **`aice_no_idioms`** | 3t / $0.0086 / ✅ | 4t / $0.0073 / ✅ | 2t / $0.0037 / ✅ | **9** | **12,758** | **3,206** | **$0.0195** | ✅ 100% |
| **RW-06** | **`aice_with_idioms`** | 3t / $0.0072 / ✅ | 5t / $0.0083 / ✅ | 2t / $0.0039 / ✅ | **10** | **8,817** | **1,598** | **$0.0193** | ✅ 100% |
| **RW-07** | `without_aice` | 7t / $0.0168 / ✅ | 5t / $0.0130 / ✅ | 7t / $0.0148 / ✅ | **19** | **19,044** | **5,217** | **$0.0446** | ✅ 100% |
| **RW-07** | **`aice_no_idioms`** | 4t / $0.0107 / ✅ | 4t / $0.0070 / ✅ | 2t / $0.0041 / ✅ | **10** | **14,172** | **3,549** | **$0.0218** | ✅ 100% |
| **RW-07** | **`aice_with_idioms`** | 3t / $0.0071 / ✅ | 8t / $0.0140 / ✅ | 3t / $0.0057 / ✅ | **14** | **11,868** | **1,598** | **$0.0268** | ✅ 100% |
| **RW-08** | `without_aice` | 18t / $0.0341 / ✅ | 15t / $0.0306 / ✅ | 9t / $0.0222 / ✅ | **42** | **32,453** | **10,691** | **$0.0869** | ✅ 100% |
| **RW-08** | **`aice_no_idioms`** | 3t / $0.0092 / ✅ | 3t / $0.0054 / ✅ | 3t / $0.0058 / ✅ | **9** | **13,281** | **3,553** | **$0.0204** | ✅ 100% |
| **RW-08** | **`aice_with_idioms`** | 3t / $0.0070 / ✅ | 3t / $0.0053 / ✅ | 3t / $0.0048 / ✅ | **9** | **6,973** | **1,453** | **$0.0172** | ✅ 100% |
| **RW-09** | `without_aice` | 24t / $0.0527 / ✅ | 5t / $0.0130 / ✅ | 5t / $0.0137 / ✅ | **34** | **37,681** | **8,774** | **$0.0793** | ✅ 100% |
| **RW-09** | **`aice_no_idioms`** | 3t / $0.0093 / ✅ | 3t / $0.0054 / ✅ | 3t / $0.0056 / ✅ | **9** | **14,245** | **4,068** | **$0.0204** | ✅ 100% |
| **RW-09** | **`aice_with_idioms`** | 3t / $0.0049 / ✅ | 4t / $0.0073 / ✅ | 3t / $0.0054 / ✅ | **10** | **10,093** | **1,691** | **$0.0175** | ✅ 100% |
| **RW-10** | `without_aice` | 20t / $0.0630 / ✅ | 7t / $0.0283 / ✅ | 6t / $0.0209 / ✅ | **33** | **67,650** | **24,147** | **$0.1122** | ✅ 100% |
| **RW-10** | **`aice_no_idioms`** | 7t / $0.0205 / ✅ | 3t / $0.0070 / ✅ | 3t / $0.0070 / ✅ | **13** | **28,455** | **8,658** | **$0.0344** | ✅ 100% |
| **RW-10** | **`aice_with_idioms`** | 8t / $0.0190 / ✅ | 3t / $0.0064 / ✅ | 3t / $0.0068 / ✅ | **14** | **19,809** | **3,525** | **$0.0322** | ✅ 100% |
| **RW-11** | `without_aice` | 5t / $0.0097 / ✅ | 5t / $0.0074 / ✅ | 8t / $0.0131 / ✅ | **18** | **8,018** | **1,599** | **$0.0302** | ✅ 100% |
| **RW-11** | **`aice_no_idioms`** | 3t / $0.0065 / ✅ | 4t / $0.0060 / ✅ | 2t / $0.0030 / ✅ | **9** | **3,145** | **510** | **$0.0154** | ✅ 100% |
| **RW-11** | **`aice_with_idioms`** | 3t / $0.0065 / ✅ | 3t / $0.0045 / ✅ | 3t / $0.0044 / ✅ | **9** | **3,350** | **529** | **$0.0155** | ✅ 100% |

## 4. Ground-Truth Conversation ID Audit Trail (Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | Seed | Turns | Tool Calls | Working Tokens | LLM Output Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | API Cost (USD) | Duration | Verified & Decoys Intact |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AICE | `6102544c-5929-48b6-bfc5-ce5eb8fb8f28` | `940935` | 41 | 38 | **39,169** | 12,300 | 202,614 | 1,756,021 | $0.0942 | 139.0s | ✅ |
| **RW-01** | AICE No Idioms | `0b946d98-83bc-4c00-91c7-bd51625b5ab3` | `940935` | 10 | 7 | **18,261** | 6,171 | 71,022 | 340,137 | $0.0235 | 63.1s | ✅ |
| **RW-01** | AICE With Idioms | `9e3a4e9b-ee01-468c-8d91-7cb76c7b52ab` | `940935` | 9 | 6 | **7,937** | 1,576 | 61,269 | 265,039 | $0.0175 | 45.4s | ✅ |
| **RW-02** | Without AICE | `090b468a-fa6b-4420-ace6-8f647db76fdd` | `940935` | 23 | 23 | **24,406** | 8,177 | 120,685 | 816,317 | $0.0479 | 81.9s | ✅ |
| **RW-02** | AICE No Idioms | `ffb46cb2-81e3-413d-b072-44db08e8edd6` | `940935` | 10 | 7 | **11,602** | 2,962 | 68,810 | 317,462 | $0.0210 | 50.7s | ✅ |
| **RW-02** | AICE With Idioms | `b4bd11d3-e255-4ca6-96a9-6e12744e541b` | `940935` | 10 | 7 | **7,723** | 1,475 | 63,115 | 295,376 | $0.0188 | 55.3s | ✅ |
| **RW-03** | Without AICE | `cc07327f-3b20-4c95-8f3e-bceabf19368e` | `940935` | 54 | 51 | **45,388** | 11,640 | 256,395 | 2,540,133 | $0.1293 | 181.2s | ✅ |
| **RW-03** | AICE No Idioms | `ec6e4c2b-db67-4c49-ab4d-60dc071dbb9c` | `940935` | 12 | 9 | **17,786** | 3,955 | 77,238 | 423,796 | $0.0264 | 61.8s | ✅ |
| **RW-03** | AICE With Idioms | `e86266e1-ed95-4533-bdbb-27d2aa64604a` | `940935` | 10 | 7 | **11,055** | 2,031 | 62,409 | 315,134 | $0.0198 | 50.1s | ✅ |
| **RW-04** | Without AICE | `e53592f4-cfc5-48c0-9bf9-4d3e03ddf29f` | `940935` | 37 | 34 | **47,962** | 15,743 | 200,603 | 1,616,602 | $0.0903 | 163.5s | ✅ |
| **RW-04** | AICE No Idioms | `e355b6a3-e371-4835-8797-d959f35aae42` | `940935` | 10 | 7 | **16,989** | 4,712 | 65,916 | 339,111 | $0.0223 | 63.5s | ✅ |
| **RW-04** | AICE With Idioms | `322f34d3-dbbd-475b-b26c-2ef7f72b251f` | `940935` | 10 | 7 | **10,199** | 2,161 | 59,087 | 307,703 | $0.0192 | 46.6s | ✅ |
| **RW-05** | Without AICE | `e0ce5b82-cd3f-4205-a407-f9687a74cab4` | `940935` | 19 | 16 | **28,982** | 9,977 | 111,016 | 693,551 | $0.0430 | 90.6s | ✅ |
| **RW-05** | AICE No Idioms | `8b2c0626-0541-4353-8cf5-2f251f35d42d` | `940935` | 10 | 7 | **13,244** | 2,946 | 69,767 | 322,517 | $0.0213 | 50.6s | ✅ |
| **RW-05** | AICE With Idioms | `8645116f-7739-45c1-8466-0e8f5237e12a` | `940935` | 12 | 9 | **9,803** | 1,477 | 69,760 | 367,176 | $0.0223 | 52.1s | ✅ |
| **RW-06** | Without AICE | `7ac5aa57-cd4e-496b-a9e8-2ab0b71cde29` | `940935` | 26 | 34 | **38,380** | 11,339 | 192,861 | 1,108,042 | $0.0684 | 106.8s | ✅ |
| **RW-06** | AICE No Idioms | `201c6692-56fa-4422-824e-0003df5d6729` | `940935` | 9 | 6 | **12,758** | 3,206 | 64,416 | 288,657 | $0.0195 | 47.7s | ✅ |
| **RW-06** | AICE With Idioms | `58a3e2d9-fd6a-47f9-b9f6-dc3dfc0bc093` | `940935` | 10 | 7 | **8,817** | 1,598 | 65,044 | 301,411 | $0.0193 | 48.7s | ✅ |
| **RW-07** | Without AICE | `20a36479-b26f-4e8a-8f6e-07106c2e165e` | `940935` | 19 | 20 | **19,044** | 5,217 | 145,382 | 690,795 | $0.0446 | 64.4s | ✅ |
| **RW-07** | AICE No Idioms | `2295f431-8333-47dc-92fd-1460b1edc022` | `940935` | 10 | 7 | **14,172** | 3,549 | 70,556 | 327,401 | $0.0218 | 50.2s | ✅ |
| **RW-07** | AICE With Idioms | `021e3e81-d58a-4049-beee-27eab1847de6` | `940935` | 14 | 11 | **11,868** | 1,598 | 83,135 | 445,701 | $0.0268 | 66.9s | ✅ |
| **RW-08** | Without AICE | `9cb2632f-831b-4a31-9052-ea19643ab412` | `940935` | 42 | 39 | **32,453** | 10,691 | 201,745 | 1,582,782 | $0.0869 | 233.1s | ✅ |
| **RW-08** | AICE No Idioms | `64ca5567-a4e4-430d-ac5b-160ec653c3d1` | `940935` | 9 | 6 | **13,281** | 3,553 | 69,067 | 293,324 | $0.0204 | 45.3s | ✅ |
| **RW-08** | AICE With Idioms | `4542de48-ac27-4cd6-a35f-ecdcaee241ca` | `940935` | 9 | 6 | **6,973** | 1,453 | 58,051 | 265,902 | $0.0172 | 42.4s | ✅ |
| **RW-09** | Without AICE | `f58255e0-2f0a-4309-b6bc-8d9d0e39686c` | `940935` | 34 | 42 | **37,681** | 8,774 | 171,969 | 1,493,580 | $0.0793 | 121.9s | ✅ |
| **RW-09** | AICE No Idioms | `ba382d12-4449-4691-b880-f6e66281c25d` | `940935` | 9 | 6 | **14,245** | 4,068 | 64,851 | 301,372 | $0.0204 | 48.1s | ✅ |
| **RW-09** | AICE With Idioms | `0a3fd367-ab4e-4c5c-a60c-8b2fa58cca4c` | `940935` | 10 | 7 | **10,093** | 1,691 | 44,562 | 313,597 | $0.0175 | 51.9s | ✅ |
| **RW-10** | Without AICE | `2a8eccb9-e08f-4a80-977e-de00ea2ffe58` | `940935` | 33 | 49 | **67,650** | 24,147 | 253,098 | 1,942,360 | $0.1122 | 158.0s | ✅ |
| **RW-10** | AICE No Idioms | `a52eedf6-2bc0-4520-a14c-ba1f1703dc8a` | `940935` | 13 | 10 | **28,455** | 8,658 | 92,107 | 536,760 | $0.0344 | 72.9s | ✅ |
| **RW-10** | AICE With Idioms | `d6601aa3-445b-414e-8240-6d3f9a87b9d1` | `940935` | 14 | 11 | **19,809** | 3,525 | 92,058 | 540,613 | $0.0322 | 67.1s | ✅ |
| **RW-11** | Without AICE | `9967cb58-b177-4563-b348-0177932b8040` | `940935` | 18 | 15 | **8,018** | 1,599 | 92,100 | 511,105 | $0.0302 | 53.7s | ✅ |
| **RW-11** | AICE No Idioms | `86b8aa8d-f83b-4362-b01b-b9a77aed9b89` | `940935` | 9 | 6 | **3,145** | 510 | 56,623 | 235,824 | $0.0154 | 42.1s | ✅ |
| **RW-11** | AICE With Idioms | `c85e35c2-50d0-434f-b5c7-6a8971e9730c` | `940935` | 9 | 6 | **3,350** | 529 | 56,747 | 235,946 | $0.0155 | 42.6s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

| ID | Scenario | Offline Token Savings (Pure AICE / +Idioms) | Real Agent Working Token Savings (Pure AICE / +Idioms) | Real Agent API Cost Savings (Pure AICE / +Idioms) | Real Agent Turn Savings (Pure AICE / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -44.8% / **-74.1%** | -53.4% / **-79.7%** | -75.0% / **-81.4%** | -75.6% / **-78.0%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -37.0% / **-69.0%** | -52.5% / **-68.4%** | -56.2% / **-60.6%** | -56.5% / **-56.5%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -43.3% / **-72.2%** | -60.8% / **-75.6%** | -79.6% / **-84.7%** | -77.8% / **-81.5%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -40.1% / **-70.4%** | -64.6% / **-78.7%** | -75.3% / **-78.8%** | -73.0% / **-73.0%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -42.2% / **-70.8%** | -54.3% / **-66.2%** | -50.5% / **-48.2%** | -47.4% / **-36.8%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -43.5% / **-72.7%** | -66.8% / **-77.0%** | -71.5% / **-71.7%** | -65.4% / **-61.5%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -38.8% / **-70.1%** | -25.6% / **-37.7%** | -51.1% / **-40.0%** | -47.4% / **-26.3%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -39.5% / **-70.4%** | -59.1% / **-78.5%** | -76.5% / **-80.3%** | -78.6% / **-78.6%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -41.5% / **-71.4%** | -62.2% / **-73.2%** | -74.2% / **-77.9%** | -73.5% / **-70.6%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -42.6% / **-72.0%** | -57.9% / **-70.7%** | -69.3% / **-71.3%** | -60.6% / **-57.6%** |
| **RW-11** | Hostile 1-File, 0-Idiom Surgical Bug-Fix (`ledger_reconciler.ts` Lone Needle) | *(Live-only adversarial gate)* | **-60.8%** / -58.2% | **-48.9%** / -48.9% | **-50.0%** / -50.0% |

## 6. Architectural Analysis: Why AICE Wins 11/11 Cold-Start, 0-Idiom & Decoy-Minefield Workspaces

### A. Adversarial Hostile-to-AICE Design (Zero Coaching, Zero Pre-Baked Idioms, Zero Positional Shortcuts)
- **Cold-Start Opt-In Idiom Discovery Paid In-Session**: `setupWorkspace` writes zero `aice.config.json` files, and project `$idioms` default to `"idiomsEnabled": false` so Pure AICE never pays `$idiom` legend overhead on 0-idiom code. The `aice_with_idioms` agent explicitly opts into cold-start AST mining during its live session (`--idioms` / `aice idioms scan --save`), paying full discovery cost in-session and still winning **11/11 scenarios** (`RW-01`..`RW-11`).
- **Non-First Seeded Targets + Decoy Sentinels**: Target declarations are procedurally selected at non-first indices (`targetIdx >= 1`) and identified only by their domain parameters/attributes, while every code file contains a seeded `verifyDecoySentinel_<hex>` function and `DECOY_SENTINEL_<hex>` comment that fail verification if altered.
- **Hostile 1-File, 0-Idiom "Lone Needle" (`RW-11`)**: Even when stripped of multi-file batching (1 file) and repeating idioms (`0` idioms discovered), Pure AICE (`aice_no_idioms`) beats `Without AICE` across turns (`-50.0%`), tool calls (`-60.0%`), working payload tokens (`-60.8%`), LLM output tokens (`-68.1%`), and real API cost (`-48.9%`).

### B. Why AICE On-the-Fly WITH Opt-In Idioms (`aice_with_idioms`) Wins 11/11 Scenarios & Suite Aggregate
1. **Opt-In Cold-Start AST Mining + Compact Context Pack (`aice read . -s "*" --idioms` / `aice idioms scan --save`)**: In 1 turn, AICE mines repetitive AST patterns across all 15 languages, lists every file's symbol headers (`// symbols:`), and collapses repeating AST blocks into 1-line `$idiom(...)` calls (`-72.6%` working payload tokens and `-84.3%` LLM output tokens across `RW-01`..`RW-10`).
2. **O(1) AST-Safe Pattern Refactoring (`aice splice --idioms --stdin`)**: Updating mined `$guard`, `$tsx_kpi_tile`, `$css_card`, `$html_metric_row`, `$twig_summary_line`, `$rec_id`, and `$rec_worker` templates re-emits all matching AST call sites across the workspace while leaving `verifyDecoySentinel_*` functions 100% untouched (`-73.5%` real API dollar cost and `-76.0%` total context tokens).

### C. Why Pure AICE WITHOUT Idioms (`aice_no_idioms`, Default Mode) Wins 11/11 — and When to Opt Into `--idioms`
- **Default Zero-Idiom-Overhead Mode (`11/11` wins across `RW-01`..`RW-11`)**: With `"idiomsEnabled": false` by default, `aice read` and `aice splice` beat `Without AICE` across `RW-01`..`RW-10` in **LLM Turns (`328 -> 102`, `-68.9%`)**, **Working Payload Tokens (`381,115 -> 160,793`, `-57.8%`)**, **LLM Output Tokens (`118,005 -> 43,780`, `-62.9%`)**, **Real API Dollar Cost (`$0.7960 -> $0.2309`, `-71.0%`)**, and **Total API Context Tokens (`14,240,183 -> 3,490,537`, `-75.5%`)**, while achieving optimal **3,145 working tokens (`-60.8%`)** on 0-idiom `RW-11`.
- **When Opt-In `--idioms` Cuts Output Tokens Further**: On multi-file boilerplate refactors (`RW-01`..`RW-10`), opting into `--idioms` / `"idiomsEnabled": true` cuts LLM output tokens by an additional **`-57.5%`** (`43,780 -> 18,585`) and working payload tokens by **`-35.1%`** (`160,793 -> 104,277`).

---

## 7. Real-World Prompt, 1-Turn Read & Turn-Amplification Amortization Invariants

Controlled benchmarks (`RW-01`..`RW-11`) measure working and API tokens on isolated tasks, whereas production workspaces also face **workspace rule injection**, **multi-turn `:symbol` $\to$ `:Lstart-Lend` line-hunting loops** (where every extra read turn replays the entire session context window), **narrow search peepholes**, **arbitrary bare-file outline cutoffs**, and **CLI/IDE stdout truncation**. AICE enforces architectural invariants across the read engine, CLI/MCP surface, and telemetry analyzer so short 1–3 turn maintenance sessions settle in **1 read turn + 1 splice turn** with zero hidden context-replay tax:

| Real-World Overhead / Turn-Amplification Vector | Legacy / Naive Behavior | AICE Architectural Invariant | Net Token, Turn & Break-Even Impact |
| :--- | :--- | :--- | :--- |
| **1. Workspace System-Prompt Footprint (`<user_rules>`)** | Injecting verbose ~3,550-token rules into `AGENTS.md` + `GEMINI.md` + `.agents/rules/aice.md` caused CLI harnesses to load **3x copies (`~10,650` tokens)** on turn 1. | **Single-File `<= 650`-Token `AGENTS.md`**: `syncProjectWorkspaceRules` writes ONLY `AGENTS.md` (`+` existing `CLAUDE.md` lacking `@AGENTS.md`), auto-purges `GEMINI.md` / `.GEMINI.md` blocks & `.agents/rules/aice.md`, honors `"enabled": false` in `bump-version.ts`, and exempts non-coding/Q&A & board-only swarm monitors. | **`-93.9%+` fixed prompt overhead** (`~10,650` $\to$ `<= 650` BPE tokens across `cl100k_base` & `o200k_base`); break-even drops to **1–2 tool calls** (`0` overhead on disabled/monitor sessions). |
| **2. 2-Turn `:symbol` $\to$ `:Lstart-Lend` Line Hunting (`aice read`)** | Decompiling `<= 25`-line `:symbol` bodies or inline bare files into unnumbered shorthand forced agents to run a second `:Lstart-Lend` read just to get exact native text/line numbers for `aice splice`. | **Default 1-Turn Numbered Native `aice read` (`--dsl` Opt-In)**: `aice read` (and MCP `aice_read`) emits **exact 1-based disk-numbered native source lines** (`<lineNo>│ <rawDiskLine>`) by default (`rawNative: true`) on **both** `:symbol` (all lengths, `<= 25L` & `> 25L`, preserving Adaptive Sibling Outlining, contracts, and `[L14]` callers) and inline bare files; `--dsl` (`dsl: true` in MCP) opts into AICE shorthand decompilation. | **Eliminates 2nd-turn line hunting**: agents execute `aice splice` (`<<< === >>>` or `:Lstart-Lend`) in **1 turn**, saving `1x` full session context replay per edit. |
| **3. Static `250L` Bare-File Cutoff, `150L` Slices & `46,080 B` Spillover** | Hardcoding `> 250`-line auto-outlines and unaligned slice hints forced extra paginated reads, split functions mid-body, and triggered CLI/MCP `~10 KB` host pipe middle-truncation or `46,080 B` spillover files. | **Aligned `9 KB` Anti-Spill Budget, Coalescing & Elision-Aware Slices**: `resolveEffectiveReadBudgets()` / `computeDynamicReadBudget()` enforces an aligned **`9,216 B` (`9 KB`) CLI & MCP ceiling** (`8,704 B` soft cap, `5,000`-token cap, input-order water-filling + **partial `9 KB` budget fill** + **same-file space-separated multi-range coalescing**; `28,672 B` / `7,000`-token programmatic fallback), while `computeDynamicSliceSpan()` uses a **`6,912 B` (`6.75 KB`) CLI/MCP slice budget** clamped to **`80..180` elision-aware lines** (`> 110L` blank/divider/import elision, `> 120L` Monolith X-Ray, `:sym@pattern` focus; `18,432 B` / `80..650L` programmatic fallback). | **0 host middle-truncations** + **1-turn settlement** on `<= 9 KB` modules + **partial `9 KB` fill & 0 mid-function pagination cuts**. |
| **4. 5-Line (`±2`) Search Peepholes, Monolith Bloat & Discovery Friction** | `±2`-line search snippets hid surrounding control flow, monolith matches dumped `200+` unrelated lines, `/.../` wrappers & MCP-style CLI flags caused retry turns, and AST outlining was overkill when listing file paths. | **AST-Aware + `> 65L` Monolith Focus Search + `aice search`/`find` + Flag Normalization**: Tier 1 & 2 search hits expand to **complete enclosing AST declarations (`<= 40` lines)**, **`±10` numbered native lines** (`41..65L`), or **Monolith Focus Sub-Windows (`> 65L`: signature + `±5L` match windows)** within the **`9 KB` CLI/MCP ceiling** (`28 KB` programmatic fallback). CLI adds `aice search` (`grep`), `< 20ms` zero-AST `aice find` (`tree`), and automatic **MCP-to-CLI flag normalization** (`--filesOnly`, `--contextLines=N`, `=true`/`=false`), while MCP strictly keeps **2 tools** (`aice_read` + `aice_splice`). | **1-turn actionable search (`60%–85%` leaner on monoliths)** + **`< 20ms` discovery** + **zero CLI flag retry turns**. |
| **5. Hidden Turn-Amplification & Telemetry Honesty (`aice gain` & `aice analyze`)** | Positive per-call stdout token deltas could mask session-level context replay costs when an agent read the same file multiple times in consecutive turns before splicing. | **Signed `< 250 B` Ledger + `Repeat-Read Turn Warnings` + `readLoopAudit`**: Zero `Math.max(0, ...)` clamping, realistic slice/search baselines, `Rule Overhead Break-Even`, `< 90s` same-`(projectRoot, filePath)` `repeatReadCalls` / **`Repeat-Read Turn Warnings`** in `aice gain`, and **`readLoopAudit`** in `aice analyze` (capturing `read`/`write`/`search`/`grep`/`find`/`tree` to compute `readTurns`, `totalTurns`, `readTurnRatioPct`, `maxConsecutiveReadStreak`, `sameFileRepeatReadChains`, and **Context Replay Token Tax** = `extraReadTurns * avgSessionContextTokens`). | **100% auditable session & per-call ROI**: surfaces both BPE stdout savings and multi-turn context-replay taxes transparently. |

---

## 8. Live Multi-Worker Production Telemetry (`aipl_dog`, 923 Calls / 633 Planner Turns, v0.9.47–v0.9.49)

Beyond controlled lab benchmarks (`RW-01`..`RW-11`), AICE was audited continuously across **`13` autonomous workers** executing **`923` real tool calls** over **`633` AI planner turns** on the multi-thousand-line `aipl_dog` codebase, priced using real symmetric end-to-end LLM quota weights (**`1x`** new uncached input, **`0.1x`** cached history replay, **`4x`** generation output).

### 8.1 Full Billable Quota Scorecard (`v0.9.47–v0.9.48` vs. `v0.9.49+`)

| Metric | `v0.9.47 – v0.9.48` (880 calls / 543 turns) | `v0.9.49+` (43 calls / 90 turns — Zero-Friction Engine) | End-to-End Quota & Reliability Impact |
| :--- | :---: | :---: | :--- |
| **Read / Search Payload vs Native Baseline** | `1.61M` vs `~2.82M` (`-43%`) | **`49K` vs `~111K` (`-56%`)** | Smaller initial reads stay out of cached history across ~23 subsequent turns (`0.1x` replay leverage). |
| **Edit Output Tokens (`aice splice` vs `edit_file`)** | `110K` vs `196K` (`-44%`) | **`11.4K` vs `21.4K` (`-47%`)** | Eliminates repeated `Target` blocks on **`4x`-weighted** generation output tokens. |
| **Broken Files Written to Disk** | **`0` / 72 edits** | **`0` / 12 edits** | Pre-write syntax validation & inclusive `:L` guard caught **`11`** broken edits before disk write. |
| **Extra `9 KB` Pagination / Retry Turns** | `28` slice + `19` retry turns (`47` wasted) | **`0` wasted turns** | Same-file coalescing, partial `9 KB` fill & MCP-to-CLI flag normalization eliminated extra replay turns. |
| **Average Context Window Size** | `196K` tok / turn | **`119K` tok / turn (`-39%`)** | Keeps workers ~35% longer below the `200K` compaction wall. |
| **Real Net End-to-End Quota Saved** | **`+5% to +11%` Net** | **`+17% to +25%` Net** | Honest bottom-line savings after subtracting all 4 AICE taxes below. |

### 8.2 Full Billable Quota Ledger — Accounting for All 4 AICE Taxes

To avoid overstated "raw byte savings", the production ledger deducts **all four real-world AICE overhead taxes** from gross read and splice gains:

1. **Tax 1 — Rule Card Overhead (`AGENTS.md`)**: Injecting `MANDATORY_AGENT_RULES_MARKDOWN` (`<= 650` BPE tokens across `cl100k_base` & `o200k_base`) costs `1x` input once on turn 1 and `0.1x` cached replay across subsequent turns (still `-94%` vs legacy 3-file injection).
2. **Tax 2 — CLI Wrapper & Structural Envelope Overhead**: Numbered gutters (`N│ `), `// === <file> ===` headers, sibling outlines, and `Next slice:` footers add slight byte overhead on small targeted reads (`1x` input + `0.1x` replay across ~23 subsequent turns).
3. **Tax 3 — Extra `9 KB` Pagination Turns (`28` turns in `v0.9.47–v0.9.48` -> `0` in `v0.9.49+`)**: Splitting space-separated same-file `:L` ranges across separate headers or dropping near-fitting targets into outline-only mode forced follow-up slice turns, each replaying `0.1x * ~196K` (`~19.6K` billable-equivalent tokens per wasted turn).
4. **Tax 4 — Retry Turns (`19` turns in `v0.9.47–v0.9.48` -> `0` in `v0.9.49+`)**: Agents passing MCP-style flags to bash CLI calls (`--files-only=true`, `--context-lines=5`) or writing Python-style half-open `[start, end)` `:L` replacements incurred extra error-recovery turns (`1x` error diagnostic + `0.1x` full history replay + `4x` regenerated call).

### 8.3 Why Eliminating Extra Turns in `v0.9.49` Raised Net Savings from `+5%–11%` to `+17%–25%`

Because every wasted turn replays the entire active conversation window (`~119K–196K` tokens at `0.1x` cached input weight, or `~12K–20K` equivalent `1x` tokens per turn), **47 wasted turns** in `v0.9.47–v0.9.48` offset roughly half of AICE's raw `-43%` read and `-44%` splice output savings — leaving **`+5% to +11%`** real net savings.

Four targeted zero-friction upgrades across `v0.9.48–v0.9.49` eliminated those extra turns completely (**`0` wasted slice or retry turns** in `v0.9.49+`):
- **MCP-to-CLI Flag Normalization (`v0.9.48`, `bin/aice.ts`)**: Translates camelCase/kebab/boolean-suffix MCP flags passed to CLI (`--files-only=true`, `--context-lines=5`, `--include-deps=false`, etc.) instead of failing with `unknown option`.
- **Same-File Space-Separated Multi-Range Coalescing + Partial `9 KB` Budget Fill (`v0.9.49`, `src/tools/read.ts`)**: Merges adjacent same-file selectors and emits as many numbered lines as fit in remaining `9 KB` headroom (`>= 1,500 B`) with an exact continuation hint instead of wasting turn 1 on a bare outline.
- **`> 65L` Monolith Search Focus (`v0.9.49`, `src/tools/context.ts`)**: Groups pattern matches inside giant `> 65L` declarations into header + merged `±5L` sub-windows so searches settle in 1 turn without spilling the `9 KB` ceiling or needing follow-up slices.
- **Half-Open `[start, end)` `:L` Splice Guard (`v0.9.49`, `src/tools/splice.ts`)**: Catches accidental `[start, end)` line-count mismatches before disk write with a 1-shot inclusive remediation hint, preventing silent line deletions while maintaining **`0` broken disk writes across all `84` production edits (`11` catches)**.

With zero pagination/retry replay drag and `-56%` leaner reads keeping average context windows down at **`119K` tok/turn (`-39%`)**, bottom-line billable quota savings jumped cleanly to **`+17% to +25%` Net**.
