/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Language Server Protocol (LSP) Daemon for AIL 2.0.
 * Conforms to Microsoft LSP 3.17 protocol over JSON-RPC 2.0 stdio streams.
 */

import type { Readable, Writable } from "node:stream";
import { AilAnalyzer } from "./analyzer.js";
import { JsonRpcConnection, type JsonRpcMessage } from "./jsonrpc.js";
import type {
  CompletionParams,
  DidChangeTextDocumentParams,
  DidOpenTextDocumentParams,
  HoverParams,
  PublishDiagnosticsParams,
  TextDocumentIdentifier,
} from "./protocol.js";

export class AilLspServer {
  public connection: JsonRpcConnection;
  public analyzer: AilAnalyzer;
  private isShutdown = false;

  constructor(inStream: Readable = process.stdin, outStream: Writable = process.stdout) {
    this.connection = new JsonRpcConnection(inStream, outStream);
    this.analyzer = new AilAnalyzer();

    this.connection.on("message", (msg: JsonRpcMessage) => this.handleMessage(msg));
  }

  public handleMessage(msg: JsonRpcMessage): void {
    if ("method" in msg) {
      if ("id" in msg && msg.id !== undefined) {
        // Request
        this.handleRequest(msg.id, msg.method, msg.params);
      } else {
        // Notification
        this.handleNotification(msg.method, msg.params);
      }
    }
  }

  private handleRequest(id: number | string, method: string, params: unknown): void {
    if (this.isShutdown && method !== "exit") {
      this.connection.sendError(id, -32600, "Server is shut down");
      return;
    }

    switch (method) {
      case "initialize": {
        this.connection.sendResponse(id, {
          capabilities: {
            textDocumentSync: 1, // Full document sync
            hoverProvider: true,
            completionProvider: {
              triggerCharacters: [".", ":", " "],
              resolveProvider: false,
            },
          },
          serverInfo: {
            name: "ail-lsp",
            version: "2.0.0",
          },
        });
        break;
      }

      case "textDocument/hover": {
        const hoverParams = params as HoverParams;
        const hover = this.analyzer.getHover(hoverParams.textDocument.uri, hoverParams.position);
        this.connection.sendResponse(id, hover);
        break;
      }

      case "textDocument/completion": {
        const compParams = params as CompletionParams;
        const completions = this.analyzer.getCompletions(
          compParams.textDocument.uri,
          compParams.position,
        );
        this.connection.sendResponse(id, completions);
        break;
      }

      case "shutdown": {
        this.isShutdown = true;
        this.connection.sendResponse(id, null);
        break;
      }

      default: {
        this.connection.sendError(id, -32601, `Method not found: ${method}`);
        break;
      }
    }
  }

  private handleNotification(method: string, params: unknown): void {
    switch (method) {
      case "initialized": {
        // Client confirmed initialization
        break;
      }

      case "textDocument/didOpen": {
        const didOpen = params as DidOpenTextDocumentParams;
        const diagnostics = this.analyzer.setDocument(
          didOpen.textDocument.uri,
          didOpen.textDocument.text,
        );
        this.publishDiagnostics(didOpen.textDocument.uri, diagnostics);
        break;
      }

      case "textDocument/didChange": {
        const didChange = params as DidChangeTextDocumentParams;
        const fullText = didChange.contentChanges[0]?.text ?? "";
        const diagnostics = this.analyzer.setDocument(didChange.textDocument.uri, fullText);
        this.publishDiagnostics(didChange.textDocument.uri, diagnostics);
        break;
      }

      case "textDocument/didClose": {
        const didClose = params as { textDocument: TextDocumentIdentifier };
        this.analyzer.removeDocument(didClose.textDocument.uri);
        this.publishDiagnostics(didClose.textDocument.uri, []);
        break;
      }

      case "exit": {
        process.exit(this.isShutdown ? 0 : 1);
        break;
      }
    }
  }

  private publishDiagnostics(
    uri: string,
    diagnostics: PublishDiagnosticsParams["diagnostics"],
  ): void {
    this.connection.sendNotification("textDocument/publishDiagnostics", {
      uri,
      diagnostics,
    });
  }
}
