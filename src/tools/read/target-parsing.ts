/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  DEFAULT_IGNORED_SCAN_DIRECTORIES,
  findProjectRoot,
  isLikelyTextFileShape,
  isProjectAiceEnabled,
  loadProjectConfig,
} from "../../config/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { type ContextResult, parseSymbolPatternSelector } from "../context.js";
import {
  LINE_RANGE_SELECTOR_RE,
  type NormalizedReadTarget,
  type ParsedReadTarget,
  type ReadTargetInput,
  SINGLE_REGEX_LITERAL_RE,
} from "./types-and-budgets.js";

export function splitCommaSelectors(rawSymbol: string): string[] {
  const trimmed = rawSymbol.trim();
  if (!trimmed) return [];
  if (SINGLE_REGEX_LITERAL_RE.test(trimmed)) {
    return [trimmed];
  }
  const out: string[] = [];
  let current = "";
  let inRegex = false;
  let inCharClass = false;
  let inQuote: string | null = null;
  let escaped = false;
  let curlyDepth = 0;
  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i]!;
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      escaped = true;
      current += ch;
      continue;
    }
    if (inQuote) {
      current += ch;
      if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (inRegex) {
      current += ch;
      if (ch === "[") {
        inCharClass = true;
      } else if (ch === "]" && inCharClass) {
        inCharClass = false;
      } else if (ch === "/" && !inCharClass) {
        inRegex = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      current += ch;
      continue;
    }
    if (ch === "/" && current.trim() === "") {
      inRegex = true;
      inCharClass = false;
      current += ch;
      continue;
    }
    if (ch === "[" && !inCharClass && trimmed.indexOf("]", i + 1) !== -1) {
      inCharClass = true;
      current += ch;
      continue;
    }
    if (ch === "]" && inCharClass) {
      inCharClass = false;
      current += ch;
      continue;
    }
    if (!inCharClass) {
      if (ch === "{" && trimmed.indexOf("}", i + 1) !== -1) {
        curlyDepth++;
      } else if (ch === "}" && curlyDepth > 0) {
        curlyDepth--;
      }
    }
    if (ch === "," && curlyDepth === 0 && !inCharClass) {
      const piece = current.trim();
      if (piece) out.push(piece);
      current = "";
      continue;
    }
    current += ch;
  }
  const last = current.trim();
  if (last) out.push(last);
  return out;
}

export function isPureRegexSelector(selector?: string): boolean {
  if (!selector) return false;
  const parts = splitCommaSelectors(selector);
  return parts.length > 0 && parts.every((part) => SINGLE_REGEX_LITERAL_RE.test(part.trim()));
}

export function targetExistsAtBase(candidatePath: string, baseDir: string): boolean {
  const absInBase = path.isAbsolute(candidatePath)
    ? candidatePath
    : path.resolve(baseDir, candidatePath);
  if (fs.existsSync(absInBase) || fs.existsSync(`${absInBase}.aice`)) {
    return true;
  }
  const cwd = process.cwd();
  if (path.resolve(baseDir) !== path.resolve(cwd) && !path.isAbsolute(candidatePath)) {
    const absInCwd = path.resolve(cwd, candidatePath);
    if (fs.existsSync(absInCwd) || fs.existsSync(`${absInCwd}.aice`)) {
      return true;
    }
  }
  return false;
}

/**
 * Splits a single target token into its file/directory path and optional inline selector:
 *   - `file:sym1,sym2` -> `{ targetPath: "file", inlineSelector: "sym1,sym2", explicitOutline: false }`
 *   - `file:L10-L50` -> `{ targetPath: "file", inlineSelector: "L10-L50", explicitOutline: false }`
 *   - `file:/pattern/` or `dir:/pattern/` -> `{ targetPath, inlineSelector: "/pattern/", explicitOutline: false }`
 *   - `file:outline` or `dir:outline` -> `{ targetPath, explicitOutline: true }`
 */
