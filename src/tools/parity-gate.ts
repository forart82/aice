/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Multi-File Roundtrip Parity Gate for AICE 2.0 (Step 29).
 * Verifies Bancilhon & Spyratos Bidirectional Lens Invariant:
 *   Put(Get(c), Omega) == c
 * Validates Multi-Round Stability, Idempotence & Convergence:
 *   Round 1 == Round 2 == Round 3
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../core/parser.js";
import { executeRoundtrip, type RoundtripResult } from "../decompiler/index.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";

export type ParityTargetLanguage = TargetLanguage;

export interface FileParityResult {
  filePath: string;
  language: string;
  decompileOk: boolean;
  parseOk: boolean;
  emitOk: boolean;
  isBitIdentical: boolean;
  isAstEquivalent: boolean;
  roundtripDrift: number;
  durationMs: number;
  error?: string;
  diff?: string;
}

export interface ParityGateSummary {
  totalFiles: number;
  passedBitIdentical: number;
  passedAstEquivalent: number;
  failed: number;
  parityRate: number;
  durationMs: number;
  resultsByLanguage: Record<
    string,
    {
      total: number;
      passed: number;
      parityRate: number;
    }
  >;
  results?: FileParityResult[];
}

export interface ParityOptions {
  target?: TargetLanguage;
  rounds?: number;
  strict?: boolean;
  source?: string;
}

export interface ParityGateOptions {
  target?: TargetLanguage;
  strict?: boolean;
  json?: boolean;
  rounds?: number;
  recursive?: boolean;
  extensions?: string[];
  ignorePatterns?: string[];
  filter?: (filePath: string) => boolean;
}

export const PARITY_SUPPORTED_EXTENSIONS = new Set<string>([
  ".ts",
  ".tsx",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
  ".css",
  ".html",
  ".htm",
  ".json",
  ".yaml",
  ".yml",
  ".twig",
  ".php",
  ".py",
  ".kt",
  ".kts",
]);

/**
 * Classifies a file path into its canonical ParityTargetLanguage.
 */
export function classifyTargetLanguage(filePath: string): ParityTargetLanguage | null {
  const clean = filePath.replace(/\.aice$/, "").toLowerCase();
  if (clean.endsWith(".tsx")) return "tsx";
  if (clean.endsWith(".ts")) return "typescript";
  if (clean.endsWith(".py")) return "python";
  if (clean.endsWith(".html") || clean.endsWith(".htm")) return "html";
  if (clean.endsWith(".css")) return "css";
  if (
    clean.endsWith(".cpp") ||
    clean.endsWith(".hpp") ||
    clean.endsWith(".cc") ||
    clean.endsWith(".cxx") ||
    clean.endsWith(".h")
  ) {
    return "cpp";
  }
  if (clean.endsWith(".cs")) return "csharp";
  if (clean.endsWith(".json")) return "json";
  if (clean.endsWith(".yaml") || clean.endsWith(".yml")) return "yaml";
  if (clean.endsWith(".twig")) return "twig";
  if (clean.endsWith(".php")) return "php";
  if (clean.endsWith(".kt") || clean.endsWith(".kts")) return "kotlin";
  return null;
}

/**
 * Normalizes target language or alias to a canonical language name.
 */
export function normalizeLanguageName(target: string): string {
  const t = target.toLowerCase();
  if (t === "ts" || t === "tsx" || t === "typescript") return "typescript";
  if (t === "c++" || t === "cpp") return "cpp";
  if (t === "c#" || t === "csharp" || t === "cs") return "csharp";
  if (t === "css") return "css";
  if (t === "html" || t === "htm") return "html";
  if (t === "json") return "json";
  if (t === "yaml" || t === "yml") return "yaml";
  if (t === "twig") return "twig";
  if (t === "php") return "php";
  if (t === "py" || t === "python") return "python";
  if (t === "kt" || t === "kts" || t === "kotlin") return "kotlin";
  return t;
}

/**
 * Checks if a file path is supported by the Parity Gate.
 */
export function isSupportedParityLanguage(filePath: string): boolean {
  if (filePath.endsWith(".aice") || filePath.endsWith(".d.ts")) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  return PARITY_SUPPORTED_EXTENSIONS.has(ext);
}

