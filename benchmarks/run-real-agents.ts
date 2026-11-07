/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live Real AI Agent Benchmark Runner (`agy -p` against isolated workspaces on disk).
 * Usage:
 *   npx tsx benchmarks/run-real-agents.ts               # Run all 10 scenarios (30 agent sessions)
 *   npx tsx benchmarks/run-real-agents.ts RW-01 RW-05   # Run specific scenarios
 *   npx tsx benchmarks/run-real-agents.ts RW-05:aice_with_idioms
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
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aice-${spec.id.toLowerCase()}-${mode}-`));
  const activeIdioms: Record<string, unknown> = {};
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const { idioms: tsIdioms } = buildIdiomRegistryForLanguage("ts");
    activeIdioms.$guard_band_step = tsIdioms.$guard_band_step;
  }
  for (const f of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === f.languageId);
    if (!langSpec) throw new Error(`Unknown languageId ${f.languageId}`);
    const { idioms } = buildIdiomRegistryForLanguage(f.languageId);
    if (!CODE_LANGS.has(f.languageId)) {
      activeIdioms[langSpec.idiomName] = idioms[langSpec.idiomName];
    }
    const ast = parse(f.aiceWithIdioms, `${f.fileName}.aice`);
    const expanded = expandModuleIdioms(ast, idioms);
    const native = emitTarget(expanded, langSpec.target, { watermark: false });
    fs.writeFileSync(path.join(dir, f.fileName), native, "utf-8");
  }
  if (mode === "aice_with_idioms") {
    fs.writeFileSync(
      path.join(dir, "aice.config.json"),
      JSON.stringify({ version: 2, idioms: activeIdioms }, null, 2),
    );
  }
  return dir;
}

function describeFileTargetUpdatePlainEnglish(
  f: RealWorldBenchmarkSpec["files"][number],
  isNewFeature: boolean,
): string {
  const src = f.updatedTargetSymbolAiceWithIdioms;
  if (CODE_LANGS.has(f.languageId)) {
    const fnMatch = src.match(
      /pub fn (\w+)\((\w+):int\) -> int:\n\s+(\w+) ::= \2 \* (\d+) \+ (\d+)/,
    );
    const bands = [...src.matchAll(/\(\w+,\s*(\d+),\s*(\d+),\s*(\d+)\)/g)].map(
      (m) => `(min=${m[1]}, max=${m[2]}, step=${m[3]})`,
    );
    if (fnMatch) {
      const [, fnName, param, stateVar, scale, offset] = fnMatch;
      if (isNewFeature) {
        return `   - ${f.fileName}: add public function ${fnName}(${param}: int) -> int after ${f.targetSymbol}: set ${stateVar} = ${param} * ${scale} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bands.join(", ")}, and return ${stateVar}.`;
      }
      return `   - ${f.fileName}: update function ${f.targetSymbol}(${param}: int) -> int: set ${stateVar} = ${param} * ${scale} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bands.join(", ")}, and return ${stateVar}.`;
    }
  }
  if (f.languageId === "tsx") {
    const compMatch = src.match(
      /component (\w+)\(\):\n\s+section\(class="kpi-section", id="([^"]+)"\)/,
    );
    const tiles = [...src.matchAll(/\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)].map(
      (m) => `(data-metric="${m[1]}", label="${m[2]}", value="${m[3]}")`,
    );
    if (compMatch) {
      const [, compName, secId] = compMatch;
      return isNewFeature
        ? `   - ${f.fileName}: add component ${compName} after ${f.targetSymbol} rendering section.kpi-section#${secId} with 3 KPI tiles: ${tiles.join(", ")}.`
        : `   - ${f.fileName}: update component ${f.targetSymbol} (section.kpi-section#${secId}) so its 3 KPI tiles are: ${tiles.join(", ")}.`;
    }
  }
  if (f.languageId === "css") {
    const selMatch = src.match(/style ([^\s{]+) \{/);
    const cards = [...src.matchAll(/\("([^"]+)",\s*"([^"]+)"\)/g)].map(
      (m) => `(padding: ${m[1]}, gap: ${m[2]})`,
    );
    const zMatch = src.match(/z-index:\s*(\d+)/);
    if (selMatch) {
      return isNewFeature
        ? `   - ${f.fileName}: add CSS rule ${selMatch[1]} after ${f.targetSymbol} with two flex-centered card blocks ${cards.join(" and ")} and z-index: ${zMatch ? zMatch[1] : 50}.`
        : `   - ${f.fileName}: update CSS rule ${f.targetSymbol} to two flex-centered card blocks ${cards.join(" and ")} and z-index: ${zMatch ? zMatch[1] : 10}.`;
    }
  }
  if (f.languageId === "html") {
    const secMatch = src.match(/section\(id="([^"]+)", class="panel"\)/);
    const rows = [...src.matchAll(/\("([^"]+)",\s*"([^"]+)",\s*"([^"]+)"\)/g)].map(
      (m) => `(data-key="${m[1]}", label="${m[2]}", value="${m[3]}")`,
    );
    if (secMatch) {
      return isNewFeature
        ? `   - ${f.fileName}: add <section id="${secMatch[1]}" class="panel"> after ${f.targetSymbol} with 2 metric rows: ${rows.join(" and ")}.`
        : `   - ${f.fileName}: update ${f.targetSymbol} (<section id="${secMatch[1]}" class="panel">) to 2 metric rows: ${rows.join(" and ")}.`;
    }
  }
  if (f.languageId === "twig") {
    const blkMatch = src.match(/block\(name="([^"]+)"\)/);
    const rows = [...src.matchAll(/\("([^"]+)",\s*(\w+)\)/g)].map(
      (m) => `(label="${m[1]}", variable=${m[2]})`,
    );
    if (blkMatch) {
      return isNewFeature
        ? `   - ${f.fileName}: add Twig block "${blkMatch[1]}" after "${f.targetSymbol}" with 2 summary rows: ${rows.join(" and ")}.`
        : `   - ${f.fileName}: update Twig block "${f.targetSymbol}" to 2 summary rows: ${rows.join(" and ")}.`;
    }
  }
  if (f.languageId === "json" || f.languageId === "yaml") {
    const keyMatch = src.match(/pub const (\w+) =/);
    const entries = [...src.matchAll(/\("([^"]+)",\s*(\d+),\s*(\d+)\)/g)].map((m) =>
      f.languageId === "json"
        ? `(id="${m[1]}", threshold=${m[2]}, limit=${m[3]})`
        : `(worker="${m[1]}", port=${m[2]}, concurrency=${m[3]})`,
    );
    if (keyMatch) {
      const schemaHint =
        f.languageId === "json"
          ? "policy rule entries (retaining standard retries/enabled/windowSec fields)"
          : "service tier entries (retaining standard replicas/healthIntervalSec/tlsRequired fields)";
      return isNewFeature
        ? `   - ${f.fileName}: add top-level key "${keyMatch[1]}" (config.${keyMatch[1]}) after ${f.targetSymbol} with 2 ${schemaHint}: ${entries.join(" and ")}.`
        : `   - ${f.fileName}: update top-level key ${f.targetSymbol} to 2 ${schemaHint}: ${entries.join(" and ")}.`;
    }
  }
  throw new Error(`Unhandled file spec: ${f.fileName}`);
}

export function buildTaskSpecText(spec: RealWorldBenchmarkSpec): string {
  const isNewFeature = spec.scenario === "new_feature";
  const updateLines = spec.files.map((f) => describeFileTargetUpdatePlainEnglish(f, isNewFeature));

  const patternLines: string[] = [];
  const presentLangs = new Set(spec.files.map((f) => f.languageId));
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const codeFiles = spec.files
      .filter((f) => CODE_LANGS.has(f.languageId))
      .map((f) => f.fileName)
      .join(", ");
    patternLines.push(
      `   - Code files (${codeFiles}): in every clamping band step across all functions in the workspace (including updated/newly added ones), change the step increment at the end of each band from "+ step" to "+ step + 1".`,
    );
  }
  if (presentLangs.has("tsx")) {
    patternLines.push(
      `   - TSX files: change every KPI tile container class from "kpi-tile" to "kpi-tile-v2".`,
    );
  }
  if (presentLangs.has("css")) {
    patternLines.push(
      `   - CSS files: change every card border-radius from 8px to 12px.`,
    );
  }
  if (presentLangs.has("html")) {
    patternLines.push(
      `   - HTML files: change every metric row container class from "metric-row" to "metric-row-v2".`,
    );
  }
  if (presentLangs.has("twig")) {
    patternLines.push(
      `   - Twig files: change every summary row container class from "summary-row" to "summary-row-v2".`,
    );
  }
  if (presentLangs.has("json")) {
    patternLines.push(
      `   - JSON files: in every policy rule entry across the file, change retries from 3 to 5 and windowSec from 60 to 120.`,
    );
  }
  if (presentLangs.has("yaml")) {
    patternLines.push(
      `   - YAML files: in every service tier entry across the file, change replicas from 3 to 4 and healthIntervalSec from 15 to 10.`,
    );
  }

  return [
    `Engineering Task (${spec.id}: ${spec.title}):`,
    `1. Target Symbol Updates:`,
    ...updateLines,
    `2. Delete Obsolete Symbols:`,
    `   - Locate and delete every obsolete/legacy/deprecated function, component, CSS rule, HTML section, Twig block, or config key across the workspace (any symbol whose name contains "legacy", "deprecated", or "obsolete").`,
    `3. Multi-File Pattern Refactor across all functions/elements/rules in the workspace:`,
    ...patternLines,
  ].join("\n");
}

