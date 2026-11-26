# AICE Rust Architecture Specification (v0.9.53 Rewrite)

This document defines the authoritative architecture for the 100% idiomatic Rust rewrite of **AICE (AI Co-Engine)**: the 12-command CLI, multi-target batch/heredoc grammar, unified selector syntax, honest BPE telemetry schema, `aice.config.json` compatibility contract, strict 2-tool MCP interface, 10-crate 5-layer acyclic DAG (post-R7-Kill; see [`IDIOM_GATE_REPORT.md`](IDIOM_GATE_REPORT.md)), compile-time type-state pipeline, and parser routing table.

---

## 1. Core Architectural Laws

1. **Single Pipeline Law**: 100% of file reads, multi-file reads, searches, `find` operations, `splice`/writes, and MCP calls traverse one compile-time type-state pipeline:
   ```text
   PipelineRequest<Raw, Op>
     -> aice_governance::authorize (NonAdminOp) / authorize_admin (AdminOp)
   PipelineRequest<Governed | AdminGoverned, Op>
     -> PipelineExecutor::execute_*
   PipelineResult<Executed>
     -> aice_pipeline::meter_and_seal (meters via aice_telemetry::meter_payload)
   MeteredOutput
     -> aice_pipeline::StdoutWriter::emit
   ```
2. **Universal AICE Transformation (R3)**: All supported languages, structured formats, and database/query dialects transform to compact AICE IR on read. The ONLY permitted branch is `LanguageId::PlainText`, which yields `TranspileOutcome::UnsupportedPassthrough` inside `AiceTranspiler::to_aice` while still traversing governance, path/line/block slicing, search matching, batch framing, and honest BPE telemetry.
3. **Zero Prohibited Dependencies**: Strictly Rust `std` + `tree-sitter = "0.27.2"` + `tree-sitter-language = "0.1.9"` + 25 verified `tree-sitter-*` grammar crates + `bpe-openai = "0.3.2"`. Zero `clap`, `serde`, `serde_json`, `sqlparser`, `pg_query`, `graphql-parser`, `regex`, `ignore`, `toml`, or `tiktoken-rs`.
4. **Hard Modularity Gate (R2)**: Every `.rs` source file under `crates/*/src/**` (excluding generated bindings and test fixtures) MUST be `<= 300` lines (target `<= 250` lines), enforced by `tools/check_line_limits.py` and `tests/integration/modularity_gate.rs`.

---

## 2. Finalized Clean Rust CLI Syntax

`aice-cli` uses an original pure-`std` CLI parser (`std::env::args_os()`) with an ingress flag-normalization layer. It exposes **12 canonical subcommands** and **zero hidden commands**.

### 2.1 Global Flags
- `-V`, `--version` — Prints `0.9.53` and exits `0` without initializing `bpe-openai` (`< 3 ms` startup).
- `-h`, `--help` — Prints concise CLI help and exits `0`.
- `--color`, `--no-color` — Controls ANSI output styling (honors `NO_COLOR` / `CI`).

### 2.2 Canonical Subcommands (12)

