/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Automated Tokenomics CI Quality Gate & Regression Engine for AIL 2.0.
 * Computes exact BPE token counts (cl100k_base, o200k_base) and character savings,
 * and enforces zero target drift.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getEncoding } from "js-tiktoken";
import { parse } from "../core/parser.js";
import { detectTargetFromPath, emitTarget } from "../emitters/index.js";

const cl100k = getEncoding("cl100k_base");
const o200k = getEncoding("o200k_base");

export interface TokenomicsFileResult {
  file: string;
  project?: string;
  targetLang: string;
  targetChars: number;
  ailChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  ailCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  ailO200k: number;
  o200kSavingsPct: number;
  drift: boolean;
  diffSummary?: string;
}

export interface TokenomicsAggregate {
  targetChars: number;
  ailChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  ailCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  ailO200k: number;
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

export function detectLanguageName(targetPath: string): string {
  const ext = path.extname(targetPath);
  switch (ext) {
    case ".ts":
      return "TypeScript";
    case ".tsx":
      return "React TSX";
    case ".py":
      return "Python";
    case ".css":
      return "CSS3";
    case ".html":
      return "HTML5";
    case ".go":
      return "Go";
    case ".rs":
      return "Rust";
    case ".cpp":
    case ".hpp":
    case ".h":
    case ".cc":
      return "C++20";
    default:
      return ext || "unknown";
  }
}

export function calculateFileTokenomics(
  ailContent: string,
  targetContent: string,
  targetPath: string,
  checkDrift = false,
  ailPath = "",
  project = "",
): TokenomicsFileResult {
  const targetChars = targetContent.length;
  const ailChars = ailContent.length;
  const charSavingsPct = targetChars > 0 ? ((targetChars - ailChars) / targetChars) * 100 : 0;

  const targetCl100k = cl100k.encode(targetContent).length;
  const ailCl100k = cl100k.encode(ailContent).length;
  const cl100kSavingsPct = targetCl100k > 0 ? ((targetCl100k - ailCl100k) / targetCl100k) * 100 : 0;

  const targetO200k = o200k.encode(targetContent).length;
  const ailO200k = o200k.encode(ailContent).length;
  const o200kSavingsPct = targetO200k > 0 ? ((targetO200k - ailO200k) / targetO200k) * 100 : 0;

  let drift = false;
  let diffSummary: string | undefined;

  if (checkDrift && ailPath) {
    try {
      const mod = parse(ailContent, ailPath);
      const targetLang = detectTargetFromPath(ailPath);
      const emitted = emitTarget(mod, targetLang);
      if (emitted.trim() !== targetContent.trim()) {
        drift = true;
        diffSummary = `Expected length ${targetContent.length}, got ${emitted.length}`;
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
    ailChars,
    charSavingsPct,
    targetCl100k,
    ailCl100k,
    cl100kSavingsPct,
    targetO200k,
    ailO200k,
    o200kSavingsPct,
    drift,
    diffSummary,
  };
}

export function auditTokenomics(
  dir: string,
  options: { minSavings?: number; checkDrift?: boolean } = {},
): TokenomicsAuditReport {
  const searchDir = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(searchDir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  function findAilFiles(cur: string): string[] {
    const entries = fs.readdirSync(cur, { withFileTypes: true });
    const results: string[] = [];
    for (const entry of entries) {
      const full = path.resolve(cur, entry.name);
      if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
        results.push(...findAilFiles(full));
      } else if (entry.isFile() && entry.name.endsWith(".ail")) {
        results.push(full);
      }
    }
    return results;
  }

  const ailFiles = findAilFiles(searchDir);
  const files: TokenomicsFileResult[] = [];

  for (const ailFile of ailFiles) {
    const targetFile = ailFile.replace(/\.ail$/, "");
    if (!fs.existsSync(targetFile)) {
      continue;
    }

    const ailContent = fs.readFileSync(ailFile, "utf-8");
    const targetContent = fs.readFileSync(targetFile, "utf-8");
    const relAilPath = path.relative(process.cwd(), ailFile);

    const relFromSearch = path.relative(searchDir, ailFile);
    const parts = relFromSearch.split(path.sep);
    const project = parts.length > 1 ? parts[0] : path.basename(searchDir);

    const result = calculateFileTokenomics(
      ailContent,
      targetContent,
      targetFile,
      options.checkDrift ?? false,
      relAilPath,
      project,
    );
    files.push(result);
  }

  // Sort by language, then filename
  files.sort((a, b) => a.targetLang.localeCompare(b.targetLang) || a.file.localeCompare(b.file));

  let totalTargetChars = 0;
  let totalAilChars = 0;
  let totalTargetCl100k = 0;
  let totalAilCl100k = 0;
  let totalTargetO200k = 0;
  let totalAilO200k = 0;
  let driftDetected = false;

  for (const f of files) {
    totalTargetChars += f.targetChars;
    totalAilChars += f.ailChars;
    totalTargetCl100k += f.targetCl100k;
    totalAilCl100k += f.ailCl100k;
    totalTargetO200k += f.targetO200k;
    totalAilO200k += f.ailO200k;
    if (f.drift) driftDetected = true;
  }

  const charSavingsPct =
    totalTargetChars > 0 ? ((totalTargetChars - totalAilChars) / totalTargetChars) * 100 : 0;
  const cl100kSavingsPct =
    totalTargetCl100k > 0 ? ((totalTargetCl100k - totalAilCl100k) / totalTargetCl100k) * 100 : 0;
  const o200kSavingsPct =
    totalTargetO200k > 0 ? ((totalTargetO200k - totalAilO200k) / totalTargetO200k) * 100 : 0;

  const aggregate: TokenomicsAggregate = {
    targetChars: totalTargetChars,
    ailChars: totalAilChars,
    charSavingsPct,
    targetCl100k: totalTargetCl100k,
    ailCl100k: totalAilCl100k,
    cl100kSavingsPct,
    targetO200k: totalTargetO200k,
    ailO200k: totalAilO200k,
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

export function formatTokenomicsMarkdownTable(report: TokenomicsAuditReport): string {
  const lines: string[] = [];
  lines.push(
    "| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |",
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
      `| \`${f.file}\` | ${f.targetLang} | ${f.targetCl100k.toLocaleString()} | ${f.ailCl100k.toLocaleString()} | ${clStr} | ${f.targetO200k.toLocaleString()} | ${f.ailO200k.toLocaleString()} | ${o2Str} | ${chStr} |`,
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
    `| **TOTAL (${report.files.length} Projects)** | **Aggregated** | **${agg.targetCl100k.toLocaleString()}** | **${agg.ailCl100k.toLocaleString()}** | ${totalClStr} | **${agg.targetO200k.toLocaleString()}** | **${agg.ailO200k.toLocaleString()}** | ${totalO2Str} | ${totalChStr} |`,
  );

  return lines.join("\n");
}

export interface ProjectTokenomicsSummary {
  project: string;
  targetLang: string;
  fileCount: number;
  targetChars: number;
  ailChars: number;
  charSavingsPct: number;
  targetCl100k: number;
  ailCl100k: number;
  cl100kSavingsPct: number;
  targetO200k: number;
  ailO200k: number;
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
        ailChars: 0,
        charSavingsPct: 0,
        targetCl100k: 0,
        ailCl100k: 0,
        cl100kSavingsPct: 0,
        targetO200k: 0,
        ailO200k: 0,
        o200kSavingsPct: 0,
      };
      projectMap.set(proj, entry);
    }
    entry.fileCount++;
    entry.targetChars += f.targetChars;
    entry.ailChars += f.ailChars;
    entry.targetCl100k += f.targetCl100k;
    entry.ailCl100k += f.ailCl100k;
    entry.targetO200k += f.targetO200k;
    entry.ailO200k += f.ailO200k;
    if (entry.targetLang !== f.targetLang) {
      entry.targetLang = "Polyglot";
    }
  }

  const projects = Array.from(projectMap.values()).sort((a, b) => a.project.localeCompare(b.project));
  for (const p of projects) {
    p.cl100kSavingsPct = p.targetCl100k > 0 ? ((p.targetCl100k - p.ailCl100k) / p.targetCl100k) * 100 : 0;
    p.o200kSavingsPct = p.targetO200k > 0 ? ((p.targetO200k - p.ailO200k) / p.targetO200k) * 100 : 0;
    p.charSavingsPct = p.targetChars > 0 ? ((p.targetChars - p.ailChars) / p.targetChars) * 100 : 0;
  }

  const lines: string[] = [];
  lines.push(
    "| File | Target Lang | Target cl100k | AIL cl100k | cl100k Savings | Target o200k | AIL o200k | o200k Savings | Char Savings |",
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
      `| \`${p.project}\` (${p.fileCount} files) | ${p.targetLang} | ${p.targetCl100k.toLocaleString()} | ${p.ailCl100k.toLocaleString()} | ${clStr} | ${p.targetO200k.toLocaleString()} | ${p.ailO200k.toLocaleString()} | ${o2Str} | ${chStr} |`,
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
    `| **TOTAL (${projects.length} Projects / ${report.files.length} Files)** | **Aggregated** | **${agg.targetCl100k.toLocaleString()}** | **${agg.ailCl100k.toLocaleString()}** | ${totalClStr} | **${agg.targetO200k.toLocaleString()}** | **${agg.ailO200k.toLocaleString()}** | ${totalO2Str} | ${totalChStr} |`,
  );

  return lines.join("\n");
}
