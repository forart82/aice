/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Universal Text File Classification SSOT & Binary Guard.
 *
 * Replaces fragmented extension allowlists and duplicated binary lists across
 * discovery (`aice find`), search (`aice search`), read (`aice read`),
 * creation (`aice create` / `aice write`), and surgical edits (`aice splice`).
 *
 * Policy:
 * - Accept ANY valid UTF-8 / string-like text file regardless of extension
 *   (`.svg`, `.xml`, `.toml`, `.ini`, `.csv`, `.log`, `.tf`, `.rst`, `.mdx`,
 *   `.customblob`, extensionless files, dotfiles, etc.).
 * - Reject known binary extensions in O(1) and guard unknown/extensionless files
 *   using a NUL-byte, control-stream, and strict UTF-8 probe (safe against partial
 *   multi-byte UTF-8 sequences at probe boundaries).
 * - Keep AST/compiler-supported `KNOWN_TARGET_EXTENSIONS` cleanly separate in
 *   `project-config.ts`.
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { type BoundedCacheStats, FileStatLruCache } from "../cache/lru.js";

export const DEFAULT_BINARY_PROBE_BYTES = 8192;
export const DEFAULT_MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024;
const MAX_BINARY_PROBE_CACHE_ENTRIES = 2048;

const binaryProbeCache = new FileStatLruCache<boolean>(MAX_BINARY_PROBE_CACHE_ENTRIES);

export function clearFileClassificationCache(): void {
  binaryProbeCache.clear();
}

export function getFileClassificationCacheStats(): BoundedCacheStats {
  return binaryProbeCache.getStats();
}

/**
 * Single Source of Truth for known binary file extensions.
 * Superset of legacy `BINARY_SKIP_EXTENSIONS` and `BINARY_DISCOVERY_EXTENSIONS`.
 * Explicitly excludes text-based formats such as `.svg`, `.xml`, `.txt`, `.csv`,
 * `.tsv`, `.toml`, `.ini`, `.log`, `.tf`, `.rst`, `.mdx`, `.html`, `.json`, etc.
 */
export const BINARY_EXTENSIONS: ReadonlySet<string> = new Set([
  // Raster / binary images (explicitly NOT .svg)
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".avif",
  ".ico",
  ".bmp",
  ".tiff",
  ".tif",
  ".heic",
  ".heif",
  ".psd",
  ".icns",
  ".dds",
  ".tga",
  ".exr",
  ".hdr",
  ".cur",
  ".jp2",
  ".jxl",
  // Fonts
  ".woff",
  ".woff2",
  ".ttf",
  ".eot",
  ".otf",
  ".ttc",
  ".pfb",
  ".pfm",
  // Binary documents & office packages
  ".pdf",
  ".doc",
  ".docx",
  ".xls",
  ".xlsx",
  ".ppt",
  ".pptx",
  ".odt",
  ".ods",
  ".odp",
  ".epub",
  ".mobi",
  // Archives, disk images & compressed payloads
  ".zip",
  ".tar",
  ".gz",
  ".tgz",
  ".bz2",
  ".tbz2",
  ".xz",
  ".txz",
  ".7z",
  ".rar",
  ".zst",
  ".lz4",
  ".lzma",
  ".cab",
  ".dmg",
  ".iso",
  ".img",
  ".deb",
  ".rpm",
  ".msi",
  ".pkg",
  ".nupkg",
  ".whl",
  ".egg",
  ".crx",
  ".xpi",
  ".vsix",
  // Executables, bytecode, object files, native libs & mobile bundles
  ".wasm",
  ".pyc",
  ".pyo",
  ".pyd",
  ".class",
  ".jar",
  ".war",
  ".ear",
  ".jmod",
  ".apk",
  ".aab",
  ".dex",
  ".odex",
  ".vdex",
  ".ipa",
  ".exe",
  ".dll",
  ".so",
  ".dylib",
  ".o",
  ".obj",
  ".a",
  ".lib",
  ".bin",
  ".elf",
  ".sys",
  ".drv",
  ".node",
  ".beam",
  ".rlib",
  ".rmeta",
  ".pdb",
  ".ilk",
  // Audio
  ".mp3",
  ".wav",
  ".ogg",
  ".oga",
  ".opus",
  ".flac",
  ".aac",
  ".m4a",
  ".wma",
  ".mid",
  ".midi",
  ".aiff",
  ".aif",
  // Video (never .ts)
  ".mp4",
  ".m4v",
  ".webm",
  ".mkv",
  ".avi",
  ".mov",
  ".wmv",
  ".flv",
  ".mpg",
  ".mpeg",
  ".3gp",
  // Databases, binary lockfiles, ML weights & binary 3D/game assets
  ".sqlite",
  ".sqlite3",
  ".db",
  ".db3",
  ".sdb",
  ".mdb",
  ".accdb",
  ".ldb",
  ".lockb",
  ".parquet",
  ".arrow",
  ".feather",
  ".avro",
  ".orc",
  ".h5",
  ".hdf5",
  ".npy",
  ".npz",
  ".pkl",
  ".pickle",
  ".pt",
  ".pth",
  ".onnx",
  ".safetensors",
  ".gguf",
  ".ggml",
  ".tflite",
  ".glb",
  ".fbx",
  ".blend",
  ".unitypackage",
  ".uasset",
  ".pak",
  ".vpk",
  ".wad",
  ".swf",
]);

