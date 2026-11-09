/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Lossless Source-Preserving Preprocessor (`preprocessHybridAndIdiomsLossless`).
 *
 * Transforms hybrid AICE shorthands + `$idioms` + native code directly into clean
 * native target code across all 15 languages without round-tripping the entire file
 * through `decompile() -> parse() -> emitTarget()`.
 */

import postcss from "postcss";
import type { ProjectIdiomDefinition } from "../config/index.js";
import {
  CSS_LAYOUT_MACROS,
  CSS_PROPERTY_ALIASES,
  expandCssTokenValue,
} from "../emitters/css-emitter.js";
import type { TargetLanguage } from "../emitters/index.js";

export interface LosslessPreprocessOptions {
  /** Whether the snippet is being preprocessed directly inside a class/struct body */
  insideClass?: boolean;
  /** Optional Go receiver specification (e.g. `(s *Server)`) when splicing a Go method */
  goReceiver?: string;
}

export interface LexicalScanDiagnostic {
  line: number;
  column: number;
  message: string;
}

export interface LexicalMaskResult {
  maskedCode: string;
  maskTable: string[];
  maskLengths: number[];
  unterminatedDiagnostics: LexicalScanDiagnostic[];
}

export const COMPACT_CSS_SHORTHANDS: Readonly<Record<string, string>> = {
  ...CSS_PROPERTY_ALIASES,
  d: "display",
  disp: "display",
  jc: "justify-content",
  ai: "align-items",
  ac: "align-content",
  fd: "flex-direction",
  fld: "flex-direction",
  fw: "font-weight",
  flw: "flex-wrap",
  fl: "flex",
  fg: "flex-grow",
  fsr: "flex-shrink",
  fb: "flex-basis",
  g: "gap",
  gtc: "grid-template-columns",
  gtr: "grid-template-rows",
  gc: "grid-column",
  gr: "grid-row",
  bg: "background",
  bgc: "background-color",
  c: "color",
  p: "padding",
  pt: "padding-top",
  pr: "padding-right",
  pb: "padding-bottom",
  pl: "padding-left",
  m: "margin",
  mt: "margin-top",
  mr: "margin-right",
  mb: "margin-bottom",
  ml: "margin-left",
  w: "width",
  h: "height",
  mh: "min-height",
  minh: "min-height",
  "min-h": "min-height",
  xh: "max-height",
  maxh: "max-height",
  "max-h": "max-height",
  mw: "min-width",
  minw: "min-width",
  "min-w": "min-width",
  xw: "max-width",
  maxw: "max-width",
  "max-w": "max-width",
  r: "border-radius",
  br: "border-radius",
  rad: "border-radius",
  b: "border",
  bd: "border",
  bt: "border-top",
  bdt: "border-top",
  bb: "border-bottom",
  bdb: "border-bottom",
  bl: "border-left",
  bdl: "border-left",
  bdr: "border-right",
  bc: "border-color",
  bdc: "border-color",
  bw: "border-width",
  bdw: "border-width",
  bds: "border-style",
  bs: "box-sizing",
  bsz: "box-sizing",
  fs: "font-size",
  fz: "font-size",
  ff: "font-family",
  f: "font-family",
  lh: "line-height",
  ls: "letter-spacing",
  ta: "text-align",
  tt: "text-transform",
  td: "text-decoration",
  ts: "text-shadow",
  tsh: "text-shadow",
  ws: "white-space",
  pos: "position",
  ins: "inset",
  t: "top",
  l: "left",
  bot: "bottom",
  z: "z-index",
  ov: "overflow",
  ovx: "overflow-x",
  ovy: "overflow-y",
  op: "opacity",
  vis: "visibility",
  tr: "transition",
  trans: "transition",
  sh: "box-shadow",
  bsh: "box-shadow",
  bf: "backdrop-filter",
  bdf: "backdrop-filter",
  cur: "cursor",
  pe: "pointer-events",
  us: "user-select",
  lst: "list-style",
};

const MASK_PREFIX = "\uE000";
const MASK_STR_SUFFIX = "\uE001";
const MASK_CMT_SUFFIX = "\uE002";

function encodeMaskToken(index: number, kind: "str" | "cmt"): string {
  const digits = String(index)
    .split("")
    .map((d) => String.fromCharCode(0xe010 + Number.parseInt(d, 10)))
    .join("");
  return `${MASK_PREFIX}${digits}${kind === "str" ? MASK_STR_SUFFIX : MASK_CMT_SUFFIX}`;
}

export function unmaskLexicalTokens(masked: string, maskTable: string[]): string {
  let current = masked;
  for (let pass = 0; pass < 8; pass++) {
    if (!current.includes(MASK_PREFIX)) break;
    current = current.replace(
      /\uE000([\uE010-\uE019]+)[\uE001\uE002]/g,
      (full, rawDigits: string) => {
        const idxStr = rawDigits
          .split("")
          .map((ch) => String(ch.charCodeAt(0) - 0xe010))
          .join("");
        const idx = Number.parseInt(idxStr, 10);
        return maskTable[idx] ?? full;
      },
    );
  }
  return current;
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

function isCompactHashTypeSigil(source: string, hashIdx: number): boolean {
  // Check preceding non-whitespace characters on the same line for `:`, `[`, or `->`
  let p = hashIdx - 1;
  while (p >= 0 && (source[p] === " " || source[p] === "\t")) {
    p--;
  }
  if (p < 0) return false;
  const prevChar = source[p];
  const isPrecededBySigilLeader =
    prevChar === ":" || prevChar === "[" || (prevChar === ">" && p > 0 && source[p - 1] === "-");
  if (!isPrecededBySigilLeader) return false;

  // Check following characters after `#`
  const after = source.slice(hashIdx + 1);
  return /^\s*(?:=|,|;|\)|\]|\}|->|:|\{|$)/m.test(after);
}

function canStartRegexInJsTs(
  source: string,
  slashIdx: number,
  targetLang: TargetLanguage,
): boolean {
  if (targetLang === "tsx" && slashIdx > 0 && source[slashIdx - 1] === "<") {
    return false;
  }
  let p = slashIdx - 1;
  while (p >= 0 && /\s/.test(source[p])) {
    p--;
  }
  if (p < 0) return true;
  const ch = source[p];
  if ("(,=:[!&|?{};~^%+*-<>".includes(ch)) {
    return true;
  }
  if (/[A-Za-z0-9_$]/.test(ch)) {
    let kwStart = p;
    while (kwStart > 0 && /[A-Za-z0-9_$]/.test(source[kwStart - 1])) {
      kwStart--;
    }
    const word = source.slice(kwStart, p + 1);
    return new Set([
      "return",
      "ret",
      "case",
      "throw",
      "typeof",
      "void",
      "delete",
      "in",
      "of",
      "await",
      "yield",
    ]).has(word);
  }
  return false;
}

function scanJsTsTemplateExprClose(
  source: string,
  exprStart: number,
  targetLang: TargetLanguage,
): number {
  const len = source.length;
  let j = exprStart;
  let braceDepth = 1;

  while (j < len && braceDepth > 0) {
    const ec = source[j];
    const next = source[j + 1];

    if (ec === "\\" && j + 1 < len) {
      j += 2;
      continue;
    }

    // Line comment `// ...`
    if (ec === "/" && next === "/") {
      j += 2;
      while (j < len && source[j] !== "\n" && source[j] !== "\r") j++;
      continue;
    }

    // Block comment `/* ... */`
    if (ec === "/" && next === "*") {
      const closeComment = source.indexOf("*/", j + 2);
      if (closeComment < 0) {
        return len;
      }
      j = closeComment + 2;
      continue;
    }

    // Regex literal `/pattern/flags`
    if (ec === "/" && next !== "/" && next !== "*" && next !== "=") {
      if (canStartRegexInJsTs(source, j, targetLang)) {
        let rj = j + 1;
        let inCharClass = false;
        let foundClose = false;
        while (rj < len && source[rj] !== "\n" && source[rj] !== "\r") {
          const rc = source[rj];
          if (rc === "\\" && rj + 1 < len && source[rj + 1] !== "\n") {
            rj += 2;
            continue;
          }
          if (rc === "[") {
            inCharClass = true;
          } else if (rc === "]") {
            inCharClass = false;
          } else if (rc === "/" && !inCharClass) {
            foundClose = true;
            rj++;
            while (rj < len && /[dgimsuvy]/.test(source[rj])) {
              rj++;
            }
            break;
          }
          rj++;
        }
        if (foundClose) {
          j = rj;
          continue;
        }
      }
    }

    // Single or double quoted string
    if (ec === '"' || ec === "'") {
      const q = ec;
      j++;
      while (j < len && source[j] !== q && source[j] !== "\n" && source[j] !== "\r") {
        if (source[j] === "\\") j += 2;
        else j++;
      }
      if (j < len && source[j] === q) j++;
      continue;
    }

    // Nested template literal `` `...${...}...` ``
    if (ec === "`") {
      j++;
      while (j < len) {
        if (source[j] === "\\" && j + 1 < len) {
          j += 2;
          continue;
        }
        if (source[j] === "`") {
          j++;
          break;
        }
        if (source[j] === "$" && source[j + 1] === "{") {
          j = scanJsTsTemplateExprClose(source, j + 2, targetLang);
          if (j < len && source[j] === "}") j++;
          continue;
        }
        j++;
      }
      continue;
    }

    if (ec === "{") {
      braceDepth++;
      j++;
      continue;
    }
    if (ec === "}") {
      braceDepth--;
      if (braceDepth === 0) {
        return j;
      }
      j++;
      continue;
    }
    j++;
  }

  return j;
}

