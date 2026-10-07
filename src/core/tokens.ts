/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Token Definitions & Lexical Grammar
 */

import type { SourceSpan } from "./span.ts";

export type TokenType =
  // Structural Delimiters
  | "LPAREN" // (
  | "RPAREN" // )
  | "LBRACKET" // [
  | "RBRACKET" // ]
  | "LBRACE" // {
  | "RBRACE" // }

  // Special S-Expression Compound Prefixes
  | "AT_WORKSPACE" // (@workspace
  | "AT_FILE" // (@file
  | "AT_MODULE" // (@module
  | "MANIFEST_START" // (*
  | "MANIFEST_END" // *)
  | "TYPE_DECL" // (:
  | "FN_DECL" // (!
  | "VAL_TEXT" // (!val
  | "COMPONENT_DECL" // (#
  | "LAYOUT_OPEN" // (<
  | "LAYOUT_CLOSE" // >)
  | "ATTRS_OPEN" // (.
  | "ATTRS_CLOSE" // .)
  | "STYLE_DECL" // (&
  | "STYLE_RULES_OPEN" // (+
  | "STYLE_RULES_CLOSE" // +)
  | "ASSIGN" // (:=
  | "MATCH" // (==
  | "DO_BLOCK" // (do
  | "IF_EXPR" // (?if
  | "TRY_UNPACK" // (?
  | "RECORD_LIT" // (%
  | "TYPESTATE" // (~
  | "EFFECT_DECL" // (!^
  | "REFINEMENT" // (?:
  | "UNION" // (|

  // Literals & Symbols
  | "SYMBOL" // e.g. foo, !s, !i, calculateRisk, add
  | "STRING" // e.g. "hello world"
  | "NUMBER" // e.g. 42, 3.14159, -10
  | "BOOLEAN" // true | false

  // CST Trivia (preserves formatting and comments)
  | "COMMENT_LINE" // // ... or ;; ... or # ...
  | "COMMENT_BLOCK" // /* ... */
  | "WHITESPACE" // spaces, tabs
  | "NEWLINE" // \n, \r\n

  // Control
  | "EOF"
  | "ERROR";

export interface Token {
  type: TokenType;
  value: string;
  span: SourceSpan;
}

export function createToken(type: TokenType, value: string, span: SourceSpan): Token {
  return { type, value, span };
}
