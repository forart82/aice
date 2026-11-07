/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * STEP 7: Comprehensive Operator Pipeline Integration Matrix Test Suite.
 *
 * Exercises the complete end-to-end AICE 2.0 transpilation lifecycle:
 *   TypeScript Source
 *     -> TsDecompiler.decompile() -> AICE AST
 *     -> AiceGenerator.generate() -> AICE source code
 *     -> Parser.parse() -> parsed AICE AST
 *     -> TypeChecker.check() -> typed AST (0 type errors)
 *     -> TsEmitter.emit() -> TS target code
 *     -> PyEmitter.emit() -> Python target code
 *
 * Verifies all 7 operator categories plus additional compound assignments:
 *   - Category 1: 'in' ('"shield" in p', 'key in obj')
 *   - Category 2: 'instanceof' ('o instanceof Vec2', 'err instanceof Error')
 *   - Category 3: '|=' ('s |= 0', 'mask |= RoadMask.North')
 *   - Category 4: '^=' ('t ^= t + 1', 'hash ^= char')
 *   - Category 5: '=' in expression positions ('(el) => (el.textContent = v)', 'while ((pMatch = regex.exec(s)) !== null)')
 *   - Category 6: '&=' ('cell &= ~(1 << 2)')
 *   - Category 7: '>>=' ('v >>= 7')
 *   - Additional compound assignments: '<<=', '>>>=', '**='
 */

import { describe, expect, it } from "vitest";
import type {
  AssignExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  CallExpr,
  ClosureExpr,
  FunctionDecl,
  IfStmt,
  Module,
  WhileStmt,
} from "../../src/core/ast.js";
import { Parser } from "../../src/core/parser.js";
import { AiceGenerator } from "../../src/decompiler/aice-generator.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";
import { PyEmitter, TsEmitter } from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

interface PipelineVerificationResult {
  decompiledAst: Module;
  aiceSource: string;
  parsedAst: Module;
  tsOutput: string;
  pyOutput: string;
}

/**
 * Universal end-to-end pipeline runner that validates each phase of the
 * 6-stage lifecycle and guarantees 0 typechecker errors.
 */
function verifyEndToEndPipeline(
  tsSource: string,
  filename = "test_matrix.ts",
): PipelineVerificationResult {
  // Phase 1: TypeScript Source -> TsDecompiler.decompile() -> AICE AST
  const decompilerResult = TsDecompiler.decompile(tsSource, filename);
  const decompiledAst = decompilerResult.ast;
  expect(decompiledAst).toBeDefined();
  expect(decompiledAst.items.length).toBeGreaterThan(0);

  // Phase 2: AICE AST -> AiceGenerator.generate() -> AICE source code
  const aiceSource = AiceGenerator.generate(decompiledAst, {
    trivia: decompilerResult.trivia,
  });
  expect(aiceSource).toBeDefined();
  expect(typeof aiceSource).toBe("string");
  expect(aiceSource.length).toBeGreaterThan(0);

  // Phase 3: AICE source code -> Parser.parse() -> parsed AICE AST
  const aiceFile = filename.replace(/\.tsx?$/, ".aice");
  const parsedAst = Parser.parse(aiceSource, aiceFile);
  expect(parsedAst).toBeDefined();
  expect(parsedAst.items.length).toBe(decompiledAst.items.length);

  // Phase 4: parsed AICE AST -> TypeChecker.check() -> typed AST (0 type errors)
  expect(() => TypeChecker.check(parsedAst)).not.toThrow();

  // Phase 5: parsed AST -> TsEmitter.emit() -> TS target code
  const tsOutput = TsEmitter.emit(parsedAst);
  expect(tsOutput).toBeDefined();
  expect(typeof tsOutput).toBe("string");
  expect(tsOutput.length).toBeGreaterThan(0);

  // Phase 6: parsed AST -> PyEmitter.emit() -> Python target code
  const pyOutput = PyEmitter.emit(parsedAst);
  expect(pyOutput).toBeDefined();
  expect(typeof pyOutput).toBe("string");
  expect(pyOutput.length).toBeGreaterThan(0);

  return {
    decompiledAst,
    aiceSource,
    parsedAst,
    tsOutput,
    pyOutput,
  };
}

