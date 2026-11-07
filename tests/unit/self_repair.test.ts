/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Autonomous Self-Repair Engine & Unified Diff Telemetry (Step 14).
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { TypeChecker } from "../../src/typechecker/checker.js";
import { applyUnifiedDiffPatch, attemptSelfRepair } from "../../src/typechecker/diagnostics.js";

describe("Step 14: Autonomous Self-Repair Engine & Unified Diff Telemetry", () => {
  describe("Deterministic Unified Diff Patch Applicator", () => {
    it("applies a single-line replacement patch accurately", () => {
      const source = "let count = 0\ncount = count + 1\n";
      const patch =
        "--- test.aice\n+++ test.aice\n@@ -1,1 +1,1 @@\n-let count = 0\n+let mut count = 0";
      const result = applyUnifiedDiffPatch(source, patch);
      expect(result).toBe("let mut count = 0\ncount = count + 1\n");
    });

    it("applies bottom-to-top multi-hunk patches preserving line stability", () => {
      const source = "line1\nline2\nline3\nline4\n";
      const patch =
        "--- test.aice\n+++ test.aice\n@@ -2,1 +2,1 @@\n-line2\n+modified2\n@@ -4,1 +4,1 @@\n-line4\n+modified4";
      const result = applyUnifiedDiffPatch(source, patch);
      expect(result).toBe("line1\nmodified2\nline3\nmodified4\n");
    });
  });

  describe("Autonomous Self-Repair Workflow (SWE-bench / Reflexion)", () => {
    it("autonomously repairs immutable assignment by synthesizing let mut", () => {
      const brokenAice = `fn update_balance(initial: int) -> int:
  let balance = initial
  balance = balance + 100
  return balance`;

      // Verify that checking the broken code throws
      expect(() => {
        const mod = parse(brokenAice, "balance.aice");
        new TypeChecker().checkModule(mod);
      }).toThrow(/Cannot assign to immutable variable 'balance'/);

      // Execute autonomous self-repair
      const res = attemptSelfRepair(brokenAice, "balance.aice");

      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.iterations).toBe(1);
      expect(res.repairs.length).toBe(1);
      expect(res.repairs[0].description).toContain("Change declaration of 'balance' to mutable");
      expect(res.finalSource).toContain("let mut balance = initial");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "balance.aice");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("autonomously repairs literal division by zero", () => {
      const brokenAice = `fn compute_rate(total: int) -> int:
  let rate = total / 0
  return rate`;

      const res = attemptSelfRepair(brokenAice, "rate.aice");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.finalSource).toContain("/ 1 /* divisor must be non-zero */");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "rate.aice");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("autonomously repairs non-boolean condition checking collection", () => {
      const brokenAice = `fn has_items(items: [int]) -> bool:
  if items:
    return true
  return false`;

      const res = attemptSelfRepair(brokenAice, "cond.aice");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(true);
      expect(res.finalSource).toContain("if not items.isEmpty():");

      // Verify repaired code passes compiler without error
      const fixedMod = parse(res.finalSource, "cond.aice");
      expect(() => new TypeChecker().checkModule(fixedMod)).not.toThrow();
    });

    it("returns clean status with zero modifications on already valid AICE code", () => {
      const validAice = `fn add(a: int, b: int) -> int:
  return a + b`;

      const res = attemptSelfRepair(validAice, "valid.aice");
      expect(res.fixed).toBe(true);
      expect(res.modified).toBe(false);
      expect(res.iterations).toBe(0);
      expect(res.repairs.length).toBe(0);
      expect(res.finalSource).toBe(validAice);
    });

    it("returns failure diagnostic report when error cannot be automatically resolved", () => {
      const unrepairableAice = `fn broken() -> int:
  return "cannot convert string to int"`;

      const res = attemptSelfRepair(unrepairableAice, "unfixable.aice");
      expect(res.fixed).toBe(false);
      expect(res.error).toBeDefined();
      expect(res.error?.primary_diagnostic?.violation.code).toBe("AICE_E2007_RETURN_TYPE_MISMATCH");
    });
  });
});
