/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 First-Class Model Context Protocol (MCP) Server.
 * Exposes all 7 token-optimized AI productivity tools (aice_context, aice_outline,
 * aice_splice, aice_create, aice_idioms, aice_gain, aice_project_config) across
 * all 20 languages / 33 file extensions over JSON-RPC 2.0 stdio streams.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  extractMarkdownDirectiveVersion,
  getAgentsStatus,
  removeAgents,
  setupAgents,
} from "../agents/index.js";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  saveProjectConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
} from "../config/index.js";
import {
  applyProjectIdiomsToDirectory,
  expandAiceSourceIdioms,
  expandProjectIdiomsInDirectory,
  formatIdiomsMarkdownSection,
  readProjectIdiom,
  scanProjectIdioms,
  updateProjectIdiom,
} from "../idioms/index.js";
import {
  buildGainReport,
  formatGlobalGainDashboard,
  formatProjectGainDetail,
  recordTelemetryError,
  recordTelemetryEvent,
  type TelemetryOperation,
  withSuppressedTelemetry,
  withSuppressedTelemetryAsync,
} from "../telemetry/index.js";
import {
  generateContext,
  generateMultiContext,
  parseTargetWithInlineSymbol,
  scanDirectoryForTargets,
  splitContextTargets,
} from "../tools/context.js";
import {
  type BatchCreateItem,
  createBatch,
  createFile,
  parseMultiFileCreateStream,
} from "../tools/create.js";
import { outlinePath } from "../tools/outline.js";
import {
  type BatchSpliceItem,
  parseMultiBlockSpliceStream,
  splice,
  spliceBatch,
} from "../tools/splice.js";
import { AICE_VERSION as DEFAULT_AICE_VERSION } from "../version.js";

function loadPackageVersion(): string {
  try {
    const pkgPath = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "../../package.json",
    );
    const parsed = JSON.parse(fs.readFileSync(pkgPath, "utf-8")) as { version?: string };
    if (typeof parsed.version === "string" && parsed.version.trim().length > 0) {
      return parsed.version.trim();
    }
  } catch {
    // fallback if package.json is unreachable
  }
  return DEFAULT_AICE_VERSION;
}

export const AICE_VERSION = loadPackageVersion();

export interface McpToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: "object";
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export const AICE_MCP_TOOLS: McpToolDefinition[] = [
  {
    name: "aice_context",
    description:
      "Generate token-optimized AICE context bundle with target source/outline, dependency contracts, and downstream callers (supports single or multi-file targets with inline ':symbol' selectors). MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! When reading 2+ files or symbols, batch ALL targets into a SINGLE call via space-separated 'path' (e.g. 'src/a.ts:fnA src/b.ts:L10-L50') or 'paths' array.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Target .aice or target language file/directory path (supports inline 'file:sym1,sym2', 'file:L10-L30', or space-separated multi-target paths in 1 call)",
        },
        fileOrDir: {
          type: "string",
          description: "Alias for path: target file or directory path",
        },
        filePath: {
          type: "string",
          description: "Alias for path: target file path",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description:
            "Optional array of target file paths with optional inline ':symbol' selectors (e.g. ['src/a.aipl:fnA,fnB', 'src/b.aipl:L10-L50']) to read multiple files in 1 call",
        },
        symbol: {
          type: "string",
          description:
            "Optional selector: symbol ('Class.method'), test ID ('TC-001'), Markdown heading, line range ('L10-L30' — fast path with 0 dependency bloat), or regex ('/pattern/')",
        },
        selector: {
          type: "string",
          description:
            "Alias for symbol: symbol name, line range (e.g. L1-L150), or regex (/pattern/)",
        },
        depth: {
          type: "number",
          description:
            "Dependency traversal depth (default: 1 for symbols, 0 for Lstart-Lend and /pattern/ fast path)",
        },
        maxTokens: {
          type: "number",
          description: "Maximum token budget to bound the context pack",
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project $idioms",
        },
      },
      required: [],
    },
  },
  {
    name: "aice_outline",
    description:
      "Generate structural skeleton outline of one or more .aice or native files or project directories across all 20 languages / 33 file extensions achieving 85-90%+ token reduction.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description:
            "Optional path (or comma/whitespace-separated paths) to .aice or native file(s) or project directory (default: '.')",
        },
        fileOrDir: {
          type: "string",
          description: "Alias for path: file or directory path",
        },
        filePath: {
          type: "string",
          description: "Alias for path: file path",
        },
        paths: {
          type: "array",
          items: { type: "string" },
          description: "Optional array of file or directory paths (e.g., ['src', 'tests'])",
        },
        depth: {
          type: "number",
          description: "Optional maximum symbol nesting depth (e.g. 1 for top-level skeleton only)",
        },
        types: {
          type: "boolean",
          description:
            "Optional flag to include or omit type/interface field details (default: true)",
        },
        compact: {
          type: "boolean",
          description: "Optional compact directory mode override (auto-enabled for 100+ files)",
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project $idioms",
        },
      },
      required: [],
    },
  },
  {
    name: "aice_splice",
    description:
      "Surgically replace, delete, hunk-patch, or batch-edit one or more named symbols, line ranges, or files across all 20 languages / 33 file extensions. MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! When creating or editing 2+ files, batch ALL files into a SINGLE call using `=== <filePath> ===` or `=== <filePath>:<symbol> ===` headers inside `code` (or `files` / `edits` array), or use 1 Bash `aice splice --stdin << 'EOF'` heredoc.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Optional path to target native or .aice file (omit when 'code' / 'newAiceCode' contains '=== <filePath>:<symbol> ===' or '=== <filePath> ===' multi-file stream headers, or when 'files' / 'edits' includes filePath)",
        },
        path: {
          type: "string",
          description: "Alias for filePath: target file path",
        },
        fileOrDir: {
          type: "string",
          description: "Alias for filePath: target file path",
        },
        symbolSelector: {
          type: "string",
          description:
            "Identifier of target symbol (e.g., 'calculate', 'GameEngine.step', 'imports', 'eof', or line range 'L10-L25')",
        },
        symbol: {
          type: "string",
          description: "Alias for 'symbolSelector'",
        },
        code: {
          type: "string",
          description:
            "Replacement code, AST-scoped hunk ('<<<\\n<search>\\n===\\n<replace>\\n>>>'), or multi-file stream with '=== <filePath>:<symbol> ===' / '=== <filePath> ===' headers. MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! When creating or editing 2+ files, batch ALL files into a SINGLE call using `=== <filePath> ===` or `=== <filePath>:<symbol> ===` headers inside `code` (or `files` / `edits` array), or use 1 Bash `aice splice --stdin << 'EOF'` heredoc.",
        },
        newAiceCode: {
          type: "string",
          description:
            "Alias for 'code': replacement snippet, '<<< / === / >>>' hunk, or multi-file '=== <filePath>:<symbol> ===' stream",
        },
        body: {
          type: "string",
          description: "Optional body-only replacement statements keeping the existing signature",
        },
        delete: {
          type: "boolean",
          description: "If true, removes the symbol entirely",
        },
        insertAfter: {
          type: "string",
          description: "Inserts the new code directly after the named symbol",
        },
        insertBefore: {
          type: "string",
          description: "Inserts the new code directly before the named symbol",
        },
        preserveDocs: {
          type: "boolean",
          description:
            "Whether to preserve existing leading JSDoc/docstrings on replaced symbols (default: true)",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview the spliced output/diff without writing to disk",
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project/inline $idioms",
        },
        edits: {
          type: "array",
          description:
            "Optional multi-symbol or multi-file batch edits applied atomically in reverse offset order (bottom-to-top)",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              symbol: { type: "string" },
              code: { type: "string" },
              body: { type: "string" },
              delete: { type: "boolean" },
              insertAfter: { type: "string" },
              insertBefore: { type: "string" },
              preserveDocs: { type: "boolean" },
            },
            required: ["symbol"],
          },
        },
        files: {
          type: "array",
          description:
            "Optional array of per-file splice items ({ filePath, symbol?, code?, body?, delete?, insertAfter?, insertBefore?, preserveDocs?, edits? }) for atomic multi-file splicing",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              symbol: { type: "string" },
              code: { type: "string" },
              body: { type: "string" },
              delete: { type: "boolean" },
              insertAfter: { type: "string" },
              insertBefore: { type: "string" },
              preserveDocs: { type: "boolean" },
            },
            required: ["filePath"],
          },
        },
      },
    },
  },
  {
    name: "aice_idioms",
    description:
      "Scan, list, apply, expand, toggle (on/off), read, or update token-saving $idioms in a project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        action: {
          type: "string",
          enum: ["scan", "apply", "expand", "list", "on", "off", "read", "update"],
          description: "Idiom action to perform",
        },
        dir: {
          type: "string",
          description: "Optional project or source directory (default: '.')",
        },
        name: {
          type: "string",
          description: "Idiom name (e.g. '$arc') for 'read' or 'update' actions",
        },
        code: {
          type: "string",
          description: "New AICE template for 'update' action",
        },
        params: {
          type: "string",
          description:
            "Optional comma-separated parameter names (e.g. '$0,$1') for 'update' action",
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project $idioms for this call",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview scan/update/expand without modifying files",
        },
        minOccurrences: {
          type: "number",
          description: "Minimum occurrences threshold for mining or applying",
        },
        minSavings: {
          type: "number",
          description: "Minimum net token savings threshold",
        },
      },
      required: ["action"],
    },
  },
  {
    name: "aice_create",
    description:
      "Create greenfield/startup native files from compact AICE syntax, inline @idiom macros, or hybrid code across all 20 languages / 33 file extensions (40-75% output token savings). MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! When creating or editing 2+ files, batch ALL files into a SINGLE call using `=== <filePath> ===` or `=== <filePath>:<symbol> ===` headers inside `code` (or `files` / `edits` array), or use 1 Bash `aice splice --stdin << 'EOF'` heredoc.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description:
            "Target native file path for single-file creation (omit when batching multiple files via '=== <filePath> ===' headers in 'code' or via 'files')",
        },
        code: {
          type: "string",
          description:
            "Compact AICE, $idiom, or native code string, OR multi-file stream delimited by '=== <filePath> ===' headers. MULTI-FILE STREAM ENGINE: NEVER call this tool multiple times in a file-by-file loop! When creating or editing 2+ files, batch ALL files into a SINGLE call using `=== <filePath> ===` or `=== <filePath>:<symbol> ===` headers inside `code` (or `files` / `edits` array), or use 1 Bash `aice splice --stdin << 'EOF'` heredoc.",
        },
        files: {
          type: "array",
          description: "Optional array of { filePath, code } items for multi-file batch creation",
          items: {
            type: "object",
            properties: {
              filePath: { type: "string" },
              code: { type: "string" },
            },
            required: ["filePath", "code"],
          },
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project/inline $idioms",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview compiled native code without writing to disk",
        },
        overwrite: {
          type: "boolean",
          description: "If true, allows full-file overwrite of existing files with > 25 lines",
        },
      },
      required: [],
    },
  },
  {
    name: "aice_gain",
    description:
      "Inspect honest global or per-project BPE token-reduction telemetry (cl100k_base & o200k_base).",
    inputSchema: {
      type: "object",
      properties: {
        project: {
          type: "string",
          description: "Optional project path or name to drill down into",
        },
        unique: {
          type: "boolean",
          description: "If true, deduplicate repeated identical operations by contentHash",
        },
        json: {
          type: "boolean",
          description: "If true, return structured JSON telemetry report",
        },
      },
      required: [],
    },
  },
  {
    name: "aice_project_config",
    description: `Inspect or toggle project-level AICE controls ('enabled' and 'idiomsEnabled'), rule sync status, global agent config (when scope='global'), and AICE version (v${AICE_VERSION}) in aice.config.json.`,
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Project directory within workspaceRoot (default: workspaceRoot)",
        },
        scope: {
          type: "string",
          enum: ["project", "global"],
          description:
            "Configuration scope: 'project' (confined to workspaceRoot) or 'global' (manages global CLI coding agent integrations)",
        },
        action: {
          type: "string",
          enum: ["enable", "disable", "status", "setup", "remove"],
          description: "Optional action ('enable' | 'disable' | 'status' | 'setup' | 'remove')",
        },
        agent: {
          type: "string",
          description: "Optional agent ID when scope='global' (e.g. 'claude', 'agy', 'codex')",
        },
        all: {
          type: "boolean",
          description: "When scope='global' and action='setup', configure all supported agents",
        },
        homeDir: {
          type: "string",
          description: "Optional home directory override when scope='global'",
        },
        enabled: {
          type: "boolean",
          description: "Optional boolean to enable or disable AICE for this project",
        },
        idiomsEnabled: {
          type: "boolean",
          description: "Optional boolean to enable or disable $idioms for this project",
        },
      },
      required: [],
    },
  },
];

