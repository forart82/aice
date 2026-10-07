/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: TypeScript & TSX Forward Emitter (Pillars 1, 2, 5)
 * Compiles AIL AST to strict ES2022 / NodeNext TypeScript & React TSX.
 */

import type {
  AilComponentDeclNode,
  AilDocumentNode,
  AilExprNode,
  AilFileNode,
  AilFunctionDeclNode,
  AilImportDeclNode,
  AilLayoutNode,
  AilModuleNode,
  AilStyleDeclNode,
  AilTypeDeclNode,
  AilTypeExprNode,
  AilWorkspaceNode,
} from "../core/ast.ts";
import { EmitContext, type EmitOptions } from "./context.ts";
import { TermRewriter } from "./rewriter.ts";

export class TypeScriptEmitter {
  private rewriter = new TermRewriter();

  public emitDocument(doc: AilDocumentNode, options?: EmitOptions): string {
    const ctx = new EmitContext("typescript", options);
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

    // Module comments from trivia
    const comments = ctx.getLeadingComments(mod.nodeId);
    if (comments.length > 0) {
      lines.push(...comments);
    }

    // Check if module uses Result or Option
    const usesResult = this.scanUsesResult(mod);
    const usesOption = this.scanUsesOption(mod);

    // Group entities
    const imports = mod.entities.filter((e): e is AilImportDeclNode => e.kind === "ImportDecl");
    const types = mod.entities.filter((e): e is AilTypeDeclNode => e.kind === "TypeDecl");
    const styles = mod.entities.filter((e): e is AilStyleDeclNode => e.kind === "StyleDecl");
    const functions = mod.entities.filter(
      (e): e is AilFunctionDeclNode => e.kind === "FunctionDecl",
    );
    const components = mod.entities.filter(
      (e): e is AilComponentDeclNode => e.kind === "ComponentDecl",
    );

    // 1. Emit Imports
    for (const imp of imports) {
      lines.push(this.emitImport(imp, ctx));
    }

    if (imports.length > 0 && (types.length > 0 || functions.length > 0 || components.length > 0)) {
      lines.push("");
    }

    // 2. Synthesize Result / Option if used and not declared
    if (usesResult && !types.some((t) => t.name === "Result")) {
      lines.push("export type Result<T, E> = { ok: true; value: T } | { ok: false; error: E };");
    }
    if (usesOption && !types.some((t) => t.name === "Option")) {
      lines.push("export type Option<T> = { ok: true; value: T } | { ok: false };");
    }
    if ((usesResult || usesOption) && (types.length > 0 || functions.length > 0)) {
      lines.push("");
    }

    // 3. Emit Types
    for (const t of types) {
      lines.push(this.emitTypeDecl(t, ctx));
      lines.push("");
    }

    // 4. Emit Styles
    for (const s of styles) {
      lines.push(this.emitStyleDecl(s, ctx));
      lines.push("");
    }

    // 5. Emit Functions
    for (const fn of functions) {
      lines.push(this.emitFunction(fn, ctx));
      lines.push("");
    }

    // 6. Emit Components
    for (const comp of components) {
      lines.push(this.emitComponent(comp, ctx));
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
      lines.push(`import { ${symbols} } from "${binding.modulePath}";`);
    }
    return lines.join("\n");
  }

  public emitTypeDecl(node: AilTypeDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    if (node.typeExpr.kind === "RecordType") {
      const fields = node.typeExpr.fields.map((f) => {
        const opt = f.optional ? "?" : "";
        return `  ${f.name}${opt}: ${this.emitTypeExpr(f.type)};`;
      });
      return `${commentPrefix}export interface ${node.name} {\n${fields.join("\n")}\n}`;
    }

    return `${commentPrefix}export type ${node.name} = ${this.emitTypeExpr(node.typeExpr)};`;
  }