| Command | Aliases | Positional Args | Exact Flags | Pipeline Route & Notes |
|---|---|---|---|---|
| `read` | `context`, `ctx` | `[targets...]` (default `.` if `--search`/`--files`) | `--outline`, `--outline-target`, `--full`, `-d, --depth <N>`, `-s, --symbol <SEL>`, `--search <PAT>`, `-C, --context <N>`, `--files`, `--compact`, `--no-compact`, `--no-types`, `--deps`, `--no-deps`, `--callers`, `--no-callers`, `--max-tokens <N>`, `--json`, `--stats` | **Universal AICE IR default (R3)**; `--dsl` retired. `--full` only expands the `120L` auto-outline threshold; never bypasses governance, AICE transformation, budget accounting, or telemetry. |
| `search` | `grep` | `<pattern> [targets...]` | `-C, --context <N>`, `-n, --line-number`, `-s, --symbol <SEL>`, `--search <PAT>`, `-l, --files-with-matches`, `--full`, `--max-tokens <N>`, `--json`, `--stats` | 4-tier ranked search; matching snippets transform via AICE IR on supported languages (`B-R2` closed). |
| `find` | `tree` | `[pattern] [targets...]` | `-d, --depth <N>`, `--max-depth <N>`, `-L <N>`, `--search <PAT>`, `--full`, `--max-tokens <N>`, `--json` | Parallel ignore-aware walker + binary probe + trigram/AST fuzzy ranking (`<= 6 ms` target). |
| `splice` | `write` | `[path] [symbol]` | `-f, --file <PATH>`, `-s, --symbol <SEL>`, `-c, --code <CODE>`, `-t, --template <CODE>`, `-b, --body <CODE>`, `--from <FILE>`, `--stdin`, `-d, --delete [SEL]`, `--insert-after <SEL>`, `--insert-before <SEL>`, `--edits <JSON_OR_FILE>`, `--batch <JSON_OR_FILE>`, `--create`, `--overwrite`, `--force`, `--in-place`, `--dry-run`, `--diff`, `--json`, `--no-preserve-docs` | `--force` authorizes overwriting `> 25L` files or empty truncation only; **NEVER bypasses `SyntaxFirewall` or binary guard (`B-W1`)**. `--compile` retired. |
| `enable` | — | `[dir]` (default `.`) | `-f, --force`, `--json` | Sets `"enabled": true` in `aice.config.json`; syncs `AGENTS.md` (`<= 22 KB` unless `-f`). |
| `disable` | — | `[dir]` (default `.`) | `--json` | Sets `"enabled": false` in `aice.config.json`. |
| `config` | `status` | `[dir]` (default `.`) | `--enable`, `--disable`, `-f, --force`, `--json` | Reads/updates `aice.config.json` preserving unknown keys (`extra_fields`). |
| `agents` | — | `[action]` (`status\|setup\|remove`) | `-a, --agent <NAME>`, `--all`, `--global-rules`, `--json` | Configures MCP + rules for `claude`, `agy`/`gemini`, `codex`, `opencode`, `aider`, `goose`, `cursor`. |
| `gain` | `gains`, `stats`, `telemetry` | `[project]` | `-p, --project <PATH_OR_NAME>`, `--unique`, `--all`, `-i, --interactive`, `--json`, `--reset`, `-y, --yes` | Reads `gains.jsonl` + `errors.jsonl`; reports honest signed BPE totals. |
| `analyze` | — | `[project]` | `-p, --project <PATH_OR_NAME>`, `--transcripts-dir <DIR>`, `--json` | Cross-verifies telemetry ledger against agent session transcripts. |
| `mcp` | — | — | `--generate-schemas [DIR]` | Stdio JSON-RPC 2.0 server exposing strictly `aice_read` and `aice_splice`. |
| `benchmark` | `bench` | — | `--json`, `--markdown` | Runs multi-language corpus & tokenomics benchmark suite. |

> **R7 Empirical Idiom Gate (`VERDICT: KILL`)**: Per [`IDIOM_GATE_REPORT.md`](IDIOM_GATE_REPORT.md), the provisional Wave 4 idiom subsystem and all associated CLI/MCP idiom flags and config toggles were removed 100% with zero dead code after clearing the `> 1.0%` net BPE reduction threshold in only `5/12` (`41.7% < 80%`) workloads.

### 2.3 Flag Normalization Layer (Pure-`std` Ingress)
Before subcommand argument binding (stopping immediately at `--`), `aice-cli` normalizes common agent-emitted flag variants:
- `--files-only`, `--filesOnly`, `--files=true`, `--filesWithMatches` -> `--files` (on `read`) or `--files-with-matches` (on `search`).
- `--context-lines`, `--contextLines[=N]`, `-c N`, `-cN` (on `read`/`search`) -> `-C [N]`.
- `--include-deps[=true|false]`, `--includeDeps[=...]` -> `--deps` / `--no-deps` (on `read`).
- `--include-callers[=true|false]`, `--includeCallers[=...]` -> `--callers` / `--no-callers` (on `read`).
- `--max-depth`, `--maxDepth`, `-LN`, `-L N` -> `-d [N]` (on `read`/`find`).
- `--outlineTarget[=true]` -> `--outline-target`; `--types=false`, `--includeTypes=false` -> `--no-types`.

