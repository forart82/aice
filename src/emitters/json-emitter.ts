/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * JSON Emitter for AICE 2.0 (Step 24).
 * Emits valid, beautifully formatted `.json` from an AICE Module AST.
 */

import type { Module } from "../core/ast.js";
import { extractValueFromModule } from "../core/data-converter.js";
import type { EmitterOptions } from "./context.js";

export class JsonEmitter {
  private options: EmitterOptions;

  constructor(options: EmitterOptions = {}) {
    this.options = options;
  }

  emit(mod: Module): string {
    const value = extractValueFromModule(mod);
    const indent = this.options.indent !== undefined ? this.options.indent : 2;
    return JSON.stringify(value, null, indent) + "\n";
  }
}