  public emitTypeExpr(type: AilTypeExprNode): string {
    switch (type.kind) {
      case "PrimitiveType":
        switch (type.name) {
          case "!s":
            return "string";
          case "!i":
          case "!u":
          case "!f":
            return "number";
          case "!b":
            return "boolean";
          case "!void":
            return "void";
          case "!unknown":
            return "unknown";
          case "!nil":
            return "null";
        }
        return "unknown";
      case "ArrayType":
        return `${this.emitTypeExpr(type.elementType)}[]`;
      case "RecordType": {
        const fields = type.fields.map((f) => {
          const opt = f.optional ? "?" : "";
          return `${f.name}${opt}: ${this.emitTypeExpr(f.type)}`;
        });
        return `{ ${fields.join("; ")} }`;
      }
      case "UnionType":
        return type.types.map((t) => this.emitTypeExpr(t)).join(" | ");
      case "NamedType": {
        if (type.typeArguments && type.typeArguments.length > 0) {
          const args = type.typeArguments.map((a) => this.emitTypeExpr(a)).join(", ");
          return `${type.name}<${args}>`;
        }
        return type.name;
      }
      case "RefinementType":
        return `${this.emitTypeExpr(type.baseType)} /* refined */`;
      case "Typestate":
        return type.states.map((s) => JSON.stringify(s)).join(" | ");
      case "EffectType":
        return this.emitTypeExpr(type.returnType);
    }
  }

  public emitStyleDecl(node: AilStyleDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";
    const rules = node.rules.map((r) => `  ${JSON.stringify(r.prop)}: ${JSON.stringify(r.value)},`);
    return `${commentPrefix}export const ${node.name} = {\n${rules.join("\n")}\n} as const;`;
  }

  public emitFunction(node: AilFunctionDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    const params = node.signatures.params
      .map((p) => `${p.name}: ${this.emitTypeExpr(p.type)}`)
      .join(", ");
    const retType = this.emitTypeExpr(node.signatures.returnType);

    const bodyCode = this.emitFunctionBody(node.body, ctx);
    return `${commentPrefix}export function ${node.name}(${params}): ${retType} {\n${bodyCode}\n}`;
  }

