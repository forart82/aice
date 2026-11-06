/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Project Idiom Transformation Engine.
 * Expands and collapses idioms in ASTs, source strings, and project workspaces.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  ArrayLiteralExpr,
  AssignExpr,
  AssignStmt,
  AwaitExpr,
  BinaryExpr,
  Block,
  CallExpr,
  ClassDecl,
  ClosureExpr,
  ComponentDecl,
  ConstDecl,
  DestructureBinding,
  Expr,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  IndexExpr,
  LayoutNode,
  LetBinding,
  LiteralExpr,
  MatchStmt,
  MemberAccessExpr,
  Module,
  PostfixTryExpr,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  StyleDecl,
  StyleProperty,
  TemplateLiteralExpr,
  ThrowStmt,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { createHash } from "node:crypto";
import { parse } from "../core/parser.js";
import { type Span } from "../core/span.js";
import { AilGenerator } from "../decompiler/ail-generator.js";
import { decompile } from "../decompiler/index.js";
import { CSS_PROPERTY_ALIASES } from "../emitters/css-emitter.js";
import { detectTargetFromPath, emitTarget } from "../emitters/index.js";
import {
  findProjectRoot,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  saveProjectConfig,
  type AilProjectConfig,
  type IdiomOccurrence,
  type ProjectIdiomDefinition,
  type ProjectIdiomParam,
} from "../config/project-config.js";
import {
  mineProjectIdioms,
  type IdiomFileInput,
  isIdentifierReferencedInStatements,
  collectIdentifiersInStatement,
  renameIdentifiersInStatement,
} from "./idiom-miner.js";
import { spliceNativeSymbolFromExpandedAst } from "../tools/splice.js";

export class IdiomCycleError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "IdiomCycleError";
  }
}

export interface ApplyProjectIdiomsOptions {
  dryRun?: boolean;
  minOccurrences?: number;
  minNetTokenSavings?: number;
  maxParams?: number;
  maxBlockStatements?: number;
}

export interface ApplyProjectIdiomsResult {
  idioms: Record<string, ProjectIdiomDefinition>;
  modifiedFiles: string[];
  totalCollapsedCalls: number;
  totalNetTokenSavings: number;
  rejectedByTokenGate: number;
  synthesizedIdioms?: number;
  netTokenSavings?: number;
  occurrences?: Record<string, IdiomOccurrence[]>;
}

export interface IdiomCacheData {
  version: number;
  idiomsEnabled: boolean;
  fileHashes: Record<string, string>;
  decompiledAil: Record<string, string>;
  idioms: Record<string, ProjectIdiomDefinition>;
  occurrences: Record<string, IdiomOccurrence[]>;
}

export interface IdiomReadResult {
  idiom: ProjectIdiomDefinition;
  idiomsEnabled: boolean;
  occurrences: IdiomOccurrence[];
  totalOccurrences: number;
  filesCount: number;
  formattedReport: string;
}

export interface IdiomUpdateResult {
  idiom: ProjectIdiomDefinition;
  modifiedFiles: string[];
  updatedOccurrences: number;
  dryRun: boolean;
}

