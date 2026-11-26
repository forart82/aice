"""Pre-binary self-tests verifying harness isolation, adapter contracts, and anti-tautology."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path

from harness.adapter import AiceAdapter
from harness.assertions import (
    assert_disk_file_absent,
    assert_disk_unchanged,
    assert_exit_code,
    assert_gain_json_valid,
    assert_gain_project_json_valid,
    assert_is_aice_transformed,
    assert_mcp_strict_two_tools,
    assert_mcp_text_result,
    assert_mcp_tool_error,
    assert_no_raw_binary_bytes,
    assert_telemetry_ledger_consistent,
    assert_tmp_telemetry_suppressed,
    assert_zero_aice_artifacts,
)
from harness.config import E2E_DIR, FIXTURES_DIR, ROOT_DIR
from harness.reporting import build_json_report, e2e_case
from harness.sandbox import Sandbox

MOCK_BIN = Path(__file__).resolve().parent / "mock_aice.py"
RUNNER = E2E_DIR / "run_e2e.py"


class HarnessSelfTest(unittest.TestCase):
    """Self-tests proving non-tautological assertions and complete sandbox isolation."""

    @e2e_case(
        case_id="SELF-01",
        tier=1,
        feature="F01",
        title="Dry-run discovery works pre-binary and emits valid JSON report",
        tags=("self-test", "dry-run"),
    )
    def test_dry_run_and_json_report_schema(self) -> None:
        with Sandbox() as sb:
            report_path = sb.path("dry_report.json", area="outside")
            proc = subprocess.run(
                [
                    sys.executable,
                    str(RUNNER),
                    "--dry-run",
                    "--tier",
                    "all",
                    "--bin",
                    "/nonexistent/aice-missing",
                    "--json-report",
                    str(report_path),
                ],
                capture_output=True,
                text=True,
                check=False,
            )
            self.assertEqual(proc.returncode, 0, proc.stderr)
            self.assertIn("AICE E2E Dry-Run Discovery", proc.stdout)
            data = json.loads(report_path.read_text(encoding="utf-8"))
            for key in (
                "schema_version",
                "timestamp_utc",
                "aice_bin",
                "mode",
                "summary",
                "tier_counts",
                "feature_counts",
                "cases",
            ):
                self.assertIn(key, data)
            self.assertEqual(data["mode"], "dry-run")
            self.assertTrue(data["summary"]["success"])

    @e2e_case(
        case_id="SELF-02",
        tier=1,
        feature="F01",
        title="Missing binary returns exit code 2 on live run",
        tags=("self-test", "cli"),
    )
    def test_missing_binary_exits_two(self) -> None:
        proc = subprocess.run(
            [
                sys.executable,
                str(RUNNER),
                "--bin",
                "/nonexistent/target/release/aice",
            ],
            capture_output=True,
            text=True,
            check=False,
        )
        self.assertEqual(proc.returncode, 2, proc.stderr)

    @e2e_case(
        case_id="SELF-03",
        tier=1,
        feature="F03",
        title="Sandbox isolates ws/home/outside, env vars, /tmp suppression, and cleans up on exception",
        tags=("self-test", "sandbox"),
    )
    def test_sandbox_isolation_and_cleanup_on_exception(self) -> None:
        captured_base: Path | None = None
        try:
            with Sandbox() as sb:
                captured_base = sb.base_dir
                self.assertTrue(sb.ws.is_dir())
                self.assertTrue(sb.home.is_dir())
                self.assertTrue(sb.outside.is_dir())
                self.assertNotEqual(sb.ws.resolve(), ROOT_DIR.resolve())

                env = sb.build_env({"PATH": ""})
                self.assertEqual(env["HOME"], str(sb.home))
                self.assertEqual(env["NO_COLOR"], "1")
                self.assertEqual(env["CI"], "1")
                self.assertEqual(env["AICE_HOME"], str(sb.aice_home))
                self.assertEqual(env["AICE_TELEMETRY_PATH"], str(sb.telemetry_path))
                self.assertEqual(env["PATH"], "")
                raise RuntimeError("deliberate exception to test cleanup")
        except RuntimeError:
            pass
        assert captured_base is not None
        self.assertFalse(
            captured_base.exists(),
            f"Sandbox directory survived exception: {captured_base}",
        )

        with Sandbox(suppress_tmp_telemetry=True) as sb_sup:
            env_sup = sb_sup.build_env()
            for k in ("AICE_HOME", "AICE_TELEMETRY_PATH", "AICE_TELEMETRY_DIR"):
                self.assertNotIn(k, env_sup)

    @e2e_case(
        case_id="SELF-04",
        tier=1,
        feature="F05",
        title="Compliant mock passes AICE IR, telemetry, MCP newline/Content-Length, and rollback checks",
        tags=("self-test", "compliant"),
    )
    def test_compliant_mock_passes_all_checks(self) -> None:
        adapter = AiceAdapter(MOCK_BIN)
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "compliant"}) as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            sb.seed_fixture("binary/logo.png", "assets/logo.png")
            raw_ts = sb.read_text("src/sample.ts")

            res_read = adapter.read_file(sb, "src/sample.ts")
            assert_exit_code(res_read, 0, "compliant read")
            assert_is_aice_transformed(res_read.stdout, "ts", raw_ts, "compliant read")

            # Negative-delta tiny read + multi-line big.ts read -> telemetry ledger checks
            bpe = json.loads((FIXTURES_DIR / "bpe_vectors.json").read_text(encoding="utf-8"))
            sb.seed_file("src/big.ts", bpe["vectors"]["big_ts"]["text"])
            sb.seed_fixture("plaintext/tiny.ts", "src/tiny.ts")
            assert_exit_code(adapter.read_file(sb, "src/big.ts"), 0)
            assert_exit_code(adapter.read_file(sb, "src/tiny.ts"), 0)
            assert_telemetry_ledger_consistent(
                sb,
                expected_min_rows=3,
                check_o200k_distinct_across_rows=True,
                check_negative_deltas_allowed=True,
            )

            res_bin = adapter.read_file(sb, "assets/logo.png")
            assert_exit_code(res_bin, 0)
            assert_no_raw_binary_bytes(res_bin.stdout_bytes)

            gain_res = adapter.gain(sb)
            assert_gain_json_valid(gain_res)
            gain_proj_res = adapter.run_raw(
                sb, ["gain", "-p", str(sb.ws), "--json"], expect_json=True
            )
            g_proj = assert_gain_project_json_valid(gain_proj_res)
            self.assertEqual(g_proj["project"]["projectName"], sb.ws.name)

            # MCP newline & Content-Length framing
            for framing in ("newline", "content-length"):
                sess = adapter.mcp_session(
                    sb,
                    [
                        {"method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
                        {"method": "notifications/initialized"},
                        {"method": "tools/list", "params": {}},
                        {
                            "method": "tools/call",
                            "params": {"name": "aice_read", "arguments": {"path": "src/sample.ts"}},
                        },
                        {
                            "method": "tools/call",
                            "params": {"name": "aice_context", "arguments": {}},
                        },
                    ],
                    framing=framing,  # type: ignore[arg-type]
                )
                self.assertEqual(sess.exit_code, 0, sess.stderr)
                assert_mcp_strict_two_tools(sess.responses[1])
                assert_mcp_text_result(sess.responses[2], "sample")
                assert_mcp_tool_error(sess.responses[3], "Unknown tool")

            # Firewall failure leaves disk untouched
            before = sb.snapshot_tree()
            bad_res = adapter.splice_single(
                sb, "src/sample.ts", code="export function f() { const x = ; }"
            )
            assert_exit_code(bad_res, 1)
            assert_disk_unchanged(sb, before)

        # /tmp telemetry suppression check
        with Sandbox(
            suppress_tmp_telemetry=True, env_overrides={"AICE_MOCK_MODE": "compliant"}
        ) as sb_tmp:
            sb_tmp.seed_config("enabled")
            sb_tmp.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            assert_exit_code(adapter.read_file(sb_tmp, "src/sample.ts"), 0)
            assert_tmp_telemetry_suppressed(sb_tmp.home)

    @e2e_case(
        case_id="SELF-05",
        tier=4,
        feature="F02",
        title="Anti-tautology: all 5 buggy AICE_MOCK_MODE modes fail their target assertions",
        tags=("self-test", "anti-tautology"),
    )
    def test_buggy_mock_modes_fail_assertions(self) -> None:
        adapter = AiceAdapter(MOCK_BIN)

        # 1. leak_raw MUST fail assert_is_aice_transformed
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "leak_raw"}) as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            raw = sb.read_text("src/sample.ts")
            res = adapter.read_file(sb, "src/sample.ts")
            assert_exit_code(res, 0)
            with self.assertRaises(AssertionError):
                assert_is_aice_transformed(res.stdout, "ts", raw)

        # 2. mutate_on_firewall_fail MUST fail assert_disk_unchanged
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "mutate_on_firewall_fail"}) as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()
            res = adapter.splice_single(
                sb, "src/sample.ts", code="export function broken() { let x = ; }"
            )
            assert_exit_code(res, 1)
            with self.assertRaises(AssertionError):
                assert_disk_unchanged(sb, before)

        # 3. allow_when_disabled MUST fail assert_exit_code(..., 1)
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "allow_when_disabled"}) as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            res = adapter.read_file(sb, "src/sample.ts")
            with self.assertRaises(AssertionError):
                assert_exit_code(res, 1)

        # 4. extra_mcp_tool MUST fail assert_mcp_strict_two_tools
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "extra_mcp_tool"}) as sb:
            sb.seed_config("enabled")
            sess = adapter.mcp_session(
                sb,
                [
                    {"method": "initialize", "params": {"protocolVersion": "2024-11-05"}},
                    {"method": "notifications/initialized"},
                    {"method": "tools/list", "params": {}},
                ],
            )
            with self.assertRaises(AssertionError):
                assert_mcp_strict_two_tools(sess.responses[1])

        # 5. partial_rollback MUST fail assert_disk_unchanged & assert_disk_file_absent
        with Sandbox(env_overrides={"AICE_MOCK_MODE": "partial_rollback"}) as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/existing.ts")
            before = sb.snapshot_tree()
            stream = (
                "=== src/new_ok.ts ===\nexport const ok = 1;\n"
                "=== src/existing.ts ===\nexport function broken() { const x = ; }\n"
            )
            res = adapter.splice_heredoc(sb, stream)
            assert_exit_code(res, 1)
            with self.assertRaises(AssertionError):
                assert_disk_unchanged(sb, before)
            with self.assertRaises(AssertionError):
                assert_disk_file_absent(sb, "src/new_ok.ts")

    @e2e_case(
        case_id="SELF-06",
        tier=2,
        feature="F04",
        title="Fixture corpus completeness & structural integrity checks",
        tags=("self-test", "fixtures"),
    )
    def test_fixture_corpus_completeness(self) -> None:
        expected_r5 = [
            "sample.json",
            "sample.yaml",
            "sample.toml",
            "sample.md",
            "sample.html",
            "sample.css",
            "sample.xml",
            "sample.svg",
            "sample.twig",
            "sample.sh",
            "sample.py",
            "sample.js",
            "sample.ts",
            "sample.tsx",
            "sample.php",
            "sample.rb",
            "sample.rs",
            "sample.go",
            "sample.c",
            "sample.cpp",
            "sample.cs",
            "sample.java",
            "sample.kt",
            "sample.dart",
        ]
        for fname in expected_r5:
            self.assertTrue((FIXTURES_DIR / "r5/valid" / fname).is_file(), fname)
            self.assertTrue((FIXTURES_DIR / "r5/invalid" / fname).is_file(), fname)

        # Balanced-brace check for systems/OOP invalid fixtures
        for fname in (
            "sample.rs",
            "sample.go",
            "sample.c",
            "sample.cpp",
            "sample.cs",
            "sample.java",
            "sample.kt",
            "sample.dart",
            "sample.php",
            "sample.ts",
            "sample.tsx",
            "sample.js",
        ):
            txt = (FIXTURES_DIR / "r5/invalid" / fname).read_text(encoding="utf-8")
            self.assertEqual(txt.count("{"), txt.count("}"), f"Unbalanced {{}} in {fname}")
            self.assertEqual(txt.count("("), txt.count(")"), f"Unbalanced () in {fname}")

        expected_r6 = [
            "ansi.sql",
            "postgres_plpgsql.sql",
            "mysql_proc.sql",
            "sqlite_pragma.sql",
            "tsql_proc.sql",
            "schema.prisma",
            "api.graphql",
            "graph.cypher",
            "migrations/V001__init_ledger.sql",
        ]
        for fname in expected_r6:
            self.assertTrue((FIXTURES_DIR / "r6/valid" / fname).is_file(), fname)
            self.assertTrue((FIXTURES_DIR / "r6/invalid" / fname).is_file(), fname)

        self.assertGreater(
            (FIXTURES_DIR / "graph/huge_over_50kb.ts").stat().st_size, 55 * 1024
        )
        self.assertGreater(
            len((FIXTURES_DIR / "graph/monolith.ts").read_text(encoding="utf-8").splitlines()),
            125,
        )
        boundary = (FIXTURES_DIR / "binary/boundary_utf8.txt").read_bytes()
        self.assertGreater(len(boundary), 8192)
        boundary.decode("utf-8")
        self.assertIn(b"\x00", (FIXTURES_DIR / "binary/nul_disguised.txt").read_bytes())
        with self.assertRaises(UnicodeDecodeError):
            (FIXTURES_DIR / "binary/invalid_utf8.txt").read_bytes().decode("utf-8")
        self.assertTrue(
            (FIXTURES_DIR / "binary/logo.png").read_bytes().startswith(b"\x89PNG\r\n\x1a\n")
        )
        bpe = json.loads((FIXTURES_DIR / "bpe_vectors.json").read_text(encoding="utf-8"))
        self.assertEqual(bpe["vectors"]["big_ts"]["cl100k_base"], 1222)
        self.assertEqual(bpe["vectors"]["big_ts"]["o200k_base"], 1223)
        self.assertEqual(bpe["vectors"]["math_ts"]["cl100k_base"], 111)

        # Ensure build_json_report works with empty cases too
        rep = build_json_report(aice_bin=MOCK_BIN, mode="dry-run", cases_meta=[])
        self.assertEqual(rep["summary"]["total"], 0)

    @e2e_case(
        case_id="SELF-07",
        tier=4,
        feature="F02",
        title="Regression checks: assertion sensitivity probes, stray .aice artifacts, and empty-dir snapshot",
        tags=("self-test", "regression", "anti-tautology"),
    )
    def test_adversarial_assertion_sensitivity_regressions(self) -> None:
        # 1. Markdown header wrap must NOT disguise verbatim Markdown
        raw_md = (FIXTURES_DIR / "r5/valid/sample.md").read_text(encoding="utf-8")
        with self.assertRaises(AssertionError):
            assert_is_aice_transformed(
                f"// sample.md [AICE IR]\n{raw_md}", "markdown", raw_md, "md header wrap"
            )
        with self.assertRaises(AssertionError):
            assert_is_aice_transformed(raw_md, "markdown", raw_md, "md verbatim")

        # 2. Header + footer wrap on C# / PHP must NOT pass 3-line block filter mismatch
        for fname, lang in (("sample.cs", "cs"), ("sample.php", "php")):
            raw_src = (FIXTURES_DIR / "r5/valid" / fname).read_text(encoding="utf-8")
            cheated = f"// {fname} [AICE IR]\n{raw_src}\n// [stats: 100 -> 100 tokens]"
            with self.assertRaises(AssertionError):
                assert_is_aice_transformed(cheated, lang, raw_src, f"{fname} footer wrap")

        # 3. Line-numbered raw wrap ("N│ <raw>", "N: <raw>", "LN: <raw>") must fail assert_is_aice_transformed
        raw_ts = (FIXTURES_DIR / "r5/valid/sample.ts").read_text(encoding="utf-8")
        for gutter_fmt in ("{n}│ {ln}", "{n}: {ln}", "L{n}: {ln}"):
            numbered_bare = "\n".join(
                gutter_fmt.format(n=i + 1, ln=ln) for i, ln in enumerate(raw_ts.splitlines())
            )
            with self.assertRaises(AssertionError):
                assert_is_aice_transformed(
                    numbered_bare, "ts", raw_ts, f"line-numbered bare ({gutter_fmt})"
                )
            numbered_full = "// sample.ts [AICE IR]\n" + numbered_bare
            with self.assertRaises(AssertionError):
                assert_is_aice_transformed(
                    numbered_full, "ts", raw_ts, f"line-numbered wrap ({gutter_fmt})"
                )
            numbered_partial = "// sample.ts [AICE IR]\n// extra summary\n" + "\n".join(
                gutter_fmt.format(n=i + 1, ln=ln) for i, ln in enumerate(raw_ts.splitlines()[1:6])
            )
            with self.assertRaises(AssertionError):
                assert_is_aice_transformed(
                    numbered_partial, "ts", raw_ts, f"line-numbered partial ({gutter_fmt})"
                )

        # 3b. Comment-heavy TypeScript (>=20-word header) passes on valid IR and fails on bogus output
        comment_heavy_ts = (
            "// Copyright Twenty Sixteen Example Organization All Rights Reserved\n"
            "// Licensed under the Apache License Version Two Zero for internal\n"
            "// distributed ledger checksum verification utilities across multiple\n"
            "// autonomous worker runtimes without implied warranty of any kind\n"
            "export function computeLedgerChecksum(amount: number): number {\n"
            "  return amount * 2;\n"
            "}\n"
        )
        assert_is_aice_transformed(
            "fn computeLedgerChecksum(amount:num) -> num = amount * 2\n",
            "ts",
            comment_heavy_ts,
            "comment-heavy-ts valid IR",
        )
        with self.assertRaises(AssertionError):
            assert_is_aice_transformed(
                "module Copyright\nfn TwentySixteen(): int = 0\n",
                "ts",
                comment_heavy_ts,
                "comment-heavy-ts bogus comment-word-only output",
            )
        with self.assertRaises(AssertionError):
            assert_is_aice_transformed(
                "module bogus\nfn totallyUnrelated(): int = 0\n",
                "ts",
                comment_heavy_ts,
                "comment-heavy-ts bogus output",
            )

        # 4. Non-dict 3rd MCP tool / invalid entries / non-dict result must fail assert_mcp_strict_two_tools
        with self.assertRaises(AssertionError):
            assert_mcp_strict_two_tools(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "tools": [
                            {"name": "aice_read"},
                            {"name": "aice_splice"},
                            "hidden_str",
                        ]
                    },
                }
            )
        with self.assertRaises(AssertionError):
            assert_mcp_strict_two_tools(
                {
                    "jsonrpc": "2.0",
                    "id": 1,
                    "result": {
                        "tools": [{"name": "aice_read"}, {"name": "aice_read"}]
                    },
                }
            )
        with self.assertRaises(AssertionError):
            assert_mcp_strict_two_tools({"jsonrpc": "2.0", "id": 1, "result": None})
        with self.assertRaises(AssertionError):
            assert_mcp_strict_two_tools({"jsonrpc": "2.0", "id": 1, "result": ["bad"]})

        # 5. Empty/whitespace "f" or "o" in telemetry ledger must fail
        with Sandbox() as sb:
            for bad_row in (
                {
                    "t": 1700000000001,
                    "r": str(sb.ws),
                    "f": "",
                    "o": "read",
                    "nc": 10,
                    "ac": 5,
                    "n1": 3,
                    "a1": 2,
                    "n2": 3,
                    "a2": 2,
                },
                {
                    "t": 1700000000001,
                    "r": str(sb.ws),
                    "f": "src/a.ts",
                    "o": "   ",
                    "nc": 10,
                    "ac": 5,
                    "n1": 3,
                    "a1": 2,
                    "n2": 3,
                    "a2": 2,
                },
            ):
                sb.telemetry_path.parent.mkdir(parents=True, exist_ok=True)
                sb.telemetry_path.write_text(json.dumps(bad_row) + "\n", encoding="utf-8")
                with self.assertRaises(AssertionError):
                    assert_telemetry_ledger_consistent(sb, expected_min_rows=1)

        # 6. assert_zero_aice_artifacts catches .aice / .aice.bak (excluding configs) & snapshot_tree catches empty dirs
        with Sandbox() as sb:
            sb.seed_file("aice.config.json", '{"enabled": true}\n')
            sb.seed_file(".aicerc", '{"enabled": true}\n')
            sb.seed_file(".aice-idioms.json", "{}\n")
            assert_zero_aice_artifacts(sb)

            for stray in ("src/a.ts.aice", "src/a.ts.aice.bak"):
                p = sb.seed_file(stray, "stray")
                with self.assertRaises(AssertionError):
                    assert_zero_aice_artifacts(sb)
                p.unlink()
            # Clean up src dir created by seed_file before empty-dir test
            (sb.ws / "src").rmdir()

            before = sb.snapshot_tree()
            empty_dir = sb.path("empty_stray_dir")
            empty_dir.mkdir()
            with self.assertRaises(AssertionError):
                assert_disk_unchanged(sb, before)
            empty_dir.rmdir()
            assert_disk_unchanged(sb, before)

        # 7. assert_gain_project_json_valid rejects global payload, missing nested keys, and invalid types
        with Sandbox() as sb:
            adapter = AiceAdapter(MOCK_BIN)
            global_gain = adapter.gain(sb)
            assert_gain_json_valid(global_gain)
            with self.assertRaises(AssertionError):
                assert_gain_project_json_valid(global_gain)

            proj_gain = adapter.run_raw(
                sb, ["gain", "-p", str(sb.ws), "--json"], expect_json=True
            )
            assert_gain_project_json_valid(proj_gain)
            with self.assertRaises(AssertionError):
                assert_gain_json_valid(proj_gain)

            from dataclasses import replace

            bad_missing_calls = json.loads(proj_gain.stdout)
            del bad_missing_calls["project"]["summary"]["calls"]
            with self.assertRaises(AssertionError):
                assert_gain_project_json_valid(
                    replace(
                        proj_gain,
                        stdout=json.dumps(bad_missing_calls),
                        stdout_json=bad_missing_calls,
                    )
                )

            bad_enabled = json.loads(proj_gain.stdout)
            bad_enabled["project"]["configStatus"]["enabled"] = "true"
            with self.assertRaises(AssertionError):
                assert_gain_project_json_valid(
                    replace(
                        proj_gain,
                        stdout=json.dumps(bad_enabled),
                        stdout_json=bad_enabled,
                    )
                )

    @e2e_case(
        case_id="SELF-08",
        tier=4,
        feature="F03",
        title="Regression check: AiceAdapter.mcp_session terminates child process on malformed JSON",
        tags=("self-test", "regression", "mcp", "isolation"),
    )
    def test_mcp_session_cleans_up_child_on_malformed_json(self) -> None:
        with Sandbox() as sb:
            pid_file = sb.path("mcp_child.pid", area="outside")
            bad_mcp = sb.path("bad_mcp.py", area="outside")
            bad_mcp.write_text(
                f"#!{sys.executable}\n"
                "import os, sys, time\n"
                f"open({str(pid_file)!r}, 'w').write(str(os.getpid()))\n"
                "sys.stdout.write('NOT_VALID_JSON\\n')\n"
                "sys.stdout.flush()\n"
                "time.sleep(10)\n",
                encoding="utf-8",
            )
            bad_mcp.chmod(0o755)

            adapter = AiceAdapter(bad_mcp)
            with self.assertRaises(json.JSONDecodeError):
                adapter.mcp_session(
                    sb,
                    [{"method": "initialize", "params": {"protocolVersion": "2024-11-05"}}],
                    timeout=2.0,
                )

            pid = int(pid_file.read_text(encoding="utf-8").strip())
            with self.assertRaises(ProcessLookupError):
                os.kill(pid, 0)