export function parseReadTarget(rawTarget: string, baseDir = process.cwd()): ParsedReadTarget {
  const trimmed = rawTarget.trim();
  const searchStart = /^[a-zA-Z]:[\\/]/.test(trimmed) ? 2 : 0;
  const colonIdx = trimmed.indexOf(":", searchStart);
  if (colonIdx > 0) {
    const candidatePath = trimmed.slice(0, colonIdx).trim();
    const candidateSym = trimmed.slice(colonIdx + 1).trim();
    if (candidatePath && candidateSym) {
      const isKnownFileShape = isLikelyTextFileShape(candidatePath);
      const isSymbolPattern = Boolean(parseSymbolPatternSelector(candidateSym));
      const isUnclosedSlashSelector =
        candidateSym.startsWith("/") && candidateSym.length > 1 && !/\s/.test(candidateSym);
      const isUnambiguousSelector =
        !/\s/.test(candidatePath) &&
        (candidateSym.toLowerCase() === "outline" ||
          LINE_RANGE_SELECTOR_RE.test(candidateSym) ||
          SINGLE_REGEX_LITERAL_RE.test(candidateSym) ||
          isSymbolPattern ||
          isUnclosedSlashSelector);
      const hasGlobPattern = /[*?[\]{}]/.test(candidatePath);
      if (
        isKnownFileShape ||
        isUnambiguousSelector ||
        hasGlobPattern ||
        targetExistsAtBase(candidatePath, baseDir)
      ) {
        if (candidateSym.toLowerCase() === "outline") {
          return {
            raw: trimmed,
            targetPath: candidatePath,
            explicitOutline: true,
          };
        }
        return {
          raw: trimmed,
          targetPath: candidatePath,
          inlineSelector: candidateSym,
          explicitOutline: false,
        };
      }
    }
  }
  return {
    raw: trimmed,
    targetPath: trimmed,
    explicitOutline: false,
  };
}

/**
 * Splits a whitespace-delimited multi-target string while preserving:
 *   - Single/double quoted segments
 *   - Inline `/regex with spaces/` selectors (e.g. `src/rules:/aice read/`)
 *   - Markdown headings / test titles with spaces (e.g. `README.md:Quick Start`)
 *   - Existing file/directory paths containing spaces on disk
 */
