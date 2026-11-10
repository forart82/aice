/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Tokenomics CI Quality Gate & Regression Engine for AICE 2.0.
 * Computes exact BPE token counts (cl100k_base, o200k_base) and character savings,
 * and enforces zero target drift.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import { getEncoding } from "js-tiktoken";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
} from "../config/index.js";
import { parse } from "../core/parser.js";
import { decompile } from "../decompiler/index.js";
import { detectTargetFromPath, emitTarget } from "../emitters/index.js";
import { collapseAiceSourceIdioms } from "../idioms/index.js";
import { withSuppressedTelemetry } from "../telemetry/index.js";

let cl100k: ReturnType<typeof getEncoding> | undefined;
let o200k: ReturnType<typeof getEncoding> | undefined;

const MAX_TOKEN_CACHE_ENTRIES = 512;
const MAX_CACHEABLE_TEXT_LENGTH = 500_000;
const tokenCountCache = new Map<string, number>();

function getTokenizerEncoding(encoding: "cl100k_base" | "o200k_base" = "cl100k_base") {
  if (encoding === "o200k_base") {
    if (!o200k) o200k = getEncoding("o200k_base");
    return o200k;
  }
  if (!cl100k) cl100k = getEncoding("cl100k_base");
  return cl100k;
}

export function estimateTokens(
  text: string,
  encoding: "cl100k_base" | "o200k_base" = "cl100k_base",
): number {
  if (!text) return 0;
  if (text.length <= MAX_CACHEABLE_TEXT_LENGTH) {
    const cacheKey =
      text.length <= 128
        ? `${encoding}:s:${text}`
        : `${encoding}:h:${text.length}:${createHash("sha256").update(text, "utf-8").digest("hex").slice(0, 32)}`;
    const cached = tokenCountCache.get(cacheKey);
    if (cached !== undefined) {
      tokenCountCache.delete(cacheKey);
      tokenCountCache.set(cacheKey, cached);
      return cached;
    }
    const count = getTokenizerEncoding(encoding).encode(text).length;
    if (tokenCountCache.size >= MAX_TOKEN_CACHE_ENTRIES) {
      const oldestKey = tokenCountCache.keys().next().value;
      if (oldestKey !== undefined) {
        tokenCountCache.delete(oldestKey);
      }
    }
    tokenCountCache.set(cacheKey, count);
    return count;
  }
  return getTokenizerEncoding(encoding).encode(text).length;
}

export class TiktokenTokenizer {
  public static count(
    text: string,
    encoding: "cl100k_base" | "o200k_base" = "cl100k_base",
  ): number {
    return estimateTokens(text, encoding);
  }

  public count(text: string, encoding: "cl100k_base" | "o200k_base" = "cl100k_base"): number {
    return estimateTokens(text, encoding);
  }

  public encode(text: string, encoding: "cl100k_base" | "o200k_base" = "cl100k_base"): number[] {
    return Array.from(getTokenizerEncoding(encoding).encode(text));
  }
}

export interface TokenomicsFileResult {
  file: string;
  project?: string;
  targetLang: string;
  targetChars: number;
  aiceChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  aiceCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  aiceO200k: number;
  o200kSavingsPct: number;
  drift: boolean;
  driftChecked?: boolean;
  diffSummary?: string;
}

export interface TokenomicsAggregate {
  targetChars: number;
  aiceChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  aiceCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  aiceO200k: number;
  o200kSavingsPct: number;
}

export interface TokenomicsAuditReport {
  status: "SUCCESS" | "FAILURE";
  minSavingsRequired?: number;
  passedThreshold: boolean;
  driftDetected: boolean;
  aggregate: TokenomicsAggregate;
  files: TokenomicsFileResult[];
}

