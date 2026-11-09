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
} from "./project-config.js";

export { KNOWN_TARGET_EXTENSIONS };
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
export function isRealPathSameOrDescendant(parent: string | undefined, candidate: string): boolean {
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
    if (outDirName !== config.sourceDir && entryName === outDirName) {
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
          entry.name === "package.json" ||
          entry.name === "tsconfig.json" ||
          entry.name === "jsconfig.json" ||
          entry.name === "biome.json" ||
          entry.name === "rome.json" ||
          entry.name === "AGENTS.md" ||
          entry.name === "CLAUDE.md" ||
          entry.name === "GEMINI.md" ||
          entry.name === ".GEMINI.md"
        ) {
          continue;
        }

        const lowerName = entry.name.toLowerCase();

        if (customExts && customExts.length > 0) {
          if (customExts.some((ext) => lowerName.endsWith(ext))) {
            customFiles.push(fullPath);
          }
        } else if (lowerName.endsWith(".aice")) {
          aiceFiles.push(fullPath);
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
  const cwd = path.resolve(process.cwd());
  const clampRootToCwd = (candidateRoot: string, targetPath: string): string => {
    const resolvedRoot = path.resolve(candidateRoot);
    if (isSameOrDescendant(cwd, targetPath) && !isSameOrDescendant(cwd, resolvedRoot)) {
      return cwd;
    }
    return resolvedRoot;
  };

  const isOmitted = inputPath === undefined || inputPath === null || inputPath.trim() === "";

  if (isOmitted) {
    const rawRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : findProjectRoot(cwd, cwd);
    const projectRoot = options.projectRoot ? rawRoot : clampRootToCwd(rawRoot, cwd);
    const config = options.config ?? loadProjectConfig(projectRoot);

    const candidateSourceDir = config.sourceDir
      ? path.resolve(projectRoot, config.sourceDir)
      : projectRoot;

    let targetDir = fs.existsSync(candidateSourceDir) ? candidateSourceDir : projectRoot;
    let files = scanDirectoryFiles(targetDir, options, config, projectRoot);

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
  let absPath = path.resolve(cwd, trimmed);
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
    isDir =
      trimmed.endsWith("/") ||
      trimmed.endsWith("\\") ||
      (path.extname(absPath) === "" && !trimmed.endsWith(".aice"));
  }

  if (isDir) {
    const fallbackDir = isSameOrDescendant(cwd, absPath) ? cwd : absPath;
    const rawRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : findProjectRoot(absPath, fallbackDir);
    const projectRoot = options.projectRoot ? rawRoot : clampRootToCwd(rawRoot, absPath);
    const config = options.config ?? loadProjectConfig(projectRoot);

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

  const fallbackFileDir = isSameOrDescendant(cwd, absPath) ? cwd : path.dirname(absPath);
  const rawRoot = options.projectRoot
    ? path.resolve(options.projectRoot)
    : findProjectRoot(path.dirname(absPath), fallbackFileDir);
  const projectRoot = options.projectRoot ? rawRoot : clampRootToCwd(rawRoot, absPath);
  const config = options.config ?? loadProjectConfig(projectRoot);

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
