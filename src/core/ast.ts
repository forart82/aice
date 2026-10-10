/**
 * Universal Abstract Syntax Tree (AST) definitions for AIL 2.0.
 * Conforms to the formal EBNF grammar in docs/AIL_SPEC.md.
 */

import type { Span } from "./span.js";

// Top-Level Module
export interface Module {
  kind: "Module";
  path: string;
  items: ModuleItem[];
  span: Span;
}

export type ModuleItem =
  | ImportDecl
  | TypeDecl
  | FunctionDecl
  | ComponentDecl
  | StyleDecl
  | ClassDecl
  | ConstDecl
  | VarDecl;

// Imports & Dependencies
export interface ImportDecl {
  kind: "ImportDecl";
  source: string;
  specifiers: ImportSpecifier[];
  isExported?: boolean;
  span: Span;
}

export interface ImportSpecifier {
  name: string;
  alias?: string;
  isWildcard?: boolean;
  span: Span;
}

// Type Declarations
export interface TypeDecl {
  kind: "TypeDecl";
  isEnum: boolean;
  name: string;
  typeParams: string[];
  fields?: FieldDecl[];
  variants?: EnumVariantDecl[];
  aliasType?: TypeExpr;
  span: Span;
}

export interface FieldDecl {
  name: string;
  typeAnnotation: TypeExpr;
  defaultValue?: Expr;
  isOptional?: boolean;
  span: Span;
}

export interface EnumVariantDecl {
  name: string;
  payloadTypes?: TypeExpr[];
  span: Span;
}

// Type Expressions
export type TypeExpr =
  | PrimitiveType
  | ArrayType
  | TupleType
  | RecordType
  | ResultType
  | OptionType
  | RefinementType
  | NamedType;

export interface PrimitiveType {
  kind: "PrimitiveType";
  primitive: "int" | "str" | "float" | "bool" | "num" | "byte" | "char" | "void" | "nil";
  span: Span;
}

export interface ArrayType {
  kind: "ArrayType";
  elementType: TypeExpr;
  span: Span;
}

export interface TupleType {
  kind: "TupleType";
  elementTypes: TypeExpr[];
  span: Span;
}

export interface RecordType {
  kind: "RecordType";
  fields: { name: string; type: TypeExpr; isOptional?: boolean; span: Span }[];
  span: Span;
}

export interface ResultType {
  kind: "ResultType";
  okType: TypeExpr;
  errType: TypeExpr;
  span: Span;
}

export interface OptionType {
  kind: "OptionType";
  innerType: TypeExpr;
  span: Span;
}

export interface RefinementType {
  kind: "RefinementType";
  param: string;
  baseType: PrimitiveType;
  predicate: Expr;
  span: Span;
}

export interface NamedType {
  kind: "NamedType";
  name: string;
  typeArgs?: TypeExpr[];
  span: Span;
}

// Function Declarations
export interface FunctionDecl {
  kind: "FunctionDecl";
  name: string;
  isAsync?: boolean;
  typeParams?: string[];
  params: ParamDecl[];
  returnType: TypeExpr | null;
  body: Block | Expr;
  isExpressionBodied: boolean;
  span: Span;
}

export interface ParamDecl {
  name: string;
  typeAnnotation: TypeExpr | null;
  defaultValue?: Expr;
  isOptional?: boolean;
  isPub?: boolean;
  isReadonly?: boolean;
  isMut?: boolean;
  span: Span;
}

// Class Declarations
export interface ClassDecl {
  kind: "ClassDecl";
  name: string;
  isExported: boolean;
  typeParams: string[];
  primaryConstructor?: ParamDecl[];
  extends?: string;
  implements?: string[];
  properties: PropertyDecl[];
  methods: MethodDecl[];
  staticBlocks?: Block[];
  span: Span;
}

export interface PropertyDecl {
  kind: "PropertyDecl";
  name: string;
  alias?: string;
  aliases?: string[];
  isStatic: boolean;
  isReadonly: boolean;
  isOptional?: boolean;
  typeAnnotation?: TypeExpr;
  initialValue?: Expr;
  span: Span;
}

