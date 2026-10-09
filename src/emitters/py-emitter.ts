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
import { EmitterContext, type EmitterOptions } from "./context.js";
import { lowerConstructor, lowerMethodCall, lowerPropertyAccess } from "./rewriter.js";

export class PythonEmitter {
  private ctx: EmitterContext;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string; payloadCount: number }> = new Map();
  private varTypes: Map<string, string> = new Map();

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("python", {
      ...options,
      indent: options.indent ?? "    ", // standard 4 spaces for Python
    });
  }

  emit(mod: Module): string {
    return this.emitModule(mod);
  }

  emitModule(mod: Module): string {
    this.structTypes.clear();
    this.enumVariants.clear();
    this.varTypes.clear();
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

    const imports = mod.items.filter((i) => i.kind === "ImportDecl") as ImportDecl[];
    const nonImports = mod.items.filter((i) => i.kind !== "ImportDecl");

    this.ctx.writeLine("from typing import Any, Optional, Union, TypedDict");
    this.ctx.writeLine();

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
    if (out.includes("math.")) {
      out = out.replace(
        "from typing import Any, Optional, Union, TypedDict\n",
        "from typing import Any, Optional, Union, TypedDict\nimport math\n",
      );
    }
    return out;
  }

  private emitImport(imp: ImportDecl): void {
    const modName = imp.source.replace(/\.[a-zA-Z]+$/, "").replace(/^\.\//, "");
    if (imp.specifiers.length === 1 && imp.specifiers[0].isWildcard) {
      this.ctx.writeLine(`from ${modName} import *`);
      return;
    }
    const specs = imp.specifiers.map((s) => (s.alias ? `${s.name} as ${s.alias}` : s.name));
    this.ctx.writeLine(`from ${modName} import ${specs.join(", ")}`);
  }

  private emitModuleItem(item: ModuleItem): void {
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
    const ext = c.extends ? `(${c.extends})` : "";
    this.ctx.writeLine(`class ${c.name}${ext}:`);
    this.ctx.indent();

    const hasPrimaryCtor = !!(c.primaryConstructor && c.primaryConstructor.length > 0);

    if (hasPrimaryCtor) {
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
    } else if (c.properties.length > 0) {
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

    if (c.methods.length === 0 && c.properties.length === 0 && !hasPrimaryCtor) {
      this.ctx.writeLine("pass");
    }

    for (let i = 0; i < c.methods.length; i++) {
      this.emitMethodDecl(c.methods[i]);
      if (i < c.methods.length - 1) {
        this.ctx.writeLine();
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
  }

  private emitMethodDecl(m: MethodDecl): void {
    const methodName = m.name === "constructor" ? "__init__" : m.name;
    const params = [
      "self",
      ...m.params.map((p) => {
        const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${p.name}: ${this.emitTypeExpr(p.typeAnnotation)}${def}`;
      }),
    ].join(", ");
    const retType = m.returnType ? ` -> ${this.emitTypeExpr(m.returnType)}` : " -> None";
    this.ctx.writeLine(`def ${methodName}(${params})${retType}:`);
    this.ctx.indent();
    if (m.body.kind === "Block") {
      this.emitBlock(m.body);
    } else {
      this.ctx.writeLine(`return ${this.emitExpr(m.body)}`);
    }
    this.ctx.dedent();
  }

  private emitConstOrVarDecl(decl: ConstDecl | VarDecl): void {
    const typeStr = decl.typeAnnotation ? `: ${this.emitTypeExpr(decl.typeAnnotation)}` : "";
    this.ctx.writeLine(`${decl.name}${typeStr} = ${this.emitExpr(decl.value)}`);
  }

  private emitTypeDecl(t: TypeDecl): void {
    if (t.aliasType) {
      const typeStr = this.emitTypeExpr(t.aliasType);
      this.ctx.writeLine(`${t.name} = ${typeStr}`);
      return;
    }

    if (t.fields) {
      this.ctx.writeLine(`class ${t.name}(TypedDict):`);
      this.ctx.indent();
      if (t.fields.length === 0) {
        this.ctx.writeLine("pass");
      } else {
        for (const f of t.fields) {
          const defStr = f.defaultValue ? ` = ${this.emitExpr(f.defaultValue)}` : "";
          this.ctx.writeLine(`${f.name}: ${this.emitTypeExpr(f.typeAnnotation)}${defStr}`);
        }
      }
      this.ctx.dedent();
    }
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    this.varTypes.clear();
    for (const p of fn.params) {
      if (p.typeAnnotation.kind === "NamedType") {
        this.varTypes.set(p.name, p.typeAnnotation.name);
      }
    }

    const paramsStr = fn.params
      .map((p) => {
        const typeStr = this.emitTypeExpr(p.typeAnnotation);
        const defStr = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${p.name}: ${typeStr}${defStr}`;
      })
      .join(", ");

    const retStr = fn.returnType ? ` -> ${this.emitTypeExpr(fn.returnType)}` : "";

    this.ctx.writeLine(`def ${fn.name}(${paramsStr})${retStr}:`);
    this.ctx.indent();

    const isReturning = this.isReturningFunction(fn);
    if (fn.isExpressionBodied) {
      this.ctx.writeLine(`return ${this.emitExpr(fn.body as Expr)}`);
    } else {
      this.emitBlock(fn.body as Block, isReturning);
    }

    this.ctx.dedent();
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
      return expr.callee.name === "print";
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
        const typeAnnotation = stmt.typeAnnotation
          ? `: ${this.emitTypeExpr(stmt.typeAnnotation)}`
          : "";
        this.ctx.writeLine(`${stmt.name}${typeAnnotation} = ${this.emitExpr(stmt.init)}`);
        break;
      }
      case "DestructureBinding": {
        const names = stmt.names.join(", ");
        this.ctx.writeLine(`${names} = ${this.emitExpr(stmt.init)}`);
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
            this.ctx.writeLine(`${targetStr} ${stmt.op} ${valStr}`);
          }
        } else if (stmt.target.kind === "ArrayLiteralExpr" && (!stmt.op || stmt.op === "=")) {
          const names = stmt.target.elements.map((e) => this.emitExpr(e)).join(", ");
          const valStr = this.emitExpr(stmt.value);
          this.ctx.writeLine(`${names} = ${valStr}`);
        } else {
          const targetStr = this.emitExpr(stmt.target);
          const valStr = this.emitExpr(stmt.value);
          this.ctx.writeLine(`${targetStr} ${stmt.op ?? "="} ${valStr}`);
        }
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
        this.ctx.writeLine(`for ${stmt.variable} in ${this.emitExpr(stmt.iterable)}:`);
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
        if (isTrailingReturn && !this.isVoidExpr(stmt.expr)) {
          this.ctx.writeLine(`return ${this.emitExpr(stmt.expr)}`);
        } else {
          this.ctx.writeLine(this.emitExpr(stmt.expr));
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

      case "IdentifierExpr":
        if (expr.name === "this") return "self";
        return expr.name;

      case "AssignExpr":
        return `${this.emitExpr(expr.target)} ${expr.op ?? "="} ${this.emitExpr(expr.value)}`;

      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        let op = expr.operator;
        if (op === "&&") op = "and";
        if (op === "||") op = "or";
        if (op === "??") return `(${left} if ${left} is not None else ${right})`;
        return `(${left} ${op} ${right})`;
      }

      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        const op = expr.operator === "!" || expr.operator === "not" ? "not " : expr.operator;
        return `(${op}${operand})`;
      }

      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

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
            return `${JSON.stringify(p.key)}: ${this.emitExpr(p.value)}`;
          })
          .join(", ");
        return `{${props}}`;
      }

      case "PostfixTryExpr": {
        const operand = this.emitExpr(expr.operand);
        return `${operand}["value"]`;
      }

      case "ClosureExpr": {
        const params = expr.params.map((p) => p.name).join(", ");
        return `(lambda ${params}: ${this.emitExpr(expr.body as Expr)})`;
      }
    }
  }

  emitTypeExpr(t: TypeExpr): string {
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

      case "OptionType":
        return `Optional[${this.emitTypeExpr(t.innerType)}]`;

      case "ResultType":
        return `dict[str, Any]`;

      case "RecordType":
        return `dict[str, Any]`;

      case "RefinementType":
        return this.emitTypeExpr(t.baseType);

      case "NamedType":
        return t.name;
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
}
