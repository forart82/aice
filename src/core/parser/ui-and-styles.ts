/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Declarative UI component DSL, layout nodes, style blocks, and design-token declarations.
 */

import type {
  ComponentDecl,
  Expr,
  LayoutNode,
  ParamDecl,
  StyleDecl,
  StyleProperty,
} from "../ast.js";
import { mergeSpans, type Span } from "../span.js";
import type { Token } from "../tokens.js";
import { ParserError, type ParserHost } from "./core.js";

// Declarative UI Component DSL Parsing
export function parseComponentDecl(p: ParserHost): ComponentDecl {
  const startSpan = p.current().span;
  p.consume("COMPONENT");

  const name = p.parseContextualIdentOrString("Expected component name");
  const params: ParamDecl[] = [];

  if (p.check("LPAREN")) {
    p.advance();
    while (!p.check("RPAREN") && !p.check("EOF")) {
      const pSpan = p.current().span;
      const pName = p.parseContextualIdentOrString("Expected parameter name");
      let isOptional = false;
      if (p.check("QUESTION")) {
        p.advance();
        isOptional = true;
      }
      p.consume("COLON");
      const pType = p.parseTypeExpr();

      let defaultValue: Expr | undefined;
      if (p.check("EQUAL")) {
        p.advance();
        defaultValue = p.parseExpr();
      }

      params.push({
        name: pName,
        typeAnnotation: pType,
        defaultValue,
        isOptional: isOptional ? true : undefined,
        span: mergeSpans(pSpan, defaultValue ? defaultValue.span : pType.span),
      });

      if (p.check("COMMA")) p.advance();
    }
    p.consume("RPAREN");
  }

  p.consume("COLON", "Expected ':' before component layout");
  p.consumeStatementSeparator();

  const layout: LayoutNode[] = [];
  p.consume("INDENT", "Expected indented component layout tree");

  while (!p.check("DEDENT") && !p.check("EOF")) {
    p.consumeStatementSeparator();
    if (p.check("DEDENT") || p.check("EOF")) break;

    layout.push(parseLayoutNode(p));
    p.consumeStatementSeparator();
  }

  const endSpan = p.consume("DEDENT").span;

  return {
    kind: "ComponentDecl",
    name,
    params,
    layout,
    span: mergeSpans(startSpan, endSpan),
  };
}

