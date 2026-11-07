/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Twig Template Dialect Decompiler (Reverse Transpiler) for AICE 2.0 (Step 25).
 * Parses Twig templates (.twig), recognizing:
 * - Interpolation expressions: {{ user.name }}, {{ count + 1 }}
 * - Control tags: {% if condition %} ... {% else %} ... {% endif %}, {% for item in items %} ... {% endfor %}
 * - Block & inheritance tags: {% block title %} ... {% endblock %}, {% extends "base.twig" %}, {% include "nav.twig" %}
 * - Comments: {# comment text #} -> stored in CstTriviaTable
 * - Nested HTML elements and text nodes
 * Lowers into canonical AICE AST (ComponentDecl with LayoutNode hierarchy and expression bindings).
 */

import type { BinaryOp, ComponentDecl, Expr, LayoutNode, Module } from "../core/ast.js";
import { emptySpan, type Span } from "../core/span.js";
import { CstTriviaTable } from "../core/trivia.js";
import { AiceGenerator, type AiceGeneratorOptions } from "./aice-generator.js";

const VOID_ELEMENTS = new Set([
  "area",
  "base",
  "br",
  "col",
  "embed",
  "hr",
  "img",
  "input",
  "link",
  "meta",
  "param",
  "source",
  "track",
  "wbr",
]);

// ---------------------------------------------------------------------------
// Twig Expression Pratt Parser
// ---------------------------------------------------------------------------

type ExprTokenType = "NUMBER" | "STRING" | "IDENT" | "PUNCT" | "OP" | "EOF";

interface ExprToken {
  type: ExprTokenType;
  value: string;
}

class TwigExprLexer {
  private pos = 0;
  private input: string;

  constructor(input: string) {
    this.input = input.trim();
  }

  nextToken(): ExprToken {
    this.skipWhitespace();
    if (this.pos >= this.input.length) {
      return { type: "EOF", value: "" };
    }

    const ch = this.input[this.pos];

    // Numbers
    if (/[0-9]/.test(ch)) {
      const start = this.pos;
      while (this.pos < this.input.length && /[0-9.]/.test(this.input[this.pos])) {
        this.pos++;
      }
      return { type: "NUMBER", value: this.input.slice(start, this.pos) };
    }

    // Strings
    if (ch === '"' || ch === "'") {
      const quote = ch;
      this.pos++;
      let val = "";
      while (this.pos < this.input.length) {
        const c = this.input[this.pos++];
        if (c === quote) break;
        if (c === "\\" && this.pos < this.input.length) {
          val += this.input[this.pos++];
        } else {
          val += c;
        }
      }
      return { type: "STRING", value: val };
    }

    // Identifiers and Keywords
    if (/[a-zA-Z_$]/.test(ch)) {
      const start = this.pos;
      while (this.pos < this.input.length && /[a-zA-Z0-9_$-]/.test(this.input[this.pos])) {
        this.pos++;
      }
      return { type: "IDENT", value: this.input.slice(start, this.pos) };
    }

    // Multi-char operators
    const twoChars = this.input.slice(this.pos, this.pos + 2);
    if (["==", "!=", "<=", ">=", "&&", "||", "**", "?."].includes(twoChars)) {
      this.pos += 2;
      return { type: "OP", value: twoChars };
    }

    // Single-char operators & punctuation
    if (["+", "-", "*", "/", "%", "<", ">", "|", "~", "?", ":", "!"].includes(ch)) {
      this.pos++;
      return { type: "OP", value: ch };
    }

    if (["(", ")", "[", "]", "{", "}", ",", "."].includes(ch)) {
      this.pos++;
      return { type: "PUNCT", value: ch };
    }

    // Unknown char fallback
    this.pos++;
    return { type: "PUNCT", value: ch };
  }

  private skipWhitespace(): void {
    while (this.pos < this.input.length && /\s/.test(this.input[this.pos])) {
      this.pos++;
    }
  }
}

class TwigExprParser {
  private tokens: ExprToken[] = [];
  private cur = 0;
  private filePath: string;

  constructor(source: string, filePath: string) {
    this.filePath = filePath;
    const lexer = new TwigExprLexer(source);
    let tok: ExprToken;
    do {
      tok = lexer.nextToken();
      this.tokens.push(tok);
    } while (tok.type !== "EOF");
  }

  parse(): Expr {
    return this.parseExpr(0);
  }

  private parseExpr(minPrec: number): Expr {
    let left = this.parsePrefix();

    while (this.cur < this.tokens.length) {
      const tok = this.current();
      if (
        tok.type === "EOF" ||
        tok.value === ")" ||
        tok.value === "]" ||
        tok.value === "}" ||
        tok.value === ","
      ) {
        break;
      }

      // Member access: expr.prop
      if (tok.type === "PUNCT" && tok.value === ".") {
        this.advance();
        const propTok = this.consume("IDENT", "Expected property name after '.'");
        left = {
          kind: "MemberAccessExpr",
          object: left,
          property: propTok.value,
          isSafeNav: false,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      // Safe navigation: expr?.prop
      if (tok.type === "OP" && tok.value === "?.") {
        this.advance();
        const propTok = this.consume("IDENT", "Expected property name after '?.'");
        left = {
          kind: "MemberAccessExpr",
          object: left,
          property: propTok.value,
          isSafeNav: true,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      // Indexing: expr[index]
      if (tok.type === "PUNCT" && tok.value === "[") {
        this.advance();
        const indexExpr = this.parseExpr(0);
        this.consume("PUNCT", "Expected ']' after index");
        left = {
          kind: "IndexExpr",
          object: left,
          index: indexExpr,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      // Call: expr(arg1, arg2)
      if (tok.type === "PUNCT" && tok.value === "(") {
        this.advance();
        const args: Expr[] = [];
        while (!this.check("PUNCT", ")") && !this.check("EOF")) {
          args.push(this.parseExpr(0));
          if (this.check("PUNCT", ",")) {
            this.advance();
          } else {
            break;
          }
        }
        this.consume("PUNCT", "Expected ')' after call arguments");
        left = {
          kind: "CallExpr",
          callee: left,
          args,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      const prec = this.getPrecedence(tok);
      if (prec < minPrec) {
        break;
      }

      this.advance();

      // Filter pipe operator: expr | filter or expr | filter(args)
      if (tok.value === "|") {
        const filterTok = this.consume("IDENT", "Expected filter name after '|'");
        let filterRight: Expr = {
          kind: "IdentifierExpr",
          name: filterTok.value,
          span: emptySpan(this.filePath),
        };
        if (this.check("PUNCT", "(")) {
          this.advance();
          const filterArgs: Expr[] = [];
          while (!this.check("PUNCT", ")") && !this.check("EOF")) {
            filterArgs.push(this.parseExpr(0));
            if (this.check("PUNCT", ",")) {
              this.advance();
            } else {
              break;
            }
          }
          this.consume("PUNCT", "Expected ')' after filter arguments");
          filterRight = {
            kind: "CallExpr",
            callee: filterRight,
            args: filterArgs,
            span: emptySpan(this.filePath),
          };
        }

        left = {
          kind: "BinaryExpr",
          operator: "|",
          left,
          right: filterRight,
          span: emptySpan(this.filePath),
        };
        continue;
      }

      let op = tok.value as BinaryOp;
      if (tok.value === "~") {
        op = "+";
      }

      const right = this.parseExpr(prec + 1);
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

  private parsePrefix(): Expr {
    const tok = this.current();

    // Grouping
    if (tok.type === "PUNCT" && tok.value === "(") {
      this.advance();
      const expr = this.parseExpr(0);
      this.consume("PUNCT", "Expected ')' after grouping expression");
      return expr;
    }

    // Unary operators: not, !, -, +
    if (
      (tok.type === "IDENT" && tok.value === "not") ||
      (tok.type === "OP" && (tok.value === "!" || tok.value === "-"))
    ) {
      this.advance();
      const operand = this.parseExpr(9);
      const op: "not" | "!" | "-" = tok.value === "not" ? "not" : (tok.value as "!" | "-");
      return {
        kind: "UnaryExpr",
        operator: op,
        operand,
        span: emptySpan(this.filePath),
      };
    }

    // Literals
    if (tok.type === "NUMBER") {
      this.advance();
      const val = Number(tok.value);
      return {
        kind: "LiteralExpr",
        literalKind: "number",
        value: val,
        rawValue: tok.value,
        span: emptySpan(this.filePath),
      };
    }

    if (tok.type === "STRING") {
      this.advance();
      return {
        kind: "LiteralExpr",
        literalKind: "string",
        value: tok.value,
        rawValue: JSON.stringify(tok.value),
        span: emptySpan(this.filePath),
      };
    }

    if (tok.type === "IDENT") {
      this.advance();
      if (tok.value === "true" || tok.value === "false") {
        return {
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: tok.value === "true",
          rawValue: tok.value,
          span: emptySpan(this.filePath),
        };
      }
      if (tok.value === "null" || tok.value === "none") {
        return {
          kind: "LiteralExpr",
          literalKind: "nil",
          value: null,
          rawValue: "nil",
          span: emptySpan(this.filePath),
        };
      }
      return {
        kind: "IdentifierExpr",
        name: tok.value,
        span: emptySpan(this.filePath),
      };
    }

    // Fallback: empty literal
    this.advance();
    return {
      kind: "LiteralExpr",
      literalKind: "string",
      value: tok.value,
      rawValue: JSON.stringify(tok.value),
      span: emptySpan(this.filePath),
    };
  }

  private getPrecedence(tok: ExprToken): number {
    if (tok.type === "IDENT") {
      if (tok.value === "or") return 2;
      if (tok.value === "and") return 3;
      if (tok.value === "in") return 6;
    }
    if (tok.type === "OP") {
      if (tok.value === "||") return 2;
      if (tok.value === "&&") return 3;
      if (tok.value === "|") return 4;
      if (tok.value === "==" || tok.value === "!=") return 5;
      if (tok.value === "<" || tok.value === "<=" || tok.value === ">" || tok.value === ">=")
        return 6;
      if (tok.value === "+" || tok.value === "-" || tok.value === "~") return 7;
      if (tok.value === "*" || tok.value === "/" || tok.value === "%") return 8;
      if (tok.value === "**") return 9;
    }
    return 0;
  }

  private current(): ExprToken {
    return this.tokens[this.cur] ?? { type: "EOF", value: "" };
  }

  private advance(): ExprToken {
    const tok = this.current();
    if (this.cur < this.tokens.length) {
      this.cur++;
    }
    return tok;
  }

  private check(type: ExprTokenType, val?: string): boolean {
    const tok = this.current();
    if (tok.type !== type) return false;
    if (val !== undefined && tok.value !== val) return false;
    return true;
  }

  private consume(type: ExprTokenType, msg: string): ExprToken {
    if (!this.check(type)) {
      throw new Error(`[Twig Expr Parser] ${msg}. Got: ${JSON.stringify(this.current())}`);
    }
    return this.advance();
  }
}

// ---------------------------------------------------------------------------
// Template Tokenizer
// ---------------------------------------------------------------------------

type TemplateTokenType =
  | "COMMENT"
  | "INTERPOLATION"
  | "TAG"
  | "HTML_OPEN"
  | "HTML_CLOSE"
  | "TEXT"
  | "EOF";

interface TemplateToken {
  type: TemplateTokenType;
  content: string;
  tag?: string;
  attrs?: string;
  isVoid?: boolean;
}

function tokenizeTwigTemplate(source: string): TemplateToken[] {
  const tokens: TemplateToken[] = [];
  let i = 0;
  const len = source.length;

  while (i < len) {
    // 1. Comments: {# ... #}
    if (source.startsWith("{#", i)) {
      const end = source.indexOf("#}", i + 2);
      if (end === -1) {
        tokens.push({ type: "COMMENT", content: source.slice(i + 2).trim() });
        break;
      }
      tokens.push({ type: "COMMENT", content: source.slice(i + 2, end).trim() });
      i = end + 2;
      continue;
    }

    // 2. Interpolations: {{ ... }}
    if (source.startsWith("{{", i)) {
      const end = source.indexOf("}}", i + 2);
      if (end === -1) {
        tokens.push({ type: "INTERPOLATION", content: source.slice(i + 2).trim() });
        break;
      }
      let raw = source.slice(i + 2, end).trim();
      if (raw.startsWith("-")) raw = raw.slice(1).trim();
      if (raw.endsWith("-")) raw = raw.slice(0, -1).trim();
      tokens.push({ type: "INTERPOLATION", content: raw });
      i = end + 2;
      continue;
    }

    // 3. Tags: {% ... %}
    if (source.startsWith("{%", i)) {
      const end = source.indexOf("%}", i + 2);
      if (end === -1) {
        tokens.push({ type: "TAG", content: source.slice(i + 2).trim() });
        break;
      }
      let raw = source.slice(i + 2, end).trim();
      if (raw.startsWith("-")) raw = raw.slice(1).trim();
      if (raw.endsWith("-")) raw = raw.slice(0, -1).trim();
      tokens.push({ type: "TAG", content: raw });
      i = end + 2;
      continue;
    }

    // 4. HTML Comments: <!-- ... -->
    if (source.startsWith("<!--", i)) {
      const end = source.indexOf("-->", i + 4);
      if (end === -1) {
        tokens.push({ type: "COMMENT", content: source.slice(i + 4).trim() });
        break;
      }
      tokens.push({ type: "COMMENT", content: source.slice(i + 4, end).trim() });
      i = end + 3;
      continue;
    }

    // 5. HTML Closing Tag: </tag>
    if (source.startsWith("</", i)) {
      const end = source.indexOf(">", i + 2);
      if (end === -1) {
        tokens.push({ type: "TEXT", content: source.slice(i) });
        break;
      }
      const tag = source
        .slice(i + 2, end)
        .trim()
        .toLowerCase();
      tokens.push({ type: "HTML_CLOSE", content: tag, tag });
      i = end + 1;
      continue;
    }

    // 6. HTML Opening / Self-closing Tag: <tag ...>
    if (source[i] === "<" && i + 1 < len && /[a-zA-Z]/.test(source[i + 1])) {
      // Find matching '>' taking into account quotes and Twig interpolations
      let end = i + 1;
      let inQuote: string | null = null;
      let inTwig = false;

      while (end < len) {
        const c = source[end];
        if (!inQuote && !inTwig && source.startsWith("{{", end)) {
          inTwig = true;
          end += 2;
          continue;
        }
        if (inTwig && source.startsWith("}}", end)) {
          inTwig = false;
          end += 2;
          continue;
        }
        if (!inTwig) {
          if (inQuote) {
            if (c === inQuote && source[end - 1] !== "\\") {
              inQuote = null;
            }
          } else {
            if (c === '"' || c === "'") {
              inQuote = c;
            } else if (c === ">") {
              break;
            }
          }
        }
        end++;
      }

      if (end < len && source[end] === ">") {
        const fullTag = source.slice(i + 1, end).trim();
        const isSelfClosing = fullTag.endsWith("/");
        const cleaned = isSelfClosing ? fullTag.slice(0, -1).trim() : fullTag;
        const match = /^([a-zA-Z0-9_-]+)([\s\S]*)$/.exec(cleaned);
        if (match) {
          const tagName = match[1].toLowerCase();
          const attrs = match[2].trim();
          const isVoid = isSelfClosing || VOID_ELEMENTS.has(tagName);
          tokens.push({
            type: "HTML_OPEN",
            content: fullTag,
            tag: tagName,
            attrs,
            isVoid,
          });
          i = end + 1;
          continue;
        }
      }
    }

    // 7. Plain text
    const nextSpecial = findNextSpecialIndex(source, i);
    const textChunk = source.slice(i, nextSpecial);
    tokens.push({ type: "TEXT", content: textChunk });
    i = nextSpecial;
  }

  tokens.push({ type: "EOF", content: "" });
  return tokens;
}

function findNextSpecialIndex(source: string, start: number): number {
  let min = source.length;
  const delimiters = ["{#", "{{", "{%", "<!--", "</", "<"];
  for (const d of delimiters) {
    const idx = source.indexOf(d, start);
    if (idx !== -1 && idx < min) {
      if (d === "<") {
        // Only trigger if followed by a-zA-Z or /
        if (
          idx + 1 < source.length &&
          (/[a-zA-Z]/.test(source[idx + 1]) || source[idx + 1] === "/")
        ) {
          min = idx;
        }
      } else {
        min = idx;
      }
    }
  }
  return min;
}

// ---------------------------------------------------------------------------
// Twig Decompiler
// ---------------------------------------------------------------------------

export class TwigDecompiler {
  private source: string;
  private filePath: string;
  private trivia = new CstTriviaTable();
  private tokens: TemplateToken[] = [];
  private cur = 0;

  constructor(source: string, filePath = "template.twig") {
    this.source = source;
    this.filePath = filePath;
  }

  decompile(): { ast: Module; aice: string; trivia: CstTriviaTable } {
    this.tokens = tokenizeTwigTemplate(this.source);
    this.cur = 0;

    const layoutNodes = this.parseLayoutNodes();

    const baseName =
      this.filePath
        .split(/[/\\]/)
        .pop()
        ?.replace(/\.twig$/, "")
        .replace(/\.html$/, "")
        .replace(/\.aice$/, "") ?? "card";

    const cleanModPath = baseName;
    const compName =
      baseName
        .split(/[-_]/)
        .map((p) => p.charAt(0).toUpperCase() + p.slice(1))
        .join("") || "Card";

    const comp: ComponentDecl = {
      kind: "ComponentDecl",
      name: compName,
      params: [],
      layout: layoutNodes,
      span: emptySpan(this.filePath),
    };

    const ast: Module = {
      kind: "Module",
      path: cleanModPath || "card",
      items: [comp],
      span: emptySpan(this.filePath),
    };

    const generator = new AiceGenerator({ trivia: this.trivia });
    const aice = generator.generate(ast);

    return { ast, aice, trivia: this.trivia };
  }

  private parseLayoutNodes(stopTags?: string[]): LayoutNode[] {
    const nodes: LayoutNode[] = [];

    while (this.cur < this.tokens.length) {
      const tok = this.current();
      if (tok.type === "EOF" || tok.type === "HTML_CLOSE") {
        break;
      }

      if (tok.type === "COMMENT") {
        this.advance();
        if (tok.content) {
          this.trivia.addLeadingTrivia("twig_root", {
            kind: "BLOCK_COMMENT",
            content: `{# ${tok.content} #}`,
          });
        }
        continue;
      }

      if (tok.type === "TAG") {
        const tagContent = tok.content.trim();
        const tagFirstWord = tagContent.split(/\s+/)[0];

        if (stopTags && stopTags.includes(tagFirstWord)) {
          break;
        }

        this.advance();

        // 1. {% extends "base.twig" %}
        if (tagFirstWord === "extends") {
          const match = /^extends\s+["']?([^"']+)["']?/.exec(tagContent);
          const template = match ? match[1] : "base.twig";
          nodes.push({
            kind: "LayoutNode",
            tag: "extends",
            attributes: [
              {
                name: "template",
                value: {
                  kind: "LiteralExpr",
                  literalKind: "string",
                  value: template,
                  rawValue: JSON.stringify(template),
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              },
            ],
            textLiteral: null,
            children: [],
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // 2. {% include "nav.twig" %}
        if (tagFirstWord === "include") {
          const match = /^include\s+["']?([^"']+)["']?/.exec(tagContent);
          const template = match ? match[1] : "nav.twig";
          nodes.push({
            kind: "LayoutNode",
            tag: "include",
            attributes: [
              {
                name: "template",
                value: {
                  kind: "LiteralExpr",
                  literalKind: "string",
                  value: template,
                  rawValue: JSON.stringify(template),
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              },
            ],
            textLiteral: null,
            children: [],
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // 3. {% block title %} ... {% endblock %}
        if (tagFirstWord === "block") {
          const match = /^block\s+([a-zA-Z0-9_-]+)/.exec(tagContent);
          const blockName = match ? match[1] : "content";
          const blockChildren = this.parseLayoutNodes(["endblock"]);

          if (this.current().type === "TAG" && this.current().content.startsWith("endblock")) {
            this.advance();
          }

          let textLiteral: string | null = null;
          let childExpr: Expr | null = null;
          let children = blockChildren;

          if (
            blockChildren.length === 1 &&
            blockChildren[0].textLiteral !== null &&
            blockChildren[0].children.length === 0 &&
            blockChildren[0].tag === "span" &&
            blockChildren[0].attributes.length === 0
          ) {
            textLiteral = blockChildren[0].textLiteral;
            children = [];
          } else if (
            blockChildren.length === 1 &&
            blockChildren[0].childExpr &&
            blockChildren[0].children.length === 0 &&
            blockChildren[0].tag === "output" &&
            blockChildren[0].attributes.length === 0
          ) {
            childExpr = blockChildren[0].childExpr;
            children = [];
          }

          nodes.push({
            kind: "LayoutNode",
            tag: "block",
            attributes: [
              {
                name: "name",
                value: {
                  kind: "LiteralExpr",
                  literalKind: "string",
                  value: blockName,
                  rawValue: JSON.stringify(blockName),
                  span: emptySpan(this.filePath),
                },
                span: emptySpan(this.filePath),
              },
            ],
            textLiteral,
            childExpr,
            children,
            span: emptySpan(this.filePath),
          });
          continue;
        }

        // 4. {% if condition %} ... {% else %} ... {% endif %}
        if (tagFirstWord === "if") {
          const condStr = tagContent.slice(2).trim();
          const condExpr = this.parseTwigExpr(condStr);
          const thenChildren = this.parseLayoutNodes(["elseif", "else", "endif"]);
          const ifNode: LayoutNode = {
            kind: "LayoutNode",
            tag: "if",
            attributes: [
              {
                name: "condition",
                value: condExpr,
                span: emptySpan(this.filePath),
              },
            ],
            textLiteral: null,
            children: [...thenChildren],
            span: emptySpan(this.filePath),
          };

          while (this.current().type === "TAG") {
            const nextContent = this.current().content.trim();
            if (nextContent.startsWith("elseif")) {
              this.advance();
              const elseifCondStr = nextContent.slice(6).trim();
              const elseifCondExpr = this.parseTwigExpr(elseifCondStr);
              const elseifChildren = this.parseLayoutNodes(["elseif", "else", "endif"]);
              ifNode.children.push({
                kind: "LayoutNode",
                tag: "elseif",
                attributes: [
                  {
                    name: "condition",
                    value: elseifCondExpr,
                    span: emptySpan(this.filePath),
                  },
                ],
                textLiteral: null,
                children: elseifChildren,
                span: emptySpan(this.filePath),
              });
            } else if (nextContent.startsWith("else")) {
              this.advance();
              const elseChildren = this.parseLayoutNodes(["endif"]);
              ifNode.children.push({
                kind: "LayoutNode",
                tag: "else",
                attributes: [],
                textLiteral: null,
                children: elseChildren,
                span: emptySpan(this.filePath),
              });
            } else if (nextContent.startsWith("endif")) {
              this.advance();
              break;
            } else {
              break;
            }
          }

          nodes.push(ifNode);
          continue;
        }

        // 5. {% for item in items %} ... {% endfor %}
        if (tagFirstWord === "for") {
          const loopStr = tagContent.slice(3).trim();
          const match = /^([a-zA-Z0-9_,\s]+)\s+in\s+([\s\S]+)$/.exec(loopStr);
          let varName = "item";
          let keyName: string | undefined = undefined;
          let inExprStr = "items";

          if (match) {
            const vars = match[1].split(",").map((s) => s.trim());
            if (vars.length === 2) {
              keyName = vars[0];
              varName = vars[1];
            } else {
              varName = vars[0];
            }
            inExprStr = match[2].trim();
          }

          const inExpr = this.parseTwigExpr(inExprStr);
          const loopChildren = this.parseLayoutNodes(["else", "endfor"]);
          const forAttrs = [
            {
              name: "item",
              value: {
                kind: "IdentifierExpr" as const,
                name: varName,
                span: emptySpan(this.filePath),
              },
              span: emptySpan(this.filePath),
            },
            {
              name: "in",
              value: inExpr,
              span: emptySpan(this.filePath),
            },
          ];

          if (keyName) {
            forAttrs.unshift({
              name: "key",
              value: {
                kind: "IdentifierExpr" as const,
                name: keyName,
                span: emptySpan(this.filePath),
              },
              span: emptySpan(this.filePath),
            });
          }

          const forNode: LayoutNode = {
            kind: "LayoutNode",
            tag: "for",
            attributes: forAttrs,
            textLiteral: null,
            children: [...loopChildren],
            span: emptySpan(this.filePath),
          };

          if (this.current().type === "TAG" && this.current().content.startsWith("else")) {
            this.advance();
            const elseChildren = this.parseLayoutNodes(["endfor"]);
            forNode.children.push({
              kind: "LayoutNode",
              tag: "else",
              attributes: [],
              textLiteral: null,
              children: elseChildren,
              span: emptySpan(this.filePath),
            });
          }

          if (this.current().type === "TAG" && this.current().content.startsWith("endfor")) {
            this.advance();
          }

          nodes.push(forNode);
          continue;
        }

        // Generic unrecognized tag: ignore or store
        continue;
      }

      if (tok.type === "INTERPOLATION") {
        this.advance();
        const expr = this.parseTwigExpr(tok.content);
        nodes.push({
          kind: "LayoutNode",
          tag: "output",
          attributes: [],
          textLiteral: null,
          childExpr: expr,
          children: [],
          span: emptySpan(this.filePath),
        });
        continue;
      }

      if (tok.type === "HTML_OPEN") {
        this.advance();
        const tag = tok.tag || "div";
        const attributes = this.parseAttributes(tok.attrs || "");

        if (tok.isVoid) {
          nodes.push({
            kind: "LayoutNode",
            tag,
            attributes,
            textLiteral: null,
            children: [],
            span: emptySpan(this.filePath),
          });
          continue;
        }

        const childNodes = this.parseNodesUntilHtmlClose(tag);

        let textLiteral: string | null = null;
        let childExpr: Expr | null = null;
        let children = childNodes;

        if (
          childNodes.length === 1 &&
          childNodes[0].textLiteral !== null &&
          childNodes[0].children.length === 0 &&
          childNodes[0].tag === "span" &&
          childNodes[0].attributes.length === 0
        ) {
          textLiteral = childNodes[0].textLiteral;
          children = [];
        } else if (
          childNodes.length === 1 &&
          childNodes[0].childExpr &&
          childNodes[0].children.length === 0 &&
          childNodes[0].tag === "output" &&
          childNodes[0].attributes.length === 0
        ) {
          childExpr = childNodes[0].childExpr;
          children = [];
        }

        nodes.push({
          kind: "LayoutNode",
          tag,
          attributes,
          textLiteral,
          childExpr,
          children,
          span: emptySpan(this.filePath),
        });
        continue;
      }

      if (tok.type === "TEXT") {
        this.advance();
        const text = tok.content.trim();
        if (text.length > 0) {
          nodes.push({
            kind: "LayoutNode",
            tag: "span",
            attributes: [],
            textLiteral: text,
            children: [],
            span: emptySpan(this.filePath),
          });
        }
        continue;
      }

      this.advance();
    }

    return nodes;
  }

  private parseNodesUntilHtmlClose(expectedTag: string): LayoutNode[] {
    const nodes: LayoutNode[] = [];

    while (this.cur < this.tokens.length) {
      const tok = this.current();
      if (tok.type === "EOF") break;

      if (tok.type === "HTML_CLOSE") {
        if (tok.tag === expectedTag) {
          this.advance();
          break;
        }
        // Mismatched closing tag: stop parent
        break;
      }

      const parsed = this.parseLayoutNodes();
      nodes.push(...parsed);
    }

    return nodes;
  }

  private parseTwigExpr(exprStr: string): Expr {
    try {
      const parser = new TwigExprParser(exprStr, this.filePath);
      return parser.parse();
    } catch {
      return {
        kind: "IdentifierExpr",
        name: exprStr.trim() || "expr",
        span: emptySpan(this.filePath),
      };
    }
  }

  private parseAttributes(attrsStr: string): { name: string; value: Expr; span: Span }[] {
    const attributes: { name: string; value: Expr; span: Span }[] = [];
    if (!attrsStr || attrsStr.trim().length === 0) return attributes;

    const attrRegex = /([a-zA-Z0-9_:-]+)(?:=(?:"([^"]*)"|'([^']*)'|(\{\{[^}]*\}\})|([^\s>]+)))?/g;
    let match: RegExpExecArray | null;

    while ((match = attrRegex.exec(attrsStr)) !== null) {
      const name = match[1];
      const quotedVal = match[2] ?? match[3];
      const twigVal = match[4];
      const bareVal = match[5];

      if (quotedVal !== undefined) {
        // Check if value is purely an interpolation: "{{ expr }}"
        const pureTwigMatch = /^\{\{\s*([\s\S]+?)\s*\}\}$/.exec(quotedVal.trim());
        if (pureTwigMatch) {
          attributes.push({
            name,
            value: this.parseTwigExpr(pureTwigMatch[1]),
            span: emptySpan(this.filePath),
          });
        } else {
          attributes.push({
            name,
            value: {
              kind: "LiteralExpr",
              literalKind: "string",
              value: quotedVal,
              rawValue: JSON.stringify(quotedVal),
              span: emptySpan(this.filePath),
            },
            span: emptySpan(this.filePath),
          });
        }
      } else if (twigVal !== undefined) {
        const pureTwigMatch = /^\{\{\s*([\s\S]+?)\s*\}\}$/.exec(twigVal.trim());
        const exprStr = pureTwigMatch ? pureTwigMatch[1] : twigVal;
        attributes.push({
          name,
          value: this.parseTwigExpr(exprStr),
          span: emptySpan(this.filePath),
        });
      } else if (bareVal !== undefined) {
        attributes.push({
          name,
          value: {
            kind: "LiteralExpr",
            literalKind: "string",
            value: bareVal,
            rawValue: JSON.stringify(bareVal),
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
      } else {
        // Boolean attribute (e.g. disabled, checked)
        attributes.push({
          name,
          value: {
            kind: "LiteralExpr",
            literalKind: "boolean",
            value: true,
            rawValue: "true",
            span: emptySpan(this.filePath),
          },
          span: emptySpan(this.filePath),
        });
      }
    }

    return attributes;
  }

  private current(): TemplateToken {
    return this.tokens[this.cur] ?? { type: "EOF", content: "" };
  }

  private advance(): TemplateToken {
    const tok = this.current();
    if (this.cur < this.tokens.length) {
      this.cur++;
    }
    return tok;
  }
}

export function decompileTwig(
  source: string,
  filePath = "template.twig",
  options: AiceGeneratorOptions = {},
): { ast: Module; aice: string; trivia: CstTriviaTable } {
  const decompiler = new TwigDecompiler(source, filePath);
  const result = decompiler.decompile();
  const generator = new AiceGenerator({ ...options, trivia: result.trivia });
  const aice = generator.generate(result.ast);
  return { ast: result.ast, aice, trivia: result.trivia };
}
