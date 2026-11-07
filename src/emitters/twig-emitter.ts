/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Twig Template Emitter for AICE 2.0 (Step 25).
 * Emits clean, canonical .twig from canonical AICE AST (Module -> ComponentDecl -> LayoutNode).
 */

import type { ComponentDecl, Expr, LayoutNode, Module } from "../core/ast.js";
import { emptySpan } from "../core/span.js";
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

export class TwigEmitter {
  private ctx: EmitterContext;

  constructor(options: EmitterOptions = {}) {
    this.ctx = new EmitterContext("twig", options);
  }

  emit(mod: Module): string {
    // 1. Emit top-level leading comments if present in trivia
    if (this.ctx.trivia) {
      const rootTrivia =
        this.ctx.trivia.getTrivia("twig_root") ?? this.ctx.trivia.getTrivia("html_root");
      if (rootTrivia && rootTrivia.leading.length > 0) {
        for (const item of rootTrivia.leading) {
          const content = item.content.trim();
          if (content.startsWith("{#") || content.startsWith("<!--")) {
            this.ctx.writeLine(content);
          } else {
            this.ctx.writeLine(`{# ${content} #}`);
          }
        }
      }
    }

    // 2. Emit components
    for (const item of mod.items) {
      if (item.kind === "ComponentDecl") {
        this.emitComponent(item);
      }
    }

    return this.ctx.getOutput();
  }

  private emitComponent(comp: ComponentDecl): void {
    // Check component level trivia
    if (this.ctx.trivia) {
      const compTrivia = this.ctx.trivia.getTrivia(`component:${comp.name}`);
      if (compTrivia && compTrivia.leading.length > 0) {
        for (const item of compTrivia.leading) {
          const content = item.content.trim();
          if (content.startsWith("{#")) {
            this.ctx.writeLine(content);
          } else {
            this.ctx.writeLine(`{# ${content} #}`);
          }
        }
      }
    }

    for (const node of comp.layout) {
      this.emitLayoutNode(node);
    }
  }