function parseLayoutNode(p: ParserHost, parentTag?: string): LayoutNode {
  const startSpan = p.current().span;

  let tag: string | null = null;
  const classes: string[] = [];
  let id: string | null = null;

  // 1. Selector shorthand (.class, #id) or explicit tag name / inline modifier (_)
  if (p.check("DOT")) {
    p.advance(); // consume '.'
    classes.push(parseCssKebabIdent(p));
  } else if (p.check("HASH")) {
    p.advance(); // consume '#'
    id = parseCssKebabIdent(p);
  } else if (p.check("HEX_COLOR")) {
    id = p.advance().value.slice(1);
  } else {
    const ident = p.parseContextualIdentOrString("Expected UI layout tag name");
    if (ident === "_") {
      tag = "span";
    } else {
      tag = ident;
    }
  }

  // 2. Chained classes and/or ID: e.g. button.btn.btn-icon#btn-theme-toggle
  while (!p.check("EOF")) {
    if (p.check("DOT")) {
      p.advance(); // consume '.'
      classes.push(parseCssKebabIdent(p));
    } else if (p.check("HASH")) {
      p.advance(); // consume '#'
      id = parseCssKebabIdent(p);
    } else if (p.check("HEX_COLOR")) {
      id = p.advance().value.slice(1);
    } else {
      break;
    }
  }

  // 3. Infer tag if omitted from parent context
  if (!tag) {
    if (parentTag) {
      const lowerParent = parentTag.toLowerCase();
      if (lowerParent === "ul" || lowerParent === "ol") {
        tag = "li";
      } else if (
        lowerParent === "table" ||
        lowerParent === "tbody" ||
        lowerParent === "thead" ||
        lowerParent === "tfoot"
      ) {
        tag = "tr";
      } else if (lowerParent === "tr") {
        tag = "td";
      } else if (lowerParent === "select") {
        tag = "option";
      } else if (lowerParent === "dl") {
        tag = "dt";
      } else if (
        lowerParent === "button" ||
        lowerParent === "p" ||
        lowerParent === "label" ||
        lowerParent === "a" ||
        lowerParent === "span" ||
        /^h[1-6]$/.test(lowerParent) ||
        lowerParent === "b" ||
        lowerParent === "i" ||
        lowerParent === "strong" ||
        lowerParent === "em"
      ) {
        tag = "span";
      } else {
        tag = "div";
      }
    } else {
      tag = "div";
    }
  }

  const attributes: { name: string; value: Expr; span: Span }[] = [];

  // Optional attributes: Tag(prop: val, onClick: handle) or positional $idiom(arg0, arg1)
  if (p.check("LPAREN")) {
    p.advance();
    let posIdx = 0;
    while (!p.check("RPAREN") && !p.check("EOF")) {
      const aSpan = p.current().span;
      if (tag && tag.startsWith("$") && p.peek().kind !== "COLON" && p.peek().kind !== "EQUAL") {
        const aVal = p.parseExpr();
        attributes.push({
          name: `$${posIdx++}`,
          value: aVal,
          span: mergeSpans(aSpan, aVal.span),
        });
      } else {
        const aName = p.check("STRING") ? p.advance().value : parseCssKebabIdent(p);
        if (p.check("EQUAL")) {
          p.advance();
        } else {
          p.consume("COLON");
        }
        const aVal = p.parseExpr();

        attributes.push({
          name: aName,
          value: aVal,
          span: mergeSpans(aSpan, aVal.span),
        });
      }

      if (p.check("COMMA")) p.advance();
    }
    p.consume("RPAREN");
  }

  // Merge selector classes into attributes
  if (classes.length > 0) {
    const existingClassAttr = attributes.find((a) => a.name === "class" || a.name === "className");
    if (existingClassAttr) {
      if (
        existingClassAttr.value.kind === "LiteralExpr" &&
        existingClassAttr.value.literalKind === "string"
      ) {
        const merged = `${classes.join(" ")} ${existingClassAttr.value.value}`;
        existingClassAttr.value = {
          ...existingClassAttr.value,
          value: merged,
          rawValue: JSON.stringify(merged),
        };
      }
    } else {
      const classVal = classes.join(" ");
      attributes.unshift({
        name: "class",
        value: {
          kind: "LiteralExpr",
          literalKind: "string",
          value: classVal,
          rawValue: JSON.stringify(classVal),
          span: startSpan,
        },
        span: startSpan,
      });
    }
  }

  // Merge selector ID into attributes
  if (id !== null) {
    const existingIdAttr = attributes.find((a) => a.name === "id");
    if (!existingIdAttr) {
      attributes.push({
        name: "id",
        value: {
          kind: "LiteralExpr",
          literalKind: "string",
          value: id,
          rawValue: JSON.stringify(id),
          span: startSpan,
        },
        span: startSpan,
      });
    }
  }

  let textLiteral: string | null = null;
  let childExpr: Expr | null = null;
  const children: LayoutNode[] = [];

  // Direct text literal child without colon: .brand-icon "⚡"
  if (p.check("STRING") && p.current().span.start.line === startSpan.start.line) {
    const strTok = p.advance();
    textLiteral = strTok.value;
    p.consumeStatementSeparator();
    return {
      kind: "LayoutNode",
      tag,
      attributes,
      textLiteral,
      children,
      span: mergeSpans(startSpan, strTok.span),
    };
  }

  // Tag body / children with '{ ... }'
  if (p.check("LBRACE")) {
    p.advance(); // consume '{'
    while (!p.check("RBRACE") && !p.check("EOF")) {
      while (p.check("NEWLINE") || p.check("INDENT") || p.check("DEDENT") || p.check("SEMICOLON")) {
        p.advance();
      }
      if (p.check("RBRACE") || p.check("EOF")) break;
      children.push(parseLayoutNode(p, tag ?? undefined));
    }
    if (p.check("RBRACE")) {
      p.advance();
    }
  } else if (p.check("COLON")) {
    // Tag body / children with ':'
    p.advance(); // consume ':'

    // Direct text literal child: Button: "Submit"
    if (p.check("STRING")) {
      const strTok = p.advance();
      textLiteral = strTok.value;
      p.consumeStatementSeparator();
      return {
        kind: "LayoutNode",
        tag,
        attributes,
        textLiteral,
        children,
        span: mergeSpans(startSpan, strTok.span),
      };
    }

    // Direct child expression on same line: p: message or h2.title: title
    if (!p.check("NEWLINE") && !p.check("EOF") && !p.check("INDENT") && !p.check("RBRACE")) {
      childExpr = p.parseExpr();
      p.consumeStatementSeparator();
      return {
        kind: "LayoutNode",
        tag,
        attributes,
        textLiteral: null,
        childExpr,
        children,
        span: mergeSpans(startSpan, childExpr.span),
      };
    }

    // Nested indented children
    p.consumeStatementSeparator();
    if (p.check("INDENT")) {
      p.advance();
      while (!p.check("DEDENT") && !p.check("EOF")) {
        p.consumeStatementSeparator();
        if (p.check("DEDENT") || p.check("EOF")) break;

        children.push(parseLayoutNode(p, tag ?? undefined));
        p.consumeStatementSeparator();
      }
      p.consume("DEDENT");
    }
  }

  p.consumeStatementSeparator();

  return {
    kind: "LayoutNode",
    tag,
    attributes,
    textLiteral,
    children,
    span: mergeSpans(startSpan, p.current().span),
  };
}

