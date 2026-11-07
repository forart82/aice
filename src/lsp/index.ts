/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Language Server Protocol (LSP) Daemon Exports.
 */

export * from "./analyzer.js";
export * from "./jsonrpc.js";
export type {
  CodeAction,
  CodeActionParams,
  CompletionItem,
  CompletionParams,
  Diagnostic,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  DocumentFormattingParams,
  DocumentSymbol,
  DocumentSymbolParams,
  Hover,
  HoverParams,
  Location,
  LspPosition,
  MarkupContent,
  PublishDiagnosticsParams,
  Range,
  TextDocumentContentChangeEvent,
  TextDocumentIdentifier,
  TextDocumentItem,
  TextEdit,
  VersionedTextDocumentIdentifier,
} from "./protocol.js";
export {
  CompletionItemKind,
  DiagnosticSeverity,
  SymbolKind,
} from "./protocol.js";
export * from "./server.js";