describe("Step 7: Operator Pipeline Integration Matrix", () => {
  describe("Category 1: 'in' Relational Operator", () => {
    it("verifies end-to-end lifecycle for '\"shield\" in p'", () => {
      const tsSource = `
export function hasShield(p: any): boolean {
  const has = "shield" in p;
  return has;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category1_shield.ts");

      // Verify AICE AST
      const fn = result.parsedAst.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.name).toBe("hasShield");

      // Verify AICE Source
      expect(result.aiceSource).toContain('has := "shield" in p');

      // Verify TypeScript Target
      expect(result.tsOutput).toContain('("shield" in p)');

      // Verify Python Target
      expect(result.pyOutput).toContain('("shield" in p)');
    });

    it("verifies end-to-end lifecycle for 'key in obj'", () => {
      const tsSource = `
export function hasKey(key: string, obj: any): boolean {
  return key in obj;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category1_key.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("key in obj");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(key in obj)");

      // Verify Python Target
      expect(result.pyOutput).toContain("(key in obj)");
    });

    it("verifies end-to-end lifecycle for 'if (\"shield\" in p)' conditional branching", () => {
      const tsSource = `
export function checkEquipment(p: any): boolean {
  if ("shield" in p) {
    return true;
  }
  return false;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category1_if_in.ts");

      // Verify AICE syntax has no redundant '!= nil'
      expect(result.aiceSource).toContain('if "shield" in p:');
      expect(result.aiceSource).not.toContain('("shield" in p) != nil');

      // Verify Target Emitters
      expect(result.tsOutput).toContain('if (("shield" in p)) {');
      expect(result.pyOutput).toContain('if ("shield" in p):');
    });
  });

  describe("Category 2: 'instanceof' Relational Operator", () => {
    it("verifies end-to-end lifecycle for 'o instanceof Vec2'", () => {
      const tsSource = `
export class Vec2 {
  x: number = 0;
  y: number = 0;
}

export function checkVec(o: any): boolean {
  const isVec = o instanceof Vec2;
  return isVec;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category2_vec.ts");

      // Verify AICE AST
      const checkFn = result.parsedAst.items[1] as FunctionDecl;
      expect(checkFn.name).toBe("checkVec");

      // Verify AICE Source
      expect(result.aiceSource).toContain("isVec := o instanceof Vec2");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(o instanceof Vec2)");

      // Verify Python Target (lowered to isinstance)
      expect(result.pyOutput).toContain("isinstance(o, Vec2)");
    });

    it("verifies end-to-end lifecycle for 'err instanceof Error'", () => {
      const tsSource = `
export function isError(err: any): boolean {
  return err instanceof Error;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category2_error.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("err instanceof Error");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(err instanceof Error)");

      // Verify Python Target (lowered to isinstance)
      expect(result.pyOutput).toContain("isinstance(err, Error)");
    });

    it("verifies end-to-end lifecycle for 'if (err instanceof Error)' conditional branching", () => {
      const tsSource = `
export function getErrorMessage(err: any): string {
  if (err instanceof Error) {
    return "recognized error";
  }
  return "unknown error";
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category2_if_error.ts");

      // Verify AICE syntax
      expect(result.aiceSource).toContain("if err instanceof Error:");

      // Verify Emitters
      expect(result.tsOutput).toContain("if ((err instanceof Error))");
      expect(result.pyOutput).toContain("if isinstance(err, Error):");
    });
  });

  describe("Category 3: '|=' Bitwise Compound Assignment", () => {
    it("verifies end-to-end lifecycle for 's |= 0'", () => {
      const tsSource = `
export function truncate(s: number): number {
  s |= 0;
  return s;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category3_trunc.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("s |= 0");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("s |= 0;");

      // Verify Python Target
      expect(result.pyOutput).toContain("s |= 0");
    });

    it("verifies end-to-end lifecycle for 'mask |= RoadMask.North'", () => {
      const tsSource = `
export enum RoadMask {
  None = 0,
  North = 1,
  South = 2,
}

export function addNorth(mask: number): number {
  let m = mask;
  m |= RoadMask.North;
  return m;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category3_roadmask.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("m |= RoadMask.North");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("m |= RoadMask.North;");

      // Verify Python Target
      expect(result.pyOutput).toContain("m |= RoadMask.North");
    });

    it("verifies end-to-end lifecycle for '|=' in expression position inside arrow function", () => {
      const tsSource = `
export function createMaskApplier(mask: number) {
  const apply = (flags: number) => (flags |= mask);
  return apply;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category3_arrow_or.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("(flags |= mask)");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(flags |= mask)");

      // Verify Python Target
      expect(result.pyOutput).toContain("(flags |= mask)");
    });
  });

  describe("Category 4: '^=' Bitwise Compound Assignment", () => {
    it("verifies end-to-end lifecycle for 't ^= t + 1'", () => {
      const tsSource = `
export function scramble(t: number): number {
  t ^= t + 1;
  return t;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category4_scramble.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("t ^= t + 1");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("t ^= (t + 1);");

      // Verify Python Target
      expect(result.pyOutput).toContain("t ^= (t + 1)");
    });

    it("verifies end-to-end lifecycle for 'hash ^= char'", () => {
      const tsSource = `
export function updateHash(hash: number, char: number): number {
  hash ^= char;
  return hash;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category4_hash.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("hash ^= char");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("hash ^= char;");

      // Verify Python Target
      expect(result.pyOutput).toContain("hash ^= char");
    });

    it("verifies end-to-end lifecycle for '^=' in expression position", () => {
      const tsSource = `
export function nextScramble(t: number): number {
  const next = (t ^= t + 1);
  return next;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category4_expr.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("next := t ^= t + 1");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(t ^= (t + 1))");

      // Verify Python Target
      expect(result.pyOutput).toContain("(t ^= (t + 1))");
    });
  });

  describe("Category 5: '=' in Expression Positions", () => {
    it("verifies end-to-end lifecycle for '(el) => (el.textContent = v)'", () => {
      const tsSource = `
export class Element {
  textContent: string = "";
}

export function setText(el: Element, v: string) {
  const setter = (target: Element) => (target.textContent = v);
  setter(el);
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category5_arrow_assign.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("setter := fn(target:Element) = (target.textContent = v)");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(target.textContent = v)");

      // Verify Python Target (walrus or expression assignment)
      expect(result.pyOutput).toContain("(target.textContent := v)");
    });

    it("verifies end-to-end lifecycle for 'while ((pMatch = regex.exec(s)) !== null)'", () => {
      const tsSource = `
export function matchAll(regex: any, s: string) {
  let pMatch: any = null;
  while ((pMatch = regex.exec(s)) !== null) {
    pMatch = null;
  }
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category5_while_assign.ts");

      // Verify AICE Source has while assignment
      expect(result.aiceSource).toContain("while (pMatch = regex.exec(s)) != nil:");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("while (((pMatch = regex.exec(s)) !== null)) {");

      // Verify Python Target uses walrus := operator in while loop
      expect(result.pyOutput).toContain("while ((pMatch := regex.exec(s)) != None):");
    });

    it("verifies end-to-end lifecycle for compound assignment in arrow function body: '(item) => (item.count += 1)'", () => {
      const tsSource = `
export class CounterItem {
  count: number = 0;
}

export function createIncrementer() {
  const inc = (item: CounterItem) => (item.count += 1);
  return inc;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category5_arrow_compound.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("fn(item:CounterItem) = (item.count += 1)");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(item.count += 1)");

      // Verify Python Target
      expect(result.pyOutput).toContain("(item.count += 1)");
    });
  });

  describe("Category 6: '&=' Bitwise Compound Assignment", () => {
    it("verifies end-to-end lifecycle for 'cell &= ~(1 << 2)'", () => {
      const tsSource = `
export function clearBit(cell: number): number {
  cell &= ~(1 << 2);
  return cell;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category6_clearbit.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("cell &= -(1 << 2)");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("cell &= -((1 << 2));");

      // Verify Python Target
      expect(result.pyOutput).toContain("cell &= (-(1 << 2))");
    });

    it("verifies end-to-end lifecycle for 'cell &= mask'", () => {
      const tsSource = `
export function applyAndMask(cell: number, mask: number): number {
  cell &= mask;
  return cell;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category6_mask.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("cell &= mask");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("cell &= mask;");

      // Verify Python Target
      expect(result.pyOutput).toContain("cell &= mask");
    });

    it("verifies end-to-end lifecycle for '&=' in expression position", () => {
      const tsSource = `
export function testAndExpr(cell: number, mask: number): number {
  const masked = (cell &= mask);
  return masked;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category6_expr.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("masked := cell &= mask");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("(cell &= mask)");

      // Verify Python Target
      expect(result.pyOutput).toContain("(cell &= mask)");
    });
  });

  describe("Category 7: '>>=' and Additional Compound Assignments ('<<=', '>>>=', '**=')", () => {
    it("verifies end-to-end lifecycle for 'v >>= 7'", () => {
      const tsSource = `
export function shiftRight(v: number): number {
  v >>= 7;
  return v;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category7_shr.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("v >>= 7");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("v >>= 7;");

      // Verify Python Target
      expect(result.pyOutput).toContain("v >>= 7");
    });

    it("verifies end-to-end lifecycle for '<<=' (shift left assignment)", () => {
      const tsSource = `
export function shiftLeft(a: number): number {
  a <<= 2;
  return a;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category7_shl.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("a <<= 2");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("a <<= 2;");

      // Verify Python Target
      expect(result.pyOutput).toContain("a <<= 2");
    });

    it("verifies end-to-end lifecycle for '>>>=' (unsigned right shift assignment)", () => {
      const tsSource = `
export function unsignedShift(b: number): number {
  b >>>= 1;
  return b;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category7_ushr.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("b >>>= 1");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("b >>>= 1;");

      // Verify Python Target (lowered to 32-bit unsigned modulo shift)
      expect(result.pyOutput).toContain("b = ((b % 0x100000000) >> 1)");
    });

    it("verifies end-to-end lifecycle for '**=' (power assignment)", () => {
      const tsSource = `
export function powerAssign(c: number): number {
  c **= 3;
  return c;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "category7_power.ts");

      // Verify AICE Source
      expect(result.aiceSource).toContain("c **= 3");

      // Verify TypeScript Target
      expect(result.tsOutput).toContain("c **= 3;");

      // Verify Python Target
      expect(result.pyOutput).toContain("c **= 3");
    });
  });

  describe("Comprehensive Unified Operator Matrix System Module", () => {
    it("verifies all 7 operator categories running together in a unified system pipeline", () => {
      const tsSource = `
export enum FlagMask {
  None = 0,
  North = 1,
  South = 2,
  East = 4,
  West = 8,
}

export class BitState {
  flags: number = 0;
  tag: string = "default";
}

export function processOperators(
  obj: any,
  state: BitState,
  initial: number,
): number {
  // Category 1: in
  const hasTag = "tag" in obj;

  // Category 2: instanceof
  const isState = obj instanceof BitState;

  // Category 3: |=
  let flags = state.flags;
  flags |= FlagMask.North;

  // Category 4: ^=
  let code = initial;
  code ^= code + 1;

  // Category 6: &=
  let cell = flags;
  cell &= ~(1 << 2);

  // Category 7: >>=
  let shifted = cell;
  shifted >>= 7;

  // Additional compound assignments: <<=, >>>=, **=
  shifted <<= 2;
  shifted >>>= 1;
  shifted **= 3;

  return shifted;
}
`;
      const result = verifyEndToEndPipeline(tsSource, "unified_matrix_system.ts");

      // Verify AST items
      expect(result.decompiledAst.items).toHaveLength(3); // enum, class, function
      expect(result.parsedAst.items).toHaveLength(3);

      // Verify AICE source contains all categories
      expect(result.aiceSource).toContain('hasTag := "tag" in obj');
      expect(result.aiceSource).toContain("isState := obj instanceof BitState");
      expect(result.aiceSource).toContain("flags |= FlagMask.North");
      expect(result.aiceSource).toContain("code ^= code + 1");
      expect(result.aiceSource).toContain("cell &= -(1 << 2)");
      expect(result.aiceSource).toContain("shifted >>= 7");
      expect(result.aiceSource).toContain("shifted <<= 2");
      expect(result.aiceSource).toContain("shifted >>>= 1");
      expect(result.aiceSource).toContain("shifted **= 3");

      // Verify TypeScript target output contains all categories
      expect(result.tsOutput).toContain('const hasTag = ("tag" in obj);');
      expect(result.tsOutput).toContain("const isState = (obj instanceof BitState);");
      expect(result.tsOutput).toContain("flags |= FlagMask.North;");
      expect(result.tsOutput).toContain("code ^= (code + 1);");
      expect(result.tsOutput).toContain("cell &= -((1 << 2));");
      expect(result.tsOutput).toContain("shifted >>= 7;");
      expect(result.tsOutput).toContain("shifted <<= 2;");
      expect(result.tsOutput).toContain("shifted >>>= 1;");
      expect(result.tsOutput).toContain("shifted **= 3;");

      // Verify Python target output contains all categories
      expect(result.pyOutput).toContain('hasTag = ("tag" in obj)');
      expect(result.pyOutput).toContain("isState = isinstance(obj, BitState)");
      expect(result.pyOutput).toContain("flags |= FlagMask.North");
      expect(result.pyOutput).toContain("code ^= (code + 1)");
      expect(result.pyOutput).toContain("cell &= (-(1 << 2))");
      expect(result.pyOutput).toContain("shifted >>= 7");
      expect(result.pyOutput).toContain("shifted <<= 2");
      expect(result.pyOutput).toContain("shifted = ((shifted % 0x100000000) >> 1)");
      expect(result.pyOutput).toContain("shifted **= 3");
    });
  });
});
