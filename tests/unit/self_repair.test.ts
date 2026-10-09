/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Autonomous Self-Repair Engine & Unified Diff Telemetry (Step 14).
 */

import { describe, expect, it } from "vitest";
import {
  applyUnifiedDiffPatch,
  attemptSelfRepair,
  buildReportFromError,
} from "../../src/typechecker/diagnostics.js";
import { parse } from "../../src/core/parser.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Step 14: Autonomous Self-Repair Engine & Unified Diff Telemetry", () => {
  describe("Deterministic Unified Diff Patch Applicator", () => {
    it("applies a single-line replacement patch accurately", () => {
      const source = "let count = 0\ncount = count + 1\n";
      const patch =
        "--- test.ail\n+++ test.ail\n@@ -1,1 +1,1 @@\n-let count = 0\n+let mut count = 0";
      const result = applyUnifiedDiffPatch(source, patch);
      expect(result).toBe("let mut count = 0\ncount = count + 1\n");
    });

    it("applies bottom-to-top multi-hunk patches preserving line stability", () => {
      const source = "line1\nline2\nline3\nline4\n";
      const patch =
        "--- test.ail\n+++ test.ail\n@@ -2,1 +2,1 @@\n-line2\n+modified2\n@@ -4,1 +4,1 @@\n-line4\n+modified4";
      const result = applyUnifiedDiffPatch(source, patch);
      expect(result).toBe("line1\nmodified2\nline3\nmodified4\n");
    });
  });

  describe("Autonomous Self-Repair Workflow (SWE-bench / Reflexion)", () => {
    it("autonomously repairs immutable assignment by synthesizing let mut", () => {
      const brokenAil = `fn update_balance(initial: int) -> int:
  let balance = initial
  balance = balance + 100
  return balance`;

      // Verify that checking the broken code throws
      expect(() => {
        const mod = parse(brokenAil, "balance.ail");
        new TypeChecker().checkModule(mod);
      }).toThrow(/Cannot assign to immutable variable 'balance'/);

      // Execute autonomous self-repair
      const res = attemptSelfRepair(brokenAil, "balance.ail");

      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.iterations).toBe(1);
      expect(res.repairs.length).toBe(1);
      expect(res.repairs[0].description).toContain("Change declaration of 'balance' to mutable");
      expect(res.finalSource).toContain("let mut balance = initial");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "balance.ail");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("autonomously repairs literal division by zero", () => {
      const brokenAil = `fn compute_rate(total: int) -> int:
  let rate = total / 0
  return rate`;

      const res = attemptSelfRepair(brokenAil, "rate.ail");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.finalSource).toContain("/ 1 /* divisor must be non-zero */");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "rate.ail");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("autonomously repairs non-boolean condition checking collection", () => {
      const brokenAil = `fn has_items(items: [int]) -> bool:
  if items:
    return true
  return false`;

      const res = attemptSelfRepair(brokenAil, "cond.ail");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.finalSource).toContain("if not items.isEmpty():");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "cond.ail");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("returns clean status with zero modifications on already valid AIL code", () => {
      const validAil = `fn add(a: int, b: int) -> int:
  return a + b`;

      const res = attemptSelfRepair(validAil, "valid.ail");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(false);
      expect(res.iterations).toBe(0);
      expect(res.repairs.length).toBe(0);
      expect(res.finalSource).toBe(validAil);
    });

    it("returns failure diagnostic report when error cannot be automatically resolved", () => {
      const unrepairableAil = `fn broken() -> int:
  return "cannot convert string to int"`;

      const res = attemptSelfRepair(unrepairableAil, "unfixable.ail");
      expect(res.fixed).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.error?.primary_diagnostic?.violation.code).toBe("AIL_E2007_RETURN_TYPE_MISMATCH");
    });
  });
});
