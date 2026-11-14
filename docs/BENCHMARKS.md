# AICE 2.0 — Real AI Agent Benchmark Suite Report (Adversarial Cold-Start Scenarios — Without & With Idioms)

> **Ground-Truth Adversarial Real AI Agent Proof**: Every number in this report comes from **real autonomous AI agent (`agy -p`) executions** running against **cold-start, procedurally seeded, decoy-minefielded workspaces** on disk under **blind issue prompts** (zero symbol name leakage, zero positional `@first` shortcuts, zero pre-baked `aice.config.json`) and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.
> For the deterministic offline BPE (`o200k_base`) benchmark suite, see **[`docs/BENCHMARKS_OFFLINE.md`](./BENCHMARKS_OFFLINE.md)** (`npm run benchmark:offline`).

## 1. Executive Summary: 4 Bulletproof Metrics (Real AI Agents vs Deterministic Offline Suite)

| Metric (Across All 10 Multi-File Scenarios `RW-01` .. `RW-10`) | Without AICE (Native Tools) | AICE Without Idioms (Pure AICE) | AICE With Idioms (Cold-Start `$idiom` Scan + Splice) | AICE Win Rate |
| :--- | :---: | :---: | :---: | :---: |
| **1. Real Agent LLM Output Tokens** (`output_tokens`, 4x API cost weight) | 95,013 | **64,922 (-31.7%)** | **36,053 (-62.0%)** | Pure 8/10 | **+Idioms 10/10 (100%)** |
| **2. Real Agent Working Payload Tokens** (Tool In/Out + LLM Out) | 332,938 | **251,981 (-24.3%)** | **249,712 (-25.0%)** | Pure 8/10 | **+Idioms 8/10 (80%)** |
| **3. Real API Dollar Cost (USD)** (`$0.15/1M in, $0.0375/1M cache, $0.60/1M out`) | $0.9502 | **$0.7662 (-19.4%)** | **$0.7604 (-20.0%)** | Pure 8/10 | **+Idioms 7/10 (70%)** |
| **4. Real Agent Total API Context Tokens** (`input + cache + output`) | 18,552,951 | **15,066,012 (-18.8%)** | **15,500,278 (-16.4%)** | Pure 8/10 | **+Idioms 7/10 (70%)** |
| **Real Agent Billable API Tokens** (`input + output`) | 1,882,196 | **1,528,907 (-18.8%)** | **1,448,480 (-23.0%)** | Pure 7/10 | **+Idioms 8/10 (80%)** |
| **Real Agent LLM Turns** (`PLANNER_RESPONSE`) | 345 turns | **268 turns (-22.3%)** | **276 turns (-20.0%)** | Pure 8/10 | **+Idioms 7/10 (70%)** |
| **Real Agent Tool Calls** (`tool_calls`) | 359 calls | **238 calls (-33.7%)** | **246 calls (-31.5%)** | Pure 8/10 | **+Idioms 7/10 (70%)** |
| **Real Agent Wall-Clock Duration** | 2151.8s | **2128.9s** | **1880.1s** | Pure 7/10 | **+Idioms 7/10 (70%)** |
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
| **RW-01** | **HTML5 Canvas Arcade Snake Window Application (Greenfield from 0)**<br/>`ts, html, css, json` (5 files) | 26 / **14** (-46%) / **12** (-54%) | 27,716 / **19,058** (-31.2%) / **14,248** (-48.6%) | 7,731 / **5,189** (-32.9%) / **2,305** (-70.2%) | $0.0654 / **$0.0371** (-43.3%) / **$0.0292** (-55.4%) | 1,231,582 / **642,053** (-47.9%) / **509,138** (-58.7%) | ✅ 100% |
| **RW-02** | **Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0)**<br/>`py, yaml, json` (4 files) | 36 / **13** (-64%) / **25** (-31%) | 33,294 / **14,941** (-55.1%) / **23,499** (-29.4%) | 8,926 / **3,855** (-56.8%) / **2,716** (-69.6%) | $0.0915 / **$0.0313** (-65.8%) / **$0.0608** (-33.5%) | 1,847,203 / **607,243** (-67.1%) / **1,250,416** (-32.3%) | ✅ 100% |
| **RW-03** | **Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix)**<br/>`php, js, twig, css, html, yaml, json` (7 files) | 63 / **54** (-14%) / **53** (-16%) | 54,160 / **38,750** (-28.4%) / **37,936** (-30.0%) | 14,925 / **7,988** (-46.5%) / **6,461** (-56.7%) | $0.1917 / **$0.1502** (-21.6%) / **$0.1529** (-20.3%) | 3,918,616 / **3,040,608** (-22.4%) / **3,161,472** (-19.3%) | ✅ 100% |
| **RW-04** | **Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature)**<br/>`ts, tsx, css, html, json, yaml` (6 files) | 30 / **12** (-60%) / **12** (-60%) | 33,100 / **16,459** (-50.3%) / **13,179** (-60.2%) | 9,281 / **5,382** (-42.0%) / **2,176** (-76.5%) | $0.0763 / **$0.0371** (-51.4%) / **$0.0304** (-60.2%) | 1,443,518 / **598,454** (-58.5%) / **529,750** (-63.3%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-05** | **Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature)**<br/>`go, rs, yaml, json` (4 files) | 42 / **12** (-71%) / **18** (-57%) | 43,661 / **13,858** (-68.3%) / **16,055** (-63.2%) | 11,916 / **3,604** (-69.8%) / **2,288** (-80.8%) | $0.1363 / **$0.0315** (-76.9%) / **$0.0413** (-69.7%) | 2,579,897 / **536,217** (-79.2%) / **776,362** (-69.9%) | ✅ 100% |
| **RW-06** | **C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix)**<br/>`cpp, ts, html, css, json` (5 files) | 23 / **41** (+78%) / **25** (+9%) | 17,865 / **28,028** (+56.9%) / **23,885** (+33.7%) | 5,586 / **7,142** (+27.9%) / **3,169** (-43.3%) | $0.0535 / **$0.1056** (+97.4%) / **$0.0604** (+12.8%) | 972,664 / **2,099,841** (+115.9%) / **1,184,826** (+21.8%) | ✅ 100% |
| **RW-07** | **C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature)**<br/>`cs, kt, yaml, json` (4 files) | 41 / **16** (-61%) / **18** (-56%) | 31,000 / **18,746** (-39.5%) / **17,376** (-44.0%) | 6,893 / **4,985** (-27.7%) / **2,516** (-63.5%) | $0.1122 / **$0.0441** (-60.7%) / **$0.0433** (-61.4%) | 2,278,474 / **781,032** (-65.7%) / **795,020** (-65.1%) | ✅ 100% |
| **RW-08** | **Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature)**<br/>`py, tsx, twig, css, json, yaml` (6 files) | 23 / **12** (-48%) / **19** (-17%) | 21,331 / **14,836** (-30.4%) / **19,141** (-10.3%) | 5,866 / **4,426** (-24.6%) / **2,635** (-55.1%) | $0.0559 / **$0.0386** (-31.0%) / **$0.0469** (-16.1%) | 1,036,467 / **571,667** (-44.8%) / **889,341** (-14.2%) | ✅ 100% |
| **RW-09** | **High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix)**<br/>`rs, cpp, py, go, yaml, json` (6 files) | 32 / **26** (-19%) / **33** (+3%) | 29,874 / **23,819** (-20.3%) / **29,822** (-0.2%) | 9,106 / **6,272** (-31.1%) / **3,444** (-62.2%) | $0.0820 / **$0.0723** (-11.8%) / **$0.0920** (+12.3%) | 1,548,847 / **1,429,816** (-7.7%) / **1,878,306** (+21.3%) | ✅ AICE 2/2 (Base ⚠️) |
| **RW-10** | **Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature)**<br/>`ts, tsx, js, py, go, rs, cpp, cs, kt, php, css, html, json, yaml, twig` (15 files) | 29 / **68** (+134%) / **61** (+110%) | 40,937 / **63,486** (+55.1%) / **54,571** (+33.3%) | 14,783 / **16,079** (+8.8%) / **8,343** (-43.6%) | $0.0853 / **$0.2183** (+155.9%) / **$0.2032** (+138.2%) | 1,695,683 / **4,759,081** (+180.7%) / **4,525,647** (+166.9%) | ✅ AICE 2/2 (Base ⚠️) |
| **TOTAL (`RW-01..10`)** | **All 10 Multi-File Scenarios (15/15 Languages)** | **345** / **268** (-22.3%) / **276** (-20.0%) | **332,938** / **251,981** (-24.3%) / **249,712** (-25.0%) | **95,013** / **64,922** (-31.7%) / **36,053** (-62.0%) | **$0.9502** / **$0.7662** (-19.4%) / **$0.7604** (-20.0%) | **18,552,951** / **15,066,012** (-18.8%) / **15,500,278** (-16.4%) | ✅ **27/30 (AICE 20/20)** |
| **RW-11 (Hostile 0-Idiom)** | **Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)**<br/>`ts` (1 file, **0 idioms**) | 17 / **26** (+53%) / **12** (-29%) | 6,191 / **10,369** (+67.5%) / **4,582** (-26.0%) | 1,348 / **2,286** (+69.6%) / **906** (-32.8%) | $0.0359 / **$0.0542** (+51.1%) / **$0.0262** (-27.1%) | 623,264 / **1,001,837** (+60.7%) / **431,679** (-30.7%) | ✅ 100% |

