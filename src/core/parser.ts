/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pratt Parser & Universal AST Generator for AICE.
 *
 * Thin public barrel re-exporting parser APIs from cohesive submodules under
 * `src/core/parser/`.
 */

export { ParserError, Precedence } from "./parser/core.js";
export { Parser } from "./parser/parser-class.js";
export { parse, parseWithTrivia } from "./parser/trivia.js";
