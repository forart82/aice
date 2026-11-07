/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idiomatic Kotlin 1.9 / 2.x Forward Transpiler & Mobile/Android Emitter for AICE 2.0.
 * Emits clean, modern Kotlin code from AICE Module AST:
 *   - Package declaration & imports
 *   - Data classes for records and primary constructors
 *   - Standard classes, interfaces, enum classes, and objects
 *   - Functions and single-expression functions
 *   - Coroutines via `suspend fun`
 *   - Kotlin `when` expressions / statements
 *   - Kotlin type system: Int, Long, Float, Double, String, Boolean, List<T>, Map<K, V>, T?, Unit
 *   - Null-safe operators: ?. (safe call), ?: (elvis)
 *   - val vs var
 *   - Preserving KDoc docstrings and comments from CstTriviaTable
 *   - Lossless lens source slice playback when unmutated to guarantee Put(Get(c), Omega) == c
 */

import type {
  ArrayLiteralExpr,
  AssignStmt,
  BinaryExpr,
  Block,
  CallExpr,
  ClassDecl,
  ConstDecl,
  Expr,
  FieldDecl,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  IndexExpr,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
} from "../core/ast.js";
import { createAstNodeSnapshot, getNodeTriviaId } from "../core/trivia.js";
import { EmitterContext, type EmitterOptions } from "./context.js";

export interface KotlinEmitterOptions extends EmitterOptions {
  packageName?: string;
}

