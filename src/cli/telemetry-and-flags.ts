/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import * as fs from "node:fs";
import * as path from "node:path";
import type { Command } from "commander";
import {
  type AiceProjectConfig,
  findProjectRoot,
  isSameOrDescendant,
  loadProjectConfig,
  resolvePathTargets,
} from "../config/index.js";
import {
  recordTelemetryError,
  recordTelemetryEvent,
  type TelemetryOperation,
} from "../telemetry/index.js";

let activeCliArgs: string[] = process.argv.slice(2);
let cliFailureRecordedForInvocation = false;

function inferCliTelemetryOperation(rawArgs: ReadonlyArray<string>): TelemetryOperation {
  for (const token of rawArgs) {
    if (!token || token.startsWith("-")) continue;
    const sub = token.toLowerCase();
    if (sub === "splice" || sub === "write") return "splice";
    if (sub === "create") return "create";
    if (sub === "patch") return "patch";
    if (sub === "outline") return "outline";
    if (sub === "decompile") return "decompile";
    if (sub === "idioms") return "idioms_apply";
    if (
      sub === "read" ||
      sub === "context" ||
      sub === "ctx" ||
      sub === "search" ||
      sub === "grep" ||
      sub === "find" ||
      sub === "tree"
    ) {
      return "context";
    }
    break;
  }
  return "context";
}

export function recordCliFailureTelemetry(
  errorMessage: string,
  explicitOperation?: TelemetryOperation,
  explicitTargetPath?: string,
  wastedPayloadOrTokens?: string | number,
): void {
  if (cliFailureRecordedForInvocation) return;
  cliFailureRecordedForInvocation = true;
  const invokedCmd = `aice ${activeCliArgs.join(" ")}`.trim();
  const cleanError = errorMessage.trim();
  const op = explicitOperation ?? inferCliTelemetryOperation(activeCliArgs);
  const trimmedTarget = explicitTargetPath?.trim();
  const colonIdx =
    trimmedTarget && trimmedTarget !== "-"
      ? trimmedTarget.indexOf(":", /^[A-Za-z]:[\\/]/.test(trimmedTarget) ? 2 : 0)
      : -1;
  const cleanedTarget =
    trimmedTarget && trimmedTarget !== "-"
      ? colonIdx > 0
        ? trimmedTarget.slice(0, colonIdx)
        : trimmedTarget
      : undefined;
  const resolvedTarget = cleanedTarget ? path.resolve(process.cwd(), cleanedTarget) : process.cwd();
  const wastedPayload =
    typeof wastedPayloadOrTokens === "string" && wastedPayloadOrTokens.trim().length > 0
      ? wastedPayloadOrTokens
      : undefined;
  const explicitWastedTokens =
    typeof wastedPayloadOrTokens === "number" &&
    Number.isFinite(wastedPayloadOrTokens) &&
    wastedPayloadOrTokens > 0
      ? Math.floor(wastedPayloadOrTokens)
      : wastedPayload
        ? Math.max(1, Math.ceil(Buffer.byteLength(wastedPayload, "utf-8") / 3.5))
        : undefined;
  const composedAiceText = [invokedCmd, wastedPayload, cleanError].filter(Boolean).join("\n");
  recordTelemetryEvent({
    targetPath: resolvedTarget,
    filePath: "<cli-error>",
    operation: op,
    surface: "cli",
    nativeText: "",
    aiceText: composedAiceText || invokedCmd,
    ...(typeof wastedPayloadOrTokens === "number" && explicitWastedTokens !== undefined
      ? { aiceCl100k: explicitWastedTokens, aiceO200k: explicitWastedTokens }
      : {}),
  });
  recordTelemetryError({
    targetPath: cleanedTarget ? resolvedTarget : undefined,
    operation: op,
    surface: "cli",
    errorMessage: cleanError || invokedCmd,
    ...(explicitWastedTokens !== undefined
      ? ({ wastedInputTokens: explicitWastedTokens } as Record<string, unknown>)
      : {}),
  });
}

export function hasRecordedCliFailure(): boolean {
  return cliFailureRecordedForInvocation;
}

export function getActiveCliArgs(): ReadonlyArray<string> {
  return activeCliArgs;
}

