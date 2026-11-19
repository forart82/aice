/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Single-edit native resolution and multi-edit native source splicing orchestration.
 */

import * as path from "node:path";
import ts from "../../compat/typescript.js";
import type { ProjectIdiomDefinition } from "../../config/index.js";
import { applyTriviaLensToReplacement, extractDeclarationTriviaLens } from "../../core/trivia.js";
import { decompile } from "../../decompiler/index.js";
import type { TargetLanguage } from "../../emitters/index.js";
import { estimateTokens } from "../../tokenomics/index.js";
import { resolveFirstActionableSymbol } from "../context.js";
import { extractInlineIdiomsFromSource } from "../create.js";
import { didYouMeanSymbol } from "../suggest.js";
import { validateNativeSyntax } from "../syntax-validator.js";
import { generateUnifiedDiff, indentCode } from "./ast-helpers.js";
import { spliceDialectNativeSource } from "./dialect-splice.js";
import {
  applyHunksToScope,
  buildEmptySpliceBlockError,
  computeOriginalEditLineSpan,
  containsHunkMarkers,
  extractHunkBlocks,
  formatSurroundingNumberedContext,
  stripNumberedGutterPrefixes,
} from "./hunks.js";
import { resolveLineRangeNativeEdit } from "./line-range-splice.js";
import { emitNativeSnippetForContext } from "./native-ast-splice.js";
import {
  findMatchingBraceEnd,
  inferSnippetParamArity,
  locateNativeDeclarationSpan,
} from "./span-locators.js";
import { isCreateOrOverwriteSymbol, resolveEffectiveSpliceTargetLang } from "./stream-parser.js";
import {
  enrichSpanWithOffsetsAndLines,
  extractNativeTestBlocks,
  extractScriptOrMarkdownSymbols,
  getCachedTsSourceFile,
  locateScriptOrMarkdownSpan,
} from "./ts-and-script-spans.js";
import type { ResolvedNativeEdit, SpliceOptions, SpliceResult } from "./types.js";

