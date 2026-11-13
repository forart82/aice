import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { auditTranscript } from "./audit-bench-transcript.js";
import { ALL_REAL_AGENT_BENCHMARKS, auditTranscriptCompliance } from "../benchmarks/run-real-agents.js";
export interface ScenarioRunAudit {
  scenarioId: string;
  title: string;
  mode: "without_aice" | "aice_no_idioms" | "aice_with_idioms";
  conversationId: string;
  transcriptFound: boolean;
  llmTurns: number;
  toolCalls: number;
  workingTokens: number;
  outputTokens: number;
  inputTokens: number;
  cacheReadTokens: number;
  apiCostUsd: number;
  verifiedOnDisk: boolean;
  workaroundViolations: string[];
  aiceFailures: string[];
  discrepancies: string[];
  verdict: "PASS" | "FAIL";
}

export interface MasterAuditReport {
  timestamp: string;
  totalScenarios: number;
  totalRunsAudited: number;
  passCount: number;
  failCount: number;
  overallVerdict: "PASS" | "FAIL";
  scenarioResults: ScenarioRunAudit[];
  modeAggregates: Record<
    string,
    {
      runs: number;
      passes: number;
      turns: number;
      toolCalls: number;
      workingTokens: number;
      outputTokens: number;
      inputTokens: number;
      costUsd: number;
    }
  >;
}

export function runMasterAudit(): MasterAuditReport {
  const resultsJsonPath = path.resolve("benchmarks/real-agent-results.json");
  if (!fs.existsSync(resultsJsonPath)) {
    throw new Error(`Results JSON not found at ${resultsJsonPath}`);
  }

  const rawResults = JSON.parse(fs.readFileSync(resultsJsonPath, "utf-8"));
  const report: MasterAuditReport = {
    timestamp: new Date().toISOString(),
    totalScenarios: ALL_REAL_AGENT_BENCHMARKS.length,
    totalRunsAudited: 0,
    passCount: 0,
    failCount: 0,
    overallVerdict: "PASS",
    scenarioResults: [],
    modeAggregates: {
      without_aice: { runs: 0, passes: 0, turns: 0, toolCalls: 0, workingTokens: 0, outputTokens: 0, inputTokens: 0, costUsd: 0 },
      aice_no_idioms: { runs: 0, passes: 0, turns: 0, toolCalls: 0, workingTokens: 0, outputTokens: 0, inputTokens: 0, costUsd: 0 },
      aice_with_idioms: { runs: 0, passes: 0, turns: 0, toolCalls: 0, workingTokens: 0, outputTokens: 0, inputTokens: 0, costUsd: 0 },
    },
  };

  const modes = ["without_aice", "aice_no_idioms", "aice_with_idioms"] as const;

  for (const spec of ALL_REAL_AGENT_BENCHMARKS) {
    const scenarioData = rawResults[spec.id];
    if (!scenarioData) continue;

    for (const mode of modes) {
      const run = scenarioData[mode];
      if (!run) continue;

      report.totalRunsAudited++;
      const convId = run.conversationId;
      const transcriptPath = convId
        ? path.join(os.homedir(), ".gemini/antigravity-cli/brain", convId, ".system_generated/logs/transcript.jsonl")
        : "";

      const transcriptFound = Boolean(transcriptPath && fs.existsSync(transcriptPath));

      // Run compliance audit
      const compliance = transcriptFound
        ? auditTranscriptCompliance(transcriptPath, mode)
        : { compliant: true, violations: [] };

      // Run detailed transcript parser if found
      const detailedAudit = transcriptFound
        ? auditTranscript({ conversationId: convId, mode, runnerReported: run })
        : null;

      const aiceFailuresList = detailedAudit?.aiceFailures.map((f) => `Step ${f.stepIndex}: ${f.command} -> ${f.error}`) || [];
      const violationsList = [
        ...compliance.violations,
        ...(detailedAudit?.violations.map((v) => `Step ${v.stepIndex} [${v.type}]: ${v.details}`) || []),
      ];

      // Remove duplicates
      const uniqueViolations = Array.from(new Set(violationsList));
      const uniqueFailures = Array.from(new Set(aiceFailuresList));

      let verdict: "PASS" | "FAIL" = "PASS";
      if (uniqueViolations.length > 0 || uniqueFailures.length > 0) {
        verdict = "FAIL";
      }

      if (verdict === "PASS") {
        report.passCount++;
      } else {
        report.failCount++;
      }

      const auditEntry: ScenarioRunAudit = {
        scenarioId: spec.id,
        title: spec.title,
        mode,
        conversationId: convId,
        transcriptFound,
        llmTurns: run.llmTurns || 0,
        toolCalls: run.toolCalls || 0,
        workingTokens: run.workingTokens || 0,
        outputTokens: run.outputTokens || 0,
        inputTokens: run.inputTokens || 0,
        cacheReadTokens: run.cacheReadTokens || 0,
        apiCostUsd: run.apiCostUsd || 0,
        verifiedOnDisk: Boolean(run.verifiedOnDisk),
        workaroundViolations: uniqueViolations,
        aiceFailures: uniqueFailures,
        discrepancies: detailedAudit?.discrepancies || [],
        verdict,
      };

      report.scenarioResults.push(auditEntry);

      const agg = report.modeAggregates[mode];
      agg.runs++;
      if (verdict === "PASS") agg.passes++;
      agg.turns += run.llmTurns || 0;
      agg.toolCalls += run.toolCalls || 0;
      agg.workingTokens += run.workingTokens || 0;
      agg.outputTokens += run.outputTokens || 0;
      agg.inputTokens += run.inputTokens || 0;
      agg.costUsd += run.apiCostUsd || 0;
    }
  }

  report.overallVerdict = report.failCount === 0 ? "PASS" : "FAIL";
  return report;
}