export function detectLanguageName(filePath: string): string {
  const lower = filePath.toLowerCase();
  if (lower.endsWith(".tsx") || lower.endsWith(".jsx")) return "TSX / React";
  if (lower.endsWith(".ts") || lower.endsWith(".d.ts")) return "TypeScript";
  if (lower.endsWith(".js") || lower.endsWith(".mjs") || lower.endsWith(".cjs"))
    return "JavaScript";
  if (lower.endsWith(".py") || lower.endsWith(".pyi")) return "Python";
  if (lower.endsWith(".rs")) return "Rust";
  if (lower.endsWith(".go")) return "Go";
  if (
    lower.endsWith(".cpp") ||
    lower.endsWith(".cc") ||
    lower.endsWith(".cxx") ||
    lower.endsWith(".hpp") ||
    lower.endsWith(".h")
  )
    return "C++20";
  if (lower.endsWith(".cs")) return "C#";
  if (lower.endsWith(".kt") || lower.endsWith(".kts")) return "Kotlin";
  if (lower.endsWith(".php")) return "PHP";
  if (lower.endsWith(".twig") || lower.endsWith(".html.twig")) return "Twig";
  if (lower.endsWith(".html") || lower.endsWith(".htm")) return "HTML";
  if (lower.endsWith(".css")) return "CSS";
  if (lower.endsWith(".json")) return "JSON";
  if (lower.endsWith(".yaml") || lower.endsWith(".yml")) return "YAML";
  if (lower.endsWith(".sh") || lower.endsWith(".bash") || lower.endsWith(".zsh")) return "Shell";
  if (lower.endsWith(".ps1")) return "PowerShell";
  if (lower.endsWith(".cmd") || lower.endsWith(".bat")) return "Batch";
  if (lower.endsWith(".md") || lower.endsWith(".markdown")) return "Markdown";
  if (lower.endsWith(".aice")) return "AICE";
  return "TypeScript";
}
export function calculateFileTokenomics(
  aiceContent: string,
  targetContent: string,
  targetPath: string,
  checkDrift = false,
  aicePath = "",
  project = "",
): TokenomicsFileResult {
  const targetChars = targetContent.length;
  const aiceChars = aiceContent.length;
  const charSavingsPct = targetChars > 0 ? ((targetChars - aiceChars) / targetChars) * 100 : 0;

  const encCl100k = getTokenizerEncoding("cl100k_base");
  const encO200k = getTokenizerEncoding("o200k_base");
  const targetCl100k = encCl100k.encode(targetContent).length;
  const aiceCl100k = encCl100k.encode(aiceContent).length;
  const cl100kSavingsPct =
    targetCl100k > 0 ? ((targetCl100k - aiceCl100k) / targetCl100k) * 100 : 0;

  const targetO200k = encO200k.encode(targetContent).length;
  const aiceO200k = encO200k.encode(aiceContent).length;
  const o200kSavingsPct = targetO200k > 0 ? ((targetO200k - aiceO200k) / targetO200k) * 100 : 0;

  let drift = false;
  let diffSummary: string | undefined;

  if (checkDrift && aicePath) {
    try {
      const mod = parse(aiceContent, aicePath);
      const targetLang = detectTargetFromPath(aicePath);
      const hasWatermarkInTarget = targetContent.includes("@generated by AICE");
      const emitted = emitTarget(mod, targetLang, { watermark: hasWatermarkInTarget });
      if (emitted.trim() !== targetContent.trim()) {
        drift = true;
        if (targetContent.length !== emitted.length) {
          diffSummary = `Length mismatch: expected ${targetContent.length}, got ${emitted.length}`;
        } else {
          diffSummary = `Content mismatch between emitted output and target file`;
        }
      }
    } catch (err: unknown) {
      drift = true;
      diffSummary = `Compilation error: ${err instanceof Error ? err.message : String(err)}`;
    }
  }

  return {
    file: path.basename(targetPath),
    project,
    targetLang: detectLanguageName(targetPath),
    targetChars,
    aiceChars,
    charSavingsPct,
    targetCl100k,
    aiceCl100k,
    cl100kSavingsPct,
    targetO200k,
    aiceO200k,
    o200kSavingsPct,
    drift,
    driftChecked: checkDrift,
    diffSummary,
  };
}

