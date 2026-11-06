/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for the AIL 2.0 500-Per-Language & File-Type Progressive On-the-Fly Benchmark Suite
 * (15 Supported Languages/File Types × 500 Progressive Benchmarks = 7,500 Benchmarks).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatAllDialects500MarkdownReport,
  runAllDialects500Benchmarks,
} from "../src/tools/benchmark-500-per-language.js";

function main() {
  const summary = runAllDialects500Benchmarks();
  const reportMd = formatAllDialects500MarkdownReport(summary);

  const outPath = path.resolve("docs/BENCHMARK_500_PER_LANGUAGE.md");
  fs.writeFileSync(outPath, reportMd, "utf-8");

  console.log(
    `[AIL 500-Per-Language Benchmark] Dialects: ${summary.totalDialects} × ${summary.casesPerDialect} = ${summary.totalCases} cases | Strict Complexity: ${summary.allStrictProgressiveComplexity} | AIL On-the-Fly Wins: ${summary.totalAilOnTheFlyWinsAll}/${summary.totalCases} (${summary.overallWinRatePct}%)`,
  );
  console.log(
    `[AIL 500-Per-Language Benchmark] Without AIL at All: ${summary.totalWithoutAilAtAllTokens} tok | Without AIL On-the-Fly: ${summary.totalWithoutAilOnTheFlyTokens} tok | With AIL On-the-Fly: ${summary.totalWithAilOnTheFlyTokens} tok (-${summary.overallSavingsVsWithoutAilAtAllPct}% vs Raw, -${summary.overallSavingsVsWithoutOnTheFlyPct}% vs Legacy Twin)`,
  );

  for (const ds of summary.dialectSuites) {
    const s = ds.summary;
    console.log(
      `  - ${ds.spec.label.padEnd(18)} | Wins: ${s.ailOnTheFlyWinsAllCount}/${s.totalCases} (${s.winRatePct}%) | Raw: ${s.totalWithoutAilAtAllTokens} | Twin: ${s.totalWithoutAilOnTheFlyTokens} | On-the-Fly: ${s.totalWithAilOnTheFlyTokens} (-${s.overallSavingsVsWithoutAilAtAllPct}% vs Raw, -${s.overallSavingsVsWithoutOnTheFlyPct}% vs Twin)`,
    );
  }

  if (summary.totalAilOnTheFlyWinsAll !== summary.totalCases) {
    console.error(
      `ERROR: Expected ${summary.totalCases} wins, got ${summary.totalAilOnTheFlyWinsAll}`,
    );
    process.exit(1);
  }
}

main();
