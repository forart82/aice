/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Honest BPE Token-Savings Telemetry Engine (`aice gain`).
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
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../rules/mandatory-rules.js";
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
  realisticNativeText?: string;
  realisticNativeCl100k?: number;
  realisticSavedCl100k?: number;
  preservedTriviaTokens?: number;
  structuralCompressionPct?: number;
  multiFiles?: string[];
}

export const REPEAT_READ_WINDOW_MS = 90_000;

export interface RecordTelemetryInput {
  targetPath: string;
  timestamp?: string;
  projectRoot?: string;
  filePath?: string;
  multiFiles?: string[];
  language?: string;
  operation: TelemetryOperation;
  surface?: TelemetrySurface;
  agent?: string;
  idiomsUsed?: boolean;
  nativeText: string;
  aiceText: string;
  nativeChars?: number;
  aiceChars?: number;
  nativeCl100k?: number;
  aiceCl100k?: number;
  nativeO200k?: number;
  aiceO200k?: number;
  telemetryPath?: string;
  realisticNativeText?: string;
  realisticNativeCl100k?: number;
  realisticSavedCl100k?: number;
  preservedTriviaTokens?: number;
  structuralCompressionPct?: number;
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
  repeatReadCalls: number;
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
  repeatReadCalls: number;
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
    repeatReadCalls: number;
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
    ruleBudgetCl100k: number;
    netAfterRuleBudgetCl100k: number;
    ruleBreakEvenMultiple: number;
    ruleBreakEvenReached: boolean;
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
  overheadCalls: number;
  repeatReadCalls: number;
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
  ruleBudgetCl100k: number;
  netAfterRuleBudgetCl100k: number;
  ruleBreakEvenMultiple: number;
  ruleBreakEvenReached: boolean;
  byOperation: OperationBucket[];
  byLanguage: LanguageBucket[];
  projects: ProjectGainSummary[];
  projectDetail?: ProjectDetailReport;
  totalRealisticNativeCl100k?: number;
  totalRealisticSavedCl100k?: number;
  realisticSavedCl100kPct?: number;
  totalPreservedTriviaTokens?: number;
}

export interface CompactTelemetryResult {
  beforeBytes: number;
  afterBytes: number;
  keptEvents: number;
  droppedEphemeral: number;
}

interface CompactTelemetryRecord {
  t: number | string;
  r: string;
  p?: string;
  f: string;
  mf?: string[];
  l?: string;
  o: TelemetryOperation;
  s?: TelemetrySurface;
  a?: string;
  i?: 1;
  nc: number;
  ac: number;
  n1: number;
  a1: number;
  n2: number;
  a2: number;
  h?: string;
  rn?: number;
  rs?: number;
  pt?: number;
  sc?: number;
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
  if (
    explicitPath ||
    process.env.AICE_TELEMETRY_PATH ||
    process.env.AICE_TELEMETRY_ERRORS_PATH ||
    process.env.AICE_HOME
  ) {
    return false;
  }
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
}

/**
 * Pure path predicate checking whether a path lies inside an ephemeral sandbox
 * (`/tmp`, `/var/tmp`, `os.tmpdir()`, `/tmp/aice-rw-*`, `/tmp/sbx-*`, or `swarm-*` worktrees).
 */
export function isEphemeralPath(candidatePath: string, resolveRelative = true): boolean {
  if (!candidatePath?.trim()) {
    return false;
  }
  const rawNorm = candidatePath.trim().replace(/\\/g, "/");
  const isAbs = path.isAbsolute(candidatePath) || rawNorm.startsWith("/");
  if (!isAbs && !resolveRelative) {
    return (
      rawNorm === "tmp" ||
      rawNorm.startsWith("tmp/") ||
      rawNorm.startsWith("swarm-") ||
      rawNorm.includes("/swarm-")
    );
  }
  const resolved = (
    rawNorm.startsWith("/") ? path.posix.normalize(rawNorm) : path.resolve(candidatePath)
  ).replace(/\\/g, "/");
  const clean = resolved.length > 1 && resolved.endsWith("/") ? resolved.slice(0, -1) : resolved;
  const sysTmpRaw = os.tmpdir().replace(/\\/g, "/");
  const sysTmp =
    sysTmpRaw.length > 1 && sysTmpRaw.endsWith("/") ? sysTmpRaw.slice(0, -1) : sysTmpRaw;

  if (
    clean === "/tmp" ||
    clean.startsWith("/tmp/") ||
    clean === "/private/tmp" ||
    clean.startsWith("/private/tmp/") ||
    clean === "/var/tmp" ||
    clean.startsWith("/var/tmp/") ||
    clean === "/private/var/tmp" ||
    clean.startsWith("/private/var/tmp/") ||
    (sysTmp && sysTmp !== "/" && (clean === sysTmp || clean.startsWith(`${sysTmp}/`))) ||
    path.posix.basename(clean).startsWith("swarm-") ||
    clean.includes("/swarm-")
  ) {
    return true;
  }
  return false;
}