### 3b. 3-Layer Progressive Lifecycle Breakdown (Live Telemetry)

| Scenario | Mode | L1 Baseline | L2 Feature Add | L3 Cross-Cutting | Total Turns | Working Tokens | LLM Output Tokens | Real Cost (USD) | Status |
| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | `without_aice` | 11t / $0.0274 / ✅ | 7t / $0.0172 / ✅ | 8t / $0.0208 / ✅ | **26** | **27,716** | **7,731** | **$0.0654** | ✅ 100% |
| **RW-01** | **`aice_no_idioms`** | 6t / $0.0167 / ✅ | 4t / $0.0097 / ✅ | 4t / $0.0107 / ✅ | **14** | **19,058** | **5,189** | **$0.0371** | ✅ 100% |
| **RW-01** | **`aice_with_idioms`** | 4t / $0.0110 / ✅ | 4t / $0.0087 / ✅ | 4t / $0.0094 / ✅ | **12** | **14,248** | **2,305** | **$0.0292** | ✅ 100% |
| **RW-02** | `without_aice` | 8t / $0.0175 / ✅ | 21t / $0.0521 / ✅ | 7t / $0.0219 / ✅ | **36** | **33,294** | **8,926** | **$0.0915** | ✅ 100% |
| **RW-02** | **`aice_no_idioms`** | 5t / $0.0110 / ✅ | 4t / $0.0095 / ✅ | 4t / $0.0107 / ✅ | **13** | **14,941** | **3,855** | **$0.0313** | ✅ 100% |
| **RW-02** | **`aice_with_idioms`** | 4t / $0.0080 / ✅ | 17t / $0.0409 / ✅ | 4t / $0.0119 / ✅ | **25** | **23,499** | **2,716** | **$0.0608** | ✅ 100% |
| **RW-03** | `without_aice` | 17t / $0.0410 / ✅ | 37t / $0.1147 / ✅ | 9t / $0.0360 / ✅ | **63** | **54,160** | **14,925** | **$0.1917** | ✅ 100% |
| **RW-03** | **`aice_no_idioms`** | 24t / $0.0576 / ✅ | 23t / $0.0679 / ✅ | 7t / $0.0247 / ✅ | **54** | **38,750** | **7,988** | **$0.1502** | ✅ 100% |
| **RW-03** | **`aice_with_idioms`** | 4t / $0.0125 / ✅ | 45t / $0.1267 / ✅ | 4t / $0.0137 / ✅ | **53** | **37,936** | **6,461** | **$0.1529** | ✅ 100% |
| **RW-04** | `without_aice` | 16t / $0.0373 / ✅ | 14t / $0.0390 / ❌ | — | **30** | **33,100** | **9,281** | **$0.0763** | ⚠️ Partial |
| **RW-04** | **`aice_no_idioms`** | 4t / $0.0156 / ✅ | 4t / $0.0101 / ✅ | 4t / $0.0114 / ✅ | **12** | **16,459** | **5,382** | **$0.0371** | ✅ 100% |
| **RW-04** | **`aice_with_idioms`** | 4t / $0.0115 / ✅ | 4t / $0.0088 / ✅ | 4t / $0.0101 / ✅ | **12** | **13,179** | **2,176** | **$0.0304** | ✅ 100% |
| **RW-05** | `without_aice` | 11t / $0.0281 / ✅ | 27t / $0.0833 / ✅ | 4t / $0.0249 / ✅ | **42** | **43,661** | **11,916** | **$0.1363** | ✅ 100% |
| **RW-05** | **`aice_no_idioms`** | 4t / $0.0126 / ✅ | 4t / $0.0092 / ✅ | 4t / $0.0097 / ✅ | **12** | **13,858** | **3,604** | **$0.0315** | ✅ 100% |
| **RW-05** | **`aice_with_idioms`** | 4t / $0.0111 / ✅ | 9t / $0.0186 / ✅ | 5t / $0.0116 / ✅ | **18** | **16,055** | **2,288** | **$0.0413** | ✅ 100% |
| **RW-06** | `without_aice` | 14t / $0.0326 / ✅ | 5t / $0.0118 / ✅ | 4t / $0.0090 / ✅ | **23** | **17,865** | **5,586** | **$0.0535** | ✅ 100% |
| **RW-06** | **`aice_no_idioms`** | 5t / $0.0149 / ✅ | 30t / $0.0732 / ✅ | 6t / $0.0175 / ✅ | **41** | **28,028** | **7,142** | **$0.1056** | ✅ 100% |
| **RW-06** | **`aice_with_idioms`** | 4t / $0.0109 / ✅ | 16t / $0.0358 / ✅ | 5t / $0.0137 / ✅ | **25** | **23,885** | **3,169** | **$0.0604** | ✅ 100% |
| **RW-07** | `without_aice` | 11t / $0.0278 / ✅ | 20t / $0.0545 / ✅ | 10t / $0.0300 / ✅ | **41** | **31,000** | **6,893** | **$0.1122** | ✅ 100% |
| **RW-07** | **`aice_no_idioms`** | 4t / $0.0134 / ✅ | 8t / $0.0188 / ✅ | 4t / $0.0118 / ✅ | **16** | **18,746** | **4,985** | **$0.0441** | ✅ 100% |
| **RW-07** | **`aice_with_idioms`** | 4t / $0.0113 / ✅ | 10t / $0.0220 / ✅ | 4t / $0.0100 / ✅ | **18** | **17,376** | **2,516** | **$0.0433** | ✅ 100% |
| **RW-08** | `without_aice` | 12t / $0.0296 / ✅ | 5t / $0.0115 / ✅ | 6t / $0.0149 / ✅ | **23** | **21,331** | **5,866** | **$0.0559** | ✅ 100% |
| **RW-08** | **`aice_no_idioms`** | 4t / $0.0134 / ✅ | 4t / $0.0147 / ✅ | 4t / $0.0106 / ✅ | **12** | **14,836** | **4,426** | **$0.0386** | ✅ 100% |
| **RW-08** | **`aice_with_idioms`** | 4t / $0.0114 / ✅ | 9t / $0.0203 / ✅ | 6t / $0.0153 / ✅ | **19** | **19,141** | **2,635** | **$0.0469** | ✅ 100% |
| **RW-09** | `without_aice` | 19t / $0.0459 / ✅ | 13t / $0.0360 / ❌ | — | **32** | **29,874** | **9,106** | **$0.0820** | ⚠️ Partial |
| **RW-09** | **`aice_no_idioms`** | 6t / $0.0180 / ✅ | 14t / $0.0366 / ✅ | 6t / $0.0177 / ✅ | **26** | **23,819** | **6,272** | **$0.0723** | ✅ 100% |
| **RW-09** | **`aice_with_idioms`** | 5t / $0.0138 / ✅ | 24t / $0.0646 / ✅ | 4t / $0.0136 / ✅ | **33** | **29,822** | **3,444** | **$0.0920** | ✅ 100% |
| **RW-10** | `without_aice` | 29t / $0.0853 / ❌ | — | — | **29** | **40,937** | **14,783** | **$0.0853** | ⚠️ Partial |
| **RW-10** | **`aice_no_idioms`** | 52t / $0.1545 / ✅ | 8t / $0.0312 / ✅ | 8t / $0.0326 / ✅ | **68** | **63,486** | **16,079** | **$0.2183** | ✅ 100% |
| **RW-10** | **`aice_with_idioms`** | 43t / $0.1263 / ✅ | 12t / $0.0501 / ✅ | 6t / $0.0268 / ✅ | **61** | **54,571** | **8,343** | **$0.2032** | ✅ 100% |
| **RW-11** | `without_aice` | 5t / $0.0126 / ✅ | 4t / $0.0073 / ✅ | 8t / $0.0160 / ✅ | **17** | **6,191** | **1,348** | **$0.0359** | ✅ 100% |
| **RW-11** | **`aice_no_idioms`** | 5t / $0.0126 / ✅ | 15t / $0.0288 / ✅ | 6t / $0.0128 / ✅ | **26** | **10,369** | **2,286** | **$0.0542** | ✅ 100% |
| **RW-11** | **`aice_with_idioms`** | 4t / $0.0110 / ✅ | 4t / $0.0070 / ✅ | 4t / $0.0081 / ✅ | **12** | **4,582** | **906** | **$0.0262** | ✅ 100% |

