/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * TypeScript SourceFile caching, TS member/declaration/import/test-block locators, and shell/markdown symbol locators.
 */

import ts from "../../compat/typescript.js";
import type { TargetLanguage } from "../../emitters/index.js";
import type { NativeSpanInfo, NativeTestBlockInfo, ScriptOrMarkdownSymbolInfo } from "./types.js";

function getTsMemberName(member: ts.Node, sf: ts.SourceFile): string | undefined {
  if (ts.isConstructorDeclaration(member)) {
    return "constructor";
  }
  const named = member as { name?: ts.PropertyName };
  if (!named.name) return undefined;
  if (
    ts.isIdentifier(named.name) ||
    ts.isStringLiteral(named.name) ||
    ts.isNumericLiteral(named.name)
  ) {
    return named.name.text;
  }
  return named.name.getText(sf);
}

function getPostDecoratorTokenStart(
  node: ts.Node,
  sf: ts.SourceFile,
  nativeSource: string,
): number {
  const rawStart = node.getStart(sf, false);
  const modifiers = (node as { modifiers?: ts.NodeArray<ts.ModifierLike> }).modifiers;
  if (!modifiers || modifiers.length === 0) return rawStart;

  const decorators = modifiers.filter((m) => ts.isDecorator(m));
  if (decorators.length === 0) return rawStart;

  const firstNonDecorator = modifiers.find((m) => !ts.isDecorator(m));
  if (firstNonDecorator) {
    return firstNonDecorator.getStart(sf, false);
  }

  const lastDecorator = decorators[decorators.length - 1];
  let pos = lastDecorator.getEnd();
  while (pos < nativeSource.length && /\s/.test(nativeSource[pos])) {
    pos++;
  }
  return pos;
}

function extractTsModifiersMeta(
  node: ts.Node,
  sf: ts.SourceFile,
  postDecoratorStart?: number,
): {
  visibility?: "public" | "private" | "protected";
  isExported?: boolean;
  isStatic?: boolean;
  isAsync?: boolean;
  accessor?: "get" | "set";
  isClassContainer?: boolean;
} {
  const start = postDecoratorStart ?? node.getStart(sf, false);
  const headerText = sf.text.slice(start, Math.min(node.getEnd(), start + 120));
  let visibility: "public" | "private" | "protected" | undefined;
  if (/^(?:export\s+)?public\b/.test(headerText)) visibility = "public";
  else if (/^(?:export\s+)?private\b/.test(headerText)) visibility = "private";
  else if (/^(?:export\s+)?protected\b/.test(headerText)) visibility = "protected";

  const isExported = /^export\b/.test(headerText);
  const isStatic = /\bstatic\b/.test(headerText);
  const isAsync = /\basync\b/.test(headerText);
  const accessor = ts.isGetAccessorDeclaration(node)
    ? "get"
    : ts.isSetAccessorDeclaration(node)
      ? "set"
      : undefined;
  const isClassContainer = ts.isClassDeclaration(node);
  return { visibility, isExported, isStatic, isAsync, accessor, isClassContainer };
}

function buildSpanInfoFromTsNode(
  targetNode: ts.Node,
  sf: ts.SourceFile,
  nativeSource: string,
  memberName: string,
  className?: string,
): NativeSpanInfo {
  const rawTokenStart = targetNode.getStart(sf, true);
  const rawLineStart = nativeSource.lastIndexOf("\n", rawTokenStart - 1) + 1;
  const rawLeading = nativeSource.slice(rawLineStart, rawTokenStart);
  const fullDeclStart = /^[ \t]*$/.test(rawLeading) ? rawLineStart : rawTokenStart;

  const tokenStart = getPostDecoratorTokenStart(targetNode, sf, nativeSource);
  const lineStart = nativeSource.lastIndexOf("\n", tokenStart - 1) + 1;
  const leadingSlice = nativeSource.slice(lineStart, tokenStart);
  const isOnlyWs = /^[ \t]*$/.test(leadingSlice);
  const declStart = isOnlyWs ? lineStart : tokenStart;
  const declIndent = isOnlyWs
    ? leadingSlice
    : (nativeSource.slice(lineStart).match(/^[ \t]*/)?.[0] ?? "");
  const declEnd = targetNode.getEnd();
  const meta = extractTsModifiersMeta(targetNode, sf, tokenStart);

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent,
    className,
    memberName,
    ...meta,
  };
}

function selectBestTsMember(
  matchingMembers: ts.ClassElement[],
  preferAccessor?: "get" | "set",
  preferredArity?: number,
): ts.ClassElement {
  if (preferAccessor === "get") {
    const getter = matchingMembers.find((m) => ts.isGetAccessorDeclaration(m));
    if (getter) return getter;
  } else if (preferAccessor === "set") {
    const setter = matchingMembers.find((m) => ts.isSetAccessorDeclaration(m));
    if (setter) return setter;
  }
  const withBody = matchingMembers.filter((m) => (m as { body?: unknown }).body !== undefined);
  const pool = withBody.length > 0 ? withBody : matchingMembers;
  if (preferredArity !== undefined && pool.length > 1) {
    const arityMatch = pool.find(
      (m) =>
        (ts.isMethodDeclaration(m) || ts.isConstructorDeclaration(m)) &&
        m.parameters.length === preferredArity,
    );
    if (arityMatch) return arityMatch;
  }
  return pool[0] ?? matchingMembers[matchingMembers.length - 1];
}

