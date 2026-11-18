import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { normalizeCliContextFlag } from "../../bin/aice.js";
import {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  KNOWN_TARGET_EXTENSIONS,
  PASSTHROUGH_FILENAMES,
  resolvePathTargets,
  scanDirectoryFiles,
  setProjectAiceEnabled,
  upsertMarkdownDirective,
} from "../../src/config/index.js";
import { AICE_MCP_TOOLS, AiceMcpServer, type McpToolCallResult } from "../../src/mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";
import {
  computeProjectSystemicEconomics,
  loadTelemetryErrors,
  readTelemetryEvents,
} from "../../src/telemetry/index.js";
import { TiktokenTokenizer } from "../../src/tokenomics/index.js";
import { createFile } from "../../src/tools/create.js";
import { spliceBatch } from "../../src/tools/splice.js";
import { AICE_VERSION } from "../../src/version.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");
const INSTALL_SH = path.resolve(process.cwd(), "install.sh");

function runCli(args: string[], cwd: string, opts?: { input?: string; env?: NodeJS.ProcessEnv }) {
  return spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    input: opts?.input,
    env: opts?.env ?? process.env,
    encoding: "utf-8",
    timeout: 30000,
  });
}

describe("v0.9.51 CLI, MCP, Mandatory Rules, Config & install.sh Fixes (C1–C7)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-c1-c7-test-"));
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Single Start Marker & <= 900B / <= 300 BPE Token Mandatory Rules (C5)", () => {
    it("emits ONLY ONE <!-- AICE:START vX.Y.Z --> marker and stays <= 900B & <= 300 tokens", () => {
      const startMatches = MANDATORY_AGENT_RULES_MARKDOWN.match(/<!--\s*AICE:START[^>]*-->/g) ?? [];
      expect(startMatches).toEqual([`<!-- AICE:START v${AICE_VERSION} -->`]);
      expect(AICE_DIRECTIVE_START).toBe(`<!-- AICE:START v${AICE_VERSION} -->`);
      expect(MANDATORY_AGENT_RULES_MARKDOWN.endsWith(AICE_DIRECTIVE_END)).toBe(true);

      const byteLen = Buffer.byteLength(MANDATORY_AGENT_RULES_MARKDOWN, "utf-8");
      const cl100k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base");
      const o200k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "o200k_base");

      expect(byteLen).toBeLessThanOrEqual(900);
      expect(cl100k).toBeLessThanOrEqual(300);
      expect(o200k).toBeLessThanOrEqual(300);

      // Essential guidance coverage
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice.config.json");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain('"enabled": true');
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("'f:/a|b/'");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("find -d");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("=== f:sym ===");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("=== f:L1-L20 ===");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("--delete");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toMatch(/multi-line[\s\S]*<<</i);
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        "Use AICE (aice read / aice splice) for all file exploration and edits.",
      );
    });

    it("cleanly strips legacy double <!-- AICE:START --> markers on re-sync", () => {
      const agentsMd = path.join(tmpDir, "AGENTS.md");
      fs.writeFileSync(
        agentsMd,
        [
          "# Team Guidelines",
          "",
          "<!-- AICE:START -->",
          "<!-- AICE:START v0.9.50 -->",
          "Old bloated rules block",
          "<!-- AICE:END -->",
          "",
          "Keep this project footer.",
        ].join("\n"),
        "utf-8",
      );

      upsertMarkdownDirective(agentsMd);
      const updated = fs.readFileSync(agentsMd, "utf-8");
      const startMarkers = updated.match(/<!--\s*AICE:START[^>]*-->/g) ?? [];
      expect(startMarkers).toEqual([`<!-- AICE:START v${AICE_VERSION} -->`]);
      expect(updated).toContain("# Team Guidelines");
      expect(updated).toContain("Keep this project footer.");
    });
  });

  describe("2. install.sh Zero ~/dev Pollution, Extensions/Extensionless & Git/Cap Safety (C6)", () => {
    it("does NOT scan or touch unrelated ~/dev/* folders during ./install.sh by default", () => {
      const fakeHome = path.join(tmpDir, "fake-home");
      const devDir = path.join(fakeHome, "dev");
      const nonAiceDir = path.join(devDir, "demo_nonaice");
      const androidEnvDir = path.join(devDir, "android-env");
      fs.mkdirSync(nonAiceDir, { recursive: true });
      fs.mkdirSync(androidEnvDir, { recursive: true });
      const sentinelMd = path.join(nonAiceDir, "AGENTS.md");
      fs.writeFileSync(sentinelMd, "# Pure Native Control Project\n", "utf-8");

      const installContent = fs.readFileSync(INSTALL_SH, "utf-8");
      // Dry-run must not claim automatic ~/dev/* refresh when not requested
      const dryRes = spawnSync(INSTALL_SH, ["--dry-run", "--no-update", "--no-cheatsheet"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: fakeHome, AICE_AGENT_HOME: fakeHome },
        encoding: "utf-8",
      });
      expect(dryRes.status).toBe(0);
      expect(dryRes.stdout).not.toContain("across ~/dev/*");
      expect(installContent).toContain("--sync-projects");
      expect(fs.readFileSync(sentinelMd, "utf-8")).toBe("# Pure Native Control Project\n");
      expect(fs.existsSync(path.join(nonAiceDir, "aice.config.json"))).toBe(false);
    });

    it("recognizes .java, .pro, .webmanifest, .example, .gradle, .kts, .properties, .xml and extensionless scripts", () => {
      for (const ext of [
        ".java",
        ".pro",
        ".webmanifest",
        ".example",
        ".gradle",
        ".kts",
        ".properties",
        ".xml",
      ]) {
        expect(KNOWN_TARGET_EXTENSIONS.has(ext)).toBe(true);
      }
      expect(PASSTHROUGH_FILENAMES.has("verify")).toBe(true);
      expect(PASSTHROUGH_FILENAMES.has("new-project")).toBe(true);

      // Shebang extensionless script discovery & single-file resolution
      const verifyPath = path.join(tmpDir, "verify");
      const customBin = path.join(tmpDir, "run-checks");
      const javaPath = path.join(tmpDir, "MainActivity.java");
      fs.writeFileSync(verifyPath, "#!/usr/bin/env bash\necho ok\n", "utf-8");
      fs.writeFileSync(customBin, "#!/usr/bin/env python3\nprint('ok')\n", "utf-8");
      fs.writeFileSync(javaPath, "public class MainActivity {}\n", "utf-8");

      const resolvedVerify = resolvePathTargets("verify", {
        projectRoot: tmpDir,
        includeTargets: true,
      });
      expect(resolvedVerify.isSingleFile).toBe(true);

      const resolvedNewProj = resolvePathTargets(path.join(tmpDir, "new-project"), {
        projectRoot: tmpDir,
        includeTargets: true,
      });
      expect(resolvedNewProj.isSingleFile).toBe(true);

      const scanned = scanDirectoryFiles(
        tmpDir,
        { includeTargets: true },
        resolvedVerify.config,
        tmpDir,
      );
      expect(scanned).toContain(verifyPath);
      expect(scanned).toContain(customBin);
      expect(scanned).toContain(javaPath);
    });

    it("adds untracked aice.config.json to .git/info/exclude and protects AGENTS.md > 22,000B unless --force", () => {
      const repoDir = path.join(tmpDir, "git-repo");
      fs.mkdirSync(repoDir, { recursive: true });
      spawnSync("git", ["init"], { cwd: repoDir, stdio: "ignore" });
      spawnSync("git", ["config", "user.email", "test@example.com"], { cwd: repoDir });
      spawnSync("git", ["config", "user.name", "Test"], { cwd: repoDir });

      // Pre-populate AGENTS.md at 21,600 bytes so adding directive would exceed 22,000 B
      const bigAgentsContent = `# Repo Spec\n\n${"A".repeat(21_585)}\n`;
      const agentsMdPath = path.join(repoDir, "AGENTS.md");
      fs.writeFileSync(agentsMdPath, bigAgentsContent, "utf-8");
      spawnSync("git", ["add", "AGENTS.md"], { cwd: repoDir });
      spawnSync("git", ["commit", "-m", "init"], { cwd: repoDir });

      const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
      try {
        setProjectAiceEnabled(repoDir, true);
        expect(warnSpy).toHaveBeenCalled();
        expect(warnSpy.mock.calls[0]?.[0]).toMatch(/22,?000/);
      } finally {
        warnSpy.mockRestore();
      }

      // AGENTS.md protected (not pushed over 22,000 B), and git status is 100% clean!
      expect(
        Buffer.byteLength(fs.readFileSync(agentsMdPath, "utf-8"), "utf-8"),
      ).toBeLessThanOrEqual(22_000);
      expect(fs.existsSync(path.join(repoDir, ".gitignore"))).toBe(false);
      const excludeContent = fs.readFileSync(
        path.join(repoDir, ".git", "info", "exclude"),
        "utf-8",
      );
      expect(excludeContent).toContain("aice.config.json");

      const statusOut = spawnSync("git", ["status", "--porcelain"], {
        cwd: repoDir,
        encoding: "utf-8",
      }).stdout;
      expect(statusOut.trim()).toBe("");

      // Explicit --force overrides the 22,000 B cap when requested
      const forceWarnings: string[] = [];
      setProjectAiceEnabled(repoDir, true, {
        force: true,
        onWarning: (m) => forceWarnings.push(m),
      });
      expect(forceWarnings.length).toBe(1);
      expect(fs.readFileSync(agentsMdPath, "utf-8")).toContain(
        `<!-- AICE:START v${AICE_VERSION} -->`,
      );
    });
  });

  describe("3. MCP Schema <= 2,600 Chars / <= 600 Tokens & JSON-RPC isError: true (C7)", () => {
    it("compresses AICE_MCP_TOOLS to <= 2,600 chars & <= 600 tokens while preserving all tool names and properties", () => {
      const serialized = JSON.stringify(AICE_MCP_TOOLS);
      const cl100k = TiktokenTokenizer.count(serialized, "cl100k_base");
      const o200k = TiktokenTokenizer.count(serialized, "o200k_base");

      expect(serialized.length).toBeLessThanOrEqual(2600);
      expect(cl100k).toBeLessThanOrEqual(600);
      expect(o200k).toBeLessThanOrEqual(600);

      expect(AICE_MCP_TOOLS.map((t) => t.name)).toEqual(["aice_read", "aice_splice"]);
      const readProps = Object.keys(AICE_MCP_TOOLS[0]!.inputSchema.properties);
      const spliceProps = Object.keys(AICE_MCP_TOOLS[1]!.inputSchema.properties);

      for (const p of [
        "path",
        "paths",
        "targets",
        "filePath",
        "fileOrDir",
        "symbol",
        "selector",
        "search",
        "filesOnly",
        "contextLines",
        "dsl",
        "outline",
        "full",
        "depth",
        "maxTokens",
        "includeDeps",
        "includeCallers",
        "compact",
        "types",
        "idioms",
        "stats",
        "json",
      ]) {
        expect(readProps).toContain(p);
      }

      for (const p of [
        "filePath",
        "path",
        "fileOrDir",
        "symbolSelector",
        "symbol",
        "selector",
        "range",
        "code",
        "content",
        "newAiceCode",
        "body",
        "delete",
        "create",
        "force",
        "overwrite",
        "insertAfter",
        "insertBefore",
        "preserveDocs",
        "dryRun",
        "idioms",
        "inlineIdioms",
        "edits",
        "batch",
        "files",
      ]) {
        expect(spliceProps).toContain(p);
      }
    });

    it("returns MCP { content: [...], isError: true } instead of JSON-RPC -32603 on tool errors", async () => {
      fs.writeFileSync(path.join(tmpDir, "app.ts"), "export const x = 1;\n", "utf-8");
      const inStream = new Readable({ read() {} });
      const outputs: string[] = [];
      const outStream = new Writable({
        write(chunk, _enc, cb) {
          outputs.push(chunk.toString("utf-8"));
          cb();
        },
      });
      const server = new AiceMcpServer(inStream, outStream, { workspaceRoot: tmpDir });

      // 1. JSON-RPC object handleRequest
      const objRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 42,
        method: "tools/call",
        params: {
          name: "aice_splice",
          arguments: { filePath: "app.ts", symbol: "missingSymbol", code: "export const x = 2;" },
        },
      })) as { jsonrpc: string; id: number; result?: McpToolCallResult; error?: unknown };

      expect(objRes.error).toBeUndefined();
      expect(objRes.result?.isError).toBe(true);
      expect(objRes.result?.content[0]?.text).toMatch(/missingSymbol|not found/i);

      // 2. Stdio stream processSingleMessage
      inStream.push(
        Buffer.from(
          `${JSON.stringify({
            jsonrpc: "2.0",
            id: "stdio-1",
            method: "tools/call",
            params: {
              name: "aice_read",
              arguments: { path: "../../etc/passwd" },
            },
          })}\n`,
          "utf-8",
        ),
      );
      await new Promise((r) => setTimeout(r, 35));
      const parsedWire = JSON.parse(outputs.join("").trim()) as {
        id: string;
        result?: McpToolCallResult;
        error?: { code: number };
      };
      expect(parsedWire.id).toBe("stdio-1");
      expect(parsedWire.error).toBeUndefined();
      expect(parsedWire.result?.isError).toBe(true);
      expect(parsedWire.result?.content[0]?.text).toContain("Access denied");
    });
  });

  describe("4. CLI Flags (find -d/-L/--max-depth/--search, search -n/-s, status, --no-color, --delete) & 7 Error Telemetry Paths (C1–C4)", () => {
    it("supports find -d/--depth/--max-depth/-L/--search, search -n/-s, status, --no-color, and --stdin --delete", () => {
      setProjectAiceEnabled(tmpDir, true);
      fs.mkdirSync(path.join(tmpDir, "src", "nested", "deep"), { recursive: true });
      fs.mkdirSync(path.join(tmpDir, "docs"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "root.ts"), "export const ROOT = 1;\n", "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "src", "mid.ts"),
        "export function alphaTarget(): number {\n  return 1;\n}\nexport function betaKeep(): number {\n  return 2;\n}\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "nested", "deep", "leaf.ts"),
        "export const LEAF = 3;\n",
        "utf-8",
      );
      fs.writeFileSync(path.join(tmpDir, "docs", "guide.md"), "# Guide\n", "utf-8");

      // Normalize flag checks
      expect(normalizeCliContextFlag(["find", "*", ".", "-L", "2"], { from: "user" })).toEqual([
        "find",
        "*",
        ".",
        "-d",
        "2",
      ]);
      expect(
        normalizeCliContextFlag(["find", "*", ".", "--max-depth", "2"], { from: "user" }),
      ).toEqual(["find", "*", ".", "-d", "2"]);

      const findDepth1 = runCli(["find", "-d", "1"], tmpDir);
      expect(findDepth1.status).toBe(0);
      expect(findDepth1.stdout).toContain("root.ts");
      expect(findDepth1.stdout).not.toContain("src/mid.ts");
      expect(findDepth1.stdout).not.toContain("leaf.ts");

      const findMaxDepth2 = runCli(["find", "*", ".", "--max-depth", "2"], tmpDir);
      expect(findMaxDepth2.status).toBe(0);
      expect(findMaxDepth2.stdout).toContain("src/mid.ts");
      expect(findMaxDepth2.stdout).not.toContain("leaf.ts");

      const findL2 = runCli(["find", "*", ".", "-L", "2"], tmpDir);
      expect(findL2.status).toBe(0);
      expect(findL2.stdout).toContain("src/mid.ts");
      expect(findL2.stdout).not.toContain("leaf.ts");

      const findSearch = runCli(["find", "--search", "src/|docs/"], tmpDir);
      expect(findSearch.status).toBe(0);
      expect(findSearch.stdout).toContain("src/mid.ts");
      expect(findSearch.stdout).toContain("docs/guide.md");
      expect(findSearch.stdout).not.toContain("root.ts");

      // search -n and -s
      const searchN = runCli(["search", "alphaTarget", "src", "-n"], tmpDir);
      expect(searchN.status).toBe(0);
      expect(searchN.stdout).toContain("alphaTarget");

      const searchWithS = runCli(["search", "return", "src/mid.ts", "-s", "/alphaTarget/"], tmpDir);
      expect(searchWithS.status).toBe(0);
      expect(searchWithS.stdout).toContain("alphaTarget");

      const searchOnlyS = runCli(["search", "-s", "alphaTarget", "src"], tmpDir);
      expect(searchOnlyS.status).toBe(0);
      expect(searchOnlyS.stdout).toContain("alphaTarget");

      // status alias & --no-color
      const statusRes = runCli(["status", "--json"], tmpDir);
      expect(statusRes.status).toBe(0);
      expect(JSON.parse(statusRes.stdout).enabled).toBe(true);

      const gainNoColor = runCli(["gain", "--no-color"], tmpDir);
      expect(gainNoColor.status).toBe(0);
      expect(gainNoColor.stdout).not.toContain("\u001b[");

      // --stdin empty-body === file:L1-L3 === --delete
      const delStdin = runCli(["splice", "--stdin"], tmpDir, {
        input: "=== src/mid.ts:L1-L3 === --delete\n",
      });
      expect(delStdin.status).toBe(0);
      const afterDel = fs.readFileSync(path.join(tmpDir, "src", "mid.ts"), "utf-8");
      expect(afterDel).not.toContain("alphaTarget");
      expect(afterDel).toContain("betaKeep");
    });

    it("records failure telemetry with wasted token estimate across early process.exit(1) paths without double-logging", () => {
      const ledgerPath = path.join(tmpDir, "telemetry", "gains.jsonl");
      const env = { ...process.env, AICE_TELEMETRY_PATH: ledgerPath };
      const projDir = path.join(tmpDir, "err-proj");
      fs.mkdirSync(projDir, { recursive: true });
      setProjectAiceEnabled(projDir, true);
      fs.writeFileSync(path.join(projDir, "target.ts"), "export const A = 1;\n", "utf-8");

      // 1. Malformed target trailing ':'
      const r1 = runCli(["splice", "target.ts:"], projDir, { env });
      expect(r1.status).toBe(1);

      // 2. Invalid --stdin without === header (with 200-token wasted payload!)
      const bigWastedStdin = `export function wastedCode() {\n${"  const v = 12345;\n".repeat(30)}}\n`;
      const r2 = runCli(["splice", "--stdin"], projDir, { input: bigWastedStdin, env });
      expect(r2.status).toBe(1);

      // 3. Missing --from file
      const r3 = runCli(["splice", "target.ts", "--from", "missing-source.ts"], projDir, { env });
      expect(r3.status).toBe(1);

      // 4. Non-array --edits JSON
      const r4 = runCli(["splice", "target.ts", "--edits", '{"not":"array"}'], projDir, { env });
      expect(r4.status).toBe(1);

      // 5. Empty splice body
      const r5 = runCli(["splice", "target.ts:A"], projDir, { env });
      expect(r5.status).toBe(1);

      // Disable project to test disabled single-file (6) and disabled batch (7)
      setProjectAiceEnabled(projDir, false);
      const r6 = runCli(["splice", "target.ts", "-c", "export const A = 2;"], projDir, { env });
      expect(r6.status).toBe(1);
      const r7 = runCli(
        [
          "splice",
          "--batch",
          JSON.stringify([{ filePath: "target.ts", code: "export const A = 3;" }]),
        ],
        projDir,
        { env },
      );
      expect(r7.status).toBe(1);

      const errors = loadTelemetryErrors(projDir, ledgerPath);
      const events = readTelemetryEvents(ledgerPath).filter((e) => e.filePath === "<cli-error>");
      expect(errors.length).toBe(7);
      expect(events.length).toBe(7);
      expect(errors[0]?.filePath).toBe("target.ts");
      expect(errors[2]?.filePath).toBe("target.ts");
      expect(errors[3]?.filePath).toBe("target.ts");
      expect(errors[4]?.filePath).toBe("target.ts");
      expect(errors[5]?.filePath).toBe("target.ts");
      expect(errors[6]?.filePath).toBe("target.ts");

      // Wasted stdin tokens must be reflected in the failed --stdin telemetry event (#2)
      const wastedStdinEvent = events[1]!;
      expect(wastedStdinEvent.aiceCl100k).toBeGreaterThan(200);
    });
  });

  describe("5. Post-Merge Audit & Real-Case Regressions (#64 & #65)", () => {
    it("supports aice find -d 1 & -d 2 from subdirectories and compact aice outline headers (#64.1, #64.5)", () => {
      setProjectAiceEnabled(tmpDir, true);
      fs.mkdirSync(path.join(tmpDir, "src", "nested", "deep"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src", "mid.ts"),
        "export function alpha(): number { return 1; }\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "nested", "sub.ts"),
        "export const SUB = 2;\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "src", "nested", "deep", "leaf.ts"),
        "export const LEAF = 3;\n",
        "utf-8",
      );

      const srcCwd = path.join(tmpDir, "src");
      const subFindD1 = runCli(["find", "-d", "1"], srcCwd);
      expect(subFindD1.status).toBe(0);
      expect(subFindD1.stdout).toContain("mid.ts");
      expect(subFindD1.stdout).toContain("nested/");
      expect(subFindD1.stdout).not.toContain("leaf.ts");

      const subFindD2 = runCli(["find", "-d", "2"], srcCwd);
      expect(subFindD2.status).toBe(0);
      expect(subFindD2.stdout).toContain("mid.ts");
      expect(subFindD2.stdout).toContain("nested/sub.ts");
      expect(subFindD2.stdout).toContain("nested/deep/");
      expect(subFindD2.stdout).not.toContain("leaf.ts");

      const outlineRes = runCli(["outline", "src"], tmpDir);
      expect(outlineRes.status).toBe(0);
      expect(outlineRes.stdout).not.toContain("// ===");
      expect(outlineRes.stdout).toContain("// ");
    });

    it("records surgical realisticNativeCl100k & error wastedInputTokens on MCP splice, un-clamped negative create, and 1x wrapper tax on spliceBatch (#64.2, #64.4, #65.2)", async () => {
      const projDir = path.join(tmpDir, "honest-mcp-proj");
      fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
      setProjectAiceEnabled(projDir, true);
      const ledgerPath = path.join(tmpDir, "mcp-honest-gains.jsonl");
      const prevLedger = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = ledgerPath;

      try {
        // Large 120-line file so surgical edit_file baseline << full-file nativeCl100k
        const bigLines = Array.from(
          { length: 120 },
          (_, i) => `export function fn_${i}(): number { return ${i}; }`,
        );
        const targetFp = path.join(projDir, "src", "service.ts");
        fs.writeFileSync(targetFp, `${bigLines.join("\n")}\n`, "utf-8");
        const secondFp = path.join(projDir, "src", "helper.ts");
        fs.writeFileSync(secondFp, `${bigLines.join("\n")}\n`, "utf-8");

        const server = new AiceMcpServer({ workspaceRoot: projDir });

        // 1) Single-file MCP aice_splice surgical edit
        const mcpEdit = (await server.handleRequest({
          jsonrpc: "2.0",
          id: "m1",
          method: "tools/call",
          params: {
            name: "aice_splice",
            arguments: {
              filePath: "src/service.ts",
              symbol: "fn_0",
              code: "export function fn_0(): number { return 999; }",
            },
          },
        })) as { result: McpToolCallResult };
        expect(mcpEdit.result.isError).toBeFalsy();

        // 2) MCP error records wastedInputTokens > 0
        const mcpErr = (await server.handleRequest({
          jsonrpc: "2.0",
          id: "m2",
          method: "tools/call",
          params: {
            name: "aice_splice",
            arguments: {
              filePath: "src/service.ts",
              symbol: "nonExistentSymbol_xyz",
              code: "export function nonExistentSymbol_xyz() { return 0; }",
            },
          },
        })) as { result: McpToolCallResult };
        expect(mcpErr.result.isError).toBe(true);

        const mcpEvs = readTelemetryEvents(ledgerPath);
        expect(mcpEvs.length).toBe(1);
        expect(mcpEvs[0]?.realisticNativeCl100k).toBeDefined();
        expect(mcpEvs[0]!.realisticNativeCl100k!).toBeLessThan(mcpEvs[0]!.nativeCl100k / 4);

        const mcpErrors = loadTelemetryErrors(projDir, ledgerPath);
        expect(mcpErrors.length).toBe(1);
        expect(mcpErrors[0]?.wastedInputTokens).toBeGreaterThan(10);

        // 3) Negative-delta createFile must NOT clamp savedCl100k to >= 0 (#64.4)
        const negLedger = path.join(tmpDir, "neg-create-gains.jsonl");
        process.env.AICE_TELEMETRY_PATH = negLedger;
        const negTarget = path.join(projDir, "src", "tiny.ts");
        const negRes = await createFile(negTarget, {
          code: [
            "@idiom $unusedHelperOne(a, b) => a + b + 12345",
            "@idiom $unusedHelperTwo(c, d) => c * d * 67890",
            "export const X = 1;",
          ].join("\n"),
          projectRoot: projDir,
        });
        expect(negRes.savedCl100k).toBeLessThan(0);
        const negEvs = readTelemetryEvents(negLedger);
        expect(negEvs.length).toBe(1);
        expect(negEvs[0]!.aiceCl100k).toBeGreaterThan(negEvs[0]!.nativeCl100k);
        expect(negEvs[0]!.savedCl100k).toBeLessThan(0);

        // 4) Multi-file spliceBatch attaches batch summary once & charges 1x 70 wrapper tax (#65.2)
        const batchLedger = path.join(tmpDir, "batch-splice-gains.jsonl");
        process.env.AICE_TELEMETRY_PATH = batchLedger;
        const batchStream = [
          `=== ${targetFp}:fn_1 ===`,
          "export function fn_1(): number { return 101; }",
          `=== ${secondFp}:fn_2 ===`,
          "export function fn_2(): number { return 202; }",
        ].join("\n");
        await spliceBatch(batchStream, { projectRoot: projDir, surface: "cli" });
        const batchEvs = readTelemetryEvents(batchLedger);
        expect(batchEvs.length).toBe(2);
        // Item 2 does not carry duplicate 19-token batch summary bloat
        expect(batchEvs[1]!.aiceCl100k).toBeLessThan(batchEvs[0]!.aiceCl100k);
        const econ = computeProjectSystemicEconomics(batchEvs, []);
        expect(econ.wrapperTaxCl100k).toBe(70);
      } finally {
        if (prevLedger === undefined) {
          delete process.env.AICE_TELEMETRY_PATH;
        } else {
          process.env.AICE_TELEMETRY_PATH = prevLedger;
        }
      }
    });
  });
});
