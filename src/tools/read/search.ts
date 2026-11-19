/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { DEFAULT_IGNORED_SCAN_DIRECTORIES, isLikelyBinaryDiskFile } from "../../config/index.js";
import { recordTelemetryEvent } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import {
  computeHonestReadBaselineText,
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  type HonestBaselineFileEntry,
  isCommentLine,
  isTestOrMockPath,
} from "../context.js";
import { isSupportedReadDiskFile } from "../outline.js";
import {
  enforceReadBudgetCeiling,
  formatContextStatsFooter,
  shouldEnforceDefaultReadBudget,
} from "./dynamic-budget.js";
import {
  formatReadDisplayPath,
  splitCommaSelectors,
  truncateBundleToMaxTokens,
} from "./target-parsing.js";
import {
  type ClassifiedReadTarget,
  type ReadOptions,
  type ReadResult,
  resolveEffectiveReadBudgets,
} from "./types-and-budgets.js";

export interface SearchCandidateFile {
  absPath: string;
  relPath: string;
  projectRoot: string;
  isExplicitTestSearch: boolean;
}

export function collectSearchCandidateFiles(
  classified: ClassifiedReadTarget[],
  opts?: { allowDotfiles?: boolean },
): SearchCandidateFile[] {
  const seenRealOrAbs = new Set<string>();
  const out: SearchCandidateFile[] = [];

  const pushCandidate = (
    absPath: string,
    relPath: string,
    projectRoot: string,
    isExplicitTestSearch: boolean,
  ): void => {
    let dedupKey = path.resolve(absPath);
    try {
      dedupKey = fs.realpathSync(absPath);
    } catch {}
    if (seenRealOrAbs.has(dedupKey)) return;
    seenRealOrAbs.add(dedupKey);
    out.push({ absPath, relPath, projectRoot, isExplicitTestSearch });
  };

  const walkSearchDir = (
    dirAbs: string,
    projectRoot: string,
    rootInNodeModules: boolean,
    explicitAllowedDirs: Set<string>,
    isExplicitTestSearch: boolean,
  ): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".git") continue;
        if (ent.name === "node_modules" && !explicitAllowedDirs.has("node_modules")) continue;
        if (
          DEFAULT_IGNORED_SCAN_DIRECTORIES.has(ent.name) &&
          !explicitAllowedDirs.has(ent.name) &&
          !(
            rootInNodeModules &&
            (ent.name === "dist" || ent.name === "build" || ent.name === "out")
          )
        ) {
          continue;
        }
        if (
          ent.name.startsWith(".") &&
          ent.name !== ".github" &&
          !explicitAllowedDirs.has(ent.name)
        ) {
          continue;
        }
        walkSearchDir(
          childAbs,
          projectRoot,
          rootInNodeModules,
          explicitAllowedDirs,
          isExplicitTestSearch,
        );
      } else if (ent.isFile()) {
        if (
          isSupportedReadDiskFile(childAbs, {
            allowDotfiles: Boolean(opts?.allowDotfiles) || explicitAllowedDirs.has(ent.name),
          })
        ) {
          pushCandidate(
            childAbs,
            formatReadDisplayPath(childAbs, projectRoot),
            projectRoot,
            isExplicitTestSearch,
          );
        }
      }
    }
  };

  for (const item of classified) {
    const relTarget = path.relative(item.resolved.projectRoot, item.diskPath).replace(/\\/g, "/");
    const baseName = path.basename(item.diskPath);
    const isExplicitTest =
      /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/i.test(
        relTarget,
      ) || /^(?:tests?|__tests__|mocks?|__mocks__|fixtures?|specs?)$/i.test(baseName);

    if (item.isDir) {
      const explicitAllowed = new Set<string>();
      for (const seg of item.norm.targetPath.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowed.add(seg);
      }
      const inNodeMods = item.diskPath.split(path.sep).includes("node_modules");
      walkSearchDir(
        item.diskPath,
        item.resolved.projectRoot,
        inNodeMods,
        explicitAllowed,
        isExplicitTest,
      );
    } else if (!isLikelyBinaryDiskFile(item.diskPath)) {
      pushCandidate(item.diskPath, item.displayPath, item.resolved.projectRoot, isExplicitTest);
    }
  }

  return out;
}

