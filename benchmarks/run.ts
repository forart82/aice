/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CLI Runner for AICE 2.0 Real AI Agent Benchmarks (`docs/BENCHMARKS.md`)
 * and Deterministic Offline Benchmarks (`docs/BENCHMARKS_OFFLINE.md`).
 * Usage:
 *   npx tsx benchmarks/run.ts
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  formatOfflineBenchmarkMarkdown,
  runOfflineBenchmarkSuite,
} from "./offline-suite.js";
import {
  formatRealAgentBenchmarkMarkdown,
  loadRealAgentBenchmarkSuiteReport,
} from "./real-agent-suite.js";

const offlineReport = runOfflineBenchmarkSuite();
const offlineMarkdown = formatOfflineBenchmarkMarkdown(offlineReport);

const offlineDocsPath = path.resolve(process.cwd(), "docs/BENCHMARKS_OFFLINE.md");
fs.mkdirSync(path.dirname(offlineDocsPath), { recursive: true });
fs.writeFileSync(offlineDocsPath, offlineMarkdown, "utf-8");

const realReport = loadRealAgentBenchmarkSuiteReport();
const realMarkdown = formatRealAgentBenchmarkMarkdown(realReport, offlineReport);

const realDocsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
fs.mkdirSync(path.dirname(realDocsPath), { recursive: true });
fs.writeFileSync(realDocsPath, realMarkdown, "utf-8");

const t = realReport.totals;
console.log(
  `[Real AI Agent Benchmarks (${realReport.totalBenchmarks} scenarios — 30 real agent transcripts)]\n` +
    `  Output Tokens:  Without AICE = ${t.withoutAiceOutputTokens.toLocaleString("en-US")} | No Idioms = ${t.aiceWithoutIdiomsOutputTokens.toLocaleString("en-US")} (-${t.outputTokensSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsOutputTokens.toLocaleString("en-US")} (-${t.outputTokensSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Working Tokens: Without AICE = ${t.withoutAiceWorkingTokens.toLocaleString("en-US")} | No Idioms = ${t.aiceWithoutIdiomsWorkingTokens.toLocaleString("en-US")} (-${t.workingTokensSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsWorkingTokens.toLocaleString("en-US")} (-${t.workingTokensSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  API Cost (USD): Without AICE = $${t.withoutAiceApiCostUsd.toFixed(4)} | No Idioms = $${t.aiceWithoutIdiomsApiCostUsd.toFixed(4)} (-${t.apiCostSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = $${t.aiceWithIdiomsApiCostUsd.toFixed(4)} (-${t.apiCostSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  LLM Turns:      Without AICE = ${t.withoutAiceTurns} turns | No Idioms = ${t.aiceWithoutIdiomsTurns} turns (-${t.turnsSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsTurns} turns (-${t.turnsSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Tool Calls:     Without AICE = ${t.withoutAiceToolCalls} calls | No Idioms = ${t.aiceWithoutIdiomsToolCalls} calls (-${t.toolCallsSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsToolCalls} calls (-${t.toolCallsSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Billable Tok:   Without AICE = ${t.withoutAiceBillableTokens.toLocaleString("en-US")} | No Idioms = ${t.aiceWithoutIdiomsBillableTokens.toLocaleString("en-US")} (-${t.billableTokensSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsBillableTokens.toLocaleString("en-US")} (-${t.billableTokensSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  API Total Tok:  Without AICE = ${t.withoutAiceApiTotalTokens.toLocaleString("en-US")} | No Idioms = ${t.aiceWithoutIdiomsApiTotalTokens.toLocaleString("en-US")} (-${t.apiTotalTokensSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${t.aiceWithIdiomsApiTotalTokens.toLocaleString("en-US")} (-${t.apiTotalTokensSavingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Wins:           No Idioms = ${realReport.winsWithoutIdioms}/${realReport.totalBenchmarks} | With Idioms = ${realReport.winsWithIdioms}/${realReport.totalBenchmarks} | Cold-Start: ${realReport.allColdStartRepos} | Blind: ${realReport.allBlindPrompts} | Decoys Intact: ${realReport.allDecoysIntact} | Disk Verified: ${realReport.allVerifiedOnDisk}`,
);

console.log(
  `\n[Deterministic Offline Benchmarks (${offlineReport.totalBenchmarks} scenarios -> docs/BENCHMARKS_OFFLINE.md)]\n` +
    `  Tokens: Without AICE = ${offlineReport.aggregateTotal.withoutAiceTokens.toLocaleString("en-US")} | No Idioms = ${offlineReport.aggregateTotal.aiceWithoutIdiomsTokens.toLocaleString("en-US")} (-${offlineReport.aggregateTotal.savingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${offlineReport.aggregateTotal.aiceWithIdiomsTokens.toLocaleString("en-US")} (-${offlineReport.aggregateTotal.savingsWithIdiomsPct.toFixed(1)}%)\n` +
    `  Turns:  Without AICE = ${offlineReport.aggregateTotal.withoutAiceTurns} turns | No Idioms = ${offlineReport.aggregateTotal.aiceWithoutIdiomsTurns} turns (-${offlineReport.aggregateTotal.turnsSavingsWithoutIdiomsPct.toFixed(1)}%) | With Idioms = ${offlineReport.aggregateTotal.aiceWithIdiomsTurns} turns (-${offlineReport.aggregateTotal.turnsSavingsWithIdiomsPct.toFixed(1)}%)`,
);

if (
  realReport.winsWithoutIdioms < realReport.totalBenchmarks ||
  realReport.winsWithIdioms < realReport.totalBenchmarks ||
  !realReport.allVerifiedOnDisk ||
  !realReport.zeroAiceFilesLeftOnDisk ||
  !realReport.allColdStartRepos ||
  !realReport.allBlindPrompts ||
  !realReport.allDecoysIntact ||
  offlineReport.winsWithoutIdioms < offlineReport.totalBenchmarks ||
  offlineReport.winsWithIdioms < offlineReport.totalBenchmarks
) {
  process.exit(1);
}
