"""E2E test suites package (gracefully handles empty suites before tier1..4 exist)."""

from __future__ import annotations

try:
    from ..harness.reporting import discover_suite_modules
except ImportError:  # pragma: no cover - when tests/e2e is on sys.path
    from harness.reporting import discover_suite_modules

__all__ = ["discover_suite_modules"]
