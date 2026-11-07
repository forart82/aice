/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Polymorphic Path Resolver Engine (Step 23).
 * Provides unified polymorphic resolution for files, directories, or omitted arguments
 * across all CLI commands and tooling APIs, with first-class companion mode support.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AiceProjectConfig,
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  resolveSourceFile,
} from "./project-config.js";

export interface PathResolverOptions {
  /**
   * Extensions to filter when scanning directories (default: [".aice"]).
   */
  extensions?: string[];
  /**
   * Include target files if no .aice files exist in the scanned directory.
   */
  includeTargets?: boolean;
  /**
   * Explicit workspace project root (auto-discovered if omitted).
   */
  projectRoot?: string;
  /**
   * Pre-loaded project config (auto-loaded if omitted).
   */
  config?: AiceProjectConfig;
}

export interface ResolvedPathTargets {
  isSingleFile: boolean;
  isDirectory: boolean;
  isOmitted: boolean;
  resolvedPath: string;
  files: string[];
  projectRoot: string;
  config: AiceProjectConfig;
}

export const DEFAULT_IGNORED_SCAN_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".aice-build",
  ".agents",
  ".next",
  ".turbo",
  "coverage",
]);

/**
 * Checks whether `candidate` is equal to `parent` or is a descendant subdirectory/file of `parent`.
 */
export function isSameOrDescendant(parent: string | undefined, candidate: string): boolean {
  if (!parent) {
    return false;
  }
  const normParent = path.resolve(parent);
  const normCandidate = path.resolve(candidate);
  if (normParent === path.parse(normParent).root) {
    return normCandidate === normParent;
  }
  const rel = path.relative(normParent, normCandidate);
  return rel === "" || (!rel.startsWith("..") && !path.isAbsolute(rel));
}

/**
 * Checks whether `candidate` or its canonical realpath is equal to or inside `parent`.
 */
export function isRealPathSameOrDescendant(
  parent: string | undefined,
  candidate: string,
): boolean {
  if (!parent) {
    return false;
  }
  if (isSameOrDescendant(parent, candidate)) {
    return true;
  }
  try {
    const realParent = fs.realpathSync(parent);
    const realCandidate = fs.realpathSync(candidate);
    return isSameOrDescendant(realParent, realCandidate);
  } catch {
    return false;
  }
}

/**
 * Checks if a given path is within the target project directory or outDir of the companion config.
 */
export function isTargetProjectPath(
  candidatePath: string,
  config: AiceProjectConfig,
  projectRoot?: string,
): boolean {
  const root = projectRoot ? path.resolve(projectRoot) : undefined;
  const absOutDir = config.outDir
    ? path.isAbsolute(config.outDir)
      ? path.resolve(config.outDir)
      : root
        ? path.resolve(root, config.outDir)
        : undefined
    : undefined;

  const absTargetProjectDir = config.targetProjectDir
    ? path.isAbsolute(config.targetProjectDir)
      ? path.resolve(config.targetProjectDir)
      : root
        ? path.resolve(root, config.targetProjectDir)
        : undefined
    : undefined;

  return (
    isSameOrDescendant(absOutDir, candidatePath) ||
    isSameOrDescendant(absTargetProjectDir, candidatePath) ||
    isRealPathSameOrDescendant(absOutDir, candidatePath) ||
    isRealPathSameOrDescendant(absTargetProjectDir, candidatePath)
  );
}

/**
 * Resolves an external target file or directory path to its companion source path in the companion workspace.
 * Returns undefined if config is not in companion mode or if targetPath is outside outDir / targetProjectDir.
 */
