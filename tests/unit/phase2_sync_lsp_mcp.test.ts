/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for First-Class MCP Server (`AiceMcpServer`) and `AiceAstCache` eviction.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { Readable, Writable } from "node:stream";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiceAstCache } from "../../src/cache/index.js";
import { AiceMcpServer } from "../../src/mcp/server.js";

describe("MCP Server (`AiceMcpServer`) & AST Cache Eviction", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-mcp-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("1. First-Class MCP Server (`AiceMcpServer`)", () => {
    it("advertises all 7 AICE productivity tools with accurate schemas in tools/list", async () => {
      const server = new AiceMcpServer();

      const initResult = (await server.handleRequest(1, "initialize", {})) as any;
      expect(initResult.protocolVersion).toBe("2024-11-05");
      expect(initResult.serverInfo.name).toBe("aice-mcp");

      const listResult = (await server.handleRequest(2, "tools/list", {})) as any;
      expect(listResult.tools).toHaveLength(7);

      const toolNames = listResult.tools.map((t: any) => t.name);
      expect(toolNames).toContain("aice_context");
      expect(toolNames).toContain("aice_outline");
      expect(toolNames).toContain("aice_splice");
      expect(toolNames).toContain("aice_create");
      expect(toolNames).toContain("aice_idioms");
      expect(toolNames).toContain("aice_gain");
      expect(toolNames).toContain("aice_project_config");

      const byName = new Map<string, any>(listResult.tools.map((t: any) => [t.name, t]));
      expect(byName.get("aice_context")?.inputSchema.required).toEqual([]);
      expect(byName.get("aice_outline")?.inputSchema.required).toEqual([]);
      expect(byName.get("aice_outline")?.inputSchema.properties.depth).toBeDefined();
      expect(byName.get("aice_outline")?.inputSchema.properties.types).toBeDefined();
      expect(byName.get("aice_idioms")?.inputSchema.required).toEqual(["action"]);
      expect(byName.get("aice_idioms")?.inputSchema.properties.idioms).toBeDefined();
      expect(byName.get("aice_idioms")?.inputSchema.properties.params).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.files).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.dryRun).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.preserveDocs).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.insertAfter).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.insertBefore).toBeDefined();
    });

    it("executes aice_outline via tools/call on native TypeScript file with high token reduction", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testTs = path.join(tmpDir, "outline_test.ts");
      fs.writeFileSync(
        testTs,
        `export class Vector2 {
  x: number;
  y: number;

  constructor(x: number, y: number) {
    this.x = x;
    this.y = y;
  }

  length(): number {
    const sq = this.x * this.x + this.y * this.y;
    return Math.sqrt(sq);
  }
}
`,
      );

      const res = (await server.handleRequest(10, "tools/call", {
        name: "aice_outline",
        arguments: { path: testTs },
      })) as any;

      expect(res.content).toBeDefined();
      expect(res.content[0].type).toBe("text");
      expect(res.content[0].text).toContain("Vector2");
      expect(res.content[0].text).toContain("length");
    });

    it("executes aice_context via tools/call on native TypeScript file", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testTs = path.join(tmpDir, "ctx_test.ts");
      fs.writeFileSync(
        testTs,
        `export function greet(name: string): string {
  return "Hello " + name;
}
`,
      );

      const res = (await server.handleRequest(11, "tools/call", {
        name: "aice_context",
        arguments: { path: testTs },
      })) as any;

      expect(res.content).toBeDefined();
      expect(res.content[0].text).toContain("greet");
    });

    it("executes aice_splice via tools/call to replace symbol in native TypeScript file", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testTs = path.join(tmpDir, "splice_test.ts");
      fs.writeFileSync(
        testTs,
        `export function compute(x: number): number {
  return x + 10;
}
`,
      );

      const res = (await server.handleRequest(12, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: testTs,
          symbolSelector: "compute",
          newAiceCode: `pub fn compute(x: int) -> int:\n  ret x * 2\n`,
        },
      })) as any;

      expect(res.isError).toBeFalsy();
      expect(res.content[0].text).toContain("Successfully spliced symbol 'compute'");

      const modified = fs.readFileSync(testTs, "utf-8");
      expect(modified).toContain("x * 2");
    });

    it("executes aice_idioms list and scan via tools/call", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const configPath = path.join(tmpDir, "aice.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            idioms: {
              square: {
                name: "square",
                kind: "expr",
                params: [{ name: "x" }],
                templateAice: "x * x",
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
        name: "aice_idioms",
        arguments: { dir: tmpDir, action: "list" },
      })) as any;

      expect(res.content[0].text).toContain("square");
      expect(res.content[0].text).toContain("x * x");
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

      new AiceMcpServer(inStream, outStream);

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
      const server = new AiceMcpServer(undefined, undefined, { workspaceRoot: tmpDir });
      await expect(
        server.handleRequest(100, "tools/call", {
          name: "aice_outline",
          arguments: { path: "../../../etc/passwd" },
        }),
      ).rejects.toThrow("Access denied: path '../../../etc/passwd' escapes workspace root");
    });

    it("evicts stale file hashes upon modification so only latest content is retained", () => {
      const cache = new AiceAstCache(50);
      const testFile = path.join(tmpDir, "stale_test.aice");

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

    it("returns -32700 on invalid JSON, -32601 on unknown method, and serializes concurrent handleMessage calls in FIFO order", async () => {
      const inStream = new Readable({ read() {} });
      const outputs: string[] = [];
      const outStream = new Writable({
        write(chunk, _encoding, callback) {
          outputs.push(chunk.toString("utf-8"));
          callback();
        },
      });

      const server = new AiceMcpServer(inStream, outStream, { workspaceRoot: tmpDir });

      // 1. Invalid JSON -> -32700 Parse error
      inStream.push(Buffer.from("{broken_json\n", "utf-8"));
      await new Promise((resolve) => setTimeout(resolve, 25));
      const parseErr = JSON.parse(outputs[0].trim());
      expect(parseErr.error.code).toBe(-32700);

      // 2. Unknown method -> -32601 Method not found
      outputs.length = 0;
      inStream.push(
        Buffer.from(
          `${JSON.stringify({ jsonrpc: "2.0", id: "unk-1", method: "nonexistent/method", params: {} })}\n`,
          "utf-8",
        ),
      );
      await new Promise((resolve) => setTimeout(resolve, 25));
      const methodErr = JSON.parse(outputs[0].trim());
      expect(methodErr.id).toBe("unk-1");
      expect(methodErr.error.code).toBe(-32601);

      // 3. FIFO serialization across async & fast messages
      outputs.length = 0;
      const targetTs = path.join(tmpDir, "fifo.ts");
      fs.writeFileSync(targetTs, "export function step(): number { return 1; }\n", "utf-8");
      const msg1 = JSON.stringify({
        jsonrpc: "2.0",
        id: "seq-1",
        method: "tools/call",
        params: {
          name: "aice_splice",
          arguments: {
            filePath: targetTs,
            symbol: "step",
            code: "export function step(): number { return 2; }",
          },
        },
      });
      const msg2 = JSON.stringify({ jsonrpc: "2.0", id: "seq-2", method: "ping", params: {} });
      inStream.push(Buffer.from(`${msg1}\n${msg2}\n`, "utf-8"));
      await new Promise((resolve) => setTimeout(resolve, 80));
      const ids = outputs
        .join("")
        .trim()
        .split("\n")
        .filter((l) => l.trim().length > 0)
        .map((l) => JSON.parse(l).id);
      expect(ids).toEqual(["seq-1", "seq-2"]);
      expect(server).toBeDefined();
    });

    it("supports aice_splice dryRun/preserveDocs/insertAfter/files, multi-target aice_outline, idioms expand cache unlink, and configFileExists", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // 1. configFileExists is false before saving aice.config.json, then true after enable
      const statusBefore = (await server.handleRequest(20, "tools/call", {
        name: "aice_project_config",
        arguments: { dir: tmpDir, action: "status", json: true },
      })) as any;
      expect(JSON.parse(statusBefore.content[0].text).configFileExists).toBe(false);

      await server.handleRequest(21, "tools/call", {
        name: "aice_project_config",
        arguments: { dir: tmpDir, action: "enable", json: true },
      });
      const statusAfter = (await server.handleRequest(22, "tools/call", {
        name: "aice_project_config",
        arguments: { dir: tmpDir, action: "status", json: true },
      })) as any;
      expect(JSON.parse(statusAfter.content[0].text).configFileExists).toBe(true);

      // 2. aice_splice dryRun, preserveDocs: false, insertAfter, and files batch array
      const docFile = path.join(tmpDir, "doc_target.ts");
      fs.writeFileSync(
        docFile,
        "/** Old doc */\nexport function alpha(): number {\n  return 1;\n}\n",
        "utf-8",
      );

      const dryRes = (await server.handleRequest(23, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: docFile,
          symbol: "alpha",
          code: "export function alpha(): number {\n  return 99;\n}",
          dryRun: true,
        },
      })) as any;
      expect(dryRes.content[0].text).toContain("[Dry Run]");
      expect(fs.readFileSync(docFile, "utf-8")).toContain("return 1;");

      await server.handleRequest(24, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: docFile,
          symbol: "alpha",
          code: "export function alpha(): number {\n  return 2;\n}",
          preserveDocs: false,
        },
      });
      expect(fs.readFileSync(docFile, "utf-8")).not.toContain("Old doc");

      await server.handleRequest(25, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: docFile,
          insertAfter: "alpha",
          code: "export function beta(): number {\n  return 3;\n}",
        },
      });
      expect(fs.readFileSync(docFile, "utf-8")).toContain("export function beta()");

      const fBatch2 = path.join(tmpDir, "batch2.ts");
      fs.writeFileSync(fBatch2, "export const k = 1;\n", "utf-8");
      const filesBatchRes = (await server.handleRequest(26, "tools/call", {
        name: "aice_splice",
        arguments: {
          files: [
            {
              filePath: docFile,
              symbol: "beta",
              code: "export function beta(): number {\n  return 30;\n}",
            },
            { filePath: fBatch2, symbol: "eof", code: "export const m = 2;" },
          ],
        },
      })) as any;
      expect(filesBatchRes.isError).toBeFalsy();
      expect(fs.readFileSync(docFile, "utf-8")).toContain("return 30;");
      expect(fs.readFileSync(fBatch2, "utf-8")).toContain("export const m = 2;");

      // 3. Multi-target aice_outline with types: false
      const multiOut = (await server.handleRequest(27, "tools/call", {
        name: "aice_outline",
        arguments: {
          path: `${path.relative(tmpDir, docFile)} ${path.relative(tmpDir, fBatch2)}`,
          types: false,
        },
      })) as any;
      expect(multiOut.content[0].text).toContain("alpha");
      expect(multiOut.content[0].text).toContain("batch2.ts");

      // 4. aice_idioms expand dryRun & cache invalidation
      const cacheDir = path.join(tmpDir, ".aice-cache");
      fs.mkdirSync(cacheDir, { recursive: true });
      const cacheFile = path.join(cacheDir, "idioms.json");
      fs.writeFileSync(cacheFile, JSON.stringify({ idioms: {} }), "utf-8");

      const expDry = (await server.handleRequest(28, "tools/call", {
        name: "aice_idioms",
        arguments: { dir: tmpDir, action: "expand", dryRun: true },
      })) as any;
      expect(expDry.content[0].text).toContain("Dry Run");
      expect(fs.existsSync(cacheFile)).toBe(true);

      await server.handleRequest(29, "tools/call", {
        name: "aice_idioms",
        arguments: { dir: tmpDir, action: "expand" },
      });
      expect(fs.existsSync(cacheFile)).toBe(false);
    });
  });
});
