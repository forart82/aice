/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * YAML Decompiler (Reverse Transpiler) for AIL 2.0 (Step 24).
 * Parses YAML documents into canonical, token-dense AIL code:
 * e.g. `pub const config = { ... }` with comment extraction and data lowering.
 */

import YAML from "yaml";
import type { ConstDecl, Module } from "../core/ast.js";
import { valueToAst } from "../core/data-converter.js";
import { emptySpan } from "../core/span.js";
import { CstTriviaTable } from "../core/trivia.js";
import { AilGenerator, type AilGeneratorOptions } from "./ail-generator.js";

export interface YamlDecompilerOptions extends AilGeneratorOptions {
  filePath?: string;
  constName?: string;
}

export interface YamlDecompileResult {
  ast: Module;
  ail: string;
  trivia: CstTriviaTable;
}

export class YamlDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();
  private options: YamlDecompilerOptions;

  constructor(source: string, filePath = "config.yaml", options: YamlDecompilerOptions = {}) {
    this.source = source;
    this.filePath = filePath;
    this.options = options;
  }

  decompile(): YamlDecompileResult {
    // Extract leading comments from raw source lines
    const lines = this.source.split("\n");
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed.startsWith("#")) {
        this.trivia.addLeadingTrivia("module", {
          kind: "LINE_COMMENT",
          content: trimmed,
        });
      } else if (trimmed.length > 0) {
        break;
      }
    }

    let parsed: any;
    const trimmed = this.source.trim();
    if (!trimmed) {
      parsed = {};
    } else {
      const doc = YAML.parseDocument(this.source);
      if (doc.errors && doc.errors.length > 0) {
        throw doc.errors[0];
      }
      parsed = doc.toJS();
      if (parsed === undefined) {
        parsed = {};
      }
    }

    const expr = valueToAst(parsed, this.filePath);

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(yaml|yml)$/, "")
        .replace(/\.ail$/, "") ?? "config";
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

    const generator = new AilGenerator({ ...this.options, trivia: this.trivia });
    const ail = generator.generate(ast);

    return { ast, ail, trivia: this.trivia };
  }
}
