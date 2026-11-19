/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Multi-Language Pre-Write Syntax Validation Gate (`validateNativeSyntax`).
 */
import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as path from "node:path";
import postcss from "postcss";
import YAML from "yaml";
import { BoundedLruCache } from "../cache/lru.js";
import ts, { getCachedTsSourceFile } from "../compat/typescript.js";
import { type ProjectIdiomDefinition, stripJsonComments } from "../config/index.js";
import { detectTargetFromPathOrContent, type TargetLanguage } from "../emitters/index.js";
import { maskSourceLexically } from "./preprocessor.js";
export const HTML_VOID_TAGS: ReadonlySet<string> = new Set([
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

export interface SyntaxDiagnosticItem {
  line: number;
  column: number;
  message: string;
}

export interface SyntaxValidationResult {
  valid: boolean;
  diagnostics: string[];
  items: SyntaxDiagnosticItem[];
}

function getLineAndCol(source: string, offset: number): { line: number; column: number } {
  let line = 1;
  let lastNewline = -1;
  for (let i = 0; i < offset && i < source.length; i++) {
    if (source[i] === "\n") {
      line++;
      lastNewline = i;
    }
  }
  return { line, column: offset - lastNewline };
}

function getOriginalLineAndColFromMaskedOffset(
  maskedCode: string,
  maskedOffset: number,
  maskLengths: number[],
  originalCode: string,
): { line: number; column: number } {
  const MASK_PREFIX = "\uE000";
  let origOffset = 0;
  let i = 0;
  const limit = Math.min(maskedOffset, maskedCode.length);
  while (i < limit) {
    if (maskedCode[i] === MASK_PREFIX) {
      let j = i + 1;
      let idxStr = "";
      while (j < maskedCode.length) {
        const code = maskedCode.charCodeAt(j);
        if (code >= 0xe010 && code <= 0xe019) {
          idxStr += String(code - 0xe010);
          j++;
        } else {
          break;
        }
      }
      if (
        idxStr.length > 0 &&
        j < maskedCode.length &&
        (maskedCode[j] === "\uE001" || maskedCode[j] === "\uE002")
      ) {
        const idx = Number.parseInt(idxStr, 10);
        const origLen = maskLengths[idx] ?? j - i + 1;
        origOffset += origLen;
        i = j + 1;
        continue;
      }
    }
    origOffset++;
    i++;
  }
  return getLineAndCol(originalCode, origOffset);
}

function checkBalancedDelimiters(
  maskedCode: string,
  originalCode: string,
  maskLengths: number[] = [],
): SyntaxDiagnosticItem[] {
  const diags: SyntaxDiagnosticItem[] = [];
  const stack: Array<{ char: string; expected: string; offset: number }> = [];
  const pairs: Record<string, string> = {
    "(": ")",
    "[": "]",
    "{": "}",
  };
  const closers = new Set([")", "]", "}"]);

  for (let i = 0; i < maskedCode.length; i++) {
    const ch = maskedCode[i];
    if (pairs[ch]) {
      stack.push({ char: ch, expected: pairs[ch], offset: i });
    } else if (closers.has(ch)) {
      if (stack.length === 0) {
        const pos = getOriginalLineAndColFromMaskedOffset(maskedCode, i, maskLengths, originalCode);
        diags.push({
          ...pos,
          message: `Unexpected closing delimiter '${ch}'`,
        });
      } else {
        const top = stack.pop();
        if (top && top.expected !== ch) {
          const pos = getOriginalLineAndColFromMaskedOffset(
            maskedCode,
            i,
            maskLengths,
            originalCode,
          );
          diags.push({
            ...pos,
            message: `Mismatched delimiter '${ch}': expected '${top.expected}' to close '${top.char}'`,
          });
        }
      }
    }
  }

  for (const unclosed of stack) {
    const pos = getOriginalLineAndColFromMaskedOffset(
      maskedCode,
      unclosed.offset,
      maskLengths,
      originalCode,
    );
    diags.push({
      ...pos,
      message: `Unclosed delimiter '${unclosed.char}' (expected '${unclosed.expected}')`,
    });
  }

  return diags;
}

function checkLeakedAiceMarkers(
  maskedCode: string,
  originalCode: string,
  targetLang: TargetLanguage,
  activeIdioms?: Record<string, ProjectIdiomDefinition>,
  maskLengths: number[] = [],
): SyntaxDiagnosticItem[] {
  const diags: SyntaxDiagnosticItem[] = [];

  // 1. Check unexpanded registered `$idiom(...)` calls
  if (activeIdioms && Object.keys(activeIdioms).length > 0 && maskedCode.includes("$")) {
    for (const [k, def] of Object.entries(activeIdioms)) {
      const cleanName = (def.name || k).replace(/^\$/, "");
      if (!cleanName) continue;
      const esc = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\$${esc}\\s*\\(`, "g");
      for (const m of maskedCode.matchAll(re)) {
        const pos = getOriginalLineAndColFromMaskedOffset(
          maskedCode,
          m.index ?? 0,
          maskLengths,
          originalCode,
        );
        diags.push({
          ...pos,
          message: `Unexpanded AICE idiom call '$${cleanName}(...)'`,
        });
      }
    }
  }

  // 2. Check leaked AICE shorthand directives (`@idiom`, `@fn`, `@cls`, `@type`, `^fn`, `^class`, `^type`, `^const`, `^val`, `^mut`, `^let`, `^async`, `^static`)
  const directiveRe =
    /(?:^|(?<=\s))(?:@idiom|@fn|@cls|@type|\^fn|\^class|\^type|\^const|\^val|\^mut|\^let|\^async|\^static)\b/gm;
  for (const m of maskedCode.matchAll(directiveRe)) {
    const pos = getOriginalLineAndColFromMaskedOffset(
      maskedCode,
      m.index ?? 0,
      maskLengths,
      originalCode,
    );
    diags.push({
      ...pos,
      message: `Leaked AICE directive '${m[0].trim()}' in native ${targetLang} output`,
    });
  }

  // 3. Check leaked compact type sigils (`:#`, `:$`, `:?`, `[#]`, `[$]`, `[?]`, `-> #`, `-> $`, `-> ?`) outside strings/comments in code languages
  const isCodeLang =
    targetLang !== "css" &&
    targetLang !== "html" &&
    targetLang !== "xml" &&
    targetLang !== "twig" &&
    targetLang !== "json" &&
    targetLang !== "yaml" &&
    targetLang !== "text";

  if (isCodeLang) {
    const sigilRe =
      /(?::(?!=)[ \t]*(?:#|\$|\?|\[[ \t]*(?:#|\$|\?)[ \t]*\])|->[ \t]*(?:#|\$|\?|\[[ \t]*(?:#|\$|\?)[ \t]*\]))(?=[ \t]*(?:=|,|;|\)|\]|\}|->|\{|:|$))/gm;
    for (const m of maskedCode.matchAll(sigilRe)) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        m.index ?? 0,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: `Leaked AICE compact type sigil '${m[0].trim()}' in native ${targetLang} output`,
      });
    }

    if (targetLang !== "go") {
      const leakedArrowRetRe = /(?:^\s*|(?:=>|\)\s+|\belse\s+|\{\s*))<-(?=\s+[^\n;]+|\s*;?\s*$)/gm;
      for (const m of maskedCode.matchAll(leakedArrowRetRe)) {
        const pos = getOriginalLineAndColFromMaskedOffset(
          maskedCode,
          m.index ?? 0,
          maskLengths,
          originalCode,
        );
        diags.push({
          ...pos,
          message: `Leaked AICE return shorthand '<-' in native ${targetLang} output`,
        });
      }
    }

    const leakedRetRe = /^\s*ret(?:\s+[^=;:(\n][^\n]*|\s*;?\s*)$/gm;
    for (const m of maskedCode.matchAll(leakedRetRe)) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        m.index ?? 0,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: `Leaked AICE return keyword 'ret' in native ${targetLang} output`,
      });
    }
  }

  if (
    targetLang === "python" ||
    targetLang === "go" ||
    targetLang === "cpp" ||
    targetLang === "csharp" ||
    targetLang === "java" ||
    targetLang === "kotlin" ||
    targetLang === "php"
  ) {
    const pubFnRe =
      /^\s*pub\s+(?:async\s+|static\s+|suspend\s+)?(?:fn|class|type|const|val|mut|let)\s+[A-Za-z_]/gm;
    for (const m of maskedCode.matchAll(pubFnRe)) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        m.index ?? 0,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: `Leaked AICE declaration keyword '${m[0].trim()}' in native ${targetLang} output`,
      });
    }
  }

  return diags;
}