function resolveSingleNativeEditAgainstSource(
  nativeSource: string,
  rawEditOptions: SpliceOptions,
  filePath: string,
  targetLang: TargetLanguage,
  idioms: Record<string, ProjectIdiomDefinition> | undefined,
  forceLosslessPreprocess: boolean,
): ResolvedNativeEdit {
  let options = rawEditOptions;
  let anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  if (anchorSymbol) {
    if (/(?:\s+|^)@(?:replace|strip|drop)-docs\b/i.test(anchorSymbol)) {
      anchorSymbol = anchorSymbol.replace(/(?:\s+|^)@(?:replace|strip|drop)-docs\b/gi, "").trim();
      if (options.preserveDocs === undefined) {
        options = { ...options, preserveDocs: false };
      }
    }
    const inlineClone = anchorSymbol.match(
      /\s*(?:@clone|\(clone)\s*\(\s*([^()]+)\s*\)|\s*\(clone\s+([^()]+)\)|\s+@clone\s+([^\s()]+)/i,
    );
    if (inlineClone) {
      const extractedClone = (inlineClone[1] || inlineClone[2] || inlineClone[3] || "").trim();
      anchorSymbol = anchorSymbol.replace(inlineClone[0], "").trim();
      if (!options.cloneFrom && extractedClone) {
        options = { ...options, cloneFrom: extractedClone };
      }
    }
    anchorSymbol = anchorSymbol.replace(
      /^:(?=(?:eof|end|append|imports?|\s*\[?L?\d+(?:\s*(?:-|\.\.|:)\s*L?\d+)?\]?)$)/i,
      "",
    );
  }
  let rawSnippet = stripNumberedGutterPrefixes(options.code ?? options.body ?? "");

  if (
    (!anchorSymbol ||
      anchorSymbol === ":hunk" ||
      anchorSymbol === "hunk" ||
      isCreateOrOverwriteSymbol(anchorSymbol)) &&
    containsHunkMarkers(rawSnippet)
  ) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      const hunkIdiomsOn =
        options.idioms !== false &&
        (options.idioms === true || Boolean(idioms && Object.keys(idioms).length > 0));
      const updated = applyHunksToScope(
        nativeSource,
        hunks,
        filePath,
        filePath,
        targetLang,
        idioms,
        hunkIdiomsOn,
        false,
        1,
        { nativeSource, scopeStartOffset: 0, scopeEndOffset: nativeSource.length },
      );
      return {
        symbol: anchorSymbol || ":hunk",
        startOffset: 0,
        endOffset: nativeSource.length,
        replacement: updated,
        originalSnippet: hunks.map((h) => h.search).join("\n\n"),
        newSnippet: rawSnippet,
      };
    }
  }

  if (!anchorSymbol) {
    throw new Error("Must specify target symbol with --symbol when splicing native file");
  }

  if (options.cloneFrom) {
    const cloneSym = options.cloneFrom.trim();
    const cloneSpan = locateNativeDeclarationSpan(nativeSource, cloneSym, targetLang);
    let clonedSlice = "";
    let insertPos = -1;
    let isTest = false;
    let cloneStartOffset = 0;

    if (!cloneSpan) {
      const testBlocks = extractNativeTestBlocks(nativeSource);
      const tb = testBlocks.find((t) => t.title === cloneSym || t.title.startsWith(cloneSym));
      if (tb) {
        clonedSlice = nativeSource.slice(tb.startOffset, tb.endOffset);
        insertPos = tb.endOffset;
        isTest = true;
        cloneStartOffset = tb.startOffset;
      } else {
        throw new Error(`Symbol to clone '${cloneSym}' not found in ${filePath}`);
      }
    } else {
      const resolvedCloneSpan = cloneSpan;
      const testBlocks = extractNativeTestBlocks(nativeSource);
      const tb = testBlocks.find(
        (t) =>
          t.title === cloneSym ||
          t.title.startsWith(cloneSym) ||
          (t.startOffset === resolvedCloneSpan.declStart &&
            t.endOffset === resolvedCloneSpan.declEnd),
      );
      if (tb) {
        clonedSlice = nativeSource.slice(tb.startOffset, tb.endOffset);
        insertPos = tb.endOffset;
        isTest = true;
        cloneStartOffset = tb.startOffset;
      } else {
        clonedSlice = nativeSource.slice(resolvedCloneSpan.declStart, resolvedCloneSpan.declEnd);
        insertPos = resolvedCloneSpan.declEnd;
        cloneStartOffset = resolvedCloneSpan.declStart;
      }
    }

    if (containsHunkMarkers(rawSnippet)) {
      const cloneHunks = extractHunkBlocks(rawSnippet);
      const cloneIdiomsOn =
        options.idioms !== false &&
        (options.idioms === true || Boolean(idioms && Object.keys(idioms).length > 0));
      const cloneStartLine = nativeSource.slice(0, cloneStartOffset).split("\n").length;
      clonedSlice = applyHunksToScope(
        clonedSlice,
        cloneHunks,
        anchorSymbol || cloneSym,
        filePath,
        targetLang,
        idioms,
        cloneIdiomsOn,
        false,
        cloneStartLine,
      );
    }
    const ruleLines = containsHunkMarkers(rawSnippet) ? [] : rawSnippet.split(/\r?\n/);
    const rules: Array<{ from: string; to: string }> = [];
    for (const line of ruleLines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#")) continue;
      const arrowMatch = trimmed.match(
        /^(?:"([^"]*)"|'([^']*)'|(.+?))\s*->\s*(?:"([^"]*)"|'([^']*)'|(.+))$/,
      );
      if (arrowMatch) {
        const from =
          arrowMatch[1] !== undefined
            ? arrowMatch[1]
            : arrowMatch[2] !== undefined
              ? arrowMatch[2]
              : (arrowMatch[3] ?? "").trim();
        const to =
          arrowMatch[4] !== undefined
            ? arrowMatch[4]
            : arrowMatch[5] !== undefined
              ? arrowMatch[5]
              : (arrowMatch[6] ?? "").trim();
        if (from.length > 0) {
          rules.push({ from, to });
        }
      }
    }

    if (rules.length > 0) {
      const sortedRules = [...rules].sort((a, b) => b.from.length - a.from.length);
      const pattern = sortedRules
        .map((r) => r.from.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"))
        .join("|");
      const ruleMap = new Map(rules.map((r) => [r.from, r.to]));
      clonedSlice = clonedSlice.replace(new RegExp(pattern, "g"), (m) => ruleMap.get(m) ?? m);
    }

    const cloneNl = nativeSource.includes("\r\n") ? "\r\n" : "\n";
    const computeCloneSep = (pos: number): string => {
      const tail = nativeSource.slice(pos);
      if (/^(?:\r?\n){2}/.test(tail)) return "";
      if (/^\r?\n/.test(tail)) return cloneNl;
      return `${cloneNl}${cloneNl}`;
    };

    if (isTest) {
      if (!rules.some((r) => r.from === cloneSym) && clonedSlice.includes(cloneSym)) {
        clonedSlice = clonedSlice.replace(cloneSym, () => anchorSymbol);
      }
      const sep = computeCloneSep(insertPos);
      return {
        symbol: anchorSymbol,
        startOffset: insertPos,
        endOffset: insertPos,
        replacement: `${sep}${clonedSlice}`,
        originalSnippet: "",
        newSnippet: clonedSlice,
        isInsertion: true,
      };
    }

    const cloneShort = cloneSym.split(/[.:]/).pop()?.trim();
    const targetShort = anchorSymbol.split(/[.:]/).pop()?.trim();
    if (cloneShort && targetShort && cloneShort !== targetShort) {
      if (!rules.some((r) => r.from === cloneShort)) {
        const escaped = cloneShort.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        clonedSlice = clonedSlice.replace(new RegExp(`\\b${escaped}\\b`), () => targetShort);
      }
    }

    const targetSpan = locateNativeDeclarationSpan(nativeSource, anchorSymbol, targetLang);
    if (!targetSpan) {
      const sep = computeCloneSep(insertPos);
      return {
        symbol: anchorSymbol,
        startOffset: insertPos,
        endOffset: insertPos,
        replacement: `${sep}${clonedSlice}`,
        originalSnippet: "",
        newSnippet: clonedSlice,
        isInsertion: true,
      };
    }
    rawSnippet = clonedSlice;
  }

  if (/^(?:eof|end|append)$/i.test(anchorSymbol.trim())) {
    if (options.delete) {
      throw new Error(`Cannot delete '${anchorSymbol}'`);
    }
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to native file");
    }
    const emitted = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      undefined,
      forceLosslessPreprocess,
    );
    if (targetLang === "csharp") {
      const firstDeclLine = emitted
        .split(/\r?\n/)
        .map((l) => l.trim())
        .find(
          (l) =>
            l.length > 0 &&
            !l.startsWith("//") &&
            !l.startsWith("/*") &&
            !l.startsWith("*") &&
            !l.startsWith("[") &&
            !l.startsWith("#"),
        );
      const isTopLevelCsContainer =
        !firstDeclLine ||
        /^using\b/.test(firstDeclLine) ||
        /^(?:(?:public|private|protected|internal|file|static|partial|abstract|sealed|readonly|ref|unsafe)\s+)*(?:namespace|class|struct|interface|enum|record|delegate)\b/.test(
          firstDeclLine,
        );
      if (!isTopLevelCsContainer) {
        let lastTopClass: { classIndent: string; openBrace: number; blockEnd: number } | null =
          null;
        let i = 0;
        const srcLen = nativeSource.length;
        const csClassLineRe =
          /^([ \t]*)(?:\[[^\]]*\]\s*)*(?:(?:public|private|protected|internal|file|static|partial|abstract|sealed|readonly|ref|unsafe)\s+)*(?:class|struct)\s+[A-Za-z_][A-Za-z0-9_]*\b/;
        while (i < srcLen) {
          if (i === 0 || nativeSource[i - 1] === "\n") {
            const lineMatch = csClassLineRe.exec(nativeSource.slice(i));
            if (lineMatch) {
              let probe = i + lineMatch[0].length;
              let foundBrace = -1;
              while (probe < srcLen) {
                const c = nativeSource[probe];
                const n = nativeSource[probe + 1];
                if (c === "/" && n === "/") {
                  probe += 2;
                  while (probe < srcLen && nativeSource[probe] !== "\n") probe++;
                  continue;
                }
                if (c === "/" && n === "*") {
                  probe += 2;
                  while (
                    probe < srcLen &&
                    !(nativeSource[probe] === "*" && nativeSource[probe + 1] === "/")
                  ) {
                    probe++;
                  }
                  probe += 2;
                  continue;
                }
                if (c === ";") break;
                if (c === "{") {
                  foundBrace = probe;
                  break;
                }
                probe++;
              }
              if (foundBrace >= 0) {
                const blockEnd = findMatchingBraceEnd(nativeSource, foundBrace, "csharp");
                if (blockEnd > foundBrace + 1 && nativeSource[blockEnd - 1] === "}") {
                  lastTopClass = {
                    classIndent: lineMatch[1] ?? "",
                    openBrace: foundBrace,
                    blockEnd,
                  };
                  i = blockEnd;
                  continue;
                }
              }
            }
          }
          const ch = nativeSource[i];
          const next = nativeSource[i + 1];
          if (ch === "/" && next === "/") {
            i += 2;
            while (i < srcLen && nativeSource[i] !== "\n") i++;
            continue;
          }
          if (ch === "/" && next === "*") {
            i += 2;
            while (i < srcLen && !(nativeSource[i] === "*" && nativeSource[i + 1] === "/")) i++;
            i += 2;
            continue;
          }
          if (ch === "@" && next === '"') {
            i += 2;
            while (i < srcLen) {
              if (nativeSource[i] === '"') {
                if (nativeSource[i + 1] === '"') {
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
          if (ch === '"' || ch === "'") {
            const q = ch;
            i++;
            while (i < srcLen && nativeSource[i] !== q) {
              if (nativeSource[i] === "\\") i += 2;
              else if (q === "'" && nativeSource[i] === "\n") break;
              else i++;
            }
            if (i < srcLen && nativeSource[i] === q) i++;
            continue;
          }
          i++;
        }
        if (lastTopClass) {
          const closeBracePos = lastTopClass.blockEnd - 1;
          const bodyInner = nativeSource.slice(lastTopClass.openBrace + 1, closeBracePos);
          let memberIndent = `${lastTopClass.classIndent}    `;
          for (const bodyLine of bodyInner.split(/\r?\n/)) {
            const trimmedBodyLine = bodyLine.trim();
            if (
              trimmedBodyLine.length > 0 &&
              !trimmedBodyLine.startsWith("//") &&
              !trimmedBodyLine.startsWith("/*") &&
              !trimmedBodyLine.startsWith("*") &&
              !trimmedBodyLine.startsWith("{") &&
              !trimmedBodyLine.startsWith("}") &&
              !trimmedBodyLine.startsWith("#")
            ) {
              const leadingWs = bodyLine.match(/^[ \t]+/)?.[0];
              if (leadingWs && leadingWs.length > lastTopClass.classIndent.length) {
                memberIndent = leadingWs;
              }
              break;
            }
          }
          const indentedSnippet = indentCode(emitted, memberIndent);
          const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeBracePos);
          if (lineStartBeforeClose >= lastTopClass.openBrace) {
            const insertPos = lineStartBeforeClose + 1;
            const beforeCloseTrimmed = nativeSource
              .slice(lastTopClass.openBrace + 1, insertPos)
              .trim();
            const sepBefore = beforeCloseTrimmed.length > 0 ? "\n" : "";
            return {
              symbol: anchorSymbol,
              startOffset: insertPos,
              endOffset: insertPos,
              replacement: `${sepBefore}${indentedSnippet}\n`,
              originalSnippet: "",
              newSnippet: indentedSnippet,
            };
          }
          return {
            symbol: anchorSymbol,
            startOffset: closeBracePos,
            endOffset: closeBracePos,
            replacement: `\n${indentedSnippet}\n${lastTopClass.classIndent}`,
            originalSnippet: "",
            newSnippet: indentedSnippet,
          };
        }
      }
    }
    const prefix = nativeSource.length === 0 || nativeSource.endsWith("\n") ? "" : "\n";
    return {
      symbol: anchorSymbol,
      startOffset: nativeSource.length,
      endOffset: nativeSource.length,
      replacement: `${prefix}${emitted}\n`,
      originalSnippet: "",
      newSnippet: emitted,
    };
  }

  const lineRangeMatch = anchorSymbol.trim().match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i);
  if (lineRangeMatch) {
    return resolveLineRangeNativeEdit(
      nativeSource,
      options,
      anchorSymbol,
      rawSnippet,
      lineRangeMatch,
      filePath,
      targetLang,
      idioms,
    );
  }

  const preferAccessor: "get" | "set" | undefined =
    /^\s*(?:pub\s+|public\s+|private\s+|protected\s+)?get\b/.test(rawSnippet)
      ? "get"
      : /^\s*(?:pub\s+|public\s+|private\s+|protected\s+)?set\b/.test(rawSnippet)
        ? "set"
        : undefined;

  const preferredArity =
    options.code && !options.insertAfter && !options.insertBefore && !options.append
      ? inferSnippetParamArity(options.code)
      : undefined;
  let spanInfo =
    (targetLang === "markdown" ||
      targetLang === "shell" ||
      targetLang === "powershell" ||
      targetLang === "batch") &&
    !options.insertBefore &&
    !options.insertAfter
      ? enrichSpanWithOffsetsAndLines(
          nativeSource,
          locateScriptOrMarkdownSpan(nativeSource, anchorSymbol, targetLang, true),
        )
      : locateNativeDeclarationSpan(
          nativeSource,
          anchorSymbol,
          targetLang,
          undefined,
          preferAccessor,
          preferredArity,
          true,
        );
  let autoAppendToClass = false;

  if (!spanInfo && !options.delete && !options.insertBefore && !options.insertAfter) {
    const trimmedAnchor = anchorSymbol.trim();
    if (targetLang === "markdown" && rawSnippet.trim()) {
      const headingPrefix = trimmedAnchor.startsWith("#") ? trimmedAnchor : `## ${trimmedAnchor}`;
      const bodyTrimmed = rawSnippet.trim();
      const emitted = /^#{1,6}\s+/.test(bodyTrimmed)
        ? bodyTrimmed
        : `${headingPrefix}\n${bodyTrimmed}`;
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emitted}\n`,
        originalSnippet: "",
        newSnippet: emitted,
      };
    }
    if (
      (targetLang === "shell" || targetLang === "powershell" || targetLang === "batch") &&
      rawSnippet.trim() &&
      extractScriptOrMarkdownSymbols(rawSnippet, targetLang).length > 0
    ) {
      const emitted = rawSnippet.trim();
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emitted}\n`,
        originalSnippet: "",
        newSnippet: emitted,
      };
    }
    const plusMatch = trimmedAnchor.match(/^([A-Za-z_$][A-Za-z0-9_$]*)\+$/);
    const dotIdx = trimmedAnchor.indexOf(".");
    const scopeIdx = trimmedAnchor.indexOf("::");
    const candidateClassName = plusMatch
      ? plusMatch[1]
      : dotIdx > 0
        ? trimmedAnchor.slice(0, dotIdx).trim()
        : scopeIdx > 0
          ? trimmedAnchor.slice(0, scopeIdx).trim()
          : undefined;
    if (candidateClassName) {
      const classSpan = locateNativeDeclarationSpan(nativeSource, candidateClassName, targetLang);
      if (classSpan && classSpan.isClassContainer) {
        spanInfo = classSpan;
        autoAppendToClass = true;
      } else if (targetLang === "cpp" && rawSnippet.trim()) {
        const escCls = candidateClassName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const hasCppRefInFile =
          new RegExp(`\\b${escCls}\\b`).test(nativeSource) || /#\s*include\b/.test(nativeSource);
        const emitted = emitNativeSnippetForContext(
          rawSnippet,
          filePath,
          targetLang,
          undefined,
          idioms,
          undefined,
          false,
          undefined,
          forceLosslessPreprocess,
        );
        if (hasCppRefInFile && new RegExp(`\\b${escCls}\\s*::`).test(emitted)) {
          const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
          return {
            symbol: anchorSymbol,
            startOffset: nativeSource.length,
            endOffset: nativeSource.length,
            replacement: `${sep}${emitted}\n`,
            originalSnippet: "",
            newSnippet: emitted,
          };
        }
      }
    }
  }

  if (!spanInfo) {
    const appendHint = !options.delete
      ? ` (to append a new top-level declaration, use '=== ${path.basename(filePath)}:eof ===' or '=== ${path.basename(filePath)}:<existingSymbol> --insert-after ===')`
      : "";
    throw new Error(
      `Symbol '${anchorSymbol}' not found in ${filePath}${didYouMeanSymbol(nativeSource, anchorSymbol)}${appendHint}`,
    );
  }
  const originalSnippet = nativeSource.slice(spanInfo.declStart, spanInfo.declEnd);

  if (options.delete) {
    const delStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
    const delEnd = spanInfo.declEnd;
    return {
      symbol: anchorSymbol,
      startOffset: delStart,
      endOffset: delEnd,
      replacement: "",
      originalSnippet,
      newSnippet: "",
    };
  }

  if (options.insertBefore || options.insertAfter) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "inserting into native file");
    }
    const emittedUnindented = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      { ...spanInfo, origHeader: undefined },
      idioms,
      undefined,
      false,
      spanInfo.className,
      forceLosslessPreprocess,
    );
    const newSnippet = indentCode(emittedUnindented, spanInfo.declIndent);
    if (options.insertBefore) {
      const insStart = spanInfo.fullDeclStart ?? spanInfo.declStart;
      return {
        symbol: anchorSymbol,
        startOffset: insStart,
        endOffset: insStart,
        replacement: `${newSnippet}\n\n`,
        originalSnippet,
        newSnippet,
      };
    }
    return {
      symbol: anchorSymbol,
      startOffset: spanInfo.declEnd,
      endOffset: spanInfo.declEnd,
      replacement: `\n\n${newSnippet}`,
      originalSnippet,
      newSnippet,
    };
  }

  if ((options.append || autoAppendToClass) && spanInfo.isClassContainer) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to class in native file");
    }
    if (targetLang === "go" && /^\s*(?:func|pub\s+fn|fn|@fn|\^fn)\b/m.test(rawSnippet)) {
      const clsName = spanInfo.memberName;
      const recvRe = new RegExp(
        `^\\s*func\\s*\\(\\s*([A-Za-z0-9_]+\\s+\\*?${clsName})\\s*\\)`,
        "m",
      );
      const recvMatch = recvRe.exec(nativeSource);
      const inferredRecv = recvMatch?.[1]
        ? `(${recvMatch[1]})`
        : `(${clsName[0].toLowerCase()} *${clsName})`;
      let emittedGo = emitNativeSnippetForContext(
        rawSnippet,
        filePath,
        targetLang,
        { ...spanInfo, goReceiver: inferredRecv },
        idioms,
        undefined,
        false,
        clsName,
        forceLosslessPreprocess,
      );
      if (/^\s*func\s+[A-Za-z0-9_]+\s*\(/.test(emittedGo)) {
        emittedGo = emittedGo.replace(/^(\s*func\s+)([A-Za-z0-9_]+\s*\()/, `$1${inferredRecv} $2`);
      }
      const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
      return {
        symbol: anchorSymbol,
        startOffset: nativeSource.length,
        endOffset: nativeSource.length,
        replacement: `${sep}${emittedGo}\n`,
        originalSnippet,
        newSnippet: emittedGo,
      };
    }
    if (
      targetLang === "rust" &&
      /^\s*(?:#\[[^\]]+\]\s*)*(?:pub(?:\([^)]*\))?\s+|@fn\s+|\^fn\s+|async\s+|const\s+|unsafe\s+)*fn\b/m.test(
        rawSnippet,
      )
    ) {
      const clsName = spanInfo.memberName;
      const emittedUnindented = emitNativeSnippetForContext(
        rawSnippet,
        filePath,
        targetLang,
        undefined,
        idioms,
        undefined,
        false,
        clsName,
        forceLosslessPreprocess,
      );
      const lines = nativeSource.split("\n");
      let lineOff = 0;
      let implOpenBrace = -1;
      let implIndent = "";
      for (const l of lines) {
        const inherentMatch = new RegExp(
          `^([ \\t]*)impl(?:\\s*<[^>]*>)?\\s+${clsName}\\b(?![^{]*\\bfor\\b)`,
        ).exec(l);
        const traitMatch = new RegExp(
          `^([ \\t]*)impl(?:\\s*<[^>]*>)?\\s+[^{]+\\bfor\\s+${clsName}\\b`,
        ).exec(l);
        const m = inherentMatch || (implOpenBrace < 0 ? traitMatch : null);
        if (m) {
          const ob = nativeSource.indexOf("{", lineOff);
          if (ob >= 0) {
            implOpenBrace = ob;
            implIndent = m[1];
            if (inherentMatch) break;
          }
        }
        lineOff += l.length + 1;
      }
      if (implOpenBrace >= 0) {
        const implEnd = findMatchingBraceEnd(nativeSource, implOpenBrace, "rust");
        const memberIndent = `${implIndent}    `;
        const newSnippet = indentCode(emittedUnindented, memberIndent);
        const closeBracePos = nativeSource.lastIndexOf("}", implEnd);
        const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeBracePos);
        const insertPos =
          lineStartBeforeClose >= implOpenBrace ? lineStartBeforeClose + 1 : closeBracePos;
        return {
          symbol: anchorSymbol,
          startOffset: insertPos,
          endOffset: insertPos,
          replacement: `\n${newSnippet}\n`,
          originalSnippet: nativeSource.slice(implOpenBrace, implEnd),
          newSnippet,
        };
      }
      const memberIndent = `${spanInfo.declIndent}    `;
      const newSnippet = indentCode(emittedUnindented, memberIndent);
      const implBlock = `${spanInfo.declIndent}impl ${clsName} {\n${newSnippet}\n${spanInfo.declIndent}}`;
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n\n${implBlock}`,
        originalSnippet,
        newSnippet: implBlock,
      };
    }
    const memberIndent =
      targetLang === "python" ||
      targetLang === "rust" ||
      targetLang === "csharp" ||
      targetLang === "kotlin" ||
      targetLang === "php"
        ? `${spanInfo.declIndent}    `
        : `${spanInfo.declIndent}  `;
    const emittedUnindented = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      spanInfo.memberName,
      forceLosslessPreprocess,
    );
    const newSnippet = indentCode(emittedUnindented, memberIndent);
    if (targetLang === "python") {
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n\n${newSnippet}`,
        originalSnippet,
        newSnippet,
      };
    }
    if (targetLang === "aipl") {
      const trimmedOrig = originalSnippet.trimStart();
      const origWithoutLastLineCmt = originalSnippet.replace(/\s*\/\/[^\n]*$/, "");
      if (
        /^(?:pub\s+)?struct\s+[A-Za-z0-9_]+\s*\(/.test(trimmedOrig) &&
        origWithoutLastLineCmt.trimEnd().endsWith(")")
      ) {
        const closeSearchEnd = spanInfo.declStart + origWithoutLastLineCmt.length;
        const closeParenPos = nativeSource.lastIndexOf(")", closeSearchEnd);
        if (!originalSnippet.includes("\n") && closeParenPos > spanInfo.declStart) {
          const openParenPos = nativeSource.indexOf("(", spanInfo.declStart);
          const inner =
            openParenPos >= 0 ? nativeSource.slice(openParenPos + 1, closeParenPos).trim() : "";
          const inlineField = emittedUnindented
            .trim()
            .replace(/^val\s+/, "")
            .replace(/,\s*$/, "");
          const sep = inner.length > 0 && !inner.endsWith(",") ? ", " : "";
          return {
            symbol: anchorSymbol,
            startOffset: closeParenPos,
            endOffset: closeParenPos,
            replacement: `${sep}${inlineField}`,
            originalSnippet,
            newSnippet: inlineField,
          };
        }
        const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeParenPos);
        if (lineStartBeforeClose >= spanInfo.declStart) {
          let prevEnd = lineStartBeforeClose;
          while (
            prevEnd > spanInfo.declStart &&
            (nativeSource[prevEnd - 1] === "\r" ||
              nativeSource[prevEnd - 1] === " " ||
              nativeSource[prevEnd - 1] === "\t")
          ) {
            prevEnd--;
          }
          const needsComma =
            prevEnd > spanInfo.declStart &&
            nativeSource[prevEnd - 1] !== "," &&
            nativeSource[prevEnd - 1] !== "(";
          return {
            symbol: anchorSymbol,
            startOffset: prevEnd,
            endOffset: lineStartBeforeClose,
            replacement: `${needsComma ? "," : ""}\n${newSnippet}`,
            originalSnippet,
            newSnippet,
          };
        }
      }
      return {
        symbol: anchorSymbol,
        startOffset: spanInfo.declEnd,
        endOffset: spanInfo.declEnd,
        replacement: `\n${newSnippet}`,
        originalSnippet,
        newSnippet,
      };
    }
    const closeBracePos = nativeSource.lastIndexOf("}", spanInfo.declEnd);
    if (closeBracePos < spanInfo.declStart) {
      let bodyStartPos = spanInfo.declEnd;
      while (
        bodyStartPos > spanInfo.declStart &&
        (nativeSource[bodyStartPos - 1] === "\n" ||
          nativeSource[bodyStartPos - 1] === "\r" ||
          nativeSource[bodyStartPos - 1] === " " ||
          nativeSource[bodyStartPos - 1] === "\t")
      ) {
        bodyStartPos--;
      }
      const trailingSemi =
        bodyStartPos > spanInfo.declStart && nativeSource[bodyStartPos - 1] === ";";
      const repStart = trailingSemi ? bodyStartPos - 1 : bodyStartPos;
      return {
        symbol: anchorSymbol,
        startOffset: repStart,
        endOffset: bodyStartPos,
        replacement: ` {\n${newSnippet}\n${spanInfo.declIndent}}${trailingSemi ? ";" : ""}`,
        originalSnippet,
        newSnippet,
      };
    }
    const lineStartBeforeClose = nativeSource.lastIndexOf("\n", closeBracePos);
    const insertPos =
      lineStartBeforeClose >= spanInfo.declStart ? lineStartBeforeClose + 1 : closeBracePos;
    return {
      symbol: anchorSymbol,
      startOffset: insertPos,
      endOffset: insertPos,
      replacement: `\n${newSnippet}\n`,
      originalSnippet,
      newSnippet,
    };
  }

  if (!rawSnippet.trim()) {
    throw buildEmptySpliceBlockError(filePath, anchorSymbol, "splicing native file");
  }

  if (containsHunkMarkers(rawSnippet)) {
    const hunks = extractHunkBlocks(rawSnippet);
    if (hunks.length > 0) {
      let hunkScopeStart = spanInfo.declStart;
      while (
        hunkScopeStart > 0 &&
        (nativeSource[hunkScopeStart - 1] === " " || nativeSource[hunkScopeStart - 1] === "\t")
      ) {
        hunkScopeStart--;
      }
      if (hunkScopeStart > 0 && nativeSource[hunkScopeStart - 1] !== "\n") {
        hunkScopeStart = spanInfo.declStart;
      }
      const lineAlignedScope = nativeSource.slice(hunkScopeStart, spanInfo.declEnd);
      const symIdiomsOn =
        options.idioms !== false &&
        (options.idioms === true || Boolean(idioms && Object.keys(idioms).length > 0));
      const symStartLine = nativeSource.slice(0, hunkScopeStart).split("\n").length;
      const updatedSymbolScope = applyHunksToScope(
        lineAlignedScope,
        hunks,
        anchorSymbol,
        filePath,
        targetLang,
        idioms,
        symIdiomsOn,
        spanInfo.isClassContainer ? "container" : spanInfo.className ? "member" : false,
        symStartLine,
        { nativeSource, scopeStartOffset: hunkScopeStart, scopeEndOffset: spanInfo.declEnd },
      );
      return {
        symbol: anchorSymbol,
        startOffset: hunkScopeStart,
        endOffset: spanInfo.declEnd,
        replacement: updatedSymbolScope,
        originalSnippet: lineAlignedScope,
        newSnippet: updatedSymbolScope,
      };
    }
  }

  const { cleanedCode } = extractInlineIdiomsFromSource(rawSnippet);
  const trimmedClean = cleanedCode.trimStart();
  const isAiceComp = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*(?:pub\s+)?component\b/m.test(
    trimmedClean,
  );
  const hasLeadingNativeAttr =
    /^(?:@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]|#\[|\[[A-Za-z_]|template\s*<)/.test(trimmedClean);

  const replaceStart = isAiceComp
    ? (spanInfo.propsDeclStart ?? spanInfo.declStart)
    : hasLeadingNativeAttr
      ? (spanInfo.fullDeclStart ?? spanInfo.declStart)
      : spanInfo.declStart;

  const isBodyOnly = options.body !== undefined && options.code === undefined;
  const emittedUnindented = emitNativeSnippetForContext(
    rawSnippet,
    filePath,
    targetLang,
    spanInfo,
    idioms,
    originalSnippet,
    isBodyOnly,
    spanInfo.className,
    forceLosslessPreprocess,
  );

  let newSnippet = indentCode(emittedUnindented, spanInfo.declIndent);
  if (spanInfo.memberName === "imports") {
    const fileNl = nativeSource.includes("\r\n") ? "\r\n" : "\n";
    const replaceAllImports = /@(?:replace|overwrite)-imports\b/.test(rawSnippet);
    if (spanInfo.declStart === spanInfo.declEnd) {
      const afterInsert = nativeSource.slice(spanInfo.declEnd);
      const sepAfter =
        afterInsert.length === 0
          ? fileNl
          : /^\r?\n/.test(afterInsert)
            ? fileNl
            : `${fileNl}${fileNl}`;
      newSnippet = `${newSnippet.trimEnd()}${sepAfter}`;
    } else if (
      !replaceAllImports &&
      (targetLang === "typescript" || targetLang === "javascript" || targetLang === "tsx")
    ) {
      interface TsImportEntry {
        leadingTrivia: string;
        codeText: string;
        text: string;
        spec?: string;
        isTypeOnly: boolean;
      }
      const parseTsImportEntries = (
        src: string,
      ): { entries: TsImportEntry[]; trailingAfterLast: string } => {
        const parsedSf = getCachedTsSourceFile(src);
        const importNodes = parsedSf.statements.filter(
          (st): st is ts.ImportDeclaration | ts.ImportEqualsDeclaration =>
            ts.isImportDeclaration(st) || ts.isImportEqualsDeclaration(st),
        );
        const entries: TsImportEntry[] = [];
        let cursor = 0;
        for (let idx = 0; idx < importNodes.length; idx++) {
          const st = importNodes[idx];
          const tokStart = st.getStart(parsedSf, false);
          const lineStart = src.lastIndexOf("\n", tokStart - 1) + 1;
          const stmtCodeStart =
            lineStart >= cursor && /^[ \t]*$/.test(src.slice(lineStart, tokStart))
              ? lineStart
              : tokStart;
          let rawLeading = src.slice(cursor, stmtCodeStart);
          if (idx === 0) {
            rawLeading = rawLeading.replace(/^(?:[ \t]*\r?\n)+/, "");
          }
          const leadingTrivia = rawLeading.replace(/\r?\n/g, fileNl);

          const nextNode = importNodes[idx + 1];
          const nextTokStart = nextNode ? nextNode.getStart(parsedSf, false) : src.length;
          let stmtEnd = st.getEnd();
          while (
            stmtEnd < nextTokStart &&
            stmtEnd < src.length &&
            src[stmtEnd] !== "\n" &&
            src[stmtEnd] !== "\r"
          ) {
            stmtEnd++;
          }
          const codeText = src.slice(stmtCodeStart, stmtEnd).trimEnd().replace(/\r?\n/g, fileNl);
          let nextCursor = stmtEnd;
          if (src[nextCursor] === "\r") nextCursor++;
          if (src[nextCursor] === "\n") nextCursor++;
          cursor = nextCursor;

          const spec = ts.isImportDeclaration(st)
            ? ts.isStringLiteral(st.moduleSpecifier)
              ? st.moduleSpecifier.text
              : undefined
            : st.name.text;
          const isTypeOnly = ts.isImportDeclaration(st)
            ? Boolean(st.importClause?.isTypeOnly)
            : st.isTypeOnly;
          entries.push({
            leadingTrivia,
            codeText,
            text: `${leadingTrivia}${codeText}`,
            spec,
            isTypeOnly,
          });
        }
        const rawRest = src.slice(cursor).replace(/(?:\r?\n)+$/, "");
        const trailingAfterLast = rawRest.trim()
          ? `${fileNl}${rawRest.replace(/\r?\n/g, fileNl)}`
          : "";
        return { entries, trailingAfterLast };
      };
      const { entries: origEntries, trailingAfterLast } = parseTsImportEntries(originalSnippet);
      const { entries: newEntries } = parseTsImportEntries(newSnippet);
      if (
        origEntries.length >= 1 &&
        newEntries.length >= 1 &&
        newEntries.every((e) => Boolean(e.spec))
      ) {
        const merged = [...origEntries];
        for (const ne of newEntries) {
          let existingIdx = merged.findIndex(
            (oe) => oe.spec === ne.spec && oe.isTypeOnly === ne.isTypeOnly,
          );
          if (existingIdx < 0) {
            const sameSpecIdxs = merged
              .map((oe, i) => (oe.spec === ne.spec ? i : -1))
              .filter((i) => i >= 0);
            if (
              sameSpecIdxs.length === 1 &&
              newEntries.filter((x) => x.spec === ne.spec).length === 1 &&
              !ne.isTypeOnly &&
              !merged[sameSpecIdxs[0]]?.isTypeOnly
            ) {
              existingIdx = sameSpecIdxs[0] ?? -1;
            }
          }
          if (existingIdx >= 0) {
            const prevEntry = merged[existingIdx];
            const preservedLeading =
              ne.leadingTrivia.trim().length > 0
                ? ne.leadingTrivia
                : (prevEntry?.leadingTrivia ?? "");
            merged[existingIdx] = {
              ...ne,
              leadingTrivia: preservedLeading,
              text: `${preservedLeading}${ne.codeText}`,
            };
          } else {
            merged.push(ne);
          }
        }
        const trailingNl = originalSnippet.endsWith("\r\n")
          ? "\r\n"
          : originalSnippet.endsWith("\n")
            ? "\n"
            : "";
        newSnippet = `${merged.map((m) => m.text).join(fileNl)}${trailingAfterLast}${trailingNl}`;
      }
    } else if (!replaceAllImports && originalSnippet.trim().length > 0) {
      const origImportLines = originalSnippet
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);
      const newImportLines = newSnippet
        .split(/\r?\n/)
        .map((l) => l.trimEnd())
        .filter((l) => l.trim().length > 0);
      if (origImportLines.length >= 1 && newImportLines.length >= 1) {
        const mergedLines = [...origImportLines];
        for (const nl of newImportLines) {
          if (!mergedLines.some((ol) => ol.trim() === nl.trim())) {
            mergedLines.push(nl);
          }
        }
        const trailingNl = originalSnippet.endsWith("\r\n")
          ? "\r\n"
          : originalSnippet.endsWith("\n")
            ? "\n"
            : "";
        newSnippet = `${mergedLines.join(fileNl)}${trailingNl}`;
      }
    }
  }

  const trivia = extractDeclarationTriviaLens(
    nativeSource,
    {
      fullStart: spanInfo.fullDeclStart ?? spanInfo.declStart,
      declStart: spanInfo.declStart,
      end: spanInfo.declEnd,
    },
    targetLang,
  );

  let finalReplaceStart = replaceStart;
  let preservedTriviaText = "";

  const trimmedNew = newSnippet.trimStart();
  const hasNewDoc =
    trimmedNew.startsWith("/**") || trimmedNew.startsWith("///") || trimmedNew.startsWith("//!");
  const hasReplaceDocsDirective =
    options.preserveDocs === false ||
    /(?:^|\n)\s*(?:(?:\/\/|#)\s*)?@(?:replace|strip|drop)-docs\b/.test(rawSnippet) ||
    /(?:^|\n)\s*(?:(?:\/\/|#)\s*)?@(?:replace|strip|drop)-docs\b/.test(newSnippet);

  if (targetLang !== "python") {
    if (!hasNewDoc && !hasReplaceDocsDirective) {
      preservedTriviaText = trivia.leadingDocComment ?? "";
    } else if (hasNewDoc || trivia.leadingDocComment || hasReplaceDocsDirective) {
      let docStartPos: number | undefined;
      if (trivia.leadingDocComment) {
        const beforeDecl = nativeSource.slice(0, spanInfo.declStart);
        const oldDocIdx = beforeDecl.lastIndexOf(trivia.leadingDocComment);
        if (oldDocIdx >= 0) {
          const docLineStart = nativeSource.lastIndexOf("\n", oldDocIdx - 1) + 1;
          const leadingWs = nativeSource.slice(docLineStart, oldDocIdx);
          docStartPos = /^[ \t]*$/.test(leadingWs) ? docLineStart : oldDocIdx;
        }
      }
      if (
        docStartPos === undefined &&
        spanInfo.fullDeclStart !== undefined &&
        spanInfo.fullDeclStart < spanInfo.declStart
      ) {
        docStartPos = spanInfo.fullDeclStart;
      }
      if (docStartPos === undefined) {
        const prefixBefore = nativeSource.slice(0, spanInfo.declStart);
        const matchPrevDoc = prefixBefore.match(
          /(?:\/\*\*[\s\S]*?\*\/|(?:[ \t]*(?:\/\/\/|\/\/!)[^\n]*\r?\n)+)[ \t]*$/,
        );
        if (matchPrevDoc && matchPrevDoc.index !== undefined) {
          const docStart = matchPrevDoc.index;
          const docLineStart = nativeSource.lastIndexOf("\n", docStart - 1) + 1;
          const leadingWs = nativeSource.slice(docLineStart, docStart);
          docStartPos = /^[ \t]*$/.test(leadingWs) ? docLineStart : docStart;
        }
      }

      if (docStartPos !== undefined && docStartPos < finalReplaceStart) {
        if (trivia.leadingDocComment) {
          const oldDocIdx = nativeSource.indexOf(trivia.leadingDocComment, docStartPos);
          if (oldDocIdx >= 0) {
            const docEnd = oldDocIdx + trivia.leadingDocComment.length;
            const between = nativeSource.slice(docEnd, spanInfo.declStart);
            const hasDecoratorsBetween = /^[ \t\r\n]*@(?!fn\b|cls\b|type\b|idiom\b)[A-Za-z_]/.test(
              between,
            );
            if (hasDecoratorsBetween && !hasLeadingNativeAttr && !trimmedNew.startsWith("@")) {
              const decoratorsSlice = between.replace(/^\r?\n/, "");
              const newDocMatch = newSnippet.match(
                /^(?:[ \t]*\/\*\*[\s\S]*?\*\/\r?\n|[ \t]*(?:\/\/\/|\/\/!)[^\n]*\r?\n)+/,
              );
              if (newDocMatch) {
                const afterDoc = newSnippet.slice(newDocMatch[0].length);
                newSnippet = `${newDocMatch[0]}${decoratorsSlice}${afterDoc}`;
              } else {
                newSnippet = `${decoratorsSlice}${newSnippet}`;
              }
            }
          }
        }
        finalReplaceStart = docStartPos;
      }

      const applied = applyTriviaLensToReplacement(trivia, newSnippet, {
        preserveDocs: false,
        lang: targetLang,
      });
      newSnippet = applied.mergedSnippet;
      preservedTriviaText = "";
    }
  } else if (trivia.leadingDocComment || hasReplaceDocsDirective) {
    const applied = applyTriviaLensToReplacement(trivia, newSnippet, {
      preserveDocs: hasReplaceDocsDirective ? false : options.preserveDocs,
      lang: targetLang,
    });
    newSnippet = applied.mergedSnippet;
    preservedTriviaText = applied.preservedTriviaText;
  }
  return {
    symbol: anchorSymbol,
    startOffset: finalReplaceStart,
    endOffset: spanInfo.declEnd,
    replacement:
      targetLang === "aipl" &&
      !originalSnippet.includes("\n") &&
      originalSnippet.trimEnd().endsWith(",") &&
      !newSnippet.includes("\n") &&
      !newSnippet.trimEnd().endsWith(",")
        ? `${newSnippet.trimEnd()},`
        : newSnippet,
    originalSnippet,
    newSnippet,
    preservedTriviaText,
  };
}

export function spliceNativeSource(
  rawNativeSource: string,
  rawOptions: SpliceOptions,
  filePath: string,
  idioms?: Record<string, ProjectIdiomDefinition>,
  forceLosslessPreprocess = false,
): SpliceResult {
  const nativeSource =
    typeof rawNativeSource === "string" ? rawNativeSource : String(rawNativeSource ?? "");
  let options: SpliceOptions = rawOptions ?? {};
  const targetLang = resolveEffectiveSpliceTargetLang(
    filePath,
    nativeSource,
    options.targetLanguage,
  );
  if (
    options.symbol === "@first" ||
    options.symbol === "@1" ||
    options.insertAfter === "@first" ||
    options.insertAfter === "@1" ||
    options.insertBefore === "@first" ||
    options.insertBefore === "@1"
  ) {
    try {
      const decomp = decompile(nativeSource, targetLang, { filePath });
      const firstSym = resolveFirstActionableSymbol(decomp.aice, filePath);
      if (firstSym) {
        options = {
          ...options,
          symbol:
            options.symbol === "@first" || options.symbol === "@1" ? firstSym : options.symbol,
          insertAfter:
            options.insertAfter === "@first" || options.insertAfter === "@1"
              ? firstSym
              : options.insertAfter,
          insertBefore:
            options.insertBefore === "@first" || options.insertBefore === "@1"
              ? firstSym
              : options.insertBefore,
        };
      }
    } catch {
      // fall through
    }
  }
  const isLineRange =
    Boolean(options.symbol?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.insertAfter?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.insertBefore?.match(/^\[?L?(\d+)(?:-L?(\d+))?\]?$/i)) ||
    Boolean(options.edits?.some((e) => /^\[?L?(\d+)(?:-L?(\d+))?\]?$/i.test(e.symbol)));

  if (
    !isLineRange &&
    (targetLang === "css" ||
      targetLang === "json" ||
      targetLang === "yaml" ||
      targetLang === "html" ||
      targetLang === "twig")
  ) {
    const dialectRes = spliceDialectNativeSource(
      nativeSource,
      options,
      filePath,
      targetLang,
      idioms,
    );
    if (dialectRes) return dialectRes;
  }

  if (options.edits && options.edits.length > 0) {
    const resolvedEdits: ResolvedNativeEdit[] = [];
    for (const edit of options.edits) {
      if (!edit || typeof edit !== "object") {
        throw new Error(`Invalid splice edit entry in ${filePath}: expected edit object`);
      }
      const editCode =
        edit.code ?? edit.aice ?? edit.template ?? edit.snippet ?? edit.content ?? edit.replacement;
      const singleOpt: SpliceOptions = {
        ...options,
        edits: undefined,
        symbol: edit.symbol,
        code: editCode,
        body: edit.body,
        delete: edit.delete,
        cloneFrom: edit.cloneFrom,
        preserveDocs: edit.preserveDocs ?? options.preserveDocs,
        insertAfter: edit.insertAfter ?? edit.insert_after,
        insertBefore: edit.insertBefore ?? edit.insert_before,
      };
      resolvedEdits.push(
        resolveSingleNativeEditAgainstSource(
          nativeSource,
          singleOpt,
          filePath,
          targetLang,
          idioms,
          forceLosslessPreprocess,
        ),
      );
    }

    // Sort in reverse offset order (bottom-to-top) so earlier edits never shift later offsets;
    // when two zero-width insertions share the exact same offset, apply later stream items first
    // so the final file preserves top-to-bottom stream order.
    const indexedEdits = resolvedEdits.map((edit, idx) => ({ edit, idx }));
    const sortedReverse = indexedEdits
      .sort(
        (a, b) =>
          b.edit.startOffset - a.edit.startOffset ||
          b.edit.endOffset - a.edit.endOffset ||
          b.idx - a.idx,
      )
      .map((entry) => entry.edit);

    const hasOverlap = sortedReverse.some(
      (e, i) => i < sortedReverse.length - 1 && e.startOffset < sortedReverse[i + 1].endOffset,
    );

    let modifiedCode = nativeSource;
    if (hasOverlap) {
      const sequentialResolved: ResolvedNativeEdit[] = [];
      for (const edit of options.edits) {
        const editCode =
          edit.code ??
          edit.aice ??
          edit.template ??
          edit.snippet ??
          edit.content ??
          edit.replacement;
        const singleOpt: SpliceOptions = {
          ...options,
          edits: undefined,
          symbol: edit.symbol,
          code: editCode,
          body: edit.body,
          delete: edit.delete,
          cloneFrom: edit.cloneFrom,
          preserveDocs: edit.preserveDocs ?? options.preserveDocs,
          insertAfter: edit.insertAfter ?? edit.insert_after,
          insertBefore: edit.insertBefore ?? edit.insert_before,
        };
        const stepEdit = resolveSingleNativeEditAgainstSource(
          modifiedCode,
          singleOpt,
          filePath,
          targetLang,
          idioms,
          forceLosslessPreprocess,
        );
        sequentialResolved.push(stepEdit);
        modifiedCode = `${modifiedCode.slice(0, stepEdit.startOffset)}${stepEdit.replacement}${modifiedCode.slice(stepEdit.endOffset)}`;
      }
      resolvedEdits.splice(0, resolvedEdits.length, ...sequentialResolved);
    } else {
      for (const item of sortedReverse) {
        modifiedCode = `${modifiedCode.slice(0, item.startOffset)}${item.replacement}${modifiedCode.slice(item.endOffset)}`;
      }
    }

    {
      const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
      if (!checkRes.valid) {
        if (!forceLosslessPreprocess) {
          return spliceNativeSource(nativeSource, options, filePath, idioms, true);
        }
        if (validateNativeSyntax(nativeSource, targetLang, filePath).valid && !options.force) {
          const span = computeOriginalEditLineSpan(
            nativeSource,
            modifiedCode,
            options.edits.map((e) => e.symbol).join(", "),
          );
          const ctx = formatSurroundingNumberedContext(
            nativeSource,
            span.startLine,
            span.endLine,
            5,
          );
          const ctxSuffix = ctx
            ? `\nContext around L${span.startLine}-L${span.endLine} (±5 lines):\n${ctx}`
            : "";
          throw new Error(
            `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${checkRes.diagnostics.slice(0, 3).join("; ")}${ctxSuffix}`,
          );
        }
      }
    }

    const diff = options.diff
      ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
      : undefined;
    const editedSymbols = options.edits.map((e) => e.symbol).join(", ");
    const combinedNewSnippets = resolvedEdits.map((e) => e.newSnippet).join("\n\n");
    const combinedInputSnippets = options.edits
      .map(
        (e) =>
          e.code ?? e.body ?? e.aice ?? e.template ?? e.snippet ?? e.content ?? e.replacement ?? "",
      )
      .filter(Boolean)
      .join("\n\n");
    const snippetTokens = estimateTokens(
      combinedInputSnippets || combinedNewSnippets || JSON.stringify(options.edits),
    );
    const modifiedTokens = estimateTokens(modifiedCode);
    const totalPreservedTriviaTokens = resolvedEdits.reduce(
      (sum, e) => sum + (e.preservedTriviaText ? estimateTokens(e.preservedTriviaText) : 0),
      0,
    );
    const realisticNativePayload = JSON.stringify(
      resolvedEdits.map((e) => ({
        path: filePath,
        old_string: e.originalSnippet ?? "",
        new_string: e.newSnippet ?? "",
      })),
    );
    const realisticTokensSaved = estimateTokens(realisticNativePayload) - snippetTokens;
    return {
      success: true,
      filePath,
      symbol: editedSymbols,
      originalSnippet: resolvedEdits.map((e) => e.originalSnippet).join("\n\n"),
      newSnippet: combinedNewSnippets,
      diff,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: modifiedTokens - snippetTokens,
      preservedTriviaTokens: totalPreservedTriviaTokens,
      realisticTokensSaved,
    };
  }

  const anchorSymbol = options.insertAfter ?? options.insertBefore ?? options.symbol;
  const rawSnippet = options.code ?? options.body ?? "";

  // Module-level append without --symbol
  if (options.append && !anchorSymbol) {
    if (!rawSnippet.trim()) {
      throw buildEmptySpliceBlockError(filePath, anchorSymbol, "appending to native file");
    }
    const emitted = emitNativeSnippetForContext(
      rawSnippet,
      filePath,
      targetLang,
      undefined,
      idioms,
      undefined,
      false,
      undefined,
      forceLosslessPreprocess,
    );
    const sep = nativeSource.endsWith("\n") ? "\n" : "\n\n";
    const modifiedCode = `${nativeSource}${sep}${emitted}\n`;
    {
      const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
      if (!checkRes.valid) {
        if (!forceLosslessPreprocess) {
          return spliceNativeSource(nativeSource, options, filePath, idioms, true);
        }
        if (validateNativeSyntax(nativeSource, targetLang, filePath).valid && !options.force) {
          const span = computeOriginalEditLineSpan(nativeSource, modifiedCode, anchorSymbol);
          const ctx = formatSurroundingNumberedContext(
            nativeSource,
            span.startLine,
            span.endLine,
            5,
          );
          const ctxSuffix = ctx
            ? `\nContext around L${span.startLine}-L${span.endLine} (±5 lines):\n${ctx}`
            : "";
          throw new Error(
            `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${checkRes.diagnostics.slice(0, 3).join("; ")}${ctxSuffix}`,
          );
        }
      }
    }
    const diff = options.diff
      ? generateUnifiedDiff(filePath, nativeSource, modifiedCode)
      : undefined;
    const snippetTokens = estimateTokens(rawSnippet || emitted);
    const modifiedTokens = estimateTokens(modifiedCode);
    const realisticNativePayload = JSON.stringify({
      path: filePath,
      old_string: "",
      new_string: emitted,
    });
    const realisticTokensSaved = estimateTokens(realisticNativePayload) - snippetTokens;
    return {
      success: true,
      filePath,
      newSnippet: emitted,
      diff,
      modifiedCode,
      newAiceSource: modifiedCode,
      tokensSaved: modifiedTokens - snippetTokens,
      preservedTriviaTokens: 0,
      realisticTokensSaved,
    };
  }
  const resolved = resolveSingleNativeEditAgainstSource(
    nativeSource,
    options,
    filePath,
    targetLang,
    idioms,
    forceLosslessPreprocess,
  );
  const modifiedCode = `${nativeSource.slice(0, resolved.startOffset)}${resolved.replacement}${nativeSource.slice(resolved.endOffset)}`;

  {
    const checkRes = validateNativeSyntax(modifiedCode, targetLang, filePath, idioms);
    if (!checkRes.valid) {
      if (!forceLosslessPreprocess) {
        return spliceNativeSource(nativeSource, options, filePath, idioms, true);
      }
      if (validateNativeSyntax(nativeSource, targetLang, filePath).valid && !options.force) {
        const span = computeOriginalEditLineSpan(
          nativeSource,
          modifiedCode,
          resolved.symbol ?? options.symbol,
        );
        const ctx = formatSurroundingNumberedContext(nativeSource, span.startLine, span.endLine, 5);
        const ctxSuffix = ctx
          ? `\nContext around L${span.startLine}-L${span.endLine} (±5 lines):\n${ctx}`
          : "";
        throw new Error(
          `Pre-write syntax validation failed for ${filePath} (${targetLang}): ${checkRes.diagnostics.slice(0, 3).join("; ")}${ctxSuffix}`,
        );
      }
    }
  }

  let diff: string | undefined;
  if (options.diff) {
    diff = generateUnifiedDiff(filePath, nativeSource, modifiedCode);
  }

  const snippetTokens = estimateTokens(rawSnippet || resolved.newSnippet || "");
  const modifiedTokens =
    modifiedCode.length > 50_000
      ? Math.ceil(modifiedCode.length / 3.8)
      : estimateTokens(modifiedCode);
  const tokensSaved = modifiedTokens - snippetTokens;
  const preservedTriviaTokens = resolved.preservedTriviaText
    ? estimateTokens(resolved.preservedTriviaText)
    : 0;
  const realisticNativePayload = options.delete
    ? JSON.stringify({ path: filePath, old_string: resolved.originalSnippet ?? "", new_string: "" })
    : resolved.originalSnippet
      ? JSON.stringify({
          path: filePath,
          old_string: resolved.originalSnippet,
          new_string: resolved.newSnippet ?? rawSnippet,
        })
      : JSON.stringify({ path: filePath, old_string: "", new_string: rawSnippet });
  const realisticTokensSaved = estimateTokens(realisticNativePayload) - snippetTokens;

  const startLine = modifiedCode.slice(0, resolved.startOffset).split("\n").length;
  const endLine = startLine + Math.max(0, resolved.replacement.split("\n").length - 1);

  return {
    success: true,
    filePath,
    symbol: resolved.symbol,
    startLine,
    endLine,
    originalSnippet: resolved.originalSnippet,
    newSnippet: resolved.newSnippet,
    diff,
    modifiedCode,
    newAiceSource: modifiedCode,
    tokensSaved,
    preservedTriviaTokens,
    realisticTokensSaved,
  };
}
