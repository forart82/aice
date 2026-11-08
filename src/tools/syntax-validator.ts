/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Multi-Language Pre-Write Syntax Validation Gate (`validateNativeSyntax`).
 *
 * Validates emitted or preprocessed native code across all 15 supported languages
 * before `createFile()` or `splice()` writes to disk, and powers `aice outline` /
 * `aice context` native syntax diagnostics.
 */

import * as path from "node:path";
import postcss from "postcss";
import YAML from "yaml";
import ts from "../compat/typescript.js";
import { type ProjectIdiomDefinition, stripJsonComments } from "../config/index.js";
import { detectTargetFromPath, type TargetLanguage } from "../emitters/index.js";
import { maskSourceLexically } from "./preprocessor.js";

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

function checkBalancedDelimiters(maskedCode: string, originalCode: string): SyntaxDiagnosticItem[] {
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
        const pos = getLineAndCol(originalCode, i);
        diags.push({
          ...pos,
          message: `Unexpected closing delimiter '${ch}'`,
        });
      } else {
        const top = stack.pop()!;
        if (top.expected !== ch) {
          const pos = getLineAndCol(originalCode, i);
          diags.push({
            ...pos,
            message: `Mismatched delimiter '${ch}': expected '${top.expected}' to close '${top.char}'`,
          });
        }
      }
    }
  }

  for (const unclosed of stack) {
    const pos = getLineAndCol(originalCode, unclosed.offset);
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
        const pos = getLineAndCol(originalCode, m.index ?? 0);
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
    const pos = getLineAndCol(originalCode, m.index ?? 0);
    diags.push({
      ...pos,
      message: `Leaked AICE directive '${m[0].trim()}' in native ${targetLang} output`,
    });
  }

  // 3. Check leaked compact type sigils (`:#`, `:$`, `:?`) outside strings/comments in code languages
  const isCodeLang =
    targetLang !== "css" &&
    targetLang !== "html" &&
    targetLang !== "twig" &&
    targetLang !== "json" &&
    targetLang !== "yaml";

  if (isCodeLang) {
    const sigilRe = /:(?!=)\s*(?:#|\$|\?)(?=\s*(?:=|,|;|\)|\]|\}|->|\{|$))/gm;
    for (const m of maskedCode.matchAll(sigilRe)) {
      const pos = getLineAndCol(originalCode, m.index ?? 0);
      diags.push({
        ...pos,
        message: `Leaked AICE compact type sigil '${m[0].trim()}' in native ${targetLang} output`,
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
    const pubFnRe = /^\s*pub\s+(?:async\s+|static\s+)?(?:fn|class|type)\s+[A-Za-z_]/gm;
    for (const m of maskedCode.matchAll(pubFnRe)) {
      const pos = getLineAndCol(originalCode, m.index ?? 0);
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

/**
 * Validates native syntax across all 15 supported target languages.
 */
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
    items.push(...checkLeakedAiceMarkers(maskRes.maskedCode, code, targetLang, activeIdioms));
    return finish();
  }

  // 3. CSS
  if (targetLang === "css") {
    const maskRes = maskSourceLexically(code, "css", activeIdioms);
    items.push(...maskRes.unterminatedDiagnostics);
    items.push(...checkBalancedDelimiters(maskRes.maskedCode, code));
    items.push(...checkLeakedAiceMarkers(maskRes.maskedCode, code, "css", activeIdioms));
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
    items.push(...maskRes.unterminatedDiagnostics);
    items.push(...checkLeakedAiceMarkers(maskRes.maskedCode, code, targetLang, activeIdioms));

    for (const tag of ["script", "style"]) {
      const openCount = (code.match(new RegExp(`<${tag}\\b(?![^>]*\\/>)[^>]*>`, "gi")) ?? [])
        .length;
      const closeCount = (code.match(new RegExp(`<\\/${tag}\\s*>`, "gi")) ?? []).length;
      if (openCount !== closeCount) {
        items.push({
          line: 1,
          column: 1,
          message: `Unbalanced <${tag}> tags (${openCount} open vs ${closeCount} close)`,
        });
      }
    }

    if (targetLang === "twig" || code.includes("{%") || code.includes("{{")) {
      const openStmt = (code.match(/\{%/g) ?? []).length;
      const closeStmt = (code.match(/%\}/g) ?? []).length;
      if (openStmt !== closeStmt) {
        items.push({
          line: 1,
          column: 1,
          message: `Unbalanced Twig '{% ... %}' delimiters (${openStmt} '{%' vs ${closeStmt} '%}')`,
        });
      }
      const openExpr = (code.match(/\{\{/g) ?? []).length;
      const closeExpr = (code.match(/\}\}/g) ?? []).length;
      if (openExpr !== closeExpr) {
        items.push({
          line: 1,
          column: 1,
          message: `Unbalanced Twig '{{ ... }}' delimiters (${openExpr} '{{' vs ${closeExpr} '}}')`,
        });
      }
    }

    return finish();
  }

  // 5. Python, Rust, Go, C++, C#, Kotlin, PHP
  const maskRes = maskSourceLexically(code, targetLang, activeIdioms);
  items.push(...maskRes.unterminatedDiagnostics);
  items.push(...checkBalancedDelimiters(maskRes.maskedCode, code));
  items.push(...checkLeakedAiceMarkers(maskRes.maskedCode, code, targetLang, activeIdioms));

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
