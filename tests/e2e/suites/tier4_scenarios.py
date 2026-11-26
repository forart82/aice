"""Tier 4 Opaque-Box E2E Suite: Real-World Polyglot Application Scenarios (8 tests)."""

from __future__ import annotations

import json
import tomllib
import unittest

from harness.adapter import AiceAdapter
from harness.assertions import (
    assert_disk_file_equals,
    assert_disk_unchanged,
    assert_exit_code,
    assert_gain_json_valid,
    assert_is_aice_transformed,
    assert_mcp_strict_two_tools,
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


class TestTier4RealWorldScenarios(unittest.TestCase):
    """8 end-to-end polyglot workflow scenarios (T4-01..T4-08)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T4-01",
        tier=4,
        feature="F05",
        title="Full-stack TS + TSX + CSS refactor workflow with batch read, atomic splice, and gain",
        tags=("scenario", "fullstack", "F01", "F03", "F05", "F08", "F09", "F10", "F12"),
    )
    def test_t4_01_fullstack_ts_tsx_css_refactor(self) -> None:
        with Sandbox() as sb:
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_fixture("graph/handler.spec.ts", "src/handler.spec.ts")
            sb.seed_fixture("r5/valid/sample.tsx", "web/StatusCard.tsx")
            sb.seed_fixture("r5/valid/sample.css", "web/styles.css")

            assert_exit_code(self.adapter.enable(sb), 0, "enable")
            f_res = self.adapter.find(sb)
            assert_exit_code(f_res, 0, "find")
            assert_stdout_contains(f_res, "web/: StatusCard.tsx")
            assert_stdout_contains(f_res, "styles.css")
            assert_stdout_contains(f_res, "src/: ")

            s_res = self.adapter.search(sb, "StatusCard")
            assert_exit_code(s_res, 0, "search StatusCard")
            assert_stdout_contains(s_res, "web/StatusCard.tsx")

            b_res = self.adapter.batch_read(
                sb,
                ["web/StatusCard.tsx:StatusCard", "web/styles.css", "src/math.ts"],
                deps=True,
            )
            assert_exit_code(b_res, 0, "batch read --deps")
            assert_stdout_contains(b_res, "StatusCard")
            assert_stdout_contains(b_res, "status-card")
            assert_stdout_contains(b_res, "Calculator")

            stream = (
                "=== web/StatusCard.tsx:StatusCard ===\n"
                "export function StatusCard({ title, active }: StatusCardProps) {\n"
                "  return (\n"
                '    <section className={active ? "card card--active" : "card"}>\n'
                "      <h2>{title}</h2>\n"
                '      <span>{active ? "LIVE" : "IDLE"}</span>\n'
                "    </section>\n"
                "  );\n"
                "}\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + this.offset + 10, label: "sum" };\n'
                "  }\n"
                "=== web/styles.css ===\n"
                "<<<\n  gap: 12px;\n===\n  gap: 16px;\n>>>\n"
                "=== src/handler.spec.ts:verifyTransferSpec ===\n"
                "export function verifyTransferSpec(): boolean {\n"
                "  const rec: LedgerRecord = {\n"
                '    id: { raw: "acct-1" },\n'
                "    balance: 100,\n"
                '    currency: "USD",\n'
                "  };\n"
                "  return handleTransfer(rec, 50) === 150;\n"
                "}\n"
            )
            sp_res = self.adapter.splice_heredoc(sb, stream)
            assert_exit_code(sp_res, 0, "atomic 4-file refactor")
            self.assertIn("LIVE", sb.read_text("web/StatusCard.tsx"))
            self.assertIn("this.offset + 10", sb.read_text("src/math.ts"))
            self.assertIn("gap: 16px;", sb.read_text("web/styles.css"))
            self.assertIn("handleTransfer(rec, 50) === 150", sb.read_text("src/handler.spec.ts"))

            g = assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))
            self.assertGreaterEqual(g["totalOperations"], 4)

    @e2e_case(
        case_id="T4-02",
        tier=4,
        feature="F04",
        title="Rust + C FFI workspace feature addition with fuzzy guess, rollback, and commit",
        tags=("scenario", "rust-ffi", "F04", "F07", "F09", "F12"),
    )
    def test_t4_02_rust_and_c_ffi_feature_addition(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.c", "c/native.c")
            sb.seed_fixture("r5/valid/sample.rs", "src/engine.rs")
            sb.seed_fixture("r5/valid/sample.toml", "Cargo.toml")

            assert_exit_code(self.adapter.find(sb), 0, "find")
            fuzzy = self.adapter.read_file(sb, "src/engine.rs", selector="accumlate_delta")
            assert_exit_code(fuzzy, 0, "fuzzy guess Rust symbol")
            assert_stdout_contains(fuzzy, "accumulate_delta")

            before = sb.snapshot_tree()
            bad_stream = (
                "=== c/native.c:ledger_push ===\n"
                "int64_t ledger_push(LedgerWindow *win, int32_t value) {\n"
                "    win->count += 1;\n"
                "    win->sum += value;\n"
                "    return win->sum;\n"
                "}\n"
                "=== src/engine.rs:accumulate_delta ===\n"
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    let bad = ;\n"
                "    stats.total + delta\n"
                "}\n"
            )
            bad_sp = self.adapter.splice_heredoc(sb, bad_stream)
            assert_exit_code(bad_sp, 1, "invalid FFI batch rollback")
            assert_disk_unchanged(sb, before)

            good_stream = (
                "=== c/native.c:ledger_push ===\n"
                "int64_t ledger_push(LedgerWindow *win, int32_t value) {\n"
                "    win->count += 1;\n"
                "    win->sum += (int64_t)value * 2;\n"
                "    return win->sum;\n"
                "}\n"
                "=== src/engine.rs:accumulate_delta ===\n"
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    stats.count += 1;\n"
                "    stats.total += delta * 2;\n"
                "    stats.total\n"
                "}\n"
                "=== Cargo.toml ===\n"
                '<<<\nversion = "0.1.0"\n===\nversion = "0.2.0"\n>>>\n'
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, good_stream), 0, "valid FFI batch")
            self.assertIn("(int64_t)value * 2", sb.read_text("c/native.c"))
            self.assertIn("delta * 2", sb.read_text("src/engine.rs"))
            self.assertEqual(
                tomllib.loads(sb.read_text("Cargo.toml"))["package"]["version"],
                "0.2.0",
            )

    @e2e_case(
        case_id="T4-03",
        tier=4,
        feature="F06",
        title="Python + PostgreSQL/PLpgSQL + Migration rollout under PATH=''",
        tags=("scenario", "python-pg", "F05", "F06", "F08", "F12"),
    )
    def test_t4_03_python_postgres_migration_under_empty_path(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r6/valid/postgres_plpgsql.sql", "db/trigger_pg.sql")
            sb.seed_fixture(
                "r6/valid/migrations/V001__init_ledger.sql",
                "migrations/V001__init_ledger.sql",
            )
            sb.seed_fixture("r5/valid/sample.py", "src/worker.py")

            rd = self.adapter.batch_read(
                sb,
                ["db/trigger_pg.sql", "migrations/V001__init_ledger.sql", "src/worker.py"],
                deps=True,
                env_overrides={"PATH": ""},
            )
            assert_exit_code(rd, 0, "batch read PATH=''")
            assert_stdout_contains(rd, "credit_account")
            assert_stdout_contains(rd, "ledger_audit")
            assert_stdout_contains(rd, "apply_delta")

            stream = (
                "=== migrations/V002__audit_idx.sql ===\n"
                "-- +goose Up\n"
                "CREATE INDEX idx_ledger_audit_acct ON ledger_audit(account_id);\n"
                "-- +goose Down\n"
                "DROP INDEX IF EXISTS idx_ledger_audit_acct;\n"
                "=== db/trigger_pg.sql ===\n"
                "<<<\n    RETURN -1;\n===\n    RETURN -99;\n>>>\n"
                "=== src/worker.py:apply_delta ===\n"
                "def apply_delta(entry: LedgerEntry, base: int = 0) -> int:\n"
                "    return max(0, base + entry.delta + 1)\n"
            )
            sp = self.adapter.splice_heredoc(sb, stream, env_overrides={"PATH": ""})
            assert_exit_code(sp, 0, "atomic rollout PATH=''")
            self.assertIn("idx_ledger_audit_acct", sb.read_text("migrations/V002__audit_idx.sql"))
            self.assertIn("RETURN -99;", sb.read_text("db/trigger_pg.sql"))
            self.assertIn("entry.delta + 1", sb.read_text("src/worker.py"))
            assert_telemetry_ledger_consistent(sb, expected_min_rows=2)

    @e2e_case(
        case_id="T4-04",
        tier=4,
        feature="F06",
        title="Polyglot microservice (Go + Prisma + GraphQL + Cypher) with broken Cypher rollback then commit",
        tags=("scenario", "polyglot-microservice", "F04", "F06", "F09", "F10", "F12"),
    )
    def test_t4_04_go_prisma_graphql_cypher_rollback_then_commit(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.go", "go/ledger.go")
            sb.seed_fixture("r6/valid/schema.prisma", "prisma/schema.prisma")
            sb.seed_fixture("r6/valid/api.graphql", "graphql/api.graphql")
            sb.seed_fixture("r6/valid/graph.cypher", "queries/graph.cypher")
            bad_cypher = (FIXTURES_DIR / "r6/invalid/graph.cypher").read_text(encoding="utf-8")

            srch = self.adapter.search(sb, "Account")
            assert_exit_code(srch, 0, "search Account")
            assert_stdout_contains(srch, "schema.prisma")

            rd = self.adapter.batch_read(
                sb,
                ["go/ledger.go", "prisma/schema.prisma", "graphql/api.graphql", "queries/graph.cypher"],
            )
            assert_exit_code(rd, 0, "polyglot 4-target batch read")

            before = sb.snapshot_tree()
            bad_stream = (
                "=== prisma/schema.prisma ===\n"
                "<<<\n  balance   Int      @default(0)\n===\n  balance   Int      @default(100)\n>>>\n"
                "=== graphql/api.graphql ===\n"
                "<<<\n  balance: Int!\n===\n  balance: Int!\n  active: Boolean!\n>>>\n"
                "=== queries/graph.cypher ===\n"
                f"{bad_cypher}"
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, bad_stream), 1, "broken cypher rollback")
            assert_disk_unchanged(sb, before)

            good_stream = (
                "=== go/ledger.go:SumAmounts ===\n"
                "func SumAmounts(entries []Entry) int {\n"
                "\ttotal := 10\n"
                "\tfor _, entry := range entries {\n"
                "\t\ttotal += entry.Amount\n"
                "\t}\n"
                "\treturn total\n"
                "}\n"
                "=== prisma/schema.prisma ===\n"
                "<<<\n  balance   Int      @default(0)\n===\n  balance   Int      @default(100)\n>>>\n"
                "=== graphql/api.graphql ===\n"
                "<<<\n  owner: String!\n===\n  owner: String!\n  active: Boolean!\n>>>\n"
                "=== queries/graph.cypher ===\n"
                "<<<\nLIMIT 25;\n===\nLIMIT 40;\n>>>\n"
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, good_stream), 0, "valid 4-file commit")
            self.assertIn("total := 10", sb.read_text("go/ledger.go"))
            self.assertIn("@default(100)", sb.read_text("prisma/schema.prisma"))
            self.assertIn("active: Boolean!", sb.read_text("graphql/api.graphql"))
            self.assertIn("LIMIT 40;", sb.read_text("queries/graph.cypher"))

    @e2e_case(
        case_id="T4-05",
        tier=4,
        feature="F04",
        title="PHP + Twig + MySQL + HTML/CSS web app update with outline, batch read, and atomic splice",
        tags=("scenario", "php-twig-mysql", "F03", "F04", "F05", "F06", "F07", "F12"),
    )
    def test_t4_05_php_twig_mysql_html_css_update(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.php", "src/Controller.php")
            sb.seed_fixture("r5/valid/sample.twig", "templates/card.twig")
            sb.seed_fixture("r6/valid/mysql_proc.sql", "db/proc_mysql.sql")
            sb.seed_fixture("r5/valid/sample.html", "web/page.html")
            sb.seed_fixture("r5/valid/sample.css", "web/styles.css")

            out = self.adapter.read_file(sb, "src/Controller.php", outline=True)
            assert_exit_code(out, 0, "PHP outline")
            assert_stdout_contains(out, "LedgerCalculator")

            rd = self.adapter.batch_read(
                sb,
                [
                    "src/Controller.php",
                    "templates/card.twig",
                    "db/proc_mysql.sql",
                    "web/page.html",
                    "web/styles.css",
                ],
            )
            assert_exit_code(rd, 0, "5-file web app batch read")

            stream = (
                "=== src/Controller.php:LedgerCalculator.add ===\n"
                "    public function add(int $left, int $right): int\n"
                "    {\n"
                "        return $left + $right + 2;\n"
                "    }\n"
                "=== templates/card.twig ===\n"
                "<<<\n  <h3>{{ title|upper }}</h3>\n===\n  <h3>{{ title|trim|upper }}</h3>\n>>>\n"
                "=== db/proc_mysql.sql ===\n"
                "<<<\n    balance = balance + VALUES(balance);\n===\n    balance = balance + VALUES(balance), owner_name = VALUES(owner_name);\n>>>\n"
                "=== web/page.html ===\n"
                "<<<\n      <h1>Ledger Ready</h1>\n===\n      <h1>Ledger Active</h1>\n>>>\n"
                "=== web/styles.css ===\n"
                "<<<\n  padding: 16px;\n===\n  padding: 24px;\n>>>\n"
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, stream), 0, "5-file web app splice")
            self.assertIn("$left + $right + 2", sb.read_text("src/Controller.php"))
            self.assertIn("title|trim|upper", sb.read_text("templates/card.twig"))
            self.assertIn("owner_name = VALUES(owner_name)", sb.read_text("db/proc_mysql.sql"))
            self.assertIn("<h1>Ledger Active</h1>", sb.read_text("web/page.html"))
            self.assertIn("padding: 24px;", sb.read_text("web/styles.css"))
            assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))

    @e2e_case(
        case_id="T4-06",
        tier=4,
        feature="F06",
        title="Multi-dialect DB modernization (ANSI SQL + SQLite STRICT + T-SQL + YAML/JSON)",
        tags=("scenario", "db-modernization", "F05", "F06", "F11", "F12"),
    )
    def test_t4_06_multi_dialect_db_modernization(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r6/valid/ansi.sql", "db/ansi.sql")
            sb.seed_fixture("r6/valid/sqlite_pragma.sql", "db/sqlite_pragma.sql")
            sb.seed_fixture("r6/valid/tsql_proc.sql", "db/tsql_proc.sql")
            sb.seed_fixture("r5/valid/sample.yaml", "deploy/config.yaml")
            sb.seed_fixture("r5/valid/sample.json", "deploy/manifest.json")

            rd = self.adapter.batch_read(
                sb,
                [
                    "db/ansi.sql",
                    "db/sqlite_pragma.sql",
                    "db/tsql_proc.sql",
                    "deploy/config.yaml",
                    "deploy/manifest.json",
                ],
            )
            assert_exit_code(rd, 0, "multi-dialect batch read")

            # Verify invalid SQL dialect rejections leave disk untouched
            before = sb.snapshot_tree()
            for inv_rel, dest_rel in (
                ("r6/invalid/ansi.sql", "db/ansi.sql"),
                ("r6/invalid/sqlite_pragma.sql", "db/sqlite_pragma.sql"),
                ("r6/invalid/tsql_proc.sql", "db/tsql_proc.sql"),
            ):
                bad_sql = (FIXTURES_DIR / inv_rel).read_text(encoding="utf-8")
                bad_res = self.adapter.splice_single(sb, dest_rel, code=bad_sql, overwrite=True)
                assert_exit_code(bad_res, 1, f"invalid dialect {inv_rel}")
            assert_disk_unchanged(sb, before)

            good_stream = (
                "=== db/ansi.sql ===\n"
                "<<<\n  WHERE balance > 0\n===\n  WHERE balance >= 5\n>>>\n"
                "=== db/sqlite_pragma.sql ===\n"
                "<<<\nWHERE seq > 0\n===\nWHERE seq >= 10\n>>>\n"
                "=== db/tsql_proc.sql ===\n"
                "<<<\n    SET Balance = Balance + @Delta\n===\n    SET Balance = Balance + @Delta + 1\n>>>\n"
                "=== deploy/config.yaml ===\n"
                "<<<\n  replicas: 3\n===\n  replicas: 4\n>>>\n"
                "=== deploy/manifest.json ===\n"
                '<<<\n    "astFirewall": true,\n===\n    "astFirewall": false,\n>>>\n'
            )
            assert_exit_code(self.adapter.splice_heredoc(sb, good_stream), 0, "valid modernization batch")
            self.assertIn("WHERE balance >= 5", sb.read_text("db/ansi.sql"))
            self.assertIn("WHERE seq >= 10", sb.read_text("db/sqlite_pragma.sql"))
            self.assertIn("@Delta + 1", sb.read_text("db/tsql_proc.sql"))
            self.assertIn("replicas: 4", sb.read_text("deploy/config.yaml"))
            self.assertFalse(json.loads(sb.read_text("deploy/manifest.json"))["features"]["astFirewall"])

    @e2e_case(
        case_id="T4-07",
        tier=4,
        feature="F07",
        title="Large-file monorepo triage (>120L, >50KB, .git, node_modules, PlainText, binary)",
        tags=("scenario", "monorepo-triage", "F02", "F03", "F07", "F09", "F11"),
    )
    def test_t4_07_large_file_monorepo_triage(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("graph/huge_over_50kb.ts", "src/huge.ts")
            sb.seed_fixture("plaintext/notes.txt", "docs/notes.txt")
            sb.seed_fixture("binary/logo.png", "assets/logo.png")
            sb.seed_file(".git/HEAD", "ref: refs/heads/main\n")
            sb.seed_file("node_modules/dep/index.js", "module.exports = {};\n")

            f_res = self.adapter.find(sb)
            assert_exit_code(f_res, 0, "monorepo find")
            assert_stdout_contains(f_res, "src/monolith.ts")
            assert_stdout_contains(f_res, "src/huge.ts")
            assert_stdout_not_contains(f_res, ".git/HEAD")
            assert_stdout_not_contains(f_res, "node_modules")
            assert_stdout_not_contains(f_res, "assets/logo.png")

            s_res = self.adapter.search(sb, "lateTarget")
            assert_exit_code(s_res, 0, "search lateTarget")
            assert_stdout_contains(s_res, "src/huge.ts")

            out_res = self.adapter.read_file(sb, "src/monolith.ts")
            assert_exit_code(out_res, 0, "auto-outline monolith.ts")
            assert_stdout_contains(out_res, "processBatchMonolith")
            assert_stdout_not_contains(out_res, "const stepZ = stepY + 67;")

            b_res = self.adapter.batch_read(
                sb,
                [
                    "src/huge.ts:lateTarget",
                    "src/monolith.ts:processBatchMonolith@normalize",
                    "docs/notes.txt:L1-L2",
                ],
            )
            assert_exit_code(b_res, 0, "triage batch read")
            assert_no_ast_fallback_marker(b_res)
            assert_no_raw_binary_bytes(b_res.stdout_bytes)
            assert_stdout_contains(b_res, "lateTarget")
            assert_stdout_contains(b_res, "normalize")
            assert_stdout_contains(b_res, "[a+b]*(c?)")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n  return x * 42;\n===\n  return x * 84;\n>>>\n",
                path="src/huge.ts",
            )
            assert_exit_code(sp, 0, "surgical splice on >50KB file")
            self.assertIn("return x * 84;", sb.read_text("src/huge.ts"))
            assert_telemetry_ledger_consistent(
                sb, expected_min_rows=4, check_o200k_distinct_across_rows=True
            )

    @e2e_case(
        case_id="T4-08",
        tier=4,
        feature="F13",
        title="MCP agent end-to-end coding session: init -> tools/list -> read -> failed splice -> valid splice -> gain",
        tags=("scenario", "mcp-e2e", "F01", "F02", "F03", "F12", "F13"),
    )
    def test_t4_08_mcp_agent_end_to_end_coding_session(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")
            before_app = sb.read_text("src/app.ts")

            valid_stream = (
                "=== src/mcp_helper.ts ===\n"
                "export const MCP_VERSION = 1;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + this.offset + 20, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.reset ===\n"
                "  public reset(): number {\n"
                "    this.count = 20;\n"
                "    return this.count;\n"
                "  }\n"
            )
            sess = self.adapter.mcp_session(
                sb,
                [
                    {
                        "method": "initialize",
                        "params": {
                            "protocolVersion": "2024-11-05",
                            "capabilities": {},
                            "clientInfo": {"name": "e2e-session", "version": "1.0"},
                        },
                    },
                    {"method": "notifications/initialized"},
                    {"method": "tools/list", "params": {}},
                    {
                        "method": "tools/call",
                        "params": {
                            "name": "aice_read",
                            "arguments": {"paths": ["src/app.ts", "src/math.ts", "bin/logo.png"]},
                        },
                    },
                    {
                        "method": "tools/call",
                        "params": {
                            "name": "aice_splice",
                            "arguments": {
                                "filePath": "src/app.ts",
                                "symbol": "App.inc",
                                "code": "  public inc(step: number): CalcResult {\n    const x = ;\n  }",
                            },
                        },
                    },
                    {
                        "method": "tools/call",
                        "params": {
                            "name": "aice_splice",
                            "arguments": {"code": valid_stream},
                        },
                    },
                ],
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            self.assertEqual(len(sess.responses), 5)
            assert_mcp_strict_two_tools(sess.responses[1])

            read_txt = assert_mcp_text_result(sess.responses[2])
            assert_no_raw_binary_bytes(read_txt.encode("utf-8"), "mcp batch read")
            self.assertIn("Calculator", read_txt)
            self.assertIn("App", read_txt)
            self.assertIn("binary", read_txt.lower())

            assert_mcp_tool_error(sess.responses[3], "Line")
            assert_mcp_text_result(sess.responses[4])

            assert_disk_file_equals(sb, "src/mcp_helper.ts", "export const MCP_VERSION = 1;\n")
            self.assertIn("this.offset + 20", sb.read_text("src/math.ts"))
            self.assertIn("this.count = 20;", sb.read_text("src/app.ts"))
            self.assertIn("/** Increment counter and compute sum */", sb.read_text("src/app.ts"))
            self.assertNotEqual(sb.read_text("src/app.ts"), before_app)

            g = assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))
            self.assertGreaterEqual(g["totalOperations"], 2)
