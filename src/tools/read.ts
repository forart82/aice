/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Pillar 1: Unified Read Engine (`aice read` / MCP `aice_read`).
 *
 * Automatically routes every target in single-target or multi-target streams to the
 * optimal internal engine without exposing separate `outline` vs `context` tools:
 *   - Explicit outline (`options.outline === true` or inline `:outline`) -> `outlinePath`
 *   - Directory without `/pattern/` or symbol selector -> structural `outlinePath`
 *   - Directory with `/pattern/` or symbol selector -> `generateContext` (4-tier search / slice)
 *   - File with `:symbol`, `:Lstart-Lend`, or `:/pattern/` -> `generateContext` / `generateMultiContext`
 *   - Bare file > 250 lines (unless `full: true` or `outlineTarget: true`) -> auto-`outlinePath` with guidance header
 *   - Bare file <= 250 lines (or `full: true`) -> full `generateContext` pack
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  DEFAULT_IGNORED_SCAN_DIRECTORIES,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  PASSTHROUGH_FILENAMES,
  type ProjectIdiomDefinition,
  type ResolvedPathTargets,
  resolvePathTargets,
} from "../config/index.js";
import { recordTelemetryEvent, withSuppressedTelemetryAsync } from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import {
  type CallerSummary,
  type ContextOptions,
  type ContextResult,
  computeHonestReadBaselineText,
  type DependencyContract,
  generateContext,
  mergeMultiContextResults,
  type WorkspaceCallerScanCache,
} from "./context.js";
import { type OutlineOptions, type OutlineResult, outlinePath } from "./outline.js";
import { didYouMeanFile } from "./suggest.js";

export const DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD = 250;
export const DEFAULT_READ_MAX_BYTES = 28 * 1024; // 28,672 bytes (~7,000 BPE tokens)
export const DEFAULT_READ_MAX_TOKENS = 7_000;

const SINGLE_REGEX_LITERAL_RE = /^\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+\/[gimsuy]*$/;
const LINE_RANGE_SELECTOR_RE = /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i;

export type ReadRouteMode =
  | "outline"
  | "auto-outline-dir"
  | "auto-outline-file"
  | "context"
  | "search"
  | "workspace"
  | "mixed";

export interface ReadTargetObject {
  path: string;
  symbol?: string;
  outline?: boolean;
  full?: boolean;
}

export type ReadTargetInput = string | ReadTargetObject;

export interface ParsedReadTarget {
  raw: string;
  targetPath: string;
  inlineSelector?: string;
  explicitOutline: boolean;
}

export interface NormalizedReadTarget {
  raw: string;
  targetPath: string;
  selector?: string;
  explicitOutline: boolean;
  explicitFull: boolean;
}

export interface ReadOptions {
  /**
   * Shared selector (`Class.method`, `TC-001`, Markdown heading, `L10-L50`, `/pattern/`, or `"outline"`).
   */
  symbol?: string;
  /**
   * Explicitly force structural `outlinePath` on target(s).
   */
  outline?: boolean;
  /**
   * Legacy ContextOptions compatibility: emit target outline inside context pack instead of full source.
   */
  outlineTarget?: boolean;
  /**
   * Bypass >250-line bare-file auto-outline and emit full context pack.
   */
  full?: boolean;
  /**
   * Line threshold above which bare files without a selector are automatically outlined (default: 250).
   */
  autoOutlineLineThreshold?: number;
  /**
   * Whether bare files exceeding `autoOutlineLineThreshold` are auto-outlined (default: true).
   */
  autoOutlineBareFiles?: boolean;
  /**
   * Whether bare directory targets without a selector are auto-outlined via `outlinePath` (default: true).
   */
  autoOutlineDirectories?: boolean;
  /**
   * Dependency traversal depth (for context) or maximum symbol nesting depth (for outline).
   */
  depth?: number;
  /**
   * Maximum token budget; truncates rendered output cleanly if exceeded.
   */
  maxTokens?: number;
  /**
   * Explicitly force or skip dependency contract resolution (--deps / --no-deps).
   */
  includeDeps?: boolean;
  /**
   * Include reverse downstream callers in context packs (--callers / --no-callers).
   */
  includeCallers?: boolean;
  /**
   * Force-enable or disable project `$idioms`.
   */
  idioms?: boolean;
  /**
   * Compact directory outline mode (auto-enabled for 60+ files in `outlinePath` unless set to `false`).
   */
  compact?: boolean;
  /**
   * Include type annotations in structural outlines (default: true).
   */
  includeTypes?: boolean;
  /**
   * Allow partial symbol match when multiple selectors are passed.
   */
  allowPartialSymbolMatch?: boolean;
  /**
   * Explicit workspace/project root directory.
   */
  projectRoot?: string;
  /**
   * Produce structured JSON output (`jsonData` / `jsonOutput` / `output`).
   */
  json?: boolean;
  /**
   * Compute and attach token reduction / context telemetry statistics (`stats` / `statsText`).
   */
  stats?: boolean;
  /**
   * Telemetry surface attribution (default: `"cli"`).
   */
  surface?: "cli" | "mcp";
  /**
   * Optional shared workspace caller/import scan cache across context targets.
   */
  workspaceScanCache?: WorkspaceCallerScanCache;
}