export function executeFilesWithMatchesSearch(params: {
  classified: ClassifiedReadTarget[];
  missingTargets: string[];
  regex: RegExp;
  selector: string;
  rawPattern: string;
  options: ReadOptions;
  surface: "cli" | "mcp";
}): ReadResult {
  const { classified, missingTargets, regex, selector, rawPattern, options, surface } = params;
  const primaryRoot = classified[0]?.resolved.projectRoot ?? process.cwd();
  const candidateFiles = collectSearchCandidateFiles(classified, {
    allowDotfiles: Boolean(options.full),
  });

  interface ScoredPathHit {
    relPath: string;
    score: number;
  }
  const matchedScored: ScoredPathHit[] = [];

  for (const file of candidateFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    regex.lastIndex = 0;
    if (!regex.test(raw)) continue;

    const isTest = !file.isExplicitTestSearch && isTestOrMockPath(file.absPath, file.projectRoot);
    const lines = raw.split(/\r?\n/);
    let bestLineScore = 10;
    for (const ln of lines) {
      regex.lastIndex = 0;
      if (!regex.test(ln)) continue;
      const comment = isCommentLine(ln, file.absPath);
      if (!comment) {
        bestLineScore = isTest ? 50 : 500;
        break;
      }
      bestLineScore = Math.max(bestLineScore, isTest ? 10 : 100);
    }
    matchedScored.push({ relPath: file.relPath, score: bestLineScore });
  }

  matchedScored.sort(
    (a, b) => b.score - a.score || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0),
  );
  const matchedPaths = matchedScored.map((m) => m.relPath);
  let formattedBundle = matchedPaths.join("\n");
  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    formattedBundle = formattedBundle ? `${formattedBundle}\n${missingFooter}` : missingFooter;
  }

  let tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const jsonData = {
    mode: "search" as const,
    filesWithMatches: true,
    pattern: rawPattern,
    selector,
    count: matchedPaths.length,
    files: matchedPaths,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  let output = jsonOutput ?? formattedBundle;

  if (shouldEnforceDefaultReadBudget(options)) {
    const effectiveBudgets = resolveEffectiveReadBudgets(options);
    const capped = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: matchedPaths[0] ?? ".",
      projectRoot: primaryRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = capped.formattedBundle;
    output = capped.output;
    tokenCount = capped.tokenCount;
  }

  const targetLabel = classified.map((c) => c.displayPath || ".").join(", ") || ".";
  const honestFilesMatchBaseline = computeHonestReadBaselineText({
    filesWithMatches: true,
    matchedPaths,
    relPath: targetLabel,
    symbolSelector: rawPattern,
    includeToolWrapper: false,
  });
  const honestOrigTokens = estimateTokens(honestFilesMatchBaseline, "cl100k_base");
  const rawMatchCorpusChars = candidateFiles.reduce((acc, f) => {
    try {
      return acc + fs.statSync(f.absPath).size;
    } catch {
      return acc;
    }
  }, 0);
  const rawMatchCorpusTokens = Math.max(honestOrigTokens, Math.ceil(rawMatchCorpusChars / 4));

  if (classified[0]) {
    const aicePayload = jsonOutput ?? formattedBundle;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot: primaryRoot,
      operation: "context",
      surface,
      idiomsUsed: false,
      isSearchMode: true,
      nativeText: "",
      nativeChars: Math.max(honestFilesMatchBaseline.length, rawMatchCorpusChars),
      nativeCl100k: rawMatchCorpusTokens,
      nativeO200k: rawMatchCorpusTokens,
      realisticNativeText: honestFilesMatchBaseline,
      realisticNativeCl100k: Math.min(rawMatchCorpusTokens, honestOrigTokens),
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  return {
    mode: "search",
    targetPath: targetLabel,
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: classified.map((c) => ({
      targetPath: c.displayPath || ".",
      resolvedPath: c.diskPath,
      mode: "search" as const,
      selector,
    })),
    missingTargets,
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats: {
      tokenCount,
      originalTokens: honestOrigTokens,
      savedTokens: honestOrigTokens - tokenCount,
      originalChars: honestFilesMatchBaseline.length,
      outputChars: formattedBundle.length,
      dependenciesCount: 0,
      callersCount: 0,
      fileCount: matchedPaths.length,
    },
  };
}

interface ScoredCompactSearchHit {
  relPath: string;
  absPath: string;
  rawSource: string;
  formattedEntry: string;
  score: number;
}

export function executeUnifiedCompactSearch(params: {
  classified: ClassifiedReadTarget[];
  missingTargets: string[];
  defaultSelector?: string;
  rawPatternLabel: string;
  options: ReadOptions;
  surface: "cli" | "mcp";
}): ReadResult {
  const { classified, missingTargets, defaultSelector, rawPatternLabel, options, surface } = params;
  const primaryRoot = classified[0]?.resolved.projectRoot ?? process.cwd();
  const candidateFiles = collectSearchCandidateFiles(classified, {
    allowDotfiles: Boolean(options.full),
  });
  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const enforceCeiling = shouldEnforceDefaultReadBudget(
    options,
    classified.map((c) => c.norm),
  );

  const primarySelector =
    defaultSelector ??
    classified.find((c) => Boolean(c.effectiveSelector))?.effectiveSelector ??
    "//";
  const selectorPieces = splitCommaSelectors(primarySelector).filter(Boolean);
  const activeSelectors = selectorPieces.length > 0 ? selectorPieces : [primarySelector];
  const primaryQueryKw = extractPrimaryQueryKeyword(activeSelectors[0] ?? "");

  const hits: ScoredCompactSearchHit[] = [];
  const baselineEntries: HonestBaselineFileEntry[] = [];

  for (const file of candidateFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    baselineEntries.push({ relPath: file.relPath, rawSource: raw });

    const matchedParts: string[] = [];
    let fileMaxScore = 0;
    for (const selPiece of activeSelectors) {
      let cleanPiece = selPiece.trim();
      if (
        cleanPiece.startsWith("/") &&
        cleanPiece.length > 1 &&
        cleanPiece.indexOf("/", 1) === -1
      ) {
        const rawBody = cleanPiece.slice(1).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        cleanPiece = `/${rawBody}/`;
      }
      const det = extractPatternMatchesDetailed(raw, cleanPiece, options.contextLines, {
        filePath: file.absPath,
        projectRoot: file.projectRoot,
        isExplicitTestSearch: file.isExplicitTestSearch,
        full: options.full,
        dsl: options.dsl,
        compactGrouped: true,
      });
      if (det) {
        matchedParts.push(det.formattedText.trimEnd());
        if (det.maxScore > fileMaxScore) {
          fileMaxScore = det.maxScore;
        }
      }
    }

    if (matchedParts.length === 0) {
      if (primaryQueryKw && doesFileStemMatchQuery(file.absPath, primaryQueryKw)) {
        const cleanLines = (raw.length > 0 ? raw.replace(/\r?\n$/, "") : "").split(/\r?\n/);
        const previewCount = Math.min(2, cleanLines.length);
        const preview = cleanLines
          .slice(0, previewCount)
          .map((l, idx) => `  L${idx + 1}: ${l}`)
          .join("\n");
        matchedParts.push(preview);
        const isMock =
          !file.isExplicitTestSearch && isTestOrMockPath(file.absPath, file.projectRoot);
        fileMaxScore = isMock ? 25 : 1000;
      } else {
        continue;
      }
    }

    hits.push({
      relPath: file.relPath,
      absPath: file.absPath,
      rawSource: raw,
      formattedEntry: `${file.relPath}:\n${matchedParts.join("\n")}`,
      score: fileMaxScore,
    });
  }

  hits.sort(
    (a, b) => b.score - a.score || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0),
  );

  const unclosedSlashHint =
    primarySelector.startsWith("/") &&
    primarySelector.length > 1 &&
    primarySelector.indexOf("/", 1) === -1
      ? `// Hint: quote regex selectors in shell: '${classified[0]?.displayPath || "file"}:${primarySelector}|.../'\n`
      : "";

  const targetLabel = classified.map((c) => c.displayPath || ".").join(", ") || ".";
  const keptBlocks: string[] = [];
  const omittedFiles: string[] = [];
  let usedBytes = Buffer.byteLength(unclosedSlashHint, "utf-8");
  const maxBodyBytes = enforceCeiling ? Math.max(512, effectiveBudgets.maxBytes - 180) : Infinity;

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const sep = keptBlocks.length > 0 ? 1 : 0;
    const addBytes = Buffer.byteLength(h.formattedEntry, "utf-8") + sep;
    if (enforceCeiling && keptBlocks.length > 0 && usedBytes + addBytes > maxBodyBytes) {
      for (let j = i; j < hits.length; j++) {
        omittedFiles.push(hits[j]!.relPath);
      }
      break;
    }
    keptBlocks.push(h.formattedEntry);
    usedBytes += addBytes;
  }

  let formattedBundle: string;
  if (keptBlocks.length > 0) {
    formattedBundle = `${unclosedSlashHint}${keptBlocks.join("\n")}`;
    if (omittedFiles.length > 0) {
      const nextFile = omittedFiles[0] ?? ".";
      const safePat = rawPatternLabel.replace(/"/g, '\\"');
      formattedBundle += `\n// +${omittedFiles.length} more matching files — next: aice search "${safePat}" ${nextFile}`;
    }
  } else {
    formattedBundle = `${unclosedSlashHint}// 0 matches for '${rawPatternLabel || primarySelector}' in ${targetLabel}`;
  }

  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    formattedBundle = `${formattedBundle}\n${missingFooter}`;
  }

  if (options.maxTokens !== undefined) {
    formattedBundle = truncateBundleToMaxTokens(formattedBundle, options.maxTokens).text;
  }

  let tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const jsonData = {
    mode: "search" as const,
    pattern: rawPatternLabel || primarySelector,
    selector: primarySelector,
    count: hits.length,
    files: hits.map((h) => h.relPath),
    formattedBundle,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const statsText = options.stats
    ? formatContextStatsFooter(tokenCount, 0, 0, formattedBundle.length)
    : undefined;
  let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

  if (enforceCeiling && Buffer.byteLength(output, "utf-8") > effectiveBudgets.maxBytes) {
    const capped = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: omittedFiles[0] ?? hits[0]?.relPath ?? ".",
      statsText,
      projectRoot: primaryRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = capped.formattedBundle;
    output = capped.output;
    tokenCount = capped.tokenCount;
  }

  const honestRgBaseline = computeHonestReadBaselineText({
    relPath: targetLabel,
    workspaceFiles: baselineEntries,
    symbolSelector: primarySelector,
    mode: "search",
    includeToolWrapper: false,
  });
  const honestOrigTokens = estimateTokens(honestRgBaseline, "cl100k_base");
  const rawSearchCorpusChars = baselineEntries.reduce((acc, e) => acc + e.rawSource.length, 0);
  const rawSearchCorpusCl100k = Math.max(
    honestOrigTokens,
    baselineEntries.reduce((acc, e) => acc + estimateTokens(e.rawSource, "cl100k_base"), 0),
  );

  if (classified[0]) {
    const aicePayload = jsonOutput ?? formattedBundle;
    const multiFiles =
      classified.length > 1 && classified.some((c) => !c.isDir)
        ? classified.filter((c) => !c.isDir).map((c) => c.displayPath)
        : undefined;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot: primaryRoot,
      ...(multiFiles && multiFiles.length > 1 ? { filePath: "<multi-context>", multiFiles } : {}),
      operation: "context",
      surface,
      idiomsUsed: false,
      isSearchMode: true,
      nativeText: "",
      nativeChars: Math.max(honestRgBaseline.length, rawSearchCorpusChars),
      nativeCl100k: rawSearchCorpusCl100k,
      nativeO200k: rawSearchCorpusCl100k,
      realisticNativeText: honestRgBaseline,
      realisticNativeCl100k: Math.min(rawSearchCorpusCl100k, honestOrigTokens),
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  return {
    mode: "search",
    targetPath: targetLabel,
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: classified.map((c) => ({
      targetPath: c.displayPath || ".",
      resolvedPath: c.diskPath,
      mode: "search" as const,
      selector: c.effectiveSelector ?? primarySelector,
    })),
    missingTargets,
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats: {
      tokenCount,
      originalTokens: honestOrigTokens,
      savedTokens: honestOrigTokens - tokenCount,
      savingsPct:
        honestOrigTokens > 0
          ? Math.round(((honestOrigTokens - tokenCount) / honestOrigTokens) * 100)
          : 0,
      originalChars: honestRgBaseline.length,
      outputChars: formattedBundle.length,
      dependenciesCount: 0,
      callersCount: 0,
      fileCount: hits.length,
    },
    statsText,
  };
}
