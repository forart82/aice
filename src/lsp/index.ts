/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Language Server Protocol (LSP) Daemon Exports.
 */

export * from "./analyzer.js";
export * from "./jsonrpc.js";
export type {
  CompletionItem,
  CompletionParams,
  Diagnostic,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
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
  VersionedTextDocumentIdentifier,
} from "./protocol.js";
export {
  CompletionItemKind,
  DiagnosticSeverity,
} from "./protocol.js";
export * from "./server.js";
