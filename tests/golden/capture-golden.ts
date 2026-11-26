/**
 * Wave 0 Deterministic Golden Baseline Capture Script
 *
 * Captures reproducible behavioral snapshots from the repository TypeScript AICE
 * runtime (`bin/aice.ts`, v0.9.53 — NEVER global ~/.local/bin/aice v0.9.52)
 * inside isolated ephemeral temp directories, sanitizing temp paths to `<ROOT>`
 * and `<HOME>`.
 */

import { execSync, spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { getEncoding } from "js-tiktoken";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const REPO_ROOT = path.resolve(__dirname, "../..");
const GOLDEN_DIR = path.resolve(__dirname);
const FIXTURES_DIR = path.join(GOLDEN_DIR, "fixtures");
const CASES_DIR = path.join(GOLDEN_DIR, "cases");
const BIN_AICE_TS = path.join(REPO_ROOT, "bin", "aice.ts");
const LOCAL_TSX = path.join(REPO_ROOT, "node_modules", ".bin", "tsx");
const TSX_CLI = path.join(REPO_ROOT, "node_modules", "tsx", "dist", "cli.mjs");
const TELEMETRY_PATH_VARIANCE_NOTE =
  "Note: observedTs0953 telemetry char/token fields in SPL-11, TEL-01, and B-T2 include the exact temp-path length of os.tmpdir()/aice-golden-XXXXXX/ws before <ROOT> path sanitization (explaining +-1 to 3 token variance across runs).";

const cl100kEnc = getEncoding("cl100k_base");
const o200kEnc = getEncoding("o200k_base");

function countBpe(text: string, encoding: "cl100k_base" | "o200k_base"): number {
  return (encoding === "cl100k_base" ? cl100kEnc : o200kEnc).encode(text).length;
}

type ConfigKind = "none" | "enabled" | "disabled" | "idioms" | "legacy_aicerc";

interface SandboxOptions {
  copySrc?: boolean;
  copyBin?: boolean;
  config?: ConfigKind;
  withIgnoredNoise?: boolean;
  extraFiles?: Record<string, string>;
  useTmpTelemetrySuppression?: boolean;
}

interface Sandbox {
  root: string;
  realRoot: string;
  fakeHome: string;
  telemetryFile: string;
  errorsFile: string;
  budgetFile: string;
  useTmpTelemetrySuppression: boolean;
  cleanup: () => void;
}

interface CliRunResult {
  exitCode: number;
  stdout: string;
  stderr: string;
  stdoutJson?: unknown;
}

interface GoldenCaseRecord {
  id: string;
  description: string;
  fixtureSetup: {
    copySrc: boolean;
    copyBin: boolean;
    config: ConfigKind;
    extraFiles?: string[];
  };
  invocation: {
    kind: "cli" | "cli_sequence" | "mcp_session";
    args?: string[];
    commands?: Array<{ args: string[]; stdin?: string | null }>;
    stdin?: string | null;
    env?: Record<string, string>;
    mcpRequests?: Array<{ method: string; params?: Record<string, unknown> }>;
  };
  observedTs0953: {
    exitCode: number;
    stdout: string;
    stderr: string;
    stdoutJson?: unknown;
    diskFilesAfter?: Record<string, string>;
    extraChecks?: Record<string, unknown>;
  };
  rustParityContract: {
    mode: "exact_json" | "exact_stdout" | "exact_disk_and_exit" | "exit_and_invariants" | "semantic_aice_upgrade";
    exitCode: number;
    requiredInvariants: string[];
    deltaNote: string | null;
  };
}

function copyDirRecursive(src: string, dst: string): void {
  fs.mkdirSync(dst, { recursive: true });
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const dstPath = path.join(dst, entry.name);
    if (entry.isDirectory()) {
      copyDirRecursive(srcPath, dstPath);
    } else {
      fs.copyFileSync(srcPath, dstPath);
    }
  }
}

function createSandbox(opts: SandboxOptions = {}): Sandbox {
  const base = fs.mkdtempSync(path.join(os.tmpdir(), "aice-golden-"));
  const root = path.join(base, "ws");
  const fakeHome = path.join(base, "home");
  fs.mkdirSync(root, { recursive: true });
  fs.mkdirSync(fakeHome, { recursive: true });

  if (opts.copySrc !== false) {
    copyDirRecursive(path.join(FIXTURES_DIR, "src"), path.join(root, "src"));
  }
  if (opts.copyBin) {
    copyDirRecursive(path.join(FIXTURES_DIR, "bin"), path.join(root, "bin"));
  }

  const configKind = opts.config ?? "enabled";
  if (configKind === "enabled") {
    fs.copyFileSync(
      path.join(FIXTURES_DIR, "configs", "enabled.aice.config.json"),
      path.join(root, "aice.config.json"),
    );
  } else if (configKind === "disabled") {
    fs.copyFileSync(
      path.join(FIXTURES_DIR, "configs", "disabled.aice.config.json"),
      path.join(root, "aice.config.json"),
    );
  } else if (configKind === "idioms") {
    fs.copyFileSync(
      path.join(FIXTURES_DIR, "configs", "idioms.aice.config.json"),
      path.join(root, "aice.config.json"),
    );
  } else if (configKind === "legacy_aicerc") {
    fs.copyFileSync(
      path.join(FIXTURES_DIR, "configs", "legacy.aicerc"),
      path.join(root, ".aicerc"),
    );
  }

  if (opts.withIgnoredNoise) {
    fs.mkdirSync(path.join(root, ".git"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n", "utf8");
    fs.mkdirSync(path.join(root, "node_modules", "dummy"), { recursive: true });
    fs.writeFileSync(
      path.join(root, "node_modules", "dummy", "index.js"),
      "export const ignored = true;\n",
      "utf8",
    );
  }

  if (opts.extraFiles) {
    for (const [rel, content] of Object.entries(opts.extraFiles)) {
      const abs = path.join(root, rel);
      fs.mkdirSync(path.dirname(abs), { recursive: true });
      fs.writeFileSync(abs, content, "utf8");
    }
  }

  const realRoot = fs.realpathSync(root);
  const telemetryDir = path.join(fakeHome, ".aice", "telemetry");
  const runDir = path.join(fakeHome, ".aice", "run");
  fs.mkdirSync(telemetryDir, { recursive: true });
  fs.mkdirSync(runDir, { recursive: true });

  return {
    root,
    realRoot,
    fakeHome,
    telemetryFile: path.join(telemetryDir, "gains.jsonl"),
    errorsFile: path.join(telemetryDir, "errors.jsonl"),
    budgetFile: path.join(runDir, "cli-invocation-budget.json"),
    useTmpTelemetrySuppression: Boolean(opts.useTmpTelemetrySuppression),
    cleanup: () => {
      fs.rmSync(base, { recursive: true, force: true });
    },
  };
}

function escapeRegExp(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function sanitizeOutput(raw: string, sb: Sandbox): string {
  let out = raw;
  const pairs: Array<[string, string]> = [
    [sb.realRoot, "<ROOT>"],
    [sb.root, "<ROOT>"],
    [path.dirname(sb.realRoot), "<SANDBOX>"],
    [path.dirname(sb.root), "<SANDBOX>"],
    [sb.fakeHome, "<HOME>"],
    [REPO_ROOT, "<REPO>"],
  ];
  for (const [needle, replacement] of pairs) {
    if (needle.length > 0) {
      out = out.replace(new RegExp(escapeRegExp(needle), "g"), replacement);
    }
  }
  return out.replace(/\r\n/g, "\n");
}

function sanitizeJsonValue(val: unknown, sb: Sandbox): unknown {
  if (typeof val === "string") {
    return sanitizeOutput(val, sb);
  }
  if (Array.isArray(val)) {
    return val.map((item) => sanitizeJsonValue(item, sb));
  }
  if (val !== null && typeof val === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(val as Record<string, unknown>)) {
      out[k] = k === "t" && typeof v === "number" ? "<TIMESTAMP>" : sanitizeJsonValue(v, sb);
    }
    return out;
  }
  return val;
}

function buildSandboxEnv(sb: Sandbox, extraEnv: Record<string, string> = {}): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    HOME: sb.fakeHome,
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    CI: "1",
    AICE_CLI_INTERACTIVE: "0",
    AICE_CLI_INVOCATION_KEY: `golden-${path.basename(path.dirname(sb.root))}`,
    AICE_CLI_BUDGET_STATE_FILE: sb.budgetFile,
    AICE_AGENT: "golden-capture",
  };
  if (sb.useTmpTelemetrySuppression) {
    delete env.AICE_HOME;
    delete env.AICE_TELEMETRY_PATH;
    delete env.AICE_TELEMETRY_DIR;
    delete env.AICE_TELEMETRY_ERRORS_PATH;
  } else {
    env.AICE_HOME = path.join(sb.fakeHome, ".aice");
    env.AICE_TELEMETRY_PATH = sb.telemetryFile;
    env.AICE_TELEMETRY_ERRORS_PATH = sb.errorsFile;
  }
  for (const [k, v] of Object.entries(extraEnv)) {
    if (v === "__UNSET__") {
      delete env[k];
    } else {
      env[k] = v;
    }
  }
  return env;
}

function runAice(
  sb: Sandbox,
  args: string[],
  opts: { stdin?: string; env?: Record<string, string>; expectJson?: boolean; timeoutMs?: number; directNodeTsx?: boolean } = {},
): CliRunResult {
  const useDirectNode = Boolean(opts.directNodeTsx) || (opts.env?.PATH === "" && fs.existsSync(TSX_CLI));
  let spawnExec: string;
  let spawnArgs: string[];
  if (useDirectNode) {
    if (!fs.existsSync(TSX_CLI)) {
      throw new Error(`directNodeTsx requested but missing ${TSX_CLI}`);
    }
    spawnExec = process.execPath;
    spawnArgs = [TSX_CLI, BIN_AICE_TS, ...args];
  } else {
    spawnExec = fs.existsSync(LOCAL_TSX) ? LOCAL_TSX : "npx";
    spawnArgs =
      spawnExec === "npx"
        ? ["tsx", BIN_AICE_TS, ...args]
        : [BIN_AICE_TS, ...args];
  }

  const proc = spawnSync(spawnExec, spawnArgs, {
    cwd: sb.root,
    env: buildSandboxEnv(sb, opts.env),
    input: opts.stdin ?? "",
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    timeout: opts.timeoutMs ?? 30000,
  });

  if (proc.error) {
    throw new Error(`runAice(${args.join(" ")}) failed: ${proc.error.message}`);
  }
  const stdout = sanitizeOutput(proc.stdout ?? "", sb);
  const stderr = sanitizeOutput(proc.stderr ?? "", sb);
  let stdoutJson: unknown;
  if (opts.expectJson) {
    try {
      stdoutJson = sanitizeJsonValue(JSON.parse(proc.stdout ?? ""), sb);
    } catch {
      stdoutJson = undefined;
    }
  }

  return {
    exitCode: proc.status ?? -1,
    stdout,
    stderr,
    ...(stdoutJson !== undefined ? { stdoutJson } : {}),
  };
}

