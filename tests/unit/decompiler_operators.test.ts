/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for TsDecompiler Lowering & Decompilation Resolution (Step 4).
 * Verifies that TypeScript source containing relational operators ('in', 'instanceof'),
 * bitwise compound assignment operators ('|=', '^=', '&=', '>>=', '<<=', '>>>=', '**='),
 * assignment expressions in expression positions ('(el) => (el.textContent = v)'),
 * and while loop assignment conditions decompile cleanly into valid AIL AST and AIL source code.
 */

import { describe, expect, it } from "vitest";
import type {
  AssignExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  CallExpr,
  ClosureExpr,
  ConstDecl,
  ExprStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  LetBinding,
  LiteralExpr,
  MemberAccessExpr,
  WhileStmt,
} from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { decompile } from "../../src/decompiler/index.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";

describe("Step 4: TsDecompiler Lowering & Decompilation Resolution", () => {
  describe("Pattern 1: 'in' Relational Operator", () => {
    it("decompiles '\"shield\" in p' inside a function into LetBinding with BinaryExpr 'in'", () => {
      const tsCode = `
function hasShield(p: any) {
  const has = "shield" in p;
  return has;
}
`;
      const decompiler = new TsDecompiler(tsCode, "in_test.ts");
      const { ast } = decompiler.decompile();

      expect(ast.items).toHaveLength(1);
      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      expect(decl.kind).toBe("LetBinding");
      expect(decl.name).toBe("has");
      expect(decl.init.kind).toBe("BinaryExpr");

      const bin = decl.init as BinaryExpr;
      expect(bin.operator).toBe("in");
      expect(bin.left.kind).toBe("LiteralExpr");
      expect((bin.left as LiteralExpr).value).toBe("shield");
      expect(bin.right.kind).toBe("IdentifierExpr");
      expect((bin.right as IdentifierExpr).name).toBe("p");

      const res = decompile(tsCode, "typescript", { filePath: "in_test.ts" });
      expect(res.ail).toContain('has := "shield" in p');

      // Verify roundtrip parse of generated AIL
      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles top-level 'const hasShield = \"shield\" in p' into ConstDecl with BinaryExpr 'in'", () => {
      const tsCode = `const hasShield = "shield" in p;`;
      const decompiler = new TsDecompiler(tsCode, "top_in.ts");
      const { ast } = decompiler.decompile();

      expect(ast.items).toHaveLength(1);
      const decl = ast.items[0] as ConstDecl;
      expect(decl.kind).toBe("ConstDecl");
      expect(decl.name).toBe("hasShield");
      expect(decl.value.kind).toBe("BinaryExpr");

      const bin = decl.value as BinaryExpr;
      expect(bin.operator).toBe("in");
      expect((bin.left as LiteralExpr).value).toBe("shield");
      expect((bin.right as IdentifierExpr).name).toBe("p");

      const res = decompile(tsCode, "typescript", { filePath: "top_in.ts" });
      expect(res.ail).toContain('const hasShield = "shield" in p');

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles 'if (\"shield\" in p)' without redundant '!= nil' wrapping", () => {
      const tsCode = `
function test(p: any) {
  if ("shield" in p) {
    equip(p);
  }
}
`;
      const decompiler = new TsDecompiler(tsCode, "if_in.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const ifStmt = body.statements[0] as IfStmt;
      expect(ifStmt.kind).toBe("IfStmt");
      expect(ifStmt.condition.kind).toBe("BinaryExpr");

      const cond = ifStmt.condition as BinaryExpr;
      expect(cond.operator).toBe("in");
      expect((cond.left as LiteralExpr).value).toBe("shield");
      expect((cond.right as IdentifierExpr).name).toBe("p");

      const res = decompile(tsCode, "typescript", { filePath: "if_in.ts" });
      expect(res.ail).toContain('if "shield" in p:');
      expect(res.ail).not.toContain('("shield" in p) != nil');

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles chained logical 'in' expressions with correct precedence", () => {
      const tsCode = `
function check(p: any) {
  const ok = "shield" in p && "sword" in p;
  return ok;
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "chain_in.ts" });
      expect(res.ail).toContain('ok := "shield" in p and "sword" in p');

      const fn = res.ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      const bin = decl.init as BinaryExpr;
      expect(bin.operator).toBe("and");
      expect((bin.left as BinaryExpr).operator).toBe("in");
      expect((bin.right as BinaryExpr).operator).toBe("in");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });
  });

  describe("Pattern 2: 'instanceof' Relational Operator", () => {
    it("decompiles 'o instanceof Vec2' inside a function into LetBinding with BinaryExpr 'instanceof'", () => {
      const tsCode = `
function checkVec(o: any) {
  const isVec = o instanceof Vec2;
  return isVec;
}
`;
      const decompiler = new TsDecompiler(tsCode, "instanceof_test.ts");
      const { ast } = decompiler.decompile();

      expect(ast.items).toHaveLength(1);
      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      expect(decl.kind).toBe("LetBinding");
      expect(decl.name).toBe("isVec");
      expect(decl.init.kind).toBe("BinaryExpr");

      const bin = decl.init as BinaryExpr;
      expect(bin.operator).toBe("instanceof");
      expect(bin.left.kind).toBe("IdentifierExpr");
      expect((bin.left as IdentifierExpr).name).toBe("o");
      expect(bin.right.kind).toBe("IdentifierExpr");
      expect((bin.right as IdentifierExpr).name).toBe("Vec2");

      const res = decompile(tsCode, "typescript", { filePath: "instanceof_test.ts" });
      expect(res.ail).toContain("isVec := o instanceof Vec2");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles top-level 'const isVec = o instanceof Vec2' into ConstDecl with BinaryExpr 'instanceof'", () => {
      const tsCode = `const isVec = o instanceof Vec2;`;
      const res = decompile(tsCode, "typescript", { filePath: "top_instanceof.ts" });

      const decl = res.ast.items[0] as ConstDecl;
      expect(decl.kind).toBe("ConstDecl");
      expect(decl.value.kind).toBe("BinaryExpr");
      expect((decl.value as BinaryExpr).operator).toBe("instanceof");

      expect(res.ail).toContain("const isVec = o instanceof Vec2");
      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles 'if (o instanceof Vec2)' without redundant '!= nil' wrapping", () => {
      const tsCode = `
function test(o: any) {
  if (o instanceof Vec2) {
    return o.x;
  }
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "if_instanceof.ts" });
      const fn = res.ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const ifStmt = body.statements[0] as IfStmt;
      expect(ifStmt.condition.kind).toBe("BinaryExpr");
      expect((ifStmt.condition as BinaryExpr).operator).toBe("instanceof");

      expect(res.ail).toContain("if o instanceof Vec2:");
      expect(res.ail).not.toContain("(o instanceof Vec2) != nil");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });
  });

  describe("Pattern 3: '|=' Bitwise Compound Assignment", () => {
    it("decompiles 's |= 0' statement into AssignStmt with op '|='", () => {
      const tsCode = `
function truncate(s: number) {
  s |= 0;
  return s;
}
`;
      const decompiler = new TsDecompiler(tsCode, "or_assign.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const stmt = body.statements[0] as AssignStmt;
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("|=");
      expect((stmt.target as IdentifierExpr).name).toBe("s");
      expect((stmt.value as LiteralExpr).value).toBe(0);

      const res = decompile(tsCode, "typescript", { filePath: "or_assign.ts" });
      expect(res.ail).toContain("s |= 0");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles 's |= 0' in expression position inside function into AssignExpr with op '|='", () => {
      const tsCode = `
function test(s: number) {
  const trunc = (s |= 0);
  return trunc;
}
`;
      const decompiler = new TsDecompiler(tsCode, "or_assign_expr.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      expect(decl.init.kind).toBe("AssignExpr");
      const assign = decl.init as AssignExpr;
      expect(assign.op).toBe("|=");
      expect((assign.target as IdentifierExpr).name).toBe("s");
      expect((assign.value as LiteralExpr).value).toBe(0);

      const res = decompile(tsCode, "typescript", { filePath: "or_assign_expr.ts" });
      expect(res.ail).toContain("trunc := s |= 0");
    });

    it("decompiles arrow function '(flags: number) => (flags |= mask)' with AssignExpr", () => {
      const tsCode = `const applyMask = (flags: number) => (flags |= mask);`;
      const res = decompile(tsCode, "typescript", { filePath: "arrow_or.ts" });

      const decl = res.ast.items[0] as ConstDecl;
      expect(decl.kind).toBe("ConstDecl");
      expect(decl.value.kind).toBe("ClosureExpr");
      const closure = decl.value as ClosureExpr;
      expect(closure.body.kind).toBe("AssignExpr");
      const assign = closure.body as AssignExpr;
      expect(assign.op).toBe("|=");
      expect((assign.target as IdentifierExpr).name).toBe("flags");
      expect((assign.value as IdentifierExpr).name).toBe("mask");

      expect(res.ail).toContain("const applyMask = fn(flags:int) = (flags |= mask)");
      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });
  });

  describe("Pattern 4: '^=' Bitwise Compound Assignment", () => {
    it("decompiles 't ^= t + 1' statement into AssignStmt with op '^='", () => {
      const tsCode = `
function scramble(t: number) {
  t ^= t + 1;
  return t;
}
`;
      const decompiler = new TsDecompiler(tsCode, "xor_assign.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const stmt = body.statements[0] as AssignStmt;
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("^=");
      expect((stmt.target as IdentifierExpr).name).toBe("t");

      expect(stmt.value.kind).toBe("BinaryExpr");
      const bin = stmt.value as BinaryExpr;
      expect(bin.operator).toBe("+");
      expect((bin.left as IdentifierExpr).name).toBe("t");
      expect((bin.right as LiteralExpr).value).toBe(1);

      const res = decompile(tsCode, "typescript", { filePath: "xor_assign.ts" });
      expect(res.ail).toContain("t ^= t + 1");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles 't ^= t + 1' in expression position inside function into AssignExpr with op '^='", () => {
      const tsCode = `
function test(t: number) {
  const next = (t ^= t + 1);
  return next;
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "xor_assign_expr.ts" });

      const fn = res.ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      expect(decl.init.kind).toBe("AssignExpr");
      const assign = decl.init as AssignExpr;
      expect(assign.op).toBe("^=");
      expect((assign.target as IdentifierExpr).name).toBe("t");
      expect(assign.value.kind).toBe("BinaryExpr");

      expect(res.ail).toContain("next := t ^= t + 1");
    });
  });

  describe("Pattern 5: '=' in Expression Positions & Arrow Function Bodies", () => {
    it("decompiles '(el) => (el.textContent = v)' into ClosureExpr with AssignExpr body", () => {
      const tsCode = `const setText = (el: any) => (el.textContent = v);`;
      const decompiler = new TsDecompiler(tsCode, "arrow_assign.ts");
      const { ast } = decompiler.decompile();

      const decl = ast.items[0] as ConstDecl;
      expect(decl.kind).toBe("ConstDecl");
      expect(decl.value.kind).toBe("ClosureExpr");
      const closure = decl.value as ClosureExpr;
      expect(closure.params).toHaveLength(1);
      expect(closure.params[0].name).toBe("el");

      expect(closure.body.kind).toBe("AssignExpr");
      const assign = closure.body as AssignExpr;
      expect(assign.op).toBe("=");
      expect(assign.target.kind).toBe("MemberAccessExpr");
      const mem = assign.target as MemberAccessExpr;
      expect((mem.object as IdentifierExpr).name).toBe("el");
      expect(mem.property).toBe("textContent");
      expect((assign.value as IdentifierExpr).name).toBe("v");

      const res = decompile(tsCode, "typescript", { filePath: "arrow_assign.ts" });
      expect(res.ail).toContain("const setText = fn(el:unknown) = (el.textContent = v)");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles compound assignment in arrow function body: '(item) => (item.count += 1)'", () => {
      const tsCode = `const inc = (item: any) => (item.count += 1);`;
      const res = decompile(tsCode, "typescript", { filePath: "arrow_compound.ts" });

      const decl = res.ast.items[0] as ConstDecl;
      expect(decl.kind).toBe("ConstDecl");
      expect(decl.value.kind).toBe("ClosureExpr");
      const closure = decl.value as ClosureExpr;
      expect(closure.body.kind).toBe("AssignExpr");
      const assign = closure.body as AssignExpr;
      expect(assign.op).toBe("+=");
      expect((assign.target as MemberAccessExpr).property).toBe("count");
      expect((assign.value as LiteralExpr).value).toBe(1);

      expect(res.ail).toContain("const inc = fn(item:unknown) = (item.count += 1)");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles while loop assignment condition: 'while ((pMatch = regex.exec(s)) !== null)'", () => {
      const tsCode = `
function matchAll(regex: any, s: string) {
  let pMatch: any;
  while ((pMatch = regex.exec(s)) !== null) {
    handle(pMatch);
  }
}
`;
      const decompiler = new TsDecompiler(tsCode, "while_assign.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const whileStmt = body.statements[1] as WhileStmt;
      expect(whileStmt.kind).toBe("WhileStmt");

      expect(whileStmt.condition.kind).toBe("BinaryExpr");
      const cond = whileStmt.condition as BinaryExpr;
      expect(cond.operator).toBe("!=");
      expect(cond.right.kind).toBe("LiteralExpr");
      expect((cond.right as LiteralExpr).value).toBeNull();

      expect(cond.left.kind).toBe("AssignExpr");
      const assign = cond.left as AssignExpr;
      expect(assign.op).toBe("=");
      expect((assign.target as IdentifierExpr).name).toBe("pMatch");
      expect(assign.value.kind).toBe("CallExpr");
      const call = assign.value as CallExpr;
      expect((call.callee as MemberAccessExpr).property).toBe("exec");

      const res = decompile(tsCode, "typescript", { filePath: "while_assign.ts" });
      expect(res.ail).toContain("while (pMatch = regex.exec(s)) != nil:");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });
  });

  describe("Pattern 6: '&=' Bitwise Compound Assignment", () => {
    it("decompiles 'cell &= ~(1 << 2)' into AssignStmt with op '&='", () => {
      const tsCode = `
function clearBit(cell: number) {
  cell &= ~(1 << 2);
  return cell;
}
`;
      const decompiler = new TsDecompiler(tsCode, "and_assign.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const stmt = body.statements[0] as AssignStmt;
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("&=");
      expect((stmt.target as IdentifierExpr).name).toBe("cell");

      const res = decompile(tsCode, "typescript", { filePath: "and_assign.ts" });
      expect(res.ail).toContain("cell &= -(1 << 2)");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles 'cell &= mask' in expression position inside function into AssignExpr with op '&='", () => {
      const tsCode = `
function test(cell: number, mask: number) {
  const masked = (cell &= mask);
  return masked;
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "and_assign_expr.ts" });

      const fn = res.ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const decl = body.statements[0] as LetBinding;
      expect(decl.init.kind).toBe("AssignExpr");
      const assign = decl.init as AssignExpr;
      expect(assign.op).toBe("&=");
      expect((assign.target as IdentifierExpr).name).toBe("cell");
      expect((assign.value as IdentifierExpr).name).toBe("mask");

      expect(res.ail).toContain("masked := cell &= mask");
    });
  });

  describe("Pattern 7: '>>=' and All Shift / Power Compound Assignments", () => {
    it("decompiles 'v >>= 7' into AssignStmt with op '>>='", () => {
      const tsCode = `
function shiftRight(v: number) {
  v >>= 7;
  return v;
}
`;
      const decompiler = new TsDecompiler(tsCode, "shr_assign.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const stmt = body.statements[0] as AssignStmt;
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe(">>=");
      expect((stmt.target as IdentifierExpr).name).toBe("v");
      expect((stmt.value as LiteralExpr).value).toBe(7);

      const res = decompile(tsCode, "typescript", { filePath: "shr_assign.ts" });
      expect(res.ail).toContain("v >>= 7");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles '<<=', '>>>=', and '**=' compound assignments cleanly", () => {
      const tsCode = `
function bitwiseShifts(a: number, b: number, c: number) {
  a <<= 2;
  b >>>= 1;
  c **= 3;
}
`;
      const decompiler = new TsDecompiler(tsCode, "all_shifts.ts");
      const { ast } = decompiler.decompile();

      const fn = ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      expect(body.statements).toHaveLength(3);

      const stmt1 = body.statements[0] as AssignStmt;
      expect(stmt1.kind).toBe("AssignStmt");
      expect(stmt1.op).toBe("<<=");
      expect((stmt1.target as IdentifierExpr).name).toBe("a");

      const stmt2 = body.statements[1] as AssignStmt;
      expect(stmt2.kind).toBe("AssignStmt");
      expect(stmt2.op).toBe(">>>=");
      expect((stmt2.target as IdentifierExpr).name).toBe("b");

      const stmt3 = body.statements[2] as AssignStmt;
      expect(stmt3.kind).toBe("AssignStmt");
      expect(stmt3.op).toBe("**=");
      expect((stmt3.target as IdentifierExpr).name).toBe("c");

      const res = decompile(tsCode, "typescript", { filePath: "all_shifts.ts" });
      expect(res.ail).toContain("a <<= 2");
      expect(res.ail).toContain("b >>>= 1");
      expect(res.ail).toContain("c **= 3");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });

    it("decompiles arithmetic compound assignments '+=', '-=', '*=', '/=', '%='", () => {
      const tsCode = `
function arithmetic(x: number) {
  x += 1;
  x -= 2;
  x *= 3;
  x /= 4;
  x %= 5;
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "arith_assign.ts" });
      const fn = res.ast.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const expectedOps = ["+=", "-=", "*=", "/=", "%="];
      for (let i = 0; i < expectedOps.length; i++) {
        const stmt = body.statements[i] as AssignStmt;
        expect(stmt.kind).toBe("AssignStmt");
        expect(stmt.op).toBe(expectedOps[i]);
      }

      expect(res.ail).toContain("x += 1");
      expect(res.ail).toContain("x -= 2");
      expect(res.ail).toContain("x *= 3");
      expect(res.ail).toContain("x /= 4");
      expect(res.ail).toContain("x %= 5");

      const roundtripMod = parse(res.ail, "roundtrip.ail");
      expect(roundtripMod.items).toHaveLength(1);
    });
  });
});
