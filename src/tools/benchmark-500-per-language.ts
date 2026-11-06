/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 500-Per-Language & File-Type Progressive On-the-Fly Benchmark Suite
 * (15 Supported Languages/File Types × 500 Progressive Benchmarks = 7,500 Benchmarks).
 *
 * Covers every supported programming language and file type in AIL:
 *   1. TypeScript (.ts)   - 500 progressive benchmarks (#001..#500)
 *   2. React TSX (.tsx)   - 500 progressive benchmarks (#001..#500)
 *   3. JavaScript (.js)   - 500 progressive benchmarks (#001..#500)
 *   4. Python (.py)       - 500 progressive benchmarks (#001..#500)
 *   5. Go (.go)           - 500 progressive benchmarks (#001..#500)
 *   6. Rust (.rs)         - 500 progressive benchmarks (#001..#500)
 *   7. C++ (.cpp)         - 500 progressive benchmarks (#001..#500)
 *   8. C# (.cs)           - 500 progressive benchmarks (#001..#500)
 *   9. Kotlin (.kt)       - 500 progressive benchmarks (#001..#500)
 *  10. PHP (.php)         - 500 progressive benchmarks (#001..#500)
 *  11. CSS (.css)         - 500 progressive benchmarks (#001..#500)
 *  12. HTML (.html)       - 500 progressive benchmarks (#001..#500)
 *  13. JSON (.json)       - 500 progressive benchmarks (#001..#500)
 *  14. YAML (.yaml)       - 500 progressive benchmarks (#001..#500)
 *  15. Twig (.twig)       - 500 progressive benchmarks (#001..#500)
 *
 * In every single benchmark (7,500 / 7,500), AIL On-the-Fly (Twinless + Smart Multi-File Idioms)
 * must strictly beat BOTH "Without AIL On-the-Fly" (legacy .ail twin workflow) AND
 * "Without AIL at all" (raw native workflow), with strictly increasing complexity (#001 -> #500)
 * and zero .ail files on disk.
 */

import type { TargetLanguage } from "../emitters/index.js";
import {
  buildProgressiveDialectWorkload,
  evaluateProgressiveWorkload,
  SUPPORTED_DIALECT_SPECS,
  summarizeBenchmark500Results,
  type Benchmark500CaseResult,
  type Benchmark500Summary,
  type SupportedDialectSpec,
} from "./benchmark-500-cases.js";

export interface Dialect500BenchmarkSuite {
  spec: SupportedDialectSpec;
  summary: Benchmark500Summary;
}

export interface AllDialects500BenchmarkSummary {
  totalDialects: number;
  casesPerDialect: number;
  totalCases: number;
  totalPassedCases: number;
  allStrictProgressiveComplexity: boolean;
  totalBeatsWithoutAilAtAll: number;
  totalBeatsWithoutOnTheFly: number;
  totalAilOnTheFlyWinsAll: number;
  overallWinRatePct: number;
  totalWithoutAilAtAllTokens: number;
  totalWithoutAilOnTheFlyTokens: number;
  totalWithAilOnTheFlyTokens: number;
  overallSavingsVsWithoutAilAtAllPct: number;
  overallSavingsVsWithoutOnTheFlyPct: number;
  dialectSuites: Dialect500BenchmarkSuite[];
}

const DIALECT_TIER_LABELS = [
  "Tier 01 (#001-#050): Single-Symbol / Single-Rule / Single-Key Surgical Slice",
  "Tier 02 (#051-#100): Multi-Symbol / Multi-Rule Module Slicing",
  "Tier 03 (#101-#150): Cross-Module Dependency Contract Resolution",
  "Tier 04 (#151-#200): Intra-Module Idiom Collapse & Symbol Context",
  "Tier 05 (#201-#250): Multi-Module Idiom Mining & Propagation",
  "Tier 06 (#251-#300): Forgiving AI Input Normalization on Surgical Splice",
  "Tier 07 (#301-#350): Deep Control-Flow & Nested Structure Splices",
  "Tier 08 (#351-#400): Multi-Symbol & Multi-Section Coordinated Refactoring",
  "Tier 09 (#401-#450): Large-Scale Subsystem Context & Surgical Mutation",
  "Tier 10 (#451-#500): Enterprise-Grade 20+ Symbol Full-Stack Twinless Workflow",
];

/**
 * Runs 500 progressively more complex benchmarks (#001 -> #500) for a single
 * supported programming language or file type.
 */
export function run500BenchmarksForDialect(
  specOrLang: SupportedDialectSpec | TargetLanguage,
): Dialect500BenchmarkSuite {
  const spec =
    typeof specOrLang === "string"
      ? SUPPORTED_DIALECT_SPECS.find((s) => s.lang === specOrLang)!
      : specOrLang;
  if (!spec) {
    throw new Error(`Unsupported dialect: ${String(specOrLang)}`);
  }

  const results: Benchmark500CaseResult[] = [];
  let prevComplexityScore = 0;
  const codePrefix = spec.ext.replace(/^\./, "").toUpperCase();

  for (let i = 1; i <= 500; i++) {
    const tierIdx = Math.floor((i - 1) / 50);
    const tier = DIALECT_TIER_LABELS[tierIdx];
    const workload = buildProgressiveDialectWorkload(spec, i);
    const id = `${codePrefix}-${String(i).padStart(3, "0")}`;
    const situation = `${spec.label} Progressive #${String(i).padStart(3, "0")} (${workload.structuralMetrics.symbolCount} symbols, depth=${workload.structuralMetrics.statementDepth}, deps=${workload.structuralMetrics.depCount}): Twinless On-the-Fly slice + idiom collapse + direct splice on ${workload.targetSymbol}`;

    const res = evaluateProgressiveWorkload(
      i,
      id,
      tier,
      situation,
      spec,
      workload,
      prevComplexityScore,
    );
    prevComplexityScore = res.complexityScore;
    results.push(res);
  }

  return {
    spec,
    summary: summarizeBenchmark500Results(results),
  };
}

/**
 * Runs 500 progressive benchmarks (#001 -> #500) for EACH of the 15 supported
 * programming languages and file types (15 × 500 = 7,500 total benchmarks).
 */
export function runAllDialects500Benchmarks(): AllDialects500BenchmarkSummary {
  const dialectSuites = SUPPORTED_DIALECT_SPECS.map((spec) =>
    run500BenchmarksForDialect(spec),
  );

  const totalDialects = dialectSuites.length;
  const casesPerDialect = 500;
  const totalCases = dialectSuites.reduce((s, d) => s + d.summary.totalCases, 0);
  const totalPassedCases = dialectSuites.reduce(
    (s, d) => s + d.summary.passedCases,
    0,
  );
  const allStrictProgressiveComplexity = dialectSuites.every(
    (d) => d.summary.strictProgressiveComplexity,
  );
  const totalBeatsWithoutAilAtAll = dialectSuites.reduce(
    (s, d) => s + d.summary.beatsWithoutAilAtAllCount,
    0,
  );
  const totalBeatsWithoutOnTheFly = dialectSuites.reduce(
    (s, d) => s + d.summary.beatsWithoutOnTheFlyCount,
    0,
  );
  const totalAilOnTheFlyWinsAll = dialectSuites.reduce(
    (s, d) => s + d.summary.ailOnTheFlyWinsAllCount,
    0,
  );
  const overallWinRatePct =
    totalCases > 0
      ? Number(((totalAilOnTheFlyWinsAll / totalCases) * 100).toFixed(2))
      : 0;

  const totalWithoutAilAtAllTokens = dialectSuites.reduce(
    (s, d) => s + d.summary.totalWithoutAilAtAllTokens,
    0,
  );
  const totalWithoutAilOnTheFlyTokens = dialectSuites.reduce(
    (s, d) => s + d.summary.totalWithoutAilOnTheFlyTokens,
    0,
  );
  const totalWithAilOnTheFlyTokens = dialectSuites.reduce(
    (s, d) => s + d.summary.totalWithAilOnTheFlyTokens,
    0,
  );

  const overallSavingsVsWithoutAilAtAllPct =
    totalWithoutAilAtAllTokens > 0
      ? Number(
          (
            ((totalWithoutAilAtAllTokens - totalWithAilOnTheFlyTokens) /
              totalWithoutAilAtAllTokens) *
            100
          ).toFixed(2),
        )
      : 0;
  const overallSavingsVsWithoutOnTheFlyPct =
    totalWithoutAilOnTheFlyTokens > 0
      ? Number(
          (
            ((totalWithoutAilOnTheFlyTokens - totalWithAilOnTheFlyTokens) /
              totalWithoutAilOnTheFlyTokens) *
            100
          ).toFixed(2),
        )
      : 0;

  return {
    totalDialects,
    casesPerDialect,
    totalCases,
    totalPassedCases,
    allStrictProgressiveComplexity,
    totalBeatsWithoutAilAtAll,
    totalBeatsWithoutOnTheFly,
    totalAilOnTheFlyWinsAll,
    overallWinRatePct,
    totalWithoutAilAtAllTokens,
    totalWithoutAilOnTheFlyTokens,
    totalWithAilOnTheFlyTokens,
    overallSavingsVsWithoutAilAtAllPct,
    overallSavingsVsWithoutOnTheFlyPct,
    dialectSuites,
  };
}

export function formatAllDialects500MarkdownReport(
  summary: AllDialects500BenchmarkSummary,
): string {
  const lines: string[] = [];
  lines.push(
    "# AIL 2.0 500-Per-Language & File-Type Progressive On-the-Fly Benchmark Report (15 × 500 = 7,500 Cases)",
  );
  lines.push("");
  lines.push("## Executive Summary");
  lines.push("");
  lines.push(`- **Supported Languages & File Types Tested**: \`${summary.totalDialects}\``);
  lines.push(
    `- **Progressive Benchmarks per Language/File Type**: \`${summary.casesPerDialect}\` (\`#001\` -> \`#500\`)`,
  );
  lines.push(`- **Total Benchmarks Executed**: **\`${summary.totalCases.toLocaleString("en-US")}\`**`);
  lines.push(
    `- **Strictly Increasing Complexity in Every Language (\`#001 -> #500\`)**: \`${summary.allStrictProgressiveComplexity ? "YES (15/15 languages)" : "NO"}\``,
  );
  lines.push(
    `- **AIL On-the-Fly Beats Without AIL at All**: \`${summary.totalBeatsWithoutAilAtAll.toLocaleString("en-US")}/${summary.totalCases.toLocaleString("en-US")}\` (\`-${summary.overallSavingsVsWithoutAilAtAllPct}%\` tokens)`,
  );
  lines.push(
    `- **AIL On-the-Fly Beats Without AIL On-the-Fly (Legacy Twin)**: \`${summary.totalBeatsWithoutOnTheFly.toLocaleString("en-US")}/${summary.totalCases.toLocaleString("en-US")}\` (\`-${summary.overallSavingsVsWithoutOnTheFlyPct}%\` tokens)`,
  );
  lines.push(
    `- **Overall AIL On-the-Fly Win Rate**: **\`${summary.totalAilOnTheFlyWinsAll.toLocaleString("en-US")}/${summary.totalCases.toLocaleString("en-US")} (${summary.overallWinRatePct}%)\`**`,
  );
  lines.push(
    `- **Total Tokens (Without AIL at All)**: \`${summary.totalWithoutAilAtAllTokens.toLocaleString("en-US")}\``,
  );
  lines.push(
    `- **Total Tokens (Without AIL On-the-Fly / Legacy Twin)**: \`${summary.totalWithoutAilOnTheFlyTokens.toLocaleString("en-US")}\``,
  );
  lines.push(
    `- **Total Tokens (With AIL On-the-Fly)**: \`${summary.totalWithAilOnTheFlyTokens.toLocaleString("en-US")}\``,
  );
  lines.push("");
  lines.push("## Per-Language & File-Type Summary (500 Progressive Benchmarks Each)");
  lines.push("");
  lines.push(
    "| Language / File Type | Ext | Benchmarks | Progressive Complexity | Wins vs Without AIL | Wins vs Legacy Twin | Without AIL Tokens | Legacy Twin Tokens | With AIL On-the-Fly Tokens | Savings vs Raw | Savings vs Twin |",
  );
  lines.push(
    "| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
  );
  for (const ds of summary.dialectSuites) {
    const s = ds.summary;
    lines.push(
      `| **${ds.spec.label}** | \`${ds.spec.ext}\` | ${s.totalCases} | ${s.strictProgressiveComplexity ? "`#001 < ... < #500`" : "FAIL"} | **${s.beatsWithoutAilAtAllCount}/${s.totalCases}** | **${s.beatsWithoutOnTheFlyCount}/${s.totalCases}** | ${s.totalWithoutAilAtAllTokens.toLocaleString("en-US")} | ${s.totalWithoutAilOnTheFlyTokens.toLocaleString("en-US")} | ${s.totalWithAilOnTheFlyTokens.toLocaleString("en-US")} | **-${s.overallSavingsVsWithoutAilAtAllPct}%** | **-${s.overallSavingsVsWithoutOnTheFlyPct}%** |`,
    );
  }
  lines.push("");
  return lines.join("\n");
}
