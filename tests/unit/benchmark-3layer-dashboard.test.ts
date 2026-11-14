/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  ALL_REAL_AGENT_BENCHMARKS,
  auditTranscriptCompliance,
  buildLayerPrompt,
  buildPrompt,
  execAgyWithRetry,
  OAUTH_OR_RATE_LIMIT_RE,
  recordForensicManifestEntry,
  SCENARIO_LAYER_DEFINITIONS,
  setupWorkspace,
  verifyCompilerAndSyntaxOnFile,
} from "../../benchmarks/run-real-agents.js";
import { BenchmarkDashboard } from "../../benchmarks/ui/progress-bar.js";

describe("3-Layer Progressive Benchmark & Dashboard Engine", () => {
  it("defines Layer 2 and Layer 3 specifications for all 11 benchmark scenarios", () => {
    expect(ALL_REAL_AGENT_BENCHMARKS.length).toBe(11);
    for (const spec of ALL_REAL_AGENT_BENCHMARKS) {
      const def = SCENARIO_LAYER_DEFINITIONS[spec.id];
      expect(def, `Missing layer definitions for ${spec.id}`).toBeDefined();
      expect(def.layer2.layerIndex).toBe(2);
      expect(def.layer2.title.length).toBeGreaterThan(3);
      expect(def.layer2.taskPrompt.length).toBeGreaterThan(10);
      expect(def.layer2.targetFiles.length).toBeGreaterThan(0);
      expect(def.layer2.expectedKeywords.length).toBeGreaterThan(0);

      expect(def.layer3.layerIndex).toBe(3);
      expect(def.layer3.title.length).toBeGreaterThan(3);
      expect(def.layer3.taskPrompt.length).toBeGreaterThan(10);
      expect(def.layer3.targetFiles.length).toBeGreaterThan(0);
      expect(def.layer3.expectedKeywords.length).toBeGreaterThan(0);
    }
  });

  it("builds clean Layer 2 and Layer 3 prompts across all modes", () => {
    const spec = ALL_REAL_AGENT_BENCHMARKS[0];
    const l2PromptNoAice = buildLayerPrompt(spec, "without_aice", "/tmp/test", 2);
    expect(l2PromptNoAice).toContain("Progressive Layer 2/3");
    expect(l2PromptNoAice).toContain("WITHOUT AICE");
    expect(l2PromptNoAice).toContain("Non-Regression");

    const l2PromptAice = buildLayerPrompt(spec, "aice_no_idioms", "/tmp/test", 2);
    expect(l2PromptAice).toContain("Progressive Layer 2/3");
    expect(l2PromptAice).toContain("aice read");
    expect(l2PromptAice).toContain("aice splice");
    const l3PromptIdioms = buildLayerPrompt(spec, "aice_with_idioms", "/tmp/test", 3);
    expect(l3PromptIdioms).toContain("Progressive Layer 3/3");
    expect(l3PromptIdioms).toContain("--idioms");
  });

  it("renders unicode progress bars and tracks worker states without crashing", () => {
    const bar = BenchmarkDashboard.buildBar(0.5, 10);
    expect(bar).toContain("█");
    expect(bar).toContain("░");

    const dashboard = new BenchmarkDashboard(33, 3);
    dashboard.registerWorker("RW-01:without_aice", {
      id: "RW-01",
      mode: "without_aice",
      title: "HTML5 Snake",
      layer: 1,
      layerTitle: "Layer 1: Baseline",
      status: "RUNNING",
    });

    dashboard.updateWorker("RW-01:without_aice", {
      turns: 2,
      status: "VERIFYING",
    });
    dashboard.stepCompleted();

    dashboard.updateWorker("RW-01:without_aice", {
      layer: 2,
      layerTitle: "Layer 2: Speed Tiers",
      status: "RUNNING",
    });
    dashboard.stepCompleted();

    dashboard.updateWorker("RW-01:without_aice", {
      layer: 3,
      layerTitle: "Layer 3: LocalStorage",
      status: "DONE",
    });
    dashboard.stepCompleted();

    expect(() => dashboard.render()).not.toThrow();
  });
});
it("identifies retryable OAuth, rate-limit, and connection errors", () => {
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Error: OAuth token refresh failed")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Request failed with status code 401")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Resource exhausted: 429 Too Many Requests")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("User is not logged into Google Cloud")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("connect ETIMEDOUT 142.250.180.10")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("read ECONNRESET")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Random compilation bug")).toBe(false);
});

