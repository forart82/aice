/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live Real AI Agent Benchmark Runner (`agy -p` against isolated workspaces on disk).
 * Usage:
 *   npx tsx benchmarks/run-real-agents.ts               # Run all 10 scenarios (30 agent sessions)
 *   npx tsx benchmarks/run-real-agents.ts RW-01 RW-05   # Run specific scenarios
 *   npx tsx benchmarks/run-real-agents.ts RW-05:ail_with_idioms
 */

import { execFile } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { parse } from "../src/core/parser.js";
import { emitTarget } from "../src/emitters/index.js";
import { expandModuleIdioms } from "../src/idioms/index.js";
import { estimateTokens } from "../src/tokenomics/index.js";
import {
  type BenchmarkLanguageId,
  buildIdiomRegistryForLanguage,
  OFFLINE_BENCHMARKS,
  type RealWorldBenchmarkSpec,
  SUPPORTED_BENCHMARK_LANGUAGES,
} from "./offline-suite.js";
import type { RealAgentMode, RealAgentRunMetrics } from "./real-agent-suite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

const CODE_LANGS = new Set<BenchmarkLanguageId>([
  "ts",
  "js",
  "py",
  "go",
  "rs",
  "cpp",
  "cs",
  "kt",
  "php",
]);

function setupWorkspace(spec: RealWorldBenchmarkSpec, mode: RealAgentMode): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `ail-${spec.id.toLowerCase()}-${mode}-`));
  const allIdioms: Record<string, unknown> = {};
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const { idioms: tsIdioms } = buildIdiomRegistryForLanguage("ts");
    Object.assign(allIdioms, tsIdioms);
  }
  for (const f of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === f.languageId);
    if (!langSpec) throw new Error(`Unknown languageId ${f.languageId}`);
    const { idioms } = buildIdiomRegistryForLanguage(f.languageId);
    Object.assign(allIdioms, idioms);
    const ast = parse(f.ailWithIdioms, `${f.fileName}.ail`);
    const expanded = expandModuleIdioms(ast, idioms);
    const native = emitTarget(expanded, langSpec.target, { watermark: false });
    fs.writeFileSync(path.join(dir, f.fileName), native, "utf-8");
  }
  if (mode === "ail_with_idioms") {
    fs.writeFileSync(
      path.join(dir, "ail.config.json"),
      JSON.stringify({ version: 2, idioms: allIdioms }, null, 2),
    );
  }
  return dir;
}

