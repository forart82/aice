/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for AIL 2.0 Consolidated Honest Benchmark Suite.
 * Usage:
 *   npx tsx benchmarks/run.ts [--cases=10..100]
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatHonestBenchmarkMarkdown,
  runHonestBenchmarkSuite,
} from "./honest-suite.js";

function parseCasesArg(): number {
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--cases=")) {
      const val = Number(arg.split("=")[1]);
      if (Number.isFinite(val) && val >= 1 && val <= 100) {
        return Math.floor(val);
      }
    }
  }
  return 100;
}

const maxCasesPerLanguage = parseCasesArg();
const report = runHonestBenchmarkSuite(maxCasesPerLanguage);
const markdown = formatHonestBenchmarkMarkdown(report);

const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
fs.mkdirSync(path.dirname(docsPath), { recursive: true });
fs.writeFileSync(docsPath, markdown, "utf-8");

const failedSingle = report.cases.filter((c) => !c.ailWinsAllOperations);
const failedPoly = report.polyglotBenchmarks.filter((p) => !p.ailWinsAllOperations);

console.log(
  `[Honest Benchmark Wave ${report.wavesCompleted} (${maxCasesPerLanguage} cases/lang)] ` +
    `Single-Lang: ${report.totalSingleLanguageCases - failedSingle.length}/${report.totalSingleLanguageCases} | ` +
    `Polyglot: ${report.totalPolyglotCases - failedPoly.length}/${report.totalPolyglotCases} | ` +
    `Total Win Rate: ${report.totalWins}/${report.totalCases} (${report.overallWinRatePct.toFixed(1)}%) | ` +
    `Monotonicity: ${report.strictComplexityMonotonicity} | Zero .ail Left: ${report.zeroAilFilesLeftOnDisk}`,
);

if (failedSingle.length > 0) {
  console.error("Failed single-language cases:");
  for (const f of failedSingle.slice(0, 15)) {
    console.error(
      `  - ${f.caseId} (${f.scenario}): write=${f.writeFromZero.savingsPct}% read=${f.readContext.savingsPct}% update=${f.surgicalUpdate.savingsPct}% delete=${f.surgicalDelete.savingsPct}% refactor=${f.multiFileRefactor.savingsPct}%`,
    );
  }
  process.exit(1);
}

if (failedPoly.length > 0) {
  console.error("Failed polyglot cases:");
  for (const p of failedPoly) {
    console.error(
      `  - ${p.polyglotId} (${p.title}): write=${p.writeFromZero.savingsPct}% read=${p.readContext.savingsPct}% update=${p.surgicalUpdate.savingsPct}% delete=${p.surgicalDelete.savingsPct}% refactor=${p.multiFileRefactor.savingsPct}%`,
    );
  }
  process.exit(1);
}
