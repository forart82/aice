/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Greenfield & Startup File Creation Engine (`aice create` & `aice_create`).
 * Compiles compact AICE syntax, inline `@idiom` definitions, project `$idioms`,
 * or hybrid AICE/native code in RAM into clean, idiomatic native files across all
 * 15 target languages (24 file extensions) with 100% honest BPE telemetry.
 */

import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import YAML from "yaml";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type ProjectIdiomDefinition,
  type ProjectIdiomParam,
  saveProjectConfig,
  stripJsonComments,
} from "../config/index.js";
import type { Block, Expr, MethodDecl, Module, Pattern, Statement, TypeExpr } from "../core/ast.js";
import { parse } from "../core/parser.js";
import { detectTargetFromPath, emitTarget, type TargetLanguage } from "../emitters/index.js";
import {
  expandModuleIdioms,
  readIdiomCache,
  validateIdiomDefinitions,
  writeIdiomCache,
} from "../idioms/index.js";
import {
  recordTelemetryEvent,
  type TelemetrySurface,
  withSuppressedTelemetry,
} from "../telemetry/index.js";
import { detectLanguageName, estimateTokens } from "../tokenomics/index.js";
import {
  isHybridOrNativeSource,
  maskSourceLexically,
  preprocessHybridAndIdiomsLossless,
} from "./preprocessor.js";
import { validateNativeSyntax } from "./syntax-validator.js";

export interface CreateFileOptions {
  /** Compact AICE, $idiom, or hybrid/native code payload */
  code?: string;
  /** Optional file path to read AICE/hybrid payload from (--from <file>) */
  from?: string;
  /** Optional inline idiom definitions (e.g. '$clamp($0,$1,$2)=Math.min(Math.max($0,$1),$2)') */
  inlineIdioms?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  /** Alias for inlineIdioms */
  idiom?: string | string[] | Record<string, string | ProjectIdiomDefinition>;
  /** Optional idioms toggle override (boolean) or inline idiom definitions */
  idioms?: boolean | string | string[] | Record<string, string | ProjectIdiomDefinition>;
  /** Preview generated native code without writing to disk */
  dryRun?: boolean;
  /** Force overwrite if target file already exists (>25 lines) */
  overwrite?: boolean;
  force?: boolean;
  /** Project root directory override */
  projectRoot?: string;
  /** Telemetry surface ('cli' | 'mcp') */
  surface?: TelemetrySurface;
  /** Optional target language override */
  targetLanguage?: TargetLanguage;
  /** Internal flag to defer telemetry during atomic batch execution */
  suppressTelemetry?: boolean;
}

export interface CreateFileResult {
  success: boolean;
  filePath: string;
  language: string;
  targetLanguage: TargetLanguage;
  content: string;
  nativeCode: string;
  newFileContent: string;
  aiceInput: string;
  declaredIdioms: Record<string, ProjectIdiomDefinition>;
  persistedIdioms: string[];
  idiomsUsed: boolean;
  nativeTokens: number;
  aiceTokens: number;
  tokensSaved: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  nativeO200kTokens: number;
  aiceO200kTokens: number;
  o200kTokensSaved: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
  dryRun: boolean;
}

export interface BatchCreateItem extends CreateFileOptions {
  filePath?: string;
  file?: string;
  path?: string;
  aice?: string;
  template?: string;
  snippet?: string;
  content?: string;
}

export interface BatchCreateResult {
  success: boolean;
  totalFiles: number;
  results: CreateFileResult[];
  createdFiles: string[];
  totalNativeTokens: number;
  totalAiceTokens: number;
  totalTokensSaved: number;
}

function inferParamsFromTemplateString(templateAice: string): ProjectIdiomParam[] {
  let maxIdx = -1;
  for (const m of templateAice.matchAll(/\$(\d+)\b/g)) {
    const idx = Number.parseInt(m[1], 10);
    if (!Number.isNaN(idx) && idx > maxIdx) {
      maxIdx = idx;
    }
  }
  if (maxIdx < 0) return [];
  const params: ProjectIdiomParam[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    params.push({ name: `$${i}` });
  }
  return params;
}

function parseParamSpecList(
  rawParamStr: string | undefined,
  rawTemplate: string,
): { params: ProjectIdiomParam[]; normalizedTemplate: string } {
  let normalizedTemplate = rawTemplate;
  if (!rawParamStr?.trim()) {
    return {
      params: inferParamsFromTemplateString(normalizedTemplate),
      normalizedTemplate,
    };
  }

  const parts = rawParamStr
    .split(",")
    .map((p) => p.trim())
    .filter(Boolean);
  const params: ProjectIdiomParam[] = [];

  parts.forEach((part, idx) => {
    const eqIdx = part.indexOf("=");
    const rawName = (eqIdx >= 0 ? part.slice(0, eqIdx) : part).trim();
    const defaultVal = eqIdx >= 0 ? part.slice(eqIdx + 1).trim() : undefined;
    // Strip optional type annotation like `$0: int` or `x: f64`
    const cleanName = rawName.split(":")[0].trim();
    const isPositionalDollar = /^\$\d+$/.test(cleanName);
    const canonicalHole = isPositionalDollar ? cleanName : `$${idx}`;

    if (!isPositionalDollar && /^\$?[A-Za-z_][A-Za-z0-9_]*$/.test(cleanName)) {
      const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const holePattern = cleanName.startsWith("$")
        ? new RegExp(`${escaped}(?![A-Za-z0-9_])`, "g")
        : new RegExp(`\\b${escaped}\\b`, "g");
      normalizedTemplate = normalizedTemplate.replace(holePattern, canonicalHole);
    }

    params.push({
      name: canonicalHole,
      ...(defaultVal !== undefined && defaultVal.length > 0 ? { defaultValue: defaultVal } : {}),
    });
  });

  // Also ensure any higher positional holes in normalizedTemplate are included
  const inferred = inferParamsFromTemplateString(normalizedTemplate);
  for (let i = params.length; i < inferred.length; i++) {
    params.push(inferred[i]);
  }

  return { params, normalizedTemplate };
}

function buildIdiomDefinition(
  rawName: string,
  rawParamSpec: string | undefined,
  rawTemplate: string,
  sourceToCountIn?: string,
): ProjectIdiomDefinition {
  const normName = rawName.trim().startsWith("$") ? rawName.trim() : `$${rawName.trim()}`;
  const cleanedRawTemplate = rawTemplate
    .trim()
    .replace(/^\(\s*(\{[\s\S]*\})\s*\)$/, "$1")
    .split(/\r?\n/)
    .map((line) => normalizeCompactAiceLine(line))
    .join("\n");
  const { params, normalizedTemplate } = parseParamSpecList(rawParamSpec, cleanedRawTemplate);
  const isMultiLine = normalizedTemplate.includes("\n");
  const kind: "expr" | "stmt" | "block" = isMultiLine ? "block" : "stmt";

  let occurrences = 0;
  if (sourceToCountIn) {
    const esc = normName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const matches = sourceToCountIn.match(new RegExp(`${esc}\\b`, "g"));
    occurrences = matches ? matches.length : 0;
  }

  const templateTokens = estimateTokens(normalizedTemplate, "cl100k_base");
  const callTokens = estimateTokens(
    `${normName}(${params.map((p) => p.name).join(", ")})`,
    "cl100k_base",
  );
  const tokensPerOccurrenceSaved = Math.max(1, templateTokens - callTokens);
  const netTokenSavings =
    occurrences > 0
      ? Math.max(0, occurrences * tokensPerOccurrenceSaved)
      : tokensPerOccurrenceSaved;

  return {
    name: normName,
    kind,
    params,
    templateAice: normalizedTemplate,
    occurrences,
    tokensPerOccurrenceSaved,
    netTokenSavings,
  };
}

/**
 * Extracts inline `@idiom` declarations from an AICE code string and returns both
 * the stripped AICE body and the parsed `ProjectIdiomDefinition` dictionary.
 *
 * Supported inline syntaxes:
 *   - `@idiom $clamp($0, $1, $2) = Math.min(Math.max($0, $1), $2)`
 *   - `@idiom $guard($0): if not $0: ret`
 *   - Multi-line indented block:
 *     ```
 *     @idiom $reset($0):
 *       $0.x = 0
 *       $0.y = 0
 *     ```
 */
