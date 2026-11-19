/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Workspace caller scanning, bundle formatting, directory target discovery, and workspace context generation.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  type AiceProjectConfig,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  type ProjectIdiomDefinition,
  resolvePathTargets,
} from "../../config/index.js";
import type { ImportDecl } from "../../core/ast.js";
import { decompile } from "../../decompiler/index.js";
import { detectTargetFromPathOrContent } from "../../emitters/index.js";
import {
  collapseAiceSourceIdioms,
  formatIdiomsMarkdownSection,
  scanProjectIdioms,
} from "../../idioms/index.js";
import { recordTelemetryEvent, withSuppressedTelemetry } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import {
  collectNativeSyntaxDiagnostics,
  generateOutline,
  isSupportedReadDiskFile,
} from "../outline.js";
import { extractSymbolFromAiceSource } from "./focus-and-elision.js";
import {
  computeHonestReadBaselineText,
  isPureLineRangeSymbolString,
  isPureRegexSymbolString,
} from "./honest-baseline.js";
import {
  compactPureAiceSlice,
  extractExportedContract,
  extractFileSymbolList,
  extractImportsFromFile,
  formatDisplayPath,
  generateExternalContract,
  getCachedDiskFileImports,
  isExternalSpecifier,
  NON_IMPORTING_EXTENSIONS,
  resolveEffectiveTargetAndRoot,
  resolveFirstActionableSymbol,
  resolveImportPath,
  splitSymbolSelectors,
  unwrapSyntheticContainer,
} from "./imports-and-deps.js";
import {
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  isTestOrMockPath,
} from "./pattern-search.js";
import type {
  CallerSummary,
  ContextOptions,
  ContextResult,
  DependencyContract,
  WorkspaceCallerScanCache,
} from "./types.js";

