/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE 2.0 Honest BPE Token-Savings Telemetry Engine (`aice gain`).
 * Records append-only JSONL telemetry events across CLI and MCP surfaces,
 * preserving signed (positive, zero, and negative) token deltas without manipulation.
 */

import * as crypto from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
} from "../config/index.js";
import { detectLanguageName, estimateTokens } from "../tokenomics/index.js";

export type TelemetryOperation =
  | "create"
  | "outline"
  | "context"
  | "decompile"
  | "splice"
  | "patch"
  | "idioms_apply"
  | "idioms_update";

export type TelemetrySurface = "cli" | "mcp";
export type TelemetryCategory = "read" | "write";

export interface TelemetryEvent {
  timestamp: string;
  projectRoot: string;
  projectName: string;
  filePath: string;
  language: string;
  operation: TelemetryOperation;
  surface: TelemetrySurface;
  agent: string;
  category: TelemetryCategory;
  idiomsUsed: boolean;
  nativeChars: number;
  aiceChars: number;
  savedChars: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
  contentHash: string;
}

export interface RecordTelemetryInput {
  targetPath: string;
  projectRoot?: string;
  filePath?: string;
  language?: string;
  operation: TelemetryOperation;
  surface?: TelemetrySurface;
  agent?: string;
  idiomsUsed?: boolean;
  nativeText: string;
  aiceText: string;
  nativeCl100k?: number;
  aiceCl100k?: number;
  nativeO200k?: number;
  aiceO200k?: number;
  telemetryPath?: string;
}

export interface OperationBucket {
  operation: TelemetryOperation;
  surface: TelemetrySurface | "all";
  calls: number;
  nativeChars: number;
  aiceChars: number;
  savedChars: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  savingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
  o200kSavingsPct: number;
}

export interface LanguageBucket {
  language: string;
  calls: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  savingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
}

export interface ProjectGainSummary {
  projectRoot: string;
  projectName: string;
  calls: number;
  readCalls: number;
  writeCalls: number;
  overheadCalls: number;
  nativeChars: number;
  aiceChars: number;
  savedChars: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  savingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
  o200kSavingsPct: number;
}

export interface FileGainBucket {
  filePath: string;
  language: string;
  calls: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  savingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
}

export interface ProjectDetailReport {
  projectRoot: string;
  projectName: string;
  configStatus: {
    enabled: boolean;
    idiomsEnabled: boolean;
    activeIdiomsCount: number;
  };
  summary: {
    totalCalls: number;
    readCalls: number;
    writeCalls: number;
    idiomCalls: number;
    overheadCalls: number;
    nativeChars: number;
    aiceChars: number;
    savedChars: number;
    charSavingsPct: number;
    nativeCl100k: number;
    aiceCl100k: number;
    savedCl100k: number;
    cl100kSavingsPct: number;
    nativeO200k: number;
    aiceO200k: number;
    savedO200k: number;
    o200kSavingsPct: number;
    readSavedCl100k: number;
    writeSavedCl100k: number;
    idiomSavedCl100k: number;
    readSavedO200k: number;
    writeSavedO200k: number;
    idiomSavedO200k: number;
  };
  byOperation: OperationBucket[];
  topFiles: FileGainBucket[];
  recentOperations: TelemetryEvent[];
}

export interface GainReport {
  telemetryPath: string;
  unique: boolean;
  totalOperations: number;
  readOperations: number;
  writeOperations: number;
  overheadOperations: number;
  nativeChars: number;
  aiceChars: number;
  savedChars: number;
  charSavingsPct: number;
  nativeCl100k: number;
  aiceCl100k: number;
  savedCl100k: number;
  cl100kSavingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
  o200kSavingsPct: number;
  byOperation: OperationBucket[];
  byLanguage: LanguageBucket[];
  projects: ProjectGainSummary[];
  projectDetail?: ProjectDetailReport;
}

let telemetrySuppressionDepth = 0;

/**
 * Runs a function while suppressing nested telemetry recording to prevent double-counting.
 */
export function withSuppressedTelemetry<T>(fn: () => T): T {
  telemetrySuppressionDepth++;
  try {
    return fn();
  } finally {
    telemetrySuppressionDepth--;
  }
}

/**
 * Async variant of `withSuppressedTelemetry`.
 */
