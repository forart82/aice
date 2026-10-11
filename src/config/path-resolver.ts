/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AIL 2.0 Polymorphic Path Resolver Engine (Step 23).
 * Provides unified polymorphic resolution for files, directories, or omitted arguments
 * across all CLI commands and tooling APIs.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import {
  type AilProjectConfig,
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
} from "./project-config.js";

export interface PathResolverOptions {
  /**
   * Extensions to filter when scanning directories (default: [".ail"]).
   */
  extensions?: string[];
  /**
   * Include target files if no .ail files exist in the scanned directory.
   */
  includeTargets?: boolean;
  /**
   * Explicit workspace project root (auto-discovered if omitted).
   */
  projectRoot?: string;
  /**
   * Pre-loaded project config (auto-loaded if omitted).
   */
  config?: AilProjectConfig;
}

export interface ResolvedPathTargets {
  isSingleFile: boolean;
  isDirectory: boolean;
  isOmitted: boolean;
  resolvedPath: string;
  files: string[];
  projectRoot: string;
  config: AilProjectConfig;
}

export const DEFAULT_IGNORED_SCAN_DIRECTORIES: ReadonlySet<string> = new Set([
  "node_modules",
  ".git",
  "dist",
  "build",
  ".ail-build",
  ".agents",
  ".next",
  ".turbo",
  "coverage",
]);

/**
 * Recursively scans a directory collecting matching files according to options.
 */
export function scanDirectoryFiles(
  dir: string,
  options: PathResolverOptions,
  config: AilProjectConfig,
  projectRoot: string,
): string[] {
  const ailFiles: string[] = [];
  const targetFiles: string[] = [];
  const customFiles: string[] = [];

  const customExts = options.extensions?.map((e) =>
    (e.startsWith(".") ? e : `.${e}`).toLowerCase(),
  );

  const outDirName = config.outDir ? path.basename(config.outDir) : ".ail-build";
  const absOutDir = config.outDir
    ? path.isAbsolute(config.outDir)
      ? config.outDir
      : path.resolve(projectRoot, config.outDir)
    : undefined;

  function walk(currentDir: string): void {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(currentDir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      if (entry.isDirectory()) {
        if (
          DEFAULT_IGNORED_SCAN_DIRECTORIES.has(entry.name) ||
          entry.name === outDirName ||
          (absOutDir && fullPath === absOutDir) ||
          (entry.name.startsWith(".") && entry.name !== "." && entry.name !== "..")
        ) {
          continue;
        }
        walk(fullPath);
      } else if (entry.isFile()) {
        if (entry.name.endsWith(".trivia.json")) {
          continue;
        }

        const lowerName = entry.name.toLowerCase();

        if (customExts && customExts.length > 0) {
          if (customExts.some((ext) => lowerName.endsWith(ext))) {
            customFiles.push(fullPath);
          }
        } else {
          if (lowerName.endsWith(".ail")) {
            ailFiles.push(fullPath);
          }
        }

        if (options.includeTargets) {
          const ext = path.extname(lowerName);
          if (ext && KNOWN_TARGET_EXTENSIONS.has(ext) && !lowerName.endsWith(".ail")) {
            targetFiles.push(fullPath);
          }
        }
      }
    }
  }

  walk(dir);

  if (customExts && customExts.length > 0) {
    if (customFiles.length > 0) {
      return customFiles.sort();
    }
    if (options.includeTargets && customExts.every((e) => e.endsWith(".ail"))) {
      return targetFiles.sort();
    }
    return [];
  }

  if (ailFiles.length > 0) {
    return ailFiles.sort();
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
  const absPath = path.resolve(process.cwd(), trimmed);

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
      (path.extname(absPath) === "" && !trimmed.endsWith(".ail"));
  }

  if (isDir) {
    const projectRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : findProjectRoot(absPath, process.cwd());
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

  // Single file target
  const projectRoot = options.projectRoot
    ? path.resolve(options.projectRoot)
    : findProjectRoot(path.dirname(absPath), process.cwd());
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
