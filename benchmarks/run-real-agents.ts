/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live Real AI Agent Benchmark Runner (`agy -p` against isolated workspaces on disk).
 * Usage:
 *   npx tsx benchmarks/run-real-agents.ts               # Run all scenarios with a fresh random seed
 *   npx tsx benchmarks/run-real-agents.ts --seed 918273 # Run with an explicit deterministic seed
 *   npx tsx benchmarks/run-real-agents.ts RW-01 RW-11   # Run specific scenarios
 *   npx tsx benchmarks/run-real-agents.ts RW-05:aice_with_idioms
 */

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import YAML from "yaml";
import ts from "../src/compat/typescript.js";
import { parse } from "../src/core/parser.js";
import { decompile } from "../src/decompiler/index.js";
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
import {
  computeRealApiCostUsd,
  type RealAgentMode,
  type RealAgentRunMetrics,
} from "./real-agent-suite.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

export const DEFAULT_ADVERSARIAL_SEED = 20261108;

export function generateFreshBenchmarkSeed(): number {
  return 10_000_000 + Math.floor(Math.random() * 89_999_999);
}

export function hashBenchmarkSeed(seed: number, key: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  const fullKey = `${key}:${seed}`;
  for (let i = 0; i < fullKey.length; i++) {
    h ^= fullKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

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

/**
 * RW-11: Genuine "Unfair / Hostile-to-AICE" Single-File, Zero-Idiom Scenario ("Lone Needle in a Decoy Haystack").
 * - 1 file (`ledger_reconciler.ts`) -> cross-file `--batch` gives zero advantage.
 * - 0 repeated project idioms (14 heterogeneous functions with distinct AST structures) -> `$idiom` mining/templates give zero advantage.
 * - Only 1 target function update (non-first, seeded) + 1 obsolete function deletion (`deprecatedLedgerCursor`).
 * - Decoy sentinel function (`verifyDecoySentinel_<hex>`) and decoy comment/string literal traps (`legacy_deprecated_obsolete_probe`).
 */
export const HOSTILE_LONE_NEEDLE_SPEC: RealWorldBenchmarkSpec = {
  id: "RW-11",
  title: "Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)",
  description:
    "Hostile-to-AICE single-file TypeScript ledger reconciler with 14 heterogeneous functions, 0 repeated project idioms, and decoy traps where cross-file batching and $idioms provide zero advantage.",
  scenario: "bug_fix",
  appSurface: "non_window",
  files: [
    {
      fileName: "ledger_reconciler.ts",
      languageId: "ts",
      aiceWithIdioms: [
        "type LedgerBatchHeader:",
        "  batchId:int",
        "  shardKey:int",
        "  epochSeconds:int",
        "  isSettled:bool",
        "",
        "pub fn computeBaseFee(amountCents:int) -> int:",
        "  ret (amountCents / 100) + 5",
        "",
        "pub fn validateAccountTier(tierCode:int) -> int:",
        "  if tierCode == 1:",
        "    ret 10",
        "  ret 25",
        "",
        "pub fn reconcileBatchWindow(windowTicks:int) -> int:",
        "  cursor ::= windowTicks * 3",
        "  if cursor < 0:",
        "    cursor = 0",
        "  ret cursor + 17",
        "",
        "pub fn estimateSettlementLag(hops:int) -> int:",
        "  lagMs ::= hops * 12",
        "  if lagMs > 500:",
        "    ret 500",
        "  ret lagMs",
        "",
        "pub fn scoreVelocityRisk(txCount:int) -> int:",
        "  riskScore ::= txCount * 7",
        "  if riskScore < 10:",
        "    riskScore = 10",
        "  ret riskScore + 9",
        "",
        "pub fn normalizeCurrencyScale(decimals:int) -> int:",
        "  if decimals <= 0:",
        "    ret 1",
        "  ret decimals * 10",
        "",
        "pub fn projectReserveBuffer(balanceCents:int) -> int:",
        "  reserveVal ::= balanceCents * 4",
        "  if reserveVal < 50:",
        "    reserveVal = 50",
        "  ret reserveVal + 23",
        "",
        "pub fn auditSequenceGap(expectedSeq:int) -> int:",
        "  ret (expectedSeq - 1) * 2",
        "",
        "pub fn computeRetryBackoffMs(attemptIdx:int) -> int:",
        "  waitMs ::= attemptIdx * 25",
        "  if waitMs > 1000:",
        "    ret 1000",
        "  ret waitMs",
        "",
        "pub fn partitionShardSlot(accountHash:int) -> int:",
        "  ret accountHash % 64",
        "",
        "pub fn deriveQuorumWeight(voterCount:int) -> int:",
        "  ret (voterCount * 2) + 1",
        "",
        "pub fn capDailyWithdrawal(requestedCents:int) -> int:",
        "  if requestedCents > 250000:",
        "    ret 250000",
        "  ret requestedCents",
        "",
        "pub fn deprecatedLedgerCursor(seed:int) -> int:",
        "  ret seed - 1",
      ].join("\n"),
      targetSymbol: "reconcileBatchWindow",
      updatedTargetSymbolAiceWithIdioms: [
        "pub fn reconcileBatchWindow(windowTicks:int) -> int:",
        "  cursor ::= windowTicks * 3 + 19",
        "  if cursor < 0:",
        "    cursor = 0",
        "  ret cursor + 640",
      ].join("\n"),
      refactorSymbols: [
        "computeBaseFee",
        "validateAccountTier",
        "estimateSettlementLag",
        "scoreVelocityRisk",
        "normalizeCurrencyScale",
        "projectReserveBuffer",
        "auditSequenceGap",
        "computeRetryBackoffMs",
        "reconcileBatchWindow",
        "partitionShardSlot",
        "deriveQuorumWeight",
        "capDailyWithdrawal",
      ],
      obsoleteSymbol: "deprecatedLedgerCursor",
    },
  ],
};

export const ALL_REAL_AGENT_BENCHMARKS: readonly RealWorldBenchmarkSpec[] = [
  ...OFFLINE_BENCHMARKS,
  HOSTILE_LONE_NEEDLE_SPEC,
];

export function computeFileDecoySpec(
  seed: number,
  benchmarkId: string,
  fileName: string,
): { hexSeed: string; decoyStep: number; fnName: string; commentTag: string } {
  const h = hashBenchmarkSeed(seed, `${benchmarkId}:${fileName}`);
  const hexSeed = (h & 0xffff).toString(16).padStart(4, "0");
  const decoyStep = 700 + (h % 250);
  return {
    hexSeed,
    decoyStep,
    fnName: `verifyDecoySentinel_${hexSeed}`,
    commentTag: `DECOY_SENTINEL_${hexSeed}: legacy_deprecated_obsolete_probe + ${decoyStep}`,
  };
}

export interface SeededFileMutationSpec {
  targetIdx: number;
  targetSymbol: string;
  plainEnglishLine: string;
  expectedTokens: string[];
  seededSteps?: [number, number, number];
}

/**
 * Procedurally selects a NON-FIRST target symbol (`targetIdx >= 1`) in the file
 * and generates seeded numeric parameters + a blind plain-English description that
 * identifies the symbol by its unique domain signature/attributes (never leaking the
 * symbol name and never using `@first` or "first").
 */
export function computeSeededFileMutation(
  seed: number,
  benchmarkId: string,
  f: RealWorldBenchmarkSpec["files"][number],
  isNewFeature: boolean,
): SeededFileMutationSpec {
  const h = hashBenchmarkSeed(seed, `${benchmarkId}:target:${f.fileName}`);
  const targetIdx =
    f.refactorSymbols.length > 1 ? 1 + (h % (f.refactorSymbols.length - 1)) : 0;
  const targetSymbol = f.refactorSymbols[targetIdx];
  const cleanSym = targetSymbol.replace(/^config\./, "").replace(/^[.#]/, "");

  if (benchmarkId === "RW-11") {
    const offset = 15 + ((h >>> 4) % 35);
    const finalAdd = 610 + ((h >>> 9) % 340);
    const floorMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)\\n\\s+if \\2 < (\\d+):\\n\\s+\\2 = \\4\\n\\s+ret \\2 \\+ (\\d+)`,
      ),
    );
    if (floorMatch) {
      const [, param, stateVar, scaleStr, floorStr, origAddStr] = floorMatch;
      return {
        targetIdx,
        targetSymbol,
        plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} (currently clamping ${stateVar} < ${floorStr} to ${floorStr} and returning ${stateVar} + ${origAddStr}): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, keep if ${stateVar} < ${floorStr}: ${stateVar} = ${floorStr}, and return ${stateVar} + ${finalAdd}.`,
        expectedTokens: [String(offset), String(finalAdd)],
      };
    }
    const ceilMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)\\n\\s+if \\2 > (\\d+):\\n\\s+ret \\4\\n\\s+ret \\2`,
      ),
    );
    if (ceilMatch) {
      const [, param, stateVar, scaleStr, capStr] = ceilMatch;
      return {
        targetIdx,
        targetSymbol,
        plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} and caps ${stateVar} > ${capStr}: set ${stateVar} = ${param} * ${scaleStr} + ${offset}, if ${stateVar} > ${finalAdd}: return ${finalAdd}, and return ${stateVar}.`,
        expectedTokens: [String(offset), String(finalAdd)],
      };
    }
    const genericMatch = f.aiceWithIdioms.match(
      new RegExp(`pub fn ${cleanSym}\\((\\w+):int\\) -> int:`),
    );
    if (!genericMatch) {
      throw new Error(`RW-11 target ${cleanSym} failed signature match`);
    }
    const [, param] = genericMatch;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int: compute adjusted = ${param} * 3 + ${offset}, if adjusted < 0: adjusted = 0, and return adjusted + ${finalAdd}.`,
      expectedTokens: [String(offset), String(finalAdd)],
    };
  }

  if (CODE_LANGS.has(f.languageId)) {
    const fnMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)[\\s\\S]*?\\$\\w+\\(\\2,\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\)`,
      ),
    );
    if (!fnMatch) {
      throw new Error(`Could not match target function ${cleanSym} in ${f.fileName}`);
    }
    const [, param, stateVar, scaleStr, origLo, origHi] = fnMatch;
    const offset = 11 + ((h >>> 3) % 29);
    const b0Lo = 14 + ((h >>> 7) % 18);
    const b0Hi = 520 + ((h >>> 11) % 380);
    const b0Step = 11 + ((h >>> 15) % 14);
    const b1Lo = b0Lo * 2;
    const b1Hi = b0Hi * 2;
    const b1Step = b0Step * 2;
    const b2Lo = b0Lo * 4;
    const b2Hi = b0Hi * 4;
    const b2Step = b0Step * 3;
    const bandsDesc = `(min=${b0Lo}, max=${b0Hi}, step=${b0Step}), (min=${b1Lo}, max=${b1Hi}, step=${b1Step}), (min=${b2Lo}, max=${b2Hi}, step=${b2Step})`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new public function named "<matchedFnName>Extended"(${param}: int) -> int immediately after the domain function taking (${param}: int) that initializes ${stateVar} = ${param} * ${scaleStr} (initial band [${origLo}, ${origHi}]): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bandsDesc}, and return ${stateVar}.`
      : `   - ${f.fileName}: update the domain function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} (initial band [${origLo}, ${origHi}]): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bandsDesc}, and return ${stateVar}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [String(b0Hi), String(b2Hi)],
      seededSteps: [b0Step, b1Step, b2Step],
    };
  }

  if (f.languageId === "tsx") {
    const compMatch = f.aiceWithIdioms.match(
      new RegExp(
        `component ${cleanSym}\\(\\):\\n\\s+section\\(class="kpi-section", id="([^"]+)"\\)`,
      ),
    );
    if (!compMatch) {
      throw new Error(`Could not match TSX component ${cleanSym} in ${f.fileName}`);
    }
    const [, secId] = compMatch;
    const v0 = String(1210 + ((h >>> 4) % 680));
    const v1 = `${14 + ((h >>> 8) % 25)}ms`;
    const v2 = `99.${91 + ((h >>> 12) % 8)}%`;
    const tilesDesc = isNewFeature
      ? `(data-metric="spark_0", label="Live Velocity", value="${v0}"), (data-metric="spark_1", label="Cohort Retention", value="${v1}"), (data-metric="spark_2", label="Alert Burn Rate", value="${v2}")`
      : `(data-metric="fixed_0", label="Verified KPI", value="${v0}"), (data-metric="fixed_1", label="Verified P95", value="${v1}"), (data-metric="fixed_2", label="Verified Uptime", value="${v2}")`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new component named "<matchedComponentName>Sparkline" immediately after the component rendering section.kpi-section#${secId}, rendering section.kpi-section#${secId}_spark with 3 KPI tiles: ${tilesDesc}.`
      : `   - ${f.fileName}: update the component rendering section.kpi-section#${secId} so its 3 KPI tiles are: ${tilesDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [v0, v1],
    };
  }

  if (f.languageId === "css") {
    const origZ = targetIdx + 1;
    const pad0 = 17 + ((h >>> 4) % 7);
    const gap0 = 9 + ((h >>> 8) % 5);
    const pad1 = pad0 + 4;
    const gap1 = gap0 + 4;
    const zNew = 40 + ((h >>> 12) % 45);
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new CSS rule named "<matchedClassSelector>-active" immediately after the class rule that currently has z-index: ${origZ}, with two flex-centered card blocks (padding: ${pad0}px, gap: ${gap0}px) and (padding: ${pad1}px, gap: ${gap1}px) and z-index: ${zNew}.`
      : `   - ${f.fileName}: update the class rule that currently has z-index: ${origZ} to two flex-centered card blocks (padding: ${pad0}px, gap: ${gap0}px) and (padding: ${pad1}px, gap: ${gap1}px) and z-index: ${zNew}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [`${pad0}px`, String(zNew)],
    };
  }

  if (f.languageId === "html") {
    const secMatch = f.aiceWithIdioms.match(
      new RegExp(
        `section\\(id="${cleanSym}", class="panel"\\) \\{\\n\\s+\\$\\w+\\("[^"]+",\\s*"([^"]+)",\\s*"([^"]+)"\\)`,
      ),
    );
    if (!secMatch) {
      throw new Error(`Could not match HTML section ${cleanSym} in ${f.fileName}`);
    }
    const [, origLabel0] = secMatch;
    const hv0 = String(815 + ((h >>> 4) % 170));
    const hv1 = String(415 + ((h >>> 8) % 170));
    const rowsDesc = isNewFeature
      ? `(data-key="new_0", label="Live Peak", value="${hv0}") and (data-key="new_1", label="Live Floor", value="${hv1}")`
      : `(data-key="upd_0", label="Verified Metric", value="${hv0}") and (data-key="upd_1", label="Verified Delta", value="${hv1}")`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new <section id="<matchedSectionId>_extra" class="panel"> immediately after the <section class="panel"> whose metric row has label="${origLabel0}", with 2 metric rows: ${rowsDesc}.`
      : `   - ${f.fileName}: update the <section class="panel"> whose metric row has label="${origLabel0}" to 2 metric rows: ${rowsDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [hv0, hv1],
    };
  }

  if (f.languageId === "twig") {
    const blkMatch = f.aiceWithIdioms.match(
      new RegExp(
        `block\\(name="${cleanSym}"\\) \\{\\n\\s+\\$\\w+\\("([^"]+)",\\s*(\\w+)\\)`,
      ),
    );
    if (!blkMatch) {
      throw new Error(`Could not match Twig block ${cleanSym} in ${f.fileName}`);
    }
    const [, origLabel0] = blkMatch;
    const tagNum = 10 + ((h >>> 4) % 85);
    const tLabel0 = isNewFeature ? `Summary Total ${tagNum}` : `Updated Total ${tagNum}`;
    const tLabel1 = isNewFeature ? "Tax Total" : "Discount Total";
    const tVar0 = isNewFeature ? "val_sum_0" : "val_upd_0";
    const tVar1 = isNewFeature ? "val_sum_1" : "val_upd_1";
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new Twig block named "<matchedBlockName>_summary" immediately after the Twig block containing summary row label="${origLabel0}", with 2 summary rows: (label="${tLabel0}", variable=${tVar0}) and (label="${tLabel1}", variable=${tVar1}).`
      : `   - ${f.fileName}: update the Twig block containing summary row label="${origLabel0}" to 2 summary rows: (label="${tLabel0}", variable=${tVar0}) and (label="${tLabel1}", variable=${tVar1}).`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [tLabel0],
    };
  }

  if (f.languageId === "json" || f.languageId === "yaml") {
    const keyMatch = f.aiceWithIdioms.match(
      new RegExp(
        `${cleanSym}:\\s*\\[\\n\\s+\\$\\w+\\("([^"]+)",\\s*(\\d+),\\s*(\\d+)\\)`,
      ),
    );
    if (!keyMatch) {
      throw new Error(`Could not match JSON/YAML key ${cleanSym} in ${f.fileName}`);
    }
    const [, origEntryId] = keyMatch;
    const jT0 = 32 + ((h >>> 4) % 40);
    const jL0 = 3250 + ((h >>> 8) % 1400);
    const jT1 = jT0 * 2;
    const jL1 = jL0 + 400;
    const eId0 = isNewFeature ? "stream_0" : "verified_0";
    const eId1 = isNewFeature ? "stream_1" : "verified_1";
    const entriesDesc =
      f.languageId === "json"
        ? `(id="${eId0}", threshold=${jT0}, limit=${jL0}) and (id="${eId1}", threshold=${jT1}, limit=${jL1})`
        : `(worker="${eId0}", port=${jT0}, concurrency=${jL0}) and (worker="${eId1}", port=${jT1}, concurrency=${jL1})`;
    const schemaHint =
      f.languageId === "json"
        ? "policy rule entries (retaining standard retries/enabled/windowSec fields)"
        : "service tier entries (retaining standard replicas/healthIntervalSec/tlsRequired fields)";
    const idField = f.languageId === "json" ? `id="${origEntryId}"` : `worker="${origEntryId}"`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new top-level key named "<matchedKey>_realtime" (config.<matchedKey>_realtime) immediately after the top-level key whose entry has ${idField}, with 2 ${schemaHint}: ${entriesDesc}.`
      : `   - ${f.fileName}: update the top-level key whose entry has ${idField} to 2 ${schemaHint}: ${entriesDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [eId0, String(jL0)],
    };
  }

  throw new Error(`Unhandled file spec: ${f.fileName}`);
}