export async function withSuppressedTelemetryAsync<T>(fn: () => Promise<T>): Promise<T> {
  telemetrySuppressionDepth++;
  try {
    return await fn();
  } finally {
    telemetrySuppressionDepth--;
  }
}

export function isTelemetrySuppressed(): boolean {
  return telemetrySuppressionDepth > 0;
}

/**
 * Resolves the active telemetry JSONL file path, respecting `AICE_TELEMETRY_PATH` and `AICE_HOME`.
 */
export function resolveTelemetryPath(explicitPath?: string): string {
  if (explicitPath) {
    return path.resolve(explicitPath);
  }
  if (process.env.AICE_TELEMETRY_PATH) {
    return path.resolve(process.env.AICE_TELEMETRY_PATH);
  }
  const baseHome = process.env.AICE_HOME
    ? path.resolve(process.env.AICE_HOME)
    : path.join(os.homedir(), ".aice");
  return path.join(baseHome, "telemetry", "gains.jsonl");
}

/**
 * Checks whether we are running inside a unit test without an explicit telemetry path override.
 */
export function isTestEnvWithoutExplicitTelemetry(explicitPath?: string): boolean {
  if (explicitPath || process.env.AICE_TELEMETRY_PATH || process.env.AICE_HOME) {
    return false;
  }
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
}

/**
 * Detects the active CLI agent or caller from environment heuristics.
 */
export function detectCallerAgent(surface: TelemetrySurface = "cli"): string {
  if (process.env.AICE_AGENT?.trim()) {
    return process.env.AICE_AGENT.trim();
  }
  if (
    process.env.CLAUDECODE ||
    process.env.CLAUDE_CODE_ENTRYPOINT ||
    process.env.CLAUDE_PROJECT_DIR
  ) {
    return "claude";
  }
  if (process.env.ANTIGRAVITY_CLI || process.env.ANTIGRAVITY_AGENT || process.env.AGY_SESSION) {
    return "agy";
  }
  if (process.env.GEMINI_CLI) {
    return "gemini";
  }
  if (process.env.CODEX_CLI || process.env.OPENAI_CODEX) {
    return "codex";
  }
  if (process.env.OPENCODE || process.env.OPENCODE_CLI) {
    return "opencode";
  }
  if (process.env.AIDER || process.env.AIDER_MODEL) {
    return "aider";
  }
  if (process.env.GOOSE_PROVIDER) {
    return "goose";
  }
  if (process.env.CURSOR_TRACE_ID || process.env.CURSOR_SESSION) {
    return "cursor";
  }
  return surface === "mcp" ? "mcp-agent" : "user-cli";
}

function getCategoryForOperation(op: TelemetryOperation): TelemetryCategory {
  switch (op) {
    case "outline":
    case "context":
    case "decompile":
      return "read";
    case "create":
    case "splice":
    case "patch":
    case "idioms_apply":
    case "idioms_update":
      return "write";
  }
}

/**
 * Computes a complete `TelemetryEvent` using 100% honest signed BPE token delta math.
 */
export function computeTelemetryEvent(input: RecordTelemetryInput): TelemetryEvent {
  const resolvedTarget = path.resolve(input.targetPath);
  let isDir = false;
  try {
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      isDir = true;
    }
  } catch {
    // ignore
  }

  const projectRoot = path.resolve(
    input.projectRoot ?? findProjectRoot(isDir ? resolvedTarget : path.dirname(resolvedTarget)),
  );
  const projectName = path.basename(projectRoot) || "root";

  let filePath = input.filePath;
  if (!filePath) {
    if (isDir) {
      const relDir = path.relative(projectRoot, resolvedTarget).replace(/\\/g, "/");
      filePath = relDir && relDir !== "." ? `${relDir}/<directory>` : "<directory>";
    } else {
      const rel = path.relative(projectRoot, resolvedTarget).replace(/\\/g, "/");
      filePath = rel && !rel.startsWith("..") ? rel : path.basename(resolvedTarget);
    }
  }

  const language =
    input.language ??
    (isDir || filePath.endsWith("<directory>")
      ? "Multi-File"
      : detectLanguageName(resolvedTarget.replace(/\.aice$/, "")));

  const surface: TelemetrySurface = input.surface ?? "cli";
  const agent = input.agent ?? detectCallerAgent(surface);
  const category = getCategoryForOperation(input.operation);
  const idiomsUsed = Boolean(input.idiomsUsed);

  const nativeChars = input.nativeText.length;
  const aiceChars = input.aiceText.length;
  const savedChars = nativeChars - aiceChars;

  const nativeCl100k = input.nativeCl100k ?? estimateTokens(input.nativeText, "cl100k_base");
  const aiceCl100k = input.aiceCl100k ?? estimateTokens(input.aiceText, "cl100k_base");
  const savedCl100k = nativeCl100k - aiceCl100k;

  const nativeO200k = input.nativeO200k ?? estimateTokens(input.nativeText, "o200k_base");
  const aiceO200k = input.aiceO200k ?? estimateTokens(input.aiceText, "o200k_base");
  const savedO200k = nativeO200k - aiceO200k;

  const contentHash = crypto
    .createHash("sha256")
    .update(`${projectRoot}|${filePath}|${input.operation}|${nativeChars}|${aiceChars}`)
    .digest("hex");

  return {
    timestamp: new Date().toISOString(),
    projectRoot,
    projectName,
    filePath,
    language,
    operation: input.operation,
    surface,
    agent,
    category,
    idiomsUsed,
    nativeChars,
    aiceChars,
    savedChars,
    nativeCl100k,
    aiceCl100k,
    savedCl100k,
    nativeO200k,
    aiceO200k,
    savedO200k,
    contentHash,
  };
}

