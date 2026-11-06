/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
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

    // Verify full 1,520-case Wave 10 report in docs/BENCHMARKS.md
    const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
    expect(fs.existsSync(docsPath)).toBe(true);
    const md = fs.readFileSync(docsPath, "utf-8");
    expect(md).toContain("1520 / 1520 (100.0%)");
    expect(md).toContain("15 Languages & File Types (100 Cases/Lang = 1500)");
    expect(md).toContain("20 Complex Multi-Language Full-Stack Scenarios");
  }, 60000);

  it("differentiates Window vs Non-Window application artifacts and bug_fix vs update_feature scenarios", async () => {
    const { generateBenchmarkArtifactForStep, buildIdiomRegistryForLanguage } = await import(
      "../../benchmarks/honest-suite.js"
    );
    const tsSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === "ts")!;
    const winBug = generateBenchmarkArtifactForStep(tsSpec, 1, "bug_fix", "window");
    const cliFeat = generateBenchmarkArtifactForStep(tsSpec, 1, "update_feature", "non_window");

    expect(winBug.targetSymbol).toBe("stepWindowFrame_0");
    expect(cliFeat.targetSymbol).toBe("processDaemonStep_0");
    expect(winBug.updatedTargetSymbolAil).not.toBe(cliFeat.updatedTargetSymbolAil);
    expect(buildIdiomRegistryForLanguage("css").idioms.$css_card).toBeDefined();
  });

  it("supports nested CSS @media rules, pseudo-selectors (.btn:hover), and multi-selectors in parseStyleDecl, CssEmitter, CssDecompiler, and idiom transforms", async () => {
    const { parse } = await import("../../src/core/parser.js");
    const { emitTarget } = await import("../../src/emitters/index.js");
    const { decompile } = await import("../../src/decompiler/index.js");
    const { collapseModuleIdioms, expandModuleIdioms } = await import("../../src/idioms/index.js");
    const { buildIdiomRegistryForLanguage } = await import("../../benchmarks/honest-suite.js");

    const { idioms } = buildIdiomRegistryForLanguage("css");
    const ailCss = [
      "style .btn:hover, button:focus {",
      '  $css_card("12px", "6px")',
      "  z-index: 5",
      "}",
      "",
      "style @media (max-width: 768px) {",
      "  .btn:hover {",
      '    $css_card("8px", "4px")',
      "  }",
      "}",
    ].join("\n");

    const mod = parse(ailCss, "responsive.ail");
    expect(mod.items).toHaveLength(2);
    const mediaDecl = mod.items[1];
    expect(mediaDecl.kind).toBe("StyleDecl");
    if (mediaDecl.kind === "StyleDecl") {
      expect(mediaDecl.name).toBe("@media (max-width: 768px)");
      expect(mediaDecl.children).toHaveLength(1);
      expect(mediaDecl.children?.[0].name).toBe(".btn:hover");
    }

    const expanded = expandModuleIdioms(mod, idioms);
    const emittedCss = emitTarget(expanded, "css", { watermark: false });
    expect(emittedCss).toContain(".btn:hover, button:focus {");
    expect(emittedCss).toContain("@media (max-width: 768px) {");
    expect(emittedCss).toContain("border-radius: 8px;");

    const decompiled = decompile(emittedCss, "css", { filePath: "responsive.css" });
    const collapsed = collapseModuleIdioms(decompiled.ast, idioms);
    expect(collapsed.collapsedCount).toBe(2);
  });
});