/**
 * Cold-Start Workspace Setup:
 * Writes ONLY native source files (with procedurally seeded decoy sentinel functions and
 * decoy comment traps in code files). Never writes `aice.config.json`, `.aice-idioms.json`, or `.aice` files.
 */
export function setupWorkspace(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aice-${spec.id.toLowerCase()}-${mode}-`));
  for (const f of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === f.languageId);
    if (!langSpec) throw new Error(`Unknown languageId ${f.languageId}`);
    const { idioms } = buildIdiomRegistryForLanguage(f.languageId);
    const decoy = computeFileDecoySpec(seed, spec.id, f.fileName);
    const sourceAice = CODE_LANGS.has(f.languageId)
      ? `${f.aiceWithIdioms.trimEnd()}\n\npub fn ${decoy.fnName}(probe:int) -> int:\n  ret probe + ${decoy.decoyStep}\n`
      : f.aiceWithIdioms;
    const ast = parse(sourceAice, `${f.fileName}.aice`);
    const expanded = expandModuleIdioms(ast, idioms);
    let native = emitTarget(expanded, langSpec.target, { watermark: false });
    if (CODE_LANGS.has(f.languageId)) {
      const commentLine =
        f.languageId === "py" ? `# ${decoy.commentTag}\n` : `// ${decoy.commentTag}\n`;
      native = `${native.trimEnd()}\n${commentLine}`;
    }
    fs.writeFileSync(path.join(dir, f.fileName), native, "utf-8");
  }
  return dir;
}

