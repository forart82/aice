/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Idiomatic Go 1.22+ Decompiler (Reverse Transpiler) for AIL 2.0.
 * Conforms to Pillar 2 & 4 of AIL 2.0 Universal Bidirectional Parity.
 */

import type {
  ArrayLiteralExpr,
  AssignOp,
  AssignStmt,
  BinaryExpr,
  BinaryOp,
  Block,
  CallExpr,
  ClassDecl,
  ConstDecl,
  Expr,
  ExprStmt,
  FieldDecl,
  ForStmt,
  FunctionDecl,
  IdentifierExpr,
  IfStmt,
  ImportDecl,
  IndexExpr,
  LetBinding,
  LiteralExpr,
  MatchCase,
  MatchStmt,
  MemberAccessExpr,
  MethodDecl,
  Module,
  ModuleItem,
  ParamDecl,
  Pattern,
  PostfixTryExpr,
  PropertyDecl,
  RecordLiteralExpr,
  ReturnStmt,
  Statement,
  TemplateLiteralExpr,
  TypeDecl,
  TypeExpr,
  UnaryExpr,
  VarDecl,
  WhileStmt,
} from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable, type TriviaItem } from "../core/trivia.js";
import { AilGenerator, type AilGeneratorOptions } from "./ail-generator.js";

export type GoTokenKind =
  | "EOF"
  | "IDENTIFIER"
  | "NUMBER"
  | "STRING"
  | "COMMENT"
  | "PACKAGE"
  | "IMPORT"
  | "TYPE"
  | "STRUCT"
  | "FUNC"
  | "CONST"
  | "VAR"
  | "IF"
  | "ELSE"
  | "SWITCH"
  | "CASE"
  | "DEFAULT"
  | "FOR"
  | "RANGE"
  | "RETURN"
  | "BREAK"
  | "CONTINUE"
  | "LPAREN"
  | "RPAREN"
  | "LBRACE"
  | "RBRACE"
  | "LBRACKET"
  | "RBRACKET"
  | "COMMA"
  | "COLON"
  | "SEMICOLON"
  | "DOT"
  | "DEFINE" // :=
  | "ASSIGN" // =
  | "PLUS_ASSIGN"
  | "MINUS_ASSIGN"
  | "STAR_ASSIGN"
  | "SLASH_ASSIGN"
  | "EQ"
  | "NEQ"
  | "LT"
  | "LTE"
  | "GT"
  | "GTE"
  | "AND"
  | "OR"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "PERCENT"
  | "AMP"
  | "PIPE"
  | "CARET"
  | "BANG"
  | "PLUS_PLUS"
  | "MINUS_MINUS"
  | "ELLIPSIS"
  | "ARROW";

export interface GoToken {
  kind: GoTokenKind;
  value: string;
  line: number;
  col: number;
}

export class GoLexer {
  private src: string;
  private pos = 0;
  private line = 1;
  private col = 1;

  constructor(source: string) {
    this.src = source;
  }