export function normalizeCliContextFlag(
  rawArgv: readonly string[],
  parseOpts?: { from: "node" | "electron" | "user" },
): string[] {
  const prefixCount = parseOpts?.from === "user" ? 0 : 2;
  const prefix = rawArgv.slice(0, prefixCount);
  const args = rawArgv.slice(prefixCount);

  let subcmd: string | undefined;
  for (const arg of args) {
    if (arg === "--") break;
    if (!arg.startsWith("-")) {
      subcmd = arg.toLowerCase();
      break;
    }
  }

  const normalizable = new Set(["search", "grep", "read", "context", "ctx", "find", "tree"]);
  if (!subcmd || !normalizable.has(subcmd)) {
    return Array.from(rawArgv);
  }

  const isReadFamily = subcmd === "read" || subcmd === "context" || subcmd === "ctx";
  const isSearchFamily = subcmd === "search" || subcmd === "grep";
  const isFindFamily = subcmd === "find" || subcmd === "tree";

  const normalized: string[] = [];
  let i = 0;
  let pastDoubleDash = false;
  while (i < args.length) {
    const token = args[i];
    if (token === "--") {
      pastDoubleDash = true;
      normalized.push(token);
      i++;
      continue;
    }
    if (!pastDoubleDash) {
      // 1. Omit false/no-files tokens completely
      if (
        token === "--files-only=false" ||
        token === "--filesOnly=false" ||
        token === "--files=false" ||
        token === "--no-files" ||
        token === "--no-files-only"
      ) {
        i++;
        continue;
      }

      // 2. --files-only / --filesOnly / --files-only=true / --filesOnly=true / --files=true / --filesWithMatches
      if (
        token === "--files-only" ||
        token === "--filesOnly" ||
        token === "--files-only=true" ||
        token === "--filesOnly=true" ||
        token === "--files=true" ||
        token === "--filesWithMatches"
      ) {
        if (isReadFamily) {
          normalized.push("--files");
        } else if (isSearchFamily) {
          normalized.push("--files-with-matches");
        }
        // Omit on find/tree (already implicit)
        i++;
        continue;
      }

      if (token === "--outlineTarget") {
        if (isReadFamily) {
          normalized.push("--outline-target");
        }
        i++;
        continue;
      }

      // 3. Context lines
      const ctxDigitsMatch = token.match(/^--(?:context-lines|contextLines)=(\d+)$/);
      if (ctxDigitsMatch) {
        if (isReadFamily || isSearchFamily) {
          normalized.push("-C", ctxDigitsMatch[1]);
        }
        i++;
        continue;
      }

      if (token === "--context-lines" || token === "--contextLines") {
        if (isReadFamily || isSearchFamily) {
          normalized.push("--context");
        } else if (i + 1 < args.length && /^\d+$/.test(args[i + 1])) {
          i++;
        }
        i++;
        continue;
      }

      if (token === "-c" && i + 1 < args.length && /^\d+$/.test(args[i + 1])) {
        if (isReadFamily || isSearchFamily) {
          normalized.push("-C");
        } else {
          normalized.push(token);
        }
        i++;
        continue;
      }

      const match = token.match(/^-c(\d+)$/);
      if (match) {
        if (isReadFamily || isSearchFamily) {
          normalized.push("-C", match[1]);
        } else {
          normalized.push(token);
        }
        i++;
        continue;
      }

      // 4. Include deps
      if (
        token === "--include-deps=false" ||
        token === "--includeDeps=false" ||
        token === "--deps=false"
      ) {
        if (isReadFamily) {
          normalized.push("--no-deps");
        }
        i++;
        continue;
      }

      if (
        token === "--include-deps" ||
        token === "--includeDeps" ||
        token === "--include-deps=true" ||
        token === "--includeDeps=true" ||
        token === "--deps=true"
      ) {
        if (isReadFamily) {
          normalized.push("--deps");
        }
        i++;
        continue;
      }

      // 5. Include callers
      if (
        token === "--include-callers=false" ||
        token === "--includeCallers=false" ||
        token === "--callers=false"
      ) {
        if (isReadFamily) {
          normalized.push("--no-callers");
        }
        i++;
        continue;
      }

      if (
        token === "--include-callers" ||
        token === "--includeCallers" ||
        token === "--include-callers=true" ||
        token === "--includeCallers=true" ||
        token === "--callers=true"
      ) {
        if (isReadFamily) {
          normalized.push("--callers");
        }
        i++;
        continue;
      }

      // 6. Boolean flags: --(outline|outline-target|full|dsl|json|stats|files-with-matches)=(true|false)
      const boolFlagMatch = token.match(
        /^--(outline|outline-target|outlineTarget|full|dsl|json|stats|files-with-matches|filesWithMatches)=(true|false)$/,
      );
      if (boolFlagMatch) {
        const [, rawFlag, boolVal] = boolFlagMatch;
        if (boolVal === "true") {
          let flag = rawFlag;
          if (flag === "outlineTarget") flag = "outline-target";
          if (flag === "filesWithMatches") flag = "files-with-matches";

          if (
            ((isFindFamily || isSearchFamily || isReadFamily) &&
              (flag === "full" || flag === "json")) ||
            (isReadFamily &&
              (flag === "outline" ||
                flag === "outline-target" ||
                flag === "dsl" ||
                flag === "stats")) ||
            (isSearchFamily && flag === "files-with-matches")
          ) {
            normalized.push(`--${flag}`);
          }
        }
        i++;
        continue;
      }

      // 7. Compact and idioms boolean options
      const compactIdiomsMatch = token.match(/^--(compact|idioms)=(true|false)$/);
      if (compactIdiomsMatch) {
        const [, flag, boolVal] = compactIdiomsMatch;
        if (isReadFamily) {
          if (boolVal === "true") {
            normalized.push(`--${flag}`);
          } else {
            normalized.push(`--no-${flag}`);
          }
        }
        i++;
        continue;
      }

      // 8. Types boolean options
      const typesMatch = token.match(/^--(?:types|include-types|includeTypes)=(true|false)$/);
      if (typesMatch) {
        const [, boolVal] = typesMatch;
        if (isReadFamily && boolVal === "false") {
          normalized.push("--no-types");
        }
        i++;
        continue;
      }
      if (token === "--types" || token === "--include-types" || token === "--includeTypes") {
        i++;
        continue;
      }

      // 9. Depth options (--max-depth, --maxDepth, --depth=N, -L N on find/tree)
      const depthEqMatch = token.match(/^--(?:max-depth|maxDepth|depth)=(\d+)$/);
      if (depthEqMatch) {
        if (isFindFamily || isReadFamily) {
          normalized.push("-d", depthEqMatch[1]!);
        }
        i++;
        continue;
      }
      if (token === "--max-depth" || token === "--maxDepth" || (isFindFamily && token === "-L")) {
        if (isFindFamily || isReadFamily) {
          normalized.push("-d");
        }
        i++;
        continue;
      }
      const shortDepthMatch = token.match(/^-(L|d)(\d+)$/);
      if (shortDepthMatch) {
        const [, flagCh, digits] = shortDepthMatch;
        if (
          (flagCh === "L" && isFindFamily) ||
          (flagCh === "d" && (isFindFamily || isReadFamily))
        ) {
          normalized.push("-d", digits!);
          i++;
          continue;
        }
      }

      // 10. Search --line-number=true/false compatibility
      const lineNumMatch = token.match(/^--(?:line-number|lineNumber)=(true|false)$/);
      if (lineNumMatch) {
        if (isSearchFamily && lineNumMatch[1] === "true") {
          normalized.push("-n");
        }
        i++;
        continue;
      }
    }
    normalized.push(token);
    i++;
  }

  return [...prefix, ...normalized];
}

