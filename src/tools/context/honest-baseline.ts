/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Honest native read baseline computation for token savings telemetry.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { estimateTokens } from "../../tokenomics/index.js";
import { splitSymbolSelectors } from "./imports-and-deps.js";
import type {
  HonestBaselineFileEntry,
  HonestReadBaselineParams,
  LineSpanWindow,
  SurgicalWindowResult,
} from "./types.js";

export function countContextLines(source: string): number {
  if (source.length === 0) return 0;
  const trimmedEnd = source.endsWith("\r\n")
    ? source.slice(0, -2)
    : source.endsWith("\n")
      ? source.slice(0, -1)
      : source;
  if (trimmedEnd.length === 0) return 1;
  return trimmedEnd.split(/\r?\n/).length;
}

export function isPureLineRangeSymbolString(symbolSelector?: string): boolean {
  if (!symbolSelector) return false;
  return /^(?:\[?L\d+(?:-L?\d+)?\]?\s*,?\s*)+$/i.test(symbolSelector.trim());
}

export function isPureRegexSymbolString(symbolSelector?: string): boolean {
  if (!symbolSelector) return false;
  const parts = splitSymbolSelectors(symbolSelector);
  return parts.length > 0 && parts.every((part) => /^\/.+\/[gimsuy]*$/.test(part.trim()));
}

/**
 * Computes the honest native baseline for `:Lstart-Lend` reads: ONLY the requested
 * line window(s) padded by ±10 context lines (clamped to `1..totalLines` of the file)
 * with overlapping windows merged so lines are never double-counted.
 */
export function computeLineRangeBaselineText(
  rawSource: string,
  symbolSelector: string,
  contextPadding = 10,
): string {
  if (!rawSource) return "";
  const rawLines = rawSource.split(/\r?\n/);
  const totalLines = rawLines.length;
  if (totalLines === 0) return "";

  const intervals: Array<{ start: number; end: number }> = [];
  for (const part of splitSymbolSelectors(symbolSelector)) {
    const m = part.trim().match(/^\[?L(\d+)(?:-L?(\d+))?\]?$/i);
    if (!m) continue;
    const reqStart = Number.parseInt(m[1]!, 10);
    const reqEnd = m[2] ? Number.parseInt(m[2], 10) : reqStart;
    const lo = Math.min(reqStart, reqEnd);
    const hi = Math.max(reqStart, reqEnd);
    const clampedStart = Math.max(1, Math.min(totalLines, lo - contextPadding));
    const clampedEnd = Math.max(clampedStart, Math.min(totalLines, hi + contextPadding));
    intervals.push({ start: clampedStart, end: clampedEnd });
  }

  if (intervals.length === 0) {
    return rawSource;
  }

  intervals.sort((a, b) => a.start - b.start || a.end - b.end);
  const merged: Array<{ start: number; end: number }> = [];
  for (const iv of intervals) {
    const prev = merged[merged.length - 1];
    if (prev && iv.start <= prev.end + 1) {
      if (iv.end > prev.end) {
        prev.end = iv.end;
      }
    } else {
      merged.push({ start: iv.start, end: iv.end });
    }
  }

  return merged.map((iv) => rawLines.slice(iv.start - 1, iv.end).join("\n")).join("\n");
}

export function normalizeGrepBreAlternation(patternBody: string): string {
  if (!patternBody.includes("\\|")) return patternBody;
  let hasUnescapedPipe = false;
  let inCharClass = false;
  for (let i = 0; i < patternBody.length; i++) {
    const ch = patternBody[i]!;
    if (ch === "\\") {
      i++;
      continue;
    }
    if (ch === "[" && !inCharClass) {
      inCharClass = true;
      continue;
    }
    if (ch === "]" && inCharClass) {
      inCharClass = false;
      continue;
    }
    if (ch === "|" && !inCharClass) {
      hasUnescapedPipe = true;
      break;
    }
  }
  return hasUnescapedPipe ? patternBody : patternBody.replace(/\\\|/g, "|");
}

