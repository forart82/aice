"""Opaque-box assertion helpers for AICE CLI, MCP, disk, and telemetry invariants."""

from __future__ import annotations

import hashlib
import json
import re
from pathlib import Path
from typing import Any

from .adapter import CliResult
from .sandbox import Area, Sandbox

_FALLBACK_MARKER = "[AICE AST Fallback]"
_HEADER_LINE_RE = re.compile(r"^(?://|#|--|<!--|/\*|\{\#)\s*\S+")
_STATS_FOOTER_RE = re.compile(
    r"^(?:(?://|#|--|<!--|/\*|\{\#)\s*)?(?:\[stats\b.*|stats:\s+.*)$",
    re.IGNORECASE,
)
_LINE_NUMBER_GUTTER_RE = re.compile(r"^\s*(?:L?\d+:|\d+[│|])\s?")
_ALLOWED_AICE_CONFIG_FILES = frozenset(
    {"aice.config.json", ".aicerc", ".aice-idioms.json"}
)


def assert_exit_code(res: CliResult, expected: int, context: str = "") -> None:
    if res.exit_code != expected:
        prefix = f"[{context}] " if context else ""
        raise AssertionError(
            f"{prefix}Expected exit code {expected}, got {res.exit_code}.\n"
            f"argv: {res.argv}\nstdout: {res.stdout!r}\nstderr: {res.stderr!r}"
        )


def assert_stdout_contains(res: CliResult, needle: str, context: str = "") -> None:
    if needle not in res.stdout:
        prefix = f"[{context}] " if context else ""
        raise AssertionError(
            f"{prefix}Expected stdout to contain {needle!r}.\n"
            f"stdout: {res.stdout!r}\nstderr: {res.stderr!r}"
        )


def assert_stdout_not_contains(
    res: CliResult, needle: str, context: str = ""
) -> None:
    if needle in res.stdout:
        prefix = f"[{context}] " if context else ""
        raise AssertionError(
            f"{prefix}Expected stdout NOT to contain {needle!r}.\n"
            f"stdout: {res.stdout!r}"
        )


def assert_stderr_contains(res: CliResult, needle: str, context: str = "") -> None:
    if needle not in res.stderr:
        prefix = f"[{context}] " if context else ""
        raise AssertionError(
            f"{prefix}Expected stderr to contain {needle!r}.\n"
            f"stderr: {res.stderr!r}\nstdout: {res.stdout!r}"
        )


def assert_no_raw_binary_bytes(raw_bytes: bytes, context: str = "") -> None:
    prefix = f"[{context}] " if context else ""
    if b"\x00" in raw_bytes:
        raise AssertionError(f"{prefix}Raw NUL byte (0x00) leaked into output bytes")
    try:
        raw_bytes.decode("utf-8")
    except UnicodeDecodeError as exc:
        raise AssertionError(
            f"{prefix}Invalid UTF-8 binary bytes leaked into output: {exc}"
        ) from exc


def _strip_optional_file_headers(
    text: str,
    raw_first_line: str | None = None,
    raw_last_line: str | None = None,
) -> str:
    lines = text.strip().splitlines()
    while (
        lines
        and _HEADER_LINE_RE.match(lines[0].strip())
        and (raw_first_line is None or lines[0].strip() != raw_first_line)
    ):
        lines.pop(0)
    while (
        lines
        and _STATS_FOOTER_RE.match(lines[-1].strip())
        and (raw_last_line is None or lines[-1].strip() != raw_last_line)
    ):
        lines.pop()
    return "\n".join(lines).strip()


def _normalize_lines(text: str) -> list[str]:
    return [ln.strip() for ln in text.splitlines() if ln.strip()]


def _filter_non_trivial_lines(lines: list[str]) -> list[str]:
    return [ln for ln in lines if len(ln) >= 8 and not ln.startswith(("//", "#"))]