  tokenize(): GoToken[] {
    const tokens: GoToken[] = [];
    while (this.pos < this.src.length) {
      const ch = this.src[this.pos];

      // Whitespace
      if (ch === " " || ch === "\t" || ch === "\r") {
        this.advance();
        continue;
      }

      if (ch === "\n") {
        this.advance();
        continue;
      }

      // Comments
      if (ch === "/" && this.peek(1) === "/") {
        const startLine = this.line;
        const startCol = this.col;
        let comment = "";
        while (this.pos < this.src.length && this.src[this.pos] !== "\n") {
          comment += this.advance();
        }
        tokens.push({ kind: "COMMENT", value: comment, line: startLine, col: startCol });
        continue;
      }

      if (ch === "/" && this.peek(1) === "*") {
        const startLine = this.line;
        const startCol = this.col;
        let comment = this.advance() + this.advance();
        while (this.pos < this.src.length) {
          if (this.src[this.pos] === "*" && this.peek(1) === "/") {
            comment += this.advance() + this.advance();
            break;
          }
          comment += this.advance();
        }
        tokens.push({ kind: "COMMENT", value: comment, line: startLine, col: startCol });
        continue;
      }

      // String literals (interpreted double quote or raw backtick)
      if (ch === '"') {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // consume "
        let str = "";
        while (this.pos < this.src.length && this.src[this.pos] !== '"') {
          if (this.src[this.pos] === "\\" && this.pos + 1 < this.src.length) {
            this.advance();
            const esc = this.advance();
            if (esc === "n") str += "\n";
            else if (esc === "t") str += "\t";
            else if (esc === "r") str += "\r";
            else if (esc === '"') str += '"';
            else if (esc === "\\") str += "\\";
            else str += esc;
          } else {
            str += this.advance();
          }
        }
        if (this.pos < this.src.length && this.src[this.pos] === '"') {
          this.advance();
        }
        tokens.push({ kind: "STRING", value: str, line: startLine, col: startCol });
        continue;
      }

      if (ch === "`") {
        const startLine = this.line;
        const startCol = this.col;
        this.advance(); // consume `
        let str = "";
        while (this.pos < this.src.length && this.src[this.pos] !== "`") {
          str += this.advance();
        }
        if (this.pos < this.src.length && this.src[this.pos] === "`") {
          this.advance();
        }
        tokens.push({ kind: "STRING", value: str, line: startLine, col: startCol });
        continue;
      }

      // Rune literal
      if (ch === "'") {
        const startLine = this.line;
        const startCol = this.col;
        this.advance();
        let rune = "";
        while (this.pos < this.src.length && this.src[this.pos] !== "'") {
          if (this.src[this.pos] === "\\" && this.pos + 1 < this.src.length) {
            rune += this.advance() + this.advance();
          } else {
            rune += this.advance();
          }
        }
        if (this.pos < this.src.length && this.src[this.pos] === "'") {
          this.advance();
        }
        tokens.push({ kind: "STRING", value: rune, line: startLine, col: startCol });
        continue;
      }

      // Number literals
      if (/[0-9]/.test(ch)) {
        const startLine = this.line;
        const startCol = this.col;
        let num = "";
        const isHex = ch === "0" && (this.peek(1) === "x" || this.peek(1) === "X");
        let hasDot = false;
        while (this.pos < this.src.length) {
          const curr = this.src[this.pos];
          const prev = num.length > 0 ? num[num.length - 1] : "";
          if (curr === "_") {
            num += this.advance();
            continue;
          }
          if (curr === ".") {
            if (!hasDot && !isHex && /[0-9]/.test(this.peek(1))) {
              hasDot = true;
              num += this.advance();
              continue;
            }
            break;
          }
          if (curr === "+" || curr === "-") {
            if (!isHex && (prev === "e" || prev === "E")) {
              num += this.advance();
              continue;
            }
            break;
          }
          if (isHex) {
            if (num.length === 1 && (curr === "x" || curr === "X")) {
              num += this.advance();
              continue;
            }
            if (/[0-9a-fA-F]/.test(curr)) {
              num += this.advance();
              continue;
            }
            break;
          }
          if (/[0-9]/.test(curr)) {
            num += this.advance();
            continue;
          }
          if ((curr === "e" || curr === "E") && (/[0-9]/.test(prev) || prev === ".")) {
            num += this.advance();
            continue;
          }
          if (num.length === 1 && (curr === "o" || curr === "O" || curr === "b" || curr === "B")) {
            num += this.advance();
            continue;
          }
          break;
        }
        tokens.push({ kind: "NUMBER", value: num, line: startLine, col: startCol });
        continue;
      }

      // Identifiers and Keywords
      if (/[a-zA-Z_]/.test(ch)) {
        const startLine = this.line;
        const startCol = this.col;
        let id = "";
        while (this.pos < this.src.length && /[a-zA-Z0-9_]/.test(this.src[this.pos])) {
          id += this.advance();
        }
        const kwKind = this.keywordKind(id);
        tokens.push({ kind: kwKind, value: id, line: startLine, col: startCol });
        continue;
      }

      // Operators and Punctuation
      const startLine = this.line;
      const startCol = this.col;
      const two = this.src.slice(this.pos, this.pos + 2);
      const three = this.src.slice(this.pos, this.pos + 3);

      if (three === "...") {
        this.advance();
        this.advance();
        this.advance();
        tokens.push({ kind: "ELLIPSIS", value: "...", line: startLine, col: startCol });
        continue;
      }

      if (two === ":=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "DEFINE", value: ":=", line: startLine, col: startCol });
        continue;
      }
      if (two === "==") {
        this.advance();
        this.advance();
        tokens.push({ kind: "EQ", value: "==", line: startLine, col: startCol });
        continue;
      }
      if (two === "!=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "NEQ", value: "!=", line: startLine, col: startCol });
        continue;
      }
      if (two === "<=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "LTE", value: "<=", line: startLine, col: startCol });
        continue;
      }
      if (two === ">=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "GTE", value: ">=", line: startLine, col: startCol });
        continue;
      }
      if (two === "&&") {
        this.advance();
        this.advance();
        tokens.push({ kind: "AND", value: "&&", line: startLine, col: startCol });
        continue;
      }
      if (two === "||") {
        this.advance();
        this.advance();
        tokens.push({ kind: "OR", value: "||", line: startLine, col: startCol });
        continue;
      }
      if (two === "++") {
        this.advance();
        this.advance();
        tokens.push({ kind: "PLUS_PLUS", value: "++", line: startLine, col: startCol });
        continue;
      }
      if (two === "--") {
        this.advance();
        this.advance();
        tokens.push({ kind: "MINUS_MINUS", value: "--", line: startLine, col: startCol });
        continue;
      }
      if (two === "+=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "PLUS_ASSIGN", value: "+=", line: startLine, col: startCol });
        continue;
      }
      if (two === "-=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "MINUS_ASSIGN", value: "-=", line: startLine, col: startCol });
        continue;
      }
      if (two === "*=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "STAR_ASSIGN", value: "*=", line: startLine, col: startCol });
        continue;
      }
      if (two === "/=") {
        this.advance();
        this.advance();
        tokens.push({ kind: "SLASH_ASSIGN", value: "/=", line: startLine, col: startCol });
        continue;
      }
      if (two === "<-") {
        this.advance();
        this.advance();
        tokens.push({ kind: "ARROW", value: "<-", line: startLine, col: startCol });
        continue;
      }

      // Single char
      this.advance();
      switch (ch) {
        case "(":
          tokens.push({ kind: "LPAREN", value: "(", line: startLine, col: startCol });
          break;
        case ")":
          tokens.push({ kind: "RPAREN", value: ")", line: startLine, col: startCol });
          break;
        case "{":
          tokens.push({ kind: "LBRACE", value: "{", line: startLine, col: startCol });
          break;
        case "}":
          tokens.push({ kind: "RBRACE", value: "}", line: startLine, col: startCol });
          break;
        case "[":
          tokens.push({ kind: "LBRACKET", value: "[", line: startLine, col: startCol });
          break;
        case "]":
          tokens.push({ kind: "RBRACKET", value: "]", line: startLine, col: startCol });
          break;
        case ",":
          tokens.push({ kind: "COMMA", value: ",", line: startLine, col: startCol });
          break;
        case ":":
          tokens.push({ kind: "COLON", value: ":", line: startLine, col: startCol });
          break;
        case ";":
          tokens.push({ kind: "SEMICOLON", value: ";", line: startLine, col: startCol });
          break;
        case ".":
          tokens.push({ kind: "DOT", value: ".", line: startLine, col: startCol });
          break;
        case "=":
          tokens.push({ kind: "ASSIGN", value: "=", line: startLine, col: startCol });
          break;
        case "+":
          tokens.push({ kind: "PLUS", value: "+", line: startLine, col: startCol });
          break;
        case "-":
          tokens.push({ kind: "MINUS", value: "-", line: startLine, col: startCol });
          break;
        case "*":
          tokens.push({ kind: "STAR", value: "*", line: startLine, col: startCol });
          break;
        case "/":
          tokens.push({ kind: "SLASH", value: "/", line: startLine, col: startCol });
          break;
        case "%":
          tokens.push({ kind: "PERCENT", value: "%", line: startLine, col: startCol });
          break;
        case "&":
          tokens.push({ kind: "AMP", value: "&", line: startLine, col: startCol });
          break;
        case "|":
          tokens.push({ kind: "PIPE", value: "|", line: startLine, col: startCol });
          break;
        case "^":
          tokens.push({ kind: "CARET", value: "^", line: startLine, col: startCol });
          break;
        case "!":
          tokens.push({ kind: "BANG", value: "!", line: startLine, col: startCol });
          break;
        case "<":
          tokens.push({ kind: "LT", value: "<", line: startLine, col: startCol });
          break;
        case ">":
          tokens.push({ kind: "GT", value: ">", line: startLine, col: startCol });
          break;
        default:
          break;
      }
    }

    tokens.push({ kind: "EOF", value: "", line: this.line, col: this.col });
    return tokens;
  }

  private advance(): string {
    const ch = this.src[this.pos++];
    if (ch === "\n") {
      this.line++;
      this.col = 1;
    } else {
      this.col++;
    }
    return ch;
  }

  private peek(offset = 0): string {
    const idx = this.pos + offset;
    return idx < this.src.length ? this.src[idx] : "";
  }

  private keywordKind(id: string): GoTokenKind {
    switch (id) {
      case "package":
        return "PACKAGE";
      case "import":
        return "IMPORT";
      case "type":
        return "TYPE";
      case "struct":
        return "STRUCT";
      case "func":
        return "FUNC";
      case "const":
        return "CONST";
      case "var":
        return "VAR";
      case "if":
        return "IF";
      case "else":
        return "ELSE";
      case "switch":
        return "SWITCH";
      case "case":
        return "CASE";
      case "default":
        return "DEFAULT";
      case "for":
        return "FOR";
      case "range":
        return "RANGE";
      case "return":
        return "RETURN";
      case "break":
        return "BREAK";
      case "continue":
        return "CONTINUE";
      default:
        return "IDENTIFIER";
    }
  }
}

export class GoDecompiler {
  private source: string;
  private filePath: string;
  private tokens: GoToken[] = [];
  private cur = 0;
  private trivia: CstTriviaTable;
  private pendingTrivia: TriviaItem[] = [];
  private inControlHeader = false;

  constructor(source: string, filePath = "source.go") {
    this.source = source;
    this.filePath = filePath;
    this.trivia = new CstTriviaTable();
  }

