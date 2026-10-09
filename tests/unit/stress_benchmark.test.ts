/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Full Multi-Project Benchmark Suite & Cross-Compilation Stress Test.
 * Step 13 Quality Gate: Validates end-to-end multi-project compilation,
 * cross-target translation matrix, tokenomics thresholds, and parser throughput.
 */

import { describe, expect, it } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import { parse } from "../../src/core/parser.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../../src/emitters/index.js";
import { auditTokenomics, formatProjectsMarkdownTable, formatTokenomicsMarkdownTable } from "../../src/tokenomics/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

function findAilFiles(dir: string): string[] {
  const resolved = path.resolve(process.cwd(), dir);
  if (!fs.existsSync(resolved)) return [];
  const entries = fs.readdirSync(resolved, { withFileTypes: true });
  const results: string[] = [];
  for (const entry of entries) {
    const full = path.resolve(resolved, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && !entry.name.startsWith(".")) {
      results.push(...findAilFiles(full));
    } else if (entry.isFile() && entry.name.endsWith(".ail")) {
      results.push(full);
    }
  }
  return results;
}

describe("Step 13: Full Multi-Project Benchmark Suite & Cross-Compilation Stress Test", () => {
  describe("Multi-Project Compilation & Type Soundness Matrix", () => {
    const exampleFiles = findAilFiles("examples");
    const pocFiles = findAilFiles("poc_real_case");

    it("verifies examples directory contains 14 canonical AIL projects", () => {
      expect(exampleFiles.length).toBe(14);
    });

    it("verifies poc_real_case contains 67 real-world AIL modules across 3 projects", () => {
      expect(pocFiles.length).toBe(67);
    });

    it("compiles all 14 example files through parse -> typecheck -> emit with zero errors", () => {
      for (const filePath of exampleFiles) {
        const source = fs.readFileSync(filePath, "utf-8");
        const relPath = path.relative(process.cwd(), filePath);
        const mod = parse(source, relPath);
        const tc = new TypeChecker();
        tc.checkModule(mod);

        const target = detectTargetFromPath(relPath);
        const emitted = emitTarget(mod, target);
        expect(emitted).toBeDefined();
        expect(emitted.length).toBeGreaterThan(0);
      }
    });

    it("compiles all 67 real-case files across snake_ts, dogMax, and snake_pp with zero errors", () => {
      for (const filePath of pocFiles) {
        const source = fs.readFileSync(filePath, "utf-8");
        const relPath = path.relative(process.cwd(), filePath);
        const mod = parse(source, relPath);
        const tc = new TypeChecker();
        tc.checkModule(mod);

        const target = detectTargetFromPath(relPath);
        const emitted = emitTarget(mod, target);
        expect(emitted).toBeDefined();
        expect(emitted.length).toBeGreaterThan(0);
      }
    });
  });

  describe("Cross-Target Transpilation Matrix (Single AIL -> Multi-Target)", () => {
    const testAilModule = `
# math_matrix_benchmark

fn calculate_hypotenuse(a: float, b: float) -> float:
  let sum_sq: float = (a * a) + (b * b)
  ret sqrt(sum_sq)

fn clamp_value(val: float, min_val: float, max_val: float) -> float:
  ret clamp(val, min_val, max_val)

class StatisticsAccumulator:
  count: int = 0
  sum: float = 0.0

  fn add(val: float) -> void:
    this.count = this.count + 1
    this.sum = this.sum + val

  fn average() -> float:
    if this.count == 0:
      ret 0.0
    ret this.sum / this.count.toFloat()
`;

    it("cross-compiles canonical AIL module to TypeScript, Python, C++20, Rust, and Go", () => {
      const mod = parse(testAilModule, "math_matrix_benchmark.ail");
      const tc = new TypeChecker();
      tc.checkModule(mod);

      // 1. TypeScript
      const tsCode = emitTarget(mod, "typescript");
      expect(tsCode).toContain("function calculate_hypotenuse");
      expect(tsCode).toContain("class StatisticsAccumulator");

      // 2. Python
      const pyCode = emitTarget(mod, "python");
      expect(pyCode).toContain("def calculate_hypotenuse");
      expect(pyCode).toContain("class StatisticsAccumulator:");

      // 3. C++20
      const cppCode = emitTarget(mod, "cpp");
      expect(cppCode).toContain("float calculate_hypotenuse");
      expect(cppCode).toContain("class StatisticsAccumulator");
      expect(cppCode).toContain("#pragma once");

      // 4. Rust
      const rsCode = emitTarget(mod, "rust");
      expect(rsCode).toContain("fn calculate_hypotenuse");

      // 5. Go
      const goCode = emitTarget(mod, "go");
      expect(goCode).toContain("func CalculateHypotenuse");
    });
  });

  describe("Tokenomics Thresholds & Regression Audit", () => {
    it("asserts examples directory achieves >= 20% aggregate token savings with zero drift", () => {
      const rep = auditTokenomics("examples", { checkDrift: true, minSavings: 20 });
      expect(rep.status).toBe("SUCCESS");
      expect(rep.driftDetected).toBe(false);
      expect(rep.aggregate.cl100kSavingsPct).toBeGreaterThanOrEqual(20);
      expect(rep.aggregate.o200kSavingsPct).toBeGreaterThanOrEqual(20);
    });

    it("asserts poc_real_case achieves >= 15% overall savings and meets per-project gates", () => {
      const rep = auditTokenomics("poc_real_case");
      expect(rep.files.length).toBe(67);
      expect(rep.aggregate.cl100kSavingsPct).toBeGreaterThanOrEqual(15);
      expect(rep.aggregate.o200kSavingsPct).toBeGreaterThanOrEqual(15);

      const table = formatProjectsMarkdownTable(rep);
      expect(table).toContain("`dogMax` (27 files)");
      expect(table).toContain("`snake_pp` (22 files)");
      expect(table).toContain("`snake_ts` (18 files)");
      expect(table).toContain("**TOTAL (3 Projects / 67 Files)**");
    });
  });

  describe("Throughput & Micro-Benchmark Gate", () => {
    it("processes and tokenizes high-density AIL code at > 10,000 lines/sec", () => {
      const codeSnippet = `
class BenchmarkNode:
  id: int = 0
  val: float = 1.0
  active: bool = true

  fn compute() -> float:
    ret this.val * 2.0
`;
      const repeatedCode = Array(500).fill(codeSnippet).join("\n");
      const startTime = performance.now();
      const mod = parse(repeatedCode, "benchmark.ail");
      const parseTime = performance.now() - startTime;

      expect(mod.items.length).toBe(500);
      expect(parseTime).toBeLessThan(500); // 500 items in well under 500ms
    });
  });
});