export interface McpToolCallResult {
  content: Array<{
    type: "text";
    text: string;
  }>;
  isError?: boolean;
}

export class AiceMcpServer {
  private inStream?: Readable;
  private outStream?: Writable;
  private buffer = Buffer.alloc(0);
  private isFramed = false;
  private readonly workspaceRoot: string;
  private readonly declaredRoots: Set<string> = new Set();
  private messageQueue: Promise<void> = Promise.resolve();
  public static getToolDefinitions(): McpToolDefinition[] {
    return AICE_MCP_TOOLS;
  }

  public getToolDefinitions(): McpToolDefinition[] {
    return AICE_MCP_TOOLS;
  }

  constructor(
    inStreamOrOptions?: Readable | { workspaceRoot?: string },
    outStream?: Writable,
    options?: { workspaceRoot?: string },
  ) {
    if (
      inStreamOrOptions &&
      typeof (inStreamOrOptions as Readable).on !== "function" &&
      "workspaceRoot" in inStreamOrOptions
    ) {
      this.inStream = undefined;
      this.outStream = undefined;
      this.workspaceRoot = path.resolve(inStreamOrOptions.workspaceRoot ?? process.cwd());
    } else {
      this.inStream = inStreamOrOptions as Readable | undefined;
      this.outStream = outStream;
      this.workspaceRoot = path.resolve(options?.workspaceRoot ?? process.cwd());
    }
    this.declaredRoots.add(this.workspaceRoot);

    if (this.inStream && typeof this.inStream.on === "function") {
      this.inStream.on("data", (chunk: Buffer) => this.handleData(chunk));
    }
  }

  private getBlockedSystemPrefixes(): string[] {
    const blockedPrefixes = ["/etc", "/proc", "/sys", "/dev"];
    const home = path.resolve(os.homedir());
    if (home !== "/root") {
      blockedPrefixes.push("/root");
    }
    return blockedPrefixes;
  }

  private isBlockedSystemPath(candidatePath: string): boolean {
    const norm = path.resolve(candidatePath);
    if (norm === "/") return true;
    for (const prefix of this.getBlockedSystemPrefixes()) {
      if (norm === prefix || norm.startsWith(`${prefix}/`)) {
        return true;
      }
    }
    return false;
  }

  private captureInitializeRoots(params: unknown): void {
    if (!params || typeof params !== "object") return;
    const p = params as Record<string, unknown>;
    const addCandidate = (uriOrPath: unknown) => {
      if (typeof uriOrPath !== "string" || !uriOrPath.trim()) return;
      try {
        const resolved = uriOrPath.startsWith("file://")
          ? path.resolve(fileURLToPath(uriOrPath))
          : path.resolve(uriOrPath);
        if (!this.isBlockedSystemPath(resolved)) {
          this.declaredRoots.add(resolved);
        }
      } catch {
        // ignore invalid URI
      }
    };

    addCandidate(p.rootUri);
    addCandidate(p.rootPath);
    if (Array.isArray(p.workspaceFolders)) {
      for (const wf of p.workspaceFolders) {
        if (wf && typeof wf === "object") {
          const folder = wf as Record<string, unknown>;
          addCandidate(folder.uri ?? folder.path);
        }
      }
    }
    if (Array.isArray(p.roots)) {
      for (const r of p.roots) {
        if (r && typeof r === "object") {
          const rootObj = r as Record<string, unknown>;
          addCandidate(rootObj.uri ?? rootObj.path);
        }
      }
    }
  }

  private resolveCanonicalTarget(candidatePath: string, depth = 0): string {
    if (depth > 32) {
      throw new Error(`Access denied: symlink loop detected for '${candidatePath}'`);
    }
    const resolved = path.resolve(candidatePath);
    try {
      return fs.realpathSync(resolved);
    } catch {
      // Target or an ancestor does not exist, or target is a dangling symlink
    }

    const trailingSegments: string[] = [];
    let cur = resolved;
    while (true) {
      try {
        const lstat = fs.lstatSync(cur);
        if (lstat.isSymbolicLink()) {
          const linkTarget = path.resolve(path.dirname(cur), fs.readlinkSync(cur));
          const combined =
            trailingSegments.length > 0 ? path.join(linkTarget, ...trailingSegments) : linkTarget;
          return this.resolveCanonicalTarget(combined, depth + 1);
        }
        const realBase = fs.realpathSync(cur);
        return trailingSegments.length > 0 ? path.join(realBase, ...trailingSegments) : realBase;
      } catch {
        const parent = path.dirname(cur);
        if (parent === cur) {
          return resolved;
        }
        trailingSegments.unshift(path.basename(cur));
        cur = parent;
      }
    }
  }

