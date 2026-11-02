/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Autonomous Evolution, Differential Fuzzing & Self-Healing Engine.
 * Conforms to Pillars 1 to 5 of Autonomous Evolution & Self-Repair Architecture.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Module } from "../core/ast.js";
import { parse } from "../core/parser.js";
import { decompile } from "../decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  type TargetLanguage,
} from "../emitters/index.js";
import { mineProjectIdioms } from "../idioms/idiom-miner.js";
import {
  collapseModuleIdioms,
  expandModuleIdioms,
} from "../idioms/idiom-transform.js";
import { estimateTokens } from "../tokenomics/index.js";
import { TypeChecker } from "../typechecker/checker.js";
import { attemptSelfRepair } from "../typechecker/diagnostics.js";
import { formatAilSource } from "../tools/fmt.js";
import { generateOutline } from "../tools/outline.js";
import { AilAnalyzer } from "../lsp/analyzer.js";
import {
  FUZZ_TARGET_LANGUAGES,
  generateFuzzAilProgram,
  generateHallucinatedAilProgram,
} from "./ast-fuzzer.js";

export type EvolutionGateName =
  | "roundtrip"
  | "idiom"
  | "typecheck"
  | "self-repair"
  | "tokenomics"
  | "runtime";

export interface EvolutionCycleFailure {
  cycle: number;
  seed: number;
  gate: EvolutionGateName;
  message: string;
  originalSource: string;
  shrunkSource?: string;
  target?: TargetLanguage;
  faultKind?: string;
}

export interface EvolutionCycleMetrics {
  cycle: number;
  seed: number;
  target: TargetLanguage;
  gate1RoundtripPassed: boolean;
  gate2IdiomPassed: boolean;
  gate3TypecheckPassed: boolean;
  gate4SelfRepairPassed: boolean;
  gate5TokenomicsPassed: boolean;
  gate6RuntimePassed: boolean;
  ailTokens: number;
  targetTokens: number;
  tokenSavingsPct: number;
  idiomsMined: number;
  repairedFault?: string;
  repairIterations: number;
  corpusFile?: string;
}

export interface EvolutionLoopOptions {
  cycles?: number;
  seed?: number;
  includeCorpus?: boolean;
  corpusDir?: string;
  onCycle?: (cycle: number, metrics: EvolutionCycleMetrics) => void;
  onFailure?: (failure: EvolutionCycleFailure) => void;
}

export interface EvolutionLoopReport {
  totalCycles: number;
  passedCycles: number;
  failedCycles: number;
  roundtripVerifications: number;
  idiomTransformIdentities: number;
  typecheckerVerifications: number;
  selfRepairsAttempted: number;
  selfRepairsSucceeded: number;
  selfRepairRatePct: number;
  multiIterationRepairs: number;
  runtimeEquivalenceVerifications: number;
  averageTokenSavingsPct: number;
  aggregateAilTokens: number;
  aggregateTargetTokens: number;
  targetBreakdown: Record<TargetLanguage, number>;
  corpusSamplesChecked: number;
  failures: EvolutionCycleFailure[];
  durationMs: number;
}

export interface EvolutionCycleResult {
  metrics: EvolutionCycleMetrics;
  failures: EvolutionCycleFailure[];
}

export interface SelfHealingCampaignOptions {
  restarts?: number;
  cyclesPerRestart?: number;
  baseSeed?: number;
  includeCorpus?: boolean;
  corpusDir?: string;
  onRestart?: (restartIndex: number, report: EvolutionLoopReport) => void;
}

export interface SelfHealingCampaignReport {
  totalRestarts: number;
  completedRestarts: number;
  totalCyclesExecuted: number;
  totalRoundtripsVerified: number;
  totalIdiomIdentitiesVerified: number;
  totalSelfRepairsAttempted: number;
  totalSelfRepairsSucceeded: number;
  multiIterationRepairs: number;
  runtimeEquivalenceVerifications: number;
  averageTokenSavingsPct: number;
  totalFailures: number;
  durationMs: number;
}

export const RAW_TARGET_EXTENSIONS = [
  ".ts",
  ".tsx",
  ".py",
  ".go",
  ".rs",
  ".kt",
  ".php",
  ".css",
  ".html",
  ".json",
  ".yaml",
];

/**
 * Delta-debugging test-case minimizer (binary chunk reduction + greedy line pruning).
 * Shrinks any failing .ail source code down to the minimal reproducible snippet.
 */