  decompile(): { ast: Module; trivia: CstTriviaTable } {
    const lexer = new GoLexer(this.source);
    this.tokens = lexer.tokenize();
    this.cur = 0;
    this.pendingTrivia = [];

    const items: ModuleItem[] = [];
    let packageName: string | undefined;

    // Struct definitions and their collected receiver methods
    const structs = new Map<
      string,
      {
        name: string;
        fields: FieldDecl[];
        isExported: boolean;
        trivia: TriviaItem[];
      }
    >();
    const receiverMethods = new Map<string, MethodDecl[]>();
    const constructors = new Map<string, FunctionDecl>();

    while (!this.isAtEnd()) {
      this.collectLeadingTrivia();

      if (this.check("PACKAGE")) {
        this.advance();
        packageName = this.consume("IDENTIFIER", "Expected package name").value;
        this.match("SEMICOLON");
        continue;
      }

      if (this.check("IMPORT")) {
        this.parseImport(items);
        continue;
      }

      if (this.check("TYPE")) {
        this.parseType(items, structs);
        continue;
      }

      if (this.check("CONST")) {
        this.parseConst(items);
        continue;
      }

      if (this.check("VAR")) {
        this.parseVar(items);
        continue;
      }

      if (this.check("FUNC")) {
        this.parseFunc(items, receiverMethods, constructors);
        continue;
      }

      // Unrecognized top-level token, skip
      this.advance();
    }

    const matchedClassConstructors = new Set<string>();
    // Now assemble classes or types from structs and receiverMethods
    for (const [name, structInfo] of structs) {
      const methods = receiverMethods.get(name) ?? [];
      const ctor = constructors.get(name);

      if (methods.length > 0) {
        if (ctor) matchedClassConstructors.add(name);
        // Struct has methods -> ClassDecl
        const primaryConstructor: ParamDecl[] = [];
        if (ctor) {
          primaryConstructor.push(...ctor.params);
        } else {
          for (const f of structInfo.fields) {
            primaryConstructor.push({
              name: f.name,
              typeAnnotation: f.typeAnnotation,
              span: emptySpan(),
            });
          }
        }

        const classDecl: ClassDecl = {
          kind: "ClassDecl",
          name,
          isExported: structInfo.isExported,
          typeParams: [],
          primaryConstructor,
          properties: structInfo.fields.map((f) => ({
            kind: "PropertyDecl",
            name: f.name,
            isStatic: false,
            isReadonly: false,
            typeAnnotation: f.typeAnnotation,
            span: emptySpan(),
          })),
          methods,
          span: emptySpan(),
        };

        const nodeId = `class:${name}`;
        for (const t of structInfo.trivia) {
          this.trivia.addLeadingTrivia(nodeId, t);
        }
        items.push(classDecl);
      } else {
        // Struct without receiver methods -> TypeDecl
        const typeDecl: TypeDecl = {
          kind: "TypeDecl",
          isEnum: false,
          name,
          typeParams: [],
          fields: structInfo.fields,
          span: emptySpan(),
        };

        const nodeId = `type:${name}`;
        for (const t of structInfo.trivia) {
          this.trivia.addLeadingTrivia(nodeId, t);
        }
        items.push(typeDecl);
      }
    }

    for (const [targetStruct, ctorFn] of constructors) {
      if (!structs.has(targetStruct)) {
        items.push(ctorFn);
      }
    }

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.go(\.ail)?$/, "")
        .replace(/\.ail$/, "") || "main";

    const ast: Module = {
      kind: "Module",
      items,
      path: packageName ?? baseName,
      span: emptySpan(),
    };