// Style Declarations
function hasLBraceBeforeLineEnd(p: ParserHost): boolean {
  let offset = 0;
  while (true) {
    const tok = p.peek(offset);
    if (
      tok.kind === "EOF" ||
      tok.kind === "NEWLINE" ||
      tok.kind === "SEMICOLON" ||
      tok.kind === "RBRACE" ||
      tok.kind === "DEDENT"
    ) {
      return false;
    }
    if (tok.kind === "LBRACE") {
      return true;
    }
    offset++;
  }
}

function parseStyleSelector(p: ParserHost): string {
  const tok = p.current();
  if (tok.kind === "STRING") {
    p.advance();
    return tok.value;
  }

  const lineHasLBrace = hasLBraceBeforeLineEnd(p);
  const tokens: Token[] = [];
  let parenDepth = 0;

  while (!p.check("LBRACE") && !p.check("NEWLINE") && !p.check("DEDENT") && !p.check("EOF")) {
    if (p.check("LPAREN")) {
      parenDepth++;
      tokens.push(p.advance());
      continue;
    }
    if (p.check("RPAREN")) {
      parenDepth = Math.max(0, parenDepth - 1);
      tokens.push(p.advance());
      continue;
    }
    if (p.check("COLON")) {
      if (parenDepth > 0 || lineHasLBrace) {
        tokens.push(p.advance());
        continue;
      }
      const colonTok = p.current();
      const nextTok = p.peek(1);
      const isAdjacentPseudo =
        nextTok.kind === "COLON" ||
        (p.isIdentOrKeyword(nextTok) &&
          tokens.length > 0 &&
          tokens[tokens.length - 1].span.end.offset === colonTok.span.start.offset &&
          colonTok.span.end.offset === nextTok.span.start.offset);
      if (isAdjacentPseudo) {
        tokens.push(p.advance());
        continue;
      }
      break;
    }
    tokens.push(p.advance());
  }

  if (tokens.length === 0) {
    throw new ParserError("Expected style name or selector", p.current().span);
  }

  if (p.source) {
    const startOffset = tokens[0].span.start.offset;
    const endOffset = tokens[tokens.length - 1].span.end.offset;
    return p.source.slice(startOffset, endOffset).trim();
  }

  return tokens.map((t) => t.value).join("");
}