function compileRegexSelectorPredicate(rawSel: string): ((lineText: string) => boolean) | null {
  const m = rawSel.trim().match(/^\/(.+)\/([gimsuy]*)$/);
  if (!m) return null;
  const patternBody = normalizeGrepBreAlternation(m[1]!);
  const cleanFlags = (m[2] ?? "").replace(/[gy]/g, "");
  try {
    const re = new RegExp(patternBody, cleanFlags);
    return (lineText: string) => re.test(lineText);
  } catch {
    const needle = cleanFlags.includes("i") ? patternBody.toLowerCase() : patternBody;
    return cleanFlags.includes("i")
      ? (lineText: string) => lineText.toLowerCase().includes(needle)
      : (lineText: string) => lineText.includes(needle);
  }
}

export function computeRegexBaselineText(
  files: readonly HonestBaselineFileEntry[],
  symbolSelector: string,
): string {
  const predicates: Array<(lineText: string) => boolean> = [];
  for (const sel of splitSymbolSelectors(symbolSelector)) {
    const pred = compileRegexSelectorPredicate(sel);
    if (pred) {
      predicates.push(pred);
    }
  }
  if (predicates.length === 0) return "";

  const matchedLines: string[] = [];
  for (const fileEntry of files) {
    if (!fileEntry.rawSource) continue;
    const lines = fileEntry.rawSource.split(/\r?\n/);
    const prefix = fileEntry.relPath ? `${fileEntry.relPath}:` : "";
    for (let i = 0; i < lines.length; i++) {
      const ln = lines[i]!;
      if (predicates.some((checkLine) => checkLine(ln))) {
        matchedLines.push(`${prefix}${i + 1}:${ln}`);
      }
    }
  }
  return matchedLines.join("\n");
}

export function computeRegexContextBaselineText(
  files: readonly HonestBaselineFileEntry[],
  symbolSelector: string,
  contextRadius = 2,
): string {
  const predicates: Array<(lineText: string) => boolean> = [];
  for (const sel of splitSymbolSelectors(symbolSelector)) {
    const pred = compileRegexSelectorPredicate(sel);
    if (pred) predicates.push(pred);
  }
  if (predicates.length === 0) return "";

  const blocks: string[] = [];
  const r = Math.max(0, Math.floor(contextRadius));
  for (const fileEntry of files) {
    if (!fileEntry.rawSource) continue;
    const lines = fileEntry.rawSource.split(/\r?\n/);
    const hits = new Set<number>();
    for (let i = 0; i < lines.length; i++) {
      if (predicates.some((checkLine) => checkLine(lines[i]!))) {
        hits.add(i + 1);
      }
    }
    if (hits.size === 0) continue;
    const sortedHits = Array.from(hits).sort((a, b) => a - b);
    const windows: LineSpanWindow[] = [];
    for (const h of sortedHits) {
      const s = Math.max(1, h - r);
      const e = Math.min(lines.length, h + r);
      const prev = windows[windows.length - 1];
      if (prev && s <= prev.e + 1) {
        prev.e = Math.max(prev.e, e);
      } else {
        windows.push({ s, e });
      }
    }
    const prefix = fileEntry.relPath ? fileEntry.relPath : "file";
    const fileOut: string[] = [];
    for (let wIdx = 0; wIdx < windows.length; wIdx++) {
      if (wIdx > 0) fileOut.push("--");
      const w = windows[wIdx]!;
      for (let lnNo = w.s; lnNo <= w.e; lnNo++) {
        const sep = hits.has(lnNo) ? ":" : "-";
        fileOut.push(`${prefix}${sep}${lnNo}${sep}${lines[lnNo - 1] ?? ""}`);
      }
    }
    blocks.push(fileOut.join("\n"));
  }
  return blocks.join("\n--\n");
}