export interface TokenomicsAuditOptions {
  minSavings?: number;
  checkDrift?: boolean;
  idioms?: boolean;
}

export function auditTokenomics(
  targetPath: string,
  options: TokenomicsAuditOptions = {},
): TokenomicsAuditReport {
  const resolved = path.resolve(process.cwd(), targetPath);
  if (!fs.existsSync(resolved)) {
    throw new Error(`File or directory not found: ${targetPath}`);
  }

  const stat = fs.statSync(resolved);
  const files: TokenomicsFileResult[] = [];
  const projectRoot = findProjectRoot(stat.isDirectory() ? resolved : path.dirname(resolved));
  const config = loadProjectConfig(projectRoot);
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }
  const activeIdioms = isProjectIdiomsEnabled(config, options.idioms) ? config.idioms : undefined;

  if (stat.isFile()) {
    const isAice = resolved.endsWith(".aice");
    let aiceFile: string;
    let targetFile: string;
    let aiceContent: string;
    let targetContent: string;

    if (isAice) {
      aiceFile = resolved;
      targetFile = aiceFile.replace(/\.aice$/, "");
      aiceContent = fs.readFileSync(aiceFile, "utf-8");
      if (fs.existsSync(targetFile)) {
        targetContent = fs.readFileSync(targetFile, "utf-8");
      } else {
        const targetLang = detectTargetFromPath(aiceFile);
        const mod = parse(aiceContent, aiceFile);
        targetContent = emitTarget(mod, targetLang, { watermark: false });
      }
    } else {
      targetFile = resolved;
      aiceFile = `${targetFile}.aice`;
      targetContent = fs.readFileSync(targetFile, "utf-8");
      const targetLang = detectTargetFromPath(targetFile);
      try {
        const decomp = withSuppressedTelemetry(() =>
          decompile(targetContent, targetLang, { filePath: targetFile }),
        );
        aiceContent = decomp.aice;
        if (activeIdioms && Object.keys(activeIdioms).length > 0) {
          aiceContent = collapseAiceSourceIdioms(aiceContent, activeIdioms, targetFile).aice;
        }
      } catch (err: unknown) {
        throw new Error(
          `Failed to evaluate token efficiency for ${targetFile}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }

    const relAicePath = path.relative(process.cwd(), aiceFile);
    const project = path.basename(path.dirname(resolved));

    const result = calculateFileTokenomics(
      aiceContent,
      targetContent,
      targetFile,
      options.checkDrift ?? false,
      relAicePath,
      project,
    );
    files.push(result);
  } else if (stat.isDirectory()) {
    const searchDir = resolved;
    const processedTargets = new Set<string>();

    function walk(cur: string): { aiceFiles: string[]; targetCandidates: string[] } {
      const entries = fs.readdirSync(cur, { withFileTypes: true });
      const aices: string[] = [];
      const targets: string[] = [];

      for (const entry of entries) {
        if (
          entry.name === "node_modules" ||
          entry.name === ".git" ||
          entry.name === "dist" ||
          entry.name === "build" ||
          entry.name === ".next" ||
          entry.name === ".turbo" ||
          entry.name.startsWith(".")
        ) {
          continue;
        }

        const full = path.resolve(cur, entry.name);
        if (entry.isDirectory()) {
          const sub = walk(full);
          aices.push(...sub.aiceFiles);
          targets.push(...sub.targetCandidates);
        } else if (entry.isFile()) {
          if (entry.name.endsWith(".trivia.json")) {
            continue;
          }
          if (entry.name.endsWith(".aice")) {
            aices.push(full);
          } else {
            const ext = path.extname(entry.name);
            if (
              ext === ".ts" ||
              ext === ".tsx" ||
              ext === ".css" ||
              ext === ".html" ||
              ext === ".py" ||
              ext === ".cpp" ||
              ext === ".hpp" ||
              ext === ".h" ||
              ext === ".cc" ||
              ext === ".cxx" ||
              ext === ".cs" ||
              ext === ".go" ||
              ext === ".rs"
            ) {
              targets.push(full);
            }
          }
        }
      }
      return { aiceFiles: aices, targetCandidates: targets };
    }

    const { aiceFiles, targetCandidates } = walk(searchDir);

    if (aiceFiles.length > 0) {
      for (const aiceFile of aiceFiles) {
        const targetFile = aiceFile.replace(/\.aice$/, "");
        const relAicePath = path.relative(process.cwd(), aiceFile);
        const relFromSearch = path.relative(searchDir, aiceFile);
        const parts = relFromSearch.split(path.sep);
        const project = parts.length > 1 ? parts[0] : path.basename(searchDir);

        let targetContent = "";
        const aiceContent = fs.readFileSync(aiceFile, "utf-8");

        if (fs.existsSync(targetFile)) {
          targetContent = fs.readFileSync(targetFile, "utf-8");
          processedTargets.add(targetFile);
        } else {
          const targetLang = detectTargetFromPath(aiceFile);
          const mod = parse(aiceContent, aiceFile);
          targetContent = emitTarget(mod, targetLang, { watermark: false });
        }

        const result = calculateFileTokenomics(
          aiceContent,
          targetContent,
          targetFile,
          options.checkDrift ?? false,
          relAicePath,
          project,
        );
        files.push(result);
      }
    } else {
      for (const targetFile of targetCandidates) {
        if (processedTargets.has(targetFile)) continue;
        const targetLang = detectTargetFromPath(targetFile);
        try {
          const targetContent = fs.readFileSync(targetFile, "utf-8");
          const decomp = withSuppressedTelemetry(() =>
            decompile(targetContent, targetLang, { filePath: targetFile }),
          );
          let aiceContent = decomp.aice;
          if (activeIdioms && Object.keys(activeIdioms).length > 0) {
            aiceContent = collapseAiceSourceIdioms(aiceContent, activeIdioms, targetFile).aice;
          }
          const relFromSearch = path.relative(searchDir, targetFile);
          const parts = relFromSearch.split(path.sep);
          const project = parts.length > 1 ? parts[0] : path.basename(searchDir);

          const result = calculateFileTokenomics(
            aiceContent,
            targetContent,
            targetFile,
            options.checkDrift ?? false,
            `${targetFile}.aice`,
            project,
          );
          files.push(result);
        } catch {
          // Skip files that cannot be decompiled in memory
        }
      }
    }
  }

  // Sort by language, then filename
  files.sort((a, b) => a.targetLang.localeCompare(b.targetLang) || a.file.localeCompare(b.file));

  let totalTargetChars = 0;
  let totalAiceChars = 0;
  let totalTargetCl100k = 0;
  let totalAiceCl100k = 0;
  let totalTargetO200k = 0;
  let totalAiceO200k = 0;
  let driftDetected = false;

  for (const f of files) {
    totalTargetChars += f.targetChars;
    totalAiceChars += f.aiceChars;
    totalTargetCl100k += f.targetCl100k;
    totalAiceCl100k += f.aiceCl100k;
    totalTargetO200k += f.targetO200k;
    totalAiceO200k += f.aiceO200k;
    if (f.drift) driftDetected = true;
  }

  const charSavingsPct =
    totalTargetChars > 0 ? ((totalTargetChars - totalAiceChars) / totalTargetChars) * 100 : 0;
  const cl100kSavingsPct =
    totalTargetCl100k > 0 ? ((totalTargetCl100k - totalAiceCl100k) / totalTargetCl100k) * 100 : 0;
  const o200kSavingsPct =
    totalTargetO200k > 0 ? ((totalTargetO200k - totalAiceO200k) / totalTargetO200k) * 100 : 0;

  const aggregate: TokenomicsAggregate = {
    targetChars: totalTargetChars,
    aiceChars: totalAiceChars,
    charSavingsPct,
    targetCl100k: totalTargetCl100k,
    aiceCl100k: totalAiceCl100k,
    cl100kSavingsPct,
    targetO200k: totalTargetO200k,
    aiceO200k: totalAiceO200k,
    o200kSavingsPct,
  };

  let passedThreshold = true;
  if (options.minSavings !== undefined) {
    if (
      cl100kSavingsPct < options.minSavings ||
      o200kSavingsPct < options.minSavings ||
      charSavingsPct < options.minSavings
    ) {
      passedThreshold = false;
    }
  }

  const status = passedThreshold && !driftDetected ? "SUCCESS" : "FAILURE";

  return {
    status,
    minSavingsRequired: options.minSavings,
    passedThreshold,
    driftDetected,
    aggregate,
    files,
  };
}

export * from "./terminal-formatter.js";

export function formatTokenomicsMarkdownTable(report: TokenomicsAuditReport): string {
  const lines: string[] = [];
  lines.push(
    "| File | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |",
  );
  lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (const f of report.files) {
    const clSign = f.cl100kSavingsPct >= 0 ? "-" : "+";
    const o2Sign = f.o200kSavingsPct >= 0 ? "-" : "+";
    const chSign = f.charSavingsPct >= 0 ? "-" : "+";

    const clStr = `**${clSign}${Math.abs(f.cl100kSavingsPct).toFixed(1)}%**`;
    const o2Str = `**${o2Sign}${Math.abs(f.o200kSavingsPct).toFixed(1)}%**`;
    const chStr = `${chSign}${Math.abs(f.charSavingsPct).toFixed(1)}%`;

    lines.push(
      `| \`${f.file}\` | ${f.targetLang} | ${f.targetCl100k.toLocaleString()} | ${f.aiceCl100k.toLocaleString()} | ${clStr} | ${f.targetO200k.toLocaleString()} | ${f.aiceO200k.toLocaleString()} | ${o2Str} | ${chStr} |`,
    );
  }

  lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  const agg = report.aggregate;
  const clSign = agg.cl100kSavingsPct >= 0 ? "-" : "+";
  const o2Sign = agg.o200kSavingsPct >= 0 ? "-" : "+";
  const chSign = agg.charSavingsPct >= 0 ? "-" : "+";

  const totalClStr = `**${clSign}${Math.abs(agg.cl100kSavingsPct).toFixed(1)}%**`;
  const totalO2Str = `**${o2Sign}${Math.abs(agg.o200kSavingsPct).toFixed(1)}%**`;
  const totalChStr = `**${chSign}${Math.abs(agg.charSavingsPct).toFixed(1)}%**`;

  lines.push(
    `| **TOTAL (${report.files.length} ${report.files.length === 1 ? "File" : "Files"})** | **Aggregated** | **${agg.targetCl100k.toLocaleString()}** | **${agg.aiceCl100k.toLocaleString()}** | ${totalClStr} | **${agg.targetO200k.toLocaleString()}** | **${agg.aiceO200k.toLocaleString()}** | ${totalO2Str} | ${totalChStr} |`,
  );

  return lines.join("\n");
}

export interface ProjectTokenomicsSummary {
  project: string;
  targetLang: string;
  fileCount: number;
  targetChars: number;
  aiceChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  aiceCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  aiceO200k: number;
  o200kSavingsPct: number;
}

export function formatProjectsMarkdownTable(report: TokenomicsAuditReport): string {
  const projectMap = new Map<string, ProjectTokenomicsSummary>();

  for (const f of report.files) {
    const proj = f.project || "default";
    let entry = projectMap.get(proj);
    if (!entry) {
      entry = {
        project: proj,
        targetLang: f.targetLang,
        fileCount: 0,
        targetChars: 0,
        aiceChars: 0,
        charSavingsPct: 0,
        targetCl100k: 0,
        aiceCl100k: 0,
        cl100kSavingsPct: 0,
        targetO200k: 0,
        aiceO200k: 0,
        o200kSavingsPct: 0,
      };
      projectMap.set(proj, entry);
    }
    entry.fileCount++;
    entry.targetChars += f.targetChars;
    entry.aiceChars += f.aiceChars;
    entry.targetCl100k += f.targetCl100k;
    entry.aiceCl100k += f.aiceCl100k;
    entry.targetO200k += f.targetO200k;
    entry.aiceO200k += f.aiceO200k;
    if (entry.targetLang !== f.targetLang) {
      entry.targetLang = "Polyglot";
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) =>
    a.project.localeCompare(b.project),
  );
  for (const p of projects) {
    p.cl100kSavingsPct =
      p.targetCl100k > 0 ? ((p.targetCl100k - p.aiceCl100k) / p.targetCl100k) * 100 : 0;
    p.o200kSavingsPct =
      p.targetO200k > 0 ? ((p.targetO200k - p.aiceO200k) / p.targetO200k) * 100 : 0;
    p.charSavingsPct =
      p.targetChars > 0 ? ((p.targetChars - p.aiceChars) / p.targetChars) * 100 : 0;
  }

  const lines: string[] = [];
  lines.push(
    "| File | Target Lang | Target cl100k | AICE cl100k | cl100k Savings | Target o200k | AICE o200k | o200k Savings | Char Savings |",
  );
  lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  for (const p of projects) {
    const clSign = p.cl100kSavingsPct >= 0 ? "-" : "+";
    const o2Sign = p.o200kSavingsPct >= 0 ? "-" : "+";
    const chSign = p.charSavingsPct >= 0 ? "-" : "+";

    const clStr = `**${clSign}${Math.abs(p.cl100kSavingsPct).toFixed(1)}%**`;
    const o2Str = `**${o2Sign}${Math.abs(p.o200kSavingsPct).toFixed(1)}%**`;
    const chStr = `${chSign}${Math.abs(p.charSavingsPct).toFixed(1)}%`;

    lines.push(
      `| \`${p.project}\` (${p.fileCount} files) | ${p.targetLang} | ${p.targetCl100k.toLocaleString()} | ${p.aiceCl100k.toLocaleString()} | ${clStr} | ${p.targetO200k.toLocaleString()} | ${p.aiceO200k.toLocaleString()} | ${o2Str} | ${chStr} |`,
    );
  }

  lines.push("| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |");

  const agg = report.aggregate;
  const clSign = agg.cl100kSavingsPct >= 0 ? "-" : "+";
  const o2Sign = agg.o200kSavingsPct >= 0 ? "-" : "+";
  const chSign = agg.charSavingsPct >= 0 ? "-" : "+";

  const totalClStr = `**${clSign}${Math.abs(agg.cl100kSavingsPct).toFixed(1)}%**`;
  const totalO2Str = `**${o2Sign}${Math.abs(agg.o200kSavingsPct).toFixed(1)}%**`;
  const totalChStr = `**${chSign}${Math.abs(agg.charSavingsPct).toFixed(1)}%**`;

  lines.push(
    `| **TOTAL (${projects.length} Projects / ${report.files.length} Files)** | **Aggregated** | **${agg.targetCl100k.toLocaleString()}** | **${agg.aiceCl100k.toLocaleString()}** | ${totalClStr} | **${agg.targetO200k.toLocaleString()}** | **${agg.aiceO200k.toLocaleString()}** | ${totalO2Str} | ${totalChStr} |`,
  );

  return lines.join("\n");
}
