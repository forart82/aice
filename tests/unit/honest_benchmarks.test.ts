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
    expect(formatOfflineBenchmarkMarkdown(report)).toContain(
      "Deterministic Offline Benchmark Report",
    );
  }, 60000);

  it("verifies the Real AI Agent Benchmark Suite across all 30 live agent transcripts (10 scenarios x 3 modes) in docs/BENCHMARKS.md", () => {
    const realReport = loadRealAgentBenchmarkSuiteReport();
    expect(realReport.suiteVersion).toBe("2.0.0-real-agent");
    expect(realReport.totalBenchmarks).toBe(10);
    expect(realReport.coveredLanguages).toHaveLength(15);
    expect(realReport.allColdStartRepos).toBe(true);
    expect(realReport.zeroAiceFilesLeftOnDisk).toBe(true);
    expect(realReport.allColdStartRepos).toBe(true);
    expect(realReport.allBlindPrompts).toBe(true);
    expect(realReport.allDecoysIntact).toBe(true);

    const seenConversationIds = new Set<string>();
    for (const b of realReport.benchmarks) {
      for (const m of [b.withoutAice, b.aiceWithoutIdioms, b.aiceWithIdioms]) {
        expect(m.conversationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        seenConversationIds.add(m.conversationId);
        expect(m.zeroAiceFilesLeftOnDisk).toBe(true);
        expect(m.coldStartRepo).toBe(true);
        expect(m.blindPrompt).toBe(true);
        expect(m.decoysIntact).toBe(true);
        expect(m.decoysInjected).toBeGreaterThanOrEqual(1);
        expect(m.apiCostUsd).toBeGreaterThan(0);
      }

      // Both AICE modes achieve 100% verification on disk across all 3 progressive layers
      expect(b.aiceWithoutIdioms.verifiedOnDisk).toBe(true);
      expect(b.aiceWithIdioms.verifiedOnDisk).toBe(true);
    }

    // Strict aggregate ordering: AICE achieves lower turns, working tokens, output tokens, and API cost
    expect(realReport.totals.aiceWithoutIdiomsTurns).toBeLessThan(
      realReport.totals.withoutAiceTurns,
    );
    expect(realReport.totals.aiceWithoutIdiomsWorkingTokens).toBeLessThan(
      realReport.totals.withoutAiceWorkingTokens,
    );
    expect(realReport.totals.aiceWithIdiomsWorkingTokens).toBeLessThan(
      realReport.totals.withoutAiceWorkingTokens,
    );
    expect(realReport.totals.aiceWithoutIdiomsOutputTokens).toBeLessThan(
      realReport.totals.withoutAiceOutputTokens,
    );
    expect(realReport.totals.aiceWithIdiomsOutputTokens).toBeLessThan(
      realReport.totals.aiceWithoutIdiomsOutputTokens,
    );
    expect(realReport.totals.aiceWithoutIdiomsApiCostUsd).toBeLessThan(
      realReport.totals.withoutAiceApiCostUsd,
    );

    if (realReport.loneNeedleBenchmark) {
      for (const m of [
        realReport.loneNeedleBenchmark.withoutAice,
        realReport.loneNeedleBenchmark.aiceWithoutIdioms,
        realReport.loneNeedleBenchmark.aiceWithIdioms,
      ]) {
        expect(m.conversationId).toMatch(
          /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/,
        );
        seenConversationIds.add(m.conversationId);
      }
    }

    // All 33 runs (11 scenarios x 3 modes) must have distinct UUIDs
    expect(seenConversationIds.size).toBe(33);

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

  it("enforces adversarial cold-start workspaces (zero pre-baked idioms), non-first seeded targets, blind prompts, RW-11 1-file 0-idiom Lone Needle, procedural decoy sentinels, and cold-start idiom discovery across all 15 languages", async () => {
    const {
      ALL_REAL_AGENT_BENCHMARKS,
      buildTaskSpecText,
      computeFileDecoySpec,
      computeSeededFileMutation,
      HOSTILE_LONE_NEEDLE_SPEC,
      setupWorkspace,
      verifyWorkspaceOnDisk,
    } = await import("../../benchmarks/run-real-agents.js");
    const { generateContext } = await import("../../src/tools/context.js");
    const { scanProjectIdioms } = await import("../../src/idioms/index.js");

    // 1. Every scenario prompt is 100% blind (never leaks any symbol name, never uses "first " or "@first")
    //    and selects a non-first target index (targetIdx >= 1) in every multi-symbol file.
    for (const seed of [1001, 20261108, 99222165]) {
      for (const spec of ALL_REAL_AGENT_BENCHMARKS) {
        const prompt = buildTaskSpecText(spec, seed);
        expect(prompt.toLowerCase()).not.toContain("first ");
        expect(prompt).not.toContain("@first");
        for (const f of spec.files) {
          const mut = computeSeededFileMutation(seed, spec.id, f, spec.scenario === "new_feature");
          if (f.refactorSymbols.length > 1) {
            expect(mut.targetIdx).toBeGreaterThanOrEqual(1);
          }
          expect(prompt).not.toContain(f.targetSymbol);
          expect(prompt).not.toContain(mut.targetSymbol);
          if (f.obsoleteSymbol) {
            expect(prompt).not.toContain(f.obsoleteSymbol);
          }
        }
      }
    }

    // 2. RW-11 (Lone Needle) is a 1-file, 0-idiom scenario covering targetIdx 1..11 where AICE still beats Without AICE
    expect(HOSTILE_LONE_NEEDLE_SPEC.files).toHaveLength(1);
    const seenRw11Indices = new Set<number>();
    for (let s = 1; s <= 150; s++) {
      const mut11 = computeSeededFileMutation(s, "RW-11", HOSTILE_LONE_NEEDLE_SPEC.files[0], false);
      expect(mut11.targetIdx).toBeGreaterThanOrEqual(1);
      expect(mut11.targetIdx).toBeLessThanOrEqual(11);
      seenRw11Indices.add(mut11.targetIdx);
    }
    expect(seenRw11Indices.size).toBe(11);
    const dir11 = setupWorkspace(HOSTILE_LONE_NEEDLE_SPEC, "aice_with_idioms", 99222165);
    try {
      const scanned11 = await scanProjectIdioms(dir11);
      expect(Object.keys(scanned11.idioms)).toHaveLength(0);
    } finally {
      fs.rmSync(dir11, { recursive: true, force: true });
    }
    const realReport = loadRealAgentBenchmarkSuiteReport();
    expect(realReport.loneNeedleBenchmark).toBeDefined();
    if (realReport.loneNeedleBenchmark) {
      const ln = realReport.loneNeedleBenchmark;
      expect(ln.filesCount).toBe(1);
      expect(ln.aiceWithoutIdioms.verifiedOnDisk).toBe(true);
      expect(ln.aiceWithIdioms.verifiedOnDisk).toBe(true);
      expect(ln.withoutAice.verifiedOnDisk).toBe(true);
      expect(ln.aiceWithoutIdioms.verifiedOnDisk).toBe(true);
      expect(ln.aiceWithIdioms.verifiedOnDisk).toBe(true);
    }

    // 3. Procedural seed produces distinct decoy sentinel names & step constants
    const d1 = computeFileDecoySpec(1001, "RW-01", "engine.ts");
    const d2 = computeFileDecoySpec(2002, "RW-01", "engine.ts");
    expect(d1.fnName).not.toBe(d2.fnName);
    expect(d1.decoyStep).not.toBe(d2.decoyStep);

    // 4. Cold-start workspace setup on RW-10 (all 15 languages) has zero aice.config.json
    const rw10 = OFFLINE_BENCHMARKS.find((s) => s.id === "RW-10")!;
    const dir = setupWorkspace(rw10, "aice_with_idioms", 424242);
    try {
      expect(fs.existsSync(path.join(dir, "aice.config.json"))).toBe(false);
      expect(fs.existsSync(path.join(dir, ".aice-idioms.json"))).toBe(false);
      expect(fs.readdirSync(dir).filter((f) => f.endsWith(".aice"))).toHaveLength(0);

      // 5. Cold-start generateContext with --idioms and -s "*" discovers & persists all 7 idiom families
      const ctx = await generateContext(dir, { symbol: "*", idioms: true });
      expect(fs.existsSync(path.join(dir, "aice.config.json"))).toBe(true);
      const savedCfg = JSON.parse(fs.readFileSync(path.join(dir, "aice.config.json"), "utf-8"));
      expect(Object.keys(savedCfg.idioms).sort()).toEqual([
        "$css_card",
        "$guard",
        "$html_metric_row",
        "$rec_id",
        "$rec_worker",
        "$tsx_kpi_tile",
        "$twig_summary_line",
      ]);
      expect(ctx.formattedBundle).toContain("### Active Project Idioms");

      // 6. Naive regex that blindly appends "+ 1" corrupts the decoy sentinel and fails verifyWorkspaceOnDisk
      const tsFile = rw10.files.find((f) => f.languageId === "ts")!;
      const tsPath = path.join(dir, tsFile.fileName);
      const tsDecoy = computeFileDecoySpec(424242, "RW-10", tsFile.fileName);
      const rawTs = fs.readFileSync(tsPath, "utf-8");
      expect(rawTs).toContain(tsDecoy.fnName);
      fs.writeFileSync(
        tsPath,
        rawTs.replace(`+ ${tsDecoy.decoyStep}`, `+ ${tsDecoy.decoyStep} + 1`),
        "utf-8",
      );
      const check = verifyWorkspaceOnDisk(rw10, dir, 424242);
      expect(check.decoysIntact).toBe(false);
      expect(check.verified).toBe(false);

      // 7. verifyCompilerAndSyntaxOnFile catches syntax corruption across tsx, cs, kt, go, html, twig, yaml
      const { verifyCompilerAndSyntaxOnFile } = await import("../../benchmarks/run-real-agents.js");
      const badCases: Array<[string, string, string]> = [
        ["bad.tsx", "tsx", "export function Bad() { return <div><span>unclosed</div>; }"],
        ["Bad.cs", "cs", "public class Bad { public static int F(int x) { return x + ; } }"],
        ["bad.kt", "kt", "fun bad(x: Int): Int {\n  return x +\n}"],
        ["bad.html", "html", '<main><section id="a"><div>unclosed</main>'],
        ["bad.twig", "twig", '{% block a %}<div class="summary-row">unclosed{% endblock %}'],
        ["bad.yaml", "yaml", "config:\n  broken: [\n    unclosed: { a: 1\n"],
      ];
      for (const [fname, langId, badSrc] of badCases) {
        const p = path.join(dir, fname);
        fs.writeFileSync(p, badSrc, "utf-8");
        expect(verifyCompilerAndSyntaxOnFile(p, langId as any, dir)).not.toBeNull();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }

    // 8. Verify README.md C++20 walkthrough ($clampBand + $fmtMetric) end-to-end with g++ -std=c++20 -fsyntax-only
    const os = await import("node:os");
    const { splice } = await import("../../src/tools/splice.js");
    const { verifyCompilerAndSyntaxOnFile } = await import("../../benchmarks/run-real-agents.js");
    const cppWalkDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-readme-cpp-"));
    try {
      fs.writeFileSync(
        path.join(cppWalkDir, "aice.config.json"),
        JSON.stringify(
          {
            idiomsEnabled: true,
            idioms: {
              $clampBand: {
                name: "$clampBand",
                kind: "stmt",
                params: [{ name: "$0" }, { name: "$1" }, { name: "$2" }],
                templateAice: "if $0 < $1:\n  $0 = $1\nif $0 > $2:\n  $0 = $2",
              },
              $fmtMetric: {
                name: "$fmtMetric",
                kind: "expr",
                params: [{ name: "$0" }, { name: "$1" }],
                templateAice: 'std.string($0 + "=") + std.to_string($1)',
              },
            },
          },
          null,
          2,
        ),
        "utf-8",
      );
      const cppFile = path.join(cppWalkDir, "telemetry_report.cpp");
      fs.writeFileSync(
        cppFile,
        [
          "#include <string>",
          "",
          "std::string buildNodeReport(int cpu, int mem, int jit) {",
          "    if (cpu < 0) { cpu = 0; }",
          "    if (cpu > 100) { cpu = 100; }",
          "    if (mem < 128) { mem = 128; }",
          "    if (mem > 65536) { mem = 65536; }",
          "",
          '    const auto header = std::string("[Hello World]");',
          '    const auto lineCpu = std::string("cpu=") + std::to_string(cpu);',
          "",
          '    return header + " " + lineCpu;',
          "}",
        ].join("\n"),
        "utf-8",
      );
      const readmeCtx = await generateContext(cppFile, {
        symbol: "buildNodeReport",
        idioms: true,
        includeCallers: false,
      });
      expect(readmeCtx.targetContent).toContain("$clampBand(cpu, 0, 100)");
      expect(readmeCtx.targetContent).toContain("$clampBand(mem, 128, 65536)");
      expect(readmeCtx.targetContent).toContain('header := "[Hello World]"');
      expect(readmeCtx.targetContent).toContain('lineCpu := $fmtMetric("cpu", cpu)');

      await splice(cppFile, {
        symbol: "buildNodeReport",
        idioms: true,
        code: [
          "pub fn buildNodeReport(cpu:int, mem:int, jit:int) -> str:",
          "  $clampBand(cpu, 0, 100)",
          "  $clampBand(mem, 128, 65536)",
          "  $clampBand(jit, 5, 250)",
          "",
          '  header := "[Hello Peter]"',
          '  lineCpu := $fmtMetric("cpu", cpu)',
          '  lineJit := $fmtMetric("jit", jit)',
          '  ret header + " " + lineCpu + " " + lineJit',
        ].join("\n"),
      });
      const splicedCpp = fs.readFileSync(cppFile, "utf-8");
      expect(splicedCpp).toContain('std::string("[Hello Peter]")');
      expect(splicedCpp).toContain('std::string("cpu=") + std::to_string(cpu)');
      expect(splicedCpp).toContain('std::string("jit=") + std::to_string(jit)');
      expect(verifyCompilerAndSyntaxOnFile(cppFile, "cpp", cppWalkDir)).toBeNull();
    } finally {
      fs.rmSync(cppWalkDir, { recursive: true, force: true });
    }
  });

  it("handles @first/@1 on deeply nested namespaces and abstract base classes, single-file cold-start --idioms, and nested layout containers", async () => {
    const os = await import("node:os");
    const { generateContext } = await import("../../src/tools/context.js");
    const { splice } = await import("../../src/tools/splice.js");
    const { scanProjectIdioms } = await import("../../src/idioms/index.js");

    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-nested-first-"));
    try {
      const tsPath = path.join(dir, "telemetry_nested.ts");
      fs.writeFileSync(
        tsPath,
        [
          "export namespace Cloud {",
          "  export namespace Telemetry {",
          "    export interface SpanConfig {",
          "      id: number;",
          "    }",
          "    export abstract class AbstractBaseProbe {",
          "      abstract sample(value: number): number;",
          "      abstract flush(): void;",
          "    }",
          "    export function routeSpanBatch(value: number): number {",
          "      if (value < 0) {",
          "        return 0;",
          "      }",
          "      const scaled = value * 2;",
          "      const bounded = scaled + 10;",
          "      return bounded;",
          "    }",
          "    export function auditSpanBatch(value: number): number {",
          "      if (value < 0) {",
          "        return 0;",
          "      }",
          "      const scaled = value * 2;",
          "      const bounded = scaled + 20;",
          "      return bounded;",
          "    }",
          "    export function flushSpanBatch(value: number): number {",
          "      if (value < 0) {",
          "        return 0;",
          "      }",
          "      const scaled = value * 2;",
          "      const bounded = scaled + 30;",
          "      return bounded;",
          "    }",
          "  }",
          "}",
        ].join("\n"),
        "utf-8",
      );

      // 1. Single-file generateContext with --idioms on a cold-start repo auto-discovers & saves idioms
      //    and @first skips SpanConfig + AbstractBaseProbe to select routeSpanBatch
      const singleFileCtx = await generateContext(tsPath, { symbol: "@first", idioms: true });
      expect(fs.existsSync(path.join(dir, "aice.config.json"))).toBe(true);
      expect(singleFileCtx.formattedBundle).toContain("routeSpanBatch");
      expect(singleFileCtx.formattedBundle).not.toContain("AbstractBaseProbe");
      expect(singleFileCtx.formattedBundle).toContain("$guard");

      // 2. Workspace generateContext with @first also skips AbstractBaseProbe and selects routeSpanBatch
      const wsCtx = await generateContext(dir, { symbol: "@first", idioms: true });
      expect(wsCtx.formattedBundle).toContain("fn routeSpanBatch(value:int) -> int:");
      expect(wsCtx.formattedBundle).not.toContain("class AbstractBaseProbe");

      // 3. splice with symbol: "@first" updates routeSpanBatch inside the nested namespace without corrupting AbstractBaseProbe
      await splice(tsPath, {
        symbol: "@first",
        code: [
          "fn routeSpanBatch(value:int) -> int:",
          "  if value < 0:",
          "    ret 0",
          "  scaled = value * 3",
          "  bounded = scaled + 99",
          "  ret bounded",
        ].join("\n"),
      });
      const updatedTs = fs.readFileSync(tsPath, "utf-8");
      expect(updatedTs).toContain("export abstract class AbstractBaseProbe");
      expect(updatedTs).toContain("+ 99");

      // 4. Nested TSX layout containers (<div class="grid"> wrapping <div class="kpi-tile">) only mine leaf-container idioms
      const tsxPath = path.join(dir, "Board.tsx");
      fs.writeFileSync(
        tsxPath,
        [
          "export function BoardA() {",
          "  return (",
          '    <section className="board">',
          '      <div className="grid">',
          '        <div className="kpi-tile"><span>A1</span><strong>10</strong></div>',
          '        <div className="kpi-tile"><span>A2</span><strong>20</strong></div>',
          "      </div>",
          '      <div className="grid">',
          '        <div className="kpi-tile"><span>B1</span><strong>30</strong></div>',
          '        <div className="kpi-tile"><span>B2</span><strong>40</strong></div>',
          "      </div>",
          '      <div className="grid">',
          '        <div className="kpi-tile"><span>C1</span><strong>50</strong></div>',
          '        <div className="kpi-tile"><span>C2</span><strong>60</strong></div>',
          "      </div>",
          "    </section>",
          "  );",
          "}",
        ].join("\n"),
        "utf-8",
      );
      const scanned = await scanProjectIdioms(dir);
      expect(scanned.idioms.$tsx_kpi_tile).toBeDefined();
      expect(scanned.idioms.$tsx_grid).toBeUndefined();
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("validates 3-layer target filenames, 2-pillar blind isolated prompts, constant-folded decoy detection, Twig block checks, and anti-cheat sandbox bounds", async () => {
    const os = await import("node:os");
    const {
      ALL_REAL_AGENT_BENCHMARKS,
      auditTranscriptCompliance,
      buildLayerPrompt,
      buildPrompt,
      computeFileDecoySpec,
      SCENARIO_LAYER_DEFINITIONS,
      setupWorkspace,
      verifyWorkspaceOnDisk,
    } = await import("../../benchmarks/run-real-agents.js");
    const { runRankingBenchmarks } = await import("../../benchmarks/run-ranking-benchmark.js");

    // 1. Every Layer 2 & Layer 3 targetFile and filename mentioned in taskPrompt must exist in spec.files
    const fileMentionRe =
      /\b[A-Za-z0-9_-]+\.(?:ts|tsx|js|py|php|go|rs|cpp|cs|kt|html|twig|css|json|yaml)\b/g;
    for (const spec of ALL_REAL_AGENT_BENCHMARKS) {
      const validFiles = new Set(spec.files.map((f) => f.fileName));
      const layerDefs = SCENARIO_LAYER_DEFINITIONS[spec.id];
      expect(layerDefs).toBeDefined();
      for (const layer of [layerDefs.layer2, layerDefs.layer3]) {
        for (const tf of layer.targetFiles) {
          expect(
            validFiles.has(tf),
            `${spec.id} Layer ${layer.layerIndex} targetFile '${tf}' does not exist in workspace`,
          ).toBe(true);
        }
        const mentioned = layer.taskPrompt.match(fileMentionRe) || [];
        for (const mf of mentioned) {
          expect(
            validFiles.has(mf),
            `${spec.id} Layer ${layer.layerIndex} taskPrompt mentions nonexistent file '${mf}'`,
          ).toBe(true);
        }
      }

      // 2. Prompts never leak scenario IDs (RW-XX) and always enforce workspace boundaries
      for (const mode of ["without_aice", "aice_no_idioms", "aice_with_idioms"] as const) {
        const p1 = buildPrompt(spec, mode, "/tmp/bench-ws", 20261108);
        const p2 = buildLayerPrompt(spec, mode, "/tmp/bench-ws", 2);
        const p3 = buildLayerPrompt(spec, mode, "/tmp/bench-ws", 3);
        for (const p of [p1, p2, p3]) {
          expect(p).not.toContain(spec.id);
          expect(p).toContain("Workspace Boundary: Work strictly inside /tmp/bench-ws");
        }
        if (mode === "without_aice") {
          expect(p1).toContain("read_file");
          expect(p1).toContain("edit_file");
        } else {
          expect(p1).toContain("--stdin << 'EOF'");
          expect(p2).toContain("WaitMsBeforeAsync: 10000");
        }
      }
    }

    // 3. Constant-folded decoy corruption (`probe + (decoyStep + 1)`) is caught even when DECOY_SENTINEL comment stays intact
    const rw11Dir = setupWorkspace(
      ALL_REAL_AGENT_BENCHMARKS.find((s) => s.id === "RW-11")!,
      "aice_no_idioms",
      20261108,
    );
    try {
      const rw11Spec = ALL_REAL_AGENT_BENCHMARKS.find((s) => s.id === "RW-11")!;
      const decoy = computeFileDecoySpec(20261108, "RW-11", "ledger_reconciler.ts");
      const lrPath = path.join(rw11Dir, "ledger_reconciler.ts");
      const orig = fs.readFileSync(lrPath, "utf-8");
      // Replace ONLY the function return `probe + <step>` with constant-folded `probe + <step + 1>`, leaving comment untouched
      const folded = orig.replace(
        new RegExp(`(\\bprobe\\s*\\+\\s*)${decoy.decoyStep}\\b`),
        `$1${decoy.decoyStep + 1}`,
      );
      expect(folded).toContain(decoy.commentTag);
      fs.writeFileSync(lrPath, folded, "utf-8");
      const checkFolded = verifyWorkspaceOnDisk(rw11Spec, rw11Dir, 20261108);
      expect(checkFolded.decoysIntact).toBe(false);
    } finally {
      fs.rmSync(rw11Dir, { recursive: true, force: true });
    }

    // 4. Native Twig `{% block <sym>_summary %}` passes verifyWorkspaceOnDisk for new_feature scenario
    const customTwigNewFeature = {
      id: "RW-03",
      title: "Twig New Feature Check",
      description: "Twig summary block verification",
      scenario: "new_feature" as const,
      appSurface: "window" as const,
      files: [
        OFFLINE_BENCHMARKS.find((s) => s.id === "RW-03")!.files.find(
          (f) => f.languageId === "twig",
        )!,
      ],
    };
    const twigDir = setupWorkspace(customTwigNewFeature, "without_aice", 20261108);
    try {
      const twigFile = customTwigNewFeature.files[0];
      const twigPath = path.join(twigDir, twigFile.fileName);
      const { computeSeededFileMutation } = await import("../../benchmarks/run-real-agents.js");
      const mut = computeSeededFileMutation(20261108, "RW-03", twigFile, true);
      let twigSrc = fs.readFileSync(twigPath, "utf-8").replace(/summary-row/g, "summary-row-v2");
      // Remove obsolete block and append native Twig summary block
      const obs = twigFile.obsoleteSymbol!;
      twigSrc = twigSrc.replace(
        new RegExp(`\\{%\\s*block\\s+${obs}\\s*%\\}[\\s\\S]*?\\{%\\s*endblock\\s*%\\}`, "g"),
        "",
      );
      twigSrc += `\n{% block ${mut.targetSymbol}_summary %}<div class="summary-row-v2"><span>${mut.expectedTokens[0]}</span></div>{% endblock %}\n`;
      fs.writeFileSync(twigPath, twigSrc, "utf-8");
      const twigCheck = verifyWorkspaceOnDisk(
        customTwigNewFeature,
        twigDir,
        20261108,
        1,
        undefined,
        "without_aice",
      );
      expect(twigCheck.details).toEqual([]);
      expect(twigCheck.verified).toBe(true);
    } finally {
      fs.rmSync(twigDir, { recursive: true, force: true });
    }

    // 5. Anti-cheat audit catches sandbox escapes across ALL modes, `aice` in without_aice, `read_file` in AICE modes, and allows `aice write --stdin`
    const tmpAuditDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-audit-gate-"));
    try {
      const writeLog = (name: string, obj: unknown) => {
        const p = path.join(tmpAuditDir, name);
        fs.writeFileSync(p, `${JSON.stringify(obj)}\n`, "utf-8");
        return p;
      };

      const escapeLog = writeLog("escape.jsonl", {
        type: "PLANNER_RESPONSE",
        tool_calls: [
          {
            name: "read_file",
            args: { Path: "/home/forart/dev/aice/benchmarks/run-real-agents.ts" },
          },
        ],
      });
      expect(auditTranscriptCompliance(escapeLog, "without_aice", tmpAuditDir).compliant).toBe(
        false,
      );
      expect(auditTranscriptCompliance(escapeLog, "aice_with_idioms", tmpAuditDir).compliant).toBe(
        false,
      );

      const aiceInBaselineLog = writeLog("aice_in_baseline.jsonl", {
        type: "PLANNER_RESPONSE",
        tool_calls: [{ name: "run_command", args: { CommandLine: 'aice context . -s "*"' } }],
      });
      expect(
        auditTranscriptCompliance(aiceInBaselineLog, "without_aice", tmpAuditDir).compliant,
      ).toBe(false);

      const readFileInAiceLog = writeLog("read_in_aice.jsonl", {
        type: "PLANNER_RESPONSE",
        tool_calls: [{ name: "read_file", args: { Path: path.join(tmpAuditDir, "engine.ts") } }],
      });
      expect(
        auditTranscriptCompliance(readFileInAiceLog, "aice_no_idioms", tmpAuditDir).compliant,
      ).toBe(false);

      const validWriteHeredoc = writeLog("valid_write.jsonl", {
        type: "PLANNER_RESPONSE",
        tool_calls: [
          {
            name: "run_command",
            args: {
              CommandLine:
                "aice write --no-idioms --stdin << 'EOF'\n=== engine.ts ===\nexport const x = 1;\nEOF",
            },
          },
        ],
      });
      expect(
        auditTranscriptCompliance(validWriteHeredoc, "aice_no_idioms", tmpAuditDir).compliant,
      ).toBe(true);
    } finally {
      fs.rmSync(tmpAuditDir, { recursive: true, force: true });
    }

    // 6. Ranking benchmark runs deterministically without side effects and achieves 100% Rank #1 precision
    const rankingTrials = await runRankingBenchmarks();
    expect(rankingTrials).toHaveLength(3);
    expect(rankingTrials.every((t) => t.verified && t.rankPosition === 1)).toBe(true);
    expect(rankingTrials[2].totalMatches).toBe(25);
    expect(rankingTrials[2].noiseTokensSaved).toBeGreaterThan(0);

    // 7. Honest markdown report formatting (no hardcoded 100% win rates, no --/+-, includes Section 3b)
    const realReport = loadRealAgentBenchmarkSuiteReport();
    const md = formatRealAgentBenchmarkMarkdown(realReport);
    expect(md).not.toMatch(/(?:--|\+-|-\+)\d/);
    expect(md).toContain("3b. 3-Layer Progressive Lifecycle Breakdown");
    expect(md).toContain(
      `Wins ${realReport.winsWithIdioms}/${realReport.totalBenchmarks} Multi-File Scenarios`,
    );
  });

  it("isolates child PATH/env from /dev/aice worktrees and keeps OAUTH_OR_RATE_LIMIT_RE immune to telemetry 'tokens' / print_timeout", async () => {
    const { buildIsolatedBenchmarkEnv, OAUTH_OR_RATE_LIMIT_RE } = await import(
      "../../benchmarks/run-real-agents.js"
    );

    const isolated = buildIsolatedBenchmarkEnv(
      {
        PATH: [
          "/home/user/.gemini/antigravity-cli/worktrees/swarm-bench-1/node_modules/.bin",
          "/home/user/dev/aice/node_modules/.bin",
          "/home/user/.local/bin",
          "/usr/bin",
        ].join(path.delimiter),
        npm_package_json: "/home/user/dev/aice/package.json",
        INIT_CWD: "/home/user/dev/aice",
        PWD: "/home/user/.gemini/antigravity-cli/worktrees/swarm-bench-1",
        HOME: "/home/user",
      },
      "/tmp/aice-rw-06-without_aice-xyz",
    );

    expect(isolated.PATH).toBe(["/home/user/.local/bin", "/usr/bin"].join(path.delimiter));
    expect(isolated.npm_package_json).toBeUndefined();
    expect(isolated.PWD).toBe("/tmp/aice-rw-06-without_aice-xyz");
    expect(isolated.INIT_CWD).toBe("/tmp/aice-rw-06-without_aice-xyz");
    expect(isolated.HOME).toBe("/home/user");

    // Must NOT match partial telemetry words like "tokens", "token", or print_timeout
    expect(
      OAUTH_OR_RATE_LIMIT_RE.test(
        '{"reason":"print_timeout","output_tokens":4521,"tokens":12000,"error":"DEADLINE_EXCEEDED"}',
      ),
    ).toBe(false);
    expect(OAUTH_OR_RATE_LIMIT_RE.test("ETIMEDOUT: agy process timed out after 660000ms")).toBe(
      false,
    );

    // Must still match genuine OAuth / rate-limit / quota / transient network errors
    expect(OAUTH_OR_RATE_LIMIT_RE.test("Error: invalid_grant: refresh_token expired")).toBe(true);
    expect(OAUTH_OR_RATE_LIMIT_RE.test("RESOURCE_EXHAUSTED: quota exceeded (status 429)")).toBe(
      true,
    );
  });
});
