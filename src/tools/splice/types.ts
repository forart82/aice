/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Shared public and internal types/interfaces for the AICE surgical splice engine.
 */

import type { ProjectIdiomDefinition } from "../../config/index.js";
import type {
  ClassDecl,
  EnumVariantDecl,
  FieldDecl,
  MethodDecl,
  ModuleItem,
  PropertyDecl,
  Statement,
  TypeDecl,
} from "../../core/ast.js";
import type { TargetLanguage } from "../../emitters/index.js";
import type { TelemetrySurface } from "../../telemetry/index.js";

export interface SymbolSpliceEdit {
  /** Identifier of target symbol (e.g., 'calculate', 'GameEngine.step', '.btn-primary') */
  symbol: string;
  /** Replacement AICE, hybrid, or native code snippet */
  code?: string;
  /** If set, replaces only the body/statements of the function/method */
  body?: string;
  /** If true, removes the symbol entirely */
  delete?: boolean;
  /** Inserts the new code directly after this symbol */
  insertAfter?: string;
  /** Inserts the new code directly before this symbol */
  insertBefore?: string;
  /** Clone source symbol */
  cloneFrom?: string;
  /** Whether to preserve original doc comments / JSDocs */
  preserveDocs?: boolean;
  /** Aliases for code in JSON payloads */
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
  replacement?: string;
  insert_after?: string;
  insert_before?: string;
}

export interface SpliceOptions {
  symbol?: string;
  code?: string;
  /** Optional file path to read AICE/hybrid/native payload from (--from <file>) */
  from?: string;
  body?: string;
  delete?: boolean;
  insertAfter?: string;
  insertBefore?: string;
  cloneFrom?: string;
  preserveDocs?: boolean;
  append?: boolean;
  edits?: SymbolSpliceEdit[];
  create?: boolean;
  /** Allow full-file overwrite (including intentional empty truncation or >25-line replacement) */
  overwrite?: boolean;
  /** Force overwrite or bypass differential syntax guard when requested */
  force?: boolean;
  /** Boolean toggle or inline idiom definitions for full CreateFileOptions compatibility */
  idioms?: boolean | string | string[] | Record<string, string | ProjectIdiomDefinition>;
  inlineIdioms?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  idiom?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  inPlace?: boolean;
  dryRun?: boolean;
  diff?: boolean;
  compile?: boolean;
  projectRoot?: string;
  surface?: TelemetrySurface;
  targetLanguage?: TargetLanguage;
  sourceOverride?: string;
  suppressTelemetry?: boolean;
  /** Payload aliases for full BatchCreateItem / CreateFileOptions / MCP compatibility */
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
  replacement?: string;
}

export interface BatchSpliceItem extends SpliceOptions {
  filePath: string;
  file?: string;
  path?: string;
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
  replacement?: string;
  insert_after?: string;
  insert_before?: string;
}

export interface BatchSpliceOptions {
  projectRoot?: string;
  code?: string;
  from?: string;
  dryRun?: boolean;
  compile?: boolean;
  idioms?: boolean | string | string[] | Record<string, string | ProjectIdiomDefinition>;
  inlineIdioms?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  idiom?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  overwrite?: boolean;
  force?: boolean;
  preserveDocs?: boolean;
  surface?: TelemetrySurface;
  targetLanguage?: TargetLanguage;
}

export interface BatchSpliceResult {
  success: boolean;
  results: SpliceResult[];
  modifiedFiles: string[];
  createdFiles?: string[];
  totalFiles?: number;
  totalEdits: number;
  totalNativeTokens?: number;
  totalAiceTokens?: number;
  totalTokensSaved?: number;
}

export interface SpliceResult {
  success: boolean;
  filePath: string;
  symbol?: string;
  startLine?: number;
  endLine?: number;
  originalSnippet?: string;
  newSnippet?: string;
  diff?: string;
  modifiedCode: string;
  newFileContent?: string;
  newAiceSource: string;
  content?: string;
  nativeCode?: string;
  aiceInput?: string;
  language?: string;
  targetLanguage?: TargetLanguage;
  declaredIdioms?: Record<string, ProjectIdiomDefinition>;
  persistedIdioms?: string[];
  idiomsUsed?: boolean;
  nativeTokens?: number;
  aiceTokens?: number;
  tokensSaved?: number;
  preservedTriviaTokens?: number;
  realisticTokensSaved?: number;
  dryRun?: boolean;
}

export interface TargetSymbolInfo {
  name: string;
  parent?: ClassDecl | TypeDecl;
  node: ModuleItem | MethodDecl | PropertyDecl | FieldDecl | EnumVariantDecl | Statement;
  kind:
    | "function"
    | "class"
    | "type"
    | "enum"
    | "const"
    | "var"
    | "component"
    | "style"
    | "method"
    | "property"
    | "field"
    | "variant"
    | "statement";
}

export type SpliceNode =
  | ModuleItem
  | MethodDecl
  | PropertyDecl
  | FieldDecl
  | EnumVariantDecl
  | Statement;

export interface NativeSpanInfo {
  declStart: number;
  fullDeclStart?: number;
  propsDeclStart?: number;
  propsFullDeclStart?: number;
  declEnd: number;
  startOffset?: number;
  endOffset?: number;
  startLine?: number;
  endLine?: number;
  tokenStart: number;
  declIndent: string;
  className?: string;
  memberName: string;
  visibility?: "public" | "private" | "protected";
  isExported?: boolean;
  isStatic?: boolean;
  isAsync?: boolean;
  accessor?: "get" | "set";
  goReceiver?: string;
  cppOutOfLine?: boolean;
  isClassContainer?: boolean;
  origHeader?: string;
}

export interface NativeTestBlockInfo {
  runnerKind: "describe" | "test" | "it";
  outlineKind: "describe" | "test";
  title: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  indent: string;
  spanInfo: NativeSpanInfo;
}

export interface ScriptOrMarkdownSymbolInfo {
  kind: "function" | "label" | "section";
  name: string;
  displaySignature: string;
  startLine: number;
  endLine: number;
  startOffset: number;
  endOffset: number;
  indent: string;
  headingLevel?: number;
  rawHeadingLine?: string;
}

export interface ResolvedNativeEdit {
  symbol: string;
  startOffset: number;
  endOffset: number;
  replacement: string;
  originalSnippet: string;
  newSnippet: string;
  isInsertion?: boolean;
  preservedTriviaText?: string;
}

export interface HunkBlock {
  search: string;
  replace: string;
}

export interface ParsedMultiBlockSpliceStream {
  singleFileEdits?: SymbolSpliceEdit[];
  batchItems?: BatchSpliceItem[];
}