function buildTaskSpecText(spec: RealWorldBenchmarkSpec): string {
  const isNewFeature = spec.scenario === "new_feature";
  const updateLines: string[] = [];
  const deleteLines: string[] = [];

  for (const f of spec.files) {
    const compactTargetAil = f.updatedTargetSymbolAilWithIdioms
      .replace(
        /\$[a-z_]+_band_step|\$clamp_cart_line|\$enforce_quota_band|\$bounded_quorum_step|\$advance_wal_cursor|\$solve_axis_impulse|\$settle_ledger_window|\$score_risk_signal|\$round_money_band/g,
        "$guard_band_step",
      )
      .replace(/\n/g, "\\n");
    if (isNewFeature) {
      updateLines.push(`   - ${f.fileName} (insertAfter "${f.targetSymbol}"): ${compactTargetAil}`);
    } else {
      updateLines.push(`   - ${f.fileName} (symbol "${f.targetSymbol}"): ${compactTargetAil}`);
    }
    if (f.obsoleteSymbol) {
      deleteLines.push(`   - ${f.fileName}: delete "${f.obsoleteSymbol}"`);
    }
  }

  const patternLines: string[] = [];
  const presentLangs = new Set(spec.files.map((f) => f.languageId));
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const codeFiles = spec.files
      .filter((f) => CODE_LANGS.has(f.languageId))
      .map((f) => f.fileName)
      .join(", ");
    patternLines.push(
      `   - Code files (${codeFiles}): change every clamping band step increment from "+ step" to "+ step + 1" (idiom $guard_band_step template: "if $0 < $1:\\n  $0 = $1\\nif $0 > $2:\\n  $0 = $2\\n$0 = $0 + $3 + 1").`,
    );
  }
  if (presentLangs.has("tsx")) {
    patternLines.push(
      `   - TSX files: change class "kpi-tile" to "kpi-tile-v2" (idiom $tsx_kpi_tile template: "div(class=\\"kpi-tile-v2\\", data-metric=$0) { span(class=\\"kpi-label\\"): $1; strong(class=\\"kpi-value\\"): $2 }").`,
    );
  }
  if (presentLangs.has("css")) {
    patternLines.push(
      `   - CSS files: change border-radius: 8px to border-radius: 12px (idiom $css_card template: "fl-center\\npadding: $0\\ngap: $1\\nborder-radius: 12px").`,
    );
  }
  if (presentLangs.has("html")) {
    patternLines.push(
      `   - HTML files: change class "metric-row" to "metric-row-v2" (idiom $html_metric_row template: "div(class=\\"metric-row-v2\\", data-key=$0) { span(class=\\"metric-label\\"): $1; strong(class=\\"metric-val\\"): $2 }").`,
    );
  }
  if (presentLangs.has("twig")) {
    patternLines.push(
      `   - Twig files: change class "summary-row" to "summary-row-v2" (idiom $twig_summary_line template: "div(class=\\"summary-row-v2\\") { span(class=\\"summary-lbl\\"): $0; strong(class=\\"summary-val\\"): $1 }").`,
    );
  }
  if (presentLangs.has("json")) {
    patternLines.push(
      `   - JSON files: change retries: 3, windowSec: 60 to retries: 5, windowSec: 120 (idiom $json_policy_rule template: "{ id: $0, threshold: $1, limit: $2, retries: 5, enabled: true, windowSec: 120 }").`,
    );
  }
  if (presentLangs.has("yaml")) {
    patternLines.push(
      `   - YAML files: change replicas: 3, healthIntervalSec: 15 to replicas: 4, healthIntervalSec: 10 (idiom $yaml_service_tier template: "{ worker: $0, port: $1, concurrency: $2, replicas: 4, healthIntervalSec: 10, tlsRequired: true }").`,
    );
  }

  return [
    `Task on workspace (${spec.id}: ${spec.title}):`,
    `1. Target Symbol Updates:`,
    ...updateLines,
    `2. Delete Obsolete Symbols:`,
    ...deleteLines,
    `3. Multi-File Pattern Refactor across all functions/elements/rules in the workspace:`,
    ...patternLines,
  ].join("\n");
}

function buildPrompt(spec: RealWorldBenchmarkSpec, mode: RealAgentMode, dir: string): string {
  const taskText = buildTaskSpecText(spec);
  const targetSyms = spec.files.map((f) => f.targetSymbol).join(",");
  const allRefactorSyms = spec.files.flatMap((f) => f.refactorSymbols).join(",");
  const fileNames = spec.files.map((f) => f.fileName).join(", ");
  const isNewFeature = spec.scenario === "new_feature";

  if (mode === "without_ail") {
    return [
      `Workspace: ${dir}`,
      `Mode: WITHOUT AIL (Native Tools Only). Do NOT use run_command or ail. Use ONLY grep_search, view_file, and replace_file_content.`,
      taskText,
      `Execute in steps:`,
      `- Step 1: Call grep_search in ${dir} to locate the target symbols and obsolete symbols.`,
      `- Step 2: Call view_file to read the workspace files (${fileNames}).`,
      `- Step 3: Call replace_file_content on each file to apply Target Symbol Updates (1), Delete Obsolete Symbols (2), and Multi-File Pattern Refactor (3).`,
      `- Step 4: Reply DONE.`,
    ].join("\n");
  }

  if (mode === "ail_no_idioms") {
    return [
      `Workspace: ${dir}`,
      `Mode: AIL WITHOUT IDIOMS (Pure AIL CLI Only). Use ONLY run_command (WaitMsBeforeAsync: 10000) in ${dir}. Do NOT use python3, view_file, grep_search, replace_file_content, or $idioms.`,
      taskText,
      `Execute in exact 3 tool-call turns:`,
      `- Turn 1: Call run_command (WaitMsBeforeAsync: 10000): cd ${dir} && ail context . -s "${allRefactorSyms}" --no-idioms`,
      `- Turn 2: Call run_command (WaitMsBeforeAsync: 10000) once in ${dir}: cd ${dir} && ail splice --no-idioms --batch '[...]' to apply Target Symbol Updates (1) in pure AIL (expand all $idioms into pure AIL statements/expressions with the refactored pattern from (3); use ${isNewFeature ? '"insertAfter"' : '"symbol"'}) and Delete Obsolete Symbols (2) ({"file":"...","symbol":"...","delete":true}).`,
      `- Turn 3: Call run_command (WaitMsBeforeAsync: 10000) once in ${dir}: cd ${dir} && ail splice --no-idioms --batch '[...]' to apply Multi-File Pattern Refactor (3) across the remaining symbols in pure AIL.`,
      `- Turn 4: Reply DONE.`,
    ].join("\n");
  }

  return [
    `Workspace: ${dir}`,
    `Mode: AIL WITH IDIOMS (AIL CLI + Project Idioms). Use ONLY run_command (WaitMsBeforeAsync: 10000) in ${dir}. Do NOT use python3, view_file, grep_search, or replace_file_content.`,
    taskText,
    `Execute in exact 2 tool-call turns:`,
    `- Turn 1: Call run_command (WaitMsBeforeAsync: 10000): cd ${dir} && ail context . -s "${targetSyms}" --idioms`,
    `- Turn 2: Call run_command (WaitMsBeforeAsync: 10000) once in ${dir}: cd ${dir} && ail splice --idioms --batch '[...]' (applying Target Symbol Updates (1) using ${isNewFeature ? '"insertAfter"' : '"symbol"'} and $idiom calls, plus Delete Obsolete Symbols (2) with {"file":"...","symbol":"...","delete":true}) && ail idioms update --batch '[{"name":"$...","template":"..."}]' (applying Multi-File Pattern Refactor (3) for each idiom in the workspace).`,
    `- Turn 3: Reply DONE.`,
  ].join("\n");
}