function collectImportLineSet(fileLines: string[], imports: ImportDecl[]): Set<number> {
  const importLines = new Set<number>();
  for (const imp of imports) {
    const sLine = imp.span?.start?.line;
    const eLine = imp.span?.end?.line ?? sLine;
    if (sLine && eLine) {
      for (let l = sLine; l <= eLine; l++) {
        importLines.add(l);
      }
    }
  }
  let inMultilineImport = false;
  for (let idx = 0; idx < fileLines.length; idx++) {
    const ln = fileLines[idx]!;
    if (inMultilineImport) {
      importLines.add(idx + 1);
      if (/\bfrom\s+['"]/.test(ln) || ln.includes(";")) {
        inMultilineImport = false;
      }
      continue;
    }
    if (/^\s*(?:import\b|export\s+\{|from\b)/.test(ln)) {
      importLines.add(idx + 1);
      if (
        ln.includes("{") &&
        !ln.includes("}") &&
        !/\bfrom\s+['"]/.test(ln) &&
        !ln.trimEnd().endsWith(";")
      ) {
        inMultilineImport = true;
      }
    }
  }
  return importLines;
}

const CALLER_IGNORED_DIRS = new Set([
  "node_modules",
  "dist",
  "build",
  "coverage",
  "target",
  "vendor",
  "benchmarks",
  "out",
  "__pycache__",
]);

export function scanWorkspaceCallers(
  targetFullPath: string,
  projectRoot: string,
  config: AiceProjectConfig,
  queriedSymbol?: string,
  scanCache?: WorkspaceCallerScanCache,
): CallerSummary[] {
  const callers: CallerSummary[] = [];
  const resolvedRoot = path.resolve(projectRoot);
  let filesToScan = scanCache?.filesByRoot.get(resolvedRoot);

  if (!filesToScan) {
    filesToScan = [];
    const visitedDirs = new Set<string>();

    const walk = (dir: string) => {
      let realDir: string;
      try {
        realDir = fs.realpathSync(dir);
      } catch {
        return;
      }
      if (visitedDirs.has(realDir)) return;
      visitedDirs.add(realDir);

      let entries: fs.Dirent[];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }

      for (const entry of entries) {
        if (entry.isSymbolicLink()) continue;
        if (entry.name.startsWith(".") || CALLER_IGNORED_DIRS.has(entry.name)) continue;
        const fullPath = path.join(dir, entry.name);
        if (entry.isDirectory()) {
          walk(fullPath);
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          if (
            entry.name.endsWith(".aice") ||
            (KNOWN_TARGET_EXTENSIONS.has(ext) && !NON_IMPORTING_EXTENSIONS.has(ext))
          ) {
            filesToScan!.push(fullPath);
          }
        }
      }
    };

    walk(resolvedRoot);
    scanCache?.filesByRoot.set(resolvedRoot, filesToScan);
  }

  let queriedLeaf: string | undefined;
  if (queriedSymbol) {
    const firstSym = splitSymbolSelectors(queriedSymbol)[0]?.trim() ?? "";
    if (
      firstSym &&
      firstSym !== "*" &&
      firstSym !== "@first" &&
      firstSym !== "@1" &&
      firstSym.toLowerCase() !== "imports" &&
      !/^\[?L\d+/i.test(firstSym) &&
      !firstSym.startsWith("/")
    ) {
      const withoutFile =
        firstSym.includes(":") && !firstSym.includes("::")
          ? firstSym.slice(firstSym.indexOf(":") + 1).trim()
          : firstSym;
      const parts = withoutFile
        .split(/\.|::/)
        .map((p) => p.trim())
        .filter(Boolean);
      const leaf = parts[parts.length - 1];
      if (leaf && /^[A-Za-z_$][A-Za-z0-9_$]*$/.test(leaf)) {
        queriedLeaf = leaf;
      }
    }
  }

  const resolvedTarget = path.resolve(targetFullPath);
  const targetBase = resolvedTarget.replace(/\.aice$/, "");
  const targetDir = path.dirname(targetBase);
  const targetFileName = path.basename(targetBase);
  const targetExt = path.extname(targetFileName);
  const targetStem = targetExt ? targetFileName.slice(0, -targetExt.length) : targetFileName;
  const targetNoExt = targetExt ? targetBase.slice(0, -targetExt.length) : targetBase;
  const isIndexStem = targetStem === "index" || targetStem === "mod" || targetStem === "lib";
  const escapedStem = targetStem.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const importHintRegex = !isIndexStem
    ? new RegExp(`(?:from|import|require|use|#include)[^\\n;]*\\b${escapedStem}\\b`)
    : undefined;
  const leafRe = queriedLeaf
    ? new RegExp(`\\b${queriedLeaf.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`)
    : undefined;

  const canRelativeImportMatchTarget = (fromFile: string, specifier: string): boolean => {
    if (!specifier.startsWith(".")) return true;
    const candAbs = path.resolve(path.dirname(fromFile), specifier);
    if (candAbs === resolvedTarget || candAbs === targetBase || candAbs === targetNoExt) {
      return true;
    }
    if (isIndexStem && candAbs === targetDir) {
      return true;
    }
    const candExt = path.extname(candAbs);
    if (candExt) {
      const candNoExt = candAbs.slice(0, -candExt.length);
      if (candNoExt === targetNoExt || candNoExt === targetBase) {
        return true;
      }
    }
    return false;
  };

  for (const file of filesToScan) {
    const resolvedCandidate = path.resolve(file);
    if (resolvedCandidate === resolvedTarget) continue;
    const fileExt = path.extname(file).toLowerCase();
    if (!file.endsWith(".aice") && NON_IMPORTING_EXTENSIONS.has(fileExt)) {
      continue;
    }

    let rawContent = scanCache?.fileContentByPath.get(resolvedCandidate);
    let imports = scanCache?.importsByPath.get(resolvedCandidate);
    let candidateStat: fs.Stats | undefined;

    if (!imports) {
      try {
        candidateStat = fs.statSync(file);
        imports = getCachedDiskFileImports(resolvedCandidate, candidateStat);
      } catch {
        continue;
      }
      if (imports) {
        scanCache?.importsByPath.set(resolvedCandidate, imports);
      }
    }

    if (!imports) {
      if (rawContent === undefined) {
        try {
          rawContent = fs.readFileSync(file, "utf-8");
          scanCache?.fileContentByPath.set(resolvedCandidate, rawContent);
        } catch {
          continue;
        }
      }

      if (!isIndexStem && !rawContent.includes(targetStem)) {
        continue;
      }
      if (importHintRegex && !importHintRegex.test(rawContent)) {
        continue;
      }

      imports = extractImportsFromFile(file, rawContent, candidateStat);
      scanCache?.importsByPath.set(resolvedCandidate, imports);
    }

    if (imports.length === 0) continue;

    for (const imp of imports) {
      if (!canRelativeImportMatchTarget(file, imp.source)) {
        continue;
      }
      const resolved = resolveImportPath(file, imp.source, config, projectRoot);
      if (resolved) {
        const resolvedBase = path.resolve(resolved).replace(/\.aice$/, "");
        if (path.resolve(resolved) === resolvedTarget || resolvedBase === targetBase) {
          const symbols = imp.specifiers.map((s) => s.name);
          let callSiteLines: number[] | undefined;
          if (queriedLeaf && leafRe) {
            if (rawContent === undefined) {
              try {
                rawContent = fs.readFileSync(file, "utf-8");
                scanCache?.fileContentByPath.set(resolvedCandidate, rawContent);
              } catch {
                rawContent = "";
              }
            }
            const fileLines = rawContent.split(/\r?\n/);
            const importLineSet = collectImportLineSet(fileLines, imports);
            const nonImportHits: number[] = [];
            for (let idx = 0; idx < fileLines.length; idx++) {
              const ln = fileLines[idx]!;
              if (leafRe.test(ln) && !importLineSet.has(idx + 1)) {
                nonImportHits.push(idx + 1);
              }
            }
            if (nonImportHits.length > 0) {
              callSiteLines = nonImportHits;
            }
          }
          callers.push({
            filePath: formatDisplayPath(file, projectRoot),
            importedSymbols: symbols,
            line: imp.span?.start?.line ?? 1,
            ...(queriedLeaf && callSiteLines && callSiteLines.length > 0
              ? { usedSymbol: queriedLeaf, callSiteLines }
              : {}),
          });
        }
      }
    }
  }

  callers.sort((a, b) => {
    if (a.filePath !== b.filePath) {
      return a.filePath.localeCompare(b.filePath);
    }
    return a.line - b.line;
  });

  return callers;
}

export function formatBundle(
  displayTargetPath: string,
  targetBody: string,
  dependencies: DependencyContract[],
  callers: CallerSummary[],
  idioms?: Record<string, ProjectIdiomDefinition>,
  nativeDiagnostics?: string,
  options?: { minimalEnvelope?: boolean; symbolSelector?: string; compactMode?: boolean },
): string {
  const isNonAstTarget = /\.(?:ya?ml|cff|jsonc?|md|markdown|sh|bash|zsh|ps1|cmd|bat)$/i.test(
    displayTargetPath,
  );
  const bundleUsesIdioms =
    idioms &&
    Object.keys(idioms).some((k) => {
      const norm = k.startsWith("$") ? k : `$${k}`;
      return targetBody.includes(norm);
    });
  const shouldEmitIdioms = Boolean(
    idioms && Object.keys(idioms).length > 0 && (!isNonAstTarget || bundleUsesIdioms),
  );

  let effectiveBody = targetBody;
  let preformattedBody = false;
  let resolvedSpanSuffix: string | undefined;
  if (effectiveBody.startsWith("// @preformatted\n")) {
    effectiveBody = effectiveBody.slice("// @preformatted\n".length);
    preformattedBody = true;
  } else if (effectiveBody.startsWith("// @span:")) {
    const nlIdx = effectiveBody.indexOf("\n");
    if (nlIdx > 0) {
      resolvedSpanSuffix = effectiveBody.slice("// @span:".length, nlIdx).trim();
      effectiveBody = effectiveBody.slice(nlIdx + 1);
    }
  }

  if (options?.minimalEnvelope && dependencies.length === 0 && callers.length === 0) {
    const rawSym = options.symbolSelector?.trim();
    const includeSymSuffix = Boolean(
      rawSym &&
        rawSym !== "*" &&
        !isPureLineRangeSymbolString(rawSym) &&
        !isPureRegexSymbolString(rawSym),
    );
    const useCompact = Boolean(options.compactMode);
    const minLines: string[] = [];
    if (!preformattedBody) {
      if (useCompact) {
        if (
          !effectiveBody.startsWith("// ") ||
          (!effectiveBody.startsWith(`// ${displayTargetPath}`) &&
            !effectiveBody.startsWith("// Hint:") &&
            !effectiveBody.startsWith("// 0 matches"))
        ) {
          const suffix = resolvedSpanSuffix
            ? `:${resolvedSpanSuffix}`
            : includeSymSuffix
              ? `:${rawSym}`
              : "";
          minLines.push(`// ${displayTargetPath}${suffix}`);
        }
      } else {
        const headerTarget = includeSymSuffix
          ? `${displayTargetPath}:${rawSym}`
          : displayTargetPath;
        const requestedSymbols = rawSym ? splitSymbolSelectors(rawSym) : [];
        if (!(effectiveBody.startsWith("// === ") && requestedSymbols.length <= 1)) {
          minLines.push(`// === ${headerTarget} ===`);
        }
      }
    }
    if (shouldEmitIdioms && idioms && !effectiveBody.includes("# @idioms available:")) {
      const idiomNames = Object.entries(idioms)
        .map(([name, def]) => {
          const normName = name.startsWith("$") ? name : `$${name}`;
          const params = (def.params ?? []).map((p) => p.name).join(", ");
          return `${normName}(${params})`;
        })
        .join(", ");
      if (idiomNames) {
        minLines.push(`# @idioms available: ${idiomNames}`);
      }
    }
    minLines.push(effectiveBody);
    if (shouldEmitIdioms && idioms) {
      minLines.push("");
      minLines.push(formatIdiomsMarkdownSection(idioms));
    }
    if (nativeDiagnostics) {
      minLines.push("");
      minLines.push(nativeDiagnostics);
    }
    return minLines.join("\n");
  }
  targetBody = effectiveBody;

  const lines: string[] = [];

  lines.push(`# AICE Context Pack: ${displayTargetPath}`);
  lines.push("");

  lines.push("## Target File Content:");
  lines.push("```aice");
  if (shouldEmitIdioms && idioms && !targetBody.includes("# @idioms available:")) {
    const idiomNames = Object.entries(idioms)
      .map(([name, def]) => {
        const normName = name.startsWith("$") ? name : `$${name}`;
        const params = (def.params ?? []).map((p) => p.name).join(", ");
        return `${normName}(${params})`;
      })
      .join(", ");
    if (idiomNames) {
      lines.push(`# @idioms available: ${idiomNames}`);
    }
  }
  lines.push(targetBody);
  lines.push("```");
  lines.push("");

  lines.push(`## Imported Dependency Contracts (${dependencies.length}):`);
  if (dependencies.length === 0) {
    lines.push("None");
  } else {
    for (let i = 0; i < dependencies.length; i++) {
      const dep = dependencies[i];
      const resPath = dep.resolvedPath ? `\`${dep.resolvedPath}\`` : "external";
      lines.push(`### Dependency: \`${dep.specifier}\` (${resPath})`);
      lines.push("```aice");
      lines.push(dep.contract);
      lines.push("```");
      if (i < dependencies.length - 1) {
        lines.push("");
      }
    }
  }
  lines.push("");

  lines.push(`## Downstream Callers (${callers.length}):`);
  if (callers.length === 0) {
    lines.push("None");
  } else {
    for (const caller of callers) {
      const symStr = caller.importedSymbols.length > 0 ? caller.importedSymbols.join(", ") : "*";
      if (caller.usedSymbol && caller.callSiteLines && caller.callSiteLines.length > 0) {
        const lineTags = caller.callSiteLines.map((l) => `L${l}`).join(", ");
        lines.push(
          `- ${caller.filePath} imports: ${symStr} (uses ${caller.usedSymbol} at [${lineTags}])`,
        );
      } else {
        lines.push(`- \`${caller.filePath}\` imports: \`${symStr}\``);
      }
    }
  }

  if (shouldEmitIdioms && idioms) {
    lines.push("");
    lines.push(formatIdiomsMarkdownSection(idioms));
  }

  if (nativeDiagnostics) {
    lines.push("");
    lines.push(nativeDiagnostics);
  }

  return lines.join("\n");
}

/**
 * Recursively traverses `dir` up to `maxDepth` (default: 5) and returns all discovered
 * target files matching the 33 extensions in `KNOWN_TARGET_EXTENSIONS` (or `.aice`).
 */
export function scanDirectoryForTargets(dir: string, maxDepth = 5): string[] {
  const discovered: string[] = [];
  const absRoot = path.resolve(dir);
  const rootInNodeModules = absRoot.split(path.sep).includes("node_modules");
  const visitedDirs = new Set<string>();
  const ignoredDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    "build",
    ".aice-build",
    ".aice-cache",
    ".agents",
    ".next",
    ".turbo",
    "coverage",
    "target",
    "vendor",
    "__pycache__",
  ]);

  const walk = (currentDir: string, depth: number): void => {
    if (depth > maxDepth) return;
    let realCurrentDir = currentDir;
    try {
      realCurrentDir = fs.realpathSync(currentDir);
    } catch {
      // fallback to path
    }
    if (visitedDirs.has(realCurrentDir)) return;
    visitedDirs.add(realCurrentDir);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      if (entry.name === "." || entry.name === "..") continue;
      const fullPath = path.join(currentDir, entry.name);
      let isDir = entry.isDirectory();
      let isFile = entry.isFile();
      if (!isDir && !isFile) {
        try {
          const st = fs.statSync(fullPath);
          isDir = st.isDirectory();
          isFile = st.isFile();
        } catch {
          continue;
        }
      }
      if (isDir) {
        if (entry.name === ".git") continue;
        if (entry.name.startsWith(".") && entry.name !== ".github") continue;
        if (
          ignoredDirs.has(entry.name) &&
          !(
            rootInNodeModules &&
            (entry.name === "dist" || entry.name === "build" || entry.name === "out")
          )
        ) {
          continue;
        }
        walk(fullPath, depth + 1);
      } else if (isFile) {
        if (isSupportedReadDiskFile(fullPath)) {
          discovered.push(fullPath);
        }
      }
    }
  };

  if (fs.existsSync(absRoot)) {
    walk(absRoot, 0);
  }
  return discovered.sort();
}