function snapshotDiskFiles(sb: Sandbox, relPaths: string[]): Record<string, string> {
  const result: Record<string, string> = {};
  for (const rel of relPaths) {
    const abs = path.join(sb.root, rel);
    if (!fs.existsSync(abs)) {
      result[rel] = "[ABSENT]";
    } else {
      const buf = fs.readFileSync(abs);
      if (buf.includes(0)) {
        result[rel] = `[BINARY sha256=${createHash("sha256").update(buf).digest("hex")} bytes=${buf.length}]`;
      } else {
        result[rel] = sanitizeOutput(buf.toString("utf8"), sb);
      }
    }
  }
  return result;
}

async function runMcpSession(
  sb: Sandbox,
  requests: Array<{ method: string; params?: Record<string, unknown> }>,
  timeoutMs = 15000,
): Promise<{ responses: unknown[]; stderr: string; exitCode: number }> {
  const tsxExec = fs.existsSync(LOCAL_TSX) ? LOCAL_TSX : "npx";
  const spawnArgs = tsxExec === "npx" ? ["tsx", BIN_AICE_TS, "mcp"] : [BIN_AICE_TS, "mcp"];

  return new Promise((resolve, reject) => {
    const child = spawn(tsxExec, spawnArgs, {
      cwd: sb.root,
      env: buildSandboxEnv(sb),
      stdio: ["pipe", "pipe", "pipe"],
    });

    let stdoutBuf = "";
    let stderrBuf = "";
    const parsedResponses: unknown[] = [];
    let expectedResponses = 0;
    let settled = false;
    let stdinClosed = false;
    let shutdownTimer: NodeJS.Timeout | undefined;

    const cleanupTimers = () => {
      clearTimeout(hardTimer);
      if (shutdownTimer) clearTimeout(shutdownTimer);
    };

    const hardTimer = setTimeout(() => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      child.stdin.destroy();
      child.kill("SIGKILL");
      reject(new Error(`runMcpSession timed out after ${timeoutMs}ms (received ${parsedResponses.length}/${expectedResponses})`));
    }, timeoutMs);

    const closeStdinCleanly = () => {
      if (stdinClosed) return;
      stdinClosed = true;
      child.stdin.end();
      shutdownTimer = setTimeout(() => {
        if (!settled) {
          child.kill("SIGTERM");
        }
      }, 1500);
    };

    const tryFlush = () => {
      while (true) {
        const idx = stdoutBuf.indexOf("\n");
        if (idx === -1) break;
        const line = stdoutBuf.slice(0, idx).trim();
        stdoutBuf = stdoutBuf.slice(idx + 1);
        if (!line) continue;
        try {
          parsedResponses.push(sanitizeJsonValue(JSON.parse(line), sb));
        } catch {
          parsedResponses.push({ rawLine: sanitizeOutput(line, sb) });
        }
      }
      if (parsedResponses.length >= expectedResponses) {
        closeStdinCleanly();
      }
    };

    child.stdout.on("data", (chunk: Buffer) => {
      stdoutBuf += chunk.toString("utf8");
      tryFlush();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderrBuf += chunk.toString("utf8");
    });
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      cleanupTimers();
      reject(err);
    });
    child.on("close", (code) => {
      tryFlush();
      if (settled) return;
      settled = true;
      cleanupTimers();
      resolve({
        responses: parsedResponses,
        stderr: sanitizeOutput(stderrBuf, sb),
        exitCode: code ?? -1,
      });
    });

    let nextId = 1;
    for (const req of requests) {
      if (req.method.startsWith("notifications/")) {
        child.stdin.write(`${JSON.stringify({ jsonrpc: "2.0", method: req.method, params: req.params ?? {} })}\n`);
      } else {
        expectedResponses += 1;
        child.stdin.write(
          `${JSON.stringify({ jsonrpc: "2.0", id: nextId++, method: req.method, params: req.params ?? {} })}\n`,
        );
      }
    }
    if (expectedResponses === 0) {
      closeStdinCleanly();
    }
  });
}

function writeSuite(suiteName: string, gitCommit: string, cases: unknown[], note?: string): void {
  fs.mkdirSync(CASES_DIR, { recursive: true });
  const payload = {
    suite: suiteName,
    capturedWith: {
      aiceVersion: "0.9.53",
      entry: "bin/aice.ts",
      gitCommit,
    },
    ...(note ? { note } : {}),
    cases,
  };
  fs.writeFileSync(path.join(CASES_DIR, `${suiteName}.json`), `${JSON.stringify(payload, null, 2)}\n`, "utf8");
}

function captureGovernanceSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];

  // GOV-01: Missing config defaults
  {
    const sb = createSandbox({ config: "none" });
    try {
      const res = runAice(sb, ["status", "--json"], { expectJson: true });
      cases.push({
        id: "GOV-01",
        description: "Missing aice.config.json defaults to enabled:true, idiomsEnabled:false, idiomsCount:0",
        fixtureSetup: { copySrc: true, copyBin: false, config: "none" },
        invocation: { kind: "cli", args: ["status", "--json"] },
        observedTs0953: { ...res },
        rustParityContract: {
          mode: "exact_json",
          exitCode: 0,
          requiredInvariants: [
            "stdoutJson.enabled === true",
            "stdoutJson.idiomsEnabled === false",
            "stdoutJson.idiomsCount === 0",
            "stdoutJson.projectRoot === '<ROOT>'",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // GOV-02: enable creates aice.config.json + AGENTS.md (single marker, <= 650 tokens) and is idempotent
  {
    const sb = createSandbox({ config: "none" });
    try {
      const first = runAice(sb, ["enable", "--json"], { expectJson: true });
      const second = runAice(sb, ["enable"], { expectJson: false });
      const agentsMd = fs.readFileSync(path.join(sb.root, "AGENTS.md"), "utf8");
      const markerCount = (agentsMd.match(/<!-- AICE:START/g) ?? []).length;
      const cl100k = countBpe(agentsMd, "cl100k_base");
      const o200k = countBpe(agentsMd, "o200k_base");
      const disk = snapshotDiskFiles(sb, ["aice.config.json", "AGENTS.md"]);

      cases.push({
        id: "GOV-02",
        description: "enable creates aice.config.json and AGENTS.md with single marker and <= 650 BPE tokens (idempotent)",
        fixtureSetup: { copySrc: true, copyBin: false, config: "none" },
        invocation: {
          kind: "cli_sequence",
          commands: [{ args: ["enable", "--json"] }, { args: ["enable"] }],
        },
        observedTs0953: {
          exitCode: second.exitCode,
          stdout: `${first.stdout}\n---SECOND---\n${second.stdout}`,
          stderr: second.stderr,
          stdoutJson: first.stdoutJson,
          diskFilesAfter: disk,
          extraChecks: {
            agentsMdMarkers: markerCount,
            agentsMdTokensCl100k: cl100k,
            agentsMdTokensO200k: o200k,
          },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: [
            "aice.config.json has enabled:true",
            "AGENTS.md has exactly 1 <!-- AICE:START marker",
            "AGENTS.md BPE tokens <= 650 (cl100k_base & o200k_base)",
          ],
          deltaNote: "Wave 5 updates AGENTS.md directive text for the redesigned Rust CLI while keeping single marker and <=650 BPE token cap.",
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // GOV-03: config --idioms-on / --idioms-off
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const onRes = runAice(sb, ["config", "--idioms-on", "--json"], { expectJson: true });
      const offRes = runAice(sb, ["config", "--idioms-off", "--json"], { expectJson: true });
      cases.push({
        id: "GOV-03",
        description: "config --idioms-on and --idioms-off toggle idiomsEnabled in aice.config.json",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["config", "--idioms-on", "--json"] },
            { args: ["config", "--idioms-off", "--json"] },
          ],
        },
        observedTs0953: {
          exitCode: offRes.exitCode,
          stdout: offRes.stdout,
          stderr: offRes.stderr,
          stdoutJson: { on: onRes.stdoutJson, off: offRes.stdoutJson },
          diskFilesAfter: snapshotDiskFiles(sb, ["aice.config.json"]),
        },
        rustParityContract: {
          mode: "exact_json",
          exitCode: 0,
          requiredInvariants: ["on.idiomsEnabled === true", "off.idiomsEnabled === false"],
          deltaNote: "If R7 Idiom Gate deletes aice-idioms in Wave 4, idiomsEnabled flags are retired cleanly while unknown fields in aice.config.json remain tolerated.",
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // GOV-04: disabled project blocks read, find, search, splice with exit 1
  {
    const sb = createSandbox({ config: "disabled" });
    try {
      const readRes = runAice(sb, ["read", "src/app.ts"]);
      const findRes = runAice(sb, ["find"]);
      const searchRes = runAice(sb, ["search", "Calculator"]);
      const spliceRes = runAice(sb, ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number { return 0; }"]);

      cases.push({
        id: "GOV-04",
        description: "enabled:false blocks read, find, search, and splice with exit code 1 and disabled notice",
        fixtureSetup: { copySrc: true, copyBin: false, config: "disabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["read", "src/app.ts"] },
            { args: ["find"] },
            { args: ["search", "Calculator"] },
            { args: ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number { return 0; }"] },
          ],
        },
        observedTs0953: {
          exitCode: readRes.exitCode,
          stdout: readRes.stdout,
          stderr: readRes.stderr,
          extraChecks: {
            read: { exitCode: readRes.exitCode, stderr: readRes.stderr, stdout: readRes.stdout },
            find: { exitCode: findRes.exitCode, stderr: findRes.stderr, stdout: findRes.stdout },
            search: { exitCode: searchRes.exitCode, stderr: searchRes.stderr, stdout: searchRes.stdout },
            splice: { exitCode: spliceRes.exitCode, stderr: spliceRes.stderr, stdout: spliceRes.stdout },
          },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 1,
          requiredInvariants: [
            "All 4 operations (read, find, search, splice) exit 1",
            "Error output mentions aice.config.json and enabled: false",
            "Disk files remain untouched",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // GOV-05: legacy .aicerc discovery
  {
    const sb = createSandbox({ config: "legacy_aicerc" });
    try {
      const res = runAice(sb, ["status", "--json"], { expectJson: true });
      cases.push({
        id: "GOV-05",
        description: "Legacy .aicerc config file is discovered and parsed",
        fixtureSetup: { copySrc: true, copyBin: false, config: "legacy_aicerc" },
        invocation: { kind: "cli", args: ["status", "--json"] },
        observedTs0953: { ...res },
        rustParityContract: {
          mode: "exact_json",
          exitCode: 0,
          requiredInvariants: ["stdoutJson.enabled === true", "stdoutJson.idiomsEnabled === false"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // GOV-06: disable then enable preserves existing idioms map in aice.config.json
  {
    const sb = createSandbox({ config: "idioms" });
    try {
      const disRes = runAice(sb, ["disable", "--json"], { expectJson: true });
      const enRes = runAice(sb, ["enable", "--json"], { expectJson: true });
      cases.push({
        id: "GOV-06",
        description: "disable and enable preserve existing idioms definitions in aice.config.json",
        fixtureSetup: { copySrc: true, copyBin: false, config: "idioms" },
        invocation: {
          kind: "cli_sequence",
          commands: [{ args: ["disable", "--json"] }, { args: ["enable", "--json"] }],
        },
        observedTs0953: {
          exitCode: enRes.exitCode,
          stdout: enRes.stdout,
          stderr: enRes.stderr,
          stdoutJson: { disabled: disRes.stdoutJson, reenabled: enRes.stdoutJson },
          diskFilesAfter: snapshotDiskFiles(sb, ["aice.config.json"]),
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: [
            "disabled.enabled === false",
            "reenabled.enabled === true",
            "aice.config.json preserves idioms.clamp definition",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureFindSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];
  const findTargets: Array<{ id: string; desc: string; args: string[]; expectJson?: boolean; mode: GoldenCaseRecord["rustParityContract"]["mode"]; inv: string[] }> = [
    {
      id: "FIND-01",
      desc: "find lists workspace text files and skips .git, node_modules, and binary files",
      args: ["find"],
      mode: "exit_and_invariants",
      inv: ["Lists src/ files with line counts", "Skips bin/logo.png, bin/data.bin, .git/HEAD, node_modules/dummy/index.js"],
    },
    {
      id: "FIND-02",
      desc: "tree alias matches find discovery output",
      args: ["tree"],
      mode: "exit_and_invariants",
      inv: ["Equivalent discovery output to find", "Skips binary and ignored paths"],
    },
    {
      id: "FIND-03",
      desc: "find -d 1 limits directory traversal depth",
      args: ["find", "-d", "1"],
      mode: "exit_and_invariants",
      inv: ["Shows top-level entries (src/) without listing files inside src/"],
    },
    {
      id: "FIND-04",
      desc: "find --max-depth 1 and -L 1 respect depth flags",
      args: ["find", "--max-depth", "1"],
      mode: "exit_and_invariants",
      inv: ["Respects --max-depth 1 identically to -d 1"],
    },
    {
      id: "FIND-05",
      desc: "find -L 1 respects tree-style -L depth flag",
      args: ["find", "-L", "1"],
      mode: "exit_and_invariants",
      inv: ["Respects -L 1 identically to -d 1"],
    },
    {
      id: "FIND-06",
      desc: "find --search filters discovered paths by pattern",
      args: ["find", "--search", "worker"],
      mode: "exit_and_invariants",
      inv: ["Includes src/worker.py", "Excludes unrelated src files"],
    },
    {
      id: "FIND-07",
      desc: "find --json emits structured discovery payload",
      args: ["find", "--json"],
      expectJson: true,
      mode: "exit_and_invariants",
      inv: ["Valid JSON output", "Contains discovered src/ entries and excludes bin/logo.png"],
    },
    {
      id: "FIND-08",
      desc: "read --files emits fast workspace file list matching find",
      args: ["read", "--files"],
      mode: "exit_and_invariants",
      inv: ["Lists text files with line counts", "Excludes binary files"],
    },
  ];

  for (const item of findTargets) {
    const sb = createSandbox({ copySrc: true, copyBin: true, config: "enabled", withIgnoredNoise: true });
    try {
      const res = runAice(sb, item.args, { expectJson: item.expectJson });
      cases.push({
        id: item.id,
        description: item.desc,
        fixtureSetup: { copySrc: true, copyBin: true, config: "enabled" },
        invocation: { kind: "cli", args: item.args },
        observedTs0953: { ...res },
        rustParityContract: {
          mode: item.mode,
          exitCode: 0,
          requiredInvariants: item.inv,
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureSearchSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];
  const specs: Array<{ id: string; desc: string; args: string[]; expectJson?: boolean; inv: string[]; delta?: string }> = [
    {
      id: "SRCH-01",
      desc: "search ranks production declarations/usages ahead of test files (4-tier ranking)",
      args: ["search", "Calculator"],
      inv: ["Finds Calculator in src/math.ts and src/app.ts", "Production files rank before test files"],
      delta: "Rust Wave 3 transforms matched context snippets via AICE IR on supported languages (closing B-R2).",
    },
    {
      id: "SRCH-02",
      desc: "grep alias produces identical search results",
      args: ["grep", "Calculator"],
      inv: ["Matches search Calculator output"],
      delta: "Rust Wave 3 transforms matched context snippets via AICE IR.",
    },
    {
      id: "SRCH-03",
      desc: "search -C 2 emits 2 lines of surrounding context",
      args: ["search", "inc", "-C", "2"],
      inv: ["Includes L11-L15 context around App.inc in src/app.ts"],
      delta: "Rust Wave 3 emits AICE-transformed context windows.",
    },
    {
      id: "SRCH-04",
      desc: "search -l emits matching file paths only",
      args: ["search", "-l", "Calculator"],
      inv: ["Lists src/math.ts and src/app.ts without snippet bodies"],
    },
    {
      id: "SRCH-05",
      desc: "search auto-escapes literal regex metacharacters without crashing",
      args: ["search", "[a+b]*(c?)"],
      inv: ["Matches literal [a+b]*(c?) in src/notes.txt", "Exits 0 without invalid-regex crash"],
    },
    {
      id: "SRCH-06",
      desc: "search regex alternation with --json emits structured matches",
      args: ["search", "export class|CREATE TABLE", "--json"],
      expectJson: true,
      inv: ["Valid JSON output", "Matches TS classes and SQL CREATE TABLE entries"],
    },
  ];

  for (const spec of specs) {
    const sb = createSandbox({ copySrc: true, copyBin: true, config: "enabled" });
    try {
      const res = runAice(sb, spec.args, { expectJson: spec.expectJson });
      cases.push({
        id: spec.id,
        description: spec.desc,
        fixtureSetup: { copySrc: true, copyBin: true, config: "enabled" },
        invocation: { kind: "cli", args: spec.args },
        observedTs0953: { ...res },
        rustParityContract: {
          mode: "semantic_aice_upgrade",
          exitCode: 0,
          requiredInvariants: spec.inv,
          deltaNote: spec.delta ?? null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureReadSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];
  const specs: Array<{
    id: string;
    desc: string;
    args: string[];
    expectJson?: boolean;
    mode: GoldenCaseRecord["rustParityContract"]["mode"];
    inv: string[];
    delta: string | null;
  }> = [
    {
      id: "READ-01",
      desc: "Bare <=120L supported TS file read (TS v0.9.53 defaults rawNative:true vs Rust R3 mandatory AICE)",
      args: ["read", "src/math.ts"],
      mode: "semantic_aice_upgrade",
      inv: ["Exits 0", "Preserves CalcResult, Calculator, add, mul semantics", "Rust MUST emit AICE IR by default (closing B-R1)"],
      delta: "Law 3 + R3: TS v0.9.53 emitted raw native TS when --dsl was omitted; Rust emits compact AICE IR by default.",
    },
    {
      id: "READ-02",
      desc: "read --dsl emits AICE representation for supported TS file",
      args: ["read", "src/math.ts", "--dsl"],
      mode: "semantic_aice_upgrade",
      inv: ["Emits AICE symbols for CalcResult and Calculator", "Rust preserves private visibility and number type losslessly"],
      delta: "Rust AICE IR fixes TS lossy decompilation (number->int and dropped private modifier).",
    },
    {
      id: "READ-03",
      desc: "Bare >120L TS file triggers auto-outline with symbol landmarks",
      args: ["read", "src/big.ts"],
      mode: "exit_and_invariants",
      inv: ["Auto-outlines src/big.ts (>120L)", "Includes runBatchPipeline, clampMetric, summarizeMetrics with line spans"],
      delta: null,
    },
    {
      id: "READ-04",
      desc: "Symbol slice src/math.ts:Calculator.add extracts exact method + siblings",
      args: ["read", "src/math.ts:Calculator.add"],
      mode: "semantic_aice_upgrade",
      inv: ["Extracts Calculator.add", "Includes sibling hint (mul/offset)", "Rust emits AICE IR slice"],
      delta: "Rust transforms symbol slice to AICE IR.",
    },
    {
      id: "READ-05",
      desc: "Line range slice src/big.ts:L1-L15 extracts requested lines",
      args: ["read", "src/big.ts:L1-L15"],
      mode: "semantic_aice_upgrade",
      inv: ["Extracts lines 1..15 of src/big.ts", "Rust emits AICE IR for supported slice"],
      delta: "Rust transforms line range slice to AICE IR on supported languages.",
    },
    {
      id: "READ-06",
      desc: "Intra-symbol pattern selector src/big.ts:runBatchPipeline@divisible",
      args: ["read", "src/big.ts:runBatchPipeline@divisible"],
      mode: "semantic_aice_upgrade",
      inv: ["Locates divisible block inside runBatchPipeline", "Rust intra-AST slicer extracts the exact branch block"],
      delta: "Rust R8 intra-function AST engine indexes control-flow blocks natively.",
    },
    {
      id: "READ-07",
      desc: "Multi-target coalescing across same-file symbols and other files",
      args: ["read", "src/app.ts", "src/math.ts:Calculator.add", "src/math.ts:Calculator.mul"],
      mode: "semantic_aice_upgrade",
      inv: ["Returns deduplicated context pack containing App, Calculator.add, Calculator.mul"],
      delta: "Rust orders multi-target packs topologically (dependencies/types before callers).",
    },
    {
      id: "READ-08",
      desc: "Binary files (logo.png and NUL-byte data.bin) are skipped cleanly without raw byte dump",
      args: ["read", "bin/logo.png", "bin/data.bin"],
      mode: "exit_and_invariants",
      inv: ["Exits 0", "Emits binary skip notice for both files", "Contains zero raw PNG/NUL bytes"],
      delta: null,
    },
    {
      id: "READ-09",
      desc: "Plain text file (notes.txt) passes through via Law 3 PlainText exception",
      args: ["read", "src/notes.txt"],
      mode: "exit_and_invariants",
      inv: ["Exits 0", "Emits notes.txt content without AST transformation error", "Honest telemetry still recorded"],
      delta: null,
    },
    {
      id: "READ-10",
      desc: "Polyglot --dsl read across R5 (Python, Rust, Go, TOML, Dart, Ruby) and R6 DB dialects (SQL, Prisma, GraphQL, Cypher)",
      args: [
        "read",
        "--dsl",
        "src/worker.py",
        "src/engine.rs",
        "src/server.go",
        "src/config.toml",
        "src/widget.dart",
        "src/jobs.rb",
        "src/schema_ansi.sql",
        "src/schema.prisma",
        "src/api.graphql",
        "src/graph.cypher",
      ],
      mode: "semantic_aice_upgrade",
      inv: [
        "Exits 0",
        "TS v0.9.53 decompiles Python/Rust/Go but passes through TOML/Dart/Ruby/SQL/Prisma/GraphQL/Cypher as raw",
        "Rust R3/R5/R6 transforms ALL 10 targets into compact AICE IR",
      ],
      delta: "Rust adds full AST parsers and AICE IR transformation for TOML, Dart, Ruby, ANSI SQL, Postgres, MySQL, SQLite, T-SQL, Prisma, GraphQL, and Cypher.",
    },
    {
      id: "READ-11",
      desc: "read --outline src/app.ts emits structural skeleton",
      args: ["read", "--outline", "src/app.ts"],
      mode: "exit_and_invariants",
      inv: ["Lists App class, constructor, inc, reset with line ranges"],
      delta: null,
    },
    {
      id: "READ-12",
      desc: "read src/app.ts --json emits structured JSON bundle",
      args: ["read", "src/app.ts", "--json"],
      expectJson: true,
      mode: "exit_and_invariants",
      inv: ["Valid JSON", "Contains targetPath, targetContent, targetOutline, dependencies, tokenCount"],
      delta: "Rust tokenCount uses exact bpe-openai count on AICE-transformed output.",
    },
    {
      id: "READ-13",
      desc: "Polyglot --dsl read across remaining R5 code/web/Twig targets (TSX, JS, C, C++, C#, Java, Kotlin, PHP, HTML, CSS, Twig)",
      args: [
        "read",
        "--dsl",
        "src/component.tsx",
        "src/helper.js",
        "src/native.c",
        "src/matrix.cpp",
        "src/billing.cs",
        "src/Service.java",
        "src/Handler.kt",
        "src/controller.php",
        "src/page.html",
        "src/styles.css",
        "src/card.twig",
      ],
      mode: "semantic_aice_upgrade",
      inv: [
        "Exits 0",
        "Covers TSX, JS, C, C++, C#, Java, Kotlin, PHP, HTML, CSS, and Twig fixtures",
        "Rust R3/R5 transforms ALL 11 targets into compact AICE IR",
      ],
      delta: "Rust adds real tree-sitter/RD AST parsers and AICE IR transformation for C, Java, HTML/CSS, and Twig.",
    },
    {
      id: "READ-14",
      desc: "Polyglot --dsl read across R5 data/docs/shell targets (JSON, YAML, XML, SVG, Bash, Markdown)",
      args: [
        "read",
        "--dsl",
        "src/manifest.json",
        "src/deploy.yaml",
        "src/config.xml",
        "src/diagram.svg",
        "src/build.sh",
        "src/guide.md",
      ],
      mode: "semantic_aice_upgrade",
      inv: [
        "Exits 0",
        "Covers JSON, YAML, XML, SVG, Bash, and Markdown fixtures",
        "Rust R3/R5 transforms ALL 6 targets into compact AICE IR",
      ],
      delta: "Rust adds real AST parsers and AICE IR transformation for XML/SVG, Bash, and Markdown.",
    },
    {
      id: "READ-15",
      desc: "Polyglot --dsl read across remaining R6 DB dialects (PostgreSQL/PLpgSQL, MySQL, SQLite, T-SQL, DB migration)",
      args: [
        "read",
        "--dsl",
        "src/trigger_pg.sql",
        "src/proc_mysql.sql",
        "src/local_sqlite.sql",
        "src/report_tsql.sql",
        "src/migrations/V001__init_ledger.sql",
      ],
      mode: "semantic_aice_upgrade",
      inv: [
        "Exits 0",
        "Covers PostgreSQL PL/pgSQL, MySQL DELIMITER procs, SQLite STRICT/PRAGMA, T-SQL GO/TRY-CATCH, and Flyway/Goose migrations",
        "Rust R3/R6 parses and transforms ALL 5 DB files into compact AICE IR",
      ],
      delta: "Rust adds dedicated tree-sitter + RD/Pratt parsers for all 9 R6 DB & query dialects.",
    },
  ];

  for (const spec of specs) {
    const sb = createSandbox({ copySrc: true, copyBin: true, config: "enabled" });
    try {
      const res = runAice(sb, spec.args, { expectJson: spec.expectJson });
      cases.push({
        id: spec.id,
        description: spec.desc,
        fixtureSetup: { copySrc: true, copyBin: true, config: "enabled" },
        invocation: { kind: "cli", args: spec.args },
        observedTs0953: { ...res },
        rustParityContract: {
          mode: spec.mode,
          exitCode: 0,
          requiredInvariants: spec.inv,
          deltaNote: spec.delta,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureSpliceSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];

  // SPL-01: Greenfield create
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/created.ts", "--create", "-c", "export function triple(n: number): number {\n  return n * 3;\n}\n"];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-01",
        description: "Greenfield create writes new file on disk",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/created.ts"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["src/created.ts exists on disk with triple()"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-02: Full overwrite with --overwrite
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/math.ts", "--overwrite", "-c", "export const PI = 3.14159;\n"];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-02",
        description: "Full overwrite with --overwrite replaces file contents",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/math.ts"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["src/math.ts equals 'export const PI = 3.14159;\\n'"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-03: Symbol splice preserving docstring
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/app.ts", "-s", "App.inc", "-c", "public inc(step: number): CalcResult {\n  this.count += step * 2;\n  return this.calc.add(this.count, step);\n}"];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-03",
        description: "Symbol splice updates App.inc while preserving leading JSDoc and App.reset",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: [
            "src/app.ts contains 'this.count += step * 2;'",
            "src/app.ts preserves '/** Increment counter and compute sum */'",
            "src/app.ts preserves App.reset()",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-04: Line range splice
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/helper.js", "-s", "L5-L7", "-c", "export function sumList(items) {\n  return items.reduce((acc, item) => acc + item, 10);\n}"];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-04",
        description: "Line range splice (-s L5-L7) replaces inclusive lines 5-7",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/helper.js"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["src/helper.js preserves formatMetric and updates sumList initial accumulator to 10"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-05: :imports and :eof splice
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const impRes = runAice(sb, ["splice", "src/app.ts:imports", "-c", 'import { Calculator, type CalcResult } from "./math.js";\nimport { formatMetric } from "./helper.js";']);
      const eofRes = runAice(sb, ["splice", "src/app.ts:eof", "-c", 'export const APP_TAG = formatMetric("v", 1);']);
      cases.push({
        id: "SPL-05",
        description: ":imports and :eof selectors update imports header and append to EOF",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["splice", "src/app.ts:imports", "-c", 'import { Calculator, type CalcResult } from "./math.js";\nimport { formatMetric } from "./helper.js";'] },
            { args: ["splice", "src/app.ts:eof", "-c", 'export const APP_TAG = formatMetric("v", 1);'] },
          ],
        },
        observedTs0953: {
          exitCode: eofRes.exitCode,
          stdout: `${impRes.stdout}\n---EOF---\n${eofRes.stdout}`,
          stderr: eofRes.stderr,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
        },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: [
            "src/app.ts imports formatMetric from ./helper.js",
            "src/app.ts ends with export const APP_TAG",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-06: --delete symbol
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/math.ts", "--delete", "Calculator.mul"];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-06",
        description: "--delete removes Calculator.mul while preserving Calculator.add",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/math.ts"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["Calculator.mul removed from src/math.ts", "Calculator.add preserved"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-07: --insert-after and --insert-before
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const afterRes = runAice(sb, ["splice", "src/app.ts", "--insert-after", "App.inc", "-c", "public peek(): number {\n  return this.count;\n}"]);
      const beforeRes = runAice(sb, ["splice", "src/app.ts", "--insert-before", "App.reset", "-c", "public dec(step: number): number {\n  this.count -= step;\n  return this.count;\n}"]);
      cases.push({
        id: "SPL-07",
        description: "--insert-after and --insert-before insert sibling methods in exact order",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["splice", "src/app.ts", "--insert-after", "App.inc", "-c", "public peek(): number {\n  return this.count;\n}"] },
            { args: ["splice", "src/app.ts", "--insert-before", "App.reset", "-c", "public dec(step: number): number {\n  this.count -= step;\n  return this.count;\n}"] },
          ],
        },
        observedTs0953: {
          exitCode: beforeRes.exitCode,
          stdout: `${afterRes.stdout}\n---BEFORE---\n${beforeRes.stdout}`,
          stderr: beforeRes.stderr,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
        },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["Method order in src/app.ts is inc -> peek -> dec -> reset"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-08: <<< === >>> contextual hunk
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const hunk = "<<<\nexport function formatMetric(name, value) {\n  return `${name}=${value.toFixed(2)}`;\n}\n===\nexport function formatMetric(name, value) {\n  return `${name}:${value.toFixed(3)}`;\n}\n>>>";
      const args = ["splice", "src/helper.js", "-c", hunk];
      const res = runAice(sb, args);
      cases.push({
        id: "SPL-08",
        description: "<<< === >>> contextual hunk replaces exact matched block",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/helper.js"]) },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: ["src/helper.js contains toFixed(3) and preserves sumList"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-09: --stdin multi-file batch heredoc (create + symbol splice + --delete)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const stdinPayload = [
        "=== src/batch_helper.ts ===",
        "export function doubleVal(x: number): number {",
        "  return x * 2;",
        "}",
        "",
        "=== src/app.ts:App.reset ===",
        "public reset(): number {",
        "  this.count = 1;",
        "  return this.count;",
        "}",
        "",
        "=== src/math.ts:Calculator.mul --delete ===",
        "",
      ].join("\n");
      const args = ["splice", "--stdin"];
      const res = runAice(sb, args, { stdin: stdinPayload });
      cases.push({
        id: "SPL-09",
        description: "--stdin multi-file batch heredoc executes create + symbol splice + --delete atomically",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args, stdin: stdinPayload },
        observedTs0953: {
          ...res,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/batch_helper.ts", "src/app.ts", "src/math.ts"]),
        },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 0,
          requiredInvariants: [
            "src/batch_helper.ts created",
            "src/app.ts App.reset sets this.count = 1",
            "src/math.ts Calculator.mul deleted",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-10: --dry-run and --diff
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const before = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      const args = ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 42;\n  return this.count;\n}", "--dry-run", "--diff"];
      const res = runAice(sb, args);
      const after = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      cases.push({
        id: "SPL-10",
        description: "--dry-run --diff emits unified diff preview without modifying disk",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: {
          ...res,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
          extraChecks: { diskUnchanged: before === after },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: ["Diff contains -    this.count = 0; and +  this.count = 42;", "src/app.ts on disk is byte-identical to original"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // SPL-11: --json output
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const args = ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 9;\n  return this.count;\n}", "--json"];
      const res = runAice(sb, args, { expectJson: true });
      cases.push({
        id: "SPL-11",
        description: "splice --json emits structured JSON result and updates disk",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: { ...res, diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]) },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: ["Valid JSON output", "src/app.ts updated with this.count = 9"],
          deltaNote: `Rust telemetry tokensSaved uses exact bpe-openai edit diff instead of inflated whole-file delta. ${TELEMETRY_PATH_VARIANCE_NOTE}`,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureFirewallRollbackSuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];

  // FW-01: Invalid TS syntax rejected before disk touch
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const before = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      const args = ["splice", "src/app.ts", "-s", "App.inc", "-c", "public inc(step: number): { broken ==="];
      const res = runAice(sb, args);
      const after = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      cases.push({
        id: "FW-01",
        description: "Invalid TypeScript syntax is rejected with Line:Col diagnostics before touching disk",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args },
        observedTs0953: {
          ...res,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
          extraChecks: { diskUnchanged: before === after },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 1,
          requiredInvariants: ["Exits 1", "Reports syntax error diagnostic", "src/app.ts on disk unchanged"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // FW-02: Invalid JSON, YAML, CSS, HTML, Python rejected
  {
    const invalidProbes: Array<{ id: string; file: string; args: string[]; note: string | null }> = [
      {
        id: "FW-02-JSON",
        file: "src/manifest.json",
        args: ["splice", "src/manifest.json", "--overwrite", "-c", '{"broken": '],
        note: "TS 0.9.53 validated JSON via JSON.parse; Rust validates via tree-sitter-json + strict JSON parser.",
      },
      {
        id: "FW-02-YAML",
        file: "src/deploy.yaml",
        args: ["splice", "src/deploy.yaml", "--overwrite", "-c", "service: [unclosed\n  bad: : :"],
        note: null,
      },
      {
        id: "FW-02-CSS",
        file: "src/styles.css",
        args: ["splice", "src/styles.css", "--overwrite", "-c", ".card { color: red; /* unclosed"],
        note: null,
      },
      {
        id: "FW-02-PY",
        file: "src/worker.py",
        args: ["splice", "src/worker.py", "-s", "run_job", "-c", "def run_job(job):\n    if job.retries > :\n        return 'bad'"],
        note: "TS 0.9.53 shelled out to python3; Rust validates in-process via tree-sitter-python.",
      },
    ];

    for (const p of invalidProbes) {
      const sb = createSandbox({ config: "enabled" });
      try {
        const before = fs.readFileSync(path.join(sb.root, p.file), "utf8");
        const res = runAice(sb, p.args);
        const after = fs.readFileSync(path.join(sb.root, p.file), "utf8");
        cases.push({
          id: p.id,
          description: `Invalid syntax in ${p.file} is blocked before disk touch`,
          fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
          invocation: { kind: "cli", args: p.args },
          observedTs0953: {
            ...res,
            diskFilesAfter: snapshotDiskFiles(sb, [p.file]),
            extraChecks: { diskUnchanged: before === after },
          },
          rustParityContract: {
            mode: "exit_and_invariants",
            exitCode: 1,
            requiredInvariants: ["Exits 1", `${p.file} on disk is unchanged`],
            deltaNote: p.note,
          },
        });
      } finally {
        sb.cleanup();
      }
    }
  }

  // FW-03: Binary write rejection (logo.png and data.bin)
  {
    const sb = createSandbox({ copySrc: true, copyBin: true, config: "enabled" });
    try {
      const beforePng = fs.readFileSync(path.join(sb.root, "bin/logo.png"));
      const beforeBin = fs.readFileSync(path.join(sb.root, "bin/data.bin"));
      const pngRes = runAice(sb, ["splice", "bin/logo.png", "-c", "corrupt"]);
      const binRes = runAice(sb, ["splice", "bin/data.bin", "--overwrite", "-c", "corrupt"]);
      const afterPng = fs.readFileSync(path.join(sb.root, "bin/logo.png"));
      const afterBin = fs.readFileSync(path.join(sb.root, "bin/data.bin"));

      cases.push({
        id: "FW-03",
        description: "Binary write/splice attempts (logo.png and NUL-byte data.bin) exit 1 without touching disk",
        fixtureSetup: { copySrc: true, copyBin: true, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["splice", "bin/logo.png", "-c", "corrupt"] },
            { args: ["splice", "bin/data.bin", "--overwrite", "-c", "corrupt"] },
          ],
        },
        observedTs0953: {
          exitCode: pngRes.exitCode,
          stdout: `${pngRes.stdout}\n${binRes.stdout}`,
          stderr: `${pngRes.stderr}\n${binRes.stderr}`,
          diskFilesAfter: snapshotDiskFiles(sb, ["bin/logo.png", "bin/data.bin"]),
          extraChecks: {
            pngUnchanged: beforePng.equals(afterPng),
            binUnchanged: beforeBin.equals(afterBin),
            pngExit: pngRes.exitCode,
            binExit: binRes.exitCode,
          },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 1,
          requiredInvariants: ["Both exit 1", "Binary files remain byte-identical on disk"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // FW-04: Half-open :L guard (both unbalanced rejection and verbatim boundary auto-alignment)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      // Unbalanced replacement on balanced L12-L15 span (omitting closing brace at L15, non-verbatim header)
      const before = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      const unbalArgs = [
        "splice",
        "src/app.ts",
        "-s",
        "L12-L15",
        "-c",
        "  public inc(delta: number): CalcResult {\n    this.count += delta * 3;\n    return this.calc.add(this.count, delta);",
      ];
      const unbalRes = runAice(sb, unbalArgs);
      const afterUnbal = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");

      // Half-open off-by-one auto-alignment where first line matches L12 and last line matches L14 (prevEndOrigTrim)
      const autoArgs = [
        "splice",
        "src/app.ts",
        "-s",
        "L12-L15",
        "-c",
        "  public inc(step: number): CalcResult {\n    this.count += step * 5;\n    return this.calc.add(this.count, step);",
      ];
      const autoRes = runAice(sb, autoArgs);

      cases.push({
        id: "FW-04",
        description: "Half-open :L guard rejects unbalanced span truncation and safely aligns verbatim boundary off-by-one",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [{ args: unbalArgs }, { args: autoArgs }],
        },
        observedTs0953: {
          exitCode: unbalRes.exitCode,
          stdout: `UNBALANCED:\n${unbalRes.stdout}\nAUTO_ALIGN:\n${autoRes.stdout}`,
          stderr: `UNBALANCED_ERR:\n${unbalRes.stderr}\nAUTO_ALIGN_ERR:\n${autoRes.stderr}`,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
          extraChecks: {
            unbalancedExit: unbalRes.exitCode,
            unbalancedDiskUnchanged: before === afterUnbal,
            autoAlignExit: autoRes.exitCode,
          },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 1,
          requiredInvariants: [
            "Truncating closing brace on balanced :L span is blocked or safely aligned without breaking AST",
            "Never corrupts closing brace '}' of App.inc",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // FW-05: All-or-nothing batch rollback (new_ok.ts MUST remain absent on disk when later hunk fails)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const beforeMath = fs.readFileSync(path.join(sb.root, "src/math.ts"), "utf8");
      const beforeApp = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      const batchStdin = [
        "=== src/new_ok.ts ===",
        "export const createdOk = true;",
        "",
        "=== src/math.ts:Calculator.add ===",
        "public add(a: number, b: number): CalcResult {",
        '  return { value: a + b, label: "ok" };',
        "}",
        "",
        "=== src/app.ts:App.inc ===",
        "public inc(step: number): { broken ===",
      ].join("\n");

      const args = ["splice", "--stdin"];
      const res = runAice(sb, args, { stdin: batchStdin });
      const afterMath = fs.readFileSync(path.join(sb.root, "src/math.ts"), "utf8");
      const afterApp = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");

      cases.push({
        id: "FW-05",
        description: "Multi-file batch failure rolls back all writes atomically (src/new_ok.ts absent on disk)",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: { kind: "cli", args, stdin: batchStdin },
        observedTs0953: {
          ...res,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/new_ok.ts", "src/math.ts", "src/app.ts"]),
          extraChecks: {
            newOkAbsent: !fs.existsSync(path.join(sb.root, "src/new_ok.ts")),
            mathUnchanged: beforeMath === afterMath,
            appUnchanged: beforeApp === afterApp,
          },
        },
        rustParityContract: {
          mode: "exact_disk_and_exit",
          exitCode: 1,
          requiredInvariants: [
            "Exits 1",
            "src/new_ok.ts === '[ABSENT]'",
            "src/math.ts and src/app.ts remain byte-identical on disk",
          ],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

async function captureMcpSuite(): Promise<GoldenCaseRecord[]> {
  const cases: GoldenCaseRecord[] = [];

  // MCP-01: initialize + tools/list strictly 2 tools + tools/call parity
  {
    const sb = createSandbox({ copySrc: true, copyBin: true, config: "enabled" });
    try {
      const requests: Array<{ method: string; params?: Record<string, unknown> }> = [
        {
          method: "initialize",
          params: { protocolVersion: "2024-11-05", capabilities: {}, clientInfo: { name: "golden", version: "1.0" } },
        },
        { method: "notifications/initialized" },
        { method: "tools/list", params: {} },
        { method: "tools/call", params: { name: "aice_read", arguments: { path: "src/math.ts:Calculator.add" } } },
        { method: "tools/call", params: { name: "aice_read", arguments: { path: "bin/logo.png" } } },
        {
          method: "tools/call",
          params: {
            name: "aice_splice",
            arguments: {
              filePath: "src/app.ts",
              symbol: "App.reset",
              code: "public reset(): number {\n  this.count = 7;\n  return this.count;\n}",
            },
          },
        },
        {
          method: "tools/call",
          params: {
            name: "aice_splice",
            arguments: {
              filePath: "src/app.ts",
              symbol: "App.inc",
              code: "public inc(step: number): { broken ===",
            },
          },
        },
      ];

      const mcpRes = await runMcpSession(sb, requests);
      const listResp = mcpRes.responses[1] as { result?: { tools?: Array<{ name: string }> } } | undefined;
      const toolNames = (listResp?.result?.tools ?? []).map((t) => t.name);

      cases.push({
        id: "MCP-01",
        description: "MCP stdio JSON-RPC exposes strictly 2 tools (aice_read, aice_splice) and enforces binary/firewall parity",
        fixtureSetup: { copySrc: true, copyBin: true, config: "enabled" },
        invocation: { kind: "mcp_session", mcpRequests: requests },
        observedTs0953: {
          exitCode: mcpRes.exitCode,
          stdout: JSON.stringify(mcpRes.responses, null, 2),
          stderr: mcpRes.stderr,
          stdoutJson: mcpRes.responses,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/app.ts"]),
          extraChecks: { listedTools: toolNames },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: [
            "tools/list returns strictly ['aice_read', 'aice_splice']",
            "aice_read bin/logo.png skips binary bytes",
            "aice_splice updates App.reset and rejects invalid App.inc with isError:true",
          ],
          deltaNote: "Rust closes B-S3 by removing hidden legacy MCP aliases (aice_context, aice_create, etc.) from executeToolCall as well.",
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // MCP-02: enabled:false governance on MCP tools/call
  {
    const sb = createSandbox({ copySrc: true, copyBin: false, config: "disabled" });
    try {
      const requests: Array<{ method: string; params?: Record<string, unknown> }> = [
        { method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } },
        { method: "tools/call", params: { name: "aice_read", arguments: { path: "src/app.ts" } } },
        {
          method: "tools/call",
          params: { name: "aice_splice", arguments: { filePath: "src/app.ts", symbol: "App.reset", code: "public reset(): number { return 0; }" } },
        },
      ];
      const mcpRes = await runMcpSession(sb, requests);
      cases.push({
        id: "MCP-02",
        description: "MCP tools/call rejects aice_read and aice_splice when enabled:false in aice.config.json",
        fixtureSetup: { copySrc: true, copyBin: false, config: "disabled" },
        invocation: { kind: "mcp_session", mcpRequests: requests },
        observedTs0953: {
          exitCode: mcpRes.exitCode,
          stdout: JSON.stringify(mcpRes.responses, null, 2),
          stderr: mcpRes.stderr,
          stdoutJson: mcpRes.responses,
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: ["Both aice_read and aice_splice return isError:true mentioning enabled:false"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

function captureTelemetrySuite(): GoldenCaseRecord[] {
  const cases: GoldenCaseRecord[] = [];

  // TEL-01: cl100k_base / o200k_base BPE verification + gain --json
  {
    const sb = createSandbox({ copySrc: true, copyBin: false, config: "enabled" });
    try {
      runAice(sb, ["read", "src/big.ts"]);
      runAice(sb, ["read", "src/math.ts", "--dsl"]);
      runAice(sb, ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 0;\n  return 0;\n}"]);
      const gainRes = runAice(sb, ["gain", "--json"], { expectJson: true });
      const rawJsonl = fs.existsSync(sb.telemetryFile)
        ? fs.readFileSync(sb.telemetryFile, "utf8").trim().split("\n").filter(Boolean)
        : [];
      const parsedRows = rawJsonl.map((l) => sanitizeJsonValue(JSON.parse(l), sb));

      const bigRaw = fs.readFileSync(path.join(sb.root, "src/big.ts"), "utf8");
      const mathRaw = fs.readFileSync(path.join(sb.root, "src/math.ts"), "utf8");

      cases.push({
        id: "TEL-01",
        description: "Telemetry ledger records events and gain --json reports project breakdown; cross-checks exact cl100k_base/o200k_base BPE",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [
            { args: ["read", "src/big.ts"] },
            { args: ["read", "src/math.ts", "--dsl"] },
            { args: ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 0;\n  return 0;\n}"] },
            { args: ["gain", "--json"] },
          ],
        },
        observedTs0953: {
          exitCode: gainRes.exitCode,
          stdout: gainRes.stdout,
          stderr: gainRes.stderr,
          stdoutJson: gainRes.stdoutJson,
          extraChecks: {
            ledgerRowCount: parsedRows.length,
            ledgerRows: parsedRows,
            exactBpeBigTs: {
              cl100k_base: countBpe(bigRaw, "cl100k_base"),
              o200k_base: countBpe(bigRaw, "o200k_base"),
              utf8Bytes: Buffer.byteLength(bigRaw, "utf8"),
            },
            exactBpeMathTs: {
              cl100k_base: countBpe(mathRaw, "cl100k_base"),
              o200k_base: countBpe(mathRaw, "o200k_base"),
              utf8Bytes: Buffer.byteLength(mathRaw, "utf8"),
            },
          },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: [
            "gain --json returns valid JSON with project totals",
            "Exact cl100k_base and o200k_base BPE counts match js-tiktoken reference",
            "Rust computes exact o200k_base (not cl100k copy) and counts full emitted stdout including framing/stats",
          ],
          deltaNote: `Rust closes B-T1..B-T6 by computing exact bpe-openai cl100k_base & o200k_base on raw vs full stdout without heuristics or negative clamping. ${TELEMETRY_PATH_VARIANCE_NOTE}`,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  // TEL-02: /tmp exclusion when explicit telemetry env is NOT set
  {
    const sb = createSandbox({ copySrc: true, copyBin: false, config: "enabled", useTmpTelemetrySuppression: true });
    try {
      const readRes = runAice(sb, ["read", "src/big.ts"]);
      const gainRes = runAice(sb, ["gain", "--json"], { expectJson: true });
      const defaultGainsPath = path.join(sb.fakeHome, ".aice", "telemetry", "gains.jsonl");
      const gainsCreated = fs.existsSync(defaultGainsPath);

      cases.push({
        id: "TEL-02",
        description: "Ephemeral /tmp workspaces are excluded from global ~/.aice/telemetry/gains.jsonl when no override env is set",
        fixtureSetup: { copySrc: true, copyBin: false, config: "enabled" },
        invocation: {
          kind: "cli_sequence",
          commands: [{ args: ["read", "src/big.ts"] }, { args: ["gain", "--json"] }],
          env: { AICE_HOME: "__UNSET__", AICE_TELEMETRY_PATH: "__UNSET__" },
        },
        observedTs0953: {
          exitCode: readRes.exitCode,
          stdout: gainRes.stdout,
          stderr: gainRes.stderr,
          stdoutJson: gainRes.stdoutJson,
          extraChecks: { defaultGainsJsonlCreatedForTmp: gainsCreated },
        },
        rustParityContract: {
          mode: "exit_and_invariants",
          exitCode: 0,
          requiredInvariants: ["defaultGainsJsonlCreatedForTmp === false"],
          deltaNote: null,
        },
      });
    } finally {
      sb.cleanup();
    }
  }

  return cases;
}

interface AntiBypassRecord {
  id: string;
  category: "read" | "write" | "surface" | "telemetry";
  title: string;
  sourceLocationsTs0953: string[];
  ts0953EvidenceType: "live_probe" | "static_code_audit";
  observedTs0953: Record<string, unknown>;
  rustRequiredBehavior: string;
  antiRegressionAssertions: string[];
}

async function captureAntiBypassSuite(): Promise<AntiBypassRecord[]> {
  const records: AntiBypassRecord[] = [];

  // B-R1: Default un-transformed read
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["read", "src/math.ts"]);
      records.push({
        id: "B-R1",
        category: "read",
        title: "Default read emits un-transformed raw native TS unless --dsl is passed",
        sourceLocationsTs0953: [
          "src/tools/read/types-and-budgets.ts:317-322",
          "src/cli/read-commands.ts:160,186",
          "src/mcp/server.ts:1008",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/math.ts",
          exitCode: res.exitCode,
          stdout: res.stdout,
          emittedRawTypescript: res.stdout.includes("export interface CalcResult {"),
        },
        rustRequiredBehavior: "Default read MUST transform supported languages into canonical AICE IR (Law 3 + R3).",
        antiRegressionAssertions: ["read src/math.ts without --dsl emits AICE IR, not raw TS braces/export keywords"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R2: aice search hardcodes rawNative: true
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["search", "Calculator"]);
      records.push({
        id: "B-R2",
        category: "read",
        title: "aice search hardcodes rawNative: true with no AST/AICE transformation",
        sourceLocationsTs0953: ["src/cli/read-commands.ts:321,336"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "search Calculator",
          exitCode: res.exitCode,
          stdout: res.stdout,
          emittedRawSnippets: res.stdout.includes("export class Calculator {"),
        },
        rustRequiredBehavior: "Search matched windows MUST flow through the AICE pipeline and transform supported snippets into AICE IR.",
        antiRegressionAssertions: ["search Calculator returns AICE-transformed context windows on supported files"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R3: >50 KB large-file symbol query skips AST/decompile
  {
    const bigLines: string[] = ["export const HEADER = 1;"];
    for (let i = 0; i < 1600; i++) {
      bigLines.push(`export function padFunc${i}(v: number): number { return v + ${i}; }`);
    }
    bigLines.push("export function lateTarget(x: number): number { return x * 42; }");
    const bigContent = `${bigLines.join("\n")}\n`;
    const sb = createSandbox({
      copySrc: false,
      config: "enabled",
      extraFiles: { "src/huge.ts": bigContent },
    });
    try {
      const res = runAice(sb, ["read", "src/huge.ts:lateTarget", "--dsl"]);
      records.push({
        id: "B-R3",
        category: "read",
        title: ">50 KB large-file symbol query skips AST diagnostics and decompilation",
        sourceLocationsTs0953: ["src/tools/context/orchestrator.ts:258,277,349"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/huge.ts:lateTarget --dsl",
          fileBytes: Buffer.byteLength(bigContent, "utf8"),
          exitCode: res.exitCode,
          stdout: res.stdout,
        },
        rustRequiredBehavior: "Files >50 KB MUST still be parsed by tree-sitter and transformed to AICE IR without size bypass.",
        antiRegressionAssertions: ["read >50KB file:lateTarget parses AST and emits exact AICE symbol slice"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R4: Passthrough / twig exception skips decompilation silently
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["read", "src/card.twig", "src/config.toml", "src/schema_ansi.sql", "--dsl"]);
      records.push({
        id: "B-R4",
        category: "read",
        title: "Passthrough / zero-envelope extensions & Twig skip decompilation silently",
        sourceLocationsTs0953: ["src/tools/context/orchestrator.ts:260-261,350-356,360-361"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/card.twig src/config.toml src/schema_ansi.sql --dsl",
          exitCode: res.exitCode,
          stdout: res.stdout,
        },
        rustRequiredBehavior: "All R5/Twig/R6 languages undergo real AST + AICE IR transformation; ONLY PlainText uses UnsupportedPassthrough.",
        antiRegressionAssertions: ["Twig, TOML, and SQL emit AICE IR rather than silent raw passthrough"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R5: Silent AICE drop on small files when AICE > raw tokens
  {
    const sb = createSandbox({
      copySrc: false,
      config: "enabled",
      extraFiles: { "src/tiny.ts": "export const x = 1;\n" },
    });
    try {
      const res = runAice(sb, ["read", "src/tiny.ts", "--dsl"]);
      records.push({
        id: "B-R5",
        category: "read",
        title: "Silent AICE drop on small files when AICE tokens exceed raw tokens",
        sourceLocationsTs0953: ["src/tools/context/orchestrator.ts:367-373"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/tiny.ts --dsl",
          exitCode: res.exitCode,
          stdout: res.stdout,
        },
        rustRequiredBehavior: "Supported files MUST always emit AICE IR (R3) and report honest signed (even negative) token deltas.",
        antiRegressionAssertions: ["No silent swap back to raw native TS when AICE output is larger on tiny files"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R6: Naive text String.includes / line-50 fallback on un-decompiled AST
  {
    const sb = createSandbox({
      copySrc: false,
      config: "enabled",
      extraFiles: {
        "src/bad.rs": "pub fn broken_rust( { let x = ; }\npub fn target_fn() -> i32 { 7 }\n",
      },
    });
    try {
      const res = runAice(sb, ["read", "src/bad.rs:target_fn", "--dsl"]);
      records.push({
        id: "B-R6",
        category: "read",
        title: "[AICE AST Fallback] naive String.includes() / line-50 fallback on AST failure",
        sourceLocationsTs0953: ["src/tools/context/orchestrator.ts:281-330,375-382,488-500"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/bad.rs:target_fn --dsl",
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
        },
        rustRequiredBehavior: "Rust uses real tree-sitter AST slicing and emits explicit structured diagnostics on unparseable symbols instead of naive line-50 text fallback.",
        antiRegressionAssertions: ["No '[AICE AST Fallback]' line-50 substring guessing"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R7: 8 Complete Decompiler/Emitter No-Ops (Java, Shell, XML, Markdown, etc.)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["read", "src/Service.java", "src/build.sh", "src/config.xml", "src/guide.md", "--dsl"]);
      records.push({
        id: "B-R7",
        category: "read",
        title: "8 decompiler/emitter no-ops (java, shell, xml, markdown, etc.) return raw verbatim source",
        sourceLocationsTs0953: ["src/decompiler/index.ts:191-220", "src/emitters/index.ts:145-164"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/Service.java src/build.sh src/config.xml src/guide.md --dsl",
          exitCode: res.exitCode,
          stdout: res.stdout,
        },
        rustRequiredBehavior: "Java, Shell/Bash, XML, and Markdown MUST have real AST parsing, non-empty AICE IR transformation, and pre-write firewalls.",
        antiRegressionAssertions: ["Java, Bash, XML, and Markdown transform to AICE IR on read and round-trip cleanly"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-R8: Chrome-stripping hack to hide negative token savings
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["read", "src/math.ts:L1-L3"]);
      records.push({
        id: "B-R8",
        category: "read",
        title: "Chrome-stripping hack removes framing headers solely to keep savings non-negative",
        sourceLocationsTs0953: ["src/tools/read/engine.ts:2030-2098"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "read src/math.ts:L1-L3",
          exitCode: res.exitCode,
          stdout: res.stdout,
        },
        rustRequiredBehavior: "Metadata framing MUST be deterministic and independent of whether token savings cross 0%.",
        antiRegressionAssertions: ["Framing headers never stripped conditionally based on savings sign"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-W1: --force bypasses pre-write syntax validation
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const before = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      const res = runAice(sb, ["splice", "src/app.ts", "-s", "App.inc", "-c", "public inc(): { broken ===", "--force"]);
      const after = fs.readFileSync(path.join(sb.root, "src/app.ts"), "utf8");
      records.push({
        id: "B-W1",
        category: "write",
        title: "--force bypasses pre-write syntax validation and writes broken syntax to disk",
        sourceLocationsTs0953: [
          "src/tools/splice/native-orchestrator.ts:1388,1480,1536",
          "src/tools/splice/batch.ts:625-640,954",
          "src/tools/create.ts:1344-1365",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "splice src/app.ts -s App.inc -c 'public inc(): { broken ===' --force",
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          tsCorruptedDisk: before !== after,
        },
        rustRequiredBehavior: "SyntaxFirewall MUST NEVER be bypassable via --force (--force only authorizes >25L full overwrite, never invalid syntax).",
        antiRegressionAssertions: ["Invalid syntax with --force exits 1 and leaves disk untouched"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-W2: Pre-existing broken file on disk disables validation completely
  {
    const sb = createSandbox({
      copySrc: false,
      config: "enabled",
      extraFiles: {
        "src/broken_disk.ts": "export const broken = ;\nexport function okFn(): number {\n  return 1;\n}\n",
      },
    });
    try {
      const res = runAice(sb, ["splice", "src/broken_disk.ts", "-s", "okFn", "-c", "export function okFn(): { {{{"]);
      records.push({
        id: "B-W2",
        category: "write",
        title: "Broken-file-on-disk bypass disables syntax validation for newly spliced errors",
        sourceLocationsTs0953: [
          "src/tools/splice/native-orchestrator.ts:1388,1480,1536",
          "src/tools/splice/batch.ts:954",
          "src/tools/diff-patch.ts:957-961",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "splice src/broken_disk.ts -s okFn -c 'export function okFn(): { {{{'",
          exitCode: res.exitCode,
          stdout: res.stdout,
          stderr: res.stderr,
          diskAfter: snapshotDiskFiles(sb, ["src/broken_disk.ts"]),
        },
        rustRequiredBehavior: "Firewall MUST reject splices that introduce new AST syntax errors or increase error node count even when file on disk has pre-existing errors.",
        antiRegressionAssertions: ["Introducing unclosed brace into pre-broken file is rejected with exit 1"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-W3: Regex/delimiter-only validation for Rust, Go, C++, C#, Java, Kotlin, PHP
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const rsRes = runAice(sb, ["splice", "src/engine.rs", "-s", "Engine.step", "-c", "pub fn step(&mut self) -> u64 { let = ; }"]);
      const goRes = runAice(sb, ["splice", "src/server.go", "-s", "StartServer", "-c", "func StartServer(cfg Config) string { := }"]);
      records.push({
        id: "B-W3",
        category: "write",
        title: "Balanced-brace invalid syntax passes TS validator for Rust, Go, C++, C#, Java, Kotlin, PHP",
        sourceLocationsTs0953: ["src/tools/syntax-validator.ts:944-962,1386-1443"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          rustBalancedSyntaxErrorExit: rsRes.exitCode,
          rustStdout: rsRes.stdout,
          goBalancedSyntaxErrorExit: goRes.exitCode,
          goStdout: goRes.stdout,
        },
        rustRequiredBehavior: "All 7 languages (+ C, Dart, Ruby, R6 DBs) MUST use real tree-sitter / strict RD parsers and reject balanced-brace invalid syntax.",
        antiRegressionAssertions: ["Balanced-brace invalid Rust/Go/C/C++/C#/Java/Kotlin/PHP/Dart/Ruby/SQL syntax exits 1 before disk touch"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-W4: External python3/bash dependency & fake HTML/TOML/JSON-passthrough check
  // Launch bin/aice.ts directly via process.execPath + node_modules/tsx/dist/cli.mjs
  // (NOT node_modules/.bin/tsx whose #!/usr/bin/env node fails with exit 127 under PATH="")
  // using balanced-delimiter invalid Python & Bash so TS v0.9.53 executes and reveals
  // the real empty-PATH validation bypass (exit 0 + disk corruption).
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const tomlRes = runAice(sb, ["splice", "src/config.toml", "--overwrite", "-c", "[package\nname === broken"]);
      const pyEmptyPath = runAice(
        sb,
        [
          "splice",
          "src/worker.py",
          "-s",
          "run_job",
          "-c",
          "def run_job(job):\n    if job.retries > :\n        return 'bad'",
        ],
        {
          env: { PATH: "" },
          directNodeTsx: true,
        },
      );
      const bashEmptyPath = runAice(
        sb,
        [
          "splice",
          "src/build.sh",
          "-s",
          "run_check",
          "-c",
          "run_check() {\n  if then\n}",
        ],
        {
          env: { PATH: "" },
          directNodeTsx: true,
        },
      );
      const htmlRes = runAice(sb, ["splice", "src/page.html", "--overwrite", "-c", "<div><span>unclosed</div>"]);
      records.push({
        id: "B-W4",
        category: "write",
        title: "External python3/bash PATH dependency and unvalidated TOML/HTML/SQL passthrough writes",
        sourceLocationsTs0953: ["src/tools/syntax-validator.ts:876,934-937,1063-1191,1435-1437"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          invalidTomlOverwriteExit: tomlRes.exitCode,
          invalidPythonWithEmptyPathExit: pyEmptyPath.exitCode,
          invalidPythonWithEmptyPathStdout: pyEmptyPath.stdout,
          invalidPythonWithEmptyPathStderr: pyEmptyPath.stderr,
          invalidBashWithEmptyPathExit: bashEmptyPath.exitCode,
          invalidBashWithEmptyPathStdout: bashEmptyPath.stdout,
          invalidBashWithEmptyPathStderr: bashEmptyPath.stderr,
          invalidHtmlOverwriteExit: htmlRes.exitCode,
          diskFilesAfter: snapshotDiskFiles(sb, ["src/worker.py", "src/build.sh"]),
        },
        rustRequiredBehavior: "All syntax firewalls MUST run 100% in-process in Rust (zero PATH binary spawns) and validate TOML, HTML, XML, SQL, Prisma, GraphQL, Cypher strictly.",
        antiRegressionAssertions: ["With PATH='', invalid Python/Bash is still rejected", "Invalid TOML and SQL are rejected with exit 1"],
      });
    } finally {
      sb.cleanup();
    }
  }
  // B-W5: Hybrid preprocessor lossy regex lowering
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const goRes = runAice(sb, [
        "splice",
        "src/server.go",
        "-s",
        "StartServer",
        "-c",
        'func StartServer(cfg Config) string {\n  msg := "ret value <- keep"\n  return msg\n}',
      ]);
      records.push({
        id: "B-W5",
        category: "write",
        title: "Line-based regex lowering in hybrid preprocessor risks mutating non-declaration sigils/expressions",
        sourceLocationsTs0953: ["src/tools/preprocessor.ts:1701-1960"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          exitCode: goRes.exitCode,
          diskAfter: snapshotDiskFiles(sb, ["src/server.go"]),
        },
        rustRequiredBehavior: "Lowering MUST be lexer/AST-aware and preserve string literals, template expressions, and Go channel receives (`<-ch`).",
        antiRegressionAssertions: ["Go `<-ch` channel ops and string contents containing `ret`/`<-` are never corrupted"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-S1: --json, --max-tokens, and TTY --full budget discrepancy
  {
    const big = Array.from({ length: 300 }, (_, i) => `export const val${i} = ${i};`).join("\n") + "\n";
    const sb = createSandbox({ copySrc: false, config: "enabled", extraFiles: { "src/large.ts": big } });
    try {
      const nonTtyFull = runAice(sb, ["read", "src/large.ts", "--full"]);
      const jsonFull = runAice(sb, ["read", "src/large.ts", "--full", "--json"], { expectJson: true });
      records.push({
        id: "B-S1",
        category: "surface",
        title: "--json, --max-tokens, and TTY --full bypass CLI budget ceilings while non-TTY --full clamps silently",
        sourceLocationsTs0953: ["src/cli/read-commands.ts:117,135,295,425", "src/tools/read/dynamic-budget.ts:638-649"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          nonTtyFullBytes: Buffer.byteLength(nonTtyFull.stdout, "utf8"),
          jsonFullBytes: Buffer.byteLength(jsonFull.stdout, "utf8"),
        },
        rustRequiredBehavior: "Rust enforces one deterministic, explicitly documented water-filling budget contract across CLI/JSON/MCP with zero hidden bypass flags.",
        antiRegressionAssertions: ["Budget behavior is deterministic and honest telemetry reflects exact emitted stdout bytes/tokens"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-S2: Hidden CLI commands (fmt, diff, etc.) operate outside unified read/splice pipeline & telemetry
  {
    const sb = createSandbox({ config: "disabled" });
    try {
      const fmtRes = runAice(sb, ["fmt", "src/app.ts", "--check"]);
      const fmtStdinRes = runAice(sb, ["fmt", "--stdin"], { stdin: "fn ok() -> int:\n  ret 1\n" });
      const diffRes = runAice(sb, ["diff", "src/app.ts", "src/math.ts"]);
      records.push({
        id: "B-S2",
        category: "surface",
        title: "Hidden CLI commands (fmt, diff, create, compile, verify) operate outside unified pipeline; fmt --stdin skips enabled:false",
        sourceLocationsTs0953: [
          "src/cli/utility-commands.ts:28-286",
          "src/cli/compile-commands.ts",
          "src/cli/mcp-and-bench-commands.ts",
          "src/cli/splice-commands.ts:804+",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          fmtFileExitWhenDisabled: fmtRes.exitCode,
          fmtStdinExitWhenDisabled: fmtStdinRes.exitCode,
          fmtStdinStdout: fmtStdinRes.stdout,
          diffFileExitWhenDisabled: diffRes.exitCode,
        },
        rustRequiredBehavior: "All commands traverse PipelineRequest<Raw> -> authorize -> Governed; disabled config rejects uniformly with exit 1.",
        antiRegressionAssertions: ["Zero un-governed or un-pipelined subcommands remain"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-S3: Legacy MCP tool backdoors (aice_context, aice_create, etc.)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const mcpRes = await runMcpSession(sb, [
        { method: "initialize", params: { protocolVersion: "2024-11-05", capabilities: {} } },
        { method: "tools/call", params: { name: "aice_context", arguments: { path: "src/math.ts" } } },
      ]);
      records.push({
        id: "B-S3",
        category: "surface",
        title: "Hidden legacy MCP tool names (aice_context, aice_create, aice_outline, etc.) still execute outside 2-tool surface",
        sourceLocationsTs0953: ["src/mcp/server.ts:1053-1409,1841-2277"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          legacyAiceContextResponse: mcpRes.responses[1],
        },
        rustRequiredBehavior: "MCP executeToolCall MUST accept strictly aice_read and aice_splice (all routed through unified PipelineExecutor) and reject unknown tool names.",
        antiRegressionAssertions: ["Calling aice_context or aice_create returns JSON-RPC unknown-tool error"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-S4: Internal engine.ts early-exit forks (filesOnly & R1 search)
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const filesRes = runAice(sb, ["read", "--files"]);
      const searchRes = runAice(sb, ["read", "src", "--search", "Calculator"]);
      records.push({
        id: "B-S4",
        category: "surface",
        title: "Internal engine.ts early-exit forks (--files & R1 --search) skip unified context/telemetry pipeline",
        sourceLocationsTs0953: ["src/tools/read/engine.ts:100-102,466-523"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          filesExit: filesRes.exitCode,
          searchExit: searchRes.exitCode,
        },
        rustRequiredBehavior: "Find and Search MUST traverse PipelineExecutor<Governed> -> aice_telemetry::meter_and_seal -> StdoutWriter.",
        antiRegressionAssertions: ["find and search enforce identical governance, safe-root containment, binary filtering, and exact telemetry"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-T1: Faked o200k = cl100k
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      runAice(sb, ["find"]);
      const rawJsonl = fs.existsSync(sb.telemetryFile)
        ? fs.readFileSync(sb.telemetryFile, "utf8").trim().split("\n").filter(Boolean)
        : [];
      records.push({
        id: "B-T1",
        category: "telemetry",
        title: "Faked o200k_base equals cl100k_base instead of running real o200k_base tokenizer",
        sourceLocationsTs0953: [
          "src/tools/read/discovery.ts:595",
          "src/tools/read/search.ts:278,548",
          "src/tools/read/engine.ts:1224",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          ledgerRows: rawJsonl.map((l) => sanitizeJsonValue(JSON.parse(l), sb)),
        },
        rustRequiredBehavior: "Telemetry MUST compute real bpe-openai cl100k_base AND o200k_base independently.",
        antiRegressionAssertions: ["nativeO200k equals bpe_openai::o200k_base count (not copied from cl100k_base)"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-T2: Heuristic chars/4 approximations
  // Note: observedTs0953.spliceJson telemetry fields include the exact temp-path length
  // of os.tmpdir()/aice-golden-XXXXXX/ws before <ROOT> path sanitization (+-1 to 3 token variance).
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  return 0;\n}", "--json"], {
        expectJson: true,
      });
      records.push({
        id: "B-T2",
        category: "telemetry",
        title: "Heuristic chars/4, chars/3.8, bytes/3.5 approximations instead of exact BPE counts",
        sourceLocationsTs0953: [
          "src/tools/read/discovery.ts:583",
          "src/tools/read/search.ts:278",
          "src/tools/splice/native-orchestrator.ts:1561",
          "src/cli/telemetry-and-flags.ts:84",
          "src/tools/create.ts:1497-1515",
          "src/tools/outline.ts:1065,1068",
          "src/mcp/server.ts:1256",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          spliceJson: res.stdoutJson,
          telemetryPathVarianceNote: TELEMETRY_PATH_VARIANCE_NOTE,
        },
        rustRequiredBehavior: "Zero heuristic char/byte division; 100% exact bpe-openai cl100k_base & o200k_base counts.",
        antiRegressionAssertions: ["All telemetry token counts match bpe-openai exact counts with 0 tolerance"],
      });
    } finally {
      sb.cleanup();
    }
  }
  // B-T3: Search & Discovery baseline inflation
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      runAice(sb, ["find"]);
      runAice(sb, ["search", "Calculator"]);
      const rawJsonl = fs.existsSync(sb.telemetryFile)
        ? fs.readFileSync(sb.telemetryFile, "utf8").trim().split("\n").filter(Boolean)
        : [];
      records.push({
        id: "B-T3",
        category: "telemetry",
        title: "find/search telemetry inflates baseline by summing unread file bodies across workspace",
        sourceLocationsTs0953: ["src/tools/read/discovery.ts:583-595", "src/tools/read/search.ts:525-548"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          ledgerRows: rawJsonl.map((l) => sanitizeJsonValue(JSON.parse(l), sb)),
        },
        rustRequiredBehavior: "find/search baseline MUST reflect equivalent native find/rg command output, never full unread corpus file contents.",
        antiRegressionAssertions: ["find/search baseline tokens equal honest native discovery/grep output tokens"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-T4: Negative savings clamping & splice baseline inflation
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const res = runAice(sb, ["splice", "src/big.ts", "-s", "L2-L5", "-c", "  const warnings: string[] = [];\n  let acc = seed;\n  let processed = 0;"]);
      records.push({
        id: "B-T4",
        category: "telemetry",
        title: "Math.max(0, ...) clamping and splice comparing whole-file tokens vs short snippet",
        sourceLocationsTs0953: [
          "src/cli/mcp-and-bench-commands.ts:375,567",
          "src/tools/outline.ts:1070",
          "src/tools/create.ts:227,1497-1515",
          "src/tools/splice/batch.ts:1601",
        ],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          command: "splice src/big.ts -s L2-L5 -c '...'",
          stdout: res.stdout,
        },
        rustRequiredBehavior: "Preserve negative signed token deltas faithfully; never clamp to 0 or 1 or compare whole file against snippet.",
        antiRegressionAssertions: ["Negative token savings are recorded with negative sign in ledger and gain"],
      });
    } finally {
      sb.cleanup();
    }
  }

  // B-T5: Synthetic sanitizeHonestRealisticBaseline multipliers
  records.push({
    id: "B-T5",
    category: "telemetry",
    title: "Synthetic sanitizeHonestRealisticBaseline multipliers (multiFilesCount * 10 / 45 / 80)",
    sourceLocationsTs0953: ["src/telemetry/index.ts:709-730"],
    ts0953EvidenceType: "static_code_audit",
    observedTs0953: {
      note: "TS telemetry/index.ts applies synthetic multipliers when rawBaseline is missing or heuristic.",
    },
    rustRequiredBehavior: "Rust PipelineResult<Executed> ALWAYS carries actual raw_baseline_payload bytes/tokens with zero synthetic multipliers.",
    antiRegressionAssertions: ["No magic multiplier constants in telemetry metering"],
  });

  // B-T6: statsText omitted from aiceCl100k & --json undefined gap
  {
    const sb = createSandbox({ config: "enabled" });
    try {
      const statsRes = runAice(sb, ["read", "src/app.ts", "--stats"]);
      const rawJsonl = fs.existsSync(sb.telemetryFile)
        ? fs.readFileSync(sb.telemetryFile, "utf8").trim().split("\n").filter(Boolean)
        : [];
      records.push({
        id: "B-T6",
        category: "telemetry",
        title: "--stats footer omitted from recorded aiceCl100k and --json skips tokenCount tracking",
        sourceLocationsTs0953: ["src/tools/read/engine.ts:1958,2154", "src/tools/read/search.ts:296,552"],
        ts0953EvidenceType: "live_probe",
        observedTs0953: {
          stdoutWithStats: statsRes.stdout,
          exactStdoutTokensCl100k: countBpe(statsRes.stdout, "cl100k_base"),
          ledgerRows: rawJsonl.map((l) => sanitizeJsonValue(JSON.parse(l), sb)),
        },
        rustRequiredBehavior: "meter_and_seal MUST count the complete final stdout payload (including all headers, framing, and --stats footers).",
        antiRegressionAssertions: ["Logged emitted tokens === exact BPE count of full stdout bytes"],
      });
    } finally {
      sb.cleanup();
    }
  }

  return records;
}

async function main(): Promise<void> {
  const verSb = createSandbox({ copySrc: false, config: "none" });
  try {
    const ver = runAice(verSb, ["--version"]);
    if (ver.exitCode !== 0 || ver.stdout.trim() !== "0.9.53") {
      throw new Error(`Expected repo bin/aice.ts version 0.9.53, got exit=${ver.exitCode} stdout=${JSON.stringify(ver.stdout)}`);
    }
  } finally {
    verSb.cleanup();
  }

  const gitCommit = execSync("git rev-parse HEAD", { cwd: REPO_ROOT, encoding: "utf8" }).trim();

  console.log("Capturing 01_governance_config...");
  const s01 = captureGovernanceSuite();
  console.log("Capturing 02_find_discovery...");
  const s02 = captureFindSuite();
  console.log("Capturing 03_search_ranking...");
  const s03 = captureSearchSuite();
  console.log("Capturing 04_read_pipeline...");
  const s04 = captureReadSuite();
  console.log("Capturing 05_splice_write...");
  const s05 = captureSpliceSuite();
  console.log("Capturing 06_firewalls_rollback...");
  const s06 = captureFirewallRollbackSuite();
  console.log("Capturing 07_mcp_surface...");
  const s07 = await captureMcpSuite();
  console.log("Capturing 08_telemetry_gain...");
  const s08 = captureTelemetrySuite();
  console.log("Capturing 09_anti_bypass...");
  const s09 = await captureAntiBypassSuite();

  writeSuite("01_governance_config", gitCommit, s01);
  writeSuite("02_find_discovery", gitCommit, s02);
  writeSuite("03_search_ranking", gitCommit, s03);
  writeSuite("04_read_pipeline", gitCommit, s04);
  writeSuite("05_splice_write", gitCommit, s05);
  writeSuite("06_firewalls_rollback", gitCommit, s06);
  writeSuite("07_mcp_surface", gitCommit, s07);
  writeSuite("08_telemetry_gain", gitCommit, s08, TELEMETRY_PATH_VARIANCE_NOTE);
  writeSuite("09_anti_bypass", gitCommit, s09);

  const manifest = {
    schemaVersion: "1.0.0",
    repoVersion: "0.9.53",
    captureEntry: "bin/aice.ts",
    gitCommit,
    capturedAtUtc: new Date().toISOString(),
    suites: {
      "01_governance_config.json": s01.length,
      "02_find_discovery.json": s02.length,
      "03_search_ranking.json": s03.length,
      "04_read_pipeline.json": s04.length,
      "05_splice_write.json": s05.length,
      "06_firewalls_rollback.json": s06.length,
      "07_mcp_surface.json": s07.length,
      "08_telemetry_gain.json": s08.length,
      "09_anti_bypass.json": s09.length,
    },
    totalCases: s01.length + s02.length + s03.length + s04.length + s05.length + s06.length + s07.length + s08.length + s09.length,
    telemetryVarianceNote: TELEMETRY_PATH_VARIANCE_NOTE,
    rustUpgradeDeltaContract: {
      law3SinglePipeline: "100% of reads, searches, find, writes, and MCP calls traverse Governance -> Resolution -> PipelineExecutor -> Honest BPE Telemetry -> StdoutWriter.",
      r3DefaultAiceTransformation: "Where TS v0.9.53 defaulted rawNative:true (emitting raw native source unless --dsl was passed), Rust transforms ALL supported R5/Twig/R6 files into AICE IR by default. Only LanguageId::PlainText uses TranspileOutcome::UnsupportedPassthrough.",
      r5AndR6ParserUpgrades: "Replaces TS delimiter-only validators (Rust/Go/C++/C#/Java/Kotlin/PHP) and external python3/bash spawns with 100% in-process tree-sitter + original Rust RD/Pratt parsers across all 22 R5 + Twig + 9 R6 DB dialects.",
      antiBypassClosure: "All 23 documented bypasses (B-R1..B-R8, B-W1..B-W5, B-S1..B-S4, B-T1..B-T6) in 09_anti_bypass.json MUST be verified closed in Waves 2-5.",
    },
  };

  fs.writeFileSync(path.join(GOLDEN_DIR, "MANIFEST.json"), `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  console.log(`Captured ${manifest.totalCases} golden cases across 9 suites into ${CASES_DIR}`);
}

void main().catch((err) => {
  console.error("capture-golden failed:", err);
  process.exit(1);
});