/**
 * Lexically masks comments, strings, raw strings, and template literals so that
 * hybrid shorthand lowering and syntax checks only inspect real code tokens.
 */
export function maskSourceLexically(
  source: string,
  targetLang: TargetLanguage,
  activeIdioms: Record<string, ProjectIdiomDefinition> = {},
  existingMaskTable?: string[],
  existingMaskLengths?: number[],
): LexicalMaskResult {
  const maskTable = existingMaskTable ?? [];
  const maskLengths = existingMaskLengths ?? [];
  const unterminatedDiagnostics: LexicalScanDiagnostic[] = [];
  const addMask = (raw: string, kind: "str" | "cmt", origLength = raw.length): string => {
    const idx = maskTable.length;
    maskTable.push(raw);
    maskLengths.push(origLength);
    return encodeMaskToken(idx, kind);
  };

  const isJsTs = targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx";
  const supportsCStyleComments =
    targetLang !== "python" && targetLang !== "yaml" && targetLang !== "html";

  let out = "";
  let i = 0;
  const len = source.length;

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // 1. HTML comment `<!-- ... -->`
    if (
      (targetLang === "html" || targetLang === "twig" || isJsTs) &&
      ch === "<" &&
      source.slice(i, i + 4) === "<!--"
    ) {
      const closeIdx = source.indexOf("-->", i + 4);
      if (closeIdx < 0) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: "Unterminated HTML comment '<!--'",
        });
        out += addMask(source.slice(i), "cmt");
        break;
      }
      out += addMask(source.slice(i, closeIdx + 3), "cmt");
      i = closeIdx + 3;
      continue;
    }

    // 2. Twig comment `{# ... #}`
    if (targetLang === "twig" && ch === "{" && next === "#") {
      const closeIdx = source.indexOf("#}", i + 2);
      if (closeIdx < 0) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: "Unterminated Twig comment '{#'",
        });
        out += addMask(source.slice(i), "cmt");
        break;
      }
      out += addMask(source.slice(i, closeIdx + 2), "cmt");
      i = closeIdx + 2;
      continue;
    }

    // 3. C-style block comment `/* ... */`
    if (supportsCStyleComments && ch === "/" && next === "*") {
      const closeIdx = source.indexOf("*/", i + 2);
      if (closeIdx < 0) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: "Unterminated block comment '/*'",
        });
        out += addMask(source.slice(i), "cmt");
        break;
      }
      out += addMask(source.slice(i, closeIdx + 2), "cmt");
      i = closeIdx + 2;
      continue;
    }

    // 4. C-style line comment `// ...` (not in CSS where unquoted url(https://...) may appear)
    if (supportsCStyleComments && targetLang !== "css" && ch === "/" && next === "/") {
      let end = i + 2;
      while (end < len && source[end] !== "\n" && source[end] !== "\r") {
        end++;
      }
      out += addMask(source.slice(i, end), "cmt");
      i = end;
      continue;
    }

    // 5. Python / YAML / PHP `#` line comment
    if (
      ch === "#" &&
      (targetLang === "python" || targetLang === "yaml" || (targetLang === "php" && next !== "["))
    ) {
      if (!isCompactHashTypeSigil(source, i)) {
        let end = i + 1;
        while (end < len && source[end] !== "\n" && source[end] !== "\r") {
          end++;
        }
        out += addMask(source.slice(i, end), "cmt");
        i = end;
        continue;
      }
    }

    // 6. Rust raw string literal `r#*"..."#*` or `br#*"..."#*`
    if (
      targetLang === "rust" &&
      (ch === "r" || (ch === "b" && next === "r")) &&
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))
    ) {
      const rStart = ch === "b" ? i + 2 : i + 1;
      let hashes = 0;
      while (rStart + hashes < len && source[rStart + hashes] === "#") {
        hashes++;
      }
      if (source[rStart + hashes] === '"') {
        const bodyStart = rStart + hashes + 1;
        const closeSeq = `"${"#".repeat(hashes)}`;
        const closeIdx = source.indexOf(closeSeq, bodyStart);
        if (closeIdx < 0) {
          const pos = getLineAndCol(source, i);
          unterminatedDiagnostics.push({
            ...pos,
            message: "Unterminated Rust raw string literal",
          });
          out += addMask(source.slice(i), "str");
          break;
        }
        out += addMask(source.slice(i, closeIdx + closeSeq.length), "str");
        i = closeIdx + closeSeq.length;
        continue;
      }
    }

    // 7. C++ raw string literal `R"delim(...)delim"`
    if (
      targetLang === "cpp" &&
      ch === "R" &&
      next === '"' &&
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))
    ) {
      const openParen = source.indexOf("(", i + 2);
      if (openParen >= 0 && openParen - (i + 2) <= 16) {
        const delim = source.slice(i + 2, openParen);
        if (!/[\s)\\]/.test(delim)) {
          const closeSeq = `)${delim}"`;
          const closeIdx = source.indexOf(closeSeq, openParen + 1);
          if (closeIdx < 0) {
            const pos = getLineAndCol(source, i);
            unterminatedDiagnostics.push({
              ...pos,
              message: "Unterminated C++ raw string literal",
            });
            out += addMask(source.slice(i), "str");
            break;
          }
          out += addMask(source.slice(i, closeIdx + closeSeq.length), "str");
          i = closeIdx + closeSeq.length;
          continue;
        }
      }
    }

    // 8. C# verbatim string `@"..."`, `$@"..."`, `@$"..."`
    if (
      targetLang === "csharp" &&
      ((ch === "@" && next === '"') ||
        (ch === "$" && next === "@" && source[i + 2] === '"') ||
        (ch === "@" && next === "$" && source[i + 2] === '"'))
    ) {
      const prefixLen = ch === "@" && next === '"' ? 2 : 3;
      let j = i + prefixLen;
      let closed = false;
      while (j < len) {
        if (source[j] === '"') {
          if (source[j + 1] === '"') {
            j += 2;
            continue;
          }
          j++;
          closed = true;
          break;
        }
        j++;
      }
      if (!closed) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: "Unterminated C# verbatim string literal",
        });
      }
      out += addMask(source.slice(i, j), "str");
      i = j;
      continue;
    }

    // 9. Triple-quoted strings `"""..."""` or `'''...'''` (Python, Kotlin, C#)
    if (
      (ch === '"' && next === '"' && source[i + 2] === '"') ||
      (targetLang === "python" && ch === "'" && next === "'" && source[i + 2] === "'")
    ) {
      const delim = ch.repeat(3);
      const closeIdx = source.indexOf(delim, i + 3);
      if (closeIdx < 0) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: `Unterminated triple-quoted string literal ${delim}`,
        });
        out += addMask(source.slice(i), "str");
        break;
      }
      out += addMask(source.slice(i, closeIdx + 3), "str");
      i = closeIdx + 3;
      continue;
    }

    // 10. JS/TS template literal `` `...${expr}...` `` or Go raw backtick string
    if (ch === "`") {
      if (isJsTs) {
        let j = i + 1;
        let tpl = "`";
        let closed = false;
        while (j < len) {
          const c = source[j];
          if (c === "\\" && j + 1 < len) {
            tpl += source.slice(j, j + 2);
            j += 2;
            continue;
          }
          if (c === "`") {
            tpl += "`";
            j++;
            closed = true;
            break;
          }
          if (c === "$" && source[j + 1] === "{") {
            tpl += "${";
            const exprStart = j + 2;
            j = scanJsTsTemplateExprClose(source, exprStart, targetLang);
            const rawInner = source.slice(exprStart, j);
            const leadWs = rawInner.match(/^\s*/)?.[0] ?? "";
            const trailWs = rawInner.match(/\s*$/)?.[0] ?? "";
            const processedInner = rawInner.trim()
              ? `${leadWs}${preprocessHybridAndIdiomsLossless(rawInner.trim(), targetLang, activeIdioms).trim()}${trailWs}`
              : rawInner;
            tpl += `${processedInner}}`;
            if (j < len && source[j] === "}") j++;
            continue;
          }
          tpl += c;
          j++;
        }
        if (!closed) {
          const pos = getLineAndCol(source, i);
          unterminatedDiagnostics.push({
            ...pos,
            message: "Unterminated template literal '`'",
          });
        }
        out += addMask(tpl, "str", j - i);
        i = j;
        continue;
      }

      if (targetLang === "go") {
        const closeIdx = source.indexOf("`", i + 1);
        if (closeIdx < 0) {
          const pos = getLineAndCol(source, i);
          unterminatedDiagnostics.push({
            ...pos,
            message: "Unterminated Go raw string literal '`'",
          });
          out += addMask(source.slice(i), "str");
          break;
        }
        out += addMask(source.slice(i, closeIdx + 1), "str");
        i = closeIdx + 1;
        continue;
      }
    }

    // 11. JS/TS Regex literal `/pattern/flags`
    if (isJsTs && ch === "/" && next !== "/" && next !== "*" && next !== "=") {
      if (canStartRegexInJsTs(source, i, targetLang)) {
        let j = i + 1;
        let inCharClass = false;
        let foundClose = false;
        while (j < len && source[j] !== "\n" && source[j] !== "\r") {
          const rc = source[j];
          if (rc === "\\" && j + 1 < len && source[j + 1] !== "\n") {
            j += 2;
            continue;
          }
          if (rc === "[") {
            inCharClass = true;
          } else if (rc === "]") {
            inCharClass = false;
          } else if (rc === "/" && !inCharClass) {
            foundClose = true;
            j++;
            while (j < len && /[dgimsuvy]/.test(source[j])) {
              j++;
            }
            break;
          }
          j++;
        }
        if (foundClose) {
          out += addMask(source.slice(i, j), "str");
          i = j;
          continue;
        }
      }
    }

    // 12. Single-quote disambiguation for Rust lifetimes (`'a`, `'static`) & C++ digit separators (`1'000`)
    if (ch === "'") {
      if (
        targetLang === "cpp" &&
        i > 0 &&
        /[0-9a-fA-F]/.test(source[i - 1]) &&
        /[0-9a-fA-F]/.test(next ?? "")
      ) {
        out += ch;
        i++;
        continue;
      }
      if (targetLang === "rust") {
        const charLitMatch = source
          .slice(i)
          .match(/^'(?:\\(?:x[0-9a-fA-F]{2}|u\{[0-9a-fA-F_]+\}|.)|[^'\\\r\n])'/);
        if (charLitMatch) {
          out += addMask(charLitMatch[0], "str");
          i += charLitMatch[0].length;
          continue;
        }
        // Rust lifetime `'a` or `'static` or `'_`
        const lifetimeMatch = source.slice(i).match(/^'[A-Za-z_][A-Za-z0-9_]*/);
        if (lifetimeMatch) {
          out += lifetimeMatch[0];
          i += lifetimeMatch[0].length;
          continue;
        }
      }
      // In TSX/JSX, an apostrophe inside JSX text (`<div>Don't</div>`) has no matching `'` on the line
      if (targetLang === "tsx") {
        let probe = i + 1;
        let hasClosingQuoteOnLine = false;
        while (probe < len && source[probe] !== "\n" && source[probe] !== "\r") {
          if (source[probe] === "\\") {
            probe += 2;
            continue;
          }
          if (source[probe] === "'") {
            hasClosingQuoteOnLine = true;
            break;
          }
          probe++;
        }
        if (!hasClosingQuoteOnLine) {
          out += ch;
          i++;
          continue;
        }
      }
    }

    // 13. Standard double-quoted or single-quoted string literal
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const allowMultiline =
        targetLang === "php" ||
        targetLang === "html" ||
        targetLang === "twig" ||
        targetLang === "yaml" ||
        (quote === '"' && targetLang === "rust");
      let j = i + 1;
      let closed = false;
      while (j < len) {
        const sc = source[j];
        if (sc === "\\" && j + 1 < len) {
          j += 2;
          continue;
        }
        if (sc === quote) {
          j++;
          closed = true;
          break;
        }
        if (!allowMultiline && (sc === "\n" || sc === "\r")) {
          break;
        }
        j++;
      }
      if (!closed) {
        const pos = getLineAndCol(source, i);
        unterminatedDiagnostics.push({
          ...pos,
          message: `Unterminated string literal ${quote}`,
        });
      }
      out += addMask(source.slice(i, j), "str");
      i = j;
      continue;
    }

    out += ch;
    i++;
  }

  return { maskedCode: out, maskTable, maskLengths, unterminatedDiagnostics };
}

