/**
 * HTML5 Document & Fragment Emitter for AIL 2.0.
 * Conforms to Pillar 1 & 2 of docs/RESEARCH_SYNTHESIS.md.
 */

import type { ComponentDecl, Expr, LayoutNode, Module } from "../core/ast.js";
import { EmitterContext, type EmitterOptions } from "./context.js";

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
  private ctx: EmitterContext;

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("html", options);
  }

  emit(mod: Module): string {
    let hasHtmlTag = false;
    for (const item of mod.items) {
      if (item.kind === "ComponentDecl") {
        for (const node of item.layout) {
          if (node.tag.toLowerCase() === "html") {
            hasHtmlTag = true;
            break;
          }
        }
      }
    }

    if (hasHtmlTag) {
      this.ctx.writeLine("<!DOCTYPE html>");
    }

    for (const item of mod.items) {
      if (item.kind === "ComponentDecl") {
        this.emitComponent(item);
      }
    }

    return this.ctx.getOutput();
  }

  private emitComponent(comp: ComponentDecl): void {
    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }
  }

  private emitLayoutNode(node: LayoutNode): void {
    const tag = node.tag.toLowerCase();
    const isVoid = VOID_ELEMENTS.has(tag);

    const attrs = node.attributes
      .map((a) => {
        const val = this.renderAttrValue(a.value);
        if (val === null) {
          return a.name;
        }
        return `${a.name}="${this.escapeHtmlAttr(val)}"`;
      })
      .join(" ");

    const attrPrefix = attrs.length > 0 ? ` ${attrs}` : "";

    if (isVoid) {
      this.ctx.writeLine(`<${tag}${attrPrefix}>`);
      return;
    }

    if (node.textLiteral !== null && node.children.length === 0) {
      this.ctx.writeLine(`<${tag}${attrPrefix}>${this.escapeHtml(node.textLiteral)}</${tag}>`);
      return;
    }

    if (node.childExpr && node.children.length === 0) {
      const rendered = this.renderAttrValue(node.childExpr);
      this.ctx.writeLine(`<${tag}${attrPrefix}>${this.escapeHtml(rendered ?? "")}</${tag}>`);
      return;
    }

    if (node.children.length === 0) {
      this.ctx.writeLine(`<${tag}${attrPrefix}></${tag}>`);
      return;
    }

    this.ctx.writeLine(`<${tag}${attrPrefix}>`);
    this.ctx.indent();
    for (const child of node.children) {
      this.emitLayoutNode(child);
    }
    this.ctx.dedent();
    this.ctx.writeLine(`</${tag}>`);
  }

  private renderAttrValue(expr: Expr): string | null {
    if (expr.kind === "LiteralExpr") {
      if (expr.literalKind === "string") {
        return expr.value as string;
      }
      if (expr.literalKind === "boolean") {
        return expr.value ? null : "";
      }
      return String(expr.value);
    }
    if (expr.kind === "IdentifierExpr") {
      return expr.name;
    }
    return "";
  }

  private escapeHtml(str: string): string {
    return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  }

  private escapeHtmlAttr(str: string): string {
    return str
      .replace(/&/g, "&amp;")
      .replace(/"/g, "&quot;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}
