/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Python 3.12+ Forward Emitter (Pillars 1, 2, 5)
 * Compiles AIL AST into clean, idiomatic Python with type annotations and dataclasses.
 */

import type {
  AilDocumentNode,
  AilExprNode,
  AilFileNode,
  AilFunctionDeclNode,
  AilImportDeclNode,
  AilModuleNode,
  AilTypeDeclNode,
  AilTypeExprNode,
  AilWorkspaceNode,
} from "../core/ast.ts";
import { EmitContext, type EmitOptions } from "./context.ts";
import { TermRewriter } from "./rewriter.ts";

export class PythonEmitter {
  private rewriter = new TermRewriter();

  public emitDocument(doc: AilDocumentNode, options?: EmitOptions): string {
    const ctx = new EmitContext("python", { indent: "    ", ...options });
    if (doc.kind === "Workspace") {
      return this.emitWorkspace(doc, ctx);
    }
    return this.emitModule(doc, ctx);
  }

  public emitWorkspace(ws: AilWorkspaceNode, ctx: EmitContext): string {
    const parts: string[] = [];
    for (const file of ws.files) {
      parts.push(this.emitFile(file, ctx));
    }
    return parts.join("\n\n");
  }

  public emitFile(file: AilFileNode, ctx: EmitContext): string {
    return this.emitModule(file.module, ctx);
  }

  public emitModule(mod: AilModuleNode, ctx: EmitContext): string {
    const lines: string[] = [];

    const comments = ctx.getLeadingComments(mod.nodeId);
    if (comments.length > 0) {
      lines.push(...comments);
    }

    const imports = mod.entities.filter((e): e is AilImportDeclNode => e.kind === "ImportDecl");
    const types = mod.entities.filter((e): e is AilTypeDeclNode => e.kind === "TypeDecl");
    const functions = mod.entities.filter(
      (e): e is AilFunctionDeclNode => e.kind === "FunctionDecl",
    );

    const hasRecords = types.some((t) => t.typeExpr.kind === "RecordType");
    const synthImports: string[] = [];
    if (hasRecords) {
      synthImports.push("from dataclasses import dataclass");
    }
    synthImports.push("from typing import Any, Optional, Union");

    lines.push(...synthImports);

    // 1. Emit Imports
    for (const imp of imports) {
      lines.push(this.emitImport(imp, ctx));
    }

    lines.push("");

    // 2. Emit Types
    for (const t of types) {
      lines.push(this.emitTypeDecl(t, ctx));
      lines.push("");
    }

    // 3. Emit Functions
    for (const fn of functions) {
      lines.push(this.emitFunction(fn, ctx));
      lines.push("");
    }

    return `${lines.join("\n").trim()}\n`;
  }

  public emitImport(node: AilImportDeclNode, ctx: EmitContext): string {
    const lines: string[] = [];
    const comments = ctx.getLeadingComments(node.nodeId);
    lines.push(...comments);

    for (const binding of node.imports) {
      const symbols = binding.symbols.join(", ");
      lines.push(`from ${binding.modulePath} import ${symbols}`);
    }
    return lines.join("\n");
  }

  public emitTypeDecl(node: AilTypeDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    if (node.typeExpr.kind === "RecordType") {
      const fields = node.typeExpr.fields.map((f) => {
        return `    ${f.name}: ${this.emitTypeExpr(f.type)}`;
      });
      return `${commentPrefix}@dataclass\nclass ${node.name}:\n${fields.join("\n")}`;
    }

    return `${commentPrefix}${node.name} = ${this.emitTypeExpr(node.typeExpr)}`;
  }

  public emitTypeExpr(type: AilTypeExprNode): string {
    switch (type.kind) {
      case "PrimitiveType":
        switch (type.name) {
          case "!s":
            return "str";
          case "!i":
          case "!u":
            return "int";
          case "!f":
            return "float";
          case "!b":
            return "bool";
          case "!void":
          case "!nil":
            return "None";
          case "!unknown":
            return "Any";
        }
        return "Any";
      case "ArrayType":
        return `list[${this.emitTypeExpr(type.elementType)}]`;
      case "RecordType":
        return "dict[str, Any]";
      case "UnionType":
        return `Union[${type.types.map((t) => this.emitTypeExpr(t)).join(", ")}]`;
      case "NamedType": {
        if (type.name === "Option" && type.typeArguments?.[0]) {
          return `Optional[${this.emitTypeExpr(type.typeArguments[0])}]`;
        }
        if (type.name === "Result") {
          return "dict[str, Any]";
        }
        if (type.typeArguments && type.typeArguments.length > 0) {
          const args = type.typeArguments.map((a) => this.emitTypeExpr(a)).join(", ");
          return `${type.name}[${args}]`;
        }
        return type.name;
      }
      case "RefinementType":
        return `${this.emitTypeExpr(type.baseType)}  # refined`;
      case "Typestate":
        return "str";
      case "EffectType":
        return this.emitTypeExpr(type.returnType);
    }
  }

