/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL (AI Language) - Core Compiler Engine Entrypoint
 */

export const AIL_VERSION = "0.1.3";
export const AIL_EXTENSION = ".ail";

export * from "./core/ast.ts";
export * from "./core/lexer.ts";
export * from "./core/parser.ts";
export * from "./core/span.ts";
export * from "./core/tokens.ts";
export * from "./core/trivia.ts";
export * from "./typechecker/checker.ts";
export * from "./typechecker/diagnostics.ts";
export * from "./typechecker/primitives.ts";
export * from "./typechecker/types.ts";

export interface CompileOptions {
  stripTrivia?: boolean;
  sourceMap?: boolean;
  outputPath?: string;
}

export interface DecompileOptions {
  preserveTrivia?: boolean;
  outputPath?: string;
}

export interface VerificationResult {
  valid: boolean;
  diagnostics: Array<{
    severity: "error" | "warning";
    code: string;
    message: string;
    line?: number;
    col?: number;
  }>;
}
