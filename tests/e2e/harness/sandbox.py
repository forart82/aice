"""Ephemeral isolated test sandbox with fake HOME, outside dir, and disk snapshotting."""

from __future__ import annotations

import json
import os
import shutil
import tempfile
import uuid
from pathlib import Path
from typing import Any, Literal

from .config import FIXTURES_DIR

Area = Literal["ws", "home", "outside"]

CONFIG_ALIASES: dict[str, str] = {
    "enabled": "enabled.aice.config.json",
    "disabled": "disabled.aice.config.json",
    "idioms": "idioms_preserved.aice.config.json",
    "idioms_preserved": "idioms_preserved.aice.config.json",
    "allowed_roots": "allowed_roots.aice.config.json",
    "legacy": "legacy.aicerc",
    "legacy_aicerc": "legacy.aicerc",
    "package": "package_aice.json",
    "package_aice": "package_aice.json",
    "jsonc": "jsonc_comments.aice.config.json",
    "malformed": "malformed.aice.config.json",
}


class Sandbox:
    """Ephemeral filesystem and environment sandbox for a single E2E test case."""

    def __init__(
        self,
        *,
        suppress_tmp_telemetry: bool = False,
        prefix: str = "aice-e2e-",
        env_overrides: dict[str, str | None] | None = None,
    ) -> None:
        self._temp_dir = tempfile.TemporaryDirectory(prefix=prefix)
        self.base_dir: Path = Path(self._temp_dir.name).resolve()
        self.ws: Path = self.base_dir / "ws"
        self.home: Path = self.base_dir / "home"
        self.outside: Path = self.base_dir / "outside"
        self.ws.mkdir(parents=True, exist_ok=True)
        self.home.mkdir(parents=True, exist_ok=True)
        self.outside.mkdir(parents=True, exist_ok=True)

        self.aice_home: Path = self.home / ".aice"
        self.telemetry_path: Path = self.aice_home / "telemetry" / "gains.jsonl"
        self.telemetry_errors_path: Path = self.aice_home / "telemetry" / "errors.jsonl"
        self.budget_state_file: Path = (
            self.aice_home / "run" / "cli-invocation-budget.json"
        )
        self.suppress_tmp_telemetry = suppress_tmp_telemetry
        self.invocation_key = f"e2e-{uuid.uuid4().hex[:12]}"
        self._env_overrides: dict[str, str | None] = dict(env_overrides or {})
        self._closed = False

    def __enter__(self) -> Sandbox:
        return self

    def __exit__(self, exc_type: Any, exc_val: Any, exc_tb: Any) -> None:
        self.cleanup()

    def cleanup(self) -> None:
        """Delete the ephemeral sandbox directory tree safely."""
        if not self._closed:
            self._temp_dir.cleanup()
            self._closed = True

    def area_root(self, area: Area = "ws") -> Path:
        if area == "ws":
            return self.ws
        if area == "home":
            return self.home
        if area == "outside":
            return self.outside
        raise ValueError(f"Unknown sandbox area: {area!r}")

    def path(self, rel_path: str | Path, *, area: Area = "ws") -> Path:
        return self.area_root(area) / Path(rel_path)

    def build_env(
        self, overrides: dict[str, str | None] | None = None
    ) -> dict[str, str]:
        """Construct isolated subprocess environment variables."""
        env = os.environ.copy()
        env["HOME"] = str(self.home)
        env["NO_COLOR"] = "1"
        env["FORCE_COLOR"] = "0"
        env["CI"] = "1"
        env["AICE_CLI_INTERACTIVE"] = "0"
        env["AICE_CLI_INVOCATION_KEY"] = self.invocation_key
        env["AICE_CLI_BUDGET_STATE_FILE"] = str(self.budget_state_file)
        env["AICE_AGENT"] = "e2e-test"

        if self.suppress_tmp_telemetry:
            for key in (
                "AICE_HOME",
                "AICE_TELEMETRY_PATH",
                "AICE_TELEMETRY_DIR",
                "AICE_TELEMETRY_ERRORS_PATH",
            ):
                env.pop(key, None)
        else:
            self.telemetry_path.parent.mkdir(parents=True, exist_ok=True)
            self.budget_state_file.parent.mkdir(parents=True, exist_ok=True)
            env["AICE_HOME"] = str(self.aice_home)
            env["AICE_TELEMETRY_PATH"] = str(self.telemetry_path)
            env["AICE_TELEMETRY_ERRORS_PATH"] = str(self.telemetry_errors_path)

        for layer in (self._env_overrides, overrides or {}):
            for key, val in layer.items():
                if val is None or val == "__UNSET__":
                    env.pop(key, None)
                else:
                    env[key] = str(val)
        return env

    def seed_file(
        self,
        rel_path: str | Path,
        content: str | bytes,
        *,
        area: Area = "ws",
    ) -> Path:
        target = self.path(rel_path, area=area)
        target.parent.mkdir(parents=True, exist_ok=True)
        if isinstance(content, bytes):
            target.write_bytes(content)
        else:
            target.write_text(content, encoding="utf-8")
        return target

    def seed_fixture(
        self,
        fixture_rel_path: str | Path,
        dest_rel_path: str | Path | None = None,
        *,
        area: Area = "ws",
    ) -> Path:
        src = FIXTURES_DIR / Path(fixture_rel_path)
        if not src.is_file():
            raise FileNotFoundError(f"Fixture file not found: {src}")
        dest_rel = dest_rel_path if dest_rel_path is not None else fixture_rel_path
        target = self.path(dest_rel, area=area)
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copyfile(src, target)
        return target

    def seed_fixture_dir(
        self,
        fixture_dir_rel: str | Path,
        dest_dir_rel: str | Path = ".",
        *,
        area: Area = "ws",
    ) -> Path:
        src_dir = FIXTURES_DIR / Path(fixture_dir_rel)
        if not src_dir.is_dir():
            raise FileNotFoundError(f"Fixture directory not found: {src_dir}")
        dest_root = self.path(dest_dir_rel, area=area)
        dest_root.mkdir(parents=True, exist_ok=True)
        for item in src_dir.rglob("*"):
            if item.is_file():
                rel = item.relative_to(src_dir)
                out = dest_root / rel
                out.parent.mkdir(parents=True, exist_ok=True)
                shutil.copyfile(item, out)
        return dest_root

    def seed_config(
        self,
        config_source: str | dict[str, Any],
        *,
        filename: str = "aice.config.json",
        area: Area = "ws",
    ) -> Path:
        if isinstance(config_source, dict):
            return self.seed_file(
                filename, json.dumps(config_source, indent=2) + "\n", area=area
            )
        mapped = CONFIG_ALIASES.get(config_source, config_source)
        candidate = FIXTURES_DIR / "configs" / mapped
        if not candidate.is_file():
            raise FileNotFoundError(f"Config fixture not found: {candidate}")
        dest_name = filename
        if filename == "aice.config.json" and mapped == "legacy.aicerc":
            dest_name = ".aicerc"
        elif filename == "aice.config.json" and mapped == "package_aice.json":
            dest_name = "package.json"
        return self.seed_fixture(Path("configs") / mapped, dest_name, area=area)

    def make_symlink(
        self,
        link_rel_path: str | Path,
        target: str | Path,
        *,
        area: Area = "ws",
    ) -> Path:
        link_path = self.path(link_rel_path, area=area)
        link_path.parent.mkdir(parents=True, exist_ok=True)
        if link_path.exists() or link_path.is_symlink():
            link_path.unlink()
        os.symlink(str(target), link_path)
        return link_path

    def read_bytes(self, rel_path: str | Path, *, area: Area = "ws") -> bytes:
        return self.path(rel_path, area=area).read_bytes()

    def read_text(self, rel_path: str | Path, *, area: Area = "ws") -> str:
        return self.path(rel_path, area=area).read_text(encoding="utf-8")

    def exists(self, rel_path: str | Path, *, area: Area = "ws") -> bool:
        p = self.path(rel_path, area=area)
        return p.exists() or p.is_symlink()

    def snapshot_tree(self, root: Path | None = None) -> dict[str, bytes]:
        """Capture exact raw bytes (or symlink/dir marker) for every entry under root."""
        base = root if root is not None else self.ws
        snap: dict[str, bytes] = {}
        if not base.exists():
            return snap
        for dirpath, dirnames, filenames in os.walk(base, followlinks=False):
            dirnames.sort()
            filenames.sort()
            dp = Path(dirpath)
            for name in [*dirnames, *filenames]:
                full = dp / name
                rel = full.relative_to(base).as_posix()
                if full.is_symlink():
                    snap[rel] = b"__SYMLINK__->" + os.readlink(full).encode("utf-8")
                elif full.is_dir():
                    snap[f"__DIR__/{rel}"] = b"__DIR__"
                elif full.is_file():
                    snap[rel] = full.read_bytes()
        return snap

    def list_dirs(self, root: Path | None = None) -> set[str]:
        base = root if root is not None else self.ws
        dirs: set[str] = set()
        if not base.exists():
            return dirs
        for dirpath, dirnames, _ in os.walk(base, followlinks=False):
            dp = Path(dirpath)
            for d in dirnames:
                full = dp / d
                if not full.is_symlink():
                    dirs.add(full.relative_to(base).as_posix())
        return dirs

    def read_telemetry_rows(self) -> list[dict[str, Any]]:
        if not self.telemetry_path.is_file():
            return []
        rows: list[dict[str, Any]] = []
        for raw_line in self.telemetry_path.read_text(encoding="utf-8").splitlines():
            line = raw_line.strip()
            if line:
                rows.append(json.loads(line))
        return rows