export function resolveCompanionSource(
  targetPath: string,
  config: AiceProjectConfig,
  projectRoot?: string,
): string | undefined {
  if (config.mode !== "companion") {
    return undefined;
  }
  const root = projectRoot ? path.resolve(projectRoot) : undefined;
  const absTarget = path.isAbsolute(targetPath)
    ? path.resolve(targetPath)
    : path.resolve(root ?? process.cwd(), targetPath);

  const absOutDir = config.outDir
    ? path.isAbsolute(config.outDir)
      ? path.resolve(config.outDir)
      : root
        ? path.resolve(root, config.outDir)
        : undefined
    : undefined;

  const absSourceDir = config.sourceDir
    ? path.isAbsolute(config.sourceDir)
      ? path.resolve(config.sourceDir)
      : root
        ? path.resolve(root, config.sourceDir)
        : root
    : root;

  const absTargetProjectDir = config.targetProjectDir
    ? path.isAbsolute(config.targetProjectDir)
      ? path.resolve(config.targetProjectDir)
      : root
        ? path.resolve(root, config.targetProjectDir)
        : undefined
    : undefined;

  // Check if directory
  let isDir = false;
  if (fs.existsSync(absTarget)) {
    try {
      isDir = fs.statSync(absTarget).isDirectory();
    } catch {
      isDir = false;
    }
  } else {
    isDir =
      targetPath.endsWith("/") ||
      targetPath.endsWith("\\") ||
      (path.extname(absTarget) === "" && !targetPath.endsWith(".aice"));
  }

  if (isDir) {
    if (absOutDir && isSameOrDescendant(absOutDir, absTarget)) {
      const rel = path.relative(absOutDir, absTarget);
      return rel && absSourceDir ? path.resolve(absSourceDir, rel) : absSourceDir;
    }
    if (absTargetProjectDir && isSameOrDescendant(absTargetProjectDir, absTarget)) {
      const rel = path.relative(absTargetProjectDir, absTarget);
      return rel && root ? path.resolve(root, rel) : (absSourceDir ?? root);
    }
    return undefined;
  }

  // File: verify that it is within outDir or targetProjectDir or isTargetProjectPath
  if (
    (absOutDir && isSameOrDescendant(absOutDir, absTarget)) ||
    (absTargetProjectDir && isSameOrDescendant(absTargetProjectDir, absTarget)) ||
    isTargetProjectPath(absTarget, config, projectRoot)
  ) {
    return resolveSourceFile(config, absTarget, projectRoot);
  }

  return undefined;
}

/**
 * Recursively scans a directory collecting matching files according to options,
 * with robust avoidance of cyclic traversal, ignored directories, and companion external output directories.
 */
