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
  ConstDecl,
  DestructureBinding,
  Expr,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  IndexExpr,
  LetBinding,
  LiteralExpr,
  MatchStmt,
  MemberAccessExpr,
  Module,
  PostfixTryExpr,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  ThrowStmt,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { parse } from "../core/parser.js";
import { type Span } from "../core/span.js";
import { AilGenerator } from "../decompiler/ail-generator.js";
import {
  loadProjectConfig,
  saveProjectConfig,
  type ProjectIdiomDefinition,
} from "../config/project-config.js";
import {
  mineProjectIdioms,
  type IdiomFileInput,
  isIdentifierReferencedInStatements,
  collectIdentifiersInStatement,
  renameIdentifiersInStatement,
} from "./idiom-miner.js";

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
}

interface ParsedTemplate {
  kind: "expr" | "stmt" | "block";
  expr?: Expr;
  statements?: Statement[];
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
 * Parses an idiom's templateAil string into template AST statement(s) or expression.
 */
function getOrParseTemplate(def: ProjectIdiomDefinition): ParsedTemplate {
  const cacheKey = `${def.name}::${def.kind}::${def.templateAil}`;
  const cached = templateCache.get(cacheKey);
  if (cached) return cached;

  if (def.kind === "expr") {
    const wrapper = `fn __t():\n  ret ${def.templateAil}\n`;
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
  const indented = def.templateAil
    .split(/\r?\n/)
    .map((line) => (line.trim().length > 0 ? `  ${line}` : ""))
    .join("\n");
  const wrapper = `fn __t():\n${indented}\n`;
  const mod = parse(wrapper, "<template>");
  const fn = mod.items[0] as FunctionDecl;
  const body = fn.body as Block;
  const result: ParsedTemplate = {
    kind: def.kind,
    statements: body.statements,
    expr:
      body.statements.length === 1 && body.statements[0].kind === "ExprStmt"
        ? (body.statements[0] as ExprStmt).expr
        : undefined,
  };
  setCachedTemplate(cacheKey, result);
  return result;
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

  function buildSubst(def: ProjectIdiomDefinition, args: Expr[]): Map<string, Expr> {
    const subst = new Map<string, Expr>();
    for (let i = 0; i < def.params.length; i++) {
      const p = def.params[i];
      const arg = args[i] ?? {
        kind: "IdentifierExpr",
        name: "nil",
        span: clonedMod.span,
      };
      subst.set(p.name, arg);
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
      const def = idioms![expr.callee.name];
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
        const parsed = getOrParseTemplate(def);
        const transformedArgs = call.args.map((a) => transformExpr(a, depth + 1));
        const subst = buildSubst(def, transformedArgs);

        if (
          (def.kind === "stmt" || def.kind === "block") &&
          parsed.statements &&
          parsed.statements.length > 0
        ) {
          onExpanded?.(1);

          // Disambiguate local template-fixed variable bindings (e.g. _loc0)
          // against names already used in this block or outer scope.
          const disambiguateMap = new Map<string, string>();
          const declaredNames = new Set<string>();
          collectDeclaredLocalNames(parsed.statements, declaredNames);

          for (const name of declaredNames) {
            if (name.startsWith("$")) continue;
            const isReferencedLater = isIdentifierReferencedInStatements(
              block.statements.slice(i + 1),
              name,
            );
            const shouldDisambiguate = name.startsWith("_loc") || !isReferencedLater;

            if (shouldDisambiguate && usedNamesInBlock.has(name)) {
              let suffix = 2;
              let freshName = `${name}_${suffix}`;
              while (usedNamesInBlock.has(freshName)) {
                suffix++;
                freshName = `${name}_${suffix}`;
              }
              disambiguateMap.set(name, freshName);
              usedNamesInBlock.add(freshName);
            } else {
              usedNamesInBlock.add(name);
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
          newStatements.push(stmt);
          break;
        case "DestructureBinding":
          stmt.init = transformExpr(stmt.init, depth);
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

  // Traverse module items
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl") {
      if ("statements" in item.body) {
        const outerScope = new Set<string>(item.params.map((p) => p.name));
        transformBlock(item.body, outerScope);
      } else {
        item.body = transformExpr(item.body as Expr);
      }
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if ("statements" in m.body) {
          const outerScope = new Set<string>(m.params.map((p) => p.name));
          transformBlock(m.body, outerScope);
        } else {
          m.body = transformExpr(m.body as Expr);
        }
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
    case "IdentifierExpr":
      return templateExpr.name === (targetExpr as IdentifierExpr).name;
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
      if (t.args.length !== tg.args.length) return false;
      if (!matchExprTemplate(t.callee, tg.callee, bindings, holeNames, generator, alphaMap)) {
        return false;
      }
      for (let i = 0; i < t.args.length; i++) {
        if (!matchExprTemplate(t.args[i], tg.args[i], bindings, holeNames, generator, alphaMap)) {
          return false;
        }
      }
      return true;
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
): { ast: Module; collapsedCount: number } {
  if (!idioms || Object.keys(idioms).length === 0) {
    return { ast: mod, collapsedCount: 0 };
  }

  const clonedMod = structuredClone(mod);
  let collapsedCount = 0;
  const generator = new AilGenerator();

  // Sort idioms by tokensPerOccurrenceSaved descending
  const sortedIdioms = Object.values(idioms).sort(
    (a, b) => b.tokensPerOccurrenceSaved - a.tokensPerOccurrenceSaved,
  );

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

  // Pass 1: Collapse statements
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl" && "statements" in item.body) {
      collapseBlock(item.body);
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if ("statements" in m.body) collapseBlock(m.body);
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) collapseBlock(sb);
      }
    }
  }

  // Pass 2: Collapse expressions
  for (const item of clonedMod.items) {
    if (item.kind === "FunctionDecl") {
      if ("statements" in item.body) {
        collapseExprsInBlock(item.body);
      } else {
        item.body = collapseExpr(item.body as Expr);
      }
    } else if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if ("statements" in m.body) {
          collapseExprsInBlock(m.body);
        } else {
          m.body = collapseExpr(m.body as Expr);
        }
      }
      for (const p of item.properties) {
        if (p.initialValue) {
          p.initialValue = collapseExpr(p.initialValue);
        }
      }
      if (item.staticBlocks) {
        for (const sb of item.staticBlocks) collapseExprsInBlock(sb);
      }
    } else if (item.kind === "ConstDecl" || item.kind === "VarDecl") {
      item.value = collapseExpr(item.value);
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
        entry.name !== "dist"
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
 * Discovers idioms across a workspace, collapses occurrences, and saves configuration.
 */
export function applyProjectIdiomsToDirectory(
  dir: string,
  options?: ApplyProjectIdiomsOptions,
): ApplyProjectIdiomsResult {
  const resolvedDir = path.resolve(dir);
  const config = loadProjectConfig(resolvedDir);
  const targetDir = path.resolve(resolvedDir, config.sourceDir);
  const searchDir = fs.existsSync(targetDir) ? targetDir : resolvedDir;

  const ailFilePaths = scanAilFiles(searchDir);
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
 * Expands all project idioms back to canonical code across a workspace.
 */
export function expandProjectIdiomsInDirectory(
  dir: string,
): { expandedFiles: number; expandedCalls: number } {
  const resolvedDir = path.resolve(dir);
  const config = loadProjectConfig(resolvedDir);

  if (!config.idioms || Object.keys(config.idioms).length === 0) {
    return { expandedFiles: 0, expandedCalls: 0 };
  }

  const targetDir = path.resolve(resolvedDir, config.sourceDir);
  const searchDir = fs.existsSync(targetDir) ? targetDir : resolvedDir;
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
