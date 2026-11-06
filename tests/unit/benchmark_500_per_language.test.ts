/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & E2E verification for the AIL 2.0 500-Per-Language & File-Type Progressive On-the-Fly Benchmark Suite
 * (15 Supported Languages/File Types × 500 Progressive Benchmarks = 7,500 Benchmarks).
 */

import { describe, expect, it } from "vitest";
import { SUPPORTED_DIALECT_SPECS } from "../../src/tools/benchmark-500-cases.js";
import {
  formatAllDialects500MarkdownReport,
  runAllDialects500Benchmarks,
} from "../../src/tools/benchmark-500-per-language.js";

describe("500-Per-Language & File-Type Progressive On-the-Fly Benchmark Suite (15 × 500 = 7,500 Cases)", () => {
  const summary = runAllDialects500Benchmarks();

  it("executes 500 progressive benchmarks (#001 -> #500) for all 15 supported file types and programming languages (7,500 total) with 100% win rate", () => {
    expect(summary.totalDialects).toBe(15);
    expect(summary.casesPerDialect).toBe(500);
    expect(summary.totalCases).toBe(7500);
    expect(summary.totalPassedCases).toBe(7500);
    expect(summary.allStrictProgressiveComplexity).toBe(true);
    expect(summary.totalBeatsWithoutAilAtAll).toBe(7500);
    expect(summary.totalBeatsWithoutOnTheFly).toBe(7500);
    expect(summary.totalAilOnTheFlyWinsAll).toBe(7500);
    expect(summary.overallWinRatePct).toBe(100);
  });

  for (const spec of SUPPORTED_DIALECT_SPECS) {
    it(`achieves 500/500 (100%) progressive wins for ${spec.label} (${spec.ext}) vs both Without AIL On-the-Fly and Without AIL at All`, () => {
      const dialectSuite = summary.dialectSuites.find(
        (d) => d.spec.lang === spec.lang,
      );
      expect(dialectSuite).toBeDefined();
      const s = dialectSuite!.summary;
      expect(s.totalCases).toBe(500);
      expect(s.passedCases).toBe(500);
      expect(s.strictProgressiveComplexity).toBe(true);
      expect(s.beatsWithoutAilAtAllCount).toBe(500);
      expect(s.beatsWithoutOnTheFlyCount).toBe(500);
      expect(s.ailOnTheFlyWinsAllCount).toBe(500);
      expect(s.winRatePct).toBe(100);

      for (let i = 0; i < s.results.length; i++) {
        const r = s.results[i];
        if (i > 0) {
          expect(r.complexityScore).toBeGreaterThan(
            s.results[i - 1].complexityScore,
          );
        }
        expect(r.semanticPass, `${r.id} semanticPass: ${r.diagnostic}`).toBe(true);
        expect(r.zeroAilFilesOnDisk).toBe(true);
        expect(r.withAilOnTheFlyTokens).toBeLessThan(r.withoutAilOnTheFlyTokens);
        expect(r.withAilOnTheFlyTokens).toBeLessThan(r.withoutAilAtAllTokens);
        expect(r.ailOnTheFlyWinsAll).toBe(true);
      }
    });
  }

  it("formats a complete Markdown report covering all 15 languages/file types and 7,500 benchmarks", () => {
    const md = formatAllDialects500MarkdownReport(summary);
    expect(md).toContain("7,500");
    expect(md).toContain("100%");
    for (const spec of SUPPORTED_DIALECT_SPECS) {
      expect(md).toContain(spec.label);
      expect(md).toContain(spec.ext);
    }
  });
});