function computeSymbolSurgicalWindowText(
  rawSource: string,
  symbolSelector: string,
  windowLines = 120,
): SurgicalWindowResult {
  const rawLines = rawSource.split(/\r?\n/);
  const totalLines = Math.max(1, rawLines.length);
  if (totalLines <= windowLines) {
    return { sliceText: rawSource, startLine: 1, endLine: totalLines };
  }
  const firstSym = splitSymbolSelectors(symbolSelector)[0]?.trim() ?? symbolSelector.trim();
  const shortSym = firstSym.split(/\.|::|@/)[0]?.trim() || firstSym;
  const memberSym = firstSym.includes(".")
    ? (firstSym.split(".").pop()?.split("@")[0]?.trim() ?? shortSym)
    : shortSym;
  const esc = memberSym.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  let hitIdx = -1;
  if (esc) {
    const declRe = new RegExp(
      `(?:function|fn|def|func|fun|class|struct|enum|trait|module|interface|type|const|let|var|public|private|protected|pub)\\s+.*\\b${esc}\\b`,
    );
    hitIdx = rawLines.findIndex((l) => declRe.test(l));
    if (hitIdx < 0) {
      const wordRe = new RegExp(`\\b${esc}\\b`);
      hitIdx = rawLines.findIndex((l) => wordRe.test(l));
    }
  }
  const anchorLine = hitIdx >= 0 ? hitIdx + 1 : 1;
  const startLine = Math.max(1, Math.min(totalLines - windowLines + 1, anchorLine - 10));
  const endLine = Math.min(totalLines, startLine + windowLines - 1);
  return {
    sliceText: rawLines.slice(startLine - 1, endLine).join("\n"),
    startLine,
    endLine,
  };
}

function numberReadFileLines(rawText: string, startLine = 1): string {
  const lines = rawText.split(/\r?\n/);
  return lines.map((ln, idx) => `${startLine + idx}: ${ln}`).join("\n");
}