export function buildTaskSpecText(
  spec: RealWorldBenchmarkSpec,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const isNewFeature = spec.scenario === "new_feature";
  const updateLines = spec.files.map(
    (f) => computeSeededFileMutation(seed, spec.id, f, isNewFeature).plainEnglishLine,
  );

  if (spec.id === "RW-11") {
    return [
      `Engineering Task (${spec.id}: ${spec.title}):`,
      `1. Target Symbol Update (Blind Discovery — inspect the file to identify the matching domain function by its parameter & formula; do NOT touch verifyDecoySentinel_* or DECOY_SENTINEL_* comments):`,
      ...updateLines,
      `2. Delete Obsolete Symbol:`,
      `   - Locate and delete the obsolete function declaration whose identifier starts with "deprecated", "legacy", or "obsolete" (do NOT delete the DECOY_SENTINEL_* comment at the end of the file).`,
    ].join("\n");
  }

  const patternLines: string[] = [];
  const presentLangs = new Set(spec.files.map((f) => f.languageId));
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const codeFiles = spec.files
      .filter((f) => CODE_LANGS.has(f.languageId))
      .map((f) => f.fileName)
      .join(", ");
    patternLines.push(
      `   - Code files (${codeFiles}): in every clamping band step across all domain functions in the workspace (including updated/newly added ones), change the step increment at the end of each band from "+ step" to "+ step + 1". IMPORTANT: Do NOT modify or delete any verifyDecoySentinel_* function or DECOY_SENTINEL_* comment (its "probe + <N>" expression is a sentinel check, NOT a clamping band step).`,
    );
  }
  if (presentLangs.has("tsx")) {
    patternLines.push(
      `   - TSX files: change every KPI tile container class from "kpi-tile" to "kpi-tile-v2".`,
    );
  }
  if (presentLangs.has("css")) {
    patternLines.push(`   - CSS files: change every card border-radius from 8px to 12px.`);
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
    `1. Target Symbol Updates (Blind Discovery — inspect the workspace to locate each target declaration by its domain signature/attributes):`,
    ...updateLines,
    `2. Delete Obsolete Symbols:`,
    `   - Locate and delete every obsolete/legacy/deprecated function, component, CSS rule, HTML section, Twig block, or config key across the workspace (any symbol declaration whose identifier contains "legacy", "deprecated", or "obsolete"; do NOT delete DECOY_SENTINEL_* comments).`,
    `3. Multi-File Pattern Refactor across all domain functions/elements/rules in the workspace:`,
    ...patternLines,
  ].join("\n");
}

