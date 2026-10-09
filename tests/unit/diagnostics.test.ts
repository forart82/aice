import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { createPosition, createSpan } from "../../src/core/span.js";
import { check } from "../../src/typechecker/checker.js";
import {
  type AilDiagnostic,
  buildReportFromError,
  formatDiagnosticJson,
  formatDiagnosticText,
  generateCandidateRepair,
  generateCaretSlice,
} from "../../src/typechecker/diagnostics.js";

describe("AIL 2.0 Machine-Readable Diagnostics & Autonomous Self-Repair Engine", () => {
  describe("Visual Caret Slice Generation", () => {
    it("generates contextual line numbers and caret underlines aligned with columns", () => {
      const src = `fn compute():
  let x = 10
  let y = 100 / 0
  ret y`;

      const span = createSpan("test.ail", createPosition(3, 17, 36), createPosition(3, 18, 37));

      const caretSlice = generateCaretSlice(src, span, 1);
      expect(caretSlice).toContain("  2 |   let x = 10");
      expect(caretSlice).toContain("> 3 |   let y = 100 / 0");
      expect(caretSlice).toContain("    |                 ^");
      expect(caretSlice).toContain("  4 |   ret y");
    });
  });

  describe("Autonomous Candidate Repair Patch Synthesis", () => {
    it("synthesizes unified diff patch for immutable assignment (let -> let mut)", () => {
      const src = `fn counter():
  let count = 0
  count = 1
  ret count`;

      const span = createSpan("counter.ail", createPosition(3, 3, 32), createPosition(3, 8, 37));

      const repair = generateCandidateRepair(
        "AIL_E2005_IMMUTABLE_ASSIGNMENT",
        "Cannot assign to immutable variable 'count'",
        span,
        src,
        "counter.ail",
      );

      expect(repair).toBeDefined();
      expect(repair?.description).toContain("let mut");
      expect(repair?.patch).toContain("-  let count = 0");
      expect(repair?.patch).toContain("+  let mut count = 0");
    });

    it("synthesizes unified diff patch for division by literal zero", () => {
      const src = `fn calc():
  let div = 42 / 0
  ret div`;

      const span = createSpan("calc.ail", createPosition(2, 18, 28), createPosition(2, 19, 29));

      const repair = generateCandidateRepair(
        "AIL_E2003_DIVISION_BY_ZERO",
        "Division by zero detected at compile time",
        span,
        src,
        "calc.ail",
      );

      expect(repair).toBeDefined();
      expect(repair?.patch).toContain("-  let div = 42 / 0");
      expect(repair?.patch).toContain("+  let div = 42 / 1 /* divisor must be non-zero */");
    });

    it("synthesizes unified diff patch for non-boolean truthiness conditionals", () => {
      const src = `fn check(items:[int]):
  if items:
    ret 1`;

      const span = createSpan("check.ail", createPosition(2, 3, 25), createPosition(2, 11, 33));

      const repair = generateCandidateRepair(
        "AIL_E2001_NON_BOOLEAN_CONDITION",
        "Condition in 'if' statement must evaluate strictly to 'bool'",
        span,
        src,
        "check.ail",
      );

      expect(repair).toBeDefined();
      expect(repair?.patch).toContain("-  if items:");
      expect(repair?.patch).toContain("+  if not items.isEmpty():");
    });
  });

  describe("Structured Machine-Readable JSON Telemetry", () => {
    it("builds compliant single-root JSON diagnostic from compiler exceptions", () => {
      const src = `fn test():
  if 42:
    ret 1`;

      let report: ReturnType<typeof buildReportFromError> | undefined;

      try {
        const mod = parse(src, "test.ail");
        check(mod);
      } catch (err) {
        report = buildReportFromError(err, src, "test.ail");
      }

      expect(report).toBeDefined();
      if (!report) return;

      expect(report.status).toBe("FAILURE");
      expect(report.file).toBe("test.ail");
      expect(report.diagnostics).toHaveLength(1);

      const primary = report.primary_diagnostic as AilDiagnostic;
      expect(primary.status).toBe("REJECTED");
      expect(primary.error_phase).toBe("TYPECHECKING");
      expect(primary.violation.code).toBe("AIL_E2001_NON_BOOLEAN_CONDITION");
      expect(primary.span.start.line).toBe(2);
      expect(primary.caret_slice).toContain("> 2 |   if 42:");
      expect(primary.caret_slice).toContain("^");

      const jsonStr = formatDiagnosticJson(report);
      const parsedJson = JSON.parse(jsonStr);
      expect(parsedJson.status).toBe("FAILURE");
      expect(parsedJson.diagnostics[0].violation.code).toBe("AIL_E2001_NON_BOOLEAN_CONDITION");
    });

    it("formats readable human text diagnostics with carets and hints", () => {
      const src = `fn test():
  let x = 1
  x = 2`;

      let report: ReturnType<typeof buildReportFromError> | undefined;

      try {
        const mod = parse(src, "test.ail");
        check(mod);
      } catch (err) {
        report = buildReportFromError(err, src, "test.ail");
      }

      expect(report).toBeDefined();
      if (!report) return;

      const humanText = formatDiagnosticText(report);
      expect(humanText).toContain("❌ [TYPECHECKING] AIL_E2005_IMMUTABLE_ASSIGNMENT");
      expect(humanText).toContain("--> test.ail:3:3");
      expect(humanText).toContain("> 3 |   x = 2");
      expect(humanText).toContain("Suggested Autonomous Repair");
      expect(humanText).toContain("let mut x");
    });
  });
});
