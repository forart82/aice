/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern C++20 Forward Transpiler & Native Systems Emitter for AIL 2.0.
 * Emits clean, idiomatic modern C++20 code from AIL Module AST.
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

export class CppEmitter {
  private ctx: EmitterContext;
  private structTypes: Map<string, string[]> = new Map();
  private enumVariants: Map<string, { parentEnum: string }> = new Map();

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("cpp", {
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

    this.ctx.writeLine("#pragma once");
    this.ctx.writeLine();
    this.ctx.writeLine("#include <algorithm>");
    this.ctx.writeLine("#include <cmath>");
    this.ctx.writeLine("#include <cstdint>");
    this.ctx.writeLine("#include <optional>");
    this.ctx.writeLine("#include <span>");
    this.ctx.writeLine("#include <string>");
    this.ctx.writeLine("#include <vector>");
    this.ctx.writeLine();

    // Determine namespace from mod.path
    const ns = this.extractNamespace(mod.path);
    if (ns) {
      this.ctx.writeLine(`namespace ${ns} {`);
      this.ctx.writeLine();
      this.ctx.indent();
    }

    for (const item of mod.items) {
      this.emitModuleItem(item);
    }

    if (ns) {
      this.ctx.dedent();
      this.ctx.writeLine();
      this.ctx.writeLine(`} // namespace ${ns}`);
    }

    return this.ctx.getOutput();
  }

  private extractNamespace(modPath: string): string | null {
    if (!modPath || modPath === "main") return null;
    const clean = modPath.replace(/\.(cpp|hpp|h|cc)(\.ail)?$/, "").replace(/\.ail$/, "");
    const parts = clean.split(/[./\\]/);
    if (parts.length > 1) {
      parts.pop(); // remove file name
      return parts.join("::");
    }
    return null;
  }

  private emitModuleItem(item: ModuleItem): void {
    switch (item.kind) {
      case "ImportDecl":
        // Header includes are managed at top
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
        this.emitFunctionDecl(item);
        this.ctx.writeLine();
        break;
    }
  }

  private emitTypeDecl(t: TypeDecl): void {
    const nodeId = `type:${t.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    if (t.isEnum && t.variants) {
      this.ctx.writeLine(`enum class ${t.name} {`);
      this.ctx.indent();
      for (const v of t.variants) {
        this.ctx.writeLine(`${v.name},`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("};");
      this.ctx.emitTrailingTrivia(nodeId);
      return;
    }

    if (t.fields) {
      this.ctx.writeLine(`struct ${t.name} {`);
      this.ctx.indent();
      for (const f of t.fields) {
        const typeStr = this.emitTypeExpr(f.typeAnnotation);
        const defVal = this.defaultInitializerForType(f.typeAnnotation);
        this.ctx.writeLine(`${typeStr} ${f.name}${defVal};`);
      }
      this.ctx.dedent();
      this.ctx.writeLine("};");
      this.ctx.emitTrailingTrivia(nodeId);
    }
  }

  private defaultInitializerForType(t: TypeExpr): string {
    switch (t.kind) {
      case "PrimitiveType":
        if (t.primitive === "int" || t.primitive === "byte") return "{0}";
        if (t.primitive === "float") return "{0.0f}";
        if (t.primitive === "num") return "{0.0}";
        if (t.primitive === "bool") return "{false}";
        if (t.primitive === "str") return '{""}';
        return "";
      case "ArrayType":
        return "{}";
      case "OptionType":
        return "{std::nullopt}";
      default:
        return "{}";
    }
  }

  private emitClassDecl(c: ClassDecl): void {
    const nodeId = `class:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const ext = c.extends ? ` : public ${c.extends}` : "";
    this.ctx.writeLine(`class ${c.name}${ext} {`);
    this.ctx.writeLine("public:");
    this.ctx.indent();

    if (c.primaryConstructor && c.primaryConstructor.length > 0) {
      const ctorParams = c.primaryConstructor
        .map((p) => {
          const typeStr = this.emitTypeExpr(p.typeAnnotation);
          const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
          return `${typeStr} ${p.name}${def}`;
        })
        .join(", ");
      const inits = c.primaryConstructor.map((p) => `${p.name}(${p.name})`).join(", ");
      this.ctx.writeLine(`${c.name}(${ctorParams}) : ${inits} {}`);
      for (const p of c.primaryConstructor) {
        const typeStr = this.emitTypeExpr(p.typeAnnotation);
        this.ctx.writeLine(`${typeStr} ${p.name};`);
      }
    }

    // Emit methods
    for (const m of c.methods) {
      this.emitMethodDecl(m);
    }

    for (const p of c.properties) {
      const aliases = p.aliases && p.aliases.length > 0 ? p.aliases : p.alias ? [p.alias] : [];
      for (const alias of aliases) {
        const hasExplicitMethod = c.methods.some((m) => m.name === alias);
        if (!hasExplicitMethod) {
          const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "auto";
          this.ctx.writeLine(`${typeStr}& ${alias}() { return ${p.name}; }`);
          this.ctx.writeLine(`const ${typeStr}& ${alias}() const { return ${p.name}; }`);
        }
      }
    }

    this.ctx.dedent();

    if (c.properties.length > 0) {
      this.ctx.writeLine("private:");
      this.ctx.indent();
      for (const p of c.properties) {
        const typeStr = p.typeAnnotation ? this.emitTypeExpr(p.typeAnnotation) : "auto";
        const init = p.initialValue ? ` = ${this.emitExpr(p.initialValue)}` : "";
        this.ctx.writeLine(`${typeStr} ${p.name}${init};`);
      }
      this.ctx.dedent();
    }

    this.ctx.writeLine("};");
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitMethodDecl(m: MethodDecl): void {
    const retType = m.returnType ? this.emitTypeExpr(m.returnType) : "void";
    const params = m.params
      .map((p) => {
        const typeStr = this.emitTypeExpr(p.typeAnnotation);
        const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${typeStr} ${p.name}${def}`;
      })
      .join(", ");

    const isConst = m.accessor === "get" || (!m.body && retType !== "void") ? " const" : "";

    this.ctx.writeLine(`${retType} ${m.name}(${params})${isConst} {`);
    this.ctx.indent();
    if (m.body.kind === "Block") {
      this.emitBlock(m.body, retType !== "void");
    } else {
      this.ctx.writeLine(`return ${this.emitExpr(m.body)};`);
    }
    this.ctx.dedent();
    this.ctx.writeLine("}");
  }

  private emitConstDecl(c: ConstDecl): void {
    const nodeId = `const:${c.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const typeStr = c.typeAnnotation ? this.emitTypeExpr(c.typeAnnotation) : "auto";
    this.ctx.writeLine(`constexpr ${typeStr} ${c.name} = ${this.emitExpr(c.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitVarDecl(v: VarDecl): void {
    const nodeId = `var:${v.name}`;
    this.ctx.emitLeadingTrivia(nodeId);
    const typeStr = v.typeAnnotation ? this.emitTypeExpr(v.typeAnnotation) : "auto";
    this.ctx.writeLine(`${typeStr} ${v.name} = ${this.emitExpr(v.value)};`);
    this.ctx.emitTrailingTrivia(nodeId);
  }

  private emitFunctionDecl(fn: FunctionDecl): void {
    const nodeId = `fn:${fn.name}`;
    this.ctx.emitLeadingTrivia(nodeId);

    const retType = fn.returnType ? this.emitTypeExpr(fn.returnType) : "void";
    const paramsStr = fn.params
      .map((p) => {
        const typeStr = this.emitTypeExpr(p.typeAnnotation);
        const def = p.defaultValue ? ` = ${this.emitExpr(p.defaultValue)}` : "";
        return `${typeStr} ${p.name}${def}`;
      })
      .join(", ");

    this.ctx.writeLine(`${retType} ${fn.name}(${paramsStr}) {`);
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
        const typeStr = stmt.typeAnnotation
          ? this.emitTypeExpr(stmt.typeAnnotation)
          : stmt.isMut
            ? "auto"
            : "const auto";
        this.ctx.writeLine(`${typeStr} ${stmt.name} = ${this.emitExpr(stmt.init)};`);
        break;
      }
      case "DestructureBinding": {
        const qualifier = stmt.isMut ? "auto" : "const auto";
        const names = stmt.names.join(", ");
        this.ctx.writeLine(`${qualifier} [${names}] = ${this.emitExpr(stmt.init)};`);
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
            this.ctx.writeLine(`${target} ${stmt.op ?? "="} ${value};`);
          }
        } else {
          const target = this.emitExpr(stmt.target);
          const value = this.emitExpr(stmt.value);
          this.ctx.writeLine(`${target} ${stmt.op ?? "="} ${value};`);
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
        this.ctx.writeLine(`if (${cond}) {`);
        this.ctx.indent();
        const canImplicitReturn = isImplicitReturn && Boolean(stmt.elseBranch);
        this.emitBlock(stmt.thenBranch, canImplicitReturn);
        this.ctx.dedent();

        for (const elif of stmt.elifBranches) {
          this.ctx.writeLine(`} else if (${this.emitExpr(elif.condition)}) {`);
          this.ctx.indent();
          this.emitBlock(elif.body, canImplicitReturn);
          this.ctx.dedent();
        }

        if (stmt.elseBranch) {
          this.ctx.writeLine("} else {");
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
        this.ctx.writeLine(`while (${cond}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body, false);
        this.ctx.dedent();
        this.ctx.writeLine("}");
        break;
      }
      case "ForStmt": {
        const iter = this.emitExpr(stmt.iterable);
        this.ctx.writeLine(`for (const auto& ${stmt.variable} : ${iter}) {`);
        this.ctx.indent();
        this.emitBlock(stmt.body, false);
        this.ctx.dedent();
        this.ctx.writeLine("}");
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
        if (expr.literalKind === "string") return `std::string(${expr.rawValue})`;
        if (expr.literalKind === "number") {
          if (expr.rawValue.includes(".")) {
            return expr.rawValue.endsWith("f") ? expr.rawValue : `${expr.rawValue}f`;
          }
          return expr.rawValue;
        }
        if (expr.literalKind === "boolean") return expr.value ? "true" : "false";
        if (expr.literalKind === "nil") return "nullptr";
        return expr.rawValue;
      }
      case "IdentifierExpr":
        return expr.name;
      case "BinaryExpr": {
        const left = this.emitExpr(expr.left);
        const right = this.emitExpr(expr.right);
        let op: string = expr.operator;
        if (op === "and") op = "&&";
        if (op === "or") op = "||";
        return `(${left} ${op} ${right})`;
      }
      case "UnaryExpr": {
        const operand = this.emitExpr(expr.operand);
        const op = expr.operator === "not" ? "!" : expr.operator;
        return `${op}(${operand})`;
      }
      case "PostfixTryExpr": {
        const operand = this.emitExpr(expr.operand);
        return `*${operand}`;
      }
      case "CallExpr": {
        const argCodes = expr.args.map((a) => this.emitExpr(a));

        if (expr.callee.kind === "MemberAccessExpr") {
          const objCode = this.emitExpr(expr.callee.object);
          const lowered = lowerMethodCall(objCode, expr.callee.property, argCodes, "cpp");
          if (lowered.isLowered) {
            return lowered.code;
          }
          return `${objCode}.${expr.callee.property}(${argCodes.join(", ")})`;
        }

        if (expr.callee.kind === "IdentifierExpr") {
          const typeName = expr.callee.name;
          const fields = this.structTypes.get(typeName);
          if (fields && fields.length === expr.args.length) {
            return `${typeName}{ ${argCodes.join(", ")} }`;
          }
          if (typeName === "max") return `std::max(${argCodes.join(", ")})`;
          if (typeName === "min") return `std::min(${argCodes.join(", ")})`;
          if (typeName === "clamp") return `std::clamp(${argCodes.join(", ")})`;
          if (typeName === "floor") return `std::floor(${argCodes.join(", ")})`;
          if (typeName === "ceil") return `std::ceil(${argCodes.join(", ")})`;
          if (typeName === "sqrt") return `std::sqrt(${argCodes.join(", ")})`;
          if (typeName === "pow") return `std::pow(${argCodes.join(", ")})`;
          if (typeName === "round") return `std::round(${argCodes.join(", ")})`;
          if (typeName === "sin") return `std::sin(${argCodes.join(", ")})`;
          if (typeName === "cos") return `std::cos(${argCodes.join(", ")})`;
          if (typeName === "tan") return `std::tan(${argCodes.join(", ")})`;
          if (typeName === "atan2") return `std::atan2(${argCodes.join(", ")})`;
          if (typeName === "asin") return `std::asin(${argCodes.join(", ")})`;
          if (typeName === "acos") return `std::acos(${argCodes.join(", ")})`;
          if (typeName === "hypot") return `std::hypot(${argCodes.join(", ")})`;
          if (typeName === "abs") return `std::abs(${argCodes.join(", ")})`;
          if (typeName === "sign") return `((${argCodes[0]} > 0) - (${argCodes[0]} < 0))`;
        }

        const callee = this.emitExpr(expr.callee);
        return `${callee}(${argCodes.join(", ")})`;
      }
      case "MemberAccessExpr": {
        const obj = this.emitExpr(expr.object);
        const lowered = lowerPropertyAccess(obj, expr.property, "cpp");
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
        return `{ ${elements} }`;
      }
      case "RecordLiteralExpr": {
        const props = expr.properties
          .map((p) => {
            if (p.isSpread) return `/* ... */`;
            return `.${p.key} = ${this.emitExpr(p.value)}`;
          })
          .filter((s) => s.length > 0)
          .join(", ");
        return `{ ${props} }`;
      }
      case "AssignExpr": {
        const target = this.emitExpr(expr.target);
        const val = this.emitExpr(expr.value);
        return `(${target} ${expr.op ?? "="} ${val})`;
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
        if (t.primitive === "byte") return "uint8_t";
        if (t.primitive === "char") return "char";
        if (t.primitive === "str") return "std::string";
        if (t.primitive === "bool") return "bool";
        if (t.primitive === "void") return "void";
        if (t.primitive === "nil") return "nullptr_t";
        return "auto";
      case "ArrayType":
        return `std::vector<${this.emitTypeExpr(t.elementType)}>`;
      case "OptionType":
        return `std::optional<${this.emitTypeExpr(t.innerType)}>`;
      case "ResultType":
        return `std::expected<${this.emitTypeExpr(t.okType)}, ${this.emitTypeExpr(t.errType)}>`;
      case "NamedType":
        if (t.typeArgs && t.typeArgs.length > 0) {
          const args = t.typeArgs.map((ta) => this.emitTypeExpr(ta)).join(", ");
          return `${t.name}<${args}>`;
        }
        return t.name;
      case "RecordType": {
        const fields = t.fields.map((f) => `${this.emitTypeExpr(f.type)} ${f.name};`).join(" ");
        return `struct { ${fields} }`;
      }
      default:
        return "auto";
    }
  }
}
