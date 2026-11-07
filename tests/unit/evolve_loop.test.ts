/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Autonomous Evolution, Differential Fuzzing & Self-Healing Loop Test Suite.
 * Validates 100 full restarts (1,000 cycles) across all target languages with 0 unhealed failures.
 */

import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import { decompile } from "../../src/decompiler/index.js";
import { emitTarget } from "../../src/emitters/index.js";
import {
  DOGFOOD_COMPILER_FILES,
  findCorpusFiles,
  FUZZ_TARGET_LANGUAGES,
  generateFuzzAiceProgram,
  generateHallucinatedAiceProgram,
  generateRecursiveAiceProgram,
  mulberry32,
  runEvolutionCycle,
  runEvolutionLoop,
  runEvolutionLoopSync,
  runSelfHealingCampaign,
  runSelfHealingCampaignSync,
  shrinkFailingAiceSource,
} from "../../src/evolve/index.js";

describe("Autonomous Evolution & Self-Healing Engine (src/evolve)", () => {
  describe("PRNG & AST Fuzzer Generators", () => {
    it("generates deterministic pseudo-random sequences with mulberry32", () => {
      const rng1 = mulberry32(42);
      const rng2 = mulberry32(42);
      const seq1 = Array.from({ length: 10 }, () => rng1());
      const seq2 = Array.from({ length: 10 }, () => rng2());

      expect(seq1).toEqual(seq2);
      expect(seq1.every((n) => n >= 0 && n < 1)).toBe(true);
    });

    it("generates valid AICE fuzz programs spanning target languages and 12 archetypes", () => {
      const targetsCovered = new Set<string>();
      let hasMatch = false;
      let hasForLoop = false;
      let hasStringCsl = false;
      let hasOptionResult = false;
      let hasMultiParamIdiom = false;
      let hasWhileNestedIf = false;

      for (let seed = 1000; seed < 1100; seed++) {
        const prog = generateFuzzAiceProgram(seed);
        expect(prog.name).toBeTruthy();
        expect(prog.aiceSource.length).toBeGreaterThan(20);
        expect(FUZZ_TARGET_LANGUAGES).toContain(prog.target);
        targetsCovered.add(prog.target);

        if (prog.aiceSource.includes("match c:")) hasMatch = true;
        if (prog.aiceSource.includes("for item in items:")) hasForLoop = true;
        if (prog.aiceSource.includes(".startsWith(") || prog.aiceSource.includes(".trim()")) hasStringCsl = true;
        if (prog.aiceSource.includes("Option[int]") || prog.aiceSource.includes("Result[int, str]")) hasOptionResult = true;
        if (prog.aiceSource.includes("checkBoundsA")) hasMultiParamIdiom = true;
        if (prog.aiceSource.includes("while i < lim:") && prog.aiceSource.includes("+=")) hasWhileNestedIf = true;
      }

      // Should cover all 9 target languages across multiple seeds
      for (const lang of FUZZ_TARGET_LANGUAGES) {
        expect(targetsCovered.has(lang)).toBe(true);
      }

      // Archetypes 6..11 verification
      expect(hasMatch).toBe(true);
      expect(hasForLoop).toBe(true);
      expect(hasStringCsl).toBe(true);
      expect(hasOptionResult).toBe(true);
      expect(hasMultiParamIdiom).toBe(true);
      expect(hasWhileNestedIf).toBe(true);
    });

    it("generates hallucinated programs covering all 14 fault kinds", () => {
      const faultKinds = new Set<string>();

      for (let seed = 0; seed < 40; seed++) {
        const broken = generateHallucinatedAiceProgram(seed);
        expect(broken.name).toBeTruthy();
        expect(broken.brokenAiceSource.length).toBeGreaterThan(10);
        expect(broken.faultKind).toBeTruthy();
        faultKinds.add(broken.faultKind);
      }

      expect(faultKinds.has("division_by_zero")).toBe(true);
      expect(faultKinds.has("js_triple_eq")).toBe(true);
      expect(faultKinds.has("js_not_triple_eq")).toBe(true);
      expect(faultKinds.has("js_null")).toBe(true);
      expect(faultKinds.has("immutable_reassignment_let")).toBe(true);
      expect(faultKinds.has("immutable_reassignment_const")).toBe(true);
      expect(faultKinds.has("immutable_reassignment_walrus")).toBe(true);
      expect(faultKinds.has("non_boolean_condition_int")).toBe(true);
      expect(faultKinds.has("unhandled_result")).toBe(true);
      expect(faultKinds.has("compound_const_and_non_bool_if")).toBe(true);
      expect(faultKinds.has("compound_walrus_and_triple_eq_and_div_zero")).toBe(true);
      expect(faultKinds.has("compound_null_and_not_triple_eq")).toBe(true);
      expect(faultKinds.has("compound_let_and_unhandled_result")).toBe(true);
      expect(faultKinds.has("compound_triple_eq_and_div_zero")).toBe(true);
      expect(faultKinds.size).toBe(14);
    });
  });

  describe("Delta-Debugging Testcase Shrinker", () => {
    it("shrinks a large failing snippet down to the minimal reproducing line", () => {
      const source = `
fn a() = 10;
fn b() = 20;
fn c() = 30;
fn bad() = 100 / 0;
fn d() = 40;
fn e() = 50;
fn f() = 60;
`;

      const shrunk = shrinkFailingAiceSource(source, (cand) =>
        cand.includes("100 / 0"),
      );

      expect(shrunk).toContain("100 / 0");
      expect(shrunk.split("\n").length).toBeLessThanOrEqual(2);
      expect(shrunk).not.toContain("fn a()");
      expect(shrunk).not.toContain("fn f()");
    });

    it("returns original source if predicate is already false", () => {
      const source = "fn ok() = 42;";
      const shrunk = shrinkFailingAiceSource(source, () => false);
      expect(shrunk).toBe(source);
    });
  });

  describe("100 Full Restarts (1,000 Cycles) Self-Healing Campaign", () => {
    it("executes 100 full restarts with 0 unhealed failures, 100% repair rate, and multi-iteration repairs", () => {
      const report = runSelfHealingCampaignSync({
        restarts: 100,
        cyclesPerRestart: 10,
        baseSeed: 1337,
        includeCorpus: true,
      });

      expect(report.totalRestarts).toBe(100);
      expect(report.completedRestarts).toBe(100);
      expect(report.totalCyclesExecuted).toBe(1000);
      expect(report.totalFailures).toBe(0);

      // Verify all differential oracle gates ran successfully across all 100 restarts
      expect(report.totalRoundtripsVerified).toBe(1000);
      expect(report.totalIdiomIdentitiesVerified).toBe(1000);
      expect(report.runtimeEquivalenceVerifications).toBe(1000);
      expect(report.totalSelfRepairsAttempted).toBe(1000);
      expect(report.totalSelfRepairsSucceeded).toBe(1000);
      expect(report.multiIterationRepairs).toBeGreaterThan(0);
      expect(report.averageTokenSavingsPct).toBeGreaterThan(0);
    }, 120000);

    it("executes asynchronous evolution loop cleanly", async () => {
      const report = await runEvolutionLoop({
        cycles: 10,
        seed: 5000,
        includeCorpus: false,
      });

      expect(report.totalCycles).toBe(10);
      expect(report.passedCycles).toBe(10);
      expect(report.failedCycles).toBe(0);
      expect(report.failures).toHaveLength(0);
      expect(report.selfRepairRatePct).toBe(100);
    });

    it("executes asynchronous campaign cleanly", async () => {
      const report = await runSelfHealingCampaign({
        restarts: 3,
        cyclesPerRestart: 5,
        baseSeed: 7000,
        includeCorpus: false,
      });

      expect(report.totalRestarts).toBe(3);
      expect(report.completedRestarts).toBe(3);
      expect(report.totalCyclesExecuted).toBe(15);
      expect(report.totalFailures).toBe(0);
      expect(report.totalSelfRepairsSucceeded).toBe(15);
    });

    it("notifies onCycle and onFailure callbacks during cycle execution", () => {
      let cycleCount = 0;
      const metricsList: number[] = [];

      const report = runEvolutionLoopSync({
        cycles: 5,
        seed: 9999,
        includeCorpus: false,
        onCycle: (cycle, metrics) => {
          cycleCount++;
          metricsList.push(metrics.cycle);
        },
      });

      expect(cycleCount).toBe(5);
      expect(metricsList).toEqual([0, 1, 2, 3, 4]);
      expect(report.passedCycles).toBe(5);
    });
  });

  describe("Evolution & Decompiler Convergence Regressions", () => {
    it("preserves Go struct literal fields without pseudo-binary operator commas", () => {
      const go = `package main
type Config struct {
	Host string
	Port int64
}
func MakeConfig(h string, p int64) Config {
	return Config{Host: h, Port: p}
}
`;
      const d1 = decompile(go, "go");
      const t2 = emitTarget(d1.ast, "go", { watermark: false });
      const d2 = decompile(t2, "go");
      const t3 = emitTarget(d2.ast, "go", { watermark: false });

      expect(t2.trim()).toBe(t3.trim());
      expect(t2).not.toContain("(h , p)");
    });

    it("prevents runaway .to_string().to_string() accumulation in Rust decompiler", () => {
      const aice = `pub fn greet(name: str) -> str:
  return name
`;
      const mod = parse(aice, "test_rs.aice");
      const t1 = emitTarget(mod, "rust", { watermark: false });
      const d1 = decompile(t1, "rust");
      const t2 = emitTarget(d1.ast, "rust", { watermark: false });
      const d2 = decompile(t2, "rust");
      const t3 = emitTarget(d2.ast, "rust", { watermark: false });

      expect(t2.trim()).toBe(t3.trim());
      expect(t3).not.toContain(".to_string().to_string()");
    });

    it("prevents duplicate nullable question marks in Kotlin emitter (Int?? -> Int?)", () => {
      const aice = `class OptionalPayload(optCount?: int?):
  pass
`;
      const mod = parse(aice, "test_kt.aice");
      const kt = emitTarget(mod, "kotlin", { watermark: false });

      expect(kt).not.toContain("??");
      expect(kt).toContain("Int?");
    });

    it("prevents nested std::string(...) wrappers in C++ decompiler", () => {
      const aice = `pub fn formatPrefix(s: str) -> str:
  return "prefix_" + s
`;
      const mod = parse(aice, "test_cpp.aice");
      const t1 = emitTarget(mod, "cpp", { watermark: false });
      const d1 = decompile(t1, "cpp");
      const t2 = emitTarget(d1.ast, "cpp", { watermark: false });
      const d2 = decompile(t2, "cpp");
      const t3 = emitTarget(d2.ast, "cpp", { watermark: false });

      expect(t2.trim()).toBe(t3.trim());
      expect(t3).not.toContain("std::string(std::string(");
    });

    it("emits clean Python TypedDict class without __init__ method per PEP 589", () => {
      const aice = `class UserProfile extends TypedDict:
  name: str
  age: int
`;
      const mod = parse(aice, "test_py.aice");
      const py = emitTarget(mod, "python", { watermark: false });

      expect(py).toContain("class UserProfile(TypedDict):");
      expect(py).toContain("name: str");
      expect(py).toContain("age: int");
      expect(py).not.toContain("def __init__");
    });

    it("prevents prepending return to PHP unset statements", () => {
      const aice = `pub fn cleanup(key: str):
  unset(key)
`;
      const mod = parse(aice, "test_php.aice");
      const php = emitTarget(mod, "php", { watermark: false });

      expect(php).not.toContain("return unset(");
      expect(php).toContain("unset($key);");
    });

    it("emits and converges clean PHP match expressions", () => {
      const aice = `pub fn evalScore(s: int) -> int:
  match s:
    case 1 =>
      return 10
    case _ =>
      return 0
`;
      const mod = parse(aice, "test_php_match.aice");
      const php = emitTarget(mod, "php", { watermark: false });
      expect(php).toContain("match ($s)");
      const d1 = decompile(php, "php");
      const t2 = emitTarget(d1.ast, "php", { watermark: false });
      const d2 = decompile(t2, "php");
      const t3 = emitTarget(d2.ast, "php", { watermark: false });

      expect(t2.trim()).toBe(t3.trim());
    });
  });

  describe("Level-2 Ultra-Complex Evolution & Runtime Equivalence Engine", () => {
    it("generates deeply recursive combinator programs with computeMain entry", () => {
      for (const seed of [1, 3, 5, 7, 9, 11]) {
        const prog = generateRecursiveAiceProgram(seed, 3);
        expect(prog.name).toBe(`fuzz_recursive_${seed}`);
        expect(prog.aiceSource).toContain("pub fn computeMain(x: int, y: int) -> int");
        expect(prog.aiceSource).toContain("class Acc");
        expect(prog.aiceSource).toContain("pub fn stepA");
        expect(prog.aiceSource).toContain("pub fn stepB");
        expect(prog.entryCallExpr).toBe("computeMain(x, y)");

        const mod = parse(prog.aiceSource, prog.name);
        expect(mod.items.length).toBeGreaterThanOrEqual(4);
      }
    });

    it("executes Gate 6 Live Runtime Execution Equivalence across test input pairs", () => {
      const cycleRes = runEvolutionCycle(0, 1, { includeCorpus: false });
      expect(cycleRes.failures).toHaveLength(0);
      expect(cycleRes.metrics.gate6RuntimePassed).toBe(true);
      expect(cycleRes.metrics.gate1RoundtripPassed).toBe(true);
      expect(cycleRes.metrics.gate2IdiomPassed).toBe(true);
      expect(cycleRes.metrics.gate3TypecheckPassed).toBe(true);
    });

    it("includes self-hosting dogfood corpus files in findCorpusFiles", () => {
      const files = findCorpusFiles(process.cwd());
      for (const df of DOGFOOD_COMPILER_FILES) {
        expect(files.some((f) => f.endsWith(df))).toBe(true);
      }
    });

    it("converges C++ and C# range-based for loops over initializer lists without drift", () => {
      const aice = `pub fn computeMain(x: int, y: int) -> int:
  let mut total: int = y
  for item in [1, 2, 3]:
    total = total + item
  return total
`;
      const mod = parse(aice, "loop_test.aice");

      // C++ roundtrip verification
      const cpp1 = emitTarget(mod, "cpp", { watermark: false });
      const cppD1 = decompile(cpp1, "cpp");
      const cpp2 = emitTarget(cppD1.ast, "cpp", { watermark: false });
      const cppD2 = decompile(cpp2, "cpp");
      const cpp3 = emitTarget(cppD2.ast, "cpp", { watermark: false });
      expect(cpp2.trim()).toBe(cpp3.trim());

      // C# roundtrip verification
      const cs1 = emitTarget(mod, "csharp", { watermark: false });
      const csD1 = decompile(cs1, "csharp");
      const cs2 = emitTarget(csD1.ast, "csharp", { watermark: false });
      const csD2 = decompile(cs2, "csharp");
      const cs3 = emitTarget(csD2.ast, "csharp", { watermark: false });
      expect(cs2.trim()).toBe(cs3.trim());
    });
  });
});
