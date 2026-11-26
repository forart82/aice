# AICE Opaque-Box End-to-End Test Suite

100% original Python 3.12 stdlib E2E test harness for the native Rust `aice` binary. Zero Node.js, TypeScript, pip, or Cargo dependencies.

## Quick Start

```bash
# Discover cases without needing target/release/aice built yet
/usr/bin/python3 tests/e2e/run_e2e.py --dry-run --tier all

# Verify harness isolation, assertions, and anti-tautology checks using mock_aice.py
/usr/bin/python3 tests/e2e/run_e2e.py --self-test -v

# Run live E2E suite against the compiled Rust binary
/usr/bin/python3 tests/e2e/run_e2e.py --tier all -v --json-report /tmp/e2e-report.json

# Run specific tiers or filtered cases with a custom binary path
AICE_BIN=/path/to/aice /usr/bin/python3 tests/e2e/run_e2e.py --tier 1,2 --filter F06
/usr/bin/python3 tests/e2e/run_e2e.py --bin /path/to/aice --tier 4 --fail-fast
```

## CLI Flags

| Flag | Default | Description |
|---|---|---|
| `--tier` | `all` | `1`, `2`, `3`, `4`, `all`, or comma-separated (e.g., `1,2`) |
| `--bin <path>` | `$AICE_BIN` or `/home/forart/dev/aice/target/release/aice` | Path to binary under test |
| `--filter <pattern>` | None | Regex or substring matching `case_id`, `feature`, `title`, `tags`, or test name |
| `--dry-run` | Off | Discovers and lists cases without invoking `AICE_BIN` (exits `0`) |
| `--self-test` | Off | Runs `tests/e2e/self_test/test_harness_self.py` against `self_test/mock_aice.py` |
| `--json-report <path>` | None | Writes structured JSON report (`schema_version`, `summary`, `tier_counts`, `feature_counts`, `cases[]`) |
| `-f`, `--fail-fast` | Off | Stop on first test failure or error |
| `--timeout <sec>` | `30.0` | Per-command timeout in seconds |
| `-v`, `--verbose` | Off | Verbose per-case status output |

## Exit Codes

- `0`: All selected tests passed (or `--dry-run` succeeded).
- `1`: One or more tests failed or errored.
- `2`: Missing/non-executable `AICE_BIN` on a live run, or invalid runner CLI arguments.

## Architecture

- `harness/config.py`: Binary resolution (`--bin` -> `AICE_BIN` -> `target/release/aice`) and feature catalog (`F01`–`F14`).
- `harness/sandbox.py`: Per-test `TemporaryDirectory(prefix="aice-e2e-")` with isolated `ws/`, `home/`, `outside/`, fake `HOME`/`AICE_HOME`/`AICE_TELEMETRY_*`, `/tmp` suppression toggle, and byte-exact `snapshot_tree()`.
- `harness/adapter.py`: Single `AiceAdapter` boundary translating semantic E2E operations (`read_file`, `batch_read`, `find`, `search`, `splice_single`, `splice_heredoc`, `splice_batch_json`, `enable`, `disable`, `config`, `status`, `gain`, `analyze`, `help`, `version`, `mcp_session`, `mcp_call`) into CLI invocations and MCP JSON-RPC 2.0 (`\n` and `Content-Length`) stdio sessions.
- `harness/assertions.py`: Opaque-box assertions for AICE IR transformation, binary guard, disk immutability/rollback, telemetry ledger consistency, and strict 2-tool MCP parity.
- `harness/reporting.py`: `@e2e_case` metadata decorator, tier discovery, `--dry-run` formatting, and `--json-report` serialization.
- `fixtures/`: Self-contained test corpus covering configs, 22 R5 + Twig languages (`valid/` & `invalid/`), 9 R6 DB/query dialects (`valid/` & `invalid/`), dependency graphs, binary probes, plaintext, and `bpe_vectors.json`.
- `suites/`: Tier 1–4 test modules (`tier1_*.py` .. `tier4_*.py`).
- `self_test/`: Pre-binary verification (`mock_aice.py` & `test_harness_self.py`) proving sandbox isolation and non-tautological assertion sensitivity.
