/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Symbol focus slicing (:sym@pattern), >110L elision, import-block folding, and AICE symbol extraction.
 */

import * as fs from "node:fs";
import { findProjectRoot } from "../../config/index.js";
import type { ClassDecl, Expr, LayoutNode, Module, ModuleItem } from "../../core/ast.js";
import { parse } from "../../core/parser.js";
import { AiceGenerator } from "../../decompiler/aice-generator.js";
import { decompile } from "../../decompiler/index.js";
import { detectTargetFromPath, detectTargetFromPathOrContent } from "../../emitters/index.js";
import { withSuppressedTelemetry } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import {
  extractPassthroughStructuralSymbols,
  generateOutline,
  type OutlineSymbol,
} from "../outline.js";
import { locateNativeDeclarationSpan } from "../splice.js";
import { didYouMeanSymbol } from "../suggest.js";
import {
  formatDisplayPath,
  resolveFirstActionableSymbol,
  splitSymbolSelectors,
} from "./imports-and-deps.js";
import {
  extractPatternMatchesFromSource,
  hasCatastrophicNestedQuantifiers,
} from "./pattern-search.js";
import type { PatternMatchRankingOptions } from "./types.js";

export function formatCompactBareFileSource(
  rawSource: string,
  displayTargetPath: string,
  opts?: { isMultiTarget?: boolean; full?: boolean },
): string {
  if (rawSource.length === 0) {
    return opts?.isMultiTarget ? `// ${displayTargetPath}:1-0` : "";
  }
  const hasTrailingNewline = rawSource.endsWith("\n");
  const clean = rawSource.replace(/\r?\n$/, "");
  const rawLines = clean.split(/\r?\n/);
  const totalLines = rawLines.length;

  let startIdx = 0;
  const firstTrim = rawLines[0]?.trim() ?? "";
  if (firstTrim.startsWith("/**") || firstTrim.startsWith("/*")) {
    let closeIdx = -1;
    for (let i = 0; i < Math.min(rawLines.length, 18); i++) {
      if (rawLines[i]!.includes("*/")) {
        closeIdx = i;
        break;
      }
    }
    if (
      closeIdx >= 0 &&
      rawLines
        .slice(0, closeIdx + 1)
        .some((l) => /@license|SPDX-License-Identifier|Copyright \(c\)/i.test(l))
    ) {
      startIdx = closeIdx + 1;
      while (startIdx < rawLines.length && rawLines[startIdx]!.trim() === "") {
        startIdx++;
      }
    }
  }

  const keptLines: string[] = [];
  let needsResumeLineNum = false;
  let skippedInterior = false;
  for (let i = startIdx; i < rawLines.length; i++) {
    const ln = rawLines[i]!;
    if (isDecorativeDividerComment(ln.trim())) {
      needsResumeLineNum = true;
      skippedInterior = true;
      continue;
    }
    if (needsResumeLineNum) {
      keptLines.push(`${i + 1}: ${ln}`);
      needsResumeLineNum = false;
    } else {
      keptLines.push(ln);
    }
  }
  const keptStartLine = Math.min(totalLines, startIdx + 1);
  const body = keptLines.join("\n");
  const header = `// ${displayTargetPath}:${keptStartLine}-${totalLines}`;
  const withHeader = body ? `${header}\n${body}` : header;

  if (opts?.isMultiTarget || opts?.full || totalLines > 120) {
    return `// @preformatted\n${withHeader}`;
  }

  const rawBaseline = hasTrailingNewline ? rawSource : `${rawSource}\n`;
  if (estimateTokens(withHeader, "cl100k_base") <= estimateTokens(rawBaseline, "cl100k_base")) {
    return `// @preformatted\n${withHeader}`;
  }
  if (keptStartLine > 1 || skippedInterior) {
    return `// @preformatted\n${rawLines.join("\n")}`;
  }
  return `// @preformatted\n${body}`;
}

function normalizeIdentForMatch(s: string): string {
  return s.replace(/[_-]/g, "").toLowerCase();
}