export function parseStyleDecl(p: ParserHost, consumeStyleKeyword = true): StyleDecl {
  const startSpan = p.current().span;
  if (consumeStyleKeyword) {
    p.consume("STYLE");
  }

  const name = parseStyleSelector(p);
  const hasBraces = p.check("LBRACE");
  if (hasBraces) {
    p.advance(); // consume '{'
    if (p.check("COLON")) p.advance();
  } else {
    p.consume("COLON", "Expected ':' or '{' before style block");
  }
  p.consumeStatementSeparator();

  const properties: StyleProperty[] = [];
  const children: StyleDecl[] = [];
  const hasIndent = p.check("INDENT");
  if (hasIndent) {
    p.advance(); // consume INDENT
  }

  while (!p.check("EOF")) {
    if (hasBraces) {
      while (p.check("NEWLINE") || p.check("INDENT") || p.check("DEDENT")) {
        p.advance();
      }
      if (p.check("RBRACE") || p.check("EOF")) {
        break;
      }
    } else if (hasIndent) {
      p.consumeStatementSeparator();
      if (p.check("DEDENT") || p.check("EOF")) {
        break;
      }
    } else {
      if (p.check("NEWLINE") || p.check("EOF")) {
        break;
      }
    }

    // Check for nested tokens block: tokens <ns>:
    if (p.check("TOKENS")) {
      parseTokensIntoProperties(p, properties);
      if (hasIndent || hasBraces) p.consumeStatementSeparator();
      continue;
    }

    // Check for nested style block: `style <sel> ...` or `<sel> { ... }` (e.g. `@media (...) { ... }`)
    if (p.check("STYLE")) {
      children.push(parseStyleDecl(p, true));
      if (hasIndent || hasBraces) p.consumeStatementSeparator();
      continue;
    }
    if (hasLBraceBeforeLineEnd(p)) {
      children.push(parseStyleDecl(p, false));
      if (hasIndent || hasBraces) p.consumeStatementSeparator();
      continue;
    }

    const pSpan = p.current().span;
    const prop = parseCssPropertyName(p);

    const normalizedProp = prop
      .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
      .replace(/_/g, "-")
      .toLowerCase();
    const isMacro =
      normalizedProp === "fl-row" ||
      normalizedProp === "fl-col" ||
      normalizedProp === "fl-center" ||
      prop.trim().startsWith("$");

    let val = "";
    if (p.check("COLON")) {
      p.advance();
      if (
        !p.check("SEMICOLON") &&
        !p.check("NEWLINE") &&
        !p.check("DEDENT") &&
        !p.check("RBRACE") &&
        !p.check("EOF")
      ) {
        val = parseCssPropertyValue(p);
      }
    } else if (!isMacro) {
      p.consume("COLON", "Expected ':' after CSS property name");
    }

    properties.push({
      property: prop,
      value: val,
      span: mergeSpans(pSpan, p.current().span),
    });

    if (p.check("SEMICOLON")) {
      p.advance();
    }
    if (hasBraces) {
      p.consumeStatementSeparator();
    } else if (!hasIndent) {
      if (p.check("NEWLINE") || p.check("EOF")) {
        break;
      }
      if (
        !p.check("IDENT") &&
        !p.check("STRING") &&
        !p.check("MINUS") &&
        !p.check("TOKENS") &&
        !p.isIdentOrKeyword(p.current())
      ) {
        break;
      }
    } else {
      p.consumeStatementSeparator();
    }
  }

  let endSpan = p.current().span;
  if (hasBraces) {
    while (p.check("NEWLINE") || p.check("INDENT") || p.check("DEDENT")) {
      p.advance();
    }
    if (p.check("RBRACE")) {
      endSpan = p.consume("RBRACE").span;
    }
  } else if (hasIndent && p.check("DEDENT")) {
    endSpan = p.consume("DEDENT").span;
  }
  p.consumeStatementSeparator();

  return {
    kind: "StyleDecl",
    name,
    properties,
    ...(children.length > 0 ? { children } : {}),
    span: mergeSpans(startSpan, endSpan),
  };
}

export function parseTokensDecl(p: ParserHost): StyleDecl {
  const startSpan = p.current().span;
  const properties: StyleProperty[] = [];
  let target = ":root";

  parseTokensIntoProperties(p, properties, (parsedTarget) => {
    if (parsedTarget) target = parsedTarget;
  });

  return {
    kind: "StyleDecl",
    name: target,
    properties,
    span: mergeSpans(startSpan, p.current().span),
  };
}

