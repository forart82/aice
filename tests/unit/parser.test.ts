import { describe, expect, it } from "vitest";
import type {
  ArrayLiteralExpr,
  ArrayType,
  AwaitExpr,
  BinaryExpr,
  Block,
  BreakStmt,
  CallExpr,
  ClassDecl,
  ClosureExpr,
  ComponentDecl,
  ConstDecl,
  ContinueStmt,
  DestructureBinding,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  LetBinding,
  LiteralExpr,
  MatchStmt,
  MemberAccessExpr,
  NamedType,
  PostfixTryExpr,
  PrimitiveType,
  RecordLiteralExpr,
  RecordType,
  RefinementType,
  StyleDecl,
  TemplateLiteralExpr,
  ThrowStmt,
  TryStmt,
  TupleType,
  TypeDecl,
  UnaryExpr,
  VarDecl,
} from "../../src/core/ast.js";
import { ParserError, parse, parseWithTrivia } from "../../src/core/parser.js";

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

    it("parses qualified dotted type identifiers in params, return types, class properties, and type arguments", () => {
      const src = `class SceneRenderer:
  scene: THREE.Scene
  camera: THREE.OrthographicCamera
  meshes: Map[str, THREE.Vector3] = Map()
  materials: [THREE.MeshBasicMaterial] = []
  activeMaterial: THREE.ShaderMaterial? = nil

  fn render(target: THREE.WebGLRenderer, options: React.FC[Props]) -> THREE.Group:
    ret THREE.Group()`;

      const mod = parse(src, "renderer.ail");
      expect(mod.items).toHaveLength(1);
      const cls = mod.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.name).toBe("SceneRenderer");

      // Class properties
      expect(cls.properties).toHaveLength(5);
      expect(cls.properties[0].name).toBe("scene");
      expect(cls.properties[0].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "THREE.Scene",
      });
      expect(cls.properties[1].name).toBe("camera");
      expect(cls.properties[1].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "THREE.OrthographicCamera",
      });

      // Type arguments: Map[str, THREE.Vector3]
      expect(cls.properties[2].name).toBe("meshes");
      expect(cls.properties[2].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "Map",
        typeArgs: [
          { kind: "PrimitiveType", primitive: "str" },
          { kind: "NamedType", name: "THREE.Vector3" },
        ],
      });

      // Array of dotted types: [THREE.MeshBasicMaterial]
      expect(cls.properties[3].name).toBe("materials");
      expect(cls.properties[3].typeAnnotation).toMatchObject({
        kind: "ArrayType",
        elementType: {
          kind: "NamedType",
          name: "THREE.MeshBasicMaterial",
        },
      });

      // Postfix ? option with dotted type: THREE.ShaderMaterial?
      expect(cls.properties[4].name).toBe("activeMaterial");
      expect(cls.properties[4].typeAnnotation).toMatchObject({
        kind: "OptionType",
        innerType: {
          kind: "NamedType",
          name: "THREE.ShaderMaterial",
        },
      });

      // Function params and return type
      expect(cls.methods).toHaveLength(1);
      const fn = cls.methods[0];
      expect(fn.name).toBe("render");
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0].name).toBe("target");
      expect(fn.params[0].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "THREE.WebGLRenderer",
      });
      expect(fn.params[1].name).toBe("options");
      expect(fn.params[1].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "React.FC",
        typeArgs: [{ kind: "NamedType", name: "Props" }],
      });
      expect(fn.returnType).toMatchObject({
        kind: "NamedType",
        name: "THREE.Group",
      });
    });

    it("correctly calculates source span for dotted types and type arguments", () => {
      const src = `type T: item: NodeJS.ReadableStream[Buffer]`;
      const mod = parse(src, "stream.ail");
      const td = mod.items[0] as TypeDecl;
      const typeAnn = td.fields![0].typeAnnotation as NamedType;
      expect(typeAnn.kind).toBe("NamedType");
      expect(typeAnn.name).toBe("NodeJS.ReadableStream");
      expect(typeAnn.span.start.column).toBe(15);
      expect(typeAnn.span.end.column).toBe(44);
    });

    it("throws ParserError on trailing dot in dotted type expression", () => {
      const src = `type T: item: THREE.`;
      expect(() => parse(src, "err.ail")).toThrowError(ParserError);
    });

    it("parses tuple types [str, int], [float, float, float], and nested [int, [str, bool]]", () => {
      const src = `type Coordinates:
  pair: [str, int]
  vector: [float, float, float]
  nested: [int, [str, bool]]
  single: [int,]
  empty: []
  array: [int]`;

      const mod = parse(src, "tuples.ail");
      expect(mod.items).toHaveLength(1);
      const td = mod.items[0] as TypeDecl;
      expect(td.fields).toHaveLength(6);

      // pair: [str, int]
      const pair = td.fields![0].typeAnnotation as TupleType;
      expect(pair.kind).toBe("TupleType");
      expect(pair.elementTypes).toHaveLength(2);
      expect(pair.elementTypes[0]).toMatchObject({ kind: "PrimitiveType", primitive: "str" });
      expect(pair.elementTypes[1]).toMatchObject({ kind: "PrimitiveType", primitive: "int" });

      // vector: [float, float, float]
      const vec = td.fields![1].typeAnnotation as TupleType;
      expect(vec.kind).toBe("TupleType");
      expect(vec.elementTypes).toHaveLength(3);
      expect(
        vec.elementTypes.every(
          (e) => e.kind === "PrimitiveType" && (e as any).primitive === "float",
        ),
      ).toBe(true);

      // nested: [int, [str, bool]]
      const nested = td.fields![2].typeAnnotation as TupleType;
      expect(nested.kind).toBe("TupleType");
      expect(nested.elementTypes).toHaveLength(2);
      expect(nested.elementTypes[0]).toMatchObject({ kind: "PrimitiveType", primitive: "int" });
      const innerTuple = nested.elementTypes[1] as TupleType;
      expect(innerTuple.kind).toBe("TupleType");
      expect(innerTuple.elementTypes).toHaveLength(2);
      expect(innerTuple.elementTypes[0]).toMatchObject({ kind: "PrimitiveType", primitive: "str" });
      expect(innerTuple.elementTypes[1]).toMatchObject({
        kind: "PrimitiveType",
        primitive: "bool",
      });

      // single: [int,]
      const single = td.fields![3].typeAnnotation as TupleType;
      expect(single.kind).toBe("TupleType");
      expect(single.elementTypes).toHaveLength(1);
      expect(single.elementTypes[0]).toMatchObject({ kind: "PrimitiveType", primitive: "int" });

      // empty: []
      const empty = td.fields![4].typeAnnotation as TupleType;
      expect(empty.kind).toBe("TupleType");
      expect(empty.elementTypes).toHaveLength(0);

      // array: [int] (must remain ArrayType, not TupleType)
      const array = td.fields![5].typeAnnotation as ArrayType;
      expect(array.kind).toBe("ArrayType");
      expect(array.elementType).toMatchObject({ kind: "PrimitiveType", primitive: "int" });
    });

    it("parses tuple type in function signatures with return types", () => {
      const src = `fn swap(pair: [int, str]) -> [str, int]:
  ret [pair[1], pair[0]]`;

      const mod = parse(src, "fn_tuple.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params[0].typeAnnotation).toMatchObject({
        kind: "TupleType",
        elementTypes: [
          { kind: "PrimitiveType", primitive: "int" },
          { kind: "PrimitiveType", primitive: "str" },
        ],
      });
      expect(fn.returnType).toMatchObject({
        kind: "TupleType",
        elementTypes: [
          { kind: "PrimitiveType", primitive: "str" },
          { kind: "PrimitiveType", primitive: "int" },
        ],
      });
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

    it("Step 8: parses all binary power, bitwise, and shift operators individually", () => {
      const ops = ["**", "&", "|", "^", "<<", ">>", ">>>"];
      for (const op of ops) {
        const src = `fn opTest(a:int, b:int) = a ${op} b`;
        const mod = parse(src);
        const fn = mod.items[0] as FunctionDecl;
        const expr = fn.body as BinaryExpr;
        expect(expr.kind).toBe("BinaryExpr");
        expect(expr.operator).toBe(op);
        expect((expr.left as IdentifierExpr).name).toBe("a");
        expect((expr.right as IdentifierExpr).name).toBe("b");
      }
    });

    it("Step 8: respects right-associativity and precedence for power operator (**)", () => {
      // 2 ** 3 ** 2 should parse as 2 ** (3 ** 2)
      const src1 = `fn pow1() = 2 ** 3 ** 2`;
      const mod1 = parse(src1);
      const fn1 = mod1.items[0] as FunctionDecl;
      const expr1 = fn1.body as BinaryExpr;
      expect(expr1.operator).toBe("**");
      expect((expr1.left as LiteralExpr).value).toBe(2);
      expect((expr1.right as BinaryExpr).operator).toBe("**");

      // 2 * 3 ** 4 should parse as 2 * (3 ** 4)
      const src2 = `fn pow2() = 2 * 3 ** 4`;
      const mod2 = parse(src2);
      const fn2 = mod2.items[0] as FunctionDecl;
      const expr2 = fn2.body as BinaryExpr;
      expect(expr2.operator).toBe("*");
      expect((expr2.right as BinaryExpr).operator).toBe("**");
    });

    it("Step 8: respects precedence hierarchy for shift and bitwise operators", () => {
      // a + b << c should parse as (a + b) << c because SUM > SHIFT
      const src1 = `fn shiftTest(a:int, b:int, c:int) = a + b << c`;
      const mod1 = parse(src1);
      const fn1 = mod1.items[0] as FunctionDecl;
      const expr1 = fn1.body as BinaryExpr;
      expect(expr1.operator).toBe("<<");
      expect((expr1.left as BinaryExpr).operator).toBe("+");

      // a | b ^ c & d should parse as a | (b ^ (c & d)) because BIT_AND > BIT_XOR > BIT_OR
      const src2 = `fn bitTest(a:int, b:int, c:int, d:int) = a | b ^ c & d`;
      const mod2 = parse(src2);
      const fn2 = mod2.items[0] as FunctionDecl;
      const expr2 = fn2.body as BinaryExpr;
      expect(expr2.operator).toBe("|");
      const xorExpr = expr2.right as BinaryExpr;
      expect(xorExpr.operator).toBe("^");
      expect((xorExpr.right as BinaryExpr).operator).toBe("&");

      // a << b == c should parse as (a << b) == c because SHIFT > EQUALS
      const src3 = `fn cmpTest(a:int, b:int, c:int) = a << b == c`;
      const mod3 = parse(src3);
      const fn3 = mod3.items[0] as FunctionDecl;
      const expr3 = fn3.body as BinaryExpr;
      expect(expr3.operator).toBe("==");
      expect((expr3.left as BinaryExpr).operator).toBe("<<");
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

    it('parses mutable keywordless binding y ::= "mutable"', () => {
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

    it('parses typed mutable keywordless binding w: string ::= "mut_typed"', () => {
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

    it("parses number literal types and union literal types", () => {
      const src = `type VersionMeta:
  version: 2
  tier: 1 | 2 | 3`;
      const mod = parse(src, "meta.ail");
      expect(mod.items).toHaveLength(1);
      const td = mod.items[0] as TypeDecl;
      expect(td.fields).toBeDefined();
      expect(td.fields).toHaveLength(2);
      expect(td.fields![0].name).toBe("version");
      expect(td.fields![0].typeAnnotation).toMatchObject({ kind: "NamedType", name: "2" });
      expect(td.fields![1].name).toBe("tier");
      expect(td.fields![1].typeAnnotation).toMatchObject({ kind: "NamedType", name: "1 | 2 | 3" });
    });

    it("parses computed method and accessor names like [Symbol.iterator]", () => {
      const src = `class IterableContainer:
  fn [Symbol.iterator]() -> Iterator[int] = this.items[Symbol.iterator]()`;
      const mod = parse(src, "iter.ail");
      expect(mod.items).toHaveLength(1);
      const cls = mod.items[0] as ClassDecl;
      expect(cls.methods).toHaveLength(1);
      expect(cls.methods[0].name).toBe("[Symbol.iterator]");
    });

    it("parses postfix ? OptionType concisely", () => {
      const src = `x: int? := nil
name: str? := nil`;
      const mod = parse(src, "opts.ail");
      expect(mod.items).toHaveLength(2);
      const v1 = mod.items[0] as VarDecl;
      expect(v1.typeAnnotation).toMatchObject({
        kind: "OptionType",
        innerType: { kind: "PrimitiveType", primitive: "int" },
      });
      const v2 = mod.items[1] as VarDecl;
      expect(v2.typeAnnotation).toMatchObject({
        kind: "OptionType",
        innerType: { kind: "PrimitiveType", primitive: "str" },
      });
    });
  });

  describe("Step 3: Call-Site Argument Spread Operator (...)", () => {
    it("parses single spread argument in function calls: fn(...args)", () => {
      const src = `fn run():
  target(...args)`;
      const mod = parse(src, "spread1.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body).toBeDefined();
      if (fn.body.kind === "Block") {
        const stmt = fn.body.statements[0];
        expect(stmt.kind).toBe("ExprStmt");
        if (stmt.kind === "ExprStmt") {
          const call = stmt.expr as CallExpr;
          expect(call.kind).toBe("CallExpr");
          expect(call.args).toHaveLength(1);
          const spreadArg = call.args[0] as UnaryExpr;
          expect(spreadArg.kind).toBe("UnaryExpr");
          expect(spreadArg.operator).toBe("...");
          expect(spreadArg.operand).toMatchObject({
            kind: "IdentifierExpr",
            name: "args",
          });
        }
      }
    });

    it("parses mixed positional and spread arguments: calculate(x, y, ...extra)", () => {
      const src = `fn run():
  calculate(x, y, ...extra)`;
      const mod = parse(src, "spread2.ail");
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const stmt = fn.body.statements[0];
        if (stmt.kind === "ExprStmt") {
          const call = stmt.expr as CallExpr;
          expect(call.kind).toBe("CallExpr");
          expect(call.args).toHaveLength(3);
          expect(call.args[0]).toMatchObject({ kind: "IdentifierExpr", name: "x" });
          expect(call.args[1]).toMatchObject({ kind: "IdentifierExpr", name: "y" });
          expect(call.args[2]).toMatchObject({
            kind: "UnaryExpr",
            operator: "...",
            operand: { kind: "IdentifierExpr", name: "extra" },
          });
        }
      }
    });

    it("parses spread arguments in member call expressions: Math.max(...nums)", () => {
      const src = `fn run():
  Math.max(...nums)`;
      const mod = parse(src, "spread3.ail");
      const fn = mod.items[0] as FunctionDecl;
      if (fn.body.kind === "Block") {
        const stmt = fn.body.statements[0];
        if (stmt.kind === "ExprStmt") {
          const call = stmt.expr as CallExpr;
          expect(call.kind).toBe("CallExpr");
          expect(call.callee).toMatchObject({
            kind: "MemberAccessExpr",
            object: { kind: "IdentifierExpr", name: "Math" },
            property: "max",
          });
          expect(call.args).toHaveLength(1);
          expect(call.args[0]).toMatchObject({
            kind: "UnaryExpr",
            operator: "...",
            operand: { kind: "IdentifierExpr", name: "nums" },
          });
        }
      }
    });

    it("parses multiple spread elements in array literals: [...items, ...more]", () => {
      const src = `combined := [...items, ...more]`;
      const mod = parse(src, "spread4.ail");
      expect(mod.items).toHaveLength(1);
      const decl = mod.items[0] as VarDecl;
      expect(decl.value).toBeDefined();
      const arr = decl.value as ArrayLiteralExpr;
      expect(arr.kind).toBe("ArrayLiteralExpr");
      expect(arr.elements).toHaveLength(2);
      expect(arr.elements[0]).toMatchObject({
        kind: "UnaryExpr",
        operator: "...",
        operand: { kind: "IdentifierExpr", name: "items" },
      });
      expect(arr.elements[1]).toMatchObject({
        kind: "UnaryExpr",
        operator: "...",
        operand: { kind: "IdentifierExpr", name: "more" },
      });
    });
  });

  describe("Step 4: Negative Numeric Literals in Type Unions", () => {
    it("parses negative numbers in type unions (1 | -1, -1 | 0 | 1)", () => {
      const src = `type Direction = 1 | -1
type Ternary = -1 | 0 | 1`;
      const mod = parse(src, "dir.ail");
      expect(mod.items).toHaveLength(2);
      const d1 = mod.items[0] as TypeDecl;
      expect(d1.aliasType).toMatchObject({ kind: "NamedType", name: "1 | -1" });
      const d2 = mod.items[1] as TypeDecl;
      expect(d2.aliasType).toMatchObject({ kind: "NamedType", name: "-1 | 0 | 1" });
    });

    it("parses function return types with negative numeric literal unions (-> 1 | -1)", () => {
      const src = `fn getDirection() -> 1 | -1:
  ret -1`;
      const mod = parse(src, "fn_ret.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.returnType).toMatchObject({ kind: "NamedType", name: "1 | -1" });
    });

    it("parses function parameter types with negative numeric literals (dir: 1 | -1)", () => {
      const src = `fn step(dir: 1 | -1) -> int:
  ret dir`;
      const mod = parse(src, "fn_param.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params[0].typeAnnotation).toMatchObject({ kind: "NamedType", name: "1 | -1" });
    });

    it("parses variable declarations with negative numeric literal union types", () => {
      const src = `val dir: 1 | -1 = -1`;
      const mod = parse(src, "var.ail");
      expect(mod.items).toHaveLength(1);
      const v = mod.items[0] as VarDecl;
      expect(v.typeAnnotation).toMatchObject({ kind: "NamedType", name: "1 | -1" });
    });
  });

  describe("Step 5: Boolean Literal Types (: true, : false, true | false)", () => {
    it("parses variable declarations with boolean literal types (: true, : false)", () => {
      const src = `val enabled: true = true
val disabled: false = false`;
      const mod = parse(src, "bool_vars.ail");
      expect(mod.items).toHaveLength(2);
      const v1 = mod.items[0] as VarDecl;
      expect(v1.typeAnnotation).toMatchObject({ kind: "NamedType", name: "true" });
      const v2 = mod.items[1] as VarDecl;
      expect(v2.typeAnnotation).toMatchObject({ kind: "NamedType", name: "false" });
    });

    it("parses type aliases with boolean literal types and unions (true | false, false | true)", () => {
      const src = `type Flag = true | false
type AlwaysTrue = true
type InvertedFlag = false | true`;
      const mod = parse(src, "bool_types.ail");
      expect(mod.items).toHaveLength(3);
      const t1 = mod.items[0] as TypeDecl;
      expect(t1.aliasType).toMatchObject({ kind: "NamedType", name: "true | false" });
      const t2 = mod.items[1] as TypeDecl;
      expect(t2.aliasType).toMatchObject({ kind: "NamedType", name: "true" });
      const t3 = mod.items[2] as TypeDecl;
      expect(t3.aliasType).toMatchObject({ kind: "NamedType", name: "false | true" });
    });

    it("parses function signatures with boolean literal return and parameter types", () => {
      const src = `fn isReady(strict: true) -> true:
  ret true

fn isOff(flag: false) -> false:
  ret false

fn getFlag() -> true | false:
  ret true`;
      const mod = parse(src, "bool_funcs.ail");
      expect(mod.items).toHaveLength(3);
      const fn1 = mod.items[0] as FunctionDecl;
      expect(fn1.returnType).toMatchObject({ kind: "NamedType", name: "true" });
      expect(fn1.params[0].typeAnnotation).toMatchObject({ kind: "NamedType", name: "true" });

      const fn2 = mod.items[1] as FunctionDecl;
      expect(fn2.returnType).toMatchObject({ kind: "NamedType", name: "false" });
      expect(fn2.params[0].typeAnnotation).toMatchObject({ kind: "NamedType", name: "false" });

      const fn3 = mod.items[2] as FunctionDecl;
      expect(fn3.returnType).toMatchObject({ kind: "NamedType", name: "true | false" });
    });

    it("parses record type fields with boolean literal types (success: true, active: false)", () => {
      const src = `type Response = { success: true, active: false }`;
      const mod = parse(src, "bool_record.ail");
      expect(mod.items).toHaveLength(1);
      const td = mod.items[0] as TypeDecl;
      expect(td.aliasType?.kind).toBe("RecordType");
      const rec = td.aliasType as RecordType;
      expect(rec.fields).toHaveLength(2);
      expect(rec.fields[0].name).toBe("success");
      expect(rec.fields[0].type).toMatchObject({ kind: "NamedType", name: "true" });
      expect(rec.fields[1].name).toBe("active");
      expect(rec.fields[1].type).toMatchObject({ kind: "NamedType", name: "false" });
    });

    it("parses struct declarations with boolean literal field types", () => {
      const src = `type StatusReport:
  ready: true
  failed: false
  flag: true | false`;
      const mod = parse(src, "bool_struct.ail");
      expect(mod.items).toHaveLength(1);
      const td = mod.items[0] as TypeDecl;
      expect(td.fields).toHaveLength(3);
      expect(td.fields![0].name).toBe("ready");
      expect(td.fields![0].typeAnnotation).toMatchObject({ kind: "NamedType", name: "true" });
      expect(td.fields![1].name).toBe("failed");
      expect(td.fields![1].typeAnnotation).toMatchObject({ kind: "NamedType", name: "false" });
      expect(td.fields![2].name).toBe("flag");
      expect(td.fields![2].typeAnnotation).toMatchObject({
        kind: "NamedType",
        name: "true | false",
      });
    });
  });

  describe("Step 6: Contextual Keyword Identifiers", () => {
    it("parses contextual keywords in import specifiers", () => {
      const src = `from "ui/theme" import style, tokens, match, type
import { style, tokens, match, type, val, char, state, mut, from, prop } from "lib"
import { style as customStyle } from "styles"`;
      const mod = parse(src, "imports.ail");
      expect(mod.items).toHaveLength(3);
      const imp1 = mod.items[0] as ImportDecl;
      expect(imp1.specifiers.map((s) => s.name)).toEqual(["style", "tokens", "match", "type"]);
      const imp2 = mod.items[1] as ImportDecl;
      expect(imp2.specifiers.map((s) => s.name)).toEqual([
        "style",
        "tokens",
        "match",
        "type",
        "val",
        "char",
        "state",
        "mut",
        "from",
        "prop",
      ]);
      const imp3 = mod.items[2] as ImportDecl;
      expect(imp3.specifiers[0].name).toBe("style");
      expect(imp3.specifiers[0].alias).toBe("customStyle");
    });

    it("parses contextual keywords as function and method names", () => {
      const src = `fn style():
  ret 1

fn match():
  ret 2

class Widget:
  fn style() -> int:
    ret 3
  fn match() -> int:
    ret 4`;
      const mod = parse(src, "fn_names.ail");
      expect(mod.items).toHaveLength(3);
      expect((mod.items[0] as FunctionDecl).name).toBe("style");
      expect((mod.items[1] as FunctionDecl).name).toBe("match");
      const cls = mod.items[2] as ClassDecl;
      expect(cls.methods[0].name).toBe("style");
      expect(cls.methods[1].name).toBe("match");
    });

    it("parses contextual keywords as parameter names", () => {
      const src = `fn configure(style: str, match: bool, type: int, val: num, char: byte, state: str, mut: bool, from: str, prop: str) -> bool:
  ret match`;
      const mod = parse(src, "params.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params.map((p) => p.name)).toEqual([
        "style",
        "match",
        "type",
        "val",
        "char",
        "state",
        "mut",
        "from",
        "prop",
      ]);
    });

    it("parses contextual keywords in variable and constant declarations", () => {
      const src = `pub let style = 1
val tokens = 2
const match = 3
pub let mut state = "idle"
pub let mut = 4
type := 5
char ::= 6
fn test():
  let style = 10
  val tokens = 20
  const match = 30
  let mut = 40
  match := 50`;
      const mod = parse(src, "vars.ail");
      expect(mod.items).toHaveLength(8);
      expect((mod.items[0] as VarDecl).name).toBe("style");
      expect((mod.items[1] as VarDecl).name).toBe("tokens");
      expect((mod.items[2] as ConstDecl).name).toBe("match");
      expect((mod.items[3] as VarDecl).name).toBe("state");
      expect((mod.items[3] as VarDecl).isMut).toBe(true);
      expect((mod.items[4] as VarDecl).name).toBe("mut");
      expect((mod.items[4] as VarDecl).isMut).toBe(false);
      expect((mod.items[5] as VarDecl).name).toBe("type");
      expect((mod.items[6] as VarDecl).name).toBe("char");
    });

    it("parses contextual keywords in type definitions and record types", () => {
      const src = `type Config:
  style: str
  tokens: int
  match: bool
  type: str
  val: num
  state: str

type Options = { style: str, tokens: int, match: bool, type: str }`;
      const mod = parse(src, "types.ail");
      const td1 = mod.items[0] as TypeDecl;
      expect(td1.name).toBe("Config");
      expect(td1.fields?.map((f) => f.name)).toEqual([
        "style",
        "tokens",
        "match",
        "type",
        "val",
        "state",
      ]);
      const td2 = mod.items[1] as TypeDecl;
      expect(td2.name).toBe("Options");
      const rec = td2.aliasType as RecordType;
      expect(rec.fields.map((f) => f.name)).toEqual(["style", "tokens", "match", "type"]);
    });

    it("parses contextual keywords in record literals", () => {
      const src = `val theme = { style: "dark", tokens: 10, type: "primary", match: true, val: 42, char: 65 }`;
      const mod = parse(src, "rec_lit.ail");
      const decl = mod.items[0] as VarDecl;
      const rec = decl.value as RecordLiteralExpr;
      expect(rec.properties.map((p) => p.key)).toEqual([
        "style",
        "tokens",
        "type",
        "match",
        "val",
        "char",
      ]);
    });

    it("parses contextual keywords in member access expressions", () => {
      const src = `fn inspect(obj: any):
  let s = obj.style
  let t = obj.tokens
  let m = obj.match
  let ty = obj.type
  let v = obj.val
  let c = obj.char
  let st = obj.state`;
      const mod = parse(src, "member_access.ail");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as Block).statements as LetBinding[];
      expect((stmts[0].init as MemberAccessExpr).property).toBe("style");
      expect((stmts[1].init as MemberAccessExpr).property).toBe("tokens");
      expect((stmts[2].init as MemberAccessExpr).property).toBe("match");
      expect((stmts[3].init as MemberAccessExpr).property).toBe("type");
      expect((stmts[4].init as MemberAccessExpr).property).toBe("val");
      expect((stmts[5].init as MemberAccessExpr).property).toBe("char");
      expect((stmts[6].init as MemberAccessExpr).property).toBe("state");
    });

    it("parses contextual keywords in pattern matching", () => {
      const src = `fn handle(val: any) -> str:
  match val:
    case style => "bound style"
    case match => "bound match"
    case tokens => "bound tokens"
    case State(tokens) => "constructor pattern"
    case _ => "default"`;
      const mod = parse(src, "patterns.ail");
      const fn = mod.items[0] as FunctionDecl;
      const matchStmt = (fn.body as Block).statements[0] as MatchStmt;
      expect(matchStmt.cases[0].pattern).toMatchObject({
        kind: "IdentifierPattern",
        name: "style",
      });
      expect(matchStmt.cases[1].pattern).toMatchObject({
        kind: "IdentifierPattern",
        name: "match",
      });
      expect(matchStmt.cases[2].pattern).toMatchObject({
        kind: "IdentifierPattern",
        name: "tokens",
      });
      expect(matchStmt.cases[3].pattern).toMatchObject({
        kind: "ConstructorPattern",
        name: "State",
        subPatterns: [{ kind: "IdentifierPattern", name: "tokens" }],
      });
    });

    it("parses contextual keywords in expression positions (parsePrefix)", () => {
      const src = `fn compute(style: int, tokens: int, match: int, val: int) -> int:
  ret style + tokens * match - val`;
      const mod = parse(src, "exprs.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("Block");
    });

    it("parses contextual keywords in for-in loop variable position", () => {
      const src = `fn iterate(styles: [str]):
  for style in styles:
    print(style)
  for match in styles:
    print(match)`;
      const mod = parse(src, "for_loops.ail");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as Block).statements as ForStmt[];
      expect(stmts[0].variable).toBe("style");
      expect(stmts[1].variable).toBe("match");
    });
  });

  describe("Step 7: Closure Parameter Pattern Destructuring & Elisions", () => {
    it("parses unannotated closure with array destructuring parameter fn([a, b])", () => {
      const src = `fn test():
  let add = fn([a, b]) = a + b`;
      const mod = parse(src, "closure_array.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      expect(letStmt.kind).toBe("LetBinding");
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params).toHaveLength(1);
      expect(closure.params[0].name).toBe("[a, b]");
      expect(closure.params[0].typeAnnotation).toBeNull();
    });

    it("parses typed closure with array destructuring parameter fn([a, b]: [int, int])", () => {
      const src = `fn test():
  let add = fn([a, b]: [int, int]) -> int = a + b`;
      const mod = parse(src, "closure_typed_array.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params[0].name).toBe("[a, b]");
      expect(closure.params[0].typeAnnotation?.kind).toBe("TupleType");
      expect(closure.returnType?.kind).toBe("PrimitiveType");
    });

    it("parses closure with record destructuring parameter fn({ effect })", () => {
      const src = `fn test():
  let handler = fn({ effect }) = effect`;
      const mod = parse(src, "closure_record.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params[0].name).toBe("{ effect }");
      expect(closure.params[0].typeAnnotation).toBeNull();
    });

    it("parses closure with typed record destructuring parameter fn({ effect, target }: State)", () => {
      const src = `fn test():
  let handler = fn({ effect, target }: State) = effect`;
      const mod = parse(src, "closure_typed_record.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params[0].name).toBe("{ effect, target }");
      expect(closure.params[0].typeAnnotation?.kind).toBe("NamedType");
    });

    it("parses for-in loop with leading comma and elisions for [, x] in list:", () => {
      const src = `fn iterate(pairs: [[int, int]]):
  for [, x] in pairs:
    print(x)
  for [a, , b] in pairs:
    print(a)`;
      const mod = parse(src, "for_elisions.ail");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as { kind: "Block"; statements: ForStmt[] }).statements;
      expect(stmts[0].variable).toBe("[, x]");
      expect(stmts[1].variable).toBe("[a, , b]");
    });

    it("parses let binding with elision destructuring let [, y] = pair", () => {
      const src = `fn test():
  let [, y] = pair
  let [a, , b] = triple
  [, b] = pair`;
      const mod = parse(src, "let_destructure_elision.ail");
      const fn = mod.items[0] as FunctionDecl;
      const stmts = (fn.body as { kind: "Block"; statements: DestructureBinding[] }).statements;
      expect(stmts[0].kind).toBe("DestructureBinding");
      expect(stmts[0].names).toEqual(["", "y"]);
      expect(stmts[0].isMut).toBe(false);

      expect(stmts[1].kind).toBe("DestructureBinding");
      expect(stmts[1].names).toEqual(["a", "", "b"]);

      expect(stmts[2].kind).toBe("DestructureBinding");
      expect(stmts[2].names).toEqual(["", "b"]);
    });

    it("parses function declaration with destructured parameter fn process([a, b]: [int, int])", () => {
      const src = `fn process([a, b]: [int, int]) -> int = a + b`;
      const mod = parse(src, "fn_destructure.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params[0].name).toBe("[a, b]");
      expect(fn.params[0].typeAnnotation?.kind).toBe("TupleType");
    });
  });

  describe("Step 10: Lowering of await Expression", () => {
    it("parses await fetch()", () => {
      const src = `fn getData():
  let res = await fetch()`;
      const mod = parse(src, "await_fetch.ail");
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.init.kind).toBe("AwaitExpr");
      const awaitExpr = stmt.init as AwaitExpr;
      expect(awaitExpr.operand.kind).toBe("CallExpr");
      const call = awaitExpr.operand as CallExpr;
      expect(call.callee.kind).toBe("IdentifierExpr");
      expect((call.callee as IdentifierExpr).name).toBe("fetch");
      expect(call.args).toHaveLength(0);
    });

    it("parses await p", () => {
      const src = `fn resolve(p: Promise[int]):
  let val = await p`;
      const mod = parse(src, "await_p.ail");
      const fn = mod.items[0] as FunctionDecl;
      const block = fn.body as { kind: "Block"; statements: LetBinding[] };
      const stmt = block.statements[0];
      expect(stmt.init.kind).toBe("AwaitExpr");
      const awaitExpr = stmt.init as AwaitExpr;
      expect(awaitExpr.operand.kind).toBe("IdentifierExpr");
      expect((awaitExpr.operand as IdentifierExpr).name).toBe("p");
    });
  });

  describe("Step 12: Multiline Block Closures Parsing", () => {
    it("parses block closure with curly braces and multiple statements", () => {
      const src = `fn test():
  let f = fn(x: int) {
    let y = x * 2
    ret y
  }`;
      const mod = parse(src, "closure_braces.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params).toHaveLength(1);
      expect(closure.params[0].name).toBe("x");
      expect(closure.body.kind).toBe("Block");
      const block = closure.body as Block;
      expect(block.statements).toHaveLength(2);
      expect(block.statements[0].kind).toBe("LetBinding");
      expect(block.statements[1].kind).toBe("ReturnStmt");
    });

    it("parses block closure with colon and indentation", () => {
      const src = `fn test():
  let f = fn(x: int):
    let y = x * 2
    ret y`;
      const mod = parse(src, "closure_colon.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.body.kind).toBe("Block");
      const block = closure.body as Block;
      expect(block.statements).toHaveLength(2);
      expect(block.statements[0].kind).toBe("LetBinding");
      expect(block.statements[1].kind).toBe("ReturnStmt");
    });

    it("parses block closure with colon and curly braces", () => {
      const src = `fn test():
  let f = fn(x: int): {
    let y = x * 2
    ret y
  }`;
      const mod = parse(src, "closure_colon_braces.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.body.kind).toBe("Block");
      const block = closure.body as Block;
      expect(block.statements).toHaveLength(2);
    });

    it("parses multiline block closure passed as function argument", () => {
      const src = `fn test(arr: [int]):
  arr.forEach(fn(x) {
    let y = x * 2
    log(y)
  })`;
      const mod = parse(src, "closure_call_arg.ail");
      const fn = mod.items[0] as FunctionDecl;
      const exprStmt = (fn.body as Block).statements[0] as { kind: "ExprStmt"; expr: CallExpr };
      expect(exprStmt.expr.kind).toBe("CallExpr");
      const closure = exprStmt.expr.args[0] as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.params[0].name).toBe("x");
      expect(closure.params[0].typeAnnotation).toBeNull();
      expect(closure.body.kind).toBe("Block");
      expect((closure.body as Block).statements).toHaveLength(2);
    });

    it("parses block closure with explicit return type and curly braces", () => {
      const src = `fn test():
  let f = fn(x: int) -> int {
    ret x + 1
  }`;
      const mod = parse(src, "closure_ret_type.ail");
      const fn = mod.items[0] as FunctionDecl;
      const letStmt = (fn.body as Block).statements[0] as LetBinding;
      const closure = letStmt.init as ClosureExpr;
      expect(closure.kind).toBe("ClosureExpr");
      expect(closure.returnType?.kind).toBe("PrimitiveType");
      expect(closure.body.kind).toBe("Block");
      expect((closure.body as Block).statements).toHaveLength(1);
    });
  });

  describe("Step 13: Statement Visitors (try/catch/finally, throw, break, continue)", () => {
    it("parses try/catch/finally with indentation layout", () => {
      const src = `fn test():
  try:
    doWork()
  catch err:
    log(err)
  finally:
    cleanup()`;
      const mod = parse(src, "try_catch_indent.ail");
      const fn = mod.items[0] as FunctionDecl;
      const tryStmt = (fn.body as Block).statements[0] as TryStmt;
      expect(tryStmt.kind).toBe("TryStmt");
      expect(tryStmt.tryBlock.statements).toHaveLength(1);
      expect(tryStmt.catchParam).toBe("err");
      expect(tryStmt.catchBlock?.statements).toHaveLength(1);
      expect(tryStmt.finallyBlock?.statements).toHaveLength(1);
    });

    it("parses try/catch/finally with curly brace layout", () => {
      const src = `fn test() {
  try {
    doWork()
  } catch err {
    log(err)
  } finally {
    cleanup()
  }
}`;
      const mod = parse(src, "try_catch_braces.ail");
      const fn = mod.items[0] as FunctionDecl;
      const tryStmt = (fn.body as Block).statements[0] as TryStmt;
      expect(tryStmt.kind).toBe("TryStmt");
      expect(tryStmt.tryBlock.statements).toHaveLength(1);
      expect(tryStmt.catchParam).toBe("err");
      expect(tryStmt.catchBlock?.statements).toHaveLength(1);
      expect(tryStmt.finallyBlock?.statements).toHaveLength(1);
    });

    it("parses try/catch with catch param in parentheses", () => {
      const src = `fn test() {
  try {
    throw "error"
  } catch (e) {
    ret e
  }
}`;
      const mod = parse(src, "try_catch_paren.ail");
      const fn = mod.items[0] as FunctionDecl;
      const tryStmt = (fn.body as Block).statements[0] as TryStmt;
      expect(tryStmt.catchParam).toBe("e");
      expect(tryStmt.finallyBlock).toBeUndefined();
      const throwStmt = tryStmt.tryBlock.statements[0] as ThrowStmt;
      expect(throwStmt.kind).toBe("ThrowStmt");
      expect(throwStmt.expr.kind).toBe("LiteralExpr");
    });

    it("parses try/finally without catch block", () => {
      const src = `fn test():
  try:
    doWork()
  finally:
    cleanup()`;
      const mod = parse(src, "try_finally.ail");
      const fn = mod.items[0] as FunctionDecl;
      const tryStmt = (fn.body as Block).statements[0] as TryStmt;
      expect(tryStmt.catchBlock).toBeUndefined();
      expect(tryStmt.finallyBlock).toBeDefined();
    });

    it("parses throw statement", () => {
      const src = `fn fail(msg: str):
  throw msg`;
      const mod = parse(src, "throw.ail");
      const fn = mod.items[0] as FunctionDecl;
      const throwStmt = (fn.body as Block).statements[0] as ThrowStmt;
      expect(throwStmt.kind).toBe("ThrowStmt");
      expect(throwStmt.expr.kind).toBe("IdentifierExpr");
    });

    it("parses break and continue in while loop", () => {
      const src = `fn test():
  while true:
    if cond:
      continue
    else:
      break`;
      const mod = parse(src, "break_continue.ail");
      const fn = mod.items[0] as FunctionDecl;
      const whileStmt = (fn.body as Block).statements[0] as any;
      const ifStmt = whileStmt.body.statements[0] as IfStmt;
      const contStmt = ifStmt.thenBranch.statements[0] as ContinueStmt;
      const brkStmt = ifStmt.elseBranch?.statements[0] as BreakStmt;
      expect(contStmt.kind).toBe("ContinueStmt");
      expect(brkStmt.kind).toBe("BreakStmt");
    });

    it("parses class with static block", () => {
      const src = `class Registry:
  static:
    initRegistry()`;
      const mod = parse(src, "static_block.ail");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.kind).toBe("ClassDecl");
      expect(cls.staticBlocks).toHaveLength(1);
      expect(cls.staticBlocks![0].statements).toHaveLength(1);
    });

    it("parses pub barrel re-exports", () => {
      const src = `pub from "./utils" import format, helper as h
pub from "./all" import *`;
      const mod = parse(src, "reexports.ail");
      expect(mod.items).toHaveLength(2);
      const imp1 = mod.items[0] as any;
      const imp2 = mod.items[1] as any;
      expect(imp1.kind).toBe("ImportDecl");
      expect(imp1.isExported).toBe(true);
      expect(imp1.specifiers).toHaveLength(2);
      expect(imp2.kind).toBe("ImportDecl");
      expect(imp2.isExported).toBe(true);
      expect(imp2.specifiers[0].isWildcard).toBe(true);
    });

    it('parses async fn getData() -> Promise[str]: ret "ok"', () => {
      const src = `async fn getData() -> Promise[str]: ret "ok"`;
      const mod = parse(src, "async_fn.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.name).toBe("getData");
      expect(fn.isAsync).toBe(true);
      expect(fn.returnType?.kind).toBe("NamedType");
      const retType = fn.returnType as NamedType;
      expect(retType.name).toBe("Promise");
      expect(retType.typeArgs).toHaveLength(1);
      expect((retType.typeArgs![0] as PrimitiveType).primitive).toBe("str");
    });

    it("parses async fn with parameter destructuring and types cleanly", () => {
      const src = `async fn process({ user, id: uid }: Config, [first, second]: [int, int]) -> Promise[int]:
  ret 42
`;
      const mod = parse(src, "async_params.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.isAsync).toBe(true);
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0].name).toContain("{ user, id: uid }");
      expect(fn.params[1].name).toContain("[first, second]");
    });

    it("parses expression-bodied async fn and async closure", () => {
      const src = `async fn add(a: int, b: int) -> Promise[int] = a + b
fn run():
  let f = async fn(x: int) -> Promise[int] = x * 2
`;
      const mod = parse(src, "async_expr.ail");
      expect(mod.items).toHaveLength(2);
      const fn1 = mod.items[0] as FunctionDecl;
      expect(fn1.isAsync).toBe(true);
      expect(fn1.isExpressionBodied).toBe(true);

      const fn2 = mod.items[1] as FunctionDecl;
      const letBinding = (fn2.body as any).statements[0] as LetBinding;
      expect(letBinding.init.kind).toBe("ClosureExpr");
      const closure = letBinding.init as ClosureExpr;
      expect(closure.isAsync).toBe(true);
    });
  });

  describe("Step 17: Function Parameter Optionality & Default Values", () => {
    it("parses optional parameters with '?' syntax (fn foo(a: int, b?: str))", () => {
      const src = `fn foo(a: int, b?: str):
  ret a`;
      const mod = parse(src, "optional_params.ail");
      expect(mod.items).toHaveLength(1);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.kind).toBe("FunctionDecl");
      expect(fn.params).toHaveLength(2);
      expect(fn.params[0].name).toBe("a");
      expect(fn.params[0].isOptional).toBeUndefined();
      expect(fn.params[1].name).toBe("b");
      expect(fn.params[1].isOptional).toBe(true);
      expect(fn.params[1].typeAnnotation?.kind).toBe("PrimitiveType");
      expect((fn.params[1].typeAnnotation as any).primitive).toBe("str");
    });

    it("parses optional parameters with default values (b?: str = 'def')", () => {
      const src = `fn greet(msg: str, prefix?: str = "Hello", count: int = 1):
  ret msg`;
      const mod = parse(src, "optional_default.ail");
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.params[0].isOptional).toBeUndefined();
      expect(fn.params[0].defaultValue).toBeUndefined();

      expect(fn.params[1].isOptional).toBe(true);
      expect(fn.params[1].defaultValue).toBeDefined();

      expect(fn.params[2].isOptional).toBeUndefined();
      expect(fn.params[2].defaultValue).toBeDefined();
    });

    it("parses class primary constructor with optional and default parameters", () => {
      const src = `class Config(pub host: str, pub port: int = 8080, pub secure?: bool):
  pass`;
      const mod = parse(src, "class_opt.ail");
      const cls = mod.items[0] as ClassDecl;
      expect(cls.primaryConstructor).toHaveLength(3);
      expect(cls.primaryConstructor![0].name).toBe("host");
      expect(cls.primaryConstructor![0].isOptional).toBeUndefined();
      expect(cls.primaryConstructor![1].name).toBe("port");
      expect(cls.primaryConstructor![1].defaultValue).toBeDefined();
      expect(cls.primaryConstructor![2].name).toBe("secure");
      expect(cls.primaryConstructor![2].isOptional).toBe(true);
    });
  });

  describe("Step 20: CST Trivia Retention from Lexer to Parser (parseWithTrivia)", () => {
    it("captures module header comments on 'module'", () => {
      const src = `# SPDX-License-Identifier: Apache-2.0
# Copyright 2026

import "math"
`;
      const { trivia } = parseWithTrivia(src, "mod_header.ail");
      const modTrivia = trivia.getTrivia("module");
      expect(modTrivia).toBeDefined();
      expect(modTrivia?.leading).toHaveLength(2);
      expect(modTrivia?.leading[0].content).toBe("// SPDX-License-Identifier: Apache-2.0");
      expect(modTrivia?.leading[0].kind).toBe("LICENSE_HEADER");
      expect(modTrivia?.leading[1].content).toBe("// Copyright 2026");
    });

    it("captures function docstrings and comments on 'fn:name'", () => {
      const src = `# Computes factorial recursively
# n must be non-negative
fn factorial(n: int) -> int:
  ret n`;
      const { trivia } = parseWithTrivia(src, "fn_doc.ail");
      const fnTrivia = trivia.getTrivia("fn:factorial");
      expect(fnTrivia).toBeDefined();
      expect(fnTrivia?.leading).toHaveLength(2);
      expect(fnTrivia?.leading[0].content).toBe("// Computes factorial recursively");
      expect(fnTrivia?.leading[1].content).toBe("// n must be non-negative");
    });

    it("captures class comments on 'class:name', property comments on 'field:Class.prop', and method comments on 'method:Class.method'", () => {
      const src = `# Greeter service class
class Greeter:
  # Greeting prefix
  prefix: str = "Hello"

  # Returns full greeting
  fn greet(name: str) -> str = prefix + " " + name`;
      const { trivia } = parseWithTrivia(src, "class_doc.ail");
      const classTrivia = trivia.getTrivia("class:Greeter");
      expect(classTrivia?.leading[0].content).toBe("// Greeter service class");

      const propTrivia = trivia.getTrivia("field:Greeter.prefix");
      expect(propTrivia?.leading[0].content).toBe("// Greeting prefix");

      const methodTrivia = trivia.getTrivia("method:Greeter.greet");
      expect(methodTrivia?.leading[0].content).toBe("// Returns full greeting");
    });

    it("captures type comments on 'type:name' and struct field comments on 'field:Type.field'", () => {
      const src = `# User profile record
type User:
  # Unique identifier
  id: str
  # User email address
  email: str`;
      const { trivia } = parseWithTrivia(src, "type_doc.ail");
      const typeTrivia = trivia.getTrivia("type:User");
      expect(typeTrivia?.leading[0].content).toBe("// User profile record");

      const idTrivia = trivia.getTrivia("field:User.id");
      expect(idTrivia?.leading[0].content).toBe("// Unique identifier");

      const emailTrivia = trivia.getTrivia("field:User.email");
      expect(emailTrivia?.leading[0].content).toBe("// User email address");
    });

    it("captures const and var comments on 'const:name' and 'var:name'", () => {
      const src = `# Max worker count
const MAX_WORKERS = 8

# Current active worker counter
val active = 0`;
      const { trivia } = parseWithTrivia(src, "vars_doc.ail");
      const constTrivia = trivia.getTrivia("const:MAX_WORKERS");
      expect(constTrivia?.leading[0].content).toBe("// Max worker count");

      const varTrivia = trivia.getTrivia("var:active");
      expect(varTrivia?.leading[0].content).toBe("// Current active worker counter");
    });

    it("captures imports comments on 'import:source'", () => {
      const src = `# Standard math utilities
import "math"`;
      const { trivia } = parseWithTrivia(src, "import_doc.ail");
      const impTrivia = trivia.getTrivia("import:math");
      expect(impTrivia?.leading[0].content).toBe("// Standard math utilities");
    });

    it("converts # comments, preserves // comments, and preserves /* ... */ docstrings", () => {
      const src = `// Single-line slash comment
/**
 * JSDoc comment for calculate
 */
fn calculate(): int = 42`;
      const { trivia } = parseWithTrivia(src, "mixed_doc.ail");
      const fnTrivia = trivia.getTrivia("fn:calculate");
      expect(fnTrivia?.leading).toHaveLength(2);
      expect(fnTrivia?.leading[0].content).toBe("// Single-line slash comment");
      expect(fnTrivia?.leading[1].kind).toBe("DOCSTRING");
      expect(fnTrivia?.leading[1].content).toContain("JSDoc comment for calculate");
    });

    it("captures trailing comments on the same line as declaration", () => {
      const src = `const PI = 3.14159 # mathematical constant`;
      const { trivia } = parseWithTrivia(src, "trailing_doc.ail");
      const constTrivia = trivia.getTrivia("const:PI");
      expect(constTrivia?.trailing).toHaveLength(1);
      expect(constTrivia?.trailing[0].content).toBe("// mathematical constant");
    });
  });

  describe("Step 23: Raw Multiline String / Template Literals (TemplateLiteralExpr)", () => {
    it("parses template literal without substitutions into TemplateLiteralExpr", () => {
      const src = "const s = `hello world`";
      const mod = parse(src, "test.ail");
      const stmt = mod.items[0] as ConstDecl;
      expect(stmt.kind).toBe("ConstDecl");
      expect(stmt.value?.kind).toBe("TemplateLiteralExpr");
      const tpl = stmt.value as TemplateLiteralExpr;
      expect(tpl.quasis).toEqual(["hello world"]);
      expect(tpl.expressions).toHaveLength(0);
    });

    it("parses multiline template literal preserving raw multiline content", () => {
      const src = `const s = \`line 1
line 2
line 3\``;
      const mod = parse(src, "test.ail");
      const stmt = mod.items[0] as ConstDecl;
      expect(stmt.kind).toBe("ConstDecl");
      expect(stmt.value?.kind).toBe("TemplateLiteralExpr");
      const tpl = stmt.value as TemplateLiteralExpr;
      expect(tpl.quasis).toEqual(["line 1\nline 2\nline 3"]);
      expect(tpl.expressions).toHaveLength(0);
    });

    it("parses template literal with ${...} interpolation expressions", () => {
      const src = "const msg = `Hello ${name}, total is ${price + tax}!`";
      const mod = parse(src, "test.ail");
      const stmt = mod.items[0] as ConstDecl;
      expect(stmt.kind).toBe("ConstDecl");
      expect(stmt.value?.kind).toBe("TemplateLiteralExpr");
      const tpl = stmt.value as TemplateLiteralExpr;
      expect(tpl.quasis).toEqual(["Hello ", ", total is ", "!"]);
      expect(tpl.expressions).toHaveLength(2);
      expect(tpl.expressions[0].kind).toBe("IdentifierExpr");
      expect((tpl.expressions[0] as IdentifierExpr).name).toBe("name");
      expect(tpl.expressions[1].kind).toBe("BinaryExpr");
      const bin = tpl.expressions[1] as BinaryExpr;
      expect(bin.operator).toBe("+");
      expect((bin.left as IdentifierExpr).name).toBe("price");
      expect((bin.right as IdentifierExpr).name).toBe("tax");
    });

    it("parses nested template literals", () => {
      const src = "const s = `Outer: ${`Inner: ${x}`}`";
      const mod = parse(src, "test.ail");
      const stmt = mod.items[0] as ConstDecl;
      expect(stmt.kind).toBe("ConstDecl");
      expect(stmt.value?.kind).toBe("TemplateLiteralExpr");
      const outerTpl = stmt.value as TemplateLiteralExpr;
      expect(outerTpl.quasis).toEqual(["Outer: ", ""]);
      expect(outerTpl.expressions).toHaveLength(1);
      expect(outerTpl.expressions[0].kind).toBe("TemplateLiteralExpr");
      const innerTpl = outerTpl.expressions[0] as TemplateLiteralExpr;
      expect(innerTpl.quasis).toEqual(["Inner: ", ""]);
      expect(innerTpl.expressions).toHaveLength(1);
      expect((innerTpl.expressions[0] as IdentifierExpr).name).toBe("x");
    });
  });

  describe("Chained Assignments", () => {
    it("parses chained assignments right-associatively", () => {
      const src = `
fn reset():
  a = b = c = false
`;
      const mod = parse(src);
      const fn = mod.items[0] as FunctionDecl;
      expect(fn.body.kind).toBe("Block");
      const stmt = (fn.body as any).statements[0];
      expect(stmt.kind).toBe("AssignStmt");
      expect(stmt.target.name).toBe("a");
      expect(stmt.value.kind).toBe("AssignExpr");
      expect(stmt.value.target.name).toBe("b");
      expect(stmt.value.value.kind).toBe("AssignExpr");
      expect(stmt.value.value.target.name).toBe("c");
      expect(stmt.value.value.value.value).toBe(false);
    });
  });

  describe("Error Handling", () => {
    it("throws ParserError on unexpected tokens with exact span", () => {
      const src = `fn incomplete(`;
      expect(() => parse(src, "err.ail")).toThrowError(ParserError);
    });
  });
});