export interface ReadStats {
  tokenCount: number;
  originalTokens?: number;
  savedTokens?: number;
  savingsPct?: number;
  originalChars?: number;
  outputChars: number;
  charSavingsPct?: number;
  dependenciesCount: number;
  callersCount: number;
  fileCount: number;
}

export interface ReadTargetSummary {
  targetPath: string;
  resolvedPath: string;
  mode: Exclude<ReadRouteMode, "mixed">;
  selector?: string;
  autoOutlined?: boolean;
  lineCount?: number;
}

export interface ReadResult {
  mode: ReadRouteMode;
  targetPath: string;
  text: string;
  formattedBundle: string;
  targetContent: string;
  output: string;
  tokenCount: number;
  targets: ReadTargetSummary[];
  missingTargets: string[];
  dependencies: DependencyContract[];
  callers: CallerSummary[];
  idioms?: Record<string, ProjectIdiomDefinition>;
  nativeDiagnostics?: string;
  contextResult?: ContextResult;
  contextResults?: ContextResult[];
  outlineResult?: OutlineResult | Map<string, OutlineResult>;
  jsonData?: unknown;
  jsonOutput?: string;
  stats: ReadStats;
  statsText?: string;
}

/**
 * Counts logical source lines in O(N) time without allocating line arrays,
 * treating a single trailing newline (`\n` or `\r\n`) as terminating the last line
 * rather than adding a phantom blank line.
 */
export function countSourceLines(source: string): number {
  if (source.length === 0) return 0;
  const end = source.endsWith("\r\n")
    ? source.length - 2
    : source.endsWith("\n")
      ? source.length - 1
      : source.length;
  if (end <= 0) return 1;
  let lines = 1;
  for (let i = 0; i < end; i++) {
    if (source.charCodeAt(i) === 10) {
      lines++;
    }
  }
  return lines;
}

