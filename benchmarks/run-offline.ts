/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for AICE 2.0 Deterministic Offline Benchmark Suite (10 Scenarios — Without & With Idioms).
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

const failedWithoutIdioms = report.benchmarks.filter((b) => !b.aiceWinsAllWithoutIdioms);
const failedWithIdioms = report.benchmarks.filter((b) => !b.aiceWinsAllWithIdioms);

console.log(
  `[Deterministic Offline Benchmarks (${report.totalBenchmarks} scenarios)]\n` +
    `  Tokens: Without AICE = ${report.aggregateTotal.withoutAiceTokens.toLocaleString("en-US")} | No Idioms = ${report.aggregateTotal.aiceWithoutIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${report.aggregateTotal.aiceWithIdiomsTokens.toLocaleString("en-US")} (-${report.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Turns:  Without AICE = ${report.aggregateTotal.withoutAiceTurns} turns | No Idioms = ${report.aggregateTotal.aiceWithoutIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${report.aggregateTotal.aiceWithIdiomsTurns} turns (-${report.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Wins:   No Idioms = ${report.winsWithoutIdioms}/${report.totalBenchmarks} | With Idioms = ${report.winsWithIdioms}/${report.totalBenchmarks} | Languages: ${report.coveredLanguages.length}/15 | Zero .aice Left: ${report.zeroAiceFilesLeftOnDisk}`,
);

if (failedWithoutIdioms.length > 0 || failedWithIdioms.length > 0) {
  for (const b of report.benchmarks) {
    if (!b.aiceWinsAllWithoutIdioms || !b.aiceWinsAllWithIdioms) {
      console.error(
        `  - ${b.id} (${b.title}):\n` +
          `      Write:    noIdiom=${b.writeFromZero.savingsWithoutIdiomsPct}% (${b.writeFromZero.aiceWithoutIdiomsWins}) | withIdiom=${b.writeFromZero.savingsWithIdiomsPct}% (${b.writeFromZero.aiceWithIdiomsWins})\n` +
          `      Read:     noIdiom=${b.readContext.savingsWithoutIdiomsPct}% (${b.readContext.aiceWithoutIdiomsWins}) | withIdiom=${b.readContext.savingsWithIdiomsPct}% (${b.readContext.aiceWithIdiomsWins})\n` +
          `      Update:   noIdiom=${b.surgicalUpdate.savingsWithoutIdiomsPct}% (${b.surgicalUpdate.aiceWithoutIdiomsWins}) | withIdiom=${b.surgicalUpdate.savingsWithIdiomsPct}% (${b.surgicalUpdate.aiceWithIdiomsWins})\n` +
          `      Delete:   noIdiom=${b.surgicalDelete.savingsWithoutIdiomsPct}% (${b.surgicalDelete.aiceWithoutIdiomsWins}) | withIdiom=${b.surgicalDelete.savingsWithIdiomsPct}% (${b.surgicalDelete.aiceWithIdiomsWins})\n` +
          `      Refactor: noIdiom=${b.multiFileRefactor.savingsWithoutIdiomsPct}% (${b.multiFileRefactor.aiceWithoutIdiomsWins}) | withIdiom=${b.multiFileRefactor.savingsWithIdiomsPct}% (${b.multiFileRefactor.aiceWithIdiomsWins})`,
      );
    }
  }
  process.exit(1);
}