export function installCliProgramHooks(program: Command): void {
  const origParseAsync = program.parseAsync.bind(program);
  program.parseAsync = async (
    argv?: readonly string[],
    parseOpts?: { from: "node" | "electron" | "user" },
  ) => {
    const rawList = argv ? Array.from(argv) : Array.from(process.argv);
    const pfxCount = parseOpts?.from === "user" ? 0 : 2;
    const cleanedRaw: string[] = rawList.slice(0, pfxCount);
    let seenDoubleDash = false;
    for (let idx = pfxCount; idx < rawList.length; idx++) {
      const tok = rawList[idx]!;
      if (tok === "--") {
        seenDoubleDash = true;
        cleanedRaw.push(tok);
        continue;
      }
      if (!seenDoubleDash && (tok === "--no-color" || tok === "--color=false")) {
        process.env.NO_COLOR = "1";
        process.env.NODE_DISABLE_COLORS = "1";
        if (tok === "--color=false") {
          continue;
        }
      } else if (!seenDoubleDash && (tok === "--color" || tok === "--color=true")) {
        delete process.env.NO_COLOR;
        delete process.env.NODE_DISABLE_COLORS;
        if (tok === "--color=true") {
          continue;
        }
      }
      cleanedRaw.push(tok);
    }

    const effectiveArgv = normalizeCliContextFlag(cleanedRaw, parseOpts);
    activeCliArgs = parseOpts?.from === "user" ? effectiveArgv.slice() : effectiveArgv.slice(2);
    cliFailureRecordedForInvocation = false;
    for (const sub of program.commands) {
      (
        sub as unknown as {
          _optionValues?: Record<string, unknown>;
          _optionValueSources?: Record<string, unknown>;
        }
      )._optionValues = {};
      (
        sub as unknown as {
          _optionValueSources?: Record<string, unknown>;
        }
      )._optionValueSources = {};
      for (const opt of sub.options) {
        if (opt.defaultValue !== undefined) {
          sub.setOptionValueWithSource(opt.attributeName(), opt.defaultValue, "default");
        }
      }
    }
    try {
      return await origParseAsync(effectiveArgv, parseOpts);
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      recordCliFailureTelemetry(msg);
      throw err;
    }
  };

  program.hook("preAction", (_thisCommand, actionCommand) => {
    for (const optKey of ["idioms", "callers", "deps", "compact"]) {
      if (actionCommand.getOptionValueSource(optKey) === "default") {
        actionCommand.setOptionValueWithSource(optKey, undefined, "default");
      }
    }
  });
}