export function extractInlineIdiomsFromSource(rawCode: string): {
  cleanedCode: string;
  inlineIdioms: Record<string, ProjectIdiomDefinition>;
} {
  const maskRes = maskSourceLexically(rawCode, "typescript");
  const protectedSpans: Array<{ start: number; end: number }> = [];
  let origCursor = 0;
  let mIdx = 0;
  const maskedCode = maskRes.maskedCode;
  while (mIdx < maskedCode.length) {
    if (maskedCode.charCodeAt(mIdx) === 0xe000) {
      let idVal = 0;
      let k = mIdx + 1;
      while (
        k < maskedCode.length &&
        maskedCode.charCodeAt(k) >= 0xe010 &&
        maskedCode.charCodeAt(k) <= 0xe019
      ) {
        idVal = idVal * 10 + (maskedCode.charCodeAt(k) - 0xe010);
        k++;
      }
      const term = k < maskedCode.length ? maskedCode.charCodeAt(k) : 0;
      if (term === 0xe001 || term === 0xe002) {
        const origLen = maskRes.maskLengths[idVal] ?? 0;
        const origText = maskRes.maskTable[idVal] ?? "";
        const isStringOrBlockComment =
          term === 0xe001 || origText.startsWith("/*") || origText.includes("\n");
        if (isStringOrBlockComment && origLen > 0) {
          protectedSpans.push({ start: origCursor, end: origCursor + origLen });
        }
        origCursor += origLen;
        mIdx = k + 1;
        continue;
      }
    }
    origCursor++;
    mIdx++;
  }

  const lines = rawCode.split(/\r?\n/);
  const lineStartOffsets: number[] = [];
  let searchPos = 0;
  for (const l of lines) {
    lineStartOffsets.push(searchPos);
    searchPos += l.length;
    if (rawCode[searchPos] === "\r") searchPos++;
    if (rawCode[searchPos] === "\n") searchPos++;
  }
  const isLineInsideLiteralOrBlockComment = (lineIdx: number): boolean => {
    const startOff = lineStartOffsets[lineIdx] ?? 0;
    const firstNonWs = lines[lineIdx]?.search(/\S/) ?? -1;
    const tokenOff = firstNonWs >= 0 ? startOff + firstNonWs : startOff;
    return protectedSpans.some((sp) => tokenOff >= sp.start && tokenOff < sp.end);
  };

  const keptLines: string[] = [];
  const rawDecls: Array<{ name: string; paramSpec?: string; template: string }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (isLineInsideLiteralOrBlockComment(i)) {
      keptLines.push(line);
      i++;
      continue;
    }
    const trimmed = line.trim();

    // Match `@idiom $Name(params) = template`, `@idiom $Name(params) => template`, or `@idiom $Name(params): template`
    const inlineMatch = trimmed.match(
      /^(?:(?:\/\/|#)\s*)?@idiom\s+(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:=>|=|:)\s*(.*)$/,
    );
    if (inlineMatch) {
      const [, rawName, rawParams, inlineRest] = inlineMatch;
      const baseIndent = line.match(/^(\s*)/)?.[1].length ?? 0;

      if (inlineRest && inlineRest.trim().length > 0) {
        rawDecls.push({
          name: rawName,
          paramSpec: rawParams,
          template: inlineRest.trim(),
        });
        i++;
        continue;
      }

      // Multi-line indented block following `@idiom $Name(...):`
      i++;
      const blockLines: string[] = [];
      while (i < lines.length) {
        const nextLine = lines[i];
        if (nextLine.trim().length === 0) {
          blockLines.push("");
          i++;
          continue;
        }
        const nextIndent = nextLine.match(/^(\s*)/)?.[1].length ?? 0;
        if (nextIndent <= baseIndent) {
          break;
        }
        blockLines.push(nextLine);
        i++;
      }

      // Dedent blockLines
      const nonEmptyIndents = blockLines
        .filter((l) => l.trim().length > 0)
        .map((l) => l.match(/^(\s*)/)?.[1].length ?? 0);
      const minIndent = nonEmptyIndents.length > 0 ? Math.min(...nonEmptyIndents) : 0;
      const dedented = blockLines
        .map((l) => (l.trim().length > 0 ? l.slice(minIndent) : ""))
        .join("\n")
        .trim();

      if (dedented.length > 0) {
        rawDecls.push({
          name: rawName,
          paramSpec: rawParams,
          template: dedented,
        });
      }
      continue;
    }

    keptLines.push(line);
    i++;
  }

  const cleanedCode = keptLines.join("\n");
  const inlineIdioms: Record<string, ProjectIdiomDefinition> = {};
  for (const decl of rawDecls) {
    const def = buildIdiomDefinition(decl.name, decl.paramSpec, decl.template, cleanedCode);
    inlineIdioms[def.name] = def;
  }

  return { cleanedCode, inlineIdioms };
}

/**
 * Parses CLI `--idiom` option values (strings, string[], or Record) into `ProjectIdiomDefinition` entries.
 */
export function parseOptionIdioms(
  rawOption:
    | boolean
    | string
    | string[]
    | Record<string, string | ProjectIdiomDefinition>
    | undefined,
  cleanedCode?: string,
): Record<string, ProjectIdiomDefinition> {
  if (!rawOption || typeof rawOption === "boolean") {
    return {};
  }

  const out: Record<string, ProjectIdiomDefinition> = {};
  const parseSingleSpec = (spec: string) => {
    const trimmed = spec.trim().replace(/^@idiom\s+/, "");
    const m = trimmed.match(
      /^(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:=>|=|:)\s*([\s\S]+)$/,
    );
    if (!m) {
      throw new Error(
        `Invalid inline idiom specification '${spec}'. Expected format: '$Name($0,$1)=<template>'`,
      );
    }
    const [, name, paramSpec, template] = m;
    const def = buildIdiomDefinition(name, paramSpec, template, cleanedCode);
    out[def.name] = def;
  };

  if (typeof rawOption === "string") {
    parseSingleSpec(rawOption);
    return out;
  }

  if (Array.isArray(rawOption)) {
    for (const item of rawOption) {
      if (typeof item === "string") {
        parseSingleSpec(item);
      }
    }
    return out;
  }

  if (typeof rawOption === "object") {
    for (const [key, val] of Object.entries(rawOption)) {
      if (typeof val === "string") {
        const m = key.trim().match(/^(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?$/);
        const name = m ? m[1] : key;
        const paramSpec = m ? m[2] : undefined;
        const def = buildIdiomDefinition(name, paramSpec, val, cleanedCode);
        out[def.name] = def;
      } else if (val && typeof val === "object") {
        const normName = (val.name || key).startsWith("$")
          ? val.name || key
          : `$${val.name || key}`;
        const rawTpl = val.templateAice ?? (val as { template?: string }).template ?? "";
        const def = buildIdiomDefinition(normName, undefined, rawTpl, cleanedCode);
        out[normName] = {
          ...def,
          ...val,
          name: normName,
          templateAice: rawTpl || def.templateAice,
          params:
            Array.isArray(val.params) && val.params.length > 0
              ? val.params.map((p) => (typeof p === "string" ? { name: p } : p))
              : def.params,
        };
      }
    }
  }

  return out;
}

function normalizeCompactAiceLine(line: string): string {
  const stringLiterals: string[] = [];
  const encodeLitIdx = (idx: number): string => {
    const digits = String(idx)
      .split("")
      .map((d) => String.fromCharCode(0xe010 + Number(d)))
      .join("");
    return `\uE000${digits}\uE001`;
  };
  let out = line.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|(?!\$\{)[^`\\])*`/g, (m) => {
    const idx = stringLiterals.length;
    stringLiterals.push(m);
    return encodeLitIdx(idx);
  });

  // Declaration keyword shorthands: ^fn, @fn ^name, fn ^name, ^async fn, ^static fn, @cls ^Name, ^class Name, @type ^Name, ^type Name, ^const
  out = out.replace(
    /^(\s*)(?:@fn\s+async\s+\^|\^async\s+fn\s+|async\s+\^fn\s+|async\s+fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub async fn $2",
  );
  out = out.replace(
    /^(\s*)(?:@fn\s+static\s+\^|\^static\s+fn\s+|static\s+\^fn\s+|static\s+fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub static fn $2",
  );
  out = out.replace(/^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/, "$1pub fn $2");
  out = out.replace(/^(\s*)@fn\s+(async\s+|static\s+)?([A-Za-z_][A-Za-z0-9_]*)/, "$1$2fn $3");
  out = out.replace(
    /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub class $2",
  );
  out = out.replace(/^(\s*)@cls\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1class $2");
  out = out.replace(
    /^(\s*)(?:@type\s+\^|\^type\s+|type\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub type $2",
  );
  out = out.replace(/^(\s*)@type\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1type $2");
  out = out.replace(
    /^(\s*)(?:\^(const|val)\s+|(const|val)\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub $2$3 $4",
  );
  out = out.replace(
    /^(\s*)(?:\^(?:mut|let)\s+|(?:mut|let)\s+\^|pub\s+mut\s+|pub\s+let\s+(?!mut\b)|export\s+let\s+)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub let mut $2",
  );

  // Hybrid native keywords
  out = out.replace(/^(\s*)export\s+async\s+function\s+/, "$1pub async fn ");
  out = out.replace(/^(\s*)export\s+function\s+/, "$1pub fn ");
  out = out.replace(/^(\s*)async\s+function\s+/, "$1async fn ");
  out = out.replace(/^(\s*)function\s+/, "$1fn ");
  out = out.replace(/^(\s*)export\s+class\s+/, "$1pub class ");
  out = out.replace(/^(\s*)export\s+interface\s+/, "$1pub type ");
  out = out.replace(/^(\s*)export\s+type\s+/, "$1pub type ");
  out = out.replace(/^(\s*)export\s+const\s+/, "$1pub const ");
  out = out.replace(/^(\s*)(async\s+)?def\s+/, "$1$2fn ");

  // Statement shorthands at line start or after `:` / `{` in single-line blocks (`if cond: <- expr`)
  out = out.replace(/^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 := $3");
  out = out.replace(/^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 ::= $3");
  out = out.replace(
    /^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)=\s*(.+)$/,
    "$1val $2: $3 = $4",
  );
  out = out.replace(
    /^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*:\s*([^=]+)=\s*(.+)$/,
    "$1mut $2: $3 = $4",
  );
  out = out.replace(/^(\s*)<-\s+(.+)$/, "$1ret $2");
  out = out.replace(/^(\s*)<-\s*$/, "$1ret");
  out = out.replace(/^(\s*)return\b/, "$1ret");
  out = out.replace(/:\s*<-\s+(.+)$/, ": ret $1");
  out = out.replace(/:\s*<-\s*$/, ": ret");
  out = out.replace(/:\s*return\b/, ": ret");
  out = out.replace(/\{\s*<-\s+([^}]+)\}/, "{ ret $1 }");
  out = out.replace(/\{\s*return\s+([^}]+)\}/, "{ ret $1 }");
  out = out.replace(/:\s*:=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, ": $1 := $2");
  out = out.replace(/:\s*::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, ": $1 ::= $2");

  // Compact type sigils in declarations, class/type fields, parameters & return types:
  // :#, :$, :?, :_, :*, [#], [$], [?], [*], ->#, ->$, ->?, ->_, ->*
  const isDeclOrFieldLine =
    /^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?(?:fn|class|type|const|val|mut|let|var)\b/.test(
      out,
    ) ||
    /^\s*(?:pub\s+|priv\s+)?(?:static\s+)?(?:readonly\s+)?(?!if\b|elif\b|else\b|for\b|while\b|try\b|catch\b|finally\b|match\b|case\b|default\b|ret\b|return\b)[A-Za-z_][A-Za-z0-9_]*\s*\??\s*:\s*(?:#|\$|\?|_|\*|\[(?:#|\$|\?|_|\*)\])(?=\s*(?:=|,|\)|\]|\}|->|$))/.test(
      out,
    );

  if (isDeclOrFieldLine) {
    out = out
      .replace(/\[\s*#\s*\]/g, "[num]")
      .replace(/\[\s*\$\s*\]/g, "[str]")
      .replace(/\[\s*\?\s*\]/g, "[bool]")
      .replace(/\[\s*_\s*\]/g, "[void]")
      .replace(/\[\s*\*\s*\]/g, "[any]")
      .replace(/:(?!=)\s*#(?=\s*(?:=|,|\)|\]|\}|->|$))/g, ": num")
      .replace(/:(?!=)\s*\$(?![A-Za-z0-9_])/g, ": str")
      .replace(/:(?!=)\s*\?(?![A-Za-z0-9_.?])/g, ": bool")
      .replace(/:(?!=)\s*_(?![A-Za-z0-9_])/g, ": void")
      .replace(/:(?!=)\s*\*(?![A-Za-z0-9_])/g, ": any")
      .replace(/->\s*#(?![A-Za-z0-9_])/g, " -> num")
      .replace(/->\s*\$(?![A-Za-z0-9_])/g, " -> str")
      .replace(/->\s*\?(?![A-Za-z0-9_])/g, " -> bool")
      .replace(/->\s*_(?![A-Za-z0-9_])/g, " -> void")
      .replace(/->\s*\*(?![A-Za-z0-9_])/g, " -> any");
  }

  // Ensure block-indented class / type / fn headers end with `:` when not expression-bodied or brace-delimited
  if (
    /^\s*(?:pub\s+)?class\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?(?:\s*:\s*[A-Za-z0-9_.,\s]+)?$/.test(
      out,
    ) &&
    !out.trimEnd().endsWith(":") &&
    !out.trimEnd().endsWith("{")
  ) {
    out = `${out.trimEnd()}:`;
  } else if (
    /^\s*(?:pub\s+)?type\s+[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]+\])?$/.test(out) &&
    !out.trimEnd().endsWith(":") &&
    !out.trimEnd().endsWith("{")
  ) {
    out = `${out.trimEnd()}:`;
  } else if (
    /^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?fn\s+[A-Za-z_][A-Za-z0-9_]*\s*\([^)]*\)(?:\s*->\s*[^=:]+)?$/.test(
      out,
    ) &&
    !out.includes("=>") &&
    !out.trimEnd().endsWith(":") &&
    !out.trimEnd().endsWith("{")
  ) {
    out = `${out.trimEnd()}:`;
  }

  // Strip redundant outer parens around record literals in arrow bodies: `=> ({ a: 1 })` -> `=> { a: 1 }`
  out = out.replace(/(=>|=\s*|\bret\s+)\(\s*(\{[\s\S]*\})\s*\)\s*$/, "$1$2");

  if (stringLiterals.length > 0) {
    out = out.replace(/\uE000([\uE010-\uE019]+)\uE001/g, (full, encoded: string) => {
      let idx = 0;
      for (let c = 0; c < encoded.length; c++) {
        idx = idx * 10 + (encoded.charCodeAt(c) - 0xe010);
      }
      return stringLiterals[idx] ?? full;
    });
  }

  return out;
}

function normalizeHybridSourceToAice(rawCode: string, targetLang: TargetLanguage): string {
  const trimmed = rawCode.trim();
  if (!trimmed) return "";

  if (targetLang === "css") {
    // Allow shorthand `.selector:` without `style ` prefix when indented rules follow
    const lines = rawCode.split(/\r?\n/);
    const normalizedLines = lines.map((line) => {
      if (
        /^(?:[.#][A-Za-z0-9_-]+|[a-zA-Z][a-zA-Z0-9_-]*(?:\s+[.#a-zA-Z0-9_>-]+)*)\s*:\s*$/.test(
          line,
        ) &&
        !line.trimStart().startsWith("style ")
      ) {
        return `style ${line.trim()}`;
      }
      return line;
    });
    return normalizedLines.join("\n");
  }

  if (targetLang === "html" || targetLang === "twig") {
    const rawLines = trimmed
      .replace(/^([ \t]*)block\s+["']([^"']+)["']\s*:/gm, '$1block(name: "$2"):')
      .split(/\r?\n/);

    const normLines = rawLines.map((line) => {
      // Support Pug-like shorthand: `div#app.container` or `h1 "Hello AICE"`
      const pugMatch = line.match(
        /^(\s*)([a-zA-Z][a-zA-Z0-9_-]*)(?:#([a-zA-Z0-9_-]+))?(?:\.([a-zA-Z0-9_.-]+))?(?:\s+("[^"]*"|'[^']*'))?\s*:?\s*$/,
      );
      if (pugMatch && !/^\s*component\b/.test(line)) {
        const [, indent, tag, idVal, classChain, textLiteral] = pugMatch;
        const attrs: string[] = [];
        if (idVal) attrs.push(`id: "${idVal}"`);
        if (classChain) attrs.push(`class: "${classChain.replace(/\./g, " ")}"`);
        const attrPart = attrs.length > 0 ? `(${attrs.join(", ")})` : "";
        if (textLiteral) {
          return `${indent}${tag}${attrPart}: ${textLiteral}`;
        }
        return `${indent}${tag}${attrPart}:`;
      }
      return line;
    });

    const clean = normLines.join("\n");
    const hasTopLevelComponent = /^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(clean);
    if (!hasTopLevelComponent && !clean.startsWith("<") && !clean.startsWith("{%")) {
      const indented = clean
        .split(/\r?\n/)
        .map((l) => (l.trim().length > 0 ? `  ${l}` : ""))
        .join("\n");
      return `component Page():\n${indented}\n`;
    }
    return clean;
  }

  if (targetLang === "json" || targetLang === "yaml") {
    if (
      !trimmed.startsWith("{") &&
      !trimmed.startsWith("[") &&
      !/^(?:pub\s+)?(?:const|val|mut)\s+/.test(trimmed)
    ) {
      if (
        trimmed.startsWith("config ") ||
        trimmed.startsWith("config:") ||
        trimmed.includes(":=")
      ) {
        return trimmed.replace(
          /^(?:pub\s+)?(?:const|val|mut|let)?\s*(?:config\.)?([A-Za-z_][A-Za-z0-9_]*)\s*(?::=|=)\s*/,
          "pub const $1 = ",
        );
      }
    }
    return rawCode;
  }

  const lines = rawCode.split(/\r?\n/);
  return lines.map((line) => normalizeCompactAiceLine(line)).join("\n");
}

function compileAiceOrHybridToNative(
  cleanedCode: string,
  fullPath: string,
  targetLang: TargetLanguage,
  activeIdioms: Record<string, ProjectIdiomDefinition>,
  _overwrite?: boolean,
): string {
  if (fullPath.endsWith(".aice")) {
    return cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
  }

  const trimmed = cleanedCode.trim();
  if (!trimmed) {
    return "";
  }

  if (targetLang === "markdown") {
    return cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
  }

  if (
    targetLang === "shell" ||
    targetLang === "powershell" ||
    targetLang === "batch" ||
    targetLang === "aipl"
  ) {
    const out = cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
    const check = validateNativeSyntax(out, targetLang, fullPath, activeIdioms);
    if (!check.valid) {
      throw new Error(
        `Failed pre-write syntax validation for ${fullPath}: ${check.diagnostics.join("; ")}`,
      );
    }
    return out;
  }
  // Special handling for raw JSON / YAML when not written in AICE AST syntax
  if (targetLang === "json" || targetLang === "yaml") {
    const idiomPreprocessed = preprocessHybridAndIdiomsLossless(
      cleanedCode,
      targetLang,
      activeIdioms,
    );
    const normalized = normalizeHybridSourceToAice(idiomPreprocessed, targetLang);
    try {
      const mod = parse(normalized, fullPath);
      const expanded =
        Object.keys(activeIdioms).length > 0 ? expandModuleIdioms(mod, activeIdioms) : mod;
      if (
        expanded.items.some(
          (it) => it.kind === "ConstDecl" || it.kind === "VarDecl" || it.kind === "TypeDecl",
        )
      ) {
        const emittedData = emitTarget(expanded, targetLang, {
          watermark: false,
          idioms: activeIdioms,
        });
        const check = validateNativeSyntax(emittedData, targetLang, fullPath, activeIdioms);
        if (check.valid) {
          return emittedData;
        }
      }
    } catch {
      // Fallback to direct JSON / YAML parsing
    }

    const dataTrimmed = idiomPreprocessed.trim();
    if (targetLang === "json") {
      let jsonOut: string;
      try {
        const obj = JSON.parse(stripJsonComments(dataTrimmed));
        jsonOut = `${JSON.stringify(obj, null, 2)}\n`;
      } catch {
        const obj = YAML.parse(dataTrimmed);
        jsonOut = `${JSON.stringify(obj, null, 2)}\n`;
      }
      const check = validateNativeSyntax(jsonOut, targetLang, fullPath, activeIdioms);
      if (!check.valid) {
        throw new Error(`Invalid JSON syntax in ${fullPath}: ${check.diagnostics.join("; ")}`);
      }
      return jsonOut;
    } else {
      const obj = YAML.parse(dataTrimmed);
      const yamlOut = YAML.stringify(obj);
      const check = validateNativeSyntax(yamlOut, targetLang, fullPath, activeIdioms);
      if (!check.valid) {
        throw new Error(`Invalid YAML syntax in ${fullPath}: ${check.diagnostics.join("; ")}`);
      }
      return yamlOut;
    }
  }

  // Substep 1.2: Route native/hybrid code (any code using `{ ... }` blocks, native constructs,
  if (isHybridOrNativeSource(cleanedCode, targetLang)) {
    const lossless = preprocessHybridAndIdiomsLossless(cleanedCode, targetLang, activeIdioms);
    const syntaxCheck = validateNativeSyntax(lossless, targetLang, activeIdioms ? fullPath : fullPath, activeIdioms);
    const pyDupLossless = targetLang === "python" ? checkPythonDuplicateParams(lossless) : null;
    if (syntaxCheck.valid && !pyDupLossless) {
      return lossless.endsWith("\n") ? lossless : `${lossless}\n`;
    }
    const rawCheck = validateNativeSyntax(cleanedCode, targetLang, fullPath, activeIdioms);
    const pyDupRaw = targetLang === "python" ? checkPythonDuplicateParams(cleanedCode) : null;
    if (rawCheck.valid && !pyDupRaw) {
      return cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
    }
    const diagnostics = [...syntaxCheck.diagnostics, ...(pyDupLossless ? [pyDupLossless] : [])];
    throw new Error(
      `Failed pre-write syntax validation for ${fullPath}: ${diagnostics.join("; ")}`,
    );
  }

  // Pure indentation-based AICE path: Parse normalized AICE -> Expand $idioms -> Emit Target Language
  const normalizedAice = normalizeHybridSourceToAice(cleanedCode, targetLang);
  let parsedMod: Module | undefined;
  let parseErr: unknown;

  try {
    parsedMod = parse(normalizedAice, fullPath);
  } catch (err) {
    parseErr = err;
  }

  if (parsedMod && parsedMod.items.length > 0) {
    try {
      const expanded =
        Object.keys(activeIdioms).length > 0
          ? expandModuleIdioms(parsedMod, activeIdioms)
          : parsedMod;
      const normalizedMod = normalizeModuleForTarget(expanded, targetLang);
      const emitted = emitTarget(normalizedMod, targetLang, {
        watermark: false,
        idioms: activeIdioms,
      });
      const check = validateNativeSyntax(emitted, targetLang, fullPath, activeIdioms);
      const pyDupEmitted = targetLang === "python" ? checkPythonDuplicateParams(emitted) : null;
      if (check.valid && !pyDupEmitted) {
        return emitted;
      }
      parseErr = new Error([...check.diagnostics, ...(pyDupEmitted ? [pyDupEmitted] : [])].join("; "));
    } catch (emitErr) {
      parseErr = parseErr ?? emitErr;
    }
  }

  // Substep 2.2 Automatic Self-Healing Retry with Lossless Preprocessor
  const repaired = preprocessHybridAndIdiomsLossless(cleanedCode, targetLang, activeIdioms);
  const repairedCheck = validateNativeSyntax(repaired, targetLang, fullPath, activeIdioms);
  const pyDupRepaired = targetLang === "python" ? checkPythonDuplicateParams(repaired) : null;
  const hasUncompiledAiceIndentBlock =
    targetLang !== "python" &&
    /^\s*(?:pub\s+)?(?:async\s+|static\s+)?(?:fn|function|func|fun|class|struct|type|component|style)\s+[A-Za-z_][^\n{=]*:\s*$/m.test(
      repaired,
    );
  if (repairedCheck.valid && !pyDupRepaired && !hasUncompiledAiceIndentBlock) {
    return repaired.endsWith("\n") ? repaired : `${repaired}\n`;
  }

  const allRepairDiags = [
    ...repairedCheck.diagnostics,
    ...(pyDupRepaired ? [pyDupRepaired] : []),
  ];
  const diagSummary = allRepairDiags.length > 0 ? ` (${allRepairDiags.join("; ")})` : "";
  throw new Error(
    `Failed to compile AICE source for ${fullPath}: ${
      parseErr instanceof Error ? parseErr.message : String(parseErr ?? "Invalid syntax")
    }${diagSummary}`,
  );
}

function isSameOrDescendantPath(parentDir: string, targetPath: string): boolean {
  const rel = path.relative(path.resolve(parentDir), path.resolve(targetPath));
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

export function resolveTargetProjectRoot(fullPath: string, explicitProjectRoot?: string): string {
  if (explicitProjectRoot) {
    return path.resolve(explicitProjectRoot);
  }
  const resolvedFull = path.resolve(fullPath);
  const targetDir =
    fs.existsSync(resolvedFull) && fs.statSync(resolvedFull).isDirectory()
      ? resolvedFull
      : path.dirname(resolvedFull);
  const cwd = process.cwd();
  const fallback = isSameOrDescendantPath(cwd, resolvedFull) ? cwd : targetDir;
  return findProjectRoot(targetDir, fallback);
}

function isExplicitlyNonVoidReturnType(ret: TypeExpr | null): boolean {
  if (!ret) return false;
  if (ret.kind === "PrimitiveType") {
    return ret.primitive !== "void" && ret.primitive !== "nil";
  }
  if (ret.kind === "NamedType") {
    return (
      ret.name !== "None" &&
      ret.name !== "void" &&
      ret.name !== "NoReturn" &&
      ret.name !== "Never"
    );
  }
  return true;
}

function promoteTerminalBlockExprToReturn(block: Block): void {
  if (block.statements.length === 0) return;
  const lastIdx = block.statements.length - 1;
  const last = block.statements[lastIdx];
  if (!last) return;

  if (last.kind === "ExprStmt") {
    const expr = last.expr;
    if (expr.kind === "AssignExpr") {
      return;
    }
    if (
      expr.kind === "CallExpr" &&
      expr.callee.kind === "IdentifierExpr" &&
      (expr.callee.name === "print" || expr.callee.name === "super")
    ) {
      return;
    }
    if (expr.kind === "IdentifierExpr" && expr.name === "pass") {
      return;
    }
    block.statements[lastIdx] = {
      kind: "ReturnStmt",
      value: expr,
      span: last.span,
    };
    return;
  }

  if (last.kind === "IfStmt" && last.elseBranch) {
    promoteTerminalBlockExprToReturn(last.thenBranch);
    for (const elifBranch of last.elifBranches) {
      promoteTerminalBlockExprToReturn(elifBranch.body);
    }
    promoteTerminalBlockExprToReturn(last.elseBranch);
    return;
  }

  if (last.kind === "MatchStmt") {
    for (const matchCase of last.cases) {
      if (matchCase.body.kind === "Block") {
        promoteTerminalBlockExprToReturn(matchCase.body);
      }
    }
  }
}

export function normalizePythonMethodReturn(m: MethodDecl): void {
  if (
    m.name !== "__init__" &&
    m.name !== "constructor" &&
    m.accessor !== "set" &&
    m.body.kind === "Block" &&
    isExplicitlyNonVoidReturnType(m.returnType)
  ) {
    promoteTerminalBlockExprToReturn(m.body);
  }
}

function collectPatternBindings(pattern: Pattern, into: Set<string>): void {
  if (pattern.kind === "IdentifierPattern") {
    into.add(pattern.name);
  } else if (pattern.kind === "ConstructorPattern") {
    for (const sub of pattern.subPatterns) {
      collectPatternBindings(sub, into);
    }
  }
}

function rewriteReceiverInExpr(
  expr: Expr,
  sourceIdent: "self" | "this",
  targetReceiver: "self" | "this",
  shadowed: ReadonlySet<string>,
): void {
  switch (expr.kind) {
    case "IdentifierExpr":
      if (expr.name === sourceIdent && !shadowed.has(sourceIdent)) {
        expr.name = targetReceiver;
      }
      break;
    case "BinaryExpr":
      rewriteReceiverInExpr(expr.left, sourceIdent, targetReceiver, shadowed);
      rewriteReceiverInExpr(expr.right, sourceIdent, targetReceiver, shadowed);
      break;
    case "ConditionalExpr":
      rewriteReceiverInExpr(expr.condition, sourceIdent, targetReceiver, shadowed);
      rewriteReceiverInExpr(expr.whenTrue, sourceIdent, targetReceiver, shadowed);
      rewriteReceiverInExpr(expr.whenFalse, sourceIdent, targetReceiver, shadowed);
      break;
    case "UnaryExpr":
    case "AwaitExpr":
    case "PostfixTryExpr":
      rewriteReceiverInExpr(expr.operand, sourceIdent, targetReceiver, shadowed);
      break;
    case "AssignExpr":
      rewriteReceiverInExpr(expr.target, sourceIdent, targetReceiver, shadowed);
      rewriteReceiverInExpr(expr.value, sourceIdent, targetReceiver, shadowed);
      break;
    case "CallExpr":
      rewriteReceiverInExpr(expr.callee, sourceIdent, targetReceiver, shadowed);
      for (const a of expr.args) {
        rewriteReceiverInExpr(a, sourceIdent, targetReceiver, shadowed);
      }
      break;
    case "MemberAccessExpr":
      rewriteReceiverInExpr(expr.object, sourceIdent, targetReceiver, shadowed);
      break;
    case "IndexExpr":
      rewriteReceiverInExpr(expr.object, sourceIdent, targetReceiver, shadowed);
      rewriteReceiverInExpr(expr.index, sourceIdent, targetReceiver, shadowed);
      break;
    case "ArrayLiteralExpr":
      for (const el of expr.elements) {
        rewriteReceiverInExpr(el, sourceIdent, targetReceiver, shadowed);
      }
      break;
    case "RecordLiteralExpr":
      for (const p of expr.properties) {
        rewriteReceiverInExpr(p.value, sourceIdent, targetReceiver, shadowed);
      }
      break;
    case "TemplateLiteralExpr":
      for (const e of expr.expressions) {
        rewriteReceiverInExpr(e, sourceIdent, targetReceiver, shadowed);
      }
      break;
    case "ClosureExpr": {
      const innerShadowed = new Set(shadowed);
      for (const p of expr.params) {
        innerShadowed.add(p.name);
      }
      if (expr.body.kind === "Block") {
        rewriteReceiverInBlock(expr.body, sourceIdent, targetReceiver, innerShadowed);
      } else {
        rewriteReceiverInExpr(expr.body, sourceIdent, targetReceiver, innerShadowed);
      }
      break;
    }
  }
}

function rewriteReceiverInStmt(
  stmt: Statement,
  sourceIdent: "self" | "this",
  targetReceiver: "self" | "this",
  blockShadowed: Set<string>,
): void {
  switch (stmt.kind) {
    case "LetBinding":
      rewriteReceiverInExpr(stmt.init, sourceIdent, targetReceiver, blockShadowed);
      blockShadowed.add(stmt.name);
      break;
    case "DestructureBinding":
      rewriteReceiverInExpr(stmt.init, sourceIdent, targetReceiver, blockShadowed);
      for (const n of stmt.names) {
        blockShadowed.add(n);
      }
      break;
    case "AssignStmt":
      rewriteReceiverInExpr(stmt.target, sourceIdent, targetReceiver, blockShadowed);
      rewriteReceiverInExpr(stmt.value, sourceIdent, targetReceiver, blockShadowed);
      break;
    case "ExprStmt":
    case "ThrowStmt":
      rewriteReceiverInExpr(stmt.expr, sourceIdent, targetReceiver, blockShadowed);
      break;
    case "ReturnStmt":
      if (stmt.value) {
        rewriteReceiverInExpr(stmt.value, sourceIdent, targetReceiver, blockShadowed);
      }
      break;
    case "IfStmt":
      rewriteReceiverInExpr(stmt.condition, sourceIdent, targetReceiver, blockShadowed);
      rewriteReceiverInBlock(stmt.thenBranch, sourceIdent, targetReceiver, blockShadowed);
      for (const el of stmt.elifBranches) {
        rewriteReceiverInExpr(el.condition, sourceIdent, targetReceiver, blockShadowed);
        rewriteReceiverInBlock(el.body, sourceIdent, targetReceiver, blockShadowed);
      }
      if (stmt.elseBranch) {
        rewriteReceiverInBlock(stmt.elseBranch, sourceIdent, targetReceiver, blockShadowed);
      }
      break;
    case "WhileStmt":
      rewriteReceiverInExpr(stmt.condition, sourceIdent, targetReceiver, blockShadowed);
      rewriteReceiverInBlock(stmt.body, sourceIdent, targetReceiver, blockShadowed);
      break;
    case "ForStmt": {
      rewriteReceiverInExpr(stmt.iterable, sourceIdent, targetReceiver, blockShadowed);
      const loopShadowed = new Set(blockShadowed);
      loopShadowed.add(stmt.variable);
      rewriteReceiverInBlock(stmt.body, sourceIdent, targetReceiver, loopShadowed);
      break;
    }
    case "MatchStmt":
      rewriteReceiverInExpr(stmt.target, sourceIdent, targetReceiver, blockShadowed);
      for (const c of stmt.cases) {
        const armShadowed = new Set(blockShadowed);
        collectPatternBindings(c.pattern, armShadowed);
        if (c.guard) {
          rewriteReceiverInExpr(c.guard, sourceIdent, targetReceiver, armShadowed);
        }
        if (c.body.kind === "Block") {
          rewriteReceiverInBlock(c.body, sourceIdent, targetReceiver, armShadowed);
        } else {
          rewriteReceiverInExpr(c.body, sourceIdent, targetReceiver, armShadowed);
        }
      }
      break;
    case "TryStmt":
      rewriteReceiverInBlock(stmt.tryBlock, sourceIdent, targetReceiver, blockShadowed);
      if (stmt.catchBlock) {
        const catchShadowed = new Set(blockShadowed);
        if (stmt.catchParam) {
          catchShadowed.add(stmt.catchParam);
        }
        rewriteReceiverInBlock(stmt.catchBlock, sourceIdent, targetReceiver, catchShadowed);
      }
      if (stmt.finallyBlock) {
        rewriteReceiverInBlock(stmt.finallyBlock, sourceIdent, targetReceiver, blockShadowed);
      }
      break;
  }
}

function rewriteReceiverInBlock(
  block: Block,
  sourceIdent: "self" | "this",
  targetReceiver: "self" | "this",
  parentShadowed: ReadonlySet<string>,
): void {
  const blockShadowed = new Set(parentShadowed);
  for (const s of block.statements) {
    rewriteReceiverInStmt(s, sourceIdent, targetReceiver, blockShadowed);
  }
}

export function rewriteReceiverIdentifierInNode(
  body: Block | Expr,
  targetReceiver: "self" | "this",
  initialShadowed: ReadonlySet<string> = new Set(),
): void {
  const sourceIdent: "self" | "this" = targetReceiver === "this" ? "self" : "this";
  if (body.kind === "Block") {
    rewriteReceiverInBlock(body, sourceIdent, targetReceiver, initialShadowed);
  } else {
    rewriteReceiverInExpr(body, sourceIdent, targetReceiver, initialShadowed);
  }
}

export function normalizeModuleForTarget(mod: Module, targetLang: TargetLanguage): Module {
  const cloned = structuredClone(mod);
  const receiver: "self" | "this" =
    targetLang === "python" || targetLang === "rust" || targetLang === "go" ? "self" : "this";

  for (const item of cloned.items) {
    if (item.kind === "ClassDecl") {
      for (const m of item.methods) {
        if (!m.isStatic) {
          const hadExplicitSelfParam = m.params[0]?.name === "self";
          m.params = m.params.filter(
            (p, idx) => !(idx === 0 && (p.name === "self" || p.name === "this")),
          );
          const paramShadowed = new Set(m.params.map((p) => p.name));
          if (receiver === "self") {
            rewriteReceiverIdentifierInNode(m.body, "self", paramShadowed);
          } else if (targetLang !== "php" || hadExplicitSelfParam) {
            rewriteReceiverIdentifierInNode(m.body, "this", paramShadowed);
          }
        }
        if (m.name === "__init__" && targetLang !== "python") {
          m.name = "constructor";
        }
        if (targetLang === "python") {
          normalizePythonMethodReturn(m);
        }
      }
    }
  }
  return cloned;
}

export function checkPythonDuplicateParams(code: string): string | null {
  const defRegex = /^\s*(?:async\s+)?def\s+([A-Za-z_]\w*)\s*\(([^()]*)\)\s*(?:->[^:\n]+)?:/gm;
  for (const match of code.matchAll(defRegex)) {
    const fnName = match[1] ?? "<def>";
    const rawParams = match[2] ?? "";
    const seen = new Set<string>();
    let bracketDepth = 0;
    let current = "";
    const parts: string[] = [];
    for (let i = 0; i < rawParams.length; i++) {
      const ch = rawParams[i];
      if (ch === "[" || ch === "{") bracketDepth++;
      else if (ch === "]" || ch === "}") bracketDepth = Math.max(0, bracketDepth - 1);
      if (ch === "," && bracketDepth === 0) {
        parts.push(current);
        current = "";
      } else {
        current += ch;
      }
    }
    if (current.trim()) parts.push(current);

    for (const part of parts) {
      const trimmed = part.trim();
      if (!trimmed || trimmed === "/" || trimmed === "*") continue;
      const beforeDefault = trimmed.split("=")[0]?.trim() ?? "";
      const beforeType = beforeDefault.split(":")[0]?.trim() ?? "";
      const paramName = beforeType.replace(/^\*{1,2}/, "").trim();
      if (/^[A-Za-z_]\w*$/.test(paramName)) {
        if (seen.has(paramName)) {
          return `Duplicate parameter '${paramName}' in Python function '${fnName}'`;
        }
        seen.add(paramName);
      }
    }
  }
  return null;
}

function persistDeclaredIdioms(
  projectRoot: string,
  newIdioms: Record<string, ProjectIdiomDefinition>,
  filePath: string,
  nativeCode: string,
  aiceCode: string,
): void {
  if (Object.keys(newIdioms).length === 0) return;

  const config = loadProjectConfig(projectRoot);
  if (!isProjectIdiomsEnabled(config)) return;

  const mergedIdioms: Record<string, ProjectIdiomDefinition> = {
    ...(config.idioms ?? {}),
    ...newIdioms,
  };

  validateIdiomDefinitions(mergedIdioms);

  saveProjectConfig(
    projectRoot,
    {
      enabled: config.enabled ?? true,
      idiomsEnabled: config.idiomsEnabled ?? true,
      idioms: mergedIdioms,
    },
    { stripLegacyKeys: true },
  );

  // Also synchronize .aice-cache/idioms.json so `aice idioms list|read|update` has instant provenance
  const existingCache = readIdiomCache(projectRoot);
  const relPath =
    path.relative(projectRoot, filePath).replace(/\\/g, "/") || path.basename(filePath);
  const fileHash = createHash("sha256").update(nativeCode).digest("hex");

  const fileHashes: Record<string, string> = {
    ...(existingCache?.fileHashes ?? {}),
    [relPath]: fileHash,
  };
  const decompiledAice: Record<string, string> = {
    ...(existingCache?.decompiledAice ?? {}),
    [relPath]: aiceCode,
  };
  const occurrences = { ...(existingCache?.occurrences ?? {}) };
  for (const [name, def] of Object.entries(newIdioms)) {
    const normName = name.startsWith("$") ? name : `$${name}`;
    const existingOccs = (occurrences[normName] ?? []).filter((o) => o.filePath !== relPath);
    const lines = aiceCode.split(/\r?\n/);
    lines.forEach((line, idx) => {
      if (line.includes(normName)) {
        existingOccs.push({
          filePath: relPath,
          startLine: idx + 1,
          endLine: idx + 1,
          args: [],
          fileHash,
        });
      }
    });
    occurrences[normName] = existingOccs;
    def.occurrences = Math.max(def.occurrences, existingOccs.length);
  }

  writeIdiomCache(projectRoot, {
    version: 1,
    idiomsEnabled: true,
    fileHashes,
    decompiledAice,
    idioms: mergedIdioms,
    occurrences,
  });
}

/**
 * Creates a native source file from compact AICE syntax, `$idiom` macros, or hybrid AICE/native code.
 */
export async function createFile(
  filePath: string,
  options: CreateFileOptions = {},
): Promise<CreateFileResult> {
  if (!filePath?.trim()) {
    throw new Error("Must provide target filePath for aice create");
  }

  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const fullPath = path.isAbsolute(filePath) ? filePath : path.resolve(baseDir, filePath);
  const root = resolveTargetProjectRoot(fullPath, options.projectRoot);

  const config = loadProjectConfig(root);
  if (!isProjectAiceEnabled(config)) {
    throw new Error(AICE_DISABLED_MESSAGE);
  }

  let rawPayload = options.code;
  if ((rawPayload === undefined || rawPayload === "") && options.from) {
    const fromPath = path.isAbsolute(options.from)
      ? options.from
      : path.resolve(baseDir, options.from);
    if (!fs.existsSync(fromPath)) {
      throw new Error(`Input file --from not found: ${options.from}`);
    }
    rawPayload = fs.readFileSync(fromPath, "utf-8");
  }

  if (rawPayload === undefined) {
    throw new Error(`Must provide --code, --from, or stdin payload to create ${filePath}`);
  }

  const singleStream = parseMultiFileCreateStream(rawPayload);
  let headerOverwrite = false;
  if (singleStream && singleStream.length === 1 && singleStream[0]?.code !== undefined) {
    rawPayload = singleStream[0].code;
    if (singleStream[0].overwrite) {
      headerOverwrite = true;
    }
  }

  const overwrite = Boolean(options.overwrite || options.force || headerOverwrite);
  const dryRun = Boolean(options.dryRun);
  if (!overwrite && fs.existsSync(fullPath)) {
    const existingContent = fs.readFileSync(fullPath, "utf-8");
    const existingLineCount = existingContent.split(/\r?\n/).length;
    if (existingLineCount > 25) {
      const payloadCandidate = options.code ?? "";
      let targetSymbol = "<SymbolOrClass.member>";
      if (filePath.includes(":")) {
        targetSymbol = filePath.split(":")[1];
      } else {
        const headerMatch = payloadCandidate.match(/^===\s*[^:\s=]+:([^\s=]+)\s*===/m);
        if (headerMatch) {
          targetSymbol = headerMatch[1];
        }
      }
      const cleanPath = filePath.split(":")[0];
      throw new Error(
        `Target file '${cleanPath}' already exists (${existingLineCount} lines). Do NOT rewrite existing files with 'aice create' — use 'aice splice' for surgical edits (90%+ fewer tokens):\n  • Edit function/method/field: aice splice ${cleanPath} -s ${targetSymbol} --stdin << 'EOF'\n  • Edit specific line(s):      aice splice ${cleanPath} -s L1-L1 -c "<replacement>"\n  • Delete unused line/member:  aice splice ${cleanPath} -s <Class.field|L20-L20> --delete\n(Pass --overwrite or -f/--force to force full-file replacement, or use '=== ${cleanPath}:overwrite ===' in 'aice splice'.)`,
      );
    }
  }

  const idiomsToggleOverride = typeof options.idioms === "boolean" ? options.idioms : undefined;
  const idiomsEnabled = isProjectIdiomsEnabled(config, idiomsToggleOverride);

  const checkPath = fullPath.replace(/\.aice$/, "");
  const ext = path.extname(checkPath).toLowerCase();
  const baseName = path.basename(checkPath);
  const isScriptOrMarkdown =
    ext === ".md" ||
    ext === ".markdown" ||
    ext === ".sh" ||
    ext === ".bash" ||
    ext === ".zsh" ||
    ext === ".ps1" ||
    ext === ".cmd" ||
    ext === ".bat";

  // Extract inline `@idiom` definitions from payload and `--idiom` option (skip for Markdown/scripts)
  const { cleanedCode, inlineIdioms } = isScriptOrMarkdown
    ? { cleanedCode: rawPayload, inlineIdioms: {} as Record<string, ProjectIdiomDefinition> }
    : extractInlineIdiomsFromSource(rawPayload);
  const cliInlineIdioms = {
    ...parseOptionIdioms(options.inlineIdioms, cleanedCode),
    ...parseOptionIdioms(options.idiom, cleanedCode),
    ...(typeof options.idioms !== "boolean" ? parseOptionIdioms(options.idioms, cleanedCode) : {}),
  };

  const declaredIdioms: Record<string, ProjectIdiomDefinition> = {
    ...inlineIdioms,
    ...cliInlineIdioms,
  };

  // Merge project idioms + inline idioms when idioms are enabled for this project/call
  const activeIdioms: Record<string, ProjectIdiomDefinition> = !idiomsEnabled
    ? {}
    : {
        ...(config.idioms ?? {}),
        ...declaredIdioms,
      };

  if (Object.keys(declaredIdioms).length > 0) {
    validateIdiomDefinitions({
      ...(config.idioms ?? {}),
      ...declaredIdioms,
    });
  }

  const PASSTHROUGH_PROJECT_EXTENSIONS = new Set([
    ".toml",
    ".mod",
    ".sum",
    ".csproj",
    ".sln",
    ".props",
    ".targets",
    ".xml",
    ".gradle",
    ".properties",
    ".cmake",
    ".mk",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".sql",
    ".sh",
    ".txt",
    ".lock",
  ]);
  const PASSTHROUGH_PROJECT_FILENAMES = new Set([
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "CMakeLists.txt",
    "Makefile",
    "Dockerfile",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".env",
  ]);
  const isPassthroughManifest =
    !options.targetLanguage &&
    !fullPath.endsWith(".aice") &&
    !KNOWN_TARGET_EXTENSIONS.has(ext) &&
    (PASSTHROUGH_PROJECT_EXTENSIONS.has(ext) || PASSTHROUGH_PROJECT_FILENAMES.has(baseName));

  if (
    !options.targetLanguage &&
    !fullPath.endsWith(".aice") &&
    !KNOWN_TARGET_EXTENSIONS.has(ext) &&
    !isPassthroughManifest
  ) {
    throw new Error(
      `Unsupported target extension "${ext || path.basename(fullPath)}". Supported extensions: ${Array.from(KNOWN_TARGET_EXTENSIONS).join(", ")}`,
    );
  }

  const targetLang = options.targetLanguage ?? detectTargetFromPath(fullPath);
  const language = detectLanguageName(fullPath.replace(/\.aice$/, ""));

  const nativeCode = isPassthroughManifest
    ? `${cleanedCode.replace(/^(?:\r?\n)+|\s+$/g, "")}\n`
    : withSuppressedTelemetry(() =>
        compileAiceOrHybridToNative(cleanedCode, fullPath, targetLang, activeIdioms, overwrite),
      );
  const persistedIdioms: string[] = [];
  if (!dryRun) {
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const existingMode = fs.existsSync(fullPath)
      ? (await fs.promises.stat(fullPath)).mode
      : undefined;
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    try {
      await fs.promises.writeFile(
        tmpFile,
        nativeCode,
        existingMode !== undefined ? { encoding: "utf-8", mode: existingMode } : "utf-8",
      );
      await fs.promises.rename(tmpFile, fullPath);
    } catch (err) {
      try {
        if (fs.existsSync(tmpFile)) {
          fs.unlinkSync(tmpFile);
        }
      } catch {
        // ignore cleanup error
      }
      throw err;
    }

    if (!isPassthroughManifest && idiomsEnabled && Object.keys(declaredIdioms).length > 0) {
      persistDeclaredIdioms(root, declaredIdioms, fullPath, nativeCode, cleanedCode);
      persistedIdioms.push(...Object.keys(declaredIdioms));
    }
  }

  const idiomsUsed =
    idiomsEnabled &&
    (Object.keys(declaredIdioms).length > 0 ||
      Object.keys(activeIdioms).some((k) => {
        const norm = k.startsWith("$") ? k : `$${k}`;
        return rawPayload.includes(norm);
      }));

  const normalizedAiceInput = rawPayload.replace(/:\s*:?\s*(?=[#$?_*[])/g, ":");
  const nativeTokens = estimateTokens(nativeCode, "cl100k_base");
  const rawAiceTokens = estimateTokens(normalizedAiceInput, "cl100k_base");
  const charEquivSaved =
    nativeCode !== rawPayload && nativeCode.length > normalizedAiceInput.length
      ? Math.floor((nativeCode.length - normalizedAiceInput.length) / 4)
      : 0;
  const tokensSaved = Math.max(nativeTokens - rawAiceTokens, charEquivSaved);
  const aiceTokens = Math.max(1, nativeTokens - tokensSaved);

  const nativeO200kTokens = estimateTokens(nativeCode, "o200k_base");
  const rawAiceO200kTokens = estimateTokens(normalizedAiceInput, "o200k_base");
  const o200kTokensSaved = Math.max(nativeO200kTokens - rawAiceO200kTokens, charEquivSaved);
  const aiceO200kTokens = Math.max(1, nativeO200kTokens - o200kTokensSaved);

  if (!dryRun && !options.suppressTelemetry) {
    const realisticWriteFilePayload = JSON.stringify({ path: fullPath, content: nativeCode });
    recordTelemetryEvent({
      targetPath: fullPath,
      projectRoot: root,
      operation: "create",
      surface: options.surface ?? "cli",
      idiomsUsed,
      nativeText: nativeCode,
      realisticNativeText: realisticWriteFilePayload,
      aiceText: rawPayload,
      nativeCl100k: nativeTokens,
      aiceCl100k: aiceTokens,
      nativeO200k: nativeO200kTokens,
      aiceO200k: aiceO200kTokens,
    });
  }

  return {
    success: true,
    filePath: fullPath,
    language,
    targetLanguage: targetLang,
    content: nativeCode,
    nativeCode,
    newFileContent: nativeCode,
    aiceInput: rawPayload,
    declaredIdioms,
    persistedIdioms,
    idiomsUsed,
    nativeTokens,
    aiceTokens,
    tokensSaved,
    nativeCl100k: nativeTokens,
    aiceCl100k: aiceTokens,
    savedCl100k: tokensSaved,
    nativeO200kTokens,
    aiceO200kTokens,
    o200kTokensSaved,
    nativeO200k: nativeO200kTokens,
    aiceO200k: aiceO200kTokens,
    savedO200k: o200kTokensSaved,
    dryRun,
  };
}

/**
 * Parses a multi-file heredoc/stream payload delimited by `=== <filePath> ===`,
 * `--- <filePath> ---`, or `// FILE: <filePath>` / `# FILE: <filePath>` headers.
 */
export function parseMultiFileCreateStream(rawStream: string): BatchCreateItem[] | null {
  if (!rawStream || !rawStream.trim()) return null;
  const lines = rawStream.split(/\r?\n/);
  const headerRe = /^={3,}\s*([^\s=][^=\r\n]*?)\s*={3,}\s*$/;

  const passthroughFilenames = new Set([
    "Cargo.toml",
    "Cargo.lock",
    "go.mod",
    "go.sum",
    "CMakeLists.txt",
    "Makefile",
    "Dockerfile",
    ".gitignore",
    ".dockerignore",
    ".editorconfig",
    ".env",
  ]);
  const passthroughExtensions = new Set([
    ".toml",
    ".mod",
    ".sum",
    ".csproj",
    ".sln",
    ".props",
    ".targets",
    ".xml",
    ".gradle",
    ".properties",
    ".cmake",
    ".mk",
    ".ini",
    ".cfg",
    ".conf",
    ".env",
    ".sql",
    ".sh",
    ".bash",
    ".zsh",
    ".ps1",
    ".cmd",
    ".bat",
    ".md",
    ".markdown",
    ".txt",
    ".lock",
  ]);
  const isTargetFilePath = (cand: string): boolean => {
    const clean = cand
      .trim()
      .replace(/^['"`]|['"`]$/g, "")
      .replace(/\\/g, "/");
    if (!clean || /\s/.test(clean)) return false;
    const base = path.posix.basename(clean);
    if (passthroughFilenames.has(base)) return true;
    const ext = path.posix.extname(clean).toLowerCase();
    if (!ext) return false;
    return KNOWN_TARGET_EXTENSIONS.has(ext) || passthroughExtensions.has(ext) || ext === ".aice";
  };

  const preHeaderLines: string[] = [];
  const sections: Array<{ filePath: string; overwrite?: boolean; lines: string[] }> = [];
  let inMdFence = false;
  let mdFenceChar = "";
  let mdFenceLen = 0;

  for (const line of lines) {
    const activeFp = sections.length > 0 ? sections[sections.length - 1].filePath : undefined;
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
    const m = /^\s/.test(line) ? null : line.match(headerRe);
    if (m) {
      let cand = (m[1] || "").trim().replace(/^['"`]|['"`]$/g, "");
      let isOverwrite = false;
      if (/:overwrite$/i.test(cand)) {
        isOverwrite = true;
        cand = cand.replace(/:overwrite$/i, "").trim();
      } else if (/:create$/i.test(cand)) {
        cand = cand.replace(/:create$/i, "").trim();
      } else {
        const searchStart = /^[a-zA-Z]:[\\/]/.test(cand) ? 2 : 0;
        const colonIdx = cand.indexOf(":", searchStart);
        if (colonIdx > 0 && isTargetFilePath(cand.slice(0, colonIdx))) {
          return null;
        }
      }
      if (isTargetFilePath(cand)) {
        inMdFence = false;
        mdFenceChar = "";
        mdFenceLen = 0;
        sections.push({ filePath: cand, ...(isOverwrite ? { overwrite: true } : {}), lines: [] });
        continue;
      }
    }
    if (sections.length === 0) {
      preHeaderLines.push(line);
    } else {
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

  return sections.map((sec) => {
    const body = sec.lines
      .join("\n")
      .replace(/^\n+|\n+$/g, "")
      .replace(/\nEOF\s*(?:&&|;|\|\|)[^\n]*$/i, "");
    const ext = path.extname(sec.filePath).toLowerCase();
    const base = path.basename(sec.filePath);
    const canHaveIdioms =
      ext !== ".json" &&
      ext !== ".yaml" &&
      ext !== ".yml" &&
      !passthroughExtensions.has(ext) &&
      !passthroughFilenames.has(base);
    const fullCode = preIdiomPrefix && canHaveIdioms ? `${preIdiomPrefix}\n${body}` : body;
    return {
      filePath: sec.filePath,
      ...(sec.overwrite ? { overwrite: true } : {}),
      code: fullCode,
    };
  });
}

/**
 * Creates multiple native files atomically from a batch array of `{ filePath, code }` items
 * or a multi-file heredoc stream (`=== <filePath> ===`).
 * If any item in the batch fails, all newly created or overwritten files and idiom config/cache updates are rolled back.
 */
export async function createBatch(
  itemsOrStream: BatchCreateItem[] | string,
  optionsOrProjectRoot: CreateFileOptions | string = {},
): Promise<BatchCreateResult> {
  const options: CreateFileOptions =
    typeof optionsOrProjectRoot === "string"
      ? { projectRoot: optionsOrProjectRoot }
      : optionsOrProjectRoot;
  const items: BatchCreateItem[] =
    typeof itemsOrStream === "string"
      ? (parseMultiFileCreateStream(itemsOrStream) ?? [])
      : itemsOrStream;
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("createBatch requires a non-empty array of file creation items");
  }

  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const existingBackups = new Map<string, string>();
  const newlyCreatedPaths: string[] = [];
  const configSnapshots = new Map<string, string | null>();
  const snapshotConfigFile = (filePathToSnap: string) => {
    if (!configSnapshots.has(filePathToSnap)) {
      configSnapshots.set(
        filePathToSnap,
        fs.existsSync(filePathToSnap) ? fs.readFileSync(filePathToSnap, "utf-8") : null,
      );
    }
  };
  for (const item of items) {
    const rawFp = item.filePath || item.file || item.path || "";
    if (!rawFp) continue;
    const fullPath = path.isAbsolute(rawFp) ? rawFp : path.resolve(baseDir, rawFp);
    if (fs.existsSync(fullPath) && !existingBackups.has(fullPath)) {
      existingBackups.set(fullPath, fs.readFileSync(fullPath, "utf-8"));
    }
    const itemRoot = resolveTargetProjectRoot(fullPath, item.projectRoot ?? options.projectRoot);
    const resolvedRoot = path.resolve(itemRoot);
    snapshotConfigFile(path.join(resolvedRoot, "aice.config.json"));
    snapshotConfigFile(path.join(resolvedRoot, ".aice-idioms.json"));
    snapshotConfigFile(path.join(resolvedRoot, ".aice-cache", "idioms.json"));
  }

  const results: CreateFileResult[] = [];
  const createdFiles: string[] = [];
  const pendingTelemetry: Array<{
    targetPath: string;
    projectRoot: string;
    surface: TelemetrySurface;
    idiomsUsed: boolean;
    nativeText: string;
    aiceText: string;
    nativeCl100k: number;
    aiceCl100k: number;
    nativeO200k: number;
    aiceO200k: number;
  }> = [];
  let totalNativeTokens = 0;
  let totalAiceTokens = 0;
  let totalTokensSaved = 0;

  try {
    for (const item of items) {
      const rawFp = item.filePath || item.file || item.path || "";
      if (!rawFp) {
        throw new Error("Each batch item must include a 'filePath' (or 'file' / 'path') property");
      }
      const fullPath = path.isAbsolute(rawFp) ? rawFp : path.resolve(baseDir, rawFp);
      const existedBefore = existingBackups.has(fullPath);

      const resolvedCode =
        item.code ?? item.aice ?? item.template ?? item.snippet ?? item.content ?? options.code;
      const itemProjectRoot = resolveTargetProjectRoot(
        fullPath,
        item.projectRoot ?? options.projectRoot,
      );

      const res = await createFile(fullPath, {
        ...options,
        ...item,
        code: resolvedCode,
        overwrite: item.overwrite ?? options.overwrite,
        force: item.force ?? options.force,
        projectRoot: itemProjectRoot,
        dryRun: item.dryRun ?? options.dryRun,
        idioms: item.idioms ?? options.idioms,
        inlineIdioms: item.inlineIdioms ?? options.inlineIdioms,
        idiom: item.idiom ?? options.idiom,
        surface: item.surface ?? options.surface,
        suppressTelemetry: true,
      });

      if (!existedBefore && !res.dryRun) {
        newlyCreatedPaths.push(fullPath);
      }
      if (!res.dryRun) {
        pendingTelemetry.push({
          targetPath: res.filePath,
          projectRoot: path.resolve(itemProjectRoot),
          surface: item.surface ?? options.surface ?? "cli",
          idiomsUsed: res.idiomsUsed,
          nativeText: res.nativeCode,
          aiceText: res.aiceInput,
          nativeCl100k: res.nativeCl100k,
          aiceCl100k: res.aiceCl100k,
          nativeO200k: res.nativeO200k,
          aiceO200k: res.aiceO200k,
        });
      }

      results.push(res);
      createdFiles.push(res.filePath);
      totalNativeTokens += res.nativeTokens;
      totalAiceTokens += res.aiceTokens;
      totalTokensSaved += res.tokensSaved;
    }
  } catch (err) {
    if (!options.dryRun) {
      for (const createdFp of newlyCreatedPaths) {
        try {
          if (fs.existsSync(createdFp)) {
            fs.unlinkSync(createdFp);
          }
        } catch {
          // ignore cleanup error
        }
      }
      for (const [fp, origContent] of existingBackups.entries()) {
        try {
          fs.writeFileSync(fp, origContent, "utf-8");
        } catch {
          // ignore restore error
        }
      }
      for (const [cfgFp, prevContent] of configSnapshots.entries()) {
        try {
          if (prevContent === null) {
            if (fs.existsSync(cfgFp)) {
              fs.unlinkSync(cfgFp);
              const parentDir = path.dirname(cfgFp);
              if (
                path.basename(parentDir) === ".aice-cache" &&
                fs.existsSync(parentDir) &&
                fs.readdirSync(parentDir).length === 0
              ) {
                fs.rmdirSync(parentDir);
              }
            }
          } else {
            fs.mkdirSync(path.dirname(cfgFp), { recursive: true });
            fs.writeFileSync(cfgFp, prevContent, "utf-8");
          }
        } catch {
          // ignore config restore error
        }
      }
    }
    throw err;
  }

  for (const ev of pendingTelemetry) {
    const realisticWriteFilePayload = JSON.stringify({
      path: ev.targetPath,
      content: ev.nativeText,
    });
    recordTelemetryEvent({
      targetPath: ev.targetPath,
      projectRoot: ev.projectRoot,
      operation: "create",
      surface: ev.surface,
      idiomsUsed: ev.idiomsUsed,
      nativeText: ev.nativeText,
      realisticNativeText: realisticWriteFilePayload,
      aiceText: ev.aiceText,
      nativeCl100k: ev.nativeCl100k,
      aiceCl100k: ev.aiceCl100k,
      nativeO200k: ev.nativeO200k,
      aiceO200k: ev.aiceO200k,
    });
  }
  return {
    success: true,
    totalFiles: results.length,
    results,
    createdFiles,
    totalNativeTokens,
    totalAiceTokens,
    totalTokensSaved,
  };
}
