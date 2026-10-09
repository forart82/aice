import { describe, expect, it } from "vitest";
import type {
  BinaryExpr,
  CallExpr,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  LetBinding,
  MatchStmt,
  MemberAccessExpr,
  PostfixTryExpr,
  PrimitiveType,
  RecordLiteralExpr,
  RefinementType,
  StyleDecl,
  TypeDecl,
  VarDecl,
} from "../../src/core/ast.js";
import { ParserError, parse } from "../../src/core/parser.js";

describe("AIL 2.0 Pratt Parser & Universal AST Generator", () => {
  describe("Modules & Imports", () => {
    it("parses module header and imports", () => {
      const src = `module app/calculator

from "./math.ts" import add, multiply as mult
from "node:crypto" import *`;

      const mod = parse(src, "test.ail");
      expect(mod.path).toBe("app/calculator");
      expect(mod.items).toHaveLength(2);

      const imp1 = mod.items[0];
      expect(imp1.kind).toBe("ImportDecl");
      if (imp1.kind === "ImportDecl") {
        expect(imp1.source).toBe("./math.ts");
        expect(imp1.specifiers).toHaveLength(2);
        expect(imp1.specifiers[0].name).toBe("add");
        expect(imp1.specifiers[1].name).toBe("multiply");
        expect(imp1.specifiers[1].alias).toBe("mult");
      }

      const imp2 = mod.items[1];
      expect(imp2.kind).toBe("ImportDecl");
      if (imp2.kind === "ImportDecl") {
        expect(imp2.source).toBe("node:crypto");
        expect(imp2.specifiers[0].isWildcard).toBe(true);
      }
    });
  });

  describe("Type & Struct Declarations", () => {
    it("parses indented struct type declarations", () => {
      const src = `type User:
  id:str
  age:int
  active:bool`;

      const mod = parse(src);
      expect(mod.items).toHaveLength(1);
      const typeDecl = mod.items[0] as TypeDecl;
      expect(typeDecl.kind).toBe("TypeDecl");
      expect(typeDecl.name).toBe("User");
      expect(typeDecl.isEnum).toBe(false);
      expect(typeDecl.fields).toHaveLength(3);
      expect(typeDecl.fields?.[0].name).toBe("id");
      expect(typeDecl.fields?.[0].typeAnnotation.kind).toBe("PrimitiveType");
    });

    it("parses refinement type aliases", () => {
      const src = `type Port = { p:int | p >= 1 and p <= 65535 }`;
      const mod = parse(src);
      const typeDecl = mod.items[0] as TypeDecl;
      expect(typeDecl.kind).toBe("TypeDecl");
      expect(typeDecl.name).toBe("Port");
      expect(typeDecl.aliasType?.kind).toBe("RefinementType");

      const ref = typeDecl.aliasType as RefinementType;
      expect(ref.param).toBe("p");
      expect(ref.baseType.primitive).toBe("int");
      expect(ref.predicate.kind).toBe("BinaryExpr");
    });

    it("parses enums with optional payload variants", () => {
      const src = `enum Status:
  Pending
  Active(int)
  Failed(str, int)`;

      const mod = parse(src);
      const enumDecl = mod.items[0] as TypeDecl;
      expect(enumDecl.kind).toBe("TypeDecl");
      expect(enumDecl.isEnum).toBe(true);
      expect(enumDecl.name).toBe("Status");
      expect(enumDecl.variants).toHaveLength(3);
      expect(enumDecl.variants?.[0].name).toBe("Pending");
      expect(enumDecl.variants?.[0].payloadTypes).toBeUndefined();
      expect(enumDecl.variants?.[1].name).toBe("Active");
      expect(enumDecl.variants?.[1].payloadTypes).toHaveLength(1);
      expect(enumDecl.variants?.[2].name).toBe("Failed");
      expect(enumDecl.variants?.[2].payloadTypes).toHaveLength(2);
    });

    it("parses single-line compact structs with comma separators and default values", () => {
      const src = `type User: id:str, name:str, age:int = 0, active:bool = true`;
      const mod = parse(src);
      expect(mod.items).toHaveLength(1);
      const typeDecl = mod.items[0] as TypeDecl;
      expect(typeDecl.kind).toBe("TypeDecl");
      expect(typeDecl.name).toBe("User");
      expect(typeDecl.fields).toHaveLength(4);
      expect(typeDecl.fields?.[0].name).toBe("id");
      expect(typeDecl.fields?.[1].name).toBe("name");
      expect(typeDecl.fields?.[2].name).toBe("age");
      expect(typeDecl.fields?.[2].defaultValue).toBeDefined();
      expect(typeDecl.fields?.[3].name).toBe("active");
      expect(typeDecl.fields?.[3].defaultValue).toBeDefined();
    });

    it("parses 1-token primitive sigils (!s, !i, !b, !f, !n, !v, !c, !y)", () => {
      const src = `type Record: s:!s, i:!i, b:!b, f:!f, n:!n, v:!v, c:!c, y:!y`;
      const mod = parse(src);
      const typeDecl = mod.items[0] as TypeDecl;
      expect(typeDecl.fields).toHaveLength(8);
      const primitives = typeDecl.fields?.map((f) => (f.typeAnnotation as PrimitiveType).primitive);
      expect(primitives).toEqual(["str", "int", "bool", "float", "num", "void", "char", "byte"]);
    });

    it("parses single-line enums with comma separators", () => {
      const src = `enum Direction: North, South, East, West`;
      const mod = parse(src);
      const enumDecl = mod.items[0] as TypeDecl;
      expect(enumDecl.isEnum).toBe(true);
      expect(enumDecl.variants).toHaveLength(4);
      expect(enumDecl.variants?.map((v) => v.name)).toEqual(["North", "South", "East", "West"]);
    });
  });

  describe("Functions & Closures", () => {
    it("parses block-bodied functions with typed parameters", () => {
      const src = `fn compute(x:int, y:int) -> int:
  let sum = x + y
  ret sum`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.name).toBe("compute");
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0].name).toBe("x");
      expect(fn.params[1].name).toBe("y");
      expect(fn.returnType?.kind).toBe("PrimitiveType");
      expect(fn.isExpressionBodied).toBe(false);

      if (fn.body.kind === "Block") {
        expect(fn.body.statements).toHaveLength(2);
        expect(fn.body.statements[0].kind).toBe("LetBinding");
        expect(fn.body.statements[1].kind).toBe("ReturnStmt");
      }
    });

    it("parses expression-bodied functions", () => {
      const src = `fn square(x:int) -> int = x * x`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.name).toBe("square");
      expect(fn.isExpressionBodied).toBe(true);
      expect(fn.body.kind).toBe("BinaryExpr");
    });

    it("parses closures", () => {
      const src = `fn test():
  let double = fn(x:int) -> int = x * 2
  ret double(5)`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const letStmt = fn.body.statements[0] as LetBinding;
        expect(letStmt.init.kind).toBe("ClosureExpr");
      }
    });

    it("parses arrow-bodied functions and closures with =>", () => {
      const src = `fn add(a:int, b:int) -> int => a + b
fn test():
  let mul = fn(x:int, y:int) => x * y`;
      const mod = parse(src);
      const fn1 = mod.items[0] as FunctionDecl;
      expect(fn1.name).toBe("add");
      expect(fn1.isExpressionBodied).toBe(true);
      expect(fn1.body.kind).toBe("BinaryExpr");

      const fn2 = mod.items[1] as FunctionDecl;
      if (fn2.body.kind === "Block") {
        const letStmt = fn2.body.statements[0] as LetBinding;
        expect(letStmt.init.kind).toBe("ClosureExpr");
      }
    });
  });

  describe("Control Flow & Statements", () => {
    it("parses if / elif / else chains", () => {
      const src = `fn check(score:int) -> str:
  if score >= 90:
    ret "A"
  elif score >= 80:
    ret "B"
  else:
    ret "C"`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const ifStmt = fn.body.statements[0] as IfStmt;
        expect(ifStmt.kind).toBe("IfStmt");
        expect(ifStmt.condition.kind).toBe("BinaryExpr");
        expect(ifStmt.elifBranches).toHaveLength(1);
        expect(ifStmt.elseBranch).not.toBeNull();
      }
    });

    it("parses pattern matching with match/case", () => {
      const src = `fn describeStatus(s:Status) -> str:
  match s:
    case Pending => "Waiting"
    case Active(count) => "Active with count"
    case _ => "Unknown"`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const matchStmt = fn.body.statements[0] as MatchStmt;
        expect(matchStmt.kind).toBe("MatchStmt");
        expect(matchStmt.cases).toHaveLength(3);
        expect(matchStmt.cases[0].pattern.kind).toBe("IdentifierPattern");
        expect(matchStmt.cases[1].pattern.kind).toBe("ConstructorPattern");
        expect(matchStmt.cases[2].pattern.kind).toBe("WildcardPattern");
      }
    });

    it("parses for and while loops", () => {
      const src = `fn loopDemo(items:[int]):
  for item in items:
    log(item)
  while true:
    break`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        expect(fn.body.statements[0].kind).toBe("ForStmt");
        expect(fn.body.statements[1].kind).toBe("WhileStmt");
      }
    });

    it("parses semicolon-separated statements on single line", () => {
      const src = `fn demo():
  let a = 1; let b = 2; ret a + b`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        expect(fn.body.statements).toHaveLength(3);
      }
    });

    it("parses permissive curly braced blocks", () => {
      const src = `fn braced() -> int {
  ret 42
}`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.name).toBe("braced");
      if (fn.body.kind === "Block") {
        expect(fn.body.statements).toHaveLength(1);
      }
    });
  });

  describe("Pratt Operator Precedence & Expressions", () => {
    it("respects standard mathematical precedence (2 + 3 * 4 == 14)", () => {
      const src = `fn calc() = 2 + 3 * 4 == 14`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const expr = fn.body as BinaryExpr;

      expect(expr.operator).toBe("==");
      const left = expr.left as BinaryExpr;
      expect(left.operator).toBe("+");
      expect((left.right as BinaryExpr).operator).toBe("*");
    });

    it("parses logical and short-circuit operators (a and b or c)", () => {
      const src = `fn logic(a:bool, b:bool, c:bool) = a and b or c`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const expr = fn.body as BinaryExpr;

      expect(expr.operator).toBe("or");
      expect((expr.left as BinaryExpr).operator).toBe("and");
    });

    it("parses postfix ? try unwrap operator on function calls", () => {
      const src = `fn load(id:str) -> Result[User, Error]:
  let user = fetchUser(id)?
  ret Ok(user)`;

      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const letStmt = fn.body.statements[0] as LetBinding;
        expect(letStmt.init.kind).toBe("PostfixTryExpr");
        const tryExpr = letStmt.init as PostfixTryExpr;
        expect(tryExpr.operand.kind).toBe("CallExpr");
        const call = tryExpr.operand as CallExpr;
        expect(call.callee.kind).toBe("IdentifierExpr");
      }
    });

    it("parses member access and optional chaining (user?.profile?.name)", () => {
      const src = `fn getName(user:User) = user?.profile?.name`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const access1 = fn.body as MemberAccessExpr;

      expect(access1.kind).toBe("MemberAccessExpr");
      expect(access1.property).toBe("name");
      expect(access1.isSafeNav).toBe(true);

      const access2 = access1.object as MemberAccessExpr;
      expect(access2.property).toBe("profile");
      expect(access2.isSafeNav).toBe(true);
    });

    it("parses array literals and index access", () => {
      const src = `fn getFirst() = [10, 20, 30][0]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("IndexExpr");
    });

    it("parses record literals", () => {
      const src = `fn makeUser(name:str) = { name: name, age: 30 }`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("RecordLiteralExpr");
    });

    it("parses record literals with property shorthand", () => {
      const src = `fn makeUser(name:str, age:int) = { name, age, active: true }`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("RecordLiteralExpr");
      const rec = fn.body as RecordLiteralExpr;
      expect(rec.properties).toHaveLength(3);
      expect(rec.properties[0].key).toBe("name");
      expect(rec.properties[0].value.kind).toBe("IdentifierExpr");
      expect((rec.properties[0].value as IdentifierExpr).name).toBe("name");
      expect(rec.properties[1].key).toBe("age");
      expect(rec.properties[1].value.kind).toBe("IdentifierExpr");
      expect((rec.properties[1].value as IdentifierExpr).name).toBe("age");
      expect(rec.properties[2].key).toBe("active");
    });

    it("parses record literals with spread syntax", () => {
      const src = `fn updateUser(user:User) = { ...user, active: false }`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("RecordLiteralExpr");
      const rec = fn.body as RecordLiteralExpr;
      expect(rec.properties).toHaveLength(2);
      expect(rec.properties[0].isSpread).toBe(true);
      expect(rec.properties[0].value.kind).toBe("IdentifierExpr");
      expect((rec.properties[0].value as IdentifierExpr).name).toBe("user");
      expect(rec.properties[1].key).toBe("active");
    });
  });

  describe("Declarative UI Component DSL Parsing", () => {
    it("parses declarative component trees with attributes and children", () => {
      const src = `component Card(title:str, elevation:int):
  Header:
    Title: "Welcome"
  Button(onClick: handleClick): "Submit"`;

      const mod = parse(src);
      const comp = mod.items[0] as ComponentDecl;
      expect(comp.kind).toBe("ComponentDecl");
      expect(comp.name).toBe("Card");
      expect(comp.params).toHaveLength(2);
      expect(comp.layout).toHaveLength(2);

      // Header node with nested Title child
      const header = comp.layout[0];
      expect(header.tag).toBe("Header");
      expect(header.children).toHaveLength(1);
      expect(header.children[0].tag).toBe("Title");
      expect(header.children[0].textLiteral).toBe("Welcome");

      // Button node with attribute and direct text literal
      const button = comp.layout[1];
      expect(button.tag).toBe("Button");
      expect(button.attributes).toHaveLength(1);
      expect(button.attributes[0].name).toBe("onClick");
      expect(button.textLiteral).toBe("Submit");
    });
  });

  describe("Style Declarations", () => {
    it("parses style blocks with CSS properties", () => {
      const src = `style ButtonStyle:
  color: "#ffffff"
  background: "#1e40af"`;

      const mod = parse(src);
      const style = mod.items[0];
      expect(style.kind).toBe("StyleDecl");
      if (style.kind === "StyleDecl") {
        expect(style.name).toBe("ButtonStyle");
        expect(style.properties).toHaveLength(2);
        expect(style.properties[0].property).toBe("color");
        expect(style.properties[0].value).toBe("#ffffff");
        expect(style.properties[1].property).toBe("background");
        expect(style.properties[1].value).toBe("#1e40af");
      }
    });

    it("parses unquoted modern CSS properties, values, units, and custom variables", () => {
      const src = `style Button:
  margin: 0
  padding: 1.5rem
  display: flex
  color: #fff
  background: #0f172a
  border: 1px solid #334155
  box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.1)
  --custom-color: #3b82f6`;

      const mod = parse(src);
      const style = mod.items[0];
      expect(style.kind).toBe("StyleDecl");
      if (style.kind === "StyleDecl") {
        expect(style.properties).toHaveLength(8);
        expect(style.properties[0]).toMatchObject({ property: "margin", value: "0" });
        expect(style.properties[1]).toMatchObject({ property: "padding", value: "1.5rem" });
        expect(style.properties[2]).toMatchObject({ property: "display", value: "flex" });
        expect(style.properties[3]).toMatchObject({ property: "color", value: "#fff" });
        expect(style.properties[4]).toMatchObject({ property: "background", value: "#0f172a" });
        expect(style.properties[5]).toMatchObject({
          property: "border",
          value: "1px solid #334155",
        });
        expect(style.properties[6]).toMatchObject({
          property: "box-shadow",
          value: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
        });
        expect(style.properties[7]).toMatchObject({ property: "--custom-color", value: "#3b82f6" });
      }
    });

    it("parses hex color as string literal expression in variable bindings", () => {
      const src = `let primary = #3b82f6`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const letStmt = block.statements[0];
      expect(letStmt.init.kind).toBe("LiteralExpr");
      if (letStmt.init.kind === "LiteralExpr") {
        expect(letStmt.init.literalKind).toBe("string");
        expect(letStmt.init.value).toBe("#3b82f6");
      }
    });
  });

  describe("Step 8: Universal Single-Expression Function Bodies", () => {
    it("parses single-line and multiline expression function bodies", () => {
      const src1 = `fn add(a: int, b: int) -> int = a + b`;
      const mod1 = parse(src1);
      const fn1 = mod1.items[0] as FunctionDecl;
      expect(fn1.isExpressionBodied).toBe(true);
      expect(fn1.body.kind).toBe("BinaryExpr");

      const src2 = `fn multiply(a: int, b: int) =
  a * b`;
      const mod2 = parse(src2);
      const fn2 = mod2.items[0] as FunctionDecl;
      expect(fn2.isExpressionBodied).toBe(true);
      expect(fn2.body.kind).toBe("BinaryExpr");
    });

    it("parses closure expression bodies", () => {
      const src = `fn compute() = fn(x: int) = x * 2`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("ClosureExpr");
    });
  });

  describe("Step 1 & Step 2: High-Density CSS Tokens and Emmet Layout DSL", () => {
    it("parses Emmet selector syntax with chained classes, ids, and inline text", () => {
      const src = `component TestNavbar():
  header.top-navbar#main-header:
    .navbar-brand-section:
      span.brand-icon: "⚡"
      span.brand-name: "CloudOps"
    button.btn.btn-icon#btn-theme-toggle:
      span.icon "🌙"`;

      const mod = parse(src, "navbar.html.ail");
      const comp = mod.items[0] as ComponentDecl;
      expect(comp.kind).toBe("ComponentDecl");
      expect(comp.layout).toHaveLength(1);

      const header = comp.layout[0];
      expect(header.tag).toBe("header");
      expect(header.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "class",
            value: expect.objectContaining({ value: "top-navbar" }),
          }),
          expect.objectContaining({
            name: "id",
            value: expect.objectContaining({ value: "main-header" }),
          }),
        ]),
      );
      expect(header.children).toHaveLength(2);

      const brandSec = header.children[0];
      expect(brandSec.tag).toBe("div");
      expect(brandSec.attributes[0].value).toMatchObject({ value: "navbar-brand-section" });

      const toggleBtn = header.children[1];
      expect(toggleBtn.tag).toBe("button");
      expect(toggleBtn.attributes).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            name: "class",
            value: expect.objectContaining({ value: "btn btn-icon" }),
          }),
          expect.objectContaining({
            name: "id",
            value: expect.objectContaining({ value: "btn-theme-toggle" }),
          }),
        ]),
      );
      expect(toggleBtn.children[0].textLiteral).toBe("🌙");
    });

    it("parses token blocks and expands namespace custom properties", () => {
      const src = `style root_variables:
  tokens color.slate:
    950: #020617, 900: #0f172a
  tokens spacing: [0, 4, 8]px`;

      const mod = parse(src, "tokens.css.ail");
      const style = mod.items[0] as StyleDecl;
      expect(style.kind).toBe("StyleDecl");
      expect(style.properties).toHaveLength(5);
      expect(style.properties[0]).toMatchObject({
        property: "--color-slate-950",
        value: "#020617",
      });
      expect(style.properties[1]).toMatchObject({
        property: "--color-slate-900",
        value: "#0f172a",
      });
      expect(style.properties[2]).toMatchObject({ property: "--spacing-0", value: "0px" });
      expect(style.properties[3]).toMatchObject({ property: "--spacing-4", value: "4px" });
      expect(style.properties[4]).toMatchObject({ property: "--spacing-8", value: "8px" });
    });

    it("Step 18: parses HTML Emmet implicit tag inference and inline modifier _", () => {
      const src = `component App():
  ul.nav-menu:
    .nav-item:
      _.icon: "📊"
      _.label: "Telemetry"
  table.data-table:
    tbody:
      .row:
        .cell: "Data"
  button.submit-btn:
    .btn-text: "Click"`;

      const mod = parse(src, "app.html.ail");
      const comp = mod.items[0] as ComponentDecl;
      expect(comp.layout).toHaveLength(3);

      // 1. ul -> li
      const ul = comp.layout[0];
      expect(ul.tag).toBe("ul");
      const li = ul.children[0];
      expect(li.tag).toBe("li");
      expect(li.children[0].tag).toBe("span");
      expect(li.children[1].tag).toBe("span");

      // 2. table -> tbody -> tr -> td
      const table = comp.layout[1];
      const tbody = table.children[0];
      const tr = tbody.children[0];
      expect(tr.tag).toBe("tr");
      const td = tr.children[0];
      expect(td.tag).toBe("td");

      // 3. button (phrasing) -> span
      const btn = comp.layout[2];
      expect(btn.tag).toBe("button");
      expect(btn.children[0].tag).toBe("span");
    });
  });

  describe("Step 8: Object-Oriented Class & Module-Level Constants", () => {
    it("parses class declarations with properties, methods, and extends", () => {
      const src = `pub class SnakePlayer[T] extends BaseEntity implements IRenderable:
  static maxSpeed: int = 100
  readonly id: str
  score: int = 0

  fn new(id: str):
    this.id = id

  static fn getDefaultSpeed() -> int:
    ret 50

  fn update(dt: float) -> void:
    this.score = this.score + 10`;

      const mod = parse(src, "player.ail");
      expect(mod.items).toHaveLength(1);
      const cls = mod.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("SnakePlayer");
      expect(cls.isExported).toBe(true);
      expect(cls.typeParams).toEqual(["T"]);
      expect(cls.extends).toBe("BaseEntity");
      expect(cls.implements).toEqual(["IRenderable"]);
      expect(cls.properties).toHaveLength(3);
      expect(cls.properties[0].name).toBe("maxSpeed");
      expect(cls.properties[0].isStatic).toBe(true);
      expect(cls.properties[1].name).toBe("id");
      expect(cls.properties[1].isReadonly).toBe(true);
      expect(cls.properties[2].name).toBe("score");
      expect(cls.methods).toHaveLength(3);
      expect(cls.methods[0].name).toBe("new");
      expect(cls.methods[1].name).toBe("getDefaultSpeed");
      expect(cls.methods[1].isStatic).toBe(true);
      expect(cls.methods[2].name).toBe("update");
    });

    it("Step 16: parses primary class constructors with parameter properties", () => {
      const src = `class Point(pub x:!i, pub y:!i = 0):
  fn distance() -> !f = 0.0`;
      const mod = parse(src, "point.ail");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("Point");
      expect(cls.primaryConstructor).toBeDefined();
      expect(cls.primaryConstructor).toHaveLength(2);
      expect(cls.primaryConstructor![0].name).toBe("x");
      expect(cls.primaryConstructor![0].isPub).toBe(true);
      expect(cls.primaryConstructor![1].name).toBe("y");
      expect(cls.primaryConstructor![1].defaultValue).toBeDefined();
      expect(cls.methods).toHaveLength(1);
    });

    it("Step 16: parses inline primary constructor class without body", () => {
      const src = `class Vector2D(x:!f, y:!f)`;
      const mod = parse(src, "vec.ail");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.name).toBe("Vector2D");
      expect(cls.primaryConstructor).toHaveLength(2);
      expect(cls.properties).toHaveLength(0);
      expect(cls.methods).toHaveLength(0);
    });

    it("Step 20: parses dual-case property compaction and property aliases", () => {
      const src = `class Player:
  prop X, x: int = 0
  prop Y, y = 10
  prop Angle, angle: int
  prop Alive, alive
  prop MaxSpeed: int = 200
  prop Z: int, z
  prop Multi, m1, m2: int = 42
  Score, score: int = 100`;

      const mod = parse(src, "player.ail");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.properties).toHaveLength(8);

      expect(cls.properties[0].name).toBe("X");
      expect(cls.properties[0].alias).toBe("x");
      expect(cls.properties[0].aliases).toEqual(["x"]);
      expect(cls.properties[0].typeAnnotation).toBeDefined();
      expect(cls.properties[0].initialValue).toBeDefined();

      expect(cls.properties[1].name).toBe("Y");
      expect(cls.properties[1].alias).toBe("y");
      expect(cls.properties[1].initialValue).toBeDefined();

      expect(cls.properties[2].name).toBe("Angle");
      expect(cls.properties[2].alias).toBe("angle");
      expect(cls.properties[2].typeAnnotation).toBeDefined();
      expect(cls.properties[2].initialValue).toBeUndefined();

      expect(cls.properties[3].name).toBe("Alive");
      expect(cls.properties[3].alias).toBe("alive");
      expect(cls.properties[3].typeAnnotation).toBeUndefined();
      expect(cls.properties[3].initialValue).toBeUndefined();

      expect(cls.properties[4].name).toBe("MaxSpeed");
      expect(cls.properties[4].alias).toBeUndefined();
      expect(cls.properties[4].aliases).toBeUndefined();

      expect(cls.properties[5].name).toBe("Z");
      expect(cls.properties[5].alias).toBe("z");
      expect(cls.properties[5].typeAnnotation).toBeDefined();

      expect(cls.properties[6].name).toBe("Multi");
      expect(cls.properties[6].alias).toBe("m1");
      expect(cls.properties[6].aliases).toEqual(["m1", "m2"]);

      expect(cls.properties[7].name).toBe("Score");
      expect(cls.properties[7].alias).toBe("score");
      expect(cls.properties[7].initialValue).toBeDefined();
    });

    it("parses top-level const and pub let module declarations", () => {
      const src = `const DEFAULT_LIVES: int = 3
pub const MAX_HEALTH = 100
pub let mut gameRunning: bool = true`;

      const mod = parse(src, "constants.ail");
      expect(mod.items).toHaveLength(3);

      const c1 = mod.items[0] as ConstDecl;
      expect(c1.kind).toBe("ConstDecl");
      expect(c1.name).toBe("DEFAULT_LIVES");
      expect(c1.isExported).toBe(false);

      const c2 = mod.items[1] as ConstDecl;
      expect(c2.kind).toBe("ConstDecl");
      expect(c2.name).toBe("MAX_HEALTH");
      expect(c2.isExported).toBe(true);

      const v1 = mod.items[2] as VarDecl;
      expect(v1.kind).toBe("VarDecl");
      expect(v1.name).toBe("gameRunning");
      expect(v1.isExported).toBe(true);
      expect(v1.isMut).toBe(true);
    });

    it("parses module paths containing slashes and dots", () => {
      const src = `module src/audio/Synth.ts
const ACTIVE: bool = true`;
      const mod = parse(src, "Synth.ts.ail");
      expect(mod.path).toBe("src/audio/Synth.ts");
    });

    it("Step 19: parses compound assignment operators (+=, -=, *=, /=, %=)", () => {
      const src = `fn update(x:int):
  x += 5
  x -= 2
  x *= 3
  x /= 2
  x %= 4`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const stmts = fn.body.statements as any[];
        expect(stmts[0].op).toBe("+=");
        expect(stmts[1].op).toBe("-=");
        expect(stmts[2].op).toBe("*=");
        expect(stmts[3].op).toBe("/=");
        expect(stmts[4].op).toBe("%=");
      }
    });
  });

  describe("Step 21: Keywordless Variable & Mutable Declaration", () => {
    it("parses immutable keywordless binding x := 42", () => {
      const src = `fn test():
  x := 42`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("LetBinding");
      expect(stmt.name).toBe("x");
      expect(stmt.isMut).toBe(false);
      expect(stmt.typeAnnotation).toBeNull();
    });

    it("parses mutable keywordless binding y ::= \"mutable\"", () => {
      const src = `fn test():
  y ::= "mutable"`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("LetBinding");
      expect(stmt.name).toBe("y");
      expect(stmt.isMut).toBe(true);
      expect(stmt.typeAnnotation).toBeNull();
    });

    it("parses typed immutable keywordless binding z: int := 100", () => {
      const src = `fn test():
  z: int := 100`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("LetBinding");
      expect(stmt.name).toBe("z");
      expect(stmt.isMut).toBe(false);
      expect(stmt.typeAnnotation?.kind).toBe("PrimitiveType");
    });

    it("parses typed mutable keywordless binding w: string ::= \"mut_typed\"", () => {
      const src = `fn test():
  w: str ::= "mut_typed"`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("LetBinding");
      expect(stmt.name).toBe("w");
      expect(stmt.isMut).toBe(true);
      expect(stmt.typeAnnotation?.kind).toBe("PrimitiveType");
    });

    it("parses top-level x := 10 and mutable declarations", () => {
      const src = `x := 10
pub y ::= "mutable"
z: int := 100
pub w: str ::= "mut_typed"`;
      const mod = parse(src);
      expect(mod.items).toHaveLength(4);

      const v1 = mod.items[0] as VarDecl;
      expect(v1.kind).toBe("VarDecl");
      expect(v1.name).toBe("x");
      expect(v1.isExported).toBe(false);
      expect(v1.isMut).toBe(false);

      const v2 = mod.items[1] as VarDecl;
      expect(v2.kind).toBe("VarDecl");
      expect(v2.name).toBe("y");
      expect(v2.isExported).toBe(true);
      expect(v2.isMut).toBe(true);

      const v3 = mod.items[2] as VarDecl;
      expect(v3.kind).toBe("VarDecl");
      expect(v3.name).toBe("z");
      expect(v3.isExported).toBe(false);
      expect(v3.isMut).toBe(false);
      expect(v3.typeAnnotation).toBeDefined();

      const v4 = mod.items[3] as VarDecl;
      expect(v4.kind).toBe("VarDecl");
      expect(v4.name).toBe("w");
      expect(v4.isExported).toBe(true);
      expect(v4.isMut).toBe(true);
      expect(v4.typeAnnotation).toBeDefined();
    });

    it("preserves backward compatibility for let and let mut", () => {
      const src = `fn legacy():
  let a = 1
  let mut b: int = 2`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      expect(block.statements[0].isMut).toBe(false);
      expect(block.statements[1].isMut).toBe(true);
    });
  });

  describe("Step 22: Vector & Arithmetic Compression DSL", () => {
    it("parses immutable vector destructuring [x, y] := [1, 2]", () => {
      const src = `fn test():
  [x, y] := [1, 2]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: any[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("DestructureBinding");
      expect(stmt.names).toEqual(["x", "y"]);
      expect(stmt.isMut).toBe(false);
      expect(stmt.init.kind).toBe("ArrayLiteralExpr");
    });

    it("parses mutable vector destructuring [x, y] ::= [1, 2]", () => {
      const src = `fn test():
  [x, y] ::= [1, 2]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: any[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("DestructureBinding");
      expect(stmt.names).toEqual(["x", "y"]);
      expect(stmt.isMut).toBe(true);
      expect(stmt.init.kind).toBe("ArrayLiteralExpr");
    });

    it("parses tuple destructuring (a, b) := [10, 20]", () => {
      const src = `fn test():
  (a, b) := [10, 20]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: any[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("DestructureBinding");
      expect(stmt.names).toEqual(["a", "b"]);
      expect(stmt.isMut).toBe(false);
    });

    it("parses vector compound assignment [x, y] += [dx, dy]", () => {
      const src = `fn test():
  [x, y] += [dx, dy]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: any[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.target.kind).toBe("ArrayLiteralExpr");
      expect(stmt.op).toBe("+=");
      expect(stmt.value.kind).toBe("ArrayLiteralExpr");
    });

    it("parses vector direct assignment [x, y] = [newX, newY]", () => {
      const src = `fn test():
  [x, y] = [newX, newY]`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: any[] };
      const stmt = block.statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.target.kind).toBe("ArrayLiteralExpr");
      expect(stmt.op).toBe("=");
      expect(stmt.value.kind).toBe("ArrayLiteralExpr");
    });
  });

  describe("Step 23: CSS Multi-Value Packs & Unit Deduplication", () => {
    it("parses token sheets with unit annotation and auto-appends default unit to numeric values", () => {
      const src = `style root_variables:
  tokens spacing[rem]:
    0: 0px, 1: 0.25, 2: 0.5, 3: 0.75, 4: 1.0
  tokens radius[px]: xs: 2, sm: 4, full: 9999px`;
      const mod = parse(src, "tokens.css.ail");
      const style = mod.items[0] as StyleDecl;
      expect(style.kind).toBe("StyleDecl");
      expect(style.properties).toHaveLength(8);

      expect(style.properties[0]).toMatchObject({ property: "--spacing-0", value: "0px" });
      expect(style.properties[1]).toMatchObject({ property: "--spacing-1", value: "0.25rem" });
      expect(style.properties[2]).toMatchObject({ property: "--spacing-2", value: "0.5rem" });
      expect(style.properties[3]).toMatchObject({ property: "--spacing-3", value: "0.75rem" });
      expect(style.properties[4]).toMatchObject({ property: "--spacing-4", value: "1.0rem" });

      expect(style.properties[5]).toMatchObject({ property: "--radius-xs", value: "2px" });
      expect(style.properties[6]).toMatchObject({ property: "--radius-sm", value: "4px" });
      expect(style.properties[7]).toMatchObject({ property: "--radius-full", value: "9999px" });
    });

    it("parses top-level single-line tokens with unit annotation: tokens spacing[rem]: 1: 0.25, 2: 0.5", () => {
      const src = `tokens spacing[rem]: 1: 0.25, 2: 0.5`;
      const mod = parse(src, "tokens.css.ail");
      const style = mod.items[0] as StyleDecl;
      expect(style.name).toBe(":root");
      expect(style.properties).toHaveLength(2);
      expect(style.properties[0]).toMatchObject({ property: "--spacing-1", value: "0.25rem" });
      expect(style.properties[1]).toMatchObject({ property: "--spacing-2", value: "0.5rem" });
    });

    it("parses layout macro properties (fl-row, fl-col, fl-center) with or without semicolons", () => {
      const src = `style box: fl-row; gap: 1rem
style col: fl-col
style center: fl-center; p: 1rem`;
      const mod = parse(src, "layout.css.ail");
      expect(mod.items).toHaveLength(3);

      const box = mod.items[0] as StyleDecl;
      expect(box.properties).toHaveLength(2);
      expect(box.properties[0]).toMatchObject({ property: "fl-row", value: "" });
      expect(box.properties[1]).toMatchObject({ property: "gap", value: "1rem" });

      const col = mod.items[1] as StyleDecl;
      expect(col.properties).toHaveLength(1);
      expect(col.properties[0]).toMatchObject({ property: "fl-col", value: "" });

      const center = mod.items[2] as StyleDecl;
      expect(center.properties).toHaveLength(2);
      expect(center.properties[0]).toMatchObject({ property: "fl-center", value: "" });
      expect(center.properties[1]).toMatchObject({ property: "p", value: "1rem" });
    });
  });

  describe("Error Handling", () => {
    it("throws ParserError on unexpected tokens with exact span", () => {
      const src = `fn incomplete(`;
      expect(() => parse(src, "err.ail")).toThrowError(ParserError);
    });
  });
});
