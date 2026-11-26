"""Single opaque-box CLI and MCP stdio JSON-RPC 2.0 adapter for AICE."""

from __future__ import annotations

import json
import os
import selectors
import signal
import subprocess
import time
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Literal

from .config import resolve_aice_bin, resolve_timeout
from .sandbox import Sandbox


@dataclass(frozen=True)
class CliResult:
    exit_code: int
    stdout: str
    stderr: str
    stdout_bytes: bytes
    stderr_bytes: bytes
    duration_ms: float
    stdout_json: Any | None
    argv: list[str]


@dataclass(frozen=True)
class McpSessionResult:
    exit_code: int
    responses: list[dict[str, Any]]
    stderr: str
    duration_ms: float


def _parse_mcp_stream(
    buffer: bytearray, framing: Literal["newline", "content-length"]
) -> list[dict[str, Any]]:
    """Extract all complete JSON-RPC messages from buffer, mutating buffer in place."""
    messages: list[dict[str, Any]] = []
    while buffer:
        if framing == "content-length" or buffer.startswith(b"Content-Length:"):
            header_end = buffer.find(b"\r\n\r\n")
            sep_len = 4
            if header_end == -1:
                header_end = buffer.find(b"\n\n")
                sep_len = 2
            if header_end == -1:
                break
            header_text = bytes(buffer[:header_end]).decode("ascii", errors="replace")
            content_length: int | None = None
            for line in header_text.splitlines():
                if line.lower().startswith("content-length:"):
                    content_length = int(line.split(":", 1)[1].strip())
                    break
            if content_length is None:
                raise ValueError(f"Missing Content-Length in MCP header: {header_text!r}")
            body_start = header_end + sep_len
            body_end = body_start + content_length
            if len(buffer) < body_end:
                break
            payload = bytes(buffer[body_start:body_end]).decode("utf-8")
            del buffer[:body_end]
            messages.append(json.loads(payload))
        else:
            nl = buffer.find(b"\n")
            if nl == -1:
                break
            raw_line = bytes(buffer[:nl]).strip()
            del buffer[: nl + 1]
            if not raw_line:
                continue
            messages.append(json.loads(raw_line.decode("utf-8")))
    return messages


