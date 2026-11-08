/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Unified Project Configuration Engine (Step 14).
 * Manages `aice.config.json`, `.aicerc`, and `package.json` config discovery,
 * mode auto-detection ("side-by-side" vs "isolated"), robust default options,
 * and target output path resolution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TargetLanguage } from "../emitters/context.js";

export type ProjectMode = "side-by-side" | "isolated" | "twinless";

export interface ProjectIdiomParam {
  name: string; // e.g. "$0", "$1"
  type?: string;
  defaultValue?: string;
}

export interface IdiomOccurrence {
  filePath: string;
  symbol?: string;
  startLine: number;
  endLine: number;
  args: string[];
  fileHash?: string;
}

export interface ProjectIdiomDefinition {
  name: string; // e.g. "$guardOk"
  kind: "expr" | "stmt" | "block";
  params: ProjectIdiomParam[];
  templateAice: string;
  occurrences: number;
  tokensPerOccurrenceSaved: number;
  netTokenSavings: number;
  description?: string;
}

export interface AiceProjectConfig {
  enabled?: boolean;
  mode: ProjectMode;
  sourceDir: string;
  outDir: string;
  targetLanguage: TargetLanguage;
  isolated: boolean;
  watermark: boolean;
  idiomsEnabled?: boolean;
  idioms?: Record<string, ProjectIdiomDefinition>;
}

export const AICE_DISABLED_MESSAGE =
  "AICE is disabled for this project via aice.config.json (\"enabled\": false). Use native tools or run 'aice enable'.";

export const VALID_PROJECT_MODES: ReadonlySet<ProjectMode> = new Set([
  "side-by-side",
  "isolated",
  "twinless",
]);

export const VALID_TARGET_LANGUAGES: ReadonlySet<TargetLanguage> = new Set([
  "typescript",
  "tsx",
  "python",
  "html",
  "css",
  "rust",
  "go",
  "cpp",
  "csharp",
  "json",
  "yaml",
  "twig",
  "php",
  "kotlin",
]);

const _defaultProjectConfig: AiceProjectConfig = {
  mode: "side-by-side",
  sourceDir: "src",
  outDir: ".aice-build",
  targetLanguage: "typescript",
  isolated: false,
  watermark: true,
};
Object.defineProperty(_defaultProjectConfig, "enabled", {
  value: true,
  enumerable: false,
  writable: false,
  configurable: false,
});
export const DEFAULT_PROJECT_CONFIG: Readonly<AiceProjectConfig> =
  Object.freeze(_defaultProjectConfig);

export const KNOWN_TARGET_EXTENSIONS: ReadonlySet<string> = new Set([
  ".ts",
  ".tsx",
  ".py",
  ".rs",
  ".go",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
  ".html",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".yaml",
  ".yml",
  ".twig",
  ".php",
  ".kt",
  ".kts",
]);

export const TARGET_EXT_MAP: Readonly<Record<string, TargetLanguage>> = Object.freeze({
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "typescript",
  ".jsx": "tsx",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".rs": "rust",
  ".go": "go",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "cpp",
  ".cs": "csharp",
  ".html": "html",
  ".css": "css",
  ".json": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".twig": "twig",
  ".php": "php",
  ".kt": "kotlin",
  ".kts": "kotlin",
});

const IGNORED_SCAN_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".aice-build",
  ".next",
  "coverage",
  ".turbo",
]);

/**
 * Returns the default file extension for a given TargetLanguage.
 */
export function getExtensionForTarget(target: TargetLanguage): string {
  switch (target) {
    case "typescript":
      return ".ts";
    case "tsx":
      return ".tsx";
    case "python":
      return ".py";
    case "rust":
      return ".rs";
    case "go":
      return ".go";
    case "cpp":
      return ".cpp";
    case "csharp":
      return ".cs";
    case "html":
      return ".html";
    case "css":
      return ".css";
    case "json":
      return ".json";
    case "yaml":
      return ".yaml";
    case "twig":
      return ".twig";
    case "php":
      return ".php";
    case "kotlin":
      return ".kt";
    default:
      return ".ts";
  }
}

/**
 * Derives target filename by stripping `.aice` or applying target language extension.
 * E.g.:
 * - `App.tsx.aice` -> `App.tsx`
 * - `calc.ts.aice` -> `calc.ts`
 * - `calc.aice` (targetLanguage = "python") -> `calc.py`
 * - `calc.aice` (targetLanguage = "typescript") -> `calc.ts`
 */
export function deriveTargetFilename(
  filename: string,
  targetLanguage: TargetLanguage = "typescript",
): string {
  if (!filename.endsWith(".aice")) {
    return filename;
  }

  const withoutAice = filename.slice(0, -5);
  const innerExt = path.extname(withoutAice).toLowerCase();

  if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
    return withoutAice;
  }

  const defaultExt = getExtensionForTarget(targetLanguage);
  return `${withoutAice}${defaultExt}`;
}

/**
 * Strips comments from a JSON string while preserving strings and escapes.
 */