def assert_is_aice_transformed(
    stdout: str,
    lang: str,
    raw_source: str,
    context: str = "",
) -> None:
    """Verify output is AICE-transformed (not raw native source and not empty)."""
    prefix = f"[{context} ({lang})] " if context else f"[{lang}] "
    stripped_out = stdout.strip()
    if not stripped_out:
        raise AssertionError(f"{prefix}Expected non-empty AICE output, got empty string")

    stripped_raw = raw_source.strip()
    if not stripped_raw:
        return

    raw_lines = stripped_raw.splitlines()
    raw_first = raw_lines[0].strip() if raw_lines else None
    raw_last = raw_lines[-1].strip() if raw_lines else None
    body_out = _strip_optional_file_headers(stripped_out, raw_first, raw_last)
    if stripped_out == stripped_raw or body_out == stripped_raw:
        raise AssertionError(
            f"{prefix}Output leaked verbatim raw native source instead of AICE IR.\n"
            f"stdout: {stdout[:400]!r}"
        )

    norm_out = _normalize_lines(body_out)
    norm_raw = _normalize_lines(stripped_raw)
    if norm_out == norm_raw:
        raise AssertionError(
            f"{prefix}Normalized output lines match raw native source verbatim.\n"
            f"stdout: {stdout[:400]!r}"
        )

    # Check line-numbered raw leakage (e.g. "1│ <raw>", "1| <raw>", "1: <raw>", "L1: <raw>").
    body_lines = body_out.splitlines()
    has_line_gutter = any(_LINE_NUMBER_GUTTER_RE.match(ln) for ln in body_lines)
    unnumbered_body = "\n".join(
        _LINE_NUMBER_GUTTER_RE.sub("", ln) for ln in body_lines
    ).strip()
    norm_unnumbered = _normalize_lines(unnumbered_body)
    if has_line_gutter and (
        unnumbered_body == stripped_raw or norm_unnumbered == norm_raw
    ):
        raise AssertionError(
            f"{prefix}Line-numbered output leaked verbatim raw native source instead of AICE IR.\n"
            f"stdout: {stdout[:400]!r}"
        )

    # For multi-line structured/code sources, reject outputs that emit >= 3 consecutive
    # raw non-trivial lines verbatim (ignoring single-line files like tiny.ts).
    if len(norm_raw) >= 4:
        raw_blocks = _filter_non_trivial_lines(norm_raw)
        if len(raw_blocks) >= 3:
            out_blocks = _filter_non_trivial_lines(norm_out)
            for idx in range(len(raw_blocks) - 2):
                triplet = raw_blocks[idx : idx + 3]
                if any(
                    out_blocks[j : j + 3] == triplet
                    for j in range(max(0, len(out_blocks) - 2))
                ):
                    raise AssertionError(
                        f"{prefix}Output contains 3+ consecutive verbatim raw source lines "
                        f"({chr(10).join(triplet)!r}); expected AICE transformation."
                    )
            if "│ " in body_out or has_line_gutter:
                unnum_blocks = _filter_non_trivial_lines(norm_unnumbered)
                for idx in range(len(raw_blocks) - 2):
                    triplet = raw_blocks[idx : idx + 3]
                    if any(
                        unnum_blocks[j : j + 3] == triplet
                        for j in range(max(0, len(unnum_blocks) - 2))
                    ):
                        raise AssertionError(
                            f"{prefix}Line-numbered output contains 3+ consecutive verbatim raw source lines "
                            f"({chr(10).join(triplet)!r}); expected AICE transformation."
                        )

    # Ensure output preserves at least one alphanumeric identifier from the raw input.
    # Strip comment-only lines first so long license/doc headers cannot crowd out code symbols.
    code_only_raw = "\n".join(
        ln
        for ln in stripped_raw.splitlines()
        if not ln.lstrip().startswith(("//", "#", "/*", "*", "--", "<!--"))
    )
    stop_keywords = {
        "export",
        "import",
        "const",
        "function",
        "return",
        "public",
        "private",
        "class",
        "struct",
        "select",
        "from",
        "where",
        "create",
        "table",
    }
    id_source = (
        code_only_raw
        if re.search(r"[A-Za-z_][A-Za-z0-9_]{2,}", code_only_raw)
        else stripped_raw
    )
    raw_ids = list(
        dict.fromkeys(
            tok
            for tok in re.findall(r"[A-Za-z_][A-Za-z0-9_]{2,}", id_source)
            if tok.lower() not in stop_keywords
        )
    )
    if raw_ids and not any(tok in stripped_out for tok in raw_ids):
        raise AssertionError(
            f"{prefix}AICE output does not preserve any semantic identifier from source "
            f"(checked {raw_ids[:5]!r}). stdout={stdout[:300]!r}"
        )


def assert_no_ast_fallback_marker(res: CliResult, context: str = "") -> None:
    prefix = f"[{context}] " if context else ""
    if _FALLBACK_MARKER in res.stdout or _FALLBACK_MARKER in res.stderr:
        raise AssertionError(
            f"{prefix}Forbidden legacy '{_FALLBACK_MARKER}' detected.\n"
            f"stdout: {res.stdout!r}\nstderr: {res.stderr!r}"
        )


