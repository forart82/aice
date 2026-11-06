/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for the AIL 2.0 Progressive 500-Case On-the-Fly Benchmark Suite (#001 -> #500).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatBenchmark500MarkdownReport,
  run500OnTheFlyBenchmarks,
} from "../src/tools/benchmark-500-cases.js";

function main() {
  const summary = run500OnTheFlyBenchmarks();
  const reportMd = formatBenchmark500MarkdownReport(summary);

  const outPath = path.resolve("docs/BENCHMARK_500_ON_THE_FLY.md");
  fs.writeFileSync(outPath, reportMd, "utf-8");

  console.log(
    `[AIL 500-Case Progressive Benchmark] Total: ${summary.totalCases} | Strict Complexity Increase: ${summary.strictProgressiveComplexity} | AIL On-the-Fly Wins All: ${summary.ailOnTheFlyWinsAllCount}/${summary.totalCases} (${summary.winRatePct}%)`,
  );
  console.log(
    `[AIL 500-Case Progressive Benchmark] Without AIL at All: ${summary.totalWithoutAilAtAllTokens} tok | Without AIL On-the-Fly: ${summary.totalWithoutAilOnTheFlyTokens} tok | With AIL On-the-Fly: ${summary.totalWithAilOnTheFlyTokens} tok (-${summary.overallSavingsVsWithoutAilAtAllPct}% vs Raw, -${summary.overallSavingsVsWithoutOnTheFlyPct}% vs Legacy Twin)`,
  );

  const failures = summary.results.filter((r) => !r.ailOnTheFlyWinsAll);
  if (failures.length > 0) {
    console.error(`\nFailed / Non-Winning Cases (${failures.length}):`);
    for (const f of failures.slice(0, 25)) {
      console.error(
        `  - [${f.id}] (${f.lang}): withoutAll=${f.withoutAilAtAllTokens}, withoutOTF=${f.withoutAilOnTheFlyTokens}, withOTF=${f.withAilOnTheFlyTokens}, pass=${f.semanticPass}, complexUp=${f.strictComplexityIncrease} -> ${f.diagnostic}`,
      );
    }
    process.exit(1);
  }
}

main();