export class KotlinEmitter {
  private ctx: EmitterContext;
  private options: KotlinEmitterOptions;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string }> = new Map();

  constructor(options: KotlinEmitterOptions = {}) {
    this.options = options;
    this.ctx = new EmitterContext("kotlin", {
      ...options,
      indent: options.indent ?? "    ",
    });
  }

  static emit(mod: Module, options?: KotlinEmitterOptions): string {
    return new KotlinEmitter(options).emit(mod);
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

    // Check if every item has an unmutated source slice
    const hasSlices =
      mod.items.length > 0 &&
      mod.items.every((item) => {
        const nid = getNodeTriviaId(item);
        if (!nid || !this.ctx.hasSourceSlice(nid)) return false;
        const currentSnapshot = createAstNodeSnapshot(item);
        const recordedSnapshot = this.ctx.trivia?.getNodeSnapshot(nid);
        return recordedSnapshot === undefined || recordedSnapshot === currentSnapshot;
      });

    if (hasSlices) {
      // Replay exact module trivia & slices for lossless roundtrip
      const modTrivia = this.ctx.trivia?.getTrivia("module");
      if (modTrivia) {
        for (const t of modTrivia.leading) {
          if (t.kind === "DOCSTRING") {
            this.ctx.writeLine(t.content);
            this.ctx.writeLine();
          } else if (t.kind === "LICENSE_HEADER" || t.kind === "LINE_COMMENT" || t.kind === "BLOCK_COMMENT") {
            this.ctx.writeLine(t.content);
          }
        }
      }

      // Package declaration
      const pkgTrivia = this.ctx.trivia?.getTrivia("mod:package");
      if (pkgTrivia && pkgTrivia.leading.length > 0) {
        this.ctx.writeLine(`package ${pkgTrivia.leading[0].content}`);
        this.ctx.writeLine();
      }

      // Emit items via source slices
      const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
      const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

      for (const imp of imports) {
        const nid = getNodeTriviaId(imp);
        if (nid && this.ctx.hasSourceSlice(nid)) {
          this.ctx.writeLine(this.ctx.getSourceSlice(nid)!.trimEnd());
        } else {
          this.emitImport(imp);
        }
      }

      if (imports.length > 0 && nonImports.length > 0) {
        this.ctx.writeLine();
      }

      for (let i = 0; i < nonImports.length; i++) {
        const item = nonImports[i];
        const nid = getNodeTriviaId(item);
        if (nid && this.ctx.hasSourceSlice(nid)) {
          this.ctx.writeLine(this.ctx.getSourceSlice(nid)!.trimEnd());
        } else {
          this.emitModuleItem(item);
        }
        if (i < nonImports.length - 1) {
          this.ctx.writeLine();
        }
      }

      return this.ctx.getOutput();
    }

    // Normal forward transpilation
    // 1. Package declaration
    const pkg = this.extractPackage(mod.path);
    if (pkg) {
      this.ctx.writeLine(`package ${pkg}`);
      this.ctx.writeLine();
    }

    // 2. Imports
    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

    for (const imp of imports) {
      this.emitImport(imp);
    }
    if (imports.length > 0 && nonImports.length > 0) {
      this.ctx.writeLine();
    }

    // 3. Module items
    for (let i = 0; i < nonImports.length; i++) {
      this.emitModuleItem(nonImports[i]);
      if (i < nonImports.length - 1) {
        this.ctx.writeLine();
      }
    }

    return this.ctx.getOutput();
  }

  private extractPackage(modPath: string): string | undefined {
    if (this.options.packageName) return this.options.packageName;
    const pkgTrivia = this.ctx.trivia?.getTrivia("mod:package");
    if (pkgTrivia && pkgTrivia.leading.length > 0) {
      return pkgTrivia.leading[0].content.trim();
    }
    if (!modPath || modPath === "<anonymous>" || modPath === "source" || modPath === "main") {
      return undefined;
    }
    const clean = modPath.replace(/\.(kt|kts|aice)$/i, "").replace(/^[./\\]+/, "");
    const parts = clean.split(/[/\\]/);
    if (parts.length > 1) {
      parts.pop(); // remove file name
      // Filter out standard source dir prefixes
      const filtered = parts.filter((p) => p !== "src" && p !== "main" && p !== "kotlin" && p !== "java");
      if (filtered.length > 0) {
        return filtered.join(".");
      }
    }
    return undefined;
  }

  private emitImport(imp: ImportDecl): void {
    const nid = getNodeTriviaId(imp);
    if (nid && this.ctx.hasSourceSlice(nid)) {
      this.ctx.write(this.ctx.getSourceSlice(nid)!);
      return;
    }
    this.ctx.emitLeadingTrivia(nid);

    let src = imp.source.replace(/^(\.\/|\.\.\/)+/, "").replace(/\.(kt|kts|ts|js|aice)$/, "");
    src = src.split(/[/\\]/).join(".");

    if (imp.specifiers.length === 0) {
      this.ctx.writeLine(`import ${src}`);
    } else {
      for (const spec of imp.specifiers) {
        if (spec.isWildcard) {
          this.ctx.writeLine(`import ${src}.*`);
        } else if (spec.alias) {
          this.ctx.writeLine(`import ${src}.${spec.name} as ${spec.alias}`);
        } else {
          this.ctx.writeLine(`import ${src}.${spec.name}`);
        }
      }
    }

    this.ctx.emitTrailingTrivia(nid);
  }

  private emitModuleItem(item: ModuleItem): void {
    const nid = getNodeTriviaId(item);
    if (nid && this.ctx.hasSourceSlice(nid)) {
      const currentSnapshot = createAstNodeSnapshot(item);
      const recordedSnapshot = this.ctx.trivia?.getNodeSnapshot(nid);
      if (recordedSnapshot === undefined || recordedSnapshot === currentSnapshot) {
        this.ctx.writeLine(this.ctx.getSourceSlice(nid)!.trimEnd());
        return;
      }
    }

    switch (item.kind) {
      case "ImportDecl":
        this.emitImport(item);
        break;
      case "TypeDecl":
        this.emitTypeDecl(item);
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
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
      default:
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.isEnum && t.variants) {
      this.ctx.writeLine(`enum class ${t.name} {`);
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
      // Emit as data class
      const typeParamsStr =
        t.typeParams && t.typeParams.length > 0 ? `<${t.typeParams.join(", ")}>` : "";

      if (t.fields.length === 0) {
        this.ctx.writeLine(`class ${t.name}${typeParamsStr}`);
      } else {
        this.ctx.writeLine(`data class ${t.name}${typeParamsStr}(`);
        this.ctx.indent();
        for (let i = 0; i < t.fields.length; i++) {
          const f = t.fields[i];
          const comma = i < t.fields.length - 1 ? "," : "";
          const baseType = this.emitTypeExpr(f.typeAnnotation);
          const opt = f.isOptional && !baseType.endsWith("?") ? "?" : "";
          const typeStr = baseType + opt;
          let defVal = "";
          if (f.defaultValue) {
            defVal = ` = ${this.emitExpr(f.defaultValue)}`;
          } else if (f.isOptional) {
            defVal = " = null";
          }
          this.ctx.writeLine(`val ${f.name}: ${typeStr}${defVal}${comma}`);
        }
        this.ctx.dedent();
        this.ctx.writeLine(")");
      }
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.aliasType) {
      const typeParamsStr =
        t.typeParams && t.typeParams.length > 0 ? `<${t.typeParams.join(", ")}>` : "";
      this.ctx.writeLine(`typealias ${t.name}${typeParamsStr} = ${this.emitTypeExpr(t.aliasType)}`);
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const typeParamsStr =
      c.typeParams && c.typeParams.length > 0 ? `<${c.typeParams.join(", ")}>` : "";

    // Determine if this is an interface, data class, or regular class
    const isInterface =
      c.methods.length > 0 &&
      c.methods.every((m) => !m.body || (m.body.kind === "Block" && m.body.statements.length === 0)) &&
      (!c.primaryConstructor || c.primaryConstructor.length === 0) &&
      c.properties.length === 0;

    const classTrivia = this.ctx.trivia?.getTrivia(nodeId);
    const hasDataKeyword = Boolean(this.ctx.trivia?.getTrivia("is_data:" + c.name)) || Boolean(classTrivia?.leading.some((t) => t.content.includes("data class")));

    const isData =
      Boolean(hasDataKeyword) ||
      (c.primaryConstructor && c.primaryConstructor.length > 0 && c.properties.length === 0 && !isInterface);

    let prefix = "class";
    if (isInterface) {
      prefix = "interface";
    } else if (isData) {
      prefix = "data class";
    }

    // Heritage (extends / implements)
    const bases: string[] = [];
    if (c.extends) {
      // In Kotlin, extending a class calls its constructor
      bases.push(c.extends.includes("(") ? c.extends : `${c.extends}()`);
    }
    if (c.implements) {
      for (const impl of c.implements) {
        bases.push(impl);
      }
    }
    const heritage = bases.length > 0 ? ` : ${bases.join(", ")}` : "";

    // Primary constructor
    let ctorStr = "";
    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      const params = c.primaryConstructor.map((p) => {
        const valKw = p.isMut ? "var " : "val ";
        const baseType = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "";
        const opt = p.isOptional && !baseType.endsWith("?") ? "?" : "";
        const typeStr = baseType ? `: ${baseType}${opt}` : "";
        const def = p.defaultValue
          ? ` = ${this.emitExpr(p.defaultValue)}`
          : p.isOptional
            ? " = null"
            : "";
        return `${valKw}${p.name}${typeStr}${def}`;
      });
      if (params.length > 2) {
        ctorStr = `(\n${params.map((p) => `    ${p}`).join(",\n")}\n)`;
      } else {
        ctorStr = `(${params.join(", ")})`;
      }
    }

    const hasBody = c.properties.length > 0 || c.methods.length > 0;

    if (!hasBody) {
      this.ctx.writeLine(`${prefix} ${c.name}${typeParamsStr}${ctorStr}${heritage}`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    this.ctx.writeLine(`${prefix} ${c.name}${typeParamsStr}${ctorStr}${heritage} {`);
    this.ctx.indent();

    for (const prop of c.properties) {
      this.emitPropertyDecl(prop);
    }

    if (c.properties.length > 0 && c.methods.length > 0) {
      this.ctx.writeLine();
    }

    for (let i = 0; i < c.methods.length; i++) {
      this.emitMethodDecl(c.methods[i], isInterface);
      if (i < c.methods.length - 1) {
        this.ctx.writeLine();
      }
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitPropertyDecl(p: PropertyDecl): void {
    const kw = p.isReadonly ? "val" : "var";
    const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
    let valStr = "";
    if (p.initialValue) {
      valStr = ` = ${this.emitExpr(p.initialValue)}`;
    } else if (p.isOptional) {
      valStr = " = null";
    }
    this.ctx.writeLine(`${kw} ${p.name}${typeStr}${valStr}`);
  }

  private emitMethodDecl(m: MethodDecl, isInterface = false): void {
    const asyncKw = m.isAsync ? "suspend " : "";
    const typeParamsStr =
      m.typeParams && m.typeParams.length > 0 ? `<${m.typeParams.join(", ")}> ` : "";

    const params = m.params.map((p) => {
      const baseType = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "";
      const opt = p.isOptional && !baseType.endsWith("?") ? "?" : "";
      const typeStr = baseType ? `: ${baseType}${opt}` : "";
      const def = p.defaultValue
        ? ` = ${this.emitExpr(p.defaultValue)}`
        : p.isOptional
          ? " = null"
          : "";
      return `${p.name}${typeStr}${def}`;
    }).join(", ");

    let retStr = "";
    if (m.returnType) {
      const rt = this.emitTypeExpr(m.returnType);
      if (rt !== "Unit") {
        retStr = `: ${rt}`;
      }
    }

    if (isInterface && (!m.body || (m.body.kind === "Block" && m.body.statements.length === 0))) {
      this.ctx.writeLine(`${asyncKw}fun ${typeParamsStr}${m.name}(${params})${retStr}`);
      return;
    }

    if (m.isExpressionBodied && m.body.kind !== "Block") {
      this.ctx.writeLine(
        `${asyncKw}fun ${typeParamsStr}${m.name}(${params})${retStr} = ${this.emitExpr(m.body as Expr)}`,
      );
      return;
    }

    this.ctx.writeLine(`${asyncKw}fun ${typeParamsStr}${m.name}(${params})${retStr} {`);
    this.ctx.indent();
    if (m.body.kind === "Block") {
      this.emitBlock(m.body);
    } else {
      this.ctx.writeLine(`return ${this.emitExpr(m.body as Expr)}`);
    }
    this.ctx.dedent();
    this.ctx.writeLine("}");
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    const nodeId = `fn:${fn.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const asyncKw = fn.isAsync ? "suspend " : "";
    const typeParamsStr =
      fn.typeParams && fn.typeParams.length > 0 ? `<${fn.typeParams.join(", ")}> ` : "";

    const params = fn.params.map((p) => {
      const baseType = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "";
      const opt = p.isOptional && !baseType.endsWith("?") ? "?" : "";
      const typeStr = baseType ? `: ${baseType}${opt}` : "";
      const def = p.defaultValue
        ? ` = ${this.emitExpr(p.defaultValue)}`
        : p.isOptional
          ? " = null"
          : "";
      return `${p.name}${typeStr}${def}`;
    }).join(", ");

    let retStr = "";
    if (fn.returnType) {
      const rt = this.emitTypeExpr(fn.returnType);
      if (rt !== "Unit") {
        retStr = `: ${rt}`;
      }
    }

    if (fn.isExpressionBodied && fn.body.kind !== "Block") {
      this.ctx.writeLine(
        `${asyncKw}fun ${typeParamsStr}${fn.name}(${params})${retStr} = ${this.emitExpr(fn.body as Expr)}`,
      );
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    // Check if block has only one return statement
    if (fn.body.kind === "Block" && fn.body.statements.length === 1 && fn.body.statements[0].kind === "ReturnStmt") {
      const retStmt = fn.body.statements[0] as ReturnStmt;
      if (retStmt.value && fn.isExpressionBodied) {
        this.ctx.writeLine(
          `${asyncKw}fun ${typeParamsStr}${fn.name}(${params})${retStr} = ${this.emitExpr(retStmt.value)}`,
        );
        this.ctx.emitTrailingTrivia(nodeId);
        return;
      }
    }

    this.ctx.writeLine(`${asyncKw}fun ${typeParamsStr}${fn.name}(${params})${retStr} {`);
    this.ctx.indent();
    if (fn.body.kind === "Block") {
      this.emitBlock(fn.body);
    } else {
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)}`);
    }
    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const typeStr = c.typeAnnotation ? `: ${this.emitTypeExpr(c.typeAnnotation)}` : "";
    this.ctx.writeLine(`val ${c.name}${typeStr} = ${this.emitExpr(c.value)}`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const kw = v.isMut ? "var" : "val";
    const typeStr = v.typeAnnotation ? `: ${this.emitTypeExpr(v.typeAnnotation)}` : "";
    this.ctx.writeLine(`${kw} ${v.name}${typeStr} = ${this.emitExpr(v.value)}`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitBlock(block: Block): void {
    for (const stmt of block.statements) {
      this.emitStatement(stmt);
    }
  }

  private emitStatement(stmt: Statement): void {
    switch (stmt.kind) {
      case "LetBinding": {
        const kw = stmt.isMut ? "var" : "val";
        const typeStr = stmt.typeAnnotation ? `: ${this.emitTypeExpr(stmt.typeAnnotation)}` : "";
        this.ctx.writeLine(`${kw} ${stmt.name}${typeStr} = ${this.emitExpr(stmt.init)}`);
        break;
      }
      case "DestructureBinding": {
        const kw = stmt.isMut ? "var" : "val";
        this.ctx.writeLine(`${kw} (${stmt.names.join(", ")}) = ${this.emitExpr(stmt.init)}`);
        break;
      }
      case "AssignStmt": {
        const op = stmt.op ?? "=";
        this.ctx.writeLine(`${this.emitExpr(stmt.target)} ${op} ${this.emitExpr(stmt.value)}`);
        break;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.value)}`);
        } else {
          this.ctx.writeLine("return");
        }
        break;
      }
      case "IfStmt": {
        this.emitIfStmt(stmt);
        break;
      }
      case "MatchStmt": {
        this.emitMatchStmt(stmt);
        break;
      }
      case "ForStmt": {
        this.ctx.writeLine(`for (${stmt.variable} in ${this.emitExpr(stmt.iterable)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
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
      case "TryStmt": {
        this.ctx.writeLine("try {");
        this.ctx.indent();
        this.emitBlock(stmt.tryBlock);
        this.ctx.dedent();
        if (stmt.catchBlock) {
          const param = stmt.catchParam ? `${stmt.catchParam}: Exception` : "e: Exception";
          this.ctx.writeLine(`} catch (${param}) {`);
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
        this.ctx.writeLine(`throw ${this.emitExpr(stmt.expr)}`);
        break;
      }
      case "BreakStmt": {
        this.ctx.writeLine("break");
        break;
      }
      case "ContinueStmt": {
        this.ctx.writeLine("continue");
        break;
      }
      case "ExprStmt": {
        this.ctx.writeLine(this.emitExpr(stmt.expr));
        break;
      }
    }
  }

  private emitIfStmt(stmt: IfStmt): void {
    this.ctx.writeLine(`if (${this.emitExpr(stmt.condition)}) {`);
    this.ctx.indent();
    this.emitBlock(stmt.thenBranch);
    this.ctx.dedent();

    if (stmt.elifBranches && stmt.elifBranches.length > 0) {
      for (const elif of stmt.elifBranches) {
        this.ctx.writeLine(`} else if (${this.emitExpr(elif.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(elif.body);
        this.ctx.dedent();
      }
    }

    if (stmt.elseBranch) {
      this.ctx.writeLine("} else {");
      this.ctx.indent();
      this.emitBlock(stmt.elseBranch);
      this.ctx.dedent();
    }

    this.ctx.writeLine("}");
  }

  private emitMatchStmt(stmt: MatchStmt): void {
    const isArgumentless =
      stmt.target.kind === "LiteralExpr" &&
      stmt.target.literalKind === "boolean" &&
      stmt.target.value === true;

    if (isArgumentless) {
      this.ctx.writeLine("when {");
    } else {
      this.ctx.writeLine(`when (${this.emitExpr(stmt.target)}) {`);
    }

    this.ctx.indent();
    for (const c of stmt.cases) {
      this.emitMatchCase(c);
    }
    this.ctx.dedent();
    this.ctx.writeLine("}");
  }

  private emitMatchCase(c: MatchCase): void {
    const patternStr = this.emitPattern(c.pattern);
    const guardStr = c.guard ? ` if (${this.emitExpr(c.guard)})` : "";

    const bodyAny = c.body as any;
    if (bodyAny && bodyAny.kind === "ReturnStmt") {
      const retVal = bodyAny.value ? ` ${this.emitExpr(bodyAny.value)}` : "";
      this.ctx.writeLine(`${patternStr}${guardStr} -> return${retVal}`);
      return;
    }
    if (bodyAny && bodyAny.kind === "ExprStmt") {
      this.ctx.writeLine(`${patternStr}${guardStr} -> ${this.emitExpr(bodyAny.expr)}`);
      return;
    }

    if ("statements" in c.body) {
      if (c.body.statements.length === 1) {
        const single = c.body.statements[0];
        if (single.kind === "ReturnStmt" && single.value) {
          this.ctx.writeLine(`${patternStr}${guardStr} -> return ${this.emitExpr(single.value)}`);
          return;
        }
        if (single.kind === "ExprStmt") {
          this.ctx.writeLine(`${patternStr}${guardStr} -> ${this.emitExpr(single.expr)}`);
          return;
        }
      }
      this.ctx.writeLine(`${patternStr}${guardStr} -> {`);
      this.ctx.indent();
      this.emitBlock(c.body);
      this.ctx.dedent();
      this.ctx.writeLine("}");
    } else {
      this.ctx.writeLine(`${patternStr}${guardStr} -> ${this.emitExpr(c.body as Expr)}`);
    }
  }

  private emitPattern(p: Pattern): string {
    switch (p.kind) {
      case "WildcardPattern":
        return "else";
      case "LiteralPattern":
        return this.emitLiteral(p.value);
      case "IdentifierPattern":
        return p.name;
      case "ConstructorPattern":
        return `${p.name}(${p.subPatterns.map((sp) => this.emitPattern(sp)).join(", ")})`;
      default:
        return "else";
    }
  }

  public emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr":
        return this.emitLiteral(expr);
      case "IdentifierExpr":
        return expr.name === "nil" ? "null" : expr.name;
      case "TemplateLiteralExpr":
        return this.emitTemplateLiteral(expr);
      case "BinaryExpr":
        return this.emitBinaryExpr(expr);
      case "UnaryExpr":
        return this.emitUnaryExpr(expr);
      case "PostfixTryExpr":
        return `${this.emitExpr(expr.operand)}?`;
      case "CallExpr":
        return this.emitCallExpr(expr);
      case "MemberAccessExpr":
        return this.emitMemberAccessExpr(expr);
      case "IndexExpr":
        return `${this.emitExpr(expr.object)}[${this.emitExpr(expr.index)}]`;
      case "ArrayLiteralExpr":
        return this.emitArrayLiteral(expr);
      case "RecordLiteralExpr":
        return this.emitRecordLiteral(expr);
      case "AwaitExpr":
        return this.emitExpr(expr.operand);
      case "AssignExpr": {
        const op = expr.op ?? "=";
        return `${this.emitExpr(expr.target)} ${op} ${this.emitExpr(expr.value)}`;
      }
      default:
        if ((expr as any).kind === "MatchExpr") {
          return this.emitMatchExpr(expr as any);
        }
        return "";
    }
  }

  private emitMatchExpr(matchExpr: { target: Expr; cases: MatchCase[] }): string {
    const isArgless =
      matchExpr.target.kind === "LiteralExpr" &&
      matchExpr.target.literalKind === "boolean" &&
      matchExpr.target.value === true;

    const targetStr = isArgless ? "when" : `when (${this.emitExpr(matchExpr.target)})`;
    const cases = matchExpr.cases.map((c) => {
      const pat = this.emitPattern(c.pattern);
      const guard = c.guard ? ` if (${this.emitExpr(c.guard)})` : "";
      if ("statements" in c.body) {
        if (c.body.statements.length === 1 && c.body.statements[0].kind === "ExprStmt") {
          return `${pat}${guard} -> ${this.emitExpr((c.body.statements[0] as any).expr)}`;
        }
        return `${pat}${guard} -> { ... }`;
      }
      return `${pat}${guard} -> ${this.emitExpr(c.body as Expr)}`;
    });

    return `${targetStr} {\n${cases.map((cs) => `    ${cs}`).join("\n")}\n}`;
  }

  private emitLiteral(lit: LiteralExpr): string {
    switch (lit.literalKind) {
      case "string":
        return JSON.stringify(lit.value);
      case "number":
        return String(lit.value);
      case "boolean":
        return lit.value ? "true" : "false";
      case "nil":
        return "null";
    }
  }

  private emitTemplateLiteral(expr: TemplateLiteralExpr): string {
    let result = '"';
    for (let i = 0; i < expr.quasis.length; i++) {
      result += expr.quasis[i];
      if (i < expr.expressions.length) {
        const sub = expr.expressions[i];
        if (sub.kind === "IdentifierExpr") {
          result += `$${sub.name}`;
        } else {
          result += `\${${this.emitExpr(sub)}}`;
        }
      }
    }
    result += '"';
    return result;
  }

  private emitBinaryExpr(expr: BinaryExpr): string {
    let op: string = expr.operator;
    if (op === "??") {
      op = "?:";
    } else if (op === "and") {
      op = "&&";
    } else if (op === "or") {
      op = "||";
    } else if (op === "instanceof") {
      op = "is";
    }

    const left = this.emitExpr(expr.left);
    const right = this.emitExpr(expr.right);
    return `${left} ${op} ${right}`;
  }

  private emitUnaryExpr(expr: UnaryExpr): string {
    const op = expr.operator === "not" ? "!" : expr.operator;
    return `${op}${this.emitExpr(expr.operand)}`;
  }

  private emitCallExpr(expr: CallExpr): string {
    let calleeStr = this.emitExpr(expr.callee);
    if (calleeStr === "print") {
      calleeStr = "println";
    }

    const args = expr.args.map((a) => this.emitExpr(a)).join(", ");
    return `${calleeStr}(${args})`;
  }

  private emitMemberAccessExpr(expr: MemberAccessExpr): string {
    const dot = expr.isSafeNav || expr.isOptional ? "?." : ".";
    return `${this.emitExpr(expr.object)}${dot}${expr.property}`;
  }

  private emitArrayLiteral(expr: ArrayLiteralExpr): string {
    if (expr.elements.length === 0) {
      return "emptyList()";
    }
    const elems = expr.elements.map((e) => this.emitExpr(e)).join(", ");
    return `listOf(${elems})`;
  }

  private emitRecordLiteral(expr: RecordLiteralExpr): string {
    if (expr.properties.length === 0) {
      return "emptyMap()";
    }
    const entries = expr.properties
      .map((p) => `${JSON.stringify(p.key)} to ${this.emitExpr(p.value)}`)
      .join(", ");
    return `mapOf(${entries})`;
  }

  public emitTypeExpr(t: TypeExpr | null | undefined): string {
    if (!t) return "Any";

    switch (t.kind) {
      case "PrimitiveType": {
        switch (t.primitive) {
          case "int":
            return "Int";
          case "str":
            return "String";
          case "float":
          case "num":
            return "Double";
          case "bool":
            return "Boolean";
          case "byte":
            return "Byte";
          case "char":
            return "Char";
          case "void":
          case "nil":
            return "Unit";
        }
        break;
      }
      case "ArrayType":
        return `List<${this.emitTypeExpr(t.elementType)}>`;
      case "OptionType":
        return `${this.emitTypeExpr(t.innerType)}?`;
      case "ResultType":
        return `Result<${this.emitTypeExpr(t.okType)}>`;
      case "TupleType": {
        if (t.elementTypes.length === 2) {
          return `Pair<${this.emitTypeExpr(t.elementTypes[0])}, ${this.emitTypeExpr(t.elementTypes[1])}>`;
        }
        if (t.elementTypes.length === 3) {
          return `Triple<${this.emitTypeExpr(t.elementTypes[0])}, ${this.emitTypeExpr(t.elementTypes[1])}, ${this.emitTypeExpr(t.elementTypes[2])}>`;
        }
        return `List<Any>`;
      }
      case "RecordType":
        return "Map<String, Any>";
      case "RefinementType":
        return this.emitTypeExpr(t.baseType);
      case "NamedType": {
        const name = this.mapNamedType(t.name);
        if (t.typeArgs && t.typeArgs.length > 0) {
          return `${name}<${t.typeArgs.map((a) => this.emitTypeExpr(a)).join(", ")}>`;
        }
        return name;
      }
    }
    return "Any";
  }

  private mapNamedType(name: string): string {
    switch (name.toLowerCase()) {
      case "string":
      case "str":
        return "String";
      case "int":
      case "integer":
        return "Int";
      case "long":
        return "Long";
      case "float":
        return "Float";
      case "double":
        return "Double";
      case "bool":
      case "boolean":
        return "Boolean";
      case "unit":
      case "void":
        return "Unit";
      case "any":
      case "unknown":
      case "object":
        return "Any";
      case "list":
      case "array":
        return "List";
      case "map":
        return "Map";
      case "set":
        return "Set";
      default:
        return name;
    }
  }
}
