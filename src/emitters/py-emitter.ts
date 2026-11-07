import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Block,
  ClassDecl,
  ConstDecl,
  Expr,
  FunctionDecl,
  ImportDecl,
  MethodDecl,
  Module,
  ModuleItem,
  Pattern,
  Statement,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { createAstNodeSnapshot, getNodeTriviaId } from "../core/trivia.js";
import { EmitterContext, type EmitterOptions } from "./context.js";
import { lowerConstructor, lowerMethodCall, lowerPropertyAccess } from "./rewriter.js";

export interface PythonEmitterOptions extends EmitterOptions {
  useDataclasses?: boolean;
}

export class PythonEmitter {
  private ctx: EmitterContext;
  private options: PythonEmitterOptions;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string; payloadCount: number }> = new Map();
  private varTypes: Map<string, string> = new Map();
  private closureCount = 0;
  private pendingHoistedDefs: string[] = [];

  constructor(options: PythonEmitterOptions = {}) {
    this.options = options;
    this.ctx = new EmitterContext("python", {
      ...options,
      indent: options.indent ?? "    ", // standard 4 spaces for Python
    });
  }

  static emit(mod: Module, options?: PythonEmitterOptions): string {
    return new PythonEmitter(options).emit(mod);
  }

  emit(mod: Module): string {
    return this.emitModule(mod);
  }

  emitModule(mod: Module): string {
    this.structTypes.clear();
    this.enumVariants.clear();
    this.varTypes.clear();
    this.closureCount = 0;
    this.pendingHoistedDefs = [];
    for (const item of mod.items) {
      if (item.kind === "TypeDecl") {
        if (item.fields) {
          this.structTypes.set(
            item.name,
            item.fields.map((f) => f.name),
          );
        } else if (item.isEnum && item.variants) {
          for (const v of item.variants) {
            this.enumVariants.set(v.name, {
              parentEnum: item.name,
              payloadCount: v.payloadTypes?.length ?? 0,
            });
          }
        }
      }
    }

    // Scan imported modules for struct definitions to support cross-module positional constructors & spreads
    const baseDir =
      mod.span?.file &&
      mod.span.file !== "<anonymous>" &&
      fs.existsSync(path.dirname(mod.span.file))
        ? path.dirname(path.resolve(mod.span.file))
        : process.cwd();
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        const importSrc = item.source;
        const candidateNames = [importSrc.replace(/\.[a-zA-Z]+$/, ".aice"), importSrc];
        for (const cand of candidateNames) {
          const resolved = path.resolve(baseDir, cand);
          if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
            try {
              const content = fs.readFileSync(resolved, "utf-8");
              const lines = content.split("\n");
              for (const line of lines) {
                const match = line.match(/^type\s+([A-Za-z0-9_]+)\s*:\s*(.+)$/);
                if (match) {
                  const sName = match[1];
                  const fieldDefs = match[2].split(",").map((f) => f.trim().split(":")[0].trim());
                  if (!this.structTypes.has(sName)) {
                    this.structTypes.set(sName, fieldDefs);
                  }
                }
              }
            } catch {}
            break;
          }
        }
      }
    }

    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

    const hasSlices =
      mod.items.length > 0 &&
      mod.items.every((item) => {
        const nid = getNodeTriviaId(item);
        return nid && this.ctx.hasSourceSlice(nid);
      });

    if (hasSlices) {
      const modTrivia = this.ctx.trivia?.getTrivia("module");
      if (modTrivia) {
        for (const t of modTrivia.leading) {
          if (t.kind === "DOCSTRING") {
            this.ctx.writeLine(`"""${t.content.replace(/^"""|"""$/g, "").trim()}"""`);
            this.ctx.writeLine();
          } else if (t.kind === "LICENSE_HEADER" || t.kind === "LINE_COMMENT") {
            for (const line of t.content.split("\n")) {
              const trimmed = line.trimStart();
              if (trimmed.startsWith("//")) {
                const pad = line.slice(0, line.length - trimmed.length);
                this.ctx.writeLine(pad + "#" + trimmed.slice(2));
              } else {
                this.ctx.writeLine(line);
              }
            }
          }
        }
      }

      for (const imp of imports) {
        this.emitImport(imp);
      }

      if (imports.length > 0 && nonImports.length > 0) {
        this.ctx.writeLine();
      }

      for (let i = 0; i < nonImports.length; i++) {
        this.emitModuleItem(nonImports[i]);
        if (i < nonImports.length - 1) {
          this.ctx.writeLine();
        }
      }
      return this.ctx.getOutput();
    }

    const hasDataclass =
      this.options.useDataclasses ||
      mod.items.some(
        (i) =>
          (i.kind === "ClassDecl" && this.isDataclass(i)) ||
          (i.kind === "TypeDecl" && i.fields && this.isDataclassType(i)),
      );

    const modTrivia = this.ctx.trivia?.getTrivia("module");
    if (modTrivia) {
      for (const t of modTrivia.leading) {
        if (t.kind === "DOCSTRING") {
          this.ctx.writeLine(`"""${t.content.replace(/^"""|"""$/g, "").trim()}"""`);
          this.ctx.writeLine();
        } else if (t.kind === "LICENSE_HEADER" || t.kind === "LINE_COMMENT") {
          for (const line of t.content.split("\n")) {
            const trimmed = line.trimStart();
            if (trimmed.startsWith("//")) {
              const pad = line.slice(0, line.length - trimmed.length);
              this.ctx.writeLine(pad + "#" + trimmed.slice(2));
            } else {
              this.ctx.writeLine(line);
            }
          }
        }
      }
    }

    if (hasDataclass && !imports.some((imp) => imp.source === "dataclasses")) {
      this.ctx.writeLine("from dataclasses import dataclass");
    }
    if (!imports.some((imp) => imp.source === "typing")) {
      this.ctx.writeLine("from typing import Any, Optional, Union, TypedDict");
      this.ctx.writeLine();
    }

    for (const imp of imports) {
      this.emitImport(imp);
    }

    if (imports.length > 0 && nonImports.length > 0) {
      this.ctx.writeLine();
    }

    for (let i = 0; i < nonImports.length; i++) {
      this.emitModuleItem(nonImports[i]);
      if (i < nonImports.length - 1) {
        this.ctx.writeLine();
      }
    }

    let out = this.ctx.getOutput();
    if (out.includes("math.") && !out.includes("import math")) {
      out = out.replace(
        "from typing import Any, Optional, Union, TypedDict\n",
        "from typing import Any, Optional, Union, TypedDict\nimport math\n",
      );
    }
    return out;
  }

  private isDataclass(c: ClassDecl): boolean {
    if (this.options.useDataclasses) return true;
    if (this.ctx.trivia?.getTrivia(`is_dataclass:${c.name}`)) return true;
    const classTrivia = this.ctx.trivia?.getTrivia(`class:${c.name}`);
    if (classTrivia && classTrivia.leading.some((t) => t.content.includes("@dataclass"))) {
      return true;
    }
    return false;
  }

  private isDataclassType(t: TypeDecl): boolean {
    if (this.options.useDataclasses) return true;
    if (this.ctx.trivia?.getTrivia(`is_dataclass:${t.name}`)) return true;
    const typeTrivia = this.ctx.trivia?.getTrivia(`type:${t.name}`);
    if (typeTrivia && typeTrivia.leading.some((l) => l.content.includes("@dataclass"))) {
      return true;
    }
    return false;
  }

  private emitLeadingTrivia(nodeId: string): void {
    if (!this.ctx.trivia) return;
    const entry = this.ctx.trivia.getTrivia(nodeId);
    if (!entry) return;

    if (entry.blankLinesBefore && entry.blankLinesBefore > 0) {
      for (let i = 0; i < entry.blankLinesBefore; i++) {
        this.ctx.writeLine();
      }
    }

    for (const item of entry.leading) {
      if (item.kind === "DOCSTRING") continue;
      const lines = item.content.split("\n");
      for (const line of lines) {
        const trimmed = line.trimStart();
        if (trimmed.startsWith("//")) {
          const pad = line.slice(0, line.length - trimmed.length);
          this.ctx.writeLine(pad + "#" + trimmed.slice(2));
        } else {
          this.ctx.writeLine(line);
        }
      }
    }
  }

  private emitDocstring(nodeId: string): void {
    if (!this.ctx.trivia) return;
    const entry = this.ctx.trivia.getTrivia(nodeId);
    if (!entry) return;
    for (const item of entry.leading) {
      if (item.kind === "DOCSTRING") {
        const clean = item.content.replace(/^"""|"""$/g, "").trim();
        this.ctx.writeLine(`"""${clean}"""`);
      }
    }
  }

  private canReplaySourceSlice(item: ModuleItem, nodeId: string): boolean {
    if (!this.ctx.trivia) return false;
    const entry = this.ctx.trivia.getTrivia(nodeId);
    if (!entry || !entry.sourceSlice) return false;
    if (entry.nodeSnapshot) {
      const currentSnapshot = createAstNodeSnapshot(item);
      if (currentSnapshot !== entry.nodeSnapshot) {
        return false;
      }
    }
    return true;
  }

  private getSourceSlice(nodeId: string): string | undefined {
    if (!this.ctx.trivia) return undefined;
    const entry = this.ctx.trivia.getTrivia(nodeId);
    return entry?.sourceSlice;
  }

  private emitImport(imp: ImportDecl): void {
    const nodeId = `import:${imp.source}`;
    if (this.canReplaySourceSlice(imp, nodeId)) {
      const slice = this.getSourceSlice(nodeId)!;
      this.ctx.writeLine(slice.trim());
      return;
    }
    let modName = imp.source.replace(/\.(py|ts|js|aice)$/, "");
    if (modName.startsWith("./")) {
      modName = "." + modName.slice(2).replace(/\//g, ".");
    } else if (modName.startsWith("../")) {
      modName = ".." + modName.slice(3).replace(/\//g, ".");
    } else if (modName.startsWith(".")) {
      modName = "." + modName.slice(1).replace(/\//g, ".");
    } else {
      modName = modName.replace(/\//g, ".");
    }
    if (imp.specifiers.length === 0) {
      this.ctx.writeLine(`import ${modName}`);
      return;
    }
    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      this.ctx.writeLine(`from ${modName} import *`);
      return;
    }
    const specs = imp.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
    this.ctx.writeLine(`from ${modName} import ${specs.join(", ")}`);
  }

  private emitModuleItem(item: ModuleItem): void {
    const nodeId = getNodeTriviaId(item);
    if (nodeId && this.canReplaySourceSlice(item, nodeId)) {
      const slice = this.getSourceSlice(nodeId)!;
      this.ctx.writeLine(slice.trimEnd());
      return;
    }
    switch (item.kind) {
      case "TypeDecl":
        this.emitTypeDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item);
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
        break;
      case "ConstDecl":
      case "VarDecl":
        this.emitConstOrVarDecl(item);
        break;
      default:
        break;
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.emitLeadingTrivia(nodeId);

    const isDc = this.isDataclass(c) || c.extends === "TypedDict";
    if (isDc) {
      this.ctx.writeLine("@dataclass");
    }

    const ext = c.extends ? `(${c.extends})` : "";
    this.ctx.writeLine(`class ${c.name}${ext}:`);
    this.ctx.indent();
    this.emitDocstring(nodeId);

    const hasPrimaryCtor = !!(c.primaryConstructor && c.primaryConstructor.length > 0);
    const hasExplicitInit = c.methods.some(
      (m) => m.name === "__init__" || m.name === "constructor",
    );

    if (isDc) {
      if (c.properties.length === 0 && c.methods.length === 0) {
        this.ctx.writeLine("pass");
      } else {
        for (const p of c.properties) {
          const pNodeId = `field:${c.name}.${p.name}`;
          this.emitLeadingTrivia(pNodeId);
          const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : ": Any";
          const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : "";
          this.ctx.writeLine(`${p.name}${typeStr}${init}`);
          this.ctx.emitTrailingTrivia(pNodeId);
        }
      }
    } else if (hasPrimaryCtor) {
      const ctorParams = [
        "self",
        ...c.primaryConstructor!.map((p) => {
          const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
          return `${p.name}: ${this.emitTypeExpr(p.typeAnnotation)}${def}`;
        }),
      ].join(", ");
      this.ctx.writeLine(`def __init__(${ctorParams}):`);
      this.ctx.indent();
      for (const p of c.primaryConstructor!) {
        this.ctx.writeLine(`self.${p.name} = ${p.name}`);
      }
      for (const p of c.properties) {
        const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : " = None";
        const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
        this.ctx.writeLine(`self.${p.name}${typeStr}${init}`);
      }
      this.ctx.dedent();
      this.ctx.writeLine();
    } else if (c.properties.length > 0 && !hasExplicitInit) {
      this.ctx.writeLine("def __init__(self):");
      this.ctx.indent();
      for (const p of c.properties) {
        const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : " = None";
        const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
        this.ctx.writeLine(`self.${p.name}${typeStr}${init}`);
      }
      this.ctx.dedent();
      this.ctx.writeLine();
    }

    if (
      !isDc &&
      c.methods.length === 0 &&
      c.properties.length === 0 &&
      !hasPrimaryCtor &&
      (!c.staticBlocks || c.staticBlocks.length === 0)
    ) {
      this.ctx.writeLine("pass");
    }

    for (let i = 0; i < c.methods.length; i++) {
      if ((isDc && c.properties.length > 0) || i > 0) {
        this.ctx.writeLine();
      }
      this.emitMethodDecl(c.methods[i], c.name);
    }

    if (c.staticBlocks && c.staticBlocks.length > 0) {
      for (const sb of c.staticBlocks) {
        this.ctx.writeLine();
        this.emitBlock(sb);
      }
    }

    for (const p of c.properties) {
      const aliases = p.aliases && p.aliases.length > 0 ? p.aliases : p.alias ? [p.alias] : [];
      for (const alias of aliases) {
        const hasExplicitMethod = c.methods.some((m) => m.name === alias);
        if (!hasExplicitMethod) {
          this.ctx.writeLine();
          this.ctx.writeLine("@property");
          this.ctx.writeLine(`def ${alias}(self):`);
          this.ctx.indent();
          this.ctx.writeLine(`return self.${p.name}`);
          this.ctx.dedent();
          if (!p.isReadonly) {
            this.ctx.writeLine(`@${alias}.setter`);
            this.ctx.writeLine(`def ${alias}(self, v):`);
            this.ctx.indent();
            this.ctx.writeLine(`self.${p.name} = v`);
            this.ctx.dedent();
          }
        }
      }
    }

    this.ctx.dedent();
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitMethodDecl(m: MethodDecl, className?: string): void {
    const methodName = m.name === "constructor" ? "__init__" : m.name;
    const mNodeId = className ? `method:${className}.${methodName}` : "";
    if (mNodeId) this.emitLeadingTrivia(mNodeId);
    if (m.isStatic) {
      this.ctx.writeLine("@staticmethod");
    }
    const paramsList: string[] = [];
    if (!m.isStatic) {
      paramsList.push("self");
    }
    for (const p of m.params) {
      const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
      const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
      paramsList.push(`${p.name}${typeStr}${def}`);
    }
    const params = paramsList.join(", ");
    const retType = m.returnType ? ` -> ${this.emitTypeExpr(m.returnType)}` : "";
    const as = m.isAsync ? "async " : "";
    this.ctx.writeLine(`${as}def ${methodName}(${params})${retType}:`);
    this.ctx.indent();
    if (mNodeId) this.emitDocstring(mNodeId);
    if (m.body.kind === "Block") {
      this.emitBlock(m.body);
    } else {
      if (m.body.kind === "AssignExpr") {
        this.ctx.writeLine(
          `${this.emitExpr(m.body.target)} ${m.body.op ?? "="} ${this.emitExpr(m.body.value)}`,
        );
      } else {
        this.ctx.writeLine(`return ${this.emitExpr(m.body)}`);
      }
    }
    this.ctx.dedent();
    if (mNodeId) this.ctx.emitTrailingTrivia(mNodeId);
  }

  private emitConstOrVarDecl(decl: ConstDecl | VarDecl): void {
    const isConst = decl.kind === "ConstDecl";
    const nodeId = `${isConst ? "const" : "var"}:${decl.name}`;
    this.emitLeadingTrivia(nodeId);

    if (
      decl.value.kind === "ClosureExpr" &&
      decl.value.body.kind === "Block" &&
      decl.value.body.statements.length > 1
    ) {
      const retType = decl.value.returnType
        ? ` -> ${this.emitTypeExpr(decl.value.returnType)}`
        : "";
      const params = decl.value.params
        .map((p) => {
          const t = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
          return `${p.name}${t}`;
        })
        .join(", ");
      this.ctx.writeLine(`def ${decl.name}(${params})${retType}:`);
      this.ctx.indent();
      this.emitBlock(decl.value.body, true);
      this.ctx.dedent();
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }
    const val = this.emitExpr(decl.value);
    if (this.pendingHoistedDefs.length > 0) {
      for (const def of this.pendingHoistedDefs) {
        this.ctx.write(def);
      }
      this.pendingHoistedDefs = [];
    }
    const typeStr = decl.typeAnnotation ? `: ${this.emitTypeExpr(decl.typeAnnotation)}` : "";
    this.ctx.writeLine(`${decl.name}${typeStr} = ${val}`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.emitLeadingTrivia(nodeId);

    if (t.aliasType) {
      const typeStr = this.emitTypeExpr(t.aliasType);
      this.ctx.writeLine(`${t.name} = ${typeStr}`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      const isDc = this.isDataclassType(t);
      if (isDc) {
        this.ctx.writeLine("@dataclass");
        this.ctx.writeLine(`class ${t.name}:`);
      } else {
        this.ctx.writeLine(`class ${t.name}(TypedDict):`);
      }
      this.ctx.indent();
      this.emitDocstring(nodeId);
      if (t.fields.length === 0) {
        this.ctx.writeLine("pass");
      } else {
        for (const f of t.fields) {
          const fNodeId = `field:${t.name}.${f.name}`;
          this.emitLeadingTrivia(fNodeId);
          const defStr = f.defaultValue ? ` = ${this.emitExpr(f.defaultValue)}` : "";
          this.ctx.writeLine(`${f.name}: ${this.emitTypeExpr(f.typeAnnotation)}${defStr}`);
          this.ctx.emitTrailingTrivia(fNodeId);
        }
      }
      this.ctx.dedent();
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    const fnNodeId = `fn:${fn.name}`;
    this.emitLeadingTrivia(fnNodeId);

    this.varTypes.clear();
    for (const p of fn.params) {
      if (p.typeAnnotation && p.typeAnnotation.kind === "NamedType") {
        this.varTypes.set(p.name, p.typeAnnotation.name);
      }
    }

    const unpackStatements: string[] = [];
    const paramsStr = fn.params
      .map((p, idx) => {
        const defStr = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        if (p.name.startsWith("[") && p.name.endsWith("]")) {
          const argName = `_arg${idx}`;
          const parts = p.name
            .slice(1, -1)
            .split(",")
            .map((s) => {
              const t = s.trim();
              return t === "" ? "_" : t;
            });
          unpackStatements.push(`${parts.join(", ")} = ${argName}`);
          const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
          return `${argName}${typeStr}${defStr}`;
        }
        if (p.name.startsWith("{") && p.name.endsWith("}")) {
          const argName = `_arg${idx}`;
          const parts = p.name
            .slice(1, -1)
            .split(",")
            .map((s) => {
              const t = s.trim();
              if (t.includes(":")) {
                const [prop, alias] = t.split(":");
                return `${alias.trim()} = ${argName}["${prop.trim()}"]`;
              }
              return `${t} = ${argName}["${t}"]`;
            });
          for (const un of parts) unpackStatements.push(un);
          const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
          return `${argName}${typeStr}${defStr}`;
        }
        const typeStr = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
        return `${p.name}${typeStr}${defStr}`;
      })
      .join(", ");

    const retStr = fn.returnType ? ` -> ${this.emitTypeExpr(fn.returnType)}` : "";
    const as = fn.isAsync ? "async " : "";

    this.ctx.writeLine(`${as}def ${fn.name}(${paramsStr})${retStr}:`);
    this.ctx.indent();
    this.emitDocstring(fnNodeId);

    for (const un of unpackStatements) {
      this.ctx.writeLine(un);
    }

    const isReturning = this.isReturningFunction(fn);
    if (fn.isExpressionBodied) {
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)}`);
    } else {
      this.emitBlock(fn.body as Block, isReturning);
    }

    this.ctx.dedent();
    this.ctx.emitTrailingTrivia(fnNodeId);
  }

  private isReturningFunction(fn: FunctionDecl): boolean {
    if (fn.name === "__top_level__") return false;
    if (fn.returnType) {
      return !(
        fn.returnType.kind === "PrimitiveType" &&
        (fn.returnType.primitive === "void" || fn.returnType.primitive === "nil")
      );
    }
    if (fn.body.kind === "Block") {
      const stmts = fn.body.statements;
      if (stmts.length > 0) {
        const last = stmts[stmts.length - 1];
        if (last.kind === "ReturnStmt") return true;
        if (last.kind === "ExprStmt") {
          return !this.isVoidExpr(last.expr);
        }
        if (last.kind === "IfStmt" && last.elseBranch) {
          return true;
        }
        if (last.kind === "MatchStmt") {
          return true;
        }
      }
    }
    return false;
  }

  private isVoidExpr(expr: Expr): boolean {
    if (expr.kind === "CallExpr" && expr.callee.kind === "IdentifierExpr") {
      return expr.callee.name === "print" || expr.callee.name === "super";
    }
    return false;
  }

  private emitBlock(block: Block, isReturning = false): void {
    if (block.statements.length === 0) {
      this.ctx.writeLine("pass");
      return;
    }
    const len = block.statements.length;
    for (let i = 0; i < len; i++) {
      const stmt = block.statements[i];
      const isLast = i === len - 1;
      this.emitStatement(stmt, isReturning && isLast);
    }
  }

  private emitStatement(stmt: Statement, isTrailingReturn = false): void {
    const flushHoisted = () => {
      if (this.pendingHoistedDefs.length > 0) {
        for (const def of this.pendingHoistedDefs) {
          this.ctx.write(def);
        }
        this.pendingHoistedDefs = [];
      }
    };

    switch (stmt.kind) {
      case "LetBinding": {
        if (
          stmt.init.kind === "ClosureExpr" &&
          stmt.init.body.kind === "Block" &&
          stmt.init.body.statements.length > 1
        ) {
          const retType = stmt.init.returnType
            ? ` -> ${this.emitTypeExpr(stmt.init.returnType)}`
            : "";
          const params = stmt.init.params
            .map((p) => {
              const t = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
              return `${p.name}${t}`;
            })
            .join(", ");
          this.ctx.writeLine(`def ${stmt.name}(${params})${retType}:`);
          this.ctx.indent();
          this.emitBlock(stmt.init.body, true);
          this.ctx.dedent();
          break;
        }
        if (stmt.typeAnnotation && stmt.typeAnnotation.kind === "NamedType") {
          this.varTypes.set(stmt.name, stmt.typeAnnotation.name);
        } else if (stmt.init.kind === "CallExpr" && stmt.init.callee.kind === "IdentifierExpr") {
          this.varTypes.set(stmt.name, stmt.init.callee.name);
        } else if (stmt.init.kind === "IdentifierExpr") {
          const existing = this.varTypes.get(stmt.init.name);
          if (existing) this.varTypes.set(stmt.name, existing);
        }
        const valStr = this.emitExpr(stmt.init);
        flushHoisted();
        const typeAnnotation = stmt.typeAnnotation
          ? `: ${this.emitTypeExpr(stmt.typeAnnotation)}`
          : "";
        this.ctx.writeLine(`${stmt.name}${typeAnnotation} = ${valStr}`);
        break;
      }
      case "DestructureBinding": {
        const valStr = this.emitExpr(stmt.init);
        flushHoisted();
        const names = stmt.names.map((n) => (n.trim() === "" ? "_" : n)).join(", ");
        this.ctx.writeLine(`${names} = ${valStr}`);
        break;
      }
      case "AssignStmt": {
        if (
          stmt.target.kind === "ArrayLiteralExpr" &&
          stmt.op &&
          stmt.op !== "=" &&
          stmt.value.kind === "ArrayLiteralExpr" &&
          stmt.value.elements.length === stmt.target.elements.length
        ) {
          for (let i = 0; i < stmt.target.elements.length; i++) {
            const targetStr = this.emitExpr(stmt.target.elements[i]);
            const valStr = this.emitExpr(stmt.value.elements[i]);
            flushHoisted();
            if (stmt.op === ">>>=") {
              this.ctx.writeLine(`${targetStr} = ((${targetStr} % 0x100000000) >> ${valStr})`);
            } else {
              this.ctx.writeLine(`${targetStr} ${stmt.op} ${valStr}`);
            }
          }
        } else if (stmt.target.kind === "ArrayLiteralExpr" && (!stmt.op || stmt.op === "=")) {
          const names = stmt.target.elements.map((e) => this.emitExpr(e)).join(", ");
          const valStr = this.emitExpr(stmt.value);
          flushHoisted();
          this.ctx.writeLine(`${names} = ${valStr}`);
        } else {
          const targetStr = this.emitExpr(stmt.target);
          const valStr = this.emitExpr(stmt.value);
          flushHoisted();
          if (stmt.op === ">>>=") {
            this.ctx.writeLine(`${targetStr} = ((${targetStr} % 0x100000000) >> ${valStr})`);
          } else {
            this.ctx.writeLine(`${targetStr} ${stmt.op ?? "="} ${valStr}`);
          }
        }
        break;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          const val = this.emitExpr(stmt.value);
          flushHoisted();
          this.ctx.writeLine(`return ${val}`);
        } else {
          this.ctx.writeLine("return");
        }
        break;
      }
      case "IfStmt": {
        this.ctx.writeLine(`if ${this.emitExpr(stmt.condition)}:`);
        this.ctx.indent();
        this.emitBlock(stmt.thenBranch, isTrailingReturn);
        this.ctx.dedent();

        for (const elif of stmt.elifBranches) {
          this.ctx.writeLine(`elif ${this.emitExpr(elif.condition)}:`);
          this.ctx.indent();
          this.emitBlock(elif.body, isTrailingReturn);
          this.ctx.dedent();
        }

        if (stmt.elseBranch) {
          this.ctx.writeLine("else:");
          this.ctx.indent();
          this.emitBlock(stmt.elseBranch, isTrailingReturn);
          this.ctx.dedent();
        }
        break;
      }
      case "ForStmt": {
        let variable = stmt.variable;
        if (variable.startsWith("[") && variable.endsWith("]")) {
          const parts = variable
            .slice(1, -1)
            .split(",")
            .map((s) => {
              const t = s.trim();
              return t === "" ? "_" : t;
            });
          variable = parts.join(", ");
        }
        this.ctx.writeLine(`for ${variable} in ${this.emitExpr(stmt.iterable)}:`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
        break;
      }
      case "WhileStmt": {
        this.ctx.writeLine(`while ${this.emitExpr(stmt.condition)}:`);
        this.ctx.indent();
        this.emitBlock(stmt.body);
        this.ctx.dedent();
        break;
      }
      case "MatchStmt": {
        this.ctx.writeLine(`match ${this.emitExpr(stmt.target)}:`);
        this.ctx.indent();
        for (const c of stmt.cases) {
          const pat = this.emitPattern(c.pattern);
          const guardStr = c.guard ? ` if ${this.emitExpr(c.guard)}` : "";
          this.ctx.writeLine(`case ${pat}${guardStr}:`);
          this.ctx.indent();
          if (c.body.kind === "Block") {
            this.emitBlock(c.body, isTrailingReturn);
          } else {
            this.ctx.writeLine(`return ${this.emitExpr(c.body)}`);
          }
          this.ctx.dedent();
        }
        this.ctx.dedent();
        break;
      }
      case "ExprStmt": {
        const val = this.emitExpr(stmt.expr);
        flushHoisted();
        if (isTrailingReturn && !this.isVoidExpr(stmt.expr)) {
          this.ctx.writeLine(`return ${val}`);
        } else {
          this.ctx.writeLine(val);
        }
        break;
      }
      case "BreakStmt": {
        flushHoisted();
        this.ctx.writeLine("break");
        break;
      }
      case "ContinueStmt": {
        flushHoisted();
        this.ctx.writeLine("continue");
        break;
      }
      case "ThrowStmt": {
        const val = this.emitExpr(stmt.expr);
        flushHoisted();
        this.ctx.writeLine(`raise ${val}`);
        break;
      }
      case "TryStmt": {
        flushHoisted();
        this.ctx.writeLine("try:");
        this.ctx.indent();
        this.emitBlock(stmt.tryBlock, isTrailingReturn);
        this.ctx.dedent();

        if (stmt.catchBlock) {
          const exc = stmt.catchParam
            ? `except Exception as ${stmt.catchParam}:`
            : "except Exception:";
          this.ctx.writeLine(exc);
          this.ctx.indent();
          this.emitBlock(stmt.catchBlock, isTrailingReturn);
          this.ctx.dedent();
        }

        if (stmt.finallyBlock) {
          this.ctx.writeLine("finally:");
          this.ctx.indent();
          this.emitBlock(stmt.finallyBlock, isTrailingReturn);
          this.ctx.dedent();
        }
        break;
      }
    }
  }

  emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr":
        if (expr.literalKind === "string") return JSON.stringify(expr.value);
        if (expr.literalKind === "boolean") return expr.value ? "True" : "False";
        if (expr.literalKind === "nil") return "None";
        return String(expr.value);

      case "TemplateLiteralExpr": {
        let result = 'f"' + this.escapePyFStringQuasi(expr.quasis[0] ?? "");
        for (let i = 0; i < expr.expressions.length; i++) {
          result +=
            "{" +
            this.emitExpr(expr.expressions[i]) +
            "}" +
            this.escapePyFStringQuasi(expr.quasis[i + 1] ?? "");
        }
        result += '"';
        return result;
      }

      case "IdentifierExpr":
        if (expr.name === "this") return "self";
        if (expr.name === "super") return "super()";
        return expr.name;

      case "AwaitExpr":
        return `await ${this.emitExpr(expr.operand)}`;

      case "AssignExpr": {
        const target = this.emitExpr(expr.target);
        const val = this.emitExpr(expr.value);
        if (!expr.op || expr.op === "=") {
          return `(${target} := ${val})`;
        }
        if (expr.op === ">>>=") {
          return `(${target} := ((${target} % 0x100000000) >> ${val}))`;
        }
        return `(${target} ${expr.op} ${val})`;
      }

      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        if (expr.operator === "instanceof") {
          return `isinstance(${left}, ${right})`;
        }
        if (expr.operator === ">>>") {
          return `((${left} % 0x100000000) >> ${right})`;
        }
        let op = expr.operator;
        if (op === "&&") op = "and";
        if (op === "||") op = "or";
        if (op === "??") return `(${left} if ${left} is not None else ${right})`;
        return `(${left} ${op} ${right})`;
      }

      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        if (expr.operator === "...") {
          return `*${operand}`;
        }
        const op = expr.operator === "!" || expr.operator === "not" ? "not " : expr.operator;
        return `(${op}${operand})`;
      }

      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

        if (expr.callee.kind === "IdentifierExpr" && expr.callee.name === "super") {
          return `super().__init__(${argCodes.join(", ")})`;
        }

        if (expr.callee.kind === "MemberAccessExpr") {
          const objCode = this.emitExpr(expr.callee.object);
          const lowered = lowerMethodCall(objCode, expr.callee.property, argCodes, "python");
          if (lowered.isLowered) {
            return lowered.code;
          }
          return `${objCode}.${expr.callee.property}(${argCodes.join(", ")})`;
        }

        // Positional Struct / Record Constructor Lowering
        if (expr.callee.kind === "IdentifierExpr") {
          const typeName = expr.callee.name;
          const fields = this.structTypes.get(typeName);
          if (fields && fields.length === expr.args.length) {
            const props = fields
              .map((fName, idx) => `${JSON.stringify(fName)}: ${argCodes[idx]}`)
              .join(", ");
            return `{${props}}`;
          }

          const enumVar = this.enumVariants.get(typeName);
          if (enumVar && enumVar.payloadCount === expr.args.length) {
            if (enumVar.payloadCount === 0) {
              return `{"kind": "${typeName}"}`;
            }
            const payloads = expr.args
              .map((a, idx) => `"item${idx}": ${this.emitExpr(a)}`)
              .join(", ");
            return `{"kind": "${typeName}", ${payloads}}`;
          }

          const lowered = lowerConstructor(expr.callee.name, argCodes, "python");
          if (lowered.isLowered) {
            return lowered.code;
          }

          const name = expr.callee.name;
          if (name === "clamp") {
            return `max(${argCodes[1]}, min(${argCodes[2]}, ${argCodes[0]}))`;
          }
          if (
            name === "floor" ||
            name === "ceil" ||
            name === "sqrt" ||
            name === "sin" ||
            name === "cos" ||
            name === "tan" ||
            name === "atan2" ||
            name === "asin" ||
            name === "acos" ||
            name === "hypot"
          ) {
            return `math.${name}(${argCodes.join(", ")})`;
          }
          if (name === "sign") {
            return `(1 if (${argCodes[0]}) > 0 else (-1 if (${argCodes[0]}) < 0 else 0))`;
          }
        }

        const callee = this.emitExpr(expr.callee);
        return `${callee}(${argCodes.join(", ")})`;
      }

      case "MemberAccessExpr": {
        const obj = this.emitExpr(expr.object);
        const lowered = lowerPropertyAccess(obj, expr.property, "python");
        if (lowered.isLowered) {
          return lowered.code;
        }
        return `${obj}.${expr.property}`;
      }

      case "IndexExpr": {
        const obj = this.emitExpr(expr.object);
        const idx = this.emitExpr(expr.index);
        return `${obj}[${idx}]`;
      }

      case "ArrayLiteralExpr": {
        const elements = expr.elements.map((e) => this.emitExpr(e)).join(", ");
        return `[${elements}]`;
      }

      case "RecordLiteralExpr": {
        const spreadProp = expr.properties.find((p) => p.isSpread);
        if (spreadProp && spreadProp.value.kind === "IdentifierExpr") {
          const targetName = spreadProp.value.name;
          const typeName = this.varTypes.get(targetName);
          const structFields = typeName ? this.structTypes.get(typeName) : undefined;
          if (structFields) {
            const overrideMap = new Map<string, Expr>();
            for (const p of expr.properties) {
              if (!p.isSpread && p.key) {
                overrideMap.set(p.key, p.value);
              }
            }
            const props = structFields.map((fName) => {
              const val = overrideMap.get(fName);
              if (val) {
                return `${JSON.stringify(fName)}: ${this.emitExpr(val)}`;
              }
              return `${JSON.stringify(fName)}: ${targetName}.${fName}`;
            });
            return `{${props.join(", ")}}`;
          }
        }

        const props = expr.properties
          .map((p) => {
            if (p.isSpread) {
              return `**${this.emitExpr(p.value)}`;
            }
            const keyOut = /^\d+(\.\d+)?$/.test(p.key ?? "") ? p.key : JSON.stringify(p.key);
            return `${keyOut}: ${this.emitExpr(p.value)}`;
          })
          .join(", ");
        return `{${props}}`;
      }

      case "PostfixTryExpr": {
        const operand = this.emitExpr(expr.operand);
        return `${operand}["value"]`;
      }

      case "ClosureExpr": {
        let innerBodyExpr: Expr | null = null;
        let isMultilineBlock = false;

        if (expr.body.kind !== "Block") {
          innerBodyExpr = expr.body as Expr;
        } else {
          const stmts = expr.body.statements;
          if (stmts.length === 0) {
            // empty lambda
          } else if (stmts.length === 1 && stmts[0].kind === "ReturnStmt") {
            innerBodyExpr = stmts[0].value ?? null;
          } else if (stmts.length === 1 && stmts[0].kind === "ExprStmt") {
            innerBodyExpr = stmts[0].expr;
          } else {
            isMultilineBlock = true;
          }
        }

        if (isMultilineBlock && expr.body.kind === "Block") {
          const fnName = `_closure_${++this.closureCount}`;
          const retType = expr.returnType ? ` -> ${this.emitTypeExpr(expr.returnType)}` : "";
          const paramsWithTypes = expr.params
            .map((p) => {
              const t = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
              return `${p.name}${t}`;
            })
            .join(", ");
          const savedBuffer = (this.ctx as any).buffer;
          (this.ctx as any).buffer = [];
          this.ctx.writeLine(`def ${fnName}(${paramsWithTypes})${retType}:`);
          this.ctx.indent();
          this.emitBlock(expr.body, true);
          this.ctx.dedent();
          const defContent = (this.ctx as any).buffer.join("");
          (this.ctx as any).buffer = savedBuffer;
          this.pendingHoistedDefs.push(defContent);
          return fnName;
        }

        const bodyStr = innerBodyExpr ? this.emitExpr(innerBodyExpr) : "None";

        const hasDestructure = expr.params.some(
          (p) => p.name.startsWith("[") || p.name.startsWith("{"),
        );
        if (!hasDestructure) {
          const params = expr.params.map((p) => p.name).join(", ");
          return `(lambda ${params}: ${bodyStr})`;
        }

        if (expr.params.length === 1 && expr.params[0].name.startsWith("[")) {
          const raw = expr.params[0].name.slice(1, -1);
          const parts = raw.split(",").map((s) => {
            const t = s.trim();
            return t === "" ? "_" : t;
          });
          const innerParams = parts.join(", ");
          return `(lambda _arg: (lambda ${innerParams}: ${bodyStr})(*_arg))`;
        }

        if (expr.params.length === 1 && expr.params[0].name.startsWith("{")) {
          const raw = expr.params[0].name.slice(1, -1);
          const parts = raw.split(",").map((s) => {
            const t = s.trim();
            if (t.includes(":")) {
              return t.split(":")[1]?.trim() ?? t;
            }
            return t;
          });
          const innerParams = parts.join(", ");
          return `(lambda _arg: (lambda ${innerParams}: ${bodyStr})(**_arg))`;
        }

        const params = expr.params
          .map((p) => {
            if (p.name.startsWith("[") && p.name.endsWith("]")) {
              const parts = p.name
                .slice(1, -1)
                .split(",")
                .map((s) => {
                  const t = s.trim();
                  return t === "" ? "_" : t;
                });
              return parts.join(", ");
            }
            if (p.name.startsWith("{") && p.name.endsWith("}")) {
              const parts = p.name
                .slice(1, -1)
                .split(",")
                .map((s) => {
                  const t = s.trim();
                  if (t.includes(":")) return t.split(":")[1]?.trim() ?? t;
                  return t;
                });
              return parts.join(", ");
            }
            return p.name;
          })
          .join(", ");
        return `(lambda ${params}: ${bodyStr})`;
      }
    }
  }

  emitTypeExpr(t?: TypeExpr | null): string {
    if (!t) return "Any";
    switch (t.kind) {
      case "PrimitiveType":
        if (t.primitive === "int" || t.primitive === "byte") return "int";
        if (t.primitive === "float" || t.primitive === "num") return "float";
        if (t.primitive === "str" || t.primitive === "char") return "str";
        if (t.primitive === "bool") return "bool";
        if (t.primitive === "void") return "None";
        if (t.primitive === "nil") return "None";
        return "Any";

      case "ArrayType":
        return `list[${this.emitTypeExpr(t.elementType)}]`;

      case "TupleType": {
        if (t.elementTypes.length === 0) return "tuple[()]";
        const elements = t.elementTypes.map((e) => this.emitTypeExpr(e)).join(", ");
        return `tuple[${elements}]`;
      }

      case "OptionType":
        return `Optional[${this.emitTypeExpr(t.innerType)}]`;

      case "ResultType":
        return `dict[str, Any]`;

      case "RecordType":
        return `dict[str, Any]`;

      case "RefinementType":
        return this.emitTypeExpr(t.baseType);

      case "NamedType": {
        let baseName = t.name;
        if (baseName === "Map" || baseName === "dict" || baseName === "Dict") baseName = "dict";
        if (baseName === "List" || baseName === "list") baseName = "list";
        if (baseName === "Set" || baseName === "set") baseName = "set";
        if (baseName === "Tuple" || baseName === "tuple") baseName = "tuple";
        if (baseName === "any") return "Any";
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((a) => this.emitTypeExpr(a)).join(", ");
          return `${baseName}[${args}]`;
        }
        return baseName;
      }
    }
  }

  private emitPattern(pat: Pattern): string {
    switch (pat.kind) {
      case "WildcardPattern":
        return "_";
      case "LiteralPattern":
        return this.emitExpr(pat.value);
      case "IdentifierPattern":
        return pat.name;
      case "ConstructorPattern": {
        const sub = pat.subPatterns.map((p) => this.emitPattern(p)).join(", ");
        return `${pat.name}(${sub})`;
      }
    }
  }

  private escapePyFStringQuasi(s: string): string {
    return s
      .replace(/"/g, '\\"')
      .replace(/\{/g, "{{")
      .replace(/\}/g, "}}")
      .replace(/\n/g, "\\n")
      .replace(/\r/g, "\\r")
      .replace(/\t/g, "\\t");
  }
}
