import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../src/rules/mandatory-rules.js";
import {
  buildGainReport,
  compactTelemetryLedger,
  computeTelemetryEvent,
  formatGlobalGainDashboard,
  formatProjectDetailReport,
  formatProjectGainDetail,
  getRuleOverheadBudgetCl100k,
  hydrateTelemetryEvent,
  isEphemeralWorkspace,
  readTelemetryEvents,
  recordTelemetryEvent,
  resetTelemetryHistory,
  serializeCompactTelemetryEvent,
} from "../src/telemetry/index.js";
import { detectLanguageName, estimateTokens } from "../src/tokenomics/index.js";
import { generateContext, outlinePath, splice } from "../src/tools/index.js";
import { aiceRead } from "../src/tools/read.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

describe("Phase 5 & Step 6: Honest Signed BPE Token Savings Telemetry (aice gain)", () => {
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

    // 4. Tiny 1-line file in projectB where generateContext headers exceed raw file tokens
    const tinyFile = path.join(projectBDir, "src", "tiny.ts");
    fs.writeFileSync(tinyFile, "export const x = 1;\n", "utf-8");
    await generateContext(tinyFile, { projectRoot: projectBDir });

    const allEvents = readTelemetryEvents(telemetryFile);
    expect(allEvents).toHaveLength(4);

    const tinyEvent = allEvents.find((e) => e.projectRoot === projectBDir);
    expect(tinyEvent).toBeDefined();
    expect(tinyEvent?.savedCl100k).toBeLessThan(0);
    expect(tinyEvent?.savedO200k).toBeLessThan(0);
    expect(tinyEvent?.savedChars).toBeLessThan(0);

    // Cumulative report (--all)
    const cumulativeReport = buildGainReport({ telemetryPath: telemetryFile, unique: false });
    expect(cumulativeReport.totalOperations).toBe(4);
    expect(cumulativeReport.readOperations).toBe(3);
    expect(cumulativeReport.writeOperations).toBe(1);
    expect(cumulativeReport.overheadOperations).toBe(1);
    expect(cumulativeReport.overheadCalls).toBe(1);
    expect(cumulativeReport.savedCl100k).toBeGreaterThan(0);
    expect(cumulativeReport.projects).toHaveLength(2);

    // Deduplicated report (--unique) collapses the 2 identical outline calls into 1
    const uniqueReport = buildGainReport({ telemetryPath: telemetryFile, unique: true });
    expect(uniqueReport.totalOperations).toBe(3);

    // Global dashboard text
    const globalText = formatGlobalGainDashboard(cumulativeReport);
    expect(globalText).toContain("GLOBAL HONEST SUMMARY BANNER");
    expect(globalText).toContain("Honest Overhead Calls:  1");
    expect(globalText).toContain("Rule Overhead Break-Even:");
    expect(globalText).toContain("alpha-engine");
    expect(globalText).toContain("beta-tiny");

    // Per-project drill-down for beta-tiny shows negative delta honestly
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
      expect(detailText).toContain("Rule Overhead Break-Even:");
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
    expect(events).toHaveLength(3);
    expect(events.map((e) => e.surface)).toEqual(["mcp", "mcp", "mcp"]);
    expect(events.map((e) => e.operation)).toEqual(["outline", "context", "splice"]);

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
    expect(projRes.stdout).toContain("Rule Overhead Break-Even:");

    const resetRes = spawnSync(TSX_BIN, [CLI_PATH, "gain", "--reset", "--yes"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(resetRes.status).toBe(0);
    expect(resetRes.stdout).toContain(telemetryFile);
    expect(resetRes.stdout).not.toContain("[object Object]");
    expect(readTelemetryEvents(telemetryFile)).toHaveLength(0);

    expect(detectLanguageName("app.kt")).toBe("Kotlin");
    expect(detectLanguageName("build.gradle.kts")).toBe("Kotlin");
    expect(detectLanguageName("index.php")).toBe("PHP");
    expect(detectLanguageName("view.twig")).toBe("Twig");
    expect(detectLanguageName("config.yaml")).toBe("YAML");
    expect(detectLanguageName("package.json")).toBe("JSON");
    expect(detectLanguageName("mod.mjs")).toBe("JavaScript");

    const ev = computeTelemetryEvent({
      targetPath: path.join(projectADir, "src", "x.ts"),
      projectRoot: projectADir,
      operation: "decompile",
      nativeText: "const a = 1;",
      aiceText: "const a = 1; // longer output with extra comment overhead",
    });
    expect(ev.savedCl100k).toBeLessThan(0);
    resetTelemetryHistory(telemetryFile);
  }, 60000);

  it("persists compact numeric JSONL lines (< 250 B/event) with zero raw source strings and hydrates legacy lines", () => {
    const rawNativeSentinel = `RAW_NATIVE_SOURCE_SENTINEL_${"const secretPayload = 42;\n".repeat(60)}`;
    const rawRealisticSentinel = `RAW_REALISTIC_PAYLOAD_SENTINEL_${"edit_file old/new block\n".repeat(25)}`;
    const rawAiceSentinel = `RAW_AICE_OUTPUT_SENTINEL_${"fn secretPayload() -> int\n".repeat(10)}`;

    const recorded = recordTelemetryEvent({
      targetPath: "/workspace/alpha-engine/src/service.ts",
      projectRoot: "/workspace/alpha-engine",
      filePath: "src/service.ts",
      operation: "splice",
      surface: "cli",
      agent: "agy",
      nativeText: rawNativeSentinel,
      aiceText: rawAiceSentinel,
      realisticNativeText: rawRealisticSentinel,
      preservedTriviaTokens: 24,
      structuralCompressionPct: 68,
      telemetryPath: telemetryFile,
    });

    expect(recorded).not.toBeNull();
    expect(recorded?.realisticNativeText).toBeUndefined();
    expect(recorded?.realisticNativeCl100k).toBe(
      estimateTokens(rawRealisticSentinel, "cl100k_base"),
    );
    expect(recorded?.realisticSavedCl100k).toBe(
      (recorded?.realisticNativeCl100k ?? 0) - (recorded?.aiceCl100k ?? 0),
    );

    recordTelemetryEvent({
      targetPath: "/workspace/alpha-engine/src/router.ts",
      projectRoot: "/workspace/alpha-engine",
      filePath: "src/router.ts",
      operation: "context",
      surface: "mcp",
      nativeText: rawNativeSentinel,
      aiceText: "pub fn route(): void",
      telemetryPath: telemetryFile,
    });

    const rawLedger = fs.readFileSync(telemetryFile, "utf-8");
    expect(rawLedger).not.toContain("RAW_NATIVE_SOURCE_SENTINEL_");
    expect(rawLedger).not.toContain("RAW_REALISTIC_PAYLOAD_SENTINEL_");
    expect(rawLedger).not.toContain("RAW_AICE_OUTPUT_SENTINEL_");
    expect(rawLedger).not.toContain("realisticNativeText");

    const lines = rawLedger.trim().split("\n");
    expect(lines).toHaveLength(2);
    for (const line of lines) {
      expect(Buffer.byteLength(line, "utf-8")).toBeLessThan(250);
    }

    // Also append a legacy verbose JSONL line to verify dual-format hydration
    const legacyVerboseLine = JSON.stringify({
      timestamp: "2026-11-14T10:00:00.000Z",
      projectRoot: "/workspace/legacy-repo",
      projectName: "legacy-repo",
      filePath: "src/legacy.ts",
      language: "TypeScript",
      operation: "outline",
      surface: "cli",
      agent: "claude",
      category: "read",
      idiomsUsed: false,
      nativeChars: 800,
      aiceChars: 200,
      savedChars: 600,
      nativeCl100k: 210,
      aiceCl100k: 55,
      savedCl100k: 155,
      nativeO200k: 200,
      aiceO200k: 52,
      savedO200k: 148,
      contentHash: "legacyhash123",
      realisticNativeText: "LEGACY_RAW_SOURCE_SHOULD_BE_STRIPPED",
    });
    fs.appendFileSync(telemetryFile, `${legacyVerboseLine}\n`, "utf-8");

    const hydrated = readTelemetryEvents(telemetryFile);
    expect(hydrated).toHaveLength(3);
    expect(hydrated[0]?.projectRoot).toBe("/workspace/alpha-engine");
    expect(hydrated[0]?.savedCl100k).toBe(recorded?.savedCl100k);
    expect(hydrated[0]?.realisticNativeCl100k).toBe(recorded?.realisticNativeCl100k);
    expect(hydrated[0]?.preservedTriviaTokens).toBe(24);
    expect(hydrated[0]?.structuralCompressionPct).toBe(68);
    expect(hydrated[0]?.realisticNativeText).toBeUndefined();

    expect(hydrated[2]?.projectRoot).toBe("/workspace/legacy-repo");
    expect(hydrated[2]?.savedCl100k).toBe(155);
    expect(hydrated[2]?.realisticNativeText).toBeUndefined();
    expect(hydrated[2]?.realisticNativeCl100k).toBeGreaterThan(0);
  });

  it("filters ephemeral input.projectRoot and input.targetPath (/tmp/aice-rw-*, /tmp/sbx-*, /var/tmp/*, swarm-*) even when process.cwd() is a real repo", () => {
    const savedEnv = { ...process.env };
    const permanentRepoCwd = "/workspace/permanent-repo";
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(permanentRepoCwd);
    const permanentHome = path.join(
      os.homedir(),
      ".aice-cache",
      `tmp-home-ephemeral-test-${process.pid}-${Date.now()}`,
    );
    fs.mkdirSync(permanentHome, { recursive: true });

    try {
      delete process.env.AICE_TELEMETRY_PATH;
      delete process.env.AICE_TELEMETRY_DIR;
      delete process.env.AICE_TELEMETRY_ERRORS_PATH;
      delete process.env.AICE_HOME;
      delete process.env.VITEST;
      process.env.NODE_ENV = "production";
      process.env.HOME = permanentHome;

      // Direct predicate assertions with real permanent cwd
      expect(isEphemeralWorkspace(process.cwd(), undefined, "/tmp/aice-rw-01")).toBe(true);
      expect(isEphemeralWorkspace(process.cwd(), undefined, "/tmp/sbx-42")).toBe(true);
      expect(
        isEphemeralWorkspace(process.cwd(), undefined, undefined, "/tmp/aice-rw-07/src/app.ts"),
      ).toBe(true);
      expect(
        isEphemeralWorkspace(process.cwd(), undefined, undefined, "/tmp/sbx-88/src/app.ts"),
      ).toBe(true);
      expect(isEphemeralWorkspace(process.cwd(), undefined, "/var/tmp/bench-run")).toBe(true);
      expect(isEphemeralWorkspace(process.cwd(), undefined, "/workspace/swarm-worker-2")).toBe(
        true,
      );

      // 1. Permanent repo call while cwd is a real repo -> MUST record
      const realEv = recordTelemetryEvent({
        targetPath: path.join(permanentRepoCwd, "src/telemetry/index.ts"),
        projectRoot: permanentRepoCwd,
        filePath: "src/telemetry/index.ts",
        operation: "outline",
        nativeText: "export const ok = 1;\n".repeat(10),
        aiceText: "pub const ok",
      });
      expect(realEv).not.toBeNull();

      // 2. Ephemeral /tmp/aice-rw-* and /tmp/sbx-* via projectRoot or targetPath -> MUST be suppressed
      expect(
        recordTelemetryEvent({
          targetPath: "/tmp/aice-rw-01/src/index.ts",
          projectRoot: "/tmp/aice-rw-01",
          operation: "outline",
          nativeText: "export const a = 1;",
          aiceText: "pub const a",
        }),
      ).toBeNull();

      expect(
        recordTelemetryEvent({
          targetPath: "/tmp/sbx-99/src/index.ts",
          projectRoot: "/tmp/sbx-99",
          operation: "splice",
          nativeText: "export const b = 2;",
          aiceText: "pub const b",
        }),
      ).toBeNull();

      expect(
        recordTelemetryEvent({
          targetPath: "/tmp/aice-rw-target-only/src/main.ts",
          operation: "context",
          nativeText: "export const c = 3;",
          aiceText: "pub const c",
        }),
      ).toBeNull();

      expect(
        recordTelemetryEvent({
          targetPath: "/tmp/sbx-target-only/src/main.ts",
          operation: "context",
          nativeText: "export const d = 4;",
          aiceText: "pub const d",
        }),
      ).toBeNull();

      const defaultLedger = path.join(permanentHome, ".aice", "telemetry", "gains.jsonl");
      const persisted = readTelemetryEvents(defaultLedger);
      expect(persisted).toHaveLength(1);
      expect(persisted[0]?.projectRoot).toBe(path.resolve(permanentRepoCwd));
    } finally {
      cwdSpy.mockRestore();
      process.env = savedEnv;
      fs.rmSync(permanentHome, { recursive: true, force: true });
    }
  });

  it("logs failed-command negative overhead (nativeCl100k=0, aiceCl100k>0) cleanly and renders Rule Overhead Break-Even", () => {
    const failedEv = recordTelemetryEvent({
      targetPath: projectADir,
      projectRoot: projectADir,
      filePath: "<cli-error>",
      operation: "context",
      surface: "cli",
      nativeText: "",
      aiceText: "error: unknown option '--nonexistent'\nUsage: aice read [options] <targets...>",
      telemetryPath: telemetryFile,
    });
    expect(failedEv).not.toBeNull();
    expect(failedEv?.nativeCl100k).toBe(0);
    expect(failedEv?.aiceCl100k).toBeGreaterThan(0);
    expect(failedEv?.savedCl100k).toBeLessThan(0);
    expect(failedEv?.savedO200k).toBeLessThan(0);
    expect(failedEv?.savedChars).toBeLessThan(0);

    // Second negative-delta event where AICE output exceeds both raw and realistic baseline
    const negSliceEv = recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "small.ts"),
      projectRoot: projectADir,
      filePath: "src/small.ts",
      operation: "context",
      surface: "cli",
      nativeText: "const x = 1;",
      realisticNativeText: "1: const x = 1;",
      aiceText: "// header\n// contract\n1│ const x = 1;\n// footer with extra context lines",
      telemetryPath: telemetryFile,
    });
    expect(negSliceEv?.savedCl100k).toBeLessThan(0);
    expect(negSliceEv?.realisticSavedCl100k).toBeLessThan(0);

    const negReport = buildGainReport({ telemetryPath: telemetryFile, project: "alpha-engine" });
    expect(negReport.savedCl100k).toBeLessThan(0);
    expect(negReport.overheadOperations).toBe(2);
    expect(negReport.overheadCalls).toBe(2);
    expect(negReport.projectDetail?.summary.overheadCalls).toBe(2);
    expect(Number.isFinite(negReport.cl100kSavingsPct)).toBe(true);
    expect(negReport.cl100kSavingsPct).toBeLessThan(0);
    expect(Number.isFinite(negReport.o200kSavingsPct)).toBe(true);
    expect(Number.isFinite(negReport.realisticSavedCl100kPct)).toBe(true);

    const expectedBudget = estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base");
    expect(getRuleOverheadBudgetCl100k()).toBe(expectedBudget);
    expect(negReport.ruleBudgetCl100k).toBe(expectedBudget);
    expect(negReport.ruleBreakEvenReached).toBe(false);

    const negGlobalText = formatGlobalGainDashboard(negReport);
    expect(negGlobalText).not.toContain("NaN");
    expect(negGlobalText).not.toContain("Infinity");
    expect(negGlobalText).toContain("Rule Overhead Break-Even:");
    expect(negGlobalText).toContain(`${expectedBudget.toLocaleString()} cl100k`);
    expect(negGlobalText).toContain("tokens needed to break even");

    expect(negReport.projectDetail).toBeDefined();
    if (negReport.projectDetail) {
      const negDetailText = formatProjectDetailReport(negReport.projectDetail);
      expect(negDetailText).not.toContain("NaN");
      expect(negDetailText).not.toContain("Infinity");
      expect(negDetailText).toContain("Rule Overhead Break-Even:");
      expect(negDetailText).toContain("tokens needed to break even");
    }

    // Now add a large positive savings operation that exceeds the 1x AGENTS.md rule budget
    const bigNative =
      "export function computeHeavyMatrixRow(a: number, b: number): number { return a * b + 12345; }\n".repeat(
        Math.ceil((expectedBudget * 2) / 18) + 20,
      );
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "matrix.ts"),
      projectRoot: projectADir,
      filePath: "src/matrix.ts",
      operation: "outline",
      surface: "cli",
      nativeText: bigNative,
      aiceText: "pub fn computeHeavyMatrixRow(a: num, b: num): num",
      telemetryPath: telemetryFile,
    });

    const posReport = buildGainReport({ telemetryPath: telemetryFile, project: "alpha-engine" });
    expect(posReport.savedCl100k).toBeGreaterThan(expectedBudget);
    expect(posReport.ruleBreakEvenReached).toBe(true);
    expect(posReport.ruleBreakEvenMultiple).toBeGreaterThanOrEqual(1);

    const posGlobalText = formatGlobalGainDashboard(posReport);
    expect(posGlobalText).toContain("Rule Overhead Break-Even:");
    expect(posGlobalText).toContain("AMORTIZED");
    expect(posGlobalText).toContain("x budget");

    expect(posReport.projectDetail).toBeDefined();
    if (posReport.projectDetail) {
      const posDetailText = formatProjectGainDetail(posReport.projectDetail);
      expect(posDetailText).toContain("Rule Overhead Break-Even:");
      expect(posDetailText).toContain("AMORTIZED");
    }
  });

  it("compactTelemetryLedger() shrinks verbose + /tmp-polluted ledgers into < 250 B/event compact numeric lines", () => {
    const bloatedPayload =
      "export function bloatedSource() { return 'raw source payload'; }\n".repeat(400);
    const makeVerboseRecord = (projectRoot: string, filePath: string, savedCl100k: number) =>
      JSON.stringify({
        timestamp: "2026-11-14T15:30:00.000Z",
        projectRoot,
        projectName: path.basename(projectRoot),
        filePath,
        language: "TypeScript",
        operation: "splice",
        surface: "cli",
        agent: "agy",
        category: "write",
        idiomsUsed: false,
        nativeChars: 24000,
        aiceChars: 400,
        savedChars: 23600,
        nativeCl100k: savedCl100k + 100,
        aiceCl100k: 100,
        savedCl100k,
        nativeO200k: savedCl100k + 95,
        aiceO200k: 95,
        savedO200k: savedCl100k,
        contentHash: "a".repeat(64),
        realisticNativeText: bloatedPayload,
        realisticNativeCl100k: 800,
        realisticSavedCl100k: 700,
        preservedTriviaTokens: 0,
      });

    const rawLines = [
      makeVerboseRecord("/workspace/core-repo", "src/engine.ts", 900),
      makeVerboseRecord("/tmp/aice-rw-bench-01", "src/bench.ts", 500),
      makeVerboseRecord("/tmp/sbx-ephemeral-02", "src/sbx.ts", 400),
      makeVerboseRecord("/var/tmp/temp-run-03", "src/tmp.ts", 300),
      makeVerboseRecord("/home/dev/swarm-worker-04", "src/swarm.ts", 200),
      makeVerboseRecord("/workspace/ui-repo", "src/view.tsx", -25),
    ];
    fs.writeFileSync(telemetryFile, `${rawLines.join("\n")}\n`, "utf-8");

    const stats = compactTelemetryLedger(telemetryFile);
    expect(stats.beforeBytes).toBeGreaterThan(100_000);
    expect(stats.keptEvents).toBe(2);
    expect(stats.droppedEphemeral).toBe(4);
    expect(stats.afterBytes).toBeLessThan(500);

    const compactedRaw = fs.readFileSync(telemetryFile, "utf-8");
    expect(compactedRaw).not.toContain("bloatedSource");
    expect(compactedRaw).not.toContain("realisticNativeText");
    expect(compactedRaw).not.toContain("/tmp/");
    expect(compactedRaw).not.toContain("/var/tmp/");
    expect(compactedRaw).not.toContain("swarm-worker");

    const compactedLines = compactedRaw.trim().split("\n");
    expect(compactedLines).toHaveLength(2);
    for (const line of compactedLines) {
      expect(Buffer.byteLength(line, "utf-8")).toBeLessThan(250);
    }

    const hydrated = readTelemetryEvents(telemetryFile);
    expect(hydrated).toHaveLength(2);
    expect(hydrated[0]?.projectRoot).toBe("/workspace/core-repo");
    expect(hydrated[0]?.savedCl100k).toBe(900);
    expect(hydrated[0]?.realisticNativeCl100k).toBe(800);
    expect(hydrated[0]?.realisticSavedCl100k).toBe(700);
    expect(hydrated[1]?.projectRoot).toBe("/workspace/ui-repo");
    expect(hydrated[1]?.savedCl100k).toBe(-25);
  });

  it("detects < 90s back-to-back reads on the same (projectRoot, filePath) (repeatReadCalls) without firing on >= 90s or different file/project, and surfaces Repeat-Read Turn Warnings", () => {
    const bigSource =
      "export function computeRow(x: number): number { return x * 2 + 1; }\n".repeat(30);

    // 1. Initial read on (projectADir, src/loop.ts) at t=0s -> NOT a repeat read
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "loop.ts"),
      projectRoot: projectADir,
      filePath: "src/loop.ts",
      operation: "outline",
      timestamp: "2026-11-15T10:00:00.000Z",
      nativeText: bigSource,
      aiceText: "pub fn computeRow(x: num): num",
      telemetryPath: telemetryFile,
    });

    // 2. Second read on same (projectADir, src/loop.ts) at t=35s (< 90s) -> repeatReadCalls #1
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "loop.ts"),
      projectRoot: projectADir,
      filePath: "src/loop.ts",
      operation: "context",
      timestamp: "2026-11-15T10:00:35.000Z",
      nativeText: bigSource,
      aiceText: "1│ export function computeRow(x: number): number { return x * 2 + 1; }",
      telemetryPath: telemetryFile,
    });

    // 3. Third read on same (projectADir, src/loop.ts) at +89.999s (< 90s) -> repeatReadCalls #2
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "loop.ts"),
      projectRoot: projectADir,
      filePath: "src/loop.ts",
      operation: "context",
      timestamp: "2026-11-15T10:02:04.999Z",
      nativeText: bigSource,
      aiceText: "15│ export function computeRow(x: number): number { return x * 2 + 1; }",
      telemetryPath: telemetryFile,
    });

    // 4. Fourth read on same (projectADir, src/loop.ts) at exact +90.000s (>= 90s) -> must NOT fire
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "loop.ts"),
      projectRoot: projectADir,
      filePath: "src/loop.ts",
      operation: "context",
      timestamp: "2026-11-15T10:03:34.999Z",
      nativeText: bigSource,
      aiceText: "25│ export function computeRow(x: number): number { return x * 2 + 1; }",
      telemetryPath: telemetryFile,
    });

    // 5. Read on DIFFERENT file in same project within 10s (< 90s) -> must NOT fire
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "other.ts"),
      projectRoot: projectADir,
      filePath: "src/other.ts",
      operation: "context",
      timestamp: "2026-11-15T10:03:44.999Z",
      nativeText: bigSource,
      aiceText: "1│ export const other = true;",
      telemetryPath: telemetryFile,
    });

    // 6. Read on SAME filePath ("src/other.ts") in DIFFERENT projectRoot within 5s -> must NOT fire
    recordTelemetryEvent({
      targetPath: path.join(projectBDir, "src", "other.ts"),
      projectRoot: projectBDir,
      filePath: "src/other.ts",
      operation: "context",
      timestamp: "2026-11-15T10:03:49.999Z",
      nativeText: bigSource,
      aiceText: "1│ export const betaOther = true;",
      telemetryPath: telemetryFile,
    });

    // 7. Intervening splice on (projectADir, src/other.ts) followed by read 10s later -> must NOT fire
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "other.ts"),
      projectRoot: projectADir,
      filePath: "src/other.ts",
      operation: "splice",
      timestamp: "2026-11-15T10:03:54.999Z",
      nativeText: bigSource,
      aiceText: "export const other = false;",
      telemetryPath: telemetryFile,
    });
    recordTelemetryEvent({
      targetPath: path.join(projectADir, "src", "other.ts"),
      projectRoot: projectADir,
      filePath: "src/other.ts",
      operation: "context",
      timestamp: "2026-11-15T10:04:04.999Z",
      nativeText: bigSource,
      aiceText: "1│ export const other = false;",
      telemetryPath: telemetryFile,
    });

    const globalReport = buildGainReport({ telemetryPath: telemetryFile });
    expect(globalReport.savedCl100k).toBeGreaterThan(0);
    expect(globalReport.repeatReadCalls).toBe(2);

    const alphaProj = globalReport.projects.find((p) => p.projectName === "alpha-engine");
    const betaProj = globalReport.projects.find((p) => p.projectName === "beta-tiny");
    expect(alphaProj?.repeatReadCalls).toBe(2);
    expect(betaProj?.repeatReadCalls).toBe(0);

    const globalText = formatGlobalGainDashboard(globalReport);
    expect(globalText).toContain("Repeat-Read Turn Warnings: 2 ⚠");

    const alphaDetail = buildGainReport({
      telemetryPath: telemetryFile,
      project: "alpha-engine",
    });
    expect(alphaDetail.projectDetail?.summary.repeatReadCalls).toBe(2);
    expect(
      alphaDetail.projectDetail?.topFiles.find((f) => f.filePath === "src/loop.ts")
        ?.repeatReadCalls,
    ).toBe(2);
    expect(
      alphaDetail.projectDetail?.topFiles.find((f) => f.filePath === "src/other.ts")
        ?.repeatReadCalls,
    ).toBe(0);

    if (alphaDetail.projectDetail) {
      const alphaDetailText = formatProjectGainDetail(alphaDetail.projectDetail);
      expect(alphaDetailText).toContain("Repeat-Read Turn Warnings: 2 ⚠");
    }

    const betaDetail = buildGainReport({
      telemetryPath: telemetryFile,
      project: "beta-tiny",
    });
    expect(betaDetail.projectDetail?.summary.repeatReadCalls).toBe(0);
    if (betaDetail.projectDetail) {
      const betaDetailText = formatProjectGainDetail(betaDetail.projectDetail);
      expect(betaDetailText).toContain(
        "Repeat-Read Turn Warnings: 0 (0 <90s back-to-back same-file reads)",
      );
    }

    const cliJson = spawnSync(TSX_BIN, [CLI_PATH, "gain", "--json"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(cliJson.status).toBe(0);
    expect(JSON.parse(cliJson.stdout).repeatReadCalls).toBe(2);

    const cliText = spawnSync(TSX_BIN, [CLI_PATH, "gain"], {
      cwd: projectADir,
      encoding: "utf-8",
      env: { ...process.env, AICE_TELEMETRY_PATH: telemetryFile },
    });
    expect(cliText.status).toBe(0);
    expect(cliText.stdout).toContain("Repeat-Read Turn Warnings: 2 ⚠");
  });

  it("detects <90s repeatReadCalls across <multi-context> calls overlapping on the same file and serializes multiFiles", async () => {
    const fileA = path.join(projectADir, "src", "a.ts");
    const fileB = path.join(projectADir, "src", "b.ts");
    const fileC = path.join(projectADir, "src", "c.ts");
    fs.mkdirSync(path.join(projectADir, "src"), { recursive: true });
    fs.writeFileSync(fileA, "export const a = 1;\n".repeat(30), "utf-8");
    fs.writeFileSync(fileB, "export const b = 2;\n".repeat(30), "utf-8");
    fs.writeFileSync(fileC, "export const c = 3;\n".repeat(30), "utf-8");

    // Clear ledger before test
    resetTelemetryHistory(telemetryFile);

    // 1. Initial read on (projectADir) with [src/a.ts, src/b.ts] at t=0s -> NOT a repeat read
    recordTelemetryEvent({
      targetPath: fileA,
      projectRoot: projectADir,
      filePath: "<multi-context>",
      multiFiles: ["src/a.ts", "src/b.ts"],
      operation: "context",
      timestamp: "2026-11-15T14:00:00.000Z",
      nativeText: "export const a = 1;\nexport const b = 2;\n",
      aiceText: "1│ export const a = 1;\n1│ export const b = 2;\n",
      telemetryPath: telemetryFile,
    });

    // 2. Second read: <multi-context> with [src/b.ts, src/c.ts] at t=30s (<90s) -> overlaps on src/b.ts -> repeatReadCalls #1
    recordTelemetryEvent({
      targetPath: fileB,
      projectRoot: projectADir,
      filePath: "<multi-context>",
      multiFiles: ["src/b.ts", "src/c.ts"],
      operation: "context",
      timestamp: "2026-11-15T14:00:30.000Z",
      nativeText: "export const b = 2;\nexport const c = 3;\n",
      aiceText: "1│ export const b = 2;\n1│ export const c = 3;\n",
      telemetryPath: telemetryFile,
    });

    // 3. Third read: single file read on src/b.ts at t=60s (<90s from t=30s) -> overlaps on src/b.ts -> repeatReadCalls #2
    recordTelemetryEvent({
      targetPath: fileB,
      projectRoot: projectADir,
      filePath: "src/b.ts",
      operation: "context",
      timestamp: "2026-11-15T14:01:00.000Z",
      nativeText: "export const b = 2;\n",
      aiceText: "1│ export const b = 2;\n",
      telemetryPath: telemetryFile,
    });

    // 4. Fourth read: <multi-context> with [src/a.ts, src/c.ts] at t=75s (<90s from t=60s where prev read was src/b.ts) -> no overlap! -> NOT repeat read
    recordTelemetryEvent({
      targetPath: fileA,
      projectRoot: projectADir,
      filePath: "<multi-context>",
      multiFiles: ["src/a.ts", "src/c.ts"],
      operation: "context",
      timestamp: "2026-11-15T14:01:15.000Z",
      nativeText: "export const a = 1;\nexport const c = 3;\n",
      aiceText: "1│ export const a = 1;\n1│ export const c = 3;\n",
      telemetryPath: telemetryFile,
    });

    // 5. Fifth read: single file read on src/a.ts at t=80s (<90s from t=75s where prev was [src/a.ts, src/c.ts]) -> overlaps on src/a.ts -> repeatReadCalls #3
    recordTelemetryEvent({
      targetPath: fileA,
      projectRoot: projectADir,
      filePath: "src/a.ts",
      operation: "context",
      timestamp: "2026-11-15T14:01:20.000Z",
      nativeText: "export const a = 1;\n",
      aiceText: "1│ export const a = 1;\n",
      telemetryPath: telemetryFile,
    });

    const report = buildGainReport({ telemetryPath: telemetryFile });
    expect(report.repeatReadCalls).toBe(3);
    const projDetailReport = buildGainReport({
      telemetryPath: telemetryFile,
      project: path.basename(projectADir),
    });
    expect(projDetailReport.projectDetail?.summary.repeatReadCalls).toBe(3);

    // Verify serialization round-tripping preserves mf / multiFiles
    const recEvent = computeTelemetryEvent({
      targetPath: fileA,
      projectRoot: projectADir,
      filePath: "<multi-context>",
      multiFiles: ["src/a.ts", "src/b.ts"],
      operation: "context",
      nativeText: "export const a = 1;\n",
      aiceText: "export const a = 1;\n",
      telemetryPath: telemetryFile,
    });
    const serialized = serializeCompactTelemetryEvent(recEvent);
    expect(serialized).toContain('"mf":["src/a.ts","src/b.ts"]');
    const parsed = JSON.parse(serialized);
    const hydrated = hydrateTelemetryEvent(parsed);
    expect(hydrated?.multiFiles).toEqual(["src/a.ts", "src/b.ts"]);

    const hydratedEvents = readTelemetryEvents(telemetryFile);
    const multiEv = hydratedEvents.find((e) => e.filePath === "<multi-context>");
    expect(multiEv).toBeDefined();
    expect(multiEv?.multiFiles).toBeDefined();
    expect(Array.isArray(multiEv?.multiFiles)).toBe(true);

    // Live aiceRead multi-target populates multiFiles in telemetry
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
    await aiceRead([fileA, fileB], { projectRoot: projectADir });
    const liveEvs = readTelemetryEvents(telemetryFile);
    const lastEv = liveEvs[liveEvs.length - 1];
    expect(lastEv?.filePath).toBe("<multi-context>");
    expect(lastEv?.multiFiles).toBeDefined();
    expect(lastEv?.multiFiles).toContain("src/a.ts");
    expect(lastEv?.multiFiles).toContain("src/b.ts");
  });

  it("de-inflates legacy <workspace-files> and directory outline baselines in hydrateTelemetryEvent and outlinePath", async () => {
    // 1. <workspace-files> de-inflation (multiFilesCount === 0, rn === n1 = 50,000):
    // Neutral 0-delta Math.min(50_000, aiceCl100k) = 100 (zero synthetic 1.35x fake win!)
    const legacyWorkspaceEv = hydrateTelemetryEvent({
      timestamp: new Date().toISOString(),
      projectRoot: projectADir,
      projectName: "alpha-engine",
      filePath: "<workspace-files>",
      language: "Multi-File",
      operation: "context",
      surface: "cli",
      agent: "user-cli",
      nativeCl100k: 50_000,
      aiceCl100k: 100,
      realisticNativeCl100k: 50_000,
      realisticSavedCl100k: 49_900,
    });
    expect(legacyWorkspaceEv?.realisticNativeCl100k).toBe(100);
    expect(legacyWorkspaceEv?.realisticSavedCl100k).toBe(0);

    // 2. <directory> outline de-inflation:
    // Legacy record with realisticNativeCl100k = 80,000, nativeCl100k = 80,000, aiceCl100k = 200, multiFiles: 10
    // Clamped strictly to Math.min(80000, 10 * 45) = 450 (independent of aiceCl100k!)
    const legacyOutlineEv = hydrateTelemetryEvent({
      timestamp: new Date().toISOString(),
      projectRoot: projectADir,
      projectName: "alpha-engine",
      filePath: "<directory>",
      language: "Multi-File",
      operation: "outline",
      surface: "cli",
      agent: "user-cli",
      nativeCl100k: 80_000,
      aiceCl100k: 200,
      realisticNativeCl100k: 80_000,
      realisticSavedCl100k: 79_800,
      multiFiles: [
        "f1.ts",
        "f2.ts",
        "f3.ts",
        "f4.ts",
        "f5.ts",
        "f6.ts",
        "f7.ts",
        "f8.ts",
        "f9.ts",
        "f10.ts",
      ],
    });
    expect(legacyOutlineEv?.realisticNativeCl100k).toBe(450);
    expect(legacyOutlineEv?.realisticSavedCl100k).toBe(250);

    // 3. Live directory outlinePath sets realisticNativeCl100k <= outlinedFileCount * 45
    const dirForOutline = path.join(projectADir, "outlines-test");
    fs.mkdirSync(dirForOutline, { recursive: true });
    for (let i = 1; i <= 4; i++) {
      fs.writeFileSync(
        path.join(dirForOutline, `mod${i}.ts`),
        `export function fn${i}(): number { return ${i}; }\n`,
        "utf-8",
      );
    }
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
    await outlinePath(dirForOutline, { projectRoot: projectADir });
    const evs = readTelemetryEvents(telemetryFile);
    const dirEv = evs.find((e) => e.filePath === "<directory>");
    expect(dirEv).toBeDefined();
    expect(dirEv?.realisticNativeCl100k).toBeDefined();
    // 4 files * 45 = 180 max baseline
    expect(dirEv?.realisticNativeCl100k ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(
      Math.max(dirEv?.aiceCl100k ?? 0, 4 * 45),
    );
    // 4. Single-file hydration NEVER fabricates rn > n1 anti-loss padding: a1 > rn is reported honestly as negative!
    const losingSingleRead = hydrateTelemetryEvent({
      t: "2026-11-17T03:05:00.000Z",
      r: "/workspace/alpha-engine",
      f: "src/renderer.js",
      o: "context",
      nc: 180,
      ac: 1900,
      n1: 58,
      a1: 500,
      n2: 56,
      a2: 490,
      rn: 58,
    });
    expect(losingSingleRead?.realisticNativeCl100k).toBe(58);
    expect(losingSingleRead?.realisticSavedCl100k).toBe(-442);

    const bloatedSingleRead = hydrateTelemetryEvent({
      t: "2026-11-17T03:06:00.000Z",
      r: "/workspace/alpha-engine",
      f: "src/renderer.js",
      o: "context",
      nc: 180,
      ac: 8000,
      n1: 58,
      a1: 2000,
      n2: 56,
      a2: 1950,
      rn: 58,
    });
    expect(bloatedSingleRead?.realisticNativeCl100k).toBe(58);
    expect(bloatedSingleRead?.realisticSavedCl100k).toBe(-1942);
  });

  it("distinguishes < 12s parallel slices from >= 12s sequential pagination turns and respects intervening writes", () => {
    const file = "src/controller.ts";
    const baseTs = 1_700_000_000_000;

    const events = [
      // Turn 1: Initial read at t = 0
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "const a = 1;\n",
        aiceText: "const a = 1;\n",
        telemetryPath: telemetryFile,
      }),
      // Parallel slice: same-file read at t = 2,000 ms (< 12_000 ms after prior read)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 2_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "const a = 1;\n",
        aiceText: "const a = 1;\n",
        telemetryPath: telemetryFile,
      }),
      // Sequential pagination turn: same-file read at t = 17,000 ms (15,000 ms >= 12_000 ms after prior read)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 17_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "const a = 1;\n",
        aiceText: "const a = 1;\n",
        telemetryPath: telemetryFile,
      }),
      // Intervening write: splice at t = 22_000 ms
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 22_000).toISOString(),
        operation: "splice",
        surface: "cli",
        nativeText: "const a = 1;\n",
        aiceText: "const a = 2;\n",
        telemetryPath: telemetryFile,
      }),
      // Read after intervening write at t = 37_000 ms (intervening write occurred since last read at 17,000 ms)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 37_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "const a = 2;\n",
        aiceText: "const a = 2;\n",
        telemetryPath: telemetryFile,
      }),
      // Subsequent read without intervening write at t = 52_000 ms (15,000 ms >= 12_000 ms after read at 37,000 ms)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, file),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 52_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "const a = 2;\n",
        aiceText: "const a = 2;\n",
        telemetryPath: telemetryFile,
      }),
    ];

    fs.writeFileSync(
      telemetryFile,
      `${events.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf-8",
    );

    const report = buildGainReport({ telemetryPath: telemetryFile, project: "alpha-engine" });
    expect(report.parallelSliceCalls).toBe(1);
    expect(report.sequentialPaginationTurns).toBe(2);
    expect(report.paginationReplayTaxCl100k).toBe(2 * 8_500);
  });

  it("computes systemic wrapper taxes, rule replay taxes, retry replay taxes, and reports endToEndVerdict", () => {
    const baseTs = 1_700_000_100_000;

    // Subtest A: Clean 1-turn edit -> TOKEN-REDUCING
    const cleanTeleFile = path.join(tmpDir, "clean-gains.jsonl");
    const cleanEvents = [
      computeTelemetryEvent({
        targetPath: path.join(projectADir, "src/large.ts"),
        projectRoot: projectADir,
        timestamp: new Date(baseTs).toISOString(),
        operation: "splice",
        surface: "mcp", // MCP wrapper tax = 45
        nativeText: "export const big = 1;\n",
        aiceText: "export const big = 1;\n",
        nativeCl100k: 20_000,
        nativeO200k: 20_000,
        aiceCl100k: 100,
        aiceO200k: 100,
        realisticNativeCl100k: 20_000,
        realisticSavedCl100k: 19_900,
        telemetryPath: cleanTeleFile,
      }),
    ];
    fs.writeFileSync(
      cleanTeleFile,
      `${cleanEvents.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf-8",
    );
    const cleanReport = buildGainReport({ telemetryPath: cleanTeleFile, project: "alpha-engine" });
    expect(cleanReport.wrapperTaxCl100k).toBe(45);
    expect(cleanReport.estimatedTurns).toBe(1);
    expect(cleanReport.sequentialPaginationTurns).toBe(0);
    expect(cleanReport.failedRetryTurns).toBe(0);
    expect(cleanReport.netEndToEndSavedCl100k).toBeGreaterThan(0);
    expect(cleanReport.endToEndVerdict).toBe("TOKEN-REDUCING");

    const cleanDashboard = formatGlobalGainDashboard(cleanReport);
    expect(cleanDashboard).toContain("End-to-End Verdict:               TOKEN-REDUCING");
    if (cleanReport.projectDetail) {
      const cleanDetail = formatProjectGainDetail(cleanReport.projectDetail);
      expect(cleanDetail).toContain("End-to-End Verdict:               TOKEN-REDUCING");
    }

    // Subtest B: Sequential slice loops & failed retry turns -> TOKEN-CONSUMING
    const loopTeleFile = path.join(tmpDir, "loop-gains.jsonl");
    const loopErrorsFile = `${loopTeleFile}.errors.jsonl`;
    const loopEvents = [
      // Turn 1 at t = 0 (CLI wrapper tax = 70)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, "src/paginate.ts"),
        projectRoot: projectADir,
        timestamp: new Date(baseTs).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "export const a = 1;\n",
        aiceText: "export const a = 1;\n",
        telemetryPath: loopTeleFile,
      }),
      // Turn 2 at t = 15,000 ms (CLI wrapper tax = 70, sequential pagination turn = 1)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, "src/paginate.ts"),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 15_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "export const a = 1;\n",
        aiceText: "export const a = 1;\n",
        telemetryPath: loopTeleFile,
      }),
      // Turn 3 at t = 30,000 ms (CLI wrapper tax = 70, sequential pagination turn = 2)
      computeTelemetryEvent({
        targetPath: path.join(projectADir, "src/paginate.ts"),
        projectRoot: projectADir,
        timestamp: new Date(baseTs + 30_000).toISOString(),
        operation: "context",
        surface: "cli",
        nativeText: "export const a = 1;\n",
        aiceText: "export const a = 1;\n",
        telemetryPath: loopTeleFile,
      }),
      // Failed retry CLI event
      computeTelemetryEvent({
        targetPath: path.join(projectADir, "src/paginate.ts"),
        projectRoot: projectADir,
        filePath: "<cli-error>",
        timestamp: new Date(baseTs + 45_000).toISOString(),
        operation: "splice",
        surface: "cli",
        nativeText: "",
        aiceText: "CLI error",
        telemetryPath: loopTeleFile,
      }),
    ];
    fs.writeFileSync(
      loopTeleFile,
      `${loopEvents.map((e) => JSON.stringify(e)).join("\n")}\n`,
      "utf-8",
    );

    // Non-benign error in errors.jsonl
    fs.writeFileSync(
      loopErrorsFile,
      `${JSON.stringify({
        timestamp: new Date(baseTs + 46_000).toISOString(),
        projectRoot: projectADir,
        projectName: "alpha-engine",
        filePath: "src/paginate.ts",
        operation: "splice",
        surface: "cli",
        agent: "user-cli",
        errorMessage: "Syntax error: Unexpected token",
      })}\n`,
      "utf-8",
    );

    const loopReport = buildGainReport({ telemetryPath: loopTeleFile, project: "alpha-engine" });
    expect(loopReport.wrapperTaxCl100k).toBe(4 * 70);
    expect(loopReport.sequentialPaginationTurns).toBe(2);
    expect(loopReport.paginationReplayTaxCl100k).toBe(2 * 8_500);
    expect(loopReport.failedRetryTurns).toBe(1); // <cli-error> + errors.jsonl within 1s deduplicated to 1 failed call!
    expect(loopReport.retryReplayTaxCl100k).toBeGreaterThanOrEqual(8_500);
    expect(loopReport.costWeightedNetDeltaCl100k).toBeLessThan(0);
    expect(loopReport.netEndToEndSavedCl100k).toBeLessThan(0);
    expect(loopReport.endToEndVerdict).toBe("TOKEN-CONSUMING");

    const loopDashboard = formatGlobalGainDashboard(loopReport);
    expect(loopDashboard).toContain("End-to-End Verdict:               TOKEN-CONSUMING");
    if (loopReport.projectDetail) {
      const loopDetail = formatProjectGainDetail(loopReport.projectDetail);
      expect(loopDetail).toContain("End-to-End Verdict:               TOKEN-CONSUMING");
    }
  });
});
