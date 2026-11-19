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
import { getCachedTsSymbolIndex } from "../compat/typescript.js";
import {
  AICE_DISABLED_MESSAGE,
  DEFAULT_IGNORED_SCAN_DIRECTORIES,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  PASSTHROUGH_FILENAMES,
  type ProjectIdiomDefinition,
  type ResolvedPathTargets,
  resolvePathTargets,
} from "../config/index.js";
import {
  recordTelemetryEvent,
  withSuppressedTelemetry,
  withSuppressedTelemetryAsync,
} from "../telemetry/index.js";
import { estimateTokens } from "../tokenomics/index.js";
import {
  type CallerSummary,
  type ContextOptions,
  type ContextResult,
  computeHonestReadBaselineText,
  type DependencyContract,
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  generateContext,
  type HonestBaselineFileEntry,
  isCommentLine,
  isDecorativeDividerComment,
  isTestOrMockPath,
  mergeMultiContextResults,
  normalizeGrepBreAlternation,
  parseSymbolPatternSelector,
  type WorkspaceCallerScanCache,
} from "./context.js";
import {
  BINARY_SKIP_EXTENSIONS,
  EXTENDED_READ_EXTENSIONS,
  EXTENDED_READ_FILENAMES,
  generateOutline,
  isSupportedReadDiskFile,
  LOCKFILE_SKIP_NAMES,
  type OutlineOptions,
  type OutlineResult,
  type OutlineSymbol,
  outlinePath,
} from "./outline.js";
import { didYouMeanFile } from "./suggest.js";

export const DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD = 120;
export const DEFAULT_READ_MAX_BYTES = 28 * 1024; // 28,672 bytes (~7,000 BPE tokens)
export const DEFAULT_READ_MAX_TOKENS = 7_000;
export const DEFAULT_READ_SOFT_BYTE_CAP = 26_624;
export const DEFAULT_READ_SOFT_TOKEN_CAP = 6_500;
export const DEFAULT_SLICE_BYTE_BUDGET = 18_432;

export const DEFAULT_CLI_READ_MAX_BYTES = 9_216; // 9.0 KB (strictly below host 9,892-byte middle-truncation ceiling)
export const DEFAULT_CLI_READ_SOFT_BYTE_CAP = 8_704; // 8.5 KB
export const DEFAULT_CLI_SLICE_BYTE_BUDGET = 6_912; // 6.75 KB (~100-135 AST-snapped lines)
export const DEFAULT_CLI_READ_MAX_TOKENS = 5_000;
export const DEFAULT_CLI_READ_SOFT_TOKEN_CAP = 4_600;

export interface EffectiveReadBudgets {
  maxBytes: number;
  softByteCap: number;
  sliceByteBudget: number;
  maxTokens: number;
  softTokenCap: number;
  budgetLabel: string;
}

export function resolveEffectiveReadBudgets(options?: ReadOptions): EffectiveReadBudgets {
  if (
    (options?.surface === "cli" || options?.surface === "mcp") &&
    options.maxTokens === undefined &&
    !options.unboundedCli
  ) {
    const maxBytes =
      options.maxBytes !== undefined
        ? Math.max(512, Math.min(DEFAULT_CLI_READ_MAX_BYTES, options.maxBytes))
        : DEFAULT_CLI_READ_MAX_BYTES;
    const softByteCap = Math.min(DEFAULT_CLI_READ_SOFT_BYTE_CAP, Math.max(400, maxBytes - 512));
    const sliceByteBudget = Math.min(
      DEFAULT_CLI_SLICE_BYTE_BUDGET,
      Math.max(400, maxBytes - 2_304),
    );
    return {
      maxBytes,
      softByteCap,
      sliceByteBudget,
      maxTokens: DEFAULT_CLI_READ_MAX_TOKENS,
      softTokenCap: DEFAULT_CLI_READ_SOFT_TOKEN_CAP,
      budgetLabel: options.surface === "mcp" ? "9 KB MCP" : "9 KB CLI",
    };
  }
  if (options?.maxBytes !== undefined) {
    const maxBytes = Math.max(512, options.maxBytes);
    const softByteCap = Math.min(DEFAULT_READ_SOFT_BYTE_CAP, Math.max(400, maxBytes - 1_024));
    const sliceByteBudget = Math.min(DEFAULT_SLICE_BYTE_BUDGET, Math.max(400, maxBytes - 2_048));
    return {
      maxBytes,
      softByteCap,
      sliceByteBudget,
      maxTokens: DEFAULT_READ_MAX_TOKENS,
      softTokenCap: DEFAULT_READ_SOFT_TOKEN_CAP,
      budgetLabel: "28 KB",
    };
  }
  return {
    maxBytes: DEFAULT_READ_MAX_BYTES,
    softByteCap: DEFAULT_READ_SOFT_BYTE_CAP,
    sliceByteBudget: DEFAULT_SLICE_BYTE_BUDGET,
    maxTokens: DEFAULT_READ_MAX_TOKENS,
    softTokenCap: DEFAULT_READ_SOFT_TOKEN_CAP,
    budgetLabel: "28 KB",
  };
}

const SINGLE_REGEX_LITERAL_RE = /^\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+\/[gimsuy]*$/;
const LINE_RANGE_SELECTOR_RE = /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i;

