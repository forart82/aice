/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Polymorphic Path Resolver Engine (Step 23).
 * Provides unified polymorphic resolution for files, directories, or omitted arguments
 * across all CLI commands and tooling APIs, with first-class companion mode support.
 */

import { execSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  type AiceProjectConfig,
  findProjectRoot,
  KNOWN_TARGET_EXTENSIONS,
  loadProjectConfig,
  type TargetLanguage,
} from "./project-config.js";

export type { TargetLanguage };
export { KNOWN_TARGET_EXTENSIONS };
export interface PathResolverOptions {
  /**
   * Extensions to filter when scanning directories (default: [".aice"]).
   */
  extensions?: string[];
  /**
   * Include target files even when .aice files exist in the scanned directory (deduplicating .aice twins).
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
  /**
   * When true, skips nested package/editor metadata files (`package.json`, `tsconfig.json`, `AGENTS.md`, etc.).
   * When false, includes even root metadata files. Defaults to skipping root metadata files only.
   */
  excludeMetadata?: boolean;
  /**
   * Optional shared canonical realpath set for symlink cycle protection across directory walks.
   */
  visitedRealpaths?: Set<string>;
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
  ".aice-cache",
  ".agents",
  ".next",
  ".turbo",
  "coverage",
]);

export const PASSTHROUGH_FILENAMES: ReadonlySet<string> = new Set([
  "Makefile",
  "GNUmakefile",
  "makefile",
  "Dockerfile",
  "Containerfile",
  "CMakeLists.txt",
  "Jenkinsfile",
  "Vagrantfile",
  "Procfile",
  "Rakefile",
  "Justfile",
  "justfile",
  ".gitignore",
  ".gitattributes",
  ".dockerignore",
  ".npmignore",
  ".eslintignore",
  ".prettierignore",
  ".editorconfig",
  ".env",
  ".env.example",
  ".env.local",
  "LICENSE",
  "NOTICE",
]);