    return { ast, trivia: this.trivia };
  }

  private collectLeadingTrivia(): TriviaItem[] {
    const list: TriviaItem[] = [];
    while (this.check("COMMENT")) {
      const t = this.advance();
      if (t.value.includes("generated by AIL")) continue;
      const isBlock = t.value.startsWith("/*");
      list.push({
        kind: isBlock ? "BLOCK_COMMENT" : "LINE_COMMENT",
        content: t.value,
      });
    }
    this.pendingTrivia.push(...list);
    return list;
  }

  private flushPendingTrivia(nodeId: string): void {
    if (this.pendingTrivia.length > 0) {
      for (const t of this.pendingTrivia) {
        this.trivia.addLeadingTrivia(nodeId, t);
      }
      this.pendingTrivia = [];
    }
  }

  private parseImport(items: ModuleItem[]): void {
    this.advance(); // consume 'import'
    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("STRING")) {
          const path = this.advance().value;
          this.addImportIfCustom(path, items);
        } else if (this.check("IDENTIFIER") && this.peek(1).kind === "STRING") {
          const alias = this.advance().value;
          const path = this.advance().value;
          this.addImportIfCustom(path, items, alias);
        } else {
          this.advance();
        }
        this.match("SEMICOLON");
      }
      this.consume("RPAREN", "Expected ')' closing import block");
    } else if (this.check("STRING")) {
      const path = this.advance().value;
      this.addImportIfCustom(path, items);
    }
    this.match("SEMICOLON");
  }

  private addImportIfCustom(path: string, items: ModuleItem[], alias?: string): void {
    // Skip Go standard library boilerplate
    if (
      path === "fmt" ||
      path === "strings" ||
      path === "strconv" ||
      path === "math" ||
      path === "errors"
    ) {
      return;
    }
    const name = alias ?? path.split("/").pop() ?? path;
    const imp: ImportDecl = {
      kind: "ImportDecl",
      source: path,
      specifiers: [
        {
          name,
          alias,
          isWildcard: false,
          isDefault: true,
          span: emptySpan(),
        },
      ],
      span: emptySpan(),
    };
    items.push(imp);
  }

  private parseType(
    items: ModuleItem[],
    structs: Map<
      string,
      {
        name: string;
        fields: FieldDecl[];
        isExported: boolean;
        trivia: TriviaItem[];
      }
    >,
  ): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'type'

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        this.parseSingleTypeDecl(items, structs, trivia);
      }
      this.consume("RPAREN", "Expected ')' closing type block");
      return;
    }

    this.parseSingleTypeDecl(items, structs, trivia);
  }

  private parseSingleTypeDecl(
    items: ModuleItem[],
    structs: Map<
      string,
      {
        name: string;
        fields: FieldDecl[];
        isExported: boolean;
        trivia: TriviaItem[];
      }
    >,
    trivia: TriviaItem[],
  ): void {
    const name = this.consume("IDENTIFIER", "Expected type name").value;
    const isExported = /^[A-Z]/.test(name);

    if (this.match("ASSIGN")) {
      // Type alias: type Name = Target
      const aliasType = this.parseTypeExpr();
      const typeDecl: TypeDecl = {
        kind: "TypeDecl",
        isEnum: false,
        name,
        typeParams: [],
        aliasType,
        span: emptySpan(),
      };
      const nodeId = `type:${name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      items.push(typeDecl);
      this.match("SEMICOLON");
      return;
    }

    if (this.check("STRUCT")) {
      this.advance(); // consume struct
      this.consume("LBRACE", "Expected '{' after struct");
      const fields: FieldDecl[] = [];

      while (!this.check("RBRACE") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("RBRACE")) break;

        const fieldName = this.consume("IDENTIFIER", "Expected field name").value;
        const fieldType = this.parseTypeExpr();

        // Optional struct tag `json:"..."`
        if (this.check("STRING")) {
          this.advance();
        }

        const fDecl: FieldDecl = {
          name: this.toAilFieldName(fieldName),
          typeAnnotation: fieldType,
          span: emptySpan(),
        };

        const fieldNodeId = `field:${name}.${fDecl.name}`;
        this.flushPendingTrivia(fieldNodeId);
        fields.push(fDecl);
        this.match("SEMICOLON");
      }

      this.consume("RBRACE", "Expected '}' closing struct");
      this.match("SEMICOLON");

      structs.set(name, { name, fields, isExported, trivia });
      return;
    }

    // Check if enum: type Name string followed by const (...)
    if (this.check("IDENTIFIER") && this.peek().value === "string") {
      this.advance(); // consume string
      this.match("SEMICOLON");

      // Check if following item is const block of enum variants
      const variants = this.lookaheadEnumVariants(name);
      if (variants.length > 0) {
        const typeDecl: TypeDecl = {
          kind: "TypeDecl",
          isEnum: true,
          name,
          typeParams: [],
          variants: variants.map((v) => ({ name: v, span: emptySpan() })),
          span: emptySpan(),
        };
        const nodeId = `type:${name}`;
        for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
        items.push(typeDecl);
        return;
      }

      // Plain alias
      const typeDecl: TypeDecl = {
        kind: "TypeDecl",
        isEnum: false,
        name,
        typeParams: [],
        aliasType: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
        span: emptySpan(),
      };
      items.push(typeDecl);
      return;
    }

    // Default: type Name BaseType
    const baseType = this.parseTypeExpr();
    const typeDecl: TypeDecl = {
      kind: "TypeDecl",
      isEnum: false,
      name,
      typeParams: [],
      aliasType: baseType,
      span: emptySpan(),
    };
    items.push(typeDecl);
    this.match("SEMICOLON");
  }

  private lookaheadEnumVariants(typeName: string): string[] {
    const saved = this.cur;
    // skip comments
    while (this.cur < this.tokens.length && this.tokens[this.cur].kind === "COMMENT") {
      this.cur++;
    }

    if (this.cur >= this.tokens.length || this.tokens[this.cur].kind !== "CONST") {
      this.cur = saved;
      return [];
    }
    this.cur++; // consume CONST

    const variants: string[] = [];
    if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "LPAREN") {
      this.cur++; // consume '('
      while (
        this.cur < this.tokens.length &&
        this.tokens[this.cur].kind !== "RPAREN" &&
        this.tokens[this.cur].kind !== "EOF"
      ) {
        while (this.cur < this.tokens.length && this.tokens[this.cur].kind === "COMMENT") {
          this.cur++;
        }
        if (this.tokens[this.cur].kind === "IDENTIFIER") {
          const constName = this.tokens[this.cur].value;
          this.cur++;
          // check if type matches typeName or constName starts with typeName
          let matched = false;
          if (
            this.cur < this.tokens.length &&
            this.tokens[this.cur].kind === "IDENTIFIER" &&
            this.tokens[this.cur].value === typeName
          ) {
            this.cur++;
            matched = true;
          } else if (constName.startsWith(typeName)) {
            matched = true;
          }

          if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "ASSIGN") {
            this.cur++;
            if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "STRING") {
              const val = this.tokens[this.cur].value;
              this.cur++;
              variants.push(val || constName.replace(typeName, ""));
            }
          } else if (matched) {
            variants.push(constName.replace(typeName, ""));
          }
        } else {
          this.cur++;
        }
        if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "SEMICOLON") {
          this.cur++;
        }
      }
      if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "RPAREN") {
        this.cur++;
        // Successfully consumed enum const block! Keep new cur.
        return variants;
      }
    }

    this.cur = saved;
    return [];
  }

  private parseConst(items: ModuleItem[]): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'const'

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("RPAREN")) break;
        this.parseSingleConstOrVar(items, true, trivia);
      }
      this.consume("RPAREN", "Expected ')' closing const block");
      return;
    }

    this.parseSingleConstOrVar(items, true, trivia);
  }

  private parseVar(items: ModuleItem[]): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'var'

    if (this.check("LPAREN")) {
      this.advance();
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("RPAREN")) break;
        this.parseSingleConstOrVar(items, false, trivia);
      }
      this.consume("RPAREN", "Expected ')' closing var block");
      return;
    }

    this.parseSingleConstOrVar(items, false, trivia);
  }

  private parseSingleConstOrVar(
    items: ModuleItem[],
    isConst: boolean,
    trivia: TriviaItem[],
  ): void {
    const name = this.consume("IDENTIFIER", "Expected constant/variable name").value;
    const isExported = /^[A-Z]/.test(name);

    let typeAnnotation: TypeExpr | undefined;
    if (!this.check("ASSIGN")) {
      typeAnnotation = this.parseTypeExpr();
    }

    let value: Expr = {
      kind: "LiteralExpr",
      literalKind: "nil",
      value: null,
      rawValue: "nil",
      span: emptySpan(),
    };
    if (this.match("ASSIGN")) {
      value = this.parseExpr();
    }

    if (isConst) {
      const decl: ConstDecl = {
        kind: "ConstDecl",
        name,
        isExported,
        typeAnnotation,
        value,
        span: emptySpan(),
      };
      const nodeId = `const:${name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      items.push(decl);
    } else {
      const decl: VarDecl = {
        kind: "VarDecl",
        name,
        isExported,
        isMut: true,
        typeAnnotation,
        value,
        span: emptySpan(),
      };
      const nodeId = `var:${name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      items.push(decl);
    }

    this.match("SEMICOLON");
  }

  private parseFunc(
    items: ModuleItem[],
    receiverMethods: Map<string, MethodDecl[]>,
    constructors: Map<string, FunctionDecl>,
  ): void {
    const trivia = [...this.pendingTrivia];
    this.pendingTrivia = [];
    this.advance(); // consume 'func'

    // Check if receiver method: func (self *Type) MethodName(...)
    let receiverType: string | null = null;
    let receiverParam: string | null = null;

    if (this.check("LPAREN")) {
      this.advance(); // consume '('
      receiverParam = this.consume("IDENTIFIER", "Expected receiver variable name").value;
      if (this.match("STAR")) {
        // pointer receiver *Type
        receiverType = this.consume("IDENTIFIER", "Expected receiver type").value;
      } else {
        receiverType = this.consume("IDENTIFIER", "Expected receiver type").value;
      }
      this.consume("RPAREN", "Expected ')' closing receiver");
    }

    const fnName = this.consume("IDENTIFIER", "Expected function name").value;
    const isExported = /^[A-Z]/.test(fnName);

    // Parameters
    this.consume("LPAREN", "Expected '(' for parameters");
    const params: ParamDecl[] = [];
    while (!this.check("RPAREN") && !this.isAtEnd()) {
      const paramName = this.consume("IDENTIFIER", "Expected param name").value;
      const paramType = this.parseTypeExpr();
      params.push({
        name: paramName,
        typeAnnotation: paramType,
        span: emptySpan(),
      });
      if (!this.match("COMMA")) break;
    }
    this.consume("RPAREN", "Expected ')' closing params");

    // Return type
    let returnType: TypeExpr | null = null;
    if (!this.check("LBRACE")) {
      returnType = this.parseReturnType();
    }

    // Body
    const body = this.parseBlock();

    if (receiverType) {
      if (receiverParam && receiverParam !== "self") {
        this.renameIdentifier(body, receiverParam, "self");
      }
      const methodDecl: MethodDecl = {
        kind: "MethodDecl",
        name: this.toAilMethodName(fnName),
        isStatic: false,
        isAsync: false,
        params,
        returnType,
        body,
        isExpressionBodied: false,
        span: emptySpan(),
      };
      const nodeId = `method:${receiverType}.${methodDecl.name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);

      let list = receiverMethods.get(receiverType);
      if (!list) {
        list = [];
        receiverMethods.set(receiverType, list);
      }
      list.push(methodDecl);
      return;
    }

    // Check if function is a constructor: func NewStructName(...) *StructName or StructName
    if (fnName.startsWith("New")) {
      const targetStruct = fnName.slice(3);
      const fnDecl: FunctionDecl = {
        kind: "FunctionDecl",
        name: fnName,
        isExported,
        isAsync: false,
        typeParams: [],
        params,
        returnType,
        body,
        isExpressionBodied: false,
        span: emptySpan(),
      };
      const nodeId = `fn:${fnDecl.name}`;
      for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
      constructors.set(targetStruct, fnDecl);
      return;
    }

    // Standard top-level function
    const fnDecl: FunctionDecl = {
      kind: "FunctionDecl",
      name: fnName === "main" ? "__top_level__" : this.toAilMethodName(fnName),
      isExported,
      isAsync: false,
      typeParams: [],
      params,
      returnType,
      body,
      isExpressionBodied: false,
      span: emptySpan(),
    };
    const nodeId = `fn:${fnDecl.name}`;
    for (const t of trivia) this.trivia.addLeadingTrivia(nodeId, t);
    items.push(fnDecl);
  }

  private renameIdentifier(node: any, from: string, to: string): void {
    if (!node || typeof node !== "object") return;
    if (node.kind === "IdentifierExpr" && node.name === from) {
      node.name = to;
      return;
    }
    for (const key of Object.keys(node)) {
      const val = node[key];
      if (Array.isArray(val)) {
        for (const item of val) this.renameIdentifier(item, from, to);
      } else if (val && typeof val === "object") {
        this.renameIdentifier(val, from, to);
      }
    }
  }

  private parseReturnType(): TypeExpr {
    if (this.check("LPAREN")) {
      this.advance();
      const types: TypeExpr[] = [];
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        types.push(this.parseTypeExpr());
        if (!this.match("COMMA")) break;
      }
      this.consume("RPAREN", "Expected ')' closing multiple return types");

      // Check if (T, error) -> Result[T, str]
      if (
        types.length === 2 &&
        types[1].kind === "NamedType" &&
        (types[1].name === "error" || types[1].name === "Error")
      ) {
        return {
          kind: "ResultType",
          okType: types[0],
          errType: { kind: "PrimitiveType", primitive: "str", span: emptySpan() },
          span: emptySpan(),
        };
      }
      return types[0] ?? { kind: "PrimitiveType", primitive: "void", span: emptySpan() };
    }
    return this.parseTypeExpr();
  }

  private parseBlock(): Block {
    this.consume("LBRACE", "Expected '{' to start block");
    const statements: Statement[] = [];

    while (!this.check("RBRACE") && !this.isAtEnd()) {
      this.collectLeadingTrivia();
      if (this.check("RBRACE")) break;
      const stmt = this.parseStatement();
      if (stmt) {
        statements.push(stmt);
      }
      this.match("SEMICOLON");
    }

    this.consume("RBRACE", "Expected '}' to close block");
    return { kind: "Block", statements, span: emptySpan() };
  }

  private parseStatement(): Statement | null {
    // Return statement
    if (this.check("RETURN")) {
      this.advance();
      if (this.check("SEMICOLON") || this.check("RBRACE")) {
        return { kind: "ReturnStmt", value: null, span: emptySpan() };
      }

      // Check if multiple return values like return val, nil -> Result Ok(val)
      const first = this.parseExpr(1);
      if (this.match("COMMA")) {
        const second = this.parseExpr(1);
        if (
          second.kind === "LiteralExpr" &&
          second.literalKind === "nil" &&
          !(first.kind === "LiteralExpr" && first.literalKind === "nil")
        ) {
          // return val, nil -> ret Ok(val)
          return {
            kind: "ReturnStmt",
            value: {
              kind: "CallExpr",
              callee: { kind: "IdentifierExpr", name: "Ok", span: emptySpan() },
              args: [first],
              span: emptySpan(),
            },
            span: emptySpan(),
          };
        }
        // return "", fmt.Errorf(...) -> ret Err(...)
        if (first.kind === "LiteralExpr" && second.kind === "CallExpr") {
          let errArgs = second.args;
          if (
            second.args.length >= 2 &&
            second.args[0].kind === "LiteralExpr" &&
            (second.args[0].value === "%v" || second.args[0].value === "%s")
          ) {
            errArgs = [second.args[1]];
          }
          return {
            kind: "ReturnStmt",
            value: {
              kind: "CallExpr",
              callee: { kind: "IdentifierExpr", name: "Err", span: emptySpan() },
              args: errArgs,
              span: emptySpan(),
            },
            span: emptySpan(),
          };
        }
        return { kind: "ReturnStmt", value: first, span: emptySpan() };
      }

      return { kind: "ReturnStmt", value: first, span: emptySpan() };
    }

    // Var declaration: var x Type = expr
    if (this.check("VAR")) {
      this.advance();
      const name = this.consume("IDENTIFIER", "Expected variable name").value;
      let typeAnn: TypeExpr | undefined;
      if (!this.check("ASSIGN")) {
        typeAnn = this.parseTypeExpr();
      }
      let val: Expr = {
        kind: "LiteralExpr",
        literalKind: "nil",
        value: null,
        rawValue: "nil",
        span: emptySpan(),
      };
      if (this.match("ASSIGN")) {
        val = this.parseExpr();
      }
      return {
        kind: "LetBinding",
        name,
        isMut: true,
        typeAnnotation: typeAnn ?? null,
        init: val,
        span: emptySpan(),
      };
    }

    // If statement: if cond { ... } else if ... else { ... }
    if (this.check("IF")) {
      this.advance();
      // Optional init statement: if init; cond { ... }
      let condExpr: Expr;
      this.inControlHeader = true;
      try {
        const initialExpr = this.parseExpr();
        if (this.match("SEMICOLON")) {
          condExpr = this.parseExpr();
        } else {
          condExpr = initialExpr;
        }
      } finally {
        this.inControlHeader = false;
      }

      const thenBranch = this.parseBlock();
      const elifBranches: { condition: Expr; body: Block; span: Span }[] = [];
      let elseBranch: Block | null = null;

      while (this.match("ELSE")) {
        if (this.check("IF")) {
          this.advance();
          let elifCond: Expr;
          this.inControlHeader = true;
          try {
            const initialElif = this.parseExpr();
            if (this.match("SEMICOLON")) {
              elifCond = this.parseExpr();
            } else {
              elifCond = initialElif;
            }
          } finally {
            this.inControlHeader = false;
          }
          const elifBody = this.parseBlock();
          elifBranches.push({ condition: elifCond, body: elifBody, span: emptySpan() });
        } else {
          elseBranch = this.parseBlock();
          break;
        }
      }

      return {
        kind: "IfStmt",
        condition: condExpr,
        thenBranch,
        elifBranches,
        elseBranch,
        span: emptySpan(),
      };
    }

    // Switch statement: switch expr { case ...: ... }
    if (this.check("SWITCH")) {
      this.advance();
      let target: Expr;
      this.inControlHeader = true;
      try {
        target = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      this.consume("LBRACE", "Expected '{' after switch");
      const cases: MatchCase[] = [];

      while (!this.check("RBRACE") && !this.isAtEnd()) {
        this.collectLeadingTrivia();
        if (this.check("CASE")) {
          this.advance();
          const patExpr = this.parseExpr();
          this.consume("COLON", "Expected ':' after case");
          const stmts: Statement[] = [];
          while (
            !this.check("CASE") &&
            !this.check("DEFAULT") &&
            !this.check("RBRACE") &&
            !this.isAtEnd()
          ) {
            const s = this.parseStatement();
            if (s) stmts.push(s);
            this.match("SEMICOLON");
          }

          let pattern: Pattern;
          if (patExpr.kind === "LiteralExpr") {
            pattern = { kind: "LiteralPattern", value: patExpr, span: emptySpan() };
          } else if (patExpr.kind === "IdentifierExpr") {
            pattern = { kind: "IdentifierPattern", name: patExpr.name, span: emptySpan() };
          } else {
            pattern = { kind: "WildcardPattern", span: emptySpan() };
          }

          cases.push({
            pattern,
            body: { kind: "Block", statements: stmts, span: emptySpan() },
            span: emptySpan(),
          });
        } else if (this.check("DEFAULT")) {
          this.advance();
          this.consume("COLON", "Expected ':' after default");
          const stmts: Statement[] = [];
          while (
            !this.check("CASE") &&
            !this.check("DEFAULT") &&
            !this.check("RBRACE") &&
            !this.isAtEnd()
          ) {
            const s = this.parseStatement();
            if (s) stmts.push(s);
            this.match("SEMICOLON");
          }
          cases.push({
            pattern: { kind: "WildcardPattern", span: emptySpan() },
            body: { kind: "Block", statements: stmts, span: emptySpan() },
            span: emptySpan(),
          });
        } else {
          this.advance();
        }
      }

      this.consume("RBRACE", "Expected '}' closing switch");
      return { kind: "MatchStmt", target, cases, span: emptySpan() };
    }

    // For statement: for cond { ... } OR for _, item := range items OR for i := 0; i < n; i++
    if (this.check("FOR")) {
      this.advance();
      if (this.check("LBRACE")) {
        // infinite loop
        const body = this.parseBlock();
        return {
          kind: "WhileStmt",
          condition: {
            kind: "LiteralExpr",
            literalKind: "boolean",
            value: true,
            rawValue: "true",
            span: emptySpan(),
          },
          body,
          span: emptySpan(),
        };
      }

      // Check range loop: for _, item := range items
      const checkpoint = this.cur;
      let isRange = false;
      let rangeVar = "";
      if (this.check("IDENTIFIER")) {
        const firstTok = this.advance();
        if (this.match("COMMA")) {
          if (this.check("IDENTIFIER")) {
            rangeVar = this.advance().value;
            if (this.match("DEFINE") && this.match("RANGE")) {
              isRange = true;
            }
          }
        } else if (this.match("DEFINE") && this.match("RANGE")) {
          rangeVar = firstTok.value;
          isRange = true;
        }
      }

      if (isRange) {
        let iterExpr: Expr;
        this.inControlHeader = true;
        try {
          iterExpr = this.parseExpr();
        } finally {
          this.inControlHeader = false;
        }
        const body = this.parseBlock();
        return {
          kind: "ForStmt",
          variable: rangeVar,
          iterable: iterExpr,
          body,
          span: emptySpan(),
        };
      }

      // Reset
      this.cur = checkpoint;

      // Check if 3-part for: scan ahead to see if there is a ';' before '{'
      let hasSemi = false;
      let scanIdx = this.cur;
      while (
        scanIdx < this.tokens.length &&
        this.tokens[scanIdx].kind !== "LBRACE" &&
        this.tokens[scanIdx].kind !== "EOF"
      ) {
        if (this.tokens[scanIdx].kind === "SEMICOLON") {
          hasSemi = true;
          break;
        }
        scanIdx++;
      }

      if (hasSemi) {
        // 3-part for: for init; cond; post { ... }
        let loopVar = "i";
        let iterLimit: Expr = {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 10,
          rawValue: "10",
          span: emptySpan(),
        };
        if (this.check("IDENTIFIER")) {
          loopVar = this.advance().value;
          if (this.match("DEFINE") || this.match("ASSIGN")) {
            this.parseExpr();
          }
        }
        this.consume("SEMICOLON", "Expected ';' in 3-part for loop");
        const cond = this.parseExpr();
        if (cond.kind === "BinaryExpr" && (cond.operator === "<" || cond.operator === "<=")) {
          iterLimit = cond.right;
        }
        this.consume("SEMICOLON", "Expected ';' in 3-part for loop");
        this.parseStatement(); // consume update e.g. i++
        const body = this.parseBlock();
        return {
          kind: "ForStmt",
          variable: loopVar,
          iterable: iterLimit,
          body,
          span: emptySpan(),
        };
      }

      let cond: Expr;
      this.inControlHeader = true;
      try {
        cond = this.parseExpr();
      } finally {
        this.inControlHeader = false;
      }
      const body = this.parseBlock();
      return {
        kind: "WhileStmt",
        condition: cond,
        body,
        span: emptySpan(),
      };
    }

    // Expression statement or assignment
    const expr = this.parseExpr(0);

    // Check for short declaration: x := expr or found, err := Lookup(key)
    if (this.match("DEFINE")) {
      const val = this.parseExpr();
      if (expr.kind === "IdentifierExpr") {
        return {
          kind: "LetBinding",
          name: expr.name,
          isMut: true,
          typeAnnotation: null,
          init: val,
          span: emptySpan(),
        };
      }
      if (expr.kind === "BinaryExpr" && (expr as any).operator === ",") {
        // tuple binding: found, err := expr
        // Lookahead to see if next is if err != nil
        const bin = expr as any;
        const lhs = bin.left && bin.left.kind === "IdentifierExpr" ? bin.left.name : "found";
        if (this.checkIfErrNotNilFollows()) {
          return {
            kind: "LetBinding",
            name: lhs,
            isMut: false,
            typeAnnotation: null,
            init: { kind: "PostfixTryExpr", operand: val, span: emptySpan() },
            span: emptySpan(),
          };
        }
        return {
          kind: "LetBinding",
          name: lhs,
          isMut: true,
          typeAnnotation: null,
          init: val,
          span: emptySpan(),
        };
      }
    }

    // Assignments
    if (
      this.check("ASSIGN") ||
      this.check("PLUS_ASSIGN") ||
      this.check("MINUS_ASSIGN") ||
      this.check("STAR_ASSIGN") ||
      this.check("SLASH_ASSIGN")
    ) {
      const opTok = this.advance();
      const val = this.parseExpr();
      return {
        kind: "AssignStmt",
        target: expr,
        op: opTok.value as AssignOp,
        value: val,
        span: emptySpan(),
      };
    }

    if (this.match("PLUS_PLUS")) {
      return {
        kind: "AssignStmt",
        target: expr,
        op: "+=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 1,
          rawValue: "1",
          span: emptySpan(),
        },
        span: emptySpan(),
      };
    }

    if (this.match("MINUS_MINUS")) {
      return {
        kind: "AssignStmt",
        target: expr,
        op: "-=",
        value: {
          kind: "LiteralExpr",
          literalKind: "number",
          value: 1,
          rawValue: "1",
          span: emptySpan(),
        },
        span: emptySpan(),
      };
    }

    return { kind: "ExprStmt", expr, span: emptySpan() };
  }

  private checkIfErrNotNilFollows(): boolean {
    const saved = this.cur;
    while (this.cur < this.tokens.length && this.tokens[this.cur].kind === "SEMICOLON") {
      this.cur++;
    }
    if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "IF") {
      this.cur++;
      if (
        this.cur < this.tokens.length &&
        this.tokens[this.cur].kind === "IDENTIFIER" &&
        this.tokens[this.cur].value === "err"
      ) {
        this.cur++;
        if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "NEQ") {
          this.cur++;
          if (
            this.cur < this.tokens.length &&
            this.tokens[this.cur].kind === "IDENTIFIER" &&
            this.tokens[this.cur].value === "nil"
          ) {
            // Yes! Skip the entire if err != nil { return ..., err } block!
            this.cur++;
            if (this.cur < this.tokens.length && this.tokens[this.cur].kind === "LBRACE") {
              let depth = 1;
              this.cur++;
              while (this.cur < this.tokens.length && depth > 0) {
                if (this.tokens[this.cur].kind === "LBRACE") depth++;
                else if (this.tokens[this.cur].kind === "RBRACE") depth--;
                this.cur++;
              }
              return true;
            }
          }
        }
      }
    }
    this.cur = saved;
    return false;
  }

  // Pratt / Precedence Climbing Expression Parser
  private parseExpr(minPrec = 1): Expr {
    let left = this.parsePrefix();

    while (!this.isAtEnd()) {
      const prec = this.getInfixPrecedence();
      if (prec < minPrec) break;

      left = this.parseInfix(left, prec);
    }

    return left;
  }

  private parsePrefix(): Expr {
    // Unary operators
    if (this.match("BANG")) {
      const operand = this.parseExpr(7);
      return { kind: "UnaryExpr", operator: "not", operand, span: emptySpan() };
    }
    if (this.match("MINUS")) {
      const operand = this.parseExpr(7);
      return { kind: "UnaryExpr", operator: "-", operand, span: emptySpan() };
    }
    if (this.match("PLUS")) {
      return this.parseExpr(7);
    }
    if (this.match("STAR")) {
      // dereference *ptr
      return this.parseExpr(7);
    }
    if (this.match("AMP")) {
      // address-of &Struct{...}
      return this.parseExpr(7);
    }

    // Grouping
    if (this.match("LPAREN")) {
      const expr = this.parseExpr();
      this.consume("RPAREN", "Expected ')' closing expression");
      return expr;
    }

    // Literals
    if (this.check("NUMBER")) {
      const tok = this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: Number(tok.value),
        rawValue: tok.value,
        span: emptySpan(),
      };
    }

    if (this.check("STRING")) {
      const tok = this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value,
        rawValue: JSON.stringify(tok.value),
        span: emptySpan(),
      };
    }

    if (this.check("IDENTIFIER")) {
      const tok = this.advance();
      if (tok.value === "true") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: true,
          rawValue: "true",
          span: emptySpan(),
        };
      }
      if (tok.value === "false") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: false,
          rawValue: "false",
          span: emptySpan(),
        };
      }
      if (tok.value === "nil") {
        return {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "nil",
          span: emptySpan(),
        };
      }

      // Check if struct literal: TypeName{ Field: Val, ... }
      if (!this.inControlHeader && this.check("LBRACE") && /^[A-Z]/.test(tok.value)) {
        this.advance(); // consume '{'
        const props: { key?: string; value: Expr; isSpread?: boolean }[] = [];
        while (!this.check("RBRACE") && !this.isAtEnd()) {
          this.collectLeadingTrivia();
          if (this.check("RBRACE")) break;
          const k = this.consume("IDENTIFIER", "Expected struct field name").value;
          this.consume("COLON", "Expected ':' after struct field");
          const v = this.parseExpr(1);
          props.push({ key: this.toAilFieldName(k), value: v });
          if (!this.match("COMMA")) break;
        }
        this.consume("RBRACE", "Expected '}' closing struct literal");
        return {
          kind: "CallExpr",
          callee: { kind: "IdentifierExpr", name: tok.value, span: emptySpan() },
          args: props.map((p) => p.value),
          span: emptySpan(),
        };
      }

      return { kind: "IdentifierExpr", name: tok.value, span: emptySpan() };
    }

    // Array / Slice literal: []Type{ ... }
    if (this.match("LBRACKET")) {
      this.consume("RBRACKET", "Expected ']' in slice literal");
      this.parseTypeExpr(); // consume element type
      this.consume("LBRACE", "Expected '{' to start slice elements");
      const elements: Expr[] = [];
      while (!this.check("RBRACE") && !this.isAtEnd()) {
        if (this.check("RBRACE")) break;
        elements.push(this.parseExpr(1));
        if (this.match("COMMA")) {
          if (this.check("RBRACE")) break;
          continue;
        }
        break;
      }
      this.consume("RBRACE", "Expected '}' closing slice");
      return { kind: "ArrayLiteralExpr", elements, span: emptySpan() };
    }

    throw new Error(`Unexpected token in Go expression: ${this.peek().kind} (${this.peek().value})`);
  }

  private getInfixPrecedence(): number {
    const k = this.peek().kind;
    switch (k) {
      case "OR":
        return 1;
      case "AND":
        return 2;
      case "EQ":
      case "NEQ":
      case "LT":
      case "LTE":
      case "GT":
      case "GTE":
        return 3;
      case "PLUS":
      case "MINUS":
      case "PIPE":
      case "CARET":
        return 4;
      case "STAR":
      case "SLASH":
      case "PERCENT":
      case "AMP":
        return 5;
      case "DOT":
      case "LPAREN":
      case "LBRACKET":
        return 8;
      case "COMMA":
        return 0;
      default:
        return -1;
    }
  }

  private parseInfix(left: Expr, prec: number): Expr {
    const tok = this.advance();

    // Call expression
    if (tok.kind === "LPAREN") {
      const args: Expr[] = [];
      while (!this.check("RPAREN") && !this.isAtEnd()) {
        args.push(this.parseExpr(1));
        if (!this.match("COMMA")) break;
      }
      this.consume("RPAREN", "Expected ')' closing call");

      // Check for fmt.Println -> print
      if (
        left.kind === "MemberAccessExpr" &&
        left.object.kind === "IdentifierExpr" &&
        left.object.name === "fmt"
      ) {
        if (left.property === "Println" || left.property === "Print") {
          return {
            kind: "CallExpr",
            callee: { kind: "IdentifierExpr", name: "print", span: emptySpan() },
            args,
            span: emptySpan(),
          };
        }
        if (left.property === "Sprintf" && args.length > 0 && args[0].kind === "LiteralExpr") {
          const rawFmt = String(args[0].value);
          const parts = rawFmt.split(/%v|%s|%d|%f/);
          return {
            kind: "TemplateLiteralExpr",
            quasis: parts,
            expressions: args.slice(1),
            span: emptySpan(),
          };
        }
      }

      // Check for strings.* lowering
      if (
        left.kind === "MemberAccessExpr" &&
        left.object.kind === "IdentifierExpr" &&
        left.object.name === "strings"
      ) {
        const target = args[0];
        if (left.property === "TrimSpace") {
          return {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: target,
              property: "trim",
              isSafeNav: false,
              span: emptySpan(),
            },
            args: [],
            span: emptySpan(),
          };
        }
        if (left.property === "Contains") {
          return {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: target,
              property: "contains",
              isSafeNav: false,
              span: emptySpan(),
            },
            args: args.slice(1),
            span: emptySpan(),
          };
        }
        if (left.property === "HasPrefix") {
          return {
            kind: "CallExpr",
            callee: {
              kind: "MemberAccessExpr",
              object: target,
              property: "startsWith",
              isSafeNav: false,
              span: emptySpan(),
            },
            args: args.slice(1),
            span: emptySpan(),
          };
        }
      }

      // Check for len(x) -> x.len
      if (left.kind === "IdentifierExpr" && left.name === "len" && args.length === 1) {
        return {
          kind: "MemberAccessExpr",
          object: args[0],
          property: "len",
          isSafeNav: false,
          span: emptySpan(),
        };
      }

      return { kind: "CallExpr", callee: left, args, span: emptySpan() };
    }

    // Member access: left.property
    if (tok.kind === "DOT") {
      const propTok = this.consume("IDENTIFIER", "Expected member property name");
      return {
        kind: "MemberAccessExpr",
        object: left,
        property: this.toAilFieldName(propTok.value),
        isSafeNav: false,
        span: emptySpan(),
      };
    }

    // Index or slice access: left[index]
    if (tok.kind === "LBRACKET") {
      const idx = this.parseExpr();
      if (this.match("COLON")) {
        const high = this.parseExpr();
        this.consume("RBRACKET", "Expected ']' closing slice");
        return {
          kind: "CallExpr",
          callee: {
            kind: "MemberAccessExpr",
            object: left,
            property: "slice",
            isSafeNav: false,
            span: emptySpan(),
          },
          args: [idx, high],
          span: emptySpan(),
        };
      }
      this.consume("RBRACKET", "Expected ']' closing index");
      return { kind: "IndexExpr", object: left, index: idx, span: emptySpan() };
    }

    // Binary operations
    const op = this.toBinaryOp(tok.kind);
    const right = this.parseExpr(prec + 1);
    return { kind: "BinaryExpr", left, operator: op, right, span: emptySpan() };
  }

  private toBinaryOp(kind: GoTokenKind): BinaryOp {
    switch (kind) {
      case "AND":
        return "and";
      case "OR":
        return "or";
      case "EQ":
        return "==";
      case "NEQ":
        return "!=";
      case "LT":
        return "<";
      case "LTE":
        return "<=";
      case "GT":
        return ">";
      case "GTE":
        return ">=";
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
      case "AMP":
        return "&";
      case "PIPE":
        return "|";
      case "CARET":
        return "^";
      case "COMMA":
        return "," as BinaryOp;
      default:
        return "==";
    }
  }

  private parseTypeExpr(): TypeExpr {
    // Pointer type *T -> T?
    if (this.match("STAR")) {
      const inner = this.parseTypeExpr();
      return { kind: "OptionType", innerType: inner, span: emptySpan() };
    }

    // Slice type []T -> T[]
    if (this.match("LBRACKET")) {
      this.consume("RBRACKET", "Expected ']' in slice type");
      const elem = this.parseTypeExpr();
      return { kind: "ArrayType", elementType: elem, span: emptySpan() };
    }

    // Map type map[K]V
    if (this.check("IDENTIFIER") && this.peek().value === "map") {
      this.advance();
      this.consume("LBRACKET", "Expected '[' after map");
      const keyType = this.parseTypeExpr();
      this.consume("RBRACKET", "Expected ']' closing map key");
      const valType = this.parseTypeExpr();
      return {
        kind: "NamedType",
        name: "Map",
        typeArgs: [keyType, valType],
        span: emptySpan(),
      };
    }

    const id = this.consume("IDENTIFIER", "Expected type name").value;
    switch (id) {
      case "int":
      case "int64":
      case "int32":
      case "int16":
      case "int8":
      case "uint":
      case "uint64":
      case "uint32":
        return { kind: "PrimitiveType", primitive: "int", span: emptySpan() };
      case "float64":
      case "float32":
        return { kind: "PrimitiveType", primitive: "float", span: emptySpan() };
      case "string":
        return { kind: "PrimitiveType", primitive: "str", span: emptySpan() };
      case "bool":
        return { kind: "PrimitiveType", primitive: "bool", span: emptySpan() };
      case "byte":
        return { kind: "PrimitiveType", primitive: "byte", span: emptySpan() };
      case "error":
        return { kind: "NamedType", name: "str", span: emptySpan() };
      case "any":
        return { kind: "NamedType", name: "any", span: emptySpan() };
      default:
        return { kind: "NamedType", name: id, span: emptySpan() };
    }
  }

  private toAilFieldName(str: string): string {
    if (str.length === 0) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  private toAilMethodName(str: string): string {
    if (str.length === 0) return str;
    return str.charAt(0).toLowerCase() + str.slice(1);
  }

  // Token helper methods
  private check(kind: GoTokenKind): boolean {
    if (this.isAtEnd()) return kind === "EOF";
    return this.peek().kind === kind;
  }

  private match(kind: GoTokenKind): boolean {
    if (this.check(kind)) {
      this.advance();
      return true;
    }
    return false;
  }

  private consume(kind: GoTokenKind, message: string): GoToken {
    if (this.check(kind)) return this.advance();
    throw new Error(
      `GoDecompiler syntax error at line ${this.peek().line}, col ${this.peek().col}: ${message}. Found: ${this.peek().kind} (${this.peek().value})`,
    );
  }

  private advance(): GoToken {
    if (!this.isAtEnd()) this.cur++;
    return this.previous();
  }

  private isAtEnd(): boolean {
    return this.cur >= this.tokens.length || this.tokens[this.cur].kind === "EOF";
  }

  private peek(offset = 0): GoToken {
    const idx = this.cur + offset;
    return idx < this.tokens.length
      ? this.tokens[idx]
      : { kind: "EOF", value: "", line: 0, col: 0 };
  }

  private previous(): GoToken {
    return this.tokens[this.cur - 1];
  }
}

export function decompileGo(
  source: string,
  filePath = "source.go",
  options: AilGeneratorOptions = {},
): { ast: Module; ail: string; trivia: CstTriviaTable } {
  const decompiler = new GoDecompiler(source, filePath);
  const { ast, trivia } = decompiler.decompile();
  trivia.setOriginalSource(source);

  const generator = new AilGenerator({ ...options, trivia });
  const ail = generator.generate(ast);

  return { ast, ail, trivia };
}