export type ReadRouteMode =
  | "outline"
  | "auto-outline-dir"
  | "auto-outline-file"
  | "context"
  | "search"
  | "files"
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
   * Bypass >120-line bare-file auto-outline and emit full context pack.
   */
  full?: boolean;
  /**
   * Line threshold above which bare files without a selector are automatically outlined (default: 120).
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
   * Dependency traversal depth (for context), maximum symbol nesting depth (for outline), or directory depth (for find).
   */
  depth?: number;
  /**
  /**
   * Explicit directory traversal depth cap for `filesOnly` / `aice find` (`-d`, `--depth`, `--max-depth`, `-L`).
   */
  maxDepth?: number;
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
  /**
   * Emit exact 1-based disk-numbered native source lines by default (`true` in `read()`, `false` in direct `generateContext()`).
   */
  rawNative?: boolean;
  /**
   * Opt-in AICE shorthand decompilation (`--dsl`); when `true`, sets `rawNative = false`.
   */
  dsl?: boolean;
  /**
   * Explicit context radius override (`-C` / `--context <lines>`) for pattern searches.
   */
  contextLines?: number;
  /**
   * Plain regex OR literal search pattern (auto-escapes invalid regex fallback to literal match).
   * When `filesOnly: true` and `filePattern` is omitted, also acts as the optional path filter.
   */
  search?: string;
  /**
   * Fast zero-AST workspace file discovery (`--files` / `aice find` / MCP `filesOnly`).
   */
  filesOnly?: boolean;
  /**
   * Optional glob or substring path filter for `filesOnly`.
   */
  filePattern?: string;
  /**
   * Emit matching relative file paths concisely (`-l` / `--files-with-matches`).
   */
  filesWithMatches?: boolean;
  /**
   * Optional ceiling override in raw bytes (clamped to surface defaults).
   */
  maxBytes?: number;
  /**
   * Internal/interactive CLI flag: bypass 9 KB CLI stdout ceiling when run interactively by a human with --full.
   */
  unboundedCli?: boolean;
  /**
   * Internal flag: bypass intermediate budget capping during multi-stage stream composition.
   */
  _bypassInternalCap?: boolean;
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
        EXTENDED_READ_EXTENSIONS.has(ext) ||
        PASSTHROUGH_FILENAMES.has(baseName) ||
        EXTENDED_READ_FILENAMES.has(baseName) ||
        ext === ".aice" ||
        baseName.startsWith(".env.");
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
    const tokExt = path.extname(tokParsed.targetPath).toLowerCase();
    const tokLooksStandalone =
      tokParsed.explicitOutline ||
      Boolean(tokParsed.inlineSelector) ||
      targetExistsAtBase(tokParsed.targetPath, baseDir) ||
      EXTENDED_READ_EXTENSIONS.has(tokExt) ||
      EXTENDED_READ_FILENAMES.has(path.basename(tokParsed.targetPath)) ||
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
    const ext = path.extname(candFile).toLowerCase();
    const baseName = path.basename(candFile);
    if (
      candFile.includes("/") ||
      candFile.includes("\\") ||
      EXTENDED_READ_EXTENSIONS.has(ext) ||
      EXTENDED_READ_FILENAMES.has(baseName) ||
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

function resolveEffectiveReadRawNative(options: ReadOptions): boolean {
  if (options.dsl === true) return false;
  if (options.rawNative !== undefined) return options.rawNative;
  if (options.idioms === true) return false;
  return true;
}

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
    const ext = path.extname(diskPath).toLowerCase();
    if (
      EXTENDED_READ_EXTENSIONS.has(ext) ||
      EXTENDED_READ_FILENAMES.has(path.basename(diskPath)) ||
      diskPath.endsWith(".aice")
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

function splitPathAndSelector(raw: string): { filePath: string; selector?: string } {
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

function parseSelectorLineRange(
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

function extractRepresentativeSymbolHints(opts: {
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
      const cand = opts.projectRoot
        ? path.resolve(opts.projectRoot, cleanDisp)
        : path.isAbsolute(cleanDisp)
          ? cleanDisp
          : undefined;
      if (cand && fs.existsSync(cand)) {
        try {
          if (fs.statSync(cand).isFile()) {
            resolvedDiskPath = cand;
          }
        } catch {
          // ignore stat errors
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
          pushUnique(secondary, symName);
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

  if (chosen.length === 0) {
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
      const declRe =
        /(?:^|\n)[ \t]*(?:export\s+)?(?:pub\s+)?(?:async\s+)?(?:function|fn|def|class|struct)\s+([A-Za-z_$][A-Za-z0-9_$]{3,})\b/g;
      for (const m of rawSource.matchAll(declRe)) {
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

function formatBatchSymbolsOrSearchHint(displayPath: string, symbolNames: string[]): string {
  const safePath = splitPathAndSelector(displayPath).filePath.trim() || ".";
  if (symbolNames.length >= 2) {
    return `batch symbols: aice read ${safePath}:${symbolNames[0]} ${safePath}:${symbolNames[1]} or aice search <pat> ${safePath}`;
  }
  if (symbolNames.length === 1) {
    return `batch symbols: aice read ${safePath}:${symbolNames[0]} or aice search <pat> ${safePath}`;
  }
  return `narrow with aice search <pat> ${safePath}`;
}

function compactAutoOutlineBlock(
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

function buildAutoOutlineHeader(
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

function buildAntiPaginationHintForTarget(
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
  if (EXTENDED_READ_FILENAMES.has(base) || PASSTHROUGH_FILENAMES.has(base)) {
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

function closeUnclosedMarkdownFence(text: string): string {
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
function enforceReadBudgetCeiling(params: {
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

function hasUnsafeSearchQuantifiers(pattern: string): boolean {
  if (pattern.length > 512) return true;
  if (/(\.\*){4,}/.test(pattern)) return true;
  return /\([^()]*[+*][^()]*\)\s*[+*?{]/.test(pattern);
}

function escapeUnescapedForwardSlashes(pattern: string): string {
  let out = "";
  let inCharClass = false;
  let escaped = false;
  for (const ch of pattern) {
    if (escaped) {
      out += ch;
      escaped = false;
      continue;
    }
    if (ch === "\\") {
      out += ch;
      escaped = true;
      continue;
    }
    if (ch === "[" && !inCharClass) {
      inCharClass = true;
      out += ch;
      continue;
    }
    if (ch === "]" && inCharClass) {
      inCharClass = false;
      out += ch;
      continue;
    }
    if (ch === "/" && !inCharClass) {
      out += "\\/";
      continue;
    }
    if (ch === "\n") {
      out += "\\n";
      continue;
    }
    if (ch === "\r") {
      out += "\\r";
      continue;
    }
    out += ch;
  }
  return out;
}

function escapeLiteralForRegexSelector(literal: string): string {
  return literal
    .replace(/[.*+?^${}()|[\]\\/]/g, "\\$&")
    .replace(/\r/g, "\\r")
    .replace(/\n/g, "\\n");
}

function buildSafeSearchRegexSelector(rawSearch: string): { selector: string; regex: RegExp } {
  const normalizedRaw = normalizeGrepBreAlternation(rawSearch);
  const trimmed = normalizedRaw.trim();
  const slashedMatch = trimmed.match(/^\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+)\/([gimsuy]*)$/);
  if (slashedMatch?.[1]) {
    const rawBody = normalizeGrepBreAlternation(slashedMatch[1]);
    const cleanFlags = (slashedMatch[2] ?? "").replace(/[gy]/g, "");
    if (!hasUnsafeSearchQuantifiers(rawBody)) {
      try {
        const regex = new RegExp(rawBody, cleanFlags);
        return { selector: `/${rawBody}/${cleanFlags}`, regex };
      } catch {
        // fall through to literal fallback
      }
    }
  }

  if (normalizedRaw.length > 0 && !hasUnsafeSearchQuantifiers(normalizedRaw)) {
    try {
      const escapedSlashBody = escapeUnescapedForwardSlashes(normalizedRaw);
      const regex = new RegExp(escapedSlashBody);
      const candidateSelector = `/${escapedSlashBody}/`;
      if (SINGLE_REGEX_LITERAL_RE.test(candidateSelector)) {
        return { selector: candidateSelector, regex };
      }
    } catch {
      // Invalid regex (e.g. "foo(bar" or "[unclosed") -> auto-escape literal fallback
    }
  }

  const literalBody = escapeLiteralForRegexSelector(rawSearch || "^$");
  return {
    selector: `/${literalBody}/`,
    regex: new RegExp(literalBody),
  };
}

const BINARY_DISCOVERY_EXTENSIONS = new Set([
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".xz",
  ".7z",
  ".wasm",
  ".pyc",
  ".class",
  ".jar",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".a",
  ".mp3",
  ".mp4",
  ".wav",
  ".ogg",
  ".webm",
  ".sqlite",
  ".db",
]);

function countBufferLinesFast(buf: Buffer): number {
  const len = buf.length;
  if (len === 0) return 0;
  const end =
    len >= 2 && buf[len - 2] === 13 && buf[len - 1] === 10
      ? len - 2
      : buf[len - 1] === 10
        ? len - 1
        : len;
  if (end <= 0) return 1;
  let lines = 1;
  for (let i = 0; i < end; i++) {
    if (buf[i] === 10) lines++;
  }
  return lines;
}

function isLikelyBinaryBuffer(buf: Buffer): boolean {
  const checkLen = Math.min(buf.length, 512);
  for (let i = 0; i < checkLen; i++) {
    if (buf[i] === 0) return true;
  }
  return false;
}

function buildFilesOnlyFilterMatcher(rawFilter?: string): ((relPath: string) => boolean) | null {
  const trimmed = rawFilter?.trim();
  if (!trimmed) return null;
  const norm = trimmed.replace(/\\/g, "/");
  const clean = norm.startsWith("./") ? norm.slice(2) : norm;

  const slashed = clean.match(/^\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+)\/([gimsuy]*)$/);
  if (slashed?.[1]) {
    try {
      const rx = new RegExp(slashed[1], (slashed[2] ?? "").replace(/[gy]/g, "") || "i");
      return (relPath: string) => rx.test(relPath);
    } catch {
      // fall through
    }
  }

  if (hasGlobMagicChars(clean)) {
    const expanded = expandBracePatterns(clean);
    const hasSlash = clean.includes("/");
    const rxList = expanded.map((pat) => globPatternToRegExp(pat));
    return (relPath: string) => {
      if (rxList.some((rx) => rx.test(relPath))) return true;
      if (!hasSlash) {
        const base = path.posix.basename(relPath);
        return rxList.some((rx) => rx.test(base));
      }
      return false;
    };
  }

  const needle = clean.toLowerCase();
  return (relPath: string) => relPath.toLowerCase().includes(needle);
}

export interface DiscoveredWorkspaceFile {
  path: string;
  lines: number;
  bytes: number;
  sizeKB: number;
}

function executeFilesOnlyRead(
  targets: ReadTargetInput | ReadTargetInput[] | undefined,
  options: ReadOptions,
  baseDir: string,
  surface: "cli" | "mcp",
): ReadResult {
  const resolvedRootInfo = resolvePathTargets(undefined, {
    includeTargets: false,
    projectRoot: options.projectRoot ?? baseDir,
  });
  if (!isProjectAiceEnabled(resolvedRootInfo.config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }
  const projectRoot = resolvedRootInfo.projectRoot;

  const configuredOutDir = resolvedRootInfo.config.outDir
    ? path.resolve(projectRoot, resolvedRootInfo.config.outDir)
    : undefined;

  const rawTokens: string[] = [];
  if (targets !== undefined) {
    const inputList = Array.isArray(targets) ? targets : [targets];
    for (const item of inputList) {
      if (typeof item === "string") {
        for (const tok of splitReadTargetString(item, baseDir)) {
          const parsed = parseReadTarget(tok, baseDir);
          if (parsed.targetPath.trim()) rawTokens.push(parsed.targetPath.trim());
        }
      } else if (item && typeof item === "object" && item.path.trim()) {
        rawTokens.push(item.path.trim());
      }
    }
  }

  const scanRoots: string[] = [];
  const inferredFilters: string[] = [];
  const explicitAllowedDirs = new Set<string>();

  for (const tok of rawTokens) {
    const candidateBase = path.resolve(baseDir, tok);
    const candidateRoot = path.resolve(projectRoot, tok);
    if (fs.existsSync(candidateBase)) {
      scanRoots.push(candidateBase);
      for (const seg of tok.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowedDirs.add(seg);
      }
    } else if (fs.existsSync(candidateRoot)) {
      scanRoots.push(candidateRoot);
      for (const seg of tok.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowedDirs.add(seg);
      }
    } else {
      inferredFilters.push(tok);
    }
  }

  if (scanRoots.length === 0) {
    scanRoots.push(projectRoot);
  }

  const primaryFilter = options.filePattern ?? options.search;
  const activeMatchers: Array<(relPath: string) => boolean> = [];
  const mPrimary = buildFilesOnlyFilterMatcher(primaryFilter);
  if (mPrimary) activeMatchers.push(mPrimary);
  for (const inf of inferredFilters) {
    const mInf = buildFilesOnlyFilterMatcher(inf);
    if (mInf) activeMatchers.push(mInf);
  }

  const rawMaxDepth = options.maxDepth ?? options.depth;
  const effectiveMaxDepth =
    rawMaxDepth !== undefined && Number.isFinite(rawMaxDepth)
      ? Math.max(1, Math.floor(rawMaxDepth))
      : undefined;
  const explicitLockfileRequested = Boolean(
    primaryFilter && Array.from(LOCKFILE_SKIP_NAMES).some((lf) => primaryFilter.includes(lf)),
  );
  const includeDotEntries =
    Boolean(options.full) ||
    Boolean(primaryFilter && /(?:^|[/\\,{])\./.test(primaryFilter)) ||
    inferredFilters.some((f) => /(?:^|[/\\,{])\./.test(f));

  const shouldSkipDiscoverDir = (
    dirName: string,
    childAbs: string,
    rootInNodeModules: boolean,
  ): boolean => {
    if (dirName === ".git") return true;
    if (dirName === "node_modules" && !explicitAllowedDirs.has("node_modules")) return true;
    if (
      DEFAULT_IGNORED_SCAN_DIRECTORIES.has(dirName) &&
      !explicitAllowedDirs.has(dirName) &&
      !(rootInNodeModules && (dirName === "dist" || dirName === "build" || dirName === "out"))
    ) {
      return true;
    }
    if (dirName.startsWith(".") && !includeDotEntries && !explicitAllowedDirs.has(dirName)) {
      return true;
    }
    if (
      configuredOutDir &&
      path.resolve(childAbs) === configuredOutDir &&
      !explicitAllowedDirs.has(dirName)
    ) {
      return true;
    }
    return false;
  };

  const directoryHasVisibleFiles = (dirAbs: string, rootInNodeModules: boolean): boolean => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return false;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isFile()) {
        if (
          ent.name === ".git" ||
          ent.name.endsWith(".trivia.json") ||
          ent.name === "aice.config.json"
        ) {
          continue;
        }
        if (ent.name.startsWith(".") && !includeDotEntries) continue;
        if (!explicitLockfileRequested && LOCKFILE_SKIP_NAMES.has(ent.name)) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (BINARY_DISCOVERY_EXTENSIONS.has(ext) || BINARY_SKIP_EXTENSIONS.has(ext)) continue;
        return true;
      }
      if (ent.isDirectory()) {
        if (shouldSkipDiscoverDir(ent.name, childAbs, rootInNodeModules)) continue;
        if (directoryHasVisibleFiles(childAbs, rootInNodeModules)) return true;
      }
    }
    return false;
  };

  const candidateFiles = new Map<string, string>(); // relPosix -> absPath
  const boundaryDirs = new Set<string>(); // non-empty dirs at effectiveMaxDepth
  const collectFromDir = (
    dirAbs: string,
    currentDepth: number,
    rootInNodeModules: boolean,
  ): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (shouldSkipDiscoverDir(ent.name, childAbs, rootInNodeModules)) {
          continue;
        }
        if (effectiveMaxDepth !== undefined && currentDepth >= effectiveMaxDepth) {
          const relDirPosix = formatReadDisplayPath(childAbs, projectRoot);
          if (
            relDirPosix &&
            relDirPosix !== "." &&
            (activeMatchers.length === 0 ||
              activeMatchers.every(
                (matchFn) => matchFn(relDirPosix) || matchFn(`${relDirPosix}/`),
              )) &&
            directoryHasVisibleFiles(childAbs, rootInNodeModules)
          ) {
            boundaryDirs.add(relDirPosix);
          }
          continue;
        }
        collectFromDir(childAbs, currentDepth + 1, rootInNodeModules);
      } else if (ent.isFile()) {
        if (
          ent.name === ".git" ||
          ent.name.endsWith(".trivia.json") ||
          ent.name === "aice.config.json"
        ) {
          continue;
        }
        if (ent.name.startsWith(".") && !includeDotEntries) continue;
        if (!explicitLockfileRequested && LOCKFILE_SKIP_NAMES.has(ent.name)) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (BINARY_DISCOVERY_EXTENSIONS.has(ext) || BINARY_SKIP_EXTENSIONS.has(ext)) continue;
        const relPosix = formatReadDisplayPath(childAbs, projectRoot);
        if (activeMatchers.length === 0 || activeMatchers.every((matchFn) => matchFn(relPosix))) {
          candidateFiles.set(relPosix, childAbs);
        }
      }
    }
  };

  for (const rootAbs of scanRoots) {
    try {
      const st = fs.statSync(rootAbs);
      if (st.isDirectory()) {
        const inNodeMods = rootAbs.split(path.sep).includes("node_modules");
        collectFromDir(rootAbs, 1, inNodeMods);
      } else if (st.isFile()) {
        const relPosix = formatReadDisplayPath(rootAbs, projectRoot);
        if (activeMatchers.length === 0 || activeMatchers.every((matchFn) => matchFn(relPosix))) {
          candidateFiles.set(relPosix, rootAbs);
        }
      }
    } catch {
      // ignore unreadable path
    }
  }

  const sortedRelPaths = Array.from(candidateFiles.keys()).sort((a, b) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const discovered: DiscoveredWorkspaceFile[] = [];

  for (const relPath of sortedRelPaths) {
    const absPath = candidateFiles.get(relPath)!;
    let buf: Buffer;
    try {
      buf = fs.readFileSync(absPath);
    } catch {
      continue;
    }
    if (isLikelyBinaryBuffer(buf)) continue;
    const lines = countBufferLinesFast(buf);
    const bytes = buf.length;
    const sizeKBNum = bytes === 0 ? 0 : Number(Math.max(0.1, bytes / 1024).toFixed(1));
    discovered.push({
      path: relPath,
      lines,
      bytes,
      sizeKB: sizeKBNum,
    });
  }

  const formatFileEntry = (label: string, lines: number): string =>
    effectiveMaxDepth !== undefined && lines <= 120 ? label : `${label} (${lines}L)`;

  const activeBoundaryDirs = Array.from(boundaryDirs)
    .filter((bd) => !discovered.some((d) => d.path.startsWith(`${bd}/`)))
    .sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));

  const formattedLines: string[] = [];
  if (discovered.length <= 3 && activeBoundaryDirs.length === 0) {
    for (const d of discovered) {
      formattedLines.push(formatFileEntry(d.path, d.lines));
    }
  } else {
    const byDir = new Map<string, DiscoveredWorkspaceFile[]>();
    for (const d of discovered) {
      const slashIdx = d.path.lastIndexOf("/");
      const dirKey = slashIdx >= 0 ? d.path.slice(0, slashIdx) : ".";
      let bucket = byDir.get(dirKey);
      if (!bucket) {
        bucket = [];
        byDir.set(dirKey, bucket);
      }
      bucket.push(d);
    }
    const subdirsByParent = new Map<string, string[]>();
    for (const bd of activeBoundaryDirs) {
      const slashIdx = bd.lastIndexOf("/");
      const parentKey = slashIdx >= 0 ? bd.slice(0, slashIdx) : ".";
      const childName = slashIdx >= 0 ? bd.slice(slashIdx + 1) : bd;
      let list = subdirsByParent.get(parentKey);
      if (!list) {
        list = [];
        subdirsByParent.set(parentKey, list);
      }
      list.push(`${childName}/`);
    }
    const allDirKeys = Array.from(new Set([...byDir.keys(), ...subdirsByParent.keys()])).sort(
      (a, b) => {
        if (a === "." && b !== ".") return -1;
        if (b === "." && a !== ".") return 1;
        return a < b ? -1 : a > b ? 1 : 0;
      },
    );
    for (const dirKey of allDirKeys) {
      const items = byDir.get(dirKey) ?? [];
      const subdirs = subdirsByParent.get(dirKey) ?? [];
      if (dirKey === ".") {
        const rootEntries = [...items.map((it) => formatFileEntry(it.path, it.lines)), ...subdirs];
        if (rootEntries.length >= 2) {
          formattedLines.push(rootEntries.join(", "));
        } else if (rootEntries.length === 1) {
          formattedLines.push(rootEntries[0]!);
        }
      } else {
        if (items.length === 1) {
          formattedLines.push(formatFileEntry(items[0]!.path, items[0]!.lines));
        } else if (items.length > 1) {
          const joined = items
            .map((it) => formatFileEntry(it.path.slice(dirKey.length + 1), it.lines))
            .join(", ");
          formattedLines.push(`${dirKey}/: ${joined}`);
        }
        if (subdirs.length === 1) {
          formattedLines.push(`${dirKey}/${subdirs[0]!}`);
        } else if (subdirs.length > 1) {
          formattedLines.push(`${dirKey}/: ${subdirs.join(", ")}`);
        }
      }
    }
  }

  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const enforceCeiling = shouldEnforceDefaultReadBudget(options);
  let formattedBundle = formattedLines.join("\n");
  if (enforceCeiling && Buffer.byteLength(formattedBundle, "utf-8") > effectiveBudgets.maxBytes) {
    const kept: string[] = [];
    let bytesUsed = 0;
    const maxListBytes = effectiveBudgets.maxBytes - 180;
    for (let i = 0; i < formattedLines.length; i++) {
      const ln = formattedLines[i]!;
      const addBytes = Buffer.byteLength(ln, "utf-8") + (kept.length > 0 ? 1 : 0);
      if (kept.length > 0 && bytesUsed + addBytes > maxListBytes) {
        const omittedCount = formattedLines.length - i;
        kept.push(`// +${omittedCount} more entries — narrow path or pass -d <depth>`);
        break;
      }
      kept.push(ln);
      bytesUsed += addBytes;
    }
    formattedBundle = kept.join("\n");
  }

  const targetLabel =
    scanRoots.length === 1
      ? formatReadDisplayPath(scanRoots[0]!, projectRoot)
      : scanRoots.map((r) => formatReadDisplayPath(r, projectRoot)).join(", ");

  const honestFdBaseline = computeHonestReadBaselineText({
    mode: "files",
    relPath: targetLabel || ".",
    projectRoot: scanRoots.length === 1 ? scanRoots[0] : projectRoot,
    filePaths: discovered.map((d) => d.path),
    maxDepth: effectiveMaxDepth,
    filePattern: primaryFilter,
    includeToolWrapper: false,
  });

  const jsonData = {
    mode: "files" as const,
    projectRoot,
    count: discovered.length,
    files: discovered,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const output = jsonOutput ?? formattedBundle;
  const aicePayload = jsonOutput ?? formattedBundle;

  const tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const aiceTok = jsonOutput !== undefined ? estimateTokens(jsonOutput, "cl100k_base") : tokenCount;
  const honestOrigTokens = estimateTokens(honestFdBaseline, "cl100k_base");
  const rawBytesSum = discovered.reduce((acc, d) => acc + d.bytes, 0);
  const rawCorpusCl100k =
    discovered.length === 0
      ? honestOrigTokens
      : Math.max(honestOrigTokens, Math.ceil(rawBytesSum / 4));

  recordTelemetryEvent({
    targetPath: scanRoots[0] ?? projectRoot,
    projectRoot,
    filePath: "<workspace-files>",
    operation: "outline",
    surface,
    idiomsUsed: false,
    nativeText: "",
    nativeChars: Math.max(honestFdBaseline.length, rawBytesSum),
    nativeCl100k: rawCorpusCl100k,
    nativeO200k: rawCorpusCl100k,
    realisticNativeText: honestFdBaseline,
    realisticNativeCl100k: Math.min(rawCorpusCl100k, honestOrigTokens),
    aiceText: aicePayload,
    aiceChars: aicePayload.length,
    aiceCl100k: aiceTok,
  });

  const stats: ReadStats = {
    tokenCount,
    originalTokens: honestOrigTokens,
    savedTokens: honestOrigTokens - tokenCount,
    savingsPct:
      honestOrigTokens > 0
        ? Math.round(((honestOrigTokens - tokenCount) / honestOrigTokens) * 100)
        : 0,
    originalChars: honestFdBaseline.length,
    outputChars: formattedBundle.length,
    dependenciesCount: 0,
    callersCount: 0,
    fileCount: discovered.length,
  };

  return {
    mode: "files",
    targetPath: targetLabel || ".",
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: scanRoots.map((r) => ({
      targetPath: formatReadDisplayPath(r, projectRoot),
      resolvedPath: r,
      mode: "files" as const,
    })),
    missingTargets: [],
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats,
  };
}

interface SearchCandidateFile {
  absPath: string;
  relPath: string;
  projectRoot: string;
  isExplicitTestSearch: boolean;
}

function collectSearchCandidateFiles(classified: ClassifiedReadTarget[]): SearchCandidateFile[] {
  const seenRealOrAbs = new Set<string>();
  const out: SearchCandidateFile[] = [];

  const pushCandidate = (
    absPath: string,
    relPath: string,
    projectRoot: string,
    isExplicitTestSearch: boolean,
  ): void => {
    let dedupKey = path.resolve(absPath);
    try {
      dedupKey = fs.realpathSync(absPath);
    } catch {}
    if (seenRealOrAbs.has(dedupKey)) return;
    seenRealOrAbs.add(dedupKey);
    out.push({ absPath, relPath, projectRoot, isExplicitTestSearch });
  };

  const walkSearchDir = (
    dirAbs: string,
    projectRoot: string,
    rootInNodeModules: boolean,
    explicitAllowedDirs: Set<string>,
    isExplicitTestSearch: boolean,
  ): void => {
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
        if (
          ent.name.startsWith(".") &&
          ent.name !== ".github" &&
          !explicitAllowedDirs.has(ent.name)
        ) {
          continue;
        }
        walkSearchDir(
          childAbs,
          projectRoot,
          rootInNodeModules,
          explicitAllowedDirs,
          isExplicitTestSearch,
        );
      } else if (ent.isFile()) {
        if (
          isSupportedReadDiskFile(childAbs, {
            allowDotfiles: explicitAllowedDirs.has(ent.name),
          })
        ) {
          pushCandidate(
            childAbs,
            formatReadDisplayPath(childAbs, projectRoot),
            projectRoot,
            isExplicitTestSearch,
          );
        }
      }
    }
  };

  for (const item of classified) {
    const relTarget = path.relative(item.resolved.projectRoot, item.diskPath).replace(/\\/g, "/");
    const baseName = path.basename(item.diskPath);
    const isExplicitTest =
      /(?:^|\/)(?:tests?|__tests__|mocks?|__mocks__|fixtures?|benchmarks?|specs?)(?:\/|$)/i.test(
        relTarget,
      ) || /^(?:tests?|__tests__|mocks?|__mocks__|fixtures?|specs?)$/i.test(baseName);

    if (item.isDir) {
      const explicitAllowed = new Set<string>();
      for (const seg of item.norm.targetPath.replace(/\\/g, "/").split("/").filter(Boolean)) {
        if (seg !== "." && seg !== "..") explicitAllowed.add(seg);
      }
      const inNodeMods = item.diskPath.split(path.sep).includes("node_modules");
      walkSearchDir(
        item.diskPath,
        item.resolved.projectRoot,
        inNodeMods,
        explicitAllowed,
        isExplicitTest,
      );
    } else {
      pushCandidate(item.diskPath, item.displayPath, item.resolved.projectRoot, isExplicitTest);
    }
  }

  return out;
}

function executeFilesWithMatchesSearch(params: {
  classified: ClassifiedReadTarget[];
  missingTargets: string[];
  regex: RegExp;
  selector: string;
  rawPattern: string;
  options: ReadOptions;
  surface: "cli" | "mcp";
}): ReadResult {
  const { classified, missingTargets, regex, selector, rawPattern, options, surface } = params;
  const primaryRoot = classified[0]?.resolved.projectRoot ?? process.cwd();
  const candidateFiles = collectSearchCandidateFiles(classified);

  interface ScoredPathHit {
    relPath: string;
    score: number;
  }
  const matchedScored: ScoredPathHit[] = [];

  for (const file of candidateFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    regex.lastIndex = 0;
    if (!regex.test(raw)) continue;

    const isTest = !file.isExplicitTestSearch && isTestOrMockPath(file.absPath, file.projectRoot);
    const lines = raw.split(/\r?\n/);
    let bestLineScore = 10;
    for (const ln of lines) {
      regex.lastIndex = 0;
      if (!regex.test(ln)) continue;
      const comment = isCommentLine(ln, file.absPath);
      if (!comment) {
        bestLineScore = isTest ? 50 : 500;
        break;
      }
      bestLineScore = Math.max(bestLineScore, isTest ? 10 : 100);
    }
    matchedScored.push({ relPath: file.relPath, score: bestLineScore });
  }

  matchedScored.sort(
    (a, b) => b.score - a.score || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0),
  );
  const matchedPaths = matchedScored.map((m) => m.relPath);
  let formattedBundle = matchedPaths.join("\n");
  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    formattedBundle = formattedBundle ? `${formattedBundle}\n${missingFooter}` : missingFooter;
  }

  let tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const jsonData = {
    mode: "search" as const,
    filesWithMatches: true,
    pattern: rawPattern,
    selector,
    count: matchedPaths.length,
    files: matchedPaths,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  let output = jsonOutput ?? formattedBundle;

  if (shouldEnforceDefaultReadBudget(options)) {
    const effectiveBudgets = resolveEffectiveReadBudgets(options);
    const capped = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: matchedPaths[0] ?? ".",
      projectRoot: primaryRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = capped.formattedBundle;
    output = capped.output;
    tokenCount = capped.tokenCount;
  }

  const targetLabel = classified.map((c) => c.displayPath || ".").join(", ") || ".";
  const honestFilesMatchBaseline = computeHonestReadBaselineText({
    filesWithMatches: true,
    matchedPaths,
    relPath: targetLabel,
    symbolSelector: rawPattern,
    includeToolWrapper: false,
  });
  const honestOrigTokens = estimateTokens(honestFilesMatchBaseline, "cl100k_base");
  const rawMatchCorpusChars = candidateFiles.reduce((acc, f) => {
    try {
      return acc + fs.statSync(f.absPath).size;
    } catch {
      return acc;
    }
  }, 0);
  const rawMatchCorpusTokens = Math.max(honestOrigTokens, Math.ceil(rawMatchCorpusChars / 4));

  if (classified[0]) {
    const aicePayload = jsonOutput ?? formattedBundle;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot: primaryRoot,
      operation: "context",
      surface,
      idiomsUsed: false,
      isSearchMode: true,
      nativeText: "",
      nativeChars: Math.max(honestFilesMatchBaseline.length, rawMatchCorpusChars),
      nativeCl100k: rawMatchCorpusTokens,
      nativeO200k: rawMatchCorpusTokens,
      realisticNativeText: honestFilesMatchBaseline,
      realisticNativeCl100k: Math.min(rawMatchCorpusTokens, honestOrigTokens),
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  return {
    mode: "search",
    targetPath: targetLabel,
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: classified.map((c) => ({
      targetPath: c.displayPath || ".",
      resolvedPath: c.diskPath,
      mode: "search" as const,
      selector,
    })),
    missingTargets,
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats: {
      tokenCount,
      originalTokens: honestOrigTokens,
      savedTokens: honestOrigTokens - tokenCount,
      originalChars: honestFilesMatchBaseline.length,
      outputChars: formattedBundle.length,
      dependenciesCount: 0,
      callersCount: 0,
      fileCount: matchedPaths.length,
    },
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

interface ScoredCompactSearchHit {
  relPath: string;
  absPath: string;
  rawSource: string;
  formattedEntry: string;
  score: number;
}

function executeUnifiedCompactSearch(params: {
  classified: ClassifiedReadTarget[];
  missingTargets: string[];
  defaultSelector?: string;
  rawPatternLabel: string;
  options: ReadOptions;
  surface: "cli" | "mcp";
}): ReadResult {
  const { classified, missingTargets, defaultSelector, rawPatternLabel, options, surface } = params;
  const primaryRoot = classified[0]?.resolved.projectRoot ?? process.cwd();
  const candidateFiles = collectSearchCandidateFiles(classified);
  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const enforceCeiling = shouldEnforceDefaultReadBudget(
    options,
    classified.map((c) => c.norm),
  );

  const primarySelector =
    defaultSelector ??
    classified.find((c) => Boolean(c.effectiveSelector))?.effectiveSelector ??
    "//";
  const selectorPieces = splitCommaSelectors(primarySelector).filter(Boolean);
  const activeSelectors = selectorPieces.length > 0 ? selectorPieces : [primarySelector];
  const primaryQueryKw = extractPrimaryQueryKeyword(activeSelectors[0] ?? "");

  const hits: ScoredCompactSearchHit[] = [];
  const baselineEntries: HonestBaselineFileEntry[] = [];

  for (const file of candidateFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    baselineEntries.push({ relPath: file.relPath, rawSource: raw });

    const matchedParts: string[] = [];
    let fileMaxScore = 0;
    for (const selPiece of activeSelectors) {
      let cleanPiece = selPiece.trim();
      if (
        cleanPiece.startsWith("/") &&
        cleanPiece.length > 1 &&
        cleanPiece.indexOf("/", 1) === -1
      ) {
        const rawBody = cleanPiece.slice(1).replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
        cleanPiece = `/${rawBody}/`;
      }
      const det = extractPatternMatchesDetailed(raw, cleanPiece, options.contextLines, {
        filePath: file.absPath,
        projectRoot: file.projectRoot,
        isExplicitTestSearch: file.isExplicitTestSearch,
        full: options.full,
        dsl: options.dsl,
        compactGrouped: true,
      });
      if (det) {
        matchedParts.push(det.formattedText.trimEnd());
        if (det.maxScore > fileMaxScore) {
          fileMaxScore = det.maxScore;
        }
      }
    }

    if (matchedParts.length === 0) {
      if (primaryQueryKw && doesFileStemMatchQuery(file.absPath, primaryQueryKw)) {
        const cleanLines = (raw.length > 0 ? raw.replace(/\r?\n$/, "") : "").split(/\r?\n/);
        const previewCount = Math.min(2, cleanLines.length);
        const preview = cleanLines
          .slice(0, previewCount)
          .map((l, idx) => `  L${idx + 1}: ${l}`)
          .join("\n");
        matchedParts.push(preview);
        const isMock =
          !file.isExplicitTestSearch && isTestOrMockPath(file.absPath, file.projectRoot);
        fileMaxScore = isMock ? 25 : 1000;
      } else {
        continue;
      }
    }

    hits.push({
      relPath: file.relPath,
      absPath: file.absPath,
      rawSource: raw,
      formattedEntry: `${file.relPath}:\n${matchedParts.join("\n")}`,
      score: fileMaxScore,
    });
  }

  hits.sort(
    (a, b) => b.score - a.score || (a.relPath < b.relPath ? -1 : a.relPath > b.relPath ? 1 : 0),
  );

  const unclosedSlashHint =
    primarySelector.startsWith("/") &&
    primarySelector.length > 1 &&
    primarySelector.indexOf("/", 1) === -1
      ? `// Hint: quote regex selectors in shell: '${classified[0]?.displayPath || "file"}:${primarySelector}|.../'\n`
      : "";

  const targetLabel = classified.map((c) => c.displayPath || ".").join(", ") || ".";
  const keptBlocks: string[] = [];
  const omittedFiles: string[] = [];
  let usedBytes = Buffer.byteLength(unclosedSlashHint, "utf-8");
  const maxBodyBytes = enforceCeiling ? Math.max(512, effectiveBudgets.maxBytes - 180) : Infinity;

  for (let i = 0; i < hits.length; i++) {
    const h = hits[i]!;
    const sep = keptBlocks.length > 0 ? 1 : 0;
    const addBytes = Buffer.byteLength(h.formattedEntry, "utf-8") + sep;
    if (enforceCeiling && keptBlocks.length > 0 && usedBytes + addBytes > maxBodyBytes) {
      for (let j = i; j < hits.length; j++) {
        omittedFiles.push(hits[j]!.relPath);
      }
      break;
    }
    keptBlocks.push(h.formattedEntry);
    usedBytes += addBytes;
  }

  let formattedBundle: string;
  if (keptBlocks.length > 0) {
    formattedBundle = `${unclosedSlashHint}${keptBlocks.join("\n")}`;
    if (omittedFiles.length > 0) {
      const nextFile = omittedFiles[0] ?? ".";
      const safePat = rawPatternLabel.replace(/"/g, '\\"');
      formattedBundle += `\n// +${omittedFiles.length} more matching files — next: aice search "${safePat}" ${nextFile}`;
    }
  } else {
    formattedBundle = `${unclosedSlashHint}// 0 matches for '${rawPatternLabel || primarySelector}' in ${targetLabel}`;
  }

  if (missingTargets.length > 0) {
    const missingFooter = missingTargets.map((m) => `// not found: ${m}`).join("\n");
    formattedBundle = `${formattedBundle}\n${missingFooter}`;
  }

  if (options.maxTokens !== undefined) {
    formattedBundle = truncateBundleToMaxTokens(formattedBundle, options.maxTokens).text;
  }

  let tokenCount = estimateTokens(formattedBundle, "cl100k_base");
  const jsonData = {
    mode: "search" as const,
    pattern: rawPatternLabel || primarySelector,
    selector: primarySelector,
    count: hits.length,
    files: hits.map((h) => h.relPath),
    formattedBundle,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const statsText = options.stats
    ? formatContextStatsFooter(tokenCount, 0, 0, formattedBundle.length)
    : undefined;
  let output = jsonOutput ?? (statsText ? `${formattedBundle}\n\n${statsText}` : formattedBundle);

  if (enforceCeiling && Buffer.byteLength(output, "utf-8") > effectiveBudgets.maxBytes) {
    const capped = enforceReadBudgetCeiling({
      bundle: formattedBundle,
      fallbackTargetPath: omittedFiles[0] ?? hits[0]?.relPath ?? ".",
      statsText,
      projectRoot: primaryRoot,
      maxBytes: effectiveBudgets.maxBytes,
      maxTokens: effectiveBudgets.maxTokens,
      sliceByteBudget: effectiveBudgets.sliceByteBudget,
      budgetLabel: effectiveBudgets.budgetLabel,
    });
    formattedBundle = capped.formattedBundle;
    output = capped.output;
    tokenCount = capped.tokenCount;
  }

  const honestRgBaseline = computeHonestReadBaselineText({
    relPath: targetLabel,
    workspaceFiles: baselineEntries,
    symbolSelector: primarySelector,
    mode: "search",
    includeToolWrapper: false,
  });
  const honestOrigTokens = estimateTokens(honestRgBaseline, "cl100k_base");
  const rawSearchCorpusChars = baselineEntries.reduce((acc, e) => acc + e.rawSource.length, 0);
  const rawSearchCorpusCl100k = Math.max(
    honestOrigTokens,
    baselineEntries.reduce((acc, e) => acc + estimateTokens(e.rawSource, "cl100k_base"), 0),
  );

  if (classified[0]) {
    const aicePayload = jsonOutput ?? formattedBundle;
    const multiFiles =
      classified.length > 1 && classified.some((c) => !c.isDir)
        ? classified.filter((c) => !c.isDir).map((c) => c.displayPath)
        : undefined;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot: primaryRoot,
      ...(multiFiles && multiFiles.length > 1 ? { filePath: "<multi-context>", multiFiles } : {}),
      operation: "context",
      surface,
      idiomsUsed: false,
      isSearchMode: true,
      nativeText: "",
      nativeChars: Math.max(honestRgBaseline.length, rawSearchCorpusChars),
      nativeCl100k: rawSearchCorpusCl100k,
      nativeO200k: rawSearchCorpusCl100k,
      realisticNativeText: honestRgBaseline,
      realisticNativeCl100k: Math.min(rawSearchCorpusCl100k, honestOrigTokens),
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  return {
    mode: "search",
    targetPath: targetLabel,
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: classified.map((c) => ({
      targetPath: c.displayPath || ".",
      resolvedPath: c.diskPath,
      mode: "search" as const,
      selector: c.effectiveSelector ?? primarySelector,
    })),
    missingTargets,
    dependencies: [],
    callers: [],
    jsonData,
    jsonOutput,
    stats: {
      tokenCount,
      originalTokens: honestOrigTokens,
      savedTokens: honestOrigTokens - tokenCount,
      savingsPct:
        honestOrigTokens > 0
          ? Math.round(((honestOrigTokens - tokenCount) / honestOrigTokens) * 100)
          : 0,
      originalChars: honestRgBaseline.length,
      outputChars: formattedBundle.length,
      dependenciesCount: 0,
      callersCount: 0,
      fileCount: hits.length,
    },
    statsText,
  };
}

interface ClassifiedReadTarget {
  norm: NormalizedReadTarget;
  resolved: ResolvedPathTargets;
  diskPath: string;
  displayPath: string;
  isDir: boolean;
  route: Exclude<ReadRouteMode, "mixed" | "workspace" | "files">;
  effectiveSelector?: string;
  usesSharedSymbol: boolean;
  preReadSource?: string;
  lineCount?: number;
  needsDynamicBudget?: boolean;
  budgetDowngraded?: boolean;
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
      const ext = path.extname(diskPath).toLowerCase();
      const isOutlinableFile =
        EXTENDED_READ_EXTENSIONS.has(ext) ||
        EXTENDED_READ_FILENAMES.has(path.basename(diskPath)) ||
        diskPath.endsWith(".aice") ||
        isSupportedReadDiskFile(diskPath);
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
      const testFiles = collectSearchCandidateFiles(classified);
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
      const subBlocks = rawOutlineSectionBody.split("\n\n");
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
      const displayKey = options.projectRoot
        ? formatReadDisplayPath(itemRes.file, projectRoot, rawKey)
        : rawKey;
      const autoMeta = autoOutlineByAbsPath.get(path.resolve(itemRes.file));
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
