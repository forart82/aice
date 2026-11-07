/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIdiomRegistryForLanguage,
  REAL_WORLD_BENCHMARKS,
  runRealWorldBenchmarkSuite,
  SUPPORTED_BENCHMARK_LANGUAGES,
} from "../../benchmarks/index.js";

describe("AIL 2.0 Real-World Benchmark Suite (10 Scenarios — Without & With Idioms)", () => {
  it("evaluates exactly 10 real-world benchmarks across all 15 file types, 5 scenarios, Window/Non-Window surfaces, and CRUD+Refactor operations both without and with idioms", () => {
    expect(SUPPORTED_BENCHMARK_LANGUAGES).toHaveLength(15);
    expect(REAL_WORLD_BENCHMARKS).toHaveLength(10);

    const report = runRealWorldBenchmarkSuite();
    expect(report.totalBenchmarks).toBe(10);
    expect(report.winsWithoutIdioms).toBe(10);
    expect(report.winsWithIdioms).toBe(10);
    expect(report.winRateWithoutIdiomsPct).toBe(100);
    expect(report.winRateWithIdiomsPct).toBe(100);
    expect(report.zeroAilFilesLeftOnDisk).toBe(true);
    expect(report.coveredLanguages).toHaveLength(15);
    expect(report.coveredExtensions).toHaveLength(15);
    expect(report.coveredScenarios).toHaveLength(5);
    expect(report.coveredSurfaces).toHaveLength(2);

    // Aggregate operations must win both without idioms and with idioms
    for (const op of [
      report.aggregateWrite,
      report.aggregateRead,
      report.aggregateUpdate,
      report.aggregateDelete,
      report.aggregateRefactor,
      report.aggregateTotal,
    ]) {
      expect(op.ailWithoutIdiomsWins).toBe(true);
      expect(op.ailWithIdiomsWins).toBe(true);
      expect(op.ailWithoutIdiomsTokens).toBeLessThan(op.withoutAilTokens);
      expect(op.ailWithIdiomsTokens).toBeLessThanOrEqual(op.ailWithoutIdiomsTokens);
      expect(op.withoutAilTurns).toBeGreaterThan(0);
      expect(op.ailWithoutIdiomsTurns).toBeGreaterThan(0);
      expect(op.ailWithIdiomsTurns).toBeGreaterThan(0);
      expect(op.ailWithoutIdiomsTurns).toBeLessThanOrEqual(op.withoutAilTurns);
      expect(op.ailWithIdiomsTurns).toBeLessThanOrEqual(op.ailWithoutIdiomsTurns);
    }

    expect(report.aggregateTotal.ailWithoutIdiomsTurns).toBeLessThan(
      report.aggregateTotal.withoutAilTurns,
    );
    expect(report.aggregateTotal.ailWithIdiomsTurns).toBeLessThan(
      report.aggregateTotal.ailWithoutIdiomsTurns,
    );
    expect(report.aggregateTotal.turnsSavingsWithoutIdiomsPct).toBeGreaterThan(0);
    expect(report.aggregateTotal.turnsSavingsWithIdiomsPct).toBeGreaterThan(
      report.aggregateTotal.turnsSavingsWithoutIdiomsPct,
    );

    // Verify each of the 10 real-world benchmarks
    for (const b of report.benchmarks) {
      expect(b.ailWinsAllWithoutIdioms).toBe(true);
      expect(b.ailWinsAllWithIdioms).toBe(true);
      expect(b.zeroAilFilesLeftOnDisk).toBe(true);
      expect(b.idiomDefinitionsTokens).toBeGreaterThan(0);

      // Verify turn metrics per benchmark
      expect(b.total.withoutAilTurns).toBeGreaterThan(0);
      expect(b.total.ailWithoutIdiomsTurns).toBeLessThan(b.total.withoutAilTurns);
      expect(b.total.ailWithIdiomsTurns).toBeLessThanOrEqual(b.total.ailWithoutIdiomsTurns);
      expect(b.total.turnsSavingsWithoutIdiomsPct).toBeGreaterThan(0);
      expect(b.total.turnsSavingsWithIdiomsPct).toBeGreaterThanOrEqual(
        b.total.turnsSavingsWithoutIdiomsPct,
      );

      // Write from 0 must charge idiom definition overhead and still beat pure AIL and Native
      const rawIdiomFilesSum = b.files.reduce((acc, f) => acc + f.ailWithIdiomsTokens, 0);
      expect(b.writeFromZero.ailWithIdiomsTokens).toBe(
        rawIdiomFilesSum + b.idiomDefinitionsTokens,
      );
      expect(b.writeFromZero.ailWithIdiomsTokens).toBeLessThan(
        b.writeFromZero.ailWithoutIdiomsTokens,
      );
      expect(b.writeFromZero.ailWithoutIdiomsTokens).toBeLessThan(
        b.writeFromZero.withoutAilTokens,
      );

      // Every individual file in the benchmark must compress both without idioms and with idioms
      for (const f of b.files) {
        expect(f.ailWithoutIdiomsTokens).toBeLessThan(f.withoutAilTokens);
        expect(f.ailWithIdiomsTokens).toBeLessThan(f.ailWithoutIdiomsTokens);
      }
    }

    // Verify docs/BENCHMARKS.md is up to date
    const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
    expect(fs.existsSync(docsPath)).toBe(true);
    const md = fs.readFileSync(docsPath, "utf-8");
    expect(md).toContain("10 Scenarios — Without & With Idioms");
    expect(md).toContain("RW-01");
    expect(md).toContain("RW-10");
    expect(md).toContain("Total Lifecycle Turns");
    expect(md).toContain("Agent Turns Breakdown");
  }, 60000);

  it("supports nested CSS @media rules, pseudo-selectors (.btn:hover), layout macros, and idiom transforms", async () => {
    const { parse } = await import("../../src/core/parser.js");
    const { emitTarget } = await import("../../src/emitters/index.js");
    const { decompile } = await import("../../src/decompiler/index.js");
    const { collapseModuleIdioms, expandModuleIdioms } = await import("../../src/idioms/index.js");

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
    expect(emittedCss).toContain("padding: 12px;");
    expect(emittedCss).not.toContain('padding: "12px"');
    expect(emittedCss).toContain("border-radius: 8px;");

    const decompiled = decompile(emittedCss, "css", { filePath: "responsive.css" });
    const collapsed = collapseModuleIdioms(decompiled.ast, idioms);
    expect(collapsed.collapsedCount).toBe(2);
  });

  it("compiles .tsx benchmark files from real AIL component declarations into JSX and uses domain-specific idioms", () => {
    const tsxFiles = REAL_WORLD_BENCHMARKS.flatMap((b) =>
      b.files.filter((f) => f.languageId === "tsx"),
    );
    expect(tsxFiles.length).toBeGreaterThanOrEqual(3);
    for (const tsxSpec of tsxFiles) {
      expect(tsxSpec.ailWithIdioms).toContain("component ");
      expect(tsxSpec.ailWithIdioms).toContain("$tsx_kpi_tile(");
    }

    const distinctIdioms = new Set(SUPPORTED_BENCHMARK_LANGUAGES.map((l) => l.idiomName));
    expect(distinctIdioms.size).toBe(15);
  });
});