export function stripJsonComments(input: string): string {
  let insideString = false;
  let stringChar = "";
  let isEscaped = false;
  let output = "";
  let i = 0;

  while (i < input.length) {
    const char = input[i];
    const next = input[i + 1];

    if (insideString) {
      output += char;
      if (isEscaped) {
        isEscaped = false;
      } else if (char === "\\") {
        isEscaped = true;
      } else if (char === stringChar) {
        insideString = false;
      }
      i++;
      continue;
    }

    if (char === '"' || char === "'") {
      insideString = true;
      stringChar = char;
      output += char;
      i++;
      continue;
    }

    // Line comment: //
    if (char === "/" && next === "/") {
      while (i < input.length && input[i] !== "\n" && input[i] !== "\r") {
        i++;
      }
      continue;
    }

    // Block comment: /* ... */
    if (char === "/" && next === "*") {
      i += 2;
      while (i < input.length && !(input[i] === "*" && input[i + 1] === "/")) {
        i++;
      }
      i += 2;
      continue;
    }

    output += char;
    i++;
  }

  return output;
}

function inferParamsFromTemplate(templateAice: string): ProjectIdiomParam[] {
  let maxIdx = -1;
  for (const m of templateAice.matchAll(/\$(\d+)\b/g)) {
    const idx = Number.parseInt(m[1], 10);
    if (!Number.isNaN(idx) && idx > maxIdx) {
      maxIdx = idx;
    }
  }
  if (maxIdx < 0) {
    return [];
  }
  const params: ProjectIdiomParam[] = [];
  for (let i = 0; i <= maxIdx; i++) {
    params.push({ name: `$${i}` });
  }
  return params;
}

function normalizeShapedIdiom(key: string, val: unknown): ProjectIdiomDefinition | null {
  if (typeof val === "string") {
    const normName = key.startsWith("$") ? key : `$${key}`;
    const templateAice = val;
    const isMultiLine = templateAice.includes("\n");
    return {
      name: normName,
      kind: isMultiLine ? "block" : "stmt",
      params: inferParamsFromTemplate(templateAice),
      templateAice,
      occurrences: 0,
      tokensPerOccurrenceSaved: 0,
      netTokenSavings: 0,
    };
  }
  if (typeof val !== "object" || val === null || Array.isArray(val)) {
    return null;
  }
  const entry = val as Record<string, unknown>;
  const normName =
    typeof entry.name === "string" && entry.name.trim()
      ? entry.name
      : key.startsWith("$")
        ? key
        : `$${key}`;
  const rawTemplate =
    typeof entry.templateAice === "string"
      ? entry.templateAice
      : typeof entry.template === "string"
        ? entry.template
        : undefined;
  const normalizedParams = Array.isArray(entry.params)
    ? entry.params.map((p) => (typeof p === "string" ? { name: p } : (p as ProjectIdiomParam)))
    : typeof rawTemplate === "string"
      ? inferParamsFromTemplate(rawTemplate)
      : (entry.params as ProjectIdiomParam[]);

  return {
    ...(entry as unknown as ProjectIdiomDefinition),
    name: normName,
    kind:
      entry.kind === "expr" || entry.kind === "stmt" || entry.kind === "block"
        ? entry.kind
        : typeof entry.kind === "string"
          ? (entry.kind as "expr" | "stmt" | "block")
          : typeof rawTemplate === "string" && rawTemplate.includes("\n")
            ? "block"
            : "stmt",
    params: normalizedParams,
    templateAice: (rawTemplate ?? entry.templateAice) as string,
    occurrences: entry.occurrences === undefined ? 0 : (entry.occurrences as number),
    tokensPerOccurrenceSaved:
      entry.tokensPerOccurrenceSaved === undefined ? 0 : (entry.tokensPerOccurrenceSaved as number),
    netTokenSavings: entry.netTokenSavings === undefined ? 0 : (entry.netTokenSavings as number),
    ...(entry.description !== undefined ? { description: entry.description as string } : {}),
  };
}

/**
 * Validates partial or complete project configuration fields.
 */