/**
 * Unified set of noisy auto-generated lockfiles skipped during broad directory scans.
 * Still directly readable and editable when explicitly targeted by path.
 */
export const LOCKFILE_SKIP_NAMES: ReadonlySet<string> = new Set([
  "package-lock.json",
  "pnpm-lock.yaml",
  "yarn.lock",
  "bun.lock",
  "bun.lockb",
  "Cargo.lock",
  "composer.lock",
  "Gemfile.lock",
  "poetry.lock",
  "uv.lock",
  "flake.lock",
  "Podfile.lock",
  "Package.resolved",
  "mix.lock",
  "pubspec.lock",
  "gradle.lockfile",
  "Pipfile.lock",
  "pdm.lock",
  "npm-shrinkwrap.json",
]);

/**
 * Canonical project text filenames (extensionless scripts/manifests and standard dotfiles).
 * Used for non-existent path heuristics and allowing known project dotfiles in directory scans.
 */
export const KNOWN_TEXT_FILENAMES: ReadonlySet<string> = new Set([
  "verify",
  "new-project",
  "gradlew",
  "mvnw",
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
  "Gemfile",
  "Podfile",
  "Brewfile",
  "Fastfile",
  "Appfile",
  "Cargo.toml",
  "Cargo.lock",
  "go.mod",
  "go.sum",
  "LICENSE",
  "NOTICE",
  "README",
  "CHANGELOG",
  "AUTHORS",
  "CODEOWNERS",
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
  ".npmrc",
  ".nvmrc",
  ".prettierrc",
  ".eslintrc",
  ".browserslistrc",
]);

/**
 * Well-known hidden directories that must NOT be misclassified as non-existent file targets.
 */
export const KNOWN_DOT_DIRECTORY_NAMES: ReadonlySet<string> = new Set([
  ".git",
  ".github",
  ".gitlab",
  ".vscode",
  ".idea",
  ".cursor",
  ".agents",
  ".claude",
  ".gemini",
  ".aice-build",
  ".aice-cache",
  ".next",
  ".nuxt",
  ".turbo",
  ".svelte-kit",
  ".vite",
  ".cache",
  ".parcel-cache",
  ".circleci",
  ".devcontainer",
  ".husky",
  ".yarn",
  ".pnpm-store",
  ".venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".gradle",
  ".mvn",
]);

/**
 * Common non-AST text file extensions used ONLY for disambiguating bare non-existent
 * PascalCase filenames (e.g. `Demo.csproj`, `MyIcon.svg`, `App.vue`) from `Class.method`
 * symbols inside multi-block splice headers. NEVER used as a rejection allowlist.
 */
