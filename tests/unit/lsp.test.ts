/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Language Server Protocol (LSP) Daemon (Phase 2.3).
 */

import { PassThrough } from "node:stream";
import { describe, expect, it } from "vitest";
import { AiceAnalyzer } from "../../src/lsp/analyzer.js";
import { JsonRpcConnection } from "../../src/lsp/jsonrpc.js";
import { AiceLspServer } from "../../src/lsp/server.js";

describe("JSON-RPC 2.0 Framing & Transport", () => {
  it("frames and un-frames single and chunked JSON-RPC messages", () => {
    const inStream = new PassThrough();
    const conn = new JsonRpcConnection(inStream);

    interface TestRpcMessage {
      id?: number;
      method?: string;
      params?: Record<string, unknown>;
    }
    const received: TestRpcMessage[] = [];
    conn.on("message", (msg) => received.push(msg as TestRpcMessage));

    const payload = JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "test",
      params: { foo: "bar" },
    });
    const frame = `Content-Length: ${Buffer.byteLength(payload)}\r\n\r\n${payload}`;

    // Send half of the frame first
    inStream.write(Buffer.from(frame.slice(0, 20)));
    expect(received).toHaveLength(0);

    // Send the remainder
    inStream.write(Buffer.from(frame.slice(20)));
    expect(received).toHaveLength(1);
    expect(received[0].id).toBe(1);
    expect(received[0].method).toBe("test");
    expect(received[0].params?.foo).toBe("bar");
  });
});

describe("AICE In-Memory Document Analyzer", () => {
  it("returns zero diagnostics for valid AICE code", () => {
    const analyzer = new AiceAnalyzer();
    const validCode = `
module app/calc

fn add(a:int, b:int) -> int:
  ret a + b
`;
    const diags = analyzer.setDocument("file:///calc.aice", validCode);
    expect(diags).toHaveLength(0);
  });

  it("returns actionable diagnostic with code and range for invalid syntax/types", () => {
    const analyzer = new AiceAnalyzer();
    const invalidCode = `
module app/error

fn test():
  let x:int = "hello"
`;
    const diags = analyzer.setDocument("file:///error.aice", invalidCode);
    expect(diags.length).toBeGreaterThan(0);
    expect(diags[0].severity).toBe(1); // Error
    expect(diags[0].code).toContain("AICE_E");
    expect(diags[0].range.start.line).toBeGreaterThanOrEqual(0);
  });

  it("provides hover cards for primitive types and keywords", () => {
    const analyzer = new AiceAnalyzer();
    const code = `
module app/hover

fn greet(name:str) -> void:
  ret
`;
    analyzer.setDocument("file:///hover.aice", code);

    // Hover over 'str'
    const hoverStr = analyzer.getHover("file:///hover.aice", { line: 3, character: 15 });
    expect(hoverStr).toBeDefined();
    const content =
      typeof hoverStr?.contents === "string" ? hoverStr.contents : hoverStr?.contents.value;
    expect(content).toContain("Primitive Type `str`");

    // Hover over 'fn'
    const hoverFn = analyzer.getHover("file:///hover.aice", { line: 3, character: 1 });
    expect(hoverFn).toBeDefined();
    const fnContent =
      typeof hoverFn?.contents === "string" ? hoverFn.contents : hoverFn?.contents.value;
    expect(fnContent).toContain("Keyword `fn`");
  });

  it("provides contextual autocompletions for keywords, types, and dot methods", () => {
    const analyzer = new AiceAnalyzer();
    const code = `
module app/complete

fn test(s:str):
  let len = s.
`;
    analyzer.setDocument("file:///complete.aice", code);

    // Dot-completion after 's.'
    const dotCompletions = analyzer.getCompletions("file:///complete.aice", {
      line: 4,
      character: 14,
    });
    const labels = dotCompletions.map((c) => c.label);
    expect(labels).toContain("slice");
    expect(labels).toContain("length");
    expect(labels).toContain("trim");

    // General completion
    const topCompletions = analyzer.getCompletions("file:///complete.aice", {
      line: 2,
      character: 0,
    });
    const topLabels = topCompletions.map((c) => c.label);
    expect(topLabels).toContain("fn");
    expect(topLabels).toContain("type");
    expect(topLabels).toContain("int");
    expect(topLabels).toContain("str");
  });
});

describe("AICE LSP Server Handshake & Lifecycle", () => {
  it("responds to initialize request with server capabilities", async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    new AiceLspServer(inStream, outStream);

    const clientConn = new JsonRpcConnection(outStream, inStream);

    const responsePromise = new Promise<{
      capabilities: {
        hoverProvider: boolean;
        completionProvider?: unknown;
        textDocumentSync: number;
      };
      serverInfo: { name: string; version: string };
    }>((resolve) => {
      clientConn.on("message", (msg) => {
        if (msg.id === 10) resolve(msg.result as never);
      });
    });

    clientConn.sendMessage({
      jsonrpc: "2.0",
      id: 10,
      method: "initialize",
      params: { capabilities: {} },
    });

    const result = await responsePromise;
    expect(result.capabilities.hoverProvider).toBe(true);
    expect(result.capabilities.completionProvider).toBeDefined();
    expect(result.capabilities.textDocumentSync).toBe(1);
    expect(result.serverInfo.name).toBe("aice-lsp");
  });

  it("publishes diagnostics on textDocument/didOpen", async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    new AiceLspServer(inStream, outStream);

    const clientConn = new JsonRpcConnection(outStream, inStream);

    const diagPromise = new Promise<{
      uri: string;
      diagnostics: Array<{ code: string; message: string }>;
    }>((resolve) => {
      clientConn.on("message", (msg) => {
        if (msg.method === "textDocument/publishDiagnostics") {
          resolve(msg.params as never);
        }
      });
    });

    clientConn.sendNotification("textDocument/didOpen", {
      textDocument: {
        uri: "file:///test.aice",
        languageId: "aice",
        version: 1,
        text: `module test\n\nfn foo():\n  let x:int = "broken"`,
      },
    });

    const params = await diagPromise;
    expect(params.uri).toBe("file:///test.aice");
    expect(params.diagnostics.length).toBeGreaterThan(0);
    expect(params.diagnostics[0].code).toContain("AICE_E");
  });

  it("handles textDocument/definition request", async () => {
    const inStream = new PassThrough();
    const outStream = new PassThrough();
    const server = new AiceLspServer(inStream, outStream);

    server.analyzer.setDocument(
      "file:///def.aice",
      "module test\n\nfn myTargetFunc(a:int) -> int:\n  ret a\n\nfn caller():\n  myTargetFunc(1)"
    );

    const clientConn = new JsonRpcConnection(outStream, inStream);

    const defPromise = new Promise<{ uri: string; range: { start: { line: number } } } | null>(
      (resolve) => {
        clientConn.on("message", (msg) => {
          if (msg.id === 20) resolve(msg.result as never);
        });
      }
    );

    clientConn.sendMessage({
      jsonrpc: "2.0",
      id: 20,
      method: "textDocument/definition",
      params: {
        textDocument: { uri: "file:///def.aice" },
        position: { line: 6, character: 4 },
      },
    });

    const result = await defPromise;
    expect(result).toBeDefined();
    expect(result?.uri).toBe("file:///def.aice");
    expect(result?.range.start.line).toBe(2);
  });
});

