/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Numbered-gutter stripping, <<< === >>> hunk parsing/matching/application, and context error formatting.
 */

import type { ProjectIdiomDefinition } from "../../config/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../../emitters/index.js";
import { preprocessHybridAndIdiomsLossless } from "../preprocessor.js";
import { validateNativeSyntax } from "../syntax-validator.js";
import type { HunkBlock } from "./types.js";

export function stripNumberedGutterPrefixes(raw: string): string {
  if (!raw) return raw;
  const rawLines = raw.split(/\r?\n/);
  const lines = rawLines.filter(
    (l) => !/^\[Clamped L\d+-L\d+\s*->\s*L\d+-L\d+\s*\(EOF\)\]$/.test(l.trim()),
  );
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return raw;

  const hasBoxGutter = nonEmpty.some((l) => /^\s*\d+│/.test(l));
  const hasColonGutter =
    nonEmpty.length >= 1 &&
    nonEmpty.every(
      (l) =>
        /^\s*(?:L?\d+:\s|\d+│)/.test(l) &&
        !/^\s*\d+:\s*(?:['"[{]|true\b|false\b|null\b|\d+\s*[,}])/.test(l),
    );

  if (!hasBoxGutter && !hasColonGutter) {
    return lines.length !== rawLines.length ? lines.join("\n") : raw;
  }

  return lines
    .map((line) => {
      if (/^\s*\d+│/.test(line)) {
        return line.replace(/^\s*\d+│ ?/, "");
      }
      if (hasColonGutter && /^\s*L?\d+:\s/.test(line)) {
        return line.replace(/^\s*L?\d+:\s?/, "");
      }
      return line;
    })
    .join("\n");
}

export function containsHunkMarkers(code: string | undefined): boolean {
  if (!code) return false;
  return /(?:^|\r?\n)[ \t]*<{3,}[ \t]*(?:\r?\n|$)/.test(code);
}

export function extractHunkBlocks(rawSnippet: string): HunkBlock[] {
  const lines = rawSnippet.split(/\r?\n/);
  const hunks: HunkBlock[] = [];
  let i = 0;
  while (i < lines.length) {
    const curLine = lines[i] ?? "";
    if (/^[ \t]*<{3,}[ \t]*$/.test(curLine)) {
      i++;
      const searchLines: string[] = [];
      while (i < lines.length && !/^[ \t]*={3,}[ \t]*$/.test(lines[i] ?? "")) {
        searchLines.push(lines[i] ?? "");
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          "Malformed hunk splice: found '<<<' without matching '===' separator and '>>>' terminator. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>",
        );
      }
      i++; // skip '==='
      const replaceLines: string[] = [];
      while (i < lines.length && !/^[ \t]*>{3,}[ \t]*$/.test(lines[i] ?? "")) {
        replaceLines.push(lines[i] ?? "");
        i++;
      }
      if (i >= lines.length) {
        throw new Error(
          "Malformed hunk splice: found '<<<' and '===' without matching '>>>' terminator. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>",
        );
      }
      i++; // skip '>>>'
      hunks.push({
        search: stripNumberedGutterPrefixes(searchLines.join("\n")),
        replace: stripNumberedGutterPrefixes(replaceLines.join("\n")),
      });
    } else {
      const stray = curLine.trim();
      if (
        stray.length > 0 &&
        !stray.startsWith("//") &&
        !stray.startsWith("#") &&
        !stray.startsWith("/*") &&
        !stray.startsWith("*") &&
        !stray.startsWith("<!--")
      ) {
        if (/^={3,}$/.test(stray) || /^>{3,}$/.test(stray)) {
          throw new Error(
            `Malformed hunk splice: unexpected '${stray}' outside '<<< ... >>>' hunk block. Valid syntax:\n<<<\n<lines to find>\n===\n<replacement lines>\n>>>`,
          );
        }
        throw new Error(
          `Malformed hunk splice: unexpected non-hunk content outside '<<< ... >>>' blocks: ${stray}`,
        );
      }
      i++;
    }
  }
  return hunks;
}

function computeCommonLeadingIndent(lines: string[]): string {
  const nonEmpty = lines.filter((l) => l.trim().length > 0);
  if (nonEmpty.length === 0) return "";
  let common = nonEmpty[0]?.match(/^[ \t]*/)?.[0] ?? "";
  for (let i = 1; i < nonEmpty.length; i++) {
    const ws = nonEmpty[i]?.match(/^[ \t]*/)?.[0] ?? "";
    let prefixLen = 0;
    const maxLen = Math.min(common.length, ws.length);
    while (prefixLen < maxLen && common[prefixLen] === ws[prefixLen]) {
      prefixLen++;
    }
    if (prefixLen > 0 || common.length === 0 || ws.length === 0) {
      common = common.slice(0, prefixLen);
    } else {
      const commonWidth = common.replace(/\t/g, "  ").length;
      const wsWidth = ws.replace(/\t/g, "  ").length;
      common = wsWidth < commonWidth ? ws : common;
    }
  }
  return common;
}

function dedentLinesForMatch(lines: string[]): string[] {
  const common = computeCommonLeadingIndent(lines);
  return lines.map((l) => {
    if (!l.trim()) return "";
    const stripped =
      common.length > 0 && l.startsWith(common) ? l.slice(common.length) : l.replace(/^[ \t]+/, "");
    return stripped.trimEnd();
  });
}

export function formatSurroundingNumberedContext(
  originalSource: string,
  spanStartLine: number,
  spanEndLine: number,
  padding = 5,
): string {
  if (!originalSource) return "";
  const displayLines = originalSource.replace(/\r?\n$/, "").split(/\r?\n/);
  const total = displayLines.length;
  if (total === 0) return "";
  const clampedStart = Math.max(1, Math.min(total, spanStartLine));
  const clampedEnd = Math.max(clampedStart, Math.min(total, spanEndLine));
  const winStart = Math.max(1, clampedStart - padding);
  const winEnd = Math.min(total, clampedEnd + padding);

  const out: string[] = [];
  if (clampedEnd - clampedStart <= 40) {
    for (let ln = winStart; ln <= winEnd; ln++) {
      out.push(`${ln}│ ${displayLines[ln - 1] ?? ""}`);
    }
  } else {
    const headEnd = Math.min(total, clampedStart + padding);
    const tailStart = Math.max(headEnd + 1, clampedEnd - padding);
    for (let ln = winStart; ln <= headEnd; ln++) {
      out.push(`${ln}│ ${displayLines[ln - 1] ?? ""}`);
    }
    if (tailStart > headEnd + 1) {
      out.push("  ...");
    }
    for (let ln = tailStart; ln <= winEnd; ln++) {
      out.push(`${ln}│ ${displayLines[ln - 1] ?? ""}`);
    }
  }
  return out.join("\n");
}

export function computeOriginalEditLineSpan(
  originalSource: string,
  modifiedSource: string,
  fallbackSymbol?: string,
): { startLine: number; endLine: number } {
  const rangeMatch = (fallbackSymbol ?? "")
    .trim()
    .match(/^:?\[?L?(\d+)(?:\s*(?:-|\.\.|:)\s*L?(\d+))?\]?$/i);
  if (rangeMatch?.[1]) {
    const s = Number.parseInt(rangeMatch[1], 10);
    const e = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : s;
    return { startLine: Math.max(1, s), endLine: Math.max(s, e) };
  }
  const origLines = originalSource.replace(/\r?\n$/, "").split(/\r?\n/);
  const modLines = modifiedSource.replace(/\r?\n$/, "").split(/\r?\n/);
  let prefix = 0;
  const minLen = Math.min(origLines.length, modLines.length);
  while (prefix < minLen && origLines[prefix] === modLines[prefix]) {
    prefix++;
  }
  let suffix = 0;
  while (
    suffix < origLines.length - prefix &&
    suffix < modLines.length - prefix &&
    origLines[origLines.length - 1 - suffix] === modLines[modLines.length - 1 - suffix]
  ) {
    suffix++;
  }
  const startLine = Math.max(1, Math.min(origLines.length, prefix + 1));
  const endLine = Math.max(startLine, Math.min(origLines.length, origLines.length - suffix));
  return { startLine, endLine };
}

function formatAmbiguousMatchPreviews(
  matches: Array<{ startIdx: number; endIdx: number }>,
  scopeLines: string[],
  origLineMap: number[],
  scopeStartLine: number,
): string {
  if (matches.length === 0) return "";
  const previews = matches.slice(0, 4).map((m, idx) => {
    const startLine = origLineMap[m.startIdx] ?? scopeStartLine + m.startIdx;
    const endLine =
      origLineMap[Math.max(m.startIdx, m.endIdx - 1)] ??
      scopeStartLine + Math.max(m.startIdx, m.endIdx - 1);
    const pStart = Math.max(0, m.startIdx - 2);
    const pEnd = Math.min(scopeLines.length - 1, Math.min(m.endIdx - 1 + 2, m.startIdx + 7));
    const lines: string[] = [];
    for (let i = pStart; i <= pEnd; i++) {
      const diskLine = origLineMap[i] ?? scopeStartLine + i;
      lines.push(`${diskLine}│ ${scopeLines[i]}`);
    }
    return `Match #${idx + 1} [L${startLine}-L${endLine}]:\n${lines.join("\n")}`;
  });
  return `\n\nMatching locations (use exact :Lstart-Lend or include surrounding lines — no re-read needed):\n${previews.join("\n\n")}`;
}

export function applyHunksToScope(
  scopeText: string,
  hunks: HunkBlock[],
  symbolLabel: string,
  filePath: string,
  targetLang?: TargetLanguage,
  idioms?: Record<string, ProjectIdiomDefinition>,
  idiomsEnabled = false,
  insideClass: boolean | "container" | "member" = false,
  scopeStartLine = 1,
  fullNativeContext?: {
    nativeSource: string;
    scopeStartOffset: number;
    scopeEndOffset: number;
  },
): string {
  const safeScope = typeof scopeText === "string" ? scopeText : String(scopeText ?? "");
  const isCrLf = safeScope.includes("\r\n");
  const nl = isCrLf ? "\r\n" : "\n";
  let current = safeScope.replace(/\r\n/g, "\n");
  const effectiveIdioms = idiomsEnabled && idioms ? idioms : {};
  const initialLines = current.split("\n");
  const origLineMap: number[] = initialLines.map((_, i) => scopeStartLine + i);
  const locPhrase =
    symbolLabel === filePath ? `in ${filePath}` : `within '${symbolLabel}' in ${filePath}`;

  const adjustHunkReplacementLines = (
    matchedScopeLines: string[],
    hunkSearchLines: string[],
    rawReplaceNorm: string,
    mode: "exact" | "whitespace",
  ): string[] => {
    const scopeBaseIndent = computeCommonLeadingIndent(matchedScopeLines);
    const searchBaseIndent = computeCommonLeadingIndent(hunkSearchLines);
    const rawRepLines = rawReplaceNorm.split("\n");
    const repNonEmpty = rawRepLines.filter((l) => l.trim().length > 0);
    const repBaseIndent = computeCommonLeadingIndent(rawRepLines);
    if (mode === "exact") {
      if (repBaseIndent.length === 0 && scopeBaseIndent.length > 0) {
        return rawRepLines.map((rl) => (rl.trim().length === 0 ? "" : `${scopeBaseIndent}${rl}`));
      }
      return rawRepLines;
    }
    if (repNonEmpty.every((l) => l.startsWith(searchBaseIndent))) {
      return rawRepLines.map((rl) => {
        if (!rl.trim()) return "";
        return `${scopeBaseIndent}${rl.slice(searchBaseIndent.length)}`;
      });
    }
    if (repBaseIndent.length === 0) {
      return rawRepLines.map((rl) => {
        if (!rl.trim()) return "";
        return `${scopeBaseIndent}${rl}`;
      });
    }
    const indentWidth = (ws: string): number => ws.replace(/\t/g, "  ").length;
    const deltaCols = indentWidth(scopeBaseIndent) - indentWidth(searchBaseIndent);
    const unitChar = scopeBaseIndent.startsWith("\t") ? "\t" : " ";
    return rawRepLines.map((rl) => {
      if (!rl.trim()) return "";
      const curWs = rl.match(/^[ \t]*/)?.[0] ?? "";
      const rest = rl.slice(curWs.length);
      const nextCols = Math.max(0, indentWidth(curWs) + deltaCols);
      const newWs =
        unitChar === "\t"
          ? "\t".repeat(Math.floor(nextCols / 2)) + " ".repeat(nextCols % 2)
          : " ".repeat(nextCols);
      return `${newWs}${rest}`;
    });
  };

  for (const hunk of hunks) {
    const searchNorm = (hunk.search ?? "").replace(/\r\n/g, "\n");
    if (!searchNorm.trim()) {
      const emptyLocPhrase =
        symbolLabel === filePath ? `in ${filePath}` : `for '${symbolLabel}' in ${filePath}`;
      throw new Error(
        `Empty search block in <<< / === / >>> hunk ${emptyLocPhrase}. Provide at least 1 search line between '<<<' and '==='.`,
      );
    }
    let replaceNorm = (hunk.replace ?? "").replace(/\r\n/g, "\n");
    if (targetLang && replaceNorm.trim()) {
      const effectiveInsideClass =
        insideClass === "container" ||
        insideClass === true ||
        (insideClass === "member" &&
          /^\s*(?:#\[[^\]]+\]\s*)*(?:pub\s+|@fn\b|\^fn\b|async\s+|static\s+)*fn\b/.test(
            replaceNorm,
          ));
      replaceNorm = preprocessHybridAndIdiomsLossless(replaceNorm, targetLang, effectiveIdioms, {
        insideClass: effectiveInsideClass,
      }).replace(/\r\n/g, "\n");
    }

    const scopeLines = current.split("\n");
    const searchLines = searchNorm.split("\n");
    while (searchLines.length > 0 && (searchLines[0] ?? "").trim() === "") {
      searchLines.shift();
    }
    while (searchLines.length > 0 && (searchLines[searchLines.length - 1] ?? "").trim() === "") {
      searchLines.pop();
    }

    let matchStart = -1;
    let matchEnd = -1;
    let matchMode: "exact" | "whitespace" = "exact";

    if (searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const exactLineMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        let exactLineMatch = true;
        for (let k = 0; k < searchLines.length; k++) {
          if (scopeLines[s + k] !== searchLines[k]) {
            exactLineMatch = false;
            break;
          }
        }
        if (exactLineMatch) {
          exactLineMatches.push(s);
        }
      }
      if (exactLineMatches.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          exactLineMatches.map((s) => ({ startIdx: s, endIdx: s + searchLines.length })),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${exactLineMatches.length} identical locations. Include surrounding context lines in <<< ... === to disambiguate.${previews}`,
        );
      }
      if (exactLineMatches.length === 1) {
        matchStart = exactLineMatches[0] ?? -1;
        matchEnd = matchStart + searchLines.length;
        matchMode = "exact";
      }
    }

    if (matchStart < 0 && searchLines.length === 1) {
      const validInlineIdxs: number[] = [];
      let searchFrom = 0;
      while (searchFrom <= current.length) {
        const idx = current.indexOf(searchNorm, searchFrom);
        if (idx < 0) break;
        const beforeChar = idx > 0 ? current[idx - 1] : "\n";
        const afterIdx = idx + searchNorm.length;
        const afterChar = afterIdx < current.length ? current[afterIdx] : "\n";
        const isPartialIndentMatch =
          (beforeChar === " " || beforeChar === "\t") && /^[ \t]/.test(searchNorm);
        if (!isPartialIndentMatch && (beforeChar === "\n" || afterChar !== "\n")) {
          validInlineIdxs.push(idx);
        }
        searchFrom = idx + Math.max(1, searchNorm.length);
      }
      if (validInlineIdxs.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          validInlineIdxs.map((idx) => {
            const lineNoAtIdx = current.slice(0, idx).split("\n").length - 1;
            return { startIdx: lineNoAtIdx, endIdx: lineNoAtIdx + 1 };
          }),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${validInlineIdxs.length} inline locations. Include surrounding context to disambiguate.${previews}`,
        );
      }
      if (validInlineIdxs.length === 1) {
        const exactIdx = validInlineIdxs[0] ?? 0;
        const afterIdx = exactIdx + searchNorm.length;
        let inlineRep = replaceNorm;
        if (replaceNorm.includes("\n")) {
          const lineStartIdx = current.lastIndexOf("\n", exactIdx - 1) + 1;
          const linePrefix = current.slice(lineStartIdx, exactIdx);
          if (/^[ \t]+$/.test(linePrefix)) {
            const repSplit = replaceNorm.split("\n");
            inlineRep = repSplit
              .map((rl, idx) => (idx === 0 || !rl.trim() ? rl : `${linePrefix}${rl}`))
              .join("\n");
          }
        }
        const addedLines = inlineRep.split("\n").length - 1;
        if (addedLines > 0) {
          const lineNoAtIdx = current.slice(0, exactIdx).split("\n").length - 1;
          const origNo = origLineMap[lineNoAtIdx] ?? scopeStartLine + lineNoAtIdx;
          origLineMap.splice(lineNoAtIdx + 1, 0, ...Array(addedLines).fill(origNo));
        }
        current = `${current.slice(0, exactIdx)}${inlineRep}${current.slice(afterIdx)}`;
        continue;
      }
    }

    if (matchStart < 0 && searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const dedentedSearch = dedentLinesForMatch(searchLines);
      const dedentMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        const candSlice = scopeLines.slice(s, s + searchLines.length);
        let blankCompatible = true;
        for (let k = 0; k < searchLines.length; k++) {
          const sEmpty = (searchLines[k] ?? "").trim().length === 0;
          const cEmpty = (candSlice[k] ?? "").trim().length === 0;
          if (sEmpty !== cEmpty) {
            blankCompatible = false;
            break;
          }
        }
        if (!blankCompatible) continue;
        const dedentedCand = dedentLinesForMatch(candSlice);
        if (dedentedCand.every((line, k) => line === dedentedSearch[k])) {
          dedentMatches.push(s);
        }
      }
      if (dedentMatches.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          dedentMatches.map((s) => ({ startIdx: s, endIdx: s + searchLines.length })),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${dedentMatches.length} locations (ignoring base indentation). Include surrounding context lines or exact indentation to disambiguate.${previews}`,
        );
      }
      if (dedentMatches.length === 1) {
        matchStart = dedentMatches[0] ?? -1;
        matchEnd = matchStart + searchLines.length;
        matchMode = "whitespace";
      }
    }

    if (matchStart < 0 && searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const trimmedMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        let allMatch = true;
        for (let k = 0; k < searchLines.length; k++) {
          if ((scopeLines[s + k] ?? "").trim() !== (searchLines[k] ?? "").trim()) {
            allMatch = false;
            break;
          }
        }
        if (allMatch) {
          trimmedMatches.push(s);
        }
      }
      if (trimmedMatches.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          trimmedMatches.map((s) => ({ startIdx: s, endIdx: s + searchLines.length })),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${trimmedMatches.length} locations (ignoring indentation). Include surrounding context lines or exact indentation to disambiguate.${previews}`,
        );
      }
      if (trimmedMatches.length === 1) {
        matchStart = trimmedMatches[0] ?? -1;
        matchEnd = matchStart + searchLines.length;
        matchMode = "whitespace";
      }
    }

    if (matchStart < 0 && searchLines.length > 1) {
      const nonBlankSearch = searchLines.map((l) => l.trim()).filter(Boolean);
      const nonBlankMatches: Array<{ start: number; end: number }> = [];
      for (let s = 0; s < scopeLines.length; s++) {
        if ((scopeLines[s] ?? "").trim() !== nonBlankSearch[0]) continue;
        let curScopeIdx = s;
        let matchedAll = true;
        for (let k = 0; k < nonBlankSearch.length; k++) {
          while (curScopeIdx < scopeLines.length && (scopeLines[curScopeIdx] ?? "").trim() === "") {
            curScopeIdx++;
          }
          if (
            curScopeIdx >= scopeLines.length ||
            (scopeLines[curScopeIdx] ?? "").trim() !== nonBlankSearch[k]
          ) {
            matchedAll = false;
            break;
          }
          curScopeIdx++;
        }
        if (matchedAll) {
          nonBlankMatches.push({ start: s, end: curScopeIdx });
        }
      }
      if (nonBlankMatches.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          nonBlankMatches.map((m) => ({ startIdx: m.start, endIdx: m.end })),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${nonBlankMatches.length} locations. Include surrounding context lines to disambiguate.${previews}`,
        );
      }
      if (nonBlankMatches.length === 1) {
        matchStart = nonBlankMatches[0]?.start ?? -1;
        matchEnd = nonBlankMatches[0]?.end ?? -1;
        matchMode = "whitespace";
      }
    }

    if (matchStart < 0 && searchLines.length > 0 && searchLines.length <= scopeLines.length) {
      const normInteriorWs = (l: string): string => l.replace(/\s+/g, " ").trim();
      const normSearch = searchLines.map(normInteriorWs);
      const normWsMatches: number[] = [];
      for (let s = 0; s <= scopeLines.length - searchLines.length; s++) {
        let allNormMatch = true;
        for (let k = 0; k < searchLines.length; k++) {
          if (normInteriorWs(scopeLines[s + k] ?? "") !== normSearch[k]) {
            allNormMatch = false;
            break;
          }
        }
        if (allNormMatch) {
          normWsMatches.push(s);
        }
      }
      if (normWsMatches.length > 1) {
        const previews = formatAmbiguousMatchPreviews(
          normWsMatches.map((s) => ({ startIdx: s, endIdx: s + searchLines.length })),
          scopeLines,
          origLineMap,
          scopeStartLine,
        );
        throw new Error(
          `Ambiguous hunk ${locPhrase}: search block matches ${normWsMatches.length} locations (normalized interior whitespace). Include surrounding context lines to disambiguate.${previews}`,
        );
      }
      if (normWsMatches.length === 1) {
        const candStart = normWsMatches[0] ?? 0;
        const candEnd = candStart + searchLines.length;
        const previewLines = [...scopeLines];
        if (replaceNorm === "") {
          previewLines.splice(candStart, candEnd - candStart);
        } else {
          const previewRep = adjustHunkReplacementLines(
            scopeLines.slice(candStart, candEnd),
            searchLines,
            replaceNorm,
            "whitespace",
          );
          previewLines.splice(candStart, candEnd - candStart, ...previewRep);
        }
        const previewScope = previewLines.join("\n");
        const previewFormatted = isCrLf ? previewScope.replace(/\n/g, nl) : previewScope;
        const previewFull = fullNativeContext
          ? `${fullNativeContext.nativeSource.slice(0, fullNativeContext.scopeStartOffset)}${previewFormatted}${fullNativeContext.nativeSource.slice(fullNativeContext.scopeEndOffset)}`
          : previewFormatted;
        const effectiveLang = targetLang ?? detectTargetFromPath(filePath) ?? undefined;
        if (
          !effectiveLang ||
          validateNativeSyntax(previewFull, effectiveLang, filePath, effectiveIdioms).valid
        ) {
          matchStart = candStart;
          matchEnd = candEnd;
          matchMode = "whitespace";
        }
      }
    }

    if (matchStart < 0) {
      let diskContextSnippet = "";

      const extractTokens = (text: string): string[] => {
        const matches = text.match(/[A-Za-z_$][A-Za-z0-9_$]*/g);
        if (!matches) return [];
        return Array.from(new Set(matches.filter((t) => t.length >= 2)));
      };

      const rawSearchLines = searchNorm.split("\n");
      const trimmedSearchLines = rawSearchLines.map((l) => l.trim()).filter((l) => l.length > 0);
      const nonTrivialSearchLines = trimmedSearchLines.filter(
        (l) => l.length > 1 && /[A-Za-z0-9_$]/.test(l),
      );

      const searchTokens = extractTokens(searchNorm);
      const searchTokenSet = new Set(searchTokens);

      let hasNonTrivialLineMatch = false;
      for (const line of scopeLines) {
        const tr = line.trim();
        if (tr && nonTrivialSearchLines.includes(tr)) {
          hasNonTrivialLineMatch = true;
          break;
        }
      }

      const matchedTokens = new Set<string>();
      for (const line of scopeLines) {
        const lineTokens = extractTokens(line);
        for (const tok of lineTokens) {
          if (searchTokenSet.has(tok)) {
            matchedTokens.add(tok);
          }
        }
      }
      const hasTokenMatch = matchedTokens.size >= 2;

      if ((hasNonTrivialLineMatch || hasTokenMatch) && scopeLines.length > 0) {
        let bestScore = -1;
        let bestAnchorStart = 0;
        let bestAnchorEnd = 0;

        const K = Math.max(1, Math.min(scopeLines.length, searchLines.length || 1));
        for (let s = 0; s <= scopeLines.length - K; s++) {
          let score = 0;
          for (let k = 0; k < K; k++) {
            const scopeLine = scopeLines[s + k] ?? "";
            const searchLine = searchLines[k] ?? "";
            const trScope = scopeLine.trim();
            const trSearch = searchLine.trim();

            if (trScope && trSearch && trScope === trSearch) {
              score += 20;
            } else if (
              trScope &&
              trSearch &&
              (scopeLine.includes(searchLine) || searchLine.includes(scopeLine))
            ) {
              score += 8;
            }
            const lineTokens = extractTokens(scopeLine);
            for (const tok of lineTokens) {
              if (searchTokenSet.has(tok)) {
                score += 2;
              }
            }
          }
          if (score > bestScore) {
            bestScore = score;
            bestAnchorStart = s;
            bestAnchorEnd = s + K - 1;
          }
        }

        for (let s = 0; s < scopeLines.length; s++) {
          const scopeLine = scopeLines[s] ?? "";
          const trScope = scopeLine.trim();
          if (!trScope) continue;

          let singleScore = 0;
          if (nonTrivialSearchLines.includes(trScope)) {
            singleScore += 25;
          }
          const lineTokens = extractTokens(scopeLine);
          for (const tok of lineTokens) {
            if (searchTokenSet.has(tok)) {
              singleScore += 3;
            }
          }
          if (singleScore > bestScore) {
            bestScore = singleScore;
            bestAnchorStart = s;
            bestAnchorEnd = s;
          }
        }

        if (bestScore > 0) {
          let winStartIdx = Math.max(0, bestAnchorStart - 5);
          let winEndIdx = Math.min(scopeLines.length - 1, bestAnchorEnd + 5);

          if (winEndIdx - winStartIdx + 1 > 16) {
            const mid = Math.floor((bestAnchorStart + bestAnchorEnd) / 2);
            winStartIdx = Math.max(0, mid - 7);
            winEndIdx = Math.min(scopeLines.length - 1, winStartIdx + 15);
            if (winEndIdx - winStartIdx + 1 < 16 && winStartIdx > 0) {
              winStartIdx = Math.max(0, winEndIdx - 15);
            }
          }

          const winStart = origLineMap[winStartIdx] ?? scopeStartLine + winStartIdx;
          const winEnd = origLineMap[winEndIdx] ?? scopeStartLine + winEndIdx;

          const snippetLines: string[] = [];
          for (let i = winStartIdx; i <= winEndIdx; i++) {
            const diskLine = origLineMap[i] ?? scopeStartLine + i;
            snippetLines.push(`${diskLine}│ ${scopeLines[i]}`);
          }
          const numberedLines = snippetLines.join("\n");
          diskContextSnippet = `\n\nClosest disk context [L${winStart}-L${winEnd}] (retry splice directly without re-reading):\n${numberedLines}`;
        }
      }

      throw new Error(
        `Hunk search block not found ${locPhrase}:\n${hunk.search}${diskContextSnippet}`,
      );
    }

    if (replaceNorm === "") {
      scopeLines.splice(matchStart, matchEnd - matchStart);
      origLineMap.splice(matchStart, matchEnd - matchStart);
    } else {
      const adjustedRepLines = adjustHunkReplacementLines(
        scopeLines.slice(matchStart, matchEnd),
        searchLines,
        replaceNorm,
        matchMode,
      );
      scopeLines.splice(matchStart, matchEnd - matchStart, ...adjustedRepLines);
      const baseLine = origLineMap[matchStart] ?? scopeStartLine + matchStart;
      const repLines = adjustedRepLines.map((_, idx) => baseLine + idx);
      origLineMap.splice(matchStart, matchEnd - matchStart, ...repLines);
    }
    current = scopeLines.join("\n");
  }

  return isCrLf ? current.replace(/\n/g, nl) : current;
}

export function buildEmptySpliceBlockError(
  filePath: string,
  symbol?: string,
  action = "splicing native file",
): Error {
  const cleanSym = symbol && symbol !== ":create" ? symbol : "MyClass.myMethod";
  const headerDesc = symbol && symbol !== ":create" ? `${filePath}:${symbol}` : filePath;
  return new Error(
    `Empty or malformed splice block for '=== ${headerDesc} ===' — Must provide non-empty --code or --body when ${action}.\n` +
      `Valid heredoc / stream syntax:\n` +
      `  1) Full symbol replacement:\n` +
      `     === ${filePath}:${cleanSym} ===\n` +
      `     <replacement code>\n` +
      `  2) AST-scoped hunk splice (for 1-15 line edits inside a symbol):\n` +
      `     === ${filePath}:${cleanSym} ===\n` +
      `     <<<\n` +
      `     <lines to find>\n` +
      `     ===\n` +
      `     <replacement lines>\n` +
      `     >>>\n` +
      `  3) Line-range replacement:\n` +
      `     === ${filePath}:L10-L12 ===\n` +
      `     <replacement lines>\n` +
      `  4) Delete symbol or line range:\n` +
      `     === ${headerDesc} --delete ===`,
  );
}
