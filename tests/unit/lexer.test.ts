import { describe, expect, it } from "vitest";
import { LexerError, tokenize, tokenizeWithTrivia } from "../../src/core/lexer.js";
import type { TokenKind } from "../../src/core/tokens.js";

function kinds(source: string): TokenKind[] {
  return tokenize(source).map((t) => t.kind);
}

describe("AIL 2.0 Lexer & Tokenizer Engine", () => {
  describe("Literals & Primitives", () => {
    it("scans numbers including ints, floats, hex, binary, and underscores", () => {
      const src = "42 3.14 0x1A 0b1010 1_000_000 1e-4";
      const tokens = tokenize(src);
      const nums = tokens.filter((t) => t.kind === "NUMBER");
      expect(nums.map((t) => t.value)).toEqual(["42", "3.14", "0x1A", "0b1010", "1000000", "1e-4"]);
    });

    it("scans single-line and escape sequence strings", () => {
      const src = `"hello world" 'test' "line\\nbreak"`;
      const tokens = tokenize(src);
      const strs = tokens.filter((t) => t.kind === "STRING");
      expect(strs.map((t) => t.value)).toEqual(["hello world", "test", "line\nbreak"]);
    });

    it("scans triple-quoted multi-line strings", () => {
      const src = `"""first line
second line
third line"""`;
      const tokens = tokenize(src);
      const strToken = tokens.find((t) => t.kind === "STRING");
      expect(strToken?.value).toBe("first line\nsecond line\nthird line");
    });

    it("scans backtick template strings without substitutions", () => {
      const src = "`hello world`";
      const tokens = tokenize(src);
      const t = tokens.find((tok) => tok.kind === "TEMPLATE_NO_SUBST");
      expect(t).toBeDefined();
      expect(t?.value).toBe("hello world");
    });

    it("scans multiline backtick template strings", () => {
      const src = `\`line 1
line 2
line 3\``;
      const tokens = tokenize(src);
      const t = tokens.find((tok) => tok.kind === "TEMPLATE_NO_SUBST");
      expect(t).toBeDefined();
      expect(t?.value).toBe("line 1\nline 2\nline 3");
    });

    it("scans backtick template strings with ${...} interpolation expressions", () => {
      const src = "`Hello ${name}, you have ${count + 1} items!`";
      const tokens = tokenize(src);
      expect(tokens.map((tok) => tok.kind)).toEqual([
        "TEMPLATE_HEAD",
        "IDENT",
        "TEMPLATE_MIDDLE",
        "IDENT",
        "PLUS",
        "NUMBER",
        "TEMPLATE_TAIL",
        "NEWLINE",
        "EOF",
      ]);
      const head = tokens.find((tok) => tok.kind === "TEMPLATE_HEAD");
      const mid = tokens.find((tok) => tok.kind === "TEMPLATE_MIDDLE");
      const tail = tokens.find((tok) => tok.kind === "TEMPLATE_TAIL");
      expect(head?.value).toBe("Hello ");
      expect(mid?.value).toBe(", you have ");
      expect(tail?.value).toBe(" items!");
    });

    it("scans escaped backticks and escaped dollar braces in template strings", () => {
      const src = "`Cost: \\${price} in \\`USD\\``";
      const tokens = tokenize(src);
      const t = tokens.find((tok) => tok.kind === "TEMPLATE_NO_SUBST");
      expect(t).toBeDefined();
      expect(t?.value).toBe("Cost: ${price} in `USD`");
    });

    it("scans booleans and nil", () => {
      const src = "true false nil";
      expect(kinds(src)).toEqual(["BOOLEAN", "BOOLEAN", "NIL", "NEWLINE", "EOF"]);
    });

    it("scans single-token BPE dictionary types", () => {
      const src = "int str float bool num byte char void";
      expect(kinds(src)).toEqual([
        "TYPE_INT",
        "TYPE_STR",
        "TYPE_FLOAT",
        "TYPE_BOOL",
        "TYPE_NUM",
        "TYPE_BYTE",
        "TYPE_CHAR",
        "TYPE_VOID",
        "NEWLINE",
        "EOF",
      ]);
    });
  });

  describe("Colon Compaction & Parameter Syntax", () => {
    it("correctly tokenizes compacted parameters (x:str, id:int) without space", () => {
      const src = "fn test(x:str, id:int, count:num)";
      const t = tokenize(src);
      expect(t.map((tok) => tok.kind)).toEqual([
        "FN",
        "IDENT",
        "LPAREN",
        "IDENT",
        "COLON",
        "TYPE_STR",
        "COMMA",
        "IDENT",
        "COLON",
        "TYPE_INT",
        "COMMA",
        "IDENT",
        "COLON",
        "TYPE_NUM",
        "RPAREN",
        "NEWLINE",
        "EOF",
      ]);
      expect(t.map((tok) => tok.value)).toEqual([
        "fn",
        "test",
        "(",
        "x",
        ":",
        "str",
        ",",
        "id",
        ":",
        "int",
        ",",
        "count",
        ":",
        "num",
        ")",
        "\n",
        "",
      ]);
    });
  });

  describe("Operators & Connectors", () => {
    it("scans comparisons, arithmetic, logic, and arrows", () => {
      const src = "+ - * / % == != <= >= < > && || ?? ?. -> => :: = | ! ?";
      expect(kinds(src)).toEqual([
        "PLUS",
        "MINUS",
        "STAR",
        "SLASH",
        "PERCENT",
        "EQ_EQ",
        "NOT_EQ",
        "LT_EQ",
        "GT_EQ",
        "LT",
        "GT",
        "AMP_AMP",
        "PIPE_PIPE",
        "QUESTION_QUESTION",
        "QUESTION_DOT",
        "ARROW",
        "FAT_ARROW",
        "COLON_COLON",
        "EQUAL",
        "PIPE",
        "BANG",
        "QUESTION",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("Step 21: scans := (COLON_EQUAL) and ::= (COLON_COLON_EQUAL) operators", () => {
      const src = ":= ::=";
      expect(kinds(src)).toEqual(["COLON_EQUAL", "COLON_COLON_EQUAL", "NEWLINE", "EOF"]);
    });

    it("scans postfix ? error unwrap operator without ambiguity", () => {
      const src = "fetchUser(id)?";
      expect(kinds(src)).toEqual([
        "IDENT",
        "LPAREN",
        "IDENT",
        "RPAREN",
        "QUESTION",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("Step 8: scans binary power, bitwise, and shift operators (**, &, |, ^, <<, >>, >>>)", () => {
      const src = "** & | ^ << >> >>>";
      expect(kinds(src)).toEqual([
        "STAR_STAR",
        "AMPERSAND",
        "PIPE",
        "CARET",
        "SHL",
        "SHR",
        "USHR",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("Step 8: correctly disambiguates multi-char operators from prefixes", () => {
      const src = "> >= >> >>> < <= << * *= ** & && | ||";
      expect(kinds(src)).toEqual([
        "GT",
        "GT_EQ",
        "SHR",
        "USHR",
        "LT",
        "LT_EQ",
        "SHL",
        "STAR",
        "STAR_EQUAL",
        "STAR_STAR",
        "AMPERSAND",
        "AMP_AMP",
        "PIPE",
        "PIPE_PIPE",
        "NEWLINE",
        "EOF",
      ]);
    });
  });

  describe("Two-Stage Indentation & Layout Engine", () => {
    it("emits INDENT, NEWLINE, and DEDENT for a basic block", () => {
      const src = `fn foo():
  let x = 1
  ret x`;

      expect(kinds(src)).toEqual([
        "FN",
        "IDENT",
        "LPAREN",
        "RPAREN",
        "COLON",
        "NEWLINE",
        "INDENT",
        "LET",
        "IDENT",
        "EQUAL",
        "NUMBER",
        "NEWLINE",
        "RET",
        "IDENT",
        "NEWLINE",
        "DEDENT",
        "EOF",
      ]);
    });

    it("handles blank lines inside indented blocks without emitting false tokens", () => {
      const src = `fn foo():
  let x = 1

  let y = 2

  ret x + y`;

      expect(kinds(src)).toEqual([
        "FN",
        "IDENT",
        "LPAREN",
        "RPAREN",
        "COLON",
        "NEWLINE",
        "INDENT",
        "LET",
        "IDENT",
        "EQUAL",
        "NUMBER",
        "NEWLINE",
        "LET",
        "IDENT",
        "EQUAL",
        "NUMBER",
        "NEWLINE",
        "RET",
        "IDENT",
        "PLUS",
        "IDENT",
        "NEWLINE",
        "DEDENT",
        "EOF",
      ]);
    });

    it("correctly handles nested blocks and multi-level dedents", () => {
      const src = `if a:
  if b:
    ret 1
ret 2`;

      expect(kinds(src)).toEqual([
        "IF",
        "IDENT",
        "COLON",
        "NEWLINE",
        "INDENT",
        "IF",
        "IDENT",
        "COLON",
        "NEWLINE",
        "INDENT",
        "RET",
        "NUMBER",
        "NEWLINE",
        "DEDENT",
        "DEDENT",
        "RET",
        "NUMBER",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("suppresses newlines and indentation inside brackets (implicit line continuation)", () => {
      const src = `let items = [
  1,
  2,
  3
]
ret items`;

      expect(kinds(src)).toEqual([
        "LET",
        "IDENT",
        "EQUAL",
        "LBRACKET",
        "NUMBER",
        "COMMA",
        "NUMBER",
        "COMMA",
        "NUMBER",
        "RBRACKET",
        "NEWLINE",
        "RET",
        "IDENT",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("supports permissive curly braces without emitting INDENT/DEDENT", () => {
      const src = `fn foo() {
  ret 42
}`;

      expect(kinds(src)).toEqual([
        "FN",
        "IDENT",
        "LPAREN",
        "RPAREN",
        "LBRACE",
        "RET",
        "NUMBER",
        "RBRACE",
        "NEWLINE",
        "EOF",
      ]);
    });

    it("throws LexerError on inconsistent unindentation", () => {
      const src = `if true:
    let x = 1
  let y = 2`;

      expect(() => tokenize(src, "test.ail")).toThrowError(LexerError);
      expect(() => tokenize(src, "test.ail")).toThrowError(/Inconsistent indentation/);
    });
  });

  describe("Comments & CST Trivia Preservation", () => {
    it("ignores single-line and multi-line comments in standard token stream", () => {
      const src = `# Top-level comment
fn test():
  // Inner comment
  /* Multi-line
     comment */
  ret 10 # trailing comment`;

      expect(kinds(src)).toEqual([
        "FN",
        "IDENT",
        "LPAREN",
        "RPAREN",
        "COLON",
        "NEWLINE",
        "INDENT",
        "RET",
        "NUMBER",
        "NEWLINE",
        "DEDENT",
        "EOF",
      ]);
    });

    it("captures comment trivia when requested via tokenizeWithTrivia", () => {
      const src = `// File license header
# Second comment
let a = 1`;

      const { comments } = tokenizeWithTrivia(src, "service.ts.ail");
      expect(comments).toHaveLength(2);
      expect(comments[0]?.value).toBe("File license header");
      expect(comments[1]?.value).toBe("Second comment");
    });
  });

  describe("Declarative UI DSL Lexing", () => {
    it("scans declarative component hierarchy seamlessly", () => {
      const src = `component Card(title:str):
  Header:
    Title: "Welcome"
  Button(onClick: handleClick): "Submit"`;

      expect(kinds(src)).toEqual([
        "COMPONENT",
        "IDENT",
        "LPAREN",
        "IDENT",
        "COLON",
        "TYPE_STR",
        "RPAREN",
        "COLON",
        "NEWLINE",
        "INDENT",
        "IDENT",
        "COLON",
        "NEWLINE",
        "INDENT",
        "IDENT",
        "COLON",
        "STRING",
        "NEWLINE",
        "DEDENT",
        "IDENT",
        "LPAREN",
        "IDENT",
        "COLON",
        "IDENT",
        "RPAREN",
        "COLON",
        "STRING",
        "NEWLINE",
        "DEDENT",
        "EOF",
      ]);
    });
  });

  describe("Hex Color Literals (#fff, #0f172a)", () => {
    it("scans 3-, 4-, 6-, and 8-digit hex colors as HEX_COLOR tokens", () => {
      const src = "#fff #0f172a #334155ff #abcd";
      const toks = tokenize(src);
      expect(toks.map((t) => t.kind)).toEqual([
        "HEX_COLOR",
        "HEX_COLOR",
        "HEX_COLOR",
        "HEX_COLOR",
        "NEWLINE",
        "EOF",
      ]);
      expect(toks.map((t) => t.value).slice(0, 4)).toEqual([
        "#fff",
        "#0f172a",
        "#334155ff",
        "#abcd",
      ]);
    });

    it("disambiguates comments from hex colors", () => {
      const src = `# This is a comment
let color = #0f172a # trailing comment`;
      const toks = tokenize(src);
      expect(toks.map((t) => t.kind)).toEqual([
        "LET",
        "IDENT",
        "EQUAL",
        "HEX_COLOR",
        "NEWLINE",
        "EOF",
      ]);
      expect(toks[3].value).toBe("#0f172a");
    });
  });
});