function getTestRunnerRootKind(expr: ts.Expression): "describe" | "test" | "it" | undefined {
  let cur: ts.Expression = expr;
  while (
    ts.isCallExpression(cur) ||
    ts.isTaggedTemplateExpression(cur) ||
    ts.isPropertyAccessExpression(cur)
  ) {
    if (ts.isCallExpression(cur) || ts.isPropertyAccessExpression(cur)) {
      cur = cur.expression;
    } else {
      cur = cur.tag;
    }
  }
  if (ts.isIdentifier(cur)) {
    if (cur.text === "describe" || cur.text === "test" || cur.text === "it") {
      return cur.text;
    }
  }
  return undefined;
}

const TS_SOURCE_FILE_CACHE = new Map<string, ts.SourceFile>();

export function getCachedTsSourceFile(nativeSource: string): ts.SourceFile {
  const cached = TS_SOURCE_FILE_CACHE.get(nativeSource);
  if (cached) {
    TS_SOURCE_FILE_CACHE.delete(nativeSource);
    TS_SOURCE_FILE_CACHE.set(nativeSource, cached);
    return cached;
  }
  const sf = ts.createSourceFile(
    "file.tsx",
    nativeSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  if (nativeSource.length <= 2_000_000) {
    if (TS_SOURCE_FILE_CACHE.size >= 8) {
      const oldestKey = TS_SOURCE_FILE_CACHE.keys().next().value;
      if (oldestKey !== undefined) {
        TS_SOURCE_FILE_CACHE.delete(oldestKey);
      }
    }
    TS_SOURCE_FILE_CACHE.set(nativeSource, sf);
  }
  return sf;
}

export function extractNativeTestBlocks(nativeSource: string): NativeTestBlockInfo[] {
  const results: NativeTestBlockInfo[] = [];
  let sf: ts.SourceFile;
  try {
    sf = getCachedTsSourceFile(nativeSource);
  } catch {
    return results;
  }

  const visit = (node: ts.Node): void => {
    if (ts.isExpressionStatement(node) && ts.isCallExpression(node.expression)) {
      const callExpr = node.expression;
      const runnerKind = getTestRunnerRootKind(callExpr.expression);
      if (runnerKind && callExpr.arguments.length >= 1) {
        const arg0 = callExpr.arguments[0];
        let title: string | undefined;
        if (ts.isStringLiteral(arg0) || ts.isNoSubstitutionTemplateLiteral(arg0)) {
          title = arg0.text;
        } else if (ts.isTemplateExpression(arg0)) {
          const rawText = arg0.getText(sf);
          title = rawText.length >= 2 ? rawText.slice(1, -1) : rawText;
        }
        if (title !== undefined && title.trim().length > 0) {
          const rawSpan = buildSpanInfoFromTsNode(node, sf, nativeSource, title, undefined);
          const spanInfo = enrichSpanWithOffsetsAndLines(nativeSource, rawSpan);
          if (spanInfo && spanInfo.startLine !== undefined && spanInfo.endLine !== undefined) {
            results.push({
              runnerKind,
              outlineKind: runnerKind === "describe" ? "describe" : "test",
              title,
              startLine: spanInfo.startLine,
              endLine: spanInfo.endLine,
              startOffset: spanInfo.declStart,
              endOffset: spanInfo.declEnd,
              indent: spanInfo.declIndent,
              spanInfo,
            });
          }
        }
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return results;
}

export function matchNativeTestBlockSpan(
  nativeSource: string,
  rawSelector: string,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const rawTrimmed = rawSelector.trim();
  if (!rawTrimmed) return undefined;
  const rawUnquoted = rawTrimmed.replace(/^["'`]|["'`]$/g, "").trim();
  if (!rawUnquoted) return undefined;

  const blocks = extractNativeTestBlocks(nativeSource);
  if (blocks.length === 0) return undefined;

  const directExact =
    blocks.find((b) => b.title === rawUnquoted) ??
    blocks.find((b) => `${b.outlineKind} "${b.title}"` === rawTrimmed) ??
    blocks.find((b) => `${b.runnerKind} "${b.title}"` === rawTrimmed) ??
    blocks.find((b) => b.title.toLowerCase() === rawUnquoted.toLowerCase());
  if (directExact) return directExact.spanInfo;

  const hasExplicitRunnerPrefix = /^(?:describe|test|it)\s+/i.test(rawTrimmed);
  const q = rawTrimmed
    .replace(/^(?:describe|test|it)\s+/i, "")
    .trim()
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  if (!q) return undefined;

  const lowerQ = q.toLowerCase();
  const exact =
    blocks.find((b) => b.title === q) ?? blocks.find((b) => b.title.toLowerCase() === lowerQ);
  if (exact) return exact.spanInfo;

  const delimitedPrefixMatches = blocks.filter((b) => {
    if (!b.title.toLowerCase().startsWith(lowerQ)) return false;
    const nextChar = b.title[q.length];
    return nextChar === ":" || nextChar === " " || nextChar === "-" || nextChar === ".";
  });
  if (delimitedPrefixMatches.length > 0) {
    const exactCaseMatches = delimitedPrefixMatches.filter((b) => b.title.startsWith(q));
    const chosenPool = exactCaseMatches.length > 0 ? exactCaseMatches : delimitedPrefixMatches;
    if (chosenPool.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${chosenPool.length} test blocks (${chosenPool
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    return chosenPool[0]?.spanInfo;
  }

  const startsWithMatches = blocks.filter((b) => b.title.toLowerCase().startsWith(lowerQ));
  if (q.length >= 4 || hasExplicitRunnerPrefix || /\s/.test(q)) {
    if (startsWithMatches.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${startsWithMatches.length} test blocks (${startsWithMatches
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    if (startsWithMatches.length === 1) {
      return startsWithMatches[0].spanInfo;
    }
  }

  if (hasExplicitRunnerPrefix || /\s/.test(q) || /[-_:]/.test(q)) {
    const substrMatches = blocks.filter((b) => b.title.toLowerCase().includes(lowerQ));
    if (substrMatches.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous test selector '${rawSelector}' matches ${substrMatches.length} test blocks (${substrMatches
          .slice(0, 3)
          .map((b) => `"${b.title}"`)
          .join(", ")}). Provide a more specific test title.`,
      );
    }
    if (substrMatches.length === 1) {
      return substrMatches[0].spanInfo;
    }
  }

  return undefined;
}

export function extractScriptOrMarkdownSymbols(
  source: string,
  targetLang: TargetLanguage,
): ScriptOrMarkdownSymbolInfo[] {
  const lines = source.split(/\r?\n/);
  const lineStarts: number[] = [];
  const lineEnds: number[] = [];
  let offset = 0;
  for (let i = 0; i < lines.length; i++) {
    lineStarts.push(offset);
    const len = lines[i].length;
    lineEnds.push(offset + len);
    offset += len;
    if (offset < source.length && source[offset] === "\r") offset++;
    if (offset < source.length && source[offset] === "\n") offset++;
  }

  const results: ScriptOrMarkdownSymbolInfo[] = [];

  if (targetLang === "markdown") {
    const rawHeadings: Array<{
      lineIdx: number;
      indent: string;
      level: number;
      hashes: string;
      title: string;
      rawLine: string;
    }> = [];
    let inFence = false;
    let fenceChar = "";
    let fenceLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (!inFence) {
        const openMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (openMatch && !(openMatch[1][0] === "`" && openMatch[2].includes("`"))) {
          inFence = true;
          fenceChar = openMatch[1][0];
          fenceLen = openMatch[1].length;
          continue;
        }
      } else {
        const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closeMatch && closeMatch[1][0] === fenceChar && closeMatch[1].length >= fenceLen) {
          inFence = false;
          fenceChar = "";
          fenceLen = 0;
        }
        continue;
      }
      const m = line.match(/^(\s*)(#{1,6})\s+(.+?)(?:\s+#+)?\s*$/);
      if (m) {
        rawHeadings.push({
          lineIdx: i,
          indent: m[1],
          level: m[2].length,
          hashes: m[2],
          title: m[3].trim(),
          rawLine: line,
        });
      }
    }
    for (let k = 0; k < rawHeadings.length; k++) {
      const cur = rawHeadings[k];
      let nextEqualOrHigher: (typeof rawHeadings)[number] | undefined;
      for (let j = k + 1; j < rawHeadings.length; j++) {
        if (rawHeadings[j].level <= cur.level) {
          nextEqualOrHigher = rawHeadings[j];
          break;
        }
      }
      const startLine = cur.lineIdx + 1;
      const endLine = nextEqualOrHigher
        ? Math.max(startLine, nextEqualOrHigher.lineIdx)
        : Math.max(startLine, lines.length);
      let lastContentIdx = endLine - 1;
      while (lastContentIdx > cur.lineIdx && lines[lastContentIdx].trim() === "") {
        lastContentIdx--;
      }
      let endOffset = lineEnds[lastContentIdx] ?? source.length;
      if (nextEqualOrHigher && lineStarts[nextEqualOrHigher.lineIdx] !== undefined) {
        endOffset = Math.min(endOffset, lineStarts[nextEqualOrHigher.lineIdx]);
      }
      results.push({
        kind: "section",
        name: cur.title,
        displaySignature: `${cur.hashes} ${cur.title}`,
        startLine,
        endLine,
        startOffset: lineStarts[cur.lineIdx] ?? 0,
        endOffset,
        indent: cur.indent,
        headingLevel: cur.level,
        rawHeadingLine: cur.rawLine,
      });
    }
    return results;
  }

  // Precompute heredoc line mask for shell scripts so inner heredoc lines aren't parsed as top-level symbols
  const heredocMask = new Array<boolean>(lines.length).fill(false);
  if (targetLang === "shell") {
    let activeHeredocDelim: string | null = null;
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (activeHeredocDelim !== null) {
        heredocMask[i] = true;
        if (line.trim() === activeHeredocDelim) {
          activeHeredocDelim = null;
        }
        continue;
      }
      if (/^\s*#/.test(line)) continue;
      const hdMatch = line.match(/<<-?\s*(?:['"]([^'"]+)['"]|\\?([A-Za-z_][A-Za-z0-9_]*))/);
      if (hdMatch && !line.includes("<<<")) {
        activeHeredocDelim = hdMatch[1] ?? hdMatch[2] ?? null;
      }
    }
  }

  // Extract section banner headers for shell, powershell, and batch (`# ── Section`, `REM ── Section`, `:: ── Section`)
  const rawSections: Array<{ lineIdx: number; indent: string; title: string; rawLine: string }> =
    [];
  for (let i = 0; i < lines.length; i++) {
    if (heredocMask[i]) continue;
    const line = lines[i];
    const secMatch =
      targetLang === "batch"
        ? line.match(
            /^([ \t]*)(?:REM|::)\s*(?:[─━═=-]{2,}\s+)([A-Za-z0-9_][^\r\n─━═=]*?)(?:\s*[─━═=-]+)?\s*$/i,
          )
        : line.match(
            /^([ \t]*)#\s*(?:[─━═=-]{2,}\s+)([A-Za-z0-9_][^\r\n─━═=]*?)(?:\s*[─━═=-]+)?\s*$/,
          );
    if (secMatch) {
      const title = secMatch[2].replace(/\s*[─━═=-]+\s*$/, "").trim();
      if (title && !/^[─━═=-]+$/.test(title)) {
        rawSections.push({
          lineIdx: i,
          indent: secMatch[1],
          title,
          rawLine: line,
        });
      }
    }
  }

  for (let k = 0; k < rawSections.length; k++) {
    const cur = rawSections[k];
    const nextSec = rawSections[k + 1];
    const startLine = cur.lineIdx + 1;
    const endLine = nextSec
      ? Math.max(startLine, nextSec.lineIdx)
      : Math.max(startLine, lines.length);
    let lastContentIdx = endLine - 1;
    while (lastContentIdx > cur.lineIdx && lines[lastContentIdx].trim() === "") {
      lastContentIdx--;
    }
    results.push({
      kind: "section",
      name: cur.title,
      displaySignature: `# ── ${cur.title}`,
      startLine,
      endLine,
      startOffset: lineStarts[cur.lineIdx] ?? 0,
      endOffset: lineEnds[lastContentIdx] ?? source.length,
      indent: cur.indent,
      rawHeadingLine: cur.rawLine,
    });
  }

  if (targetLang === "batch") {
    const rawLabels: Array<{ lineIdx: number; indent: string; name: string }> = [];
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(/^([ \t]*):([A-Za-z_][A-Za-z0-9_.-]*)\b/);
      if (m && m[2].toLowerCase() !== "eof") {
        rawLabels.push({ lineIdx: i, indent: m[1], name: m[2] });
      }
    }
    for (let k = 0; k < rawLabels.length; k++) {
      const cur = rawLabels[k];
      const nextLabel = rawLabels[k + 1];
      const limitIdx = nextLabel ? nextLabel.lineIdx - 1 : lines.length - 1;
      let endIdx = limitIdx;
      for (let j = cur.lineIdx + 1; j <= limitIdx; j++) {
        if (/^\s*(?:goto\s+:?eof|exit\s+\/b)\b/i.test(lines[j])) {
          endIdx = j;
          break;
        }
      }
      while (endIdx > cur.lineIdx && lines[endIdx].trim() === "") {
        endIdx--;
      }
      results.push({
        kind: "label",
        name: cur.name,
        displaySignature: `:${cur.name}`,
        startLine: cur.lineIdx + 1,
        endLine: endIdx + 1,
        startOffset: lineStarts[cur.lineIdx] ?? 0,
        endOffset: lineEnds[endIdx] ?? source.length,
        indent: cur.indent,
      });
    }
    return results.sort((a, b) => a.startLine - b.startLine);
  }

  // Shell & PowerShell functions
  const shellKeywords = new Set([
    "if",
    "for",
    "while",
    "until",
    "case",
    "select",
    "time",
    "function",
    "do",
    "done",
    "then",
    "else",
    "elif",
    "fi",
  ]);
  for (let i = 0; i < lines.length; i++) {
    if (heredocMask[i]) continue;
    const line = lines[i];
    let indent = "";
    let fnName = "";
    if (targetLang === "powershell") {
      const pm = line.match(
        /^([ \t]*)(?:function|filter)\s+(?:[A-Za-z]+:)?([A-Za-z_][A-Za-z0-9_-]*)\b/i,
      );
      if (pm) {
        indent = pm[1];
        fnName = pm[2];
      }
    } else {
      const sm = line.match(
        /^([ \t]*)(?:function\s+([A-Za-z_][A-Za-z0-9_-]*)\s*(?:\(\s*\))?|([A-Za-z_][A-Za-z0-9_-]*)\s*\(\s*\))\s*(?:\{|$|#)/,
      );
      if (sm) {
        indent = sm[1];
        fnName = sm[2] ?? sm[3] ?? "";
      }
    }
    if (!fnName || shellKeywords.has(fnName)) continue;

    let braceDepth = 0;
    let sawOpen = false;
    let endIdx = i;
    for (let j = i; j < lines.length; j++) {
      if (j > i && heredocMask[j]) continue;
      const scanLine = lines[j];
      let inSingle = false;
      let inDouble = false;
      for (let c = 0; c < scanLine.length; c++) {
        const ch = scanLine[c];
        if (
          (ch === "\\" && (inSingle || inDouble)) ||
          (targetLang === "powershell" && ch === "`" && inDouble)
        ) {
          c++;
          continue;
        }
        if (ch === "'" && !inDouble) {
          inSingle = !inSingle;
          continue;
        }
        if (ch === '"' && !inSingle) {
          inDouble = !inDouble;
          continue;
        }
        if (!inSingle && !inDouble) {
          if (ch === "#" && (c === 0 || /[\s;&|()]/.test(scanLine[c - 1]))) {
            break;
          }
          if (ch === "{") {
            braceDepth++;
            sawOpen = true;
          } else if (ch === "}") {
            braceDepth--;
            if (sawOpen && braceDepth <= 0) {
              endIdx = j;
              break;
            }
          }
        }
      }
      if (sawOpen && braceDepth <= 0) {
        endIdx = j;
        break;
      }
    }

    results.push({
      kind: "function",
      name: fnName,
      displaySignature: `fn ${fnName}()`,
      startLine: i + 1,
      endLine: endIdx + 1,
      startOffset: lineStarts[i] ?? 0,
      endOffset: lineEnds[endIdx] ?? source.length,
      indent,
    });
  }

  return results.sort((a, b) => a.startLine - b.startLine || a.startOffset - b.startOffset);
}

export function locateScriptOrMarkdownSpan(
  source: string,
  rawSelector: string,
  targetLang: TargetLanguage,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  let q = rawSelector.trim();
  if (!q) return undefined;

  const symbols = extractScriptOrMarkdownSymbols(source, targetLang);
  if (symbols.length === 0) return undefined;

  const qClean = q
    .replace(/^#{1,6}\s+/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  const directMatch =
    symbols.find((s) => s.name === qClean || s.displaySignature === q) ??
    symbols.find((s) => s.name.toLowerCase() === qClean.toLowerCase());
  if (directMatch) {
    return {
      declStart: directMatch.startOffset,
      fullDeclStart: directMatch.startOffset,
      declEnd: directMatch.endOffset,
      tokenStart: directMatch.startOffset,
      declIndent: directMatch.indent,
      memberName: directMatch.name,
      origHeader: directMatch.rawHeadingLine,
      startLine: directMatch.startLine,
      endLine: directMatch.endLine,
    };
  }

  const levelMatch = q.match(/^(#{1,6})\s+/);
  const explicitLevel = levelMatch ? levelMatch[1].length : undefined;
  q = q
    .replace(/^(?:fn|function|filter|section)\s+/i, "")
    .replace(/\(\s*\)$/, "")
    .replace(/^:+/, "")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^#\s*[─━═=-]+\s*/, "")
    .replace(/\s*[─━═=-]+\s*$/, "")
    .replace(/^["'`]|["'`]$/g, "")
    .trim();
  if (!q) {
    return undefined;
  }
  const lowerQ = q.toLowerCase();
  const levelFiltered = explicitLevel
    ? symbols.filter((s) => s.headingLevel === explicitLevel)
    : symbols;
  const pool = levelFiltered.length > 0 ? levelFiltered : symbols;

  let matched =
    pool.find((s) => s.name === q || s.displaySignature === rawSelector.trim()) ??
    pool.find((s) => s.name.toLowerCase() === lowerQ) ??
    symbols.find((s) => s.name === q || s.displaySignature === rawSelector.trim()) ??
    symbols.find((s) => s.name.toLowerCase() === lowerQ);

  if (!matched) {
    const prefixCandidates = pool.filter((s) => {
      if (strictForSplice && s.kind !== "section") return false;
      if (!s.name.toLowerCase().startsWith(lowerQ)) return false;
      const nextCh = s.name[q.length];
      return (
        nextCh === undefined ||
        nextCh === ":" ||
        nextCh === " " ||
        nextCh === "-" ||
        nextCh === "—" ||
        nextCh === "."
      );
    });
    if (prefixCandidates.length > 0) {
      const exactCase = prefixCandidates.filter((s) => s.name.startsWith(q));
      const candidatePool = exactCase.length > 0 ? exactCase : prefixCandidates;
      if (candidatePool.length > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous section/symbol selector '${rawSelector}' matches ${candidatePool.length} targets (${candidatePool
            .slice(0, 3)
            .map((s) => `'${s.name}'`)
            .join(", ")}). Provide the full heading or symbol name.`,
        );
      }
      matched = candidatePool[0];
    }
  }

  if (!matched && !strictForSplice) {
    const nonH1 = pool.filter((s) => s.headingLevel !== 1);
    matched =
      nonH1.find((s) => s.name.toLowerCase().startsWith(lowerQ)) ??
      pool.find((s) => s.name.toLowerCase().startsWith(lowerQ)) ??
      nonH1.find((s) => s.name.toLowerCase().includes(lowerQ)) ??
      pool.find((s) => s.name.toLowerCase().includes(lowerQ));
  }

  if (!matched) return undefined;

  return {
    declStart: matched.startOffset,
    fullDeclStart: matched.startOffset,
    declEnd: matched.endOffset,
    tokenStart: matched.startOffset,
    declIndent: matched.indent,
    memberName: matched.name,
    origHeader: matched.rawHeadingLine,
    startLine: matched.startLine,
    endLine: matched.endLine,
  };
}

export function locateTsDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
  preferAccessor?: "get" | "set",
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const sf = getCachedTsSourceFile(nativeSource);
  const qualMatch = symbolSelector.trim().match(/^([^(]+)\((.*)\)$/);
  const baseSelector = qualMatch ? qualMatch[1].trim() : symbolSelector.trim();
  const explicitArity = qualMatch
    ? qualMatch[2].trim() === ""
      ? 0
      : qualMatch[2].split(",").length
    : preferredArity;

  const parts = baseSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  let memberName = parts.length >= 2 ? parts.slice(1).join(".") : baseSelector;
  let inferredAccessor = preferAccessor;
  if (memberName.startsWith("get:")) {
    inferredAccessor = "get";
    memberName = memberName.slice(4);
  } else if (memberName.startsWith("set:")) {
    inferredAccessor = "set";
    memberName = memberName.slice(4);
  }

  const allStmts: ts.Statement[] = [];
  const collectStmts = (stmts: ts.NodeArray<ts.Statement> | ts.Statement[]) => {
    for (const s of stmts) {
      allStmts.push(s);
      if (ts.isModuleDeclaration(s)) {
        let curBody = s.body;
        while (curBody && ts.isModuleDeclaration(curBody)) {
          curBody = curBody.body;
        }
        if (curBody && ts.isModuleBlock(curBody)) {
          collectStmts(curBody.statements);
        }
      }
    }
  };
  collectStmts(sf.statements);

  if (className) {
    const normClassName = normIdForSpan(className);
    const normMemberName = normIdForSpan(memberName);
    for (const stmt of allStmts) {
      if (
        ts.isClassDeclaration(stmt) &&
        stmt.name?.text &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName)
      ) {
        let matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length === 0) {
          matchingMembers = stmt.members.filter(
            (m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName,
          );
        }
        if (matchingMembers.length > 0) {
          const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
          return buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, stmt.name.text);
        }
      } else if (
        ts.isInterfaceDeclaration(stmt) &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName)
      ) {
        const matchingProp =
          stmt.members.find((m) => getTsMemberName(m, sf) === memberName) ??
          stmt.members.find((m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName);
        if (matchingProp) {
          return buildSpanInfoFromTsNode(
            matchingProp,
            sf,
            nativeSource,
            memberName,
            stmt.name.text,
          );
        }
      } else if (
        ts.isTypeAliasDeclaration(stmt) &&
        (stmt.name.text === className || normIdForSpan(stmt.name.text) === normClassName) &&
        ts.isTypeLiteralNode(stmt.type)
      ) {
        const matchingProp =
          stmt.type.members.find((m) => getTsMemberName(m, sf) === memberName) ??
          stmt.type.members.find(
            (m) => normIdForSpan(getTsMemberName(m, sf) ?? "") === normMemberName,
          );
        if (matchingProp) {
          return buildSpanInfoFromTsNode(
            matchingProp,
            sf,
            nativeSource,
            memberName,
            stmt.name.text,
          );
        }
      }
    }
    if (explicitClassName) {
      return undefined;
    }
  }

  const matchingTopStmts = allStmts.filter(
    (
      stmt,
    ): stmt is
      | ts.FunctionDeclaration
      | ts.ClassDeclaration
      | ts.InterfaceDeclaration
      | ts.TypeAliasDeclaration
      | ts.EnumDeclaration =>
      (ts.isFunctionDeclaration(stmt) ||
        ts.isClassDeclaration(stmt) ||
        ts.isInterfaceDeclaration(stmt) ||
        ts.isTypeAliasDeclaration(stmt) ||
        ts.isEnumDeclaration(stmt)) &&
      stmt.name?.text === memberName,
  );
  if (matchingTopStmts.length > 0) {
    const implStmt =
      matchingTopStmts.find((s) => "body" in s && s.body !== undefined) ??
      matchingTopStmts[matchingTopStmts.length - 1];
    const spanInfo = buildSpanInfoFromTsNode(implStmt, sf, nativeSource, memberName, undefined);
    if (
      ts.isFunctionDeclaration(implStmt) &&
      implStmt.body &&
      /<[A-Za-z]/.test(implStmt.body.getText(sf))
    ) {
      const stmtIdx = allStmts.indexOf(implStmt);
      if (stmtIdx > 0) {
        const prevStmt = allStmts[stmtIdx - 1];
        if (ts.isInterfaceDeclaration(prevStmt) && prevStmt.name.text === `${memberName}Props`) {
          const prevSpan = buildSpanInfoFromTsNode(
            prevStmt,
            sf,
            nativeSource,
            prevStmt.name.text,
            undefined,
          );
          spanInfo.propsDeclStart = prevSpan.declStart;
          spanInfo.propsFullDeclStart = prevSpan.fullDeclStart;
        }
      }
    }
    return spanInfo;
  }

  for (const stmt of allStmts) {
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        if (ts.isIdentifier(decl.name) && decl.name.text === memberName) {
          return buildSpanInfoFromTsNode(stmt, sf, nativeSource, memberName, undefined);
        }
      }
    }
  }

  if (!className) {
    const classMatches: Array<{ span: NativeSpanInfo; parentName: string }> = [];
    for (const stmt of allStmts) {
      if (ts.isClassDeclaration(stmt)) {
        const parentName = stmt.name?.text;
        const matchingMembers = stmt.members.filter((m) => getTsMemberName(m, sf) === memberName);
        if (matchingMembers.length > 0) {
          const implMember = selectBestTsMember(matchingMembers, inferredAccessor, explicitArity);
          classMatches.push({
            span: buildSpanInfoFromTsNode(implMember, sf, nativeSource, memberName, parentName),
            parentName: parentName ?? "<anonymous>",
          });
        }
      }
    }
    if (classMatches.length > 0) {
      const distinctClasses = new Set(classMatches.map((m) => m.parentName));
      if (distinctClasses.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple classes (${Array.from(distinctClasses).join(", ")}). Qualify as '<Class>.${memberName}'.`,
        );
      }
      return classMatches[0].span;
    }
  }

  return matchNativeTestBlockSpan(nativeSource, symbolSelector, strictForSplice);
}

export function normIdForSpan(s: string): string {
  return s.replace(/_/g, "").toLowerCase();
}

export function enrichSpanWithOffsetsAndLines(
  nativeSource: string,
  span: NativeSpanInfo | undefined,
): NativeSpanInfo | undefined {
  if (!span) return undefined;
  const startOffset = span.declStart;
  const endOffset = span.declEnd;
  const startLine = nativeSource.slice(0, startOffset).split(/\r?\n/).length;
  const endSlice = nativeSource.slice(0, Math.max(startOffset, endOffset)).replace(/\r?\n$/, "");
  const endLine = Math.max(startLine, endSlice.split(/\r?\n/).length);
  span.startOffset = startOffset;
  span.endOffset = endOffset;
  span.startLine = startLine;
  span.endLine = endLine;
  return span;
}

export function locateImportBlockSpan(
  nativeSource: string,
  targetLang: TargetLanguage,
): NativeSpanInfo | undefined {
  if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    const sf = getCachedTsSourceFile(nativeSource);
    let lastDirectiveEnd = -1;
    const importStmts: Array<ts.ImportDeclaration | ts.ImportEqualsDeclaration> = [];

    for (const stmt of sf.statements) {
      if (
        importStmts.length === 0 &&
        ts.isExpressionStatement(stmt) &&
        ts.isStringLiteral(stmt.expression)
      ) {
        lastDirectiveEnd = stmt.getEnd();
        continue;
      }
      if (ts.isImportDeclaration(stmt) || ts.isImportEqualsDeclaration(stmt)) {
        importStmts.push(stmt);
        continue;
      }
      break;
    }

    if (importStmts.length > 0) {
      const firstStmt = importStmts[0];
      const lastStmt = importStmts[importStmts.length - 1];
      const tokStart = firstStmt.getStart(sf, false);
      const lineStart = nativeSource.lastIndexOf("\n", tokStart - 1) + 1;
      const declStart = /^[ \t]*$/.test(nativeSource.slice(lineStart, tokStart))
        ? lineStart
        : tokStart;
      let declEnd = lastStmt.getEnd();
      while (declEnd < nativeSource.length && nativeSource[declEnd] !== "\n") {
        declEnd++;
      }
      if (declEnd < nativeSource.length && nativeSource[declEnd] === "\n") {
        declEnd++;
      }
      return {
        declStart,
        fullDeclStart: declStart,
        declEnd,
        tokenStart: declStart,
        declIndent: "",
        memberName: "imports",
      };
    }

    if (!/^\s*from\s+['"]/m.test(nativeSource)) {
      let insertPos = 0;
      if (lastDirectiveEnd >= 0) {
        insertPos = lastDirectiveEnd;
        while (insertPos < nativeSource.length && nativeSource[insertPos] !== "\n") {
          insertPos++;
        }
        if (insertPos < nativeSource.length && nativeSource[insertPos] === "\n") {
          insertPos++;
        }
      } else if (nativeSource.startsWith("#!")) {
        const nlIdx = nativeSource.indexOf("\n");
        insertPos = nlIdx >= 0 ? nlIdx + 1 : nativeSource.length;
      }
      return {
        declStart: insertPos,
        fullDeclStart: insertPos,
        declEnd: insertPos,
        tokenStart: insertPos,
        declIndent: "",
        memberName: "imports",
      };
    }
  }

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const stripLineCommentForImport = (line: string): string => {
    let cleaned = line.replace(/\/\*[\s\S]*?\*\//g, "");
    if (targetLang === "python") {
      cleaned = cleaned.replace(/#.*$/, "");
    } else {
      cleaned = cleaned.replace(/\/\/.*$/, "");
    }
    return cleaned;
  };

  const countGroupDelta = (line: string): number => {
    const codeOnly = stripLineCommentForImport(line);
    let delta = 0;
    let inStr: string | null = null;
    for (let k = 0; k < codeOnly.length; k++) {
      const ch = codeOnly[k];
      if (inStr) {
        if (ch === "\\") {
          k++;
          continue;
        }
        if (ch === inStr) inStr = null;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        inStr = ch;
        continue;
      }
      if (ch === "(" || ch === "{") delta++;
      else if (ch === ")" || ch === "}") delta--;
    }
    return delta;
  };

  const isImportLine = (line: string): boolean => {
    const trimmed = line.trim();
    if (!trimmed) return false;
    switch (targetLang) {
      case "typescript":
      case "javascript":
      case "tsx":
        return /^import\b|^from\b/.test(trimmed);
      case "python":
        return /^import\b|^from\b/.test(trimmed);
      case "cpp":
        return /^#\s*include\b/.test(trimmed);
      case "csharp":
        return /^using\b(?!\s*\()/.test(trimmed);
      case "rust":
        return /^(?:pub\s+)?use\b/.test(trimmed);
      case "go":
        return /^import\b/.test(trimmed);
      case "kotlin":
      case "java":
        return /^import\b/.test(trimmed);
      case "php":
        return /^use\b/.test(trimmed);
      default:
        return /^import\b|^use\b|^using\b|^#\s*include\b|^from\b/.test(trimmed);
    }
  };
  let firstImportLine = -1;
  let lastImportLine = -1;
  let groupDepth = 0;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const trimmed = line.trim();

    if (groupDepth > 0) {
      lastImportLine = i;
      groupDepth = Math.max(0, groupDepth + countGroupDelta(line));
      continue;
    }

    if (isImportLine(line)) {
      if (firstImportLine === -1) {
        firstImportLine = i;
      }
      lastImportLine = i;
      groupDepth = Math.max(0, countGroupDelta(line));
    } else if (firstImportLine !== -1) {
      if (
        trimmed === "" ||
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*")
      ) {
        let hasMoreImports = false;
        for (let j = i + 1; j < Math.min(lines.length, i + 15); j++) {
          if (isImportLine(lines[j])) {
            hasMoreImports = true;
            break;
          }
          const t = lines[j].trim();
          if (
            t !== "" &&
            !t.startsWith("//") &&
            !t.startsWith("#") &&
            !t.startsWith("/*") &&
            !t.startsWith("*")
          ) {
            break;
          }
        }
        if (hasMoreImports) {
          continue;
        }
      }
      break;
    }
  }

  if (firstImportLine === -1) {
    let insertLine = 0;
    if (lines.length > 0 && lines[0].startsWith("#!")) {
      insertLine = 1;
    } else if (targetLang === "go") {
      for (let k = 0; k < lines.length; k++) {
        if (/^package\s+/.test(lines[k].trim())) {
          insertLine = k + 1;
          break;
        }
      }
    }
    const insertPos = insertLine < lineOffsets.length ? lineOffsets[insertLine] : 0;
    return {
      declStart: insertPos,
      fullDeclStart: insertPos,
      declEnd: insertPos,
      tokenStart: insertPos,
      declIndent: "",
      memberName: "imports",
    };
  }

  const declStart = lineOffsets[firstImportLine];
  let declEnd: number;
  if (lastImportLine + 1 < lineOffsets.length) {
    declEnd = lineOffsets[lastImportLine + 1];
  } else {
    declEnd = nativeSource.length;
  }

  return {
    declStart,
    fullDeclStart: declStart,
    declEnd,
    tokenStart: declStart,
    declIndent: "",
    memberName: "imports",
  };
}