function buildPrompt(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  dir: string,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const taskText = buildTaskSpecText(spec, seed);

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      `Environment: WITHOUT AICE (Native IDE Tools — Cold-Start Repository).`,
      `Allowed tools: grep_search, find_by_name, view_file, replace_file_content, multi_replace_file_content. Do NOT use run_command or aice.`,
      taskText,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  if (mode === "aice_no_idioms") {
    return [
      `Workspace: ${dir}`,
      `Environment: AICE On-the-Fly WITHOUT Idioms (Pure AICE CLI — Cold-Start Repository).`,
      `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, --dry-run, or $idiom macros.`,
      `AICE CLI Reference (\`--no-idioms\`):`,
      `- \`cd ${dir} && aice context . -s "*" --no-idioms\`: Extract \`// symbols:\` headers and compact pure-AICE slices for all files in 1 command (or \`aice outline . --no-idioms\` for signatures only; pass file subsets if a 15-file workspace output is truncated).`,
      `- \`cd ${dir} && aice splice --no-idioms --batch '[...]'\`: Apply atomic AST updates, insertions, and deletions in 1 inline JSON array (keep compact 1-line \`if v < min: v = min; if v > max: v = max; v = v + step + 1\` and \`div(...) { span(...): ...; strong(...): ... }\` AICE syntax from context; omit \`verifyDecoySentinel_*\` from the batch array so it remains untouched):`,
      `  - Update: \`{"file":"<file>","symbol":"<sym>","code":"<pure AICE>"}\``,
      `  - Insert: \`{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<pure AICE>"}\``,
      `  - Delete: \`{"file":"<file>","symbol":"<obsoleteSym>","delete":true}\``,
      taskText,
      `Reply DONE immediately once \`aice splice --no-idioms\` succeeds (do not run extra verification commands).`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    `Environment: AICE On-the-Fly WITH Cold-Start Project Idiom Discovery (\`--idioms\`).`,
    `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, or --dry-run.`,
    `AICE CLI Reference (\`--idioms\`):`,
    `- \`cd ${dir} && aice context . -s "*" --idioms\`: Auto-discover & save repeating project idioms into \`aice.config.json\` AND extract \`// symbols:\` headers, \`$idiom(...)\`-collapsed symbol slices, and \`### Active Project Idioms\` templates across the workspace in 1 command (no separate \`outline\` or \`idioms scan\` command needed).`,
    `- \`cd ${dir} && aice splice --idioms --batch '[...]'\`: Apply atomic symbol updates/insertions, deletions, and workspace-wide \`$idiom\` template refactors in 1 inline JSON array (in JSON/YAML idiom templates, preserve \`{ key: $0, ... }\` object syntax; in multi-line code/CSS templates, separate lines with \`\\n\`; omit \`verifyDecoySentinel_*\` from the batch array):`,
    `  - Update: \`{"file":"<file>","symbol":"<sym>","code":"<AICE with $idiom>"}\``,
    `  - Insert: \`{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<AICE with $idiom>"}\``,
    `  - Delete: \`{"file":"<file>","symbol":"<obsoleteSym>","delete":true}\``,
    `  - Idiom template refactor: \`{"name":"$<discovered_idiom>","template":"<updated template>"}\``,
    taskText,
    `Reply DONE immediately once \`aice splice --idioms\` succeeds (do not run extra verification commands).`,
  ].join("\n\n");
}

function checkBalancedDelimiters(code: string): string | null {
  const stack: string[] = [];
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === "\\" && inStr !== "`") {
        i++;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      const open = stack.pop();
      const expected = ch === "}" ? "{" : ch === ")" ? "(" : "[";
      if (open !== expected) {
        return `Unbalanced delimiter '${ch}' at offset ${i}`;
      }
    }
  }
  if (inStr) return `Unclosed string literal (${inStr})`;
  if (inBlockComment) return "Unclosed block comment";
  if (stack.length > 0) return `Unclosed delimiter '${stack[stack.length - 1]}'`;
  return null;
}

