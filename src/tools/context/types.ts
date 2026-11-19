/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Public and internal TypeScript interfaces/types for the AICE Context Engine.
 */

import type { ProjectIdiomDefinition } from "../../config/index.js";
import type { ImportDecl } from "../../core/ast.js";

export interface WorkspaceCallerScanCache {
  filesByRoot: Map<string, string[]>;
  fileContentByPath: Map<string, string>;
  importsByPath: Map<string, ImportDecl[]>;
  idiomScanByRoot?: Map<
    string,
    { idioms: Record<string, ProjectIdiomDefinition>; zeroIdiomsReason?: string }
  >;
}

export interface ContextOptions {
  /**
   * Dependency traversal depth (default: 1).
   */
  depth?: number;

  /**
   * Explicitly force or skip dependency contract resolution (--deps / --no-deps).
   */
  includeDeps?: boolean;

  /**
   * Enable zero-envelope fast-path on bare files <= 150 lines unless --deps / --callers is passed.
   */
  zeroEnvelopeBareSmallFiles?: boolean;

  /**
   * Scan workspace for downstream importers/callers (default: true on symbol/large-file code reads; false on fast-path).
   */
  includeCallers?: boolean;

  /**
   * If true, emit target outline instead of full source (default: false).
   */
  outlineTarget?: boolean;

  /**
   * Maximum token budget; truncates or bounds context pack if exceeded.
   */
  maxTokens?: number;

  /**
   * Output structured JSON bundle (default: false).
   */
  json?: boolean;

  /**
   * Include token telemetry (default: false).
   */
  stats?: boolean;

  /**
   * Root directory of the project (auto-discovered if omitted).
   */
  projectRoot?: string;

  /**
   * Optional symbol selector (e.g., "fnName" or "ClassName.methodName") for symbol-scoped context.
   */
  symbol?: string;

  /**
   * When true, multi-symbol queries where >=1 symbol matches return found slices plus a
   * `// missing: ...` note instead of throwing (default: false; enabled on multi-target context).
   */
  allowPartialSymbolMatch?: boolean;

  /**
   * Optional override for enabling/disabling project idioms (--idioms / --no-idioms).
   */
  idioms?: boolean;

  /**
   * Optional shared workspace scan cache for multi-file context calls.
   */
  workspaceScanCache?: WorkspaceCallerScanCache;

  /**
   * Emit exact 1-based disk-numbered native source lines (`<lineNo>│ <rawDiskLine>`) on both
   * `file:symbol` (all lengths) and inline bare files (default: false on direct `generateContext()`).
   */
  rawNative?: boolean;

  /**
   * Opt-in AICE shorthand decompilation (`--dsl`); when true, sets `rawNative = false`.
   */
  dsl?: boolean;

  /**
   * Explicit context radius override (`-C` / `--context <lines>`) for pattern searches.
   */
  contextLines?: number;

  /**
   * Optional global stdout byte budget for broad workspace/directory pattern searches.
   */
  maxByteBudget?: number;

  /**
   * Invocation surface (e.g. "cli" | "mcp").
   */
  surface?: "cli" | "mcp";

  /**
   * Explicit full output override (--full).
   */
  full?: boolean;

  /**
   * Human interactive terminal mode where stdout is not constrained to budget ceiling.
   */
  unboundedCli?: boolean;

  /**
   * Internal flag indicating multi-target batch context composition.
   */
  _isMultiTarget?: boolean;
}

export interface DependencyContract {
  specifier: string;
  resolvedPath?: string;
  importedSymbols: string[];
  isExternal: boolean;
  contract: string;
}

export interface CallerSummary {
  filePath: string;
  importedSymbols: string[];
  line: number;
  usedSymbol?: string;
  callSiteLines?: number[];
}

export interface ContextResult {
  targetPath: string;
  targetContent: string;
  targetOutline?: string;
  dependencies: DependencyContract[];
  callers: CallerSummary[];
  formattedBundle: string;
  tokenCount?: number;
  idioms?: Record<string, ProjectIdiomDefinition>;
  nativeDiagnostics?: string;
  zeroIdiomsReason?: "insufficient_repetition" | string;
}

export interface HonestBaselineFileEntry {
  relPath: string;
  rawSource: string;
}

export interface LineSpanWindow {
  s: number;
  e: number;
}

export interface SurgicalWindowResult {
  sliceText: string;
  startLine: number;
  endLine: number;
}

export interface HonestReadBaselineParams {
  rawSource?: string;
  relPath?: string;
  projectRoot?: string;
  workspaceFiles?: readonly HonestBaselineFileEntry[];
  symbolSelector?: string;
  mode?: "file" | "slice" | "search" | "files" | "outline-file" | "outline-dir" | "workspace";
  filePaths?: readonly string[];
  matchedPaths?: readonly string[];
  filesWithMatches?: boolean;
  maxDepth?: number;
  filePattern?: string;
  includeToolWrapper?: boolean;
}

export interface PatternMatchRankingOptions {
  filePath?: string;
  projectRoot?: string;
  isExplicitTestSearch?: boolean;
  full?: boolean;
  dsl?: boolean;
  compactGrouped?: boolean;
}

export interface PatternMatchResult {
  formattedText: string;
  maxScore: number;
}
