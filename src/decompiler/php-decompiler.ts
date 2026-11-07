/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Modern PHP 8.x Decompiler (Reverse Transpiler) for AICE 2.0.
 * Dedicated zero-dependency lexer and recursive-descent/Pratt parser for PHP 8.x:
 *   - Strips `<?php` and `declare(strict_types=1);`
 *   - Parses namespaces and use statements into Module metadata and ImportDecl
 *   - Recognizes classes, interfaces, enums, functions, methods, constructors
 *   - Parses constructor property promotions into primary constructors
 *   - Parses match expressions into MatchStmt with MatchCase branches
 *   - Parses types (int -> int, string -> str, float -> float, bool -> bool, ?T -> T?, array -> [any])
 *   - Extracts comments into CstTriviaTable (docblocks /** ... * / and line comments //)
 *   - Lowers into canonical AICE AST Module
 */

import type {
  AssignOp,
  BinaryOp,
  Block,
  ClassDecl,
  Expr,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  MatchCase,
  MatchStmt,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PropertyDecl,
  Statement,
  TypeDecl,
  TypeExpr,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";

export interface MatchExpr {
  kind: "MatchExpr";
  target: Expr;
  cases: MatchCase[];
  span: Span;
}

export type PhpTokenKind =
  | "OPEN_TAG"
  | "CLOSE_TAG"
  | "DECLARE"
  | "STRICT_TYPES"
  | "NAMESPACE"
  | "USE"
  | "AS"
  | "CLASS"
  | "INTERFACE"
  | "ENUM"
  | "TRAIT"
  | "EXTENDS"
  | "IMPLEMENTS"
  | "PUBLIC"
  | "PROTECTED"
  | "PRIVATE"
  | "READONLY"
  | "STATIC"
  | "FINAL"
  | "ABSTRACT"
  | "FUNCTION"
  | "FN"
  | "RETURN"
  | "IF"
  | "ELSEIF"
  | "ELSE"
  | "WHILE"
  | "FOR"
  | "FOREACH"
  | "MATCH"
  | "DEFAULT"
  | "CASE"
  | "TRY"
  | "CATCH"
  | "FINALLY"
  | "THROW"
  | "NEW"
  | "ISSET"
  | "UNSET"
  | "VARIABLE"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "ARROW"
  | "NULLSAFE_ARROW"
  | "DOUBLE_ARROW"
  | "DOUBLE_COLON"
  | "COALESCE"
  | "COALESCE_ASSIGN"
  | "EQ_EXACT"
  | "NE_EXACT"
  | "EQ"
  | "NE"
  | "SPACESHIP"
  | "LE"
  | "GE"
  | "LT"
  | "GT"
  | "ASSIGN"
  | "PLUS_ASSIGN"
  | "MINUS_ASSIGN"
  | "STAR_ASSIGN"
  | "SLASH_ASSIGN"
  | "DOT_ASSIGN"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "STAR_STAR"
  | "DOT"
  | "AND"
  | "OR"
  | "NOT"
  | "AMPERSAND"
  | "PIPE"
  | "CARET"
  | "TILDE"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "SEMICOLON"
  | "COLON"
  | "QUESTION"
  | "BACKSLASH"
  | "COMMENT"
  | "DOC_COMMENT"
  | "EOF";

export interface PhpToken {
  kind: PhpTokenKind;
  value: string;
  line: number;
  col: number;
}

class PhpLexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): PhpToken[] {
    const tokens: PhpToken[] = [];

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];

      // Skip whitespace
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

      // Open tag <?php
      if (this.src.startsWith("<?php", this.pos)) {
        tokens.push(this.makeToken("OPEN_TAG", "<?php"));
        this.pos += 5;
        this.col += 5;
        continue;
      }

      // Close tag ?>
      if (this.src.startsWith("?>", this.pos)) {
        tokens.push(this.makeToken("CLOSE_TAG", "?>"));
        this.pos += 2;
        this.col += 2;
        continue;
      }

      // Comments: //, #, /* ... */, /** ... */
      if (this.src.startsWith("/**", this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const endIdx = this.src.indexOf("*/", this.pos + 3);
        const comment =
          endIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, endIdx + 2);
        this.advanceChars(comment);
        tokens.push({
          kind: "DOC_COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
        });
        continue;
      }

      if (this.src.startsWith("/*", this.pos)) {
        const startLine = this.line;
        const startCol = this.col;
        const endIdx = this.src.indexOf("*/", this.pos + 2);
        const comment =
          endIdx === -1 ? this.src.slice(this.pos) : this.src.slice(this.pos, endIdx + 2);
        this.advanceChars(comment);
        tokens.push({
          kind: "COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
        });
        continue;
      }

      if (this.src.startsWith("//", this.pos) || ch === "#") {
        const startLine = this.line;
        const startCol = this.col;
        let lineEnd = this.src.indexOf("\n", this.pos);
        if (lineEnd === -1) lineEnd = this.src.length;
        const comment = this.src.slice(this.pos, lineEnd);
        this.advanceChars(comment);
        tokens.push({
          kind: "COMMENT",
          value: comment,
          line: startLine,
          col: startCol,
        });
        continue;
      }

      // Variables ($name)
      if (ch === "$") {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // consume $
        let varName = "";
        while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) {
          varName += this.advance();
        }
        tokens.push({
          kind: "VARIABLE",
          value: varName,
          line: startLine,
          col: startCol,
        });
        continue;
      }

      // Strings ('...' or "...")
      if (ch === "'" || ch === '"') {
        tokens.push(this.scanString(ch));
        continue;
      }

      // Numbers (decimal, float, hex)
      if (/[0-9]/.test(ch)) {
        tokens.push(this.scanNumber());
        continue;
      }

      // Multi-char operators
      if (this.src.startsWith("?->", this.pos)) {
        tokens.push(this.consumeOp("NULLSAFE_ARROW", 3));
        continue;
      }
      if (this.src.startsWith("->", this.pos)) {
        tokens.push(this.consumeOp("ARROW", 2));
        continue;
      }
      if (this.src.startsWith("=>", this.pos)) {
        tokens.push(this.consumeOp("DOUBLE_ARROW", 2));
        continue;
      }
      if (this.src.startsWith("::", this.pos)) {
        tokens.push(this.consumeOp("DOUBLE_COLON", 2));
        continue;
      }
      if (this.src.startsWith("??=", this.pos)) {
        tokens.push(this.consumeOp("COALESCE_ASSIGN", 3));
        continue;
      }
      if (this.src.startsWith("??", this.pos)) {
        tokens.push(this.consumeOp("COALESCE", 2));
        continue;
      }
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
      if (this.src.startsWith("<=>", this.pos)) {
        tokens.push(this.consumeOp("SPACESHIP", 3));
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
      if (this.src.startsWith(".=", this.pos)) {
        tokens.push(this.consumeOp("DOT_ASSIGN", 2));
        continue;
      }
      if (this.src.startsWith("**", this.pos)) {
        tokens.push(this.consumeOp("STAR_STAR", 2));
        continue;
      }
      if (this.src.startsWith("&&", this.pos)) {
        tokens.push(this.consumeOp("AND", 2));
        continue;
      }
      if (this.src.startsWith("||", this.pos)) {
        tokens.push(this.consumeOp("OR", 2));
        continue;
      }

      // Single char punctuation
      const singlePunctMap: Record<string, PhpTokenKind> = {
        "{": "LBRACE",
        "}": "RBRACE",
        "(": "LPAREN",
        ")": "RPAREN",
        "[": "LBRACKET",
        "]": "RBRACKET",
        ";": "SEMICOLON",
        ",": "COMMA",
        ":": "COLON",
        "?": "QUESTION",
        ".": "DOT",
        "+": "PLUS",
        "-": "MINUS",
        "*": "STAR",
        "/": "SLASH",
        "%": "PERCENT",
        "=": "ASSIGN",
        "<": "LT",
        ">": "GT",
        "!": "NOT",
        "&": "AMPERSAND",
        "|": "PIPE",
        "^": "CARET",
        "~": "TILDE",
        "\\": "BACKSLASH",
      };

      if (singlePunctMap[ch]) {
        tokens.push(this.consumeOp(singlePunctMap[ch], 1));
        continue;
      }

      // Identifiers and Keywords
      if (/[a-zA-Z_\x7f-\xff]/.test(ch)) {
        tokens.push(this.scanIdentifier());
        continue;
      }

      // Unknown character, skip
      this.advance();
    }

    tokens.push({ kind: "EOF", value: "", line: this.line, col: this.col });
    return tokens;
  }

  private advance(): string {
    const ch = this.src[this.pos++];
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

  private makeToken(kind: PhpTokenKind, val: string): PhpToken {
    return { kind, value: val, line: this.line, col: this.col };
  }

  private consumeOp(kind: PhpTokenKind, len: number): PhpToken {
    const tok = {
      kind,
      value: this.src.slice(this.pos, this.pos + len),
      line: this.line,
      col: this.col,
    };
    this.pos += len;
    this.col += len;
    return tok;
  }

  private scanString(quote: string): PhpToken {
    const startLine = this.line;
    const startCol = this.col;
    this.advance(); // consume opening quote
    let val = "";

    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];
      if (ch === "\\") {
        this.advance();
        if (this.pos < this.src.length) {
          const esc = this.advance();
          if (esc === "n") val += "\n";
          else if (esc === "t") val += "\t";
          else if (esc === "r") val += "\r";
          else val += esc;
        }
        continue;
      }
      if (ch === quote) {
        this.advance(); // consume closing quote
        break;
      }
      val += this.advance();
    }

    return { kind: "STRING", value: val, line: startLine, col: startCol };
  }

  private scanNumber(): PhpToken {
    const startLine = this.line;
    const startCol = this.col;
    let numStr = "";

    while (this.pos < this.src.length && /[0-9a-fA-FxXbBoO._]/.test(this.src[this.pos])) {
      const c = this.src[this.pos];
      if (c === "." && this.src.startsWith("..", this.pos)) {
        break; // don't consume ellipsis
      }
      numStr += this.advance();
    }

    return { kind: "NUMBER", value: numStr, line: startLine, col: startCol };
  }

  private scanIdentifier(): PhpToken {
    const startLine = this.line;
    const startCol = this.col;
    let ident = "";

    while (this.pos < this.src.length && /[a-zA-Z0-9_\x7f-\xff]/.test(this.src[this.pos])) {
      ident += this.advance();
    }

    const lower = ident.toLowerCase();
    const keywordMap: Record<string, PhpTokenKind> = {
      declare: "DECLARE",
      strict_types: "STRICT_TYPES",
      namespace: "NAMESPACE",
      use: "USE",
      as: "AS",
      class: "CLASS",
      interface: "INTERFACE",
      enum: "ENUM",
      trait: "TRAIT",
      extends: "EXTENDS",
      implements: "IMPLEMENTS",
      public: "PUBLIC",
      protected: "PROTECTED",
      private: "PRIVATE",
      readonly: "READONLY",
      static: "STATIC",
      final: "FINAL",
      abstract: "ABSTRACT",
      function: "FUNCTION",
      fn: "FN",
      return: "RETURN",
      if: "IF",
      elseif: "ELSEIF",
      else: "ELSE",
      while: "WHILE",
      for: "FOR",
      foreach: "FOREACH",
      match: "MATCH",
      default: "DEFAULT",
      case: "CASE",
      try: "TRY",
      catch: "CATCH",
      finally: "FINALLY",
      throw: "THROW",
      new: "NEW",
      isset: "ISSET",
      unset: "UNSET",
    };

    if (keywordMap[lower]) {
      return { kind: keywordMap[lower], value: ident, line: startLine, col: startCol };
    }

    return { kind: "IDENTIFIER", value: ident, line: startLine, col: startCol };
  }
}