export function shrinkFailingAilSource(
  ailSource: string,
  predicate: (candidate: string) => boolean,
): string {
  try {
    if (!predicate(ailSource)) return ailSource;
  } catch {
    return ailSource;
  }

  let lines = ailSource.split(/\r?\n/);
  if (lines.length <= 1) return ailSource;

  // 1. Binary chunk removal (delta-debugging)
  let chunkSize = Math.max(1, Math.floor(lines.length / 2));
  while (chunkSize >= 1 && lines.length > 2) {
    let changed = false;
    for (let i = 0; i < lines.length; i += chunkSize) {
      const candidateLines = [...lines.slice(0, i), ...lines.slice(i + chunkSize)];
      const candidate = candidateLines.join("\n").trim();
      if (candidate.length > 0) {
        try {
          if (predicate(candidate)) {
            lines = candidateLines;
            changed = true;
            break;
          }
        } catch {
          // ignore error in predicate
        }
      }
    }
    if (!changed) {
      chunkSize = Math.floor(chunkSize / 2);
    }
  }

  // 2. Greedy single-line removal
  let i = 0;
  while (i < lines.length) {
    if (lines.length <= 1) break;
    const candidateLines = [...lines.slice(0, i), ...lines.slice(i + 1)];
    const candidate = candidateLines.join("\n").trim();
    if (candidate.length > 0) {
      let matches = false;
      try {
        matches = predicate(candidate);
      } catch {
        matches = false;
      }
      if (matches) {
        lines = candidateLines;
        continue;
      }
    }
    i++;
  }

  return lines.join("\n").trim();
}

export const DOGFOOD_COMPILER_FILES = [
  "src/core/span.ts",
  "src/core/trivia.ts",
  "src/shield/fs-lock.ts",
  "src/evolve/index.ts",
  "src/mcp/index.ts",
  "src/lsp/index.ts",
];

function scanDir(dir: string): string[] {
  try {
    if (!fs.existsSync(dir)) return [];
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    const results: string[] = [];
    for (const ent of entries) {
      const full = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (
          ent.name !== "node_modules" &&
          ent.name !== ".git" &&
          ent.name !== "dist" &&
          ent.name !== "build" &&
          ent.name !== "android" &&
          ent.name !== "scratch"
        ) {
          results.push(...scanDir(full));
        }
      } else if (ent.isFile()) {
        if (
          ent.name.endsWith(".ail") ||
          RAW_TARGET_EXTENSIONS.some((ext) => ent.name.endsWith(ext))
        ) {
          results.push(full);
        }
      }
    }
    return results;
  } catch {
    return [];
  }
}

/**
 * Recursively scans directory for .ail and raw target corpus sample files.
 */
export function findCorpusFiles(dir: string): string[] {
  const scanned = scanDir(dir);
  for (const df of DOGFOOD_COMPILER_FILES) {
    const full = path.resolve(process.cwd(), df);
    if (fs.existsSync(full) && !scanned.includes(full)) {
      scanned.push(full);
    }
  }
  return scanned;
}

/**
 * Runs a single evolution cycle executing the 5-Gate Differential Oracle.
 */
