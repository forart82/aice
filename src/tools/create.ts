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
import type { Module } from "../core/ast.js";
import { parse } from "../core/parser.js";
import { decompile } from "../decompiler/index.js";
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
  /** Project root directory override */
  projectRoot?: string;
  /** Telemetry surface ('cli' | 'mcp') */
  surface?: TelemetrySurface;
  /** Optional target language override */
  targetLanguage?: TargetLanguage;
}

export interface CreateFileResult {
  success: boolean;
  filePath: string;
  language: string;
  targetLanguage: TargetLanguage;
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
    const canonicalHole = cleanName.startsWith("$") ? cleanName : `$${idx}`;

    if (!cleanName.startsWith("$") && /^[A-Za-z_][A-Za-z0-9_]*$/.test(cleanName)) {
      const escaped = cleanName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      normalizedTemplate = normalizedTemplate.replace(
        new RegExp(`\\b${escaped}\\b`, "g"),
        canonicalHole,
      );
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
  const cleanedRawTemplate = rawTemplate.trim().replace(/^\(\s*(\{[\s\S]*\})\s*\)$/, "$1");
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
  const lines = rawCode.split(/\r?\n/);
  const keptLines: string[] = [];
  const rawDecls: Array<{ name: string; paramSpec?: string; template: string }> = [];

  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    const trimmed = line.trim();

    // Match `@idiom $Name(params) = template` or `@idiom $Name(params): template`
    const inlineMatch = trimmed.match(
      /^@idiom\s+(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:=|:)\s*(.*)$/,
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
      /^(\$?[A-Za-z_][A-Za-z0-9_]*)\s*(?:\(([^)]*)\))?\s*(?:=|:)\s*([\s\S]+)$/,
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
  let out = line;

  // Declaration keyword shorthands: ^fn, @fn ^name, fn ^name, @cls ^Name, ^class Name
  out = out.replace(/^(\s*)(?:@fn\s+\^|\^fn\s+|fn\s+\^)([A-Za-z_][A-Za-z0-9_]*)/, "$1pub fn $2");
  out = out.replace(/^(\s*)@fn\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1fn $2");
  out = out.replace(
    /^(\s*)(?:@cls\s+\^|\^class\s+|class\s+\^)([A-Za-z_][A-Za-z0-9_]*)/,
    "$1pub class $2",
  );
  out = out.replace(/^(\s*)@cls\s+([A-Za-z_][A-Za-z0-9_]*)/, "$1class $2");

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

  // Statement shorthands: `:= x = expr`, `::= x = expr`, `<- expr`, `return expr`
  out = out.replace(/^(\s*):=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 := $3");
  out = out.replace(/^(\s*)::=\s+([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/, "$1$2 ::= $3");
  out = out.replace(/^(\s*)<-\s+(.+)$/, "$1ret $2");
  out = out.replace(/^(\s*)<-\s*$/, "$1ret");
  out = out.replace(/^(\s*)return\b/, "$1ret");

  // Compact type sigils in parameter & return type annotations: :#, :$, :?, :_, :*, ->#, ->$, ->?, ->_, ->*
  if (/^\s*(?:pub\s+)?(?:static\s+)?(?:async\s+)?(?:fn|class|type)\b/.test(out)) {
    out = out
      .replace(/:(?!=)\s*#(?![A-Za-z0-9_])/g, ": num")
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

  // Ensure block-indented class / fn headers end with `:` when not expression-bodied or brace-delimited
  if (
    /^\s*(?:pub\s+)?class\s+[A-Za-z_][A-Za-z0-9_]*(?:\s*\([^)]*\))?(?:\s*:\s*[A-Za-z0-9_.,\s]+)?$/.test(
      out,
    ) &&
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
      // Check if it's a single AICE expression or key-value
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
): string {
  if (fullPath.endsWith(".aice")) {
    return cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
  }

  const trimmed = cleanedCode.trim();
  if (!trimmed) {
    return "";
  }

  // Special handling for raw JSON / YAML when not written in AICE AST syntax
  if (targetLang === "json" || targetLang === "yaml") {
    const normalized = normalizeHybridSourceToAice(cleanedCode, targetLang);
    try {
      const mod = parse(normalized, fullPath);
      const expanded =
        Object.keys(activeIdioms).length > 0 ? expandModuleIdioms(mod, activeIdioms) : mod;
      if (
        expanded.items.some(
          (it) => it.kind === "ConstDecl" || it.kind === "VarDecl" || it.kind === "TypeDecl",
        )
      ) {
        return emitTarget(expanded, targetLang, {
          watermark: false,
          idioms: activeIdioms,
        });
      }
    } catch {
      // Fallback to direct JSON / YAML parsing
    }

    if (targetLang === "json") {
      try {
        const obj = JSON.parse(stripJsonComments(trimmed));
        return `${JSON.stringify(obj, null, 2)}\n`;
      } catch {
        const obj = YAML.parse(trimmed);
        return `${JSON.stringify(obj, null, 2)}\n`;
      }
    } else {
      const obj = YAML.parse(trimmed);
      return YAML.stringify(obj);
    }
  }

  // Special handling for raw HTML/Twig passthrough if starting with `<` or `{%` and no AICE component
  if (
    (targetLang === "html" || targetLang === "twig") &&
    (trimmed.startsWith("<") || trimmed.startsWith("{%")) &&
    !/^(?:(?:#[^\n]*|module\s+[^\n]+)\n+|\s)*component\s+/m.test(trimmed)
  ) {
    return trimmed.endsWith("\n") ? trimmed : `${trimmed}\n`;
  }

  // Primary path: Parse normalized AICE -> Expand $idioms -> Emit Target Language
  const normalizedAice = normalizeHybridSourceToAice(cleanedCode, targetLang);
  let parsedMod: Module | undefined;
  let parseErr: unknown;

  try {
    parsedMod = parse(normalizedAice, fullPath);
  } catch (err) {
    parseErr = err;
  }

  if (parsedMod && parsedMod.items.length > 0) {
    const expanded =
      Object.keys(activeIdioms).length > 0
        ? expandModuleIdioms(parsedMod, activeIdioms)
        : parsedMod;
    return emitTarget(expanded, targetLang, {
      watermark: false,
      idioms: activeIdioms,
    });
  }

  // Secondary path: Hybrid or Native code with $idioms or := / ret
  try {
    const decompLang =
      targetLang === "python"
        ? "python"
        : targetLang === "rust" ||
            targetLang === "go" ||
            targetLang === "cpp" ||
            targetLang === "csharp" ||
            targetLang === "kotlin" ||
            targetLang === "php" ||
            targetLang === "css"
          ? targetLang
          : "typescript";

    const placeholderProtected = cleanedCode.replace(
      /\$([A-Za-z_][A-Za-z0-9_]*)\s*\(/g,
      "__aice_idiom__$1(",
    );
    const decomp = decompile(placeholderProtected, decompLang, { filePath: fullPath });
    const restoredAice = decomp.aice.replace(/__aice_idiom__([A-Za-z_][A-Za-z0-9_]*)/g, "$$$1");
    const mod = parse(restoredAice, fullPath);
    const expanded =
      Object.keys(activeIdioms).length > 0 ? expandModuleIdioms(mod, activeIdioms) : mod;
    return emitTarget(expanded, targetLang, {
      watermark: false,
      idioms: activeIdioms,
    });
  } catch {
    // If the input has no unexpanded $idioms and looks like valid native code, allow clean passthrough
    if (!cleanedCode.includes("$") && !/\bfn\s+[A-Za-z_]/.test(cleanedCode)) {
      return cleanedCode.endsWith("\n") ? cleanedCode : `${cleanedCode}\n`;
    }
    throw new Error(
      `Failed to compile AICE source for ${fullPath}: ${
        parseErr instanceof Error ? parseErr.message : String(parseErr)
      }`,
    );
  }
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
  const root = options.projectRoot
    ? path.resolve(options.projectRoot)
    : findProjectRoot(path.dirname(fullPath), process.cwd());

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

  const idiomsToggleOverride = typeof options.idioms === "boolean" ? options.idioms : undefined;
  const idiomsEnabled = isProjectIdiomsEnabled(config, idiomsToggleOverride);

  // Extract inline `@idiom` definitions from payload and `--idiom` option
  const { cleanedCode, inlineIdioms } = extractInlineIdiomsFromSource(rawPayload);
  const cliInlineIdioms = {
    ...parseOptionIdioms(options.inlineIdioms, cleanedCode),
    ...parseOptionIdioms(options.idiom, cleanedCode),
    ...(typeof options.idioms !== "boolean" ? parseOptionIdioms(options.idioms, cleanedCode) : {}),
  };

  const declaredIdioms: Record<string, ProjectIdiomDefinition> = {
    ...inlineIdioms,
    ...cliInlineIdioms,
  };

  // Merge project idioms + inline idioms (always expand inline idioms and existing idioms for grace)
  const activeIdioms: Record<string, ProjectIdiomDefinition> =
    options.idioms === false
      ? {}
      : {
          ...(config.idioms ?? {}),
          ...declaredIdioms,
        };

  if (Object.keys(declaredIdioms).length > 0) {
    validateIdiomDefinitions(activeIdioms);
  }

  const checkPath = fullPath.replace(/\.aice$/, "");
  const ext = path.extname(checkPath).toLowerCase();
  if (!options.targetLanguage && !fullPath.endsWith(".aice") && !KNOWN_TARGET_EXTENSIONS.has(ext)) {
    throw new Error(
      `Unsupported target extension "${ext || path.basename(fullPath)}". Supported extensions: ${Array.from(KNOWN_TARGET_EXTENSIONS).join(", ")}`,
    );
  }

  const targetLang = options.targetLanguage ?? detectTargetFromPath(fullPath);
  const language = detectLanguageName(fullPath.replace(/\.aice$/, ""));

  const nativeCode = withSuppressedTelemetry(() =>
    compileAiceOrHybridToNative(cleanedCode, fullPath, targetLang, activeIdioms),
  );

  const dryRun = Boolean(options.dryRun);
  if (!dryRun) {
    const dir = path.dirname(fullPath);
    await fs.promises.mkdir(dir, { recursive: true });
    const tmpFile = path.join(
      dir,
      `.${path.basename(fullPath)}.${Date.now()}.${Math.random().toString(36).slice(2)}.tmp`,
    );
    await fs.promises.writeFile(tmpFile, nativeCode, "utf-8");
    await fs.promises.rename(tmpFile, fullPath);

    if (idiomsEnabled && Object.keys(declaredIdioms).length > 0) {
      persistDeclaredIdioms(root, declaredIdioms, fullPath, nativeCode, cleanedCode);
    }
  }

  const idiomsUsed =
    Object.keys(declaredIdioms).length > 0 ||
    Object.keys(activeIdioms).some((k) => {
      const norm = k.startsWith("$") ? k : `$${k}`;
      return rawPayload.includes(norm);
    });

  const nativeTokens = estimateTokens(nativeCode, "cl100k_base");
  const aiceTokens = estimateTokens(rawPayload, "cl100k_base");
  const tokensSaved = nativeTokens - aiceTokens;

  const nativeO200kTokens = estimateTokens(nativeCode, "o200k_base");
  const aiceO200kTokens = estimateTokens(rawPayload, "o200k_base");
  const o200kTokensSaved = nativeO200kTokens - aiceO200kTokens;

  recordTelemetryEvent({
    targetPath: fullPath,
    projectRoot: root,
    operation: "create",
    surface: options.surface ?? "cli",
    idiomsUsed,
    nativeText: nativeCode,
    aiceText: rawPayload,
  });

  return {
    success: true,
    filePath: fullPath,
    language,
    targetLanguage: targetLang,
    nativeCode,
    newFileContent: nativeCode,
    aiceInput: rawPayload,
    declaredIdioms,
    persistedIdioms: Object.keys(declaredIdioms),
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
 * Creates multiple native files atomically from a batch array of `{ filePath, code }` items.
 * If any item in the batch fails, all newly created or overwritten files are rolled back.
 */
export async function createBatch(
  items: BatchCreateItem[],
  options: CreateFileOptions = {},
): Promise<BatchCreateResult> {
  if (!Array.isArray(items) || items.length === 0) {
    throw new Error("createBatch requires a non-empty array of file creation items");
  }

  const baseDir = options.projectRoot ? path.resolve(options.projectRoot) : process.cwd();
  const existingBackups = new Map<string, string>();
  const newlyCreatedPaths: string[] = [];

  for (const item of items) {
    const rawFp = item.filePath || item.file || item.path || "";
    if (!rawFp) continue;
    const fullPath = path.isAbsolute(rawFp) ? rawFp : path.resolve(baseDir, rawFp);
    if (fs.existsSync(fullPath) && !existingBackups.has(fullPath)) {
      existingBackups.set(fullPath, fs.readFileSync(fullPath, "utf-8"));
    }
  }

  const results: CreateFileResult[] = [];
  const createdFiles: string[] = [];
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

      const res = await createFile(rawFp, {
        ...options,
        ...item,
        code: resolvedCode,
        projectRoot: item.projectRoot ?? options.projectRoot,
        dryRun: item.dryRun ?? options.dryRun,
        idioms: item.idioms ?? options.idioms,
        inlineIdioms: item.inlineIdioms ?? options.inlineIdioms,
        idiom: item.idiom ?? options.idiom,
        surface: item.surface ?? options.surface,
      });

      if (!existedBefore && !res.dryRun) {
        newlyCreatedPaths.push(fullPath);
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
    }
    throw err;
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
