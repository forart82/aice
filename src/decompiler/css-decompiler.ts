/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * CSS Decompiler (Reverse Transpiler) for AIL 2.0.
 * Parses CSS styles using PostCSS, extracts comments into CstTriviaTable,
 * and generates an AIL Module AST containing StyleDecl rules.
 */

import postcss from "postcss";
import type { ImportDecl, Module, StyleDecl, StyleProperty } from "../core/ast.js";
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
    const items: (StyleDecl | ImportDecl)[] = [];

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

      if (node.type === "atrule" && node.name === "import") {
        const cleanSource = node.params.trim().replace(/^['"]|['"]$/g, "");
        items.push({
          kind: "ImportDecl",
          source: cleanSource,
          specifiers: [],
          span: emptySpan(this.filePath),
        });
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

        const decls: { prop: string; value: string }[] = [];
        for (const child of node.nodes) {
          if (child.type === "decl") {
            decls.push({ prop: child.prop, value: child.value });
          }
        }

        const properties: StyleProperty[] = [];
        let i = 0;
        while (i < decls.length) {
          const d = decls[i];

          // Check for fl-center: display: flex + align-items: center + justify-content: center
          if (
            i + 2 < decls.length &&
            ((d.prop === "display" && d.value === "flex" &&
              decls[i + 1].prop === "align-items" && decls[i + 1].value === "center" &&
              decls[i + 2].prop === "justify-content" && decls[i + 2].value === "center") ||
             (d.prop === "display" && d.value === "flex" &&
              decls[i + 1].prop === "justify-content" && decls[i + 1].value === "center" &&
              decls[i + 2].prop === "align-items" && decls[i + 2].value === "center"))
          ) {
            properties.push({
              property: "fl-center",
              value: "",
              span: emptySpan(this.filePath),
            });
            i += 3;
            continue;
          }

          // Check for fl-row: display: flex + flex-direction: row
          if (
            i + 1 < decls.length &&
            ((d.prop === "display" && d.value === "flex" &&
              decls[i + 1].prop === "flex-direction" && decls[i + 1].value === "row") ||
             (d.prop === "flex-direction" && d.value === "row" &&
              decls[i + 1].prop === "display" && decls[i + 1].value === "flex"))
          ) {
            properties.push({
              property: "fl-row",
              value: "",
              span: emptySpan(this.filePath),
            });
            i += 2;
            continue;
          }

          // Check for fl-col: display: flex + flex-direction: column
          if (
            i + 1 < decls.length &&
            ((d.prop === "display" && d.value === "flex" &&
              decls[i + 1].prop === "flex-direction" && decls[i + 1].value === "column") ||
             (d.prop === "flex-direction" && d.value === "column" &&
              decls[i + 1].prop === "display" && decls[i + 1].value === "flex"))
          ) {
            properties.push({
              property: "fl-col",
              value: "",
              span: emptySpan(this.filePath),
            });
            i += 2;
            continue;
          }

          properties.push({
            property: d.prop,
            value: d.value,
            span: emptySpan(this.filePath),
          });
          i++;
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