function splitBalancedMaskedArgs(rawArgs: string): string[] {
  const args: string[] = [];
  let cur = "";
  let depth = 0;
  for (let i = 0; i < rawArgs.length; i++) {
    const ch = rawArgs[i];
    if (ch === "(" || ch === "[" || ch === "{") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")" || ch === "]" || ch === "}") {
      depth = Math.max(0, depth - 1);
      cur += ch;
      continue;
    }
    if (ch === "," && depth === 0) {
      args.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim().length > 0 || args.length > 0) {
    args.push(cur.trim());
  }
  return args;
}

function lowerIdiomTemplateStatementShards(stmt: string, targetLang: TargetLanguage): string {
  if (targetLang === "go") {
    return stmt.replace(/^(\s*)ret\s+(.+)$/, "$1return $2").replace(/^(\s*)ret\s*$/, "$1return");
  }
  return stmt
    .replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2")
    .replace(/^(\s*)(?:ret|<-)\s*$/, "$1return");
}

function lowerIdiomTemplateAiceBlocksForBraceTarget(
  templateMasked: string,
  targetLang: TargetLanguage,
): string {
  if (
    targetLang === "css" ||
    targetLang === "html" ||
    targetLang === "twig" ||
    targetLang === "json" ||
    targetLang === "yaml"
  ) {
    return templateMasked;
  }

  if (targetLang === "python") {
    return templateMasked
      .split(/\r?\n/)
      .map((l) =>
        l
          .replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2")
          .replace(/^(\s*)(?:ret|<-)\s*$/, "$1return")
          .replace(/:\s*(?:ret|<-)\s+(.+)$/, ": return $1"),
      )
      .join("\n");
  }

  const noParenCond = targetLang === "rust" || targetLang === "go";
  const formatCond = (rawCond: string): string => {
    const c = rawCond
      .trim()
      .replace(/\bnot\s+/g, "!")
      .replace(/\band\b/g, "&&")
      .replace(/\bor\b/g, "||");
    return noParenCond ? c : `(${c})`;
  };

  // Convert single-line `if cond: stmt` and multi-line indented `if cond:\n  stmt`
  const lines = templateMasked.split(/\r?\n/);
  const outLines: string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const singleIf = line.match(/^(\s*)if\s+([^:{]+):\s*(.+)$/);
    if (singleIf) {
      const [, ind, cond, rawBody] = singleIf;
      const body = lowerIdiomTemplateStatementShards(rawBody.trim(), targetLang);
      const cleanBody = body.endsWith(";") || targetLang === "go" ? body : `${body};`;
      outLines.push(`${ind}if ${formatCond(cond)} { ${cleanBody} }`);
      i++;
      continue;
    }

    const multiIf = line.match(/^(\s*)if\s+([^:{]+):\s*$/);
    if (multiIf) {
      const [, ind, cond] = multiIf;
      const baseIndent = ind.length;
      i++;
      const blockLines: string[] = [];
      while (i < lines.length) {
        const nl = lines[i];
        if (nl.trim().length === 0) {
          i++;
          continue;
        }
        const nInd = nl.match(/^(\s*)/)?.[1].length ?? 0;
        if (nInd <= baseIndent) break;
        const stmt = lowerIdiomTemplateStatementShards(nl.trim(), targetLang);
        const terminated =
          stmt.endsWith(";") || stmt.endsWith("}") || targetLang === "go" ? stmt : `${stmt};`;
        blockLines.push(`${ind}  ${terminated}`);
        i++;
      }
      outLines.push(`${ind}if ${formatCond(cond)} {\n${blockLines.join("\n")}\n${ind}}`);
      continue;
    }

    outLines.push(lowerIdiomTemplateStatementShards(line, targetLang));
    i++;
  }

  return outLines.join("\n");
}

function expandMaskedIdioms(
  maskedCode: string,
  activeIdioms: Record<string, ProjectIdiomDefinition>,
  targetLang: TargetLanguage,
  maskTable: string[],
  maskLengths?: number[],
): string {
  if (!maskedCode.includes("$") || Object.keys(activeIdioms).length === 0) {
    return maskedCode;
  }

  const idiomMap = new Map<string, ProjectIdiomDefinition>();
  for (const [k, def] of Object.entries(activeIdioms)) {
    const cleanName = (def.name || k).replace(/^\$/, "");
    if (cleanName) {
      idiomMap.set(cleanName, def);
    }
  }
  if (idiomMap.size === 0) return maskedCode;

  let current = maskedCode;
  for (let pass = 0; pass < 8; pass++) {
    let changed = false;
    let out = "";
    let i = 0;
    while (i < current.length) {
      if (current[i] === "$") {
        const nameMatch = current.slice(i + 1).match(/^([A-Za-z_][A-Za-z0-9_]*)/);
        if (nameMatch) {
          const idName = nameMatch[1];
          const def = idiomMap.get(idName);
          if (def) {
            const afterNameIdx = i + 1 + idName.length;
            const parenWS = current.slice(afterNameIdx).match(/^(\s*)\(/);
            if (parenWS) {
              const openParenIdx = afterNameIdx + parenWS[1].length;
              let depth = 1;
              let j = openParenIdx + 1;
              while (j < current.length && depth > 0) {
                const ch = current[j];
                if (ch === "(") depth++;
                else if (ch === ")") depth--;
                j++;
              }
              if (depth === 0) {
                const rawArgs = current.slice(openParenIdx + 1, j - 1);
                const parsedArgs = rawArgs.trim() ? splitBalancedMaskedArgs(rawArgs) : [];

                const maskedTplRes = maskSourceLexically(
                  def.templateAice,
                  targetLang,
                  activeIdioms,
                  maskTable,
                  maskLengths,
                );
                let expanded = lowerIdiomTemplateAiceBlocksForBraceTarget(
                  maskedTplRes.maskedCode,
                  targetLang,
                );

                const subMap = new Map<string, string>();
                def.params.forEach((p, idx) => {
                  const argVal = parsedArgs[idx] ?? p.defaultValue ?? "";
                  subMap.set(p.name, argVal);
                  subMap.set(`$${idx}`, argVal);
                });
                parsedArgs.forEach((argVal, idx) => {
                  if (!subMap.has(`$${idx}`)) {
                    subMap.set(`$${idx}`, argVal);
                  }
                });

                const sortedKeys = Array.from(subMap.keys()).sort((a, b) => b.length - a.length);
                if (sortedKeys.length > 0) {
                  const pattern = sortedKeys
                    .map((k) => {
                      const esc = k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
                      return k.startsWith("$") ? `${esc}(?![0-9A-Za-z_])` : `\\b${esc}\\b`;
                    })
                    .join("|");
                  expanded = expanded.replace(new RegExp(pattern, "g"), (m) => subMap.get(m) ?? m);
                }

                // Preserve indentation for multi-line idiom expansions
                if (expanded.includes("\n")) {
                  const lineStart = out.lastIndexOf("\n") + 1;
                  const prefixOnLine = out.slice(lineStart);
                  const indentMatch = prefixOnLine.match(/^([ \t]*)$/);
                  if (indentMatch) {
                    const pad = indentMatch[1];
                    expanded = expanded
                      .split(/\r?\n/)
                      .map((l, idx) => (idx === 0 ? l : `${pad}${l}`))
                      .join("\n");
                  }
                }

                out += expanded;
                i = j;
                changed = true;
                continue;
              }
            }
          }
        }
      }
      out += current[i];
      i++;
    }
    current = out;
    if (!changed) break;
  }

  return current;
}

function lowerCompactSigilsForTarget(line: string, targetLang: TargetLanguage): string {
  // Collapse `: :#`, `: :$`, `: :?`, `: :_`, `: :*` into `:#`, `:$`, `:?`, `:_`, `:*`
  // and `-> :#`, `-> :$`, `-> :?`, `-> :_`, `-> :*` into `-> #`, `-> $`, `-> ?`, `-> _`, `-> *`
  let out = line
    .replace(/:\s*:(?=\s*(?:#|\$|\?|_|\*|\[\s*(?:#|\$|\?|_|\*)\s*\]))/g, ":")
    .replace(/->\s*:(?=\s*(?:#|\$|\?|_|\*|\[\s*(?:#|\$|\?|_|\*)\s*\]))/g, "-> ");

  if (targetLang === "javascript") {
    return out
      .replace(/(:\s*|->\s*|\[\s*|=\s*(?=\[))\[\s*(?:#|\$|\?|_|\*)\s*\]/g, "")
      .replace(/:(?!=)\s*(?:#|\$|\?|_|\*)(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\uE000|$))/g, "")
      .replace(/\)\s*->\s*[^{=;]+?(\s*(?:\{|=>))/g, ")$1");
  }

  if (targetLang === "typescript" || targetLang === "tsx") {
    return out
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*\[\s*#\s*\]\s*\]\s*\]/g, "$1number[][][]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*\[\s*\$\s*\]\s*\]\s*\]/g, "$1string[][][]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*\[\s*\?\s*\]\s*\]\s*\]/g, "$1boolean[][][]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*#\s*\]\s*\]/g, "$1number[][]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*\$\s*\]\s*\]/g, "$1string[][]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\[\s*\?\s*\]\s*\]/g, "$1boolean[][]")
      .replace(/(:\s*)(?=\[\s*(?:#|\$|\?|_|\*)\s*\])/g, ": ")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*#\s*\]/g, "$1number[]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\$\s*\]/g, "$1string[]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\?\s*\]/g, "$1boolean[]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*_\s*\]/g, "$1void[]")
      .replace(/(:\s*|->\s*|[<,(|[\s]|=\s*)\[\s*\*\s*\]/g, "$1any[]")
      .replace(
        /((?:[<,(|&]|=>|(?<![=!<>])=(?![=>])|\bas)\s*):?#(?=\s*(?:\[|\||&|>|\)|,|;|\uE000|$))/g,
        "$1number",
      )
      .replace(
        /((?:[<,(|&]|=>|(?<![=!<>])=(?![=>])|\bas)\s*):\$(?=\s*(?:\[|\||&|>|\)|,|;|\uE000|$))/g,
        "$1string",
      )
      .replace(/(\(\s*)\$(?=\s*\|)/g, "$1string")
      .replace(/(\|\s*)\$(?=\s*\))/g, "$1string")
      .replace(/(,\s*)\$(?=\s*>)/g, "$1string")
      .replace(
        /((?:[<,(|&]|=>|(?<![=!<>])=(?![=>])|\bas)\s*):?\?(?=\s*(?:\[|\||&|>|\)|,|;|\uE000|$))/g,
        "$1boolean",
      )
      .replace(
        /((?:[<,(|&]|=>|(?<![=!<>])=(?![=>])|\bas)\s*):_(?=\s*(?:\[|\||&|>|\)|,|;|\uE000|$))/g,
        "$1void",
      )
      .replace(
        /((?:[<,(|&]|=>|(?<![=!<>])=(?![=>])|\bas)\s*):\*(?=\s*(?:\[|\||&|>|\)|,|;|\uE000|$))/g,
        "$1any",
      )
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\[|\||&|>|\uE000|$))/g, ": number")
      .replace(/:(?!=)\s*\$(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\[|\||&|>|\uE000|$))/g, ": string")
      .replace(/:(?!=)\s*\?(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\[|\||&|>|\uE000|$))/g, ": boolean")
      .replace(/:(?!=)\s*_(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\[|\||&|>|\uE000|$))/g, ": void")
      .replace(/:(?!=)\s*\*(?=\s*(?:=|,|;|\)|\]|\}|->|\{|=>|\[|\||&|>|\uE000|$))/g, ": any")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, ": number")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, ": string")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, ": boolean")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, ": void")
      .replace(/\s*->\s*\*(?![A-Za-z0-9_])/g, ": any")
      .replace(/\)\s*->\s*([^{=;]+?)(\s*(?:\{|=>))/g, "): $1$2");
  }
  if (targetLang === "python") {
    return out
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*#\s*\]/g, "$1list[float]")
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*\$\s*\]/g, "$1list[str]")
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*\?\s*\]/g, "$1list[bool]")
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*\*\s*\]/g, "$1list[Any]")
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|\)|\]|\}|->|:|$))/g, ": float")
      .replace(/:(?!=)\s*\$(?=\s*(?:=|,|\)|\]|\}|->|:|$))/g, ": str")
      .replace(/:(?!=)\s*\?(?=\s*(?:=|,|\)|\]|\}|->|:|$))/g, ": bool")
      .replace(/:(?!=)\s*_(?=\s*(?:=|,|\)|\]|\}|->|:|$))/g, ": None")
      .replace(/:(?!=)\s*\*(?=\s*(?:=|,|\)|\]|\}|->|:|$))/g, ": Any")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, " -> float")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, " -> str")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, " -> bool")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, " -> None")
      .replace(/\s*->\s*\*(?![A-Za-z0-9_])/g, " -> Any");
  }

  if (targetLang === "rust") {
    return out
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*#\s*\]/g, "$1Vec<f64>")
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*\$\s*\]/g, "$1Vec<String>")
      .replace(/(:\s*|->\s*|\[\s*|=\s*)\[\s*\?\s*\]/g, "$1Vec<bool>")
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|;|\)|\]|\}|->|\{|$))/g, ": f64")
      .replace(/:(?!=)\s*\$(?=\s*(?:=|,|;|\)|\]|\}|->|\{|$))/g, ": String")
      .replace(/:(?!=)\s*\?(?=\s*(?:=|,|;|\)|\]|\}|->|\{|$))/g, ": bool")
      .replace(/:(?!=)\s*_(?=\s*(?:=|,|;|\)|\]|\}|->|\{|$))/g, ": ()")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, " -> f64")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, " -> String")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, " -> bool")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, " -> ()");
  }

  if (targetLang === "go") {
    return out
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*#\s*\](?=\s*(?:,|\)|$))/g, "$1 []float64")
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*\$\s*\](?=\s*(?:,|\)|$))/g, "$1 []string")
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*\?\s*\](?=\s*(?:,|\)|$))/g, "$1 []bool")
      .replace(/(:\s*|->\s*)\[\s*#\s*\]/g, "$1[]float64")
      .replace(/(:\s*|->\s*)\[\s*\$\s*\]/g, "$1[]string")
      .replace(/(:\s*|->\s*)\[\s*\?\s*\]/g, "$1[]bool")
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*#(?=\s*(?:,|\)|$))/g, "$1 float64")
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\$(?=\s*(?:,|\)|$))/g, "$1 string")
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\?(?=\s*(?:,|\)|$))/g, "$1 bool")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, " float64")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, " string")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, " bool")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, "")
      .replace(/\)\s*->\s*([^{]+?)(\s*\{)/g, ") $1$2");
  }

  if (targetLang === "kotlin") {
    return out
      .replace(/(:\s*|->\s*)\[\s*#\s*\]/g, "$1List<Double>")
      .replace(/(:\s*|->\s*)\[\s*\$\s*\]/g, "$1List<String>")
      .replace(/(:\s*|->\s*)\[\s*\?\s*\]/g, "$1List<Boolean>")
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": Double")
      .replace(/:(?!=)\s*\$(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": String")
      .replace(/:(?!=)\s*\?(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": Boolean")
      .replace(/:(?!=)\s*_(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": Unit")
      .replace(/:(?!=)\s*\*(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": Any")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, ": Double")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, ": String")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, ": Boolean")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, ": Unit")
      .replace(/\s*->\s*\*(?![A-Za-z0-9_])/g, ": Any")
      .replace(/\)\s*->\s*([^{=]+?)(\s*\{)/g, "): $1$2");
  }

  if (targetLang === "php") {
    return out
      .replace(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*(?:#|\$|\?|_|\*)\s*\]/g, "array $1")
      .replace(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*:\s*#(?=\s*(?:=|,|\)|$))/g, "float $1")
      .replace(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*:\s*\$(?=\s*(?:=|,|\)|$))/g, "string $1")
      .replace(/(\$[A-Za-z_][A-Za-z0-9_]*)\s*:\s*\?(?=\s*(?:=|,|\)|$))/g, "bool $1")
      .replace(/(:\s*|\s*->\s*)\[\s*(?:#|\$|\?|_|\*)\s*\]/g, ": array")
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": float")
      .replace(/:(?!=)\s*\$(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": string")
      .replace(/:(?!=)\s*\?(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": bool")
      .replace(/:(?!=)\s*_(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": void")
      .replace(/:(?!=)\s*\*(?=\s*(?:=|,|\)|\]|\}|->|\{|$))/g, ": mixed")
      .replace(/\s*->\s*#(?![A-Za-z0-9_])/g, ": float")
      .replace(/\s*->\s*\$(?![A-Za-z0-9_])/g, ": string")
      .replace(/\s*->\s*\?(?![A-Za-z0-9_])/g, ": bool")
      .replace(/\s*->\s*_(?![A-Za-z0-9_])/g, ": void")
      .replace(/\)\s*->\s*([^{]+?)(\s*\{)/g, "): $1$2");
  }

  if (targetLang === "cpp" || targetLang === "csharp") {
    const numType = "double";
    const strType = targetLang === "cpp" ? "std::string" : "string";
    const boolType = "bool";
    const numArr = targetLang === "cpp" ? "std::vector<double>" : "double[]";
    const strArr = targetLang === "cpp" ? "std::vector<std::string>" : "string[]";
    const boolArr = targetLang === "cpp" ? "std::vector<bool>" : "bool[]";
    out = out
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*#\s*\](?=\s*(?:,|\)|=|$))/g, `${numArr} $1`)
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*\$\s*\](?=\s*(?:,|\)|=|$))/g, `${strArr} $1`)
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\[\s*\?\s*\](?=\s*(?:,|\)|=|$))/g, `${boolArr} $1`)
      .replace(/->\s*\[\s*#\s*\]/g, `-> ${numArr}`)
      .replace(/->\s*\[\s*\$\s*\]/g, `-> ${strArr}`)
      .replace(/->\s*\[\s*\?\s*\]/g, `-> ${boolArr}`)
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*#(?=\s*(?:,|\)|=|$))/g, `${numType} $1`)
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\$(?=\s*(?:,|\)|=|$))/g, `${strType} $1`)
      .replace(/([A-Za-z_][A-Za-z0-9_]*)\s*:\s*\?(?=\s*(?:,|\)|=|$))/g, `${boolType} $1`)
      .replace(/->\s*#(?![A-Za-z0-9_])/g, `-> ${numType}`)
      .replace(/->\s*\$(?![A-Za-z0-9_])/g, `-> ${strType}`)
      .replace(/->\s*\?(?![A-Za-z0-9_])/g, `-> ${boolType}`)
      .replace(/->\s*_(?![A-Za-z0-9_])/g, "-> void");
  }

  return out;
}

function lowerHybridLineForTarget(
  line: string,
  targetLang: TargetLanguage,
  atClassMemberLevel: boolean,
  options?: LosslessPreprocessOptions,
): string {
  let out = line;

  if (targetLang === "python") {
    out = out.replace(
      /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|async\s+\^fn\s+|async\s+fn\s+\^|pub\s+async\s+fn\s+|@fn\s+async\s+|async\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1async def $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1def $2",
    );
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+|@cls\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1class $2",
    );
    out = out.replace(
      /^(\s*)(?:@type\s+\^|\^type\s+|pub\s+type\s+|@type\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1type $2",
    );
    out = out.replace(/^(\s*)(?:pub\s+)?(?:\^?(?:const|val|mut|let)\s+(?:mut\s+)?)/, "$1");
    out = out.replace(
      /^(\s*)::?=\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)=\s*(.+)$/,
      "$1$2: $3 = $4",
    );
    out = out.replace(/^(\s*)::?=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 = $3");
    out = out.replace(
      /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=:]+?)\s*::?=\s*(.+)$/,
      "$1$2: $3 = $4",
    );
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::?=\s*(.+)$/, "$1$2 = $3");
    out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s*$/, "$1return");
    out = out.replace(/:\s*(?:ret|<-)\s+(.+)$/, ": return $1");
    out = out.replace(/:\s*(?:ret|<-)\s*$/, ": return");
    return lowerCompactSigilsForTarget(out, targetLang);
  }

  if (targetLang === "rust") {
    out = out.replace(
      /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|async\s+\^fn\s+|async\s+fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1pub async fn $2",
    );
    out = out.replace(/^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/, "$1pub fn $2");
    out = out.replace(/^(\s*)@fn\s+(async\s+)?([A-Za-z_][A-Za-z0-9_]*)/, "$1$2fn $3");
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1pub struct $2",
    );
    out = out.replace(/^(\s*)(?:@cls|class)\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1struct $2");
    out = out.replace(
      /^(\s*)(?:@type\s+\^|\^type\s+|type\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1pub type $2",
    );
    out = out.replace(/^(\s*)@type\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1type $2");
    out = out.replace(
      /^(\s*)(?:\^(?:const|val)\s+|(?:const|val)\s+\^|pub\s+val\s+)/,
      "$1pub const ",
    );
    out = out.replace(/^(\s*)(?:pub\s+let\s+mut\s+|pub\s+mut\s+|\^mut\s+)/, "$1let mut ");
    out = out.replace(/^(\s*)(?:pub\s+let\s+|\^let\s+)/, "$1let ");
    out = out.replace(
      /^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)=\s*(.+)$/,
      "$1let $2: $3 = $4",
    );
    out = out.replace(
      /^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)=\s*(.+)$/,
      "$1let mut $2: $3 = $4",
    );
    out = out.replace(/^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1let $2 = $3");
    out = out.replace(/^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1let mut $2 = $3");
    out = out.replace(
      /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=:]+?)\s*:=\s*(.+)$/,
      "$1let $2: $3 = $4",
    );
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+)$/, "$1let $2 = $3");
    out = out.replace(
      /^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=:]+?)\s*::=\s*(.+)$/,
      "$1let mut $2: $3 = $4",
    );
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::=\s*(.+)$/, "$1let mut $2 = $3");
    out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s*;?\s*$/, "$1return;");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)(?=\s*(?:;|,|\}|$))/g, "$1return");
    out = out.replace(/^(\s*\}\s*)elif\b/, "$1else if");
    out = out.replace(/^(\s*)elif\b/, "$1else if");
    return lowerCompactSigilsForTarget(out, targetLang);
  }

  if (targetLang === "go") {
    const goRecv = options?.goReceiver ? `${options.goReceiver} ` : "";
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      `$1func ${goRecv}$2`,
    );
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+|@cls\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\{/,
      "$1type $2 struct {",
    );
    out = out.replace(
      /^(\s*)(?:@type\s+\^|\^type\s+|pub\s+type\s+|@type\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1type $2",
    );
    out = out.replace(/^(\s*)(?:pub\s+const\s+|\^const\s+|pub\s+val\s+)/, "$1const ");
    out = out.replace(/^(\s*)(?:pub\s+let\s+|pub\s+mut\s+|\^let\s+|\^mut\s+)/, "$1var ");
    out = out.replace(/^(\s*)::?=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 := $3");
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::=\s*(.+)$/, "$1$2 := $3");
    out = out.replace(/^(\s*)(?:val|mut|let)\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 := $3");
    // In Go, `<-ch` and `msg := <-ch` are native channel receives! Only lower `ret`.
    out = out.replace(/^(\s*)ret\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)ret\s*$/, "$1return");
    out = out.replace(/(\{\s*|\belse\s+)ret\s+([^;}\n]+)/g, "$1return $2");
    out = out.replace(/(\{\s*|\belse\s+)ret(?=\s*(?:\}|$))/g, "$1return");
    out = out.replace(/^(\s*\}\s*)elif\b/, "$1else if");
    out = out.replace(/^(\s*)elif\b/, "$1else if");
    return lowerCompactSigilsForTarget(out, targetLang);
  }

  if (targetLang === "kotlin") {
    out = out.replace(
      /^(\s*)(?:@fn\s+suspend\s+\^|\^suspend\s+fn\s+|pub\s+suspend\s+fn\s+|@fn\s+suspend\s+|suspend\s+fn\s+|pub\s+async\s+fn\s+|async\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1suspend fun $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1fun $2",
    );
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+|@cls\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1class $2",
    );
    out = out.replace(
      /^(\s*)(?:@type\s+\^|\^type\s+|pub\s+type\s+|@type\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1typealias $2",
    );
    out = out.replace(
      /^(\s*)(?:pub\s+const\s+|\^const\s+|pub\s+val\s+|pub\s+let\s+|\^let\s+)/,
      "$1val ",
    );
    out = out.replace(/^(\s*)(?:pub\s+mut\s+|\^mut\s+)/, "$1var ");
    out = out.replace(/^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1val $2 = $3");
    out = out.replace(/^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1var $2 = $3");
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+)$/, "$1val $2 = $3");
    out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::=\s*(.+)$/, "$1var $2 = $3");
    out = out.replace(/^(\s*)mut\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1var $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s*$/, "$1return");
    out = out.replace(/(=>\s*|->\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
    out = out.replace(
      /(=>\s*|->\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)(?=\s*(?:;|\}|$))/g,
      "$1return",
    );
    return lowerCompactSigilsForTarget(out, targetLang);
  }

  if (targetLang === "php") {
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+async\s+fn\s+|pub\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1public function $2",
    );
    out = out.replace(
      /^(\s*)(?:pub\s+static\s+fn\s+|\^static\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1public static function $2",
    );
    // Preserve PHP 7.4+ `fn($x) =>` arrow functions by requiring identifier after `fn`
    out = out.replace(/^(\s*)(?:@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(/, "$1function $2(");
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+|@cls\s+)([A-Za-z_][A-Za-z0-9_]*)/,
      "$1class $2",
    );
    out = out.replace(/^(\s*)(?:pub\s+const\s+|\^const\s+)/, "$1public const ");
    out = out.replace(/^(\s*)(?:pub\s+let\s+|pub\s+mut\s+|\^let\s+|\^mut\s+)/, "$1public ");
    out = out.replace(/^(\s*)::?=\s+(\$[A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 = $3");
    out = out.replace(/^(\s*)(\$[A-Za-z_][A-Za-z0-9_]*)\s*::?=\s*(.+)$/, "$1$2 = $3");
    out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s*;?\s*$/, "$1return;");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)(?=\s*(?:;|\}|$))/g, "$1return");
    return lowerCompactSigilsForTarget(out, targetLang);
  }

  if (targetLang === "cpp" || targetLang === "csharp") {
    out = lowerCompactSigilsForTarget(out, targetLang);
    if (targetLang === "csharp") {
      out = out.replace(
        /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|pub\s+async\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/,
        "$1public async $4 $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|pub\s+async\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/,
        "$1public async Task $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+static\s+\^|\^static\s+fn\s+|pub\s+static\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/,
        "$1public static $4 $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+static\s+\^|\^static\s+fn\s+|pub\s+static\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/,
        "$1public static void $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/,
        "$1public $4 $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/,
        "$1public void $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/,
        "$1$4 $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_]*)\s*\(([^)]*)\)\s*\{/,
        "$1void $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+)([A-Za-z_][A-Za-z0-9_]*)/,
        "$1public class $2",
      );
      out = out.replace(/^(\s*)@cls\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1class $2");
      out = out.replace(/^(\s*)(?:pub\s+const\s+|\^const\s+|pub\s+val\s+)/, "$1public const ");
      out = out.replace(/^(\s*)(?:pub\s+let\s+|pub\s+mut\s+|\^let\s+|\^mut\s+)/, "$1public var ");
      out = out.replace(/^(\s*)::?=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1var $2 = $3");
      out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::?=\s*(.+)$/, "$1var $2 = $3");
    } else {
      out = out.replace(
        /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_:]*)\s*\(([^)]*)\)\s*->\s*([^{]+?)\s*\{/,
        "$1$4 $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|@fn\s+|fn\s+)([A-Za-z_][A-Za-z0-9_:]*)\s*\(([^)]*)\)\s*\{/,
        "$1void $2($3) {",
      );
      out = out.replace(
        /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+|@cls\s+)([A-Za-z_][A-Za-z0-9_]*)/,
        "$1class $2",
      );
      out = out.replace(
        /^(\s*)(?:@type\s+\^|\^type\s+|pub\s+type\s+|@type\s+)([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/,
        "$1using $2 = $3",
      );
      out = out.replace(/^(\s*)(?:pub\s+const\s+|\^const\s+|pub\s+val\s+)/, "$1constexpr auto ");
      out = out.replace(/^(\s*)(?:pub\s+let\s+|\^let\s+)/, "$1const auto ");
      out = out.replace(/^(\s*)(?:pub\s+mut\s+|\^mut\s+)/, "$1auto ");
      out = out.replace(/^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1const auto $2 = $3");
      out = out.replace(/^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1auto $2 = $3");
      out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*:=\s*(.+)$/, "$1const auto $2 = $3");
      out = out.replace(/^(\s*)([A-Za-z_][A-Za-z0-9_]*)\s*::=\s*(.+)$/, "$1auto $2 = $3");
    }
    out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
    out = out.replace(/^(\s*)(?:ret|<-)\s*;?\s*$/, "$1return;");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
    out = out.replace(/(=>\s*|\)\s+|\belse\s+|\{\s*)(?:ret|<-)(?=\s*(?:;|\}|$))/g, "$1return");
    return out;
  }

  // Default: TypeScript / JavaScript / TSX
  const isJs = targetLang === "javascript";

  if (atClassMemberLevel) {
    out = out.replace(
      /^(\s*)(?:@fn\s+static\s+async\s+\^|\^static\s+async\s+fn\s+|pub\s+static\s+async\s+(?:fn\s+|function\s+)?)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1static async $2" : "$1public static async $2",
    );
    out = out.replace(
      /^(\s*)priv\s+static\s+async\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1static async $2" : "$1private static async $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+static\s+\^|\^static\s+fn\s+|static\s+\^fn\s+|static\s+fn\s+\^|pub\s+static\s+fn\s+|@fn\s+static\s+|static\s+fn\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      "$1static $2",
    );
    out = out.replace(
      /^(\s*)priv\s+static\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1static $2" : "$1private static $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|async\s+\^fn\s+|async\s+fn\s+\^|pub\s+async\s+(?:fn\s+|function\s+)?)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1async $2" : "$1public async $2",
    );
    out = out.replace(
      /^(\s*)priv\s+async\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1async $2" : "$1private async $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+async\s+|async\s+fn\s+|async\s+function\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      "$1async $2",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^|pub\s+fn\s+|pub\s+function\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1$2" : "$1public $2",
    );
    out = out.replace(
      /^(\s*)priv\s+(?:fn\s+|function\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1$2" : "$1private $2",
    );
    out = out.replace(/^(\s*)(?:@fn\s+|fn\s+|function\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/, "$1$2");
    out = out.replace(
      /^(\s*)pub\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1public readonly ",
    );
    out = out.replace(
      /^(\s*)priv\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1private readonly ",
    );
    out = out.replace(
      /^(\s*)prot\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1protected readonly ",
    );
    out = out.replace(/^(\s*)pub\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1public ");
    out = out.replace(/^(\s*)priv\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1private ");
    out = out.replace(/^(\s*)prot\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1protected ");
    out = out.replace(/^(\s*)(?:val|ro)\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1readonly ");
    out = out.replace(/^(\s*)mut\s+(?=[A-Za-z_$#])/, "$1");
  } else {
    out = out.replace(
      /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn|\s*async\s+\^fn|\s*async\s+fn\s+\^|pub\s+async\s+(?:fn|function))(\*?\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1export async function$2$3",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+\^|\^fn|fn\s+\^|pub\s+(?:fn|function))(\*?\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1export function$2$3",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+async|async\s+fn)(\*?\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1async function$2$3",
    );
    out = out.replace(
      /^(\s*)(?:@fn\s+static\s+\^|\^static\s+fn\s+|static\s+\^fn\s+|static\s+fn\s+\^|pub\s+static\s+fn\s+|@fn\s+static\s+|static\s+fn\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1static $2",
    );
    out = out.replace(
      /^(\s*)priv\s+static\s+async\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1static async $2" : "$1private static async $2",
    );
    out = out.replace(
      /^(\s*)priv\s+static\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1static $2" : "$1private static $2",
    );
    out = out.replace(
      /^(\s*)priv\s+async\s+(?:fn\s+|function\s+)?([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1async $2" : "$1private async $2",
    );
    out = out.replace(
      /^(\s*)priv\s+(?:fn\s+|function\s+)([A-Za-z_$#][A-Za-z0-9_$]*)/,
      isJs ? "$1$2" : "$1private $2",
    );
    out = out.replace(/^(\s*)(?:@fn|fn)(\*?\s+)([A-Za-z_$][A-Za-z0-9_$]*)/, "$1function$2$3");
    out = out.replace(
      /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^|pub\s+class\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1export class $2",
    );
    out = out.replace(/^(\s*)@cls\s+([A-Za-z_$][A-Za-z0-9_$]*)/, "$1class $2");
    out = out.replace(
      /^(\s*)(?:@type\s+\^|\^type\s+|type\s+\^|pub\s+type\s+)([A-Za-z_$][A-Za-z0-9_$]*)/,
      "$1export type $2",
    );
    out = out.replace(/^(\s*)@type\s+([A-Za-z_$][A-Za-z0-9_$]*)/, "$1type $2");
    out = out.replace(/^(\s*)pub\s+interface\s+/, "$1export interface ");
    out = out.replace(/^(\s*)pub\s+enum\s+/, "$1export enum ");
    out = out.replace(
      /^(\s*)(?:\^(?:const|val)\s+|(?:const|val)\s+\^|pub\s+(?:const|val)\s+)/,
      "$1export const ",
    );
    out = out.replace(
      /^(\s*)(?:\^(?:let|mut)\s+|(?:let|mut)\s+\^|pub\s+let\s+mut\s+|pub\s+(?:let|mut|var)\s+)/,
      "$1export let ",
    );
    out = out.replace(
      /^(\s*)pub\s+(?:ro|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1public readonly ",
    );
    out = out.replace(
      /^(\s*)priv\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1private readonly ",
    );
    out = out.replace(
      /^(\s*)prot\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/,
      isJs ? "$1" : "$1protected readonly ",
    );
    out = out.replace(/^(\s*)priv\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1private ");
    out = out.replace(/^(\s*)prot\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1protected ");
    out = out.replace(/^(\s*)ro\s+(?=[A-Za-z_$#])/, isJs ? "$1" : "$1readonly ");
    out = out.replace(
      /^(\s*)pub\s+(?=[A-Za-z_$#][A-Za-z0-9_$]*\s*(?:\??\s*:|=|\(|<))/,
      isJs ? "$1" : "$1public ",
    );
    out = out.replace(/^(\s*)let\s+mut\s+/, "$1let ");
    out = out.replace(/^(\s*)val\s+(?=[A-Za-z_$[{])/, "$1const ");
    out = out.replace(/^(\s*)mut\s+(?=[A-Za-z_$[{])/, "$1let ");
  }

  // Multi-statement single-line declarations (after `;` or `{`)
  if (!atClassMemberLevel) {
    out = out
      .replace(/(;\s*)pub\s+(?:const|val)\s+/g, "$1export const ")
      .replace(/(;\s*)pub\s+(?:let|mut|var)\s+/g, "$1export let ")
      .replace(/(;\s*)pub\s+type\s+/g, "$1export type ")
      .replace(/(;\s*)pub\s+interface\s+/g, "$1export interface ")
      .replace(/(;\s*)pub\s+enum\s+/g, "$1export enum ")
      .replace(/(;\s*)pub\s+class\s+/g, "$1export class ")
      .replace(/(;\s*)pub\s+async\s+(?:fn|function)\s+/g, "$1export async function ")
      .replace(/(;\s*)pub\s+(?:fn|function)\s+/g, "$1export function ");
  }
  out = out
    .replace(
      /([;{]\s*)pub\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/g,
      isJs ? "$1" : "$1public readonly ",
    )
    .replace(
      /([;{]\s*)priv\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/g,
      isJs ? "$1" : "$1private readonly ",
    )
    .replace(
      /([;{]\s*)prot\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$#])/g,
      isJs ? "$1" : "$1protected readonly ",
    )
    .replace(/([;{]\s*)pub\s+(?:fn\s+|function\s+)(?=[A-Za-z_$#])/g, isJs ? "$1" : "$1public ")
    .replace(/([;{]\s*)priv\s+(?:fn\s+|function\s+)(?=[A-Za-z_$#])/g, isJs ? "$1" : "$1private ")
    .replace(
      /([;{]\s*)pub\s+(?=[A-Za-z_$#][A-Za-z0-9_$]*\s*(?:\??\s*:|=|\(|<))/g,
      isJs ? "$1" : "$1public ",
    )
    .replace(
      /([;{]\s*)priv\s+(?=[A-Za-z_$#][A-Za-z0-9_$]*\s*(?:\??\s*:|=|\(|<))/g,
      isJs ? "$1" : "$1private ",
    )
    .replace(
      /([;{]\s*)prot\s+(?=[A-Za-z_$#][A-Za-z0-9_$]*\s*(?:\??\s*:|=|\(|<))/g,
      isJs ? "$1" : "$1protected ",
    )
    .replace(
      /([;{]\s*)(?:ro|val)\s+(?=[A-Za-z_$#][A-Za-z0-9_$]*\s*(?:\??\s*:|=))/g,
      isJs ? "$1" : "$1readonly ",
    );

  // Constructor parameter property modifiers (e.g. constructor(priv ro x: :#, pub y: :$))
  if (!isJs) {
    out = out
      .replace(/([,(]\s*)pub\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$])/g, "$1public readonly ")
      .replace(/([,(]\s*)priv\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$])/g, "$1private readonly ")
      .replace(/([,(]\s*)prot\s+(?:ro|val|readonly)\s+(?=[A-Za-z_$])/g, "$1protected readonly ")
      .replace(/([,(]\s*)pub\s+(?=[A-Za-z_$][A-Za-z0-9_$]*\s*\??\s*:)/g, "$1public ")
      .replace(/([,(]\s*)priv\s+(?=[A-Za-z_$][A-Za-z0-9_$]*\s*\??\s*:)/g, "$1private ")
      .replace(/([,(]\s*)prot\s+(?=[A-Za-z_$][A-Za-z0-9_$]*\s*\??\s*:)/g, "$1protected ")
      .replace(/([,(]\s*)ro\s+(?=[A-Za-z_$][A-Za-z0-9_$]*\s*\??\s*:)/g, "$1readonly ");
  }

  // Variable bindings := and ::= (including inside `for (...)` and after `;` / `{`)
  out = out
    .replace(/(\bfor\s*\(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*::=\s*/g, "$1let $2 = ")
    .replace(/(\bfor\s*\(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:=\s*/g, "$1const $2 = ");
  out = out.replace(
    /^(\s*):=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+)=\s*(.+)$/,
    isJs ? "$1const $2 = $4" : "$1const $2: $3 = $4",
  );
  out = out.replace(
    /^(\s*)::=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=]+)=\s*(.+)$/,
    isJs ? "$1let $2 = $4" : "$1let $2: $3 = $4",
  );
  out = out.replace(/^(\s*):=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/, "$1const $2 = $3");
  out = out.replace(/^(\s*)::=\s+([A-Za-z_$][A-Za-z0-9_$]*)\s*=\s*(.+)$/, "$1let $2 = $3");
  out = out.replace(
    /^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=:]+?)\s*:=\s*(.+)$/,
    isJs ? "$1const $2 = $4" : "$1const $2: $3 = $4",
  );
  out = out.replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:=\s*(.+)$/, "$1const $2 = $3");
  out = out.replace(
    /^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([^=:]+?)\s*::=\s*(.+)$/,
    isJs ? "$1let $2 = $4" : "$1let $2: $3 = $4",
  );
  out = out.replace(/^(\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*::=\s*(.+)$/, "$1let $2 = $3");
  out = out
    .replace(/([;{]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*:=\s*/g, "$1const $2 = ")
    .replace(/([;{]\s*)([A-Za-z_$][A-Za-z0-9_$]*)\s*::=\s*/g, "$1let $2 = ");

  // Return & control-flow shorthands
  out = out.replace(/^(\s*)(?:ret|<-)\s+(.+)$/, "$1return $2");
  out = out.replace(/^(\s*)(?:ret|<-)\s*;?\s*$/, "$1return;");
  out = out.replace(/(=>\s*|\)\s+)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
  out = out.replace(/(=>\s*|\)\s+)(?:ret|<-)(?=\s*(?:;|\}|$))/g, "$1return");
  out = out.replace(/(\belse\s+)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
  out = out.replace(/(\belse\s+)(?:ret|<-)(?=\s*(?:;|\}|$))/g, "$1return");
  out = out.replace(/(\{\s*|;\s*)(?:ret|<-)\s+([^;}\n]+)/g, "$1return $2");
  out = out.replace(/(\{\s*|;\s*)(?:ret|<-)(?=\s*(?:;|\}|$))/g, "$1return");
  out = out.replace(/^(\s*\}\s*)elif\b/, "$1else if");
  out = out.replace(/^(\s*)elif\b/, "$1else if");

  // Inline anonymous fn expressions
  out = out.replace(/\basync\s+fn\s*\(([^)]*)\)\s*=>/g, "async ($1) =>");
  out = out.replace(/\bfn\s*\(([^)]*)\)\s*=>/g, "($1) =>");
  out = out.replace(/\basync\s+fn\s*\(/g, "async function(");
  out = out.replace(/\bfn\s*\(/g, "function(");
  out = lowerCompactSigilsForTarget(out, targetLang);
  out = lowerCompactSigilsForTarget(out, targetLang);
  if (!atClassMemberLevel) {
    out = out.replace(
      /^(\s*)(?!(?:case|default|return|throw|const|let|var|public|private|protected|readonly|static|type|interface)\b)([A-Za-z_$][A-Za-z0-9_$]*)\s*:\s*([A-Za-z_$][A-Za-z0-9_$<>[\],\s|&]*?)\s*=\s*(?!=)([^;]+;\s*(?:\uE000\d+\uE001\s*)*)$/,
      isJs ? "$1let $2 = $4" : "$1let $2: $3 = $4",
    );
  }
  return out;
}
export function preprocessBareCssLossless(
  rawCss: string,
  activeIdioms: Record<string, ProjectIdiomDefinition> = {},
): string {
  const maskRes = maskSourceLexically(rawCss, "css", activeIdioms);
  const expandedMasked = expandMaskedIdioms(
    maskRes.maskedCode,
    activeIdioms,
    "css",
    maskRes.maskTable,
    maskRes.maskLengths,
  );
  const idiomExpanded = unmaskLexicalTokens(expandedMasked, maskRes.maskTable);

  const expandCssCompactValue = (prop: string, val: string): string => {
    const v = val.trim().toLowerCase();
    if (prop === "flex-direction") {
      if (v === "col") return "column";
      if (v === "col-rev") return "column-reverse";
      if (v === "row-rev") return "row-reverse";
    } else if (prop === "justify-content" || prop === "align-items" || prop === "align-content") {
      if (v === "c") return "center";
      if (v === "sb") return "space-between";
      if (v === "sa") return "space-around";
      if (v === "se") return "space-evenly";
      if (v === "fs") return "flex-start";
      if (v === "fe") return "flex-end";
    } else if (prop === "position") {
      if (v === "rel") return "relative";
      if (v === "abs") return "absolute";
      if (v === "fix") return "fixed";
    } else if (prop === "text-transform") {
      if (v === "up") return "uppercase";
      if (v === "low") return "lowercase";
      if (v === "cap") return "capitalize";
    } else if (prop === "text-align") {
      if (v === "c") return "center";
      if (v === "l") return "left";
      if (v === "r") return "right";
    } else if (prop === "box-sizing") {
      if (v === "bb") return "border-box";
      if (v === "cb") return "content-box";
    } else if (prop === "cursor") {
      if (v === "ptr") return "pointer";
    } else if (prop === "overflow" || prop === "overflow-x" || prop === "overflow-y") {
      if (v === "hid") return "hidden";
    }
    return val;
  };

  try {
    const root = postcss.parse(idiomExpanded);
    root.walkDecls((decl) => {
      const propKey = decl.prop.trim().toLowerCase();
      const macro = CSS_LAYOUT_MACROS[propKey];
      if (macro) {
        for (const [mProp, mVal] of macro) {
          decl.cloneBefore({ prop: mProp, value: mVal });
        }
        decl.remove();
        return;
      }
      const valTrim = decl.value.trim();
      if (propKey === "fw") {
        decl.prop = /^(?:wrap|nowrap|wrap-reverse)$/i.test(valTrim) ? "flex-wrap" : "font-weight";
      } else if (propKey === "bs") {
        decl.prop = /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(valTrim)
          ? "border-style"
          : "box-sizing";
      } else if (propKey === "fs") {
        decl.prop = /^(?:italic|oblique)$/i.test(valTrim) ? "font-style" : "font-size";
      } else if (COMPACT_CSS_SHORTHANDS[propKey]) {
        decl.prop = COMPACT_CSS_SHORTHANDS[propKey];
      }
      decl.value = expandCssTokenValue(expandCssCompactValue(decl.prop, decl.value));
    });
    const out = root.toString().trim();
    return `${out}\n`;
  } catch {
    const out = idiomExpanded.replace(
      /(^|[{;]\s*)([a-zA-Z_-]+)(\s*:\s*)([^;}]+)/gm,
      (_full, prefix: string, prop: string, sep: string, val: string) => {
        const lower = prop.toLowerCase();
        const valTrim = val.trim();
        let mapped = COMPACT_CSS_SHORTHANDS[lower] ?? prop;
        if (lower === "fw") {
          mapped = /^(?:wrap|nowrap|wrap-reverse)$/i.test(valTrim) ? "flex-wrap" : "font-weight";
        } else if (lower === "bs") {
          mapped = /^(?:solid|dashed|dotted|double|groove|ridge|inset|outset)$/i.test(valTrim)
            ? "border-style"
            : "box-sizing";
        } else if (lower === "fs") {
          mapped = /^(?:italic|oblique)$/i.test(valTrim) ? "font-style" : "font-size";
        }
        return `${prefix}${mapped}${sep}${expandCssTokenValue(expandCssCompactValue(mapped, val))}`;
      },
    );
    return out.endsWith("\n") ? out : `${out}\n`;
  }
}

/**
 * Losslessly transforms hybrid AICE shorthands + `$idioms` + native code into
 * target native code without AST round-tripping.
 */
export function preprocessHybridAndIdiomsLossless(
  rawCode: string,
  targetLang: TargetLanguage,
  activeIdioms: Record<string, ProjectIdiomDefinition> = {},
  options?: LosslessPreprocessOptions,
): string {
  if (!rawCode.trim()) {
    return "";
  }

  if (targetLang === "css") {
    return preprocessBareCssLossless(rawCode, activeIdioms);
  }

  const maskRes = maskSourceLexically(rawCode, targetLang, activeIdioms);
  const idiomExpanded = expandMaskedIdioms(
    maskRes.maskedCode,
    activeIdioms,
    targetLang,
    maskRes.maskTable,
    maskRes.maskLengths,
  );

  if (
    targetLang === "html" ||
    targetLang === "twig" ||
    targetLang === "json" ||
    targetLang === "yaml"
  ) {
    return unmaskLexicalTokens(idiomExpanded, maskRes.maskTable);
  }

  const lines = idiomExpanded.split(/\r?\n/);
  const loweredLines: string[] = [];
  let braceDepth = options?.insideClass ? 1 : 0;
  const classBraceDepths: number[] = options?.insideClass ? [1] : [];

  for (const line of lines) {
    const atClassMemberLevel =
      classBraceDepths.length > 0 && braceDepth === classBraceDepths[classBraceDepths.length - 1];

    const lowered = lowerHybridLineForTarget(line, targetLang, atClassMemberLevel, options);
    loweredLines.push(lowered);

    const opensClass = /(?:^|\b)class\s+[A-Za-z_$]/.test(lowered) && lowered.includes("{");

    for (let i = 0; i < lowered.length; i++) {
      if (lowered[i] === "{") {
        braceDepth++;
        if (opensClass && !classBraceDepths.includes(braceDepth)) {
          classBraceDepths.push(braceDepth);
        }
      } else if (lowered[i] === "}") {
        braceDepth = Math.max(0, braceDepth - 1);
        while (
          classBraceDepths.length > 0 &&
          braceDepth < classBraceDepths[classBraceDepths.length - 1]
        ) {
          classBraceDepths.pop();
        }
      }
    }
  }

  return unmaskLexicalTokens(loweredLines.join("\n"), maskRes.maskTable);
}

/**
 * Determines whether `cleanedCode` uses hybrid brace blocks `{ ... }`, native
 * language constructs, or `$idioms` in native code that should be routed directly
 * through `preprocessHybridAndIdiomsLossless()` rather than indentation-based AICE AST emission.
 */
export function isHybridOrNativeSource(cleanedCode: string, targetLang: TargetLanguage): boolean {
  const trimmed = cleanedCode.trim();
  if (!trimmed) return false;

  if (targetLang === "css") {
    return (
      trimmed.includes("{") &&
      !/^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*(?:style|tokens)\s+/m.test(trimmed)
    );
  }

  if (targetLang === "html" || targetLang === "twig") {
    return (
      (trimmed.startsWith("<") || trimmed.startsWith("{%") || trimmed.startsWith("{{")) &&
      !/^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(trimmed)
    );
  }

  if (targetLang === "json" || targetLang === "yaml") {
    return false;
  }

  const maskRes = maskSourceLexically(cleanedCode, targetLang);
  const masked = maskRes.maskedCode;

  // If the code has pure indentation-based AICE declaration headers ending with `:` at line end
  const hasPureAiceColonDecl =
    /^\s*(?:pub\s+|@fn\s+|\^fn\s+|@cls\s+|\^class\s+|@type\s+|\^type\s+)?(?:async\s+|static\s+)?(?:fn|class|type|enum|component|style)\s+\^?[A-Za-z_][^\n{=]*:\s*$/m.test(
      masked,
    );

  if (targetLang === "python") {
    if (
      /^\s*(?:pub\s+)?(?:@type\s+|\^type\s+|type\s+\^?|enum\s+)[A-Za-z_][A-Za-z0-9_]*\s*:/m.test(
        masked,
      ) ||
      /^\s*(?:pub\s+|@fn\s+|\^fn\s+)?(?:async\s+|static\s+)?fn\s+\^?[A-Za-z_][^\n:]*=\s*[^=]/m.test(
        masked,
      )
    ) {
      return false;
    }
    return (
      /^\s*(?:async\s+)?def\s+[A-Za-z_]/m.test(masked) ||
      /^\s*@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]/m.test(masked) ||
      /^\s*match\s+[^:\n]+:\s*$/m.test(masked) ||
      /^\s*(?:from\s+\S+\s+import\s+|import\s+[A-Za-z_])/m.test(masked) ||
      cleanedCode.includes('"""') ||
      cleanedCode.includes("'''") ||
      (cleanedCode.includes("class ") &&
        (/^\s*(?:async\s+)?def\s+/m.test(masked) ||
          /\$[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(masked) ||
          /(?:^|\s)(?:ret|<-)\b/m.test(masked)))
    );
  }

  if (hasPureAiceColonDecl) {
    return false;
  }

  // Expression-bodied AICE function `fn foo(a: int) -> int = a + b` without `{`
  if (
    /^\s*(?:pub\s+|@fn\s+|\^fn\s+)?(?:async\s+|static\s+)?fn\s+\^?[A-Za-z_][^\n{]*=/m.test(
      masked,
    ) &&
    !masked.includes("{")
  ) {
    return false;
  }

  // Any brace-delimited declaration or control flow block
  if (
    /(?:^|\s)(?:pub\s+|export\s+|async\s+|static\s+|suspend\s+|public\s+|private\s+|protected\s+|@fn\s+|\^fn\s+|@cls\s+|\^class\s+)*(?:fn|function|func|fun|class|struct|interface|enum|impl|trait|namespace|mod|if|for|while|switch|match|try)\b[^{;\n]*\{/m.test(
      masked,
    ) ||
    /\)\s*(?:->\s*[^{;\n]+|:\s*[^{;\n]+)?\s*\{/m.test(masked) ||
    /=>\s*\{/m.test(masked)
  ) {
    return true;
  }

  // Native language constructs or hybrid shorthands without indentation-based AICE headers
  if (
    /^\s*(?:import\s+|export\s+|package\s+|using\s+|namespace\s+|#include\b|from\s+|<\?php\b|#\[)/m.test(
      cleanedCode,
    ) ||
    /^\s*(?:pub\s+(?:const|let|val|mut|var|type|interface|enum|ro)\b|priv\s+|ro\s+|public\s+|private\s+|protected\s+|readonly\s+|const\s+|let\s+|var\s+|interface\s+|type\s+[A-Za-z_$][^\n]*=)/m.test(
      masked,
    ) ||
    /^\s*pub\s+(?!(?:fn|function|func|fun|class|struct|component|style|async|static)\b)[A-Za-z_$][A-Za-z0-9_$]*\s*(?:\??\s*:|=)/m.test(
      masked,
    )
  ) {
    return true;
  }

  return false;
}
