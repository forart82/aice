"""Metadata registry, suite discovery, dry-run formatting, and JSON reporting."""

from __future__ import annotations

import importlib
import json
import re
import time
import unittest
from dataclasses import dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable, TypeVar

from .config import FEATURE_CATALOG, SUITES_DIR

F = TypeVar("F", bound=Callable[..., Any])

SCHEMA_VERSION = "1.0.0"


@dataclass(frozen=True)
class CaseMetadata:
    case_id: str
    tier: int
    feature: str
    title: str
    tags: tuple[str, ...]
    qualname: str

    def to_dict(self) -> dict[str, Any]:
        return {
            "case_id": self.case_id,
            "tier": self.tier,
            "feature": self.feature,
            "title": self.title,
            "tags": list(self.tags),
            "qualname": self.qualname,
        }


_REGISTERED_CASES: dict[str, CaseMetadata] = {}


def e2e_case(
    *,
    case_id: str,
    tier: int,
    feature: str,
    title: str,
    tags: tuple[str, ...] | list[str] = (),
) -> Callable[[F], F]:
    """Decorator attaching tier/feature/id metadata to an E2E test method or function."""
    if tier not in (1, 2, 3, 4):
        raise ValueError(f"Invalid tier {tier!r} for case {case_id!r}; expected 1..4")
    if not re.fullmatch(r"F(?:0[1-9]|1[0-4])", feature):
        raise ValueError(
            f"Invalid feature {feature!r} for case {case_id!r}; expected F01..F14"
        )
    norm_tags = tuple(str(t) for t in tags)

    def decorator(func: F) -> F:
        qualname = f"{func.__module__}.{func.__qualname__}"
        meta = CaseMetadata(
            case_id=case_id,
            tier=tier,
            feature=feature,
            title=title,
            tags=norm_tags,
            qualname=qualname,
        )
        setattr(func, "__e2e_meta__", meta)
        _REGISTERED_CASES[qualname] = meta
        return func

    return decorator


def clear_registered_cases() -> None:
    """Clear registry (primarily for unit/self-test isolation)."""
    _REGISTERED_CASES.clear()


def get_registered_cases() -> list[CaseMetadata]:
    """Return all registered cases sorted deterministically by tier then case_id."""
    return sorted(
        _REGISTERED_CASES.values(),
        key=lambda c: (c.tier, c.case_id, c.qualname),
    )


def discover_suite_modules() -> list[str]:
    """Return importable module names under tests/e2e/suites/ matching tier*.py."""
    if not SUITES_DIR.is_dir():
        return []
    modules: list[str] = []
    for entry in sorted(SUITES_DIR.iterdir()):
        if (
            entry.is_file()
            and entry.suffix == ".py"
            and entry.name.startswith("tier")
            and not entry.name.startswith("_")
        ):
            modules.append(f"suites.{entry.stem}")
    return modules


def _matches_filter(meta: CaseMetadata, test_id: str, pattern: str | None) -> bool:
    if not pattern:
        return True
    haystack = " ".join(
        [
            meta.case_id,
            meta.feature,
            meta.title,
            " ".join(meta.tags),
            meta.qualname,
            test_id,
        ]
    )
    try:
        return re.search(pattern, haystack, re.IGNORECASE) is not None
    except re.error:
        return pattern.lower() in haystack.lower()


def _extract_case_meta(test: unittest.TestCase) -> CaseMetadata:
    method_name = getattr(test, "_testMethodName", "")
    method = getattr(test, method_name, None) if method_name else None
    meta = getattr(method, "__e2e_meta__", None)
    if isinstance(meta, CaseMetadata):
        return meta

    # Fallback inference if a test method lacks @e2e_case
    qualname = test.id()
    tier = 1
    m_tier = re.search(r"tier([1-4])", qualname, re.IGNORECASE)
    if m_tier:
        tier = int(m_tier.group(1))
    return CaseMetadata(
        case_id=method_name or qualname,
        tier=tier,
        feature="F01",
        title=test.shortDescription() or method_name or qualname,
        tags=(),
        qualname=qualname,
    )


def _iter_unittest_cases(suite: unittest.TestSuite) -> list[unittest.TestCase]:
    items: list[unittest.TestCase] = []
    for child in suite:
        if isinstance(child, unittest.TestSuite):
            items.extend(_iter_unittest_cases(child))
        else:
            items.append(child)
    return items


def discover_test_cases(
    *,
    tiers: list[int],
    filter_pattern: str | None = None,
) -> tuple[unittest.TestSuite, list[tuple[unittest.TestCase, CaseMetadata]]]:
    """Import tier modules under suites/ and return filtered TestSuite + metadata pairs."""
    loader = unittest.TestLoader()
    collected: list[tuple[unittest.TestCase, CaseMetadata]] = []
    tier_set = set(tiers)

    for mod_name in discover_suite_modules():
        mod = importlib.import_module(mod_name)
        loaded = loader.loadTestsFromModule(mod)
        for tc in _iter_unittest_cases(loaded):
            meta = _extract_case_meta(tc)
            if meta.tier not in tier_set:
                continue
            if not _matches_filter(meta, tc.id(), filter_pattern):
                continue
            collected.append((tc, meta))

    collected.sort(key=lambda pair: (pair[1].tier, pair[1].case_id, pair[0].id()))
    filtered_suite = unittest.TestSuite([tc for tc, _ in collected])
    return filtered_suite, collected


