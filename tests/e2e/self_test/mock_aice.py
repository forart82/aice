#!/usr/bin/env python3
"""Self-test-only synthetic mock binary simulating compliant and buggy AICE behaviors.

Controlled strictly via AICE_MOCK_MODE environment variable:
  - compliant
  - leak_raw
  - mutate_on_firewall_fail
  - allow_when_disabled
  - extra_mcp_tool
  - partial_rollback
"""

from __future__ import annotations

import json
import os
import re
import sys
import time
from pathlib import Path
from typing import Any


def _mock_mode() -> str:
    return os.environ.get("AICE_MOCK_MODE", "compliant").strip()


def _load_project_config(cwd: Path) -> dict[str, Any]:
    for name in ("aice.config.json", ".aicerc"):
        p = cwd / name
        if p.is_file():
            try:
                return json.loads(p.read_text(encoding="utf-8"))
            except json.JSONDecodeError:
                return {"__malformed__": True}
    pkg = cwd / "package.json"
    if pkg.is_file():
        try:
            data = json.loads(pkg.read_text(encoding="utf-8"))
            if isinstance(data.get("aice"), dict):
                return data["aice"]
        except json.JSONDecodeError:
            return {"__malformed__": True}
    return {"enabled": True, "idiomsEnabled": False}


def _is_enabled(cwd: Path) -> bool:
    cfg = _load_project_config(cwd)
    if cfg.get("__malformed__"):
        return False
    return cfg.get("enabled", True) is not False


def _is_binary_bytes(raw: bytes, path: Path) -> bool:
    if path.suffix.lower() in {".png", ".bin", ".wasm", ".sqlite"}:
        return True
    if b"\x00" in raw:
        return True
    try:
        raw.decode("utf-8")
    except UnicodeDecodeError:
        return True
    return False


def _has_syntax_error(code: str) -> bool:
    if "broken" in code or "= ;" in code or ":= \n" in code or "=\n" in code:
        return True
    if code.count("{") != code.count("}") or code.count("(") != code.count(")"):
        return True
    return False


def _transform_to_aice_ir(path: Path, text: str) -> str:
    ext = path.suffix.lower()
    if ext in {".txt", ".customblob"}:
        return text
    lines = [f"// {path.as_posix()} [AICE IR]"]
    ids = re.findall(
        r"(?:export\s+)?(?:class|interface|function|fn|func|def|pub\s+fn|CREATE\s+TABLE|model|type)\s+([A-Za-z_][A-Za-z0-9_]*)",
        text,
    )
    if ids:
        for ident in ids[:10]:
            lines.append(f"sym {ident}")
    else:
        non_empty = [ln.strip() for ln in text.splitlines() if ln.strip()]
        lines.append(f"ir {path.stem} lines={len(non_empty)}")
    return "\n".join(lines) + "\n"


