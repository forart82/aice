#!/usr/bin/env python3
"""Opaque-box E2E test runner for the AICE Rust binary."""

from __future__ import annotations

import argparse
import os
import sys
import time
import unittest
from pathlib import Path

E2E_DIR = Path(__file__).resolve().parent
if str(E2E_DIR) not in sys.path:
    sys.path.insert(0, str(E2E_DIR))

from harness.config import (  # noqa: E402
    DEFAULT_AICE_BIN,
    DEFAULT_TIMEOUT_SEC,
    resolve_aice_bin,
    validate_executable_bin,
)
from harness.reporting import (  # noqa: E402
    CaseMetadata,
    E2ETestResult,
    build_json_report,
    discover_test_cases,
    format_dry_run_report,
    write_json_report,
)


def parse_tiers(raw: str) -> list[int]:
    val = raw.strip().lower()
    if not val:
        raise ValueError("Empty --tier value")
    if val == "all":
        return [1, 2, 3, 4]
    tiers: list[int] = []
    for part in val.split(","):
        tok = part.strip()
        if tok not in {"1", "2", "3", "4"}:
            raise ValueError(
                f"Invalid tier {tok!r} in --tier={raw!r}; expected 1,2,3,4 or all"
            )
        t = int(tok)
        if t not in tiers:
            tiers.append(t)
    return sorted(tiers)


def build_arg_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(
        prog="run_e2e.py",
        description="Opaque-box E2E runner for AICE (100% Python 3.12 stdlib).",
    )
    parser.add_argument(
        "--tier",
        default="all",
        help="Tiers to run: 1|2|3|4|all or comma-separated e.g. 1,2 (default: all)",
    )
    parser.add_argument(
        "--bin",
        dest="bin_path",
        default=None,
        help=f"Path to AICE binary (overrides AICE_BIN; default: {DEFAULT_AICE_BIN})",
    )
    parser.add_argument(
        "--filter",
        dest="filter_pattern",
        default=None,
        help="Regex or substring filter on case_id, feature, title, tags, or test name",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="Discover and print matching cases without invoking AICE_BIN (exits 0)",
    )
    parser.add_argument(
        "--self-test",
        action="store_true",
        help="Run harness self-tests against tests/e2e/self_test/mock_aice.py",
    )
    parser.add_argument(
        "--json-report",
        dest="json_report",
        default=None,
        help="Write structured JSON test report to <path>",
    )
    parser.add_argument(
        "-f",
        "--fail-fast",
        action="store_true",
        help="Stop on first test failure or error",
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_SEC,
        help=f"Per-command timeout in seconds (default: {DEFAULT_TIMEOUT_SEC})",
    )
    parser.add_argument(
        "-v",
        "--verbose",
        action="store_true",
        help="Verbose per-case execution output",
    )
    return parser


def run_self_test(
    *,
    aice_bin: Path,
    filter_pattern: str | None,
    fail_fast: bool,
    verbose: bool,
    json_report_path: Path | None,
) -> int:
    from self_test import test_harness_self  # noqa: E402

    loader = unittest.TestLoader()
    raw_suite = loader.loadTestsFromModule(test_harness_self)
    tests: list[unittest.TestCase] = []

    def _flatten(s: unittest.TestSuite) -> None:
        for item in s:
            if isinstance(item, unittest.TestSuite):
                _flatten(item)
            else:
                if not filter_pattern or filter_pattern.lower() in item.id().lower():
                    tests.append(item)

    _flatten(raw_suite)
    suite = unittest.TestSuite(tests)
    result = E2ETestResult(verbose=verbose, failfast=fail_fast)

    print(
        f"Running AICE E2E Harness Self-Test ({suite.countTestCases()} test(s))...",
        flush=True,
    )
    started = time.monotonic()
    suite.run(result)
    dur_ms = (time.monotonic() - started) * 1000.0

    passed = sum(1 for r in result.case_records if r["status"] == "passed")
    failed = sum(1 for r in result.case_records if r["status"] == "failed")
    errors = sum(1 for r in result.case_records if r["status"] == "error")
    skipped = sum(1 for r in result.case_records if r["status"] == "skipped")

    if not verbose:
        for rec in result.case_records:
            if rec["status"] in ("failed", "error"):
                print(f"\n[FAIL] {rec['case_id']}: {rec['message']}", flush=True)

    print(
        f"\nSelf-Test Summary: total={len(result.case_records)} passed={passed} "
        f"failed={failed} errors={errors} skipped={skipped} ({dur_ms:.1f}ms)",
        flush=True,
    )

    if json_report_path is not None:
        metas = [
            CaseMetadata(
                case_id=r["case_id"],
                tier=r["tier"],
                feature=r["feature"],
                title=r["title"],
                tags=tuple(r["tags"]),
                qualname=r["qualname"],
            )
            for r in result.case_records
        ]
        report = build_json_report(
            aice_bin=aice_bin,
            mode="self-test",
            cases_meta=metas,
            case_records=result.case_records,
            total_duration_ms=dur_ms,
        )
        write_json_report(json_report_path, report)

    return 0 if (failed == 0 and errors == 0) else 1


