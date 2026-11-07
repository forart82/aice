/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JSON Decompiler (Reverse Transpiler) for AICE 2.0 (Step 24).
 * Parses JSON documents/fragments into canonical, token-dense AICE code:
 * e.g. `pub const config = { ... }` with full nested object/array/primitive lowering.
 */

import { stripJsonComments } from "../config/project-config.js";
import type { ConstDecl, Module } from "../core/ast.js";
import { valueToAst } from "../core/data-converter.js";
import { emptySpan } from "../core/span.js";
import { CstTriviaTable } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";

export interface JsonDecompilerOptions extends AiceGeneratorOptions {
  filePath?: string;
  constName?: string;
}

export interface JsonDecompileResult {
  ast: Module;
  aice: string;
  trivia: CstTriviaTable;
}

export class JsonDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();
  private options: JsonDecompilerOptions;

  constructor(source: string, filePath = "config.json", options: JsonDecompilerOptions = {}) {
    this.source = source;
    this.filePath = filePath;
    this.options = options;
  }

  decompile(): JsonDecompileResult {
    let parsed: any;
    const trimmed = this.source.trim();
    if (!trimmed) {
      parsed = {};
    } else {
      try {
        parsed = JSON.parse(this.source);
      } catch {
        parsed = JSON.parse(stripJsonComments(this.source));
      }
    }

    const expr = valueToAst(parsed, this.filePath);

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.json$/, "")
        .replace(/\.aice$/, "") ?? "config";
    const cleanModPath = baseName.replace(/[^a-zA-Z0-9_/-]/g, "_") || "config";
    const constName = this.options.constName ?? "config";

    const constDecl: ConstDecl = {
      kind: "ConstDecl",
      name: constName,
      isExported: true,
      value: expr,
      span: emptySpan(this.filePath),
    };

    const ast: Module = {
      kind: "Module",
      path: cleanModPath,
      items: [constDecl],
      span: emptySpan(this.filePath),
    };

    const generator = new AiceGenerator({ ...this.options, trivia: this.trivia });
    const aice = generator.generate(ast);

    return { ast, aice, trivia: this.trivia };
  }
}
