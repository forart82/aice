"""Tier 1 Opaque-Box E2E Suite: Isolated Feature Coverage (94 tests, F01..F14)."""

from __future__ import annotations

import json
import re
import tomllib
import unittest
import xml.etree.ElementTree as ET
from typing import Any

from harness.adapter import AiceAdapter
from harness.assertions import (
    assert_disk_file_equals,
    assert_disk_unchanged,
    assert_exit_code,
    assert_gain_json_valid,
    assert_gain_project_json_valid,
    assert_is_aice_transformed,
    assert_mcp_strict_two_tools,
    assert_mcp_text_result,
    assert_no_ast_fallback_marker,
    assert_no_raw_binary_bytes,
    assert_stdout_contains,
    assert_stdout_not_contains,
    assert_telemetry_ledger_consistent,
)
from harness.config import FIXTURES_DIR
from harness.reporting import e2e_case
from harness.sandbox import Sandbox


def _load_bpe_vectors() -> dict[str, Any]:
    return json.loads((FIXTURES_DIR / "bpe_vectors.json").read_text(encoding="utf-8"))


class TestTier1F01Governance(unittest.TestCase):
    """F01: Governance, Config Discovery & CLI Admin (6 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F01-01",
        tier=1,
        feature="F01",
        title="Missing config defaults to enabled:true (GOV-01)",
        tags=("governance", "defaults"),
    )
    def test_missing_config_defaults_enabled(self) -> None:
        with Sandbox() as sb:
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            raw = sb.read_text("src/math.ts")

            st = self.adapter.status(sb, json_mode=True)
            assert_exit_code(st, 0, "status missing config")
            self.assertIsInstance(st.stdout_json, dict)
            self.assertTrue(st.stdout_json.get("enabled"))

            rd = self.adapter.read_file(sb, "src/math.ts")
            assert_exit_code(rd, 0, "read with default enabled")
            assert_is_aice_transformed(rd.stdout, "ts", raw, "default enabled read")

    @e2e_case(
        case_id="T1-F01-02",
        tier=1,
        feature="F01",
        title="enable creates aice.config.json and single-marker AGENTS.md <= 650 tokens, idempotently",
        tags=("governance", "enable", "agents-md"),
    )
    def test_enable_creates_config_and_single_marker_agents_md(self) -> None:
        with Sandbox() as sb:
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            res1 = self.adapter.enable(sb, json_mode=True)
            assert_exit_code(res1, 0, "first enable")
            cfg = json.loads(sb.read_text("aice.config.json"))
            self.assertTrue(cfg.get("enabled"))

            agents_txt = sb.read_text("AGENTS.md")
            starts = re.findall(r"<!--\s*AICE:START", agents_txt)
            ends = re.findall(r"<!--\s*AICE:END\s*-->", agents_txt)
            self.assertEqual(len(starts), 1, f"Expected 1 AICE:START marker in {agents_txt!r}")
            self.assertEqual(len(ends), 1, f"Expected 1 AICE:END marker in {agents_txt!r}")
            # 650 BPE tokens is strictly under 2600 UTF-8 bytes for prose/markdown
            self.assertLessEqual(len(agents_txt.encode("utf-8")), 2600)

            res2 = self.adapter.enable(sb)
            assert_exit_code(res2, 0, "second idempotent enable")
            agents_txt2 = sb.read_text("AGENTS.md")
            self.assertEqual(len(re.findall(r"<!--\s*AICE:START", agents_txt2)), 1)
            self.assertEqual(len(re.findall(r"<!--\s*AICE:END\s*-->", agents_txt2)), 1)

    @e2e_case(
        case_id="T1-F01-03",
        tier=1,
        feature="F01",
        title="disable sets enabled:false and enable restores enabled:true",
        tags=("governance", "disable", "enable"),
    )
    def test_disable_and_enable_round_trip(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            dis = self.adapter.disable(sb, json_mode=True)
            assert_exit_code(dis, 0, "disable")
            self.assertFalse(json.loads(sb.read_text("aice.config.json")).get("enabled"))

            st_off = self.adapter.status(sb, json_mode=True)
            assert_exit_code(st_off, 0, "status while disabled")
            self.assertFalse(st_off.stdout_json.get("enabled"))

            rd_off = self.adapter.read_file(sb, "src/math.ts")
            assert_exit_code(rd_off, 1, "read blocked when disabled")

            en = self.adapter.enable(sb, json_mode=True)
            assert_exit_code(en, 0, "re-enable")
            self.assertTrue(json.loads(sb.read_text("aice.config.json")).get("enabled"))

            rd_on = self.adapter.read_file(sb, "src/math.ts")
            assert_exit_code(rd_on, 0, "read allowed after re-enable")

    @e2e_case(
        case_id="T1-F01-04",
        tier=1,
        feature="F01",
        title="Legacy .aicerc discovery (GOV-05)",
        tags=("governance", "aicerc"),
    )
    def test_legacy_aicerc_discovery(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("legacy")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            raw = sb.read_text("src/sample.ts")

            st = self.adapter.status(sb, json_mode=True)
            assert_exit_code(st, 0, "status with .aicerc")
            self.assertIsInstance(st.stdout_json, dict)
            self.assertTrue(st.stdout_json.get("enabled"))

            rd = self.adapter.read_file(sb, "src/sample.ts")
            assert_exit_code(rd, 0, "read with .aicerc")
            assert_is_aice_transformed(rd.stdout, "ts", raw, ".aicerc read")

    @e2e_case(
        case_id="T1-F01-05",
        tier=1,
        feature="F01",
        title="package.json#aice discovery when aice.config.json is absent",
        tags=("governance", "package-json"),
    )
    def test_package_json_aice_discovery(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("package")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            raw = sb.read_text("src/sample.ts")

            st = self.adapter.status(sb, json_mode=True)
            assert_exit_code(st, 0, "status with package.json#aice")
            self.assertIsInstance(st.stdout_json, dict)
            self.assertTrue(st.stdout_json.get("enabled"))

            rd = self.adapter.read_file(sb, "src/sample.ts")
            assert_exit_code(rd, 0, "read with package.json#aice")
            assert_is_aice_transformed(rd.stdout, "ts", raw, "package.json read")

    @e2e_case(
        case_id="T1-F01-06",
        tier=1,
        feature="F01",
        title="allowedReadRoots permits reads inside configured outside root",
        tags=("governance", "allowed-read-roots"),
    )
    def test_allowed_read_roots_permits_configured_outside_root(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("allowed_roots")
            sb.seed_fixture("r5/valid/sample.ts", "shared/helper.ts", area="outside")
            raw = sb.read_text("shared/helper.ts", area="outside")

            rd = self.adapter.read_file(sb, "../outside/shared/helper.ts")
            assert_exit_code(rd, 0, "read inside allowedReadRoots")
            assert_is_aice_transformed(rd.stdout, "ts", raw, "allowedReadRoots read")


class TestTier1F02PipelineAndPlainText(unittest.TestCase):
    """F02: Single Pipeline Law, Binary Guard & PlainText Passthrough (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F02-01",
        tier=1,
        feature="F02",
        title="PlainText .txt and custom unknown extension pass through via Law 3 exception (READ-09)",
        tags=("pipeline", "plaintext"),
    )
    def test_plaintext_passthrough_and_telemetry(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/notes.txt", "docs/notes.txt")
            sb.seed_fixture("plaintext/custom.customblob", "docs/custom.customblob")

            res_txt = self.adapter.read_file(sb, "docs/notes.txt")
            assert_exit_code(res_txt, 0, "plaintext .txt read")
            assert_stdout_contains(res_txt, "[a+b]*(c?)")
            assert_stdout_contains(res_txt, "Keep verbatim under UnsupportedPassthrough")

            res_blob = self.adapter.read_file(sb, "docs/custom.customblob")
            assert_exit_code(res_blob, 0, "plaintext .customblob read")
            assert_stdout_contains(res_blob, "token=[x+y]")
            assert_telemetry_ledger_consistent(sb, expected_min_rows=2)

    @e2e_case(
        case_id="T1-F02-02",
        tier=1,
        feature="F02",
        title="PlainText line-range slice :L2-L2 and splice -s L2-L2 traverse unified pipeline",
        tags=("pipeline", "plaintext", "splice"),
    )
    def test_plaintext_line_range_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/notes.txt", "docs/notes.txt")

            rd = self.adapter.read_file(sb, "docs/notes.txt", selector="L2-L2")
            assert_exit_code(rd, 0, "plaintext L2-L2 read")
            assert_stdout_contains(rd, "[a+b]*(c?)")
            assert_stdout_not_contains(rd, "Trailing context line.")

            sp = self.adapter.splice_single(
                sb,
                "docs/notes.txt",
                symbol="L2-L2",
                code="Line 2: Updated verbatim line.",
            )
            assert_exit_code(sp, 0, "plaintext L2-L2 splice")
            updated = sb.read_text("docs/notes.txt")
            self.assertIn("AICE PlainText Fixture", updated)
            self.assertIn("Line 2: Updated verbatim line.", updated)
            self.assertIn("Line 4: Trailing context line.", updated)

    @e2e_case(
        case_id="T1-F02-03",
        tier=1,
        feature="F02",
        title="Binary .png and .bin skipped on read with zero raw bytes (READ-08)",
        tags=("pipeline", "binary-guard"),
    )
    def test_binary_read_skipped_with_zero_raw_bytes(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")
            sb.seed_fixture("binary/nul_payload.bin", "bin/data.bin")

            res_png = self.adapter.read_file(sb, "bin/logo.png")
            assert_exit_code(res_png, 0, "binary png read")
            assert_no_raw_binary_bytes(res_png.stdout_bytes, "logo.png")
            self.assertIn("binary", res_png.stdout.lower())
            assert_stdout_not_contains(res_png, "IHDR")

            res_bin = self.adapter.read_file(sb, "bin/data.bin")
            assert_exit_code(res_bin, 0, "binary .bin read")
            assert_no_raw_binary_bytes(res_bin.stdout_bytes, "data.bin")
            self.assertIn("binary", res_bin.stdout.lower())
            assert_stdout_not_contains(res_bin, "AICE_BIN_HEADER")

    @e2e_case(
        case_id="T1-F02-04",
        tier=1,
        feature="F02",
        title="PlainText .log and .env.example search matching works without AST requirement",
        tags=("pipeline", "plaintext", "search"),
    )
    def test_plaintext_log_and_env_search(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "logs/app.log",
                "2026-11-20T00:00:01Z INFO boot ok\n"
                "2026-11-20T00:00:02Z WARN ERR_GATEWAY_RETRY attempt=2\n",
            )
            sb.seed_file(
                ".env.example",
                "PORT=8080\nTIMEOUT_MS=5000\n",
            )

            res_log = self.adapter.search(sb, "ERR_GATEWAY_RETRY")
            assert_exit_code(res_log, 0, "search log")
            assert_stdout_contains(res_log, "logs/app.log")
            assert_stdout_contains(res_log, "ERR_GATEWAY_RETRY")

            res_env = self.adapter.search(sb, "TIMEOUT_MS", targets=[".env.example"])
            assert_exit_code(res_env, 0, "search .env.example")
            assert_stdout_contains(res_env, "TIMEOUT_MS=5000")

    @e2e_case(
        case_id="T1-F02-05",
        tier=1,
        feature="F02",
        title="Binary files automatically excluded from find and search results",
        tags=("pipeline", "binary-guard", "find", "search"),
    )
    def test_binary_excluded_from_find_and_search(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")
            sb.seed_fixture("binary/nul_payload.bin", "bin/data.bin")

            res_find = self.adapter.find(sb)
            assert_exit_code(res_find, 0, "find with binary files")
            assert_stdout_contains(res_find, "src/sample.ts")
            assert_stdout_not_contains(res_find, "bin/logo.png")
            assert_stdout_not_contains(res_find, "bin/data.bin")

            res_search = self.adapter.search(sb, "AICE_BIN_HEADER")
            assert_exit_code(res_search, 0, "search excluding binary")
            assert_stdout_not_contains(res_search, "bin/data.bin")


class TestTier1F03Telemetry(unittest.TestCase):
    """F03: Honest BPE Telemetry, Ledger & gain/analyze (6 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F03-01",
        tier=1,
        feature="F03",
        title="gain --json emits valid schema and non-zero counts after read and splice (TEL-01)",
        tags=("telemetry", "gain"),
    )
    def test_gain_json_schema_and_counts(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            assert_exit_code(self.adapter.read_file(sb, "src/math.ts"), 0, "read")
            assert_exit_code(
                self.adapter.splice_single(
                    sb,
                    "src/math.ts",
                    symbol="Calculator.add",
                    code=(
                        "public add(a: number, b: number): CalcResult {\n"
                        '  return { value: a + b + this.offset + 1, label: "sum" };\n'
                        "}"
                    ),
                ),
                0,
                "splice",
            )
            assert_telemetry_ledger_consistent(sb, expected_min_rows=2)

            g = self.adapter.gain(sb, json_mode=True)
            data = assert_gain_json_valid(g)
            self.assertGreaterEqual(data["totalOperations"], 2)
            self.assertGreater(data["nativeCl100k"], 0)
            self.assertGreater(data["aiceCl100k"], 0)
            self.assertGreater(data["nativeO200k"], 0)
            self.assertGreater(data["aiceO200k"], 0)

    @e2e_case(
        case_id="T1-F03-02",
        tier=1,
        feature="F03",
        title="Exact cl100k_base and o200k_base parity on golden vector big.ts (1222 / 1223)",
        tags=("telemetry", "bpe", "anti-bypass"),
    )
    def test_exact_cl100k_and_o200k_golden_vector_parity(self) -> None:
        vectors = _load_bpe_vectors()["vectors"]
        big = vectors["big_ts"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", big["text"])

            res = self.adapter.read_file(sb, "src/big.ts", full=True)
            assert_exit_code(res, 0, "read big.ts --full")
            rows = assert_telemetry_ledger_consistent(
                sb, expected_min_rows=1, check_o200k_distinct_across_rows=True
            )
            self.assertEqual(rows[0]["nc"], big["utf8_bytes"])
            self.assertEqual(rows[0]["n1"], big["cl100k_base"])
            self.assertEqual(rows[0]["n2"], big["o200k_base"])
            self.assertNotEqual(rows[0]["n1"], rows[0]["n2"])

            g = self.adapter.gain(sb, json_mode=True)
            data = assert_gain_json_valid(g)
            self.assertEqual(data["nativeCl100k"], big["cl100k_base"])
            self.assertEqual(data["nativeO200k"], big["o200k_base"])

    @e2e_case(
        case_id="T1-F03-03",
        tier=1,
        feature="F03",
        title="Exact UTF-8 byte/char counts match disk raw payload vs full emitted stdout",
        tags=("telemetry", "bytes"),
    )
    def test_exact_raw_and_stdout_byte_counts(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            raw_text = sb.read_text("src/math.ts")
            raw_bytes = sb.read_bytes("src/math.ts")

            res = self.adapter.read_file(sb, "src/math.ts")
            assert_exit_code(res, 0, "read math.ts")
            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=1)
            self.assertEqual(rows[0]["nc"], len(raw_bytes))
            self.assertEqual(rows[0]["nc"], len(raw_text))
            self.assertEqual(rows[0]["ac"], len(res.stdout_bytes))

    @e2e_case(
        case_id="T1-F03-04",
        tier=1,
        feature="F03",
        title="--stats footer included in emitted aiceCl100k and aiceChars (B-T6)",
        tags=("telemetry", "stats", "anti-bypass"),
    )
    def test_stats_footer_included_in_telemetry(self) -> None:
        big_text = _load_bpe_vectors()["vectors"]["big_ts"]["text"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", big_text)

            r_plain = self.adapter.read_file(sb, "src/big.ts", full=True, stats=False)
            assert_exit_code(r_plain, 0, "read without --stats")
            r_stats = self.adapter.read_file(sb, "src/big.ts", full=True, stats=True)
            assert_exit_code(r_stats, 0, "read with --stats")

            self.assertGreater(len(r_stats.stdout_bytes), len(r_plain.stdout_bytes))
            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            self.assertEqual(rows[0]["ac"], len(r_plain.stdout_bytes))
            self.assertEqual(rows[1]["ac"], len(r_stats.stdout_bytes))
            self.assertGreater(rows[1]["ac"], rows[0]["ac"])
            self.assertGreater(rows[1]["a1"], rows[0]["a1"])

    @e2e_case(
        case_id="T1-F03-05",
        tier=1,
        feature="F03",
        title="gain --unique, gain -p <project>, and gain --reset -y lifecycle",
        tags=("telemetry", "gain", "reset"),
    )
    def test_gain_unique_project_and_reset_lifecycle(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            assert_exit_code(self.adapter.read_file(sb, "src/math.ts"), 0)
            assert_exit_code(self.adapter.read_file(sb, "src/math.ts"), 0)

            g_all = assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))
            g_uniq = assert_gain_json_valid(
                self.adapter.gain(sb, json_mode=True, unique=True)
            )
            self.assertGreaterEqual(g_all["totalOperations"], 2)
            self.assertLessEqual(g_uniq["nativeCl100k"], g_all["nativeCl100k"])

            g_proj = assert_gain_project_json_valid(
                self.adapter.run_raw(
                    sb, ["gain", "-p", str(sb.ws), "--json"], expect_json=True
                )
            )
            self.assertFalse(g_proj["unique"])
            self.assertTrue(g_proj["project"]["configStatus"]["enabled"])
            self.assertEqual(g_proj["project"]["projectName"], sb.ws.name)
            self.assertGreaterEqual(g_proj["project"]["summary"]["calls"], 2)

            rst = self.adapter.gain(sb, json_mode=False, reset=True, yes=True)
            assert_exit_code(rst, 0, "gain --reset -y")

            g_after = assert_gain_json_valid(self.adapter.gain(sb, json_mode=True))
            self.assertEqual(g_after["totalOperations"], 0)

    @e2e_case(
        case_id="T1-F03-06",
        tier=1,
        feature="F03",
        title="analyze --json and text post-session audit execute via pipeline",
        tags=("telemetry", "analyze"),
    )
    def test_analyze_json_and_text(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            assert_exit_code(self.adapter.read_file(sb, "src/math.ts"), 0)

            sb.seed_file(
                "transcripts/session.jsonl",
                json.dumps(
                    {
                        "type": "tool_use",
                        "name": "aice_read",
                        "input": {"path": "src/math.ts"},
                    }
                )
                + "\n",
                area="home",
            )
            tdir = str(sb.path("transcripts", area="home"))
            res_json = self.adapter.analyze(sb, transcripts_dir=tdir, json_mode=True)
            assert_exit_code(res_json, 0, "analyze --json")
            self.assertIsInstance(res_json.stdout_json, dict)

            res_txt = self.adapter.analyze(sb, transcripts_dir=tdir, json_mode=False)
            assert_exit_code(res_txt, 0, "analyze text")
            self.assertTrue(res_txt.stdout.strip())


class TestTier1F04SystemsAndOopLanguages(unittest.TestCase):
    """F04: R5 Systems & OOP Languages — AST Read & Valid Splice (10 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    def _run_read_and_splice(
        self,
        *,
        fixture: str,
        dest: str,
        lang: str,
        symbol: str,
        new_code: str,
        expected_disk_substr: str,
        preserved_substr: str,
    ) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture(fixture, dest)
            raw = sb.read_text(dest)

            rd = self.adapter.read_file(sb, dest)
            assert_exit_code(rd, 0, f"{lang} read")
            assert_is_aice_transformed(rd.stdout, lang, raw, f"{lang} read")
            assert_no_ast_fallback_marker(rd, f"{lang} read")

            sp = self.adapter.splice_single(sb, dest, symbol=symbol, code=new_code)
            assert_exit_code(sp, 0, f"{lang} splice")
            updated = sb.read_text(dest)
            self.assertIn(expected_disk_substr, updated)
            self.assertIn(preserved_substr, updated)

    @e2e_case(
        case_id="T1-F04-01",
        tier=1,
        feature="F04",
        title="Rust (.rs): default read emits AICE IR and splice updates fn cleanly",
        tags=("r5", "rust"),
    )
    def test_rust_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.rs",
            dest="src/sample.rs",
            lang="rust",
            symbol="accumulate_delta",
            new_code=(
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    stats.count += 1;\n"
                "    stats.total += delta * 2;\n"
                "    stats.total\n"
                "}"
            ),
            expected_disk_substr="delta * 2",
            preserved_substr="pub struct LedgerStats",
        )

    @e2e_case(
        case_id="T1-F04-02",
        tier=1,
        feature="F04",
        title="C (.c): default read emits AICE IR and splice updates fn cleanly",
        tags=("r5", "c"),
    )
    def test_c_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.c",
            dest="src/sample.c",
            lang="c",
            symbol="ledger_push",
            new_code=(
                "int64_t ledger_push(LedgerWindow *win, int32_t value) {\n"
                "    win->count += 1;\n"
                "    win->sum += (int64_t)value * 2;\n"
                "    return win->sum;\n"
                "}"
            ),
            expected_disk_substr="(int64_t)value * 2",
            preserved_substr="LedgerWindow",
        )

    @e2e_case(
        case_id="T1-F04-03",
        tier=1,
        feature="F04",
        title="C++ (.cpp): default read emits AICE IR and splice updates method cleanly",
        tags=("r5", "cpp"),
    )
    def test_cpp_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.cpp",
            dest="src/sample.cpp",
            lang="cpp",
            symbol="LedgerCounter.add",
            new_code=(
                "    int64_t add(int64_t delta) {\n"
                "        total_ += delta * 2;\n"
                "        return total_;\n"
                "    }"
            ),
            expected_disk_substr="delta * 2",
            preserved_substr="class LedgerCounter",
        )

    @e2e_case(
        case_id="T1-F04-04",
        tier=1,
        feature="F04",
        title="C# (.cs): default read emits AICE IR and splice updates method cleanly",
        tags=("r5", "csharp"),
    )
    def test_csharp_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.cs",
            dest="src/sample.cs",
            lang="csharp",
            symbol="AccountService.ComputeNextBalance",
            new_code=(
                "        public int ComputeNextBalance(int current, int delta)\n"
                "        {\n"
                "            return current + delta + 10;\n"
                "        }"
            ),
            expected_disk_substr="current + delta + 10",
            preserved_substr="namespace Aice.Ledger",
        )

    @e2e_case(
        case_id="T1-F04-05",
        tier=1,
        feature="F04",
        title="Go (.go): default read emits AICE IR and splice updates func cleanly",
        tags=("r5", "go"),
    )
    def test_go_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.go",
            dest="src/sample.go",
            lang="go",
            symbol="SumAmounts",
            new_code=(
                "func SumAmounts(entries []Entry) int {\n"
                "\ttotal := 1\n"
                "\tfor _, entry := range entries {\n"
                "\t\ttotal += entry.Amount\n"
                "\t}\n"
                "\treturn total\n"
                "}"
            ),
            expected_disk_substr="total := 1",
            preserved_substr="type Entry struct",
        )

    @e2e_case(
        case_id="T1-F04-06",
        tier=1,
        feature="F04",
        title="Java (.java): default read emits AICE IR and splice updates method cleanly",
        tags=("r5", "java"),
    )
    def test_java_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.java",
            dest="src/sample.java",
            lang="java",
            symbol="LedgerService.computeBalance",
            new_code=(
                "    public int computeBalance(int base, int delta) {\n"
                "        int next = base + delta;\n"
                "        return next < 0 ? 0 : next;\n"
                "    }"
            ),
            expected_disk_substr="next < 0 ? 0 : next",
            preserved_substr="package dev.aice.ledger;",
        )

    @e2e_case(
        case_id="T1-F04-07",
        tier=1,
        feature="F04",
        title="Kotlin (.kt): default read emits AICE IR and splice updates fun cleanly",
        tags=("r5", "kotlin"),
    )
    def test_kotlin_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.kt",
            dest="src/sample.kt",
            lang="kotlin",
            symbol="LedgerEngine.credit",
            new_code=(
                "    fun credit(state: AccountState, amount: Long): AccountState {\n"
                "        return state.copy(balance = state.balance + amount + 1L)\n"
                "    }"
            ),
            expected_disk_substr="amount + 1L",
            preserved_substr="data class AccountState",
        )

    @e2e_case(
        case_id="T1-F04-08",
        tier=1,
        feature="F04",
        title="Dart (.dart): default read emits AICE IR and splice updates method cleanly",
        tags=("r5", "dart"),
    )
    def test_dart_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.dart",
            dest="src/sample.dart",
            lang="dart",
            symbol="LedgerBalance.add",
            new_code=(
                "  int add(int delta) {\n"
                "    _amount += delta * 2;\n"
                "    return _amount;\n"
                "  }"
            ),
            expected_disk_substr="delta * 2",
            preserved_substr="class LedgerBalance",
        )

    @e2e_case(
        case_id="T1-F04-09",
        tier=1,
        feature="F04",
        title="PHP (.php): default read emits AICE IR and splice updates method cleanly",
        tags=("r5", "php"),
    )
    def test_php_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.php",
            dest="src/sample.php",
            lang="php",
            symbol="LedgerCalculator.add",
            new_code=(
                "    public function add(int $left, int $right): int\n"
                "    {\n"
                "        return $left + $right + 1;\n"
                "    }"
            ),
            expected_disk_substr="$left + $right + 1",
            preserved_substr="public function clamp",
        )

    @e2e_case(
        case_id="T1-F04-10",
        tier=1,
        feature="F04",
        title="Ruby (.rb): default read emits AICE IR and splice updates def cleanly",
        tags=("r5", "ruby"),
    )
    def test_ruby_read_and_splice(self) -> None:
        self._run_read_and_splice(
            fixture="r5/valid/sample.rb",
            dest="src/sample.rb",
            lang="ruby",
            symbol="LedgerAccount.credit",
            new_code=(
                "  def credit(amount)\n"
                '    raise ArgumentError, "negative" if amount < 0\n'
                "    @balance += amount\n"
                "  end"
            ),
            expected_disk_substr="amount < 0",
            preserved_substr="attr_reader :balance",
        )


