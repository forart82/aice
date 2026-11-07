/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Step 5: Sound Calculus & Typechecker Validation for Operators & Compound Assignments.
 */

import { describe, expect, it } from "vitest";
import type { AssignExpr, AssignStmt, BinaryExpr } from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { emptySpan } from "../../src/core/span.js";
import { TypeCheckError, TypeChecker, TypeEnv } from "../../src/typechecker/checker.js";
import {
  makeArrayType,
  makeFunctionType,
  makeNamedType,
  makeRecordType,
  TYPE_BOOL,
  TYPE_FLOAT,
  TYPE_INT,
  TYPE_STR,
  TYPE_UNKNOWN,
} from "../../src/typechecker/types.js";

describe("Step 5: Sound Calculus & Typechecker Validation", () => {
  const dummySpan = emptySpan();

  describe("Binary 'in' Operator Type Checking", () => {
    it("evaluates 'key in obj' to bool when left is string and right is record", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("key", TYPE_STR, false);
      env.define("obj", makeRecordType({ name: TYPE_STR, age: TYPE_INT }), false);

      const inExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "key", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "obj", span: dummySpan },
        span: dummySpan,
      };

      const resultType = checker.checkExpr(inExpr, env);
      expect(resultType.kind).toBe("bool");
    });

    it("evaluates 'idx in arr' to bool when left is int and right is array", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("idx", TYPE_INT, false);
      env.define("arr", makeArrayType(TYPE_STR), false);

      const inExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "idx", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "arr", span: dummySpan },
        span: dummySpan,
      };

      const resultType = checker.checkExpr(inExpr, env);
      expect(resultType.kind).toBe("bool");
    });

    it("evaluates 'key in map' to bool with named map and unknown types", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("k", TYPE_UNKNOWN, false);
      env.define("m", makeNamedType("Map"), false);

      const inExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "k", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "m", span: dummySpan },
        span: dummySpan,
      };

      const resultType = checker.checkExpr(inExpr, env);
      expect(resultType.kind).toBe("bool");
    });

    it("rejects invalid left operand (bool) for 'in'", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("flag", TYPE_BOOL, false);
      env.define("obj", makeRecordType({ active: TYPE_BOOL }), false);

      const inExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "flag", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "obj", span: dummySpan },
        span: dummySpan,
      };

      expect(() => checker.checkExpr(inExpr, env)).toThrow(TypeCheckError);
      expect(() => checker.checkExpr(inExpr, env)).toThrow(/Left operand of 'in' must be a key/);
    });

    it("rejects invalid right operand (primitive number or string) for 'in'", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("key", TYPE_STR, false);
      env.define("numVal", TYPE_INT, false);
      env.define("strVal", TYPE_STR, false);

      const numInExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "key", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "numVal", span: dummySpan },
        span: dummySpan,
      };

      expect(() => checker.checkExpr(numInExpr, env)).toThrow(TypeCheckError);
      expect(() => checker.checkExpr(numInExpr, env)).toThrow(
        /Right operand of 'in' must be an object, record, map, or array/,
      );

      const strInExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: { kind: "IdentifierExpr", name: "key", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "strVal", span: dummySpan },
        span: dummySpan,
      };

      expect(() => checker.checkExpr(strInExpr, env)).toThrow(TypeCheckError);
      expect(() => checker.checkExpr(strInExpr, env)).toThrow(
        /Right operand of 'in' must be an object, record, map, or array/,
      );
    });

    it("typechecks 'key in obj' cleanly inside parsed AICE function", () => {
      const src = `
fn hasProperty(obj: any, key: str) -> bool:
  return key in obj
`;
      const mod = parse(src, "test_in.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });
  });

  describe("Binary 'instanceof' Operator Type Checking", () => {
    it("evaluates 'err instanceof Error' to bool", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("err", makeNamedType("any"), false);
      env.define(
        "Error",
        makeFunctionType([{ name: "msg", type: TYPE_STR }], makeNamedType("Error")),
        false,
      );

      const instExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "instanceof",
        left: { kind: "IdentifierExpr", name: "err", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "Error", span: dummySpan },
        span: dummySpan,
      };

      const resultType = checker.checkExpr(instExpr, env);
      expect(resultType.kind).toBe("bool");
    });

    it("evaluates 'o instanceof Vec2' to bool with custom struct constructor", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      const vec2Record = makeRecordType({ x: TYPE_FLOAT, y: TYPE_FLOAT }, "Vec2");
      env.defineType("Vec2", vec2Record);
      env.define(
        "Vec2",
        makeFunctionType(
          [
            { name: "x", type: TYPE_FLOAT },
            { name: "y", type: TYPE_FLOAT },
          ],
          vec2Record,
        ),
        false,
      );
      env.define("o", vec2Record, false);

      const instExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "instanceof",
        left: { kind: "IdentifierExpr", name: "o", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "Vec2", span: dummySpan },
        span: dummySpan,
      };

      const resultType = checker.checkExpr(instExpr, env);
      expect(resultType.kind).toBe("bool");
    });

    it("rejects primitive left operand (int, str, bool) for 'instanceof'", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("n", TYPE_INT, false);
      env.define("Error", makeFunctionType([], makeNamedType("Error")), false);

      const instExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "instanceof",
        left: { kind: "IdentifierExpr", name: "n", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "Error", span: dummySpan },
        span: dummySpan,
      };

      expect(() => checker.checkExpr(instExpr, env)).toThrow(TypeCheckError);
      expect(() => checker.checkExpr(instExpr, env)).toThrow(
        /Left operand of 'instanceof' must be an object, instance, or any/,
      );
    });

    it("rejects primitive right operand (int, str) for 'instanceof'", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("o", makeRecordType({ x: TYPE_INT }), false);
      env.define("notAClass", TYPE_INT, false);

      const instExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "instanceof",
        left: { kind: "IdentifierExpr", name: "o", span: dummySpan },
        right: { kind: "IdentifierExpr", name: "notAClass", span: dummySpan },
        span: dummySpan,
      };

      expect(() => checker.checkExpr(instExpr, env)).toThrow(TypeCheckError);
      expect(() => checker.checkExpr(instExpr, env)).toThrow(
        /Right operand of 'instanceof' must be a class, constructor, or any/,
      );
    });

    it("typechecks 'err instanceof Error' cleanly in parsed AICE code", () => {
      const src = `
fn isError(err: any) -> bool:
  return err instanceof Error
`;
      const mod = parse(src, "test_inst.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });
  });

  describe("Compound Assignment Operators Type Checking", () => {
    it("validates bitwise compound assignments: s |= 0, hash ^= 123, cell &= mask", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("s", TYPE_INT, true);
      env.define("hash", TYPE_INT, true);
      env.define("cell", TYPE_INT, true);
      env.define("mask", TYPE_INT, false);

      // s |= 0
      const orAssign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "s", span: dummySpan },
        op: "|=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 0,
          rawValue: "0",
          span: dummySpan,
        },
        span: dummySpan,
      };
      expect(() => checker.checkStmt(orAssign, env)).not.toThrow();

      // hash ^= 123
      const xorAssign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "hash", span: dummySpan },
        op: "^=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 123,
          rawValue: "123",
          span: dummySpan,
        },
        span: dummySpan,
      };
      expect(() => checker.checkStmt(xorAssign, env)).not.toThrow();

      // cell &= mask
      const andAssign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "cell", span: dummySpan },
        op: "&=",
        value: { kind: "IdentifierExpr", name: "mask", span: dummySpan },
        span: dummySpan,
      };
      expect(() => checker.checkStmt(andAssign, env)).not.toThrow();
    });

    it("validates shift compound assignments: v >>= 2, v <<= 1, v >>>= 1", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("v", TYPE_INT, true);

      const makeShift = (op: ">>=" | "<<=" | ">>>=", amt: number): AssignStmt => ({
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "v", span: dummySpan },
        op,
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: amt,
          rawValue: String(amt),
          span: dummySpan,
        },
        span: dummySpan,
      });

      expect(() => checker.checkStmt(makeShift(">>=", 2), env)).not.toThrow();
      expect(() => checker.checkStmt(makeShift("<<=", 1), env)).not.toThrow();
      expect(() => checker.checkStmt(makeShift(">>>=", 1), env)).not.toThrow();
    });

    it("validates exponent compound assignment: x **= 2", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("x", TYPE_INT, true);

      const powAssign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "x", span: dummySpan },
        op: "**=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 2,
          rawValue: "2",
          span: dummySpan,
        },
        span: dummySpan,
      };

      expect(() => checker.checkStmt(powAssign, env)).not.toThrow();
    });

    it("validates arithmetic compound assignments: +=, -=, *=, %=, /=", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("count", TYPE_INT, true);
      env.define("ratio", TYPE_FLOAT, true);
      env.define("msg", TYPE_STR, true);

      // count += 1
      expect(() =>
        checker.checkStmt(
          {
            kind: "AssignStmt",
            target: { kind: "IdentifierExpr", name: "count", span: dummySpan },
            op: "+=",
            value: {
              kind: "LiteralExpr",
              literalKind: "number",
              value: 1,
              rawValue: "1",
              span: dummySpan,
            },
            span: dummySpan,
          },
          env,
        ),
      ).not.toThrow();

      // msg += " more"
      expect(() =>
        checker.checkStmt(
          {
            kind: "AssignStmt",
            target: { kind: "IdentifierExpr", name: "msg", span: dummySpan },
            op: "+=",
            value: {
              kind: "LiteralExpr",
              literalKind: "string",
              value: " more",
              rawValue: '" more"',
              span: dummySpan,
            },
            span: dummySpan,
          },
          env,
        ),
      ).not.toThrow();

      // ratio /= 2
      expect(() =>
        checker.checkStmt(
          {
            kind: "AssignStmt",
            target: { kind: "IdentifierExpr", name: "ratio", span: dummySpan },
            op: "/=",
            value: {
              kind: "LiteralExpr",
              literalKind: "number",
              value: 2,
              rawValue: "2",
              span: dummySpan,
            },
            span: dummySpan,
          },
          env,
        ),
      ).not.toThrow();
    });

    it("rejects compound assignment on immutable variable", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("frozen", TYPE_INT, false); // isMut = false

      const assign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "frozen", span: dummySpan },
        op: "+=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 1,
          rawValue: "1",
          span: dummySpan,
        },
        span: dummySpan,
      };

      expect(() => checker.checkStmt(assign, env)).toThrow(TypeCheckError);
      expect(() => checker.checkStmt(assign, env)).toThrow(
        /Cannot assign to immutable variable 'frozen'/,
      );
    });

    it("reports type errors when string is used with bitwise compound assignments", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("s", TYPE_STR, true);

      const bitwiseOps: ("|=" | "^=" | "&=" | "<<=" | ">>=" | ">>>=")[] = [
        "|=",
        "^=",
        "&=",
        "<<=",
        ">>=",
        ">>>=",
      ];

      for (const op of bitwiseOps) {
        const assign: AssignStmt = {
          kind: "AssignStmt",
          target: { kind: "IdentifierExpr", name: "s", span: dummySpan },
          op,
          value: {
            kind: "LiteralExpr",
            literalKind: "number",
            value: 0,
            rawValue: "0",
            span: dummySpan,
          },
          span: dummySpan,
        };

        expect(() => checker.checkStmt(assign, env)).toThrow(TypeCheckError);
        expect(() => checker.checkStmt(assign, env)).toThrow(/requires numeric operands/);
      }
    });

    it("reports type errors when assigning string to int variable via bitwise compound operator", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("s", TYPE_INT, true);

      const assign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "s", span: dummySpan },
        op: "|=",
        value: {
          kind: "LiteralExpr",
          literalKind: "string",
          value: "invalid",
          rawValue: '"invalid"',
          span: dummySpan,
        },
        span: dummySpan,
      };

      expect(() => checker.checkStmt(assign, env)).toThrow(TypeCheckError);
      expect(() => checker.checkStmt(assign, env)).toThrow(/requires numeric operands/);
    });

    it("reports compile-time error on literal zero division in /= compound assignment", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("x", TYPE_FLOAT, true);

      const divZero: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "x", span: dummySpan },
        op: "/=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 0,
          rawValue: "0",
          span: dummySpan,
        },
        span: dummySpan,
      };

      expect(() => checker.checkStmt(divZero, env)).toThrow(TypeCheckError);
      expect(() => checker.checkStmt(divZero, env)).toThrow(/Division by zero detected/);
    });

    it("reports disparate type errors on '+=' between string and integer", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("text", TYPE_STR, true);

      const assign: AssignStmt = {
        kind: "AssignStmt",
        target: { kind: "IdentifierExpr", name: "text", span: dummySpan },
        op: "+=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 42,
          rawValue: "42",
          span: dummySpan,
        },
        span: dummySpan,
      };

      expect(() => checker.checkStmt(assign, env)).toThrow(TypeCheckError);
      expect(() => checker.checkStmt(assign, env)).toThrow(/cannot be applied to disparate types/);
    });
  });

  describe("AssignExpr in Expression Positions", () => {
    it("returns assigned value type from AssignExpr", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("x", TYPE_INT, true);

      const assignExpr: AssignExpr = {
        kind: "AssignExpr",
        target: { kind: "IdentifierExpr", name: "x", span: dummySpan },
        op: "=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 42,
          rawValue: "42",
          span: dummySpan,
        },
        span: dummySpan,
      };

      const resType = checker.checkExpr(assignExpr, env);
      expect(resType.kind).toBe("int");
    });

    it("returns updated type from compound AssignExpr (e.g. s |= 0)", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("s", TYPE_INT, true);

      const bitwiseExpr: AssignExpr = {
        kind: "AssignExpr",
        target: { kind: "IdentifierExpr", name: "s", span: dummySpan },
        op: "|=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 0,
          rawValue: "0",
          span: dummySpan,
        },
        span: dummySpan,
      };

      const resType = checker.checkExpr(bitwiseExpr, env);
      expect(resType.kind).toBe("int");
    });

    it("typechecks AssignExpr in while loop condition: while ((pMatch = regex.exec(s)) != nil)", () => {
      const src = `
fn parseMatches(s: str, regex: any):
  let mut pMatch: any = nil
  while ((pMatch = regex.exec(s)) != nil):
    print(pMatch)
`;
      const mod = parse(src, "test_while_assign.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });

    it("typechecks AssignExpr in arrow function body: (el) => (el.textContent = v)", () => {
      const src = `
fn updateElements(v: str):
  let setter = (el: any) => (el.textContent = v)
  setter(nil)
`;
      const mod = parse(src, "test_arrow_assign.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });

    it("typechecks compound AssignExpr in arrow function body: (item) => (item.count += 1)", () => {
      const src = `
fn incrementItems():
  let inc = (item: any) => (item.count += 1)
  inc(nil)
`;
      const mod = parse(src, "test_arrow_compound.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });

    it("typechecks bitwise compound AssignExpr in arrow function body: (mask) => (flags |= mask)", () => {
      const src = `
fn bitwiseClosure():
  let mut flags: int = 0
  let applyMask = (mask: int) => (flags |= mask)
  applyMask(1)
`;
      const mod = parse(src, "test_bitwise_closure.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });

    it("typechecks comprehensive end-to-end function with all operator features", () => {
      const src = `
type Item:
  count: int

fn processBatch(items: any, err: any):
  let mut s: int = 0
  let mut hash: int = 5381
  let mut cell: int = 255
  let mut v: int = 16
  let mut x: int = 3

  s |= 0
  hash ^= 123
  cell &= 15
  v >>= 2
  v <<= 1
  v >>>= 1
  x **= 2

  if "total" in items:
    print("Found total")

  if err instanceof Error:
    print("Handled error")
`;
      const mod = parse(src, "test_batch.aice");
      const checker = new TypeChecker();
      expect(() => checker.checkModule(mod)).not.toThrow();
    });
  });
});