function verifyWorkspaceOnDisk(
  spec: RealWorldBenchmarkSpec,
  dir: string,
): { verified: boolean; zeroAil: boolean; details: string[] } {
  const details: string[] = [];
  const ailFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".ail"));
  const zeroAil = ailFiles.length === 0;
  if (!zeroAil) details.push(`Found .ail files: ${ailFiles.join(",")}`);

  for (const f of spec.files) {
    const content = fs.readFileSync(path.join(dir, f.fileName), "utf-8");
    if (f.obsoleteSymbol) {
      const cleanObs = f.obsoleteSymbol.replace(/^config\./, "").replace(/^[.#]/, "");
      if (content.includes(cleanObs) || content.includes(cleanObs.replace(/_/g, "-"))) {
        details.push(`${f.fileName}: obsoleteSymbol ${f.obsoleteSymbol} still present`);
      }
    }
    if (content.includes("namespace ::") || /public\s+static\s+\w+\s+public\s+/.test(content)) {
      details.push(`${f.fileName}: contains corrupted splice header/namespace`);
    }
    const minSymCount = f.refactorSymbols.length;
    if (CODE_LANGS.has(f.languageId)) {
      const stepPlusOnes = (content.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length;
      if (stepPlusOnes < minSymCount * 3) {
        details.push(
          `${f.fileName}: expected >= ${minSymCount * 3} refactored band steps, got ${stepPlusOnes}`,
        );
      }
    } else if (f.languageId === "tsx") {
      const c = (content.match(/kpi-tile-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing kpi-tile-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "css") {
      const c = (content.match(/12px/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing 12px border-radius (${c}/${minSymCount})`);
    } else if (f.languageId === "html") {
      const c = (content.match(/metric-row-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing metric-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "twig") {
      const c = (content.match(/summary-row-v2/g) || []).length;
      if (c < minSymCount)
        details.push(`${f.fileName}: missing summary-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "json") {
      const c = (content.match(/"retries":\s*5/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing retries: 5 (${c}/${minSymCount})`);
    } else if (f.languageId === "yaml") {
      const c = (content.match(/replicas:\s*4/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing replicas: 4 (${c}/${minSymCount})`);
    }
  }

  return { verified: details.length === 0 && zeroAil, zeroAil, details };
}

export async function runAgentBenchmarkMode(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
): Promise<RealAgentRunMetrics> {
  const dir = setupWorkspace(spec, mode);
  const prompt = buildPrompt(spec, mode, dir);
  const t0 = Date.now();
  const { stdout } = await execFileAsync(
    "agy",
    [
      "-p",
      prompt,
      "--add-dir",
      dir,
      "--model",
      "gemini-3.8-flash-low",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
    ],
    { maxBuffer: 25 * 1024 * 1024 },
  );
  const durationSeconds = Number(((Date.now() - t0) / 1000).toFixed(2));
  const parsed = JSON.parse(stdout);
  const convId: string = parsed.conversation_id;
  const transcriptPath = path.join(
    os.homedir(),
    ".gemini/antigravity-cli/brain",
    convId,
    ".system_generated/logs/transcript.jsonl",
  );
  const lines = fs
    .readFileSync(transcriptPath, "utf-8")
    .trim()
    .split("\n")
    .map((l) => JSON.parse(l));
  let llmTurns = 0;
  let toolCalls = 0;
  let inputTokens = 0;
  let outputTokens = 0;
  let cacheReadTokens = 0;
  let toolCallTokens = 0;
  let toolResultTokens = 0;
  for (const entry of lines) {
    if (entry.type === "PLANNER_RESPONSE") {
      llmTurns++;
      inputTokens += entry.input_tokens || 0;
      outputTokens += entry.output_tokens || 0;
      cacheReadTokens += entry.cache_read_tokens || 0;
      if (Array.isArray(entry.tool_calls)) {
        toolCalls += entry.tool_calls.length;
        for (const tc of entry.tool_calls) {
          toolCallTokens += estimateTokens(JSON.stringify(tc.args || {}));
        }
      }
    } else if (entry.type === "GENERIC" && typeof entry.content === "string") {
      toolResultTokens += estimateTokens(entry.content);
    }
  }
  const check = verifyWorkspaceOnDisk(spec, dir);
  if (!check.verified) {
    console.error(`[WARN] ${spec.id} ${mode} (${convId}) verification issues:`, check.details);
  }
  fs.rmSync(dir, { recursive: true, force: true });
  return {
    benchmarkId: spec.id,
    mode,
    conversationId: convId,
    llmTurns,
    toolCalls,
    workingTokens: toolCallTokens + toolResultTokens + outputTokens,
    toolCallTokens,
    toolResultTokens,
    outputTokens,
    inputTokens,
    cacheReadTokens,
    billableTokens: inputTokens + outputTokens,
    apiTotalTokens: inputTokens + cacheReadTokens + outputTokens,
    durationSeconds,
    verifiedOnDisk: check.verified,
    zeroAilFilesLeftOnDisk: check.zeroAil,
  };
}

async function main() {
  const targetIds = process.argv.slice(2);
  const outPath = path.resolve(__dirname, "real-agent-results.json");
  let existing: Record<string, Record<RealAgentMode, RealAgentRunMetrics>> = {};
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  }

  if (targetIds.some((t) => t.includes(":"))) {
    await Promise.all(
      targetIds.map(async (t) => {
        const [id, mode] = t.split(":") as [string, RealAgentMode];
        const spec = OFFLINE_BENCHMARKS.find((s) => s.id === id);
        if (!spec) throw new Error(`Unknown spec ${id}`);
        console.log(`Running ${id}:${mode}...`);
        const res = await runAgentBenchmarkMode(spec, mode);
        existing[id] = existing[id] || ({} as Record<RealAgentMode, RealAgentRunMetrics>);
        existing[id][mode] = res;
        console.log(
          `${id}:${mode} DONE -> turns=${res.llmTurns} tools=${res.toolCalls} workTok=${res.workingTokens} outTok=${res.outputTokens} billTok=${res.billableTokens} ok=${res.verifiedOnDisk}`,
        );
      }),
    );
    fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    return;
  }

  const specs = OFFLINE_BENCHMARKS.filter((s) =>
    targetIds.length === 0 ? true : targetIds.includes(s.id),
  );
  for (const spec of specs) {
    console.log(`Running ${spec.id} (${spec.title})...`);
    const [w, n, i] = await Promise.all([
      runAgentBenchmarkMode(spec, "without_ail"),
      runAgentBenchmarkMode(spec, "ail_no_idioms"),
      runAgentBenchmarkMode(spec, "ail_with_idioms"),
    ]);
    existing[spec.id] = { without_ail: w, ail_no_idioms: n, ail_with_idioms: i };
    fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`${spec.id} DONE:`);
    console.log(
      `  without_ail:     turns=${w.llmTurns} tools=${w.toolCalls} workTok=${w.workingTokens} outTok=${w.outputTokens} billTok=${w.billableTokens} ok=${w.verifiedOnDisk}`,
    );
    console.log(
      `  ail_no_idioms:   turns=${n.llmTurns} tools=${n.toolCalls} workTok=${n.workingTokens} outTok=${n.outputTokens} billTok=${n.billableTokens} ok=${n.verifiedOnDisk}`,
    );
    console.log(
      `  ail_with_idioms: turns=${i.llmTurns} tools=${i.toolCalls} workTok=${i.workingTokens} outTok=${i.outputTokens} billTok=${i.billableTokens} ok=${i.verifiedOnDisk}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