export function runEvolutionCycle(
  cycleIndex: number,
  seed: number,
  options: EvolutionLoopOptions = {},
  corpusFiles: string[] = [],
): EvolutionCycleResult {
  const p = generateFuzzAilProgram(seed);
  const failures: EvolutionCycleFailure[] = [];

  let gate1Passed = false;
  let gate2Passed = false;
  let gate3Passed = false;
  let gate4Passed = false;
  let gate5Passed = false;
  let gate6Passed = false;

  let ailTokens = 0;
  let targetTokens = 0;
  let tokenSavingsPct = 0;
  let idiomsMined = 0;
  let repairedFault: string | undefined;
  let repairIterations = 0;
  let corpusFileUsed: string | undefined;

  let mod: Module | undefined;
  let expanded: Module | undefined;
  try {
    mod = parse(p.ailSource, p.name);
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    const shrunk = shrinkFailingAilSource(p.ailSource, (cand) => {
      try {
        parse(cand, p.name);
        return false;
      } catch {
        return true;
      }
    });
    failures.push({
      cycle: cycleIndex,
      seed,
      gate: "typecheck",
      message: `Failed to parse generated fuzz program: ${msg}`,
      originalSource: p.ailSource,
      shrunkSource: shrunk,
      target: p.target,
    });
  }

  let emittedT1 = "";

  if (mod) {
    // -------------------------------------------------------------
    // Gate 1: Strict Idempotent Convergence (T1 -> A1 -> T2 -> A2 -> T3)
    // -------------------------------------------------------------
    try {
      emittedT1 = emitTarget(mod, p.target, { watermark: false });
      const d1 = decompile(emittedT1, p.target);
      const emittedT2 = emitTarget(d1.ast, p.target, { watermark: false });
      const d2 = decompile(emittedT2, p.target);
      const emittedT3 = emitTarget(d2.ast, p.target, { watermark: false });

      if (emittedT2.trim() !== emittedT3.trim()) {
        throw new Error(
          `Gate 1 convergence drift error: emitted T2 (${emittedT2.length} chars) !== T3 (${emittedT3.length} chars)`,
        );
      }
      gate1Passed = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const shrunk = shrinkFailingAilSource(p.ailSource, (cand) => {
        try {
          const m = parse(cand, p.name);
          const t1 = emitTarget(m, p.target, { watermark: false });
          const d1 = decompile(t1, p.target);
          const t2 = emitTarget(d1.ast, p.target, { watermark: false });
          const d2 = decompile(t2, p.target);
          const t3 = emitTarget(d2.ast, p.target, { watermark: false });
          return t2.trim() !== t3.trim();
        } catch {
          return true;
        }
      });
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "roundtrip",
        message: `Gate 1 Convergence failed: ${msg}`,
        originalSource: p.ailSource,
        shrunkSource: shrunk,
        target: p.target,
      });
    }

    // Corpus sampling verification
    if (options.includeCorpus !== false && corpusFiles.length > 0) {
      const cFile = corpusFiles[Math.abs(seed) % corpusFiles.length];
      corpusFileUsed = cFile;
      try {
        const cSrc = fs.readFileSync(cFile, "utf-8");
        if (cFile.endsWith(".ail")) {
          const cMod = parse(cSrc, cFile);
          const cTarget = detectTargetFromPath(cFile.replace(/\.ail$/, ""));
          const cEmit1 = emitTarget(cMod, cTarget, { watermark: false });
          const cDec1 = decompile(cEmit1, cTarget);
          const cEmit2 = emitTarget(cDec1.ast, cTarget, { watermark: false, trivia: cDec1.trivia });
          const cDec2 = decompile(cEmit2, cTarget);
          const cEmit3 = emitTarget(cDec2.ast, cTarget, { watermark: false, trivia: cDec2.trivia });
          if (cEmit2.trim() !== cEmit3.trim()) {
            throw new Error(`Corpus .ail convergence drift on ${cFile}`);
          }
        } else {
          const cTarget = detectTargetFromPath(cFile);
          const cDec1 = decompile(cSrc, cTarget);
          const cEmit1 = emitTarget(cDec1.ast, cTarget, { watermark: false, trivia: cDec1.trivia });
          const cDec2 = decompile(cEmit1, cTarget);
          const cEmit2 = emitTarget(cDec2.ast, cTarget, { watermark: false, trivia: cDec2.trivia });
          if (cEmit1.trim() !== cEmit2.trim()) {
            throw new Error(`Corpus raw target convergence drift on ${cFile}`);
          }
        }
      } catch (err: unknown) {
        const msg = err instanceof Error ? err.message : String(err);
        failures.push({
          cycle: cycleIndex,
          seed,
          gate: "roundtrip",
          message: `Gate 1 Corpus sample roundtrip failed on ${cFile}: ${msg}`,
          originalSource: cFile,
          target: p.target,
        });
      }
    }

    // -------------------------------------------------------------
    // Gate 2: Idiom Mining + Collapse + Expand Identity
    // -------------------------------------------------------------
    try {
      const mined = mineProjectIdioms(
        [{ filePath: p.name, source: p.ailSource, ast: mod }],
        { minOccurrences: 2, minNetTokenSavings: 1 },
      );
      idiomsMined = Object.keys(mined.idioms).length;
      const collapsed = collapseModuleIdioms(mod, mined.idioms);
      expanded = expandModuleIdioms(collapsed.ast, mined.idioms);
      const emitOrig = emitTarget(mod, p.target, { watermark: false });
      const emitExp = emitTarget(expanded, p.target, { watermark: false });
      if (emitOrig !== emitExp) {
        throw new Error(
          `Idiom expansion identity mismatch: original (${emitOrig.length} chars) !== expanded (${emitExp.length} chars)`,
        );
      }
      gate2Passed = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const shrunk = shrinkFailingAilSource(p.ailSource, (cand) => {
        try {
          const m = parse(cand, p.name);
          const mined = mineProjectIdioms(
            [{ filePath: p.name, source: cand, ast: m }],
            { minOccurrences: 2, minNetTokenSavings: 1 },
          );
          const col = collapseModuleIdioms(m, mined.idioms);
          const exp = expandModuleIdioms(col.ast, mined.idioms);
          return (
            emitTarget(m, p.target, { watermark: false }) !==
            emitTarget(exp, p.target, { watermark: false })
          );
        } catch {
          return false;
        }
      });
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "idiom",
        message: `Gate 2 Idiom identity failed: ${msg}`,
        originalSource: p.ailSource,
        shrunkSource: shrunk,
        target: p.target,
      });
    }

    // -------------------------------------------------------------
    // Gate 3: TypeChecker Soundness (0 false positives on valid AST)
    // -------------------------------------------------------------
    try {
      const tc = new TypeChecker();
      tc.checkModule(mod);
      gate3Passed = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      const shrunk = shrinkFailingAilSource(p.ailSource, (cand) => {
        try {
          const m = parse(cand, p.name);
          const tc = new TypeChecker();
          tc.checkModule(m);
          return false;
        } catch {
          return true;
        }
      });
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "typecheck",
        message: `Gate 3 Typechecker soundness failed: ${msg}`,
        originalSource: p.ailSource,
        shrunkSource: shrunk,
        target: p.target,
      });
    }

    // -------------------------------------------------------------
    // Gate 5: Tokenomics Audit (cl100k_base compression)
    // -------------------------------------------------------------
    try {
      ailTokens = estimateTokens(p.ailSource, "cl100k_base");
      const targetCode = emittedT1 || emitTarget(mod, p.target, { watermark: false });
      targetTokens = estimateTokens(targetCode, "cl100k_base");
      tokenSavingsPct =
        targetTokens > 0
          ? ((targetTokens - ailTokens) / targetTokens) * 100
          : 0;
      gate5Passed = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "tokenomics",
        message: `Gate 5 Tokenomics estimation failed: ${msg}`,
        originalSource: p.ailSource,
        target: p.target,
      });
    }

    // -------------------------------------------------------------
    // Gate 6: Live Runtime Execution Equivalence & Multi-File Toolchain
    // -------------------------------------------------------------
    try {
      // 1. Multi-File Toolchain Verification
      const f1 = formatAilSource(p.ailSource);
      const f2 = formatAilSource(f1);
      if (f1 !== f2) {
        throw new Error("formatAilSource idempotence failed");
      }
      generateOutline(mod);
      const analyzer = new AilAnalyzer();
      analyzer.setDocument(p.name, p.ailSource);
      analyzer.getDocumentSymbols(p.name);
      analyzer.formatDocument(p.name);

      // 2. Runtime Execution Equivalence via new Function
      const jsOrig = emitTarget(mod, "javascript", { watermark: false });
      const jsIdiomExpanded = emitTarget(expanded ?? mod, "javascript", { watermark: false });
      let jsRoundtrip = "";
      if (p.target === "typescript" || p.target === "javascript") {
        const d = decompile(emittedT1, p.target);
        jsRoundtrip = emitTarget(d.ast, "javascript", { watermark: false });
      }

      function runComputeMain(jsCode: string, x: number, y: number): number {
        const clean = jsCode
          .replace(/^\s*export\s+default\s+/gm, "")
          .replace(/^\s*export\s+/gm, "");
        const fn = new Function("x", "y", `${clean}\nreturn computeMain(x, y);`);
        return fn(x, y);
      }

      const inputPairs: [number, number][] = [
        [seed % 23, (seed * 3) % 19],
        [(seed * 7) % 31, (seed * 5) % 17],
        [(seed * 11) % 13, (seed * 13) % 29],
      ];

      for (const [x, y] of inputPairs) {
        const valOrig = runComputeMain(jsOrig, x, y);
        const valIdiom = runComputeMain(jsIdiomExpanded, x, y);
        if (valOrig !== valIdiom) {
          throw new Error(
            `Runtime equivalence failure between orig (${valOrig}) and idiom-expanded (${valIdiom}) at input (${x}, ${y})`,
          );
        }
        if (jsRoundtrip) {
          const valRoundtrip = runComputeMain(jsRoundtrip, x, y);
          if (valOrig !== valRoundtrip) {
            throw new Error(
              `Runtime equivalence failure between orig (${valOrig}) and roundtripped (${valRoundtrip}) at input (${x}, ${y})`,
            );
          }
        }
      }
      gate6Passed = true;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "runtime",
        message: `Gate 6 Runtime Equivalence failed: ${msg}`,
        originalSource: p.ailSource,
        target: p.target,
      });
    }
  }

  // -------------------------------------------------------------
  // Gate 4: Self-Repair Loop (autonomous healing of broken AST)
  // -------------------------------------------------------------
  const broken = generateHallucinatedAilProgram(seed);
  try {
    const rep = attemptSelfRepair(broken.brokenAilSource);
    if (rep.fixed) {
      gate4Passed = true;
      repairedFault = broken.faultKind;
      repairIterations = rep.iterations;
    } else {
      const shrunk = shrinkFailingAilSource(broken.brokenAilSource, (cand) => {
        const r = attemptSelfRepair(cand);
        return !r.fixed;
      });
      failures.push({
        cycle: cycleIndex,
        seed,
        gate: "self-repair",
        message: `Gate 4 Self-repair failed for fault kind: ${broken.faultKind}`,
        originalSource: broken.brokenAilSource,
        shrunkSource: shrunk,
        faultKind: broken.faultKind,
        target: p.target,
      });
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err);
    failures.push({
      cycle: cycleIndex,
      seed,
      gate: "self-repair",
      message: `Gate 4 Self-repair threw exception: ${msg}`,
      originalSource: broken.brokenAilSource,
      faultKind: broken.faultKind,
      target: p.target,
    });
  }

  const metrics: EvolutionCycleMetrics = {
    cycle: cycleIndex,
    seed,
    target: p.target,
    gate1RoundtripPassed: gate1Passed,
    gate2IdiomPassed: gate2Passed,
    gate3TypecheckPassed: gate3Passed,
    gate4SelfRepairPassed: gate4Passed,
    gate5TokenomicsPassed: gate5Passed,
    gate6RuntimePassed: gate6Passed,
    ailTokens,
    targetTokens,
    tokenSavingsPct,
    idiomsMined,
    repairedFault,
    repairIterations,
    corpusFile: corpusFileUsed,
  };

  return { metrics, failures };
}