class AiceAdapter:
    """Translates semantic E2E operations into CLI args or MCP JSON-RPC 2.0 requests."""

    def __init__(
        self,
        aice_bin: str | Path | None = None,
        *,
        default_timeout: float | None = None,
    ) -> None:
        self.aice_bin: Path = resolve_aice_bin(aice_bin)
        self.default_timeout: float = resolve_timeout(default_timeout)

    def run_raw(
        self,
        sandbox: Sandbox,
        args: list[str],
        *,
        stdin: str | bytes | None = None,
        env_overrides: dict[str, str | None] | None = None,
        expect_json: bool = False,
        timeout: float | None = None,
        cwd: Path | None = None,
    ) -> CliResult:
        argv = [str(self.aice_bin), *args]
        stdin_bytes: bytes | None = None
        if isinstance(stdin, str):
            stdin_bytes = stdin.encode("utf-8")
        elif isinstance(stdin, bytes):
            stdin_bytes = stdin

        effective_timeout = timeout if timeout is not None else self.default_timeout
        started = time.monotonic()
        try:
            proc = subprocess.run(
                argv,
                cwd=str(cwd or sandbox.ws),
                env=sandbox.build_env(env_overrides),
                input=stdin_bytes,
                capture_output=True,
                timeout=effective_timeout,
                check=False,
            )
        except subprocess.TimeoutExpired as exc:
            raise TimeoutError(
                f"AICE command timed out after {effective_timeout}s: {argv}"
            ) from exc

        dur_ms = round((time.monotonic() - started) * 1000.0, 2)
        stdout_text = proc.stdout.decode("utf-8", errors="replace")
        stderr_text = proc.stderr.decode("utf-8", errors="replace")
        parsed_json: Any | None = None
        if expect_json:
            try:
                parsed_json = json.loads(stdout_text)
            except json.JSONDecodeError:
                parsed_json = None

        return CliResult(
            exit_code=proc.returncode,
            stdout=stdout_text,
            stderr=stderr_text,
            stdout_bytes=proc.stdout,
            stderr_bytes=proc.stderr,
            duration_ms=dur_ms,
            stdout_json=parsed_json,
            argv=argv,
        )

    def read_file(
        self,
        sandbox: Sandbox,
        target: str,
        *,
        selector: str | None = None,
        selector_sep: str = ":",
        selector_as_flag: bool = False,
        outline: bool = False,
        full: bool = False,
        max_tokens: int | None = None,
        deps: bool | None = None,
        callers: bool | None = None,
        json_mode: bool = False,
        stats: bool = False,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["read"]
        if selector is not None and not selector_as_flag:
            args.append(f"{target}{selector_sep}{selector}")
        else:
            args.append(target)
            if selector is not None:
                args.extend(["-s", selector])

        if outline:
            args.append("--outline")
        if full:
            args.append("--full")
        if max_tokens is not None:
            args.extend(["--max-tokens", str(max_tokens)])
        if deps is True:
            args.append("--deps")
        elif deps is False:
            args.append("--no-deps")
        if callers is True:
            args.append("--callers")
        elif callers is False:
            args.append("--no-callers")
        if json_mode:
            args.append("--json")
        if stats:
            args.append("--stats")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def batch_read(
        self,
        sandbox: Sandbox,
        targets: list[str],
        *,
        full: bool = False,
        max_tokens: int | None = None,
        deps: bool | None = None,
        callers: bool | None = None,
        json_mode: bool = False,
        stats: bool = False,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["read", *targets]
        if full:
            args.append("--full")
        if max_tokens is not None:
            args.extend(["--max-tokens", str(max_tokens)])
        if deps is True:
            args.append("--deps")
        elif deps is False:
            args.append("--no-deps")
        if callers is True:
            args.append("--callers")
        elif callers is False:
            args.append("--no-callers")
        if json_mode:
            args.append("--json")
        if stats:
            args.append("--stats")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def find(
        self,
        sandbox: Sandbox,
        pattern: str | None = None,
        targets: list[str] | None = None,
        *,
        max_depth: int | None = None,
        search: str | None = None,
        json_mode: bool = False,
        full: bool = False,
        max_tokens: int | None = None,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["find"]
        if pattern is not None:
            args.append(pattern)
        if targets:
            args.extend(targets)
        if max_depth is not None:
            args.extend(["--max-depth", str(max_depth)])
        if search is not None:
            args.extend(["--search", search])
        if full:
            args.append("--full")
        if max_tokens is not None:
            args.extend(["--max-tokens", str(max_tokens)])
        if json_mode:
            args.append("--json")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def search(
        self,
        sandbox: Sandbox,
        pattern: str,
        targets: list[str] | None = None,
        *,
        context_lines: int | None = None,
        files_only: bool = False,
        json_mode: bool = False,
        full: bool = False,
        max_tokens: int | None = None,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["search", pattern]
        if targets:
            args.extend(targets)
        if context_lines is not None:
            args.extend(["-C", str(context_lines)])
        if files_only:
            args.append("-l")
        if full:
            args.append("--full")
        if max_tokens is not None:
            args.extend(["--max-tokens", str(max_tokens)])
        if json_mode:
            args.append("--json")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def splice_single(
        self,
        sandbox: Sandbox,
        path: str,
        *,
        symbol: str | None = None,
        code: str | None = None,
        body: str | None = None,
        from_file: str | None = None,
        delete: bool = False,
        insert_after: str | None = None,
        insert_before: str | None = None,
        create: bool = False,
        overwrite: bool = False,
        force: bool = False,
        preserve_docs: bool | None = None,
        dry_run: bool = False,
        diff: bool = False,
        json_mode: bool = False,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["splice", path]
        if symbol is not None:
            args.extend(["-s", symbol])
        if code is not None:
            args.extend(["-c", code])
        if body is not None:
            args.extend(["--body", body])
        if from_file is not None:
            args.extend(["--from", from_file])
        if delete:
            args.append("--delete")
        if insert_after is not None:
            args.extend(["--insert-after", insert_after])
        if insert_before is not None:
            args.extend(["--insert-before", insert_before])
        if create:
            args.append("--create")
        if overwrite:
            args.append("--overwrite")
        if force:
            args.append("--force")
        if preserve_docs is False:
            args.append("--no-preserve-docs")
        if dry_run:
            args.append("--dry-run")
        if diff:
            args.append("--diff")
        if json_mode:
            args.append("--json")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def splice_heredoc(
        self,
        sandbox: Sandbox,
        heredoc_stream: str,
        *,
        path: str | None = None,
        dry_run: bool = False,
        diff: bool = False,
        json_mode: bool = False,
        overwrite: bool = False,
        force: bool = False,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        args: list[str] = ["splice"]
        if path is not None:
            args.append(path)
        args.append("--stdin")
        if dry_run:
            args.append("--dry-run")
        if diff:
            args.append("--diff")
        if overwrite:
            args.append("--overwrite")
        if force:
            args.append("--force")
        if json_mode:
            args.append("--json")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            stdin=heredoc_stream,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def splice_batch_json(
        self,
        sandbox: Sandbox,
        items: list[dict[str, Any]] | str,
        *,
        via_stdin: bool = False,
        edits_for_file: str | None = None,
        dry_run: bool = False,
        json_mode: bool = False,
        overwrite: bool = False,
        force: bool = False,
        extra_flags: list[str] | None = None,
        env_overrides: dict[str, str | None] | None = None,
        timeout: float | None = None,
    ) -> CliResult:
        payload = items if isinstance(items, str) else json.dumps(items)
        args: list[str] = ["splice"]
        stdin_data: str | None = None
        if edits_for_file is not None:
            args.append(edits_for_file)
            if via_stdin:
                args.extend(["--edits", "-"])
                stdin_data = payload
            else:
                args.extend(["--edits", payload])
        else:
            if via_stdin:
                args.extend(["--batch", "-"])
                stdin_data = payload
            else:
                args.extend(["--batch", payload])

        if dry_run:
            args.append("--dry-run")
        if overwrite:
            args.append("--overwrite")
        if force:
            args.append("--force")
        if json_mode:
            args.append("--json")
        if extra_flags:
            args.extend(extra_flags)

        return self.run_raw(
            sandbox,
            args,
            stdin=stdin_data,
            env_overrides=env_overrides,
            expect_json=json_mode,
            timeout=timeout,
        )

    def enable(
        self,
        sandbox: Sandbox,
        dir_arg: str = ".",
        *,
        force: bool = False,
        json_mode: bool = False,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["enable", dir_arg]
        if force:
            args.append("--force")
        if json_mode:
            args.append("--json")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def disable(
        self,
        sandbox: Sandbox,
        dir_arg: str = ".",
        *,
        json_mode: bool = False,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["disable", dir_arg]
        if json_mode:
            args.append("--json")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def config(
        self,
        sandbox: Sandbox,
        dir_arg: str = ".",
        *,
        enable: bool = False,
        disable: bool = False,
        force: bool = False,
        idioms_on: bool = False,
        idioms_off: bool = False,
        json_mode: bool = False,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["config", dir_arg]
        if enable:
            args.append("--enable")
        if disable:
            args.append("--disable")
        if force:
            args.append("--force")
        if idioms_on:
            args.append("--idioms-on")
        if idioms_off:
            args.append("--idioms-off")
        if json_mode:
            args.append("--json")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def status(
        self,
        sandbox: Sandbox,
        dir_arg: str = ".",
        *,
        json_mode: bool = True,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["status", dir_arg]
        if json_mode:
            args.append("--json")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def gain(
        self,
        sandbox: Sandbox,
        project: str | None = None,
        *,
        json_mode: bool = True,
        unique: bool = False,
        reset: bool = False,
        yes: bool = False,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["gain"]
        if project is not None:
            args.append(project)
        if json_mode:
            args.append("--json")
        if unique:
            args.append("--unique")
        if reset:
            args.append("--reset")
        if yes:
            args.append("--yes")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def analyze(
        self,
        sandbox: Sandbox,
        project: str | None = None,
        *,
        transcripts_dir: str | None = None,
        json_mode: bool = True,
        env_overrides: dict[str, str | None] | None = None,
    ) -> CliResult:
        args = ["analyze"]
        if project is not None:
            args.append(project)
        if transcripts_dir is not None:
            args.extend(["--transcripts-dir", transcripts_dir])
        if json_mode:
            args.append("--json")
        return self.run_raw(
            sandbox, args, env_overrides=env_overrides, expect_json=json_mode
        )

    def help(self, sandbox: Sandbox, subcommand: str | None = None) -> CliResult:
        args = [subcommand, "--help"] if subcommand else ["--help"]
        return self.run_raw(sandbox, args)

    def version(self, sandbox: Sandbox) -> CliResult:
        return self.run_raw(sandbox, ["--version"])

    def mcp_session(
        self,
        sandbox: Sandbox,
        requests: list[dict[str, Any]],
        *,
        framing: Literal["newline", "content-length"] = "newline",
        timeout: float = 15.0,
        env_overrides: dict[str, str | None] | None = None,
    ) -> McpSessionResult:
        """Execute an MCP JSON-RPC 2.0 stdio session and return ordered responses."""
        prepared: list[dict[str, Any]] = []
        expected_responses = 0
        next_id = 1
        for req in requests:
            msg = dict(req)
            msg.setdefault("jsonrpc", "2.0")
            method = str(msg.get("method", ""))
            is_notification = method.startswith("notifications/")
            if not is_notification and "id" not in msg:
                msg["id"] = next_id
                next_id += 1
            if "id" in msg:
                expected_responses += 1
            prepared.append(msg)

        wire_chunks: list[bytes] = []
        for msg in prepared:
            body = json.dumps(msg, separators=(",", ":")).encode("utf-8")
            if framing == "content-length":
                header = f"Content-Length: {len(body)}\r\n\r\n".encode("ascii")
                wire_chunks.append(header + body)
            else:
                wire_chunks.append(body + b"\n")
        payload_bytes = b"".join(wire_chunks)

        started = time.monotonic()
        proc = subprocess.Popen(
            [str(self.aice_bin), "mcp"],
            cwd=str(sandbox.ws),
            env=sandbox.build_env(env_overrides),
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.PIPE,
        )
        assert proc.stdin is not None
        assert proc.stdout is not None
        assert proc.stderr is not None

        responses: list[dict[str, Any]] = []
        stdout_buf = bytearray()
        stderr_buf = bytearray()
        timed_out = False
        sel: selectors.DefaultSelector | None = None

        try:
            proc.stdin.write(payload_bytes)
            proc.stdin.flush()

            sel = selectors.DefaultSelector()
            os.set_blocking(proc.stdout.fileno(), False)
            os.set_blocking(proc.stderr.fileno(), False)
            sel.register(proc.stdout, selectors.EVENT_READ, "stdout")
            sel.register(proc.stderr, selectors.EVENT_READ, "stderr")

            deadline = time.monotonic() + timeout
            stdin_closed = False
            if expected_responses == 0:
                proc.stdin.close()
                stdin_closed = True

            while sel.get_map():
                remaining = deadline - time.monotonic()
                if remaining <= 0:
                    timed_out = True
                    break
                events = sel.select(timeout=min(0.1, remaining))
                for key, _ in events:
                    chunk = os.read(key.fileobj.fileno(), 65536)
                    if not chunk:
                        sel.unregister(key.fileobj)
                        continue
                    if key.data == "stdout":
                        stdout_buf.extend(chunk)
                        parsed = _parse_mcp_stream(stdout_buf, framing)
                        responses.extend(parsed)
                        if (
                            not stdin_closed
                            and len(responses) >= expected_responses
                        ):
                            proc.stdin.close()
                            stdin_closed = True
                    else:
                        stderr_buf.extend(chunk)

                if stdin_closed and proc.poll() is not None and not sel.get_map():
                    break

            sel.close()
            if not stdin_closed:
                try:
                    proc.stdin.close()
                except OSError:
                    pass

            if timed_out:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=2.0)
                raise TimeoutError(
                    f"MCP session timed out after {timeout}s; "
                    f"received {len(responses)}/{expected_responses} responses. "
                    f"stderr={stderr_buf.decode('utf-8', errors='replace')!r}"
                )

            try:
                proc.wait(timeout=2.0)
            except subprocess.TimeoutExpired:
                proc.send_signal(signal.SIGTERM)
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    proc.kill()
                    proc.wait(timeout=2.0)
        finally:
            if sel is not None:
                try:
                    sel.close()
                except OSError:
                    pass
            if proc.poll() is None:
                try:
                    proc.terminate()
                except OSError:
                    pass
                try:
                    proc.wait(timeout=1.0)
                except subprocess.TimeoutExpired:
                    try:
                        proc.kill()
                    except OSError:
                        pass
                    proc.wait(timeout=2.0)
            for stream in (proc.stdin, proc.stdout, proc.stderr):
                try:
                    if stream and not stream.closed:
                        stream.close()
                except OSError:
                    pass

        dur_ms = round((time.monotonic() - started) * 1000.0, 2)
        return McpSessionResult(
            exit_code=proc.returncode if proc.returncode is not None else -1,
            responses=responses,
            stderr=stderr_buf.decode("utf-8", errors="replace"),
            duration_ms=dur_ms,
        )

    def mcp_call(
        self,
        sandbox: Sandbox,
        tool_name: str,
        arguments: dict[str, Any],
        *,
        init_params: dict[str, Any] | None = None,
        framing: Literal["newline", "content-length"] = "newline",
        timeout: float = 15.0,
        env_overrides: dict[str, str | None] | None = None,
    ) -> tuple[dict[str, Any], McpSessionResult]:
        """Run initialize -> notifications/initialized -> tools/call and return (call_resp, session)."""
        params = init_params or {
            "protocolVersion": "2024-11-05",
            "capabilities": {},
            "clientInfo": {"name": "aice-e2e", "version": "1.0.0"},
        }
        requests: list[dict[str, Any]] = [
            {"method": "initialize", "params": params},
            {"method": "notifications/initialized"},
            {
                "method": "tools/call",
                "params": {"name": tool_name, "arguments": arguments},
            },
        ]
        session = self.mcp_session(
            sandbox,
            requests,
            framing=framing,
            timeout=timeout,
            env_overrides=env_overrides,
        )
        if len(session.responses) < 2:
            raise AssertionError(
                f"Expected at least 2 MCP responses (initialize + tools/call), "
                f"got {len(session.responses)}: {session.responses!r}; stderr={session.stderr!r}"
            )
        return session.responses[-1], session
