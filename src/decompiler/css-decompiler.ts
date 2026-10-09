/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CSS Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses CSS styles using PostCSS, extracts comments into CstTriviaTable,
 * and generates an AIL Module AST containing StyleDecl rules.
 */

import postcss from "postcss";
import type { Module, StyleDecl, StyleProperty } from "../core/ast.js";
import { emptySpan } from "../core/span.js";
import { CstTriviaTable } from "../core/trivia.js";

export class CssDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();

  constructor(source: string, filePath = "style.css") {
    this.source = source;
    this.filePath = filePath;
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const root = postcss.parse(this.source, { from: this.filePath });
    const items: StyleDecl[] = [];

    const cleanModPath = this.filePath
      .replace(/^(\.\/|\/)/, "")
      .replace(/\.css$/, "")
      .replace(/\.ail$/, "");

    let pendingComment: string | null = null;

    for (const node of root.nodes) {
      if (node.type === "comment") {
        pendingComment = node.text.trim();
        continue;
      }

      if (node.type === "rule") {
        const selector = node.selector.trim();
        const nodeId = `style:${selector}`;

        if (pendingComment) {
          this.trivia.addLeadingTrivia(nodeId, {
            kind: "BLOCK_COMMENT",
            content: `/* ${pendingComment} */`,
          });
          pendingComment = null;
        }

        const properties: StyleProperty[] = [];
        for (const child of node.nodes) {
          if (child.type === "decl") {
            properties.push({
              property: child.prop,
              value: child.value,
              span: emptySpan(this.filePath),
            });
          }
        }

        items.push({
          kind: "StyleDecl",
          name: selector,
          properties,
          span: emptySpan(this.filePath),
        });
      }
    }

    const ast: Module = {
      kind: "Module",
      path: cleanModPath || "style",
      items,
      span: emptySpan(this.filePath),
    };

    return { ast, trivia: this.trivia };
  }
}