/**
 * Synchronous multi-cycle evolution execution loop.
 */
export function runEvolutionLoopSync(
  options: EvolutionLoopOptions = {},
): EvolutionLoopReport {
  const startTime = Date.now();
  const totalCycles = options.cycles ?? 100;
  const initialSeed = options.seed ?? 1337;

  const corpusDir = options.corpusDir ?? path.resolve(process.cwd(), "examples");
  const corpusFiles =
    options.includeCorpus !== false ? findCorpusFiles(corpusDir) : [];

  const targetBreakdown: Record<TargetLanguage, number> = {
    typescript: 0,
    javascript: 0,
    python: 0,
    go: 0,
    rust: 0,
    kotlin: 0,
    php: 0,
    cpp: 0,
    csharp: 0,
    tsx: 0,
    json: 0,
    yaml: 0,
    html: 0,
    css: 0,
    twig: 0,
  };

  let passedCycles = 0;
  let failedCycles = 0;
  let roundtripVerifications = 0;
  let idiomTransformIdentities = 0;
  let typecheckerVerifications = 0;
  let selfRepairsAttempted = 0;
  let selfRepairsSucceeded = 0;
  let multiIterationRepairs = 0;
  let runtimeEquivalenceVerifications = 0;
  let aggregateAilTokens = 0;
  let aggregateTargetTokens = 0;
  let corpusSamplesChecked = 0;
  const allFailures: EvolutionCycleFailure[] = [];

  for (let cycle = 0; cycle < totalCycles; cycle++) {
    const seed = initialSeed + cycle;
    const { metrics, failures } = runEvolutionCycle(
      cycle,
      seed,
      options,
      corpusFiles,
    );

    targetBreakdown[metrics.target] = (targetBreakdown[metrics.target] ?? 0) + 1;
    if (metrics.gate1RoundtripPassed) roundtripVerifications++;
    if (metrics.gate2IdiomPassed) idiomTransformIdentities++;
    if (metrics.gate3TypecheckPassed) typecheckerVerifications++;
    if (metrics.gate6RuntimePassed) runtimeEquivalenceVerifications++;
    selfRepairsAttempted++;
    if (metrics.gate4SelfRepairPassed) {
      selfRepairsSucceeded++;
      if (metrics.repairIterations >= 2) {
        multiIterationRepairs++;
      }
    }
    if (metrics.corpusFile && metrics.gate1RoundtripPassed) corpusSamplesChecked++;

    aggregateAilTokens += metrics.ailTokens;
    aggregateTargetTokens += metrics.targetTokens;

    if (failures.length === 0) {
      passedCycles++;
    } else {
      failedCycles++;
      allFailures.push(...failures);
      for (const f of failures) {
        options.onFailure?.(f);
      }
    }

    options.onCycle?.(cycle, metrics);
  }

  const durationMs = Date.now() - startTime;
  const selfRepairRatePct =
    selfRepairsAttempted > 0
      ? (selfRepairsSucceeded / selfRepairsAttempted) * 100
      : 0;
  const averageTokenSavingsPct =
    aggregateTargetTokens > 0
      ? ((aggregateTargetTokens - aggregateAilTokens) / aggregateTargetTokens) * 100
      : 0;

  return {
    totalCycles,
    passedCycles,
    failedCycles,
    roundtripVerifications,
    idiomTransformIdentities,
    typecheckerVerifications,
    selfRepairsAttempted,
    selfRepairsSucceeded,
    selfRepairRatePct,
    multiIterationRepairs,
    runtimeEquivalenceVerifications,
    averageTokenSavingsPct,
    aggregateAilTokens,
    aggregateTargetTokens,
    targetBreakdown,
    corpusSamplesChecked,
    failures: allFailures,
    durationMs,
  };
}

