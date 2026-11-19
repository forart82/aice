/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Unified Project Configuration Engine (Step 14).
 * Manages `aice.config.json`, `.aicerc`, and `package.json` config discovery,
 * mode auto-detection ("side-by-side" vs "isolated"), robust default options,
 * and target output path resolution.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { TargetLanguage } from "../emitters/context.js";
import { isLikelyNonExistentFilePath } from "./file-classification.js";

export type { TargetLanguage };

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
  allowedReadRoots?: string[];
}

export type ProjectConfig = AiceProjectConfig;

export const AICE_DISABLED_MESSAGE =
  "AICE is disabled for this project via aice.config.json (\"enabled\": false). Use native tools or run 'aice enable'.";

export const VALID_PROJECT_MODES: ReadonlySet<ProjectMode> = new Set([
  "side-by-side",
  "isolated",
  "twinless",
]);
export const VALID_TARGET_LANGUAGES: ReadonlySet<TargetLanguage> = new Set([
  "typescript",
  "javascript",
  "tsx",
  "python",
  "html",
  "css",
  "go",
  "rust",
  "cpp",
  "csharp",
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
Object.defineProperty(_defaultProjectConfig, "idiomsEnabled", {
  value: false,
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
  ".pyi",
  ".rs",
  ".go",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
  ".java",
  ".html",
  ".htm",
  ".xml",
  ".css",
  ".js",
  ".jsx",
  ".mjs",
  ".cjs",
  ".json",
  ".webmanifest",
  ".yaml",
  ".yml",
  ".cff",
  ".twig",
  ".php",
  ".kt",
  ".kts",
  ".gradle",
  ".pro",
  ".properties",
  ".example",
  ".sh",
  ".bash",
  ".zsh",
  ".ps1",
  ".cmd",
  ".bat",
  ".md",
  ".markdown",
  ".aipl",
]);
export const TARGET_EXT_MAP: Readonly<Record<string, TargetLanguage>> = Object.freeze({
  ".ts": "typescript",
  ".tsx": "tsx",
  ".js": "typescript",
  ".jsx": "tsx",
  ".mjs": "typescript",
  ".cjs": "typescript",
  ".py": "python",
  ".pyi": "python",
  ".rs": "rust",
  ".go": "go",
  ".cpp": "cpp",
  ".hpp": "cpp",
  ".cc": "cpp",
  ".cxx": "cpp",
  ".h": "cpp",
  ".cs": "csharp",
  ".java": "kotlin",
  ".html": "html",
  ".htm": "html",
  ".xml": "html",
  ".css": "css",
  ".json": "json",
  ".webmanifest": "json",
  ".yaml": "yaml",
  ".yml": "yaml",
  ".cff": "yaml",
  ".twig": "twig",
  ".php": "php",
  ".kt": "kotlin",
  ".kts": "kotlin",
  ".gradle": "kotlin",
  ".pro": "shell",
  ".properties": "shell",
  ".example": "shell",
  ".sh": "shell",
  ".bash": "shell",
  ".zsh": "shell",
  ".ps1": "powershell",
  ".cmd": "batch",
  ".bat": "batch",
  ".md": "markdown",
  ".markdown": "markdown",
  ".aipl": "aipl",
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
    case "javascript":
      return ".js";
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
    case "kotlin":
      return ".kt";
    case "php":
      return ".php";
    case "twig":
      return ".twig";
    case "html":
      return ".html";
    case "css":
      return ".css";
    case "json":
      return ".json";
    case "yaml":
      return ".yaml";
    case "shell":
      return ".sh";
    case "powershell":
      return ".ps1";
    case "batch":
      return ".cmd";
    case "markdown":
      return ".md";
    case "aipl":
      return ".aipl";
  }
}
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

  if (config.allowedReadRoots !== undefined) {
    if (!Array.isArray(config.allowedReadRoots)) {
      throw new Error(
        `Invalid allowedReadRoots: expected array of string paths, received ${typeof config.allowedReadRoots}`,
      );
    }
    for (let i = 0; i < config.allowedReadRoots.length; i++) {
      const r = config.allowedReadRoots[i];
      if (typeof r !== "string") {
        throw new Error(
          `Invalid allowedReadRoots[${i}]: expected string path, received ${typeof r}`,
        );
      }
    }
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

function isLikelyTargetFilePath(rawInput: string, resolvedPath: string): boolean {
  if (isLikelyNonExistentFilePath(rawInput, resolvedPath)) {
    return true;
  }
  const ext = path.extname(resolvedPath).toLowerCase();
  return Boolean(ext && KNOWN_TARGET_EXTENSIONS.has(ext));
}

/**
 * Searches upward from `startDir` to locate a project root containing
 * `aice.config.json`, `.aice-idioms.json`, `.aicerc`, `.aice-build`, or `package.json`.
 * If none is found, falls back to `fallbackDir` only when `startDir` resides within `fallbackDir`,
 * otherwise returns `startDir` (or its parent directory if `startDir` is a file path).
 */
export function findProjectRoot(startDir: string, fallbackDir?: string): string {
  let cur = path.resolve(startDir);
  try {
    if (fs.existsSync(cur)) {
      if (!fs.statSync(cur).isDirectory()) {
        cur = path.dirname(cur);
      }
    } else if (isLikelyTargetFilePath(startDir, cur)) {
      cur = path.dirname(cur);
    }
  } catch {
    cur = path.dirname(cur);
  }
  const initialDir = cur;
  const cwd = path.resolve(process.cwd());
  const homeDir = process.env.HOME ? path.resolve(process.env.HOME) : "";
  const tmpRoot = path.resolve(os.tmpdir());
  const startedInCwd = initialDir === cwd || initialDir.startsWith(`${cwd}${path.sep}`);

  while (true) {
    if (homeDir && cur === homeDir && initialDir !== homeDir) {
      break;
    }
    if ((cur === "/tmp" || cur === "/var/tmp" || cur === tmpRoot) && initialDir !== cur) {
      break;
    }
    if (
      fs.existsSync(path.join(cur, "aice.config.json")) ||
      fs.existsSync(path.join(cur, ".aice-idioms.json")) ||
      fs.existsSync(path.join(cur, ".aicerc")) ||
      fs.existsSync(path.join(cur, ".aice-build")) ||
      fs.existsSync(path.join(cur, "package.json")) ||
      fs.existsSync(path.join(cur, "composer.json")) ||
      fs.existsSync(path.join(cur, "Cargo.toml")) ||
      fs.existsSync(path.join(cur, "go.mod")) ||
      fs.existsSync(path.join(cur, "pyproject.toml")) ||
      fs.existsSync(path.join(cur, ".git"))
    ) {
      return cur;
    }
    if (startedInCwd && cur === cwd) {
      break;
    }
    const parent = path.dirname(cur);
    if (parent === cur) {
      break;
    }
    cur = parent;
  }

  if (
    (path.basename(initialDir) === "src" || path.basename(initialDir) === "tests") &&
    fs.existsSync(path.join(path.dirname(initialDir), "src")) &&
    fs.existsSync(path.join(path.dirname(initialDir), "tests"))
  ) {
    return path.dirname(initialDir);
  }
  if (fallbackDir) {
    const resolvedFallback = path.resolve(fallbackDir);
    const fallbackRoot = path.parse(resolvedFallback).root;
    if (resolvedFallback !== fallbackRoot) {
      const rel = path.relative(resolvedFallback, initialDir);
      if (rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel))) {
        return resolvedFallback;
      }
    } else if (initialDir === resolvedFallback) {
      return resolvedFallback;
    }
  }
  return initialDir;
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
      const stripped = stripJsonComments(content).trim();
      if (stripped.length === 0) {
        rawConfig = {};
      } else {
        const parsed: unknown = JSON.parse(stripped);
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          throw new Error("Root configuration value must be a JSON object");
        }
        rawConfig = parsed as Record<string, unknown>;
      }
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
        const stripped = stripJsonComments(content).trim();
        if (stripped.length === 0) {
          rawConfig = {};
        } else {
          const parsed: unknown = JSON.parse(stripped);
          if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
            throw new Error("Root configuration value must be a JSON object");
          }
          rawConfig = parsed as Record<string, unknown>;
        }
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
        if (
          parsed &&
          typeof parsed.aice === "object" &&
          parsed.aice !== null &&
          !Array.isArray(parsed.aice)
        ) {
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
    ...(Array.isArray(configToProcess.allowedReadRoots)
      ? {
          allowedReadRoots: configToProcess.allowedReadRoots
            .filter((r): r is string => typeof r === "string" && r.trim().length > 0)
            .map((r) => r.trim()),
        }
      : {}),
  };

  if (typeof configToProcess.idiomsEnabled !== "boolean") {
    Object.defineProperty(finalConfig, "idiomsEnabled", {
      value: Boolean(DEFAULT_PROJECT_CONFIG.idiomsEnabled),
      enumerable: false,
      writable: true,
      configurable: true,
    });
  }

  validateConfig(finalConfig);
  return finalConfig;
}

