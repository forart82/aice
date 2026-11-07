/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Multi-Language Decompilers (Phase 2.1).
 */

import { describe, expect, it } from "vitest";
import type {
  AwaitExpr,
  Block,
  CallExpr,
  ClassDecl,
  ConstDecl,
  FunctionDecl,
  IdentifierExpr,
  LetBinding,
  MemberAccessExpr,
  ReturnStmt,
  TemplateLiteralExpr,
} from "../../src/core/ast.js";
import { Precedence, parse } from "../../src/core/parser.js";
import {
  getBinaryOpPrecedence,
  isRightAssociative,
  needsBinaryParentheses,
} from "../../src/decompiler/aice-generator.js";
import { CssDecompiler } from "../../src/decompiler/css-decompiler.js";
import { HtmlDecompiler } from "../../src/decompiler/html-decompiler.js";
import { decompile } from "../../src/decompiler/index.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("TypeScript & TSX Decompiler", () => {
  it("decompiles TypeScript interfaces into AICE TypeDecl", () => {
    const tsCode = `
export interface UserProfile {
  id: string;
  name: string;
  age: number;
  isActive: boolean;
}
`;
    const decompiler = new TsDecompiler(tsCode, "user.ts");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const item = ast.items[0];
    expect(item.kind).toBe("TypeDecl");
    if (item.kind === "TypeDecl") {
      expect(item.name).toBe("UserProfile");
      expect(item.fields).toHaveLength(4);
      expect(item.fields?.[0].name).toBe("id");
      expect(item.fields?.[0].typeAnnotation.kind).toBe("PrimitiveType");
      expect(item.fields?.[2].name).toBe("age");
    }
  });

  it("decompiles TypeScript tuple types into AICE TupleType", () => {
    const tsCode = `
export interface Pair {
  coords: [number, number];
  entry: [string, boolean];
}
`;
    const decompiler = new TsDecompiler(tsCode, "tuple.ts");
    const { ast } = decompiler.decompile();
    const item = ast.items[0];
    expect(item.kind).toBe("TypeDecl");
    if (item.kind === "TypeDecl") {
      expect(item.fields?.[0].typeAnnotation).toMatchObject({
        kind: "TupleType",
        elementTypes: [
          { kind: "PrimitiveType", primitive: "int" },
          { kind: "PrimitiveType", primitive: "int" },
        ],
      });
      expect(item.fields?.[1].typeAnnotation).toMatchObject({
        kind: "TupleType",
        elementTypes: [
          { kind: "PrimitiveType", primitive: "str" },
          { kind: "PrimitiveType", primitive: "bool" },
        ],
      });
    }

    const res = decompile(tsCode, "typescript", { filePath: "tuple.ts" });
    expect(res.aice).toContain("coords:[int, int]");
    expect(res.aice).toContain("entry:[str, bool]");
  });

  it("extracts JSDoc comments into CstTriviaTable", () => {
    const tsCode = `
/**
 * Authentication service contract
 */
export interface AuthToken {
  token: string;
}
`;
    const decompiler = new TsDecompiler(tsCode, "auth.ts");
    const { ast, trivia } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const entry = trivia.getTrivia("type:AuthToken");
    expect(entry).toBeDefined();
    expect(entry?.leading[0].kind).toBe("DOCSTRING");
    expect(entry?.leading[0].content).toContain("Authentication service contract");
  });

  it("decompiles TypeScript functions and control flow", () => {
    const tsCode = `
export function computeTotal(basePrice: number, quantity: number, isVip: boolean): number {
  const subtotal = basePrice * quantity;
  if (isVip) {
    return subtotal * 0.8;
  }
  return subtotal;
}
`;
    const decompiler = new TsDecompiler(tsCode, "pricing.ts");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const fn = ast.items[0];
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind === "FunctionDecl") {
      expect(fn.name).toBe("computeTotal");
      expect(fn.params).toHaveLength(3);
      expect(fn.params[0].name).toBe("basePrice");
      expect(fn.params[2].name).toBe("isVip");
    }
  });

  it("Step 8: decompiles complete binary operators (**, &, |, ^, <<, >>, >>>) and formats cleanly", () => {
    const tsCode = `
export function bitOps(a: number, b: number) {
  const p = a ** b;
  const andVal = a & b;
  const orVal = a | b;
  const xorVal = a ^ b;
  const shlVal = a << b;
  const shrVal = a >> b;
  const ushrVal = a >>> b;
}
`;
    const decompiler = new TsDecompiler(tsCode, "ops.ts");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const fn = ast.items[0];
    expect(fn.kind).toBe("FunctionDecl");
    if (fn.kind === "FunctionDecl" && fn.body.kind === "Block") {
      const stmts = fn.body.statements;
      expect(stmts).toHaveLength(7);
      const expectedOps = ["**", "&", "|", "^", "<<", ">>", ">>>"];
      for (let i = 0; i < expectedOps.length; i++) {
        const letStmt = stmts[i];
        expect(letStmt.kind).toBe("LetBinding");
        if (letStmt.kind === "LetBinding") {
          expect(letStmt.init.kind).toBe("BinaryExpr");
          if (letStmt.init.kind === "BinaryExpr") {
            expect(letStmt.init.operator).toBe(expectedOps[i]);
          }
        }
      }
    }

    const res = decompile(tsCode, "typescript", { filePath: "ops.ts" });
    expect(res.aice).toContain("a ** b");
    expect(res.aice).toContain("a & b");
    expect(res.aice).toContain("a | b");
    expect(res.aice).toContain("a ^ b");
    expect(res.aice).toContain("a << b");
    expect(res.aice).toContain("a >> b");
    expect(res.aice).toContain("a >>> b");
  });

  describe("Step 9: Binary Expression Precedence & Parenthesization", () => {
    it("preserves arithmetic precedence with correct parenthesization", () => {
      const tsCode = `
export function math(a: number, b: number, c: number) {
  const p1 = (a + b) * c;
  const p2 = a * (b + c);
  const p3 = a - (b - c);
  const p4 = (a - b) - c;
  const p5 = a / (b / c);
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "math.ts" });
      expect(res.aice).toContain("p1 := (a + b) * c");
      expect(res.aice).toContain("p2 := a * (b + c)");
      expect(res.aice).toContain("p3 := a - (b - c)");
      expect(res.aice).toContain("p4 := a - b - c");
      expect(res.aice).toContain("p5 := a / (b / c)");
    });

    it("preserves exponentiation precedence and right-associativity", () => {
      const tsCode = `
export function pow(a: number, b: number, c: number) {
  const e1 = (a ** b) ** c;
  const e2 = a ** (b ** c);
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "pow.ts" });
      expect(res.aice).toContain("e1 := (a ** b) ** c");
      expect(res.aice).toContain("e2 := a ** b ** c");
    });

    it("preserves bitwise and shift precedence", () => {
      const tsCode = `
export function bitwise(a: number, b: number, c: number) {
  const b1 = (a & b) | c;
  const b2 = a & (b | c);
  const b3 = (a + b) << c;
  const b4 = a + (b << c);
  const b5 = (a << b) + c;
  const b6 = a << (b << c);
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "bitwise.ts" });
      expect(res.aice).toContain("b1 := a & b | c");
      expect(res.aice).toContain("b2 := a & (b | c)");
      expect(res.aice).toContain("b3 := a + b << c");
      expect(res.aice).toContain("b4 := a + (b << c)");
      expect(res.aice).toContain("b5 := (a << b) + c");
      expect(res.aice).toContain("b6 := a << (b << c)");
    });

    it("preserves logical precedence when mixing and and or", () => {
      const tsCode = `
export function logic(a: boolean, b: boolean, c: boolean) {
  const l1 = (a || b) && c;
  const l2 = a && (b || c);
  const l3 = (a && b) || c;
  const l4 = a || (b && c);
  const l5 = a && b && c;
  const l6 = a || b || c;
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "logic.ts" });
      expect(res.aice).toContain("l1 := (a or b) and c");
      expect(res.aice).toContain("l2 := a and (b or c)");
      expect(res.aice).toContain("l3 := (a and b) or c");
      expect(res.aice).toContain("l4 := a or (b and c)");
      expect(res.aice).toContain("l5 := a and b and c");
      expect(res.aice).toContain("l6 := a or b or c");
    });

    it("parenthesizes object in MemberAccessExpr and IndexExpr when needed", () => {
      const tsCode = `
export function access(a: any, b: any, x: any) {
  const m1 = (a + b).toString();
  const m2 = (-x).abs();
  const i1 = (a + b)[0];
  const i2 = (-x)[0];
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "access.ts" });
      expect(res.aice).toContain("m1 := (a + b).toString()");
      expect(res.aice).toContain("m2 := (-x).abs()");
      expect(res.aice).toContain("i1 := (a + b)[0]");
      expect(res.aice).toContain("i2 := (-x)[0]");
    });

    it("parenthesizes non-identifier callee in CallExpr", () => {
      const tsCode = `
export function callFn(a: any, b: any) {
  const c1 = ((() => 1))();
  const c2 = (a ? b : a)();
}
`;
      const res = decompile(tsCode, "typescript", { filePath: "call.ts" });
      expect(res.aice).toContain("c1 := (fn() = 1)()");
      expect(res.aice).toContain("c2 := ((a and b) or a)()");
    });

    it("roundtrips complex mixed expressions with full AST equivalence", () => {
      const tsCode = `
export function roundtrip(a: number, b: number, c: number, d: number) {
  const r1 = (a + b) * c;
  const r2 = a * (b + c);
  const r3 = a - (b - c);
  const r4 = (a - b) - c;
  const r5 = a / (b / c);
  const r6 = (a ** b) ** c;
  const r7 = a ** (b ** c);
  const r8 = (a & b) | c;
  const r9 = a & (b | c);
  const r10 = (a + b) << c;
  const r11 = a + (b << c);
  const r12 = a << (b << c);
  const r13 = (a + b).toString();
  const r14 = (-a).abs();
  const r15 = (a + b)[0];
}
`;
      const decompiler = new TsDecompiler(tsCode, "roundtrip.ts");
      const { ast: originalAst } = decompiler.decompile();
      const res = decompile(tsCode, "typescript", { filePath: "roundtrip.ts" });
      const parsedAst = parse(res.aice, "roundtrip.aice");

      function simplifyExpr(e: any): any {
        if (!e) return e;
        if (e.kind === "BinaryExpr") {
          return {
            kind: e.kind,
            operator: e.operator === "&&" ? "and" : e.operator === "||" ? "or" : e.operator,
            left: simplifyExpr(e.left),
            right: simplifyExpr(e.right),
          };
        }
        if (e.kind === "UnaryExpr") {
          return {
            kind: e.kind,
            operator: e.operator === "!" ? "not" : e.operator,
            operand: simplifyExpr(e.operand),
          };
        }
        if (e.kind === "IdentifierExpr") {
          return { kind: e.kind, name: e.name };
        }
        if (e.kind === "LiteralExpr") {
          return { kind: e.kind, value: e.value };
        }
        if (e.kind === "MemberAccessExpr") {
          return {
            kind: e.kind,
            object: simplifyExpr(e.object),
            property: e.property,
          };
        }
        if (e.kind === "IndexExpr") {
          return {
            kind: e.kind,
            object: simplifyExpr(e.object),
            index: simplifyExpr(e.index),
          };
        }
        return e.kind;
      }

      const origStmts = (originalAst.items[0] as any).body.statements;
      const parsedStmts = (parsedAst.items[0] as any).body.statements;

      expect(parsedStmts).toHaveLength(origStmts.length);
      for (let i = 0; i < origStmts.length; i++) {
        const origInit = simplifyExpr(origStmts[i].init ?? origStmts[i].value);
        const parsedInit = simplifyExpr(parsedStmts[i].init ?? parsedStmts[i].value);
        expect(parsedInit).toEqual(origInit);
      }
    });

    it("exports operator precedence and associativity helper functions", () => {
      expect(getBinaryOpPrecedence("**")).toBe(Precedence.EXPONENT);
      expect(getBinaryOpPrecedence("*")).toBe(Precedence.PRODUCT);
      expect(getBinaryOpPrecedence("+")).toBe(Precedence.SUM);
      expect(getBinaryOpPrecedence("<<")).toBe(Precedence.SHIFT);
      expect(getBinaryOpPrecedence("&")).toBe(Precedence.BIT_AND);
      expect(getBinaryOpPrecedence("^")).toBe(Precedence.BIT_XOR);
      expect(getBinaryOpPrecedence("|")).toBe(Precedence.BIT_OR);
      expect(getBinaryOpPrecedence("and")).toBe(Precedence.AND);
      expect(getBinaryOpPrecedence("or")).toBe(Precedence.OR);

      expect(isRightAssociative("**")).toBe(true);
      expect(isRightAssociative("+")).toBe(false);
      expect(isRightAssociative("-")).toBe(false);
      expect(isRightAssociative("*")).toBe(false);
    });
  });

  it("decompiles React TSX components into AICE ComponentDecl", () => {
    const tsxCode = `
export interface CardProps {
  title: string;
  badge: string;
}

export function Card({ title, badge }: CardProps) {
  return (
    <div className="card-container">
      <h2 className="title">{title}</h2>
      <span className="badge">{badge}</span>
    </div>
  );
}
`;
    const result = decompile(tsxCode, "tsx", { filePath: "card.tsx" });
    expect(result.aice).toContain("type CardProps:");
    expect(result.aice).toContain("component Card(title:str, badge:str):");
    expect(result.aice).toContain('div(class: "card-container"):');
    expect(result.aice).toContain('h2(class: "title"): "{title}"');

    // Verify generated AICE parses and typechecks
    const mod = parse(result.aice, "card.tsx.aice");
    const tc = new TypeChecker();
    tc.checkModule(mod);
    expect(mod.items).toHaveLength(2);
  });

  it("decompiles await expressions without falling back to nil", () => {
    const tsCode = `
export async function fetchData() {
  const result = await fetch("https://example.com");
  return result;
}
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "fetch.ts" });
    expect(aice).toContain("await fetch(");
    expect(aice).not.toContain("nil(");
    const fn = ast.items[0] as FunctionDecl;
    const body = fn.body as Block;
    const letStmt = body.statements[0] as LetBinding;
    expect(letStmt.init.kind).toBe("AwaitExpr");
    const awaitExpr = letStmt.init as AwaitExpr;
    expect(awaitExpr.operand.kind).toBe("CallExpr");
  });

  it("decompiles super() constructor calls without falling back to nil", () => {
    const tsCode = `
export class Derived extends Base {
  constructor(x: number) {
    super(x);
  }
}
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "derived.ts" });
    expect(aice).toContain("super(x)");
    expect(aice).not.toContain("nil(x)");
    const cls = ast.items[0] as ClassDecl;
    const ctor = cls.methods.find((m) => m.name === "constructor")!;
    const body = ctor.body as Block;
    const stmt = body.statements[0] as { kind: "ExprStmt"; expr: CallExpr };
    expect(stmt.expr.kind).toBe("CallExpr");
    expect(stmt.expr.callee).toEqual({
      kind: "IdentifierExpr",
      name: "super",
      span: expect.any(Object),
    });
  });

  it("decompiles super.foo() method calls without falling back to nil", () => {
    const tsCode = `
export class Derived extends Base {
  greet(): string {
    return super.greet();
  }
}
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "derived.ts" });
    expect(aice).toContain("super.greet()");
    expect(aice).not.toContain("nil.greet()");
    const cls = ast.items[0] as ClassDecl;
    const m = cls.methods.find((m) => m.name === "greet")!;
    const callExpr = (
      m.isExpressionBodied
        ? m.body
        : ((m.body as Block).statements[0] as { kind: "ReturnStmt"; value: CallExpr }).value
    ) as CallExpr;
    expect(callExpr.kind).toBe("CallExpr");
    const callee = callExpr.callee as MemberAccessExpr;
    expect(callee.kind).toBe("MemberAccessExpr");
    expect(callee.property).toBe("greet");
    expect(callee.object).toEqual({
      kind: "IdentifierExpr",
      name: "super",
      span: expect.any(Object),
    });
  });

  it("decompiles regular expression literals into RegExp(pattern, flags)", () => {
    const tsCode = `
export const pattern = /regex/g;
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "regex.ts" });
    expect(aice).toContain('RegExp("regex", "g")');
    expect(aice).not.toContain("nil");
    const c = ast.items[0] as ConstDecl;
    expect(c.value.kind).toBe("CallExpr");
    const call = c.value as CallExpr;
    expect(call.callee).toEqual({
      kind: "IdentifierExpr",
      name: "RegExp",
      span: expect.any(Object),
    });
    expect(call.args).toHaveLength(2);
    expect(call.args[0]).toMatchObject({ kind: "LiteralExpr", value: "regex" });
    expect(call.args[1]).toMatchObject({ kind: "LiteralExpr", value: "g" });
  });

  describe("Step 11: String Literal Unions vs Enums Decompilation", () => {
    it("preserves string literal unions as type aliases by default", () => {
      const tsCode = `
export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "http.ts" });
      expect(ast.items).toHaveLength(1);
      const item = ast.items[0];
      expect(item.kind).toBe("TypeDecl");
      if (item.kind === "TypeDecl") {
        expect(item.name).toBe("HttpMethod");
        expect(item.isEnum).toBe(false);
        expect(item.aliasType).toBeDefined();
        expect(item.aliasType?.kind).toBe("NamedType");
        if (item.aliasType?.kind === "NamedType") {
          expect(item.aliasType.name).toBe('"GET" | "POST" | "PUT" | "DELETE"');
        }
      }
      expect(aice).toContain('type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"');
      expect(aice).not.toContain("enum HttpMethod");
    });

    it("supports convertStringUnionsToEnum option to emit synthetic enums when requested", () => {
      const tsCode = `
export type HttpMethod = "GET" | "POST" | "DELETE";
`;
      const { ast, aice } = decompile(tsCode, "typescript", {
        filePath: "http.ts",
        convertStringUnionsToEnum: true,
      });
      expect(ast.items).toHaveLength(1);
      const item = ast.items[0];
      expect(item.kind).toBe("TypeDecl");
      if (item.kind === "TypeDecl") {
        expect(item.name).toBe("HttpMethod");
        expect(item.isEnum).toBe(true);
        expect(item.variants?.map((v) => v.name)).toEqual(["GET", "POST", "DELETE"]);
      }
      expect(aice).toContain("enum HttpMethod:");
      expect(aice).toContain("GET");
      expect(aice).toContain("POST");
      expect(aice).toContain("DELETE");
    });

    it("decompiles numeric and boolean literal unions without converting to enum", () => {
      const tsCode = `
export type Direction = 1 | -1;
export type Toggle = true | false;
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "types.ts" });
      expect(ast.items).toHaveLength(2);
      expect(aice).toContain("type Direction = 1 | -1");
      expect(aice).toContain("type Toggle = true | false");
    });

    it("decompiles literal type annotations on variables and function params", () => {
      const tsCode = `
export const defaultMethod: "GET" = "GET";
export function request(method: "GET" | "POST"): string {
  return method;
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "req.ts" });
      expect(aice).toContain('defaultMethod: "GET" = "GET"');
      expect(aice).toContain('method:"GET" | "POST"');
    });
  });

  describe("Step 12: Multiline Block Closures Decompilation", () => {
    it("decompiles array callback with multiline block preserving all statements", () => {
      const tsCode = `
export function process(arr: number[]) {
  arr.forEach(x => {
    const y = x * 2;
    log(y);
  });
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "callback.ts" });
      expect(aice).not.toContain("fn() = nil");
      expect(aice).not.toContain("fn(x) = nil");
      expect(aice).toContain("arr.forEach(fn(x) {");
      expect(aice).toContain("y := x * 2");
      expect(aice).toContain("log(y)");
    });

    it("decompiles Promise constructor callback preserving resolve and reject statements", () => {
      const tsCode = `
export function defer() {
  return new Promise((resolve, reject) => {
    setup();
    resolve();
  });
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "promise.ts" });
      expect(aice).not.toContain("fn() = nil");
      expect(aice).toContain("Promise(fn(resolve, reject) {");
      expect(aice).toContain("setup()");
      expect(aice).toContain("resolve()");
    });

    it("formats single-expression and single-return closures cleanly without squashing", () => {
      const tsCode = `
export function single(arr: number[]) {
  const doubled = arr.map(x => x * 2);
  const explicit = arr.map(x => { return x + 1; });
  const empty = arr.forEach(() => {});
}
`;
      const { aice } = decompile(tsCode, "typescript", { filePath: "single.ts" });
      expect(aice).toContain("arr.map(fn(x) = x * 2)");
      expect(aice).toContain("arr.map(fn(x) = x + 1)");
      expect(aice).toContain("arr.forEach(fn() = nil)");
    });

    it("decompiles function expressions into closures without squashing", () => {
      const tsCode = `
export function runWithFn() {
  callHandler(function(err, data) {
    if (err) {
      log(err);
      return;
    }
    process(data);
  });
}
`;
      const { aice } = decompile(tsCode, "typescript", { filePath: "fnexpr.ts" });
      expect(aice).not.toContain("fn() = nil");
      expect(aice).toContain("callHandler(fn(err, data) {");
      expect(aice).toContain("if err:");
      expect(aice).toContain("log(err)");
      expect(aice).toContain("process(data)");
    });
  });
});