function buildPrompt(spec: RealWorldBenchmarkSpec, mode: RealAgentMode, dir: string): string {
  const taskText = buildTaskSpecText(spec);

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      `Environment: WITHOUT AICE (Native IDE Tools Only).`,
      `Allowed tools: grep_search, find_by_name, view_file, replace_file_content. Do NOT use run_command or aice.`,
      taskText,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  if (mode === "aice_no_idioms") {
    return [
      `Workspace: ${dir}`,
      `Environment: AICE On-the-Fly WITHOUT Idioms (Pure AICE CLI).`,
      `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use view_file, grep_search, replace_file_content, python/python3/node/sed/awk/cat, --help, --dry-run, or $idiom macros.`,
      `AICE CLI Reference (Pure AICE Mode):`,
      `- Step 1 — Inspect all workspace symbol headers and compact pure-AICE slices in 1 command: \`cd ${dir} && aice context . -s "*" --no-idioms\` (if output is truncated on a 15-file workspace, pass file subsets \`aice context <f1> <f2> ... -s "*" --no-idioms\`).`,
      `- Step 2 — Apply all target updates, insertions, obsolete deletions, and refactored symbols in 1 atomic inline batch command (keep compact 1-line \`if v < min: v = min; if v > max: v = max; v = v + step\` and \`div(...) { span(...): ...; strong(...): ... }\` AICE syntax from context; pass JSON directly inside single quotes without temporary files or --dry-run): \`cd ${dir} && aice splice --no-idioms --batch '[{"file":"<file>","symbol":"<sym>","code":"<pure AICE>"},{"file":"<file>","symbol":"<newSym>","insertAfter":"<targetSym>","code":"<pure AICE>"},{"file":"<file>","symbol":"<obsoleteSym>","delete":true}]'\``,
      taskText,
      `Reply DONE immediately once \`aice splice --no-idioms --batch\` succeeds (do not run extra verification commands).`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    `Environment: AICE On-the-Fly WITH Project Idioms (\`aice.config.json\` configured in workspace).`,
    `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--idioms\`. Do NOT use view_file, grep_search, replace_file_content, python/python3/node/sed/awk/cat, --help, or --dry-run.`,
    `AICE CLI Reference (Idiom Mode):`,
    `- Step 1 — Inspect all workspace file \`// symbols:\` headers (which list every symbol in each file including obsolete ones), selected target/anchor symbol bodies (with \`$idiom\` calls), and active idiom definitions in 1 command: \`cd ${dir} && aice context . -s "<comma-separated target/anchor symbols from task>" --idioms\``,
    `- Step 2 — Apply surgical target updates/insertions (using active \`$idiom(...)\` calls), obsolete symbol deletions, and workspace-wide idiom template updates in 1 atomic inline batch command (note: in JSON/YAML idiom templates, keep \`{ key: $0, ... }\` object syntax; in multi-line code/CSS templates, separate lines with \`\\n\`): \`cd ${dir} && aice splice --idioms --batch '[{"file":"<file>","symbol":"<sym>","code":"<AICE with $idiom>"},{"file":"<file>","symbol":"<newSym>","insertAfter":"<targetSym>","code":"<AICE with $idiom>"},{"file":"<file>","symbol":"<obsoleteSym>","delete":true},{"name":"$<idiom_name>","template":"<updated template>"}]'\``,
    taskText,
    `Reply DONE immediately once \`aice splice --idioms --batch\` succeeds (do not run extra verification commands).`,
  ].join("\n\n");
}

function verifyWorkspaceOnDisk(
  spec: RealWorldBenchmarkSpec,
  dir: string,
): { verified: boolean; zeroAice: boolean; details: string[] } {
  const details: string[] = [];
  const aiceFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".aice"));
  const zeroAice = aiceFiles.length === 0;
  if (!zeroAice) details.push(`Found .aice files: ${aiceFiles.join(",")}`);

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
      const explicitPlusOnes = (content.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length;
      const expectedSteps = [
        ...f.aiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g),
        ...f.updatedTargetSymbolAiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g),
      ].map((m) => Number(m[1]) + 1);
      const foldedSet = new Set(expectedSteps);
      const foldedMatches = [...content.matchAll(/\+\s*(\d+)\b/g)].filter((m) =>
        foldedSet.has(Number(m[1])),
      ).length;
      const totalRefactored = Math.max(explicitPlusOnes, foldedMatches);
      if (totalRefactored < minSymCount * 3) {
        details.push(
          `${f.fileName}: expected >= ${minSymCount * 3} refactored band steps, got ${totalRefactored}`,
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

  return { verified: details.length === 0 && zeroAice, zeroAice, details };
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
    zeroAiceFilesLeftOnDisk: check.zeroAice,
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
      runAgentBenchmarkMode(spec, "without_aice"),
      runAgentBenchmarkMode(spec, "aice_no_idioms"),
      runAgentBenchmarkMode(spec, "aice_with_idioms"),
    ]);
    existing[spec.id] = { without_aice: w, aice_no_idioms: n, aice_with_idioms: i };
    fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    console.log(`${spec.id} DONE:`);
    console.log(
      `  without_aice:     turns=${w.llmTurns} tools=${w.toolCalls} workTok=${w.workingTokens} outTok=${w.outputTokens} billTok=${w.billableTokens} ok=${w.verifiedOnDisk}`,
    );
    console.log(
      `  aice_no_idioms:   turns=${n.llmTurns} tools=${n.toolCalls} workTok=${n.workingTokens} outTok=${n.outputTokens} billTok=${n.billableTokens} ok=${n.verifiedOnDisk}`,
    );
    console.log(
      `  aice_with_idioms: turns=${i.llmTurns} tools=${i.toolCalls} workTok=${i.workingTokens} outTok=${i.outputTokens} billTok=${i.billableTokens} ok=${i.verifiedOnDisk}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
