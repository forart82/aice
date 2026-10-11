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

export type ProjectMode = "side-by-side" | "isolated";

export interface AilProjectConfig {
  mode: ProjectMode;
  sourceDir: string;
  outDir: string;
  targetLanguage: TargetLanguage;
  isolated: boolean;
  watermark: boolean;
}

export const VALID_PROJECT_MODES: ReadonlySet<ProjectMode> = new Set([
  "side-by-side",
  "isolated",
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
]);

export const DEFAULT_PROJECT_CONFIG: Readonly<AilProjectConfig> = Object.freeze({
  mode: "side-by-side",
  sourceDir: "src",
  outDir: ".ail-build",
  targetLanguage: "typescript",
  isolated: false,
  watermark: true,
});

const KNOWN_TARGET_EXTENSIONS: ReadonlySet<string> = new Set([
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
]);

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
      `Invalid project mode "${config.mode}". Valid modes are: "side-by-side", "isolated".`,
    );
  }

  if (
    config.targetLanguage !== undefined &&
    !VALID_TARGET_LANGUAGES.has(config.targetLanguage)
  ) {
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
      configToProcess.isolated !== undefined
        ? Boolean(configToProcess.isolated)
        : mode === "isolated";
  } else if (configToProcess.isolated !== undefined) {
    isolated = Boolean(configToProcess.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    // Mode auto-detection
    mode = autoDetectProjectMode(resolvedDir);
    isolated = mode === "isolated";
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
    isolated = config.isolated ?? (mode === "isolated");
  } else if (config.isolated !== undefined) {
    isolated = config.isolated;
    mode = isolated ? "isolated" : "side-by-side";
  } else if (existing.mode !== undefined) {
    mode = existing.mode as ProjectMode;
    isolated =
      existing.isolated !== undefined
        ? Boolean(existing.isolated)
        : mode === "isolated";
  } else if (existing.isolated !== undefined) {
    isolated = Boolean(existing.isolated);
    mode = isolated ? "isolated" : "side-by-side";
  } else {
    mode = DEFAULT_PROJECT_CONFIG.mode;
    isolated = DEFAULT_PROJECT_CONFIG.isolated;
  }

  const mergedConfig: AilProjectConfig = {
    mode,
    sourceDir: config.sourceDir ?? (existing.sourceDir as string) ?? DEFAULT_PROJECT_CONFIG.sourceDir,
    outDir: config.outDir ?? (existing.outDir as string) ?? DEFAULT_PROJECT_CONFIG.outDir,
    targetLanguage:
      config.targetLanguage ??
      (existing.targetLanguage as TargetLanguage) ??
      DEFAULT_PROJECT_CONFIG.targetLanguage,
    isolated,
    watermark:
      config.watermark ??
      (typeof existing.watermark === "boolean" ? existing.watermark : DEFAULT_PROJECT_CONFIG.watermark),
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
function deriveTargetPath(
  relPath: string,
  targetLanguage: TargetLanguage = "typescript",
): string {
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
  const normSourceDir = sourceDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");

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
 * Resolves the destination target file path for a source `.ail` file
 * according to project configuration:
 * - For "side-by-side": outputs sibling target path in the source file's directory.
 * - For "isolated": mirrors relative path from `sourceDir` into `outDir` (`.ail-build/`).
 */
export function resolveTargetOutputPathForConfig(
  sourcePath: string,
  config: AilProjectConfig,
  projectRoot?: string,
): string {
  const isAbs = path.isAbsolute(sourcePath);

  // Side-by-side mode: sibling target path in same directory
  if (config.mode === "side-by-side") {
    const dir = path.dirname(sourcePath);
    const base = path.basename(sourcePath);
    const targetBase = deriveTargetFilename(base, config.targetLanguage);

    if (dir === "." && !sourcePath.includes("/") && !sourcePath.includes("\\")) {
      return targetBase;
    }
    return path.join(dir, targetBase);
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

    if (absSourceDir && sourcePath.startsWith(absSourceDir)) {
      relPathFromSourceDir = path.relative(absSourceDir, sourcePath);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : root
            ? path.resolve(root, config.outDir)
            : path.resolve(absSourceDir, "..", config.outDir);
    } else if (root && sourcePath.startsWith(root)) {
      const relToRoot = path.relative(root, sourcePath);
      relPathFromSourceDir = stripSourceDirPrefix(relToRoot, config.sourceDir);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : path.resolve(root, config.outDir);
    } else {
      relPathFromSourceDir = extractRelPathUsingSourceDir(sourcePath, config.sourceDir);
      const normPath = sourcePath.replace(/\\/g, "/");
      const normSourceDir = config.sourceDir.replace(/\\/g, "/").replace(/^\/+|\/+$/g, "");
      const marker = `/${normSourceDir}/`;
      const idx = normPath.lastIndexOf(marker);
      const inferredRoot = idx !== -1 ? normPath.slice(0, idx) : path.dirname(sourcePath);
      baseOutDir =
        config.outDir && path.isAbsolute(config.outDir)
          ? config.outDir
          : path.resolve(inferredRoot, config.outDir);
    }

    const targetRel = deriveTargetPath(relPathFromSourceDir, config.targetLanguage);
    return path.resolve(baseOutDir, targetRel);
  }

  // Relative path input
  const relPathFromSourceDir = stripSourceDirPrefix(sourcePath, config.sourceDir);
  const targetRel = deriveTargetPath(relPathFromSourceDir, config.targetLanguage);
  return path.join(config.outDir, targetRel);
}