## 4. Ground-Truth Conversation ID Audit Trail (Real Agent Sessions)

Every run below corresponds to a real agent session whose `transcript.jsonl` log was recorded under `~/.gemini/antigravity-cli/brain/<conversationId>/.system_generated/logs/transcript.jsonl` and stored in [`benchmarks/real-agent-results.json`](../benchmarks/real-agent-results.json):

| Benchmark | Mode | Conversation ID (`brain/<id>`) | Seed | Turns | Tool Calls | Working Tokens | LLM Output Tokens | Billable Tokens (`in+out`) | Total API Tokens (`in+cache+out`) | API Cost (USD) | Duration | Verified & Decoys Intact |
| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |
| **RW-01** | Without AICE | `1a8cb3cd-94d0-4f6e-85fc-5d10ec376ed1` | `95281640` | 26 | 30 | **27,716** | 7,731 | 140,162 | 1,231,582 | $0.0654 | 122.8s | ✅ |
| **RW-01** | AICE No Idioms | `150bb704-63b9-4afa-95e7-b9511b7ceea1` | `95281640` | 14 | 11 | **19,058** | 5,189 | 95,214 | 642,053 | $0.0371 | 72.8s | ✅ |
| **RW-01** | AICE With Idioms | `38d6c6f7-fd0f-47aa-bfb1-8df182b6cae8` | `95281640` | 12 | 9 | **14,248** | 2,305 | 80,668 | 509,138 | $0.0292 | 70.2s | ✅ |
| **RW-02** | Without AICE | `c957b527-1d22-4b7b-99c3-f09fb9610399` | `47503689` | 36 | 38 | **33,294** | 8,926 | 161,794 | 1,847,203 | $0.0915 | 184.0s | ✅ |
| **RW-02** | AICE No Idioms | `93391b44-8568-4ce2-b4d7-e33cd52b047f` | `36559169` | 13 | 10 | **14,941** | 3,855 | 60,283 | 607,243 | $0.0313 | 92.3s | ✅ |
| **RW-02** | AICE With Idioms | `880317da-e831-44b3-b9e0-9a9a392afe27` | `47503689` | 25 | 22 | **23,499** | 2,716 | 112,693 | 1,250,416 | $0.0608 | 133.5s | ✅ |
| **RW-03** | Without AICE | `532c45d9-c5aa-41fa-b435-2845a2cfe3a1` | `47503689` | 63 | 60 | **54,160** | 14,925 | 338,045 | 3,918,616 | $0.1917 | 368.6s | ✅ |
| **RW-03** | AICE No Idioms | `cf0d8ac6-8224-4013-9547-bcc23d4a23d7` | `47503689` | 54 | 51 | **38,750** | 7,988 | 289,844 | 3,040,608 | $0.1502 | 316.1s | ✅ |
| **RW-03** | AICE With Idioms | `b9df0bae-6545-4314-9c9e-71156e50e574` | `47503689` | 53 | 50 | **37,936** | 6,461 | 279,207 | 3,161,472 | $0.1529 | 334.1s | ✅ |
| **RW-04** | Without AICE | `dabcd5e2-95f3-4060-bf19-62a29c9dcbf7` | `47503689` | 30 | 28 | **33,100** | 9,281 | 159,973 | 1,443,518 | $0.0763 | 169.3s | ❌ |
| **RW-04** | AICE No Idioms | `6666cf75-7ad0-48a0-90b2-5cbab345e6d3` | `47503689` | 12 | 9 | **16,459** | 5,382 | 108,537 | 598,454 | $0.0371 | 102.4s | ✅ |
| **RW-04** | AICE With Idioms | `b155b79c-2194-403e-b42d-92537e5364a0` | `47503689` | 12 | 9 | **13,179** | 2,176 | 84,890 | 529,750 | $0.0304 | 74.8s | ✅ |
| **RW-05** | Without AICE | `9ff93ad5-625b-4373-b408-f4f37c48cf25` | `47503689` | 42 | 51 | **43,661** | 11,916 | 304,267 | 2,579,897 | $0.1363 | 214.8s | ✅ |
| **RW-05** | AICE No Idioms | `58b0deb7-32da-4676-a2fe-e00a1cc03cc6` | `47503689` | 12 | 9 | **13,858** | 3,604 | 87,260 | 536,217 | $0.0315 | 79.2s | ✅ |
| **RW-05** | AICE With Idioms | `7e231375-ef38-4ec7-973b-218ab64dae21` | `47503689` | 18 | 15 | **16,055** | 2,288 | 99,412 | 776,362 | $0.0413 | 112.7s | ✅ |
| **RW-06** | Without AICE | `8d868b3c-7cdf-48da-80ec-99f40b7db759` | `47503689` | 23 | 20 | **17,865** | 5,586 | 129,097 | 972,664 | $0.0535 | 158.5s | ✅ |
| **RW-06** | AICE No Idioms | `32598939-9b7f-4534-b2f4-bd0508df58c4` | `47503689` | 41 | 38 | **28,028** | 7,142 | 210,580 | 2,099,841 | $0.1056 | 247.8s | ✅ |
| **RW-06** | AICE With Idioms | `6417e1c2-9371-45b4-9207-49e30baf31e6` | `47503689` | 25 | 22 | **23,885** | 3,169 | 128,973 | 1,184,826 | $0.0604 | 143.9s | ✅ |
| **RW-07** | Without AICE | `86fa304f-6cd9-489b-81ec-88881a2c7926` | `47503689` | 41 | 44 | **31,000** | 6,893 | 210,665 | 2,278,474 | $0.1122 | 198.5s | ✅ |
| **RW-07** | AICE No Idioms | `d6cdd86c-a85e-463a-9e37-7fafd4fc4280` | `47503689` | 16 | 13 | **18,746** | 4,985 | 111,749 | 781,032 | $0.0441 | 98.9s | ✅ |
| **RW-07** | AICE With Idioms | `28ac7fbe-cafc-4389-8dd6-46bb6651cbf7` | `47503689` | 18 | 15 | **17,376** | 2,516 | 109,838 | 795,020 | $0.0433 | 100.2s | ✅ |
| **RW-08** | Without AICE | `f9c18f2d-7fa7-4853-8345-1658cc011e9e` | `47503689` | 23 | 27 | **21,331** | 5,866 | 128,297 | 1,036,467 | $0.0559 | 321.3s | ✅ |
| **RW-08** | AICE No Idioms | `cc6e5538-fa99-4a01-965a-7eaf4f6df31f` | `47503689` | 12 | 9 | **14,836** | 4,426 | 134,852 | 571,667 | $0.0386 | 405.8s | ✅ |
| **RW-08** | AICE With Idioms | `f31aecfc-2c81-4add-b1e4-f7022d92f641` | `47503689` | 19 | 16 | **19,141** | 2,635 | 110,245 | 889,341 | $0.0469 | 130.4s | ✅ |
| **RW-09** | Without AICE | `a243d822-e1a8-45d1-bc56-75f856beaf1a` | `47503689` | 32 | 30 | **29,874** | 9,106 | 175,881 | 1,548,847 | $0.0820 | 172.6s | ❌ |
| **RW-09** | AICE No Idioms | `fc3e242e-eb1a-4363-b905-9b0ad60ff020` | `47503689` | 26 | 23 | **23,819** | 6,272 | 140,869 | 1,429,816 | $0.0723 | 146.8s | ✅ |
| **RW-09** | AICE With Idioms | `393834c5-c9c9-4c96-9a6a-9d3d894e86d8` | `47503689` | 33 | 30 | **29,822** | 3,444 | 178,180 | 1,878,306 | $0.0920 | 237.3s | ✅ |
| **RW-10** | Without AICE | `225872ba-5dee-4519-a88d-3d99d41cef9e` | `36559169` | 29 | 31 | **40,937** | 14,783 | 134,015 | 1,695,683 | $0.0853 | 241.3s | ❌ |
| **RW-10** | AICE No Idioms | `4ed5deee-49c2-456d-812f-4b660f659e45` | `36559169` | 68 | 65 | **63,486** | 16,079 | 289,719 | 4,759,081 | $0.2183 | 566.9s | ✅ |
| **RW-10** | AICE With Idioms | `de2d61d3-48a0-41da-837b-d363e881d063` | `36559169` | 61 | 58 | **54,571** | 8,343 | 264,374 | 4,525,647 | $0.2032 | 542.9s | ✅ |
| **RW-11** | Without AICE | `76a4e263-1a54-43c5-a7b5-95f0a2eff399` | `37863708` | 17 | 14 | **6,191** | 1,348 | 105,705 | 623,264 | $0.0359 | 63.0s | ✅ |
| **RW-11** | AICE No Idioms | `1cf7556f-63be-407e-82d6-aa00abdf458c` | `37863708` | 26 | 23 | **10,369** | 2,286 | 138,681 | 1,001,837 | $0.0542 | 116.0s | ✅ |
| **RW-11** | AICE With Idioms | `8d3fbeed-ac36-47c0-83c2-121ee749aee3` | `37863708` | 12 | 9 | **4,582** | 906 | 85,072 | 431,679 | $0.0262 | 54.0s | ✅ |

