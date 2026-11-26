"""Tier 3 Opaque-Box E2E Suite: Cross-Feature Pairwise Combinations (18 tests)."""

from __future__ import annotations

import json
import unittest

from harness.adapter import AiceAdapter
from harness.assertions import (
    assert_disk_file_absent,
    assert_disk_unchanged,
    assert_exit_code,
    assert_gain_json_valid,
    assert_is_aice_transformed,
    assert_mcp_text_result,
    assert_mcp_tool_error,
    assert_no_ast_fallback_marker,
    assert_no_raw_binary_bytes,
    assert_stdout_contains,
    assert_stdout_not_contains,
    assert_telemetry_ledger_consistent,
)
from harness.config import FIXTURES_DIR
from harness.reporting import e2e_case
from harness.sandbox import Sandbox


def _load_big_ts() -> str:
    data = json.loads((FIXTURES_DIR / "bpe_vectors.json").read_text(encoding="utf-8"))
    return str(data["vectors"]["big_ts"]["text"])


class TestTier3PairwiseCombinations(unittest.TestCase):
    """18 pairwise cross-feature E2E combinations (T3-01..T3-18)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T3-01",
        tier=3,
        feature="F01",
        title="F01+F10: allowedReadRoots with .aicerc permits in-root batch read and blocks outside secret",
        tags=("F01", "F10", "pairwise", "governance"),
    )
    def test_t3_01_governance_allowed_roots_with_batch_read(self) -> None:
        with Sandbox() as sb:
            sb.seed_file(
                ".aicerc",
                json.dumps({"enabled": True, "allowedReadRoots": ["../outside/shared"]}) + "\n",
            )
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("r5/valid/sample.ts", "shared/helper.ts", area="outside")
            sb.seed_file("secret.txt", "TOP_SECRET_CREDENTIAL_42\n", area="outside")

            ok_res = self.adapter.batch_read(
                sb, ["src/math.ts", "../outside/shared/helper.ts"]
            )
            assert_exit_code(ok_res, 0, "in-root + allowedReadRoots batch read")
            assert_stdout_contains(ok_res, "Calculator")
            assert_stdout_contains(ok_res, "applyCredit")

            bad_res = self.adapter.batch_read(
                sb, ["src/math.ts", "../outside/secret.txt"]
            )
            assert_exit_code(bad_res, 1, "batch read escaping allowedReadRoots")
            assert_stdout_not_contains(bad_res, "TOP_SECRET_CREDENTIAL_42")

    @e2e_case(
        case_id="T3-02",
        tier=3,
        feature="F01",
        title="F01+F09: enabled:false uniformly blocks find, search, grep, and read --files (B-S2, B-S4)",
        tags=("F01", "F09", "pairwise", "anti-bypass"),
    )
    def test_t3_02_disabled_blocks_all_discovery_surfaces(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            for label, res in (
                ("find", self.adapter.find(sb)),
                ("search", self.adapter.search(sb, "Calculator")),
                ("grep", self.adapter.run_raw(sb, ["grep", "Calculator"])),
                ("read --files", self.adapter.run_raw(sb, ["read", "--files"])),
            ):
                assert_exit_code(res, 1, f"disabled {label}")
                combined = res.stdout + "\n" + res.stderr
                self.assertIn("enabled", combined.lower(), f"{label}: {combined!r}")

    @e2e_case(
        case_id="T3-03",
        tier=3,
        feature="F02",
        title="F02+F10: mixed batch read (.ts + PlainText .txt + binary .png) preserves Law 3",
        tags=("F02", "F10", "pairwise", "plaintext", "binary"),
    )
    def test_t3_03_mixed_batch_read_ts_plaintext_and_binary(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("plaintext/notes.txt", "docs/notes.txt")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")

            res = self.adapter.batch_read(
                sb, ["src/math.ts", "docs/notes.txt", "bin/logo.png"]
            )
            assert_exit_code(res, 0, "mixed batch read")
            assert_no_raw_binary_bytes(res.stdout_bytes, "mixed batch")
            assert_stdout_contains(res, "Calculator")
            assert_stdout_contains(res, "[a+b]*(c?)")
            self.assertIn("binary", res.stdout.lower())
            assert_stdout_not_contains(res, "IHDR")
            assert_telemetry_ledger_consistent(sb, expected_min_rows=1)

    @e2e_case(
        case_id="T3-04",
        tier=3,
        feature="F03",
        title="F03+F10: batch read --stats on tiny.ts + big.ts meters full stdout & signed deltas (B-T6)",
        tags=("F03", "F10", "pairwise", "telemetry"),
    )
    def test_t3_04_batch_read_stats_honest_telemetry(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/tiny.ts", "src/tiny.ts")
            sb.seed_file("src/big.ts", _load_big_ts())

            r_tiny = self.adapter.read_file(sb, "src/tiny.ts", stats=True)
            assert_exit_code(r_tiny, 0, "tiny.ts --stats")

            r_batch = self.adapter.batch_read(
                sb, ["src/tiny.ts", "src/big.ts"], full=True, stats=True
            )
            assert_exit_code(r_batch, 0, "batch --stats")

            rows = assert_telemetry_ledger_consistent(
                sb,
                expected_min_rows=2,
                check_o200k_distinct_across_rows=True,
                check_negative_deltas_allowed=True,
            )
            self.assertEqual(rows[-1]["ac"], len(r_batch.stdout_bytes))

    @e2e_case(
        case_id="T3-05",
        tier=3,
        feature="F03",
        title="F03+F12: atomic batch splice records telemetry; failed rolled-back batch logs no fake savings",
        tags=("F03", "F12", "pairwise", "telemetry"),
    )
    def test_t3_05_batch_splice_telemetry_and_failed_rollback_honesty(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            ok_stream = (
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 2, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.reset ===\n"
                "  public reset(): number {\n"
                "    this.count = 2;\n"
                "    return this.count;\n"
                "  }\n"
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, ok_stream), 0, "valid batch")
            rows_before = len(sb.read_telemetry_rows())
            self.assertGreaterEqual(rows_before, 1)

            bad_stream = (
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 3, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.inc ===\n"
                "  public inc(step: number): CalcResult {\n"
                "    const broken = ;\n"
                "    return this.calc.add(this.count, step);\n"
                "  }\n"
            )
            before_disk = sb.snapshot_tree()
            bad_res = self.adapter.splice_heredoc(sb, bad_stream)
            assert_exit_code(bad_res, 1, "failed batch rollback")
            assert_disk_unchanged(sb, before_disk)
            rows_after = sb.read_telemetry_rows()
            # Rolled-back write must not append synthetic positive savings rows
            self.assertEqual(len(rows_after), rows_before)

    @e2e_case(
        case_id="T3-06",
        tier=3,
        feature="F04",
        title="F04+F08: cross-file topological batch read across Rust, C#, and Go",
        tags=("F04", "F08", "pairwise", "ordering"),
    )
    def test_t3_06_cross_file_topological_read_rust_csharp_go(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.rs", "rust/sample.rs")
            sb.seed_fixture("r5/valid/sample.cs", "cs/sample.cs")
            sb.seed_fixture("r5/valid/sample.go", "go/sample.go")

            rd = self.adapter.batch_read(
                sb, ["rust/sample.rs", "cs/sample.cs", "go/sample.go"], deps=True
            )
            assert_exit_code(rd, 0, "polyglot F04 batch read")
            assert_stdout_contains(rd, "LedgerStats")
            assert_stdout_contains(rd, "AccountService")
            assert_stdout_contains(rd, "SumAmounts")

    @e2e_case(
        case_id="T3-07",
        tier=3,
        feature="F05",
        title="F05+F07: intra-function @block and symbol slicing across TS, Python, CSS, HTML, Twig",
        tags=("F05", "F07", "pairwise", "intra-ast"),
    )
    def test_t3_07_intra_ast_and_symbol_slicing_across_web_script(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("r5/valid/sample.py", "src/sample.py")
            sb.seed_fixture("r5/valid/sample.css", "web/sample.css")
            sb.seed_fixture("r5/valid/sample.html", "web/sample.html")
            sb.seed_fixture("r5/valid/sample.twig", "web/sample.twig")

            rd = self.adapter.batch_read(
                sb,
                [
                    "src/monolith.ts:processBatchMonolith@normalize",
                    "src/sample.py:apply_delta",
                    "web/sample.css:.status-card",
                    "web/sample.html:#status-card",
                    "web/sample.twig",
                ],
            )
            assert_exit_code(rd, 0, "F05+F07 intra-AST polyglot read")
            assert_stdout_contains(rd, "normalize")
            assert_stdout_contains(rd, "apply_delta")
            assert_stdout_contains(rd, "status-card")
            assert_stdout_contains(rd, "title")

    @e2e_case(
        case_id="T3-08",
        tier=3,
        feature="F06",
        title="F06+F07: SQL CTE, PL/pgSQL function, T-SQL proc, and GraphQL slicing in AICE IR",
        tags=("F06", "F07", "pairwise", "database"),
    )
    def test_t3_08_db_cte_plpgsql_tsql_graphql_slicing(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r6/valid/ansi.sql", "db/ansi.sql")
            sb.seed_fixture("r6/valid/postgres_plpgsql.sql", "db/pg.sql")
            sb.seed_fixture("r6/valid/tsql_proc.sql", "db/tsql.sql")
            sb.seed_fixture("r6/valid/api.graphql", "db/api.graphql")

            rd = self.adapter.batch_read(
                sb,
                [
                    "db/ansi.sql:active_accounts",
                    "db/pg.sql:credit_account",
                    "db/tsql.sql:ProcessLedgerBatch",
                    "db/api.graphql:Query",
                ],
            )
            assert_exit_code(rd, 0, "F06+F07 DB slicing")
            assert_stdout_contains(rd, "active_accounts")
            assert_stdout_contains(rd, "credit_account")
            assert_stdout_contains(rd, "ProcessLedgerBatch")
            assert_stdout_contains(rd, "Query")

    @e2e_case(
        case_id="T3-09",
        tier=3,
        feature="F07",
        title="F07+F10: >50KB symbol + >120L auto-outline + :L1-L4 coalesced in 1 batch read (B-R3)",
        tags=("F07", "F10", "pairwise", "large-file"),
    )
    def test_t3_09_large_file_outline_and_line_range_batch(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/huge_over_50kb.ts", "src/huge.ts")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            rd = self.adapter.batch_read(
                sb,
                ["src/huge.ts:lateTarget", "src/monolith.ts", "src/math.ts:L1-L4"],
            )
            assert_exit_code(rd, 0, "F07+F10 coalesced batch")
            assert_no_ast_fallback_marker(rd, "F07+F10")
            assert_stdout_contains(rd, "lateTarget")
            assert_stdout_contains(rd, "processBatchMonolith")
            assert_stdout_contains(rd, "CalcResult")

    @e2e_case(
        case_id="T3-10",
        tier=3,
        feature="F08",
        title="F08+F10: --deps with --max-tokens preserves high-priority dependencies before callers",
        tags=("F08", "F10", "pairwise", "budget"),
    )
    def test_t3_10_deps_and_max_tokens_budget_priority(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_fixture("graph/handler.spec.ts", "src/handler.spec.ts")

            rd = self.adapter.batch_read(
                sb,
                ["src/types.ts", "src/service.ts", "src/handler.ts", "src/handler.spec.ts"],
                deps=True,
                max_tokens=220,
            )
            assert_exit_code(rd, 0, "--deps + --max-tokens")
            assert_stdout_contains(rd, "LedgerRecord")
            p_types = rd.stdout.find("types.ts")
            p_spec = rd.stdout.find("handler.spec.ts")
            if p_spec != -1:
                self.assertLess(p_types, p_spec, rd.stdout)

    @e2e_case(
        case_id="T3-11",
        tier=3,
        feature="F09",
        title="F09+F07: search emits AICE snippets and fuzzy guesser resolves typo'd symbol into slice",
        tags=("F09", "F07", "pairwise", "guessing"),
    )
    def test_t3_11_search_aice_snippets_and_fuzzy_slice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            srch = self.adapter.search(sb, "Calculator")
            assert_exit_code(srch, 0, "search Calculator")
            assert_no_ast_fallback_marker(srch)
            assert_stdout_contains(srch, "src/math.ts")

            fuzzy = self.adapter.read_file(sb, "src/math.ts", selector="Calculater.mul")
            assert_exit_code(fuzzy, 0, "fuzzy Calculater.mul")
            assert_stdout_contains(fuzzy, "mul")

    @e2e_case(
        case_id="T3-12",
        tier=3,
        feature="F09",
        title="F09+F03: find and search telemetry baseline never inflates to full unread corpus (B-T3)",
        tags=("F09", "F03", "pairwise", "telemetry", "anti-bypass"),
    )
    def test_t3_12_find_and_search_telemetry_baseline_honesty(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/huge_over_50kb.ts", "src/huge.ts")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            huge_bytes = len(sb.read_bytes("src/huge.ts"))

            assert_exit_code(self.adapter.find(sb), 0, "find")
            assert_exit_code(self.adapter.search(sb, "CalcResult"), 0, "search CalcResult")

            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            for row in rows:
                self.assertLess(
                    row["nc"],
                    huge_bytes // 2,
                    f"Discovery telemetry baseline inflated to unread corpus: {row!r}",
                )

    @e2e_case(
        case_id="T3-13",
        tier=3,
        feature="F11",
        title="F11+F04: surgical hunk + :eof + --insert-after on Rust & Go with balanced-brace firewall",
        tags=("F11", "F04", "pairwise", "anti-bypass"),
    )
    def test_t3_13_surgical_splice_rust_and_go_firewall(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.rs", "src/sample.rs")
            sb.seed_fixture("graph/app.go", "src/app.go")

            ins_rs = self.adapter.splice_single(
                sb,
                "src/sample.rs",
                insert_after="accumulate_delta",
                code="pub fn reset_stats(stats: &mut LedgerStats) {\n    stats.count = 0;\n    stats.total = 0;\n}",
            )
            assert_exit_code(ins_rs, 0, "Rust --insert-after")
            self.assertIn("pub fn reset_stats", sb.read_text("src/sample.rs"))

            hunk_go = (
                "<<<\n"
                "\t\treturn fallback\n"
                "===\n"
                "\t\treturn fallback + \"!\"\n"
                ">>>\n"
            )
            sp_go = self.adapter.splice_heredoc(sb, hunk_go, path="src/app.go")
            assert_exit_code(sp_go, 0, "Go hunk splice")
            go_disk = sb.read_text("src/app.go")
            self.assertIn("<-chan string", go_disk)
            self.assertIn("ret <-chan literal must stay intact", go_disk)

            before = sb.snapshot_tree()
            bad_rs = self.adapter.splice_single(
                sb,
                "src/sample.rs",
                symbol="reset_stats",
                code="pub fn reset_stats(stats: &mut LedgerStats) {\n    let x = ;\n}",
                force=True,
            )
            assert_exit_code(bad_rs, 1, "Rust balanced-brace firewall")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T3-14",
        tier=3,
        feature="F11",
        title="F11+F05: Python and Bash splice under PATH='' rejects invalid syntax in-process (B-W4)",
        tags=("F11", "F05", "pairwise", "anti-bypass"),
    )
    def test_t3_14_python_and_bash_splice_in_process_under_empty_path(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.py", "src/sample.py")
            sb.seed_fixture("r5/valid/sample.sh", "scripts/sample.sh")

            ok_py = self.adapter.splice_single(
                sb,
                "src/sample.py",
                symbol="apply_delta",
                code=(
                    "def apply_delta(entry: LedgerEntry, base: int = 0) -> int:\n"
                    '    """Apply entry delta safely."""\n'
                    "    return max(0, base + entry.delta)\n"
                ),
                env_overrides={"PATH": ""},
            )
            assert_exit_code(ok_py, 0, "Python splice PATH=''")
            self.assertIn("Apply entry delta safely.", sb.read_text("src/sample.py"))

            before = sb.snapshot_tree()
            bad_sh = self.adapter.splice_single(
                sb,
                "scripts/sample.sh",
                symbol="summarize_logs",
                code="summarize_logs() {\n  if then\n    echo broken\n  fi\n}",
                env_overrides={"PATH": ""},
            )
            assert_exit_code(bad_sh, 1, "Bash firewall PATH=''")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T3-15",
        tier=3,
        feature="F12",
        title="F12+F06: atomic DB batch across Prisma, migration SQL, and GraphQL + rollback on broken Cypher",
        tags=("F12", "F06", "pairwise", "database"),
    )
    def test_t3_15_atomic_db_batch_and_cypher_rollback(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r6/valid/schema.prisma", "prisma/schema.prisma")
            sb.seed_fixture("r6/valid/api.graphql", "graphql/api.graphql")
            sb.seed_fixture("r6/valid/graph.cypher", "queries/graph.cypher")
            bad_cypher = (FIXTURES_DIR / "r6/invalid/graph.cypher").read_text(encoding="utf-8")

            before = sb.snapshot_tree()
            bad_stream = (
                "=== migrations/V002__add_col.sql ===\n"
                "ALTER TABLE ledger_audit ADD COLUMN tag TEXT;\n"
                "=== prisma/schema.prisma ===\n"
                "<<<\n  amount    Int\n===\n  amount    Int\n  tag       String?\n>>>\n"
                "=== queries/graph.cypher ===\n"
                f"{bad_cypher}"
            )
            bad_res = self.adapter.splice_heredoc(sb, bad_stream)
            assert_exit_code(bad_res, 1, "broken Cypher rollback")
            assert_disk_file_absent(sb, "migrations/V002__add_col.sql")
            assert_disk_unchanged(sb, before)

            good_stream = (
                "=== migrations/V002__add_col.sql ===\n"
                "ALTER TABLE ledger_audit ADD COLUMN tag TEXT;\n"
                "=== prisma/schema.prisma ===\n"
                "<<<\n  amount    Int\n===\n  amount    Int\n  tag       String?\n>>>\n"
                "=== graphql/api.graphql ===\n"
                "<<<\ntype Query {\n  account(id: ID!): Account\n}\n===\ntype Query {\n  account(id: ID!): Account\n  accounts: [Account!]!\n}\n>>>\n"
            )
            good_res = self.adapter.splice_heredoc(sb, good_stream)
            assert_exit_code(good_res, 0, "valid DB batch commit")
            self.assertIn("ADD COLUMN tag TEXT", sb.read_text("migrations/V002__add_col.sql"))
            self.assertIn("tag       String?", sb.read_text("prisma/schema.prisma"))
            self.assertIn("accounts: [Account!]!", sb.read_text("graphql/api.graphql"))

    @e2e_case(
        case_id="T3-16",
        tier=3,
        feature="F12",
        title="F12+F02: --stdin batch mixing PlainText .txt + .ts + binary .bin rolls back all targets",
        tags=("F12", "F02", "pairwise", "binary-guard"),
    )
    def test_t3_16_stdin_batch_binary_target_rolls_back_all(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/notes.txt", "docs/notes.txt")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("binary/nul_payload.bin", "bin/data.bin")
            before = sb.snapshot_tree()

            stream = (
                "=== docs/notes.txt:L3-L3 ===\n"
                "Line 3: Should be rolled back.\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 55, label: "sum" };\n'
                "  }\n"
                "=== bin/data.bin ===\n"
                "overwrite binary attempt\n"
            )
            res = self.adapter.splice_heredoc(sb, stream)
            assert_exit_code(res, 1, "binary target in batch must fail and rollback")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T3-17",
        tier=3,
        feature="F13",
        title="F13+F03: MCP aice_read + aice_splice session writes honest gains.jsonl verified via gain --json",
        tags=("F13", "F03", "pairwise", "mcp", "telemetry"),
    )
    def test_t3_17_mcp_session_writes_honest_telemetry_for_gain(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            sess = self.adapter.mcp_session(
                sb,
                [
                    {
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "e2e", "version": "1.0"},
                        },
                    },
                    {"method": "notifications/initialized"},
                    {
                        "method": "tools/call",
                        "params": {"name": "aice_read", "arguments": {"path": "src/math.ts"}},
                    },
                    {
                        "method": "tools/call",
                        "params": {
                            "name": "aice_splice",
                            "arguments": {
                                "filePath": "src/app.ts",
                                "symbol": "App.reset",
                                "code": "  public reset(): number {\n    this.count = 11;\n    return this.count;\n  }",
                            },
                        },
                    },
                ],
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_text_result(sess.responses[1], "Calculator")
            assert_mcp_text_result(sess.responses[2])

            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            self.assertGreaterEqual(len(rows), 2)
            g = assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))
            self.assertGreaterEqual(g["totalOperations"], 2)

    @e2e_case(
        case_id="T3-18",
        tier=3,
        feature="F13",
        title="F13+F12: MCP aice_splice multi-file stream failure rolls back all files and emits Line:Col",
        tags=("F13", "F12", "pairwise", "mcp", "rollback"),
    )
    def test_t3_18_mcp_multi_file_splice_rollback_and_diagnostic(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            before = sb.snapshot_tree()

            stream = (
                "=== src/mcp_new.ts ===\n"
                "export const MCP_NEW = true;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 12, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.inc ===\n"
                "  public inc(step: number): CalcResult {\n"
                "    const broken = ;\n"
                "    return this.calc.add(this.count, step);\n"
                "  }\n"
            )
            resp, sess = self.adapter.mcp_call(sb, "aice_splice", {"code": stream})
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_tool_error(resp, "Line")
            assert_disk_file_absent(sb, "src/mcp_new.ts")
            assert_disk_unchanged(sb, before)
