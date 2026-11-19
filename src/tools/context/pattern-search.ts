/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * 4-tier search ranking and AST-aware pattern match extraction.
 */

import * as path from "node:path";
import { getCachedTsSymbolIndex, isTsLikeFilePath } from "../../compat/typescript.js";
import { withSuppressedTelemetry } from "../../telemetry/index.js";
import { generateOutline, type OutlineSymbol } from "../outline.js";
import { normalizeGrepBreAlternation } from "./honest-baseline.js";
import type { LineSpanWindow, PatternMatchRankingOptions, PatternMatchResult } from "./types.js";

export function hasCatastrophicNestedQuantifiers(pattern: string): boolean {
  if (pattern.length > 512) return true;
  if (/(\.\*){4,}/.test(pattern)) return true;
  return /\([^()]*[+*][^()]*\)\s*[+*?{]/.test(pattern);
}

const QUERY_KEYWORD_STOPWORDS = new Set([
  "const",
  "let",
  "var",
  "val",
  "mut",
  "function",
  "fn",
  "def",
  "fun",
  "func",
  "class",
  "struct",
  "enum",
  "interface",
  "type",
  "trait",
  "impl",
  "pub",
  "public",
  "private",
  "protected",
  "export",
  "import",
  "from",
  "async",
  "await",
  "return",
  "static",
  "readonly",
]);

export function extractPrimaryQueryKeyword(rawQuery: string): string | undefined {
  const trimmed = rawQuery.trim();
  if (!trimmed) return undefined;
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  let body = regexMatch ? regexMatch[1]! : trimmed;
  if (regexMatch) {
    body = body
      .replace(/\\\$/g, "$")
      .replace(/\[(?:\\.|[^\]\\])*\]/g, " ")
      .replace(
        /\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F]+\}|u[0-9a-fA-F]{4}|c[A-Za-z]|[pP]\{[^}]*\}|[bBwdDsSnrtfv0]|[1-9]\d*|[^A-Za-z0-9_$])/g,
        " ",
      );
  }
  const tokens = body
    .split(/[^A-Za-z0-9_$-]+/)
    .map((t) => t.replace(/^-+|-+$/g, "").trim())
    .filter((t) => t.length >= 2 && !/^\d+$/.test(t));
  if (tokens.length === 0) return undefined;
  const nonStop = tokens.filter((t) => !QUERY_KEYWORD_STOPWORDS.has(t.toLowerCase()));
  return nonStop[0] ?? tokens[0];
}

export function doesFileStemMatchQuery(filePath: string, queryKeyword?: string): boolean {
  if (!filePath || !queryKeyword) return false;
  const kw = queryKeyword.replace(/^\$/, "").toLowerCase();
  if (kw.length < 2) return false;
  const base = path.basename(filePath);
  const ext = path.extname(base);
  const rawStem = ext ? base.slice(0, -ext.length) : base;
  const stem = rawStem
    .replace(/\.(?:d|test|spec|mock)s?$/i, "")
    .replace(/[_-](?:test|spec|mock)s?$/i, "")
    .toLowerCase();
  if (!stem) return false;
  if (kw.length <= 2) {
    return stem === kw || stem.split(/[^a-z0-9]+/).includes(kw);
  }
  if (stem.includes(kw)) return true;
  if (kw.length >= 4) {
    const normStem = stem.replace(/[^a-z0-9]/g, "");
    const normKw = kw.replace(/[^a-z0-9]/g, "");
    if (normKw.length >= 4 && normStem.includes(normKw)) {
      return true;
    }
  }
  return false;
}

export function isTestOrMockPath(filePath: string, projectRoot?: string): boolean {
  let target = filePath;
  if (projectRoot) {
    const rel = path.relative(projectRoot, filePath);
    if (rel && !rel.startsWith("..") && !path.isAbsolute(rel)) {
      target = rel;
    }
  }
  const norm = target.replace(/\\/g, "/").toLowerCase();
  return (
    /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/.test(
      norm,
    ) ||
    /\.(?:test|spec|mock)s?\.[a-z0-9]+$/i.test(norm) ||
    /(?:^|\/)(?:test|spec|mock)[_-][^/]+\.[a-z0-9]+$/i.test(norm) ||
    /[_-](?:test|spec|mock)s?\.[a-z0-9]+$/i.test(norm)
  );
}

