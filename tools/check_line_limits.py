#!/usr/bin/env python3
"""Enforce <= 300 lines per .rs source file under crates/*/src/**."""

from __future__ import annotations

import argparse
import sys
from pathlib import Path

EXCLUDED_SEGMENTS = {"generated", "bindings", "fixtures"}


def should_skip(path: Path) -> bool:
    return any(part in EXCLUDED_SEGMENTS for part in path.parts)


def main() -> int:
    parser = argparse.ArgumentParser(description="Check Rust source file line limits.")
    parser.add_argument("--max-lines", type=int, default=300)
    args = parser.parse_args()

    repo_root = Path(__file__).resolve().parent.parent
    crates_dir = repo_root / "crates"
    if not crates_dir.is_dir():
        print("FAIL: crates/ directory not found", file=sys.stderr)
        return 1

    rs_files = sorted(crates_dir.glob("*/src/**/*.rs"))
    checked = 0
    max_seen = 0
    violations: list[tuple[Path, int]] = []

    for path in rs_files:
        if should_skip(path):
            continue
        lines = len(path.read_text(encoding="utf-8").splitlines())
        checked += 1
        if lines > max_seen:
            max_seen = lines
        if lines > args.max_lines:
            violations.append((path.relative_to(repo_root), lines))

    if checked == 0:
        print("FAIL: zero .rs files found under crates/*/src/**", file=sys.stderr)
        return 1

    if violations:
        for rel, count in violations:
            print(f"FAIL: {rel}: {count} lines (> {args.max_lines})", file=sys.stderr)
        return 1

    print(f"PASS: {checked} files checked, max {max_seen} lines (limit {args.max_lines})")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
