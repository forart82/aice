/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Inclusive :L line-range splice resolution and off-by-one half-open range safety guards.
 */

import * as path from "node:path";
import type { ProjectIdiomDefinition } from "../../config/index.js";
import type { TargetLanguage } from "../../emitters/index.js";
import { isCommentLine } from "../context.js";
import { checkPythonDuplicateParams, extractInlineIdiomsFromSource } from "../create.js";
import { maskSourceLexically, preprocessHybridAndIdiomsLossless } from "../preprocessor.js";
import { validateNativeSyntax } from "../syntax-validator.js";
import {
  applyHunksToScope,
  buildEmptySpliceBlockError,
  containsHunkMarkers,
  extractHunkBlocks,
  formatSurroundingNumberedContext,
} from "./hunks.js";
import { isPassthroughSpliceFile } from "./stream-parser.js";
import type { ResolvedNativeEdit, SpliceOptions } from "./types.js";

const LINE_ASSIGNMENT_LHS_RE =
  /^\s*(?:(?:let|mut|const|var)\s+)?([A-Za-z_]\w*(?:\.[A-Za-z_]\w*)*)\s*(?::[^=]+)?=(?!=)/;

function extractAssignmentLhsTarget(line: string): string | null {
  const match = LINE_ASSIGNMENT_LHS_RE.exec(line);
  return match?.[1] ?? null;
}

function formatSpliceDisplayPath(filePath: string, projectRoot?: string): string {
  if (!path.isAbsolute(filePath)) {
    return filePath.replace(/\\/g, "/");
  }
  const baseRoot = projectRoot ? path.resolve(projectRoot) : process.cwd();
  const rel = path.relative(baseRoot, filePath).replace(/\\/g, "/");
  if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel;
  }
  const relCwd = path.relative(process.cwd(), filePath).replace(/\\/g, "/");
  if (relCwd && !relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    return relCwd;
  }
  return filePath;
}

/**
 * Guards raw inclusive `:L<start>-L<end>` replacements against Python-style `[start, end)`
 * off-by-one payloads where `endLine - startLine` replacement lines match `L<start>..L<end-1>`
 * assignment LHS targets 1-for-1 and would silently delete a distinct code line at `L<end>`.
 */
function guardHalfOpenInclusiveLineRangeSplice(params: {
  rawLines: string[];
  startLine: number;
  endLine: number;
  replContent: string;
  filePath: string;
  projectRoot?: string;
}): void {
  const { rawLines, startLine, endLine, replContent, filePath, projectRoot } = params;
  const origSpan = endLine - startLine + 1;
  if (origSpan < 4) return;

  const trimmedTrailingRepl = replContent.replace(/\r?\n$/, "");
  const replLines = trimmedTrailingRepl.split(/\r?\n/);
  if (replLines.length !== origSpan - 1) return;

  const origLines = rawLines.slice(startLine - 1, endLine);
  if (origLines.length !== origSpan) return;

  let lastMatchedReplLhs: string | null = null;
  for (let k = 0; k < origSpan - 1; k++) {
    const origLhs = extractAssignmentLhsTarget(origLines[k] ?? "");
    const replLhs = extractAssignmentLhsTarget(replLines[k] ?? "");
    if (origLhs === null || replLhs === null || origLhs !== replLhs) {
      return;
    }
    lastMatchedReplLhs = replLhs;
  }

  const origLastLine = origLines[origSpan - 1] ?? "";
  const origLastTrimmed = origLastLine.trim();
  if (!origLastTrimmed || isCommentLine(origLastLine, filePath)) {
    return;
  }

  const origLastLhs = extractAssignmentLhsTarget(origLastLine);
  if (origLastLhs !== null) {
    if (origLastLhs === lastMatchedReplLhs) {
      return;
    }
    const escLhs = origLastLhs.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const lhsUseRe = new RegExp(`(?<![A-Za-z0-9_.])${escLhs}(?![A-Za-z0-9_])`);
    const lookaheadSlice = rawLines
      .slice(endLine, Math.min(rawLines.length, endLine + 15))
      .join("\n");
    if (!lhsUseRe.test(lookaheadSlice)) {
      return;
    }
  }

  const displayPath = formatSpliceDisplayPath(filePath, projectRoot);
  throw new Error(
    `Off-by-one inclusive line-range guard on ${displayPath}:L${startLine}-L${endLine}: replacement has ${replLines.length} lines matching L${startLine}-L${endLine - 1} 1-for-1, which would silently delete L${endLine} ('${origLastTrimmed}'). AICE :L ranges are INCLUSIVE — use :L${startLine}-L${endLine - 1} to keep L${endLine}, or <<< search === replace >>> if deleting L${endLine} is intentional.`,
  );
}