export function scanDirectoryFiles(
  dir: string,
  options: PathResolverOptions,
  config: AiceProjectConfig,
  projectRoot: string,
): string[] {
  const aiceFiles: string[] = [];
  const targetFiles: string[] = [];
  const customFiles: string[] = [];

  const customExts = options.extensions?.map((e) =>
    (e.startsWith(".") ? e : `.${e}`).toLowerCase(),
  );

  const absScanDir = path.resolve(dir);
  const outDirName = config.outDir ? path.basename(config.outDir) : ".aice-build";

  const absOutDir = config.outDir
    ? path.isAbsolute(config.outDir)
      ? path.resolve(config.outDir)
      : path.resolve(projectRoot, config.outDir)
    : undefined;

  let realOutDir: string | undefined;
  if (absOutDir) {
    try {
      realOutDir = fs.realpathSync(absOutDir);
    } catch {
      realOutDir = absOutDir;
    }
  }

  const absTargetProjectDir = config.targetProjectDir
    ? path.isAbsolute(config.targetProjectDir)
      ? path.resolve(config.targetProjectDir)
      : path.resolve(projectRoot, config.targetProjectDir)
    : undefined;

  let realTargetProjectDir: string | undefined;
  if (absTargetProjectDir) {
    try {
      realTargetProjectDir = fs.realpathSync(absTargetProjectDir);
    } catch {
      realTargetProjectDir = absTargetProjectDir;
    }
  }

  const visitedDirs = new Set<string>();

  function shouldIgnoreDirectory(
    entryName: string,
    fullPath: string,
    realFullPath: string,
  ): boolean {
    if (DEFAULT_IGNORED_SCAN_DIRECTORIES.has(entryName)) {
      return true;
    }
    if (entryName.startsWith(".") && entryName !== "." && entryName !== "..") {
      return true;
    }
    if (
      config.mode !== "companion" &&
      outDirName !== config.sourceDir &&
      entryName === outDirName
    ) {
      return true;
    }
    if (
      absOutDir &&
      absOutDir !== absScanDir &&
      (isSameOrDescendant(absOutDir, fullPath) ||
        (realOutDir && isSameOrDescendant(realOutDir, realFullPath)))
    ) {
      return true;
    }
    if (
      absTargetProjectDir &&
      absTargetProjectDir !== absScanDir &&
      (isSameOrDescendant(absTargetProjectDir, fullPath) ||
        (realTargetProjectDir && isSameOrDescendant(realTargetProjectDir, realFullPath)))
    ) {
      return true;
    }
    return false;
  }

  function walk(currentDir: string): void {
    let realCurrentDir: string;
    try {
      realCurrentDir = fs.realpathSync(currentDir);
    } catch {
      realCurrentDir = currentDir;
    }

    if (visitedDirs.has(realCurrentDir)) {
      return;
    }
    visitedDirs.add(realCurrentDir);

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      let isDirectory = entry.isDirectory();
      let realFullPath = fullPath;
      try {
        const stat = fs.statSync(fullPath);
        if (stat.isDirectory()) {
          isDirectory = true;
        }
        realFullPath = fs.realpathSync(fullPath);
      } catch {
        if (!isDirectory) {
          continue;
        }
      }

      if (isDirectory) {
        if (shouldIgnoreDirectory(entry.name, fullPath, realFullPath)) {
          continue;
        }
        walk(fullPath);
      } else {
        let isFile = entry.isFile();
        if (!isFile) {
          try {
            const stat = fs.statSync(fullPath);
            isFile = stat.isFile();
          } catch {
            isFile = false;
          }
        }

        if (!isFile) {
          continue;
        }

        if (
          entry.name.endsWith(".trivia.json") ||
          entry.name === "aice.config.json" ||
          entry.name === "package-lock.json" ||
          entry.name === "tsconfig.json" ||
          entry.name === "jsconfig.json" ||
          entry.name === "biome.json" ||
          entry.name === "rome.json"
        ) {
          continue;
        }

        const lowerName = entry.name.toLowerCase();

        if (customExts && customExts.length > 0) {
          if (customExts.some((ext) => lowerName.endsWith(ext))) {
            customFiles.push(fullPath);
          }
        } else {
          if (lowerName.endsWith(".aice")) {
            aiceFiles.push(fullPath);
          }
        }

        if (options.includeTargets) {
          const ext = path.extname(lowerName);
          if (ext && KNOWN_TARGET_EXTENSIONS.has(ext) && !lowerName.endsWith(".aice")) {
            targetFiles.push(fullPath);
          }
        }
      }
    }
  }

  walk(absScanDir);

  if (customExts && customExts.length > 0) {
    if (customFiles.length > 0) {
      return customFiles.sort();
    }
    if (options.includeTargets && customExts.every((e) => e.endsWith(".aice"))) {
      return targetFiles.sort();
    }
    return [];
  }

  if (aiceFiles.length > 0) {
    return aiceFiles.sort();
  }

  if (options.includeTargets) {
    return targetFiles.sort();
  }

  return [];
}

/**
 * Resolves polymorphic path inputs (omitted, directory, or single file)
 * to a standardized ResolvedPathTargets result with discovered files and config.
 */