def main(argv: list[str] | None = None) -> int:
    parser = build_arg_parser()
    args = parser.parse_args(argv)

    try:
        tiers = parse_tiers(args.tier)
    except ValueError as exc:
        print(f"Error: {exc}", file=sys.stderr)
        return 2

    if args.timeout <= 0:
        print(
            f"Error: --timeout must be > 0, got {args.timeout!r}",
            file=sys.stderr,
        )
        return 2

    aice_bin = resolve_aice_bin(args.bin_path)
    os.environ["AICE_BIN"] = str(aice_bin)
    os.environ["AICE_E2E_TIMEOUT"] = str(args.timeout)
    json_report_path = Path(args.json_report) if args.json_report else None

    if args.self_test:
        return run_self_test(
            aice_bin=aice_bin,
            filter_pattern=args.filter_pattern,
            fail_fast=args.fail_fast,
            verbose=args.verbose,
            json_report_path=json_report_path,
        )

    suite, collected = discover_test_cases(
        tiers=tiers, filter_pattern=args.filter_pattern
    )
    cases_meta = [meta for _, meta in collected]

    if args.dry_run:
        print(
            format_dry_run_report(
                cases_meta,
                aice_bin=aice_bin,
                tiers=tiers,
                filter_pattern=args.filter_pattern,
            )
        )
        if json_report_path is not None:
            report = build_json_report(
                aice_bin=aice_bin,
                mode="dry-run",
                cases_meta=cases_meta,
                case_records=None,
                total_duration_ms=0.0,
            )
            write_json_report(json_report_path, report)
        return 0

    ok, err_msg = validate_executable_bin(aice_bin)
    if not ok:
        print(f"Error: {err_msg}", file=sys.stderr)
        return 2

    print(
        f"Running AICE E2E Suite: AICE_BIN={aice_bin} "
        f"tiers={tiers} cases={len(cases_meta)}",
        flush=True,
    )
    result = E2ETestResult(verbose=args.verbose, failfast=args.fail_fast)
    started = time.monotonic()
    suite.run(result)
    dur_ms = (time.monotonic() - started) * 1000.0

    passed = sum(1 for r in result.case_records if r["status"] == "passed")
    failed = sum(1 for r in result.case_records if r["status"] == "failed")
    errors = sum(1 for r in result.case_records if r["status"] == "error")
    skipped = sum(1 for r in result.case_records if r["status"] == "skipped")

    if not args.verbose:
        for rec in result.case_records:
            if rec["status"] in ("failed", "error"):
                print(
                    f"\n[FAIL] {rec['case_id']} ({rec['title']}):\n{rec['message']}",
                    flush=True,
                )

    print(
        f"\nE2E Summary: total={len(result.case_records)} passed={passed} "
        f"failed={failed} errors={errors} skipped={skipped} ({dur_ms:.1f}ms)",
        flush=True,
    )

    if json_report_path is not None:
        report = build_json_report(
            aice_bin=aice_bin,
            mode="live",
            cases_meta=cases_meta,
            case_records=result.case_records,
            total_duration_ms=dur_ms,
        )
        write_json_report(json_report_path, report)

    return 0 if (failed == 0 and errors == 0) else 1


if __name__ == "__main__":
    raise SystemExit(main())