export function validateConfig(config: Partial<AiceProjectConfig>): void {
  if (config.mode !== undefined && !VALID_PROJECT_MODES.has(config.mode)) {
    throw new Error(
      `Invalid project mode "${config.mode}". Valid modes are: "side-by-side", "isolated", "twinless".`,
    );
  }

  if (config.targetLanguage !== undefined && !VALID_TARGET_LANGUAGES.has(config.targetLanguage)) {
    throw new Error(
      `Invalid target language "${config.targetLanguage}". Valid targets are: ${Array.from(
        VALID_TARGET_LANGUAGES,
      ).join(", ")}.`,
    );
  }

  if (config.sourceDir !== undefined && typeof config.sourceDir !== "string") {
    throw new Error(`Invalid sourceDir: expected string, received ${typeof config.sourceDir}`);
  }

  if (config.outDir !== undefined && typeof config.outDir !== "string") {
    throw new Error(`Invalid outDir: expected string, received ${typeof config.outDir}`);
  }

  if (config.isolated !== undefined && typeof config.isolated !== "boolean") {
    throw new Error(`Invalid isolated: expected boolean, received ${typeof config.isolated}`);
  }

  if (config.watermark !== undefined && typeof config.watermark !== "boolean") {
    throw new Error(`Invalid watermark: expected boolean, received ${typeof config.watermark}`);
  }

  if (config.enabled !== undefined && typeof config.enabled !== "boolean") {
    throw new Error(`Invalid enabled: expected boolean, received ${typeof config.enabled}`);
  }

  if (config.idiomsEnabled !== undefined && typeof config.idiomsEnabled !== "boolean") {
    throw new Error(
      `Invalid idiomsEnabled: expected boolean, received ${typeof config.idiomsEnabled}`,
    );
  }

  if (config.idioms !== undefined && typeof (config.idioms as unknown) !== "boolean") {
    if (
      typeof config.idioms !== "object" ||
      config.idioms === null ||
      Array.isArray(config.idioms)
    ) {
      throw new Error(
        `Invalid idioms configuration: expected object mapping idiom names to definitions, received ${Array.isArray(config.idioms) ? "array" : typeof config.idioms}`,
      );
    }
    for (const [name, idiom] of Object.entries(config.idioms)) {
      if (typeof idiom !== "object" || idiom === null || Array.isArray(idiom)) {
        throw new Error(`Invalid idiom definition for "${name}": expected object`);
      }
      if (typeof idiom.name !== "string" || !idiom.name) {
        throw new Error(`Invalid idiom "${name}": "name" must be a non-empty string`);
      }
      if (idiom.kind !== "expr" && idiom.kind !== "stmt" && idiom.kind !== "block") {
        throw new Error(
          `Invalid idiom "${name}": "kind" must be "expr", "stmt", or "block", received "${idiom.kind}"`,
        );
      }
      if (!Array.isArray(idiom.params)) {
        throw new Error(`Invalid idiom "${name}": "params" must be an array`);
      }
      for (let i = 0; i < idiom.params.length; i++) {
        const param = idiom.params[i];
        if (typeof param !== "object" || param === null || typeof param.name !== "string") {
          throw new Error(`Invalid idiom "${name}": param[${i}] must have a string name`);
        }
      }
      if (typeof idiom.templateAice !== "string") {
        throw new Error(`Invalid idiom "${name}": "templateAice" must be a string`);
      }
      if (typeof idiom.occurrences !== "number") {
        throw new Error(`Invalid idiom "${name}": "occurrences" must be a number`);
      }
      if (typeof idiom.tokensPerOccurrenceSaved !== "number") {
        throw new Error(`Invalid idiom "${name}": "tokensPerOccurrenceSaved" must be a number`);
      }
      if (typeof idiom.netTokenSavings !== "number") {
        throw new Error(`Invalid idiom "${name}": "netTokenSavings" must be a number`);
      }
      if (idiom.description !== undefined && typeof idiom.description !== "string") {
        throw new Error(`Invalid idiom "${name}": "description" must be a string`);
      }
    }
  }

  if (
    config.mode !== undefined &&
    config.isolated !== undefined &&
    ((config.mode === "isolated" && !config.isolated) ||
      (config.mode === "side-by-side" && config.isolated))
  ) {
    throw new Error(
      `Inconsistent project config: mode is "${config.mode}" but isolated is ${config.isolated}.`,
    );
  }
}

export const validateProjectConfig = validateConfig;

/**
 * Scans a directory for `.aice` files to differentiate dual-extension (*.ts.aice)
 * vs bare (*.aice) files for mode auto-detection.
 */
function scanAiceFiles(
  dir: string,
  maxDepth = 6,
  currentDepth = 0,
): { dualExtCount: number; bareAiceCount: number } {
  let dualExtCount = 0;
  let bareAiceCount = 0;

  if (currentDepth > maxDepth || !fs.existsSync(dir)) {
    return { dualExtCount, bareAiceCount };
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { dualExtCount, bareAiceCount };
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SCAN_DIRECTORIES.has(entry.name)) {
        const sub = scanAiceFiles(fullPath, maxDepth, currentDepth + 1);
        dualExtCount += sub.dualExtCount;
        bareAiceCount += sub.bareAiceCount;
      }
    } else if (entry.isFile() && entry.name.endsWith(".aice")) {
      const withoutAice = entry.name.slice(0, -5);
      const innerExt = path.extname(withoutAice).toLowerCase();
      if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
        dualExtCount++;
      } else {
        bareAiceCount++;
      }
    }
  }

  return { dualExtCount, bareAiceCount };
}

/**
 * Heuristically auto-detects whether a workspace is configured for "side-by-side"
 * or "isolated" compilation.
 */
export function autoDetectProjectMode(projectDir: string): ProjectMode {
  const resolvedDir = path.resolve(projectDir);

  // 1. Check if .aice-build exists
  const buildDir = path.join(resolvedDir, ".aice-build");
  if (fs.existsSync(buildDir)) {
    return "isolated";
  }

  // 2. Scan files
  const { dualExtCount, bareAiceCount } = scanAiceFiles(resolvedDir);

  if (bareAiceCount > dualExtCount) {
    return "isolated";
  }

  if (dualExtCount > 0) {
    return "side-by-side";
  }

  return "side-by-side";
}