export const COMMON_TEXT_FILE_EXTENSIONS: ReadonlySet<string> = new Set([
  ".txt",
  ".svg",
  ".xml",
  ".toml",
  ".ini",
  ".cfg",
  ".conf",
  ".csv",
  ".tsv",
  ".log",
  ".tf",
  ".tfvars",
  ".hcl",
  ".rst",
  ".mdx",
  ".sql",
  ".graphql",
  ".gql",
  ".prisma",
  ".proto",
  ".wgsl",
  ".glsl",
  ".vert",
  ".frag",
  ".vue",
  ".svelte",
  ".astro",
  ".scss",
  ".sass",
  ".less",
  ".cts",
  ".mts",
  ".jsonc",
  ".lock",
  ".mod",
  ".sum",
  ".csproj",
  ".sln",
  ".props",
  ".targets",
  ".cmake",
  ".mk",
  ".dockerfile",
  ".env",
  ".zig",
  ".rb",
  ".nix",
  ".lua",
  ".dart",
  ".swift",
  ".ex",
  ".exs",
  ".erl",
  ".hs",
  ".ml",
  ".mli",
  ".scala",
  ".groovy",
  ".pl",
  ".pm",
  ".r",
  ".jl",
  ".clj",
  ".cljs",
  ".java",
  ".pro",
  ".gradle",
  ".kts",
  ".properties",
  ".webmanifest",
  ".example",
]);

export const ROOT_AGENT_DOC_NAMES: ReadonlySet<string> = new Set([
  "AGENTS.md",
  "CLAUDE.md",
  "GEMINI.md",
  ".GEMINI.md",
]);

const UTF8_FATAL_DECODER = new TextDecoder("utf-8", { fatal: true });
const STANDARD_FILE_EXT_RE = /^\.[a-z][a-z0-9_-]{0,23}$/i;

export function isAiceInternalMetaFile(baseName: string): boolean {
  return (
    baseName === ".git" ||
    baseName.endsWith(".trivia.json") ||
    baseName === "aice.config.json" ||
    baseName === ".aice-idioms.json"
  );
}

/**
 * O(1) check whether a file path or bare extension (e.g. `".png"`, `"dir/app.APK"`)
 * refers to a known binary format.
 */
export function isBinaryExtension(filePathOrExt: string): boolean {
  const trimmed = filePathOrExt.trim();
  if (!trimmed) return false;
  const clean = trimmed.replace(/\\/g, "/");
  if (clean.startsWith(".") && !clean.includes("/") && BINARY_EXTENSIONS.has(clean.toLowerCase())) {
    return true;
  }
  const base = path.posix.basename(clean).toLowerCase();
  if (!base) return false;
  const ext = path.posix.extname(base);
  return Boolean(ext && BINARY_EXTENSIONS.has(ext));
}

/**
 * Safely trims an incomplete multi-byte UTF-8 sequence at the very end of a
 * partial probe buffer so valid UTF-8 text containing emojis, CJK, box-drawing,
 * or other multi-byte characters never triggers false positives when sliced.
 */
function trimIncompleteTrailingUtf8(slice: Uint8Array): Uint8Array {
  const len = slice.length;
  if (len === 0) return slice;

  let i = len - 1;
  let contCount = 0;
  while (i >= 0 && contCount < 3 && ((slice[i] ?? 0) & 0xc0) === 0x80) {
    i--;
    contCount++;
  }
  if (i < 0) {
    return slice;
  }

  const lead = slice[i] ?? 0;
  let expectedLen = 0;
  if (lead >= 0xc2 && lead <= 0xdf) {
    expectedLen = 2;
  } else if (lead >= 0xe0 && lead <= 0xef) {
    expectedLen = 3;
  } else if (lead >= 0xf0 && lead <= 0xf4) {
    expectedLen = 4;
  } else {
    return slice;
  }

  const actualLen = len - i;
  if (actualLen >= expectedLen) {
    return slice;
  }

  // Validate the 2nd byte constraints (reject overlong / UTF-16 surrogates / > U+10FFFF)
  if (actualLen >= 2) {
    const b2 = slice[i + 1] ?? 0;
    if (lead === 0xe0 && b2 < 0xa0) return slice;
    if (lead === 0xed && b2 > 0x9f) return slice;
    if (lead === 0xf0 && b2 < 0x90) return slice;
    if (lead === 0xf4 && b2 > 0x8f) return slice;
  }

  return i > 0 ? slice.subarray(0, i) : slice;
}

export interface BinaryBufferCheckOptions {
  probeBytes?: number;
  allowPartialTrailingUtf8?: boolean;
}