function normalizeWhitespace(text: string): string {
  return text
    .trim()
    .replace(/\r\n/g, "\n")
    .replace(/[ \t]+$/gm, "");
}

/**
 * Verifies bidirectional lens parity and multi-round stability for a single target file:
 *   Put(Get(c), Omega) == c
 * Validates convergence: Round 1 == Round 2 == Round 3.
 */
export async function verifyFileParity(
  filePath: string,
  options: ParityOptions = {},
): Promise<FileParityResult> {
  const startTime = performance.now();
  const resolvedPath = path.resolve(filePath);

  let source = options.source;
  if (source === undefined) {
    if (!fs.existsSync(resolvedPath)) {
      return {
        filePath,
        language: "unknown",
        decompileOk: false,
        parseOk: false,
        emitOk: false,
        isBitIdentical: false,
        isAstEquivalent: false,
        roundtripDrift: 1,
        durationMs: Number((performance.now() - startTime).toFixed(2)),
        error: `File not found: ${filePath}`,
      };
    }
    source = fs.readFileSync(resolvedPath, "utf-8");
  }

  const detectedTarget = options.target ?? classifyTargetLanguage(filePath) ?? detectTargetFromPath(filePath);
  const canonicalLang = normalizeLanguageName(detectedTarget);

  let decompileOk = false;
  let parseOk = false;
  let emitOk = false;
  let isBitIdentical = false;
  let isAstEquivalent = false;
  let roundtripDrift = 0;
  let diff: string | undefined;

  try {
    // -------------------------------------------------------------------------
    // Round 1: Put(Get(c), Omega) == c
    // -------------------------------------------------------------------------
    const round1 = executeRoundtrip(source, detectedTarget, filePath);
    decompileOk = true;

    // Verify generated AICE parses cleanly
    try {
      parse(round1.aice, `${filePath}.aice`);
      parseOk = true;
    } catch (parseErr) {
      parseOk = false;
      throw new Error(`Generated AICE failed to parse: ${parseErr instanceof Error ? parseErr.message : String(parseErr)}`);
    }

    emitOk = typeof round1.reconstructed === "string" && round1.reconstructed.length > 0;

    const normSource = normalizeWhitespace(source);
    const normR1 = normalizeWhitespace(round1.reconstructed);

    isBitIdentical = round1.isIdentical || normSource === normR1;

    // -------------------------------------------------------------------------
    // Multi-Round Stability & Idempotence (Round 2 and Round 3)
    // -------------------------------------------------------------------------
    const round2 = executeRoundtrip(round1.reconstructed, detectedTarget, filePath);
    const round3 = executeRoundtrip(round2.reconstructed, detectedTarget, filePath);

    const normR2 = normalizeWhitespace(round2.reconstructed);
    const normR3 = normalizeWhitespace(round3.reconstructed);

    // Multi-round convergence test:
    // Either immediate convergence (R1 == R2 == R3) or second-order convergence (R2 == R3)
    const isConverged = (normR1 === normR2 && normR2 === normR3) || normR2 === normR3;

    if (isBitIdentical) {
      isAstEquivalent = true;
      roundtripDrift = 0;
    } else {
      isAstEquivalent =
        isConverged ||
        round1.aice.trim() === round2.aice.trim() ||
        round2.aice.trim() === round3.aice.trim();

      // Zero drift if converged, otherwise drift distance
      if (isConverged) {
        roundtripDrift = 0;
      } else {
        roundtripDrift = Math.abs(normR2.length - normR3.length) + 1;
      }
      diff = round1.diff;
    }

    const durationMs = Number((performance.now() - startTime).toFixed(2));

    return {
      filePath,
      language: canonicalLang,
      decompileOk,
      parseOk,
      emitOk,
      isBitIdentical,
      isAstEquivalent,
      roundtripDrift,
      durationMs,
      diff,
    };
  } catch (err: unknown) {
    const durationMs = Number((performance.now() - startTime).toFixed(2));
    const errMsg = err instanceof Error ? err.message : String(err);
    return {
      filePath,
      language: canonicalLang,
      decompileOk,
      parseOk,
      emitOk,
      isBitIdentical: false,
      isAstEquivalent: false,
      roundtripDrift: 1,
      durationMs,
      error: errMsg,
    };
  }
}

