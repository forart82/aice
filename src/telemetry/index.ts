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
import { AICE_MCP_TOOLS } from "../mcp/server.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../rules/mandatory-rules.js";
import {
  detectLanguageName,
  estimateTokens,
  formatHonestCommandTable,
  type HonestCommandRow,
} from "../tokenomics/index.js";
import {
  recordTelemetryError,
  resolveTelemetryErrorsPath,
  type TelemetryErrorEvent,
} from "./analyze.js";

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
export type CanonicalTelemetryCommand = "read" | "search" | "find" | "outline" | "splice/write";

export const CANONICAL_TELEMETRY_COMMANDS: ReadonlyArray<CanonicalTelemetryCommand> = [
  "read",
  "search",
  "find",
  "outline",
  "splice/write",
];

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
  isSearchMode?: boolean;
  wastedInputTokens?: number;
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
  isSearchMode?: boolean;
  wastedInputTokens?: number;
  preservedTriviaTokens?: number;
  structuralCompressionPct?: number;
}

export interface CommandHonestBucket extends HonestCommandRow {
  command: CanonicalTelemetryCommand;
  lossCalls: number;
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
  realisticNativeCl100k: number;
  realisticSavedCl100k: number;
  realisticSavingsPct: number;
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
  realisticNativeCl100k: number;
  realisticSavedCl100k: number;
  realisticSavingsPct: number;
  nativeO200k: number;
  aiceO200k: number;
  savedO200k: number;
}

export type EndToEndVerdict = "TOKEN-REDUCING" | "TOKEN-CONSUMING" | "NEUTRAL";

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
  realisticNativeCl100k?: number;
  realisticSavedCl100k?: number;
  realisticSavingsPct?: number;
  wrapperTaxCl100k: number;
  parallelSliceCalls: number;
  sequentialPaginationTurns: number;
  failedRetryTurns: number;
  estimatedTurns: number;
  mcpEstimatedTurns: number;
  grossRuleReplayCl100k: number;
  ruleReplayTaxCl100k: number;
  mcpSchemaBudgetCl100k: number;
  mcpSchemaTaxCl100k: number;
  paginationReplayTaxCl100k: number;
  paginationCostWeightedTaxCl100k: number;
  wastedRetryOutputTokensCl100k: number;
  failedRetryOutputPenalty4xCl100k: number;
  retryReplayTaxCl100k: number;
  retryCostWeightedTaxCl100k: number;
  totalSystemicTaxCl100k: number;
  totalCostWeightedTaxCl100k: number;
  netEndToEndSavedCl100k: number;
  costWeightedNetDeltaCl100k: number;
  spliceErrorRatePct: number;
  singleFileReadCalls: number;
  singleFileReadLossCalls: number;
  singleFileReadLossPct: number;
  endToEndVerdict: EndToEndVerdict;
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
  realisticNativeCl100k: number;
  realisticSavedCl100k: number;
  realisticSavingsPct: number;
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
    realisticNativeCl100k: number;
    realisticSavedCl100k: number;
    realisticSavingsPct: number;
    wrapperTaxCl100k: number;
    parallelSliceCalls: number;
    sequentialPaginationTurns: number;
    failedRetryTurns: number;
    estimatedTurns: number;
    mcpEstimatedTurns: number;
    grossRuleReplayCl100k: number;
    ruleReplayTaxCl100k: number;
    mcpSchemaBudgetCl100k: number;
    mcpSchemaTaxCl100k: number;
    paginationReplayTaxCl100k: number;
    paginationCostWeightedTaxCl100k: number;
    wastedRetryOutputTokensCl100k: number;
    failedRetryOutputPenalty4xCl100k: number;
    retryReplayTaxCl100k: number;
    retryCostWeightedTaxCl100k: number;
    totalSystemicTaxCl100k: number;
    totalCostWeightedTaxCl100k: number;
    netEndToEndSavedCl100k: number;
    costWeightedNetDeltaCl100k: number;
    spliceErrorRatePct: number;
    singleFileReadCalls: number;
    singleFileReadLossCalls: number;
    singleFileReadLossPct: number;
    endToEndVerdict: EndToEndVerdict;
  };
  byCommand: CommandHonestBucket[];
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
  byCommand: CommandHonestBucket[];
  byOperation: OperationBucket[];
  byLanguage: LanguageBucket[];
  projects: ProjectGainSummary[];
  projectDetail?: ProjectDetailReport;
  totalRealisticNativeCl100k?: number;
  totalRealisticSavedCl100k?: number;
  realisticSavedCl100kPct?: number;
  totalPreservedTriviaTokens?: number;
  wrapperTaxCl100k: number;
  parallelSliceCalls: number;
  sequentialPaginationTurns: number;
  failedRetryTurns: number;
  estimatedTurns: number;
  mcpEstimatedTurns: number;
  grossRuleReplayCl100k: number;
  ruleReplayTaxCl100k: number;
  mcpSchemaBudgetCl100k: number;
  mcpSchemaTaxCl100k: number;
  paginationReplayTaxCl100k: number;
  paginationCostWeightedTaxCl100k: number;
  wastedRetryOutputTokensCl100k: number;
  failedRetryOutputPenalty4xCl100k: number;
  retryReplayTaxCl100k: number;
  retryCostWeightedTaxCl100k: number;
  totalSystemicTaxCl100k: number;
  totalCostWeightedTaxCl100k: number;
  netEndToEndSavedCl100k: number;
  costWeightedNetDeltaCl100k: number;
  spliceErrorRatePct: number;
  singleFileReadCalls: number;
  singleFileReadLossCalls: number;
  singleFileReadLossPct: number;
  endToEndVerdict: EndToEndVerdict;
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
  sm?: 1;
  wi?: number;
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
 * Resolves the active telemetry JSONL file path, respecting `AICE_TELEMETRY_PATH`, `AICE_TELEMETRY_DIR`, and `AICE_HOME`.
 */