/**
 * Inspects a byte buffer to determine whether it is binary rather than valid UTF-8 text.
 * Rejects:
 *   1. Any NUL byte (`0x00`)
 *   2. Invalid UTF-8 sequences (after safely trimming an incomplete trailing multi-byte
 *      UTF-8 sequence when probing a partial chunk)
 *   3. High-density non-text C0/DEL control byte streams (>10% suspicious controls)
 */
export function isLikelyBinaryBuffer(
  buf: Buffer | Uint8Array,
  options?: BinaryBufferCheckOptions,
): boolean {
  if (buf.length === 0) return false;

  const maxProbe = options?.probeBytes ?? DEFAULT_BINARY_PROBE_BYTES;
  const truncatedByProbe = buf.length > maxProbe;
  const probeSlice = truncatedByProbe ? buf.subarray(0, maxProbe) : buf;
  const probeLen = probeSlice.length;

  let suspiciousControls = 0;
  for (let i = 0; i < probeLen; i++) {
    const b = probeSlice[i] ?? 0;
    if (b === 0) return true;
    // Allow standard text whitespace/formatting controls: \t (9), \n (10), \v (11), \f (12), \r (13), ESC (27)
    if (
      (b < 0x20 &&
        b !== 0x09 &&
        b !== 0x0a &&
        b !== 0x0b &&
        b !== 0x0c &&
        b !== 0x0d &&
        b !== 0x1b) ||
      b === 0x7f
    ) {
      suspiciousControls++;
    }
  }

  if (suspiciousControls > 0 && suspiciousControls / probeLen > 0.1) {
    return true;
  }

  const allowPartial = options?.allowPartialTrailingUtf8 ?? true;
  const utf8Candidate = allowPartial ? trimIncompleteTrailingUtf8(probeSlice) : probeSlice;
  try {
    UTF8_FATAL_DECODER.decode(utf8Candidate);
  } catch {
    return true;
  }

  return false;
}

export interface BinaryDiskFileOptions {
  probeBytes?: number;
  maxTextBytes?: number;
  stat?: fs.Stats;
}

function probeOpenedDiskFileIsBinary(
  filePath: string,
  stat: fs.Stats,
  probeBytes: number,
): boolean {
  const fileSize = stat.size;
  if (fileSize === 0) return false;

  const cacheKey = `${path.resolve(filePath)}:${probeBytes}`;
  const cached = binaryProbeCache.getIfFresh(cacheKey, stat);
  if (cached !== undefined) {
    return cached;
  }

  const readLen = Math.min(fileSize, probeBytes);
  const buf = Buffer.allocUnsafe(readLen);
  let fd: number | undefined;
  try {
    fd = fs.openSync(filePath, "r");
    const bytesRead = fs.readSync(fd, buf, 0, readLen, 0);
    const isBinary =
      bytesRead === 0
        ? false
        : isLikelyBinaryBuffer(buf.subarray(0, bytesRead), {
            probeBytes: bytesRead,
            allowPartialTrailingUtf8: fileSize > bytesRead,
          });
    binaryProbeCache.setWithStat(cacheKey, stat, isBinary);
    return isBinary;
  } catch {
    return false;
  } finally {
    if (fd !== undefined) {
      try {
        fs.closeSync(fd);
      } catch {
        // ignore close error
      }
    }
  }
}

/**
 * Checks whether a disk file is binary using an O(1) extension check followed by
 * a bounded leading-byte probe (default 8192 bytes) through `isLikelyBinaryBuffer`.
 * Results are cached in a bounded mtime+ctime+size+ino LRU cache.
 */
export function isLikelyBinaryDiskFile(filePath: string, options?: BinaryDiskFileOptions): boolean {
  if (isBinaryExtension(filePath)) return true;

  let stat = options?.stat;
  if (!stat) {
    try {
      stat = fs.statSync(filePath);
    } catch {
      return false;
    }
  }
  if (!stat.isFile()) return false;
  if (options?.maxTextBytes !== undefined && stat.size > options.maxTextBytes) {
    return true;
  }
  return probeOpenedDiskFileIsBinary(
    filePath,
    stat,
    options?.probeBytes ?? DEFAULT_BINARY_PROBE_BYTES,
  );
}

export interface UniversalTextDiskFileOptions {
  allowDotfiles?: boolean;
  skipLockfiles?: boolean;
  skipRootAgentDocs?: boolean;
  maxBytes?: number;
  probeBytes?: number;
  stat?: fs.Stats;
}

