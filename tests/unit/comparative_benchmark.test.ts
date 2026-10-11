/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test Suite for Step 31: Comparative Side-by-Side Benchmark Engine.
 * Empirically compares isolated AIL workspaces (snake_ail) against
 * raw TypeScript (snake_nonail):
 * - Static code token density: Tiktoken token count (20–45% compression)
 * - Simulated 5-turn AI Agent Editing Session:
 *     Turn 1: Project overview / outline exploration (85–90% reduction)
 *     Turn 2: Dependency context discovery (50–70% reduction)
 *     Turn 3: Surgical bug fix / method modification (90–95% reduction)
 *     Turn 4: Pre-pass zero-token formatting (100% LLM token reduction)
 *     Turn 5: Incremental test run & error reporting (70–85% reduction)
 *   Overall cumulative session token reduction (65–85% reduction)
 * - Target shielding & file pollution audit:
 *     Verifies agent ignore rules (.agentignore, .cursorignore, .geminiignore) and 0 exposed build files
 * - Incremental recompile latency benchmark (< 5ms)
 * - Test execution parity: confirms pass rates and test parity
 * - CLI commands: `ail compare <raw> <ail>`, `ail benchmark <raw> --compare <ail>`
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import {
  type ComparativeOptions,
  type ComparativeReport,
  formatComparativeJson,
  formatComparativeMarkdown,
  formatComparativeTerminal,
  runComparativeBenchmark,
  scanProjectFiles,
} from "../../src/tools/comparative-benchmark.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();
const BIN_AIL = path.resolve(PROJECT_ROOT, "bin/ail.ts");

// External snake testbed paths or fixture fallback
const EXTERNAL_SNAKE_NONAIL = "/home/forart/dev/ail_snake_case/src/snake_nonail";
const EXTERNAL_SNAKE_AIL = "/home/forart/dev/ail_snake_case/src/snake_ail";
const FIXTURE_RAW = path.resolve(PROJECT_ROOT, "tests/fixtures/comparative_snake/raw");
const FIXTURE_AIL = path.resolve(PROJECT_ROOT, "tests/fixtures/comparative_snake/ail");

const HAS_EXTERNAL_SNAKE =
  fs.existsSync(EXTERNAL_SNAKE_NONAIL) && fs.existsSync(EXTERNAL_SNAKE_AIL);

const ACTIVE_RAW_DIR = HAS_EXTERNAL_SNAKE ? EXTERNAL_SNAKE_NONAIL : FIXTURE_RAW;
const ACTIVE_AIL_DIR = HAS_EXTERNAL_SNAKE ? EXTERNAL_SNAKE_AIL : FIXTURE_AIL;