class TestTier1F05WebScriptDataTwig(unittest.TestCase):
    """F05: R5 Web, Scripting, Data & Twig — AST Read & Valid Splice (13 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F05-01",
        tier=1,
        feature="F05",
        title="TypeScript (.ts): default read emits AICE IR (B-R1) and splice updates function",
        tags=("r5", "typescript"),
    )
    def test_typescript_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            raw = sb.read_text("src/sample.ts")
            rd = self.adapter.read_file(sb, "src/sample.ts")
            assert_exit_code(rd, 0, "ts read")
            assert_is_aice_transformed(rd.stdout, "ts", raw, "ts read")

            sp = self.adapter.splice_single(
                sb,
                "src/sample.ts",
                symbol="applyCredit",
                code=(
                    "export function applyCredit(account: AccountSnapshot, delta: number): AccountSnapshot {\n"
                    "  return { id: account.id, balance: account.balance + delta * 2 };\n"
                    "}"
                ),
            )
            assert_exit_code(sp, 0, "ts splice")
            self.assertIn("delta * 2", sb.read_text("src/sample.ts"))
            self.assertIn("interface AccountSnapshot", sb.read_text("src/sample.ts"))

    @e2e_case(
        case_id="T1-F05-02",
        tier=1,
        feature="F05",
        title="JavaScript (.js): default read emits AICE IR and splice updates method",
        tags=("r5", "javascript"),
    )
    def test_javascript_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.js", "src/sample.js")
            raw = sb.read_text("src/sample.js")
            rd = self.adapter.read_file(sb, "src/sample.js")
            assert_exit_code(rd, 0, "js read")
            assert_is_aice_transformed(rd.stdout, "js", raw, "js read")

            sp = self.adapter.splice_single(
                sb,
                "src/sample.js",
                symbol="BalanceTracker.deposit",
                code=(
                    "  deposit(amount) {\n"
                    '    if (amount <= 0) throw new Error("positive");\n'
                    "    this.balance += amount + 1;\n"
                    "    return this.balance;\n"
                    "  }"
                ),
            )
            assert_exit_code(sp, 0, "js splice")
            self.assertIn("amount + 1", sb.read_text("src/sample.js"))

    @e2e_case(
        case_id="T1-F05-03",
        tier=1,
        feature="F05",
        title="TSX (.tsx): default read emits AICE IR and splice updates JSX component",
        tags=("r5", "tsx"),
    )
    def test_tsx_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.tsx", "src/sample.tsx")
            raw = sb.read_text("src/sample.tsx")
            rd = self.adapter.read_file(sb, "src/sample.tsx")
            assert_exit_code(rd, 0, "tsx read")
            assert_is_aice_transformed(rd.stdout, "tsx", raw, "tsx read")

            sp = self.adapter.splice_single(
                sb,
                "src/sample.tsx",
                symbol="StatusCard",
                code=(
                    "export function StatusCard({ title, active }: StatusCardProps) {\n"
                    "  return (\n"
                    '    <section className={active ? "card card--active" : "card"}>\n'
                    "      <h2>{title}</h2>\n"
                    '      <span>{active ? "READY" : "IDLE"}</span>\n'
                    "    </section>\n"
                    "  );\n"
                    "}"
                ),
            )
            assert_exit_code(sp, 0, "tsx splice")
            self.assertIn("READY", sb.read_text("src/sample.tsx"))

    @e2e_case(
        case_id="T1-F05-04",
        tier=1,
        feature="F05",
        title="Python (.py): in-process AST read emits AICE IR and splice updates def under PATH=''",
        tags=("r5", "python"),
    )
    def test_python_read_and_splice_in_process(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.py", "src/sample.py")
            raw = sb.read_text("src/sample.py")
            rd = self.adapter.read_file(sb, "src/sample.py", env_overrides={"PATH": ""})
            assert_exit_code(rd, 0, "python read PATH=''")
            assert_is_aice_transformed(rd.stdout, "python", raw, "python read")

            sp = self.adapter.splice_single(
                sb,
                "src/sample.py",
                symbol="apply_delta",
                code=(
                    "def apply_delta(entry: LedgerEntry, base: int = 0) -> int:\n"
                    "    return max(0, base + entry.delta + 5)\n"
                ),
                env_overrides={"PATH": ""},
            )
            assert_exit_code(sp, 0, "python splice PATH=''")
            self.assertIn("entry.delta + 5", sb.read_text("src/sample.py"))
            self.assertIn("class LedgerEntry:", sb.read_text("src/sample.py"))

    @e2e_case(
        case_id="T1-F05-05",
        tier=1,
        feature="F05",
        title="Bash (.sh): in-process AST read emits AICE IR and splice updates fn under PATH=''",
        tags=("r5", "bash"),
    )
    def test_bash_read_and_splice_in_process(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.sh", "scripts/sample.sh")
            raw = sb.read_text("scripts/sample.sh")
            rd = self.adapter.read_file(sb, "scripts/sample.sh", env_overrides={"PATH": ""})
            assert_exit_code(rd, 0, "bash read PATH=''")
            assert_is_aice_transformed(rd.stdout, "bash", raw, "bash read")

            sp = self.adapter.splice_single(
                sb,
                "scripts/sample.sh",
                symbol="summarize_logs",
                code=(
                    "summarize_logs() {\n"
                    '  local target_dir="${1:-.}"\n'
                    '  printf "checked:%s\\n" "$target_dir"\n'
                    "}"
                ),
                env_overrides={"PATH": ""},
            )
            assert_exit_code(sp, 0, "bash splice PATH=''")
            self.assertIn("checked:%s", sb.read_text("scripts/sample.sh"))

    @e2e_case(
        case_id="T1-F05-06",
        tier=1,
        feature="F05",
        title="JSON (.json): read emits compact AICE IR and hunk splice keeps valid JSON",
        tags=("r5", "json"),
    )
    def test_json_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.json", "cfg/sample.json")
            raw = sb.read_text("cfg/sample.json")
            rd = self.adapter.read_file(sb, "cfg/sample.json")
            assert_exit_code(rd, 0, "json read")
            assert_is_aice_transformed(rd.stdout, "json", raw, "json read")

            sp = self.adapter.splice_heredoc(
                sb,
                '<<<\n    "astFirewall": true,\n===\n    "astFirewall": false,\n>>>\n',
                path="cfg/sample.json",
            )
            assert_exit_code(sp, 0, "json hunk splice")
            parsed = json.loads(sb.read_text("cfg/sample.json"))
            self.assertFalse(parsed["features"]["astFirewall"])

    @e2e_case(
        case_id="T1-F05-07",
        tier=1,
        feature="F05",
        title="YAML (.yaml): read emits AICE IR and hunk splice updates YAML cleanly",
        tags=("r5", "yaml"),
    )
    def test_yaml_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.yaml", "cfg/sample.yaml")
            raw = sb.read_text("cfg/sample.yaml")
            rd = self.adapter.read_file(sb, "cfg/sample.yaml")
            assert_exit_code(rd, 0, "yaml read")
            assert_is_aice_transformed(rd.stdout, "yaml", raw, "yaml read")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n  replicas: 3\n===\n  replicas: 5\n>>>\n",
                path="cfg/sample.yaml",
            )
            assert_exit_code(sp, 0, "yaml hunk splice")
            self.assertIn("replicas: 5", sb.read_text("cfg/sample.yaml"))

    @e2e_case(
        case_id="T1-F05-08",
        tier=1,
        feature="F05",
        title="TOML (.toml): read emits AICE IR and hunk splice keeps valid TOML",
        tags=("r5", "toml"),
    )
    def test_toml_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.toml", "Cargo.toml")
            raw = sb.read_text("Cargo.toml")
            rd = self.adapter.read_file(sb, "Cargo.toml")
            assert_exit_code(rd, 0, "toml read")
            assert_is_aice_transformed(rd.stdout, "toml", raw, "toml read")

            sp = self.adapter.splice_heredoc(
                sb,
                '<<<\nversion = "0.1.0"\n===\nversion = "0.2.0"\n>>>\n',
                path="Cargo.toml",
            )
            assert_exit_code(sp, 0, "toml hunk splice")
            parsed = tomllib.loads(sb.read_text("Cargo.toml"))
            self.assertEqual(parsed["package"]["version"], "0.2.0")

    @e2e_case(
        case_id="T1-F05-09",
        tier=1,
        feature="F05",
        title="Markdown (.md): read emits AICE IR and splice updates section cleanly",
        tags=("r5", "markdown"),
    )
    def test_markdown_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.md", "docs/README.md")
            raw = sb.read_text("docs/README.md")
            rd = self.adapter.read_file(sb, "docs/README.md")
            assert_exit_code(rd, 0, "md read")
            assert_is_aice_transformed(rd.stdout, "markdown", raw, "md read")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n- `GET /healthz`: returns readiness status\n===\n- `GET /healthz`: returns live readiness status\n>>>\n",
                path="docs/README.md",
            )
            assert_exit_code(sp, 0, "md hunk splice")
            self.assertIn("live readiness status", sb.read_text("docs/README.md"))

    @e2e_case(
        case_id="T1-F05-10",
        tier=1,
        feature="F05",
        title="HTML (.html): read emits AICE IR and hunk splice updates valid HTML",
        tags=("r5", "html"),
    )
    def test_html_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.html", "web/index.html")
            raw = sb.read_text("web/index.html")
            rd = self.adapter.read_file(sb, "web/index.html")
            assert_exit_code(rd, 0, "html read")
            assert_is_aice_transformed(rd.stdout, "html", raw, "html read")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n      <h1>Ledger Ready</h1>\n===\n      <h1>Ledger Online</h1>\n>>>\n",
                path="web/index.html",
            )
            assert_exit_code(sp, 0, "html hunk splice")
            self.assertIn("<h1>Ledger Online</h1>", sb.read_text("web/index.html"))

    @e2e_case(
        case_id="T1-F05-11",
        tier=1,
        feature="F05",
        title="CSS (.css): read emits AICE IR and splice updates CSS rule cleanly",
        tags=("r5", "css"),
    )
    def test_css_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.css", "web/styles.css")
            raw = sb.read_text("web/styles.css")
            rd = self.adapter.read_file(sb, "web/styles.css")
            assert_exit_code(rd, 0, "css read")
            assert_is_aice_transformed(rd.stdout, "css", raw, "css read")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n  gap: 12px;\n===\n  gap: 20px;\n>>>\n",
                path="web/styles.css",
            )
            assert_exit_code(sp, 0, "css hunk splice")
            self.assertIn("gap: 20px;", sb.read_text("web/styles.css"))

    @e2e_case(
        case_id="T1-F05-12",
        tier=1,
        feature="F05",
        title="XML and SVG (.xml, .svg): read emits AICE IR and hunk splice keeps valid XML",
        tags=("r5", "xml", "svg"),
    )
    def test_xml_and_svg_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.xml", "cfg/catalog.xml")
            sb.seed_fixture("r5/valid/sample.svg", "assets/icon.svg")

            rd_xml = self.adapter.read_file(sb, "cfg/catalog.xml")
            assert_exit_code(rd_xml, 0, "xml read")
            assert_is_aice_transformed(
                rd_xml.stdout, "xml", sb.read_text("cfg/catalog.xml"), "xml read"
            )

            rd_svg = self.adapter.read_file(sb, "assets/icon.svg")
            assert_exit_code(rd_svg, 0, "svg read")
            assert_is_aice_transformed(
                rd_svg.stdout, "svg", sb.read_text("assets/icon.svg"), "svg read"
            )

            sp_xml = self.adapter.splice_heredoc(
                sb,
                "<<<\n    <port>8080</port>\n===\n    <port>9090</port>\n>>>\n",
                path="cfg/catalog.xml",
            )
            assert_exit_code(sp_xml, 0, "xml splice")
            ET.fromstring(sb.read_text("cfg/catalog.xml"))
            self.assertIn("<port>9090</port>", sb.read_text("cfg/catalog.xml"))

            sp_svg = self.adapter.splice_heredoc(
                sb,
                '<<<\n  <circle cx="12" cy="12" r="5" fill="#38bdf8" />\n===\n  <circle cx="12" cy="12" r="7" fill="#38bdf8" />\n>>>\n',
                path="assets/icon.svg",
            )
            assert_exit_code(sp_svg, 0, "svg splice")
            ET.fromstring(sb.read_text("assets/icon.svg"))
            self.assertIn('r="7"', sb.read_text("assets/icon.svg"))

    @e2e_case(
        case_id="T1-F05-13",
        tier=1,
        feature="F05",
        title="Twig (.twig): read emits AICE template IR and hunk splice updates template cleanly",
        tags=("r5", "twig"),
    )
    def test_twig_read_and_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.twig", "templates/card.twig")
            raw = sb.read_text("templates/card.twig")
            rd = self.adapter.read_file(sb, "templates/card.twig")
            assert_exit_code(rd, 0, "twig read")
            assert_is_aice_transformed(rd.stdout, "twig", raw, "twig read")

            sp = self.adapter.splice_heredoc(
                sb,
                "<<<\n  <h3>{{ title|upper }}</h3>\n===\n  <h3>{{ title|trim|upper }}</h3>\n>>>\n",
                path="templates/card.twig",
            )
            assert_exit_code(sp, 0, "twig hunk splice")
            self.assertIn("{{ title|trim|upper }}", sb.read_text("templates/card.twig"))


class TestTier1F06DatabaseDialects(unittest.TestCase):
    """F06: R6 Database & Query Dialects — AST Read & Valid Splice (9 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    def _run_db_read_and_hunk(
        self,
        *,
        fixture: str,
        dest: str,
        dialect: str,
        search_block: str,
        replace_block: str,
        expected_disk_substr: str,
    ) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture(fixture, dest)
            raw = sb.read_text(dest)

            rd = self.adapter.read_file(sb, dest)
            assert_exit_code(rd, 0, f"{dialect} read")
            assert_is_aice_transformed(rd.stdout, dialect, raw, f"{dialect} read")
            assert_no_ast_fallback_marker(rd, f"{dialect} read")

            sp = self.adapter.splice_heredoc(
                sb,
                f"<<<\n{search_block}\n===\n{replace_block}\n>>>\n",
                path=dest,
            )
            assert_exit_code(sp, 0, f"{dialect} splice")
            self.assertIn(expected_disk_substr, sb.read_text(dest))

    @e2e_case(
        case_id="T1-F06-01",
        tier=1,
        feature="F06",
        title="ANSI SQL: read emits AICE SQL IR and splice updates CTE query",
        tags=("r6", "ansi-sql"),
    )
    def test_ansi_sql_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/ansi.sql",
            dest="db/ansi.sql",
            dialect="ansi_sql",
            search_block="  WHERE balance > 0",
            replace_block="  WHERE balance >= 10",
            expected_disk_substr="WHERE balance >= 10",
        )

    @e2e_case(
        case_id="T1-F06-02",
        tier=1,
        feature="F06",
        title="PostgreSQL / PL/pgSQL: read emits AICE IR for $$ function and splice updates body",
        tags=("r6", "postgres", "plpgsql"),
    )
    def test_postgres_plpgsql_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/postgres_plpgsql.sql",
            dest="db/postgres_plpgsql.sql",
            dialect="plpgsql",
            search_block="    RETURN -1;",
            replace_block="    RETURN -2;",
            expected_disk_substr="RETURN -2;",
        )

    @e2e_case(
        case_id="T1-F06-03",
        tier=1,
        feature="F06",
        title="MySQL / MariaDB: read emits AICE IR for DELIMITER proc and splice updates DML",
        tags=("r6", "mysql"),
    )
    def test_mysql_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/mysql_proc.sql",
            dest="db/mysql_proc.sql",
            dialect="mysql",
            search_block="    balance = balance + VALUES(balance);",
            replace_block="    balance = balance + VALUES(balance),\n    owner_name = VALUES(owner_name);",
            expected_disk_substr="owner_name = VALUES(owner_name);",
        )

    @e2e_case(
        case_id="T1-F06-04",
        tier=1,
        feature="F06",
        title="SQLite: read emits AICE IR for PRAGMA/STRICT/WITHOUT ROWID and splice updates query",
        tags=("r6", "sqlite"),
    )
    def test_sqlite_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/sqlite_pragma.sql",
            dest="db/sqlite_pragma.sql",
            dialect="sqlite",
            search_block="WHERE seq > 0",
            replace_block="WHERE seq >= 1",
            expected_disk_substr="WHERE seq >= 1",
        )

    @e2e_case(
        case_id="T1-F06-05",
        tier=1,
        feature="F06",
        title="T-SQL / SQL Server: read emits AICE IR for GO/@Param/TRY..CATCH and splice updates proc",
        tags=("r6", "tsql"),
    )
    def test_tsql_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/tsql_proc.sql",
            dest="db/tsql_proc.sql",
            dialect="tsql",
            search_block="    SET Balance = Balance + @Delta",
            replace_block="    SET Balance = Balance + @Delta * 2",
            expected_disk_substr="Balance + @Delta * 2",
        )

    @e2e_case(
        case_id="T1-F06-06",
        tier=1,
        feature="F06",
        title="Prisma (.prisma): read emits AICE schema IR and splice updates model cleanly",
        tags=("r6", "prisma"),
    )
    def test_prisma_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/schema.prisma",
            dest="prisma/schema.prisma",
            dialect="prisma",
            search_block="model Entry {\n  id        Int      @id @default(autoincrement())\n  amount    Int",
            replace_block="model Entry {\n  id        Int      @id @default(autoincrement())\n  amount    Int\n  note      String?",
            expected_disk_substr="note      String?",
        )

    @e2e_case(
        case_id="T1-F06-07",
        tier=1,
        feature="F06",
        title="GraphQL (.graphql): read emits AICE GQL IR and splice updates type Query",
        tags=("r6", "graphql"),
    )
    def test_graphql_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/api.graphql",
            dest="graphql/api.graphql",
            dialect="graphql",
            search_block="type Query {\n  account(id: ID!): Account\n}",
            replace_block="type Query {\n  account(id: ID!): Account\n  accounts: [Account!]!\n}",
            expected_disk_substr="accounts: [Account!]!",
        )

    @e2e_case(
        case_id="T1-F06-08",
        tier=1,
        feature="F06",
        title="Cypher / Neo4j (.cypher): read emits AICE Cypher IR and splice updates query",
        tags=("r6", "cypher"),
    )
    def test_cypher_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/graph.cypher",
            dest="queries/graph.cypher",
            dialect="cypher",
            search_block="LIMIT 25;",
            replace_block="LIMIT 50;",
            expected_disk_substr="LIMIT 50;",
        )

    @e2e_case(
        case_id="T1-F06-09",
        tier=1,
        feature="F06",
        title="DB Migrations (Goose/Flyway SQL): read emits AICE IR and splice updates migration",
        tags=("r6", "migrations"),
    )
    def test_db_migration_read_and_splice(self) -> None:
        self._run_db_read_and_hunk(
            fixture="r6/valid/migrations/V001__init_ledger.sql",
            dest="migrations/V001__init_ledger.sql",
            dialect="migration_sql",
            search_block="  delta NUMERIC(12, 2) NOT NULL,",
            replace_block="  delta NUMERIC(12, 2) NOT NULL,\n  note TEXT,",
            expected_disk_substr="note TEXT,",
        )