  public resolveSafePath(rawPath: string): string {
    if (rawPath.includes("\0")) {
      throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
    }

    const resolved = path.resolve(this.workspaceRoot, rawPath);

    // Block sensitive system directories lexically
    if (this.isBlockedSystemPath(resolved)) {
      throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
    }

    // Reject relative path-traversal that escapes workspaceRoot
    if (!path.isAbsolute(rawPath)) {
      const normRel = path.normalize(rawPath);
      if (
        (normRel.startsWith("..") || rawPath.includes("..")) &&
        resolved !== this.workspaceRoot &&
        !resolved.startsWith(this.workspaceRoot + path.sep)
      ) {
        throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
      }
    }

    const baseAllowedRoots = [this.workspaceRoot, ...this.declaredRoots];
    const allowedRoots = new Set<string>(baseAllowedRoots);
    for (const r of baseAllowedRoots) {
      try {
        if (fs.existsSync(r)) {
          allowedRoots.add(fs.realpathSync(r));
        }
      } catch {
        // ignore
      }
    }

    const isWithinAllowed = (target: string): boolean =>
      Array.from(allowedRoots).some(
        (root) => target === root || target.startsWith(root + path.sep),
      );

    if (!isWithinAllowed(resolved)) {
      throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
    }

    // Defeat symlink escape attacks (including dangling symlinks and deeply nested missing dirs)
    try {
      const realCandidate = this.resolveCanonicalTarget(resolved);
      if (this.isBlockedSystemPath(realCandidate) || !isWithinAllowed(realCandidate)) {
        throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
      }
    } catch (err) {
      if (err instanceof Error && err.message.startsWith("Access denied:")) {
        throw err;
      }
    }

    return resolved;
  }