/**
 * Detects whether the workspace (`cwd`, `projectRoot`, or `targetPath`) is an ephemeral sandbox
 * (`/tmp`, `/var/tmp`, `os.tmpdir()`, or `swarm-*` worktrees) where global telemetry recording
 * should be suppressed unless an explicit telemetry path or `AICE_HOME` is set.
 */
export function isEphemeralWorkspace(
  cwd: string | Array<string | undefined> = process.cwd(),
  explicitPath?: string,
  ...extraPaths: Array<string | undefined>
): boolean {
  if (explicitPath || process.env.AICE_TELEMETRY_PATH || process.env.AICE_HOME) {
    return false;
  }
  const candidates = Array.isArray(cwd) ? [...cwd, ...extraPaths] : [cwd, ...extraPaths];
  for (const candidate of candidates) {
    if (candidate && isEphemeralPath(candidate, true)) {
      return true;
    }
  }
  return false;
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
    default:
      return "read";
  }
}

function computeContentHash(
  projectRoot: string,
  filePath: string,
  operation: TelemetryOperation,
  nativeChars: number,
  aiceChars: number,
): string {
  return crypto
    .createHash("sha256")
    .update(`${projectRoot}|${filePath}|${operation}|${nativeChars}|${aiceChars}`)
    .digest("hex");
}

function inferDefaultLanguage(filePath: string): string {
  if (filePath === "<cli-error>") {
    return "CLI";
  }
  if (
    filePath.endsWith("<directory>") ||
    filePath === "<multi-context>" ||
    filePath === "<multi-read>"
  ) {
    return "Multi-File";
  }
  return detectLanguageName(filePath.replace(/\.aice$/, ""));
}

let cachedRulesRef: string | null = null;
let cachedRuleBudgetCl100k = 0;

/**
 * Returns the active BPE (`cl100k_base`) token budget of `MANDATORY_AGENT_RULES_MARKDOWN`
 * injected into a single `AGENTS.md` rule block.
 */
export function getRuleOverheadBudgetCl100k(): number {
  if (cachedRulesRef !== MANDATORY_AGENT_RULES_MARKDOWN) {
    cachedRulesRef = MANDATORY_AGENT_RULES_MARKDOWN;
    cachedRuleBudgetCl100k = estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base");
  }
  return cachedRuleBudgetCl100k;
}

/**
 * Serializes a `TelemetryEvent` into a compact numeric JSONL line (< 250 B/event)
 * with zero raw source strings.
 */
