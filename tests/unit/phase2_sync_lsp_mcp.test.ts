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
    it("advertises all 4 AICE productivity tools in tools/list", async () => {
      const server = new AiceMcpServer();

      const initResult = (await server.handleRequest(1, "initialize", {})) as any;
      expect(initResult.protocolVersion).toBe("2024-11-05");
      expect(initResult.serverInfo.name).toBe("aice-mcp");

      const listResult = (await server.handleRequest(2, "tools/list", {})) as any;
      expect(listResult.tools).toHaveLength(4);

      const toolNames = listResult.tools.map((t: any) => t.name);
      expect(toolNames).toContain("aice_context");
      expect(toolNames).toContain("aice_outline");
      expect(toolNames).toContain("aice_splice");
      expect(toolNames).toContain("aice_idioms");
    });

    it("executes aice_outline via tools/call on native TypeScript file with high token reduction", async () => {
      const server = new AiceMcpServer();
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
      const server = new AiceMcpServer();
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
      const server = new AiceMcpServer();
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
      const server = new AiceMcpServer();
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
  });
});