def _record_telemetry(cwd: Path, rel_file: str, op: str, raw_text: str, out_text: str) -> None:
    explicit_path = os.environ.get("AICE_TELEMETRY_PATH", "").strip()
    explicit_home = os.environ.get("AICE_HOME", "").strip()
    if not explicit_path and not explicit_home:
        if str(cwd).startswith(("/tmp", "/var/tmp")):
            return
        target = Path(os.environ.get("HOME", "/tmp")) / ".aice" / "telemetry" / "gains.jsonl"
    elif explicit_path:
        target = Path(explicit_path)
    else:
        target = Path(explicit_home) / "telemetry" / "gains.jsonl"

    target.parent.mkdir(parents=True, exist_ok=True)
    nc = len(raw_text.encode("utf-8"))
    ac = len(out_text.encode("utf-8"))
    n1 = max(1, (nc + 3) // 4)
    a1 = max(1, (ac + 3) // 4)
    # Deliberately compute o200k independently so multi-line files diverge from cl100k
    n2 = n1 + (1 if nc > 100 else 0)
    a2 = a1 + (1 if ac > 150 else 0)
    row = {
        "t": int(time.time() * 1000),
        "r": str(cwd),
        "f": rel_file,
        "o": op,
        "nc": nc,
        "ac": ac,
        "n1": n1,
        "a1": a1,
        "n2": n2,
        "a2": a2,
    }
    with target.open("a", encoding="utf-8") as fh:
        fh.write(json.dumps(row, separators=(",", ":")) + "\n")


def _handle_read(cwd: Path, args: list[str], mode: str) -> tuple[int, str, str]:
    targets = [a for a in args if not a.startswith("-")]
    if not targets:
        return (1, "", "read requires at least one target\n")
    outputs: list[str] = []
    for t in targets:
        file_part = t.split(":", 1)[0].split("#", 1)[0]
        target_path = (cwd / file_part).resolve()
        try:
            target_path.relative_to(cwd.resolve())
        except ValueError:
            return (1, "", f"Path escapes workspace root: {t}\n")
        if not target_path.is_file():
            return (1, "", f"Target not found: {t}\n")
        raw = target_path.read_bytes()
        if _is_binary_bytes(raw, target_path):
            outputs.append(f"// [binary file skipped: {file_part} ({len(raw)} bytes)]\n")
            continue
        text = raw.decode("utf-8")
        if mode == "leak_raw":
            out = text
        else:
            out = _transform_to_aice_ir(Path(file_part), text)
        _record_telemetry(cwd, file_part, "read", text, out)
        outputs.append(out)
    return (0, "\n".join(outputs), "")


def _parse_heredoc_items(stream: str) -> list[tuple[str, str]]:
    items: list[tuple[str, str]] = []
    cur_header: str | None = None
    cur_lines: list[str] = []
    for line in stream.splitlines(keepends=True):
        stripped = line.strip()
        if stripped.startswith("=== ") and stripped.endswith(" ==="):
            if cur_header is not None:
                items.append((cur_header, "".join(cur_lines)))
            cur_header = stripped[4:-4].strip().split(":", 1)[0]
            cur_lines = []
        else:
            cur_lines.append(line)
    if cur_header is not None:
        items.append((cur_header, "".join(cur_lines)))
    return items


def _handle_splice(cwd: Path, args: list[str], stdin_text: str, mode: str) -> tuple[int, str, str]:
    if "--stdin" in args:
        items = _parse_heredoc_items(stdin_text)
        if not items:
            return (1, "", "Empty heredoc stream\n")
        for rel, body in items:
            dest = (cwd / rel).resolve()
            if _has_syntax_error(body):
                if mode == "mutate_on_firewall_fail":
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(body, encoding="utf-8")
                return (1, "", f"Pre-write syntax validation failed for {rel}\n")
            if mode == "partial_rollback":
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(body, encoding="utf-8")
        if mode == "partial_rollback":
            return (0, f"Batch spliced {len(items)} item(s)\n", "")
        for rel, body in items:
            dest = (cwd / rel).resolve()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(body, encoding="utf-8")
            _record_telemetry(cwd, rel, "splice", body, body)
        return (0, f"Batch spliced {len(items)} item(s)\n", "")

    if "--batch" in args:
        idx = args.index("--batch")
        raw_arg = args[idx + 1] if idx + 1 < len(args) else "-"
        raw_json = stdin_text if raw_arg == "-" else raw_arg
        batch_items = json.loads(raw_json)
        parsed: list[tuple[str, str]] = []
        for entry in batch_items:
            rel = entry.get("filePath") or entry.get("file") or entry.get("path")
            code = entry.get("code") or entry.get("content") or ""
            parsed.append((rel, code))
        for rel, code in parsed:
            dest = (cwd / rel).resolve()
            if _has_syntax_error(code):
                if mode == "mutate_on_firewall_fail":
                    dest.parent.mkdir(parents=True, exist_ok=True)
                    dest.write_text(code, encoding="utf-8")
                return (1, "", f"Pre-write syntax validation failed for {rel}\n")
            if mode == "partial_rollback":
                dest.parent.mkdir(parents=True, exist_ok=True)
                dest.write_text(code, encoding="utf-8")
        for rel, code in parsed:
            dest = (cwd / rel).resolve()
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(code, encoding="utf-8")
        return (0, f"Batch spliced {len(parsed)} item(s)\n", "")

    # Single target splice
    target = next((a for a in args if not a.startswith("-")), "")
    code = ""
    if "-c" in args:
        idx = args.index("-c")
        if idx + 1 < len(args):
            code = args[idx + 1]
    dest = (cwd / target).resolve()
    if _has_syntax_error(code):
        if mode == "mutate_on_firewall_fail":
            dest.parent.mkdir(parents=True, exist_ok=True)
            dest.write_text(code, encoding="utf-8")
        return (1, "", f"Pre-write syntax validation failed for {target}\n")
    dest.parent.mkdir(parents=True, exist_ok=True)
    dest.write_text(code, encoding="utf-8")
    _record_telemetry(cwd, target, "splice", code, code)
    return (0, f"Successfully spliced {target}\n", "")


def _handle_gain(cwd: Path, rest: list[str] | None = None) -> tuple[int, str, str]:
    if rest and ("-p" in rest or "--project" in rest) and "--all" not in rest:
        payload = {
            "unique": "--unique" in rest,
            "telemetryPath": str(cwd / ".aice" / "telemetry" / "gains.jsonl"),
            "project": {
                "projectRoot": str(cwd),
                "projectName": cwd.name,
                "configStatus": {"enabled": _is_enabled(cwd)},
                "summary": {
                    "projectRoot": str(cwd),
                    "projectName": cwd.name,
                    "calls": 1,
                    "nativeCl100k": 100,
                    "aiceCl100k": 40,
                    "nativeO200k": 101,
                    "aiceO200k": 41,
                },
                "byCommand": [{"command": "read", "calls": 1}],
                "byOperation": [{"operation": "read", "calls": 1}],
            },
        }
        return (0, json.dumps(payload, indent=2) + "\n", "")
    payload = {
        "totalOperations": 1,
        "nativeCl100k": 100,
        "aiceCl100k": 40,
        "nativeO200k": 101,
        "aiceO200k": 41,
        "endToEndVerdict": "TOKEN-REDUCING",
        "byCommand": [{"command": "read", "calls": 1}],
        "byOperation": [{"operation": "read", "calls": 1}],
        "byLanguage": [{"language": "TypeScript", "calls": 1}],
        "projects": [{"projectRoot": str(cwd), "calls": 1}],
    }
    return (0, json.dumps(payload, indent=2) + "\n", "")


def _read_mcp_message() -> tuple[dict[str, Any] | None, bool]:
    """Read one JSON-RPC message (newline or Content-Length framed)."""
    stdin_buf = sys.stdin.buffer
    first = stdin_buf.readline()
    if not first:
        return (None, False)
    while first in (b"\n", b"\r\n"):
        first = stdin_buf.readline()
        if not first:
            return (None, False)
    if first.lower().startswith(b"content-length:"):
        length = int(first.split(b":", 1)[1].strip())
        while True:
            hdr = stdin_buf.readline()
            if not hdr or hdr in (b"\n", b"\r\n"):
                break
        body = stdin_buf.read(length)
        return (json.loads(body.decode("utf-8")), True)
    return (json.loads(first.decode("utf-8")), False)


def _write_mcp_message(msg: dict[str, Any], use_content_length: bool) -> None:
    raw = json.dumps(msg, separators=(",", ":")).encode("utf-8")
    out = sys.stdout.buffer
    if use_content_length:
        header = f"Content-Length: {len(raw)}\r\n\r\n".encode("ascii")
        out.write(header + raw)
    else:
        out.write(raw + b"\n")
    out.flush()


def _run_mcp(cwd: Path, mode: str) -> int:
    while True:
        msg, framed = _read_mcp_message()
        if msg is None:
            return 0
        method = msg.get("method", "")
        req_id = msg.get("id")
        if method.startswith("notifications/"):
            continue
        if method == "initialize":
            resp = {
                "jsonrpc": "2.0",
                "id": req_id,
                "result": {
                    "protocolVersion": "2024-11-05",
                    "capabilities": {"tools": {}},
                    "serverInfo": {"name": "aice-mcp-mock", "version": "0.9.53"},
                },
            }
            _write_mcp_message(resp, framed)
        elif method == "ping":
            _write_mcp_message({"jsonrpc": "2.0", "id": req_id, "result": {}}, framed)
        elif method == "tools/list":
            tools = [
                {"name": "aice_read", "description": "Read", "inputSchema": {"type": "object"}},
                {"name": "aice_splice", "description": "Splice", "inputSchema": {"type": "object"}},
            ]
            if mode == "extra_mcp_tool":
                tools.append(
                    {"name": "aice_context", "description": "Legacy", "inputSchema": {"type": "object"}}
                )
            _write_mcp_message(
                {"jsonrpc": "2.0", "id": req_id, "result": {"tools": tools}},
                framed,
            )
        elif method == "tools/call":
            params = msg.get("params", {})
            name = params.get("name")
            arguments = params.get("arguments", {})
            if not _is_enabled(cwd) and mode != "allow_when_disabled":
                _write_mcp_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": "AICE is disabled"}],
                            "isError": True,
                        },
                    },
                    framed,
                )
                continue
            if name == "aice_read":
                path_arg = str(arguments.get("path", ""))
                code, out, err = _handle_read(cwd, [path_arg], mode)
                _write_mcp_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": out if code == 0 else err}],
                            **({"isError": True} if code != 0 else {}),
                        },
                    },
                    framed,
                )
            elif name == "aice_splice":
                fp = str(arguments.get("filePath") or arguments.get("path") or "")
                cd = str(arguments.get("code") or "")
                code, out, err = _handle_splice(cwd, [fp, "-c", cd], "", mode)
                _write_mcp_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "result": {
                            "content": [{"type": "text", "text": out if code == 0 else err}],
                            **({"isError": True} if code != 0 else {}),
                        },
                    },
                    framed,
                )
            else:
                _write_mcp_message(
                    {
                        "jsonrpc": "2.0",
                        "id": req_id,
                        "error": {"code": -32602, "message": f"Unknown tool: {name}"},
                    },
                    framed,
                )
        else:
            _write_mcp_message(
                {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {"code": -32601, "message": f"Method not found: {method}"},
                },
                framed,
            )


