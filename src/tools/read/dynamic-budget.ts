/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { getCachedTsSymbolIndex } from "../../compat/typescript.js";
import { isLikelyTextFileShape, KNOWN_TEXT_FILENAMES } from "../../config/index.js";
import { withSuppressedTelemetry } from "../../telemetry/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { isDecorativeDividerComment } from "../context.js";
import {
  generateOutline,
  isSupportedReadDiskFile,
  type OutlineResult,
  type OutlineSymbol,
} from "../outline.js";
import { isPureRegexSelector, splitCommaSelectors } from "./target-parsing.js";
import {
  countSourceLines,
  DEFAULT_CLI_SLICE_BYTE_BUDGET,
  DEFAULT_READ_MAX_BYTES,
  DEFAULT_READ_MAX_TOKENS,
  DEFAULT_READ_SOFT_BYTE_CAP,
  DEFAULT_READ_SOFT_TOKEN_CAP,
  DEFAULT_SLICE_BYTE_BUDGET,
  LINE_RANGE_SELECTOR_RE,
  type NormalizedReadTarget,
  type ReadOptions,
} from "./types-and-budgets.js";

export interface DynamicReadBudgetCandidate {
  id: string;
  rawSource?: string;
  rawBytes?: number;
  lineCount?: number;
}

export interface DynamicReadBudgetAllocation {
  id: string;
  estimatedBytes: number;
  estimatedTokens: number;
  fitsInline: boolean;
}

export interface DynamicReadBudgetResult {
  maxBytes: number;
  maxTokens: number;
  softByteCap: number;
  softTokenCap: number;
  reservedBytes: number;
  reservedTokens: number;
  remainingBytes: number;
  remainingTokens: number;
  inlineIds: Set<string>;
  autoOutlineIds: Set<string>;
  allocations: DynamicReadBudgetAllocation[];
}

/**
 * Smallest-first water-filling allocator governed by `DEFAULT_READ_MAX_BYTES` (`28,672 B`,
 * `softByteCap = 26,624 B`) and `DEFAULT_READ_MAX_TOKENS` (`7,000`, `softTokenCap = 6,500`).
 * Estimates each bare file's numbered output bytes (`rawBytes + lineCount * 6`) so small/medium
 * files (`<= ~25 KB`, ~600-750 lines) settle inline in 1 turn while overflowing targets downgrade
 * cleanly to `:outline`.
 */
export function computeDynamicReadBudget(
  candidates: DynamicReadBudgetCandidate[],
  opts?: {
    maxBytes?: number;
    maxTokens?: number;
    softByteCap?: number;
    softTokenCap?: number;
    reservedBytes?: number;
    reservedTokens?: number;
  },
): DynamicReadBudgetResult {
  const maxBytes = opts?.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  const maxTokens = opts?.maxTokens ?? DEFAULT_READ_MAX_TOKENS;
  const softByteCap = opts?.softByteCap ?? DEFAULT_READ_SOFT_BYTE_CAP;
  const softTokenCap = opts?.softTokenCap ?? DEFAULT_READ_SOFT_TOKEN_CAP;
  const reservedBytes = Math.max(0, opts?.reservedBytes ?? 0);
  const reservedTokens = Math.max(0, opts?.reservedTokens ?? 0);

  let remainingBytes = Math.max(0, softByteCap - reservedBytes);
  let remainingTokens = Math.max(0, softTokenCap - reservedTokens);

  const enriched = candidates.map((c, index) => {
    const rawBytes =
      c.rawBytes ?? (c.rawSource !== undefined ? Buffer.byteLength(c.rawSource, "utf-8") : 0);
    const lineCount =
      c.lineCount ?? (c.rawSource !== undefined ? countSourceLines(c.rawSource) : 0);
    const estimatedBytes = rawBytes + lineCount * 6;
    const estimatedTokens = Math.ceil(estimatedBytes / 4.1);
    return {
      id: c.id,
      index,
      estimatedBytes,
      estimatedTokens,
      fitsInline: false,
    };
  });

  // Smallest-first water-filling so small files leave unused budget for larger targets
  const sortedBySize = [...enriched].sort(
    (a, b) => a.estimatedBytes - b.estimatedBytes || a.index - b.index,
  );

  const inlineIds = new Set<string>();
  const autoOutlineIds = new Set<string>();

  for (const entry of sortedBySize) {
    if (entry.estimatedBytes <= remainingBytes && entry.estimatedTokens <= remainingTokens) {
      entry.fitsInline = true;
      inlineIds.add(entry.id);
      remainingBytes -= entry.estimatedBytes;
      remainingTokens -= entry.estimatedTokens;
    } else {
      entry.fitsInline = false;
      autoOutlineIds.add(entry.id);
    }
  }

  return {
    maxBytes,
    maxTokens,
    softByteCap,
    softTokenCap,
    reservedBytes,
    reservedTokens,
    remainingBytes,
    remainingTokens,
    inlineIds,
    autoOutlineIds,
    allocations: enriched.map(({ id, estimatedBytes, estimatedTokens, fitsInline }) => ({
      id,
      estimatedBytes,
      estimatedTokens,
      fitsInline,
    })),
  };
}

export interface DynamicSliceSpanResult {
  startLine: number;
  endLine: number;
  totalLines: number;
  rawMaxLines: number;
  avgBytesPerLine: number;
  snappedToSymbol: boolean;
}

