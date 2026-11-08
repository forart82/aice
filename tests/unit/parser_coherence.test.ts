import { describe, expect, it } from "vitest";
import type {
  Block,
  ClassDecl,
  ForStmt,
  FunctionDecl,
  LetBinding,
  MatchStmt,
  RecordLiteralExpr,
  TypeDecl,
  VarDecl,
} from "../../src/core/ast.js";
import { parse } from "../../src/core/parser.js";
import { TypeChecker } from "../../src/typechecker/checker.js";

describe("Parser Coherence & Grammar Resolution", () => {
  describe("Mission 1: 'nil' in Type Expressions", () => {
    it("parses standalone 'nil' in primitive type annotations", () => {
      const src = `val empty: nil = nil
fn doNothing() -> nil:
  ret nil`;
      const mod = parse(src, "nil_type.aice");
      expect(mod.items).toHaveLength(2);

      const v = mod.items[0] as VarDecl;
      expect(v.typeAnnotation).toMatchObject({
        kind: "PrimitiveType",
        primitive: "nil",
      });

      const fn = mod.items[1] as FunctionDecl;
      expect(fn.returnType).toMatchObject({
        kind: "PrimitiveType",
        primitive: "nil",
      });
    });

    it("parses 'nil' in union types (A | B | nil)", () => {
      const src = `type NullableResult = int | str | nil
type CustomUnion = ModelA | ModelB | nil
val x: str | nil = nil`;
      const mod = parse(src, "union_nil.aice");
      expect(mod.items).toHaveLength(3);

      const t1 = mod.items[0] as TypeDecl;
      expect(t1.aliasType).toMatchObject({
        kind: "NamedType",
        name: "int | str | nil",
      });

      const t2 = mod.items[1] as TypeDecl;
      expect(t2.aliasType).toMatchObject({
        kind: "NamedType",
        name: "ModelA | ModelB | nil",
      });

      const v = mod.items[2] as VarDecl;
      expect(v.typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "str | nil",
      });
    });

    it("parses 'nil' on the left side of union types (nil | A)", () => {
      const src = `type OrNil = nil | int | str`;
      const mod = parse(src, "nil_left.aice");
      const t = mod.items[0] as TypeDecl;
      expect(t.aliasType).toMatchObject({
        kind: "NamedType",
        name: "nil | int | str",
      });
    });
  });

  describe("Mission 2: Ellipsis '...' in Function Type Parameter Lists", () => {
    it("parses rest parameters in function types: (...args: number[]) => number", () => {
      const src = `type SumFn = (...args: [int]) => int
type Variadic = (...args: any) -> void`;
      const mod = parse(src, "fn_type_rest.aice");
      expect(mod.items).toHaveLength(2);

      const t1 = mod.items[0] as TypeDecl;
      expect(t1.aliasType).toMatchObject({
        kind: "NamedType",
        name: "(...args: [int]) => int",
      });

      const t2 = mod.items[1] as TypeDecl;
      expect(t2.aliasType).toMatchObject({
        kind: "NamedType",
        name: "(...args: any) => void",
      });
    });

    it("parses mixed function types with regular and rest parameters", () => {
      const src = `type Formatter = (prefix: str, ...items: [str]) => str`;
      const mod = parse(src, "mixed_fn_type.aice");
      const t = mod.items[0] as TypeDecl;
      expect(t.aliasType).toMatchObject({
        kind: "NamedType",
        name: "(prefix: str, ...items: [str]) => str",
      });
    });

    it("parses anonymous rest parameters without explicit parameter names (...[int]) => void", () => {
      const src = `type VoidVar = (...[int]) => void`;
      const mod = parse(src, "anon_rest.aice");
      const t = mod.items[0] as TypeDecl;
      expect(t.aliasType).toMatchObject({
        kind: "NamedType",
        name: "(...[int]) => void",
      });
    });
  });

  describe("Mission 3: Contextual Identifiers for Keywords", () => {
    it("parses 'val' as an identifier when followed by :=, =, or member access", () => {
      const src = `fn test():
  val := 42
  val = 99
  val.count = 100
  print(val.count)`;
      const mod = parse(src, "val_ident.aice");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as Block).statements;
      expect(stmts).toHaveLength(4);

      const letBinding = stmts[0] as LetBinding;
      expect(letBinding.kind).toBe("LetBinding");
      expect(letBinding.name).toBe("val");

      expect(stmts[1].kind).toBe("AssignStmt");
      expect(stmts[2].kind).toBe("AssignStmt");
    });

    it("parses keywords 'mut', 'type', 'pub', 'component', 'style', 'state' as identifiers", () => {
      const src = `fn testKeywords():
  mut := 1
  type := 2
  pub := 3
  component := 4
  style := 5
  state := 6
  let x = obj.pub + obj.val + obj.mut + obj.type + obj.component + obj.style + obj.state`;
      const mod = parse(src, "kw_idents.aice");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as Block).statements;
      expect(stmts).toHaveLength(7);

      expect((stmts[0] as LetBinding).name).toBe("mut");
      expect((stmts[1] as LetBinding).name).toBe("type");
      expect((stmts[2] as LetBinding).name).toBe("pub");
      expect((stmts[3] as LetBinding).name).toBe("component");
      expect((stmts[4] as LetBinding).name).toBe("style");
      expect((stmts[5] as LetBinding).name).toBe("state");

      const memberAccessLet = stmts[6] as LetBinding;
      expect(memberAccessLet.init).toBeDefined();
    });

    it("parses top-level 'val := ...', 'val: int := ...', and 'pub := ...'", () => {
      const src = `val := 10
pub := 20
type := 30
component := 40`;
      const mod = parse(src, "top_level_kw.aice");
      expect(mod.items).toHaveLength(4);
      expect((mod.items[0] as VarDecl).name).toBe("val");
      expect((mod.items[1] as VarDecl).name).toBe("pub");
      expect((mod.items[2] as VarDecl).name).toBe("type");
      expect((mod.items[3] as VarDecl).name).toBe("component");
    });
  });

  describe("Mission 4: Match Arm Flexible Syntax (=> and :)", () => {
    it("parses 'case <pattern> =>' with expression and statement bodies", () => {
      const src = `match x:
  case 1 => "one"
  case 2 => ret "two"
  case 3 =>
    ret "three"`;
      const mod = parse(src, "match_arrow.aice");
      const stmt = mod.items[0] as FunctionDecl; // top level wrapper
      const match = (stmt.body as Block).statements[0] as MatchStmt;
      expect(match.cases).toHaveLength(3);
      expect(match.cases[0].body.kind).toBe("LiteralExpr");
      expect(match.cases[1].body.kind).toBe("Block");
      expect(match.cases[2].body.kind).toBe("Block");
    });

    it("parses 'case <pattern>:' with same-line and indented bodies uniformly", () => {
      const src = `match x:
  case 1: "one"
  case 2: ret "two"
  case 3:
    ret "three"
  case 4:
    "four"`;
      const mod = parse(src, "match_colon.aice");
      const stmt = mod.items[0] as FunctionDecl;
      const match = (stmt.body as Block).statements[0] as MatchStmt;
      expect(match.cases).toHaveLength(4);
      expect(match.cases[0].body.kind).toBe("LiteralExpr");
      expect(match.cases[1].body.kind).toBe("Block");
      expect(match.cases[2].body.kind).toBe("Block");
      expect(match.cases[3].body.kind).toBe("Block");
    });

    it("parses match case with guards using either ':' or '=>'", () => {
      const src = `match n:
  case x if x > 0: ret x
  case x if x < 0 => ret -x
  case _: ret 0`;
      const mod = parse(src, "match_guards.aice");
      const stmt = mod.items[0] as FunctionDecl;
      const match = (stmt.body as Block).statements[0] as MatchStmt;
      expect(match.cases).toHaveLength(3);
      expect(match.cases[0].guard).toBeDefined();
      expect(match.cases[1].guard).toBeDefined();
    });
  });

  describe("Mission 5: Object & Tuple Destructuring in for Loops", () => {
    it("parses object destructuring in for loops: for { skill, effect } in getEffects():", () => {
      const src = `fn run():
  for { skill, effect } in getEffects():
    print(skill, effect)`;
      const mod = parse(src, "for_obj_destruct.aice");
      const fn = mod.items[0] as FunctionDecl;
      const forStmt = (fn.body as Block).statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("{ skill, effect }");
      expect(forStmt.iterable.kind).toBe("CallExpr");
    });

    it("parses object destructuring with aliases in for loops", () => {
      const src = `fn run():
  for { skill: s, effect: e } in getEffects():
    print(s, e)`;
      const mod = parse(src, "for_obj_alias.aice");
      const fn = mod.items[0] as FunctionDecl;
      const forStmt = (fn.body as Block).statements[0] as ForStmt;
      expect(forStmt.variable).toBe("{ skill: s, effect: e }");
    });

    it("parses tuple/array destructuring in for loops: for [k, v] in entries():", () => {
      const src = `fn run():
  for [k, v] in entries():
    print(k, v)`;
      const mod = parse(src, "for_tuple.aice");
      const fn = mod.items[0] as FunctionDecl;
      const forStmt = (fn.body as Block).statements[0] as ForStmt;
      expect(forStmt.kind).toBe("ForStmt");
      expect(forStmt.variable).toBe("[k, v]");
      expect(forStmt.iterable.kind).toBe("CallExpr");
    });

    it("parses tuple destructuring with parentheses: for (k, v) in entries():", () => {
      const src = `fn run():
  for (k, v) in entries():
    print(k, v)`;
      const mod = parse(src, "for_parens.aice");
      const fn = mod.items[0] as FunctionDecl;
      const forStmt = (fn.body as Block).statements[0] as ForStmt;
      expect(forStmt.variable).toBe("(k, v)");
    });
  });

  describe("Mission 6: Record Literal Property Keys", () => {
    it("allows any keyword as property key without error", () => {
      const src = `val config = {
  type: "config",
  val: 10,
  mut: 20,
  pub: 30,
  class: "A",
  fn: "noop",
  let: true,
  ret: false,
  default: "standard",
  in: "local",
  for: "loop",
  if: "cond",
  nil: nil
}`;
      const mod = parse(src, "record_keywords.aice");
      const v = mod.items[0] as VarDecl;
      const rec = v.value as RecordLiteralExpr;
      expect(rec.kind).toBe("RecordLiteralExpr");
      const keys = rec.properties.map((p) => p.key);
      expect(keys).toEqual([
        "type",
        "val",
        "mut",
        "pub",
        "class",
        "fn",
        "let",
        "ret",
        "default",
        "in",
        "for",
        "if",
        "nil",
      ]);
    });

    it("allows numeric literals as property keys in records", () => {
      const src = `val statusCodes = { 200: "OK", 404: "Not Found", 500: "Internal Server Error" }`;
      const mod = parse(src, "record_numbers.aice");
      const v = mod.items[0] as VarDecl;
      const rec = v.value as RecordLiteralExpr;
      expect(rec.properties.map((p) => p.key)).toEqual(["200", "404", "500"]);
    });

    it("allows computed property keys [expr] in record literals", () => {
      const src = `val dynamic = { [Symbol.iterator]: fn() = nil, [k]: v }`;
      const mod = parse(src, "record_computed.aice");
      const v = mod.items[0] as VarDecl;
      const rec = v.value as RecordLiteralExpr;
      expect(rec.properties.map((p) => p.key)).toEqual(["[Symbol.iterator]", "[k]"]);
    });

    it("allows shorthand record properties with contextual keywords", () => {
      const src = `fn makeObj(val: int, mut: str, pub: bool, style: str):
  ret { val, mut, pub, style }`;
      const mod = parse(src, "record_shorthand.aice");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
    });
  });

  describe("Mission 7: Rest Parameters in Primary Constructors & Typechecking", () => {
    it("parses primary constructor rest parameter with ellipsis", () => {
      const src = `class Logger(pub prefix: str, ...tags: [str]):
  pass`;
      const mod = parse(src, "primary_ctor_rest.aice");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.primaryConstructor).toBeDefined();
      expect(cls.primaryConstructor).toHaveLength(2);
      expect(cls.primaryConstructor![0].name).toBe("prefix");
      expect(cls.primaryConstructor![0].isRest).toBeUndefined();
      expect(cls.primaryConstructor![1].name).toBe("tags");
      expect(cls.primaryConstructor![1].isRest).toBe(true);
    });

    it("typechecks invocations with rest parameters accepting multiple trailing arguments", () => {
      const src = `fn log(prefix: str, ...tags: [str]) -> str:
  ret prefix

fn run():
  log("info", "a", "b", "c")`;
      const mod = parse(src, "rest_multi.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("typechecks invocations with rest parameters accepting a direct array argument", () => {
      const src = `fn log(prefix: str, ...tags: [str]) -> str:
  ret prefix

fn run():
  log("info", ["a", "b"])`;
      const mod = parse(src, "rest_direct_array.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("typechecks class primary constructor with rest parameters", () => {
      const src = `class Emitter(name: str, ...events: [str]):
  pass

fn run():
  Emitter("main", "click", "hover")`;
      const mod = parse(src, "class_rest_ctor.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });

    it("rejects mismatched argument types for rest parameters", () => {
      const src = `fn log(prefix: str, ...tags: [str]) -> str:
  ret prefix

fn run():
  log("info", 123)`;
      const mod = parse(src, "rest_mismatch.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).toThrow();
    });

    it("typechecks destructured method parameters with inline defaults", () => {
      const src = `class Handler:
  fn handle({ a = 1, b: localB = 2 }: { a: int, b: int }):
    ret a + localB`;
      const mod = parse(src, "method_destructure_default.aice");
      const tc = new TypeChecker();
      expect(() => tc.checkModule(mod)).not.toThrow();
    });
  });
});
