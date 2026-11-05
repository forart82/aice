/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for the AIL 2.0 100-Case Deep On-the-Fly Benchmark Suite.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatBenchmark100MarkdownReport,
  runBenchmark100Cases,
} from "../src/tools/benchmark-100-cases.js";

async function main() {
  const summary = await runBenchmark100Cases();
  const reportMd = formatBenchmark100MarkdownReport(summary);

  const outPath = path.resolve("docs/BENCHMARK_100_ON_THE_FLY.md");
  fs.writeFileSync(outPath, reportMd, "utf-8");

  console.log(
    `[AIL 100-Case Benchmark] Total: ${summary.totalCases} | Passed: ${summary.passedCases}/${summary.totalCases} | AIL Wins: ${summary.ailBetterCount}/${summary.totalCases} (${summary.winRatePct}%)`,
  );
  console.log(
    `[AIL 100-Case Benchmark] Without AIL: ${summary.totalWithoutAilTokens} tok | With AIL On-the-Fly: ${summary.totalWithAilTokens} tok | Saved: ${summary.totalTokensSaved} tok (-${summary.overallSavingsPct}% overall, -${summary.averageSavingsPct}% avg)`,
  );

  const failures = summary.results.filter((r) => !r.ailBetter);
  if (failures.length > 0) {
    console.error(`\nFailed / Non-Winning Cases (${failures.length}):`);
    for (const f of failures) {
      console.error(
        `  - [${f.id}] ${f.situation} (${f.lang}): without=${f.withoutAilTokens}, with=${f.withAilTokens}, pass=${f.semanticPass}, zeroAil=${f.zeroAilFilesOnDisk} -> ${f.diagnostic}`,
      );
    }
    process.exit(1);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
