import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { AiceMcpServer } from "../../src/mcp/server.js";
import { readTelemetryEvents } from "../../src/telemetry/index.js";
import {
  isHybridOrNativeSource,
  maskSourceLexically,
  preprocessHybridAndIdiomsLossless,
  unmaskLexicalTokens,
} from "../../src/tools/preprocessor.js";
import { parseMultiBlockSpliceStream, splice, spliceBatch } from "../../src/tools/splice.js";

const CLI_TS = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, input?: string) {
  return spawnSync(TSX_BIN, [CLI_TS, ...args], {
    cwd,
    input,
    encoding: "utf-8",
    timeout: 60000,
  });
}

describe("Unified Write Engine (splice & spliceBatch subsuming createFile & createBatch)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-unified-write-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      `${JSON.stringify(
        {
          enabled: true,
          idioms: {
            $clampUnit: {
              name: "$clampUnit",
              kind: "expr",
              params: [{ name: "$0", type: "number" }],
              templateAice: "Math.min(1, Math.max(0, $0))",
              occurrences: 2,
              tokensPerOccurrenceSaved: 6,
              netTokenSavings: 12,
              description: "Clamp numeric value into [0, 1]",
            },
          },
        },
        null,
        2,
      )}\n`,
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Greenfield Native File Creation & Passthrough Support", () => {
    it("auto-creates nested parent directories and preserves lossless native code across languages", async () => {
      const tsPath = path.join(tmpDir, "packages", "core", "src", "native.ts");
      const nativeTs = [
        "// Preserve exact header comment & formatting",
        "export interface Vector2D {",
        "  readonly x: number;",
        "  readonly y: number;",
        "}",
        "",
        "export function magnitude(v: Vector2D): number {",
        "  return Math.hypot(v.x, v.y);",
        "}",
        "",
      ].join("\n");

      const res = await splice(tsPath, {
        code: nativeTs,
        projectRoot: tmpDir,
      });

      expect(res.success).toBe(true);
      expect(res.filePath).toBe(tsPath);
      expect(res.nativeCode).toBe(nativeTs);
      expect(res.content).toBe(nativeTs);
      expect(res.language).toBe("TypeScript");
      expect(fs.readFileSync(tsPath, "utf-8")).toBe(nativeTs);
    });

    it("creates passthrough manifests and dotfiles (Makefile, Cargo.toml, .gitignore, .env) cleanly via splice", async () => {
      const makefilePath = path.join(tmpDir, "Makefile");
      const cargoPath = path.join(tmpDir, "crates", "app", "Cargo.toml");
      const envPath = path.join(tmpDir, ".env");

      await splice(makefilePath, {
        code: ".PHONY: build\nbuild:\n\techo building\n",
        projectRoot: tmpDir,
      });
      await splice(cargoPath, {
        content: '[package]\nname = "demo"\nversion = "0.1.0"\n',
        projectRoot: tmpDir,
      });
      await splice(envPath, {
        snippet: "PORT=3000\nMODE=production\n",
        projectRoot: tmpDir,
      });

      expect(fs.readFileSync(makefilePath, "utf-8")).toContain("\techo building\n");
      expect(fs.readFileSync(cargoPath, "utf-8")).toContain('name = "demo"');
      expect(fs.readFileSync(envPath, "utf-8")).toBe("PORT=3000\nMODE=production\n");
    });

    it("supports CreateFileOptions.from and :create inline selector on greenfield files", async () => {
      const templateFile = path.join(tmpDir, "input.aice");
      fs.writeFileSync(templateFile, "pub fn square(n: int) -> int:\n  ret n * n\n", "utf-8");

      const targetPath = path.join(tmpDir, "src", "math_from.ts");
      const res = await splice(`${targetPath}:create`, {
        from: templateFile,
        projectRoot: tmpDir,
      });

      expect(res.success).toBe(true);
      const written = fs.readFileSync(targetPath, "utf-8");
      expect(written).toContain("export function square(n: number): number");
      expect(written).toMatch(/return \(?n \* n\)?;/);
    });
  });

  describe("2. Greenfield AICE Shorthand DSL Compilation & Idiom Expansion via splice", () => {
    it("compiles AICE shorthand DSL (from ... import, pub class, pub fn) into valid TypeScript & Python", async () => {
      const tsFile = path.join(tmpDir, "src", "engine.ts");
      const aiceDsl = [
        'from "./math.js" import { Vec2 }',
        "",
        "pub class PhysicsBody:",
        "  mass: float = 1.0",
        "  pub fn kineticEnergy(self, speed: float) -> float:",
        "    ret 0.5 * self.mass * speed * speed",
        "",
        "pub fn normalizeRatio(raw: float) -> float:",
        "  ret $clampUnit(raw)",
      ].join("\n");

      const tsRes = await splice(tsFile, {
        aice: aiceDsl,
        idioms: true,
        projectRoot: tmpDir,
      });
      expect(tsRes.success).toBe(true);
      expect(tsRes.idiomsUsed).toBe(true);
      const emittedTs = fs.readFileSync(tsFile, "utf-8");
      expect(emittedTs).toContain('import { Vec2 } from "./math.js";');
      expect(emittedTs).toContain("export class PhysicsBody");
      expect(emittedTs).toContain("kineticEnergy(speed: number): number");
      expect(emittedTs).toContain("this.mass");
      expect(emittedTs).toContain("Math.min(1, Math.max(0, raw))");

      const pyFile = path.join(tmpDir, "src", "worker.py");
      const pyRes = await splice(pyFile, {
        code: [
          "pub class Counter:",
          "  pub fn step(self, delta: int) -> int:",
          "    ret delta + 1",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(pyRes.success).toBe(true);
      const emittedPy = fs.readFileSync(pyFile, "utf-8");
      expect(emittedPy).toContain("class Counter:");
      expect(emittedPy).toContain("def step(self, delta: int) -> int:");
      expect(emittedPy).toContain("return delta + 1");
    });

    it("extracts and persists inline @idiom declarations when creating files via splice", async () => {
      const cfgPath = path.join(tmpDir, "aice.config.json");
      const baseCfg = JSON.parse(fs.readFileSync(cfgPath, "utf-8"));
      fs.writeFileSync(
        cfgPath,
        `${JSON.stringify({ ...baseCfg, idiomsEnabled: true }, null, 2)}\n`,
        "utf-8",
      );
      const targetTs = path.join(tmpDir, "src", "idiom_host.ts");
      const res = await splice(targetTs, {
        code: [
          "@idiom $toMillis($0) = ($0 * 1000)",
          "pub fn secondsToMs(sec: float) -> float:",
          "  ret $toMillis(sec)",
        ].join("\n"),
        idioms: true,
        projectRoot: tmpDir,
      });
      expect(res.success).toBe(true);
      expect(res.persistedIdioms).toContain("$toMillis");
      expect(fs.readFileSync(targetTs, "utf-8")).toContain("sec * 1000");

      const savedCfg = JSON.parse(fs.readFileSync(path.join(tmpDir, "aice.config.json"), "utf-8"));
      expect(savedCfg.idioms).toHaveProperty("$toMillis");
    });
  });

  describe("3. Multi-File Mixed Create + Surgical Splice Batch Streams", () => {
    it("executes greenfield DSL creation, native creation, and surgical AST splices in a single spliceBatch stream", async () => {
      const existingBoard = path.join(tmpDir, "src", "board.ts");
      fs.mkdirSync(path.dirname(existingBoard), { recursive: true });
      fs.writeFileSync(
        existingBoard,
        [
          "/** Preserved class doc */",
          "export class Board {",
          "  /** Preserved method doc */",
          "  public width(): number {",
          "    return 8;",
          "  }",
          "  public height(): number {",
          "    return 8;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const stream = [
        "=== src/constants.ts ===",
        "pub fn getDefaultWidth() -> int:",
        "  ret 16",
        "pub fn getDefaultHeight() -> int:",
        "  ret 12",
        "=== src/theme.css ===",
        ".grid { display: grid; gap: 8px; }",
        "=== src/board.ts:Board.width ===",
        "public width(): number {",
        "  return 16;",
        "}",
        "=== src/chained.ts ===",
        "pub class Counter:",
        "  pub fn current(self) -> int:",
        "    ret 1",
        "=== src/chained.ts:Counter.current ===",
        "pub fn current(self) -> int:",
        "  ret 42",
      ].join("\n");

      const batchRes = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(batchRes.success).toBe(true);
      expect(batchRes.totalEdits).toBe(5);
      expect(batchRes.totalFiles).toBe(4);
      expect(batchRes.createdFiles).toHaveLength(3);

      expect(fs.readFileSync(path.join(tmpDir, "src", "constants.ts"), "utf-8")).toContain(
        "export function getDefaultWidth(): number",
      );
      expect(fs.readFileSync(path.join(tmpDir, "src", "theme.css"), "utf-8")).toContain(
        "display: grid;",
      );

      const updatedBoard = fs.readFileSync(existingBoard, "utf-8");
      expect(updatedBoard).toContain("/** Preserved class doc */");
      expect(updatedBoard).toContain("/** Preserved method doc */");
      expect(updatedBoard).toContain("return 16;");
      expect(updatedBoard).toContain("public height(): number {\n    return 8;\n  }");

      const chainedContent = fs.readFileSync(path.join(tmpDir, "src", "chained.ts"), "utf-8");
      expect(chainedContent).toContain("export class Counter");
      expect(chainedContent).toContain("return 42;");
    });

    it("unwraps single-block and multi-block === ... === headers cleanly when passed directly to splice()", async () => {
      const fileA = path.join(tmpDir, "src", "direct_a.ts");
      const fileB = path.join(tmpDir, "src", "direct_b.ts");

      // Single-block === file === header passed to splice()
      await splice(fileA, {
        code: ["=== src/direct_a.ts ===", "pub fn alpha() -> int:", "  ret 7"].join("\n"),
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(fileA, "utf-8")).toContain("export function alpha(): number");

      // Single-block === :overwrite === header passed to splice()
      await splice(fileA, {
        code: ["=== :overwrite ===", "pub fn alpha() -> int:", "  ret 99"].join("\n"),
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(fileA, "utf-8")).toContain("return 99;");
      expect(fs.readFileSync(fileA, "utf-8")).not.toContain("=== :overwrite ===");

      // Multi-file stream passed to splice("", { code }) delegates to spliceBatch
      await splice("", {
        code: [
          "=== src/direct_a.ts:alpha ===",
          "export function alpha(): number { return 123; }",
          "=== src/direct_b.ts ===",
          "pub fn getBeta() -> str:",
          "  ret 'ok'",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(fileA, "utf-8")).toContain("return 123;");
      expect(fs.readFileSync(fileB, "utf-8")).toContain("export function getBeta(): string");
    });

    it("does not inject pre-header @idiom declarations into shell scripts in mixed streams", async () => {
      const shPath = path.join(tmpDir, "scripts", "run.sh");
      const tsPath = path.join(tmpDir, "src", "app.ts");
      const stream = [
        "@idiom $double($0) = ($0 * 2)",
        "",
        "=== scripts/run.sh ===",
        "#!/usr/bin/env bash",
        "echo 'hello'",
        "=== src/app.ts ===",
        "pub fn calc(x: int) -> int:",
        "  ret $double(x)",
      ].join("\n");

      const res = await spliceBatch(stream, { projectRoot: tmpDir });
      expect(res.success).toBe(true);
      const shOut = fs.readFileSync(shPath, "utf-8");
      expect(shOut.startsWith("#!/usr/bin/env bash\n")).toBe(true);
      expect(shOut).not.toContain("@idiom");
      expect(fs.readFileSync(tsPath, "utf-8")).toContain("x * 2");
    });
  });

  describe("4. Full-File Overwrite Options (force / overwrite) vs Lossless Surgical Selectors", () => {
    it("supports force and overwrite options cleanly while respecting explicit overwrite: false >25-line guard", async () => {
      const bigFile = path.join(tmpDir, "src", "large.ts");
      fs.mkdirSync(path.dirname(bigFile), { recursive: true });
      const thirtyLines = Array.from(
        { length: 30 },
        (_, i) => `export const ITEM_${i} = ${i};`,
      ).join("\n");
      fs.writeFileSync(bigFile, `${thirtyLines}\n`, "utf-8");

      // Explicit overwrite: false guards >25-line existing files (CreateFileOptions parity)
      await expect(
        splice(bigFile, {
          code: "export const SHORT = 1;\n",
          overwrite: false,
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/already exists/i);

      // force: true overrides explicit overwrite: false and compiles AICE DSL
      await splice(bigFile, {
        code: "pub fn forcedValue() -> int:\n  ret 777\n",
        overwrite: false,
        force: true,
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(bigFile, "utf-8")).toContain("export function forcedValue(): number");

      // :overwrite stream block overrides overwrite: false on >25-line files in spliceBatch
      const parsedOw = parseMultiBlockSpliceStream(
        ["=== src/large.ts:overwrite ===", "export const STREAM_OW = 888;"].join("\n"),
      );
      expect(parsedOw?.batchItems?.[0]?.symbol).toBe("overwrite");
      await spliceBatch(parsedOw?.batchItems ?? [], {
        projectRoot: tmpDir,
        overwrite: false,
      });
      expect(fs.readFileSync(bigFile, "utf-8")).toContain("export const STREAM_OW = 888;");

      // force: true also permits intentional empty truncation
      await splice(bigFile, {
        code: "",
        force: true,
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(bigFile, "utf-8")).toBe("");
    });

    it("preserves 100% of surgical selectors (Class.method, TC-001, Markdown Heading, Lstart-Lend, hunk, eof, imports, @clone, delete)", async () => {
      // 1. Class.method, imports, eof, @clone, delete, hunk, Lstart-Lend on TypeScript
      const svcFile = path.join(tmpDir, "src", "service.ts");
      fs.mkdirSync(path.dirname(svcFile), { recursive: true });
      fs.writeFileSync(
        svcFile,
        [
          'import { readFileSync } from "node:fs";',
          "",
          "export class Service {",
          "  public fetch(url: string): string {",
          "    const retries = 1;",
          "    return `${url}:${retries}:${typeof readFileSync}`;",
          "  }",
          "  public obsolete(): void {}",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      // imports merge
      await splice(svcFile, {
        symbol: "imports",
        code: 'import * as path from "node:path";',
        projectRoot: tmpDir,
      });
      // AST-scoped hunk
      await splice(svcFile, {
        symbol: "Service.fetch",
        code: ["<<<", "const retries = 1;", "===", "const retries = 3;", ">>>"].join("\n"),
        projectRoot: tmpDir,
      });
      // @clone
      await splice(svcFile, {
        symbol: "Service.retryFetch",
        cloneFrom: "Service.fetch",
        code: ["<<<", "const retries = 3;", "===", "const retries = 5;", ">>>"].join("\n"),
        projectRoot: tmpDir,
      });
      // delete
      await splice(svcFile, {
        symbol: "Service.obsolete",
        delete: true,
        projectRoot: tmpDir,
      });
      // eof append
      await splice(svcFile, {
        symbol: "eof",
        code: "export const SERVICE_READY = true;",
        projectRoot: tmpDir,
      });

      const svcAfter = fs.readFileSync(svcFile, "utf-8");
      expect(svcAfter).toContain('import { readFileSync } from "node:fs";');
      expect(svcAfter).toContain('import * as path from "node:path";');
      expect(svcAfter).toContain("const retries = 3;");
      expect(svcAfter).toContain("retryFetch(url: string): string");
      expect(svcAfter).toContain("const retries = 5;");
      expect(svcAfter).not.toContain("obsolete");
      expect(svcAfter).toContain("export const SERVICE_READY = true;");

      // Line-range edit L1-L1
      const linesBefore = svcAfter.split("\n");
      const readyLineIdx = linesBefore.findIndex((l) => l.includes("SERVICE_READY")) + 1;
      await splice(svcFile, {
        symbol: `L${readyLineIdx}-L${readyLineIdx}`,
        code: "export const SERVICE_READY = false;",
        projectRoot: tmpDir,
      });
      expect(fs.readFileSync(svcFile, "utf-8")).toContain("export const SERVICE_READY = false;");

      // 2. Test ID selector (TC-001)
      const testFile = path.join(tmpDir, "src", "board.test.ts");
      fs.writeFileSync(
        testFile,
        [
          'import { expect, test } from "vitest";',
          'test("TC-001: initial state", () => {',
          "  expect(1).toBe(1);",
          "});",
          'test("TC-002: untouched test", () => {',
          "  expect(2).toBe(2);",
          "});",
          "",
        ].join("\n"),
        "utf-8",
      );
      await splice(testFile, {
        symbol: "TC-001",
        code: ['test("TC-001: initial state", () => {', "  expect(1 + 1).toBe(2);", "});"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      const testAfter = fs.readFileSync(testFile, "utf-8");
      expect(testAfter).toContain("expect(1 + 1).toBe(2);");
      expect(testAfter).toContain("TC-002: untouched test");

      // 3. Markdown Heading selector
      const docFile = path.join(tmpDir, "README.md");
      fs.writeFileSync(
        docFile,
        ["# Project", "", "## Overview", "Old overview.", "", "## License", "Apache-2.0", ""].join(
          "\n",
        ),
        "utf-8",
      );
      await splice(docFile, {
        symbol: "Overview",
        code: "## Overview\nUpdated unified overview.",
        projectRoot: tmpDir,
      });
      const docAfter = fs.readFileSync(docFile, "utf-8");
      expect(docAfter).toContain("Updated unified overview.");
      expect(docAfter).not.toContain("Old overview.");
      expect(docAfter).toContain("## License\nApache-2.0");
    });
  });

  describe("5. Transactional Atomicity & Rollback on Syntax Error", () => {
    it("rolls back newly created files, newly created directories, overwritten files, surgical edits, and idiom config on syntax error", async () => {
      const configPath = path.join(tmpDir, "aice.config.json");
      const parsedBaseCfg = JSON.parse(fs.readFileSync(configPath, "utf-8"));
      fs.writeFileSync(
        configPath,
        `${JSON.stringify({ ...parsedBaseCfg, idiomsEnabled: true }, null, 2)}\n`,
        "utf-8",
      );
      const originalConfig = fs.readFileSync(configPath, "utf-8");
      const existingOverwritten = path.join(tmpDir, "existing_ow.ts");
      const originalOwContent = "export const STABLE = 'keep-me';\n";
      fs.writeFileSync(existingOverwritten, originalOwContent, "utf-8");

      const existingSurgical = path.join(tmpDir, "existing_surg.ts");
      const originalSurgContent = "export function ping(): string {\n  return 'pong';\n}\n";
      fs.writeFileSync(existingSurgical, originalSurgContent, "utf-8");

      const deepCreated = path.join(tmpDir, "brand_new_dir", "nested", "created.ts");

      const failingBatchStream = [
        "=== brand_new_dir/nested/created.ts ===",
        "@idiom $tempMacro($0) = ($0 + 1)",
        "pub fn okFn(x: int) -> int:",
        "  ret $tempMacro(x)",
        "=== existing_ow.ts:overwrite ===",
        "export const STABLE = 'mutated-before-crash';",
        "=== existing_surg.ts:ping ===",
        "export function ping(): string { return 'mutated'; }",
        "=== brand_new_dir/broken.ts ===",
        "export function brokenSyntax(((: number { return ;;;",
      ].join("\n");

      await expect(
        spliceBatch(failingBatchStream, { projectRoot: tmpDir, idioms: true }),
      ).rejects.toThrow(/syntax|compile/i);

      // 1. Newly created file AND newly created nested parent directories must be removed
      expect(fs.existsSync(deepCreated)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "brand_new_dir"))).toBe(false);

      // 2. Overwritten & surgically edited files must match original bytes 100%
      expect(fs.readFileSync(existingOverwritten, "utf-8")).toBe(originalOwContent);
      expect(fs.readFileSync(existingSurgical, "utf-8")).toBe(originalSurgContent);

      // 3. Project idiom config must be restored without the rolled-back @idiom
      expect(fs.readFileSync(configPath, "utf-8")).toBe(originalConfig);
    });

    it("rejects <<< === >>> hunks or @clone against non-existent files and rolls back preceding batch creations", async () => {
      const createdFirst = path.join(tmpDir, "created_first.ts");
      const missingTarget = path.join(tmpDir, "does_not_exist.ts");

      await expect(
        splice(missingTarget, {
          code: ["<<<", "const a = 1;", "===", "const a = 2;", ">>>"].join("\n"),
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/not found/i);

      await expect(
        spliceBatch(
          [
            { filePath: createdFirst, code: "export const FIRST = 1;\n" },
            {
              filePath: missingTarget,
              symbol: "Foo.bar",
              cloneFrom: "Foo.baz",
            },
          ],
          { projectRoot: tmpDir },
        ),
      ).rejects.toThrow(/not found/i);

      expect(fs.existsSync(createdFirst)).toBe(false);
    });
  });

  describe("6. v0.9.36 Splice Resilience, Null-Guards & Honest Signed Telemetry", () => {
    const EQ = "=".repeat(3);
    const HK_OPEN = "<".repeat(3);
    const HK_CLOSE = ">".repeat(3);

    it("Step 5.3: matches dedented and over-indented <<< === >>> hunks unambiguously while preserving target indentation", async () => {
      const targetTs = path.join(tmpDir, "src", "orders.ts");
      fs.mkdirSync(path.dirname(targetTs), { recursive: true });
      fs.writeFileSync(
        targetTs,
        [
          "export class OrderEngine {",
          "  public computeTotal(subtotal: number, taxRate: number): number {",
          "    const tax = subtotal * taxRate;",
          "    if (tax > 100) {",
          "      return subtotal + 100;",
          "    }",
          "    return subtotal + tax;",
          "  }",
          "",
          "  public finalize(amount: number): string {",
          "    const rounded = Math.round(amount * 100) / 100;",
          "    if (rounded <= 0) {",
          '      return "FREE";',
          "    }",
          "    return `$${rounded.toFixed(2)}`;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      // 1. File-level hunk with completely dedented (0-space) search & replacement blocks
      const dedentedFileHunk = [
        HK_OPEN,
        "const tax = subtotal * taxRate;",
        "if (tax > 100) {",
        "  return subtotal + 100;",
        "}",
        EQ,
        "const cappedTax = Math.min(250, subtotal * taxRate);",
        "if (cappedTax > 150) {",
        "  return subtotal + 150;",
        "}",
        HK_CLOSE,
      ].join("\n");

      const fileHunkRes = await splice(targetTs, {
        code: dedentedFileHunk,
        projectRoot: tmpDir,
      });
      expect(fileHunkRes.success).toBe(true);
      const afterFileHunk = fs.readFileSync(targetTs, "utf-8");
      expect(afterFileHunk).toContain(
        [
          "    const cappedTax = Math.min(250, subtotal * taxRate);",
          "    if (cappedTax > 150) {",
          "      return subtotal + 150;",
          "    }",
        ].join("\n"),
      );

      // 2. :symbol-scoped hunk with over-indented (8-space) search & replacement blocks
      const overIndentedSymbolHunk = [
        HK_OPEN,
        "        const rounded = Math.round(amount * 100) / 100;",
        "        if (rounded <= 0) {",
        '          return "FREE";',
        "        }",
        EQ,
        "        const rounded = Math.max(0, Math.round(amount * 100) / 100);",
        "        if (rounded === 0) {",
        '          return "ZERO";',
        "        }",
        HK_CLOSE,
      ].join("\n");

      const symHunkRes = await splice(targetTs, {
        symbol: "OrderEngine.finalize",
        code: overIndentedSymbolHunk,
        projectRoot: tmpDir,
      });
      expect(symHunkRes.success).toBe(true);
      const afterSymHunk = fs.readFileSync(targetTs, "utf-8");
      expect(afterSymHunk).toContain(
        [
          "    const rounded = Math.max(0, Math.round(amount * 100) / 100);",
          "    if (rounded === 0) {",
          '      return "ZERO";',
          "    }",
        ].join("\n"),
      );

      // 3. Rejects ambiguous multi-matches when dedented hunk matches 2+ blocks
      const dupTs = path.join(tmpDir, "src", "dup_hunk.ts");
      fs.writeFileSync(
        dupTs,
        [
          "export class FeeCalc {",
          "  public tierA(amount: number): number {",
          "    const fee = amount * 0.02;",
          "    return amount - fee;",
          "  }",
          "  public tierB(amount: number): number {",
          "      const fee = amount * 0.02;",
          "      return amount - fee;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const ambiguousHunk = [
        HK_OPEN,
        "const fee = amount * 0.02;",
        "return amount - fee;",
        EQ,
        "const fee = amount * 0.05;",
        "return amount - fee;",
        HK_CLOSE,
      ].join("\n");

      await expect(splice(dupTs, { code: ambiguousHunk, projectRoot: tmpDir })).rejects.toThrow(
        /Ambiguous hunk/i,
      );
    });

    it("Step 5.2: auto-aligns unambiguous ±1/±2 brace-imbalanced :Lstart-Lend boundaries and rejects ambiguous boundaries", async () => {
      const rangeTs = path.join(tmpDir, "src", "range_align.ts");
      fs.mkdirSync(path.dirname(rangeTs), { recursive: true });
      fs.writeFileSync(
        rangeTs,
        [
          "export const HEADER_CONST = 1;",
          "export function computeScore(v: number): number {",
          "  const base = v * 2;",
          "  return base + 1;",
          "}",
          "export const KEEP_AFTER = 42;",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Off-by-one (+1 on endLine): L2-L4 omits line 5's closing `}` while replacement includes `}`
      const resPlusOne = await splice(rangeTs, {
        symbol: "L2-L4",
        code: ["export function computeScore(v: number): number {", "  return v * 10;", "}"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      expect(resPlusOne.success).toBe(true);
      const afterPlusOne = fs.readFileSync(rangeTs, "utf-8");
      expect(afterPlusOne).toContain("return v * 10;");
      expect(afterPlusOne).toContain("export const KEEP_AFTER = 42;");

      // Off-by-two (+2 on endLine): function has trailing comment/blank + closing `}` across 2 lines
      fs.writeFileSync(
        rangeTs,
        [
          "export const HEADER_CONST = 1;",
          "export function computeScore(v: number): number {",
          "  const base = v * 2;",
          "  return base + 1;",
          "  // end computeScore",
          "}",
          "export const KEEP_AFTER = 42;",
          "",
        ].join("\n"),
        "utf-8",
      );

      const resPlusTwo = await splice(rangeTs, {
        symbol: "L2-L4",
        code: ["export function computeScore(v: number): number {", "  return v * 99;", "}"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      expect(resPlusTwo.success).toBe(true);
      const afterPlusTwo = fs.readFileSync(rangeTs, "utf-8");
      expect(afterPlusTwo).toContain("return v * 99;");
      expect(afterPlusTwo).toContain("export const KEEP_AFTER = 42;");

      // Off-by-one (-1 on startLine): L3-L5 omits opening `export function computeScore(...) {` on L2
      fs.writeFileSync(
        rangeTs,
        [
          "export const HEADER_CONST = 1;",
          "export function computeScore(v: number): number {",
          "  const base = v * 2;",
          "  return base + 1;",
          "}",
          "export const KEEP_AFTER = 42;",
          "",
        ].join("\n"),
        "utf-8",
      );

      const resStartMinusOne = await splice(rangeTs, {
        symbol: "L3-L5",
        code: ["export function computeScore(v: number): number {", "  return v + 333;", "}"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      expect(resStartMinusOne.success).toBe(true);
      expect(fs.readFileSync(rangeTs, "utf-8")).toContain("return v + 333;");

      // Off-by-one (-1 on endLine): L2-L6 inside a class accidentally includes the class's closing `}` on L6
      const classRangeTs = path.join(tmpDir, "src", "class_range.ts");
      fs.writeFileSync(
        classRangeTs,
        [
          "export class ScoreService {",
          "  public computeScore(v: number): number {",
          "    const base = v * 2;",
          "    return base + 1;",
          "  }",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      const resEndMinusOne = await splice(classRangeTs, {
        symbol: "L2-L6",
        code: ["  public computeScore(v: number): number {", "    return v + 777;", "  }"].join(
          "\n",
        ),
        projectRoot: tmpDir,
      });
      expect(resEndMinusOne.success).toBe(true);
      expect(fs.readFileSync(classRangeTs, "utf-8")).toContain("return v + 777;");

      // Truncated/unbalanced replacement against an already-balanced Lstart-Lend must be rejected
      await expect(
        splice(classRangeTs, {
          symbol: "L2-L4",
          code: "  public computeScore(v: number): number {\n    const broken = 1;",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/syntax validation failed/i);
      // Ambiguous ±1 candidate: both shrinking startLine (L3-L4) and expanding endLine (L2-L5) would balance `{`/`}`
      const ambigRangeTs = path.join(tmpDir, "src", "ambig_range.ts");
      fs.writeFileSync(
        ambigRangeTs,
        [
          "export function outer(): number {",
          "  {",
          "    const inner = 1;",
          "  }",
          "  return 0;",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );
      // Target L2-L3 replaces `  {\n    const inner = 1;` with `    const inner = 2;` (missing `{`):
      // - L2-L4 replaces the entire `{ const inner = 1; }` block with `const inner = 2;` (valid!)
      // - L3-L3 keeps `{` on L2 and `}` on L4 and replaces only `const inner = 1;` with `const inner = 2;` (also valid!)
      await expect(
        splice(ambigRangeTs, {
          symbol: "L2-L3",
          code: "    const inner = 2;",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/ambiguous|Line-range/i);
    });

    it("Step 5.2: includes exact ±5 numbered context lines (<lineNo>│ <lineContent>) when syntax validation rejects a splice", async () => {
      const ctxTs = path.join(tmpDir, "src", "context_diag.ts");
      fs.mkdirSync(path.dirname(ctxTs), { recursive: true });
      const lines: string[] = [];
      for (let i = 1; i <= 9; i++) {
        lines.push(`export const C_${i} = ${i};`);
      }
      lines.push("export function targetFn(x: number): number {"); // L10
      lines.push("  return x + 1;"); // L11
      lines.push("}"); // L12
      for (let i = 13; i <= 20; i++) {
        lines.push(`export const C_${i} = ${i};`);
      }
      fs.writeFileSync(ctxTs, `${lines.join("\n")}\n`, "utf-8");

      // 1. :Lstart-Lend syntax failure around L10-L12 -> must include 5│..17│
      let rangeErrMsg = "";
      try {
        await splice(ctxTs, {
          symbol: "L10-L12",
          code: "export function targetFn(((: number { return ;;; }",
          projectRoot: tmpDir,
        });
      } catch (err) {
        rangeErrMsg = err instanceof Error ? err.message : String(err);
      }
      expect(rangeErrMsg).toMatch(/syntax|Line-range/i);
      expect(rangeErrMsg).toContain("5│ export const C_5 = 5;");
      expect(rangeErrMsg).toContain("10│ export function targetFn(x: number): number {");
      expect(rangeErrMsg).toContain("12│ }");
      expect(rangeErrMsg).toContain("17│ export const C_17 = 17;");
      expect(rangeErrMsg).not.toContain("3│ export const C_3 = 3;");
      expect(rangeErrMsg).not.toContain("19│ export const C_19 = 19;");

      // 2. Surgical :symbol syntax failure on targetFn -> must also include 5│..17│
      let symErrMsg = "";
      try {
        await splice(ctxTs, {
          symbol: "targetFn",
          code: "export function targetFn(x: number): number { if ((( return x; }",
          projectRoot: tmpDir,
        });
      } catch (err) {
        symErrMsg = err instanceof Error ? err.message : String(err);
      }
      expect(symErrMsg).toContain("Pre-write syntax validation failed");
      expect(symErrMsg).toContain("5│ export const C_5 = 5;");
      expect(symErrMsg).toContain("10│ export function targetFn(x: number): number {");
      expect(symErrMsg).toContain("17│ export const C_17 = 17;");
    });

    it("Step 5.4: guards maskSourceLexically against null/undefined and rejects malformed/empty batch headers without TypeError", async () => {
      // 1. Preprocessor null/undefined safety
      const maskedUndef = maskSourceLexically(undefined as unknown as string, "typescript");
      expect(maskedUndef.maskedCode).toBe("");
      expect(maskedUndef.maskTable).toEqual([]);

      const maskedNull = maskSourceLexically(null as unknown as string, "python");
      expect(maskedNull.maskedCode).toBe("");
      expect(maskedNull.maskTable).toEqual([]);

      expect(
        unmaskLexicalTokens(undefined as unknown as string, undefined as unknown as string[]),
      ).toBe("");

      const preprocUndef = preprocessHybridAndIdiomsLossless(
        undefined as unknown as string,
        "typescript",
      );
      expect(preprocUndef).toBe("");
      expect(isHybridOrNativeSource(undefined as unknown as string, "typescript")).toBe(false);
      // 2. Malformed/empty === ... === headers and missing body blocks produce clean descriptive Errors (never TypeError)
      const malformedStreams = [
        `${EQ} ${EQ}\nexport const A = 1;`,
        `${EQ}${EQ}\nexport const A = 1;`,
        `${EQ} : ${EQ}\nexport const A = 1;`,
        `${EQ} src/bad.ts: ${EQ}\nexport const A = 1;`,
        `${EQ} src/unclosed.ts\nexport const A = 1;`,
        `${EQ} :orphanSym ${EQ}\nexport const A = 1;`,
        `${EQ} src/missing_body.ts ${EQ}`,
        [`${EQ} src/empty_first.ts ${EQ}`, `${EQ} src/second.ts ${EQ}`, "export const B = 2;"].join(
          "\n",
        ),
      ];

      for (const badStream of malformedStreams) {
        let caught: unknown;
        try {
          parseMultiBlockSpliceStream(badStream);
        } catch (err) {
          caught = err;
        }
        expect(caught).toBeInstanceOf(Error);
        expect(caught).not.toBeInstanceOf(TypeError);
        expect((caught as Error).message).toMatch(/malformed|empty|missing/i);
      }

      // Also verify spliceBatch handles nullish entries or malformed streams without TypeError
      let batchCaught: unknown;
      try {
        await spliceBatch([null as unknown as never], { projectRoot: tmpDir });
      } catch (err) {
        batchCaught = err;
      }
      expect(batchCaught).toBeInstanceOf(Error);
      expect(batchCaught).not.toBeInstanceOf(TypeError);
    });

    it("Step 6.3: respects idiomsEnabled: false default and records honest signed negative telemetry deltas without clamping", async () => {
      // 1. Default idiomsEnabled: false leaves valid JS $-identifiers untouched even when idioms exist in aice.config.json
      const jsIdentFile = path.join(tmpDir, "src", "ident_guard.ts");
      const identRes = await splice(jsIdentFile, {
        code: [
          "export function applyFn($clampUnit: (v: number) => number, x: number): number {",
          "  return $clampUnit(x);",
          "}",
        ].join("\n"),
        projectRoot: tmpDir,
      });
      expect(identRes.success).toBe(true);
      expect(identRes.idiomsUsed).toBe(false);
      expect(fs.readFileSync(jsIdentFile, "utf-8")).toContain("return $clampUnit(x);");

      // Opting in via `idioms: true` expands $clampUnit as expected
      const optInFile = path.join(tmpDir, "src", "ident_optin.ts");
      const optInRes = await splice(optInFile, {
        code: ["export function clamped(x: number): number {", "  return $clampUnit(x);", "}"].join(
          "\n",
        ),
        idioms: true,
        projectRoot: tmpDir,
      });
      expect(optInRes.success).toBe(true);
      expect(optInRes.idiomsUsed).toBe(true);
      expect(fs.readFileSync(optInFile, "utf-8")).toContain("Math.min(1, Math.max(0, x))");

      // 2. Signed negative telemetry delta recording when AICE envelope exceeds baseline edit size
      const telemetryFile = path.join(tmpDir, "gains.jsonl");
      const prevTelemetryEnv = process.env.AICE_TELEMETRY_PATH;
      process.env.AICE_TELEMETRY_PATH = telemetryFile;
      try {
        const tinyTarget = path.join(tmpDir, "src", "tiny_neg.ts");
        fs.writeFileSync(tinyTarget, "export const N = 1;\n", "utf-8");

        // Surgical hunk whose pre-header comments + === header === + <<< === >>> envelope exceeds both file and realistic edit_file baselines
        const verboseHunkEnvelope = [
          "# AICE stream envelope metadata header line 1 (inflating raw AICE token envelope above native edit_file baseline)",
          "# AICE stream envelope metadata header line 2 (ensuring honest negative realisticSavedCl100k without clamping)",
          "# AICE stream envelope metadata header line 3 (verifying signed negative delta accounting end-to-end)",
          `${EQ} ${tinyTarget} ${EQ}`,
          HK_OPEN,
          "export const N = 1;",
          EQ,
          "export const N = 2;",
          HK_CLOSE,
        ].join("\n");

        const negSpliceRes = await splice(tinyTarget, {
          code: verboseHunkEnvelope,
          projectRoot: tmpDir,
        });
        expect(negSpliceRes.success).toBe(true);
        expect(negSpliceRes.tokensSaved).toBeLessThan(0);
        expect(negSpliceRes.realisticTokensSaved).toBeDefined();
        expect(negSpliceRes.realisticTokensSaved ?? 0).toBeLessThan(0);

        // Greenfield create with unused @idiom declarations + header wrapper whose raw input exceeds both native file & write_file JSON baseline
        const tinyCreated = path.join(tmpDir, "src", "tiny_created_neg.ts");
        const negCreateRes = await splice(tinyCreated, {
          code: [
            "@idiom $unusedHelperOne($x) = ($x + 1000)",
            "@idiom $unusedHelperTwo($y) = ($y * 2000)",
            "@idiom $unusedHelperThree($z) = ($z - 3000)",
            `${EQ} src/tiny_created_neg.ts:overwrite ${EQ}`,
            "export const K = 1;",
          ].join("\n"),
          projectRoot: tmpDir,
        });
        expect(negCreateRes.success).toBe(true);
        expect(negCreateRes.tokensSaved).toBeLessThan(0);
        expect(negCreateRes.realisticTokensSaved ?? 0).toBeLessThan(0);

        // Batch splice with negative net delta (unused pre-header @idiom declarations exceeding both file & edit_file baseline)
        const batchTarget = path.join(tmpDir, "src", "tiny_batch_neg.ts");
        fs.writeFileSync(batchTarget, "export const B = 1;\n", "utf-8");
        const negBatchStream = [
          "@idiom $unusedBatchOne($a) = ($a + 100)",
          "@idiom $unusedBatchTwo($b) = ($b * 200)",
          "@idiom $unusedBatchThree($c) = ($c - 300)",
          `${EQ} src/tiny_batch_neg.ts:L1-L1 ${EQ}`,
          "export const B = 2;",
        ].join("\n");
        const negBatchRes = await spliceBatch(negBatchStream, { projectRoot: tmpDir });
        expect(negBatchRes.totalTokensSaved).toBeLessThan(0);
        // Verify persisted JSONL ledger events record negative savedCl100k & realisticSavedCl100k without clamping to 0
        const events = readTelemetryEvents(telemetryFile);
        expect(events.length).toBeGreaterThanOrEqual(3);
        const negSpliceEvents = events.filter((e) => e.operation === "splice" && e.savedCl100k < 0);
        expect(negSpliceEvents.length).toBeGreaterThanOrEqual(2);
        expect(negSpliceEvents.every((e) => (e.realisticSavedCl100k ?? 0) < 0)).toBe(true);

        const negCreateEvents = events.filter((e) => e.operation === "create" && e.savedCl100k < 0);
        expect(negCreateEvents.length).toBeGreaterThanOrEqual(1);
        expect(negCreateEvents[0]?.realisticSavedCl100k ?? 0).toBeLessThan(0);
      } finally {
        if (prevTelemetryEnv === undefined) {
          delete process.env.AICE_TELEMETRY_PATH;
        } else {
          process.env.AICE_TELEMETRY_PATH = prevTelemetryEnv;
        }
      }
    });

    it("CLI aice splice --no-idioms --stdin multi-target stream succeeds on >25-line existing full-rewrite without --overwrite, while empty truncation fails and aice create still guards >25-line files", () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      // 1. Create a 50-line existing file
      const radarLines = Array.from(
        { length: 50 },
        (_, i) => `export const radarParam${i + 1} = ${i + 1};`,
      );
      const existingRadarPath = path.join(srcDir, "existing_radar.ts");
      fs.writeFileSync(existingRadarPath, `${radarLines.join("\n")}\n`, "utf-8");

      // 2. Create a surgical edit target
      const editTargetPath = path.join(srcDir, "edit_target.ts");
      fs.writeFileSync(
        editTargetPath,
        "export const targetVal = 10;\nexport const secondLine = 20;\n",
        "utf-8",
      );

      // Multi-target stream: new file, surgical edit, full rewrite of >25-line existing file
      const multiStream = [
        "=== src/new_adapter.ts ===",
        "export class NewAdapter {",
        "  execute(): string {",
        '    return "success";',
        "  }",
        "}",
        "",
        "=== src/edit_target.ts:L1-L1 ===",
        "export const targetVal = 999;",
        "",
        "=== src/existing_radar.ts ===",
        "export const radarRewritten = true;",
        "export function readRadar(): string {",
        '  return "active";',
        "}",
      ].join("\n");

      const spliceRes = runCli(["splice", "--no-idioms", "--stdin"], tmpDir, multiStream);
      expect(spliceRes.status).toBe(0);

      // Verify files were correctly created/edited/rewritten
      const newAdapterContent = fs.readFileSync(path.join(srcDir, "new_adapter.ts"), "utf-8");
      expect(newAdapterContent).toContain("export class NewAdapter");

      const editContent = fs.readFileSync(editTargetPath, "utf-8");
      expect(editContent).toContain("export const targetVal = 999;");
      expect(editContent).toContain("export const secondLine = 20;");

      const radarContent = fs.readFileSync(existingRadarPath, "utf-8");
      expect(radarContent).toContain("export const radarRewritten = true;");
      expect(radarContent).not.toContain("radarParam1");

      // Empty truncation without :overwrite / --overwrite MUST fail
      const emptyTruncationStream = "=== src/existing_radar.ts ===\n";
      const truncateRes = runCli(
        ["splice", "--no-idioms", "--stdin"],
        tmpDir,
        emptyTruncationStream,
      );
      expect(truncateRes.status).not.toBe(0);
      expect(truncateRes.stderr + truncateRes.stdout).toMatch(
        /(?:Empty or malformed splice block|Refusing to overwrite.*empty content)/i,
      );

      // Truncation WITH :overwrite succeeds
      const overwriteTruncateStream = "=== src/existing_radar.ts:overwrite ===\n";
      const overwriteTruncateRes = runCli(
        ["splice", "--no-idioms", "--stdin"],
        tmpDir,
        overwriteTruncateStream,
      );
      expect(overwriteTruncateRes.status).toBe(0);
      expect(fs.readFileSync(existingRadarPath, "utf-8")).toBe("");

      // aice create on >25-line file MUST fail without --overwrite
      fs.writeFileSync(existingRadarPath, `${radarLines.join("\n")}\n`, "utf-8");
      const createRes = runCli(
        ["create", "src/existing_radar.ts", "--stdin"],
        tmpDir,
        "export const blocked = true;\n",
      );
      expect(createRes.status).not.toBe(0);
      expect(createRes.stderr + createRes.stdout).toMatch(
        /already exists.*Do NOT rewrite existing files with 'aice create'/i,
      );

      // aice create with --overwrite succeeds
      const createOverwriteRes = runCli(
        ["create", "src/existing_radar.ts", "--overwrite", "--stdin"],
        tmpDir,
        "export const allowed = true;\n",
      );
      expect(createOverwriteRes.status).toBe(0);
      expect(fs.readFileSync(existingRadarPath, "utf-8")).toContain("export const allowed = true;");
    });
  });

  describe("7. AICE v0.9.42: Python-Style Half-Open [startLine, endLine) (endLine - 1) Auto-Aligner & No-Op Guard", () => {
    it("auto-aligns half-open line ranges in multi-block .aipl spliceBatch across TypeScript and Python while honoring No-Op Guard", async () => {
      const srcDir = path.join(tmpDir, "src");
      fs.mkdirSync(srcDir, { recursive: true });

      // Case 1: L[end] is `import {` (opening brace delimiter imbalance without half-open auto-alignment)
      const case1Path = path.join(srcDir, "case1_import.ts");
      fs.writeFileSync(
        case1Path,
        [
          'export const header = "my-app";',
          "export const config = { port: 3000 };",
          "export const debug = true;",
          "import {",
          "  helper,",
          '} from "./helper.js";',
          "export function run(): string {",
          "  return helper();",
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Case 2: L[end] is a valid statement `if sym == "#": ...` in Python (previously silently deleted L[end])
      const case2Path = path.join(srcDir, "case2_python.py");
      fs.writeFileSync(
        case2Path,
        [
          "def parse_token(sym: str) -> bool:",
          "    val = sym.strip()",
          "    return len(val) > 0",
          'if sym == "#":',
          '    print("comment")',
          "",
        ].join("\n"),
        "utf-8",
      );

      // Case 3: Inside indented function where L[end-1] is blank and L[end] is column-0 `/// Step ...` doc comment
      const case3Path = path.join(srcDir, "case3_doc.ts");
      fs.writeFileSync(
        case3Path,
        [
          "export class Worker {",
          "  public execute(task: string): boolean {",
          '    const mode = "standard";',
          "    return mode.length > 0;",
          "  }",
          "}",
          "",
          "/// Step 2 worker execution pipeline",
          "export function step2(): string {",
          '  return "step2";',
          "}",
          "",
        ].join("\n"),
        "utf-8",
      );

      // Case 4: Replacing L1-L3 with verbatim L1-L2 (candRep.trim() === candSlice.trim()) must delete L3 via No-Op Guard
      const case4Path = path.join(srcDir, "case4_delete.ts");
      fs.writeFileSync(
        case4Path,
        ["let a = 1;", "let b = 2;", "let c = 3;", ""].join("\n"),
        "utf-8",
      );

      // Multi-block .aipl splice stream using Python-style half-open [startLine, endLine) boundaries
      const multiBlockAipl = [
        "=== src/case1_import.ts:L1-L4 ===",
        'export const header = "my-app";',
        "export const config = { port: 8080 };",
        "export const debug = true;",
        "",
        "=== src/case2_python.py:L1-L4 ===",
        "def parse_token(sym: str) -> bool:",
        "    val = sym.strip().lower()",
        "    return len(val) > 0",
        "",
        "=== src/case3_doc.ts:L2-L8 ===",
        "  public execute(task: string): boolean {",
        '    const mode = "accelerated";',
        "    return mode.length > 0;",
        "  }",
        "}",
        "",
        "=== src/case4_delete.ts:L1-L3 ===",
        "let a = 1;",
        "let b = 2;",
      ].join("\n");

      // Save multi-block .aipl file and run spliceBatch
      const patchAiplPath = path.join(tmpDir, "patch.aipl");
      fs.writeFileSync(patchAiplPath, `${multiBlockAipl}\n`, "utf-8");

      const batchRes = await spliceBatch(multiBlockAipl, { projectRoot: tmpDir, idioms: false });
      expect(batchRes.success).toBe(true);
      expect(batchRes.totalEdits).toBe(4);

      // Verify Case 1: config updated, import { preserved intact
      const case1Content = fs.readFileSync(case1Path, "utf-8");
      expect(case1Content).toContain("port: 8080");
      expect(case1Content).toContain("import {");
      expect(case1Content).toContain('} from "./helper.js";');
      expect(case1Content).toContain("export function run(): string");

      // Verify Case 2: parse_token updated with .lower(), if sym == "#": preserved intact
      const case2Content = fs.readFileSync(case2Path, "utf-8");
      expect(case2Content).toContain("val = sym.strip().lower()");
      expect(case2Content).toContain('if sym == "#":');
      expect(case2Content).toContain('print("comment")');

      // Verify Case 3: Worker.execute updated, column-0 /// Step 2 doc comment preserved intact
      const case3Content = fs.readFileSync(case3Path, "utf-8");
      expect(case3Content).toContain('"accelerated"');
      expect(case3Content).toContain("/// Step 2 worker execution pipeline");
      expect(case3Content).toContain("export function step2(): string");

      // Verify Case 4: No-Op Guard ensured L1-L3 replacement deleted L3 (let c = 3)
      const case4Content = fs.readFileSync(case4Path, "utf-8");
      expect(case4Content).toContain("let a = 1;");
      expect(case4Content).toContain("let b = 2;");
      expect(case4Content).not.toContain("let c = 3;");
    });
  });

  describe("8. AICE v0.9.43: Null-Guard, JSON-Stringified Array Support & Self-Healing MCP aice_splice", () => {
    it("throws actionable self-healing flat code guidance when called with [null] array glitch (and does not crash with TypeError)", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // a1) filePath with edits: [null, null, null, null, null]
      await expect(
        server.handleRequest(1, "tools/call", {
          name: "aice_splice",
          arguments: {
            filePath: "src/game.aipl",
            edits: [null, null, null, null, null],
          },
        }),
      ).rejects.toThrow(
        /Invalid null or non-object item in aice_splice 'edits'\/'files' array[\s\S]*=== src\/game\.aipl:L15-L21 ===[\s\S]*=== src\/game\.aipl:MySymbol ===/,
      );

      // a2) edits: [null] without filePath
      await expect(
        server.handleRequest(2, "tools/call", {
          name: "aice_splice",
          arguments: {
            edits: [null],
          },
        }),
      ).rejects.toThrow(
        /Invalid null or non-object item in aice_splice 'edits'\/'files' array[\s\S]*=== src\/app\.ts:L15-L21 ===/,
      );

      // a3) files: [null]
      await expect(
        server.handleRequest(3, "tools/call", {
          name: "aice_splice",
          arguments: {
            files: [null],
          },
        }),
      ).rejects.toThrow(/Invalid null or non-object item in aice_splice 'edits'\/'files' array/);

      // a4) files with entry.edits: [null]
      await expect(
        server.handleRequest(4, "tools/call", {
          name: "aice_splice",
          arguments: {
            files: [{ filePath: "src/game.aipl", edits: [null] }],
          },
        }),
      ).rejects.toThrow(
        /Invalid null or non-object item in aice_splice 'edits'\/'files' array[\s\S]*=== src\/game\.aipl:L15-L21 ===/,
      );
    });

    it("applies edits cleanly when edits argument is passed as a JSON-stringified array", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });
      const testFile = path.join(tmpDir, "src", "json_edits.ts");
      fs.mkdirSync(path.dirname(testFile), { recursive: true });
      fs.writeFileSync(
        testFile,
        "export function greet(): string {\n  return 'hello';\n}\n",
        "utf-8",
      );

      const jsonEdits = JSON.stringify([
        {
          symbol: "greet",
          code: "export function greet(): string {\n  return 'world';\n}",
        },
      ]);

      const res = await server.executeToolCall("aice_splice", {
        filePath: "src/json_edits.ts",
        edits: jsonEdits,
      });

      expect(res.isError).toBeFalsy();
      expect(fs.readFileSync(testFile, "utf-8")).toContain("return 'world';");
    });

    it("produces an actionable error containing both 'Empty or malformed splice block' and '--delete' on empty splice block", async () => {
      expect(() =>
        parseMultiBlockSpliceStream("=== src/world/spatial_math.aipl:L48-L51 ===\n"),
      ).toThrowError(/Empty or malformed splice block/);

      try {
        parseMultiBlockSpliceStream("=== src/world/spatial_math.aipl:L48-L51 ===\n");
      } catch (err: unknown) {
        expect(err instanceof Error).toBe(true);
        const msg = (err as Error).message;
        expect(msg).toContain("Empty or malformed splice block");
        expect(msg).toContain("--delete");
        expect(msg).toContain("=== src/world/spatial_math.aipl:L48-L51 --delete ===");
      }
    });

    it("attaches 'Closest disk context [L...] (±5 numbered lines)' on Hunk search block not found without breaking symbol-hunk error assertions", async () => {
      const targetTs = path.join(tmpDir, "src", "closest_disk_ctx.ts");
      fs.mkdirSync(path.dirname(targetTs), { recursive: true });
      const fileLines = [
        "export function calculateInvoice(qty: number, unitPrice: number): number {",
        "  const subtotal = qty * unitPrice;",
        "  if (subtotal <= 0) {",
        "    return 0;",
        "  }",
        "  const taxRate = 0.08;",
        "  const taxAmount = subtotal * taxRate;",
        "  const grandTotal = subtotal + taxAmount;",
        "  return grandTotal;",
        "}",
      ];
      fs.writeFileSync(targetTs, fileLines.join("\n") + "\n", "utf-8");

      // 1. File-level hunk with slight mismatch
      const fileHunkSnippet = [
        "<<<",
        "  const taxRate = 0.09;",
        "  const taxAmount = subtotal * taxRate;",
        "===",
        "  const taxRate = 0.10;",
        "  const taxAmount = subtotal * taxRate;",
        ">>>",
      ].join("\n");

      await expect(
        splice(targetTs, { code: fileHunkSnippet, projectRoot: tmpDir }),
      ).rejects.toThrowError(/Hunk search block not found in/);

      try {
        await splice(targetTs, { code: fileHunkSnippet, projectRoot: tmpDir });
      } catch (err: unknown) {
        expect(err instanceof Error).toBe(true);
        const msg = (err as Error).message;
        expect(msg).toContain("Hunk search block not found in");
        expect(msg).toContain("Closest disk context [L");
        expect(msg).toContain("(retry splice directly without re-reading)");
        expect(msg).toMatch(/\d+│\s+const taxAmount = subtotal \* taxRate;/);
      }

      // 2. Symbol-level hunk with slight mismatch preserves symbol label in error message
      const symHunkSnippet = [
        "<<<",
        "  const subtotal = qty * unitPrice * 2;",
        "===",
        "  const subtotal = qty * unitPrice * 3;",
        ">>>",
      ].join("\n");

      await expect(
        splice(targetTs, {
          symbol: "calculateInvoice",
          code: symHunkSnippet,
          projectRoot: tmpDir,
        }),
      ).rejects.toThrowError(/within 'calculateInvoice'/);
    });
  });
});
