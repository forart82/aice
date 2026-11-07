/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 First-Class Model Context Protocol (MCP) Server.
 * Exposes token-optimized AI productivity tools (aice_context, aice_outline,
 * aice_splice, aice_idioms, aice_test) over JSON-RPC 2.0 stdio streams.
 */

import * as os from "node:os";
import * as path from "node:path";
import type { Readable, Writable } from "node:stream";
import {
  findProjectRoot,
  loadProjectConfig,
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
import { runSelfHealingCampaignSync } from "../evolve/index.js";
import { runAiceTests } from "../runner/index.js";
import { generateContext } from "../tools/context.js";
import { outlinePath } from "../tools/outline.js";
import { splice } from "../tools/splice.js";

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
    name: "aice_test",
    description:
      "Execute AICE test suite with symbol-mapped error diagnostics and automatic staleness recompilation.",
    inputSchema: {
      type: "object",
      properties: {
        target: {
          type: "string",
          description: "Test target file, glob pattern, or test suite name",
        },
        cwd: {
          type: "string",
          description: "Working directory for test execution",
        },
      },
    },
  },
  {
    name: "aice_evolve",
    description:
      "Run the AICE 5-Gate Differential Fuzzing & Autonomous Self-Healing Evolution Loop",
    inputSchema: {
      type: "object",
      properties: {
        cycles: {
          type: "number",
          description: "Number of fuzzing/healing cycles per restart (default: 10)",
        },
        restarts: {
          type: "number",
          description: "Number of campaign restarts across randomized seeds (default: 1)",
        },
        seed: {
          type: "number",
          description: "Base random seed for reproducible differential fuzzing (default: 1337)",
        },
        includeCorpus: {
          type: "boolean",
          description: "Whether to include real example corpus files in fuzzing (default: true)",
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

    if (this.inStream && typeof this.inStream.on === "function") {
      this.inStream.on("data", (chunk: Buffer) => this.handleData(chunk));
    }
  }

  private resolveSafePath(rawPath: string): string {
    const resolved = path.resolve(this.workspaceRoot, rawPath);
    const tmp = path.resolve(os.tmpdir());
    const inWorkspace =
      resolved === this.workspaceRoot || resolved.startsWith(this.workspaceRoot + path.sep);
    const inTmp = resolved === tmp || resolved.startsWith(tmp + path.sep);
    if (!inWorkspace && !inTmp) {
      throw new Error(`Access denied: path '${rawPath}' escapes workspace root`);
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
    _id: number | string,
    method: string,
    params: unknown,
  ): Promise<unknown> {
    switch (method) {
      case "initialize": {
        return {
          protocolVersion: "2024-11-05",
          capabilities: { tools: {} },
          serverInfo: { name: "aice-mcp", version: "0.8.1" },
        };
      }

      case "ping": {
        return {};
      }

      case "tools/list": {
        return { tools: AICE_MCP_TOOLS };
      }

      case "tools/call": {
        const callParams = params as { name: string; arguments?: Record<string, unknown> };
        return this.executeToolCall(callParams?.name, callParams?.arguments ?? {});
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

  public async executeToolCall(
    name: string,
    args: Record<string, unknown>,
  ): Promise<McpToolCallResult> {
    switch (name) {
      case "aice_context": {
        const targetPath = String(args.path ?? "");
        const fullPath = this.resolveSafePath(targetPath);
        const symbolFilter =
          typeof args.symbol === "string" && args.symbol.trim().length > 0
            ? args.symbol.trim()
            : undefined;
        const result = await generateContext(fullPath, {
          depth: typeof args.depth === "number" ? args.depth : 1,
          maxTokens: typeof args.maxTokens === "number" ? args.maxTokens : undefined,
          symbol: symbolFilter,
          idioms: typeof args.idioms === "boolean" ? args.idioms : undefined,
        });

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
        if (result.idioms && Object.keys(result.idioms).length > 0) {
          text += `\n\n${formatIdiomsMarkdownSection(result.idioms)}`;
        }

        return {
          content: [{ type: "text", text }],
        };
      }

      case "aice_outline": {
        const targetPath = String(args.path ?? "");
        const fullPath = this.resolveSafePath(targetPath);
        const result = await outlinePath(fullPath, {
          json: false,
          stats: true,
          idioms: typeof args.idioms === "boolean" ? args.idioms : undefined,
        });
        const outlineText =
          result instanceof Map
            ? Array.from(result.values())
                .map((r) => r.text)
                .join("\n\n")
            : result.text || JSON.stringify(result);
        return {
          content: [{ type: "text", text: outlineText }],
        };
      }

      case "aice_splice": {
        const filePath = this.resolveSafePath(String(args.filePath ?? ""));
        const symbolSelector = String(args.symbolSelector ?? "");
        const newAiceCode = typeof args.newAiceCode === "string" ? args.newAiceCode : "";
        const deleteFlag = Boolean(args.delete);

        const result = await splice(filePath, {
          symbol: symbolSelector,
          code: newAiceCode,
          delete: deleteFlag,
          compile: true,
        });

        if (!result.success) {
          return {
            content: [
              {
                type: "text",
                text: `Splice failed for symbol '${symbolSelector}' in ${String(args.filePath)}`,
              },
            ],
            isError: true,
          };
        }

        return {
          content: [
            {
              type: "text",
              text: `Successfully spliced symbol '${symbolSelector}' in ${String(args.filePath)}.${result.diff ? `\n\nDiff:\n${result.diff}` : ""}`,
            },
          ],
        };
      }

      case "aice_idioms": {
        const dir = this.resolveSafePath(String(args.dir ?? "."));
        const action = typeof args.action === "string" ? args.action : "list";
        const projectRoot = findProjectRoot(dir);
        const config = loadProjectConfig(projectRoot);

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
            throw new Error("Must provide 'name' and 'code' arguments for aice_idioms 'update' action");
          }
          const updateRes = await updateProjectIdiom(projectRoot, idiomName, code, {
            dryRun: Boolean(args.dryRun),
            params: typeof args.params === "string" ? args.params : undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: `Updated idiom ${updateRes.idiom.name}: ${updateRes.updatedOccurrences} occurrence(s) across ${updateRes.modifiedFiles.length} file(s).`,
              },
            ],
          };
        }

        if (action === "list") {
          const idioms = config.idioms ?? {};
          const text =
            formatIdiomsMarkdownSection(idioms) || "No project idioms currently registered.";
          return { content: [{ type: "text", text }] };
        }

        if (action === "scan") {
          const scanned = scanProjectIdioms(dir, {
            dryRun: Boolean(args.dryRun),
            minOccurrences:
              typeof args.minOccurrences === "number" ? args.minOccurrences : 2,
            minNetTokenSavings:
              typeof args.minSavings === "number" ? args.minSavings : 10,
          });
          const text =
            formatIdiomsMarkdownSection(scanned.idioms) || "No candidate idioms discovered.";
          return { content: [{ type: "text", text }] };
        }

        if (action === "apply") {
          const applied = applyProjectIdiomsToDirectory(dir, {
            minOccurrences:
              typeof args.minOccurrences === "number" ? args.minOccurrences : undefined,
            minNetTokenSavings: typeof args.minSavings === "number" ? args.minSavings : undefined,
          });
          return {
            content: [
              {
                type: "text",
                text: `Applied idioms: ${applied.totalCollapsedCalls} calls collapsed, saved ~${applied.totalNetTokenSavings} tokens across ${applied.modifiedFiles.length} files.`,
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

      case "aice_test": {
        const target = typeof args.target === "string" ? args.target : undefined;
        if (target && target.startsWith("-")) {
          throw new Error("Invalid test target: must not start with '-'");
        }
        const resolvedTarget = target ? this.resolveSafePath(target) : undefined;
        const cwd = typeof args.cwd === "string" ? this.resolveSafePath(args.cwd) : undefined;
        const res = await runAiceTests(resolvedTarget, { cwd });
        return {
          content: [
            {
              type: "text",
              text:
                res.output ||
                (res.success
                  ? `All tests passed (${res.summary.passed}/${res.summary.total})`
                  : `Tests failed (${res.summary.failed}/${res.summary.total})`),
            },
          ],
          isError: !res.success,
        };
      }

      case "aice_evolve": {
        const report = runSelfHealingCampaignSync({
          restarts: typeof args.restarts === "number" ? args.restarts : 1,
          cyclesPerRestart: typeof args.cycles === "number" ? args.cycles : 10,
          baseSeed: typeof args.seed === "number" ? args.seed : 1337,
          includeCorpus: typeof args.includeCorpus === "boolean" ? args.includeCorpus : true,
        });

        return {
          content: [
            {
              type: "text",
              text: JSON.stringify(report, null, 2),
            },
          ],
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