### 2.4 Retired Legacy Commands & MCP Backdoors (Zero Bypasses)
- **Retired 13 hidden TS commands**: `outline` -> `read --outline`; `create`/`new` -> `splice --create`; `tokens`/`verify-tokenomics` -> `benchmark`/`gain`; `compile`, `compile-all`, `decompile`, `roundtrip`, `verify`, `fix`, `fmt`, `diff`, `patch`, `idioms` are **removed** (`B-S2` closed).
- **Retired 7 hidden MCP aliases**: `tools/list` exposes strictly `["aice_read", "aice_splice"]`; `tools/call` rejects any other tool name (`aice_context`, `aice_outline`, `aice_idioms`, `aice_create`, `aice_gain`, `aice_project_config`, `aice_write`, `read`, `write`, `splice`) with JSON-RPC `-32602` (`B-S3` closed).

---

## 3. Unified Selector Syntax (`aice-batch-read` & `aice-batch-write`)

Both read and write paths share `parse_target_spec(raw)`:
1. **Drive-letter guard**: Preserves `C:\` / `C:/` prefixes (`offset = 2`).
2. **Primary separator**: Splits `<filePath>` and `<selector>` on the first `:` or `#` when `<filePath>` resolves cleanly, contains path separators/globs, or precedes an unambiguous selector (`L\d+`, `create`, `overwrite`, `eof`, `end`, `append`, `hunk`, `*`).
   - Both `file.rs#Struct::method` and `file.rs:Struct.method` normalize to `(file="file.rs", selector="Struct::method")` without splitting internal `::` scope separators.
3. **Comma multi-selectors**: `split_comma_selectors` splits `file:sel1,sel2,L10-L45` while ignoring commas inside `'...'`, `"..."`, `/regex/`, `[...]`, and `{...}`.
4. **Canonical selector forms**:
   - `Sym`, `Class.method`, `Struct::method`, `mod::fn`, Markdown headings, CSS selectors, test IDs.
   - `Sym@first`, `Sym@1` (1-based ordinal overload disambiguation).
   - `Sym@<block_or_pattern>` (intra-function AST control-flow block / CTE / branch / focus pattern).
   - `L10-L45`, `L10`, `10-45` (1-based inclusive line range; clamped to EOF on read, strict bounds + half-open guard on write).
   - `/regex/[gimsuy]*` (regex search scoped to target; shell-quoted `'f:/a|b/'`).
   - `:outline`, `:imports` (read views).
   - `:eof` (`end`, `append`) and `:overwrite` (`create`, `*`) (splice targets).

---

## 4. Multi-Target Batch & Heredoc Grammar (`aice-batch-write`)