/**
 * Zero-syscall filename/extension pre-filter matching `isUniversalTextDiskFile` rules.
 */
export function isUniversalTextFileNameCandidate(
  filePath: string,
  options?: Pick<
    UniversalTextDiskFileOptions,
    "allowDotfiles" | "skipLockfiles" | "skipRootAgentDocs"
  >,
): boolean {
  const baseName = path.basename(filePath);
  if (!baseName || isAiceInternalMetaFile(baseName)) {
    return false;
  }

  const skipLockfiles = options?.skipLockfiles ?? true;
  if (skipLockfiles && LOCKFILE_SKIP_NAMES.has(baseName)) {
    return false;
  }

  if (options?.skipRootAgentDocs && ROOT_AGENT_DOC_NAMES.has(baseName)) {
    return false;
  }

  const isKnownDotfile = KNOWN_TEXT_FILENAMES.has(baseName) || baseName.startsWith(".env.");
  if (baseName.startsWith(".") && !options?.allowDotfiles && !isKnownDotfile) {
    return false;
  }

  return !isBinaryExtension(filePath);
}

/**
 * Universal Text File SSOT predicate for disk files.
 * Accepts ALL valid UTF-8 text files regardless of extension (`.svg`, `.csv`, `.toml`,
 * `.customblob`, `.tf`, `.rst`, `.mdx`, `.vue`, `.svelte`, `.zig`, extensionless files,
 * known/allowed dotfiles) while skipping AICE internal metadata, lockfiles (by default),
 * known binary extensions, and any file failing the NUL/control/UTF-8 content guard.
 */
export function isUniversalTextDiskFile(
  filePath: string,
  options?: UniversalTextDiskFileOptions,
): boolean {
  if (!isUniversalTextFileNameCandidate(filePath, options)) {
    return false;
  }

  let stat = options?.stat;
  if (!stat) {
    try {
      stat = fs.statSync(filePath);
    } catch {
      return false;
    }
  }
  if (!stat.isFile()) return false;
  if (options?.maxBytes !== undefined && stat.size > options.maxBytes) {
    return false;
  }

  return !probeOpenedDiskFileIsBinary(
    filePath,
    stat,
    options?.probeBytes ?? DEFAULT_BINARY_PROBE_BYTES,
  );
}

/**
 * Single-pass stat + binary-check + UTF-8 read helper for search and workspace scanners.
 * Avoids opening/reading the same file twice (probe + readFileSync) while populating
 * the bounded `binaryProbeCache`.
 */
export function readUniversalTextFileSync(
  filePath: string,
  options?: UniversalTextDiskFileOptions & { checkFileName?: boolean },
): { text: string; bytes: number; stat: fs.Stats } | undefined {
  if (options?.checkFileName !== false && !isUniversalTextFileNameCandidate(filePath, options)) {
    return undefined;
  }
  if (options?.checkFileName === false && isBinaryExtension(filePath)) {
    return undefined;
  }

  let stat = options?.stat;
  if (!stat) {
    try {
      stat = fs.statSync(filePath);
    } catch {
      return undefined;
    }
  }
  if (!stat.isFile()) return undefined;
  const maxBytes = options?.maxBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES;
  if (stat.size > maxBytes) {
    return undefined;
  }
  if (stat.size === 0) {
    return { text: "", bytes: 0, stat };
  }

  const probeBytes = options?.probeBytes ?? DEFAULT_BINARY_PROBE_BYTES;
  const cacheKey = `${path.resolve(filePath)}:${probeBytes}`;
  const cachedBinary = binaryProbeCache.getIfFresh(cacheKey, stat);
  if (cachedBinary === true) {
    return undefined;
  }

  let buf: Buffer;
  try {
    buf = fs.readFileSync(filePath);
  } catch {
    return undefined;
  }

  if (cachedBinary === undefined) {
    const isBinary = isLikelyBinaryBuffer(buf, { probeBytes });
    binaryProbeCache.setWithStat(cacheKey, stat, isBinary);
    if (isBinary) {
      return undefined;
    }
  }

  return {
    text: buf.toString("utf-8"),
    bytes: buf.length,
    stat,
  };
}

export interface SafeTextWriteCheckResult {
  safe: boolean;
  reason?: string;
}

/**
 * Non-throwing binary write guard check for `createFile` and `splice`.
 */