def assert_disk_file_equals(
    sandbox: Sandbox,
    rel_path: str | Path,
    expected: str | bytes,
    *,
    area: Area = "ws",
    context: str = "",
) -> None:
    prefix = f"[{context}] " if context else ""
    target = sandbox.path(rel_path, area=area)
    if not target.is_file():
        raise AssertionError(f"{prefix}Expected file '{rel_path}' to exist at {target}")
    if isinstance(expected, bytes):
        actual_bytes = target.read_bytes()
        if actual_bytes != expected:
            raise AssertionError(
                f"{prefix}Binary mismatch in '{rel_path}': "
                f"expected {len(expected)} bytes, got {len(actual_bytes)} bytes"
            )
    else:
        actual_text = target.read_text(encoding="utf-8")
        if actual_text != expected:
            raise AssertionError(
                f"{prefix}Text mismatch in '{rel_path}'.\n"
                f"Expected:\n{expected!r}\nActual:\n{actual_text!r}"
            )


def assert_disk_file_absent(
    sandbox: Sandbox,
    rel_path: str | Path,
    *,
    area: Area = "ws",
    context: str = "",
) -> None:
    prefix = f"[{context}] " if context else ""
    target = sandbox.path(rel_path, area=area)
    if target.exists() or target.is_symlink():
        raise AssertionError(
            f"{prefix}Expected '{rel_path}' to be absent on disk, but found {target}"
        )


def assert_zero_aice_artifacts(
    sandbox: Sandbox, *, root: Path | None = None, context: str = ""
) -> None:
    prefix = f"[{context}] " if context else ""
    base = root if root is not None else sandbox.ws
    if not base.exists():
        return
    leftovers: list[str] = []
    for p in base.rglob("*"):
        name = p.name
        if name in _ALLOWED_AICE_CONFIG_FILES:
            continue
        if (
            name.endswith(".tmp")
            or ".aice-tmp" in name
            or name.endswith(".aice.tmp")
            or name.endswith(".aice")
            or name.endswith(".aice.bak")
        ):
            leftovers.append(p.relative_to(base).as_posix())
    if leftovers:
        raise AssertionError(
            f"{prefix}Found leftover temp/artifact files in {base}: {leftovers}"
        )


def assert_disk_unchanged(
    sandbox: Sandbox,
    before_snapshot: dict[str, bytes],
    *,
    root: Path | None = None,
    context: str = "",
) -> None:
    prefix = f"[{context}] " if context else ""
    after_snapshot = sandbox.snapshot_tree(root)
    before_keys = set(before_snapshot.keys())
    after_keys = set(after_snapshot.keys())

    if before_keys != after_keys:
        added = sorted(after_keys - before_keys)
        removed = sorted(before_keys - after_keys)
        raise AssertionError(
            f"{prefix}Disk file set changed unexpectedly! added={added}, removed={removed}"
        )

    for rel in sorted(before_keys):
        if before_snapshot[rel] != after_snapshot[rel]:
            b_hash = hashlib.sha256(before_snapshot[rel]).hexdigest()[:16]
            a_hash = hashlib.sha256(after_snapshot[rel]).hexdigest()[:16]
            raise AssertionError(
                f"{prefix}Disk content mutated in '{rel}' (sha256 {b_hash} -> {a_hash})"
            )

    assert_zero_aice_artifacts(sandbox, root=root, context=context)