export function splitReadTargetString(rawTargetStr: string, baseDir = process.cwd()): string[] {
  const trimmed = rawTargetStr.trim();
  if (!trimmed) return [];
  if (!/\s+/.test(trimmed)) return [trimmed];

  const wholeCheck = parseReadTarget(trimmed, baseDir);
  if (targetExistsAtBase(wholeCheck.targetPath, baseDir)) {
    if (!wholeCheck.inlineSelector || !/\s/.test(wholeCheck.inlineSelector)) {
      return [trimmed];
    }
    if (SINGLE_REGEX_LITERAL_RE.test(wholeCheck.inlineSelector)) {
      return [trimmed];
    }
    const firstExt = path.extname(wholeCheck.targetPath).toLowerCase();
    const isDocOrTest =
      firstExt === ".md" ||
      firstExt === ".markdown" ||
      /\.(?:test|spec)\.[a-z0-9]+$/i.test(wholeCheck.targetPath);
    if (isDocOrTest) {
      const symWords = wholeCheck.inlineSelector.split(/\s+/).filter(Boolean);
      const tailWords = symWords.slice(1);
      const hasExplicitNextTarget = tailWords.some((w) => {
        const parsedW = parseReadTarget(w, baseDir);
        if (parsedW.inlineSelector || parsedW.explicitOutline) return true;
        if (w.includes("/") || w.includes("\\")) return true;
        return false;
      });
      if (!hasExplicitNextTarget) {
        return [trimmed];
      }
    }
  }

  // Tokenize respecting quotes AND `:/regex literal/` spans
  const rawTokens: string[] = [];
  let hadQuotes = false;
  let cur = "";
  let quoteChar: string | null = null;
  let inInlineRegex = false;
  let regexCharClass = false;

  for (let i = 0; i < trimmed.length; i++) {
    const ch = trimmed[i] ?? "";
    if (quoteChar) {
      if (ch === "\\" && i + 1 < trimmed.length) {
        cur += trimmed[i + 1] ?? "";
        i++;
        continue;
      }
      if (ch === quoteChar) {
        quoteChar = null;
        continue;
      }
      cur += ch;
      continue;
    }
    if (inInlineRegex) {
      cur += ch;
      if (ch === "\\" && i + 1 < trimmed.length) {
        cur += trimmed[i + 1] ?? "";
        i++;
        continue;
      }
      if (ch === "[") {
        regexCharClass = true;
      } else if (ch === "]" && regexCharClass) {
        regexCharClass = false;
      } else if (ch === "/" && !regexCharClass) {
        inInlineRegex = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      quoteChar = ch;
      hadQuotes = true;
      continue;
    }
    if (ch === "/" && cur.endsWith(":") && cur.length > 1) {
      inInlineRegex = true;
      regexCharClass = false;
      cur += ch;
      continue;
    }
    if (/\s/.test(ch)) {
      if (cur) {
        rawTokens.push(cur);
        cur = "";
      }
      continue;
    }
    cur += ch;
  }
  if (cur) rawTokens.push(cur);

  if (rawTokens.length <= 1) {
    return rawTokens.length === 1 && rawTokens[0] !== undefined ? [rawTokens[0]] : [trimmed];
  }
  if (hadQuotes) {
    return rawTokens;
  }

  // Merge adjacent tokens only when they form an existing path with spaces on disk
  const mergedTokens: string[] = [];
  let idx = 0;
  while (idx < rawTokens.length) {
    const tok = rawTokens[idx] ?? "";
    const tokParsed = parseReadTarget(tok, baseDir);
    const tokLooksStandalone =
      tokParsed.explicitOutline ||
      Boolean(tokParsed.inlineSelector) ||
      targetExistsAtBase(tokParsed.targetPath, baseDir) ||
      isLikelyTextFileShape(tokParsed.targetPath);

    if (!tokLooksStandalone && idx + 1 < rawTokens.length) {
      let combined = tok;
      let matchedSpan = -1;
      for (let j = idx + 1; j < rawTokens.length; j++) {
        combined += ` ${rawTokens[j] ?? ""}`;
        const combParsed = parseReadTarget(combined, baseDir);
        if (
          targetExistsAtBase(combParsed.targetPath, baseDir) &&
          (!combParsed.inlineSelector || !/\s/.test(combParsed.inlineSelector))
        ) {
          matchedSpan = j;
          break;
        }
      }
      if (matchedSpan > idx) {
        mergedTokens.push(rawTokens.slice(idx, matchedSpan + 1).join(" "));
        idx = matchedSpan + 1;
        continue;
      }
    }
    mergedTokens.push(tok);
    idx++;
  }

  return mergedTokens;
}

export function hasGlobMagicChars(rawPath: string): boolean {
  return /[*?[\]{}]/.test(rawPath);
}

export function expandBracePatterns(pattern: string): string[] {
  const openIdx = pattern.indexOf("{");
  if (openIdx < 0) return [pattern];
  let depth = 0;
  let closeIdx = -1;
  const alternatives: string[] = [];
  let partStart = openIdx + 1;
  for (let i = openIdx; i < pattern.length; i++) {
    const ch = pattern[i];
    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        alternatives.push(pattern.slice(partStart, i));
        closeIdx = i;
        break;
      }
    } else if (ch === "," && depth === 1) {
      alternatives.push(pattern.slice(partStart, i));
      partStart = i + 1;
    }
  }
  if (closeIdx < 0 || alternatives.length === 0) {
    return [pattern];
  }
  const prefix = pattern.slice(0, openIdx);
  const suffix = pattern.slice(closeIdx + 1);
  const expandedSuffixes = expandBracePatterns(suffix);
  const results: string[] = [];
  for (const alt of alternatives) {
    for (const tail of expandedSuffixes) {
      results.push(`${prefix}${alt}${tail}`);
    }
  }
  return results;
}

export function globPatternToRegExp(globPosix: string): RegExp {
  let rx = "^";
  let i = 0;
  while (i < globPosix.length) {
    const ch = globPosix[i]!;
    if (ch === "*") {
      if (globPosix[i + 1] === "*") {
        if (globPosix[i + 2] === "/") {
          rx += "(?:.*/)?";
          i += 3;
          continue;
        }
        rx += ".*";
        i += 2;
        continue;
      }
      rx += "[^/]*";
      i++;
      continue;
    }
    if (ch === "?") {
      rx += "[^/]";
      i++;
      continue;
    }
    if (ch === "[") {
      const closeBracket = globPosix.indexOf("]", i + 1);
      if (closeBracket > i + 1) {
        let clsBody = globPosix.slice(i + 1, closeBracket);
        if (clsBody.startsWith("!")) {
          clsBody = `^${clsBody.slice(1)}`;
        }
        rx += `[${clsBody}]`;
        i = closeBracket + 1;
        continue;
      }
    }
    if ("\\^$+?.()|{}".includes(ch)) {
      rx += `\\${ch}`;
    } else {
      rx += ch;
    }
    i++;
  }
  rx += "$";
  return new RegExp(rx);
}