function splitCommaSelectors(rawSymbol: string): string[] {
  const trimmed = rawSymbol.trim();
  if (!trimmed) return [];
  if (SINGLE_REGEX_LITERAL_RE.test(trimmed)) {
    return [trimmed];
  }
  const out: string[] = [];
  let current = "";
  let inRegex = false;
  let regexCharClass = false;
  let inQuote: string | null = null;
  let escaped = false;
  for (const ch of trimmed) {
    if (escaped) {
      current += ch;
      escaped = false;
      continue;
    }
    if (inQuote) {
      current += ch;
      if (ch === "\\") {
        escaped = true;
      } else if (ch === inQuote) {
        inQuote = null;
      }
      continue;
    }
    if (inRegex) {
      current += ch;
      if (ch === "\\") {
        escaped = true;
      } else if (ch === "[") {
        regexCharClass = true;
      } else if (ch === "]" && regexCharClass) {
        regexCharClass = false;
      } else if (ch === "/" && !regexCharClass) {
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
      regexCharClass = false;
      current += ch;
      continue;
    }
    if (ch === ",") {
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

function isPureRegexSelector(selector?: string): boolean {
  if (!selector) return false;
  const parts = splitCommaSelectors(selector);
  return parts.length > 0 && parts.every((part) => SINGLE_REGEX_LITERAL_RE.test(part.trim()));
}

function targetExistsAtBase(candidatePath: string, baseDir: string): boolean {
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
      const ext = path.extname(candidatePath).toLowerCase();
      const baseName = path.basename(candidatePath);
      const isKnownFileShape =
        KNOWN_TARGET_EXTENSIONS.has(ext) ||
        ext === ".aice" ||
        PASSTHROUGH_FILENAMES.has(baseName) ||
        baseName.startsWith(".env.");
      const isUnambiguousSelector =
        !/\s/.test(candidatePath) &&
        (candidateSym.toLowerCase() === "outline" ||
          LINE_RANGE_SELECTOR_RE.test(candidateSym) ||
          SINGLE_REGEX_LITERAL_RE.test(candidateSym));
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
    const tokExt = path.extname(tokParsed.targetPath).toLowerCase();
    const tokLooksStandalone =
      tokParsed.explicitOutline ||
      Boolean(tokParsed.inlineSelector) ||
      targetExistsAtBase(tokParsed.targetPath, baseDir) ||
      KNOWN_TARGET_EXTENSIONS.has(tokExt) ||
      tokExt === ".aice";

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

function hasGlobMagicChars(rawPath: string): boolean {
  return /[*?[\]{}]/.test(rawPath);
}

function expandBracePatterns(pattern: string): string[] {
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

function globPatternToRegExp(globPosix: string): RegExp {
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

function expandGlobTargetPaths(rawGlobPath: string, baseDir: string): string[] {
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
        if (DEFAULT_IGNORED_SCAN_DIRECTORIES.has(ent.name) && !explicitAllowedDirs.has(ent.name)) {
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
): NormalizedReadTarget[] {
  if (targets === undefined) return [];
  const list = Array.isArray(targets) ? targets : [targets];
  const out: NormalizedReadTarget[] = [];

  const pushOrExpandNormalized = (entry: NormalizedReadTarget): void => {
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
  return out;
}

function resolveEffectiveTargetAndRoot(
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
      const root = findProjectRoot(targetDir, targetDir);
      return { targetPath: absCandidate, projectRoot: root };
    }
  }
  return { targetPath: rawTargetPath, projectRoot: undefined };
}

function formatReadDisplayPath(
  fullPath: string,
  projectRoot: string,
  fallbackRaw?: string,
): string {
  const absFull = path.resolve(fullPath);
  const absRoot = path.resolve(projectRoot);
  const rel = path.relative(absRoot, absFull);
  if (rel === "") {
    return fallbackRaw?.trim() ? fallbackRaw.trim().replace(/\\/g, "/") : ".";
  }
  if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
    return rel.replace(/\\/g, "/");
  }
  const relCwd = path.relative(process.cwd(), absFull);
  if (relCwd && !relCwd.startsWith("..") && !path.isAbsolute(relCwd)) {
    return relCwd.replace(/\\/g, "/");
  }
  return (fallbackRaw ?? absFull).replace(/\\/g, "/");
}

function truncateBundleToMaxTokens(
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

function buildAutoOutlineHeader(displayPath: string, lineCount: number): string {
  return `// Auto-outlined (${lineCount} lines). Pass ${displayPath}:<symbol>, ${displayPath}:L<start>-L<end>, or --full for full source.`;
}

function formatContextStatsFooter(
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

function formatSingleOutlineStatsFooter(
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

function shouldEnforceDefaultReadBudget(
  options: ReadOptions,
  normalizedItems?: NormalizedReadTarget[],
): boolean {
  if (options.full === true) return false;
  if (options.maxTokens !== undefined) return false;
  if (options.json === true) return false;
  if (
    normalizedItems &&
    normalizedItems.length > 0 &&
    normalizedItems.every((it) => it.explicitFull)
  ) {
    return false;
  }
  return true;
}

function buildNextSliceHintCommand(
  displayPath: string,
  startLine = 1,
  totalLines?: number,
  windowLines = 150,
): string {
  const safePath = displayPath.trim() || ".";
  const sLine = Math.max(1, startLine);
  const rawEnd = sLine + windowLines - 1;
  const eLine =
    totalLines !== undefined && totalLines >= sLine ? Math.min(totalLines, rawEnd) : rawEnd;
  return `aice read ${safePath}:L${sLine}-L${eLine}`;
}

function inferNextWindowFromTruncatedSlice(
  emittedSlice: string,
  fallbackTargetPath: string,
  totalLines?: number,
): string {
  const lines = emittedSlice.split("\n");
  let lastFileHeader = fallbackTargetPath.split(",")[0]?.trim() || ".";
  let lastLineNum = 0;
  for (const ln of lines) {
    const hdrMatch = ln.match(/^\/\/ === ([^=(]+?)(?:\s+\(| ===)/);
    if (hdrMatch?.[1]) {
      lastFileHeader = hdrMatch[1].trim();
      lastLineNum = 0;
      continue;
    }
    const mdTargetMatch = ln.match(/^### (?:Target: )?`?([^`\s[]+)`?/);
    if (mdTargetMatch?.[1]) {
      lastFileHeader = mdTargetMatch[1].trim();
      lastLineNum = 0;
      continue;
    }
    const numMatch = ln.match(/^\s*(?:L(\d+):|(\d+)│)/);
    if (numMatch) {
      const parsedNum = Number.parseInt(numMatch[1] ?? numMatch[2] ?? "0", 10);
      if (parsedNum > 0) {
        lastLineNum = parsedNum;
      }
    }
  }
  const nextStart = lastLineNum > 0 ? lastLineNum + 1 : 1;
  return buildNextSliceHintCommand(lastFileHeader, nextStart, totalLines, 150);
}

/**
 * Guarantees rendered `formattedBundle` (plus optional `statsText`) stays strictly within
 * `DEFAULT_READ_MAX_BYTES` (28,672 bytes) and `DEFAULT_READ_MAX_TOKENS` (~7,000 BPE tokens),
 * appending an exact `aice read <file>:L<start>-L<end>` pagination hint whenever capped.
 */
function enforceReadBudgetCeiling(params: {
  bundle: string;
  fallbackTargetPath: string;
  statsText?: string;
  totalLines?: number;
  extraHints?: string[];
}): { formattedBundle: string; output: string; tokenCount: number; wasCapped: boolean } {
  const { bundle, fallbackTargetPath, statsText, totalLines, extraHints } = params;
  const statsAllowanceBytes = statsText ? Buffer.byteLength(`\n\n${statsText}`, "utf-8") : 0;
  const maxBundleBytes = Math.max(1024, DEFAULT_READ_MAX_BYTES - statsAllowanceBytes);
  const initialBytes = Buffer.byteLength(bundle, "utf-8");
  const initialTokens = estimateTokens(bundle);

  if (initialBytes <= maxBundleBytes && initialTokens <= DEFAULT_READ_MAX_TOKENS) {
    const out = statsText ? `${bundle}\n\n${statsText}` : bundle;
    if (Buffer.byteLength(out, "utf-8") <= DEFAULT_READ_MAX_BYTES) {
      return {
        formattedBundle: bundle,
        output: out,
        tokenCount: initialTokens,
        wasCapped: false,
      };
    }
  }

  const lines = bundle.split("\n");
  const targetKeepBytes = Math.max(512, maxBundleBytes - 360);
  const targetKeepTokens = Math.max(128, DEFAULT_READ_MAX_TOKENS - 110);

  const keptLines: string[] = [];
  let runningBytes = 0;
  let nextOmittedFile: string | undefined;
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i]!;
    const lnBytes = Buffer.byteLength(ln, "utf-8") + (keptLines.length > 0 ? 1 : 0);
    if (runningBytes + lnBytes > targetKeepBytes) {
      for (let j = i; j < lines.length; j++) {
        const hdr = lines[j]?.match(/^\/\/ === ([^=(]+?)(?:\s+\(| ===)/);
        if (hdr?.[1]) {
          nextOmittedFile = hdr[1].trim();
          break;
        }
      }
      break;
    }
    keptLines.push(ln);
    runningBytes += lnBytes;
  }

  let keptText = keptLines.join("\n");
  while (keptLines.length > 1 && estimateTokens(keptText) > targetKeepTokens) {
    const dropCount = Math.max(1, Math.floor(keptLines.length * 0.15));
    keptLines.splice(keptLines.length - dropCount, dropCount);
    keptText = keptLines.join("\n");
  }

  const primaryHint =
    extraHints && extraHints.length > 0
      ? extraHints.slice(0, 3).join(" | ")
      : nextOmittedFile
        ? buildNextSliceHintCommand(nextOmittedFile, 1, undefined, 150)
        : inferNextWindowFromTruncatedSlice(keptText, fallbackTargetPath, totalLines);

  const footer = `\n\n// [28 KB stdout budget reached — next slice: ${primaryHint} (or pass --full)]`;
  while (
    keptText.length > 0 &&
    (Buffer.byteLength(`${keptText}${footer}`, "utf-8") > maxBundleBytes ||
      estimateTokens(`${keptText}${footer}`) > DEFAULT_READ_MAX_TOKENS)
  ) {
    const nlIdx = keptText.lastIndexOf("\n");
    keptText =
      nlIdx > 0 ? keptText.slice(0, nlIdx) : keptText.slice(0, Math.floor(keptText.length * 0.8));
  }

  const cappedBundle = keptText ? `${keptText}${footer}` : footer.trimStart();
  const cappedTokens = estimateTokens(cappedBundle);
  const finalOut = statsText ? `${cappedBundle}\n\n${statsText}` : cappedBundle;
  return {
    formattedBundle: cappedBundle,
    output: finalOut,
    tokenCount: cappedTokens,
    wasCapped: true,
  };
}

function formatAggregateOutlineStatsFooter(
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

interface ClassifiedReadTarget {
  norm: NormalizedReadTarget;
  resolved: ResolvedPathTargets;
  diskPath: string;
  displayPath: string;
  isDir: boolean;
  route: Exclude<ReadRouteMode, "mixed" | "workspace">;
  effectiveSelector?: string;
  usesSharedSymbol: boolean;
  preReadSource?: string;
  lineCount?: number;
}

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
  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const normalizedItems = normalizeReadTargets(targets, baseDir);

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
    const effectiveIdioms = isProjectIdiomsEnabled(resolvedWs.config, options.idioms);
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
    const ctxRes = await withSuppressedTelemetryAsync(() =>
      generateContext(undefined, {
        depth: options.depth,
        symbol: sharedSymTrimmed,
        idioms: effectiveIdioms,
        includeDeps: options.includeDeps,
        includeCallers: options.includeCallers,
        outlineTarget: Boolean(options.outlineTarget),
        maxTokens: options.maxTokens,
        json: Boolean(options.json),
        stats: Boolean(options.stats),
        projectRoot,
        workspaceScanCache: options.workspaceScanCache,
      }),
    );

    const nativeFiles = resolvedWs.files;
    let nativeText = "";
    try {
      const wsEntries = nativeFiles
        .slice(0, 60)
        .filter((fp) => fs.existsSync(fp))
        .map((fp) => ({
          relPath: formatReadDisplayPath(fp, projectRoot),
          rawSource: fs.readFileSync(fp, "utf-8"),
        }));
      nativeText = computeHonestReadBaselineText({
        workspaceFiles: wsEntries,
        symbolSelector:
          sharedSymTrimmed && isPureRegexSelector(sharedSymTrimmed) ? sharedSymTrimmed : undefined,
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

    if (shouldEnforceDefaultReadBudget(options)) {
      const firstNextFile =
        nativeFiles.length > 0 ? formatReadDisplayPath(nativeFiles[0]!, projectRoot) : ".";
      const capped = enforceReadBudgetCeiling({
        bundle: wsFormattedBundle,
        fallbackTargetPath: firstNextFile,
        statsText,
      });
      wsFormattedBundle = capped.formattedBundle;
      output = capped.output;
      tokenCount = capped.tokenCount;
    }

    recordTelemetryEvent({
      targetPath: resolvedWs.resolvedPath,
      projectRoot,
      operation: "context",
      surface,
      idiomsUsed: Boolean(ctxRes.idioms && Object.keys(ctxRes.idioms).length > 0),
      nativeText,
      realisticNativeText: nativeText,
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
  const threshold = options.autoOutlineLineThreshold ?? DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD;
  const sharedSymbolRaw = options.symbol?.trim() || undefined;
  const sharedSymIsOutline = sharedSymbolRaw?.toLowerCase() === "outline";

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
    const effectiveSelector = isExplicitOutline
      ? undefined
      : (norm.selector ?? (sharedSymIsOutline ? undefined : sharedSymbolRaw));
    const usesSharedSymbol = !isExplicitOutline && !norm.selector && Boolean(effectiveSelector);
    const effectiveFull = Boolean(options.full) || norm.explicitFull;

    let route: ClassifiedReadTarget["route"];
    let preReadSource: string | undefined;
    let lineCount: number | undefined;

    if (isExplicitOutline) {
      route = "outline";
    } else if (isDir) {
      if (!effectiveSelector && options.autoOutlineDirectories !== false) {
        route = "auto-outline-dir";
      } else {
        route = isPureRegexSelector(effectiveSelector) ? "search" : "context";
      }
    } else if (effectiveSelector) {
      route = isPureRegexSelector(effectiveSelector) ? "search" : "context";
    } else {
      const ext = path.extname(diskPath).toLowerCase();
      const isOutlinableFile = KNOWN_TARGET_EXTENSIONS.has(ext) || diskPath.endsWith(".aice");
      if (
        isOutlinableFile &&
        !effectiveFull &&
        options.outlineTarget !== true &&
        options.autoOutlineBareFiles !== false
      ) {
        preReadSource = fs.readFileSync(diskPath, "utf-8");
        lineCount = countSourceLines(preReadSource);
        if (lineCount > threshold) {
          route = "auto-outline-file";
        } else {
          route = "context";
          sharedScanCache.fileContentByPath.set(diskPath, preReadSource);
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
    });
  }

  if (classified.length === 0) {
    throw new Error(`Path not found: ${missingTargets.join(", ")}`);
  }

  const outlineItems = classified.filter(
    (c) =>
      c.route === "outline" || c.route === "auto-outline-dir" || c.route === "auto-outline-file",
  );
  const contextItems = classified.filter((c) => c.route === "context" || c.route === "search");
  const primaryProjectRoot = classified[0]?.resolved.projectRoot ?? baseDir;

  // 3A. Pure Outline Stream (single file, auto-outlined >250-line file, single dir, or multi-dir/multi-file)
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

  // 3C. Mixed Context + Outline Stream (e.g. `["src/a.ts:fnA", "src/b.ts:L10-L40", "src/rules"]`)
  const ctxPart = await withSuppressedTelemetryAsync(() =>
    executeContextStream({
      contextItems,
      missingTargets: [],
      isMultiInput: true,
      sharedScanCache,
      options: { ...options, maxTokens: undefined, json: false, stats: false },
      surface,
    }),
  );

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
        compact: options.compact,
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
      options: { ...options, maxTokens: undefined },
      surface,
      skipTelemetry: true,
    }),
  );

  const outlineSectionBody =
    outlineItems.length === 1 && !outlineItems[0]?.isDir && outlineItems[0]
      ? `// === ${outlineItems[0].displayPath} ===\n${outlinePart.formattedBundle}`
      : outlinePart.formattedBundle;

  let combinedBundle = `${ctxPart.formattedBundle}\n\n## Outlined Targets:\n\`\`\`aice\n${outlineSectionBody}\n\`\`\``;
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
      fallbackTargetPath: classified[0]?.displayPath ?? ".",
      statsText,
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
    recordTelemetryEvent({
      targetPath: firstClassified.diskPath,
      projectRoot: primaryProjectRoot,
      filePath: "<multi-context>",
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

  const autoOutlineByAbsPath = new Map<string, { lineCount: number; displayPath: string }>();
  for (const c of classified) {
    if (c.route === "auto-outline-file" && c.lineCount !== undefined) {
      autoOutlineByAbsPath.set(path.resolve(c.diskPath), {
        lineCount: c.lineCount,
        displayPath: c.displayPath,
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

  if (outlineRes instanceof Map) {
    fileCount = outlineRes.size;
    const textBlocks: string[] = [];
    const outlineDisplayKeys: string[] = [];
    const jsonItems: unknown[] = [];

    for (const [rawKey, itemRes] of outlineRes.entries()) {
      const displayKey = options.projectRoot
        ? formatReadDisplayPath(itemRes.file, projectRoot, rawKey)
        : rawKey;
      const autoMeta = autoOutlineByAbsPath.get(path.resolve(itemRes.file));
      const headerLine = autoMeta
        ? `${buildAutoOutlineHeader(displayKey, autoMeta.lineCount)}\n`
        : "";
      outlineDisplayKeys.push(displayKey);
      textBlocks.push(`// === ${displayKey} ===\n${headerLine}${itemRes.text}`);

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
      rawBundle = `// === ${emptyLabel} ===\n// (no supported target files)`;
    } else if (enforceOutlineBudget) {
      const keptOutlineBlocks: string[] = [];
      const omittedDisplayPaths: string[] = [];
      let runningBytes = 0;
      const budgetThresholdBytes = DEFAULT_READ_MAX_BYTES - 512;
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
        const hintCmds = omittedDisplayPaths
          .slice(0, 3)
          .map((p) => buildNextSliceHintCommand(p, 1, undefined, 150))
          .join(" | ");
        keptOutlineBlocks.push(
          `// ... (+${omittedDisplayPaths.length} more target files omitted to fit 28 KB stdout budget)\n// Next slices: ${hintCmds} (or pass --full)`,
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
        ? { lineCount: singleTarget.lineCount, displayPath }
        : undefined;

    if (autoMeta) {
      const autoHeader = buildAutoOutlineHeader(autoMeta.displayPath, autoMeta.lineCount);
      rawBundle = outlineRes.text ? `${autoHeader}\n${outlineRes.text}` : autoHeader;
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
    const firstFallback = classified[0]?.displayPath ?? ".";
    const cappedOutline = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: firstFallback,
      statsText,
      totalLines: classified.length === 1 ? classified[0]?.lineCount : undefined,
    });
    formattedBundle = cappedOutline.formattedBundle;
    output = cappedOutline.output;
    tokenCount = cappedOutline.tokenCount;
  }

  if (!skipTelemetry && classified[0]) {
    const nativeJoined = nativeParts.join("\n\n");
    const nativeCl100k =
      totalOrigTokens > 0
        ? totalOrigTokens
        : nativeJoined
          ? estimateTokens(nativeJoined, "cl100k_base")
          : 0;
    const aicePayload = jsonOutput ?? formattedBundle;
    const aiceCl100k = jsonOutput !== undefined ? estimateTokens(jsonOutput) : tokenCount;
    const structuralCompressionPct =
      nativeCl100k > 0 ? Math.round(((nativeCl100k - aiceCl100k) / nativeCl100k) * 100) : 0;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot,
      operation: "outline",
      surface,
      idiomsUsed: anyIdiomsUsed,
      nativeText: nativeJoined,
      nativeCl100k,
      aiceCl100k,
      realisticNativeText: nativeJoined,
      realisticNativeCl100k: nativeCl100k,
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

  const results: ContextResult[] = [];
  const matchedTargets: ClassifiedReadTarget[] = [];
  const sharedSymbolResultIndices: number[] = [];
  const multiTargetErrors: unknown[] = [];

  let firstResolvedPath = "";
  let firstProjectRoot = process.cwd();
  let totalNativeChars = 0;
  let totalNativeCl100k = 0;
  let totalNativeO200k = 0;
  let resolvedNativeTargetCount = 0;

  for (const item of contextItems) {
    const contextOpts: ContextOptions = {
      depth: options.depth,
      symbol: item.effectiveSelector,
      allowPartialSymbolMatch: options.allowPartialSymbolMatch ?? (isMultiInput ? true : undefined),
      idioms: options.idioms,
      includeDeps: options.includeDeps,
      includeCallers: options.includeCallers,
      zeroEnvelopeBareSmallFiles: true,
      outlineTarget: Boolean(options.outlineTarget),
      maxTokens: isMultiInput ? undefined : options.maxTokens,
      json: Boolean(options.json),
      stats: Boolean(options.stats),
      projectRoot: item.resolved.projectRoot,
      workspaceScanCache: sharedScanCache,
    };

    let targetMatched = false;
    try {
      const res = await withSuppressedTelemetryAsync(() =>
        generateContext(item.resolved.resolvedPath, contextOpts),
      );
      results.push(res);
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
            subsetResults.push(
              await withSuppressedTelemetryAsync(() =>
                generateContext(item.resolved.resolvedPath, subOpts),
              ),
            );
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
          const baselineSlice = computeHonestReadBaselineText({
            rawSource: rawText,
            relPath: item.displayPath,
            symbolSelector: item.effectiveSelector,
          });
          totalNativeChars +=
            baselineSlice.length +
            (resolvedNativeTargetCount > 0 && baselineSlice.length > 0 ? 2 : 0);
          totalNativeCl100k += estimateTokens(baselineSlice, "cl100k_base");
          totalNativeO200k += estimateTokens(baselineSlice, "o200k_base");
          resolvedNativeTargetCount++;
        } else if (item.isDir && fs.existsSync(item.diskPath)) {
          const dirFiles =
            sharedScanCache.filesByRoot.get(item.diskPath) ?? item.resolved.files.slice(0, 60);
          const dirEntries: Array<{ relPath: string; rawSource: string }> = [];
          for (const df of dirFiles) {
            if (!fs.existsSync(df)) continue;
            const rawText =
              sharedScanCache.fileContentByPath.get(df) ?? fs.readFileSync(df, "utf-8");
            dirEntries.push({
              relPath: formatReadDisplayPath(df, item.resolved.projectRoot),
              rawSource: rawText,
            });
          }
          const dirBaseline = computeHonestReadBaselineText({
            workspaceFiles: dirEntries,
            symbolSelector: item.effectiveSelector,
          });
          totalNativeChars +=
            dirBaseline.length + (resolvedNativeTargetCount > 0 && dirBaseline.length > 0 ? 2 : 0);
          totalNativeCl100k += estimateTokens(dirBaseline, "cl100k_base");
          totalNativeO200k += estimateTokens(dirBaseline, "o200k_base");
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
      includeDeps: options.includeDeps,
      includeCallers: options.includeCallers,
      depth: options.depth,
    });
    let formattedBundle = merged.formattedBundle;
    const paginationHints: string[] = [];

    // Auto-downgrade heavy overflow targets to `:outline` + exact `Lstart-Lend` hints when > 28 KB
    if (
      enforceStreamBudget &&
      (Buffer.byteLength(formattedBundle, "utf-8") > DEFAULT_READ_MAX_BYTES ||
        (merged.tokenCount ?? estimateTokens(formattedBundle)) > DEFAULT_READ_MAX_TOKENS)
    ) {
      const keptContextResults: ContextResult[] = [];
      const downgradedBlocks: string[] = [];
      let cumulativeBytes = 0;
      let cumulativeTokens = 0;
      const softByteCap = DEFAULT_READ_MAX_BYTES - 2048;
      const softTokenCap = DEFAULT_READ_MAX_TOKENS - 500;

      for (let i = 0; i < results.length; i++) {
        const resItem = results[i]!;
        const targetMeta = matchedTargets[i]!;
        const itemBytes = Buffer.byteLength(resItem.formattedBundle, "utf-8");
        const itemToks = resItem.tokenCount ?? estimateTokens(resItem.formattedBundle);
        const fitsInFull =
          downgradedBlocks.length === 0 &&
          cumulativeBytes + itemBytes <= softByteCap &&
          cumulativeTokens + itemToks <= softTokenCap;

        if (fitsInFull) {
          keptContextResults.push(resItem);
          cumulativeBytes += itemBytes + 2;
          cumulativeTokens += itemToks;
          continue;
        }

        let startHintLine = 1;
        if (
          targetMeta.effectiveSelector &&
          LINE_RANGE_SELECTOR_RE.test(targetMeta.effectiveSelector)
        ) {
          const rm = targetMeta.effectiveSelector.match(/L(\d+)/i);
          if (rm?.[1]) {
            startHintLine = Math.max(1, Number.parseInt(rm[1], 10));
          }
        }
        const totalTargetLines =
          targetMeta.lineCount ??
          (targetMeta.preReadSource ? countSourceLines(targetMeta.preReadSource) : undefined);
        const nextCmd = buildNextSliceHintCommand(
          targetMeta.displayPath,
          startHintLine,
          totalTargetLines,
          150,
        );
        paginationHints.push(nextCmd);
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
              }),
            );
            const singleOutline =
              oRes instanceof Map ? (Array.from(oRes.values())[0]?.text ?? "") : oRes.text;
            downgradedBlocks.push(
              `// === ${targetMeta.displayPath} (auto-downgraded to :outline — 28 KB budget; next slice: ${nextCmd}) ===\n${singleOutline}`,
            );
          } else {
            downgradedBlocks.push(
              `// === ${targetMeta.displayPath} (omitted — 28 KB budget; next slice: ${nextCmd}) ===`,
            );
          }
        } catch {
          downgradedBlocks.push(
            `// === ${targetMeta.displayPath} (omitted — 28 KB budget; next slice: ${nextCmd}) ===`,
          );
        }
      }

      const partsAfterDowngrade: string[] = [];
      if (keptContextResults.length > 0) {
        merged = mergeMultiContextResults(keptContextResults, {
          outlineTarget: Boolean(options.outlineTarget),
          includeDeps: options.includeDeps,
          includeCallers: options.includeCallers,
          depth: options.depth,
        });
        partsAfterDowngrade.push(merged.formattedBundle);
      }
      if (downgradedBlocks.length > 0) {
        partsAfterDowngrade.push(downgradedBlocks.join("\n\n"));
      }
      if (paginationHints.length > 0) {
        partsAfterDowngrade.push(
          `// Pagination hints (28 KB stdout ceiling; pass --full to override):\n${paginationHints.map((cmd) => `//   ${cmd}`).join("\n")}`,
        );
      }
      formattedBundle = partsAfterDowngrade.join("\n\n");
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
        fallbackTargetPath: matchedTargets[0]?.displayPath ?? ".",
        statsText,
        extraHints: paginationHints,
      });
      formattedBundle = cappedMulti.formattedBundle;
      output = cappedMulti.output;
      tokenCount = cappedMulti.tokenCount;
    }

    if (firstResolvedPath) {
      const aicePayload = jsonOutput ?? formattedBundle;
      recordTelemetryEvent({
        targetPath: firstResolvedPath,
        projectRoot: firstProjectRoot,
        filePath: "<multi-context>",
        operation: "context",
        surface,
        idiomsUsed: Boolean(merged.idioms && Object.keys(merged.idioms).length > 0),
        nativeText: "",
        nativeChars: totalNativeChars,
        nativeCl100k: totalNativeCl100k,
        nativeO200k: totalNativeO200k,
        realisticNativeCl100k: totalNativeCl100k,
        aiceText: aicePayload,
        aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
      });
    }

    const stats: ReadStats = {
      tokenCount,
      ...(resolvedNativeTargetCount > 0
        ? {
            originalTokens: totalNativeCl100k,
            savedTokens: totalNativeCl100k - tokenCount,
            savingsPct:
              totalNativeCl100k > 0
                ? Math.round(((totalNativeCl100k - tokenCount) / totalNativeCl100k) * 100)
                : 0,
            originalChars: totalNativeChars,
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
    const singleTotalLines =
      singleMatched?.lineCount ??
      (singleMatched?.preReadSource ? countSourceLines(singleMatched.preReadSource) : undefined);
    const cappedSingle = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: singleMatched?.displayPath ?? singleResult.targetPath,
      statsText,
      totalLines: singleTotalLines,
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
      nativeText: "",
      nativeChars: totalNativeChars,
      nativeCl100k: totalNativeCl100k,
      nativeO200k: totalNativeO200k,
      realisticNativeCl100k: totalNativeCl100k,
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  const stats: ReadStats = {
    tokenCount,
    ...(resolvedNativeTargetCount > 0
      ? {
          originalTokens: totalNativeCl100k,
          savedTokens: totalNativeCl100k - tokenCount,
          savingsPct:
            totalNativeCl100k > 0
              ? Math.round(((totalNativeCl100k - tokenCount) / totalNativeCl100k) * 100)
              : 0,
          originalChars: totalNativeChars,
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
