/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * File-target/passthrough/selector predicates and multi-block --stdin splice stream parsing.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  isBinaryExtension,
  isLikelyBinaryDiskFile,
  isUniversalSpliceTargetCandidate,
  KNOWN_TARGET_EXTENSIONS,
} from "../../config/index.js";
import { detectTargetFromPathOrContent, type TargetLanguage } from "../../emitters/index.js";
import { buildEmptySpliceBlockError, containsHunkMarkers } from "./hunks.js";
import type { BatchSpliceItem, ParsedMultiBlockSpliceStream, SymbolSpliceEdit } from "./types.js";

export function isCreateOrOverwriteSymbol(sym: string | undefined): boolean {
  if (!sym) return true;
  const norm = sym.trim().toLowerCase();
  return (
    norm === "" ||
    norm === "*" ||
    norm === "create" ||
    norm === ":create" ||
    norm === "overwrite" ||
    norm === ":overwrite"
  );
}

export function isLineRangeEditSelector(sym?: string): boolean {
  return Boolean(sym && /^\[?:?L\d+(?:\s*(?:-|\.\.|:)\s*L?\d+)?\]?$/i.test(sym.trim()));
}

export function isPassthroughSpliceFile(filePath: string): boolean {
  const clean = filePath.replace(/\\/g, "/");
  if (clean.endsWith(".aice")) return false;
  if (isBinaryExtension(clean)) return false;
  const detected = detectTargetFromPathOrContent(clean);
  if (detected !== "passthrough" && detected !== "text") {
    return false;
  }
  try {
    if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
      return !isLikelyBinaryDiskFile(filePath);
    }
  } catch {
    // ignore stat errors
  }
  return true;
}

export function resolveEffectiveSpliceTargetLang(
  filePath: string,
  source?: string,
  explicitTarget?: TargetLanguage,
): TargetLanguage {
  if (explicitTarget) return explicitTarget;
  const detected = detectTargetFromPathOrContent(filePath, source);
  if (detected !== "passthrough") return detected;
  return "text";
}

export function isSpliceTargetFileCandidate(cand: string, baseDir = process.cwd()): boolean {
  return isUniversalSpliceTargetCandidate(cand, KNOWN_TARGET_EXTENSIONS, baseDir);
}

