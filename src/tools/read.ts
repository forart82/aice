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
  KNOWN_TARGET_EXTENSIONS,
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
  generateContext,
  isCommentLine,
  isTestOrMockPath,
  mergeMultiContextResults,
  type WorkspaceCallerScanCache,
} from "./context.js";
import {
  generateOutline,
  type OutlineOptions,
  type OutlineResult,
  outlinePath,
} from "./outline.js";
import { didYouMeanFile } from "./suggest.js";

export const DEFAULT_AUTO_OUTLINE_LINE_THRESHOLD = 250;
export const DEFAULT_READ_MAX_BYTES = 28 * 1024; // 28,672 bytes (~7,000 BPE tokens)
export const DEFAULT_READ_MAX_TOKENS = 7_000;
export const DEFAULT_READ_SOFT_BYTE_CAP = 26_624;
export const DEFAULT_READ_SOFT_TOKEN_CAP = 6_500;
export const DEFAULT_SLICE_BYTE_BUDGET = 18_432;

export const DEFAULT_CLI_READ_MAX_BYTES = 9_216; // 9.0 KB (strictly below host 9,892-byte middle-truncation ceiling)
export const DEFAULT_CLI_READ_SOFT_BYTE_CAP = 8_704; // 8.5 KB
export const DEFAULT_CLI_SLICE_BYTE_BUDGET = 7_936; // 7.75 KB (~135-185 AST-snapped lines)
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
  if (options?.surface === "cli" && options.maxTokens === undefined && !options.unboundedCli) {
    const maxBytes =
      options.maxBytes !== undefined
        ? Math.max(512, Math.min(DEFAULT_CLI_READ_MAX_BYTES, options.maxBytes))
        : DEFAULT_CLI_READ_MAX_BYTES;
    const softByteCap = Math.min(DEFAULT_CLI_READ_SOFT_BYTE_CAP, Math.max(400, maxBytes - 512));
    const sliceByteBudget = Math.min(DEFAULT_CLI_SLICE_BYTE_BUDGET, Math.max(400, maxBytes - 1_280));
    return {
      maxBytes,
      softByteCap,
      sliceByteBudget,
      maxTokens: DEFAULT_CLI_READ_MAX_TOKENS,
      softTokenCap: DEFAULT_CLI_READ_SOFT_TOKEN_CAP,
      budgetLabel: "9 KB CLI",
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
  const avgBytesPerLine = Math.max(
    16,
    Buffer.byteLength(rawSource, "utf-8") / Math.max(1, totalLines),
  );
  const rawMaxLines = Math.max(80, Math.min(650, Math.floor(sliceByteBudget / avgBytesPerLine)));

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
    if (KNOWN_TARGET_EXTENSIONS.has(ext) || diskPath.endsWith(".aice")) {
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
  const m = selector.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
  if (!m?.[1]) return undefined;
  const startLine = Number.parseInt(m[1], 10);
  const endLine = m[2] ? Number.parseInt(m[2], 10) : undefined;
  return { startLine, endLine };
}

function buildAutoOutlineHeader(
  displayPath: string,
  lineCount: number,
  opts?: { nextSliceCmd?: string; budgetDowngraded?: boolean; budgetLabel?: string },
): string {
  const base = opts?.budgetLabel?.includes("CLI")
    ? `// Auto-outlined (${lineCount} lines). Pass ${displayPath}:<symbol> or ${displayPath}:L<start>-L<end> for native source.`
    : `// Auto-outlined (${lineCount} lines). Pass ${displayPath}:<symbol>, ${displayPath}:L<start>-L<end>, or --full for full source.`;
  if (opts?.budgetDowngraded && opts.nextSliceCmd) {
    return `${base} (auto-downgraded to :outline — ${opts.budgetLabel ?? "28 KB"} budget; next slice: ${opts.nextSliceCmd})`;
  }
  if (opts?.nextSliceCmd) {
    return `${base} Next slice: ${opts.nextSliceCmd}`;
  }
  return base;
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
  if (options.surface === "cli" && !options.unboundedCli) return true;
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

function buildNextSliceHintCommand(
  displayPath: string,
  startLine = 1,
  totalLines?: number,
  opts?: {
    diskPath?: string;
    rawSource?: string;
    projectRoot?: string;
    sliceByteBudget?: number;
    maxEndLine?: number;
  },
): string {
  const parsed = splitPathAndSelector(displayPath);
  const safePath = parsed.filePath.trim() || ".";
  const sLine = Math.max(1, startLine);

  let resolvedDiskPath = opts?.diskPath;
  let resolvedRawSource = opts?.rawSource;
  if (resolvedRawSource === undefined) {
    const candidateAbs =
      resolvedDiskPath ??
      (opts?.projectRoot
        ? path.resolve(opts.projectRoot, safePath)
        : path.isAbsolute(safePath)
          ? safePath
          : undefined);
    if (candidateAbs) {
      try {
        if (fs.existsSync(candidateAbs) && fs.statSync(candidateAbs).isFile()) {
          resolvedDiskPath = candidateAbs;
          resolvedRawSource = fs.readFileSync(candidateAbs, "utf-8");
        }
      } catch {
        // fall through to conservative window
      }
    }
  }

  const parsedRange = parseSelectorLineRange(parsed.selector);
  const effectiveMaxEnd =
    opts?.maxEndLine ??
    (parsedRange?.endLine !== undefined && parsedRange.endLine >= sLine
      ? parsedRange.endLine
      : undefined);

  if (resolvedRawSource !== undefined) {
    const span = computeDynamicSliceSpan(
      resolvedDiskPath ?? safePath,
      resolvedRawSource,
      sLine,
      opts?.sliceByteBudget ?? DEFAULT_SLICE_BYTE_BUDGET,
    );
    const endLine =
      effectiveMaxEnd !== undefined
        ? Math.max(span.startLine, Math.min(span.endLine, effectiveMaxEnd))
        : span.endLine;
    return `aice read ${safePath}:L${span.startLine}-L${endLine}`;
  }

  const fallbackWindow = 160;
  const rawEnd = sLine + fallbackWindow - 1;
  let eLine =
    totalLines !== undefined && totalLines >= sLine ? Math.min(totalLines, rawEnd) : rawEnd;
  if (effectiveMaxEnd !== undefined) {
    eLine = Math.max(sLine, Math.min(eLine, effectiveMaxEnd));
  }
  return `aice read ${safePath}:L${sLine}-L${eLine}`;
}

function inferNextWindowFromTruncatedSlice(
  emittedSlice: string,
  fallbackTargetPath: string,
  totalLines?: number,
  opts?: {
    diskPath?: string;
    rawSource?: string;
    projectRoot?: string;
    sliceByteBudget?: number;
  },
): string {
  const lines = emittedSlice.split("\n");
  const initialTarget = fallbackTargetPath.split(",")[0]?.trim() || ".";
  const parsedFallback = splitPathAndSelector(initialTarget);
  let lastFilePath = parsedFallback.filePath || ".";
  let activeSelector = parsedFallback.selector;
  let lastLineNum = 0;

  for (const ln of lines) {
    const hdrMatch = ln.match(/^\/\/ === ([^=(]+?)(?:\s+\(| ===)/);
    if (hdrMatch?.[1]) {
      const parsedHdr = splitPathAndSelector(hdrMatch[1].trim());
      lastFilePath = parsedHdr.filePath || ".";
      activeSelector =
        parsedHdr.selector ??
        (lastFilePath === parsedFallback.filePath ? parsedFallback.selector : undefined);
      lastLineNum = 0;
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
    const numMatch = ln.match(/^\s*(?:L(\d+):|(\d+)│)/);
    if (numMatch) {
      const parsedNum = Number.parseInt(numMatch[1] ?? numMatch[2] ?? "0", 10);
      if (parsedNum > 0) {
        lastLineNum = parsedNum;
      }
    }
  }

  const nextStart = lastLineNum > 0 ? lastLineNum + 1 : 1;
  const parsedRange = parseSelectorLineRange(activeSelector);
  const reqEnd =
    parsedRange?.endLine !== undefined && parsedRange.endLine >= nextStart
      ? parsedRange.endLine
      : undefined;

  const useProvidedSource =
    opts?.rawSource !== undefined && lastFilePath === parsedFallback.filePath;

  return buildNextSliceHintCommand(lastFilePath, nextStart, totalLines, {
    diskPath: useProvidedSource ? opts?.diskPath : undefined,
    rawSource: useProvidedSource ? opts?.rawSource : undefined,
    projectRoot: opts?.projectRoot,
    sliceByteBudget: opts?.sliceByteBudget,
    maxEndLine: reqEnd,
  });
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
  const sliceByteBudget = params.sliceByteBudget ?? DEFAULT_SLICE_BYTE_BUDGET;
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
  const targetKeepBytes = Math.max(512, maxBundleBytes - 260);
  const targetKeepTokens = Math.max(128, effectiveTokenCeiling - 90);

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
    const dropCount = Math.max(1, Math.floor(keptLines.length * 0.1));
    keptLines.splice(keptLines.length - dropCount, dropCount);
    keptText = keptLines.join("\n");
  }

  const isCliBudget = budgetLabel.includes("CLI");
  const buildFooterForKept = (candidateKept: string): string => {
    if (
      (!extraHints || extraHints.length === 0) &&
      !nextOmittedFile &&
      isTargetContentCompleteInContextPack(bundle, candidateKept)
    ) {
      const fullHint = isCliBudget ? "" : " (pass --full for all contracts)";
      return `\n\n// [${budgetLabel} stdout budget reached — target content complete; trailing dependency/caller contracts trimmed${fullHint}]`;
    }
    const hint =
      extraHints && extraHints.length > 0
        ? extraHints.slice(0, 3).join(" | ")
        : nextOmittedFile
          ? buildNextSliceHintCommand(nextOmittedFile, 1, undefined, {
              projectRoot,
              sliceByteBudget,
            })
          : inferNextWindowFromTruncatedSlice(candidateKept, fallbackTargetPath, totalLines, {
              diskPath,
              rawSource,
              projectRoot,
              sliceByteBudget,
            });
    const fullHint = isCliBudget ? "" : " (or pass --full)";
    return `\n\n// [${budgetLabel} stdout budget reached — next slice: ${hint}${fullHint}]`;
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
  const trimmed = rawSearch.trim();
  const slashedMatch = trimmed.match(/^\/((?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+)\/([gimsuy]*)$/);
  if (slashedMatch?.[1]) {
    const rawBody = slashedMatch[1];
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

  if (rawSearch.length > 0 && !hasUnsafeSearchQuantifiers(rawSearch)) {
    try {
      const escapedSlashBody = escapeUnescapedForwardSlashes(rawSearch);
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
  const explicitHiddenAllowed = new Set<string>();

  for (const tok of rawTokens) {
    const candidateBase = path.resolve(baseDir, tok);
    const candidateRoot = path.resolve(projectRoot, tok);
    if (fs.existsSync(candidateBase)) {
      scanRoots.push(candidateBase);
      for (const seg of tok.replace(/\\/g, "/").split("/")) {
        if (seg.startsWith(".") && seg !== "." && seg !== "..") explicitHiddenAllowed.add(seg);
      }
    } else if (fs.existsSync(candidateRoot)) {
      scanRoots.push(candidateRoot);
      for (const seg of tok.replace(/\\/g, "/").split("/")) {
        if (seg.startsWith(".") && seg !== "." && seg !== "..") explicitHiddenAllowed.add(seg);
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

  const candidateFiles = new Map<string, string>(); // relPosix -> absPath
  const collectFromDir = (dirAbs: string): void => {
    let entries: fs.Dirent[];
    try {
      entries = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of entries) {
      const childAbs = path.join(dirAbs, ent.name);
      if (ent.isDirectory()) {
        if (
          DEFAULT_IGNORED_SCAN_DIRECTORIES.has(ent.name) &&
          !explicitHiddenAllowed.has(ent.name)
        ) {
          continue;
        }
        if (ent.name.startsWith(".") && !explicitHiddenAllowed.has(ent.name)) {
          continue;
        }
        if (configuredOutDir && path.resolve(childAbs) === configuredOutDir) {
          continue;
        }
        collectFromDir(childAbs);
      } else if (ent.isFile()) {
        if (ent.name.endsWith(".trivia.json")) continue;
        const ext = path.extname(ent.name).toLowerCase();
        if (BINARY_DISCOVERY_EXTENSIONS.has(ext)) continue;
        const relPosix = formatReadDisplayPath(childAbs, projectRoot);
        if (activeMatchers.length === 0 || activeMatchers.every((fn) => fn(relPosix))) {
          candidateFiles.set(relPosix, childAbs);
        }
      }
    }
  };

  for (const rootAbs of scanRoots) {
    try {
      const st = fs.statSync(rootAbs);
      if (st.isDirectory()) {
        collectFromDir(rootAbs);
      } else if (st.isFile()) {
        const relPosix = formatReadDisplayPath(rootAbs, projectRoot);
        if (activeMatchers.length === 0 || activeMatchers.every((fn) => fn(relPosix))) {
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
  const formattedLines: string[] = [];
  let totalSourceChars = 0;

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
    totalSourceChars += bytes;
    const sizeKBNum = bytes === 0 ? 0 : Number(Math.max(0.1, bytes / 1024).toFixed(1));
    const sizeKBText = bytes === 0 ? "0.0" : Math.max(0.1, bytes / 1024).toFixed(1);
    discovered.push({
      path: relPath,
      lines,
      bytes,
      sizeKB: sizeKBNum,
    });
    formattedLines.push(`${relPath} (${lines}L, ${sizeKBText}KB)`);
  }

  const effectiveBudgets = resolveEffectiveReadBudgets(options);
  const enforceCeiling = shouldEnforceDefaultReadBudget(options);
  let formattedBundle = formattedLines.join("\n");
  if (enforceCeiling && Buffer.byteLength(formattedBundle, "utf-8") > effectiveBudgets.maxBytes) {
    const kept: string[] = [];
    let bytesUsed = 0;
    const maxListBytes = effectiveBudgets.maxBytes - 256;
    for (let i = 0; i < formattedLines.length; i++) {
      const ln = formattedLines[i]!;
      const addBytes = Buffer.byteLength(ln, "utf-8") + (kept.length > 0 ? 1 : 0);
      if (kept.length > 0 && bytesUsed + addBytes > maxListBytes) {
        const omittedCount = formattedLines.length - i;
        const fullHint = options.surface === "cli" ? "" : " or pass --full";
        kept.push(
          `// ... (+${omittedCount} more files omitted to fit ${effectiveBudgets.budgetLabel} stdout budget — narrow path/filter${fullHint})`,
        );
        break;
      }
      kept.push(ln);
      bytesUsed += addBytes;
    }
    formattedBundle = kept.join("\n");
  }

  const approxTokenCount = Math.max(0, Math.ceil(Buffer.byteLength(formattedBundle, "utf-8") / 4));
  const approxOrigTokens = Math.max(0, Math.ceil(totalSourceChars / 4));

  const jsonData = {
    mode: "files" as const,
    projectRoot,
    count: discovered.length,
    files: discovered,
  };
  const jsonOutput = options.json ? JSON.stringify(jsonData, null, 2) : undefined;
  const output = jsonOutput ?? formattedBundle;

  const aicePayload = jsonOutput ?? formattedBundle;
  const aiceApproxTok = Math.max(0, Math.ceil(Buffer.byteLength(aicePayload, "utf-8") / 4));
  recordTelemetryEvent({
    targetPath: scanRoots[0] ?? projectRoot,
    projectRoot,
    filePath: "<workspace-files>",
    operation: "outline",
    surface,
    idiomsUsed: false,
    nativeText: "",
    nativeChars: totalSourceChars,
    nativeCl100k: approxOrigTokens,
    nativeO200k: approxOrigTokens,
    realisticNativeCl100k: approxOrigTokens,
    aiceText: aicePayload,
    aiceChars: aicePayload.length,
    aiceCl100k: aiceApproxTok,
    aiceO200k: aiceApproxTok,
  });

  const targetLabel =
    scanRoots.length === 1
      ? formatReadDisplayPath(scanRoots[0]!, projectRoot)
      : scanRoots.map((r) => formatReadDisplayPath(r, projectRoot)).join(", ");

  const stats: ReadStats = {
    tokenCount: approxTokenCount,
    originalTokens: approxOrigTokens,
    savedTokens: approxOrigTokens - approxTokenCount,
    savingsPct:
      approxOrigTokens > 0
        ? Math.round(((approxOrigTokens - approxTokenCount) / approxOrigTokens) * 100)
        : 0,
    originalChars: totalSourceChars,
    outputChars: formattedBundle.length,
    dependenciesCount: 0,
    callersCount: 0,
    fileCount: discovered.length,
  };

  return {
    mode: "files",
    targetPath: targetLabel,
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount: approxTokenCount,
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
  const seenAbs = new Set<string>();
  const candidateFiles: Array<{ absPath: string; relPath: string; projectRoot: string }> = [];

  for (const item of classified) {
    if (item.isDir) {
      for (const fp of item.resolved.files) {
        const abs = path.resolve(fp);
        if (!seenAbs.has(abs)) {
          seenAbs.add(abs);
          candidateFiles.push({
            absPath: abs,
            relPath: formatReadDisplayPath(abs, item.resolved.projectRoot),
            projectRoot: item.resolved.projectRoot,
          });
        }
      }
    } else {
      const abs = path.resolve(item.diskPath);
      if (!seenAbs.has(abs)) {
        seenAbs.add(abs);
        candidateFiles.push({
          absPath: abs,
          relPath: item.displayPath,
          projectRoot: item.resolved.projectRoot,
        });
      }
    }
  }

  const matchedScored: Array<{ relPath: string; score: number }> = [];
  let totalNativeChars = 0;

  for (const file of candidateFiles) {
    let raw: string;
    try {
      raw = fs.readFileSync(file.absPath, "utf-8");
    } catch {
      continue;
    }
    totalNativeChars += raw.length;
    regex.lastIndex = 0;
    if (!regex.test(raw)) continue;

    const isTest = isTestOrMockPath(file.absPath, file.projectRoot);
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

  let tokenCount = estimateTokens(formattedBundle);
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

  const approxOrigTokens = Math.ceil(totalNativeChars / 4);
  if (classified[0]) {
    const aicePayload = jsonOutput ?? formattedBundle;
    recordTelemetryEvent({
      targetPath: classified[0].diskPath,
      projectRoot: primaryRoot,
      operation: "context",
      surface,
      idiomsUsed: false,
      nativeText: "",
      nativeChars: totalNativeChars,
      nativeCl100k: approxOrigTokens,
      nativeO200k: approxOrigTokens,
      realisticNativeCl100k: approxOrigTokens,
      aiceText: aicePayload,
      aiceCl100k: jsonOutput !== undefined ? undefined : tokenCount,
    });
  }

  return {
    mode: "search",
    targetPath: classified.map((c) => c.displayPath).join(", "),
    text: formattedBundle,
    formattedBundle,
    targetContent: formattedBundle,
    output,
    tokenCount,
    targets: classified.map((c) => ({
      targetPath: c.displayPath,
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
      originalTokens: approxOrigTokens,
      savedTokens: approxOrigTokens - tokenCount,
      originalChars: totalNativeChars,
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

  let normalizedItems = normalizeReadTargets(targets, baseDir);
  if (normalizedItems.length === 0 && (safeSearch !== undefined || options.filesWithMatches)) {
    normalizedItems = normalizeReadTargets(["."], baseDir);
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
        includeDeps: options.includeDeps,
        includeCallers: options.includeCallers,
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
  const explicitLineThreshold = options.autoOutlineLineThreshold;
  const sharedSymbolRaw = safeSearch?.selector ?? (options.symbol?.trim() || undefined);
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
    const effectiveSelector = isExplicitOutline
      ? undefined
      : (safeSearch?.selector ??
        norm.selector ??
        (sharedSymIsOutline ? undefined : sharedSymbolRaw));
    const usesSharedSymbol =
      !isExplicitOutline && !safeSearch && !norm.selector && Boolean(effectiveSelector);
    const effectiveFull = Boolean(options.full) || norm.explicitFull;

    let route: ClassifiedReadTarget["route"];
    let preReadSource: string | undefined;
    let lineCount: number | undefined;
    let needsDynamicBudget = false;

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
        if (explicitLineThreshold !== undefined) {
          if (lineCount > explicitLineThreshold) {
            route = "auto-outline-file";
          } else {
            route = "context";
            sharedScanCache.fileContentByPath.set(diskPath, preReadSource);
          }
        } else if (options.maxTokens !== undefined) {
          route = "context";
          sharedScanCache.fileContentByPath.set(diskPath, preReadSource);
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
  const bypassInternalCap = Boolean(
    options.full || options.maxTokens !== undefined || options.json,
  );
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
        json: false,
        stats: false,
        _bypassInternalCap: true,
      },
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
        ? `${buildAutoOutlineHeader(displayKey, autoMeta.lineCount, {
            budgetDowngraded: autoMeta.budgetDowngraded,
            budgetLabel: effectiveBudgets.budgetLabel,
            nextSliceCmd: buildNextSliceHintCommand(displayKey, 1, autoMeta.lineCount, {
              diskPath: autoMeta.diskPath,
              rawSource: autoMeta.preReadSource,
              projectRoot,
              sliceByteBudget: effectiveBudgets.sliceByteBudget,
            }),
          })}\n`
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
      const budgetThresholdBytes = effectiveBudgets.maxBytes - 512;
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
          .map((p) =>
            buildNextSliceHintCommand(p, 1, undefined, {
              projectRoot,
              sliceByteBudget: effectiveBudgets.sliceByteBudget,
            }),
          )
          .join(" | ");
        const fullHint = options.surface === "cli" ? "" : " (or pass --full)";
        keptOutlineBlocks.push(
          `// ... (+${omittedDisplayPaths.length} more target files omitted to fit ${effectiveBudgets.budgetLabel} stdout budget)\n// Next slices: ${hintCmds}${fullHint}`,
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
      const nextSliceCmd = buildNextSliceHintCommand(autoMeta.displayPath, 1, autoMeta.lineCount, {
        diskPath: autoMeta.diskPath,
        rawSource: autoMeta.preReadSource,
        projectRoot,
        sliceByteBudget: effectiveBudgets.sliceByteBudget,
      });
      const autoHeader = buildAutoOutlineHeader(autoMeta.displayPath, autoMeta.lineCount, {
        budgetDowngraded: autoMeta.budgetDowngraded,
        budgetLabel: effectiveBudgets.budgetLabel,
        nextSliceCmd,
      });
      const body = outlineRes.text ? `${autoHeader}\n${outlineRes.text}` : autoHeader;
      const sliceHintFooter = `// Next slice: ${nextSliceCmd}`;
      if (!body.includes(sliceHintFooter)) {
        rawBundle = `${body}\n\n${sliceHintFooter}`;
      } else {
        rawBundle = body;
      }
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
  const effectiveBudgets = resolveEffectiveReadBudgets(options);

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

  const effectiveRawNative = resolveEffectiveReadRawNative(options);
  const enforceContextBudget = shouldEnforceDefaultReadBudget(
    options,
    contextItems.map((c) => c.norm),
  );

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
      maxByteBudget: !isMultiInput && enforceContextBudget ? effectiveBudgets.maxBytes : undefined,
      rawNative: effectiveRawNative,
      dsl: options.dsl,
      contextLines: options.contextLines,
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

    // Auto-downgrade heavy overflow targets to `:outline` + exact `Lstart-Lend` hints when > budget
    if (
      enforceStreamBudget &&
      (Buffer.byteLength(formattedBundle, "utf-8") > effectiveBudgets.maxBytes ||
        (merged.tokenCount ?? estimateTokens(formattedBundle)) > effectiveBudgets.maxTokens)
    ) {
      const keptContextResults: ContextResult[] = [];
      const downgradedBlocks: string[] = [];
      const softByteCap = effectiveBudgets.softByteCap;
      const softTokenCap = effectiveBudgets.softTokenCap;

      // Smallest-first water-filling across multi-context targets
      const indexedCosts = results.map((resItem, idx) => ({
        idx,
        itemBytes: Buffer.byteLength(resItem.formattedBundle, "utf-8"),
        itemToks: resItem.tokenCount ?? estimateTokens(resItem.formattedBundle),
      }));
      const sortedCosts = [...indexedCosts].sort(
        (a, b) => a.itemBytes - b.itemBytes || a.idx - b.idx,
      );
      const fitInlineIndices = new Set<number>();
      let cumulativeBytes = 0;
      let cumulativeTokens = 0;
      for (const entry of sortedCosts) {
        const sep = fitInlineIndices.size > 0 ? 2 : 0;
        if (
          cumulativeBytes + sep + entry.itemBytes <= softByteCap &&
          cumulativeTokens + entry.itemToks <= softTokenCap
        ) {
          fitInlineIndices.add(entry.idx);
          cumulativeBytes += sep + entry.itemBytes;
          cumulativeTokens += entry.itemToks;
        }
      }

      for (let i = 0; i < results.length; i++) {
        const resItem = results[i]!;
        const targetMeta = matchedTargets[i]!;

        if (fitInlineIndices.has(i)) {
          keptContextResults.push(resItem);
          continue;
        }

        const isExplicitLineRange = Boolean(
          targetMeta.effectiveSelector &&
            LINE_RANGE_SELECTOR_RE.test(targetMeta.effectiveSelector),
        );
        const parsedOverflowRange = parseSelectorLineRange(targetMeta.effectiveSelector);

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
        const cachedRaw =
          targetMeta.preReadSource ?? sharedScanCache.fileContentByPath.get(targetMeta.diskPath);
        const totalTargetLines =
          targetMeta.lineCount ?? (cachedRaw ? countSourceLines(cachedRaw) : undefined);
        const requestedEndLine = parsedOverflowRange
          ? (parsedOverflowRange.endLine ?? parsedOverflowRange.startLine)
          : undefined;
        const nextCmd = buildNextSliceHintCommand(
          targetMeta.displayPath,
          startHintLine,
          totalTargetLines,
          {
            diskPath: targetMeta.isDir ? undefined : targetMeta.diskPath,
            rawSource: cachedRaw,
            projectRoot: targetMeta.resolved.projectRoot,
            sliceByteBudget: effectiveBudgets.sliceByteBudget,
            maxEndLine:
              requestedEndLine !== undefined && requestedEndLine >= startHintLine
                ? requestedEndLine
                : undefined,
          },
        );
        paginationHints.push(nextCmd);
        if (targetSummaries[i]) {
          targetSummaries[i] = {
            ...targetSummaries[i]!,
            autoOutlined: true,
            ...(totalTargetLines !== undefined ? { lineCount: totalTargetLines } : {}),
          };
        }

        if (isExplicitLineRange) {
          downgradedBlocks.push(
            `// === ${targetMeta.displayPath}:${targetMeta.effectiveSelector} (omitted — ${effectiveBudgets.budgetLabel} budget; next slice: ${nextCmd}) ===`,
          );
        } else {
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
                `// === ${targetMeta.displayPath} (auto-downgraded to :outline — ${effectiveBudgets.budgetLabel} budget; next slice: ${nextCmd}) ===\n${singleOutline}`,
              );
            } else {
              downgradedBlocks.push(
                `// === ${targetMeta.displayPath} (omitted — ${effectiveBudgets.budgetLabel} budget; next slice: ${nextCmd}) ===`,
              );
            }
          } catch {
            downgradedBlocks.push(
              `// === ${targetMeta.displayPath} (omitted — ${effectiveBudgets.budgetLabel} budget; next slice: ${nextCmd}) ===`,
            );
          }
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
        const hintPrefix =
          options.surface === "cli"
            ? `// Pagination hints (${effectiveBudgets.budgetLabel} stdout ceiling — run in next call):`
            : `// Pagination hints (${effectiveBudgets.budgetLabel} stdout ceiling; pass --full to override):`;
        partsAfterDowngrade.push(
          `${hintPrefix}\n${paginationHints.map((cmd) => `//   ${cmd}`).join("\n")}`,
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

export const read = aiceRead;