export class PhpDecompiler {
  private source: string;
  private filePath: string;
  private tokens: PhpToken[] = [];
  private cur = 0;
  private trivia: CstTriviaTable;
  private pendingTrivia: TriviaItem[] = [];
  private declaredVars = new Set<string>();

  constructor(source: string, filePath = "source.php") {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const lexer = new PhpLexer(this.source);
    const allTokens = lexer.tokenize();
    this.tokens = allTokens;
    this.cur = 0;
    this.pendingTrivia = [];
    const items: ModuleItem[] = [];

    // Skip <?php tag
    this.collectLeadingTrivia();
    if (this.check("OPEN_TAG")) {
      this.advance();
    }

    // Skip declare(strict_types=1);
    this.collectLeadingTrivia();
    if (this.check("DECLARE")) {
      this.advance();
      if (this.check("LPAREN")) this.advance();
      while (!this.check("RPAREN") && !this.check("EOF")) {
        this.advance();
      }
      if (this.check("RPAREN")) this.advance();
      if (this.check("SEMICOLON")) this.advance();
    }

    // Parse namespace if present
    this.collectLeadingTrivia();
    if (this.check("NAMESPACE")) {
      this.advance();
      let ns = "";
      while (!this.check("SEMICOLON") && !this.check("LBRACE") && !this.check("EOF")) {
        ns += this.advance().value;
      }
      if (this.check("SEMICOLON")) this.advance();
      // Store namespace in trivia table for lossless roundtrip
      this.trivia.setTrivia("mod:namespace", {
        nodeId: "mod:namespace",
        leading: [{ kind: "LINE_COMMENT", content: ns }],
        trailing: [],
      });
    }

    // Parse top-level declarations
    while (!this.check("EOF") && !this.check("CLOSE_TAG")) {
      this.collectLeadingTrivia();
      if (this.check("EOF") || this.check("CLOSE_TAG")) break;

      if (this.check("USE")) {
        items.push(this.parseUseStatement());
        continue;
      }
      if (this.check("CLASS") || this.isClassModifierAhead()) {
        items.push(this.parseClassDecl());
        continue;
      }
      if (this.check("INTERFACE")) {
        items.push(this.parseInterfaceDecl());
        continue;
      }
      if (this.check("ENUM")) {
        items.push(this.parseEnumDecl());
        continue;
      }
      if (this.check("FUNCTION")) {
        items.push(this.parseFunctionDecl());
        continue;
      }

      // Unexpected token, skip to avoid infinite loop
      this.advance();
    }

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.(php|aice)$/i, "") || "main";