function isUnambiguousExtensionlessFileWithSelector(
  candFile: string,
  candSym: string,
  sep: string,
): boolean {
  if (sep !== ":") return false;
  const clean = candFile
    .trim()
    .replace(/^['"`]|['"`]$/g, "")
    .replace(/\\/g, "/");
  if (!clean || /\s/.test(clean)) return false;
  if (clean.length > 1 && clean.startsWith("/") && clean.endsWith("/")) return false;
  const base = path.posix.basename(clean);
  if (!base || base.startsWith("-") || !/^[A-Za-z0-9._-]+$/.test(base)) return false;
  return /^(?:L?\d+(?:\s*(?:-|\.\.|:)\s*L?\d+)?|create|overwrite|eof|end|append|hunk|\*)$/i.test(
    candSym.trim(),
  );
}

function looksLikeExplicitPathHeader(rawSpec: string): boolean {
  const clean = rawSpec
    .trim()
    .replace(/^['"`]|['"`]$/g, "")
    .replace(/\\/g, "/");
  if (!clean || (clean.length > 1 && clean.startsWith("/") && clean.endsWith("/"))) return false;
  const driveOffset = /^[A-Za-z]:\//.test(clean) ? 2 : 0;
  const colonIdx = clean.indexOf(":", driveOffset);
  const filePart = (colonIdx > 0 ? clean.slice(0, colonIdx) : clean).trim();
  if (!filePart || /\s/.test(filePart)) return false;
  if (filePart.includes("/")) return true;
  if (isSpliceTargetFileCandidate(filePart)) return true;
  if (colonIdx > 0) {
    const symPart = clean.slice(colonIdx + 1).trim();
    if (isUnambiguousExtensionlessFileWithSelector(filePart, symPart, ":")) return true;
  }
  return false;
}

function isBareSpliceStreamFileHeader(spec: string, defaultFilePath?: string): boolean {
  if (
    !isSpliceTargetFileCandidate(spec) &&
    !(defaultFilePath === undefined && spec.includes("/") && !spec.endsWith("/"))
  ) {
    return false;
  }
  if (!defaultFilePath) return true;
  if (spec.includes("/") || spec.includes("\\")) return true;
  const normSpec = spec.replace(/\\/g, "/");
  const normDefault = defaultFilePath.replace(/\\/g, "/");
  if (
    path.resolve(spec) === path.resolve(defaultFilePath) ||
    path.posix.basename(normSpec) === path.posix.basename(normDefault)
  ) {
    return true;
  }
  if (!path.posix.extname(normSpec)) return false;
  return !/^[A-Z][A-Za-z0-9_]*\.[a-zA-Z0-9_]+$/i.test(spec);
}

export function splitInlineFileSelector(
  rawFilePath: string,
  baseDir = process.cwd(),
): { filePath: string; inlineSelector?: string } {
  const trimmed = rawFilePath.trim();
  if (!trimmed) return { filePath: rawFilePath };
  const fullRaw = path.isAbsolute(trimmed) ? trimmed : path.resolve(baseDir, trimmed);
  if (fs.existsSync(fullRaw)) {
    return { filePath: trimmed };
  }
  const driveOffset = /^[A-Za-z]:[\\/]/.test(trimmed) ? 2 : 0;
  const restAfterDrive = trimmed.slice(driveOffset);
  const sepRe = /:+|#/g;
  let sepMatch: RegExpExecArray | null = sepRe.exec(restAfterDrive);
  while (sepMatch !== null) {
    const splitIdx = driveOffset + sepMatch.index;
    const candFile = trimmed.slice(0, splitIdx).trim();
    const candSym = trimmed.slice(splitIdx + sepMatch[0].length).trim();
    if (
      candFile &&
      candSym &&
      !candSym.startsWith("/") &&
      !candSym.startsWith("\\") &&
      (isSpliceTargetFileCandidate(candFile, baseDir) ||
        isUnambiguousExtensionlessFileWithSelector(candFile, candSym, sepMatch[0]))
    ) {
      return { filePath: candFile, inlineSelector: candSym };
    }
    sepMatch = sepRe.exec(restAfterDrive);
  }
  return { filePath: trimmed };
}

function advanceStreamTripleQuoteState(
  textLine: string,
  curQuote: '"""' | "'''" | null,
  allowSingleTriple: boolean,
): '"""' | "'''" | null {
  let state = curQuote;
  let idx = 0;
  while (idx < textLine.length) {
    if (state === null) {
      if (textLine[idx] === "#" || (textLine[idx] === "/" && textLine[idx + 1] === "/")) {
        break;
      }
      if (textLine[idx] === '"' || textLine[idx] === "'") {
        const q = textLine[idx]!;
        if (
          textLine[idx + 1] === q &&
          textLine[idx + 2] === q &&
          (q === '"' || allowSingleTriple)
        ) {
          state = q === '"' ? '"""' : "'''";
          idx += 3;
          continue;
        }
        idx++;
        while (idx < textLine.length && textLine[idx] !== q) {
          if (textLine[idx] === "\\") idx += 2;
          else idx++;
        }
        idx++;
        continue;
      }
      idx++;
    } else {
      if (textLine[idx] === "\\" && allowSingleTriple) {
        idx += 2;
        continue;
      }
      if (textLine.startsWith(state, idx)) {
        const qChar = state[0]!;
        idx += 3;
        while (idx < textLine.length && textLine[idx] === qChar) idx++;
        state = null;
        continue;
      }
      idx++;
    }
  }
  return state;
}

/**
 * Parses a multi-block splice heredoc/stream delimited by `=== <symbol> ===`,
 * `=== <filePath> ===`, `=== <filePath>:<symbol> ===`, `--- <symbol> ---`, or `// SYMBOL: <symbol>`.
 */
export function parseMultiBlockSpliceStream(
  rawStream: string,
  defaultFilePath?: string,
): ParsedMultiBlockSpliceStream | null {
  if (typeof rawStream !== "string" || !rawStream.trim()) return null;
  const lines = rawStream.split(/\r?\n/);
  const headerRe = /^\s*={3,}\s*([^=\r\n]+?)\s*={3,}(?:\s+(--delete|-d|\(delete\)))?\s*$/i;
  const hasUnindentedHeader = lines.some(
    (l) => !/^\s/.test(l) && !/^\s*={3,}\s*$/.test(l) && headerRe.test(l),
  );

  const preHeaderLines: string[] = [];
  const sections: Array<{
    filePath?: string;
    symbol: string;
    insertAfter?: string;
    insertBefore?: string;
    cloneFrom?: string;
    preserveDocs?: boolean;
    isDelete: boolean;
    lines: string[];
  }> = [];

  let inMdFence = false;
  let mdFenceChar = "";
  let mdFenceLen = 0;
  let inHunkBlock = false;
  let inTripleQuote: '"""' | "'''" | null = null;

  for (const line of lines) {
    const activeFp =
      sections.length > 0
        ? (sections[sections.length - 1].filePath ?? defaultFilePath)
        : defaultFilePath;
    const isMdSection = Boolean(activeFp && /\.(?:md|markdown)$/i.test(activeFp));
    if (isMdSection && sections.length > 0) {
      if (!inMdFence) {
        const openMatch = line.match(/^\s*(`{3,}|~{3,})(.*)$/);
        if (openMatch && !(openMatch[1][0] === "`" && openMatch[2].includes("`"))) {
          inMdFence = true;
          mdFenceChar = openMatch[1][0];
          mdFenceLen = openMatch[1].length;
          sections[sections.length - 1].lines.push(line);
          continue;
        }
      } else {
        const closeMatch = line.match(/^\s*(`{3,}|~{3,})\s*$/);
        if (closeMatch && closeMatch[1][0] === mdFenceChar && closeMatch[1].length >= mdFenceLen) {
          inMdFence = false;
          mdFenceChar = "";
          mdFenceLen = 0;
        }
        sections[sections.length - 1].lines.push(line);
        continue;
      }
    }

    if (sections.length > 0 && !inMdFence && inTripleQuote === null) {
      if (!inHunkBlock && /^\s*<{3,}\s*$/.test(line)) {
        inHunkBlock = true;
        sections[sections.length - 1].lines.push(line);
        continue;
      }
      if (inHunkBlock) {
        if (/^\s*>{3,}\s*$/.test(line)) {
          inHunkBlock = false;
        }
        sections[sections.length - 1].lines.push(line);
        continue;
      }
    }

    const supportsTripleQuotes = Boolean(
      activeFp &&
        (/\.(?:py|pyi|kt|kts|java|cs|gradle)$/i.test(activeFp) || !path.extname(activeFp)),
    );
    const allowPySingleTriple = Boolean(
      activeFp && (/\.(?:py|pyi)$/i.test(activeFp) || !path.extname(activeFp)),
    );
    if (sections.length > 0 && supportsTripleQuotes && inTripleQuote !== null) {
      inTripleQuote = advanceStreamTripleQuoteState(line, inTripleQuote, allowPySingleTriple);
      sections[sections.length - 1].lines.push(line);
      continue;
    }

    // Pure `=`-only divider lines >= 7 chars (e.g. `=======`, `==========`, or 78-char `====...====` banners) are NEVER headers
    if (/^\s*={7,}\s*$/.test(line)) {
      if (sections.length === 0) {
        preHeaderLines.push(line);
      } else {
        sections[sections.length - 1].lines.push(line);
      }
      continue;
    }

    if (
      !isMdSection &&
      !inHunkBlock &&
      !(hasUnindentedHeader && /^\s/.test(line)) &&
      (/^\s*={3,}(?:\s+['"`]\s*['"`]\s*|\s+)={3,}\s*$/.test(line) ||
        (sections.length === 0 && /^\s*={6}\s*$/.test(line)))
    ) {
      throw new Error(
        `Malformed splice stream header '${line.trim()}': empty target inside '=== ... ==='. Expected '=== <filePath> ===' or '=== <filePath>:<symbol> ==='.`,
      );
    }
    if (!isMdSection && !inHunkBlock && !/^\s/.test(line) && /^={3,}\s+([^=\r\n]+)$/.test(line)) {
      const unclosedSpec = line.replace(/^={3,}\s+/, "").trim();
      const unclosedFilePart = unclosedSpec.split(":")[0]?.trim() ?? "";
      if (
        (sections.length === 0 && defaultFilePath === undefined) ||
        isSpliceTargetFileCandidate(unclosedFilePart)
      ) {
        throw new Error(
          `Malformed splice stream header '${line.trim()}': missing closing '===' delimiter (expected '=== ${unclosedSpec} ===').`,
        );
      }
    }

    const m = hasUnindentedHeader && /^\s/.test(line) ? null : line.match(headerRe);
    if (m) {
      let spec = (m[1] || "")
        .trim()
        .replace(/^['"`]|['"`]$/g, "")
        .trim();
      if (!spec) {
        throw new Error(
          `Malformed splice stream header '${line.trim()}': empty target inside '=== ... ==='. Expected '=== <filePath> ===' or '=== <filePath>:<symbol> ==='.`,
        );
      }
      if (/^:+$/.test(spec)) {
        throw new Error(
          `Malformed splice stream header '${line.trim()}': missing <filePath> and <symbol>. Expected '=== <filePath> ===' or '=== <filePath>:<symbol> ==='.`,
        );
      }
      if (/:+$/.test(spec)) {
        const emptySymFile = spec.replace(/\s*:+$/, "").trim();
        throw buildEmptySpliceBlockError(
          emptySymFile || "<file>",
          undefined,
          `parsing malformed stream header '=== ${spec} ===' (missing <symbol>, L<start>-L<end>, or :eof after colon)`,
        );
      }
      let isDelete = Boolean(m[2]);
      if (/(?:\s+(?:--delete|-d|\(delete\))|:delete)\s*$/i.test(spec)) {
        isDelete = true;
        spec = spec.replace(/(?:\s+(?:--delete|-d|\(delete\))|:delete)\s*$/i, "").trim();
      }
      let preserveDocs: boolean | undefined;
      if (/(?:\s+|^)@(?:replace|strip|drop)-docs\b/i.test(spec)) {
        preserveDocs = false;
        spec = spec.replace(/(?:\s+|^)@(?:replace|strip|drop)-docs\b/gi, "").trim();
      }
      let cloneFrom: string | undefined;
      const cloneMatch = spec.match(
        /\s*(?:@clone|\(clone)\s*\(\s*([^()]+)\s*\)|\s*\(clone\s+([^()]+)\)|\s+@clone\s+([^\s()]+)/i,
      );
      if (cloneMatch) {
        cloneFrom = (cloneMatch[1] || cloneMatch[2] || cloneMatch[3]).trim();
        spec = spec.replace(cloneMatch[0], "").trim();
      }
      let insertMode: "after" | "before" | undefined;
      let explicitInsertAnchor: string | undefined;
      const insertFlagMatch = spec.match(
        /(?:\s+|^)--(insert-after|insert-before)(?:(?:\s*=\s*|\s+)(?:"([^"]+)"|'([^']+)'|(\S+)))?\s*$/i,
      );
      if (insertFlagMatch) {
        insertMode = insertFlagMatch[1]!.toLowerCase() === "insert-after" ? "after" : "before";
        const rawAnchor = (
          insertFlagMatch[2] ??
          insertFlagMatch[3] ??
          insertFlagMatch[4] ??
          ""
        ).trim();
        if (rawAnchor) {
          explicitInsertAnchor = rawAnchor;
        }
        spec = spec.slice(0, insertFlagMatch.index ?? 0).trim();
      }
      let blockFilePath: string | undefined;
      let blockSymbol = spec;
      const driveOffset = /^[A-Za-z]:[\\/]/.test(spec) ? 2 : 0;
      const restAfterDrive = spec.slice(driveOffset);
      const sepRe = /\s*(?::+|#)\s*|\s+/g;
      let sepMatch: RegExpExecArray | null = sepRe.exec(restAfterDrive);
      while (sepMatch !== null) {
        const splitIdx = driveOffset + sepMatch.index;
        const candFile = spec.slice(0, splitIdx).trim();
        const candSym = spec.slice(splitIdx + sepMatch[0].length).trim();
        const rawSep = sepMatch[0].trim();
        const isExplicitDirFileCandidate =
          rawSep === ":" &&
          (candFile.includes("/") || candFile.includes("\\")) &&
          !(candFile.startsWith("/") && candFile.endsWith("/")) &&
          !/\s/.test(candFile);
        if (
          candFile &&
          candSym &&
          (isSpliceTargetFileCandidate(candFile) ||
            isUnambiguousExtensionlessFileWithSelector(candFile, candSym, rawSep) ||
            isExplicitDirFileCandidate)
        ) {
          blockFilePath = candFile;
          blockSymbol = candSym;
          break;
        }
        sepMatch = sepRe.exec(restAfterDrive);
      }
      if (insertMode) {
        if (!blockFilePath && spec && isSpliceTargetFileCandidate(spec) && explicitInsertAnchor) {
          blockFilePath = spec;
          blockSymbol = explicitInsertAnchor;
        } else if (!blockSymbol && explicitInsertAnchor) {
          blockSymbol = explicitInsertAnchor;
        }
      } else if (
        !blockFilePath &&
        !isDelete &&
        !cloneFrom &&
        isBareSpliceStreamFileHeader(spec, defaultFilePath)
      ) {
        blockFilePath = spec;
        blockSymbol = ":create";
      }
      const insertAfter =
        insertMode === "after" ? (explicitInsertAnchor ?? blockSymbol) : undefined;
      const insertBefore =
        insertMode === "before" ? (explicitInsertAnchor ?? blockSymbol) : undefined;
      const isValidSymbol =
        Boolean(blockSymbol) &&
        (Boolean(blockFilePath) ||
          !/\s/.test(blockSymbol) ||
          /^[.#@]/.test(blockSymbol) ||
          (Boolean(defaultFilePath) && !/[{};=]/.test(blockSymbol)));
      if (isValidSymbol) {
        inMdFence = false;
        mdFenceChar = "";
        mdFenceLen = 0;
        inHunkBlock = false;
        inTripleQuote = null;
        sections.push({
          filePath: blockFilePath,
          symbol: blockSymbol,
          insertAfter,
          insertBefore,
          cloneFrom,
          preserveDocs,
          isDelete,
          lines: [],
        });
        continue;
      }
    }
    if (sections.length === 0) {
      preHeaderLines.push(line);
    } else {
      if (supportsTripleQuotes) {
        inTripleQuote = advanceStreamTripleQuoteState(line, inTripleQuote, allowPySingleTriple);
      }
      sections[sections.length - 1].lines.push(line);
    }
  }

  if (sections.length === 0) return null;

  const meaningfulPre = preHeaderLines.filter(
    (l) => l.trim().length > 0 && !/^\s*(?:\/\/|#)/.test(l),
  );
  const preIdiomPrefix = meaningfulPre.every((l) => /^\s*@idiom\b/.test(l) || /^\s+/.test(l))
    ? preHeaderLines.join("\n").trim()
    : null;
  if (preIdiomPrefix === null && meaningfulPre.length > 0) {
    return null;
  }

  let lastExplicitFilePath: string | undefined;
  const resolvedBlocks = sections.map((sec) => {
    const rawBody = sec.lines
      .join("\n")
      .replace(/^\n+|\n+$/g, "")
      .replace(/\nEOF\s*(?:&&|;|\|\|)[^\n]*$/i, "");
    const del = sec.isDelete || /^(?:--delete|DELETE)$/i.test(rawBody.trim());
    if (sec.filePath) {
      lastExplicitFilePath = sec.filePath;
    }
    const headerLooksLikePath = !sec.filePath && looksLikeExplicitPathHeader(sec.symbol);
    const targetFp =
      sec.filePath ?? defaultFilePath ?? (headerLooksLikePath ? undefined : lastExplicitFilePath);
    const ext = targetFp ? path.extname(targetFp).toLowerCase() : "";
    const canHaveIdioms =
      Boolean(targetFp) &&
      (targetFp!.endsWith(".aice") ||
        (Boolean(ext) &&
          KNOWN_TARGET_EXTENSIONS.has(ext) &&
          !isPassthroughSpliceFile(targetFp!) &&
          ext !== ".json" &&
          ext !== ".jsonc" &&
          ext !== ".webmanifest" &&
          ext !== ".yaml" &&
          ext !== ".yml" &&
          ext !== ".xml" &&
          ext !== ".svg" &&
          ext !== ".java" &&
          ext !== ".gradle" &&
          ext !== ".pro" &&
          ext !== ".properties" &&
          ext !== ".example" &&
          ext !== ".md" &&
          ext !== ".markdown" &&
          ext !== ".sh" &&
          ext !== ".bash" &&
          ext !== ".zsh" &&
          ext !== ".ps1" &&
          ext !== ".cmd" &&
          ext !== ".bat"));
    const effectiveSymbol =
      sec.symbol === ":create" && containsHunkMarkers(rawBody) ? ":hunk" : sec.symbol;
    const hasExplicitOverwriteOrCreateTag =
      sec.symbol !== ":create" && isCreateOrOverwriteSymbol(effectiveSymbol);
    if (!del && !sec.cloneFrom && !hasExplicitOverwriteOrCreateTag && !rawBody.trim()) {
      throw buildEmptySpliceBlockError(
        targetFp ?? "<file>",
        effectiveSymbol === ":create" ? undefined : effectiveSymbol,
        "parsing --stdin heredoc block",
      );
    }
    const body =
      !del && preIdiomPrefix && canHaveIdioms && !containsHunkMarkers(rawBody)
        ? `${preIdiomPrefix}\n${rawBody}`
        : rawBody;
    return {
      filePath: targetFp,
      explicitFilePath: sec.filePath ?? (headerLooksLikePath ? undefined : lastExplicitFilePath),
      symbol: effectiveSymbol,
      insertAfter: sec.insertAfter,
      insertBefore: sec.insertBefore,
      cloneFrom: sec.cloneFrom,
      preserveDocs: sec.preserveDocs,
      code: del ? undefined : body,
      delete: del || undefined,
    };
  });

  if (resolvedBlocks.some((b) => !b.filePath)) {
    if (defaultFilePath === "") {
      return {
        singleFileEdits: resolvedBlocks.map((b) => ({
          symbol: b.symbol,
          insertAfter: b.insertAfter,
          insertBefore: b.insertBefore,
          cloneFrom: b.cloneFrom,
          preserveDocs: b.preserveDocs,
          code: b.code,
          delete: b.delete,
        })),
      };
    }
    if (defaultFilePath === undefined) {
      const missingBlock = resolvedBlocks.find((b) => !b.filePath);
      throw new Error(
        `Malformed splice stream header '=== ${missingBlock?.symbol ?? ""} ===': missing target <filePath>. Expected '=== <filePath>:${(missingBlock?.symbol ?? "<symbol>").replace(/^:/, "")} ==='.`,
      );
    }
    return null;
  }

  const isBlockCreateOrOverwrite = (b: {
    symbol: string;
    insertAfter?: string;
    insertBefore?: string;
  }): boolean => !b.insertAfter && !b.insertBefore && isCreateOrOverwriteSymbol(b.symbol);

  const hasCreateOrOverwriteBlock = resolvedBlocks.some((b) => isBlockCreateOrOverwrite(b));

  const allSameDefault =
    !hasCreateOrOverwriteBlock &&
    Boolean(defaultFilePath) &&
    resolvedBlocks.every(
      (b) =>
        !b.explicitFilePath || path.resolve(b.explicitFilePath) === path.resolve(defaultFilePath!),
    );

  if (allSameDefault) {
    return {
      singleFileEdits: resolvedBlocks.map((b) => ({
        symbol: b.symbol,
        insertAfter: b.insertAfter,
        insertBefore: b.insertBefore,
        cloneFrom: b.cloneFrom,
        preserveDocs: b.preserveDocs,
        code: b.code,
        delete: b.delete,
      })),
    };
  }

  const batchItems: BatchSpliceItem[] = [];
  if (!hasCreateOrOverwriteBlock) {
    const groupedByFile = new Map<string, SymbolSpliceEdit[]>();
    for (const b of resolvedBlocks) {
      const fp = b.filePath!;
      const list = groupedByFile.get(fp) ?? [];
      list.push({
        symbol: b.symbol,
        insertAfter: b.insertAfter,
        insertBefore: b.insertBefore,
        cloneFrom: b.cloneFrom,
        preserveDocs: b.preserveDocs,
        code: b.code,
        delete: b.delete,
      });
      groupedByFile.set(fp, list);
    }

    for (const [fp, edits] of groupedByFile.entries()) {
      if (edits.length === 1) {
        batchItems.push({
          filePath: fp,
          symbol: edits[0].symbol,
          insertAfter: edits[0].insertAfter,
          insertBefore: edits[0].insertBefore,
          cloneFrom: edits[0].cloneFrom,
          preserveDocs: edits[0].preserveDocs,
          code: edits[0].code,
          delete: edits[0].delete,
        });
      } else {
        batchItems.push({
          filePath: fp,
          edits,
        });
      }
    }
  } else {
    let idx = 0;
    while (idx < resolvedBlocks.length) {
      const b = resolvedBlocks[idx]!;
      const fp = b.filePath!;
      if (isBlockCreateOrOverwrite(b)) {
        batchItems.push({
          filePath: fp,
          symbol: b.symbol,
          code: b.code,
          create: true,
        });
        idx++;
        continue;
      }
      const edits: SymbolSpliceEdit[] = [];
      while (
        idx < resolvedBlocks.length &&
        resolvedBlocks[idx]!.filePath === fp &&
        !isBlockCreateOrOverwrite(resolvedBlocks[idx]!)
      ) {
        const cur = resolvedBlocks[idx]!;
        edits.push({
          symbol: cur.symbol,
          insertAfter: cur.insertAfter,
          insertBefore: cur.insertBefore,
          cloneFrom: cur.cloneFrom,
          preserveDocs: cur.preserveDocs,
          code: cur.code,
          delete: cur.delete,
        });
        idx++;
      }
      if (edits.length === 1) {
        batchItems.push({
          filePath: fp,
          symbol: edits[0].symbol,
          insertAfter: edits[0].insertAfter,
          insertBefore: edits[0].insertBefore,
          cloneFrom: edits[0].cloneFrom,
          preserveDocs: edits[0].preserveDocs,
          code: edits[0].code,
          delete: edits[0].delete,
        });
      } else {
        batchItems.push({
          filePath: fp,
          edits,
        });
      }
    }
  }

  return { batchItems };
}