/**
 * Packages a workspace overview context pack covering project configuration,
 * discovered files, module outlines, and dependencies.
 */
export async function generateWorkspaceContext(
  targetPath?: string,
  options: ContextOptions = {},
): Promise<ContextResult> {
  const preResolved = resolveEffectiveTargetAndRoot(targetPath, options.projectRoot);
  const resolved = resolvePathTargets(preResolved.targetPath, {
    includeTargets: true,
    projectRoot: preResolved.projectRoot,
  });

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }
  const displayTargetPath = formatDisplayPath(resolved.resolvedPath, projectRoot);

  const outlines: string[] = [];
  const symbolSlices: string[] = [];
  const dependencies: DependencyContract[] = [];
  const depMap = new Map<string, DependencyContract>();
  const rawWorkspaceTexts: string[] = [];
  const workspaceBaselineEntries: Array<{ relPath: string; rawSource: string }> = [];
  const isCliOrMcpWs = options.surface === "cli" || options.surface === "mcp";
  const effectiveWsIncludeDeps = isCliOrMcpWs
    ? (options.includeDeps ?? (options.depth !== undefined && options.depth > 0 ? true : false))
    : options.includeDeps;
  const effectiveWsIncludeCallers = isCliOrMcpWs
    ? (options.includeCallers ?? false)
    : options.includeCallers;
  const hasExplicitWsDeps =
    effectiveWsIncludeDeps === true || (options.depth !== undefined && options.depth > 0);
  const hasExplicitWsCallers = effectiveWsIncludeCallers === true;
  const hasExplicitWsEnvelopeOptIn = hasExplicitWsDeps || hasExplicitWsCallers;
  const requestedSelectors = options.symbol ? splitSymbolSelectors(options.symbol) : [];
  const isBareLineRangeOnly =
    resolved.isDirectory &&
    requestedSelectors.length > 0 &&
    requestedSelectors.every((s) => /^\[?L?\d+\s*[-–]\s*L?\d+\]?$/i.test(s.trim()));
  if (isBareLineRangeOnly) {
    const hintMsg = `// Bare line-range selector '${options.symbol}' requires a file target (e.g. 'aice context <file> -s "${options.symbol}"' or 'aice context <file>:${options.symbol}')`;
    return {
      targetPath: displayTargetPath,
      targetContent: hintMsg,
      dependencies: [],
      callers: [],
      formattedBundle: hintMsg,
    };
  }
  const isPureRegexSearch =
    requestedSelectors.length > 0 &&
    requestedSelectors.every((s) => /^\/.+\/[gimsuy]*$/.test(s.trim()));
  const regexMentionsIdiom =
    isPureRegexSearch && requestedSelectors.some((s) => /\$[A-Za-z_]/.test(s));

  const effectiveWsRawNative = options.dsl === true ? false : Boolean(options.rawNative);
  const idiomsActive =
    effectiveWsRawNative && options.idioms !== true
      ? false
      : isProjectIdiomsEnabled(config, options.idioms);
  let activeIdioms =
    idiomsActive && config.idioms && Object.keys(config.idioms).length > 0
      ? config.idioms
      : undefined;
  let zeroIdiomsReason: string | undefined;
  if (
    options.idioms === true &&
    (!activeIdioms || Object.keys(activeIdioms).length === 0) &&
    (!isPureRegexSearch || regexMentionsIdiom)
  ) {
    const cachedScan = options.workspaceScanCache?.idiomScanByRoot?.get(projectRoot);
    if (cachedScan) {
      if (Object.keys(cachedScan.idioms).length > 0) {
        activeIdioms = cachedScan.idioms;
        config.idioms = cachedScan.idioms;
      } else {
        zeroIdiomsReason = cachedScan.zeroIdiomsReason;
        activeIdioms = undefined;
      }
    } else {
      try {
        const scanRes = withSuppressedTelemetry(() => scanProjectIdioms(projectRoot));
        if (Object.keys(scanRes.idioms).length > 0) {
          activeIdioms = scanRes.idioms;
          config.idioms = scanRes.idioms;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: scanRes.idioms,
          });
        } else {
          zeroIdiomsReason = scanRes.zeroIdiomsReason ?? "insufficient_repetition";
          activeIdioms = undefined;
          options.workspaceScanCache?.idiomScanByRoot?.set(projectRoot, {
            idioms: {},
            zeroIdiomsReason,
          });
          console.error(
            "[AICE Idioms] 0 beneficial idioms discovered. FAST-PATH: Bypassing idiom layer. Use canonical AICE syntax (do not invent $idiom macros).",
          );
        }
      } catch {
        // ignore scan errors
      }
    }
  }

  const isPureAiceDirectory =
    resolved.files.length > 0 && resolved.files.every((f) => f.endsWith(".aice"));
  const workspaceFiles = isPureAiceDirectory
    ? resolved.files
    : Array.from(
        new Set([
          ...resolved.files,
          ...(resolved.isDirectory && fs.existsSync(resolved.resolvedPath)
            ? scanDirectoryForTargets(resolved.resolvedPath, 5)
            : []),
        ]),
      ).sort();

  options.workspaceScanCache?.filesByRoot.set(resolved.resolvedPath, workspaceFiles);
  const workspaceRootForRank = resolved.isDirectory ? resolved.resolvedPath : projectRoot;
  const relSearchDir = path.relative(projectRoot, resolved.resolvedPath).replace(/\\/g, "/");
  const baseSearchName = path.basename(resolved.resolvedPath);
  const isExplicitTestSearch =
    Boolean(resolved.resolvedPath) &&
    ((Boolean(relSearchDir) &&
      !relSearchDir.startsWith("..") &&
      /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/i.test(
        relSearchDir,
      )) ||
      /^(?:tests?|__tests__|mocks?|__mocks__|fixtures?|specs?)$/i.test(baseSearchName));

  const scoredFileSlices: Array<{
    relFile: string;
    absFile: string;
    rawFileContent: string;
    headerTag: string;
    sliceBody: string;
    score: number;
  }> = [];

  const useCompactWildcardOverview =
    requestedSelectors.includes("*") &&
    requestedSelectors.length === 1 &&
    workspaceFiles.length >= 8 &&
    options.maxTokens === undefined;

  for (const f of workspaceFiles) {
    const relFile = formatDisplayPath(f, projectRoot);
    try {
      const rawFileContent = fs.readFileSync(f, "utf-8");
      rawWorkspaceTexts.push(rawFileContent);
      workspaceBaselineEntries.push({ relPath: relFile, rawSource: rawFileContent });

      if (isPureRegexSearch && !regexMentionsIdiom) {
        const matchedSlices: string[] = [];
        const isMockOrTest = !isExplicitTestSearch && isTestOrMockPath(f, workspaceRootForRank);
        let fileMaxScore = 0;
        const queryKw = extractPrimaryQueryKeyword(requestedSelectors[0] ?? "");
        const fileNameMatches = doesFileStemMatchQuery(f, queryKw);

        for (const rawSel of requestedSelectors) {
          const detailed = extractPatternMatchesDetailed(
            rawFileContent,
            rawSel.trim(),
            options.contextLines,
            {
              filePath: f,
              projectRoot: workspaceRootForRank,
              isExplicitTestSearch,
              full: options.full,
              dsl: options.dsl,
              compactGrouped: effectiveWsRawNative,
            },
          );
          if (detailed) {
            matchedSlices.push(detailed.formattedText.trimEnd());
            if (detailed.maxScore > fileMaxScore) {
              fileMaxScore = detailed.maxScore;
            }
          }
        }
        if (matchedSlices.length === 0) {
          if (fileNameMatches) {
            const cleanLines = (
              rawFileContent.length > 0 ? rawFileContent.replace(/\r?\n$/, "") : ""
            ).split(/\r?\n/);
            const previewCount = Math.min(effectiveWsRawNative ? 3 : 5, cleanLines.length);
            const previewLines = effectiveWsRawNative
              ? cleanLines
                  .slice(0, previewCount)
                  .map((l, idx) => `  L${idx + 1}: ${l}`)
                  .join("\n")
              : cleanLines
                  .slice(0, previewCount)
                  .map((l, idx) => `${idx + 1}│ ${l}`)
                  .join("\n");
            matchedSlices.push(
              effectiveWsRawNative
                ? previewLines
                : `// file name match: ${path.basename(f)} # [L1-L${Math.max(1, previewCount)}]\n${previewLines}`,
            );
            fileMaxScore = isMockOrTest ? 25 : 1000;
          } else {
            continue;
          }
        }
        if (effectiveWsRawNative) {
          scoredFileSlices.push({
            relFile,
            absFile: f,
            rawFileContent,
            headerTag: "",
            sliceBody: matchedSlices.filter(Boolean).join("\n"),
            score: fileMaxScore,
          });
          continue;
        }
        const annotateMatchHeader = (sl: string): string =>
          sl.replace(/^\/\/ match at \[([^\]]+)\]/gm, (_full, bracketBody: string) => {
            const hitRefs = bracketBody
              .split(",")
              .map((s) => s.trim().replace(/^L/i, ""))
              .filter(Boolean)
              .map((lineNum) => `(${relFile}:${lineNum})`);
            return hitRefs.length > 0
              ? `// match at [${bracketBody}] ${hitRefs.join(" ")}`
              : `// match at [${bracketBody}]`;
          });
        const hitTags = Array.from(
          new Set(
            matchedSlices
              .flatMap((sl) => Array.from(sl.matchAll(/^\/\/ match at \[([^\]]+)\]/gm)))
              .flatMap((m) => m[1]!.split(",").map((s) => s.trim()))
              .filter(Boolean),
          ),
        );
        const annotatedSlices = matchedSlices.map(annotateMatchHeader);
        const sliceBody = annotatedSlices.filter(Boolean).join("\n\n");
        const headerTag = hitTags.length > 0 ? ` [${hitTags.join(", ")}]` : "";

        scoredFileSlices.push({
          relFile,
          absFile: f,
          rawFileContent,
          headerTag,
          sliceBody,
          score: fileMaxScore,
        });
        continue;
      }

      if (!isPureAiceDirectory && requestedSelectors.length === 0) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: false,
            compact: true,
            depth: options.depth ?? 1,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const fileDiags = collectNativeSyntaxDiagnostics(f, rawFileContent);
        const outlineBody = (fileDiags ? `${oRes.text}\n${fileDiags}` : oRes.text).trim();
        outlines.push(`// === ${relFile} ===\n${outlineBody || "// (empty)"}`);
        continue;
      }

      if (useCompactWildcardOverview) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: true,
            compact: true,
            depth: options.depth ?? 2,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const compactBody = oRes.text.trim() || "// (empty)";
        symbolSlices.push(`// === ${relFile} ===\n${compactBody}`);
        continue;
      }

      let fileAice = rawFileContent;
      if (
        !f.endsWith(".aice") &&
        !(effectiveWsRawNative && !idiomsActive && !requestedSelectors.includes("*"))
      ) {
        const detected = detectTargetFromPathOrContent(f, rawFileContent);
        if (
          detected !== "passthrough" &&
          detected !== "xml" &&
          detected !== "java" &&
          detected !== "text"
        ) {
          try {
            const targetLang = detected;
            const decomp = withSuppressedTelemetry(() =>
              decompile(rawFileContent, targetLang, { filePath: f, projectRoot }),
            );
            fileAice = decomp.aice;
          } catch {
            fileAice = rawFileContent;
          }
        }
      }
      if (idiomsActive && activeIdioms && Object.keys(activeIdioms).length > 0) {
        try {
          fileAice = collapseAiceSourceIdioms(fileAice, activeIdioms, f).aice;
        } catch {
          // ignore
        }
      }
      const allSyms = extractFileSymbolList(fileAice, f);
      const symHeader = allSyms.length > 0 ? `// symbols: ${allSyms.join(", ")}` : "";

      if (requestedSelectors.length === 0) {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: true,
            depth: options.depth,
            idioms: options.idioms,
            projectRoot,
            preReadSource: rawFileContent,
          }),
        );
        const fileDiags = collectNativeSyntaxDiagnostics(f, rawFileContent);
        const baseOutlineBody =
          symHeader &&
          (f.endsWith(".html") || f.endsWith(".twig") || f.endsWith(".json") || f.endsWith(".yaml"))
            ? `${symHeader}\n${oRes.text}`
            : oRes.text;
        const outlineBody = fileDiags ? `${baseOutlineBody}\n\n${fileDiags}` : baseOutlineBody;
        outlines.push(`### \`${relFile}\`\n\`\`\`aice\n${outlineBody}\n\`\`\``);
      }

      if (requestedSelectors.length > 0) {
        const fileSlices: string[] = [];
        if (requestedSelectors.includes("*")) {
          if (
            (f.endsWith(".html") || f.endsWith(".json") || f.endsWith(".yaml")) &&
            allSyms.length > 0
          ) {
            for (const sym of allSyms) {
              try {
                let sliced = unwrapSyntheticContainer(
                  extractSymbolFromAiceSource(fileAice, sym, f)
                    .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                    .trim(),
                  f,
                );
                sliced = compactPureAiceSlice(sliced);
                if (sliced) fileSlices.push(sliced);
              } catch {
                // fallback handled below if needed
              }
            }
          }
          if (fileSlices.length === 0) {
            let cleanedAll = unwrapSyntheticContainer(
              fileAice.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
              f,
            );
            cleanedAll = compactPureAiceSlice(cleanedAll);
            fileSlices.push(cleanedAll);
          }
        } else {
          for (const rawSel of requestedSelectors) {
            let symSel = rawSel;
            const colonIdx = rawSel.indexOf(":");
            if (
              colonIdx > 0 &&
              !rawSel.startsWith("block:") &&
              !rawSel.startsWith("/") &&
              !rawSel.startsWith("#") &&
              !rawSel.includes("::")
            ) {
              const candidateFilter = rawSel.slice(0, colonIdx).trim();
              const matchesKnownFile = workspaceFiles.some(
                (cand) =>
                  path.basename(cand) === candidateFilter ||
                  formatDisplayPath(cand, projectRoot) === candidateFilter,
              );
              if (matchesKnownFile) {
                symSel = rawSel.slice(colonIdx + 1).trim();
                if (path.basename(f) !== candidateFilter && relFile !== candidateFilter) {
                  continue;
                }
              }
            }
            if (symSel === "@first" || symSel === "@1") {
              const firstSym = resolveFirstActionableSymbol(fileAice, f);
              if (!firstSym) continue;
              symSel = firstSym;
            }
            try {
              const rawExtracted = extractSymbolFromAiceSource(fileAice, symSel, f, undefined, {
                numberLines: true,
                clampOutOfBounds: true,
                rawNative: effectiveWsRawNative,
                contextLines: options.contextLines,
                full: options.full,
                dsl: options.dsl,
                projectRoot,
              });
              const isRawOrMatch =
                effectiveWsRawNative ||
                rawExtracted.startsWith("// match at [") ||
                f.endsWith(".md") ||
                f.endsWith(".markdown") ||
                f.endsWith(".sh") ||
                f.endsWith(".bash") ||
                f.endsWith(".zsh") ||
                f.endsWith(".ps1") ||
                f.endsWith(".cmd") ||
                f.endsWith(".bat") ||
                f.endsWith(".aipl");
              let sliced = isRawOrMatch
                ? rawExtracted.trim()
                : unwrapSyntheticContainer(
                    rawExtracted.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
                    f,
                  );
              if (!isRawOrMatch) {
                sliced = compactPureAiceSlice(sliced);
              }
              fileSlices.push(sliced);
            } catch {
              // symbol lives in another file
            }
          }
        }
        if (fileSlices.length > 0) {
          const hitTags = Array.from(
            new Set(
              fileSlices
                .flatMap((sl) => Array.from(sl.matchAll(/^\/\/ match at \[([^\]]+)\]/gm)))
                .flatMap((m) => m[1].split(",").map((s) => s.trim()))
                .filter(Boolean),
            ),
          );
          const alreadyHasSymHeader = fileSlices.some((sl) => sl.startsWith("// symbols:"));
          const sliceBody = [alreadyHasSymHeader ? "" : symHeader, ...fileSlices]
            .filter(Boolean)
            .join("\n\n");
          if (sliceBody) {
            if (hitTags.length > 0) {
              symbolSlices.push(
                `### ${relFile} [${hitTags.join(", ")}]\n\`\`\`aice\n${sliceBody}\n\`\`\``,
              );
            } else {
              symbolSlices.push(`### \`${relFile}\`\n\`\`\`aice\n${sliceBody}\n\`\`\``);
            }
          }
        }
        continue;
      }

      if (!isPureAiceDirectory) {
        continue;
      }

      const imports = extractImportsFromFile(f);
      for (const imp of imports) {
        const specifier = imp.source;
        const importedSymbols = imp.specifiers.map((s) => s.name);
        const isExternal = isExternalSpecifier(specifier);
        let resolvedImportPath: string | undefined;

        if (!isExternal) {
          resolvedImportPath = resolveImportPath(f, specifier, config, projectRoot);
        }

        const key = isExternal
          ? `ext:${specifier}`
          : resolvedImportPath
            ? `res:${path.resolve(resolvedImportPath)}`
            : `unres:${specifier}`;

        if (depMap.has(key)) {
          const existing = depMap.get(key)!;
          let added = false;
          for (const sym of importedSymbols) {
            if (!existing.importedSymbols.includes(sym)) {
              existing.importedSymbols.push(sym);
              added = true;
            }
          }
          if (added) {
            if (isExternal) {
              existing.contract = generateExternalContract(specifier, existing.importedSymbols);
            } else if (resolvedImportPath) {
              existing.contract = extractExportedContract(
                resolvedImportPath,
                existing.importedSymbols,
              );
            }
          }
        } else {
          let contract: string;
          let displayDepPath: string | undefined;

          if (isExternal) {
            contract = generateExternalContract(specifier, importedSymbols);
          } else if (resolvedImportPath) {
            displayDepPath = formatDisplayPath(resolvedImportPath, projectRoot);
            contract = extractExportedContract(resolvedImportPath, importedSymbols);
          } else {
            contract = `// unresolved: ${specifier}`;
          }

          const depContract: DependencyContract = {
            specifier,
            resolvedPath: displayDepPath,
            importedSymbols,
            isExternal,
            contract,
          };

          dependencies.push(depContract);
          depMap.set(key, depContract);
        }
      }
    } catch {
      // ignore outline errors for individual files in overview
    }
  }

  if (isPureRegexSearch && scoredFileSlices.length > 0) {
    scoredFileSlices.sort((a, b) => b.score - a.score || a.relFile.localeCompare(b.relFile));
    const searchByteBudget = options.maxByteBudget;
    const softNarrowThreshold =
      searchByteBudget !== undefined ? Math.floor(searchByteBudget * 0.65) : undefined;
    const hardSliceCap =
      searchByteBudget !== undefined ? Math.max(1024, searchByteBudget - 220) : undefined;
    let runningSearchBytes = 0;
    const omittedSearchFiles: string[] = [];

    const buildFormattedEntry = (relFile: string, headerTag: string, body: string): string =>
      !hasExplicitWsEnvelopeOptIn
        ? effectiveWsRawNative
          ? `${relFile}:\n${body}`
          : `// === ${relFile} ===\n${body}`
        : `### ${relFile}${headerTag}\n\`\`\`aice\n${body}\n\`\`\``;

    for (let idx = 0; idx < scoredFileSlices.length; idx++) {
      const item = scoredFileSlices[idx]!;
      let chosenBody = item.sliceBody;
      if (
        !effectiveWsRawNative &&
        softNarrowThreshold !== undefined &&
        options.contextLines === undefined &&
        idx > 0 &&
        (runningSearchBytes >= softNarrowThreshold || item.score < 200)
      ) {
        const narrowedParts: string[] = [];
        for (const rawSel of requestedSelectors) {
          const narrowDet = extractPatternMatchesDetailed(item.rawFileContent, rawSel.trim(), 2, {
            filePath: item.absFile,
            projectRoot: workspaceRootForRank,
            isExplicitTestSearch,
          });
          if (narrowDet) {
            const annotated = narrowDet.formattedText
              .trim()
              .replace(/^\/\/ match at \[([^\]]+)\]/gm, (_full, bracketBody: string) => {
                const hitRefs = bracketBody
                  .split(",")
                  .map((s) => s.trim().replace(/^L/i, ""))
                  .filter(Boolean)
                  .map((lineNum) => `${item.relFile}:${lineNum}`);
                return hitRefs.length > 0
                  ? `// match at [${bracketBody}] (${hitRefs.join(", ")})`
                  : `// match at [${bracketBody}]`;
              });
            if (annotated) narrowedParts.push(annotated);
          }
        }
        if (narrowedParts.length > 0) {
          chosenBody = narrowedParts.join("\n\n");
        }
      }

      const formattedEntry = buildFormattedEntry(item.relFile, item.headerTag, chosenBody);
      const sepLen = symbolSlices.length > 0 ? (effectiveWsRawNative ? 1 : 2) : 0;
      const entryBytes = Buffer.byteLength(formattedEntry, "utf-8") + sepLen;
      if (
        hardSliceCap !== undefined &&
        symbolSlices.length > 0 &&
        runningSearchBytes + entryBytes > hardSliceCap
      ) {
        omittedSearchFiles.push(...scoredFileSlices.slice(idx).map((s) => s.relFile));
        break;
      }
      symbolSlices.push(formattedEntry);
      runningSearchBytes += entryBytes;
    }

    if (omittedSearchFiles.length > 0) {
      const primarySel = requestedSelectors[0]?.trim() ?? "/pattern/";
      const nextTarget = omittedSearchFiles[0] ?? ".";
      symbolSlices.push(
        `// +${omittedSearchFiles.length} more files — next: aice read '${nextTarget}:${primarySel}'`,
      );
    }
  }

  if (requestedSelectors.length > 0 && symbolSlices.length === 0 && !isPureRegexSearch) {
    for (const f of workspaceFiles) {
      const relFile = formatDisplayPath(f, projectRoot);
      try {
        const oRes = withSuppressedTelemetry(() =>
          generateOutline(f, {
            includeTypes: false,
            compact: true,
            depth: options.depth ?? 1,
            idioms: options.idioms,
            projectRoot,
          }),
        );
        outlines.push(`// === ${relFile} ===\n${oRes.text.trim() || "// (empty)"}`);
      } catch {
        // ignore
      }
    }
  }

  const wsCallers: CallerSummary[] = [];
  if (isPureRegexSearch && hasExplicitWsEnvelopeOptIn) {
    for (const item of scoredFileSlices) {
      const absMatchFile = path.resolve(projectRoot, item.relFile);
      if (!fs.existsSync(absMatchFile)) continue;
      if (hasExplicitWsDeps && options.includeDeps !== false) {
        for (const imp of extractImportsFromFile(absMatchFile)) {
          const specifier = imp.source;
          const importedSymbols = imp.specifiers.map((s) => s.name);
          const isExternal = isExternalSpecifier(specifier);
          const resolvedImportPath = isExternal
            ? undefined
            : resolveImportPath(absMatchFile, specifier, config, projectRoot);
          const key = isExternal
            ? `ext:${specifier}`
            : resolvedImportPath
              ? `res:${path.resolve(resolvedImportPath)}`
              : `unres:${specifier}`;
          if (!depMap.has(key)) {
            const displayDepPath = resolvedImportPath
              ? formatDisplayPath(resolvedImportPath, projectRoot)
              : undefined;
            const contract = isExternal
              ? generateExternalContract(specifier, importedSymbols)
              : resolvedImportPath
                ? extractExportedContract(resolvedImportPath, importedSymbols)
                : `// unresolved: ${specifier}`;
            const depContract: DependencyContract = {
              specifier,
              resolvedPath: displayDepPath,
              importedSymbols,
              isExternal,
              contract,
            };
            dependencies.push(depContract);
            depMap.set(key, depContract);
          }
        }
      }
      if (hasExplicitWsCallers) {
        for (const callerItem of scanWorkspaceCallers(
          absMatchFile,
          projectRoot,
          config,
          undefined,
          options.workspaceScanCache,
        )) {
          if (!wsCallers.some((c) => c.filePath === callerItem.filePath)) {
            wsCallers.push(callerItem);
          }
        }
      }
    }
  }

  // Format bundle
  const parts: string[] = [];
  if (isPureRegexSearch && !hasExplicitWsEnvelopeOptIn) {
    if (symbolSlices.length > 0) {
      parts.push(symbolSlices.join(effectiveWsRawNative ? "\n" : "\n\n"));
    } else {
      const safeDisp = displayTargetPath || ".";
      parts.push(
        effectiveWsRawNative
          ? `// 0 matches for '${options.symbol ?? ""}' in ${safeDisp}`
          : `// === ${safeDisp} ===\n// Pattern '${options.symbol ?? ""}' had 0 matches in ${safeDisp}`,
      );
    }
  } else if (isPureRegexSearch && hasExplicitWsEnvelopeOptIn) {
    const bodyText =
      symbolSlices.length > 0
        ? symbolSlices.join("\n\n")
        : `// Pattern '${options.symbol ?? ""}' had 0 matches in ${displayTargetPath}`;
    parts.push(
      formatBundle(displayTargetPath, bodyText, dependencies, wsCallers, activeIdioms, undefined, {
        minimalEnvelope: false,
      }),
    );
  } else if (requestedSelectors.length > 0) {
    if (symbolSlices.length > 0) {
      parts.push("## Target Symbol Slices:", ...symbolSlices, "");
    } else if (outlines.length > 0) {
      parts.push("## Outlines:", ...outlines, "");
    }
    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      const bundlePreview = [...outlines, ...symbolSlices].join("\n");
      const usedIdioms: Record<string, ProjectIdiomDefinition> = {};
      for (const [k, def] of Object.entries(activeIdioms)) {
        const norm = k.startsWith("$") ? k : `$${k}`;
        if (bundlePreview.includes(norm)) {
          usedIdioms[norm] = def;
        }
      }
      if (Object.keys(usedIdioms).length > 0) {
        parts.push(formatIdiomsMarkdownSection(usedIdioms), "");
      }
    }
  } else if (!isPureAiceDirectory) {
    parts.push(
      `# AICE Directory Outline: ${displayTargetPath} (${workspaceFiles.length} files)`,
      ...outlines,
    );
    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      parts.push("", formatIdiomsMarkdownSection(activeIdioms));
    }
  } else {
    parts.push(
      `# AICE Workspace Overview Context Pack: ${displayTargetPath}`,
      "",
      "## Project Configuration:",
      `- Mode: ${config.mode}`,
      `- Source Directory: ${config.sourceDir}`,
      `- Output Directory: ${config.outDir}`,
      `- Target Language: ${config.targetLanguage}`,
      `- Files Count: ${workspaceFiles.length}`,
      "",
      `## Workspace Files (${workspaceFiles.length}):`,
      ...workspaceFiles.map((f) => `- \`${formatDisplayPath(f, projectRoot)}\``),
      "",
    );

    if (outlines.length > 0) {
      parts.push("## Module Outlines:", ...outlines, "");
    }

    if (dependencies.length > 0) {
      parts.push(`## Workspace Dependencies (${dependencies.length}):`);
      for (const dep of dependencies) {
        parts.push(
          `### Dependency: \`${dep.specifier}\`${dep.resolvedPath ? ` (\`${dep.resolvedPath}\`)` : ""}`,
        );
        parts.push("```aice");
        parts.push(dep.contract);
        parts.push("```");
        parts.push("");
      }
    }

    if (activeIdioms && Object.keys(activeIdioms).length > 0) {
      parts.push(formatIdiomsMarkdownSection(activeIdioms), "");
    }
  }

  let formattedBundle = parts.join("\n");
  let tokenCount = estimateTokens(formattedBundle);

  // Apply maxTokens bounding if requested
  if (options.maxTokens !== undefined && tokenCount > options.maxTokens) {
    if (requestedSelectors.length > 0 && symbolSlices.length > 1) {
      const keptSlices = [...symbolSlices];
      let droppedCount = 0;
      while (keptSlices.length > 1) {
        keptSlices.pop();
        droppedCount++;
        const omitNote = `// ... (+${droppedCount} lower-ranked file matches omitted to fit maxTokens)`;
        const candidate = ["## Target Symbol Slices:", ...keptSlices, omitNote].join("\n");
        if (estimateTokens(candidate) <= options.maxTokens) {
          formattedBundle = candidate;
          tokenCount = estimateTokens(formattedBundle);
          break;
        }
      }
      if (tokenCount > options.maxTokens && keptSlices.length === 1) {
        const omitNote = `// ... (+${droppedCount} lower-ranked file matches omitted to fit maxTokens)`;
        formattedBundle = ["## Target Symbol Slices:", keptSlices[0]!, omitNote].join("\n");
        tokenCount = estimateTokens(formattedBundle);
      }
    }

    if (tokenCount > options.maxTokens) {
      const truncatedFooter = "\n// ... [truncated to fit maxTokens]";
      const bundleLines = formattedBundle.split("\n");
      while (bundleLines.length > 1) {
        bundleLines.pop();
        const openFenceCount = bundleLines.filter((l) => l.startsWith("```")).length;
        const closeFence = openFenceCount % 2 === 1 ? "\n```" : "";
        const candidate = `${bundleLines.join("\n")}${closeFence}${truncatedFooter}`;
        if (estimateTokens(candidate) <= options.maxTokens) {
          formattedBundle = candidate;
          tokenCount = estimateTokens(formattedBundle);
          break;
        }
      }
      if (tokenCount > options.maxTokens) {
        let chars = formattedBundle.length;
        while (
          chars > 0 &&
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
        ) {
          chars = Math.floor(chars * 0.7);
        }
        formattedBundle =
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens
            ? (chars > 0 ? formattedBundle.slice(0, chars) : "") + truncatedFooter
            : truncatedFooter.slice(0, Math.max(0, options.maxTokens * 3));
        tokenCount = estimateTokens(formattedBundle);
      }
    }
  }

  const targetContent =
    requestedSelectors.length > 0
      ? symbolSlices.length > 0
        ? symbolSlices.join("\n\n")
        : outlines.join("\n\n")
      : !isPureAiceDirectory
        ? outlines.join("\n\n")
        : workspaceFiles.map((f) => formatDisplayPath(f, projectRoot)).join("\n");

  const resObj: ContextResult = {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline: outlines.join("\n\n"),
    dependencies,
    callers: wsCallers,
    formattedBundle,
    tokenCount,
    idioms: activeIdioms,
    ...(zeroIdiomsReason ? { zeroIdiomsReason } : {}),
  };

  if (rawWorkspaceTexts.length > 0 || isPureRegexSearch) {
    const wsBaselineText = computeHonestReadBaselineText({
      relPath: displayTargetPath || ".",
      workspaceFiles: workspaceBaselineEntries,
      symbolSelector: isPureRegexSearch ? options.symbol : undefined,
      mode: isPureRegexSearch ? "search" : "workspace",
      includeToolWrapper: false,
    });
    const rawWsText = workspaceBaselineEntries.map((e) => e.rawSource).join("\n");
    const wsRealCl100k = estimateTokens(wsBaselineText, "cl100k_base");
    const wsRawCl100k = Math.max(wsRealCl100k, estimateTokens(rawWsText, "cl100k_base"));
    recordTelemetryEvent({
      targetPath: resolved.resolvedPath,
      projectRoot,
      operation: "context",
      surface: options.surface ?? "cli",
      idiomsUsed: Boolean(activeIdioms && Object.keys(activeIdioms).length > 0),
      isSearchMode: isPureRegexSearch,
      nativeText: rawWsText,
      nativeChars: Math.max(wsBaselineText.length, rawWsText.length),
      nativeCl100k: wsRawCl100k,
      realisticNativeText: wsBaselineText,
      realisticNativeCl100k: Math.min(wsRawCl100k, wsRealCl100k),
      aiceText: options.json ? JSON.stringify(resObj, null, 2) : formattedBundle,
    });
  }

  return resObj;
}
