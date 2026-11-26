"""Configuration and binary resolution for the opaque-box E2E harness."""

from __future__ import annotations

import os
from pathlib import Path

E2E_DIR: Path = Path(__file__).resolve().parents[1]
ROOT_DIR: Path = E2E_DIR.parents[1]
FIXTURES_DIR: Path = E2E_DIR / "fixtures"
SUITES_DIR: Path = E2E_DIR / "suites"
SELF_TEST_DIR: Path = E2E_DIR / "self_test"

DEFAULT_AICE_BIN: Path = ROOT_DIR / "target" / "release" / "aice"
DEFAULT_TIMEOUT_SEC: float = 30.0


def resolve_timeout(cli_timeout: float | None = None) -> float:
    """Resolve per-command timeout via explicit arg -> $AICE_E2E_TIMEOUT -> default."""
    if cli_timeout is not None:
        return float(cli_timeout)
    raw = os.environ.get("AICE_E2E_TIMEOUT", "").strip()
    if raw:
        try:
            val = float(raw)
            if val > 0:
                return val
        except ValueError:
            pass
    return DEFAULT_TIMEOUT_SEC

FEATURE_CATALOG: dict[str, str] = {
    "F01": "Governance, Config Discovery & Admin",
    "F02": "Single Pipeline Law, Binary Guard & PlainText Passthrough",
    "F03": "Honest BPE Telemetry & Ledger",
    "F04": "R5 Systems & OOP Languages (AST Read & Firewalls)",
    "F05": "R5 Web, Script, Data & Twig (AST Read & Firewalls)",
    "F06": "R6 Database & Query Dialects (AST Read & Firewalls)",
    "F07": "Symbol Slicing, Auto-Outline (>120L), >50KB & Intra-Function AST",
    "F08": "Cross-File Dependency & Caller Topological Ordering",
    "F09": "Parallel Find, 4-Tier Ranked Search & Smart Fuzzy Guessing",
    "F10": "Multi-Target Batch Read Packs & Water-Filling Budget",
    "F11": "Surgical Single-Target Splice, Hunks & Half-Open :L Guard",
    "F12": "Atomic Multi-Target Batch Write/Splice & All-or-Nothing Rollback",
    "F13": "Strict 2-Tool MCP Stdio JSON-RPC 2.0 Server",
    "F14": "R7 Config/Idiom Compat, Redesigned --help/agents & Zero-Node Portability",
}


def resolve_aice_bin(cli_bin: str | Path | None = None) -> Path:
    """Resolve AICE binary path via --bin -> $AICE_BIN -> DEFAULT_AICE_BIN."""
    if cli_bin is not None and str(cli_bin).strip():
        return Path(cli_bin).expanduser().absolute()
    env_bin = os.environ.get("AICE_BIN", "").strip()
    if env_bin:
        return Path(env_bin).expanduser().absolute()
    return DEFAULT_AICE_BIN


def validate_executable_bin(bin_path: Path) -> tuple[bool, str]:
    """Check whether bin_path exists, is a regular file, and is executable."""
    if not bin_path.exists():
        return (
            False,
            f"AICE binary not found at '{bin_path}'. "
            "Build the release binary or pass --bin <path> / set AICE_BIN.",
        )
    if not bin_path.is_file():
        return (
            False,
            f"AICE binary path '{bin_path}' exists but is not a regular file.",
        )
    if not os.access(bin_path, os.X_OK):
        return (
            False,
            f"AICE binary '{bin_path}' is not executable (missing +x permission).",
        )
    return (True, "")
