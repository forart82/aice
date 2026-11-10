/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Universal Decompiler & Bidirectional Transpiler Hub for AICE 2.0.
 */

import { existsSync, promises as fs } from "node:fs";
import { dirname, resolve } from "node:path";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  type ProjectIdiomDefinition,
} from "../config/index.js";
  import type { Module } from "../core/ast.js";
  import { CstTriviaTable } from "../core/trivia.js";
  import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { collapseModuleIdioms } from "../idioms/idiom-transform.js";
import { recordTelemetryEvent } from "../telemetry/index.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";
import { CppDecompiler } from "./cpp-decompiler.js";
import { CSharpDecompiler } from "./csharp-decompiler.js";
import { CssDecompiler } from "./css-decompiler.js";
import { GoDecompiler } from "./go-decompiler.js";
import { HtmlDecompiler } from "./html-decompiler.js";
import { JsonDecompiler, type JsonDecompilerOptions } from "./json-decompiler.js";
import { KotlinDecompiler } from "./kotlin-decompiler.js";
import { PhpDecompiler } from "./php-decompiler.js";
import { PythonDecompiler } from "./py-decompiler.js";
import { RustDecompiler } from "./rust-decompiler.js";
import { TsDecompiler, type TsDecompilerOptions } from "./ts-decompiler.js";
import { decompileTwig } from "./twig-decompiler.js";
import { YamlDecompiler, type YamlDecompilerOptions } from "./yaml-decompiler.js";

export * from "./aice-generator.js";
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
  extends AiceGeneratorOptions,
    TsDecompilerOptions,
    JsonDecompilerOptions,
    YamlDecompilerOptions {
  filePath?: string;
  target?: TargetLanguage;
  constName?: string;
  idioms?: boolean;
  projectRoot?: string;
}

export interface DecompileResult {
  ast: Module;
  aice: string;
  trivia: CstTriviaTable;
}

export function decompile(
  source: string,
  target: TargetLanguage,
  options: DecompileOptions = {},
): DecompileResult {
  const filePath = options.filePath ?? "source";
  let projectRoot: string | undefined = options.projectRoot;
  let idiomsToCollapse: Record<string, ProjectIdiomDefinition> | undefined;

  if (options.projectRoot || (filePath !== "source" && existsSync(filePath))) {
    try {
      const root = options.projectRoot ?? findProjectRoot(dirname(resolve(filePath)));
      projectRoot = root;
      const cfg = loadProjectConfig(root);
      if (!isProjectAiceEnabled(cfg)) {
        throw new Error(AICE_DISABLED_MESSAGE);
      }
      if (options.idioms === true && isProjectIdiomsEnabled(cfg, options.idioms) && cfg.idioms) {
        idiomsToCollapse = cfg.idioms;
      }
    } catch (err) {
      if (err instanceof Error && err.message === AICE_DISABLED_MESSAGE) {
        throw err;
      }
    }
  }

  let ast: Module;
  let trivia: CstTriviaTable;

  if (target === "typescript" || target === "javascript" || target === "tsx") {
    const decompiler = new TsDecompiler(source, filePath, {
      isTsx: target === "tsx" || options.isTsx,
      convertStringUnionsToEnum: options.convertStringUnionsToEnum,
    });
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "css") {
    const decompiler = new CssDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "cpp") {
    const decompiler = new CppDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "csharp") {
    const decompiler = new CSharpDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "html") {
    const decompiler = new HtmlDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "json") {
    const decompiler = new JsonDecompiler(source, filePath, options);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "yaml") {
    const decompiler = new YamlDecompiler(source, filePath, options);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "twig") {
    const result = decompileTwig(source, filePath, options);
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "php") {
    const decompiler = new PhpDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "python") {
    const decompiler = new PythonDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "kotlin") {
    const decompiler = new KotlinDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "go") {
    const decompiler = new GoDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (target === "rust") {
    const decompiler = new RustDecompiler(source, filePath);
    const result = decompiler.decompile();
    ast = result.ast;
    trivia = result.trivia;
  } else if (
    target === "shell" ||
    target === "powershell" ||
    target === "batch" ||
    target === "markdown" ||
    target === "aipl"
  ) {
    trivia = new CstTriviaTable();
    trivia.setOriginalSource(source);
    const lineCount = source.split(/\r?\n/).length;
    const span = {
      file: filePath,
      start: { offset: 0, line: 1, column: 1 },
      end: { offset: source.length, line: lineCount, column: 1 },
    };
    ast = { kind: "Module", path: filePath, items: [], span };
    if (filePath !== "source" && existsSync(filePath)) {
      recordTelemetryEvent({
        targetPath: resolve(filePath),
        projectRoot,
        operation: "decompile",
        surface: "cli",
        idiomsUsed: false,
        nativeText: source,
        aiceText: source,
      });
    }
    return { ast, aice: source, trivia };
  } else {
    throw new Error(`Unsupported target language for decompilation: ${target}`);
  }

  let idiomsUsed = false;
  if (idiomsToCollapse && Object.keys(idiomsToCollapse).length > 0) {
    try {
      const collapsed = collapseModuleIdioms(ast, idiomsToCollapse);
      if (collapsed.collapsedCount > 0) {
        ast = collapsed.ast;
        idiomsUsed = true;
      }
    } catch {
      // ignore
    }
  }

  const generator = new AiceGenerator({ ...options, trivia });
  const aice = generator.generate(ast);

  if (filePath !== "source" && existsSync(filePath)) {
    recordTelemetryEvent({
      targetPath: resolve(filePath),
      projectRoot,
      operation: "decompile",
      surface: "cli",
      idiomsUsed,
      nativeText: source,
      aiceText: aice,
    });
  }

  return { ast, aice, trivia };
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
