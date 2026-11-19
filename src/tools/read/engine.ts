/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  isLikelyBinaryDiskFile,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  resolvePathTargets,
} from "../../config/index.js";
import { recordTelemetryEvent, withSuppressedTelemetryAsync } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import {
  type ContextOptions,
  type ContextResult,
  computeHonestReadBaselineText,
  generateContext,
  type HonestBaselineFileEntry,
  mergeMultiContextResults,
  type WorkspaceCallerScanCache,
} from "../context.js";
import {
  isSupportedReadDiskFile,
  type OutlineOptions,
  type OutlineResult,
  outlinePath,
} from "../outline.js";
import { didYouMeanFile } from "../suggest.js";
import { buildSafeSearchRegexSelector, executeFilesOnlyRead } from "./discovery.js";
import {
  buildAntiPaginationHintForTarget,
  buildAutoOutlineHeader,
  closeUnclosedMarkdownFence,
  compactAutoOutlineBlock,
  computeDynamicReadBudget,
  enforceReadBudgetCeiling,
  extractRepresentativeSymbolHints,
  formatAggregateOutlineStatsFooter,
  formatBatchSymbolsOrSearchHint,
  formatContextStatsFooter,
  formatSingleOutlineStatsFooter,
  parseSelectorLineRange,
  shouldEnforceDefaultReadBudget,
} from "./dynamic-budget.js";
import {
  collectSearchCandidateFiles,
  executeFilesWithMatchesSearch,
  executeUnifiedCompactSearch,
} from "./search.js";
import {
  formatReadDisplayPath,
  isPureRegexSelector,
  normalizeContextResultDisplayPath,
  normalizeReadTargets,
  resolveEffectiveTargetAndRoot,
  splitCommaSelectors,
  truncateBundleToMaxTokens,
} from "./target-parsing.js";
import {
  type ClassifiedReadTarget,
  countSourceLines,
  DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD,
  LINE_RANGE_SELECTOR_RE,
  type ReadOptions,
  type ReadResult,
  type ReadRouteMode,
  type ReadStats,
  type ReadTargetInput,
  type ReadTargetSummary,
  resolveEffectiveReadBudgets,
  resolveEffectiveReadRawNative,
} from "./types-and-budgets.js";

/**
 * Unified Read Engine (`aice read` / MCP `aice_read`).
 *
 * Accepts omitted/empty targets, a single target string, or an array of targets with optional
 * inline selectors (`:symbol`, `:Lstart-Lend`, `:/pattern/`, `:outline`), routing each target
 * automatically to structural `outlinePath` or `generateContext` / 4-tier search.
 */