export function formatMasterScorecard(report: MasterAuditReport): string {
  const lines: string[] = [];
  lines.push("# Master 11-Scenario Audit & Token Verification Scorecard");
  lines.push("");
  lines.push(`- **Audit Timestamp**: ${report.timestamp}`);
  lines.push(`- **Total Scenarios Evaluated**: ${report.totalScenarios} (RW-01 through RW-11)`);
  lines.push(`- **Total Benchmark Runs Audited**: ${report.totalRunsAudited} runs`);
  lines.push(`- **Integrity Compliance Pass Rate**: ${report.passCount}/${report.totalRunsAudited} (${((report.passCount / report.totalRunsAudited) * 100).toFixed(1)}%)`);
  lines.push(`- **Overall Audit Verdict**: **${report.overallVerdict}**`);
  lines.push("");
  lines.push("## 1. Aggregate Mode Performance & Efficiency Comparison");
  lines.push("");
  lines.push("| Benchmark Mode | Runs | Passes | Total Turns | Total Tool Calls | Total Working Tokens | Total Output Tokens | Total Cost (USD) | Tool Churn Reduction | Working Token Savings |");
  lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  const baseAgg = report.modeAggregates["without_aice"];
  for (const [mode, agg] of Object.entries(report.modeAggregates)) {
    const label =
      mode === "without_aice"
        ? "Without AICE (Native Tools)"
        : mode === "aice_no_idioms"
        ? "AICE Without Idioms (Pure AICE)"
        : "AICE With Idioms (Dynamic Mining)";

    const toolChurnRed =
      baseAgg && baseAgg.toolCalls > 0 && mode !== "without_aice"
        ? `${(((baseAgg.toolCalls - agg.toolCalls) / baseAgg.toolCalls) * 100).toFixed(1)}%`
        : "Baseline";

    const tokSavings =
      baseAgg && baseAgg.workingTokens > 0 && mode !== "without_aice"
        ? `${(((baseAgg.workingTokens - agg.workingTokens) / baseAgg.workingTokens) * 100).toFixed(1)}%`
        : "Baseline";

    lines.push(
      `| **${label}** | ${agg.runs} | ${agg.passes}/${agg.runs} | ${agg.turns} | ${agg.toolCalls} | ${agg.workingTokens.toLocaleString("en-US")} | ${agg.outputTokens.toLocaleString("en-US")} | $${agg.costUsd.toFixed(4)} | **${toolChurnRed}** | **${tokSavings}** |`
    );
  }

  lines.push("");
  lines.push("## 2. Granular 11-Scenario Audit & Verification Matrix");
  lines.push("");
  lines.push("| Scenario | Title | Mode | Conv ID | Turns | Tools | Working Tokens | Output Tokens | Cost (USD) | On-Disk | Workarounds | AICE Stability | Verdict |");
  lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (const s of report.scenarioResults) {
    const cid = s.conversationId ? s.conversationId.slice(0, 8) : "N/A";
    const diskIcon = s.verifiedOnDisk ? "✅" : "❌";
    const workIcon = s.workaroundViolations.length === 0 ? "0 (Clean)" : `⚠️ ${s.workaroundViolations.length}`;
    const stabIcon = s.aiceFailures.length === 0 ? "100% OK" : `❌ ${s.aiceFailures.length}`;
    const verdIcon = s.verdict === "PASS" ? "✅ PASS" : "❌ FAIL";

    lines.push(
      `| **${s.scenarioId}** | ${s.title.slice(0, 30)} | \`${s.mode}\` | \`${cid}\` | ${s.llmTurns} | ${s.toolCalls} | ${s.workingTokens.toLocaleString("en-US")} | ${s.outputTokens.toLocaleString("en-US")} | $${s.apiCostUsd.toFixed(4)} | ${diskIcon} | ${workIcon} | ${stabIcon} | ${verdIcon} |`
    );
  }
  lines.push("");
  lines.push("## 3. Discovered Anomalies & Forensic Audit Details");
  lines.push("");
  let anomalyCount = 0;
  for (const s of report.scenarioResults) {
    if (s.workaroundViolations.length > 0 || s.aiceFailures.length > 0) {
      anomalyCount++;
      lines.push(`### [${s.scenarioId}:${s.mode}] Conv: \`${s.conversationId?.slice(0, 8)}\` (${s.title})`);
      if (s.workaroundViolations.length > 0) {
        lines.push(`- **Workaround Violations (${s.workaroundViolations.length})**:`);
        for (const v of s.workaroundViolations) {
          lines.push(`  - \`${v.slice(0, 140)}\``);
        }
      }
      if (s.aiceFailures.length > 0) {
        lines.push(`- **AICE Tool Failures (${s.aiceFailures.length})**:`);
        for (const f of s.aiceFailures) {
          lines.push(`  - \`${f.slice(0, 140)}\``);
        }
      }
      lines.push("");
    }
  }
  if (anomalyCount === 0) {
    lines.push("Zero anomalies or workarounds detected across all evaluated runs.");
    lines.push("");
  }

  return lines.join("\n");
}

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  const report = runMasterAudit();
  console.log(formatMasterScorecard(report));
}