/**
 * Computes a density-proportional, AST symbol-boundary-snapped slice span `[startLine, endLine]`
 * so pagination hints (`Next slice: aice read <file>:L<start>-L<end>`) never cut functions in half.
 */
export function computeDynamicSliceSpan(
  diskPath: string,
  rawSource: string,
  startLine = 1,
  sliceByteBudget = DEFAULT_SLICE_BYTE_BUDGET,
): DynamicSliceSpanResult {
  const totalLines = Math.max(1, countSourceLines(rawSource));
  const sLine = Math.max(1, Math.min(totalLines, Math.floor(startLine) || 1));
  const isCliElisionMode = sliceByteBudget <= DEFAULT_CLI_SLICE_BYTE_BUDGET;
  let effectiveBytes = Buffer.byteLength(rawSource, "utf-8");
  if (isCliElisionMode) {
    const cleanRaw = rawSource.endsWith("\r\n")
      ? rawSource.slice(0, -2)
      : rawSource.endsWith("\n")
        ? rawSource.slice(0, -1)
        : rawSource;
    const rawLines = cleanRaw.length > 0 ? cleanRaw.split(/\r?\n/) : [];
    let keptBytes = 0;
    for (let i = 0; i < rawLines.length; i++) {
      const ln = rawLines[i]!;
      const trimmed = ln.trim();
      if (trimmed.length === 0 || isDecorativeDividerComment(trimmed)) {
        continue;
      }
      keptBytes += Buffer.byteLength(ln, "utf-8") + 1;
    }
    effectiveBytes = keptBytes;
  }
  const avgBytesPerLine = Math.max(16, effectiveBytes / Math.max(1, totalLines));
  const effectiveSliceBudget = isCliElisionMode
    ? Math.min(8_000, sliceByteBudget + 1_088)
    : sliceByteBudget;
  const maxLinesCap = isCliElisionMode ? 180 : 650;
  const rawMaxLines = Math.max(
    80,
    Math.min(maxLinesCap, Math.floor(effectiveSliceBudget / avgBytesPerLine)),
  );

  if (sLine + rawMaxLines - 1 >= totalLines) {
    return {
      startLine: sLine,
      endLine: totalLines,
      totalLines,
      rawMaxLines,
      avgBytesPerLine,
      snappedToSymbol: true,
    };
  }

  const symbolEndLines: number[] = [];
  if (/\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/i.test(diskPath)) {
    try {
      const tsIdx = getCachedTsSymbolIndex(rawSource, diskPath);
      for (const top of tsIdx.orderedTopLevel) {
        if (top.endLine >= sLine) {
          symbolEndLines.push(top.endLine);
        }
      }
      if (symbolEndLines.length === 0) {
        for (const tb of tsIdx.testBlocks) {
          if (tb.endLine >= sLine) {
            symbolEndLines.push(tb.endLine);
          }
        }
      }
    } catch {
      // fall back to rawMaxLines
    }
  } else {
    if (
      isLikelyTextFileShape(diskPath) ||
      isSupportedReadDiskFile(diskPath, {
        allowDotfiles: true,
        allowLockfiles: true,
        allowRootAgentDocs: true,
      })
    ) {
      try {
        const outRes = withSuppressedTelemetry(() =>
          generateOutline(rawSource, diskPath, {
            includeTypes: true,
            skipTokenStats: true,
            lineRanges: true,
            depth: 1,
            idioms: false,
          }),
        );
        for (const sym of outRes.symbols) {
          if (sym.endLine !== undefined && sym.endLine >= sLine) {
            symbolEndLines.push(sym.endLine);
          } else if (sym.lineRange) {
            const m = sym.lineRange.match(/\[L\d+-L(\d+)\]/i);
            if (m?.[1]) {
              const parsedEnd = Number.parseInt(m[1], 10);
              if (parsedEnd >= sLine) symbolEndLines.push(parsedEnd);
            }
          }
        }
      } catch {
        // fall back to rawMaxLines
      }
    }
  }

  const maxCandidateEnd = Math.min(totalLines, sLine + rawMaxLines);
  const minAdvance = Math.floor(rawMaxLines * 0.5);
  let bestSnapEnd: number | undefined;
  for (const symEnd of symbolEndLines) {
    if (symEnd <= maxCandidateEnd && symEnd - sLine + 1 >= minAdvance) {
      if (bestSnapEnd === undefined || symEnd > bestSnapEnd) {
        bestSnapEnd = symEnd;
      }
    }
  }

  if (bestSnapEnd !== undefined) {
    return {
      startLine: sLine,
      endLine: bestSnapEnd,
      totalLines,
      rawMaxLines,
      avgBytesPerLine,
      snappedToSymbol: true,
    };
  }

  return {
    startLine: sLine,
    endLine: Math.min(totalLines, sLine + rawMaxLines - 1),
    totalLines,
    rawMaxLines,
    avgBytesPerLine,
    snappedToSymbol: false,
  };
}

export function splitPathAndSelector(raw: string): { filePath: string; selector?: string } {
  const trimmed = raw.trim();
  const searchStart = /^[a-zA-Z]:[\\/]/.test(trimmed) ? 2 : 0;
  const colonIdx = trimmed.indexOf(":", searchStart);
  if (colonIdx > 0) {
    return {
      filePath: trimmed.slice(0, colonIdx).trim(),
      selector: trimmed.slice(colonIdx + 1).trim(),
    };
  }
  return {
    filePath: trimmed,
  };
}