export function expandGlobTargetPaths(rawGlobPath: string, baseDir: string): string[] {
  const normRaw = rawGlobPath.trim().replace(/\\/g, "/");
  if (!hasGlobMagicChars(normRaw) || targetExistsAtBase(rawGlobPath, baseDir)) {
    return [];
  }

  const isAbsPattern = path.isAbsolute(rawGlobPath) || normRaw.startsWith("/");
  const cleanPattern = !isAbsPattern && normRaw.startsWith("./") ? normRaw.slice(2) : normRaw;
  const braceExpanded = expandBracePatterns(cleanPattern);

  const firstExpanded = braceExpanded[0] ?? cleanPattern;
  const firstSegments = firstExpanded.split("/");
  const staticSegs: string[] = [];
  for (const seg of firstSegments) {
    if (hasGlobMagicChars(seg)) break;
    if (braceExpanded.every((variant) => variant.split("/")[staticSegs.length] === seg)) {
      staticSegs.push(seg);
    } else {
      break;
    }
  }

  const explicitAllowedDirs = new Set(staticSegs.filter(Boolean));
  const rootInNodeModules = explicitAllowedDirs.has("node_modules");
  const walkBase = isAbsPattern
    ? staticSegs.length > 0
      ? staticSegs.join("/") || "/"
      : "/"
    : path.resolve(baseDir, staticSegs.join("/"));

  if (!fs.existsSync(walkBase)) {
    return [];
  }

  const matchers = braceExpanded.map((pat) => globPatternToRegExp(pat));
  const matchedPaths = new Set<string>();

  const walkDir = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === ".git") continue;
        if (ent.name === "node_modules" && !explicitAllowedDirs.has("node_modules")) continue;
        if (
          DEFAULT_IGNORED_SCAN_DIRECTORIES.has(ent.name) &&
          !explicitAllowedDirs.has(ent.name) &&
          !(
            rootInNodeModules &&
            (ent.name === "dist" || ent.name === "build" || ent.name === "out")
          )
        ) {
          continue;
        }
        walkDir(childAbs);
      } else if (ent.isFile()) {
        const candidatePosix = isAbsPattern
          ? childAbs.replace(/\\/g, "/")
          : path.relative(baseDir, childAbs).replace(/\\/g, "/");
        if (matchers.some((rx) => rx.test(candidatePosix))) {
          matchedPaths.add(candidatePosix);
        }
      }
    }
  };

  try {
    const st = fs.statSync(walkBase);
    if (st.isFile()) {
      const candidatePosix = isAbsPattern
        ? walkBase.replace(/\\/g, "/")
        : path.relative(baseDir, walkBase).replace(/\\/g, "/");
      if (matchers.some((rx) => rx.test(candidatePosix))) {
        matchedPaths.add(candidatePosix);
      }
    } else if (st.isDirectory()) {
      walkDir(walkBase);
    }
  } catch {
    return [];
  }

  return Array.from(matchedPaths).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
}

/**
 * Normalizes omitted, single-string, or multi-target array inputs into `NormalizedReadTarget[]`,
 * expanding quoted bash globs deterministically while skipping ignored directories.
 */
