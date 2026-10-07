/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL (AI Language) - Core Compiler Engine Entrypoint
 */

export const AIL_VERSION = "0.1.0";
export const AIL_EXTENSION = ".ail";

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
