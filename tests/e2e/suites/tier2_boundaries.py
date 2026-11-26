"""Tier 2 — Boundary, Corner & Error-Rejection E2E Test Suite (95 cases: T2-F01-01..T2-F14-05)."""

from __future__ import annotations

import json
import tempfile
import unittest

from harness.adapter import AiceAdapter, CliResult
from harness.assertions import (
    assert_disk_file_absent,
    assert_disk_unchanged,
    assert_exit_code,
    assert_gain_json_valid,
    assert_is_aice_transformed,
    assert_mcp_tool_error,
    assert_no_ast_fallback_marker,
    assert_no_raw_binary_bytes,
    assert_stdout_contains,
    assert_stdout_not_contains,
    assert_telemetry_ledger_consistent,
    assert_tmp_telemetry_suppressed,
)
from harness.config import FIXTURES_DIR
from harness.reporting import e2e_case
from harness.sandbox import Sandbox


def _assert_no_panic(res: CliResult, context: str = "") -> None:
    prefix = f"[{context}] " if context else ""
    combined = f"{res.stdout}\n{res.stderr}"
    for marker in ("panicked at", "RUST_BACKTRACE", "thread 'main' panicked"):
        if marker in combined:
            raise AssertionError(
                f"{prefix}Rust panic marker {marker!r} detected in output.\n"
                f"stdout={res.stdout!r}\nstderr={res.stderr!r}"
            )


def _assert_has_diagnostic(res: CliResult, context: str = "") -> str:
    prefix = f"[{context}] " if context else ""
    combined = f"{res.stderr}\n{res.stdout}".strip()
    if not combined:
        raise AssertionError(f"{prefix}Expected non-empty diagnostic message on failure")
    return combined


def _read_fixture_text(rel_path: str) -> str:
    return (FIXTURES_DIR / rel_path).read_text(encoding="utf-8")


def _load_bpe_vectors() -> dict[str, dict[str, object]]:
    data = json.loads((FIXTURES_DIR / "bpe_vectors.json").read_text(encoding="utf-8"))
    return data["vectors"]


def _build_numbered_ts_file(line_count: int, marker_name: str, fn_name: str) -> str:
    """Build a valid TypeScript file with an exact line count and an identifiable body marker."""
    lines: list[str] = ["export interface Item { id: number; }"]
    idx = 0
    while len(lines) < line_count - 4:
        lines.append(f"export function helper_{idx:03d}(x: number): number {{ return x + {idx}; }}")
        idx += 1
    remaining = line_count - len(lines)
    if remaining == 4:
        lines.extend(
            [
                f"export function {fn_name}(): number {{",
                f"  const {marker_name} = {line_count};",
                f"  return {marker_name};",
                "}",
            ]
        )
    elif remaining == 3:
        lines.extend(
            [
                f"export function {fn_name}(): number {{",
                f"  const {marker_name} = {line_count}; return {marker_name};",
                "}",
            ]
        )
    else:
        while len(lines) < line_count - 1:
            lines.append(f"export const pad_{len(lines)} = {len(lines)};")
        lines.append(f"export function {fn_name}(): number {{ const {marker_name} = {line_count}; return {marker_name}; }}")
    assert len(lines) == line_count, f"Expected {line_count} lines, built {len(lines)}"
    return "\n".join(lines) + "\n"


def _run_firewall_rejection_check(
    valid_fixture: str,
    invalid_fixture: str,
    dest_rel: str,
    *,
    force: bool = True,
    extra_bad_code: str | None = None,
    env_overrides: dict[str, str | None] | None = None,
) -> None:
    adapter = AiceAdapter()
    with Sandbox() as sb:
        sb.seed_config("enabled")
        sb.seed_fixture(valid_fixture, dest_rel)
        before = sb.snapshot_tree()

        bad_payloads = [_read_fixture_text(invalid_fixture)]
        if extra_bad_code is not None:
            bad_payloads.append(extra_bad_code)

        for payload in bad_payloads:
            res = adapter.splice_single(
                sb,
                dest_rel,
                overwrite=True,
                force=force,
                code=payload,
                env_overrides=env_overrides,
            )
            _assert_no_panic(res, dest_rel)
            assert_exit_code(res, 1, f"firewall reject {dest_rel}")
            _assert_has_diagnostic(res, f"firewall reject {dest_rel}")
            assert_disk_unchanged(sb, before, context=f"firewall reject {dest_rel}")