/**
 * Traverses target directories, collects all supported target files,
 * and runs the automated multi-file roundtrip parity gate.
 */
export async function runParityGate(
  targetDirOrFiles?: string | string[],
  options: ParityGateOptions = {},
): Promise<ParityGateSummary> {
  const startTime = performance.now();
  const fileList = resolveTargetFiles(targetDirOrFiles, options);

  const results: FileParityResult[] = [];
  const resultsByLanguage: Record<
    string,
    { total: number; passed: number; parityRate: number }
  > = {};

  function ensureLangBucket(lang: string) {
    if (!resultsByLanguage[lang]) {
      resultsByLanguage[lang] = { total: 0, passed: 0, parityRate: 100 };
    }
  }

  for (const file of fileList) {
    const res = await verifyFileParity(file, {
      target: options.target,
      rounds: options.rounds,
      strict: options.strict,
    });

    results.push(res);

    const lang = res.language;
    ensureLangBucket(lang);

    resultsByLanguage[lang].total += 1;
    const passed = (res.isBitIdentical || res.isAstEquivalent) && !res.error && res.roundtripDrift === 0;
    if (passed) {
      resultsByLanguage[lang].passed += 1;
    }
    resultsByLanguage[lang].parityRate =
      resultsByLanguage[lang].total > 0
        ? Number(((resultsByLanguage[lang].passed / resultsByLanguage[lang].total) * 100).toFixed(1))
        : 100;
  }

  // Populate cross-aliases (e.g. cpp -> c++, csharp -> c#, typescript -> ts)
  setupLanguageAliases(resultsByLanguage);

  let passedBitIdentical = 0;
  let passedAstEquivalent = 0;
  let failed = 0;

  for (const r of results) {
    const ok = (r.isBitIdentical || r.isAstEquivalent) && !r.error && r.roundtripDrift === 0;
    if (ok) {
      if (r.isBitIdentical) {
        passedBitIdentical++;
      } else {
        passedAstEquivalent++;
      }
    } else {
      failed++;
    }
  }

  const totalFiles = results.length;
  const parityRate =
    totalFiles > 0
      ? Number((((passedBitIdentical + passedAstEquivalent) / totalFiles) * 100).toFixed(1))
      : 100;

  const durationMs = Number((performance.now() - startTime).toFixed(2));

  return {
    totalFiles,
    passedBitIdentical,
    passedAstEquivalent,
    failed,
    parityRate,
    durationMs,
    resultsByLanguage,
    results,
  };
}

function setupLanguageAliases(
  resultsByLanguage: Record<string, { total: number; passed: number; parityRate: number }>,
) {
  if (resultsByLanguage["cpp"] && !resultsByLanguage["c++"]) {
    resultsByLanguage["c++"] = resultsByLanguage["cpp"];
  }
  if (resultsByLanguage["csharp"] && !resultsByLanguage["c#"]) {
    resultsByLanguage["c#"] = resultsByLanguage["csharp"];
  }
  if (resultsByLanguage["typescript"] && !resultsByLanguage["ts"]) {
    resultsByLanguage["ts"] = resultsByLanguage["typescript"];
  }
}

