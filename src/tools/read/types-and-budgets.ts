/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ProjectIdiomDefinition, ResolvedPathTargets } from "../../config/index.js";
import type {
  CallerSummary,
  ContextResult,
  DependencyContract,
  WorkspaceCallerScanCache,
} from "../context.js";
import type { OutlineResult } from "../outline.js";

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

export const SINGLE_REGEX_LITERAL_RE = /^\/(?:\\.|\[(?:\\.|[^\]\n])*\]|[^/\\\n])+\/[gimsuy]*$/;
export const LINE_RANGE_SELECTOR_RE = /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i;

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

export function resolveEffectiveReadRawNative(options: ReadOptions): boolean {
  if (options.dsl === true) return false;
  if (options.rawNative !== undefined) return options.rawNative;
  if (options.idioms === true) return false;
  return true;
}

export interface ClassifiedReadTarget {
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