## 5. Comparison: Real AI Agent Execution vs Deterministic Offline Suite

| ID | Scenario | Offline Token Savings (Pure AICE / +Idioms) | Real Agent Working Token Savings (Pure AICE / +Idioms) | Real Agent API Cost Savings (Pure AICE / +Idioms) | Real Agent Turn Savings (Pure AICE / +Idioms) |
| :--- | :--- | :---: | :---: | :---: | :---: |
| **RW-01** | HTML5 Canvas Arcade Snake Window Application (Greenfield from 0) | -44.8% / **-74.1%** | -31.2% / **-48.6%** | -43.3% / **-55.4%** | -46.1% / **-53.9%** |
| **RW-02** | Headless Python CLI Task Queue & Telemetry Worker Daemon (Greenfield from 0) | -37.0% / **-69.0%** | -55.1% / **-29.4%** | -65.8% / **-33.5%** | -63.9% / **-30.6%** |
| **RW-03** | Symfony/PHP + JS + Twig + CSS + HTML + YAML + JSON Storefront Checkout (Bug Fix) | -43.3% / **-72.2%** | -28.4% / **-30.0%** | -21.6% / **-20.3%** | -14.3% / **-15.9%** |
| **RW-04** | Vite + TypeScript + React TSX + CSS + HTML + JSON + YAML Analytics Dashboard (New Feature) | -40.1% / **-70.4%** | -50.3% / **-60.2%** | -51.4% / **-60.2%** | -60.0% / **-60.0%** |
| **RW-05** | Go API Gateway + Rust WAL Storage Engine Distributed Ledger Mesh (Update Feature) | -42.3% / **-70.8%** | -68.3% / **-63.2%** | -76.9% / **-69.7%** | -71.4% / **-57.1%** |
| **RW-06** | C++20 Framebuffer Physics Viewport + TypeScript Inspector Overlay (Bug Fix) | -43.5% / **-72.7%** | +56.9% / **+33.7%** | +97.4% / **+12.8%** | +78.3% / **+8.7%** |
| **RW-07** | C# .NET Payment Settlement Service + Kotlin Fraud Scoring Engine (New Feature) | -38.7% / **-70.1%** | -39.5% / **-44.0%** | -60.7% / **-61.4%** | -61.0% / **-56.1%** |
| **RW-08** | Python FastAPI + React TSX + Twig Invoice Studio + CSS + JSON + YAML Billing Portal (Update Feature) | -39.5% / **-70.4%** | -30.4% / **-10.3%** | -31.0% / **-16.1%** | -47.8% / **-17.4%** |
| **RW-09** | High-Frequency Order Book Matching Engine & Risk Guard Daemon (Bug Fix) | -41.6% / **-71.4%** | -20.3% / **-0.2%** | -11.8% / **+12.3%** | -18.8% / **+3.1%** |
| **RW-10** | Unified 15-Language Enterprise Cloud Observability & Control Plane (Full-Stack Update Feature) | -42.7% / **-72.0%** | +55.1% / **+33.3%** | +155.9% / **+138.2%** | +134.5% / **+110.3%** |

