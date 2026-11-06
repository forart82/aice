/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & E2E verification for the AIL 2.0 Progressive 500-Case On-the-Fly Benchmark Suite (#001 -> #500).
 */

import { describe, expect, it } from "vitest";
import {
  formatBenchmark500MarkdownReport,
  run500OnTheFlyBenchmarks,
  SUPPORTED_DIALECT_SPECS,
} from "../../src/tools/benchmark-500-cases.js";

describe("500-Case Progressive On-the-Fly (Twinless + Smart Multi-File Idioms) Benchmark Suite", () => {
  const summary = run500OnTheFlyBenchmarks();

  it("executes all 500 progressive benchmarks (#001 -> #500) with 100% win rate vs both Without AIL On-the-Fly and Without AIL at All", () => {
    expect(summary.totalCases).toBe(500);
    expect(summary.passedCases).toBe(500);
    expect(summary.beatsWithoutAilAtAllCount).toBe(500);
    expect(summary.beatsWithoutOnTheFlyCount).toBe(500);
    expect(summary.ailOnTheFlyWinsAllCount).toBe(500);
    expect(summary.winRatePct).toBe(100);
    expect(summary.overallSavingsVsWithoutAilAtAllPct).toBeGreaterThan(80);
    expect(summary.overallSavingsVsWithoutOnTheFlyPct).toBeGreaterThan(80);
  });

  it("enforces strictly increasing complexity (complexity[i] > complexity[i-1]) across all 500 benchmarks", () => {
    expect(summary.strictProgressiveComplexity).toBe(true);
    for (let i = 1; i < summary.results.length; i++) {
      expect(summary.results[i].complexityScore).toBeGreaterThan(
        summary.results[i - 1].complexityScore,
      );
      expect(summary.results[i].strictComplexityIncrease).toBe(true);
    }
  });

  it("guarantees in every single benchmark (#001..#500) that AIL On-the-Fly beats both Without AIL On-the-Fly and Without AIL at All with zero .ail files on disk", () => {
    for (const r of summary.results) {
      expect(r.semanticPass, `${r.id} semanticPass: ${r.diagnostic}`).toBe(true);
      expect(r.zeroAilFilesOnDisk, `${r.id} zeroAilFilesOnDisk`).toBe(true);
      expect(
        r.withAilOnTheFlyTokens,
        `${r.id} withAilOnTheFlyTokens (${r.withAilOnTheFlyTokens}) < withoutAilOnTheFlyTokens (${r.withoutAilOnTheFlyTokens})`,
      ).toBeLessThan(r.withoutAilOnTheFlyTokens);
      expect(
        r.withAilOnTheFlyTokens,
        `${r.id} withAilOnTheFlyTokens (${r.withAilOnTheFlyTokens}) < withoutAilAtAllTokens (${r.withoutAilAtAllTokens})`,
      ).toBeLessThan(r.withoutAilAtAllTokens);
      expect(r.ailOnTheFlyWinsAll).toBe(true);
    }
  });

  it("covers all 10 progressive complexity tiers (50 cases each) and all 15 supported languages/file types", () => {
    expect(summary.tierSummaries.length).toBe(10);
    for (const t of summary.tierSummaries) {
      expect(t.cases).toBe(50);
      expect(t.wins).toBe(50);
    }
    const coveredLangs = new Set(summary.results.map((r) => r.lang));
    expect(coveredLangs.size).toBe(SUPPORTED_DIALECT_SPECS.length);
  });

  it("formats a complete Markdown benchmark report", () => {
    const md = formatBenchmark500MarkdownReport(summary);
    expect(md).toContain("Progressive 500-Case On-the-Fly Benchmark Report");
    expect(md).toContain("500/500 (100%)");
    expect(md).toContain("B500-500");
  });
});