export function normalizeReadTargets(
  targets?: ReadTargetInput | ReadTargetInput[],
  baseDir = process.cwd(),
  options?: { coalesceSameFile?: boolean },
): NormalizedReadTarget[] {
  if (targets === undefined) return [];
  const list = Array.isArray(targets) ? targets : [targets];
  const out: NormalizedReadTarget[] = [];

  const isStandaloneCommaTargetToken = (piece: string): ParsedReadTarget | undefined => {
    const colonPos = piece.indexOf(":", /^[a-zA-Z]:[\\/]/.test(piece) ? 2 : 0);
    if (colonPos <= 0) return undefined;
    const candFile = piece.slice(0, colonPos).trim();
    const candSel = piece.slice(colonPos + 1).trim();
    if (!candFile || !candSel) return undefined;
    if (
      candFile.includes("/") ||
      candFile.includes("\\") ||
      isLikelyTextFileShape(candFile) ||
      targetExistsAtBase(candFile, baseDir)
    ) {
      return parseReadTarget(piece, baseDir);
    }
    return undefined;
  };

  const pushSingleOrGlobNormalized = (entry: NormalizedReadTarget): void => {
    if (hasGlobMagicChars(entry.targetPath) && !targetExistsAtBase(entry.targetPath, baseDir)) {
      const expanded = expandGlobTargetPaths(entry.targetPath, baseDir);
      if (expanded.length > 0) {
        for (const matchPath of expanded) {
          const suffix = entry.explicitOutline
            ? ":outline"
            : entry.selector
              ? `:${entry.selector}`
              : "";
          out.push({
            raw: `${matchPath}${suffix}`,
            targetPath: matchPath,
            selector: entry.selector,
            explicitOutline: entry.explicitOutline,
            explicitFull: entry.explicitFull,
          });
        }
        return;
      }
    }
    out.push(entry);
  };

  // R4: Split comma-joined `file1:L1-L10,file2:L20-L30` into distinct NormalizedReadTargets
  const pushOrExpandNormalized = (entry: NormalizedReadTarget): void => {
    if (
      entry.selector &&
      entry.selector.includes(",") &&
      !SINGLE_REGEX_LITERAL_RE.test(entry.selector.trim())
    ) {
      const commaParts = splitCommaSelectors(entry.selector);
      if (
        commaParts.length > 1 &&
        commaParts.slice(1).some((p) => Boolean(isStandaloneCommaTargetToken(p)))
      ) {
        let activeTargetPath = entry.targetPath;
        let activeOutline = entry.explicitOutline;
        let pendingSelectors: string[] = [];
        const flushPending = (): void => {
          if (pendingSelectors.length === 0 && !activeOutline) return;
          const joined = pendingSelectors.join(",");
          pushSingleOrGlobNormalized({
            raw: activeOutline ? `${activeTargetPath}:outline` : `${activeTargetPath}:${joined}`,
            targetPath: activeTargetPath,
            selector: activeOutline ? undefined : joined || undefined,
            explicitOutline: activeOutline,
            explicitFull: entry.explicitFull,
          });
          pendingSelectors = [];
        };
        for (const cp of commaParts) {
          const nextTarget = isStandaloneCommaTargetToken(cp);
          if (nextTarget) {
            flushPending();
            activeTargetPath = nextTarget.targetPath;
            activeOutline = nextTarget.explicitOutline;
            if (nextTarget.inlineSelector) {
              pendingSelectors.push(nextTarget.inlineSelector);
            }
          } else {
            pendingSelectors.push(cp);
          }
        }
        flushPending();
        return;
      }
    }
    pushSingleOrGlobNormalized(entry);
  };
  for (const item of list) {
    if (typeof item === "string") {
      const pieces = splitReadTargetString(item, baseDir);
      for (const piece of pieces) {
        const parsed = parseReadTarget(piece, baseDir);
        if (!parsed.targetPath) continue;
        pushOrExpandNormalized({
          raw: piece,
          targetPath: parsed.targetPath,
          selector: parsed.inlineSelector,
          explicitOutline: parsed.explicitOutline,
          explicitFull: false,
        });
      }
    } else if (item && typeof item === "object" && typeof item.path === "string") {
      const trimmedPath = item.path.trim();
      if (!trimmedPath) continue;
      const parsed = parseReadTarget(trimmedPath, baseDir);
      if (!parsed.targetPath) continue;
      const rawSelector = parsed.inlineSelector ?? item.symbol?.trim() ?? undefined;
      const selectorIsOutline = rawSelector?.toLowerCase() === "outline";
      pushOrExpandNormalized({
        raw: trimmedPath,
        targetPath: parsed.targetPath,
        selector: selectorIsOutline ? undefined : rawSelector || undefined,
        explicitOutline:
          Boolean(item.outline) || parsed.explicitOutline || Boolean(selectorIsOutline),
        explicitFull: Boolean(item.full),
      });
    }
  }

  if (options?.coalesceSameFile === false || out.length <= 1) {
    return out;
  }

  const isCoalescibleContextEntry = (entry: NormalizedReadTarget): boolean => {
    if (entry.explicitOutline) return false;
    const sel = entry.selector?.trim();
    if (!sel) return false;
    if (sel.startsWith("/") || isPureRegexSelector(sel)) return false;
    const lower = sel.toLowerCase();
    if (lower === "outline" || lower === "imports" || lower === "import" || sel === "*") {
      return false;
    }
    return true;
  };

  const resolveKey = (targetPath: string): string => {
    const pre = resolveEffectiveTargetAndRoot(targetPath, baseDir).targetPath;
    const abs = path.isAbsolute(pre) ? path.resolve(pre) : path.resolve(baseDir, pre);
    if (!fs.existsSync(abs) && fs.existsSync(`${abs}.aice`)) {
      return `${abs}.aice`;
    }
    return abs;
  };

  const coalesced: NormalizedReadTarget[] = [];
  const groupByKey = new Map<
    string,
    {
      index: number;
      selectors: string[];
      seen: Set<string>;
      explicitFull: boolean;
      merged: boolean;
    }
  >();

  for (const entry of out) {
    if (!isCoalescibleContextEntry(entry)) {
      coalesced.push(entry);
      continue;
    }
    const key = resolveKey(entry.targetPath);
    const existing = groupByKey.get(key);
    const pieces = splitCommaSelectors(entry.selector!.trim());
    if (!existing) {
      const seen = new Set<string>();
      const selectors: string[] = [];
      for (const p of pieces) {
        if (!seen.has(p)) {
          seen.add(p);
          selectors.push(p);
        }
      }
      const idx = coalesced.length;
      coalesced.push(entry);
      groupByKey.set(key, {
        index: idx,
        selectors,
        seen,
        explicitFull: entry.explicitFull,
        merged: false,
      });
    } else if (existing.explicitFull === entry.explicitFull) {
      for (const p of pieces) {
        if (!existing.seen.has(p)) {
          existing.seen.add(p);
          existing.selectors.push(p);
        }
      }
      existing.merged = true;
      const joinedSel = existing.selectors.join(",");
      const firstEntry = coalesced[existing.index]!;
      coalesced[existing.index] = {
        ...firstEntry,
        raw: `${firstEntry.targetPath}:${joinedSel}`,
        selector: joinedSel,
      };
    } else {
      coalesced.push(entry);
    }
  }

  return coalesced;
}

