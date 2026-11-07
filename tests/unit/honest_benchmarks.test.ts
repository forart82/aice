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

describe("AICE 2.0 Real-World Benchmark Suites (Offline Deterministic + Real AI Agents)", () => {
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
    expect(report.zeroAiceFilesLeftOnDisk).toBe(true);
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
      expect(op.aiceWithoutIdiomsWins).toBe(true);
      expect(op.aiceWithIdiomsWins).toBe(true);
      expect(op.aiceWithoutIdiomsTokens).toBeLessThan(op.withoutAiceTokens);
      expect(op.aiceWithIdiomsTokens).toBeLessThanOrEqual(op.aiceWithoutIdiomsTokens);
      expect(op.withoutAiceTurns).toBeGreaterThan(0);
      expect(op.aiceWithoutIdiomsTurns).toBeGreaterThan(0);
      expect(op.aiceWithIdiomsTurns).toBeGreaterThan(0);
      expect(op.aiceWithoutIdiomsTurns).toBeLessThanOrEqual(op.withoutAiceTurns);
      expect(op.aiceWithIdiomsTurns).toBeLessThanOrEqual(op.aiceWithoutIdiomsTurns);
    }

    expect(report.aggregateTotal.aiceWithoutIdiomsTurns).toBeLessThan(
      report.aggregateTotal.withoutAiceTurns,
    );
    expect(report.aggregateTotal.aiceWithIdiomsTurns).toBeLessThan(
      report.aggregateTotal.aiceWithoutIdiomsTurns,
    );
    expect(report.aggregateTotal.turnsSavingsWithoutIdiomsPct).toBeGreaterThan(0);
    expect(report.aggregateTotal.turnsSavingsWithIdiomsPct).toBeGreaterThan(
      report.aggregateTotal.turnsSavingsWithoutIdiomsPct,
    );

    // Verify each of the 10 offline benchmarks
    for (const b of report.benchmarks) {
      expect(b.aiceWinsAllWithoutIdioms).toBe(true);
      expect(b.aiceWinsAllWithIdioms).toBe(true);
      expect(b.zeroAiceFilesLeftOnDisk).toBe(true);
      expect(b.idiomDefinitionsTokens).toBeGreaterThan(0);

      // Verify turn metrics per benchmark
      expect(b.total.withoutAiceTurns).toBeGreaterThan(0);
      expect(b.total.aiceWithoutIdiomsTurns).toBeLessThan(b.total.withoutAiceTurns);
      expect(b.total.aiceWithIdiomsTurns).toBeLessThanOrEqual(b.total.aiceWithoutIdiomsTurns);
      expect(b.total.turnsSavingsWithoutIdiomsPct).toBeGreaterThan(0);
      expect(b.total.turnsSavingsWithIdiomsPct).toBeGreaterThanOrEqual(
        b.total.turnsSavingsWithoutIdiomsPct,
      );

      // Write from 0 must charge idiom definition overhead and still beat pure AICE and Native
      const rawIdiomFilesSum = b.files.reduce((acc, f) => acc + f.aiceWithIdiomsTokens, 0);
      expect(b.writeFromZero.aiceWithIdiomsTokens).toBe(
        rawIdiomFilesSum + b.idiomDefinitionsTokens,
      );
      expect(b.writeFromZero.aiceWithIdiomsTokens).toBeLessThan(
        b.writeFromZero.aiceWithoutIdiomsTokens,
      );
      expect(b.writeFromZero.aiceWithoutIdiomsTokens).toBeLessThan(
        b.writeFromZero.withoutAiceTokens,
      );

      // Every individual file in the benchmark must compress both without idioms and with idioms
      for (const f of b.files) {
        expect(f.aiceWithoutIdiomsTokens).toBeLessThan(f.withoutAiceTokens);
        expect(f.aiceWithIdiomsTokens).toBeLessThan(f.aiceWithoutIdiomsTokens);
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
    expect(realReport.zeroAiceFilesLeftOnDisk).toBe(true);

    const seenConversationIds = new Set<string>();
    for (const b of realReport.benchmarks) {
      expect(b.aiceWithoutIdiomsWins).toBe(true);
      expect(b.aiceWithIdiomsWins).toBe(true);
      expect(b.idiomsBeatNoIdioms).toBe(true);

      for (const m of [b.withoutAice, b.aiceWithoutIdioms, b.aiceWithIdioms]) {
        expect(m.conversationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        seenConversationIds.add(m.conversationId);
        expect(m.verifiedOnDisk).toBe(true);
        expect(m.zeroAiceFilesLeftOnDisk).toBe(true);
      }

      // Strict ordering: withoutAice > aiceWithoutIdioms > aiceWithIdioms
      expect(b.aiceWithoutIdioms.llmTurns).toBeLessThan(b.withoutAice.llmTurns);
      expect(b.aiceWithIdioms.llmTurns).toBeLessThan(b.aiceWithoutIdioms.llmTurns);

      expect(b.aiceWithoutIdioms.toolCalls).toBeLessThan(b.withoutAice.toolCalls);
      expect(b.aiceWithIdioms.toolCalls).toBeLessThan(b.aiceWithoutIdioms.toolCalls);

      expect(b.aiceWithoutIdioms.workingTokens).toBeLessThan(b.withoutAice.workingTokens);
      expect(b.aiceWithIdioms.workingTokens).toBeLessThan(b.aiceWithoutIdioms.workingTokens);

      expect(b.aiceWithoutIdioms.outputTokens).toBeLessThan(b.withoutAice.outputTokens);
      expect(b.aiceWithIdioms.outputTokens).toBeLessThan(b.aiceWithoutIdioms.outputTokens);

      expect(b.aiceWithoutIdioms.billableTokens).toBeLessThan(b.withoutAice.billableTokens);
      expect(b.aiceWithIdioms.billableTokens).toBeLessThan(b.aiceWithoutIdioms.billableTokens);

      expect(b.aiceWithoutIdioms.apiTotalTokens).toBeLessThan(b.withoutAice.apiTotalTokens);
      expect(b.aiceWithIdioms.apiTotalTokens).toBeLessThan(b.aiceWithoutIdioms.apiTotalTokens);
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
    const aiceCss = [
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

    const mod = parse(aiceCss, "responsive.aice");
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

  it("compiles .tsx benchmark files from real AICE component declarations into JSX and uses domain-specific idioms", () => {
    const tsxFiles = OFFLINE_BENCHMARKS.flatMap((b) =>
      b.files.filter((f) => f.languageId === "tsx"),
    );
    expect(tsxFiles.length).toBeGreaterThanOrEqual(3);
    for (const tsxSpec of tsxFiles) {
      expect(tsxSpec.aiceWithIdioms).toContain("component ");
      expect(tsxSpec.aiceWithIdioms).toContain("$tsx_kpi_tile(");
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

  it("splices C++ and C# native files and applies updateProjectIdiom without duplicate #pragma once/namespace wrappers or static signature corruption", async () => {
    const os = await import("node:os");
    const { parse } = await import("../../src/core/parser.js");
    const { emitTarget } = await import("../../src/emitters/index.js");
    const { expandModuleIdioms, updateProjectIdiom } = await import("../../src/idioms/index.js");
    const { splice } = await import("../../src/tools/splice.js");

    const spec = OFFLINE_BENCHMARKS.find((s) => s.id === "RW-10")!;
    const cppFile = spec.files.find((f) => f.languageId === "cpp")!;
    const csFile = spec.files.find((f) => f.languageId === "cs")!;
    const idioms = {
      ...buildIdiomRegistryForLanguage("ts").idioms,
      ...buildIdiomRegistryForLanguage("cpp").idioms,
      ...buildIdiomRegistryForLanguage("cs").idioms,
    };

    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-cpp-cs-splice-test-"));
    try {
      const cppNative = emitTarget(
        expandModuleIdioms(parse(cppFile.aiceWithIdioms, `${cppFile.fileName}.aice`), idioms),
        "cpp",
        { watermark: false },
      );
      const csNative = emitTarget(
        expandModuleIdioms(parse(csFile.aiceWithIdioms, `${csFile.fileName}.aice`), idioms),
        "csharp",
        { watermark: false },
      );
      fs.writeFileSync(path.join(tmpDir, cppFile.fileName), cppNative, "utf-8");
      fs.writeFileSync(path.join(tmpDir, csFile.fileName), csNative, "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify({ version: 2, idioms }, null, 2),
      );

      await splice(path.join(tmpDir, cppFile.fileName), {
        symbol: cppFile.targetSymbol,
        code: cppFile.updatedTargetSymbolAiceWithIdioms.replace(
          /\$[a-z_]+_band_step|\$solve_axis_impulse/g,
          "$guard_band_step",
        ),
        idioms: true,
      });
      await splice(path.join(tmpDir, csFile.fileName), {
        symbol: csFile.targetSymbol,
        code: csFile.updatedTargetSymbolAiceWithIdioms.replace(
          /\$[a-z_]+_band_step|\$settle_ledger_window/g,
          "$guard_band_step",
        ),
        idioms: true,
      });

      const upd = await updateProjectIdiom(
        tmpDir,
        "$guard_band_step",
        "if $0 < $1:\n  $0 = $1\nif $0 > $2:\n  $0 = $2\n$0 = $0 + $3 + 1",
      );
      expect(upd.modifiedFiles.map((f) => path.basename(f)).sort()).toEqual([
        csFile.fileName,
        cppFile.fileName,
      ]);

      const finalCpp = fs.readFileSync(path.join(tmpDir, cppFile.fileName), "utf-8");
      expect((finalCpp.match(/#pragma once/g) || []).length).toBe(1);
      expect(finalCpp).not.toContain("namespace ::");
      expect((finalCpp.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length).toBeGreaterThanOrEqual(
        cppFile.refactorSymbols.length * 3,
      );

      const finalCs = fs.readFileSync(path.join(tmpDir, csFile.fileName), "utf-8");
      expect(finalCs).not.toMatch(/public\s+static\s+\w+\s+public\s+/);
      expect((finalCs.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length).toBeGreaterThanOrEqual(
        csFile.refactorSymbols.length * 3,
      );
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});

