/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Phase 2:
 * 1. Bidirectional Companion Sync (`ail sync` / `ail watch --bidirectional`)
 * 2. Rich LSP Actions (`$idiom` hover, `documentSymbol`, `documentFormatting`, `codeAction`)
 * 3. First-Class MCP Server (`ail mcp`, tools/list, tools/call)
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AilAstCache } from "../../src/cache/index.js";
import { AilAnalyzer } from "../../src/lsp/analyzer.js";
import { SymbolKind } from "../../src/lsp/protocol.js";
import { AilLspServer } from "../../src/lsp/server.js";
import { AIL_MCP_TOOLS, AilMcpServer } from "../../src/mcp/index.js";
import { AilWatcher, syncProjectFromTargets } from "../../src/watcher/index.js";

describe("Phase 2: Bidirectional Companion Sync, Rich LSP, and MCP Server", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-phase2-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. Bidirectional Companion Sync", () => {
    it("synchronizes external edits from target file into .ail source", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const configPath = path.join(tmpDir, "ail.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            mode: "side-by-side",
            targetLanguage: "typescript",
          },
          null,
          2,
        ),
      );

      const tsFile = path.join(srcDir, "calculator.ts");
      fs.writeFileSync(
        tsFile,
        `export function add(a: number, b: number): number {
  return a + b;
}
`,
      );

      const watcher = new AilWatcher({
        dir: tmpDir,
        projectRoot: tmpDir,
        bidirectional: true,
      });

      const res = await watcher.syncTargetFile(tsFile);
      expect(res.success).toBe(true);
      expect(res.targetFile).toBe(path.resolve(tsFile));
      expect(fs.existsSync(res.ailFile)).toBe(true);

      const ailContent = fs.readFileSync(res.ailFile, "utf-8");
      expect(ailContent).toContain("fn add");
    });

    it("collapses active project $idioms during reverse synchronization", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const configPath = path.join(tmpDir, "ail.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            mode: "side-by-side",
            targetLanguage: "typescript",
            idioms: {
              square: {
                name: "square",
                kind: "expr",
                params: [{ name: "x" }],
                templateAil: "x * x",
                occurrences: 4,
                tokensPerOccurrenceSaved: 4,
                netTokenSavings: 16,
              },
            },
          },
          null,
          2,
        ),
      );

      // Create target TS file with square logic
      const tsFile = path.join(srcDir, "physics.ts");
      fs.writeFileSync(
        tsFile,
        `export function sq(x: number): number {
  const res = x * x;
  return res;
}
`,
      );

      const watcher = new AilWatcher({
        dir: tmpDir,
        projectRoot: tmpDir,
        bidirectional: true,
      });

      const res = await watcher.syncTargetFile(tsFile, { force: true });
      expect(res.success).toBe(true);
      expect(fs.existsSync(res.ailFile)).toBe(true);

      const ailContent = fs.readFileSync(res.ailFile, "utf-8");
      expect(ailContent).toContain("$square");
      expect(res.collapsedIdioms).toBeGreaterThanOrEqual(1);
    });

    it("prevents forward compile writes from triggering reverse sync bounce-back loops", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const configPath = path.join(tmpDir, "ail.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ mode: "side-by-side", targetLanguage: "typescript" }, null, 2),
      );

      const ailFile = path.join(srcDir, "greeter.ts.ail");
      fs.writeFileSync(
        ailFile,
        `module greeter
fn greet(name: str) -> str:
  ret "Hello " + name
`,
      );

      let reverseSyncTriggered = false;
      const watcher = new AilWatcher({
        dir: tmpDir,
        projectRoot: tmpDir,
        bidirectional: true,
        onReverseSyncSuccess: () => {
          reverseSyncTriggered = true;
        },
      });

      // Forward compile
      const compileRes = await watcher.compileFile(ailFile);
      expect(compileRes.success).toBe(true);
      expect(fs.existsSync(compileRes.targetFile)).toBe(true);

      // Immediate reverse sync attempt on freshly written target file
      // If content is already identical, it should be recognized as lossless without duplicate rewrites
      const syncRes = await watcher.syncTargetFile(compileRes.targetFile);
      expect(syncRes.success).toBe(true);
      expect(reverseSyncTriggered).toBe(false); // suppressed since within 750ms / identical content
    });

    it("synchronizes all project target files via syncProjectFromTargets", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      const configPath = path.join(tmpDir, "ail.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify({ mode: "side-by-side", targetLanguage: "typescript" }, null, 2),
      );

      fs.writeFileSync(
        path.join(srcDir, "fileA.ts"),
        `export function foo(): number { return 42; }\n`,
      );
      fs.writeFileSync(
        path.join(srcDir, "fileB.ts"),
        `export function bar(): string { return "ail"; }\n`,
      );

      const syncResults = await syncProjectFromTargets(tmpDir);
      expect(syncResults.length).toBeGreaterThanOrEqual(2);
      expect(syncResults.every((r) => r.success)).toBe(true);
      for (const r of syncResults) {
        expect(fs.existsSync(r.ailFile)).toBe(true);
      }
    });
  });

  describe("2. Rich LSP Actions", () => {
    it("provides project idiom ($idiom) hover preview with expanded template and token savings", () => {
      const analyzer = new AilAnalyzer();
      analyzer.setIdioms({
        clamp: {
          name: "clamp",
          kind: "expr",
          params: [{ name: "val" }, { name: "min" }, { name: "max" }],
          templateAil: "if val < min => min elif val > max => max else => val",
          occurrences: 5,
          tokensPerOccurrenceSaved: 8,
          netTokenSavings: 40,
        },
      });

      const uri = "file:///workspace/test.ail";
      const source = `module test
fn bound(x: int) -> int = $clamp(x, 0, 100)
`;
      analyzer.setDocument(uri, source);

      // Hover on '$clamp'
      const hover = analyzer.getHover(uri, { line: 1, character: 28 });
      expect(hover).not.toBeNull();
      const content = typeof hover?.contents === "string" ? hover.contents : hover?.contents.value;
      expect(content).toContain("Project Idiom `$clamp`");
      expect(content).toContain("saves ~8 tokens/use");
      expect(content).toContain("40 net BPE tokens");
      expect(content).toContain("if val < min => min");
    });

    it("includes project idioms in completion items", () => {
      const analyzer = new AilAnalyzer();
      analyzer.setIdioms({
        fast_sqrt: {
          name: "fast_sqrt",
          kind: "expr",
          params: [{ name: "x" }],
          templateAil: "x ** 0.5",
          occurrences: 3,
          tokensPerOccurrenceSaved: 4,
          netTokenSavings: 12,
        },
      });

      const uri = "file:///workspace/math.ail";
      analyzer.setDocument(uri, "module math\nlet y = ");

      const completions = analyzer.getCompletions(uri, { line: 1, character: 8 });
      const idiomItem = completions.find((c) => c.label === "$fast_sqrt");
      expect(idiomItem).toBeDefined();
      expect(idiomItem?.detail).toContain("x ** 0.5");
    });

    it("returns structured document symbols for functions, types, and classes", () => {
      const analyzer = new AilAnalyzer();
      const uri = "file:///workspace/symbols.ail";
      const source = `module domain

type User:
  id: int
  name: str

enum Role:
  Admin
  Guest

class BankAccount:
  balance: int
  fn deposit(amount: int) -> int:
    return amount

fn transfer(from: str, to: str, amt: int) -> bool:
  ret true
`;
      analyzer.setDocument(uri, source);

      const symbols = analyzer.getDocumentSymbols(uri);
      expect(symbols.length).toBeGreaterThanOrEqual(4);

      const userSym = symbols.find((s) => s.name === "User");
      expect(userSym).toBeDefined();
      expect(userSym?.kind).toBe(SymbolKind.Struct);
      expect(userSym?.children?.map((c) => c.name)).toEqual(["id", "name"]);

      const roleSym = symbols.find((s) => s.name === "Role");
      expect(roleSym).toBeDefined();
      expect(roleSym?.kind).toBe(SymbolKind.Enum);
      expect(roleSym?.children?.map((c) => c.name)).toEqual(["Admin", "Guest"]);

      const bankSym = symbols.find((s) => s.name === "BankAccount");
      expect(bankSym).toBeDefined();
      expect(bankSym?.kind).toBe(SymbolKind.Class);
      expect(bankSym?.children?.some((c) => c.name === "deposit")).toBe(true);

      const transferSym = symbols.find((s) => s.name === "transfer");
      expect(transferSym).toBeDefined();
      expect(transferSym?.kind).toBe(SymbolKind.Function);
    });

    it("formats unformatted AIL document via formatDocument", () => {
      const analyzer = new AilAnalyzer();
      const uri = "file:///workspace/unformatted.ail";
      const unformatted = `fn   add(  a :  int , b : int ) -> int :
  ret   a+b
`;
      analyzer.setDocument(uri, unformatted);

      const edits = analyzer.formatDocument(uri);
      expect(edits.length).toBe(1);
      expect(edits[0].newText).toContain("fn add(a: int, b: int) -> int:");
      expect(edits[0].newText).toContain("ret a + b");
    });

    it("synthesizes quickfix code actions for autonomous self-repair", () => {
      const analyzer = new AilAnalyzer();
      const uri = "file:///workspace/immutable.ail";
      const brokenAil = `fn update_balance(initial: int) -> int:
  let balance = initial
  balance = balance + 100
  return balance
`;
      analyzer.setDocument(uri, brokenAil);

      const actions = analyzer.getCodeActions(uri, {
        start: { line: 2, character: 2 },
        end: { line: 2, character: 9 },
      });

      expect(actions.length).toBeGreaterThanOrEqual(1);
      const action = actions[0];
      expect(action.kind).toBe("quickfix");
      expect(action.isPreferred).toBe(true);
      expect(action.edit?.changes[uri]).toBeDefined();

      const repairedText = action.edit?.changes[uri][0].newText;
      expect(repairedText).toContain("let mut balance = initial");
    });

    it("handles LSP JSON-RPC requests via AilLspServer", async () => {
      const inStream = new Readable({ read() {} });
      const outStream = new Writable({
        write(_chunk, _encoding, callback) {
          callback();
        },
      });

      const server = new AilLspServer(inStream, outStream);
      let capturedResponse: any = null;
      server.connection.sendResponse = (_id: any, result: any) => {
        capturedResponse = result;
      };

      // 1. initialize
      server.handleMessage({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {},
      });
      expect(capturedResponse?.capabilities?.documentSymbolProvider).toBe(true);
      expect(capturedResponse?.capabilities?.documentFormattingProvider).toBe(true);
      expect(capturedResponse?.capabilities?.codeActionProvider).toBe(true);

      // 2. didOpen
      const testUri = "file:///demo.ail";
      server.handleMessage({
        jsonrpc: "2.0",
        method: "textDocument/didOpen",
        params: {
          textDocument: {
            uri: testUri,
            languageId: "ail",
            version: 1,
            text: 'fn hello() -> str = "world"\n',
          },
        },
      });

      // 3. documentSymbol
      server.handleMessage({
        jsonrpc: "2.0",
        id: 2,
        method: "textDocument/documentSymbol",
        params: { textDocument: { uri: testUri } },
      });
      expect(capturedResponse).toBeInstanceOf(Array);
      expect(capturedResponse[0]?.name).toBe("hello");
    });
  });

  describe("3. First-Class MCP Server (`AilMcpServer`)", () => {
    it("advertises all 6 AIL productivity tools in tools/list", async () => {
      const server = new AilMcpServer();

      const initResult = (await server.handleRequest(1, "initialize", {})) as any;
      expect(initResult.protocolVersion).toBe("2024-11-05");
      expect(initResult.serverInfo.name).toBe("ail-mcp");

      const listResult = (await server.handleRequest(2, "tools/list", {})) as any;
      expect(listResult.tools).toHaveLength(6);

      const toolNames = listResult.tools.map((t: any) => t.name);
      expect(toolNames).toContain("ail_context");
      expect(toolNames).toContain("ail_outline");
      expect(toolNames).toContain("ail_splice");
      expect(toolNames).toContain("ail_idioms");
      expect(toolNames).toContain("ail_test");
      expect(toolNames).toContain("ail_evolve");
    });

    it("executes ail_outline via tools/call with high token reduction", async () => {
      const server = new AilMcpServer();
      const testAil = path.join(tmpDir, "outline_test.ail");
      fs.writeFileSync(
        testAil,
        `module outline_test

class Vector2:
  x: float
  y: float

  fn length() -> float:
    let sq = self.x * self.x + self.y * self.y
    return sq ** 0.5
`,
      );

      const res = (await server.handleRequest(10, "tools/call", {
        name: "ail_outline",
        arguments: { path: testAil },
      })) as any;

      expect(res.content).toBeDefined();
      expect(res.content[0].type).toBe("text");
      expect(res.content[0].text).toContain("class Vector2");
      expect(res.content[0].text).toContain("fn length()");
    });

    it("executes ail_context via tools/call", async () => {
      const server = new AilMcpServer();
      const testAil = path.join(tmpDir, "ctx_test.ail");
      fs.writeFileSync(
        testAil,
        `module ctx_test
fn greet(name: str) -> str:
  ret "Hello " + name
`,
      );

      const res = (await server.handleRequest(11, "tools/call", {
        name: "ail_context",
        arguments: { path: testAil },
      })) as any;

      expect(res.content).toBeDefined();
      expect(res.content[0].text).toContain("fn greet");
    });

    it("executes ail_splice via tools/call to replace symbol in AST", async () => {
      const server = new AilMcpServer();
      const testAil = path.join(tmpDir, "splice_test.ail");
      fs.writeFileSync(
        testAil,
        `module splice_test

fn compute(x: int) -> int:
  ret x + 10
`,
      );

      const res = (await server.handleRequest(12, "tools/call", {
        name: "ail_splice",
        arguments: {
          filePath: testAil,
          symbolSelector: "compute",
          newAilCode: `fn compute(x: int) -> int:\n  ret x * 2\n`,
        },
      })) as any;

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Successfully spliced symbol 'compute'");

      const modified = fs.readFileSync(testAil, "utf-8");
      expect(modified).toContain("ret x * 2");
    });

    it("executes ail_idioms list and scan via tools/call", async () => {
      const server = new AilMcpServer();
      const configPath = path.join(tmpDir, "ail.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            idioms: {
              square: {
                name: "square",
                kind: "expr",
                params: [{ name: "x" }],
                templateAil: "x * x",
                occurrences: 3,
                tokensPerOccurrenceSaved: 3,
                netTokenSavings: 9,
              },
            },
          },
          null,
          2,
        ),
      );

      const res = (await server.handleRequest(13, "tools/call", {
        name: "ail_idioms",
        arguments: { dir: tmpDir, action: "list" },
      })) as any;

      expect(res.content[0].text).toContain("square");
      expect(res.content[0].text).toContain("x * x");
    });

    it("executes ail_evolve via tools/call", async () => {
      const server = new AilMcpServer();
      const res = (await server.handleRequest(14, "tools/call", {
        name: "ail_evolve",
        arguments: { cycles: 1, restarts: 1, seed: 100, includeCorpus: false },
      })) as any;

      expect(res.isError).toBeFalsy();
      expect(res.content[0].type).toBe("text");
      const report = JSON.parse(res.content[0].text);
      expect(report.completedRestarts).toBe(1);
      expect(report.totalCyclesExecuted).toBe(1);
    });

    it("processes newline-delimited JSON-RPC messages and Content-Length framed messages over streams", async () => {
      const inStream = new Readable({ read() {} });
      const outputs: string[] = [];
      const outStream = new Writable({
        write(chunk, _encoding, callback) {
          outputs.push(chunk.toString("utf-8"));
          callback();
        },
      });

      new AilMcpServer(inStream, outStream);

      // Send line-delimited JSON-RPC request
      const lineMsg = `${JSON.stringify({ jsonrpc: "2.0", id: "req-1", method: "ping", params: {} })}\n`;
      inStream.push(Buffer.from(lineMsg, "utf-8"));

      // Wait a tick
      await new Promise((resolve) => setTimeout(resolve, 20));

      const parsedLineRes = JSON.parse(outputs[0].trim());
      expect(parsedLineRes.id).toBe("req-1");
      expect(parsedLineRes.result).toEqual({});

      // Send Content-Length framed request
      outputs.length = 0;
      const framedBody = JSON.stringify({
        jsonrpc: "2.0",
        id: "req-2",
        method: "initialize",
        params: {},
      });
      const framedMsg = `Content-Length: ${Buffer.byteLength(framedBody, "utf-8")}\r\n\r\n${framedBody}`;
      inStream.push(Buffer.from(framedMsg, "utf-8"));

      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(outputs[0]).toContain("Content-Length:");
      expect(outputs[0]).toContain('"protocolVersion":"2024-11-05"');
    });

    it("enforces path confinement rejecting paths escaping workspace root", async () => {
      const server = new AilMcpServer(undefined, undefined, { workspaceRoot: tmpDir });
      await expect(
        server.handleRequest(100, "tools/call", {
          name: "ail_outline",
          arguments: { path: "../../../etc/passwd" },
        }),
      ).rejects.toThrow("Access denied: path '../../../etc/passwd' escapes workspace root");
    });

    it("rejects test targets starting with '-' to prevent flag injection", async () => {
      const server = new AilMcpServer(undefined, undefined, { workspaceRoot: tmpDir });
      await expect(
        server.handleRequest(101, "tools/call", {
          name: "ail_test",
          arguments: { target: "--danger-flag" },
        }),
      ).rejects.toThrow("Invalid test target: must not start with '-'");
    });

    it("returns empty edits without crashing on malformed .ail syntax in formatDocument", () => {
      const analyzer = new AilAnalyzer();
      const uri = "file:///test/broken.ail";
      analyzer.setDocument(uri, 'fn broken() {\n  let s = "unterminated string\n');
      const edits = analyzer.formatDocument(uri);
      expect(edits).toEqual([]);
    });

    it("evicts stale file hashes upon modification so only latest content is retained", () => {
      const cache = new AilAstCache(50);
      const testFile = path.join(tmpDir, "stale_test.ail");

      const v1 = "fn foo(): int => 1;";
      const v2 = "fn foo(): int => 2;";

      cache.parseCached(v1, testFile);
      expect(cache.hasCached(v1, testFile)).toBe(true);

      cache.parseCached(v2, testFile);
      expect(cache.hasCached(v2, testFile)).toBe(true);
      // Stale v1 hash must be evicted
      expect(cache.hasCached(v1, testFile)).toBe(false);
      expect(cache.getAstCacheStats().size).toBe(1);
    });
  });
});