export function parseSelectorLineRange(
  selector?: string,
): { startLine: number; endLine?: number } | undefined {
  if (!selector) return undefined;
  const trimmed = selector.trim();
  const single = trimmed.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
  if (single?.[1]) {
    const startLine = Number.parseInt(single[1], 10);
    const endLine = single[2] ? Number.parseInt(single[2], 10) : undefined;
    return { startLine, endLine };
  }
  if (LINE_RANGE_SELECTOR_RE.test(trimmed)) {
    const parts = splitCommaSelectors(trimmed);
    let minStart: number | undefined;
    let maxEnd: number | undefined;
    for (const part of parts) {
      const m = part.trim().match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
      if (!m?.[1]) continue;
      const s = Number.parseInt(m[1], 10);
      const e = m[2] ? Number.parseInt(m[2], 10) : s;
      minStart = minStart === undefined ? s : Math.min(minStart, s);
      maxEnd = maxEnd === undefined ? e : Math.max(maxEnd, e);
    }
    if (minStart !== undefined) {
      return { startLine: minStart, endLine: maxEnd };
    }
  }
  return undefined;
}

const VALID_AST_HINT_IDENT_RE = /^[A-Za-z_$][A-Za-z0-9_$.]*$/;
const NON_SYMBOL_HINT_KINDS = new Set(["import", "module", "style", "section", "component"]);
const PRIMARY_CALLABLE_HINT_KINDS = new Set(["function", "method", "class", "struct", "enum"]);
const NON_AST_SYMBOL_HINT_EXT_RE =
  /\.(?:md|markdown|css|scss|sass|less|jsonc?|ya?ml|toml|html?|svg|xml|txt|csv|tsv|hebar|cff|lock|ini|env)$/i;
const CODE_EXT_FOR_REGEX_HINT_RE =
  /\.(?:[cm]?[jt]sx?|py|aipl|go|rs|java|kt|kts|cs|php|rb|swift|c|cc|cpp|h|hpp|sh|bash|zsh)$/i;

