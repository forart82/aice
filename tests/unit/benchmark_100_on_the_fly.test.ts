import { describe, expect, it } from "vitest";
import {
  formatBenchmark100MarkdownReport,
  runBenchmark100Cases,
} from "../../src/tools/benchmark-100-cases.js";

describe("100-Case Deep On-the-Fly (Twinless + Smart Multi-File Idioms) Benchmark Suite", () => {
  it("executes all 100 distinct cases with 100% pass rate, 100% win rate, and zero .ail disk pollution", async () => {
    const summary = await runBenchmark100Cases();

    expect(summary.totalCases).toBe(100);
    expect(summary.passedCases).toBe(100);
    expect(summary.ailBetterCount).toBe(100);
    expect(summary.winRatePct).toBe(100);
    expect(summary.overallSavingsPct).toBeGreaterThan(60);
    expect(summary.averageSavingsPct).toBeGreaterThan(70);

    for (const r of summary.results) {
      expect(r.semanticPass).toBe(true);
      expect(r.zeroAilFilesOnDisk).toBe(true);
      expect(r.withAilTokens).toBeLessThan(r.withoutAilTokens);
      expect(r.ailBetter).toBe(true);
    }

    const md = formatBenchmark100MarkdownReport(summary);
    expect(md).toContain("| 001 |");
    expect(md).toContain("| 100 |");
    expect(md).toContain("100 / 100 (100.0%)");
  }, 60000);
});