function collectJsTsAstArtifacts(sf: ts.SourceFile): SyntaxDiagnosticItem[] {
  const diags: SyntaxDiagnosticItem[] = [];
  const strayKeywords = new Set(["pub", "fn", "ret", "val", "mut"]);

  const visit = (node: ts.Node) => {
    if (ts.isExpressionStatement(node) && ts.isIdentifier(node.expression)) {
      const id = node.expression.text;
      if (strayKeywords.has(id)) {
        const pos = sf.getLineAndCharacterOfPosition(node.getStart(sf));
        diags.push({
          line: pos.line + 1,
          column: pos.character + 1,
          message: `Stray AICE keyword '${id};' emitted as invalid statement`,
        });
      }
    }
    ts.forEachChild(node, visit);
  };

  visit(sf);
  return diags;
}

function checkHtmlScriptAndStyleTags(code: string): SyntaxDiagnosticItem[] {
  const items: SyntaxDiagnosticItem[] = [];

  for (const tag of ["script", "style"]) {
    let openCount = 0;
    let closeCount = 0;
    let i = 0;
    const len = code.length;
    const isScript = tag === "script";

    while (i < len) {
      if (code.startsWith("<!--", i)) {
        const closeHtmlComment = code.indexOf("-->", i + 4);
        i = closeHtmlComment >= 0 ? closeHtmlComment + 3 : len;
        continue;
      }
      if (code.startsWith("{#", i)) {
        const closeTwigComment = code.indexOf("#}", i + 2);
        i = closeTwigComment >= 0 ? closeTwigComment + 2 : len;
        continue;
      }
      if (
        code[i] === "<" &&
        code.slice(i + 1, i + 1 + tag.length).toLowerCase() === tag &&
        (i + 1 + tag.length === len || /[\s>/]/.test(code[i + 1 + tag.length]))
      ) {
        const tagEnd = code.indexOf(">", i + 1 + tag.length);
        if (tagEnd < 0) {
          items.push({
            line: getLineAndCol(code, i).line,
            column: getLineAndCol(code, i).column,
            message: `Unterminated <${tag}> tag opening`,
          });
          break;
        }

        if (code[tagEnd - 1] === "/") {
          i = tagEnd + 1;
          continue;
        }

        openCount++;
        i = tagEnd + 1;

        let closed = false;
        while (i < len) {
          const ch = code[i];

          if (isScript && ch === "/" && code[i + 1] === "/") {
            let nextNl = code.indexOf("\n", i + 2);
            if (nextNl < 0) nextNl = len;
            i = nextNl;
            continue;
          }

          if (ch === "/" && code[i + 1] === "*") {
            const closeCmt = code.indexOf("*/", i + 2);
            if (closeCmt < 0) {
              i = len;
              break;
            }
            i = closeCmt + 2;
            continue;
          }

          if (ch === "'") {
            let j = i + 1;
            while (j < len && code[j] !== "'") {
              if (code[j] === "\\" && j + 1 < len) j += 2;
              else if (code[j] === "\n" || code[j] === "\r") break;
              else j++;
            }
            if (j < len && code[j] === "'") j++;
            i = j;
            continue;
          }

          if (ch === '"') {
            let j = i + 1;
            while (j < len && code[j] !== '"') {
              if (code[j] === "\\" && j + 1 < len) j += 2;
              else if (code[j] === "\n" || code[j] === "\r") break;
              else j++;
            }
            if (j < len && code[j] === '"') j++;
            i = j;
            continue;
          }

          if (isScript && ch === "`") {
            let j = i + 1;
            while (j < len && code[j] !== "`") {
              if (code[j] === "\\" && j + 1 < len) j += 2;
              else j++;
            }
            if (j < len && code[j] === "`") j++;
            i = j;
            continue;
          }

          if (
            ch === "<" &&
            code[i + 1] === "/" &&
            code.slice(i + 2, i + 2 + tag.length).toLowerCase() === tag &&
            (i + 2 + tag.length === len || /[\s>]/.test(code[i + 2 + tag.length]))
          ) {
            const closeEnd = code.indexOf(">", i + 2 + tag.length);
            if (closeEnd >= 0) {
              closeCount++;
              closed = true;
              i = closeEnd + 1;
              break;
            }
          }

          i++;
        }

        if (!closed) {
          break;
        }
        continue;
      }

      if (
        code[i] === "<" &&
        code[i + 1] === "/" &&
        code.slice(i + 2, i + 2 + tag.length).toLowerCase() === tag &&
        (i + 2 + tag.length === len || /[\s>]/.test(code[i + 2 + tag.length]))
      ) {
        closeCount++;
        const closeEnd = code.indexOf(">", i + 2 + tag.length);
        i = closeEnd >= 0 ? closeEnd + 1 : i + 2 + tag.length;
        continue;
      }

      i++;
    }

    if (openCount !== closeCount) {
      items.push({
        line: 1,
        column: 1,
        message: `Unbalanced <${tag}> tags (${openCount} open vs ${closeCount} close)`,
      });
    }
  }

  return items;
}
const MAX_SYNTAX_VALIDATION_CACHE = 128;
const syntaxValidationCache = new BoundedLruCache<
  string,
  { code: string; result: SyntaxValidationResult }
