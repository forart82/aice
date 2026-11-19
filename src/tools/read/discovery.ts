/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  DEFAULT_IGNORED_SCAN_DIRECTORIES,
  isBinaryExtension,
  isLikelyBinaryBuffer,
  isProjectAiceEnabled,
  LOCKFILE_SKIP_NAMES,
  resolvePathTargets,
} from "../../config/index.js";
import { recordTelemetryEvent } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { computeHonestReadBaselineText, normalizeGrepBreAlternation } from "../context.js";
import { shouldEnforceDefaultReadBudget } from "./dynamic-budget.js";
import {
  expandBracePatterns,
  formatReadDisplayPath,
  globPatternToRegExp,
  hasGlobMagicChars,
  parseReadTarget,
  splitReadTargetString,
} from "./target-parsing.js";
import {
  type ReadOptions,
  type ReadResult,
  type ReadStats,
  type ReadTargetInput,
  resolveEffectiveReadBudgets,
  SINGLE_REGEX_LITERAL_RE,
} from "./types-and-budgets.js";

function hasUnsafeSearchQuantifiers(pattern: string): boolean {
  if (pattern.length > 512) return true;
  if (/(\.\*){4,}/.test(pattern)) return true;
  return /\([^()]*[+*][^()]*\)\s*[+*?{]/.test(pattern);
}

function escapeUnescapedForwardSlashes(pattern: string): string {
  let out = "";
  let inCharClass = false;
  let escaped = false;
  for (const ch of pattern) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "[" && !inCharClass) {
      inCharClass = true;
      out += ch;
      continue;
    }
    if (ch === "]" && inCharClass) {
      inCharClass = false;
      out += ch;
      continue;
    }
    if (ch === "/" && !inCharClass) {
      out += "\\/";
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    out += ch;
  }
  return out;
}

function escapeLiteralForRegexSelector(literal: string): string {
  return literal
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

export function buildSafeSearchRegexSelector(rawSearch: string): {
  selector: string;
  regex: RegExp;
} {
  const normalizedRaw = normalizeGrepBreAlternation(rawSearch);
  const trimmed = normalizedRaw.trim();
  const slashedMatch = trimmed.match(/^\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+)\/([gimsuy]*)$/);
  if (slashedMatch?.[1]) {
    const rawBody = normalizeGrepBreAlternation(slashedMatch[1]);
    const cleanFlags = (slashedMatch[2] ?? "").replace(/[gy]/g, "");
    if (!hasUnsafeSearchQuantifiers(rawBody)) {
      try {
        const regex = new RegExp(rawBody, cleanFlags);
        return { selector: `/${rawBody}/${cleanFlags}`, regex };
      } catch {
        // fall through to literal fallback
      }
    }
  }

  if (normalizedRaw.length > 0 && !hasUnsafeSearchQuantifiers(normalizedRaw)) {
    try {
      const escapedSlashBody = escapeUnescapedForwardSlashes(normalizedRaw);
      const regex = new RegExp(escapedSlashBody);
      const candidateSelector = `/${escapedSlashBody}/`;
      if (SINGLE_REGEX_LITERAL_RE.test(candidateSelector)) {
        return { selector: candidateSelector, regex };
      }
    } catch {
      // Invalid regex (e.g. "foo(bar" or "[unclosed") -> auto-escape literal fallback
    }
  }

  const literalBody = escapeLiteralForRegexSelector(rawSearch || "^$");
  return {
    selector: `/${literalBody}/`,
    regex: new RegExp(literalBody),
  };
}

function countBufferLinesFast(buf: Buffer): number {
  const len = buf.length;
  if (len === 0) return 0;
  const end =
    len >= 2 && buf[len - 2] === 13 && buf[len - 1] === 10
      ? len - 2
      : buf[len - 1] === 10
        ? len - 1
        : len;
  if (end <= 0) return 1;
  let lines = 1;
  for (let i = 0; i < end; i++) {
    if (buf[i] === 10) lines++;
  }
  return lines;
}