  private enqueueSerial<T>(fn: () => Promise<T> | T): Promise<T> {
    const next = this.messageQueue.then(fn, fn);
    this.messageQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private handleData(chunk: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, chunk]);
    this.processBuffer();
  }

  private processBuffer(): void {
    while (this.buffer.length > 0) {
      const bufferStr = this.buffer.toString("utf-8");
      const trimmed = bufferStr.trimStart();

      if (trimmed.startsWith("Content-Length:") || bufferStr.startsWith("Content-Length:")) {
        this.isFramed = true;
        const headerEndIndex = this.buffer.indexOf("\r\n\r\n");
        if (headerEndIndex === -1) {
          break;
        }

        const headerText = this.buffer.subarray(0, headerEndIndex).toString("utf-8");
        const match = /Content-Length:\s*(\d+)/i.exec(headerText);
        if (!match) {
          this.buffer = this.buffer.subarray(headerEndIndex + 4);
          continue;
        }

        const contentLength = Number.parseInt(match[1], 10);
        const messageStartIndex = headerEndIndex + 4;
        const messageEndIndex = messageStartIndex + contentLength;
        if (this.buffer.length < messageEndIndex) {
          break;
        }

        const payload = this.buffer.subarray(messageStartIndex, messageEndIndex).toString("utf-8");
        this.buffer = this.buffer.subarray(messageEndIndex);

        try {
          const msg = JSON.parse(payload);
          void this.handleMessage(msg).catch(() => {});
        } catch {
          void this.enqueueSerial(() => {
            this.sendResponse(null, undefined, {
              code: -32700,
              message: "Parse error",
            });
          });
        }
      } else {
        const newlineIndex = this.buffer.indexOf("\n");
        if (newlineIndex === -1) {
          break;
        }

        const line = this.buffer.subarray(0, newlineIndex).toString("utf-8").trim();
        this.buffer = this.buffer.subarray(newlineIndex + 1);

        if (line) {
          try {
            const msg = JSON.parse(line);
            void this.handleMessage(msg).catch(() => {});
          } catch {
            void this.enqueueSerial(() => {
              this.sendResponse(null, undefined, {
                code: -32700,
                message: "Parse error",
              });
            });
          }
        }
      }
    }
  }

  public sendResponse(id: number | string | null, result?: unknown, error?: unknown): void {
    const msg: Record<string, unknown> = { jsonrpc: "2.0", id };
    if (error) {
      msg.error = error;
    } else {
      msg.result = result ?? {};
    }
    this.sendMessage(msg);
  }

  public sendMessage(msg: unknown): void {
    const json = JSON.stringify(msg);
    let output: string;
    if (this.isFramed) {
      const byteLength = Buffer.byteLength(json, "utf-8");
      output = `Content-Length: ${byteLength}\r\n\r\n${json}`;
    } else {
      output = `${json}\n`;
    }

    if (this.outStream) {
      this.outStream.write(output);
    }
  }

  public handleMessage(msg: unknown): Promise<unknown> {
    return this.enqueueSerial(() => this.processSingleMessage(msg));
  }

  private async processSingleMessage(msg: unknown): Promise<unknown> {
    if (
      !msg ||
      typeof msg !== "object" ||
      Array.isArray(msg) ||
      typeof (msg as { method?: unknown }).method !== "string"
    ) {
      const reqId =
        msg && typeof msg === "object" && !Array.isArray(msg) && "id" in msg
          ? ((msg as { id?: number | string | null }).id ?? null)
          : null;
      this.sendResponse(reqId, undefined, {
        code: -32600,
        message: "Invalid Request",
      });
      return undefined;
    }

    const request = msg as { id?: number | string | null; method: string; params?: unknown };
    if ("id" in request && request.id !== undefined && request.id !== null) {
      try {
        const result = await this.handleRequest(request.id, request.method, request.params);
        this.sendResponse(request.id, result);
        return result;
      } catch (err: unknown) {
        const errCode =
          err && typeof err === "object" && typeof (err as { code?: unknown }).code === "number"
            ? (err as { code: number }).code
            : -32603;
        const error = {
          code: errCode,
          message: err instanceof Error ? err.message : String(err),
        };
        this.sendResponse(request.id, undefined, error);
        throw err;
      }
    }

    await this.handleNotification(request.method, request.params);
    return undefined;
  }
  public async handleRequest(
    idOrReq:
      | number
      | string
      | { jsonrpc?: string; id?: number | string; method: string; params?: unknown },
    methodArg?: string,
    paramsArg?: unknown,
  ): Promise<unknown> {
    const isObjCall =
      typeof idOrReq === "object" && idOrReq !== null && typeof idOrReq.method === "string";
    const method = isObjCall ? idOrReq.method : (methodArg as string);
    const params = isObjCall ? idOrReq.params : paramsArg;
    const wrapOut = (res: unknown) =>
      isObjCall ? { jsonrpc: "2.0", id: idOrReq.id ?? 1, result: res } : res;

    switch (method) {
      case "initialize": {
        this.captureInitializeRoots(params);
        return wrapOut({
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "aice-mcp", version: AICE_VERSION },
        });
      }

      case "ping": {
        return wrapOut({});
      }

      case "tools/list": {
        return wrapOut({ tools: AICE_MCP_TOOLS });
      }

      case "tools/call": {
        const callParams = params as { name: string; arguments?: Record<string, unknown> };
        const toolArgs = callParams?.arguments ?? {};
        try {
          const res = await this.executeToolCall(callParams?.name, toolArgs);
          return wrapOut(res);
        } catch (err: unknown) {
          const toolToOp: Record<string, TelemetryOperation> = {
            aice_outline: "outline",
            aice_context: "context",
            aice_splice: "splice",
            aice_create: "create",
            aice_decompile: "decompile",
            aice_patch: "patch",
            aice_idioms: "idioms_apply",
          };
          const op = toolToOp[callParams?.name ?? ""];
          if (op) {
            const rawTarget = String(
              toolArgs.filePath ??
                toolArgs.path ??
                toolArgs.file ??
                toolArgs.dir ??
                this.workspaceRoot,
            );
            recordTelemetryError({
              targetPath: path.resolve(this.workspaceRoot, rawTarget),
              projectRoot: this.resolveProjectRoot(this.workspaceRoot),
              operation: op,
              surface: "mcp",
              errorMessage: err instanceof Error ? err.message : String(err),
            });
          }
          throw err;
        }
      }

      default: {
        throw Object.assign(new Error(`Method not found: ${method}`), { code: -32601 });
      }
    }
  }

  public async handleNotification(method: string, _params: unknown): Promise<void> {
    switch (method) {
      case "notifications/initialized":
      case "initialized":
        break;
    }
  }

  private resolveProjectRoot(fullPath: string): string {
    const resolvedFull = path.resolve(fullPath);
    const resolvedWs = path.resolve(this.workspaceRoot);
    const fallback =
      resolvedFull === resolvedWs || resolvedFull.startsWith(`${resolvedWs}${path.sep}`)
        ? resolvedWs
        : undefined;
    return findProjectRoot(resolvedFull, fallback);
  }

  public async executeToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    switch (name) {
      case "aice_context": {
        {
          const rawSelector =
            (typeof args.symbol === "string" && args.symbol.trim().length > 0
              ? args.symbol
              : undefined) ??
            (typeof args.selector === "string" && args.selector.trim().length > 0
              ? args.selector
              : undefined) ??
            (typeof args.sym === "string" && args.sym.trim().length > 0
              ? args.sym
              : undefined) ??
            (typeof args.range === "string" && args.range.trim().length > 0
              ? args.range
              : undefined) ??
            (args.symbol ?? args.selector ?? args.sym ?? args.range);
          const symbolFilter =
            typeof rawSelector === "string" && rawSelector.trim().length > 0
              ? rawSelector.trim()
              : undefined;

          let rawTargets: string[] = [];
          const candidateArray = args.paths ?? args.files ?? args.targets ?? args.filesOrDirs;
          const rawPathCandidate =
            args.path ??
            args.fileOrDir ??
            args.filePath ??
            args.file ??
            args.dir ??
            args.target ??
            args.inputPath ??
            args.source;
          if (Array.isArray(candidateArray) && candidateArray.length > 0) {
            rawTargets = (candidateArray as unknown[]).map((p) => String(p).trim()).filter(Boolean);
          } else {
            const rawPathStr = String(rawPathCandidate ?? ".").trim() || ".";
            rawTargets = splitContextTargets(rawPathStr, this.workspaceRoot);
            if (rawTargets.length === 0) {
              rawTargets = [rawPathStr];
            }
          }
          if (rawTargets.length > 1) {
            const safeTargets: Array<{ path: string; symbol?: string }> = [];
            let firstSafePath = this.workspaceRoot;
            for (const rawT of rawTargets) {
              const parsed = parseTargetWithInlineSymbol(rawT, this.workspaceRoot);
              const safeFp = this.resolveSafePath(parsed.targetPath);
              if (safeTargets.length === 0) firstSafePath = safeFp;
              safeTargets.push({
                path: safeFp,
                symbol: parsed.inlineSymbol ?? symbolFilter,
              });
            }
            const projectRoot = this.resolveProjectRoot(firstSafePath);
            const config = loadProjectConfig(projectRoot);
            if (!isProjectAiceEnabled(config)) {
              return {
                content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
                isError: true,
              };
            }
            const effectiveIdioms = isProjectIdiomsEnabled(
              config,
              typeof args.idioms === "boolean" ? args.idioms : undefined,
            );
            const multiRes = await withSuppressedTelemetryAsync(() =>
              generateMultiContext(safeTargets, {
                depth: typeof args.depth === "number" ? args.depth : undefined,
                maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
                idioms: effectiveIdioms,
                projectRoot,
              }),
            );
            const nativeTexts = safeTargets
              .map((t) => {
                try {
                  if (fs.existsSync(t.path) && fs.statSync(t.path).isFile()) {
                    return fs.readFileSync(t.path, "utf-8");
                  }
                  if (fs.existsSync(t.path) && fs.statSync(t.path).isDirectory()) {
                    return scanDirectoryForTargets(t.path)
                      .slice(0, 60)
                      .map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : ""))
                      .join("\n");
                  }
                  return "";
                } catch {
                  return "";
                }
              })
              .filter(Boolean)
              .join("\n");
            recordTelemetryEvent({
              targetPath: firstSafePath,
              projectRoot,
              operation: "context",
              surface: "mcp",
              idiomsUsed: Boolean(
                effectiveIdioms && multiRes.idioms && Object.keys(multiRes.idioms).length > 0,
              ),
              nativeText: nativeTexts || multiRes.targetContent,
              aiceText: multiRes.formattedBundle,
            });
            return {
              content: [{ type: "text", text: multiRes.formattedBundle }],
            };
          }

          const singleRaw = rawTargets[0] ?? (String(rawPathCandidate ?? ".").trim() || ".");
          const parsedSingle = parseTargetWithInlineSymbol(singleRaw, this.workspaceRoot);
          const targetPath = parsedSingle.targetPath || ".";
          const effectiveSymbol = parsedSingle.inlineSymbol ?? symbolFilter;
          const fullPath = this.resolveSafePath(targetPath);
          const projectRoot = this.resolveProjectRoot(fullPath);
          const config = loadProjectConfig(projectRoot);
          if (!isProjectAiceEnabled(config)) {
            return {
              content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
              isError: true,
            };
          }
          const effectiveIdioms = isProjectIdiomsEnabled(
            config,
            typeof args.idioms === "boolean" ? args.idioms : undefined,
          );
          const result = await withSuppressedTelemetryAsync(() =>
            generateContext(fullPath, {
              depth: typeof args.depth === "number" ? args.depth : undefined,
              maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
              symbol: effectiveSymbol,
              idioms: effectiveIdioms,
              projectRoot,
            }),
          );

          let nativeText = "";
          let isDirTarget = false;
          try {
            if (fs.existsSync(fullPath)) {
              const stat = fs.statSync(fullPath);
              if (stat.isFile()) {
                nativeText = fs.readFileSync(fullPath, "utf-8");
              } else if (stat.isDirectory()) {
                isDirTarget = true;
                nativeText = scanDirectoryForTargets(fullPath)
                  .slice(0, 60)
                  .map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : ""))
                  .join("\n");
              }
            }
          } catch {
            // ignore
          }

          let text = result.targetContent;
          let callers = result.callers;
          if (isDirTarget && !effectiveSymbol) {
            text = result.formattedBundle;
          } else {
            if (effectiveSymbol) {
              text = `## Focused Symbol: ${effectiveSymbol}\n\n${text}`;
              if (callers) {
                const rootSym = effectiveSymbol.split(/\.|::/)[0]?.trim() ?? effectiveSymbol;
                callers = callers.filter(
                  (c) =>
                    c.importedSymbols.includes(effectiveSymbol) ||
                    c.importedSymbols.includes(rootSym) ||
                    c.importedSymbols.includes("*") ||
                    (c.callSiteLines && c.callSiteLines.length > 0),
                );
              }
            }
            if (result.targetOutline && !effectiveSymbol) {
              text += `\n\n## Target Outline\n${result.targetOutline}`;
            }
            if (result.dependencies && result.dependencies.length > 0) {
              text +=
                `\n\n## Dependencies\n` +
                result.dependencies
                  .map((d) => `### ${d.specifier}\n\`\`\`aice\n${d.contract}\n\`\`\``)
                  .join("\n\n");
            }
            if (callers && callers.length > 0) {
              text +=
                `\n\n## Downstream Callers\n` +
                callers
                  .map((c) => {
                    const callSitesSuffix =
                      c.usedSymbol && c.callSiteLines && c.callSiteLines.length > 0
                        ? ` (uses ${c.usedSymbol} at [${c.callSiteLines.map((l) => `L${l}`).join(", ")}])`
                        : "";
                    return `- ${c.filePath}:${c.line} (${c.importedSymbols.join(", ")})${callSitesSuffix}`;
                  })
                  .join("\n");
            }
            const hasZeroExtras =
              (!result.dependencies || result.dependencies.length === 0) &&
              (!callers || callers.length === 0) &&
              (!result.idioms || Object.keys(result.idioms).length === 0);
            const isSmallNoExtras =
              !isDirTarget &&
              nativeText.length > 0 &&
              Math.ceil(nativeText.length / 4) < 120 &&
              hasZeroExtras;
            if (
              !isDirTarget &&
              !isSmallNoExtras &&
              effectiveIdioms &&
              result.idioms &&
              Object.keys(result.idioms).length > 0
            ) {
              text += `\n\n${formatIdiomsMarkdownSection(result.idioms)}`;
            }
            if (result.nativeDiagnostics) {
              text += `\n\n${result.nativeDiagnostics}`;
            }
            if ((isSmallNoExtras || Boolean(effectiveSymbol)) && hasZeroExtras) {
              text = result.formattedBundle;
            }
          }

          recordTelemetryEvent({
            targetPath: fullPath,
            projectRoot,
            operation: "context",
            surface: "mcp",
            idiomsUsed: Boolean(
              effectiveIdioms && result.idioms && Object.keys(result.idioms).length > 0,
            ),
            nativeText: nativeText || result.targetContent,
            aiceText: text,
          });

          let safeContextText = text;
          const contextLines = text.split("\n");
          if (isDirTarget && contextLines.length > 95) {
            const capped = contextLines.slice(0, 88).join("\n");
            const omittedCount = contextLines.length - 88;
            safeContextText = `${capped}\n\n// ... [${omittedCount} lines omitted to prevent MCP context spill; scope search with 'path' to a specific file or symbol]`;
          }

          return {
            content: [{ type: "text", text: safeContextText }],
          };
        }
      }
      case "aice_outline": {
        let rawPaths: string[] = [];
        const candidatePaths = args.paths ?? args.files ?? args.targets ?? args.filesOrDirs;
        const rawPathCandidate =
          args.path ??
          args.fileOrDir ??
          args.filePath ??
          args.file ??
          args.dir ??
          args.target;
        if (Array.isArray(candidatePaths)) {
          rawPaths = (candidatePaths as unknown[]).map((p) => String(p).trim()).filter(Boolean);
        } else {
          const rawPathStr = String(rawPathCandidate ?? "").trim();
          if (rawPathStr) {
            if (
              !rawPathStr.includes(",") &&
              fs.existsSync(path.resolve(this.workspaceRoot, rawPathStr))
            ) {
              rawPaths = [rawPathStr];
            } else {
              rawPaths = rawPathStr
                .split(/[\s,]+/)
                .map((s) => s.trim())
                .filter(Boolean);
            }
          }
        }
        if (rawPaths.length === 0) {
          rawPaths.push(".");
        }
        const safePaths = rawPaths.map((p) => this.resolveSafePath(p));
        const firstFullPath = safePaths[0]!;
        const projectRoot = this.resolveProjectRoot(firstFullPath);
        const config = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(config)) {
          return {
            content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
            isError: true,
          };
        }
        const effectiveIdioms = isProjectIdiomsEnabled(
          config,
          typeof args.idioms === "boolean" ? args.idioms : undefined,
        );
        const depthOpt = typeof args.depth === "number" ? args.depth : undefined;
        const includeTypesOpt = typeof args.types === "boolean" ? args.types : undefined;
        const compactOpt = typeof args.compact === "boolean" ? args.compact : undefined;

        const result = await withSuppressedTelemetryAsync(() =>
          outlinePath(safePaths.length === 1 ? firstFullPath : safePaths, {
            json: false,
            stats: true,
            compact: compactOpt,
            depth: depthOpt,
            includeTypes: includeTypesOpt,
            idioms: effectiveIdioms,
            projectRoot,
          }),
        );

        const outlineText =
          result instanceof Map
            ? Array.from(result.entries())
                .map(([key, r]) =>
                  result.size > 1 || safePaths.length > 1 ? `// === ${key} ===\n${r.text}` : r.text,
                )
                .join("\n\n")
            : result.text || JSON.stringify(result);

        const anyIdiomsUsed =
          result instanceof Map
            ? Array.from(result.values()).some((r) => (r.referencedIdioms?.length ?? 0) > 0)
            : (result.referencedIdioms?.length ?? 0) > 0;

        const nativeParts: string[] = [];
        try {
          if (!(result instanceof Map)) {
            if (fs.existsSync(firstFullPath) && fs.statSync(firstFullPath).isFile()) {
              nativeParts.push(fs.readFileSync(firstFullPath, "utf-8"));
            }
          } else {
            for (const r of result.values()) {
              if (fs.existsSync(r.file)) {
                nativeParts.push(fs.readFileSync(r.file, "utf-8"));
              }
            }
          }
        } catch {
          // ignore
        }

        const nativeText = nativeParts.join("\n");
        recordTelemetryEvent({
          targetPath: firstFullPath,
          projectRoot,
          operation: "outline",
          surface: "mcp",
          idiomsUsed: anyIdiomsUsed,
          nativeText: nativeText || outlineText,
          aiceText: outlineText,
        });

        let safeOutlineText = outlineText;
        const outlineLines = outlineText.split("\n");
        if (outlineLines.length > 95) {
          const capped = outlineLines.slice(0, 88).join("\n");
          const omittedCount = outlineLines.length - 88;
          safeOutlineText = `${capped}\n\n// ... [${omittedCount} lines omitted to prevent MCP context spill; scope outline with 'path' to a specific directory or file]`;
        }

        return {
          content: [{ type: "text", text: safeOutlineText }],
        };
      }

      case "aice_splice": {
        const rawTargetFile = String(
          args.filePath ??
            args.path ??
            args.file ??
            args.fileOrDir ??
            args.target ??
            "",
        );
        const rawSelector =
          (typeof args.symbolSelector === "string" && args.symbolSelector.trim().length > 0
            ? args.symbolSelector
            : undefined) ??
          (typeof args.symbol === "string" && args.symbol.trim().length > 0
            ? args.symbol
            : undefined) ??
          (typeof args.selector === "string" && args.selector.trim().length > 0
            ? args.selector
            : undefined) ??
          (typeof args.range === "string" && args.range.trim().length > 0
            ? args.range
            : undefined) ??
          (args.symbolSelector ?? args.symbol ?? args.selector ?? args.range ?? "");
        const symbolSelector = String(rawSelector);
        const newAiceCode =
          typeof args.newAiceCode === "string"
            ? args.newAiceCode
            : typeof args.code === "string"
              ? args.code
              : undefined;
        const bodyCode = typeof args.body === "string" ? args.body : undefined;
        const deleteFlag = Boolean(args.delete);
        const dryRun = Boolean(args.dryRun);
        const preserveDocs = typeof args.preserveDocs === "boolean" ? args.preserveDocs : undefined;
        const insertAfter =
          typeof args.insertAfter === "string"
            ? args.insertAfter
            : typeof args.insert_after === "string"
              ? args.insert_after
              : undefined;
        const insertBefore =
          typeof args.insertBefore === "string"
            ? args.insertBefore
            : typeof args.insert_before === "string"
              ? args.insert_before
              : undefined;

        const parsedStream =
          newAiceCode && !symbolSelector
            ? parseMultiBlockSpliceStream(newAiceCode, rawTargetFile || undefined)
            : null;

        const filesBatchFromArgs: BatchSpliceItem[] | undefined =
          Array.isArray(args.files) && args.files.length > 0
            ? (args.files as Array<Record<string, unknown>>).map((entry) => {
                const entryFp = String(entry.filePath ?? entry.file ?? entry.path ?? "");
                if (!entryFp) {
                  throw new Error("Each item in aice_splice 'files' array must specify 'filePath'");
                }
                const entryEdits = Array.isArray(entry.edits)
                  ? (entry.edits as Array<Record<string, unknown>>).map((ed) => ({
                      symbol: String(ed.symbol ?? ed.symbolSelector ?? ""),
                      code: typeof ed.code === "string" ? ed.code : undefined,
                      body: typeof ed.body === "string" ? ed.body : undefined,
                      delete: typeof ed.delete === "boolean" ? ed.delete : undefined,
                      insertAfter:
                        typeof ed.insertAfter === "string"
                          ? ed.insertAfter
                          : typeof ed.insert_after === "string"
                            ? ed.insert_after
                            : undefined,
                      insertBefore:
                        typeof ed.insertBefore === "string"
                          ? ed.insertBefore
                          : typeof ed.insert_before === "string"
                            ? ed.insert_before
                            : undefined,
                      preserveDocs:
                        typeof ed.preserveDocs === "boolean" ? ed.preserveDocs : undefined,
                    }))
                  : undefined;
                const itemSymbol =
                  typeof entry.symbol === "string"
                    ? entry.symbol
                    : typeof entry.symbolSelector === "string"
                      ? entry.symbolSelector
                      : undefined;
                const itemCode =
                  typeof entry.code === "string"
                    ? entry.code
                    : typeof entry.newAiceCode === "string"
                      ? entry.newAiceCode
                      : undefined;
                return {
                  filePath: entryFp,
                  ...(itemSymbol !== undefined ? { symbol: itemSymbol } : {}),
                  ...(itemCode !== undefined ? { code: itemCode } : {}),
                  ...(typeof entry.body === "string" ? { body: entry.body } : {}),
                  ...(typeof entry.delete === "boolean" ? { delete: entry.delete } : {}),
                  ...(typeof entry.insertAfter === "string"
                    ? { insertAfter: entry.insertAfter }
                    : {}),
                  ...(typeof entry.insertBefore === "string"
                    ? { insertBefore: entry.insertBefore }
                    : {}),
                  ...(typeof entry.preserveDocs === "boolean"
                    ? { preserveDocs: entry.preserveDocs }
                    : {}),
                  ...(entryEdits ? { edits: entryEdits } : {}),
                  ...(typeof entry.create === "boolean"
                    ? { create: entry.create }
                    : !itemSymbol && !entryEdits && itemCode !== undefined
                      ? { create: true }
                      : {}),
                };
              })
            : undefined;

        const multiFileEditsFromArgs: BatchSpliceItem[] | undefined =
          !rawTargetFile &&
          Array.isArray(args.edits) &&
          args.edits.length > 0 &&
          args.edits.every(
            (e) =>
              e &&
              typeof e === "object" &&
              Boolean(
                (e as Record<string, unknown>).filePath ||
                  (e as Record<string, unknown>).file ||
                  (e as Record<string, unknown>).path,
              ),
          )
            ? (args.edits as Array<Record<string, unknown>>).map((e) => ({
                filePath: String(e.filePath ?? e.file ?? e.path ?? ""),
                symbol: String(e.symbol ?? e.symbolSelector ?? ""),
                code: typeof e.code === "string" ? e.code : undefined,
                body: typeof e.body === "string" ? e.body : undefined,
                delete: Boolean(e.delete),
                ...(typeof e.insertAfter === "string" ? { insertAfter: e.insertAfter } : {}),
                ...(typeof e.insertBefore === "string" ? { insertBefore: e.insertBefore } : {}),
                ...(typeof e.preserveDocs === "boolean" ? { preserveDocs: e.preserveDocs } : {}),
              }))
            : undefined;

        const effectiveBatchItems =
          filesBatchFromArgs && filesBatchFromArgs.length > 0
            ? filesBatchFromArgs
            : parsedStream?.batchItems && parsedStream.batchItems.length > 0
              ? parsedStream.batchItems
              : multiFileEditsFromArgs;

        if (effectiveBatchItems && effectiveBatchItems.length > 0) {
          const firstRawFp = String(effectiveBatchItems[0]!.filePath ?? "");
          const firstSafeFp = this.resolveSafePath(firstRawFp);
          const projectRoot = this.resolveProjectRoot(firstSafeFp);
          const config = loadProjectConfig(projectRoot);
          if (!isProjectAiceEnabled(config)) {
            return {
              content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
              isError: true,
            };
          }
          const effectiveIdioms = isProjectIdiomsEnabled(
            config,
            typeof args.idioms === "boolean" ? args.idioms : undefined,
          );
          const safeBatchItems = effectiveBatchItems.map((item) => ({
            ...item,
            ...(preserveDocs !== undefined && item.preserveDocs === undefined
              ? { preserveDocs }
              : {}),
            filePath: this.resolveSafePath(String(item.filePath ?? "")),
            rawFilePath: String(item.filePath ?? ""),
          }));
          const batchRes = await withSuppressedTelemetryAsync(() =>
            spliceBatch(safeBatchItems, {
              dryRun,
              ...(preserveDocs !== undefined ? { preserveDocs } : {}),
              compile: !dryRun,
              idioms: effectiveIdioms,
              projectRoot,
            }),
          );
          const summaries: string[] = [];
          for (let idx = 0; idx < batchRes.results.length; idx++) {
            const res = batchRes.results[idx]!;
            const item = safeBatchItems[idx]!;
            const count = item.edits ? item.edits.length : 1;
            const respLine = dryRun
              ? `[Dry Run] Previewed splice of ${count} symbol(s) in ${item.rawFilePath} (${res.tokensSaved ?? 0} tokens saved).`
              : `Successfully spliced ${count} symbol(s) in ${item.rawFilePath} (${res.tokensSaved ?? 0} tokens saved).`;
            summaries.push(respLine);
            if (!dryRun) {
              const itemSnippet =
                item.code ??
                (item.edits ? item.edits.map((e) => e.code ?? e.body ?? "").join("\n") : "");
              recordTelemetryEvent({
                targetPath: item.filePath,
                projectRoot,
                operation: "splice",
                surface: "mcp",
                idiomsUsed: Boolean(effectiveIdioms && itemSnippet.includes("$")),
                nativeText: res.modifiedCode,
                aiceText: itemSnippet ? `${itemSnippet}\n${respLine}` : respLine,
              });
            }
          }
          return {
            content: [{ type: "text", text: summaries.join("\n") }],
          };
        }

        if (!rawTargetFile) {
          throw new Error(
            "Must provide 'filePath' or pass '=== <filePath>:<symbol> ===' / '=== <filePath> ===' stream blocks inside 'code' (or 'newAiceCode'), or pass 'files'.",
          );
        }

        const filePath = this.resolveSafePath(rawTargetFile);
        const projectRoot = this.resolveProjectRoot(filePath);
        const config = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(config)) {
          return {
            content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
            isError: true,
          };
        }
        const effectiveIdioms = isProjectIdiomsEnabled(
          config,
          typeof args.idioms === "boolean" ? args.idioms : undefined,
        );
        const batchEdits =
          parsedStream?.singleFileEdits && parsedStream.singleFileEdits.length > 0
            ? parsedStream.singleFileEdits
            : Array.isArray(args.edits)
              ? (args.edits as Array<Record<string, unknown>>).map((ed) => ({
                  symbol: String(ed.symbol ?? ed.symbolSelector ?? ""),
                  code: typeof ed.code === "string" ? ed.code : undefined,
                  body: typeof ed.body === "string" ? ed.body : undefined,
                  delete: typeof ed.delete === "boolean" ? ed.delete : undefined,
                  insertAfter:
                    typeof ed.insertAfter === "string"
                      ? ed.insertAfter
                      : typeof ed.insert_after === "string"
                        ? ed.insert_after
                        : undefined,
                  insertBefore:
                    typeof ed.insertBefore === "string"
                      ? ed.insertBefore
                      : typeof ed.insert_before === "string"
                        ? ed.insert_before
                        : undefined,
                  preserveDocs: typeof ed.preserveDocs === "boolean" ? ed.preserveDocs : undefined,
                }))
              : undefined;

        const result = await withSuppressedTelemetryAsync(() =>
          splice(filePath, {
            symbol: batchEdits ? undefined : symbolSelector || undefined,
            code: batchEdits ? undefined : newAiceCode,
            body: bodyCode,
            delete: deleteFlag,
            ...(insertAfter !== undefined ? { insertAfter } : {}),
            ...(insertBefore !== undefined ? { insertBefore } : {}),
            ...(preserveDocs !== undefined ? { preserveDocs } : {}),
            ...(typeof args.create === "boolean" ? { create: args.create } : {}),
            edits: batchEdits,
            dryRun,
            inPlace: !dryRun,
            diff: dryRun ? true : undefined,
            compile: !dryRun,
            idioms: effectiveIdioms,
            projectRoot,
          }),
        );

        const displaySym = result.symbol || symbolSelector || insertAfter || insertBefore || "*";
        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Splice failed for symbol '${displaySym}' in ${rawTargetFile}`,
              },
            ],
            isError: true,
          };
        }

        const respText = dryRun
          ? `[Dry Run] Previewed splice of symbol '${displaySym}' in ${rawTargetFile}.${result.diff ? `\n\nDiff:\n${result.diff}` : `\n\n${result.modifiedCode}`}`
          : `Successfully spliced symbol '${displaySym}' in ${rawTargetFile}.${result.diff ? `\n\nDiff:\n${result.diff}` : ""}`;
        if (!dryRun) {
          const snippetUsed =
            newAiceCode ??
            bodyCode ??
            (batchEdits ? batchEdits.map((e) => e.code ?? e.body ?? "").join("\n") : "");
          recordTelemetryEvent({
            targetPath: filePath,
            projectRoot,
            operation: "splice",
            surface: "mcp",
            idiomsUsed: Boolean(effectiveIdioms && snippetUsed.includes("$")),
            nativeText: result.modifiedCode,
            aiceText: `${snippetUsed}\n${respText}`,
          });
        }

        return {
          content: [
            {
              type: "text",
              text: respText,
            },
          ],
        };
      }
      case "aice_idioms": {
        const dir = this.resolveSafePath(String(args.dir ?? args.path ?? "."));
        const action = typeof args.action === "string" ? args.action : "list";
        const projectRoot = this.resolveProjectRoot(dir);
        const config = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(config)) {
          return {
            content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
            isError: true,
          };
        }

        if (action === "on" || action === "off") {
          const enabled = action === "on";
          setProjectIdiomsEnabled(projectRoot, enabled);
          return {
            content: [
              {
                type: "text",
                text: `Project idioms ${enabled ? "ENABLED (ON)" : "DISABLED (OFF)"} in ${projectRoot}.`,
              },
            ],
          };
        }

        const effectiveIdioms = isProjectIdiomsEnabled(
          config,
          typeof args.idioms === "boolean" ? args.idioms : undefined,
        );
        if (!effectiveIdioms && action !== "expand") {
          return {
            content: [
              {
                type: "text",
                text: "Project idioms are currently DISABLED (idiomsEnabled: false in aice.config.json).",
              },
            ],
          };
        }

        if (action === "read") {
          const idiomName = typeof args.name === "string" ? args.name : "";
          if (!idiomName) {
            throw new Error("Must provide 'name' argument for aice_idioms 'read' action");
          }
          const readRes = readProjectIdiom(projectRoot, idiomName);
          return {
            content: [{ type: "text", text: readRes.formattedReport }],
          };
        }

        if (action === "update") {
          const idiomName = typeof args.name === "string" ? args.name : "";
          const code = typeof args.code === "string" ? args.code : "";
          if (!idiomName || !code) {
            throw new Error(
              "Must provide 'name' and 'code' arguments for aice_idioms 'update' action",
            );
          }
          const updateRes = await withSuppressedTelemetryAsync(() =>
            updateProjectIdiom(projectRoot, idiomName, code, {
              dryRun: Boolean(args.dryRun),
              params: typeof args.params === "string" ? args.params : undefined,
            }),
          );
          const msg = `Updated idiom ${updateRes.idiom.name}: ${updateRes.updatedOccurrences} occurrence(s) across ${updateRes.modifiedFiles.length} file(s).`;
          const modContents = updateRes.modifiedFiles
            .map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : ""))
            .join("\n");
          recordTelemetryEvent({
            targetPath: updateRes.modifiedFiles[0] ?? projectRoot,
            projectRoot,
            operation: "idioms_update",
            surface: "mcp",
            idiomsUsed: true,
            nativeText: modContents || code,
            aiceText: `${code}\n${msg}`,
          });
          return {
            content: [
              {
                type: "text",
                text: msg,
              },
            ],
          };
        }

        if (action === "list") {
          const idiomsEnabled = isProjectIdiomsEnabled(config);
          if (!idiomsEnabled) {
            return {
              content: [
                {
                  type: "text",
                  text: "Project idioms are currently DISABLED (idiomsEnabled: false in aice.config.json).",
                },
              ],
            };
          }
          const idioms = config.idioms ?? {};
          const text =
            formatIdiomsMarkdownSection(idioms) || "No project idioms currently registered.";
          return { content: [{ type: "text", text }] };
        }

        if (action === "scan") {
          const scanned = withSuppressedTelemetry(() =>
            scanProjectIdioms(dir, {
              dryRun: Boolean(args.dryRun),
              minOccurrences: typeof args.minOccurrences === "number" ? args.minOccurrences : 2,
              minNetTokenSavings: typeof args.minSavings === "number" ? args.minSavings : 10,
            }),
          );
          const text =
            formatIdiomsMarkdownSection(scanned.idioms) || "No candidate idioms discovered.";
          return { content: [{ type: "text", text }] };
        }

        if (action === "apply") {
          const applied = withSuppressedTelemetry(() =>
            applyProjectIdiomsToDirectory(dir, {
              minOccurrences:
                typeof args.minOccurrences === "number" ? args.minOccurrences : undefined,
              minNetTokenSavings: typeof args.minSavings === "number" ? args.minSavings : undefined,
            }),
          );
          const msg = `Applied idioms: ${applied.totalCollapsedCalls} calls collapsed, saved ~${applied.totalNetTokenSavings} tokens across ${applied.modifiedFiles.length} files.`;
          const modContents = applied.modifiedFiles
            .map((fp) => (fs.existsSync(fp) ? fs.readFileSync(fp, "utf-8") : ""))
            .join("\n");
          recordTelemetryEvent({
            targetPath: projectRoot,
            projectRoot,
            filePath: "<directory>",
            operation: "idioms_apply",
            surface: "mcp",
            idiomsUsed: true,
            nativeText: modContents || msg,
            aiceText: msg,
          });
          return {
            content: [
              {
                type: "text",
                text: msg,
              },
            ],
          };
        }

        if (action === "expand") {
          const isDryRun = Boolean(args.dryRun);
          if (isDryRun) {
            const idiomsMap = config.idioms ?? {};
            let previewFiles = 0;
            let previewCalls = 0;
            const walkAice = (scanDir: string) => {
              if (!fs.existsSync(scanDir)) return;
              const st = fs.statSync(scanDir);
              if (st.isFile()) {
                if (scanDir.endsWith(".aice")) {
                  const src = fs.readFileSync(scanDir, "utf-8");
                  const res = expandAiceSourceIdioms(src, idiomsMap);
                  if (res.expandedCount > 0) {
                    previewFiles++;
                    previewCalls += res.expandedCount;
                  }
                }
                return;
              }
              for (const ent of fs.readdirSync(scanDir, { withFileTypes: true })) {
                if (
                  ent.name === "node_modules" ||
                  ent.name === ".git" ||
                  ent.name.startsWith(".")
                ) {
                  continue;
                }
                const full = path.join(scanDir, ent.name);
                if (ent.isDirectory()) walkAice(full);
                else if (ent.isFile() && ent.name.endsWith(".aice")) walkAice(full);
              }
            };
            walkAice(dir);
            return {
              content: [
                {
                  type: "text",
                  text: `[Dry Run] Previewed idiom expansion: ${previewCalls} calls across ${previewFiles} files.`,
                },
              ],
            };
          }

          const expanded = expandProjectIdiomsInDirectory(dir);
          if (config.idioms && Object.keys(config.idioms).length > 0) {
            saveProjectConfig(projectRoot, { idioms: {} });
          }
          const cacheFile = path.join(projectRoot, ".aice-cache", "idioms.json");
          if (fs.existsSync(cacheFile)) {
            try {
              fs.unlinkSync(cacheFile);
            } catch {
              // ignore
            }
          }
          return {
            content: [
              {
                type: "text",
                text: `Expanded idioms: ${expanded.expandedCalls} calls expanded across ${expanded.expandedFiles} files.`,
              },
            ],
          };
        }

        throw new Error(`Unknown idiom action: ${action}`);
      }

      case "aice_create": {
        const dryRun = Boolean(args.dryRun);
        const overwrite = typeof args.overwrite === "boolean" ? args.overwrite : undefined;
        const rawCodeCandidate = String(
          args.code ?? args.newAiceCode ?? args.aice ?? args.template ?? args.content ?? "",
        );
        const rawTargetFile = String(
          args.filePath ??
            args.path ??
            args.file ??
            args.fileOrDir ??
            args.target ??
            "",
        );
        const streamItems =
          !Array.isArray(args.files) && rawCodeCandidate
            ? parseMultiFileCreateStream(rawCodeCandidate)
            : null;
        if (!Array.isArray(args.files) && !streamItems && rawCodeCandidate) {
          const spliceStream = parseMultiBlockSpliceStream(
            rawCodeCandidate,
            rawTargetFile || undefined,
          );
          const effectiveBatchItems =
            spliceStream?.batchItems && spliceStream.batchItems.length > 0
              ? spliceStream.batchItems
              : spliceStream?.singleFileEdits &&
                  spliceStream.singleFileEdits.length > 0 &&
                  rawTargetFile
                ? [{ filePath: rawTargetFile, edits: spliceStream.singleFileEdits }]
                : undefined;
          if (effectiveBatchItems && effectiveBatchItems.length > 0) {
            const firstRawFp = String(effectiveBatchItems[0]!.filePath ?? "");
            const firstSafeFp = this.resolveSafePath(firstRawFp);
            const projectRoot = this.resolveProjectRoot(firstSafeFp);
            const config = loadProjectConfig(projectRoot);
            if (!isProjectAiceEnabled(config)) {
              return {
                content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
                isError: true,
              };
            }
            const effectiveIdioms = isProjectIdiomsEnabled(
              config,
              typeof args.idioms === "boolean" ? args.idioms : undefined,
            );
            const safeBatchItems = effectiveBatchItems.map((item) => ({
              ...item,
              filePath: this.resolveSafePath(String(item.filePath ?? "")),
            }));
            const batchRes = await withSuppressedTelemetryAsync(() =>
              spliceBatch(safeBatchItems, {
                dryRun,
                idioms: effectiveIdioms,
                projectRoot,
              }),
            );
            const totalSaved = batchRes.results.reduce((acc, r) => acc + (r.tokensSaved ?? 0), 0);
            const msg = `✔ Batch spliced ${batchRes.results.length} item(s) across ${batchRes.modifiedFiles.length} file(s) (${totalSaved} tokens saved)`;
            for (let idx = 0; idx < batchRes.results.length; idx++) {
              const res = batchRes.results[idx]!;
              const item = safeBatchItems[idx]!;
              const itemSnippet =
                item.code ??
                (item.edits ? item.edits.map((e) => e.code ?? e.body ?? "").join("\n") : "");
              recordTelemetryEvent({
                targetPath: item.filePath,
                projectRoot,
                operation: "splice",
                surface: "mcp",
                idiomsUsed: Boolean(effectiveIdioms && itemSnippet.includes("$")),
                nativeText: res.modifiedCode,
                aiceText: itemSnippet ? `${itemSnippet}\n${msg}` : msg,
              });
            }
            return {
              content: [
                {
                  type: "text",
                  text: msg,
                },
              ],
            };
          }
        }
        if (Array.isArray(args.files) || (streamItems && streamItems.length >= 1)) {
          if (streamItems && streamItems.length === 1 && rawTargetFile) {
            const firstEntry = streamItems[0]!;
            const entryFp = String(firstEntry.filePath ?? firstEntry.file ?? firstEntry.path ?? "");
            if (
              !entryFp ||
              (!entryFp.includes("/") && !entryFp.includes("\\")) ||
              path.basename(entryFp) === path.basename(rawTargetFile)
            ) {
              firstEntry.filePath = rawTargetFile;
            }
          }
          const rawFiles = Array.isArray(args.files)
            ? (args.files as Array<Record<string, unknown>>)
            : (streamItems as Array<Record<string, unknown>>);
          if (rawFiles.length === 0) {
            throw new Error("aice_create 'files' array must not be empty");
          }
          const safeItems: BatchCreateItem[] = [];
          let firstSafePath = this.workspaceRoot;
          for (const entry of rawFiles) {
            const rawFp = String(entry.filePath ?? entry.file ?? entry.path ?? "");
            if (!rawFp) {
              throw new Error("Each item in 'files' must specify 'filePath'");
            }
            const safeFp = this.resolveSafePath(rawFp);
            if (safeItems.length === 0) firstSafePath = path.dirname(safeFp);
            const itemCode = String(
              entry.code ?? entry.aice ?? entry.template ?? entry.content ?? "",
            );
            safeItems.push({
              filePath: safeFp,
              code: itemCode,
              ...(overwrite !== undefined ? { overwrite } : {}),
            });
          }
          const projectRoot = this.resolveProjectRoot(firstSafePath);
          const config = loadProjectConfig(projectRoot);
          if (!isProjectAiceEnabled(config)) {
            return {
              content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
              isError: true,
            };
          }
          const effectiveIdioms = isProjectIdiomsEnabled(
            config,
            typeof args.idioms === "boolean" ? args.idioms : undefined,
          );
          const inlineIdiomsArg = (args.inlineIdioms ??
            args.idiom ??
            (typeof args.idioms !== "boolean" ? args.idioms : undefined)) as
            | string
            | string[]
            | Record<string, string>
            | undefined;
          const batchRes = await createBatch(safeItems, {
            dryRun,
            idioms: effectiveIdioms,
            inlineIdioms: inlineIdiomsArg,
            projectRoot,
            surface: "mcp",
          });
          const msg = dryRun
            ? `[Dry Run] Previewed batch creation of ${batchRes.results.length} file(s) (${batchRes.totalAiceTokens} cl100k tokens${batchRes.totalTokensSaved > 0 ? `, saved: +${batchRes.totalTokensSaved}` : ""})`
            : batchRes.totalTokensSaved > 0
              ? `✔ Batch created ${batchRes.results.length} file(s) (${batchRes.totalAiceTokens} cl100k tokens, saved: +${batchRes.totalTokensSaved}${batchRes.results.length > 1 ? `, ${batchRes.results.length - 1} turn(s) saved` : ""})`
              : batchRes.results.length > 1
                ? `✔ Batch created ${batchRes.results.length} file(s) in 1 turn (${batchRes.totalAiceTokens} cl100k tokens, ${batchRes.results.length - 1} turn(s) saved)`
                : `✔ Created 1 file: ${batchRes.results[0]?.filePath ?? ""} (${batchRes.totalAiceTokens} cl100k tokens)`;
          return {
            content: [{ type: "text", text: msg }],
          };
        }

        if (!rawTargetFile) {
          throw new Error("Must provide 'filePath' or 'files' array for aice_create");
        }
        const safeFilePath = this.resolveSafePath(rawTargetFile);
        const projectRoot = this.resolveProjectRoot(path.dirname(safeFilePath));
        const config = loadProjectConfig(projectRoot);
        if (!isProjectAiceEnabled(config)) {
          return {
            content: [{ type: "text", text: AICE_DISABLED_MESSAGE }],
            isError: true,
          };
        }
        const effectiveIdioms = isProjectIdiomsEnabled(
          config,
          typeof args.idioms === "boolean" ? args.idioms : undefined,
        );
        const inlineIdiomsArg = (args.inlineIdioms ??
          args.idiom ??
          (typeof args.idioms !== "boolean" ? args.idioms : undefined)) as
          | string
          | string[]
          | Record<string, string>
          | undefined;
        const codeStr = rawCodeCandidate;
        const res = await createFile(safeFilePath, {
          code: codeStr,
          idioms: effectiveIdioms,
          inlineIdioms: inlineIdiomsArg,
          dryRun,
          ...(overwrite !== undefined ? { overwrite } : {}),
          projectRoot,
          surface: "mcp",
        });
        const respText = dryRun
          ? `[Dry Run] Previewed ${rawTargetFile} (${res.aiceTokens} cl100k tokens${res.tokensSaved > 0 ? `, saved: +${res.tokensSaved}` : ""})\n\n${res.nativeCode}`
          : `✔ Created ${rawTargetFile} (${res.aiceTokens} cl100k tokens${res.tokensSaved > 0 ? `, saved: +${res.tokensSaved}` : ""})`;
        return {
          content: [{ type: "text", text: respText }],
        };
      }

      case "aice_gain": {
        const project = typeof args.project === "string" ? args.project : undefined;
        const unique = Boolean(args.unique);
        const asJson = Boolean(args.json);
        const report = buildGainReport({ project, unique });
        const text = asJson
          ? JSON.stringify(report, null, 2)
          : report.projectDetail
            ? formatProjectGainDetail(report.projectDetail)
            : formatGlobalGainDashboard(report);
        return {
          content: [{ type: "text", text }],
        };
      }

      case "aice_project_config": {
        const scope = typeof args.scope === "string" ? args.scope.toLowerCase().trim() : "project";
        const action = typeof args.action === "string" ? args.action.toLowerCase() : undefined;

        if (scope === "global") {
          let safeHomeDir: string | undefined;
          if (typeof args.homeDir === "string" && args.homeDir.trim().length > 0) {
            const candidateHome = path.resolve(args.homeDir);
            if (this.isBlockedSystemPath(candidateHome)) {
              throw new Error(
                `Access denied: homeDir '${args.homeDir}' points to a blocked system directory`,
              );
            }
            safeHomeDir = candidateHome;
          }
          const agentFilter = typeof args.agent === "string" ? args.agent : undefined;
          const agentResult =
            action === "setup" || action === "enable"
              ? setupAgents({
                  homeDir: safeHomeDir,
                  agent: agentFilter,
                  all: Boolean(args.all),
                })
              : action === "remove" || action === "disable"
                ? removeAgents({
                    homeDir: safeHomeDir,
                    agent: agentFilter,
                  })
                : getAgentsStatus({
                    homeDir: safeHomeDir,
                    agent: agentFilter,
                  });
          return {
            content: [
              {
                type: "text",
                text: JSON.stringify({ scope: "global", ...agentResult }, null, 2),
              },
            ],
          };
        }

        const rawDir =
          (typeof args.dir === "string" && args.dir) ||
          (typeof args.path === "string" && args.path) ||
          (typeof args.fileOrDir === "string" && args.fileOrDir) ||
          (typeof args.filePath === "string" && args.filePath) ||
          (typeof args.projectRoot === "string" && args.projectRoot) ||
          (typeof args.root === "string" && args.root) ||
          this.workspaceRoot;
        const dir = this.resolveSafePath(rawDir);
        const projectRoot = this.resolveProjectRoot(dir);
        if (action === "enable") {
          setProjectAiceEnabled(projectRoot, true);
        } else if (action === "disable") {
          setProjectAiceEnabled(projectRoot, false);
        } else if (typeof args.enabled === "boolean") {
          setProjectAiceEnabled(projectRoot, args.enabled);
        }
        if (typeof args.idiomsEnabled === "boolean") {
          setProjectIdiomsEnabled(projectRoot, args.idiomsEnabled);
        }
        const updated = loadProjectConfig(projectRoot);
        const configFileExists = fs.existsSync(path.join(projectRoot, "aice.config.json"));
        const agentsMdPath = path.join(projectRoot, "AGENTS.md");
        const rulesVersion = extractMarkdownDirectiveVersion(agentsMdPath);
        const rulesUpToDate = !rulesVersion || rulesVersion === AICE_VERSION;
        const payload = {
          projectRoot,
          version: AICE_VERSION,
          configFileExists,
          enabled: isProjectAiceEnabled(updated),
          idiomsEnabled: isProjectIdiomsEnabled(updated),
          activeIdiomsCount: updated.idioms ? Object.keys(updated.idioms).length : 0,
          rulesVersion: rulesVersion ?? AICE_VERSION,
          rulesUpToDate,
          ...(!rulesUpToDate
            ? {
                updateRecommendation: `Run './install.sh -y' or 'aice agents setup' to refresh agent rules to v${AICE_VERSION}`,
              }
            : {}),
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }
      default:
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
    }
  }
}