>(MAX_SYNTAX_VALIDATION_CACHE);
const pythonSyntaxCache = new BoundedLruCache<
  string,
  { code: string; items: SyntaxDiagnosticItem[] }
>(MAX_SYNTAX_VALIDATION_CACHE);
const bashSyntaxCache = new BoundedLruCache<
  string,
  { code: string; items: SyntaxDiagnosticItem[] }
>(MAX_SYNTAX_VALIDATION_CACHE);

function hashCodeKey(code: string): string {
  return `${code.length}:${createHash("sha256").update(code, "utf-8").digest("hex").slice(0, 24)}`;
}

const PYTHON_SYNTAX_CHECK_SCRIPT =
  'import sys\ntry:\n compile(sys.stdin.read(),"<a>","exec")\nexcept SyntaxError as e:\n sys.stdout.write(f"{e.lineno or 1}\\t{e.offset or 1}\\t{type(e).__name__}\\t{e.msg or e}")\n sys.exit(1)';

function stripInlineBacktickSpans(line: string): string {
  let out = "";
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (line[i] === "`") {
      let ticks = 1;
      while (i + ticks < len && line[i + ticks] === "`") ticks++;
      const seq = "`".repeat(ticks);
      const close = line.indexOf(seq, i + ticks);
      if (close >= 0) {
        out += " ".repeat(close + ticks - i);
        i = close + ticks;
        continue;
      }
      out += " ".repeat(ticks);
      i += ticks;
      continue;
    }
    out += line[i];
    i++;
  }
  return out;
}

