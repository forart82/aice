/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 File-System Protection & Permission Locker (Step 5).
 * Enforces filesystem-level read-only locks (chmod 444) on generated target files
 * having a .aice sibling, blocking unauthorized AI file writes with EACCES,
 * and provides safe atomic unlock/relock wrappers for compiler operations.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { TargetLanguage } from "../emitters/index.js";

export interface LockOptions {
  dir: string;
  recursive?: boolean; // default true
  extensions?: string[]; // default [".ts", ".tsx", ".css", ".html", ".py", ".cpp", ".hpp", ".h"]
  ignorePatterns?: string[]; // default ["node_modules", ".git", "dist", "build"]
}

export interface LockResult {
  filePath: string;
  success: boolean;
  alreadyLocked?: boolean;
  error?: Error;
}

export interface LockSummary {
  totalChecked: number;
  totalLocked: number;
  totalUnlocked: number;
  totalSkipped: number;
  totalFailed: number;
  results: LockResult[];
}

export const DEFAULT_LOCK_EXTENSIONS: string[] = [
  ".ts",
  ".tsx",
  ".js",
  ".mjs",
  ".css",
  ".html",
  ".py",
  ".cpp",
  ".hpp",
  ".cc",
  ".cxx",
  ".h",
  ".cs",
  ".php",
  ".kt",
  ".kts",
];

export const DEFAULT_LOCK_IGNORE_PATTERNS: string[] = ["node_modules", ".git", "dist", "build", ".agents"];

/**
 * Checks whether a file path has an existing .aice sibling in the same folder.
 * Matches both `${filePath}.aice` (e.g. main.ts.aice) and `${basename}.aice` (e.g. main.aice).
 */
export function getAiceSiblingPath(filePath: string): string | null {
  const directSibling = `${filePath}.aice`;
  if (fs.existsSync(directSibling)) {
    return directSibling;
  }

  const ext = path.extname(filePath);
  if (ext) {
    const baseWithoutExt = filePath.slice(0, -ext.length);
    const shortSibling = `${baseWithoutExt}.aice`;
    if (fs.existsSync(shortSibling)) {
      return shortSibling;
    }
  }

  return null;
}

/**
 * Returns true if a .aice sibling exists for the given file.
 */
export function hasAiceSibling(filePath: string): boolean {
  return getAiceSiblingPath(filePath) !== null;
}

/**
 * Inspects fs.statSync(filePath).mode to see if write bit (0o222) is cleared.
 */
export function isTargetLocked(filePath: string): boolean {
  const stat = fs.statSync(filePath);
  return (stat.mode & 0o222) === 0;
}

/**
 * Sets file mode to 0o444 (read-only for all).
 * Returns true if locked, false if already locked.
 */
export function lockFile(filePath: string): boolean {
  if (isTargetLocked(filePath)) {
    return false;
  }
  fs.chmodSync(filePath, 0o444);
  return true;
}

/**
 * Sets file mode to 0o644 (readable & writable).
 * Returns true if unlocked, false if already unlocked.
 */
export function unlockFile(filePath: string): boolean {
  if (!isTargetLocked(filePath)) {
    return false;
  }
  fs.chmodSync(filePath, 0o644);
  return true;
}

/**
 * Executes an action with a temporarily unlocked target file.
 * If file is locked, unlocks it (unlockFile), executes action(),
 * and in a finally block relocks it (lockFile).
 * If file was already writable, leaves it writable.
 */
export async function withUnlockedTarget<T>(
  filePath: string,
  action: () => Promise<T> | T,
): Promise<T> {
  let wasLocked = false;
  try {
    wasLocked = fs.existsSync(filePath) && isTargetLocked(filePath);
  } catch {
    wasLocked = false;
  }

  if (wasLocked) {
    unlockFile(filePath);
  }

  try {
    return await action();
  } finally {
    if (wasLocked && fs.existsSync(filePath)) {
      lockFile(filePath);
    }
  }
}

