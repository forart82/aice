/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Language Server Protocol (LSP) Specification Types for AIL 2.0.
 * Conforms to LSP 3.17 Specification.
 */

export interface LspPosition {
  line: number; // 0-based
  character: number; // 0-based
}

export type Position = LspPosition;

export interface Range {
  start: LspPosition;
  end: LspPosition;
}

export interface Location {
  uri: string;
  range: Range;
}

export enum DiagnosticSeverity {
  Error = 1,
  Warning = 2,
  Information = 3,
  Hint = 4,
}

export interface Diagnostic {
  range: Range;
  severity?: DiagnosticSeverity;
  code?: string | number;
  source?: string;
  message: string;
}

export interface PublishDiagnosticsParams {
  uri: string;
  version?: number;
  diagnostics: Diagnostic[];
}

export interface MarkupContent {
  kind: "plaintext" | "markdown";
  value: string;
}

export interface Hover {
  contents: MarkupContent | string;
  range?: Range;
}

export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
}

export interface CompletionItem {
  label: string;
  kind?: CompletionItemKind;
  detail?: string;
  documentation?: string | MarkupContent;
  insertText?: string;
}

export interface TextDocumentItem {
  uri: string;
  languageId: string;
  version: number;
  text: string;
}

export interface TextDocumentIdentifier {
  uri: string;
}

export interface VersionedTextDocumentIdentifier extends TextDocumentIdentifier {
  version: number;
}

export interface TextDocumentContentChangeEvent {
  text: string;
}

export interface DidOpenTextDocumentParams {
  textDocument: TextDocumentItem;
}

export interface DidChangeTextDocumentParams {
  textDocument: VersionedTextDocumentIdentifier;
  contentChanges: TextDocumentContentChangeEvent[];
}

export interface HoverParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export interface CompletionParams {
  textDocument: TextDocumentIdentifier;
  position: Position;
}

export enum SymbolKind {
  File = 1,
  Module = 2,
  Namespace = 3,
  Class = 5,
  Method = 6,
  Property = 7,
  Field = 8,
  Constructor = 9,
  Enum = 10,
  Interface = 11,
  Function = 12,
  Variable = 13,
  Constant = 14,
  Struct = 23,
  TypeParameter = 26,
}

export interface DocumentSymbol {
  name: string;
  detail?: string;
  kind: SymbolKind;
  range: Range;
  selectionRange: Range;
  children?: DocumentSymbol[];
}

export interface DocumentSymbolParams {
  textDocument: TextDocumentIdentifier;
}

export interface TextEdit {
  range: Range;
  newText: string;
}

export interface DocumentFormattingParams {
  textDocument: TextDocumentIdentifier;
  options?: {
    tabSize?: number;
    insertSpaces?: boolean;
  };
}

export interface CodeActionParams {
  textDocument: TextDocumentIdentifier;
  range: Range;
  context: {
    diagnostics: Diagnostic[];
  };
}

export interface CodeAction {
  title: string;
  kind?: string;
  diagnostics?: Diagnostic[];
  isPreferred?: boolean;
  edit?: {
    changes: Record<string, TextEdit[]>;
  };
}