export function checkUnfencedHunkCorruption(
  code: string,
  isMarkdownOrText: boolean,
): SyntaxDiagnosticItem[] {
  const diags: SyntaxDiagnosticItem[] = [];
  if (!code.includes("<<<")) return diags;

  const lines = code.split(/\r?\n/);
  let inFence = false;
  let fenceChar = "";
  let fenceLen = 0;
  let strayOpenLine = -1;
  let strayHasSep = false;

  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx] ?? "";
    if (isMarkdownOrText) {
      if (!inFence) {
        const openMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
        if (openMatch && !(openMatch[1]![0] === "`" && openMatch[2]!.includes("`"))) {
          inFence = true;
          fenceChar = openMatch[1]![0]!;
          fenceLen = openMatch[1]!.length;
          continue;
        }
      } else {
        const closeMatch = line.match(/^[ \t]{0,3}(`{3,}|~{3,})[ \t]*$/);
        if (closeMatch && closeMatch[1]![0] === fenceChar && closeMatch[1]!.length >= fenceLen) {
          inFence = false;
          fenceChar = "";
          fenceLen = 0;
        }
        continue;
      }
    }

    const stripped = isMarkdownOrText ? stripInlineBacktickSpans(line) : line;
    if (/(?:^|\s)<{3,6}(?:\s+.*?)?\s+={3,6}(?:\s+.*?)?\s+>{3,6}(?=\s|$)/.test(stripped)) {
      diags.push({
        line: idx + 1,
        column: 1,
        message:
          "Unparsed single-line '<<< ... === ... >>>' hunk marker detected; put '<<<', '===', and '>>>' on separate lines",
      });
      continue;
    }

    if (isMarkdownOrText) {
      if (/^[ \t]*<{3,6}[ \t]*$/.test(stripped)) {
        strayOpenLine = idx + 1;
        strayHasSep = false;
      } else if (strayOpenLine > 0 && /^[ \t]*={3,6}[ \t]*$/.test(stripped)) {
        strayHasSep = true;
      } else if (strayOpenLine > 0 && strayHasSep && /^[ \t]*>{3,6}[ \t]*$/.test(stripped)) {
        diags.push({
          line: strayOpenLine,
          column: 1,
          message: "Unparsed '<<< / === / >>>' hunk markers leaked into file content",
        });
        strayOpenLine = -1;
        strayHasSep = false;
      }
    }
  }

  return diags;
}

function checkStructuralTruncationArtifacts(
  maskedCode: string,
  originalCode: string,
  maskLengths: number[] = [],
): SyntaxDiagnosticItem[] {
  const diags: SyntaxDiagnosticItem[] = [];
  const lines = maskedCode.split(/\r?\n/);
  let offset = 0;
  let strayHunkOpenOffset = -1;
  let strayHunkHasSep = false;

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i] ?? "";
    const trimmed = line.trim();

    // 1. Git merge conflict markers outside strings/comments
    if (/^(?:<{7}(?:\s|$)|={7}$|>{7}(?:\s|$))/.test(line)) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        offset,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: `Unresolved merge conflict marker '${trimmed.slice(0, 7)}' detected`,
      });
    }

    // 2. Leaked AICE multi-block splice header (`=== path/to/file.ext ===` or `=== file:L1-L5 ===`)
    if (
      /^={3}\s+\S+(?::\S+)?\s+={3}$/.test(trimmed) &&
      /[./\\:]/.test(trimmed.slice(3, -3).trim())
    ) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        offset,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: `Leaked AICE splice header '${trimmed}' in native output`,
      });
    }

    // 3. Leaked multiline `<<< / === / >>>` hunk fences outside strings/comments/heredocs
    if (/^[ \t]*<{3,6}[ \t]*$/.test(line)) {
      strayHunkOpenOffset = offset;
      strayHunkHasSep = false;
    } else if (strayHunkOpenOffset >= 0 && /^[ \t]*={3,6}[ \t]*$/.test(line)) {
      strayHunkHasSep = true;
    } else if (strayHunkOpenOffset >= 0 && strayHunkHasSep && /^[ \t]*>{3,6}[ \t]*$/.test(line)) {
      const pos = getOriginalLineAndColFromMaskedOffset(
        maskedCode,
        strayHunkOpenOffset,
        maskLengths,
        originalCode,
      );
      diags.push({
        ...pos,
        message: "Unparsed '<<< / === / >>>' hunk markers leaked into native code",
      });
      strayHunkOpenOffset = -1;
      strayHunkHasSep = false;
    }

    offset += line.length + 1;
  }

  return diags;
}

export function validateXmlWellFormedness(code: string): SyntaxDiagnosticItem[] {
  const items: SyntaxDiagnosticItem[] = [];
  const len = code.length;
  let i = code.startsWith("\uFEFF") ? 1 : 0;
  const tagStack: Array<{ name: string; line: number; column: number }> = [];

  while (i < len) {
    const lt = code.indexOf("<", i);
    if (lt < 0) break;
    i = lt;

    // 1. XML comment `<!-- ... -->`
    if (code.startsWith("<!--", i)) {
      const closeIdx = code.indexOf("-->", i + 4);
      if (closeIdx < 0) {
        items.push({
          ...getLineAndCol(code, i),
          message: "Unterminated XML comment '<!--'",
        });
        break;
      }
      i = closeIdx + 3;
      continue;
    }

    // 2. CDATA section `<![CDATA[ ... ]]>`
    if (code.startsWith("<![CDATA[", i)) {
      const closeIdx = code.indexOf("]]>", i + 9);
      if (closeIdx < 0) {
        items.push({
          ...getLineAndCol(code, i),
          message: "Unterminated XML CDATA section '<![CDATA['",
        });
        break;
      }
      i = closeIdx + 3;
      continue;
    }

    // 3. Processing instruction `<?...?>`
    if (code.startsWith("<?", i)) {
      const closeIdx = code.indexOf("?>", i + 2);
      if (closeIdx < 0) {
        items.push({
          ...getLineAndCol(code, i),
          message: "Unterminated XML processing instruction '<?'",
        });
        break;
      }
      i = closeIdx + 2;
      continue;
    }

    // 4. DOCTYPE or markup declaration `<!DOCTYPE ...>` / `<!ENTITY ...>`
    if (code.startsWith("<!", i)) {
      let j = i + 2;
      let bracketDepth = 0;
      let quote: string | null = null;
      let closed = false;
      while (j < len) {
        const c = code[j];
        if (quote) {
          if (c === quote) quote = null;
          j++;
          continue;
        }
        if (c === '"' || c === "'") {
          quote = c;
          j++;
          continue;
        }
        if (c === "[") {
          bracketDepth++;
        } else if (c === "]") {
          bracketDepth = Math.max(0, bracketDepth - 1);
        } else if (c === ">" && bracketDepth === 0) {
          closed = true;
          j++;
          break;
        }
        j++;
      }
      if (!closed) {
        items.push({
          ...getLineAndCol(code, i),
          message: "Unterminated XML declaration '<!'",
        });
        break;
      }
      i = j;
      continue;
    }

    // 5. Closing tag `</name>`
    if (code[i + 1] === "/") {
      const nameMatch = code.slice(i + 2).match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)\s*>/);
      if (!nameMatch) {
        items.push({
          ...getLineAndCol(code, i),
          message: "Malformed or unterminated XML closing tag '</...'",
        });
        const nextGt = code.indexOf(">", i + 2);
        if (nextGt < 0) break;
        i = nextGt + 1;
        continue;
      }
      const closeName = nameMatch[1]!;
      const closePos = getLineAndCol(code, i);
      if (tagStack.length === 0) {
        items.push({
          ...closePos,
          message: `Unexpected XML closing tag '</${closeName}>' with no matching opening tag`,
        });
      } else {
        const top = tagStack[tagStack.length - 1]!;
        if (top.name === closeName) {
          tagStack.pop();
        } else {
          items.push({
            ...closePos,
            message: `Mismatched XML closing tag '</${closeName}>': expected '</${top.name}>' (opened at line ${top.line})`,
          });
          let matchIdx = -1;
          for (let s = tagStack.length - 2; s >= 0; s--) {
            if (tagStack[s]!.name === closeName) {
              matchIdx = s;
              break;
            }
          }
          if (matchIdx >= 0) {
            tagStack.length = matchIdx;
          }
        }
      }
      i += 2 + nameMatch[0].length;
      continue;
    }

    // 6. Opening or self-closing tag `<name ...>` / `<name .../>`
    const openMatch = code.slice(i + 1).match(/^([A-Za-z_:][A-Za-z0-9_.:-]*)(?=[\s/>]|$)/);
    if (!openMatch) {
      items.push({
        ...getLineAndCol(code, i),
        message: "Malformed XML tag or unescaped '<' character",
      });
      i++;
      continue;
    }
    const tagName = openMatch[1]!;
    const tagPos = getLineAndCol(code, i);
    let j = i + 1 + tagName.length;
    let quote: string | null = null;
    let closed = false;
    let selfClosing = false;
    while (j < len) {
      const c = code[j];
      if (quote) {
        if (c === quote) quote = null;
        j++;
        continue;
      }
      if (c === '"' || c === "'") {
        quote = c;
        j++;
        continue;
      }
      if (c === "<") {
        items.push({
          ...tagPos,
          message: `Unterminated XML tag '<${tagName}>' (missing '>')`,
        });
        break;
      }
      if (c === ">") {
        let prev = j - 1;
        while (prev > i && (code[prev] === " " || code[prev] === "\t")) prev--;
        selfClosing = code[prev] === "/";
        closed = true;
        j++;
        break;
      }
      j++;
    }
    if (quote) {
      items.push({
        ...tagPos,
        message: `Unterminated attribute quote ${quote} in XML tag '<${tagName}>'`,
      });
      break;
    }
    if (!closed) {
      if (j >= len) {
        items.push({
          ...tagPos,
          message: `Unterminated XML tag '<${tagName}>' (missing '>')`,
        });
        break;
      }
      i = j;
      continue;
    }
    if (!selfClosing) {
      tagStack.push({ name: tagName, line: tagPos.line, column: tagPos.column });
    }
    i = j;
  }

  for (const unclosed of tagStack) {
    items.push({
      line: unclosed.line,
      column: unclosed.column,
      message: `Unclosed XML tag '<${unclosed.name}>' (expected '</${unclosed.name}>')`,
    });
  }

  items.push(...checkUnfencedHunkCorruption(code, false));
  items.push(...checkStructuralTruncationArtifacts(code, code));
  return items;
}

export function validateNativeSyntax(
  code: string,
  rawTargetLang: TargetLanguage,
  filePath = "<memory>",
  activeIdioms?: Record<string, ProjectIdiomDefinition>,
): SyntaxValidationResult {
  if (filePath.endsWith(".aice")) {
    return { valid: true, diagnostics: [], items: [] };
  }

  let targetLang: TargetLanguage = rawTargetLang;
  let passthroughMode: false | "java" | "xml" | "text" = false;
  const lowerFp = filePath.toLowerCase();
  if (filePath && filePath !== "<memory>") {
    if (lowerFp.endsWith(".webmanifest") || lowerFp.endsWith(".jsonc")) {
      targetLang = "json";
    } else if (lowerFp.endsWith(".java")) {
      targetLang = "java";
      passthroughMode = "java";
    } else if (lowerFp.endsWith(".xml") || lowerFp.endsWith(".svg")) {
      targetLang = "xml";
      passthroughMode = "xml";
    } else if (
      targetLang === "typescript" &&
      !lowerFp.endsWith(".ts") &&
      !lowerFp.endsWith(".mts") &&
      !lowerFp.endsWith(".cts")
    ) {
      const detected = detectTargetFromPathOrContent(filePath, code);
      if (detected === "text" || detected === "passthrough") {
        passthroughMode = "text";
      } else {
        targetLang = detected;
      }
    }
  }
  if (!passthroughMode) {
    if (targetLang === "java") passthroughMode = "java";
    else if (targetLang === "xml") passthroughMode = "xml";
    else if (targetLang === "text") passthroughMode = "text";
  }

  const idiomKey =
    activeIdioms && Object.keys(activeIdioms).length > 0
      ? Object.keys(activeIdioms).sort().join(",")
      : "";
  const codeHash = hashCodeKey(code);
  const cacheKey = `${passthroughMode || targetLang}:${lowerFp}:${idiomKey}:${codeHash}`;
  const cachedEntry = syntaxValidationCache.get(cacheKey);
  if (cachedEntry && cachedEntry.code === code) {
    return cachedEntry.result;
  }

  const items: SyntaxDiagnosticItem[] = [];
  const finish = (): SyntaxValidationResult => {
    const res: SyntaxValidationResult = {
      valid: items.length === 0,
      diagnostics: items.map((d) => `Line ${d.line}:${d.column} - ${d.message}`),
      items,
    };
    syntaxValidationCache.set(cacheKey, { code, result: res });
    return res;
  };

  if (passthroughMode === "text") {
    items.push(...checkUnfencedHunkCorruption(code, true));
    return finish();
  }

  if (passthroughMode === "xml") {
    items.push(...validateXmlWellFormedness(code));
    return finish();
  }

  if (passthroughMode === "java") {
    const maskRes = maskSourceLexically(code, "java", activeIdioms);
    items.push(...maskRes.unterminatedDiagnostics);
    items.push(...checkBalancedDelimiters(maskRes.maskedCode, code, maskRes.maskLengths));
    items.push(
      ...checkLeakedAiceMarkers(
        maskRes.maskedCode,
        code,
        "java",
        activeIdioms,
        maskRes.maskLengths,
      ),
    );
    items.push(...checkUnfencedHunkCorruption(code, false));
    items.push(
      ...checkStructuralTruncationArtifacts(maskRes.maskedCode, code, maskRes.maskLengths),
    );
    return finish();
  }

  if (targetLang === "json") {
    const base = path.basename(filePath).toLowerCase();
    const allowComments =
      base.endsWith(".jsonc") || base.startsWith("tsconfig") || base.startsWith("jsconfig");
    try {
      JSON.parse(allowComments ? stripJsonComments(code) : code);
    } catch (err) {
      items.push({
        line: 1,
        column: 1,
        message: `Invalid JSON syntax: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return finish();
  }

  if (targetLang === "yaml") {
    try {
      YAML.parse(code);
    } catch (err) {
      items.push({
        line: 1,
        column: 1,
        message: `Invalid YAML syntax: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
    return finish();
  }

  // 2. TypeScript / JavaScript / JSX / TSX
  if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    const ext = path.extname(filePath).toLowerCase();
    const scriptKind =
      targetLang === "tsx" || ext === ".tsx"
        ? ts.ScriptKind.TSX
        : ext === ".jsx"
          ? ts.ScriptKind.JSX
          : targetLang === "javascript" || ext === ".js" || ext === ".mjs" || ext === ".cjs"
            ? ts.ScriptKind.JS
            : ts.ScriptKind.TS;

    const sf = getCachedTsSourceFile(code, filePath, scriptKind);
    const parseDiags =
      (sf as unknown as { parseDiagnostics?: ts.DiagnosticWithLocation[] }).parseDiagnostics ?? [];

    for (const d of parseDiags) {
      const pos = sf.getLineAndCharacterOfPosition(d.start ?? 0);
      const msg = ts.flattenDiagnosticMessageText(d.messageText, " ");
      items.push({
        line: pos.line + 1,
        column: pos.character + 1,
        message: msg,
      });
    }

    items.push(...collectJsTsAstArtifacts(sf));

    if (/\bfunction\s+__top_level__\s*\(/.test(code)) {
      items.push({
        line: 1,
        column: 1,
        message: "Unexpected synthetic '__top_level__' wrapper emitted in JS/TS output",
      });
    }

    const maskRes = maskSourceLexically(code, targetLang, activeIdioms);
    items.push(
      ...checkLeakedAiceMarkers(
        maskRes.maskedCode,
        code,
        targetLang,
        activeIdioms,
        maskRes.maskLengths,
      ),
    );
    return finish();
  }

  // 3. CSS
  if (targetLang === "css") {
    const maskRes = maskSourceLexically(code, "css", activeIdioms);
    items.push(...maskRes.unterminatedDiagnostics);
    items.push(...checkBalancedDelimiters(maskRes.maskedCode, code, maskRes.maskLengths));
    items.push(
      ...checkLeakedAiceMarkers(maskRes.maskedCode, code, "css", activeIdioms, maskRes.maskLengths),
    );
    try {
      postcss.parse(code, { from: filePath });
    } catch (err) {
      const cssErr = err as { line?: number; column?: number; reason?: string; message?: string };
      items.push({
        line: cssErr.line ?? 1,
        column: cssErr.column ?? 1,
        message: cssErr.reason ?? cssErr.message ?? String(err),
      });
    }
    return finish();
  }

  // 4. HTML & Twig
  if (targetLang === "html" || targetLang === "twig") {
    const maskRes = maskSourceLexically(code, targetLang, activeIdioms);
    const masked = maskRes.maskedCode;
    items.push(...checkHtmlScriptAndStyleTags(code));

    if (
      targetLang === "twig" ||
      masked.includes("{%") ||
      masked.includes("{{") ||
      masked.includes("%}")
    ) {
      let openStmt = 0;
      let closeStmt = 0;
      for (let i = 0; i < masked.length - 1; i++) {
        if (masked[i] === "{" && masked[i + 1] === "%") {
          openStmt++;
          i++;
        } else if (masked[i] === "%" && masked[i + 1] === "}") {
          closeStmt++;
          i++;
        }
      }
      if (openStmt !== closeStmt) {
        items.push({
          line: 1,
          column: 1,
          message: `Unbalanced Twig '{% ... %}' delimiters (${openStmt} '{%' vs ${closeStmt} '%}')`,
        });
      }

      const braceStack: Array<{ token: "{{" | "{"; offset: number }> = [];
      let unexpectedCloseTwig = 0;
      for (let i = 0; i < masked.length; i++) {
        if (masked[i] === "{" && masked[i + 1] === "%") {
          i++;
          continue;
        }
        if (masked[i] === "%" && masked[i + 1] === "}") {
          i++;
          continue;
        }
        if (masked[i] === "{" && masked[i + 1] === "{") {
          braceStack.push({ token: "{{", offset: i });
          i++;
          continue;
        }
        if (masked[i] === "{") {
          braceStack.push({ token: "{", offset: i });
          continue;
        }
        if (masked[i] === "}") {
          const top = braceStack[braceStack.length - 1];
          if (top?.token === "{{" && masked[i + 1] === "}") {
            braceStack.pop();
            i++;
            continue;
          }
          if (top?.token === "{") {
            braceStack.pop();
            continue;
          }
          if (masked[i + 1] === "}") {
            unexpectedCloseTwig++;
            i++;
          }
        }
      }
      const unclosedTwigExprs = braceStack.filter((b) => b.token === "{{");
      if (unclosedTwigExprs.length > 0 || unexpectedCloseTwig > 0) {
        const firstPos =
          unclosedTwigExprs.length > 0
            ? getOriginalLineAndColFromMaskedOffset(
                masked,
                unclosedTwigExprs[0].offset,
                maskRes.maskLengths,
                code,
              )
            : { line: 1, column: 1 };
        items.push({
          ...firstPos,
          message: `Unbalanced Twig '{{ ... }}' delimiters (${unclosedTwigExprs.length} unclosed '{{', ${unexpectedCloseTwig} unexpected '}}')`,
        });
      }
    }

    return finish();
  }

  // 4b. Shell, PowerShell, Batch, Markdown
  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "markdown"
  ) {
    items.push(...checkUnfencedHunkCorruption(code, targetLang === "markdown"));
    if (targetLang === "shell" && !filePath.toLowerCase().endsWith(".zsh")) {
      const cachedBash = bashSyntaxCache.get(codeHash);
      if (cachedBash && cachedBash.code === code) {
        items.push(...cachedBash.items);
      } else {
        const bashItems: SyntaxDiagnosticItem[] = [];
        try {
          const res = spawnSync("bash", ["-n"], {
            input: code,
            encoding: "utf-8",
            timeout: 2500,
          });
          if (res.status !== null && res.status !== 0 && !res.error) {
            const stderr = (res.stderr ?? "").trim();
            const lineMatch = stderr.match(/line\s+(\d+):\s*(.+)/i);
            bashItems.push({
              line: lineMatch ? Number.parseInt(lineMatch[1], 10) : 1,
              column: 1,
              message: lineMatch ? lineMatch[2].trim() : stderr || "Shell syntax error",
            });
          }
          if (!res.error) {
            bashSyntaxCache.set(codeHash, { code, items: bashItems });
          }
        } catch {
          // bash binary unavailable; skip external syntax check
        }
        items.push(...bashItems);
      }
    }
    return finish();
  }
  // 4c. AIPL validation
  if (targetLang === "aipl") {
    const maskRes = maskSourceLexically(code, targetLang, activeIdioms);
    items.push(...maskRes.unterminatedDiagnostics);
    items.push(...checkBalancedDelimiters(maskRes.maskedCode, code, maskRes.maskLengths));

    const lines = code.split(/\r?\n/);
    const indentStack = [0];
    let prevTrimmed = "";
    let prevLineNum = 0;
    let openDelims = 0;
    let inMultilineFnHeader = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const rawTrimmed = line.trim();
      if (!rawTrimmed || rawTrimmed.startsWith("//")) continue;
      let commentCutIdx = -1;
      let scanQuote: string | null = null;
      for (let c = 0; c < rawTrimmed.length; c++) {
        const ch = rawTrimmed[c];
        if (scanQuote) {
          if (ch === "\\" && c + 1 < rawTrimmed.length) {
            c++;
            continue;
          }
          if (ch === scanQuote) {
            scanQuote = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          scanQuote = ch;
          continue;
        }
        if (ch === "/" && rawTrimmed[c + 1] === "/") {
          commentCutIdx = c;
          break;
        }
      }
      const trimmed = (commentCutIdx >= 0 ? rawTrimmed.slice(0, commentCutIdx) : rawTrimmed).trim();
      if (!trimmed) continue;

      const indentMatch = line.match(/^[ \t]*/);
      const leadingWs = indentMatch ? indentMatch[0] : "";
      if (leadingWs.includes("\t") && leadingWs.includes(" ")) {
        items.push({
          line: i + 1,
          column: 1,
          message: "AIPL indentation error: inconsistent indentation (mixed tabs and spaces)",
        });
      }

      const curIndent = leadingWs.length;
      const topIndent = indentStack[indentStack.length - 1];

      if (openDelims === 0) {
        if (curIndent > topIndent) {
          if (
            !prevTrimmed.endsWith(":") &&
            !prevTrimmed.endsWith("{") &&
            !prevTrimmed.endsWith("[") &&
            !prevTrimmed.endsWith("(")
          ) {
            items.push({
              line: i + 1,
              column: curIndent + 1,
              message: `AIPL indentation error: unexpected indent increase without preceding colon on line ${prevLineNum}`,
            });
          }
          indentStack.push(curIndent);
        } else if (curIndent < topIndent) {
          while (indentStack.length > 1 && indentStack[indentStack.length - 1] > curIndent) {
            indentStack.pop();
          }
          if (indentStack[indentStack.length - 1] !== curIndent) {
            items.push({
              line: i + 1,
              column: curIndent + 1,
              message:
                "AIPL indentation error: unindent does not match any outer indentation level",
            });
          }
        }
      }

      const openDelimsBefore = openDelims;
      let inStrQuote: string | null = null;
      for (let c = 0; c < trimmed.length; c++) {
        const ch = trimmed[c];
        if (inStrQuote) {
          if (ch === "\\" && c + 1 < trimmed.length) {
            c++;
            continue;
          }
          if (ch === inStrQuote) {
            inStrQuote = null;
          }
          continue;
        }
        if (ch === '"' || ch === "'") {
          inStrQuote = ch;
          continue;
        }
        if (ch === "(" || ch === "[" || ch === "{") openDelims++;
        else if (ch === ")" || ch === "]" || ch === "}") openDelims = Math.max(0, openDelims - 1);
      }

      const isAiplInlineFn = (text: string) => {
        const openParen = text.indexOf("(");
        if (openParen < 0) return false;
        let depth = 0;
        let inQuote: string | null = null;
        let paramClose = -1;
        for (let k = openParen; k < text.length; k++) {
          const c = text[k]!;
          if (inQuote) {
            if (c === "\\") {
              k++;
              continue;
            }
            if (c === inQuote) inQuote = null;
            continue;
          }
          if (c === '"' || c === "'") {
            inQuote = c;
            continue;
          }
          if (c === "(") depth++;
          else if (c === ")") {
            depth--;
            if (depth === 0) {
              paramClose = k;
              break;
            }
          }
        }
        if (paramClose < 0) return false;
        const afterParen = text.slice(paramClose + 1).trim();
        if (afterParen.startsWith("=") && !afterParen.startsWith("==")) return true;
        if (/^(?::|->)\s*[^=:]+=\s*\S+/.test(afterParen)) return true;
        const colons = (afterParen.match(/:/g) || []).length;
        if (colons >= 2) return true;
        if (colons === 1 && afterParen.includes("=")) return true;
        if (
          colons === 1 &&
          /^\s*:\s*(?:ret\b|return\b|pass\b|assert\b|print|if\b|\{)/.test(afterParen)
        )
          return true;
        return false;
      };

      if (openDelimsBefore === 0 && /^(?:pub\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(trimmed)) {
        if (openDelims > 0) {
          inMultilineFnHeader = true;
        } else if (!isAiplInlineFn(trimmed) && !trimmed.endsWith(":")) {
          items.push({
            line: i + 1,
            column: line.length,
            message: `AIPL function signature must end with ':' before indented body`,
          });
        }
      } else if (inMultilineFnHeader && openDelims === 0) {
        inMultilineFnHeader = false;
        if (!isAiplInlineFn(trimmed) && !trimmed.endsWith(":")) {
          items.push({
            line: i + 1,
            column: line.length,
            message: `AIPL function signature must end with ':' before indented body`,
          });
        }
      }
      if (openDelimsBefore === 0 && /^(?:pub\s+)?struct\s+[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)) {
        const hasTupleOpen = /^(?:pub\s+)?struct\s+[A-Za-z0-9_]+\s*\(/.test(trimmed);
        const isSingleLineTupleStruct =
          /^(?:pub\s+)?struct\s+[A-Za-z0-9_]+\s*\([^)]*\)\s*$/.test(trimmed) ||
          (hasTupleOpen && openDelims === 0 && trimmed.endsWith(")"));
        const isMultiLineTupleStruct = hasTupleOpen && openDelims > 0;
        if (!isSingleLineTupleStruct && !isMultiLineTupleStruct && !trimmed.endsWith(":")) {
          items.push({
            line: i + 1,
            column: line.length,
            message: `AIPL struct signature must end with ':' before indented body`,
          });
        }
      }

      prevTrimmed = trimmed;
      prevLineNum = i + 1;
    }

    return finish();
  }

  // 5. Python, Rust, Go, C++, C#, Kotlin, PHP
  const maskRes = maskSourceLexically(code, targetLang, activeIdioms);
  items.push(...maskRes.unterminatedDiagnostics);
  items.push(...checkBalancedDelimiters(maskRes.maskedCode, code, maskRes.maskLengths));
  items.push(
    ...checkLeakedAiceMarkers(
      maskRes.maskedCode,
      code,
      targetLang,
      activeIdioms,
      maskRes.maskLengths,
    ),
  );
  items.push(...checkUnfencedHunkCorruption(code, false));
  items.push(...checkStructuralTruncationArtifacts(maskRes.maskedCode, code, maskRes.maskLengths));

  if (targetLang === "python" && items.length === 0 && code.trim().length > 0) {
    const cachedPy = pythonSyntaxCache.get(codeHash);
    if (cachedPy && cachedPy.code === code) {
      items.push(...cachedPy.items);
    } else {
      const pyItems: SyntaxDiagnosticItem[] = [];
      try {
        const res = spawnSync("python3", ["-S", "-I", "-c", PYTHON_SYNTAX_CHECK_SCRIPT], {
          input: code,
          encoding: "utf-8",
          timeout: 2500,
        });
        if (res.status !== null && res.status !== 0 && !res.error) {
          const out = (res.stdout ?? "").trim();
          const parts = out.split("\t");
          if (parts.length >= 4) {
            const lineNum = Number.parseInt(parts[0]!, 10) || 1;
            const colNum = Number.parseInt(parts[1]!, 10) || 1;
            const errType = parts[2] || "SyntaxError";
            const errMsg = parts.slice(3).join("\t") || "invalid Python syntax";
            pyItems.push({
              line: lineNum,
              column: colNum,
              message: `${errType}: ${errMsg}`,
            });
          } else {
            const rawMsg = (res.stderr || out || "Python syntax error").trim();
            pyItems.push({ line: 1, column: 1, message: rawMsg });
          }
        }
        if (!res.error) {
          pythonSyntaxCache.set(codeHash, { code, items: pyItems });
        }
      } catch {
        // python3 binary unavailable; fallback delimiter/lexical checks already ran
      }
      items.push(...pyItems);
    }
  }

  return finish();
}
/**
 * Formats syntax diagnostics as a Markdown section for `aice outline` and `aice context`.
 */
export function formatNativeSyntaxDiagnosticsMarkdown(
  filePath: string,
  source: string,
): string | undefined {
  if (filePath.endsWith(".aice")) return undefined;
  let targetLang: TargetLanguage;
  try {
    const detected = detectTargetFromPathOrContent(filePath, source);
    if (detected === "passthrough" || detected === "text") return undefined;
    targetLang = detected;
  } catch {
    return undefined;
  }

  const res = validateNativeSyntax(source, targetLang, filePath);
  if (res.valid || res.items.length === 0) {
    return undefined;
  }

  const rawLines = source.split(/\r?\n/);
  const diagLines: string[] = ["## ⚠️ Native Syntax Diagnostics"];
  for (const d of res.items.slice(0, 10)) {
    const offendingLine = (rawLines[d.line - 1] ?? "").trim();
    diagLines.push(`- Line ${d.line}:${d.column} — ${d.message}`);
    if (offendingLine) {
      diagLines.push(`  \`L${d.line}: ${offendingLine}\``);
    }
  }
  return diagLines.join("\n");
}