function collectRealisticFdEntries(
  rootDir: string,
  maxDepth?: number,
  filePattern?: string,
): string[] {
  const results: string[] = [];
  const patLower = filePattern?.toLowerCase().replace(/^\*+/, "");
  const allowDot = Boolean(filePattern && /(?:^|[/\\,{])\./.test(filePattern));
  const walk = (dirAbs: string, depth: number): void => {
    if (maxDepth !== undefined && depth > maxDepth) return;
    let ents: fs.Dirent[];
    try {
      ents = fs.readdirSync(dirAbs, { withFileTypes: true });
    } catch {
      return;
    }
    for (const ent of ents) {
      if (ent.name === ".git" || ent.name === "node_modules") continue;
      if (!allowDot && ent.name.startsWith(".")) continue;
      const childAbs = path.join(dirAbs, ent.name);
      const rel = path.relative(rootDir, childAbs).replace(/\\/g, "/");
      if (ent.isDirectory()) {
        if (!patLower || rel.toLowerCase().includes(patLower)) {
          results.push(`${rel}/`);
        }
        walk(childAbs, depth + 1);
      } else if (ent.isFile()) {
        if (!patLower || rel.toLowerCase().includes(patLower)) {
          results.push(rel);
        }
      }
    }
  };
  walk(rootDir, 1);
  return results.sort();
}

export function computeHonestReadBaselineText(params: HonestReadBaselineParams): string {
  const sym = params.symbolSelector?.trim();
  const wrap = Boolean(params.includeToolWrapper);
  const safePath = params.relPath?.trim() || "file";

  if (params.mode === "files") {
    const list = params.filePaths ?? [];
    let fdEntries: string[];
    if (params.projectRoot && fs.existsSync(params.projectRoot)) {
      fdEntries = collectRealisticFdEntries(
        params.projectRoot,
        params.maxDepth,
        params.filePattern,
      );
    } else {
      const dirs = new Set<string>();
      for (const p of list) {
        const parts = p.split("/");
        for (let i = 1; i < parts.length; i++) {
          dirs.add(`${parts.slice(0, i).join("/")}/`);
        }
      }
      fdEntries = [...Array.from(dirs).sort(), ...list];
    }
    const fdBody = fdEntries.join("\n");
    if (!wrap) return fdBody;
    const depthArg = params.maxDepth !== undefined ? ` -d ${params.maxDepth}` : "";
    const patArg = params.filePattern ? ` "${params.filePattern}"` : "";
    return `${JSON.stringify({ CommandLine: `fd${depthArg}${patArg} ${safePath}`, WaitMsBeforeAsync: 5000, toolSummary: "Find workspace files" })}\nCommand exited with code 0.\n\nCommand output:\n${fdBody}`;
  }

  if (params.filesWithMatches) {
    const body = (params.matchedPaths ?? []).join("\n");
    if (!wrap) return body;
    return `${JSON.stringify({ CommandLine: `rg -l "${sym ?? ""}" ${safePath}`, WaitMsBeforeAsync: 5000, toolSummary: "Search matching files" })}\nCommand exited with code 0.\n\nCommand output:\n${body}`;
  }

  if ((sym && isPureRegexSymbolString(sym)) || params.mode === "search") {
    const fileList = params.workspaceFiles ?? [
      { relPath: params.relPath ?? "", rawSource: params.rawSource ?? "" },
    ];
    const rgBody = computeRegexContextBaselineText(fileList, sym ?? "//", 2);
    if (!wrap) {
      return rgBody;
    }
    return `${JSON.stringify({ CommandLine: `rg -n -C 2 "${sym ?? ""}" ${safePath}`, WaitMsBeforeAsync: 5000, toolSummary: "Search pattern in codebase" })}\nCommand exited with code 0.\n\nCommand output:\n${rgBody || "(no matches)"}`;
  }

  if (sym && isPureLineRangeSymbolString(sym)) {
    const raw = params.rawSource ?? "";
    const sliceBody = computeLineRangeBaselineText(raw, sym, 10);
    const rawLinesCount = Math.max(1, countContextLines(raw));
    const m = sym.match(/L?(\d+)(?:-L?(\d+))?/i);
    const sL = m?.[1] ? Math.max(1, Number.parseInt(m[1], 10) - 10) : 1;
    const eL = m?.[2]
      ? Math.min(rawLinesCount, Number.parseInt(m[2], 10) + 10)
      : Math.min(rawLinesCount, sL + 20);
    const pureSliceStdout = `Showing lines ${sL}-${eL} of ${rawLinesCount}\n${numberReadFileLines(sliceBody, sL)}`;
    if (!wrap) {
      return estimateTokens(pureSliceStdout, "cl100k_base") <= estimateTokens(raw, "cl100k_base")
        ? pureSliceStdout
        : raw;
    }
    const fullWrapped = `${JSON.stringify({ Path: safePath })}\nShowing lines 1-${rawLinesCount} of ${rawLinesCount}\n${numberReadFileLines(raw, 1)}`;
    const sliceWrapped = `${JSON.stringify({ Path: safePath, StartLine: sL, EndLine: eL })}\n${pureSliceStdout}`;
    return sliceWrapped.length <= fullWrapped.length ? sliceWrapped : fullWrapped;
  }

  if (sym && sym !== "*" && sym.toLowerCase() !== "outline" && params.rawSource !== undefined) {
    const raw = params.rawSource;
    const rawLines = raw.split(/\r?\n/);
    const rawLinesCount = Math.max(1, rawLines.length);
    const symParts = splitSymbolSelectors(sym)
      .map((s) => s.trim())
      .filter(Boolean);
    if (symParts.length > 1) {
      const intervals: Array<{ s: number; e: number }> = [];
      for (const p of symParts) {
        if (isPureLineRangeSymbolString(p)) {
          const m = p.match(/L?(\d+)(?:-L?(\d+))?/i);
          const sL = m?.[1] ? Math.max(1, Number.parseInt(m[1], 10) - 10) : 1;
          const eL = m?.[2]
            ? Math.min(rawLinesCount, Number.parseInt(m[2], 10) + 10)
            : Math.min(rawLinesCount, sL + 20);
          intervals.push({ s: sL, e: Math.max(sL, eL) });
        } else {
          const w = computeSymbolSurgicalWindowText(raw, p, 120);
          intervals.push({ s: w.startLine, e: w.endLine });
        }
      }
      intervals.sort((a, b) => a.s - b.s || a.e - b.e);
      const mergedIntervals: Array<{ s: number; e: number }> = [];
      for (const iv of intervals) {
        const last = mergedIntervals[mergedIntervals.length - 1];
        if (last && iv.s <= last.e + 1) {
          last.e = Math.max(last.e, iv.e);
        } else {
          mergedIntervals.push({ ...iv });
        }
      }
      const multiStdout = mergedIntervals
        .map(
          (iv) =>
            `Showing lines ${iv.s}-${iv.e} of ${rawLinesCount}\n${numberReadFileLines(rawLines.slice(iv.s - 1, iv.e).join("\n"), iv.s)}`,
        )
        .join("\n");
      if (!wrap) {
        return estimateTokens(multiStdout, "cl100k_base") <= estimateTokens(raw, "cl100k_base")
          ? multiStdout
          : raw;
      }
      const fullWrapped = `${JSON.stringify({ Path: safePath })}\nShowing lines 1-${rawLinesCount} of ${rawLinesCount}\n${numberReadFileLines(raw, 1)}`;
      const multiWrapped = mergedIntervals
        .map(
          (iv) =>
            `${JSON.stringify({ Path: safePath, StartLine: iv.s, EndLine: iv.e })}\nShowing lines ${iv.s}-${iv.e} of ${rawLinesCount}\n${numberReadFileLines(rawLines.slice(iv.s - 1, iv.e).join("\n"), iv.s)}`,
        )
        .join("\n");
      return multiWrapped.length <= fullWrapped.length ? multiWrapped : fullWrapped;
    }
    const win = computeSymbolSurgicalWindowText(raw, sym, 120);
    const pureSymStdout = `Showing lines ${win.startLine}-${win.endLine} of ${rawLinesCount}\n${numberReadFileLines(win.sliceText, win.startLine)}`;
    if (!wrap) {
      return estimateTokens(pureSymStdout, "cl100k_base") <= estimateTokens(raw, "cl100k_base")
        ? pureSymStdout
        : raw;
    }
    const fullWrapped = `${JSON.stringify({ Path: safePath })}\nShowing lines 1-${rawLinesCount} of ${rawLinesCount}\n${numberReadFileLines(raw, 1)}`;
    const rgLocate = `${JSON.stringify({ CommandLine: `rg -n "${sym}" ${safePath}`, WaitMsBeforeAsync: 5000 })}\n`;
    const sliceWrapped = `${rgLocate}${JSON.stringify({ Path: safePath, StartLine: win.startLine, EndLine: win.endLine })}\n${pureSymStdout}`;
    return sliceWrapped.length <= fullWrapped.length ? sliceWrapped : fullWrapped;
  }

  if (
    params.mode === "outline-dir" ||
    params.mode === "workspace" ||
    params.workspaceFiles !== undefined
  ) {
    const entries = params.workspaceFiles ?? [];
    const fdPaths = entries.map((e) => e.relPath).filter(Boolean);
    const sampled = entries.slice(0, 12).map((e) => {
      const head = e.rawSource.split(/\r?\n/).slice(0, 25).join("\n");
      return `// ${e.relPath}\n${numberReadFileLines(head, 1)}`;
    });
    const combined = [...fdPaths, ...sampled].join("\n");
    if (!wrap) return combined;
    return `${JSON.stringify({ CommandLine: `fd && rg -n "^(export|pub|class|def|interface|function)" ${safePath}`, WaitMsBeforeAsync: 5000 })}\n${combined}`;
  }

  const raw = params.rawSource ?? "";
  if (!wrap) return raw;
  const totalL = Math.max(1, countContextLines(raw));
  return `${JSON.stringify({ Path: safePath })}\nShowing lines 1-${totalL} of ${totalL}\n${numberReadFileLines(raw, 1)}`;
}