export function serializeCompactTelemetryEvent(event: TelemetryEvent): string {
  const parsedMs = Date.parse(event.timestamp);
  const t: number | string =
    Number.isFinite(parsedMs) && new Date(parsedMs).toISOString() === event.timestamp
      ? parsedMs
      : event.timestamp;
  const compactFilePath =
    event.filePath.length > 120 ? event.filePath.slice(0, 120) : event.filePath;
  const defaultProjectName = path.basename(event.projectRoot) || "root";
  const defaultLang = inferDefaultLanguage(compactFilePath);
  const defaultAgent = event.surface === "mcp" ? "mcp-agent" : "user-cli";
  const expectedHash = computeContentHash(
    event.projectRoot,
    compactFilePath,
    event.operation,
    event.nativeChars,
    event.aiceChars,
  );

  let compactMf: string[] | undefined;
  if (event.multiFiles && event.multiFiles.length > 0) {
    const deduped = Array.from(
      new Set(
        event.multiFiles
          .map((item) => {
            const rel = path.isAbsolute(item)
              ? path.relative(event.projectRoot, item).replace(/\\/g, "/")
              : item.replace(/\\/g, "/");
            const normalized = rel && !rel.startsWith("..") ? rel : path.basename(item);
            return normalized.slice(0, 120);
          })
          .filter(Boolean),
      ),
    ).slice(0, 16);
    if (deduped.length > 0) {
      compactMf = deduped;
    }
  }

  const rec: CompactTelemetryRecord = {
    t,
    r: event.projectRoot,
    ...(event.projectName !== defaultProjectName ? { p: event.projectName } : {}),
    f: compactFilePath,
    ...(compactMf ? { mf: compactMf } : {}),
    ...(event.language !== defaultLang ? { l: event.language } : {}),
    o: event.operation,
    ...(event.surface !== "cli" ? { s: event.surface } : {}),
    ...(event.agent && event.agent !== defaultAgent ? { a: event.agent } : {}),
    ...(event.idiomsUsed ? { i: 1 } : {}),
    nc: event.nativeChars,
    ac: event.aiceChars,
    n1: event.nativeCl100k,
    a1: event.aiceCl100k,
    n2: event.nativeO200k,
    a2: event.aiceO200k,
    ...(event.contentHash && event.contentHash !== expectedHash ? { h: event.contentHash } : {}),
    ...(event.realisticNativeCl100k !== undefined ? { rn: event.realisticNativeCl100k } : {}),
    ...(event.realisticSavedCl100k !== undefined &&
    event.realisticNativeCl100k !== undefined &&
    event.realisticSavedCl100k !== event.realisticNativeCl100k - event.aiceCl100k
      ? { rs: event.realisticSavedCl100k }
      : {}),
    ...(event.preservedTriviaTokens && event.preservedTriviaTokens !== 0
      ? { pt: event.preservedTriviaTokens }
      : {}),
    ...(event.structuralCompressionPct !== undefined ? { sc: event.structuralCompressionPct } : {}),
  };

  return JSON.stringify(rec);
}

/**
 * Hydrates a full `TelemetryEvent` from either a compact numeric JSONL object
 * or a legacy verbose JSONL object, stripping any legacy raw source strings.
 */
export function hydrateTelemetryEvent(raw: unknown): TelemetryEvent | null {
  if (!raw || typeof raw !== "object") {
    return null;
  }
  const obj = raw as Record<string, unknown>;
  const operationRaw =
    typeof obj.o === "string" ? obj.o : typeof obj.operation === "string" ? obj.operation : "";
  const projectRoot =
    typeof obj.r === "string" ? obj.r : typeof obj.projectRoot === "string" ? obj.projectRoot : "";
  if (!operationRaw || !projectRoot) {
    return null;
  }

  const operation = operationRaw as TelemetryOperation;
  const timestamp =
    typeof obj.t === "number"
      ? new Date(obj.t).toISOString()
      : typeof obj.t === "string"
        ? obj.t
        : typeof obj.timestamp === "string"
          ? obj.timestamp
          : new Date(0).toISOString();
  const projectName =
    typeof obj.p === "string"
      ? obj.p
      : typeof obj.projectName === "string"
        ? obj.projectName
        : path.basename(projectRoot) || "root";
  const filePath =
    typeof obj.f === "string"
      ? obj.f
      : typeof obj.filePath === "string"
        ? obj.filePath
        : "<unknown>";
  const language =
    typeof obj.l === "string"
      ? obj.l
      : typeof obj.language === "string"
        ? obj.language
        : inferDefaultLanguage(filePath);
  const surface: TelemetrySurface = obj.s === "mcp" || obj.surface === "mcp" ? "mcp" : "cli";
  const agent =
    typeof obj.a === "string"
      ? obj.a
      : typeof obj.agent === "string"
        ? obj.agent
        : surface === "mcp"
          ? "mcp-agent"
          : "user-cli";
  const category: TelemetryCategory =
    obj.category === "read" || obj.category === "write"
      ? obj.category
      : getCategoryForOperation(operation);
  const idiomsUsed = Boolean(obj.i ?? obj.idiomsUsed);

  const nativeChars = Number(obj.nc ?? obj.nativeChars ?? 0);
  const aiceChars = Number(obj.ac ?? obj.aiceChars ?? 0);
  const savedChars = nativeChars - aiceChars;

  const nativeCl100k = Number(obj.n1 ?? obj.nativeCl100k ?? 0);
  const aiceCl100k = Number(obj.a1 ?? obj.aiceCl100k ?? 0);
  const savedCl100k = nativeCl100k - aiceCl100k;

  const nativeO200k = Number(obj.n2 ?? obj.nativeO200k ?? 0);
  const aiceO200k = Number(obj.a2 ?? obj.aiceO200k ?? 0);
  const savedO200k = nativeO200k - aiceO200k;

  const contentHash =
    typeof obj.h === "string"
      ? obj.h
      : typeof obj.contentHash === "string"
        ? obj.contentHash
        : computeContentHash(projectRoot, filePath, operation, nativeChars, aiceChars);

  const realisticNativeCl100k =
    typeof obj.rn === "number"
      ? obj.rn
      : typeof obj.realisticNativeCl100k === "number"
        ? obj.realisticNativeCl100k
        : typeof obj.realisticNativeText === "string"
          ? estimateTokens(obj.realisticNativeText, "cl100k_base")
          : undefined;
  const realisticSavedCl100k =
    typeof obj.rs === "number"
      ? obj.rs
      : realisticNativeCl100k !== undefined
        ? realisticNativeCl100k - aiceCl100k
        : undefined;

  const preservedTriviaTokens =
    typeof obj.pt === "number"
      ? obj.pt
      : typeof obj.preservedTriviaTokens === "number"
        ? obj.preservedTriviaTokens
        : 0;
  const structuralCompressionPct =
    typeof obj.sc === "number"
      ? obj.sc
      : typeof obj.structuralCompressionPct === "number"
        ? obj.structuralCompressionPct
        : undefined;

  const rawMf = Array.isArray(obj.mf)
    ? obj.mf
    : Array.isArray(obj.multiFiles)
      ? obj.multiFiles
      : undefined;
  const multiFiles = rawMf
    ? rawMf.filter((item): item is string => typeof item === "string")
    : undefined;

  return {
    timestamp,
    projectRoot,
    projectName,
    filePath,
    language,
    operation,
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
    ...(realisticNativeCl100k !== undefined ? { realisticNativeCl100k } : {}),
    ...(realisticSavedCl100k !== undefined ? { realisticSavedCl100k } : {}),
    preservedTriviaTokens,
    ...(structuralCompressionPct !== undefined ? { structuralCompressionPct } : {}),
    ...(multiFiles && multiFiles.length > 0 ? { multiFiles } : {}),
  };
}