export interface MethodDecl {
  kind: "MethodDecl";
  name: string;
  isStatic: boolean;
  isAsync: boolean;
  typeParams?: string[];
  accessor?: "get" | "set";
  params: ParamDecl[];
  returnType: TypeExpr | null;
  body: Block | Expr;
  isExpressionBodied: boolean;
  span: Span;
}

// Module-Level Variable & Constant Declarations
export interface ConstDecl {
  kind: "ConstDecl";
  name: string;
  isExported: boolean;
  typeAnnotation?: TypeExpr;
  value: Expr;
  span: Span;
}

export interface VarDecl {
  kind: "VarDecl";
  name: string;
  isExported: boolean;
  isMut: boolean;
  typeAnnotation?: TypeExpr;
  value: Expr;
  span: Span;
}

// Statements & Blocks
export interface Block {
  kind: "Block";
  statements: Statement[];
  span: Span;
}

export type Statement =
  | LetBinding
  | DestructureBinding
  | AssignStmt
  | ReturnStmt
  | ExprStmt
  | IfStmt
  | MatchStmt
  | ForStmt
  | WhileStmt
  | TryStmt
  | ThrowStmt
  | BreakStmt
  | ContinueStmt;

export interface LetBinding {
  kind: "LetBinding";
  name: string;
  isMut: boolean;
  typeAnnotation: TypeExpr | null;
  init: Expr;
  span: Span;
}

export interface DestructureBinding {
  kind: "DestructureBinding";
  names: string[];
  isMut: boolean;
  typeAnnotation?: TypeExpr | null;
  init: Expr;
  span: Span;
}

export type AssignOp =
  | "="
  | "+="
  | "-="
  | "*="
  | "/="
  | "%="
  | "|="
  | "^="
  | "&="
  | "<<="
  | ">>="
  | ">>>="
  | "**=";

export interface AssignStmt {
  kind: "AssignStmt";
  target: Expr;
  op?: AssignOp;
  value: Expr;
  span: Span;
}

export interface ReturnStmt {
  kind: "ReturnStmt";
  value: Expr | null;
  span: Span;
}

export interface ExprStmt {
  kind: "ExprStmt";
  expr: Expr;
  span: Span;
}

export interface IfStmt {
  kind: "IfStmt";
  condition: Expr;
  thenBranch: Block;
  elifBranches: { condition: Expr; body: Block; span: Span }[];
  elseBranch: Block | null;
  span: Span;
}

export interface MatchStmt {
  kind: "MatchStmt";
  target: Expr;
  cases: MatchCase[];
  span: Span;
}

export interface MatchCase {
  pattern: Pattern;
  guard?: Expr;
  body: Block | Expr;
  span: Span;
}

export type Pattern = LiteralPattern | IdentifierPattern | ConstructorPattern | WildcardPattern;

export interface LiteralPattern {
  kind: "LiteralPattern";
  value: LiteralExpr;
  span: Span;
}

export interface IdentifierPattern {
  kind: "IdentifierPattern";
  name: string;
  span: Span;
}

export interface ConstructorPattern {
  kind: "ConstructorPattern";
  name: string;
  subPatterns: Pattern[];
  span: Span;
}

export interface WildcardPattern {
  kind: "WildcardPattern";
  span: Span;
}

export interface ForStmt {
  kind: "ForStmt";
  variable: string;
  iterable: Expr;
  body: Block;
  span: Span;
}

export interface WhileStmt {
  kind: "WhileStmt";
  condition: Expr;
  body: Block;
  span: Span;
}

export interface TryStmt {
  kind: "TryStmt";
  tryBlock: Block;
  catchParam?: string;
  catchBlock?: Block;
  finallyBlock?: Block;
  span: Span;
}

export interface ThrowStmt {
  kind: "ThrowStmt";
  expr: Expr;
  span: Span;
}

