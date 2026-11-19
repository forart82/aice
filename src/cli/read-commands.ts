/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import { DEFAULT_CLI_READ_MAX_BYTES } from "../tools/read.js";
import {
  acquireSharedCliReadBudget,
  commitSharedCliReadBytes,
  detectCliShellInvocation,
} from "../utils/cli-pipe-budget.js";
import { getActiveCliArgs, recordCliFailureTelemetry } from "./telemetry-and-flags.js";
export function registerReadCommands(program: Command): void {
  // Command: read [targets...] (aliases: context, ctx)
  program
    .command("read")
    .aliases(["context", "ctx"])
    .description(
      "Unified Read Engine: Dependency contract packager, 1-turn numbered native source, dynamic byte/AST-snapped slices, symbol/test/heading extraction, search & zero-AST file discovery across 33 extensions",
    )
    .argument(
      "[targets...]",
      "Path(s) to target file(s) or directories with optional inline :symbol, :Lstart-Lend, or :outline selectors (defaults to '.' when --search or --files is passed)",
    )
    .option("--outline", "Force structural skeleton outline (85-90% token reduction)")
    .option("--outline-target", "Outline target instead of full source inside context bundle")
    .option("--full", "Bypass dynamic auto-outline ceiling and emit full source context")
    .option(
      "-d, --depth <number>",
      "Dependency traversal depth or maximum symbol nesting depth",
      (val) => Number.parseInt(val, 10),
    )
    .option(
      "-s, --symbol <symbol>",
      "Selector: Class.method, test ID (TC-MENU-001), Markdown heading, line range (L180-L240), regex (/pattern/), or outline",
    )
    .option(
      "--search <pattern>",
      "Search file(s) or directory by plain regex or literal pattern (without /.../ wrappers)",
    )
    .option(
      "-C, --context <lines>",
      "Context radius (lines before and after each search match)",
      (val) => Number.parseInt(val, 10),
    )
    .option("--files", "Fast zero-AST workspace file discovery (<relPath> (<lines>L))")
    .option(
      "--dsl",
      "Opt into AICE shorthand decompilation (default emits 1-based disk-numbered native source)",
    )
    .option(
      "--compact",
      "Compact token-bounded directory outline mode (auto-enabled for 60+ files)",
    )
    .option("--no-compact", "Disable compact directory outline mode")
    .option("--no-types", "Exclude type annotations when outlining")
    .option("--idioms", "Force-enable project idioms")
    .option("--no-idioms", "Temporarily disable project idioms")
    .option("--deps", "Force dependency contract resolution even on fast-path slices/files")
    .option("--no-deps", "Skip dependency contract resolution")
    .option("--callers", "Force reverse caller lookup")
    .option("--no-callers", "Skip reverse caller lookup")
    .option("--max-tokens <number>", "Maximum token limit", (rawMax) => Number.parseInt(rawMax, 10))
    .option("--json", "Output structured JSON bundle")
    .option("--stats", "Output token reduction and context statistics")
    .addHelpText(
      "after",
      `
Examples:
  • 1-turn numbered native bare files or directory outlines:
      aice read src tests
      aice read src/app.ts
  • Multi-target symbol & line-range stream in 1 call:
      aice read src/app.ts:GameApp.init src/utils.ts:L20-L60
  • Opt-in AICE shorthand decompilation:
      aice read src/app.ts --dsl
  • Search workspace or directory with AST/context windows (or use 'aice search'):
      aice read src --search "OracleIncoherenceAuditor" -C 8
  • Fast zero-AST file discovery (or use 'aice find'):
      aice read --files
`,
    )
    .action(
      async (
        targetPaths: string[] | undefined,
        options: {
          outline?: boolean;
          outlineTarget?: boolean;
          full?: boolean;
          depth?: number;
          symbol?: string;
          search?: string;
          context?: number;
          files?: boolean;
          dsl?: boolean;
          compact?: boolean;
          types?: boolean;
          idioms?: boolean;
          deps?: boolean;
          callers?: boolean;
          maxTokens?: number;
          json?: boolean;
          stats?: boolean;
        },
      ) => {
        const effectiveTargets =
          targetPaths && targetPaths.length > 0
            ? targetPaths
            : options.search !== undefined || options.files
              ? ["."]
              : undefined;
        try {
          const shellInv = detectCliShellInvocation();
          const unboundedCli = Boolean(options.full && shellInv.isInteractiveHuman);
          const { aiceRead } = await import("../tools/read.js");
          const parsedContextLines =
            options.context !== undefined && Number.isFinite(Number(options.context))
              ? Math.max(0, Number(options.context))
              : undefined;
          const invokedSubcmd =
            getActiveCliArgs()
              .find((arg) => !arg.startsWith("-"))
              ?.toLowerCase() ?? "read";
          const isMultiTargetContextAlias =
            (invokedSubcmd === "context" || invokedSubcmd === "ctx") &&
            (effectiveTargets?.length ?? 0) > 1;
          const effectiveCliIncludeDeps =
            options.deps ?? (isMultiTargetContextAlias ? true : undefined);
          const effectiveCliIncludeCallers =
            options.callers ?? (isMultiTargetContextAlias ? true : undefined);

          if (!options.json && options.maxTokens === undefined && !unboundedCli) {
            const budgetLease = acquireSharedCliReadBudget(
              shellInv.key,
              DEFAULT_CLI_READ_MAX_BYTES,
            );
            if (budgetLease.exhausted) {
              if (budgetLease.emitDeferralNotice) {
                const rerunRaw = `aice read ${effectiveTargets && effectiveTargets.length > 0 ? effectiveTargets.join(" ") : "."}`;
                const rerunCmd = rerunRaw.length > 96 ? `${rerunRaw.slice(0, 93)}...` : rerunRaw;
                const line = `// [9 KB CLI stdout budget already filled by prior chained command — run separately: ${rerunCmd}]`;
                console.log(line);
                commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(line, "utf-8") + 1);
              }
              return;
            }
            const res = await aiceRead(effectiveTargets, {
              outline: options.outline,
              outlineTarget: options.outlineTarget,
              full: options.full,
              depth: options.depth !== undefined ? Number(options.depth) : undefined,
              symbol: options.symbol,
              search: options.search,
              contextLines: parsedContextLines,
              filesOnly: options.files ? true : undefined,
              dsl: options.dsl ? true : undefined,
              rawNative: !options.dsl,
              compact: options.compact,
              includeTypes: options.types !== false,
              idioms: options.idioms,
              includeDeps: effectiveCliIncludeDeps,
              includeCallers: effectiveCliIncludeCallers,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              maxBytes: budgetLease.maxBytes,
              unboundedCli,
              json: !!options.json,
              stats: !!options.stats,
              surface: "cli",
            });
            console.log(res.output);
            commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(res.output, "utf-8") + 1);
          } else {
            const res = await aiceRead(effectiveTargets, {
              outline: options.outline,
              outlineTarget: options.outlineTarget,
              full: options.full,
              depth: options.depth !== undefined ? Number(options.depth) : undefined,
              symbol: options.symbol,
              search: options.search,
              contextLines: parsedContextLines,
              filesOnly: options.files ? true : undefined,
              dsl: options.dsl ? true : undefined,
              rawNative: !options.dsl,
              compact: options.compact,
              includeTypes: options.types !== false,
              idioms: options.idioms,
              includeDeps: effectiveCliIncludeDeps,
              includeCallers: effectiveCliIncludeCallers,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              unboundedCli,
              json: !!options.json,
              stats: !!options.stats,
              surface: "cli",
            });
            console.log(res.output);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          recordCliFailureTelemetry(msg, "context", effectiveTargets?.[0]);
          console.error(
            `❌ Error packaging context for ${effectiveTargets && effectiveTargets.length > 0 ? effectiveTargets.join(", ") : "."}: ${msg}`,
          );
          process.exit(1);
        }
      },
    );

  // Command: search [pattern] [targets...] (alias: grep)
  program
    .command("search")
    .alias("grep")
    .description(
      "AST-aware workspace/file search (rg-style pattern-first alias routing into Unified Read Engine)",
    )
    .argument("[pattern]", "Plain regex or literal search pattern (without /.../ wrappers)")
    .argument("[targets...]", "Optional file(s) or directory path(s) to search (default: '.')")
    .option("-C, --context <lines>", "Context radius (lines before and after each match)", (val) =>
      Number.parseInt(val, 10),
    )
    .option("-n, --line-number", "Emit 1-based line numbers (enabled by default)")
    .option("-s, --symbol <selector>", "Optional symbol scope or search pattern alias")
    .option("--search <pattern>", "Optional search pattern alias")
    .option("-l, --files-with-matches", "Emit only matching relative file paths concisely")
    .option("--full", "Bypass default stdout ceiling and emit full search context")
    .option("--json", "Output structured JSON bundle")
    .option("--max-tokens <number>", "Maximum token limit", (rawMax) => Number.parseInt(rawMax, 10))
    .action(
      async (
        patternArg: string | undefined,
        targetPaths: string[] | undefined,
        options: {
          context?: number;
          lineNumber?: boolean;
          symbol?: string;
          search?: string;
          filesWithMatches?: boolean;
          full?: boolean;
          json?: boolean;
          maxTokens?: number;
        },
      ) => {
        let shiftedTargets = targetPaths ? [...targetPaths] : [];
        let rawPositionalPattern = patternArg;
        if (
          rawPositionalPattern &&
          (options.symbol !== undefined || options.search !== undefined) &&
          shiftedTargets.length === 0 &&
          fs.existsSync(path.resolve(process.cwd(), rawPositionalPattern))
        ) {
          shiftedTargets = [rawPositionalPattern];
          rawPositionalPattern = undefined;
        }

        let effectivePattern = rawPositionalPattern ?? options.search;
        let effectiveSymbol: string | undefined;
        if (!effectivePattern && options.symbol) {
          const trimmedSym = options.symbol.trim();
          const slashMatch = trimmedSym.match(/^\/(.*)\/[gimsuy]*$/);
          effectivePattern = slashMatch ? slashMatch[1] : trimmedSym;
        } else if (effectivePattern && options.symbol) {
          const trimmedSym = options.symbol.trim();
          const slashMatch = trimmedSym.match(/^\/(.*)\/[gimsuy]*$/);
          if (slashMatch) {
            const inner = slashMatch[1]!;
            if (/^[A-Za-z_$][\w$.]*$/.test(inner)) {
              effectiveSymbol = inner;
            } else if (inner && inner !== effectivePattern) {
              effectivePattern = `(?:${effectivePattern})|(?:${inner})`;
            }
          } else {
            effectiveSymbol = trimmedSym;
          }
        }

        if (!effectivePattern) {
          const errMsg = "Error: Missing required <pattern> argument for 'aice search'.";
          recordCliFailureTelemetry(errMsg, "context");
          console.error(`❌ ${errMsg}`);
          process.exit(1);
        }

        const effectiveTargets = shiftedTargets.length > 0 ? shiftedTargets : ["."];
        try {
          const shellInv = detectCliShellInvocation();
          const unboundedCli = Boolean(options.full && shellInv.isInteractiveHuman);
          const { aiceRead } = await import("../tools/read.js");
          const parsedContextLines =
            options.context !== undefined && Number.isFinite(Number(options.context))
              ? Math.max(0, Number(options.context))
              : undefined;

          if (!options.json && options.maxTokens === undefined && !unboundedCli) {
            const budgetLease = acquireSharedCliReadBudget(
              shellInv.key,
              DEFAULT_CLI_READ_MAX_BYTES,
            );
            if (budgetLease.exhausted) {
              if (budgetLease.emitDeferralNotice) {
                const rerunRaw =
                  `aice search "${effectivePattern}" ${effectiveTargets.join(" ")}`.trim();
                const rerunCmd = rerunRaw.length > 96 ? `${rerunRaw.slice(0, 93)}...` : rerunRaw;
                const line = `// [9 KB CLI stdout budget already filled by prior chained command — run separately: ${rerunCmd}]`;
                console.log(line);
                commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(line, "utf-8") + 1);
              }
              return;
            }
            const res = await aiceRead(effectiveTargets, {
              search: effectivePattern,
              ...(effectiveSymbol ? { symbol: effectiveSymbol } : {}),
              contextLines: parsedContextLines,
              filesWithMatches: options.filesWithMatches ? true : undefined,
              full: options.full,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              maxBytes: budgetLease.maxBytes,
              unboundedCli,
              json: !!options.json,
              rawNative: true,
              surface: "cli",
            });
            console.log(res.output);
            commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(res.output, "utf-8") + 1);
          } else {
            const res = await aiceRead(effectiveTargets, {
              search: effectivePattern,
              ...(effectiveSymbol ? { symbol: effectiveSymbol } : {}),
              contextLines: parsedContextLines,
              filesWithMatches: options.filesWithMatches ? true : undefined,
              full: options.full,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              unboundedCli,
              json: !!options.json,
              rawNative: true,
              surface: "cli",
            });
            console.log(res.output);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          recordCliFailureTelemetry(msg, "context", effectiveTargets[0]);
          console.error(`❌ Error searching ${effectiveTargets.join(", ")}: ${msg}`);
          process.exit(1);
        }
      },
    );

  // Command: find [pattern] [targets...] (alias: tree)
  program
    .command("find")
    .alias("tree")
    .description(
      "Fast zero-AST workspace file discovery (<relPath> (<lines>L)) routing into Unified Read Engine",
    )
    .argument("[pattern]", "Optional glob/substring file filter or target directory/file path")
    .argument("[targets...]", "Optional directory or file path(s) to scan (default: '.')")
    .option("-d, --depth <number>", "Maximum directory traversal depth", (val) =>
      Number.parseInt(val, 10),
    )
    .option("--max-depth <number>", "Alias for --depth", (val) => Number.parseInt(val, 10))
    .option("-L <number>", "Tree-style depth alias for --depth", (val) => Number.parseInt(val, 10))
    .option("--search <pattern>", "Filter discovered file paths by substring, glob, or regex")
    .option("--full", "Bypass default stdout ceiling and emit full file tree")
    .option("--json", "Output structured JSON bundle")
    .option("--max-tokens <number>", "Maximum token limit", (rawMax) => Number.parseInt(rawMax, 10))
    .action(
      async (
        pattern: string | undefined,
        targetPaths: string[] | undefined,
        options: {
          depth?: number;
          maxDepth?: number;
          L?: number;
          search?: string;
          full?: boolean;
          json?: boolean;
          maxTokens?: number;
        },
      ) => {
        const restTargets = targetPaths ?? [];
        let effectiveTargets: string[];
        let filePattern: string | undefined;
        if (pattern === undefined || pattern.length === 0) {
          effectiveTargets = restTargets.length > 0 ? restTargets : ["."];
        } else {
          const hasGlobChars = /[*?[{]/.test(pattern);
          const candidateDiskPath = path.resolve(process.cwd(), pattern);
          if (!hasGlobChars && fs.existsSync(candidateDiskPath)) {
            effectiveTargets = [pattern, ...restTargets];
          } else {
            filePattern = pattern;
            effectiveTargets = restTargets.length > 0 ? restTargets : ["."];
          }
        }
        const rawDepth = options.depth ?? options.maxDepth ?? options.L;
        const parsedDepth =
          rawDepth !== undefined && Number.isFinite(Number(rawDepth))
            ? Math.max(1, Math.floor(Number(rawDepth)))
            : undefined;

        let effectiveSearch = options.search?.trim();
        if (effectiveSearch && effectiveSearch.includes("|") && !effectiveSearch.startsWith("{")) {
          const branches = effectiveSearch
            .split("|")
            .map((part) => part.trim().replace(/^\^+|\$+$/g, ""))
            .filter(Boolean)
            .map((part) => (part.includes("*") ? part : `*${part}*`));
          if (branches.length > 1) {
            effectiveSearch = `{${branches.join(",")}}`;
          } else if (branches.length === 1) {
            effectiveSearch = branches[0];
          }
        }
        try {
          const shellInv = detectCliShellInvocation();
          const unboundedCli = Boolean(options.full && shellInv.isInteractiveHuman);
          const { aiceRead } = await import("../tools/read.js");
          const depthSpread =
            parsedDepth !== undefined
              ? ({ depth: parsedDepth, maxDepth: parsedDepth } as Record<string, unknown>)
              : {};

          if (!options.json && options.maxTokens === undefined && !unboundedCli) {
            const budgetLease = acquireSharedCliReadBudget(
              shellInv.key,
              DEFAULT_CLI_READ_MAX_BYTES,
            );
            if (budgetLease.exhausted) {
              if (budgetLease.emitDeferralNotice) {
                const rerunRaw =
                  `aice find${filePattern ? ` "${filePattern}"` : ""} ${effectiveTargets.join(" ")}`.trim();
                const rerunCmd = rerunRaw.length > 96 ? `${rerunRaw.slice(0, 93)}...` : rerunRaw;
                const line = `// [9 KB CLI stdout budget already filled by prior chained command — run separately: ${rerunCmd}]`;
                console.log(line);
                commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(line, "utf-8") + 1);
              }
              return;
            }
            const res = await aiceRead(effectiveTargets, {
              filesOnly: true,
              ...(filePattern !== undefined ? { filePattern } : {}),
              ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
              ...depthSpread,
              full: options.full,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              maxBytes: budgetLease.maxBytes,
              unboundedCli,
              json: !!options.json,
              surface: "cli",
            });
            console.log(res.output);
            commitSharedCliReadBytes(shellInv.key, Buffer.byteLength(res.output, "utf-8") + 1);
          } else {
            const res = await aiceRead(effectiveTargets, {
              filesOnly: true,
              ...(filePattern !== undefined ? { filePattern } : {}),
              ...(effectiveSearch !== undefined ? { search: effectiveSearch } : {}),
              ...depthSpread,
              full: options.full,
              maxTokens: options.maxTokens !== undefined ? Number(options.maxTokens) : undefined,
              unboundedCli,
              json: !!options.json,
              surface: "cli",
            });
            console.log(res.output);
          }
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : String(err);
          recordCliFailureTelemetry(msg, "context", effectiveTargets[0]);
          console.error(`❌ Error finding files in ${effectiveTargets.join(", ")}: ${msg}`);
          process.exit(1);
        }
      },
    );
}