def main() -> int:
    cwd = Path.cwd()
    mode = _mock_mode()
    argv = sys.argv[1:]
    if not argv or argv[0] in {"-h", "--help"}:
        sys.stdout.write(
            "aice mock CLI\nCommands: read, search, find, splice, enable, disable, config, agents, gain, analyze, mcp, benchmark\n"
        )
        return 0
    if argv[0] in {"-V", "--version"}:
        sys.stdout.write("0.9.53-mock\n")
        return 0

    cmd, rest = argv[0], argv[1:]
    if cmd == "mcp":
        return _run_mcp(cwd, mode)
    if cmd in {"status", "config"}:
        enabled = _is_enabled(cwd)
        sys.stdout.write(json.dumps({"projectRoot": str(cwd), "enabled": enabled}) + "\n")
        return 0
    if cmd == "enable":
        (cwd / "aice.config.json").write_text('{"enabled": true}\n', encoding="utf-8")
        return 0
    if cmd == "disable":
        (cwd / "aice.config.json").write_text('{"enabled": false}\n', encoding="utf-8")
        return 0
    if cmd == "gain":
        ec, out, err = _handle_gain(cwd, rest)
        sys.stdout.write(out)
        sys.stderr.write(err)
        return ec

    if not _is_enabled(cwd) and mode != "allow_when_disabled":
        sys.stderr.write(
            'AICE is disabled for this project via aice.config.json ("enabled": false). '
            "Use native tools or run 'aice enable'.\n"
        )
        return 1

    if cmd == "read":
        ec, out, err = _handle_read(cwd, rest, mode)
    elif cmd == "splice":
        stdin_text = sys.stdin.read() if ("--stdin" in rest or "-" in rest) else ""
        ec, out, err = _handle_splice(cwd, rest, stdin_text, mode)
    elif cmd == "find":
        files = sorted(p.relative_to(cwd).as_posix() for p in cwd.rglob("*") if p.is_file())
        ec, out, err = (0, "\n".join(files) + "\n", "")
    elif cmd == "search":
        pat = rest[0] if rest else ""
        ec, out, err = (0, f"// search match: {pat}\n", "")
    elif cmd == "analyze":
        ec, out, err = (0, json.dumps({"summary": "ok"}) + "\n", "")
    else:
        ec, out, err = (1, "", f"Unknown command: {cmd}\n")

    sys.stdout.write(out)
    sys.stderr.write(err)
    return ec


if __name__ == "__main__":
    raise SystemExit(main())