export function extractRepresentativeSymbolHints(opts: {
  symbols?: OutlineSymbol[];
  rawSource?: string;
  diskPath?: string;
  displayPath?: string;
  projectRoot?: string;
  excludeSymbol?: string;
  maxCount?: number;
}): string[] {
  const maxCount = opts.maxCount ?? 2;
  const cleanExclude = opts.excludeSymbol?.trim();
  const fileRef = opts.diskPath ?? opts.displayPath ?? "";
  if (fileRef && NON_AST_SYMBOL_HINT_EXT_RE.test(fileRef)) {
    return [];
  }

  let resolvedDiskPath = opts.diskPath;
  if (!resolvedDiskPath && opts.displayPath) {
    const cleanDisp = splitPathAndSelector(opts.displayPath).filePath.trim();
    if (cleanDisp && cleanDisp !== ".") {
      const candidates = [
        opts.projectRoot ? path.resolve(opts.projectRoot, cleanDisp) : undefined,
        path.isAbsolute(cleanDisp) ? cleanDisp : path.resolve(process.cwd(), cleanDisp),
      ];
      for (const cand of candidates) {
        if (cand && fs.existsSync(cand)) {
          try {
            if (fs.statSync(cand).isFile()) {
              resolvedDiskPath = cand;
              break;
            }
          } catch {
            // ignore stat errors
          }
        }
      }
    }
  }
  if (resolvedDiskPath && NON_AST_SYMBOL_HINT_EXT_RE.test(resolvedDiskPath)) {
    return [];
  }

  let symbols = opts.symbols;
  let rawSource = opts.rawSource;
  if (!symbols && resolvedDiskPath) {
    try {
      if (rawSource === undefined && fs.existsSync(resolvedDiskPath)) {
        rawSource = fs.readFileSync(resolvedDiskPath, "utf-8");
      }
      const outRes = withSuppressedTelemetry(() =>
        generateOutline(resolvedDiskPath!, {
          compact: true,
          includeTypes: false,
          skipTokenStats: true,
          lineRanges: false,
          projectRoot: opts.projectRoot,
          ...(rawSource !== undefined ? { preReadSource: rawSource } : {}),
        }),
      );
      symbols = outRes.symbols;
    } catch {
      // fall through to regex fallback
    }
  }

  const primary: string[] = [];
  const secondary: string[] = [];
  const childMethods: string[] = [];
  const seen = new Set<string>();
  const pushUnique = (bucket: string[], candidate: string): void => {
    if (!candidate || candidate === cleanExclude || seen.has(candidate)) return;
    if (!VALID_AST_HINT_IDENT_RE.test(candidate)) return;
    seen.add(candidate);
    bucket.push(candidate);
  };

  const approxTotalLines = rawSource ? countSourceLines(rawSource) : undefined;
  const nonImportSymbolCount = symbols
    ? symbols.filter((s) => !NON_SYMBOL_HINT_KINDS.has(s.kind)).length
    : 0;
  let skippedLoneMonolithVar = false;

  if (symbols && symbols.length > 0) {
    for (const sym of symbols) {
      if (NON_SYMBOL_HINT_KINDS.has(sym.kind)) continue;
      const symName = sym.name?.trim() ?? "";
      if (VALID_AST_HINT_IDENT_RE.test(symName)) {
        if (symName === cleanExclude) {
          if (sym.children && sym.children.length > 0) {
            for (const ch of sym.children) {
              const chName = ch.name?.trim() ?? "";
              if (
                !NON_SYMBOL_HINT_KINDS.has(ch.kind) &&
                VALID_AST_HINT_IDENT_RE.test(chName) &&
                chName !== "constructor"
              ) {
                pushUnique(childMethods, `${symName}.${chName}`);
              }
            }
          }
          continue;
        }
        if (PRIMARY_CALLABLE_HINT_KINDS.has(sym.kind)) {
          pushUnique(primary, symName);
        } else {
          const isLoneMonolithVar =
            (sym.kind === "var" || sym.kind === "const") &&
            nonImportSymbolCount <= 1 &&
            (!sym.children || sym.children.length === 0) &&
            (approxTotalLines ?? 0) >= 200;
          if (isLoneMonolithVar) {
            skippedLoneMonolithVar = true;
          } else {
            pushUnique(secondary, symName);
          }
        }
        if (sym.children && sym.children.length > 0) {
          for (const ch of sym.children) {
            const chName = ch.name?.trim() ?? "";
            if (
              (ch.kind === "method" || ch.kind === "function") &&
              VALID_AST_HINT_IDENT_RE.test(chName) &&
              chName !== "constructor"
            ) {
              pushUnique(childMethods, `${symName}.${chName}`);
            }
          }
        }
      }
    }
  }

  const chosen: string[] = [];
  if (cleanExclude && childMethods.length > 0) {
    for (const m of childMethods) {
      if (chosen.length >= maxCount) break;
      chosen.push(m);
    }
  }
  const orderedPrimary = [
    ...primary.filter((n) => n.length >= 3),
    ...primary.filter((n) => n.length < 3),
  ];
  const orderedSecondary = [
    ...secondary.filter((n) => n.length >= 3),
    ...secondary.filter((n) => n.length < 3),
  ];
  for (const p of orderedPrimary) {
    if (chosen.length >= maxCount) break;
    if (!chosen.includes(p)) chosen.push(p);
  }
  if (chosen.length === 1 && childMethods.length > 0) {
    for (const m of childMethods) {
      if (chosen.length >= maxCount) break;
      if (!chosen.includes(m)) chosen.push(m);
    }
  }
  for (const s of orderedSecondary) {
    if (chosen.length >= maxCount) break;
    if (!chosen.includes(s)) chosen.push(s);
  }

  if (chosen.length === 0 && !skippedLoneMonolithVar) {
    if (rawSource === undefined && resolvedDiskPath && fs.existsSync(resolvedDiskPath)) {
      try {
        rawSource = fs.readFileSync(resolvedDiskPath, "utf-8");
      } catch {
        // ignore
      }
    }
    const checkRef = resolvedDiskPath ?? fileRef;
    const isCodeLike =
      CODE_EXT_FOR_REGEX_HINT_RE.test(checkRef) || Boolean(rawSource?.startsWith("#!"));
    if (rawSource && isCodeLike) {
      const strippedStrings = rawSource.replace(/"""[\s\S]*?"""|'''[\s\S]*?'''|`[\s\S]*?`/g, "");
      const declRe =
        /(?:^|\n)[ \t]*(?:export\s+)?(?:pub\s+)?(?:async\s+)?(?:function|fn|def|class|struct)\s+([A-Za-z_$][A-Za-z0-9_$]{3,})\b/g;
      for (const m of strippedStrings.matchAll(declRe)) {
        const cand = m[1]?.trim();
        if (cand && cand !== cleanExclude && !chosen.includes(cand)) {
          chosen.push(cand);
          if (chosen.length >= maxCount) break;
        }
      }
    }
  }

  return chosen.slice(0, maxCount);
}

export function formatBatchSymbolsOrSearchHint(displayPath: string, symbolNames: string[]): string {
  const safePath = splitPathAndSelector(displayPath).filePath.trim() || ".";
  if (symbolNames.length >= 2) {
    return `batch symbols: aice read ${safePath}:${symbolNames[0]} ${safePath}:${symbolNames[1]} or aice search <pat> ${safePath}`;
  }
  if (symbolNames.length === 1) {
    return `batch symbols: aice read ${safePath}:${symbolNames[0]} or aice search <pat> ${safePath}`;
  }
  return `narrow with aice search <pat> ${safePath}`;
}

