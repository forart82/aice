/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Unified Project Configuration Engine (Step 14).
 * Manages `ail.config.json`, `.ailrc`, and `package.json` config discovery,
 * mode auto-detection ("side-by-side" vs "isolated"), robust default options,
 * and target output path resolution.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TargetLanguage } from "../emitters/context.js";

export type ProjectMode = "side-by-side" | "isolated" | "companion" | "twinless";

export interface ProjectIdiomParam {
  name: string; // e.g. "$0", "$1"
  type?: string;
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
  templateAil: string;
  occurrences: number;
  tokensPerOccurrenceSaved: number;
  netTokenSavings: number;
  description?: string;
}

export interface AilProjectConfig {
  mode: ProjectMode;
  sourceDir: string;
  outDir: string;
  targetLanguage: TargetLanguage;
  isolated: boolean;
  watermark: boolean;
  targetProjectDir?: string;
  test?: {
    command?: string;
    cwd?: string;
    scrubTraces?: boolean;
    [key: string]: any;
  };
  idiomsEnabled?: boolean;
  idioms?: Record<string, ProjectIdiomDefinition>;
}

export const VALID_PROJECT_MODES: ReadonlySet<ProjectMode> = new Set([
  "side-by-side",
  "isolated",
  "companion",
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

export const DEFAULT_PROJECT_CONFIG: Readonly<AilProjectConfig> = Object.freeze({
  mode: "side-by-side",
  sourceDir: "src",
  outDir: ".ail-build",
  targetLanguage: "typescript",
  isolated: false,
  watermark: true,
});

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
  ".ail-build",
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
 * Derives target filename by stripping `.ail` or applying target language extension.
 * E.g.:
 * - `App.tsx.ail` -> `App.tsx`
 * - `calc.ts.ail` -> `calc.ts`
 * - `calc.ail` (targetLanguage = "python") -> `calc.py`
 * - `calc.ail` (targetLanguage = "typescript") -> `calc.ts`
 */
export function deriveTargetFilename(
  filename: string,
  targetLanguage: TargetLanguage = "typescript",
): string {
  if (!filename.endsWith(".ail")) {
    return filename;
  }

  const withoutAil = filename.slice(0, -4);
  const innerExt = path.extname(withoutAil).toLowerCase();

  if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
    return withoutAil;
  }

  const defaultExt = getExtensionForTarget(targetLanguage);
  return `${withoutAil}${defaultExt}`;
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

/**
 * Validates partial or complete project configuration fields.
 */
export function validateConfig(config: Partial<AilProjectConfig>): void {
  if (config.mode !== undefined && !VALID_PROJECT_MODES.has(config.mode)) {
    throw new Error(
      `Invalid project mode "${config.mode}". Valid modes are: "side-by-side", "isolated", "companion".`,
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

  if (config.targetProjectDir !== undefined && typeof config.targetProjectDir !== "string") {
    throw new Error(
      `Invalid targetProjectDir: expected string, received ${typeof config.targetProjectDir}`,
    );
  }

  if (config.test !== undefined) {
    if (typeof config.test !== "object" || config.test === null || Array.isArray(config.test)) {
      throw new Error(
        `Invalid test configuration: expected object, received ${Array.isArray(config.test) ? "array" : typeof config.test}`,
      );
    }
  }

  if (config.idioms !== undefined) {
    if (typeof config.idioms !== "object" || config.idioms === null || Array.isArray(config.idioms)) {
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
      if (typeof idiom.templateAil !== "string") {
        throw new Error(`Invalid idiom "${name}": "templateAil" must be a string`);
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
 * Scans a directory for `.ail` files to differentiate dual-extension (*.ts.ail)
 * vs bare (*.ail) files for mode auto-detection.
 */
function scanAilFiles(
  dir: string,
  maxDepth = 6,
  currentDepth = 0,
): { dualExtCount: number; bareAilCount: number } {
  let dualExtCount = 0;
  let bareAilCount = 0;

  if (currentDepth > maxDepth || !fs.existsSync(dir)) {
    return { dualExtCount, bareAilCount };
  }

  let entries: fs.Dirent[] = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return { dualExtCount, bareAilCount };
  }

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!IGNORED_SCAN_DIRECTORIES.has(entry.name)) {
        const sub = scanAilFiles(fullPath, maxDepth, currentDepth + 1);
        dualExtCount += sub.dualExtCount;
        bareAilCount += sub.bareAilCount;
      }
    } else if (entry.isFile() && entry.name.endsWith(".ail")) {
      const withoutAil = entry.name.slice(0, -4);
      const innerExt = path.extname(withoutAil).toLowerCase();
      if (innerExt && KNOWN_TARGET_EXTENSIONS.has(innerExt)) {
        dualExtCount++;
      } else {
        bareAilCount++;
      }
    }
  }

  return { dualExtCount, bareAilCount };
}

/**
 * Heuristically auto-detects whether a workspace is configured for "side-by-side"
 * or "isolated" compilation.
 *
 * Rules:
 * 1. If `.ail-build` directory exists -> "isolated"
 * 2. If bare `*.ail` files outnumber dual-ext `*.ts.ail` files -> "isolated"
 * 3. If dual-ext `*.ts.ail` files exist -> "side-by-side"
 * 4. Fallback default -> "side-by-side"
 */
export function autoDetectProjectMode(projectDir: string): ProjectMode {
  const resolvedDir = path.resolve(projectDir);

  // 0. Check if ail.config.json or .ailrc explicitly specifies companion mode
  const ailConfigPath = path.join(resolvedDir, "ail.config.json");
  if (fs.existsSync(ailConfigPath)) {
    try {
      const content = fs.readFileSync(ailConfigPath, "utf-8");
      const parsed = JSON.parse(stripJsonComments(content));
      if (parsed && parsed.mode === "companion") {
        return "companion";
      }
    } catch {
      // Ignore parse errors during auto-detection
    }
  }

  const ailrcPath = path.join(resolvedDir, ".ailrc");
  if (fs.existsSync(ailrcPath)) {
    try {
      const content = fs.readFileSync(ailrcPath, "utf-8");
      const parsed = JSON.parse(stripJsonComments(content));
      if (parsed && parsed.mode === "companion") {
        return "companion";
      }
    } catch {
      // Ignore parse errors during auto-detection
    }
  }

  // 1. Check if .ail-build exists
  const buildDir = path.join(resolvedDir, ".ail-build");
  if (fs.existsSync(buildDir)) {
    return "isolated";
  }

  // 2. Scan files
  const { dualExtCount, bareAilCount } = scanAilFiles(resolvedDir);

  if (bareAilCount > dualExtCount) {
    return "isolated";
  }

  if (dualExtCount > 0) {
    return "side-by-side";
  }

  return "side-by-side";
}

/**
 * Searches upward from `startDir` to locate a project root containing
 * `ail.config.json`, `.ailrc`, `.ail-build`, or `package.json`.
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
      fs.existsSync(path.join(cur, "ail.config.json")) ||
      fs.existsSync(path.join(cur, ".ailrc")) ||
      fs.existsSync(path.join(cur, ".ail-build")) ||
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
 * Loads project configuration from `ail.config.json`, `.ailrc`, or `package.json`'s "ail" field.
 * If no config file is present, performs mode auto-detection and returns defaults.
 */
export function loadProjectConfig(projectDir: string): AilProjectConfig {
  const resolvedDir = path.resolve(projectDir);

  let rawConfig: Record<string, unknown> | null = null;

  // 1. Try ail.config.json
  const ailConfigPath = path.join(resolvedDir, "ail.config.json");
  if (fs.existsSync(ailConfigPath)) {
    try {
      const content = fs.readFileSync(ailConfigPath, "utf-8");
      rawConfig = JSON.parse(stripJsonComments(content));
    } catch (err) {
      throw new Error(
        `Failed to parse ${ailConfigPath}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  // 2. Try .ailrc
  if (!rawConfig) {
    const ailrcPath = path.join(resolvedDir, ".ailrc");
    if (fs.existsSync(ailrcPath)) {
      try {
        const content = fs.readFileSync(ailrcPath, "utf-8");
        rawConfig = JSON.parse(stripJsonComments(content));
      } catch (err) {
        throw new Error(
          `Failed to parse ${ailrcPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  // 3. Try package.json's "ail" field
  if (!rawConfig) {
    const pkgPath = path.join(resolvedDir, "package.json");
    if (fs.existsSync(pkgPath)) {
      try {
        const content = fs.readFileSync(pkgPath, "utf-8");
        const parsed = JSON.parse(content);
        if (parsed && typeof parsed.ail === "object" && parsed.ail !== null) {
          rawConfig = parsed.ail as Record<string, unknown>;
        }
      } catch (err) {
        throw new Error(
          `Failed to parse ${pkgPath}: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    }
  }

  const configToProcess = rawConfig ?? {};

  // Determine mode and isolated
  let mode: ProjectMode;
  let isolated: boolean;

  if (configToProcess.mode !== undefined) {
    mode = configToProcess.mode as ProjectMode;
    isolated =
      typeof configToProcess.isolated === "boolean"
        ? configToProcess.isolated
        : mode === "isolated" || mode === "companion";
  } else if (configToProcess.isolated !== undefined) {
    isolated = Boolean(configToProcess.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    // Mode auto-detection
    mode = autoDetectProjectMode(resolvedDir);
    isolated = mode === "isolated" || mode === "companion";
  }

  const finalConfig: AilProjectConfig = {
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
    ...(typeof configToProcess.targetProjectDir === "string"
      ? { targetProjectDir: configToProcess.targetProjectDir }
      : {}),
    ...(typeof configToProcess.test === "object" && configToProcess.test !== null
      ? { test: configToProcess.test as AilProjectConfig["test"] }
      : {}),
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
 * Saves or updates project configuration in `ail.config.json`.
 */
export function saveProjectConfig(
  projectDir: string,
  config: Partial<AilProjectConfig>,
): AilProjectConfig {
  const resolvedDir = path.resolve(projectDir);
  if (!fs.existsSync(resolvedDir)) {
    fs.mkdirSync(resolvedDir, { recursive: true });
  }

  const configPath = path.join(resolvedDir, "ail.config.json");
  let existing: Record<string, unknown> = {};

  if (fs.existsSync(configPath)) {
    try {
      const content = fs.readFileSync(configPath, "utf-8");
      existing = JSON.parse(stripJsonComments(content));
    } catch {
      existing = {};
    }
  }

  let mode: ProjectMode;
  let isolated: boolean;

  if (config.mode !== undefined) {
    mode = config.mode;
    isolated = config.isolated ?? (mode === "isolated" || mode === "companion");
  } else if (config.isolated !== undefined) {
    isolated = config.isolated;
    mode = isolated ? "isolated" : "side-by-side";
  } else if (existing.mode !== undefined) {
    mode = existing.mode as ProjectMode;
    isolated =
      existing.isolated !== undefined
        ? Boolean(existing.isolated)
        : mode === "isolated" || mode === "companion";
  } else if (existing.isolated !== undefined) {
    isolated = Boolean(existing.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    mode = DEFAULT_PROJECT_CONFIG.mode;
    isolated = DEFAULT_PROJECT_CONFIG.isolated;
  }

  const mergedConfig: AilProjectConfig = {
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
    ...(config.targetProjectDir !== undefined
      ? { targetProjectDir: config.targetProjectDir }
      : typeof existing.targetProjectDir === "string"
        ? { targetProjectDir: existing.targetProjectDir }
        : {}),
    ...(config.test !== undefined
      ? { test: config.test }
      : typeof existing.test === "object" && existing.test !== null
        ? { test: existing.test as AilProjectConfig["test"] }
        : {}),
    ...(config.idiomsEnabled !== undefined
      ? { idiomsEnabled: config.idiomsEnabled }
      : typeof existing.idiomsEnabled === "boolean"
        ? { idiomsEnabled: existing.idiomsEnabled }
        : {}),
    ...(config.idioms !== undefined
      ? { idioms: config.idioms }
      : typeof existing.idioms === "object" && existing.idioms !== null && !Array.isArray(existing.idioms)
        ? { idioms: existing.idioms as Record<string, ProjectIdiomDefinition> }
        : {}),
  };

  validateConfig(mergedConfig);

  const toWrite = {
    ...existing,
    ...mergedConfig,
  };

  fs.writeFileSync(configPath, `${JSON.stringify(toWrite, null, 2)}\n`, "utf-8");
  return mergedConfig;
}

/**
 * Returns whether project idioms are currently enabled, honoring an optional per-call override flag.
 */
export function isProjectIdiomsEnabled(
  config?: Partial<AilProjectConfig> | null,
  overrideFlag?: boolean,
): boolean {
  if (overrideFlag !== undefined) {
    return overrideFlag;
  }
  if (!config) {
    return true;
  }
  return config.idiomsEnabled !== false;
}

/**
 * Persists the idiomsEnabled toggle in `ail.config.json` (and updates `.ail-cache/idioms.json` if present).
 */
export function setProjectIdiomsEnabled(
  projectDir: string,
  enabled: boolean,
): AilProjectConfig {
  let resolvedDir = findProjectRoot(projectDir);
  if (
    resolvedDir === path.resolve(projectDir) &&
    path.basename(resolvedDir) === "src" &&
    !fs.existsSync(path.join(resolvedDir, "ail.config.json"))
  ) {
    resolvedDir = path.dirname(resolvedDir);
  }
  const updated = saveProjectConfig(resolvedDir, { idiomsEnabled: enabled });

  const cachePath = path.join(resolvedDir, ".ail-cache", "idioms.json");
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
 * Derives the companion source filename by stripping target extension and appending `.ail`.
 * E.g.:
 * - `calc.ts` -> `calc.ail`
 * - `Button.tsx` -> `Button.ail`
 * - `calc.test.ts` -> `calc.test.ail`
 * - `main.py` -> `main.ail`
 * - `calc.ail` -> `calc.ail`
 */
export function deriveSourceFilename(filename: string): string {
  if (filename.endsWith(".ail")) {
    return filename;
  }
  const ext = path.extname(filename).toLowerCase();
  if (ext && KNOWN_TARGET_EXTENSIONS.has(ext)) {
    return `${filename.slice(0, -ext.length)}.ail`;
  }
  return `${filename}.ail`;
}

/**
 * Resolves the destination target file path for a source `.ail` file
 * according to project configuration:
 * - For "side-by-side": outputs sibling target path in the source file's directory.
 * - For "isolated": mirrors relative path from `sourceDir` into `outDir` (`.ail-build/`).
 * - For "companion": mirrors relative path of `sourceFile` from `sourceDir` (or config root),
 *   strips `.ail`, appends target extension, and joins with `config.outDir` (resolved against projectRoot).
 */
export function resolveTargetFile(
  config: AilProjectConfig,
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

  // Companion mode: mirrors relative path into outDir (resolved against projectRoot)
  if (config.mode === "companion") {
    const root = projectRoot ? path.resolve(projectRoot) : undefined;
    const absOutDir =
      config.outDir && path.isAbsolute(config.outDir)
        ? config.outDir
        : root
          ? path.resolve(root, config.outDir)
          : undefined;

    let relPathFromSourceDir: string;

    if (isAbs) {
      const absSourceDir =
        config.sourceDir && path.isAbsolute(config.sourceDir)
          ? config.sourceDir
          : root
            ? path.resolve(root, config.sourceDir)
            : undefined;

      if (
        absSourceDir &&
        (sourceFile === absSourceDir ||
          sourceFile.startsWith(absSourceDir + path.sep) ||
          sourceFile.startsWith(absSourceDir + "/"))
      ) {
        relPathFromSourceDir = path.relative(absSourceDir, sourceFile);
      } else if (
        root &&
        (sourceFile === root ||
          sourceFile.startsWith(root + path.sep) ||
          sourceFile.startsWith(root + "/"))
      ) {
        const relToRoot = path.relative(root, sourceFile);
        relPathFromSourceDir = stripSourceDirPrefix(relToRoot, config.sourceDir);
      } else {
        relPathFromSourceDir = extractRelPathUsingSourceDir(sourceFile, config.sourceDir);
      }
    } else {
      relPathFromSourceDir = stripSourceDirPrefix(sourceFile, config.sourceDir);
    }

    const targetRel = deriveTargetPath(relPathFromSourceDir, config.targetLanguage);

    if (absOutDir) {
      return path.resolve(absOutDir, targetRel);
    }
    if (root) {
      return path.resolve(root, config.outDir, targetRel);
    }
    return path.join(config.outDir, targetRel);
  }

  // Isolated mode: mirrors relative path from sourceDir into outDir (.ail-build/)
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
        sourceFile.startsWith(absSourceDir + "/"))
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
        sourceFile.startsWith(root + "/"))
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
  config: AilProjectConfig,
  projectRoot?: string,
): string {
  return resolveTargetFile(config, sourcePath, projectRoot);
}

/**
 * Resolves the source `.ail` file path corresponding to a target file.
 * - For "side-by-side": returns sibling `.ail` (or dual-extension `.ts.ail` if present).
 * - For "companion": computes relative path of targetFile from `config.outDir`,
 *   strips target extension, appends `.ail`, and joins with `config.sourceDir` (resolved against projectRoot).
 * - For "isolated": computes relative path of targetFile from `config.outDir`,
 *   strips target extension, appends `.ail`, and joins with `config.sourceDir`.
 */
export function resolveSourceFile(
  config: AilProjectConfig,
  targetFile: string,
  projectRoot?: string,
): string {
  const isAbs = path.isAbsolute(targetFile);

  if (config.mode === "side-by-side") {
    const dir = path.dirname(targetFile);
    const base = path.basename(targetFile);
    const sourceBase = deriveSourceFilename(base);
    const bareCandidate =
      dir === "." && !targetFile.includes("/") && !targetFile.includes("\\")
        ? sourceBase
        : path.join(dir, sourceBase);
    const dualCandidate = `${targetFile}.ail`;
    if (fs.existsSync(dualCandidate) && !fs.existsSync(bareCandidate)) {
      return dualCandidate;
    }
    return bareCandidate;
  }

  // Companion or isolated mode
  const root = projectRoot ? path.resolve(projectRoot) : undefined;
  const absOutDir =
    config.outDir && path.isAbsolute(config.outDir)
      ? config.outDir
      : root
        ? path.resolve(root, config.outDir)
        : undefined;

  const absSourceDir =
    config.sourceDir && path.isAbsolute(config.sourceDir)
      ? config.sourceDir
      : root
        ? path.resolve(root, config.sourceDir)
        : undefined;

  let relPathFromOutDir: string;

  if (isAbs) {
    const absTarget = targetFile;
    const normTarget = absTarget.replace(/\\/g, "/");
    const absTargetProjectDir =
      root && config.targetProjectDir ? path.resolve(root, config.targetProjectDir) : undefined;
    const normTargetProjectDir = absTargetProjectDir
      ? absTargetProjectDir.replace(/\\/g, "/")
      : undefined;

    if (
      absOutDir &&
      (targetFile === absOutDir ||
        targetFile.startsWith(absOutDir + path.sep) ||
        targetFile.startsWith(absOutDir + "/"))
    ) {
      relPathFromOutDir = path.relative(absOutDir, targetFile);
    } else if (
      root &&
      (targetFile === root ||
        targetFile.startsWith(root + path.sep) ||
        targetFile.startsWith(root + "/"))
    ) {
      const relToRoot = path.relative(root, targetFile);
      relPathFromOutDir = stripSourceDirPrefix(relToRoot, config.outDir);
    } else if (
      normTargetProjectDir &&
      (normTarget === normTargetProjectDir || normTarget.startsWith(`${normTargetProjectDir}/`))
    ) {
      relPathFromOutDir = path.relative(absTargetProjectDir!, absTarget);
    } else {
      relPathFromOutDir = extractRelPathUsingSourceDir(targetFile, config.outDir);
    }
  } else {
    // Relative path input
    relPathFromOutDir = stripSourceDirPrefix(targetFile, config.outDir);
  }

  // Derive source relative path by stripping target extension and appending .ail
  const dir = path.dirname(relPathFromOutDir);
  const base = path.basename(relPathFromOutDir);
  const sourceBase = deriveSourceFilename(base);
  const sourceRel =
    dir === "." && !relPathFromOutDir.includes("/") && !relPathFromOutDir.includes("\\")
      ? sourceBase
      : path.join(dir, sourceBase);

  // If absSourceDir exists or can be resolved
  if (absSourceDir) {
    const bareCandidate = path.resolve(absSourceDir, sourceRel);
    const dualCandidate = path.resolve(
      absSourceDir,
      dir === "." ? `${base}.ail` : path.join(dir, `${base}.ail`),
    );
    if (fs.existsSync(dualCandidate) && !fs.existsSync(bareCandidate)) {
      return dualCandidate;
    }
    return bareCandidate;
  }

  if (root) {
    const bareCandidate = path.resolve(root, config.sourceDir, sourceRel);
    const dualCandidate = path.resolve(
      root,
      config.sourceDir,
      dir === "." ? `${base}.ail` : path.join(dir, `${base}.ail`),
    );
    if (fs.existsSync(dualCandidate) && !fs.existsSync(bareCandidate)) {
      return dualCandidate;
    }
    return bareCandidate;
  }

  if (isAbs) {
    const normPath = targetFile.replace(/\\/g, "/");
    const normOutDir = config.outDir
      .replace(/\\/g, "/")
      .replace(/^\/+|\/+$/g, "")
      .replace(/^(?:\.\.?\/)+/, "");
    const marker = `/${normOutDir}/`;
    const idx = normPath.lastIndexOf(marker);
    const inferredRoot = idx !== -1 ? normPath.slice(0, idx) : path.dirname(targetFile);
    const baseSourceDir =
      config.sourceDir && path.isAbsolute(config.sourceDir)
        ? config.sourceDir
        : path.resolve(inferredRoot, config.sourceDir);
    const bareCandidate = path.resolve(baseSourceDir, sourceRel);
    const dualCandidate = path.resolve(
      baseSourceDir,
      dir === "." ? `${base}.ail` : path.join(dir, `${base}.ail`),
    );
    if (fs.existsSync(dualCandidate) && !fs.existsSync(bareCandidate)) {
      return dualCandidate;
    }
    return bareCandidate;
  }

  return path.join(config.sourceDir, sourceRel);
}