describe("CSS Decompiler", () => {
  it("decompiles CSS rules and custom properties", () => {
    const cssCode = `
:root {
  --primary-color: #3b82f6;
  margin: 0;
}

.button-primary {
  display: flex;
  color: #fff;
  padding: 12px;
}
`;
    const decompiler = new CssDecompiler(cssCode, "styles.css");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(2);
    expect(ast.items[0].kind).toBe("StyleDecl");
    if (ast.items[0].kind === "StyleDecl") {
      expect(ast.items[0].name).toBe(":root");
      expect(ast.items[0].properties).toHaveLength(2);
    }
    if (ast.items[1].kind === "StyleDecl") {
      expect(ast.items[1].name).toBe(".button-primary");
      expect(ast.items[1].properties).toHaveLength(3);
    }
  });
});

describe("HTML5 Decompiler", () => {
  it("decompiles HTML markup into AICE Component layout", () => {
    const htmlCode = `
<div class="hero-section" id="hero">
  <h1>Welcome to AICE</h1>
  <p>Universal Token-Dense Language</p>
</div>
`;
    const decompiler = new HtmlDecompiler(htmlCode, "index.html");
    const { ast } = decompiler.decompile();

    expect(ast.items).toHaveLength(1);
    const comp = ast.items[0];
    expect(comp.kind).toBe("ComponentDecl");
    if (comp.kind === "ComponentDecl") {
      expect(comp.layout).toHaveLength(1);
      const rootDiv = comp.layout[0];
      expect(rootDiv.tag).toBe("div");
      expect(rootDiv.attributes).toHaveLength(2);
      expect(rootDiv.children).toHaveLength(2);
      expect(rootDiv.children[0].tag).toBe("h1");
      expect(rootDiv.children[0].textLiteral).toBe("Welcome to AICE");
    }
  });
});