def assert_telemetry_ledger_consistent(
    sandbox: Sandbox,
    expected_min_rows: int = 1,
    *,
    check_o200k_distinct_across_rows: bool = False,
    check_negative_deltas_allowed: bool = False,
    max_row_bytes: int = 1024,
) -> list[dict[str, Any]]:
    if not sandbox.telemetry_path.is_file():
        raise AssertionError(
            f"Telemetry ledger not created at {sandbox.telemetry_path}"
        )
    raw_lines = [
        ln for ln in sandbox.telemetry_path.read_text(encoding="utf-8").splitlines() if ln.strip()
    ]
    if len(raw_lines) < expected_min_rows:
        raise AssertionError(
            f"Expected >= {expected_min_rows} telemetry row(s), got {len(raw_lines)}"
        )

    rows: list[dict[str, Any]] = []
    for idx, line in enumerate(raw_lines):
        byte_len = len(line.encode("utf-8"))
        if byte_len >= max_row_bytes:
            raise AssertionError(
                f"Telemetry row {idx} exceeds compact cap ({byte_len} >= {max_row_bytes} bytes): {line!r}"
            )
        row = json.loads(line)
        if not isinstance(row, dict):
            raise AssertionError(
                f"Telemetry row {idx} must be JSON object, got {type(row).__name__}: {row!r}"
            )
        for req_key in ("t", "r", "f", "o", "nc", "ac", "n1", "a1", "n2", "a2"):
            if req_key not in row:
                raise AssertionError(
                    f"Telemetry row {idx} missing required key {req_key!r}: {row!r}"
                )
        t_val = row["t"]
        if not isinstance(t_val, int) or isinstance(t_val, bool) or t_val <= 0:
            raise AssertionError(
                f"Telemetry row {idx} key 't' must be u64 epoch ms: {t_val!r}"
            )
        for str_key in ("r", "f", "o"):
            if not isinstance(row[str_key], str) or not row[str_key].strip():
                raise AssertionError(
                    f"Telemetry row {idx} key {str_key!r} must be non-empty string: {row[str_key]!r}"
                )
        for num_key in ("nc", "ac", "n1", "a1", "n2", "a2"):
            val = row[num_key]
            if not isinstance(val, int) or isinstance(val, bool) or val < 0:
                raise AssertionError(
                    f"Telemetry row {idx} key {num_key!r} invalid integer: {val!r}"
                )
        rows.append(row)

    if check_o200k_distinct_across_rows:
        has_diff = any(r["n1"] != r["n2"] or r["a1"] != r["a2"] for r in rows)
        if not has_diff:
            raise AssertionError(
                "Expected o200k_base counts (n2/a2) to diverge from cl100k_base (n1/a1) "
                "on at least one row across corpus, but all rows were identical."
            )

    if check_negative_deltas_allowed:
        has_neg = any(
            r["a1"] > r["n1"] or r["a2"] > r["n2"] or r["ac"] > r["nc"] for r in rows
        )
        if not has_neg:
            raise AssertionError(
                "Expected at least one signed negative delta row (a1 > n1 or ac > nc) "
                "without clamping, but none was recorded."
            )

    return rows


def assert_gain_json_valid(res: CliResult) -> dict[str, Any]:
    assert_exit_code(res, 0, "gain --json")
    data = res.stdout_json
    if not isinstance(data, dict):
        raise AssertionError(
            f"Expected gain --json to emit a JSON object, got {type(data).__name__}: {res.stdout!r}"
        )
    required = (
        "totalOperations",
        "nativeCl100k",
        "aiceCl100k",
        "nativeO200k",
        "aiceO200k",
        "byCommand",
        "byOperation",
        "projects",
    )
    missing = [k for k in required if k not in data]
    if missing:
        raise AssertionError(
            f"gain --json missing required field(s) {missing}: keys={sorted(data.keys())}"
        )
    return data


def assert_gain_project_json_valid(res: CliResult) -> dict[str, Any]:
    assert_exit_code(res, 0, "gain -p --json")
    data = res.stdout_json
    if not isinstance(data, dict):
        raise AssertionError(
            f"Expected gain -p --json to emit a JSON object, got {type(data).__name__}: {res.stdout!r}"
        )
    missing_top = [k for k in ("unique", "telemetryPath", "project") if k not in data]
    if missing_top:
        raise AssertionError(
            f"gain -p --json missing required field(s) {missing_top}: keys={sorted(data.keys())}"
        )
    if not isinstance(data["unique"], bool):
        raise AssertionError(
            f"gain -p --json 'unique' must be bool, got {data['unique']!r}"
        )
    if not isinstance(data["telemetryPath"], str) or not data["telemetryPath"].strip():
        raise AssertionError(
            f"gain -p --json 'telemetryPath' must be non-empty str, got {data['telemetryPath']!r}"
        )
    proj = data["project"]
    if not isinstance(proj, dict):
        raise AssertionError(
            f"gain -p --json 'project' must be dict, got {type(proj).__name__}"
        )
    proj_required = (
        "projectRoot",
        "projectName",
        "configStatus",
        "summary",
        "byCommand",
        "byOperation",
    )
    missing_proj = [k for k in proj_required if k not in proj]
    if missing_proj:
        raise AssertionError(
            f"gain -p --json 'project' missing required field(s) {missing_proj}: keys={sorted(proj.keys())}"
        )
    if not isinstance(proj["projectRoot"], str) or not proj["projectRoot"].strip():
        raise AssertionError(
            f"gain -p --json project.projectRoot invalid: {proj['projectRoot']!r}"
        )
    if not isinstance(proj["projectName"], str) or not proj["projectName"].strip():
        raise AssertionError(
            f"gain -p --json project.projectName invalid: {proj['projectName']!r}"
        )
    cfg = proj["configStatus"]
    if not isinstance(cfg, dict) or not isinstance(cfg.get("enabled"), bool):
        raise AssertionError(f"gain -p --json project.configStatus invalid: {cfg!r}")
    if not isinstance(proj["byCommand"], list):
        raise AssertionError(
            f"gain -p --json project.byCommand must be list, got {proj['byCommand']!r}"
        )
    if not isinstance(proj["byOperation"], list):
        raise AssertionError(
            f"gain -p --json project.byOperation must be list, got {proj['byOperation']!r}"
        )
    summary = proj["summary"]
    if not isinstance(summary, dict):
        raise AssertionError(
            f"gain -p --json project.summary must be dict, got {summary!r}"
        )
    for key in ("calls", "nativeCl100k", "aiceCl100k", "nativeO200k", "aiceO200k"):
        if key not in summary:
            raise AssertionError(
                f"gain -p --json project.summary missing required field {key!r}: keys={sorted(summary.keys())}"
            )
        val = summary[key]
        if not isinstance(val, int) or isinstance(val, bool) or val < 0:
            raise AssertionError(
                f"gain -p --json project.summary.{key} must be non-negative int, got {val!r}"
            )
    return data