class TestTier2F01GovernanceBoundaries(unittest.TestCase):
    """F01: Governance, Config Discovery & Admin boundary/error tests (6 cases)."""

    @e2e_case(
        case_id="T2-F01-01",
        tier=2,
        feature="F01",
        title="enabled:false blocks read, find, search, splice, and splice --stdin with disk untouched",
        tags=("governance", "anti-bypass", "B-S2"),
    )
    def test_disabled_blocks_all_cli_surfaces(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()

            calls = [
                ("read", adapter.read_file(sb, "src/sample.ts")),
                ("find", adapter.find(sb)),
                ("search", adapter.search(sb, "applyCredit")),
                (
                    "splice",
                    adapter.splice_single(
                        sb,
                        "src/sample.ts",
                        symbol="applyCredit",
                        code="export function applyCredit() { return 0; }",
                    ),
                ),
                (
                    "splice --stdin",
                    adapter.splice_heredoc(
                        sb,
                        "=== src/sample.ts:applyCredit ===\nexport function applyCredit() { return 0; }\n",
                    ),
                ),
            ]
            for label, res in calls:
                _assert_no_panic(res, label)
                assert_exit_code(res, 1, f"disabled {label}")
                diag = _assert_has_diagnostic(res, f"disabled {label}").lower()
                self.assertTrue(
                    "aice.config.json" in diag or "enabled" in diag or "disabled" in diag,
                    f"[{label}] Diagnostic did not mention config/disabled state: {diag!r}",
                )
                assert_disk_unchanged(sb, before, context=f"disabled {label}")

    @e2e_case(
        case_id="T2-F01-02",
        tier=2,
        feature="F01",
        title="Malformed JSON in aice.config.json fails gracefully without panic",
        tags=("governance", "config", "error"),
    )
    def test_malformed_aice_config_json(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("malformed")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()

            res_status = adapter.status(sb, json_mode=False)
            _assert_no_panic(res_status, "malformed config status")
            assert_exit_code(res_status, 1, "malformed config status")
            _assert_has_diagnostic(res_status, "malformed config status")

            res_read = adapter.read_file(sb, "src/sample.ts")
            _assert_no_panic(res_read, "malformed config read")
            assert_exit_code(res_read, 1, "malformed config read")
            _assert_has_diagnostic(res_read, "malformed config read")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F01-03",
        tier=2,
        feature="F01",
        title="allowedReadRoots blocks ../outside traversal across read, find, search, and splice",
        tags=("governance", "security", "traversal"),
    )
    def test_allowed_read_roots_blocks_traversal(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("allowed_roots")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            sb.seed_file("shared/ok.ts", "export const ALLOWED_SHARED = true;\n", area="outside")
            sb.seed_file(
                "secret.ts",
                'export const SECRET_TOKEN = "DO_NOT_LEAK_SECRET";\n',
                area="outside",
            )
            ws_before = sb.snapshot_tree(sb.ws)
            out_before = sb.snapshot_tree(sb.outside)

            res_ok = adapter.read_file(sb, "../outside/shared/ok.ts")
            assert_exit_code(res_ok, 0, "allowed root read")
            assert_stdout_contains(res_ok, "ALLOWED_SHARED")

            for rel in ("../outside/secret.ts", "../../outside/secret.ts"):
                r_read = adapter.read_file(sb, rel)
                _assert_no_panic(r_read, f"read {rel}")
                assert_exit_code(r_read, 1, f"blocked traversal read {rel}")
                assert_stdout_not_contains(r_read, "DO_NOT_LEAK_SECRET", f"read {rel}")

                r_search = adapter.search(sb, "DO_NOT_LEAK_SECRET", targets=[rel])
                _assert_no_panic(r_search, f"search {rel}")
                assert_exit_code(r_search, 1, f"blocked traversal search {rel}")
                assert_stdout_not_contains(r_search, "DO_NOT_LEAK_SECRET", f"search {rel}")

                r_find = adapter.find(sb, targets=[rel])
                _assert_no_panic(r_find, f"find {rel}")
                assert_exit_code(r_find, 1, f"blocked traversal find {rel}")
                assert_stdout_not_contains(r_find, "secret.ts", f"find {rel}")

                r_splice = adapter.splice_single(
                    sb,
                    rel,
                    create=True,
                    overwrite=True,
                    code="export const PWNED = 1;\n",
                )
                _assert_no_panic(r_splice, f"splice {rel}")
                assert_exit_code(r_splice, 1, f"blocked traversal splice {rel}")

            assert_disk_unchanged(sb, ws_before, root=sb.ws)
            assert_disk_unchanged(sb, out_before, root=sb.outside)

    @e2e_case(
        case_id="T2-F01-04",
        tier=2,
        feature="F01",
        title="Symlink escaping project root is blocked on read and splice",
        tags=("governance", "security", "symlink"),
    )
    def test_symlink_escape_blocked(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            outside_target = sb.seed_file(
                "secret_target.ts",
                'export const SYMLINK_SECRET = "TOP_SECRET_SYMLINK_999";\n',
                area="outside",
            )
            sb.make_symlink("src/escape_link.ts", outside_target)
            ws_before = sb.snapshot_tree(sb.ws)
            out_before = sb.snapshot_tree(sb.outside)

            r_read = adapter.read_file(sb, "src/escape_link.ts")
            _assert_no_panic(r_read, "symlink escape read")
            assert_exit_code(r_read, 1, "symlink escape read")
            assert_stdout_not_contains(r_read, "TOP_SECRET_SYMLINK_999")

            r_splice = adapter.splice_single(
                sb,
                "src/escape_link.ts",
                overwrite=True,
                code="export const OVERWRITTEN = true;\n",
            )
            _assert_no_panic(r_splice, "symlink escape splice")
            assert_exit_code(r_splice, 1, "symlink escape splice")

            assert_disk_unchanged(sb, ws_before, root=sb.ws)
            assert_disk_unchanged(sb, out_before, root=sb.outside)

    @e2e_case(
        case_id="T2-F01-05",
        tier=2,
        feature="F01",
        title="enable is idempotent on pre-existing AGENTS.md and preserves custom user sections",
        tags=("governance", "agents-md", "idempotent"),
    )
    def test_enable_idempotent_on_existing_agents_md(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            custom = (
                "# Project Custom Rules\n"
                "Keep user section A verbatim.\n\n"
                "## Team Notes\n"
                "Keep user section B verbatim.\n"
            )
            sb.seed_file("AGENTS.md", custom)

            r1 = adapter.enable(sb)
            assert_exit_code(r1, 0, "first enable")
            r2 = adapter.enable(sb)
            assert_exit_code(r2, 0, "second enable")

            agents_text = sb.read_text("AGENTS.md")
            self.assertIn("Keep user section A verbatim.", agents_text)
            self.assertIn("Keep user section B verbatim.", agents_text)
            self.assertEqual(agents_text.count("<!-- AICE:START"), 1)
            self.assertEqual(agents_text.count("<!-- AICE:END"), 1)
            self.assertLessEqual(len(agents_text.encode("utf-8")), 22 * 1024)

    @e2e_case(
        case_id="T2-F01-06",
        tier=2,
        feature="F01",
        title="Non-existent target directory passed to enable and status returns non-zero cleanly",
        tags=("governance", "error"),
    )
    def test_nonexistent_dir_enable_and_status(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            before = sb.snapshot_tree()

            r_enable = adapter.enable(sb, "nonexistent_subdir_xyz")
            _assert_no_panic(r_enable, "enable missing dir")
            self.assertNotEqual(r_enable.exit_code, 0, "enable missing dir must fail")
            _assert_has_diagnostic(r_enable, "enable missing dir")

            r_status = adapter.status(sb, "nonexistent_subdir_xyz", json_mode=False)
            _assert_no_panic(r_status, "status missing dir")
            self.assertNotEqual(r_status.exit_code, 0, "status missing dir must fail")
            _assert_has_diagnostic(r_status, "status missing dir")

            assert_disk_unchanged(sb, before)


class TestTier2F02PipelineAndBinaryBoundaries(unittest.TestCase):
    """F02: Single Pipeline Law, Binary Guard & PlainText boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F02-01",
        tier=2,
        feature="F02",
        title="File with .txt extension containing embedded NUL byte is guarded as binary",
        tags=("pipeline", "binary", "nul"),
    )
    def test_nul_byte_in_txt_extension(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("binary/nul_disguised.txt", "src/disguised.txt")
            before = sb.snapshot_tree()

            r_read = adapter.read_file(sb, "src/disguised.txt")
            assert_exit_code(r_read, 0, "read nul-in-txt")
            assert_no_raw_binary_bytes(r_read.stdout_bytes, "read nul-in-txt")
            self.assertIn("binary", r_read.stdout.lower())

            r_splice = adapter.splice_single(
                sb, "src/disguised.txt", overwrite=True, code="plain replacement\n"
            )
            _assert_no_panic(r_splice, "splice nul-in-txt")
            assert_exit_code(r_splice, 1, "splice nul-in-txt")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F02-02",
        tier=2,
        feature="F02",
        title="Invalid UTF-8 byte sequence is guarded as binary on read and blocked on splice",
        tags=("pipeline", "binary", "utf8"),
    )
    def test_invalid_utf8_guarded_as_binary(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("binary/invalid_utf8.txt", "src/bad_utf8.txt")
            before = sb.snapshot_tree()

            r_read = adapter.read_file(sb, "src/bad_utf8.txt")
            assert_exit_code(r_read, 0, "read invalid utf8")
            assert_no_raw_binary_bytes(r_read.stdout_bytes, "read invalid utf8")
            self.assertNotIn(b"\xff\xfe\xfd\x80", r_read.stdout_bytes)
            self.assertIn("binary", r_read.stdout.lower())

            r_splice = adapter.splice_single(
                sb, "src/bad_utf8.txt", overwrite=True, code="valid utf8\n"
            )
            _assert_no_panic(r_splice, "splice invalid utf8")
            assert_exit_code(r_splice, 1, "splice invalid utf8")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F02-03",
        tier=2,
        feature="F02",
        title="0-byte empty files (empty.txt and empty.ts) are handled cleanly without panic",
        tags=("pipeline", "boundary", "empty"),
    )
    def test_zero_byte_empty_files(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("empty.txt", b"")
            sb.seed_file("empty.ts", b"")

            r_txt = adapter.read_file(sb, "empty.txt")
            _assert_no_panic(r_txt, "empty.txt")
            assert_exit_code(r_txt, 0, "empty.txt")

            r_ts = adapter.read_file(sb, "empty.ts")
            _assert_no_panic(r_ts, "empty.ts")
            assert_exit_code(r_ts, 0, "empty.ts")

    @e2e_case(
        case_id="T2-F02-04",
        tier=2,
        feature="F02",
        title="--full and --json do not bypass governance or AICE transformation contract",
        tags=("pipeline", "anti-bypass", "B-S1"),
    )
    def test_full_and_json_anti_bypass(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            raw_ts = sb.read_text("src/sample.ts")

            r_dis_full = adapter.read_file(sb, "src/sample.ts", full=True)
            assert_exit_code(r_dis_full, 1, "--full must obey enabled:false")
            r_dis_json = adapter.read_file(sb, "src/sample.ts", json_mode=True)
            assert_exit_code(r_dis_json, 1, "--json must obey enabled:false")

            sb.seed_config("enabled")
            r_full = adapter.read_file(sb, "src/sample.ts", full=True)
            assert_exit_code(r_full, 0, "enabled --full read")
            assert_is_aice_transformed(r_full.stdout, "ts", raw_ts, "enabled --full read")

            r_json = adapter.read_file(sb, "src/sample.ts", json_mode=True)
            assert_exit_code(r_json, 0, "enabled --json read")
            self.assertIsNotNone(r_json.stdout_json, "read --json must emit valid JSON")
            assert_telemetry_ledger_consistent(sb, expected_min_rows=2)

    @e2e_case(
        case_id="T2-F02-05",
        tier=2,
        feature="F02",
        title="Removed legacy subcommands (fmt --stdin, compile, verify, patch) are rejected",
        tags=("pipeline", "anti-bypass", "B-S2"),
    )
    def test_removed_legacy_subcommands_rejected(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()

            for argv in (
                ["fmt", "--stdin"],
                ["compile", "src/sample.ts"],
                ["verify", "src/sample.ts"],
                ["patch", "src/sample.ts"],
            ):
                res = adapter.run_raw(sb, argv, stdin="export const bypassed = 1;\n")
                _assert_no_panic(res, f"legacy {argv}")
                self.assertNotEqual(res.exit_code, 0, f"Legacy command {argv} must fail")
                assert_disk_unchanged(sb, before, context=f"legacy {argv}")

    @e2e_case(
        case_id="T2-F02-06",
        tier=2,
        feature="F02",
        title="Read and splice of non-existent file without --create fail cleanly",
        tags=("pipeline", "error"),
    )
    def test_nonexistent_file_without_create(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            before = sb.snapshot_tree()

            r_read = adapter.read_file(sb, "src/does_not_exist.ts")
            _assert_no_panic(r_read, "read missing")
            assert_exit_code(r_read, 1, "read missing")
            _assert_has_diagnostic(r_read, "read missing")

            r_splice = adapter.splice_single(
                sb, "src/does_not_exist.ts", code="export const x = 1;\n"
            )
            _assert_no_panic(r_splice, "splice missing without --create")
            assert_exit_code(r_splice, 1, "splice missing without --create")
            _assert_has_diagnostic(r_splice, "splice missing without --create")
            assert_disk_file_absent(sb, "src/does_not_exist.ts")
            assert_disk_unchanged(sb, before)


class TestTier2F03TelemetryBoundaries(unittest.TestCase):
    """F03: Honest BPE Telemetry & Ledger boundary/corner cases (6 cases)."""

    @e2e_case(
        case_id="T2-F03-01",
        tier=2,
        feature="F03",
        title="Tiny 1-line TS file emits AICE IR and preserves signed negative delta without clamping",
        tags=("telemetry", "negative-delta", "B-R5", "B-T4"),
    )
    def test_tiny_ts_preserves_negative_delta(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/tiny.ts", "src/tiny.ts")

            res = adapter.read_file(sb, "src/tiny.ts", stats=True)
            assert_exit_code(res, 0, "tiny.ts read")
            assert_stdout_contains(res, "x")
            assert_telemetry_ledger_consistent(
                sb,
                expected_min_rows=1,
                check_negative_deltas_allowed=True,
            )

            g_res = adapter.gain(sb)
            data = assert_gain_json_valid(g_res)
            self.assertGreater(
                data["aiceCl100k"],
                data["nativeCl100k"],
                f"Expected negative net delta on tiny.ts, got {data!r}",
            )
            if "savedCl100k" in data:
                self.assertLess(data["savedCl100k"], 0)

    @e2e_case(
        case_id="T2-F03-02",
        tier=2,
        feature="F03",
        title="Ephemeral /tmp workspace with AICE_HOME and AICE_TELEMETRY_PATH unset suppresses ledger",
        tags=("telemetry", "tmp-exclusion", "TEL-02"),
    )
    def test_tmp_workspace_suppresses_telemetry(self) -> None:
        adapter = AiceAdapter()
        with Sandbox(suppress_tmp_telemetry=True) as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            assert_exit_code(adapter.read_file(sb, "src/sample.ts"), 0)
            assert_exit_code(
                adapter.splice_single(
                    sb,
                    "src/sample.ts",
                    symbol="applyCredit",
                    code="export function applyCredit(a: AccountSnapshot, delta: number): AccountSnapshot {\n  return { id: a.id, balance: a.balance + delta + 1 };\n}",
                ),
                0,
            )
            if str(sb.ws).startswith(("/tmp", "/var/tmp", tempfile.gettempdir())):
                assert_tmp_telemetry_suppressed(sb.home)

    @e2e_case(
        case_id="T2-F03-03",
        tier=2,
        feature="F03",
        title="find and search telemetry baselines do not inflate with unread workspace corpus bytes",
        tags=("telemetry", "honesty", "B-T3"),
    )
    def test_find_search_baseline_not_inflated_by_corpus(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/huge_over_50kb.ts", "src/huge.ts")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            huge_size = sb.path("src/huge.ts").stat().st_size
            self.assertGreater(huge_size, 50 * 1024)

            assert_exit_code(adapter.find(sb), 0, "find baseline")
            assert_exit_code(adapter.search(sb, "applyCredit"), 0, "search baseline")

            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=2)
            for idx, row in enumerate(rows):
                self.assertLess(
                    row["nc"],
                    20000,
                    f"Row {idx} inflated baseline nc={row['nc']} near unread corpus size {huge_size}: {row!r}",
                )

    @e2e_case(
        case_id="T2-F03-04",
        tier=2,
        feature="F03",
        title="Short splice on 124L file meters edit diff baseline rather than whole-file tokens",
        tags=("telemetry", "splice-baseline", "B-T4"),
    )
    def test_short_splice_meters_edit_diff_not_whole_file(self) -> None:
        adapter = AiceAdapter()
        vectors = _load_bpe_vectors()
        big_vec = vectors["big_ts"]
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", str(big_vec["text"]))

            res = adapter.splice_single(
                sb,
                "src/big.ts",
                symbol="L2-L3",
                code="  processed: number;\n  checksum: number;\n  tag?: string;\n",
            )
            assert_exit_code(res, 0, "short splice on big.ts")

            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=1)
            splice_row = rows[-1]
            self.assertLess(
                splice_row["n1"],
                400,
                f"Expected short splice baseline < 400 cl100k tokens (whole file is 1222): {splice_row!r}",
            )
            self.assertLess(
                splice_row["nc"],
                500,
                f"Expected short splice baseline < 500 bytes (whole file is 3728): {splice_row!r}",
            )

    @e2e_case(
        case_id="T2-F03-05",
        tier=2,
        feature="F03",
        title="Unicode emoji and CJK file telemetry records exact UTF-8 byte counts",
        tags=("telemetry", "utf8", "boundary"),
    )
    def test_unicode_utf8_byte_telemetry(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            text = "Hello 🚀 世界 café αβγ\n"
            raw_bytes = text.encode("utf-8")
            self.assertGreater(len(raw_bytes), len(text))
            sb.seed_file("src/unicode.txt", raw_bytes)

            res = adapter.read_file(sb, "src/unicode.txt")
            assert_exit_code(res, 0, "unicode.txt read")
            rows = assert_telemetry_ledger_consistent(sb, expected_min_rows=1)
            row = rows[-1]
            self.assertEqual(row["nc"], len(raw_bytes))
            self.assertEqual(row["ac"], len(res.stdout_bytes))

    @e2e_case(
        case_id="T2-F03-06",
        tier=2,
        feature="F03",
        title="gain --json on fresh empty telemetry ledger exits cleanly with 0 operations",
        tags=("telemetry", "empty"),
    )
    def test_gain_on_empty_ledger(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            res = adapter.gain(sb)
            data = assert_gain_json_valid(res)
            self.assertEqual(data["totalOperations"], 0)
            self.assertEqual(data["nativeCl100k"], 0)
            self.assertEqual(data["aiceCl100k"], 0)
            if "endToEndVerdict" in data:
                self.assertEqual(data["endToEndVerdict"], "NEUTRAL")


class TestTier2F04R5SystemsOopFirewalls(unittest.TestCase):
    """F04: R5 Systems & OOP Languages pre-write firewall rejection tests (10 cases)."""

    @e2e_case(
        case_id="T2-F04-01",
        tier=2,
        feature="F04",
        title="Rust firewall rejects balanced-brace invalid syntax even with --force",
        tags=("r5", "rust", "firewall", "B-W1", "B-W3"),
    )
    def test_rust_firewall_rejects_invalid_and_ignores_force(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.rs", "r5/invalid/sample.rs", "src/sample.rs", force=False)
        _run_firewall_rejection_check("r5/valid/sample.rs", "r5/invalid/sample.rs", "src/sample.rs", force=True)

    @e2e_case(
        case_id="T2-F04-02",
        tier=2,
        feature="F04",
        title="C firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "c", "firewall"),
    )
    def test_c_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.c", "r5/invalid/sample.c", "src/sample.c")

    @e2e_case(
        case_id="T2-F04-03",
        tier=2,
        feature="F04",
        title="C++ firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "cpp", "firewall"),
    )
    def test_cpp_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.cpp", "r5/invalid/sample.cpp", "src/sample.cpp")

    @e2e_case(
        case_id="T2-F04-04",
        tier=2,
        feature="F04",
        title="C# firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "csharp", "firewall"),
    )
    def test_csharp_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.cs", "r5/invalid/sample.cs", "src/sample.cs")

    @e2e_case(
        case_id="T2-F04-05",
        tier=2,
        feature="F04",
        title="Go firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "go", "firewall", "B-W3"),
    )
    def test_go_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.go", "r5/invalid/sample.go", "src/sample.go")

    @e2e_case(
        case_id="T2-F04-06",
        tier=2,
        feature="F04",
        title="Java firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "java", "firewall"),
    )
    def test_java_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.java", "r5/invalid/sample.java", "src/sample.java")

    @e2e_case(
        case_id="T2-F04-07",
        tier=2,
        feature="F04",
        title="Kotlin firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "kotlin", "firewall"),
    )
    def test_kotlin_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.kt", "r5/invalid/sample.kt", "src/sample.kt")

    @e2e_case(
        case_id="T2-F04-08",
        tier=2,
        feature="F04",
        title="Dart firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "dart", "firewall"),
    )
    def test_dart_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.dart", "r5/invalid/sample.dart", "src/sample.dart")

    @e2e_case(
        case_id="T2-F04-09",
        tier=2,
        feature="F04",
        title="PHP firewall rejects balanced-brace invalid syntax without touching disk",
        tags=("r5", "php", "firewall"),
    )
    def test_php_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.php", "r5/invalid/sample.php", "src/sample.php")

    @e2e_case(
        case_id="T2-F04-10",
        tier=2,
        feature="F04",
        title="Ruby firewall rejects invalid syntax without touching disk",
        tags=("r5", "ruby", "firewall"),
    )
    def test_ruby_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.rb",
            "r5/invalid/sample.rb",
            "src/sample.rb",
            extra_bad_code="def r\n  if then\nend\n",
        )


class TestTier2F05R5WebScriptDataFirewalls(unittest.TestCase):
    """F05: R5 Web, Script, Data & Twig pre-write firewall rejection tests (13 cases)."""

    @e2e_case(
        case_id="T2-F05-01",
        tier=2,
        feature="F05",
        title="TypeScript firewall rejects invalid syntax and blocks error-delta increase on pre-broken file",
        tags=("r5", "typescript", "firewall", "B-W2"),
    )
    def test_typescript_firewall_and_prebroken_delta(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.ts", "r5/invalid/sample.ts", "src/sample.ts")

        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/prebroken.ts",
                (
                    "export function ok(): number {\n  return 1;\n}\n"
                    "export function alreadyBroken(): number {\n  const a = ;\n  return a;\n}\n"
                ),
            )
            before = sb.snapshot_tree()
            res = adapter.splice_single(
                sb,
                "src/prebroken.ts",
                symbol="ok",
                code="export function ok(): number {\n  const b = ;\n  return b;\n}",
            )
            _assert_no_panic(res, "pre-broken TS error delta")
            assert_exit_code(res, 1, "pre-broken TS error delta")
            assert_disk_unchanged(sb, before, context="pre-broken TS error delta")

    @e2e_case(
        case_id="T2-F05-02",
        tier=2,
        feature="F05",
        title="JavaScript firewall rejects invalid syntax without touching disk",
        tags=("r5", "javascript", "firewall"),
    )
    def test_javascript_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.js",
            "r5/invalid/sample.js",
            "src/sample.js",
            extra_bad_code="export function broken() { const s = `unclosed; }\n",
        )

    @e2e_case(
        case_id="T2-F05-03",
        tier=2,
        feature="F05",
        title="TSX firewall rejects invalid syntax and mismatched JSX closing tags",
        tags=("r5", "tsx", "firewall"),
    )
    def test_tsx_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.tsx",
            "r5/invalid/sample.tsx",
            "src/sample.tsx",
            extra_bad_code="export function Card() {\n  return <section></div>;\n}\n",
        )

    @e2e_case(
        case_id="T2-F05-04",
        tier=2,
        feature="F05",
        title="Python firewall rejects invalid syntax in-process under PATH=''",
        tags=("r5", "python", "firewall", "B-W4"),
    )
    def test_python_firewall_under_empty_path(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.py",
            "r5/invalid/sample.py",
            "src/sample.py",
            env_overrides={"PATH": ""},
        )

    @e2e_case(
        case_id="T2-F05-05",
        tier=2,
        feature="F05",
        title="Bash firewall rejects invalid syntax in-process under PATH=''",
        tags=("r5", "bash", "firewall", "B-W4"),
    )
    def test_bash_firewall_under_empty_path(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.sh",
            "r5/invalid/sample.sh",
            "src/sample.sh",
            env_overrides={"PATH": ""},
        )

    @e2e_case(
        case_id="T2-F05-06",
        tier=2,
        feature="F05",
        title="JSON firewall rejects trailing comma and malformed JSON without touching disk",
        tags=("r5", "json", "firewall"),
    )
    def test_json_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.json", "r5/invalid/sample.json", "src/sample.json")

    @e2e_case(
        case_id="T2-F05-07",
        tier=2,
        feature="F05",
        title="YAML firewall rejects unclosed flow sequence without touching disk",
        tags=("r5", "yaml", "firewall"),
    )
    def test_yaml_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.yaml", "r5/invalid/sample.yaml", "src/sample.yaml")

    @e2e_case(
        case_id="T2-F05-08",
        tier=2,
        feature="F05",
        title="TOML firewall rejects missing value without touching disk",
        tags=("r5", "toml", "firewall", "B-W4"),
    )
    def test_toml_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.toml", "r5/invalid/sample.toml", "src/sample.toml")

    @e2e_case(
        case_id="T2-F05-09",
        tier=2,
        feature="F05",
        title="Markdown firewall handles unclosed frontmatter/fence and accepts valid frontmatter boundary",
        tags=("r5", "markdown", "firewall"),
    )
    def test_markdown_firewall_and_valid_frontmatter(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.md", "r5/invalid/sample.md", "docs/sample.md")

        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.md", "docs/sample.md")
            valid_fm = "---\ntitle: Valid Service\nversion: 1\n---\n\n# Valid Heading\n\nBody text.\n"
            res = adapter.splice_single(sb, "docs/sample.md", overwrite=True, code=valid_fm)
            _assert_no_panic(res, "valid frontmatter markdown")
            assert_exit_code(res, 0, "valid frontmatter markdown")
            self.assertEqual(sb.read_text("docs/sample.md"), valid_fm)

    @e2e_case(
        case_id="T2-F05-10",
        tier=2,
        feature="F05",
        title="HTML firewall rejects unclosed/malformed elements without touching disk",
        tags=("r5", "html", "firewall", "B-W4"),
    )
    def test_html_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.html", "r5/invalid/sample.html", "src/sample.html")

    @e2e_case(
        case_id="T2-F05-11",
        tier=2,
        feature="F05",
        title="CSS firewall rejects invalid properties and unterminated comments without touching disk",
        tags=("r5", "css", "firewall"),
    )
    def test_css_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.css",
            "r5/invalid/sample.css",
            "src/sample.css",
            extra_bad_code=".card { color: red; /* unterminated comment\n",
        )

    @e2e_case(
        case_id="T2-F05-12",
        tier=2,
        feature="F05",
        title="XML and SVG firewalls reject mismatched tags without touching disk",
        tags=("r5", "xml", "svg", "firewall"),
    )
    def test_xml_and_svg_firewalls_reject_invalid(self) -> None:
        _run_firewall_rejection_check("r5/valid/sample.xml", "r5/invalid/sample.xml", "src/sample.xml")
        _run_firewall_rejection_check(
            "r5/valid/sample.svg",
            "r5/invalid/sample.svg",
            "src/sample.svg",
            extra_bad_code='<svg xmlns="http://www.w3.org/2000/svg"><rect></svg>\n',
        )

    @e2e_case(
        case_id="T2-F05-13",
        tier=2,
        feature="F05",
        title="Twig firewall rejects unclosed {% if %} and broken {{ expression }} without touching disk",
        tags=("r5", "twig", "firewall"),
    )
    def test_twig_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r5/valid/sample.twig",
            "r5/invalid/sample.twig",
            "templates/sample.twig",
            extra_bad_code="<div>{{ unclosed_expr </div>\n",
        )


class TestTier2F06R6DatabaseFirewalls(unittest.TestCase):
    """F06: R6 Database & Query Dialects pre-write firewall rejection tests (9 cases)."""

    @e2e_case(
        case_id="T2-F06-01",
        tier=2,
        feature="F06",
        title="ANSI SQL firewall rejects malformed DDL/SELECT without touching disk",
        tags=("r6", "ansi-sql", "firewall", "B-W4"),
    )
    def test_ansi_sql_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/ansi.sql", "r6/invalid/ansi.sql", "db/ansi.sql")

    @e2e_case(
        case_id="T2-F06-02",
        tier=2,
        feature="F06",
        title="PostgreSQL/PLpgSQL firewall rejects broken statements and unterminated $$ blocks",
        tags=("r6", "postgres", "plpgsql", "firewall"),
    )
    def test_postgres_plpgsql_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r6/valid/postgres_plpgsql.sql",
            "r6/invalid/postgres_plpgsql.sql",
            "db/postgres_plpgsql.sql",
            extra_bad_code="CREATE FUNCTION f() RETURNS VOID LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\nEND;\n",
        )

    @e2e_case(
        case_id="T2-F06-03",
        tier=2,
        feature="F06",
        title="MySQL firewall rejects broken DELIMITER procedure without touching disk",
        tags=("r6", "mysql", "firewall"),
    )
    def test_mysql_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/mysql_proc.sql", "r6/invalid/mysql_proc.sql", "db/mysql_proc.sql")

    @e2e_case(
        case_id="T2-F06-04",
        tier=2,
        feature="F06",
        title="SQLite firewall rejects invalid PRAGMA and malformed CREATE TABLE",
        tags=("r6", "sqlite", "firewall"),
    )
    def test_sqlite_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/sqlite_pragma.sql", "r6/invalid/sqlite_pragma.sql", "db/sqlite_pragma.sql")

    @e2e_case(
        case_id="T2-F06-05",
        tier=2,
        feature="F06",
        title="T-SQL firewall rejects broken TRY..CATCH / UPDATE without touching disk",
        tags=("r6", "tsql", "firewall"),
    )
    def test_tsql_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/tsql_proc.sql", "r6/invalid/tsql_proc.sql", "db/tsql_proc.sql")

    @e2e_case(
        case_id="T2-F06-06",
        tier=2,
        feature="F06",
        title="Prisma firewall rejects missing field type and malformed model block",
        tags=("r6", "prisma", "firewall"),
    )
    def test_prisma_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/schema.prisma", "r6/invalid/schema.prisma", "prisma/schema.prisma")

    @e2e_case(
        case_id="T2-F06-07",
        tier=2,
        feature="F06",
        title="GraphQL firewall rejects malformed type/query definitions without touching disk",
        tags=("r6", "graphql", "firewall"),
    )
    def test_graphql_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/api.graphql", "r6/invalid/api.graphql", "graphql/api.graphql")

    @e2e_case(
        case_id="T2-F06-08",
        tier=2,
        feature="F06",
        title="Cypher firewall rejects malformed MATCH/WHERE/RETURN without touching disk",
        tags=("r6", "cypher", "firewall"),
    )
    def test_cypher_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check("r6/valid/graph.cypher", "r6/invalid/graph.cypher", "cypher/graph.cypher")

    @e2e_case(
        case_id="T2-F06-09",
        tier=2,
        feature="F06",
        title="DB Migration firewall rejects broken DDL inside -- +goose Up/Down sections",
        tags=("r6", "migration", "firewall"),
    )
    def test_db_migration_firewall_rejects_invalid(self) -> None:
        _run_firewall_rejection_check(
            "r6/valid/migrations/V001__init_ledger.sql",
            "r6/invalid/migrations/V001__init_ledger.sql",
            "db/migrations/V001__init_ledger.sql",
        )


class TestTier2F07AstSlicingBoundaries(unittest.TestCase):
    """F07: Symbol Slicing, Auto-Outline (>120L) & Intra-Function AST boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F07-01",
        tier=2,
        feature="F07",
        title="120L vs 121L threshold: 120L emits full AICE IR while 121L auto-outlines",
        tags=("ast", "outline", "boundary", "READ-03"),
    )
    def test_120l_vs_121l_auto_outline_boundary(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            src_120 = _build_numbered_ts_file(120, "marker_120_body", "leaf120")
            src_121 = _build_numbered_ts_file(121, "marker_121_body", "leaf121")
            sb.seed_file("src/exact_120.ts", src_120)
            sb.seed_file("src/over_121.ts", src_121)

            r_120 = adapter.read_file(sb, "src/exact_120.ts")
            assert_exit_code(r_120, 0, "120L read")
            assert_is_aice_transformed(r_120.stdout, "ts", src_120, "120L read")
            assert_stdout_contains(r_120, "marker_120_body", "120L must include body")

            r_121 = adapter.read_file(sb, "src/over_121.ts")
            assert_exit_code(r_121, 0, "121L read")
            assert_stdout_contains(r_121, "leaf121", "121L outline must list symbol")
            assert_stdout_not_contains(
                r_121, "marker_121_body", "121L auto-outline must omit body details"
            )

            r_121_full = adapter.read_file(sb, "src/over_121.ts", full=True)
            assert_exit_code(r_121_full, 0, "121L --full")
            assert_stdout_contains(r_121_full, "marker_121_body", "121L --full shows body")

    @e2e_case(
        case_id="T2-F07-02",
        tier=2,
        feature="F07",
        title="Missing symbol in valid file returns explicit diagnostic without fallback",
        tags=("ast", "symbol", "error"),
    )
    def test_missing_symbol_explicit_diagnostic(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            res = adapter.read_file(sb, "src/math.ts", selector="NonExistentSymbolXYZ")
            _assert_no_panic(res, "missing symbol")
            assert_no_ast_fallback_marker(res, "missing symbol")
            assert_exit_code(res, 1, "missing symbol")
            diag = _assert_has_diagnostic(res, "missing symbol")
            self.assertIn("NonExistentSymbolXYZ", diag)

    @e2e_case(
        case_id="T2-F07-03",
        tier=2,
        feature="F07",
        title="Broken syntax file with missing symbol emits structured AST error without [AICE AST Fallback]",
        tags=("ast", "anti-bypass", "B-R6"),
    )
    def test_broken_file_missing_symbol_no_ast_fallback(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/bad.rs",
                "pub fn other_fn() -> i64 {\n    let broken = ;\n    broken\n}\n",
            )

            res = adapter.read_file(sb, "src/bad.rs", selector="target_fn")
            _assert_no_panic(res, "broken file missing symbol")
            assert_no_ast_fallback_marker(res, "broken file missing symbol")
            assert_exit_code(res, 1, "broken file missing symbol")
            _assert_has_diagnostic(res, "broken file missing symbol")

    @e2e_case(
        case_id="T2-F07-04",
        tier=2,
        feature="F07",
        title="Inverted and out-of-bounds line ranges fail/clamp safely without panic",
        tags=("ast", "line-range", "boundary"),
    )
    def test_inverted_and_oob_line_ranges(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            before = sb.snapshot_tree()

            r_inv = adapter.read_file(sb, "src/math.ts", selector="L50-L10")
            _assert_no_panic(r_inv, "inverted read :L50-L10")
            _assert_has_diagnostic(r_inv, "inverted read :L50-L10")

            r_oob = adapter.read_file(sb, "src/math.ts", selector="L9999-L10010")
            _assert_no_panic(r_oob, "oob read :L9999-L10010")

            r_splice_inv = adapter.splice_single(
                sb, "src/math.ts", symbol="L50-L10", code="// invalid\n"
            )
            _assert_no_panic(r_splice_inv, "inverted splice :L50-L10")
            assert_exit_code(r_splice_inv, 1, "inverted splice :L50-L10")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F07-05",
        tier=2,
        feature="F07",
        title="Missing intra-function @nonexistent block inside valid function returns clean diagnostic",
        tags=("ast", "intra-ast", "error"),
    )
    def test_missing_intra_function_block(self) -> None:
        adapter = AiceAdapter()
        vectors = _load_bpe_vectors()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", str(vectors["big_ts"]["text"]))

            res = adapter.read_file(
                sb, "src/big.ts", selector="runBatchPipeline@nonexistent_block_xyz"
            )
            _assert_no_panic(res, "missing @block")
            assert_no_ast_fallback_marker(res, "missing @block")
            assert_exit_code(res, 1, "missing @block")
            _assert_has_diagnostic(res, "missing @block")

    @e2e_case(
        case_id="T2-F07-06",
        tier=2,
        feature="F07",
        title="Deeply nested closure and branch inside function sliced cleanly in AICE IR",
        tags=("ast", "intra-ast", "closure"),
    )
    def test_nested_closure_branch_slice(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/nested.ts",
                (
                    "export function processTree(items: number[], mode: string): number[] {\n"
                    '  if (mode === "deep_target_branch") {\n'
                    "    return items.map((item) => {\n"
                    "      if (item > 0) {\n"
                    "        return item * 777;\n"
                    "      }\n"
                    "      return 0;\n"
                    "    });\n"
                    "  }\n"
                    '  if (mode === "shallow_sibling_branch") {\n'
                    "    return [999];\n"
                    "  }\n"
                    "  return [];\n"
                    "}\n"
                ),
            )

            res = adapter.read_file(
                sb, "src/nested.ts", selector="processTree@deep_target_branch"
            )
            _assert_no_panic(res, "nested closure slice")
            assert_exit_code(res, 0, "nested closure slice")
            assert_stdout_contains(res, "777", "nested closure slice")
            assert_stdout_not_contains(res, "999", "sibling branch excluded")


class TestTier2F08DependencyGraphBoundaries(unittest.TestCase):
    """F08: Cross-File Dependency & Caller Topological Ordering boundary tests (5 cases)."""

    @e2e_case(
        case_id="T2-F08-01",
        tier=2,
        feature="F08",
        title="Cyclic imports (cycle_a -> cycle_b -> cycle_a) resolve without infinite recursion",
        tags=("graph", "cycles", "deps"),
    )
    def test_cyclic_imports_no_infinite_loop(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/cycle_a.ts", "src/cycle_a.ts")
            sb.seed_fixture("graph/cycle_b.ts", "src/cycle_b.ts")

            res = adapter.read_file(sb, "src/cycle_a.ts", deps=True, callers=True)
            assert_exit_code(res, 0, "cyclic imports")
            assert_stdout_contains(res, "pingA")
            assert_stdout_contains(res, "pingB")
            self.assertEqual(
                res.stdout.count("src/cycle_a.ts"),
                1,
                f"Expected cycle_a.ts emitted once, got stdout={res.stdout!r}",
            )

    @e2e_case(
        case_id="T2-F08-02",
        tier=2,
        feature="F08",
        title="Unresolved external package import is ignored gracefully without crash",
        tags=("graph", "external-import"),
    )
    def test_unresolved_external_import_graceful(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/ext.ts",
                (
                    'import { externalHelper } from "nonexistent-external-pkg-xyz";\n'
                    'import { missingLocal } from "./missing_local.js";\n'
                    "export function localEntry(x: number): number {\n"
                    "  return x + 1;\n"
                    "}\n"
                ),
            )

            res = adapter.read_file(sb, "src/ext.ts", deps=True)
            _assert_no_panic(res, "unresolved external import")
            assert_exit_code(res, 0, "unresolved external import")
            assert_stdout_contains(res, "localEntry")

    @e2e_case(
        case_id="T2-F08-03",
        tier=2,
        feature="F08",
        title="Diamond dependency graph (D -> B,C -> A) deduplicates A before B,C before D",
        tags=("graph", "diamond", "topological"),
    )
    def test_diamond_dependency_dedup_and_order(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/a_base.ts", "export interface DiamondRoot { id: string; }\n")
            sb.seed_file(
                "src/b_left.ts",
                (
                    'import type { DiamondRoot } from "./a_base.js";\n'
                    'export function leftTag(t: DiamondRoot): string { return t.id + "-L"; }\n'
                ),
            )
            sb.seed_file(
                "src/c_right.ts",
                (
                    'import type { DiamondRoot } from "./a_base.js";\n'
                    'export function rightTag(t: DiamondRoot): string { return t.id + "-R"; }\n'
                ),
            )
            sb.seed_file(
                "src/d_top.ts",
                (
                    'import { leftTag } from "./b_left.js";\n'
                    'import { rightTag } from "./c_right.js";\n'
                    'import type { DiamondRoot } from "./a_base.js";\n'
                    "export function combineTags(t: DiamondRoot): string { return leftTag(t) + rightTag(t); }\n"
                ),
            )

            res = adapter.batch_read(
                sb,
                ["src/d_top.ts", "src/c_right.ts", "src/b_left.ts", "src/a_base.ts"],
                deps=True,
            )
            assert_exit_code(res, 0, "diamond graph")
            self.assertEqual(res.stdout.count("src/a_base.ts"), 1)
            pos_a = res.stdout.index("DiamondRoot")
            pos_b = res.stdout.index("leftTag")
            pos_c = res.stdout.index("rightTag")
            pos_d = res.stdout.index("combineTags")
            self.assertLess(pos_a, pos_b)
            self.assertLess(pos_a, pos_c)
            self.assertLess(pos_b, pos_d)
            self.assertLess(pos_c, pos_d)

    @e2e_case(
        case_id="T2-F08-04",
        tier=2,
        feature="F08",
        title="Depth -d 0 vs -d 1 strictly limits dependency expansion",
        tags=("graph", "depth", "boundary"),
    )
    def test_depth_d0_vs_d1_limits_deps(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/types.ts", "src/types.ts")
            sb.seed_fixture("graph/service.ts", "src/service.ts")
            sb.seed_fixture("graph/handler.ts", "src/handler.ts")
            sb.seed_file(
                "src/entry.ts",
                (
                    'import { handleTransfer } from "./handler.js";\n'
                    "export function invokeEntry(): number {\n"
                    '  return handleTransfer({ id: { raw: "a" }, balance: 10, currency: "USD" }, 5);\n'
                    "}\n"
                ),
            )

            r_d0 = adapter.read_file(
                sb, "src/entry.ts", deps=True, extra_flags=["-d", "0"]
            )
            assert_exit_code(r_d0, 0, "-d 0")
            assert_stdout_contains(r_d0, "invokeEntry")
            assert_stdout_not_contains(r_d0, "src/handler.ts", "-d 0 excludes hop-1")
            assert_stdout_not_contains(r_d0, "src/service.ts", "-d 0 excludes hop-2")
            assert_stdout_not_contains(r_d0, "src/types.ts", "-d 0 excludes hop-2")
            assert_stdout_not_contains(r_d0, "LedgerService", "-d 0 excludes hop-1/hop-2")

            r_d1 = adapter.read_file(
                sb, "src/entry.ts", deps=True, extra_flags=["-d", "1"]
            )
            assert_exit_code(r_d1, 0, "-d 1")
            assert_stdout_contains(r_d1, "src/handler.ts", "-d 1 includes hop-1")
            assert_stdout_contains(r_d1, "handleTransfer", "-d 1 includes hop-1")
            assert_stdout_not_contains(r_d1, "src/service.ts", "-d 1 excludes hop-2")
            assert_stdout_not_contains(r_d1, "src/types.ts", "-d 1 excludes hop-2")
            assert_stdout_not_contains(
                r_d1, "class LedgerService", "-d 1 excludes hop-2 definition"
            )
            assert_stdout_not_contains(
                r_d1, "ServiceResult", "-d 1 excludes hop-2 type"
            )

    @e2e_case(
        case_id="T2-F08-05",
        tier=2,
        feature="F08",
        title="Isolated file with zero imports or callers resolves cleanly",
        tags=("graph", "isolated"),
    )
    def test_isolated_file_zero_deps_callers(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/isolated.ts")

            res = adapter.read_file(sb, "src/isolated.ts", deps=True, callers=True)
            assert_exit_code(res, 0, "isolated file")
            assert_stdout_contains(res, "applyCredit")


class TestTier2F09FindSearchFuzzyBoundaries(unittest.TestCase):
    """F09: Parallel find, 4-Tier Ranked search & Smart Fuzzy Guessing boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F09-01",
        tier=2,
        feature="F09",
        title="search escapes literal regex metacharacters [a+b]*(c?) without crashing",
        tags=("search", "regex-escape", "SRCH-05"),
    )
    def test_search_literal_metacharacters(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/notes.txt", "src/notes.txt")

            res = adapter.search(sb, "[a+b]*(c?)")
            _assert_no_panic(res, "metachar search")
            assert_exit_code(res, 0, "metachar search")
            assert_stdout_contains(res, "notes.txt")
            assert_stdout_contains(res, "[a+b]*(c?)")

    @e2e_case(
        case_id="T2-F09-02",
        tier=2,
        feature="F09",
        title="search with zero matches in workspace exits 0 cleanly",
        tags=("search", "empty"),
    )
    def test_search_zero_matches(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")

            res = adapter.search(sb, "ZZZZ_NO_MATCH_99999")
            _assert_no_panic(res, "zero-match search")
            assert_exit_code(res, 0, "zero-match search")
            assert_stdout_not_contains(res, "applyCredit")

    @e2e_case(
        case_id="T2-F09-03",
        tier=2,
        feature="F09",
        title="find -d 0 and negative depth -d -1 boundaries are handled safely without panic",
        tags=("find", "depth", "boundary"),
    )
    def test_find_depth_zero_and_negative(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("top.ts", "export const top = 1;\n")
            sb.seed_file("nested/sub/deep.ts", "export const deep = 2;\n")

            r_d0 = adapter.find(sb, max_depth=0)
            _assert_no_panic(r_d0, "find -d 0")
            if r_d0.exit_code == 0:
                assert_stdout_not_contains(r_d0, "deep.ts", "find -d 0 excludes nested")

            r_neg = adapter.find(sb, max_depth=-1)
            _assert_no_panic(r_neg, "find -d -1")
            if r_neg.exit_code != 0:
                _assert_has_diagnostic(r_neg, "find -d -1")

    @e2e_case(
        case_id="T2-F09-04",
        tier=2,
        feature="F09",
        title="Fuzzy guesser rejects unrelated gibberish without false auto-resolve",
        tags=("fuzzy", "error", "R8"),
    )
    def test_fuzzy_guesser_rejects_gibberish(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")

            r_path = adapter.read_file(sb, "src/zxqvbnm12345.ts")
            _assert_no_panic(r_path, "fuzzy gibberish path")
            assert_exit_code(r_path, 1, "fuzzy gibberish path")
            assert_stdout_not_contains(r_path, "Calculator")

            r_sym = adapter.read_file(sb, "src/math.ts", selector="zxqvbnm12345")
            _assert_no_panic(r_sym, "fuzzy gibberish symbol")
            assert_exit_code(r_sym, 1, "fuzzy gibberish symbol")

    @e2e_case(
        case_id="T2-F09-05",
        tier=2,
        feature="F09",
        title=".gitignore custom patterns are honored by both find and search",
        tags=("find", "search", "gitignore"),
    )
    def test_gitignore_honored_by_find_and_search(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(".gitignore", "*.secret.ts\nignored_dir/\n")
            sb.seed_file("src/visible.ts", "export const FINDABLE_TOKEN = 1;\n")
            sb.seed_file("src/hidden.secret.ts", "export const FINDABLE_TOKEN = 2;\n")
            sb.seed_file("ignored_dir/cache.ts", "export const FINDABLE_TOKEN = 3;\n")

            r_find = adapter.find(sb)
            assert_exit_code(r_find, 0, "find gitignore")
            assert_stdout_contains(r_find, "visible.ts")
            assert_stdout_not_contains(r_find, "hidden.secret.ts")
            assert_stdout_not_contains(r_find, "cache.ts")

            r_search = adapter.search(sb, "FINDABLE_TOKEN")
            assert_exit_code(r_search, 0, "search gitignore")
            assert_stdout_contains(r_search, "visible.ts")
            assert_stdout_not_contains(r_search, "hidden.secret.ts")
            assert_stdout_not_contains(r_search, "cache.ts")

    @e2e_case(
        case_id="T2-F09-06",
        tier=2,
        feature="F09",
        title="search -C 0 and large -C 500 clamp cleanly to file boundaries",
        tags=("search", "context", "boundary"),
    )
    def test_search_context_clamping(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            r_c0 = adapter.search(sb, "add", context_lines=0)
            _assert_no_panic(r_c0, "search -C 0")
            assert_exit_code(r_c0, 0, "search -C 0")
            assert_stdout_contains(r_c0, "add")

            r_c500 = adapter.search(sb, "add", context_lines=500)
            _assert_no_panic(r_c500, "search -C 500")
            assert_exit_code(r_c500, 0, "search -C 500")
            assert_stdout_contains(r_c500, "add")


class TestTier2F10BatchReadBoundaries(unittest.TestCase):
    """F10: Multi-Target Batch Read Packs & Budget boundary tests (5 cases)."""

    @e2e_case(
        case_id="T2-F10-01",
        tier=2,
        feature="F10",
        title="Tight --max-tokens 30 budget truncates or outlines deterministically",
        tags=("batch-read", "budget", "boundary"),
    )
    def test_tight_max_tokens_30_deterministic(self) -> None:
        adapter = AiceAdapter()
        vectors = _load_bpe_vectors()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file("src/big.ts", str(vectors["big_ts"]["text"]))
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            r1 = adapter.batch_read(sb, ["src/big.ts", "src/math.ts"], max_tokens=30)
            r2 = adapter.batch_read(sb, ["src/big.ts", "src/math.ts"], max_tokens=30)
            _assert_no_panic(r1, "max-tokens 30 run 1")
            assert_exit_code(r1, 0, "max-tokens 30 run 1")
            assert_exit_code(r2, 0, "max-tokens 30 run 2")
            self.assertEqual(r1.stdout, r2.stdout, "Budget output must be deterministic")
            self.assertLess(len(r1.stdout), 800)

    @e2e_case(
        case_id="T2-F10-02",
        tier=2,
        feature="F10",
        title="Mixed batch read with 1 valid file and 1 missing file reports missing target cleanly",
        tags=("batch-read", "error"),
    )
    def test_mixed_batch_valid_and_missing_target(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            res = adapter.batch_read(sb, ["src/math.ts", "src/missing_target.ts"])
            _assert_no_panic(res, "mixed valid+missing batch")
            combined = _assert_has_diagnostic(res, "mixed valid+missing batch")
            self.assertIn("missing_target.ts", combined)

    @e2e_case(
        case_id="T2-F10-03",
        tier=2,
        feature="F10",
        title="Tiny negative-savings batch retains deterministic metadata framing and honest delta",
        tags=("batch-read", "framing", "B-R8"),
    )
    def test_tiny_negative_savings_batch_framing(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("plaintext/tiny.ts", "src/tiny_a.ts")
            sb.seed_file("src/tiny_b.ts", "export const y = 2;\n")

            res = adapter.batch_read(sb, ["src/tiny_a.ts", "src/tiny_b.ts"])
            assert_exit_code(res, 0, "tiny batch")
            assert_stdout_contains(res, "tiny_a.ts")
            assert_stdout_contains(res, "tiny_b.ts")
            assert_telemetry_ledger_consistent(
                sb, expected_min_rows=1, check_negative_deltas_allowed=True
            )

    @e2e_case(
        case_id="T2-F10-04",
        tier=2,
        feature="F10",
        title="Duplicate identical targets in one batch read are deduplicated",
        tags=("batch-read", "dedup"),
    )
    def test_duplicate_identical_targets_deduped(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            res = adapter.batch_read(
                sb, ["src/math.ts", "src/math.ts", "src/math.ts"]
            )
            assert_exit_code(res, 0, "duplicate targets")
            self.assertEqual(
                res.stdout.count("mul"),
                1,
                f"Expected duplicated target deduplicated to 1 occurrence: {res.stdout!r}",
            )

    @e2e_case(
        case_id="T2-F10-05",
        tier=2,
        feature="F10",
        title="Empty glob match (src/*.nonexistent) is handled cleanly without panic",
        tags=("batch-read", "glob", "empty"),
    )
    def test_empty_glob_match_handled_cleanly(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")

            res = adapter.batch_read(sb, ["src/*.nonexistent"])
            _assert_no_panic(res, "empty glob")
            assert_stdout_not_contains(res, "Calculator")


class TestTier2F11SingleSpliceBoundaries(unittest.TestCase):
    """F11: Surgical Single-Target Splice, Hunks & Guards boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F11-01",
        tier=2,
        feature="F11",
        title="Half-open :L12-L15 truncation omitting closing brace is rejected with disk untouched",
        tags=("splice", "line-range", "FW-04"),
    )
    def test_half_open_line_range_guard(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("graph/app.ts", "src/app.ts")
            before = sb.snapshot_tree()

            truncated = (
                "  public inc(step: number): CalcResult {\n"
                "    this.count += step * 2;\n"
                "    return this.calc.add(this.count, step);\n"
            )
            res = adapter.splice_single(
                sb, "src/app.ts", symbol="L12-L15", code=truncated
            )
            _assert_no_panic(res, "half-open :L12-L15")
            assert_exit_code(res, 1, "half-open :L12-L15")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F11-02",
        tier=2,
        feature="F11",
        title="Ambiguous <<< === >>> hunk matching 2 identical blocks is rejected before disk write",
        tags=("splice", "hunk", "ambiguity"),
    )
    def test_ambiguous_hunk_rejected(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_file(
                "src/dup.ts",
                (
                    "export function alpha(flag: boolean): number {\n"
                    "  if (flag) {\n"
                    "    return 1;\n"
                    "  }\n"
                    "  return 0;\n"
                    "}\n\n"
                    "export function beta(flag: boolean): number {\n"
                    "  if (flag) {\n"
                    "    return 1;\n"
                    "  }\n"
                    "  return 0;\n"
                    "}\n"
                ),
            )
            before = sb.snapshot_tree()
            hunk = (
                "<<<\n"
                "  if (flag) {\n"
                "    return 1;\n"
                "  }\n"
                "===\n"
                "  if (flag) {\n"
                "    return 2;\n"
                "  }\n"
                ">>>\n"
            )
            res = adapter.splice_single(sb, "src/dup.ts", code=hunk)
            _assert_no_panic(res, "ambiguous hunk")
            assert_exit_code(res, 1, "ambiguous hunk")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F11-03",
        tier=2,
        feature="F11",
        title="Non-matching <<< === >>> hunk fails cleanly leaving disk byte-identical",
        tags=("splice", "hunk", "error"),
    )
    def test_non_matching_hunk_rejected(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            before = sb.snapshot_tree()

            hunk = (
                "<<<\n"
                "  public nonexistentMethod(): void {\n"
                "    return;\n"
                "  }\n"
                "===\n"
                "  public replacedMethod(): void {}\n"
                ">>>\n"
            )
            res = adapter.splice_single(sb, "src/math.ts", code=hunk)
            _assert_no_panic(res, "non-matching hunk")
            assert_exit_code(res, 1, "non-matching hunk")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F11-04",
        tier=2,
        feature="F11",
        title="--create on existing file without --overwrite is rejected with disk untouched",
        tags=("splice", "create", "error"),
    )
    def test_create_on_existing_without_overwrite_rejected(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            before = sb.snapshot_tree()

            res = adapter.splice_single(
                sb,
                "src/math.ts",
                create=True,
                code="export const clobbered = true;\n",
            )
            _assert_no_panic(res, "--create existing")
            assert_exit_code(res, 1, "--create existing")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F11-05",
        tier=2,
        feature="F11",
        title="Go channel receive <-ch and string literals containing ret/<- are preserved on splice",
        tags=("splice", "go", "lowering", "B-W5"),
    )
    def test_go_channel_receive_and_string_literals_preserved(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/app.go", "src/app.go")

            updated = (
                "func DrainEvents(ch <-chan string, fallback string) string {\n"
                '\tmarker := "ret <-chan literal must stay intact"\n'
                "\tselect {\n"
                "\tcase msg := <-ch:\n"
                '\t\tif msg != "" {\n'
                "\t\t\treturn msg\n"
                "\t\t}\n"
                "\t\treturn marker\n"
                "\tdefault:\n"
                '\t\treturn fallback + "-ok"\n'
                "\t}\n"
                "}"
            )
            res = adapter.splice_single(
                sb, "src/app.go", symbol="DrainEvents", code=updated
            )
            assert_exit_code(res, 0, "Go channel splice")
            disk = sb.read_text("src/app.go")
            self.assertIn("<-ch", disk)
            self.assertIn('"ret <-chan literal must stay intact"', disk)
            self.assertIn('fallback + "-ok"', disk)

    @e2e_case(
        case_id="T2-F11-06",
        tier=2,
        feature="F11",
        title="CRLF line endings and UTF-8 Unicode characters survive single-symbol splice",
        tags=("splice", "crlf", "utf8"),
    )
    def test_crlf_and_utf8_splice_preservation(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            crlf_bytes = (
                "// 中文 🚀\r\n"
                "export function greet(name: string): string {\r\n"
                "  return `Hello ${name} 🚀`;\r\n"
                "}\r\n"
                "export function stay(): number {\r\n"
                "  return 42;\r\n"
                "}\r\n"
            ).encode("utf-8")
            sb.seed_file("src/crlf.ts", crlf_bytes)

            res = adapter.splice_single(
                sb,
                "src/crlf.ts",
                symbol="greet",
                code="export function greet(name: string): string {\n  return `Hi ${name} 🚀`;\n}",
            )
            assert_exit_code(res, 0, "CRLF + UTF-8 splice")
            after_text = sb.read_bytes("src/crlf.ts").decode("utf-8")
            self.assertIn("中文", after_text)
            self.assertIn("🚀", after_text)
            self.assertIn("Hi ${name}", after_text)
            self.assertIn("stay(): number", after_text)


class TestTier2F12BatchWriteRollbackBoundaries(unittest.TestCase):
    """F12: Atomic Multi-Target Batch Write/Splice & Rollback boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F12-01",
        tier=2,
        feature="F12",
        title="Multi-file --stdin failure on final target rolls back --create and prior splice",
        tags=("batch-write", "rollback", "FW-05"),
    )
    def test_multifile_stdin_rollback_create_and_prior_splice(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("r5/valid/sample.rs", "src/sample.rs")
            before = sb.snapshot_tree()

            stream = (
                "=== src/created_should_rollback.ts ===\n"
                "export const created = true;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 99, label: "updated" };\n'
                "  }\n"
                "=== src/sample.rs:accumulate_delta ===\n"
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    let broken = ;\n"
                "    broken + delta\n"
                "}\n"
            )
            res = adapter.splice_heredoc(sb, stream)
            _assert_no_panic(res, "multi-file rollback")
            assert_exit_code(res, 1, "multi-file rollback")
            assert_disk_file_absent(sb, "src/created_should_rollback.ts")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F12-02",
        tier=2,
        feature="F12",
        title="Multi-file --stdin targeting binary file bin/logo.png rolls back all writes",
        tags=("batch-write", "rollback", "binary"),
    )
    def test_multifile_stdin_binary_target_rolls_back(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("binary/logo.png", "bin/logo.png")
            before = sb.snapshot_tree()

            stream = (
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 1, label: "ok" };\n'
                "  }\n"
                "=== bin/logo.png ===\n"
                "corrupted png text\n"
            )
            res = adapter.splice_heredoc(sb, stream)
            _assert_no_panic(res, "binary target rollback")
            assert_exit_code(res, 1, "binary target rollback")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F12-03",
        tier=2,
        feature="F12",
        title="Multi-file --stdin with path escaping project root rolls back all writes",
        tags=("batch-write", "rollback", "traversal"),
    )
    def test_multifile_stdin_escape_rolls_back(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_file("secret.ts", "export const OUTSIDE_SAFE = 1;\n", area="outside")
            ws_before = sb.snapshot_tree(sb.ws)
            out_before = sb.snapshot_tree(sb.outside)

            stream = (
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 1, label: "ok" };\n'
                "  }\n"
                "=== ../outside/secret.ts ===\n"
                "export const PWNED = true;\n"
            )
            res = adapter.splice_heredoc(sb, stream)
            _assert_no_panic(res, "escape rollback")
            assert_exit_code(res, 1, "escape rollback")
            assert_disk_unchanged(sb, ws_before, root=sb.ws)
            assert_disk_unchanged(sb, out_before, root=sb.outside)

    @e2e_case(
        case_id="T2-F12-04",
        tier=2,
        feature="F12",
        title="Empty --stdin, malformed === header, and invalid --batch JSON fail cleanly",
        tags=("batch-write", "parse-error"),
    )
    def test_empty_stdin_malformed_header_and_invalid_batch_json(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            before = sb.snapshot_tree()

            for label, stream in (
                ("empty stdin", ""),
                ("trailing colon header", "=== src/math.ts: ===\nexport const x = 1;\n"),
                ("unclosed header", "=== src/math.ts\nexport const x = 1;\n"),
                ("empty header", "=== ===\nexport const x = 1;\n"),
            ):
                res = adapter.splice_heredoc(sb, stream)
                _assert_no_panic(res, label)
                assert_exit_code(res, 1, label)
                _assert_has_diagnostic(res, label)
                assert_disk_unchanged(sb, before, context=label)

            r_json = adapter.splice_batch_json(sb, "{invalid json[", via_stdin=True)
            _assert_no_panic(r_json, "invalid batch json")
            assert_exit_code(r_json, 1, "invalid batch json")
            _assert_has_diagnostic(r_json, "invalid batch json")
            assert_disk_unchanged(sb, before, context="invalid batch json")

    @e2e_case(
        case_id="T2-F12-05",
        tier=2,
        feature="F12",
        title="Conflicting edits to same symbol in one --batch never corrupt disk AST",
        tags=("batch-write", "conflict"),
    )
    def test_conflicting_duplicate_edits_same_symbol(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            before = sb.snapshot_tree()

            items = [
                {
                    "filePath": "src/math.ts",
                    "symbol": "Calculator.add",
                    "code": '  public add(a: number, b: number): CalcResult {\n    return { value: a + b + 1, label: "v1" };\n  }',
                },
                {
                    "filePath": "src/math.ts",
                    "symbol": "Calculator.add",
                    "code": '  public add(a: number, b: number): CalcResult {\n    return { value: a + b + 2, label: "v2" };\n  }',
                },
            ]
            res = adapter.splice_batch_json(sb, items, via_stdin=True)
            _assert_no_panic(res, "conflicting duplicate symbol edits")
            if res.exit_code != 0:
                assert_disk_unchanged(sb, before, context="conflicting edits rejected")
            else:
                verify_read = adapter.read_file(sb, "src/math.ts", selector="Calculator.add")
                assert_exit_code(verify_read, 0, "committed file must stay valid AST")

    @e2e_case(
        case_id="T2-F12-06",
        tier=2,
        feature="F12",
        title="Firewall failure emits compact Line:Col diagnostic and context snippet",
        tags=("batch-write", "diagnostics", "FW-01"),
    )
    def test_firewall_failure_emits_line_col_diagnostic(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.rs", "src/sample.rs")
            before = sb.snapshot_tree()

            bad_rs = (
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    let ok = delta + 1;\n"
                "    let broken_line = ;\n"
                "    ok\n"
                "}\n"
            )
            res = adapter.splice_single(
                sb, "src/sample.rs", symbol="accumulate_delta", code=bad_rs
            )
            _assert_no_panic(res, "Line:Col diagnostic")
            assert_exit_code(res, 1, "Line:Col diagnostic")
            assert_disk_unchanged(sb, before)

            diag = _assert_has_diagnostic(res, "Line:Col diagnostic")
            self.assertRegex(
                diag,
                r"(?:\b\d+:\d+\b|line\s+\d+)",
                f"Expected Line:Col pointer in firewall diagnostic, got: {diag!r}",
            )


class TestTier2F13McpServerBoundaries(unittest.TestCase):
    """F13: Strict 2-Tool MCP Stdio JSON-RPC 2.0 boundary tests (6 cases)."""

    @e2e_case(
        case_id="T2-F13-01",
        tier=2,
        feature="F13",
        title="MCP tools/call rejects legacy hidden tools (aice_context, aice_create, aice_outline)",
        tags=("mcp", "anti-bypass", "B-S3"),
    )
    def test_mcp_rejects_legacy_tools(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")

            sess = adapter.mcp_session(
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
                        "params": {"name": "aice_context", "arguments": {"path": "src/sample.ts"}},
                    },
                    {
                        "method": "tools/call",
                        "params": {"name": "aice_create", "arguments": {"path": "src/new.ts", "code": "x"}},
                    },
                    {
                        "method": "tools/call",
                        "params": {"name": "aice_outline", "arguments": {"path": "src/sample.ts"}},
                    },
                ],
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            self.assertEqual(len(sess.responses), 4)
            for idx in (1, 2, 3):
                assert_mcp_tool_error(sess.responses[idx])

    @e2e_case(
        case_id="T2-F13-02",
        tier=2,
        feature="F13",
        title="MCP aice_read and aice_splice return isError:true when enabled:false",
        tags=("mcp", "governance", "MCP-02"),
    )
    def test_mcp_disabled_returns_is_error(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("disabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()

            r_read, sess1 = adapter.mcp_call(sb, "aice_read", {"path": "src/sample.ts"})
            self.assertEqual(sess1.exit_code, 0, sess1.stderr)
            assert_mcp_tool_error(r_read, "enabled")

            r_splice, sess2 = adapter.mcp_call(
                sb,
                "aice_splice",
                {
                    "filePath": "src/sample.ts",
                    "symbol": "applyCredit",
                    "code": "export function applyCredit() { return 0; }",
                },
            )
            self.assertEqual(sess2.exit_code, 0, sess2.stderr)
            assert_mcp_tool_error(r_splice, "enabled")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F13-03",
        tier=2,
        feature="F13",
        title="MCP aice_splice with broken syntax returns isError:true and leaves disk untouched",
        tags=("mcp", "firewall", "MCP-01"),
    )
    def test_mcp_broken_syntax_returns_is_error_disk_unchanged(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.rs", "src/sample.rs")
            before = sb.snapshot_tree()

            resp, sess = adapter.mcp_call(
                sb,
                "aice_splice",
                {
                    "filePath": "src/sample.rs",
                    "symbol": "accumulate_delta",
                    "code": "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n    let broken = ;\n    delta\n}",
                },
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_tool_error(resp)
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F13-04",
        tier=2,
        feature="F13",
        title="MCP aice_splice multi-file stream failure returns isError:true and rolls back all targets",
        tags=("mcp", "rollback", "batch-write"),
    )
    def test_mcp_multifile_rollback_returns_is_error(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("graph/math.ts", "src/math.ts")
            sb.seed_fixture("r5/valid/sample.rs", "src/sample.rs")
            before = sb.snapshot_tree()

            stream = (
                "=== src/mcp_created_rollback.ts ===\n"
                "export const created = 1;\n"
                "=== src/math.ts:Calculator.add ===\n"
                "  public add(a: number, b: number): CalcResult {\n"
                '    return { value: a + b + 5, label: "mcp" };\n'
                "  }\n"
                "=== src/sample.rs:accumulate_delta ===\n"
                "pub fn accumulate_delta(stats: &mut LedgerStats, delta: i64) -> i64 {\n"
                "    let broken = ;\n"
                "    delta\n"
                "}\n"
            )
            resp, sess = adapter.mcp_call(sb, "aice_splice", {"code": stream})
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            assert_mcp_tool_error(resp)
            assert_disk_file_absent(sb, "src/mcp_created_rollback.ts")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F13-05",
        tier=2,
        feature="F13",
        title="MCP handles malformed JSON-RPC, missing method, and unknown method without crashing",
        tags=("mcp", "jsonrpc", "error"),
    )
    def test_mcp_malformed_jsonrpc_and_unknown_method(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            raw_stream = (
                "{not valid json\n"
                + json.dumps({"jsonrpc": "2.0", "id": 10, "params": {}})
                + "\n"
                + json.dumps({"jsonrpc": "2.0", "id": 11, "method": "unknown/method_xyz", "params": {}})
                + "\n"
                + json.dumps(
                    {
                        "jsonrpc": "2.0",
                        "id": 12,
                        "method": "initialize",
                        "params": {"protocolVersion": "2024-11-05", "capabilities": {}},
                    }
                )
                + "\n"
            )
            res = adapter.run_raw(sb, ["mcp"], stdin=raw_stream)
            _assert_no_panic(res, "malformed MCP JSON-RPC")
            assert_exit_code(res, 0, "malformed MCP JSON-RPC should recover and exit 0 on EOF")

            parsed_lines = [
                json.loads(ln) for ln in res.stdout.splitlines() if ln.strip()
            ]
            errors = [obj for obj in parsed_lines if "error" in obj]
            self.assertGreaterEqual(
                len(errors),
                2,
                f"Expected JSON-RPC error objects for malformed/unknown requests: {parsed_lines!r}",
            )
            by_id = {obj.get("id"): obj for obj in parsed_lines}
            self.assertIn(12, by_id, f"Server should stay alive for id=12: {parsed_lines!r}")
            self.assertIn("result", by_id[12])

    @e2e_case(
        case_id="T2-F13-06",
        tier=2,
        feature="F13",
        title="MCP EOF on stdin after normal sequence terminates cleanly with exit 0",
        tags=("mcp", "lifecycle", "eof"),
    )
    def test_mcp_clean_eof_exit_zero(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")

            sess = adapter.mcp_session(
                sb,
                [
                    {
                        "method": "initialize",
                        "params": {"protocolVersion": "2024-11-05", "capabilities": {}},
                    },
                    {"method": "notifications/initialized"},
                    {"method": "tools/list", "params": {}},
                    {
                        "method": "tools/call",
                        "params": {"name": "aice_read", "arguments": {"path": "src/sample.ts"}},
                    },
                ],
            )
            self.assertEqual(sess.exit_code, 0, sess.stderr)
            self.assertEqual(len(sess.responses), 3)
            self.assertNotIn("panicked at", sess.stderr)


class TestTier2F14UxCompatBoundaries(unittest.TestCase):
    """F14: R7 Config/Idiom Compat, CLI UX & Portability boundary tests (5 cases)."""

    @e2e_case(
        case_id="T2-F14-01",
        tier=2,
        feature="F14",
        title="Unknown future keys and idioms block in aice.config.json are tolerated and preserved",
        tags=("compat", "config", "GOV-03"),
    )
    def test_unknown_future_keys_and_idioms_preserved(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            idioms_cfg = json.loads(_read_fixture_text("configs/idioms_preserved.aice.config.json"))
            idioms_cfg["futureExperimentalFlag"] = {"nested": [1, 2, 3], "mode": "v2"}
            sb.seed_config(idioms_cfg)
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")

            assert_exit_code(adapter.status(sb), 0, "status with unknown keys")
            assert_exit_code(adapter.read_file(sb, "src/sample.ts"), 0, "read with unknown keys")
            assert_exit_code(adapter.find(sb), 0, "find with unknown keys")
            assert_exit_code(adapter.search(sb, "applyCredit"), 0, "search with unknown keys")
            assert_exit_code(adapter.disable(sb), 0, "disable preserves unknown keys")
            assert_exit_code(adapter.enable(sb), 0, "enable preserves unknown keys")

            after_cfg = json.loads(sb.read_text("aice.config.json"))
            self.assertTrue(after_cfg.get("enabled"))
            self.assertEqual(
                after_cfg.get("futureExperimentalFlag"),
                {"nested": [1, 2, 3], "mode": "v2"},
            )
            self.assertIn("idioms", after_cfg)
            self.assertIn("$clamp", after_cfg["idioms"])

    @e2e_case(
        case_id="T2-F14-02",
        tier=2,
        feature="F14",
        title="Malformed idioms entries in aice.config.json do not panic on read or splice",
        tags=("compat", "idioms", "R7"),
    )
    def test_malformed_idioms_entry_handled_safely(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config(
                {
                    "enabled": True,
                    "idiomsEnabled": True,
                    "idioms": {"brokenIdiom": "not-an-object", "nullIdiom": None},
                }
            )
            sb.seed_fixture("r5/valid/sample.ts", "src/sample.ts")
            before = sb.snapshot_tree()

            r_read = adapter.read_file(sb, "src/sample.ts")
            _assert_no_panic(r_read, "malformed idioms read")

            r_splice = adapter.splice_single(
                sb,
                "src/sample.ts",
                symbol="applyCredit",
                code=(
                    "export function applyCredit(account: AccountSnapshot, delta: number): AccountSnapshot {\n"
                    "  return { id: account.id, balance: account.balance + delta + 10 };\n"
                    "}"
                ),
            )
            _assert_no_panic(r_splice, "malformed idioms splice")
            if r_splice.exit_code != 0:
                assert_disk_unchanged(sb, before)
            else:
                self.assertIn("delta + 10", sb.read_text("src/sample.ts"))

    @e2e_case(
        case_id="T2-F14-03",
        tier=2,
        feature="F14",
        title="Unknown CLI subcommand exits non-zero cleanly with concise help hint",
        tags=("ux", "cli", "error"),
    )
    def test_unknown_cli_subcommand_exits_nonzero(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("enabled")
            before = sb.snapshot_tree()

            res = adapter.run_raw(sb, ["nonexistent_subcommand_xyz"])
            _assert_no_panic(res, "unknown subcommand")
            self.assertNotEqual(res.exit_code, 0)
            _assert_has_diagnostic(res, "unknown subcommand")
            assert_disk_unchanged(sb, before)

    @e2e_case(
        case_id="T2-F14-04",
        tier=2,
        feature="F14",
        title="--help on read, splice, search, find, gain, and mcp exits 0 cleanly",
        tags=("ux", "help"),
    )
    def test_subcommand_help_exits_zero(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            for sub in ("read", "splice", "search", "find", "gain", "mcp"):
                res = adapter.help(sb, sub)
                _assert_no_panic(res, f"{sub} --help")
                assert_exit_code(res, 0, f"{sub} --help")
                self.assertGreater(len(res.stdout.strip()), 20)
                self.assertIn(sub, res.stdout.lower())

    @e2e_case(
        case_id="T2-F14-05",
        tier=2,
        feature="F14",
        title="R7 idiom gate consistency between config --help flags and aice.config.json",
        tags=("compat", "R7", "config"),
    )
    def test_r7_idiom_flag_and_config_consistency(self) -> None:
        adapter = AiceAdapter()
        with Sandbox() as sb:
            sb.seed_config("idioms_preserved")
            help_res = adapter.help(sb, "config")
            _assert_no_panic(help_res, "config --help")
            assert_exit_code(help_res, 0, "config --help")

            help_text = help_res.stdout
            if "--idioms-on" in help_text or "--idioms" in help_text:
                on_flag = "--idioms-on" if "--idioms-on" in help_text else "--idioms"
                off_flag = "--idioms-off" if "--idioms-off" in help_text else "--no-idioms"
                r_off = adapter.run_raw(sb, ["config", ".", off_flag])
                assert_exit_code(r_off, 0, f"config {off_flag}")
                self.assertFalse(json.loads(sb.read_text("aice.config.json")).get("idiomsEnabled"))
                r_on = adapter.run_raw(sb, ["config", ".", on_flag])
                assert_exit_code(r_on, 0, f"config {on_flag}")
                self.assertTrue(json.loads(sb.read_text("aice.config.json")).get("idiomsEnabled"))
            else:
                # If R7 killed idioms 100%, --idioms-on must not exist as a hidden flag,
                # while config --enable / status still tolerate legacy idioms fields cleanly.
                r_hidden = adapter.run_raw(sb, ["config", ".", "--idioms-on"])
                _assert_no_panic(r_hidden, "retired --idioms-on")
                self.assertNotEqual(r_hidden.exit_code, 0)
                r_status = adapter.status(sb)
                assert_exit_code(r_status, 0, "status tolerates legacy idioms config")