/**
 * Computes a complete `TelemetryEvent` using 100% honest signed BPE token delta math.
 * Never attaches raw source text payloads (`realisticNativeText`) to returned or persisted records.
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
    (filePath === "<cli-error>"
      ? "CLI"
      : isDir || filePath.endsWith("<directory>")
        ? "Multi-File"
        : detectLanguageName(resolvedTarget.replace(/\.aice$/, "")));

  const surface: TelemetrySurface = input.surface ?? "cli";
  const agent = input.agent ?? detectCallerAgent(surface);
  const category = getCategoryForOperation(input.operation);
  const idiomsUsed = Boolean(input.idiomsUsed);

  const nativeChars = input.nativeChars ?? input.nativeText.length;
  const aiceChars = input.aiceChars ?? input.aiceText.length;
  const savedChars = nativeChars - aiceChars;

  const nativeCl100k = input.nativeCl100k ?? estimateTokens(input.nativeText, "cl100k_base");
  const aiceCl100k = input.aiceCl100k ?? estimateTokens(input.aiceText, "cl100k_base");
  const savedCl100k = nativeCl100k - aiceCl100k;

  const nativeO200k = input.nativeO200k ?? estimateTokens(input.nativeText, "o200k_base");
  const aiceO200k = input.aiceO200k ?? estimateTokens(input.aiceText, "o200k_base");
  const savedO200k = nativeO200k - aiceO200k;

  const contentHash = computeContentHash(
    projectRoot,
    filePath,
    input.operation,
    nativeChars,
    aiceChars,
  );

  const realisticNativeCl100k =
    input.realisticNativeCl100k ??
    (input.realisticNativeText !== undefined
      ? estimateTokens(input.realisticNativeText, "cl100k_base")
      : undefined);
  const realisticSavedCl100k =
    input.realisticSavedCl100k ??
    (realisticNativeCl100k !== undefined ? realisticNativeCl100k - aiceCl100k : undefined);

  return {
    timestamp: input.timestamp ?? new Date().toISOString(),
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
    ...(realisticNativeCl100k !== undefined ? { realisticNativeCl100k } : {}),
    ...(realisticSavedCl100k !== undefined ? { realisticSavedCl100k } : {}),
    preservedTriviaTokens: input.preservedTriviaTokens ?? 0,
    ...(input.structuralCompressionPct !== undefined
      ? { structuralCompressionPct: input.structuralCompressionPct }
      : {}),
    ...(input.multiFiles && input.multiFiles.length > 0 ? { multiFiles: input.multiFiles } : {}),
  };
}

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
  if (
    !forceEvenIfSuppressed &&
    isEphemeralWorkspace(process.cwd(), input.telemetryPath, input.projectRoot, input.targetPath)
  ) {
    return null;
  }
  try {
    const event = computeTelemetryEvent(input);
    if (!forceEvenIfSuppressed && isEphemeralWorkspace(event.projectRoot, input.telemetryPath)) {
      return null;
    }
    const ledgerPath = resolveTelemetryPath(input.telemetryPath);
    fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
    fs.appendFileSync(ledgerPath, `${serializeCompactTelemetryEvent(event)}\n`, "utf-8");
    return event;
  } catch {
    return null;
  }
}

/**
 * Loads all valid `TelemetryEvent` records from the JSONL ledger (hydrating both
 * compact numeric records and legacy verbose records).
 */