### 4.1 Heredoc Stream (`--stdin` or inline payload with `=== ... ===`)
- **Header syntax**: `^\s*={3,}\s*([^=\r\n]+?)\s*={3,}(?:\s+(--delete|-d|\(delete\)))?\s*$` (case-insensitive modifier).
- **Non-header guards**:
  - Lines consisting solely of `>= 7` `=` characters (`=======`) are literal content dividers, never headers.
  - Indented `=== ... ===` lines are treated as literal body text whenever the stream contains at least one unindented header.
  - Header scanning is suspended inside: (a) Markdown fences (` ``` ` / `~~~`), (b) hunk blocks (`<<< ... >>>`), and (c) triple-quoted strings (`"""` / `'''`) in Python/Kotlin/Java/C#/Gradle/extensionless targets.
- **Malformed header errors**: Unclosed `=== <target>`, empty `=== ===` or `=== "" ===`, bare `=== : ===`, or trailing colon `=== file: ===` fail parse immediately (exit `1`) before touching disk.
- **Modifiers**:
  - Delete: trailing `--delete`, `-d`, `(delete)`, or `:delete` (or body equal to `--delete` / `DELETE`).
  - Docstrings: `@replace-docs`, `@strip-docs`, `@drop-docs` (`preserve_docs = false`).
  - Clone: `@clone(<sym>)`, `(clone <sym>)`, `@clone <sym>`.
  - Insertion: `--insert-after <anchor>`, `--insert-before <anchor>`.
- **Pre-header lines & inheritance**: Leading blank lines are skipped; any non-empty line before the first `=== ... ===` header fails stream parsing. Sections starting with `:` or `#` without a `<filePath>` inherit `lastExplicitFilePath` (or the CLI target path).

### 4.2 Contextual Hunks (`<<< ... === ... >>>`) & 5-Tier Matching
- Line-anchored `<<<` starts search block, `===` switches to replacement block, `>>>` closes hunk.
- Automatic gutter stripping cleans `N│ ` and `L?N: ` prefixes from copied read output.
- 5 ordered matching tiers within target scope: (1) exact line slice, (2) unique inline single-line match, (3) base-indentation-stripped (`dedent`) with blank-line parity, (4) line-trimmed match, (5) non-blank sequence / interior whitespace normalized. `> 1` matches at the winning tier abort with line previews; `0` matches abort with context.

### 4.3 JSON Batch Interfaces, Half-Open `:L` Guard & Atomic Commit
- `--edits <jsonOrFile>` (or `-` for stdin): `Array<{ symbol, code?, body?, delete?, insertAfter?, insertBefore?, cloneFrom?, preserveDocs?, aice?, template?, snippet?, content?, replacement? }>` on one file.
- `--batch <jsonOrFile>`: `Array<BatchSpliceItem>` across multiple files.
- **Half-open `:L` guard**: On `:Lstart-Lend` with `span >= 4`, if replacement has `span - 1` lines, lines `0..span-2` match original assignment LHS 1-for-1, and `Lend` is a non-comment statement whose LHS is referenced within the next 15 lines (or a non-assignment statement), abort with an inclusive-range error.
- **3-Phase Atomic Transaction**:
  1. Resolve & patch all targets in memory.
  2. Run `SyntaxFirewall::verify` (or `verify_incremental` for pre-broken files) on **every** candidate buffer (ignoring `--force`).
  3. Write sibling `.tmp` files and atomically `rename`; on any failure, roll back all staged/modified/created files and emit compact `Line:Col` + `±5` line context diagnostics.

---

## 5. Honest JSON Telemetry Schema (`aice-telemetry`)

### 5.1 Ledger Locations & Exclusion Rules
- `gains.jsonl`: `AICE_TELEMETRY_PATH` -> `AICE_TELEMETRY_DIR/gains.jsonl` -> `${AICE_HOME:-~/.aice}/telemetry/gains.jsonl`.
- `errors.jsonl`: `AICE_TELEMETRY_ERRORS_PATH` -> `<dirname(gains.jsonl)>/errors.jsonl`.
- Ephemeral temp roots (`/tmp`, `/private/tmp`, `/var/tmp`, `std::env::temp_dir()`, `swarm-*`) and unit tests without explicit telemetry env overrides never pollute global telemetry.

### 5.2 Record Formats
- **`gains.jsonl` (1 JSON object/line)**:
  - Required: `t` (u64 epoch ms), `r` (`projectRoot`), `f` (`filePath` <= 120 chars or synthetic `<directory>` / `<workspace-files>` / `<multi-context>` / `<cli-error>`), `o` (`"read" | "context" | "outline" | "splice" | "create" | "patch"`), `nc` (`usize` raw baseline bytes/chars), `ac` (`usize` complete emitted stdout bytes/chars), `n1` (`cl100k_base` raw), `a1` (`cl100k_base` emitted), `n2` (`o200k_base` raw), `a2` (`o200k_base` emitted).
  - Optional: `p`, `mf` (max 16 rel paths), `l`, `s` (`"mcp"` if non-CLI), `a` (agent id), `sm` (`1`), `rn`, `rs`, `pt`, `wi`, `h` (legacy `sc` tolerated on read; `i` removed under R7 `VERDICT: KILL`).
- **`errors.jsonl`**:
  - `{ timestamp, projectRoot, projectName, filePath, operation, surface, agent, errorMessage, wastedInputTokens? }`.

### 5.3 Honesty Invariants & `bpe-openai` Cold-Start Mitigation
- `n1`/`a1` ALWAYS use `bpe_openai::cl100k_base().count(...)`; `n2`/`a2` ALWAYS use `bpe_openai::o200k_base().count(...)`. Zero `chars/4` or `bytes/3.5` heuristics.
- `ac`, `a1`, `a2` ALWAYS meter the exact complete `MeteredOutput` stdout payload (including framing headers and `--stats` footers).
- Signed deltas (`native - aice`) are **never** clamped to `>= 0`.
- `find` and `search` baselines measure equivalent native `find`/`rg` output, never unread file contents or synthetic multipliers; `splice` compares the replaced scope baseline against the splice payload+framing.
- **Lazy-init mitigation**: `bpe_openai` deserializes `15 MB` (`cl100k`) + `31 MB` (`o200k`) `.dict` blobs in `~27–41 ms` on first access (`LazyLock`), whereas warm `.count()` is `0.11–0.13 ms/KB`. Admin/help/version paths (`--version`, `--help`, `enable`, `disable`, `config`, `status`) NEVER touch `bpe_openai` (`< 1 ms` startup); metered paths overlap tokenizer initialization or amortize it in persistent `aice mcp` sessions.
- `gain --json` and `analyze --json` preserve the full Wave 0 JSON key contracts (`byCommand`, `byOperation`, `byLanguage`, `projects`, `wrapperTaxCl100k`, `ruleReplayTaxCl100k`, `mcpSchemaTaxCl100k`, `paginationReplayTaxCl100k`, `retryReplayTaxCl100k`, `endToEndVerdict`, etc.).

---

## 6. Config Compatibility, Environment Variables, Exit Codes & MCP Contract

### 6.1 Configuration Discovery & Precedence (`aice-governance`)
- `find_project_root` walks upward checking `aice.config.json`, `.aicerc`, `.aice-build`, `package.json`, `composer.json`, `Cargo.toml`, `go.mod`, `pyproject.toml`, `.git`, stopping at `HOME`, system temp dirs, or `cwd` boundary.
- Precedence: `aice.config.json` -> `.aicerc` -> `package.json#aice` (stripping JSONC `//` and `/* */` comments on `aice.config.json`/`.aicerc`). Unknown fields are preserved verbatim on config save.
- Defaults: `enabled: true`, `mode: "side-by-side"`, `sourceDir: "src"`, `outDir: ".aice-build"`, `targetLanguage: "typescript"`, `isolated: false`, `watermark: true`, `allowedReadRoots: None`. Legacy `"idiomsEnabled"` / `"idioms"` keys were removed from `AiceConfig` under R7 (`VERDICT: KILL`; see [`IDIOM_GATE_REPORT.md`](IDIOM_GATE_REPORT.md)) and are preserved verbatim only in `AiceConfig::extra_fields` for backwards compatibility.
- When `enabled == false`, all non-admin commands exit `1` with `AICE is disabled for this project via aice.config.json ("enabled": false). Use native tools or run 'aice enable'.`
- Binary guard: `BINARY_EXTENSIONS` + `8,192 B` NUL/UTF-8 probe + `2 MiB` max text size. Reads emit `// [binary file skipped: <path> (<N> bytes)]`; writes exit `1`.

### 6.2 Environment Variables & Exit Codes
- Env vars: `AICE_HOME`, `AICE_AGENT_HOME`, `AICE_AGENT`, `AICE_TELEMETRY_PATH`, `AICE_TELEMETRY_DIR`, `AICE_TELEMETRY_ERRORS_PATH`, `AICE_TRANSCRIPTS_DIR`, `AICE_CLI_INVOCATION_KEY`, `AICE_CLI_INTERACTIVE`, `AICE_CLI_BUDGET_STATE_FILE`, `HOME`, `NO_COLOR`, `CI`, plus agent auto-detection vars (`ANTIGRAVITY_CLI`, `ANTIGRAVITY_AGENT`, `AGY_SESSION`, `CLAUDECODE`, `CLAUDE_CODE_ENTRYPOINT`, `CLAUDE_PROJECT_DIR`, `CODEX_SANDBOX`, `CODEX_CLI`, `OPENAI_CODEX`, `GEMINI_CLI`, `OPENCODE`, `OPENCODE_CLI`, `AIDER`, `AIDER_MODEL`, `GOOSE_PROVIDER`, `CURSOR_TRACE_ID`, `CURSOR_SESSION`).
- Exit codes: `0` success (including `--dry-run`), `1` governance/parse/firewall/atomic-rollback/runtime error, `128 + sig` signal termination.

### 6.3 Strict 2-Tool MCP Contract (`aice mcp`)
- JSON-RPC 2.0 over stdio (`initialize`, `notifications/initialized`, `tools/list`, `tools/call`).
- `tools/list` returns strictly `aice_read` and `aice_splice`.
- `tools/call` routes exclusively through `authorize` -> `PipelineExecutor` -> `meter_and_seal`, rejecting null array elements and any non-canonical tool name with `-32602`.

---

## 7. 10-Crate Acyclic DAG, Core Traits & Type-State Pipeline

### 7.1 5-Layer Acyclic Dependency Graph
Every dependency edge points strictly downward (`Layer k -> Layer < k`):

```text
Layer 4:  aice-cli             (-> pipeline, governance, telemetry)
Layer 3:  aice-pipeline        (-> all 8 other library crates)
Layer 2:  aice-batch-read      (-> governance, lang-registry, ast-engine, aice-ir, find-engine, telemetry)
          aice-batch-write     (-> governance, lang-registry, ast-engine, aice-ir)
Layer 1:  aice-find-engine     (-> governance, lang-registry)
          aice-telemetry       (-> governance, bpe-openai)
          aice-ast-engine      (-> lang-registry, tree-sitter, tree-sitter-language, 25 grammars)
          aice-aice-ir         (-> lang-registry, tree-sitter)
Layer 0:  aice-governance      (std only)
          aice-lang-registry   (std + core tree-sitter ABI only)
```

*(9 library crates + `aice-cli` = 10 workspace crates; the former Layer 2 idiom crate was deleted 100% under R7 `VERDICT: KILL` — see [`IDIOM_GATE_REPORT.md`](IDIOM_GATE_REPORT.md).)*

### 7.2 Five Core Trait Boundaries
1. `LanguageAdapter` (`aice-lang-registry`): `id()`, `parse_cst()`, `extract_symbols()`, `extract_dependencies()`.
2. `AstSlicer` (`aice-lang-registry`): `slice_symbol()`, `slice_intra_block()`, `outline()`.
3. `AiceTranspiler` (`aice-aice-ir`): `to_aice()` (returning `TranspileOutcome::UnsupportedPassthrough` ONLY for `LanguageId::PlainText`), `to_native()`.
4. `SyntaxFirewall` (`aice-lang-registry`): `verify()` and `verify_incremental()` — **zero `force` parameter** at the trait signature level.
5. `PipelineExecutor` (`aice-pipeline`): `execute_read`, `execute_write`, `execute_find`, `execute_search`, `execute_admin`.

### 7.3 Compile-Time Type-State Seals
- `Governed` and `AdminGoverned` (`aice-governance::typestate`) both have private `_sealed: ()`, private fields, and are `!Clone`; `PipelineRequest<S, Op>` has private fields (`state`, `op`, `cwd`, `surface`) with read-only getters and `into_parts()`, while `authorize<Op: NonAdminOp>` is sealed to `ReadOp`, `SearchOp`, `FindOp`, and `WriteOp` (and `authorize_admin` returns `AdminGoverned` exclusively for `AdminOp`).
- `Executed` (`aice-pipeline::state`) and `MeteredOutput` (`aice-pipeline::seal`) both have private `_sealed: ()` and zero `pub` fields; `meter_and_seal` accepts solely `PipelineResult<Executed>` (zero unsealed traits).
- `StdoutWriter::emit` (`aice-pipeline::writer`) is the **sole** stdout sink in the workspace; `aice-telemetry` holds pure BPE metering (`bpe`, `meter_payload`), JSONL ledgers, and reporting with zero stdout writes.

## 8. Verified Parser Routing Table (25 `tree-sitter` Crates -> 29 `LanguageFn` + Original Rust RD Parsers)

Empirically verified against `tree-sitter = "0.27.2"` + `tree-sitter-language = "0.1.9"` with zero C linker symbol collisions:

| Domain | Language / Format | Crate / Parser Strategy | `LanguageFn` Symbol / RD Parser Scope |
|---|---|---|---|
| R5 | JSON | `tree-sitter-json = "0.24.8"` | `tree_sitter_json::LANGUAGE` |
| R5 | YAML | `tree-sitter-yaml = "0.7.2"` | `tree_sitter_yaml::LANGUAGE` |
| R5 | TOML | `tree-sitter-toml-ng = "0.7.0"` | `tree_sitter_toml_ng::LANGUAGE` |
| R5 | Markdown | `tree-sitter-md = "0.5.4"` | `tree_sitter_md::LANGUAGE`, `INLINE_LANGUAGE` |
| R5 | HTML | `tree-sitter-html = "0.23.2"` | `tree_sitter_html::LANGUAGE` |
| R5 | CSS | `tree-sitter-css = "0.25.0"` | `tree_sitter_css::LANGUAGE` |
| R5 | XML / DTD | `tree-sitter-xml = "0.7.0"` | `tree_sitter_xml::LANGUAGE_XML`, `LANGUAGE_DTD` |
| R5 | Shell / Bash | `tree-sitter-bash = "0.25.1"` | `tree_sitter_bash::LANGUAGE` |
| R5 | Rust | `tree-sitter-rust = "0.24.2"` | `tree_sitter_rust::LANGUAGE` |
| R5 | TypeScript / TSX | `tree-sitter-typescript = "0.23.2"` | `LANGUAGE_TYPESCRIPT`, `LANGUAGE_TSX` |
| R5 | JavaScript | `tree-sitter-javascript = "0.25.0"` | `tree_sitter_javascript::LANGUAGE` |
| R5 | Python | `tree-sitter-python = "0.25.0"` | `tree_sitter_python::LANGUAGE` |
| R5 | Go | `tree-sitter-go = "0.25.0"` | `tree_sitter_go::LANGUAGE` |
| R5 | C | `tree-sitter-c = "0.24.2"` | `tree_sitter_c::LANGUAGE` |
| R5 | C++ | `tree-sitter-cpp = "0.23.4"` | `tree_sitter_cpp::LANGUAGE` |
| R5 | C# | `tree-sitter-c-sharp = "0.24.0"` | `tree_sitter_c_sharp::LANGUAGE` |
| R5 | Java | `tree-sitter-java = "0.23.5"` | `tree_sitter_java::LANGUAGE` |
| R5 | Kotlin | `tree-sitter-kotlin-ng = "1.1.0"` | `tree_sitter_kotlin_ng::LANGUAGE` |
| R5 | Dart | `tree-sitter-dart = "0.3.0"` | `tree_sitter_dart::LANGUAGE` (`willbooster-tree-sitter-dart` excluded: invalid ABI `0x5742000d`) |
| R5 | PHP | `tree-sitter-php = "0.25.2"` | `LANGUAGE_PHP`, `LANGUAGE_PHP_ONLY` |
| R5 | Ruby | `tree-sitter-ruby = "0.23.1"` | `tree_sitter_ruby::LANGUAGE` |
| R5 | Twig | Original Rust RD (`<= 300L`) | Full `{{ ... }}` / `{% ... %}` / `{# ... #}` tag/block balance + HTML inner parse |
| R6 | ANSI SQL | `tree-sitter-sequel = "0.3.13"` | `tree_sitter_sequel::LANGUAGE` |
| R6 | PostgreSQL / PL/pgSQL | `tree-sitter-sequel = "0.3.13"` + Wave 2 RD | `$$` dollar-quoted bodies, `DECLARE..BEGIN..EXCEPTION..END`, triggers/views/CTEs |
| R6 | MySQL / MariaDB | `tree-sitter-sequel = "0.3.13"` + Wave 2 RD | `DELIMITER //`, `CREATE PROCEDURE/EVENT`, backtick DDL |
| R6 | SQLite | `tree-sitter-sequel = "0.3.13"` + Wave 2 RD | `PRAGMA`, `WITHOUT ROWID`, `STRICT`, `ON CONFLICT (...) DO UPDATE` |
| R6 | T-SQL / SQL Server | Original Rust RD/Pratt (`<= 300L`) | `GO` batches, `[bracket]` idents, `TOP`, `@vars`, `BEGIN TRY..CATCH`, `CREATE PROC` (`tree-sitter-sequel-tsql` excluded: C symbol collision with `tree-sitter-sequel` + broken T-SQL grammar) |
| R6 | DB Migrations | Original Rust RD splitter (`<= 300L`) | Flyway (`V*__*.sql`), Goose (`-- +goose Up/Down`), dbmate (`-- migrate:up/down`), Alembic |
| R6 | Prisma | `tree-sitter-prisma-io = "1.6.0"` | `tree_sitter_prisma_io::LANGUAGE` |
| R6 | GraphQL | `tree-sitter-graphql = "0.3.0"` | `tree_sitter_graphql::LANGUAGE` |
| R6 | Cypher | `tree-sitter-cypher = "0.2.6"` + Wave 2 RD | `tree_sitter_cypher::LANGUAGE` + strict clause-order & pattern RD validator |
| Fallback | PlainText | None (`LanguageId::PlainText`) | `TranspileOutcome::UnsupportedPassthrough` (still governed, sliced, and metered) |