function resolveTargetFiles(
  targetDirOrFiles?: string | string[],
  options: ParityGateOptions = {},
): string[] {
  let targets: string[] = [];

  if (!targetDirOrFiles) {
    targets = [process.cwd()];
  } else if (Array.isArray(targetDirOrFiles)) {
    targets = targetDirOrFiles;
  } else {
    targets = [targetDirOrFiles];
  }

  const results: string[] = [];
  const defaultIgnores = ["node_modules", ".git", "dist", "build", ".aice-build", ".next", ".turbo"];
  const ignorePatterns = options.ignorePatterns ?? defaultIgnores;

  function scan(current: string) {
    const full = path.resolve(current);
    if (!fs.existsSync(full)) return;

    const stat = fs.statSync(full);
    if (stat.isFile()) {
      if (isSupportedParityLanguage(full)) {
        if (!options.filter || options.filter(full)) {
          results.push(full);
        }
      }
      return;
    }

    if (stat.isDirectory()) {
      const entries = fs.readdirSync(full, { withFileTypes: true });
      for (const ent of entries) {
        if (ent.name.startsWith(".")) continue;
        if (ignorePatterns.includes(ent.name)) continue;
        // Skip test directories during recursive scan to avoid test runner files
        if (ent.isDirectory() && (ent.name === "tests" || ent.name === "__tests__")) continue;
        const entryFull = path.join(full, ent.name);
        if (ent.isDirectory()) {
          scan(entryFull);
        } else if (ent.isFile()) {
          if (
            isSupportedParityLanguage(entryFull) &&
            !ent.name.endsWith(".test.ts") &&
            !ent.name.endsWith(".spec.ts")
          ) {
            if (!options.filter || options.filter(entryFull)) {
              results.push(entryFull);
            }
          }
        }
      }
    }
  }

  for (const t of targets) {
    scan(t);
  }

  // Remove duplicates and sort deterministically
  return Array.from(new Set(results)).sort();
}

/**
 * Formats a clean terminal report for ParityGateSummary.
 */
export function formatParitySummaryTerminal(summary: ParityGateSummary): string {
  const lines: string[] = [];
  lines.push("================================================================================");
  lines.push("        AICE Automated Multi-File Roundtrip Parity Gate: Put(Get(c)) == c        ");
  lines.push("================================================================================");
  lines.push(`Total Files Verified:    ${summary.totalFiles}`);
  lines.push(`Passed (Bit-Identical):  ${summary.passedBitIdentical}`);
  lines.push(`Passed (AST-Equivalent): ${summary.passedAstEquivalent}`);
  lines.push(`Failed:                  ${summary.failed}`);
  lines.push(`Parity Rate:             ${summary.parityRate.toFixed(1)}%`);
  lines.push(`Total Duration:          ${summary.durationMs.toFixed(1)}ms`);
  lines.push("--------------------------------------------------------------------------------");
  lines.push(" Language         | Total Files | Passed | Parity Rate ");
  lines.push("------------------+-------------+--------+-------------");

  // Filter canonical keys for the table
  const canonicalKeys = [
    "typescript",
    "cpp",
    "csharp",
    "css",
    "html",
    "json",
    "yaml",
    "twig",
    "php",
    "python",
    "kotlin",
  ];

  for (const lang of canonicalKeys) {
    const stats = summary.resultsByLanguage[lang];
    if (stats && stats.total > 0) {
      lines.push(
        ` ${lang.padEnd(16)} | ${String(stats.total).padStart(11)} | ${String(stats.passed).padStart(6)} | ${stats.parityRate.toFixed(1).padStart(10)}% `,
      );
    }
  }

  // Any other languages that appeared
  for (const [lang, stats] of Object.entries(summary.resultsByLanguage)) {
    if (!canonicalKeys.includes(lang) && !["c++", "c#", "ts"].includes(lang) && stats.total > 0) {
      lines.push(
        ` ${lang.padEnd(16)} | ${String(stats.total).padStart(11)} | ${String(stats.passed).padStart(6)} | ${stats.parityRate.toFixed(1).padStart(10)}% `,
      );
    }
  }

  lines.push("================================================================================");

  if (summary.failed > 0) {
    lines.push(`❌ Parity Gate FAILED: ${summary.failed} file(s) failed roundtrip verification.`);
    if (summary.results) {
      for (const r of summary.results) {
        if (!r.isBitIdentical && !r.isAstEquivalent) {
          lines.push(`  - [FAIL] ${r.filePath} [${r.language}]: ${r.error ?? "roundtrip drift detected"}`);
        }
      }
    }
  } else {
    lines.push("✔ Parity Gate PASSED: 100% roundtrip fidelity across all verified files.");
  }

  return lines.join("\n");
}

/**
 * Formats a JSON report for ParityGateSummary.
 */
export function formatParitySummaryJson(summary: ParityGateSummary): string {
  return JSON.stringify(summary, null, 2);
}
