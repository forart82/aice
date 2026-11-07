/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for AIL 2.0 10 Real-World Benchmarks Suite (Without & With Idioms).
 * Usage:
 *   npx tsx benchmarks/run.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatRealWorldBenchmarkMarkdown,
  runRealWorldBenchmarkSuite,
} from "./real-world-suite.js";

const report = runRealWorldBenchmarkSuite();
const markdown = formatRealWorldBenchmarkMarkdown(report);

const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
fs.mkdirSync(path.dirname(docsPath), { recursive: true });
fs.writeFileSync(docsPath, markdown, "utf-8");

const failedWithoutIdioms = report.benchmarks.filter((b) => !b.ailWinsAllWithoutIdioms);
const failedWithIdioms = report.benchmarks.filter((b) => !b.ailWinsAllWithIdioms);

console.log(
  `[Real-World Benchmarks (${report.totalBenchmarks} scenarios)]\n` +
    `  Tokens: Without AIL = ${report.aggregateTotal.withoutAilTokens.toLocaleString()} | No Idioms = ${report.aggregateTotal.ailWithoutIdiomsTokens.toLocaleString()} (-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${report.aggregateTotal.ailWithIdiomsTokens.toLocaleString()} (-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Turns:  Without AIL = ${report.aggregateTotal.withoutAilTurns} turns | No Idioms = ${report.aggregateTotal.ailWithoutIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${report.aggregateTotal.ailWithIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Wins:   No Idioms = ${report.winsWithoutIdioms}/${report.totalBenchmarks} | With Idioms = ${report.winsWithIdioms}/${report.totalBenchmarks} | Languages: ${report.coveredLanguages.length}/15 | Zero .ail Left: ${report.zeroAilFilesLeftOnDisk}`,
);

if (failedWithoutIdioms.length > 0 || failedWithIdioms.length > 0) {
  for (const b of report.benchmarks) {
    if (!b.ailWinsAllWithoutIdioms || !b.ailWinsAllWithIdioms) {
      console.error(
        `  - ${b.id} (${b.title}):\n` +
          `      Write:    noIdiom=${b.writeFromZero.savingsWithoutIdiomsPct}% (${b.writeFromZero.ailWithoutIdiomsWins}) | withIdiom=${b.writeFromZero.savingsWithIdiomsPct}% (${b.writeFromZero.ailWithIdiomsWins})\n` +
          `      Read:     noIdiom=${b.readContext.savingsWithoutIdiomsPct}% (${b.readContext.ailWithoutIdiomsWins}) | withIdiom=${b.readContext.savingsWithIdiomsPct}% (${b.readContext.ailWithIdiomsWins})\n` +
          `      Update:   noIdiom=${b.surgicalUpdate.savingsWithoutIdiomsPct}% (${b.surgicalUpdate.ailWithoutIdiomsWins}) | withIdiom=${b.surgicalUpdate.savingsWithIdiomsPct}% (${b.surgicalUpdate.ailWithIdiomsWins})\n` +
          `      Delete:   noIdiom=${b.surgicalDelete.savingsWithoutIdiomsPct}% (${b.surgicalDelete.ailWithoutIdiomsWins}) | withIdiom=${b.surgicalDelete.savingsWithIdiomsPct}% (${b.surgicalDelete.ailWithIdiomsWins})\n` +
          `      Refactor: noIdiom=${b.multiFileRefactor.savingsWithoutIdiomsPct}% (${b.multiFileRefactor.ailWithoutIdiomsWins}) | withIdiom=${b.multiFileRefactor.savingsWithIdiomsPct}% (${b.multiFileRefactor.ailWithIdiomsWins})`,
      );
    }
  }
  process.exit(1);
}