export function isCommentLine(line: string, filePath?: string): boolean {
  const t = line.trim();
  if (!t) return false;
  if (t.startsWith("//") || t.startsWith("/*") || t.startsWith("<!--")) {
    return true;
  }
  if (t === "*" || t.startsWith("* ") || t.startsWith("*\t") || t.startsWith("*/")) {
    return true;
  }
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (t.startsWith("#")) {
    if (
      ext === ".md" ||
      ext === ".markdown" ||
      ext === ".css" ||
      ext === ".html" ||
      ext === ".cs"
    ) {
      return false;
    }
    if (t.startsWith("#[") || t.startsWith("#![")) {
      return false;
    }
    if (/^#\s*(?:include|define|ifdef|ifndef|endif|pragma|if|elif|else|undef|error)\b/.test(t)) {
      return false;
    }
    return true;
  }
  if (t.startsWith('"""') || t.startsWith("'''")) {
    return ext === ".py" || ext === ".pyi" || ext === "";
  }
  if (t.startsWith("--")) {
    return ext === ".sql" || ext === ".lua" || ext === ".hs" || ext === ".ada";
  }
  return false;
}

export function isDeclarationLine(line: string, filePath?: string): boolean {
  if (
    /\b(function|class|interface|type|enum|struct|fn|def|fun|func|pub|export|const|let|var|val|sub|record|impl|trait)\b/.test(
      line,
    )
  ) {
    return true;
  }
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (
    ext === ".c" ||
    ext === ".h" ||
    ext === ".cpp" ||
    ext === ".hpp" ||
    ext === ".cc" ||
    ext === ".cxx"
  ) {
    if (
      /\b(?:void|int|char|bool|double|float|long|short|unsigned|signed|size_t|uint\d+_t|int\d+_t)\b/.test(
        line,
      ) &&
      /\b[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(line)
    ) {
      return true;
    }
  }
  if (ext === ".aipl") {
    if (/^\s*(?:pub\s+)?(?:fn|struct|enum|class)\b/.test(line)) {
      return true;
    }
  }
  return false;
}

export function isExactDefinitionLine(
  line: string,
  queryKeyword: string,
  filePath?: string,
): boolean {
  const esc = queryKeyword.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ext = filePath ? path.extname(filePath).toLowerCase() : "";
  if (ext === ".aipl") {
    return new RegExp(`^\\s*(?:pub\\s+)?(?:fn|struct|enum|class)\\s+${esc}\\b`).test(line);
  }
  if (
    ext === ".c" ||
    ext === ".h" ||
    ext === ".cpp" ||
    ext === ".hpp" ||
    ext === ".cc" ||
    ext === ".cxx"
  ) {
    if (new RegExp(`(?:^|[\\s*&])${esc}\\s*\\([^;]*\\)(?:\\s*\\{)?`).test(line)) {
      if (
        /^[A-Za-z_][A-Za-z0-9_*&\s]+\s+\b/.test(line.trim()) ||
        /\b(?:void|int|char|bool|double|float|long|short|unsigned|signed|static|inline|extern|size_t|uint\d+_t|int\d+_t|struct|enum|class)\b/.test(
          line,
        )
      ) {
        return true;
      }
    }
    if (new RegExp(`\\b(?:struct|enum|class|union|typedef\\s+struct)\\s+${esc}\\b`).test(line)) {
      return true;
    }
  }
  const generalDefRe = new RegExp(
    `\\b(?:(?:pub\\s+)?(?:fn|function|def|func|fun|class|interface|struct|enum|type)\\s+${esc}\\b|(?:const|let|var|val)\\s+${esc}\\b(?:\\s*:[^=]+)?\\s*=)`,
  );
  return generalDefRe.test(line);
}

function scorePatternWindow(
  lines: string[],
  w: { start: number; end: number; hits: number[] },
  filePath?: string,
  queryKeyword?: string,
  isExplicitTestSearch = false,
  projectRoot?: string,
): number {
  const isMockOrTest =
    Boolean(filePath) && !isExplicitTestSearch && isTestOrMockPath(filePath!, projectRoot);

  let fileNameBonus = 0;
  if (filePath && doesFileStemMatchQuery(filePath, queryKeyword)) {
    fileNameBonus = isMockOrTest ? 20 : 1000;
  }

  let hasExactDefinition = false;
  let hasDeclaration = false;
  let hasCode = false;
  let allComments = true;

  for (const h of w.hits) {
    const lineText = lines[h - 1] ?? "";
    if (isCommentLine(lineText, filePath)) {
      // comment hit
    } else {
      allComments = false;
      hasCode = true;
      if (queryKeyword && isExactDefinitionLine(lineText, queryKeyword, filePath)) {
        hasExactDefinition = true;
        hasDeclaration = true;
      } else if (isDeclarationLine(lineText, filePath)) {
        hasDeclaration = true;
      }
    }
  }

  let lineScore = 0;
  if (!isMockOrTest) {
    if (hasExactDefinition) lineScore = 650;
    else if (hasDeclaration) lineScore = 500;
    else if (hasCode) lineScore = 300;
    else if (allComments) lineScore = 100;
  } else {
    if (hasExactDefinition) lineScore = 80;
    else if (hasDeclaration) lineScore = 50;
    else if (hasCode) lineScore = 30;
    else if (allComments) lineScore = 10;
  }

  const lineTieBreaker = Math.max(0, 10 - w.start / 100);
  return fileNameBonus + lineScore + lineTieBreaker;
}

function collectAstDeclarationSpansForSearch(
  rawSource: string,
  filePath?: string,
): Array<{ startLine: number; endLine: number }> {
  const spans: Array<{ startLine: number; endLine: number }> = [];
  if (!rawSource.trim()) return spans;

  if (!filePath || isTsLikeFilePath(filePath)) {
    try {
      const idx = getCachedTsSymbolIndex(rawSource, filePath ?? "search.ts");
      for (const top of idx.orderedTopLevel) {
        spans.push({ startLine: top.startLine, endLine: top.endLine });
      }
      for (const memberList of idx.membersByQualifiedName.values()) {
        for (const m of memberList) {
          spans.push({ startLine: m.startLine, endLine: m.endLine });
        }
      }
      for (const tb of idx.testBlocks) {
        spans.push({ startLine: tb.startLine, endLine: tb.endLine });
      }
      return spans;
    } catch {
      // fall through
    }
  }

  if (filePath && !/\.(?:jsonc?|ya?ml|cff|toml|txt)$/i.test(filePath)) {
    try {
      const oRes = withSuppressedTelemetry(() =>
        generateOutline(rawSource, filePath, {
          includeTypes: false,
          skipTokenStats: true,
          lineRanges: false,
          depth: 2,
          idioms: false,
        }),
      );
      const visitSym = (syms: OutlineSymbol[]): void => {
        for (const sym of syms) {
          if (sym.kind !== "import") {
            spans.push({
              startLine: sym.line,
              endLine: sym.endLine !== undefined ? Math.max(sym.line, sym.endLine) : sym.line,
            });
          }
          if (sym.children && sym.children.length > 0) {
            visitSym(sym.children);
          }
        }
      };
      visitSym(oRes.symbols);
    } catch {
      // ignore outline fallback errors
    }
  }

  return spans;
}

function findEnclosingShortDeclarationSpan(
  spans: Array<{ startLine: number; endLine: number }>,
  lineNum: number,
  maxDeclLines = 40,
): { startLine: number; endLine: number } | undefined {
  let bestMultiLine: { startLine: number; endLine: number } | undefined;
  let smallestLen = Number.POSITIVE_INFINITY;
  for (const sp of spans) {
    if (sp.startLine <= lineNum && lineNum <= sp.endLine) {
      const len = sp.endLine - sp.startLine + 1;
      if (len < smallestLen) {
        smallestLen = len;
      }
      if (len >= 2 && len <= maxDeclLines) {
        if (!bestMultiLine || len < bestMultiLine.endLine - bestMultiLine.startLine + 1) {
          bestMultiLine = sp;
        }
      }
    }
  }
  if (bestMultiLine) {
    // Only use bestMultiLine if no multi-line inner declaration > maxDeclLines strictly sits inside it
    const hasInnerOversizedDecl = spans.some((sp) => {
      const len = sp.endLine - sp.startLine + 1;
      return (
        len > maxDeclLines &&
        sp.startLine <= lineNum &&
        lineNum <= sp.endLine &&
        len < bestMultiLine.endLine - bestMultiLine.startLine + 1
      );
    });
    if (!hasInnerOversizedDecl) {
      return bestMultiLine;
    }
  }
  return undefined;
}

function findInnermostEnclosingDeclarationSpan(
  spans: Array<{ startLine: number; endLine: number }>,
  lineNum: number,
): { startLine: number; endLine: number } | undefined {
  let best: { startLine: number; endLine: number } | undefined;
  let bestLen = Number.POSITIVE_INFINITY;
  for (const sp of spans) {
    if (sp.startLine <= lineNum && lineNum <= sp.endLine) {
      const len = sp.endLine - sp.startLine + 1;
      if (len >= 2 && len < bestLen) {
        best = sp;
        bestLen = len;
      }
    }
  }
  return best;
}

function computeMonolithFocusSubWindows(
  symStart: number,
  symEnd: number,
  symbolHits: number[],
): Array<{ start: number; end: number }> | null {
  const symLen = symEnd - symStart + 1;
  const covIntervals = symbolHits
    .map((m) => ({
      start: Math.max(symStart, m - 6),
      end: Math.min(symEnd, m + 6),
    }))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedCov: Array<{ start: number; end: number }> = [];
  for (const iv of covIntervals) {
    const prev = mergedCov[mergedCov.length - 1];
    if (prev && iv.start <= prev.end + 1) {
      prev.end = Math.max(prev.end, iv.end);
    } else {
      mergedCov.push({ ...iv });
    }
  }
  const coveredCount = mergedCov.reduce((acc, iv) => acc + (iv.end - iv.start + 1), 0);
  if (coveredCount / symLen >= 0.65) {
    return null;
  }

  const subWindows: Array<{ start: number; end: number }> = [
    { start: symStart, end: Math.min(symEnd, symStart + 3) },
  ];
  for (const m of symbolHits) {
    subWindows.push({
      start: Math.max(symStart, m - 5),
      end: Math.min(symEnd, m + 5),
    });
  }
  subWindows.sort((a, b) => a.start - b.start || a.end - b.end);
  const mergedSubs: Array<{ start: number; end: number }> = [];
  for (const sw of subWindows) {
    const prev = mergedSubs[mergedSubs.length - 1];
    // Merge windows within <= 3 skipped lines of each other
    if (prev && sw.start <= prev.end + 4) {
      prev.end = Math.max(prev.end, sw.end);
    } else {
      mergedSubs.push({ ...sw });
    }
  }
  const lastSub = mergedSubs[mergedSubs.length - 1];
  if (lastSub && lastSub.end < symEnd && symEnd - lastSub.end <= 3) {
    lastSub.end = symEnd;
  }
  return mergedSubs;
}

export function extractPatternMatchesDetailed(
  rawSource: string,
  rawQuery: string,
  contextRadius?: number,
  rankingOpts?: PatternMatchRankingOptions,
): PatternMatchResult | undefined {
  const trimmed = rawQuery.trim();
  if (!trimmed) return undefined;
  const regexMatch = trimmed.match(/^\/(.+)\/([gimsuy]*)$/);
  let matcher: (line: string) => boolean;
  let queryKeyword: string | undefined;

  if (regexMatch) {
    const rawBody = normalizeGrepBreAlternation(regexMatch[1]!);
    if (hasCatastrophicNestedQuantifiers(rawBody)) {
      throw new Error(`Unsafe or overly complex regex selector '${trimmed}'`);
    }
    const safeFlags = regexMatch[2]!.replace(/[gy]/g, "");
    let re: RegExp;
    try {
      re = new RegExp(rawBody, safeFlags);
    } catch (err) {
      throw new Error(
        `Invalid regex selector '${trimmed}': ${err instanceof Error ? err.message : String(err)}`,
      );
    }
    matcher = (line: string) => re.test(line);
    queryKeyword = extractPrimaryQueryKeyword(trimmed);
  } else if (/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(trimmed)) {
    queryKeyword = trimmed;
    const esc = trimmed.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const identRe = new RegExp(`\\b${esc}\\b`);
    matcher = (line: string) => {
      if (isCommentLine(line, rankingOpts?.filePath)) return false;
      return identRe.test(line);
    };
  } else {
    const lower = trimmed.toLowerCase();
    matcher = (line: string) => line.includes(trimmed) || line.toLowerCase().includes(lower);
    queryKeyword = extractPrimaryQueryKeyword(trimmed);
  }

  const normalizedSource = rawSource.length > 0 ? rawSource.replace(/\r?\n$/, "") : "";
  const lines = normalizedSource.length > 0 ? normalizedSource.split(/\r?\n/) : [];
  const hitLines: number[] = [];
  for (let i = 0; i < lines.length; i++) {
    if (matcher(lines[i]!)) {
      hitLines.push(i + 1);
    }
  }
  if (hitLines.length === 0) return undefined;

  const isMockOrTest =
    Boolean(rankingOpts?.filePath) &&
    !(rankingOpts?.isExplicitTestSearch ?? false) &&
    isTestOrMockPath(rankingOpts!.filePath!, rankingOpts?.projectRoot);

  let cachedAstSpans: Array<{ startLine: number; endLine: number }> | undefined;
  const rawWindows: Array<{ start: number; end: number; hits: number[]; isCommentHit?: boolean }> =
    [];
  const monolithGroups = new Map<string, { symStart: number; symEnd: number; hits: number[] }>();

  for (const lineNum of hitLines) {
    let s: number;
    let e: number;
    let isCommentHit = false;
    if (contextRadius !== undefined) {
      const r = Math.max(0, Math.floor(contextRadius));
      s = Math.max(1, lineNum - r);
      e = Math.min(lines.length, lineNum + r);
    } else {
      const lineText = lines[lineNum - 1] ?? "";
      const isCodeOrDeclHit =
        (!isMockOrTest || Boolean(rankingOpts?.isExplicitTestSearch)) &&
        !isCommentLine(lineText, rankingOpts?.filePath);
      if (isCodeOrDeclHit) {
        if (cachedAstSpans === undefined) {
          cachedAstSpans = collectAstDeclarationSpansForSearch(
            normalizedSource,
            rankingOpts?.filePath,
          );
        }
        const enclosingShort = findEnclosingShortDeclarationSpan(cachedAstSpans, lineNum, 40);
        if (enclosingShort) {
          s = Math.max(1, enclosingShort.startLine);
          e = Math.min(lines.length, enclosingShort.endLine);
        } else {
          const allowMonolithFocus = !rankingOpts?.full && !rankingOpts?.dsl;
          const innermost = allowMonolithFocus
            ? findInnermostEnclosingDeclarationSpan(cachedAstSpans, lineNum)
            : undefined;
          const symStart = innermost ? Math.max(1, innermost.startLine) : 0;
          const symEnd = innermost ? Math.min(lines.length, innermost.endLine) : 0;
          if (innermost && symEnd - symStart + 1 > 65) {
            const key = `${symStart}:${symEnd}`;
            let grp = monolithGroups.get(key);
            if (!grp) {
              grp = { symStart, symEnd, hits: [] };
              monolithGroups.set(key, grp);
            }
            grp.hits.push(lineNum);
            continue;
          }
          s = Math.max(1, lineNum - 10);
          e = Math.min(lines.length, lineNum + 10);
        }
      } else {
        isCommentHit = true;
        s = Math.max(1, lineNum - 2);
        e = Math.min(lines.length, lineNum + 2);
      }
    }
    rawWindows.push({ start: s, end: e, hits: [lineNum], isCommentHit });
  }

  const activeMonoliths = Array.from(monolithGroups.values());
  const nonMonolithRawWindows: Array<{ start: number; end: number; hits: number[] }> = [];
  for (const rw of rawWindows) {
    if (rw.isCommentHit && activeMonoliths.length > 0 && rw.hits.length === 1) {
      const hitLine = rw.hits[0]!;
      let bestMonolith: { symStart: number; symEnd: number; hits: number[] } | undefined;
      for (const grp of activeMonoliths) {
        if (grp.symStart <= hitLine && hitLine <= grp.symEnd) {
          if (
            !bestMonolith ||
            grp.symEnd - grp.symStart < bestMonolith.symEnd - bestMonolith.symStart
          ) {
            bestMonolith = grp;
          }
        }
      }
      if (bestMonolith) {
        bestMonolith.hits.push(hitLine);
        continue;
      }
    }
    nonMonolithRawWindows.push({ start: rw.start, end: rw.end, hits: rw.hits });
  }

  nonMonolithRawWindows.sort((a, b) => a.start - b.start || a.end - b.end);
  type SearchRenderWindow = {
    start: number;
    end: number;
    hits: number[];
    focusSubWindows?: Array<{ start: number; end: number }>;
  };
  const windows: SearchRenderWindow[] = [];
  for (const rw of nonMonolithRawWindows) {
    const last = windows[windows.length - 1];
    if (last && rw.start <= last.end + 1) {
      last.end = Math.max(last.end, rw.end);
      for (const h of rw.hits) {
        if (!last.hits.includes(h)) {
          last.hits.push(h);
        }
      }
      last.hits.sort((a, b) => a - b);
    } else {
      windows.push({ start: rw.start, end: rw.end, hits: [...rw.hits] });
    }
  }

  for (const grp of activeMonoliths) {
    const uniqueHits = Array.from(new Set(grp.hits)).sort((a, b) => a - b);
    const focusSubWindows = computeMonolithFocusSubWindows(grp.symStart, grp.symEnd, uniqueHits);
    windows.push({
      start: grp.symStart,
      end: grp.symEnd,
      hits: uniqueHits,
      ...(focusSubWindows ? { focusSubWindows } : {}),
    });
  }

  const scoredWindows = windows.map((w) => ({
    ...w,
    score: scorePatternWindow(
      lines,
      w,
      rankingOpts?.filePath,
      queryKeyword,
      rankingOpts?.isExplicitTestSearch ?? false,
      rankingOpts?.projectRoot,
    ),
  }));

  const maxScore = scoredWindows.reduce((max, w) => Math.max(max, w.score), 0);

  const topWindows = scoredWindows
    .sort((a, b) => b.score - a.score || a.start - b.start)
    .slice(0, 25)
    .sort((a, b) => a.start - b.start);

  if (rankingOpts?.compactGrouped) {
    const radius = contextRadius !== undefined ? Math.max(0, Math.floor(contextRadius)) : 0;
    const mergedCompact: LineSpanWindow[] = [];
    for (const h of hitLines) {
      const s = Math.max(1, h - radius);
      const e = Math.min(lines.length, h + radius);
      const last = mergedCompact[mergedCompact.length - 1];
      if (last && s <= last.e + 1) {
        last.e = Math.max(last.e, e);
      } else {
        mergedCompact.push({ s, e });
      }
    }
    const outLines: string[] = [];
    const cappedCompact = mergedCompact.slice(0, 40);
    for (let idx = 0; idx < cappedCompact.length; idx++) {
      if (idx > 0 && radius > 0) {
        outLines.push("  ..");
      }
      const cw = cappedCompact[idx]!;
      for (let ln = cw.s; ln <= cw.e; ln++) {
        outLines.push(`  L${ln}: ${lines[ln - 1] ?? ""}`);
      }
    }
    if (mergedCompact.length > cappedCompact.length) {
      outLines.push(`  .. (+${mergedCompact.length - cappedCompact.length} more hits)`);
    }
    return { formattedText: outLines.join("\n"), maxScore };
  }

  const formattedText = topWindows
    .map((w) => {
      const hitDesc = w.hits.map((h) => `L${h}`).join(", ");
      if (w.focusSubWindows && w.focusSubWindows.length > 0) {
        const bodyParts: string[] = [];
        for (let i = 0; i < w.focusSubWindows.length; i++) {
          const sub = w.focusSubWindows[i]!;
          if (i > 0) {
            const gapStart = w.focusSubWindows[i - 1]!.end + 1;
            const gapEnd = sub.start - 1;
            const gapLen = gapEnd - gapStart + 1;
            bodyParts.push(
              `// ... [L${gapStart}-L${gapEnd} skipped — ${gapLen} unrelated lines] ...`,
            );
          }
          for (let l = sub.start; l <= sub.end; l++) {
            bodyParts.push(`${l}: ${lines[l - 1]}`);
          }
        }
        const lastEnd = w.focusSubWindows[w.focusSubWindows.length - 1]!.end;
        if (lastEnd < w.end) {
          const gapStart = lastEnd + 1;
          const gapEnd = w.end;
          const gapLen = gapEnd - gapStart + 1;
          bodyParts.push(
            `// ... [L${gapStart}-L${gapEnd} skipped — ${gapLen} unrelated lines] ...`,
          );
        }
        return `// match at [${hitDesc}] # [L${w.start}-L${w.end}]\n${bodyParts.join("\n")}`;
      }
      const body = lines
        .slice(w.start - 1, w.end)
        .map((text, idx) => `${w.start + idx}: ${text}`)
        .join("\n");
      return `// match at [${hitDesc}] # [L${w.start}-L${w.end}]\n${body}`;
    })
    .join("\n\n");

  return { formattedText, maxScore };
}

export function extractPatternMatchesFromSource(
  rawSource: string,
  rawQuery: string,
  contextRadius?: number,
  rankingOpts?: PatternMatchRankingOptions,
): string | undefined {
  return extractPatternMatchesDetailed(rawSource, rawQuery, contextRadius, rankingOpts)
    ?.formattedText;
}