const OPTIONAL_METADATA_FILENAMES: ReadonlySet<string> = new Set([
  "package.json",
  "tsconfig.json",
  "jsconfig.json",
  "biome.json",
  "rome.json",
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".GEMINI.md",
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
  const absProjectRoot = path.resolve(projectRoot);
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

  const visitedDirs = options.visitedRealpaths ?? new Set<string>();

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
      return;
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

    const isRootDir = path.resolve(currentDir) === absProjectRoot;

    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);

      let isDirectory = entry.isDirectory();
      let isFile = entry.isFile();
      let realFullPath = fullPath;
      if (entry.isSymbolicLink() || (!isDirectory && !isFile)) {
        try {
          const stat = fs.statSync(fullPath);
          isDirectory = stat.isDirectory();
          isFile = stat.isFile();
          realFullPath = fs.realpathSync(fullPath);
        } catch {
          continue;
        }
      } else if (isDirectory) {
        try {
          realFullPath = fs.realpathSync(fullPath);
        } catch {
          continue;
        }
      }

      if (isDirectory) {
        if (visitedDirs.has(realFullPath)) {
          continue;
        }
        if (shouldIgnoreDirectory(entry.name, fullPath, realFullPath)) {
          continue;
        }
        walk(fullPath);
      } else if (isFile) {
        if (
          entry.name.endsWith(".trivia.json") ||
          entry.name === "aice.config.json" ||
          entry.name === ".aice-idioms.json"
        ) {
          continue;
        }

        if (OPTIONAL_METADATA_FILENAMES.has(entry.name)) {
          const shouldSkipMetadata =
            options.excludeMetadata === true ||
            (options.excludeMetadata === undefined && isRootDir);
          if (shouldSkipMetadata) {
            continue;
          }
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
    if (!options.includeTargets || targetFiles.length === 0) {
      return aiceFiles.sort();
    }
    const aiceFullSet = new Set(aiceFiles.map((f) => path.resolve(f)));
    const aiceDirStemSet = new Set(
      aiceFiles.map((f) => {
        const abs = path.resolve(f);
        const baseWithoutAice = path.basename(abs).slice(0, -".aice".length);
        return `${path.dirname(abs)}::${baseWithoutAice}`;
      }),
    );
    const unpairedTargets = targetFiles.filter((tf) => {
      const abs = path.resolve(tf);
      if (aiceFullSet.has(`${abs}.aice`)) {
        return false;
      }
      const ext = path.extname(abs);
      const stem = ext ? path.basename(abs).slice(0, -ext.length) : path.basename(abs);
      if (aiceDirStemSet.has(`${path.dirname(abs)}::${stem}`)) {
        return false;
      }
      return true;
    });
    return [...aiceFiles, ...unpairedTargets].sort();
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
export const ZERO_IDIOM_FAST_PATH_NOTICE =
  "[AICE Idioms] 0 beneficial idioms discovered. FAST-PATH: Bypassing idiom layer. Use canonical AICE syntax (do not invent $idiom macros).";

/**
 * Resolves Git worktree or project root boundary safely.
 * Wraps `git rev-parse --show-toplevel` and worktree boundary discovery in a try/catch.
 * If Git returns exit code 128 (e.g. running in `/tmp/aice-*` or a detached temporary worktree),
 * silently falls back to the nearest directory containing `package.json` / `aice.config.json` or `process.cwd()`.
 */
export function resolveWorktreeRoot(
  startDir: string = process.cwd(),
  fallbackDir?: string,
): string {
  let cur = path.resolve(startDir);
  try {
    if (fs.existsSync(cur) && !fs.statSync(cur).isDirectory()) {
      cur = path.dirname(cur);
    }
  } catch {
    cur = path.dirname(cur);
  }
  const initialDir = cur;
  const tmpRoot = path.resolve(os.tmpdir());

  // 1. Check nearest ancestor containing aice.config.json or package.json before crossing /tmp boundary
  let probe = initialDir;
  while (true) {
    if (
      fs.existsSync(path.join(probe, "aice.config.json")) ||
      fs.existsSync(path.join(probe, "package.json"))
    ) {
      return probe;
    }
    const parent = path.dirname(probe);
    if (parent === probe || parent === "/tmp" || parent === "/var/tmp" || parent === tmpRoot) {
      break;
    }
    probe = parent;
  }

  // 2. Try git rev-parse --show-toplevel wrapped in try/catch to suppress fatal exit code 128
  try {
    if (fs.existsSync(initialDir)) {
      const gitTop = execSync("git rev-parse --show-toplevel", {
        cwd: initialDir,
        encoding: "utf-8",
        stdio: ["pipe", "pipe", "pipe"],
      }).trim();
      if (gitTop && fs.existsSync(gitTop)) {
        const resolvedGitTop = path.resolve(gitTop);
        const inTmp =
          initialDir.startsWith("/tmp/") ||
          initialDir.startsWith("/var/tmp/") ||
          initialDir.startsWith(`${tmpRoot}${path.sep}`);
        const gitInTmp =
          resolvedGitTop.startsWith("/tmp/") ||
          resolvedGitTop.startsWith("/var/tmp/") ||
          resolvedGitTop.startsWith(`${tmpRoot}${path.sep}`);
        if (!inTmp || gitInTmp) {
          return resolvedGitTop;
        }
      }
    }
  } catch {
    // Git returned exit code 128 (not a git repo or detached worktree) — silently fall back
  }

  // 3. Fall back to findProjectRoot or fallbackDir / process.cwd()
  return findProjectRoot(initialDir, fallbackDir ?? process.cwd());
}

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
      : resolveWorktreeRoot(cwd, cwd);
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
    const baseName = path.basename(absPath);
    const isKnownExtensionlessFile =
      PASSTHROUGH_FILENAMES.has(baseName) || baseName.startsWith(".env.");
    isDir =
      trimmed.endsWith("/") ||
      trimmed.endsWith("\\") ||
      (!isKnownExtensionlessFile && path.extname(absPath) === "" && !trimmed.endsWith(".aice"));
  }

  if (isDir) {
    const fallbackDir = isSameOrDescendant(cwd, absPath) ? cwd : absPath;
    const rawRoot = options.projectRoot
      ? path.resolve(options.projectRoot)
      : resolveWorktreeRoot(absPath, fallbackDir);
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
    : resolveWorktreeRoot(path.dirname(absPath), fallbackFileDir);
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
