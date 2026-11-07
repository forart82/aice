import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parse, parseWithTrivia } from "../../src/core/parser.js";
import {
  detectTargetFromPath,
  emitTarget,
  emitTypeScript,
  getTargetOutputPath,
  lowerConstructor,
  lowerMethodCall,
  lowerPropertyAccess,
} from "../../src/emitters/index.js";
import { TsDecompiler } from "../../src/decompiler/ts-decompiler.js";
import { AiceGenerator } from "../../src/decompiler/aice-generator.js";
import { TypeScriptEmitter } from "../../src/emitters/ts-emitter.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

describe("Step 5: Multi-Language Forward Emitters & Lowering", () => {
  describe("Path & Target Detection", () => {
    it("detects targets correctly from file extensions", () => {
      expect(detectTargetFromPath("auth.ts.aice")).toBe("typescript");
      expect(detectTargetFromPath("button.tsx.aice")).toBe("tsx");
      expect(detectTargetFromPath("server.py.aice")).toBe("python");
      expect(detectTargetFromPath("index.html.aice")).toBe("html");
      expect(detectTargetFromPath("theme.css.aice")).toBe("css");
    });

    it("derives output target paths by stripping .aice", () => {
      expect(getTargetOutputPath("src/auth.ts.aice")).toBe("src/auth.ts");
      expect(getTargetOutputPath("components/Card.tsx.aice")).toBe("components/Card.tsx");
      expect(getTargetOutputPath("backend/main.py.aice")).toBe("backend/main.py");
    });
  });

  describe("Canonical Standard Library (CSL) Rewriter & Lowering", () => {
    it("lowers property accesses (e.g. .len)", () => {
      const pyLen = lowerPropertyAccess("name", "len", "python");
      expect(pyLen.isLowered).toBe(true);
      expect(pyLen.code).toBe("len(name)");

      const tsLen = lowerPropertyAccess("name", "len", "typescript");
      expect(tsLen.isLowered).toBe(true);
      expect(tsLen.code).toBe("name.length");
    });

    it("lowers string methods for Python and TypeScript", () => {
      expect(lowerMethodCall("s", "slice", ["0", "10"], "python").code).toBe("s[0:10]");
      expect(lowerMethodCall("s", "slice", ["0", "10"], "typescript").code).toBe("s.slice(0, 10)");

      expect(lowerMethodCall("s", "concat", ["suffix"], "python").code).toBe("s + suffix");
      expect(lowerMethodCall("s", "concat", ["suffix"], "typescript").code).toBe("s + suffix");

      expect(lowerMethodCall("s", "toInt", [], "python").code).toBe("int(s)");
      expect(lowerMethodCall("s", "toInt", [], "typescript").code).toBe("Number.parseInt(s, 10)");
    });

    it("lowers algebraic constructors (Ok, Err, Some)", () => {
      expect(lowerConstructor("Ok", ["42"], "typescript").code).toBe("{ ok: true, value: 42 }");
      expect(lowerConstructor("Err", ['"Bad"'], "typescript").code).toBe(
        '{ ok: false, error: "Bad" }',
      );
      expect(lowerConstructor("Some", ["val"], "typescript").code).toBe("val");

      expect(lowerConstructor("Ok", ["42"], "python").code).toBe('{"ok": True, "value": 42}');
      expect(lowerConstructor("Err", ['"Bad"'], "python").code).toBe(
        '{"ok": False, "error": "Bad"}',
      );
    });
  });

  describe("TypeScript Emitter", () => {
    it("emits interfaces and functions with types", () => {
      const src = `type User:
  id: str
  score: int

fn getScore(u: User) -> int:
  ret u.score`;

      const mod = parse(src, "user.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export interface User {");
      expect(out).toContain("id: string;");
      expect(out).toContain("score: number;");
      expect(out).toContain("export function getScore(u: User): number {");
      expect(out).toContain("return u.score;");
    });

    it("emits control flow and pattern matching in TypeScript", () => {
      const src = `fn categorize(score: int) -> str:
  if score > 100:
    ret "high"
  elif score > 50:
    ret "mid"
  else:
    ret "low"`;

      const mod = parse(src, "flow.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("if ((score > 100)) {");
      expect(out).toContain("} else if ((score > 50)) {");
      expect(out).toContain("} else {");
    });

    it("emits algebraic data types (enums)", () => {
      const src = `enum Shape:
  Circle(float)
  Square(float)
  Point`;

      const mod = parse(src, "shape.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export type Shape =");
      expect(out).toContain('{ kind: "Circle"; item0: number }');
      expect(out).toContain('{ kind: "Point" }');
    });

    it("emits object property shorthand in TypeScript records", () => {
      const src = `fn createPoint(x: int, y: int) -> any:
  let z = 10
  ret { x, y, extra: z }`;

      const mod = parse(src, "point.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("return { x, y, extra: z };");
    });

    it("lowers positional struct constructors and emits constructor factory in TypeScript", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn create(amt: int, cur: str) -> Money:
  ret Money(amt, cur)`;

      const mod = parse(src, "money.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export interface Money {");
      expect(out).toContain(
        "export function Money(amountInCents: number, currencyCode: string): Money {",
      );
      expect(out).toContain("return { amountInCents, currencyCode };");
      expect(out).toContain("return { amountInCents: amt, currencyCode: cur };");
    });

    it("emits single-expression functions in TypeScript", () => {
      const src = `fn add(a: int, b: int) -> int = a + b`;
      const mod = parse(src, "math.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export function add(a: number, b: number): number {");
      expect(out).toContain("return (a + b);");
    });

    it("Step 8: emits binary power, bitwise, and shift operators in TypeScript", () => {
      const src = `fn compute(a: int, b: int) -> int:
  let p = a ** b
  let andVal = a & b
  let orVal = a | b
  let xorVal = a ^ b
  let shlVal = a << b
  let shrVal = a >> b
  let ushrVal = a >>> b
  ret p`;
      const mod = parse(src, "compute.ts.aice");
      const out = emitTarget(mod, "typescript");
      expect(out).toContain("(a ** b)");
      expect(out).toContain("(a & b)");
      expect(out).toContain("(a | b)");
      expect(out).toContain("(a ^ b)");
      expect(out).toContain("(a << b)");
      expect(out).toContain("(a >> b)");
      expect(out).toContain("(a >>> b)");
    });

    it("expands struct spreads to explicit fields in TypeScript", () => {
      const src = `type User:
  id: str
  name: str
  age: int

fn updateAge(u: User, newAge: int) -> User:
  ret { ...u, age: newAge }`;

      const mod = parse(src, "user.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("return { id: u.id, name: u.name, age: newAge };");
    });

    it("emits native object spread when target type is unconstrained in TypeScript", () => {
      const src = `fn merge(base: any, extra: int) -> any:
  ret { ...base, count: extra }`;

      const mod = parse(src, "merge.ts.aice");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("return { ...base, count: extra };");
    });
  });

  describe("React TSX Emitter", () => {
    it("emits JSX layout components with attributes and className", () => {
      const src = `component AlertBanner(message: str):
  div(class: "banner", role: "alert"):
    span: "Warning"
    p: message`;

      const mod = parse(src, "banner.tsx.aice");
      const out = emitTarget(mod, "tsx");

      expect(out).toContain("export interface AlertBannerProps {");
      expect(out).toContain("message: string;");
      expect(out).toContain("export function AlertBanner({ message }: AlertBannerProps) {");
      expect(out).toContain('<div className="banner" role="alert">');
      expect(out).toContain("<span>Warning</span>");
      expect(out).toContain("<p>{message}</p>");
      expect(out).toContain("</div>");
    });
  });

  describe("Python Emitter", () => {
    it("emits TypedDict and def functions with Python idioms", () => {
      const src = `type Session:
  token: str
  expires: int

fn isExpired(s: Session, now: int) -> bool:
  ret s.expires < now`;

      const mod = parse(src, "session.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain("from typing import Any, Optional, Union, TypedDict");
      expect(out).toContain("class Session(TypedDict):");
      expect(out).toContain("token: str");
      expect(out).toContain("expires: int");
      expect(out).toContain("def isExpired(s: Session, now: int) -> bool:");
      expect(out).toContain("return (s.expires < now)");
    });

    it("emits match / case statements in Python 3.12+", () => {
      const src = `fn describe(n: int) -> str:
  match n:
    case 1 => "one"
    case 2 => "two"
    case _ => "other"`;

      const mod = parse(src, "match.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain("match n:");
      expect(out).toContain("case 1:");
      expect(out).toContain('return "one"');
      expect(out).toContain("case _:");
      expect(out).toContain('return "other"');
    });

    it("emits dictionary from record property shorthand in Python", () => {
      const src = `fn createPoint(x: int, y: int) -> any:
  let z = 10
  ret { x, y, extra: z }`;

      const mod = parse(src, "point.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain('return {"x": x, "y": y, "extra": z}');
    });

    it("lowers positional struct constructors to dictionary literals in Python", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn create(amt: int, cur: str) -> Money:
  ret Money(amt, cur)`;

      const mod = parse(src, "money.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain("class Money(TypedDict):");
      expect(out).toContain('return {"amountInCents": amt, "currencyCode": cur}');
    });

    it("Step 8: emits binary power, bitwise, and shift operators in Python with >>> mapped", () => {
      const src = `fn compute(a: int, b: int) -> int:
  let p = a ** b
  let andVal = a & b
  let orVal = a | b
  let xorVal = a ^ b
  let shlVal = a << b
  let shrVal = a >> b
  let ushrVal = a >>> b
  ret p`;
      const mod = parse(src, "compute.py.aice");
      const out = emitTarget(mod, "python");
      expect(out).toContain("(a ** b)");
      expect(out).toContain("(a & b)");
      expect(out).toContain("(a | b)");
      expect(out).toContain("(a ^ b)");
      expect(out).toContain("(a << b)");
      expect(out).toContain("(a >> b)");
      expect(out).toContain("((a % 0x100000000) >> b)");
    });

    it("emits single-expression functions in Python", () => {
      const src = `fn add(a: int, b: int) -> int = a + b`;
      const mod = parse(src, "math.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain("def add(a: int, b: int) -> int:");
      expect(out).toContain("return (a + b)");
    });

    it("expands struct spreads to explicit fields in Python", () => {
      const src = `type User:
  id: str
  name: str
  age: int

fn updateAge(u: User, newAge: int) -> User:
  ret { ...u, age: newAge }`;

      const mod = parse(src, "user.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain('return {"id": u.id, "name": u.name, "age": newAge}');
    });

    it("emits kwargs spread when target type is unconstrained in Python", () => {
      const src = `fn merge(base: any, extra: int) -> any:
  ret { ...base, count: extra }`;

      const mod = parse(src, "merge.py.aice");
      const out = emitTarget(mod, "python");

      expect(out).toContain('return {**base, "count": extra}');
    });
  });

  describe("HTML5 Emitter", () => {
    it("emits DOCTYPE and void elements without closing tags", () => {
      const src = `component Page():
  html(lang: "en"):
    head:
      meta(charset: "utf-8")
      title: "Test Page"
    body:
      h1: "Hello World"`;

      const mod = parse(src, "page.html.aice");
      const out = emitTarget(mod, "html");

      expect(out).toContain("<!DOCTYPE html>");
      expect(out).toContain('<html lang="en">');
      expect(out).toContain('<meta charset="utf-8">');
      expect(out).toContain("<title>Test Page</title>");
      expect(out).toContain("<h1>Hello World</h1>");
      expect(out).not.toContain("</meta>");
    });
  });

  describe("CSS3 Emitter", () => {
    it("emits tag and class rules with kebab-case conversions", () => {
      const src = `style body:
  margin: "0"
  background: "#000"

style primary_button:
  border_radius: "4px"
  color: "#fff"`;

      const mod = parse(src, "theme.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toContain("body {");
      expect(out).toContain("margin: 0;");
      expect(out).toContain(".primary-button {");
      expect(out).toContain("border-radius: 4px;");
      expect(out).toContain("color: #fff;");
    });

    it("emits unquoted CSS rules, colors, units, and custom variables cleanly", () => {
      const src = `style body:
  margin: 0
  padding: 0
  background: #0f172a
  color: #f8fafc

style card_container:
  padding: 1.5rem
  border_radius: 0.5rem
  border_bottom: 1px solid #334155
  box_shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
  --custom-accent: #3b82f6`;

      const mod = parse(src, "theme.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toBe(`body {
  margin: 0;
  padding: 0;
  background: #0f172a;
  color: #f8fafc;
}

.card-container {
  padding: 1.5rem;
  border-radius: 0.5rem;
  border-bottom: 1px solid #334155;
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1);
  --custom-accent: #3b82f6;
}
`);
    });

    it("emits token namespace declarations into CSS custom properties", () => {
      const src = `tokens color.slate in root_variables:
  950: #020617, 900: #0f172a
tokens spacing in root_variables: [0, 4, 8]px`;

      const mod = parse(src, "tokens.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toContain(".root-variables {");
      expect(out).toContain("--color-slate-950: #020617;");
      expect(out).toContain("--color-slate-900: #0f172a;");
      expect(out).toContain("--spacing-0: 0px;");
      expect(out).toContain("--spacing-4: 4px;");
      expect(out).toContain("--spacing-8: 8px;");
    });

    it("expands hyper-dense CSS property aliases into standard CSS properties", () => {
      const src = `style .card: bg: #fff; rad: 8px; p: 16px; disp: flex
style .hero: sh: 0 4px 6px #000; w: 100%; h: 100vh; fz: 1.5rem; fw: 700; c: #f8fafc; z: 10; cur: pointer; op: 0.9; trans: all 0.2s; anim: pulse 2s infinite; bb: 1px solid #333; fld: row; jc: space-between; ai: center; gap: 1rem`;

      const mod = parse(src, "dense.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toContain(`.card {
  background-color: #fff;
  border-radius: 8px;
  padding: 16px;
  display: flex;
}`);

      expect(out).toContain("box-shadow: 0 4px 6px #000;");
      expect(out).toContain("width: 100%;");
      expect(out).toContain("height: 100vh;");
      expect(out).toContain("font-size: 1.5rem;");
      expect(out).toContain("font-weight: 700;");
      expect(out).toContain("color: #f8fafc;");
      expect(out).toContain("z-index: 10;");
      expect(out).toContain("cursor: pointer;");
      expect(out).toContain("opacity: 0.9;");
      expect(out).toContain("transition: all 0.2s;");
      expect(out).toContain("animation: pulse 2s infinite;");
      expect(out).toContain("border-bottom: 1px solid #333;");
      expect(out).toContain("flex-direction: row;");
      expect(out).toContain("justify-content: space-between;");
      expect(out).toContain("align-items: center;");
      expect(out).toContain("gap: 1rem;");
    });

    it("expands $token macros into standard CSS custom variables (Step 15)", () => {
      const src = `style app: bg: $slate-950; c: $slate-100; sh: $shadow-sm; f: $font-sans; rad: $radius-md; trans: $transition-fast; z: $z-nav
style btn: bg: $indigo-500; c: white; b: 1px solid $indigo-400; sh: $shadow-md`;

      const mod = parse(src, "tokens.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toContain("background-color: var(--color-slate-950);");
      expect(out).toContain("color: var(--color-slate-100);");
      expect(out).toContain("box-shadow: var(--shadow-sm);");
      expect(out).toContain("font-family: var(--font-sans);");
      expect(out).toContain("border-radius: var(--radius-md);");
      expect(out).toContain("transition: var(--transition-fast);");
      expect(out).toContain("z-index: var(--z-nav);");
      expect(out).toContain("background-color: var(--color-indigo-500);");
      expect(out).toContain("border: 1px solid var(--color-indigo-400);");
      expect(out).toContain("box-shadow: var(--shadow-md);");
    });

    it("Step 23: emits token unit deduplication and layout macros (fl-row, fl-col, fl-center)", () => {
      const src = `tokens spacing[rem]: 1: 0.25, 2: 0.5
style box: fl-row; gap: 1rem
style stack: fl-col; gap: 0.5rem
style center_box: fl-center; p: 2rem`;

      const mod = parse(src, "test.css.aice");
      const out = emitTarget(mod, "css");

      expect(out).toContain(`:root {
  --spacing-1: 0.25rem;
  --spacing-2: 0.5rem;
}`);

      expect(out).toContain(`.box {
  display: flex;
  flex-direction: row;
  gap: 1rem;
}`);

      expect(out).toContain(`.stack {
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
}`);

      expect(out).toContain(`.center-box {
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 2rem;
}`);
    });
  });

  describe("HTML & TSX Emmet Layout Emission", () => {
    it("emits Emmet selector tags with class and id in HTML5", () => {
      const src = `component Page():
  header.top-navbar#main-header:
    .navbar-brand:
      span.brand-icon: "⚡"`;

      const mod = parse(src, "page.html.aice");
      const out = emitTarget(mod, "html");

      expect(out).toContain('<header class="top-navbar" id="main-header">');
      expect(out).toContain('<div class="navbar-brand">');
      expect(out).toContain('<span class="brand-icon">⚡</span>');
    });

    it("emits Emmet selector tags with className and id in TSX", () => {
      const src = `component Card(title: str):
  .card-container#featured-card:
    h2.card-title: title`;

      const mod = parse(src, "Card.tsx.aice");
      const out = emitTarget(mod, "tsx");

      expect(out).toContain('<div className="card-container" id="featured-card">');
      expect(out).toContain('<h2 className="card-title">{title}</h2>');
    });

    it("Step 18: emits contextual tags in HTML5 and TSX (ul -> li, table -> tr -> td, phrasing -> span, _ -> span)", () => {
      const src = `component Layout():
  ul.nav-menu:
    .nav-item.active:
      _.icon: "📊"
  button.action-btn:
    .label: "Run"`;

      const mod = parse(src, "layout.html.aice");
      const htmlOut = emitTarget(mod, "html");
      expect(htmlOut).toContain('<ul class="nav-menu">');
      expect(htmlOut).toContain('<li class="nav-item active">');
      expect(htmlOut).toContain('<span class="icon">📊</span>');
      expect(htmlOut).toContain('<button class="action-btn">');
      expect(htmlOut).toContain('<span class="label">Run</span>');

      const tsxOut = emitTarget(mod, "tsx");
      expect(tsxOut).toContain('<ul className="nav-menu">');
      expect(tsxOut).toContain('<li className="nav-item active">');
      expect(tsxOut).toContain('<span className="icon">📊</span>');
    });
  });

  describe("Step 10: Automatic Block-Body Trailing Return Inference", () => {
    it("emits return for trailing block expressions in TypeScript and Python", () => {
      const src = `fn add(a: int, b: int) -> int:
  let sum = a + b
  sum`;

      const mod = parse(src, "math.ts.aice");
      const tsOut = emitTarget(mod, "typescript");
      const pyOut = emitTarget(mod, "python");

      expect(tsOut).toContain("return sum;");
      expect(pyOut).toContain("return sum");
    });

    it("emits return for conditional branches in TypeScript and Python", () => {
      const src = `fn abs(x: int) -> int:
  if x < 0:
    -x
  else:
    x`;

      const mod = parse(src, "math.ts.aice");
      const tsOut = emitTarget(mod, "typescript");
      const pyOut = emitTarget(mod, "python");

      expect(tsOut).toContain("return -(x);");
      expect(tsOut).toContain("return x;");
      expect(pyOut).toContain("return (-x)");
      expect(pyOut).toContain("return x");
    });

    it("does not emit return for void functions", () => {
      const src = `fn logItem(x: str) -> void:
  print(x)`;

      const mod = parse(src, "log.ts.aice");
      const tsOut = emitTarget(mod, "typescript");
      const pyOut = emitTarget(mod, "python");

      expect(tsOut).not.toContain("return print");
      expect(tsOut).toContain("print(x);");
      expect(pyOut).not.toContain("return print");
      expect(pyOut).toContain("print(x)");
    });
  });

  describe("Step 3: Compact Structs & Sigil Field Declarations", () => {
    it("emits TypeScript interface and factory with optional fields and defaults", () => {
      const src = `type User: id:!s, name:!s, age:!i = 0, active:!b = true`;
      const mod = parse(src, "user.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("export interface User {");
      expect(tsOut).toContain("id: string;");
      expect(tsOut).toContain("name: string;");
      expect(tsOut).toContain("age?: number;");
      expect(tsOut).toContain("active?: boolean;");
      expect(tsOut).toContain(
        "export function User(id: string, name: string, age: number = 0, active: boolean = true): User {",
      );
      expect(tsOut).toContain("return { id, name, age, active };");
    });

    it("emits Python TypedDict with default values from single-line struct", () => {
      const src = `type User: id:!s, name:!s, age:!i = 0`;
      const mod = parse(src, "user.py.aice");
      const pyOut = emitTarget(mod, "python");

      expect(pyOut).toContain("class User(TypedDict):");
      expect(pyOut).toContain("id: str");
      expect(pyOut).toContain("name: str");
      expect(pyOut).toContain("age: int = 0");
    });
  });

  describe("Step 4: Expression-Bodied Functions & Universal Implicit Returns", () => {
    it("emits single-line expression-bodied functions in all languages", () => {
      const src = `fn add(a: int, b: int) -> int = a + b`;
      const mod = parse(src, "calc.aice");

      const tsOut = emitTarget(mod, "typescript");
      const pyOut = emitTarget(mod, "python");
      const rsOut = emitTarget(mod, "rust");
      const goOut = emitTarget(mod, "go");

      expect(tsOut).toContain("return (a + b);");
      expect(pyOut).toContain("return (a + b)");
      expect(rsOut).toContain("(a + b)");
      expect(goOut).toContain("return (a + b)");
    });

    it("emits implicit returns in Rust if/else and Go if/else branches", () => {
      const src = `fn abs(x: int) -> int:
  if x < 0:
    -x
  else:
    x`;
      const mod = parse(src, "calc.aice");

      const rsOut = emitTarget(mod, "rust");
      const goOut = emitTarget(mod, "go");

      expect(rsOut).toContain("-x");
      expect(rsOut).toContain("x");
      expect(goOut).toContain("return -x");
      expect(goOut).toContain("return x");
    });
  });

  describe("Step 16: Primary Class Constructors & Inline Parameter Properties", () => {
    it("emits TypeScript constructor parameter properties from primaryConstructor", () => {
      const src = `class Point(pub x:!i, pub y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("class Point {");
      expect(tsOut).toContain("constructor(public x: number, public y: number = 0) {}");
      expect(tsOut).toContain("distance(): number {");
    });

    it("emits Python __init__ with assignments from primaryConstructor", () => {
      const src = `class Point(x:!i, y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.py.aice");
      const pyOut = emitTarget(mod, "python");

      expect(pyOut).toContain("class Point:");
      expect(pyOut).toContain("def __init__(self, x: int, y: int = 0):");
      expect(pyOut).toContain("self.x = x");
      expect(pyOut).toContain("self.y = y");
    });

    it("emits C++ constructor initializer list and member variables from primaryConstructor", () => {
      const src = `class Point(x:!i, y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.cpp.aice");
      const cppOut = emitTarget(mod, "cpp");

      expect(cppOut).toContain("class Point {");
      expect(cppOut).toContain("Point(int x, int y = 0) : x(x), y(y) {}");
      expect(cppOut).toContain("int x;");
      expect(cppOut).toContain("int y;");
    });
  });

  describe("Step 19: Implicit this. Scope Resolution & Compound Operators", () => {
    it("emits implicit this. for class properties in TypeScript methods", () => {
      const src = `class Snake:
  Hp: int = 100
  MaxHp: int = 100
  fn takeDamage(amount: int):
    Hp -= amount
    if Hp < 0:
      Hp = 0`;
      const mod = parse(src, "Snake.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("this.Hp -= amount;");
      expect(tsOut).toContain("if ((this.Hp < 0)) {");
      expect(tsOut).toContain("this.Hp = 0;");
    });

    it("does not prefix local variables or parameters with this.", () => {
      const src = `class Counter:
  count: int = 0
  fn add(count: int):
    let step = 1
    this.count += count + step`;
      const mod = parse(src, "Counter.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("const step = 1;");
      expect(tsOut).toContain("this.count += (count + step);");
    });

    it("emits compound assignment operators across targets", () => {
      const src = `fn compute(x: int):
  x += 10
  x -= 5
  x *= 2`;
      const mod = parse(src);
      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("x += 10;");
      expect(tsOut).toContain("x -= 5;");
      expect(tsOut).toContain("x *= 2;");

      const pyOut = emitTarget(mod, "python");
      expect(pyOut).toContain("x += 10");
      expect(pyOut).toContain("x -= 5");
      expect(pyOut).toContain("x *= 2");

      const cppOut = emitTarget(mod, "cpp");
      expect(cppOut).toContain("x += 10;");
      expect(cppOut).toContain("x -= 5;");

      const rustOut = emitTarget(mod, "rust");
      expect(rustOut).toContain("x += 10;");

      const goOut = emitTarget(mod, "go");
      expect(goOut).toContain("x += 10");
    });
  });

  describe("Step 20: Dual-Case Property Compaction & Accessor Synthesizer", () => {
    it("synthesizes TypeScript getters and setters for property aliases", () => {
      const src = `class SnakeSegment:
  prop X, x: int = 0
  prop Y, y: int = 0
  prop MaxHp, maxHp: int
  readonly prop Id, id: str
  prop Shield: int = 50`;

      const mod = parse(src, "SnakeSegment.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("X: number = 0;");
      expect(tsOut).toContain("get x() { return this.X; }");
      expect(tsOut).toContain("set x(v: number) { this.X = v; }");

      expect(tsOut).toContain("Y: number = 0;");
      expect(tsOut).toContain("get y() { return this.Y; }");
      expect(tsOut).toContain("set y(v: number) { this.Y = v; }");

      expect(tsOut).toContain("MaxHp: number;");
      expect(tsOut).toContain("get maxHp() { return this.MaxHp; }");
      expect(tsOut).toContain("set maxHp(v: number) { this.MaxHp = v; }");

      expect(tsOut).toContain("readonly Id: string;");
      expect(tsOut).toContain("get id() { return this.Id; }");
      expect(tsOut).not.toContain("set id(");

      expect(tsOut).toContain("Shield: number = 50;");
    });

    it("respects explicit getter or setter overrides without duplication", () => {
      const src = `class CustomPlayer:
  prop Hp, hp: int = 100
  get hp() -> int:
    ret this.Hp * 2`;

      const mod = parse(src, "CustomPlayer.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("Hp: number = 100;");
      expect(tsOut).toContain("get hp(): number {");
      expect(tsOut).toContain("return (this.Hp * 2);");
      expect(tsOut).toContain("set hp(v: number) { this.Hp = v; }");
    });

    it("resolves implicit this. for aliases in TypeScript methods", () => {
      const src = `class Mover:
  prop X, x: int = 0
  fn move(dx: int):
    x += dx`;

      const mod = parse(src, "Mover.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("this.x += dx;");
    });

    it("synthesizes static getters and setters with class qualifier", () => {
      const src = `class Config:
  static prop Version, version: str = "1.0.0"`;

      const mod = parse(src, "Config.ts.aice");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain('static Version: string = "1.0.0";');
      expect(tsOut).toContain("static get version() { return Config.Version; }");
      expect(tsOut).toContain("static set version(v: string) { Config.Version = v; }");
    });

    it("emits idiomatic Python @property and setter for property aliases", () => {
      const src = `class Player:
  prop X, x: int = 0`;

      const mod = parse(src, "Player.py.aice");
      const pyOut = emitTarget(mod, "python");

      expect(pyOut).toContain("self.X: int = 0");
      expect(pyOut).toContain("@property");
      expect(pyOut).toContain("def x(self):");
      expect(pyOut).toContain("return self.X");
      expect(pyOut).toContain("@x.setter");
      expect(pyOut).toContain("def x(self, v):");
      expect(pyOut).toContain("self.X = v");
    });

    it("typechecks class properties and aliases soundly", () => {
      const src = `class Vector:
  prop X, x: int = 0
  fn getCoords() -> int:
    ret this.x + this.X`;

      const mod = parse(src, "Vector.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });
  });

  describe("Step 21: Keywordless Variable & Mutable Declaration Emission", () => {
    it("emits TypeScript const and let for keywordless local bindings", () => {
      const src = `fn process():
  x := 42
  y ::= "mutable"
  z: int := 100
  w: str ::= "mut_typed"`;

      const mod = parse(src, "process.ts.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("const x = 42;");
      expect(tsOut).toContain('let y = "mutable";');
      expect(tsOut).toContain("const z: number = 100;");
      expect(tsOut).toContain('let w: string = "mut_typed";');
    });

    it("emits TypeScript top-level declarations with export and const/let", () => {
      const src = `x := 10
pub y ::= "mutable"
z: int := 100
pub w: str ::= "mut_typed"`;

      const mod = parse(src, "globals.ts.aice");
      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("const x = 10;");
      expect(tsOut).toContain('export let y = "mutable";');
      expect(tsOut).toContain("const z: number = 100;");
      expect(tsOut).toContain('export let w: string = "mut_typed";');
    });

    it("emits Python, C++, Rust, and Go for keywordless declarations", () => {
      const src = `fn compute() -> int:
  x := 42
  y ::= 10
  ret x + y`;

      const mod = parse(src, "compute.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const pyOut = emitTarget(mod, "python");
      expect(pyOut).toContain("x = 42");
      expect(pyOut).toContain("y = 10");

      const cppOut = emitTarget(mod, "cpp");
      expect(cppOut).toContain("const auto x = 42;");
      expect(cppOut).toContain("auto y = 10;");

      const rsOut = emitTarget(mod, "rust");
      expect(rsOut).toContain("let x = 42;");
      expect(rsOut).toContain("let mut y = 10;");

      const goOut = emitTarget(mod, "go");
      expect(goOut).toContain("x := 42");
      expect(goOut).toContain("y := 10");
    });
  });

  describe("Step 22: Vector & Arithmetic Compression DSL", () => {
    it("emits TypeScript math builtins min, hypot, and clamp", () => {
      const src = `fn calc(a: float, b: float, dx: float, dy: float, x: float) -> float:
  m := min(a, b)
  h := hypot(dx, dy)
  c := clamp(x, 0, 100)
  ret m + h + c`;

      const mod = parse(src, "math.ts.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("const m = Math.min(a, b);");
      expect(tsOut).toContain("const h = Math.hypot(dx, dy);");
      expect(tsOut).toContain("const c = Math.max(0, Math.min(100, x));");
    });

    it("emits TypeScript vector destructuring [x, y] := [1, 2] and [x, y] ::= [1, 2]", () => {
      const src = `fn vectors() -> void:
  [x, y] := [1, 2]
  [a, b] ::= [10, 20]
  [a, b] += [1, 1]
  [a, b] = [100, 200]`;

      const mod = parse(src, "vectors.ts.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("const [x, y] = [1, 2];");
      expect(tsOut).toContain("let [a, b] = [10, 20];");
      expect(tsOut).toContain("a += 1;");
      expect(tsOut).toContain("b += 1;");
      expect(tsOut).toContain("[a, b] = [100, 200];");
    });

    it("emits Python, C++, Rust, and Go for math builtins and destructuring", () => {
      const src = `fn run(x: float, y: float) -> float:
  [px, py] := [x, y]
  c := clamp(px, 0.0, 1.0)
  h := hypot(px, py)
  ret c + h`;

      const mod = parse(src, "math.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();

      const pyOut = emitTarget(mod, "python");
      expect(pyOut).toContain("px, py = [x, y]");
      expect(pyOut).toContain("max(0, min(1, px))");
      expect(pyOut).toContain("math.hypot(px, py)");

      const cppOut = emitTarget(mod, "cpp");
      expect(cppOut).toContain("const auto [px, py] = { x, y };");
      expect(cppOut).toContain("std::clamp(px, 0.0f, 1.0f)");
      expect(cppOut).toContain("std::hypot(px, py)");

      const rsOut = emitTarget(mod, "rust");
      expect(rsOut).toContain("let (px, py) = vec![x, y];");
      expect(rsOut).toContain("(px).clamp(0.0, 1.0)");
      expect(rsOut).toContain("(px).hypot(py)");

      const goOut = emitTarget(mod, "go");
      expect(goOut).toContain("px, py := []any{x, y}");
      expect(goOut).toContain("math.Max(0.0, math.Min(1.0, px))");
      expect(goOut).toContain("math.Hypot(px, py)");
    });

    it("emits tuple types in TypeScript, Python, Rust, and C++", () => {
      const src = `type Entry:
  pair: [str, int]
  triple: [float, float, float]
  nested: [int, [str, bool]]

fn swap(p: [str, int]) -> [int, str]:
  ret [p[1], p[0]]`;

      const mod = parse(src, "tuples.ts.aice");
      const tsOut = emitTarget(mod, "typescript");
      expect(tsOut).toContain("pair: [string, number];");
      expect(tsOut).toContain("triple: [number, number, number];");
      expect(tsOut).toContain("nested: [number, [string, boolean]];");
      expect(tsOut).toContain("export function swap(p: [string, number]): [number, string] {");

      const pyOut = emitTarget(mod, "python");
      expect(pyOut).toContain("tuple[str, int]");
      expect(pyOut).toContain("tuple[float, float, float]");

      const rsOut = emitTarget(mod, "rust");
      expect(rsOut).toContain("(String, i64)");

      const cppOut = emitTarget(mod, "cpp");
      expect(cppOut).toContain("std::tuple<std::string, int>");
    });

    it("emits call-site argument spreads and collection spreads in TypeScript and Python", () => {
      const src = `fn add(a: int, b: int) -> int:
  ret a + b

fn run(x: int, y: int, extra: [int]):
  s := add(x, ...extra)
  m := Math.max(...extra)
  combined := [...extra, 99]`;

      const mod = parse(src, "spread.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("add(x, ...extra)");
      expect(ts).toContain("Math.max(...extra)");
      expect(ts).toContain("[...extra, 99]");

      const py = emitTarget(mod, "python");
      expect(py).toContain("add(x, *extra)");
      expect(py).toContain("Math.max(*extra)");
      expect(py).toContain("[*extra, 99]");
    });
    it("emits types with negative numeric literals in TypeScript", () => {
      const src = `type Direction = 1 | -1
type Ternary = -1 | 0 | 1

pub fn step(dir: 1 | -1) -> 1 | -1:
  ret dir

val initialDir: 1 | -1 = -1`;

      const mod = parse(src, "direction.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("export type Direction = 1 | -1;");
      expect(ts).toContain("export type Ternary = -1 | 0 | 1;");
      expect(ts).toContain("export function step(dir: 1 | -1): 1 | -1");
      expect(ts).toContain("const initialDir: 1 | -1 = -(1);");
    });
    it("emits boolean literal types in TypeScript (: true, : false, true | false)", () => {
      const src = `type Flag = true | false
type SuccessResponse = { success: true, active: false }

pub fn isReady() -> true:
  ret true

pub fn isOff() -> false:
  ret false

val enabled: true = true
val disabled: false = false`;

      const mod = parse(src, "bool_literals.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("export type Flag = true | false;");
      expect(ts).toContain("export type SuccessResponse = { success: true; active: false; };");
      expect(ts).toContain("export function isReady(): true");
      expect(ts).toContain("export function isOff(): false");
      expect(ts).toContain("const enabled: true = true;");
      expect(ts).toContain("const disabled: false = false;");
    });

    it("emits contextual keywords as identifiers in TypeScript and Python", () => {
      const src = `from "ui/theme" import style, tokens, match, type
import { style as customStyle } from "styles"

pub fn style(tokens: int, match: bool, type: str, val: float) -> str:
  let state = "active"
  if match:
    ret type
  ret state

pub val themeConfig = { style: "dark", tokens: 10, match: true }`;

      const mod = parse(src, "contextual.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('import { style, tokens, match, type } from "ui/theme";');
      expect(ts).toContain('import { style as customStyle } from "styles";');
      expect(ts).toContain(
        "export function style(tokens: number, match: boolean, type: string, val: number): string",
      );
      expect(ts).toContain('const state = "active";');
      expect(ts).toContain('const themeConfig = { style: "dark", tokens: 10, match: true };');

      const pyMod = parse(src, "contextual.py.aice");
      const py = emitTarget(pyMod, "python");
      expect(py).toContain("from ui.theme import style, tokens, match, type");
      expect(py).toContain("from styles import style as customStyle");
      expect(py).toContain("def style(tokens: int, match: bool, type: str, val: float) -> str:");
      expect(py).toContain('state = "active"');
    });
  });

  describe("Step 7: Closure Parameter Pattern Destructuring & Elisions", () => {
    it("emits closure and function parameter pattern destructuring in TypeScript", () => {
      const src = `pub fn sumPair([a, b]: [int, int]) -> int:
  ret a + b

pub fn handleState({ effect, target }: State) -> void:
  print(effect)

pub fn test():
  let f = fn([a, b]: [int, int]) -> int = a + b
  let g = fn({ x, y }: Point) -> int = x + y
  let unannotated = fn([a, b]) = a + b`;

      const mod = parse(src, "closure_destruct.ts.aice");
      const ts = emitTarget(mod, "typescript");

      expect(ts).toContain("export function sumPair([a, b]: [number, number]): number");
      expect(ts).toContain("export function handleState({ effect, target }: State): void");
      expect(ts).toContain("const f = ([a, b]: [number, number]): number => (a + b);");
      expect(ts).toContain("const g = ({ x, y }: Point): number => (x + y);");
      expect(ts).toContain("const unannotated = ([a, b]) => (a + b);");
    });

    it("emits for-in loops and let bindings with elisions in TypeScript", () => {
      const src = `pub fn test(pairs: [[int, int]], triplets: [[int, int, int]]):
  for [, x] in pairs:
    print(x)
  for [a, , b] in triplets:
    print(a + b)
  let [, y] = pairs[0]
  let [first, , third] = triplets[0]`;

      const mod = parse(src, "elisions.ts.aice");
      const ts = emitTarget(mod, "typescript");

      expect(ts).toContain("for (const [, x] of pairs) {");
      expect(ts).toContain("for (const [a, , b] of triplets) {");
      expect(ts).toContain("const [, y] = pairs[0];");
      expect(ts).toContain("const [first, , third] = triplets[0];");
    });

    it("emits for-in loops and let bindings with elisions using _ placeholders in Python", () => {
      const src = `pub fn test(pairs: [[int, int]], triplets: [[int, int, int]]):
  for [, x] in pairs:
    print(x)
  for [a, , b] in triplets:
    print(a + b)
  let [, y] = pairs[0]
  let [first, , third] = triplets[0]`;

      const mod = parse(src, "elisions.py.aice");
      const py = emitTarget(mod, "python");

      expect(py).toContain("for _, x in pairs:");
      expect(py).toContain("for a, _, b in triplets:");
      expect(py).toContain("_, y = pairs[0]");
      expect(py).toContain("first, _, third = triplets[0]");
    });

    it("emits function and closure parameter destructuring and elisions in Python", () => {
      const src = `pub fn sumPair([a, b]: [int, int]) -> int:
  ret a + b

pub fn skipFirst([, b]: [int, int]) -> int:
  ret b

pub fn handleState({ effect, target }: State) -> void:
  print(effect)

pub fn test():
  let f = fn([a, b]: [int, int]) -> int = a + b
  let g = fn([, b]: [int, int]) -> int = b
  let h = fn({ effect }) = effect`;

      const mod = parse(src, "closure_destruct.py.aice");
      const py = emitTarget(mod, "python");

      expect(py).toContain("def sumPair(_arg0: tuple[int, int]) -> int:");
      expect(py).toContain("    a, b = _arg0");
      expect(py).toContain("def skipFirst(_arg0: tuple[int, int]) -> int:");
      expect(py).toContain("    _, b = _arg0");
      expect(py).toContain("def handleState(_arg0: State) -> None:");
      expect(py).toContain('    effect = _arg0["effect"]');
      expect(py).toContain('    target = _arg0["target"]');
      expect(py).toContain("f = (lambda _arg: (lambda a, b: (a + b))(*_arg))");
      expect(py).toContain("g = (lambda _arg: (lambda _, b: b)(*_arg))");
      expect(py).toContain("h = (lambda _arg: (lambda effect: effect)(**_arg))");
    });
  });

  describe("Step 10: await and super Emission in TypeScript and Python", () => {
    it("emits await expressions in TypeScript and Python", () => {
      const src = `pub fn loadData(p: Promise[str]) -> str:
  let res = await p
  ret res`;

      const mod = parse(src, "await_test.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const res = await p;");

      const py = emitTarget(mod, "python");
      expect(py).toContain("res = await p");
    });

    it("emits super constructor call and super method call in TypeScript and Python", () => {
      const src = `pub class Derived extends Base:
  fn constructor(x: int):
    super(x)
  fn greet() -> str:
    ret super.greet()`;

      const mod = parse(src, "super_test.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("super(x);");
      expect(ts).toContain("return super.greet();");

      const py = emitTarget(mod, "python");
      expect(py).toContain("super().__init__(x)");
      expect(py).toContain("return super().greet()");
    });
  });

  describe("Step 11: String Literal Unions vs Enums Emission", () => {
    it("emits string literal union type declarations faithfully in TypeScript", () => {
      const src = `type HttpMethod = "GET" | "POST" | "PUT" | "DELETE"`;
      const mod = parse(src, "method.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('export type HttpMethod = "GET" | "POST" | "PUT" | "DELETE";');
    });

    it("emits function signatures with string literal union parameter and return types in TypeScript", () => {
      const src = `type HttpMethod = "GET" | "POST"
pub fn request(method: HttpMethod) -> HttpMethod:
  ret method`;
      const mod = parse(src, "req.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("export function request(method: HttpMethod): HttpMethod {");
    });

    it("emits inline string literal union annotations cleanly in TypeScript", () => {
      const src = `pub fn format(m: "GET" | "POST"):
  ret m`;
      const mod = parse(src, "inline.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('export function format(m: "GET" | "POST") {');
    });

    it("maps primitive types inside unions cleanly to TypeScript types", () => {
      const src = `type Id = str | int`;
      const mod = parse(src, "id.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("export type Id = string | number;");
    });
  });

  describe("Step 12: Multiline Block Closures Emission in TypeScript and Python", () => {
    it("emits multiline block closure with let binding and return in TypeScript", () => {
      const src = `pub fn test():
  let f = fn(x: int) -> int {
    let y = x * 2
    ret y
  }`;
      const mod = parse(src, "closure_ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number): number => {");
      expect(ts).toContain("const y = (x * 2);");
      expect(ts).toContain("return y;");
      expect(ts).toContain("};");
    });

    it("emits multiline block closure without return type in TypeScript", () => {
      const src = `pub fn test():
  let f = fn(x: int) {
    let y = x * 2
    ret y
  }`;
      const mod = parse(src, "closure_ts_inferred.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number) => {");
      expect(ts).toContain("const y = (x * 2);");
      expect(ts).toContain("return y;");
    });

    it("emits multiline block closure as function call argument in TypeScript", () => {
      const src = `pub fn test(arr: [int]):
  arr.forEach(fn(x: int) {
    let y = x * 2
    log(y)
  })`;
      const mod = parse(src, "closure_arg_ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("(x: number) => {");
      expect(ts).toContain("const y = (x * 2);");
      expect(ts).toContain("log(y);");
    });

    it("emits multiline block closure in Python as inner def function", () => {
      const src = `pub fn test():
  let f = fn(x: int) -> int {
    let y = x * 2
    ret y
  }
  ret f(10)`;
      const mod = parse(src, "closure_py.aice");
      const py = emitTarget(mod, "python");
      expect(py).toContain("def f(x: int) -> int:");
      expect(py).toContain("y = (x * 2)");
      expect(py).toContain("return y");
      expect(py).toContain("return f(10)");
    });

    it("emits hoisted inner def when multiline closure is in an expression in Python", () => {
      const src = `pub fn test(arr: [int]):
  arr.forEach(fn(x: int) {
    let y = x * 2
    log(y)
  })`;
      const mod = parse(src, "closure_py_hoist.aice");
      const py = emitTarget(mod, "python");
      expect(py).toContain("def _closure_");
      expect(py).toContain("y = (x * 2)");
      expect(py).toContain("log(y)");
      expect(py).toContain("arr.forEach(_closure_");
    });

    it("preserves single-expression lambda emission in Python and TypeScript", () => {
      const src = `pub fn test():
  let f = fn(x: int) = x * 2`;
      const mod = parse(src, "closure_lambda.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number) => (x * 2);");

      const py = emitTarget(mod, "python");
      expect(py).toContain("f = (lambda x: (x * 2))");
    });
  });

  describe("Step 13: Statement Visitors Emission (try/catch/finally, throw, break, continue, static blocks, barrel re-exports)", () => {
    it("emits try/catch/finally in TypeScript and Python", () => {
      const src = `pub fn test():
  try:
    log("attempt")
  catch err:
    log(err)
  finally:
    log("cleanup")
`;
      const mod = parse(src, "try_test.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("try {");
      expect(ts).toContain("} catch (err) {");
      expect(ts).toContain("} finally {");

      const py = emitTarget(mod, "python");
      expect(py).toContain("try:");
      expect(py).toContain("except Exception as err:");
      expect(py).toContain("finally:");
    });

    it("emits try/finally without catch in TypeScript and Python", () => {
      const src = `pub fn test():
  try:
    log("attempt")
  finally:
    log("done")
`;
      const mod = parse(src, "try_finally.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("try {");
      expect(ts).not.toContain("catch");
      expect(ts).toContain("} finally {");

      const py = emitTarget(mod, "python");
      expect(py).toContain("try:");
      expect(py).not.toContain("except");
      expect(py).toContain("finally:");
    });

    it("emits throw / raise in TypeScript and Python", () => {
      const src = `pub fn fail():
  throw "something went wrong"
`;
      const mod = parse(src, "throw_test.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('throw "something went wrong";');

      const py = emitTarget(mod, "python");
      expect(py).toContain('raise "something went wrong"');
    });

    it("emits break and continue in TypeScript and Python", () => {
      const src = `pub fn testLoop():
  let mut i = 0
  while i < 10:
    if i == 5:
      break
    elif i == 2:
      continue
    i = i + 1
`;
      const mod = parse(src, "loop_test.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("break;");
      expect(ts).toContain("continue;");

      const py = emitTarget(mod, "python");
      expect(py).toContain("break");
      expect(py).toContain("continue");
    });

    it("emits class static block in TypeScript and Python", () => {
      const src = `class Config:
  pub static version: int = 1
  static:
    Config.version = 2
`;
      const mod = parse(src, "static_block.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("class Config {");
      expect(ts).toContain("static {");
      expect(ts).toContain("Config.version = 2;");

      const py = emitTarget(mod, "python");
      expect(py).toContain("class Config:");
      expect(py).toContain("Config.version = 2");
    });

    it("emits barrel re-exports in TypeScript and Python", () => {
      const src = `pub from "./utils" import foo, bar
pub from "./types" import *
`;
      const mod = parse(src, "index.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('export { foo, bar } from "./utils";');
      expect(ts).toContain('export * from "./types";');

      const py = emitTarget(mod, "python");
      expect(py).toContain("from .utils import foo, bar");
      expect(py).toContain("from .types import *");
    });

    it("emits async fn in TypeScript and Python", () => {
      const src = `async fn getData(id: str) -> Promise[str]:
  ret "result"

async fn compute() -> Promise[int] = 42
`;
      const mod = parse(src, "async_fn.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("export async function getData(id: string): Promise<string> {");
      expect(ts).toContain("export async function compute(): Promise<number> {");

      const py = emitTarget(mod, "python");
      expect(py).toContain("async def getData(id: str) -> Promise[str]:");
      expect(py).toContain("async def compute() -> Promise[int]:");
    });
  });

  describe("Step 16: Class Scope Builtin Function Shadowing Guard in Emitters", () => {
    it("emits Math.floor(x) and does not emit this.floor(x) when class has floor: int property", () => {
      const src = `class MathHelper:
  floor: int = 0
  fn compute(x: float) -> int:
    ret floor(x)
`;
      const mod = parse(src, "MathHelper.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("return Math.floor(x);");
      expect(ts).not.toContain("this.floor(x)");
    });

    it("emits Math builtins without this. for min, max, abs when class has matching properties", () => {
      const src = `class Calculator:
  min: int = 0
  max: int = 100
  abs: float = 1.0
  fn run(a: float, b: float) -> float:
    let m = min(a, b)
    let n = max(a, b)
    let d = abs(a)
    ret m + n + d
`;
      const mod = parse(src, "Calculator.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const m = Math.min(a, b);");
      expect(ts).toContain("const n = Math.max(a, b);");
      expect(ts).toContain("const d = Math.abs(a);");
      expect(ts).not.toContain("this.min(");
      expect(ts).not.toContain("this.max(");
      expect(ts).not.toContain("this.abs(");
    });

    it("preserves property access with this. and bare property access for class properties", () => {
      const src = `class MathHelper:
  floor: int = 42
  fn getExplicit() -> int:
    ret this.floor
  fn getImplicit() -> int:
    ret floor
`;
      const mod = parse(src, "MathHelperProp.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("return this.floor;");
      expect(ts).not.toContain("return Math.floor;");
    });

    it("emits global builtins print() and len() without this. when class has matching properties", () => {
      const src = `class Reporter:
  print: str = "logger"
  len: int = 5
  fn report(msg: str, items: [int]):
    print(msg)
    let count = len(items)
`;
      const mod = parse(src, "Reporter.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("print(msg);");
      expect(ts).toContain("const count = len(items);");
      expect(ts).not.toContain("this.print(msg)");
      expect(ts).not.toContain("this.len(items)");
    });
  });

  describe("Step 17: Parameter Optionality & Default Values Emission", () => {
    it("emits param?: type when param.isOptional is true and no default value is present", () => {
      const src = `fn display(title: str, subtitle?: str, count?: int = 1):
  ret title`;
      const mod = parse(src, "display.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("function display(title: string, subtitle?: string, count: number = 1)");
    });

    it("emits optional parameters in class primary constructors and methods", () => {
      const src = `class Client(pub endpoint: str, pub token?: str, pub timeout: int = 5000):
  fn request(path: str, headers?: str):
    ret path`;
      const mod = parse(src, "Client.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain(
        "constructor(public endpoint: string, public token?: string, public timeout: number = 5000)",
      );
      expect(ts).toContain("request(path: string, headers?: string)");
    });
  });

  describe("Step 20: CST Trivia Retention from Lexer to TypeScript Emitter", () => {
    it("retains module header comments at the top of emitted TypeScript", () => {
      const src = `# SPDX-License-Identifier: Apache-2.0
# Core math algorithms

import "math"

fn square(x: int) -> int = x * x
`;
      const { ast, trivia } = parseWithTrivia(src, "math.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("// SPDX-License-Identifier: Apache-2.0");
      expect(ts).toContain("// Core math algorithms");
      expect(ts.indexOf("// SPDX-License-Identifier: Apache-2.0")).toBeLessThan(
        ts.indexOf('import "math";'),
      );
    });

    it("retains function comments on exported functions in emitted TypeScript", () => {
      const src = `# Calculates the discounted price
# Apply discount percentage
fn applyDiscount(price: float, discount: float) -> float:
  ret price * (1.0 - discount)
`;
      const { ast, trivia } = parseWithTrivia(src, "discount.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("// Calculates the discounted price");
      expect(ts).toContain("// Apply discount percentage");
      expect(ts.indexOf("// Calculates the discounted price")).toBeLessThan(
        ts.indexOf("export function applyDiscount"),
      );
    });

    it("retains class, property, and method comments in emitted TypeScript", () => {
      const src = `# Represents an HTTP client
class HttpClient:
  # Base server URL
  baseUrl: str = "http://localhost"

  # Sends GET request
  fn get(path: str) -> str:
    ret baseUrl + path
`;
      const { ast, trivia } = parseWithTrivia(src, "client.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("// Represents an HTTP client");
      expect(ts.indexOf("// Represents an HTTP client")).toBeLessThan(
        ts.indexOf("class HttpClient"),
      );
      expect(ts).toContain("// Base server URL");
      expect(ts).toContain("// Sends GET request");
    });

    it("retains type and field comments in emitted TypeScript", () => {
      const src = `# Configuration settings
type Config:
  # Host address
  host: str
  # Port number
  port: int
`;
      const { ast, trivia } = parseWithTrivia(src, "config.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("// Configuration settings");
      expect(ts).toContain("// Host address");
      expect(ts).toContain("// Port number");
    });

    it("retains const and var comments in emitted TypeScript", () => {
      const src = `# Server timeout in ms
const TIMEOUT = 5000

# Current active reconnects
val reconnects = 0
`;
      const { ast, trivia } = parseWithTrivia(src, "server.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("// Server timeout in ms");
      expect(ts).toContain("const TIMEOUT = 5000;");
      expect(ts).toContain("// Current active reconnects");
      expect(ts).toContain("const reconnects = 0;");
    });

    it("retains JSDoc comments /** ... */ in emitted TypeScript", () => {
      const src = `/**
 * Dispatches an event to listeners
 */
fn dispatch(name: str) -> void:
  nil
`;
      const { ast, trivia } = parseWithTrivia(src, "dispatch.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("/**\n * Dispatches an event to listeners\n */");
      expect(ts.indexOf("Dispatches an event")).toBeLessThan(
        ts.indexOf("export function dispatch"),
      );
    });

    it("retains trailing inline comments in emitted TypeScript", () => {
      const src = `const PI = 3.14159 # mathematical constant`;
      const { ast, trivia } = parseWithTrivia(src, "pi.ts.aice");
      const ts = emitTypeScript(ast, { trivia });
      expect(ts).toContain("const PI = 3.14159; // mathematical constant");
    });
  });

  describe("Configurable Pure Interface Emission (Step 21)", () => {
    it("preserves backward compatibility: emits factory functions when pureInterfaces is omitted or false", () => {
      const src = `type User:
  id: int
  name: str
`;
      const mod = parse(src, "user.ts.aice");

      // Default (omitted)
      const defaultOut = emitTarget(mod, "typescript");
      expect(defaultOut).toContain("export interface User {");
      expect(defaultOut).toContain("id: number;");
      expect(defaultOut).toContain("name: string;");
      expect(defaultOut).toContain("export function User(id: number, name: string): User {");
      expect(defaultOut).toContain("return { id, name };");

      // Explicit pureInterfaces: false
      const explicitFalseOut = emitTarget(mod, "typescript", { pureInterfaces: false });
      expect(explicitFalseOut).toContain("export interface User {");
      expect(explicitFalseOut).toContain("export function User(id: number, name: string): User {");
      expect(explicitFalseOut).toContain("return { id, name };");
    });

    it("emits pure interface without factory function when pureInterfaces is true", () => {
      const src = `type User:
  id: int
  name: str
`;
      const mod = parse(src, "user.ts.aice");
      const pureOut = emitTarget(mod, "typescript", { pureInterfaces: true });

      expect(pureOut).toContain("export interface User {");
      expect(pureOut).toContain("id: number;");
      expect(pureOut).toContain("name: string;");
      expect(pureOut).not.toContain("export function User");
      expect(pureOut).not.toContain("return { id, name };");

      // Also verify via direct emitTypeScript entrypoint
      const directOut = emitTypeScript(mod, { pureInterfaces: true });
      expect(directOut).toContain("export interface User {");
      expect(directOut).not.toContain("export function User");
    });

    it("transforms struct instantiation into object literals seamlessly under pureInterfaces: true", () => {
      const src = `type User:
  id: int
  name: str

fn makeUser(i: int, n: str) -> User:
  ret User(i, n)

fn getAdmin() -> User:
  ret User(1, "Alice")
`;
      const mod = parse(src, "user.ts.aice");
      const pureOut = emitTarget(mod, "typescript", { pureInterfaces: true });

      expect(pureOut).toContain("export interface User {");
      expect(pureOut).not.toContain("export function User(");
      expect(pureOut).toContain("return { id: i, name: n };");
      expect(pureOut).toContain('return { id: 1, name: "Alice" };');
    });

    it("verifies CLI --pure-interfaces flag in compile and compile-all commands", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-pure-intf-test-"));
      try {
        const srcFile = path.join(tempDir, "model.ts.aice");
        const src = `type Customer:
  id: int
  name: str

fn getCustomer() -> Customer:
  ret Customer(42, "Bob")
`;
        fs.writeFileSync(srcFile, src, "utf-8");

        // 1. Compile without --pure-interfaces (default)
        const defaultOutFile = path.join(tempDir, "default.ts");
        const resDefault = spawnSync("bun", [cliPath, "compile", srcFile, "-o", defaultOutFile], {
          encoding: "utf-8",
        });
        expect(resDefault.status).toBe(0);
        const defaultContent = fs.readFileSync(defaultOutFile, "utf-8");
        expect(defaultContent).toContain("export interface Customer {");
        expect(defaultContent).toContain(
          "export function Customer(id: number, name: string): Customer {",
        );

        // 2. Compile with --pure-interfaces
        const pureOutFile = path.join(tempDir, "pure.ts");
        const resPure = spawnSync(
          "bun",
          [cliPath, "compile", srcFile, "--pure-interfaces", "-o", pureOutFile],
          { encoding: "utf-8" },
        );
        expect(resPure.status).toBe(0);
        const pureContent = fs.readFileSync(pureOutFile, "utf-8");
        expect(pureContent).toContain("export interface Customer {");
        expect(pureContent).not.toContain("export function Customer(");
        expect(pureContent).toContain('return { id: 42, name: "Bob" };');

        // 3. Compile-all with --pure-interfaces
        const outDir = path.join(tempDir, "out");
        const resCompileAll = spawnSync(
          "bun",
          [cliPath, "compile-all", tempDir, "--out-dir", outDir, "--pure-interfaces"],
          { encoding: "utf-8" },
        );
        expect(resCompileAll.status).toBe(0);
        const compileAllTarget = path.join(outDir, "model.ts");
        expect(fs.existsSync(compileAllTarget)).toBe(true);
        const compileAllContent = fs.readFileSync(compileAllTarget, "utf-8");
        expect(compileAllContent).toContain("export interface Customer {");
        expect(compileAllContent).not.toContain("export function Customer(");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Step 22: Arrow Function Record Return Parenthesization", () => {
    it("emits parenthesized record literal return for expression-bodied closure returning non-empty record literal", () => {
      const src = `pub fn test():
  let f = fn() => { a: 1, b: "ok" }`;
      const mod = parse(src, "closure_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain('const f = () => ({ a: 1, b: "ok" });');
    });

    it("emits parenthesized record literal return for expression-bodied closure returning empty record literal", () => {
      const src = `pub fn test():
  let f = fn() => {}`;
      const mod = parse(src, "closure_empty_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = () => ({});");
    });

    it("emits parenthesized record literal return for expression-bodied closure with params returning record literal", () => {
      const src = `pub fn test():
  let f = fn(x: int) => { value: x }`;
      const mod = parse(src, "closure_param_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number) => ({ value: x });");
    });

    it("does not redundantly parenthesize non-record expression-bodied closures", () => {
      const src1 = `pub fn test():
  let f = fn(x: int) => x + 1`;
      const mod1 = parse(src1, "closure_non_record1.ts.aice");
      const ts1 = emitTarget(mod1, "typescript");
      expect(ts1).toContain("const f = (x: number) => (x + 1);");
      expect(ts1).not.toContain("((x + 1))");

      const src2 = `pub fn test():
  let f = fn(x: int) => x`;
      const mod2 = parse(src2, "closure_non_record2.ts.aice");
      const ts2 = emitTarget(mod2, "typescript");
      expect(ts2).toContain("const f = (x: number) => x;");
      expect(ts2).not.toContain("(x);");
    });

    it("emits parenthesized record literal with return type annotation", () => {
      const src = `type Point:
  x: int
  y: int

pub fn test():
  let f = fn(x: int) -> Point => { x: x, y: 0 }`;
      const mod = parse(src, "closure_typed_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number): Point => ({ x, y: 0 });");
    });

    it("emits parenthesized record literal return when closure is passed as function argument", () => {
      const src = `pub fn transform(items: [int]):
  ret items.map(fn(x: int) => { id: x })`;
      const mod = parse(src, "closure_arg_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("return items.map((x: number) => ({ id: x }));");
    });

    it("emits parenthesized object literal return for lowered algebraic constructors", () => {
      const src = `pub fn test():
  let f = fn(x: int) => Ok(x)`;
      const mod = parse(src, "closure_lowered_record.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("const f = (x: number) => ({ ok: true, value: x });");
    });
  });

  describe("Step 23: Template Literals & Python f-strings Emitters", () => {
    it("emits native TypeScript template literals", () => {
      const src = `pub fn greet(name: str, count: int) -> str:
  ret \`Hello \${name}, you have \${count + 1} items!\``;
      const mod = parse(src, "greet.ts.aice");
      const ts = emitTarget(mod, "typescript");
      expect(ts).toContain("return `Hello ${name}, you have ${(count + 1)} items!`;");
    });

    it("emits native Python f-strings", () => {
      const src = `pub fn greet(name: str, count: int) -> str:
  ret \`Hello \${name}, you have \${count + 1} items!\``;
      const mod = parse(src, "greet.py.aice");
      const py = emitTarget(mod, "python");
      expect(py).toContain('return f"Hello {name}, you have {(count + 1)} items!"');
    });

    it("escapes literal curly braces in Python f-strings", () => {
      const src = `pub fn wrap(val: str) -> str:
  ret \`{item: \${val}}\``;
      const mod = parse(src, "wrap.py.aice");
      const py = emitTarget(mod, "python");
      expect(py).toContain('return f"{{item: {val}}}"');
    });
  });

  describe("Step 9: Emitted Target File Watermark Header", () => {
    it("prepends watermark header to fresh emitted TypeScript code by default", () => {
      const src = `pub fn add(a: int, b: int) -> int = a + b`;
      const mod = parse(src, "math.ts.aice");
      const ts = emitTypeScript(mod);

      expect(ts).toContain("// @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY");
      expect(ts).toContain("// Authoritative Source of Truth: math.ts.aice");
      expect(
        ts.startsWith(
          "// @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY\n// Authoritative Source of Truth: math.ts.aice",
        ),
      ).toBe(true);
      expect(ts).toContain("export function add(a: number, b: number): number {");
    });

    it("uses options.sourcePath when explicitly provided", () => {
      const src = `pub val VERSION = "1.0.0"`;
      const mod = parse(src, "version.ts.aice");
      const ts = emitTypeScript(mod, { sourcePath: "custom/path/version.aice" });

      expect(ts).toContain("// Authoritative Source of Truth: custom/path/version.aice");
    });

    it("falls back to .aice when path is anonymous or omitted", () => {
      const src = `pub val PI = 3.14`;
      const mod = parse(src);
      const ts = emitTypeScript(mod);

      expect(ts).toContain("// Authoritative Source of Truth: .aice");
    });

    it("prepends watermark header to fresh emitted React TSX components", () => {
      const src = `pub component Button(label: str):
  button: label`;
      const mod = parse(src, "Button.tsx.aice");
      const tsx = emitTarget(mod, "tsx");

      expect(tsx).toContain("// @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY");
      expect(tsx).toContain("// Authoritative Source of Truth: Button.tsx.aice");
      expect(tsx).toContain("export function Button({ label }: ButtonProps) {");
    });

    it("suppresses watermark header when watermark: false is specified", () => {
      const src = `pub fn multiply(x: int, y: int) -> int = x * y`;
      const mod = parse(src, "calc.ts.aice");
      const ts = emitTypeScript(mod, { watermark: false });

      expect(ts).not.toContain("@generated by AICE");
      expect(ts).not.toContain("Authoritative Source of Truth");
      expect(ts.trim().startsWith("export function multiply")).toBe(true);
    });

    it("does not duplicate watermark header if already present in leading trivia", () => {
      const src = `# @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY
# Authoritative Source of Truth: existing.ts.aice

pub val ACTIVE = true`;
      const { ast, trivia } = parseWithTrivia(src, "existing.ts.aice");
      const ts = emitTypeScript(ast, { trivia });

      // Count occurrences of watermark text
      const matches = ts.match(/@generated by AICE/g) || [];
      expect(matches.length).toBe(1);
    });

    it("CLI supports --no-watermark flag to suppress watermark header", () => {
      const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-watermark-test-"));
      try {
        const srcFile = path.join(tempDir, "service.ts.aice");
        fs.writeFileSync(srcFile, `pub fn ping() -> str = "pong"`, "utf-8");

        // 1. Compile with default watermark
        const outDefault = path.join(tempDir, "service-default.ts");
        const resDefault = spawnSync("bun", [cliPath, "compile", srcFile, "-o", outDefault], {
          encoding: "utf-8",
        });
        expect(resDefault.status).toBe(0);
        const contentDefault = fs.readFileSync(outDefault, "utf-8");
        expect(contentDefault).toContain("// @generated by AICE (AI Context Engine) - DO NOT EDIT DIRECTLY");
        expect(contentDefault).toContain("// Authoritative Source of Truth: ");

        // 2. Compile with --no-watermark
        const outNoWatermark = path.join(tempDir, "service-no-wm.ts");
        const resNoWm = spawnSync(
          "bun",
          [cliPath, "compile", srcFile, "--no-watermark", "-o", outNoWatermark],
          { encoding: "utf-8" },
        );
        expect(resNoWm.status).toBe(0);
        const contentNoWm = fs.readFileSync(outNoWatermark, "utf-8");
        expect(contentNoWm).not.toContain("@generated by AICE");
        expect(contentNoWm).not.toContain("Authoritative Source of Truth");
      } finally {
        fs.rmSync(tempDir, { recursive: true, force: true });
      }
    });
  });

  describe("Decompiler & Emitter Audit Fixes Verification", () => {
    it("splices constructor parameter properties after super() call", () => {
      const tsSrc = `class Child extends Base {
  constructor(public id: number) {
    super();
  }
}`;
      const { ast } = TsDecompiler.decompile(tsSrc);
      const cls = ast.items[0] as any;
      const ctor = cls.methods.find((m: any) => m.name === "constructor");
      expect(ctor).toBeDefined();
      expect(ctor.body.statements[0].kind).toBe("ExprStmt");
      expect(ctor.body.statements[0].expr.callee.name).toBe("super");
      expect(ctor.body.statements[1].kind).toBe("AssignStmt");
      expect(ctor.body.statements[1].target.property).toBe("id");
    });

    it("does not create primary constructor when constructor has mixed parameters", () => {
      const tsSrc = `class Mixed {
  constructor(public id: number, name: string) {}
}`;
      const { ast } = TsDecompiler.decompile(tsSrc);
      const cls = ast.items[0] as any;
      expect(cls.primaryConstructor).toBeUndefined();
      const ctor = cls.methods.find((m: any) => m.name === "constructor");
      expect(ctor).toBeDefined();
      expect(ctor.body.statements.length).toBe(1);
      expect(ctor.body.statements[0].target.property).toBe("id");
    });

    it("converts multi-variable for loop initializers", () => {
      const tsSrc = `function test() {
  for (let i = 0, j = 10; i < j; i++) {}
}`;
      const { ast } = TsDecompiler.decompile(tsSrc);
      const fn = ast.items[0] as any;
      expect(fn.body.statements.length).toBe(3);
      expect(fn.body.statements[0].name).toBe("i");
      expect(fn.body.statements[1].name).toBe("j");
      expect(fn.body.statements[2].kind).toBe("WhileStmt");
    });

    it("drains hoisted classes before enclosing top-level item", () => {
      const tsSrc = `function outer() {
  class Inner {}
  return new Inner();
}
const x = outer();`;
      const { ast } = TsDecompiler.decompile(tsSrc);
      const names = ast.items.map((i: any) => i.name);
      const innerIdx = names.indexOf("Inner");
      const outerIdx = names.indexOf("outer");
      expect(innerIdx).toBeGreaterThanOrEqual(0);
      expect(outerIdx).toBeGreaterThanOrEqual(0);
      expect(innerIdx).toBeLessThan(outerIdx);
    });

    it("handles empty closure round-trip correctly", () => {
      const tsSrc = `const f = (): void => {};`;
      const { ast, trivia } = TsDecompiler.decompile(tsSrc);
      const aice = AiceGenerator.generate(ast, { trivia });
      expect(aice).toContain("fn() -> void = nil");

      const aiceSrc = `pub val f = fn() -> void = nil`;
      const mod = parse(aiceSrc, "closure.ts.aice");
      const ts = emitTypeScript(mod);
      expect(ts).toContain("(): void => {};");
    });

    it("rewrites type expressions safely without corrupting string unions or property keys", () => {
      const unionSrc = `pub type PrimUnion = "int" | "str"`;
      const unionMod = parse(unionSrc, "union.ts.aice");
      const unionTs = emitTypeScript(unionMod);
      expect(unionTs).toContain('export type PrimUnion = "int" | "str";');

      const objSrc = `pub type Config = { num: int, str?: str }`;
      const objMod = parse(objSrc, "obj.ts.aice");
      const objTs = emitTypeScript(objMod);
      expect(objTs).toContain("num: number;");
      expect(objTs).toContain("str?: string;");

      const dummySpan = {
        file: "test.aice",
        start: { line: 1, column: 0, offset: 0 },
        end: { line: 1, column: 0, offset: 0 },
      };
      const emitter = new TypeScriptEmitter();
      const mapRes = emitter.emitTypeExpr({
        kind: "NamedType",
        name: "(a: Map<string, number>) => void",
        span: dummySpan,
      });
      expect(mapRes).toBe("(a: Map<string, number>) => void");

      const cbRes = emitter.emitTypeExpr({
        kind: "NamedType",
        name: "(cb: () => void) => void",
        span: dummySpan,
      });
      expect(cbRes).toBe("(cb: () => void) => void");

      const arrowFnType = emitter.emitTypeExpr({
        kind: "NamedType",
        name: "(a: int, b: str) -> bool",
        span: dummySpan,
      });
      expect(arrowFnType).toBe("(a: number, b: string) => boolean");
    });

    it("handles let re-declaration and parameter collision in function blocks", () => {
      const reassignSrc = `pub fn foo():
  let x = 1
  x = 2`;
      const reassignMod = parse(reassignSrc, "reassign.ts.aice");
      const reassignTs = emitTypeScript(reassignMod);
      expect(reassignTs).toContain("let x = 1;");
      expect(reassignTs).toContain("x = 2;");

      const redeclSrc = `pub fn bar():
  let y = 1
  let y = 2`;
      const redeclMod = parse(redeclSrc, "redecl.ts.aice");
      const redeclTs = emitTypeScript(redeclMod);
      expect(redeclTs).toContain("let y = 1;");
      expect(redeclTs).toContain("y = 2;");
      expect(redeclTs).not.toContain("const y = 2;");

      const paramSrc = `pub fn baz(x: int):
  let x = 42`;
      const paramMod = parse(paramSrc, "param.ts.aice");
      const paramTs = emitTypeScript(paramMod);
      expect(paramTs).toContain("x = 42;");
      expect(paramTs).not.toContain("const x = 42;");
    });

    it("preserves optional chaining and lowers contains correctly", () => {
      const src = `pub fn check(a: any, b: any):
  let res1 = a.contains(b)
  let res2 = a?.contains(b)`;
      const mod = parse(src, "contains.ts.aice");
      const ts = emitTypeScript(mod);
      expect(ts).toContain("a.includes(b)");
      expect(ts).toContain("a?.contains(b)");
    });

    it("emits JavaScript target enum and primary constructor correctly", () => {
      const enumSrc = `pub enum Status:
  Active
  Inactive`;
      const enumMod = parse(enumSrc, "status.js.aice");
      const enumJs = emitTarget(enumMod, "javascript");
      expect(enumJs).toContain("export const Status = { Active: 0, Inactive: 1 };");

      const classSrc = `pub class Point(pub x: int, pub y: int)`;
      const classMod = parse(classSrc, "point.js.aice");
      const classJs = emitTarget(classMod, "javascript");
      expect(classJs).toContain("constructor(x, y) {");
      expect(classJs).toContain("this.x = x;");
      expect(classJs).toContain("this.y = y;");
    });

    it("does not rewrite to Math builtin when shadowed by class method", () => {
      const src = `pub class Calc:
  fn min(a: int, b: int) -> int:
    ret a
  fn run():
    min(1, 2)`;
      const mod = parse(src, "calc.ts.aice");
      const ts = emitTypeScript(mod);
      expect(ts).not.toContain("Math.min");
      expect(ts).toContain("min(1, 2)");
    });
  });
});
