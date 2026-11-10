import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";
import { applyTriviaLensToReplacement } from "../../src/core/trivia.js";
import {
  buildGainReport,
  computeTelemetryEvent,
  formatGlobalGainDashboard,
} from "../../src/telemetry/index.js";
import {
  parseMultiBlockSpliceStream,
  spliceBatch,
  spliceNativeSource,
} from "../../src/tools/splice.js";

describe("Component 1: Active CST Trivia Lens in trivia.ts & splice.ts", () => {
  it("preserves leading JSDoc when TypeScript function replacement omits it", () => {
    const source = [
      "/**",
      " * Computes the sum of two numbers.",
      " * @param a first operand",
      " * @param b second operand",
      " */",
      "export function add(a: number, b: number): number {",
      "  return a + b;",
      "}",
    ].join("\n");

    const replacement = [
      "export function add(a: number, b: number): number {",
      "  return a + b + 1;",
      "}",
    ].join("\n");

    const res = spliceNativeSource(source, { symbol: "add", code: replacement }, "math.ts");
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("Computes the sum of two numbers.");
    expect(res.modifiedCode).toContain("return a + b + 1;");
    expect(res.preservedTriviaTokens).toBeGreaterThan(0);
    // Ensure only 1 JSDoc comment exists (no duplication)
    const docMatches = res.modifiedCode.match(/\/\*\*/g);
    expect(docMatches?.length).toBe(1);
  });

  it("replaces leading JSDoc without duplication when replacement provides new JSDoc", () => {
    const source = [
      "/**",
      " * Old documentation.",
      " */",
      "export function multiply(a: number, b: number): number {",
      "  return a * b;",
      "}",
    ].join("\n");

    const replacement = [
      "/**",
      " * Updated new documentation.",
      " */",
      "export function multiply(a: number, b: number): number {",
      "  return a * b * 2;",
      "}",
    ].join("\n");

    const res = spliceNativeSource(source, { symbol: "multiply", code: replacement }, "math.ts");
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("Updated new documentation.");
    expect(res.modifiedCode).not.toContain("Old documentation.");
    // Ensure only 1 JSDoc comment exists
    const docMatches = res.modifiedCode.match(/\/\*\*/g);
    expect(docMatches?.length).toBe(1);
  });

  it("preserves Python docstring when replacement function omits docstring", () => {
    const source = [
      "def compute_tax(amount, rate):",
      '    """Calculates tax based on the given rate."""',
      "    return amount * rate",
    ].join("\n");

    const replacement = [
      "def compute_tax(amount, rate):",
      "    return round(amount * rate, 2)",
    ].join("\n");

    const res = spliceNativeSource(source, { symbol: "compute_tax", code: replacement }, "tax.py");
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain('"""Calculates tax based on the given rate."""');
    expect(res.modifiedCode).toContain("round(amount * rate, 2)");
    expect(res.preservedTriviaTokens).toBeGreaterThan(0);
  });

  it("respects @replace-docs or @strip-docs marker to explicitly drop trivia docs", () => {
    const trivia = {
      leadingDocComment: "/** Legacy doc */",
      indentation: "  ",
    };
    const replacement = "@replace-docs\nfunction greet() { return 'hi'; }";
    const res = applyTriviaLensToReplacement(trivia, replacement);
    expect(res.preservedTriviaText).toBe("");
    expect(res.mergedSnippet).not.toContain("Legacy doc");
    expect(res.mergedSnippet).not.toContain("@replace-docs");
  });

  it("removes leading JSDoc when preserveDocs is false or when @replace-docs is specified in spliceNativeSource", () => {
    const source = [
      "/**",
      " * Calculates total price with tax.",
      " */",
      "export function calculateTax(amount: number): number {",
      "  return amount * 1.1;",
      "}",
    ].join("\n");

    const replacement = [
      "export function calculateTax(amount: number): number {",
      "  return amount * 1.2;",
      "}",
    ].join("\n");

    // Case 1: preserveDocs: false
    const res1 = spliceNativeSource(
      source,
      { symbol: "calculateTax", code: replacement, preserveDocs: false },
      "tax.ts",
    );
    expect(res1.success).toBe(true);
    expect(res1.modifiedCode).not.toContain("Calculates total price");
    expect(res1.modifiedCode).toContain("return amount * 1.2;");
    expect(res1.modifiedCode).not.toContain("/**");

    // Case 2: @replace-docs marker
    const replacementWithMarker = [
      "// @replace-docs",
      "export function calculateTax(amount: number): number {",
      "  return amount * 1.25;",
      "}",
    ].join("\n");
    const res2 = spliceNativeSource(
      source,
      { symbol: "calculateTax", code: replacementWithMarker },
      "tax.ts",
    );
    expect(res2.success).toBe(true);
    expect(res2.modifiedCode).not.toContain("Calculates total price");
    expect(res2.modifiedCode).toContain("return amount * 1.25;");
    expect(res2.modifiedCode).not.toContain("/**");
  });

  it("preserves Python docstring with type-annotated signatures and multi-line body", () => {
    const source = [
      "def compute_tax(amount: float, rate: float = 0.2) -> float:",
      '    """Calculates tax based on the given rate.',
      "",
      "    Supports standard VAT rates.",
      '    """',
      "    return amount * rate",
    ].join("\n");

    const replacement = [
      "def compute_tax(amount: float, rate: float = 0.2) -> float:",
      "    return round(amount * rate, 2)",
    ].join("\n");

    const res = spliceNativeSource(source, { symbol: "compute_tax", code: replacement }, "tax.py");
    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain('"""Calculates tax based on the given rate.');
    expect(res.modifiedCode).toContain("Supports standard VAT rates.");
    expect(res.modifiedCode).toContain("round(amount * rate, 2)");
  });
});

