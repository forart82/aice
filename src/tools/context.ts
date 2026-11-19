/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE AI Context Packager Engine (Step 20).
 * Thin public barrel re-exporting cohesive context engine submodules.
 */

export {
  generateWorkspaceContext,
  scanDirectoryForTargets,
} from "./context/callers-and-workspace.js";
export {
  compileFocusPattern,
  detectContiguousImportBlock,
  extractSymbolFocusSlice,
  extractSymbolFromAiceSource,
  formatCompactBareFileSource,
  formatLargeLineRangeWithElision,
  isDecorativeDividerComment,
  parseSymbolPatternSelector,
} from "./context/focus-and-elision.js";
export {
  computeHonestReadBaselineText,
  computeLineRangeBaselineText,
  computeRegexBaselineText,
  computeRegexContextBaselineText,
  normalizeGrepBreAlternation,
} from "./context/honest-baseline.js";
export {
  buildSiblingOutline,
  extractImportsFromFile,
  resolveFirstActionableSymbol,
  resolveImportPath,
  splitSymbolSelectors,
} from "./context/imports-and-deps.js";
export {
  generateContext,
  generateMultiContext,
  packageContext,
  packContext,
} from "./context/orchestrator.js";
export {
  doesFileStemMatchQuery,
  extractPatternMatchesDetailed,
  extractPrimaryQueryKeyword,
  isCommentLine,
  isDeclarationLine,
  isExactDefinitionLine,
  isTestOrMockPath,
} from "./context/pattern-search.js";
export {
  mergeMultiContextResults,
  parseTargetWithInlineSymbol,
  splitContextTargets,
} from "./context/targets-and-merge.js";
export type {
  CallerSummary,
  ContextOptions,
  ContextResult,
  DependencyContract,
  HonestBaselineFileEntry,
  HonestReadBaselineParams,
  PatternMatchRankingOptions,
  PatternMatchResult,
  WorkspaceCallerScanCache,
} from "./context/types.js";
