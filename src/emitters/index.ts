/**
 * Unified Emitter Hub for AIL 2.0 Multi-Language Forward Transpilation.
 */

import type { Module } from "../core/ast.js";
import { detectTargetFromPath, type EmitterOptions, type TargetLanguage } from "./context.js";
import { CppEmitter } from "./cpp-emitter.js";
import { CSharpEmitter } from "./csharp-emitter.js";
import { CssEmitter } from "./css-emitter.js";
import { GoEmitter } from "./go-emitter.js";
import { HtmlEmitter } from "./html-emitter.js";
import { PythonEmitter } from "./py-emitter.js";
import { RustEmitter } from "./rust-emitter.js";
import { TypeScriptEmitter } from "./ts-emitter.js";

export * from "./context.js";
export * from "./cpp-emitter.js";
export * from "./csharp-emitter.js";
export * from "./css-emitter.js";
export * from "./go-emitter.js";
export * from "./html-emitter.js";
export * from "./py-emitter.js";
export * from "./rewriter.js";
export * from "./rust-emitter.js";
export * from "./ts-emitter.js";

// Convenience aliases
export { PythonEmitter as PyEmitter, TypeScriptEmitter as TsEmitter };

/**
 * Emits target source code from an AIL Module AST.
 * If target is omitted, automatically infers target from mod.path.
 */
export function emitTarget(
  mod: Module,
  target?: TargetLanguage,
  options: EmitterOptions = {},
): string {
  const fileCandidate =
    mod.span?.file && mod.span.file !== "<anonymous>" ? mod.span.file : mod.path;
  const chosenTarget = target ?? detectTargetFromPath(fileCandidate);
  switch (chosenTarget) {
    case "typescript":
    case "tsx": {
      const emitter = new TypeScriptEmitter({ ...options, target: chosenTarget });
      return emitter.emit(mod);
    }
    case "python": {
      const emitter = new PythonEmitter(options);
      return emitter.emit(mod);
    }
    case "rust": {
      const emitter = new RustEmitter(options);
      return emitter.emit(mod);
    }
    case "go": {
      const emitter = new GoEmitter(options);
      return emitter.emit(mod);
    }
    case "cpp": {
      const emitter = new CppEmitter(options);
      return emitter.emit(mod);
    }
    case "csharp": {
      const emitter = new CSharpEmitter(options);
      return emitter.emit(mod);
    }
    case "html": {
      const emitter = new HtmlEmitter(options);
      return emitter.emit(mod);
    }
    case "css": {
      const emitter = new CssEmitter(options);
      return emitter.emit(mod);
    }
    default: {
      const exhaustiveCheck: never = chosenTarget;
      throw new Error(`Unsupported target language: ${exhaustiveCheck}`);
    }
  }
}