export interface BreakStmt {
  kind: "BreakStmt";
  span: Span;
}

export interface ContinueStmt {
  kind: "ContinueStmt";
  span: Span;
}

// Expressions
export type Expr =
  | LiteralExpr
  | TemplateLiteralExpr
  | IdentifierExpr
  | BinaryExpr
  | UnaryExpr
  | PostfixTryExpr
  | CallExpr
  | MemberAccessExpr
  | IndexExpr
  | ArrayLiteralExpr
  | RecordLiteralExpr
  | ClosureExpr
  | AssignExpr
  | AwaitExpr;

export interface TemplateLiteralExpr {
  kind: "TemplateLiteralExpr";
  quasis: string[]; // static string parts
  expressions: Expr[]; // interpolated expressions
  span: Span;
}

export interface AwaitExpr {
  kind: "AwaitExpr";
  operand: Expr;
  span: Span;
}

export interface AssignExpr {
  kind: "AssignExpr";
  target: Expr;
  op?: AssignOp;
  value: Expr;
  span: Span;
}

export interface LiteralExpr {
  kind: "LiteralExpr";
  literalKind: "number" | "string" | "boolean" | "nil";
  value: string | number | boolean | null;
  rawValue: string;
  span: Span;
}

export interface IdentifierExpr {
  kind: "IdentifierExpr";
  name: string;
  span: Span;
}

export type BinaryOp =
  | "+"
  | "-"
  | "*"
  | "/"
  | "%"
  | "**"
  | "&"
  | "|"
  | "^"
  | "<<"
  | ">>"
  | ">>>"
  | "=="
  | "!="
  | "<"
  | "<="
  | ">"
  | ">="
  | "and"
  | "or"
  | "??"
  | "&&"
  | "||"
  | "in"
  | "instanceof";

export interface BinaryExpr {
  kind: "BinaryExpr";
  operator: BinaryOp;
  left: Expr;
  right: Expr;
  span: Span;
}

export interface UnaryExpr {
  kind: "UnaryExpr";
  operator: "not" | "-" | "!" | "...";
  operand: Expr;
  span: Span;
}

export interface PostfixTryExpr {
  kind: "PostfixTryExpr";
  operand: Expr;
  span: Span;
}

export interface CallExpr {
  kind: "CallExpr";
  callee: Expr;
  args: Expr[];
  span: Span;
}

export interface MemberAccessExpr {
  kind: "MemberAccessExpr";
  object: Expr;
  property: string;
  isSafeNav: boolean;
  isOptional?: boolean;
  span: Span;
}

export interface IndexExpr {
  kind: "IndexExpr";
  object: Expr;
  index: Expr;
  span: Span;
}

export interface ArrayLiteralExpr {
  kind: "ArrayLiteralExpr";
  elements: Expr[];
  span: Span;
}

export interface RecordProperty {
  key?: string;
  value: Expr;
  isSpread?: boolean;
  span: Span;
}

export interface RecordLiteralExpr {
  kind: "RecordLiteralExpr";
  properties: RecordProperty[];
  span: Span;
}

export interface ClosureExpr {
  kind: "ClosureExpr";
  isAsync?: boolean;
  params: ParamDecl[];
  returnType: TypeExpr | null;
  body: Block | Expr;
  span: Span;
}

// Declarative UI Component DSL Nodes
export interface ComponentDecl {
  kind: "ComponentDecl";
  name: string;
  params: ParamDecl[];
  layout: LayoutNode[];
  span: Span;
}

export interface LayoutNode {
  kind: "LayoutNode";
  tag: string;
  attributes: { name: string; value: Expr; span: Span }[];
  textLiteral: string | null;
  childExpr?: Expr | null;
  children: LayoutNode[];
  span: Span;
}

// Style Declarations
export interface StyleDecl {
  kind: "StyleDecl";
  name: string;
  properties: StyleProperty[];
  span: Span;
}

export interface StyleProperty {
  property: string;
  value: string;
  span: Span;
}