## 6. Architectural Analysis: Why AICE Wins Even on Unfair, Cold-Start, 0-Idiom & Decoy-Minefield Workspaces

### A. Adversarial Hostile-to-AICE Design (Zero Coaching, Zero Pre-Baked Idioms, Zero Positional Shortcuts)
- **Cold-Start Idiom Discovery Paid In-Session**: `setupWorkspace` writes zero `aice.config.json` files. The `aice_with_idioms` agent must discover and persist `aice.config.json` during its live session via `aice context . -s "*" --idioms` (or `aice idioms scan --save`), paying the full cold-start AST mining cost and still beating `Without AICE` in the suite aggregate (7/10 strict all-metric scenario wins).
- **Non-First Seeded Targets + Decoy Sentinels**: Target declarations are procedurally selected at non-first indices (`targetIdx >= 1`) and identified only by their domain parameters/attributes, while every code file contains a seeded `verifyDecoySentinel_<hex>` function and `DECOY_SENTINEL_<hex>` comment that fail verification if altered.
- **Hostile 1-File, 0-Idiom "Lone Needle" (`RW-11`)**: Even when stripped of multi-file batching (1 file) and repeating idioms (`0` idioms discovered), AICE (`aice_with_idioms`) beats `Without AICE` across turns (`-29.4%`), tool calls (`-35.7%`), working payload tokens (`-26.0%`), LLM output tokens (`-32.8%`), and real API cost.

