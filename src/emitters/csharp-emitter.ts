/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C# Forward Transpiler & .NET Emitter for AICE 2.0.
 * Emits clean, idiomatic modern C# (C# 10+) code from AICE Module AST.
 */

import type {
  BinaryExpr,
  Block,
  CallExpr,
  ClassDecl,
  ConstDecl,
  Expr,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  IndexExpr,
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
} from "../core/ast.js";
import { EmitterContext, type EmitterOptions } from "./context.js";
import { lowerConstructor, lowerMethodCall, lowerPropertyAccess } from "./rewriter.js";

export class CSharpEmitter {
  private ctx: EmitterContext;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string }> = new Map();

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("csharp", {
      ...options,
      indent: options.indent ?? "    ",
    });
  }

  emit(mod: Module): string {
    return this.emitModule(mod);
  }

  emitModule(mod: Module): string {
    this.structTypes.clear();
    this.enumVariants.clear();

    for (const item of mod.items) {
      if (item.kind === "TypeDecl") {
        if (item.fields) {
          this.structTypes.set(
            item.name,
            item.fields.map((f) => f.name),
          );
        } else if (item.isEnum && item.variants) {
          for (const v of item.variants) {
            this.enumVariants.set(v.name, { parentEnum: item.name });
          }
        }
      }
    }

    this.ctx.writeLine("using System;");
    this.ctx.writeLine("using System.Collections.Generic;");
    this.ctx.writeLine();

    // Process any explicit imports
    const customImports: string[] = [];
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        const clean = item.source.replace(/^(\.\/|\.\.\/)+/, "").replace(/\.(cs|ts|js|aice)$/, "");
        const nsName = clean.split(/[/\\]/).join(".");
        if (
          nsName &&
          nsName !== "System" &&
          nsName !== "System.Collections.Generic" &&
          !customImports.includes(nsName)
        ) {
          customImports.push(nsName);
        }
      }
    }
    for (const ci of customImports) {
      this.ctx.writeLine(`using ${ci};`);
    }
    if (customImports.length > 0) {
      this.ctx.writeLine();
    }

    // Determine namespace from mod.path
    const ns = this.extractNamespace(mod.path);
    if (ns) {
      this.ctx.writeLine(`namespace ${ns};`);
      this.ctx.writeLine();
    }

    const freeFunctions: FunctionDecl[] = [];

    for (const item of mod.items) {
      if (item.kind === "FunctionDecl") {
        freeFunctions.push(item);
      } else {
        this.emitModuleItem(item);
      }
    }

    if (freeFunctions.length > 0) {
      const className = this.extractClassName(mod.path) || "Functions";
      this.ctx.writeLine(`public static class ${className}`);
      this.ctx.writeLine("{");
      this.ctx.indent();
      for (const fn of freeFunctions) {
        this.emitFunctionDecl(fn, true);
        this.ctx.writeLine();
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
    }

    return this.ctx.getOutput();
  }

  private extractNamespace(modPath: string): string | null {
    if (!modPath || modPath === "main") return null;
    if (!modPath.includes("/") && !modPath.includes("\\") && !modPath.includes(".cs")) {
      return modPath.replace(/::/g, ".");
    }
    const clean = modPath.replace(/\.(cs)(\.aice)?$/, "").replace(/\.aice$/, "");
    const parts = clean.split(/[/\\]/);
    if (parts.length > 1) {
      parts.pop(); // remove file name
      return parts.join(".");
    }
    return null;
  }

  private extractClassName(modPath: string): string | null {
    if (!modPath) return null;
    const clean = modPath.replace(/\.(cs)(\.aice)?$/, "").replace(/\.aice$/, "");
    const parts = clean.split(/[./\\]/);
    const base = parts.pop();
    if (!base) return null;
    return base.charAt(0).toUpperCase() + base.slice(1);
  }

  private emitModuleItem(item: ModuleItem): void {
    switch (item.kind) {
      case "ImportDecl":
        break;
      case "TypeDecl":
        this.emitTypeDecl(item);
        this.ctx.writeLine();
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
        this.ctx.writeLine();
        break;
      case "ConstDecl":
        this.emitConstDecl(item);
        break;
      case "VarDecl":
        this.emitVarDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item, true);
        this.ctx.writeLine();
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.isEnum && t.variants) {
      this.ctx.writeLine(`public enum ${t.name}`);
      this.ctx.writeLine("{");
      this.ctx.indent();
      for (let i = 0; i < t.variants.length; i++) {
        const v = t.variants[i];
        const comma = i < t.variants.length - 1 ? "," : "";
        this.ctx.writeLine(`${v.name}${comma}`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      this.ctx.writeLine(`public struct ${t.name}`);
      this.ctx.writeLine("{");
      this.ctx.indent();
      for (const f of t.fields) {
        const typeStr = this.emitTypeExpr(f.typeAnnotation);
        this.ctx.writeLine(`public ${typeStr} ${f.name};`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private currentClassName = "";

  private emitClassDecl(c: ClassDecl): void {
    this.currentClassName = c.name;
    const nodeId = `class:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const bases: string[] = [];
    if (c.extends) bases.push(c.extends);
    if (c.implements) bases.push(...c.implements);
    const heritage = bases.length > 0 ? ` : ${bases.join(", ")}` : "";

    this.ctx.writeLine(`public class ${c.name}${heritage}`);
    this.ctx.writeLine("{");
    this.ctx.indent();

    // Primary constructor fields
    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      for (const p of c.primaryConstructor) {
        const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "object";
        this.ctx.writeLine(`public ${typeStr} ${p.name} { get; set; }`);
      }
      this.ctx.writeLine();

      const ctorParams = c.primaryConstructor
        .map((p) => {
          const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "object";
          const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
          return `${typeStr} ${p.name}${def}`;
        })
        .join(", ");

      this.ctx.writeLine(`public ${c.name}(${ctorParams})`);
      this.ctx.writeLine("{");
      this.ctx.indent();
      for (const p of c.primaryConstructor) {
        this.ctx.writeLine(`this.${p.name} = ${p.name};`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.writeLine();
    }

    // Properties
    for (const p of c.properties) {
      const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "var";
      const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)};` : " { get; set; }";
      const st = p.isStatic ? "static " : "";
      this.ctx.writeLine(`public ${st}${typeStr} ${p.name}${init}`);
    }
    if (c.properties.length > 0) {
      this.ctx.writeLine();
    }

    // Methods
    for (const m of c.methods) {
      this.emitMethodDecl(m);
      this.ctx.writeLine();
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitMethodDecl(m: MethodDecl): void {
    const isCtor = m.name === "constructor";
    const methodName = isCtor ? this.currentClassName || "Constructor" : m.name;
    const retType = m.returnType ? this.emitTypeExpr(m.returnType) : isCtor ? "" : "void";
    const st = m.isStatic ? "static " : "";
    const params = m.params
      .map((p) => {
        const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "object";
        const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${typeStr} ${p.name}${def}`;
      })
      .join(", ");

    const sig = isCtor
      ? `public ${methodName}(${params})`
      : `public ${st}${retType} ${methodName}(${params})`;

    this.ctx.writeLine(sig);
    this.ctx.writeLine("{");
    this.ctx.indent();
    if (m.body.kind === "Block") {
      this.emitBlock(m.body, !isCtor && retType !== "void");
    } else {
      this.ctx.writeLine(`return ${this.emitExpr(m.body)};`);
    }
    this.ctx.dedent();
    this.ctx.writeLine("}");
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const typeStr = c.typeAnnotation ? this.emitTypeExpr(c.typeAnnotation) : "var";
    this.ctx.writeLine(`public const ${typeStr} ${c.name} = ${this.emitExpr(c.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const typeStr = v.typeAnnotation ? this.emitTypeExpr(v.typeAnnotation) : "var";
    this.ctx.writeLine(`public static ${typeStr} ${v.name} = ${this.emitExpr(v.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitFunctionDecl(fn: FunctionDecl, isStatic = false): void {
    const nodeId = `fn:${fn.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const retType = fn.returnType ? this.emitTypeExpr(fn.returnType) : "void";
    const st = isStatic ? "static " : "";
    const paramsStr = fn.params
      .map((p) => {
        const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "object";
        const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${typeStr} ${p.name}${def}`;
      })
      .join(", ");

    this.ctx.writeLine(`public ${st}${retType} ${fn.name}(${paramsStr})`);
    this.ctx.writeLine("{");
    this.ctx.indent();

    if (fn.isExpressionBodied) {
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)};`);
    } else {
      this.emitBlock(fn.body as Block, retType !== "void");
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitBlock(block: Block, isReturning: boolean): void {
    const stmts = block.statements;
    for (let i = 0; i < stmts.length; i++) {
      const stmt = stmts[i];
      const isLast = i === stmts.length - 1;
      this.emitStatement(stmt, isLast && isReturning);
    }
  }

  private emitStatement(stmt: Statement, isImplicitReturn = false): void {
    switch (stmt.kind) {
      case "LetBinding": {
        const typeStr = stmt.typeAnnotation ? this.emitTypeExpr(stmt.typeAnnotation) : "var";
        this.ctx.writeLine(`${typeStr} ${stmt.name} = ${this.emitExpr(stmt.init)};`);
        break;
      }
      case "DestructureBinding": {
        const names = stmt.names.join(", ");
        this.ctx.writeLine(`var (${names}) = ${this.emitExpr(stmt.init)};`);
        break;
      }
      case "AssignStmt": {
        if (
          stmt.target.kind === "ArrayLiteralExpr" &&
          stmt.value.kind === "ArrayLiteralExpr" &&
          stmt.value.elements.length === stmt.target.elements.length
        ) {
          for (let i = 0; i < stmt.target.elements.length; i++) {
            const target = this.emitExpr(stmt.target.elements[i]);
            const value = this.emitExpr(stmt.value.elements[i]);
            if (stmt.op === "**=") {
              this.ctx.writeLine(`${target} = Math.Pow(${target}, ${value});`);
            } else {
              this.ctx.writeLine(`${target} ${stmt.op ?? "="} ${value};`);
            }
          }
        } else {
          const target = this.emitExpr(stmt.target);
          const value = this.emitExpr(stmt.value);
          if (stmt.op === "**=") {
            this.ctx.writeLine(`${target} = Math.Pow(${target}, ${value});`);
          } else {
            this.ctx.writeLine(`${target} ${stmt.op ?? "="} ${value};`);
          }
        }
        break;
      }
      case "ReturnStmt": {
        if (!stmt.value) {
          this.ctx.writeLine("return;");
        } else {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.value)};`);
        }
        break;
      }
      case "IfStmt": {
        const cond = this.emitExpr(stmt.condition);
        this.ctx.writeLine(`if (${cond})`);
        this.ctx.writeLine("{");
        this.ctx.indent();
        const canImplicitReturn = isImplicitReturn && Boolean(stmt.elseBranch);
        this.emitBlock(stmt.thenBranch, canImplicitReturn);
        this.ctx.dedent();

        for (const elif of stmt.elifBranches) {
          this.ctx.writeLine("}");
          this.ctx.writeLine(`else if (${this.emitExpr(elif.condition)})`);
          this.ctx.writeLine("{");
          this.ctx.indent();
          this.emitBlock(elif.body, canImplicitReturn);
          this.ctx.dedent();
        }

        if (stmt.elseBranch) {
          this.ctx.writeLine("}");
          this.ctx.writeLine("else");
          this.ctx.writeLine("{");
          this.ctx.indent();
          this.emitBlock(stmt.elseBranch, canImplicitReturn);
          this.ctx.dedent();
          this.ctx.writeLine("}");
        } else {
          this.ctx.writeLine("}");
        }
        break;
      }
      case "WhileStmt": {
        const cond = this.emitExpr(stmt.condition);
        this.ctx.writeLine(`while (${cond})`);
        this.ctx.writeLine("{");
        this.ctx.indent();
        this.emitBlock(stmt.body, false);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "ForStmt": {
        const iter = this.emitExpr(stmt.iterable);
        this.ctx.writeLine(`foreach (var ${stmt.variable} in ${iter})`);
        this.ctx.writeLine("{");
        this.ctx.indent();
        this.emitBlock(stmt.body, false);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "MatchStmt": {
        const targetStr = this.emitExpr(stmt.target);
        this.ctx.writeLine(`switch (${targetStr})`);
        this.ctx.writeLine("{");
        for (const c of stmt.cases) {
          if (c.pattern.kind === "WildcardPattern") {
            this.ctx.writeLine("default:");
          } else if (c.pattern.kind === "LiteralPattern") {
            this.ctx.writeLine(`case ${this.emitExpr(c.pattern.value)}:`);
          } else {
            this.ctx.writeLine("default:");
          }
          this.ctx.writeLine("{");
          this.ctx.indent();
          if (c.body.kind === "Block") {
            this.emitBlock(c.body, isImplicitReturn);
            const lastStmt =
              c.body.statements.length > 0
                ? c.body.statements[c.body.statements.length - 1]
                : null;
            if (
              !lastStmt ||
              (lastStmt.kind !== "ReturnStmt" && lastStmt.kind !== "BreakStmt")
            ) {
              this.ctx.writeLine("break;");
            }
          } else if (isImplicitReturn) {
            this.ctx.writeLine(`return ${this.emitExpr(c.body)};`);
          } else {
            this.ctx.writeLine(`${this.emitExpr(c.body)};`);
            this.ctx.writeLine("break;");
          }
          this.ctx.dedent();
          this.ctx.writeLine("}");
        }
        this.ctx.writeLine("}");
        break;
      }
      case "TryStmt": {
        this.ctx.writeLine("try");
        this.ctx.writeLine("{");
        this.ctx.indent();
        this.emitBlock(stmt.tryBlock, isImplicitReturn);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        const param = stmt.catchParam ?? "err";
        this.ctx.writeLine(`catch (Exception ${param})`);
        this.ctx.writeLine("{");
        if (stmt.catchBlock) {
          this.ctx.indent();
          this.emitBlock(stmt.catchBlock, isImplicitReturn);
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "BreakStmt": {
        this.ctx.writeLine("break;");
        break;
      }
      case "ContinueStmt": {
        this.ctx.writeLine("continue;");
        break;
      }
      case "ExprStmt": {
        const exprCode = this.emitExpr(stmt.expr);
        if (isImplicitReturn) {
          this.ctx.writeLine(`return ${exprCode};`);
        } else {
          this.ctx.writeLine(`${exprCode};`);
        }
        break;
      }
    }
  }

  emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr": {
        if (expr.literalKind === "string") return expr.rawValue;
        if (expr.literalKind === "number") {
          return expr.rawValue;
        }
        if (expr.literalKind === "boolean") return expr.value ? "true" : "false";
        if (expr.literalKind === "nil") return "null";
        return expr.rawValue;
      }
      case "TemplateLiteralExpr": {
        const result = "$";
        let str = '"';
        for (let i = 0; i < expr.quasis.length; i++) {
          str += expr.quasis[i];
          if (i < expr.expressions.length) {
            str += `{${this.emitExpr(expr.expressions[i])}}`;
          }
        }
        str += '"';
        return `${result}${str}`;
      }
      case "IdentifierExpr":
        return expr.name;
      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        let op: string = expr.operator;
        if (op === "and") op = "&&";
        if (op === "or") op = "||";
        if (op === "in") return `(${right}.Contains(${left}))`;
        if (op === "instanceof") return `(${left} is ${right})`;
        if (op === "**") return `Math.Pow(${left}, ${right})`;
        if (op === ">>>") return `(${left} >>> ${right})`;
        return `(${left} ${op} ${right})`;
      }
      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        const op = expr.operator === "not" ? "!" : expr.operator;
        return `${op}(${operand})`;
      }
      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

        if (expr.callee.kind === "MemberAccessExpr") {
          const objCode = this.emitExpr(expr.callee.object);
          return `${objCode}.${expr.callee.property}(${argCodes.join(", ")})`;
        }

        if (expr.callee.kind === "IdentifierExpr") {
          const fnName = expr.callee.name;
          if (fnName === "max") return `Math.Max(${argCodes.join(", ")})`;
          if (fnName === "min") return `Math.Min(${argCodes.join(", ")})`;
          if (fnName === "clamp") return `Math.Clamp(${argCodes.join(", ")})`;
          if (fnName === "floor") return `Math.Floor(${argCodes.join(", ")})`;
          if (fnName === "ceil") return `Math.Ceiling(${argCodes.join(", ")})`;
          if (fnName === "sqrt") return `Math.Sqrt(${argCodes.join(", ")})`;
          if (fnName === "pow") return `Math.Pow(${argCodes.join(", ")})`;
          if (fnName === "round") return `Math.Round(${argCodes.join(", ")})`;
          if (fnName === "abs") return `Math.Abs(${argCodes.join(", ")})`;
        }

        const callee = this.emitExpr(expr.callee);
        return `${callee}(${argCodes.join(", ")})`;
      }
      case "MemberAccessExpr": {
        const obj = this.emitExpr(expr.object);
        return `${obj}.${expr.property}`;
      }
      case "IndexExpr": {
        const obj = this.emitExpr(expr.object);
        const idx = this.emitExpr(expr.index);
        return `${obj}[${idx}]`;
      }
      case "ArrayLiteralExpr": {
        const elements = expr.elements.map((e) => this.emitExpr(e)).join(", ");
        return `new[] { ${elements} }`;
      }
      case "RecordLiteralExpr": {
        const props = expr.properties.map((p) => `${p.key} = ${this.emitExpr(p.value)}`).join(", ");
        return `new { ${props} }`;
      }
      case "AssignExpr": {
        const target = this.emitExpr(expr.target);
        const val = this.emitExpr(expr.value);
        return `(${target} ${expr.op ?? "="} ${val})`;
      }
      case "ClosureExpr": {
        const params = expr.params.map((p) => p.name).join(", ");
        const paramStr = expr.params.length === 1 ? params : `(${params})`;
        const body = expr.body.kind === "Block" ? `{ ... }` : this.emitExpr(expr.body);
        return `${paramStr} => ${body}`;
      }
      default:
        return "/* expr */";
    }
  }

  emitTypeExpr(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        if (t.primitive === "int") return "int";
        if (t.primitive === "float") return "float";
        if (t.primitive === "num") return "double";
        if (t.primitive === "byte") return "byte";
        if (t.primitive === "char") return "char";
        if (t.primitive === "str") return "string";
        if (t.primitive === "bool") return "bool";
        if (t.primitive === "void") return "void";
        if (t.primitive === "nil") return "object";
        return "object";
      case "ArrayType":
        return `List<${this.emitTypeExpr(t.elementType)}>`;
      case "TupleType": {
        const elements = t.elementTypes.map((e) => this.emitTypeExpr(e)).join(", ");
        return `(${elements})`;
      }
      case "OptionType":
        return `${this.emitTypeExpr(t.innerType)}?`;
      case "NamedType":
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.emitTypeExpr(ta)).join(", ");
          return `${t.name}<${args}>`;
        }
        return t.name;
      default:
        return "object";
    }
  }
}