describe("Step 13: TypeScript Decompiler Statement Visitors", () => {
  it("decompiles C-style for loops lowered to while loops with initializer and incrementor", () => {
    const tsCode = `
export function loop() {
  for (let i = 0; i < 10; i++) {
    console.log(i);
  }
}
`;
    const res = decompile(tsCode, "typescript", { filePath: "loop.ts" });
    expect(res.aice).toContain("i ::= 0");
    expect(res.aice).toContain("while i < 10:");
    expect(res.aice).toContain("i = i + 1");
    expect(res.aice).toContain("console.log(i)");
  });

  it("decompiles switch statements lowered to match statements", () => {
    const tsCode = `
export function testSwitch(x: number) {
  switch (x) {
    case 1:
      console.log("one");
      break;
    case 2:
      console.log("two");
      break;
    default:
      console.log("other");
      break;
  }
}
`;
    const res = decompile(tsCode, "typescript", { filePath: "switch.ts" });
    expect(res.aice).toContain("match x:");
    expect(res.aice).toContain("case 1 =>");
    expect(res.aice).toContain('console.log("one")');
    expect(res.aice).toContain("case 2 =>");
    expect(res.aice).toContain('console.log("two")');
    expect(res.aice).toContain("case _ =>");
    expect(res.aice).toContain('console.log("other")');
  });

  it("decompiles try/catch/finally and throw statements", () => {
    const tsCode = `
export function testTry() {
  try {
    throw new Error("failed");
  } catch (err) {
    console.error(err);
  } finally {
    cleanup();
  }
}
`;
    const res = decompile(tsCode, "typescript", { filePath: "try.ts" });
    expect(res.aice).toContain("try:");
    expect(res.aice).toContain('throw Error("failed")');
    expect(res.aice).toContain("catch err:");
    expect(res.aice).toContain("console.error(err)");
    expect(res.aice).toContain("finally:");
    expect(res.aice).toContain("cleanup()");
  });

  it("decompiles break and continue statements", () => {
    const tsCode = `
export function testBreakContinue() {
  while (true) {
    if (check()) {
      continue;
    } else {
      break;
    }
  }
}
`;
    const res = decompile(tsCode, "typescript", { filePath: "brk.ts" });
    expect(res.aice).toContain("continue");
    expect(res.aice).toContain("break");
  });

  it("decompiles barrel re-exports", () => {
    const tsCode = `
export * from "./math";
export { add, sub as subtract } from "./ops";
export * as utils from "./utils";
`;
    const decompiler = new TsDecompiler(tsCode, "barrel.ts");
    const { ast } = decompiler.decompile();
    expect(ast.items).toHaveLength(3);
    const imp1 = ast.items[0] as any;
    const imp2 = ast.items[1] as any;
    const imp3 = ast.items[2] as any;
    expect(imp1.kind).toBe("ImportDecl");
    expect(imp1.isExported).toBe(true);
    expect(imp1.specifiers[0].isWildcard).toBe(true);
    expect(imp2.kind).toBe("ImportDecl");
    expect(imp2.isExported).toBe(true);
    expect(imp2.specifiers).toHaveLength(2);
    expect(imp3.kind).toBe("ImportDecl");
    expect(imp3.isExported).toBe(true);
    expect(imp3.specifiers[0].alias).toBe("utils");
  });

  it("decompiles class static blocks", () => {
    const tsCode = `
export class MyClass {
  static version = 1;
  static {
    console.log("initialized");
  }
}
`;
    const decompiler = new TsDecompiler(tsCode, "cls.ts");
    const { ast } = decompiler.decompile();
    expect(ast.items).toHaveLength(1);
    const cls = ast.items[0] as any;
    expect(cls.kind).toBe("ClassDecl");
    expect(cls.staticBlocks).toHaveLength(1);
    expect(cls.staticBlocks[0].statements).toHaveLength(1);
  });

  it("decompiles TypeScript async function to AICE async fn", () => {
    const tsCode = `
export async function fetchData(url: string): Promise<string> {
  return "data";
}
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "async.ts" });
    const fn = ast.items.find((item: any) => item.kind === "FunctionDecl") as any;
    expect(fn).toBeDefined();
    expect(fn.name).toBe("fetchData");
    expect(fn.isAsync).toBe(true);
    expect(aice).toContain("async fn fetchData");
  });

  it("Step 17: decompiles TypeScript functions with optional parameters", () => {
    const tsCode = `
export function formatUser(name: string, age?: number, role?: string): string {
  return name;
}
`;
    const { ast, aice } = decompile(tsCode, "typescript", { filePath: "opt.ts" });
    const fn = ast.items.find((item: any) => item.kind === "FunctionDecl") as any;
    expect(fn).toBeDefined();
    expect(fn.name).toBe("formatUser");
    expect(fn.params).toHaveLength(3);
    expect(fn.params[0].name).toBe("name");
    expect(fn.params[0].isOptional).toBeUndefined();
    expect(fn.params[1].name).toBe("age");
    expect(fn.params[1].isOptional).toBe(true);
    expect(fn.params[2].name).toBe("role");
    expect(fn.params[2].isOptional).toBe(true);
    expect(aice).toContain("formatUser(name:str, age?:int, role?:str)");
  });

  describe("Step 19: Decompiler Truthiness Adaptation (Zero-Implicit-Coercion)", () => {
    it("decompiles TS if (arr.length) to if arr.length != 0:", () => {
      const tsCode = `
export function processItems(arr: number[]): number {
  if (arr.length) {
    return 1;
  }
  return 0;
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "length.ts" });
      expect(aice).toContain("if arr.length != 0:");
      expect(aice).not.toContain("if arr.length:");
      const fn = ast.items.find((item: any) => item.kind === "FunctionDecl") as any;
      expect(fn).toBeDefined();
      const ifStmt = fn.body.statements[0];
      expect(ifStmt.kind).toBe("IfStmt");
      expect(ifStmt.condition.kind).toBe("BinaryExpr");
      expect(ifStmt.condition.operator).toBe("!=");
      expect(ifStmt.condition.right.value).toBe(0);
    });

    it("decompiles TS if (flags & 1) to if (flags & 1) != 0:", () => {
      const tsCode = `
export function checkFlag(flags: number): boolean {
  if (flags & 1) {
    return true;
  }
  return false;
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "flags.ts" });
      expect(aice).toContain("if (flags & 1) != 0:");
      const fn = ast.items.find((item: any) => item.kind === "FunctionDecl") as any;
      expect(fn).toBeDefined();
      const ifStmt = fn.body.statements[0];
      expect(ifStmt.kind).toBe("IfStmt");
      expect(ifStmt.condition.kind).toBe("BinaryExpr");
      expect(ifStmt.condition.operator).toBe("!=");
      expect(ifStmt.condition.right.value).toBe(0);
    });

    it('decompiles numeric identifier conditions to != 0 and string conditions to != ""', () => {
      const tsCode = `
export function checkValues(count: number, name: string): void {
  if (count) {
    console.log("has count");
  }
  if (name) {
    console.log("has name");
  }
}
`;
      const { aice } = decompile(tsCode, "typescript", { filePath: "values.ts" });
      expect(aice).toContain("if count != 0:");
      expect(aice).toContain('if name != "":');
    });

    it("decompiles while loop and ternary non-boolean conditions with truthiness adaptation", () => {
      const tsCode = `
export function loopAndTernary(arr: number[], flags: number): number {
  while (arr.length) {
    arr.pop();
  }
  return flags & 1 ? 42 : 0;
}
`;
      const { aice } = decompile(tsCode, "typescript", { filePath: "loop.ts" });
      expect(aice).toContain("while arr.length != 0:");
      expect(aice).toContain("(flags & 1) != 0");
    });

    it("decompiles TypeScript template expressions to TemplateLiteralExpr and generates clean AICE", () => {
      const tsCode = `
export function greet(name: string, count: number): string {
  return \`Hello \${name}, you have \${count + 1} items!\`;
}
`;
      const { ast, aice } = decompile(tsCode, "typescript", { filePath: "greet.ts" });
      const fn = ast.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      const expr = (
        fn.isExpressionBodied ? fn.body : ((fn.body as Block).statements[0] as ReturnStmt).value
      ) as TemplateLiteralExpr;
      expect(expr.kind).toBe("TemplateLiteralExpr");
      expect(expr.quasis).toEqual(["Hello ", ", you have ", " items!"]);
      expect(expr.expressions).toHaveLength(2);
      expect(aice).toContain("`Hello ${name}, you have ${count + 1} items!`");
    });

    it("decompiles multiline template literals to multiline raw strings in AICE", () => {
      const tsCode = `
export const query = \`SELECT *
FROM users
WHERE active = true\`;
`;
      const { aice } = decompile(tsCode, "typescript", { filePath: "query.ts" });
      expect(aice).toContain('"""\nSELECT *\nFROM users\nWHERE active = true\n"""');
    });
  });
});