export function resolvePathTargets(
  inputPath?: string,
  options: PathResolverOptions = {},
): ResolvedPathTargets {
  const isOmitted = inputPath === undefined || inputPath === null || inputPath.trim() === "";

  if (isOmitted) {
    const projectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : findProjectRoot(process.cwd());
    const config = options.config ?? loadProjectConfig(projectRoot);

    const candidateSourceDir = config.sourceDir
      ? path.resolve(projectRoot, config.sourceDir)
      : projectRoot;

    let targetDir = fs.existsSync(candidateSourceDir) ? candidateSourceDir : projectRoot;
    let files = scanDirectoryFiles(targetDir, options, config, projectRoot);

    // If sourceDir exists but yielded 0 files, check if projectRoot has matching files
    if (files.length === 0 && targetDir !== projectRoot && fs.existsSync(projectRoot)) {
      const rootFiles = scanDirectoryFiles(projectRoot, options, config, projectRoot);
      if (rootFiles.length > 0) {
        targetDir = projectRoot;
        files = rootFiles;
      }
    }

    return {
      isSingleFile: false,
      isDirectory: true,
      isOmitted: true,
      resolvedPath: targetDir,
      files,
      projectRoot,
      config,
    };
  }

  const trimmed = inputPath.trim();
  let absPath = path.resolve(process.cwd(), trimmed);
  if (
    options.projectRoot &&
    !path.isAbsolute(trimmed) &&
    !fs.existsSync(absPath) &&
    fs.existsSync(path.resolve(options.projectRoot, trimmed))
  ) {
    absPath = path.resolve(options.projectRoot, trimmed);
  } else if (options.projectRoot && !path.isAbsolute(trimmed) && trimmed.startsWith("..")) {
    absPath = path.resolve(options.projectRoot, trimmed);
  }

  let isDir = false;
  if (fs.existsSync(absPath)) {
    try {
      const stat = fs.statSync(absPath);
      isDir = stat.isDirectory();
    } catch {
      isDir = false;
    }
  } else {
    // Non-existent path: infer from trailing slash or missing extension
    isDir =
      trimmed.endsWith("/") ||
      trimmed.endsWith("\\") ||
      (path.extname(absPath) === "" && !trimmed.endsWith(".aice"));
  }

  if (isDir) {
    let effectiveProjectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : undefined;
    let effectiveConfig = options.config;

    if (!effectiveProjectRoot && !effectiveConfig) {
      const cwdRoot = findProjectRoot(process.cwd());
      const cwdConfig = loadProjectConfig(cwdRoot);
      if (cwdConfig.mode === "companion" && isTargetProjectPath(absPath, cwdConfig, cwdRoot)) {
        effectiveProjectRoot = cwdRoot;
        effectiveConfig = cwdConfig;
      }
    }

    const fallbackDir = isSameOrDescendant(process.cwd(), absPath) ? process.cwd() : absPath;
    const projectRoot =
      effectiveProjectRoot ?? findProjectRoot(absPath, fallbackDir);
    const config = effectiveConfig ?? loadProjectConfig(projectRoot);

    if (config.mode === "companion") {
      const companionDir = resolveCompanionSource(absPath, config, projectRoot);
      if (companionDir && fs.existsSync(companionDir)) {
        const companionFiles = scanDirectoryFiles(companionDir, options, config, projectRoot);
        if (companionFiles.length > 0 || !options.includeTargets) {
          return {
            isSingleFile: false,
            isDirectory: true,
            isOmitted: false,
            resolvedPath: companionDir,
            files: companionFiles,
            projectRoot,
            config,
          };
        }
      }
    }

    const files = fs.existsSync(absPath)
      ? scanDirectoryFiles(absPath, options, config, projectRoot)
      : [];

    return {
      isSingleFile: false,
      isDirectory: true,
      isOmitted: false,
      resolvedPath: absPath,
      files,
      projectRoot,
      config,
    };
  }

  // Single file target
  let effectiveProjectRoot = options.projectRoot
    ? path.resolve(options.projectRoot)
    : undefined;
  let effectiveConfig = options.config;

  if (!effectiveProjectRoot && !effectiveConfig) {
    const cwdRoot = findProjectRoot(process.cwd());
    const cwdConfig = loadProjectConfig(cwdRoot);
    if (cwdConfig.mode === "companion" && isTargetProjectPath(absPath, cwdConfig, cwdRoot)) {
      effectiveProjectRoot = cwdRoot;
      effectiveConfig = cwdConfig;
    }
  }

  const fallbackFileDir = isSameOrDescendant(process.cwd(), absPath)
    ? process.cwd()
    : path.dirname(absPath);
  const projectRoot =
    effectiveProjectRoot ?? findProjectRoot(path.dirname(absPath), fallbackFileDir);
  const config = effectiveConfig ?? loadProjectConfig(projectRoot);

  if (absPath.endsWith(".aice")) {
    return {
      isSingleFile: true,
      isDirectory: false,
      isOmitted: false,
      resolvedPath: absPath,
      files: [absPath],
      projectRoot,
      config,
    };
  }

  if (config.mode === "companion" || isTargetProjectPath(absPath, config, projectRoot)) {
    try {
      const companionFile =
        resolveCompanionSource(absPath, config, projectRoot) ??
        resolveSourceFile(config, absPath, projectRoot);

      if (companionFile) {
        const companionExists = fs.existsSync(companionFile);
        const targetExists = fs.existsSync(absPath);

        if (companionExists || !targetExists || !options.includeTargets) {
          return {
            isSingleFile: true,
            isDirectory: false,
            isOmitted: false,
            resolvedPath: companionFile,
            files: [companionFile],
            projectRoot,
            config,
          };
        }
      }
    } catch {
      // Fallback to absPath
    }
  }

  return {
    isSingleFile: true,
    isDirectory: false,
    isOmitted: false,
    resolvedPath: absPath,
    files: [absPath],
    projectRoot,
    config,
  };
}