export function resolveEffectiveTargetAndRoot(
  rawTargetPath: string,
  explicitProjectRoot?: string,
): { targetPath: string; projectRoot?: string } {
  if (explicitProjectRoot) {
    const root = path.resolve(explicitProjectRoot);
    if (!path.isAbsolute(rawTargetPath)) {
      const fromRoot = path.resolve(root, rawTargetPath);
      if (fs.existsSync(fromRoot) || fs.existsSync(`${fromRoot}.aice`)) {
        return { targetPath: fromRoot, projectRoot: root };
      }
      const fromCwd = path.resolve(process.cwd(), rawTargetPath);
      if (fs.existsSync(fromCwd) || fs.existsSync(`${fromCwd}.aice`)) {
        return { targetPath: fromCwd, projectRoot: root };
      }
      return { targetPath: fromRoot, projectRoot: root };
    }
    return { targetPath: path.resolve(rawTargetPath), projectRoot: root };
  }

  const absCandidate = path.isAbsolute(rawTargetPath)
    ? path.resolve(rawTargetPath)
    : path.resolve(process.cwd(), rawTargetPath);
  const existingCandidate = fs.existsSync(absCandidate)
    ? absCandidate
    : fs.existsSync(`${absCandidate}.aice`)
      ? `${absCandidate}.aice`
      : undefined;
  if (existingCandidate) {
    const st = fs.statSync(existingCandidate);
    const targetDir = st.isDirectory() ? existingCandidate : path.dirname(existingCandidate);
    const cwdResolved = path.resolve(process.cwd());
    if (targetDir !== cwdResolved && !targetDir.startsWith(`${cwdResolved}${path.sep}`)) {
      const extRoot = findProjectRoot(targetDir, targetDir);
      const cwdRoot = findProjectRoot(cwdResolved, cwdResolved);
      if (
        isProjectAiceEnabled(loadProjectConfig(cwdRoot)) &&
        !fs.existsSync(path.join(extRoot, "aice.config.json"))
      ) {
        return { targetPath: absCandidate, projectRoot: cwdRoot };
      }
      return { targetPath: absCandidate, projectRoot: extRoot };
    }
  }
  return { targetPath: rawTargetPath, projectRoot: undefined };
}

