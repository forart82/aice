/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Test Suite for Step 30: Toolchain Token Reduction Empirical Benchmark Suite.
 * Verifies empirical tokenomics across all core productivity & context tools:
 * - outline: >= 70–90% token reduction
 * - splice: >= 80–95% token reduction
 * - context: 1-turn bounded context pack vs multi-turn raw dependencies
 * - fmt: Zero-token deterministic canonical formatting pre-pass
 * - intermediate_dsl: 20–45% token compression over target languages
 * - CLI commands: ail benchmark, ail benchmark --json, ail benchmark --markdown
 */

import { describe, expect, it } from "vitest";
import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { promisify } from "node:util";
import {
  type BenchmarkOptions,
  type BenchmarkSuiteReport,
  benchmarkContext,
  benchmarkFmt,
  benchmarkIntermediateDsl,
  benchmarkOutline,
  benchmarkSplice,
  formatBenchmarkJson,
  formatBenchmarkMarkdown,
  formatBenchmarkTerminal,
  normalizeToolName,
  parseToolsFilter,
  resolveBenchmarkFiles,
  runTokenomicsBenchmark,
} from "../../src/tools/benchmark-suite.js";

const execFileAsync = promisify(execFile);
const PROJECT_ROOT = process.cwd();
const BIN_AIL = path.resolve(PROJECT_ROOT, "bin/ail.ts");

