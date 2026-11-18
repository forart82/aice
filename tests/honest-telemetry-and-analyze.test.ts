import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { saveProjectConfig } from "../src/config/index.js";
import { AICE_MCP_TOOLS } from "../src/mcp/server.js";
import {
  analyzeProject,
  buildGainReport,
  computeTelemetryEvent,
  formatAnalyzeReport,
  formatGlobalGainDashboard,
  formatProjectGainDetail,
  getMcpSchemaOverheadBudgetCl100k,
  getRuleOverheadBudgetCl100k,
  hydrateTelemetryEvent,
  loadTelemetryErrors,
  readTelemetryEvents,
  recordCliFailureTelemetry,
  recordTelemetryError,
  recordTelemetryEvent,
  resetTelemetryHistory,
} from "../src/telemetry/index.js";
import { detectLanguageName, estimateTokens } from "../src/tokenomics/index.js";

describe("Honest Un-Gameable Telemetry (`aice gain`) & Transcript Cross-Verifier (`aice analyze`)", () => {
  let tmpDir: string;
  let telemetryFile: string;
  let prevTelemetryEnv: string | undefined;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-honest-tele-"));
    telemetryFile = path.join(tmpDir, "telemetry", "gains.jsonl");
    prevTelemetryEnv = process.env.AICE_TELEMETRY_PATH;
    process.env.AICE_TELEMETRY_PATH = telemetryFile;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    if (prevTelemetryEnv === undefined) {
      delete process.env.AICE_TELEMETRY_PATH;
    } else {
      process.env.AICE_TELEMETRY_PATH = prevTelemetryEnv;
    }
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("T1: never pads rn > n1 across any operation and reports single-file losing reads (a1 > rn) as honest negative deltas", () => {
    const projDir = path.join(tmpDir, "honest-repo");
    fs.mkdirSync(path.join(projDir, "src"), { recursive: true });

    // 1. Single-file losing read (even with isSearchMode: true) -> NEVER fabricated into a fake win
    const losingRead = computeTelemetryEvent({
      targetPath: path.join(projDir, "src/renderer.ts"),
      projectRoot: projDir,
      filePath: "src/renderer.ts",
      operation: "context",
      isSearchMode: true,
      nativeText: "export const x = 1;\n",
      nativeCl100k: 58,
      aiceText: "bloated wrapper output ".repeat(80),
      aiceCl100k: 500,
      realisticNativeCl100k: 58,
    });
    expect(losingRead.realisticNativeCl100k).toBe(58);
    expect(losingRead.realisticSavedCl100k).toBe(-442);
    expect(losingRead.isSearchMode).toBe(true);

    // 2. Legacy poisoned gains.jsonl line where deleted resolveRealisticSingleFileSearchBaseline wrote rn = min(a1+350, n1+650)
    const hydratedPoisoned = hydrateTelemetryEvent({
      t: "2026-11-17T12:00:00.000Z",
      r: projDir,
      f: "src/poisoned.ts",
      o: "context",
      nc: 4000,
      ac: 6500,
      n1: 1000,
      a1: 1500,
      n2: 980,
      a2: 1480,
      rn: 1650, // exact legacy min(1500+350, 1000+650) fabrication!
    });
    expect(hydratedPoisoned?.realisticNativeCl100k).toBe(1000);
    expect(hydratedPoisoned?.realisticSavedCl100k).toBe(-500);

    // 3. Create / splice where JSON-escaped realisticNativeText > nativeText -> clamped to rn <= n1
    const rawCode = 'export const msg = "line1\\nline2\\nline3";\n'.repeat(20);
    const jsonWrapped = JSON.stringify({ path: "/very/long/path/to/file.ts", content: rawCode });
    const createEv = computeTelemetryEvent({
      targetPath: path.join(projDir, "src/created.ts"),
      projectRoot: projDir,
      filePath: "src/created.ts",
      operation: "create",
      nativeText: rawCode,
      realisticNativeText: jsonWrapped,
      aiceText: rawCode,
    });
    expect(createEv.realisticNativeCl100k).toBeLessThanOrEqual(createEv.nativeCl100k);
    expect(createEv.realisticSavedCl100k).toBe(0);
  });

  it("T2: stops multi-million-token baseline inflation on context:<directory>, <workspace-files>, find, and outline on both record & hydrate", () => {
    const projDir = path.join(tmpDir, "snake_ts");
    fs.mkdirSync(projDir, { recursive: true });

    // 1. Directory context read with 2,049,842-token raw repo dump and 191-token AICE output
    const dirEv = recordTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<directory>",
      operation: "context",
      nativeText: "",
      nativeChars: 8_000_000,
      nativeCl100k: 2_049_842,
      nativeO200k: 2_000_000,
      realisticNativeCl100k: 2_049_842,
      aiceText: "src/game.ts (120L)\nsrc/snake.ts (95L)\n",
      aiceCl100k: 191,
      telemetryPath: telemetryFile,
    });
    expect(dirEv).not.toBeNull();
    expect(dirEv?.realisticNativeCl100k ?? Number.POSITIVE_INFINITY).toBeLessThanOrEqual(4_500);
    expect(dirEv?.realisticSavedCl100k ?? Number.POSITIVE_INFINITY).toBeLessThan(4_500);
    // 2. Empty directory/find result (a1 = 0) with 2,049,842-token raw repo dump -> rn = 0, rs = 0
    const emptyDirEv = recordTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "src/<directory>",
      operation: "context",
      nativeText: "",
      nativeCl100k: 2_049_842,
      nativeO200k: 2_000_000,
      realisticNativeCl100k: 2_049_842,
      aiceText: "",
      aiceCl100k: 0,
      telemetryPath: telemetryFile,
    });
    expect(emptyDirEv?.realisticNativeCl100k).toBe(0);
    expect(emptyDirEv?.realisticSavedCl100k).toBe(0);

    // 3. Hydrating legacy context:<directory> dump also caps rn <= 4,500 (12 * 80 = 960)
    const hydratedDir = hydrateTelemetryEvent({
      t: Date.now(),
      r: projDir,
      f: "<directory>",
      o: "context",
      nc: 8_000_000,
      ac: 700,
      n1: 2_049_842,
      a1: 180,
      n2: 2_000_000,
      a2: 175,
      rn: 2_049_842,
    });
    expect(hydratedDir?.realisticNativeCl100k).toBe(960);

    // 4. Preserves ground-truth rn < n1 1:1 on fresh events without overwriting with synthetic caps!
    const measuredFindEv = computeTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<workspace-files>",
      operation: "outline",
      nativeText: "",
      nativeCl100k: 90_000,
      nativeO200k: 88_000,
      realisticNativeCl100k: 480,
      aiceText: "src/a.ts (20L)\nsrc/b.ts (35L)\n",
      aiceCl100k: 70,
    });
    expect(measuredFindEv.realisticNativeCl100k).toBe(480);
    expect(measuredFindEv.realisticSavedCl100k).toBe(410);

    const measuredDirEv = computeTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<directory>",
      operation: "context",
      nativeText: "",
      nativeCl100k: 120_000,
      nativeO200k: 115_000,
      realisticNativeCl100k: 5_200,
      aiceText: "focused search matches",
      aiceCl100k: 200,
    });
    expect(measuredDirEv.realisticNativeCl100k).toBe(5_200);
    expect(measuredDirEv.realisticSavedCl100k).toBe(5_000);

    // 5. Reports honest negative delta when bloated AICE output exceeds file-count budget (no Math.max(a1, ...) floor!)
    const bloatedFindDump = computeTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<workspace-files>",
      multiFiles: ["a.ts", "b.ts", "c.ts"], // 3 * 10 = 30 tok budget
      operation: "outline",
      nativeText: "",
      nativeCl100k: 50_000,
      nativeO200k: 48_000,
      realisticNativeCl100k: 50_000, // unscoped dump rn == n1
      aiceText: "bloated find output",
      aiceCl100k: 80,
    });
    expect(bloatedFindDump.realisticNativeCl100k).toBe(30);
    expect(bloatedFindDump.realisticSavedCl100k).toBe(-50);

    const bloatedOutlineDump = computeTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<directory>",
      multiFiles: ["a.ts", "b.ts"], // 2 * 45 = 90 tok budget
      operation: "outline",
      nativeText: "",
      nativeCl100k: 60_000,
      nativeO200k: 58_000,
      realisticNativeCl100k: 60_000,
      aiceText: "bloated outline",
      aiceCl100k: 250,
    });
    expect(bloatedOutlineDump.realisticNativeCl100k).toBe(90);
    expect(bloatedOutlineDump.realisticSavedCl100k).toBe(-160);
  });

  it("T3: fixes matchesProjectFilter & analyzeProject so `aice gain skeleton` from `/dev/aice` never hijacks to `aice`", () => {
    const devRoot = path.join(tmpDir, "dev");
    const aiceRepo = path.join(devRoot, "aice");
    const skeletonRepo = path.join(devRoot, "skeleton");
    fs.mkdirSync(path.join(aiceRepo, "src"), { recursive: true });
    fs.mkdirSync(path.join(skeletonRepo, "src"), { recursive: true });
    fs.writeFileSync(path.join(aiceRepo, "package.json"), '{"name":"aice"}', "utf-8");
    fs.writeFileSync(path.join(skeletonRepo, "package.json"), '{"name":"skeleton"}', "utf-8");

    recordTelemetryEvent({
      targetPath: path.join(aiceRepo, "src/index.ts"),
      projectRoot: aiceRepo,
      filePath: "src/index.ts",
      operation: "context",
      nativeText: "export const aice = 1;\n".repeat(40),
      aiceText: "export const aice = 1;",
      telemetryPath: telemetryFile,
    });

    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(aiceRepo);

    // Querying "skeleton" when only "aice" has events MUST return 0 operations (not hijack to aice!)
    const emptySkeletonGain = buildGainReport({
      project: "skeleton",
      telemetryPath: telemetryFile,
    });
    expect(emptySkeletonGain.totalOperations).toBe(0);
    expect(emptySkeletonGain.projectDetail?.projectRoot).toBe(skeletonRepo);

    // Querying analyzeProject({ project: "skeleton" }) from aiceRepo resolves skeletonRepo!
    const skeletonAnalyze = analyzeProject({
      project: "skeleton",
      telemetryPath: telemetryFile,
      transcriptsDir: path.join(tmpDir, "empty-brain"),
    });
    expect(skeletonAnalyze.projectRoot).toBe(skeletonRepo);
    expect(skeletonAnalyze.projectName).toBe("skeleton");

    // Now record an event on skeletonRepo and verify `project: "skeleton"` returns ONLY skeleton
    recordTelemetryEvent({
      targetPath: path.join(skeletonRepo, "src/main.ts"),
      projectRoot: skeletonRepo,
      filePath: "src/main.ts",
      operation: "context",
      nativeText: "export const skel = 1;\n".repeat(30),
      aiceText: "export const skel = 1;",
      telemetryPath: telemetryFile,
    });
    const skelGain = buildGainReport({
      project: "skeleton",
      telemetryPath: telemetryFile,
    });
    expect(skelGain.totalOperations).toBe(1);
    expect(skelGain.projectDetail?.projectName).toBe("skeleton");
    cwdSpy.mockRestore();
  });

  it("T4 & Gain Table: deduplicates CLI errors, tracks 4x wasted output tokens, includes live MCP schema tax, and enforces Dual Honest Verdict", () => {
    const projDir = path.join(tmpDir, "verdict-proj");
    fs.mkdirSync(path.join(projDir, "src"), { recursive: true });
    const baseTs = 1_760_000_000_000;

    // 1. Clean multi-command run (read, search, find, outline, splice/write + MCP) -> TOKEN-REDUCING
    recordTelemetryEvent({
      targetPath: path.join(projDir, "src/big.ts"),
      projectRoot: projDir,
      filePath: "src/big.ts",
      timestamp: new Date(baseTs).toISOString(),
      operation: "context",
      surface: "cli",
      nativeText: "",
      nativeCl100k: 4_000,
      nativeO200k: 3_900,
      realisticNativeCl100k: 3_200,
      aiceText: "compact slice",
      aiceCl100k: 400,
      telemetryPath: telemetryFile,
    });
    recordTelemetryEvent({
      targetPath: path.join(projDir, "src/big.ts"),
      projectRoot: projDir,
      filePath: "src/big.ts",
      timestamp: new Date(baseTs + 1_000).toISOString(),
      operation: "context",
      isSearchMode: true,
      surface: "cli",
      nativeText: "",
      nativeCl100k: 4_000,
      nativeO200k: 3_900,
      realisticNativeCl100k: 600,
      aiceText: "src/big.ts:\n  12: match",
      aiceCl100k: 120,
      telemetryPath: telemetryFile,
    });
    recordTelemetryEvent({
      targetPath: projDir,
      projectRoot: projDir,
      filePath: "<workspace-files>",
      timestamp: new Date(baseTs + 2_000).toISOString(),
      operation: "outline",
      surface: "cli",
      nativeText: "",
      nativeCl100k: 200,
      nativeO200k: 200,
      realisticNativeCl100k: 180,
      aiceText: "src/big.ts (200L)",
      aiceCl100k: 90,
      telemetryPath: telemetryFile,
    });
    recordTelemetryEvent({
      targetPath: path.join(projDir, "src/big.ts"),
      projectRoot: projDir,
      filePath: "src/big.ts",
      timestamp: new Date(baseTs + 3_000).toISOString(),
      operation: "outline",
      surface: "mcp",
      nativeText: "",
      nativeCl100k: 4_000,
      nativeO200k: 3_900,
      realisticNativeCl100k: 4_000,
      aiceText: "fn run(): void",
      aiceCl100k: 250,
      telemetryPath: telemetryFile,
    });
    recordTelemetryEvent({
      targetPath: path.join(projDir, "src/big.ts"),
      projectRoot: projDir,
      filePath: "src/big.ts",
      timestamp: new Date(baseTs + 4_000).toISOString(),
      operation: "splice",
      surface: "cli",
      nativeText: "",
      nativeCl100k: 4_000,
      nativeO200k: 3_900,
      realisticNativeCl100k: 900,
      aiceText: "=== src/big.ts:L10-L25 ===\nconst ok = true;",
      aiceCl100k: 300,
      telemetryPath: telemetryFile,
    });

    const cleanReport = buildGainReport({ telemetryPath: telemetryFile, project: projDir });
    expect(cleanReport.byCommand.map((c) => c.command)).toEqual([
      "read",
      "search",
      "find",
      "outline",
      "splice/write",
    ]);
    expect(cleanReport.byCommand.find((c) => c.command === "search")?.calls).toBe(1);
    expect(cleanReport.byCommand.find((c) => c.command === "find")?.calls).toBe(1);
    expect(cleanReport.mcpSchemaTaxCl100k).toBe(getMcpSchemaOverheadBudgetCl100k());
    expect(cleanReport.mcpSchemaTaxCl100k).toBe(
      estimateTokens(JSON.stringify(AICE_MCP_TOOLS), "cl100k_base"),
    );
    expect(cleanReport.ruleReplayTaxCl100k).toBe(getRuleOverheadBudgetCl100k());
    expect(cleanReport.netEndToEndSavedCl100k).toBeGreaterThan(0);
    expect(cleanReport.costWeightedNetDeltaCl100k).toBeGreaterThan(0);
    expect(cleanReport.endToEndVerdict).toBe("TOKEN-REDUCING");

    const dash = formatGlobalGainDashboard(cleanReport);
    expect(dash).toContain("PER-COMMAND HONEST BREAKDOWN");
    expect(dash).toContain("Cost-Weighted Equivalent Delta");
    expect(dash).toContain("HONEST VERDICT");
    expect(dash).toContain("TOKEN-REDUCING");
    if (cleanReport.projectDetail) {
      const detailText = formatProjectGainDetail(cleanReport.projectDetail);
      expect(detailText).toContain("PER-COMMAND HONEST BREAKDOWN");
      expect(detailText).toContain("TOKEN-REDUCING");
    }
    // 2. Record 1 CLI splice failure via recordCliFailureTelemetry with wastedInputTokens = 1_500:
    // Writes BOTH gains.jsonl (<cli-error>) AND errors.jsonl -> MUST deduplicate to failedRetryTurns = 1!
    const cwdSpy = vi.spyOn(process, "cwd").mockReturnValue(projDir);
    recordCliFailureTelemetry(
      "Line-range splice rejected: delimiter imbalance",
      "splice",
      path.join(projDir, "src/big.ts"),
      1_500,
      { telemetryPath: telemetryFile },
    );
    cwdSpy.mockRestore();

    const afterFailReport = buildGainReport({ telemetryPath: telemetryFile, project: projDir });
    expect(afterFailReport.failedRetryTurns).toBe(1); // NOT 2!
    const spliceBucket = afterFailReport.byCommand.find((c) => c.command === "splice/write");
    expect(spliceBucket?.calls).toBe(2);
    expect(spliceBucket?.errorCalls).toBe(1);
    expect(spliceBucket?.errPct).toBe(50);
    // 50% splice error rate AND 4x * 3,000 = 12,000 output penalty -> MUST flip verdict to TOKEN-CONSUMING!
    expect(afterFailReport.costWeightedNetDeltaCl100k).toBeLessThan(0);
    expect(afterFailReport.endToEndVerdict).toBe("TOKEN-CONSUMING");

    // 3. Unmatched MCP error in errors.jsonl is ALSO counted separately (never hidden!)
    recordTelemetryError({
      targetPath: path.join(projDir, "src/big.ts"),
      projectRoot: projDir,
      operation: "splice",
      surface: "mcp",
      errorMessage: "MCP splice failed: symbol not found",
      telemetryPath: telemetryFile,
    });
    const afterMcpErrReport = buildGainReport({ telemetryPath: telemetryFile, project: projDir });
    expect(afterMcpErrReport.failedRetryTurns).toBe(2); // 1 deduplicated CLI error + 1 distinct MCP error!

    // 4. resetTelemetryHistory MUST clear BOTH gains.jsonl and errors.jsonl!
    expect(loadTelemetryErrors(projDir, telemetryFile)).toHaveLength(2);
    resetTelemetryHistory(telemetryFile);
    expect(readTelemetryEvents(telemetryFile)).toHaveLength(0);
    expect(loadTelemetryErrors(projDir, telemetryFile)).toHaveLength(0);

    // Verify new extension language detection in tokenomics
    expect(detectLanguageName("MainActivity.java")).toBe("Java");
    expect(detectLanguageName("proguard-rules.pro")).toBe("ProGuard");
    expect(detectLanguageName("verify")).toBe("Shell / Script");
  });

  it("T5: cross-verifies real Antigravity transcript_full.jsonl with JSON-escaped args, CHECKPOINTs, worktree resolution, retry output_tokens, bypass filtering, and honest verdict", () => {
    const devDir = path.join(tmpDir, "dev");
    const skelDir = path.join(devDir, "skeleton");
    const otherTmpDir = path.join(tmpDir, "e2e-neon-arkanoid");
    fs.mkdirSync(path.join(skelDir, "src"), { recursive: true });
    fs.mkdirSync(otherTmpDir, { recursive: true });
    saveProjectConfig(skelDir, { enabled: true });
    fs.writeFileSync(path.join(skelDir, "src/app.py"), "def main():\n    return 1\n", "utf-8");

    const brainDir = path.join(tmpDir, "brain");
    const convDbDir = path.join(tmpDir, "conversations");
    fs.mkdirSync(brainDir, { recursive: true });
    fs.mkdirSync(convDbDir, { recursive: true });

    // Parent coordinator conversation on skeleton
    const parentCid = "11111111-aaaa-bbbb-cccc-000000000001";
    fs.writeFileSync(
      path.join(convDbDir, `${parentCid}.db`),
      `Command Working Directory: ${skelDir}\n`,
      "utf-8",
    );

    // Worker conversation running in a deleted Antigravity swarm worktree of parentCid!
    const workerCid = "22222222-aaaa-bbbb-cccc-000000000002";
    fs.writeFileSync(
      path.join(convDbDir, `${workerCid}.db`),
      `Command Working Directory: /home/forart/.gemini/antigravity-cli/worktrees/${parentCid}/swarm-python-worker-abcd1234\n`,
      "utf-8",
    );
    const workerLogs = path.join(brainDir, workerCid, ".system_generated", "logs");
    fs.mkdirSync(workerLogs, { recursive: true });

    // Write BOTH truncated transcript.jsonl AND complete transcript_full.jsonl -> must prefer transcript_full.jsonl once!
    fs.writeFileSync(
      path.join(workerLogs, "transcript.jsonl"),
      `${JSON.stringify({ step_index: 0, type: "SYSTEM_MESSAGE", status: "DONE", content: "truncated" })}\n`,
      "utf-8",
    );

    const fullSteps = [
      {
        step_index: 0,
        type: "SYSTEM_MESSAGE",
        status: "DONE",
        created_at: "2026-11-17T12:00:00Z",
        content: "Worker brief",
      },
      // Turn 1: aice read + read_file on .system_generated/steps/3/output.txt & .png (NOT native bypasses!)
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-17T12:00:05Z",
        input_tokens: 5_000,
        cache_read_tokens: 95_000,
        output_tokens: 400,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: JSON.stringify("aice read src/app.py"),
            },
          },
          {
            name: "read_file",
            args: {
              Path: JSON.stringify(
                "/home/forart/.gemini/antigravity-cli/brain/xyz/.system_generated/steps/3/output.txt",
              ),
            },
          },
          {
            name: "read_file",
            args: {
              Path: JSON.stringify(path.join(skelDir, "assets/logo.png")),
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "DONE",
        content: "Command exited with code 0.\n\ndef main():",
      },
      { step_index: 3, type: "GENERIC", status: "DONE", content: "step output" },
      { step_index: 4, type: "GENERIC", status: "DONE", content: "png media" },
      // Turn 2: Failed aice splice (JSON-encoded heredoc containing "aice read" inside docstring + git msg!)
      {
        step_index: 5,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-17T12:00:15Z",
        input_tokens: 4_000,
        cache_read_tokens: 96_000,
        output_tokens: 2_500,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: JSON.stringify(
                "aice splice --stdin << 'EOF'\n=== src/app.py:L1-L2 ===\ndef main():\n    '''mention aice read inside docstring'''\n    return 2\nEOF",
              ),
            },
          },
        ],
      },
      {
        step_index: 6,
        type: "GENERIC",
        status: "DONE",
        content:
          "Created At: 2026-11-17T13:00:15+01:00\nCompleted At: 2026-11-17T13:00:16+01:00\nCommand exited with code 1.\n\nCommand output:\n❌ Error: Line-range splice rejected (brace/delimiter imbalance)",
      },
      // CHECKPOINT compaction step!
      {
        step_index: 7,
        type: "CHECKPOINT",
        status: "DONE",
        created_at: "2026-11-17T12:00:20Z",
        input_tokens: 1_000,
        cache_read_tokens: 50_000,
        output_tokens: 800,
        content: "# Resuming from compaction",
      },
      // Turn 3: Immediate retry after failed splice (burns 1,500 output_tokens) + git commit mentioning aice splice
      {
        step_index: 8,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-17T12:00:30Z",
        input_tokens: 3_000,
        cache_read_tokens: 57_000,
        output_tokens: 1_500,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: JSON.stringify(
                'aice splice src/app.py -s main -c "def main():\\n    return 2" && git commit -m "fix aice splice"',
              ),
            },
          },
        ],
      },
      {
        step_index: 9,
        type: "GENERIC",
        status: "DONE",
        content:
          "Created At: 2026-11-17T13:00:30+01:00\nCompleted At: 2026-11-17T13:00:31+01:00\nCommand exited with code 0.\n\nCommand output:\n✔ Spliced main",
      },
    ];
    fs.writeFileSync(
      path.join(workerLogs, "transcript_full.jsonl"),
      `${fullSteps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    // Unrelated session in /tmp/e2e-neon-arkanoid that mentions skelDir in prose -> MUST NOT match skelDir!
    const unrelatedCid = "33333333-aaaa-bbbb-cccc-000000000003";
    fs.writeFileSync(
      path.join(convDbDir, `${unrelatedCid}.db`),
      `Command Working Directory: ${otherTmpDir}\n`,
      "utf-8",
    );
    const unrelatedLogs = path.join(brainDir, unrelatedCid, ".system_generated", "logs");
    fs.mkdirSync(unrelatedLogs, { recursive: true });
    fs.writeFileSync(
      path.join(unrelatedLogs, "transcript_full.jsonl"),
      `${JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        input_tokens: 99_999,
        output_tokens: 9_999,
        content: `Bootstrapped from ${skelDir} into ${otherTmpDir}`,
        tool_calls: [],
      })}\n`,
      "utf-8",
    );

    // Also record a single-file losing read (a1 > rn) on skelDir to test singleFileLossPct
    recordTelemetryEvent({
      targetPath: path.join(skelDir, "src/app.py"),
      projectRoot: skelDir,
      filePath: "src/app.py",
      operation: "context",
      nativeText: "def main():\n    return 1\n",
      nativeCl100k: 12,
      realisticNativeCl100k: 12,
      aiceText: "// === src/app.py ===\n1│ def main():\n2│     return 1\n",
      aiceCl100k: 28,
      telemetryPath: telemetryFile,
    });

    const report = analyzeProject({
      project: skelDir,
      telemetryPath: telemetryFile,
      transcriptsDir: brainDir,
    });

    // Only workerCid matched (preferring transcript_full.jsonl once; unrelatedCid excluded!)
    expect(report.sessions.map((s) => s.conversationId)).toEqual([workerCid]);
    expect(report.sessionSummary.totalTurns).toBe(3);
    expect(report.sessionSummary.checkpointCompactions).toBe(1);
    expect(report.sessionSummary.checkpointOutputTokens).toBe(800);
    expect(report.sessionSummary.cacheHitPct).toBeGreaterThan(90);

    // Exact AICE subcommands: 1 read + 2 splice (0 false matches from docstring or git commit!)
    expect(report.sessionSummary.aiceSubcommands).toEqual({ read: 1, splice: 2 });
    // Zero false native bypasses on .system_generated output.txt or .png!
    expect(report.sessionSummary.nativeFileBypasses).toEqual({});
    expect(report.sessionSummary.aiceCompliancePct).toBe(100);

    // Exact hard error rates & failed+retry output_tokens (Turn 2: 2,500 + Turn 3 retry: 1,500 = 4,000 / 4,400 PR out!)
    expect(report.transcriptGroundTruth.aiceHardErrorsTotal).toBe(1);
    expect(report.transcriptGroundTruth.subcommandErrorRates.splice.calls).toBe(2);
    expect(report.transcriptGroundTruth.subcommandErrorRates.splice.errors).toBe(1);
    expect(report.transcriptGroundTruth.subcommandErrorRates.splice.errorPct).toBe(50);
    expect(report.transcriptGroundTruth.failedAndRetryOutputTokens).toBe(4_000);
    expect(report.transcriptGroundTruth.failedAndRetryOutputPct).toBeCloseTo(90.9, 1);

    // Single-file a1 > rn loss rate = 100% (1/1)
    expect(report.transcriptGroundTruth.singleFileReadLossPct).toBe(100);

    // Error snippet stripped Created At / Completed At metadata!
    expect(report.frictionAudit.transcriptErrors[0].snippet).not.toContain("Created At:");
    expect(report.frictionAudit.transcriptErrors[0].snippet).toContain(
      "Line-range splice rejected",
    );
    expect(report.frictionAudit.topCauses.length).toBeGreaterThan(0);

    // Honest verdict MUST be TOKEN-CONSUMING
    expect(report.endToEndEconomics.verdict).toBe("TOKEN-CONSUMING");

    const formatted = formatAnalyzeReport(report);
    expect(formatted).toContain("CHECKPOINT");
    expect(formatted).toContain("4,000");
    expect(formatted).toContain("TOKEN-CONSUMING");
  });
});