### B. Why AICE On-the-Fly WITH Idioms (`aice_with_idioms`) Wins 7/10 Multi-File Scenarios & Suite Aggregate
1. **Cold-Start AST Mining + Compact Context Pack (`aice context . -s "*" --idioms` / `aice idioms scan --save`)**: In 1 turn, AICE mines repetitive AST patterns across all 15 languages, lists every file's symbol headers (`// symbols:`), and collapses repeating AST blocks into 1-line `$idiom(...)` calls (`-25.0%` working payload tokens and `-62.0%` LLM output tokens).
2. **O(1) AST-Safe Pattern Refactoring (`aice splice --idioms --batch` / `--stdin`)**: Updating the mined `$guard`, `$tsx_kpi_tile`, `$css_card`, `$html_metric_row`, `$twig_summary_line`, `$rec_id`, and `$rec_worker` templates re-emits all matching AST call sites across the workspace while leaving `verifyDecoySentinel_*` functions 100% untouched (`-20.0%` real API dollar cost and `-16.4%` total context tokens).

### C. Why Pure AICE WITHOUT Idioms (`aice_no_idioms`) Wins 7/10 — and Why Idioms Cut Output Tokens Further
- **Where Pure AICE Wins (`7/10` scenarios, 100% verified across all 10 multi-file scenarios)**: Even without `$idiom` macros, `aice context` and `aice splice` beat `Without AICE` in the suite aggregate across **LLM Turns (`345 -> 268`, `-22.3%`)**, **Working Payload Tokens (`332,938 -> 251,981`, `-24.3%`)**, **LLM Output Tokens (`95,013 -> 64,922`, `-31.7%`)**, **Real API Dollar Cost (`$0.9502 -> $0.7662`, `-19.4%`)**, and **Total API Context Tokens (`18,552,951 -> 15,066,012`, `-18.8%`)**.
- **Granularity Advantage of Cold-Start Idioms (`aice_no_idioms` vs `aice_with_idioms`)**: Without idioms, refactoring 15–20 declarations requires splicing each symbol's compact AICE body (`64,922` output tokens). Discovering idioms on the fly collapses those repetitive bodies into O(1) template updates, changing LLM output tokens by **`-44.5%`** (`64,922 -> 36,053`) and working payload tokens by **`-0.9%`** (`251,981 -> 249,712`).
