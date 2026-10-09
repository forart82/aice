/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal Decompiler & Bidirectional Transpiler Hub for AIL 2.0.
 */

import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import type { Module } from "../core/ast.js";
import type { CstTriviaTable } from "../core/trivia.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { AilGenerator, type AilGeneratorOptions } from "./ail-generator.js";
import { CssDecompiler } from "./css-decompiler.js";
import { HtmlDecompiler } from "./html-decompiler.js";
import { TsDecompiler } from "./ts-decompiler.js";

export * from "./ail-generator.js";
export * from "./css-decompiler.js";
export * from "./html-decompiler.js";
export * from "./roundtrip.js";
export * from "./ts-decompiler.js";

export interface DecompileOptions extends AilGeneratorOptions {
  filePath?: string;
  target?: TargetLanguage;
}

export interface DecompileResult {
  ast: Module;
  ail: string;
  trivia: CstTriviaTable;
}

export function decompile(
  source: string,
  target: TargetLanguage,
  options: DecompileOptions = {},
): DecompileResult {
  const filePath = options.filePath ?? "source";
  let ast: Module;
  let trivia: CstTriviaTable;

  switch (target) {
    case "typescript":
    case "tsx": {
      const decompiler = new TsDecompiler(source, filePath, { isTsx: target === "tsx" });
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "css": {
      const decompiler = new CssDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "html": {
      const decompiler = new HtmlDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    default:
      throw new Error(`Unsupported target language for decompilation: ${target}`);
  }

  const generator = new AilGenerator({ ...options, trivia });
  const ail = generator.generate(ast);

  return { ast, ail, trivia };
}

export async function decompileFile(
  filePath: string,
  options: DecompileOptions = {},
): Promise<DecompileResult> {
  const resolved = resolve(filePath);
  const content = await fs.readFile(resolved, "utf-8");
  const target = options.target ?? detectTargetFromPath(filePath);
  return decompile(content, target, { ...options, filePath });
}
