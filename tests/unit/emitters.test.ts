import { describe, expect, it } from "vitest";
import { parse } from "../../src/core/parser.js";
import {
  detectTargetFromPath,
  emitTarget,
  getTargetOutputPath,
  lowerConstructor,
  lowerMethodCall,
  lowerPropertyAccess,
} from "../../src/emitters/index.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Step 5: Multi-Language Forward Emitters & Lowering", () => {
  describe("Path & Target Detection", () => {
    it("detects targets correctly from file extensions", () => {
      expect(detectTargetFromPath("auth.ts.ail")).toBe("typescript");
      expect(detectTargetFromPath("button.tsx.ail")).toBe("tsx");
      expect(detectTargetFromPath("server.py.ail")).toBe("python");
      expect(detectTargetFromPath("index.html.ail")).toBe("html");
      expect(detectTargetFromPath("theme.css.ail")).toBe("css");
    });

    it("derives output target paths by stripping .ail", () => {
      expect(getTargetOutputPath("src/auth.ts.ail")).toBe("src/auth.ts");
      expect(getTargetOutputPath("components/Card.tsx.ail")).toBe("components/Card.tsx");
      expect(getTargetOutputPath("backend/main.py.ail")).toBe("backend/main.py");
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

      const mod = parse(src, "user.ts.ail");
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

      const mod = parse(src, "flow.ts.ail");
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

      const mod = parse(src, "shape.ts.ail");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export type Shape =");
      expect(out).toContain('{ kind: "Circle"; item0: number }');
      expect(out).toContain('{ kind: "Point" }');
    });

    it("emits object property shorthand in TypeScript records", () => {
      const src = `fn createPoint(x: int, y: int) -> any:
  let z = 10
  ret { x, y, extra: z }`;

      const mod = parse(src, "point.ts.ail");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("return { x, y, extra: z };");
    });

    it("lowers positional struct constructors and emits constructor factory in TypeScript", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn create(amt: int, cur: str) -> Money:
  ret Money(amt, cur)`;

      const mod = parse(src, "money.ts.ail");
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
      const mod = parse(src, "math.ts.ail");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("export function add(a: number, b: number): number {");
      expect(out).toContain("return (a + b);");
    });

    it("expands struct spreads to explicit fields in TypeScript", () => {
      const src = `type User:
  id: str
  name: str
  age: int

fn updateAge(u: User, newAge: int) -> User:
  ret { ...u, age: newAge }`;

      const mod = parse(src, "user.ts.ail");
      const out = emitTarget(mod, "typescript");

      expect(out).toContain("return { id: u.id, name: u.name, age: newAge };");
    });

    it("emits native object spread when target type is unconstrained in TypeScript", () => {
      const src = `fn merge(base: any, extra: int) -> any:
  ret { ...base, count: extra }`;

      const mod = parse(src, "merge.ts.ail");
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

      const mod = parse(src, "banner.tsx.ail");
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

      const mod = parse(src, "session.py.ail");
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

      const mod = parse(src, "match.py.ail");
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

      const mod = parse(src, "point.py.ail");
      const out = emitTarget(mod, "python");

      expect(out).toContain('return {"x": x, "y": y, "extra": z}');
    });

    it("lowers positional struct constructors to dictionary literals in Python", () => {
      const src = `type Money:
  amountInCents: int
  currencyCode: str

fn create(amt: int, cur: str) -> Money:
  ret Money(amt, cur)`;

      const mod = parse(src, "money.py.ail");
      const out = emitTarget(mod, "python");

      expect(out).toContain("class Money(TypedDict):");
      expect(out).toContain('return {"amountInCents": amt, "currencyCode": cur}');
    });

    it("emits single-expression functions in Python", () => {
      const src = `fn add(a: int, b: int) -> int = a + b`;
      const mod = parse(src, "math.py.ail");
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

      const mod = parse(src, "user.py.ail");
      const out = emitTarget(mod, "python");

      expect(out).toContain('return {"id": u.id, "name": u.name, "age": newAge}');
    });

    it("emits kwargs spread when target type is unconstrained in Python", () => {
      const src = `fn merge(base: any, extra: int) -> any:
  ret { ...base, count: extra }`;

      const mod = parse(src, "merge.py.ail");
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

      const mod = parse(src, "page.html.ail");
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

      const mod = parse(src, "theme.css.ail");
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

      const mod = parse(src, "theme.css.ail");
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

      const mod = parse(src, "tokens.css.ail");
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

      const mod = parse(src, "dense.css.ail");
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

      const mod = parse(src, "tokens.css.ail");
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
  });

  describe("HTML & TSX Emmet Layout Emission", () => {
    it("emits Emmet selector tags with class and id in HTML5", () => {
      const src = `component Page():
  header.top-navbar#main-header:
    .navbar-brand:
      span.brand-icon: "⚡"`;

      const mod = parse(src, "page.html.ail");
      const out = emitTarget(mod, "html");

      expect(out).toContain('<header class="top-navbar" id="main-header">');
      expect(out).toContain('<div class="navbar-brand">');
      expect(out).toContain('<span class="brand-icon">⚡</span>');
    });

    it("emits Emmet selector tags with className and id in TSX", () => {
      const src = `component Card(title: str):
  .card-container#featured-card:
    h2.card-title: title`;

      const mod = parse(src, "Card.tsx.ail");
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

      const mod = parse(src, "layout.html.ail");
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

      const mod = parse(src, "math.ts.ail");
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

      const mod = parse(src, "math.ts.ail");
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

      const mod = parse(src, "log.ts.ail");
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
      const mod = parse(src, "user.ts.ail");
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
      const mod = parse(src, "user.py.ail");
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
      const mod = parse(src, "calc.ail");

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
      const mod = parse(src, "calc.ail");

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
      const mod = parse(src, "point.ts.ail");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("class Point {");
      expect(tsOut).toContain("constructor(public x: number, public y: number = 0) {}");
      expect(tsOut).toContain("distance(): number {");
    });

    it("emits Python __init__ with assignments from primaryConstructor", () => {
      const src = `class Point(x:!i, y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.py.ail");
      const pyOut = emitTarget(mod, "python");

      expect(pyOut).toContain("class Point:");
      expect(pyOut).toContain("def __init__(self, x: int, y: int = 0):");
      expect(pyOut).toContain("self.x = x");
      expect(pyOut).toContain("self.y = y");
    });

    it("emits C++ constructor initializer list and member variables from primaryConstructor", () => {
      const src = `class Point(x:!i, y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.cpp.ail");
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
      const mod = parse(src, "Snake.ts.ail");
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
      const mod = parse(src, "Counter.ts.ail");
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

      const mod = parse(src, "SnakeSegment.ts.ail");
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

      const mod = parse(src, "CustomPlayer.ts.ail");
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

      const mod = parse(src, "Mover.ts.ail");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain("this.x += dx;");
    });

    it("synthesizes static getters and setters with class qualifier", () => {
      const src = `class Config:
  static prop Version, version: str = "1.0.0"`;

      const mod = parse(src, "Config.ts.ail");
      const tsOut = emitTarget(mod, "typescript");

      expect(tsOut).toContain('static Version: string = "1.0.0";');
      expect(tsOut).toContain("static get version() { return Config.Version; }");
      expect(tsOut).toContain("static set version(v: string) { Config.Version = v; }");
    });

    it("emits idiomatic Python @property and setter for property aliases", () => {
      const src = `class Player:
  prop X, x: int = 0`;

      const mod = parse(src, "Player.py.ail");
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

      const mod = parse(src, "Vector.ail");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });
  });
});