  private emitFunctionBody(body: AilExprNode, ctx: EmitContext): string {
    return ctx.withIndent(() => {
      // If block expression (do ...), emit statements
      if (body.kind === "BlockExpr") {
        return this.emitBlockStatements(body.expressions, true, ctx);
      }

      // If single expression, return it
      const exprCode = this.emitExpr(body, ctx);
      return ctx.indentLine(`return ${exprCode};`);
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

      // Handle TryUnpack in statement position or inside assignment: (:= var (? call))
      if (expr.kind === "AssignExpr") {
        if (expr.expr.kind === "TryUnpackExpr") {
          const innerCode = this.emitExpr(expr.expr.expr, ctx);
          const tempVar = `__res_${i}`;
          lines.push(ctx.indentLine(`const ${tempVar} = ${innerCode};`));
          lines.push(ctx.indentLine(`if (!${tempVar}.ok) return ${tempVar};`));
          lines.push(ctx.indentLine(`const ${expr.target} = ${tempVar}.value;`));
          continue;
        }
        const valCode = this.emitExpr(expr.expr, ctx);
        lines.push(ctx.indentLine(`const ${expr.target} = ${valCode};`));
        continue;
      }

      if (expr.kind === "TryUnpackExpr") {
        const innerCode = this.emitExpr(expr.expr, ctx);
        const tempVar = `__res_${i}`;
        lines.push(ctx.indentLine(`const ${tempVar} = ${innerCode};`));
        lines.push(ctx.indentLine(`if (!${tempVar}.ok) return ${tempVar};`));
        if (isLast && isFunctionBody) {
          lines.push(ctx.indentLine(`return ${tempVar}.value;`));
        }
        continue;
      }

      const code = this.emitExpr(expr, ctx);
      if (isLast && isFunctionBody) {
        lines.push(ctx.indentLine(`return ${code};`));
      } else {
        lines.push(ctx.indentLine(`${code};`));
      }
    }

    return lines.join("\n");
  }

  public emitExpr(expr: AilExprNode, ctx: EmitContext): string {
    switch (expr.kind) {
      case "Literal":
        if (expr.valueType === "string") return JSON.stringify(expr.value);
        if (expr.valueType === "number") return String(expr.value);
        if (expr.valueType === "boolean") return expr.value ? "true" : "false";
        if (expr.valueType === "array") {
          const items = (expr.value as AilExprNode[]).map((e) => this.emitExpr(e, ctx));
          return `[${items.join(", ")}]`;
        }
        if (expr.valueType === "record") {
          const rec = expr.value as Record<string, AilExprNode>;
          const entries = Object.entries(rec).map(([k, v]) => `${k}: ${this.emitExpr(v, ctx)}`);
          return `{ ${entries.join(", ")} }`;
        }
        return "undefined";

      case "Symbol":
        if (expr.name === "nil") return "null";
        return expr.name;

      case "ApplyExpr": {
        const emittedArgs = expr.args.map((a) => this.emitExpr(a, ctx));
        return this.rewriter.lowerApply(expr.operator, emittedArgs, expr.args, ctx);
      }

      case "AssignExpr": {
        const val = this.emitExpr(expr.expr, ctx);
        return `const ${expr.target} = ${val}`;
      }

      case "BlockExpr": {
        // As inline expression, wrap in IIFE
        return `(() => {\n${this.emitBlockStatements(expr.expressions, true, ctx)}\n${ctx.indent}})()`;
      }

      case "TryUnpackExpr": {
        const inner = this.emitExpr(expr.expr, ctx);
        return `(() => { const _r = ${inner}; if (!_r.ok) return _r; return _r.value; })()`;
      }

      case "IfExpr": {
        const cond = this.emitExpr(expr.condition, ctx);
        const thenCode = this.emitExpr(expr.thenExpr, ctx);
        const elseCode = expr.elseExpr ? this.emitExpr(expr.elseExpr, ctx) : "undefined";
        return `(${cond} ? ${thenCode} : ${elseCode})`;
      }

      case "MatchExpr": {
        const target = this.emitExpr(expr.target, ctx);
        const caseLines = expr.cases.map(
          (c) =>
            `if (_target === ${this.emitExpr(c.pattern, ctx)}) return ${this.emitExpr(c.expr, ctx)};`,
        );
        return `((_target) => {\n${caseLines.map((l) => `  ${l}`).join("\n")}\n  throw new Error("Match failure");\n})(${target})`;
      }
    }
  }

  public emitComponent(node: AilComponentDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    const propsTypeName = `${node.name}Props`;
    let propsDecl = "";
    if (node.propContract) {
      propsDecl = `${this.emitTypeDecl(
        {
          kind: "TypeDecl",
          nodeId: `${node.nodeId}_props`,
          name: propsTypeName,
          typeExpr: node.propContract,
        },
        ctx,
      )}\n\n`;
    }

    const param = node.propContract
      ? `{ ${node.propContract.fields.map((f) => f.name).join(", ")} }: ${propsTypeName}`
      : "";
    const layoutCode = ctx.withIndent(() => ctx.indentLine(this.emitLayout(node.layout, ctx)));

    return `${commentPrefix}${propsDecl}export function ${node.name}(${param}) {\n${ctx.indentUnit}return (\n${layoutCode}\n${ctx.indentUnit});\n}`;
  }

  public emitLayout(layout: AilLayoutNode, ctx: EmitContext): string {
    switch (layout.kind) {
      case "TagNode": {
        const attrs: string[] = [];
        for (const [key, val] of Object.entries(layout.attributes)) {
          const propName = key === "class" ? "className" : key;
          if (val.kind === "Literal" && val.valueType === "string") {
            attrs.push(`${propName}=${JSON.stringify(val.value)}`);
          } else {
            attrs.push(`${propName}={${this.emitExpr(val, ctx)}}`);
          }
        }
        const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";

        if (layout.children.length === 0) {
          return `<${layout.tag}${attrStr} />`;
        }

        const childCode = layout.children.map((c) => this.emitLayout(c, ctx)).join("");
        return `<${layout.tag}${attrStr}>${childCode}</${layout.tag}>`;
      }

      case "TextNode": {
        if (layout.text !== undefined) return layout.text;
        if (layout.expr) return `{${this.emitExpr(layout.expr, ctx)}}`;
        return "";
      }

      case "ConditionalLayout": {
        const cond = this.emitExpr(layout.condition, ctx);
        const thenCode = this.emitLayout(layout.thenNode, ctx);
        const elseCode = layout.elseNode ? this.emitLayout(layout.elseNode, ctx) : "null";
        return `{${cond} ? (${thenCode}) : (${elseCode})}`;
      }

      case "LoopLayout": {
        const iter = this.emitExpr(layout.iterable, ctx);
        const body = this.emitLayout(layout.body, ctx);
        return `{${iter}.map((${layout.itemSymbol}) => (${body}))}`;
      }
    }
  }

  private scanUsesResult(node: AilModuleNode): boolean {
    const json = JSON.stringify(node);
    return json.includes('"Result"');
  }

  private scanUsesOption(node: AilModuleNode): boolean {
    const json = JSON.stringify(node);
    return json.includes('"Option"');
  }
}

export function emitTypeScript(doc: AilDocumentNode, options?: EmitOptions): string {
  const emitter = new TypeScriptEmitter();
  return emitter.emitDocument(doc, options);
}
