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
    it("advertises strictly the 2 unified AICE AI tools (aice_read and aice_splice) in tools/list", async () => {
      const server = new AiceMcpServer();

      const initResult = (await server.handleRequest(1, "initialize", {})) as any;
      expect(initResult.protocolVersion).toBe("2024-11-05");
      expect(initResult.serverInfo.name).toBe("aice-mcp");

      const listResult = (await server.handleRequest(2, "tools/list", {})) as any;
      expect(listResult.tools).toHaveLength(2);
      expect(AiceMcpServer.getToolDefinitions()).toHaveLength(2);

      const toolNames = listResult.tools.map((t: any) => t.name);
      expect(toolNames).toEqual(["aice_read", "aice_splice"]);
      expect(toolNames).not.toContain("aice_outline");
      expect(toolNames).not.toContain("aice_create");
      expect(toolNames).not.toContain("aice_context");
      expect(toolNames).not.toContain("aice_idioms");
      expect(toolNames).not.toContain("aice_gain");
      expect(toolNames).not.toContain("aice_project_config");

      const byName = new Map<string, any>(listResult.tools.map((t: any) => [t.name, t]));
      expect(byName.get("aice_read")?.inputSchema.required).toEqual([]);
      expect(byName.get("aice_read")?.inputSchema.properties.path).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.paths).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.targets).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.symbol).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.outline).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.full).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.depth).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.maxTokens).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.includeCallers).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.idioms).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.stats).toBeDefined();
      expect(byName.get("aice_read")?.inputSchema.properties.json).toBeDefined();

      expect(byName.get("aice_splice")?.inputSchema.properties.filePath).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.path).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.symbol).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.code).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.batch).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.files).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.force).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.overwrite).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.dryRun).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.preserveDocs).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.insertAfter).toBeDefined();
      expect(byName.get("aice_splice")?.inputSchema.properties.insertBefore).toBeDefined();
    });

    it("executes MCP aice_read (auto-outline on dir & >250-line file, full override, symbol slicing) and MCP aice_splice (greenfield create + surgical splice)", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // 1. Greenfield create via MCP aice_splice (nested missing parent dir + AICE DSL compilation)
      const createRes = (await server.handleRequest(10, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: "nested/engine/service.ts",
          code: [
            "export class ScoreService {",
            "  public addBonus(base: number): number {",
            "    return base + 10;",
            "  }",
            "  public reset(): number {",
            "    return 0;",
            "  }",
            "}",
          ].join("\n"),
        },
      })) as any;
      expect(createRes.isError).toBeFalsy();
      const createdPath = path.join(tmpDir, "nested/engine/service.ts");
      expect(fs.existsSync(createdPath)).toBe(true);

      // 2. Surgical splice via MCP aice_splice on existing file
      const surgicalRes = (await server.handleRequest(11, "tools/call", {
        name: "aice_splice",
        arguments: {
          path: "nested/engine/service.ts:ScoreService.addBonus",
          code: "public addBonus(base: number): number {\n  return base + 50;\n}",
        },
      })) as any;
      expect(surgicalRes.isError).toBeFalsy();
      expect(fs.readFileSync(createdPath, "utf-8")).toContain("base + 50");
      expect(fs.readFileSync(createdPath, "utf-8")).toContain("reset(): number");

      // 3. MCP aice_read symbol slicing + sibling outline
      const symReadRes = (await server.handleRequest(12, "tools/call", {
        name: "aice_read",
        arguments: {
          path: "nested/engine/service.ts:ScoreService.addBonus",
        },
      })) as any;
      expect(symReadRes.isError).toBeFalsy();
      expect(symReadRes.content[0].text).toContain("addBonus");
      expect(symReadRes.content[0].text).toContain("reset");

      // 4. MCP aice_read directory auto-outline
      const dirReadRes = (await server.handleRequest(13, "tools/call", {
        name: "aice_read",
        arguments: { path: "nested" },
      })) as any;
      expect(dirReadRes.isError).toBeFalsy();
      expect(dirReadRes.content[0].text).toContain("ScoreService");

      // 5. MCP aice_read dynamic 9 KB budget (1-turn inline <=9 KB + >9 KB auto-outline + full: true override)
      const bigLines = Array.from(
        { length: 120 },
        (_, i) => `export function fn_${i}(): number { return ${i}; }`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "big_module.ts"), bigLines, "utf-8");

      const bigInlineRes = (await server.handleRequest(14, "tools/call", {
        name: "aice_read",
        arguments: { path: "big_module.ts" },
      })) as any;
      expect(bigInlineRes.isError).toBeFalsy();
      expect(bigInlineRes.content[0].text).not.toContain("Auto-outlined");
      expect(bigInlineRes.content[0].text).toContain(
        "120│ export function fn_119(): number { return 119; }",
      );

      const hugeLines = Array.from(
        { length: 420 },
        (_, i) =>
          `export function hugeFn_${i}(payloadLabel: string): string { return payloadLabel + "_${i}"; }`,
      ).join("\n");
      fs.writeFileSync(path.join(tmpDir, "huge_module.ts"), hugeLines, "utf-8");

      const hugeAutoRes = (await server.handleRequest(141, "tools/call", {
        name: "aice_read",
        arguments: { path: "huge_module.ts" },
      })) as any;
      expect(hugeAutoRes.isError).toBeFalsy();
      expect(hugeAutoRes.content[0].text).toContain("Auto-outlined");
      expect(hugeAutoRes.content[0].text).not.toContain('"_415"');

      const hugeFullRes = (await server.handleRequest(15, "tools/call", {
        name: "aice_read",
        arguments: { path: "huge_module.ts", full: true },
      })) as any;
      expect(hugeFullRes.isError).toBeFalsy();
      expect(hugeFullRes.content[0].text).not.toContain("Auto-outlined");
      expect(hugeFullRes.content[0].text).toContain("1│ export function hugeFn_0");
      expect(hugeFullRes.content[0].text).toContain("9 KB MCP stdout budget reached");

      // 6. MCP aice_splice 'batch' array greenfield create + surgical splice
      const batchRes = (await server.handleRequest(16, "tools/call", {
        name: "aice_splice",
        arguments: {
          batch: [
            {
              filePath: "nested/batch_new.ts",
              code: "export const BATCH_VAL = 7;\n",
            },
            {
              filePath: "nested/engine/service.ts",
              symbol: "ScoreService.reset",
              code: "public reset(): number {\n  return -1;\n}",
            },
          ],
        },
      })) as any;
      expect(batchRes.isError).toBeFalsy();
      expect(fs.readFileSync(path.join(tmpDir, "nested/batch_new.ts"), "utf-8")).toContain(
        "BATCH_VAL = 7",
      );
      expect(fs.readFileSync(createdPath, "utf-8")).toContain("return -1");

      // 7. Security confinement check on MCP aice_read and MCP aice_splice
      await expect(
        server.handleRequest(17, "tools/call", {
          name: "aice_read",
          arguments: { path: "../../etc/passwd" },
        }),
      ).rejects.toThrow(/Access denied/);

      await expect(
        server.handleRequest(18, "tools/call", {
          name: "aice_splice",
          arguments: { filePath: "../../etc/passwd", code: "x" },
        }),
      ).rejects.toThrow(/Access denied/);

      // 8. Project activation gate ("enabled": false) on MCP aice_read and aice_splice
      const disabledSub = path.join(tmpDir, "disabled_proj");
      fs.mkdirSync(disabledSub, { recursive: true });
      fs.writeFileSync(
        path.join(disabledSub, "aice.config.json"),
        JSON.stringify({ enabled: false }),
        "utf-8",
      );
      fs.writeFileSync(path.join(disabledSub, "mod.ts"), "export const X = 1;\n", "utf-8");

      const disabledRead = (await server.handleRequest(19, "tools/call", {
        name: "aice_read",
        arguments: { path: "disabled_proj/mod.ts" },
      })) as any;
      expect(disabledRead.isError).toBe(true);
      expect(disabledRead.content[0].text).toContain("AICE is disabled for this project");

      const disabledSplice = (await server.handleRequest(20, "tools/call", {
        name: "aice_splice",
        arguments: { filePath: "disabled_proj/new.ts", code: "export const Y = 2;\n" },
      })) as any;
      expect(disabledSplice.isError).toBe(true);
      expect(disabledSplice.content[0].text).toContain("AICE is disabled for this project");
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

    it("executes aice_context supporting selector, sym, and range aliases and pattern 0-matches resilience", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testTs = path.join(tmpDir, "ctx_alias_test.ts");
      fs.writeFileSync(
        testTs,
        `export function foo(): number { return 1; }\nexport function bar(): number { return 2; }\n`,
      );

      // 1. args.selector alias
      const resSelector = (await server.handleRequest(21, "tools/call", {
        name: "aice_context",
        arguments: { path: testTs, selector: "foo" },
      })) as any;
      expect(resSelector.isError).toBeFalsy();
      expect(resSelector.content[0].text).toContain("foo");

      // 2. args.sym alias
      const resSym = (await server.handleRequest(22, "tools/call", {
        name: "aice_context",
        arguments: { path: testTs, sym: "bar" },
      })) as any;
      expect(resSym.isError).toBeFalsy();
      expect(resSym.content[0].text).toContain("bar");

      // 3. args.range alias
      const resRange = (await server.handleRequest(23, "tools/call", {
        name: "aice_context",
        arguments: { path: testTs, range: "L1-L1" },
      })) as any;
      expect(resRange.isError).toBeFalsy();
      expect(resRange.content[0].text).toContain("foo");

      // 4. /pattern/ with 0 matches returns clean format instead of throwing
      const resPatternZero = (await server.handleRequest(24, "tools/call", {
        name: "aice_context",
        arguments: { path: testTs, selector: "/nonExistentMethod/" },
      })) as any;
      expect(resPatternZero.isError).toBeFalsy();
      expect(resPatternZero.content[0].text).toContain(
        "// Pattern '/nonExistentMethod/' had 0 matches in",
      );
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

    it("executes aice_splice supporting selector and range aliases", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testTs = path.join(tmpDir, "splice_alias_test.ts");
      fs.writeFileSync(
        testTs,
        `export function alpha(): number { return 10; }\nexport function beta(): number { return 20; }\n`,
      );

      // 1. args.selector alias
      const resSel = (await server.handleRequest(31, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: testTs,
          selector: "alpha",
          newAiceCode: "pub fn alpha() -> int:\n  ret 100\n",
        },
      })) as any;
      expect(resSel.isError).toBeFalsy();
      expect(resSel.content[0].text).toContain("Successfully spliced symbol 'alpha'");

      // 2. args.range alias
      const resRange = (await server.handleRequest(32, "tools/call", {
        name: "aice_splice",
        arguments: {
          filePath: testTs,
          range: "L2-L2",
          newAiceCode: "export function beta(): number { return 200; }",
        },
      })) as any;
      expect(resRange.isError).toBeFalsy();
      expect(fs.readFileSync(testTs, "utf-8")).toContain("200");
    });

    it("executes aice_idioms list and scan via tools/call", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const configPath = path.join(tmpDir, "aice.config.json");
      fs.writeFileSync(
        configPath,
        JSON.stringify(
          {
            idiomsEnabled: true,
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
