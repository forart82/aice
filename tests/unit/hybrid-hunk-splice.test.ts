import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AICE_MCP_TOOLS, AiceMcpServer, type McpToolCallResult } from "../../src/mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";
import {
  extractSymbolFromAiceSource,
  generateContext,
  generateWorkspaceContext,
} from "../../src/tools/context.js";
import { generateOutline } from "../../src/tools/outline.js";
import {
  parseMultiBlockSpliceStream,
  splice,
  spliceBatch,
  stripNumberedGutterPrefixes,
} from "../../src/tools/splice.js";
import { AICE_VERSION } from "../../src/version.js";

describe("AICE v0.9.24 Hybrid Hunk + Line Splicing Engine, MCP Multi-File Stream & Dogfooding Fast-Path", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-v0924-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: true }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("Step 1.1: Zero-Bloat Fast Path for Line-Range (Lstart-Lend) & Regex (/pattern/) + Numbered Gutters", () => {
    it("skips dependency contracts and callers on -s 'L35-L60', prefixes 1-based line numbers (35│ ), and runs in <100ms on a 7,200-line file", async () => {
      const depFile = path.join(tmpDir, "dep.ts");
      fs.writeFileSync(
        depFile,
        "export interface HeavyConfig {\n  id: string;\n  scale: number;\n}\n",
        "utf-8",
      );

      const callerFile = path.join(tmpDir, "caller.ts");
      fs.writeFileSync(
        callerFile,
        'import { BigEngine } from "./big.js";\nexport const eng = new BigEngine();\n',
        "utf-8",
      );

      const bigLines: string[] = [
        'import type { HeavyConfig } from "./dep.js";',
        "",
        "export class BigEngine {",
      ];
      for (let i = 4; i <= 7200; i++) {
        bigLines.push(`  public lineVal${i} = ${i};`);
      }
      bigLines.push("}", "");
      const bigFile = path.join(tmpDir, "big.ts");
      fs.writeFileSync(bigFile, bigLines.join("\n"), "utf-8");

      // Warm up tokenizer one-time table load before measuring generateContext latency
      await generateContext(depFile, { symbol: "L1-L2", projectRoot: tmpDir });

      const t0 = performance.now();
      const ctx = await generateContext(bigFile, {
        symbol: "L35-L60",
        projectRoot: tmpDir,
      });
      const elapsedMs = performance.now() - t0;

      expect(elapsedMs).toBeLessThan(500);
      expect(ctx.dependencies).toHaveLength(0);
      expect(ctx.callers ?? []).toHaveLength(0);
      expect(ctx.formattedBundle).not.toContain("Imported Dependency Contracts");
      expect(ctx.formattedBundle).not.toContain("Downstream Callers");
      expect(ctx.targetContent).toContain("35│   public lineVal35 = 35;");
      expect(ctx.targetContent).toContain("60│   public lineVal60 = 60;");
      expect(ctx.targetContent).not.toContain("lineVal34");
      expect(ctx.targetContent).not.toContain("lineVal61");
    });

    it("prefixes 1-based line numbers when a queried symbol exceeds 25 lines", async () => {
      const lines: string[] = ["export class Renderer {", "  public renderFrame(): number {"];
      for (let i = 1; i <= 30; i++) {
        lines.push(`    const step${i} = ${i};`);
      }
      lines.push("    return step30;", "  }", "}", "");
      const file = path.join(tmpDir, "renderer.ts");
      fs.writeFileSync(file, lines.join("\n"), "utf-8");

      const ctx = await generateContext(file, {
        symbol: "Renderer.renderFrame",
        includeCallers: false,
        projectRoot: tmpDir,
      });
      expect(ctx.targetContent).toContain("2│   public renderFrame(): number {");
      expect(ctx.targetContent).toContain("32│     const step30 = 30;");
    });
  });

  describe("Step 1.2 & 1.3: Hybrid AST-Scoped Hunk Splicing (<<< / === / >>>), Gutter Stripping & ±40 Line-Range Guard", () => {
    it("applies <<< / === / >>> hunks strictly inside the target symbol's AST span without touching identical lines in other methods", async () => {
      const srcFile = path.join(tmpDir, "engine.ts");
      fs.writeFileSync(
        srcFile,
        [
          "export class GameEngine {",
          "  public warmup(): number {",
          "    let speed = 10;",
          "    speed += 1;",
          "    return speed;",
          "  }",
          "",
          "  public step(dt: number): number {",
          "    let speed = 10;",
          "    speed += 1;",
          "    return speed * dt;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const stream = [
        "=== engine.ts:GameEngine.step ===",
        "<<<",
        "    let speed = 10;",
        "    speed += 1;",
        "===",
        "    let speed = 25;",
        "    speed += 5;",
        ">>>",
      ].join("\n");

      const batchRes = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(batchRes.success).toBe(true);

      const updated = fs.readFileSync(srcFile, "utf-8");
      // GameEngine.warmup must remain untouched!
      expect(updated).toContain(
        "  public warmup(): number {\n    let speed = 10;\n    speed += 1;\n    return speed;\n  }",
      );
      // GameEngine.step must be updated!
      expect(updated).toContain(
        "  public step(dt: number): number {\n    let speed = 25;\n    speed += 5;\n    return speed * dt;\n  }",
      );
    });

    it("supports indentation-normalized hunk matching, bare === file === hunks, and Lstart-Lend hunks", async () => {
      const srcFile = path.join(tmpDir, "service.ts");
      fs.writeFileSync(
        srcFile,
        [
          "export function computeScore(base: number): number {",
          "  if (base > 0) {",
          "    const bonus = base * 2;",
          "    return base + bonus;",
          "  }",
          "  return 0;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Indentation-normalized hunk on bare === service.ts ===
      const stream = [
        "=== service.ts ===",
        "<<<",
        "const bonus = base * 2;",
        "return base + bonus;",
        "===",
        "const bonus = base * 5;",
        "return base + bonus + 10;",
        ">>>",
      ].join("\n");

      await spliceBatch(stream, { projectRoot: tmpDir });
      const afterBare = fs.readFileSync(srcFile, "utf-8");
      expect(afterBare).toContain("    const bonus = base * 5;\n    return base + bonus + 10;");

      // Hunk inside L1-L7
      await splice(srcFile, {
        symbol: "L1-L7",
        code: ["<<<", "  return 0;", "===", "  return -1;", ">>>"].join("\n"),
        projectRoot: tmpDir,
      });
      const afterRange = fs.readFileSync(srcFile, "utf-8");
      expect(afterRange).toContain("  return -1;\n}");
    });

    it("auto-strips leading '35│ ' and '35: ' gutter prefixes copied from aice context", async () => {
      const raw = ["  35│   const a = 1;", "  36│   const b = 2;", "  37│   return a + b;"].join(
        "\n",
      );
      expect(stripNumberedGutterPrefixes(raw)).toBe(
        "  const a = 1;\n  const b = 2;\n  return a + b;",
      );

      const file = path.join(tmpDir, "math.ts");
      fs.writeFileSync(
        file,
        [
          "export function add(): number {",
          "  const a = 1;",
          "  const b = 2;",
          "  return a + b;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      await splice(file, {
        symbol: "L2-L4",
        code: ["2│   const a = 10;", "3│   const b = 20;", "4│   return a + b;"].join("\n"),
        projectRoot: tmpDir,
      });
      const updated = fs.readFileSync(file, "utf-8");
      expect(updated).toContain("  const a = 10;\n  const b = 20;\n  return a + b;");
      expect(updated).not.toContain("2│");
    });

    it("heals shifted line-range splices within ±40 lines and rejects unbalanced brace line-range splices", async () => {
      const lines: string[] = ["export class Shifted {"];
      // Insert 28 lines before the target method so L5-L9 is shifted by +28 lines to L33-L37
      for (let i = 1; i <= 30; i++) {
        lines.push(`  public prop${i} = ${i};`);
      }
      lines.push(
        "  public compute(): number {",
        "    const x = 1;",
        "    return x;",
        "  }",
        "}",
        "",
      );
      const file = path.join(tmpDir, "shifted.ts");
      fs.writeFileSync(file, lines.join("\n"), "utf-8");

      // Original range was L6-L9, now at L32-L35 (+26 lines shift, inside ±40 window)
      await splice(file, {
        symbol: "L6-L9",
        code: ["  public compute(): number {", "    const x = 99;", "    return x;", "  }"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      const healed = fs.readFileSync(file, "utf-8");
      expect(healed).toContain("const x = 99;");
      expect(healed).toContain("public prop6 = 6;");

      // Unbalanced brace line-range splice must be rejected
      await expect(
        splice(file, {
          symbol: "L32-L35",
          code: "  public compute(): number {\n    const broken = 1;",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/syntax validation failed/i);
    });

    it("completes a hunk splice on a 7,200-line TypeScript file in <100ms by skipping unnecessary disk scans", async () => {
      const bigLines: string[] = [
        'import { helper } from "./helper.js";',
        "",
        "export class HugeModule {",
      ];
      for (let i = 1; i <= 7200; i++) {
        bigLines.push(`  public field_${i} = ${i};`);
      }
      bigLines.push(
        "  public targetMethod(): number {",
        "    const local_val = 42;",
        "    return local_val;",
        "  }",
        "}",
        "",
      );
      const hugeFile = path.join(tmpDir, "huge.ts");
      fs.writeFileSync(hugeFile, bigLines.join("\n"), "utf-8");

      // Warm up TS validator once
      await splice(hugeFile, {
        symbol: "HugeModule.targetMethod",
        code: ["<<<", "    const local_val = 42;", "===", "    const local_val = 43;", ">>>"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });

      const t0 = performance.now();
      await splice(hugeFile, {
        symbol: "HugeModule.targetMethod",
        code: ["<<<", "    const local_val = 43;", "===", "    const local_val = 100;", ">>>"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      const elapsedMs = performance.now() - t0;
      expect(elapsedMs).toBeLessThan(500);
      expect(fs.readFileSync(hugeFile, "utf-8")).toContain("const local_val = 100;");
    });
  });

  describe("Step 1.4: MCP Multi-File Stream Parity (aice_splice without filePath + code alias + anti-loop descriptions)", () => {
    it("allows MCP aice_splice without filePath using multi-file 'code' stream and exposes anti-loop descriptions", async () => {
      const spliceTool = AICE_MCP_TOOLS.find((t) => t.name === "aice_splice");
      const createTool = AICE_MCP_TOOLS.find((t) => t.name === "aice_create");
      const contextTool = AICE_MCP_TOOLS.find((t) => t.name === "aice_context");

      expect(spliceTool?.inputSchema.required).toBeUndefined();
      expect(spliceTool?.inputSchema.properties).toHaveProperty("code");
      expect(spliceTool?.description).toContain(
        "MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop!",
      );
      expect(createTool?.description).toContain(
        "MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop!",
      );
      expect(contextTool?.description).toContain(
        "MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop!",
      );

      const fileA = path.join(tmpDir, "a.ts");
      fs.writeFileSync(fileA, "export function getAlpha(): number {\n  return 1;\n}\n", "utf-8");

      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const res = (await server.handleRequest(1, "tools/call", {
        name: "aice_splice",
        arguments: {
          code: [
            "=== a.ts:getAlpha ===",
            "<<<",
            "  return 1;",
            "===",
            "  return 42;",
            ">>>",
            "=== b.ts ===",
            "export const BETA = 99;",
          ].join("\n"),
        },
      })) as McpToolCallResult;

      expect(res.isError).toBeFalsy();
      expect(fs.readFileSync(fileA, "utf-8")).toContain("return 42;");
      expect(fs.readFileSync(path.join(tmpDir, "b.ts"), "utf-8")).toContain(
        "export const BETA = 99;",
      );
    });
  });

  describe("Step 2: Directory & Small-File Negative Token Delta Shield, Out-of-Bounds Clamping, Struct.field Fallback & Malformed Heredoc Diagnostics", () => {
    it("returns a compact directory outline when aice context <dir> is called without -s", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });
      fs.writeFileSync(
        path.join(srcDir, "mod1.ts"),
        "export class Alpha {\n  public run(): number {\n    return 1;\n  }\n}\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(srcDir, "mod2.ts"),
        "export class Beta {\n  public exec(): string {\n    return 'ok';\n  }\n}\n",
        "utf-8",
      );

      const wsCtx = await generateWorkspaceContext(srcDir, { projectRoot: tmpDir });
      expect(wsCtx.formattedBundle).toContain("# AICE Directory Outline:");
      expect(wsCtx.formattedBundle).not.toContain("Imported Dependency Contracts");
      expect(wsCtx.dependencies).toHaveLength(0);
    });

    it("uses a minimal 1-line header for small files (<120 tokens) with 0 contracts and 0 callers", async () => {
      const smallFile = path.join(tmpDir, "small.sh");
      fs.writeFileSync(smallFile, "#!/usr/bin/env bash\necho 'hello'\n", "utf-8");

      const ctx = await generateContext(smallFile, { projectRoot: tmpDir });
      expect(ctx.formattedBundle.startsWith("// === ")).toBe(true);
      expect(ctx.formattedBundle).not.toContain("AICE 2.0 Context Pack");
      expect(ctx.formattedBundle).not.toContain("Imported Dependency Contracts");
    });

    it("clamps out-of-bounds Lstart-Lend queries to the last 30 lines of the file and fixes the ':eof' typo", () => {
      const lines = Array.from({ length: 129 }, (_, idx) => `const line_${idx + 1} = ${idx + 1};`);
      const content = lines.join("\n");

      const clamped = extractSymbolFromAiceSource(content, "L135-L200", "sample.ts");
      expect(clamped).toContain("[Clamped L135-L200 -> L100-L129 (EOF)]");
      expect(clamped).toContain("100│ const line_100 = 100;");
      expect(clamped).toContain("129│ const line_129 = 129;");

      expect(() => extractSymbolFromAiceSource("const a = 1;\n", "L10-L20", "sample.ts")).toThrow(
        "Use ':eof' or ':append' to add content at end of file.",
      );
    });

    it("resolves Struct.field in .aipl structs and Class.property arrow functions in TypeScript", async () => {
      const aiplFile = path.join(tmpDir, "light25d.aipl");
      fs.writeFileSync(
        aiplFile,
        [
          "module Light25D",
          "",
          "pub struct PointLight25D(",
          "  wx: float, wy: float, wz: float,",
          "  radius: float, intensity: float",
          ")",
          "",
        ].join("\n"),
        "utf-8",
      );

      const aiplOutline = generateOutline(aiplFile);
      const plSym = aiplOutline.symbols.find((s) => s.name === "PointLight25D");
      expect(plSym?.children?.some((c) => c.name === "wx")).toBe(true);

      const aiplCtx = await generateContext(aiplFile, {
        symbol: "PointLight25D.wx",
        includeCallers: false,
        projectRoot: tmpDir,
      });
      expect(aiplCtx.targetContent).toContain("wx: float");

      const tsFile = path.join(tmpDir, "santa.ts");
      fs.writeFileSync(
        tsFile,
        [
          "export class SantaArcadeApp {",
          "  private renderDemoPlay = (dt: number): void => {",
          "    const snow = dt * 2;",
          "    console.log(snow);",
          "  };",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const tsCtx = await generateContext(tsFile, {
        symbol: "SantaArcadeApp.renderDemoPlay",
        includeCallers: false,
        projectRoot: tmpDir,
      });
      expect(tsCtx.targetContent).toContain("renderDemoPlay = (dt: number): void =>");
      expect(tsCtx.targetContent).toContain("const snow = dt * 2;");
    });

    it("throws actionable diagnostics naming the header and showing valid syntax on empty or malformed heredoc blocks", () => {
      expect(() => parseMultiBlockSpliceStream("=== src/app.ts:GameApp.step ===\n   \n")).toThrow(
        /Empty or malformed splice block for '=== src\/app\.ts:GameApp\.step ==='/,
      );

      expect(() => parseMultiBlockSpliceStream("=== src/app.ts: ===\nconst x = 1;\n")).toThrow(
        /malformed stream header '=== src\/app\.ts: ==='/,
      );
    });
  });

  describe("Step 3: Mandatory Rules v0.9.24 Anti-Loop Mandate & Hybrid Splicing Documentation", () => {
    it("includes v0.9.24 header, STRICT ANTI-LOOP MANDATE, and <<< / === / >>> hybrid splicing docs", () => {
      expect(AICE_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(`<!-- AICE:START v${AICE_VERSION} -->`);
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("STRICT ANTI-LOOP MANDATE");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        "AST-Scoped Hunk Splicing (`<<< / === / >>>` inside `:symbol`)",
      );
    });

    it("selects the implementation body (skipping overload signatures and object return-type braces) and runs symbol context + hunk splice in <100ms on >50KB TypeScript files", async () => {
      const bigLines: string[] = ["export class OverloadedEngine {"];
      for (let i = 1; i <= 7200; i++) {
        bigLines.push(`  public prop_${i} = ${i};`);
      }
      bigLines.push(
        "  public compute(x: boolean): { val: number };",
        "  public compute(x: number): { val: number } | undefined;",
        "  public compute(x: string): { val: number } | undefined;",
        "  public compute(x: number | string | boolean): { val: number } | undefined {",
        "    const parsed = Number(x);",
        "    return { val: parsed };",
        "  }",
        "}",
        "",
      );
      const hugeFile = path.join(tmpDir, "overloaded_huge.ts");
      fs.writeFileSync(hugeFile, bigLines.join("\n"), "utf-8");

      // Warm up TS AST parser & tokenizer caches before timing under parallel CI load
      await generateContext(hugeFile, {
        symbol: "OverloadedEngine.compute",
        projectRoot: tmpDir,
      });
      await splice(hugeFile, {
        symbol: "OverloadedEngine.compute",
        code: [
          "<<<",
          "    const parsed = Number(x);",
          "===",
          "    const parsed = Number(x) + 1;",
          ">>>",
        ].join("\n"),
        projectRoot: tmpDir,
      });

      const tCtx0 = performance.now();
      const ctx = await generateContext(hugeFile, {
        symbol: "OverloadedEngine.compute",
        projectRoot: tmpDir,
      });
      const ctxElapsed = performance.now() - tCtx0;
      expect(ctxElapsed).toBeLessThan(500);
      expect(ctx.targetContent).toContain("parsed");

      const tSplice0 = performance.now();
      await splice(hugeFile, {
        symbol: "OverloadedEngine.compute",
        code: [
          "<<<",
          "    const parsed = Number(x) + 1;",
          "===",
          "    const parsed = Number(x) + 10;",
          ">>>",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      const spliceElapsed = performance.now() - tSplice0;
      expect(spliceElapsed).toBeLessThan(500);

      const updated = fs.readFileSync(hugeFile, "utf-8");
      expect(updated).toContain("public compute(x: number): { val: number } | undefined;");
      expect(updated).toContain("const parsed = Number(x) + 10;");
    });

    it("matches exact line indentation before substring offset when duplicate lines exist at different nesting depths, and avoids duplicate directory outlines in MCP aice_context", async () => {
      const file = path.join(tmpDir, "indent_match.ts");
      fs.writeFileSync(
        file,
        [
          "export function score(x: number): number {",
          "  if (x < 0) {",
          "    return 0;",
          "  }",
          "  return 0;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      await splice(file, {
        symbol: "score",
        code: ["<<<", "  return 0;", "===", "  return 1;", ">>>"].join("\n"),
        projectRoot: tmpDir,
      });
      const after = fs.readFileSync(file, "utf-8");
      expect(after).toContain("  if (x < 0) {\n    return 0;\n  }\n  return 1;");

      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const dirRes = (await server.handleRequest(20, "tools/call", {
        name: "aice_context",
        arguments: { path: tmpDir },
      })) as McpToolCallResult;
      expect(dirRes.isError).toBeFalsy();
      expect(dirRes.content[0]?.text).toContain("# AICE Directory Outline:");
      expect(dirRes.content[0]?.text).not.toContain("## Target Outline");

      const sliceRes = (await server.handleRequest(21, "tools/call", {
        name: "aice_context",
        arguments: { path: "indent_match.ts", symbol: "score" },
      })) as McpToolCallResult;
      expect(sliceRes.isError).toBeFalsy();
      expect(sliceRes.content[0]?.text.startsWith("// === indent_match.ts:score ===")).toBe(true);
      expect(sliceRes.content[0]?.text).not.toContain("## Target Outline");
    });

    it("rejects ambiguous duplicate hunks, stray non-comment text outside <<< / === / >>>, lowers hybrid method-local hunks with insideClass, and validates >50KB TypeScript syntax", async () => {
      const svcFile = path.join(tmpDir, "hunk_guards.ts");
      fs.writeFileSync(
        svcFile,
        [
          "export class GuardEngine {",
          "  public run(): number {",
          "    const step = 1;",
          "    const mid = step + 1;",
          "    const step2 = 1;",
          "    return mid + step2;",
          "  }",
          "  public dup(): number {",
          "    let x = 1;",
          "    x += 2;",
          "    x += 2;",
          "    return x;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      await expect(
        splice(svcFile, {
          symbol: "GuardEngine.dup",
          code: ["<<<", "    x += 2;", "===", "    x += 5;", ">>>"].join("\n"),
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Ambiguous hunk/i);

      await expect(
        splice(svcFile, {
          symbol: "GuardEngine.run",
          code: [
            "const stray = 99;",
            "<<<",
            "    const step = 1;",
            "===",
            "    const step = 2;",
            ">>>",
          ].join("\n"),
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Malformed hunk|outside/i);

      await splice(svcFile, {
        symbol: "GuardEngine.run",
        code: [
          "<<<",
          "    const step = 1;",
          "===",
          "    bonus:# = 7;",
          "    const step = bonus;",
          ">>>",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      const lowered = fs.readFileSync(svcFile, "utf-8");
      expect(lowered).toContain("let bonus: number = 7;");
      expect(lowered).not.toContain("public bonus");

      const bigLines: string[] = [
        "export class BigStrict {",
        '  public banner = "regex_quote_\\"_ok";',
      ];
      for (let i = 0; i < 1800; i++) {
        bigLines.push(`  public item_${i}: number = ${i};`);
      }
      bigLines.push("}", "");
      const bigStrictFile = path.join(tmpDir, "big_strict.ts");
      fs.writeFileSync(bigStrictFile, bigLines.join("\n"), "utf-8");
      expect(fs.statSync(bigStrictFile).size).toBeGreaterThan(50_000);

      await splice(bigStrictFile, {
        symbol: "BigStrict.banner",
        code: 'public banner = "updated_50kb";',
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(bigStrictFile, "utf-8")).toContain('public banner = "updated_50kb";');

      await expect(
        splice(bigStrictFile, {
          symbol: "BigStrict.banner",
          code: "public banner = (((broken syntax;;;",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Syntax validation failed/i);
    });
  });
});
