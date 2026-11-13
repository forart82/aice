import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { estimateTokens } from "../src/tokenomics/index.js";
import { computeRealApiCostUsd } from "../benchmarks/real-agent-suite.js";

export interface AuditOptions {
  conversationId: string;
  mode?: "without_aice" | "aice_no_idioms" | "aice_with_idioms";
  runnerReported?: {
    llmTurns?: number;
    toolCalls?: number;
    workingTokens?: number;
    toolCallTokens?: number;
    toolResultTokens?: number;
    outputTokens?: number;
    inputTokens?: number;
    cacheReadTokens?: number;
    apiCostUsd?: number;
    verifiedOnDisk?: boolean;
  };
}

export interface AuditResult {
  conversationId: string;
  transcriptExists: boolean;
  totalEntries: number;
  plannerResponses: number;
  totalToolCalls: number;
  toolUsageBreakdown: Record<string, number>;
  violations: Array<{
    stepIndex: number;
    type: string;
    details: string;
    command?: string;
  }>;
  aiceFailures: Array<{
    stepIndex: number;
    command: string;
    error: string;
  }>;
  tokenAccounting: {
    inputTokens: number;
    outputTokens: number;
    cacheReadTokens: number;
    bpeOutputTokensCl100k: number;
    bpeOutputTokensO200k: number;
    toolCallTokensCl100k: number;
    toolResultTokensCl100k: number;
    toolCallTokensO200k: number;
    toolResultTokensO200k: number;
    computedWorkingTokens: number;
    computedBillableTokens: number;
    computedApiTotalTokens: number;
    computedApiCostUsd: number;
  };
  discrepancies: string[];
  integrityVerdict: "PASS" | "FAIL";
}

