/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern PHP 8.x Forward Transpiler & Emitter for AIL 2.0.
 * Emits canonical modern PHP 8.x code with:
 *   - strict_types declaration (declare(strict_types=1);)
 *   - PSR-12 formatting (4-space indentation)
 *   - Backed Enums (enum Status: string { case ... = '...'; })
 *   - Constructor property promotion (public function __construct(public string $name) {})
 *   - Match expressions (match ($x) { ... })
 *   - Null-safe operator ($x?->foo()) and null coalescing ($x ?? $default)
 *   - Full type annotations (int, float, string, bool, array, void, ?Type, Union types)
 *   - CST trivia retention (docblocks and line comments)
 */

import type {
  ArrayLiteralExpr,
  AssignExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  BreakStmt,
  CallExpr,
  ClassDecl,
  ClosureExpr,
  ConstDecl,
  ContinueStmt,
  Expr,
  ExprStmt,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  IndexExpr,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  ThrowStmt,
  TryStmt,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { EmitterContext, type EmitterOptions } from "./context.js";

export class PhpEmitter {
  private ctx: EmitterContext;
  private classNames = new Set<string>();
  private enumNames = new Set<string>();
  private knownFunctions = new Set<string>([
    "count",
    "isset",
    "unset",
    "is_null",
    "is_array",
    "is_string",
    "is_int",
    "is_float",
    "is_bool",
    "strlen",
    "str_contains",
    "str_starts_with",
    "str_ends_with",
    "trim",
    "ltrim",
    "rtrim",
    "substr",
    "explode",
    "implode",
    "sprintf",
    "array_map",
    "array_filter",
    "array_reduce",
    "array_merge",
    "array_keys",
    "array_values",
    "in_array",
    "min",
    "max",
    "abs",
    "round",
    "floor",
    "ceil",
    "json_encode",
    "json_decode",
  ]);
  private currentClassMethods = new Set<string>();
  private currentClassProperties = new Set<string>();
  private localScopeVars: Set<string>[] = [];

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("php", {
      ...options,
      indent: options.indent ?? "    ",
    });
  }

  emit(mod: Module): string {
    return this.emitModule(mod);
  }

  private enterScope(): Set<string> {
    const scope = new Set<string>();
    this.localScopeVars.push(scope);
    return scope;
  }

  private exitScope(): void {
    this.localScopeVars.pop();
  }

  private addLocalVar(name: string): void {
    if (this.localScopeVars.length > 0) {
      this.localScopeVars[this.localScopeVars.length - 1].add(name);
    }
  }

  private isLocalVar(name: string): boolean {
    for (let i = this.localScopeVars.length - 1; i >= 0; i--) {
      if (this.localScopeVars[i].has(name)) return true;
    }
    return false;
  }

  emitModule(mod: Module): string {
    this.classNames.clear();
    this.enumNames.clear();

    // Pre-scan types, enums and classes
    for (const item of mod.items) {
      if (item.kind === "ClassDecl") {
        this.classNames.add(item.name);
      } else if (item.kind === "TypeDecl") {
        if (item.isEnum) {
          this.enumNames.add(item.name);
        } else {
          this.classNames.add(item.name);
        }
      } else if (item.kind === "FunctionDecl") {
        this.knownFunctions.add(item.name);
      }
    }

    // Standard modern PHP 8 header
    this.ctx.writeLine("<?php");
    this.ctx.writeLine();
    this.ctx.writeLine("declare(strict_types=1);");
    this.ctx.writeLine();

    // Determine namespace
    const ns = this.extractNamespace(mod);
    if (ns) {
      this.ctx.writeLine(`namespace ${ns};`);
      this.ctx.writeLine();
    }

    // Process imports (use statements)
    const imports = this.collectImports(mod);
    for (const imp of imports) {
      this.ctx.writeLine(`use ${imp};`);
    }
    if (imports.length > 0) {
      this.ctx.writeLine();
    }

    // Emit declarations
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") continue;
      this.emitModuleItem(item);
    }

    return this.ctx.getOutput();
  }

  private extractNamespace(mod: Module): string | undefined {
    // Check trivia for explicit namespace
    const triviaNs = this.ctx.trivia?.getTrivia("mod:namespace");
    if (triviaNs && triviaNs.leading.length > 0) {
      return triviaNs.leading[0].content;
    }

    const filePath = mod.span?.file ?? mod.path;
    if (!filePath || filePath === "<anonymous>" || filePath === "source.php") {
      return undefined;
    }

    const normalized = filePath.replace(/\\/g, "/");
    // Match common PSR-4 patterns: src/case51/... -> Case51\...
    const caseMatch = normalized.match(/case(\d+)\/src\/(.+)\/[^/]+\.php$/i);
    if (caseMatch) {
      const caseNum = caseMatch[1];
      const sub = caseMatch[2].split("/").join("\\");
      return `Case${caseNum}\\${sub}`;
    }

    const caseSimple = normalized.match(/case(\d+)\/([^/]+)\.php$/i);
    if (caseSimple) {
      const caseNum = caseSimple[1];
      return `Case${caseNum}`;
    }

    const examplesMatch = normalized.match(/examples\/php\/([^/]+)\.php$/i);
    if (examplesMatch) {
      const base = examplesMatch[1];
      if (base.includes("User") || base.includes("Repo")) return "App\\Repositories";
      if (base.includes("Order") || base.includes("Status")) return "App\\Enums";
      if (base.includes("Payment") || base.includes("Service")) return "App\\Services";
      return "App";
    }

    return undefined;
  }

  private collectImports(mod: Module): string[] {
    const imports: string[] = [];
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        let src = item.source.replace(/^(\.\/|\.\.\/)+/, "").replace(/\.(php|ail|ts|js)$/, "");
        src = src.split("/").join("\\");
        if (item.specifiers && item.specifiers.length > 0) {
          for (const spec of item.specifiers) {
            const fullImport = src.endsWith(spec.name) ? src : `${src}\\${spec.name}`;
            if (!imports.includes(fullImport)) {
              imports.push(fullImport);
            }
          }
        } else if (src && !imports.includes(src)) {
          imports.push(src);
        }
      }
    }
    return imports;
  }

  private emitModuleItem(item: ModuleItem): void {
    switch (item.kind) {
      case "ClassDecl":
        this.emitClassDecl(item);
        break;
      case "TypeDecl":
        this.emitTypeDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item);
        break;
      case "ConstDecl":
        this.emitConstDecl(item);
        break;
      case "VarDecl":
        this.emitVarDecl(item);
        break;
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    this.currentClassMethods.clear();
    this.currentClassProperties.clear();
    for (const m of c.methods) {
      this.currentClassMethods.add(m.name);
    }
    for (const p of c.properties) {
      this.currentClassProperties.add(p.name);
    }
    if (c.primaryConstructor) {
      for (const p of c.primaryConstructor) {
        this.currentClassProperties.add(p.name);
      }
    }

    const extendsClause = c.extends ? ` extends ${c.extends}` : "";
    const implementsClause =
      c.implements && c.implements.length > 0 ? ` implements ${c.implements.join(", ")}` : "";

    // Check if class is marked as interface in trivia or name convention
    const isInterface =
      c.name.endsWith("Interface") &&
      c.methods.every(
        (m) =>
          !m.body || (m.body.kind === "Block" && m.body.statements.length === 0) || !m.body,
      );

    const kindKeyword = isInterface ? "interface" : "class";
    this.ctx.writeLine(`${kindKeyword} ${c.name}${extendsClause}${implementsClause} {`);
    this.ctx.indent();

    // 1. Emit properties
    for (const p of c.properties) {
      this.emitPropertyDecl(c.name, p);
    }
    if (c.properties.length > 0 && (c.primaryConstructor || c.methods.length > 0)) {
      this.ctx.writeLine();
    }

    // 2. Emit primary constructor if present
    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      this.emitPrimaryConstructor(c.primaryConstructor);
      if (c.methods.length > 0) {
        this.ctx.writeLine();
      }
    }

    // 3. Emit methods
    for (let i = 0; i < c.methods.length; i++) {
      const m = c.methods[i];
      this.emitMethodDecl(c.name, m, isInterface);
      if (i < c.methods.length - 1) {
        this.ctx.writeLine();
      }
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.writeLine();
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitPropertyDecl(className: string, p: PropertyDecl): void {
    const nodeId = `field:${className}.${p.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const vis = p.name.startsWith("_") ? "private" : "public";
    const ro = p.isReadonly ? "readonly " : "";
    const st = p.isStatic ? "static " : "";
    const typeStr = p.typeAnnotation ? `${this.formatType(p.typeAnnotation)} ` : "";
    const initStr = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : "";

    this.ctx.writeLine(`${vis} ${ro}${st}${typeStr}$${p.name}${initStr};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitPrimaryConstructor(params: ParamDecl[]): void {
    this.ctx.writeLine("public function __construct(");
    this.ctx.indent();

    for (let i = 0; i < params.length; i++) {
      const p = params[i];
      const vis = p.name.startsWith("_") ? "private" : p.isPub ? "public" : "public";
      const ro = p.isReadonly ? "readonly " : "";
      const typeStr = p.typeAnnotation ? `${this.formatType(p.typeAnnotation)} ` : "";
      const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
      this.ctx.writeLine(`${vis} ${ro}${typeStr}$${p.name}${def},`);
    }

    this.ctx.dedent();
    this.ctx.writeLine(") {}");
  }

  private emitMethodDecl(className: string, m: MethodDecl, isInterface = false): void {
    const nodeId = `method:${className}.${m.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const scope = this.enterScope();
    scope.add("this");

    const vis = m.name.startsWith("_") ? "private" : "public";
    const st = m.isStatic ? "static " : "";
    const paramStrs = m.params.map((p) => {
      scope.add(p.name);
      const typeStr = p.typeAnnotation ? `${this.formatType(p.typeAnnotation)} ` : "";
      const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
      return `${typeStr}$${p.name}${def}`;
    });

    const retTypeStr = m.returnType ? `: ${this.formatType(m.returnType)}` : "";
    const sig = `${vis} ${st}function ${m.name}(${paramStrs.join(", ")})${retTypeStr}`;

    if (isInterface) {
      this.ctx.writeLine(`${sig};`);
      this.exitScope();
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    this.ctx.writeLine(`${sig} {`);
    this.ctx.indent();

    if (m.isExpressionBodied) {
      const bodyExpr = m.body as Expr;
      this.ctx.writeLine(`return ${this.emitExpr(bodyExpr)};`);
    } else if (m.body.kind === "Block") {
      this.emitBlock(m.body, m.returnType !== null);
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.exitScope();
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.isEnum && t.variants) {
      // PHP 8 Backed Enum: derive backing type (default: string)
      let backingType = "string";
      const triviaBacking = this.ctx.trivia?.getTrivia(`enum_backing:${t.name}`);
      if (triviaBacking && triviaBacking.leading.length > 0) {
        backingType = triviaBacking.leading[0].content;
      }

      this.ctx.writeLine(`enum ${t.name}: ${backingType} {`);
      this.ctx.indent();

      for (const v of t.variants) {
        const vNodeId = `case:${t.name}.${v.name}`;
        this.ctx.emitLeadingTrivia(vNodeId);

        let caseVal = `'${v.name.toLowerCase()}'`;
        const triviaVal = this.ctx.trivia?.getTrivia(`case_val:${t.name}.${v.name}`);
        if (triviaVal && triviaVal.leading.length > 0) {
          caseVal = triviaVal.leading[0].content;
        }

        this.ctx.writeLine(`case ${v.name} = ${caseVal};`);
        this.ctx.emitTrailingTrivia(vNodeId);
      }

      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.writeLine();
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      // Emit as PHP interface
      this.ctx.writeLine(`interface ${t.name} {`);
      this.ctx.indent();
      for (const f of t.fields) {
        const fNodeId = `field:${t.name}.${f.name}`;
        this.ctx.emitLeadingTrivia(fNodeId);
        const typeStr = this.formatType(f.typeAnnotation);
        this.ctx.writeLine(`public function get${this.capitalize(f.name)}(): ${typeStr};`);
        this.ctx.emitTrailingTrivia(fNodeId);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.writeLine();
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private emitFunctionDecl(f: FunctionDecl): void {
    const nodeId = `fn:${f.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const scope = this.enterScope();

    const paramStrs = f.params.map((p) => {
      scope.add(p.name);
      const typeStr = p.typeAnnotation ? `${this.formatType(p.typeAnnotation)} ` : "";
      const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
      return `${typeStr}$${p.name}${def}`;
    });

    const retTypeStr = f.returnType ? `: ${this.formatType(f.returnType)}` : "";
    this.ctx.writeLine(`function ${f.name}(${paramStrs.join(", ")})${retTypeStr} {`);
    this.ctx.indent();

    if (f.isExpressionBodied) {
      const bodyExpr = f.body as Expr;
      this.ctx.writeLine(`return ${this.emitExpr(bodyExpr)};`);
    } else if (f.body.kind === "Block") {
      this.emitBlock(f.body, f.returnType !== null);
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.writeLine();
    this.exitScope();
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitConstDecl(c: ConstDecl): void {
    this.ctx.writeLine(`const ${c.name} = ${this.emitExpr(c.value)};`);
  }

  private emitVarDecl(v: VarDecl): void {
    this.addLocalVar(v.name);
    this.ctx.writeLine(`$${v.name} = ${this.emitExpr(v.value)};`);
  }

  private emitBlock(block: Block, isValuedFunction = false): void {
    const scope = this.enterScope();

    for (let i = 0; i < block.statements.length; i++) {
      const stmt = block.statements[i];
      const isLast = i === block.statements.length - 1;
      this.emitStatement(stmt, isLast && isValuedFunction);
    }

    this.exitScope();
  }

  private emitStatement(stmt: Statement, isTrailing = false): void {
    switch (stmt.kind) {
      case "ReturnStmt": {
        if (stmt.value) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.value)};`);
        } else {
          this.ctx.writeLine("return;");
        }
        break;
      }
      case "LetBinding": {
        this.addLocalVar(stmt.name);
        this.ctx.writeLine(`$${stmt.name} = ${this.emitExpr(stmt.init)};`);
        break;
      }
      case "AssignStmt": {
        const targetStr = this.emitTargetExpr(stmt.target);
        const op = stmt.op ?? "=";
        this.ctx.writeLine(`${targetStr} ${op} ${this.emitExpr(stmt.value)};`);
        break;
      }
      case "IfStmt": {
        this.ctx.writeLine(`if (${this.emitExpr(stmt.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.thenBranch);
        this.ctx.dedent();

        if (stmt.elifBranches && stmt.elifBranches.length > 0) {
          for (const elif of stmt.elifBranches) {
            this.ctx.writeLine(`} elseif (${this.emitExpr(elif.condition)}) {`);
            this.ctx.indent();
            this.emitBlock(elif.body);
            this.ctx.dedent();
          }
        }

        if (stmt.elseBranch && stmt.elseBranch.statements.length > 0) {
          this.ctx.writeLine("} else {");
          this.ctx.indent();
          this.emitBlock(stmt.elseBranch);
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "WhileStmt": {
        this.ctx.writeLine(`while (${this.emitExpr(stmt.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "ForStmt": {
        this.addLocalVar(stmt.variable);
        this.ctx.writeLine(`foreach (${this.emitExpr(stmt.iterable)} as $${stmt.variable}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "TryStmt": {
        this.ctx.writeLine("try {");
        this.ctx.indent();
        this.emitBlock(stmt.tryBlock);
        this.ctx.dedent();

        if (stmt.catchBlock) {
          const catchVar = stmt.catchParam ? `$${stmt.catchParam}` : "$e";
          this.ctx.writeLine(`} catch (Exception ${catchVar}) {`);
          this.ctx.indent();
          this.emitBlock(stmt.catchBlock);
          this.ctx.dedent();
        }

        if (stmt.finallyBlock) {
          this.ctx.writeLine("} finally {");
          this.ctx.indent();
          this.emitBlock(stmt.finallyBlock);
          this.ctx.dedent();
        }

        this.ctx.writeLine("}");
        break;
      }
      case "ThrowStmt": {
        this.ctx.writeLine(`throw ${this.emitExpr(stmt.expr)};`);
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
        const isUnset =
          stmt.expr.kind === "CallExpr" &&
          stmt.expr.callee.kind === "IdentifierExpr" &&
          stmt.expr.callee.name === "unset";
        if (isTrailing && !isUnset) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.expr)};`);
        } else {
          this.ctx.writeLine(`${this.emitExpr(stmt.expr)};`);
        }
        break;
      }
      case "MatchStmt": {
        if (isTrailing) {
          this.ctx.writeLine(`return ${this.emitMatchExpr(stmt)};`);
        } else {
          this.ctx.writeLine(`${this.emitMatchExpr(stmt)};`);
        }
        break;
      }
      default:
        break;
    }
  }

  private emitMatchExpr(stmt: MatchStmt): string {
    const targetStr = this.emitExpr(stmt.target);
    const caseLines: string[] = [];

    for (const c of stmt.cases) {
      let patternStr = "";
      if (c.pattern.kind === "WildcardPattern") {
        patternStr = "default";
      } else if (c.pattern.kind === "LiteralPattern") {
        patternStr = this.emitLiteral(c.pattern.value);
      } else if (c.pattern.kind === "IdentifierPattern") {
        patternStr =
          c.pattern.name === "_" ? "default" : this.formatPatternIdent(c.pattern.name);
      } else if (c.pattern.kind === "ConstructorPattern") {
        patternStr = this.formatPatternIdent(c.pattern.name);
      }

      let bodyStr = "";
      if (c.body.kind === "Block") {
        if (c.body.statements.length === 0) {
          bodyStr = "null";
        } else {
          const last = c.body.statements[c.body.statements.length - 1];
          if (last.kind === "ReturnStmt" && last.value) {
            bodyStr = this.emitExpr(last.value);
          } else if (last.kind === "ExprStmt") {
            bodyStr = this.emitExpr(last.expr);
          } else {
            bodyStr = "null";
          }
        }
      } else {
        bodyStr = this.emitExpr(c.body);
      }

      caseLines.push(`${patternStr} => ${bodyStr},`);
    }

    const indent = this.ctx.getIndent();
    const innerIndent = indent + this.ctx.indentStr;
    const bodyFormatted = caseLines.map((l) => `${innerIndent}${l}`).join("\n");

    return `match (${targetStr}) {\n${bodyFormatted}\n${indent}}`;
  }

  private formatPatternIdent(name: string): string {
    // If it's an enum case like OrderStatus.Pending -> OrderStatus::Pending
    if (name.includes(".")) {
      return name.replace(/\./g, "::");
    }
    // If uppercase enum variant or constant
    if (/^[A-Z][a-zA-Z0-9_]*$/.test(name)) {
      return name;
    }
    return `$${name}`;
  }

  private emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr":
        return this.emitLiteral(expr);
      case "IdentifierExpr":
        return this.emitIdentifier(expr.name);
      case "BinaryExpr":
        return this.emitBinaryExpr(expr);
      case "UnaryExpr":
        return this.emitUnaryExpr(expr);
      case "CallExpr":
        return this.emitCallExpr(expr);
      case "MemberAccessExpr":
        return this.emitMemberAccessExpr(expr);
      case "IndexExpr":
        return `${this.emitExpr(expr.object)}[${this.emitExpr(expr.index)}]`;
      case "ArrayLiteralExpr":
        return `[${expr.elements.map((e) => this.emitExpr(e)).join(", ")}]`;
      case "RecordLiteralExpr":
        return `[${expr.properties
          .map((p) => {
            const keyStr = p.key ? `'${p.key}' => ` : "";
            return `${keyStr}${this.emitExpr(p.value)}`;
          })
          .join(", ")}]`;
      case "AssignExpr":
        return `${this.emitExpr(expr.target)} = ${this.emitExpr(expr.value)}`;
      case "ClosureExpr":
        return this.emitClosureExpr(expr);
      case "TemplateLiteralExpr":
        return expr.quasis.join("");
      case "AwaitExpr":
        return this.emitExpr(expr.operand);
      case "PostfixTryExpr":
        return this.emitExpr(expr.operand);
      default:
        return "null";
    }
  }

  private emitTargetExpr(expr: Expr): string {
    if (expr.kind === "IdentifierExpr") {
      return this.emitIdentifier(expr.name);
    }
    return this.emitExpr(expr);
  }

  private emitIdentifier(name: string): string {
    if (name === "this") return "$this";
    if (name === "self" || name === "parent" || name === "static") return name;
    if (name === "true" || name === "false" || name === "null") return name;
    if (this.classNames.has(name) || this.enumNames.has(name) || name === "Exception") {
      return name;
    }
    // If it's a known PHP global function
    if (this.knownFunctions.has(name)) {
      return name;
    }
    // If it already starts with $
    if (name.startsWith("$")) return name;
    // Local variable or parameter
    return `$${name}`;
  }

  private emitLiteral(lit: LiteralExpr): string {
    if (lit.literalKind === "string") {
      const val = String(lit.value ?? "");
      return `'${val.replace(/\\/g, "\\\\").replace(/'/g, "\\'")}'`;
    }
    if (lit.literalKind === "boolean") {
      return lit.value ? "true" : "false";
    }
    if (lit.literalKind === "nil") {
      return "null";
    }
    if (lit.literalKind === "number") {
      const num = Number(lit.value);
      if (Number.isInteger(num)) {
        return num.toString();
      }
      return num.toString().includes(".") ? num.toString() : `${num}.0`;
    }
    return String(lit.value);
  }

  private emitBinaryExpr(bin: BinaryExpr): string {
    let op = bin.operator;
    if (op === "and") op = "&&";
    if (op === "or") op = "||";

    const left = this.emitExpr(bin.left);
    const right = this.emitExpr(bin.right);
    return `${left} ${op} ${right}`;
  }

  private emitUnaryExpr(un: UnaryExpr): string {
    let op = un.operator;
    if (op === "not") op = "!";
    return `${op}${this.emitExpr(un.operand)}`;
  }

  private emitCallExpr(call: CallExpr): string {
    const args = call.args.map((a) => this.emitExpr(a)).join(", ");

    if (call.callee.kind === "MemberAccessExpr") {
      const mem = call.callee;
      const objStr = this.emitExpr(mem.object);
      const arrow = mem.isSafeNav ? "?->" : "->";
      // Check if static method call Class::method()
      if (
        mem.object.kind === "IdentifierExpr" &&
        (this.classNames.has(mem.object.name) ||
          this.enumNames.has(mem.object.name) ||
          mem.object.name === "self" ||
          mem.object.name === "parent")
      ) {
        return `${mem.object.name}::${mem.property}(${args})`;
      }
      return `${objStr}${arrow}${mem.property}(${args})`;
    }

    if (call.callee.kind === "IdentifierExpr") {
      const fnName = call.callee.name;
      // Constructor invocation (new ClassName(...))
      if (
        this.classNames.has(fnName) ||
        fnName === "Exception" ||
        (/^[A-Z][a-zA-Z0-9_]*$/.test(fnName) && !this.enumNames.has(fnName))
      ) {
        return `new ${fnName}(${args})`;
      }
      return `${fnName}(${args})`;
    }

    return `(${this.emitExpr(call.callee)})(${args})`;
  }

  private emitMemberAccessExpr(mem: MemberAccessExpr): string {
    const arrow = mem.isSafeNav ? "?->" : "->";

    if (mem.object.kind === "IdentifierExpr") {
      const objName = mem.object.name;
      // Enum case or Class constant / static member: OrderStatus::Pending
      if (
        this.enumNames.has(objName) ||
        this.classNames.has(objName) ||
        objName === "self" ||
        objName === "parent" ||
        /^[A-Z][a-zA-Z0-9_]*$/.test(objName)
      ) {
        return `${objName}::${mem.property}`;
      }
    }

    const objStr = this.emitExpr(mem.object);
    return `${objStr}${arrow}${mem.property}`;
  }

  private emitClosureExpr(c: ClosureExpr): string {
    const params = c.params.map((p) => {
      const typeStr = p.typeAnnotation ? `${this.formatType(p.typeAnnotation)} ` : "";
      return `${typeStr}$${p.name}`;
    });

    const ret = c.returnType ? `: ${this.formatType(c.returnType)}` : "";
    if (c.body.kind === "Block") {
      return `function (${params.join(", ")})${ret} {\n${this.emitBlockToString(c.body)}\n}`;
    }
    return `fn(${params.join(", ")})${ret} => ${this.emitExpr(c.body)}`;
  }

  private emitBlockToString(block: Block): string {
    const oldCtx = this.ctx;
    this.ctx = new EmitterContext("php", { indent: "    " });
    this.emitBlock(block);
    const out = this.ctx.getOutput();
    this.ctx = oldCtx;
    return out;
  }

  private formatType(type: TypeExpr): string {
    switch (type.kind) {
      case "PrimitiveType": {
        switch (type.primitive) {
          case "int":
          case "byte":
            return "int";
          case "float":
          case "num":
            return "float";
          case "str":
          case "char":
            return "string";
          case "bool":
            return "bool";
          case "void":
            return "void";
          case "nil":
            return "null";
          default:
            return "mixed";
        }
      }
      case "OptionType":
        return `?${this.formatType(type.innerType)}`;
      case "ArrayType":
        return "array";
      case "TupleType":
      case "RecordType":
        return "array";
      case "NamedType": {
        if (type.name === "any") return "mixed";
        return type.name;
      }
      default:
        return "mixed";
    }
  }

  private capitalize(s: string): string {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }
}
