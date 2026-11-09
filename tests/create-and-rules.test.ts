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
import { emitTarget, parse } from "../src/index.js";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";
import {
  buildGainReport,
  formatGlobalGainDashboard,
  readTelemetryEvents,
} from "../src/telemetry/index.js";
import {
  createBatch,
  createFile,
  generateContext,
  outlinePath,
  splice,
  spliceBatch,
} from "../src/tools/index.js";

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
      expect(res.persistedIdioms).toEqual([]);
      expect(fs.existsSync(targetPath)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "aice.config.json"))).toBe(false);
      expect(readTelemetryEvents(telemetryFile).length).toBe(0);
    });

    it("supports compact type sigils on class/type fields & ^const, shorthands inside @idiom templates, and rejects cyclic @idioms or broken @cls syntax", async () => {
      const targetPath = path.join(tmpDir, "src", "entity.ts");
      const code = [
        "@idiom $guardPos($0) = if $0 < 0: <- 0",
        "@type ^Vec2",
        "  x:#",
        "  y:#",
        "^const MAX_ENTITIES:# = 64",
        "@cls ^Player",
        "  x:# = 0",
        '  name:$ = "hero"',
        "  active:? = true",
        "  scores:[#] = []",
        "  ^fn step(dx:#)->#",
        "    $guardPos(dx)",
        "    self.x = self.x + dx",
        "    <- self.x",
      ].join("\n");

      const res = await createFile(targetPath, {
        code,
        projectRoot: tmpDir,
      });

      expect(res.newFileContent).toContain("export interface Vec2");
      expect(res.newFileContent).toContain("export const MAX_ENTITIES: number = 64;");
      expect(res.newFileContent).toContain("export class Player");
      expect(res.newFileContent).toContain("x: number = 0;");
      expect(res.newFileContent).toContain('name: string = "hero";');
      expect(res.newFileContent).toContain("active: boolean = true;");
      expect(res.newFileContent).toContain("if ((dx < 0)) {\n      return 0;\n    }");

      // Mutually recursive inline @idioms must be rejected before writing to disk
      const cycleFile = path.join(tmpDir, "src", "cycle.ts");
      await expect(
        createFile(cycleFile, {
          code: "@idiom $a($0) = $b($0)\n@idiom $b($0) = $a($0)\n^fn f(x:#)-># => $a(x)",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Idiom recursion cycle detected/);
      expect(fs.existsSync(cycleFile)).toBe(false);

      // Broken AICE class syntax without `fn` must throw rather than writing raw @cls to disk
      const brokenFile = path.join(tmpDir, "src", "broken.ts");
      await expect(
        createFile(brokenFile, {
          code: "@cls ^Broken\n  x:# = @@@",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Failed to compile AICE source/);
      expect(fs.existsSync(brokenFile)).toBe(false);
    });

    it("supports createBatch and rolls back files, aice.config.json, .aice-cache/idioms.json, and telemetry atomically on failure", async () => {
      const batchRoot = path.join(tmpDir, "batch-proj");
      const fileA = path.join(batchRoot, "a.ts");
      const fileB = path.join(batchRoot, "b.py");

      const okBatch = await createBatch(
        [
          { filePath: fileA, code: "^fn alpha(x:#)-># => x + 1" },
          { filePath: fileB, code: "fn beta(x:#)-># => x * 2" },
        ],
        { projectRoot: batchRoot },
      );

      expect(okBatch.totalFiles).toBe(2);
      expect(fs.existsSync(fileA)).toBe(true);
      expect(fs.existsSync(fileB)).toBe(true);
      const eventsBeforeFail = readTelemetryEvents(telemetryFile).length;

      // Now test rollback when an early item declares an @idiom and a later item in the batch fails
      const fileC = path.join(batchRoot, "c.ts");
      const badFile = path.join(batchRoot, "invalid.unknownext");
      const originalA = fs.readFileSync(fileA, "utf-8");

      await expect(
        createBatch(
          [
            { filePath: fileA, code: "^fn alphaChanged(x:#)-># => x + 999" },
            {
              filePath: fileC,
              code: "@idiom $tri($0) = $0 * 3\n^fn gamma(x:#)-># => $tri(x)",
            },
            { filePath: badFile, code: "^fn bad()-># => 0" },
          ],
          { projectRoot: batchRoot },
        ),
      ).rejects.toThrow(/Unsupported target extension/);

      expect(fs.readFileSync(fileA, "utf-8")).toBe(originalA);
      expect(fs.existsSync(fileC)).toBe(false);
      expect(fs.existsSync(path.join(batchRoot, "aice.config.json"))).toBe(false);
      expect(fs.existsSync(path.join(batchRoot, ".aice-cache", "idioms.json"))).toBe(false);
      expect(readTelemetryEvents(telemetryFile).length).toBe(eventsBeforeFail);
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
    it("executes `aice create` (and alias `aice new`) via CLI including --batch and --json", () => {
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

      // Test relative paths when CLI is invoked from a nested project subdirectory
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{}", "utf-8");
      const subDir = path.join(tmpDir, "packages", "sub");
      fs.mkdirSync(subDir, { recursive: true });
      const subCreateOut = runCli(["create", "rel.ts", "-c", "^fn subFn()-># => 42"], subDir);
      expect(subCreateOut.status).toBe(0);
      expect(fs.existsSync(path.join(subDir, "rel.ts"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "rel.ts"))).toBe(false);

      const subSpliceOut = runCli(
        ["splice", "rel-splice.ts", "-s", "*", "-c", "^fn spFn()-># => 7"],
        subDir,
      );
      expect(subSpliceOut.status).toBe(0);
      expect(fs.existsSync(path.join(subDir, "rel-splice.ts"))).toBe(true);
      expect(fs.existsSync(path.join(tmpDir, "rel-splice.ts"))).toBe(false);

      // Respects project disable
      setProjectAiceEnabled(tmpDir, false);
      const disabledOut = runCli(
        ["create", path.join(tmpDir, "cli", "blocked.ts"), "-c", "^fn x()-># => 1"],
        tmpDir,
      );
      expect(disabledOut.status).not.toBe(0);
      expect(disabledOut.stderr).toContain("AICE is disabled for this project");
    }, 20000);

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

  describe("AICE v0.9.6 Real-World Regression Suite (aice_tetris Findings)", () => {
    it("1. expands bare CSS selectors and compact CSS shorthands with hex colors via `aice create`", async () => {
      const cssPath = path.join(tmpDir, "out.css");
      const res = await createFile(cssPath, {
        code: ".box { d: flex; jc: center; ai: center; bg: #111; c: #fff; p: 10px; br: 8px; }",
        projectRoot: tmpDir,
      });

      expect(res.nativeCode).toContain(".box");
      expect(res.nativeCode).toContain("display: flex");
      expect(res.nativeCode).toContain("justify-content: center");
      expect(res.nativeCode).toContain("align-items: center");
      expect(res.nativeCode).toContain("background: #111");
      expect(res.nativeCode).toContain("color: #fff");
      expect(res.nativeCode).toContain("padding: 10px");
      expect(res.nativeCode).toContain("border-radius: 8px");

      // Also test CLI invocation directly
      const cliCssPath = path.join(tmpDir, "cli-out.css");
      const cliRes = runCli(
        [
          "create",
          cliCssPath,
          "-c",
          ".box { d: flex; jc: center; ai: center; bg: #111; c: #fff; p: 10px; br: 8px; }",
        ],
        tmpDir,
      );
      expect(cliRes.status).toBe(0);
      const writtenCss = fs.readFileSync(cliCssPath, "utf-8");
      expect(writtenCss).toContain("display: flex;");
      expect(writtenCss).toContain("background: #111;");
    });

    it("2. preserves quotes on JS/TS and multi-language object literal keys containing operators or hyphens", async () => {
      const jsPath = path.join(tmpDir, "kicks.js");
      const res = await createFile(jsPath, {
        code: 'const KICKS = { "0>1": [[0, 0], [-1, 0]], "1>0": [[0, 0]], "soft-drop": 1 }',
        projectRoot: tmpDir,
      });

      expect(res.nativeCode).toContain('"0>1":');
      expect(res.nativeCode).toContain('"1>0":');
      expect(res.nativeCode).toContain('"soft-drop": 1');
      expect(res.nativeCode).not.toContain("0>1:");
      expect(res.nativeCode).not.toContain("soft-drop:");

      // Verify emitted JS parses and runs cleanly in Node
      const nodeCheck = spawnSync("node", ["--check", jsPath], { encoding: "utf-8" });
      expect(nodeCheck.status).toBe(0);

      // Verify multi-language emitters also quote non-identifier keys
      const aiceMap = ':= KICKS = { "0>1": [[0, 0]], "soft-drop": 1 }';
      for (const target of [
        "typescript",
        "javascript",
        "python",
        "php",
        "csharp",
        "go",
        "cpp",
        "rust",
        "kotlin",
        "twig",
      ] as const) {
        const out = emitTarget(parse(aiceMap), target, { watermark: false });
        expect(out).not.toMatch(/[^"']0>1['"]?\s*:/);
        expect(out).not.toMatch(/[^"']soft-drop['"]?\s*:/);
      }
    });

    it("3. compiles hybrid AICE + brace JS without `pub;` / `fn;` statements or file duplication and executes cleanly in Node ESM", async () => {
      const mjsPath = path.join(tmpDir, "audio.mjs");
      const hybridCode = [
        "@idiom $env(g, t) = g.setValueAtTime(0.001, t)",
        "pub const COLS = 10",
        "pub fn midiToHz(midi) {",
        "  ret 440 * Math.pow(2, (midi - 69) / 12)",
        "}",
        "pub fn applyEnv(gainParam, now) {",
        "  $env(gainParam, now)",
        "  ret true",
        "}",
      ].join("\n");

      const res = await createFile(mjsPath, {
        code: hybridCode,
        projectRoot: tmpDir,
      });

      expect(res.nativeCode).not.toMatch(/(?:^|\n)\s*pub\s*;/);
      expect(res.nativeCode).not.toMatch(/(?:^|\n)\s*fn\s*;/);
      expect(res.nativeCode).toContain("export const COLS = 10");
      expect(res.nativeCode).toContain("export function midiToHz");
      expect(res.nativeCode).toContain("setValueAtTime(0.001, now)");

      // Ensure function is emitted exactly once (zero file duplication)
      const matches = res.nativeCode.match(/function midiToHz/g) ?? [];
      expect(matches.length).toBe(1);

      // Execute via Node ESM import to prove runtime validity
      const evalRes = spawnSync(
        "node",
        [
          "--input-type=module",
          "-e",
          `import { COLS, midiToHz } from ${JSON.stringify(mjsPath)}; if (COLS !== 10 || Math.round(midiToHz(69)) !== 440) process.exit(1);`,
        ],
        { encoding: "utf-8" },
      );
      expect(evalRes.status).toBe(0);
    });

    it("4. surfaces `Native Syntax Diagnostics` in `aice context` and `aice outline` when a JS file on disk contains a syntax error", async () => {
      const brokenJs = path.join(tmpDir, "broken.js");
      fs.writeFileSync(
        brokenJs,
        'export const KICKS = {\n  0>1: [[0, 0]],\n  "valid": 1\n};\n',
        "utf-8",
      );

      const ctxRes = await generateContext(brokenJs);
      expect(ctxRes.formattedBundle).toContain("## ⚠️ Native Syntax Diagnostics");
      expect(ctxRes.formattedBundle).toContain("Line 2:");
      expect(ctxRes.formattedBundle).toContain("0>1: [[0, 0]],");

      const outRes = await outlinePath(brokenJs);
      const outText = "text" in outRes ? outRes.text : "";
      expect(outText).toContain("## ⚠️ Native Syntax Diagnostics");
      expect(outText).toContain("Line 2:");
    });

    it("5. supports hybrid AICE + brace syntax in `aice splice`, guards against broken JS writes, and includes subagent + modular file rules in AICE_SYSTEM_DIRECTIVE", async () => {
      const mjsPath = path.join(tmpDir, "spliced.mjs");
      await createFile(mjsPath, {
        code: "pub fn calc(x) {\n  ret x + 1\n}",
        projectRoot: tmpDir,
      });

      const spliceRes = await splice(mjsPath, {
        symbol: "calc",
        code: 'pub fn calc(x) {\n  const table = { "0>1": 10, "soft-drop": 5 }\n  ret x + table["0>1"] + table["soft-drop"]\n}',
      });
      expect(spliceRes.modifiedCode).toContain('"0>1": 10');
      expect(spliceRes.modifiedCode).toContain('"soft-drop": 5');
      expect(spliceRes.modifiedCode).not.toMatch(/(?:^|\n)\s*pub\s*;/);

      expect(AICE_SYSTEM_DIRECTIVE).toContain("150 lines");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("test-runner");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("fast-scout");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("code-surgeon");
      expect(AICE_SYSTEM_DIRECTIVE).toContain("deep-auditor");
    });

    it("6. supports v0.9.9 multi-file create streams (`=== file ===`), multi-block cross-file splice streams (`=== file:symbol ===`, `:eof`, `:Class.newMember`), and class member shorthands (`priv`, `ro`)", async () => {
      const f1 = path.join(tmpDir, "constants.ts");
      const f2 = path.join(tmpDir, "board.ts");
      const fCss = path.join(tmpDir, "style.css");
      const multiCreateStream = [
        `=== ${f1} ===`,
        "pub const COLS = 10;",
        "pub type CellMap = Record<string, :$>;",
        "pub type Action = :$ | null;",
        `=== ${f2} ===`,
        "import { COLS, Action } from './constants';",
        "pub class Board {",
        "  pub grid: (:$ | null)[][] = [];",
        "  priv ro width: :# = COLS;",
        "  priv onAction?: (a: Action) => :_;",
        "  pub reset(): :_ { this.grid = []; }",
        "  pub getWidth(): :# { const w = this.width as :#; <- w; }",
        "}",
        `=== ${fCss} ===`,
        ".board { d:flex; fd:column; }",
      ].join("\n");

      const batchCreateRes = await createBatch(multiCreateStream, { projectRoot: tmpDir });
      expect(batchCreateRes.success).toBe(true);
      expect(batchCreateRes.results.length).toBe(3);

      const constantsCode = fs.readFileSync(f1, "utf-8");
      expect(constantsCode).toContain("export type Action = string | null;");

      const boardCode = fs.readFileSync(f2, "utf-8");
      expect(boardCode).toContain("public grid: (string | null)[][] = [];");
      expect(boardCode).toContain("private readonly width: number = COLS;");
      expect(boardCode).toContain("private onAction?: (a: Action) => void;");
      expect(boardCode).toContain("const w = this.width as number;");
      expect(boardCode).toContain("return w;");

      const multiSpliceStream = [
        `=== ${f1}:eof ===`,
        "pub const COMBO_BONUS = 50;",
        `=== ${f2}:imports ===`,
        "import { COLS, COMBO_BONUS, Action } from './constants';",
        `=== ${f2}:Board.combo ===`,
        "priv combo: :# = -1;",
        "=== Board.isBoardEmpty ===",
        "pub isBoardEmpty(): :? {",
        "  <- this.grid.every((r) => r.every((c) => c === null));",
        "}",
        `=== ${fCss}:eof ===`,
        ".hidden { d:none; }",
      ].join("\n");

      const batchSpliceRes = await spliceBatch(multiSpliceStream, { projectRoot: tmpDir });
      expect(batchSpliceRes.results.length).toBe(3);

      const updatedConstants = fs.readFileSync(f1, "utf-8");
      expect(updatedConstants).toContain("export const COMBO_BONUS = 50;");

      const updatedBoard = fs.readFileSync(f2, "utf-8");
      expect(updatedBoard).toContain("import { COLS, COMBO_BONUS, Action } from './constants';");
      expect(updatedBoard).toContain("private combo: number = -1;");
      expect(updatedBoard).toContain("public isBoardEmpty(): boolean {");
      expect(updatedBoard).toContain("return this.grid.every");
      expect(updatedBoard.indexOf("private combo: number = -1;")).toBeLessThan(
        updatedBoard.indexOf("public isBoardEmpty(): boolean"),
      );

      const updatedCss = fs.readFileSync(fCss, "utf-8");
      expect(updatedCss).toContain("display:none;");

      const ctxImports = await generateContext(f2, { symbol: "imports", projectRoot: tmpDir });
      expect(ctxImports.targetContent).toContain("COMBO_BONUS");

      const ctxRange = await generateContext(f2, { symbol: "L1-L3", projectRoot: tmpDir });
      expect(ctxRange.targetContent).toContain("export class Board");
    });

    it("9. v0.9.10 expanded CSS/TS shorthands, token savings accounting, and incremental :imports merge", async () => {
      const cssFile = path.join(tmpDir, "v0910.css");
      const cssRes = await createFile(cssFile, {
        code: "* { bs:border-box; m:0; p:0; }\n.panel { d:flex; fd:column; jc:center; ai:center; g:20px; p:16px; bg:#070810; c:#f0f4fc; r:8px; w:100%; mh:100vh; pos:relative; bd:1px solid #1e2340; ta:center; tt:uppercase; ls:2px; mb:12px; mt:8px; ov:hidden; cur:pointer; ff:sans-serif; lh:1.5; fw:700; bf:blur(6px); pe:none; ts:0 0 8px #0ff; }",
        projectRoot: tmpDir,
      });
      expect(cssRes.nativeCode).toContain("box-sizing:border-box");
      expect(cssRes.nativeCode).toContain("border-radius:8px");
      expect(cssRes.nativeCode).toContain("min-height:100vh");
      expect(cssRes.nativeCode).toContain("border:1px solid #1e2340");
      expect(cssRes.nativeCode).toContain("text-align:center");
      expect(cssRes.nativeCode).toContain("text-transform:uppercase");
      expect(cssRes.nativeCode).toContain("letter-spacing:2px");
      expect(cssRes.nativeCode).toContain("margin-bottom:12px");
      expect(cssRes.nativeCode).toContain("margin-top:8px");
      expect(cssRes.nativeCode).toContain("overflow:hidden");
      expect(cssRes.nativeCode).toContain("cursor:pointer");
      expect(cssRes.nativeCode).toContain("font-family:sans-serif");
      expect(cssRes.nativeCode).toContain("line-height:1.5");
      expect(cssRes.nativeCode).toContain("font-weight:700");
      expect(cssRes.nativeCode).toContain("backdrop-filter:blur(6px)");
      expect(cssRes.nativeCode).toContain("pointer-events:none");
      expect(cssRes.nativeCode).toContain("text-shadow:0 0 8px #0ff");
      expect(cssRes.tokensSaved).toBeGreaterThan(15);

      const tsFile = path.join(tmpDir, "v0910.ts");
      const tsRes = await createFile(tsFile, {
        code: [
          "import { LINE_POINTS } from './constants';",
          "import { Board } from './board';",
          "import { SoundManager } from './audio';",
          "",
          "pub const A = 1; pub const B = 2;",
          "pub class Engine {",
          "  pub grid: ($ | null)[][] = [];",
          "  priv score:# = 0; priv active:? = true;",
          "  pub step(matrix:#[][]):_ {",
          "    for (r ::= 0; r < matrix.length; r++) {",
          "      next := this.score + r;",
          "      this.score = next;",
          "    }",
          "    <-;",
          "  }",
          "}",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(tsRes.nativeCode).toContain("export const A = 1; export const B = 2;");
      expect(tsRes.nativeCode).toContain("public grid: (string | null)[][] = [];");
      expect(tsRes.nativeCode).toContain(
        "private score: number = 0; private active: boolean = true;",
      );
      expect(tsRes.nativeCode).toContain("public step(matrix: number[][]): void {");
      expect(tsRes.nativeCode).toContain("for (let r = 0; r < matrix.length; r++) {");
      expect(tsRes.nativeCode).toContain("const next = this.score + r;");
      expect(tsRes.tokensSaved).toBeGreaterThan(0);

      // Incremental :imports splice preserves other existing imports
      const impRes = await splice(tsFile, {
        symbol: "imports",
        code: "import { COMBO_BONUS, LINE_POINTS } from './constants';",
        projectRoot: tmpDir,
      });
      expect(impRes.modifiedCode).toContain(
        "import { COMBO_BONUS, LINE_POINTS } from './constants';",
      );
      expect(impRes.modifiedCode).toContain("import { Board } from './board';");
      expect(impRes.modifiedCode).toContain("import { SoundManager } from './audio';");
    });
  });
});
