/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Pure Homoiconic Universal AST Definitions
 */

import type { SourceSpan } from "./span.ts";

export interface AilNodeBase {
  nodeId: string;
  span?: SourceSpan;
}

export type AilDocumentNode = AilWorkspaceNode | AilModuleNode;

export interface AilWorkspaceNode extends AilNodeBase {
  kind: "Workspace";
  name: string;
  manifest?: AilManifestNode;
  files: AilFileNode[];
}

export interface AilFileNode extends AilNodeBase {
  kind: "File";
  path: string;
  module: AilModuleNode;
}

export interface AilModuleNode extends AilNodeBase {
  kind: "Module";
  name: string;
  manifest?: AilManifestNode;
  entities: AilEntityNode[];
}

export interface AilManifestNode extends AilNodeBase {
  kind: "Manifest";
  entries: Record<string, string | number | boolean>;
}

export type AilEntityNode =
  | AilImportDeclNode
  | AilTypeDeclNode
  | AilFunctionDeclNode
  | AilComponentDeclNode
  | AilStyleDeclNode;

export interface AilImportBinding {
  modulePath: string;
  symbols: string[];
}

export interface AilImportDeclNode extends AilNodeBase {
  kind: "ImportDecl";
  imports: AilImportBinding[];
}

export interface AilTypeDeclNode extends AilNodeBase {
  kind: "TypeDecl";
  name: string;
  typeExpr: AilTypeExprNode;
}

export interface AilFunctionDeclNode extends AilNodeBase {
  kind: "FunctionDecl";
  name: string;
  signatures: AilSignatureNode;
  body: AilExprNode;
}

export interface AilSignatureNode extends AilNodeBase {
  kind: "Signature";
  params: Array<{ name: string; type: AilTypeExprNode }>;
  returnType: AilTypeExprNode;
}

export interface AilComponentDeclNode extends AilNodeBase {
  kind: "ComponentDecl";
  name: string;
  propContract?: AilRecordTypeNode;
  layout: AilLayoutNode;
}

export interface AilStyleDeclNode extends AilNodeBase {
  kind: "StyleDecl";
  name: string;
  rules: Array<{ prop: string; value: string }>;
}

export type AilTypeExprNode =
  | AilPrimitiveTypeNode
  | AilArrayTypeNode
  | AilRecordTypeNode
  | AilUnionTypeNode
  | AilRefinementTypeNode
  | AilTypestateNode
  | AilEffectTypeNode
  | AilNamedTypeNode;

export type PrimitiveKind = "!u" | "!i" | "!f" | "!s" | "!b" | "!void" | "!unknown" | "!nil";

export interface AilPrimitiveTypeNode extends AilNodeBase {
  kind: "PrimitiveType";
  name: PrimitiveKind;
}

export interface AilArrayTypeNode extends AilNodeBase {
  kind: "ArrayType";
  elementType: AilTypeExprNode;
}

export interface AilRecordField {
  name: string;
  type: AilTypeExprNode;
  optional?: boolean;
}

export interface AilRecordTypeNode extends AilNodeBase {
  kind: "RecordType";
  fields: AilRecordField[];
}

export interface AilUnionTypeNode extends AilNodeBase {
  kind: "UnionType";
  types: AilTypeExprNode[];
}

export interface AilRefinementTypeNode extends AilNodeBase {
  kind: "RefinementType";
  param: string;
  baseType: AilPrimitiveTypeNode;
  predicate: AilExprNode;
}

export interface AilTypestateNode extends AilNodeBase {
  kind: "Typestate";
  states: string[];
}

export interface AilEffectTypeNode extends AilNodeBase {
  kind: "EffectType";
  returnType: AilTypeExprNode;
  effects: string[];
}

export interface AilNamedTypeNode extends AilNodeBase {
  kind: "NamedType";
  name: string;
  typeArguments?: AilTypeExprNode[];
}

export type AilLayoutNode = AilTagNode | AilConditionalLayoutNode | AilLoopLayoutNode | AilTextNode;

export interface AilTagNode extends AilNodeBase {
  kind: "TagNode";
  tag: string;
  attributes: Record<string, AilExprNode>;
  children: AilLayoutNode[];
}

export interface AilConditionalLayoutNode extends AilNodeBase {
  kind: "ConditionalLayout";
  condition: AilExprNode;
  thenNode: AilLayoutNode;
  elseNode?: AilLayoutNode;
}

export interface AilLoopLayoutNode extends AilNodeBase {
  kind: "LoopLayout";
  iterable: AilExprNode;
  itemSymbol: string;
  body: AilLayoutNode;
}

export interface AilTextNode extends AilNodeBase {
  kind: "TextNode";
  text?: string;
  expr?: AilExprNode;
}

export type AilExprNode =
  | AilLiteralNode
  | AilSymbolNode
  | AilApplyExprNode
  | AilMatchExprNode
  | AilAssignExprNode
  | AilBlockExprNode
  | AilTryUnpackExprNode
  | AilIfExprNode;

export interface AilLiteralNode extends AilNodeBase {
  kind: "Literal";
  valueType: "string" | "number" | "boolean" | "array" | "record";
  value: string | number | boolean | AilExprNode[] | Record<string, AilExprNode>;
}

export interface AilSymbolNode extends AilNodeBase {
  kind: "Symbol";
  name: string;
}

export interface AilApplyExprNode extends AilNodeBase {
  kind: "ApplyExpr";
  operator: string;
  args: AilExprNode[];
}

export interface AilMatchCase {
  pattern: AilExprNode;
  expr: AilExprNode;
}

export interface AilMatchExprNode extends AilNodeBase {
  kind: "MatchExpr";
  target: AilExprNode;
  cases: AilMatchCase[];
}

export interface AilAssignExprNode extends AilNodeBase {
  kind: "AssignExpr";
  target: string;
  expr: AilExprNode;
}

export interface AilBlockExprNode extends AilNodeBase {
  kind: "BlockExpr";
  expressions: AilExprNode[];
}

export interface AilTryUnpackExprNode extends AilNodeBase {
  kind: "TryUnpackExpr";
  expr: AilExprNode;
}

export interface AilIfExprNode extends AilNodeBase {
  kind: "IfExpr";
  condition: AilExprNode;
  thenExpr: AilExprNode;
  elseExpr?: AilExprNode;
}
