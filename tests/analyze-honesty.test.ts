import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { saveProjectConfig } from "../src/config/index.js";
import { analyzeProject } from "../src/telemetry/analyze.js";

describe("Honest `aice analyze`: Chained Shell Exit Codes, Redirects & Same-File Pagination", () => {
  let tmpDir: string;
  let projRoot: string;
  let transcriptsDir: string;
  let telemetryPath: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-analyze-honesty-"));
    projRoot = path.join(tmpDir, "proj");
    transcriptsDir = path.join(tmpDir, "brain");
    telemetryPath = path.join(tmpDir, "gains.jsonl");
    fs.mkdirSync(path.join(projRoot, "src"), { recursive: true });
    saveProjectConfig(projRoot, { enabled: true });
    fs.writeFileSync(path.join(projRoot, "src/a.ts"), "export const a = 1;\n", "utf-8");
    fs.writeFileSync(path.join(projRoot, "src/b.ts"), "export const b = 2;\n", "utf-8");
    fs.writeFileSync(path.join(projRoot, "src/c.ts"), "export const c = 3;\n", "utf-8");
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. does NOT count chained `aice splice ... && tsc / npm test` failures as AICE splice hard errors when splice succeeded", () => {
    const cid = "11111111-aaaa-bbbb-cccc-000000000001";
    const logDir = path.join(transcriptsDir, cid, ".system_generated", "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const steps = [
      {
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-19T01:00:00Z",
        content: `Command Working Directory: ${projRoot}\nRun TDD splice + typecheck`,
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T01:00:05Z",
        input_tokens: 2000,
        cache_read_tokens: 48000,
        output_tokens: 400,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                'aice splice src/a.ts -s L1-L1 -c "export const a = 2;" && npm run typecheck && npm test',
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-19T01:00:08Z",
        content:
          "Command exited with code 127.\n\nCommand output:\n✔ Spliced symbol 'L1-L1' in src/a.ts (120 tokens saved)\nsh: 1: tsc: not found\n",
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T01:00:12Z",
        input_tokens: 2000,
        cache_read_tokens: 48000,
        output_tokens: 350,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                "aice splice --stdin << 'EOF'\n=== src/b.ts:L1-L1 ===\nexport const b = 20;\nEOF\nnpm test",
            },
          },
        ],
      },
      {
        step_index: 4,
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-19T01:00:15Z",
        content:
          "Command exited with code 1.\n\nCommand output:\n✔ Batch spliced 1 item(s) across 1 file(s) (85 tokens saved)\nFAIL tests/b.test.ts: expected 20 to be 21\n",
      },
    ];

    fs.writeFileSync(
      path.join(logDir, "transcript.jsonl"),
      `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    const report = analyzeProject({
      project: projRoot,
      telemetryPath,
      transcriptsDir,
    });

    expect(report.sessionSummary.aiceSubcommands).toEqual({ splice: 2 });
    expect(report.transcriptGroundTruth.aiceHardErrorsTotal).toBe(0);
    expect(report.transcriptGroundTruth.spliceWriteHardErrors).toBe(0);
    expect(report.transcriptGroundTruth.spliceWriteErrorPct).toBe(0);
    expect(report.transcriptGroundTruth.failedAndRetryTurns).toBe(0);
    expect(report.transcriptGroundTruth.failedAndRetryOutputTokens).toBe(0);
    expect(report.transcriptGroundTruth.spliceFailedAndRetryOutputTokens).toBe(0);
  });

  it("2. still counts genuine AICE splice errors even when chained with &&, and ignores shell redirects like 2>/dev/null", () => {
    const cid = "22222222-aaaa-bbbb-cccc-000000000002";
    const logDir = path.join(transcriptsDir, cid, ".system_generated", "logs");
    fs.mkdirSync(logDir, { recursive: true });

    const steps = [
      {
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-19T02:00:00Z",
        content: `Command Working Directory: ${projRoot}\nTest redirects and true splice failure`,
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T02:00:05Z",
        input_tokens: 1500,
        cache_read_tokens: 18500,
        output_tokens: 180,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                "aice --version 2>/dev/null && aice 2>/dev/null read src/a.ts 2>&1 && aice read src/b.ts 2>/dev/null",
            },
          },
        ],
      },
      {
        step_index: 2,
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-19T02:00:07Z",
        content:
          "Command exited with code 0.\n\nCommand output:\n0.9.52\n// src/a.ts:1-1\nexport const a = 1;\n",
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T02:00:12Z",
        input_tokens: 1500,
        cache_read_tokens: 18500,
        output_tokens: 500,
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                'aice splice src/a.ts -s L1-L1 -c "export const a = (((" 2>/dev/null && npm test',
            },
          },
        ],
      },
      {
        step_index: 4,
        type: "GENERIC",
        status: "DONE",
        created_at: "2026-11-19T02:00:14Z",
        content:
          "Command exited with code 1.\n\nCommand output:\n❌ Error splicing src/a.ts: Pre-write syntax validation failed\n",
      },
    ];

    fs.writeFileSync(
      path.join(logDir, "transcript.jsonl"),
      `${steps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    const report = analyzeProject({
      project: projRoot,
      telemetryPath,
      transcriptsDir,
    });

    // Must never record "2>/dev/null" or "2>&1" as subcommands!
    expect(report.sessionSummary.aiceSubcommands).toEqual({ read: 2, splice: 1 });
    expect(report.transcriptGroundTruth.aiceHardErrorsTotal).toBe(1);
    expect(report.transcriptGroundTruth.spliceWriteHardErrors).toBe(1);
    expect(report.transcriptGroundTruth.spliceWriteErrorPct).toBe(100);
  });

  it("3. counts only true same-file repeat-read pagination turns in extraReadTurns, not distinct-file exploration", () => {
    const cidDistinct = "33333333-aaaa-bbbb-cccc-000000000003";
    const logDir1 = path.join(transcriptsDir, cidDistinct, ".system_generated", "logs");
    fs.mkdirSync(logDir1, { recursive: true });

    const distinctSteps = [
      {
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-19T03:00:00Z",
        content: `Command Working Directory: ${projRoot}\nExplore distinct files`,
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:00:03Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 150,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice find -d 2" } }],
      },
      {
        step_index: 2,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:00:06Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 150,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice read src/a.ts" } }],
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:00:09Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 150,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice read src/b.ts" } }],
      },
      {
        step_index: 4,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:00:12Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 150,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice read src/c.ts" } }],
      },
      {
        step_index: 5,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:00:15Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 200,
        tool_calls: [
          {
            name: "run_command",
            args: { CommandLine: 'aice splice src/c.ts -s L1-L1 -c "export const c = 30;"' },
          },
        ],
      },
    ];
    fs.writeFileSync(
      path.join(logDir1, "transcript.jsonl"),
      `${distinctSteps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    const distinctReport = analyzeProject({
      project: projRoot,
      telemetryPath,
      transcriptsDir,
    });
    expect(distinctReport.readLoopAudit.readTurns).toBe(4);
    expect(distinctReport.readLoopAudit.maxConsecutiveReadStreak).toBe(4);
    expect(distinctReport.readLoopAudit.extraReadTurns).toBe(0);
    expect(distinctReport.readLoopAudit.contextReplayTokenTax).toBe(0);
    expect(distinctReport.endToEndEconomics.sequentialPaginationTurns).toBe(0);

    // Now add a session with 2 same-file pagination repeat reads on src/a.ts
    const cidPaging = "44444444-aaaa-bbbb-cccc-000000000004";
    const logDir2 = path.join(transcriptsDir, cidPaging, ".system_generated", "logs");
    fs.mkdirSync(logDir2, { recursive: true });

    const pagingSteps = [
      {
        step_index: 0,
        type: "USER_INPUT",
        status: "DONE",
        created_at: "2026-11-19T03:10:00Z",
        content: `Command Working Directory: ${projRoot}\nPaginate src/a.ts`,
      },
      {
        step_index: 1,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:10:03Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 120,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice read src/a.ts:L1-L50" } }],
      },
      {
        step_index: 2,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:10:06Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 120,
        tool_calls: [{ name: "run_command", args: { CommandLine: "aice read src/a.ts:L51-L100" } }],
      },
      {
        step_index: 3,
        type: "PLANNER_RESPONSE",
        status: "DONE",
        created_at: "2026-11-19T03:10:09Z",
        input_tokens: 2000,
        cache_read_tokens: 18000,
        output_tokens: 120,
        tool_calls: [
          { name: "run_command", args: { CommandLine: "aice read src/a.ts:L101-L150" } },
        ],
      },
    ];
    fs.writeFileSync(
      path.join(logDir2, "transcript.jsonl"),
      `${pagingSteps.map((s) => JSON.stringify(s)).join("\n")}\n`,
      "utf-8",
    );

    const combinedReport = analyzeProject({
      project: projRoot,
      telemetryPath,
      transcriptsDir,
    });
    expect(combinedReport.readLoopAudit.extraReadTurns).toBe(2);
    expect(combinedReport.readLoopAudit.sameFileRepeatReadChains).toEqual([
      {
        conversationId: cidPaging,
        filePath: "src/a.ts",
        turns: 3,
      },
    ]);
  });
});
