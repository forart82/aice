/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for AIL 2.0 Deterministic Offline Benchmark Suite (10 Scenarios — Without & With Idioms).
 * Usage:
 *   npx tsx benchmarks/run-offline.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatOfflineBenchmarkMarkdown,
  runOfflineBenchmarkSuite,
} from "./offline-suite.js";

const report = runOfflineBenchmarkSuite();
const markdown = formatOfflineBenchmarkMarkdown(report);

const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS_OFFLINE.md");
fs.mkdirSync(path.dirname(docsPath), { recursive: true });
fs.writeFileSync(docsPath, markdown, "utf-8");

const failedWithoutIdioms = report.benchmarks.filter((b) => !b.ailWinsAllWithoutIdioms);
const failedWithIdioms = report.benchmarks.filter((b) => !b.ailWinsAllWithIdioms);

console.log(
  `[Deterministic Offline Benchmarks (${report.totalBenchmarks} scenarios)]\n` +
    `  Tokens: Without AIL = ${report.aggregateTotal.withoutAilTokens.toLocaleString("en-US")} | No Idioms = ${report.aggregateTotal.ailWithoutIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${report.aggregateTotal.ailWithIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%)\n` +
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