const MAX_TELEMETRY_LEDGER_READ_BYTES = 20 * 1024 * 1024;

export function loadTelemetryEvents(explicitPath?: string): TelemetryEvent[] {
  const ledgerPath = resolveTelemetryPath(explicitPath);
  if (!fs.existsSync(ledgerPath)) {
    return [];
  }
  try {
    let raw = "";
    const st = fs.statSync(ledgerPath);
    if (st.size > MAX_TELEMETRY_LEDGER_READ_BYTES) {
      const fd = fs.openSync(ledgerPath, "r");
      try {
        const buf = Buffer.allocUnsafe(MAX_TELEMETRY_LEDGER_READ_BYTES);
        const bytesRead = fs.readSync(
          fd,
          buf,
          0,
          MAX_TELEMETRY_LEDGER_READ_BYTES,
          st.size - MAX_TELEMETRY_LEDGER_READ_BYTES,
        );
        const tailText = buf.subarray(0, bytesRead).toString("utf-8");
        const firstNl = tailText.indexOf("\n");
        raw = firstNl >= 0 ? tailText.slice(firstNl + 1) : tailText;
      } finally {
        fs.closeSync(fd);
      }
    } else {
      raw = fs.readFileSync(ledgerPath, "utf-8");
    }
    const events: TelemetryEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const hydrated = hydrateTelemetryEvent(JSON.parse(trimmed));
        if (hydrated) {
          events.push(hydrated);
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
 * Streams an existing `gains.jsonl` ledger in fixed 4 MB chunks (safe on 1.27+ GB files
 * without V8 string-length overflow), drops ephemeral `/tmp` / `/var/tmp` / `swarm-*`
 * workspace records, strips raw `realisticNativeText` source payloads, and atomically
 * rewrites the compact numeric ledger (< 250 B/event).
 */
export function compactTelemetryLedger(explicitPath?: string): CompactTelemetryResult {
  const ledgerPath = resolveTelemetryPath(explicitPath);
  if (!fs.existsSync(ledgerPath)) {
    return { beforeBytes: 0, afterBytes: 0, keptEvents: 0, droppedEphemeral: 0 };
  }
  const beforeBytes = fs.statSync(ledgerPath).size;
  if (beforeBytes === 0) {
    return { beforeBytes: 0, afterBytes: 0, keptEvents: 0, droppedEphemeral: 0 };
  }

  fs.mkdirSync(path.dirname(ledgerPath), { recursive: true });
  const tmpPath = `${ledgerPath}.compact-${process.pid}-${Date.now()}.tmp`;
  const CHUNK_SIZE = 4 * 1024 * 1024;
  const FLUSH_THRESHOLD = 512 * 1024;

  let readFd: number | null = null;
  let writeFd: number | null = null;
  let keptEvents = 0;
  let droppedEphemeral = 0;

  try {
    readFd = fs.openSync(ledgerPath, "r");
    writeFd = fs.openSync(tmpPath, "w");
    const outFd = writeFd;

    const readBuf = Buffer.allocUnsafe(CHUNK_SIZE);
    let carry: Buffer = Buffer.alloc(0);
    let outChunks: string[] = [];
    let outBufferedChars = 0;

    const flushOut = (): void => {
      if (outChunks.length === 0) return;
      fs.writeSync(outFd, outChunks.join(""), undefined, "utf-8");
      outChunks = [];
      outBufferedChars = 0;
    };

    const processLineBuffer = (lineBuf: Buffer): void => {
      if (lineBuf.length === 0) return;
      let lineStr = "";
      try {
        lineStr = lineBuf.toString("utf-8").trim();
      } catch {
        return;
      }
      if (!lineStr) return;

      let parsed: unknown;
      try {
        parsed = JSON.parse(lineStr);
      } catch {
        return;
      }
      if (!parsed || typeof parsed !== "object") return;
      const obj = parsed as Record<string, unknown>;
      const rawRoot =
        typeof obj.r === "string"
          ? obj.r
          : typeof obj.projectRoot === "string"
            ? obj.projectRoot
            : "";
      const rawFile =
        typeof obj.f === "string" ? obj.f : typeof obj.filePath === "string" ? obj.filePath : "";
      if (!rawRoot) return;
      const resolvedFile =
        rawFile && (path.isAbsolute(rawRoot) || rawRoot.startsWith("/"))
          ? path.resolve(rawRoot, rawFile)
          : "";
      if (
        isEphemeralPath(rawRoot, false) ||
        isEphemeralPath(rawFile, false) ||
        (resolvedFile !== "" && isEphemeralPath(resolvedFile, false))
      ) {
        droppedEphemeral++;
        return;
      }
      const hydrated = hydrateTelemetryEvent(obj);
      if (!hydrated) return;
      if (isEphemeralPath(hydrated.projectRoot, false)) {
        droppedEphemeral++;
        return;
      }

      hydrated.contentHash = computeContentHash(
        hydrated.projectRoot,
        hydrated.filePath,
        hydrated.operation,
        hydrated.nativeChars,
        hydrated.aiceChars,
      );
      const compactLine = `${serializeCompactTelemetryEvent(hydrated)}\n`;
      outChunks.push(compactLine);
      outBufferedChars += compactLine.length;
      keptEvents++;
      if (outBufferedChars >= FLUSH_THRESHOLD) {
        flushOut();
      }
    };

    let position = 0;
    while (true) {
      const bytesRead = fs.readSync(readFd, readBuf, 0, CHUNK_SIZE, position);
      if (bytesRead <= 0) break;
      position += bytesRead;

      const chunk = readBuf.subarray(0, bytesRead);
      let sliceStart = 0;
      while (sliceStart < chunk.length) {
        const nlIdx = chunk.indexOf(0x0a, sliceStart);
        if (nlIdx === -1) {
          const tail = chunk.subarray(sliceStart);
          carry = carry.length === 0 ? Buffer.from(tail) : Buffer.concat([carry, tail]);
          break;
        }
        const segment = chunk.subarray(sliceStart, nlIdx);
        const fullLine = carry.length === 0 ? segment : Buffer.concat([carry, segment]);
        carry = Buffer.alloc(0);
        processLineBuffer(fullLine);
        sliceStart = nlIdx + 1;
      }
    }
    if (carry.length > 0) {
      processLineBuffer(carry);
    }
    flushOut();

    fs.closeSync(readFd);
    readFd = null;
    fs.closeSync(writeFd);
    writeFd = null;

    fs.renameSync(tmpPath, ledgerPath);
    const afterBytes = fs.statSync(ledgerPath).size;
    return { beforeBytes, afterBytes, keptEvents, droppedEphemeral };
  } catch (err) {
    if (readFd !== null) {
      try {
        fs.closeSync(readFd);
      } catch {
        // ignore
      }
    }
    if (writeFd !== null) {
      try {
        fs.closeSync(writeFd);
      } catch {
        // ignore
      }
    }
    fs.rmSync(tmpPath, { force: true });
    throw err;
  }
}

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
  if (nativeTotal <= 0) {
    return saved < 0 ? -100 : 0;
  }
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

interface LastProjectTelemetryState {
  category: TelemetryCategory;
  filePath: string;
  files?: string[];
  timestampMs: number;
}

function isTrackableRepeatReadFile(filePath: string): boolean {
  return Boolean(filePath && !filePath.startsWith("<") && !filePath.endsWith("<directory>"));
}

function checkAndAdvanceRepeatReadState(
  ev: TelemetryEvent,
  stateMap: Map<string, LastProjectTelemetryState>,
): boolean {
  const projKey = path.resolve(ev.projectRoot);
  const tsMs = Date.parse(ev.timestamp);
  const prev = stateMap.get(projKey);
  let isRepeatRead = false;

  let currFiles: string[] = [];
  if (isTrackableRepeatReadFile(ev.filePath)) {
    currFiles = [ev.filePath];
  } else if (ev.filePath === "<multi-context>" && Array.isArray(ev.multiFiles)) {
    currFiles = ev.multiFiles.filter(isTrackableRepeatReadFile);
  }

  const prevFiles =
    prev?.files && prev.files.length > 0
      ? prev.files
      : prev && isTrackableRepeatReadFile(prev.filePath)
        ? [prev.filePath]
        : [];

  if (
    ev.category === "read" &&
    currFiles.length > 0 &&
    prev?.category === "read" &&
    prevFiles.length > 0 &&
    Number.isFinite(tsMs) &&
    Number.isFinite(prev.timestampMs)
  ) {
    const deltaMs = tsMs - prev.timestampMs;
    if (deltaMs >= 0 && deltaMs < REPEAT_READ_WINDOW_MS) {
      const prevFileSet = new Set(prevFiles);
      if (currFiles.some((f) => prevFileSet.has(f))) {
        isRepeatRead = true;
      }
    }
  }

  stateMap.set(projKey, {
    category: ev.category,
    filePath: ev.filePath,
    files: currFiles,
    timestampMs: tsMs,
  });

  return isRepeatRead;
}

function buildProjectDetail(
  projectRoot: string,
  projectEvents: TelemetryEvent[],
): ProjectDetailReport {
  const projectName = path.basename(projectRoot) || "root";
  let enabled = true;
  let idiomsEnabled = false;
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
  let repeatReadCalls = 0;
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
  const repeatReadState = new Map<string, LastProjectTelemetryState>();

  for (const ev of projectEvents) {
    const isRepeatRead = checkAndAdvanceRepeatReadState(ev, repeatReadState);
    if (isRepeatRead) {
      repeatReadCalls++;
    }
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
      repeatReadCalls: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
    };
    existingFile.calls++;
    if (isRepeatRead) {
      existingFile.repeatReadCalls++;
    }
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
      repeatReadCalls,
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
      ...computeRuleBreakEvenMetrics(savedCl100k),
    },
    byOperation,
    topFiles,
    recentOperations,
  };
}

function computeRuleBreakEvenMetrics(savedCl100k: number): {
  ruleBudgetCl100k: number;
  netAfterRuleBudgetCl100k: number;
  ruleBreakEvenMultiple: number;
  ruleBreakEvenReached: boolean;
} {
  const ruleBudgetCl100k = getRuleOverheadBudgetCl100k();
  const netAfterRuleBudgetCl100k = savedCl100k - ruleBudgetCl100k;
  const ruleBreakEvenMultiple =
    ruleBudgetCl100k > 0 ? Number((savedCl100k / ruleBudgetCl100k).toFixed(2)) : 0;
  const ruleBreakEvenReached = savedCl100k >= ruleBudgetCl100k;
  return {
    ruleBudgetCl100k,
    netAfterRuleBudgetCl100k,
    ruleBreakEvenMultiple,
    ruleBreakEvenReached,
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
  let repeatReadCalls = 0;
  let nativeChars = 0;
  let aiceChars = 0;
  let savedChars = 0;
  let nativeCl100k = 0;
  let aiceCl100k = 0;
  let savedCl100k = 0;
  let nativeO200k = 0;
  let aiceO200k = 0;
  let savedO200k = 0;
  let totalRealisticNativeCl100k = 0;
  let totalRealisticSavedCl100k = 0;
  let totalPreservedTriviaTokens = 0;

  const opMap = new Map<string, OperationBucket>();
  const langMap = new Map<string, LanguageBucket>();
  const projMap = new Map<string, ProjectGainSummary>();
  const projEventsMap = new Map<string, TelemetryEvent[]>();
  const repeatReadState = new Map<string, LastProjectTelemetryState>();

  for (const ev of filteredEvents) {
    const isRepeatRead = checkAndAdvanceRepeatReadState(ev, repeatReadState);
    if (isRepeatRead) {
      repeatReadCalls++;
    }
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

    const realNat = ev.realisticNativeCl100k ?? ev.nativeCl100k;
    const realSaved = ev.realisticSavedCl100k ?? realNat - ev.aiceCl100k;
    totalRealisticNativeCl100k += realNat;
    totalRealisticSavedCl100k += realSaved;
    totalPreservedTriviaTokens += ev.preservedTriviaTokens ?? 0;

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
      repeatReadCalls: 0,
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
    if (isRepeatRead) projSummary.repeatReadCalls++;
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
    overheadCalls: overheadOperations,
    repeatReadCalls,
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
    ...computeRuleBreakEvenMetrics(savedCl100k),
    totalRealisticNativeCl100k,
    totalRealisticSavedCl100k,
    realisticSavedCl100kPct: calcPct(totalRealisticSavedCl100k, totalRealisticNativeCl100k),
    totalPreservedTriviaTokens,
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

function formatRuleOverheadBreakEvenLine(savedCl100k: number, indent = "  "): string {
  const budget = getRuleOverheadBudgetCl100k();
  const multiple = budget > 0 ? (savedCl100k / budget).toFixed(2) : "0.00";
  if (savedCl100k >= budget && budget > 0) {
    const netAfter = savedCl100k - budget;
    return `${indent}Rule Overhead Break-Even: 1x AGENTS.md Budget ${budget.toLocaleString()} cl100k | Net Saved: ${fmtSigned(savedCl100k)} | AMORTIZED (${multiple}x budget, net ${fmtSigned(netAfter)} tokens)`;
  }
  const remaining = budget > savedCl100k ? budget - savedCl100k : 0;
  return `${indent}Rule Overhead Break-Even: 1x AGENTS.md Budget ${budget.toLocaleString()} cl100k | Net Saved: ${fmtSigned(savedCl100k)} | ${remaining.toLocaleString()} tokens needed to break even (${multiple}x)`;
}

export function formatGlobalGainDashboard(report: GainReport): string {
  const lines: string[] = [];
  const modeLabel = report.unique ? "Deduplicated (--unique)" : "Cumulative (--all)";

  lines.push("================================================================================");
  lines.push(`AICE GAIN — 100% HONEST BPE TOKEN SAVINGS TELEMETRY (${modeLabel})`);
  lines.push("================================================================================");

  if (report.totalOperations === 0) {
    lines.push("No telemetry operations recorded yet.");
    lines.push(`Ledger path: ${report.telemetryPath}`);
    lines.push(formatRuleOverheadBreakEvenLine(0, ""));
    lines.push(
      "Run `aice read` or `aice splice` (or MCP `aice_read` / `aice_splice`) to begin tracking.",
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
    `  Repeat-Read Turn Warnings: ${report.repeatReadCalls.toLocaleString()}${
      report.repeatReadCalls > 0
        ? " ⚠ (<90s back-to-back same-file reads — multi-turn line hunting)"
        : " (0 <90s back-to-back same-file reads)"
    }`,
  );
  lines.push(
    `  cl100k_base Tokens:     Native ${report.nativeCl100k.toLocaleString()} -> AICE ${report.aiceCl100k.toLocaleString()} | Net Saved: ${fmtSigned(report.savedCl100k)} (${fmtPct(report.cl100kSavingsPct)})`,
  );
  lines.push(
    `  o200k_base Tokens:      Native ${report.nativeO200k.toLocaleString()} -> AICE ${report.aiceO200k.toLocaleString()} | Net Saved: ${fmtSigned(report.savedO200k)} (${fmtPct(report.o200kSavingsPct)})`,
  );
  if (report.totalRealisticSavedCl100k !== undefined) {
    lines.push(
      `  Realistic Tool Savings: Net Saved: ${fmtSigned(report.totalRealisticSavedCl100k)} (${fmtPct(report.realisticSavedCl100kPct ?? 0)}) | Preserved Trivia: +${(report.totalPreservedTriviaTokens ?? 0).toLocaleString()} tokens`,
    );
  }
  lines.push(
    `  Character Delta:        Native ${report.nativeChars.toLocaleString()} -> AICE ${report.aiceChars.toLocaleString()} | Net Saved: ${fmtSigned(report.savedChars)} (${fmtPct(report.charSavingsPct)})`,
  );
  lines.push(formatRuleOverheadBreakEvenLine(report.savedCl100k));

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
    `  Repeat-Read Turn Warnings: ${s.repeatReadCalls.toLocaleString()}${
      s.repeatReadCalls > 0
        ? " ⚠ (<90s back-to-back same-file reads — multi-turn line hunting)"
        : " (0 <90s back-to-back same-file reads)"
    }`,
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
  lines.push(formatRuleOverheadBreakEvenLine(s.savedCl100k));

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
export * from "./analyze.js";
export const formatGainReport = formatGlobalGainDashboard;
export const formatProjectDetailReport = formatProjectGainDetail;
