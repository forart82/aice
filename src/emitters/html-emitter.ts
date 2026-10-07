/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: HTML5 Forward Emitter (Pillars 1, 2, 5)
 * Compiles AIL layout AST into clean, standards-compliant HTML5 documents.
 */

import type {
  AilComponentDeclNode,
  AilDocumentNode,
  AilFileNode,
  AilLayoutNode,
  AilModuleNode,
  AilTagNode,
  AilWorkspaceNode,
} from "../core/ast.ts";
import { EmitContext, type EmitOptions } from "./context.ts";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

export class HtmlEmitter {
  public emitDocument(doc: AilDocumentNode, options?: EmitOptions): string {
    const ctx = new EmitContext("html", options);
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
    const comments = ctx.getLeadingComments(mod.nodeId);
    const commentPrefix = comments.length > 0 ? `${comments.join("\n")}\n` : "";

    const components = mod.entities.filter(
      (e): e is AilComponentDeclNode => e.kind === "ComponentDecl",
    );
    if (components.length === 0) {
      return `${commentPrefix}<!DOCTYPE html>\n<html>\n<head></head>\n<body></body>\n</html>\n`;
    }

    const htmlParts: string[] = [];
    for (const comp of components) {
      const rendered = this.emitLayout(comp.layout, ctx);
      htmlParts.push(rendered);
    }

    const out = htmlParts.join("\n\n");
    if (out.includes("<html")) {
      return `${commentPrefix}<!DOCTYPE html>\n${out}\n`;
    }
    return `${commentPrefix}${out}\n`;
  }

  public emitLayout(layout: AilLayoutNode, ctx: EmitContext): string {
    switch (layout.kind) {
      case "TagNode":
        return this.emitTag(layout, ctx);
      case "TextNode":
        if (layout.text !== undefined) return layout.text;
        if (layout.expr && layout.expr.kind === "Literal") {
          return String(layout.expr.value ?? "");
        }
        return "";
      case "ConditionalLayout":
        return this.emitLayout(layout.thenNode, ctx);
      case "LoopLayout":
        return this.emitLayout(layout.body, ctx);
    }
  }

  public emitTag(tagNode: AilTagNode, ctx: EmitContext): string {
    const tagName = tagNode.tag.toLowerCase();
    const isVoid = VOID_ELEMENTS.has(tagName);

    const attrs: string[] = [];
    for (const [key, expr] of Object.entries(tagNode.attributes)) {
      const attrName = key === "className" ? "class" : key;
      if (expr.kind === "Literal") {
        if (expr.valueType === "boolean") {
          if (expr.value === true) attrs.push(attrName);
        } else {
          attrs.push(`${attrName}="${String(expr.value)}"`);
        }
      } else if (expr.kind === "Symbol") {
        attrs.push(`${attrName}="${expr.name}"`);
      }
    }

    const attrStr = attrs.length > 0 ? ` ${attrs.join(" ")}` : "";

    if (isVoid) {
      return ctx.indentLine(`<${tagName}${attrStr}>`);
    }

    if (tagNode.children.length === 0) {
      return ctx.indentLine(`<${tagName}${attrStr}></${tagName}>`);
    }

    // Check if children are only text
    const onlyText = tagNode.children.every((c) => c.kind === "TextNode");
    if (onlyText) {
      const text = tagNode.children.map((c) => this.emitLayout(c, ctx)).join("");
      return ctx.indentLine(`<${tagName}${attrStr}>${text}</${tagName}>`);
    }

    const childLines: string[] = [];
    ctx.withIndent(() => {
      for (const child of tagNode.children) {
        childLines.push(this.emitLayout(child, ctx));
      }
    });

    return `${ctx.indentLine(`<${tagName}${attrStr}>`)}\n${childLines.join("\n")}\n${ctx.indentLine(`</${tagName}>`)}`;
  }
}

export function emitHtml(doc: AilDocumentNode, options?: EmitOptions): string {
  const emitter = new HtmlEmitter();
  return emitter.emitDocument(doc, options);
}
