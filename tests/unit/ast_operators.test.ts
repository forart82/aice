import { describe, expect, it } from "vitest";
import type {
  AssignExpr,
  AssignOp,
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  IdentifierExpr,
  LiteralExpr,
} from "../../src/core/ast.js";
import { Precedence } from "../../src/core/parser.js";
import { emptySpan } from "../../src/core/span.js";
import { getBinaryOpPrecedence } from "../../src/decompiler/aice-generator.js";
import { TypeChecker, TypeEnv } from "../../src/typechecker/checker.js";

describe("AICE 2.0 AST Extension for Operators & Compound Assignments", () => {
  const dummySpan = emptySpan();
  const idA: IdentifierExpr = { kind: "IdentifierExpr", name: "a", span: dummySpan };
  const idB: IdentifierExpr = { kind: "IdentifierExpr", name: "b", span: dummySpan };
  const lit1: LiteralExpr = {
    kind: "LiteralExpr",
    literalKind: "number",
    value: 1,
    rawValue: "1",
    span: dummySpan,
  };

  describe("BinaryOp extension ('in' and 'instanceof')", () => {
    it("creates a valid BinaryExpr node with 'in' operator", () => {
      const op: BinaryOp = "in";
      const expr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: op,
        left: idA,
        right: idB,
        span: dummySpan,
      };

      expect(expr.kind).toBe("BinaryExpr");
      expect(expr.operator).toBe("in");
      expect(expr.left).toBe(idA);
      expect(expr.right).toBe(idB);
    });

    it("creates a valid BinaryExpr node with 'instanceof' operator", () => {
      const op: BinaryOp = "instanceof";
      const expr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: op,
        left: idA,
        right: idB,
        span: dummySpan,
      };

      expect(expr.kind).toBe("BinaryExpr");
      expect(expr.operator).toBe("instanceof");
      expect(expr.left).toBe(idA);
      expect(expr.right).toBe(idB);
    });

    it("assigns Precedence.LESSGREATER to 'in' and 'instanceof'", () => {
      expect(getBinaryOpPrecedence("in")).toBe(Precedence.LESSGREATER);
      expect(getBinaryOpPrecedence("instanceof")).toBe(Precedence.LESSGREATER);
    });

    it("typechecks 'in' and 'instanceof' BinaryExpr as boolean type", () => {
      const checker = new TypeChecker();
      const env = new TypeEnv();
      env.define("a", { kind: "unknown" }, false);
      env.define("b", { kind: "unknown" }, false);

      const inExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "in",
        left: idA,
        right: idB,
        span: dummySpan,
      };
      const inType = checker.checkExpr(inExpr, env);
      expect(inType.kind).toBe("bool");

      const instanceofExpr: BinaryExpr = {
        kind: "BinaryExpr",
        operator: "instanceof",
        left: idA,
        right: idB,
        span: dummySpan,
      };
      const instanceofType = checker.checkExpr(instanceofExpr, env);
      expect(instanceofType.kind).toBe("bool");
    });
  });

  describe("AssignOp extension (compound bitwise, shift, exponent)", () => {
    const compoundOps: AssignOp[] = ["|=", "^=", "&=", "<<=", ">>=", ">>>=", "**="];

    const allOps: AssignOp[] = ["=", "+=", "-=", "*=", "/=", "%=", ...compoundOps];

    it("creates valid AssignStmt nodes with all compound operators", () => {
      for (const op of compoundOps) {
        const stmt: AssignStmt = {
          kind: "AssignStmt",
          target: idA,
          op,
          value: lit1,
          span: dummySpan,
        };

        expect(stmt.kind).toBe("AssignStmt");
        expect(stmt.op).toBe(op);
        expect(stmt.target).toBe(idA);
        expect(stmt.value).toBe(lit1);
      }
    });

    it("creates valid AssignExpr nodes with all compound operators", () => {
      for (const op of compoundOps) {
        const expr: AssignExpr = {
          kind: "AssignExpr",
          target: idA,
          op,
          value: lit1,
          span: dummySpan,
        };

        expect(expr.kind).toBe("AssignExpr");
        expect(expr.op).toBe(op);
        expect(expr.target).toBe(idA);
        expect(expr.value).toBe(lit1);
      }
    });

    it("maintains type safety across the complete AssignOp union", () => {
      expect(allOps).toHaveLength(13);
      for (const op of allOps) {
        const stmt: AssignStmt = {
          kind: "AssignStmt",
          target: idA,
          op,
          value: lit1,
          span: dummySpan,
        };
        const expr: AssignExpr = {
          kind: "AssignExpr",
          target: idA,
          op,
          value: lit1,
          span: dummySpan,
        };
        expect(stmt.op).toBe(op);
        expect(expr.op).toBe(op);
      }
    });
  });
});