def assert_tmp_telemetry_suppressed(fake_home: Path) -> None:
    gains = fake_home / ".aice" / "telemetry" / "gains.jsonl"
    if gains.exists():
        content = gains.read_text(encoding="utf-8").strip()
        if content:
            raise AssertionError(
                f"Expected /tmp workspace telemetry suppression, but {gains} has data: {content!r}"
            )


def assert_mcp_strict_two_tools(tools_list_resp: dict[str, Any]) -> None:
    if not isinstance(tools_list_resp, dict):
        raise AssertionError(
            f"MCP tools/list response MUST be a JSON-RPC dict, got {tools_list_resp!r}"
        )
    if "error" in tools_list_resp:
        raise AssertionError(f"tools/list returned JSON-RPC error: {tools_list_resp!r}")
    result = tools_list_resp.get("result")
    if not isinstance(result, dict):
        raise AssertionError(
            f"MCP tools/list response MUST contain a dict 'result', got {result!r}"
        )
    tools = result.get("tools")
    if (
        not isinstance(tools, list)
        or len(tools) != 2
        or not all(isinstance(t, dict) for t in tools)
    ):
        raise AssertionError(
            f"MCP tools/list MUST expose strictly 2 tool dicts ['aice_read', 'aice_splice'], got {tools!r}"
        )
    names = [t.get("name") for t in tools]
    if not all(isinstance(n, str) for n in names) or sorted(names) != [
        "aice_read",
        "aice_splice",
    ]:
        raise AssertionError(
            f"MCP tools/list MUST expose strictly ['aice_read', 'aice_splice'], got {names!r}"
        )


def assert_mcp_tool_error(
    resp: dict[str, Any], expected_substring: str | None = None
) -> None:
    if "error" in resp:
        err_msg = json.dumps(resp["error"])
        if expected_substring and expected_substring.lower() not in err_msg.lower():
            raise AssertionError(
                f"MCP JSON-RPC error did not mention {expected_substring!r}: {resp!r}"
            )
        return

    result = resp.get("result")
    if not isinstance(result, dict) or result.get("isError") is not True:
        raise AssertionError(
            f"Expected MCP error (JSON-RPC error or result.isError=true), got: {resp!r}"
        )
    if expected_substring:
        texts = [
            c.get("text", "")
            for c in result.get("content", [])
            if isinstance(c, dict)
        ]
        joined = "\n".join(texts)
        if expected_substring.lower() not in joined.lower():
            raise AssertionError(
                f"MCP error text did not contain {expected_substring!r}: {joined!r}"
            )


def assert_mcp_text_result(
    resp: dict[str, Any], expected_substring: str | None = None
) -> str:
    if "error" in resp:
        raise AssertionError(f"Unexpected MCP JSON-RPC error: {resp!r}")
    result = resp.get("result")
    if not isinstance(result, dict):
        raise AssertionError(f"Missing MCP result object: {resp!r}")
    if result.get("isError") is True:
        raise AssertionError(f"Expected MCP success, got isError=true: {resp!r}")
    content = result.get("content")
    if not isinstance(content, list) or not content:
        raise AssertionError(f"Expected non-empty MCP content list: {resp!r}")
    first = content[0]
    if not isinstance(first, dict) or first.get("type") != "text":
        raise AssertionError(f"Expected text content item in MCP result: {resp!r}")
    text = str(first.get("text", ""))
    if not text.strip():
        raise AssertionError(f"Expected non-empty text in MCP result: {resp!r}")
    if expected_substring and expected_substring not in text:
        raise AssertionError(
            f"Expected MCP text to contain {expected_substring!r}, got: {text!r}"
        )
    return text