export function compactAutoOutlineBlock(
  headerLine: string,
  outlineBody: string,
  maxBlockBytes: number,
  displayPath: string,
): string {
  const safePath = splitPathAndSelector(displayPath).filePath.trim() || ".";
  const trimmedBody = outlineBody.trim();
  if (!trimmedBody) {
    return headerLine;
  }
  const fullBlock = `${headerLine}\n${trimmedBody}`;
  if (Buffer.byteLength(fullBlock, "utf-8") <= maxBlockBytes) {
    return fullBlock;
  }
  const outLines = trimmedBody.split("\n");
  const kept: string[] = [];
  const headerBytes = Buffer.byteLength(headerLine, "utf-8") + 1;
  const footerReserveBytes = Buffer.byteLength(
    `\n// ... (+${outLines.length} more symbols — use aice search <pat> ${safePath})`,
    "utf-8",
  );
  const availBodyBytes = Math.max(0, maxBlockBytes - headerBytes - footerReserveBytes);
  let used = 0;
  for (const ln of outLines) {
    const lnBytes = Buffer.byteLength(ln, "utf-8") + (kept.length > 0 ? 1 : 0);
    if (used + lnBytes > availBodyBytes) {
      break;
    }
    kept.push(ln);
    used += lnBytes;
  }
  const omittedCount = Math.max(1, outLines.length - kept.length);
  const suffix = `// ... (+${omittedCount} more symbols — use aice search <pat> ${safePath})`;
  return kept.length > 0
    ? `${headerLine}\n${kept.join("\n")}\n${suffix}`
    : `${headerLine}\n${suffix}`;
}

export function buildAutoOutlineHeader(
  displayPath: string,
  lineCount: number,
  opts?: {
    symbolNames?: string[];
    budgetDowngraded?: boolean;
    budgetLabel?: string;
  },
): string {
  const budgetNote =
    (opts?.budgetDowngraded || lineCount >= 250) && opts?.budgetLabel
      ? `, >${opts.budgetLabel}`
      : "";
  const guidance = formatBatchSymbolsOrSearchHint(displayPath, opts?.symbolNames ?? []);
  return `// Auto-outlined ${displayPath} (${lineCount}L${budgetNote}) — ${guidance}`;
}

export function formatContextStatsFooter(
  tokenCount: number,
  depsCount: number,
  callersCount: number,
  targetChars: number,
): string {
  return [
    "📊 Context Pack Token Telemetry:",
    `  Total pack tokens: ${tokenCount.toLocaleString()}`,
    `  Dependencies:      ${depsCount}`,
    `  Downstream callers:${callersCount}`,
    `  Target characters: ${targetChars.toLocaleString()}`,
  ].join("\n");
}

export function formatSingleOutlineStatsFooter(
  file: string,
  stats: NonNullable<OutlineResult["stats"]>,
): string {
  return [
    `📊 Token Reduction Metrics for ${file}:`,
    `  Original tokens: ${stats.originalTokens.toLocaleString()}`,
    `  Outline tokens:  ${stats.outlineTokens.toLocaleString()}`,
    `  Token savings:   ${stats.savingsTokens.toLocaleString()} tokens (${stats.savingsPct}%)`,
    `  Original chars:  ${stats.originalChars.toLocaleString()}`,
    `  Outline chars:   ${stats.outlineChars.toLocaleString()} (${stats.charSavingsPct}%)`,
  ].join("\n");
}

export function shouldEnforceDefaultReadBudget(
  options: ReadOptions,
  normalizedItems?: NormalizedReadTarget[],
): boolean {
  if (options._bypassInternalCap === true) return false;
  if (options.maxTokens !== undefined) return false;
  if (options.json === true) return false;
  if ((options.surface === "cli" || options.surface === "mcp") && !options.unboundedCli)
    return true;
  if (options.full === true) return false;
  if (
    normalizedItems &&
    normalizedItems.length > 0 &&
    normalizedItems.every((it) => it.explicitFull)
  ) {
    return false;
  }
  return true;
}

export function buildAntiPaginationHintForTarget(
  displayPath: string,
  opts?: {
    symbols?: OutlineSymbol[];
    diskPath?: string;
    rawSource?: string;
    projectRoot?: string;
    excludeSymbol?: string;
  },
): string {
  const parsed = splitPathAndSelector(displayPath);
  const safePath = parsed.filePath.trim() || ".";
  const syms = extractRepresentativeSymbolHints({
    symbols: opts?.symbols,
    diskPath: opts?.diskPath,
    rawSource: opts?.rawSource,
    displayPath: safePath,
    projectRoot: opts?.projectRoot,
    excludeSymbol: opts?.excludeSymbol,
  });
  return formatBatchSymbolsOrSearchHint(safePath, syms);
}

function isLikelyCompactHeaderPath(candPath: string, fallbackFilePath?: string): boolean {
  if (!candPath) return false;
  if (candPath.includes("/") || candPath.includes("\\") || candPath.includes(".")) {
    return true;
  }
  const base = path.posix.basename(candPath);
  if (KNOWN_TEXT_FILENAMES.has(base)) {
    return true;
  }
  return Boolean(fallbackFilePath && candPath === fallbackFilePath);
}

