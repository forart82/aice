/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL: Zero-Allocation Streaming Lexer & CST Scanner
 * Accurately calculates byte/line/column coordinates and preserves CST trivia.
 */

import { createPosition, createSpan, type SourcePosition } from "./span.ts";
import { createToken, type Token, type TokenType } from "./tokens.ts";
import type { TriviaItem } from "./trivia.ts";

export interface LexerOptions {
  retainTrivia?: boolean;
  file?: string;
}

export interface LexResult {
  tokens: Token[];
  trivia: TriviaItem[];
}

export function tokenizeAil(source: string, options: LexerOptions = {}): LexResult {
  const tokens: Token[] = [];
  const trivia: TriviaItem[] = [];
  const len = source.length;
  let offset = 0;
  let line = 1;
  let col = 1;
  const file = options.file;

  function currentPos(): SourcePosition {
    return createPosition(line, col, offset);
  }

  function advance(count = 1): void {
    for (let i = 0; i < count; i++) {
      if (offset < len) {
        if (source[offset] === "\n") {
          line++;
          col = 1;
        } else {
          col++;
        }
        offset++;
      }
    }
  }

  function peek(ahead = 0): string {
    return offset + ahead < len ? source[offset + ahead] : "";
  }

  function startsWith(prefix: string): boolean {
    return source.startsWith(prefix, offset);
  }

  while (offset < len) {
    const ch = source[offset];
    const startPos = currentPos();

    // 1. Whitespace & Newlines
    if (ch === " " || ch === "\t" || ch === "\r") {
      let ws = "";
      while (
        offset < len &&
        (source[offset] === " " || source[offset] === "\t" || source[offset] === "\r")
      ) {
        ws += source[offset];
        advance();
      }
      trivia.push({
        kind: "WHITESPACE",
        content: ws,
        span: createSpan(startPos, currentPos(), file),
      });
      continue;
    }

    if (ch === "\n") {
      let nlCount = 0;
      while (offset < len && (source[offset] === "\n" || source[offset] === "\r")) {
        if (source[offset] === "\n") nlCount++;
        advance();
      }
      if (nlCount > 1) {
        trivia.push({
          kind: "BLANK_LINES",
          content: "\n".repeat(nlCount - 1),
          span: createSpan(startPos, currentPos(), file),
        });
      }
      continue;
    }

    // 2. Line Comments (;;, //, or #)
    if (startsWith(";;") || startsWith("//") || ch === "#") {
      // Don't treat (# as a comment!
      if (!(ch === "#" && offset > 0 && source[offset - 1] === "(")) {
        let commentText = "";
        while (offset < len && source[offset] !== "\n") {
          commentText += source[offset];
          advance();
        }
        trivia.push({
          kind: "LINE_COMMENT",
          content: commentText,
          span: createSpan(startPos, currentPos(), file),
        });
        continue;
      }
    }

    // 3. Block Comments (/* ... */)
    if (startsWith("/*")) {
      let blockText = "";
      while (offset < len && !startsWith("*/")) {
        blockText += source[offset];
        advance();
      }
      if (startsWith("*/")) {
        blockText += "*/";
        advance(2);
      }
      trivia.push({
        kind: "BLOCK_COMMENT",
        content: blockText,
        span: createSpan(startPos, currentPos(), file),
      });
      continue;
    }

    // 4. Multi-Character Delimiters & Prefixes
    // Check in order of length to avoid prefix collisions
    const compoundPrefixes: Array<{ prefix: string; type: TokenType }> = [
      { prefix: "(@workspace", type: "AT_WORKSPACE" },
      { prefix: "(@file", type: "AT_FILE" },
      { prefix: "(@module", type: "AT_MODULE" },
      { prefix: "(:=", type: "ASSIGN" },
      { prefix: "(:", type: "TYPE_DECL" },
      { prefix: "(!^", type: "EFFECT_DECL" },
      { prefix: "(!val", type: "VAL_TEXT" },
      { prefix: "(!", type: "FN_DECL" },
      { prefix: "(#", type: "COMPONENT_DECL" },
      { prefix: "(<", type: "LAYOUT_OPEN" },
      { prefix: ">)", type: "LAYOUT_CLOSE" },
      { prefix: "(.", type: "ATTRS_OPEN" },
      { prefix: ".)", type: "ATTRS_CLOSE" },
      { prefix: "(&", type: "STYLE_DECL" },
      { prefix: "(==", type: "MATCH" },
      { prefix: "(?if", type: "IF_EXPR" },
      { prefix: "(?:", type: "REFINEMENT" },
      { prefix: "(~", type: "TYPESTATE" },
      { prefix: "(|", type: "UNION" },
      { prefix: "(%", type: "RECORD_LIT" },
      { prefix: "(?", type: "TRY_UNPACK" },
      { prefix: "(do", type: "DO_BLOCK" },
    ];

    let matchedCompound = false;
    for (const { prefix, type } of compoundPrefixes) {
      if (startsWith(prefix)) {
        // Ensure whitespace, delimiter, or symbol boundary if alphanumeric suffix
        advance(prefix.length);
        tokens.push(createToken(type, prefix, createSpan(startPos, currentPos(), file)));
        matchedCompound = true;
        break;
      }
    }
    if (matchedCompound) continue;

    // 5. Single Delimiters
    const singleDelimiters: Record<string, TokenType> = {
      "(": "LPAREN",
      ")": "RPAREN",
      "[": "LBRACKET",
      "]": "RBRACKET",
      "{": "LBRACE",
      "}": "RBRACE",
    };

    if (singleDelimiters[ch]) {
      advance(1);
      tokens.push(createToken(singleDelimiters[ch], ch, createSpan(startPos, currentPos(), file)));
      continue;
    }

    // 6. String Literals
    if (ch === '"' || ch === "'") {
      const quote = ch;
      let strVal = "";
      advance(1); // skip open quote

      while (offset < len && source[offset] !== quote) {
        if (source[offset] === "\\") {
          advance(1);
          if (offset >= len) break;
          const esc = source[offset];
          if (esc === "n") strVal += "\n";
          else if (esc === "t") strVal += "\t";
          else if (esc === "r") strVal += "\r";
          else if (esc === "\\") strVal += "\\";
          else if (esc === '"') strVal += '"';
          else if (esc === "'") strVal += "'";
          else strVal += esc;
          advance(1);
        } else {
          strVal += source[offset];
          advance(1);
        }
      }

      if (offset < len && source[offset] === quote) {
        advance(1); // skip close quote
      }

      tokens.push(createToken("STRING", strVal, createSpan(startPos, currentPos(), file)));
      continue;
    }

    // 7. Numbers (integers, floats, negative numbers)
    const isDigit = /[0-9]/.test(ch);
    const isNegativeNumber = ch === "-" && /[0-9]/.test(peek(1));

    if (isDigit || isNegativeNumber) {
      let numStr = "";
      if (ch === "-") {
        numStr += "-";
        advance(1);
      }
      while (offset < len && /[0-9]/.test(source[offset])) {
        numStr += source[offset];
        advance(1);
      }
      if (source[offset] === "." && /[0-9]/.test(peek(1))) {
        numStr += ".";
        advance(1);
        while (offset < len && /[0-9]/.test(source[offset])) {
          numStr += source[offset];
          advance(1);
        }
      }
      tokens.push(createToken("NUMBER", numStr, createSpan(startPos, currentPos(), file)));
      continue;
    }

    // 8. Symbols & Identifiers
    // Allowed characters: letters, digits, _, -, ., /, :, !, @, *, +, =, <, >
    const isSymbolChar = /[a-zA-Z0-9_\-./:!@*+=<>?]/.test(ch);
    if (isSymbolChar) {
      let sym = "";
      while (offset < len) {
        const cur = source[offset];
        // Break on delimiters, quotes, or whitespace
        if (
          cur === " " ||
          cur === "\t" ||
          cur === "\r" ||
          cur === "\n" ||
          cur === "(" ||
          cur === ")" ||
          cur === "[" ||
          cur === "]" ||
          cur === "{" ||
          cur === "}" ||
          cur === '"' ||
          cur === "'"
        ) {
          break;
        }
        sym += cur;
        advance(1);
      }

      if (sym === "true" || sym === "false") {
        tokens.push(createToken("BOOLEAN", sym, createSpan(startPos, currentPos(), file)));
      } else {
        tokens.push(createToken("SYMBOL", sym, createSpan(startPos, currentPos(), file)));
      }
      continue;
    }

    // Fallback: unexpected character error token
    tokens.push(
      createToken(
        "ERROR",
        ch,
        createSpan(startPos, createPosition(line, col + 1, offset + 1), file),
      ),
    );
    advance(1);
  }

  const endPos = currentPos();
  tokens.push(createToken("EOF", "", createSpan(endPos, endPos, file)));
  return { tokens, trivia };
}