  private emitLayoutNode(node: LayoutNode): void {
    const tag = node.tag.toLowerCase();

    // 1. {% extends "base.twig" %}
    if (tag === "extends") {
      const tmpl = this.getAttrString(node, ["template", "file", "path"]) ?? "base.twig";
      this.ctx.writeLine(`{% extends "${tmpl}" %}`);
      return;
    }

    // 2. {% include "nav.twig" %}
    if (tag === "include") {
      const tmpl = this.getAttrString(node, ["template", "file", "path"]) ?? "nav.twig";
      this.ctx.writeLine(`{% include "${tmpl}" %}`);
      return;
    }

    // 3. {% block name %} ... {% endblock %}
    if (tag === "block") {
      const name = this.getAttrString(node, ["name", "title"]) ?? "content";
      if (node.textLiteral !== null && node.children.length === 0 && !node.childExpr) {
        this.ctx.writeLine(`{% block ${name} %}${this.formatText(node.textLiteral)}{% endblock %}`);
        return;
      }
      if (node.childExpr && node.children.length === 0) {
        this.ctx.writeLine(
          `{% block ${name} %}{{ ${this.emitExpr(node.childExpr)} }}{% endblock %}`,
        );
        return;
      }
      this.ctx.writeLine(`{% block ${name} %}`);
      this.ctx.indent();
      for (const child of node.children) {
        this.emitLayoutNode(child);
      }
      this.ctx.dedent();
      this.ctx.writeLine(`{% endblock %}`);
      return;
    }

    // 4. {% if condition %} ... {% else %} ... {% endif %}
    if (tag === "if") {
      const cond = this.getAttrExpr(node, ["condition"]) ?? {
        kind: "IdentifierExpr",
        name: "true",
        span: emptySpan(),
      };
      this.ctx.writeLine(`{% if ${this.emitExpr(cond)} %}`);
      this.ctx.indent();
      for (const child of node.children) {
        if (child.tag.toLowerCase() === "elseif") {
          this.ctx.dedent();
          const elseifCond = this.getAttrExpr(child, ["condition"]) ?? {
            kind: "IdentifierExpr",
            name: "true",
            span: emptySpan(),
          };
          this.ctx.writeLine(`{% elseif ${this.emitExpr(elseifCond)} %}`);
          this.ctx.indent();
          for (const ec of child.children) {
            this.emitLayoutNode(ec);
          }
        } else if (child.tag.toLowerCase() === "else") {
          this.ctx.dedent();
          this.ctx.writeLine(`{% else %}`);
          this.ctx.indent();
          for (const ec of child.children) {
            this.emitLayoutNode(ec);
          }
        } else {
          this.emitLayoutNode(child);
        }
      }
      this.ctx.dedent();
      this.ctx.writeLine(`{% endif %}`);
      return;
    }

    // 5. {% for item in items %} ... {% endfor %}
    if (tag === "for") {
      const item = this.getAttrIdent(node, ["item", "var", "each"]) ?? "item";
      const key = this.getAttrIdent(node, ["key"]);
      const inExpr = this.getAttrExpr(node, ["in", "items", "iterable"]) ?? {
        kind: "IdentifierExpr",
        name: "items",
        span: emptySpan(),
      };
      const varStr = key ? `${key}, ${item}` : item;
      this.ctx.writeLine(`{% for ${varStr} in ${this.emitExpr(inExpr)} %}`);
      this.ctx.indent();
      for (const child of node.children) {
        if (child.tag.toLowerCase() === "else") {
          this.ctx.dedent();
          this.ctx.writeLine(`{% else %}`);
          this.ctx.indent();
          for (const ec of child.children) {
            this.emitLayoutNode(ec);
          }
        } else {
          this.emitLayoutNode(child);
        }
      }
      this.ctx.dedent();
      this.ctx.writeLine(`{% endfor %}`);
      return;
    }

    // 6. Standalone interpolation / expression output
    if (tag === "output" || tag === "expr") {
      if (node.childExpr) {
        this.ctx.writeLine(`{{ ${this.emitExpr(node.childExpr)} }}`);
        return;
      }
      if (node.textLiteral !== null) {
        this.ctx.writeLine(this.formatText(node.textLiteral));
        return;
      }
    }

    // 7. Normal HTML Element
    const isVoid = VOID_ELEMENTS.has(tag);
    const attrs = node.attributes
      .map((a) => {
        if (
          a.value.kind === "LiteralExpr" &&
          a.value.literalKind === "boolean" &&
          a.value.value === true
        ) {
          return a.name;
        }
        if (a.value.kind === "LiteralExpr" && a.value.literalKind === "string") {
          return `${a.name}="${this.formatAttrValue(a.value.value as string)}"`;
        }
        return `${a.name}="{{ ${this.emitExpr(a.value)} }}"`;
      })
      .join(" ");

    const attrPrefix = attrs.length > 0 ? ` ${attrs}` : "";

    if (isVoid) {
      this.ctx.writeLine(`<${tag}${attrPrefix} />`);
      return;
    }

    if (node.textLiteral !== null && node.children.length === 0 && !node.childExpr) {
      this.ctx.writeLine(`<${tag}${attrPrefix}>${this.formatText(node.textLiteral)}</${tag}>`);
      return;
    }

    if (node.childExpr && node.children.length === 0) {
      this.ctx.writeLine(`<${tag}${attrPrefix}>{{ ${this.emitExpr(node.childExpr)} }}</${tag}>`);
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

  emitExpr(expr: Expr): string {
    if (!expr) return "";

    switch (expr.kind) {
      case "LiteralExpr": {
        if (expr.literalKind === "string") {
          return JSON.stringify(expr.value);
        }
        if (expr.literalKind === "boolean") {
          return expr.value ? "true" : "false";
        }
        if (expr.literalKind === "nil") {
          return "null";
        }
        return String(expr.value);
      }
      case "IdentifierExpr":
        return expr.name;
      case "MemberAccessExpr":
        return `${this.emitExpr(expr.object)}${expr.isSafeNav ? "?." : "."}${expr.property}`;
      case "IndexExpr":
        return `${this.emitExpr(expr.object)}[${this.emitExpr(expr.index)}]`;
      case "CallExpr": {
        const calleeStr = this.emitExpr(expr.callee);
        const argsStr = expr.args.map((a) => this.emitExpr(a)).join(", ");
        return `${calleeStr}(${argsStr})`;
      }
      case "BinaryExpr": {
        if (expr.operator === "|") {
          return `${this.emitExpr(expr.left)} | ${this.emitExpr(expr.right)}`;
        }
        return `${this.emitExpr(expr.left)} ${expr.operator} ${this.emitExpr(expr.right)}`;
      }
      case "UnaryExpr": {
        const opStr = expr.operator === "not" ? "not " : expr.operator;
        return `${opStr}${this.emitExpr(expr.operand)}`;
      }
      case "ArrayLiteralExpr": {
        return `[${expr.elements.map((e) => this.emitExpr(e)).join(", ")}]`;
      }
      case "RecordLiteralExpr": {
        const props = expr.properties
          .map((p) => (p.key ? `${p.key}: ${this.emitExpr(p.value)}` : this.emitExpr(p.value)))
          .join(", ");
        return `{ ${props} }`;
      }
      case "TemplateLiteralExpr": {
        return expr.quasis.join("");
      }
      default:
        return "";
    }
  }

  private formatText(text: string): string {
    // If text was generated by AICE generator as "{expr}", format into "{{ expr }}"
    if (text.startsWith("{") && text.endsWith("}") && !text.startsWith("{{")) {
      const inner = text.slice(1, -1).trim();
      return `{{ ${inner} }}`;
    }
    // Replace embedded single braces with double braces if not already double
    return text.replace(/(?<!\{)\{([^{}\n]+)\}(?!\})/g, "{{ $1 }}");
  }

  private formatAttrValue(val: string): string {
    return val.replace(/(?<!\{)\{([^{}\n]+)\}(?!\})/g, "{{ $1 }}");
  }

  private getAttrString(node: LayoutNode, candidateNames: string[]): string | undefined {
    for (const name of candidateNames) {
      const attr = node.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (attr && attr.value.kind === "LiteralExpr" && typeof attr.value.value === "string") {
        return attr.value.value;
      }
    }
    // Fallback: first attribute if string
    if (node.attributes.length > 0) {
      const first = node.attributes[0];
      if (first.value.kind === "LiteralExpr" && typeof first.value.value === "string") {
        return first.value.value;
      }
    }
    return undefined;
  }

  private getAttrExpr(node: LayoutNode, candidateNames: string[]): Expr | undefined {
    for (const name of candidateNames) {
      const attr = node.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (attr) return attr.value;
    }
    if (node.attributes.length > 0) {
      return node.attributes[0].value;
    }
    return undefined;
  }

  private getAttrIdent(node: LayoutNode, candidateNames: string[]): string | undefined {
    for (const name of candidateNames) {
      const attr = node.attributes.find((a) => a.name.toLowerCase() === name.toLowerCase());
      if (attr) {
        if (attr.value.kind === "IdentifierExpr") return attr.value.name;
        if (attr.value.kind === "LiteralExpr" && typeof attr.value.value === "string") {
          return attr.value.value;
        }
      }
    }
    return undefined;
  }
}