function matchLayoutNodes(nodes: LayoutNode[], rawSelector: string): LayoutNode[] {
  const sel = rawSelector.trim();
  const isId = sel.startsWith("#");
  const isClass = sel.startsWith(".");
  const isBlock = sel.startsWith("block:");
  const cleanSel = sel.replace(/^(?:#|\.|block:)/, "");
  const normClean = normalizeIdentForMatch(cleanSel);
  const matched: LayoutNode[] = [];

  const getAttrStr = (node: LayoutNode, attrName: string): string | undefined => {
    const attr = node.attributes.find((a) => a.name === attrName);
    if (!attr) return undefined;
    if (attr.value.kind === "LiteralExpr") return String(attr.value.value);
    if (attr.value.kind === "IdentifierExpr") return attr.value.name;
    return undefined;
  };

  const visit = (list: LayoutNode[]) => {
    for (const n of list) {
      let isMatch = false;
      if (isId) {
        const idVal = getAttrStr(n, "id");
        if (idVal && (idVal === cleanSel || normalizeIdentForMatch(idVal) === normClean)) {
          isMatch = true;
        }
      } else if (isClass) {
        const clsVal = getAttrStr(n, "class") ?? getAttrStr(n, "className") ?? "";
        const tokens = clsVal.split(/\s+/).filter(Boolean);
        if (
          tokens.includes(cleanSel) ||
          tokens.some((t) => normalizeIdentForMatch(t) === normClean)
        ) {
          isMatch = true;
        }
      } else if (isBlock) {
        const blkVal =
          getAttrStr(n, "twig_block") ??
          getAttrStr(n, "block") ??
          (n.tag === "block" ? getAttrStr(n, "name") : undefined);
        if (blkVal && (blkVal === cleanSel || normalizeIdentForMatch(blkVal) === normClean)) {
          isMatch = true;
        }
      } else {
        const idVal = getAttrStr(n, "id");
        const blkVal =
          getAttrStr(n, "twig_block") ??
          getAttrStr(n, "block") ??
          (n.tag === "block" ? getAttrStr(n, "name") : undefined);
        const clsVal = getAttrStr(n, "class") ?? getAttrStr(n, "className") ?? "";
        const tokens = clsVal.split(/\s+/).filter(Boolean);
        if (
          n.tag === cleanSel ||
          normalizeIdentForMatch(n.tag) === normClean ||
          (idVal && (idVal === cleanSel || normalizeIdentForMatch(idVal) === normClean)) ||
          (blkVal && (blkVal === cleanSel || normalizeIdentForMatch(blkVal) === normClean)) ||
          tokens.includes(cleanSel)
        ) {
          isMatch = true;
        }
      }

      if (isMatch) {
        matched.push(n);
      } else if (n.children && n.children.length > 0) {
        visit(n.children);
      }
    }
  };

  visit(nodes);
  return matched;
}

function sliceRecordLiteralByPath(
  expr: Expr,
  keyParts: string[],
): { leafName: string; value: Expr } | undefined {
  let cur: Expr = expr;
  let lastKey = keyParts[keyParts.length - 1] ?? "config";
  for (const part of keyParts) {
    if (cur.kind !== "RecordLiteralExpr") return undefined;
    const normPart = normalizeIdentForMatch(part);
    const prop =
      cur.properties.find((p) => p.key === part) ??
      cur.properties.find((p) => p.key && normalizeIdentForMatch(p.key) === normPart);
    if (!prop) return undefined;
    lastKey = prop.key ?? part;
    cur = prop.value;
  }
  return { leafName: lastKey, value: cur };
}

export function formatDiskSourceWithLineNumbers(rawText: string, startLine = 1): string {
  if (rawText.length === 0) return "";
  const clean = rawText.replace(/\r?\n$/, "");
  const lines = clean.split(/\r?\n/);
  return lines.map((ln, idx) => `${startLine + idx}: ${ln}`).join("\n");
}

export function formatWithLineNumbers(text: string, startLine = 1): string {
  const lines = text.split("\n");
  return lines
    .map((line, idx) => {
      if (
        /^\s*\d+[│:]\s/.test(line) ||
        /^L\d+:\s/.test(line) ||
        /^\/\/ match at \[/.test(line) ||
        /^\[Clamped /.test(line)
      ) {
        return line;
      }
      return `${startLine + idx}│ ${line}`;
    })
    .join("\n");
}

function resolveParentMemberFallback(
  rawFileSource: string,
  _aiceSource: string,
  className: string,
  memberName: string,
  filePath: string,
  _mod?: Module,
): { text: string; startLine: number } | undefined {
  const normMember = normalizeIdentForMatch(memberName);

  if (!filePath.endsWith(".aice")) {
    const targetLang = detectTargetFromPath(filePath);
    const directSpan = locateNativeDeclarationSpan(
      rawFileSource,
      `${className}.${memberName}`,
      targetLang,
      className,
    );
    if (directSpan) {
      const startOff = directSpan.fullDeclStart ?? directSpan.declStart;
      const startLine =
        directSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
      return {
        text: rawFileSource.slice(startOff, directSpan.declEnd),
        startLine,
      };
    }

    const parentSpan = locateNativeDeclarationSpan(rawFileSource, className, targetLang);
    if (parentSpan) {
      const parentStartOff = parentSpan.fullDeclStart ?? parentSpan.declStart;
      const parentStartLine =
        parentSpan.startLine ?? rawFileSource.slice(0, parentStartOff).split(/\r?\n/).length;
      const parentSlice = rawFileSource.slice(parentStartOff, parentSpan.declEnd);
      const parentLines = parentSlice.split(/\r?\n/);

      const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const memberWordRe = new RegExp(`\\b${escMember}\\b`, "i");
      const hitIndices: number[] = [];
      for (let i = 0; i < parentLines.length; i++) {
        const ln = parentLines[i]!;
        if (memberWordRe.test(ln) || normalizeIdentForMatch(ln).includes(normMember)) {
          hitIndices.push(i);
        }
      }

      if (hitIndices.length > 0) {
        if (parentLines.length <= 35) {
          return { text: parentSlice, startLine: parentStartLine };
        }
        const firstIdx = hitIndices[0]!;
        let endIdx = firstIdx;
        let braceDepth = 0;
        let parenDepth = 0;
        let sawOpen = false;
        for (let k = firstIdx; k < parentLines.length; k++) {
          const ln = parentLines[k]!;
          for (let c = 0; c < ln.length; c++) {
            const ch = ln[c];
            if (ch === "{") {
              braceDepth++;
              sawOpen = true;
            } else if (ch === "}") {
              braceDepth = Math.max(0, braceDepth - 1);
            } else if (ch === "(") {
              parenDepth++;
              sawOpen = true;
            } else if (ch === ")") {
              parenDepth = Math.max(0, parenDepth - 1);
            }
          }
          endIdx = k;
          if (sawOpen && braceDepth === 0 && parenDepth === 0) {
            break;
          }
          if (!sawOpen && k >= firstIdx + 6) {
            break;
          }
        }
        const sliceStartIdx = sawOpen ? firstIdx : Math.max(0, firstIdx - 2);
        const sliceEndIdx = sawOpen
          ? Math.min(parentLines.length - 1, endIdx)
          : Math.min(parentLines.length - 1, firstIdx + 6);
        return {
          text: parentLines.slice(sliceStartIdx, sliceEndIdx + 1).join("\n"),
          startLine: parentStartLine + sliceStartIdx,
        };
      }
    }
  }

  return undefined;
}

function parseSelectorLineRange(
  selector?: string,
): { startLine: number; endLine?: number } | undefined {
  if (!selector) return undefined;
  const m = selector.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
  if (!m?.[1]) return undefined;
  const startLine = Number.parseInt(m[1], 10);
  const endLine = m[2] ? Number.parseInt(m[2], 10) : undefined;
  return { startLine, endLine };
}

/**
 * Splits <Symbol>@<pattern> ONLY when:
 * 1. The selector does NOT start with / (not a regex literal :/foo@bar/), NOT outline, and NOT a pure :Lstart-Lend line range.
 * 2. @ is after at least 1 symbol char (atIdx > 0), and the part after @ is non-empty,
 *    NOT "first" (case-insensitive), NOT pure digits (/^\d+$/ — preserve existing sym@first / sym@1 ordinal disambiguation!),
 *    and NOT clone( / replace-docs.
 */
export function parseSymbolPatternSelector(
  rawSelector: string,
): { symbol: string; pattern: string } | null {
  const trimmed = rawSelector.trim();
  if (!trimmed) return null;
  if (trimmed.startsWith("/")) return null;
  if (trimmed.toLowerCase() === "outline") return null;
  if (/^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i.test(trimmed)) return null;

  const atIdx = trimmed.indexOf("@");
  if (atIdx <= 0) return null;

  const symbol = trimmed.slice(0, atIdx).trim();
  const pattern = trimmed.slice(atIdx + 1).trim();

  if (!symbol || !pattern || /\s/.test(symbol)) return null;
  if (pattern.toLowerCase() === "first") return null;
  if (/^\d+$/.test(pattern)) return null;
  if (pattern.startsWith("clone(") || pattern === "replace-docs") return null;

  return { symbol, pattern };
}

export function compileFocusPattern(rawPattern: string): RegExp {
  const hasUppercase = /[A-Z]/.test(rawPattern);
  const flags = hasUppercase ? "" : "i";
  if (rawPattern.length <= 512 && !hasCatastrophicNestedQuantifiers(rawPattern)) {
    try {
      return new RegExp(rawPattern, flags);
    } catch {
      // invalid regex syntax falls through to escaped literal
    }
  }
  const escaped = rawPattern.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(escaped, flags);
}

export function isDecorativeDividerComment(trimmed: string): boolean {
  if (trimmed.length < 4 || /[a-zA-Z0-9]/.test(trimmed)) return false;
  return /^(?:\/\/|#|--|\/\*|\*)[-=_~/#\s*─━═]*$/.test(trimmed);
}

export function detectContiguousImportBlock(
  rawLines: string[],
  startLine: number,
  clampedEnd: number,
): { impStart: number; impEnd: number } | undefined {
  let firstImp: number | undefined;
  let lastImp: number | undefined;
  let inMultiline = false;

  for (let l = startLine; l <= clampedEnd; l++) {
    const ln = rawLines[l - 1] ?? "";
    const trimmed = ln.trim();

    if (inMultiline) {
      lastImp = l;
      if (/\bfrom\s+['"]|;|\)/.test(trimmed) || (trimmed.includes("}") && !trimmed.includes("{"))) {
        inMultiline = false;
      }
      continue;
    }

    const isSingleImport =
      /^\s*import\b/.test(trimmed) ||
      /^\s*export\s+(?:\*|\{[^}]*\})\s+from\b/.test(trimmed) ||
      /^\s*from\s+[\w.]+\s+import\b/.test(trimmed) ||
      /^\s*#\s*include\b/.test(trimmed) ||
      /^\s*use\s+[\w:]+;?/.test(trimmed);

    const isMultilineStart =
      (/^\s*(?:import\b|export\s+\{|use\s+[\w:]+\s*\{)/.test(trimmed) &&
        !/\bfrom\s+['"]|;/.test(trimmed) &&
        (trimmed.includes("{") || trimmed.endsWith("("))) ||
      (/^\s*from\s+[\w.]+\s+import\s*\(/m.test(trimmed) && !trimmed.includes(")"));

    if (isSingleImport || isMultilineStart) {
      if (firstImp === undefined) {
        firstImp = l;
      }
      lastImp = l;
      if (isMultilineStart && !trimmed.includes("}")) {
        inMultiline = true;
      }
      continue;
    }

    if (firstImp !== undefined) {
      const isBlankOrComment = trimmed === "" || /^(?:\/\/|\/\*|\*|#|--)/.test(trimmed);
      if (isBlankOrComment) {
        continue;
      }
      break;
    }
  }

  if (firstImp !== undefined && lastImp !== undefined) {
    const span = lastImp - firstImp + 1;
    if (span >= 30) {
      return { impStart: firstImp, impEnd: lastImp };
    }
  }
  return undefined;
}

export function formatLargeLineRangeWithElision(
  rawLines: string[],
  startLine: number,
  clampedEnd: number,
): string {
  const importBlock = detectContiguousImportBlock(rawLines, startLine, clampedEnd);
  const outLines: string[] = [];

  let l = startLine;
  let lastEmittedLine = startLine - 1;
  while (l <= clampedEnd) {
    if (importBlock && l >= importBlock.impStart && l <= importBlock.impEnd) {
      const foldedCount = importBlock.impEnd - importBlock.impStart + 1;
      outLines.push(
        `// [L${importBlock.impStart}-L${importBlock.impEnd}: ${foldedCount} import lines folded — use :imports to expand]`,
      );
      l = importBlock.impEnd + 1;
      continue;
    }

    const rawLine = rawLines[l - 1] ?? "";
    const trimmed = rawLine.trim();

    if (trimmed.length === 0) {
      l++;
      continue;
    }

    if (isDecorativeDividerComment(trimmed)) {
      l++;
      continue;
    }

    if (l !== lastEmittedLine + 1 || outLines.length === 0) {
      outLines.push(`${l}: ${rawLine}`);
    } else {
      outLines.push(rawLine);
    }
    lastEmittedLine = l;
    l++;
  }

  return `// @span:${startLine}-${clampedEnd}\n${outLines.join("\n")}`;
}

function computeHeaderSetupRange(
  diskLines: string[],
  symStartLine: number,
  symEndLine: number,
): [number, number] {
  const maxEnd = Math.min(symEndLine, symStartLine + 15);
  let curEnd = symStartLine;

  let parenDepth = 0;
  let inSignature = true;

  for (let l = symStartLine; l <= maxEnd; l++) {
    const raw = diskLines[l - 1] ?? "";
    const trimmed = raw.trim();

    if (l === symStartLine) {
      curEnd = l;
      for (const ch of raw) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      }
      if (
        parenDepth === 0 &&
        (raw.includes("{") || raw.includes(":") || raw.includes("=>") || !raw.includes("("))
      ) {
        inSignature = false;
      }
      continue;
    }

    if (inSignature) {
      curEnd = l;
      for (const ch of raw) {
        if (ch === "(") parenDepth++;
        else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
      }
      if (parenDepth === 0 && (raw.includes("{") || raw.includes(":") || raw.includes("=>"))) {
        inSignature = false;
      }
      continue;
    }

    if (/^(?:while|for|if|switch|match|loop)\b/.test(trimmed)) {
      break;
    }

    const isSetupVar = /^(?:(?:export\s+)?(?:let|mut|const|var|val|auto)\s)/.test(trimmed);
    const isCommentOrBlank = trimmed === "" || /^(?:\/\/|\/\*|\*|#|--)/.test(trimmed);

    if (isSetupVar || isCommentOrBlank) {
      curEnd = l;
    } else {
      break;
    }
  }

  return [symStartLine, curEnd];
}

function findMatchingOutlineSymbol(
  symbols: OutlineSymbol[],
  targetName: string,
  className?: string,
  memberName?: string,
  parentName?: string,
): OutlineSymbol | undefined {
  for (const sym of symbols) {
    const fullName = parentName ? `${parentName}.${sym.name}` : sym.name;
    const colonName = parentName ? `${parentName}::${sym.name}` : sym.name;
    if (
      sym.name === targetName ||
      fullName === targetName ||
      colonName === targetName ||
      normalizeIdentForMatch(sym.name) === normalizeIdentForMatch(targetName) ||
      normalizeIdentForMatch(fullName) === normalizeIdentForMatch(targetName)
    ) {
      return sym;
    }
    if (
      className &&
      (sym.name === className ||
        normalizeIdentForMatch(sym.name) === normalizeIdentForMatch(className))
    ) {
      if (sym.children) {
        for (const child of sym.children) {
          if (
            child.name === memberName ||
            normalizeIdentForMatch(child.name) === normalizeIdentForMatch(memberName ?? "")
          ) {
            return child;
          }
        }
      }
    }
    if (sym.children && sym.children.length > 0) {
      const childHit = findMatchingOutlineSymbol(
        sym.children,
        targetName,
        className,
        memberName,
        sym.name,
      );
      if (childHit) return childHit;
    }
  }
  return undefined;
}

function resolveSymbolDiskLineRange(
  rawSource: string,
  diskLines: string[],
  filePath: string,
  symbolName: string,
  projectRoot: string,
): { symStartLine: number; symEndLine: number } {
  const parts = symbolName.split(/\.|::/);
  const className = parts.length >= 2 ? parts[0]!.trim() : undefined;
  const memberName = parts.length >= 2 ? parts.slice(1).join(".").trim() : symbolName;
  const detectedLang = detectTargetFromPathOrContent(filePath, rawSource);

  let symStartLine: number | undefined;
  let symEndLine: number | undefined;

  // 1. Try locateNativeDeclarationSpan
  if (detectedLang !== "passthrough") {
    try {
      let span = locateNativeDeclarationSpan(rawSource, symbolName, detectedLang, className);
      if (!span && className) {
        span = locateNativeDeclarationSpan(rawSource, memberName, detectedLang, className);
      }
      if (span && span.declEnd > (span.fullDeclStart ?? span.declStart)) {
        const fullStartOff = span.fullDeclStart ?? span.declStart;
        symStartLine = span.startLine ?? rawSource.slice(0, fullStartOff).split(/\r?\n/).length;
        symEndLine = span.endLine ?? rawSource.slice(0, span.declEnd).split(/\r?\n/).length;
      }
    } catch {
      // ignore
    }
  }

  // 2. Try generateOutline (supporting AIPL, TS, etc.)
  if (symStartLine === undefined || symEndLine === undefined || symEndLine <= symStartLine) {
    try {
      const outlineRes = generateOutline(rawSource, {
        filePath,
        lineRanges: true,
        skipTokenStats: true,
        includeTypes: true,
      });
      const found = findMatchingOutlineSymbol(
        outlineRes.symbols,
        symbolName,
        className,
        memberName,
      );
      if (found) {
        if (symStartLine === undefined) {
          symStartLine = found.line;
        }
        if (found.endLine && found.endLine >= found.line) {
          symEndLine = found.endLine;
        } else if (found.lineRange) {
          const parsedRange = parseSelectorLineRange(found.lineRange);
          if (parsedRange?.endLine && parsedRange.endLine >= found.line) {
            symEndLine = parsedRange.endLine;
          }
        }
      }
    } catch {
      // ignore
    }
  }

  // 3. Fallback scan for declaration line if not yet resolved
  if (symStartLine === undefined) {
    const escapedShort = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const declRe = new RegExp(
      `(?:^|\\b)(?:function|fn|def|func|class|interface|type)\\s+${escapedShort}\\b`,
    );
    for (let l = 1; l <= diskLines.length; l++) {
      if (declRe.test(diskLines[l - 1] ?? "")) {
        symStartLine = l;
        break;
      }
    }
  }

  // 4. Fallback brace / indentation scan for endLine
  if (symStartLine !== undefined && (symEndLine === undefined || symEndLine <= symStartLine)) {
    let openBraces = 0;
    let seenOpen = false;
    for (let l = symStartLine; l <= diskLines.length; l++) {
      const ln = diskLines[l - 1] ?? "";
      for (const ch of ln) {
        if (ch === "{") {
          openBraces++;
          seenOpen = true;
        } else if (ch === "}") {
          openBraces--;
        }
      }
      if (seenOpen && openBraces <= 0) {
        symEndLine = l;
        break;
      }
    }
    if (symEndLine === undefined || symEndLine <= symStartLine) {
      symEndLine = diskLines.length;
    }
  }

  if (symStartLine === undefined) {
    const displayPath = formatDisplayPath(filePath, projectRoot);
    throw new Error(
      `Symbol '${symbolName}' not found in ${displayPath}${didYouMeanSymbol(rawSource, symbolName)}`,
    );
  }

  symStartLine = Math.max(1, Math.min(diskLines.length, symStartLine));
  symEndLine = Math.max(symStartLine, Math.min(diskLines.length, symEndLine ?? symStartLine));

  return { symStartLine, symEndLine };
}

export function extractSymbolFocusSlice(
  rawSource: string,
  filePath: string,
  symbolName: string,
  rawPattern: string,
  options?: { projectRoot?: string },
): string {
  const cleanRaw = rawSource.length > 0 ? rawSource.replace(/\r?\n$/, "") : "";
  const diskLines = cleanRaw.length > 0 ? cleanRaw.split(/\r?\n/) : [""];
  const projectRoot = options?.projectRoot ?? findProjectRoot(filePath, process.cwd());
  const relPath = formatDisplayPath(filePath, projectRoot);

  const { symStartLine, symEndLine } = resolveSymbolDiskLineRange(
    rawSource,
    diskLines,
    filePath,
    symbolName,
    projectRoot,
  );

  const patternRegex = compileFocusPattern(rawPattern);
  const [setupStart, setupEnd] = computeHeaderSetupRange(diskLines, symStartLine, symEndLine);

  let matchCount = 0;
  const rawWindows: Array<{ start: number; end: number }> = [{ start: setupStart, end: setupEnd }];

  for (let l = symStartLine; l <= symEndLine; l++) {
    const lineText = diskLines[l - 1] ?? "";
    if (patternRegex.test(lineText)) {
      matchCount++;
      rawWindows.push({
        start: Math.max(symStartLine, l - 6),
        end: Math.min(symEndLine, l + 6),
      });
    }
  }

  const header = `// ${relPath}:${symbolName}@${rawPattern}`;

  if (matchCount === 0) {
    const out: string[] = [header];
    for (let l = setupStart; l <= setupEnd; l++) {
      out.push(`${l}: ${diskLines[l - 1]}`);
    }
    out.push(
      `// [0 lines matched '${rawPattern}' inside ${symbolName} L${symStartLine}-L${symEndLine}]`,
    );
    return out.join("\n");
  }

  rawWindows.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged = rawWindows.reduce<typeof rawWindows>((acc, w) => {
    const prev = acc[acc.length - 1];
    if (!prev) {
      acc.push({ ...w });
    } else if (w.start - prev.end - 1 <= 2) {
      prev.end = Math.max(prev.end, w.end);
    } else {
      acc.push({ ...w });
    }
    return acc;
  }, []);

  const out: string[] = [header];

  for (let i = 0; i < merged.length; i++) {
    const cur = merged[i]!;
    if (i > 0) {
      const gapStart = merged[i - 1]!.end + 1;
      const gapEnd = cur.start - 1;
      const gapCount = gapEnd - gapStart + 1;
      out.push(`// ... [L${gapStart}-L${gapEnd} skipped — ${gapCount} unrelated lines] ...`);
    }
    for (let l = cur.start; l <= cur.end; l++) {
      out.push(`${l}: ${diskLines[l - 1]}`);
    }
  }

  const lastEnd = merged[merged.length - 1]!.end;
  if (lastEnd < symEndLine && symEndLine - lastEnd > 2) {
    const gapStart = lastEnd + 1;
    const gapEnd = symEndLine;
    const gapCount = gapEnd - gapStart + 1;
    out.push(`// ... [L${gapStart}-L${gapEnd} skipped — ${gapCount} unrelated lines] ...`);
  }

  return out.join("\n");
}

export function extractSymbolFromAiceSource(
  aiceSource: string,
  symbolSelector: string,
  filePath: string,
  preParsedMod?: Module,
  options?: {
    numberLines?: boolean;
    clampOutOfBounds?: boolean;
    rawNative?: boolean;
    contextLines?: number;
    surface?: "cli" | "mcp";
    elideLargeLineRange?: boolean;
    forceElideLargeLineRange?: boolean;
    full?: boolean;
    dsl?: boolean;
    projectRoot?: string;
  },
): string {
  let trimmedSel = symbolSelector.trim();
  const rawFileSource =
    !filePath.endsWith(".aice") && fs.existsSync(filePath)
      ? fs.readFileSync(filePath, "utf-8")
      : aiceSource;

  const symPat = parseSymbolPatternSelector(trimmedSel);
  if (symPat) {
    return extractSymbolFocusSlice(rawFileSource, filePath, symPat.symbol, symPat.pattern, options);
  }

  const symOrdinalMatch = trimmedSel.match(/^([^@]+)@(first|\d+)$/i);
  if (symOrdinalMatch) {
    trimmedSel = symOrdinalMatch[1]!.trim();
  }

  const finalizeExtracted = (text: string, startLine = 1): string => {
    const lineCount = text.split("\n").length;
    if (options?.rawNative) {
      const clean = text.replace(/\r?\n$/, "");
      const endLine = startLine + Math.max(0, clean.split(/\r?\n/).length - 1);
      return `// @span:${startLine}-${endLine}\n${clean}`;
    }
    if (lineCount > 25) {
      return formatWithLineNumbers(text, startLine);
    }
    return text;
  };

  const sliceExactDiskLines = (startLine: number, endLine: number): string => {
    const cleanRaw = rawFileSource.length > 0 ? rawFileSource.replace(/\r?\n$/, "") : "";
    const diskLines = cleanRaw.length > 0 ? cleanRaw.split(/\r?\n/) : [""];
    const s = Math.max(1, Math.min(diskLines.length, startLine));
    const e = Math.max(s, Math.min(diskLines.length, endLine));
    if (options?.rawNative) {
      const sliceLines: string[] = [];
      let needResumeNum = false;
      for (let l = s; l <= e; l++) {
        const ln = diskLines[l - 1] ?? "";
        if (!options.full && isDecorativeDividerComment(ln.trim())) {
          needResumeNum = true;
          continue;
        }
        if (needResumeNum) {
          sliceLines.push(`${l}: ${ln}`);
          needResumeNum = false;
        } else {
          sliceLines.push(ln);
        }
      }
      return `// @span:${s}-${e}\n${sliceLines.join("\n")}`;
    }
    return diskLines
      .slice(s - 1, e)
      .map((ln, idx) => `${s + idx}│ ${ln}`)
      .join("\n");
  };

  if (trimmedSel.includes(",") && /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i.test(trimmedSel)) {
    const rangePieces = splitSymbolSelectors(trimmedSel);
    if (rangePieces.length > 1) {
      let combinedSpan = 0;
      for (const piece of rangePieces) {
        const rm = piece.trim().match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
        if (!rm?.[1]) continue;
        const s = Number.parseInt(rm[1], 10);
        const e = rm[2] ? Number.parseInt(rm[2], 10) : s;
        if (e >= s) combinedSpan += e - s + 1;
      }
      const subOpts =
        options?.elideLargeLineRange && combinedSpan > 110
          ? { ...options, forceElideLargeLineRange: true }
          : options;
      return rangePieces
        .map((piece) => {
          const block = extractSymbolFromAiceSource(
            aiceSource,
            piece,
            filePath,
            preParsedMod,
            subOpts,
          );
          if (block.startsWith("// @span:")) {
            const nl = block.indexOf("\n");
            if (nl > 0) {
              const sp = block.slice("// @span:".length, nl).trim();
              return `// L${sp}\n${block.slice(nl + 1)}`;
            }
          }
          return block;
        })
        .join("\n\n");
    }
  }

  const lineRangeMatch = trimmedSel.match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
  if (lineRangeMatch) {
    const startLine = Number.parseInt(lineRangeMatch[1]!, 10);
    const endLine = lineRangeMatch[2] ? Number.parseInt(lineRangeMatch[2], 10) : startLine;
    const rawLines = rawFileSource.split(/\r?\n/);
    const totalLines = rawLines.length;
    if (startLine < 1) {
      throw new Error(`Invalid line range L${startLine}-L${endLine}: start line must be >= 1`);
    }
    if (startLine > totalLines) {
      if (options?.clampOutOfBounds || totalLines > 10) {
        const clampedStart = Math.max(1, totalLines - 29);
        const clampedEnd = totalLines;
        const clampedLines = rawLines
          .slice(clampedStart - 1, clampedEnd)
          .map((ln, idx) =>
            options?.rawNative ? `${clampedStart + idx}: ${ln}` : `${clampedStart + idx}│ ${ln}`,
          )
          .join("\n");
        return `[Clamped L${startLine}-L${endLine} -> L${clampedStart}-L${clampedEnd} (EOF)]\n${clampedLines}`;
      }
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: file has ${totalLines} line(s) (1-based inclusive). Start line ${startLine} exceeds file length. Use ':eof' or ':append' to add content at end of file.`,
      );
    }
    if (startLine > endLine) {
      throw new Error(
        `Invalid line range L${startLine}-L${endLine}: start line (${startLine}) cannot be greater than end line (${endLine})`,
      );
    }
    const clampedEnd = Math.min(endLine, totalLines);
    const lineSpan = endLine - startLine + 1;
    if ((lineSpan > 110 || options?.forceElideLargeLineRange) && options?.elideLargeLineRange) {
      return formatLargeLineRangeWithElision(rawLines, startLine, clampedEnd);
    }
    if (options?.rawNative) {
      const importBlock =
        !options.full && lineSpan >= 10
          ? detectContiguousImportBlock(rawLines, startLine, clampedEnd)
          : undefined;
      const outSlice: string[] = [];
      let resumeNumberAfterFold = false;
      for (let l = startLine; l <= clampedEnd; l++) {
        if (importBlock && l >= importBlock.impStart && l <= importBlock.impEnd) {
          const foldedCount = importBlock.impEnd - importBlock.impStart + 1;
          outSlice.push(
            `// [L${importBlock.impStart}-L${importBlock.impEnd}: ${foldedCount} imports — :imports]`,
          );
          l = importBlock.impEnd;
          resumeNumberAfterFold = true;
          continue;
        }
        const ln = rawLines[l - 1] ?? "";
        if (resumeNumberAfterFold) {
          outSlice.push(`${l}: ${ln}`);
          resumeNumberAfterFold = false;
        } else {
          outSlice.push(ln);
        }
      }
      return `// @span:${startLine}-${clampedEnd}\n${outSlice.join("\n")}`;
    }
    const sliceLines = rawLines.slice(startLine - 1, clampedEnd);
    if (options?.numberLines || sliceLines.length > 25) {
      return sliceLines.map((ln, idx) => `${startLine + idx}│ ${ln}`).join("\n");
    }
    return sliceLines.join("\n");
  }

  // R5: Unquoted `file:/foo|bar/` in shell splits on `|`, leaving `/foo` without closing `/`
  if (trimmedSel.startsWith("/") && trimmedSel.length > 1 && trimmedSel.indexOf("/", 1) === -1) {
    const rawPrefix = trimmedSel.slice(1).trim();
    const hint = `// Hint: quote regex selectors in shell: '${filePath}:/${rawPrefix}|.../'`;
    if (rawPrefix) {
      const escapedPrefix = rawPrefix.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
      const hit = extractPatternMatchesFromSource(
        rawFileSource,
        `/${escapedPrefix}/`,
        options?.contextLines,
        {
          filePath,
          projectRoot: options?.projectRoot,
          isExplicitTestSearch: true,
          full: options?.full,
          dsl: options?.dsl,
          compactGrouped: Boolean(options?.rawNative),
        },
      );
      if (hit) {
        return options?.rawNative
          ? `// @preformatted\n${hint}\n${filePath}:\n${hit}`
          : `${hint}\n${hit}`;
      }
    }
    throw new Error(
      `Unclosed regex selector '${trimmedSel}'. Quote regex selectors containing '|' in shell: '${filePath}:/${rawPrefix || "pattern"}|.../'`,
    );
  }

  if (/^\/.+\/[gimsuy]*(?:\s*,\s*\/[^\n]+\/[gimsuy]*)*$/.test(trimmedSel)) {
    const pieces = splitSymbolSelectors(trimmedSel);
    const useCompactSearch = Boolean(options?.rawNative);
    const rankOpts: PatternMatchRankingOptions = {
      filePath,
      projectRoot: options?.projectRoot,
      isExplicitTestSearch: true,
      full: options?.full,
      dsl: options?.dsl,
      compactGrouped: useCompactSearch,
    };
    const matchOneRegex = (piece: string): string | undefined => {
      const nativeHit = extractPatternMatchesFromSource(
        rawFileSource,
        piece,
        options?.contextLines,
        rankOpts,
      );
      const aiceHit =
        aiceSource !== rawFileSource && /\$[A-Za-z_]/.test(piece)
          ? extractPatternMatchesFromSource(aiceSource, piece, options?.contextLines, rankOpts)
          : undefined;
      if (nativeHit && aiceHit) {
        return `${nativeHit.trimEnd()}\n${aiceHit.trimEnd()}`;
      }
      return nativeHit ?? aiceHit;
    };
    const relDisp = options?.projectRoot
      ? formatDisplayPath(filePath, options.projectRoot)
      : filePath;
    if (pieces.length > 1) {
      const results: string[] = [];
      for (const piece of pieces) {
        const m = matchOneRegex(piece);
        if (m) results.push(m.trimEnd());
      }
      if (results.length > 0) {
        return useCompactSearch
          ? `// @preformatted\n${relDisp}:\n${results.join("\n")}`
          : results.join("\n\n");
      }
      return useCompactSearch
        ? `// @preformatted\n// 0 matches for '${symbolSelector}' in ${relDisp}`
        : `// Patterns '${symbolSelector}' had 0 matches in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}\n`;
    }
    const matched = matchOneRegex(trimmedSel);
    if (matched) {
      return useCompactSearch ? `// @preformatted\n${relDisp}:\n${matched.trimEnd()}` : matched;
    }
    return useCompactSearch
      ? `// @preformatted\n// 0 matches for '${symbolSelector}' in ${relDisp}`
      : `// Pattern '${symbolSelector}' had 0 matches in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}\n`;
  }
  if (trimmedSel === "@first" || trimmedSel === "@1") {
    const first =
      resolveFirstActionableSymbol(aiceSource, filePath, preParsedMod) ??
      resolveFirstActionableSymbol(rawFileSource, filePath, preParsedMod);
    if (first) trimmedSel = first;
  }

  const isLeadingDotOrHash = trimmedSel.startsWith(".") || trimmedSel.startsWith("#");
  const parts = isLeadingDotOrHash ? [trimmedSel] : trimmedSel.split(/\.|::/);
  const className = parts.length >= 2 ? parts[0]!.trim() : undefined;
  const memberName = parts.length >= 2 ? parts.slice(1).join(".").trim() : trimmedSel;
  const normMember = normalizeIdentForMatch(memberName);

  if (!filePath.endsWith(".aice")) {
    const detected = detectTargetFromPathOrContent(filePath, rawFileSource);
    if (
      detected === "passthrough" ||
      detected === "java" ||
      detected === "xml" ||
      detected === "text"
    ) {
      if (trimmedSel.toLowerCase() === "imports" || trimmedSel.toLowerCase() === "import") {
        const passthroughSyms = extractPassthroughStructuralSymbols(rawFileSource, filePath, 1);
        const impSym = passthroughSyms.find((s) => s.kind === "import");
        if (impSym && impSym.endLine) {
          return sliceExactDiskLines(impSym.line, impSym.endLine);
        }
      }
      const passthroughSyms = extractPassthroughStructuralSymbols(rawFileSource, filePath, 2);
      const foundSym = findMatchingOutlineSymbol(
        passthroughSyms,
        trimmedSel,
        className,
        memberName,
      );
      if (foundSym) {
        const eLine =
          foundSym.endLine && foundSym.endLine >= foundSym.line ? foundSym.endLine : foundSym.line;
        return sliceExactDiskLines(foundSym.line, eLine);
      }
    } else if (options?.rawNative) {
      const natSpan = className
        ? locateNativeDeclarationSpan(rawFileSource, trimmedSel, detected, className)
        : locateNativeDeclarationSpan(rawFileSource, trimmedSel, detected);
      if (natSpan && natSpan.declEnd > (natSpan.fullDeclStart ?? natSpan.declStart)) {
        const fullStartOff = natSpan.fullDeclStart ?? natSpan.declStart;
        const sLine = rawFileSource.slice(0, fullStartOff).split(/\r?\n/).length;
        const endSlice = rawFileSource
          .slice(0, Math.max(fullStartOff, natSpan.declEnd))
          .replace(/\r?\n$/, "");
        const eLine = Math.max(sLine, endSlice.split(/\r?\n/).length);
        return sliceExactDiskLines(sLine, eLine);
      }
    }
  }
  if (!filePath.endsWith(".aice")) {
    const targetLang = detectTargetFromPath(filePath);
    if (
      targetLang === "markdown" ||
      targetLang === "shell" ||
      targetLang === "powershell" ||
      targetLang === "batch" ||
      targetLang === "aipl"
    ) {
      const spanInfo = locateNativeDeclarationSpan(rawFileSource, trimmedSel, targetLang);
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
      if (className) {
        const parentFallback = resolveParentMemberFallback(
          rawFileSource,
          aiceSource,
          className,
          memberName,
          filePath,
          preParsedMod,
        );
        if (parentFallback) {
          return finalizeExtracted(parentFallback.text, parentFallback.startLine);
        }
      }
      const patternFallback = extractPatternMatchesFromSource(
        rawFileSource,
        trimmedSel,
        options?.contextLines,
        {
          filePath,
          projectRoot: options?.projectRoot,
          isExplicitTestSearch: true,
          full: options?.full,
          dsl: options?.dsl,
        },
      );
      if (patternFallback) return patternFallback;
      throw new Error(
        `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
      );
    }
  }

  if (!filePath.endsWith(".aice") && rawFileSource.length > 50_000 && !preParsedMod) {
    const targetLang = detectTargetFromPath(filePath);
    const spanInfo = locateNativeDeclarationSpan(rawFileSource, trimmedSel, targetLang);
    if (spanInfo) {
      const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
      const rawSlice = rawFileSource.slice(startOff, spanInfo.declEnd);
      const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
      if (rawSlice.split(/\r?\n/).length > 25) {
        return finalizeExtracted(rawSlice, sLine);
      }
      try {
        const snippetToDecompile =
          spanInfo.className &&
          !/^(?:export\s+|function\s+|class\s+|const\s+|let\s+|var\s+|interface\s+|type\s+)/.test(
            rawSlice.trim(),
          )
            ? `class ${spanInfo.className} {\n${rawSlice}\n}`
            : rawSlice;
        const miniDecomp = withSuppressedTelemetry(() =>
          decompile(snippetToDecompile, targetLang, { filePath }),
        );
        if (miniDecomp.ast.items.length > 0) {
          return finalizeExtracted(AiceGenerator.generate(miniDecomp.ast), sLine);
        }
      } catch {
        // fall back to rawSlice
      }
      return finalizeExtracted(rawSlice, sLine);
    }
  }

  let mod: Module | undefined = preParsedMod;
  if (!mod && !filePath.endsWith(".aice") && aiceSource === rawFileSource) {
    const detected = detectTargetFromPathOrContent(filePath, rawFileSource);
    if (
      detected !== "passthrough" &&
      detected !== "xml" &&
      detected !== "java" &&
      detected !== "text"
    ) {
      try {
        const decomp = withSuppressedTelemetry(() =>
          decompile(rawFileSource, detected, { filePath }),
        );
        aiceSource = decomp.aice;
        mod = decomp.ast;
      } catch {
        // fall through to parse / fallback
      }
    }
  }
  if (!mod) {
    try {
      mod = parse(aiceSource, filePath);
    } catch {
      mod = undefined;
    }
  }
  if (!mod) {
    if (!filePath.endsWith(".aice")) {
      const spanInfo = locateNativeDeclarationSpan(
        rawFileSource,
        trimmedSel,
        detectTargetFromPath(filePath),
      );
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
      if (className) {
        const parentFallback = resolveParentMemberFallback(
          rawFileSource,
          aiceSource,
          className,
          memberName,
          filePath,
          undefined,
        );
        if (parentFallback) {
          return finalizeExtracted(parentFallback.text, parentFallback.startLine);
        }
      }
    }
    const patternFallback = extractPatternMatchesFromSource(
      rawFileSource,
      trimmedSel,
      options?.contextLines,
      {
        filePath,
        projectRoot: options?.projectRoot,
        isExplicitTestSearch: true,
        full: options?.full,
        dsl: options?.dsl,
      },
    );
    if (patternFallback) return patternFallback;
    throw new Error(
      `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
    );
  }
  if (trimmedSel === "@first" || trimmedSel === "@1") {
    const first = resolveFirstActionableSymbol(aiceSource, filePath, mod);
    if (first) trimmedSel = first;
  }
  if (trimmedSel.toLowerCase() === "imports" || trimmedSel.toLowerCase() === "import") {
    const impItems = mod.items.filter((it) => it.kind === "ImportDecl");
    if (impItems.length > 0) {
      return AiceGenerator.generate({
        kind: "Module",
        path: mod.path,
        items: impItems,
        span: mod.span,
      });
    }
  }
  for (const item of mod.items) {
    if (item.kind === "StyleDecl") {
      const bareItem = item.name.replace(/^[.#]/, "");
      const bareSel = trimmedSel.replace(/^[.#]/, "");
      if (
        item.name === trimmedSel ||
        bareItem === bareSel ||
        normalizeIdentForMatch(bareItem) === normalizeIdentForMatch(bareSel)
      ) {
        const scopedMod: Module = {
          kind: "Module",
          path: mod.path,
          items: [item],
          span: mod.span,
        };
        return AiceGenerator.generate(scopedMod);
      }
    }
  }

  const matchedItems: ModuleItem[] = [];

  for (const item of mod.items) {
    if (className) {
      if (
        item.kind === "ClassDecl" &&
        (item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))
      ) {
        let matchedMethods = item.methods.filter((m) => m.name === memberName);
        if (matchedMethods.length === 0) {
          matchedMethods = item.methods.filter(
            (m) => normalizeIdentForMatch(m.name) === normMember,
          );
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter(
            (p) => normalizeIdentForMatch(p.name) === normMember,
          );
        }
        if (matchedMethods.length === 0 && matchedProps.length > 0 && !filePath.endsWith(".aice")) {
          const nativePropSpan = locateNativeDeclarationSpan(
            rawFileSource,
            trimmedSel,
            detectTargetFromPath(filePath),
            className,
          );
          if (nativePropSpan) {
            const startOff = nativePropSpan.fullDeclStart ?? nativePropSpan.declStart;
            const propSlice = rawFileSource.slice(startOff, nativePropSpan.declEnd);
            if (propSlice.includes("=>") || propSlice.split(/\r?\n/).length > 1) {
              const sLine =
                nativePropSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
              return finalizeExtracted(propSlice, sLine);
            }
          }
        }
        if (matchedMethods.length > 0 || matchedProps.length > 0) {
          const scopedClass: ClassDecl = {
            ...item,
            properties: matchedProps,
            methods: matchedMethods,
            staticBlocks: [],
          };
          matchedItems.push(scopedClass);
        }
      } else if (
        item.kind === "TypeDecl" &&
        (item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className))
      ) {
        const matchedFields = (item.fields ?? []).filter(
          (f) => f.name === memberName || normalizeIdentForMatch(f.name) === normMember,
        );
        const matchedVariants = (item.variants ?? []).filter(
          (v) => v.name === memberName || normalizeIdentForMatch(v.name) === normMember,
        );
        if (matchedFields.length > 0 || matchedVariants.length > 0) {
          matchedItems.push({
            ...item,
            fields: matchedFields.length > 0 ? matchedFields : item.fields,
            variants: matchedVariants.length > 0 ? matchedVariants : item.variants,
          });
        }
      } else if (item.kind === "ConstDecl" && item.value.kind === "RecordLiteralExpr") {
        const keyParts =
          item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
            ? parts.slice(1)
            : parts;
        const sliced = sliceRecordLiteralByPath(item.value, keyParts);
        if (sliced) {
          matchedItems.push({
            ...item,
            name: sliced.leafName,
            value: sliced.value,
          });
        }
      } else if (item.kind === "ComponentDecl") {
        const layoutSel =
          item.name === className ||
          normalizeIdentForMatch(item.name) === normalizeIdentForMatch(className)
            ? memberName
            : trimmedSel;
        const matchedLayout = matchLayoutNodes(item.layout, layoutSel);
        if (matchedLayout.length > 0) {
          matchedItems.push({
            ...item,
            layout: matchedLayout,
          });
        }
      }
    } else {
      if (
        (item.kind === "FunctionDecl" ||
          item.kind === "ClassDecl" ||
          item.kind === "TypeDecl" ||
          item.kind === "ConstDecl" ||
          item.kind === "VarDecl" ||
          item.kind === "ComponentDecl") &&
        (item.name === memberName || normalizeIdentForMatch(item.name) === normMember)
      ) {
        matchedItems.push(item);
      } else if (item.kind === "ClassDecl") {
        let matchedMethods = item.methods.filter((m) => m.name === memberName);
        if (matchedMethods.length === 0) {
          matchedMethods = item.methods.filter(
            (m) => normalizeIdentForMatch(m.name) === normMember,
          );
        }
        let matchedProps = item.properties.filter((p) => p.name === memberName);
        if (matchedProps.length === 0) {
          matchedProps = item.properties.filter(
            (p) => normalizeIdentForMatch(p.name) === normMember,
          );
        }
        if (matchedMethods.length > 0 || matchedProps.length > 0) {
          const scopedClass: ClassDecl = {
            ...item,
            properties: matchedProps,
            methods: matchedMethods,
            staticBlocks: [],
          };
          matchedItems.push(scopedClass);
        }
      } else if (item.kind === "ConstDecl" && item.value.kind === "RecordLiteralExpr") {
        const sliced = sliceRecordLiteralByPath(item.value, [memberName]);
        if (sliced) {
          matchedItems.push({
            ...item,
            name: sliced.leafName,
            value: sliced.value,
          });
        }
      } else if (item.kind === "ComponentDecl") {
        const matchedLayout = matchLayoutNodes(item.layout, memberName);
        if (matchedLayout.length > 0) {
          matchedItems.push({
            ...item,
            layout: matchedLayout,
          });
        }
      }
    }
  }
  if (matchedItems.length === 0) {
    if (!filePath.endsWith(".aice")) {
      const spanInfo = locateNativeDeclarationSpan(
        rawFileSource,
        trimmedSel,
        detectTargetFromPath(filePath),
      );
      if (spanInfo) {
        const startOff = spanInfo.fullDeclStart ?? spanInfo.declStart;
        const sLine = spanInfo.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawFileSource.slice(startOff, spanInfo.declEnd), sLine);
      }
    }
    if (className) {
      const parentFallback = resolveParentMemberFallback(
        rawFileSource,
        aiceSource,
        className,
        memberName,
        filePath,
        mod,
      );
      if (parentFallback) {
        return finalizeExtracted(parentFallback.text, parentFallback.startLine);
      }
    }
    const patternFallback = extractPatternMatchesFromSource(
      rawFileSource,
      trimmedSel,
      options?.contextLines,
      {
        filePath,
        projectRoot: options?.projectRoot,
        isExplicitTestSearch: true,
        full: options?.full,
        dsl: options?.dsl,
      },
    );
    if (patternFallback) return patternFallback;
    throw new Error(
      `Symbol '${symbolSelector}' not found in ${filePath}${didYouMeanSymbol(rawFileSource, symbolSelector)}`,
    );
  }
  const scopedMod: Module = {
    kind: "Module",
    path: mod.path,
    items: matchedItems,
    span: mod.span,
  };
  let startLineForSym = matchedItems[0]?.span?.start?.line ?? 1;
  if (!filePath.endsWith(".aice")) {
    const natSpan = locateNativeDeclarationSpan(
      rawFileSource,
      trimmedSel,
      detectTargetFromPath(filePath),
    );
    if (natSpan?.startLine) {
      startLineForSym = natSpan.startLine;
    }
    if ((options?.rawNative || options?.numberLines) && natSpan) {
      const startOff = natSpan.fullDeclStart ?? natSpan.declStart;
      const rawSlice = rawFileSource.slice(startOff, natSpan.declEnd);
      if (options?.rawNative && natSpan.declEnd > startOff) {
        const sLine = rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        const endSlice = rawFileSource
          .slice(0, Math.max(startOff, natSpan.declEnd))
          .replace(/\r?\n$/, "");
        const eLine = Math.max(sLine, endSlice.split(/\r?\n/).length);
        return sliceExactDiskLines(sLine, eLine);
      }
      if (rawSlice.split(/\r?\n/).length > 25) {
        const sLine = natSpan.startLine ?? rawFileSource.slice(0, startOff).split(/\r?\n/).length;
        return finalizeExtracted(rawSlice, sLine);
      }
    }
  }
  if (
    options?.rawNative &&
    matchedItems.length === 1 &&
    matchedItems[0]?.span?.start?.line &&
    matchedItems[0]?.span?.end?.line &&
    matchedItems[0].span.end.line >= matchedItems[0].span.start.line
  ) {
    return sliceExactDiskLines(matchedItems[0].span.start.line, matchedItems[0].span.end.line);
  }
  return finalizeExtracted(
    AiceGenerator.generate(scopedMod, { omitModuleHeader: true }).trimEnd(),
    startLineForSym,
  );
}