/**
 * Atomically writes text content to `filePath` via a sibling temporary file + `renameSync`.
 * Resolves existing symlinks first so symlinked dotfile configs remain intact.
 */
export function writeFileAtomic(filePath: string, content: string): void {
  let targetPath = path.resolve(filePath);
  try {
    if (fs.existsSync(targetPath) && fs.lstatSync(targetPath).isSymbolicLink()) {
      targetPath = fs.realpathSync(targetPath);
    }
  } catch {
    targetPath = path.resolve(filePath);
  }
  const dir = path.dirname(targetPath);
  fs.mkdirSync(dir, { recursive: true });
  const tmpPath = path.join(
    dir,
    `.${path.basename(targetPath)}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 8)}.tmp`,
  );
  try {
    fs.writeFileSync(tmpPath, content, "utf-8");
    fs.renameSync(tmpPath, targetPath);
  } catch (err) {
    try {
      if (fs.existsSync(tmpPath)) {
        fs.unlinkSync(tmpPath);
      }
    } catch {
      // ignore cleanup failure
    }
    throw err;
  }
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
    const content = fs.readFileSync(configPath, "utf-8");
    const stripped = stripJsonComments(content).trim();
    if (stripped.length > 0) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(stripped);
      } catch (err) {
        throw new Error(
          `Cannot update malformed AICE config file ${configPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
        throw new Error(
          `Cannot update malformed AICE config file ${configPath}: root JSON value must be an object`,
        );
      }
      existing = parsed as Record<string, unknown>;
    }
  } else if (hasIdiomsJson) {
    const content = fs.readFileSync(idiomsJsonPath, "utf-8");
    const stripped = stripJsonComments(content).trim();
    if (stripped.length > 0) {
      let parsedRaw: unknown;
      try {
        parsedRaw = JSON.parse(stripped);
      } catch (err) {
        throw new Error(
          `Cannot update malformed AICE idioms file ${idiomsJsonPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
      if (!parsedRaw || typeof parsedRaw !== "object" || Array.isArray(parsedRaw)) {
        throw new Error(
          `Cannot update malformed AICE idioms file ${idiomsJsonPath}: root JSON value must be an object`,
        );
      }
      const parsed = parsedRaw as Record<string, unknown>;
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

  let normalizedExistingIdioms: Record<string, ProjectIdiomDefinition> | undefined;
  if (
    typeof existing.idioms === "object" &&
    existing.idioms !== null &&
    !Array.isArray(existing.idioms)
  ) {
    const rawMap = existing.idioms as Record<string, unknown>;
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
    normalizedExistingIdioms = normalizedMap as Record<string, ProjectIdiomDefinition>;
  }

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
      : normalizedExistingIdioms !== undefined
        ? { idioms: normalizedExistingIdioms }
        : {}),
    ...(config.allowedReadRoots !== undefined
      ? { allowedReadRoots: config.allowedReadRoots }
      : Array.isArray(existing.allowedReadRoots)
        ? { allowedReadRoots: existing.allowedReadRoots as string[] }
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
    writeFileAtomic(idiomsJsonPath, `${JSON.stringify(idiomsPayload, null, 2)}\n`);
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
    if (
      config.mode !== undefined ||
      config.isolated !== undefined ||
      (existing.mode !== undefined && existing.mode !== DEFAULT_PROJECT_CONFIG.mode) ||
      (existing.isolated !== undefined && existing.isolated !== DEFAULT_PROJECT_CONFIG.isolated)
    ) {
      toWrite.mode = mergedConfig.mode;
    }
    if (
      config.sourceDir !== undefined ||
      (existing.sourceDir !== undefined && existing.sourceDir !== DEFAULT_PROJECT_CONFIG.sourceDir)
    ) {
      toWrite.sourceDir = mergedConfig.sourceDir;
    }
    if (
      config.outDir !== undefined ||
      (existing.outDir !== undefined && existing.outDir !== DEFAULT_PROJECT_CONFIG.outDir)
    ) {
      toWrite.outDir = mergedConfig.outDir;
    }
    if (
      config.targetLanguage !== undefined ||
      (existing.targetLanguage !== undefined &&
        existing.targetLanguage !== DEFAULT_PROJECT_CONFIG.targetLanguage)
    ) {
      toWrite.targetLanguage = mergedConfig.targetLanguage;
    }
    if (
      config.isolated !== undefined ||
      (existing.isolated !== undefined && existing.isolated !== DEFAULT_PROJECT_CONFIG.isolated)
    ) {
      toWrite.isolated = mergedConfig.isolated;
    }
    if (
      config.watermark !== undefined ||
      (existing.watermark !== undefined && existing.watermark !== DEFAULT_PROJECT_CONFIG.watermark)
    ) {
      toWrite.watermark = mergedConfig.watermark;
    }
  }
  if (mergedConfig.idioms !== undefined) {
    toWrite.idioms = mergedConfig.idioms;
  }
  if (mergedConfig.allowedReadRoots !== undefined) {
    toWrite.allowedReadRoots = mergedConfig.allowedReadRoots;
  }

  writeFileAtomic(configPath, `${JSON.stringify(toWrite, null, 2)}\n`);

  if (hasIdiomsJson && (config.idioms !== undefined || config.idiomsEnabled !== undefined)) {
    try {
      const idiomsPayload = {
        idiomsEnabled: mergedConfig.idiomsEnabled ?? true,
        idioms: mergedConfig.idioms ?? {},
      };
      writeFileAtomic(idiomsJsonPath, `${JSON.stringify(idiomsPayload, null, 2)}\n`);
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

export const SUPPORTED_EXTENSIONS_LIST = Array.from(KNOWN_TARGET_EXTENSIONS).join(", ");

import {
  ALWAYS_ON_AICE_RULE_FILE,
  MANDATORY_AGENT_RULES_MARKDOWN,
} from "../rules/mandatory-rules.js";

export {
  AICE_DIRECTIVE_END,
  AICE_DIRECTIVE_START,
  AICE_SYSTEM_DIRECTIVE,
  ALWAYS_ON_AICE_RULE_FILE,
  CANONICAL_AICE_AGENT_DIRECTIVE,
  MANDATORY_AGENT_RULES_MARKDOWN,
} from "../rules/mandatory-rules.js";
/**
 * Locates all active line-anchored `<!-- AICE:START -->...<!-- AICE:END -->` directive spans
 * (and legacy `## AICE ... - MANDATORY` blocks, including unclosed blocks) outside Markdown
 * fenced code blocks (``` or ~~~).
 */
export function findAllDirectiveSpansOutsideFences(
  markdown: string,
): Array<{ startIdx: number; endOffset: number }> {
  const spans: Array<{ startIdx: number; endOffset: number }> = [];
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  let activeStartIdx = -1;

  let pos = 0;
  const totalLen = markdown.length;
  while (pos <= totalLen) {
    const nlIdx = markdown.indexOf("\n", pos);
    const lineEnd = nlIdx === -1 ? totalLen : nlIdx;
    const rawLine = markdown.slice(pos, lineEnd);
    const cleanLine = rawLine.endsWith("\r") ? rawLine.slice(0, -1) : rawLine;

    const fenceMatch = cleanLine.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      const ch = marker[0] as "`" | "~";
      const rest = fenceMatch[2] ?? "";
      if (!fenceChar) {
        if (ch === "~" || !rest.includes("`")) {
          fenceChar = ch;
          fenceLen = marker.length;
        }
      } else if (ch === fenceChar && marker.length >= fenceLen && /^[ \t]*$/.test(rest)) {
        fenceChar = null;
        fenceLen = 0;
      }
    } else if (!fenceChar) {
      const isStartLine =
        /^[ \t]*<!--\s*AICE:START(?:\s+v[0-9A-Za-z._-]+)?\s*-->[ \t]*$/.test(cleanLine) ||
        /^[ \t]*##\s+AICE(?:\s+\(?v?[0-9A-Za-z._-]+\)?)?\s*[-—]\s*(?:MANDATORY|\d+-Tool\s+AST\s+Cheat-Card)/i.test(
          cleanLine,
        );
      const isEndLine = /^[ \t]*<!--\s*AICE:END\s*-->[ \t]*$/.test(cleanLine);
      const isNonAiceTopHeading =
        /^[ \t]*#{1,2}[ \t]+/.test(cleanLine) && !/^[ \t]*##\s+AICE\b/i.test(cleanLine);

      if (activeStartIdx === -1) {
        if (isStartLine) {
          activeStartIdx = pos;
        }
      } else {
        if (isEndLine) {
          spans.push({ startIdx: activeStartIdx, endOffset: pos + cleanLine.length });
          activeStartIdx = -1;
        } else if (isNonAiceTopHeading) {
          spans.push({ startIdx: activeStartIdx, endOffset: pos });
          activeStartIdx = -1;
        }
        // Consecutive `<!-- AICE:START ... -->` lines stay part of the SAME active block
      }
    }

    if (nlIdx === -1) break;
    pos = nlIdx + 1;
  }

  if (activeStartIdx !== -1) {
    spans.push({ startIdx: activeStartIdx, endOffset: totalLen });
  }

  return spans;
}

/**
 * Locates the active line-anchored `<!-- AICE:START -->...<!-- AICE:END -->` directive span
 * outside Markdown fenced code blocks (``` or ~~~).
 */
export function findDirectiveSpanOutsideFences(
  markdown: string,
): { startIdx: number; endOffset: number } | null {
  return findAllDirectiveSpansOutsideFences(markdown)[0] ?? null;
}

/**
 * Strips all `<!-- AICE:START -->...<!-- AICE:END -->` directive spans (and legacy blocks)
 * outside fences while preserving all user text before, between, and after blocks with clean
 * `\n\n` paragraph spacing.
 */
export function stripAllMarkdownDirectives(markdown: string): {
  stripped: string;
  hadDirective: boolean;
} {
  const spans = findAllDirectiveSpansOutsideFences(markdown);
  if (spans.length === 0) {
    return { stripped: markdown.trim(), hadDirective: false };
  }

  const segments: string[] = [];
  let lastOffset = 0;
  for (const span of spans) {
    const segment = markdown.slice(lastOffset, span.startIdx).trim();
    if (segment.length > 0) {
      segments.push(segment);
    }
    lastOffset = span.endOffset;
  }
  const trailing = markdown.slice(lastOffset).trim();
  if (trailing.length > 0) {
    segments.push(trailing);
  }

  return {
    stripped: segments.join("\n\n"),
    hadDirective: true,
  };
}

export const AGENTS_MD_SAFE_BYTE_CAP = 22_000;

export interface WorkspaceRuleSyncOptions {
  force?: boolean;
  maxAgentsMdBytes?: number;
  enforceByteCap?: boolean;
  onWarning?: (message: string) => void;
}

function stripOrphanAiceMarkersOutsideFences(markdown: string): string {
  if (!markdown.includes("AICE:START") && !markdown.includes("AICE:END")) {
    return markdown;
  }
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  const kept: string[] = [];
  for (const rawLine of markdown.split(/\r?\n/)) {
    const fenceMatch = rawLine.match(/^[ \t]{0,3}(`{3,}|~{3,})(.*)$/);
    if (fenceMatch?.[1]) {
      const marker = fenceMatch[1];
      const ch = marker[0] as "`" | "~";
      const rest = fenceMatch[2] ?? "";
      if (!fenceChar) {
        if (ch === "~" || !rest.includes("`")) {
          fenceChar = ch;
          fenceLen = marker.length;
        }
      } else if (ch === fenceChar && marker.length >= fenceLen && /^[ \t]*$/.test(rest)) {
        fenceChar = null;
        fenceLen = 0;
      }
      kept.push(rawLine);
      continue;
    }
    if (
      !fenceChar &&
      /^[ \t]*<!--\s*AICE:(?:START(?:\s+v[0-9A-Za-z._-]+)?|END)\s*-->[ \t]*$/.test(rawLine)
    ) {
      continue;
    }
    kept.push(rawLine);
  }
  return kept.join("\n").trim();
}

export function upsertMarkdownDirective(
  mdPath: string,
  blockText?: string,
  options?: WorkspaceRuleSyncOptions,
): void {
  const rawBlock = blockText ?? MANDATORY_AGENT_RULES_MARKDOWN;
  const directiveBlock = rawBlock.replace(
    /^(?:[ \t]*<!--\s*AICE:START(?:\s+v[0-9A-Za-z._-]+)?\s*-->[ \t]*\r?\n)+(?=[ \t]*<!--\s*AICE:START\b)/,
    "",
  );
  fs.mkdirSync(path.dirname(mdPath), { recursive: true });
  let existing = "";
  if (fs.existsSync(mdPath)) {
    existing = fs.readFileSync(mdPath, "utf-8");
  }
  const { stripped: rawStripped } = stripAllMarkdownDirectives(existing);
  const stripped = stripOrphanAiceMarkersOutsideFences(rawStripped);

  let nextContent: string;
  if (stripped.length === 0) {
    nextContent = `${directiveBlock}\n`;
  } else {
    const headingMatch = stripped.match(/^(\s*#[ \t]+[^\r\n]+)/);
    if (headingMatch) {
      const heading = headingMatch[0].trim();
      const rest = stripped.slice(headingMatch[0].length).trim();
      nextContent =
        rest.length > 0
          ? `${heading}\n\n${directiveBlock}\n\n${rest}\n`
          : `${heading}\n\n${directiveBlock}\n`;
    } else {
      nextContent = `${directiveBlock}\n\n${stripped}\n`;
    }
  }

  if (options?.enforceByteCap) {
    const maxBytes = options.maxAgentsMdBytes ?? AGENTS_MD_SAFE_BYTE_CAP;
    const projectedBytes = Buffer.byteLength(nextContent, "utf-8");
    if (projectedBytes > maxBytes) {
      const warnMsg = `⚠️ Warning: Injecting AICE rules into ${mdPath} would reach ${projectedBytes} bytes (> ${maxBytes} B cap).${options.force ? " Proceeding because --force was set." : " Skipping AGENTS.md injection to protect workspace byte caps (pass --force to override)."}`;
      (options.onWarning ?? console.warn)(warnMsg);
      if (!options.force) {
        return;
      }
    }
  }

  writeFileAtomic(mdPath, nextContent);
}

/**
 * Cleanly removes the `<!-- AICE:START -->...<!-- AICE:END -->` block from a Markdown file.
 */
export function removeMarkdownDirective(
  mdPath: string,
  optionsOrRemoveIfEmpty: boolean | { removeIfEmpty?: boolean } = false,
): void {
  const removeIfEmpty =
    typeof optionsOrRemoveIfEmpty === "boolean"
      ? optionsOrRemoveIfEmpty
      : Boolean(optionsOrRemoveIfEmpty?.removeIfEmpty);
  if (!fs.existsSync(mdPath)) return;
  const existing = fs.readFileSync(mdPath, "utf-8");
  const { stripped, hadDirective } = stripAllMarkdownDirectives(existing);

  if (!hadDirective) {
    if (removeIfEmpty && existing.trim().length === 0) {
      try {
        fs.unlinkSync(mdPath);
      } catch {}
    }
    return;
  }

  if (stripped.length === 0) {
    if (removeIfEmpty) {
      try {
        fs.unlinkSync(mdPath);
      } catch {}
    } else {
      writeFileAtomic(mdPath, "");
    }
  } else {
    writeFileAtomic(mdPath, `${stripped}\n`);
  }
}

export function hasMarkdownDirective(mdPath: string): boolean {
  if (!fs.existsSync(mdPath)) return false;
  try {
    const text = fs.readFileSync(mdPath, "utf-8");
    return findDirectiveSpanOutsideFences(text) !== null;
  } catch {
    return false;
  }
}

/**
 * Writes an always-on agent rule file (`trigger: always_on` frontmatter + `<!-- AICE:START -->...<!-- AICE:END -->`).
 */
export function upsertAlwaysOnRuleFile(filePath: string): void {
  writeFileAtomic(filePath, ALWAYS_ON_AICE_RULE_FILE);
}
/**
 * Removes an always-on agent rule file and cleans up empty parent rule directories if empty.
 */
export function removeAlwaysOnRuleFile(filePath: string, cleanEmptyParents = false): boolean {
  if (!fs.existsSync(filePath)) return false;
  try {
    fs.unlinkSync(filePath);
    if (cleanEmptyParents) {
      let dir = path.dirname(filePath);
      for (let i = 0; i < 2; i++) {
        if (fs.existsSync(dir) && fs.readdirSync(dir).length === 0) {
          fs.rmdirSync(dir);
          dir = path.dirname(dir);
        } else {
          break;
        }
      }
    }
    return true;
  } catch {
    return false;
  }
}

/**
 * Detects whether a Markdown file (e.g. `CLAUDE.md`) already includes `@AGENTS.md`
 * (or `@./AGENTS.md`) outside fenced code blocks, avoiding duplicate rule injection.
 */
export function hasAgentsMdInclude(markdown: string): boolean {
  let fenceChar: "`" | "~" | null = null;
  let fenceLen = 0;
  for (const rawLine of markdown.split(/\r?\n/)) {
    const trimmedStart = rawLine.replace(/^[ \t]{0,3}/, "");
    const fenceMatch = trimmedStart.match(/^(`{3,}|~{3,})/);
    if (fenceMatch) {
      const marker = fenceMatch[1];
      const ch = marker[0] as "`" | "~";
      if (fenceChar === null) {
        fenceChar = ch;
        fenceLen = marker.length;
        continue;
      }
      if (ch === fenceChar && marker.length >= fenceLen && /^[`~]*[ \t]*$/.test(trimmedStart)) {
        fenceChar = null;
        fenceLen = 0;
        continue;
      }
    }
    if (fenceChar !== null) continue;
    if (/(?:^|[\s(])@(?:\.\/)?AGENTS\.md(?=$|[\s).,;:])/.test(rawLine)) {
      return true;
    }
  }
  return false;
}

function cleanEmptySubdir(dirPath: string): void {
  try {
    if (fs.existsSync(dirPath) && fs.readdirSync(dirPath).length === 0) {
      fs.rmdirSync(dirPath);
    }
  } catch {}
}

/**
 * Synchronizes project-level AI agent rules (`AGENTS.md`, plus existing `CLAUDE.md` without `@AGENTS.md`)
 * while purging legacy duplicate rule blocks from `GEMINI.md`, `.GEMINI.md`, `CODEX.md`, `.CODEX.md`,
 * `.codex/*`, and rule files under `.agents/rules/aice.md`, `.gemini/rules/aice.md`, `.claude/rules/aice.md`.
 */
function ensureGitInfoExcludeForUntrackedConfig(projectDir: string): void {
  try {
    const revParse = spawnSync("git", ["rev-parse", "--git-path", "info/exclude"], {
      cwd: projectDir,
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "ignore"],
    });
    if (revParse.status !== 0 || !revParse.stdout.trim()) {
      return;
    }
    const lsFiles = spawnSync("git", ["ls-files", "--error-unmatch", "aice.config.json"], {
      cwd: projectDir,
      stdio: "ignore",
    });
    if (lsFiles.status === 0) {
      // Tracked in git; do not add to info/exclude
      return;
    }
    const excludePath = path.resolve(projectDir, revParse.stdout.trim());
    fs.mkdirSync(path.dirname(excludePath), { recursive: true });
    const existing = fs.existsSync(excludePath) ? fs.readFileSync(excludePath, "utf-8") : "";
    const hasEntry = existing
      .split(/\r?\n/)
      .map((l) => l.trim())
      .some((l) => l === "aice.config.json" || l === "/aice.config.json");
    if (!hasEntry) {
      const prefix = existing.length === 0 || existing.endsWith("\n") ? existing : `${existing}\n`;
      fs.writeFileSync(excludePath, `${prefix}aice.config.json\n`, "utf-8");
    }
  } catch {
    // Ignore when git is unavailable or directory is not a git repository
  }
}

export function syncProjectWorkspaceRules(
  projectDir: string,
  enabled: boolean,
  options?: WorkspaceRuleSyncOptions,
): void {
  const resolvedDir = path.resolve(projectDir);
  const agentsMdPath = path.join(resolvedDir, "AGENTS.md");
  const claudeMdPath = path.join(resolvedDir, "CLAUDE.md");
  const dotClaudeMdPath = path.join(resolvedDir, ".claude", "CLAUDE.md");
  const geminiMdPath = path.join(resolvedDir, "GEMINI.md");
  const dotGeminiMdPath = path.join(resolvedDir, ".GEMINI.md");
  const codexMdPath = path.join(resolvedDir, "CODEX.md");
  const dotCodexMdPath = path.join(resolvedDir, ".CODEX.md");
  const dotCodexAgentsMdPath = path.join(resolvedDir, ".codex", "AGENTS.md");
  const dotCodexCodexMdPath = path.join(resolvedDir, ".codex", "CODEX.md");
  const dotCodexInstructionsMdPath = path.join(resolvedDir, ".codex", "instructions.md");

  // Always clean duplicate/legacy secondary surfaces on BOTH enable and disable
  removeMarkdownDirective(geminiMdPath, true);
  removeMarkdownDirective(dotGeminiMdPath, true);
  removeMarkdownDirective(codexMdPath, true);
  removeMarkdownDirective(dotCodexMdPath, true);
  removeMarkdownDirective(dotCodexAgentsMdPath, true);
  removeMarkdownDirective(dotCodexCodexMdPath, true);
  removeMarkdownDirective(dotCodexInstructionsMdPath, true);
  cleanEmptySubdir(path.join(resolvedDir, ".codex"));

  removeAlwaysOnRuleFile(path.join(resolvedDir, ".agents", "rules", "aice.md"), true);
  removeAlwaysOnRuleFile(path.join(resolvedDir, ".gemini", "rules", "aice.md"), true);
  removeAlwaysOnRuleFile(path.join(resolvedDir, ".claude", "rules", "aice.md"), true);

  if (enabled) {
    upsertMarkdownDirective(agentsMdPath, undefined, {
      ...options,
      enforceByteCap: true,
    });
    if (fs.existsSync(claudeMdPath)) {
      const claudeContent = fs.readFileSync(claudeMdPath, "utf-8");
      if (hasAgentsMdInclude(claudeContent)) {
        removeMarkdownDirective(claudeMdPath, true);
      } else {
        upsertMarkdownDirective(claudeMdPath, undefined, options);
      }
      removeMarkdownDirective(dotClaudeMdPath, true);
      cleanEmptySubdir(path.join(resolvedDir, ".claude"));
    } else if (fs.existsSync(dotClaudeMdPath)) {
      const dotClaudeContent = fs.readFileSync(dotClaudeMdPath, "utf-8");
      if (hasAgentsMdInclude(dotClaudeContent)) {
        removeMarkdownDirective(dotClaudeMdPath, true);
      } else {
        upsertMarkdownDirective(dotClaudeMdPath, undefined, options);
      }
    }
  } else {
    removeMarkdownDirective(agentsMdPath, true);
    removeMarkdownDirective(claudeMdPath, true);
    removeMarkdownDirective(dotClaudeMdPath, true);
    cleanEmptySubdir(path.join(resolvedDir, ".claude"));
  }
}

/**
 * Creates or updates `aice.config.json` with `"enabled": true | false` and synchronizes workspace agent rules.
 */
export function setProjectAiceEnabled(
  projectDir: string,
  enabled: boolean,
  options?: WorkspaceRuleSyncOptions,
): AiceProjectConfig {
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
  const saved = saveProjectConfig(
    resolvedDir,
    {
      enabled,
      idiomsEnabled:
        typeof current.idiomsEnabled === "boolean"
          ? current.idiomsEnabled
          : Boolean(DEFAULT_PROJECT_CONFIG.idiomsEnabled),
    },
    { stripLegacyKeys: true },
  );
  if (enabled) {
    ensureGitInfoExcludeForUntrackedConfig(resolvedDir);
  }
  syncProjectWorkspaceRules(resolvedDir, enabled, options);
  return saved;
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
    return Boolean(DEFAULT_PROJECT_CONFIG.idiomsEnabled);
  }
  if (config.enabled === false) {
    return false;
  }
  if (typeof config.idiomsEnabled === "boolean") {
    return config.idiomsEnabled;
  }
  return Boolean(DEFAULT_PROJECT_CONFIG.idiomsEnabled);
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
