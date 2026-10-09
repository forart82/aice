/**
 * TypeScript ES2022 & React 19 JSX Forward Emitter for AIL 2.0.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type {
  Block,
  ClassDecl,
  ComponentDecl,
  ConstDecl,
  Expr,
  FunctionDecl,
  ImportDecl,
  LayoutNode,
  MethodDecl,
  Module,
  ModuleItem,
  Statement,
  StyleDecl,
  TypeDecl,
  TypeExpr,
  VarDecl,
} from "../core/ast.js";
import { EmitterContext, type EmitterOptions } from "./context.js";
import { toCssProperty } from "./css-emitter.js";
import { lowerConstructor, lowerMethodCall, lowerPropertyAccess } from "./rewriter.js";

export class TypeScriptEmitter {
  private ctx: EmitterContext;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string; payloadCount: number }> = new Map();
  private varTypes: Map<string, string> = new Map();
  private classNames: Set<string> = new Set();

  private static readonly BUILTIN_CONSTRUCTORS = new Set([
    "Int32Array",
    "Float32Array",
    "Uint8Array",
    "Uint16Array",
    "Uint32Array",
    "Int8Array",
    "Int16Array",
    "Float64Array",
    "ArrayBuffer",
    "Map",
    "Set",
    "WeakMap",
    "WeakSet",
    "Date",
    "RegExp",
    "Error",
    "AudioContext",
  ]);

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext(options.target ?? "typescript", options);
  }

  emit(mod: Module): string {
    return this.emitModule(mod);
  }

  emitModule(mod: Module): string {
    this.structTypes.clear();
    this.enumVariants.clear();
    this.varTypes.clear();
    this.classNames.clear();
    for (const item of mod.items) {
      if (item.kind === "ClassDecl") {
        this.classNames.add(item.name);
      } else if (item.kind === "ImportDecl") {
        for (const spec of item.specifiers) {
          const name = spec.name;
          if (name.length > 0 && name[0] >= "A" && name[0] <= "Z") {
            this.classNames.add(name);
          }
        }
      } else if (item.kind === "TypeDecl") {
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
    for (const item of mod.items) {
      if (item.kind === "ImportDecl") {
        const importSrc = item.source;
        const candidateNames = [
          importSrc.replace(/\.[a-zA-Z]+$/, ".ail"),
          importSrc.replace(/\.[a-zA-Z]+$/, ".py.ail"),
          importSrc.replace(/\.[a-zA-Z]+$/, ".ts.ail"),
          importSrc,
        ];
        for (const cand of candidateNames) {
          const resolved = path.resolve(process.cwd(), "examples", path.basename(cand));
          if (fs.existsSync(resolved)) {
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

    // Collect all imports first
    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

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

  private emitImport(imp: ImportDecl): void {
    const nodeId = `import:${imp.source}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      this.ctx.writeLine(
        `import * as ${this.sanitizeModulePath(imp.source)} from "${imp.source}";`,
      );
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    const specs = imp.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
    this.ctx.writeLine(`import { ${specs.join(", ")} } from "${imp.source}";`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitModuleItem(item: ModuleItem): void {
    switch (item.kind) {
      case "TypeDecl":
        this.emitTypeDecl(item);
        break;
      case "FunctionDecl":
        this.emitFunctionDecl(item);
        break;
      case "ComponentDecl":
        this.emitComponentDecl(item);
        break;
      case "StyleDecl":
        this.emitStyleDecl(item);
        break;
      case "ClassDecl":
        this.emitClassDecl(item);
        break;
      case "ConstDecl":
        this.emitConstDecl(item);
        break;
      case "VarDecl":
        this.emitVarDecl(item);
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.aliasType) {
      const typeStr = this.emitTypeExpr(t.aliasType);
      this.ctx.writeLine(`export type ${t.name} = ${typeStr};`);
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.isEnum && t.variants) {
      const allUnit = t.variants.every((v) => !v.payloadTypes || v.payloadTypes.length === 0);
      if (allUnit) {
        const variantTypes = t.variants.map((v) => `"${v.name}"`);
        this.ctx.writeLine(`export type ${t.name} = ${variantTypes.join(" | ")};`);
      } else {
        const variantTypes = t.variants.map((v) => {
          if (!v.payloadTypes || v.payloadTypes.length === 0) {
            return `{ kind: "${v.name}" }`;
          }
          const payloads = v.payloadTypes.map((pt, idx) => `item${idx}: ${this.emitTypeExpr(pt)}`);
          return `{ kind: "${v.name}"; ${payloads.join("; ")} }`;
        });
        this.ctx.writeLine(`export type ${t.name} = \n  | ${variantTypes.join("\n  | ")};`);
      }
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      this.ctx.writeLine(`export interface ${t.name} {`);
      this.ctx.indent();
      for (const f of t.fields) {
        const fieldNodeId = `field:${t.name}.${f.name}`;
        this.ctx.emitLeadingTrivia(fieldNodeId);
        const optMark = f.defaultValue ? "?" : "";
        this.ctx.writeLine(`${f.name}${optMark}: ${this.emitTypeExpr(f.typeAnnotation)};`);
        this.ctx.emitTrailingTrivia(fieldNodeId);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");

      this.ctx.writeLine();
      const params = t.fields
        .map((f) => {
          const typeStr = this.emitTypeExpr(f.typeAnnotation);
          const defStr = f.defaultValue ? ` = ${this.emitExpr(f.defaultValue)}` : "";
          return `${f.name}: ${typeStr}${defStr}`;
        })
        .join(", ");
      const props = t.fields.map((f) => f.name).join(", ");
      this.ctx.writeLine(`export function ${t.name}(${params}): ${t.name} {`);
      this.ctx.indent();
      this.ctx.writeLine(props.length === 0 ? "return {};" : `return { ${props} };`);
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const exp = c.isExported ? "export " : "";
    const typeParams = c.typeParams.length > 0 ? `<${c.typeParams.join(", ")}>` : "";
    const ext = c.extends ? ` extends ${c.extends}` : "";
    const impl = c.implements && c.implements.length > 0 ? ` implements ${c.implements.join(", ")}` : "";

    this.ctx.writeLine(`${exp}class ${c.name}${typeParams}${ext}${impl} {`);
    this.ctx.indent();

    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      const hasCtor = c.methods.some((m) => m.name === "constructor");
      if (!hasCtor) {
        const ctorParams = c.primaryConstructor
          .map((p) => {
            const ro = p.isReadonly ? "readonly " : "";
            const pub = p.isPub !== false ? "public " : "";
            const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
            return `${pub}${ro}${p.name}: ${this.emitTypeExpr(p.typeAnnotation)}${def}`;
          })
          .join(", ");
        this.ctx.writeLine(`constructor(${ctorParams}) {}`);
      }
    }

    for (const p of c.properties) {
      const pNodeId = `field:${c.name}.${p.name}`;
      this.ctx.emitLeadingTrivia(pNodeId);
      const st = p.isStatic ? "static " : "";
      const ro = p.isReadonly ? "readonly " : "";
      const typeAnn = p.typeAnnotation ? `: ${this.emitTypeExpr(p.typeAnnotation)}` : "";
      const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : "";
      this.ctx.writeLine(`${st}${ro}${p.name}${typeAnn}${init};`);
      this.ctx.emitTrailingTrivia(pNodeId);
    }

    for (const m of c.methods) {
      const mNodeId = `method:${c.name}.${m.name}`;
      this.ctx.emitLeadingTrivia(mNodeId);
      const st = m.isStatic ? "static " : "";
      const as = m.isAsync ? "async " : "";
      const params = m.params
        .map((p) => {
          const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
          return `${p.name}: ${this.emitTypeExpr(p.typeAnnotation)}${def}`;
        })
        .join(", ");
      const ret = m.returnType ? `: ${this.emitTypeExpr(m.returnType)}` : "";

      if (m.accessor === "get") {
        this.ctx.writeLine(`${st}get ${m.name}()${ret} {`);
      } else if (m.accessor === "set") {
        this.ctx.writeLine(`${st}set ${m.name}(${params}) {`);
      } else {
        this.ctx.writeLine(`${st}${as}${m.name}(${params})${ret} {`);
      }
      this.ctx.indent();
      if (m.body.kind === "Block") {
        const isReturning = this.isReturningMethod(m);
        this.emitBlock(m.body, isReturning);
      } else {
        if (
          m.accessor === "set" ||
          (m.returnType &&
            m.returnType.kind === "PrimitiveType" &&
            m.returnType.primitive === "void") ||
          m.body.kind === "AssignExpr"
        ) {
          this.ctx.writeLine(`${this.emitExpr(m.body)};`);
        } else {
          this.ctx.writeLine(`return ${this.emitExpr(m.body)};`);
        }
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.emitTrailingTrivia(mNodeId);
    }

    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const exp = c.isExported ? "export " : "";
    const typeAnn = c.typeAnnotation ? `: ${this.emitTypeExpr(c.typeAnnotation)}` : "";
    this.ctx.writeLine(`${exp}const ${c.name}${typeAnn} = ${this.emitExpr(c.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const exp = v.isExported ? "export " : "";
    const kw = v.isMut ? "let" : "const";
    const typeAnn = v.typeAnnotation ? `: ${this.emitTypeExpr(v.typeAnnotation)}` : "";
    this.ctx.writeLine(`${exp}${kw} ${v.name}${typeAnn} = ${this.emitExpr(v.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    this.varTypes.clear();
    for (const p of fn.params) {
      if (p.typeAnnotation.kind === "NamedType") {
        this.varTypes.set(p.name, p.typeAnnotation.name);
      }
    }

    const nodeId = `fn:${fn.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const isExported = fn.name !== "__top_level__";
    const exportPrefix = isExported ? "export " : "";

    const paramsStr = fn.params
      .map((p) => {
        const typeStr = this.emitTypeExpr(p.typeAnnotation);
        const defStr = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${p.name}: ${typeStr}${defStr}`;
      })
      .join(", ");

    const retStr = fn.returnType ? `: ${this.emitTypeExpr(fn.returnType)}` : "";

    if (fn.isExpressionBodied) {
      this.ctx.writeLine(`${exportPrefix}function ${fn.name}(${paramsStr})${retStr} {`);
      this.ctx.indent();
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)};`);
      this.ctx.dedent();
      this.ctx.writeLine("}");
      return;
    }

    this.ctx.writeLine(`${exportPrefix}function ${fn.name}(${paramsStr})${retStr} {`);
    this.ctx.indent();
    const isReturning = this.isReturningFunction(fn);
    this.emitBlock(fn.body as Block, isReturning);
    this.ctx.dedent();
    this.ctx.writeLine("}");
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

  private isReturningMethod(m: MethodDecl): boolean {
    if (m.accessor === "set") return false;
    if (m.returnType) {
      return !(
        m.returnType.kind === "PrimitiveType" &&
        (m.returnType.primitive === "void" || m.returnType.primitive === "nil")
      );
    }
    if (m.body.kind === "Block") {
      const stmts = m.body.statements;
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
      return expr.callee.name === "print";
    }
    return false;
  }

  private emitBlock(block: Block, isReturning = false): void {
    const len = block.statements.length;
    for (let i = 0; i < len; i++) {
      const stmt = block.statements[i];
      const isLast = i === len - 1;
      this.emitStatement(stmt, isReturning && isLast);
    }
  }

  private emitStatement(stmt: Statement, isTrailingReturn = false): void {
    switch (stmt.kind) {
      case "LetBinding": {
        if (stmt.typeAnnotation && stmt.typeAnnotation.kind === "NamedType") {
          this.varTypes.set(stmt.name, stmt.typeAnnotation.name);
        } else if (stmt.init.kind === "CallExpr" && stmt.init.callee.kind === "IdentifierExpr") {
          this.varTypes.set(stmt.name, stmt.init.callee.name);
        } else if (stmt.init.kind === "IdentifierExpr") {
          const existing = this.varTypes.get(stmt.init.name);
          if (existing) this.varTypes.set(stmt.name, existing);
        }
        const keyword = stmt.isMut ? "let" : "const";
        const typeAnnotation = stmt.typeAnnotation
          ? `: ${this.emitTypeExpr(stmt.typeAnnotation)}`
          : "";
        this.ctx.writeLine(
          `${keyword} ${stmt.name}${typeAnnotation} = ${this.emitExpr(stmt.init)};`,
        );
        break;
      }
      case "AssignStmt": {
        const targetStr = this.emitExpr(stmt.target);
        const valStr = this.emitExpr(stmt.value);
        this.ctx.writeLine(`${targetStr} = ${valStr};`);
        break;
      }
      case "ReturnStmt": {
        if (stmt.value) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.value)};`);
        } else {
          this.ctx.writeLine("return;");
        }
        break;
      }
      case "IfStmt": {
        this.ctx.writeLine(`if (${this.emitExpr(stmt.condition)}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.thenBranch, isTrailingReturn);
        this.ctx.dedent();

        for (const elif of stmt.elifBranches) {
          this.ctx.writeLine(`} else if (${this.emitExpr(elif.condition)}) {`);
          this.ctx.indent();
          this.emitBlock(elif.body, isTrailingReturn);
          this.ctx.dedent();
        }

        if (stmt.elseBranch) {
          this.ctx.writeLine("} else {");
          this.ctx.indent();
          this.emitBlock(stmt.elseBranch, isTrailingReturn);
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "ForStmt": {
        this.ctx.writeLine(`for (const ${stmt.variable} of ${this.emitExpr(stmt.iterable)}) {`);
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
      case "MatchStmt": {
        // Lower match/case into if-else cascade in TypeScript
        const targetStr = this.emitExpr(stmt.target);
        for (let i = 0; i < stmt.cases.length; i++) {
          const c = stmt.cases[i];
          const isFirst = i === 0;
          const prefix = isFirst ? "if" : "} else if";

          if (c.pattern.kind === "WildcardPattern") {
            this.ctx.writeLine("} else {");
          } else {
            let cond: string;
            if (c.pattern.kind === "LiteralPattern") {
              cond = `${targetStr} === ${this.emitExpr(c.pattern.value)}`;
            } else if (c.pattern.kind === "IdentifierPattern") {
              cond = `true /* ${c.pattern.name} */`;
            } else if (c.pattern.kind === "ConstructorPattern") {
              cond = `${targetStr}.kind === "${c.pattern.name}"`;
            } else {
              cond = "true";
            }
            if (c.guard) {
              cond += ` && (${this.emitExpr(c.guard)})`;
            }
            this.ctx.writeLine(`${prefix} (${cond}) {`);
          }

          this.ctx.indent();
          if (c.body.kind === "Block") {
            this.emitBlock(c.body, isTrailingReturn);
          } else {
            this.ctx.writeLine(`return ${this.emitExpr(c.body)};`);
          }
          this.ctx.dedent();
        }
        this.ctx.writeLine("}");
        break;
      }
      case "ExprStmt": {
        if (isTrailingReturn && !this.isVoidExpr(stmt.expr)) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.expr)};`);
        } else {
          this.ctx.writeLine(`${this.emitExpr(stmt.expr)};`);
        }
        break;
      }
    }
  }

  emitExpr(expr: Expr): string {
    switch (expr.kind) {
      case "LiteralExpr":
        if (expr.literalKind === "string") return JSON.stringify(expr.value);
        if (expr.literalKind === "nil") return "null";
        return String(expr.value);

      case "IdentifierExpr":
        return expr.name;

      case "AssignExpr":
        return `${this.emitExpr(expr.target)} = ${this.emitExpr(expr.value)}`;

      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        let op: string = expr.operator;
        if (op === "==") op = "===";
        if (op === "!=") op = "!==";
        if (op === "and") op = "&&";
        if (op === "or") op = "||";
        return `(${left} ${op} ${right})`;
      }

      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        const op = expr.operator === "not" ? "!" : expr.operator;
        return `${op}(${operand})`;
      }

      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

        // Method lowering
        if (expr.callee.kind === "MemberAccessExpr") {
          const objCode = this.emitExpr(expr.callee.object);
          const lowered = lowerMethodCall(objCode, expr.callee.property, argCodes, "typescript");
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
              .map((fName, idx) => {
                const argExpr = expr.args[idx];
                if (argExpr.kind === "IdentifierExpr" && argExpr.name === fName) {
                  return fName;
                }
                return `${fName}: ${this.emitExpr(argExpr)}`;
              })
              .join(", ");
            return `{ ${props} }`;
          }

          const enumVar = this.enumVariants.get(typeName);
          if (enumVar && enumVar.payloadCount === expr.args.length) {
            if (enumVar.payloadCount === 0) {
              return `{ kind: "${typeName}" }`;
            }
            const payloads = expr.args
              .map((a, idx) => `item${idx}: ${this.emitExpr(a)}`)
              .join(", ");
            return `{ kind: "${typeName}", ${payloads} }`;
          }

          const lowered = lowerConstructor(expr.callee.name, argCodes, "typescript");
          if (lowered.isLowered) {
            return lowered.code;
          }

          if (expr.callee.name === "typeof" && expr.args.length === 1) {
            return `typeof (${argCodes[0]})`;
          }

          if (this.classNames.has(expr.callee.name) || TypeScriptEmitter.BUILTIN_CONSTRUCTORS.has(expr.callee.name)) {
            return `new ${expr.callee.name}(${argCodes.join(", ")})`;
          }
        }

        const callee = this.emitExpr(expr.callee);
        return `${callee}(${argCodes.join(", ")})`;
      }

      case "MemberAccessExpr": {
        const obj = this.emitExpr(expr.object);
        const lowered = lowerPropertyAccess(obj, expr.property, "typescript");
        if (lowered.isLowered) {
          return lowered.code;
        }
        const op = expr.isSafeNav ? "?." : ".";
        return `${obj}${op}${expr.property}`;
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
        if (expr.properties.length === 0) return "{}";

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
                if (val.kind === "IdentifierExpr" && val.name === fName) {
                  return fName;
                }
                return `${fName}: ${this.emitExpr(val)}`;
              }
              return `${fName}: ${targetName}.${fName}`;
            });
            return `{ ${props.join(", ")} }`;
          }
        }

        const props = expr.properties
          .map((p) => {
            if (p.isSpread) {
              return `...${this.emitExpr(p.value)}`;
            }
            if (p.value.kind === "IdentifierExpr" && p.value.name === p.key) {
              return p.key;
            }
            return `${p.key}: ${this.emitExpr(p.value)}`;
          })
          .join(", ");
        return `{ ${props} }`;
      }

      case "PostfixTryExpr": {
        // Desugar expr? into an unwrapped expression
        const operand = this.emitExpr(expr.operand);
        return `(${operand} as any).value`;
      }

      case "ClosureExpr": {
        const paramsStr = expr.params
          .map((p) => `${p.name}: ${this.emitTypeExpr(p.typeAnnotation)}`)
          .join(", ");
        const retStr = expr.returnType ? `: ${this.emitTypeExpr(expr.returnType)}` : "";
        if (expr.body.kind === "Block") {
          let blockStr = "{\n";
          this.ctx.indent();
          for (const s of expr.body.statements) {
            const stmtStr =
              s.kind === "ExprStmt"
                ? this.emitExpr(s.expr)
                : s.kind === "ReturnStmt" && s.value
                  ? `return ${this.emitExpr(s.value)}`
                  : "";
            if (stmtStr) {
              blockStr += `${this.ctx.getIndent()}${stmtStr};\n`;
            }
          }
          this.ctx.dedent();
          blockStr += `${this.ctx.getIndent()}}`;
          return `(${paramsStr})${retStr} => ${blockStr}`;
        }
        return `(${paramsStr})${retStr} => ${this.emitExpr(expr.body)}`;
      }
    }
  }

  emitTypeExpr(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        if (
          t.primitive === "int" ||
          t.primitive === "float" ||
          t.primitive === "num" ||
          t.primitive === "byte"
        ) {
          return "number";
        }
        if (t.primitive === "str" || t.primitive === "char") return "string";
        if (t.primitive === "bool") return "boolean";
        if (t.primitive === "void") return "void";
        if (t.primitive === "nil") return "null";
        return "unknown";

      case "ArrayType":
        return `${this.emitTypeExpr(t.elementType)}[]`;

      case "OptionType":
        return `${this.emitTypeExpr(t.innerType)} | null`;

      case "ResultType":
        return `{ ok: true; value: ${this.emitTypeExpr(t.okType)} } | { ok: false; error: ${this.emitTypeExpr(t.errType)} }`;

      case "RecordType": {
        const fields = t.fields.map((f) => `${f.name}: ${this.emitTypeExpr(f.type)};`).join(" ");
        return `{ ${fields} }`;
      }

      case "RefinementType":
        return `${this.emitTypeExpr(t.baseType)} /* Refined: ${t.param} */`;

      case "NamedType": {
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.emitTypeExpr(ta)).join(", ");
          return `${t.name}<${args}>`;
        }
        return t.name;
      }
    }
  }

  // React 19 TSX Declarative Component Emitter
  private emitComponentDecl(comp: ComponentDecl): void {
    const nodeId = `component:${comp.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (comp.params.length > 0) {
      const propsInterface = `${comp.name}Props`;
      this.ctx.writeLine(`export interface ${propsInterface} {`);
      this.ctx.indent();
      for (const p of comp.params) {
        this.ctx.writeLine(`${p.name}: ${this.emitTypeExpr(p.typeAnnotation)};`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("}");
      this.ctx.writeLine();

      this.ctx.writeLine(
        `export function ${comp.name}({ ${comp.params.map((p) => p.name).join(", ")} }: ${propsInterface}) {`,
      );
    } else {
      this.ctx.writeLine(`export function ${comp.name}() {`);
    }
    this.ctx.indent();
    this.ctx.writeLine("return (");
    this.ctx.indent();

    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }

    this.ctx.dedent();
    this.ctx.writeLine(");");
    this.ctx.dedent();
    this.ctx.writeLine("}");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitLayoutNode(node: LayoutNode): void {
    const attrs = node.attributes
      .map((a) => {
        const name = a.name === "class" ? "className" : a.name;
        if (a.value.kind === "LiteralExpr" && a.value.literalKind === "string") {
          return `${name}=${JSON.stringify(a.value.value)}`;
        }
        return `${name}={${this.emitExpr(a.value)}}`;
      })
      .join(" ");

    const attrStr = attrs.length > 0 ? ` ${attrs}` : "";

    if (node.textLiteral !== null && node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr}>${node.textLiteral}</${node.tag}>`);
      return;
    }

    if (node.childExpr && node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr}>{${this.emitExpr(node.childExpr)}}</${node.tag}>`);
      return;
    }

    if (node.children.length === 0) {
      this.ctx.writeLine(`<${node.tag}${attrStr} />`);
      return;
    }

    this.ctx.writeLine(`<${node.tag}${attrStr}>`);
    this.ctx.indent();
    for (const child of node.children) {
      this.emitLayoutNode(child);
    }
    this.ctx.dedent();
    this.ctx.writeLine(`</${node.tag}>`);
  }

  private emitStyleDecl(s: StyleDecl): void {
    this.ctx.writeLine(`export const ${s.name} = {`);
    this.ctx.indent();
    for (const p of s.properties) {
      const prop = toCssProperty(p.property);
      this.ctx.writeLine(`${JSON.stringify(prop)}: ${JSON.stringify(p.value)},`);
    }
    this.ctx.dedent();
    this.ctx.writeLine("} as const;");
  }

  private sanitizeModulePath(p: string): string {
    return p.replace(/[^a-zA-Z0-9_]/g, "_");
  }
}
