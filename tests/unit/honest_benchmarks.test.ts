/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  POLYGLOT_FULLSTACK_SCENARIOS,
  SUPPORTED_BENCHMARK_LANGUAGES,
  runHonestBenchmarkSuite,
} from "../../benchmarks/index.js";

describe("AIL 2.0 Honest, Clean & Trustworthy Benchmark Suite", () => {
  it("covers all 15 supported languages and file types, full CRUD, 5 scenarios, Window vs Non-Window apps, and 20 polyglot full-stack benchmarks", () => {
    expect(SUPPORTED_BENCHMARK_LANGUAGES).toHaveLength(15);
    expect(POLYGLOT_FULLSTACK_SCENARIOS).toHaveLength(20);

    const report = runHonestBenchmarkSuite(10);
    expect(report.totalSingleLanguageCases).toBe(150);
    expect(report.totalPolyglotCases).toBe(20);
    expect(report.totalCases).toBe(170);
    expect(report.totalWins).toBe(170);
    expect(report.overallWinRatePct).toBe(100);
    expect(report.strictComplexityMonotonicity).toBe(true);
    expect(report.zeroAilFilesLeftOnDisk).toBe(true);

    // Greenfield Window (Snake) & Non-Window (CLI Daemon) apps from 0
    expect(report.greenfieldSnakeWindowApp.appSurface).toBe("window");
    expect(report.greenfieldSnakeWindowApp.writeFromZero.ailWins).toBe(true);
    expect(report.greenfieldSnakeWindowApp.readContext.ailWins).toBe(true);
    expect(report.greenfieldSnakeWindowApp.surgicalUpdate.ailWins).toBe(true);
    expect(report.greenfieldSnakeWindowApp.surgicalDelete.ailWins).toBe(true);
    expect(report.greenfieldSnakeWindowApp.multiFileRefactor.ailWins).toBe(true);
    expect(report.greenfieldSnakeWindowApp.zeroAilFilesLeftOnDisk).toBe(true);

    expect(report.greenfieldCliNonWindowApp.appSurface).toBe("non_window");
    expect(report.greenfieldCliNonWindowApp.writeFromZero.ailWins).toBe(true);
    expect(report.greenfieldCliNonWindowApp.readContext.ailWins).toBe(true);
    expect(report.greenfieldCliNonWindowApp.surgicalUpdate.ailWins).toBe(true);
    expect(report.greenfieldCliNonWindowApp.surgicalDelete.ailWins).toBe(true);
    expect(report.greenfieldCliNonWindowApp.multiFileRefactor.ailWins).toBe(true);
    expect(report.greenfieldCliNonWindowApp.zeroAilFilesLeftOnDisk).toBe(true);

    // All 5 engineering scenarios
    expect(report.scenarioBreakdown.bug_fix.winCount).toBe(
      report.scenarioBreakdown.bug_fix.casesCount,
    );
    expect(report.scenarioBreakdown.new_feature.winCount).toBe(
      report.scenarioBreakdown.new_feature.casesCount,
    );
    expect(report.scenarioBreakdown.update_feature.winCount).toBe(
      report.scenarioBreakdown.update_feature.casesCount,
    );
    expect(report.scenarioBreakdown.from_zero_window_app.winCount).toBe(
      report.scenarioBreakdown.from_zero_window_app.casesCount,
    );
    expect(report.scenarioBreakdown.from_zero_non_window_app.winCount).toBe(
      report.scenarioBreakdown.from_zero_non_window_app.casesCount,
    );

    // Window vs Non-Window surface breakdown
    expect(report.surfaceBreakdown.window.winCount).toBe(
      report.surfaceBreakdown.window.casesCount,
    );
    expect(report.surfaceBreakdown.non_window.winCount).toBe(
      report.surfaceBreakdown.non_window.casesCount,
    );

    // 20 Polyglot Full-Stack benchmarks
    for (const poly of report.polyglotBenchmarks) {
      expect(poly.ailWinsAllOperations).toBe(true);
      expect(poly.zeroAilFilesLeftOnDisk).toBe(true);
    }
  }, 60000);
});
