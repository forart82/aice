/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * HTML5 Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses HTML documents/fragments using parse5, extracts comments into CstTriviaTable,
 * and lowers the DOM into an AIL ComponentDecl with LayoutNodes.
 */

import * as parse5 from "parse5";
import type { ComponentDecl, Expr, LayoutNode, Module } from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable } from "../core/trivia.js";

interface DomNode {
  nodeName: string;
  value?: string;
  data?: string;
  attrs?: { name: string; value: string }[];
  childNodes?: DomNode[];
}

export class HtmlDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();

  constructor(source: string, filePath = "page.html") {
    this.source = source;
    this.filePath = filePath;
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const isFullDoc = /<!DOCTYPE/i.test(this.source) || /<html/i.test(this.source);
    const parsed = isFullDoc ? parse5.parse(this.source) : parse5.parseFragment(this.source);

    const layoutNodes: LayoutNode[] = [];
    const childNodes =
      "childNodes" in parsed ? (parsed as unknown as { childNodes: DomNode[] }).childNodes : [];

    for (const child of childNodes) {
      const converted = this.convertDomNode(child);
      if (converted) {
        layoutNodes.push(converted);
      }
    }

    const cleanModPath = this.filePath
      .replace(/^(\.\/|\/)/, "")
      .replace(/\.html$/, "")
      .replace(/\.ail$/, "");

    // Capitalize component name
    const compName = cleanModPath.charAt(0).toUpperCase() + cleanModPath.slice(1);

    const comp: ComponentDecl = {
      kind: "ComponentDecl",
      name: compName || "Page",
      params: [],
      layout: layoutNodes,
      span: emptySpan(this.filePath),
    };

    const ast: Module = {
      kind: "Module",
      path: cleanModPath || "page",
      items: [comp],
      span: emptySpan(this.filePath),
    };

    return { ast, trivia: this.trivia };
  }

  private convertDomNode(node: DomNode): LayoutNode | null {
    if (node.nodeName === "#comment") {
      const text = node.data?.trim();
      if (text) {
        this.trivia.addLeadingTrivia("html_root", {
          kind: "BLOCK_COMMENT",
          content: `<!-- ${text} -->`,
        });
      }
      return null;
    }

    if (node.nodeName === "#text") {
      const text = node.value?.trim();
      if (!text) return null;
      return {
        kind: "LayoutNode",
        tag: "span",
        attributes: [],
        textLiteral: text,
        children: [],
        span: emptySpan(this.filePath),
      };
    }

    // Skip document type node
    if (node.nodeName === "#documentType") {
      return null;
    }

    const tag = node.nodeName.toLowerCase();
    const attributes: { name: string; value: Expr; span: Span }[] = [];

    if (node.attrs) {
      for (const attr of node.attrs) {
        attributes.push({
          name: attr.name,
          value: {
            kind: "LiteralExpr",
            literalKind: "string",
            value: attr.value,
            rawValue: JSON.stringify(attr.value),
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
      }
    }

    const children: LayoutNode[] = [];
    let textLiteral: string | null = null;

    if (node.childNodes) {
      for (const child of node.childNodes) {
        if (child.nodeName === "#text") {
          const text = child.value?.trim();
          if (text) {
            textLiteral = text;
          }
        } else if (child.nodeName !== "#comment") {
          const convertedChild = this.convertDomNode(child);
          if (convertedChild) {
            children.push(convertedChild);
          }
        }
      }
    }

    return {
      kind: "LayoutNode",
      tag,
      attributes,
      textLiteral,
      children,
      span: emptySpan(this.filePath),
    };
  }
}