function parseTokensIntoProperties(
  p: ParserHost,
  properties: StyleProperty[],
  onTarget?: (target: string) => void,
): void {
  const startSpan = p.current().span;
  p.consume("TOKENS");

  // Parse namespace: e.g. color.slate, spacing, radius, z
  const nsTokens: Token[] = [];
  while (
    !p.check("COLON") &&
    !p.check("IN") &&
    !p.check("LBRACKET") &&
    !p.check("EOF") &&
    (p.isIdentOrKeyword(p.current()) || p.check("DOT") || p.check("MINUS"))
  ) {
    nsTokens.push(p.advance());
  }

  if (nsTokens.length === 0) {
    throw new ParserError("Expected token namespace", p.current().span);
  }

  const nsRaw = nsTokens.map((t) => t.value).join("");
  const nsKebab = nsRaw.replace(/\./g, "-").replace(/_/g, "-").toLowerCase();

  // Optional unit annotation on namespace: [unit] (e.g. [rem], [px])
  let defaultUnit = "";
  if (p.check("LBRACKET")) {
    p.advance(); // consume '['
    const unitTokens: Token[] = [];
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      unitTokens.push(p.advance());
    }
    p.consume("RBRACKET", "Expected ']' after token unit annotation");
    defaultUnit = unitTokens.map((t) => t.value).join("");
  }

  // Optional: in <target>
  if (p.check("IN")) {
    p.advance(); // consume 'in'
    const targetName = parseStyleSelector(p);
    if (onTarget) onTarget(targetName);
  }

  if (!defaultUnit && p.check("LBRACKET")) {
    p.advance(); // consume '['
    const unitTokens: Token[] = [];
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      unitTokens.push(p.advance());
    }
    p.consume("RBRACKET", "Expected ']' after token unit annotation");
    defaultUnit = unitTokens.map((t) => t.value).join("");
  }

  p.consume("COLON", "Expected ':' after token namespace");

  // Scale syntax: [0, 4, 8, 12, 16]px
  if (p.check("LBRACKET")) {
    p.advance(); // consume '['
    const values: string[] = [];
    while (!p.check("RBRACKET") && !p.check("EOF")) {
      values.push(p.advance().value);
      if (p.check("COMMA")) p.advance();
    }
    p.consume("RBRACKET", "Expected ']' after token scale");

    let unit = defaultUnit;
    if (p.check("IDENT") || p.check("PERCENT")) {
      unit = p.advance().value;
    }

    for (const val of values) {
      let finalVal = val;
      if (unit && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(val.trim())) {
        finalVal = `${val.trim()}${unit}`;
      }
      properties.push({
        property: `--${nsKebab}-${val}`,
        value: finalVal,
        span: startSpan,
      });
    }
    p.consumeStatementSeparator();
    return;
  }

  // Key-value pairs
  p.consumeStatementSeparator();
  const hasIndent = p.check("INDENT");
  if (hasIndent) {
    p.advance(); // consume INDENT
  }

  while (!p.check("EOF")) {
    p.consumeStatementSeparator();
    if (hasIndent && p.check("DEDENT")) {
      p.advance(); // consume DEDENT
      break;
    }
    if (!hasIndent && (p.check("NEWLINE") || p.check("EOF"))) {
      break;
    }

    const kSpan = p.current().span;
    const key = parseCssKebabIdent(p);
    p.consume("COLON", "Expected ':' after token key");

    let val = parseTokenValue(p);
    if (defaultUnit && /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)(?:[eE][+-]?\d+)?$/.test(val.trim())) {
      val = `${val.trim()}${defaultUnit}`;
    }

    properties.push({
      property: `--${nsKebab}-${key}`,
      value: val,
      span: mergeSpans(kSpan, p.current().span),
    });

    if (p.check("COMMA") || p.check("SEMICOLON")) {
      p.advance();
    } else if (!hasIndent) {
      break;
    }
    p.consumeStatementSeparator();
  }
}

function parseTokenValue(p: ParserHost): string {
  const tokens: Token[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (!p.check("EOF")) {
    const tok = p.current();

    // At top-level, stop on comma, semicolon, newline, dedent, comment
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (
        p.check("COMMA") ||
        p.check("SEMICOLON") ||
        p.check("NEWLINE") ||
        p.check("DEDENT") ||
        p.check("COMMENT")
      ) {
        break;
      }
    }

    if (tok.kind === "LPAREN") parenDepth++;
    else if (tok.kind === "RPAREN") parenDepth = Math.max(0, parenDepth - 1);
    else if (tok.kind === "LBRACKET") bracketDepth++;
    else if (tok.kind === "RBRACKET") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (tok.kind === "LBRACE") braceDepth++;
    else if (tok.kind === "RBRACE") braceDepth = Math.max(0, braceDepth - 1);

    tokens.push(p.advance());
  }

  if (tokens.length === 0) {
    throw new ParserError("Expected token value", p.current().span);
  }

  // Single STRING literal: unquote for CSS custom property value
  if (tokens.length === 1 && tokens[0].kind === "STRING") {
    return tokens[0].value;
  }

  if (p.source) {
    const startOffset = tokens[0].span.start.offset;
    const endOffset = tokens[tokens.length - 1].span.end.offset;
    return p.source.slice(startOffset, endOffset).trim();
  }

  return tokens
    .map((t) => t.value)
    .join(" ")
    .trim();
}

function parseCssKebabIdent(p: ParserHost): string {
  const startTok = p.current();
  const startOffset = startTok.span.start.offset;
  let endOffset = startTok.span.end.offset;

  if (!p.isIdentOrKeyword(startTok) && startTok.kind !== "NUMBER" && startTok.kind !== "MINUS") {
    throw new ParserError("Expected identifier or class/id name", startTok.span);
  }

  p.advance();

  while (!p.check("EOF")) {
    const nextTok = p.current();
    // Must be immediately adjacent with no whitespace
    if (nextTok.span.start.offset !== endOffset) {
      break;
    }
    if (p.isIdentOrKeyword(nextTok) || nextTok.kind === "NUMBER" || nextTok.kind === "MINUS") {
      endOffset = nextTok.span.end.offset;
      p.advance();
    } else {
      break;
    }
  }

  if (p.source) {
    return p.source.slice(startOffset, endOffset);
  }
  return startTok.value;
}