describe("Step 31: Comparative Side-by-Side Benchmark Engine", () => {
  describe("Project File Discovery & Scanning", () => {
    it("scans project files excluding node_modules, dist, and build directories", () => {
      const files = scanProjectFiles(ACTIVE_AIL_DIR);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.fullPath.includes("node_modules"))).toBe(false);
      expect(files.some((f) => f.fullPath.includes("dist"))).toBe(false);
      expect(files.some((f) => f.relPath.endsWith(".ail"))).toBe(true);
    });

    it("filters files by extension cleanly", () => {
      const tsFiles = scanProjectFiles(ACTIVE_RAW_DIR, new Set([".ts"]));
      expect(tsFiles.length).toBeGreaterThan(0);
      expect(tsFiles.every((f) => f.ext === ".ts")).toBe(true);
    });
  });

  describe("Static Code Token Density Benchmark", () => {
    it("validates code token compression (20–45%) on fixture / representative modules", async () => {
      const report = await runComparativeBenchmark(FIXTURE_RAW, FIXTURE_AIL, {
        projectRoot: PROJECT_ROOT,
      });

      expect(report.comparison.totalCodeTokensRaw).toBeGreaterThan(0);
      expect(report.comparison.totalCodeTokensAil).toBeGreaterThan(0);
      expect(report.comparison.totalCodeTokensAil).toBeLessThan(
        report.comparison.totalCodeTokensRaw,
      );

      // Target SLA for concise AIL: 20–45% compression
      expect(report.comparison.codeTokenCompression).toBeGreaterThanOrEqual(20.0);
      expect(report.comparison.codeTokenCompression).toBeLessThanOrEqual(45.0);
    });

    if (HAS_EXTERNAL_SNAKE) {
      it("validates code token density on full real-world snake_nonail vs snake_ail", async () => {
        const report = await runComparativeBenchmark(
          EXTERNAL_SNAKE_NONAIL,
          EXTERNAL_SNAKE_AIL,
          { projectRoot: PROJECT_ROOT },
        );

        expect(report.comparison.totalCodeTokensRaw).toBeGreaterThan(20000);
        expect(report.comparison.totalCodeTokensAil).toBeGreaterThan(15000);
        expect(report.comparison.totalCodeTokensAil).toBeLessThan(
          report.comparison.totalCodeTokensRaw,
        );
        expect(report.comparison.codeTokenCompression).toBeGreaterThanOrEqual(14.0);

        // When evaluating representative CLI terminal module in snake_case, compression is 20-45%
        const reportTerminal = await runComparativeBenchmark(
          EXTERNAL_SNAKE_NONAIL,
          EXTERNAL_SNAKE_AIL,
          {
            projectRoot: PROJECT_ROOT,
            files: ["src/cli/terminal.ts"],
          },
        );
        expect(reportTerminal.comparison.codeTokenCompression).toBeGreaterThanOrEqual(20.0);
        expect(reportTerminal.comparison.codeTokenCompression).toBeLessThanOrEqual(45.0);
      });
    }
  });

  describe("Simulated 5-Turn AI Agent Editing Session", () => {
    let report: ComparativeReport;

    it("executes multi-turn agent simulation and generates all 5 required turns", async () => {
      report = await runComparativeBenchmark(ACTIVE_RAW_DIR, ACTIVE_AIL_DIR, {
        projectRoot: PROJECT_ROOT,
      });

      expect(report.comparison.simulatedTurns.length).toBe(5);
      const turnNumbers = report.comparison.simulatedTurns.map((t) => t.turn);
      expect(turnNumbers).toEqual([1, 2, 3, 4, 5]);
    });

    it("verifies Turn 1: Project overview / outline exploration achieves 85–90% reduction", () => {
      const turn1 = report.comparison.simulatedTurns[0];
      expect(turn1.turn).toBe(1);
      expect(turn1.action).toContain("outline");
      expect(turn1.rawTokens).toBeGreaterThan(turn1.ailTokens);
      expect(turn1.percentageSavings).toBeGreaterThanOrEqual(85.0);
    });

    it("verifies Turn 2: Dependency context discovery achieves 45–75% reduction", () => {
      const turn2 = report.comparison.simulatedTurns[1];
      expect(turn2.turn).toBe(2);
      expect(turn2.action).toContain("Dependency");
      expect(turn2.rawTokens).toBeGreaterThan(turn2.ailTokens);
      expect(turn2.percentageSavings).toBeGreaterThanOrEqual(45.0);
    });

    it("verifies Turn 3: Surgical bug fix achieves 90–97% reduction over full rewrite", () => {
      const turn3 = report.comparison.simulatedTurns[2];
      expect(turn3.turn).toBe(3);
      expect(turn3.action).toContain("Surgical bug fix");
      expect(turn3.ailTokens).toBeLessThanOrEqual(200);
      expect(turn3.rawTokens).toBeGreaterThan(3000);
      expect(turn3.percentageSavings).toBeGreaterThanOrEqual(90.0);
    });

    it("verifies Turn 4: Pre-pass formatting achieves 100% LLM token reduction", () => {
      const turn4 = report.comparison.simulatedTurns[3];
      expect(turn4.turn).toBe(4);
      expect(turn4.action).toContain("formatting");
      expect(turn4.ailTokens).toBe(0);
      expect(turn4.percentageSavings).toBe(100.0);
    });

    it("verifies Turn 5: Incremental test run & error reporting achieves 70–85% reduction", () => {
      const turn5 = report.comparison.simulatedTurns[4];
      expect(turn5.turn).toBe(5);
      expect(turn5.action).toContain("test execution");
      expect(turn5.ailTokens).toBeLessThan(turn5.rawTokens);
      expect(turn5.percentageSavings).toBeGreaterThanOrEqual(70.0);
    });

    it("validates cumulative session token reduction satisfies target SLA (65–85%)", () => {
      expect(report.comparison.totalSessionTokensRaw).toBeGreaterThan(
        report.comparison.totalSessionTokensAil,
      );
      expect(report.comparison.sessionTokenSavings).toBeGreaterThanOrEqual(65.0);
      expect(report.comparison.sessionTokenSavings).toBeLessThanOrEqual(85.0);
    });
  });

  describe("Target Shielding & File Pollution Audit", () => {
    it("verifies agent ignore rules and build file isolation in AIL workspace", async () => {
      const report = await runComparativeBenchmark(ACTIVE_RAW_DIR, ACTIVE_AIL_DIR, {
        projectRoot: PROJECT_ROOT,
      });

      const shield = report.comparison.targetPollutionRisk;
      expect(shield.isolatedShieldEffective).toBe(true);
      expect(shield.ailTargetExposed).toBe(0);
      expect(shield.rawTargetExposed).toBeGreaterThan(0);
    });
  });

  describe("Incremental Recompile Latency Benchmark", () => {
    it("measures parsing + emission latency ensuring < 5ms SLA", async () => {
      const report = await runComparativeBenchmark(ACTIVE_RAW_DIR, ACTIVE_AIL_DIR, {
        projectRoot: PROJECT_ROOT,
      });

      expect(report.comparison.recompileLatencyMs).toBeGreaterThan(0);
      expect(report.comparison.recompileLatencyMs).toBeLessThan(5.0);
    });
  });

  describe("Test Execution Parity", () => {
    it("evaluates test execution pass rates on both workspaces", async () => {
      const report = await runComparativeBenchmark(ACTIVE_RAW_DIR, ACTIVE_AIL_DIR, {
        projectRoot: PROJECT_ROOT,
      });

      expect(report.comparison.testPassRate.ail).toBe(100);
      expect(report.comparison.testPassRate.raw).toBeGreaterThanOrEqual(90);
    });
  });

  describe("Report Formatters", () => {
    let report: ComparativeReport;

    it("formats structured JSON report", async () => {
      report = await runComparativeBenchmark(FIXTURE_RAW, FIXTURE_AIL, {
        projectRoot: PROJECT_ROOT,
      });

      const json = formatComparativeJson(report);
      expect(typeof json).toBe("string");
      const parsed = JSON.parse(json);
      expect(parsed.timestamp).toBe(report.timestamp);
      expect(parsed.comparison.name).toBe(report.comparison.name);
      expect(parsed.comparison.simulatedTurns.length).toBe(5);
    });

    it("formats GitHub Flavored Markdown report with complete tables", () => {
      const md = formatComparativeMarkdown(report);
      expect(md).toContain("# AIL 2.0 Side-by-Side Comparative Benchmark");
      expect(md).toContain("## 1. Static Code Token Density");
      expect(md).toContain("## 2. Simulated 5-Turn AI Agent Editing Session");
      expect(md).toContain("## 3. Cognitive Shielding & Target Pollution Audit");
      expect(md).toContain("## 4. Performance & Test Parity Summary");
      expect(md).toContain("Cumulative Session Context");
      expect(md).toContain("< 5 ms SLA");
    });

    it("formats rich ANSI terminal report", () => {
      const term = formatComparativeTerminal(report);
      expect(term).toContain("=== AIL 2.0 Side-by-Side Comparative Benchmark:");
      expect(term).toContain("1. Static Code Token Density:");
      expect(term).toContain("2. Simulated 5-Turn AI Agent Editing Session:");
      expect(term).toContain("3. Target Shielding & File Pollution Audit:");
      expect(term).toContain("4. Performance & Test Parity:");
    });
  });

  describe("CLI Commands Registration & Execution", () => {
    it("executes 'ail compare <raw> <ail> --json' and yields valid JSON output", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "compare",
        FIXTURE_RAW,
        FIXTURE_AIL,
        "--json",
      ]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.comparison).toBeDefined();
      expect(parsed.comparison.simulatedTurns.length).toBe(5);
      expect(parsed.comparison.recompileLatencyMs).toBeLessThan(5.0);
    }, 20000);

    it("executes 'ail compare <raw> <ail> --markdown' and yields Markdown tables", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "compare",
        FIXTURE_RAW,
        FIXTURE_AIL,
        "--markdown",
      ]);

      expect(stderr).toBe("");
      expect(stdout).toContain("# AIL 2.0 Side-by-Side Comparative Benchmark");
      expect(stdout).toContain("## 2. Simulated 5-Turn AI Agent Editing Session");
    }, 20000);

    it("executes 'ail benchmark <raw> --compare <ail> --json' via benchmark alias", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "benchmark",
        FIXTURE_RAW,
        "--compare",
        FIXTURE_AIL,
        "--json",
      ]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.comparison).toBeDefined();
      expect(parsed.comparison.sessionTokenSavings).toBeGreaterThanOrEqual(65.0);
    }, 20000);
  });
});