function checkBalancedMarkupTags(content: string): string | null {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*?(\/?)>/g;
  const voidTags = new Set(["br", "hr", "img", "input", "link", "meta"]);
  for (const m of content.matchAll(tagRegex)) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    const selfClose = m[2] === "/";
    if (voidTags.has(tag) || selfClose) continue;
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== tag) {
        return `Mismatched closing tag </${tag}> (expected </${top ?? "none"}>)`;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    return `Unclosed markup tag <${stack[stack.length - 1]}>`;
  }
  return null;
}

export function verifyCompilerAndSyntaxOnFile(
  filePath: string,
  languageId: BenchmarkLanguageId,
  dir: string,
): string | null {
  try {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === languageId);
    const content = fs.readFileSync(filePath, "utf-8");
    if (langSpec) {
      const decomp = decompile(content, langSpec.target, { filePath });
      if (!decomp.ast.items || decomp.ast.items.length === 0) {
        return "Decompiled AST has 0 items";
      }
    }
    if (languageId === "ts" || languageId === "js" || languageId === "tsx") {
      const transpiled = ts.transpileModule(content, {
        fileName: filePath,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          jsx: languageId === "tsx" ? ts.JsxEmit.ReactJSX : ts.JsxEmit.None,
        },
      });
      if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
        const msg = ts.flattenDiagnosticMessageText(transpiled.diagnostics[0].messageText, "\n");
        return `TypeScript syntax diagnostic: ${msg}`;
      }
      if (languageId === "ts" || languageId === "js") {
        execFileSync("node", ["--check", filePath], { stdio: "pipe" });
      } else {
        const tagErr = checkBalancedMarkupTags(content);
        if (tagErr) return tagErr;
      }
    } else if (languageId === "py") {
      execFileSync("python3", ["-m", "py_compile", filePath], { stdio: "pipe" });
      const pycache = path.join(dir, "__pycache__");
      if (fs.existsSync(pycache)) {
        fs.rmSync(pycache, { recursive: true, force: true });
      }
    } else if (languageId === "php") {
      execFileSync("php", ["-l", filePath], { stdio: "pipe" });
    } else if (languageId === "cpp") {
      execFileSync(
        "g++",
        ["-std=c++20", "-fsyntax-only", "-Wno-pragma-once-outside-header", "-x", "c++", filePath],
        { stdio: "pipe" },
      );
    } else if (languageId === "rs") {
      const rmetaPath = path.join(dir, ".aice_check.rmeta");
      const tmpRsPath = path.join(dir, ".aice_check.rs");
      const rsClean = content
        .replace(/^\s*use\s+serde::[^\n]+;\n?/gm, "")
        .replace(/,\s*Serialize,\s*Deserialize/g, "");
      fs.writeFileSync(tmpRsPath, rsClean, "utf-8");
      try {
        execFileSync(
          "rustc",
          [
            "-A",
            "warnings",
            "--edition=2021",
            "--crate-name",
            "aice_check",
            "--crate-type=lib",
            "--emit=metadata",
            "-o",
            rmetaPath,
            tmpRsPath,
          ],
          { stdio: "pipe" },
        );
      } finally {
        if (fs.existsSync(rmetaPath)) fs.rmSync(rmetaPath, { force: true });
        if (fs.existsSync(tmpRsPath)) fs.rmSync(tmpRsPath, { force: true });
      }
    } else if (languageId === "cs" || languageId === "kt" || languageId === "go") {
      const delimErr = checkBalancedDelimiters(content);
      if (delimErr) return delimErr;
      if (
        /(?:^|[^+\-*/%&|^=<>!])[+\-*/%]\s*(?:;|\}|\r?\n)/m.test(content) ||
        /\breturn\s*(?:;|\}|\r?\n)/m.test(content)
      ) {
        return `Dangling operator or incomplete expression in ${languageId}`;
      }
    } else if (languageId === "html") {
      const tagErr = checkBalancedMarkupTags(content);
      if (tagErr) return tagErr;
    } else if (languageId === "twig") {
      const tagErr = checkBalancedMarkupTags(content);
      if (tagErr) return tagErr;
      const openBlocks = (content.match(/\{%\s*block\b/g) || []).length;
      const closeBlocks = (content.match(/\{%\s*endblock\b/g) || []).length;
      if (openBlocks === 0 || openBlocks !== closeBlocks) {
        return `Unbalanced Twig blocks: ${openBlocks} block vs ${closeBlocks} endblock`;
      }
    } else if (languageId === "css") {
      const delimErr = checkBalancedDelimiters(content);
      if (delimErr) return delimErr;
    } else if (languageId === "json") {
      JSON.parse(content);
    } else if (languageId === "yaml") {
      const parsedYaml = YAML.parse(content);
      if (!parsedYaml || typeof parsedYaml !== "object") {
        return "YAML did not parse to a valid object";
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export function verifyWorkspaceOnDisk(
  spec: RealWorldBenchmarkSpec,
  dir: string,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): {
  verified: boolean;
  zeroAice: boolean;
  decoysInjected: number;
  decoysIntact: boolean;
  compilerVerified: boolean;
  details: string[];
} {
  const details: string[] = [];
  let decoysInjected = 0;
  let decoysIntact = true;
  let compilerVerified = true;
  const isNewFeature = spec.scenario === "new_feature";

  for (const f of spec.files) {
    const filePath = path.join(dir, f.fileName);
    const content = fs.readFileSync(filePath, "utf-8");
    const seededMut = computeSeededFileMutation(seed, spec.id, f, isNewFeature);
    const targetSym = seededMut.targetSymbol;

    const compileErr = verifyCompilerAndSyntaxOnFile(filePath, f.languageId, dir);
    if (compileErr) {
      compilerVerified = false;
      details.push(`${f.fileName}: compiler/syntax check failed: ${compileErr}`);
    }

    if (f.obsoleteSymbol) {
      const cleanObs = f.obsoleteSymbol.replace(/^config\./, "").replace(/^[.#]/, "");
      const snakeObs = cleanObs.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      if (
        content.includes(cleanObs) ||
        content.includes(cleanObs.replace(/_/g, "-")) ||
        content.includes(snakeObs)
      ) {
        details.push(`${f.fileName}: obsoleteSymbol ${f.obsoleteSymbol} still present`);
      }
    }
    if (content.includes("namespace ::") || /public\s+static\s+\w+\s+public\s+/.test(content)) {
      details.push(`${f.fileName}: contains corrupted splice header/namespace`);
    }

    for (const tok of seededMut.expectedTokens) {
      if (!content.includes(tok)) {
        details.push(
          `${f.fileName}: target symbol ${targetSym} missing seeded update token '${tok}'`,
        );
      }
    }

    const minSymCount = f.refactorSymbols.length;
    if (CODE_LANGS.has(f.languageId)) {
      decoysInjected++;
      const decoy = computeFileDecoySpec(seed, spec.id, f.fileName);
      const hasDecoyFn = new RegExp(`verify_?decoy_?sentinel_?${decoy.hexSeed}`, "i").test(
        content,
      );
      const hasIntactDecoyExpr = new RegExp(`\\$?probe\\s*\\+\\s*${decoy.decoyStep}\\b`).test(
        content,
      );
      const hasCorruptedDecoyExpr = new RegExp(
        `\\$?probe\\s*\\+\\s*\\(?${decoy.decoyStep}\\)?\\s*\\+\\s*1\\b`,
      ).test(content);
      const hasIntactCommentTag = content.includes(`DECOY_SENTINEL_${decoy.hexSeed}`);
      if (!hasDecoyFn || !hasIntactDecoyExpr || hasCorruptedDecoyExpr || !hasIntactCommentTag) {
        decoysIntact = false;
        details.push(`${f.fileName}: decoy sentinel ${decoy.fnName} was deleted or corrupted`);
      }

      const hasExtendedFn =
        content.includes(`${targetSym}Extended`) ||
        new RegExp(`${targetSym.replace(/_/g, "_?")}_?extended`, "i").test(content);
      if (isNewFeature && !hasExtendedFn) {
        details.push(`${f.fileName}: missing new feature function ${targetSym}Extended`);
      }

      if (spec.id !== "RW-11") {
        const explicitPlusOnes = (content.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length;
        const rawSteps = [
          ...[...f.aiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g)].map((m) =>
            Number(m[1]),
          ),
          ...[
            ...f.updatedTargetSymbolAiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g),
          ].map((m) => Number(m[1])),
          ...(seededMut.seededSteps || []),
        ];
        const foldedSet = new Set(rawSteps.map((s) => s + 1));
        const foldedMatches = [...content.matchAll(/\+\s*(\d+)\b(?!\s*\+\s*1\b)/g)].filter((m) =>
          foldedSet.has(Number(m[1])),
        ).length;
        const totalRefactored = explicitPlusOnes + foldedMatches;
        if (totalRefactored < minSymCount * 3) {
          details.push(
            `${f.fileName}: expected >= ${minSymCount * 3} refactored band steps, got ${totalRefactored}`,
          );
        }
      }
    } else if (f.languageId === "tsx") {
      if (isNewFeature && !content.includes(`${targetSym}Sparkline`)) {
        details.push(`${f.fileName}: missing new component ${targetSym}Sparkline`);
      }
      const c = (content.match(/kpi-tile-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing kpi-tile-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "css") {
      if (isNewFeature && !content.includes(`${targetSym}-active`)) {
        details.push(`${f.fileName}: missing new CSS rule ${targetSym}-active`);
      }
      const c = (content.match(/12px/g) || []).length;
      if (c < minSymCount)
        details.push(`${f.fileName}: missing 12px border-radius (${c}/${minSymCount})`);
    } else if (f.languageId === "html") {
      const cleanId = targetSym.replace(/^#/, "");
      if (isNewFeature && !content.includes(`${cleanId}_extra`)) {
        details.push(`${f.fileName}: missing new HTML section ${cleanId}_extra`);
      }
      const c = (content.match(/metric-row-v2/g) || []).length;
      if (c < minSymCount)
        details.push(`${f.fileName}: missing metric-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "twig") {
      if (isNewFeature && !content.includes(`${targetSym}_summary`)) {
        details.push(`${f.fileName}: missing new Twig block ${targetSym}_summary`);
      }
      const c = (content.match(/summary-row-v2/g) || []).length;
      if (c < minSymCount)
        details.push(`${f.fileName}: missing summary-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "json") {
      const cleanKey = targetSym.replace(/^config\./, "");
      if (isNewFeature && !content.includes(`${cleanKey}_realtime`)) {
        details.push(`${f.fileName}: missing new JSON key ${cleanKey}_realtime`);
      }
      const c = (content.match(/"retries":\s*5/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing retries: 5 (${c}/${minSymCount})`);
    } else if (f.languageId === "yaml") {
      const cleanKey = targetSym.replace(/^config\./, "");
      if (isNewFeature && !content.includes(`${cleanKey}_realtime`)) {
        details.push(`${f.fileName}: missing new YAML key ${cleanKey}_realtime`);
      }
      const c = (content.match(/replicas:\s*4/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing replicas: 4 (${c}/${minSymCount})`);
    }
  }

  const aiceFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".aice"));
  const zeroAice = aiceFiles.length === 0;
  if (!zeroAice) details.push(`Found .aice files: ${aiceFiles.join(",")}`);

  return {
    verified: details.length === 0 && zeroAice && decoysIntact && compilerVerified,
    zeroAice,
    decoysInjected,
    decoysIntact,
    compilerVerified,
    details,
  };
}

export async function runAgentBenchmarkMode(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): Promise<RealAgentRunMetrics> {
  const dir = setupWorkspace(spec, mode, seed);
  const coldStartRepo =
    !fs.existsSync(path.join(dir, "aice.config.json")) &&
    !fs.existsSync(path.join(dir, ".aice-idioms.json"));
  const taskSpecText = buildTaskSpecText(spec, seed);
  const blindPrompt = spec.files.every((f) => {
    const seededTarget = computeSeededFileMutation(
      seed,
      spec.id,
      f,
      spec.scenario === "new_feature",
    ).targetSymbol;
    return (
      !taskSpecText.includes(seededTarget) &&
      !taskSpecText.includes(f.targetSymbol) &&
      (!f.obsoleteSymbol || !taskSpecText.includes(f.obsoleteSymbol))
    );
  });
  const prompt = buildPrompt(spec, mode, dir, seed);
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
  const check = verifyWorkspaceOnDisk(spec, dir, seed);
  if (
    mode === "aice_with_idioms" &&
    spec.id !== "RW-11" &&
    !fs.existsSync(path.join(dir, "aice.config.json"))
  ) {
    check.verified = false;
    check.details.push("aice_with_idioms did not discover/save aice.config.json during live run");
  }
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
    apiCostUsd: computeRealApiCostUsd(inputTokens, cacheReadTokens, outputTokens),
    durationSeconds,
    verifiedOnDisk: check.verified,
    zeroAiceFilesLeftOnDisk: check.zeroAice,
    seed,
    coldStartRepo,
    blindPrompt,
    decoysInjected: check.decoysInjected,
    decoysIntact: check.decoysIntact,
  };
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let seed = process.env.AICE_BENCH_SEED
    ? Number(process.env.AICE_BENCH_SEED)
    : generateFreshBenchmarkSeed();
  let noSave = false;
  const targetIds: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--seed" && rawArgs[i + 1]) {
      seed = Number(rawArgs[++i]);
    } else if (rawArgs[i].startsWith("--seed=")) {
      seed = Number(rawArgs[i].slice("--seed=".length));
    } else if (rawArgs[i] === "--only" && rawArgs[i + 1]) {
      targetIds.push(rawArgs[++i]);
    } else if (rawArgs[i].startsWith("--only=")) {
      targetIds.push(rawArgs[i].slice("--only=".length));
    } else if (rawArgs[i] === "--no-save" || rawArgs[i] === "--dry-run") {
      noSave = true;
    } else {
      targetIds.push(rawArgs[i]);
    }
  }
  const outPath = path.resolve(__dirname, "real-agent-results.json");
  let existing: Record<string, Record<RealAgentMode, RealAgentRunMetrics>> = {};
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  }

  if (targetIds.some((t) => t.includes(":"))) {
    await Promise.all(
      targetIds.map(async (t) => {
        const [id, mode] = t.split(":") as [string, RealAgentMode];
        const spec = ALL_REAL_AGENT_BENCHMARKS.find((s) => s.id === id);
        if (!spec) throw new Error(`Unknown spec ${id}`);
        console.log(`Running ${id}:${mode} (seed=${seed})...`);
        const res = await runAgentBenchmarkMode(spec, mode, seed);
        existing[id] = existing[id] || ({} as Record<RealAgentMode, RealAgentRunMetrics>);
        existing[id][mode] = res;
        console.log(
          `${id}:${mode} DONE -> turns=${res.llmTurns} tools=${res.toolCalls} outTok=${res.outputTokens} workTok=${res.workingTokens} cost=$${res.apiCostUsd.toFixed(4)} decoys=${res.decoysIntact} ok=${res.verifiedOnDisk}`,
        );
      }),
    );
    if (!noSave) {
      fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    }
    return;
  }

  const specs = ALL_REAL_AGENT_BENCHMARKS.filter((s) =>
    targetIds.length === 0 ? true : targetIds.includes(s.id),
  );
  for (const spec of specs) {
    console.log(`Running ${spec.id} (${spec.title}) [seed=${seed}]...`);
    const [w, n, i] = await Promise.all([
      runAgentBenchmarkMode(spec, "without_aice", seed),
      runAgentBenchmarkMode(spec, "aice_no_idioms", seed),
      runAgentBenchmarkMode(spec, "aice_with_idioms", seed),
    ]);
    existing[spec.id] = { without_aice: w, aice_no_idioms: n, aice_with_idioms: i };
    if (!noSave) {
      fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
    }
    console.log(`${spec.id} DONE:`);
    console.log(
      `  without_aice:     turns=${w.llmTurns} tools=${w.toolCalls} outTok=${w.outputTokens} workTok=${w.workingTokens} cost=$${w.apiCostUsd.toFixed(4)} decoys=${w.decoysIntact} ok=${w.verifiedOnDisk}`,
    );
    console.log(
      `  aice_no_idioms:   turns=${n.llmTurns} tools=${n.toolCalls} outTok=${n.outputTokens} workTok=${n.workingTokens} cost=$${n.apiCostUsd.toFixed(4)} decoys=${n.decoysIntact} ok=${n.verifiedOnDisk}`,
    );
    console.log(
      `  aice_with_idioms: turns=${i.llmTurns} tools=${i.toolCalls} outTok=${i.outputTokens} workTok=${i.workingTokens} cost=$${i.apiCostUsd.toFixed(4)} decoys=${i.decoysIntact} ok=${i.verifiedOnDisk}`,
    );
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