/**
 * Asynchronous multi-cycle evolution execution loop.
 */
export async function runEvolutionLoop(
  options: EvolutionLoopOptions = {},
): Promise<EvolutionLoopReport> {
  return runEvolutionLoopSync(options);
}

/**
 * Executes a full multi-restart self-healing campaign across multiple seeds.
 */
export function runSelfHealingCampaignSync(
  options: SelfHealingCampaignOptions = {},
): SelfHealingCampaignReport {
  const startTime = Date.now();
  const totalRestarts = options.restarts ?? 100;
  const cyclesPerRestart = options.cyclesPerRestart ?? 10;
  const baseSeed = options.baseSeed ?? 1337;

  let completedRestarts = 0;
  let totalCyclesExecuted = 0;
  let totalRoundtripsVerified = 0;
  let totalIdiomIdentitiesVerified = 0;
  let totalSelfRepairsAttempted = 0;
  let totalSelfRepairsSucceeded = 0;
  let multiIterationRepairs = 0;
  let totalRuntimeEquivalenceVerifications = 0;
  let totalFailures = 0;
  let aggregateAil = 0;
  let aggregateTarget = 0;

  for (let r = 0; r < totalRestarts; r++) {
    const restartSeed = baseSeed + r * 1000;
    const report = runEvolutionLoopSync({
      cycles: cyclesPerRestart,
      seed: restartSeed,
      includeCorpus: options.includeCorpus !== false,
      corpusDir: options.corpusDir,
    });

    completedRestarts++;
    totalCyclesExecuted += report.totalCycles;
    totalRoundtripsVerified += report.roundtripVerifications;
    totalIdiomIdentitiesVerified += report.idiomTransformIdentities;
    totalSelfRepairsAttempted += report.selfRepairsAttempted;
    totalSelfRepairsSucceeded += report.selfRepairsSucceeded;
    multiIterationRepairs += report.multiIterationRepairs;
    totalRuntimeEquivalenceVerifications += report.runtimeEquivalenceVerifications;
    totalFailures += report.failedCycles;
    aggregateAil += report.aggregateAilTokens;
    aggregateTarget += report.aggregateTargetTokens;

    options.onRestart?.(r, report);
  }

  const durationMs = Date.now() - startTime;
  const averageTokenSavingsPct =
    aggregateTarget > 0
      ? ((aggregateTarget - aggregateAil) / aggregateTarget) * 100
      : 0;

  return {
    totalRestarts,
    completedRestarts,
    totalCyclesExecuted,
    totalRoundtripsVerified,
    totalIdiomIdentitiesVerified,
    totalSelfRepairsAttempted,
    totalSelfRepairsSucceeded,
    multiIterationRepairs,
    runtimeEquivalenceVerifications: totalRuntimeEquivalenceVerifications,
    averageTokenSavingsPct,
    totalFailures,
    durationMs,
  };
}

/**
 * Asynchronous multi-restart self-healing campaign.
 */
export async function runSelfHealingCampaign(
  options: SelfHealingCampaignOptions = {},
): Promise<SelfHealingCampaignReport> {
  return runSelfHealingCampaignSync(options);
}