/**
 * Appends a `TelemetryEvent` atomically to `~/.aice/telemetry/gains.jsonl`.
 * Skips recording when telemetry is suppressed (inner helper call) or in unit tests without `AICE_TELEMETRY_PATH`.
 */
export function recordTelemetryEvent(
  input: RecordTelemetryInput,
  forceEvenIfSuppressed = false,
): TelemetryEvent | null {
  if (!forceEvenIfSuppressed && isTelemetrySuppressed()) {
    return null;
  }
  if (isTestEnvWithoutExplicitTelemetry(input.telemetryPath)) {
    return null;
  }
  try {
    const event = computeTelemetryEvent(input);
    const ledgerPath = resolveTelemetryPath(input.telemetryPath);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${JSON.stringify(event)}\n`, "utf-8");
    return event;
  } catch {
    return null;
  }
}

/**
 * Loads all valid `TelemetryEvent` records from the JSONL ledger.
 */
export function loadTelemetryEvents(explicitPath?: string): TelemetryEvent[] {
  const ledgerPath = resolveTelemetryPath(explicitPath);
  if (!fs.existsSync(ledgerPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(ledgerPath, "utf-8");
    const events: TelemetryEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as TelemetryEvent;
        if (
          parsed &&
          typeof parsed.operation === "string" &&
          typeof parsed.projectRoot === "string"
        ) {
          events.push(parsed);
        }
      } catch {
        // skip malformed JSONL line
      }
    }
    return events;
  } catch {
    return [];
  }
}

export const readTelemetryEvents = loadTelemetryEvents;

/**
 * Resets/clears the telemetry history ledger file.
 */
export function resetTelemetryHistory(explicitPath?: string): {
  deletedCount: number;
  telemetryPath: string;
} {
  const ledgerPath = resolveTelemetryPath(explicitPath);
  const existing = loadTelemetryEvents(ledgerPath);
  if (fs.existsSync(ledgerPath)) {
    fs.unlinkSync(ledgerPath);
  }
  return {
    deletedCount: existing.length,
    telemetryPath: ledgerPath,
  };
}

function calcPct(saved: number, nativeTotal: number): number {
  if (nativeTotal <= 0) return 0;
  return Number(((saved / nativeTotal) * 100).toFixed(1));
}

function matchesProjectFilter(event: TelemetryEvent, filterStr: string): boolean {
  const trimmed = filterStr.trim();
  if (!trimmed) return true;
  if (trimmed === ".") {
    const cwdRoot = findProjectRoot(process.cwd());
    return path.resolve(event.projectRoot) === path.resolve(cwdRoot);
  }
  if (
    event.projectName.toLowerCase() === trimmed.toLowerCase() ||
    path.basename(event.projectRoot).toLowerCase() === trimmed.toLowerCase()
  ) {
    return true;
  }
  const resolvedCandidate = path.resolve(trimmed);
  const resolvedEventRoot = path.resolve(event.projectRoot);
  if (
    resolvedEventRoot === resolvedCandidate ||
    resolvedCandidate.startsWith(`${resolvedEventRoot}${path.sep}`)
  ) {
    return true;
  }
  if (fs.existsSync(resolvedCandidate)) {
    const candidateRoot = path.resolve(findProjectRoot(resolvedCandidate));
    if (resolvedEventRoot === candidateRoot) {
      return true;
    }
  }
  return false;
}

function buildProjectDetail(
  projectRoot: string,
  projectEvents: TelemetryEvent[],
): ProjectDetailReport {
  const projectName = path.basename(projectRoot) || "root";
  let enabled = true;
  let idiomsEnabled = true;
  let activeIdiomsCount = 0;

  try {
    if (fs.existsSync(projectRoot)) {
      const cfg = loadProjectConfig(projectRoot);
      enabled = isProjectAiceEnabled(cfg);
      idiomsEnabled = isProjectIdiomsEnabled(cfg);
      activeIdiomsCount = cfg.idioms ? Object.keys(cfg.idioms).length : 0;
    }
  } catch {
    // ignore config load error for deleted/external directories
  }

  let readCalls = 0;
  let writeCalls = 0;
  let idiomCalls = 0;
  let overheadCalls = 0;
  let nativeChars = 0;
  let aiceChars = 0;
  let savedChars = 0;
  let nativeCl100k = 0;
  let aiceCl100k = 0;
  let savedCl100k = 0;
  let nativeO200k = 0;
  let aiceO200k = 0;
  let savedO200k = 0;
  let readSavedCl100k = 0;
  let writeSavedCl100k = 0;
  let idiomSavedCl100k = 0;
  let readSavedO200k = 0;
  let writeSavedO200k = 0;
  let idiomSavedO200k = 0;

  const opMap = new Map<string, OperationBucket>();
  const fileMap = new Map<string, FileGainBucket>();

  for (const ev of projectEvents) {
    if (ev.category === "read") {
      readCalls++;
      readSavedCl100k += ev.savedCl100k;
      readSavedO200k += ev.savedO200k;
    } else {
      writeCalls++;
      writeSavedCl100k += ev.savedCl100k;
      writeSavedO200k += ev.savedO200k;
    }
    if (ev.idiomsUsed || ev.operation === "idioms_apply" || ev.operation === "idioms_update") {
      idiomCalls++;
      idiomSavedCl100k += ev.savedCl100k;
      idiomSavedO200k += ev.savedO200k;
    }
    if (ev.savedCl100k <= 0) {
      overheadCalls++;
    }

    nativeChars += ev.nativeChars;
    aiceChars += ev.aiceChars;
    savedChars += ev.savedChars;
    nativeCl100k += ev.nativeCl100k;
    aiceCl100k += ev.aiceCl100k;
    savedCl100k += ev.savedCl100k;
    nativeO200k += ev.nativeO200k;
    aiceO200k += ev.aiceO200k;
    savedO200k += ev.savedO200k;

    const opKey = `${ev.operation}:${ev.surface}`;
    const existingOp = opMap.get(opKey) ?? {
      operation: ev.operation,
      surface: ev.surface,
      calls: 0,
      nativeChars: 0,
      aiceChars: 0,
      savedChars: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
      o200kSavingsPct: 0,
    };
    existingOp.calls++;
    existingOp.nativeChars += ev.nativeChars;
    existingOp.aiceChars += ev.aiceChars;
    existingOp.savedChars += ev.savedChars;
    existingOp.nativeCl100k += ev.nativeCl100k;
    existingOp.aiceCl100k += ev.aiceCl100k;
    existingOp.savedCl100k += ev.savedCl100k;
    existingOp.nativeO200k += ev.nativeO200k;
    existingOp.aiceO200k += ev.aiceO200k;
    existingOp.savedO200k += ev.savedO200k;
    existingOp.savingsPct = calcPct(existingOp.savedCl100k, existingOp.nativeCl100k);
    existingOp.o200kSavingsPct = calcPct(existingOp.savedO200k, existingOp.nativeO200k);
    opMap.set(opKey, existingOp);

    const existingFile = fileMap.get(ev.filePath) ?? {
      filePath: ev.filePath,
      language: ev.language,
      calls: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
    };
    existingFile.calls++;
    existingFile.nativeCl100k += ev.nativeCl100k;
    existingFile.aiceCl100k += ev.aiceCl100k;
    existingFile.savedCl100k += ev.savedCl100k;
    existingFile.nativeO200k += ev.nativeO200k;
    existingFile.aiceO200k += ev.aiceO200k;
    existingFile.savedO200k += ev.savedO200k;
    existingFile.savingsPct = calcPct(existingFile.savedCl100k, existingFile.nativeCl100k);
    fileMap.set(ev.filePath, existingFile);
  }

  const byOperation = Array.from(opMap.values()).sort(
    (a, b) => b.savedCl100k - a.savedCl100k || b.calls - a.calls,
  );
  const topFiles = Array.from(fileMap.values()).sort(
    (a, b) => b.savedCl100k - a.savedCl100k || b.calls - a.calls,
  );
  const recentOperations = projectEvents.slice(-15).reverse();

  return {
    projectRoot,
    projectName,
    configStatus: {
      enabled,
      idiomsEnabled,
      activeIdiomsCount,
    },
    summary: {
      totalCalls: projectEvents.length,
      readCalls,
      writeCalls,
      idiomCalls,
      overheadCalls,
      nativeChars,
      aiceChars,
      savedChars,
      charSavingsPct: calcPct(savedChars, nativeChars),
      nativeCl100k,
      aiceCl100k,
      savedCl100k,
      cl100kSavingsPct: calcPct(savedCl100k, nativeCl100k),
      nativeO200k,
      aiceO200k,
      savedO200k,
      o200kSavingsPct: calcPct(savedO200k, nativeO200k),
      readSavedCl100k,
      writeSavedCl100k,
      idiomSavedCl100k,
      readSavedO200k,
      writeSavedO200k,
      idiomSavedO200k,
    },
    byOperation,
    topFiles,
    recentOperations,
  };
}

/**
 * Aggregates global and per-project token-savings telemetry.
 */
export function buildGainReport(
  options: { project?: string; unique?: boolean; telemetryPath?: string } = {},
): GainReport {
  const ledgerPath = resolveTelemetryPath(options.telemetryPath);
  let events = loadTelemetryEvents(ledgerPath);

  if (options.unique) {
    const seen = new Set<string>();
    const deduped: TelemetryEvent[] = [];
    for (const ev of events) {
      if (!seen.has(ev.contentHash)) {
        seen.add(ev.contentHash);
        deduped.push(ev);
      }
    }
    events = deduped;
  }

  let filteredEvents = events;
  const projectFilter = options.project;
  if (projectFilter) {
    filteredEvents = events.filter((ev) => matchesProjectFilter(ev, projectFilter));
  }

  let readOperations = 0;
  let writeOperations = 0;
  let overheadOperations = 0;
  let nativeChars = 0;
  let aiceChars = 0;
  let savedChars = 0;
  let nativeCl100k = 0;
  let aiceCl100k = 0;
  let savedCl100k = 0;
  let nativeO200k = 0;
  let aiceO200k = 0;
  let savedO200k = 0;

  const opMap = new Map<string, OperationBucket>();
  const langMap = new Map<string, LanguageBucket>();
  const projMap = new Map<string, ProjectGainSummary>();
  const projEventsMap = new Map<string, TelemetryEvent[]>();

  for (const ev of filteredEvents) {
    if (ev.category === "read") readOperations++;
    else writeOperations++;

    if (ev.savedCl100k <= 0) {
      overheadOperations++;
    }

    nativeChars += ev.nativeChars;
    aiceChars += ev.aiceChars;
    savedChars += ev.savedChars;
    nativeCl100k += ev.nativeCl100k;
    aiceCl100k += ev.aiceCl100k;
    savedCl100k += ev.savedCl100k;
    nativeO200k += ev.nativeO200k;
    aiceO200k += ev.aiceO200k;
    savedO200k += ev.savedO200k;

    const opKey = `${ev.operation}:${ev.surface}`;
    const opBucket = opMap.get(opKey) ?? {
      operation: ev.operation,
      surface: ev.surface,
      calls: 0,
      nativeChars: 0,
      aiceChars: 0,
      savedChars: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
      o200kSavingsPct: 0,
    };
    opBucket.calls++;
    opBucket.nativeChars += ev.nativeChars;
    opBucket.aiceChars += ev.aiceChars;
    opBucket.savedChars += ev.savedChars;
    opBucket.nativeCl100k += ev.nativeCl100k;
    opBucket.aiceCl100k += ev.aiceCl100k;
    opBucket.savedCl100k += ev.savedCl100k;
    opBucket.nativeO200k += ev.nativeO200k;
    opBucket.aiceO200k += ev.aiceO200k;
    opBucket.savedO200k += ev.savedO200k;
    opBucket.savingsPct = calcPct(opBucket.savedCl100k, opBucket.nativeCl100k);
    opBucket.o200kSavingsPct = calcPct(opBucket.savedO200k, opBucket.nativeO200k);
    opMap.set(opKey, opBucket);

    const langBucket = langMap.get(ev.language) ?? {
      language: ev.language,
      calls: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
    };
    langBucket.calls++;
    langBucket.nativeCl100k += ev.nativeCl100k;
    langBucket.aiceCl100k += ev.aiceCl100k;
    langBucket.savedCl100k += ev.savedCl100k;
    langBucket.nativeO200k += ev.nativeO200k;
    langBucket.aiceO200k += ev.aiceO200k;
    langBucket.savedO200k += ev.savedO200k;
    langBucket.savingsPct = calcPct(langBucket.savedCl100k, langBucket.nativeCl100k);
    langMap.set(ev.language, langBucket);

    const projSummary = projMap.get(ev.projectRoot) ?? {
      projectRoot: ev.projectRoot,
      projectName: ev.projectName,
      calls: 0,
      readCalls: 0,
      writeCalls: 0,
      overheadCalls: 0,
      nativeChars: 0,
      aiceChars: 0,
      savedChars: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
      o200kSavingsPct: 0,
    };
    projSummary.calls++;
    if (ev.category === "read") projSummary.readCalls++;
    else projSummary.writeCalls++;
    if (ev.savedCl100k <= 0) projSummary.overheadCalls++;
    projSummary.nativeChars += ev.nativeChars;
    projSummary.aiceChars += ev.aiceChars;
    projSummary.savedChars += ev.savedChars;
    projSummary.nativeCl100k += ev.nativeCl100k;
    projSummary.aiceCl100k += ev.aiceCl100k;
    projSummary.savedCl100k += ev.savedCl100k;
    projSummary.nativeO200k += ev.nativeO200k;
    projSummary.aiceO200k += ev.aiceO200k;
    projSummary.savedO200k += ev.savedO200k;
    projSummary.savingsPct = calcPct(projSummary.savedCl100k, projSummary.nativeCl100k);
    projSummary.o200kSavingsPct = calcPct(projSummary.savedO200k, projSummary.nativeO200k);
    projMap.set(ev.projectRoot, projSummary);

    const pList = projEventsMap.get(ev.projectRoot) ?? [];
    pList.push(ev);
    projEventsMap.set(ev.projectRoot, pList);
  }

  const byOperation = Array.from(opMap.values()).sort(
    (a, b) => b.savedCl100k - a.savedCl100k || b.calls - a.calls,
  );
  const byLanguage = Array.from(langMap.values()).sort(
    (a, b) => b.savedCl100k - a.savedCl100k || b.calls - a.calls,
  );
  const projects = Array.from(projMap.values()).sort(
    (a, b) => b.savedCl100k - a.savedCl100k || b.calls - a.calls,
  );

  let projectDetail: ProjectDetailReport | undefined;
  if (options.project) {
    const targetRoot =
      projects.length > 0
        ? projects[0].projectRoot
        : options.project === "."
          ? findProjectRoot(process.cwd())
          : path.resolve(options.project);
    const pEvents = projEventsMap.get(targetRoot) ?? filteredEvents;
    projectDetail = buildProjectDetail(targetRoot, pEvents);
  }

  return {
    telemetryPath: ledgerPath,
    unique: Boolean(options.unique),
    totalOperations: filteredEvents.length,
    readOperations,
    writeOperations,
    overheadOperations,
    nativeChars,
    aiceChars,
    savedChars,
    charSavingsPct: calcPct(savedChars, nativeChars),
    nativeCl100k,
    aiceCl100k,
    savedCl100k,
    cl100kSavingsPct: calcPct(savedCl100k, nativeCl100k),
    nativeO200k,
    aiceO200k,
    savedO200k,
    o200kSavingsPct: calcPct(savedO200k, nativeO200k),
    byOperation,
    byLanguage,
    projects,
    ...(projectDetail ? { projectDetail } : {}),
  };
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n.toLocaleString()}` : n.toLocaleString();
}

function fmtPct(pct: number): string {
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

/**
 * Formats the Global `aice gain` Dashboard for terminal output.
 */
export function formatGlobalGainDashboard(report: GainReport): string {
  const lines: string[] = [];
  const modeLabel = report.unique ? "Deduplicated (--unique)" : "Cumulative (--all)";

  lines.push("================================================================================");
  lines.push(`AICE GAIN — 100% HONEST BPE TOKEN SAVINGS TELEMETRY (${modeLabel})`);
  lines.push("================================================================================");

  if (report.totalOperations === 0) {
    lines.push("No telemetry operations recorded yet.");
    lines.push(`Ledger path: ${report.telemetryPath}`);
    lines.push(
      "Run `aice outline`, `aice context`, `aice splice`, or MCP tools to begin tracking.",
    );
    return lines.join("\n");
  }

  lines.push("");
  lines.push("1. GLOBAL HONEST SUMMARY BANNER");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  Total Operations:       ${report.totalOperations.toLocaleString()} (read: ${report.readOperations}, write: ${report.writeOperations})`,
  );
  lines.push(
    `  Honest Overhead Calls:  ${report.overheadOperations.toLocaleString()} (operations where net savings <= 0)`,
  );
  lines.push(
    `  cl100k_base Tokens:     Native ${report.nativeCl100k.toLocaleString()} -> AICE ${report.aiceCl100k.toLocaleString()} | Net Saved: ${fmtSigned(report.savedCl100k)} (${fmtPct(report.cl100kSavingsPct)})`,
  );
  lines.push(
    `  o200k_base Tokens:      Native ${report.nativeO200k.toLocaleString()} -> AICE ${report.aiceO200k.toLocaleString()} | Net Saved: ${fmtSigned(report.savedO200k)} (${fmtPct(report.o200kSavingsPct)})`,
  );
  lines.push(
    `  Character Delta:        Native ${report.nativeChars.toLocaleString()} -> AICE ${report.aiceChars.toLocaleString()} | Net Saved: ${fmtSigned(report.savedChars)} (${fmtPct(report.charSavingsPct)})`,
  );

  lines.push("");
  lines.push("2. BREAKDOWN BY OPERATION & SURFACE (CLI vs MCP)");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"Operation".padEnd(16)} ${"Surface".padEnd(8)} ${"Calls".padStart(7)} ${"Native cl100k".padStart(14)} ${"AICE cl100k".padStart(12)} ${"Net Saved".padStart(12)} ${"Savings %".padStart(10)}`,
  );
  for (const op of report.byOperation) {
    lines.push(
      `  ${op.operation.padEnd(16)} ${op.surface.padEnd(8)} ${String(op.calls).padStart(7)} ${op.nativeCl100k.toLocaleString().padStart(14)} ${op.aiceCl100k.toLocaleString().padStart(12)} ${fmtSigned(op.savedCl100k).padStart(12)} ${fmtPct(op.savingsPct).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push("3. BREAKDOWN BY LANGUAGE");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"Language".padEnd(18)} ${"Calls".padStart(7)} ${"Native cl100k".padStart(14)} ${"AICE cl100k".padStart(12)} ${"Net Saved".padStart(12)} ${"Savings %".padStart(10)}`,
  );
  for (const lang of report.byLanguage) {
    lines.push(
      `  ${lang.language.padEnd(18)} ${String(lang.calls).padStart(7)} ${lang.nativeCl100k.toLocaleString().padStart(14)} ${lang.aiceCl100k.toLocaleString().padStart(12)} ${fmtSigned(lang.savedCl100k).padStart(12)} ${fmtPct(lang.savingsPct).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push("4. RANKED PROJECTS TABLE");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"#".padEnd(3)} ${"Project".padEnd(22)} ${"Calls".padStart(7)} ${"Native cl100k".padStart(14)} ${"AICE cl100k".padStart(12)} ${"Net Saved".padStart(12)} ${"Savings %".padStart(10)}`,
  );
  report.projects.forEach((p, idx) => {
    lines.push(
      `  ${String(idx + 1).padEnd(3)} ${p.projectName.slice(0, 22).padEnd(22)} ${String(p.calls).padStart(7)} ${p.nativeCl100k.toLocaleString().padStart(14)} ${p.aiceCl100k.toLocaleString().padStart(12)} ${fmtSigned(p.savedCl100k).padStart(12)} ${fmtPct(p.savingsPct).padStart(10)}`,
    );
  });

  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    "Tip: Run `aice gain <project-name>` or `aice gain .` to inspect per-project files & operation logs.",
  );
  return lines.join("\n");
}

/**
 * Formats the Per-Project Drill-Down Detail View for terminal output.
 */
export function formatProjectGainDetail(detail: ProjectDetailReport): string {
  const lines: string[] = [];
  const s = detail.summary;

  lines.push("================================================================================");
  lines.push(`AICE PROJECT GAIN DETAIL — ${detail.projectName}`);
  lines.push("================================================================================");
  lines.push(`  Project Root:     ${detail.projectRoot}`);
  lines.push(
    `  Config Status:    AICE=${detail.configStatus.enabled ? "ENABLED" : "DISABLED"} | Idioms=${detail.configStatus.idiomsEnabled ? "ENABLED" : "DISABLED"} (${detail.configStatus.activeIdiomsCount} active $idioms)`,
  );
  lines.push(
    `  Total Calls:      ${s.totalCalls} (read: ${s.readCalls}, write: ${s.writeCalls}, idiom-assisted: ${s.idiomCalls}, overhead<=0: ${s.overheadCalls})`,
  );
  lines.push(
    `  cl100k_base:      Native ${s.nativeCl100k.toLocaleString()} -> AICE ${s.aiceCl100k.toLocaleString()} | Net Saved: ${fmtSigned(s.savedCl100k)} (${fmtPct(s.cl100kSavingsPct)})`,
  );
  lines.push(
    `  o200k_base:       Native ${s.nativeO200k.toLocaleString()} -> AICE ${s.aiceO200k.toLocaleString()} | Net Saved: ${fmtSigned(s.savedO200k)} (${fmtPct(s.o200kSavingsPct)})`,
  );
  lines.push(
    `  Category Savings: Read=${fmtSigned(s.readSavedCl100k)} cl100k (${fmtSigned(s.readSavedO200k)} o200k) | Write=${fmtSigned(s.writeSavedCl100k)} cl100k (${fmtSigned(s.writeSavedO200k)} o200k) | Idioms=${fmtSigned(s.idiomSavedCl100k)} cl100k`,
  );

  lines.push("");
  lines.push("PER-OPERATION BREAKDOWN");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"Operation".padEnd(16)} ${"Surface".padEnd(8)} ${"Calls".padStart(7)} ${"Native cl100k".padStart(14)} ${"AICE cl100k".padStart(12)} ${"Net Saved".padStart(12)} ${"Savings %".padStart(10)}`,
  );
  for (const op of detail.byOperation) {
    lines.push(
      `  ${op.operation.padEnd(16)} ${op.surface.padEnd(8)} ${String(op.calls).padStart(7)} ${op.nativeCl100k.toLocaleString().padStart(14)} ${op.aiceCl100k.toLocaleString().padStart(12)} ${fmtSigned(op.savedCl100k).padStart(12)} ${fmtPct(op.savingsPct).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push("TOP FILES TABLE (INCLUDING ANY NEGATIVE-DELTA OVERHEAD FILES)");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"File Path".padEnd(32)} ${"Calls".padStart(6)} ${"Native".padStart(10)} ${"AICE".padStart(10)} ${"Net Saved".padStart(11)} ${"Savings %".padStart(10)}`,
  );
  for (const f of detail.topFiles.slice(0, 25)) {
    lines.push(
      `  ${f.filePath.slice(0, 32).padEnd(32)} ${String(f.calls).padStart(6)} ${f.nativeCl100k.toLocaleString().padStart(10)} ${f.aiceCl100k.toLocaleString().padStart(10)} ${fmtSigned(f.savedCl100k).padStart(11)} ${fmtPct(f.savingsPct).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push("RECENT OPERATIONS LOG (LAST 15)");
  lines.push("--------------------------------------------------------------------------------");
  lines.push(
    `  ${"Timestamp".padEnd(20)} ${"Surf".padEnd(5)} ${"Operation".padEnd(14)} ${"File".padEnd(26)} ${"Delta cl100k".padStart(12)}`,
  );
  for (const ev of detail.recentOperations) {
    const shortTs = ev.timestamp.replace("T", " ").slice(0, 19);
    lines.push(
      `  ${shortTs.padEnd(20)} ${ev.surface.padEnd(5)} ${ev.operation.padEnd(14)} ${ev.filePath.slice(0, 26).padEnd(26)} ${fmtSigned(ev.savedCl100k).padStart(12)}`,
    );
  }

  return lines.join("\n");
}
