import { describe, expect, it } from "vitest";
import type {
  AssignExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  CallExpr,
  ClosureExpr,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  LiteralExpr,
  MemberAccessExpr,
  WhileStmt,
} from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";

describe("Step 3: Pratt Parser Grammar & Precedence Upgrades", () => {
  describe("Relational 'in' Operator", () => {
    it("parses 'x in obj' as BinaryExpr with operator 'in'", () => {
      const src = `fn check(x: str, obj: any) = x in obj`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const bin = fn.body as BinaryExpr;
      expect(bin.operator).toBe("in");
      expect(bin.left.kind).toBe("IdentifierExpr");
      expect((bin.left as IdentifierExpr).name).toBe("x");
      expect(bin.right.kind).toBe("IdentifierExpr");
      expect((bin.right as IdentifierExpr).name).toBe("obj");
    });

    it("parses \"'shield' in p\" as BinaryExpr with string literal and identifier", () => {
      const src = `fn hasShield(p: any) = 'shield' in p`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const bin = fn.body as BinaryExpr;
      expect(bin.operator).toBe("in");
      expect(bin.left.kind).toBe("LiteralExpr");
      expect((bin.left as LiteralExpr).value).toBe("shield");
      expect(bin.right.kind).toBe("IdentifierExpr");
      expect((bin.right as IdentifierExpr).name).toBe("p");
    });

    it("respects operator precedence: 'in' binds tighter than 'and' and 'or'", () => {
      const src = `fn test(x: str, a: any, y: str, b: any) = x in a and y in b`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const andExpr = fn.body as BinaryExpr;
      expect(andExpr.operator).toBe("and");
      expect((andExpr.left as BinaryExpr).operator).toBe("in");
      expect((andExpr.right as BinaryExpr).operator).toBe("in");
    });

    it("respects operator precedence: arithmetic binds tighter than 'in'", () => {
      const src = `fn test(a: int, b: int, list: any) = a + b in list`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const inExpr = fn.body as BinaryExpr;
      expect(inExpr.operator).toBe("in");
      expect((inExpr.left as BinaryExpr).operator).toBe("+");
      expect((inExpr.right as IdentifierExpr).name).toBe("list");
    });

    it("respects operator precedence: 'in' binds tighter than '=='", () => {
      const src = `fn test(x: str, a: any, b: bool) = x in a == b`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const eqExpr = fn.body as BinaryExpr;
      expect(eqExpr.operator).toBe("==");
      expect((eqExpr.left as BinaryExpr).operator).toBe("in");
      expect((eqExpr.right as IdentifierExpr).name).toBe("b");
    });
  });

  describe("Relational 'instanceof' Operator", () => {
    it("parses 'o instanceof Vec2' as BinaryExpr with operator 'instanceof'", () => {
      const src = `fn check(o: any) = o instanceof Vec2`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const bin = fn.body as BinaryExpr;
      expect(bin.operator).toBe("instanceof");
      expect(bin.left.kind).toBe("IdentifierExpr");
      expect((bin.left as IdentifierExpr).name).toBe("o");
      expect(bin.right.kind).toBe("IdentifierExpr");
      expect((bin.right as IdentifierExpr).name).toBe("Vec2");
    });

    it("parses 'err instanceof Error' as BinaryExpr with operator 'instanceof'", () => {
      const src = `fn isErr(err: any) = err instanceof Error`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const bin = fn.body as BinaryExpr;
      expect(bin.operator).toBe("instanceof");
      expect((bin.left as IdentifierExpr).name).toBe("err");
      expect((bin.right as IdentifierExpr).name).toBe("Error");
    });

    it("respects operator precedence: 'instanceof' binds tighter than 'or'", () => {
      const src = `fn test(o: any) = o instanceof Vec2 or o instanceof Vec3`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("BinaryExpr");
      const orExpr = fn.body as BinaryExpr;
      expect(orExpr.operator).toBe("or");
      expect((orExpr.left as BinaryExpr).operator).toBe("instanceof");
      expect((orExpr.right as BinaryExpr).operator).toBe("instanceof");
    });
  });

  describe("Compound Assignment Statements", () => {
    it("parses 's |= 0' into AssignStmt with op '|='", () => {
      const src = `fn run():\n  s |= 0`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("|=");
      expect((stmt.target as IdentifierExpr).name).toBe("s");
      expect((stmt.value as LiteralExpr).value).toBe(0);
    });

    it("parses 'hash ^= char' into AssignStmt with op '^='", () => {
      const src = `fn run():\n  hash ^= char`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("^=");
      expect((stmt.target as IdentifierExpr).name).toBe("hash");
      expect((stmt.value as IdentifierExpr).name).toBe("char");
    });

    it("parses 'cell &= mask' into AssignStmt with op '&='", () => {
      const src = `fn run():\n  cell &= mask`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("&=");
      expect((stmt.target as IdentifierExpr).name).toBe("cell");
      expect((stmt.value as IdentifierExpr).name).toBe("mask");
    });

    it("parses 'v >>= 7' into AssignStmt with op '>>='", () => {
      const src = `fn run():\n  v >>= 7`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe(">>=");
      expect((stmt.target as IdentifierExpr).name).toBe("v");
      expect((stmt.value as LiteralExpr).value).toBe(7);
    });

    it("parses 'v <<= 2' into AssignStmt with op '<<='", () => {
      const src = `fn run():\n  v <<= 2`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("<<=");
      expect((stmt.target as IdentifierExpr).name).toBe("v");
      expect((stmt.value as LiteralExpr).value).toBe(2);
    });

    it("parses 'v >>>= 1' into AssignStmt with op '>>>='", () => {
      const src = `fn run():\n  v >>>= 1`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe(">>>=");
      expect((stmt.target as IdentifierExpr).name).toBe("v");
      expect((stmt.value as LiteralExpr).value).toBe(1);
    });

    it("parses 'p **= 2' into AssignStmt with op '**='", () => {
      const src = `fn run():\n  p **= 2`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
      const stmt = body.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.op).toBe("**=");
      expect((stmt.target as IdentifierExpr).name).toBe("p");
      expect((stmt.value as LiteralExpr).value).toBe(2);
    });

    it("parses all compound assignment operators on member access targets", () => {
      const ops = [
        ["obj.val |= 1", "|="],
        ["obj.val ^= 2", "^="],
        ["obj.val &= 3", "&="],
        ["obj.val <<= 4", "<<="],
        ["obj.val >>= 5", ">>="],
        ["obj.val >>>= 6", ">>>="],
        ["obj.val **= 7", "**="],
      ] as const;

      for (const [code, expectedOp] of ops) {
        const src = `fn run():\n  ${code}`;
        const mod = parse(src, "test.ail");
        const fn = mod.items[0] as FunctionDecl;
        const body = fn.body as { kind: "Block"; statements: AssignStmt[] };
        const stmt = body.statements[0];
        expect(stmt.kind).toBe("AssignStmt");
        expect(stmt.op).toBe(expectedOp);
        expect(stmt.target.kind).toBe("MemberAccessExpr");
        const mem = stmt.target as MemberAccessExpr;
        expect((mem.object as IdentifierExpr).name).toBe("obj");
        expect(mem.property).toBe("val");
      }
    });
  });

  describe("AssignExpr in Expression Positions", () => {
    it("parses AssignExpr in arrow function body: (el) => (el.textContent = v)", () => {
      const src = `fn makeSetter() = (el) => (el.textContent = v)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("ClosureExpr");
      const closure = fn.body as ClosureExpr;
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
    });

    it("parses compound AssignExpr in arrow function body: (item) => (item.count += 1)", () => {
      const src = `fn inc() = (item) => (item.count += 1)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("ClosureExpr");
      const closure = fn.body as ClosureExpr;
      expect(closure.body.kind).toBe("AssignExpr");
      const assign = closure.body as AssignExpr;
      expect(assign.op).toBe("+=");
      expect((assign.value as LiteralExpr).value).toBe(1);
    });

    it("parses bitwise compound AssignExpr in arrow function body: (mask) => (flags |= mask)", () => {
      const src = `fn applyFlag() = (mask) => (flags |= mask)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("ClosureExpr");
      const closure = fn.body as ClosureExpr;
      expect(closure.body.kind).toBe("AssignExpr");
      const assign = closure.body as AssignExpr;
      expect(assign.op).toBe("|=");
      expect((assign.target as IdentifierExpr).name).toBe("flags");
      expect((assign.value as IdentifierExpr).name).toBe("mask");
    });

    it("parses AssignExpr in while loop condition: while ((pMatch = regex.exec(s)) != nil):", () => {
      const src = `fn matchAll(regex: any, s: str):
  while ((pMatch = regex.exec(s)) != nil):
    print(pMatch)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const whileStmt = body.statements[0] as WhileStmt;
      expect(whileStmt.kind).toBe("WhileStmt");

      // Condition: ((pMatch = regex.exec(s)) != nil)
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
      expect(call.callee.kind).toBe("MemberAccessExpr");
      expect(((call.callee as MemberAccessExpr).object as IdentifierExpr).name).toBe("regex");
      expect((call.callee as MemberAccessExpr).property).toBe("exec");
      expect(call.args).toHaveLength(1);
      expect((call.args[0] as IdentifierExpr).name).toBe("s");
    });
  });

  describe("For-In Loop Syntax Disambiguation", () => {
    it("parses 'for x in arr:' cleanly without conflict with 'in' operator", () => {
      const src = `fn process(arr: [int]):
  for x in arr:
    print(x)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const forStmt = body.statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("x");
      expect(forStmt.iterable.kind).toBe("IdentifierExpr");
      expect((forStmt.iterable as IdentifierExpr).name).toBe("arr");
      expect(forStmt.body.statements).toHaveLength(1);
    });

    it("parses for loop with array destructuring: 'for [k, v] in entries:'", () => {
      const src = `fn iterate(entries: any):
  for [k, v] in entries:
    print(k, v)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const forStmt = body.statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("[k, v]");
      expect(forStmt.iterable.kind).toBe("IdentifierExpr");
      expect((forStmt.iterable as IdentifierExpr).name).toBe("entries");
    });

    it("parses for loop with member access and call expression iterable", () => {
      const src = `fn iterate(obj: any):
  for item in obj.getItems():
    print(item)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const forStmt = body.statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("item");
      expect(forStmt.iterable.kind).toBe("CallExpr");
    });

    it("parses for loop body containing an 'in' binary expression", () => {
      const src = `fn filterItems(arr: [str], whitelist: any):
  for item in arr:
    if item in whitelist:
      print(item)`;
      const mod = parse(src, "test.ail");
      const fn = mod.items[0] as FunctionDecl;
      const body = fn.body as Block;
      const forStmt = body.statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("item");

      const ifStmt = forStmt.body.statements[0] as {
        kind: "IfStmt";
        condition: BinaryExpr;
      };
      expect(ifStmt.condition.kind).toBe("BinaryExpr");
      expect(ifStmt.condition.operator).toBe("in");
      expect((ifStmt.condition.left as IdentifierExpr).name).toBe("item");
      expect((ifStmt.condition.right as IdentifierExpr).name).toBe("whitelist");
    });
  });
});
