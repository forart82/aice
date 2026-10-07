/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: CSS3 Forward Emitter (Pillars 1, 2, 5)
 * Compiles AIL style declarations into clean, formatted CSS stylesheets.
 */

import type {
  AilDocumentNode,
  AilFileNode,
  AilModuleNode,
  AilStyleDeclNode,
  AilWorkspaceNode,
} from "../core/ast.ts";
import { EmitContext, type EmitOptions } from "./context.ts";

export class CssEmitter {
  public emitDocument(doc: AilDocumentNode, options?: EmitOptions): string {
    const ctx = new EmitContext("css", options);
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
      lines.push(...comments.map((c) => `/* ${c.replace(/^\/\/\s*/, "")} */`));
    }

    const styles = mod.entities.filter((e): e is AilStyleDeclNode => e.kind === "StyleDecl");
    for (const style of styles) {
      lines.push(this.emitStyleDecl(style, ctx));
      lines.push("");
    }

    return `${lines.join("\n").trim()}\n`;
  }

  public emitStyleDecl(node: AilStyleDeclNode, ctx: EmitContext): string {
    const comments = ctx.getLeadingComments(node.nodeId);
    const commentPrefix =
      comments.length > 0
        ? `${comments.map((c) => `/* ${c.replace(/^\/\/\s*/, "")} */`).join("\n")}\n`
        : "";

    let selector = node.name;
    if (
      !selector.startsWith(".") &&
      !selector.startsWith("#") &&
      !selector.startsWith(":") &&
      !selector.startsWith("@")
    ) {
      // If it looks like a class or identifier, default to class selector
      const htmlTags = new Set([
        "body",
        "html",
        "div",
        "p",
        "a",
        "span",
        "h1",
        "h2",
        "h3",
        "button",
        "input",
      ]);
      if (!htmlTags.has(selector.toLowerCase())) {
        selector = `.${selector}`;
      }
    }

    const ruleLines = node.rules.map((r) => `  ${r.prop}: ${r.value};`);
    return `${commentPrefix}${selector} {\n${ruleLines.join("\n")}\n}`;
  }
}

export function emitCss(doc: AilDocumentNode, options?: EmitOptions): string {
  const emitter = new CssEmitter();
  return emitter.emitDocument(doc, options);
}
