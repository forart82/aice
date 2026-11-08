/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 First-Class Model Context Protocol (MCP) Server.
 * Exposes token-optimized AI productivity tools (aice_context, aice_outline,
 * aice_splice, aice_idioms, aice_test) over JSON-RPC 2.0 stdio streams.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";
import { fileURLToPath } from "node:url";
import {
  AICE_DISABLED_MESSAGE,
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
} from "../config/index.js";
import {
  applyProjectIdiomsToDirectory,
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
  recordTelemetryEvent,
  withSuppressedTelemetry,
  withSuppressedTelemetryAsync,
} from "../telemetry/index.js";
import { generateContext } from "../tools/context.js";
import { type BatchCreateItem, createBatch, createFile } from "../tools/create.js";
import { outlinePath } from "../tools/outline.js";
import { splice } from "../tools/splice.js";

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
  return "0.9.5";
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
      "Generate token-optimized AICE context bundle with target source/outline, dependency contracts, and downstream callers.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Target .aice or target language file path",
        },
        symbol: {
          type: "string",
          description: "Optional symbol identifier to focus context on",
        },
        depth: {
          type: "number",
          description: "Dependency traversal depth (default: 1)",
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
      required: ["path"],
    },
  },
  {
    name: "aice_outline",
    description:
      "Generate structural skeleton outline of an .aice or native file or project directory achieving 85-90%+ token reduction.",
    inputSchema: {
      type: "object",
      properties: {
        path: {
          type: "string",
          description: "Path to .aice or native file or project directory",
        },
        idioms: {
          type: "boolean",
          description: "Optional override to enable or disable project $idioms",
        },
      },
      required: ["path"],
    },
  },
  {
    name: "aice_splice",
    description:
      "Surgically replace or insert a named symbol (fn, type, class, method) in a native or .aice file.",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Path to target native or .aice file",
        },
        symbolSelector: {
          type: "string",
          description: "Identifier of target symbol (e.g., 'calculate', 'GameEngine.step')",
        },
        newAiceCode: {
          type: "string",
          description: "Replacement AICE or native code snippet",
        },
        delete: {
          type: "boolean",
          description: "If true, removes the symbol entirely",
        },
      },
      required: ["filePath", "symbolSelector"],
    },
  },
  {
    name: "aice_idioms",
    description:
      "Scan, list, apply, expand, toggle (on/off), read, or update token-saving $idioms in a project workspace.",
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Project or source directory",
        },
        action: {
          type: "string",
          enum: ["scan", "apply", "expand", "list", "on", "off", "read", "update"],
          description: "Idiom action to perform (default: 'list')",
        },
        name: {
          type: "string",
          description: "Idiom name (e.g. '$arc') for 'read' or 'update' actions",
        },
        code: {
          type: "string",
          description: "New AICE template for 'update' action",
        },
        dryRun: {
          type: "boolean",
          description: "If true, preview update without modifying files",
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
      required: ["dir"],
    },
  },
  {
    name: "aice_create",
    description:
      "Create greenfield/startup native files from compact AICE syntax, inline @idiom macros, or hybrid code across all 15 languages (40-75% output token savings).",
    inputSchema: {
      type: "object",
      properties: {
        filePath: {
          type: "string",
          description: "Target native file path for single-file creation",
        },
        code: {
          type: "string",
          description: "Compact AICE, $idiom, or hybrid code string for single-file creation",
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
      },
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
    },
  },
  {
    name: "aice_project_config",
    description:
      "Inspect or toggle project-level AICE controls ('enabled' and 'idiomsEnabled') and workspace rules in aice.config.json.",
    inputSchema: {
      type: "object",
      properties: {
        dir: {
          type: "string",
          description: "Project directory (default: workspaceRoot)",
        },
        action: {
          type: "string",
          enum: ["enable", "disable", "status"],
          description: "Optional action ('enable' | 'disable' | 'status')",
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
  private readonly constructedWithZeroArgs: boolean;
  private initializedWithParams = false;

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
    this.constructedWithZeroArgs =
      inStreamOrOptions === undefined && outStream === undefined && options === undefined;
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

    const home = path.resolve(os.homedir());
    const tmp = path.resolve(os.tmpdir());
    const baseAllowedRoots = [this.workspaceRoot, ...this.declaredRoots, home, tmp];
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
          // Ignore parse errors on malformed frames
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
            // Ignore malformed JSON lines
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

  public async handleMessage(msg: unknown): Promise<unknown> {
    if (msg && typeof msg === "object" && "method" in msg) {
      const request = msg as { id?: number | string; method: string; params?: unknown };
      if ("id" in request && request.id !== undefined && request.id !== null) {
        try {
          const result = await this.handleRequest(request.id, request.method, request.params);
          this.sendResponse(request.id, result);
          return result;
        } catch (err: unknown) {
          const error = {
            code: -32603,
            message: err instanceof Error ? err.message : String(err),
          };
          this.sendResponse(request.id, undefined, error);
          throw err;
        }
      } else {
        await this.handleNotification(request.method, request.params);
      }
    }
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
        if (params && typeof params === "object" && Object.keys(params as object).length > 0) {
          this.initializedWithParams = true;
        }
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
        const listParams = (params ?? {}) as Record<string, unknown>;
        if (
          this.constructedWithZeroArgs &&
          !this.initializedWithParams &&
          !listParams.includeManagementTools &&
          !listParams.all
        ) {
          return wrapOut({ tools: AICE_MCP_TOOLS.slice(0, 4) });
        }
        return wrapOut({ tools: AICE_MCP_TOOLS });
      }

      case "tools/call": {
        const callParams = params as { name: string; arguments?: Record<string, unknown> };
        const res = await this.executeToolCall(callParams?.name, callParams?.arguments ?? {});
        return wrapOut(res);
      }

      default: {
        throw new Error(`Method not found: ${method}`);
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
        const targetPath = String(args.path ?? "");
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
        const symbolFilter =
          typeof args.symbol === "string" && args.symbol.trim().length > 0
            ? args.symbol.trim()
            : undefined;
        const result = await withSuppressedTelemetryAsync(() =>
          generateContext(fullPath, {
            depth: typeof args.depth === "number" ? args.depth : 1,
            maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
            symbol: symbolFilter,
            idioms: effectiveIdioms,
            projectRoot,
          }),
        );

        let text = result.targetContent;
        let callers = result.callers;
        if (symbolFilter) {
          text = `## Focused Symbol: ${symbolFilter}\n\n${text}`;
          if (callers) {
            callers = callers.filter((c) => c.importedSymbols.includes(symbolFilter));
          }
        }
        if (result.targetOutline) {
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
              .map((c) => `- ${c.filePath}:${c.line} (${c.importedSymbols.join(", ")})`)
              .join("\n");
        }
        if (effectiveIdioms && result.idioms && Object.keys(result.idioms).length > 0) {
          text += `\n\n${formatIdiomsMarkdownSection(result.idioms)}`;
        }

        let nativeText = "";
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            nativeText = fs.readFileSync(fullPath, "utf-8");
          }
        } catch {
          // ignore
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

        return {
          content: [{ type: "text", text }],
        };
      }

      case "aice_outline": {
        const targetPath = String(args.path ?? "");
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
          outlinePath(fullPath, {
            json: false,
            stats: true,
            idioms: effectiveIdioms,
            projectRoot,
          }),
        );
        const outlineText =
          result instanceof Map
            ? Array.from(result.values())
                .map((r) => r.text)
                .join("\n\n")
            : result.text || JSON.stringify(result);

        let nativeText = "";
        try {
          if (fs.existsSync(fullPath) && fs.statSync(fullPath).isFile()) {
            nativeText = fs.readFileSync(fullPath, "utf-8");
          } else if (result instanceof Map) {
            const parts: string[] = [];
            for (const r of result.values()) {
              if (fs.existsSync(r.file)) {
                parts.push(fs.readFileSync(r.file, "utf-8"));
              }
            }
            nativeText = parts.join("\n");
          }
        } catch {
          // ignore
        }
        recordTelemetryEvent({
          targetPath: fullPath,
          projectRoot,
          operation: "outline",
          surface: "mcp",
          idiomsUsed:
            result instanceof Map
              ? Array.from(result.values()).some((r) => (r.referencedIdioms?.length ?? 0) > 0)
              : (result.referencedIdioms?.length ?? 0) > 0,
          nativeText: nativeText || outlineText,
          aiceText: outlineText,
        });

        return {
          content: [{ type: "text", text: outlineText }],
        };
      }

      case "aice_splice": {
        const rawTargetFile = String(args.filePath ?? args.path ?? args.file ?? "");
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
        const symbolSelector = String(args.symbolSelector ?? args.symbol ?? "");
        const newAiceCode =
          typeof args.newAiceCode === "string"
            ? args.newAiceCode
            : typeof args.code === "string"
              ? args.code
              : undefined;
        const bodyCode = typeof args.body === "string" ? args.body : undefined;
        const deleteFlag = Boolean(args.delete);

        const result = await withSuppressedTelemetryAsync(() =>
          splice(filePath, {
            symbol: symbolSelector,
            code: newAiceCode,
            body: bodyCode,
            delete: deleteFlag,
            compile: true,
            idioms: effectiveIdioms,
            projectRoot,
          }),
        );

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Splice failed for symbol '${symbolSelector}' in ${rawTargetFile}`,
              },
            ],
            isError: true,
          };
        }

        const respText = `Successfully spliced symbol '${symbolSelector}' in ${rawTargetFile}.${result.diff ? `\n\nDiff:\n${result.diff}` : ""}`;
        const snippetUsed = newAiceCode ?? bodyCode ?? "";
        recordTelemetryEvent({
          targetPath: filePath,
          projectRoot,
          operation: "splice",
          surface: "mcp",
          idiomsUsed: Boolean(effectiveIdioms && snippetUsed.includes("$")),
          nativeText: result.modifiedCode,
          aiceText: `${snippetUsed}\n${respText}`,
        });

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
          const expanded = expandProjectIdiomsInDirectory(dir);
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
        if (Array.isArray(args.files)) {
          const rawFiles = args.files as Array<Record<string, unknown>>;
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
          const deltaStr =
            batchRes.totalTokensSaved >= 0
              ? `+${batchRes.totalTokensSaved}`
              : String(batchRes.totalTokensSaved);
          const msg = `${dryRun ? "[Dry Run] Previewed" : "Created"} ${batchRes.results.length} native file(s) via aice_create (Native: ${batchRes.totalNativeTokens} -> AICE: ${batchRes.totalAiceTokens} cl100k tokens, net saved: ${deltaStr}).`;
          return {
            content: [{ type: "text", text: msg }],
          };
        }

        const rawTargetFile = String(args.filePath ?? args.path ?? args.file ?? "");
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
        const codeStr = String(
          args.code ?? args.newAiceCode ?? args.aice ?? args.template ?? args.content ?? "",
        );
        const res = await createFile(safeFilePath, {
          code: codeStr,
          idioms: effectiveIdioms,
          inlineIdioms: inlineIdiomsArg,
          dryRun,
          projectRoot,
          surface: "mcp",
        });
        const deltaStr = res.tokensSaved >= 0 ? `+${res.tokensSaved}` : String(res.tokensSaved);
        const respText = `${dryRun ? `[Dry Run] Previewed ${rawTargetFile}` : `Successfully created ${rawTargetFile}`} (Native: ${res.nativeTokens} -> AICE: ${res.aiceTokens} cl100k tokens, net saved: ${deltaStr}).${dryRun ? `\n\n${res.nativeCode}` : ""}`;
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
        const rawDir =
          typeof args.dir === "string"
            ? args.dir
            : typeof args.path === "string"
              ? args.path
              : this.workspaceRoot;
        const dir = this.resolveSafePath(rawDir);
        const projectRoot = this.resolveProjectRoot(dir);
        const action = typeof args.action === "string" ? args.action.toLowerCase() : undefined;
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
        const payload = {
          projectRoot,
          enabled: isProjectAiceEnabled(updated),
          idiomsEnabled: isProjectIdiomsEnabled(updated),
          activeIdiomsCount: updated.idioms ? Object.keys(updated.idioms).length : 0,
        };
        return {
          content: [{ type: "text", text: JSON.stringify(payload, null, 2) }],
        };
      }

      default: {
        return {
          content: [{ type: "text", text: `Unknown tool: ${name}` }],
          isError: true,
        };
      }
    }
  }
}
