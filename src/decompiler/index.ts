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
import { CppDecompiler } from "./cpp-decompiler.js";
import { CSharpDecompiler } from "./csharp-decompiler.js";
import { CssDecompiler } from "./css-decompiler.js";
import { HtmlDecompiler } from "./html-decompiler.js";
import { JsonDecompiler, type JsonDecompilerOptions } from "./json-decompiler.js";
import { TsDecompiler, type TsDecompilerOptions } from "./ts-decompiler.js";
import { decompileTwig } from "./twig-decompiler.js";
import { YamlDecompiler, type YamlDecompilerOptions } from "./yaml-decompiler.js";
import { decompilePhp, PhpDecompiler } from "./php-decompiler.js";
import { decompilePython, PythonDecompiler } from "./py-decompiler.js";
import { decompileKotlin, KotlinDecompiler } from "./kotlin-decompiler.js";
import { decompileGo, GoDecompiler } from "./go-decompiler.js";
import { decompileRust, RustDecompiler } from "./rust-decompiler.js";

export * from "./ail-generator.js";
export * from "./cpp-decompiler.js";
export * from "./csharp-decompiler.js";
export * from "./css-decompiler.js";
export * from "./go-decompiler.js";
export * from "./html-decompiler.js";
export * from "./json-decompiler.js";
export * from "./kotlin-decompiler.js";
export * from "./php-decompiler.js";
export * from "./py-decompiler.js";
export * from "./roundtrip.js";
export * from "./rust-decompiler.js";
export * from "./ts-decompiler.js";
export * from "./twig-decompiler.js";
export * from "./yaml-decompiler.js";

export interface DecompileOptions
  extends AilGeneratorOptions,
    TsDecompilerOptions,
    JsonDecompilerOptions,
    YamlDecompilerOptions {
  filePath?: string;
  target?: TargetLanguage;
  constName?: string;
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
    case "javascript":
    case "tsx": {
      const decompiler = new TsDecompiler(source, filePath, {
        isTsx: target === "tsx" || options.isTsx,
        convertStringUnionsToEnum: options.convertStringUnionsToEnum,
      });
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
    case "cpp": {
      const decompiler = new CppDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "csharp": {
      const decompiler = new CSharpDecompiler(source, filePath);
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
    case "json": {
      const decompiler = new JsonDecompiler(source, filePath, options);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "yaml": {
      const decompiler = new YamlDecompiler(source, filePath, options);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "twig": {
      const result = decompileTwig(source, filePath, options);
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "php": {
      const decompiler = new PhpDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "python": {
      const decompiler = new PythonDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "kotlin": {
      const decompiler = new KotlinDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "go": {
      const decompiler = new GoDecompiler(source, filePath);
      const result = decompiler.decompile();
      ast = result.ast;
      trivia = result.trivia;
      break;
    }
    case "rust": {
      const decompiler = new RustDecompiler(source, filePath);
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