export function formatReadDisplayPath(
  fullPath: string,
  projectRoot: string,
  fallbackRaw?: string,
): string {
  const absFull = path.resolve(fullPath);
  const absRoot = path.resolve(projectRoot);
  const cwdResolved = path.resolve(process.cwd());
  const rel = path.relative(absRoot, absFull);
  if (
    absRoot !== cwdResolved &&
    absRoot.startsWith(`${cwdResolved}${path.sep}`) &&
    path.resolve(cwdResolved, rel) !== absFull
  ) {
    const rawClean = fallbackRaw?.trim();
    const isExplicitRootRelativeFallback = Boolean(
      rawClean &&
        !path.isAbsolute(rawClean) &&
        path.resolve(absRoot, rawClean) === absFull &&
        path.resolve(cwdResolved, rawClean) !== absFull,
    );
    if (!isExplicitRootRelativeFallback) {
      const relCwdFromSub = path.relative(cwdResolved, absFull);
      if (relCwdFromSub === "") {
        return ".";
      }
      if (!relCwdFromSub.startsWith("..") && !path.isAbsolute(relCwdFromSub)) {
        return relCwdFromSub.replace(/\\/g, "/");
      }
    }
  }
  if (rel === "") {
    return fallbackRaw?.trim() ? fallbackRaw.trim().replace(/\\/g, "/") : ".";
  }
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, "/");
  }
  const relCwd = path.relative(cwdResolved, absFull);
  if (relCwd && !relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    return relCwd.replace(/\\/g, "/");
  }
  return (fallbackRaw ?? absFull).replace(/\\/g, "/");
}

export function normalizeContextResultDisplayPath(
  res: ContextResult,
  expectedDisplayPath: string,
): ContextResult {
  const oldPath = res.targetPath;
  if (!oldPath || !expectedDisplayPath || oldPath === expectedDisplayPath) {
    return res;
  }
  if (!expectedDisplayPath.endsWith(`/${oldPath}`)) {
    return res;
  }
  const escapedOld = oldPath.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const headerRe = new RegExp(
    `^(\\/\\/ (?:=== )?|# AICE Context Pack: )${escapedOld}(?=$|:|\\s+===)`,
    "gm",
  );
  const nextFormatted = res.formattedBundle.replace(headerRe, `$1${expectedDisplayPath}`);
  const nextContent = res.targetContent.replace(headerRe, `$1${expectedDisplayPath}`);
  if (nextFormatted === res.formattedBundle && nextContent === res.targetContent) {
    return { ...res, targetPath: expectedDisplayPath };
  }
  return {
    ...res,
    targetPath: expectedDisplayPath,
    targetContent: nextContent,
    formattedBundle: nextFormatted,
    tokenCount: estimateTokens(nextFormatted),
  };
}

export function truncateBundleToMaxTokens(
  bundle: string,
  maxTokens?: number,
): { text: string; tokenCount: number } {
  const initialTokens = estimateTokens(bundle);
  if (maxTokens === undefined || initialTokens <= maxTokens) {
    return { text: bundle, tokenCount: initialTokens };
  }

  const truncatedFooter = "\n\n// ... [truncated to fit maxTokens]";
  const lines = bundle.split("\n");
  while (lines.length > 1) {
    lines.pop();
    const openFenceCount = lines.filter((l) => l.startsWith("```")).length;
    const closeFence = openFenceCount % 2 === 1 ? "\n```" : "";
    const candidate = `${lines.join("\n")}${closeFence}${truncatedFooter}`;
    const candTokens = estimateTokens(candidate);
    if (candTokens <= maxTokens) {
      return { text: candidate, tokenCount: candTokens };
    }
  }

  let chars = bundle.length;
  while (chars > 0 && estimateTokens(bundle.slice(0, chars) + truncatedFooter) > maxTokens) {
    chars = Math.floor(chars * 0.7);
  }
  const fallback =
    estimateTokens(bundle.slice(0, chars) + truncatedFooter) <= maxTokens
      ? `${chars > 0 ? bundle.slice(0, chars) : ""}${truncatedFooter}`
      : truncatedFooter.slice(0, Math.max(0, maxTokens * 3));
  return { text: fallback, tokenCount: estimateTokens(fallback) };
}
