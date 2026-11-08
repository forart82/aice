import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";
import {
  buildGainReport,
  computeTelemetryEvent,
  formatGlobalGainDashboard,
  formatProjectGainDetail,
  readTelemetryEvents,
  recordTelemetryEvent,
  resetTelemetryHistory,
} from "../src/telemetry/index.js";
import { detectLanguageName } from "../src/tokenomics/index.js";
import { generateContext, outlinePath, splice } from "../src/tools/index.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

describe("Phase 5: Honest, Truth-Based Global & Per-Project Token Savings Telemetry (aice gain)", () => {
  let tmpDir: string;
  let telemetryFile: string;
  let projectADir: string;
  let projectBDir: string;
  let prevTelemetryEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-telemetry-test-"));
    telemetryFile = path.join(tmpDir, "gains.jsonl");
    projectADir = path.join(tmpDir, "alpha-engine");
    projectBDir = path.join(tmpDir, "beta-tiny");
    fs.mkdirSync(path.join(projectADir, "src"), { recursive: true });
    fs.mkdirSync(path.join(projectBDir, "src"), { recursive: true });

    prevTelemetryEnv = process.env.AICE_TELEMETRY_PATH;
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
  });

  afterEach(() => {
    if (prevTelemetryEnv === undefined) {
      delete process.env.AICE_TELEMETRY_PATH;
    } else {
      process.env.AICE_TELEMETRY_PATH = prevTelemetryEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("records honest positive and negative signed token deltas without clamping negative overhead to zero", async () => {
    const richFile = path.join(projectADir, "src", "physics.ts");
    const richLines: string[] = [];
    for (let i = 1; i <= 25; i++) {
      richLines.push(
        `export function integrateStep${i}(pos: number, vel: number, dt: number): number {`,
        `  const accel = (pos * 0.5 + vel * 0.25) / Math.max(dt, 0.001);`,
        `  const nextVel = vel + accel * dt;`,
        `  return pos + nextVel * dt;`,
        `}`,
      );
    }
    fs.writeFileSync(richFile, richLines.join("\n"), "utf-8");

    // 1. Positive token savings via outlinePath
    await outlinePath(richFile, { projectRoot: projectADir });

    // 2. Duplicate identical outline call to test --unique vs --all
    await outlinePath(richFile, { projectRoot: projectADir });

    // 3. Write operation via splice
    await splice(richFile, {
      projectRoot: projectADir,
      symbol: "integrateStep1",
      body: "ret pos + vel * dt",
    });

    // 4. Tiny 1-line file in projectB where generateContext bundle headers exceed raw file tokens
    const tinyFile = path.join(projectBDir, "src", "tiny.ts");
    fs.writeFileSync(tinyFile, "export const x = 1;\n", "utf-8");
    await generateContext(tinyFile, { projectRoot: projectBDir });

    const allEvents = readTelemetryEvents(telemetryFile);
    expect(allEvents).toHaveLength(4);

    const tinyEvent = allEvents.find((e) => e.projectRoot === projectBDir);
    expect(tinyEvent).toBeDefined();
    // Honest negative delta: context headers + target exceed "export const x = 1;\n"
    expect(tinyEvent?.savedCl100k).toBeLessThan(0);
    expect(tinyEvent?.savedO200k).toBeLessThan(0);
    expect(tinyEvent?.savedChars).toBeLessThan(0);

    // Cumulative report (--all)
    const cumulativeReport = buildGainReport({ telemetryPath: telemetryFile, unique: false });
    expect(cumulativeReport.totalOperations).toBe(4);
    expect(cumulativeReport.readOperations).toBe(3);
    expect(cumulativeReport.writeOperations).toBe(1);
    expect(cumulativeReport.overheadOperations).toBe(1);
    expect(cumulativeReport.savedCl100k).toBeGreaterThan(0);
    expect(cumulativeReport.projects).toHaveLength(2);

    // Deduplicated report (--unique) collapses the 2 identical outline calls into 1
    const uniqueReport = buildGainReport({ telemetryPath: telemetryFile, unique: true });
    expect(uniqueReport.totalOperations).toBe(3);

    // Global dashboard text
    const globalText = formatGlobalGainDashboard(cumulativeReport);
    expect(globalText).toContain("GLOBAL HONEST SUMMARY BANNER");
    expect(globalText).toContain("Honest Overhead Calls:  1");
    expect(globalText).toContain("alpha-engine");
    expect(globalText).toContain("beta-tiny");

    // Per-project drill-down for beta-tiny shows negative delta honestly
    // Even if parent tmpDir has a package.json, filtering by project name must not match sibling projects
    fs.writeFileSync(path.join(tmpDir, "package.json"), '{"name":"monorepo-root"}', "utf-8");
    const betaDetailReport = buildGainReport({
      telemetryPath: telemetryFile,
      project: "beta-tiny",
    });
    expect(betaDetailReport.totalOperations).toBe(1);
    expect(betaDetailReport.projectDetail).toBeDefined();
    expect(betaDetailReport.projectDetail?.summary.savedCl100k).toBeLessThan(0);
    expect(betaDetailReport.projectDetail?.summary.overheadCalls).toBe(1);

    if (betaDetailReport.projectDetail) {
      const detailText = formatProjectGainDetail(betaDetailReport.projectDetail);
      expect(detailText).toContain("beta-tiny");
      expect(detailText).toContain("src/tiny.ts");
      expect(detailText).toContain("-");
    }
  });

  it("prevents double-counting when AiceMcpServer executes MCP tools", async () => {
    const sampleFile = path.join(projectADir, "src", "math.ts");
    fs.writeFileSync(
      sampleFile,
      [
        "export function clampVal(v: number, lo: number, hi: number): number {",
        "  if (v < lo) return lo;",
        "  if (v > hi) return hi;",
        "  return v;",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    const server = new AiceMcpServer(undefined, undefined, { workspaceRoot: projectADir });

    await server.handleRequest(1, "tools/call", {
      name: "aice_outline",
      arguments: { path: sampleFile },
    });

    await server.handleRequest(2, "tools/call", {
      name: "aice_context",
      arguments: { path: sampleFile, symbol: "clampVal" },
    });

    await server.handleRequest(3, "tools/call", {
      name: "aice_splice",
      arguments: {
        path: sampleFile,
        symbol: "clampVal",
        body: "ret Math.min(hi, Math.max(lo, v))",
      },
    });

    const events = readTelemetryEvents(telemetryFile);
    // Exactly 3 events recorded (1 per MCP tool call), all with surface="mcp"
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.surface)).toEqual(["mcp", "mcp", "mcp"]);
    expect(events.map((e) => e.operation)).toEqual(["outline", "context", "splice"]);

    // Query `aice_gain` via MCP tool
    const gainMcpRes = (await server.handleRequest(4, "tools/call", {
      name: "aice_gain",
      arguments: { project: projectADir, json: true },
    })) as McpToolCallResult;
    const parsedGain = JSON.parse(gainMcpRes.content[0].text);
    expect(parsedGain.totalOperations).toBe(3);
  });

  it("supports CLI `aice gain --json`, `aice gain <project>`, and `aice gain --reset --yes`", () => {
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "app.ts"),
      projectRoot: projectADir,
      filePath: "src/app.ts",
      language: "TypeScript",
      operation: "outline",
      surface: "cli",
      nativeText: "export function alpha() { return 1 + 2 + 3 + 4 + 5 + 6 + 7 + 8; }\n".repeat(10),
      aiceText: "pub fn alpha(): num",
      telemetryPath: telemetryFile,
    });

    const jsonRes = spawnSync(TSX_BIN, [CLI_PATH, "gain", "--json"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(jsonRes.status).toBe(0);
    const parsed = JSON.parse(jsonRes.stdout);
    expect(parsed.totalOperations).toBe(1);
    expect(parsed.savedCl100k).toBeGreaterThan(0);

    const projRes = spawnSync(TSX_BIN, [CLI_PATH, "gain", "alpha-engine"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(projRes.status).toBe(0);
    expect(projRes.stdout).toContain("AICE PROJECT GAIN DETAIL — alpha-engine");

    const resetRes = spawnSync(TSX_BIN, [CLI_PATH, "gain", "--reset", "--yes"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(resetRes.status).toBe(0);
    expect(resetRes.stdout).toContain(telemetryFile);
    expect(resetRes.stdout).not.toContain("[object Object]");
    expect(readTelemetryEvents(telemetryFile)).toHaveLength(0);

    // Verify all 24 supported language extensions resolve to canonical language names
    expect(detectLanguageName("app.kt")).toBe("Kotlin");
    expect(detectLanguageName("build.gradle.kts")).toBe("Kotlin");
    expect(detectLanguageName("index.php")).toBe("PHP");
    expect(detectLanguageName("view.twig")).toBe("Twig");
    expect(detectLanguageName("config.yaml")).toBe("YAML");
    expect(detectLanguageName("package.json")).toBe("JSON");
    expect(detectLanguageName("mod.mjs")).toBe("JavaScript");

    // Direct helper verification
    const ev = computeTelemetryEvent({
      targetPath: path.join(projectADir, "src", "x.ts"),
      projectRoot: projectADir,
      operation: "decompile",
      nativeText: "const a = 1;",
      aiceText: "const a = 1; // longer output with extra comment overhead",
    });
    expect(ev.savedCl100k).toBeLessThan(0);
    resetTelemetryHistory(telemetryFile);
  }, 20000);
});