export async function aiceRead(
  targets?: ReadTargetInput | ReadTargetInput[],
  options: ReadOptions = {},
): Promise<ReadResult> {
  const surface = options.surface ?? "cli";
  const isCliOrMcpSurface = options.surface === "cli" || options.surface === "mcp";
  const effectiveIncludeDeps = isCliOrMcpSurface
    ? (options.includeDeps ?? (options.depth !== undefined && options.depth > 0 ? true : false))
    : options.includeDeps;
  const effectiveIncludeCallers = isCliOrMcpSurface
    ? (options.includeCallers ?? false)
    : options.includeCallers;
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const effectiveBudgets = resolveEffectiveReadBudgets(options);

  if (options.filesOnly === true) {
    return executeFilesOnlyRead(targets, options, baseDir, surface);
  }

  const effectiveRawNative = resolveEffectiveReadRawNative(options);
  const safeSearch =
    options.search !== undefined && options.search.length > 0
      ? buildSafeSearchRegexSelector(options.search)
      : undefined;

  let normalizedItems = normalizeReadTargets(targets, baseDir, {
    coalesceSameFile: !options.json,
  });
  if (normalizedItems.length === 0 && (safeSearch !== undefined || options.filesWithMatches)) {
    normalizedItems = normalizeReadTargets(["."], baseDir, {
      coalesceSameFile: !options.json,
    });
  }

  // 1. Omitted / Empty Targets -> Workspace Overview (or Workspace Outline / Search)
  if (normalizedItems.length === 0) {
    const resolvedWs = resolvePathTargets(undefined, {
      includeTargets: true,
      projectRoot: options.projectRoot,
    });
    if (!isProjectAiceEnabled(resolvedWs.config)) {
      throw new Error(AICE_DISABLED_MESSAGE);
    }
    const projectRoot = resolvedWs.projectRoot;
    const effectiveIdioms =
      effectiveRawNative && options.idioms !== true
        ? false
        : isProjectIdiomsEnabled(resolvedWs.config, options.idioms);
    const sharedSymTrimmed = options.symbol?.trim() || undefined;
    const explicitWsOutline =
      Boolean(options.outline) || sharedSymTrimmed?.toLowerCase() === "outline";

    if (explicitWsOutline) {
      const outlineRes = await withSuppressedTelemetryAsync(() =>
        outlinePath(resolvedWs.resolvedPath, {
          depth: options.depth,
          compact: options.compact,
          includeTypes: options.includeTypes !== false,
          idioms: effectiveIdioms,
          json: Boolean(options.json),
          stats: Boolean(options.stats),
          projectRoot,
        }),
      );
      return buildPureOutlineResult({
        outlineRes,
        classified: [
          {
            norm: {
              raw: ".",
              targetPath: ".",
              explicitOutline: true,
              explicitFull: false,
            },
            resolved: resolvedWs,
            diskPath: resolvedWs.resolvedPath,
            displayPath: ".",
            isDir: true,
            route: "outline",
            usesSharedSymbol: false,
          },
        ],
        missingTargets: [],
        projectRoot,
        options,
        surface,
      });
    }

    const wsMode: ReadRouteMode = sharedSymTrimmed
      ? isPureRegexSelector(sharedSymTrimmed)
        ? "search"
        : "context"
      : "workspace";
    const enforceWsBudget = shouldEnforceDefaultReadBudget(options);
    const ctxRes = await withSuppressedTelemetryAsync(() =>
      generateContext(undefined, {
        depth: options.depth,
        symbol: sharedSymTrimmed,
        idioms: effectiveIdioms,
        includeDeps: effectiveIncludeDeps,
        includeCallers: effectiveIncludeCallers,
        outlineTarget: Boolean(options.outlineTarget),
        maxTokens: options.maxTokens,
        maxByteBudget: enforceWsBudget ? effectiveBudgets.maxBytes : undefined,
        rawNative: effectiveRawNative,
        dsl: options.dsl,
        contextLines: options.contextLines,
        json: Boolean(options.json),
        stats: Boolean(options.stats),
        projectRoot,
        workspaceScanCache: options.workspaceScanCache,
        surface: options.surface,
        full: options.full,
        unboundedCli: options.unboundedCli,
      }),
    );

    const nativeFiles = resolvedWs.files;
    let nativeText = "";
    let rawWsFullText = "";
    try {
      const wsEntries = nativeFiles
        .slice(0, 20)
        .filter((fp) => fs.existsSync(fp))
        .map((fp) => ({
          relPath: formatReadDisplayPath(fp, projectRoot),
          rawSource: fs.readFileSync(fp, "utf-8"),
        }));
      rawWsFullText = wsEntries.map((e) => e.rawSource).join("\n");
      nativeText = computeHonestReadBaselineText({
        relPath: ".",
        workspaceFiles: wsEntries,
        symbolSelector:
          sharedSymTrimmed && isPureRegexSelector(sharedSymTrimmed) ? sharedSymTrimmed : undefined,
        mode: wsMode === "search" ? "search" : "workspace",
        includeToolWrapper: false,
      });
    } catch {
      // ignore unreadable workspace files
    }
    const jsonData = ctxRes;
    const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;

    let wsFormattedBundle = ctxRes.formattedBundle;
    let tokenCount = ctxRes.tokenCount ?? estimateTokens(wsFormattedBundle);
    const statsText = options.stats
      ? formatContextStatsFooter(
          tokenCount,
          ctxRes.dependencies.length,
          ctxRes.callers.length,
          ctxRes.targetContent.length,
        )
      : undefined;
    let output =
      jsonOutput ?? (statsText ? `${wsFormattedBundle}\n\n${statsText}` : wsFormattedBundle);

    if (enforceWsBudget) {
      const firstNextFile =
        nativeFiles.length > 0 ? formatReadDisplayPath(nativeFiles[0]!, projectRoot) : ".";
      const capped = enforceReadBudgetCeiling({
        bundle: wsFormattedBundle,
        fallbackTargetPath: firstNextFile,
        statsText,
        projectRoot,
        maxBytes: effectiveBudgets.maxBytes,
        maxTokens: effectiveBudgets.maxTokens,
        sliceByteBudget: effectiveBudgets.sliceByteBudget,
        budgetLabel: effectiveBudgets.budgetLabel,
      });
      wsFormattedBundle = capped.formattedBundle;
      output = capped.output;
      tokenCount = capped.tokenCount;
    }

    const wsRealTok = estimateTokens(nativeText, "cl100k_base");
    const wsRawTok = Math.max(wsRealTok, estimateTokens(rawWsFullText, "cl100k_base"));
    recordTelemetryEvent({
      targetPath: resolvedWs.resolvedPath,
      projectRoot,
      operation: "context",
      surface,
      idiomsUsed: Boolean(ctxRes.idioms && Object.keys(ctxRes.idioms).length > 0),
      isSearchMode: wsMode === "search",
      nativeText: rawWsFullText || nativeText,
      nativeCl100k: wsRawTok,
      realisticNativeText: nativeText,
      realisticNativeCl100k: Math.min(wsRawTok, wsRealTok),
      aiceText: jsonOutput ?? wsFormattedBundle,
    });

    const stats: ReadStats = {
      tokenCount,
      outputChars: wsFormattedBundle.length,
      dependenciesCount: ctxRes.dependencies.length,
      callersCount: ctxRes.callers.length,
      fileCount: nativeFiles.length,
    };

    return {
      mode: wsMode,
      targetPath: ctxRes.targetPath,
      text: wsFormattedBundle,
      formattedBundle: wsFormattedBundle,
      targetContent: ctxRes.targetContent,
      output,
      tokenCount,
      targets: [
        {
          targetPath: ctxRes.targetPath,
          resolvedPath: resolvedWs.resolvedPath,
          mode: wsMode,
          ...(sharedSymTrimmed ? { selector: sharedSymTrimmed } : {}),
        },
      ],
      missingTargets: [],
      dependencies: ctxRes.dependencies,
      callers: ctxRes.callers,
      idioms: ctxRes.idioms,
      nativeDiagnostics: ctxRes.nativeDiagnostics,
      contextResult: ctxRes,
      jsonData,
      jsonOutput,
      stats,
      statsText,
    };
  }

  // 2. Resolve & Classify Explicit Targets
  const isMultiInput = normalizedItems.length > 1;
  const sharedScanCache: WorkspaceCallerScanCache = options.workspaceScanCache ?? {
    filesByRoot: new Map(),
    fileContentByPath: new Map(),
    importsByPath: new Map(),
    idiomScanByRoot: new Map(),
  };
  if (!sharedScanCache.idiomScanByRoot) {
    sharedScanCache.idiomScanByRoot = new Map();
  }

  const classified: ClassifiedReadTarget[] = [];
  const missingTargets: string[] = [];
  const explicitLineThreshold = options.autoOutlineLineThreshold;
  const explicitSymbolOption = options.symbol?.trim() || undefined;
  const sharedSymbolRaw = safeSearch?.selector ?? explicitSymbolOption;
  const sharedSymIsOutline = !safeSearch && sharedSymbolRaw?.toLowerCase() === "outline";

  for (const norm of normalizedItems) {
    const preResolved = resolveEffectiveTargetAndRoot(norm.targetPath, options.projectRoot);
    const resolved = resolvePathTargets(preResolved.targetPath, {
      includeTargets: true,
      projectRoot: preResolved.projectRoot,
    });
    if (!isProjectAiceEnabled(resolved.config)) {
      throw new Error(AICE_DISABLED_MESSAGE);
    }

    const directExists = fs.existsSync(resolved.resolvedPath);
    const aiceTwinPath = `${resolved.resolvedPath}.aice`;
    const twinExists = !directExists && !resolved.isDirectory && fs.existsSync(aiceTwinPath);

    if (!directExists && !twinExists) {
      if (!isMultiInput) {
        const suggestion = resolved.isSingleFile ? didYouMeanFile(resolved.resolvedPath) : "";
        throw new Error(`Target file not found: ${norm.targetPath}${suggestion}`);
      }
      missingTargets.push(norm.targetPath);
      continue;
    }

    const diskPath = directExists ? resolved.resolvedPath : aiceTwinPath;
    const stat = fs.statSync(diskPath);
    const isDir = stat.isDirectory();
    const displayPath = formatReadDisplayPath(diskPath, resolved.projectRoot, norm.targetPath);

    const isExplicitOutline =
      Boolean(options.outline) ||
      norm.explicitOutline ||
      (!norm.selector && Boolean(sharedSymIsOutline));
    const baseSymCandidate =
      norm.selector ??
      (explicitSymbolOption && explicitSymbolOption.toLowerCase() !== "outline"
        ? explicitSymbolOption
        : undefined);
    const combinedSymbolSearchSelector =
      !isDir &&
      !options.filesWithMatches &&
      safeSearch &&
      options.search &&
      baseSymCandidate &&
      !isPureRegexSelector(baseSymCandidate) &&
      !baseSymCandidate.startsWith("/") &&
      !baseSymCandidate.includes("@") &&
      !/^L?\d+(?:\s*-\s*L?\d+)?$/i.test(baseSymCandidate)
        ? `${baseSymCandidate}@${options.search}`
        : undefined;
    const effectiveSelector = isExplicitOutline
      ? undefined
      : (combinedSymbolSearchSelector ??
        safeSearch?.selector ??
        norm.selector ??
        (sharedSymIsOutline ? undefined : sharedSymbolRaw));
    const usesSharedSymbol =
      !isExplicitOutline &&
      ((!safeSearch && !norm.selector && Boolean(effectiveSelector)) ||
        Boolean(combinedSymbolSearchSelector && !norm.selector));
    const effectiveFull = Boolean(options.full) || norm.explicitFull;

    let route: ClassifiedReadTarget["route"];
    let preReadSource: string | undefined;
    let lineCount: number | undefined;
    let needsDynamicBudget = false;

    const isUnclosedSlashSel = Boolean(
      effectiveSelector &&
        effectiveSelector.startsWith("/") &&
        effectiveSelector.length > 1 &&
        effectiveSelector.indexOf("/", 1) === -1,
    );
    if (isExplicitOutline) {
      route = "outline";
    } else if (isDir) {
      if (!effectiveSelector && options.autoOutlineDirectories !== false) {
        route = "auto-outline-dir";
      } else {
        route = isPureRegexSelector(effectiveSelector) || isUnclosedSlashSel ? "search" : "context";
      }
    } else if (effectiveSelector) {
      route = isPureRegexSelector(effectiveSelector) || isUnclosedSlashSel ? "search" : "context";
    } else {
      const isBinaryTarget = isLikelyBinaryDiskFile(diskPath);
      const isOutlinableFile =
        !isBinaryTarget &&
        (diskPath.endsWith(".aice") ||
          isSupportedReadDiskFile(diskPath, {
            allowDotfiles: true,
            allowLockfiles: true,
            allowRootAgentDocs: true,
          }));
      if (
        isOutlinableFile &&
        !effectiveFull &&
        options.outlineTarget !== true &&
        options.autoOutlineBareFiles !== false
      ) {
        preReadSource = fs.readFileSync(diskPath, "utf-8");
        lineCount = countSourceLines(preReadSource);
        const effectiveThreshold = explicitLineThreshold ?? DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD;
        if (options.maxTokens !== undefined && explicitLineThreshold === undefined) {
          route = "context";
          sharedScanCache.fileContentByPath.set(diskPath, preReadSource);
        } else if (lineCount > effectiveThreshold) {
          route = "auto-outline-file";
        } else {
          route = "context";
          needsDynamicBudget = true;
        }
      } else {
        route = "context";
      }
    }

    classified.push({
      norm,
      resolved,
      diskPath,
      displayPath,
      isDir,
      route,
      effectiveSelector,
      usesSharedSymbol,
      preReadSource,
      lineCount,
      needsDynamicBudget,
    });
  }

  if (classified.length === 0) {
    throw new Error(`Path not found: ${missingTargets.join(", ")}`);
  }

  if (options.filesWithMatches === true) {
    const rawPat = options.search ?? classified[0]?.effectiveSelector ?? options.symbol ?? "";
    const resolvedSearch = safeSearch ?? buildSafeSearchRegexSelector(rawPat);
    return executeFilesWithMatchesSearch({
      classified,
      missingTargets,
      regex: resolvedSearch.regex,
      selector: resolvedSearch.selector,
      rawPattern: rawPat,
      options,
      surface,
    });
  }

  // R1: Unified deduplicated search across 1 or N files/directories (zero omitted dirs / :outline downgrades!)
  if (
    classified.length > 0 &&
    classified.every((c) => c.route === "search") &&
    effectiveRawNative &&
    effectiveIncludeDeps !== true &&
    effectiveIncludeCallers !== true &&
    options.idioms !== true
  ) {
    const rawPatLabel = options.search ?? classified[0]?.effectiveSelector ?? options.symbol ?? "";
    if (
      rawPatLabel.startsWith("/") &&
      rawPatLabel.length > 1 &&
      rawPatLabel.indexOf("/", 1) === -1 &&
      options.search === undefined
    ) {
      const testFiles = collectSearchCandidateFiles(classified, {
        allowDotfiles: Boolean(options.full),
      });
      const rawPrefix = rawPatLabel.slice(1).trim();
      const anyHit =
        rawPrefix.length > 0 &&
        testFiles.some((f) => {
          try {
            return fs.readFileSync(f.absPath, "utf-8").includes(rawPrefix);
          } catch {
            return false;
          }
        });
      if (!anyHit) {
        throw new Error(
          `Unclosed regex selector '${rawPatLabel}'. Quote regex selectors containing '|' in shell: '${classified[0]?.displayPath || "file"}:/${rawPrefix || "pattern"}|.../'`,
        );
      }
    }
    return executeUnifiedCompactSearch({
      classified,
      missingTargets,
      defaultSelector: safeSearch?.selector,
      rawPatternLabel: rawPatLabel,
      options,
      surface,
    });
  }

  const dynamicBudgetTargets = classified.filter((c) => c.needsDynamicBudget);
  if (dynamicBudgetTargets.length > 0) {
    const nonBareCount = classified.length - dynamicBudgetTargets.length;
    const maxReserveBytes = Math.floor(effectiveBudgets.softByteCap * 0.45);
    const maxReserveTokens = Math.floor(effectiveBudgets.softTokenCap * 0.45);
    const reservedBytes = Math.min(maxReserveBytes, nonBareCount * 1_536);
    const reservedTokens = Math.min(maxReserveTokens, nonBareCount * 380);
    const budgetAllocation = computeDynamicReadBudget(
      dynamicBudgetTargets.map((c, idx) => ({
        id: String(idx),
        rawSource: c.preReadSource,
        lineCount: c.lineCount,
      })),
      {
        reservedBytes,
        reservedTokens,
        maxBytes: effectiveBudgets.maxBytes,
        maxTokens: effectiveBudgets.maxTokens,
        softByteCap: effectiveBudgets.softByteCap,
        softTokenCap: effectiveBudgets.softTokenCap,
      },
    );
    for (let i = 0; i < dynamicBudgetTargets.length; i++) {
      const item = dynamicBudgetTargets[i]!;
      if (budgetAllocation.autoOutlineIds.has(String(i))) {
        item.route = "auto-outline-file";
        item.budgetDowngraded = true;
      } else {
        item.route = "context";
        if (item.preReadSource !== undefined) {
          sharedScanCache.fileContentByPath.set(item.diskPath, item.preReadSource);
        }
      }
    }
  }

  const outlineItems = classified.filter(
    (c) =>
      c.route === "outline" || c.route === "auto-outline-dir" || c.route === "auto-outline-file",
  );
  const contextItems = classified.filter((c) => c.route === "context" || c.route === "search");
  const primaryProjectRoot = classified[0]?.resolved.projectRoot ?? baseDir;

  // 3A. Pure Outline Stream (single file, auto-outlined >120-line file, single dir, or multi-dir/multi-file)
  if (contextItems.length === 0) {
    const firstItem = outlineItems[0];
    if (outlineItems.length === 1 && firstItem && !firstItem.isDir) {
      const effectiveIdioms = isProjectIdiomsEnabled(firstItem.resolved.config, options.idioms);
      const singleOutlineOpts: OutlineOptions = {
        depth: options.depth,
        compact: options.compact,
        includeTypes: options.includeTypes !== false,
        idioms: effectiveIdioms,
        json: Boolean(options.json),
        stats: Boolean(options.stats),
        projectRoot: firstItem.resolved.projectRoot,
        ...(firstItem.preReadSource !== undefined
          ? { preReadSource: firstItem.preReadSource }
          : {}),
      };
      const outlineRes = await withSuppressedTelemetryAsync(() =>
        outlinePath(firstItem.diskPath, singleOutlineOpts),
      );
      return buildPureOutlineResult({
        outlineRes,
        classified: outlineItems,
        missingTargets,
        projectRoot: firstItem.resolved.projectRoot,
        options,
        surface,
      });
    }

    const effectiveIdioms = isProjectIdiomsEnabled(
      outlineItems[0]?.resolved.config ?? {},
      options.idioms,
    );
    const batchPaths = outlineItems.map((it) => it.diskPath);
    const outlineRes = await withSuppressedTelemetryAsync(() =>
      outlinePath(batchPaths.length === 1 && batchPaths[0] ? batchPaths[0] : batchPaths, {
        depth: options.depth,
        compact: options.compact,
        includeTypes: options.includeTypes !== false,
        idioms: effectiveIdioms,
        json: Boolean(options.json),
        stats: Boolean(options.stats),
        projectRoot: primaryProjectRoot,
      }),
    );
    return buildPureOutlineResult({
      outlineRes,
      classified: outlineItems,
      missingTargets,
      projectRoot: primaryProjectRoot,
      options,
      surface,
    });
  }

  // 3B. Pure Context / Search Stream
  if (outlineItems.length === 0) {
    return executeContextStream({
      contextItems,
      missingTargets,
      isMultiInput,
      sharedScanCache,
      options,
      surface,
    });
  }

  // 3C. Mixed Context + Outline Stream (e.g. `["src/a.ts:fnA", "src/big.ts", "src/small.ts"]`)
  const bypassInternalCap = Boolean(
    options.full || options.maxTokens !== undefined || options.json,
  );
  const enforceMixedBudget = shouldEnforceDefaultReadBudget(options, normalizedItems);

  const effectiveIdioms = isProjectIdiomsEnabled(
    outlineItems[0]?.resolved.config ?? {},
    options.idioms,
  );
  const batchPaths = outlineItems.map((it) => it.diskPath);
  const firstBatchPath = batchPaths[0] ?? primaryProjectRoot;
  const outlineRaw = await withSuppressedTelemetryAsync(() =>
    outlinePath(
      outlineItems.length === 1 && !outlineItems[0]?.isDir ? firstBatchPath : batchPaths,
      {
        depth: options.depth,
        compact: options.compact ?? enforceMixedBudget,
        includeTypes: options.includeTypes !== false,
        idioms: effectiveIdioms,
        json: Boolean(options.json),
        stats: Boolean(options.stats),
        projectRoot: primaryProjectRoot,
      },
    ),
  );

  const outlinePart = await withSuppressedTelemetryAsync(async () =>
    buildPureOutlineResult({
      outlineRes: outlineRaw,
      classified: outlineItems,
      missingTargets: [],
      projectRoot: primaryProjectRoot,
      options: {
        ...options,
        full: bypassInternalCap,
        maxTokens: undefined,
        _bypassInternalCap: true,
      },
      surface,
      skipTelemetry: true,
    }),
  );

  const rawOutlineSectionBody =
    outlineItems.length === 1 && !outlineItems[0]?.isDir && outlineItems[0]
      ? outlinePart.formattedBundle.startsWith("// ")
        ? outlinePart.formattedBundle
        : `// ${outlineItems[0].displayPath}\n${outlinePart.formattedBundle}`
      : outlinePart.formattedBundle;

  let compactOutlineSectionBody = rawOutlineSectionBody;
  if (enforceMixedBudget) {
    const maxOutlineShareBytes = Math.min(
      Math.floor(effectiveBudgets.softByteCap * 0.42),
      Math.max(850, outlineItems.length * 1_100),
    );
    if (Buffer.byteLength(rawOutlineSectionBody, "utf-8") > maxOutlineShareBytes) {
      const subBlocks =
        outlineItems.length === 1 && !outlineItems[0]?.isDir
          ? [rawOutlineSectionBody]
          : rawOutlineSectionBody.split(/\n\n(?=\/\/ (?:Auto-outlined |=== ))/);
      const perBlockCap = Math.max(
        260,
        Math.floor(
          (maxOutlineShareBytes - Math.max(0, subBlocks.length - 1) * 2) /
            Math.max(1, subBlocks.length),
        ),
      );
      compactOutlineSectionBody = subBlocks
        .map((blk, idx) => {
          const nlIdx = blk.indexOf("\n");
          if (nlIdx <= 0) return blk;
          const hdr = blk.slice(0, nlIdx);
          const body = blk.slice(nlIdx + 1);
          const disp = outlineItems[idx]?.displayPath ?? outlineItems[0]?.displayPath ?? ".";
          return compactAutoOutlineBlock(hdr, body, perBlockCap, disp);
        })
        .join("\n\n");
    }
  }

  const reservedForOutlineBytes = enforceMixedBudget
    ? Buffer.byteLength(compactOutlineSectionBody, "utf-8") + 96
    : 0;
  const ctxBudgetMaxBytes = enforceMixedBudget
    ? Math.max(1_024, effectiveBudgets.maxBytes - reservedForOutlineBytes)
    : options.maxBytes;

  const ctxPart = await withSuppressedTelemetryAsync(() =>
    executeContextStream({
      contextItems,
      missingTargets: [],
      isMultiInput: true,
      sharedScanCache,
      options: {
        ...options,
        full: bypassInternalCap,
        maxTokens: undefined,
        maxBytes: ctxBudgetMaxBytes,
        json: false,
        stats: false,
        _bypassInternalCap: !enforceMixedBudget,
      },
      surface,
    }),
  );

  const ctxActualBytes = Buffer.byteLength(ctxPart.formattedBundle, "utf-8");
  const fullOutlineBytes = Buffer.byteLength(rawOutlineSectionBody, "utf-8");
  const outlineSectionBody =
    !enforceMixedBudget || ctxActualBytes + 2 + fullOutlineBytes <= effectiveBudgets.maxBytes - 96
      ? rawOutlineSectionBody
      : compactOutlineSectionBody;

  let combinedBundle = `${ctxPart.formattedBundle}\n\n${outlineSectionBody}`;
  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    combinedBundle = `${combinedBundle}\n${missingFooter}`;
  }

  const truncated = truncateBundleToMaxTokens(combinedBundle, options.maxTokens);
  let formattedBundle = truncated.text;
  let tokenCount = truncated.tokenCount;

  const jsonData = {
    mode: "mixed" as const,
    context: ctxPart.jsonData,
    outline: outlinePart.jsonData,
    ...(missingTargets.length > 0 ? { missingTargets } : {}),
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;

  const statsText = options.stats
    ? formatContextStatsFooter(
        tokenCount,
        ctxPart.dependencies.length,
        ctxPart.callers.length,
        formattedBundle.length,
      )
    : undefined;
  let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

  if (shouldEnforceDefaultReadBudget(options, normalizedItems)) {
    const cappedMixed = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: classified[0]?.effectiveSelector
        ? `${classified[0].displayPath}:${classified[0].effectiveSelector}`
        : (classified[0]?.displayPath ?? "."),
      statsText,
      projectRoot: primaryProjectRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = cappedMixed.formattedBundle;
    output = cappedMixed.output;
    tokenCount = cappedMixed.tokenCount;
  }

  const combinedNativeCl100k =
    (ctxPart.stats.originalTokens ?? 0) + (outlinePart.stats.originalTokens ?? 0);
  const combinedNativeChars =
    (ctxPart.stats.originalChars ?? 0) + (outlinePart.stats.originalChars ?? 0);

  const firstClassified = classified[0];
  if (firstClassified) {
    const multiFiles = Array.from(
      new Set(
        classified
          .filter((c) => !c.isDir)
          .map((c) => {
            const rel = path.relative(primaryProjectRoot, c.diskPath).replace(/\\/g, "/");
            return rel && !rel.startsWith("..") ? rel : c.displayPath;
          })
          .filter(Boolean),
      ),
    );
    recordTelemetryEvent({
      targetPath: firstClassified.diskPath,
      projectRoot: primaryProjectRoot,
      filePath: "<multi-context>",
      multiFiles: multiFiles.length > 0 ? multiFiles : undefined,
      operation: "context",
      surface,
      idiomsUsed: Boolean(
        (ctxPart.idioms && Object.keys(ctxPart.idioms).length > 0) ||
          outlinePart.idioms !== undefined,
      ),
      nativeText: "",
      nativeChars: combinedNativeChars,
      nativeCl100k: combinedNativeCl100k,
      realisticNativeCl100k: combinedNativeCl100k,
      aiceText: jsonOutput ?? formattedBundle,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  const targetSummaries: ReadTargetSummary[] = classified.map((c) => ({
    targetPath: c.displayPath,
    resolvedPath: c.diskPath,
    mode: c.route,
    ...(c.effectiveSelector ? { selector: c.effectiveSelector } : {}),
    ...(c.route === "auto-outline-file" ? { autoOutlined: true, lineCount: c.lineCount } : {}),
  }));

  const stats: ReadStats = {
    tokenCount,
    originalTokens: combinedNativeCl100k,
    savedTokens: combinedNativeCl100k - tokenCount,
    originalChars: combinedNativeChars,
    outputChars: formattedBundle.length,
    dependenciesCount: ctxPart.dependencies.length,
    callersCount: ctxPart.callers.length,
    fileCount: ctxPart.stats.fileCount + outlinePart.stats.fileCount,
  };

  return {
    mode: "mixed",
    targetPath: classified.map((c) => c.displayPath).join(", "),
    text: formattedBundle,
    formattedBundle,
    targetContent: `${ctxPart.targetContent}\n\n${outlineSectionBody}`,
    output,
    tokenCount,
    targets: targetSummaries,
    missingTargets,
    dependencies: ctxPart.dependencies,
    callers: ctxPart.callers,
    idioms: ctxPart.idioms,
    nativeDiagnostics: ctxPart.nativeDiagnostics,
    contextResult: ctxPart.contextResult,
    contextResults: ctxPart.contextResults,
    outlineResult: outlineRaw,
    jsonData,
    jsonOutput,
    stats,
    statsText,
  };
}

function buildPureOutlineResult(params: {
  outlineRes: OutlineResult | Map<string, OutlineResult>;
  classified: ClassifiedReadTarget[];
  missingTargets: string[];
  projectRoot: string;
  options: ReadOptions;
  surface: "cli" | "mcp";
  skipTelemetry?: boolean;
}): ReadResult {
  const { outlineRes, classified, missingTargets, projectRoot, options, surface, skipTelemetry } =
    params;
  const effectiveBudgets = resolveEffectiveReadBudgets(options);

  const autoOutlineByAbsPath = new Map<
    string,
    {
      lineCount: number;
      displayPath: string;
      diskPath: string;
      preReadSource?: string;
      budgetDowngraded?: boolean;
    }
  >();
  for (const c of classified) {
    if (c.route === "auto-outline-file" && c.lineCount !== undefined) {
      autoOutlineByAbsPath.set(path.resolve(c.diskPath), {
        lineCount: c.lineCount,
        displayPath: c.displayPath,
        diskPath: c.diskPath,
        preReadSource: c.preReadSource,
        budgetDowngraded: c.budgetDowngraded,
      });
    }
  }

  const uniqueRoutes = new Set(classified.map((c) => c.route));
  const firstRoute = classified[0]?.route ?? "outline";
  const overallMode: ReadRouteMode = uniqueRoutes.size === 1 ? firstRoute : "outline";

  let rawBundle = "";
  let jsonData: unknown;
  let statsText: string | undefined;
  let totalOrigTokens = 0;
  let totalOutlineTokens = 0;
  let totalOrigChars = 0;
  let hasStats = false;
  let fileCount = 0;
  let anyIdiomsUsed = false;
  const nativeParts: string[] = [];
  const outlineDisplayKeys: string[] = [];

  if (outlineRes instanceof Map) {
    fileCount = outlineRes.size;
    const textBlocks: string[] = [];
    const jsonItems: unknown[] = [];

    for (const [rawKey, itemRes] of outlineRes.entries()) {
      const autoMeta = autoOutlineByAbsPath.get(path.resolve(itemRes.file));
      const effectiveOutlineRoot = options.projectRoot
        ? path.resolve(options.projectRoot)
        : projectRoot;
      const displayKey =
        autoMeta?.displayPath ??
        formatReadDisplayPath(
          itemRes.file,
          effectiveOutlineRoot,
          options.projectRoot ? rawKey : undefined,
        );
      const symbolNames = autoMeta
        ? extractRepresentativeSymbolHints({
            symbols: itemRes.symbols,
            diskPath: autoMeta.diskPath,
            rawSource: autoMeta.preReadSource,
            displayPath: displayKey,
            projectRoot,
          })
        : undefined;
      const headerLine = autoMeta
        ? `${buildAutoOutlineHeader(displayKey, autoMeta.lineCount, {
            symbolNames,
            budgetDowngraded: autoMeta.budgetDowngraded,
            budgetLabel: effectiveBudgets.budgetLabel,
          })}\n`
        : "";
      outlineDisplayKeys.push(displayKey);
      textBlocks.push(
        headerLine ? `${headerLine}${itemRes.text}` : `// ${displayKey}\n${itemRes.text}`,
      );

      jsonItems.push({
        ...(itemRes.json ?? {
          file: itemRes.file,
          symbols: itemRes.symbols,
          ...(itemRes.referencedIdioms && itemRes.referencedIdioms.length > 0
            ? { referencedIdioms: itemRes.referencedIdioms }
            : {}),
          ...(itemRes.stats ? { stats: itemRes.stats } : {}),
        }),
        ...(autoMeta ? { autoOutlined: true, lineCount: autoMeta.lineCount } : {}),
      });

      if ((itemRes.referencedIdioms?.length ?? 0) > 0) {
        anyIdiomsUsed = true;
      }
      if (itemRes.stats) {
        hasStats = true;
        totalOrigTokens += itemRes.stats.originalTokens;
        totalOutlineTokens += itemRes.stats.outlineTokens;
        totalOrigChars += itemRes.stats.originalChars;
      }
      if (!skipTelemetry && nativeParts.length < 60) {
        try {
          if (fs.existsSync(itemRes.file) && fs.statSync(itemRes.file).isFile()) {
            nativeParts.push(fs.readFileSync(itemRes.file, "utf-8"));
          }
        } catch {
          // ignore unreadable file
        }
      }
    }

    const enforceOutlineBudget = shouldEnforceDefaultReadBudget(options);
    if (textBlocks.length === 0) {
      const emptyLabel = classified.map((c) => c.displayPath).join(", ") || ".";
      rawBundle = `// ${emptyLabel}\n// (no supported target files)`;
    } else if (enforceOutlineBudget) {
      const keptOutlineBlocks: string[] = [];
      const omittedDisplayPaths: string[] = [];
      let runningBytes = 0;
      const budgetThresholdBytes = effectiveBudgets.maxBytes - 220;
      for (let i = 0; i < textBlocks.length; i++) {
        const blk = textBlocks[i]!;
        const blkBytes = Buffer.byteLength(blk, "utf-8") + (keptOutlineBlocks.length > 0 ? 2 : 0);
        if (keptOutlineBlocks.length > 0 && runningBytes + blkBytes > budgetThresholdBytes) {
          omittedDisplayPaths.push(...outlineDisplayKeys.slice(i));
          break;
        }
        keptOutlineBlocks.push(blk);
        runningBytes += blkBytes;
      }
      if (omittedDisplayPaths.length > 0) {
        const batchPreview = omittedDisplayPaths.slice(0, 3).join(" ");
        keptOutlineBlocks.push(
          `// +${omittedDisplayPaths.length} more files omitted — batch: aice outline ${batchPreview} or aice search <pat>`,
        );
      }
      rawBundle = keptOutlineBlocks.join("\n\n");
    } else {
      rawBundle = textBlocks.join("\n\n");
    }
    jsonData = jsonItems;
    if (options.stats) {
      statsText = formatAggregateOutlineStatsFooter(fileCount, totalOrigTokens, totalOutlineTokens);
    }
  } else {
    fileCount = 1;
    const singleTarget = classified[0];
    const displayPath =
      singleTarget?.displayPath ?? formatReadDisplayPath(outlineRes.file, projectRoot);
    const autoMeta =
      singleTarget?.route === "auto-outline-file" && singleTarget.lineCount !== undefined
        ? {
            lineCount: singleTarget.lineCount,
            displayPath,
            diskPath: singleTarget.diskPath,
            preReadSource: singleTarget.preReadSource,
            budgetDowngraded: singleTarget.budgetDowngraded,
          }
        : undefined;

    if (autoMeta) {
      const symbolNames = extractRepresentativeSymbolHints({
        symbols: outlineRes.symbols,
        diskPath: autoMeta.diskPath,
        rawSource: autoMeta.preReadSource,
        displayPath: autoMeta.displayPath,
        projectRoot,
      });
      const autoHeader = buildAutoOutlineHeader(autoMeta.displayPath, autoMeta.lineCount, {
        symbolNames,
        budgetDowngraded: autoMeta.budgetDowngraded,
        budgetLabel: effectiveBudgets.budgetLabel,
      });
      let compactOutlineBody = outlineRes.text;
      if (autoMeta.preReadSource && compactOutlineBody) {
        const rawTokEst = estimateTokens(autoMeta.preReadSource, "cl100k_base");
        const outLines = compactOutlineBody.split("\n");
        if (
          rawTokEst > 0 &&
          estimateTokens(`${autoHeader}\n${compactOutlineBody}`, "cl100k_base") > rawTokEst * 0.48
        ) {
          let maxKeep = Math.max(6, Math.min(35, Math.floor(outLines.length * 0.35)));
          if (outLines.length > maxKeep) {
            compactOutlineBody = `${outLines.slice(0, maxKeep).join("\n")}\n// ... (+${outLines.length - maxKeep} more symbols — use aice search <pat> ${autoMeta.displayPath})`;
          }
          while (
            maxKeep > 3 &&
            estimateTokens(`${autoHeader}\n${compactOutlineBody}`, "cl100k_base") > rawTokEst * 0.78
          ) {
            maxKeep = Math.max(3, Math.floor(maxKeep * 0.6));
            compactOutlineBody = `${outLines.slice(0, maxKeep).join("\n")}\n// ... (+${Math.max(1, outLines.length - maxKeep)} more symbols — use aice search <pat> ${autoMeta.displayPath})`;
          }
        }
      }
      rawBundle = compactOutlineBody ? `${autoHeader}\n${compactOutlineBody}` : autoHeader;
    } else {
      rawBundle = outlineRes.text;
    }

    jsonData = {
      ...(outlineRes.json ?? {
        file: outlineRes.file,
        symbols: outlineRes.symbols,
        ...(outlineRes.referencedIdioms && outlineRes.referencedIdioms.length > 0
          ? { referencedIdioms: outlineRes.referencedIdioms }
          : {}),
        ...(outlineRes.stats ? { stats: outlineRes.stats } : {}),
      }),
      ...(autoMeta ? { autoOutlined: true, lineCount: autoMeta.lineCount } : {}),
    };

    if ((outlineRes.referencedIdioms?.length ?? 0) > 0) {
      anyIdiomsUsed = true;
    }
    if (outlineRes.stats) {
      hasStats = true;
      totalOrigTokens = outlineRes.stats.originalTokens;
      totalOutlineTokens = outlineRes.stats.outlineTokens;
      totalOrigChars = outlineRes.stats.originalChars;
      if (options.stats) {
        statsText = formatSingleOutlineStatsFooter(outlineRes.file, outlineRes.stats);
      }
    }
    if (!skipTelemetry) {
      if (singleTarget?.preReadSource !== undefined) {
        nativeParts.push(singleTarget.preReadSource);
      } else {
        try {
          if (fs.existsSync(outlineRes.file) && fs.statSync(outlineRes.file).isFile()) {
            nativeParts.push(fs.readFileSync(outlineRes.file, "utf-8"));
          }
        } catch {
          // ignore
        }
      }
    }
  }

  if (missingTargets.length > 0) {
    const missingLines = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    rawBundle = rawBundle ? `${rawBundle}\n${missingLines}` : missingLines;
  }

  const truncated = truncateBundleToMaxTokens(rawBundle, options.maxTokens);
  let formattedBundle = truncated.text;
  let tokenCount = truncated.tokenCount;
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

  if (shouldEnforceDefaultReadBudget(options)) {
    const firstFallback = classified[0]?.effectiveSelector
      ? `${classified[0].displayPath}:${classified[0].effectiveSelector}`
      : (classified[0]?.displayPath ?? ".");
    const cappedOutline = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: firstFallback,
      statsText,
      totalLines: classified.length === 1 ? classified[0]?.lineCount : undefined,
      diskPath: classified.length === 1 ? classified[0]?.diskPath : undefined,
      rawSource: classified.length === 1 ? classified[0]?.preReadSource : undefined,
      projectRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = cappedOutline.formattedBundle;
    output = cappedOutline.output;
    tokenCount = cappedOutline.tokenCount;
  }

  if (!skipTelemetry && classified[0]) {
    const isDirOrMultiOutline = outlineRes instanceof Map || Boolean(classified[0]?.isDir);
    const aicePayload = jsonOutput ?? formattedBundle;
    const aiceCl100k =
      jsonOutput !== undefined ? estimateTokens(jsonOutput, "cl100k_base") : tokenCount;

    let honestRealisticText: string;
    let rawOutlineCl100k: number;
    let rawOutlineChars: number;
    let rawOutlinePayload = "";
    if (isDirOrMultiOutline) {
      const dirEntries: HonestBaselineFileEntry[] = [];
      let rawSumChars = 0;
      let rawSumTok = 0;
      if (outlineRes instanceof Map) {
        let count = 0;
        for (const [k, v] of outlineRes.entries()) {
          try {
            if (fs.existsSync(v.file) && fs.statSync(v.file).isFile()) {
              const rawContent = fs.readFileSync(v.file, "utf-8");
              rawSumChars += rawContent.length;
              rawSumTok += estimateTokens(rawContent, "cl100k_base");
              if (count < 20) {
                dirEntries.push({ relPath: k, rawSource: rawContent });
                count++;
              }
            }
          } catch {}
        }
      }
      honestRealisticText = computeHonestReadBaselineText({
        relPath: classified[0].displayPath || ".",
        workspaceFiles: dirEntries,
        mode: "outline-dir",
        includeToolWrapper: false,
      });
      const realTok = estimateTokens(honestRealisticText, "cl100k_base");
      rawOutlineCl100k = Math.max(realTok, totalOrigTokens || rawSumTok);
      rawOutlineChars = Math.max(honestRealisticText.length, totalOrigChars || rawSumChars);
    } else {
      const singleRaw = nativeParts[0] ?? "";
      rawOutlinePayload = singleRaw;
      honestRealisticText = singleRaw;
      rawOutlineCl100k = estimateTokens(singleRaw, "cl100k_base");
      rawOutlineChars = singleRaw.length;
    }

    const realOutlineCl100k = Math.min(
      rawOutlineCl100k,
      estimateTokens(honestRealisticText, "cl100k_base"),
    );
    const structuralCompressionPct =
      rawOutlineCl100k > 0
        ? Math.round(((rawOutlineCl100k - aiceCl100k) / rawOutlineCl100k) * 100)
        : 0;

    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot,
      operation: "outline",
      surface,
      idiomsUsed: anyIdiomsUsed,
      nativeText: rawOutlinePayload,
      nativeChars: rawOutlineChars,
      nativeCl100k: rawOutlineCl100k,
      nativeO200k: rawOutlineCl100k,
      aiceCl100k,
      realisticNativeText: honestRealisticText,
      realisticNativeCl100k: realOutlineCl100k,
      ...(outlineDisplayKeys.length > 1 ? { multiFiles: outlineDisplayKeys } : {}),
      structuralCompressionPct,
      aiceText: aicePayload,
    });
  }
  const savedTokens = hasStats ? totalOrigTokens - tokenCount : undefined;
  const savingsPct =
    hasStats && totalOrigTokens > 0
      ? Math.round(((totalOrigTokens - tokenCount) / totalOrigTokens) * 100)
      : undefined;
  const charSavingsPct =
    hasStats && totalOrigChars > 0
      ? Math.round(((totalOrigChars - formattedBundle.length) / totalOrigChars) * 100)
      : undefined;

  const stats: ReadStats = {
    tokenCount,
    ...(hasStats
      ? {
          originalTokens: totalOrigTokens,
          savedTokens,
          savingsPct,
          originalChars: totalOrigChars,
          charSavingsPct,
        }
      : {}),
    outputChars: formattedBundle.length,
    dependenciesCount: 0,
    callersCount: 0,
    fileCount,
  };

  const targetSummaries: ReadTargetSummary[] = classified.map((c) => ({
    targetPath: c.displayPath,
    resolvedPath: c.diskPath,
    mode: c.route,
    ...(c.route === "auto-outline-file" ? { autoOutlined: true, lineCount: c.lineCount } : {}),
  }));

  return {
    mode: overallMode,
    targetPath: classified.map((c) => c.displayPath).join(", "),
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: targetSummaries,
    missingTargets,
    dependencies: [],
    callers: [],
    outlineResult: outlineRes,
    jsonData,
    jsonOutput,
    stats,
    statsText,
  };
}

async function executeContextStream(params: {
  contextItems: ClassifiedReadTarget[];
  missingTargets: string[];
  isMultiInput: boolean;
  sharedScanCache: WorkspaceCallerScanCache;
  options: ReadOptions;
  surface: "cli" | "mcp";
}): Promise<ReadResult> {
  const { contextItems, missingTargets, isMultiInput, sharedScanCache, options, surface } = params;
  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const isCliOrMcpSurface = options.surface === "cli" || options.surface === "mcp";
  const effectiveIncludeDeps = isCliOrMcpSurface
    ? (options.includeDeps ?? (options.depth !== undefined && options.depth > 0 ? true : false))
    : options.includeDeps;
  const effectiveIncludeCallers = isCliOrMcpSurface
    ? (options.includeCallers ?? false)
    : options.includeCallers;

  const results: ContextResult[] = [];
  const matchedTargets: ClassifiedReadTarget[] = [];
  const sharedSymbolResultIndices: number[] = [];
  const multiTargetErrors: unknown[] = [];

  let firstResolvedPath = "";
  let firstProjectRoot = process.cwd();
  let totalFullNativeChars = 0;
  let totalFullNativeCl100k = 0;
  let totalFullNativeO200k = 0;
  let totalRealisticNativeCl100k = 0;
  let resolvedNativeTargetCount = 0;

  const effectiveRawNative = resolveEffectiveReadRawNative(options);
  const enforceContextBudget = shouldEnforceDefaultReadBudget(
    options,
    contextItems.map((c) => c.norm),
  );

  for (const item of contextItems) {
    const hasMultiCommaSelectors = Boolean(
      item.effectiveSelector &&
        item.effectiveSelector.includes(",") &&
        splitCommaSelectors(item.effectiveSelector).length > 1,
    );
    const contextOpts: ContextOptions = {
      depth: options.depth,
      symbol: item.effectiveSelector,
      allowPartialSymbolMatch:
        options.allowPartialSymbolMatch ??
        (isMultiInput || hasMultiCommaSelectors ? true : undefined),
      idioms: options.idioms,
      includeDeps: effectiveIncludeDeps,
      includeCallers: effectiveIncludeCallers,
      zeroEnvelopeBareSmallFiles: true,
      outlineTarget: Boolean(options.outlineTarget),
      maxTokens: isMultiInput ? undefined : options.maxTokens,
      maxByteBudget: !isMultiInput && enforceContextBudget ? effectiveBudgets.maxBytes : undefined,
      rawNative: effectiveRawNative,
      dsl: options.dsl,
      contextLines: options.contextLines,
      json: Boolean(options.json),
      stats: Boolean(options.stats),
      projectRoot: item.resolved.projectRoot,
      workspaceScanCache: sharedScanCache,
      surface: options.surface,
      full: options.full,
      unboundedCli: options.unboundedCli,
      _isMultiTarget: isMultiInput,
    };
    let targetMatched = false;
    try {
      const rawRes = await withSuppressedTelemetryAsync(() =>
        generateContext(item.resolved.resolvedPath, contextOpts),
      );
      results.push(normalizeContextResultDisplayPath(rawRes, item.displayPath));
      matchedTargets.push(item);
      targetMatched = true;
    } catch (targetErr) {
      if (!isMultiInput) {
        throw targetErr;
      }
      // When multiple targets share `-s "SymA,SymB"`, attempt matching individual comma selectors
      const commaSelectors =
        item.usesSharedSymbol && item.effectiveSelector?.includes(",")
          ? splitCommaSelectors(item.effectiveSelector)
          : [];
      let matchedSubset = false;
      if (commaSelectors.length > 1) {
        const subsetResults: ContextResult[] = [];
        for (const subSel of commaSelectors) {
          try {
            const subOpts: ContextOptions = {
              ...contextOpts,
              symbol: subSel,
              allowPartialSymbolMatch: false,
            };
            const subRes = await withSuppressedTelemetryAsync(() =>
              generateContext(item.resolved.resolvedPath, subOpts),
            );
            subsetResults.push(normalizeContextResultDisplayPath(subRes, item.displayPath));
          } catch {
            // selector lives in another target file
          }
        }
        const firstSubset = subsetResults[0];
        if (firstSubset !== undefined) {
          results.push(
            subsetResults.length === 1
              ? firstSubset
              : mergeMultiContextResults(subsetResults, {
                  outlineTarget: Boolean(options.outlineTarget),
                }),
          );
          matchedTargets.push(item);
          matchedSubset = true;
          targetMatched = true;
        }
      }
      if (!matchedSubset) {
        multiTargetErrors.push(targetErr);
        const label = item.effectiveSelector
          ? `${item.displayPath}:${item.effectiveSelector}`
          : item.displayPath;
        const dymMatch =
          targetErr instanceof Error ? /Did you mean:\s*([^\n]+)/.exec(targetErr.message) : null;
        missingTargets.push(
          dymMatch?.[1] ? `${label} (Did you mean: ${dymMatch[1].trim()})` : label,
        );
      }
    }

    if (targetMatched) {
      if (item.usesSharedSymbol) {
        sharedSymbolResultIndices.push(results.length - 1);
      }
      if (!firstResolvedPath) {
        firstResolvedPath = item.diskPath;
        firstProjectRoot = item.resolved.projectRoot;
      }
      try {
        if (!item.isDir && fs.existsSync(item.diskPath)) {
          const rawText =
            item.preReadSource ??
            sharedScanCache.fileContentByPath.get(item.diskPath) ??
            fs.readFileSync(item.diskPath, "utf-8");
          const realisticSlice = computeHonestReadBaselineText({
            rawSource: rawText,
            relPath: item.displayPath,
            symbolSelector: item.effectiveSelector,
            mode: item.route === "search" ? "search" : item.effectiveSelector ? "slice" : "file",
            includeToolWrapper: false,
          });
          const fullTok = estimateTokens(rawText, "cl100k_base");
          const fullO200k = estimateTokens(rawText, "o200k_base");
          const realTok = Math.min(fullTok, estimateTokens(realisticSlice, "cl100k_base"));
          totalFullNativeChars +=
            rawText.length + (resolvedNativeTargetCount > 0 && rawText.length > 0 ? 2 : 0);
          totalFullNativeCl100k += fullTok;
          totalFullNativeO200k += fullO200k;
          totalRealisticNativeCl100k += realTok;
          resolvedNativeTargetCount++;
        } else if (item.isDir && fs.existsSync(item.diskPath)) {
          const dirFiles =
            sharedScanCache.filesByRoot.get(item.diskPath) ?? item.resolved.files.slice(0, 20);
          const dirEntries: HonestBaselineFileEntry[] = [];
          let dirRawChars = 0;
          let dirRawCl100k = 0;
          let dirRawO200k = 0;
          for (const df of dirFiles) {
            if (!fs.existsSync(df)) continue;
            const rawText =
              sharedScanCache.fileContentByPath.get(df) ?? fs.readFileSync(df, "utf-8");
            dirRawChars += rawText.length;
            dirRawCl100k += estimateTokens(rawText, "cl100k_base");
            dirRawO200k += estimateTokens(rawText, "o200k_base");
            dirEntries.push({
              relPath: formatReadDisplayPath(df, item.resolved.projectRoot),
              rawSource: rawText,
            });
          }
          const dirBaseline = computeHonestReadBaselineText({
            relPath: item.displayPath || ".",
            workspaceFiles: dirEntries,
            symbolSelector: item.effectiveSelector,
            mode: item.route === "search" ? "search" : "workspace",
            includeToolWrapper: false,
          });
          const dirRealTok = estimateTokens(dirBaseline, "cl100k_base");
          const dirFullCl100k = Math.max(dirRealTok, dirRawCl100k);
          const dirFullO200k = Math.max(estimateTokens(dirBaseline, "o200k_base"), dirRawO200k);
          totalFullNativeChars += Math.max(dirBaseline.length, dirRawChars);
          totalFullNativeCl100k += dirFullCl100k;
          totalFullNativeO200k += dirFullO200k;
          totalRealisticNativeCl100k += Math.min(dirFullCl100k, dirRealTok);
          resolvedNativeTargetCount++;
        }
      } catch {
        // ignore unreadable target
      }
    }
  }

  if (results.length === 0) {
    if (multiTargetErrors.length > 0) {
      throw multiTargetErrors[0];
    }
    if (missingTargets.length > 0) {
      throw new Error(`Path not found: ${missingTargets.join(", ")}`);
    }
  }

  // Reconcile shared multi-symbol `-s "SymA,SymB"` across multiple files
  if (isMultiInput && options.symbol && sharedSymbolResultIndices.length > 0) {
    const sharedRequested = splitCommaSelectors(options.symbol);
    if (sharedRequested.length > 1) {
      const missingCountBySym = new Map<string, number>();
      for (const idx of sharedSymbolResultIndices) {
        const res = results[idx];
        if (!res) continue;
        const m = res.targetContent.match(/^\/\/ missing:\s*(.+)$/m);
        if (m?.[1]) {
          for (const part of m[1].split(",").map((s) => s.trim())) {
            if (part) {
              missingCountBySym.set(part, (missingCountBySym.get(part) ?? 0) + 1);
            }
          }
        }
      }
      const globallyMissing = new Set<string>();
      for (const [sym, count] of missingCountBySym) {
        if (count >= sharedSymbolResultIndices.length) {
          globallyMissing.add(sym);
        }
      }
      let emittedGlobalMissing = false;
      const lastSharedIdx = sharedSymbolResultIndices[sharedSymbolResultIndices.length - 1];
      for (const idx of sharedSymbolResultIndices) {
        const res = results[idx];
        if (!res) continue;
        const matchMissing = res.targetContent.match(/^\/\/ missing:\s*(.+)$/m);
        if (!matchMissing) continue;
        const isLastShared = idx === lastSharedIdx;
        let replacement = "";
        if (isLastShared && !emittedGlobalMissing && matchMissing[1]) {
          const kept = matchMissing[1]
            .split(",")
            .map((s) => s.trim())
            .filter((s) => globallyMissing.has(s));
          if (kept.length > 0) {
            emittedGlobalMissing = true;
            replacement = `\n\n// missing: ${kept.join(", ")}`;
          }
        }
        res.targetContent = res.targetContent.replace(/\n*\/\/ missing:\s*(.+)$/m, replacement);
        res.formattedBundle = res.formattedBundle.replace(/\n*\/\/ missing:\s*(.+)$/m, replacement);
        res.tokenCount = estimateTokens(res.formattedBundle);
      }
    }
  }

  const uniqueRoutes = new Set(matchedTargets.map((t) => t.route));
  const firstRoute = matchedTargets[0]?.route ?? "context";
  const overallMode: ReadRouteMode = uniqueRoutes.size === 1 ? firstRoute : "context";

  const targetSummaries: ReadTargetSummary[] = matchedTargets.map((t) => ({
    targetPath: t.displayPath,
    resolvedPath: t.diskPath,
    mode: t.route,
    ...(t.effectiveSelector ? { selector: t.effectiveSelector } : {}),
  }));

  const enforceStreamBudget = shouldEnforceDefaultReadBudget(options);

  if (results.length > 1) {
    let merged = mergeMultiContextResults(results, {
      outlineTarget: Boolean(options.outlineTarget),
      maxTokens: options.maxTokens,
      includeDeps: effectiveIncludeDeps,
      includeCallers: effectiveIncludeCallers,
      depth: options.depth,
      rawNative: effectiveRawNative,
      surface: options.surface,
    });
    let formattedBundle = merged.formattedBundle;
    const paginationHints: string[] = [];

    // Priority 1-turn batch packer:
    // 1. Pack explicit selectors (`:sym`, `:L`, `:/regex/`) that fit within budget FIRST
    // 2. Pack small bare files that fit within remaining budget (smallest-first)
    // 3. Auto-outline oversized bare files cleanly (never partial-filling bare files across turns)
    if (
      enforceStreamBudget &&
      (Buffer.byteLength(formattedBundle, "utf-8") > effectiveBudgets.maxBytes ||
        (merged.tokenCount ?? estimateTokens(formattedBundle)) > effectiveBudgets.maxTokens)
    ) {
      const statsAllowanceBytes = options.stats ? 180 : 0;
      const maxBundleBytes = Math.max(400, effectiveBudgets.maxBytes - statsAllowanceBytes);
      const softByteCap = Math.min(
        effectiveBudgets.softByteCap,
        Math.max(400, maxBundleBytes - 260),
      );
      const softTokenCap = effectiveBudgets.softTokenCap;

      const itemMeta = results.map((resItem, idx) => {
        const blockStr = resItem.formattedBundle.startsWith("// ")
          ? resItem.formattedBundle
          : `// ${resItem.targetPath}\n${resItem.formattedBundle}`;
        return {
          idx,
          itemBytes: Buffer.byteLength(blockStr, "utf-8"),
          itemToks: resItem.tokenCount ?? estimateTokens(blockStr),
          hasExplicitSelector: Boolean(matchedTargets[idx]?.effectiveSelector),
        };
      });

      const explicitIndices = itemMeta.filter((m) => m.hasExplicitSelector).map((m) => m.idx);
      const bareIndices = itemMeta.filter((m) => !m.hasExplicitSelector).map((m) => m.idx);

      const fitInlineIndices = new Set<number>();
      let usedBytes = 0;
      let usedTokens = 0;

      // Pass 1: Explicit selectors (`:sym`, `:L`, `:/regex/`) — do not `break` when one oversized range overflows
      for (let ePos = 0; ePos < explicitIndices.length; ePos++) {
        const idx = explicitIndices[ePos]!;
        const meta = itemMeta[idx]!;
        const sep = fitInlineIndices.size > 0 ? 2 : 0;
        const laterExplicitCount = explicitIndices.length - ePos - 1;
        const minCushionBytes = Math.min(
          Math.floor(softByteCap * 0.32),
          bareIndices.length * 320 + laterExplicitCount * 110,
        );
        if (
          usedBytes + sep + meta.itemBytes <= softByteCap - minCushionBytes &&
          usedTokens + meta.itemToks <= softTokenCap
        ) {
          fitInlineIndices.add(idx);
          usedBytes += sep + meta.itemBytes;
          usedTokens += meta.itemToks;
        }
      }

      // Pass 2: Small bare files that fit within remaining budget (smallest-first water-filling)
      const sortedBareIndices = [...bareIndices].sort(
        (a, b) => itemMeta[a]!.itemBytes - itemMeta[b]!.itemBytes || a - b,
      );
      let remainingBareCandidates = sortedBareIndices.length;
      for (const idx of sortedBareIndices) {
        remainingBareCandidates--;
        const meta = itemMeta[idx]!;
        const sep = fitInlineIndices.size > 0 ? 2 : 0;
        const minCushionBytes = Math.min(
          Math.floor(softByteCap * 0.35),
          remainingBareCandidates * 340,
        );
        if (
          usedBytes + sep + meta.itemBytes <= softByteCap - minCushionBytes &&
          usedTokens + meta.itemToks <= softTokenCap
        ) {
          fitInlineIndices.add(idx);
          usedBytes += sep + meta.itemBytes;
          usedTokens += meta.itemToks;
        }
      }

      // Pass 3: Render all targets in original request order (inline where packed, compact auto-outline for oversized bare files)
      let unpackedRemaining = results.length - fitInlineIndices.size;
      let partialExplicitHandled = false;
      const packedContextResults: ContextResult[] = [];

      for (let i = 0; i < results.length; i++) {
        const resItem = results[i]!;
        const targetMeta = matchedTargets[i]!;

        if (fitInlineIndices.has(i)) {
          packedContextResults.push(resItem);
          continue;
        }

        unpackedRemaining = Math.max(0, unpackedRemaining - 1);
        const hasExplicitSel = Boolean(targetMeta.effectiveSelector);
        const isExplicitLineRange = Boolean(
          targetMeta.effectiveSelector && LINE_RANGE_SELECTOR_RE.test(targetMeta.effectiveSelector),
        );
        const parsedOverflowRange = parseSelectorLineRange(targetMeta.effectiveSelector);
        const cachedRaw =
          targetMeta.preReadSource ??
          sharedScanCache.fileContentByPath.get(targetMeta.diskPath) ??
          (!targetMeta.isDir && fs.existsSync(targetMeta.diskPath)
            ? fs.readFileSync(targetMeta.diskPath, "utf-8")
            : undefined);
        const totalTargetLines =
          targetMeta.lineCount ?? (cachedRaw ? countSourceLines(cachedRaw) : undefined);
        const requestedEndLine = parsedOverflowRange
          ? (parsedOverflowRange.endLine ?? parsedOverflowRange.startLine)
          : undefined;

        const sepBefore = packedContextResults.length > 0 ? 2 : 0;
        const reserveForLaterUnpacked = unpackedRemaining * 260;
        const availForThisBytes = Math.max(
          220,
          softByteCap - usedBytes - sepBefore - reserveForLaterUnpacked,
        );
        const availForThisTokens = softTokenCap - usedTokens;

        // Partial slice fill ONLY for an oversized explicit selector (`:L` or `:sym`), NEVER for bare files
        if (
          hasExplicitSel &&
          !partialExplicitHandled &&
          targetMeta.route === "context" &&
          availForThisBytes >= 1_100 &&
          availForThisTokens >= 240
        ) {
          partialExplicitHandled = true;
          const partialBudgetBytes = availForThisBytes - 200;
          const rawBundleLines = resItem.formattedBundle.split("\n");
          const hasTrackableLines = rawBundleLines.some(
            (ln) => /^\s*\d+[│:]\s/.test(ln) || /^\/\/ [^\s:]+:\d+(?:-\d+)?$/.test(ln),
          );
          if (hasTrackableLines && partialBudgetBytes > 120) {
            const keptPartialLines: string[] = [];
            let partialBytes = 0;
            let lastEmittedLine = 0;
            let trackingContiguous = false;
            for (const ln of rawBundleLines) {
              const lnBytes =
                Buffer.byteLength(ln, "utf-8") + (keptPartialLines.length > 0 ? 1 : 0);
              if (partialBytes + lnBytes > partialBudgetBytes) {
                break;
              }
              keptPartialLines.push(ln);
              partialBytes += lnBytes;
              const hdrMatch = ln.match(/^\/\/ [^\s:]+:(\d+)(?:-\d+)?$/);
              if (hdrMatch?.[1]) {
                const sNum = Number.parseInt(hdrMatch[1], 10);
                lastEmittedLine = sNum > 0 ? sNum - 1 : 0;
                trackingContiguous = true;
                continue;
              }
              const foldMatch = ln.match(/^\/\/ \[L\d+-L(\d+):/);
              if (foldMatch?.[1]) {
                lastEmittedLine = Number.parseInt(foldMatch[1], 10);
                continue;
              }
              const numMatch = ln.match(/^\s*(\d+)[│:]\s/);
              if (numMatch?.[1]) {
                const parsedNum = Number.parseInt(numMatch[1], 10);
                if (parsedNum > 0) {
                  lastEmittedLine = parsedNum;
                  trackingContiguous = true;
                }
                continue;
              }
              if (trackingContiguous && !ln.startsWith("// ")) {
                lastEmittedLine++;
              }
            }

            if (lastEmittedLine > 0) {
              const closedPartial = closeUnclosedMarkdownFence(keptPartialLines.join("\n"));
              let continuationFooter: string;
              if (isExplicitLineRange && requestedEndLine !== undefined) {
                const cappedEnd =
                  totalTargetLines !== undefined
                    ? Math.min(requestedEndLine, totalTargetLines)
                    : requestedEndLine;
                if (cappedEnd > lastEmittedLine) {
                  const hint = `narrow with aice search <pat> ${targetMeta.displayPath}`;
                  paginationHints.push(hint);
                  continuationFooter = `// [${effectiveBudgets.budgetLabel} budget reached (L${lastEmittedLine + 1}-L${cappedEnd} remaining) — ${hint}]`;
                } else {
                  continuationFooter = `// [${effectiveBudgets.budgetLabel} budget reached — target range complete]`;
                }
              } else if (totalTargetLines !== undefined && lastEmittedLine >= totalTargetLines) {
                continuationFooter = `// [${effectiveBudgets.budgetLabel} budget reached — target content complete]`;
              } else {
                const hint = buildAntiPaginationHintForTarget(targetMeta.displayPath, {
                  diskPath: targetMeta.isDir ? undefined : targetMeta.diskPath,
                  rawSource: cachedRaw,
                  projectRoot: targetMeta.resolved.projectRoot,
                  excludeSymbol: targetMeta.effectiveSelector,
                });
                paginationHints.push(hint);
                continuationFooter = `// [${effectiveBudgets.budgetLabel} budget reached (from L${lastEmittedLine + 1} remaining) — ${hint}]`;
              }
              if (targetSummaries[i]) {
                targetSummaries[i] = {
                  ...targetSummaries[i]!,
                  ...(totalTargetLines !== undefined ? { lineCount: totalTargetLines } : {}),
                };
              }
              const partialBlock = `${closedPartial}\n${continuationFooter}`;
              packedContextResults.push({
                targetPath: targetMeta.displayPath,
                targetContent: partialBlock,
                formattedBundle: partialBlock,
                dependencies: [],
                callers: [],
                tokenCount: estimateTokens(partialBlock),
              });
              usedBytes += sepBefore + Buffer.byteLength(partialBlock, "utf-8");
              usedTokens += estimateTokens(partialBlock);
              continue;
            }
          }
        }

        let downgradedBlock: string;
        if (isExplicitLineRange) {
          const hint = `narrow with aice search <pat> ${targetMeta.displayPath}`;
          paginationHints.push(hint);
          downgradedBlock = `// ${targetMeta.displayPath}:${targetMeta.effectiveSelector} (omitted — ${effectiveBudgets.budgetLabel} budget; ${hint})`;
        } else if (targetMeta.effectiveSelector) {
          const effSel = targetMeta.effectiveSelector;
          const hint = isPureRegexSelector(effSel)
            ? `aice search "${effSel.replace(/^\/|\/[gimsuy]*$/g, "")}" ${targetMeta.displayPath}`
            : `batch symbols: aice read ${targetMeta.displayPath}:${effSel} or aice search <pat> ${targetMeta.displayPath}`;
          paginationHints.push(hint);
          downgradedBlock = `// ${targetMeta.displayPath}:${effSel} (omitted — ${effectiveBudgets.budgetLabel} budget; ${hint})`;
        } else {
          if (targetSummaries[i]) {
            targetSummaries[i] = {
              ...targetSummaries[i]!,
              autoOutlined: true,
              ...(totalTargetLines !== undefined ? { lineCount: totalTargetLines } : {}),
            };
          }
          try {
            if (!targetMeta.isDir && fs.existsSync(targetMeta.diskPath)) {
              const oRes = await withSuppressedTelemetryAsync(() =>
                outlinePath(targetMeta.diskPath, {
                  includeTypes: options.includeTypes !== false,
                  compact: true,
                  idioms: isProjectIdiomsEnabled(targetMeta.resolved.config, options.idioms),
                  projectRoot: targetMeta.resolved.projectRoot,
                  ...(cachedRaw !== undefined ? { preReadSource: cachedRaw } : {}),
                }),
              );
              const singleOutlineObj = oRes instanceof Map ? Array.from(oRes.values())[0] : oRes;
              const singleOutlineText = singleOutlineObj?.text ?? "";
              const symNames = extractRepresentativeSymbolHints({
                symbols: singleOutlineObj?.symbols,
                diskPath: targetMeta.diskPath,
                rawSource: cachedRaw,
                displayPath: targetMeta.displayPath,
                projectRoot: targetMeta.resolved.projectRoot,
              });
              const guidance = formatBatchSymbolsOrSearchHint(targetMeta.displayPath, symNames);
              paginationHints.push(guidance);
              const hdr = buildAutoOutlineHeader(targetMeta.displayPath, totalTargetLines ?? 1, {
                symbolNames: symNames,
                budgetDowngraded: true,
                budgetLabel: effectiveBudgets.budgetLabel,
              });
              const perOutlineCap = Math.max(
                260,
                Math.floor(
                  Math.max(320, softByteCap - usedBytes - sepBefore) /
                    Math.max(1, unpackedRemaining + 1),
                ),
              );
              downgradedBlock = compactAutoOutlineBlock(
                hdr,
                singleOutlineText,
                perOutlineCap,
                targetMeta.displayPath,
              );
            } else {
              const guidance = buildAntiPaginationHintForTarget(targetMeta.displayPath, {
                projectRoot: targetMeta.resolved.projectRoot,
              });
              paginationHints.push(guidance);
              downgradedBlock = `// ${targetMeta.displayPath} (omitted — ${effectiveBudgets.budgetLabel} budget; ${guidance})`;
            }
          } catch {
            const guidance = `narrow with aice search <pat> ${targetMeta.displayPath}`;
            paginationHints.push(guidance);
            downgradedBlock = `// Auto-outlined ${targetMeta.displayPath} (${totalTargetLines ?? 1}L, >${effectiveBudgets.budgetLabel}) — ${guidance}`;
          }
        }

        packedContextResults.push({
          targetPath: targetMeta.displayPath,
          targetContent: downgradedBlock,
          formattedBundle: downgradedBlock,
          dependencies: [],
          callers: [],
          tokenCount: estimateTokens(downgradedBlock),
        });
        usedBytes += sepBefore + Buffer.byteLength(downgradedBlock, "utf-8");
        usedTokens += estimateTokens(downgradedBlock);
      }

      if (packedContextResults.length > 0) {
        merged = mergeMultiContextResults(packedContextResults, {
          outlineTarget: Boolean(options.outlineTarget),
          includeDeps: effectiveIncludeDeps,
          includeCallers: effectiveIncludeCallers,
          depth: options.depth,
          rawNative: effectiveRawNative,
          surface: options.surface,
        });
        formattedBundle = merged.formattedBundle;
      }
    }

    if (missingTargets.length > 0) {
      const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
      formattedBundle = `${formattedBundle}\n${missingFooter}`;
    }
    let tokenCount = estimateTokens(formattedBundle);

    const jsonData = results;
    const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
    const statsText = options.stats
      ? formatContextStatsFooter(
          tokenCount,
          merged.dependencies.length,
          merged.callers.length,
          merged.targetContent.length,
        )
      : undefined;
    let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

    if (enforceStreamBudget) {
      const cappedMulti = enforceReadBudgetCeiling({
        bundle: formattedBundle,
        fallbackTargetPath: matchedTargets[0]?.effectiveSelector
          ? `${matchedTargets[0].displayPath}:${matchedTargets[0].effectiveSelector}`
          : (matchedTargets[0]?.displayPath ?? "."),
        statsText,
        extraHints: paginationHints,
        projectRoot: firstProjectRoot,
        maxBytes: effectiveBudgets.maxBytes,
        maxTokens: effectiveBudgets.maxTokens,
        sliceByteBudget: effectiveBudgets.sliceByteBudget,
        budgetLabel: effectiveBudgets.budgetLabel,
      });
      formattedBundle = cappedMulti.formattedBundle;
      output = cappedMulti.output;
      tokenCount = cappedMulti.tokenCount;
    }

    if (firstResolvedPath) {
      const aicePayload = jsonOutput ?? formattedBundle;
      const contextTargets = matchedTargets.length > 0 ? matchedTargets : contextItems;
      const multiFiles = Array.from(
        new Set(
          contextTargets
            .filter((c) => !c.isDir)
            .map((c) => {
              const rel = path.relative(firstProjectRoot, c.diskPath).replace(/\\/g, "/");
              return rel && !rel.startsWith("..") ? rel : c.displayPath;
            })
            .filter(Boolean),
        ),
      );
      recordTelemetryEvent({
        targetPath: firstResolvedPath,
        projectRoot: firstProjectRoot,
        filePath: "<multi-context>",
        multiFiles: multiFiles.length > 0 ? multiFiles : undefined,
        operation: "context",
        surface,
        idiomsUsed: Boolean(merged.idioms && Object.keys(merged.idioms).length > 0),
        isSearchMode: overallMode === "search",
        nativeText: "",
        nativeChars: totalFullNativeChars,
        nativeCl100k: totalFullNativeCl100k,
        nativeO200k: totalFullNativeO200k,
        realisticNativeCl100k: Math.min(totalFullNativeCl100k, totalRealisticNativeCl100k),
        aiceText: aicePayload,
        aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
      });
    }

    const stats: ReadStats = {
      tokenCount,
      ...(resolvedNativeTargetCount > 0
        ? {
            originalTokens: totalRealisticNativeCl100k,
            savedTokens: totalRealisticNativeCl100k - tokenCount,
            savingsPct:
              totalRealisticNativeCl100k > 0
                ? Math.round(
                    ((totalRealisticNativeCl100k - tokenCount) / totalRealisticNativeCl100k) * 100,
                  )
                : 0,
            originalChars: totalFullNativeChars,
          }
        : {}),
      outputChars: formattedBundle.length,
      dependenciesCount: merged.dependencies.length,
      callersCount: merged.callers.length,
      fileCount: results.length,
    };

    return {
      mode: overallMode,
      targetPath: merged.targetPath,
      text: formattedBundle,
      formattedBundle,
      targetContent: merged.targetContent,
      output,
      tokenCount,
      targets: targetSummaries,
      missingTargets,
      dependencies: merged.dependencies,
      callers: merged.callers,
      idioms: merged.idioms,
      nativeDiagnostics: merged.nativeDiagnostics,
      contextResult: merged,
      contextResults: results,
      jsonData,
      jsonOutput,
      stats,
      statsText,
    };
  }

  const singleResult = results[0];
  if (!singleResult) {
    throw new Error("No target context produced");
  }

  let formattedBundle = singleResult.formattedBundle;
  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    formattedBundle = `${formattedBundle}\n${missingFooter}`;
  }
  const truncatedSingle =
    isMultiInput && options.maxTokens !== undefined
      ? truncateBundleToMaxTokens(formattedBundle, options.maxTokens)
      : {
          text: formattedBundle,
          tokenCount:
            missingTargets.length > 0
              ? estimateTokens(formattedBundle)
              : (singleResult.tokenCount ?? estimateTokens(formattedBundle)),
        };
  formattedBundle = truncatedSingle.text;
  let tokenCount = truncatedSingle.tokenCount;

  // Eliminate single-file read / small-slice chrome bloat when headers or resume numbers push aiceCl100k > realisticNativeCl100k
  const effectiveSingleRealisticTok = Math.min(totalFullNativeCl100k, totalRealisticNativeCl100k);
  const singleMatchedForCompact = matchedTargets[0];
  if (
    !isMultiInput &&
    missingTargets.length === 0 &&
    !options.json &&
    !options.stats &&
    !effectiveIncludeDeps &&
    !effectiveIncludeCallers &&
    (options.surface === "cli" || options.surface === "mcp" || effectiveRawNative) &&
    effectiveSingleRealisticTok > 0 &&
    tokenCount > effectiveSingleRealisticTok &&
    singleMatchedForCompact &&
    !singleMatchedForCompact.isDir
  ) {
    const sel = singleMatchedForCompact.effectiveSelector?.trim();
    const singleRangeMatch = sel?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
    if (singleRangeMatch?.[1] && !formattedBundle.includes("[Clamped ")) {
      const rawSrc =
        singleMatchedForCompact.preReadSource ??
        sharedScanCache.fileContentByPath.get(singleMatchedForCompact.diskPath) ??
        (fs.existsSync(singleMatchedForCompact.diskPath)
          ? fs.readFileSync(singleMatchedForCompact.diskPath, "utf-8")
          : undefined);
      if (rawSrc !== undefined) {
        const rawLines = rawSrc.replace(/\r?\n$/, "").split(/\r?\n/);
        const totalL = Math.max(1, rawLines.length);
        if (totalL <= DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD) {
          const rStart = Math.max(1, Math.min(totalL, Number.parseInt(singleRangeMatch[1], 10)));
          const rEnd = Math.max(
            rStart,
            Math.min(
              totalL,
              singleRangeMatch[2] ? Number.parseInt(singleRangeMatch[2], 10) : rStart,
            ),
          );
          const cleanSlice = rawLines.slice(rStart - 1, rEnd).join("\n");
          const withCompactHeader = `// ${singleMatchedForCompact.displayPath}:${rStart}-${rEnd}\n${cleanSlice}`;
          const withHdrTok = estimateTokens(withCompactHeader, "cl100k_base");
          const cleanTok = estimateTokens(cleanSlice, "cl100k_base");
          if (withHdrTok <= effectiveSingleRealisticTok) {
            formattedBundle = withCompactHeader;
            tokenCount = withHdrTok;
          } else if (cleanTok < tokenCount) {
            formattedBundle = cleanSlice;
            tokenCount = cleanTok;
          }
        }
      }
    } else if (
      sel &&
      !isPureRegexSelector(sel) &&
      totalFullNativeCl100k >= 400 &&
      tokenCount > totalFullNativeCl100k
    ) {
      let stripped = formattedBundle.replace(
        /\n\/\/ siblings[^\n]*(?:\n\/\/ siblings[^\n]*)*$/,
        "",
      );
      if (estimateTokens(stripped, "cl100k_base") > totalFullNativeCl100k) {
        stripped = stripped.replace(/^\/\/ [^\n]+\n/, "");
      }
      const strippedTok = estimateTokens(stripped, "cl100k_base");
      if (strippedTok < tokenCount) {
        formattedBundle = stripped;
        tokenCount = strippedTok;
      }
    }
  }

  const jsonData = singleResult;
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const statsText = options.stats
    ? formatContextStatsFooter(
        tokenCount,
        singleResult.dependencies.length,
        singleResult.callers.length,
        singleResult.targetContent.length,
      )
    : undefined;
  let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

  if (enforceStreamBudget) {
    const singleMatched = matchedTargets[0];
    const singleRaw =
      singleMatched?.preReadSource ??
      (singleMatched ? sharedScanCache.fileContentByPath.get(singleMatched.diskPath) : undefined);
    const singleTotalLines =
      singleMatched?.lineCount ?? (singleRaw ? countSourceLines(singleRaw) : undefined);
    const cappedSingle = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: singleMatched?.effectiveSelector
        ? `${singleMatched.displayPath}:${singleMatched.effectiveSelector}`
        : (singleMatched?.displayPath ?? singleResult.targetPath),
      statsText,
      totalLines: singleTotalLines,
      diskPath: singleMatched?.isDir ? undefined : singleMatched?.diskPath,
      rawSource: singleRaw,
      projectRoot: firstProjectRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = cappedSingle.formattedBundle;
    output = cappedSingle.output;
    tokenCount = cappedSingle.tokenCount;
  }

  if (firstResolvedPath) {
    const aicePayload = jsonOutput ?? formattedBundle;
    recordTelemetryEvent({
      targetPath: firstResolvedPath,
      projectRoot: firstProjectRoot,
      operation: "context",
      surface,
      idiomsUsed: Boolean(singleResult.idioms && Object.keys(singleResult.idioms).length > 0),
      isSearchMode: overallMode === "search",
      nativeText: "",
      nativeChars: totalFullNativeChars,
      nativeCl100k: totalFullNativeCl100k,
      nativeO200k: totalFullNativeO200k,
      realisticNativeCl100k: Math.min(totalFullNativeCl100k, totalRealisticNativeCl100k),
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  const stats: ReadStats = {
    tokenCount,
    ...(resolvedNativeTargetCount > 0
      ? {
          originalTokens: totalRealisticNativeCl100k,
          savedTokens: totalRealisticNativeCl100k - tokenCount,
          savingsPct:
            totalRealisticNativeCl100k > 0
              ? Math.round(
                  ((totalRealisticNativeCl100k - tokenCount) / totalRealisticNativeCl100k) * 100,
                )
              : 0,
          originalChars: totalFullNativeChars,
        }
      : {}),
    outputChars: formattedBundle.length,
    dependenciesCount: singleResult.dependencies.length,
    callersCount: singleResult.callers.length,
    fileCount: 1,
  };

  return {
    mode: overallMode,
    targetPath: singleResult.targetPath,
    text: formattedBundle,
    formattedBundle,
    targetContent: singleResult.targetContent,
    output,
    tokenCount,
    targets: targetSummaries,
    missingTargets,
    dependencies: singleResult.dependencies,
    callers: singleResult.callers,
    idioms: singleResult.idioms,
    nativeDiagnostics: singleResult.nativeDiagnostics,
    contextResult: singleResult,
    contextResults: [singleResult],
    jsonData,
    jsonOutput,
    stats,
    statsText,
  };
}

export const read = aiceRead;
