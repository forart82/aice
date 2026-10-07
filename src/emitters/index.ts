/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Unified Multi-Target Compiler Dispatcher (Pillar 5)
 */

import { type Diagnostic, parseAil } from "../core/parser.ts";
import type { CstTriviaTable } from "../core/trivia.ts";
import type { CompileOptions } from "../index.ts";
import type { TargetLanguage } from "./context.ts";
import { emitCss } from "./css-emitter.ts";
import { emitHtml } from "./html-emitter.ts";
import { emitPython } from "./py-emitter.ts";
import { emitTypeScript } from "./ts-emitter.ts";

export * from "./context.ts";
export * from "./css-emitter.ts";
export * from "./html-emitter.ts";
export * from "./py-emitter.ts";
export * from "./rewriter.ts";
export * from "./ts-emitter.ts";

export interface CompileResult {
  code: string;
  targetLanguage: TargetLanguage;
  triviaTable: CstTriviaTable;
  diagnostics: Diagnostic[];
}

export function detectTargetLanguage(pathOrExt: string): TargetLanguage {
  const clean = pathOrExt.replace(/\.ail$/, "");
  if (
    clean.endsWith(".ts") ||
    clean.endsWith(".tsx") ||
    clean.endsWith(".js") ||
    clean.endsWith(".jsx")
  ) {
    return "typescript";
  }
  if (clean.endsWith(".html") || clean.endsWith(".htm")) {
    return "html";
  }
  if (clean.endsWith(".css")) {
    return "css";
  }
  if (clean.endsWith(".py")) {
    return "python";
  }
  // Default fallback
  return "typescript";
}

export function compileAil(
  source: string,
  targetPathOrExt: string,
  options?: CompileOptions,
): CompileResult {
  const { document, triviaTable, diagnostics } = parseAil(source, targetPathOrExt);

  if (!document) {
    const errorMsg = diagnostics.map((d) => `[${d.code}] ${d.message}`).join("\n");
    throw new Error(`AIL Compilation failed to parse AST:\n${errorMsg}`);
  }

  const targetLang = detectTargetLanguage(targetPathOrExt);
  let code = "";

  const emitOptions = {
    stripTrivia: options?.stripTrivia,
    triviaTable: options?.stripTrivia ? undefined : triviaTable,
  };

  switch (targetLang) {
    case "typescript":
      code = emitTypeScript(document, emitOptions);
      break;
    case "html":
      code = emitHtml(document, emitOptions);
      break;
    case "css":
      code = emitCss(document, emitOptions);
      break;
    case "python":
      code = emitPython(document, emitOptions);
      break;
  }

  return {
    code,
    targetLanguage: targetLang,
    triviaTable,
    diagnostics,
  };
}