it("exports execAgyWithRetry and fails cleanly on non-retryable errors", async () => {
  await expect(execAgyWithRetry(["--non-existent-flag-xyz-12345"], 0)).rejects.toThrow();
});
describe("Strict 2-Tool Pre-Flight Compliance & Forensic Manifest", () => {
  it("instructs AICE benchmark agents to use only aice read and aice splice/write", () => {
    const spec = ALL_REAL_AGENT_BENCHMARKS[0];
    for (const mode of ["aice_no_idioms", "aice_with_idioms"] as const) {
      const p1 = buildPrompt(spec, mode, "/tmp/ws", 940935);
      const p2 = buildLayerPrompt(spec, mode, "/tmp/ws", 2);
      for (const p of [p1, p2]) {
        expect(p).toContain("aice read");
        expect(p).toContain("aice splice");
        expect(p).not.toContain("aice context");
        expect(p).not.toContain("aice outline");
        expect(p).not.toContain("aice create");
      }
    }
  });

  it("permits aice read and aice splice while flagging workarounds, discovery bypasses, and --help/--dry-run", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-compliance-check-"));
    const runCheck = (cmd: string, mode: string) => {
      const p = path.join(tmpDir, `t-${Math.random().toString(36).slice(2, 8)}.jsonl`);
      fs.writeFileSync(
        p,
        `${JSON.stringify({
          type: "PLANNER_RESPONSE",
          tool_calls: [{ name: "run_command", args: { CommandLine: cmd } }],
        })}\n`,
      );
      return auditTranscriptCompliance(p, mode, tmpDir);
    };

    try {
      expect(runCheck('aice read . -s "*" --no-idioms', "aice_no_idioms").compliant).toBe(true);
      expect(
        runCheck(
          `aice splice --idioms --batch '[{"file":"a.ts","symbol":"s","code":"ls; head; cat > x; open(\\"f\\",\\"w\\")"}]'`,
          "aice_with_idioms",
        ).compliant,
      ).toBe(true);

      for (const badCmd of [
        "ls -la",
        "find . -maxdepth 2",
        "rg targetSym",
        "grep foo bar.ts",
        "sed -n '1,20p' a.ts",
        "head -n 20 a.ts",
        "tail -n 20 a.ts",
        "cat a.ts",
        "sed -i 's/a/b/g' a.ts",
        "echo 'x' > a.ts",
        "python3 -c \"open('a.ts','w').write('x')\"",
        "aice read --help",
        "aice splice --dry-run --stdin << 'EOF'\n=== a.ts ===\nx\nEOF",
        "aice disable",
      ]) {
        expect(
          runCheck(badCmd, "aice_no_idioms").compliant,
          `Expected violation for: ${badCmd}`,
        ).toBe(false);
      }

      expect(runCheck('aice read . -s "*"', "without_aice").compliant).toBe(false);
      expect(runCheck(`ls ${tmpDir}`, "without_aice").compliant).toBe(true);

      // Piped cat << 'EOF' | aice splice --idioms --stdin should NOT false-positive SHELL_FILE_WRITER_RE
      const pipedSplice =
        "cat << 'EOF' | aice splice --idioms --stdin\n=== a.ts:fnA ===\npub fn fnA(x:int) -> bool:\n  ret x > 0\nEOF";
      expect(runCheck(pipedSplice, "aice_with_idioms").compliant).toBe(true);
      expect(runCheck(pipedSplice, "aice_no_idioms").compliant).toBe(false);

      // Sandbox escapes (/tmp outside workspace, .., harness/transcript files) & ask_question flagged across ALL modes
      for (const m of ["without_aice", "aice_no_idioms", "aice_with_idioms"]) {
        expect(runCheck("ls /tmp/other-bench-dir", m).compliant).toBe(false);
        expect(runCheck("ls -la ..", m).compliant).toBe(false);
        expect(runCheck("cd .. && pwd", m).compliant).toBe(false);
        expect(runCheck("cat /tmp/aice-rw-audit-manifest.json", m).compliant).toBe(false);

        const askPath = path.join(tmpDir, `ask-${m}.jsonl`);
        fs.writeFileSync(
          askPath,
          `${JSON.stringify({
            type: "PLANNER_RESPONSE",
            tool_calls: [{ name: "ask_question", args: { questions: [] } }],
          })}\n`,
        );
        expect(auditTranscriptCompliance(askPath, m, tmpDir).compliant).toBe(false);
      }

      // Go './...' wildcard and benign compiler scratch outputs (`-o`/`-d` /tmp/*.jar|rlib|o) permitted in without_aice
      expect(runCheck("go vet ./...", "without_aice").compliant).toBe(true);
      expect(
        runCheck("kotlinc FraudScorer.kt -d /tmp/fraud.jar && rm -f /tmp/fraud.jar", "without_aice")
          .compliant,
      ).toBe(true);
      expect(
        runCheck(
          "rustc --crate-type lib matcher.rs -o /tmp/matcher.rlib && rm -f /tmp/matcher.rlib",
          "without_aice",
        ).compliant,
      ).toBe(true);
      expect(
        runCheck(
          "node /tmp/bunx-1000-typescript@latest/node_modules/typescript/bin/tsc --noEmit telemetry_router.ts",
          "without_aice",
        ).compliant,
      ).toBe(true);

      // Nested /sbx-XXXXXX/project wrapper allows single-level `ls -la ..` into empty outer wrapper, while blocking `../..`, `cd ..`, and `/tmp`
      const nestedSbx = setupWorkspace(ALL_REAL_AGENT_BENCHMARKS[0]!, "without_aice", 940935, true);
      try {
        const nestedTx = path.join(path.dirname(nestedSbx), "tx.jsonl");
        const checkNested = (commandLine: string) => {
          fs.writeFileSync(
            nestedTx,
            `${JSON.stringify({
              type: "PLANNER_RESPONSE",
              tool_calls: [{ name: "run_command", args: { CommandLine: commandLine } }],
            })}\n`,
          );
          return auditTranscriptCompliance(nestedTx, "without_aice", nestedSbx);
        };
        expect(checkNested("ls -la ..").compliant).toBe(true);
        expect(checkNested(`ls -a ${path.dirname(nestedSbx)}`).compliant).toBe(true);
        expect(checkNested("ls -la ../..").compliant).toBe(false);
        expect(checkNested("cd .. && pwd").compliant).toBe(false);
        expect(checkNested("ls /tmp/other-bench-dir").compliant).toBe(false);
      } finally {
        fs.rmSync(path.dirname(nestedSbx), { recursive: true, force: true });
      }

      // without_aice prompts include Target files, Autonomous Execution, and de-Streisanded boundaryRule
      const spec = ALL_REAL_AGENT_BENCHMARKS[0]!;
      const pWithout = buildPrompt(spec, "without_aice", tmpDir, 940935);
      const pLayerWithout = buildLayerPrompt(spec, "without_aice", tmpDir, 2);
      for (const wp of [pWithout, pLayerWithout]) {
        expect(wp).toContain("Target files:");
        expect(wp).toContain("Autonomous Execution:");
        expect(wp).toContain("complete self-contained specification");
        expect(wp).not.toContain("~/.gemini");
      }
      const nestedDir = setupWorkspace(spec, "without_aice", 940935, true);
      expect(path.basename(nestedDir)).toBe("project");
      expect(fs.readdirSync(path.dirname(nestedDir))).toEqual(["project"]);
      fs.rmSync(path.dirname(nestedDir), { recursive: true, force: true });
      // verifyCompilerAndSyntaxOnFile catches TS semantic errors (payload.len()) and C# members outside class
      const badTs = path.join(tmpDir, "bad_len.ts");
      fs.writeFileSync(
        badTs,
        "export function check(payload: string): number { return payload.len(); }\n",
        "utf-8",
      );
      expect(verifyCompilerAndSyntaxOnFile(badTs, "ts", tmpDir)).toContain("TS2339");

      const badCs = path.join(tmpDir, "BadScope.cs");
      fs.writeFileSync(
        badCs,
        "public class Main {\n  public static int Ok(int x) { return x; }\n}\npublic static int Orphan(int y) { return y; }\n",
        "utf-8",
      );
      expect(verifyCompilerAndSyntaxOnFile(badCs, "cs", tmpDir)).toContain(
        "outside class/struct/interface/record scope",
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  it("atomically merges per-run forensic entries into manifest JSON", () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-manifest-test-"));
    const manifestPath = path.join(tmpDir, "manifest.json");
    try {
      recordForensicManifestEntry(manifestPath, {
        id: "RW-01",
        mode: "without_aice",
        seed: 940935,
        conversationId: "conv-1",
        workspaceDir: "/tmp/ws-1",
        transcriptPath: "/tmp/t-1.jsonl",
        verified: true,
        regressionFree: true,
        decoysIntact: true,
        compilerVerified: true,
        zeroAice: true,
        llmTurns: 5,
        toolCalls: 8,
        workingTokens: 1000,
        inputTokens: 2000,
        outputTokens: 300,
        cacheReadTokens: 4000,
        apiCostUsd: 0.01,
        durationSeconds: 12,
        layers: [],
        details: [],
        updatedAt: "2026-11-14T16:00:00.000Z",
      });
      recordForensicManifestEntry(manifestPath, {
        id: "RW-01",
        mode: "aice_with_idioms",
        seed: 940935,
        conversationId: "conv-2",
        workspaceDir: "/tmp/ws-2",
        transcriptPath: "/tmp/t-2.jsonl",
        verified: true,
        regressionFree: true,
        decoysIntact: true,
        compilerVerified: true,
        zeroAice: true,
        llmTurns: 3,
        toolCalls: 4,
        workingTokens: 500,
        inputTokens: 1000,
        outputTokens: 150,
        cacheReadTokens: 2000,
        apiCostUsd: 0.005,
        durationSeconds: 8,
        layers: [],
        details: [],
        updatedAt: "2026-11-14T16:01:00.000Z",
      });

      const parsed = JSON.parse(fs.readFileSync(manifestPath, "utf-8"));
      expect(parsed.runs["RW-01"].without_aice.conversationId).toBe("conv-1");
      expect(parsed.runs["RW-01"].aice_with_idioms.conversationId).toBe("conv-2");
      expect(parsed.runs["RW-01"].aice_with_idioms.compilerVerified).toBe(true);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
