/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * YAML Emitter for AIL 2.0 (Step 24).
 * Emits valid `.yaml` from an AIL Module AST using YAML.stringify.
 */

import YAML from "yaml";
import type { Module } from "../core/ast.js";
import { extractValueFromModule } from "../core/data-converter.js";
import type { EmitterOptions } from "./context.js";

export class YamlEmitter {
  private options: EmitterOptions;

  constructor(options: EmitterOptions = {}) {
    this.options = options;
  }

  emit(mod: Module): string {
    const value = extractValueFromModule(mod);
    let headerComments = "";

    if (this.options.trivia) {
      const modTrivia = this.options.trivia.getTrivia("module");
      if (modTrivia && modTrivia.leading.length > 0) {
        for (const item of modTrivia.leading) {
          let clean = item.content.trim();
          if (clean.startsWith("//")) {
            clean = clean.slice(2).trim();
          } else if (clean.startsWith("#")) {
            clean = clean.slice(1).trim();
          }
          headerComments += clean.length > 0 ? `# ${clean}\n` : "#\n";
        }
      }
    }

    const yamlStr = YAML.stringify(value);
    return headerComments + yamlStr;
  }
}