    const ast: Module = {
      kind: "Module",
      path: baseName,
      items,
      span: emptySpan(this.filePath),
    };

    return { ast, trivia: this.trivia };
  }

  private current(): PhpToken {
    return this.tokens[this.cur] ?? { kind: "EOF", value: "", line: 1, col: 1 };
  }

  private check(kind: PhpTokenKind): boolean {
    return this.current().kind === kind;
  }

  private advance(): PhpToken {
    const tok = this.current();
    if (this.cur < this.tokens.length) {
      this.cur++;
    }
    return tok;
  }

  private consume(kind: PhpTokenKind, errMsg?: string): PhpToken {
    if (this.check(kind)) {
      return this.advance();
    }
    return { kind, value: "", line: this.current().line, col: this.current().col };
  }

  private collectLeadingTrivia(): void {
    while (this.check("COMMENT") || this.check("DOC_COMMENT")) {
      const tok = this.advance();
      this.pendingTrivia.push({
        kind: tok.kind === "DOC_COMMENT" ? "DOCSTRING" : "LINE_COMMENT",
        content: tok.value,
      });
    }
  }

  private attachTrivia(nodeId: string): void {
    if (this.pendingTrivia.length > 0) {
      this.trivia.setTrivia(nodeId, {
        nodeId,
        leading: [...this.pendingTrivia],
        trailing: [],
      });
      this.pendingTrivia = [];
    }
  }

  private parseUseStatement(): ImportDecl {
    this.advance(); // consume use
    let source = "";
    while (!this.check("SEMICOLON") && !this.check("AS") && !this.check("EOF")) {
      const tok = this.advance();
      if (tok.value === "\\") {
        source += "/";
      } else {
        source += tok.value;
      }
    }

    let alias: string | undefined;
    if (this.check("AS")) {
      this.advance();
      alias = this.advance().value;
    }
    if (this.check("SEMICOLON")) this.advance();

    const parts = source.split("/");
    const importedName = parts[parts.length - 1];

    return {
      kind: "ImportDecl",
      source,
      specifiers: [
        {
          name: importedName,
          alias,
          span: emptySpan(this.filePath),
        },
      ],
      span: emptySpan(this.filePath),
    };
  }

  private isClassModifierAhead(): boolean {
    let i = this.cur;
    while (
      i < this.tokens.length &&
      (this.tokens[i].kind === "COMMENT" || this.tokens[i].kind === "DOC_COMMENT")
    ) {
      i++;
    }
    const k = this.tokens[i]?.kind;
    return (
      (k === "ABSTRACT" || k === "FINAL" || k === "READONLY") &&
      (this.tokens[i + 1]?.kind === "CLASS" || this.tokens[i + 2]?.kind === "CLASS")
    );
  }

  private parseClassDecl(): ClassDecl {
    while (
      this.check("ABSTRACT") ||
      this.check("FINAL") ||
      this.check("READONLY") ||
      this.check("PUBLIC")
    ) {
      this.advance();
    }

    this.consume("CLASS");
    const name = this.advance().value;
    const nodeId = `class:${name}`;
    this.attachTrivia(nodeId);

    let extendsName: string | undefined;
    if (this.check("EXTENDS")) {
      this.advance();
      extendsName = this.advance().value;
    }

    const implementsList: string[] = [];
    if (this.check("IMPLEMENTS")) {
      this.advance();
      while (!this.check("LBRACE") && !this.check("EOF")) {
        const iface = this.advance().value;
        if (iface && iface !== ",") implementsList.push(iface);
      }
    }

    this.consume("LBRACE");

    const properties: PropertyDecl[] = [];
    const methods: MethodDecl[] = [];
    let primaryConstructor: ParamDecl[] | undefined;

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;

      // Check for constructor
      if (this.isMethodAhead()) {
        const method = this.parseMethodDecl(name);
        if (method.name === "__construct" && method.params.some((p) => p.isPub !== undefined)) {
          primaryConstructor = method.params;
        } else {
          methods.push(method);
        }
        continue;
      }

      // Check for property
      if (this.isPropertyAhead()) {
        properties.push(this.parsePropertyDecl(name));
        continue;
      }

      this.advance();
    }

    this.consume("RBRACE");

    return {
      kind: "ClassDecl",
      name,
      isExported: true,
      typeParams: [],
      primaryConstructor,
      extends: extendsName,
      implements: implementsList.length > 0 ? implementsList : undefined,
      properties,
      methods,
      span: emptySpan(this.filePath),
    };
  }

  private parseInterfaceDecl(): ClassDecl {
    this.consume("INTERFACE");
    const name = this.advance().value;
    const nodeId = `class:${name}`;
    this.attachTrivia(nodeId);

    const extendsList: string[] = [];
    if (this.check("EXTENDS")) {
      this.advance();
      while (!this.check("LBRACE") && !this.check("EOF")) {
        const iface = this.advance().value;
        if (iface && iface !== ",") extendsList.push(iface);
      }
    }

    this.consume("LBRACE");
    const methods: MethodDecl[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;
      if (this.isMethodAhead()) {
        methods.push(this.parseMethodDecl(name, true));
        continue;
      }
      this.advance();
    }

    this.consume("RBRACE");

    return {
      kind: "ClassDecl",
      name,
      isExported: true,
      typeParams: [],
      implements: extendsList.length > 0 ? extendsList : undefined,
      properties: [],
      methods,
      span: emptySpan(this.filePath),
    };
  }

  private parseEnumDecl(): TypeDecl {
    this.consume("ENUM");
    const name = this.advance().value;
    const nodeId = `type:${name}`;
    this.attachTrivia(nodeId);

    let backingType = "string";
    if (this.check("COLON")) {
      this.advance();
      backingType = this.advance().value;
    }

    this.trivia.setTrivia(`enum_backing:${name}`, {
      nodeId: `enum_backing:${name}`,
      leading: [{ kind: "LINE_COMMENT", content: backingType }],
      trailing: [],
    });

    this.consume("LBRACE");

    const variants: { name: string; span: Span }[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;
      if (this.check("CASE")) {
        this.advance();
        const caseName = this.advance().value;
        const caseNodeId = `case:${name}.${caseName}`;
        this.attachTrivia(caseNodeId);

        let caseVal: string | undefined;
        if (this.check("ASSIGN")) {
          this.advance();
          const valTok = this.advance();
          caseVal = valTok.kind === "STRING" ? `'${valTok.value}'` : valTok.value;
        }

        if (caseVal) {
          this.trivia.setTrivia(`case_val:${name}.${caseName}`, {
            nodeId: `case_val:${name}.${caseName}`,
            leading: [{ kind: "LINE_COMMENT", content: caseVal }],
            trailing: [],
          });
        }

        if (this.check("SEMICOLON")) this.advance();
        variants.push({ name: caseName, span: emptySpan(this.filePath) });
        continue;
      }

      // Skip any methods inside enum
      this.advance();
    }

    this.consume("RBRACE");

    return {
      kind: "TypeDecl",
      name,
      isEnum: true,
      typeParams: [],
      variants,
      span: emptySpan(this.filePath),
    };
  }

  private isPropertyAhead(): boolean {
    let i = this.cur;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (k === "COMMENT" || k === "DOC_COMMENT") {
        i++;
        continue;
      }
      if (
        k === "PUBLIC" ||
        k === "PROTECTED" ||
        k === "PRIVATE" ||
        k === "STATIC" ||
        k === "READONLY"
      ) {
        i++;
        continue;
      }
      if (k === "FUNCTION") return false;
      if (k === "VARIABLE") return true;
      if (k === "IDENTIFIER" || k === "QUESTION") {
        i++;
        continue;
      }
      return false;
    }
    return false;
  }

  private parsePropertyDecl(className: string): PropertyDecl {
    let isStatic = false;
    let isReadonly = false;

    while (
      this.check("PUBLIC") ||
      this.check("PROTECTED") ||
      this.check("PRIVATE") ||
      this.check("STATIC") ||
      this.check("READONLY")
    ) {
      const k = this.advance().kind;
      if (k === "STATIC") isStatic = true;
      if (k === "READONLY") isReadonly = true;
    }

    let typeAnnotation: TypeExpr | undefined;
    if (!this.check("VARIABLE")) {
      typeAnnotation = this.parseTypeExpr();
    }

    const varTok = this.consume("VARIABLE");
    const propName = varTok.value;
    const nodeId = `field:${className}.${propName}`;
    this.attachTrivia(nodeId);

    let initialValue: Expr | undefined;
    if (this.check("ASSIGN")) {
      this.advance();
      initialValue = this.parseExpr();
    }

    if (this.check("SEMICOLON")) this.advance();

    return {
      kind: "PropertyDecl",
      name: propName,
      isStatic,
      isReadonly,
      typeAnnotation,
      initialValue,
      span: emptySpan(this.filePath),
    };
  }

  private isMethodAhead(): boolean {
    let i = this.cur;
    while (i < this.tokens.length) {
      const k = this.tokens[i].kind;
      if (k === "COMMENT" || k === "DOC_COMMENT") {
        i++;
        continue;
      }
      if (
        k === "PUBLIC" ||
        k === "PROTECTED" ||
        k === "PRIVATE" ||
        k === "STATIC" ||
        k === "FINAL" ||
        k === "ABSTRACT"
      ) {
        i++;
        continue;
      }
      return k === "FUNCTION";
    }
    return false;
  }

  private parseMethodDecl(className: string, isInterface = false): MethodDecl {
    let isStatic = false;

    while (
      this.check("PUBLIC") ||
      this.check("PROTECTED") ||
      this.check("PRIVATE") ||
      this.check("STATIC") ||
      this.check("FINAL") ||
      this.check("ABSTRACT")
    ) {
      if (this.advance().kind === "STATIC") isStatic = true;
    }

    this.consume("FUNCTION");
    const methodName = this.advance().value;
    const nodeId = `method:${className}.${methodName}`;
    this.attachTrivia(nodeId);

    this.consume("LPAREN");
    const params = this.parseParamList();
    this.consume("RPAREN");

    let returnType: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    if (isInterface || this.check("SEMICOLON")) {
      if (this.check("SEMICOLON")) this.advance();
      return {
        kind: "MethodDecl",
        name: methodName,
        isStatic,
        isAsync: false,
        params,
        returnType,
        body: { kind: "Block", statements: [], span: emptySpan(this.filePath) },
        isExpressionBodied: false,
        span: emptySpan(this.filePath),
      };
    }

    const prevVars = this.declaredVars;
    this.declaredVars = new Set(params.map((p) => p.name));
    const body = this.parseBlock();
    this.declaredVars = prevVars;

    return {
      kind: "MethodDecl",
      name: methodName,
      isStatic,
      isAsync: false,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: emptySpan(this.filePath),
    };
  }

  private parseFunctionDecl(): FunctionDecl {
    this.consume("FUNCTION");
    const name = this.advance().value;
    const nodeId = `fn:${name}`;
    this.attachTrivia(nodeId);

    this.consume("LPAREN");
    const params = this.parseParamList();
    this.consume("RPAREN");

    let returnType: TypeExpr | null = null;
    if (this.check("COLON")) {
      this.advance();
      returnType = this.parseTypeExpr();
    }

    const prevVars = this.declaredVars;
    this.declaredVars = new Set(params.map((p) => p.name));
    const body = this.parseBlock();
    this.declaredVars = prevVars;

    return {
      kind: "FunctionDecl",
      name,
      isExported: true,
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: emptySpan(this.filePath),
    };
  }

  private parseParamList(): ParamDecl[] {
    const params: ParamDecl[] = [];

    while (!this.check("RPAREN") && !this.check("EOF")) {
      let isPub: boolean | undefined;
      let isReadonly = false;

      // Constructor promotion modifiers
      while (
        this.check("PUBLIC") ||
        this.check("PROTECTED") ||
        this.check("PRIVATE") ||
        this.check("READONLY")
      ) {
        const k = this.advance().kind;
        if (k === "PUBLIC") isPub = true;
        if (k === "PROTECTED" || k === "PRIVATE") isPub = false;
        if (k === "READONLY") isReadonly = true;
      }

      let typeAnnotation: TypeExpr | null = null;
      if (!this.check("VARIABLE")) {
        typeAnnotation = this.parseTypeExpr();
      }

      const varTok = this.consume("VARIABLE");
      let defaultValue: Expr | undefined;

      if (this.check("ASSIGN")) {
        this.advance();
        defaultValue = this.parseExpr();
      }

      params.push({
        name: varTok.value,
        typeAnnotation,
        defaultValue,
        isPub,
        isReadonly,
        span: emptySpan(this.filePath),
      });

      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }

    return params;
  }

  private parseTypeExpr(): TypeExpr {
    let isNullable = false;
    if (this.check("QUESTION")) {
      this.advance();
      isNullable = true;
    }

    const baseName = this.advance().value;
    let baseType: TypeExpr;

    switch (baseName.toLowerCase()) {
      case "int":
      case "byte":
        baseType = { kind: "PrimitiveType", primitive: "int", span: emptySpan(this.filePath) };
        break;
      case "float":
        baseType = { kind: "PrimitiveType", primitive: "float", span: emptySpan(this.filePath) };
        break;
      case "string":
        baseType = { kind: "PrimitiveType", primitive: "str", span: emptySpan(this.filePath) };
        break;
      case "bool":
        baseType = { kind: "PrimitiveType", primitive: "bool", span: emptySpan(this.filePath) };
        break;
      case "void":
        baseType = { kind: "PrimitiveType", primitive: "void", span: emptySpan(this.filePath) };
        break;
      case "array":
        baseType = {
          kind: "ArrayType",
          elementType: { kind: "NamedType", name: "any", span: emptySpan(this.filePath) },
          span: emptySpan(this.filePath),
        };
        break;
      default:
        baseType = { kind: "NamedType", name: baseName, span: emptySpan(this.filePath) };
        break;
    }

    if (isNullable) {
      return { kind: "OptionType", innerType: baseType, span: emptySpan(this.filePath) };
    }

    // Handle union types A|B
    if (this.check("PIPE")) {
      this.advance();
      const right = this.parseTypeExpr();
      if (right.kind === "PrimitiveType" && right.primitive === "nil") {
        return { kind: "OptionType", innerType: baseType, span: emptySpan(this.filePath) };
      }
      return baseType;
    }

    return baseType;
  }

  private parseBlock(): Block {
    this.consume("LBRACE");
    const statements: Statement[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;

      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
    }

    this.consume("RBRACE");
    return { kind: "Block", statements, span: emptySpan(this.filePath) };
  }

  private parseStatement(): Statement | null {
    if (this.check("COMMENT") || this.check("DOC_COMMENT")) {
      this.collectLeadingTrivia();
      return null;
    }

    if (this.check("RETURN")) {
      this.advance();
      if (this.check("SEMICOLON")) {
        this.advance();
        return { kind: "ReturnStmt", value: null, span: emptySpan(this.filePath) };
      }
      if (this.check("MATCH")) {
        const matchStmt = this.parseMatchStatement();
        if (this.check("SEMICOLON")) this.advance();
        return matchStmt;
      }
      const val = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
      return { kind: "ReturnStmt", value: val, span: emptySpan(this.filePath) };
    }

    if (this.check("IF")) {
      return this.parseIfStatement();
    }

    if (this.check("WHILE")) {
      this.advance();
      this.consume("LPAREN");
      const condition = this.parseExpr();
      this.consume("RPAREN");
      const body = this.parseBlock();
      return { kind: "WhileStmt", condition, body, span: emptySpan(this.filePath) };
    }

    if (this.check("FOREACH")) {
      this.advance();
      this.consume("LPAREN");
      const iterable = this.parseExpr();
      this.consume("AS");
      let variable = "";
      if (this.check("VARIABLE")) {
        variable = this.advance().value;
      }
      if (this.check("DOUBLE_ARROW")) {
        this.advance();
        variable = this.consume("VARIABLE").value;
      }
      this.consume("RPAREN");
      const body = this.parseBlock();
      return { kind: "ForStmt", variable, iterable, body, span: emptySpan(this.filePath) };
    }

    if (this.check("TRY")) {
      this.advance();
      const tryBlock = this.parseBlock();
      let catchParam: string | undefined;
      let catchBlock: Block | undefined;
      let finallyBlock: Block | undefined;

      if (this.check("CATCH")) {
        this.advance();
        this.consume("LPAREN");
        while (!this.check("VARIABLE") && !this.check("RPAREN") && !this.check("EOF")) {
          this.advance();
        }
        if (this.check("VARIABLE")) {
          catchParam = this.advance().value;
        }
        this.consume("RPAREN");
        catchBlock = this.parseBlock();
      }

      if (this.check("FINALLY")) {
        this.advance();
        finallyBlock = this.parseBlock();
      }

      return {
        kind: "TryStmt",
        tryBlock,
        catchParam,
        catchBlock,
        finallyBlock,
        span: emptySpan(this.filePath),
      };
    }

    if (this.check("THROW")) {
      this.advance();
      const expr = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();
      return { kind: "ThrowStmt", expr, span: emptySpan(this.filePath) };
    }

    if (this.check("MATCH")) {
      const matchStmt = this.parseMatchStatement();
      if (this.check("SEMICOLON")) this.advance();
      return matchStmt;
    }

    // Unset($a)
    if (this.check("UNSET")) {
      this.advance();
      this.consume("LPAREN");
      const target = this.parseExpr();
      this.consume("RPAREN");
      if (this.check("SEMICOLON")) this.advance();
      return {
        kind: "ExprStmt",
        expr: {
          kind: "CallExpr",
          callee: { kind: "IdentifierExpr", name: "unset", span: emptySpan(this.filePath) },
          args: [target],
          span: emptySpan(this.filePath),
        },
        span: emptySpan(this.filePath),
      };
    }

    // Assignment or expression statement
    const expr = this.parseExpr();

    if (this.check("ASSIGN")) {
      this.advance();
      const targetExpr = expr;
      // Check if rhs is match expression
      if (this.check("MATCH")) {
        const matchStmt = this.parseMatchStatement();
        // Lower to MatchStmt where cases assign to target
        for (const c of matchStmt.cases) {
          if (c.body.kind !== "Block") {
            c.body = {
              kind: "Block",
              statements: [
                {
                  kind: "AssignStmt",
                  target: targetExpr,
                  op: "=",
                  value: c.body,
                  span: emptySpan(this.filePath),
                },
              ],
              span: emptySpan(this.filePath),
            };
          }
        }
        if (this.check("SEMICOLON")) this.advance();
        return matchStmt;
      }

      const val = this.parseExpr();
      if (this.check("SEMICOLON")) this.advance();

      if (expr.kind === "IdentifierExpr" && !this.declaredVars.has(expr.name)) {
        this.declaredVars.add(expr.name);
        return {
          kind: "LetBinding",
          name: expr.name,
          isMut: true,
          typeAnnotation: null,
          init: val,
          span: emptySpan(this.filePath),
        };
      }
      return {
        kind: "AssignStmt",
        target: expr,
        op: "=",
        value: val,
        span: emptySpan(this.filePath),
      };
    }

    const assignOpMap: Record<string, AssignOp> = {
      PLUS_ASSIGN: "+=",
      MINUS_ASSIGN: "-=",
      STAR_ASSIGN: "*=",
      SLASH_ASSIGN: "/=",
      DOT_ASSIGN: "=",
    };

    if (assignOpMap[this.current().kind]) {
      const op = assignOpMap[this.advance().kind];
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
    return { kind: "ExprStmt", expr, span: emptySpan(this.filePath) };
  }

  private parseIfStatement(): IfStmt {
    this.advance(); // consume if
    this.consume("LPAREN");
    const condition = this.parseExpr();
    this.consume("RPAREN");
    const thenBranch = this.parseBlock();

    const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
    while (this.check("ELSEIF")) {
      this.advance();
      this.consume("LPAREN");
      const elifCond = this.parseExpr();
      this.consume("RPAREN");
      const elifBody = this.parseBlock();
      elifBranches.push({ condition: elifCond, body: elifBody, span: emptySpan(this.filePath) });
    }

    let elseBranch: Block | null = null;
    if (this.check("ELSE")) {
      this.advance();
      elseBranch = this.parseBlock();
    }

    return {
      kind: "IfStmt",
      condition,
      thenBranch,
      elifBranches,
      elseBranch,
      span: emptySpan(this.filePath),
    };
  }

  private parseMatchStatement(): MatchStmt {
    this.consume("MATCH");
    this.consume("LPAREN");
    const target = this.parseExpr();
    this.consume("RPAREN");
    this.consume("LBRACE");

    const cases: MatchCase[] = [];

    while (!this.check("RBRACE") && !this.check("EOF")) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE") || this.check("EOF")) break;
      let pattern: Pattern;

      if (this.check("DEFAULT")) {
        this.advance();
        pattern = { kind: "WildcardPattern", span: emptySpan(this.filePath) };
      } else {
        const patExpr = this.parsePrimaryExpr();
        if (patExpr.kind === "LiteralExpr") {
          pattern = { kind: "LiteralPattern", value: patExpr, span: emptySpan(this.filePath) };
        } else if (patExpr.kind === "IdentifierExpr") {
          pattern = {
            kind: "IdentifierPattern",
            name: patExpr.name,
            span: emptySpan(this.filePath),
          };
        } else if (patExpr.kind === "MemberAccessExpr") {
          const qualified = `${(patExpr.object as IdentifierExpr).name}.${patExpr.property}`;
          pattern = { kind: "IdentifierPattern", name: qualified, span: emptySpan(this.filePath) };
        } else {
          pattern = { kind: "WildcardPattern", span: emptySpan(this.filePath) };
        }
      }

      this.consume("DOUBLE_ARROW");
      const bodyExpr = this.parseExpr();
      cases.push({
        pattern,
        body: bodyExpr,
        span: emptySpan(this.filePath),
      });

      if (this.check("COMMA")) this.advance();
    }

    this.consume("RBRACE");

    return {
      kind: "MatchStmt",
      target,
      cases,
      span: emptySpan(this.filePath),
    };
  }

  private parseExpr(): Expr {
    return this.parseBinaryExpr(0);
  }

  private getPrecedence(kind: PhpTokenKind): number {
    switch (kind) {
      case "OR":
        return 1;
      case "AND":
        return 2;
      case "COALESCE":
        return 3;
      case "EQ":
      case "EQ_EXACT":
      case "NE":
      case "NE_EXACT":
        return 4;
      case "LT":
      case "LE":
      case "GT":
      case "GE":
      case "SPACESHIP":
        return 5;
      case "PLUS":
      case "MINUS":
      case "DOT":
        return 6;
      case "STAR":
      case "SLASH":
      case "PERCENT":
        return 7;
      case "STAR_STAR":
        return 8;
      default:
        return 0;
    }
  }

  private parseBinaryExpr(minPrec: number): Expr {
    let left = this.parseUnaryExpr();

    while (true) {
      const prec = this.getPrecedence(this.current().kind);
      if (prec <= minPrec) break;

      const opTok = this.advance();
      let op: BinaryOp = "+";

      switch (opTok.kind) {
        case "PLUS":
          op = "+";
          break;
        case "MINUS":
          op = "-";
          break;
        case "STAR":
          op = "*";
          break;
        case "SLASH":
          op = "/";
          break;
        case "PERCENT":
          op = "%";
          break;
        case "STAR_STAR":
          op = "**";
          break;
        case "DOT":
          op = "+"; // string concat lowered to +
          break;
        case "AND":
          op = "&&";
          break;
        case "OR":
          op = "||";
          break;
        case "EQ":
        case "EQ_EXACT":
          op = "==";
          break;
        case "NE":
        case "NE_EXACT":
          op = "!=";
          break;
        case "LT":
          op = "<";
          break;
        case "LE":
          op = "<=";
          break;
        case "GT":
          op = ">";
          break;
        case "GE":
          op = ">=";
          break;
        case "COALESCE":
          op = "??";
          break;
      }

      const right = this.parseBinaryExpr(prec);
      left = {
        kind: "BinaryExpr",
        operator: op,
        left,
        right,
        span: emptySpan(this.filePath),
      };
    }

    return left;
  }

  private parseUnaryExpr(): Expr {
    if (this.check("NOT") || this.check("MINUS") || this.check("PLUS")) {
      const opTok = this.advance();
      const operand = this.parseUnaryExpr();
      return {
        kind: "UnaryExpr",
        operator: opTok.kind === "NOT" ? "!" : "-",
        operand,
        span: emptySpan(this.filePath),
      };
    }
    return this.parsePostfixExpr();
  }

  private parsePostfixExpr(): Expr {
    let expr = this.parsePrimaryExpr();

    while (true) {
      // Method/Property access ($obj->prop or $obj?->prop)
      if (this.check("ARROW") || this.check("NULLSAFE_ARROW")) {
        const isSafeNav = this.advance().kind === "NULLSAFE_ARROW";
        const propName = this.advance().value;

        // Check if method call
        if (this.check("LPAREN")) {
          this.advance();
          const args = this.parseArgList();
          this.consume("RPAREN");
          expr = {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: expr,
              property: propName,
              isSafeNav,
              span: emptySpan(this.filePath),
            },
            args,
            span: emptySpan(this.filePath),
          };
        } else {
          expr = {
            kind: "MemberAccessExpr",
            object: expr,
            property: propName,
            isSafeNav,
            span: emptySpan(this.filePath),
          };
        }
        continue;
      }

      // Static member / Enum case access (Class::prop or Class::method())
      if (this.check("DOUBLE_COLON")) {
        this.advance();
        const memberName = this.advance().value;

        if (this.check("LPAREN")) {
          this.advance();
          const args = this.parseArgList();
          this.consume("RPAREN");
          expr = {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: expr,
              property: memberName,
              isSafeNav: false,
              span: emptySpan(this.filePath),
            },
            args,
            span: emptySpan(this.filePath),
          };
        } else {
          expr = {
            kind: "MemberAccessExpr",
            object: expr,
            property: memberName,
            isSafeNav: false,
            span: emptySpan(this.filePath),
          };
        }
        continue;
      }

      // Index expression ($arr[$idx] or $arr[])
      if (this.check("LBRACKET")) {
        this.advance();
        if (this.check("RBRACKET")) {
          this.advance();
          expr = {
            kind: "IndexExpr",
            object: expr,
            index: {
              kind: "LiteralExpr",
              literalKind: "number",
              value: 0,
              rawValue: "0",
              span: emptySpan(this.filePath),
            },
            span: emptySpan(this.filePath),
          };
        } else {
          const index = this.parseExpr();
          this.consume("RBRACKET");
          expr = {
            kind: "IndexExpr",
            object: expr,
            index,
            span: emptySpan(this.filePath),
          };
        }
        continue;
      }

      // Function call
      if (this.check("LPAREN")) {
        this.advance();
        const args = this.parseArgList();
        this.consume("RPAREN");
        expr = {
          kind: "CallExpr",
          callee: expr,
          args,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      break;
    }

    return expr;
  }

  private parsePrimaryExpr(): Expr {
    // Variable: $this, $foo
    if (this.check("VARIABLE")) {
      const varName = this.advance().value;
      return {
        kind: "IdentifierExpr",
        name: varName,
        span: emptySpan(this.filePath),
      };
    }

    // Number literal
    if (this.check("NUMBER")) {
      const tok = this.advance();
      const val = tok.value.includes(".") ? parseFloat(tok.value) : parseInt(tok.value, 10);
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: val,
        rawValue: tok.value,
        span: emptySpan(this.filePath),
      };
    }

    // String literal
    if (this.check("STRING")) {
      const tok = this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value,
        rawValue: `'${tok.value}'`,
        span: emptySpan(this.filePath),
      };
    }

    // New instantiation: new ClassName(args)
    if (this.check("NEW")) {
      this.advance();
      const className = this.advance().value;
      let args: Expr[] = [];
      if (this.check("LPAREN")) {
        this.advance();
        args = this.parseArgList();
        this.consume("RPAREN");
      }
      return {
        kind: "CallExpr",
        callee: { kind: "IdentifierExpr", name: className, span: emptySpan(this.filePath) },
        args,
        span: emptySpan(this.filePath),
      };
    }

    // Isset function call
    if (this.check("ISSET")) {
      this.advance();
      this.consume("LPAREN");
      const target = this.parseExpr();
      this.consume("RPAREN");
      return {
        kind: "CallExpr",
        callee: { kind: "IdentifierExpr", name: "isset", span: emptySpan(this.filePath) },
        args: [target],
        span: emptySpan(this.filePath),
      };
    }

    // Array literal: [...]
    if (this.check("LBRACKET")) {
      this.advance();
      const elements: Expr[] = [];
      const recordProps: { key?: string; value: Expr; span: Span }[] = [];
      let isAssoc = false;

      while (!this.check("RBRACKET") && !this.check("EOF")) {
        const item = this.parseExpr();
        if (this.check("DOUBLE_ARROW")) {
          isAssoc = true;
          this.advance();
          const val = this.parseExpr();
          const keyName = item.kind === "LiteralExpr" ? String(item.value) : undefined;
          recordProps.push({ key: keyName, value: val, span: emptySpan(this.filePath) });
        } else {
          elements.push(item);
        }

        if (this.check("COMMA")) {
          this.advance();
        } else {
          break;
        }
      }

      this.consume("RBRACKET");

      if (isAssoc) {
        return {
          kind: "RecordLiteralExpr",
          properties: recordProps,
          span: emptySpan(this.filePath),
        };
      }
      return {
        kind: "ArrayLiteralExpr",
        elements,
        span: emptySpan(this.filePath),
      };
    }

    // Parenthesized expression: (expr)
    if (this.check("LPAREN")) {
      this.advance();
      const expr = this.parseExpr();
      this.consume("RPAREN");
      return expr;
    }

    // Identifiers: true, false, null, self, class names
    if (this.check("IDENTIFIER")) {
      const name = this.advance().value;
      if (name === "true") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: true,
          rawValue: "true",
          span: emptySpan(this.filePath),
        };
      }
      if (name === "false") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: false,
          rawValue: "false",
          span: emptySpan(this.filePath),
        };
      }
      if (name === "null") {
        return {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "null",
          span: emptySpan(this.filePath),
        };
      }
      return {
        kind: "IdentifierExpr",
        name,
        span: emptySpan(this.filePath),
      };
    }

    // Fallback: advance and return null literal
    this.advance();
    return {
      kind: "LiteralExpr",
      literalKind: "nil",
      value: null,
      rawValue: "null",
      span: emptySpan(this.filePath),
    };
  }

  private parseArgList(): Expr[] {
    const args: Expr[] = [];
    while (!this.check("RPAREN") && !this.check("EOF")) {
      args.push(this.parseExpr());
      if (this.check("COMMA")) {
        this.advance();
      } else {
        break;
      }
    }
    return args;
  }
}

export function decompilePhp(
  source: string,
  filePath = "source.php",
  options: AiceGeneratorOptions = {},
): { ast: Module; aice: string; trivia: CstTriviaTable } {
  const decompiler = new PhpDecompiler(source, filePath);
  const result = decompiler.decompile();
  const generator = new AiceGenerator({ ...options, trivia: result.trivia });
  const aice = generator.generate(result.ast);
  return { ast: result.ast, aice, trivia: result.trivia };
}