function buildFilesOnlyFilterMatcher(rawFilter?: string): ((relPath: string) => boolean) | null {
  const trimmed = rawFilter?.trim();
  if (!trimmed) return null;
  const norm = trimmed.replace(/\\/g, "/");
  const clean = norm.startsWith("./") ? norm.slice(2) : norm;

  const slashed = clean.match(/^\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+)\/([gimsuy]*)$/);
  if (slashed?.[1]) {
    try {
      const rx = new RegExp(slashed[1], (slashed[2] ?? "").replace(/[gy]/g, "") || "i");
      return (relPath: string) => rx.test(relPath);
    } catch {
      // fall through
    }
  }

  if (hasGlobMagicChars(clean)) {
    const expanded = expandBracePatterns(clean);
    const hasSlash = clean.includes("/");
    const rxList = expanded.map((pat) => globPatternToRegExp(pat));
    return (relPath: string) => {
      if (rxList.some((rx) => rx.test(relPath))) return true;
      if (!hasSlash) {
        const base = path.posix.basename(relPath);
        return rxList.some((rx) => rx.test(base));
      }
      return false;
    };
  }

  const needle = clean.toLowerCase();
  return (relPath: string) => relPath.toLowerCase().includes(needle);
}

export interface DiscoveredWorkspaceFile {
  path: string;
  lines: number;
  bytes: number;
  sizeKB: number;
}