function shouldIgnore(name: string, relPath: string, ignorePatterns: string[]): boolean {
  const normalizedRel = relPath.replace(/\\/g, "/");
  const segments = normalizedRel.split("/").filter(Boolean);

  for (const pattern of ignorePatterns) {
    const cleanPattern = pattern.replace(/^\/+/, "").replace(/\/+$/, "");

    if (name === pattern || name === cleanPattern) {
      return true;
    }

    if (segments.includes(pattern) || segments.includes(cleanPattern)) {
      return true;
    }

    if (
      normalizedRel === pattern ||
      normalizedRel === cleanPattern ||
      normalizedRel.startsWith(`${cleanPattern}/`) ||
      normalizedRel.endsWith(`/${cleanPattern}`)
    ) {
      return true;
    }

    if (pattern.includes("*")) {
      const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, "\\$&").replace(/\*/g, ".*");
      const regex = new RegExp(`^${escaped}$`);
      if (regex.test(name) || regex.test(normalizedRel)) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Scans a directory for generated target files that have a .aice sibling.
 */
export function findTargetFiles(dir: string, options?: Partial<LockOptions>): string[] {
  const baseDir = options?.dir ?? dir;
  const resolvedDir = path.resolve(baseDir);
  if (!fs.existsSync(resolvedDir)) {
    throw new Error(`Directory not found: ${dir}`);
  }

  const stat = fs.statSync(resolvedDir);
  if (stat.isFile()) {
    if (hasAiceSibling(resolvedDir)) {
      return [resolvedDir];
    }
    return [];
  }

  const recursive = options?.recursive ?? true;
  const rawExtensions = options?.extensions ?? DEFAULT_LOCK_EXTENSIONS;
  const extensions = rawExtensions.map((ext) =>
    ext.startsWith(".") ? ext.toLowerCase() : `.${ext.toLowerCase()}`,
  );
  const ignorePatterns = options?.ignorePatterns ?? DEFAULT_LOCK_IGNORE_PATTERNS;

  const results: string[] = [];

  function scanDir(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.resolve(currentDir, entry.name);
      const relPath = path.relative(resolvedDir, fullPath);

      if (shouldIgnore(entry.name, relPath, ignorePatterns)) {
        continue;
      }

      if (entry.isDirectory()) {
        if (recursive) {
          scanDir(fullPath);
        }
      } else if (entry.isFile()) {
        const lowerName = entry.name.toLowerCase();
        if (lowerName.endsWith(".aice") || lowerName.endsWith(".trivia.json")) {
          continue;
        }

        const matchesExt = extensions.some((ext) => lowerName.endsWith(ext));
        if (matchesExt && hasAiceSibling(fullPath)) {
          results.push(fullPath);
        }
      }
    }
  }

  scanDir(resolvedDir);
  results.sort();
  return results;
}

/**
 * Scans dir for target files that have a .aice sibling in the same folder (${filePath}.aice).
 * Locks them to 0o444.
 */
export async function lockProjectTargets(
  dir: string,
  options?: Partial<LockOptions>,
): Promise<LockSummary> {
  const targetFiles = findTargetFiles(dir, options);
  const results: LockResult[] = [];
  let totalLocked = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const filePath of targetFiles) {
    try {
      if (isTargetLocked(filePath)) {
        totalSkipped++;
        results.push({
          filePath,
          success: true,
          alreadyLocked: true,
        });
      } else {
        lockFile(filePath);
        totalLocked++;
        results.push({
          filePath,
          success: true,
          alreadyLocked: false,
        });
      }
    } catch (err) {
      totalFailed++;
      results.push({
        filePath,
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return {
    totalChecked: targetFiles.length,
    totalLocked,
    totalUnlocked: 0,
    totalSkipped,
    totalFailed,
    results,
  };
}

/**
 * Unlocks all target files back to 0o644.
 */
export async function unlockProjectTargets(
  dir: string,
  options?: Partial<LockOptions>,
): Promise<LockSummary> {
  const targetFiles = findTargetFiles(dir, options);
  const results: LockResult[] = [];
  let totalUnlocked = 0;
  let totalSkipped = 0;
  let totalFailed = 0;

  for (const filePath of targetFiles) {
    try {
      if (!isTargetLocked(filePath)) {
        totalSkipped++;
        results.push({
          filePath,
          success: true,
          alreadyLocked: false,
        });
      } else {
        unlockFile(filePath);
        totalUnlocked++;
        results.push({
          filePath,
          success: true,
          alreadyLocked: false,
        });
      }
    } catch (err) {
      totalFailed++;
      results.push({
        filePath,
        success: false,
        error: err instanceof Error ? err : new Error(String(err)),
      });
    }
  }

  return {
    totalChecked: targetFiles.length,
    totalLocked: 0,
    totalUnlocked,
    totalSkipped,
    totalFailed,
    results,
  };
}

/**
 * Returns non-semantic banner comment for generated target files:
 * - JS/TS/C++/C: // @generated by AICE - DO NOT EDIT DIRECTLY. Source: <aiceSourcePath>
 * - Python: # @generated by AICE - DO NOT EDIT DIRECTLY. Source: <aiceSourcePath>
 * - CSS: /* @generated by AICE - DO NOT EDIT DIRECTLY. Source: <aiceSourcePath> *\/
 * - HTML: <!-- @generated by AICE - DO NOT EDIT DIRECTLY. Source: <aiceSourcePath> -->
 */
export function getGeneratedBanner(
  targetLang: TargetLanguage | string,
  aiceSourcePath: string,
): string {
  const normalized = targetLang.toLowerCase().trim();
  switch (normalized) {
    case "python":
    case "py":
      return `# @generated by AICE - DO NOT EDIT DIRECTLY. Source: ${aiceSourcePath}`;
    case "css":
      return `/* @generated by AICE - DO NOT EDIT DIRECTLY. Source: ${aiceSourcePath} */`;
    case "html":
    case "htm":
      return `<!-- @generated by AICE - DO NOT EDIT DIRECTLY. Source: ${aiceSourcePath} -->`;
    case "yaml":
    case "yml":
      return `# @generated by AICE - DO NOT EDIT DIRECTLY. Source: ${aiceSourcePath}`;
    case "json":
      return "";
    default:
      return `// @generated by AICE - DO NOT EDIT DIRECTLY. Source: ${aiceSourcePath}`;
  }
}