describe("Component 2: Honest Telemetry & Token Accounting", () => {
  it("tracks realisticNativeText and computes realisticSavedCl100k", () => {
    const realisticPayload = JSON.stringify({
      path: "src/service.ts",
      old_string: "function old() {}",
      new_string: "function updated() {}",
    });
    const ev = computeTelemetryEvent({
      targetPath: "src/service.ts",
      operation: "splice",
      nativeText: "function updated() {}",
      realisticNativeText: realisticPayload,
      aiceText: "function updated() {}",
      preservedTriviaTokens: 25,
      structuralCompressionPct: 65,
    });

    expect(ev.realisticNativeCl100k).toBeDefined();
    expect(ev.realisticNativeCl100k).toBeGreaterThan(0);
    expect(ev.realisticSavedCl100k).toBeDefined();
    expect(ev.preservedTriviaTokens).toBe(25);
    expect(ev.structuralCompressionPct).toBe(65);
  });

  it("aggregates realistic tokens in buildGainReport and formatGlobalGainDashboard", () => {
    const report = buildGainReport();
    expect(report.totalRealisticNativeCl100k).toBeDefined();
    expect(report.totalRealisticSavedCl100k).toBeDefined();
    expect(report.totalPreservedTriviaTokens).toBeDefined();

    const formatted = formatGlobalGainDashboard(report);
    expect(formatted).toContain("AICE GAIN — 100% HONEST BPE TOKEN SAVINGS TELEMETRY");
  });
});