def compute_counts(
    cases: list[CaseMetadata],
) -> tuple[dict[str, int], dict[str, int]]:
    tier_counts: dict[str, int] = {"1": 0, "2": 0, "3": 0, "4": 0}
    feature_counts: dict[str, int] = {k: 0 for k in FEATURE_CATALOG}
    for c in cases:
        t_key = str(c.tier)
        tier_counts[t_key] = tier_counts.get(t_key, 0) + 1
        feature_counts[c.feature] = feature_counts.get(c.feature, 0) + 1
    return tier_counts, feature_counts


def format_dry_run_report(
    cases: list[CaseMetadata],
    *,
    aice_bin: Path,
    tiers: list[int],
    filter_pattern: str | None = None,
) -> str:
    tier_counts, feature_counts = compute_counts(cases)
    lines: list[str] = [
        "AICE E2E Dry-Run Discovery",
        f"  AICE_BIN : {aice_bin}",
        f"  Tiers    : {','.join(str(t) for t in tiers)}",
        f"  Filter   : {filter_pattern or '(none)'}",
        f"  Total    : {len(cases)} case(s)",
        "  By Tier  : "
        + ", ".join(f"T{k}={tier_counts[k]}" for k in ("1", "2", "3", "4")),
        "  Features : "
        + ", ".join(f"{k}={v}" for k, v in feature_counts.items() if v > 0),
    ]
    if not cases:
        lines.append("  (No tier suite cases discovered yet under tests/e2e/suites/)")
    else:
        lines.append("")
        for c in cases:
            tags_s = f" [{','.join(c.tags)}]" if c.tags else ""
            lines.append(
                f"  [T{c.tier}][{c.feature}] {c.case_id}: {c.title}{tags_s}"
            )
    return "\n".join(lines)


class E2ETestResult(unittest.TestResult):
    """Collects per-case execution results and timings for console & JSON output."""

    def __init__(self, *, verbose: bool = False, failfast: bool = False) -> None:
        super().__init__()
        self.verbose = verbose
        self.failfast = failfast
        self.case_records: list[dict[str, Any]] = []
        self._start_times: dict[str, float] = {}

    def startTest(self, test: unittest.TestCase) -> None:
        super().startTest(test)
        self._start_times[test.id()] = time.monotonic()

    def _elapsed_ms(self, test: unittest.TestCase) -> float:
        started = self._start_times.pop(test.id(), time.monotonic())
        return round((time.monotonic() - started) * 1000.0, 2)

    def _record(
        self,
        test: unittest.TestCase,
        status: str,
        message: str | None = None,
    ) -> None:
        meta = _extract_case_meta(test)
        dur = self._elapsed_ms(test)
        rec = {
            **meta.to_dict(),
            "status": status,
            "duration_ms": dur,
            "message": message,
        }
        self.case_records.append(rec)
        if self.verbose:
            tag = status.upper()
            print(f"  [{tag}] {meta.case_id} ({dur:.1f}ms) - {meta.title}", flush=True)
            if message and status in ("failed", "error"):
                print(message, flush=True)

    def addSuccess(self, test: unittest.TestCase) -> None:
        super().addSuccess(test)
        self._record(test, "passed")

    def addFailure(self, test: unittest.TestCase, err: Any) -> None:
        super().addFailure(test, err)
        msg = self._exc_info_to_string(err, test)
        self._record(test, "failed", msg)

    def addError(self, test: unittest.TestCase, err: Any) -> None:
        super().addError(test, err)
        msg = self._exc_info_to_string(err, test)
        self._record(test, "error", msg)

    def addSkip(self, test: unittest.TestCase, reason: str) -> None:
        super().addSkip(test, reason)
        self._record(test, "skipped", reason)


def build_json_report(
    *,
    aice_bin: Path,
    mode: str,
    cases_meta: list[CaseMetadata],
    case_records: list[dict[str, Any]] | None = None,
    total_duration_ms: float = 0.0,
) -> dict[str, Any]:
    """Construct structured JSON report conforming to E2E report schema."""
    tier_counts, feature_counts = compute_counts(cases_meta)

    if case_records is None:
        records = [{**c.to_dict(), "status": "planned", "duration_ms": 0.0, "message": None} for c in cases_meta]
        passed = 0
        failed = 0
        errors = 0
        skipped = 0
        success = True
    else:
        records = case_records
        passed = sum(1 for r in records if r["status"] == "passed")
        failed = sum(1 for r in records if r["status"] == "failed")
        errors = sum(1 for r in records if r["status"] == "error")
        skipped = sum(1 for r in records if r["status"] == "skipped")
        success = failed == 0 and errors == 0

    return {
        "schema_version": SCHEMA_VERSION,
        "timestamp_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "aice_bin": str(aice_bin),
        "mode": mode,
        "summary": {
            "total": len(records),
            "passed": passed,
            "failed": failed,
            "errors": errors,
            "skipped": skipped,
            "duration_ms": round(total_duration_ms, 2),
            "success": success,
        },
        "tier_counts": tier_counts,
        "feature_counts": feature_counts,
        "cases": records,
    }


def write_json_report(path: Path, report: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
