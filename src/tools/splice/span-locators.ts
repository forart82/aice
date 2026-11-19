/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Python, AIPL, and brace-language declaration span locators, parameter arity inference, and native span dispatch.
 */

import type { TargetLanguage } from "../../emitters/index.js";
import { extractInlineIdiomsFromSource } from "../create.js";
import {
  enrichSpanWithOffsetsAndLines,
  locateImportBlockSpan,
  locateScriptOrMarkdownSpan,
  locateTsDeclarationSpan,
  normIdForSpan,
} from "./ts-and-script-spans.js";
import type { NativeSpanInfo } from "./types.js";

function scanPythonLineState(
  line: string,
  state: { openDelims: number; inTripleQuote: '"""' | "'''" | null },
): void {
  let i = 0;
  const len = line.length;
  while (i < len) {
    if (state.inTripleQuote) {
      const closeIdx = line.indexOf(state.inTripleQuote, i);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        state.inTripleQuote = null;
        continue;
      }
      return;
    }
    const ch = line[i];
    if (ch === "#") return;
    if (
      (ch === '"' && line[i + 1] === '"' && line[i + 2] === '"') ||
      (ch === "'" && line[i + 1] === "'" && line[i + 2] === "'")
    ) {
      const delim = line.slice(i, i + 3) as '"""' | "'''";
      const closeIdx = line.indexOf(delim, i + 3);
      if (closeIdx >= 0) {
        i = closeIdx + 3;
        continue;
      }
      state.inTripleQuote = delim;
      return;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      i++;
      while (i < len && line[i] !== quote) {
        if (line[i] === "\\") i += 2;
        else i++;
      }
      if (i < len) i++;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") {
      state.openDelims++;
    } else if (ch === ")" || ch === "]" || ch === "}") {
      state.openDelims = Math.max(0, state.openDelims - 1);
    }
    i++;
  }
}

function locatePythonDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;
  const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let searchStartLine = 0;
  let searchEndLine = lines.length;
  let activeClassName = className;

  if (className) {
    const escClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const classRegex = new RegExp(`^([ \\t]*)class\\s+${escClass}\\b`);
    let foundClassLine = -1;
    let classIndentLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(classRegex);
      if (m) {
        foundClassLine = i;
        classIndentLen = m[1].length;
        break;
      }
    }
    if (foundClassLine < 0) return undefined;
    searchStartLine = foundClassLine + 1;
    const clsState: { openDelims: number; inTripleQuote: '"""' | "'''" | null } = {
      openDelims: 0,
      inTripleQuote: null,
    };
    scanPythonLineState(lines[foundClassLine], clsState);
    for (let i = searchStartLine; i < lines.length; i++) {
      const wasInside = clsState.openDelims > 0 || clsState.inTripleQuote !== null;
      scanPythonLineState(lines[i], clsState);
      if (wasInside) continue;
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= classIndentLen) {
        searchEndLine = i;
        break;
      }
    }
  }

  const pyMemberPattern =
    memberName === "constructor" || memberName === "__init__"
      ? "(?:constructor|__init__)"
      : escMember;
  const defRegex = new RegExp(`^([ \\t]*)(async\\s+)?def\\s+${pyMemberPattern}\\s*\\(`);
  let targetLine = -1;
  let targetIndent = "";
  let isAsync = false;
  let isClassContainer = false;
  let isVarAssign = false;

  if (className) {
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(defRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isAsync = Boolean(m[2]);
        break;
      }
    }
  } else {
    const indentedDefMatches: Array<{
      line: number;
      indent: string;
      isAsync: boolean;
      cls?: string;
    }> = [];
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(defRegex);
      if (m) {
        if (m[1].length === 0) {
          targetLine = i;
          targetIndent = "";
          isAsync = Boolean(m[2]);
          activeClassName = undefined;
          break;
        }
        let enclosingCls: string | undefined;
        let nestedInsideDef = false;
        for (let k = i - 1; k >= 0; k--) {
          const prevDef = lines[k].match(/^([ \t]*)(?:async\s+)?def\s+[A-Za-z0-9_]+\s*\(/);
          if (prevDef && prevDef[1].length < m[1].length) {
            nestedInsideDef = true;
            break;
          }
          const cm = lines[k].match(/^([ \t]*)class\s+([A-Za-z0-9_]+)\b/);
          if (cm && cm[1].length < m[1].length) {
            enclosingCls = cm[2];
            break;
          }
        }
        if (!nestedInsideDef && enclosingCls) {
          indentedDefMatches.push({
            line: i,
            indent: m[1],
            isAsync: Boolean(m[2]),
            cls: enclosingCls,
          });
        }
      }
    }
    if (targetLine < 0 && indentedDefMatches.length > 0) {
      const distinctPyClasses = new Set(
        indentedDefMatches.map((m) => m.cls).filter((c): c is string => Boolean(c)),
      );
      if (distinctPyClasses.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple classes (${Array.from(distinctPyClasses).join(", ")}). Qualify as '<Class>.${memberName}'.`,
        );
      }
      targetLine = indentedDefMatches[0].line;
      targetIndent = indentedDefMatches[0].indent;
      isAsync = indentedDefMatches[0].isAsync;
      activeClassName = indentedDefMatches[0].cls;
    }
  }

  if (targetLine < 0 && !className) {
    const topClassRegex = new RegExp(`^([ \\t]*)class\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(topClassRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isClassContainer = true;
        break;
      }
    }
  }

  if (targetLine < 0) {
    const varRegex = new RegExp(`^([ \\t]*)${escMember}\\s*(?::[^\\n=]+(?:=[^\\n]*)?|=(?!=)|$)`);
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(varRegex);
      if (m && (className || m[1].length === 0)) {
        targetLine = i;
        targetIndent = m[1];
        isVarAssign = true;
        break;
      }
    }
  }

  if (targetLine < 0) return undefined;

  let firstDecoratorLine = targetLine;
  let isStatic = false;
  for (let k = targetLine - 1; k >= searchStartLine; k--) {
    const trimmed = lines[k].trim();
    if (trimmed.startsWith("@")) {
      firstDecoratorLine = k;
      if (/^@staticmethod\b/.test(trimmed)) {
        isStatic = true;
      }
    } else if (trimmed === "") {
    } else {
      break;
    }
  }

  let endLine = targetLine;
  const baseIndentLen = targetIndent.length;
  const scanState: { openDelims: number; inTripleQuote: '"""' | "'''" | null } = {
    openDelims: 0,
    inTripleQuote: null,
  };
  scanPythonLineState(lines[targetLine], scanState);

  if (isVarAssign) {
    for (let i = targetLine + 1; i < searchEndLine; i++) {
      if (scanState.openDelims === 0 && scanState.inTripleQuote === null) {
        break;
      }
      scanPythonLineState(lines[i], scanState);
      endLine = i;
    }
  } else {
    for (let i = targetLine + 1; i < searchEndLine; i++) {
      const wasInsideContinuation = scanState.openDelims > 0 || scanState.inTripleQuote !== null;
      scanPythonLineState(lines[i], scanState);
      if (wasInsideContinuation || scanState.inTripleQuote !== null) {
        endLine = i;
        continue;
      }
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= baseIndentLen) {
        break;
      }
      if (!trimmed.startsWith("#")) {
        endLine = i;
      }
    }
  }

  const declStart = lineOffsets[targetLine];
  const fullDeclStart = lineOffsets[firstDecoratorLine];
  const tokenStart = declStart + targetIndent.length;
  const endLineStr = lines[endLine];
  const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
  const declEnd = lineOffsets[endLine] + cleanEndLen;

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent: targetIndent,
    className: activeClassName,
    memberName,
    isAsync,
    isStatic,
    isClassContainer,
  };
}

function locateAiplDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  explicitClassName?: string,
): NativeSpanInfo | undefined {
  const stripAiplComment = (raw: string): string => {
    let inQuote: string | null = null;
    for (let k = 0; k < raw.length; k++) {
      const ch = raw[k];
      if (inQuote) {
        if (ch === "\\" && k + 1 < raw.length) {
          k++;
          continue;
        }
        if (ch === inQuote) inQuote = null;
        continue;
      }
      if (ch === '"' || ch === "'") {
        inQuote = ch;
        continue;
      }
      if (ch === "/" && raw[k + 1] === "/") {
        return raw.slice(0, k);
      }
    }
    return raw;
  };

  const parts = symbolSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : symbolSelector;
  const escMember = memberName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  let searchStartLine = 0;
  let searchEndLine = lines.length;
  let activeClassName = className;

  if (className) {
    const escClass = className.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const structRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+${escClass}\\b`);
    let foundClassLine = -1;
    let classIndentLen = 0;
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(structRegex);
      if (m) {
        foundClassLine = i;
        classIndentLen = m[1].length;
        break;
      }
    }
    if (foundClassLine < 0) return undefined;

    const cleanClassHeader = stripAiplComment(lines[foundClassLine]);
    const singleTupleFieldRe = new RegExp(`[(,]\\s*(?:pub\\s+)?(${escMember}\\s*:\\s*[^,)]+)`);
    if (singleTupleFieldRe.test(cleanClassHeader)) {
      const fldIndent = lines[foundClassLine].match(/^[ \t]*/)?.[0] ?? "";
      const fldStart = lineOffsets[foundClassLine];
      const endLineStr = lines[foundClassLine];
      const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
      const fldEnd = fldStart + cleanEndLen;
      return {
        declStart: fldStart,
        fullDeclStart: fldStart,
        declEnd: fldEnd,
        tokenStart: fldStart + fldIndent.length,
        declIndent: fldIndent,
        className: activeClassName,
        memberName,
        isAsync: false,
        isStatic: false,
        isClassContainer: false,
      };
    }
    searchStartLine = foundClassLine + 1;
    for (let i = searchStartLine; i < lines.length; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed || trimmed.startsWith("//")) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= classIndentLen) {
        searchEndLine = i;
        break;
      }
    }
  }

  const fnRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?fn\\s+${escMember}\\b`);
  let targetLine = -1;
  let targetIndent = "";
  let isClassContainer = false;
  let isField = false;

  for (let i = searchStartLine; i < searchEndLine; i++) {
    const m = lines[i].match(fnRegex);
    if (m) {
      if (!className && m[1].length > 0) {
        for (let k = i - 1; k >= 0; k--) {
          const cm = lines[k].match(/^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+([A-Za-z0-9_]+)\b/);
          if (cm && cm[1].length < m[1].length) {
            activeClassName = cm[2];
            break;
          }
        }
      }
      targetLine = i;
      targetIndent = m[1];
      break;
    }
  }

  if (targetLine < 0 && !className) {
    const topStructRegex = new RegExp(`^([ \\t]*)(?:pub\\s+)?(?:struct|enum)\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(topStructRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        isClassContainer = true;
        break;
      }
    }
  }

  if (targetLine < 0 && !className) {
    const typeOrConstRegex = new RegExp(
      `^([ \\t]*)(?:pub\\s+)?(?:type|const|let)\\s+${escMember}\\b`,
    );
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(typeOrConstRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        if (/^(?:[ \t]*)(?:pub\s+)?(?:const|let)\b/.test(lines[i])) {
          isField = true;
        }
        break;
      }
    }
  }

  if (targetLine < 0 && !className) {
    const modRegex = new RegExp(`^([ \\t]*)module\\s+${escMember}\\b`);
    for (let i = 0; i < lines.length; i++) {
      const m = lines[i].match(modRegex);
      if (m) {
        targetLine = i;
        targetIndent = m[1];
        break;
      }
    }
  }

  if (targetLine < 0) {
    const fieldRegex = new RegExp(
      `^([ \\t]*)(?:pub\\s+|val\\s+|var\\s+|let\\s+)?${escMember}\\s*:[^\\n]*`,
    );
    const inlineFieldRegex = new RegExp(
      `(?:^|[,(\\s{])(?:pub\\s+|val\\s+|var\\s+|let\\s+)?${escMember}\\s*:[^\\n]*`,
    );
    for (let i = searchStartLine; i < searchEndLine; i++) {
      const m = lines[i].match(fieldRegex);
      if (m && (className || m[1].length === 0)) {
        targetLine = i;
        targetIndent = m[1];
        isField = true;
        break;
      }
      if (className && inlineFieldRegex.test(stripAiplComment(lines[i]))) {
        targetLine = i;
        targetIndent = lines[i].match(/^[ \t]*/)?.[0] ?? "";
        isField = true;
        break;
      }
    }
  }

  if (targetLine < 0) return undefined;

  let endLine = targetLine;
  const baseIndentLen = targetIndent.length;

  if (isField) {
    endLine = targetLine;
  } else {
    let headerEndLine = targetLine;
    let openParens = 0;
    while (headerEndLine < searchEndLine) {
      const hLine = stripAiplComment(lines[headerEndLine]);
      let inQuote: string | null = null;
      for (let c = 0; c < hLine.length; c++) {
        const ch = hLine[c];
        if (inQuote) {
          if (ch === "\\" && c + 1 < hLine.length) {
            c++;
            continue;
          }
          if (ch === inQuote) inQuote = null;
          continue;
        }
        if (ch === '"' || ch === "'") {
          inQuote = ch;
          continue;
        }
        if (ch === "(") openParens++;
        else if (ch === ")") openParens = Math.max(0, openParens - 1);
      }
      endLine = headerEndLine;
      if (openParens === 0) break;
      headerEndLine++;
    }
    for (let i = headerEndLine + 1; i < searchEndLine; i++) {
      const trimmed = lines[i].trim();
      if (!trimmed) continue;
      const ind = lines[i].match(/^[ \t]*/)?.[0].length ?? 0;
      if (ind <= baseIndentLen) {
        break;
      }
      if (!trimmed.startsWith("//")) {
        endLine = i;
      }
    }
  }
  const declStart = lineOffsets[targetLine];
  const fullDeclStart = declStart;
  const tokenStart = declStart + targetIndent.length;
  const endLineStr = lines[endLine];
  const cleanEndLen = endLineStr.endsWith("\r") ? endLineStr.length - 1 : endLineStr.length;
  const declEnd = lineOffsets[endLine] + cleanEndLen;

  return {
    declStart,
    fullDeclStart,
    declEnd,
    tokenStart,
    declIndent: targetIndent,
    className: activeClassName,
    memberName,
    isAsync: false,
    isStatic: false,
    isClassContainer,
  };
}

export function findMatchingBraceEnd(
  source: string,
  openBracePos: number,
  targetLang?: TargetLanguage,
): number {
  let depth = 0;
  let i = openBracePos;
  const len = source.length;
  const ppStack: Array<{ startDepth: number; maxEndDepth: number }> = [];

  while (i < len) {
    const ch = source[i];
    const next = source[i + 1];

    // Preprocessor #if / #ifdef / #ifndef / #elif / #else / #endif at line start (C/C++/C#)
    if (
      (targetLang === "cpp" || targetLang === "csharp" || !targetLang) &&
      (i === 0 || source[i - 1] === "\n")
    ) {
      const ppMatch = /^[ \t]*#[ \t]*(ifdef|ifndef|if|elif|else|endif)\b/.exec(source.slice(i));
      if (ppMatch) {
        const dir = ppMatch[1];
        if (dir === "if" || dir === "ifdef" || dir === "ifndef") {
          ppStack.push({ startDepth: depth, maxEndDepth: depth });
        } else if ((dir === "elif" || dir === "else") && ppStack.length > 0) {
          const top = ppStack[ppStack.length - 1];
          top.maxEndDepth = Math.max(top.maxEndDepth, depth);
          depth = top.startDepth;
        } else if (dir === "endif" && ppStack.length > 0) {
          const top = ppStack.pop()!;
          depth = Math.max(top.maxEndDepth, depth);
        }
        while (i < len && source[i] !== "\n") i++;
        continue;
      }
    }

    // Line comment `//` or PHP `#` comment (not `#[` attribute)
    if ((ch === "/" && next === "/") || (targetLang === "php" && ch === "#" && next !== "[")) {
      i += 2;
      while (i < len && source[i] !== "\n") i++;
      continue;
    }
    // Block comment `/* ... */`
    if (ch === "/" && next === "*") {
      i += 2;
      while (i < len && !(source[i] === "*" && source[i + 1] === "/")) i++;
      i += 2;
      continue;
    }
    // Rust raw string literal `r#*"..."#*` or `br#*"..."#*`
    if (
      (ch === "r" || (ch === "b" && next === "r")) &&
      (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))
    ) {
      const rStart = ch === "b" ? i + 2 : i + 1;
      let hashes = 0;
      while (rStart + hashes < len && source[rStart + hashes] === "#") hashes++;
      if (source[rStart + hashes] === '"') {
        i = rStart + hashes + 1;
        const closeSeq = `"${"#".repeat(hashes)}`;
        const closeIdx = source.indexOf(closeSeq, i);
        i = closeIdx >= 0 ? closeIdx + closeSeq.length : len;
        continue;
      }
    }
    // C++ raw string literal `R"delim(...)delim"`
    if (ch === "R" && next === '"' && (i === 0 || !/[A-Za-z0-9_]/.test(source[i - 1]))) {
      const openParen = source.indexOf("(", i + 2);
      if (openParen >= 0 && openParen - (i + 2) <= 16) {
        const delim = source.slice(i + 2, openParen);
        if (!/[\s)\\]/.test(delim)) {
          const closeSeq = `)${delim}"`;
          const closeIdx = source.indexOf(closeSeq, openParen + 1);
          i = closeIdx >= 0 ? closeIdx + closeSeq.length : len;
          continue;
        }
      }
    }
    // C# verbatim string `@"..."`
    if (ch === "@" && next === '"') {
      i += 2;
      while (i < len) {
        if (source[i] === '"') {
          if (source[i + 1] === '"') {
            i += 2;
            continue;
          }
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    // Triple-quoted string `"""..."""` (Kotlin, C#, Python)
    if (ch === '"' && next === '"' && source[i + 2] === '"') {
      const closeIdx = source.indexOf('"""', i + 3);
      i = closeIdx >= 0 ? closeIdx + 3 : len;
      continue;
    }
    // Single-quote `'` disambiguation: C++ digit separator (`1'000`) & Rust lifetime/label (`'a`, `'static`)
    if (ch === "'") {
      if (i > 0 && /[0-9a-fA-F]/.test(source[i - 1]) && /[0-9a-fA-F]/.test(next ?? "")) {
        i++;
        continue;
      }
      if (targetLang !== "php" && /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(source.slice(i))) {
        i++;
        while (i < len && /[A-Za-z0-9_]/.test(source[i])) i++;
        continue;
      }
    }
    // Standard string or char literal
    if (ch === '"' || ch === "'" || ch === "`") {
      const quote = ch;
      i++;
      while (i < len && source[i] !== quote) {
        if (source[i] === "\\" && quote !== "`") {
          i += 2;
        } else if (quote === "'" && targetLang !== "php" && source[i] === "\n") {
          break;
        } else {
          i++;
        }
      }
      if (i < len && source[i] === quote) i++;
      continue;
    }

    if (ch === "{") {
      depth++;
    } else if (ch === "}") {
      depth--;
      if (depth === 0) {
        return i + 1;
      }
    }
    i++;
  }
  return len;
}

function countHeaderParams(headerSlice: string): number | undefined {
  const openParen = headerSlice.indexOf("(");
  if (openParen < 0) return undefined;
  let depth = 0;
  let closeParen = -1;
  for (let i = openParen; i < headerSlice.length; i++) {
    const ch = headerSlice[i];
    if (ch === "(") depth++;
    else if (ch === ")") {
      depth--;
      if (depth === 0) {
        closeParen = i;
        break;
      }
    }
  }
  if (closeParen < 0) return undefined;
  const inner = headerSlice.slice(openParen + 1, closeParen).trim();
  if (!inner || inner === "void") return 0;

  const params: string[] = [];
  let cur = "";
  let angleDepth = 0;
  let nestDepth = 0;
  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (ch === "<") angleDepth++;
    else if (ch === ">" && inner[i - 1] !== "-") angleDepth = Math.max(0, angleDepth - 1);
    else if (ch === "(" || ch === "[" || ch === "{") nestDepth++;
    else if (ch === ")" || ch === "]" || ch === "}") nestDepth = Math.max(0, nestDepth - 1);
    else if (ch === "," && angleDepth === 0 && nestDepth === 0) {
      params.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) params.push(cur.trim());
  const nonReceiver = params.filter((p) => !/^(?:&\s*(?:mut\s+)?)?self$|^cls$/.test(p));
  return nonReceiver.length;
}

export function inferSnippetParamArity(rawSnippet: string): number | undefined {
  const { cleanedCode } = extractInlineIdiomsFromSource(rawSnippet);
  const lines = cleanedCode
    .trim()
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(
      (l) =>
        l &&
        !l.startsWith("//") &&
        !l.startsWith("#") &&
        !l.startsWith("@") &&
        !l.startsWith("template"),
    );
  if (lines.length === 0) return undefined;
  const headerText = lines.slice(0, 4).join(" ");
  return countHeaderParams(headerText);
}

function locateBraceLanguageDeclarationSpan(
  nativeSource: string,
  symbolSelector: string,
  targetLang: TargetLanguage,
  explicitClassName?: string,
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  const qualMatch = symbolSelector.trim().match(/^([^(]+)\((.*)\)$/);
  const baseSelector = qualMatch ? qualMatch[1].trim() : symbolSelector.trim();
  const explicitArity = qualMatch
    ? qualMatch[2].trim() === ""
      ? 0
      : qualMatch[2].split(",").length
    : preferredArity;

  const parts = baseSelector.split(/\.|::/);
  const className = explicitClassName ?? (parts.length >= 2 ? parts[0] : undefined);
  const memberName = parts.length >= 2 ? parts.slice(1).join(".") : baseSelector;
  const normMember = normIdForSpan(memberName);
  const normClass = className ? normIdForSpan(className) : undefined;

  const lines = nativeSource.split("\n");
  const lineOffsets: number[] = [];
  let offset = 0;
  for (const line of lines) {
    lineOffsets.push(offset);
    offset += line.length + 1;
  }

  const lineBraceDepths = new Array<number>(lines.length).fill(0);
  const openBraceDepthByOffset = new Map<number, number>();
  {
    let curLine = 0;
    let depth = 0;
    let p = 0;
    const nLen = nativeSource.length;
    while (p < nLen) {
      const c = nativeSource[p];
      const nx = nativeSource[p + 1];
      if (c === "\n") {
        curLine++;
        if (curLine < lineBraceDepths.length) {
          lineBraceDepths[curLine] = depth;
        }
        p++;
        continue;
      }
      if (c === "/" && nx === "/") {
        p += 2;
        while (p < nLen && nativeSource[p] !== "\n") p++;
        continue;
      }
      if (c === "/" && nx === "*") {
        p += 2;
        while (p < nLen && !(nativeSource[p] === "*" && nativeSource[p + 1] === "/")) {
          if (nativeSource[p] === "\n") {
            curLine++;
            if (curLine < lineBraceDepths.length) {
              lineBraceDepths[curLine] = depth;
            }
          }
          p++;
        }
        if (p < nLen) p += 2;
        continue;
      }
      if (c === "#" && (targetLang === "php" || targetLang === "python")) {
        p++;
        while (p < nLen && nativeSource[p] !== "\n") p++;
        continue;
      }
      if (c === '"' || c === "'" || c === "`") {
        if (
          c === "'" &&
          targetLang === "rust" &&
          /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(nativeSource.slice(p))
        ) {
          p += 2;
          continue;
        }
        const quote = c;
        p++;
        while (p < nLen && nativeSource[p] !== quote) {
          if (nativeSource[p] === "\\") {
            if (nativeSource[p + 1] === "\n") {
              curLine++;
              if (curLine < lineBraceDepths.length) {
                lineBraceDepths[curLine] = depth;
              }
            }
            p += 2;
          } else {
            if (nativeSource[p] === "\n") {
              curLine++;
              if (curLine < lineBraceDepths.length) {
                lineBraceDepths[curLine] = depth;
              }
            }
            p++;
          }
        }
        if (p < nLen) p++;
        continue;
      }
      if (c === "{") {
        openBraceDepthByOffset.set(p, depth);
        depth++;
      } else if (c === "}") {
        depth = Math.max(0, depth - 1);
      }
      p++;
    }
  }

  const buildBraceSpanFromLine = (
    lineIdx: number,
    indent: string,
    actualMemberName: string,
    enclosingClass?: string,
    extra?: Partial<NativeSpanInfo>,
  ): NativeSpanInfo | undefined => {
    let firstAttrLine = lineIdx;
    for (let k = lineIdx - 1; k >= 0; k--) {
      const t = lines[k].trim();
      if (
        t.startsWith("#[") ||
        (t.startsWith("[") && t.endsWith("]")) ||
        t.startsWith("@") ||
        (targetLang === "cpp" && /^template\s*</.test(t))
      ) {
        firstAttrLine = k;
      } else {
        break;
      }
    }
    const declStart = lineOffsets[lineIdx];
    const fullDeclStart = lineOffsets[firstAttrLine];
    const tokenStart = declStart + indent.length;

    let openBraceIdx = -1;
    let declEnd = -1;
    let parenDepth = 0;
    let sawParamParen = false;
    let pos = tokenStart;
    const len = nativeSource.length;

    while (pos < len) {
      const ch = nativeSource[pos];
      const next = nativeSource[pos + 1];

      if (ch === "/" && next === "/") {
        pos += 2;
        while (pos < len && nativeSource[pos] !== "\n") pos++;
        continue;
      }
      if (ch === "/" && next === "*") {
        pos += 2;
        while (pos < len && !(nativeSource[pos] === "*" && nativeSource[pos + 1] === "/")) pos++;
        pos += 2;
        continue;
      }
      if (ch === '"' || ch === "'" || ch === "`") {
        if (
          ch === "'" &&
          targetLang === "rust" &&
          /^'[A-Za-z_][A-Za-z0-9_]*(?!')/.test(nativeSource.slice(pos))
        ) {
          pos += 2;
          continue;
        }
        const q = ch;
        pos++;
        while (pos < len && nativeSource[pos] !== q) {
          if (nativeSource[pos] === "\\") pos += 2;
          else pos++;
        }
        if (pos < len) pos++;
        continue;
      }

      if (ch === "(") {
        parenDepth++;
        sawParamParen = true;
      } else if (ch === ")") {
        parenDepth = Math.max(0, parenDepth - 1);
      } else if (parenDepth === 0) {
        if (ch === "{") {
          if (
            sawParamParen &&
            (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx")
          ) {
            const candidateEnd = findMatchingBraceEnd(nativeSource, pos, targetLang);
            const afterTypeBrace = nativeSource.slice(
              candidateEnd,
              Math.min(len, candidateEnd + 160),
            );
            if (/^[ \t\r\n]*(?:[|&][^{;]+|\[\])*[ \t\r\n]*[;{]/.test(afterTypeBrace)) {
              pos = candidateEnd;
              continue;
            }
          }
          openBraceIdx = pos;
          break;
        }
        if (ch === ";" || (enclosingClass && ch === ",")) {
          declEnd = pos + 1;
          break;
        }
        if (ch === "\n") {
          const headerSoFar = nativeSource.slice(tokenStart, pos).trimEnd();
          const restAfterLine = nativeSource.slice(pos + 1);
          const nextNonEmpty = restAfterLine.match(/^[ \t]*(?:\r?\n[ \t]*)*([^\s])/)?.[1] ?? "";
          const isBracelessConstruct =
            (targetLang === "kotlin" &&
              (/^(?:public\s+|private\s+|internal\s+)?(?:data\s+|value\s+)class\b/.test(
                headerSoFar,
              ) ||
                /^(?:public\s+|private\s+|internal\s+)?(?:typealias|const\s+val|val|var)\b/.test(
                  headerSoFar,
                ) ||
                (/\bfun\b/.test(headerSoFar) && /\)\s*(?::\s*[^=]+)?=\s*\S/.test(headerSoFar)))) ||
            (targetLang === "go" &&
              /^(?:type|const|var)\s+[A-Za-z0-9_]+/.test(headerSoFar) &&
              !/\b(?:struct|interface)\s*$/.test(headerSoFar));
          if (isBracelessConstruct && nextNonEmpty !== "{") {
            declEnd = nativeSource[pos - 1] === "\r" ? pos - 1 : pos;
            break;
          }
        }
      }
      pos++;
    }

    if (openBraceIdx >= 0) {
      declEnd = findMatchingBraceEnd(nativeSource, openBraceIdx, targetLang);
      if (nativeSource[declEnd] === ";") {
        declEnd++;
      }
    } else if (declEnd < 0) {
      return undefined;
    }

    const headerEndPos = openBraceIdx >= 0 ? openBraceIdx : declEnd;
    const headerSlice = nativeSource.slice(tokenStart, headerEndPos);
    let visibility: "public" | "private" | "protected" | undefined;
    if (/\bpublic\b/.test(headerSlice)) visibility = "public";
    else if (/\bprivate\b/.test(headerSlice)) visibility = "private";
    else if (/\bprotected\b/.test(headerSlice)) visibility = "protected";

    const isExported =
      /\bpub\b/.test(headerSlice) ||
      visibility === "public" ||
      (targetLang === "go" && /^[A-Z]/.test(actualMemberName));
    const isStatic = /\bstatic\b/.test(headerSlice);
    const isAsync = /\b(?:async|suspend)\b/.test(headerSlice);

    return {
      declStart,
      fullDeclStart,
      declEnd,
      tokenStart,
      declIndent: indent,
      className: enclosingClass,
      memberName: actualMemberName,
      visibility,
      isExported,
      isStatic,
      isAsync,
      origHeader: headerSlice,
      ...extra,
    };
  };

  // 1. Go receiver method or top-level func/struct/type/const/var
  if (targetLang === "go") {
    for (let i = 0; i < lines.length; i++) {
      const recvMatch = lines[i].match(
        /^([ \t]*)func\s*\(\s*([A-Za-z0-9_]+\s+\*?([A-Za-z0-9_]+))\s*\)\s*([A-Za-z0-9_]+)\s*(?:\[[^\]]+\])?\s*\(/,
      );
      if (recvMatch) {
        const [, indent, recvSpec, recvType, fnName] = recvMatch;
        const classMatches = !normClass || normIdForSpan(recvType) === normClass;
        const nameMatches = fnName === memberName || normIdForSpan(fnName) === normMember;
        if (classMatches && nameMatches) {
          return buildBraceSpanFromLine(i, indent, fnName, recvType, {
            goReceiver: `(${recvSpec})`,
          });
        }
      }
      if (!className) {
        const fnMatch = lines[i].match(/^([ \t]*)func\s+([A-Za-z0-9_]+)\s*(?:\[[^\]]+\])?\s*\(/);
        if (fnMatch && (fnMatch[2] === memberName || normIdForSpan(fnMatch[2]) === normMember)) {
          return buildBraceSpanFromLine(i, fnMatch[1], fnMatch[2], undefined);
        }
        const structMatch = lines[i].match(/^([ \t]*)type\s+([A-Za-z0-9_]+)\b/);
        if (
          structMatch &&
          (structMatch[2] === memberName || normIdForSpan(structMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, structMatch[1], structMatch[2], undefined, {
            isClassContainer: /\b(?:struct|interface)\b/.test(lines[i]),
          });
        }
        const constVarMatch = lines[i].match(/^([ \t]*)(?:const|var)\s+([A-Za-z0-9_]+)\b/);
        if (
          constVarMatch &&
          (constVarMatch[2] === memberName || normIdForSpan(constVarMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, constVarMatch[1], constVarMatch[2], undefined);
        }
      }
    }
    return undefined;
  }

  // 2. C++ out-of-line method `RetType ClassName::methodName(...)`
  if (targetLang === "cpp") {
    const oolMatches: Array<{ cls: string; span: NativeSpanInfo }> = [];
    for (let i = 0; i < lines.length; i++) {
      const oolMatch = lines[i].match(
        /^([ \t]*)(?:[A-Za-z0-9_:<>*&]+\s+)+([A-Za-z0-9_]+)\s*::\s*([A-Za-z0-9_~]+)\s*\(/,
      );
      if (oolMatch) {
        const [, indent, cls, fnName] = oolMatch;
        const classMatches = !normClass || normIdForSpan(cls) === normClass;
        const nameMatches = fnName === memberName || normIdForSpan(fnName) === normMember;
        if (classMatches && nameMatches && lines[i].includes("{")) {
          const built = buildBraceSpanFromLine(i, indent, fnName, cls, { cppOutOfLine: true });
          if (built) {
            oolMatches.push({ cls, span: built });
          }
        }
      }
    }
    if (oolMatches.length > 0) {
      const distinctOol = new Set(oolMatches.map((m) => m.cls));
      if (!normClass && distinctOol.size > 1 && strictForSplice) {
        throw new Error(
          `Ambiguous symbol '${memberName}' found in multiple containers (${Array.from(distinctOol).join(", ")}). Qualify as '<Class>::${memberName}'.`,
        );
      }
      return oolMatches[0].span;
    }
  }

  // 3. Determine class/impl search windows for Rust, C++, C#, Kotlin, PHP
  const containerWindows: Array<{
    start: number;
    end: number;
    resolvedName: string;
    memberDepth: number;
  }> = [];
  let resolvedClassName = className;

  const allContainerWindows: Array<{
    start: number;
    end: number;
    resolvedName: string;
    memberDepth: number;
  }> = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const isRustImpl =
      targetLang === "rust" &&
      /^\s*impl(?:\s*<[^>]*>)?\s+(?:[A-Za-z0-9_:<>,\s]+\s+for\s+)?([A-Za-z0-9_]+)\b/.exec(line);
    const isClassLine =
      /^\s*(?:export\s+|default\s+|declare\s+|pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|trait|object|record|enum)\s+([A-Za-z0-9_$]+)\b/.exec(
        line,
      );

    const m = isRustImpl || isClassLine;
    if (m) {
      const openBrace = nativeSource.indexOf("{", lineOffsets[i]);
      const semiBeforeBrace = nativeSource.indexOf(";", lineOffsets[i]);
      if (openBrace >= 0 && (semiBeforeBrace < 0 || openBrace < semiBeforeBrace)) {
        const outerDepth = openBraceDepthByOffset.get(openBrace) ?? lineBraceDepths[i] ?? 0;
        allContainerWindows.push({
          start: openBrace + 1,
          end: findMatchingBraceEnd(nativeSource, openBrace, targetLang),
          resolvedName: m[1],
          memberDepth: outerDepth + 1,
        });
      }
    }
  }

  if (className) {
    for (const w of allContainerWindows) {
      if (w.resolvedName === className || normIdForSpan(w.resolvedName) === normClass) {
        resolvedClassName = w.resolvedName;
        containerWindows.push(w);
      }
    }
    if (containerWindows.length === 0) return undefined;
  }

  // 4. Scan lines within matching container windows (or full file when top-level)
  const candidates: NativeSpanInfo[] = [];
  const collectOrReturn = (span: NativeSpanInfo | undefined): NativeSpanInfo | undefined => {
    if (!span) return undefined;
    if (explicitArity === undefined) return span;
    candidates.push(span);
    return undefined;
  };

  for (let i = 0; i < lines.length; i++) {
    const lineOff = lineOffsets[i];
    if (
      className &&
      !containerWindows.some(
        (w) => lineOff >= w.start && lineOff < w.end && lineBraceDepths[i] === w.memberDepth,
      )
    ) {
      continue;
    }
    const isInsideAnyContainer =
      !className && allContainerWindows.some((w) => lineOff >= w.start && lineOff < w.end);
    const line = lines[i];

    if (targetLang === "rust") {
      const fnMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:async\s+)?(?:const\s+)?(?:unsafe\s+)?fn\s+([A-Za-z0-9_]+)\b/,
          )
        : null;
      if (fnMatch && (fnMatch[2] === memberName || normIdForSpan(fnMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, fnMatch[1], fnMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const fieldMatch = line.match(
          /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?([A-Za-z0-9_]+)\s*:\s*[^,;]+[,;]?/,
        );
        if (
          fieldMatch &&
          (fieldMatch[2] === memberName || normIdForSpan(fieldMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, fieldMatch[1], fieldMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const structMatch = line.match(
          /^([ \t]*)(?:pub(?:\([^)]*\))?\s+)?(?:struct|enum|trait|impl|type|const|static)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          structMatch &&
          (structMatch[2] === memberName || normIdForSpan(structMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, structMatch[1], structMatch[2], undefined, {
            isClassContainer: /\b(?:struct|enum|trait|impl)\b/.test(line),
          });
        }
        const macroMatch = line.match(/^([ \t]*)macro_rules!\s+([A-Za-z0-9_]+)\b/);
        if (
          macroMatch &&
          (macroMatch[2] === memberName || normIdForSpan(macroMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, macroMatch[1], macroMatch[2], undefined);
        }
      }
    } else if (targetLang === "kotlin") {
      const funMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|override\s+|open\s+|suspend\s+|inline\s+|operator\s+)*fun\s+(?:<[^>]+>\s+)?(?:[A-Za-z0-9_<>?.*]+\.)?([A-Za-z0-9_]+)\s*\(/,
          )
        : null;
      if (funMatch && (funMatch[2] === memberName || normIdForSpan(funMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, funMatch[1], funMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const propMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|override\s+|open\s+|final\s+|lateinit\s+|const\s+)*(?:val|var)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          propMatch &&
          (propMatch[2] === memberName || normIdForSpan(propMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, propMatch[1], propMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const ktTopMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|open\s+|abstract\s+|data\s+|sealed\s+|value\s+|enum\s+)*(?:class|interface|object|typealias|const\s+val|val)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          ktTopMatch &&
          (ktTopMatch[2] === memberName || normIdForSpan(ktTopMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, ktTopMatch[1], ktTopMatch[2], undefined, {
            isClassContainer: /\b(?:class|interface|object)\b/.test(line),
          });
        }
      }
    } else if (targetLang === "php") {
      const phpMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:public\s+|private\s+|protected\s+|static\s+|final\s+|abstract\s+)*function\s+&?([A-Za-z0-9_]+)\s*\(/,
          )
        : null;
      if (phpMatch && (phpMatch[2] === memberName || normIdForSpan(phpMatch[2]) === normMember)) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, phpMatch[1], phpMatch[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const phpPropMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|static\s+|readonly\s+|var\s+)*(?:[A-Za-z0-9_\\|?]+\s+)*\$?([A-Za-z0-9_]+)\s*(?:=[^;]+)?;?/,
        );
        if (
          phpPropMatch &&
          (phpPropMatch[2] === memberName || normIdForSpan(phpPropMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, phpPropMatch[1], phpPropMatch[2], resolvedClassName);
        }
      }
      if (!className) {
        const phpTopMatch = line.match(
          /^([ \t]*)(?:final\s+|abstract\s+|readonly\s+)*(?:class|interface|trait|enum)\s+([A-Za-z0-9_]+)\b/,
        );
        if (
          phpTopMatch &&
          (phpTopMatch[2] === memberName || normIdForSpan(phpTopMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, phpTopMatch[1], phpTopMatch[2], undefined, {
            isClassContainer: true,
          });
        }
      }
    } else if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("/*") ||
        trimmed.startsWith("*") ||
        /^(?:if|for|while|switch|catch|return|super|new|throw|typeof|delete|void)\b/.test(trimmed)
      ) {
        continue;
      }
      if (!className) {
        const tsFnMatch = line.match(
          /^([ \t]*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:async\s+)?function\s*\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\b/,
        );
        if (
          tsFnMatch &&
          (tsFnMatch[2] === memberName || normIdForSpan(tsFnMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(i, tsFnMatch[1], tsFnMatch[2], undefined);
          if (span) {
            const hasBraceBody = span.tokenStart + (span.origHeader?.length ?? 0) < span.declEnd;
            const isOverloadHeader = !hasBraceBody && !/\bdeclare\s+/.test(line);
            if (isOverloadHeader) {
              candidates.push(span);
            } else {
              const res = collectOrReturn(span);
              if (res) return res;
            }
          }
        }
        const tsVarOrTypeMatch = line.match(
          /^([ \t]*)(?:export\s+)?(?:default\s+)?(?:declare\s+)?(?:const|let|var|type)\s+([A-Za-z_$][A-Za-z0-9_$]*)\b/,
        );
        if (
          tsVarOrTypeMatch &&
          (tsVarOrTypeMatch[2] === memberName || normIdForSpan(tsVarOrTypeMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(
            i,
            tsVarOrTypeMatch[1],
            tsVarOrTypeMatch[2],
            undefined,
          );
          if (span) return span;
        }
      } else {
        const tsMethodMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+|abstract\s+|async\s+)*(?:(get|set)\s+)?\*?\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*(?:<[^>]*>)?\s*\(/,
        );
        if (
          tsMethodMatch &&
          (tsMethodMatch[3] === memberName || normIdForSpan(tsMethodMatch[3]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(
            i,
            tsMethodMatch[1],
            tsMethodMatch[3],
            resolvedClassName,
            tsMethodMatch[2] ? { accessor: tsMethodMatch[2] as "get" | "set" } : undefined,
          );
          if (span) {
            const hasBraceBody = span.tokenStart + (span.origHeader?.length ?? 0) < span.declEnd;
            const isOverloadHeader = !hasBraceBody && !/\babstract\s+/.test(line);
            if (isOverloadHeader) {
              candidates.push(span);
            } else {
              const res = collectOrReturn(span);
              if (res) return res;
            }
          }
        }
        const tsPropMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|readonly\s+|static\s+|override\s+|declare\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*[?!]?\s*(?::[^=;]+)?\s*(?:=|;)/,
        );
        if (
          tsPropMatch &&
          (tsPropMatch[2] === memberName || normIdForSpan(tsPropMatch[2]) === normMember)
        ) {
          const span = buildBraceSpanFromLine(i, tsPropMatch[1], tsPropMatch[2], resolvedClassName);
          if (span) return span;
        }
      }
    } else if (targetLang === "csharp" || targetLang === "cpp" || targetLang === "java") {
      const trimmed = line.trim();
      if (
        trimmed.startsWith("//") ||
        trimmed.startsWith("#") ||
        trimmed.startsWith("if ") ||
        trimmed.startsWith("if(") ||
        trimmed.startsWith("for ") ||
        trimmed.startsWith("for(") ||
        trimmed.startsWith("while ") ||
        trimmed.startsWith("while(") ||
        trimmed.startsWith("switch ") ||
        trimmed.startsWith("switch(") ||
        trimmed.startsWith("return ")
      ) {
        continue;
      }
      const cMethodMatch = !isInsideAnyContainer
        ? line.match(
            /^([ \t]*)(?:@[A-Za-z0-9_$.]+(?:\([^)]*\))?\s+)*(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|abstract\s+|synchronized\s+|default\s+|native\s+|strictfp\s+|virtual\s+|override\s+|async\s+|inline\s+|constexpr\s+|explicit\s+|friend\s+)*(?:<[^>]+>\s+)?(?:[A-Za-z0-9_:<>*&[\]?,.$]+\s+)+([A-Za-z0-9_~$]+)\s*(?:<[^>]+>)?\s*\(/,
          )
        : null;
      const javaCtorMatch =
        !cMethodMatch && targetLang === "java" && resolvedClassName && !isInsideAnyContainer
          ? line.match(
              /^([ \t]*)(?:@[A-Za-z0-9_$.]+(?:\([^)]*\))?\s+)*(?:public\s+|private\s+|protected\s+)*([A-Za-z_$][A-Za-z0-9_$]*)\s*\(/,
            )
          : null;
      const matchedMethod =
        cMethodMatch ??
        (javaCtorMatch && javaCtorMatch[2] === resolvedClassName ? javaCtorMatch : null);
      if (
        matchedMethod &&
        (matchedMethod[2] === memberName || normIdForSpan(matchedMethod[2]) === normMember)
      ) {
        const res = collectOrReturn(
          buildBraceSpanFromLine(i, matchedMethod[1], matchedMethod[2], resolvedClassName),
        );
        if (res) return res;
      }
      if (className) {
        const cFieldMatch = line.match(
          /^([ \t]*)(?:public\s+|private\s+|protected\s+|internal\s+|static\s+|final\s+|transient\s+|readonly\s+|volatile\s+|const\s+|constexpr\s+|inline\s+)*(?:[A-Za-z0-9_:<>*&[\]?,.$]+\s+)+([A-Za-z0-9_$]+)\s*(?:=|;|\{|=>)/,
        );
        if (
          cFieldMatch &&
          (cFieldMatch[2] === memberName || normIdForSpan(cFieldMatch[2]) === normMember)
        ) {
          return buildBraceSpanFromLine(i, cFieldMatch[1], cFieldMatch[2], resolvedClassName);
        }
      }
    }

    if (!className) {
      const clsMatch = line.match(
        /^([ \t]*)(?:export\s+|default\s+|declare\s+|pub\s+|public\s+|private\s+|protected\s+|internal\s+|static\s+|partial\s+|final\s+|abstract\s+|open\s+|data\s+|sealed\s+|readonly\s+)*(?:class|struct|interface|enum(?:\s+class)?|record(?:\s+class|\s+struct)?)\s+([A-Za-z0-9_$]+)\b/,
      );
      if (clsMatch && (clsMatch[2] === memberName || normIdForSpan(clsMatch[2]) === normMember)) {
        return buildBraceSpanFromLine(i, clsMatch[1], clsMatch[2], undefined, {
          isClassContainer: true,
        });
      }
    }
  }

  if (candidates.length > 0) {
    const withBody = candidates.filter(
      (c) => c.tokenStart + (c.origHeader?.length ?? 0) < c.declEnd,
    );
    const pool = withBody.length > 0 ? withBody : candidates;
    if (explicitArity !== undefined) {
      const arityMatch = pool.find((c) => countHeaderParams(c.origHeader ?? "") === explicitArity);
      if (arityMatch) return arityMatch;
    }
    return pool[0];
  }

  // 5. Fallback: if !className, try finding enclosing class name for a unique method match
  if (!className) {
    const matchedSpans: Array<{ cls: string; span: NativeSpanInfo }> = [];
    const checkedClasses = new Set<string>();
    for (const w of allContainerWindows) {
      {
        const candidateCls = w.resolvedName;
        if (checkedClasses.has(candidateCls)) continue;
        checkedClasses.add(candidateCls);
        const found = locateBraceLanguageDeclarationSpan(
          nativeSource,
          `${candidateCls}.${memberName}`,
          targetLang,
          candidateCls,
          explicitArity,
          false,
        );
        if (found) {
          matchedSpans.push({ cls: candidateCls, span: found });
        }
      }
    }
    if (matchedSpans.length > 1 && strictForSplice) {
      throw new Error(
        `Ambiguous symbol '${memberName}' found in multiple containers (${matchedSpans.map((m) => m.cls).join(", ")}). Qualify as '<Class>.${memberName}'.`,
      );
    }
    if (matchedSpans.length > 0) {
      return matchedSpans[0].span;
    }
  }

  return undefined;
}

const KNOWN_TARGET_LANGS_SET = new Set<string>([
  "typescript",
  "javascript",
  "tsx",
  "python",
  "html",
  "xml",
  "css",
  "rust",
  "go",
  "cpp",
  "csharp",
  "java",
  "json",
  "yaml",
  "twig",
  "php",
  "kotlin",
  "shell",
  "powershell",
  "batch",
  "markdown",
  "aipl",
  "text",
]);

export function locateNativeDeclarationSpan(
  nativeSource: string,
  symbolOrTargetLang: string,
  targetLangOrSymbol: TargetLanguage | string,
  explicitClassName?: string,
  preferAccessor?: "get" | "set",
  preferredArity?: number,
  strictForSplice = false,
): NativeSpanInfo | undefined {
  let symbolSelector: string;
  let targetLang: TargetLanguage;
  let classFilter = explicitClassName;

  if (
    KNOWN_TARGET_LANGS_SET.has(symbolOrTargetLang) &&
    !KNOWN_TARGET_LANGS_SET.has(targetLangOrSymbol)
  ) {
    targetLang = symbolOrTargetLang as TargetLanguage;
    symbolSelector = targetLangOrSymbol;
    if (
      classFilter &&
      (classFilter.includes("/") || classFilter.includes("\\") || classFilter.includes("."))
    ) {
      classFilter = undefined;
    }
  } else {
    symbolSelector = symbolOrTargetLang;
    targetLang = targetLangOrSymbol as TargetLanguage;
  }

  const normSelectorLower = symbolSelector.trim().replace(/^:/, "").toLowerCase();
  if (normSelectorLower === "imports" || normSelectorLower === "import") {
    const importSpan = locateImportBlockSpan(nativeSource, targetLang);
    if (importSpan) {
      return enrichSpanWithOffsetsAndLines(nativeSource, importSpan);
    }
  }

  let rawSpan: NativeSpanInfo | undefined;
  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "markdown"
  ) {
    rawSpan = locateScriptOrMarkdownSpan(nativeSource, symbolSelector, targetLang, strictForSplice);
  } else if (targetLang === "python") {
    const cleanPySel = symbolSelector.trim().replace(/\([^)]*\)$/, "");
    rawSpan = locatePythonDeclarationSpan(nativeSource, cleanPySel, classFilter, strictForSplice);
  } else if (targetLang === "aipl") {
    const cleanAiplSel = symbolSelector.trim().replace(/\([^)]*\)$/, "");
    rawSpan = locateAiplDeclarationSpan(nativeSource, cleanAiplSel, classFilter);
  } else if (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx") {
    rawSpan = locateTsDeclarationSpan(
      nativeSource,
      symbolSelector,
      classFilter,
      preferAccessor,
      preferredArity,
      strictForSplice,
    );
  } else {
    rawSpan =
      locateBraceLanguageDeclarationSpan(
        nativeSource,
        symbolSelector,
        targetLang,
        classFilter,
        preferredArity,
        strictForSplice,
      ) ??
      locateTsDeclarationSpan(
        nativeSource,
        symbolSelector,
        classFilter,
        preferAccessor,
        preferredArity,
        strictForSplice,
      );
  }

  return enrichSpanWithOffsetsAndLines(nativeSource, rawSpan);
}