export function attachSubcommandErrorTelemetry(program: Command): void {
  for (const subCmd of program.commands) {
    subCmd.configureOutput({
      outputError: (str, write) => {
        recordCliFailureTelemetry(str);
        write(str);
      },
    });
  }
}

export function writeTargetFile(outPath: string, content: string): void {
  const dir = path.dirname(outPath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  fs.writeFileSync(outPath, content, "utf-8");
}

export function resolveCliProjectRoot(targetPath: string): string {
  const cwd = path.resolve(process.cwd());
  const resolvedPath = path.resolve(cwd, targetPath);
  let startDir = resolvedPath;
  if (fs.existsSync(resolvedPath)) {
    try {
      if (!fs.statSync(resolvedPath).isDirectory()) {
        startDir = path.dirname(resolvedPath);
      }
    } catch {
      startDir = path.dirname(resolvedPath);
    }
  } else {
    startDir = path.dirname(resolvedPath);
  }
  const fallback = isSameOrDescendant(cwd, resolvedPath) ? cwd : startDir;
  const rawRoot = findProjectRoot(startDir, fallback);
  return isSameOrDescendant(cwd, resolvedPath) && !isSameOrDescendant(cwd, rawRoot) ? cwd : rawRoot;
}

export function resolveExplicitOrPolymorphicTarget(targetPath: string | undefined): {
  resolvedPath: string;
  projectRoot: string;
  config: AiceProjectConfig;
} {
  if (targetPath !== undefined && targetPath.trim().length > 0) {
    const cwd = path.resolve(process.cwd());
    const resolvedPath = path.resolve(cwd, targetPath.trim());
    const projectRoot = resolveCliProjectRoot(resolvedPath);
    const config = loadProjectConfig(projectRoot);
    return { resolvedPath, projectRoot, config };
  }
  const resolved = resolvePathTargets(undefined, { includeTargets: true });
  return {
    resolvedPath: resolved.resolvedPath,
    projectRoot: resolved.projectRoot,
    config: resolved.config,
  };
}

export async function readStdin(explicit = false): Promise<string> {
  if (process.stdin.isTTY) return "";
  try {
    const stat = fs.fstatSync(0);
    if (stat.isFile()) {
      return fs.readFileSync(0, "utf-8");
    }
    if (!explicit && !stat.isFIFO() && !stat.isSocket()) {
      return "";
    }
  } catch {
    if (!explicit) return "";
  }
  return new Promise((resolve) => {
    let data = "";
    let settled = false;
    let idleTimer: ReturnType<typeof setTimeout> | undefined;

    const finish = (result: string) => {
      if (settled) return;
      settled = true;
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
      }
      process.stdin.removeListener("data", onData);
      process.stdin.removeListener("end", onEnd);
      process.stdin.removeListener("error", onError);
      process.stdin.pause();
      resolve(result);
    };

    const onData = (chunk: string | Buffer) => {
      if (idleTimer !== undefined) {
        clearTimeout(idleTimer);
        idleTimer = undefined;
      }
      data += typeof chunk === "string" ? chunk : chunk.toString("utf-8");
    };
    const onEnd = () => finish(data);
    const onError = () => finish("");

    if (!explicit) {
      idleTimer = setTimeout(() => finish(data), 50);
      idleTimer.unref?.();
    }

    process.stdin.setEncoding("utf-8");
    process.stdin.on("data", onData);
    process.stdin.on("end", onEnd);
    process.stdin.on("error", onError);
    process.stdin.resume();
  });
}
