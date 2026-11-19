/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE AST Surgical Splice Engine (Step 19).
 * Thin public barrel re-exporting all splice engine submodules.
 */

export {
  dedentCode,
  findSpliceTargetSymbol,
  generateUnifiedDiff,
  getLineEnd,
  getNodeEndOffset,
  getStatementEndOffset,
  indentCode,
} from "./splice/ast-helpers.js";
export {
  splice,
  spliceBatch,
  spliceSource,
} from "./splice/batch.js";
export {
  applyHunksToScope,
  buildEmptySpliceBlockError,
  containsHunkMarkers,
  extractHunkBlocks,
  stripNumberedGutterPrefixes,
} from "./splice/hunks.js";
export { spliceNativeSymbolFromExpandedAst } from "./splice/native-ast-splice.js";
export { spliceNativeSource } from "./splice/native-orchestrator.js";
export {
  inferSnippetParamArity,
  locateNativeDeclarationSpan,
} from "./splice/span-locators.js";
export {
  isCreateOrOverwriteSymbol,
  parseMultiBlockSpliceStream,
  splitInlineFileSelector,
} from "./splice/stream-parser.js";
export {
  extractNativeTestBlocks,
  extractScriptOrMarkdownSymbols,
  locateImportBlockSpan,
  locateScriptOrMarkdownSpan,
  matchNativeTestBlockSpan,
} from "./splice/ts-and-script-spans.js";
export type {
  BatchSpliceItem,
  BatchSpliceOptions,
  BatchSpliceResult,
  HunkBlock,
  NativeSpanInfo,
  NativeTestBlockInfo,
  ParsedMultiBlockSpliceStream,
  ScriptOrMarkdownSymbolInfo,
  SpliceNode,
  SpliceOptions,
  SpliceResult,
  SymbolSpliceEdit,
  TargetSymbolInfo,
} from "./splice/types.js";