export function resolveLineRangeNativeEdit(
  nativeSource: string,
  options: SpliceOptions,
  anchorSymbol: string,
  rawSnippet: string,
  lineRangeMatch: RegExpMatchArray,
  filePath: string,
  targetLang: TargetLanguage,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
): ResolvedNativeEdit {
  const startLine = parseInt(lineRangeMatch[1], 10);
  let endLine = lineRangeMatch[2] ? parseInt(lineRangeMatch[2], 10) : startLine;

  const rawLines = nativeSource.split(/\r?\n/);
  const totalLines = rawLines.length;

  if (startLine > totalLines) {
    throw new Error(
      `Invalid line range L${startLine}-L${endLine}: file only has ${totalLines} line(s). To append to the end of the file, use ':eof' or ':append'.`,
    );
  }
  if (endLine > totalLines) {
    endLine = totalLines;
  }

  if (startLine < 1 || startLine > endLine) {
    throw new Error(
      `Invalid line range L${startLine}-L${endLine}: file has ${totalLines} line(s) (1-based inclusive)`,
    );
  }
  const lineStarts: number[] = [0];
  for (let i = 0; i < nativeSource.length; i++) {
    if (nativeSource[i] === "\n") {
      lineStarts.push(i + 1);
    }
  }

  const startOffset = lineStarts[startLine - 1];
  const endOffset = endLine < lineStarts.length ? lineStarts[endLine] : nativeSource.length;
  const originalSnippet = nativeSource.slice(startOffset, endOffset);

  if (options.delete) {
    let delStart = startOffset;
    const delEnd = endOffset;
    if (endLine >= lineStarts.length && startOffset > 0) {
      if (startOffset >= 2 && nativeSource[startOffset - 2] === "\r") {
        delStart = startOffset - 2;
      } else {
        delStart = startOffset - 1;
      }
    }
    return {
      symbol: anchorSymbol,
      startOffset: delStart,
      endOffset: delEnd,
      replacement: "",
      originalSnippet,
      newSnippet: "",
    };
  }

  const hunkIdiomsActive =
    options.idioms !== false &&
    (options.idioms === true || Boolean(idioms && Object.keys(idioms).length > 0));
  if (containsHunkMarkers(rawSnippet)) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      try {
        const updatedRange = applyHunksToScope(
          originalSnippet,
          hunks,
          anchorSymbol,
          filePath,
          targetLang,
          idioms,
          hunkIdiomsActive,
          false,
          startLine,
          { nativeSource, scopeStartOffset: startOffset, scopeEndOffset: endOffset },
        );
        return {
          symbol: anchorSymbol,
          startOffset,
          endOffset,
          replacement: updatedRange,
          originalSnippet,
          newSnippet: updatedRange,
        };
      } catch {
        const winStartLine = Math.max(1, startLine - 40);
        const winEndLine = Math.min(totalLines, endLine + 40);
        const winStartOff = lineStarts[winStartLine - 1];
        const winEndOff =
          winEndLine < lineStarts.length ? lineStarts[winEndLine] : nativeSource.length;
        const winSlice = nativeSource.slice(winStartOff, winEndOff);
        const updatedWin = applyHunksToScope(
          winSlice,
          hunks,
          anchorSymbol,
          filePath,
          targetLang,
          idioms,
          hunkIdiomsActive,
          false,
          winStartLine,
          {
            nativeSource,
            scopeStartOffset: winStartOff ?? 0,
            scopeEndOffset: winEndOff ?? nativeSource.length,
          },
        );
        return {
          symbol: anchorSymbol,
          startOffset: winStartOff,
          endOffset: winEndOff,
          replacement: updatedWin,
          originalSnippet: winSlice,
          newSnippet: updatedWin,
        };
      }
    }
  }

  if (!rawSnippet.trim()) {
    throw buildEmptySpliceBlockError(filePath, anchorSymbol, "splicing line range");
  }

  const skipRangePreprocessor =
    options.idioms === false ||
    isPassthroughSpliceFile(filePath) ||
    targetLang === "markdown" ||
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "xml" ||
    targetLang === "java" ||
    targetLang === "text";
  const extractedRangeIdioms = skipRangePreprocessor
    ? { cleanedCode: rawSnippet, inlineIdioms: {} as Record<string, ProjectIdiomDefinition> }
    : extractInlineIdiomsFromSource(rawSnippet);
  const mergedRangeIdioms =
    Object.keys(extractedRangeIdioms.inlineIdioms).length > 0
      ? { ...(idioms ?? {}), ...extractedRangeIdioms.inlineIdioms }
      : idioms;
  const baseProcessed = skipRangePreprocessor
    ? rawSnippet
    : preprocessHybridAndIdiomsLossless(
        extractedRangeIdioms.cleanedCode,
        targetLang,
        mergedRangeIdioms,
      );
  const isCrLf =
    (endOffset > 0 && nativeSource.slice(0, endOffset).endsWith("\r\n")) ||
    nativeSource.includes("\r\n");
  const nl = isCrLf ? "\r\n" : "\n";

  const buildRangeReplacement = (candStartLine: number, candEndLine: number): string => {
    let rep = baseProcessed;
    const candFirstLine = rawLines[candStartLine - 1] ?? "";
    const candIndent = candFirstLine.match(/^[ \t]*/)?.[0] ?? "";
    if (candIndent.length > 0) {
      const procLines = rep.split(/\r?\n/);
      if (procLines.length > 0 && procLines[0]!.length > 0 && !/^[ \t]/.test(procLines[0]!)) {
        rep = procLines.map((line) => (line.length > 0 ? `${candIndent}${line}` : line)).join("\n");
      }
    }
    if (isCrLf) {
      rep = rep.replace(/\r?\n/g, "\r\n");
    }
    if (candEndLine < lineStarts.length) {
      if (!rep.endsWith("\n") && !rep.endsWith("\r\n")) {
        rep += nl;
      }
    }
    return rep;
  };

  let processedCode = buildRangeReplacement(startLine, endLine);

  const isPassthroughRangeTarget = isPassthroughSpliceFile(filePath);
  const isNonBraceRangeLang =
    isPassthroughRangeTarget ||
    targetLang === "markdown" ||
    targetLang === "yaml" ||
    targetLang === "html" ||
    targetLang === "xml" ||
    targetLang === "twig" ||
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "text";
  const skipHalfOpenGuard = isNonBraceRangeLang || targetLang === "json" || targetLang === "css";

  if (!skipHalfOpenGuard) {
    guardHalfOpenInclusiveLineRangeSplice({
      rawLines,
      startLine,
      endLine,
      replContent: baseProcessed,
      filePath,
      projectRoot: options.projectRoot,
    });
  }

  let finalStartOffset = startOffset;
  let finalEndOffset = endOffset;
  let finalOriginalSnippet = originalSnippet;

  const countNetAndMinDelims = (
    s: string,
  ): { braces: number; parens: number; minBraces: number; minParens: number } => {
    if (isNonBraceRangeLang) return { braces: 0, parens: 0, minBraces: 0, minParens: 0 };
    const masked = maskSourceLexically(s, targetLang).maskedCode;
    let braces = 0;
    let parens = 0;
    let minBraces = 0;
    let minParens = 0;
    for (let i = 0; i < masked.length; i++) {
      const ch = masked[i];
      if (ch === "{") braces++;
      else if (ch === "}") {
        braces--;
        if (braces < minBraces) minBraces = braces;
      } else if (ch === "(") parens++;
      else if (ch === ")") {
        parens--;
        if (parens < minParens) minParens = parens;
      }
    }
    return { braces, parens, minBraces, minParens };
  };
  const countNetDelims = (s: string): { braces: number; parens: number } => {
    const stats = countNetAndMinDelims(s);
    return { braces: stats.braces, parens: stats.parens };
  };

  const literalCandidate = `${nativeSource.slice(0, startOffset)}${processedCode}${nativeSource.slice(endOffset)}`;
  const literalCheck = validateNativeSyntax(literalCandidate, targetLang, filePath, idioms);
  const origSyntaxValid = validateNativeSyntax(nativeSource, targetLang, filePath, idioms).valid;
  const origDelims = countNetDelims(originalSnippet);
  const procDelims = countNetDelims(processedCode);
  const hasExactDelimImbalance =
    !isNonBraceRangeLang &&
    !literalCheck.valid &&
    origSyntaxValid &&
    (origDelims.braces !== procDelims.braces || origDelims.parens !== procDelims.parens);
  const procLineList = processedCode.trim().split(/\r?\n/);
  const procTrimmedLines = procLineList.map((l) => l.trim());
  const procFirstTrim = procTrimmedLines[0] ?? "";
  const procLastTrim = procTrimmedLines[procTrimmedLines.length - 1] ?? "";
  const alreadyAnchoredAtStart =
    procFirstTrim.length >= 6 && rawLines[startLine - 1]?.trim() === procFirstTrim;
  const alreadyAnchoredAtEnd =
    procLastTrim.length >= 6 && rawLines[endLine - 1]?.trim() === procLastTrim;

  let ambiguousAlignmentNote = "";
  let autoAligned = false;

  if (endLine > startLine && procLineList.length >= 2) {
    const halfOpenEndLine = endLine - 1;
    const firstOrigTrim = (rawLines[startLine - 1] ?? "").trim();
    const endOrigTrim = (rawLines[endLine - 1] ?? "").trim();
    const prevEndOrigTrim = (rawLines[halfOpenEndLine - 1] ?? "").trim();
    const startMatchesVerbatim = firstOrigTrim.length >= 3 && firstOrigTrim === procFirstTrim;
    const prevEndMatchesVerbatim =
      prevEndOrigTrim.length >= 3 &&
      prevEndOrigTrim === procLastTrim &&
      endOrigTrim !== procLastTrim;
    const trailingDocCommentBleed =
      startMatchesVerbatim &&
      /^[ \t]+/.test(rawLines[startLine - 1] ?? "") &&
      prevEndOrigTrim === "" &&
      /^(?:\/\/\/|\/\*\*)/.test(endOrigTrim) &&
      !/^(?:\/\/\/|\/\*\*)/m.test(processedCode);

    if (startMatchesVerbatim && (prevEndMatchesVerbatim || trailingDocCommentBleed)) {
      const candEndOff =
        halfOpenEndLine < lineStarts.length
          ? (lineStarts[halfOpenEndLine] ?? nativeSource.length)
          : nativeSource.length;
      const candSlice = nativeSource.slice(startOffset, candEndOff);
      const candRep = buildRangeReplacement(startLine, halfOpenEndLine);
      const candDelims = countNetAndMinDelims(candSlice);
      const candRepDelims = countNetAndMinDelims(candRep);
      if (
        candRep.trim() !== candSlice.trim() &&
        candDelims.braces === candRepDelims.braces &&
        candDelims.parens === candRepDelims.parens &&
        candDelims.minBraces >= candRepDelims.minBraces &&
        candDelims.minParens >= candRepDelims.minParens &&
        validateNativeSyntax(
          `${nativeSource.slice(0, startOffset)}${candRep}${nativeSource.slice(candEndOff)}`,
          targetLang,
          filePath,
          idioms,
        ).valid
      ) {
        finalEndOffset = candEndOff;
        finalOriginalSnippet = candSlice;
        processedCode = candRep;
        autoAligned = true;
      }
    }
  }

  const hasShiftedClosingTailAnchor =
    !isNonBraceRangeLang &&
    !alreadyAnchoredAtStart &&
    procFirstTrim.length >= 8 &&
    procLastTrim.length > 0 &&
    procDelims.braces <= 0 &&
    procDelims.parens <= 0 &&
    rawLines
      .slice(Math.max(0, startLine - 5), Math.min(rawLines.length, startLine + 4))
      .some((l) => l.trim() === procFirstTrim) &&
    rawLines
      .slice(Math.max(0, endLine - 4), Math.min(rawLines.length, endLine + 5))
      .some((l) => l.trim() === procLastTrim);

  const isUnbalancedReplacementOnBalancedSpan =
    !isNonBraceRangeLang &&
    origDelims.braces === 0 &&
    origDelims.parens === 0 &&
    (procDelims.braces !== 0 || procDelims.parens !== 0) &&
    !hasShiftedClosingTailAnchor;

  const extractSimilarityTokens = (text: string): Set<string> => {
    const toks = text.match(/[A-Za-z_$][A-Za-z0-9_$-]*|\d+/g) ?? [];
    return new Set(toks.map((t) => t.toLowerCase()));
  };
  const computeTokenJaccard = (a: string, b: string): number => {
    const trA = a.trim();
    const trB = b.trim();
    if (!trA && !trB) return 0;
    if (trA && trA === trB) return 1;
    const setA = extractSimilarityTokens(trA);
    const setB = extractSimilarityTokens(trB);
    if (setA.size === 0 || setB.size === 0) return 0;
    let inter = 0;
    for (const tok of setA) {
      if (setB.has(tok)) inter++;
    }
    const union = setA.size + setB.size - inter;
    return union > 0 ? inter / union : 0;
  };

  if (
    !autoAligned &&
    (!literalCheck.valid || hasExactDelimImbalance) &&
    !isUnbalancedReplacementOnBalancedSpan
  ) {
    const lineDelimsCache = new Map<number, { braces: number; parens: number }>();
    const getLineDelims = (lineNo: number): { braces: number; parens: number } => {
      const cached = lineDelimsCache.get(lineNo);
      if (cached) return cached;
      const computed = countNetDelims(rawLines[lineNo - 1] ?? "");
      lineDelimsCache.set(lineNo, computed);
      return computed;
    };
    const isPureDelimOrTriviaLine = (lineNo: number): boolean => {
      const masked = maskSourceLexically(rawLines[lineNo - 1] ?? "", targetLang).maskedCode;
      const stripped = masked.replace(/\uE000[\uE010-\uE019]+\uE002/g, "").trim();
      return !stripped || /^[\s{}()[\];,]*$/.test(stripped);
    };
    const isBlankOrCommentOrDelimLine = (lineNo: number): boolean => {
      if (isPureDelimOrTriviaLine(lineNo)) return true;
      const d = getLineDelims(lineNo);
      return d.braces !== 0 || d.parens !== 0;
    };

    const procTrimmedSet = new Set(procTrimmedLines.filter(Boolean));
    const isBalancedVerbatimInProc = (lineNo: number): boolean => {
      const lnTrim = (rawLines[lineNo - 1] ?? "").trim();
      if (!lnTrim || !procTrimmedSet.has(lnTrim)) return false;
      const d = getLineDelims(lineNo);
      return d.braces === 0 && d.parens === 0;
    };
    const countInternalBlockClosures = (linesArr: string[]): number => {
      if (isNonBraceRangeLang) return 0;
      let b = 0;
      let closuresBeforeEnd = 0;
      for (let idx = 0; idx < linesArr.length - 1; idx++) {
        const d = countNetDelims(linesArr[idx] ?? "");
        const prev = b;
        b += d.braces;
        if (prev > 0 && b === 0) closuresBeforeEnd++;
      }
      return closuresBeforeEnd;
    };

    const checkVerbatimBlockShift = (candStart: number, candEnd: number): boolean => {
      const candLen = candEnd - candStart + 1;
      if (candLen < 2 || procTrimmedLines.length < 2) return false;
      const candLinesTrim = rawLines.slice(candStart - 1, candEnd).map((l) => l.trim());
      const substantialCount = candLinesTrim.filter((l) => l.length >= 8).length;
      if (substantialCount === 0) return false;

      // Sub-case A: candStart..candEnd matches prefix, suffix, or prefix+suffix envelope of replacement verbatim
      if (candLen >= 3 && candLen < procTrimmedLines.length && substantialCount >= 2) {
        const matchesPrefix = candLinesTrim.every((l, i) => l === procTrimmedLines[i]);
        const matchesSuffix = candLinesTrim.every(
          (l, i) => l === procTrimmedLines[procTrimmedLines.length - candLen + i],
        );
        let matchesPrefixSuffixEnvelope = false;
        if (!matchesPrefix && !matchesSuffix) {
          let kPref = 0;
          while (kPref < candLen && candLinesTrim[kPref] === procTrimmedLines[kPref]) {
            kPref++;
          }
          let kSuf = 0;
          while (
            kSuf < candLen - kPref &&
            candLinesTrim[candLen - 1 - kSuf] ===
              procTrimmedLines[procTrimmedLines.length - 1 - kSuf]
          ) {
            kSuf++;
          }
          if (kPref >= 1 && kSuf >= 1 && kPref + kSuf === candLen) {
            matchesPrefixSuffixEnvelope = true;
          }
        }
        if (matchesPrefix || matchesSuffix || matchesPrefixSuffixEnvelope) {
          const winMin = Math.max(1, Math.min(startLine, candStart) - 20);
          const winMax = Math.min(totalLines - candLen + 1, Math.max(endLine, candEnd) + 20);
          let occurrences = 0;
          for (let s = winMin; s <= winMax; s++) {
            let eq = true;
            for (let k = 0; k < candLen; k++) {
              if ((rawLines[s - 1 + k] ?? "").trim() !== candLinesTrim[k]) {
                eq = false;
                break;
              }
            }
            if (eq) occurrences++;
          }
          if (occurrences === 1) return true;
        }
      }

      // Sub-case B: candStart & candEnd match replacement start & end anchors uniquely in ±20 window
      const penultProc = procTrimmedLines[procTrimmedLines.length - 2] ?? "";
      const secondProc = procTrimmedLines[1] ?? "";
      const startAnchorStrong =
        procFirstTrim.length >= 8
          ? candLinesTrim[0] === procFirstTrim
          : procFirstTrim.length > 0 &&
            secondProc.length >= 8 &&
            candLinesTrim[0] === procFirstTrim &&
            candLinesTrim[1] === secondProc;
      const endAnchorStrong =
        procLastTrim.length >= 8
          ? candLinesTrim[candLen - 1] === procLastTrim
          : procLastTrim.length > 0 &&
            penultProc.length >= 8 &&
            candLinesTrim[candLen - 2] === penultProc &&
            candLinesTrim[candLen - 1] === procLastTrim;
      const matchedSubstantialBodyCount = candLinesTrim.filter(
        (l) => l.length >= 8 && procTrimmedSet.has(l),
      ).length;
      const endMatchesWithSubstantialBody =
        procLastTrim.length > 0 &&
        candLinesTrim[candLen - 1] === procLastTrim &&
        matchedSubstantialBodyCount >= 2 &&
        countInternalBlockClosures(candLinesTrim) === countInternalBlockClosures(procTrimmedLines);
      if (
        startAnchorStrong &&
        (endAnchorStrong || endMatchesWithSubstantialBody) &&
        Math.abs(candLen - procTrimmedLines.length) <= 4
      ) {
        const winMin = Math.max(1, Math.min(startLine, candStart) - 20);
        const winMax = Math.min(totalLines, Math.max(endLine, candEnd) + 20);
        let startMatchesInWin = 0;
        for (let s = winMin; s <= winMax; s++) {
          if (procFirstTrim.length >= 8) {
            if ((rawLines[s - 1] ?? "").trim() === procFirstTrim) startMatchesInWin++;
          } else if (
            s < totalLines &&
            (rawLines[s - 1] ?? "").trim() === procFirstTrim &&
            (rawLines[s] ?? "").trim() === secondProc
          ) {
            startMatchesInWin++;
          }
        }
        if (startMatchesInWin === 1) return true;
      }
      return false;
    };

    const validBoundaryCandidates: Array<{
      candStart: number;
      candEnd: number;
      startOff: number;
      endOff: number;
      replacement: string;
      isVerbatimShift: boolean;
    }> = [];

    const MAX_BOUNDARY_DELTA = 4;
    for (let ds = -MAX_BOUNDARY_DELTA; ds <= MAX_BOUNDARY_DELTA; ds++) {
      for (let de = -MAX_BOUNDARY_DELTA; de <= MAX_BOUNDARY_DELTA; de++) {
        if (ds === 0 && de === 0) continue;
        const candStart = startLine + ds;
        const candEnd = endLine + de;
        if (candStart < 1 || candEnd > totalLines || candStart > candEnd) continue;

        const isVerbatimShift = checkVerbatimBlockShift(candStart, candEnd);

        if (!isVerbatimShift) {
          const overlapsTarget = Math.max(startLine, candStart) <= Math.min(endLine, candEnd);
          if (!overlapsTarget) {
            const isSingleLineShift = startLine === endLine && Math.abs(ds) <= 2 && ds === de;
            if (
              !isSingleLineShift ||
              procFirstTrim.length < 4 ||
              rawLines[candStart - 1]?.trim() !== procFirstTrim
            ) {
              continue;
            }
          }

          if (ds < 0) {
            if (alreadyAnchoredAtStart) continue;
            const outerD = getLineDelims(candStart);
            const outerMatchesHeader =
              procFirstTrim.length > 0 && rawLines[candStart - 1]?.trim() === procFirstTrim;
            let isCommaHeaderContinuation = false;
            if (!outerMatchesHeader && candStart < startLine) {
              let allComma = true;
              let openHeaderLn = candStart;
              while (
                openHeaderLn < startLine &&
                (rawLines[openHeaderLn - 1] ?? "").trim().endsWith(",")
              ) {
                openHeaderLn++;
              }
              if (openHeaderLn > candStart && openHeaderLn < startLine) {
                const hdrD = getLineDelims(openHeaderLn);
                if (hdrD.braces <= 0 && hdrD.parens <= 0) allComma = false;
                for (let ln = openHeaderLn + 1; ln < startLine; ln++) {
                  if (!isPureDelimOrTriviaLine(ln)) allComma = false;
                }
                if (allComma) isCommaHeaderContinuation = true;
              }
            }
            // Upward expansion must never cross a closing delimiter between candStart+1 and startLine-1
            // (nor steal a closing delimiter at candStart unless candStart itself matches procFirstTrim, e.g. "} else {")
            let crossesClosedSibling = false;
            for (let ln = outerMatchesHeader ? candStart + 1 : candStart; ln < startLine; ln++) {
              const d = getLineDelims(ln);
              if (d.braces < 0 || d.parens < 0) {
                crossesClosedSibling = true;
                break;
              }
            }
            if (crossesClosedSibling) continue;
            if (
              outerD.braces <= 0 &&
              outerD.parens <= 0 &&
              !outerMatchesHeader &&
              !isCommaHeaderContinuation
            ) {
              continue;
            }
            if (!isCommaHeaderContinuation) {
              let intermediatesClean = true;
              for (let ln = candStart + 1; ln < startLine; ln++) {
                if (outerMatchesHeader) {
                  if (!isPureDelimOrTriviaLine(ln) && !isBalancedVerbatimInProc(ln)) {
                    intermediatesClean = false;
                    break;
                  }
                } else if (
                  ds < -2 ? !isPureDelimOrTriviaLine(ln) : !isBlankOrCommentOrDelimLine(ln)
                ) {
                  intermediatesClean = false;
                  break;
                }
              }
              if (!intermediatesClean) continue;
            }
          } else if (ds > 0) {
            if (alreadyAnchoredAtStart) continue;
            const declHdrRe =
              /^(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|async\s+|static\s+)*(?:function|fn|func|fun|def|class|interface|struct|enum|type)\b/;
            if (
              declHdrRe.test((rawLines[startLine - 1] ?? "").trim()) &&
              declHdrRe.test(procFirstTrim) &&
              rawLines[candStart - 1]?.trim() !== procFirstTrim
            ) {
              continue;
            }
            const droppedOuterD = getLineDelims(startLine);
            const droppedOuterBlank = (rawLines[startLine - 1] ?? "").trim() === "";
            if (droppedOuterD.braces === 0 && droppedOuterD.parens === 0 && !droppedOuterBlank) {
              continue;
            }
            let anyDroppedDelim = false;
            let allDroppedClean = true;
            const newStartMatches =
              procFirstTrim.length > 0 && rawLines[candStart - 1]?.trim() === procFirstTrim;
            for (let ln = startLine; ln < candStart; ln++) {
              const d = getLineDelims(ln);
              if (d.braces !== 0 || d.parens !== 0) anyDroppedDelim = true;
              if (
                ds > 2 && !newStartMatches
                  ? !isPureDelimOrTriviaLine(ln)
                  : !isBlankOrCommentOrDelimLine(ln)
              ) {
                allDroppedClean = false;
              }
            }
            if (!allDroppedClean || (!anyDroppedDelim && !newStartMatches)) continue;
          }

          if (de > 0) {
            if (alreadyAnchoredAtEnd) continue;
            const outerEndD = getLineDelims(candEnd);
            const outerMatchesFooter =
              procLastTrim.length > 0 && rawLines[candEnd - 1]?.trim() === procLastTrim;
            if (!outerMatchesFooter) {
              // Downward expansion must never swallow an opening delimiter of the next block
              let stealsOpeningDelim = false;
              for (let ln = endLine + 1; ln <= candEnd; ln++) {
                const d = getLineDelims(ln);
                if (d.braces > 0 || d.parens > 0) {
                  stealsOpeningDelim = true;
                  break;
                }
              }
              if (stealsOpeningDelim) continue;
            }
            if (outerEndD.braces >= 0 && outerEndD.parens >= 0 && !outerMatchesFooter) {
              continue;
            }
            if (!outerMatchesFooter) {
              let intermediatesClean = true;
              for (let ln = endLine + 1; ln < candEnd; ln++) {
                if (!isPureDelimOrTriviaLine(ln)) {
                  intermediatesClean = false;
                  break;
                }
              }
              if (!intermediatesClean) continue;
            } else if (de > 1) {
              let intermediatesSafe = true;
              for (let ln = endLine + 1; ln < candEnd; ln++) {
                const d = getLineDelims(ln);
                if (
                  d.braces > 0 ||
                  d.parens > 0 ||
                  (!isBlankOrCommentOrDelimLine(ln) && !isBalancedVerbatimInProc(ln))
                ) {
                  intermediatesSafe = false;
                  break;
                }
              }
              if (!intermediatesSafe) continue;
            }
          } else if (de < 0) {
            if (alreadyAnchoredAtEnd) continue;
            const droppedEndD = getLineDelims(endLine);
            const droppedEndBlank = (rawLines[endLine - 1] ?? "").trim() === "";
            if (droppedEndD.braces === 0 && droppedEndD.parens === 0 && !droppedEndBlank) {
              continue;
            }
            let anyDroppedEndDelim = false;
            let allDroppedEndClean = true;
            const newEndMatches =
              procLastTrim.length > 0 && rawLines[candEnd - 1]?.trim() === procLastTrim;
            for (let ln = candEnd + 1; ln <= endLine; ln++) {
              const d = getLineDelims(ln);
              if (d.braces !== 0 || d.parens !== 0) anyDroppedEndDelim = true;
              if (
                de < -2 && !newEndMatches
                  ? !isPureDelimOrTriviaLine(ln)
                  : !isBlankOrCommentOrDelimLine(ln)
              ) {
                allDroppedEndClean = false;
              }
            }
            if (!allDroppedEndClean || (!anyDroppedEndDelim && !newEndMatches)) continue;
          }
        }

        const cStartOff = lineStarts[candStart - 1] ?? 0;
        const cEndOff =
          candEnd < lineStarts.length
            ? (lineStarts[candEnd] ?? nativeSource.length)
            : nativeSource.length;
        const candSlice = nativeSource.slice(cStartOff, cEndOff);
        const candRep = buildRangeReplacement(candStart, candEnd);
        const candDelims = countNetAndMinDelims(candSlice);
        const candRepDelims = countNetAndMinDelims(candRep);
        if (
          candDelims.braces !== candRepDelims.braces ||
          candDelims.parens !== candRepDelims.parens ||
          candDelims.minBraces < candRepDelims.minBraces ||
          candDelims.minParens < candRepDelims.minParens
        ) {
          continue;
        }

        if (candStart > 1 && procFirstTrim.length >= 4) {
          const prefixDelims = countNetDelims(nativeSource.slice(0, cStartOff));
          if (prefixDelims.braces > 0 && /^export\b/.test(procFirstTrim)) {
            continue;
          }
          let prevLn = candStart - 1;
          while (prevLn > 1 && (rawLines[prevLn - 1] ?? "").trim() === "") {
            prevLn--;
          }
          const prevTrim = (rawLines[prevLn - 1] ?? "").trim();
          const fnHdrRe =
            /^(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|async\s+|static\s+)*(?:function|fn|func|fun|def)\b/;
          if (
            getLineDelims(prevLn).braces > 0 &&
            (prevTrim === procFirstTrim || (fnHdrRe.test(prevTrim) && fnHdrRe.test(procFirstTrim)))
          ) {
            continue;
          }
        }

        const testModified = `${nativeSource.slice(0, cStartOff)}${candRep}${nativeSource.slice(cEndOff)}`;
        if (!validateNativeSyntax(testModified, targetLang, filePath, idioms).valid) {
          continue;
        }
        if (targetLang === "python" && checkPythonDuplicateParams(testModified)) {
          continue;
        }

        validBoundaryCandidates.push({
          candStart,
          candEnd,
          startOff: cStartOff,
          endOff: cEndOff,
          replacement: candRep,
          isVerbatimShift,
        });
      }
    }

    const prunedCandidates = validBoundaryCandidates.filter(
      (cand) =>
        !validBoundaryCandidates.some(
          (inner) =>
            inner !== cand &&
            cand.candStart < Math.min(startLine, inner.candStart) &&
            cand.candEnd > Math.max(endLine, inner.candEnd),
        ),
    );

    if (prunedCandidates.length === 1 && prunedCandidates[0]) {
      const aligned = prunedCandidates[0];
      finalStartOffset = aligned.startOff;
      finalEndOffset = aligned.endOff;
      finalOriginalSnippet = nativeSource.slice(aligned.startOff, aligned.endOff);
      processedCode = aligned.replacement;
      autoAligned = true;
    } else if (prunedCandidates.length > 1) {
      const procTokSet = extractSimilarityTokens(processedCode);
      const scoreCandidate = (cand: (typeof prunedCandidates)[number]): number => {
        let score = 0;
        if (cand.isVerbatimShift) score += 80;

        const candFirstTrim = (rawLines[cand.candStart - 1] ?? "").trim();
        const candLastTrim = (rawLines[cand.candEnd - 1] ?? "").trim();

        if (procFirstTrim && candFirstTrim === procFirstTrim) {
          score += procFirstTrim.length >= 4 ? 45 : 30;
        } else {
          score += computeTokenJaccard(candFirstTrim, procFirstTrim) * 20;
        }
        if (candFirstTrim === "" && procFirstTrim !== "") {
          score -= 12;
        }

        if (procLastTrim && candLastTrim === procLastTrim) {
          score += procLastTrim.length >= 4 ? 45 : 30;
        } else {
          score += computeTokenJaccard(candLastTrim, procLastTrim) * 20;
        }
        if (candLastTrim === "" && procLastTrim !== "") {
          score -= 12;
        }

        // Reward delimiter-only boundary restoration and preserving adjacent opening headers
        if (cand.candStart > startLine) {
          let allPure = true;
          let restoresClosing = false;
          for (let ln = startLine; ln < cand.candStart; ln++) {
            if (!isPureDelimOrTriviaLine(ln)) allPure = false;
            const d = getLineDelims(ln);
            if (d.braces < 0 || d.parens < 0) restoresClosing = true;
          }
          if (allPure) score += 20;
          if (restoresClosing) score += 15;
        } else if (cand.candStart < startLine && !cand.isVerbatimShift) {
          for (let ln = cand.candStart; ln < startLine; ln++) {
            if (isPureDelimOrTriviaLine(ln)) continue;
            const lnTrim = (rawLines[ln - 1] ?? "").trim();
            if (lnTrim === procFirstTrim) continue;
            const lnToks = extractSimilarityTokens(lnTrim);
            let hasOverlap = false;
            for (const t of lnToks) {
              if (procTokSet.has(t)) {
                hasOverlap = true;
                break;
              }
            }
            if (!hasOverlap && lnToks.size > 0) score -= 15;
          }
        }

        if (cand.candEnd < endLine) {
          let allPure = true;
          let restoresAdjacentHeader = false;
          for (let ln = cand.candEnd + 1; ln <= endLine; ln++) {
            if (!isPureDelimOrTriviaLine(ln)) allPure = false;
            const d = getLineDelims(ln);
            if (d.braces > 0 || d.parens > 0) {
              const lnToks = extractSimilarityTokens(rawLines[ln - 1] ?? "");
              let allInProc = lnToks.size > 0;
              for (const t of lnToks) {
                if (!procTokSet.has(t)) {
                  allInProc = false;
                  break;
                }
              }
              if (!allInProc) restoresAdjacentHeader = true;
            }
          }
          if (allPure) score += 25;
          if (restoresAdjacentHeader) score += 25;
        } else if (cand.candEnd > endLine && !cand.isVerbatimShift) {
          for (let ln = endLine + 1; ln <= cand.candEnd; ln++) {
            if (isPureDelimOrTriviaLine(ln)) continue;
            const lnTrim = (rawLines[ln - 1] ?? "").trim();
            if (lnTrim === procLastTrim) continue;
            const lnToks = extractSimilarityTokens(lnTrim);
            let hasOverlap = false;
            for (const t of lnToks) {
              if (procTokSet.has(t)) {
                hasOverlap = true;
                break;
              }
            }
            if (!hasOverlap && lnToks.size > 0) score -= 20;
          }
        }

        // Penalize leaving a dangling top-level selector/argument comma right before candStart
        if (cand.candStart > 1) {
          const prevMasked = maskSourceLexically(
            rawLines[cand.candStart - 2] ?? "",
            targetLang,
          ).maskedCode.trim();
          if (prevMasked.endsWith(",")) {
            const prefixD = countNetDelims(nativeSource.slice(0, cand.startOff));
            if (
              prefixD.braces === 0 &&
              prefixD.parens === 0 &&
              getLineDelims(cand.candStart).braces > 0
            ) {
              score -= 35;
            }
          }
        }

        const candSlice = nativeSource.slice(cand.startOff, cand.endOff);
        score += computeTokenJaccard(candSlice, cand.replacement) * 15;
        score -= (Math.abs(cand.candStart - startLine) + Math.abs(cand.candEnd - endLine)) * 1.5;
        return score;
      };

      const isPureDelimOnlyAdjustment = (cand: (typeof prunedCandidates)[number]): boolean => {
        if (cand.isVerbatimShift) return false;
        for (
          let ln = Math.min(startLine, cand.candStart);
          ln < Math.max(startLine, cand.candStart);
          ln++
        ) {
          if (!isPureDelimOrTriviaLine(ln)) return false;
        }
        for (
          let ln = Math.min(endLine, cand.candEnd) + 1;
          ln <= Math.max(endLine, cand.candEnd);
          ln++
        ) {
          if (!isPureDelimOrTriviaLine(ln)) return false;
        }
        const candFirst = (rawLines[cand.candStart - 1] ?? "").trim();
        const candLast = (rawLines[cand.candEnd - 1] ?? "").trim();
        return candFirst !== procFirstTrim && candLast !== procLastTrim;
      };

      // Never guess between keeping a bare `{ ... }` block vs unwrapping it when both adjustments touch only pure delimiters
      const pureDelimAdjCands = prunedCandidates.filter(isPureDelimOnlyAdjustment);
      const hasPureUnwrapVsKeepAmbiguity =
        pureDelimAdjCands.some((c) => c.candStart > startLine || c.candEnd < endLine) &&
        pureDelimAdjCands.some((c) => c.candStart < startLine || c.candEnd > endLine);

      const scored = prunedCandidates
        .map((cand) => ({ cand, score: scoreCandidate(cand) }))
        .sort((a, b) => b.score - a.score);

      if (
        !hasPureUnwrapVsKeepAmbiguity &&
        scored[0] &&
        scored[1] &&
        scored[0].score > scored[1].score + 0.5
      ) {
        const winner = scored[0].cand;
        finalStartOffset = winner.startOff;
        finalEndOffset = winner.endOff;
        finalOriginalSnippet = nativeSource.slice(winner.startOff, winner.endOff);
        processedCode = winner.replacement;
        autoAligned = true;
      } else {
        const desc = prunedCandidates.map((c) => `L${c.candStart}-L${c.candEnd}`).join(", ");
        ambiguousAlignmentNote = ` Ambiguous ±2 boundary alignments (${desc}); specify exact line range.`;
      }
    }
  }

  const introducesUnbalancedDelims =
    (origDelims.braces === 0 && procDelims.braces !== 0) ||
    (origDelims.parens === 0 && procDelims.parens !== 0);
  const isExplicitNamedDeclHeader =
    /^(?:export\s+|default\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|async\s+|pub\s+|fn\s+|function\s+|def\s+|class\s+|struct\s+|interface\s+|type\s+|enum\s+|const\s+|let\s+|var\s+|impl\s+|func\s+)+[A-Za-z_$][A-Za-z0-9_$]*\b/.test(
      procFirstTrim,
    );
  const windowLines = rawLines.slice(
    Math.max(0, startLine - 41),
    Math.min(rawLines.length, startLine + 40),
  );
  const windowExactHeaderCount = isExplicitNamedDeclHeader
    ? windowLines.filter((l) => l.trim() === procFirstTrim).length
    : 0;
  const hasShiftedHeaderMatch =
    !autoAligned &&
    !alreadyAnchoredAtStart &&
    !introducesUnbalancedDelims &&
    isExplicitNamedDeclHeader &&
    procLineList.length >= 2 &&
    rawLines[startLine - 1]?.trim() !== procFirstTrim &&
    windowExactHeaderCount === 1;

  if (
    !autoAligned &&
    isExplicitNamedDeclHeader &&
    (!literalCheck.valid || hasShiftedHeaderMatch) &&
    !alreadyAnchoredAtStart &&
    !introducesUnbalancedDelims &&
    !ambiguousAlignmentNote
  ) {
    const origSpanCount = Math.max(1, endLine - startLine + 1);
    const procTokens = new Set(
      (processedCode.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/g) ?? []).map((t) => t.toLowerCase()),
    );

    let bestScore = 0;
    let bestStart = -1;
    let bestEnd = -1;
    let bestRep = processedCode;

    const minStart = Math.max(1, startLine - 40);
    const maxStart = Math.min(rawLines.length, startLine + 40);
    const spanLen = origSpanCount;

    for (let candStartLine = minStart; candStartLine <= maxStart; candStartLine++) {
      if (rawLines[candStartLine - 1]?.trim() !== procFirstTrim) continue;
      const candEndLine = Math.min(rawLines.length, candStartLine + spanLen - 1);
      if (candStartLine === startLine && candEndLine === endLine) continue;
      const cStartOff = lineStarts[candStartLine - 1]!;
      const cEndOff =
        candEndLine < lineStarts.length ? lineStarts[candEndLine]! : nativeSource.length;
      const candSlice = nativeSource.slice(cStartOff, cEndOff);
      const candDelims = countNetAndMinDelims(candSlice);
      const repDelims = countNetAndMinDelims(processedCode);
      if (
        candDelims.braces !== repDelims.braces ||
        candDelims.parens !== repDelims.parens ||
        candDelims.minBraces < repDelims.minBraces ||
        candDelims.minParens < repDelims.minParens
      ) {
        continue;
      }
      const candTokens = (candSlice.match(/[A-Za-z_$][A-Za-z0-9_$-]{2,}/g) ?? []).map((t) =>
        t.toLowerCase(),
      );
      let overlap = 0;
      for (const tok of candTokens) {
        if (procTokens.has(tok)) overlap++;
      }
      if (procFirstTrim && rawLines[candStartLine - 1]?.trim() === procFirstTrim) {
        overlap += 20;
      }
      if (procLastTrim && rawLines[candEndLine - 1]?.trim() === procLastTrim) {
        overlap += 15;
      }
      if (overlap <= 0) continue;
      const distPenalty =
        Math.abs(candStartLine - startLine) * 0.5 + Math.abs(spanLen - origSpanCount) * 0.5;
      const score = overlap - distPenalty;
      if (score > bestScore) {
        const candRep = buildRangeReplacement(candStartLine, candEndLine);
        const testModified = `${nativeSource.slice(0, cStartOff)}${candRep}${nativeSource.slice(cEndOff)}`;
        if (validateNativeSyntax(testModified, targetLang, filePath, idioms).valid) {
          bestScore = score;
          bestStart = cStartOff;
          bestEnd = cEndOff;
          bestRep = candRep;
        }
      }
    }

    if (bestStart >= 0 && bestEnd >= bestStart) {
      finalStartOffset = bestStart;
      finalEndOffset = bestEnd;
      finalOriginalSnippet = nativeSource.slice(bestStart, bestEnd);
      processedCode = bestRep;
      autoAligned = true;
    }
  }

  // ±20 unique-anchor shift for non-declaration :Lstart-Lend edits
  if (
    !autoAligned &&
    !isExplicitNamedDeclHeader &&
    !alreadyAnchoredAtStart &&
    !alreadyAnchoredAtEnd &&
    !ambiguousAlignmentNote &&
    procTrimmedLines.length >= 2
  ) {
    const secondTrim = procTrimmedLines[1] ?? "";
    const penultTrim = procTrimmedLines[procTrimmedLines.length - 2] ?? "";
    const useSingleStart = procFirstTrim.length >= 8;
    const usePairStart = !useSingleStart && procFirstTrim.length > 0 && secondTrim.length >= 8;
    const useSingleEnd = procLastTrim.length >= 8;
    const usePairEnd = !useSingleEnd && procLastTrim.length > 0 && penultTrim.length >= 8;

    if ((useSingleStart || usePairStart) && (useSingleEnd || usePairEnd)) {
      const winStartMin = Math.max(1, startLine - 20);
      const winStartMax = Math.min(
        usePairStart ? rawLines.length - 1 : rawLines.length,
        startLine + 20,
      );
      const startAnchorLines: number[] = [];
      for (let ln = winStartMin; ln <= winStartMax; ln++) {
        if (useSingleStart) {
          if ((rawLines[ln - 1] ?? "").trim() === procFirstTrim) {
            startAnchorLines.push(ln);
          }
        } else if (
          (rawLines[ln - 1] ?? "").trim() === procFirstTrim &&
          (rawLines[ln] ?? "").trim() === secondTrim
        ) {
          startAnchorLines.push(ln);
        }
      }

      if (startAnchorLines.length === 1) {
        const uStart = startAnchorLines[0] ?? 1;
        const origSpanCount = Math.max(1, endLine - startLine + 1);
        const maxReasonableSpan = Math.max(origSpanCount, procTrimmedLines.length) + 12;
        const winEndMin = uStart + 1;
        const winEndMax = Math.min(
          rawLines.length,
          Math.max(endLine + 20, uStart + maxReasonableSpan),
          uStart + maxReasonableSpan,
        );
        const endAnchorLines: number[] = [];
        for (let ln = winEndMin; ln <= winEndMax; ln++) {
          if (useSingleEnd) {
            if ((rawLines[ln - 1] ?? "").trim() === procLastTrim) {
              endAnchorLines.push(ln);
            }
          } else if (
            ln >= uStart + 1 &&
            (rawLines[ln - 2] ?? "").trim() === penultTrim &&
            (rawLines[ln - 1] ?? "").trim() === procLastTrim
          ) {
            endAnchorLines.push(ln);
          }
        }

        if (endAnchorLines.length === 1) {
          const uEnd = endAnchorLines[0] ?? uStart;
          const isDifferentSpan = uStart !== startLine || uEnd !== endLine;
          const origMatchesStartAnchor = useSingleStart
            ? (rawLines[startLine - 1] ?? "").trim() === procFirstTrim
            : (rawLines[startLine - 1] ?? "").trim() === procFirstTrim &&
              (rawLines[startLine] ?? "").trim() === secondTrim;
          const origMatchesEndAnchor = useSingleEnd
            ? (rawLines[endLine - 1] ?? "").trim() === procLastTrim
            : endLine >= 2 &&
              (rawLines[endLine - 2] ?? "").trim() === penultTrim &&
              (rawLines[endLine - 1] ?? "").trim() === procLastTrim;
          const safeWhenLiteralValid =
            !literalCheck.valid || (!origMatchesStartAnchor && !origMatchesEndAnchor);

          if (isDifferentSpan && safeWhenLiteralValid) {
            const cStartOff = lineStarts[uStart - 1] ?? 0;
            const cEndOff =
              uEnd < lineStarts.length
                ? (lineStarts[uEnd] ?? nativeSource.length)
                : nativeSource.length;
            const candSlice = nativeSource.slice(cStartOff, cEndOff);
            const candRep = buildRangeReplacement(uStart, uEnd);
            const candDelims = countNetAndMinDelims(candSlice);
            const repDelims = countNetAndMinDelims(candRep);
            if (
              candDelims.braces === repDelims.braces &&
              candDelims.parens === repDelims.parens &&
              candDelims.minBraces >= repDelims.minBraces &&
              candDelims.minParens >= repDelims.minParens
            ) {
              const testModified = `${nativeSource.slice(0, cStartOff)}${candRep}${nativeSource.slice(cEndOff)}`;
              if (
                validateNativeSyntax(testModified, targetLang, filePath, idioms).valid &&
                !(targetLang === "python" && checkPythonDuplicateParams(testModified))
              ) {
                finalStartOffset = cStartOff;
                finalEndOffset = cEndOff;
                finalOriginalSnippet = candSlice;
                processedCode = candRep;
                autoAligned = true;
              }
            }
          }
        }
      }
    }
  }

  if (!autoAligned && !literalCheck.valid && origSyntaxValid) {
    const diagMsg = literalCheck.diagnostics.slice(0, 3).join("; ") || "brace/delimiter imbalance";
    const numberedContext = formatSurroundingNumberedContext(nativeSource, startLine, endLine, 5);
    const contextSuffix = numberedContext
      ? `\nContext around L${startLine}-L${endLine} (±5 lines):\n${numberedContext}`
      : "";
    throw new Error(
      `Line-range splice (${anchorSymbol}) rejected (pre-write syntax validation failed) in ${filePath}: replacement leaves unbalanced braces/parentheses or syntax errors (${diagMsg}).${ambiguousAlignmentNote} Use AST-scoped hunk splicing: === ${filePath}:<symbol> === with <<< / === / >>>.${contextSuffix}`,
    );
  }

  return {
    symbol: anchorSymbol,
    startOffset: finalStartOffset,
    endOffset: finalEndOffset,
    replacement: processedCode,
    originalSnippet: finalOriginalSnippet,
    newSnippet: processedCode,
  };
}