function parseCssPropertyName(p: ParserHost): string {
  const tok = p.current();
  if (tok.kind === "STRING") {
    p.advance();
    return tok.value;
  }

  // Unquoted CSS property name (e.g. margin, box_sizing, --color-slate-900, -webkit-font-smoothing, or $macro(...))
  const tokens: Token[] = [];
  let parenDepth = 0;
  let sawMacroParen = false;
  const isMacroStart = tok.value.startsWith("$") || tok.kind === "DOLLAR";
  while (
    !p.check("COLON") &&
    !p.check("SEMICOLON") &&
    !p.check("NEWLINE") &&
    !p.check("DEDENT") &&
    !p.check("RBRACE") &&
    !p.check("EOF")
  ) {
    if (
      parenDepth === 0 &&
      tokens.length > 0 &&
      p.current().span.start.line > tokens[tokens.length - 1].span.end.line
    ) {
      break;
    }
    const cur = p.advance();
    tokens.push(cur);
    if (cur.kind === "LPAREN") {
      parenDepth++;
      if (isMacroStart) sawMacroParen = true;
    } else if (cur.kind === "RPAREN") {
      parenDepth = Math.max(0, parenDepth - 1);
      if (isMacroStart && sawMacroParen && parenDepth === 0) {
        break;
      }
    }
  }

  if (tokens.length === 0) {
    throw new ParserError("Expected CSS property name", p.current().span);
  }

  if (p.source) {
    const startOffset = tokens[0].span.start.offset;
    const endOffset = tokens[tokens.length - 1].span.end.offset;
    return p.source.slice(startOffset, endOffset).trim();
  }

  return tokens.map((t) => t.value).join("");
}

function parseCssPropertyValue(p: ParserHost): string {
  const tokens: Token[] = [];
  let parenDepth = 0;
  let bracketDepth = 0;
  let braceDepth = 0;

  while (!p.check("EOF")) {
    const tok = p.current();

    // At top-level, stop on statement delimiters
    if (parenDepth === 0 && bracketDepth === 0 && braceDepth === 0) {
      if (
        tokens.length > 0 &&
        tok.span.start.line > tokens[tokens.length - 1].span.end.line &&
        tokens[tokens.length - 1].kind !== "COMMA"
      ) {
        break;
      }
      if (p.check("NEWLINE")) {
        // If the last token was a comma, this is a multi-line CSS value continuation
        if (tokens.length > 0 && tokens[tokens.length - 1].kind === "COMMA") {
          p.advance(); // consume NEWLINE
          if (p.check("INDENT")) {
            p.advance();
          }
          continue;
        }
        break;
      }
      if (p.check("SEMICOLON") || p.check("DEDENT") || p.check("RBRACE") || p.check("COMMENT")) {
        break;
      }
    }

    if (tok.kind === "LPAREN") parenDepth++;
    else if (tok.kind === "RPAREN") parenDepth = Math.max(0, parenDepth - 1);
    else if (tok.kind === "LBRACKET") bracketDepth++;
    else if (tok.kind === "RBRACKET") bracketDepth = Math.max(0, bracketDepth - 1);
    else if (tok.kind === "LBRACE") braceDepth++;
    else if (tok.kind === "RBRACE") braceDepth = Math.max(0, braceDepth - 1);

    tokens.push(p.advance());
  }

  if (tokens.length === 0) {
    throw new ParserError("Expected CSS property value", p.current().span);
  }

  // Single STRING literal: preserve inner unquoted string value for compatibility
  if (tokens.length === 1 && tokens[0].kind === "STRING") {
    return tokens[0].value;
  }

  if (p.source) {
    const startOffset = tokens[0].span.start.offset;
    const endOffset = tokens[tokens.length - 1].span.end.offset;
    return p.source.slice(startOffset, endOffset).trim();
  }

  let reconstructed = "";
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (i > 0 && t.span.start.offset > tokens[i - 1].span.end.offset) {
      reconstructed += " ";
    }
    reconstructed += t.value;
  }
  return reconstructed.trim();
}