export function checkSafeTextWriteTarget(
  filePath: string,
  content?: string,
  options?: { checkExistingDiskFile?: boolean },
): SafeTextWriteCheckResult {
  if (isBinaryExtension(filePath)) {
    const clean = filePath.replace(/\\/g, "/");
    const ext = path.posix.extname(clean).toLowerCase() || path.posix.basename(clean);
    return {
      safe: false,
      reason: `Refusing to write or splice binary file "${filePath}" (binary extension "${ext}"). AICE only edits UTF-8 text files.`,
    };
  }

  if (options?.checkExistingDiskFile !== false) {
    try {
      if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
        if (isLikelyBinaryDiskFile(filePath)) {
          return {
            safe: false,
            reason: `Refusing to write or splice binary file "${filePath}" (existing file contains NUL/binary bytes or invalid UTF-8). AICE only edits UTF-8 text files.`,
          };
        }
      }
    } catch {
      // ignore stat errors; downstream write will report I/O issues if any
    }
  }

  if (content?.includes("\0")) {
    return {
      safe: false,
      reason: `Refusing to write binary content (NUL byte detected) to "${filePath}". AICE only writes UTF-8 text files.`,
    };
  }

  return { safe: true };
}

/**
 * Guards `createFile` and `splice` against writing to known binary extensions,
 * corrupting existing binary files on disk, or writing NUL-byte binary payloads,
 * while permitting any non-binary text extension (including `.customblob`, `.svg`,
 * dotfiles, and extensionless files).
 */
export function assertSafeTextWriteTarget(
  filePath: string,
  content?: string,
  options?: { checkExistingDiskFile?: boolean },
): void {
  const res = checkSafeTextWriteTarget(filePath, content, options);
  if (!res.safe) {
    throw new Error(res.reason ?? `Refusing to write binary file "${filePath}".`);
  }
}

/**
 * Returns true if `baseName` looks like a dotfile name (e.g. `.gitignore`, `.env.local`,
 * `.customdot`) rather than `.`, `..`, or a known hidden directory (`.git`, `.github`, `.vscode`).
 */
export function isLikelyDotfileName(baseName: string): boolean {
  if (!baseName.startsWith(".") || baseName === "." || baseName === "..") {
    return false;
  }
  if (KNOWN_DOT_DIRECTORY_NAMES.has(baseName)) {
    return false;
  }
  if (KNOWN_TEXT_FILENAMES.has(baseName) || baseName.startsWith(".env.")) {
    return true;
  }
  return /^\.[A-Za-z0-9][A-Za-z0-9._-]*$/.test(baseName);
}

/**
 * Classifies a non-existent path as likely referring to a file (vs a directory).
 * Supports any extension (including unknown extensions like `dir/new.customblob`),
 * dotfiles (`dir/.customdot`), and known extensionless filenames (`Makefile`, `verify`),
 * while preserving genuine directory paths (`src`, `src/tools`, `dir/`, `.github`).
 */
export function isLikelyNonExistentFilePath(rawInput: string, resolvedPath?: string): boolean {
  const trimmed = rawInput.trim();
  if (!trimmed || trimmed.endsWith("/") || trimmed.endsWith("\\")) {
    return false;
  }
  const clean = (resolvedPath ?? trimmed).replace(/\\/g, "/");
  const base = path.posix.basename(clean);
  if (!base || base === "." || base === "..") {
    return false;
  }
  if (KNOWN_TEXT_FILENAMES.has(base) || base.startsWith(".env.")) {
    return true;
  }
  const lower = base.toLowerCase();
  if (lower.endsWith(".aice") || lower.endsWith(".d.ts") || lower.endsWith(".html.twig")) {
    return true;
  }
  if (isLikelyDotfileName(base)) {
    return true;
  }
  const ext = path.posix.extname(lower);
  if (!ext) {
    return false;
  }
  if (BINARY_EXTENSIONS.has(ext) || COMMON_TEXT_FILE_EXTENSIONS.has(ext)) {
    return true;
  }
  return STANDARD_FILE_EXT_RE.test(ext);
}

/**
 * Checks whether a candidate target token looks like a text/readable file path shape
 * (for inline `:selector` splitting and multi-target tokenization in `read.ts` / `context.ts`).
 */