describe("Step 30: Toolchain Token Reduction Empirical Benchmark Suite", () => {
  describe("Utility & Configuration Helpers", () => {
    it("normalizes tool name aliases correctly", () => {
      expect(normalizeToolName("outline")).toBe("outline");
      expect(normalizeToolName("splice")).toBe("splice");
      expect(normalizeToolName("context")).toBe("context");
      expect(normalizeToolName("fmt")).toBe("fmt");
      expect(normalizeToolName("format")).toBe("fmt");
      expect(normalizeToolName("intermediate_dsl")).toBe("intermediate_dsl");
      expect(normalizeToolName("intermediate-dsl")).toBe("intermediate_dsl");
      expect(normalizeToolName("dsl")).toBe("intermediate_dsl");
      expect(normalizeToolName("ail")).toBe("intermediate_dsl");
      expect(normalizeToolName("unknown_tool")).toBeNull();
    });

    it("parses tools filter from array and comma-separated string", () => {
      const allFilter = parseToolsFilter();
      expect(allFilter.size).toBe(5);

      const arrayFilter = parseToolsFilter(["outline", "splice"]);
      expect(arrayFilter.has("outline")).toBe(true);
      expect(arrayFilter.has("splice")).toBe(true);
      expect(arrayFilter.has("context")).toBe(false);

      const strFilter = parseToolsFilter("outline,dsl,fmt");
      expect(strFilter.has("outline")).toBe(true);
      expect(strFilter.has("intermediate_dsl")).toBe(true);
      expect(strFilter.has("fmt")).toBe(true);
      expect(strFilter.has("context")).toBe(false);
    });

    it("discovers candidate benchmark files dynamically", () => {
      const files = resolveBenchmarkFiles(undefined, PROJECT_ROOT);
      expect(files.length).toBeGreaterThan(0);
      expect(files.some((f) => f.includes("snake") || f.includes("examples"))).toBe(true);

      const explicitFiles = resolveBenchmarkFiles(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], PROJECT_ROOT);
      expect(explicitFiles).toEqual(["tests/fixtures/snake_ail/src/core/engine.ts.ail"]);
    });
  });

  describe("Tool Benchmark 1: Outline (Semantic AST Skeleton)", () => {
    it("verifies outline achieves >= 70-90% token reduction on tests/fixtures/snake_ail/src/core/engine.ts.ail", async () => {
      const metric = await benchmarkOutline("tests/fixtures/snake_ail/src/core/engine.ts.ail", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("outline");
      expect(metric.targetFile).toContain("engine.ts.ail");
      expect(metric.originalTokens).toBeGreaterThan(1000);
      expect(metric.optimizedTokens).toBeLessThan(metric.originalTokens);
      expect(metric.tokensSaved).toBeGreaterThan(0);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(70.0);
      expect(metric.details).toBeDefined();
      expect(metric.details?.symbolsCount).toBeGreaterThan(0);
    });

    it("verifies outline achieves >= 70-90% token reduction on examples/ecommerce_domain.ts", async () => {
      const metric = await benchmarkOutline("examples/ecommerce_domain.ts", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("outline");
      expect(metric.originalTokens).toBeGreaterThan(4000);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(70.0);
    });

    it("verifies outline achieves >= 75-90% token reduction on poc_real_case GameEngine.ts.ail", async () => {
      const target = "poc_real_case/snake_ts/src/sim/GameEngine.ts.ail";
      if (!fs.existsSync(path.resolve(PROJECT_ROOT, target))) return;

      const metric = await benchmarkOutline(target, "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(75.0);
    });
  });

  describe("Tool Benchmark 2: Splice (AST Surgical Splice vs Full Rewrite)", () => {
    it("verifies splice achieves >= 80-95% token reduction on tests/fixtures/snake_ail/src/core/engine.ts.ail", async () => {
      const metric = await benchmarkSplice("tests/fixtures/snake_ail/src/core/engine.ts.ail", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("splice");
      expect(metric.originalTokens).toBeGreaterThan(1000);
      expect(metric.optimizedTokens).toBeLessThan(50);
      expect(metric.tokensSaved).toBeGreaterThan(900);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(80.0);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(95.0);
      expect(metric.details?.targetSymbol).toBeDefined();
    });

    it("verifies splice achieves >= 85-95% token reduction on examples/ecommerce_domain.ts", async () => {
      const metric = await benchmarkSplice("examples/ecommerce_domain.ts", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("splice");
      expect(metric.originalTokens).toBeGreaterThan(3000);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(85.0);
    });
  });

  describe("Tool Benchmark 3: Context (1-Turn Bounded Context Pack vs Multi-Turn Raw)", () => {
    it("verifies 1-turn context pack saves tokens over multi-turn uncompressed dependencies", async () => {
      const metric = await benchmarkContext("tests/fixtures/snake_ail/src/core/engine.ts.ail", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("context");
      expect(metric.originalTokens).toBeGreaterThan(metric.optimizedTokens);
      expect(metric.tokensSaved).toBeGreaterThan(0);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(50.0);
      expect(metric.details?.boundedPackTokens).toBe(metric.optimizedTokens);
    }, 20000);

    it("verifies 1-turn context pack on ecommerce_domain.ts", async () => {
      const metric = await benchmarkContext("examples/ecommerce_domain.ts", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("context");
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(50.0);
    }, 20000);
  });

  describe("Tool Benchmark 4: Fmt (Zero-Token Deterministic Pre-Pass)", () => {
    it("verifies fmt delivers 100% LLM token reduction via deterministic pre-pass", async () => {
      const metric = await benchmarkFmt("tests/fixtures/snake_ail/src/core/engine.ts.ail", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("fmt");
      expect(metric.optimizedTokens).toBe(0);
      expect(metric.tokensSaved).toBe(metric.originalTokens);
      expect(metric.reductionPercentage).toBe(100.0);
      expect(metric.details?.zeroTokenLlmPrepass).toBe(true);
      expect(metric.details?.localDeterministic).toBe(true);
    });
  });

  describe("Tool Benchmark 5: Intermediate DSL (Canonical AIL Token Density)", () => {
    it("verifies intermediate_dsl token compression on examples/ecommerce_domain.ts (20–45%)", async () => {
      const metric = await benchmarkIntermediateDsl("examples/ecommerce_domain.ts", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("intermediate_dsl");
      expect(metric.originalTokens).toBe(5429);
      expect(metric.optimizedTokens).toBe(3567);
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(20.0);
      expect(metric.reductionPercentage).toBeLessThanOrEqual(45.0);
      expect(metric.details?.targetLang).toBe("typescript");
    });

    it("verifies intermediate_dsl token compression on examples/auth_service.ts (20–45%)", async () => {
      const metric = await benchmarkIntermediateDsl("examples/auth_service.ts", "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.tool).toBe("intermediate_dsl");
      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(20.0);
      expect(metric.reductionPercentage).toBeLessThanOrEqual(45.0);
    });

    it("verifies intermediate_dsl token compression on poc_real_case SnakePlayer.ts (20–45%)", async () => {
      const target = "poc_real_case/snake_ts/src/sim/SnakePlayer.ts";
      if (!fs.existsSync(path.resolve(PROJECT_ROOT, target))) return;

      const metric = await benchmarkIntermediateDsl(target, "cl100k_base", PROJECT_ROOT);
      expect(metric).not.toBeNull();
      if (!metric) return;

      expect(metric.reductionPercentage).toBeGreaterThanOrEqual(20.0);
      expect(metric.reductionPercentage).toBeLessThanOrEqual(45.0);
    });
  });

  describe("Full Benchmark Suite Execution & Aggregation", () => {
    it("runs complete suite and aggregates metricsByTool across all tools", async () => {
      const report = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail", "examples/ecommerce_domain.ts"]);

      expect(report.timestamp).toBeDefined();
      expect(report.totalFilesAnalyzed).toBe(2);
      expect(report.overallOriginalTokens).toBeGreaterThan(report.overallOptimizedTokens);
      expect(report.overallSavingsPercentage).toBeGreaterThan(50.0);
      expect(report.benchmarks.length).toBe(10); // 2 files * 5 tools

      const tools: Array<"outline" | "splice" | "context" | "fmt" | "intermediate_dsl"> = [
        "outline",
        "splice",
        "context",
        "fmt",
        "intermediate_dsl",
      ];

      for (const t of tools) {
        const m = report.metricsByTool[t];
        expect(m).toBeDefined();
        expect(m.count).toBe(2);
        expect(m.totalTokensSaved).toBeGreaterThan(0);
        expect(m.averageSavingsPercentage).toBeGreaterThan(0);
      }
    }, 20000);

    it("supports Tiktoken encoding options (cl100k_base vs o200k_base)", async () => {
      const reportCl100k = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        encoding: "cl100k_base",
        tools: ["outline"],
      });
      const reportO200k = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        encoding: "o200k_base",
        tools: ["outline"],
      });

      expect(reportCl100k.overallOriginalTokens).toBeGreaterThan(0);
      expect(reportO200k.overallOriginalTokens).toBeGreaterThan(0);
      expect(reportCl100k.metricsByTool.outline.averageSavingsPercentage).toBeGreaterThanOrEqual(70.0);
      expect(reportO200k.metricsByTool.outline.averageSavingsPercentage).toBeGreaterThanOrEqual(70.0);
    });

    it("filters tools cleanly when options.tools is specified", async () => {
      const report = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        tools: ["outline", "splice"],
      });

      expect(report.benchmarks.length).toBe(2);
      expect(report.benchmarks.map((b) => b.tool)).toEqual(["outline", "splice"]);
      expect(report.metricsByTool.outline).toBeDefined();
      expect(report.metricsByTool.splice).toBeDefined();
      expect(report.metricsByTool.context).toBeUndefined();
    });
  });

  describe("Formatters", () => {
    it("formats structured JSON report", async () => {
      const report = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        tools: ["outline", "splice"],
      });
      const json = formatBenchmarkJson(report);
      const parsed = JSON.parse(json);

      expect(parsed.totalFilesAnalyzed).toBe(1);
      expect(parsed.benchmarks.length).toBe(2);
      expect(parsed.overallSavingsPercentage).toBeGreaterThan(0);
    });

    it("formats GitHub Flavored Markdown report", async () => {
      const report = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        tools: ["outline", "splice"],
      });
      const md = formatBenchmarkMarkdown(report);

      expect(md).toContain("# AIL 2.0 Toolchain Token Reduction Empirical Benchmark Suite");
      expect(md).toContain("| Tool | Engine Description | Samples | Total Tokens Saved | Avg Reduction % | Target SLA |");
      expect(md).toContain("## Detailed Empirical Measurements");
      expect(md).toContain("`outline`");
      expect(md).toContain("`splice`");
    });

    it("formats rich ANSI terminal report", async () => {
      const report = await runTokenomicsBenchmark(["tests/fixtures/snake_ail/src/core/engine.ts.ail"], {
        tools: ["outline", "splice"],
      });
      const term = formatBenchmarkTerminal(report);

      expect(term).toContain("AIL 2.0 Toolchain Token Reduction Empirical Benchmark Suite");
      expect(term).toContain("Summary by Toolchain Engine:");
      expect(term).toContain("outline");
      expect(term).toContain("splice");
    });
  });

  describe("CLI Command Registration & Execution", () => {
    it("executes 'ail benchmark <target>' and prints terminal report", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "benchmark",
        "tests/fixtures/snake_ail/src/core/engine.ts.ail",
      ]);

      expect(stderr).toBe("");
      expect(stdout).toContain("AIL 2.0 Toolchain Token Reduction Empirical Benchmark Suite");
      expect(stdout).toContain("outline");
      expect(stdout).toContain("splice");
      expect(stdout).toContain("fmt");
    }, 20000);

    it("executes 'ail benchmark --json <target>' and yields valid JSON", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "benchmark",
        "--json",
        "tests/fixtures/snake_ail/src/core/engine.ts.ail",
      ]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.totalFilesAnalyzed).toBe(1);
      expect(Array.isArray(parsed.benchmarks)).toBe(true);
      expect(parsed.benchmarks.length).toBe(5);
    }, 20000);

    it("executes 'ail benchmark --markdown <target>' and yields Markdown tables", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "benchmark",
        "--markdown",
        "tests/fixtures/snake_ail/src/core/engine.ts.ail",
      ]);

      expect(stderr).toBe("");
      expect(stdout).toContain("# AIL 2.0 Toolchain Token Reduction Empirical Benchmark Suite");
      expect(stdout).toContain("## Summary by Toolchain Engine");
      expect(stdout).toContain("## Detailed Empirical Measurements");
    }, 20000);

    it("executes 'ail benchmark --tools outline,dsl <target>' filtering tools", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "benchmark",
        "--tools",
        "outline,dsl",
        "--json",
        "tests/fixtures/snake_ail/src/core/engine.ts.ail",
      ]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.benchmarks.length).toBe(2);
      expect(parsed.benchmarks.map((b: any) => b.tool)).toEqual(["outline", "intermediate_dsl"]);
    }, 20000);

    it("executes 'ail tokens --benchmark --json <target>' via tokenomics alias", async () => {
      const { stdout, stderr } = await execFileAsync("bun", [
        BIN_AIL,
        "tokens",
        "--benchmark",
        "--json",
        "tests/fixtures/snake_ail/src/core/engine.ts.ail",
      ]);

      expect(stderr).toBe("");
      const parsed = JSON.parse(stdout);
      expect(parsed.totalFilesAnalyzed).toBe(1);
      expect(parsed.benchmarks.length).toBe(5);
    }, 20000);
  });
});
