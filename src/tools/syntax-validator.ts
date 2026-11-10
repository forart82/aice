/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Multi-Language Pre-Write Syntax Validation Gate (`validateNativeSyntax`).
 */
import { spawnSync } from "node:child_process";
import * as path from "node:path";
import postcss from "postcss";
import YAML from "yaml";
import ts from "../compat/typescript.js";
import { type ProjectIdiomDefinition, stripJsonComments } from "../config/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
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
        const top = stack.pop()!;
        if (top.expected !== ch) {
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
    targetLang !== "twig" &&
    targetLang !== "json" &&
    targetLang !== "yaml";

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

  // 4. Target-specific leaked AICE keywords
  if (
    targetLang === "python" ||
    targetLang === "go" ||
    targetLang === "cpp" ||
    targetLang === "csharp" ||
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
export function validateNativeSyntax(
  code: string,
  targetLang: TargetLanguage,
  filePath: string,
  activeIdioms?: Record<string, ProjectIdiomDefinition>,
): SyntaxValidationResult {
  if (filePath.endsWith(".aice")) {
    return { valid: true, diagnostics: [], items: [] };
  }

  const items: SyntaxDiagnosticItem[] = [];
  const finish = (): SyntaxValidationResult => ({
    valid: items.length === 0,
    diagnostics: items.map((d) => `Line ${d.line}:${d.column} - ${d.message}`),
    items,
  });

  // 1. JSON & YAML
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

    const sf = ts.createSourceFile(filePath, code, ts.ScriptTarget.Latest, true, scriptKind);
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
    if (targetLang === "shell" && !filePath.toLowerCase().endsWith(".zsh")) {
      try {
        const res = spawnSync("bash", ["-n"], {
          input: code,
          encoding: "utf-8",
          timeout: 2500,
        });
        if (res.status !== null && res.status !== 0 && !res.error) {
          const stderr = (res.stderr ?? "").trim();
          const lineMatch = stderr.match(/line\s+(\d+):\s*(.+)/i);
          items.push({
            line: lineMatch ? Number.parseInt(lineMatch[1], 10) : 1,
            column: 1,
            message: lineMatch ? lineMatch[2].trim() : stderr || "Shell syntax error",
          });
        }
      } catch {
        // bash binary unavailable; skip external syntax check
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

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//")) continue;

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
              message: "AIPL indentation error: unindent does not match any outer indentation level",
            });
          }
        }
      }

      for (let c = 0; c < line.length; c++) {
        const ch = line[c];
        if (ch === "(" || ch === "[" || ch === "{") openDelims++;
        else if (ch === ")" || ch === "]" || ch === "}") openDelims = Math.max(0, openDelims - 1);
      }

      if (/^(?:pub\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\(/.test(trimmed)) {
        if (!trimmed.endsWith(":")) {
          items.push({
            line: i + 1,
            column: line.length,
            message: `AIPL function signature must end with ':' before indented body`,
          });
        }
      }

      if (/^(?:pub\s+)?struct\s+[A-Za-z_][A-Za-z0-9_]*/.test(trimmed)) {
        if (!trimmed.endsWith(":")) {
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
    targetLang = detectTargetFromPath(filePath);
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
