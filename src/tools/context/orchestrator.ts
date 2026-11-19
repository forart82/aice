/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Primary context pack orchestrators (generateContext, packContext, packageContext, generateMultiContext).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  isLikelyBinaryDiskFile,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  type ProjectIdiomDefinition,
  resolvePathTargets,
} from "../../config/index.js";
import type { Module } from "../../core/ast.js";
import { decompile } from "../../decompiler/index.js";
import { detectTargetFromPathOrContent } from "../../emitters/index.js";
import {
  collapseAiceSourceIdioms,
  expandAiceSourceIdioms,
  scanProjectIdioms,
} from "../../idioms/index.js";
import {
  recordTelemetryEvent,
  withSuppressedTelemetry,
  withSuppressedTelemetryAsync,
} from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import {
  collectNativeSyntaxDiagnostics,
  generateOutline,
  type OutlineResult,
  type OutlineSymbol,
} from "../outline.js";
import { locateNativeDeclarationSpan } from "../splice.js";
import { didYouMeanFile } from "../suggest.js";
import {
  formatBundle,
  generateWorkspaceContext,
  scanWorkspaceCallers,
} from "./callers-and-workspace.js";
import {
  extractSymbolFromAiceSource,
  formatCompactBareFileSource,
  formatDiskSourceWithLineNumbers,
  formatWithLineNumbers,
  parseSymbolPatternSelector,
} from "./focus-and-elision.js";
import {
  computeHonestReadBaselineText,
  countContextLines,
  isPureRegexSymbolString,
} from "./honest-baseline.js";
import {
  buildSiblingOutline,
  compactPureAiceSlice,
  extractExportedContract,
  extractFileSymbolList,
  extractImportsFromFile,
  formatDisplayPath,
  generateExternalContract,
  isExternalSpecifier,
  resolveEffectiveTargetAndRoot,
  resolveImportPath,
  splitSymbolSelectors,
  unwrapSyntheticContainer,
} from "./imports-and-deps.js";
import {
  mergeMultiContextResults,
  parseTargetWithInlineSymbol,
  splitContextTargets,
} from "./targets-and-merge.js";
import type {
  CallerSummary,
  ContextOptions,
  ContextResult,
  DependencyContract,
  WorkspaceCallerScanCache,
} from "./types.js";

const ZERO_ENVELOPE_EXT_RE =
  /\.(?:jsonc?|webmanifest|ya?ml|cff|md|markdown|css|html?|xml|svg|twig|sh|bash|zsh|ps1|cmd|bat|gradle|pro|properties|example)$/i;

/**
 * Packages dependency contracts, target file content, and downstream callers into a 1-turn context pack.
 * If targetPath is omitted or points to a directory, packages a workspace overview context pack.
 */