/**
 * Searches upward from `startDir` to locate a project root containing
 * `aice.config.json`, `.aice-idioms.json`, `.aicerc`, `.aice-build`, or `package.json`.
 * If none is found, falls back to `fallbackDir` (or `startDir`).
 */
export function findProjectRoot(startDir: string, fallbackDir?: string): string {
  let cur = path.resolve(startDir);
  try {
    if (fs.existsSync(cur) && !fs.statSync(cur).isDirectory()) {
      cur = path.dirname(cur);
    }
  } catch {
    cur = path.dirname(cur);
  }

  const initialDir = cur;
  while (true) {
    if (
      fs.existsSync(path.join(cur, "aice.config.json")) ||
      fs.existsSync(path.join(cur, ".aice-idioms.json")) ||
      fs.existsSync(path.join(cur, ".aicerc")) ||
      fs.existsSync(path.join(cur, ".aice-build")) ||
      fs.existsSync(path.join(cur, "package.json"))
    ) {
      return cur;
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    cur = parent;
  }

  return fallbackDir ? path.resolve(fallbackDir) : initialDir;
}

/**
 * Loads project configuration from `aice.config.json`, `.aice-idioms.json`, `.aicerc`, or `package.json`'s "aice" field.
 * If no config file is present, performs mode auto-detection and returns defaults.
 */
export function loadProjectConfig(projectDir: string): AiceProjectConfig {
  const resolvedDir = path.resolve(projectDir);

  let rawConfig: Record<string, unknown> | null = null;

  // 1. Try aice.config.json
  const aiceConfigPath = path.join(resolvedDir, "aice.config.json");
  if (fs.existsSync(aiceConfigPath)) {
    try {
      const content = fs.readFileSync(aiceConfigPath, "utf-8");
      rawConfig = JSON.parse(stripJsonComments(content));
    } catch (err) {
      throw new Error(
        `Failed to parse ${aiceConfigPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Try .aicerc
  if (!rawConfig) {
    const aicercPath = path.join(resolvedDir, ".aicerc");
    if (fs.existsSync(aicercPath)) {
      try {
        const content = fs.readFileSync(aicercPath, "utf-8");
        rawConfig = JSON.parse(stripJsonComments(content));
      } catch (err) {
        throw new Error(
          `Failed to parse ${aicercPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 3. Try package.json's "aice" field
  if (!rawConfig) {
    const pkgPath = path.join(resolvedDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.aice === "object" && parsed.aice !== null) {
          rawConfig = parsed.aice as Record<string, unknown>;
        }
      } catch (err) {
        throw new Error(
          `Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  if (rawConfig && typeof rawConfig.idioms === "boolean") {
    if (rawConfig.idiomsEnabled === undefined) {
      rawConfig.idiomsEnabled = rawConfig.idioms;
    }
    delete rawConfig.idioms;
  }

  // 4. Merge .aice-idioms.json if present
  const idiomsJsonPath = path.join(resolvedDir, ".aice-idioms.json");
  if (fs.existsSync(idiomsJsonPath)) {
    try {
      const content = fs.readFileSync(idiomsJsonPath, "utf-8");
      const parsedIdioms = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
      rawConfig = rawConfig ? { ...rawConfig } : {};
      if (rawConfig.idiomsEnabled === undefined) {
        rawConfig.idiomsEnabled =
          typeof parsedIdioms.idiomsEnabled === "boolean" ? parsedIdioms.idiomsEnabled : true;
      }
      const sourceIdioms =
        typeof parsedIdioms.idioms === "object" &&
        parsedIdioms.idioms !== null &&
        !Array.isArray(parsedIdioms.idioms)
          ? (parsedIdioms.idioms as Record<string, unknown>)
          : parsedIdioms;
      const mergedIdioms: Record<string, unknown> = {};
      for (const [key, val] of Object.entries(sourceIdioms)) {
        if (key === "idiomsEnabled") continue;
        const normalized = normalizeShapedIdiom(key, val);
        if (normalized) {
          mergedIdioms[normalized.name] = normalized;
        }
      }
      if (
        typeof rawConfig.idioms === "object" &&
        rawConfig.idioms !== null &&
        !Array.isArray(rawConfig.idioms)
      ) {
        for (const [key, val] of Object.entries(rawConfig.idioms as Record<string, unknown>)) {
          mergedIdioms[key] = val;
        }
      }
      rawConfig.idioms = mergedIdioms;
    } catch (err) {
      throw new Error(
        `Failed to parse ${idiomsJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  const configToProcess: Record<string, unknown> = rawConfig ? { ...rawConfig } : {};

  // Support "idioms": false | true as boolean alias for "idiomsEnabled"
  if (typeof configToProcess.idioms === "boolean") {
    if (configToProcess.idiomsEnabled === undefined) {
      configToProcess.idiomsEnabled = configToProcess.idioms;
    }
    delete configToProcess.idioms;
  }

  if (configToProcess.enabled !== undefined && typeof configToProcess.enabled !== "boolean") {
    throw new Error(
      `Invalid enabled: expected boolean, received ${typeof configToProcess.enabled}`,
    );
  }

  if (
    configToProcess.idiomsEnabled !== undefined &&
    typeof configToProcess.idiomsEnabled !== "boolean"
  ) {
    throw new Error(
      `Invalid idiomsEnabled: expected boolean, received ${typeof configToProcess.idiomsEnabled}`,
    );
  }

  // Normalize any idiom definitions missing optional numeric telemetry fields
  if (
    typeof configToProcess.idioms === "object" &&
    configToProcess.idioms !== null &&
    !Array.isArray(configToProcess.idioms)
  ) {
    const rawMap = configToProcess.idioms as Record<string, unknown>;
    const normalizedMap: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(rawMap)) {
      if (typeof val === "string") {
        const shaped = normalizeShapedIdiom(key, val);
        if (shaped) normalizedMap[shaped.name] = shaped;
      } else if (val && typeof val === "object" && !Array.isArray(val)) {
        const entry = { ...(val as Record<string, unknown>) };
        if (entry.templateAice === undefined && typeof entry.template === "string") {
          entry.templateAice = entry.template;
        }
        if (entry.params === undefined && typeof entry.templateAice === "string") {
          entry.params = inferParamsFromTemplate(entry.templateAice);
        } else if (Array.isArray(entry.params)) {
          entry.params = entry.params.map((p) => (typeof p === "string" ? { name: p } : p));
        }
        if (entry.occurrences === undefined) entry.occurrences = 0;
        if (entry.tokensPerOccurrenceSaved === undefined) entry.tokensPerOccurrenceSaved = 0;
        if (entry.netTokenSavings === undefined) entry.netTokenSavings = 0;
        normalizedMap[key] = entry;
      } else {
        normalizedMap[key] = val;
      }
    }
    configToProcess.idioms = normalizedMap;
  }

  // Determine mode and isolated
  let mode: ProjectMode;
  let isolated: boolean;

  if (configToProcess.mode !== undefined) {
    mode = configToProcess.mode as ProjectMode;
    isolated =
      typeof configToProcess.isolated === "boolean"
        ? configToProcess.isolated
        : mode === "isolated";
  } else if (configToProcess.isolated !== undefined) {
    isolated = Boolean(configToProcess.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    mode = autoDetectProjectMode(resolvedDir);
    isolated = mode === "isolated";
  }

  const finalConfig: AiceProjectConfig = {
    ...(typeof configToProcess.enabled === "boolean" ? { enabled: configToProcess.enabled } : {}),
    mode,
    sourceDir:
      typeof configToProcess.sourceDir === "string"
        ? configToProcess.sourceDir
        : DEFAULT_PROJECT_CONFIG.sourceDir,
    outDir:
      typeof configToProcess.outDir === "string"
        ? configToProcess.outDir
        : DEFAULT_PROJECT_CONFIG.outDir,
    targetLanguage:
      typeof configToProcess.targetLanguage === "string"
        ? (configToProcess.targetLanguage as TargetLanguage)
        : DEFAULT_PROJECT_CONFIG.targetLanguage,
    isolated,
    watermark:
      typeof configToProcess.watermark === "boolean"
        ? configToProcess.watermark
        : DEFAULT_PROJECT_CONFIG.watermark,
    ...(typeof configToProcess.idiomsEnabled === "boolean"
      ? { idiomsEnabled: configToProcess.idiomsEnabled }
      : {}),
    ...(typeof configToProcess.idioms === "object" &&
    configToProcess.idioms !== null &&
    !Array.isArray(configToProcess.idioms)
      ? { idioms: configToProcess.idioms as Record<string, ProjectIdiomDefinition> }
      : {}),
  };

  validateConfig(finalConfig);
  return finalConfig;
}

/**
 * Saves or updates project configuration in `aice.config.json` (or `.aice-idioms.json` when used).
 */
export function saveProjectConfig(
  projectDir: string,
  config: Partial<AiceProjectConfig>,
  options?: { stripLegacyKeys?: boolean },
): AiceProjectConfig {
  const resolvedDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const configPath = path.join(resolvedDir, "aice.config.json");
  const idiomsJsonPath = path.join(resolvedDir, ".aice-idioms.json");
  const hasAiceConfig = fs.existsSync(configPath);
  const hasIdiomsJson = fs.existsSync(idiomsJsonPath);

  let existing: Record<string, unknown> = {};

  if (hasAiceConfig) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      existing = JSON.parse(stripJsonComments(content));
    } catch {
      existing = {};
    }
  } else if (hasIdiomsJson) {
    try {
      const content = fs.readFileSync(idiomsJsonPath, "utf-8");
      const parsed = JSON.parse(stripJsonComments(content)) as Record<string, unknown>;
      const sourceIdioms =
        typeof parsed.idioms === "object" && parsed.idioms !== null && !Array.isArray(parsed.idioms)
          ? (parsed.idioms as Record<string, unknown>)
          : parsed;
      const normIdioms: Record<string, ProjectIdiomDefinition> = {};
      for (const [k, v] of Object.entries(sourceIdioms)) {
        if (k === "idiomsEnabled") continue;
        const shaped = normalizeShapedIdiom(k, v);
        if (shaped) normIdioms[shaped.name] = shaped;
      }
      existing = {
        ...(typeof parsed.idiomsEnabled === "boolean"
          ? { idiomsEnabled: parsed.idiomsEnabled }
          : { idiomsEnabled: true }),
        idioms: normIdioms,
      };
    } catch {
      existing = {};
    }
  }

  let mode: ProjectMode;
  let isolated: boolean;

  if (config.mode !== undefined) {
    mode = config.mode;
    isolated = config.isolated ?? mode === "isolated";
  } else if (config.isolated !== undefined) {
    isolated = config.isolated;
    mode = isolated ? "isolated" : "side-by-side";
  } else if (existing.mode !== undefined) {
    mode = existing.mode as ProjectMode;
    isolated = existing.isolated !== undefined ? Boolean(existing.isolated) : mode === "isolated";
  } else if (existing.isolated !== undefined) {
    isolated = Boolean(existing.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    mode = DEFAULT_PROJECT_CONFIG.mode;
    isolated = DEFAULT_PROJECT_CONFIG.isolated;
  }

  const existingIdiomsEnabled =
    typeof existing.idiomsEnabled === "boolean"
      ? existing.idiomsEnabled
      : typeof existing.idioms === "boolean"
        ? existing.idioms
        : undefined;

  const mergedConfig: AiceProjectConfig = {
    ...(config.enabled !== undefined
      ? { enabled: config.enabled }
      : typeof existing.enabled === "boolean"
        ? { enabled: existing.enabled }
        : {}),
    mode,
    sourceDir:
      config.sourceDir ?? (existing.sourceDir as string) ?? DEFAULT_PROJECT_CONFIG.sourceDir,
    outDir: config.outDir ?? (existing.outDir as string) ?? DEFAULT_PROJECT_CONFIG.outDir,
    targetLanguage:
      config.targetLanguage ??
      (existing.targetLanguage as TargetLanguage) ??
      DEFAULT_PROJECT_CONFIG.targetLanguage,
    isolated,
    watermark:
      config.watermark ??
      (typeof existing.watermark === "boolean"
        ? existing.watermark
        : DEFAULT_PROJECT_CONFIG.watermark),
    ...(config.idiomsEnabled !== undefined
      ? { idiomsEnabled: config.idiomsEnabled }
      : existingIdiomsEnabled !== undefined
        ? { idiomsEnabled: existingIdiomsEnabled }
        : {}),
    ...(config.idioms !== undefined
      ? { idioms: config.idioms }
      : typeof existing.idioms === "object" &&
          existing.idioms !== null &&
          !Array.isArray(existing.idioms)
        ? { idioms: existing.idioms as Record<string, ProjectIdiomDefinition> }
        : {}),
  };

  validateConfig(mergedConfig);

  const isPureIdiomsSave =
    hasIdiomsJson &&
    !hasAiceConfig &&
    config.enabled === undefined &&
    (config.mode === undefined || config.mode === DEFAULT_PROJECT_CONFIG.mode) &&
    (config.sourceDir === undefined || config.sourceDir === DEFAULT_PROJECT_CONFIG.sourceDir) &&
    (config.outDir === undefined || config.outDir === DEFAULT_PROJECT_CONFIG.outDir) &&
    (config.targetLanguage === undefined ||
      config.targetLanguage === DEFAULT_PROJECT_CONFIG.targetLanguage) &&
    (config.isolated === undefined || config.isolated === DEFAULT_PROJECT_CONFIG.isolated) &&
    (config.watermark === undefined || config.watermark === DEFAULT_PROJECT_CONFIG.watermark);

  if (isPureIdiomsSave) {
    const idiomsPayload = {
      idiomsEnabled: mergedConfig.idiomsEnabled ?? true,
      idioms: mergedConfig.idioms ?? {},
    };
    fs.writeFileSync(idiomsJsonPath, `${JSON.stringify(idiomsPayload, null, 2)}\n`, "utf-8");
    return mergedConfig;
  }

  const stripLegacy = Boolean(options?.stripLegacyKeys);
  const LEGACY_CONFIG_KEYS = new Set([
    "mode",
    "sourceDir",
    "outDir",
    "targetLanguage",
    "isolated",
    "watermark",
  ]);
  const toWrite: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(existing)) {
    if (!LEGACY_CONFIG_KEYS.has(k) && k !== "enabled" && k !== "idiomsEnabled" && k !== "idioms") {
      toWrite[k] = v;
    }
  }

  if (mergedConfig.enabled !== undefined) {
    toWrite.enabled = mergedConfig.enabled;
  }
  if (mergedConfig.idiomsEnabled !== undefined) {
    toWrite.idiomsEnabled = mergedConfig.idiomsEnabled;
  }
  if (!stripLegacy) {
    if (config.mode !== undefined || config.isolated !== undefined || existing.mode !== undefined) {
      toWrite.mode = mergedConfig.mode;
    }
    if (config.sourceDir !== undefined || existing.sourceDir !== undefined) {
      toWrite.sourceDir = mergedConfig.sourceDir;
    }
    if (config.outDir !== undefined || existing.outDir !== undefined) {
      toWrite.outDir = mergedConfig.outDir;
    }
    if (config.targetLanguage !== undefined || existing.targetLanguage !== undefined) {
      toWrite.targetLanguage = mergedConfig.targetLanguage;
    }
    if (config.isolated !== undefined || existing.isolated !== undefined) {
      toWrite.isolated = mergedConfig.isolated;
    }
    if (config.watermark !== undefined || existing.watermark !== undefined) {
      toWrite.watermark = mergedConfig.watermark;
    }
  }
  if (mergedConfig.idioms !== undefined) {
    toWrite.idioms = mergedConfig.idioms;
  }

  fs.writeFileSync(configPath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf-8");

  if (hasIdiomsJson && (config.idioms !== undefined || config.idiomsEnabled !== undefined)) {
    try {
      const idiomsPayload = {
        idiomsEnabled: mergedConfig.idiomsEnabled ?? true,
        idioms: mergedConfig.idioms ?? {},
      };
      fs.writeFileSync(idiomsJsonPath, `${JSON.stringify(idiomsPayload, null, 2)}\n`, "utf-8");
    } catch {
      // ignore sync error
    }
  }

  return mergedConfig;
}

/**
 * Returns whether AICE is enabled for a project (true unless `enabled === false` in config).
 */
export function isProjectAiceEnabled(
  configOrDir?: Partial<AiceProjectConfig> | string | null,
): boolean {
  if (!configOrDir) {
    return true;
  }
  if (typeof configOrDir === "string") {
    try {
      const root = findProjectRoot(configOrDir);
      const cfg = loadProjectConfig(root);
      return cfg.enabled !== false;
    } catch {
      return true;
    }
  }
  return configOrDir.enabled !== false;
}

/**
 * Creates or updates `aice.config.json` with `"enabled": true | false`.
 */
export function setProjectAiceEnabled(projectDir: string, enabled: boolean): AiceProjectConfig {
  let resolvedDir = findProjectRoot(projectDir);
  if (
    resolvedDir === path.resolve(projectDir) &&
    path.basename(resolvedDir) === "src" &&
    !fs.existsSync(path.join(resolvedDir, "aice.config.json")) &&
    !fs.existsSync(path.join(resolvedDir, ".aice-idioms.json"))
  ) {
    resolvedDir = path.dirname(resolvedDir);
  }
  const current = loadProjectConfig(resolvedDir);
  return saveProjectConfig(
    resolvedDir,
    {
      enabled,
      idiomsEnabled: current.idiomsEnabled ?? true,
    },
    { stripLegacyKeys: true },
  );
}

/**
 * Returns whether project idioms are currently enabled, honoring an optional per-call override flag.
 */
export function isProjectIdiomsEnabled(
  config?: Partial<AiceProjectConfig> | null,
  overrideFlag?: boolean,
): boolean {
  if (overrideFlag !== undefined) {
    return overrideFlag;
  }
  if (!config) {
    return true;
  }
  if (config.enabled === false) {
    return false;
  }
  return config.idiomsEnabled !== false;
}

/**
 * Persists the idiomsEnabled toggle in `aice.config.json` or `.aice-idioms.json` (and updates `.aice-cache/idioms.json` if present).
 */
export function setProjectIdiomsEnabled(projectDir: string, enabled: boolean): AiceProjectConfig {
  let resolvedDir = findProjectRoot(projectDir);
  if (
    resolvedDir === path.resolve(projectDir) &&
    path.basename(resolvedDir) === "src" &&
    !fs.existsSync(path.join(resolvedDir, "aice.config.json")) &&
    !fs.existsSync(path.join(resolvedDir, ".aice-idioms.json"))
  ) {
    resolvedDir = path.dirname(resolvedDir);
  }
  const hasAiceConfig = fs.existsSync(path.join(resolvedDir, "aice.config.json"));
  const hasIdiomsJson = fs.existsSync(path.join(resolvedDir, ".aice-idioms.json"));
  const current = loadProjectConfig(resolvedDir);
  const updated =
    hasIdiomsJson && !hasAiceConfig
      ? saveProjectConfig(resolvedDir, { idiomsEnabled: enabled })
      : saveProjectConfig(
          resolvedDir,
          {
            enabled: current.enabled ?? true,
            idiomsEnabled: enabled,
          },
          { stripLegacyKeys: true },
        );

  const cachePath = path.join(resolvedDir, ".aice-cache", "idioms.json");
  if (fs.existsSync(cachePath)) {
    try {
      const raw = JSON.parse(fs.readFileSync(cachePath, "utf-8"));
      raw.idiomsEnabled = enabled;
      fs.writeFileSync(cachePath, `${JSON.stringify(raw, null, 2)}\n`, "utf-8");
    } catch {
      // ignore cache sync errors
    }
  }

  return updated;
}

/**
 * Strips `sourceDir` prefix from a relative or normalized path.
 */
function stripSourceDirPrefix(filePath: string, sourceDir: string): string {
  const normPath = filePath.replace(/\\/g, "/");
  const normSourceDir = sourceDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

  if (!normSourceDir || normSourceDir === ".") {
    return normPath.replace(/^\.\//, "");
  }

  if (normPath === normSourceDir) {
    return "";
  }

  if (normPath.startsWith(`${normSourceDir}/`)) {
    return normPath.slice(normSourceDir.length + 1);
  }

  if (normPath.startsWith(`./${normSourceDir}/`)) {
    return normPath.slice(normSourceDir.length + 3);
  }

  return normPath.replace(/^\.\//, "");
}

/**
 * Derives the target relative path from a source relative path.
 */
function deriveTargetPath(relPath: string, targetLanguage: TargetLanguage = "typescript"): string {
  const dir = path.dirname(relPath);
  const base = path.basename(relPath);
  const targetBase = deriveTargetFilename(base, targetLanguage);

  if (dir === "." && !relPath.includes("/") && !relPath.includes("\\")) {
    return targetBase;
  }
  return path.join(dir, targetBase);
}

/**
 * Extracts relative path under sourceDir for an absolute path.
 */
function extractRelPathUsingSourceDir(absPath: string, sourceDir: string): string {
  const normPath = absPath.replace(/\\/g, "/");
  const normSourceDir = sourceDir
    .replace(/\\/g, "/")
    .replace(/^\/+|\/+$/g, "")
    .replace(/^(?:\.\.?\/)+/, "");

  if (normSourceDir && normSourceDir !== ".") {
    const marker = `/${normSourceDir}/`;
    const idx = normPath.lastIndexOf(marker);
    if (idx !== -1) {
      return normPath.slice(idx + marker.length);
    }
  }

  return path.basename(normPath);
}

/**
 * Resolves the destination target file path for a source `.aice` file
 * according to project configuration:
 * - For "side-by-side": outputs sibling target path in the source file's directory.
 * - For "isolated": mirrors relative path from `sourceDir` into `outDir` (`.aice-build/`).
 */
export function resolveTargetFile(
  config: AiceProjectConfig,
  sourceFile: string,
  projectRoot?: string,
): string {
  const isAbs = path.isAbsolute(sourceFile);

  // Side-by-side mode: sibling target path in same directory
  if (config.mode === "side-by-side") {
    const dir = path.dirname(sourceFile);
    const base = path.basename(sourceFile);
    const targetBase = deriveTargetFilename(base, config.targetLanguage);

    if (dir === "." && !sourceFile.includes("/") && !sourceFile.includes("\\")) {
      return targetBase;
    }
    return path.join(dir, targetBase);
  }

  // Isolated mode: mirrors relative path from sourceDir into outDir (.aice-build/)
  if (isAbs) {
    const root = projectRoot ? path.resolve(projectRoot) : undefined;
    const absSourceDir =
      config.sourceDir && path.isAbsolute(config.sourceDir)
        ? config.sourceDir
        : root
          ? path.resolve(root, config.sourceDir)
          : undefined;

    let relPathFromSourceDir: string;
    let baseOutDir: string;

    if (
      absSourceDir &&
      (sourceFile === absSourceDir ||
        sourceFile.startsWith(absSourceDir + path.sep) ||
        sourceFile.startsWith(`${absSourceDir}/`))
    ) {
      relPathFromSourceDir = path.relative(absSourceDir, sourceFile);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : root
            ? path.resolve(root, config.outDir)
            : path.resolve(absSourceDir, "..", config.outDir);
    } else if (
      root &&
      (sourceFile === root ||
        sourceFile.startsWith(root + path.sep) ||
        sourceFile.startsWith(`${root}/`))
    ) {
      const relToRoot = path.relative(root, sourceFile);
      relPathFromSourceDir = stripSourceDirPrefix(relToRoot, config.sourceDir);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : path.resolve(root, config.outDir);
    } else {
      relPathFromSourceDir = extractRelPathUsingSourceDir(sourceFile, config.sourceDir);
      const normPath = sourceFile.replace(/\\/g, "/");
      const normSourceDir = config.sourceDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const marker = `/${normSourceDir}/`;
      const idx = normPath.lastIndexOf(marker);
      const inferredRoot = idx !== -1 ? normPath.slice(0, idx) : path.dirname(sourceFile);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : path.resolve(inferredRoot, config.outDir);
    }

    const targetRel = deriveTargetPath(relPathFromSourceDir, config.targetLanguage);
    return path.resolve(baseOutDir, targetRel);
  }

  // Relative path input
  const relPathFromSourceDir = stripSourceDirPrefix(sourceFile, config.sourceDir);
  const targetRel = deriveTargetPath(relPathFromSourceDir, config.targetLanguage);
  return path.join(config.outDir, targetRel);
}

/**
 * Backward-compatible wrapper for resolveTargetFile.
 */
export function resolveTargetOutputPathForConfig(
  sourcePath: string,
  config: AiceProjectConfig,
  projectRoot?: string,
): string {
  return resolveTargetFile(config, sourcePath, projectRoot);
}