  public emitFunction(node: AilFunctionDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    const params = node.signatures.params
      .map((p) => `${p.name}: ${this.emitTypeExpr(p.type)}`)
      .join(", ");
    const retType = this.emitTypeExpr(node.signatures.returnType);

    const bodyCode = this.emitFunctionBody(node.body, ctx);
    return `${commentPrefix}def ${node.name}(${params}) -> ${retType}:\n${bodyCode}`;
  }

  private emitFunctionBody(body: AilExprNode, ctx: EmitContext): string {
    return ctx.withIndent(() => {
      if (body.kind === "BlockExpr") {
        return this.emitBlockStatements(body.expressions, true, ctx);
      }
      const exprCode = this.emitExpr(body, ctx);
      return ctx.indentLine(`return ${exprCode}`);
    });
  }

  private emitBlockStatements(
    exprs: AilExprNode[],
    isFunctionBody: boolean,
    ctx: EmitContext,
  ): string {
    const lines: string[] = [];

    for (let i = 0; i < exprs.length; i++) {
      const expr = exprs[i];
      const isLast = i === exprs.length - 1;

      if (expr.kind === "AssignExpr") {
        if (expr.expr.kind === "TryUnpackExpr") {
          const innerCode = this.emitExpr(expr.expr.expr, ctx);
          const tempVar = `__res_${i}`;
          lines.push(ctx.indentLine(`${tempVar} = ${innerCode}`));
          lines.push(ctx.indentLine(`if not ${tempVar}.get("ok"):`));
          ctx.withIndent(() => {
            lines.push(ctx.indentLine(`return ${tempVar}`));
          });
          lines.push(ctx.indentLine(`${expr.target} = ${tempVar}["value"]`));
          continue;
        }
        const valCode = this.emitExpr(expr.expr, ctx);
        lines.push(ctx.indentLine(`${expr.target} = ${valCode}`));
        continue;
      }

      if (expr.kind === "TryUnpackExpr") {
        const innerCode = this.emitExpr(expr.expr, ctx);
        const tempVar = `__res_${i}`;
        lines.push(ctx.indentLine(`${tempVar} = ${innerCode}`));
        lines.push(ctx.indentLine(`if not ${tempVar}.get("ok"):`));
        ctx.withIndent(() => {
          lines.push(ctx.indentLine(`return ${tempVar}`));
        });
        if (isLast && isFunctionBody) {
          lines.push(ctx.indentLine(`return ${tempVar}["value"]`));
        }
        continue;
      }

      const code = this.emitExpr(expr, ctx);
      if (isLast && isFunctionBody) {
        lines.push(ctx.indentLine(`return ${code}`));
      } else {
        lines.push(ctx.indentLine(code));
      }
    }

    if (lines.length === 0) {
      lines.push(ctx.indentLine("pass"));
    }

    return lines.join("\n");
  }

  public emitExpr(expr: AilExprNode, ctx: EmitContext): string {
    switch (expr.kind) {
      case "Literal":
        if (expr.valueType === "string") return JSON.stringify(expr.value);
        if (expr.valueType === "number") return String(expr.value);
        if (expr.valueType === "boolean") return expr.value ? "True" : "False";
        if (expr.valueType === "array") {
          const items = (expr.value as AilExprNode[]).map((e) => this.emitExpr(e, ctx));
          return `[${items.join(", ")}]`;
        }
        if (expr.valueType === "record") {
          const rec = expr.value as Record<string, AilExprNode>;
          const entries = Object.entries(rec).map(
            ([k, v]) => `${JSON.stringify(k)}: ${this.emitExpr(v, ctx)}`,
          );
          return `{ ${entries.join(", ")} }`;
        }
        return "None";

      case "Symbol":
        if (expr.name === "nil") return "None";
        if (expr.name === "true") return "True";
        if (expr.name === "false") return "False";
        return expr.name;

      case "ApplyExpr": {
        const emittedArgs = expr.args.map((a) => this.emitExpr(a, ctx));
        return this.rewriter.lowerApply(expr.operator, emittedArgs, expr.args, ctx);
      }

      case "AssignExpr": {
        const val = this.emitExpr(expr.expr, ctx);
        return `${expr.target} = ${val}`;
      }

      case "BlockExpr": {
        return "pass";
      }

      case "TryUnpackExpr": {
        const inner = this.emitExpr(expr.expr, ctx);
        return `${inner}["value"]`;
      }

      case "IfExpr": {
        const cond = this.emitExpr(expr.condition, ctx);
        const thenCode = this.emitExpr(expr.thenExpr, ctx);
        const elseCode = expr.elseExpr ? this.emitExpr(expr.elseExpr, ctx) : "None";
        return `(${thenCode} if ${cond} else ${elseCode})`;
      }

      case "MatchExpr": {
        const target = this.emitExpr(expr.target, ctx);
        return `match(${target})`;
      }
    }
  }
}

export function emitPython(doc: AilDocumentNode, options?: EmitOptions): string {
  const emitter = new PythonEmitter();
  return emitter.emitDocument(doc, options);
}