function matchValidSectionHeaderLine(
  lines: string[],
  idx: number,
  fallbackFilePath?: string,
): { filePath: string; selector?: string; rangeStart?: number; rangeEnd?: number } | null {
  const ln = lines[idx];
  if (!ln) return null;
  const legacyHdr = ln.match(/^\/\/ === ([^=(]+?)(?:\s+\(| ===)/);
  if (legacyHdr?.[1]) {
    const parsedHdr = splitPathAndSelector(legacyHdr[1].trim());
    const parsedRange = parseSelectorLineRange(parsedHdr.selector);
    return {
      filePath: parsedHdr.filePath || ".",
      selector: parsedHdr.selector,
      rangeStart: parsedRange?.startLine,
      rangeEnd: parsedRange?.endLine,
    };
  }
  if (idx > 0 && lines[idx - 1] !== "") {
    return null;
  }
  const compactHdr = ln.match(
    /^\/\/ (?!\[|\.\.\.|Auto-outlined|Pagination|Hint:|0 matches|not found:|missing:|siblings:)([^\s:]+)(?::([^\s]+))?$/,
  );
  if (!compactHdr?.[1]) {
    return null;
  }
  const candPath = compactHdr[1].trim();
  if (!isLikelyCompactHeaderPath(candPath, fallbackFilePath)) {
    return null;
  }
  const rawSel = compactHdr[2]?.trim();
  const rangeMatch = rawSel?.match(/^L?(\d+)(?:-L?(\d+))?$/i);
  if (rangeMatch?.[1]) {
    const rStart = Number.parseInt(rangeMatch[1], 10);
    const rEnd = rangeMatch[2] ? Number.parseInt(rangeMatch[2], 10) : undefined;
    const normRangeSel = rEnd !== undefined ? `L${rStart}-L${rEnd}` : `L${rStart}`;
    return {
      filePath: candPath,
      selector: normRangeSel,
      rangeStart: rStart,
      rangeEnd: rEnd,
    };
  }
  return {
    filePath: candPath,
    selector: rawSel,
  };
}

function inferTruncatedSliceContext(
  emittedSlice: string,
  fallbackTargetPath: string,
): {
  filePath: string;
  activeSelector?: string;
  nextStartLine: number;
  requestedEndLine?: number;
} {
  const lines = emittedSlice.split("\n");
  const initialTarget = fallbackTargetPath.split(/,\s+/)[0]?.trim() || ".";
  const parsedFallback = splitPathAndSelector(initialTarget);
  let lastFilePath = parsedFallback.filePath || ".";
  let activeSelector = parsedFallback.selector;
  let lastLineNum = 0;

  for (let idx = 0; idx < lines.length; idx++) {
    const ln = lines[idx]!;
    const secHdr = matchValidSectionHeaderLine(lines, idx, parsedFallback.filePath);
    if (secHdr) {
      lastFilePath = secHdr.filePath || ".";
      activeSelector =
        secHdr.selector ??
        (lastFilePath === parsedFallback.filePath ? parsedFallback.selector : undefined);
      lastLineNum =
        secHdr.rangeStart !== undefined && secHdr.rangeStart > 0 ? secHdr.rangeStart - 1 : 0;
      continue;
    }
    const mdTargetMatch = ln.match(/^### Target:\s+`?([^`\s[]+)`?/);
    if (mdTargetMatch?.[1]) {
      const parsedMd = splitPathAndSelector(mdTargetMatch[1].trim());
      lastFilePath = parsedMd.filePath || ".";
      activeSelector =
        parsedMd.selector ??
        (lastFilePath === parsedFallback.filePath ? parsedFallback.selector : undefined);
      lastLineNum = 0;
      continue;
    }
    const numMatch = ln.match(/^\s*(?:L(\d+):|(\d+)[│:])/);
    if (numMatch) {
      const parsedNum = Number.parseInt(numMatch[1] ?? numMatch[2] ?? "0", 10);
      if (parsedNum > 0) {
        lastLineNum = parsedNum;
      }
      continue;
    }
    if (lastLineNum >= 0 && !ln.startsWith("// [") && !ln.startsWith("```")) {
      lastLineNum++;
    }
  }

  const nextStartLine = lastLineNum > 0 ? lastLineNum + 1 : 1;
  const parsedRange = parseSelectorLineRange(activeSelector);
  const requestedEndLine =
    parsedRange?.endLine !== undefined && parsedRange.endLine >= nextStartLine
      ? parsedRange.endLine
      : undefined;

  return {
    filePath: lastFilePath,
    activeSelector,
    nextStartLine,
    requestedEndLine,
  };
}

export function closeUnclosedMarkdownFence(text: string): string {
  let openFence = false;
  for (const ln of text.split("\n")) {
    if (ln.trimStart().startsWith("```")) {
      openFence = !openFence;
    }
  }
  return openFence ? `${text}\n\`\`\`` : text;
}

function isTargetContentCompleteInContextPack(fullBundle: string, keptText: string): boolean {
  const isContextPack =
    fullBundle.startsWith("# AICE Context Pack:") ||
    fullBundle.startsWith("# AICE Multi-File Context Stream");
  if (!isContextPack || !keptText.includes("\n## Target File Content")) {
    return false;
  }
  if (
    keptText.includes("\n## Imported Dependency Contracts (") ||
    keptText.includes("\n## Downstream Callers (")
  ) {
    return true;
  }
  const remainder = fullBundle.slice(keptText.length).trimStart();
  return (
    remainder.startsWith("## Imported Dependency Contracts (") ||
    remainder.startsWith("## Downstream Callers (")
  );
}

/**
 * Guarantees rendered `formattedBundle` (plus optional `statsText`) stays strictly within
 * the effective read budget (`DEFAULT_READ_MAX_BYTES` 28 KB or `DEFAULT_CLI_READ_MAX_BYTES` 9 KB),
 * appending an exact AST-snapped `aice read <file>:L<start>-L<end>` pagination hint whenever capped.
 */
export function enforceReadBudgetCeiling(params: {
  bundle: string;
  fallbackTargetPath: string;
  statsText?: string;
  totalLines?: number;
  extraHints?: string[];
  diskPath?: string;
  rawSource?: string;
  projectRoot?: string;
  maxBytes?: number;
  maxTokens?: number;
  sliceByteBudget?: number;
  budgetLabel?: string;
}): { formattedBundle: string; output: string; tokenCount: number; wasCapped: boolean } {
  const {
    bundle,
    fallbackTargetPath,
    statsText,
    totalLines,
    extraHints,
    diskPath,
    rawSource,
    projectRoot,
  } = params;
  const maxBytes = params.maxBytes ?? DEFAULT_READ_MAX_BYTES;
  const maxTokens = params.maxTokens ?? DEFAULT_READ_MAX_TOKENS;
  const budgetLabel = params.budgetLabel ?? "28 KB";

  const statsAllowanceBytes = statsText ? Buffer.byteLength(`\n\n${statsText}`, "utf-8") : 0;
  const maxBundleBytes = Math.max(256, maxBytes - statsAllowanceBytes);
  const initialBytes = Buffer.byteLength(bundle, "utf-8");
  const initialTokens = estimateTokens(bundle);

  const effectiveTokenCeiling = Math.max(maxTokens, Math.ceil(maxBundleBytes / 1.75));
  if (initialBytes <= maxBundleBytes && initialTokens <= effectiveTokenCeiling) {
    const out = statsText ? `${bundle}\n\n${statsText}` : bundle;
    if (Buffer.byteLength(out, "utf-8") <= maxBytes) {
      return {
        formattedBundle: bundle,
        output: out,
        tokenCount: initialTokens,
        wasCapped: false,
      };
    }
  }

  const lines = bundle.split("\n");
  const targetKeepBytes = Math.max(400, maxBundleBytes - 320);
  const targetKeepTokens = Math.max(128, effectiveTokenCeiling - 90);

  const initialFallbackTarget = fallbackTargetPath.split(/,\s+/)[0]?.trim() || ".";
  const parsedCeilingFallback = splitPathAndSelector(initialFallbackTarget);

  const keptLines: string[] = [];
  let runningBytes = 0;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const lnBytes = Buffer.byteLength(ln, "utf-8") + (keptLines.length > 0 ? 1 : 0);
    if (runningBytes + lnBytes > targetKeepBytes) {
      break;
    }
    keptLines.push(ln);
    runningBytes += lnBytes;
  }

  let keptText = keptLines.join("\n");
  while (keptLines.length > 1 && estimateTokens(keptText) > targetKeepTokens) {
    const dropCount = Math.max(1, Math.floor(keptLines.length * 0.1));
    keptLines.splice(keptLines.length - dropCount, dropCount);
    keptText = keptLines.join("\n");
  }

  const isCliBudget = budgetLabel.includes("CLI") || budgetLabel.includes("MCP");

  const buildFooterForKept = (candidateKept: string): string => {
    const keptLineCount = candidateKept.length === 0 ? 0 : candidateKept.split("\n").length;
    let firstDroppedIdx = keptLineCount;
    while (firstDroppedIdx < lines.length && lines[firstDroppedIdx] === "") {
      firstDroppedIdx++;
    }
    const boundaryOmittedHdr =
      firstDroppedIdx < lines.length
        ? matchValidSectionHeaderLine(lines, firstDroppedIdx, parsedCeilingFallback.filePath)
        : null;
    let hasAnyLaterSectionHdr = Boolean(boundaryOmittedHdr);
    if (!hasAnyLaterSectionHdr) {
      for (let k = firstDroppedIdx + 1; k < lines.length; k++) {
        if (matchValidSectionHeaderLine(lines, k, parsedCeilingFallback.filePath)) {
          hasAnyLaterSectionHdr = true;
          break;
        }
      }
    }

    if (
      (!extraHints || extraHints.length === 0) &&
      !hasAnyLaterSectionHdr &&
      isTargetContentCompleteInContextPack(bundle, candidateKept)
    ) {
      const fullHint = isCliBudget ? "" : " (pass --full for all contracts)";
      return `\n// [${budgetLabel} stdout budget reached — target complete; contracts trimmed${fullHint}]`;
    }

    const fullHint = isCliBudget ? "" : " (or --full)";
    if (extraHints && extraHints.length > 0) {
      return `\n// [${budgetLabel} stdout budget reached — ${extraHints[0]}${fullHint}]`;
    }

    if (boundaryOmittedHdr) {
      const safeBoundaryPath =
        splitPathAndSelector(boundaryOmittedHdr.filePath).filePath.trim() || ".";
      if (boundaryOmittedHdr.rangeStart !== undefined) {
        const rangeLabel =
          boundaryOmittedHdr.rangeEnd !== undefined
            ? `L${boundaryOmittedHdr.rangeStart}-L${boundaryOmittedHdr.rangeEnd}`
            : `L${boundaryOmittedHdr.rangeStart}+`;
        return `\n// [${budgetLabel} stdout budget reached (${safeBoundaryPath}:${rangeLabel} omitted) — narrow with aice search <pat> ${safeBoundaryPath}${fullHint}]`;
      }
      if (boundaryOmittedHdr.selector) {
        const omittedSyms: string[] = [`${safeBoundaryPath}:${boundaryOmittedHdr.selector}`];
        for (let k = firstDroppedIdx + 1; k < lines.length && omittedSyms.length < 2; k++) {
          const nextHdr = matchValidSectionHeaderLine(lines, k, parsedCeilingFallback.filePath);
          if (nextHdr?.selector && nextHdr.rangeStart === undefined) {
            const p = splitPathAndSelector(nextHdr.filePath).filePath.trim() || ".";
            const entry = `${p}:${nextHdr.selector}`;
            if (!omittedSyms.includes(entry)) {
              omittedSyms.push(entry);
            }
          }
        }
        return `\n// [${budgetLabel} stdout budget reached — batch symbols: aice read ${omittedSyms.join(" ")} or aice search <pat> ${safeBoundaryPath}${fullHint}]`;
      }
      const guidance = buildAntiPaginationHintForTarget(safeBoundaryPath, { projectRoot });
      return `\n// [${budgetLabel} stdout budget reached — ${guidance}${fullHint}]`;
    }

    const truncCtx = inferTruncatedSliceContext(candidateKept, fallbackTargetPath);
    const safeTarget = splitPathAndSelector(truncCtx.filePath).filePath.trim() || ".";
    const isSameAsFallback = safeTarget === (parsedCeilingFallback.filePath || ".");
    const isExplicitRange = Boolean(
      truncCtx.activeSelector && LINE_RANGE_SELECTOR_RE.test(truncCtx.activeSelector),
    );

    if (isExplicitRange) {
      const effectiveEnd =
        truncCtx.requestedEndLine !== undefined
          ? totalLines !== undefined && isSameAsFallback
            ? Math.min(totalLines, truncCtx.requestedEndLine)
            : truncCtx.requestedEndLine
          : isSameAsFallback
            ? totalLines
            : undefined;
      const remSpan =
        effectiveEnd !== undefined && effectiveEnd >= truncCtx.nextStartLine
          ? ` (L${truncCtx.nextStartLine}-L${effectiveEnd} remaining)`
          : truncCtx.nextStartLine > 1
            ? ` (from L${truncCtx.nextStartLine} remaining)`
            : "";
      return `\n// [${budgetLabel} stdout budget reached${remSpan} — narrow with aice search <pat> ${safeTarget}${fullHint}]`;
    }

    const excludeSym =
      truncCtx.activeSelector &&
      !isPureRegexSelector(truncCtx.activeSelector) &&
      !truncCtx.activeSelector.includes(",")
        ? truncCtx.activeSelector
        : undefined;
    const symHints = extractRepresentativeSymbolHints({
      diskPath: isSameAsFallback ? diskPath : undefined,
      rawSource: isSameAsFallback ? rawSource : undefined,
      displayPath: safeTarget,
      projectRoot,
      excludeSymbol: excludeSym,
    });
    if (symHints.length > 0) {
      return `\n// [${budgetLabel} stdout budget reached — ${formatBatchSymbolsOrSearchHint(safeTarget, symHints)}${fullHint}]`;
    }

    const remSpan =
      isSameAsFallback && totalLines !== undefined && totalLines >= truncCtx.nextStartLine
        ? ` (L${truncCtx.nextStartLine}-L${totalLines} remaining)`
        : truncCtx.nextStartLine > 1
          ? ` (from L${truncCtx.nextStartLine} remaining)`
          : "";
    return `\n// [${budgetLabel} stdout budget reached${remSpan} — narrow with aice search <pat> ${safeTarget}${fullHint}]`;
  };

  let closedKept = closeUnclosedMarkdownFence(keptText);
  let footer = buildFooterForKept(keptText);
  while (
    keptText.length > 0 &&
    (Buffer.byteLength(`${closedKept}${footer}`, "utf-8") > maxBundleBytes ||
      estimateTokens(`${closedKept}${footer}`) > effectiveTokenCeiling)
  ) {
    const nlIdx = keptText.lastIndexOf("\n");
    keptText =
      nlIdx > 0 ? keptText.slice(0, nlIdx) : keptText.slice(0, Math.floor(keptText.length * 0.8));
    closedKept = closeUnclosedMarkdownFence(keptText);
    footer = buildFooterForKept(keptText);
  }

  const cappedBundle = closedKept ? `${closedKept}${footer}` : footer.trimStart();
  const cappedTokens = estimateTokens(cappedBundle);
  const finalOut = statsText ? `${cappedBundle}\n\n${statsText}` : cappedBundle;
  return {
    formattedBundle: cappedBundle,
    output: finalOut,
    tokenCount: cappedTokens,
    wasCapped: true,
  };
}

export function formatAggregateOutlineStatsFooter(
  fileCount: number,
  totalOrigTokens: number,
  totalOutlineTokens: number,
): string {
  const savings = totalOrigTokens - totalOutlineTokens;
  const savingsPct = totalOrigTokens > 0 ? ((savings / totalOrigTokens) * 100).toFixed(1) : "0.0";
  return [
    `📊 Aggregate Token Reduction Metrics (${fileCount} files):`,
    `  Original tokens: ${totalOrigTokens.toLocaleString()}`,
    `  Outline tokens:  ${totalOutlineTokens.toLocaleString()}`,
    `  Token savings:   ${savings.toLocaleString()} tokens (${savingsPct}%)`,
  ].join("\n");
}
