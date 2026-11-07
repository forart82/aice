/**
 * Unified Emitter Hub for AICE 2.0 Multi-Language Forward Transpilation.
 */

import type { Module } from "../core/ast.js";
import { detectTargetFromPath, type EmitterOptions, type TargetLanguage } from "./context.js";
import {
  findProjectRoot,
  loadProjectConfig,
  type ProjectIdiomDefinition,
} from "../config/project-config.js";
import { expandModuleIdioms } from "../idioms/index.js";
import { CppEmitter } from "./cpp-emitter.js";
import { CSharpEmitter } from "./csharp-emitter.js";
import { CssEmitter } from "./css-emitter.js";
import { GoEmitter } from "./go-emitter.js";
import { HtmlEmitter } from "./html-emitter.js";
import { JsonEmitter } from "./json-emitter.js";
import { PythonEmitter } from "./py-emitter.js";
import { RustEmitter } from "./rust-emitter.js";
import { TypeScriptEmitter } from "./ts-emitter.js";
import { TwigEmitter } from "./twig-emitter.js";
import { YamlEmitter } from "./yaml-emitter.js";
import { PhpEmitter } from "./php-emitter.js";
import { KotlinEmitter } from "./kotlin-emitter.js";

export * from "./context.js";
export * from "./cpp-emitter.js";
export * from "./csharp-emitter.js";
export * from "./css-emitter.js";
export * from "./go-emitter.js";
export * from "./html-emitter.js";
export * from "./json-emitter.js";
export * from "./kotlin-emitter.js";
export * from "./php-emitter.js";
export * from "./py-emitter.js";
export * from "./rewriter.js";
export * from "./rust-emitter.js";
export * from "./ts-emitter.js";
export * from "./twig-emitter.js";
export * from "./yaml-emitter.js";

// Convenience aliases
export { PythonEmitter as PyEmitter, TypeScriptEmitter as TsEmitter, KotlinEmitter as KtEmitter };

export interface EmitOptions extends EmitterOptions {
  idioms?: Record<string, ProjectIdiomDefinition>;
}

/**
 * Emits target source code from an AICE Module AST.
 * If target is omitted, automatically infers target from mod.path.
 */
export function emitTarget(
  mod: Module,
  target?: TargetLanguage,
  options: EmitOptions = {},
): string {
  let idioms = options.idioms;
  const fileCandidate =
    mod?.span?.file && mod.span.file !== "<anonymous>"
      ? mod.span.file
      : (mod?.path ?? "<anonymous>");

  if (
    idioms === undefined &&
    fileCandidate &&
    !fileCandidate.startsWith("<") &&
    (fileCandidate.includes("/") || fileCandidate.includes("\\"))
  ) {
    try {
      const root = findProjectRoot(fileCandidate);
      const config = loadProjectConfig(root);
      if (config.idioms && Object.keys(config.idioms).length > 0) {
        idioms = config.idioms;
      }
    } catch {
      // Ignore config resolution error in emitter fallback
    }
  }

  if (idioms && Object.keys(idioms).length > 0) {
    mod = expandModuleIdioms(mod, idioms);
  }

  const chosenTarget = target ?? detectTargetFromPath(fileCandidate);
  switch (chosenTarget) {
    case "typescript":
    case "javascript":
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
    case "json": {
      const emitter = new JsonEmitter(options);
      return emitter.emit(mod);
    }
    case "yaml": {
      const emitter = new YamlEmitter(options);
      return emitter.emit(mod);
    }
    case "twig": {
      const emitter = new TwigEmitter(options);
      return emitter.emit(mod);
    }
    case "php": {
      const emitter = new PhpEmitter(options);
      return emitter.emit(mod);
    }
    case "kotlin": {
      const emitter = new KotlinEmitter(options);
      return emitter.emit(mod);
    }
    default: {
      const exhaustiveCheck: never = chosenTarget;
      throw new Error(`Unsupported target language: ${exhaustiveCheck}`);
    }
  }
}
