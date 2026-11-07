/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildIdiomRegistryForLanguage,
  formatOfflineBenchmarkMarkdown,
  formatRealAgentBenchmarkMarkdown,
  loadRealAgentBenchmarkSuiteReport,
  OFFLINE_BENCHMARKS,
  REAL_WORLD_BENCHMARKS,
  runOfflineBenchmarkSuite,
  runRealWorldBenchmarkSuite,
  SUPPORTED_BENCHMARK_LANGUAGES,
} from "../../benchmarks/index.js";

describe("AIL 2.0 Real-World Benchmark Suites (Offline Deterministic + Real AI Agents)", () => {
  it("evaluates the Deterministic Offline Benchmark Suite across all 10 scenarios, 15 file types, and CRUD+Refactor operations (docs/BENCHMARKS_OFFLINE.md)", () => {
    expect(SUPPORTED_BENCHMARK_LANGUAGES).toHaveLength(15);
    expect(OFFLINE_BENCHMARKS).toHaveLength(10);
    expect(REAL_WORLD_BENCHMARKS).toBe(OFFLINE_BENCHMARKS);

    const report = runOfflineBenchmarkSuite();
    expect(runRealWorldBenchmarkSuite).toBe(runOfflineBenchmarkSuite);
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

    // Verify each of the 10 offline benchmarks
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

    // Verify docs/BENCHMARKS_OFFLINE.md is up to date
    const offlineDocsPath = path.resolve(process.cwd(), "docs/BENCHMARKS_OFFLINE.md");
    expect(fs.existsSync(offlineDocsPath)).toBe(true);
    const offlineMd = fs.readFileSync(offlineDocsPath, "utf-8");
    expect(offlineMd).toContain("Deterministic Offline Benchmark Report");
    expect(offlineMd).toContain("RW-01");
    expect(offlineMd).toContain("RW-10");
    expect(offlineMd).toContain("Total Lifecycle Turns");
    expect(offlineMd).toContain("Agent Turns Breakdown");
    expect(formatOfflineBenchmarkMarkdown(report)).toContain("Deterministic Offline Benchmark Report");
  }, 60000);

  it("verifies the Real AI Agent Benchmark Suite across all 30 live agent transcripts (10 scenarios x 3 modes) in docs/BENCHMARKS.md", () => {
    const realReport = loadRealAgentBenchmarkSuiteReport();
    expect(realReport.suiteVersion).toBe("2.0.0-real-agent");
    expect(realReport.totalBenchmarks).toBe(10);
    expect(realReport.coveredLanguages).toHaveLength(15);
    expect(realReport.winsWithoutIdioms).toBe(10);
    expect(realReport.winsWithIdioms).toBe(10);
    expect(realReport.allVerifiedOnDisk).toBe(true);
    expect(realReport.zeroAilFilesLeftOnDisk).toBe(true);

    const seenConversationIds = new Set<string>();
    for (const b of realReport.benchmarks) {
      expect(b.ailWithoutIdiomsWins).toBe(true);
      expect(b.ailWithIdiomsWins).toBe(true);
      expect(b.idiomsBeatNoIdioms).toBe(true);

      for (const m of [b.withoutAil, b.ailWithoutIdioms, b.ailWithIdioms]) {
        expect(m.conversationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        seenConversationIds.add(m.conversationId);
        expect(m.verifiedOnDisk).toBe(true);
        expect(m.zeroAilFilesLeftOnDisk).toBe(true);
      }

      // Strict ordering: withoutAil > ailWithoutIdioms > ailWithIdioms
      expect(b.ailWithoutIdioms.llmTurns).toBeLessThan(b.withoutAil.llmTurns);
      expect(b.ailWithIdioms.llmTurns).toBeLessThan(b.ailWithoutIdioms.llmTurns);

      expect(b.ailWithoutIdioms.toolCalls).toBeLessThan(b.withoutAil.toolCalls);
      expect(b.ailWithIdioms.toolCalls).toBeLessThan(b.ailWithoutIdioms.toolCalls);

      expect(b.ailWithoutIdioms.workingTokens).toBeLessThan(b.withoutAil.workingTokens);
      expect(b.ailWithIdioms.workingTokens).toBeLessThan(b.ailWithoutIdioms.workingTokens);

      expect(b.ailWithoutIdioms.outputTokens).toBeLessThan(b.withoutAil.outputTokens);
      expect(b.ailWithIdioms.outputTokens).toBeLessThan(b.ailWithoutIdioms.outputTokens);

      expect(b.ailWithoutIdioms.billableTokens).toBeLessThan(b.withoutAil.billableTokens);
      expect(b.ailWithIdioms.billableTokens).toBeLessThan(b.ailWithoutIdioms.billableTokens);

      expect(b.ailWithoutIdioms.apiTotalTokens).toBeLessThan(b.withoutAil.apiTotalTokens);
      expect(b.ailWithIdioms.apiTotalTokens).toBeLessThan(b.ailWithoutIdioms.apiTotalTokens);
    }

    // All 30 runs must have distinct UUIDs
    expect(seenConversationIds.size).toBe(30);

    // Check docs/BENCHMARKS.md
    const realDocsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
    expect(fs.existsSync(realDocsPath)).toBe(true);
    const realMd = fs.readFileSync(realDocsPath, "utf-8");
    expect(realMd).toContain("Real AI Agent Benchmark Suite Report");
    expect(realMd).toContain("BENCHMARKS_OFFLINE.md");
    expect(realMd).toContain("Ground-Truth Conversation ID Audit Trail");
    expect(formatRealAgentBenchmarkMarkdown(realReport)).toContain(
      "Real AI Agent Benchmark Suite Report",
    );
  });

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
    const tsxFiles = OFFLINE_BENCHMARKS.flatMap((b) =>
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

  it("decompiles Kotlin and PHP assignments into AssignStmt so $guard_band_step idioms collapse cleanly", async () => {
    const { decompile } = await import("../../src/decompiler/index.js");
    const { collapseModuleIdioms } = await import("../../src/idioms/index.js");
    const { idioms } = buildIdiomRegistryForLanguage("ts");

    const ktCode = [
      "fun scorePrimarySignal(rawScore: Int, floorVal: Int, ceilVal: Int, step: Int): Int {",
      "  var nextScore = rawScore",
      "  if (nextScore < floorVal) { nextScore = floorVal }",
      "  if (nextScore > ceilVal) { nextScore = ceilVal }",
      "  nextScore = nextScore + step",
      "  return nextScore",
      "}",
    ].join("\n");
    const ktDecomp = decompile(ktCode, "kotlin", { filePath: "fraud_scorer.kt" });
    const ktCollapsed = collapseModuleIdioms(ktDecomp.ast, idioms);
    expect(ktCollapsed.collapsedCount).toBe(1);

    const phpCode = [
      "<?php",
      "function computeCartTotals($subtotalCents, $minCents, $maxCents, $stepCents) {",
      "  $nextTotal = $subtotalCents;",
      "  if ($nextTotal < $minCents) { $nextTotal = $minCents; }",
      "  if ($nextTotal > $maxCents) { $nextTotal = $maxCents; }",
      "  $nextTotal = $nextTotal + $stepCents;",
      "  return $nextTotal;",
      "}",
    ].join("\n");
    const phpDecomp = decompile(phpCode, "php", { filePath: "cart_pricing.php" });
    const phpCollapsed = collapseModuleIdioms(phpDecomp.ast, idioms);
    expect(phpCollapsed.collapsedCount).toBe(1);
  });
});