export function isLikelyTextFileShape(candidatePath: string): boolean {
  const clean = candidatePath.trim().replace(/\\/g, "/");
  if (!clean || clean.endsWith("/") || /\s/.test(clean)) {
    return false;
  }
  const base = path.posix.basename(clean);
  if (!base || base === "." || base === "..") {
    return false;
  }
  if (KNOWN_TEXT_FILENAMES.has(base) || base.startsWith(".env.")) {
    return true;
  }
  if (isLikelyDotfileName(base)) {
    return !isBinaryExtension(clean);
  }
  const lower = base.toLowerCase();
  if (lower.endsWith(".aice")) {
    return true;
  }
  const ext = path.posix.extname(lower);
  if (!ext) {
    return false;
  }
  if (BINARY_EXTENSIONS.has(ext)) {
    return false;
  }
  return COMMON_TEXT_FILE_EXTENSIONS.has(ext) || STANDARD_FILE_EXT_RE.test(ext);
}

/**
 * Universal file-target candidate recognizer for splice/create stream headers (`=== <spec> ===`).
 * Recognizes any extension (including unknown extensions like `foo.customblob`, `dir/bar.xyz`,
 * `.customdot`, and extensionless files) while avoiding false positives on bare `Class.method`
 * symbol headers (e.g. `Board.isBoardEmpty`, `Calculator.add`).
 */
export function isUniversalSpliceTargetCandidate(
  cand: string,
  knownTargetExtensions: ReadonlySet<string>,
  baseDir = process.cwd(),
): boolean {
  const clean = cand
    .trim()
    .replace(/^['"`]|['"`]$/g, "")
    .replace(/\\/g, "/");
  if (!clean || /\s/.test(clean) || clean.endsWith("/")) {
    return false;
  }
  if (clean.length > 1 && clean.startsWith("/") && clean.endsWith("/")) {
    return false;
  }
  const base = path.posix.basename(clean);
  if (!base || base === "." || base === "..") {
    return false;
  }
  if (KNOWN_TEXT_FILENAMES.has(base)) {
    return true;
  }
  if (isLikelyDotfileName(base)) {
    return true;
  }
  const rawExt = path.posix.extname(clean);
  const ext = rawExt.toLowerCase();
  const fullCand = path.isAbsolute(clean) ? clean : path.resolve(baseDir, clean);

  if (!ext) {
    if (clean.includes("/")) {
      return !base.startsWith("-") && /^[A-Za-z0-9._-]+$/.test(base);
    }
    try {
      if (fs.existsSync(fullCand) && fs.statSync(fullCand).isFile()) {
        return true;
      }
    } catch {
      // ignore stat errors
    }
    return /^[a-z][a-z0-9]*(?:-[a-z0-9]+)+$/.test(base);
  }

  if (
    knownTargetExtensions.has(ext) ||
    COMMON_TEXT_FILE_EXTENSIONS.has(ext) ||
    BINARY_EXTENSIONS.has(ext) ||
    ext === ".aice"
  ) {
    return true;
  }

  // Explicit path with directory separator (e.g. `app/nonexistent.unknownext`, `dir/Foo.customblob`)
  if (clean.includes("/")) {
    return STANDARD_FILE_EXT_RE.test(rawExt);
  }

  // Existing file on disk always counts as a file candidate
  try {
    if (fs.existsSync(fullCand) && fs.statSync(fullCand).isFile()) {
      return true;
    }
  } catch {
    // ignore stat errors
  }

  // Non-existent bare filename with unknown extension:
  // Accept lowercase or hyphenated stems (`foo.customblob`, `new2.customblob`, `My-File.xyz`)
  // and ALL-CAPS files (`DATA.BLOB`), while rejecting bare `ClassName.member` symbols
  // like `Board.isBoardEmpty` or `Calculator.add`.
  const stem = base.slice(0, base.length - rawExt.length);
  if (!stem) return false;
  if (/^\.[a-z][a-z0-9_-]{0,23}$/.test(rawExt)) {
    return /^[a-z0-9]/.test(stem) || stem.includes("-") || stem.includes(".");
  }
  if (/^\.[A-Z][A-Z0-9_-]{0,23}$/.test(rawExt)) {
    return /^[A-Z0-9_-]+$/.test(stem);
  }
  return false;
}
