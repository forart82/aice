import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveProjectConfig } from "../src/config/index.js";
import { AiceMcpServer } from "../src/mcp/index.js";
import {
  analyzeProject,
  formatAnalyzeReport,
  loadTelemetryErrors,
  recordTelemetryError,
  recordTelemetryEvent,
} from "../src/telemetry/index.js";

describe("Phase 5: Post-Session Project Analyzer (`aice analyze`) & Error Telemetry", () => {
  let tmpDir = "";
  let ledgerPath = "";
  let transcriptsDir = "";

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-analyze-test-"));
    ledgerPath = path.join(tmpDir, "telemetry", "gains.jsonl");
    transcriptsDir = path.join(tmpDir, "brain");
    fs.mkdirSync(transcriptsDir, { recursive: true });
  });

  afterEach(() => {
    if (tmpDir && fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("1. records and loads failed AICE operation errors via recordTelemetryError / loadTelemetryErrors", () => {
    const projRoot = path.join(tmpDir, "game_proj");
    fs.mkdirSync(projRoot, { recursive: true });

    const recorded = recordTelemetryError({
      targetPath: path.join(projRoot, "src/board.ts"),
      projectRoot: projRoot,
      operation: "splice",
      surface: "cli",
      agent: "agy",
      errorMessage: "Symbol 'Board.missingMethod' not found in src/board.ts",
      telemetryPath: ledgerPath,
    });

    expect(recorded).not.toBeNull();
    expect(recorded?.projectName).toBe("game_proj");
    expect(recorded?.operation).toBe("splice");
    expect(recorded?.filePath).toBe("src/board.ts");

    const errors = loadTelemetryErrors(projRoot, ledgerPath);
    expect(errors).toHaveLength(1);
    expect(errors[0].errorMessage).toContain("Symbol 'Board.missingMethod' not found");
  });

  it("2. reconstructs session count, LLM turns, API tokens, AICE compliance, and friction audit from transcripts and telemetry", () => {
    const projRoot = path.join(tmpDir, "my_game");
    fs.mkdirSync(path.join(projRoot, "src"), { recursive: true });
    saveProjectConfig(projRoot, { enabled: true, idiomsEnabled: true });
    fs.writeFileSync(
      path.join(projRoot, "src/engine.ts"),
      "export class Engine {\n  public step(): number {\n    return 1;\n  }\n}\n",
      "utf-8",
    );

    recordTelemetryEvent({
      targetPath: path.join(projRoot, "src/engine.ts"),
      projectRoot: projRoot,
      operation: "create",
      surface: "cli",
      agent: "agy",
      nativeText:
        "export class Engine {\n  public step(): number {\n    return 1;\n  }\n}\n".repeat(4),
      aiceText: "pub class Engine:\n  pub fn step() -> int = 1\n",
      telemetryPath: ledgerPath,
    });

    recordTelemetryError({
      targetPath: path.join(projRoot, "src/engine.ts"),
      projectRoot: projRoot,
      operation: "splice",
      surface: "cli",
      agent: "agy",
      errorMessage: "Invalid line range L1-L99",
      telemetryPath: ledgerPath,
    });

    const convLogDir = path.join(
      transcriptsDir,
      "11111111-2222-3333-4444-555555555555",
      ".system_generated",
      "logs",
    );
    fs.mkdirSync(convLogDir, { recursive: true });
    const steps = [
      {
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-09T10:00:00Z",
        content: `Command Working Directory: ${projRoot}\nBuild Engine`,
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-09T10:00:10Z",
        input_tokens: 5000,
        cache_read_tokens: 20000,
        output_tokens: 1200,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine: "aice create --stdin << 'EOF'\n=== src/engine.ts ===\nEOF",
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-09T10:00:25Z",
        input_tokens: 3000,
        cache_read_tokens: 25000,
        output_tokens: 400,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                "aice splice src/engine.ts -s Engine.step -c 'public step(): number { return 2; }'",
            },
          },
        ],
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-09T10:00:30Z",
        input_tokens: 2000,
        cache_read_tokens: 28000,
        output_tokens: 150,
        content: "Done.",
        tool_calls: [],
      },
    ];
    fs.writeFileSync(
      path.join(convLogDir, "transcript.jsonl"),
      `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    const report = analyzeProject({
      project: projRoot,
      telemetryPath: ledgerPath,
      transcriptsDir,
    });

    expect(report.projectName).toBe("my_game");
    expect(report.configStatus.enabled).toBe(true);
    expect(report.workspaceStats.fileCount).toBe(1);
    expect(report.sessionSummary.sessionCount).toBe(1);
    expect(report.sessionSummary.totalTurns).toBe(3);
    expect(report.sessionSummary.wallClockSeconds).toBe(30);
    expect(report.sessionSummary.inputTokensUncached).toBe(10000);
    expect(report.sessionSummary.cacheReadTokens).toBe(73000);
    expect(report.sessionSummary.outputTokens).toBe(1750);
    expect(report.sessionSummary.totalBillableTokens).toBe(11750);
    expect(report.sessionSummary.aiceSubcommands).toEqual({ create: 1, splice: 1 });
    expect(report.sessionSummary.aiceCompliancePct).toBe(100);
    expect(report.bpeSavings.totalCalls).toBe(1);
    expect(report.bpeSavings.savedCl100k).toBeGreaterThan(0);
    expect(report.frictionAudit.totalErrors).toBe(1);

    const text = formatAnalyzeReport(report);
    expect(text).toContain("AICE POST-SESSION PROJECT ANALYZER — my_game");
    expect(text).toContain("Total Billable Tokens  : 11,750");
    expect(text).toContain("create:1, splice:1");
    expect(text).toContain("Invalid line range L1-L99");
  });

  it("3. executes `aice analyze <project> --json` via CLI and captures failed CLI splice in error telemetry", () => {
    const projRoot = path.join(tmpDir, "cli_proj");
    fs.mkdirSync(projRoot, { recursive: true });
    saveProjectConfig(projRoot, { enabled: true });
    const tsFile = path.join(projRoot, "index.ts");
    fs.writeFileSync(tsFile, "export function hello(): string { return 'hi'; }\n", "utf-8");

    const cliBin = path.resolve("bin/aice.mjs");
    const env = {
      ...process.env,
      AICE_TELEMETRY_PATH: ledgerPath,
      AICE_TRANSCRIPTS_DIR: transcriptsDir,
    };

    try {
      execFileSync(
        process.execPath,
        [cliBin, "splice", tsFile, "-s", "doesNotExist", "-c", "const x = 1;"],
        {
          cwd: projRoot,
          env,
          stdio: "pipe",
        },
      );
    } catch {
      // expected failure
    }

    const rawJson = execFileSync(process.execPath, [cliBin, "analyze", projRoot, "--json"], {
      cwd: projRoot,
      env,
      encoding: "utf-8",
    });
    const parsed = JSON.parse(rawJson);
    expect(parsed.projectName).toBe("cli_proj");
    expect(parsed.frictionAudit.telemetryErrors.length).toBeGreaterThanOrEqual(1);
    expect(parsed.frictionAudit.telemetryErrors[0].operation).toBe("splice");
  });

  it("4. prevents substring path prefix collisions, resolves Antigravity conversations/<cid>.db workspaces, isolates nested monorepo packages, and computes thinking/payload split + transcript BPE fallback + MCP error telemetry", async () => {
    const proj1 = path.join(tmpDir, "aice_project1");
    const proj10 = path.join(tmpDir, "aice_project10");
    const monoRoot = path.join(tmpDir, "monorepo");
    const monoSub = path.join(monoRoot, "packages", "sub");
    const monoSubSrc = path.join(monoSub, "src");
    fs.mkdirSync(proj1, { recursive: true });
    fs.mkdirSync(proj10, { recursive: true });
    fs.mkdirSync(monoSubSrc, { recursive: true });
    saveProjectConfig(proj1, { enabled: true });
    saveProjectConfig(proj10, { enabled: true });
    saveProjectConfig(monoRoot, { enabled: true });
    saveProjectConfig(monoSub, { enabled: true });

    const convDbDir = path.join(tmpDir, "conversations");
    fs.mkdirSync(convDbDir, { recursive: true });

    const cidA = "aaaaaaaa-1111-2222-3333-444444444444";
    fs.writeFileSync(
      path.join(convDbDir, `${cidA}.db`),
      `Command Working Directory: ${proj1}\nCode relating to the user's requests\n`,
      "utf-8",
    );
    const logDirA = path.join(transcriptsDir, cidA, ".system_generated", "logs");
    fs.mkdirSync(logDirA, { recursive: true });
    fs.writeFileSync(
      path.join(logDirA, "transcript.jsonl"),
      [
        JSON.stringify({
          step_index: 0,
          type: "USER_INPUT",
          status: "DONE",
          created_at: "2026-11-09T11:00:00Z",
          content: "Build relative files in current directory",
        }),
        JSON.stringify({
          step_index: 1,
          type: "PLANNER_RESPONSE",
          status: "DONE",
          created_at: "2026-11-09T11:00:10Z",
          input_tokens: 4000,
          cache_read_tokens: 10000,
          output_tokens: 1000,
          tool_calls: [
            {
              name: "run_command",
              args: { CommandLine: "aice create --stdin << 'EOF'\n=== src/app.ts ===\nEOF" },
            },
          ],
        }),
        JSON.stringify({
          step_index: 2,
          type: "GENERIC",
          status: "DONE",
          created_at: "2026-11-09T11:00:12Z",
          content: [
            "✔ Batch created 1 native file(s) (Native: 500 -> AICE: 300 cl100k tokens, net saved: +200)",
            "✔ Batch created 2 file(s) (180 cl100k tokens, saved: +70, 1 turn(s) saved)",
            "✔ Batch created 2 file(s) in 1 turn (120 cl100k tokens, 1 turn(s) saved)",
            "✔ Created src/util.ts (50 cl100k tokens)",
          ].join("\n"),
        }),
      ].join("\n") + "\n",
      "utf-8",
    );

    const cidB = "bbbbbbbb-1111-2222-3333-444444444444";
    const logDirB = path.join(transcriptsDir, cidB, ".system_generated", "logs");
    fs.mkdirSync(logDirB, { recursive: true });
    fs.writeFileSync(
      path.join(logDirB, "transcript.jsonl"),
      `${JSON.stringify({
        step_index: 0,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-09T11:01:00Z",
        input_tokens: 2000,
        output_tokens: 500,
        content: `Updated [Models.cs](file://${proj10}/Models.cs)`,
        tool_calls: [],
      })}\n`,
      "utf-8",
    );

    const cidC = "cccccccc-1111-2222-3333-444444444444";
    const logDirC = path.join(transcriptsDir, cidC, ".system_generated", "logs");
    fs.mkdirSync(logDirC, { recursive: true });
    fs.writeFileSync(
      path.join(logDirC, "transcript.jsonl"),
      `${JSON.stringify({
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-09T11:02:00Z",
        content: `Command Working Directory: ${monoSubSrc}\nBuild sub-package`,
      })}\n${JSON.stringify({
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-09T11:02:05Z",
        input_tokens: 1500,
        output_tokens: 300,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice outline src/index.ts" } }],
      })}\n`,
      "utf-8",
    );

    const rep1 = analyzeProject({
      project: proj1,
      telemetryPath: ledgerPath,
      transcriptsDir,
    });
    expect(rep1.sessions.map((s) => s.conversationId)).toEqual([cidA]);
    expect(rep1.sessionSummary.thinkingTokensEst).toBeGreaterThan(0);
    expect(rep1.sessionSummary.toolPayloadTokensEst).toBeGreaterThan(0);
    expect(rep1.sessionSummary.thinkingRatioPct + rep1.sessionSummary.toolPayloadRatioPct).toBe(
      100,
    );
    expect(rep1.bpeSavings.totalCalls).toBe(4);
    expect(rep1.bpeSavings.savedCl100k).toBe(270);
    expect(rep1.bpeSavings.aiceCl100k).toBe(650);
    expect(rep1.bpeSavings.nativeCl100k).toBe(920);

    const repSub = analyzeProject({
      project: monoSubSrc,
      telemetryPath: ledgerPath,
      transcriptsDir,
    });
    expect(repSub.projectRoot).toBe(monoSub);
    expect(repSub.sessions.map((s) => s.conversationId)).toEqual([cidC]);

    const repRoot = analyzeProject({
      project: monoRoot,
      telemetryPath: ledgerPath,
      transcriptsDir,
    });
    expect(repRoot.sessions).toHaveLength(0);

    const prevEnv = process.env.AICE_TELEMETRY_PATH;
    process.env.AICE_TELEMETRY_PATH = ledgerPath;
    try {
      fs.writeFileSync(path.join(proj1, "existing.ts"), "export const a = 1;\n", "utf-8");
      const mcp = new AiceMcpServer({ workspaceRoot: proj1 });
      await expect(
        mcp.handleRequest(1, "tools/call", {
          name: "aice_splice",
          arguments: { path: "existing.ts", symbol: "doesNotExist", code: "const x = 1;" },
        }),
      ).rejects.toThrow();
      const errs = loadTelemetryErrors(proj1, ledgerPath);
      expect(errs.some((e) => e.surface === "mcp" && e.operation === "splice")).toBe(true);
    } finally {
      if (prevEnv === undefined) delete process.env.AICE_TELEMETRY_PATH;
      else process.env.AICE_TELEMETRY_PATH = prevEnv;
    }
  });
});