class TestTier1F07AstAndIntraAstSlicing(unittest.TestCase):
    """F07: Symbol Slicing, Auto-Outline (>120L), >50KB & Intra-Function AST (6 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F07-01",
        tier=1,
        feature="F07",
        title="Bare >120L file triggers auto-outline with symbol landmarks (READ-03)",
        tags=("ast", "auto-outline"),
    )
    def test_over_120_lines_triggers_auto_outline(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")

            rd = self.adapter.read_file(sb, "src/monolith.ts")
            assert_exit_code(rd, 0, "auto-outline read")
            assert_stdout_contains(rd, "MonolithReport")
            assert_stdout_contains(rd, "processBatchMonolith")
            assert_stdout_contains(rd, "formatMonolithSummary")
            assert_stdout_not_contains(rd, "const stepZ = stepY + 67;")

    @e2e_case(
        case_id="T1-F07-02",
        tier=1,
        feature="F07",
        title="--outline emits structural skeleton without function bodies (READ-11)",
        tags=("ast", "outline"),
    )
    def test_outline_flag_emits_skeleton(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            rd = self.adapter.read_file(sb, "src/math.ts", outline=True)
            assert_exit_code(rd, 0, "--outline read")
            assert_stdout_contains(rd, "CalcResult")
            assert_stdout_contains(rd, "Calculator")
            assert_stdout_contains(rd, "add")
            assert_stdout_contains(rd, "mul")
            assert_stdout_not_contains(rd, 'label: "product"')

    @e2e_case(
        case_id="T1-F07-03",
        tier=1,
        feature="F07",
        title="Symbol slice file:Sym.method and file#Sym::method in AICE IR with sibling hints (READ-04)",
        tags=("ast", "symbol-slice"),
    )
    def test_symbol_slice_colon_and_hash_with_siblings(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            rd_colon = self.adapter.read_file(
                sb, "src/math.ts", selector="Calculator.add", selector_sep=":"
            )
            assert_exit_code(rd_colon, 0, "colon symbol slice")
            assert_stdout_contains(rd_colon, "add")
            assert_stdout_contains(rd_colon, "mul")
            assert_stdout_not_contains(rd_colon, 'label: "product"')

            rd_hash = self.adapter.read_file(
                sb, "src/math.ts", selector="Calculator::add", selector_sep="#"
            )
            assert_exit_code(rd_hash, 0, "hash double-colon symbol slice")
            assert_stdout_contains(rd_hash, "add")
            assert_stdout_contains(rd_hash, "mul")

    @e2e_case(
        case_id="T1-F07-04",
        tier=1,
        feature="F07",
        title="Line-range :L1-L15 and regex :/pattern/ slice in AICE IR (READ-05)",
        tags=("ast", "line-range", "regex-slice"),
    )
    def test_line_range_and_regex_slice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            rd_lines = self.adapter.read_file(sb, "src/math.ts", selector="L1-L15")
            assert_exit_code(rd_lines, 0, "line range L1-L15")
            assert_stdout_contains(rd_lines, "CalcResult")
            assert_stdout_contains(rd_lines, "add")
            assert_stdout_not_contains(rd_lines, 'label: "product"')

            rd_rx = self.adapter.read_file(sb, "src/math.ts", selector="/mul/")
            assert_exit_code(rd_rx, 0, "regex /mul/ slice")
            assert_stdout_contains(rd_rx, "mul")

    @e2e_case(
        case_id="T1-F07-05",
        tier=1,
        feature="F07",
        title="Intra-function AST branch/closure/SQL CTE slicing (READ-06)",
        tags=("ast", "intra-function"),
    )
    def test_intra_function_branch_closure_and_cte_slice(self) -> None:
        big_text = _load_bpe_vectors()["vectors"]["big_ts"]["text"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", big_text)
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("r6/valid/ansi.sql", "db/ansi.sql")

            rd_branch = self.adapter.read_file(
                sb, "src/big.ts", selector="runBatchPipeline@divisible"
            )
            assert_exit_code(rd_branch, 0, "intra-AST branch slice")
            assert_stdout_contains(rd_branch, "divisible")
            assert_stdout_not_contains(rd_branch, "fold50")

            rd_closure = self.adapter.read_file(
                sb, "src/monolith.ts", selector="processBatchMonolith@normalize"
            )
            assert_exit_code(rd_closure, 0, "intra-AST closure slice")
            assert_stdout_contains(rd_closure, "normalize")

            rd_cte = self.adapter.read_file(sb, "db/ansi.sql", selector="active_accounts")
            assert_exit_code(rd_cte, 0, "SQL CTE slice")
            assert_stdout_contains(rd_cte, "active_accounts")

    @e2e_case(
        case_id="T1-F07-06",
        tier=1,
        feature="F07",
        title=">50 KB large file symbol query parses full AST without size bypass (B-R3)",
        tags=("ast", "large-file", "anti-bypass"),
    )
    def test_over_50kb_parses_full_ast_near_eof(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/huge_over_50kb.ts", "src/huge.ts")
            self.assertGreater(len(sb.read_bytes("src/huge.ts")), 50 * 1024)

            rd = self.adapter.read_file(sb, "src/huge.ts", selector="lateTarget")
            assert_exit_code(rd, 0, ">50KB lateTarget slice")
            assert_no_ast_fallback_marker(rd, ">50KB read")
            assert_stdout_contains(rd, "lateTarget")
            assert_stdout_contains(rd, "42")


class TestTier1F08TopologicalOrdering(unittest.TestCase):
    """F08: Cross-File Dependency & Caller Topological Ordering (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F08-01",
        tier=1,
        feature="F08",
        title="Multi-file read with --deps orders math.ts types/defs before app.ts",
        tags=("ordering", "deps"),
    )
    def test_deps_orders_dependency_before_caller(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            rd = self.adapter.read_file(sb, "src/app.ts", deps=True)
            assert_exit_code(rd, 0, "read --deps")
            assert_stdout_contains(rd, "Calculator")
            assert_stdout_contains(rd, "App")
            pos_math = rd.stdout.find("Calculator")
            pos_app = rd.stdout.find("class App") if "class App" in rd.stdout else rd.stdout.find("App")
            self.assertLess(pos_math, pos_app, f"Expected math.ts before app.ts in:\n{rd.stdout}")

    @e2e_case(
        case_id="T1-F08-02",
        tier=1,
        feature="F08",
        title="--callers reverse lookup includes downstream usage sites",
        tags=("ordering", "callers"),
    )
    def test_callers_includes_downstream_sites(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_fixture("graph/handler.spec.ts", "src/handler.spec.ts")

            rd = self.adapter.read_file(sb, "src/handler.ts", callers=True)
            assert_exit_code(rd, 0, "read --callers")
            assert_stdout_contains(rd, "handleTransfer")
            assert_stdout_contains(rd, "verifyTransferSpec")

    @e2e_case(
        case_id="T1-F08-03",
        tier=1,
        feature="F08",
        title="Multi-hop dependency chain with -d 3 orders types -> service -> handler -> spec",
        tags=("ordering", "multi-hop"),
    )
    def test_multi_hop_topological_order(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_fixture("graph/handler.spec.ts", "src/handler.spec.ts")

            rd = self.adapter.read_file(
                sb, "src/handler.spec.ts", deps=True, extra_flags=["-d", "3"]
            )
            assert_exit_code(rd, 0, "multi-hop --deps -d 3")
            p_types = rd.stdout.find("types.ts")
            p_service = rd.stdout.find("service.ts")
            p_handler = rd.stdout.find("handler.ts")
            p_spec = rd.stdout.find("handler.spec.ts")
            self.assertNotIn(-1, (p_types, p_service, p_handler, p_spec), rd.stdout)
            self.assertLess(p_types, p_service, rd.stdout)
            self.assertLess(p_service, p_handler, rd.stdout)
            self.assertLess(p_handler, p_spec, rd.stdout)

    @e2e_case(
        case_id="T1-F08-04",
        tier=1,
        feature="F08",
        title="Cross-language schema->code dependency ordering (schema.prisma -> service)",
        tags=("ordering", "cross-language"),
    )
    def test_cross_language_schema_before_service(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r6/valid/schema.prisma", "prisma/schema.prisma")
            sb.seed_file(
                "src/account_service.ts",
                '// schema: ../prisma/schema.prisma\n'
                'export interface AccountDto { id: number; owner: string; balance: number; }\n'
                'export function summarizeAccount(acct: AccountDto): string {\n'
                '  return `${acct.owner}:${acct.balance}`;\n'
                '}\n',
            )

            rd = self.adapter.batch_read(
                sb, ["src/account_service.ts", "prisma/schema.prisma"], deps=True
            )
            assert_exit_code(rd, 0, "cross-language batch --deps")
            p_schema = rd.stdout.find("schema.prisma")
            p_svc = rd.stdout.find("account_service.ts")
            self.assertNotIn(-1, (p_schema, p_svc), rd.stdout)
            self.assertLess(p_schema, p_svc, rd.stdout)

    @e2e_case(
        case_id="T1-F08-05",
        tier=1,
        feature="F08",
        title="--no-deps and --no-callers suppress extra expansion on explicit slice",
        tags=("ordering", "no-deps"),
    )
    def test_no_deps_and_no_callers_suppresses_expansion(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            rd = self.adapter.read_file(
                sb, "src/app.ts", selector="App.inc", deps=False, callers=False
            )
            assert_exit_code(rd, 0, "read --no-deps --no-callers")
            assert_stdout_contains(rd, "inc")
            assert_stdout_not_contains(rd, "Calculator.mul")
            assert_stdout_not_contains(rd, 'label: "product"')


class TestTier1F09FindSearchAndGuessing(unittest.TestCase):
    """F09: Parallel find, Ranked search & Smart Fuzzy Guessing (7 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F09-01",
        tier=1,
        feature="F09",
        title="find, tree alias, and read --files skip .git, node_modules, and binary files",
        tags=("find", "tree", "read-files"),
    )
    def test_find_tree_and_read_files_skip_ignored_and_binary(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            sb.seed_file(".git/HEAD", "ref: refs/heads/main\n")
            sb.seed_file("node_modules/pkg/index.js", "export const x = 1;\n")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")

            for label, res in (
                ("find", self.adapter.find(sb)),
                ("tree", self.adapter.run_raw(sb, ["tree"])),
                ("read --files", self.adapter.run_raw(sb, ["read", "--files"])),
            ):
                assert_exit_code(res, 0, label)
                assert_stdout_contains(res, "src/math.ts", label)
                assert_stdout_contains(res, "src/app.ts", label)
                assert_stdout_not_contains(res, ".git/HEAD", label)
                assert_stdout_not_contains(res, "node_modules", label)
                assert_stdout_not_contains(res, "bin/logo.png", label)

    @e2e_case(
        case_id="T1-F09-02",
        tier=1,
        feature="F09",
        title="find -d 1, --max-depth 1, and -L 1 limit traversal depth",
        tags=("find", "depth"),
    )
    def test_find_depth_flags(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("top.ts", "export const top = 1;\n")
            sb.seed_fixture("graph/math.ts", "src/nested/deep.ts")

            for label, res in (
                ("--max-depth 1", self.adapter.find(sb, max_depth=1)),
                ("-d 1", self.adapter.find(sb, extra_flags=["-d", "1"])),
                ("-L 1", self.adapter.find(sb, extra_flags=["-L", "1"])),
            ):
                assert_exit_code(res, 0, label)
                assert_stdout_contains(res, "top.ts", label)
                assert_stdout_not_contains(res, "deep.ts", label)

    @e2e_case(
        case_id="T1-F09-03",
        tier=1,
        feature="F09",
        title="find --search worker and find --json filter and structure output",
        tags=("find", "search", "json"),
    )
    def test_find_search_filter_and_json(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.py", "src/worker.py")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            r_filt = self.adapter.find(sb, search="worker")
            assert_exit_code(r_filt, 0, "find --search worker")
            assert_stdout_contains(r_filt, "src/worker.py")
            assert_stdout_not_contains(r_filt, "src/math.ts")

            r_json = self.adapter.find(sb, json_mode=True)
            assert_exit_code(r_json, 0, "find --json")
            self.assertIsNotNone(r_json.stdout_json)
            serialized = json.dumps(r_json.stdout_json)
            self.assertIn("src/worker.py", serialized)
            self.assertIn("src/math.ts", serialized)

    @e2e_case(
        case_id="T1-F09-04",
        tier=1,
        feature="F09",
        title="search and grep alias 4-tier ranking places production defs before test files (B-R2)",
        tags=("search", "ranking", "aice-ir"),
    )
    def test_search_and_grep_ranking_and_aice_snippets(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_fixture("graph/handler.spec.ts", "src/handler.spec.ts")

            for label, res in (
                ("search", self.adapter.search(sb, "handleTransfer")),
                ("grep", self.adapter.run_raw(sb, ["grep", "handleTransfer"])),
            ):
                assert_exit_code(res, 0, label)
                assert_no_ast_fallback_marker(res, label)
                pos_prod = res.stdout.find("handler.ts")
                pos_spec = res.stdout.find("handler.spec.ts")
                self.assertNotEqual(pos_prod, -1, res.stdout)
                self.assertNotEqual(pos_spec, -1, res.stdout)
                self.assertLess(pos_prod, pos_spec, res.stdout)

    @e2e_case(
        case_id="T1-F09-05",
        tier=1,
        feature="F09",
        title="search -C 2 context window, -l paths only, and --json alternation",
        tags=("search", "context", "files-only", "json"),
    )
    def test_search_context_files_only_and_json_alternation(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            r_ctx = self.adapter.search(sb, "this.count", context_lines=2)
            assert_exit_code(r_ctx, 0, "search -C 2")
            assert_stdout_contains(r_ctx, "src/app.ts")
            assert_stdout_contains(r_ctx, "inc")

            r_files = self.adapter.search(sb, "Calculator", files_only=True)
            assert_exit_code(r_files, 0, "search -l")
            assert_stdout_contains(r_files, "src/math.ts")
            assert_stdout_contains(r_files, "src/app.ts")
            assert_stdout_not_contains(r_files, 'label: "sum"')

            r_json = self.adapter.search(sb, "add|mul", json_mode=True)
            assert_exit_code(r_json, 0, "search --json alternation")
            self.assertIsNotNone(r_json.stdout_json)
            dump = json.dumps(r_json.stdout_json)
            self.assertIn("add", dump)
            self.assertIn("mul", dump)

    @e2e_case(
        case_id="T1-F09-06",
        tier=1,
        feature="F09",
        title="Smart fuzzy guessing auto-resolves unambiguous single-char typo in selector (R8)",
        tags=("guessing", "fuzzy"),
    )
    def test_fuzzy_guessing_auto_resolves_single_char_typo(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            rd = self.adapter.read_file(sb, "src/math.ts", selector="Calculater.add")
            assert_exit_code(rd, 0, "fuzzy single-char typo auto-resolve")
            assert_stdout_contains(rd, "add")

    @e2e_case(
        case_id="T1-F09-07",
        tier=1,
        feature="F09",
        title="Smart fuzzy guessing returns compact ranked selectors for ambiguous target (R8)",
        tags=("guessing", "ambiguous"),
    )
    def test_fuzzy_guessing_ranked_candidates_for_ambiguous_target(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/calc.ts",
                "export function computeSum(a: number, b: number): number { return a + b; }\n"
                "export function computeSub(a: number, b: number): number { return a - b; }\n",
            )

            rd = self.adapter.read_file(sb, "src/calc.ts", selector="computeSu")
            combined = rd.stdout + "\n" + rd.stderr
            self.assertIn("computeSum", combined)
            self.assertIn("computeSub", combined)


class TestTier1F10BatchReadAndBudget(unittest.TestCase):
    """F10: Multi-Target Batch Read Packs & Water-Filling Budget (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F10-01",
        tier=1,
        feature="F10",
        title="Coalesce multiple symbols and files in one read command (READ-07)",
        tags=("batch-read", "coalesce"),
    )
    def test_batch_read_coalesces_multiple_symbols(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            rd = self.adapter.batch_read(
                sb,
                ["src/types.ts:LedgerRecord", "src/math.ts:Calculator.add", "src/app.ts:App.inc"],
            )
            assert_exit_code(rd, 0, "batch read symbols")
            assert_stdout_contains(rd, "LedgerRecord")
            assert_stdout_contains(rd, "add")
            assert_stdout_contains(rd, "inc")

    @e2e_case(
        case_id="T1-F10-02",
        tier=1,
        feature="F10",
        title="Mixed batch selectors: :L, :/pat/, :Sym@block, and :outline in one read",
        tags=("batch-read", "selectors"),
    )
    def test_mixed_batch_selectors(self) -> None:
        big_text = _load_bpe_vectors()["vectors"]["big_ts"]["text"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_file("src/big.ts", big_text)

            rd = self.adapter.batch_read(
                sb,
                [
                    "src/math.ts:L1-L4",
                    "src/app.ts:/reset/",
                    "src/big.ts:runBatchPipeline@divisible",
                    "src/monolith.ts:outline",
                ],
            )
            assert_exit_code(rd, 0, "mixed batch selectors")
            assert_stdout_contains(rd, "CalcResult")
            assert_stdout_contains(rd, "reset")
            assert_stdout_contains(rd, "divisible")
            assert_stdout_contains(rd, "processBatchMonolith")

    @e2e_case(
        case_id="T1-F10-03",
        tier=1,
        feature="F10",
        title="Deduplicate overlapping selectors in one batch read",
        tags=("batch-read", "dedup"),
    )
    def test_batch_read_deduplicates_overlapping_selectors(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            rd = self.adapter.batch_read(
                sb, ["src/app.ts", "src/app.ts:App.inc", "src/app.ts:L12-L15"]
            )
            assert_exit_code(rd, 0, "overlapping batch read")
            assert_stdout_contains(rd, "App")
            assert_stdout_contains(rd, "inc")
            # App.inc should not be duplicated 3 separate times in the context pack
            self.assertLessEqual(rd.stdout.count("this.calc.add(this.count, step)"), 1)

    @e2e_case(
        case_id="T1-F10-04",
        tier=1,
        feature="F10",
        title="Deterministic --max-tokens water-filling budget bounds output tokens",
        tags=("batch-read", "budget"),
    )
    def test_max_tokens_water_filling_deterministic_and_bounded(self) -> None:
        big_text = _load_bpe_vectors()["vectors"]["big_ts"]["text"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", big_text)
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            targets = ["src/big.ts", "src/monolith.ts", "src/math.ts"]
            rd1 = self.adapter.batch_read(sb, targets, max_tokens=250)
            rd2 = self.adapter.batch_read(sb, targets, max_tokens=250)
            assert_exit_code(rd1, 0, "batch --max-tokens run 1")
            assert_exit_code(rd2, 0, "batch --max-tokens run 2")
            self.assertEqual(rd1.stdout, rd2.stdout, "Budget output must be deterministic")

            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            self.assertLessEqual(rows[0]["a1"], 280)

    @e2e_case(
        case_id="T1-F10-05",
        tier=1,
        feature="F10",
        title="read --json and --stats emit valid JSON and telemetry footer (READ-12, B-T6)",
        tags=("batch-read", "json", "stats"),
    )
    def test_batch_read_json_and_stats(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            r_json = self.adapter.batch_read(
                sb, ["src/math.ts", "src/app.ts"], json_mode=True
            )
            assert_exit_code(r_json, 0, "batch read --json")
            self.assertIsNotNone(r_json.stdout_json)

            r_stats = self.adapter.batch_read(
                sb, ["src/math.ts", "src/app.ts"], stats=True
            )
            assert_exit_code(r_stats, 0, "batch read --stats")
            self.assertTrue(r_stats.stdout.strip())
            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            self.assertEqual(rows[-1]["ac"], len(r_stats.stdout_bytes))


class TestTier1F11SingleTargetSplice(unittest.TestCase):
    """F11: Surgical Single-Target Splice, Hunks & Doc Preservation (7 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F11-01",
        tier=1,
        feature="F11",
        title="--create and --overwrite write new and replaced files cleanly (SPL-01/02)",
        tags=("splice", "create", "overwrite"),
    )
    def test_splice_create_and_overwrite(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            c_res = self.adapter.splice_single(
                sb, "src/new_mod.ts", code="export const ok = true;\n", create=True
            )
            assert_exit_code(c_res, 0, "splice --create")
            assert_disk_file_equals(sb, "src/new_mod.ts", "export const ok = true;\n")

            o_res = self.adapter.splice_single(
                sb,
                "src/new_mod.ts",
                code="export const ok = false;\nexport const version = 2;\n",
                overwrite=True,
            )
            assert_exit_code(o_res, 0, "splice --overwrite")
            assert_disk_file_equals(
                sb, "src/new_mod.ts", "export const ok = false;\nexport const version = 2;\n"
            )

    @e2e_case(
        case_id="T1-F11-02",
        tier=1,
        feature="F11",
        title="Symbol splice -s App.inc preserves leading JSDoc and sibling methods (SPL-03)",
        tags=("splice", "symbol", "preserve-docs"),
    )
    def test_symbol_splice_preserves_jsdoc_and_siblings(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            sp = self.adapter.splice_single(
                sb,
                "src/app.ts",
                symbol="App.inc",
                code=(
                    "  public inc(step: number): CalcResult {\n"
                    "    this.count += step * 2;\n"
                    "    return this.calc.add(this.count, step);\n"
                    "  }"
                ),
            )
            assert_exit_code(sp, 0, "splice App.inc")
            disk = sb.read_text("src/app.ts")
            self.assertIn("/** Increment counter and compute sum */", disk)
            self.assertIn("this.count += step * 2;", disk)
            self.assertIn("public reset(): number", disk)

    @e2e_case(
        case_id="T1-F11-03",
        tier=1,
        feature="F11",
        title="Line-range splice -s L12-L15 plus :imports and :eof selectors (SPL-04/05)",
        tags=("splice", "line-range", "imports", "eof"),
    )
    def test_line_range_imports_and_eof_splice(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            # Lines 12-15 of graph/app.ts are the complete balanced inc() method
            sp_line = self.adapter.splice_single(
                sb,
                "src/app.ts",
                symbol="L12-L15",
                code=(
                    "  public inc(step: number): CalcResult {\n"
                    "    this.count += step + 1;\n"
                    "    return this.calc.add(this.count, step);\n"
                    "  }"
                ),
            )
            assert_exit_code(sp_line, 0, "splice -s L12-L15")
            self.assertIn("this.count += step + 1;", sb.read_text("src/app.ts"))

            sp_imp = self.adapter.splice_single(
                sb,
                "src/app.ts",
                symbol="imports",
                code=(
                    'import { Calculator, type CalcResult } from "./math.js";\n'
                    'import type { LedgerRecord } from "./types.js";'
                ),
            )
            assert_exit_code(sp_imp, 0, "splice -s imports")
            self.assertIn("LedgerRecord", sb.read_text("src/app.ts"))

            sp_eof = self.adapter.splice_single(
                sb, "src/app.ts", symbol="eof", code="export const APP_VERSION = 1;\n"
            )
            assert_exit_code(sp_eof, 0, "splice -s eof")
            self.assertTrue(sb.read_text("src/app.ts").rstrip().endswith("export const APP_VERSION = 1;"))

    @e2e_case(
        case_id="T1-F11-04",
        tier=1,
        feature="F11",
        title="--delete, --insert-after, and --insert-before maintain exact sibling order (SPL-06/07)",
        tags=("splice", "delete", "insert"),
    )
    def test_delete_insert_after_and_insert_before_ordering(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            ins_after = self.adapter.splice_single(
                sb,
                "src/app.ts",
                insert_after="App.inc",
                code="  public peek(): number {\n    return this.count;\n  }",
            )
            assert_exit_code(ins_after, 0, "--insert-after App.inc")

            ins_before = self.adapter.splice_single(
                sb,
                "src/app.ts",
                insert_before="App.reset",
                code="  public dec(): number {\n    this.count -= 1;\n    return this.count;\n  }",
            )
            assert_exit_code(ins_before, 0, "--insert-before App.reset")

            disk = sb.read_text("src/app.ts")
            p_inc = disk.find("public inc(")
            p_peek = disk.find("public peek(")
            p_dec = disk.find("public dec(")
            p_reset = disk.find("public reset(")
            self.assertNotIn(-1, (p_inc, p_peek, p_dec, p_reset), disk)
            self.assertLess(p_inc, p_peek)
            self.assertLess(p_peek, p_dec)
            self.assertLess(p_dec, p_reset)

            del_res = self.adapter.splice_single(
                sb, "src/app.ts", symbol="App.peek", delete=True
            )
            assert_exit_code(del_res, 0, "--delete App.peek")
            disk_after = sb.read_text("src/app.ts")
            self.assertNotIn("public peek(", disk_after)
            self.assertIn("public dec(", disk_after)

    @e2e_case(
        case_id="T1-F11-05",
        tier=1,
        feature="F11",
        title="<<< === >>> contextual hunk replaces matched block with whitespace resilience (SPL-08)",
        tags=("splice", "hunk"),
    )
    def test_contextual_hunk_with_whitespace_resilience(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            hunk = (
                "<<<\n"
                "this.count += step;\n"
                "return this.calc.add(this.count, step);\n"
                "===\n"
                "    this.count += step * 3;\n"
                "    return this.calc.add(this.count, step);\n"
                ">>>\n"
            )
            sp = self.adapter.splice_heredoc(sb, hunk, path="src/app.ts")
            assert_exit_code(sp, 0, "contextual hunk splice")
            disk = sb.read_text("src/app.ts")
            self.assertIn("this.count += step * 3;", disk)
            self.assertIn("public reset(): number", disk)

    @e2e_case(
        case_id="T1-F11-06",
        tier=1,
        feature="F11",
        title="--dry-run --diff emits unified diff without modifying disk (SPL-10)",
        tags=("splice", "dry-run", "diff"),
    )
    def test_dry_run_diff_leaves_disk_unchanged(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            before = sb.snapshot_tree()

            sp = self.adapter.splice_single(
                sb,
                "src/app.ts",
                symbol="App.reset",
                code="  public reset(): number {\n    this.count = -1;\n    return this.count;\n  }",
                dry_run=True,
                diff=True,
            )
            assert_exit_code(sp, 0, "splice --dry-run --diff")
            assert_stdout_contains(sp, "-    this.count = 0;")
            assert_stdout_contains(sp, "+    this.count = -1;")
            assert_disk_unchanged(sb, before, context="dry-run --diff")

    @e2e_case(
        case_id="T1-F11-07",
        tier=1,
        feature="F11",
        title="splice --json, --from, --no-preserve-docs, and --stdin single-file",
        tags=("splice", "json", "from", "no-preserve-docs"),
    )
    def test_splice_json_from_no_preserve_docs_and_stdin(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            sb.seed_file(
                "inc_payload.ts",
                "  public inc(step: number): CalcResult {\n"
                "    this.count += step + 9;\n"
                "    return this.calc.add(this.count, step);\n"
                "  }\n",
            )

            sp_from = self.adapter.splice_single(
                sb,
                "src/app.ts",
                symbol="App.inc",
                from_file="inc_payload.ts",
                preserve_docs=False,
                json_mode=True,
            )
            assert_exit_code(sp_from, 0, "splice --from --no-preserve-docs --json")
            self.assertIsNotNone(sp_from.stdout_json)
            disk1 = sb.read_text("src/app.ts")
            self.assertIn("step + 9", disk1)
            self.assertNotIn("/** Increment counter and compute sum */", disk1)

            sp_stdin = self.adapter.splice_heredoc(
                sb,
                "=== src/app.ts:App.reset ===\n"
                "  public reset(): number {\n"
                "    this.count = 42;\n"
                "    return this.count;\n"
                "  }\n",
            )
            assert_exit_code(sp_stdin, 0, "splice --stdin single-file")
            self.assertIn("this.count = 42;", sb.read_text("src/app.ts"))


class TestTier1F12AtomicBatchWrite(unittest.TestCase):
    """F12: Atomic Multi-Target Batch Write/Splice & Rollback (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F12-01",
        tier=1,
        feature="F12",
        title="--stdin heredoc batch creates, splices, and deletes across 3 files atomically (SPL-09)",
        tags=("batch-write", "stdin", "atomic"),
    )
    def test_stdin_heredoc_create_splice_delete_3_files(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            stream = (
                "=== src/created.ts ===\n"
                "export const CREATED_OK = true;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + this.offset + 5, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.reset === --delete\n"
            )
            sp = self.adapter.splice_heredoc(sb, stream)
            assert_exit_code(sp, 0, "3-file heredoc batch")
            assert_disk_file_equals(sb, "src/created.ts", "export const CREATED_OK = true;\n")
            self.assertIn("this.offset + 5", sb.read_text("src/math.ts"))
            self.assertNotIn("public reset(", sb.read_text("src/app.ts"))
            self.assertIn("public inc(", sb.read_text("src/app.ts"))

    @e2e_case(
        case_id="T1-F12-02",
        tier=1,
        feature="F12",
        title="--stdin heredoc with multiple <<< === >>> hunks across polyglot files",
        tags=("batch-write", "hunk", "polyglot"),
    )
    def test_stdin_heredoc_polyglot_hunks_and_blocks(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/monolith.ts", "src/monolith.ts")
            sb.seed_fixture("r5/valid/sample.py", "src/sample.py")
            sb.seed_fixture("r5/valid/sample.css", "web/styles.css")

            stream = (
                "=== src/monolith.ts ===\n"
                "<<<\n"
                '    notes.push("empty-input");\n'
                "===\n"
                '    notes.push("empty-batch-input");\n'
                ">>>\n"
                "=== src/sample.py ===\n"
                "<<<\n"
                "    return base + entry.delta\n"
                "===\n"
                "    return base + entry.delta + 1\n"
                ">>>\n"
                "=== web/styles.css ===\n"
                "<<<\n"
                "  gap: 12px;\n"
                "===\n"
                "  gap: 18px;\n"
                ">>>\n"
            )
            sp = self.adapter.splice_heredoc(sb, stream)
            assert_exit_code(sp, 0, "polyglot heredoc hunks")
            self.assertIn("empty-batch-input", sb.read_text("src/monolith.ts"))
            self.assertIn("entry.delta + 1", sb.read_text("src/sample.py"))
            self.assertIn("gap: 18px;", sb.read_text("web/styles.css"))

    @e2e_case(
        case_id="T1-F12-03",
        tier=1,
        feature="F12",
        title="--batch JSON atomic multi-file transaction",
        tags=("batch-write", "json-batch"),
    )
    def test_batch_json_multi_file_transaction(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            items = [
                {"filePath": "cfg/batch.json", "create": True, "code": '{"ok": true}\n'},
                {
                    "filePath": "src/math.ts",
                    "symbol": "Calculator.add",
                    "code": (
                        "  public add(a: number, b: number): CalcResult {\n"
                        '    return { value: a + b + this.offset + 3, label: "sum" };\n'
                        "  }"
                    ),
                },
                {
                    "filePath": "src/app.ts",
                    "symbol": "App.reset",
                    "code": "  public reset(): number {\n    this.count = 10;\n    return this.count;\n  }",
                },
            ]
            sp = self.adapter.splice_batch_json(sb, items, via_stdin=True)
            assert_exit_code(sp, 0, "splice --batch -")
            self.assertTrue(json.loads(sb.read_text("cfg/batch.json"))["ok"])
            self.assertIn("this.offset + 3", sb.read_text("src/math.ts"))
            self.assertIn("this.count = 10;", sb.read_text("src/app.ts"))

    @e2e_case(
        case_id="T1-F12-04",
        tier=1,
        feature="F12",
        title="--edits JSON multi-symbol reverse-offset edits in single file without line-shift corruption",
        tags=("batch-write", "edits"),
    )
    def test_edits_json_multi_symbol_same_file(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            edits = [
                {
                    "symbol": "Calculator.add",
                    "code": (
                        "  public add(a: number, b: number): CalcResult {\n"
                        "    const extra = 1;\n"
                        "    const total = a + b + this.offset + extra;\n"
                        '    return { value: total, label: "sum" };\n'
                        "  }"
                    ),
                },
                {
                    "symbol": "Calculator.mul",
                    "code": (
                        "  public mul(a: number, b: number): CalcResult {\n"
                        "    const factor = a * b;\n"
                        '    return { value: factor + this.offset, label: "product" };\n'
                        "  }"
                    ),
                },
            ]
            sp = self.adapter.splice_batch_json(
                sb, edits, edits_for_file="src/math.ts", via_stdin=True
            )
            assert_exit_code(sp, 0, "splice --edits -")
            disk = sb.read_text("src/math.ts")
            self.assertIn("const extra = 1;", disk)
            self.assertIn("const factor = a * b;", disk)

    @e2e_case(
        case_id="T1-F12-05",
        tier=1,
        feature="F12",
        title="--stdin --dry-run --diff previews multi-file batch without disk writes",
        tags=("batch-write", "dry-run", "diff"),
    )
    def test_stdin_dry_run_diff_multi_file_no_writes(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            before = sb.snapshot_tree()

            stream = (
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 99, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.reset ===\n"
                "  public reset(): number {\n"
                "    this.count = 99;\n"
                "    return this.count;\n"
                "  }\n"
            )
            sp = self.adapter.splice_heredoc(sb, stream, dry_run=True, diff=True)
            assert_exit_code(sp, 0, "batch --stdin --dry-run --diff")
            assert_stdout_contains(sp, "+")
            assert_disk_unchanged(sb, before, context="batch dry-run")


class TestTier1F13McpServer(unittest.TestCase):
    """F13: Strict 2-Tool MCP Stdio JSON-RPC 2.0 Server (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F13-01",
        tier=1,
        feature="F13",
        title="MCP initialize and tools/list returns strictly ['aice_read', 'aice_splice'] (MCP-01)",
        tags=("mcp", "tools-list"),
    )
    def test_mcp_initialize_and_strict_two_tools(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            for framing in ("newline", "content-length"):
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
                        {"method": "tools/list", "params": {}},
                    ],
                    framing=framing,  # type: ignore[arg-type]
                )
                self.assertEqual(sess.exit_code, 0, sess.stderr)
                self.assertEqual(len(sess.responses), 2)
                assert_mcp_strict_two_tools(sess.responses[1])

    @e2e_case(
        case_id="T1-F13-02",
        tier=1,
        feature="F13",
        title="MCP aice_read reads symbol slice in AICE IR and skips binary logo.png",
        tags=("mcp", "aice-read", "binary"),
    )
    def test_mcp_aice_read_symbol_and_binary_skip(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")
            raw_math = sb.read_text("src/math.ts")

            resp_sym, sess_sym = self.adapter.mcp_call(
                sb, "aice_read", {"path": "src/math.ts:Calculator.add"}
            )
            self.assertEqual(sess_sym.exit_code, 0, sess_sym.stderr)
            txt = assert_mcp_text_result(resp_sym, "add")
            assert_is_aice_transformed(txt, "ts", raw_math, "mcp aice_read")

            resp_bin, sess_bin = self.adapter.mcp_call(
                sb, "aice_read", {"path": "bin/logo.png"}
            )
            self.assertEqual(sess_bin.exit_code, 0, sess_bin.stderr)
            bin_txt = assert_mcp_text_result(resp_bin, "binary")
            assert_no_raw_binary_bytes(bin_txt.encode("utf-8"), "mcp binary skip")

    @e2e_case(
        case_id="T1-F13-03",
        tier=1,
        feature="F13",
        title="MCP aice_read batch paths array coalesces multi-file context pack",
        tags=("mcp", "aice-read", "batch"),
    )
    def test_mcp_aice_read_batch_paths(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            resp, sess = self.adapter.mcp_call(
                sb,
                "aice_read",
                {"paths": ["src/types.ts", "src/math.ts", "src/app.ts"]},
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            txt = assert_mcp_text_result(resp)
            self.assertIn("AccountId", txt)
            self.assertIn("Calculator", txt)
            self.assertIn("App", txt)

    @e2e_case(
        case_id="T1-F13-04",
        tier=1,
        feature="F13",
        title="MCP aice_splice updates symbol on disk (MCP-01)",
        tags=("mcp", "aice-splice"),
    )
    def test_mcp_aice_splice_single_symbol(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            resp, sess = self.adapter.mcp_call(
                sb,
                "aice_splice",
                {
                    "filePath": "src/app.ts",
                    "symbol": "App.reset",
                    "code": "  public reset(): number {\n    this.count = 7;\n    return this.count;\n  }",
                },
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_text_result(resp)
            self.assertIn("this.count = 7;", sb.read_text("src/app.ts"))

    @e2e_case(
        case_id="T1-F13-05",
        tier=1,
        feature="F13",
        title="MCP aice_splice executes multi-file === file:sel === stream atomically",
        tags=("mcp", "aice-splice", "batch"),
    )
    def test_mcp_aice_splice_multi_file_stream(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            stream = (
                "=== src/created.ts ===\n"
                "export const MCP_CREATED = 1;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + this.offset + 8, label: "sum" };\n'
                "  }\n"
                "=== src/app.ts:App.reset ===\n"
                "  public reset(): number {\n"
                "    this.count = 8;\n"
                "    return this.count;\n"
                "  }\n"
            )
            resp, sess = self.adapter.mcp_call(sb, "aice_splice", {"code": stream})
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_text_result(resp)
            assert_disk_file_equals(sb, "src/created.ts", "export const MCP_CREATED = 1;\n")
            self.assertIn("this.offset + 8", sb.read_text("src/math.ts"))
            self.assertIn("this.count = 8;", sb.read_text("src/app.ts"))


class TestTier1F14UxCompatPortability(unittest.TestCase):
    """F14: R7 Config/Idiom Compat, Redesigned --help/agents UX & Zero-Node Portability (5 tests)."""

    def setUp(self) -> None:
        self.adapter = AiceAdapter()

    @e2e_case(
        case_id="T1-F14-01",
        tier=1,
        feature="F14",
        title="aice.config.json with idiomsEnabled and idioms tolerated across enable/disable/status (GOV-03/06)",
        tags=("compat", "r7", "config"),
    )
    def test_config_idioms_fields_preserved_across_admin(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("idioms")

            st1 = self.adapter.status(sb, json_mode=True)
            assert_exit_code(st1, 0, "status with idioms config")
            self.assertTrue(st1.stdout_json.get("enabled"))

            assert_exit_code(self.adapter.disable(sb), 0, "disable with idioms config")
            assert_exit_code(self.adapter.enable(sb), 0, "enable with idioms config")

            cfg_after = json.loads(sb.read_text("aice.config.json"))
            self.assertTrue(cfg_after.get("enabled"))
            self.assertIn("idioms", cfg_after)
            self.assertIn("$clamp", cfg_after["idioms"])

    @e2e_case(
        case_id="T1-F14-02",
        tier=1,
        feature="F14",
        title="Read and round-trip splice on idiom-eligible file succeeds cleanly (R7 safe)",
        tags=("compat", "r7", "roundtrip"),
    )
    def test_idiom_eligible_file_read_and_splice_roundtrip(self) -> None:
        big_text = _load_bpe_vectors()["vectors"]["big_ts"]["text"]
        with Sandbox() as sb:
            sb.seed_config("idioms")
            sb.seed_file("src/big.ts", big_text)

            rd = self.adapter.read_file(sb, "src/big.ts", selector="clampMetric")
            assert_exit_code(rd, 0, "read clampMetric")
            assert_is_aice_transformed(rd.stdout, "ts", big_text, "read clampMetric")

            sp = self.adapter.splice_single(
                sb,
                "src/big.ts",
                symbol="clampMetric",
                code=(
                    "export function clampMetric(value: number, minVal: number, maxVal: number): number {\n"
                    "  return Math.min(Math.max(value, minVal), maxVal) + 0;\n"
                    "}"
                ),
            )
            assert_exit_code(sp, 0, "roundtrip splice clampMetric")
            disk = sb.read_text("src/big.ts")
            self.assertIn("Math.min(Math.max(value, minVal), maxVal) + 0;", disk)
            self.assertIn("export function summarizeMetrics", disk)

    @e2e_case(
        case_id="T1-F14-03",
        tier=1,
        feature="F14",
        title="aice --help and --version render redesigned Rust CLI help cleanly (R1)",
        tags=("ux", "help", "version"),
    )
    def test_cli_help_and_version(self) -> None:
        with Sandbox() as sb:
            h = self.adapter.help(sb)
            assert_exit_code(h, 0, "--help")
            for cmd in ("read", "search", "find", "splice", "mcp", "gain"):
                assert_stdout_contains(h, cmd, "--help")

            v = self.adapter.version(sb)
            assert_exit_code(v, 0, "--version")
            self.assertRegex(v.stdout.strip(), r"\d+\.\d+\.\d+")

    @e2e_case(
        case_id="T1-F14-04",
        tier=1,
        feature="F14",
        title="aice agents status runs cleanly without crashing",
        tags=("ux", "agents"),
    )
    def test_agents_status_runs_cleanly(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            res = self.adapter.run_raw(sb, ["agents", "status"])
            assert_exit_code(res, 0, "agents status")
            self.assertTrue(res.stdout.strip())

    @e2e_case(
        case_id="T1-F14-05",
        tier=1,
        feature="F14",
        title="Standalone binary runs with Node/TS/Python absent from PATH (R1)",
        tags=("portability", "zero-node"),
    )
    def test_standalone_binary_runs_with_empty_path(self) -> None:
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            raw = sb.read_text("src/math.ts")

            rd = self.adapter.read_file(sb, "src/math.ts", env_overrides={"PATH": ""})
            assert_exit_code(rd, 0, "read with PATH=''")
            assert_is_aice_transformed(rd.stdout, "ts", raw, "zero-node read")

            sp = self.adapter.splice_single(
                sb,
                "src/math.ts",
                symbol="Calculator.add",
                code=(
                    "  public add(a: number, b: number): CalcResult {\n"
                    '    return { value: a + b + this.offset + 4, label: "sum" };\n'
                    "  }"
                ),
                env_overrides={"PATH": ""},
            )
            assert_exit_code(sp, 0, "splice with PATH=''")
            self.assertIn("this.offset + 4", sb.read_text("src/math.ts"))