describe("Component 3: Native-Ergonomic Idioms & @clone Splicing", () => {
  it("parses @clone(SourceSymbol) in multi-block splice stream headers", () => {
    const stream = [
      "=== tests/auth.test.ts:TC-AUTH-002 @clone(TC-AUTH-001) ===",
      '"user" -> "admin"',
      "200 -> 201",
    ].join("\n");

    const parsed = parseMultiBlockSpliceStream(stream, "tests/auth.test.ts");
    expect(parsed?.singleFileEdits).toBeDefined();
    expect(parsed?.singleFileEdits?.[0]?.cloneFrom).toBe("TC-AUTH-001");
    expect(parsed?.singleFileEdits?.[0]?.symbol).toBe("TC-AUTH-002");
  });

  it("parses space-separated @clone sourceSym in multi-block splice stream headers", () => {
    const stream = [
      "=== src/calc.ts:Calculator.subtract @clone Calculator.add ===",
      '"+" -> "-"',
    ].join("\n");

    const parsed = parseMultiBlockSpliceStream(stream, "src/calc.ts");
    expect(parsed?.singleFileEdits).toBeDefined();
    expect(parsed?.singleFileEdits?.[0]?.cloneFrom).toBe("Calculator.add");
    expect(parsed?.singleFileEdits?.[0]?.symbol).toBe("Calculator.subtract");
  });

  it("clones and mutates class methods with substitution rules", () => {
    const source = [
      "export class UserService {",
      "  public createUser(name: string): User {",
      '    return { id: "1", name, role: "user" };',
      "  }",
      "}",
    ].join("\n");

    const stream = [
      "=== UserService.createAdmin @clone(UserService.createUser) ===",
      '"user" -> "admin"',
    ].join("\n");

    const parsed = parseMultiBlockSpliceStream(stream, "service.ts");
    const edit = parsed?.singleFileEdits?.[0];
    expect(edit).toBeDefined();
    if (!edit) throw new Error("Expected parsed @clone edit");
    const res = spliceNativeSource(source, edit, "service.ts");

    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("public createUser");
    expect(res.modifiedCode).toContain("public createAdmin");
    expect(res.modifiedCode).toContain('role: "admin"');
  });

  it("clones test blocks and auto-substitutes test identifier", () => {
    const source = [
      'test("TC-MATH-001: basic addition", () => {',
      "  expect(add(1, 2)).toBe(3);",
      "});",
    ].join("\n");

    const stream = ["=== TC-MATH-002 @clone(TC-MATH-001) ===", "1, 2 -> 2, 3", "3 -> 5"].join("\n");

    const parsed = parseMultiBlockSpliceStream(stream, "math.test.ts");
    const edit = parsed?.singleFileEdits?.[0];
    expect(edit).toBeDefined();
    if (!edit) throw new Error("Expected parsed @clone test edit");
    const res = spliceNativeSource(source, edit, "math.test.ts");

    expect(res.success).toBe(true);
    expect(res.modifiedCode).toContain("TC-MATH-001");
    expect(res.modifiedCode).toContain("TC-MATH-002");
    expect(res.modifiedCode).toContain("add(2, 3)).toBe(5)");
  });

  it("executes @clone end-to-end via spliceBatch on disk, preserves CRLF line endings, and rolls back atomically on missing @clone source", async () => {
    const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-clone-e2e-"));
    try {
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify({ enabled: true, idiomsEnabled: true }, null, 2),
        "utf-8",
      );
      const authFile = path.join(tmpDir, "auth.ts");
      const crlfOriginal = [
        "export class AuthSvc {",
        "  public loginUser(email: string): string {",
        '    return "user:" + email;',
        "  }",
        "}",
        "",
      ].join("\r\n");
      fs.writeFileSync(authFile, crlfOriginal, "utf-8");

      const parsedOk = parseMultiBlockSpliceStream(
        [
          `=== ${authFile}:AuthSvc.loginAdmin @clone(AuthSvc.loginUser) ===`,
          '"user:" -> "admin:"',
        ].join("\r\n"),
      );
      expect(parsedOk?.batchItems).toHaveLength(1);
      await spliceBatch(parsedOk?.batchItems ?? [], { projectRoot: tmpDir });

      const written = fs.readFileSync(authFile, "utf-8");
      expect(written).toContain("public loginUser(email: string): string");
      expect(written).toContain("public loginAdmin(email: string): string");
      expect(written).toContain('"admin:" + email');
      expect(written.includes("\r\n")).toBe(true);
      expect(written.replace(/\r\n/g, "")).not.toContain("\n");

      const secondFile = path.join(tmpDir, "second.ts");
      fs.writeFileSync(secondFile, "export const KEEP_ME = 1;\n", "utf-8");
      const snapshotAuth = fs.readFileSync(authFile, "utf-8");

      const parsedFail = parseMultiBlockSpliceStream(
        [
          `=== ${secondFile}:KEEP_ME ===`,
          "export const KEEP_ME = 999;",
          `=== ${authFile}:AuthSvc.loginSuper @clone(AuthSvc.nonExistentMethod) ===`,
          '"user" -> "super"',
        ].join("\n"),
      );
      await expect(
        spliceBatch(parsedFail?.batchItems ?? [], { projectRoot: tmpDir }),
      ).rejects.toThrow(/not found/i);

      expect(fs.readFileSync(secondFile, "utf-8")).toBe("export const KEEP_ME = 1;\n");
      expect(fs.readFileSync(authFile, "utf-8")).toBe(snapshotAuth);
    } finally {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });
});