export function auditTranscript(options: AuditOptions): AuditResult {
  const { conversationId, mode = "aice_no_idioms", runnerReported } = options;
  const transcriptPath = path.join(
    os.homedir(),
    ".gemini/antigravity-cli/brain",
    conversationId,
    ".system_generated/logs/transcript.jsonl"
  );

  const res: AuditResult = {
    conversationId,
    transcriptExists: false,
    totalEntries: 0,
    plannerResponses: 0,
    totalToolCalls: 0,
    toolUsageBreakdown: {},
    violations: [],
    aiceFailures: [],
    tokenAccounting: {
      inputTokens: 0,
      outputTokens: 0,
      cacheReadTokens: 0,
      bpeOutputTokensCl100k: 0,
      bpeOutputTokensO200k: 0,
      toolCallTokensCl100k: 0,
      toolResultTokensCl100k: 0,
      toolCallTokensO200k: 0,
      toolResultTokensO200k: 0,
      computedWorkingTokens: 0,
      computedBillableTokens: 0,
      computedApiTotalTokens: 0,
      computedApiCostUsd: 0,
    },
    discrepancies: [],
    integrityVerdict: "PASS",
  };

  if (!fs.existsSync(transcriptPath)) {
    res.discrepancies.push(`Transcript file not found at ${transcriptPath}`);
    res.integrityVerdict = "FAIL";
    return res;
  }
  res.transcriptExists = true;

  const rawLines = fs
    .readFileSync(transcriptPath, "utf-8")
    .trim()
    .split("\n")
    .map((l, idx) => {
      try {
        return JSON.parse(l);
      } catch (err) {
        res.discrepancies.push(`JSON parse error at line ${idx + 1}`);
        return null;
      }
    })
    .filter(Boolean);

  res.totalEntries = rawLines.length;

  let totalOutputText = "";
  const stepMap = new Map<number, any>();

  for (const entry of rawLines) {
    if (typeof entry.step_index === "number") {
      stepMap.set(entry.step_index, entry);
    }
  }

  for (const entry of rawLines) {
    const stepIdx = entry.step_index ?? -1;

    if (entry.type === "PLANNER_RESPONSE") {
      res.plannerResponses++;
      res.tokenAccounting.inputTokens += entry.input_tokens || 0;
      res.tokenAccounting.outputTokens += entry.output_tokens || 0;
      res.tokenAccounting.cacheReadTokens += entry.cache_read_tokens || 0;

      if (entry.content) {
        totalOutputText += entry.content + "\n";
      }
      if (entry.thinking) {
        totalOutputText += entry.thinking + "\n";
      }

      if (Array.isArray(entry.tool_calls)) {
        res.totalToolCalls += entry.tool_calls.length;
        for (const tc of entry.tool_calls) {
          const name = tc.name || "unknown";
          res.toolUsageBreakdown[name] = (res.toolUsageBreakdown[name] || 0) + 1;

          const argsStr = JSON.stringify(tc.args || {});
          res.tokenAccounting.toolCallTokensCl100k += estimateTokens(argsStr, "cl100k_base");
          res.tokenAccounting.toolCallTokensO200k += estimateTokens(argsStr, "o200k_base");

          // Audit forbidden workarounds
          if (name === "run_command" || name === "bash" || name === "execute_command") {
            const cmd = tc.args?.CommandLine || tc.args?.command || "";
            // Check for forbidden file writes
            if (
              /cat\s*<<\s*['"]?EOF/i.test(cmd) ||
              /cat\s*>[^>]/i.test(cmd) ||
              /echo\s+.*>[^>]/i.test(cmd) ||
              /python[3]?\s+-c\s+.*open\(/i.test(cmd) ||
              /node\s+-e\s+.*writeFileSync/i.test(cmd)
            ) {
              res.violations.push({
                stepIndex: stepIdx,
                type: "FORBIDDEN_FILE_WRITE_WORKAROUND",
                details: `Command attempts shell file-writing: ${cmd.slice(0, 100)}`,
                command: cmd,
              });
            }

            // Check for forbidden discovery tools
            if (/\b(?:sed|grep|egrep|fgrep)\b/.test(cmd) && !/node_modules|\.git/.test(cmd)) {
              res.violations.push({
                stepIndex: stepIdx,
                type: "FORBIDDEN_DISCOVERY_WORKAROUND",
                details: `Command uses forbidden shell discovery (grep/sed): ${cmd.slice(0, 100)}`,
                command: cmd,
              });
            }

            // Check for AICE commands
            if (/\baice\b/.test(cmd)) {
              // Check corresponding result in stepMap or rawLines
              const nextStep = stepMap.get(stepIdx + 1);
              if (nextStep && nextStep.status === "ERROR") {
                res.aiceFailures.push({
                  stepIndex: stepIdx,
                  command: cmd,
                  error: nextStep.content || "Error status in result step",
                });
              } else if (nextStep && typeof nextStep.content === "string") {
                if (
                  nextStep.content.includes("Command exited with code") &&
                  !nextStep.content.includes("Command exited with code 0")
                ) {
                  res.aiceFailures.push({
                    stepIndex: stepIdx,
                    command: cmd,
                    error: nextStep.content.slice(0, 300),
                  });
                }
              }
            }
          }

          // In AICE modes, native file editing tools are forbidden
          if (mode !== "without_aice") {
            if (
              name === "edit_file" ||
              name === "write_file" ||
              name === "replace_file_content"
            ) {
              res.violations.push({
                stepIndex: stepIdx,
                type: "FORBIDDEN_NATIVE_FILE_TOOL",
                details: `Used native tool ${name} instead of AICE splice/create in mode ${mode}`,
              });
            }
          }
        }
      }
    } else if (entry.type === "GENERIC" && typeof entry.content === "string") {
      res.tokenAccounting.toolResultTokensCl100k += estimateTokens(entry.content, "cl100k_base");
      res.tokenAccounting.toolResultTokensO200k += estimateTokens(entry.content, "o200k_base");
    }
  }

  res.tokenAccounting.bpeOutputTokensCl100k = estimateTokens(totalOutputText, "cl100k_base");
  res.tokenAccounting.bpeOutputTokensO200k = estimateTokens(totalOutputText, "o200k_base");

  res.tokenAccounting.computedWorkingTokens =
    res.tokenAccounting.toolCallTokensCl100k +
    res.tokenAccounting.toolResultTokensCl100k +
    res.tokenAccounting.outputTokens;

  res.tokenAccounting.computedBillableTokens =
    res.tokenAccounting.inputTokens + res.tokenAccounting.outputTokens;

  res.tokenAccounting.computedApiTotalTokens =
    res.tokenAccounting.inputTokens +
    res.tokenAccounting.cacheReadTokens +
    res.tokenAccounting.outputTokens;

  res.tokenAccounting.computedApiCostUsd = computeRealApiCostUsd(
    res.tokenAccounting.inputTokens,
    res.tokenAccounting.cacheReadTokens,
    res.tokenAccounting.outputTokens
  );

  // Compare with runner reported metrics if provided
  if (runnerReported) {
    if (runnerReported.llmTurns !== undefined && runnerReported.llmTurns !== res.plannerResponses) {
      res.discrepancies.push(
        `Turn mismatch: runner reported ${runnerReported.llmTurns}, watcher counted ${res.plannerResponses}`
      );
    }
    if (runnerReported.toolCalls !== undefined && runnerReported.toolCalls !== res.totalToolCalls) {
      res.discrepancies.push(
        `Tool call mismatch: runner reported ${runnerReported.toolCalls}, watcher counted ${res.totalToolCalls}`
      );
    }
    if (
      runnerReported.inputTokens !== undefined &&
      runnerReported.inputTokens !== res.tokenAccounting.inputTokens
    ) {
      res.discrepancies.push(
        `Input token mismatch: runner reported ${runnerReported.inputTokens}, watcher counted ${res.tokenAccounting.inputTokens}`
      );
    }
    if (
      runnerReported.outputTokens !== undefined &&
      runnerReported.outputTokens !== res.tokenAccounting.outputTokens
    ) {
      res.discrepancies.push(
        `Output token mismatch: runner reported ${runnerReported.outputTokens}, watcher counted ${res.tokenAccounting.outputTokens}`
      );
    }
    if (
      runnerReported.workingTokens !== undefined &&
      Math.abs(runnerReported.workingTokens - res.tokenAccounting.computedWorkingTokens) > 10
    ) {
      res.discrepancies.push(
        `Working token discrepancy: runner reported ${runnerReported.workingTokens}, watcher calculated ${res.tokenAccounting.computedWorkingTokens}`
      );
    }
  }

  if (res.violations.length > 0 || res.aiceFailures.length > 0 || res.discrepancies.length > 0) {
    res.integrityVerdict = "FAIL";
  } else {
    res.integrityVerdict = "PASS";
  }
  return res;
}

import { fileURLToPath } from "node:url";

const currentFile = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === path.resolve(currentFile)) {
  const convId = process.argv[2];
  const mode = (process.argv[3] || "aice_no_idioms") as any;
  if (!convId) {
    console.error("Usage: npx tsx scripts/audit-bench-transcript.ts <conversationId> [mode]");
    process.exit(1);
  }
  const result = auditTranscript({ conversationId: convId, mode });
  console.log(JSON.stringify(result, null, 2));
}