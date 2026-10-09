import type { Span } from "./span.js";

export type TokenKind =
  // Structural / Layout
  | "NEWLINE"
  | "INDENT"
  | "DEDENT"
  | "EOF"
  // Comments (for CST trivia preservation)
  | "COMMENT"
  // Identifiers & Literals
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "BOOLEAN"
  | "NIL"
  | "HEX_COLOR"
  // Declaration Keywords
  | "MODULE"
  | "FROM"
  | "IMPORT"
  | "TYPE"
  | "ENUM"
  | "FN"
  | "COMPONENT"
  | "STYLE"
  | "TOKENS"
  | "LET"
  | "MUT"
  | "VAL"
  | "PUB"
  | "STATE"
  | "CLASS"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "STATIC"
  | "READONLY"
  | "CONST"
  | "ASYNC"
  // Control Flow Keywords
  | "IF"
  | "ELIF"
  | "ELSE"
  | "MATCH"
  | "CASE"
  | "FOR"
  | "IN"
  | "WHILE"
  | "RET"
  // Logical Word Operators
  | "AND"
  | "OR"
  | "NOT"
  // Primitive Types (1-Token BPE Words)
  | "TYPE_INT"
  | "TYPE_STR"
  | "TYPE_FLOAT"
  | "TYPE_BOOL"
  | "TYPE_NUM"
  | "TYPE_BYTE"
  | "TYPE_CHAR"
  | "TYPE_VOID"
  | "TYPE_NIL"
  | "RESULT"
  | "OPTION"
  // Arithmetic Operators
  | "PLUS" // +
  | "MINUS" // -
  | "STAR" // *
  | "SLASH" // /
  | "PERCENT" // %
  // Comparison Operators
  | "EQ_EQ" // ==
  | "NOT_EQ" // !=
  | "LT_EQ" // <=
  | "GT_EQ" // >=
  | "LT" // <
  | "GT" // >
  // Logical / Safe Navigation
  | "AMP_AMP" // &&
  | "PIPE_PIPE" // ||
  | "QUESTION_QUESTION" // ??
  | "QUESTION_DOT" // ?.
  // Assignment & Connectors
  | "EQUAL" // =
  | "PLUS_EQUAL" // +=
  | "MINUS_EQUAL" // -=
  | "STAR_EQUAL" // *=
  | "SLASH_EQUAL" // /=
  | "PERCENT_EQUAL" // %=
  | "ARROW" // ->
  | "FAT_ARROW" // =>
  | "COLON_COLON" // ::
  | "PIPE" // |
  // Delimiters & Punctuation
  | "LPAREN" // (
  | "RPAREN" // )
  | "LBRACKET" // [
  | "RBRACKET" // ]
  | "LBRACE" // {
  | "RBRACE" // }
  | "COLON" // :
  | "COMMA" // ,
  | "DOT" // .
  | "ELLIPSIS" // ...
  | "QUESTION" // ?
  | "BANG" // !
  | "HASH" // #
  | "DOLLAR" // $
  | "SEMICOLON"; // ;

export interface Token {
  kind: TokenKind;
  value: string;
  span: Span;
}

export const KEYWORDS: Readonly<Record<string, TokenKind>> = {
  // Declarations
  module: "MODULE",
  from: "FROM",
  import: "IMPORT",
  type: "TYPE",
  enum: "ENUM",
  fn: "FN",
  component: "COMPONENT",
  style: "STYLE",
  tokens: "TOKENS",
  let: "LET",
  mut: "MUT",
  val: "VAL",
  pub: "PUB",
  state: "STATE",
  class: "CLASS",
  extends: "EXTENDS",
  implements: "IMPLEMENTS",
  static: "STATIC",
  readonly: "READONLY",
  const: "CONST",
  async: "ASYNC",
  // Control
  if: "IF",
  elif: "ELIF",
  else: "ELSE",
  match: "MATCH",
  case: "CASE",
  for: "FOR",
  in: "IN",
  while: "WHILE",
  ret: "RET",
  return: "RET",
  // Word Operators
  and: "AND",
  or: "OR",
  not: "NOT",
  // Literals
  true: "BOOLEAN",
  false: "BOOLEAN",
  nil: "NIL",
  // Primitive Types
  int: "TYPE_INT",
  str: "TYPE_STR",
  float: "TYPE_FLOAT",
  flt: "TYPE_FLOAT",
  bool: "TYPE_BOOL",
  num: "TYPE_NUM",
  byte: "TYPE_BYTE",
  char: "TYPE_CHAR",
  void: "TYPE_VOID",
  Result: "RESULT",
  Option: "OPTION",
};
