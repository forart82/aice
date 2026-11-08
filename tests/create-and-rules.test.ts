import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  AICE_SYSTEM_DIRECTIVE,
  ALWAYS_ON_AICE_RULE_FILE,
  removeAgents,
  setupAgents,
} from "../src/agents/index.js";
import {
  isProjectAiceEnabled,
  loadProjectConfig,
  setProjectAiceEnabled,
} from "../src/config/index.js";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";
import {
  buildGainReport,
  formatGlobalGainDashboard,
  readTelemetryEvents,
} from "../src/telemetry/index.js";
import { createBatch, createFile, splice, spliceBatch } from "../src/tools/index.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");
const UNINSTALL_SH = path.resolve(process.cwd(), "uninstall.sh");

function runCli(args: string[], cwd: string, env?: NodeJS.ProcessEnv) {
  return spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 20000,
    env: { ...process.env, ...env },
  });
}

describe("AICE v0.9.5: Greenfield File Creation (createFile / createBatch / MCP aice_create), Auto-Create Splice, Mandatory Rules & Project Rule Sync", () => {
  let tmpDir: string;
  let telemetryFile: string;
  let prevTelemetryFile: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-create-rules-"));
    telemetryFile = path.join(tmpDir, "telemetry", "gains.jsonl");
    prevTelemetryFile = process.env.AICE_TELEMETRY_PATH;
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
  });

  afterEach(() => {
    if (prevTelemetryFile === undefined) {
      delete process.env.AICE_TELEMETRY_PATH;
    } else {
      process.env.AICE_TELEMETRY_PATH = prevTelemetryFile;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Phase 1: Greenfield & Startup File Creation Engine (createFile & createBatch)", () => {
    it("creates native files across all 15 languages / 24 extensions from compact AICE", async () => {
      const cases: Array<{
        ext: string;
        code: string;
        expectedSubstring: string;
      }> = [
        {
          ext: ".ts",
          code: "^fn add(a:#,b:#)-># => a + b",
          expectedSubstring: "export function add(a: number, b: number): number",
        },
        {
          ext: ".tsx",
          code: '^fn App()->$ => "<div/>"',
          expectedSubstring: "export function App(): string",
        },
        {
          ext: ".js",
          code: "^fn mul(a:#,b:#)-># => a * b",
          expectedSubstring: "export function mul(a, b)",
        },
        {
          ext: ".jsx",
          code: '^fn View()->$ => "ok"',
          expectedSubstring: "export function View()",
        },
        {
          ext: ".mjs",
          code: "^fn greet(n:$)->$ => n",
          expectedSubstring: "export function greet(n)",
        },
        {
          ext: ".cjs",
          code: "^fn calc(x:#)-># => x + 1",
          expectedSubstring: "function calc(x)",
        },
        {
          ext: ".py",
          code: "fn compute(x:#,y:#)-># => x + y",
          expectedSubstring: "def compute(x: float, y: float) -> float:",
        },
        {
          ext: ".rs",
          code: "^fn distance(x:#,y:#)-># => x + y",
          expectedSubstring: "pub fn distance(x: f64, y: f64) -> f64",
        },
        {
          ext: ".go",
          code: "^fn Sum(a:#,b:#)-># => a + b",
          expectedSubstring: "func Sum(a float64, b float64) float64",
        },
        {
          ext: ".cpp",
          code: "^fn clampVal(v:#)-># => v",
          expectedSubstring: "double clampVal(double v)",
        },
        {
          ext: ".hpp",
          code: "^fn headerFn(v:#)-># => v",
          expectedSubstring: "double headerFn(double v)",
        },
        {
          ext: ".cc",
          code: "^fn ccFn(v:#)-># => v",
          expectedSubstring: "double ccFn(double v)",
        },
        {
          ext: ".cxx",
          code: "^fn cxxFn(v:#)-># => v",
          expectedSubstring: "double cxxFn(double v)",
        },
        {
          ext: ".h",
          code: "^fn cHeaderFn(v:#)-># => v",
          expectedSubstring: "double cHeaderFn(double v)",
        },
        {
          ext: ".cs",
          code: "@cls MathUtil\n  ^fn Add(a:#,b:#)-># => a + b",
          expectedSubstring: "class MathUtil",
        },
        {
          ext: ".html",
          code: 'div#app.container\n  h1 "Hello AICE"',
          expectedSubstring: "<div",
        },
        {
          ext: ".css",
          code: ".card {\n  display: flex;\n  padding: 16px;\n}",
          expectedSubstring: ".card",
        },
        {
          ext: ".json",
          code: '{"name":"aice","enabled":true}',
          expectedSubstring: '"name": "aice"',
        },
        {
          ext: ".yaml",
          code: "service: aice\nport: 8080",
          expectedSubstring: "service: aice",
        },
        {
          ext: ".yml",
          code: "env: prod\nreplicas: 3",
          expectedSubstring: "env: prod",
        },
        {
          ext: ".twig",
          code: "<section><h1>{{ title }}</h1></section>",
          expectedSubstring: "{{ title }}",
        },
        {
          ext: ".php",
          code: "fn total(a:#,b:#)-># => a + b",
          expectedSubstring: "<?php",
        },
        {
          ext: ".kt",
          code: "fn score(a:#,b:#)-># => a + b",
          expectedSubstring: "fun score(",
        },
        {
          ext: ".kts",
          code: "fn scriptMain(x:#)-># => x * 2",
          expectedSubstring: "fun scriptMain(",
        },
      ];

      expect(cases.length).toBe(24);

      for (const c of cases) {
        const targetPath = path.join(tmpDir, "multi", `sample${c.ext}`);
        const res = await createFile(targetPath, {
          code: c.code,
          projectRoot: tmpDir,
        });
        expect(fs.existsSync(targetPath)).toBe(true);
        expect(res.newFileContent).toContain(c.expectedSubstring);
        expect(fs.readFileSync(targetPath, "utf-8")).toBe(res.newFileContent);
      }
    });

    it("expands inline @idiom definitions (single-line and multi-line) and CLI --idiom specs, persisting them to aice.config.json and .aice-cache/idioms.json", async () => {
      const targetPath = path.join(tmpDir, "src", "renderer.ts");
      const aiceCode = [
        "@idiom $clamp($0, $1, $2) = Math.min(Math.max($0, $1), $2)",
        "@idiom $drawDot($0, $1, $2, $3) =",
        "  $0.beginPath()",
        "  $0.arc($1, $2, $3, 0, 6.28)",
        "  $0.fill()",
        "",
        "^fn renderBall(ctx:*, x:#, y:#, r:#)->_",
        "  := cx = $clamp(x, 0, 800)",
        "  := cy = $clamp(y, 0, 600)",
        "  $drawDot(ctx, cx, cy, r)",
        "  <- $scale(r)",
      ].join("\n");

      const result = await createFile(targetPath, {
        code: aiceCode,
        inlineIdioms: ["$scale($0) = $0 * 2"],
        projectRoot: tmpDir,
      });

      expect(fs.existsSync(targetPath)).toBe(true);
      expect(result.newFileContent).toContain("Math.min(Math.max(x, 0), 800)");
      expect(result.newFileContent).toContain("Math.min(Math.max(y, 0), 600)");
      expect(result.newFileContent).toContain("ctx.beginPath();");
      expect(result.newFileContent).toContain("ctx.arc(cx, cy, r, 0, 6.28);");
      expect(result.newFileContent).toContain("ctx.fill();");
      expect(result.newFileContent).toContain("r * 2");
      expect(result.persistedIdioms).toEqual(
        expect.arrayContaining(["$clamp", "$drawDot", "$scale"]),
      );

      // Verify idioms persisted to aice.config.json and .aice-cache/idioms.json
      const loadedConfig = loadProjectConfig(tmpDir);
      expect(loadedConfig.idioms?.$clamp).toBeDefined();
      expect(loadedConfig.idioms?.$drawDot).toBeDefined();
      expect(loadedConfig.idioms?.$scale).toBeDefined();

      const cachePath = path.join(tmpDir, ".aice-cache", "idioms.json");
      expect(fs.existsSync(cachePath)).toBe(true);
      const cacheJson = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      expect(cacheJson.idioms.$clamp).toBeDefined();
      expect(cacheJson.idioms.$drawDot).toBeDefined();

      // Verify a subsequent file in the same project can immediately use $clamp without re-declaring it
      const secondFile = path.join(tmpDir, "src", "physics.ts");
      const secondRes = await createFile(secondFile, {
        code: "^fn boundSpeed(v:#)-># => $clamp(v, 0, 10)",
        projectRoot: tmpDir,
      });
      expect(secondRes.newFileContent).toContain("Math.min(Math.max(v, 0), 10)");
    });

    it("supports --dry-run without writing files or persisting idioms", async () => {
      const targetPath = path.join(tmpDir, "dry", "preview.ts");
      const res = await createFile(targetPath, {
        code: "@idiom $dbl($0) = $0 * 2\n^fn calc(n:#)-># => $dbl(n)",
        dryRun: true,
        projectRoot: tmpDir,
      });

      expect(res.dryRun).toBe(true);
      expect(res.newFileContent).toContain("n * 2");
      expect(fs.existsSync(targetPath)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "aice.config.json"))).toBe(false);
    });

    it("supports createBatch and rolls back atomically on failure", async () => {
      const fileA = path.join(tmpDir, "batch", "a.ts");
      const fileB = path.join(tmpDir, "batch", "b.py");

      const okBatch = await createBatch(
        [
          { filePath: fileA, code: "^fn alpha(x:#)-># => x + 1" },
          { filePath: fileB, code: "fn beta(x:#)-># => x * 2" },
        ],
        { projectRoot: tmpDir },
      );

      expect(okBatch.totalFiles).toBe(2);
      expect(fs.existsSync(fileA)).toBe(true);
      expect(fs.existsSync(fileB)).toBe(true);

      // Now test rollback when one item in a batch fails (unsupported extension)
      const fileC = path.join(tmpDir, "batch", "c.ts");
      const badFile = path.join(tmpDir, "batch", "invalid.unknownext");
      const originalA = fs.readFileSync(fileA, "utf-8");

      await expect(
        createBatch(
          [
            { filePath: fileA, code: "^fn alphaChanged(x:#)-># => x + 999" },
            { filePath: fileC, code: "^fn gamma(x:#)-># => x + 3" },
            { filePath: badFile, code: "^fn bad()-># => 0" },
          ],
          { projectRoot: tmpDir },
        ),
      ).rejects.toThrow(/Unsupported target extension/);

      expect(fs.readFileSync(fileA, "utf-8")).toBe(originalA);
      expect(fs.existsSync(fileC)).toBe(false);
    });
  });

  describe("Substep 1.2: Auto-Create Fallback in aice splice", () => {
    it("automatically delegates to createFile when splice is called on a non-existent file or with --create / symbol '*'", async () => {
      const newFile = path.join(tmpDir, "auto-splice", "service.ts");
      expect(fs.existsSync(newFile)).toBe(false);

      const res = await splice(newFile, {
        symbol: "UserService",
        code: "@cls ^UserService\n  ^fn getById(id:$)->$ => id",
        projectRoot: tmpDir,
      });

      expect(fs.existsSync(newFile)).toBe(true);
      expect(res.startLine).toBe(1);
      expect(res.newFileContent).toContain("export class UserService");
      expect(fs.readFileSync(newFile, "utf-8")).toContain("getById(id: string): string");

      // Also works via spliceBatch when mixing non-existent and existing files, and rolls back newly created files on failure
      const newFile2 = path.join(tmpDir, "auto-splice", "extra.ts");
      await expect(
        spliceBatch(
          [
            {
              filePath: newFile2,
              symbol: "*",
              code: "^fn extraFn(x:#)-># => x + 1",
            },
            {
              filePath: path.join(tmpDir, "auto-splice", "missing-del.ts"),
              symbol: "nope",
              delete: true,
            },
          ],
          { projectRoot: tmpDir },
        ),
      ).rejects.toThrow();

      expect(fs.existsSync(newFile2)).toBe(false);
    });
  });

  describe("Substep 1.3 & 1.4: CLI `aice create` and MCP `aice_create`", () => {
    it(
      "executes `aice create` (and alias `aice new`) via CLI including --batch and --json",
      () => {
        const cliFile = path.join(tmpDir, "cli", "math.ts");
        const out = runCli(
          [
            "create",
            cliFile,
            "-c",
            "@idiom $sq($0) = $0 * $0\n^fn hypotSq(a:#,b:#)-># => $sq(a) + $sq(b)",
            "--json",
          ],
          tmpDir,
        );
        expect(out.status).toBe(0);
        const parsed = JSON.parse(out.stdout);
        expect(parsed.filePath).toBe(path.resolve(cliFile));
        expect(fs.existsSync(cliFile)).toBe(true);
        expect(fs.readFileSync(cliFile, "utf-8")).toContain("((a * a) + (b * b))");

        // Test batch via CLI
        const batchSpec = JSON.stringify([
          { filePath: path.join(tmpDir, "cli", "one.py"), code: "fn one()-># => 1" },
          { filePath: path.join(tmpDir, "cli", "two.rs"), code: "^fn two()-># => 2" },
        ]);
        const batchOut = runCli(["new", "--batch", batchSpec, "--json"], tmpDir);
        expect(batchOut.status).toBe(0);
        const batchParsed = JSON.parse(batchOut.stdout);
        expect(batchParsed.totalFiles).toBe(2);
        expect(fs.existsSync(path.join(tmpDir, "cli", "one.py"))).toBe(true);
        expect(fs.existsSync(path.join(tmpDir, "cli", "two.rs"))).toBe(true);

        // Respects project disable
        setProjectAiceEnabled(tmpDir, false);
        const disabledOut = runCli(
          ["create", path.join(tmpDir, "cli", "blocked.ts"), "-c", "^fn x()-># => 1"],
          tmpDir,
        );
        expect(disabledOut.status).not.toBe(0);
        expect(disabledOut.stderr).toContain("AICE is disabled for this project");
      },
      20000,
    );

    it("exposes `aice_create` in AiceMcpServer.getToolDefinitions() and executes single & batch creation via executeToolCall()", async () => {
      const staticTools = AiceMcpServer.getToolDefinitions();
      expect(staticTools.some((t) => t.name === "aice_create")).toBe(true);

      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      expect(server.getToolDefinitions().some((t) => t.name === "aice_create")).toBe(true);

      // Single file creation via MCP
      const mcpFile = path.join(tmpDir, "mcp", "handler.ts");
      const singleRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 1,
        method: "tools/call",
        params: {
          name: "aice_create",
          arguments: {
            filePath: mcpFile,
            code: "@idiom $ok($0) = ({ status: 200, body: $0 })\n^fn handle(msg:$)->* => $ok(msg)",
          },
        },
      })) as { result: McpToolCallResult };

      expect(singleRes.result.isError).toBeFalsy();
      expect(fs.existsSync(mcpFile)).toBe(true);
      expect(fs.readFileSync(mcpFile, "utf-8")).toContain("status: 200");

      // Multi-file batch creation via MCP
      const batchFile1 = path.join(tmpDir, "mcp", "b1.go");
      const batchFile2 = path.join(tmpDir, "mcp", "b2.kt");
      const batchRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: {
          name: "aice_create",
          arguments: {
            files: [
              { filePath: batchFile1, code: '^fn Ping()->$ => "pong"' },
              { filePath: batchFile2, code: 'fn pong()->$ => "ping"' },
            ],
          },
        },
      })) as { result: McpToolCallResult };

      expect(batchRes.result.isError).toBeFalsy();
      expect(fs.existsSync(batchFile1)).toBe(true);
      expect(fs.existsSync(batchFile2)).toBe(true);
    });
  });

  describe("Substep 1.5: Honest BPE Telemetry for File Creation (`aice gain`)", () => {
    it("records exact signed cl100k_base and o200k_base token savings for `create` operations and displays them in `aice gain`", async () => {
      const targetPath = path.join(tmpDir, "telemetry-proj", "engine.ts");
      const res = await createFile(targetPath, {
        code: [
          "@cls ^PhysicsEngine",
          "  ^fn integrate(x:#, v:#, dt:#)-># => x + v * dt",
          "  ^fn kineticEnergy(m:#, v:#)-># => 0.5 * m * v * v",
        ].join("\n"),
        projectRoot: path.join(tmpDir, "telemetry-proj"),
      });

      expect(res.nativeCl100k).toBeGreaterThan(0);
      expect(res.aiceCl100k).toBeGreaterThan(0);
      expect(res.savedCl100k).toBe(res.nativeCl100k - res.aiceCl100k);

      const events = readTelemetryEvents(telemetryFile);
      expect(events.length).toBe(1);
      expect(events[0].operation).toBe("create");
      expect(events[0].category).toBe("write");
      expect(events[0].savedCl100k).toBe(res.savedCl100k);

      const report = buildGainReport({ telemetryPath: telemetryFile });
      expect(report.totalOperations).toBe(1);
      expect(report.writeOperations).toBe(1);
      const createBucket = report.byOperation.find((b) => b.operation === "create");
      expect(createBucket).toBeDefined();
      expect(createBucket?.calls).toBe(1);
      expect(createBucket?.savedCl100k).toBe(res.savedCl100k);

      const formatted = formatGlobalGainDashboard(report);
      expect(formatted).toContain("create");
    });
  });

  describe("Phase 2 & 3: Global Always-On Rule (`~/.gemini/config/rules/aice.md`) and Project Rule Sync (`aice enable` / `aice disable`)", () => {
    it("writes and removes `~/.gemini/config/rules/aice.md` in setupAgents() and removeAgents() with mandatory directive", () => {
      const fakeHome = path.join(tmpDir, "fake-home");
      fs.mkdirSync(path.join(fakeHome, ".gemini", "config"), { recursive: true });

      expect(AICE_SYSTEM_DIRECTIVE).toContain("MANDATORY OVERRIDE");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("aice create");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("aice outline");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("aice context");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("aice splice");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("Subagent Propagation");
      expect(ALWAYS_ON_AICE_RULE_FILE).toContain("trigger: always_on");

      const setupRes = setupAgents({ homeDir: fakeHome, agent: "agy" });
      expect(setupRes.agents[0].mcpConfigured).toBe(true);
      expect(setupRes.agents[0].promptConfigured).toBe(true);

      const globalRulePath = path.join(fakeHome, ".gemini", "config", "rules", "aice.md");
      expect(fs.existsSync(globalRulePath)).toBe(true);
      const globalRuleContent = fs.readFileSync(globalRulePath, "utf-8");
      expect(globalRuleContent).toContain("trigger: always_on");
      expect(globalRuleContent).toContain(AICE_DIRECTIVE_START);
      expect(globalRuleContent).toContain(AICE_DIRECTIVE_END);

      const removeRes = removeAgents({ homeDir: fakeHome, agent: "agy" });
      expect(removeRes.agents[0].promptConfigured).toBe(false);
      expect(fs.existsSync(globalRulePath)).toBe(false);
    });

    it("injects AGENTS.md and .agents/rules/aice.md (plus existing CLAUDE.md/GEMINI.md) on `aice enable` and strips them cleanly on `aice disable`", () => {
      const projDir = path.join(tmpDir, "workspace-proj");
      fs.mkdirSync(projDir, { recursive: true });

      const claudeMd = path.join(projDir, "CLAUDE.md");
      fs.writeFileSync(claudeMd, "# Existing Claude Instructions\nKeep this header.\n", "utf-8");

      // Enable AICE on project
      setProjectAiceEnabled(projDir, true);

      const agentsMd = path.join(projDir, "AGENTS.md");
      const ruleMd = path.join(projDir, ".agents", "rules", "aice.md");
      const geminiMd = path.join(projDir, "GEMINI.md");

      expect(fs.existsSync(agentsMd)).toBe(true);
      expect(fs.existsSync(ruleMd)).toBe(true);
      expect(fs.existsSync(geminiMd)).toBe(false); // did not exist beforehand

      expect(fs.readFileSync(agentsMd, "utf-8")).toContain(AICE_DIRECTIVE_START);
      expect(fs.readFileSync(ruleMd, "utf-8")).toContain("trigger: always_on");
      expect(fs.readFileSync(claudeMd, "utf-8")).toContain("# Existing Claude Instructions");
      expect(fs.readFileSync(claudeMd, "utf-8")).toContain(AICE_DIRECTIVE_START);

      // Disable AICE on project
      setProjectAiceEnabled(projDir, false);
      expect(isProjectAiceEnabled(projDir)).toBe(false);

      // AGENTS.md was created solely by AICE so it should be deleted when empty
      expect(fs.existsSync(agentsMd)).toBe(false);
      // .agents/rules/aice.md and empty .agents/rules + .agents directories should be removed
      expect(fs.existsSync(ruleMd)).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".agents"))).toBe(false);
      // CLAUDE.md had pre-existing content so it remains without the AICE block
      expect(fs.existsSync(claudeMd)).toBe(true);
      expect(fs.readFileSync(claudeMd, "utf-8")).toBe(
        "# Existing Claude Instructions\nKeep this header.\n",
      );
    });

    it("cleans up project .agents/rules/aice.md and strips <!-- AICE:START --> blocks during uninstall.sh", () => {
      const fakeProjects = path.join(tmpDir, "projects");
      const proj1 = path.join(fakeProjects, "app1");
      fs.mkdirSync(proj1, { recursive: true });
      fs.writeFileSync(path.join(proj1, "CLAUDE.md"), "# Team Rules\n", "utf-8");

      setProjectAiceEnabled(proj1, true);
      expect(fs.existsSync(path.join(proj1, "aice.config.json"))).toBe(true);
      expect(fs.existsSync(path.join(proj1, "AGENTS.md"))).toBe(true);
      expect(fs.existsSync(path.join(proj1, ".agents", "rules", "aice.md"))).toBe(true);

      const fakeHome = path.join(tmpDir, "uninstall-home");
      fs.mkdirSync(fakeHome, { recursive: true });

      const uninst = spawnSync(
        "bash",
        [UNINSTALL_SH, "--yes", "--keep-agents", `--projects-dir=${fakeProjects}`],
        {
          cwd: tmpDir,
          encoding: "utf-8",
          env: { ...process.env, HOME: fakeHome },
        },
      );
      expect(uninst.status).toBe(0);
      expect(fs.existsSync(path.join(proj1, "aice.config.json"))).toBe(false);
      expect(fs.existsSync(path.join(proj1, "AGENTS.md"))).toBe(false);
      expect(fs.existsSync(path.join(proj1, ".agents", "rules", "aice.md"))).toBe(false);
      expect(fs.readFileSync(path.join(proj1, "CLAUDE.md"), "utf-8")).toBe("# Team Rules\n");
    });
  });
});