export function executeFilesOnlyRead(
  targets: ReadTargetInput | ReadTargetInput[] | undefined,
  options: ReadOptions,
  baseDir: string,
  surface: "cli" | "mcp",
): ReadResult {
  const resolvedRootInfo = resolvePathTargets(undefined, {
    includeTargets: false,
    projectRoot: options.projectRoot ?? baseDir,
  });
  if (!isProjectAiceEnabled(resolvedRootInfo.config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }
  const projectRoot = resolvedRootInfo.projectRoot;

  const configuredOutDir = resolvedRootInfo.config.outDir
    ? path.resolve(projectRoot, resolvedRootInfo.config.outDir)
    : undefined;

  const rawTokens: string[] = [];
  if (targets !== undefined) {
    const inputList = Array.isArray(targets) ? targets : [targets];
    for (const item of inputList) {
      if (typeof item === "string") {
        for (const tok of splitReadTargetString(item, baseDir)) {
          const parsed = parseReadTarget(tok, baseDir);
          if (parsed.targetPath.trim()) rawTokens.push(parsed.targetPath.trim());
        }
      } else if (item && typeof item === "object" && item.path.trim()) {
        rawTokens.push(item.path.trim());
      }
    }
  }

  const scanRoots: string[] = [];
  const inferredFilters: string[] = [];
  const explicitAllowedDirs = new Set<string>();

  for (const tok of rawTokens) {
    const candidateBase = path.resolve(baseDir, tok);
    const candidateRoot = path.resolve(projectRoot, tok);
    if (fs.existsSync(candidateBase)) {
      scanRoots.push(candidateBase);
      for (const seg of tok.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowedDirs.add(seg);
      }
    } else if (fs.existsSync(candidateRoot)) {
      scanRoots.push(candidateRoot);
      for (const seg of tok.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowedDirs.add(seg);
      }
    } else {
      inferredFilters.push(tok);
    }
  }

  if (scanRoots.length === 0) {
    scanRoots.push(projectRoot);
  }

  const primaryFilter = options.filePattern ?? options.search;
  const activeMatchers: Array<(relPath: string) => boolean> = [];
  const mPrimary = buildFilesOnlyFilterMatcher(primaryFilter);
  if (mPrimary) activeMatchers.push(mPrimary);
  for (const inf of inferredFilters) {
    const mInf = buildFilesOnlyFilterMatcher(inf);
    if (mInf) activeMatchers.push(mInf);
  }

  const rawMaxDepth = options.maxDepth ?? options.depth;
  const effectiveMaxDepth =
    rawMaxDepth !== undefined && Number.isFinite(rawMaxDepth)
      ? Math.max(1, Math.floor(rawMaxDepth))
      : undefined;
  const explicitLockfileRequested = Boolean(
    primaryFilter && Array.from(LOCKFILE_SKIP_NAMES).some((lf) => primaryFilter.includes(lf)),
  );
  const includeDotEntries =
    Boolean(options.full) ||
    Boolean(primaryFilter && /(?:^|[/\\,{])\./.test(primaryFilter)) ||
    inferredFilters.some((f) => /(?:^|[/\\,{])\./.test(f));

  const shouldSkipDiscoverDir = (
    dirName: string,
    childAbs: string,
    rootInNodeModules: boolean,
  ): boolean => {
    if (dirName === ".git") return true;
    if (dirName === "node_modules" && !explicitAllowedDirs.has("node_modules")) return true;
    if (
      DEFAULT_IGNORED_SCAN_DIRECTORIES.has(dirName) &&
      !explicitAllowedDirs.has(dirName) &&
      !(rootInNodeModules && (dirName === "dist" || dirName === "build" || dirName === "out"))
    ) {
      return true;
    }
    if (dirName.startsWith(".") && !includeDotEntries && !explicitAllowedDirs.has(dirName)) {
      return true;
    }
    if (
      configuredOutDir &&
      path.resolve(childAbs) === configuredOutDir &&
      !explicitAllowedDirs.has(dirName)
    ) {
      return true;
    }
    return false;
  };

  const directoryHasVisibleFiles = (dirAbs: string, rootInNodeModules: boolean): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isFile()) {
        if (
          ent.name === ".git" ||
          ent.name.endsWith(".trivia.json") ||
          ent.name === "aice.config.json"
        ) {
          continue;
        }
        if (ent.name.startsWith(".") && !includeDotEntries) continue;
        if (!explicitLockfileRequested && LOCKFILE_SKIP_NAMES.has(ent.name)) continue;
        if (isBinaryExtension(ent.name)) continue;
        return true;
      }
      if (ent.isDirectory()) {
        if (shouldSkipDiscoverDir(ent.name, childAbs, rootInNodeModules)) continue;
        if (directoryHasVisibleFiles(childAbs, rootInNodeModules)) return true;
      }
    }
    return false;
  };

  const candidateFiles = new Map<string, string>(); // relPosix -> absPath
  const boundaryDirs = new Set<string>(); // non-empty dirs at effectiveMaxDepth
  const collectFromDir = (
    dirAbs: string,
    currentDepth: number,
    rootInNodeModules: boolean,
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
        if (shouldSkipDiscoverDir(ent.name, childAbs, rootInNodeModules)) {
          continue;
        }
        if (effectiveMaxDepth !== undefined && currentDepth >= effectiveMaxDepth) {
          const relDirPosix = formatReadDisplayPath(childAbs, projectRoot);
          if (
            relDirPosix &&
            relDirPosix !== "." &&
            (activeMatchers.length === 0 ||
              activeMatchers.every(
                (matchFn) => matchFn(relDirPosix) || matchFn(`${relDirPosix}/`),
              )) &&
            directoryHasVisibleFiles(childAbs, rootInNodeModules)
          ) {
            boundaryDirs.add(relDirPosix);
          }
          continue;
        }
        collectFromDir(childAbs, currentDepth + 1, rootInNodeModules);
      } else if (ent.isFile()) {
        if (
          ent.name === ".git" ||
          ent.name.endsWith(".trivia.json") ||
          ent.name === "aice.config.json"
        ) {
          continue;
        }
        if (ent.name.startsWith(".") && !includeDotEntries) continue;
        if (!explicitLockfileRequested && LOCKFILE_SKIP_NAMES.has(ent.name)) continue;
        if (isBinaryExtension(ent.name)) continue;
        const relPosix = formatReadDisplayPath(childAbs, projectRoot);
        if (activeMatchers.length === 0 || activeMatchers.every((matchFn) => matchFn(relPosix))) {
          candidateFiles.set(relPosix, childAbs);
        }
      }
    }
  };

  for (const rootAbs of scanRoots) {
    try {
      const st = fs.statSync(rootAbs);
      if (st.isDirectory()) {
        const inNodeMods = rootAbs.split(path.sep).includes("node_modules");
        collectFromDir(rootAbs, 1, inNodeMods);
      } else if (st.isFile()) {
        if (!isBinaryExtension(rootAbs)) {
          const relPosix = formatReadDisplayPath(rootAbs, projectRoot);
          if (activeMatchers.length === 0 || activeMatchers.every((matchFn) => matchFn(relPosix))) {
            candidateFiles.set(relPosix, rootAbs);
          }
        }
      }
    } catch {
      // ignore unreadable path
    }
  }

  const sortedRelPaths = Array.from(candidateFiles.keys()).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const discovered: DiscoveredWorkspaceFile[] = [];

  for (const relPath of sortedRelPaths) {
    const absPath = candidateFiles.get(relPath)!;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(absPath);
    } catch {
      continue;
    }
    if (isLikelyBinaryBuffer(buf)) continue;
    const lines = countBufferLinesFast(buf);
    const bytes = buf.length;
    const sizeKBNum = bytes === 0 ? 0 : Number(Math.max(0.1, bytes / 1024).toFixed(1));
    discovered.push({
      path: relPath,
      lines,
      bytes,
      sizeKB: sizeKBNum,
    });
  }

  const formatFileEntry = (label: string, lines: number): string =>
    effectiveMaxDepth !== undefined && lines <= 120 ? label : `${label} (${lines}L)`;

  const activeBoundaryDirs = Array.from(boundaryDirs)
    .filter((bd) => !discovered.some((d) => d.path.startsWith(`${bd}/`)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const formattedLines: string[] = [];
  if (discovered.length <= 3 && activeBoundaryDirs.length === 0) {
    for (const d of discovered) {
      formattedLines.push(formatFileEntry(d.path, d.lines));
    }
  } else {
    const byDir = new Map<string, DiscoveredWorkspaceFile[]>();
    for (const d of discovered) {
      const slashIdx = d.path.lastIndexOf("/");
      const dirKey = slashIdx >= 0 ? d.path.slice(0, slashIdx) : ".";
      let bucket = byDir.get(dirKey);
      if (!bucket) {
        bucket = [];
        byDir.set(dirKey, bucket);
      }
      bucket.push(d);
    }
    const subdirsByParent = new Map<string, string[]>();
    for (const bd of activeBoundaryDirs) {
      const slashIdx = bd.lastIndexOf("/");
      const parentKey = slashIdx >= 0 ? bd.slice(0, slashIdx) : ".";
      const childName = slashIdx >= 0 ? bd.slice(slashIdx + 1) : bd;
      let list = subdirsByParent.get(parentKey);
      if (!list) {
        list = [];
        subdirsByParent.set(parentKey, list);
      }
      list.push(`${childName}/`);
    }
    const allDirKeys = Array.from(new Set([...byDir.keys(), ...subdirsByParent.keys()])).sort(
      (a, b) => {
        if (a === "." && b !== ".") return -1;
        if (b === "." && a !== ".") return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      },
    );
    for (const dirKey of allDirKeys) {
      const items = byDir.get(dirKey) ?? [];
      const subdirs = subdirsByParent.get(dirKey) ?? [];
      if (dirKey === ".") {
        const rootEntries = [...items.map((it) => formatFileEntry(it.path, it.lines)), ...subdirs];
        if (rootEntries.length >= 2) {
          formattedLines.push(rootEntries.join(", "));
        } else if (rootEntries.length === 1) {
          formattedLines.push(rootEntries[0]!);
        }
      } else {
        if (items.length === 1) {
          formattedLines.push(formatFileEntry(items[0]!.path, items[0]!.lines));
        } else if (items.length > 1) {
          const joined = items
            .map((it) => formatFileEntry(it.path.slice(dirKey.length + 1), it.lines))
            .join(", ");
          formattedLines.push(`${dirKey}/: ${joined}`);
        }
        if (subdirs.length === 1) {
          formattedLines.push(`${dirKey}/${subdirs[0]!}`);
        } else if (subdirs.length > 1) {
          formattedLines.push(`${dirKey}/: ${subdirs.join(", ")}`);
        }
      }
    }
  }

  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const enforceCeiling = shouldEnforceDefaultReadBudget(options);
  let formattedBundle = formattedLines.join("\n");
  if (enforceCeiling && Buffer.byteLength(formattedBundle, "utf-8") > effectiveBudgets.maxBytes) {
    const kept: string[] = [];
    let bytesUsed = 0;
    const maxListBytes = effectiveBudgets.maxBytes - 180;
    for (let i = 0; i < formattedLines.length; i++) {
      const ln = formattedLines[i]!;
      const addBytes = Buffer.byteLength(ln, "utf-8") + (kept.length > 0 ? 1 : 0);
      if (kept.length > 0 && bytesUsed + addBytes > maxListBytes) {
        const omittedCount = formattedLines.length - i;
        kept.push(`// +${omittedCount} more entries — narrow path or pass -d <depth>`);
        break;
      }
      kept.push(ln);
      bytesUsed += addBytes;
    }
    formattedBundle = kept.join("\n");
  }

  const targetLabel =
    scanRoots.length === 1
      ? formatReadDisplayPath(scanRoots[0]!, projectRoot)
      : scanRoots.map((r) => formatReadDisplayPath(r, projectRoot)).join(", ");

  const honestFdBaseline = computeHonestReadBaselineText({
    mode: "files",
    relPath: targetLabel || ".",
    projectRoot: scanRoots.length === 1 ? scanRoots[0] : projectRoot,
    filePaths: discovered.map((d) => d.path),
    maxDepth: effectiveMaxDepth,
    filePattern: primaryFilter,
    includeToolWrapper: false,
  });

  const jsonData = {
    mode: "files" as const,
    projectRoot,
    count: discovered.length,
    files: discovered,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const output = jsonOutput ?? formattedBundle;
  const aicePayload = jsonOutput ?? formattedBundle;

  const tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const aiceTok = jsonOutput !== undefined ? estimateTokens(jsonOutput, "cl100k_base") : tokenCount;
  const honestOrigTokens = estimateTokens(honestFdBaseline, "cl100k_base");
  const rawBytesSum = discovered.reduce((acc, d) => acc + d.bytes, 0);
  const rawCorpusCl100k =
    discovered.length === 0
      ? honestOrigTokens
      : Math.max(honestOrigTokens, Math.ceil(rawBytesSum / 4));

  recordTelemetryEvent({
    targetPath: scanRoots[0] ?? projectRoot,
    projectRoot,
    filePath: "<workspace-files>",
    operation: "outline",
    surface,
    idiomsUsed: false,
    nativeText: "",
    nativeChars: Math.max(honestFdBaseline.length, rawBytesSum),
    nativeCl100k: rawCorpusCl100k,
    nativeO200k: rawCorpusCl100k,
    realisticNativeText: honestFdBaseline,
    realisticNativeCl100k: Math.min(rawCorpusCl100k, honestOrigTokens),
    aiceText: aicePayload,
    aiceChars: aicePayload.length,
    aiceCl100k: aiceTok,
  });

  const stats: ReadStats = {
    tokenCount,
    originalTokens: honestOrigTokens,
    savedTokens: honestOrigTokens - tokenCount,
    savingsPct:
      honestOrigTokens > 0
        ? Math.round(((honestOrigTokens - tokenCount) / honestOrigTokens) * 100)
        : 0,
    originalChars: honestFdBaseline.length,
    outputChars: formattedBundle.length,
    dependenciesCount: 0,
    callersCount: 0,
    fileCount: discovered.length,
  };

  return {
    mode: "files",
    targetPath: targetLabel || ".",
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: scanRoots.map((r) => ({
      targetPath: formatReadDisplayPath(r, projectRoot),
      resolvedPath: r,
      mode: "files" as const,
    })),
    missingTargets: [],
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats,
  };
}