export function resolveTelemetryPath(explicitPath?: string): string {
  if (explicitPath) {
    const resolvedExplicit = path.resolve(explicitPath);
    try {
      if (fs.existsSync(resolvedExplicit) && fs.statSync(resolvedExplicit).isDirectory()) {
        return path.join(resolvedExplicit, "gains.jsonl");
      }
    } catch {
      // ignore stat errors
    }
    return resolvedExplicit;
  }
  if (process.env.AICE_TELEMETRY_PATH) {
    return path.resolve(process.env.AICE_TELEMETRY_PATH);
  }
  if (process.env.AICE_TELEMETRY_DIR) {
    return path.join(path.resolve(process.env.AICE_TELEMETRY_DIR), "gains.jsonl");
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
    process.env.AICE_TELEMETRY_DIR ||
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
 * should be suppressed unless an explicit telemetry path, `AICE_TELEMETRY_DIR`, or `AICE_HOME` is set.
 */
export function isEphemeralWorkspace(
  cwd: string | Array<string | undefined> = process.cwd(),
  explicitPath?: string,
  ...extraPaths: Array<string | undefined>
): boolean {
  if (
    explicitPath ||
    process.env.AICE_TELEMETRY_PATH ||
    process.env.AICE_TELEMETRY_DIR ||
    process.env.AICE_HOME
  ) {
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
    filePath === "<workspace-files>" ||
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

let cachedMcpSchemaJson: string | null = null;
let cachedMcpSchemaBudgetCl100k = 0;

/**
 * Returns the live BPE (`cl100k_base`) token count of `AICE_MCP_TOOLS` serialized over MCP `tools/list`.
 */
export function getMcpSchemaOverheadBudgetCl100k(): number {
  try {
    const serialized = JSON.stringify(AICE_MCP_TOOLS);
    if (serialized && serialized !== cachedMcpSchemaJson) {
      cachedMcpSchemaJson = serialized;
      cachedMcpSchemaBudgetCl100k = estimateTokens(serialized, "cl100k_base");
    }
    return cachedMcpSchemaBudgetCl100k;
  } catch {
    return cachedMcpSchemaBudgetCl100k;
  }
}

/**
 * Enforces 100% honest realistic baselines across both freshly recorded and hydrated events:
 * 1. NEVER pads `rn > n1` on any operation (eliminates anti-loss fabrication & JSON-escape inflation).
 * 2. Strips legacy `resolveRealisticSingleFileSearchBaseline` (`min(a1+350, n1+650)`) poisoned values.
 * 3. Caps `<workspace-files>`, `outline`, and `context:<directory>` against realistic `fd`/`rg` budgets,
 *    never multi-million-token whole-repository dumps.
 */
function sanitizeHonestRealisticBaseline(params: {
  operation: TelemetryOperation;
  filePath: string;
  nativeCl100k: number;
  aiceCl100k: number;
  rawRealisticNativeCl100k?: number;
  multiFilesCount: number;
  isHydrating: boolean;
}): { realisticNativeCl100k?: number; realisticSavedCl100k?: number } {
  const {
    operation,
    filePath,
    nativeCl100k,
    aiceCl100k,
    rawRealisticNativeCl100k,
    multiFilesCount,
    isHydrating,
  } = params;

  if (filePath === "<cli-error>" || nativeCl100k <= 0) {
    const rn = rawRealisticNativeCl100k !== undefined ? 0 : undefined;
    return {
      realisticNativeCl100k: rn,
      realisticSavedCl100k: rn !== undefined ? -aiceCl100k : undefined,
    };
  }

  let rn = rawRealisticNativeCl100k;
  const isDirectoryTarget = filePath === "<directory>" || filePath.endsWith("/<directory>");
  const isSingleFileContext =
    operation === "context" &&
    filePath !== "<cli-error>" &&
    filePath !== "<workspace-files>" &&
    filePath !== "<multi-context>" &&
    !isDirectoryTarget;

  // Strip legacy anti-loss fabrication written by deleted resolveRealisticSingleFileSearchBaseline
  if (
    isHydrating &&
    isSingleFileContext &&
    rn !== undefined &&
    aiceCl100k > nativeCl100k &&
    rn === Math.min(aiceCl100k + 350, nativeCl100k + 650)
  ) {
    rn = nativeCl100k;
  }

  // Repo-dump de-inflation ONLY triggers when rn === undefined || rn >= nativeCl100k
  // (unscoped whole-repo dumps). When rn !== undefined && rn < nativeCl100k, preserve rn 1:1!
  if (rn === undefined || rn >= nativeCl100k) {
    if (filePath === "<workspace-files>") {
      if (aiceCl100k <= 0) {
        rn = 0;
      } else if (multiFilesCount > 0) {
        rn = Math.min(nativeCl100k, multiFilesCount * 10);
      } else {
        rn = Math.min(nativeCl100k, aiceCl100k);
      }
    } else if (operation === "outline" && (isDirectoryTarget || multiFilesCount > 1)) {
      if (aiceCl100k <= 0) {
        rn = 0;
      } else {
        rn = Math.min(nativeCl100k, (multiFilesCount || 20) * 45);
      }
    } else if (operation === "context" && isDirectoryTarget) {
      if (aiceCl100k <= 0) {
        rn = 0;
      } else {
        rn = Math.min(nativeCl100k, Math.min((multiFilesCount || 12) * 80, 4_500));
      }
    }
  }
  // Universal anti-padding invariant: realistic native baseline NEVER exceeds raw unscoped native tokens
  if (rn !== undefined && rn > nativeCl100k) {
    rn = nativeCl100k;
  }

  const realisticSavedCl100k = rn !== undefined ? rn - aiceCl100k : undefined;
  return { realisticNativeCl100k: rn, realisticSavedCl100k };
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
    ...(event.isSearchMode ? { sm: 1 } : {}),
    ...(event.wastedInputTokens && event.wastedInputTokens > 0
      ? { wi: event.wastedInputTokens }
      : {}),
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
  const isSearchMode = Boolean(obj.sm ?? obj.isSearchMode);
  const wastedInputTokens =
    typeof obj.wi === "number"
      ? obj.wi
      : typeof obj.wastedInputTokens === "number"
        ? obj.wastedInputTokens
        : undefined;

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

  const rawRealisticNativeCl100k =
    typeof obj.rn === "number"
      ? obj.rn
      : typeof obj.realisticNativeCl100k === "number"
        ? obj.realisticNativeCl100k
        : typeof obj.realisticNativeText === "string"
          ? estimateTokens(obj.realisticNativeText, "cl100k_base")
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

  const multiFilesCount = multiFiles
    ? multiFiles.length
    : typeof obj.multiFiles === "number"
      ? obj.multiFiles
      : typeof obj.mf === "number"
        ? obj.mf
        : 0;

  const { realisticNativeCl100k, realisticSavedCl100k } = sanitizeHonestRealisticBaseline({
    operation,
    filePath,
    nativeCl100k,
    aiceCl100k,
    rawRealisticNativeCl100k,
    multiFilesCount,
    isHydrating: true,
  });

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
    ...(isSearchMode ? { isSearchMode: true } : {}),
    ...(wastedInputTokens !== undefined && wastedInputTokens > 0 ? { wastedInputTokens } : {}),
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
      : isDir || filePath.endsWith("<directory>") || filePath === "<workspace-files>"
        ? "Multi-File"
        : detectLanguageName(resolvedTarget.replace(/\.aice$/, "")));

  const surface: TelemetrySurface = input.surface ?? "cli";
  const agent = input.agent ?? detectCallerAgent(surface);
  const category = getCategoryForOperation(input.operation);
  const idiomsUsed = Boolean(input.idiomsUsed);
  const isSearchMode = Boolean(input.isSearchMode);
  const wastedInputTokens =
    input.wastedInputTokens !== undefined && input.wastedInputTokens > 0
      ? Math.round(input.wastedInputTokens)
      : undefined;

  const nativeChars = input.nativeChars ?? input.nativeText.length;
  const aiceChars = input.aiceChars ?? input.aiceText.length;
  const savedChars = nativeChars - aiceChars;

  const nativeCl100k = input.nativeCl100k ?? estimateTokens(input.nativeText, "cl100k_base");
  const baseAiceCl100k = input.aiceCl100k ?? estimateTokens(input.aiceText, "cl100k_base");
  const aiceCl100k =
    filePath === "<cli-error>" && wastedInputTokens !== undefined
      ? baseAiceCl100k + wastedInputTokens
      : baseAiceCl100k;
  const savedCl100k = nativeCl100k - aiceCl100k;

  const nativeO200k = input.nativeO200k ?? estimateTokens(input.nativeText, "o200k_base");
  const baseAiceO200k = input.aiceO200k ?? estimateTokens(input.aiceText, "o200k_base");
  const aiceO200k =
    filePath === "<cli-error>" && wastedInputTokens !== undefined
      ? baseAiceO200k + wastedInputTokens
      : baseAiceO200k;
  const savedO200k = nativeO200k - aiceO200k;

  const contentHash = computeContentHash(
    projectRoot,
    filePath,
    input.operation,
    nativeChars,
    aiceChars,
  );

  const rawRealisticNativeCl100k =
    input.realisticNativeCl100k ??
    (input.realisticNativeText !== undefined
      ? estimateTokens(input.realisticNativeText, "cl100k_base")
      : undefined);

  const multiFilesCount = input.multiFiles ? input.multiFiles.length : 0;
  const { realisticNativeCl100k, realisticSavedCl100k } = sanitizeHonestRealisticBaseline({
    operation: input.operation,
    filePath,
    nativeCl100k,
    aiceCl100k,
    rawRealisticNativeCl100k,
    multiFilesCount,
    isHydrating: false,
  });

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
    ...(isSearchMode ? { isSearchMode: true } : {}),
    ...(wastedInputTokens !== undefined ? { wastedInputTokens } : {}),
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

function inferCliFailureOperation(rawArgs: ReadonlyArray<string>): TelemetryOperation {
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

/**
 * Records a CLI invocation failure to both `gains.jsonl` (`<cli-error>`) and `errors.jsonl`
 * with optional `wastedInputTokens` tracking, while `computeProjectSystemicEconomics`
 * deduplicates the paired records so each failure is counted once.
 */
export function recordCliFailureTelemetry(
  errorMessage: string,
  explicitOperation?: TelemetryOperation,
  explicitTargetPath?: string,
  wastedInputTokens?: number,
  options?: {
    rawArgs?: ReadonlyArray<string>;
    projectRoot?: string;
    telemetryPath?: string;
  },
): void {
  const rawArgs = options?.rawArgs ?? process.argv.slice(2);
  const invokedCmd = `aice ${rawArgs.join(" ")}`.trim();
  const cleanError = errorMessage.trim();
  const op = explicitOperation ?? inferCliFailureOperation(rawArgs);
  const isSearchMode = rawArgs.some((t) => t === "search" || t === "grep" || t === "--search");
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
  const cwd = process.cwd();
  const resolvedTarget = cleanedTarget ? path.resolve(cwd, cleanedTarget) : cwd;
  let isDir = false;
  try {
    if (fs.existsSync(resolvedTarget) && fs.statSync(resolvedTarget).isDirectory()) {
      isDir = true;
    }
  } catch {
    // ignore
  }
  const stopAt =
    resolvedTarget === cwd || resolvedTarget.startsWith(`${cwd}${path.sep}`) ? cwd : undefined;
  const effectiveProjectRoot = path.resolve(
    options?.projectRoot ??
      findProjectRoot(isDir ? resolvedTarget : path.dirname(resolvedTarget), stopAt),
  );
  const nowIso = new Date().toISOString();

  recordTelemetryEvent({
    targetPath: resolvedTarget,
    projectRoot: effectiveProjectRoot,
    filePath: "<cli-error>",
    timestamp: nowIso,
    operation: op,
    surface: "cli",
    isSearchMode,
    wastedInputTokens,
    nativeText: "",
    aiceText: cleanError ? `${invokedCmd}\n${cleanError}` : invokedCmd,
    telemetryPath: options?.telemetryPath,
  });
  recordTelemetryError({
    targetPath: cleanedTarget ? resolvedTarget : undefined,
    projectRoot: effectiveProjectRoot,
    operation: op,
    surface: "cli",
    errorMessage: cleanError || invokedCmd,
    wastedInputTokens,
    telemetryPath: options?.telemetryPath,
  });
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
 * Resets/clears BOTH the `gains.jsonl` telemetry history ledger and its sibling `errors.jsonl` ledger.
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
  const errPaths = new Set<string>([
    resolveTelemetryErrorsPath(explicitPath),
    path.join(path.dirname(ledgerPath), "errors.jsonl"),
    `${ledgerPath}.errors.jsonl`,
  ]);
  for (const ep of errPaths) {
    try {
      if (fs.existsSync(ep)) {
        fs.unlinkSync(ep);
      }
    } catch {
      // ignore
    }
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

export function isExplicitProjectPathQuery(query: string): boolean {
  const t = query.trim();
  return (
    t === "." ||
    t === ".." ||
    path.isAbsolute(t) ||
    t.startsWith("./") ||
    t.startsWith("../") ||
    t.includes("/") ||
    t.includes("\\")
  );
}

export function hasDirectWorkspaceMarker(dirPath: string): boolean {
  return (
    fs.existsSync(path.join(dirPath, "aice.config.json")) ||
    fs.existsSync(path.join(dirPath, ".aice-idioms.json")) ||
    fs.existsSync(path.join(dirPath, "package.json")) ||
    fs.existsSync(path.join(dirPath, "composer.json")) ||
    fs.existsSync(path.join(dirPath, "Cargo.toml")) ||
    fs.existsSync(path.join(dirPath, "go.mod")) ||
    fs.existsSync(path.join(dirPath, "pyproject.toml")) ||
    fs.existsSync(path.join(dirPath, ".git"))
  );
}

/**
 * Resolves a project query string (`"."`, explicit path, or bare project name like `"skeleton"`)
 * without ever resolving a bare project name inside `process.cwd()` and hijacking to the cwd repo.
 */
export function resolveBareOrPathProjectCandidate(rawQuery: string): string {
  const trimmed = rawQuery.trim();
  if (!trimmed || trimmed === ".") {
    return findProjectRoot(process.cwd());
  }
  if (isExplicitProjectPathQuery(trimmed)) {
    const resolved = path.resolve(trimmed);
    if (fs.existsSync(resolved)) {
      const dirCand = fs.statSync(resolved).isDirectory() ? resolved : path.dirname(resolved);
      if (hasDirectWorkspaceMarker(dirCand)) {
        return dirCand;
      }
      const discovered = findProjectRoot(dirCand, dirCand);
      const discoveredInsideCwdTmp =
        discovered === process.cwd() && dirCand.startsWith(`${os.tmpdir()}${path.sep}`);
      return discoveredInsideCwdTmp ? dirCand : discovered;
    }
    return resolved;
  }

  // Bare project name (e.g. "skeleton"): NEVER hijack to process.cwd() via path.resolve(trimmed)!
  const cwdProjectRoot = findProjectRoot(process.cwd());
  if (path.basename(cwdProjectRoot).toLowerCase() === trimmed.toLowerCase()) {
    return cwdProjectRoot;
  }
  const directChild = path.resolve(trimmed);
  if (
    directChild !== cwdProjectRoot &&
    fs.existsSync(directChild) &&
    fs.statSync(directChild).isDirectory() &&
    hasDirectWorkspaceMarker(directChild)
  ) {
    return directChild;
  }
  const siblingCand = path.join(path.dirname(cwdProjectRoot), trimmed);
  if (fs.existsSync(siblingCand) && fs.statSync(siblingCand).isDirectory()) {
    return siblingCand;
  }
  const homeDevCand = path.join(os.homedir(), "dev", trimmed);
  if (fs.existsSync(homeDevCand) && fs.statSync(homeDevCand).isDirectory()) {
    return homeDevCand;
  }
  return siblingCand;
}

export function matchesProjectFilter(event: TelemetryEvent, filterStr: string): boolean {
  const trimmed = filterStr.trim();
  if (!trimmed) return true;
  if (trimmed === ".") {
    const cwdRoot = findProjectRoot(process.cwd());
    return path.resolve(event.projectRoot) === path.resolve(cwdRoot);
  }
  if (!isExplicitProjectPathQuery(trimmed)) {
    return (
      event.projectName.toLowerCase() === trimmed.toLowerCase() ||
      path.basename(event.projectRoot).toLowerCase() === trimmed.toLowerCase()
    );
  }

  const resolvedCandidate = path.resolve(trimmed);
  const resolvedEventRoot = path.resolve(event.projectRoot);
  if (resolvedEventRoot === resolvedCandidate) {
    return true;
  }
  if (fs.existsSync(resolvedCandidate)) {
    const dirCand = fs.statSync(resolvedCandidate).isDirectory()
      ? resolvedCandidate
      : path.dirname(resolvedCandidate);
    const candidateRoot = hasDirectWorkspaceMarker(dirCand)
      ? dirCand
      : path.resolve(findProjectRoot(dirCand, dirCand));
    return resolvedEventRoot === candidateRoot;
  }
  return resolvedCandidate.startsWith(`${resolvedEventRoot}${path.sep}`);
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

export interface ProjectSystemicEconomics {
  byCommand: CommandHonestBucket[];
  wrapperTaxCl100k: number;
  parallelSliceCalls: number;
  sequentialPaginationTurns: number;
  failedRetryTurns: number;
  estimatedTurns: number;
  mcpEstimatedTurns: number;
  grossRuleReplayCl100k: number;
  ruleReplayTaxCl100k: number;
  mcpSchemaBudgetCl100k: number;
  mcpSchemaTaxCl100k: number;
  paginationReplayTaxCl100k: number;
  paginationCostWeightedTaxCl100k: number;
  wastedRetryOutputTokensCl100k: number;
  failedRetryOutputPenalty4xCl100k: number;
  retryReplayTaxCl100k: number;
  retryCostWeightedTaxCl100k: number;
  totalSystemicTaxCl100k: number;
  totalCostWeightedTaxCl100k: number;
  netEndToEndSavedCl100k: number;
  costWeightedNetDeltaCl100k: number;
  spliceErrorRatePct: number;
  singleFileReadCalls: number;
  singleFileReadLossCalls: number;
  singleFileReadLossPct: number;
  endToEndVerdict: EndToEndVerdict;
  realisticNativeCl100k: number;
  realisticSavedCl100k: number;
}

export const PARALLEL_SLICE_GAP_MS = 12_000;
export const HEALTHY_SPLICE_ERR_PCT_MAX = 5.0;

function classifyEventCommand(ev: TelemetryEvent): CanonicalTelemetryCommand {
  if (ev.filePath === "<workspace-files>") return "find";
  if (ev.isSearchMode) return "search";
  if (ev.category === "write") return "splice/write";
  if (ev.operation === "outline") return "outline";
  return "read";
}

function classifyErrorCommand(err: TelemetryErrorEvent): CanonicalTelemetryCommand {
  const msg = err.errorMessage || "";
  if (/\baice\s+(?:find|tree)\b/i.test(msg)) return "find";
  if (/\baice\s+(?:search|grep)\b/i.test(msg) || /--search\b/.test(msg)) return "search";
  if (getCategoryForOperation(err.operation) === "write") return "splice/write";
  if (err.operation === "outline") return "outline";
  return "read";
}

interface ReconciledFailureRecord {
  timestampMs: number;
  operation: TelemetryOperation;
  surface: TelemetrySurface;
  command: CanonicalTelemetryCommand;
  aiceTokensInLedger: number;
  wastedInputTokens?: number;
  isUnmatchedErrorOnly: boolean;
}

function reconcileProjectFailures(
  sortedEvents: ReadonlyArray<TelemetryEvent>,
  errorInput: number | ReadonlyArray<TelemetryErrorEvent>,
): {
  failures: ReconciledFailureRecord[];
  unmatchedErrors: TelemetryErrorEvent[];
} {
  const cliErrorEvents = sortedEvents.filter((e) => e.filePath === "<cli-error>");

  if (typeof errorInput === "number") {
    const failures: ReconciledFailureRecord[] = cliErrorEvents.map((ev) => ({
      timestampMs: Date.parse(ev.timestamp) || 0,
      operation: ev.operation,
      surface: ev.surface,
      command: classifyEventCommand(ev),
      aiceTokensInLedger: ev.aiceCl100k,
      wastedInputTokens: ev.wastedInputTokens,
      isUnmatchedErrorOnly: false,
    }));
    const extraCount = Math.max(0, errorInput - cliErrorEvents.length);
    for (let i = 0; i < extraCount; i++) {
      failures.push({
        timestampMs: 0,
        operation: "splice",
        surface: "cli",
        command: "splice/write",
        aiceTokensInLedger: 0,
        isUnmatchedErrorOnly: true,
      });
    }
    return { failures, unmatchedErrors: [] };
  }

  const sortedErrs = [...errorInput].sort(
    (a, b) => (Date.parse(a.timestamp) || 0) - (Date.parse(b.timestamp) || 0),
  );
  const usedErrIndices = new Set<number>();
  const failures: ReconciledFailureRecord[] = [];

  for (const cliEv of cliErrorEvents) {
    const evTs = Date.parse(cliEv.timestamp) || 0;
    let matchedIdx = -1;
    for (let i = 0; i < sortedErrs.length; i++) {
      if (usedErrIndices.has(i)) continue;
      const err = sortedErrs[i];
      if (err?.surface !== "cli" || err.operation !== cliEv.operation) continue;
      const errTs = Date.parse(err.timestamp) || 0;
      if (evTs === 0 || errTs === 0 || Math.abs(evTs - errTs) <= 5_000) {
        matchedIdx = i;
        break;
      }
    }
    let mergedWasted = cliEv.wastedInputTokens;
    let cmd = classifyEventCommand(cliEv);
    if (matchedIdx >= 0) {
      usedErrIndices.add(matchedIdx);
      const matchedErr = sortedErrs[matchedIdx];
      if (
        matchedErr?.wastedInputTokens &&
        (!mergedWasted || matchedErr.wastedInputTokens > mergedWasted)
      ) {
        mergedWasted = matchedErr.wastedInputTokens;
      }
      if (cmd === "read") {
        const inferred = classifyErrorCommand(matchedErr);
        if (inferred !== "read") cmd = inferred;
      }
    }
    failures.push({
      timestampMs: evTs,
      operation: cliEv.operation,
      surface: cliEv.surface,
      command: cmd,
      aiceTokensInLedger: cliEv.aiceCl100k,
      wastedInputTokens: mergedWasted,
      isUnmatchedErrorOnly: false,
    });
  }

  const unmatchedErrors: TelemetryErrorEvent[] = [];
  for (let i = 0; i < sortedErrs.length; i++) {
    if (usedErrIndices.has(i)) continue;
    const err = sortedErrs[i];
    if (!err) continue;
    unmatchedErrors.push(err);
    failures.push({
      timestampMs: Date.parse(err.timestamp) || 0,
      operation: err.operation,
      surface: err.surface,
      command: classifyErrorCommand(err),
      aiceTokensInLedger: 0,
      wastedInputTokens: err.wastedInputTokens,
      isUnmatchedErrorOnly: true,
    });
  }

  return { failures, unmatchedErrors };
}

function createEmptyCommandMap(): Map<CanonicalTelemetryCommand, CommandHonestBucket> {
  const m = new Map<CanonicalTelemetryCommand, CommandHonestBucket>();
  for (const cmd of CANONICAL_TELEMETRY_COMMANDS) {
    m.set(cmd, {
      command: cmd,
      calls: 0,
      winCalls: 0,
      lossCalls: 0,
      winPct: 0,
      errorCalls: 0,
      errPct: 0,
      realisticNativeCl100k: 0,
      aiceCl100k: 0,
      netDeltaCl100k: 0,
      deltaPct: 0,
      rawNativeRefCl100k: 0,
    });
  }
  return m;
}

function finalizeCommandBuckets(
  cmdMap: Map<CanonicalTelemetryCommand, CommandHonestBucket>,
): CommandHonestBucket[] {
  const rows: CommandHonestBucket[] = [];
  for (const cmd of CANONICAL_TELEMETRY_COMMANDS) {
    const b = cmdMap.get(cmd);
    if (!b) continue;
    b.netDeltaCl100k = b.realisticNativeCl100k - b.aiceCl100k;
    b.deltaPct = calcPct(b.netDeltaCl100k, b.realisticNativeCl100k);
    b.winPct = b.calls > 0 ? Number(((b.winCalls / b.calls) * 100).toFixed(1)) : 0;
    b.errPct = b.calls > 0 ? Number(((b.errorCalls / b.calls) * 100).toFixed(1)) : 0;
    rows.push(b);
  }
  return rows;
}

export function computeProjectSystemicEconomics(
  projectEvents: TelemetryEvent[],
  errorsOrCount: number | ReadonlyArray<TelemetryErrorEvent> = 0,
): ProjectSystemicEconomics {
  const sorted = [...projectEvents].sort((a, b) => {
    const tA = Date.parse(a.timestamp) || 0;
    const tB = Date.parse(b.timestamp) || 0;
    return tA - tB;
  });

  const { failures, unmatchedErrors } = reconcileProjectFailures(sorted, errorsOrCount);
  const cmdMap = createEmptyCommandMap();

  let wrapperTaxCl100k = 0;
  let parallelSliceCalls = 0;
  let sequentialPaginationTurns = 0;
  let realisticNativeCl100k = 0;
  let realisticSavedCl100k = 0;
  let readNonErrorSavedCl100k = 0;
  let writeNonErrorSavedCl100k = 0;
  let singleFileReadCalls = 0;
  let singleFileReadLossCalls = 0;

  const lastReadTsByFile = new Map<string, number>();
  let lastWriteTs = -Infinity;
  let prevWrapperTs = -Infinity;
  let prevWrapperSurface: TelemetrySurface | null = null;
  let prevWrapperWasWrite = false;
  const mcpTimestamps: number[] = [];

  for (const ev of sorted) {
    const evTs = Date.parse(ev.timestamp) || 0;
    const evIsWrite =
      ev.filePath !== "<cli-error>" &&
      (ev.operation === "splice" ||
        ev.operation === "create" ||
        ev.operation === "patch" ||
        ev.category === "write");
    const isSameBatchWriteTurn =
      evIsWrite &&
      prevWrapperWasWrite &&
      prevWrapperSurface === ev.surface &&
      evTs - prevWrapperTs >= 0 &&
      evTs - prevWrapperTs < 50;
    if (!isSameBatchWriteTurn) {
      wrapperTaxCl100k += ev.surface === "mcp" ? 45 : 70;
    }
    prevWrapperTs = evTs;
    prevWrapperSurface = ev.surface;
    prevWrapperWasWrite = evIsWrite;
    if (ev.surface === "mcp") {
      mcpTimestamps.push(evTs);
    }

    const isCliErr = ev.filePath === "<cli-error>";
    const realNat = isCliErr ? 0 : (ev.realisticNativeCl100k ?? ev.nativeCl100k);
    const realSaved = isCliErr
      ? -ev.aiceCl100k
      : (ev.realisticSavedCl100k ?? realNat - ev.aiceCl100k);
    realisticNativeCl100k += realNat;
    realisticSavedCl100k += realSaved;

    const cmd = classifyEventCommand(ev);
    const bucket = cmdMap.get(cmd);
    if (!bucket) continue;
    bucket.calls++;
    bucket.realisticNativeCl100k += realNat;
    bucket.aiceCl100k += ev.aiceCl100k;
    bucket.rawNativeRefCl100k += ev.nativeCl100k;

    if (isCliErr) {
      bucket.errorCalls++;
    } else {
      if (ev.aiceCl100k <= realNat) {
        bucket.winCalls++;
      } else {
        bucket.lossCalls++;
      }
      if (ev.category === "read") {
        readNonErrorSavedCl100k += realSaved;
        const isSingleFile =
          !ev.filePath.startsWith("<") &&
          !ev.filePath.endsWith("/<directory>") &&
          (!ev.multiFiles || ev.multiFiles.length <= 1);
        if (isSingleFile) {
          singleFileReadCalls++;
          if (ev.aiceCl100k > realNat) {
            singleFileReadLossCalls++;
          }
        }
      } else {
        writeNonErrorSavedCl100k += realSaved;
      }
    }

    const currentTs = Date.parse(ev.timestamp) || 0;
    const isWrite =
      ev.operation === "splice" ||
      ev.operation === "create" ||
      ev.operation === "patch" ||
      ev.category === "write";

    if (isWrite && !isCliErr) {
      lastWriteTs = currentTs;
    }

    const isRead =
      !isCliErr &&
      (ev.operation === "context" ||
        (ev.operation as string) === "read" ||
        (ev.category === "read" && ev.operation !== "outline"));

    if (isRead) {
      const targetFiles =
        ev.filePath === "<multi-context>" && Array.isArray(ev.multiFiles)
          ? ev.multiFiles
          : [ev.filePath];

      let callMatchedParallel = false;
      let callMatchedPagination = false;

      for (const f of targetFiles) {
        if (!f || (f.startsWith("<") && f !== "<stdin>")) continue;
        const priorReadTs = lastReadTsByFile.get(f);
        if (priorReadTs !== undefined) {
          const deltaMs = currentTs - priorReadTs;
          if (deltaMs >= 0 && deltaMs < PARALLEL_SLICE_GAP_MS) {
            callMatchedParallel = true;
          } else if (deltaMs >= PARALLEL_SLICE_GAP_MS && deltaMs <= 180_000) {
            if (lastWriteTs < priorReadTs) {
              callMatchedPagination = true;
            }
          }
        }
        lastReadTsByFile.set(f, currentTs);
      }

      if (callMatchedParallel) parallelSliceCalls++;
      if (callMatchedPagination) sequentialPaginationTurns++;
    }
  }

  for (const uErr of unmatchedErrors) {
    wrapperTaxCl100k += uErr.surface === "mcp" ? 45 : 70;
    if (uErr.surface === "mcp") {
      mcpTimestamps.push(Date.parse(uErr.timestamp) || 0);
    }
    const cmd = classifyErrorCommand(uErr);
    const bucket = cmdMap.get(cmd);
    if (bucket) {
      bucket.calls++;
      bucket.errorCalls++;
      if (uErr.wastedInputTokens && uErr.wastedInputTokens > 0) {
        bucket.aiceCl100k += uErr.wastedInputTokens;
        realisticSavedCl100k -= uErr.wastedInputTokens;
      }
    }
  }

  const byCommand = finalizeCommandBuckets(cmdMap);

  const allTurnTimestamps = [
    ...sorted.map((e) => Date.parse(e.timestamp) || 0),
    ...unmatchedErrors.map((e) => Date.parse(e.timestamp) || 0),
  ].sort((a, b) => a - b);

  const countTurnsFromTimestamps = (tsList: number[]): number => {
    if (tsList.length === 0) return 0;
    let turns = 1;
    for (let i = 1; i < tsList.length; i++) {
      if ((tsList[i] ?? 0) - (tsList[i - 1] ?? 0) >= PARALLEL_SLICE_GAP_MS) {
        turns++;
      }
    }
    return turns;
  };

  const estimatedTurns = countTurnsFromTimestamps(allTurnTimestamps);
  mcpTimestamps.sort((a, b) => a - b);
  const mcpEstimatedTurns = countTurnsFromTimestamps(mcpTimestamps);

  const failedRetryTurns = failures.length;
  let wastedRetryOutputTokensCl100k = 0;
  for (const fail of failures) {
    if (fail.wastedInputTokens && fail.wastedInputTokens > 0) {
      wastedRetryOutputTokensCl100k += fail.wastedInputTokens * 2;
    } else if (fail.command === "splice/write") {
      wastedRetryOutputTokensCl100k += Math.max(fail.aiceTokensInLedger * 2, 450);
    } else {
      wastedRetryOutputTokensCl100k += Math.max(fail.aiceTokensInLedger, 120);
    }
  }
  const failedRetryOutputPenalty4xCl100k = wastedRetryOutputTokensCl100k * 4;

  const ruleBudgetCl100k = getRuleOverheadBudgetCl100k();
  const grossRuleReplayCl100k = ruleBudgetCl100k * estimatedTurns;
  // ~90% prompt-cache hit: 1x Turn 1 + 0.1x subsequent cached turns
  const ruleReplayTaxCl100k =
    estimatedTurns === 0
      ? 0
      : ruleBudgetCl100k + Math.round(ruleBudgetCl100k * Math.max(0, estimatedTurns - 1) * 0.1);

  const mcpSchemaBudgetCl100k = getMcpSchemaOverheadBudgetCl100k();
  const mcpSchemaTaxCl100k =
    mcpEstimatedTurns === 0
      ? 0
      : mcpSchemaBudgetCl100k +
        Math.round(mcpSchemaBudgetCl100k * Math.max(0, mcpEstimatedTurns - 1) * 0.1);

  const paginationReplayTaxCl100k = sequentialPaginationTurns * 8_500;
  const paginationCostWeightedTaxCl100k = sequentialPaginationTurns * (850 + 80 * 4);

  const retryReplayTaxCl100k =
    failedRetryTurns === 0 ? 0 : failedRetryTurns * 8_500 + wastedRetryOutputTokensCl100k;
  const retryCostWeightedTaxCl100k =
    failedRetryTurns === 0 ? 0 : failedRetryTurns * 850 + failedRetryOutputPenalty4xCl100k;

  const totalSystemicTaxCl100k =
    wrapperTaxCl100k +
    ruleReplayTaxCl100k +
    mcpSchemaTaxCl100k +
    paginationReplayTaxCl100k +
    retryReplayTaxCl100k;

  const totalCostWeightedTaxCl100k =
    wrapperTaxCl100k +
    ruleReplayTaxCl100k +
    mcpSchemaTaxCl100k +
    paginationCostWeightedTaxCl100k +
    retryCostWeightedTaxCl100k;

  const netEndToEndSavedCl100k = realisticSavedCl100k - totalSystemicTaxCl100k;
  const costWeightedGrossSavedCl100k = readNonErrorSavedCl100k + writeNonErrorSavedCl100k * 4;
  const costWeightedNetDeltaCl100k = costWeightedGrossSavedCl100k - totalCostWeightedTaxCl100k;

  const spliceBucket = byCommand.find((c) => c.command === "splice/write");
  const spliceErrorRatePct = spliceBucket?.errPct ?? 0;
  const isSpliceHealthy =
    (spliceBucket?.calls ?? 0) === 0 || spliceErrorRatePct <= HEALTHY_SPLICE_ERR_PCT_MAX;
  const singleFileReadLossPct =
    singleFileReadCalls > 0
      ? Number(((singleFileReadLossCalls / singleFileReadCalls) * 100).toFixed(1))
      : 0;

  let endToEndVerdict: EndToEndVerdict = "NEUTRAL";
  if (sorted.length === 0 && failedRetryTurns === 0) {
    endToEndVerdict = "NEUTRAL";
  } else if (netEndToEndSavedCl100k > 0 && costWeightedNetDeltaCl100k > 0 && isSpliceHealthy) {
    endToEndVerdict = "TOKEN-REDUCING";
  } else if (
    netEndToEndSavedCl100k === 0 &&
    costWeightedNetDeltaCl100k === 0 &&
    failedRetryTurns === 0
  ) {
    endToEndVerdict = "NEUTRAL";
  } else {
    endToEndVerdict = "TOKEN-CONSUMING";
  }

  return {
    byCommand,
    wrapperTaxCl100k,
    parallelSliceCalls,
    sequentialPaginationTurns,
    failedRetryTurns,
    estimatedTurns,
    mcpEstimatedTurns,
    grossRuleReplayCl100k,
    ruleReplayTaxCl100k,
    mcpSchemaBudgetCl100k,
    mcpSchemaTaxCl100k,
    paginationReplayTaxCl100k,
    paginationCostWeightedTaxCl100k,
    wastedRetryOutputTokensCl100k,
    failedRetryOutputPenalty4xCl100k,
    retryReplayTaxCl100k,
    retryCostWeightedTaxCl100k,
    totalSystemicTaxCl100k,
    totalCostWeightedTaxCl100k,
    netEndToEndSavedCl100k,
    costWeightedNetDeltaCl100k,
    spliceErrorRatePct,
    singleFileReadCalls,
    singleFileReadLossCalls,
    singleFileReadLossPct,
    endToEndVerdict,
    realisticNativeCl100k,
    realisticSavedCl100k,
  };
}

function loadNonBenignErrorEventsByProject(
  ledgerPath: string,
  dropEphemeralRoots = false,
): Map<string, TelemetryErrorEvent[]> {
  const byRoot = new Map<string, TelemetryErrorEvent[]>();
  const candidates: string[] = [
    path.join(path.dirname(ledgerPath), "errors.jsonl"),
    `${ledgerPath}.errors.jsonl`,
  ];
  if (process.env.AICE_TELEMETRY_ERRORS_PATH) {
    candidates.unshift(path.resolve(process.env.AICE_TELEMETRY_ERRORS_PATH));
  }
  const seenFiles = new Set<string>();
  for (const cand of candidates) {
    const resolvedCand = path.resolve(cand);
    if (seenFiles.has(resolvedCand)) continue;
    seenFiles.add(resolvedCand);
    if (!fs.existsSync(resolvedCand)) continue;
    try {
      const raw = fs.readFileSync(resolvedCand, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as TelemetryErrorEvent;
          if (parsed && typeof parsed.errorMessage === "string") {
            const isBenign = /benign|warning|notice/i.test(parsed.errorMessage);
            if (!isBenign) {
              const rootKey = parsed.projectRoot ? path.resolve(parsed.projectRoot) : "<unknown>";
              if (
                dropEphemeralRoots &&
                rootKey !== "<unknown>" &&
                isEphemeralPath(rootKey, false)
              ) {
                continue;
              }
              const arr = byRoot.get(rootKey) ?? [];
              arr.push(parsed);
              byRoot.set(rootKey, arr);
            }
          }
        } catch {
          // ignore malformed line
        }
      }
    } catch {
      // ignore read error
    }
  }
  return byRoot;
}

function getNonBenignErrorsForProject(
  errorsByRoot: Map<string, TelemetryErrorEvent[]>,
  projectRoot: string,
  projectName: string,
): TelemetryErrorEvent[] {
  const normRoot = path.resolve(projectRoot);
  const exact = errorsByRoot.get(normRoot);
  if (exact && exact.length > 0) {
    return exact;
  }
  for (const [k, list] of errorsByRoot.entries()) {
    if (path.basename(k).toLowerCase() === projectName.toLowerCase()) {
      return list;
    }
  }
  return [];
}

function buildProjectDetail(
  projectRoot: string,
  projectEvents: TelemetryEvent[],
  projectErrors: ReadonlyArray<TelemetryErrorEvent> = [],
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
    const realNat =
      ev.filePath === "<cli-error>" ? 0 : (ev.realisticNativeCl100k ?? ev.nativeCl100k);
    const realSaved =
      ev.filePath === "<cli-error>"
        ? -ev.aiceCl100k
        : (ev.realisticSavedCl100k ?? realNat - ev.aiceCl100k);

    if (ev.category === "read") {
      readCalls++;
      readSavedCl100k += realSaved;
      readSavedO200k += ev.savedO200k;
    } else {
      writeCalls++;
      writeSavedCl100k += realSaved;
      writeSavedO200k += ev.savedO200k;
    }
    if (ev.idiomsUsed || ev.operation === "idioms_apply" || ev.operation === "idioms_update") {
      idiomCalls++;
      idiomSavedCl100k += realSaved;
      idiomSavedO200k += ev.savedO200k;
    }
    if (realSaved <= 0) {
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
      realisticNativeCl100k: 0,
      realisticSavedCl100k: 0,
      realisticSavingsPct: 0,
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
    existingOp.realisticNativeCl100k += realNat;
    existingOp.realisticSavedCl100k += realSaved;
    existingOp.nativeO200k += ev.nativeO200k;
    existingOp.aiceO200k += ev.aiceO200k;
    existingOp.savedO200k += ev.savedO200k;
    existingOp.savingsPct = calcPct(existingOp.savedCl100k, existingOp.nativeCl100k);
    existingOp.realisticSavingsPct = calcPct(
      existingOp.realisticSavedCl100k,
      existingOp.realisticNativeCl100k,
    );
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
      realisticNativeCl100k: 0,
      realisticSavedCl100k: 0,
      realisticSavingsPct: 0,
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
    existingFile.realisticNativeCl100k += realNat;
    existingFile.realisticSavedCl100k += realSaved;
    existingFile.nativeO200k += ev.nativeO200k;
    existingFile.aiceO200k += ev.aiceO200k;
    existingFile.savedO200k += ev.savedO200k;
    existingFile.savingsPct = calcPct(existingFile.savedCl100k, existingFile.nativeCl100k);
    existingFile.realisticSavingsPct = calcPct(
      existingFile.realisticSavedCl100k,
      existingFile.realisticNativeCl100k,
    );
    fileMap.set(ev.filePath, existingFile);
  }

  const econ = computeProjectSystemicEconomics(projectEvents, projectErrors);
  const { byCommand, ...econMetrics } = econ;

  const byOperation = Array.from(opMap.values()).sort(
    (a, b) => b.realisticSavedCl100k - a.realisticSavedCl100k || b.calls - a.calls,
  );
  const topFiles = Array.from(fileMap.values()).sort(
    (a, b) => a.realisticSavedCl100k - b.realisticSavedCl100k || b.calls - a.calls,
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
      ...computeRuleBreakEvenMetrics(econMetrics.realisticSavedCl100k),
      ...econMetrics,
      realisticSavingsPct: calcPct(
        econMetrics.realisticSavedCl100k,
        econMetrics.realisticNativeCl100k,
      ),
    },
    byCommand,
    byOperation,
    topFiles,
    recentOperations,
  };
}

function computeRuleBreakEvenMetrics(savedTokensCl100k: number): {
  ruleBudgetCl100k: number;
  netAfterRuleBudgetCl100k: number;
  ruleBreakEvenMultiple: number;
  ruleBreakEvenReached: boolean;
} {
  const ruleBudgetCl100k = getRuleOverheadBudgetCl100k();
  const netAfterRuleBudgetCl100k = savedTokensCl100k - ruleBudgetCl100k;
  const ruleBreakEvenMultiple =
    ruleBudgetCl100k > 0 ? Number((savedTokensCl100k / ruleBudgetCl100k).toFixed(2)) : 0;
  const ruleBreakEvenReached = savedTokensCl100k >= ruleBudgetCl100k;
  return {
    ruleBudgetCl100k,
    netAfterRuleBudgetCl100k,
    ruleBreakEvenMultiple,
    ruleBreakEvenReached,
  };
}

function mergeCommandBuckets(
  target: Map<CanonicalTelemetryCommand, CommandHonestBucket>,
  incoming: ReadonlyArray<CommandHonestBucket>,
): void {
  for (const row of incoming) {
    const b = target.get(row.command);
    if (!b) continue;
    b.calls += row.calls;
    b.winCalls += row.winCalls;
    b.lossCalls += row.lossCalls;
    b.errorCalls += row.errorCalls;
    b.realisticNativeCl100k += row.realisticNativeCl100k;
    b.aiceCl100k += row.aiceCl100k;
    b.rawNativeRefCl100k += row.rawNativeRefCl100k;
  }
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

    const realNat =
      ev.filePath === "<cli-error>" ? 0 : (ev.realisticNativeCl100k ?? ev.nativeCl100k);
    const realSaved =
      ev.filePath === "<cli-error>"
        ? -ev.aiceCl100k
        : (ev.realisticSavedCl100k ?? realNat - ev.aiceCl100k);

    if (realSaved <= 0) {
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
      realisticNativeCl100k: 0,
      realisticSavedCl100k: 0,
      realisticSavingsPct: 0,
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
    opBucket.realisticNativeCl100k += realNat;
    opBucket.realisticSavedCl100k += realSaved;
    opBucket.nativeO200k += ev.nativeO200k;
    opBucket.aiceO200k += ev.aiceO200k;
    opBucket.savedO200k += ev.savedO200k;
    opBucket.savingsPct = calcPct(opBucket.savedCl100k, opBucket.nativeCl100k);
    opBucket.realisticSavingsPct = calcPct(
      opBucket.realisticSavedCl100k,
      opBucket.realisticNativeCl100k,
    );
    opBucket.o200kSavingsPct = calcPct(opBucket.savedO200k, opBucket.nativeO200k);
    opMap.set(opKey, opBucket);

    const langBucket = langMap.get(ev.language) ?? {
      language: ev.language,
      calls: 0,
      nativeCl100k: 0,
      aiceCl100k: 0,
      savedCl100k: 0,
      savingsPct: 0,
      realisticNativeCl100k: 0,
      realisticSavedCl100k: 0,
      realisticSavingsPct: 0,
      nativeO200k: 0,
      aiceO200k: 0,
      savedO200k: 0,
    };
    langBucket.calls++;
    langBucket.nativeCl100k += ev.nativeCl100k;
    langBucket.aiceCl100k += ev.aiceCl100k;
    langBucket.savedCl100k += ev.savedCl100k;
    langBucket.realisticNativeCl100k += realNat;
    langBucket.realisticSavedCl100k += realSaved;
    langBucket.nativeO200k += ev.nativeO200k;
    langBucket.aiceO200k += ev.aiceO200k;
    langBucket.savedO200k += ev.savedO200k;
    langBucket.savingsPct = calcPct(langBucket.savedCl100k, langBucket.nativeCl100k);
    langBucket.realisticSavingsPct = calcPct(
      langBucket.realisticSavedCl100k,
      langBucket.realisticNativeCl100k,
    );
    langMap.set(ev.language, langBucket);

    const projSummary: ProjectGainSummary = projMap.get(ev.projectRoot) ?? {
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
      wrapperTaxCl100k: 0,
      parallelSliceCalls: 0,
      sequentialPaginationTurns: 0,
      failedRetryTurns: 0,
      estimatedTurns: 0,
      mcpEstimatedTurns: 0,
      grossRuleReplayCl100k: 0,
      ruleReplayTaxCl100k: 0,
      mcpSchemaBudgetCl100k: 0,
      mcpSchemaTaxCl100k: 0,
      paginationReplayTaxCl100k: 0,
      paginationCostWeightedTaxCl100k: 0,
      wastedRetryOutputTokensCl100k: 0,
      failedRetryOutputPenalty4xCl100k: 0,
      retryReplayTaxCl100k: 0,
      retryCostWeightedTaxCl100k: 0,
      totalSystemicTaxCl100k: 0,
      totalCostWeightedTaxCl100k: 0,
      netEndToEndSavedCl100k: 0,
      costWeightedNetDeltaCl100k: 0,
      spliceErrorRatePct: 0,
      singleFileReadCalls: 0,
      singleFileReadLossCalls: 0,
      singleFileReadLossPct: 0,
      endToEndVerdict: "NEUTRAL",
    };
    projSummary.calls++;
    if (ev.category === "read") projSummary.readCalls++;
    else projSummary.writeCalls++;
    if (realSaved <= 0) projSummary.overheadCalls++;
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

  const dropEphemeralErrorRoots =
    !options.telemetryPath &&
    !process.env.AICE_TELEMETRY_PATH &&
    !process.env.AICE_TELEMETRY_DIR &&
    !process.env.AICE_TELEMETRY_ERRORS_PATH &&
    !process.env.AICE_HOME;
  const errorsByRoot = loadNonBenignErrorEventsByProject(ledgerPath, dropEphemeralErrorRoots);
  // Ensure projects with error-only records (e.g. MCP failures with 0 gains.jsonl rows) are also represented
  for (const [errRoot, errList] of errorsByRoot.entries()) {
    if (errRoot === "<unknown>" || projMap.has(errRoot)) continue;
    const pName = errList[0]?.projectName || path.basename(errRoot) || "root";
    if (projectFilter) {
      const syntheticEv = { projectRoot: errRoot, projectName: pName } as TelemetryEvent;
      if (!matchesProjectFilter(syntheticEv, projectFilter)) continue;
    }
    projMap.set(errRoot, {
      projectRoot: errRoot,
      projectName: pName,
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
      wrapperTaxCl100k: 0,
      parallelSliceCalls: 0,
      sequentialPaginationTurns: 0,
      failedRetryTurns: 0,
      estimatedTurns: 0,
      mcpEstimatedTurns: 0,
      grossRuleReplayCl100k: 0,
      ruleReplayTaxCl100k: 0,
      mcpSchemaBudgetCl100k: 0,
      mcpSchemaTaxCl100k: 0,
      paginationReplayTaxCl100k: 0,
      paginationCostWeightedTaxCl100k: 0,
      wastedRetryOutputTokensCl100k: 0,
      failedRetryOutputPenalty4xCl100k: 0,
      retryReplayTaxCl100k: 0,
      retryCostWeightedTaxCl100k: 0,
      totalSystemicTaxCl100k: 0,
      totalCostWeightedTaxCl100k: 0,
      netEndToEndSavedCl100k: 0,
      costWeightedNetDeltaCl100k: 0,
      spliceErrorRatePct: 0,
      singleFileReadCalls: 0,
      singleFileReadLossCalls: 0,
      singleFileReadLossPct: 0,
      endToEndVerdict: "NEUTRAL",
    });
    projEventsMap.set(errRoot, []);
  }

  const globalCmdMap = createEmptyCommandMap();

  for (const [pRoot, pSummary] of projMap.entries()) {
    const pEvents = projEventsMap.get(pRoot) ?? [];
    const pErrors = getNonBenignErrorsForProject(errorsByRoot, pRoot, pSummary.projectName);
    const econ = computeProjectSystemicEconomics(pEvents, pErrors);
    mergeCommandBuckets(globalCmdMap, econ.byCommand);

    pSummary.realisticNativeCl100k = econ.realisticNativeCl100k;
    pSummary.realisticSavedCl100k = econ.realisticSavedCl100k;
    pSummary.realisticSavingsPct = calcPct(econ.realisticSavedCl100k, econ.realisticNativeCl100k);
    pSummary.wrapperTaxCl100k = econ.wrapperTaxCl100k;
    pSummary.parallelSliceCalls = econ.parallelSliceCalls;
    pSummary.sequentialPaginationTurns = econ.sequentialPaginationTurns;
    pSummary.failedRetryTurns = econ.failedRetryTurns;
    pSummary.estimatedTurns = econ.estimatedTurns;
    pSummary.mcpEstimatedTurns = econ.mcpEstimatedTurns;
    pSummary.grossRuleReplayCl100k = econ.grossRuleReplayCl100k;
    pSummary.ruleReplayTaxCl100k = econ.ruleReplayTaxCl100k;
    pSummary.mcpSchemaBudgetCl100k = econ.mcpSchemaBudgetCl100k;
    pSummary.mcpSchemaTaxCl100k = econ.mcpSchemaTaxCl100k;
    pSummary.paginationReplayTaxCl100k = econ.paginationReplayTaxCl100k;
    pSummary.paginationCostWeightedTaxCl100k = econ.paginationCostWeightedTaxCl100k;
    pSummary.wastedRetryOutputTokensCl100k = econ.wastedRetryOutputTokensCl100k;
    pSummary.failedRetryOutputPenalty4xCl100k = econ.failedRetryOutputPenalty4xCl100k;
    pSummary.retryReplayTaxCl100k = econ.retryReplayTaxCl100k;
    pSummary.retryCostWeightedTaxCl100k = econ.retryCostWeightedTaxCl100k;
    pSummary.totalSystemicTaxCl100k = econ.totalSystemicTaxCl100k;
    pSummary.totalCostWeightedTaxCl100k = econ.totalCostWeightedTaxCl100k;
    pSummary.netEndToEndSavedCl100k = econ.netEndToEndSavedCl100k;
    pSummary.costWeightedNetDeltaCl100k = econ.costWeightedNetDeltaCl100k;
    pSummary.spliceErrorRatePct = econ.spliceErrorRatePct;
    pSummary.singleFileReadCalls = econ.singleFileReadCalls;
    pSummary.singleFileReadLossCalls = econ.singleFileReadLossCalls;
    pSummary.singleFileReadLossPct = econ.singleFileReadLossPct;
    pSummary.endToEndVerdict = econ.endToEndVerdict;
  }

  const byCommand = finalizeCommandBuckets(globalCmdMap);
  const byOperation = Array.from(opMap.values()).sort(
    (a, b) => b.realisticSavedCl100k - a.realisticSavedCl100k || b.calls - a.calls,
  );
  const byLanguage = Array.from(langMap.values()).sort(
    (a, b) => b.realisticSavedCl100k - a.realisticSavedCl100k || b.calls - a.calls,
  );
  const projects = Array.from(projMap.values()).sort(
    (a, b) => b.netEndToEndSavedCl100k - a.netEndToEndSavedCl100k || b.calls - a.calls,
  );

  let projectDetail: ProjectDetailReport | undefined;
  if (options.project) {
    const targetRoot =
      projects.length > 0
        ? projects[0]?.projectRoot
        : resolveBareOrPathProjectCandidate(options.project);
    const pEvents = projEventsMap.get(targetRoot) ?? filteredEvents;
    const targetSummary = projects.find((p) => p.projectRoot === targetRoot);
    const pErrors = getNonBenignErrorsForProject(
      errorsByRoot,
      targetRoot,
      targetSummary?.projectName ?? path.basename(targetRoot),
    );
    projectDetail = buildProjectDetail(targetRoot, pEvents, pErrors);
  }

  const totalRealisticNativeCl100k = projects.reduce(
    (s, p) => s + (p.realisticNativeCl100k ?? p.nativeCl100k),
    0,
  );
  const totalRealisticSavedCl100k = projects.reduce(
    (s, p) => s + (p.realisticSavedCl100k ?? p.savedCl100k),
    0,
  );
  const globalWrapperTaxCl100k = projects.reduce((s, p) => s + p.wrapperTaxCl100k, 0);
  const globalParallelSliceCalls = projects.reduce((s, p) => s + p.parallelSliceCalls, 0);
  const globalSequentialPaginationTurns = projects.reduce(
    (s, p) => s + p.sequentialPaginationTurns,
    0,
  );
  const globalFailedRetryTurns = projects.reduce((s, p) => s + p.failedRetryTurns, 0);
  const globalEstimatedTurns = projects.reduce((s, p) => s + p.estimatedTurns, 0);
  const globalMcpEstimatedTurns = projects.reduce((s, p) => s + p.mcpEstimatedTurns, 0);
  const globalGrossRuleReplayCl100k = projects.reduce((s, p) => s + p.grossRuleReplayCl100k, 0);
  const globalRuleReplayTaxCl100k = projects.reduce((s, p) => s + p.ruleReplayTaxCl100k, 0);
  const globalMcpSchemaBudgetCl100k = getMcpSchemaOverheadBudgetCl100k();
  const globalMcpSchemaTaxCl100k = projects.reduce((s, p) => s + p.mcpSchemaTaxCl100k, 0);
  const globalPaginationReplayTaxCl100k = projects.reduce(
    (s, p) => s + p.paginationReplayTaxCl100k,
    0,
  );
  const globalPaginationCostWeightedTaxCl100k = projects.reduce(
    (s, p) => s + p.paginationCostWeightedTaxCl100k,
    0,
  );
  const globalWastedRetryOutputTokensCl100k = projects.reduce(
    (s, p) => s + p.wastedRetryOutputTokensCl100k,
    0,
  );
  const globalFailedRetryOutputPenalty4xCl100k = projects.reduce(
    (s, p) => s + p.failedRetryOutputPenalty4xCl100k,
    0,
  );
  const globalRetryReplayTaxCl100k = projects.reduce((s, p) => s + p.retryReplayTaxCl100k, 0);
  const globalRetryCostWeightedTaxCl100k = projects.reduce(
    (s, p) => s + p.retryCostWeightedTaxCl100k,
    0,
  );
  const globalTotalSystemicTaxCl100k = projects.reduce((s, p) => s + p.totalSystemicTaxCl100k, 0);
  const globalTotalCostWeightedTaxCl100k = projects.reduce(
    (s, p) => s + p.totalCostWeightedTaxCl100k,
    0,
  );
  const globalNetEndToEndSavedCl100k = totalRealisticSavedCl100k - globalTotalSystemicTaxCl100k;
  const globalCostWeightedNetDeltaCl100k = projects.reduce(
    (s, p) => s + p.costWeightedNetDeltaCl100k,
    0,
  );

  const globalSpliceBucket = byCommand.find((c) => c.command === "splice/write");
  const globalSpliceErrorRatePct = globalSpliceBucket?.errPct ?? 0;
  const globalIsSpliceHealthy =
    (globalSpliceBucket?.calls ?? 0) === 0 ||
    globalSpliceErrorRatePct <= HEALTHY_SPLICE_ERR_PCT_MAX;
  const globalSingleFileReadCalls = projects.reduce((s, p) => s + p.singleFileReadCalls, 0);
  const globalSingleFileReadLossCalls = projects.reduce((s, p) => s + p.singleFileReadLossCalls, 0);
  const globalSingleFileReadLossPct =
    globalSingleFileReadCalls > 0
      ? Number(((globalSingleFileReadLossCalls / globalSingleFileReadCalls) * 100).toFixed(1))
      : 0;

  let globalEndToEndVerdict: EndToEndVerdict = "NEUTRAL";
  if (filteredEvents.length === 0 && globalFailedRetryTurns === 0) {
    globalEndToEndVerdict = "NEUTRAL";
  } else if (
    globalNetEndToEndSavedCl100k > 0 &&
    globalCostWeightedNetDeltaCl100k > 0 &&
    globalIsSpliceHealthy
  ) {
    globalEndToEndVerdict = "TOKEN-REDUCING";
  } else if (
    globalNetEndToEndSavedCl100k === 0 &&
    globalCostWeightedNetDeltaCl100k === 0 &&
    globalFailedRetryTurns === 0
  ) {
    globalEndToEndVerdict = "NEUTRAL";
  } else {
    globalEndToEndVerdict = "TOKEN-CONSUMING";
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
    ...computeRuleBreakEvenMetrics(totalRealisticSavedCl100k),
    totalRealisticNativeCl100k,
    totalRealisticSavedCl100k,
    realisticSavedCl100kPct: calcPct(totalRealisticSavedCl100k, totalRealisticNativeCl100k),
    totalPreservedTriviaTokens,
    wrapperTaxCl100k: globalWrapperTaxCl100k,
    parallelSliceCalls: globalParallelSliceCalls,
    sequentialPaginationTurns: globalSequentialPaginationTurns,
    failedRetryTurns: globalFailedRetryTurns,
    estimatedTurns: globalEstimatedTurns,
    mcpEstimatedTurns: globalMcpEstimatedTurns,
    grossRuleReplayCl100k: globalGrossRuleReplayCl100k,
    ruleReplayTaxCl100k: globalRuleReplayTaxCl100k,
    mcpSchemaBudgetCl100k: globalMcpSchemaBudgetCl100k,
    mcpSchemaTaxCl100k: globalMcpSchemaTaxCl100k,
    paginationReplayTaxCl100k: globalPaginationReplayTaxCl100k,
    paginationCostWeightedTaxCl100k: globalPaginationCostWeightedTaxCl100k,
    wastedRetryOutputTokensCl100k: globalWastedRetryOutputTokensCl100k,
    failedRetryOutputPenalty4xCl100k: globalFailedRetryOutputPenalty4xCl100k,
    retryReplayTaxCl100k: globalRetryReplayTaxCl100k,
    retryCostWeightedTaxCl100k: globalRetryCostWeightedTaxCl100k,
    totalSystemicTaxCl100k: globalTotalSystemicTaxCl100k,
    totalCostWeightedTaxCl100k: globalTotalCostWeightedTaxCl100k,
    netEndToEndSavedCl100k: globalNetEndToEndSavedCl100k,
    costWeightedNetDeltaCl100k: globalCostWeightedNetDeltaCl100k,
    spliceErrorRatePct: globalSpliceErrorRatePct,
    singleFileReadCalls: globalSingleFileReadCalls,
    singleFileReadLossCalls: globalSingleFileReadLossCalls,
    singleFileReadLossPct: globalSingleFileReadLossPct,
    endToEndVerdict: globalEndToEndVerdict,
    byCommand,
    byOperation,
    byLanguage,
    projects,
    ...(projectDetail ? { projectDetail } : {}),
  };
}

function fmtSigned(n: number): string {
  return n > 0 ? `+${n.toLocaleString("en-US")}` : n.toLocaleString("en-US");
}

function fmtPct(pct: number): string {
  return pct > 0 ? `+${pct.toFixed(1)}%` : `${pct.toFixed(1)}%`;
}

function formatRuleOverheadBreakEvenLine(savedCl100k: number, indent = "  "): string {
  const budget = getRuleOverheadBudgetCl100k();
  const multiple = budget > 0 ? (savedCl100k / budget).toFixed(2) : "0.00";
  if (savedCl100k >= budget && budget > 0) {
    const netAfter = savedCl100k - budget;
    return `${indent}Rule Overhead Break-Even: 1x AGENTS.md Budget ${budget.toLocaleString("en-US")} cl100k | Realistic Saved: ${fmtSigned(savedCl100k)} | AMORTIZED (${multiple}x budget, net ${fmtSigned(netAfter)} tokens)`;
  }
  const remaining = budget > savedCl100k ? budget - savedCl100k : 0;
  return `${indent}Rule Overhead Break-Even: 1x AGENTS.md Budget ${budget.toLocaleString("en-US")} cl100k | Realistic Saved: ${fmtSigned(savedCl100k)} | ${remaining.toLocaleString("en-US")} tokens needed to break even (${multiple}x)`;
}

function formatExplicitTaxesAndVerdictBlock(params: {
  realisticSavedCl100k: number;
  wrapperTaxCl100k: number;
  ruleReplayTaxCl100k: number;
  estimatedTurns: number;
  mcpSchemaTaxCl100k: number;
  mcpSchemaBudgetCl100k: number;
  mcpEstimatedTurns: number;
  sequentialPaginationTurns: number;
  paginationReplayTaxCl100k: number;
  paginationCostWeightedTaxCl100k: number;
  failedRetryTurns: number;
  wastedRetryOutputTokensCl100k: number;
  failedRetryOutputPenalty4xCl100k: number;
  retryReplayTaxCl100k: number;
  retryCostWeightedTaxCl100k: number;
  netEndToEndSavedCl100k: number;
  costWeightedNetDeltaCl100k: number;
  spliceErrorRatePct: number;
  endToEndVerdict: EndToEndVerdict;
}): string[] {
  const lines: string[] = [];
  lines.push("  Explicit Systemic Taxes & Cost-Weighted Economics (1x in / 0.1x cached / 4x out):");
  lines.push(
    `    Realistic Payload Delta:          ${fmtSigned(params.realisticSavedCl100k)} cl100k`,
  );
  lines.push(
    `    Wrapper Tax (CLI=70 / MCP=45):    -${params.wrapperTaxCl100k.toLocaleString("en-US")} cl100k`,
  );
  lines.push(
    `    AGENTS.md Rule Replay (1x+0.1x):  -${params.ruleReplayTaxCl100k.toLocaleString("en-US")} cl100k (${params.estimatedTurns} turn${params.estimatedTurns === 1 ? "" : "s"})`,
  );
  lines.push(
    `    MCP Schema Tax (live tools/list): -${params.mcpSchemaTaxCl100k.toLocaleString("en-US")} cl100k (${params.mcpEstimatedTurns} MCP turn${params.mcpEstimatedTurns === 1 ? "" : "s"}, schema=${params.mcpSchemaBudgetCl100k.toLocaleString("en-US")} tok)`,
  );
  lines.push(
    `    Repeat-Read Pagination Tax:       -${params.paginationReplayTaxCl100k.toLocaleString("en-US")} unwt / -${params.paginationCostWeightedTaxCl100k.toLocaleString("en-US")} cost-wt (${params.sequentialPaginationTurns} turn${params.sequentialPaginationTurns === 1 ? "" : "s"})`,
  );
  lines.push(
    `    Failed & Retry Penalty (4x out):  -${params.retryReplayTaxCl100k.toLocaleString("en-US")} unwt / -${params.retryCostWeightedTaxCl100k.toLocaleString("en-US")} cost-wt (${params.failedRetryTurns} fail${params.failedRetryTurns === 1 ? "" : "s"}, ${params.wastedRetryOutputTokensCl100k.toLocaleString("en-US")} out tok × 4 = -${params.failedRetryOutputPenalty4xCl100k.toLocaleString("en-US")})`,
  );
  lines.push(
    `    Net Unweighted Token Delta:       ${fmtSigned(params.netEndToEndSavedCl100k)} cl100k`,
  );
  lines.push(
    `    Cost-Weighted Equivalent Delta:   ${fmtSigned(params.costWeightedNetDeltaCl100k)} cl100k (1x in / 0.1x cached / 4x out)`,
  );
  lines.push(
    `    Splice/Write Error Rate Gate:     ${params.spliceErrorRatePct.toFixed(1)}% (healthy <= ${HEALTHY_SPLICE_ERR_PCT_MAX.toFixed(1)}%)`,
  );
  lines.push(`    HONEST VERDICT:                   ${params.endToEndVerdict}`);
  lines.push(`    End-to-End Verdict:               ${params.endToEndVerdict}`);
  return lines;
}

export function formatGlobalGainDashboard(report: GainReport): string {
  const lines: string[] = [];
  const modeLabel = report.unique ? "Deduplicated (--unique)" : "Cumulative (--all)";

  lines.push(
    "==================================================================================================",
  );
  lines.push(`AICE GAIN — 100% HONEST BPE TOKEN SAVINGS TELEMETRY (${modeLabel})`);
  lines.push(
    "==================================================================================================",
  );

  if (report.totalOperations === 0 && report.failedRetryTurns === 0) {
    lines.push("No telemetry operations recorded yet.");
    lines.push(`Ledger path: ${report.telemetryPath}`);
    lines.push(formatRuleOverheadBreakEvenLine(0, ""));
    lines.push(
      "Run `aice read` or `aice splice` (or MCP `aice_read` / `aice_splice`) to begin tracking.",
    );
    return lines.join("\n");
  }

  const realNat = report.totalRealisticNativeCl100k ?? report.nativeCl100k;
  const realSaved = report.totalRealisticSavedCl100k ?? report.savedCl100k;
  const realPct = report.realisticSavedCl100kPct ?? calcPct(realSaved, realNat);

  lines.push("");
  lines.push("1. GLOBAL HONEST SUMMARY BANNER");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    `  Total Operations:       ${report.totalOperations.toLocaleString("en-US")} (read: ${report.readOperations}, write: ${report.writeOperations}, failed/errors: ${report.failedRetryTurns})`,
  );
  lines.push(
    `  Honest Overhead Calls:  ${report.overheadOperations.toLocaleString("en-US")} (operations where realistic net delta <= 0)`,
  );
  lines.push(
    `  Single-File Read Loss:  ${report.singleFileReadLossCalls.toLocaleString("en-US")} / ${report.singleFileReadCalls.toLocaleString("en-US")} (${report.singleFileReadLossPct.toFixed(1)}% with AICE > Realistic)`,
  );
  lines.push(
    `  Repeat-Read Turn Warnings: ${report.repeatReadCalls.toLocaleString("en-US")}${
      report.repeatReadCalls > 0
        ? " ⚠ (<90s back-to-back same-file reads — multi-turn line hunting)"
        : " (0 <90s back-to-back same-file reads)"
    }`,
  );
  lines.push(
    `  Realistic cl100k_base:  Realistic Native ${realNat.toLocaleString("en-US")} -> AICE Actual ${report.aiceCl100k.toLocaleString("en-US")} | Net Delta: ${fmtSigned(realSaved)} (${fmtPct(realPct)})`,
  );
  lines.push(formatRuleOverheadBreakEvenLine(realSaved));
  lines.push("");

  lines.push(
    ...formatExplicitTaxesAndVerdictBlock({
      realisticSavedCl100k: realSaved,
      wrapperTaxCl100k: report.wrapperTaxCl100k,
      ruleReplayTaxCl100k: report.ruleReplayTaxCl100k,
      estimatedTurns: report.estimatedTurns,
      mcpSchemaTaxCl100k: report.mcpSchemaTaxCl100k,
      mcpSchemaBudgetCl100k: report.mcpSchemaBudgetCl100k,
      mcpEstimatedTurns: report.mcpEstimatedTurns,
      sequentialPaginationTurns: report.sequentialPaginationTurns,
      paginationReplayTaxCl100k: report.paginationReplayTaxCl100k,
      paginationCostWeightedTaxCl100k: report.paginationCostWeightedTaxCl100k,
      failedRetryTurns: report.failedRetryTurns,
      wastedRetryOutputTokensCl100k: report.wastedRetryOutputTokensCl100k,
      failedRetryOutputPenalty4xCl100k: report.failedRetryOutputPenalty4xCl100k,
      retryReplayTaxCl100k: report.retryReplayTaxCl100k,
      retryCostWeightedTaxCl100k: report.retryCostWeightedTaxCl100k,
      netEndToEndSavedCl100k: report.netEndToEndSavedCl100k,
      costWeightedNetDeltaCl100k: report.costWeightedNetDeltaCl100k,
      spliceErrorRatePct: report.spliceErrorRatePct,
      endToEndVerdict: report.endToEndVerdict,
    }),
  );

  lines.push("");
  lines.push("2. PER-COMMAND HONEST BREAKDOWN (AICE Actual vs Realistic Native)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(...formatHonestCommandTable(report.byCommand, report.nativeCl100k, "  "));
  if (report.byOperation.length > 0) {
    lines.push(
      `  By Operation/Surface: ${report.byOperation.map((op) => `${op.operation}(${op.surface}):${op.calls} [${fmtSigned(op.realisticSavedCl100k)}]`).join(", ")}`,
    );
  }

  lines.push("");
  lines.push("3. BREAKDOWN BY LANGUAGE (Realistic Native)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    `  ${"Language".padEnd(18)} ${"Calls".padStart(7)} ${"Realistic Nat".padStart(14)} ${"AICE Actual".padStart(12)} ${"Net Delta".padStart(12)} ${"Delta%".padStart(10)}`,
  );
  for (const lang of report.byLanguage) {
    lines.push(
      `  ${lang.language.padEnd(18)} ${String(lang.calls).padStart(7)} ${lang.realisticNativeCl100k.toLocaleString("en-US").padStart(14)} ${lang.aiceCl100k.toLocaleString("en-US").padStart(12)} ${fmtSigned(lang.realisticSavedCl100k).padStart(12)} ${fmtPct(lang.realisticSavingsPct).padStart(10)}`,
    );
  }

  lines.push("");
  lines.push("4. RANKED PROJECTS TABLE (Honest Realistic & Cost-Weighted Verdict)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    `  ${"#".padEnd(3)} ${"Project".padEnd(20)} ${"Calls".padStart(6)} ${"Realistic Nat".padStart(14)} ${"AICE Actual".padStart(12)} ${"Unwt Net".padStart(11)} ${"Cost-Wt Net".padStart(12)} ${"Verdict".padStart(16)}`,
  );
  report.projects.forEach((p, idx) => {
    const pRealNat = p.realisticNativeCl100k ?? p.nativeCl100k;
    lines.push(
      `  ${String(idx + 1).padEnd(3)} ${p.projectName.slice(0, 20).padEnd(20)} ${String(p.calls).padStart(6)} ${pRealNat.toLocaleString("en-US").padStart(14)} ${p.aiceCl100k.toLocaleString("en-US").padStart(12)} ${fmtSigned(p.netEndToEndSavedCl100k).padStart(11)} ${fmtSigned(p.costWeightedNetDeltaCl100k).padStart(12)} ${p.endToEndVerdict.padStart(16)}`,
    );
  });

  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    "Tip: Run `aice gain <project-name>` or `aice gain .` to inspect per-project command & file breakdowns.",
  );
  return lines.join("\n");
}

/**
 * Formats the Per-Project Drill-Down Detail View for terminal output.
 */
export function formatProjectGainDetail(detail: ProjectDetailReport): string {
  const lines: string[] = [];
  const s = detail.summary;

  lines.push(
    "==================================================================================================",
  );
  lines.push(`AICE PROJECT GAIN DETAIL — ${detail.projectName}`);
  lines.push(
    "==================================================================================================",
  );
  lines.push(`  Project Root:     ${detail.projectRoot}`);
  lines.push(
    `  Config Status:    AICE=${detail.configStatus.enabled ? "ENABLED" : "DISABLED"} | Idioms=${detail.configStatus.idiomsEnabled ? "ENABLED" : "DISABLED"} (${detail.configStatus.activeIdiomsCount} active $idioms)`,
  );
  lines.push(
    `  Total Calls:      ${s.totalCalls} (read: ${s.readCalls}, write: ${s.writeCalls}, idiom-assisted: ${s.idiomCalls}, overhead<=0: ${s.overheadCalls}, errors: ${s.failedRetryTurns})`,
  );
  lines.push(
    `  Single-File Loss: ${s.singleFileReadLossCalls} / ${s.singleFileReadCalls} (${s.singleFileReadLossPct.toFixed(1)}% single-file reads with AICE > Realistic)`,
  );
  lines.push(
    `  Repeat-Read Turn Warnings: ${s.repeatReadCalls.toLocaleString("en-US")}${
      s.repeatReadCalls > 0
        ? " ⚠ (<90s back-to-back same-file reads — multi-turn line hunting)"
        : " (0 <90s back-to-back same-file reads)"
    }`,
  );
  lines.push(
    `  Realistic cl100k: Realistic Native ${s.realisticNativeCl100k.toLocaleString("en-US")} -> AICE Actual ${s.aiceCl100k.toLocaleString("en-US")} | Net Delta: ${fmtSigned(s.realisticSavedCl100k)} (${fmtPct(s.realisticSavingsPct)})`,
  );
  lines.push(formatRuleOverheadBreakEvenLine(s.realisticSavedCl100k));
  lines.push("");

  lines.push(
    ...formatExplicitTaxesAndVerdictBlock({
      realisticSavedCl100k: s.realisticSavedCl100k,
      wrapperTaxCl100k: s.wrapperTaxCl100k,
      ruleReplayTaxCl100k: s.ruleReplayTaxCl100k,
      estimatedTurns: s.estimatedTurns,
      mcpSchemaTaxCl100k: s.mcpSchemaTaxCl100k,
      mcpSchemaBudgetCl100k: s.mcpSchemaBudgetCl100k,
      mcpEstimatedTurns: s.mcpEstimatedTurns,
      sequentialPaginationTurns: s.sequentialPaginationTurns,
      paginationReplayTaxCl100k: s.paginationReplayTaxCl100k,
      paginationCostWeightedTaxCl100k: s.paginationCostWeightedTaxCl100k,
      failedRetryTurns: s.failedRetryTurns,
      wastedRetryOutputTokensCl100k: s.wastedRetryOutputTokensCl100k,
      failedRetryOutputPenalty4xCl100k: s.failedRetryOutputPenalty4xCl100k,
      retryReplayTaxCl100k: s.retryReplayTaxCl100k,
      retryCostWeightedTaxCl100k: s.retryCostWeightedTaxCl100k,
      netEndToEndSavedCl100k: s.netEndToEndSavedCl100k,
      costWeightedNetDeltaCl100k: s.costWeightedNetDeltaCl100k,
      spliceErrorRatePct: s.spliceErrorRatePct,
      endToEndVerdict: s.endToEndVerdict,
    }),
  );

  lines.push("");
  lines.push("PER-COMMAND HONEST BREAKDOWN (AICE Actual vs Realistic Native)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(...formatHonestCommandTable(detail.byCommand, s.nativeCl100k, "  "));
  if (detail.byOperation.length > 0) {
    lines.push(
      `  By Operation/Surface: ${detail.byOperation.map((op) => `${op.operation}(${op.surface}):${op.calls} [${fmtSigned(op.realisticSavedCl100k)}]`).join(", ")}`,
    );
  }

  lines.push("");
  lines.push("FILES TABLE (WORST / NEGATIVE-DELTA OVERHEAD FILES SHOWN FIRST)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    `  ${"File Path".padEnd(34)} ${"Calls".padStart(6)} ${"Realistic".padStart(11)} ${"AICE".padStart(10)} ${"Net Delta".padStart(11)} ${"Delta%".padStart(9)}`,
  );
  for (const f of detail.topFiles.slice(0, 25)) {
    lines.push(
      `  ${f.filePath.slice(0, 34).padEnd(34)} ${String(f.calls).padStart(6)} ${f.realisticNativeCl100k.toLocaleString("en-US").padStart(11)} ${f.aiceCl100k.toLocaleString("en-US").padStart(10)} ${fmtSigned(f.realisticSavedCl100k).padStart(11)} ${fmtPct(f.realisticSavingsPct).padStart(9)}`,
    );
  }

  lines.push("");
  lines.push("RECENT OPERATIONS LOG (LAST 15)");
  lines.push(
    "--------------------------------------------------------------------------------------------------",
  );
  lines.push(
    `  ${"Timestamp".padEnd(20)} ${"Surf".padEnd(5)} ${"Operation".padEnd(14)} ${"File".padEnd(28)} ${"Realistic Delta".padStart(15)}`,
  );
  for (const ev of detail.recentOperations) {
    const shortTs = ev.timestamp.replace("T", " ").slice(0, 19);
    const evRealSaved =
      ev.filePath === "<cli-error>" ? -ev.aiceCl100k : (ev.realisticSavedCl100k ?? ev.savedCl100k);
    lines.push(
      `  ${shortTs.padEnd(20)} ${ev.surface.padEnd(5)} ${ev.operation.padEnd(14)} ${ev.filePath.slice(0, 28).padEnd(28)} ${fmtSigned(evRealSaved).padStart(15)}`,
    );
  }

  return lines.join("\n");
}

export * from "./analyze.js";
export const formatGainReport = formatGlobalGainDashboard;
export const formatProjectDetailReport = formatProjectGainDetail;