export async function generateContext(
  rawTargetPath?: string | string[],
  rawOptions: ContextOptions = {},
): Promise<ContextResult> {
  if (Array.isArray(rawTargetPath)) {
    const filtered = rawTargetPath.map((t) => String(t).trim()).filter(Boolean);
    if (filtered.length === 0) {
      return generateWorkspaceContext(undefined, rawOptions);
    }
    if (filtered.length === 1) {
      return generateContext(filtered[0], rawOptions);
    }
    return generateMultiContext(filtered, rawOptions);
  }

  if (!rawTargetPath || rawTargetPath.trim() === "") {
    return generateWorkspaceContext(undefined, rawOptions);
  }

  const baseDir = rawOptions.projectRoot ? path.resolve(rawOptions.projectRoot) : process.cwd();
  if (/\s+/.test(rawTargetPath.trim())) {
    const tokens = splitContextTargets(rawTargetPath, baseDir);
    if (tokens.length > 1) {
      return generateMultiContext(tokens, rawOptions);
    }
  }

  const parsedTarget = parseTargetWithInlineSymbol(rawTargetPath, baseDir);
  const targetPath = parsedTarget.targetPath;
  const options: ContextOptions = parsedTarget.inlineSymbol
    ? { ...rawOptions, symbol: parsedTarget.inlineSymbol }
    : rawOptions;

  const preResolved = resolveEffectiveTargetAndRoot(targetPath, options.projectRoot);
  const resolved = resolvePathTargets(preResolved.targetPath, {
    includeTargets: true,
    projectRoot: preResolved.projectRoot,
  });

  if (resolved.isDirectory || resolved.isOmitted) {
    return generateWorkspaceContext(resolved.resolvedPath, options);
  }

  const fullTargetPath = resolved.resolvedPath;
  if (!fs.existsSync(fullTargetPath)) {
    throw new Error(`Target file not found: ${targetPath}${didYouMeanFile(fullTargetPath)}`);
  }

  const projectRoot = resolved.projectRoot;
  const config = resolved.config;
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  const isPureLineRangeSymbol =
    Boolean(options.symbol) && /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i.test(options.symbol!.trim());
  const isPureRegexSymbol =
    Boolean(options.symbol) &&
    splitSymbolSelectors(options.symbol!).length > 0 &&
    splitSymbolSelectors(options.symbol!).every((s) => /^\/.+\/[gimsuy]*$/.test(s.trim()));
  const isSymbolPattern =
    Boolean(options.symbol) && Boolean(parseSymbolPatternSelector(options.symbol!.trim()));

  const effectiveRawNative = options.dsl === true ? false : Boolean(options.rawNative);
  const idiomsActive =
    effectiveRawNative && options.idioms !== true
      ? false
      : isProjectIdiomsEnabled(config, options.idioms);
  const regexMentionsIdiom = isPureRegexSymbol && /\$[A-Za-z_]/.test(options.symbol!);
  const isFastPathSelector =
    isPureLineRangeSymbol ||
    isSymbolPattern ||
    (isPureRegexSymbol && !(idiomsActive && regexMentionsIdiom));

  let activeIdioms =
    idiomsActive && config.idioms && Object.keys(config.idioms).length > 0
      ? config.idioms
      : undefined;
  let zeroIdiomsReason: string | undefined;
  if (
    options.idioms === true &&
    (!activeIdioms || Object.keys(activeIdioms).length === 0) &&
    !isFastPathSelector
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

  const displayTargetPath = formatDisplayPath(fullTargetPath, projectRoot);
  if (isLikelyBinaryDiskFile(fullTargetPath)) {
    const fileSize = (() => {
      try {
        return fs.statSync(fullTargetPath).size;
      } catch {
        return 0;
      }
    })();
    const binaryNotice = `// [binary file skipped: ${displayTargetPath} (${fileSize} bytes)]`;
    return {
      targetPath: fullTargetPath,
      targetContent: binaryNotice,
      dependencies: [],
      callers: [],
      formattedBundle: options.json
        ? JSON.stringify(
            {
              target: displayTargetPath,
              binary: true,
              bytes: fileSize,
              message: binaryNotice,
            },
            null,
            2,
          )
        : binaryNotice,
      tokenCount: estimateTokens(binaryNotice, "cl100k_base"),
    };
  }
  const rawFileContent = fs.readFileSync(fullTargetPath, "utf-8");

  const rawLineCount = countContextLines(rawFileContent);
  const hasNonWildcardSymbol = Boolean(
    options.symbol && options.symbol.trim() !== "" && options.symbol.trim() !== "*",
  );
  const isCliOrMcp = options.surface === "cli" || options.surface === "mcp";
  const effectiveIncludeDeps = isCliOrMcp
    ? (options.includeDeps ?? (options.depth !== undefined && options.depth > 0 ? true : false))
    : options.includeDeps;
  const effectiveIncludeCallers = isCliOrMcp
    ? (options.includeCallers ?? false)
    : options.includeCallers;
  const hasExplicitDeps =
    effectiveIncludeDeps === true || (options.depth !== undefined && options.depth > 0);
  const hasExplicitCallers = effectiveIncludeCallers === true;
  const hasExplicitEnvelopeOptIn = hasExplicitDeps || hasExplicitCallers;

  const isLargeFileSymbolQuery = hasNonWildcardSymbol && rawFileContent.length > 50_000;
  const targetOrPassthrough = detectTargetFromPathOrContent(fullTargetPath, rawFileContent);
  const isPassthrough = targetOrPassthrough === "passthrough" || targetOrPassthrough === "text";
  const isZeroEnvelopeExt = isPassthrough || ZERO_ENVELOPE_EXT_RE.test(fullTargetPath);
  const isBareSmallFile =
    Boolean(options.zeroEnvelopeBareSmallFiles) &&
    !hasNonWildcardSymbol &&
    !options.outlineTarget &&
    !fullTargetPath.endsWith(".aice") &&
    rawLineCount <= 150;
  const isZeroEnvelopeTarget =
    !hasExplicitEnvelopeOptIn &&
    (isPureLineRangeSymbol ||
      isPureRegexSymbol ||
      isSymbolPattern ||
      isZeroEnvelopeExt ||
      isBareSmallFile ||
      isCliOrMcp);
  const nativeDiagnostics =
    isFastPathSelector || isLargeFileSymbolQuery || isPassthrough
      ? undefined
      : collectNativeSyntaxDiagnostics(fullTargetPath, rawFileContent);

  const buildFallbackNativeSlice = (symSelector?: string): string => {
    const rawLines = rawFileContent.split(/\r?\n/);
    const totalLines = rawLines.length;
    if (!symSelector || symSelector.trim() === "" || symSelector.trim() === "*") {
      return formatWithLineNumbers(rawFileContent, 1);
    }
    const sel = symSelector.trim();
    const rangeMatch = sel.match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
    if (rangeMatch) {
      const sLine = Math.max(1, Math.min(totalLines, Number.parseInt(rangeMatch[1], 10)));
      const eLine = Math.max(
        sLine,
        Math.min(totalLines, rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : sLine),
      );
      return rawLines
        .slice(sLine - 1, eLine)
        .map((ln, idx) => `${sLine + idx}│ ${ln}`)
        .join("\n");
    }
    try {
      if (!isPassthrough) {
        const targetLang = targetOrPassthrough;
        const spanInfo = locateNativeDeclarationSpan(rawFileContent, sel, targetLang);
        if (spanInfo) {
          const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
          const sLine =
            spanInfo.startLine ?? rawFileContent.slice(0, startOff).split(/\r?\n/).length;
          const snippet = rawFileContent.slice(startOff, spanInfo.declEnd);
          return formatWithLineNumbers(snippet, sLine);
        }
      }
    } catch {
      // fall through to line search
    }
    const shortName = sel.split(/\.|::/).pop()?.trim() || sel;
    const hitIdx = rawLines.findIndex((l) => l.includes(shortName));
    if (hitIdx >= 0) {
      const sLine = Math.max(1, hitIdx);
      const eLine = Math.min(totalLines, hitIdx + 25);
      return rawLines
        .slice(sLine - 1, eLine)
        .map((ln, idx) => `${sLine + idx}│ ${ln}`)
        .join("\n");
    }
    const cap = Math.min(totalLines, 50);
    return rawLines
      .slice(0, cap)
      .map((ln, idx) => `${1 + idx}│ ${ln}`)
      .join("\n");
  };

  let targetContent = rawFileContent;
  let preParsedMod: Module | undefined;
  let decompileFailed = false;
  if (effectiveRawNative && !idiomsActive) {
    if (!hasNonWildcardSymbol && !options.outlineTarget) {
      if (!isPassthrough && nativeDiagnostics && !fullTargetPath.endsWith(".aice")) {
        decompileFailed = true;
        targetContent = buildFallbackNativeSlice(options.symbol);
      } else {
        targetContent = formatCompactBareFileSource(rawFileContent, displayTargetPath, {
          isMultiTarget: options._isMultiTarget,
          full: options.full,
        });
      }
    } else {
      targetContent = rawFileContent;
    }
  } else if (!fullTargetPath.endsWith(".aice") && !isFastPathSelector && !isLargeFileSymbolQuery) {
    if (isPassthrough || (isZeroEnvelopeExt && !hasNonWildcardSymbol && !idiomsActive)) {
      if (!isPassthrough && nativeDiagnostics) {
        decompileFailed = true;
        targetContent = buildFallbackNativeSlice(options.symbol);
      } else {
        targetContent = rawFileContent;
      }
    } else {
      try {
        const targetLang = targetOrPassthrough;
        const isRawTemplate = targetLang === "twig";
        if (!isRawTemplate || options.symbol || options.idioms) {
          const decomp = withSuppressedTelemetry(() =>
            decompile(rawFileContent, targetLang, { filePath: fullTargetPath, projectRoot }),
          );
          targetContent = decomp.aice;
          preParsedMod = decomp.ast;
          if (isBareSmallFile && !idiomsActive) {
            const compactedSmall = compactPureAiceSlice(targetContent);
            targetContent =
              estimateTokens(compactedSmall) <= estimateTokens(rawFileContent)
                ? compactedSmall
                : rawFileContent;
          }
        }
      } catch (err) {
        decompileFailed = true;
        const errMsg = err instanceof Error ? err.message : String(err);
        console.error(
          `[AICE AST Fallback] Decompiler failed for ${displayTargetPath}: ${errMsg}. Falling back to line-numbered native slice.`,
        );
        targetContent = buildFallbackNativeSlice(options.symbol);
      }
    }
  }

  if (
    !decompileFailed &&
    regexMentionsIdiom &&
    idiomsActive &&
    activeIdioms &&
    Object.keys(activeIdioms).length > 0
  ) {
    try {
      targetContent = collapseAiceSourceIdioms(targetContent, activeIdioms, fullTargetPath).aice;
    } catch {
      // ignore pre-regex collapse errors
    }
  }

  if (options.symbol && !decompileFailed) {
    if (options.symbol.trim() === "*") {
      if (effectiveRawNative && !idiomsActive) {
        let allSyms: string[] = [];
        try {
          const outRes = withSuppressedTelemetry(() =>
            generateOutline(rawFileContent, fullTargetPath, {
              includeTypes: true,
              skipTokenStats: true,
              lineRanges: false,
              depth: 1,
              idioms: false,
            }),
          );
          allSyms = outRes.symbols.filter((s) => s.kind !== "import").map((s) => s.name);
        } catch {
          allSyms = [];
        }
        const numberedAll = formatDiskSourceWithLineNumbers(rawFileContent, 1);
        targetContent =
          allSyms.length > 0 ? `// symbols: ${allSyms.join(", ")}\n\n${numberedAll}` : numberedAll;
      } else {
        const allSyms = extractFileSymbolList(targetContent, fullTargetPath);
        if (
          (fullTargetPath.endsWith(".html") ||
            fullTargetPath.endsWith(".json") ||
            fullTargetPath.endsWith(".yaml")) &&
          allSyms.length > 0
        ) {
          const slicedAll: string[] = [];
          for (const sym of allSyms) {
            try {
              const s = unwrapSyntheticContainer(
                extractSymbolFromAiceSource(targetContent, sym, fullTargetPath, preParsedMod)
                  .replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "")
                  .trim(),
                fullTargetPath,
              );
              if (s) slicedAll.push(s);
            } catch {
              // ignore
            }
          }
          if (slicedAll.length > 0) {
            targetContent = [`// symbols: ${allSyms.join(", ")}`, ...slicedAll].join("\n\n");
          }
        } else {
          const unwrapped = unwrapSyntheticContainer(
            targetContent.replace(/^(?:(?:#|\/\/)[^\n]*|module\s+[^\n]+|\s+)+/g, "").trim(),
            fullTargetPath,
          );
          targetContent =
            allSyms.length > 0 ? `// symbols: ${allSyms.join(", ")}\n\n${unwrapped}` : unwrapped;
        }
      }
    } else {
      const requestedSymbols = splitSymbolSelectors(options.symbol);
      const shouldEnforceBudget =
        options.maxTokens === undefined &&
        !options.json &&
        !options.full &&
        !options.unboundedCli &&
        (options.surface === "cli" || options.surface === "mcp") &&
        !options.dsl;
      const extractOpts = {
        numberLines: true,
        clampOutOfBounds: true,
        rawNative: effectiveRawNative,
        contextLines: options.contextLines,
        surface: options.surface,
        elideLargeLineRange: shouldEnforceBudget,
        full: options.full,
        dsl: options.dsl,
        projectRoot,
      };
      if (requestedSymbols.length === 0) {
        if (!nativeDiagnostics) {
          throw new Error(`Symbol '${options.symbol}' not found in ${fullTargetPath}`);
        }
      } else if (requestedSymbols.length === 1) {
        try {
          targetContent = extractSymbolFromAiceSource(
            targetContent,
            requestedSymbols[0],
            fullTargetPath,
            preParsedMod,
            extractOpts,
          );
        } catch (err) {
          const sym0 = requestedSymbols[0].trim();
          const shortSym0 = sym0.split(/\.|::/).pop()?.trim() || sym0;
          const isForeignLang =
            !isPassthrough && ["go", "rust", "cpp", "twig"].includes(targetOrPassthrough);
          if (isForeignLang && rawFileContent.includes(shortSym0)) {
            const errMsg = err instanceof Error ? err.message : String(err);
            console.error(
              `[AICE AST Fallback] Symbol slice fallback for ${displayTargetPath} (${sym0}): ${errMsg}. Falling back to line-numbered native slice.`,
            );
            targetContent = buildFallbackNativeSlice(sym0);
            decompileFailed = true;
          } else if (!nativeDiagnostics) {
            throw err;
          }
        }
      } else {
        const slicedBlocks: string[] = [];
        const missingSymbols: string[] = [];
        let firstMissingErr: unknown;
        let totalCombinedLineSpan = 0;
        for (const sym of requestedSymbols) {
          const rm = sym.trim().match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
          if (!rm?.[1]) continue;
          const s = Number.parseInt(rm[1], 10);
          const e = rm[2] ? Number.parseInt(rm[2], 10) : s;
          if (e >= s) totalCombinedLineSpan += e - s + 1;
        }
        const multiExtractOpts =
          extractOpts.elideLargeLineRange && totalCombinedLineSpan > 110
            ? { ...extractOpts, forceElideLargeLineRange: true }
            : extractOpts;
        for (const sym of requestedSymbols) {
          try {
            const rawBlock = extractSymbolFromAiceSource(
              targetContent,
              sym,
              fullTargetPath,
              preParsedMod,
              multiExtractOpts,
            );
            slicedBlocks.push(rawBlock);
          } catch (err) {
            missingSymbols.push(sym.trim());
            if (firstMissingErr === undefined) {
              firstMissingErr = err;
            }
          }
        }
        const stripSlicePrefix = (blk: string): string => {
          if (blk.startsWith("// @preformatted\n")) {
            return blk.slice("// @preformatted\n".length);
          }
          if (blk.startsWith("// @span:")) {
            const nl = blk.indexOf("\n");
            if (nl > 0) {
              const sp = blk.slice("// @span:".length, nl).trim();
              return `// ${displayTargetPath}:${sp}\n${blk.slice(nl + 1)}`;
            }
          }
          return blk;
        };
        const joinDeduplicatedBlocks = (blocks: string[]): string => {
          if (blocks.length <= 1) return blocks[0] ?? "";
          const cleaned = blocks.map((b) => stripSlicePrefix(b));
          const firstHasModule = /^(?:[ \t]*#[^\n]*\n)*[ \t]*module\s+[^\n]+/m.test(cleaned[0]!);
          const joinedBody = cleaned
            .map((blk, idx) => {
              if (idx === 0 || !firstHasModule) return blk;
              return blk.replace(/^(?:[ \t]*#[^\n]*\n)*[ \t]*module\s+[^\n]+\n+/, "");
            })
            .join("\n\n");
          return effectiveRawNative ? `// @preformatted\n${joinedBody}` : joinedBody;
        };
        if (firstMissingErr !== undefined) {
          if (requestedSymbols.some((s) => /\s/.test(s))) {
            try {
              targetContent = extractSymbolFromAiceSource(
                targetContent,
                options.symbol.trim(),
                fullTargetPath,
                preParsedMod,
                extractOpts,
              );
              firstMissingErr = undefined;
              missingSymbols.length = 0;
            } catch {
              // keep firstMissingErr
            }
          }
          if (firstMissingErr !== undefined) {
            const allowPartialForCommaBatch =
              options.allowPartialSymbolMatch !== undefined
                ? options.allowPartialSymbolMatch
                : Boolean(effectiveRawNative && requestedSymbols.length > 1);
            if (allowPartialForCommaBatch && slicedBlocks.length > 0) {
              const joined = joinDeduplicatedBlocks(slicedBlocks);
              const missLabel =
                !effectiveRawNative || options._isMultiTarget ? "// missing:" : "// not found:";
              targetContent =
                missingSymbols.length > 0
                  ? `${joined}\n\n${missLabel} ${missingSymbols.join(", ")}`
                  : joined;
            } else if (!nativeDiagnostics) {
              throw firstMissingErr;
            } else if (slicedBlocks.length > 0) {
              targetContent = joinDeduplicatedBlocks(slicedBlocks);
            }
          }
        } else if (slicedBlocks.length > 0) {
          targetContent = joinDeduplicatedBlocks(slicedBlocks);
        }
      }
    }
  }

  if (idiomsActive && activeIdioms && Object.keys(activeIdioms).length > 0 && !regexMentionsIdiom) {
    try {
      const collapsed = collapseAiceSourceIdioms(targetContent, activeIdioms, fullTargetPath);
      targetContent = collapsed.aice;
    } catch {
      // ignore collapse failures
    }
  } else if (
    !effectiveRawNative &&
    !idiomsActive &&
    config.idioms &&
    Object.keys(config.idioms).length > 0 &&
    targetContent.includes("$")
  ) {
    try {
      const expanded = expandAiceSourceIdioms(targetContent, config.idioms, fullTargetPath);
      targetContent = expanded.aice;
    } catch {
      // ignore expand failures
    }
  }
  const detectedLangForSlice = !fullTargetPath.endsWith(".aice")
    ? isPassthrough
      ? undefined
      : targetOrPassthrough
    : undefined;
  if (
    options.symbol &&
    !effectiveRawNative &&
    !idiomsActive &&
    !isFastPathSelector &&
    !isPassthrough &&
    detectedLangForSlice !== "markdown" &&
    detectedLangForSlice !== "shell" &&
    detectedLangForSlice !== "powershell" &&
    detectedLangForSlice !== "batch" &&
    !targetContent.startsWith("// match at [")
  ) {
    targetContent = compactPureAiceSlice(targetContent);
  }

  if (
    options.symbol &&
    !(isPureLineRangeSymbol || isPureRegexSymbol || isZeroEnvelopeExt) &&
    !decompileFailed &&
    !isFastPathSelector &&
    !targetContent.startsWith("// match at [") &&
    !targetContent.startsWith("// @preformatted\n// 0 matches") &&
    !targetContent.startsWith("[Clamped ")
  ) {
    const sel = splitSymbolSelectors(options.symbol).filter((s) => {
      const t = s.trim();
      return (
        Boolean(t) &&
        t !== "*" &&
        t.toLowerCase() !== "imports" &&
        t !== "@first" &&
        t !== "@1" &&
        !/^\[?L\d+(?:-L?\d+)?\]?$/i.test(t) &&
        !/^\/.+\/[gimsuy]*$/.test(t)
      );
    });
    if (sel.length > 0) {
      try {
        const sibRes = withSuppressedTelemetry(() =>
          preParsedMod
            ? generateOutline(preParsedMod, fullTargetPath, {
                includeTypes: !effectiveRawNative,
                idioms: options.idioms,
                projectRoot,
                preReadSource: rawFileContent,
                skipTokenStats: true,
                lineRanges: false,
              })
            : generateOutline(fullTargetPath, {
                includeTypes: !effectiveRawNative,
                idioms: options.idioms,
                projectRoot,
                preReadSource: rawFileContent,
                skipTokenStats: true,
                lineRanges: false,
              }),
        );
        if (effectiveRawNative) {
          const fullSib = buildSiblingOutline(sibRes.symbols, sel);
          if (fullSib) {
            const compactGroups: string[] = [];
            let curHeader = "// siblings:";
            let curNames: string[] = [];
            const flushGroup = (): void => {
              if (curNames.length > 0) {
                const shown = curNames.slice(0, 8).join(", ");
                const extra = curNames.length > 8 ? ` (+${curNames.length - 8})` : "";
                compactGroups.push(`${curHeader} ${shown}${extra}`);
                curNames = [];
              }
            };
            for (const rawLine of fullSib.split("\n")) {
              const trimmedLine = rawLine.trim();
              if (!trimmedLine) continue;
              if (trimmedLine.startsWith("// siblings in ")) {
                flushGroup();
                curHeader = trimmedLine;
                continue;
              }
              if (trimmedLine.startsWith("//   (+")) continue;
              const body = trimmedLine.replace(/^\/\/\s*/, "").trim();
              const ident = body
                .split(/[(:]/)[0]
                ?.replace(/^(?:pub|priv|prot|ro|async|static|fn|val|mut|var|const|let)\s+/g, "")
                .replace(/^(?:pub|priv|prot|ro|async|static|fn|val|mut|var|const|let)\s+/g, "")
                .trim();
              if (ident) curNames.push(ident);
            }
            flushGroup();
            if (compactGroups.length > 0) {
              targetContent = `${targetContent}\n${compactGroups.join("\n")}`;
            }
          }
        } else {
          const sib = buildSiblingOutline(sibRes.symbols, sel);
          if (sib) targetContent = `${targetContent}\n\n${sib}`;
        }
      } catch {
        // sibling outline is best-effort
      }
    }
  }

  const targetExtLower = path.extname(fullTargetPath).toLowerCase();
  const isDataOrDocExt =
    targetExtLower === ".json" ||
    targetExtLower === ".yaml" ||
    targetExtLower === ".yml" ||
    targetExtLower === ".cff" ||
    targetExtLower === ".md" ||
    targetExtLower === ".markdown" ||
    isPassthrough;
  const shouldSkipFullOutline =
    (isZeroEnvelopeTarget ||
      isFastPathSelector ||
      Boolean(options.symbol) ||
      isDataOrDocExt ||
      rawFileContent.length > 50_000) &&
    !options.outlineTarget &&
    options.maxTokens === undefined;
  let outlineRes: OutlineResult;
  if (shouldSkipFullOutline || decompileFailed) {
    outlineRes = {
      file: fullTargetPath,
      text: "",
      symbols: [] as OutlineSymbol[],
      referencedIdioms: [] as string[],
      json: { file: fullTargetPath, symbols: [] as OutlineSymbol[] },
      stats: {
        originalTokens: 0,
        outlineTokens: 0,
        savingsTokens: 0,
        savingsPct: 0,
        originalChars: 0,
        outlineChars: 0,
        charSavingsPct: 0,
      },
    };
  } else {
    try {
      outlineRes = withSuppressedTelemetry(() =>
        generateOutline(fullTargetPath, {
          includeTypes: true,
          idioms: options.idioms,
          projectRoot,
          preReadSource: rawFileContent,
          lineRanges: options.maxTokens === undefined,
        }),
      );
    } catch {
      outlineRes = {
        file: fullTargetPath,
        text: "",
        symbols: [] as OutlineSymbol[],
        referencedIdioms: [] as string[],
        json: { file: fullTargetPath, symbols: [] as OutlineSymbol[] },
        stats: {
          originalTokens: 0,
          outlineTokens: 0,
          savingsTokens: 0,
          savingsPct: 0,
          originalChars: 0,
          outlineChars: 0,
          charSavingsPct: 0,
        },
      };
    }
  }
  const targetOutline = outlineRes.text;

  // Dependency discovery BFS (depth = 0 on zero-envelope fast-path unless --deps / depth > 0)
  const effectiveDepth =
    effectiveIncludeDeps === false
      ? 0
      : options.depth !== undefined
        ? options.depth
        : effectiveIncludeDeps === true
          ? 1
          : isZeroEnvelopeTarget || isFastPathSelector || isPassthrough
            ? 0
            : 1;
  const maxDepth = Math.max(0, effectiveDepth);
  const dependencies: DependencyContract[] = [];
  const depMap = new Map<string, DependencyContract>();
  const visitedFiles = new Set<string>([fullTargetPath]);

  interface QueueItem {
    filePath: string;
    currentDepth: number;
  }

  const queue: QueueItem[] = [{ filePath: fullTargetPath, currentDepth: 0 }];

  while (queue.length > 0) {
    const item = queue.shift()!;
    if (item.currentDepth >= maxDepth) {
      continue;
    }

    const imports = extractImportsFromFile(item.filePath);
    for (const imp of imports) {
      const specifier = imp.source;
      let importedSymbols = imp.specifiers.map((s) => s.name);

      // When symbol-scoped at depth 0, prune imported symbols/dependencies not referenced by the sliced symbol
      if (
        item.currentDepth === 0 &&
        options.symbol &&
        importedSymbols.length > 0 &&
        !importedSymbols.includes("*")
      ) {
        const usedSpecs = imp.specifiers.filter((s) => {
          const localIdent = s.alias ?? s.name;
          const esc = localIdent.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
          return new RegExp(`\\b${esc}\\b`).test(targetContent);
        });
        if (usedSpecs.length === 0) {
          continue;
        }
        importedSymbols = usedSpecs.map((s) => s.name);
      }

      const resolvedPath = resolveImportPath(item.filePath, specifier, config, projectRoot);
      const isExternal = !resolvedPath && isExternalSpecifier(specifier);

      // Skip circular back-reference to the target file itself
      if (resolvedPath) {
        const canonicalResolved = path.resolve(resolvedPath);
        const canonicalTarget = path.resolve(fullTargetPath);
        if (
          canonicalResolved === canonicalTarget ||
          canonicalResolved.replace(/\.aice$/, "") === canonicalTarget.replace(/\.aice$/, "")
        ) {
          continue;
        }
      }

      const key = isExternal
        ? `ext:${specifier}`
        : resolvedPath
          ? `res:${path.resolve(resolvedPath)}`
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
          } else if (resolvedPath) {
            existing.contract = extractExportedContract(resolvedPath, existing.importedSymbols);
          }
        }
      } else {
        let contract: string;
        let displayDepPath: string | undefined;

        if (isExternal) {
          contract = generateExternalContract(specifier, importedSymbols);
        } else if (resolvedPath) {
          displayDepPath = formatDisplayPath(resolvedPath, projectRoot);
          contract = extractExportedContract(resolvedPath, importedSymbols);
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

        if (resolvedPath && !visitedFiles.has(resolvedPath)) {
          visitedFiles.add(resolvedPath);
          if (item.currentDepth + 1 < maxDepth) {
            queue.push({
              filePath: resolvedPath,
              currentDepth: item.currentDepth + 1,
            });
          }
        }
      }
    }
  }

  // Caller lookup (skip by default on zero-envelope fast-path unless --callers is passed)
  const shouldScanCallers =
    effectiveIncludeCallers !== undefined
      ? effectiveIncludeCallers
      : !isZeroEnvelopeTarget && !isFastPathSelector && !isDataOrDocExt && !isPassthrough;
  const callers: CallerSummary[] = shouldScanCallers
    ? scanWorkspaceCallers(
        fullTargetPath,
        projectRoot,
        config,
        options.symbol,
        options.workspaceScanCache,
      )
    : [];

  // Target body selection
  let targetBody = options.outlineTarget ? targetOutline : targetContent;
  if (
    !effectiveRawNative &&
    !isZeroEnvelopeTarget &&
    !options.outlineTarget &&
    !options.symbol &&
    options.maxTokens === undefined
  ) {
    const actionableSyms = outlineRes.symbols.filter((s) => s.kind !== "import" && s.lineRange);
    if (actionableSyms.length > 0 && !/\[L\d+-L\d+\]/.test(targetBody)) {
      const rangeSummary = actionableSyms
        .slice(0, 12)
        .map((s) => `${s.name} ${s.lineRange}`)
        .join(", ");
      const moreSuffix =
        actionableSyms.length > 12 ? `, (+${actionableSyms.length - 12} more)` : "";
      targetBody = `// line-ranges: ${rangeSummary}${moreSuffix}\n${targetBody}`;
    }
  }

  const isNonAstTarget =
    isPassthrough ||
    ["yaml", "json", "markdown", "shell", "powershell", "batch"].includes(targetOrPassthrough) ||
    /\.(?:ya?ml|cff|jsonc?|md|markdown|sh|bash|zsh|ps1|cmd|bat)$/i.test(displayTargetPath);

  let bundleIdioms: Record<string, ProjectIdiomDefinition> | undefined;
  if (activeIdioms && Object.keys(activeIdioms).length > 0) {
    const usedIdioms: Record<string, ProjectIdiomDefinition> = {};
    for (const [k, def] of Object.entries(activeIdioms)) {
      const normName = (def.name || k).startsWith("$") ? def.name || k : `$${def.name || k}`;
      if (targetBody.includes(normName)) {
        usedIdioms[k] = def;
      }
    }
    const usedCount = Object.keys(usedIdioms).length;
    if (isNonAstTarget) {
      bundleIdioms = usedCount > 0 ? usedIdioms : undefined;
    } else {
      const isExplicitOrWholeFile =
        !options.symbol || options.idioms === true || options.symbol?.trim() === "*";
      if (isExplicitOrWholeFile) {
        const combined: Record<string, ProjectIdiomDefinition> = { ...usedIdioms };
        let count = Object.keys(combined).length;
        for (const [k, def] of Object.entries(activeIdioms)) {
          if (count >= 15) break;
          if (!combined[k]) {
            combined[k] = def;
            count++;
          }
        }
        bundleIdioms = combined;
      } else if (usedCount > 0) {
        bundleIdioms = usedIdioms;
      } else {
        bundleIdioms = undefined;
      }
    }
  }

  const useMinimalEnvelope =
    !hasExplicitEnvelopeOptIn &&
    dependencies.length === 0 &&
    callers.length === 0 &&
    (isZeroEnvelopeTarget ||
      ((!bundleIdioms || Object.keys(bundleIdioms).length === 0) && Boolean(options.symbol)));
  const bundleFormatOpts = {
    minimalEnvelope: useMinimalEnvelope,
    symbolSelector: options.symbol,
    compactMode: effectiveRawNative || isCliOrMcp,
  };
  // Build formatted bundle
  let formattedBundle = formatBundle(
    displayTargetPath,
    targetBody,
    dependencies,
    callers,
    bundleIdioms,
    nativeDiagnostics,
    bundleFormatOpts,
  );
  let tokenCount = estimateTokens(formattedBundle);

  // Bounding / Truncation with maxTokens
  if (options.maxTokens !== undefined && tokenCount > options.maxTokens) {
    if (!options.outlineTarget && targetOutline) {
      targetBody = targetOutline;
      formattedBundle = formatBundle(
        displayTargetPath,
        targetBody,
        dependencies,
        callers,
        bundleIdioms,
        nativeDiagnostics,
        bundleFormatOpts,
      );
      tokenCount = estimateTokens(formattedBundle);
    }

    if (tokenCount > options.maxTokens) {
      const bodyLines = targetBody.split("\n");
      while (bodyLines.length > 1 && tokenCount > options.maxTokens) {
        const cutCount = Math.max(1, Math.floor(bodyLines.length * 0.2));
        bodyLines.splice(bodyLines.length - cutCount, cutCount);
        const truncatedNotice = `// ... [truncated: exceeded maxTokens limit of ${options.maxTokens}]`;
        targetBody = [...bodyLines, truncatedNotice].join("\n");
        formattedBundle = formatBundle(
          displayTargetPath,
          targetBody,
          dependencies,
          callers,
          bundleIdioms,
          nativeDiagnostics,
          bundleFormatOpts,
        );
        tokenCount = estimateTokens(formattedBundle);
      }

      if (tokenCount > options.maxTokens) {
        let chars = formattedBundle.length;
        const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
        while (
          chars > 0 &&
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) > options.maxTokens
        ) {
          chars = Math.floor(chars * 0.7);
        }
        if (
          estimateTokens(formattedBundle.slice(0, chars) + truncatedFooter) <= options.maxTokens
        ) {
          formattedBundle = (chars > 0 ? formattedBundle.slice(0, chars) : "") + truncatedFooter;
        } else {
          formattedBundle = truncatedFooter;
          while (
            formattedBundle.length > 0 &&
            estimateTokens(formattedBundle) > options.maxTokens
          ) {
            formattedBundle = formattedBundle.slice(0, -1);
          }
        }
        tokenCount = estimateTokens(formattedBundle);
      }
    }
  }

  const resObj: ContextResult = {
    targetPath: displayTargetPath,
    targetContent,
    targetOutline,
    dependencies,
    callers,
    formattedBundle,
    tokenCount,
    idioms: bundleIdioms,
    nativeDiagnostics,
    ...(zeroIdiomsReason ? { zeroIdiomsReason } : {}),
  };

  const realisticBaselineText = computeHonestReadBaselineText({
    rawSource: rawFileContent,
    relPath: displayTargetPath,
    symbolSelector: options.symbol,
    mode: isPureRegexSymbol ? "search" : options.symbol ? "slice" : "file",
    includeToolWrapper: false,
  });
  const cleanResTargetContent = targetContent
    .replace(/^\/\/ @preformatted\n/, "")
    .replace(/^\/\/ @span:[^\n]+\n/, "");
  resObj.targetContent = cleanResTargetContent;

  const fullNatTok = estimateTokens(rawFileContent, "cl100k_base");
  const realNatTok = Math.min(fullNatTok, estimateTokens(realisticBaselineText, "cl100k_base"));
  recordTelemetryEvent({
    targetPath: fullTargetPath,
    projectRoot,
    operation: "context",
    surface: options.surface ?? "cli",
    idiomsUsed: Boolean(bundleIdioms && Object.keys(bundleIdioms).length > 0),
    isSearchMode: isPureRegexSymbol,
    nativeText: rawFileContent,
    nativeCl100k: fullNatTok,
    realisticNativeText: realisticBaselineText,
    realisticNativeCl100k: realNatTok,
    aiceText: options.json ? JSON.stringify(resObj, null, 2) : formattedBundle,
  });
  return resObj;
}

export const packContext = generateContext;

export const packageContext = generateContext;

export async function generateMultiContext(
  targets: Array<string | { path: string; symbol?: string }>,
  options: ContextOptions = {},
): Promise<ContextResult & { results: ContextResult[] }> {
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const individualResults: ContextResult[] = [];
  const sharedScanCache: WorkspaceCallerScanCache = options.workspaceScanCache ?? {
    filesByRoot: new Map(),
    fileContentByPath: new Map(),
    importsByPath: new Map(),
    idiomScanByRoot: new Map(),
  };
  if (!sharedScanCache.idiomScanByRoot) {
    sharedScanCache.idiomScanByRoot = new Map();
  }

  let firstResolvedPath = "";
  let firstProjectRoot = baseDir;
  let totalNativeChars = 0;
  let totalNativeCl100k = 0;
  let totalNativeO200k = 0;
  const suppressIndividualTelemetry = targets.length > 1;
  const skippedSymbolErrors: unknown[] = [];
  const resolvedMultiFiles: string[] = [];

  for (let idx = 0; idx < targets.length; idx++) {
    const item = targets[idx]!;
    const rawStr = typeof item === "string" ? item : item.path;
    const explicitSym = typeof item === "string" ? undefined : item.symbol;
    const parsed = parseTargetWithInlineSymbol(rawStr, baseDir);
    const preResolved = resolveEffectiveTargetAndRoot(parsed.targetPath, options.projectRoot);
    const resolved = resolvePathTargets(preResolved.targetPath, {
      includeTargets: true,
      projectRoot: preResolved.projectRoot,
    });
    if (!isProjectAiceEnabled(resolved.config)) {
      throw new Error(AICE_DISABLED_MESSAGE);
    }
    if (!firstResolvedPath) {
      firstResolvedPath = resolved.resolvedPath;
      firstProjectRoot = resolved.projectRoot;
    }
    const usesSharedSymbol = !explicitSym && !parsed.inlineSymbol && Boolean(options.symbol);
    const itemOpts: ContextOptions = {
      ...options,
      symbol: explicitSym ?? parsed.inlineSymbol ?? options.symbol,
      allowPartialSymbolMatch: options.allowPartialSymbolMatch ?? targets.length > 1,
      projectRoot: resolved.projectRoot,
      workspaceScanCache: sharedScanCache,
      _isMultiTarget: targets.length > 1,
    };
    try {
      const res = suppressIndividualTelemetry
        ? await withSuppressedTelemetryAsync(() => generateContext(resolved.resolvedPath, itemOpts))
        : await generateContext(resolved.resolvedPath, itemOpts);
      individualResults.push(res);
      if (!resolved.isDirectory) {
        resolvedMultiFiles.push(resolved.resolvedPath);
      }
    } catch (err) {
      if (
        targets.length > 1 &&
        usesSharedSymbol &&
        err instanceof Error &&
        /Symbol .+ not found in /i.test(err.message)
      ) {
        skippedSymbolErrors.push(err);
        continue;
      }
      throw err;
    }

    if (suppressIndividualTelemetry) {
      try {
        if (fs.existsSync(resolved.resolvedPath) && fs.statSync(resolved.resolvedPath).isFile()) {
          const rawText = fs.readFileSync(resolved.resolvedPath, "utf-8");
          const relDisplay = formatDisplayPath(resolved.resolvedPath, resolved.projectRoot);
          const itemBaseline = computeHonestReadBaselineText({
            rawSource: rawText,
            relPath: relDisplay,
            symbolSelector: itemOpts.symbol,
            includeToolWrapper: false,
          });
          totalNativeChars += itemBaseline.length + (idx > 0 && itemBaseline.length > 0 ? 2 : 0);
          totalNativeCl100k += estimateTokens(itemBaseline, "cl100k_base");
          totalNativeO200k += estimateTokens(itemBaseline, "o200k_base");
        }
      } catch {
        // ignore unreadable target
      }
    }
  }

  if (individualResults.length === 0 && skippedSymbolErrors.length > 0) {
    throw skippedSymbolErrors[0];
  }

  // Reconcile shared multi-symbol `-s "symA,symB"` across multiple files:
  // strip per-file `// missing: X` for any X that was resolved in another target in the batch.
  if (options.symbol && individualResults.length > 0 && targets.length > 1) {
    const sharedRequested = splitSymbolSelectors(options.symbol)
      .map((s) => s.trim())
      .filter(Boolean);
    if (sharedRequested.length > 1) {
      const missingCountBySym = new Map<string, number>();
      for (const res of individualResults) {
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
        if (count >= individualResults.length) {
          globallyMissing.add(sym);
        }
      }
      let emittedGlobalMissing = false;
      for (let i = 0; i < individualResults.length; i++) {
        const res = individualResults[i]!;
        if (!/^\/\/ missing:\s*(.+)$/m.test(res.targetContent)) continue;
        const updateMissingLine = (text: string, isLastResult: boolean): string =>
          text.replace(/\n*\/\/ missing:\s*(.+)$/m, (_full, rawList: string) => {
            if (!isLastResult || emittedGlobalMissing) return "";
            const kept = rawList
              .split(",")
              .map((s) => s.trim())
              .filter((s) => globallyMissing.has(s));
            if (kept.length === 0) return "";
            emittedGlobalMissing = true;
            return `\n\n// missing: ${kept.join(", ")}`;
          });
        const isLast = i === individualResults.length - 1;
        res.targetContent = updateMissingLine(res.targetContent, isLast);
        res.formattedBundle = updateMissingLine(res.formattedBundle, isLast);
      }
    }
  }

  const merged = mergeMultiContextResults(individualResults, options);
  if (suppressIndividualTelemetry && individualResults.length > 1 && firstResolvedPath) {
    const aicePayload = options.json ? JSON.stringify(merged, null, 2) : merged.formattedBundle;
    const multiFiles = Array.from(
      new Set(
        resolvedMultiFiles
          .map((f) => {
            const rel = path.relative(firstProjectRoot, f).replace(/\\/g, "/");
            return rel && !rel.startsWith("..") ? rel : f;
          })
          .filter(Boolean),
      ),
    );
    const isMultiRegexSearch = Boolean(options.symbol && isPureRegexSymbolString(options.symbol));
    recordTelemetryEvent({
      targetPath: firstResolvedPath,
      projectRoot: firstProjectRoot,
      filePath: "<multi-context>",
      multiFiles: multiFiles.length > 0 ? multiFiles : undefined,
      operation: "context",
      surface: options.surface ?? "cli",
      idiomsUsed: Boolean(merged.idioms && Object.keys(merged.idioms).length > 0),
      isSearchMode: isMultiRegexSearch,
      nativeText: "",
      nativeChars: totalNativeChars,
      nativeCl100k: totalNativeCl100k,
      nativeO200k: totalNativeO200k,
      realisticNativeCl100k: totalNativeCl100k,
      aiceText: aicePayload,
      aiceCl100k: merged.tokenCount,
    });
  }
  return merged;
}
