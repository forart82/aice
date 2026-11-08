/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idiomatic Kotlin 1.9 / 2.x Decompiler & Parser for AICE 2.0.
 * Dedicated zero-dependency streaming lexer (KotlinLexer) and recursive-descent/Pratt
 * parser (KotlinDecompiler):
 *   - Parses `package` and `import` declarations
 *   - Parses `data class`, standard classes, interfaces, `enum class`, and `object`
 *   - Parses primary and secondary constructors
 *   - Parses `fun` and `suspend fun` functions with parameter types, default values, and return types
 *   - Parses `when` expressions into AICE `MatchExpr` / `MatchStmt`
 *   - Parses expressions (binary, unary, call, member access, elvis `?:`, safe call `?.`, string templates)
 *   - Parses control flow (`if / else`, `while`, `for`, `try / catch / finally`, `return`, `throw`)
 *   - Extracts KDoc docstrings and comments into `CstTriviaTable`
 *   - Lowers into canonical AICE AST `Module`
 *   - Exports `decompileKotlin(source: string, filePath?: string): DecompileResult`
 */

import type {
  AssignOp,
  BinaryOp,
  Block,
  ClassDecl,
  ConstDecl,
  Expr,
  ForStmt,
  FunctionDecl,
  IfStmt,
  ImportDecl,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PropertyDecl,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  TryStmt,
  TypeDecl,
  TypeExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";
import type { MatchExpr } from "./php-decompiler.js";

export type { MatchExpr };

export type KotlinTokenKind =
  | "PACKAGE"
  | "IMPORT"
  | "AS"
  | "CLASS"
  | "INTERFACE"
  | "OBJECT"
  | "ENUM"
  | "DATA"
  | "SEALED"
  | "ABSTRACT"
  | "OPEN"
  | "OVERRIDE"
  | "FUN"
  | "SUSPEND"
  | "VAL"
  | "VAR"
  | "CONST"
  | "CONSTRUCTOR"
  | "INIT"
  | "COMPANION"
  | "TYPEALIAS"
  | "BY"
  | "IF"
  | "ELSE"
  | "WHEN"
  | "FOR"
  | "WHILE"
  | "DO"
  | "RETURN"
  | "THROW"
  | "TRY"
  | "CATCH"
  | "FINALLY"
  | "BREAK"
  | "CONTINUE"
  | "IN"
  | "NOT_IN"
  | "IS"
  | "NOT_IS"
  | "PUBLIC"
  | "PRIVATE"
  | "PROTECTED"
  | "INTERNAL"
  | "TRUE"
  | "FALSE"
  | "NULL"
  | "THIS"
  | "SUPER"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "CHAR"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "DOT"
  | "SAFE_DOT"
  | "ELVIS"
  | "DOUBLE_COLON"
  | "COLON"
  | "SEMICOLON"
  | "ARROW"
  | "EQ_EXACT"
  | "NE_EXACT"
  | "EQ"
  | "NE"
  | "LE"
  | "GE"
  | "LT"
  | "GT"
  | "ASSIGN"
  | "PLUS_ASSIGN"
  | "MINUS_ASSIGN"
  | "STAR_ASSIGN"
  | "SLASH_ASSIGN"
  | "PERCENT_ASSIGN"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "PLUS_PLUS"
  | "MINUS_MINUS"
  | "DOUBLE_BANG"
  | "RANGE"
  | "AND_AND"
  | "OR_OR"
  | "BANG"
  | "QUESTION"
  | "DOC_COMMENT"
  | "LINE_COMMENT"
  | "BLOCK_COMMENT"
  | "EOF";

export interface KotlinToken {
  kind: KotlinTokenKind;
  value: string;
  line: number;
  col: number;
  offset: number;
  endOffset: number;
}

const KOTLIN_KEYWORDS = new Map<string, KotlinTokenKind>([
  ["package", "PACKAGE"],
  ["import", "IMPORT"],
  ["as", "AS"],
  ["class", "CLASS"],
  ["interface", "INTERFACE"],
  ["object", "OBJECT"],
  ["enum", "ENUM"],
  ["data", "DATA"],
  ["sealed", "SEALED"],
  ["abstract", "ABSTRACT"],
  ["open", "OPEN"],
  ["override", "OVERRIDE"],
  ["fun", "FUN"],
  ["suspend", "SUSPEND"],
  ["val", "VAL"],
  ["var", "VAR"],
  ["const", "CONST"],
  ["constructor", "CONSTRUCTOR"],
  ["init", "INIT"],
  ["companion", "COMPANION"],
  ["typealias", "TYPEALIAS"],
  ["by", "BY"],
  ["if", "IF"],
  ["else", "ELSE"],
  ["when", "WHEN"],
  ["for", "FOR"],
  ["while", "WHILE"],
  ["do", "DO"],
  ["return", "RETURN"],
  ["throw", "THROW"],
  ["try", "TRY"],
  ["catch", "CATCH"],
  ["finally", "FINALLY"],
  ["break", "BREAK"],
  ["continue", "CONTINUE"],
  ["in", "IN"],
  ["is", "IS"],
  ["public", "PUBLIC"],
  ["private", "PRIVATE"],
  ["protected", "PROTECTED"],
  ["internal", "INTERNAL"],
  ["true", "TRUE"],
  ["false", "FALSE"],
  ["null", "NULL"],
  ["this", "THIS"],
  ["super", "SUPER"],
]);

export class KotlinLexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): KotlinToken[] {
    const tokens: KotlinToken[] = [];

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }
      if (ch === "\n") {
        this.line++;
        this.col = 1;
        this.pos++;
        continue;
      }

      // Comments & KDoc
      if (this.src.startsWith("/**", this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;
        const endIdx = this.src.indexOf("*/", this.pos + 3);
        const comment =
          endIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, endIdx + 2);
        this.advanceChars(comment);
        tokens.push({
          kind: "DOC_COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
        continue;
      }

      if (this.src.startsWith("/*", this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;
        let depth = 1;
        let cur = this.pos + 2;
        while (cur < this.src.length && depth > 0) {
          if (this.src.startsWith("/*", cur)) {
            depth++;
            cur += 2;
          } else if (this.src.startsWith("*/", cur)) {
            depth--;
            cur += 2;
          } else {
            cur++;
          }
        }
        const comment = this.src.slice(this.pos, cur);
        this.advanceChars(comment);
        tokens.push({
          kind: "BLOCK_COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
        continue;
      }

      if (this.src.startsWith("//", this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;
        let lineEnd = this.src.indexOf("\n", this.pos);
        if (lineEnd === -1) lineEnd = this.src.length;
        const comment = this.src.slice(this.pos, lineEnd);
        this.advanceChars(comment);
        tokens.push({
          kind: "LINE_COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
        continue;
      }

      // Multiline Raw String """..."""
      if (this.src.startsWith('"""', this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;
        const endIdx = this.src.indexOf('"""', this.pos + 3);
        const strVal =
          endIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, endIdx + 3);
        this.advanceChars(strVal);
        tokens.push({
          kind: "STRING",
          value: strVal,
          line: startLine,
          col: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
        continue;
      }

      // Single-line String "..."
      if (ch === '"') {
        tokens.push(this.readString());
        continue;
      }

      // Character Literal 'c'
      if (ch === "'") {
        tokens.push(this.readChar());
        continue;
      }

      // Backticked Identifier `foo bar`
      if (ch === "`") {
        const startLine = this.line;
        const startCol = this.col;
        const startOffset = this.pos;
        const endIdx = this.src.indexOf("`", this.pos + 1);
        const ident =
          endIdx === -1 ? this.src.slice(this.pos + 1) : this.src.slice(this.pos + 1, endIdx);
        this.advanceChars(this.src.slice(this.pos, endIdx === -1 ? this.src.length : endIdx + 1));
        tokens.push({
          kind: "IDENTIFIER",
          value: ident,
          line: startLine,
          col: startCol,
          offset: startOffset,
          endOffset: this.pos,
        });
        continue;
      }

      // Multi-char operators
      if (this.src.startsWith("===", this.pos)) {
        tokens.push(this.consumeOp("EQ_EXACT", 3));
        continue;
      }
      if (this.src.startsWith("!==", this.pos)) {
        tokens.push(this.consumeOp("NE_EXACT", 3));
        continue;
      }
      if (this.src.startsWith("==", this.pos)) {
        tokens.push(this.consumeOp("EQ", 2));
        continue;
      }
      if (this.src.startsWith("!=", this.pos)) {
        tokens.push(this.consumeOp("NE", 2));
        continue;
      }
      if (this.src.startsWith("!in", this.pos) && !this.isIdentChar(this.src[this.pos + 3] ?? "")) {
        tokens.push(this.consumeOp("NOT_IN", 3));
        continue;
      }
      if (this.src.startsWith("!is", this.pos) && !this.isIdentChar(this.src[this.pos + 3] ?? "")) {
        tokens.push(this.consumeOp("NOT_IS", 3));
        continue;
      }
      if (this.src.startsWith("<=", this.pos)) {
        tokens.push(this.consumeOp("LE", 2));
        continue;
      }
      if (this.src.startsWith(">=", this.pos)) {
        tokens.push(this.consumeOp("GE", 2));
        continue;
      }
      if (this.src.startsWith("->", this.pos)) {
        tokens.push(this.consumeOp("ARROW", 2));
        continue;
      }
      if (this.src.startsWith("?.", this.pos)) {
        tokens.push(this.consumeOp("SAFE_DOT", 2));
        continue;
      }
      if (this.src.startsWith("?:", this.pos)) {
        tokens.push(this.consumeOp("ELVIS", 2));
        continue;
      }
      if (this.src.startsWith("::", this.pos)) {
        tokens.push(this.consumeOp("DOUBLE_COLON", 2));
        continue;
      }
      if (this.src.startsWith("!!", this.pos)) {
        tokens.push(this.consumeOp("DOUBLE_BANG", 2));
        continue;
      }
      if (this.src.startsWith("..<", this.pos)) {
        tokens.push(this.consumeOp("RANGE", 3));
        continue;
      }
      if (this.src.startsWith("..", this.pos)) {
        tokens.push(this.consumeOp("RANGE", 2));
        continue;
      }
      if (this.src.startsWith("++", this.pos)) {
        tokens.push(this.consumeOp("PLUS_PLUS", 2));
        continue;
      }
      if (this.src.startsWith("--", this.pos)) {
        tokens.push(this.consumeOp("MINUS_MINUS", 2));
        continue;
      }
      if (this.src.startsWith("+=", this.pos)) {
        tokens.push(this.consumeOp("PLUS_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("-=", this.pos)) {
        tokens.push(this.consumeOp("MINUS_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("*=", this.pos)) {
        tokens.push(this.consumeOp("STAR_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("/=", this.pos)) {
        tokens.push(this.consumeOp("SLASH_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("%=", this.pos)) {
        tokens.push(this.consumeOp("PERCENT_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("&&", this.pos)) {
        tokens.push(this.consumeOp("AND_AND", 2));
        continue;
      }
      if (this.src.startsWith("||", this.pos)) {
        tokens.push(this.consumeOp("OR_OR", 2));
        continue;
      }

      // Single-char punctuation
      const singleOps: Record<string, KotlinTokenKind> = {
        "(": "LPAREN",
        ")": "RPAREN",
        "{": "LBRACE",
        "}": "RBRACE",
        "[": "LBRACKET",
        "]": "RBRACKET",
        ",": "COMMA",
        ".": "DOT",
        ":": "COLON",
        ";": "SEMICOLON",
        "=": "ASSIGN",
        "<": "LT",
        ">": "GT",
        "+": "PLUS",
        "-": "MINUS",
        "*": "STAR",
        "/": "SLASH",
        "%": "PERCENT",
        "!": "BANG",
        "?": "QUESTION",
      };

      if (singleOps[ch]) {
        tokens.push(this.consumeOp(singleOps[ch], 1));
        continue;
      }

      // Numbers
      if (this.isDigit(ch)) {
        tokens.push(this.readNumber());
        continue;
      }

      // Identifiers & Keywords
      if (this.isIdentStart(ch)) {
        tokens.push(this.readIdentifier());
        continue;
      }

      // Unknown character fallback
      tokens.push(this.consumeOp("EOF", 1));
    }

    tokens.push({
      kind: "EOF",
      value: "",
      line: this.line,
      col: this.col,
      offset: this.pos,
      endOffset: this.pos,
    });
    return tokens;
  }

  private advance(): string {
    const ch = this.src[this.pos];
    this.pos++;
    this.col++;
    return ch;
  }

  private advanceChars(s: string): void {
    for (const c of s) {
      if (c === "\n") {
        this.line++;
        this.col = 1;
      } else {
        this.col++;
      }
    }
    this.pos += s.length;
  }

  private consumeOp(kind: KotlinTokenKind, len: number): KotlinToken {
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    const val = this.src.slice(this.pos, this.pos + len);
    this.pos += len;
    this.col += len;
    return {
      kind,
      value: val,
      line: startLine,
      col: startCol,
      offset: startOffset,
      endOffset: this.pos,
    };
  }

  private readString(): KotlinToken {
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    this.advance(); // consume opening "
    let val = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === "\\") {
        val += this.advance();
        if (this.pos < this.src.length) {
          val += this.advance();
        }
        continue;
      }
      if (ch === '"') {
        this.advance(); // consume closing "
        break;
      }
      val += this.advance();
    }
    return {
      kind: "STRING",
      value: `"${val}"`,
      line: startLine,
      col: startCol,
      offset: startOffset,
      endOffset: this.pos,
    };
  }

  private readChar(): KotlinToken {
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    this.advance(); // consume '
    let val = "";
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === "\\") {
        val += this.advance();
        if (this.pos < this.src.length) {
          val += this.advance();
        }
        continue;
      }
      if (ch === "'") {
        this.advance(); // consume closing '
        break;
      }
      val += this.advance();
    }
    return {
      kind: "CHAR",
      value: `'${val}'`,
      line: startLine,
      col: startCol,
      offset: startOffset,
      endOffset: this.pos,
    };
  }

  private isDigit(ch: string): boolean {
    return ch >= "0" && ch <= "9";
  }

  private isIdentStart(ch: string): boolean {
    return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
  }

  private isIdentChar(ch: string): boolean {
    return this.isIdentStart(ch) || this.isDigit(ch);
  }

  private readNumber(): KotlinToken {
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    let numStr = "";

    // Hex
    if (
      this.src[this.pos] === "0" &&
      (this.src[this.pos + 1] === "x" || this.src[this.pos + 1] === "X")
    ) {
      numStr += this.advance(); // 0
      numStr += this.advance(); // x
      while (
        this.pos < this.src.length &&
        ((this.src[this.pos] >= "0" && this.src[this.pos] <= "9") ||
          (this.src[this.pos] >= "a" && this.src[this.pos] <= "f") ||
          (this.src[this.pos] >= "A" && this.src[this.pos] <= "F") ||
          this.src[this.pos] === "_")
      ) {
        numStr += this.advance();
      }
    } else {
      while (
        this.pos < this.src.length &&
        (this.isDigit(this.src[this.pos]) || this.src[this.pos] === "_")
      ) {
        numStr += this.advance();
      }
      if (this.src[this.pos] === "." && this.isDigit(this.src[this.pos + 1] ?? "")) {
        numStr += this.advance(); // .
        while (
          this.pos < this.src.length &&
          (this.isDigit(this.src[this.pos]) || this.src[this.pos] === "_")
        ) {
          numStr += this.advance();
        }
      }
    }

    // Type suffixes: L, f, F, u, U
    if (this.pos < this.src.length && /[fFlLuU]/.test(this.src[this.pos])) {
      numStr += this.advance();
    }

    return {
      kind: "NUMBER",
      value: numStr,
      line: startLine,
      col: startCol,
      offset: startOffset,
      endOffset: this.pos,
    };
  }

  private readIdentifier(): KotlinToken {
    const startLine = this.line;
    const startCol = this.col;
    const startOffset = this.pos;
    let ident = "";

    while (this.pos < this.src.length && this.isIdentChar(this.src[this.pos])) {
      ident += this.advance();
    }

    const kw = KOTLIN_KEYWORDS.get(ident);
    if (kw) {
      return {
        kind: kw,
        value: ident,
        line: startLine,
        col: startCol,
        offset: startOffset,
        endOffset: this.pos,
      };
    }
    return {
      kind: "IDENTIFIER",
      value: ident,
      line: startLine,
      col: startCol,
      offset: startOffset,
      endOffset: this.pos,
    };
  }
}

enum Precedence {
  LOWEST = 0,
  ASSIGN = 1,
  ELVIS = 2,
  LOGICAL_OR = 3,
  LOGICAL_AND = 4,
  EQUALITY = 5,
  COMPARISON = 6,
  RANGE = 7,
  ADDITIVE = 8,
  MULTIPLICATIVE = 9,
  PREFIX = 10,
  POSTFIX = 11,
  CALL = 12,
}

export class KotlinDecompiler {
  private source: string;
  private filePath: string;
  private tokens: KotlinToken[] = [];
  private cur = 0;
  private trivia: CstTriviaTable;
  private pendingTrivia: TriviaItem[] = [];

  constructor(source: string, filePath = "source.kt") {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const lexer = new KotlinLexer(this.source);
    this.tokens = lexer.tokenize();
    this.cur = 0;
    this.pendingTrivia = [];
    const items: ModuleItem[] = [];

    // Parse package declaration if present
    this.collectLeadingTrivia();
    if (this.check("PACKAGE")) {
      this.advance();
      let pkgName = "";
      while (
        !this.check("SEMICOLON") &&
        !this.check("EOF") &&
        this.isIdentOrDot(this.current().kind)
      ) {
        pkgName += this.advance().value;
      }
      if (this.check("SEMICOLON")) this.advance();
      this.trivia.setTrivia("mod:package", {
        nodeId: "mod:package",
        leading: [{ kind: "LINE_COMMENT", content: pkgName }],
        trailing: [],
      });
    }

    // Top-level declarations
    while (!this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("EOF")) break;

      if (this.check("IMPORT")) {
        items.push(this.parseImport());
        continue;
      }

      if (this.isClassAhead()) {
        items.push(this.parseClassOrDataClass());
        continue;
      }

      if (this.isFunctionAhead()) {
        items.push(this.parseFunction());
        continue;
      }

      if (this.check("VAL") || this.check("VAR") || this.check("CONST")) {
        items.push(this.parseTopLevelVar());
        continue;
      }

      if (this.check("TYPEALIAS")) {
        items.push(this.parseTypealias());
        continue;
      }

      // Skip unexpected token
      this.advance();
    }

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(kt|kts|aice)$/i, "") || "main";

    const ast: Module = {
      kind: "Module",
      path: baseName,
      items,
      span: emptySpan(this.filePath),
    };

    return { ast, trivia: this.trivia };
  }

  private isIdentOrDot(kind: KotlinTokenKind): boolean {
    return kind === "IDENTIFIER" || kind === "DOT";
  }

  private current(): KotlinToken {
    return (
      this.tokens[this.cur] ?? {
        kind: "EOF",
        value: "",
        line: 1,
        col: 1,
        offset: this.source.length,
        endOffset: this.source.length,
      }
    );
  }

  private check(kind: KotlinTokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): KotlinToken {
    const tok = this.current();
    if (this.cur < this.tokens.length) {
      this.cur++;
    }
    return tok;
  }

  private consume(kind: KotlinTokenKind): KotlinToken {
    if (this.check(kind)) {
      return this.advance();
    }
    return {
      kind,
      value: "",
      line: this.current().line,
      col: this.current().col,
      offset: this.current().offset,
      endOffset: this.current().endOffset,
    };
  }

  private declStartOffset: number | null = null;

  private collectLeadingTrivia(): void {
    while (this.check("DOC_COMMENT") || this.check("LINE_COMMENT") || this.check("BLOCK_COMMENT")) {
      const tok = this.advance();
      if (this.declStartOffset === null) {
        this.declStartOffset = tok.offset;
      }
      this.pendingTrivia.push({
        kind:
          tok.kind === "DOC_COMMENT"
            ? "DOCSTRING"
            : tok.kind === "LINE_COMMENT"
              ? "LINE_COMMENT"
              : "BLOCK_COMMENT",
        content: tok.value,
      });
    }
  }

  private attachTrivia(nodeId: string): void {
    for (const item of this.pendingTrivia) {
      this.trivia.addLeadingTrivia(nodeId, item);
    }
    this.pendingTrivia = [];
  }

  private parseImport(): ImportDecl {
    const startOffset = this.declStartOffset ?? this.current().offset;
    this.declStartOffset = null;
    const startTok = this.consume("IMPORT");
    let fullPath = "";
    while (
      !this.check("SEMICOLON") &&
      !this.check("AS") &&
      !this.check("EOF") &&
      (this.isIdentOrDot(this.current().kind) || this.check("STAR"))
    ) {
      fullPath += this.advance().value;
    }

    let alias: string | undefined;
    if (this.check("AS")) {
      this.advance();
      alias = this.advance().value;
    }
    if (this.check("SEMICOLON")) this.advance();

    const isWildcard = fullPath.endsWith(".*");
    const lastDot = fullPath.lastIndexOf(".");
    const importName = isWildcard ? "*" : lastDot >= 0 ? fullPath.slice(lastDot + 1) : fullPath;
    const baseSource = lastDot >= 0 ? fullPath.slice(0, lastDot) : fullPath;
    this.attachTrivia(`import:${baseSource}`);

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startOffset, endTok.endOffset);

    return {
      kind: "ImportDecl",
      source: baseSource,
      specifiers: [
        {
          name: importName,
          alias,
          isWildcard,
          span,
        },
      ],
      span,
    };
  }

  private isClassAhead(): boolean {
    let i = this.cur;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (
        k === "DATA" ||
        k === "ENUM" ||
        k === "INTERFACE" ||
        k === "CLASS" ||
        k === "OBJECT" ||
        k === "SEALED" ||
        k === "ABSTRACT" ||
        k === "OPEN" ||
        k === "PUBLIC" ||
        k === "PRIVATE" ||
        k === "PROTECTED" ||
        k === "INTERNAL"
      ) {
        if (k === "CLASS" || k === "INTERFACE" || k === "OBJECT") return true;
        i++;
      } else {
        break;
      }
    }
    return false;
  }

  private isFunctionAhead(): boolean {
    let i = this.cur;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (
        k === "FUN" ||
        k === "SUSPEND" ||
        k === "OVERRIDE" ||
        k === "PUBLIC" ||
        k === "PRIVATE" ||
        k === "PROTECTED" ||
        k === "INTERNAL" ||
        k === "OPEN" ||
        k === "ABSTRACT"
      ) {
        if (k === "FUN") return true;
        i++;
      } else {
        break;
      }
    }
    return false;
  }

  private parseClassOrDataClass(): ClassDecl | TypeDecl {
    const startOffset = this.declStartOffset ?? this.current().offset;
    this.declStartOffset = null;
    const startTok = this.current();
    const modifiers: string[] = [];

    while (
      this.check("DATA") ||
      this.check("ENUM") ||
      this.check("SEALED") ||
      this.check("ABSTRACT") ||
      this.check("OPEN") ||
      this.check("PUBLIC") ||
      this.check("PRIVATE") ||
      this.check("PROTECTED") ||
      this.check("INTERNAL")
    ) {
      modifiers.push(this.advance().value);
    }

    const isData = modifiers.includes("data");
    const isEnum = modifiers.includes("enum");
    const isInterface = this.check("INTERFACE");
    const isObject = this.check("OBJECT");

    if (isInterface) {
      this.advance();
    } else if (isObject) {
      this.advance();
    } else {
      this.consume("CLASS");
    }

    const name = this.advance().value;
    const nodeId = isEnum ? `type:${name}` : `class:${name}`;
    this.attachTrivia(nodeId);

    // Save modifier trivia (e.g. data class or interface)
    if (isData) {
      this.trivia.setTrivia("is_data:" + name, {
        nodeId: "is_data:" + name,
        leading: [],
        trailing: [],
      });
    }

    // Type parameters: <T, R>
    const typeParams: string[] = [];
    if (this.check("LT")) {
      this.advance();
      while (!this.check("GT") && !this.check("EOF")) {
        typeParams.push(this.advance().value);
        if (this.check("COMMA")) this.advance();
      }
      this.consume("GT");
    }

    // Primary constructor parameters: (val a: String, var b: Int = 0)
    const primaryConstructor: ParamDecl[] = [];
    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.check("EOF")) {
        this.collectLeadingTrivia();
        if (this.check("RPAREN") || this.check("EOF")) break;

        let isMut = false;
        let isReadonly = false;
        if (this.check("VAL")) {
          this.advance();
          isReadonly = true;
        } else if (this.check("VAR")) {
          this.advance();
          isMut = true;
        }

        const paramName = this.advance().value;
        let typeAnn: TypeExpr | null = null;
        if (this.check("COLON")) {
          this.advance();
          typeAnn = this.parseTypeExpr();
        }

        let defaultValue: Expr | undefined;
        if (this.check("ASSIGN")) {
          this.advance();
          defaultValue = this.parseExpr();
        }

        const isOpt = typeAnn?.kind === "OptionType";
        primaryConstructor.push({
          name: paramName,
          typeAnnotation: typeAnn,
          defaultValue,
          isOptional: isOpt,
          isReadonly,
          isMut,
          span: emptySpan(this.filePath),
        });

        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");
    }

    // Heritage: : SuperClass(), Interface1
    let extendsName: string | undefined;
    const implementsList: string[] = [];

    if (this.check("COLON")) {
      this.advance();
      while (!this.check("LBRACE") && !this.check("EOF") && !this.check("SEMICOLON")) {
        let base = this.advance().value;
        if (this.check("LT")) {
          base += "<";
          this.advance();
          while (!this.check("GT") && !this.check("EOF")) {
            base += this.advance().value;
          }
          if (this.check("GT")) base += this.advance().value;
        }
        // If constructor call e.g. BaseClass()
        if (this.check("LPAREN")) {
          this.advance();
          while (!this.check("RPAREN") && !this.check("EOF")) {
            this.advance();
          }
          if (this.check("RPAREN")) this.advance();
          extendsName = base;
        } else {
          implementsList.push(base);
        }
        if (this.check("COMMA")) this.advance();
      }
    }

    // Enum handling
    if (isEnum) {
      this.consume("LBRACE");
      const variants: { name: string; span: Span }[] = [];
      while (!this.check("RBRACE") && !this.check("EOF") && !this.check("SEMICOLON")) {
        this.collectLeadingTrivia();
        if (this.check("RBRACE") || this.check("EOF") || this.check("SEMICOLON")) break;

        const vName = this.advance().value;
        // Skip any constructor args for enum e.g. UP(1)
        if (this.check("LPAREN")) {
          this.advance();
          while (!this.check("RPAREN") && !this.check("EOF")) this.advance();
          if (this.check("RPAREN")) this.advance();
        }
        variants.push({ name: vName, span: emptySpan(this.filePath) });
        if (this.check("COMMA")) this.advance();
      }
      if (this.check("SEMICOLON")) this.advance();
      // Skip anything else until RBRACE
      while (!this.check("RBRACE") && !this.check("EOF")) this.advance();
      const endTok = this.consume("RBRACE");

      return {
        kind: "TypeDecl",
        name,
        isEnum: true,
        typeParams,
        variants,
        span: this.makeSpan(startOffset, endTok.endOffset),
      };
    }

    // Body: { ... }
    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];

    if (this.check("LBRACE")) {
      this.advance();
      while (!this.check("RBRACE") && !this.check("EOF")) {
        this.collectLeadingTrivia();
        if (this.check("RBRACE") || this.check("EOF")) break;

        if (this.isFunctionAhead()) {
          methods.push(this.parseMethodDecl(name));
          continue;
        }

        if (this.check("VAL") || this.check("VAR")) {
          properties.push(this.parsePropertyDecl(name));
          continue;
        }

        if (this.check("INIT")) {
          this.advance();
          this.parseBlock();
          continue;
        }

        if (this.check("CONSTRUCTOR")) {
          this.advance();
          // Skip secondary constructor
          if (this.check("LPAREN")) {
            this.advance();
            while (!this.check("RPAREN") && !this.check("EOF")) this.advance();
            if (this.check("RPAREN")) this.advance();
          }
          if (this.check("COLON")) {
            this.advance();
            while (!this.check("LBRACE") && !this.check("EOF")) this.advance();
          }
          if (this.check("LBRACE")) {
            this.parseBlock();
          }
          continue;
        }

        if (this.check("COMPANION")) {
          this.advance();
          if (this.check("OBJECT")) this.advance();
          if (this.check("LBRACE")) this.parseBlock();
          continue;
        }

        this.advance();
      }
      this.consume("RBRACE");
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startOffset, endTok.endOffset);

    // If it's a data class with NO methods and NO extra properties, lower to TypeDecl for maximum AICE portability
    if (isData && methods.length === 0 && properties.length === 0) {
      return {
        kind: "TypeDecl",
        name,
        isEnum: false,
        typeParams,
        fields: primaryConstructor.map((p) => ({
          name: p.name,
          typeAnnotation: p.typeAnnotation ?? {
            kind: "NamedType",
            name: "Any",
            span: emptySpan(this.filePath),
          },
          defaultValue: p.defaultValue,
          isOptional: p.isOptional,
          span: p.span,
        })),
        span,
      };
    }

    return {
      kind: "ClassDecl",
      name,
      isExported: true,
      typeParams,
      primaryConstructor: primaryConstructor.length > 0 ? primaryConstructor : undefined,
      extends: extendsName,
      implements: implementsList.length > 0 ? implementsList : undefined,
      properties,
      methods,
      span,
    };
  }

  private parsePropertyDecl(className: string): PropertyDecl {
    const startTok = this.current();
    const isReadonly = this.check("VAL");
    this.advance(); // consume val / var

    const propName = this.advance().value;
    const nodeId = `prop:${className}.${propName}`;
    this.attachTrivia(nodeId);

    let typeAnn: TypeExpr | undefined;
    if (this.check("COLON")) {
      this.advance();
      typeAnn = this.parseTypeExpr();
    }

    let initialValue: Expr | undefined;
    if (this.check("ASSIGN")) {
      this.advance();
      initialValue = this.parseExpr();
    }
    if (this.check("SEMICOLON")) this.advance();

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startTok.offset, endTok.endOffset);

    return {
      kind: "PropertyDecl",
      name: propName,
      isStatic: false,
      isReadonly,
      isOptional: typeAnn?.kind === "OptionType",
      typeAnnotation: typeAnn,
      initialValue,
      span,
    };
  }

  private parseMethodDecl(className: string): MethodDecl {
    const startTok = this.current();
    let isAsync = false;

    while (
      this.check("SUSPEND") ||
      this.check("OVERRIDE") ||
      this.check("PUBLIC") ||
      this.check("PRIVATE") ||
      this.check("PROTECTED") ||
      this.check("INTERNAL") ||
      this.check("OPEN") ||
      this.check("ABSTRACT")
    ) {
      if (this.check("SUSPEND")) isAsync = true;
      this.advance();
    }

    this.consume("FUN");
    const methodName = this.advance().value;
    const nodeId = `method:${className}.${methodName}`;
    this.attachTrivia(nodeId);

    // Type parameters <T>
    const typeParams: string[] = [];
    if (this.check("LT")) {
      this.advance();
      while (!this.check("GT") && !this.check("EOF")) {
        typeParams.push(this.advance().value);
        if (this.check("COMMA")) this.advance();
      }
      this.consume("GT");
    }

    // Parameters: (a: Int, b: String = "hi")
    this.consume("LPAREN");
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RPAREN") || this.check("EOF")) break;

      const pName = this.advance().value;
      let pType: TypeExpr | null = null;
      if (this.check("COLON")) {
        this.advance();
        pType = this.parseTypeExpr();
      }

      let defVal: Expr | undefined;
      if (this.check("ASSIGN")) {
        this.advance();
        defVal = this.parseExpr();
      }

      params.push({
        name: pName,
        typeAnnotation: pType,
        defaultValue: defVal,
        isOptional: pType?.kind === "OptionType",
        span: emptySpan(this.filePath),
      });

      if (this.check("COMMA")) this.advance();
    }
    this.consume("RPAREN");

    // Return type
    let returnType: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    // Body: `= expr` or `{ statements... }` or empty (interface)
    let body: Block | Expr;
    let isExpressionBodied = false;

    if (this.check("ASSIGN")) {
      this.advance();
      isExpressionBodied = true;
      body = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
    } else if (this.check("LBRACE")) {
      body = this.parseBlock();
    } else {
      // Interface method without body
      body = { kind: "Block", statements: [], span: emptySpan(this.filePath) };
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startTok.offset, endTok.endOffset);

    return {
      kind: "MethodDecl",
      name: methodName,
      isStatic: false,
      isAsync,
      typeParams: typeParams.length > 0 ? typeParams : undefined,
      params,
      returnType,
      body,
      isExpressionBodied,
      span,
    };
  }

  private parseFunction(): FunctionDecl {
    const startOffset = this.declStartOffset ?? this.current().offset;
    this.declStartOffset = null;
    const startTok = this.current();
    let isAsync = false;

    while (
      this.check("SUSPEND") ||
      this.check("PUBLIC") ||
      this.check("PRIVATE") ||
      this.check("PROTECTED") ||
      this.check("INTERNAL")
    ) {
      if (this.check("SUSPEND")) isAsync = true;
      this.advance();
    }

    this.consume("FUN");
    const fnName = this.advance().value;
    const nodeId = `fn:${fnName}`;
    this.attachTrivia(nodeId);

    // Type params <T>
    const typeParams: string[] = [];
    if (this.check("LT")) {
      this.advance();
      while (!this.check("GT") && !this.check("EOF")) {
        typeParams.push(this.advance().value);
        if (this.check("COMMA")) this.advance();
      }
      this.consume("GT");
    }

    // Parameters
    this.consume("LPAREN");
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RPAREN") || this.check("EOF")) break;

      const pName = this.advance().value;
      let pType: TypeExpr | null = null;
      if (this.check("COLON")) {
        this.advance();
        pType = this.parseTypeExpr();
      }

      let defVal: Expr | undefined;
      if (this.check("ASSIGN")) {
        this.advance();
        defVal = this.parseExpr();
      }

      params.push({
        name: pName,
        typeAnnotation: pType,
        defaultValue: defVal,
        isOptional: pType?.kind === "OptionType",
        span: emptySpan(this.filePath),
      });

      if (this.check("COMMA")) this.advance();
    }
    this.consume("RPAREN");

    // Return type
    let returnType: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    let body: Block | Expr;
    let isExpressionBodied = false;

    if (this.check("ASSIGN")) {
      this.advance();
      isExpressionBodied = true;
      body = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
    } else if (this.check("LBRACE")) {
      body = this.parseBlock();
    } else {
      body = { kind: "Block", statements: [], span: emptySpan(this.filePath) };
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startOffset, endTok.endOffset);

    return {
      kind: "FunctionDecl",
      name: fnName,
      isExported: true,
      isAsync,
      typeParams: typeParams.length > 0 ? typeParams : undefined,
      params,
      returnType,
      body,
      isExpressionBodied,
      span,
    };
  }

  private parseTopLevelVar(): ConstDecl | VarDecl {
    const startOffset = this.declStartOffset ?? this.current().offset;
    this.declStartOffset = null;
    const startTok = this.current();
    let isConst = false;
    let isMut = false;

    if (this.check("CONST")) {
      isConst = true;
      this.advance();
    }
    if (this.check("VAL")) {
      this.advance();
      isConst = true;
    } else if (this.check("VAR")) {
      this.advance();
      isMut = true;
    }

    const varName = this.advance().value;
    const nodeId = isConst ? `const:${varName}` : `var:${varName}`;
    this.attachTrivia(nodeId);

    let typeAnn: TypeExpr | undefined;
    if (this.check("COLON")) {
      this.advance();
      typeAnn = this.parseTypeExpr();
    }

    this.consume("ASSIGN");
    const val = this.parseExpr();
    if (this.check("SEMICOLON")) this.advance();

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startOffset, endTok.endOffset);

    if (isConst) {
      return {
        kind: "ConstDecl",
        name: varName,
        isExported: true,
        typeAnnotation: typeAnn,
        value: val,
        span,
      };
    }

    return {
      kind: "VarDecl",
      name: varName,
      isExported: true,
      isMut,
      typeAnnotation: typeAnn,
      value: val,
      span,
    };
  }

  private parseTypealias(): TypeDecl {
    const startOffset = this.declStartOffset ?? this.current().offset;
    this.declStartOffset = null;
    const startTok = this.consume("TYPEALIAS");
    const name = this.advance().value;
    const nodeId = `type:${name}`;
    this.attachTrivia(nodeId);

    this.consume("ASSIGN");
    const aliasType = this.parseTypeExpr();
    if (this.check("SEMICOLON")) this.advance();

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    const span = this.makeSpan(startOffset, endTok.endOffset);

    return {
      kind: "TypeDecl",
      name,
      isEnum: false,
      typeParams: [],
      aliasType,
      span,
    };
  }

  private parseBlock(): Block {
    const startTok = this.consume("LBRACE");
    const statements: Statement[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;

      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
    }

    const endTok = this.consume("RBRACE");
    return {
      kind: "Block",
      statements,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseStatement(): Statement | null {
    if (this.check("SEMICOLON")) {
      this.advance();
      return null;
    }

    if (this.check("VAL") || this.check("VAR")) {
      return this.parseLetBinding();
    }

    if (this.check("RETURN")) {
      return this.parseReturn();
    }

    if (this.check("IF")) {
      return this.parseIf();
    }

    if (this.check("WHEN")) {
      return this.parseWhenStatement();
    }

    if (this.check("WHILE")) {
      return this.parseWhile();
    }

    if (this.check("FOR")) {
      return this.parseFor();
    }

    if (this.check("TRY")) {
      return this.parseTry();
    }

    if (this.check("THROW")) {
      const startTok = this.advance();
      const expr = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
      return {
        kind: "ThrowStmt",
        expr,
        span: this.makeSpan(startTok.offset, this.current().offset),
      };
    }

    if (this.check("BREAK")) {
      const startTok = this.advance();
      if (this.check("SEMICOLON")) this.advance();
      return { kind: "BreakStmt", span: this.makeSpan(startTok.offset, this.current().offset) };
    }

    if (this.check("CONTINUE")) {
      const startTok = this.advance();
      if (this.check("SEMICOLON")) this.advance();
      return { kind: "ContinueStmt", span: this.makeSpan(startTok.offset, this.current().offset) };
    }

    // Assignment or expression statement
    const expr = this.parseExpr();

    if (this.isAssignOp(this.current().kind)) {
      const opTok = this.advance();
      const op = this.toAssignOp(opTok.kind);
      const val = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
      return {
        kind: "AssignStmt",
        target: expr,
        op,
        value: val,
        span: emptySpan(this.filePath),
      };
    }

    if (this.check("SEMICOLON")) this.advance();
    return {
      kind: "ExprStmt",
      expr,
      span: emptySpan(this.filePath),
    };
  }

  private isAssignOp(k: KotlinTokenKind): boolean {
    return (
      k === "ASSIGN" ||
      k === "PLUS_ASSIGN" ||
      k === "MINUS_ASSIGN" ||
      k === "STAR_ASSIGN" ||
      k === "SLASH_ASSIGN" ||
      k === "PERCENT_ASSIGN"
    );
  }

  private toAssignOp(k: KotlinTokenKind): AssignOp {
    switch (k) {
      case "PLUS_ASSIGN":
        return "+=";
      case "MINUS_ASSIGN":
        return "-=";
      case "STAR_ASSIGN":
        return "*=";
      case "SLASH_ASSIGN":
        return "/=";
      case "PERCENT_ASSIGN":
        return "%=";
      case "ASSIGN":
      default:
        return "=";
    }
  }

  private parseLetBinding(): LetBinding {
    const startTok = this.current();
    const isMut = this.check("VAR");
    this.advance(); // val or var

    const name = this.advance().value;

    let typeAnn: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      typeAnn = this.parseTypeExpr();
    }

    this.consume("ASSIGN");
    const init = this.parseExpr();
    if (this.check("SEMICOLON")) this.advance();

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "LetBinding",
      name,
      isMut,
      typeAnnotation: typeAnn,
      init,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseReturn(): ReturnStmt {
    const startTok = this.consume("RETURN");
    if (this.check("SEMICOLON") || this.check("RBRACE") || this.check("EOF")) {
      if (this.check("SEMICOLON")) this.advance();
      return {
        kind: "ReturnStmt",
        value: null,
        span: this.makeSpan(startTok.offset, startTok.endOffset),
      };
    }

    const val = this.parseExpr();
    if (this.check("SEMICOLON")) this.advance();
    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "ReturnStmt",
      value: val,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseIf(): IfStmt {
    const startTok = this.consume("IF");
    this.consume("LPAREN");
    const condition = this.parseExpr();
    this.consume("RPAREN");

    let thenBranch: Block;
    if (this.check("LBRACE")) {
      thenBranch = this.parseBlock();
    } else {
      const single = this.parseStatement();
      thenBranch = {
        kind: "Block",
        statements: single ? [single] : [],
        span: emptySpan(this.filePath),
      };
    }

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
    let elseBranch: Block | null = null;

    while (this.check("ELSE")) {
      this.advance();
      if (this.check("IF")) {
        this.advance();
        this.consume("LPAREN");
        const elifCond = this.parseExpr();
        this.consume("RPAREN");
        let elifBody: Block;
        if (this.check("LBRACE")) {
          elifBody = this.parseBlock();
        } else {
          const s = this.parseStatement();
          elifBody = { kind: "Block", statements: s ? [s] : [], span: emptySpan(this.filePath) };
        }
        elifBranches.push({ condition: elifCond, body: elifBody, span: emptySpan(this.filePath) });
      } else {
        if (this.check("LBRACE")) {
          elseBranch = this.parseBlock();
        } else {
          const s = this.parseStatement();
          elseBranch = { kind: "Block", statements: s ? [s] : [], span: emptySpan(this.filePath) };
        }
        break;
      }
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseWhile(): WhileStmt {
    const startTok = this.consume("WHILE");
    this.consume("LPAREN");
    const condition = this.parseExpr();
    this.consume("RPAREN");

    let body: Block;
    if (this.check("LBRACE")) {
      body = this.parseBlock();
    } else {
      const s = this.parseStatement();
      body = { kind: "Block", statements: s ? [s] : [], span: emptySpan(this.filePath) };
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "WhileStmt",
      condition,
      body,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseFor(): ForStmt {
    const startTok = this.consume("FOR");
    this.consume("LPAREN");
    const variable = this.advance().value;
    this.consume("IN");
    const iterable = this.parseExpr();
    this.consume("RPAREN");

    let body: Block;
    if (this.check("LBRACE")) {
      body = this.parseBlock();
    } else {
      const s = this.parseStatement();
      body = { kind: "Block", statements: s ? [s] : [], span: emptySpan(this.filePath) };
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "ForStmt",
      variable,
      iterable,
      body,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseTry(): TryStmt {
    const startTok = this.consume("TRY");
    const tryBlock = this.parseBlock();

    let catchParam: string | undefined;
    let catchBlock: Block | undefined;
    let finallyBlock: Block | undefined;

    if (this.check("CATCH")) {
      this.advance();
      this.consume("LPAREN");
      catchParam = this.advance().value;
      if (this.check("COLON")) {
        this.advance();
        while (!this.check("RPAREN") && !this.check("EOF")) this.advance();
      }
      this.consume("RPAREN");
      catchBlock = this.parseBlock();
    }

    if (this.check("FINALLY")) {
      this.advance();
      finallyBlock = this.parseBlock();
    }

    const endTok = this.tokens[this.cur - 1] ?? startTok;
    return {
      kind: "TryStmt",
      tryBlock,
      catchParam,
      catchBlock,
      finallyBlock,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private parseWhenStatement(): MatchStmt {
    const startTok = this.consume("WHEN");
    let target: Expr;

    if (this.check("LPAREN")) {
      this.advance();
      target = this.parseExpr();
      this.consume("RPAREN");
    } else {
      // Argument-less when -> boolean true
      target = {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: true,
        rawValue: "true",
        span: emptySpan(this.filePath),
      };
    }

    this.consume("LBRACE");
    const cases: MatchCase[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;

      let pattern: Pattern;
      if (this.check("ELSE")) {
        this.advance();
        pattern = { kind: "WildcardPattern", span: emptySpan(this.filePath) };
      } else {
        const patExpr = this.parseExpr();
        if (patExpr.kind === "LiteralExpr") {
          pattern = { kind: "LiteralPattern", value: patExpr, span: patExpr.span };
        } else if (patExpr.kind === "IdentifierExpr") {
          pattern = { kind: "IdentifierPattern", name: patExpr.name, span: patExpr.span };
        } else {
          pattern = {
            kind: "IdentifierPattern",
            name: this.exprToString(patExpr),
            span: patExpr.span,
          };
        }
      }

      this.consume("ARROW");

      let caseBody: Block | Expr;
      if (this.check("LBRACE")) {
        caseBody = this.parseBlock();
      } else {
        // Can be a return or expression
        if (this.check("RETURN")) {
          const ret = this.parseReturn();
          caseBody = { kind: "Block", statements: [ret], span: emptySpan(this.filePath) };
        } else {
          caseBody = this.parseExpr();
        }
      }

      if (this.check("SEMICOLON") || this.check("COMMA")) {
        this.advance();
      }

      cases.push({
        pattern,
        body: caseBody,
        span: emptySpan(this.filePath),
      });
    }

    const endTok = this.consume("RBRACE");
    return {
      kind: "MatchStmt",
      target,
      cases,
      span: this.makeSpan(startTok.offset, endTok.endOffset),
    };
  }

  private exprToString(expr: Expr): string {
    if (expr.kind === "IdentifierExpr") return expr.name;
    if (expr.kind === "MemberAccessExpr")
      return `${this.exprToString(expr.object)}.${expr.property}`;
    if (expr.kind === "LiteralExpr") return String(expr.value);
    return "val";
  }

  // Pratt expression parser
  public parseExpr(precedence = Precedence.LOWEST): Expr {
    let left = this.parsePrefixExpr();

    while (precedence < this.getPrecedence(this.current().kind)) {
      left = this.parseInfixExpr(left);
    }

    return left;
  }

  private parsePrefixExpr(): Expr {
    const tok = this.current();

    if (tok.kind === "BANG") {
      this.advance();
      const operand = this.parseExpr(Precedence.PREFIX);
      return { kind: "UnaryExpr", operator: "!", operand, span: emptySpan(this.filePath) };
    }

    if (tok.kind === "MINUS") {
      this.advance();
      const operand = this.parseExpr(Precedence.PREFIX);
      return { kind: "UnaryExpr", operator: "-", operand, span: emptySpan(this.filePath) };
    }

    if (tok.kind === "PLUS") {
      this.advance();
      return this.parseExpr(Precedence.PREFIX);
    }

    if (tok.kind === "WHEN") {
      const matchStmt = this.parseWhenStatement();
      return {
        kind: "MatchExpr",
        target: matchStmt.target,
        cases: matchStmt.cases,
        span: matchStmt.span,
      } as unknown as Expr;
    }

    return this.parsePrimary();
  }

  private parsePrimary(): Expr {
    const tok = this.current();

    if (tok.kind === "NUMBER") {
      this.advance();
      const isFloat = tok.value.includes(".") || tok.value.endsWith("f") || tok.value.endsWith("F");
      const cleanNum = tok.value.replace(/[fFlLuU_]/g, "");
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: isFloat ? parseFloat(cleanNum) : parseInt(cleanNum, 10),
        rawValue: tok.value,
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "STRING") {
      this.advance();
      // Check for Kotlin string template interpolation: $name or ${expr}
      const raw = tok.value.slice(1, -1);
      if (raw.includes("$") && !raw.includes("\\$")) {
        return this.parseStringTemplate(raw, tok.offset, tok.endOffset);
      }

      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: raw,
        rawValue: tok.value,
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "CHAR") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value.slice(1, -1),
        rawValue: tok.value,
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "TRUE") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: true,
        rawValue: "true",
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "FALSE") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "boolean",
        value: false,
        rawValue: "false",
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "NULL") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "null",
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "IDENTIFIER" || tok.kind === "THIS" || tok.kind === "SUPER") {
      this.advance();
      return {
        kind: "IdentifierExpr",
        name: tok.value,
        span: this.makeSpan(tok.offset, tok.endOffset),
      };
    }

    if (tok.kind === "LPAREN") {
      this.advance();
      const expr = this.parseExpr();
      this.consume("RPAREN");
      return expr;
    }

    if (tok.kind === "LBRACKET") {
      // Array literal [1, 2, 3]
      this.advance();
      const elements: Expr[] = [];
      while (!this.check("RBRACKET") && !this.check("EOF")) {
        elements.push(this.parseExpr());
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RBRACKET");
      return {
        kind: "ArrayLiteralExpr",
        elements,
        span: emptySpan(this.filePath),
      };
    }

    // Fallback
    this.advance();
    return {
      kind: "IdentifierExpr",
      name: tok.value || "unknown",
      span: emptySpan(this.filePath),
    };
  }

  private parseStringTemplate(
    raw: string,
    startOffset: number,
    endOffset: number,
  ): TemplateLiteralExpr | LiteralExpr {
    const quasis: string[] = [];
    const expressions: Expr[] = [];

    let curIdx = 0;
    let currentQuasi = "";

    while (curIdx < raw.length) {
      const dollar = raw.indexOf("$", curIdx);
      if (dollar === -1) {
        currentQuasi += raw.slice(curIdx);
        break;
      }

      currentQuasi += raw.slice(curIdx, dollar);

      if (raw[dollar + 1] === "{") {
        const closeBrace = raw.indexOf("}", dollar + 2);
        if (closeBrace !== -1) {
          const exprStr = raw.slice(dollar + 2, closeBrace);
          const subLexer = new KotlinLexer(exprStr);
          const subDecomp = new KotlinDecompiler(exprStr, this.filePath);
          subDecomp.tokens = subLexer.tokenize();
          expressions.push(subDecomp.parseExpr());
          quasis.push(currentQuasi);
          currentQuasi = "";
          curIdx = closeBrace + 1;
          continue;
        }
      } else if (dollar + 1 < raw.length && /[a-zA-Z_]/.test(raw[dollar + 1])) {
        let endVar = dollar + 1;
        while (endVar < raw.length && /[a-zA-Z0-9_]/.test(raw[endVar])) {
          endVar++;
        }
        const varName = raw.slice(dollar + 1, endVar);
        expressions.push({
          kind: "IdentifierExpr",
          name: varName,
          span: emptySpan(this.filePath),
        });
        quasis.push(currentQuasi);
        currentQuasi = "";
        curIdx = endVar;
        continue;
      }

      // Literal $ character
      currentQuasi += "$";
      curIdx = dollar + 1;
    }

    quasis.push(currentQuasi);

    if (expressions.length === 0) {
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: quasis[0],
        rawValue: `"${quasis[0]}"`,
        span: this.makeSpan(startOffset, endOffset),
      };
    }

    return {
      kind: "TemplateLiteralExpr",
      quasis,
      expressions,
      span: this.makeSpan(startOffset, endOffset),
    };
  }

  private parseInfixExpr(left: Expr): Expr {
    const tok = this.current();

    // Call expressions: left(args)
    if (tok.kind === "LPAREN") {
      this.advance();
      const args: Expr[] = [];
      while (!this.check("RPAREN") && !this.check("EOF")) {
        args.push(this.parseExpr());
        if (this.check("COMMA")) this.advance();
      }
      this.consume("RPAREN");

      // Check for trailing lambda: foo(args) { ... }
      if (this.check("LBRACE")) {
        const lambdaBlock = this.parseBlock();
        // Pack as closure arg
        args.push({
          kind: "ClosureExpr",
          params: [],
          body: lambdaBlock,
          span: lambdaBlock.span,
        } as unknown as Expr);
      }

      // Check if this is listOf(...) or mapOf(...) or emptyList()
      if (left.kind === "IdentifierExpr") {
        if (left.name === "listOf") {
          return { kind: "ArrayLiteralExpr", elements: args, span: emptySpan(this.filePath) };
        }
        if (left.name === "emptyList") {
          return { kind: "ArrayLiteralExpr", elements: [], span: emptySpan(this.filePath) };
        }
        if (left.name === "mapOf") {
          const properties: { name: string; value: Expr; span: Span }[] = [];
          for (const a of args) {
            // Check if binary expr with "to" or similar
            if (a.kind === "BinaryExpr") {
              const k =
                a.left.kind === "LiteralExpr" ? String(a.left.value) : this.exprToString(a.left);
              properties.push({ name: k, value: a.right, span: emptySpan(this.filePath) });
            }
          }
          return { kind: "RecordLiteralExpr", properties, span: emptySpan(this.filePath) };
        }
      }

      return {
        kind: "CallExpr",
        callee: left,
        args,
        span: emptySpan(this.filePath),
      };
    }

    // Trailing lambda without parens: left { ... }
    if (tok.kind === "LBRACE") {
      const lambdaBlock = this.parseBlock();
      return {
        kind: "CallExpr",
        callee: left,
        args: [
          {
            kind: "ClosureExpr",
            params: [],
            body: lambdaBlock,
            span: lambdaBlock.span,
          } as unknown as Expr,
        ],
        span: emptySpan(this.filePath),
      };
    }

    // Index access: left[index]
    if (tok.kind === "LBRACKET") {
      this.advance();
      const index = this.parseExpr();
      this.consume("RBRACKET");
      return {
        kind: "IndexExpr",
        object: left,
        index,
        span: emptySpan(this.filePath),
      };
    }

    // Member access: left.prop or left?.prop
    if (tok.kind === "DOT" || tok.kind === "SAFE_DOT") {
      const isSafeNav = tok.kind === "SAFE_DOT";
      this.advance();
      const prop = this.advance().value;
      return {
        kind: "MemberAccessExpr",
        object: left,
        property: prop,
        isSafeNav,
        isOptional: isSafeNav,
        span: emptySpan(this.filePath),
      };
    }

    // Elvis operator: left ?: right
    if (tok.kind === "ELVIS") {
      this.advance();
      const right = this.parseExpr(Precedence.ELVIS);
      return {
        kind: "BinaryExpr",
        operator: "??",
        left,
        right,
        span: emptySpan(this.filePath),
      };
    }

    // Not-null assertion: left!!
    if (tok.kind === "DOUBLE_BANG") {
      this.advance();
      return left;
    }

    // Standard binary operators
    const prec = this.getPrecedence(tok.kind);
    const op = this.toBinaryOp(tok.kind);
    this.advance();
    const right = this.parseExpr(prec);

    return {
      kind: "BinaryExpr",
      operator: op,
      left,
      right,
      span: emptySpan(this.filePath),
    };
  }

  private getPrecedence(k: KotlinTokenKind): Precedence {
    switch (k) {
      case "ELVIS":
        return Precedence.ELVIS;
      case "OR_OR":
        return Precedence.LOGICAL_OR;
      case "AND_AND":
        return Precedence.LOGICAL_AND;
      case "EQ":
      case "NE":
      case "EQ_EXACT":
      case "NE_EXACT":
        return Precedence.EQUALITY;
      case "LT":
      case "LE":
      case "GT":
      case "GE":
      case "IN":
      case "NOT_IN":
      case "IS":
      case "NOT_IS":
        return Precedence.COMPARISON;
      case "RANGE":
        return Precedence.RANGE;
      case "PLUS":
      case "MINUS":
        return Precedence.ADDITIVE;
      case "STAR":
      case "SLASH":
      case "PERCENT":
        return Precedence.MULTIPLICATIVE;
      case "DOUBLE_BANG":
        return Precedence.POSTFIX;
      case "LPAREN":
      case "LBRACKET":
      case "DOT":
      case "SAFE_DOT":
      case "LBRACE":
        return Precedence.CALL;
      default:
        return Precedence.LOWEST;
    }
  }

  private toBinaryOp(k: KotlinTokenKind): BinaryOp {
    switch (k) {
      case "PLUS":
        return "+";
      case "MINUS":
        return "-";
      case "STAR":
        return "*";
      case "SLASH":
        return "/";
      case "PERCENT":
        return "%";
      case "EQ":
      case "EQ_EXACT":
        return "==";
      case "NE":
      case "NE_EXACT":
        return "!=";
      case "LT":
        return "<";
      case "LE":
        return "<=";
      case "GT":
        return ">";
      case "GE":
        return ">=";
      case "AND_AND":
        return "&&";
      case "OR_OR":
        return "||";
      case "ELVIS":
        return "??";
      case "IS":
        return "instanceof";
      case "IN":
        return "in";
      default:
        return "+";
    }
  }

  public parseTypeExpr(): TypeExpr {
    const baseName = this.advance().value;

    // Handle generic type arguments: List<String> or Map<String, Int>
    const typeArgs: TypeExpr[] = [];
    if (this.check("LT")) {
      this.advance();
      while (!this.check("GT") && !this.check("EOF")) {
        typeArgs.push(this.parseTypeExpr());
        if (this.check("COMMA")) this.advance();
      }
      this.consume("GT");
    }

    let result: TypeExpr;

    switch (baseName) {
      case "Int":
      case "Short":
      case "Byte":
        result = { kind: "PrimitiveType", primitive: "int", span: emptySpan(this.filePath) };
        break;
      case "Long":
        result = { kind: "PrimitiveType", primitive: "int", span: emptySpan(this.filePath) };
        break;
      case "Float":
      case "Double":
        result = { kind: "PrimitiveType", primitive: "float", span: emptySpan(this.filePath) };
        break;
      case "String":
      case "CharSequence":
        result = { kind: "PrimitiveType", primitive: "str", span: emptySpan(this.filePath) };
        break;
      case "Boolean":
        result = { kind: "PrimitiveType", primitive: "bool", span: emptySpan(this.filePath) };
        break;
      case "Unit":
      case "Nothing":
        result = { kind: "PrimitiveType", primitive: "void", span: emptySpan(this.filePath) };
        break;
      case "List":
      case "ArrayList":
      case "Array":
      case "Set":
      case "Iterable":
        result = {
          kind: "ArrayType",
          elementType: typeArgs[0] ?? {
            kind: "NamedType",
            name: "Any",
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        };
        break;
      case "Result":
        result = {
          kind: "ResultType",
          okType: typeArgs[0] ?? { kind: "NamedType", name: "Any", span: emptySpan(this.filePath) },
          errType: typeArgs[1] ?? {
            kind: "NamedType",
            name: "Throwable",
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        };
        break;
      default:
        result = {
          kind: "NamedType",
          name: baseName,
          typeArgs: typeArgs.length > 0 ? typeArgs : undefined,
          span: emptySpan(this.filePath),
        };
        break;
    }

    // Check for nullable type: T?
    if (this.check("QUESTION")) {
      this.advance();
      result = {
        kind: "OptionType",
        innerType: result,
        span: emptySpan(this.filePath),
      };
    }

    return result;
  }

  private makeSpan(startOffset: number, endOffset: number): Span {
    return {
      file: this.filePath,
      start: { line: 1, column: 1, offset: startOffset },
      end: { line: 1, column: 1, offset: endOffset },
    };
  }
}

export function decompileKotlin(
  source: string,
  filePath = "source.kt",
  options: AiceGeneratorOptions = {},
): { ast: Module; aice: string; trivia: CstTriviaTable } {
  const decompiler = new KotlinDecompiler(source, filePath);
  const { ast, trivia } = decompiler.decompile();
  trivia.setOriginalSource(source);

  const generator = new AiceGenerator({ ...options, trivia });
  const aice = generator.generate(ast);

  return { ast, aice, trivia };
}