function extractReferencedIdiomNamesFromTemplate(
  templateAil: string,
  knownIdioms: Set<string>,
): string[] {
  const refs: string[] = [];
  const regex = /(\$[a-zA-Z_][a-zA-Z0-9_]*)\s*\(/g;
  let match: RegExpExecArray | null = null;
  while ((match = regex.exec(templateAil)) !== null) {
    const candidate = match[1];
    if (knownIdioms.has(candidate)) {
      refs.push(candidate);
    } else if (knownIdioms.has(candidate.slice(1))) {
      refs.push(candidate.slice(1));
    }
  }
  return refs;
}

/**
 * Validates that idiom templates parse cleanly and contain no direct or mutual recursion cycles.
 */
export function validateIdiomDefinitions(
  idioms: Record<string, ProjectIdiomDefinition>,
): void {
  const normalizedMap = new Map<string, ProjectIdiomDefinition>();
  for (const [key, def] of Object.entries(idioms)) {
    const normName = (def.name || key).startsWith("$") ? def.name || key : `$${def.name || key}`;
    const templateAil = def.templateAil ?? (def as { template?: string }).template ?? "";
    const params = (def.params ?? []).map((p) =>
      typeof p === "string" ? { name: p } : p,
    );
    const normDef: ProjectIdiomDefinition = { ...def, name: normName, templateAil, params };
    normalizedMap.set(normName, normDef);
    // Validate template syntax by parsing
    getOrParseTemplate(normDef);
  }

  const knownNames = new Set<string>(normalizedMap.keys());
  const visiting = new Set<string>();
  const visited = new Set<string>();

  function dfs(name: string, pathStack: string[]): void {
    if (visiting.has(name)) {
      const cycleChain = [...pathStack, name].join(" -> ");
      throw new IdiomCycleError(`Idiom recursion cycle detected: ${cycleChain}`);
    }
    if (visited.has(name)) return;

    visiting.add(name);
    const def = normalizedMap.get(name);
    if (def) {
      const refs = extractReferencedIdiomNamesFromTemplate(def.templateAil, knownNames);
      for (const ref of refs) {
        const normRef = ref.startsWith("$") ? ref : `$${ref}`;
        dfs(normRef, [...pathStack, name]);
      }
    }
    visiting.delete(name);
    visited.add(name);
  }

  for (const name of knownNames) {
    dfs(name, []);
  }
}

interface ParsedTemplate {
  kind: "expr" | "stmt" | "block";
  expr?: Expr;
  statements?: Statement[];
  styleProperties?: StyleProperty[];
  layoutNodes?: LayoutNode[];
}

export const templateCache = new Map<string, ParsedTemplate>();

function setCachedTemplate(key: string, result: ParsedTemplate): void {
  if (templateCache.size >= 500) {
    const oldest = templateCache.keys().next().value;
    if (oldest !== undefined) {
      templateCache.delete(oldest);
    }
  }
  templateCache.set(key, result);
}

/**
 * Parses an idiom's templateAil string into template AST statement(s), expression, layoutNodes, or styleProperties.
 */
function getOrParseTemplate(def: ProjectIdiomDefinition): ParsedTemplate {
  const rawTemplate = def.templateAil ?? (def as { template?: string }).template ?? "";
  const cacheKey = `${def.name}::${def.kind}::${rawTemplate}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  if (def.kind === "expr") {
    const wrapper = `fn __t():\n  ret ${rawTemplate}\n`;
    const mod = parse(wrapper, "<template>");
    const fn = mod.items[0] as FunctionDecl;
    const body = fn.body as Block;
    const retStmt = body.statements[0] as ReturnStmt;
    const result: ParsedTemplate = {
      kind: "expr",
      expr: retStmt.value!,
    };
    setCachedTemplate(cacheKey, result);
    return result;
  }

  // kind === "stmt" | "block"
  const indented = rawTemplate
    .split(/\r?\n/)
    .map((line) => (line.trim().length > 0 ? `  ${line}` : ""))
    .join("\n");

  let parsedStatements: Statement[] | undefined;
  let parsedSingleExpr: Expr | undefined;
  let parsedLayoutNodes: LayoutNode[] | undefined;
  let parsedStyleProperties: StyleProperty[] | undefined;
  let firstErr: unknown;

  try {
    const wrapper = `fn __t():\n${indented}\n`;
    const mod = parse(wrapper, "<template>");
    const fn = mod.items[0] as FunctionDecl;
    const body = fn.body as Block;
    parsedStatements = body.statements;
    parsedSingleExpr =
      body.statements.length === 1 && body.statements[0].kind === "ExprStmt"
        ? (body.statements[0] as ExprStmt).expr
        : undefined;
  } catch (err) {
    firstErr = err;
  }

  try {
    const compWrapper = `component __c():\n${indented}\n`;
    const compMod = parse(compWrapper, "<template>");
    const comp = compMod.items[0];
    if (comp && comp.kind === "ComponentDecl" && comp.layout.length > 0) {
      parsedLayoutNodes = comp.layout;
    }
  } catch {
    // ignore
  }

  try {
    const styleWrapper = `style __s:\n${indented}\n`;
    const styleMod = parse(styleWrapper, "<template>");
    const st = styleMod.items[0];
    if (st && st.kind === "StyleDecl" && st.properties.length > 0) {
      parsedStyleProperties = st.properties;
    }
  } catch {
    // ignore
  }

  if (parsedStatements || parsedLayoutNodes || parsedStyleProperties) {
    const result: ParsedTemplate = {
      kind: def.kind,
      statements: parsedStatements,
      expr: parsedSingleExpr,
      layoutNodes: parsedLayoutNodes,
      styleProperties: parsedStyleProperties,
    };
    setCachedTemplate(cacheKey, result);
    return result;
  }

  throw firstErr ?? new Error(`Failed to parse idiom template: ${def.name}`);
}

function normalizeCssPropName(prop: string): string {
  const clean = prop
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/_/g, "-")
    .toLowerCase()
    .trim();
  return CSS_PROPERTY_ALIASES[clean] ?? clean;
}

function splitTopLevelCssArgs(argStr: string): string[] {
  const args: string[] = [];
  let cur = "";
  let parenDepth = 0;
  let inQuote: string | null = null;
  for (let i = 0; i < argStr.length; i++) {
    const ch = argStr[i];
    if (inQuote) {
      if (ch === inQuote && argStr[i - 1] !== "\\") {
        inQuote = null;
      }
      cur += ch;
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") parenDepth++;
    else if (ch === ")") parenDepth = Math.max(0, parenDepth - 1);
    else if (ch === "," && parenDepth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0) {
    args.push(cur.trim());
  }
  return args;
}

function substituteLayoutNode(
  tNode: LayoutNode,
  subst: Map<string, Expr>,
  callSpan: Span,
): LayoutNode {
  const cloned = structuredClone(tNode);
  cloned.span = callSpan;
  cloned.attributes = cloned.attributes.map((a) => ({
    ...a,
    value: substituteExpr(a.value, subst, callSpan),
    span: callSpan,
  }));
  if (cloned.childExpr) {
    const subExpr = substituteExpr(cloned.childExpr, subst, callSpan);
    if (subExpr.kind === "LiteralExpr" && subExpr.literalKind === "string") {
      cloned.textLiteral = String(subExpr.value);
      cloned.childExpr = null;
    } else {
      cloned.childExpr = subExpr;
      cloned.textLiteral = null;
    }
  } else if (cloned.textLiteral !== null && subst.has(cloned.textLiteral.trim())) {
    const subExpr = subst.get(cloned.textLiteral.trim())!;
    if (subExpr.kind === "LiteralExpr" && subExpr.literalKind === "string") {
      cloned.textLiteral = String(subExpr.value);
      cloned.childExpr = null;
    } else {
      cloned.childExpr = structuredClone(subExpr);
      cloned.textLiteral = null;
    }
  }
  cloned.children = cloned.children.map((ch) => substituteLayoutNode(ch, subst, callSpan));
  return cloned;
}

function matchLayoutNodeTemplate(
  tNode: LayoutNode,
  cNode: LayoutNode,
  bindings: Map<string, Expr>,
  holeNames: Set<string>,
  generator: AilGenerator,
): boolean {
  if (tNode.tag !== cNode.tag) return false;
  if (tNode.attributes.length !== cNode.attributes.length) return false;
  for (const tAttr of tNode.attributes) {
    const cAttr = cNode.attributes.find((a) => a.name === tAttr.name);
    if (!cAttr) return false;
    if (!matchExprTemplate(tAttr.value, cAttr.value, bindings, holeNames, generator)) {
      return false;
    }
  }
  if (tNode.childExpr && tNode.childExpr.kind === "IdentifierExpr" && holeNames.has(tNode.childExpr.name)) {
    const hole = tNode.childExpr.name;
    let boundExpr: Expr | null = null;
    if (cNode.childExpr) {
      boundExpr = cNode.childExpr;
    } else if (cNode.textLiteral !== null) {
      const trimmedText = cNode.textLiteral.trim();
      if (
        trimmedText.startsWith("{") &&
        trimmedText.endsWith("}") &&
        /^[a-zA-Z_$][a-zA-Z0-9_$.]*$/.test(trimmedText.slice(1, -1).trim())
      ) {
        boundExpr = {
          kind: "IdentifierExpr",
          name: trimmedText.slice(1, -1).trim(),
          span: cNode.span,
        };
      } else {
        boundExpr = {
          kind: "LiteralExpr",
          literalKind: "string",
          value: cNode.textLiteral,
          rawValue: JSON.stringify(cNode.textLiteral),
          span: cNode.span,
        };
      }
    }
    if (!boundExpr) return false;
    if (bindings.has(hole)) {
      if (generator.formatExpr(bindings.get(hole)!) !== generator.formatExpr(boundExpr)) {
        return false;
      }
    } else {
      bindings.set(hole, boundExpr);
    }
  } else if (tNode.textLiteral !== null) {
    if (holeNames.has(tNode.textLiteral.trim())) {
      const hole = tNode.textLiteral.trim();
      const boundExpr: Expr =
        cNode.childExpr ?? {
          kind: "LiteralExpr",
          literalKind: "string",
          value: cNode.textLiteral ?? "",
          rawValue: JSON.stringify(cNode.textLiteral ?? ""),
          span: cNode.span,
        };
      if (bindings.has(hole)) {
        if (generator.formatExpr(bindings.get(hole)!) !== generator.formatExpr(boundExpr)) {
          return false;
        }
      } else {
        bindings.set(hole, boundExpr);
      }
    } else if (cNode.textLiteral !== tNode.textLiteral) {
      return false;
    }
  } else if (tNode.childExpr) {
    if (!cNode.childExpr) return false;
    if (!matchExprTemplate(tNode.childExpr, cNode.childExpr, bindings, holeNames, generator)) {
      return false;
    }
  } else if (cNode.textLiteral !== null || cNode.childExpr != null) {
    return false;
  }

  if (tNode.children.length !== cNode.children.length) return false;
  for (let i = 0; i < tNode.children.length; i++) {
    if (!matchLayoutNodeTemplate(tNode.children[i], cNode.children[i], bindings, holeNames, generator)) {
      return false;
    }
  }
  return true;
}

function matchStylePropertyWindow(
  tProps: StyleProperty[],
  cProps: StyleProperty[],
  bindings: Map<string, string>,
  holeNames: Set<string>,
): boolean {
  if (tProps.length !== cProps.length) return false;
  for (let i = 0; i < tProps.length; i++) {
    const tp = tProps[i];
    const cp = cProps[i];
    if (normalizeCssPropName(tp.property) !== normalizeCssPropName(cp.property)) {
      return false;
    }
    const tVal = tp.value.trim();
    const cVal = cp.value.trim();
    if (holeNames.has(tVal)) {
      if (bindings.has(tVal)) {
        if (bindings.get(tVal) !== cVal) return false;
      } else {
        bindings.set(tVal, cVal);
      }
    } else if (tVal !== cVal) {
      return false;
    }
  }
  return true;
}

/**
 * Recursively stamps all nodes with a given call site span.
 */
function stampSpan<T>(node: T, callSpan: Span): T {
  if (!node || typeof node !== "object") return node;
  if ("span" in node) {
    (node as { span: Span }).span = callSpan;
  }
  for (const key of Object.keys(node)) {
    const val = (node as Record<string, unknown>)[key];
    if (Array.isArray(val)) {
      for (const item of val) {
        stampSpan(item, callSpan);
      }
    } else if (val && typeof val === "object" && key !== "span") {
      stampSpan(val, callSpan);
    }
  }
  return node;
}

/**
 * Substitutes hole parameters ($0, $1, ...) in an AST expression.
 */
function substituteExpr(expr: Expr, subst: Map<string, Expr>, callSpan: Span): Expr {
  if (!expr) return expr;

  if (expr.kind === "IdentifierExpr" && subst.has(expr.name)) {
    const replacement = structuredClone(subst.get(expr.name)!);
    return stampSpan(replacement, callSpan);
  }

  const cloned = structuredClone(expr);
  cloned.span = callSpan;

  switch (cloned.kind) {
    case "CallExpr":
      cloned.callee = substituteExpr(cloned.callee, subst, callSpan);
      cloned.args = cloned.args.map((a) => substituteExpr(a, subst, callSpan));
      break;
    case "MemberAccessExpr":
      cloned.object = substituteExpr(cloned.object, subst, callSpan);
      break;
    case "BinaryExpr":
      cloned.left = substituteExpr(cloned.left, subst, callSpan);
      cloned.right = substituteExpr(cloned.right, subst, callSpan);
      break;
    case "UnaryExpr":
      cloned.operand = substituteExpr(cloned.operand, subst, callSpan);
      break;
    case "ArrayLiteralExpr":
      cloned.elements = cloned.elements.map((e) => substituteExpr(e, subst, callSpan));
      break;
    case "RecordLiteralExpr":
      cloned.properties = cloned.properties.map((p) => ({
        ...p,
        value: substituteExpr(p.value, subst, callSpan),
        span: callSpan,
      }));
      break;
    case "AwaitExpr":
      cloned.operand = substituteExpr(cloned.operand, subst, callSpan);
      break;
    case "AssignExpr":
      cloned.target = substituteExpr(cloned.target, subst, callSpan);
      cloned.value = substituteExpr(cloned.value, subst, callSpan);
      break;
    case "PostfixTryExpr":
      cloned.operand = substituteExpr(cloned.operand, subst, callSpan);
      break;
    case "IndexExpr":
      cloned.object = substituteExpr(cloned.object, subst, callSpan);
      cloned.index = substituteExpr(cloned.index, subst, callSpan);
      break;
    case "TemplateLiteralExpr":
      cloned.expressions = cloned.expressions.map((e) => substituteExpr(e, subst, callSpan));
      break;
    case "ClosureExpr": {
      const shadowedParams = new Set(cloned.params.map((p) => p.name));
      const closureSubst = new Map(subst);
      for (const p of shadowedParams) {
        closureSubst.delete(p);
      }
      if ("statements" in cloned.body) {
        cloned.body = {
          ...cloned.body,
          statements: cloned.body.statements.map((s) =>
            substituteStatement(s, closureSubst, callSpan),
          ),
        };
      } else {
        cloned.body = substituteExpr(cloned.body, closureSubst, callSpan);
      }
      break;
    }
  }

  return cloned;
}

/**
 * Substitutes hole parameters in an AST statement.
 */
function substituteStatement(
  stmt: Statement,
  subst: Map<string, Expr>,
  callSpan: Span,
): Statement {
  const cloned = structuredClone(stmt);
  cloned.span = callSpan;

  switch (cloned.kind) {
    case "ExprStmt":
      cloned.expr = substituteExpr(cloned.expr, subst, callSpan);
      break;
    case "ReturnStmt":
      if (cloned.value) {
        cloned.value = substituteExpr(cloned.value, subst, callSpan);
      }
      break;
    case "LetBinding": {
      if (subst.has(cloned.name)) {
        const replacement = subst.get(cloned.name)!;
        if (replacement.kind === "IdentifierExpr") {
          cloned.name = replacement.name;
        } else if (replacement.kind === "LiteralExpr") {
          cloned.name = String(replacement.value);
        }
      }
      cloned.init = substituteExpr(cloned.init, subst, callSpan);
      break;
    }
    case "DestructureBinding": {
      cloned.names = cloned.names.map((n) => {
        if (subst.has(n)) {
          const replacement = subst.get(n)!;
          if (replacement.kind === "IdentifierExpr") {
            return replacement.name;
          } else if (replacement.kind === "LiteralExpr") {
            return String(replacement.value);
          }
        }
        return n;
      });
      cloned.init = substituteExpr(cloned.init, subst, callSpan);
      break;
    }
    case "AssignStmt":
      cloned.target = substituteExpr(cloned.target, subst, callSpan);
      cloned.value = substituteExpr(cloned.value, subst, callSpan);
      break;
    case "IfStmt":
      cloned.condition = substituteExpr(cloned.condition, subst, callSpan);
      cloned.thenBranch.statements = cloned.thenBranch.statements.map((s) =>
        substituteStatement(s, subst, callSpan),
      );
      for (const elif of cloned.elifBranches) {
        elif.condition = substituteExpr(elif.condition, subst, callSpan);
        elif.body.statements = elif.body.statements.map((s) =>
          substituteStatement(s, subst, callSpan),
        );
      }
      if (cloned.elseBranch) {
        cloned.elseBranch.statements = cloned.elseBranch.statements.map((s) =>
          substituteStatement(s, subst, callSpan),
        );
      }
      break;
    case "WhileStmt":
      cloned.condition = substituteExpr(cloned.condition, subst, callSpan);
      cloned.body.statements = cloned.body.statements.map((s) =>
        substituteStatement(s, subst, callSpan),
      );
      break;
    case "ForStmt":
      cloned.iterable = substituteExpr(cloned.iterable, subst, callSpan);
      cloned.body.statements = cloned.body.statements.map((s) =>
        substituteStatement(s, subst, callSpan),
      );
      break;
    case "TryStmt":
      cloned.tryBlock.statements = cloned.tryBlock.statements.map((s) =>
        substituteStatement(s, subst, callSpan),
      );
      if (cloned.catchBlock) {
        cloned.catchBlock.statements = cloned.catchBlock.statements.map((s) =>
          substituteStatement(s, subst, callSpan),
        );
      }
      if (cloned.finallyBlock) {
        cloned.finallyBlock.statements = cloned.finallyBlock.statements.map((s) =>
          substituteStatement(s, subst, callSpan),
        );
      }
      break;
    case "ThrowStmt":
      cloned.expr = substituteExpr(cloned.expr, subst, callSpan);
      break;
    case "MatchStmt":
      cloned.target = substituteExpr(cloned.target, subst, callSpan);
      cloned.cases = cloned.cases.map((c) => {
        const caseCopy = { ...c };
        if (caseCopy.guard) {
          caseCopy.guard = substituteExpr(caseCopy.guard, subst, callSpan);
        }
        if ("statements" in caseCopy.body) {
          caseCopy.body = {
            ...caseCopy.body,
            statements: caseCopy.body.statements.map((s) =>
              substituteStatement(s, subst, callSpan),
            ),
          };
        } else {
          caseCopy.body = substituteExpr(caseCopy.body, subst, callSpan);
        }
        return caseCopy;
      });
      break;
  }

  return cloned;
}

/**
 * Expands all project idiom calls in an AST module.
 */
export function expandModuleIdioms(
  mod: Module,
  idioms?: Record<string, ProjectIdiomDefinition>,
): Module {
  let expandedCount = 0;
  return expandModuleIdiomsInternal(mod, idioms, () => {
    expandedCount++;
  });
}

function expandModuleIdiomsInternal(
  mod: Module,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
  onExpanded?: (count: number) => void,
): Module {
  if (!idioms || Object.keys(idioms).length === 0) {
    return mod;
  }

  const clonedMod = structuredClone(mod);

  function parseDefaultExpr(defaultVal: string): Expr {
    try {
      const m = parse(`_tmp := ${defaultVal}`, "<idiom-default>");
      const first = m.items[0];
      if (first && first.kind === "FunctionDecl" && "statements" in first.body) {
        const s = first.body.statements[0];
        if (s && s.kind === "LetBinding") return s.init;
      }
      if (first && (first.kind === "ConstDecl" || first.kind === "VarDecl")) {
        return first.value;
      }
    } catch {
      // fallback below
    }
    return {
      kind: "IdentifierExpr",
      name: defaultVal,
      span: clonedMod.span,
    };
  }

  function buildSubst(def: ProjectIdiomDefinition, args: Expr[]): Map<string, Expr> {
    const subst = new Map<string, Expr>();
    const rawParams = def.params ?? [];
    for (let i = 0; i < rawParams.length; i++) {
      const rawP = rawParams[i] as ProjectIdiomParam | string;
      const pName = typeof rawP === "string" ? rawP : rawP.name;
      const pDefault = typeof rawP === "string" ? undefined : rawP.defaultValue;
      const arg =
        args[i] ??
        (pDefault !== undefined
          ? parseDefaultExpr(pDefault)
          : {
              kind: "IdentifierExpr",
              name: "nil",
              span: clonedMod.span,
            });
      subst.set(pName, arg);
      subst.set(`$${i}`, arg);
    }
    return subst;
  }

  function transformExpr(expr: Expr, depth = 0): Expr {
    if (!expr || depth > 16) return expr;

    // Check if this expression is an idiom call
    if (
      expr.kind === "CallExpr" &&
      expr.callee.kind === "IdentifierExpr" &&
      Object.hasOwn(idioms!, expr.callee.name)
    ) {
      const idiomName = expr.callee.name;
      const def = idioms![idiomName];
      const selfRefs = extractReferencedIdiomNamesFromTemplate(
        def.templateAil,
        new Set([idiomName, def.name]),
      );
      if (selfRefs.length > 0) {
        throw new IdiomCycleError(`Direct recursive cycle detected in idiom '${idiomName}'`);
      }
      const parsed = getOrParseTemplate(def);
      const transformedArgs = expr.args.map((a) => transformExpr(a, depth + 1));
      const subst = buildSubst(def, transformedArgs);

      if (def.kind === "expr" && parsed.expr) {
        onExpanded?.(1);
        const expanded = substituteExpr(parsed.expr, subst, expr.span);
        return transformExpr(expanded, depth + 1);
      }

      if (def.kind === "stmt" && parsed.statements && parsed.statements.length === 1) {
        const stmt = parsed.statements[0];
        if (stmt.kind === "ExprStmt") {
          onExpanded?.(1);
          const expanded = substituteExpr(stmt.expr, subst, expr.span);
          return transformExpr(expanded, depth + 1);
        }
        if (stmt.kind === "ReturnStmt" && stmt.value) {
          onExpanded?.(1);
          const expanded = substituteExpr(stmt.value, subst, expr.span);
          return transformExpr(expanded, depth + 1);
        }
      }
    }

    // Transform child expressions
    switch (expr.kind) {
      case "CallExpr":
        expr.callee = transformExpr(expr.callee, depth);
        expr.args = expr.args.map((a) => transformExpr(a, depth));
        break;
      case "MemberAccessExpr":
        expr.object = transformExpr(expr.object, depth);
        break;
      case "IndexExpr":
        expr.object = transformExpr(expr.object, depth);
        expr.index = transformExpr(expr.index, depth);
        break;
      case "BinaryExpr":
        expr.left = transformExpr(expr.left, depth);
        expr.right = transformExpr(expr.right, depth);
        break;
      case "UnaryExpr":
        expr.operand = transformExpr(expr.operand, depth);
        break;
      case "PostfixTryExpr":
        expr.operand = transformExpr(expr.operand, depth);
        break;
      case "ArrayLiteralExpr":
        expr.elements = expr.elements.map((e) => transformExpr(e, depth));
        break;
      case "RecordLiteralExpr":
        for (const prop of expr.properties) {
          prop.value = transformExpr(prop.value, depth);
        }
        break;
      case "TemplateLiteralExpr":
        expr.expressions = expr.expressions.map((e) => transformExpr(e, depth));
        break;
      case "ClosureExpr":
        if ("statements" in expr.body) {
          const outerScope = new Set<string>(expr.params.map((p) => p.name));
          transformBlock(expr.body, outerScope, depth);
        } else {
          expr.body = transformExpr(expr.body, depth);
        }
        break;
      case "AwaitExpr":
        expr.operand = transformExpr(expr.operand, depth);
        break;
      case "AssignExpr":
        expr.target = transformExpr(expr.target, depth);
        expr.value = transformExpr(expr.value, depth);
        break;
    }

    return expr;
  }

  function collectDeclaredLocalNames(stmts: Statement[], out: Set<string>): void {
    for (const stmt of stmts) {
      if (stmt.kind === "LetBinding") {
        out.add(stmt.name);
      } else if (stmt.kind === "DestructureBinding") {
        for (const n of stmt.names) out.add(n);
      } else if (stmt.kind === "ForStmt") {
        out.add(stmt.variable);
        collectDeclaredLocalNames(stmt.body.statements, out);
      } else if (stmt.kind === "IfStmt") {
        collectDeclaredLocalNames(stmt.thenBranch.statements, out);
        for (const elif of stmt.elifBranches) {
          collectDeclaredLocalNames(elif.body.statements, out);
        }
        if (stmt.elseBranch) {
          collectDeclaredLocalNames(stmt.elseBranch.statements, out);
        }
      } else if (stmt.kind === "WhileStmt") {
        collectDeclaredLocalNames(stmt.body.statements, out);
      } else if (stmt.kind === "TryStmt") {
        collectDeclaredLocalNames(stmt.tryBlock.statements, out);
        if (stmt.catchBlock) {
          if (stmt.catchParam) out.add(stmt.catchParam);
          collectDeclaredLocalNames(stmt.catchBlock.statements, out);
        }
        if (stmt.finallyBlock) {
          collectDeclaredLocalNames(stmt.finallyBlock.statements, out);
        }
      } else if (stmt.kind === "MatchStmt") {
        for (const c of stmt.cases) {
          if ("statements" in c.body) {
            collectDeclaredLocalNames(c.body.statements, out);
          }
        }
      }
    }
  }

  function transformBlock(
    block: Block,
    outerScopeNames?: Set<string>,
    depth = 0,
  ): void {
    if (depth > 16) return;
    const newStatements: Statement[] = [];
    const usedNamesInBlock = new Set<string>(outerScopeNames);
    const boundBeforeCurrentStmt = new Set<string>(outerScopeNames);
    for (const stmt of block.statements) {
      collectIdentifiersInStatement(stmt, usedNamesInBlock);
    }

    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i];
      // Check if statement is an idiom call
      if (
        stmt.kind === "ExprStmt" &&
        stmt.expr.kind === "CallExpr" &&
        stmt.expr.callee.kind === "IdentifierExpr" &&
        Object.hasOwn(idioms!, stmt.expr.callee.name)
      ) {
        const call = stmt.expr;
        const idiomName = (call.callee as IdentifierExpr).name;
        const def = idioms![idiomName];
        const selfRefs = extractReferencedIdiomNamesFromTemplate(
          def.templateAil,
          new Set([idiomName, def.name]),
        );
        if (selfRefs.length > 0) {
          throw new IdiomCycleError(`Direct recursive cycle detected in idiom '${idiomName}'`);
        }
        const parsed = getOrParseTemplate(def);
        const transformedArgs = call.args.map((a) => transformExpr(a, depth + 1));
        const subst = buildSubst(def, transformedArgs);

        const argIdentNames = new Set<string>();
        collectIdentifiersInStatement(
          {
            kind: "ExprStmt",
            expr: { ...call, args: transformedArgs },
            span: call.span,
          },
          argIdentNames,
        );

        if (
          (def.kind === "stmt" || def.kind === "block") &&
          parsed.statements &&
          parsed.statements.length > 0
        ) {
          onExpanded?.(1);

          // Hygienic alpha-renaming: disambiguate local template variable bindings
          // against names already bound before this statement, passed in args, or internal _loc names.
          const disambiguateMap = new Map<string, string>();
          const declaredNames = new Set<string>();
          collectDeclaredLocalNames(parsed.statements, declaredNames);

          for (const name of declaredNames) {
            if (name.startsWith("$")) continue;
            const isReferencedLater = isIdentifierReferencedInStatements(
              block.statements.slice(i + 1),
              name,
            );
            const collidesWithCaller =
              boundBeforeCurrentStmt.has(name) || argIdentNames.has(name);
            const shouldDisambiguate =
              name.startsWith("_loc") || collidesWithCaller || !isReferencedLater;

            if (shouldDisambiguate && (usedNamesInBlock.has(name) || collidesWithCaller)) {
              let suffix = 2;
              let freshName = `${name}_${suffix}`;
              while (usedNamesInBlock.has(freshName) || argIdentNames.has(freshName)) {
                suffix++;
                freshName = `${name}_${suffix}`;
              }
              disambiguateMap.set(name, freshName);
              usedNamesInBlock.add(freshName);
              boundBeforeCurrentStmt.add(freshName);
            } else {
              usedNamesInBlock.add(name);
              boundBeforeCurrentStmt.add(name);
            }
          }

          const expandedStmts: Statement[] = [];
          for (const s of parsed.statements) {
            let prepared = s;
            if (disambiguateMap.size > 0) {
              prepared = renameIdentifiersInStatement(s, disambiguateMap);
            }
            const substituted = substituteStatement(prepared, subst, call.span);
            expandedStmts.push(substituted);
          }

          const tempBlock: Block = {
            kind: "Block",
            statements: expandedStmts,
            span: call.span,
          };
          transformBlock(tempBlock, usedNamesInBlock, depth + 1);
          newStatements.push(...tempBlock.statements);
          continue;
        }

        if (def.kind === "expr" && parsed.expr) {
          onExpanded?.(1);
          const substituted = substituteExpr(parsed.expr, subst, call.span);
          const expandedExpr = transformExpr(substituted, depth + 1);
          newStatements.push({
            kind: "ExprStmt",
            expr: expandedExpr,
            span: call.span,
          });
          continue;
        }
      }

      // Normal statement: transform sub-expressions & nested blocks
      switch (stmt.kind) {
        case "ExprStmt":
          stmt.expr = transformExpr(stmt.expr, depth);
          newStatements.push(stmt);
          break;
        case "ReturnStmt":
          if (stmt.value) stmt.value = transformExpr(stmt.value, depth);
          newStatements.push(stmt);
          break;
        case "LetBinding":
          stmt.init = transformExpr(stmt.init, depth);
          boundBeforeCurrentStmt.add(stmt.name);
          newStatements.push(stmt);
          break;
        case "DestructureBinding":
          stmt.init = transformExpr(stmt.init, depth);
          for (const n of stmt.names) boundBeforeCurrentStmt.add(n);
          newStatements.push(stmt);
          break;
        case "AssignStmt":
          stmt.target = transformExpr(stmt.target, depth);
          stmt.value = transformExpr(stmt.value, depth);
          newStatements.push(stmt);
          break;
        case "IfStmt":
          stmt.condition = transformExpr(stmt.condition, depth);
          transformBlock(stmt.thenBranch, usedNamesInBlock, depth);
          for (const elif of stmt.elifBranches) {
            elif.condition = transformExpr(elif.condition, depth);
            transformBlock(elif.body, usedNamesInBlock, depth);
          }
          if (stmt.elseBranch) transformBlock(stmt.elseBranch, usedNamesInBlock, depth);
          newStatements.push(stmt);
          break;
        case "WhileStmt":
          stmt.condition = transformExpr(stmt.condition, depth);
          transformBlock(stmt.body, usedNamesInBlock, depth);
          newStatements.push(stmt);
          break;
        case "ForStmt":
          stmt.iterable = transformExpr(stmt.iterable, depth);
          transformBlock(stmt.body, usedNamesInBlock, depth);
          newStatements.push(stmt);
          break;
        case "TryStmt":
          transformBlock(stmt.tryBlock, usedNamesInBlock, depth);
          if (stmt.catchBlock) transformBlock(stmt.catchBlock, usedNamesInBlock, depth);
          if (stmt.finallyBlock) transformBlock(stmt.finallyBlock, usedNamesInBlock, depth);
          newStatements.push(stmt);
          break;
        case "ThrowStmt":
          stmt.expr = transformExpr(stmt.expr, depth);
          newStatements.push(stmt);
          break;
        case "MatchStmt":
          stmt.target = transformExpr(stmt.target, depth);
          for (const c of stmt.cases) {
            if (c.guard) c.guard = transformExpr(c.guard, depth);
            if ("statements" in c.body) {
              transformBlock(c.body, usedNamesInBlock, depth);
            } else {
              c.body = transformExpr(c.body, depth);
            }
          }
          newStatements.push(stmt);
          break;
        default:
          newStatements.push(stmt);
          break;
      }
    }

    block.statements = newStatements;
  }

  function transformDeclBody(decl: {
    params: { name: string }[];
    body: Block | Expr;
    isExpressionBodied?: boolean;
  }): void {
    const outerScope = new Set<string>(decl.params.map((p) => p.name));
    if ("statements" in decl.body) {
      transformBlock(decl.body, outerScope);
      return;
    }
    const bodyExpr = decl.body as Expr;
    if (
      bodyExpr &&
      bodyExpr.kind === "CallExpr" &&
      bodyExpr.callee.kind === "IdentifierExpr" &&
      Object.hasOwn(idioms!, bodyExpr.callee.name)
    ) {
      const def = idioms![bodyExpr.callee.name];
      if (def.kind === "stmt" || def.kind === "block") {
        const synthBlock: Block = {
          kind: "Block",
          statements: [{ kind: "ExprStmt", expr: bodyExpr, span: bodyExpr.span }],
          span: bodyExpr.span,
        };
        transformBlock(synthBlock, outerScope);
        decl.isExpressionBodied = false;
        decl.body = synthBlock;
        return;
      }
    }
    decl.body = transformExpr(bodyExpr);
  }

  // Traverse module items
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl") {
      transformDeclBody(item);
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        transformDeclBody(m);
      }
      for (const p of item.properties) {
        if (p.initialValue) {
          p.initialValue = transformExpr(p.initialValue);
        }
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) {
          transformBlock(sb);
        }
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      item.value = transformExpr(item.value);
    } else if (item.kind === "ComponentDecl") {
      const expandLayoutList = (nodes: LayoutNode[], depth = 0): LayoutNode[] => {
        if (depth > 16) return nodes;
        const out: LayoutNode[] = [];
        for (const node of nodes) {
          const bareTag = node.tag.startsWith("$") ? node.tag.slice(1) : node.tag;
          const def =
            node.tag.startsWith("$") &&
            (idioms![node.tag] ?? idioms![bareTag]);
          if (def) {
            const parsed = getOrParseTemplate(def);
            if (parsed.layoutNodes && parsed.layoutNodes.length > 0) {
              const args = node.attributes.map((a) => transformExpr(a.value, depth + 1));
              const subst = buildSubst(def, args);
              onExpanded?.(1);
              const expandedNodes = parsed.layoutNodes.map((ln) =>
                substituteLayoutNode(ln, subst, node.span),
              );
              out.push(...expandLayoutList(expandedNodes, depth + 1));
              continue;
            }
          }
          for (const attr of node.attributes) {
            if (attr.value) attr.value = transformExpr(attr.value, depth);
          }
          if (node.childExpr) node.childExpr = transformExpr(node.childExpr, depth);
          node.children = expandLayoutList(node.children, depth);
          out.push(node);
        }
        return out;
      };
      item.layout = expandLayoutList(item.layout);
    } else if (item.kind === "StyleDecl") {
      const expandProps = (props: StyleProperty[], depth = 0): StyleProperty[] => {
        if (depth > 16) return props;
        const out: StyleProperty[] = [];
        for (const p of props) {
          const macroMatch = p.property.trim().match(/^(\$[a-zA-Z_][a-zA-Z0-9_]*)\(([\s\S]*)\)$/);
          if (macroMatch) {
            const idiomName = macroMatch[1];
            const bareName = idiomName.slice(1);
            const def = idioms![idiomName] ?? idioms![bareName];
            if (def) {
              const parsed = getOrParseTemplate(def);
              if (parsed.styleProperties && parsed.styleProperties.length > 0) {
                const rawArgs = splitTopLevelCssArgs(macroMatch[2]);
                const rawParams = def.params ?? [];
                const subst = new Map<string, string>();
                for (let idx = 0; idx < rawParams.length; idx++) {
                  const rawP = rawParams[idx] as ProjectIdiomParam | string;
                  const pName = typeof rawP === "string" ? rawP : rawP.name;
                  const pDefault = typeof rawP === "string" ? undefined : rawP.defaultValue;
                  const val = rawArgs[idx] ?? pDefault ?? "";
                  subst.set(pName, val);
                  subst.set(`$${idx}`, val);
                }
                onExpanded?.(1);
                const expanded: StyleProperty[] = parsed.styleProperties.map((sp) => ({
                  property: sp.property,
                  value: subst.has(sp.value.trim()) ? subst.get(sp.value.trim())! : sp.value,
                  span: p.span,
                }));
                out.push(...expandProps(expanded, depth + 1));
                continue;
              }
            }
          }
          out.push(p);
        }
        return out;
      };
      const expandStyleDecl = (decl: StyleDecl): void => {
        decl.properties = expandProps(decl.properties);
        if (decl.children && decl.children.length > 0) {
          for (const child of decl.children) {
            expandStyleDecl(child);
          }
        }
      };
      expandStyleDecl(item);
    }
  }

  return clonedMod;
}

/**
 * Matches an AST template expression against a target expression, extracting hole bindings.
 */
function matchExprTemplate(
  templateExpr: Expr,
  targetExpr: Expr,
  bindings: Map<string, Expr>,
  holeNames: Set<string>,
  generator: AilGenerator,
  alphaMap?: Map<string, string>,
): boolean {
  if (templateExpr.kind === "IdentifierExpr" && holeNames.has(templateExpr.name)) {
    if (bindings.has(templateExpr.name)) {
      const existing = bindings.get(templateExpr.name)!;
      return generator.formatExpr(existing) === generator.formatExpr(targetExpr);
    }
    bindings.set(templateExpr.name, targetExpr);
    return true;
  }

  if (templateExpr.kind === "IdentifierExpr" && alphaMap?.has(templateExpr.name)) {
    if (targetExpr.kind !== "IdentifierExpr") return false;
    return targetExpr.name === alphaMap.get(templateExpr.name);
  }

  if (templateExpr.kind !== targetExpr.kind) {
    return false;
  }

  switch (templateExpr.kind) {
    case "LiteralExpr":
      return (
        templateExpr.rawValue === (targetExpr as LiteralExpr).rawValue ||
        templateExpr.value === (targetExpr as LiteralExpr).value
      );
    case "IdentifierExpr": {
      const targetName = (targetExpr as IdentifierExpr).name;
      if (alphaMap) {
        for (const mapped of alphaMap.values()) {
          if (mapped === targetName) return false;
        }
      }
      return templateExpr.name === targetName;
    }
    case "BinaryExpr": {
      const t = templateExpr as BinaryExpr;
      const tg = targetExpr as BinaryExpr;
      return (
        t.operator === tg.operator &&
        matchExprTemplate(t.left, tg.left, bindings, holeNames, generator, alphaMap) &&
        matchExprTemplate(t.right, tg.right, bindings, holeNames, generator, alphaMap)
      );
    }
    case "UnaryExpr": {
      const t = templateExpr as UnaryExpr;
      const tg = targetExpr as UnaryExpr;
      return (
        t.operator === tg.operator &&
        matchExprTemplate(t.operand, tg.operand, bindings, holeNames, generator, alphaMap)
      );
    }
    case "CallExpr": {
      const t = templateExpr as CallExpr;
      const tg = targetExpr as CallExpr;

      const getMathCallee = (callee: Expr): string | null => {
        if (callee.kind === "IdentifierExpr") return callee.name;
        if (
          callee.kind === "MemberAccessExpr" &&
          callee.object.kind === "IdentifierExpr" &&
          callee.object.name === "Math"
        ) {
          return callee.property;
        }
        return null;
      };

      const extractClamp = (
        call: CallExpr,
      ): { val: Expr; min: Expr; max: Expr } | null => {
        const fn = getMathCallee(call.callee);
        if (fn === "clamp" && call.args.length === 3) {
          return { val: call.args[0], min: call.args[1], max: call.args[2] };
        }
        if (fn === "max" && call.args.length === 2) {
          const second = call.args[1];
          if (
            second.kind === "CallExpr" &&
            getMathCallee(second.callee) === "min" &&
            second.args.length === 2
          ) {
            return {
              min: call.args[0],
              max: second.args[0],
              val: second.args[1],
            };
          }
        }
        if (fn === "min" && call.args.length === 2) {
          const first = call.args[0];
          if (
            first.kind === "CallExpr" &&
            getMathCallee(first.callee) === "max" &&
            first.args.length === 2
          ) {
            return {
              val: first.args[0],
              min: first.args[1],
              max: call.args[1],
            };
          }
        }
        return null;
      };

      if (t.args.length === tg.args.length) {
        const savedBindings = new Map(bindings);
        const tMath = getMathCallee(t.callee);
        const tgMath = getMathCallee(tg.callee);
        const calleeMatched =
          matchExprTemplate(t.callee, tg.callee, savedBindings, holeNames, generator, alphaMap) ||
          (tMath !== null &&
            tMath === tgMath &&
            !holeNames.has(tMath));
        if (calleeMatched) {
          let allArgsMatch = true;
          for (let i = 0; i < t.args.length; i++) {
            if (
              !matchExprTemplate(
                t.args[i],
                tg.args[i],
                savedBindings,
                holeNames,
                generator,
                alphaMap,
              )
            ) {
              allArgsMatch = false;
              break;
            }
          }
          if (allArgsMatch) {
            bindings.clear();
            for (const [k, v] of savedBindings) bindings.set(k, v);
            return true;
          }
        }
      }

      const tClamp = extractClamp(t);
      const tgClamp = extractClamp(tg);
      if (tClamp && tgClamp) {
        const savedBindings = new Map(bindings);
        if (
          matchExprTemplate(tClamp.val, tgClamp.val, savedBindings, holeNames, generator, alphaMap) &&
          matchExprTemplate(tClamp.min, tgClamp.min, savedBindings, holeNames, generator, alphaMap) &&
          matchExprTemplate(tClamp.max, tgClamp.max, savedBindings, holeNames, generator, alphaMap)
        ) {
          bindings.clear();
          for (const [k, v] of savedBindings) bindings.set(k, v);
          return true;
        }
      }

      return false;
    }
    case "MemberAccessExpr": {
      const t = templateExpr as MemberAccessExpr;
      const tg = targetExpr as MemberAccessExpr;
      return (
        t.property === tg.property &&
        matchExprTemplate(t.object, tg.object, bindings, holeNames, generator, alphaMap)
      );
    }
    case "ArrayLiteralExpr": {
      const t = templateExpr as ArrayLiteralExpr;
      const tg = targetExpr as ArrayLiteralExpr;
      if (t.elements.length !== tg.elements.length) return false;
      for (let i = 0; i < t.elements.length; i++) {
        if (!matchExprTemplate(t.elements[i], tg.elements[i], bindings, holeNames, generator, alphaMap)) {
          return false;
        }
      }
      return true;
    }
    case "RecordLiteralExpr": {
      const t = templateExpr as RecordLiteralExpr;
      const tg = targetExpr as RecordLiteralExpr;
      if (t.properties.length !== tg.properties.length) return false;
      for (let i = 0; i < t.properties.length; i++) {
        if (t.properties[i].key !== tg.properties[i].key) return false;
        if (!matchExprTemplate(t.properties[i].value, tg.properties[i].value, bindings, holeNames, generator, alphaMap)) {
          return false;
        }
      }
      return true;
    }
    case "TemplateLiteralExpr": {
      const t = templateExpr as TemplateLiteralExpr;
      const tg = targetExpr as TemplateLiteralExpr;
      if (t.quasis.length !== tg.quasis.length || t.expressions.length !== tg.expressions.length) return false;
      for (let i = 0; i < t.quasis.length; i++) {
        if (t.quasis[i] !== tg.quasis[i]) return false;
      }
      for (let i = 0; i < t.expressions.length; i++) {
        if (!matchExprTemplate(t.expressions[i], tg.expressions[i], bindings, holeNames, generator, alphaMap)) {
          return false;
        }
      }
      return true;
    }
    case "AwaitExpr": {
      const t = templateExpr as AwaitExpr;
      const tg = targetExpr as AwaitExpr;
      return matchExprTemplate(t.operand, tg.operand, bindings, holeNames, generator, alphaMap);
    }
    case "AssignExpr": {
      const t = templateExpr as AssignExpr;
      const tg = targetExpr as AssignExpr;
      return (
        matchExprTemplate(t.target, tg.target, bindings, holeNames, generator, alphaMap) &&
        matchExprTemplate(t.value, tg.value, bindings, holeNames, generator, alphaMap)
      );
    }
    case "PostfixTryExpr": {
      const t = templateExpr as PostfixTryExpr;
      const tg = targetExpr as PostfixTryExpr;
      return matchExprTemplate(t.operand, tg.operand, bindings, holeNames, generator, alphaMap);
    }
    case "IndexExpr": {
      const t = templateExpr as IndexExpr;
      const tg = targetExpr as IndexExpr;
      return (
        matchExprTemplate(t.object, tg.object, bindings, holeNames, generator, alphaMap) &&
        matchExprTemplate(t.index, tg.index, bindings, holeNames, generator, alphaMap)
      );
    }
    case "ClosureExpr": {
      const t = templateExpr as ClosureExpr;
      const tg = targetExpr as ClosureExpr;
      if (t.params.length !== tg.params.length) return false;
      if (("statements" in t.body) !== ("statements" in tg.body)) return false;
      if ("statements" in t.body) {
        const tb = t.body as Block;
        const tgb = tg.body as Block;
        if (tb.statements.length !== tgb.statements.length) return false;
        for (let i = 0; i < tb.statements.length; i++) {
          if (!matchStatementTemplate(tb.statements[i], tgb.statements[i], bindings, holeNames, generator, alphaMap)) return false;
        }
        return true;
      } else {
        return matchExprTemplate(t.body as Expr, tg.body as Expr, bindings, holeNames, generator, alphaMap);
      }
    }
    default:
      return generator.formatExpr(templateExpr) === generator.formatExpr(targetExpr);
  }
}

/**
 * Matches an AST template statement against a target statement.
 */
function matchStatementTemplate(
  templateStmt: Statement,
  targetStmt: Statement,
  bindings: Map<string, Expr>,
  holeNames: Set<string>,
  generator: AilGenerator,
  alphaMap?: Map<string, string>,
  remainingStmts?: Statement[],
): boolean {
  if (templateStmt.kind !== targetStmt.kind) return false;

  switch (templateStmt.kind) {
    case "ExprStmt":
      return matchExprTemplate(
        templateStmt.expr,
        (targetStmt as ExprStmt).expr,
        bindings,
        holeNames,
        generator,
        alphaMap,
      );
    case "ReturnStmt": {
      const t = templateStmt as ReturnStmt;
      const tg = targetStmt as ReturnStmt;
      if (Boolean(t.value) !== Boolean(tg.value)) return false;
      if (t.value && tg.value) {
        return matchExprTemplate(t.value, tg.value, bindings, holeNames, generator, alphaMap);
      }
      return true;
    }
    case "LetBinding": {
      const t = templateStmt as LetBinding;
      const tg = targetStmt as LetBinding;
      if (t.isMut !== tg.isMut) return false;
      if (holeNames.has(t.name)) {
        bindings.set(t.name, {
          kind: "IdentifierExpr",
          name: tg.name,
          span: tg.span,
        });
      } else if (alphaMap && (t.name.startsWith("_loc") || !t.name.startsWith("$"))) {
        // If the variable escapes the window into the remaining statements, cannot collapse safely
        if (remainingStmts && isIdentifierReferencedInStatements(remainingStmts, tg.name)) {
          return false;
        }
        if (alphaMap.has(t.name)) {
          if (alphaMap.get(t.name) !== tg.name) return false;
        } else {
          // Disallow two distinct template variables mapping to the same target variable
          for (const mapped of alphaMap.values()) {
            if (mapped === tg.name) return false;
          }
          alphaMap.set(t.name, tg.name);
        }
      } else if (t.name !== tg.name) {
        return false;
      }
      return matchExprTemplate(t.init, tg.init, bindings, holeNames, generator, alphaMap);
    }
    case "DestructureBinding": {
      const t = templateStmt as DestructureBinding;
      const tg = targetStmt as DestructureBinding;
      if (t.names.length !== tg.names.length) return false;
      for (let i = 0; i < t.names.length; i++) {
        if (holeNames.has(t.names[i])) {
          bindings.set(t.names[i], {
            kind: "IdentifierExpr",
            name: tg.names[i],
            span: tg.span,
          });
        } else if (t.names[i] !== tg.names[i]) {
          return false;
        }
      }
      return matchExprTemplate(t.init, tg.init, bindings, holeNames, generator, alphaMap);
    }
    case "ThrowStmt": {
      const t = templateStmt as ThrowStmt;
      const tg = targetStmt as ThrowStmt;
      return matchExprTemplate(t.expr, tg.expr, bindings, holeNames, generator, alphaMap);
    }
    case "AssignStmt": {
      const t = templateStmt as AssignStmt;
      const tg = targetStmt as AssignStmt;
      if (t.op !== tg.op) return false;
      return (
        matchExprTemplate(t.target, tg.target, bindings, holeNames, generator, alphaMap) &&
        matchExprTemplate(t.value, tg.value, bindings, holeNames, generator, alphaMap)
      );
    }
    case "IfStmt": {
      const t = templateStmt as IfStmt;
      const tg = targetStmt as IfStmt;
      if (!matchExprTemplate(t.condition, tg.condition, bindings, holeNames, generator, alphaMap)) {
        return false;
      }
      if (t.thenBranch.statements.length !== tg.thenBranch.statements.length) {
        return false;
      }
      for (let i = 0; i < t.thenBranch.statements.length; i++) {
        if (
          !matchStatementTemplate(
            t.thenBranch.statements[i],
            tg.thenBranch.statements[i],
            bindings,
            holeNames,
            generator,
            alphaMap,
            remainingStmts,
          )
        ) {
          return false;
        }
      }
      if (t.elifBranches.length !== tg.elifBranches.length) return false;
      for (let e = 0; e < t.elifBranches.length; e++) {
        if (
          !matchExprTemplate(
            t.elifBranches[e].condition,
            tg.elifBranches[e].condition,
            bindings,
            holeNames,
            generator,
            alphaMap,
          )
        ) {
          return false;
        }
        if (t.elifBranches[e].body.statements.length !== tg.elifBranches[e].body.statements.length) {
          return false;
        }
        for (let j = 0; j < t.elifBranches[e].body.statements.length; j++) {
          if (
            !matchStatementTemplate(
              t.elifBranches[e].body.statements[j],
              tg.elifBranches[e].body.statements[j],
              bindings,
              holeNames,
              generator,
              alphaMap,
              remainingStmts,
            )
          ) {
            return false;
          }
        }
      }
      if (Boolean(t.elseBranch) !== Boolean(tg.elseBranch)) return false;
      if (t.elseBranch && tg.elseBranch) {
        if (t.elseBranch.statements.length !== tg.elseBranch.statements.length) return false;
        for (let j = 0; j < t.elseBranch.statements.length; j++) {
          if (
            !matchStatementTemplate(
              t.elseBranch.statements[j],
              tg.elseBranch.statements[j],
              bindings,
              holeNames,
              generator,
              alphaMap,
              remainingStmts,
            )
          ) {
            return false;
          }
        }
      }
      return true;
    }
    case "WhileStmt": {
      const t = templateStmt as WhileStmt;
      const tg = targetStmt as WhileStmt;
      if (!matchExprTemplate(t.condition, tg.condition, bindings, holeNames, generator, alphaMap)) {
        return false;
      }
      if (t.body.statements.length !== tg.body.statements.length) return false;
      for (let j = 0; j < t.body.statements.length; j++) {
        if (
          !matchStatementTemplate(
            t.body.statements[j],
            tg.body.statements[j],
            bindings,
            holeNames,
            generator,
            alphaMap,
            remainingStmts,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    case "ForStmt": {
      const t = templateStmt as ForStmt;
      const tg = targetStmt as ForStmt;
      if (t.variable !== tg.variable) {
        if (alphaMap && (t.variable.startsWith("_loc") || !t.variable.startsWith("$"))) {
          if (remainingStmts && isIdentifierReferencedInStatements(remainingStmts, tg.variable)) {
            return false;
          }
          if (alphaMap.has(t.variable)) {
            if (alphaMap.get(t.variable) !== tg.variable) return false;
          } else {
            alphaMap.set(t.variable, tg.variable);
          }
        } else {
          return false;
        }
      }
      if (!matchExprTemplate(t.iterable, tg.iterable, bindings, holeNames, generator, alphaMap)) {
        return false;
      }
      if (t.body.statements.length !== tg.body.statements.length) return false;
      for (let j = 0; j < t.body.statements.length; j++) {
        if (
          !matchStatementTemplate(
            t.body.statements[j],
            tg.body.statements[j],
            bindings,
            holeNames,
            generator,
            alphaMap,
            remainingStmts,
          )
        ) {
          return false;
        }
      }
      return true;
    }
    case "MatchStmt": {
      const t = templateStmt as MatchStmt;
      const tg = targetStmt as MatchStmt;
      if (t.cases.length !== tg.cases.length) return false;
      if (!matchExprTemplate(t.target, tg.target, bindings, holeNames, generator, alphaMap)) {
        return false;
      }
      for (let i = 0; i < t.cases.length; i++) {
        const tc = t.cases[i];
        const tgc = tg.cases[i];
        if (Boolean(tc.guard) !== Boolean(tgc.guard)) return false;
        if (tc.guard && tgc.guard) {
          if (!matchExprTemplate(tc.guard, tgc.guard, bindings, holeNames, generator, alphaMap)) return false;
        }
        if (("statements" in tc.body) !== ("statements" in tgc.body)) return false;
        if ("statements" in tc.body) {
          const tStmts = (tc.body as Block).statements;
          const tgStmts = (tgc.body as Block).statements;
          if (tStmts.length !== tgStmts.length) return false;
          for (let s = 0; s < tStmts.length; s++) {
            if (!matchStatementTemplate(tStmts[s], tgStmts[s], bindings, holeNames, generator, alphaMap, remainingStmts)) return false;
          }
        } else {
          if (!matchExprTemplate(tc.body as Expr, tgc.body as Expr, bindings, holeNames, generator, alphaMap)) return false;
        }
      }
      return true;
    }
    default:
      return (
        generator.formatStatement(templateStmt) ===
        generator.formatStatement(targetStmt)
      );
  }
}

/**
 * Collapses repetitive code patterns into idiom calls across a Module AST.
 */
export function collapseModuleIdioms(
  mod: Module,
  idioms?: Record<string, ProjectIdiomDefinition>,
  onCollapsed?: (idiomName: string, args: string[], span: Span, symbol?: string) => void,
): { ast: Module; collapsedCount: number } {
  if (!idioms || Object.keys(idioms).length === 0) {
    return { ast: mod, collapsedCount: 0 };
  }

  const clonedMod = structuredClone(mod);
  let collapsedCount = 0;
  let currentSymbol: string | undefined;
  const generator = new AilGenerator();

  // Sort idioms by tokensPerOccurrenceSaved descending
  const sortedIdioms = Object.entries(idioms)
    .map(([key, def]): ProjectIdiomDefinition => {
      const normName = (def.name || key).startsWith("$") ? def.name || key : `$${def.name || key}`;
      const templateAil = def.templateAil ?? (def as { template?: string }).template ?? "";
      const params = (def.params ?? []).map((p) =>
        typeof p === "string" ? { name: p } : p,
      );
      return {
        ...def,
        name: normName,
        templateAil,
        params,
        tokensPerOccurrenceSaved: def.tokensPerOccurrenceSaved ?? 10,
      };
    })
    .sort((a, b) => b.tokensPerOccurrenceSaved - a.tokensPerOccurrenceSaved);

  const stmtIdioms = sortedIdioms.filter((i) => i.kind === "stmt" || i.kind === "block");
  const exprIdioms = sortedIdioms.filter((i) => i.kind === "expr");

  function collapseBlock(block: Block): void {
    let i = 0;
    while (i < block.statements.length) {
      let matched = false;

      // 1. Try statement & block idioms
      for (const idiom of stmtIdioms) {
        const parsed = getOrParseTemplate(idiom);
        const templateStmts = parsed.statements;
        if (!templateStmts || templateStmts.length === 0) continue;

        const k = templateStmts.length;
        if (i + k <= block.statements.length) {
          const window = block.statements.slice(i, i + k);
          const remainingStmts = block.statements.slice(i + k);
          const bindings = new Map<string, Expr>();
          const alphaMap = new Map<string, string>();
          const holeNames = new Set(idiom.params.map((p) => p.name));

          let windowMatches = true;
          for (let sIdx = 0; sIdx < k; sIdx++) {
            if (
              !matchStatementTemplate(
                templateStmts[sIdx],
                window[sIdx],
                bindings,
                holeNames,
                generator,
                alphaMap,
                remainingStmts,
              )
            ) {
              windowMatches = false;
              break;
            }
          }

          if (windowMatches) {
            const args: Expr[] = idiom.params.map(
              (p) =>
                bindings.get(p.name) ?? {
                  kind: "IdentifierExpr",
                  name: "nil",
                  span: window[0].span,
                },
            );

            const callSpan: Span = {
              file: window[0].span.file,
              start: window[0].span.start,
              end: window[k - 1].span.end,
            };

            const callStmt: Statement = {
              kind: "ExprStmt",
              expr: {
                kind: "CallExpr",
                callee: {
                  kind: "IdentifierExpr",
                  name: idiom.name,
                  span: callSpan,
                },
                args,
                span: callSpan,
              },
              span: callSpan,
            };

            block.statements.splice(i, k, callStmt);
            collapsedCount++;
            onCollapsed?.(
              idiom.name,
              args.map((a) => generator.formatExpr(a)),
              callSpan,
              currentSymbol,
            );
            matched = true;
            i += 1;
            break;
          }
        }
      }

      if (!matched) {
        // Recurse into statement bodies
        const currentStmt = block.statements[i];
        switch (currentStmt.kind) {
          case "IfStmt":
            collapseBlock(currentStmt.thenBranch);
            for (const elif of currentStmt.elifBranches) {
              collapseBlock(elif.body);
            }
            if (currentStmt.elseBranch) collapseBlock(currentStmt.elseBranch);
            break;
          case "WhileStmt":
            collapseBlock(currentStmt.body);
            break;
          case "ForStmt":
            collapseBlock(currentStmt.body);
            break;
          case "TryStmt":
            collapseBlock(currentStmt.tryBlock);
            if (currentStmt.catchBlock) collapseBlock(currentStmt.catchBlock);
            if (currentStmt.finallyBlock) collapseBlock(currentStmt.finallyBlock);
            break;
          case "MatchStmt":
            for (const c of currentStmt.cases) {
              if ("statements" in c.body) {
                collapseBlock(c.body);
              }
            }
            break;
        }
        i++;
      }
    }
  }

  function collapseExpr(expr: Expr): Expr {
    if (!expr) return expr;

    // First try matching this expression against expression idioms
    for (const idiom of exprIdioms) {
      const parsed = getOrParseTemplate(idiom);
      if (!parsed.expr) continue;

      const bindings = new Map<string, Expr>();
      const holeNames = new Set(idiom.params.map((p) => p.name));

      if (matchExprTemplate(parsed.expr, expr, bindings, holeNames, generator)) {
        const args: Expr[] = idiom.params.map(
          (p) =>
            bindings.get(p.name) ?? {
              kind: "IdentifierExpr",
              name: "nil",
              span: expr.span,
            },
        );

        collapsedCount++;
        onCollapsed?.(
          idiom.name,
          args.map((a) => generator.formatExpr(a)),
          expr.span,
          currentSymbol,
        );
        return {
          kind: "CallExpr",
          callee: {
            kind: "IdentifierExpr",
            name: idiom.name,
            span: expr.span,
          },
          args,
          span: expr.span,
        };
      }
    }

    // Recurse into children
    switch (expr.kind) {
      case "CallExpr":
        expr.callee = collapseExpr(expr.callee);
        expr.args = expr.args.map(collapseExpr);
        break;
      case "MemberAccessExpr":
        expr.object = collapseExpr(expr.object);
        break;
      case "IndexExpr":
        expr.object = collapseExpr(expr.object);
        expr.index = collapseExpr(expr.index);
        break;
      case "BinaryExpr":
        expr.left = collapseExpr(expr.left);
        expr.right = collapseExpr(expr.right);
        break;
      case "UnaryExpr":
        expr.operand = collapseExpr(expr.operand);
        break;
      case "PostfixTryExpr":
        expr.operand = collapseExpr(expr.operand);
        break;
      case "ArrayLiteralExpr":
        expr.elements = expr.elements.map(collapseExpr);
        break;
      case "RecordLiteralExpr":
        for (const p of expr.properties) {
          p.value = collapseExpr(p.value);
        }
        break;
      case "TemplateLiteralExpr":
        expr.expressions = expr.expressions.map(collapseExpr);
        break;
      case "ClosureExpr":
        if ("statements" in expr.body) {
          collapseExprsInBlock(expr.body);
        } else {
          expr.body = collapseExpr(expr.body);
        }
        break;
      case "AwaitExpr":
        expr.operand = collapseExpr(expr.operand);
        break;
      case "AssignExpr":
        expr.target = collapseExpr(expr.target);
        expr.value = collapseExpr(expr.value);
        break;
    }

    return expr;
  }

  function collapseExprsInBlock(block: Block): void {
    for (const stmt of block.statements) {
      switch (stmt.kind) {
        case "ExprStmt":
          stmt.expr = collapseExpr(stmt.expr);
          break;
        case "ReturnStmt":
          if (stmt.value) stmt.value = collapseExpr(stmt.value);
          break;
        case "LetBinding":
          stmt.init = collapseExpr(stmt.init);
          break;
        case "DestructureBinding":
          stmt.init = collapseExpr(stmt.init);
          break;
        case "AssignStmt":
          stmt.target = collapseExpr(stmt.target);
          stmt.value = collapseExpr(stmt.value);
          break;
        case "IfStmt":
          stmt.condition = collapseExpr(stmt.condition);
          collapseExprsInBlock(stmt.thenBranch);
          for (const elif of stmt.elifBranches) {
            elif.condition = collapseExpr(elif.condition);
            collapseExprsInBlock(elif.body);
          }
          if (stmt.elseBranch) collapseExprsInBlock(stmt.elseBranch);
          break;
        case "WhileStmt":
          stmt.condition = collapseExpr(stmt.condition);
          collapseExprsInBlock(stmt.body);
          break;
        case "ForStmt":
          stmt.iterable = collapseExpr(stmt.iterable);
          collapseExprsInBlock(stmt.body);
          break;
        case "TryStmt":
          collapseExprsInBlock(stmt.tryBlock);
          if (stmt.catchBlock) collapseExprsInBlock(stmt.catchBlock);
          if (stmt.finallyBlock) collapseExprsInBlock(stmt.finallyBlock);
          break;
        case "ThrowStmt":
          stmt.expr = collapseExpr(stmt.expr);
          break;
        case "MatchStmt":
          stmt.target = collapseExpr(stmt.target);
          for (const c of stmt.cases) {
            if (c.guard) c.guard = collapseExpr(c.guard);
            if ("statements" in c.body) {
              collapseExprsInBlock(c.body);
            } else {
              c.body = collapseExpr(c.body);
            }
          }
          break;
      }
    }
  }

  function tryCollapseAssignExprBody(fnOrMethod: {
    body: Block | Expr;
    isExpressionBodied?: boolean;
  }): void {
    if ("statements" in fnOrMethod.body) {
      collapseBlock(fnOrMethod.body);
      return;
    }
    const bodyExpr = fnOrMethod.body as Expr;
    if (bodyExpr && bodyExpr.kind === "AssignExpr") {
      const synthBlock: Block = {
        kind: "Block",
        statements: [
          {
            kind: "AssignStmt",
            target: bodyExpr.target,
            op: "=",
            value: bodyExpr.value,
            span: bodyExpr.span,
          },
        ],
        span: bodyExpr.span,
      };
      const before = collapsedCount;
      collapseBlock(synthBlock);
      if (collapsedCount > before) {
        fnOrMethod.isExpressionBodied = false;
        fnOrMethod.body = synthBlock;
      }
    }
  }

  // Pass 1: Collapse statements
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl") {
      currentSymbol = item.name;
      tryCollapseAssignExprBody(item);
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        currentSymbol = `${item.name}.${m.name}`;
        tryCollapseAssignExprBody(m);
      }
      if (item.staticBlocks) {
        currentSymbol = `${item.name}.<static>`;
        for (const sb of item.staticBlocks) collapseBlock(sb);
      }
    }
  }

  // Pass 2: Collapse expressions
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl") {
      currentSymbol = item.name;
      if ("statements" in item.body) {
        collapseExprsInBlock(item.body);
      } else {
        item.body = collapseExpr(item.body as Expr);
      }
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        currentSymbol = `${item.name}.${m.name}`;
        if ("statements" in m.body) {
          collapseExprsInBlock(m.body);
        } else {
          m.body = collapseExpr(m.body as Expr);
        }
      }
      for (const p of item.properties) {
        currentSymbol = `${item.name}.${p.name}`;
        if (p.initialValue) {
          p.initialValue = collapseExpr(p.initialValue);
        }
      }
      if (item.staticBlocks) {
        currentSymbol = `${item.name}.<static>`;
        for (const sb of item.staticBlocks) collapseExprsInBlock(sb);
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      currentSymbol = item.name;
      item.value = collapseExpr(item.value);
    } else if (item.kind === "ComponentDecl") {
      currentSymbol = item.name;
      const collapseLayoutList = (nodes: LayoutNode[]): LayoutNode[] => {
        let idx = 0;
        const list = [...nodes];
        while (idx < list.length) {
          let matched = false;
          for (const idiom of stmtIdioms) {
            const parsed = getOrParseTemplate(idiom);
            const tNodes = parsed.layoutNodes;
            if (!tNodes || tNodes.length === 0) continue;
            const k = tNodes.length;
            if (idx + k <= list.length) {
              const window = list.slice(idx, idx + k);
              const bindings = new Map<string, Expr>();
              const holeNames = new Set(idiom.params.map((p) => p.name));
              let ok = true;
              for (let s = 0; s < k; s++) {
                if (!matchLayoutNodeTemplate(tNodes[s], window[s], bindings, holeNames, generator)) {
                  ok = false;
                  break;
                }
              }
              if (ok) {
                const args: Expr[] = idiom.params.map(
                  (p) =>
                    bindings.get(p.name) ?? {
                      kind: "IdentifierExpr",
                      name: "nil",
                      span: window[0].span,
                    },
                );
                const callSpan = window[0].span;
                const callNode: LayoutNode = {
                  kind: "LayoutNode",
                  tag: idiom.name,
                  attributes: args.map((a, aIdx) => ({
                    name: `$${aIdx}`,
                    value: a,
                    span: callSpan,
                  })),
                  textLiteral: null,
                  children: [],
                  span: callSpan,
                };
                list.splice(idx, k, callNode);
                collapsedCount++;
                onCollapsed?.(
                  idiom.name,
                  args.map((a) => generator.formatExpr(a)),
                  callSpan,
                  currentSymbol,
                );
                matched = true;
                idx++;
                break;
              }
            }
          }
          if (!matched) {
            const node = list[idx];
            for (const attr of node.attributes) {
              if (attr.value) attr.value = collapseExpr(attr.value);
            }
            if (node.childExpr) node.childExpr = collapseExpr(node.childExpr);
            if (node.children && node.children.length > 0) {
              node.children = collapseLayoutList(node.children);
            }
            idx++;
          }
        }
        return list;
      };
      item.layout = collapseLayoutList(item.layout);
    } else if (item.kind === "StyleDecl") {
      const collapseStyleDecl = (decl: StyleDecl): void => {
        currentSymbol = decl.name;
        let idx = 0;
        while (idx < decl.properties.length) {
          let matched = false;
          for (const idiom of stmtIdioms) {
            const parsed = getOrParseTemplate(idiom);
            const tProps = parsed.styleProperties;
            if (!tProps || tProps.length === 0) continue;
            const k = tProps.length;
            if (idx + k <= decl.properties.length) {
              const window = decl.properties.slice(idx, idx + k);
              const bindings = new Map<string, string>();
              const holeNames = new Set(idiom.params.map((p) => p.name));
              if (matchStylePropertyWindow(tProps, window, bindings, holeNames)) {
                const strArgs = idiom.params.map((p) => bindings.get(p.name) ?? "");
                const callSpan = window[0].span;
                const macroProp: StyleProperty = {
                  property: `${idiom.name}(${strArgs.join(", ")})`,
                  value: "",
                  span: callSpan,
                };
                decl.properties.splice(idx, k, macroProp);
                collapsedCount++;
                onCollapsed?.(idiom.name, strArgs, callSpan, currentSymbol);
                matched = true;
                idx++;
                break;
              }
            }
          }
          if (!matched) {
            idx++;
          }
        }
        if (decl.children && decl.children.length > 0) {
          for (const child of decl.children) {
            collapseStyleDecl(child);
          }
        }
      };
      collapseStyleDecl(item);
    }
  }

  return { ast: clonedMod, collapsedCount };
}

/**
 * Collapses idiom occurrences in AIL source code.
 */
export function collapseAilSourceIdioms(
  source: string,
  idioms: Record<string, ProjectIdiomDefinition>,
  filePath = "module.ail",
): { ail: string; collapsedCount: number } {
  if (!idioms || Object.keys(idioms).length === 0) {
    return { ail: source, collapsedCount: 0 };
  }

  let mod: Module;
  try {
    mod = parse(source, filePath);
  } catch {
    return { ail: source, collapsedCount: 0 };
  }

  const { ast, collapsedCount } = collapseModuleIdioms(mod, idioms);
  if (collapsedCount === 0) {
    return { ail: source, collapsedCount: 0 };
  }

  const ail = AilGenerator.generate(ast);
  return { ail, collapsedCount };
}

/**
 * Expands idiom calls in AIL source code.
 */
export function expandAilSourceIdioms(
  source: string,
  idioms: Record<string, ProjectIdiomDefinition>,
  filePath = "module.ail",
): { ail: string; expandedCount: number } {
  if (!idioms || Object.keys(idioms).length === 0) {
    return { ail: source, expandedCount: 0 };
  }

  let mod: Module;
  try {
    mod = parse(source, filePath);
  } catch {
    return { ail: source, expandedCount: 0 };
  }

  let expandedCount = 0;
  const expandedMod = expandModuleIdiomsInternal(mod, idioms, () => {
    expandedCount++;
  });

  if (expandedCount === 0) {
    return { ail: source, expandedCount: 0 };
  }

  const ail = AilGenerator.generate(expandedMod);
  return { ail, expandedCount };
}

const NATIVE_CODE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".py",
  ".rs",
  ".go",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
  ".php",
  ".kt",
  ".kts",
  ".html",
  ".twig",
  ".yaml",
  ".yml",
  ".json",
]);

const IGNORED_JSON_FILENAMES: ReadonlySet<string> = new Set([
  "ail.config.json",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "jsconfig.json",
  "biome.json",
  "rome.json",
]);

function computeSha256(content: string): string {
  return createHash("sha256").update(content, "utf-8").digest("hex");
}

/**
 * Recursively locates all .ail files in a directory.
 */
function scanAilFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== "node_modules" &&
        entry.name !== ".git" &&
        entry.name !== ".ail-build" &&
        entry.name !== ".ail-cache" &&
        entry.name !== "dist" &&
        entry.name !== "build"
      ) {
        results.push(...scanAilFiles(full));
      }
    } else if (entry.isFile() && entry.name.endsWith(".ail")) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Recursively locates native source code files that do not have a .ail sibling.
 */
function scanNativeCodeFiles(dir: string): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (
        entry.name !== "node_modules" &&
        entry.name !== ".git" &&
        entry.name !== ".ail-build" &&
        entry.name !== ".ail-cache" &&
        entry.name !== "dist" &&
        entry.name !== "build" &&
        entry.name !== "coverage" &&
        !entry.name.startsWith(".")
      ) {
        results.push(...scanNativeCodeFiles(full));
      }
    } else if (entry.isFile()) {
      if (
        entry.name.endsWith(".d.ts") ||
        entry.name.endsWith(".ail") ||
        entry.name.endsWith(".ail.trivia.json") ||
        IGNORED_JSON_FILENAMES.has(entry.name) ||
        /^tsconfig\..*\.json$/.test(entry.name)
      ) {
        continue;
      }
      const ext = path.extname(entry.name).toLowerCase();
      if (NATIVE_CODE_EXTENSIONS.has(ext)) {
        if (!fs.existsSync(`${full}.ail`)) {
          results.push(full);
        }
      }
    }
  }
  return results.sort();
}

interface WorkspaceIdiomFile extends IdiomFileInput {
  isNative: boolean;
  relPath: string;
  fileHash: string;
  rawSource: string;
}

function getIdiomCachePath(projectRoot: string): string {
  return path.join(projectRoot, ".ail-cache", "idioms.json");
}

function readIdiomCache(projectRoot: string): IdiomCacheData | null {
  const cachePath = getIdiomCachePath(projectRoot);
  if (!fs.existsSync(cachePath)) return null;
  try {
    return JSON.parse(fs.readFileSync(cachePath, "utf-8")) as IdiomCacheData;
  } catch {
    return null;
  }
}

function writeIdiomCache(projectRoot: string, data: IdiomCacheData): void {
  const cacheDir = path.join(projectRoot, ".ail-cache");
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }
  const cachePath = path.join(cacheDir, "idioms.json");
  fs.writeFileSync(cachePath, `${JSON.stringify(data, null, 2)}\n`, "utf-8");
}

function loadAndDecompileWorkspaceFiles(
  projectRoot: string,
  searchDir: string,
): {
  files: WorkspaceIdiomFile[];
  ailFilePaths: string[];
  nativeFilePaths: string[];
  fileHashes: Record<string, string>;
  decompiledAil: Record<string, string>;
} {
  const ailFilePaths = scanAilFiles(searchDir);
  const nativeFilePaths = scanNativeCodeFiles(searchDir);
  const existingCache = readIdiomCache(projectRoot);
  const fileHashes: Record<string, string> = {};
  const decompiledAil: Record<string, string> = {};
  const files: WorkspaceIdiomFile[] = [];

  for (const fp of ailFilePaths) {
    try {
      const rawSource = fs.readFileSync(fp, "utf-8");
      const relPath = path.relative(projectRoot, fp) || path.basename(fp);
      const fileHash = computeSha256(rawSource);
      fileHashes[relPath] = fileHash;
      decompiledAil[relPath] = rawSource;
      files.push({
        filePath: fp,
        source: rawSource,
        isNative: false,
        relPath,
        fileHash,
        rawSource,
      });
    } catch {
      // skip unreadable
    }
  }

  for (const fp of nativeFilePaths) {
    try {
      const rawSource = fs.readFileSync(fp, "utf-8");
      const relPath = path.relative(projectRoot, fp) || path.basename(fp);
      const fileHash = computeSha256(rawSource);
      fileHashes[relPath] = fileHash;

      let ailSource: string;
      if (
        existingCache?.fileHashes?.[relPath] === fileHash &&
        typeof existingCache?.decompiledAil?.[relPath] === "string"
      ) {
        ailSource = existingCache.decompiledAil[relPath];
      } else {
        const targetLang = detectTargetFromPath(fp);
        const decomp = decompile(rawSource, targetLang, { filePath: fp });
        ailSource = decomp.ail;
      }

      decompiledAil[relPath] = ailSource;
      files.push({
        filePath: fp,
        source: ailSource,
        isNative: true,
        relPath,
        fileHash,
        rawSource,
      });
    } catch {
      // skip unparseable native file
    }
  }

  return { files, ailFilePaths, nativeFilePaths, fileHashes, decompiledAil };
}

function collectOccurrencesAcrossFiles(
  files: WorkspaceIdiomFile[],
  idioms: Record<string, ProjectIdiomDefinition>,
): Record<string, IdiomOccurrence[]> {
  const occurrences: Record<string, IdiomOccurrence[]> = {};
  const generator = new AilGenerator();
  for (const key of Object.keys(idioms)) {
    const norm = key.startsWith("$") ? key : `$${key}`;
    occurrences[norm] = [];
  }

  for (const file of files) {
    let mod: Module;
    try {
      mod = parse(file.source, file.filePath);
    } catch {
      continue;
    }

    // 1. Also collect already-collapsed $idiom calls if present in .ail source
    const collectExistingCallsInExpr = (expr: Expr | undefined | null, sym?: string) => {
      if (!expr) return;
      if (expr.kind === "CallExpr" && expr.callee.kind === "IdentifierExpr") {
        const calleeName = expr.callee.name;
        const normCallee = calleeName.startsWith("$") ? calleeName : `$${calleeName}`;
        if (calleeName.startsWith("$") && occurrences[normCallee]) {
          occurrences[normCallee].push({
            filePath: file.relPath,
            symbol: sym,
            startLine: expr.span?.start?.line || 1,
            endLine: expr.span?.end?.line || expr.span?.start?.line || 1,
            args: expr.args.map((a) => generator.formatExpr(a)),
            fileHash: file.fileHash,
          });
        }
      }
      switch (expr.kind) {
        case "CallExpr":
          collectExistingCallsInExpr(expr.callee, sym);
          for (const a of expr.args) collectExistingCallsInExpr(a, sym);
          break;
        case "BinaryExpr":
          collectExistingCallsInExpr(expr.left, sym);
          collectExistingCallsInExpr(expr.right, sym);
          break;
        case "UnaryExpr":
        case "AwaitExpr":
        case "PostfixTryExpr":
          collectExistingCallsInExpr(expr.operand, sym);
          break;
        case "AssignExpr":
          collectExistingCallsInExpr(expr.target, sym);
          collectExistingCallsInExpr(expr.value, sym);
          break;
        case "MemberAccessExpr":
          collectExistingCallsInExpr(expr.object, sym);
          break;
        case "IndexExpr":
          collectExistingCallsInExpr(expr.object, sym);
          collectExistingCallsInExpr(expr.index, sym);
          break;
        case "ArrayLiteralExpr":
          for (const el of expr.elements) collectExistingCallsInExpr(el, sym);
          break;
        case "RecordLiteralExpr":
          for (const p of expr.properties) collectExistingCallsInExpr(p.value, sym);
          break;
        case "TemplateLiteralExpr":
          for (const e of expr.expressions) collectExistingCallsInExpr(e, sym);
          break;
        case "ClosureExpr":
          if ("statements" in expr.body) collectExistingCallsInBlock(expr.body, sym);
          else collectExistingCallsInExpr(expr.body, sym);
          break;
      }
    };

    const collectExistingCallsInBlock = (block: Block, sym?: string) => {
      for (const stmt of block.statements) {
        switch (stmt.kind) {
          case "ExprStmt":
            collectExistingCallsInExpr(stmt.expr, sym);
            break;
          case "ReturnStmt":
            collectExistingCallsInExpr(stmt.value, sym);
            break;
          case "LetBinding":
          case "DestructureBinding":
            collectExistingCallsInExpr(stmt.init, sym);
            break;
          case "AssignStmt":
            collectExistingCallsInExpr(stmt.target, sym);
            collectExistingCallsInExpr(stmt.value, sym);
            break;
          case "IfStmt":
            collectExistingCallsInExpr(stmt.condition, sym);
            collectExistingCallsInBlock(stmt.thenBranch, sym);
            for (const el of stmt.elifBranches) {
              collectExistingCallsInExpr(el.condition, sym);
              collectExistingCallsInBlock(el.body, sym);
            }
            if (stmt.elseBranch) collectExistingCallsInBlock(stmt.elseBranch, sym);
            break;
          case "WhileStmt":
            collectExistingCallsInExpr(stmt.condition, sym);
            collectExistingCallsInBlock(stmt.body, sym);
            break;
          case "ForStmt":
            collectExistingCallsInExpr(stmt.iterable, sym);
            collectExistingCallsInBlock(stmt.body, sym);
            break;
          case "TryStmt":
            collectExistingCallsInBlock(stmt.tryBlock, sym);
            if (stmt.catchBlock) collectExistingCallsInBlock(stmt.catchBlock, sym);
            if (stmt.finallyBlock) collectExistingCallsInBlock(stmt.finallyBlock, sym);
            break;
          case "ThrowStmt":
            collectExistingCallsInExpr(stmt.expr, sym);
            break;
          case "MatchStmt":
            collectExistingCallsInExpr(stmt.target, sym);
            for (const c of stmt.cases) {
              if (c.guard) collectExistingCallsInExpr(c.guard, sym);
              if ("statements" in c.body) collectExistingCallsInBlock(c.body, sym);
              else collectExistingCallsInExpr(c.body, sym);
            }
            break;
        }
      }
    };

    for (const item of mod.items) {
      if (item.kind === "FunctionDecl") {
        if ("statements" in item.body) collectExistingCallsInBlock(item.body, item.name);
        else collectExistingCallsInExpr(item.body, item.name);
      } else if (item.kind === "ClassDecl") {
        for (const m of item.methods) {
          if ("statements" in m.body) {
            collectExistingCallsInBlock(m.body, `${item.name}.${m.name}`);
          } else {
            collectExistingCallsInExpr(m.body, `${item.name}.${m.name}`);
          }
        }
      } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
        collectExistingCallsInExpr(item.value, item.name);
      } else if (item.kind === "ComponentDecl") {
        const collectLayout = (node: LayoutNode) => {
          for (const attr of node.attributes) {
            if (attr.value) collectExistingCallsInExpr(attr.value, item.name);
          }
          if (node.childExpr) collectExistingCallsInExpr(node.childExpr, item.name);
          for (const ch of node.children) collectLayout(ch);
        };
        for (const node of item.layout) {
          collectLayout(node);
        }
      }
    }

    // 2. Collect uncollapsed occurrences via collapseModuleIdioms callback
    collapseModuleIdioms(mod, idioms, (idiomName, args, span, symbol) => {
      const norm = idiomName.startsWith("$") ? idiomName : `$${idiomName}`;
      if (!occurrences[norm]) {
        occurrences[norm] = [];
      }
      occurrences[norm].push({
        filePath: file.relPath,
        symbol,
        startLine: span?.start?.line || 1,
        endLine: span?.end?.line || span?.start?.line || 1,
        args,
        fileHash: file.fileHash,
      });
    });
  }

  return occurrences;
}

function resolveIdiomWorkspace(dir: string): {
  projectRoot: string;
  config: AilProjectConfig;
  searchDir: string;
} {
  const resolvedInput = path.resolve(dir);
  let projectRoot = findProjectRoot(resolvedInput);
  if (
    projectRoot === resolvedInput &&
    path.basename(resolvedInput) === "src" &&
    !fs.existsSync(path.join(resolvedInput, "ail.config.json"))
  ) {
    projectRoot = path.dirname(resolvedInput);
  }
  const config = loadProjectConfig(projectRoot);
  if (resolvedInput !== projectRoot && fs.existsSync(resolvedInput)) {
    return { projectRoot, config, searchDir: resolvedInput };
  }
  const targetDir = path.resolve(projectRoot, config.sourceDir);
  const searchDir = fs.existsSync(targetDir) ? targetDir : projectRoot;
  return { projectRoot, config, searchDir };
}

/**
 * Native-first idiom scanner: discovers idioms across native (.ts, .py, etc.) and/or .ail files,
 * persists idioms in `ail.config.json` and provenance in `.ail-cache/idioms.json`,
 * without writing any `.ail` files to disk.
 */
export function scanProjectIdioms(
  dir: string,
  options?: ApplyProjectIdiomsOptions,
): ApplyProjectIdiomsResult {
  const { projectRoot: resolvedDir, config, searchDir } = resolveIdiomWorkspace(dir);

  const { files, fileHashes, decompiledAil } = loadAndDecompileWorkspaceFiles(
    resolvedDir,
    searchDir,
  );

  const mineResult = mineProjectIdioms(files, {
    minOccurrences: options?.minOccurrences,
    minNetTokenSavings: options?.minNetTokenSavings,
    maxParams: options?.maxParams,
    maxBlockStatements: options?.maxBlockStatements,
    existingIdioms: config.idioms,
  });

  const allIdioms: Record<string, ProjectIdiomDefinition> = {
    ...config.idioms,
    ...mineResult.idioms,
  };

  const occurrences = collectOccurrencesAcrossFiles(files, allIdioms);
  const affectedFilesSet = new Set<string>();
  let totalCollapsedCalls = 0;
  for (const occList of Object.values(occurrences)) {
    totalCollapsedCalls += occList.length;
    for (const occ of occList) {
      affectedFilesSet.add(path.resolve(resolvedDir, occ.filePath));
    }
  }

  const idiomsEnabled = isProjectIdiomsEnabled(config);

  if (!options?.dryRun) {
    if (Object.keys(allIdioms).length > 0) {
      saveProjectConfig(resolvedDir, {
        idiomsEnabled,
        idioms: allIdioms,
      });
    }
    writeIdiomCache(resolvedDir, {
      version: 1,
      idiomsEnabled,
      fileHashes,
      decompiledAil,
      idioms: allIdioms,
      occurrences,
    });
  }

  return {
    idioms: mineResult.idioms,
    modifiedFiles: Array.from(affectedFilesSet),
    totalCollapsedCalls,
    totalNetTokenSavings: mineResult.totalNetTokenSavings,
    rejectedByTokenGate: mineResult.rejectedByTokenGate,
    synthesizedIdioms: Object.keys(mineResult.idioms).length,
    netTokenSavings: mineResult.totalNetTokenSavings,
    occurrences,
  };
}

/**
 * Discovers idioms across a workspace, collapses occurrences in .ail files (if any),
 * or indexes native files in twinless mode, and saves configuration + provenance cache.
 */
export function applyProjectIdiomsToDirectory(
  dir: string,
  options?: ApplyProjectIdiomsOptions,
): ApplyProjectIdiomsResult {
  const { projectRoot: resolvedDir, config, searchDir } = resolveIdiomWorkspace(dir);

  const ailFilePaths = scanAilFiles(searchDir);

  // If no .ail files exist on disk, run native-first twinless idiom discovery!
  if (ailFilePaths.length === 0) {
    return scanProjectIdioms(dir, options);
  }

  const files: IdiomFileInput[] = [];
  for (const fp of ailFilePaths) {
    try {
      const source = fs.readFileSync(fp, "utf-8");
      files.push({ filePath: fp, source });
    } catch {
      // Skip unreadable files
    }
  }

  const mineResult = mineProjectIdioms(files, {
    minOccurrences: options?.minOccurrences,
    minNetTokenSavings: options?.minNetTokenSavings,
    maxParams: options?.maxParams,
    maxBlockStatements: options?.maxBlockStatements,
    existingIdioms: config.idioms,
  });

  const allIdioms = {
    ...config.idioms,
    ...mineResult.idioms,
  };

  const modifiedFiles: string[] = [];
  let totalCollapsedCalls = 0;

  for (const file of files) {
    const { ail, collapsedCount } = collapseAilSourceIdioms(
      file.source,
      allIdioms,
      file.filePath,
    );
    if (collapsedCount > 0) {
      totalCollapsedCalls += collapsedCount;
      modifiedFiles.push(file.filePath);
      if (!options?.dryRun) {
        fs.writeFileSync(file.filePath, ail, "utf-8");
      }
    }
  }

  if (!options?.dryRun && Object.keys(mineResult.idioms).length > 0) {
    saveProjectConfig(resolvedDir, { idioms: allIdioms });
  }

  return {
    idioms: mineResult.idioms,
    modifiedFiles,
    totalCollapsedCalls,
    totalNetTokenSavings: mineResult.totalNetTokenSavings,
    rejectedByTokenGate: mineResult.rejectedByTokenGate,
    synthesizedIdioms: Object.keys(mineResult.idioms).length,
    netTokenSavings: mineResult.totalNetTokenSavings,
  };
}

/**
 * Reads all live occurrences of a specific project idiom across workspace native and .ail files,
 * automatically invalidating any stale SHA-256 cache entries when files change on disk.
 */
export function readProjectIdiom(dir: string, idiomName: string): IdiomReadResult {
  const { projectRoot: resolvedDir, config, searchDir } = resolveIdiomWorkspace(dir);
  const normName = idiomName.startsWith("$") ? idiomName : `$${idiomName}`;
  const bareName = normName.slice(1);

  const idiom = config.idioms?.[normName] ?? config.idioms?.[bareName];
  if (!idiom) {
    throw new Error(`Idiom '${normName}' not found in project configuration.`);
  }

  const canonicalIdiom: ProjectIdiomDefinition = {
    ...idiom,
    name: normName,
  };

  const { files, fileHashes, decompiledAil } = loadAndDecompileWorkspaceFiles(
    resolvedDir,
    searchDir,
  );

  const allIdioms = config.idioms ?? { [normName]: canonicalIdiom };
  const occurrencesMap = collectOccurrencesAcrossFiles(files, {
    ...allIdioms,
    [normName]: canonicalIdiom,
  });
  const occList = occurrencesMap[normName] ?? [];
  const idiomsEnabled = isProjectIdiomsEnabled(config);

  writeIdiomCache(resolvedDir, {
    version: 1,
    idiomsEnabled,
    fileHashes,
    decompiledAil,
    idioms: allIdioms,
    occurrences: occurrencesMap,
  });

  const uniqueFiles = new Set(occList.map((o) => o.filePath));
  const paramsStr = canonicalIdiom.params.map((p) => p.name).join(", ");
  const oneLineTemplate = canonicalIdiom.templateAil.replace(/\r?\n\s*/g, " ; ");

  const lines: string[] = [
    `=== AIL Idiom Provenance Report: ${normName}(${paramsStr}) ===`,
    `Status:      ${idiomsEnabled ? "ON (enabled)" : "OFF (disabled)"}`,
    `Kind:        ${canonicalIdiom.kind}`,
    `Template:    ${oneLineTemplate}`,
    `Occurrences: ${occList.length} across ${uniqueFiles.size} file(s)`,
    "",
  ];

  for (const occ of occList) {
    const symLabel = occ.symbol ? ` [${occ.symbol}]` : "";
    lines.push(
      `  - ${occ.filePath}:${occ.startLine}${symLabel} -> ${normName}(${occ.args.join(", ")})`,
    );
  }

  return {
    idiom: canonicalIdiom,
    idiomsEnabled,
    occurrences: occList,
    totalOccurrences: occList.length,
    filesCount: uniqueFiles.size,
    formattedReport: lines.join("\n"),
  };
}

function resolveUpdatedParams(
  oldParams: ProjectIdiomParam[],
  newTemplateAil: string,
  explicitParams?: ProjectIdiomParam[] | string,
): ProjectIdiomParam[] {
  if (Array.isArray(explicitParams)) {
    return explicitParams.map((p, idx) => ({
      name: p.name.startsWith("$") ? p.name : `$${p.name || idx}`,
      ...(p.type ? { type: p.type } : {}),
      ...(p.defaultValue !== undefined ? { defaultValue: p.defaultValue } : {}),
    }));
  }
  if (typeof explicitParams === "string" && explicitParams.trim()) {
    return explicitParams
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part, idx) => {
        const eqIdx = part.indexOf("=");
        const rawName = (eqIdx >= 0 ? part.slice(0, eqIdx) : part).trim();
        const defVal = eqIdx >= 0 ? part.slice(eqIdx + 1).trim() : undefined;
        const colonIdx = rawName.indexOf(":");
        const pName = (colonIdx >= 0 ? rawName.slice(0, colonIdx) : rawName).trim();
        const pType = colonIdx >= 0 ? rawName.slice(colonIdx + 1).trim() : undefined;
        return {
          name: pName.startsWith("$") ? pName : `$${pName || idx}`,
          ...(pType ? { type: pType } : {}),
          ...(defVal !== undefined ? { defaultValue: defVal } : {}),
        };
      });
  }

  let maxIdx = oldParams.length - 1;
  const matches = newTemplateAil.matchAll(/\$(\d+)\b/g);
  for (const m of matches) {
    const n = Number.parseInt(m[1], 10);
    if (!Number.isNaN(n) && n > maxIdx) maxIdx = n;
  }
  const result = [...oldParams];
  for (let i = result.length; i <= maxIdx; i++) {
    result.push({ name: `$${i}` });
  }
  return result;
}

/**
 * Smart multi-file idiom mutation: updates an idiom's template across all occurrences
 * in native files and/or .ail files, supporting parameter reordering, duplication,
 * arity expansion with defaults, nested expressions, hygienic alpha-renaming, cycle detection, and atomic rollback.
 */
export async function updateProjectIdiom(
  dir: string,
  idiomName: string,
  newTemplateAil: string,
  options?: { dryRun?: boolean; description?: string; params?: ProjectIdiomParam[] | string },
): Promise<IdiomUpdateResult> {
  const { projectRoot: resolvedDir, config, searchDir } = resolveIdiomWorkspace(dir);
  const normName = idiomName.startsWith("$") ? idiomName : `$${idiomName}`;
  const bareName = normName.slice(1);

  const oldKey =
    config.idioms && Object.hasOwn(config.idioms, normName)
      ? normName
      : config.idioms && Object.hasOwn(config.idioms, bareName)
        ? bareName
        : undefined;

  if (!oldKey || !config.idioms) {
    throw new Error(`Idiom '${normName}' not found in project configuration.`);
  }

  const oldDef: ProjectIdiomDefinition = {
    ...config.idioms[oldKey],
    name: normName,
  };

  const resolvedParams = resolveUpdatedParams(oldDef.params, newTemplateAil, options?.params);

  // Determine if the updated template has multiple statements (upgrade kind stmt -> block if needed)
  const tempCheckDef: ProjectIdiomDefinition = {
    ...oldDef,
    params: resolvedParams,
    kind: oldDef.kind === "expr" ? "expr" : "block",
    templateAil: newTemplateAil,
    ...(options?.description !== undefined ? { description: options.description } : {}),
  };
  const parsedNew = getOrParseTemplate(tempCheckDef);
  const updatedKind: "expr" | "stmt" | "block" =
    oldDef.kind === "expr"
      ? "expr"
      : parsedNew.statements && parsedNew.statements.length > 1
        ? "block"
        : "stmt";

  const updatedDef: ProjectIdiomDefinition = {
    ...oldDef,
    params: resolvedParams,
    kind: updatedKind,
    templateAil: newTemplateAil,
    ...(options?.description !== undefined ? { description: options.description } : {}),
  };

  const candidateIdioms: Record<string, ProjectIdiomDefinition> = {
    ...config.idioms,
    [oldKey]: updatedDef,
    [normName]: updatedDef,
  };

  // Validate syntax & check for direct/mutual recursion cycles before touching any files!
  validateIdiomDefinitions(candidateIdioms);

  const { files } = loadAndDecompileWorkspaceFiles(resolvedDir, searchDir);

  const dryRun = Boolean(options?.dryRun);
  const fileBackups = new Map<string, string>();
  const pendingWrites = new Map<string, string>();
  const modifiedFiles: string[] = [];
  let updatedOccurrences = 0;

  for (const file of files) {
    if (!file.isNative) {
      // .ail file on disk
      let mod: Module;
      try {
        mod = parse(file.source, file.filePath);
      } catch {
        continue;
      }
      let countInFile = 0;
      collapseModuleIdioms(mod, { [normName]: oldDef }, () => {
        countInFile++;
      });
      // Also check existing $normName calls
      if (file.source.includes(normName)) {
        const matches = file.source.match(
          new RegExp(`\\$${bareName}\\s*\\(`, "g"),
        );
        if (matches) countInFile += matches.length;
      }
      if (countInFile > 0) {
        updatedOccurrences += countInFile;
        modifiedFiles.push(file.filePath);
      }
      continue;
    }

    // Native file (.ts, .py, etc.): decompile -> locate methods/functions with occurrences ->
    // collapse with oldDef -> expand with updatedDef -> surgically splice native symbol!
    let mod: Module;
    try {
      mod = parse(file.source, file.filePath);
    } catch {
      continue;
    }

    const targetLang = detectTargetFromPath(file.filePath);
    let currentNativeSource = file.rawSource;
    let fileModified = false;
    let fileOccurrences = 0;

    for (const item of mod.items) {
      if (item.kind === "FunctionDecl" && item.name !== "__top_level__") {
        const singleMod: Module = {
          kind: "Module",
          path: mod.path,
          items: [structuredClone(item)],
          span: mod.span,
        };
        const { ast: collapsedSingle, collapsedCount } = collapseModuleIdioms(singleMod, {
          [normName]: oldDef,
        });
        if (collapsedCount > 0) {
          const expandedSingle = expandModuleIdioms(collapsedSingle, candidateIdioms);
          const fnDecl = expandedSingle.items[0] as FunctionDecl;
          currentNativeSource = spliceNativeSymbolFromExpandedAst(
            currentNativeSource,
            item.name,
            fnDecl,
            file.filePath,
            targetLang,
          );
          fileOccurrences += collapsedCount;
          fileModified = true;
        }
      } else if (item.kind === "ClassDecl") {
        for (const m of item.methods) {
          const singleClass: ClassDecl = {
            ...structuredClone(item),
            properties: [],
            methods: [structuredClone(m)],
            staticBlocks: [],
          };
          const singleMod: Module = {
            kind: "Module",
            path: mod.path,
            items: [singleClass],
            span: mod.span,
          };
          const { ast: collapsedSingle, collapsedCount } = collapseModuleIdioms(singleMod, {
            [normName]: oldDef,
          });
          if (collapsedCount > 0) {
            const expandedSingle = expandModuleIdioms(collapsedSingle, candidateIdioms);
            const expandedCls = expandedSingle.items[0] as ClassDecl;
            const expandedMethod = expandedCls.methods[0];
            const symSelector = `${item.name}.${m.name}`;
            currentNativeSource = spliceNativeSymbolFromExpandedAst(
              currentNativeSource,
              symSelector,
              expandedMethod,
              file.filePath,
              targetLang,
              item.name,
            );
            fileOccurrences += collapsedCount;
            fileModified = true;
          }
        }
      } else if (
        item.kind === "ConstDecl" ||
        item.kind === "VarDecl" ||
        item.kind === "ComponentDecl" ||
        item.kind === "StyleDecl"
      ) {
        const singleMod: Module = {
          kind: "Module",
          path: mod.path,
          items: [structuredClone(item)],
          span: mod.span,
        };
        const { collapsedCount } = collapseModuleIdioms(singleMod, {
          [normName]: oldDef,
        });
        if (collapsedCount > 0) {
          const { ast: collapsedFull, collapsedCount: fullCount } = collapseModuleIdioms(mod, {
            [normName]: oldDef,
          });
          const expandedFull = expandModuleIdioms(collapsedFull, candidateIdioms);
          currentNativeSource = emitTarget(expandedFull, targetLang, { watermark: false });
          fileOccurrences = fullCount;
          fileModified = true;
          break;
        }
      }
    }

    if (fileModified) {
      updatedOccurrences += fileOccurrences;
      fileBackups.set(file.filePath, file.rawSource);
      pendingWrites.set(file.filePath, currentNativeSource);
      modifiedFiles.push(file.filePath);
    }
  }

  updatedDef.occurrences = updatedOccurrences || oldDef.occurrences;

  if (!dryRun) {
    const configPath = path.join(resolvedDir, "ail.config.json");
    const oldConfigRaw = fs.existsSync(configPath)
      ? fs.readFileSync(configPath, "utf-8")
      : null;

    try {
      for (const [fp, newContent] of pendingWrites.entries()) {
        fs.writeFileSync(fp, newContent, "utf-8");
      }

      const finalIdioms = { ...config.idioms };
      delete finalIdioms[oldKey];
      finalIdioms[normName] = updatedDef;

      saveProjectConfig(resolvedDir, {
        idioms: finalIdioms,
      });

      // Refresh provenance cache with updated native files
      const refreshed = loadAndDecompileWorkspaceFiles(resolvedDir, searchDir);
      const refreshedOccurrences = collectOccurrencesAcrossFiles(
        refreshed.files,
        finalIdioms,
      );
      writeIdiomCache(resolvedDir, {
        version: 1,
        idiomsEnabled: isProjectIdiomsEnabled(config),
        fileHashes: refreshed.fileHashes,
        decompiledAil: refreshed.decompiledAil,
        idioms: finalIdioms,
        occurrences: refreshedOccurrences,
      });
    } catch (err) {
      // Atomic multi-file rollback on any failure!
      for (const [fp, origContent] of fileBackups.entries()) {
        try {
          fs.writeFileSync(fp, origContent, "utf-8");
        } catch {
          // ignore
        }
      }
      if (oldConfigRaw !== null) {
        try {
          fs.writeFileSync(configPath, oldConfigRaw, "utf-8");
        } catch {
          // ignore
        }
      }
      throw err;
    }
  }

  return {
    idiom: updatedDef,
    modifiedFiles,
    updatedOccurrences,
    dryRun,
  };
}

/**
 * Expands all project idioms back to canonical code across a workspace.
 */
export function expandProjectIdiomsInDirectory(
  dir: string,
): { expandedFiles: number; expandedCalls: number } {
  const { config, searchDir } = resolveIdiomWorkspace(dir);

  if (!config.idioms || Object.keys(config.idioms).length === 0) {
    return { expandedFiles: 0, expandedCalls: 0 };
  }

  const ailFilePaths = scanAilFiles(searchDir);

  let expandedFiles = 0;
  let expandedCalls = 0;

  for (const fp of ailFilePaths) {
    try {
      const source = fs.readFileSync(fp, "utf-8");
      const { ail, expandedCount } = expandAilSourceIdioms(
        source,
        config.idioms,
        fp,
      );
      if (expandedCount > 0) {
        expandedFiles++;
        expandedCalls += expandedCount;
        fs.writeFileSync(fp, ail, "utf-8");
      }
    } catch {
      // Ignore errors reading/writing individual files
    }
  }

  return { expandedFiles, expandedCalls };
}

/**
 * Formats active project idioms as a clean Markdown specification section.
 */
export function formatIdiomsMarkdownSection(
  optionsOrIdioms?:
    | Record<string, ProjectIdiomDefinition>
    | { idioms?: Record<string, ProjectIdiomDefinition> }
    | ProjectIdiomDefinition
    | null,
): string {
  if (!optionsOrIdioms) {
    return "";
  }

  const raw = optionsOrIdioms as Record<string, unknown>;
  let idioms: Record<string, ProjectIdiomDefinition> | undefined;

  if ("kind" in raw && "templateAil" in raw) {
    const single = optionsOrIdioms as ProjectIdiomDefinition;
    idioms = { [single.name]: single };
  } else if ("idioms" in raw && raw.idioms && typeof raw.idioms === "object") {
    idioms = raw.idioms as Record<string, ProjectIdiomDefinition>;
  } else if (typeof raw === "object") {
    idioms = optionsOrIdioms as Record<string, ProjectIdiomDefinition>;
  }

  if (!idioms || typeof idioms !== "object" || Object.keys(idioms).length === 0) {
    return "";
  }

  const lines: string[] = [
    "### Active Project Idioms",
    "",
    "The following token-efficient project idioms are active and automatically expanded during compilation:",
    "",
  ];

  for (const idiom of Object.values(idioms)) {
    const paramsStr = idiom.params.map((p) => p.name).join(", ");
    const oneLineTemplate = idiom.templateAil.replace(/\r?\n\s*/g, " ; ");
    lines.push(
      `- \`${idiom.name}(${paramsStr})\` -> \`${oneLineTemplate}\` (saves ~${idiom.tokensPerOccurrenceSaved} tokens/use)`,
    );
  }

  lines.push("");
  return lines.join("\n");
}
