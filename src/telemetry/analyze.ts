/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * AICE Post-Session Project Analyzer (`aice analyze`) & Error Telemetry Engine.
 * Cross-verifies AICE telemetry ledgers against real Antigravity CLI & Claude transcripts.
 */

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
import {
  buildGainReport,
  detectCallerAgent,
  type EndToEndVerdict,
  getMcpSchemaOverheadBudgetCl100k,
  getRuleOverheadBudgetCl100k,
  HEALTHY_SPLICE_ERR_PCT_MAX,
  hasDirectWorkspaceMarker,
  isEphemeralWorkspace,
  isExplicitProjectPathQuery,
  isTelemetrySuppressed,
  isTestEnvWithoutExplicitTelemetry,
  resolveBareOrPathProjectCandidate,
  resolveTelemetryPath,
  type TelemetryOperation,
  type TelemetrySurface,
} from "./index.js";

export interface TelemetryErrorEvent {
  timestamp: string;
  projectRoot: string;
  projectName: string;
  filePath: string;
  operation: TelemetryOperation;
  surface: TelemetrySurface;
  agent: string;
  errorMessage: string;
  wastedInputTokens?: number;
}

export interface RecordTelemetryErrorInput {
  targetPath?: string;
  projectRoot?: string;
  filePath?: string;
  operation: TelemetryOperation;
  surface?: TelemetrySurface;
  agent?: string;
  errorMessage: string;
  wastedInputTokens?: number;
  telemetryPath?: string;
}

export interface SubcommandErrorStat {
  calls: number;
  errors: number;
  errorPct: number;
}

export interface FrictionCauseEntry {
  cause: string;
  count: number;
  sample: string;
}

export interface AnalyzedSessionSummary {
  conversationId: string;
  source: "antigravity" | "claude" | "transcript";
  workspace: string;
  totalSteps: number;
  llmTurns: number;
  checkpointCompactions: number;
  checkpointInputTokens: number;
  checkpointCacheReadTokens: number;
  checkpointOutputTokens: number;
  toolCallsTotal: number;
  aiceSubcommands: Record<string, number>;
  aiceSubcommandErrors: Record<string, number>;
  aiceHardErrorsTotal: number;
  failedAndRetryTurns: number;
  failedAndRetryOutputTokens: number;
  spliceFailedAndRetryOutputTokens: number;
  nativeFileBypasses: Record<string, number>;
  inputTokensUncached: number;
  cacheReadTokens: number;
  cacheHitPct: number;
  outputTokens: number;
  thinkingTokensEst: number;
  toolPayloadTokensEst: number;
  thinkingRatioPct: number;
  toolPayloadRatioPct: number;
  totalBillableTokens: number;
  costWeightedEquivalentTokens: number;
  totalContextTokensProcessed: number;
  wallClockSeconds: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  isFinished: boolean;
  errorCount: number;
  errors: Array<{
    step: number;
    at: string | null;
    snippet: string;
    isAiceError?: boolean;
    cause?: string;
  }>;
  transcriptBpe?: {
    totalCalls: number;
    readCalls: number;
    writeCalls: number;
    nativeCl100k: number;
    aiceCl100k: number;
    savedCl100k: number;
  };
  readLoop?: {
    readTurns: number;
    maxConsecutiveReadStreak: number;
    extraReadTurns: number;
    sameFileRepeatReadChains: SameFileRepeatReadChain[];
  };
}

export interface SameFileRepeatReadChain {
  conversationId: string;
  filePath: string;
  turns: number;
}

export interface AnalyzeProjectOptions {
  project?: string;
  telemetryPath?: string;
  transcriptsDir?: string;
}

export interface TranscriptGroundTruthReport {
  plannerResponseTurns: number;
  checkpointCompactions: number;
  checkpointInputTokens: number;
  checkpointCacheReadTokens: number;
  checkpointOutputTokens: number;
  cacheHitPct: number;
  aiceTotalCalls: number;
  aiceHardErrorsTotal: number;
  aiceOverallErrorPct: number;
  spliceWriteCalls: number;
  spliceWriteHardErrors: number;
  spliceWriteErrorPct: number;
  subcommandErrorRates: Record<string, SubcommandErrorStat>;
  failedAndRetryTurns: number;
  failedAndRetryOutputTokens: number;
  failedAndRetryOutputPct: number;
  spliceFailedAndRetryOutputTokens: number;
  spliceFailedAndRetryOutputPct: number;
  singleFileReadCalls: number;
  singleFileReadLossCalls: number;
  singleFileReadLossPct: number;
}

export interface ProjectAnalyzeReport {
  capturedAt: string;
  projectRoot: string;
  projectName: string;
  configStatus: {
    enabled: boolean;
    idiomsEnabled: boolean;
    activeIdiomsCount: number;
  };
  workspaceStats: {
    exists: boolean;
    fileCount: number;
    totalLines: number;
    totalBytes: number;
    languages: Record<string, number>;
  };
  sessionSummary: {
    sessionCount: number;
    totalSteps: number;
    totalTurns: number;
    checkpointCompactions: number;
    checkpointInputTokens: number;
    checkpointCacheReadTokens: number;
    checkpointOutputTokens: number;
    wallClockSeconds: number;
    inputTokensUncached: number;
    cacheReadTokens: number;
    cacheHitPct: number;
    outputTokens: number;
    thinkingTokensEst: number;
    toolPayloadTokensEst: number;
    thinkingRatioPct: number;
    toolPayloadRatioPct: number;
    totalBillableTokens: number;
    costWeightedEquivalentTokens: number;
    totalContextTokensProcessed: number;
    totalToolCalls: number;
    aiceSubcommands: Record<string, number>;
    nativeFileBypasses: Record<string, number>;
    aiceCompliancePct: number;
  };
  bpeSavings: {
    totalCalls: number;
    readCalls: number;
    writeCalls: number;
    nativeCl100k: number;
    aiceCl100k: number;
    savedCl100k: number;
    cl100kSavingsPct: number;
    realisticNativeCl100k: number;
    realisticSavedCl100k: number;
    realisticSavingsPct: number;
    nativeO200k: number;
    aiceO200k: number;
    savedO200k: number;
    o200kSavingsPct: number;
  };
  transcriptGroundTruth: TranscriptGroundTruthReport;
  readLoopAudit: {
    readTurns: number;
    totalTurns: number;
    readTurnRatioPct: number;
    maxConsecutiveReadStreak: number;
    sameFileRepeatReadChainCount: number;
    sameFileRepeatReadChains: SameFileRepeatReadChain[];
    extraReadTurns: number;
    avgSessionContextTokens: number;
    contextReplayTokenTax: number;
  };
  frictionAudit: {
    totalErrors: number;
    telemetryErrors: TelemetryErrorEvent[];
    transcriptErrors: Array<{
      conversationId: string;
      step: number;
      at: string | null;
      snippet: string;
    }>;
    topCauses: FrictionCauseEntry[];
  };
  sessions: AnalyzedSessionSummary[];
  endToEndEconomics: EndToEndEconomicsReport;
}

export interface EndToEndEconomicsReport {
  realisticPayloadSavedTokens: number;
  wrapperTaxTokens: number;
  ruleReplayTaxTokens: number;
  mcpSchemaTaxTokens: number;
  sequentialPaginationTurns: number;
  paginationReplayTaxTokens: number;
  failedRetryTurns: number;
  wastedRetryOutputTokens: number;
  failedRetryOutputPenalty4xTokens: number;
  retryReplayTaxTokens: number;
  totalSystemicTaxTokens: number;
  netEndToEndTokens: number;
  costWeightedNetTokens: number;
  spliceErrorRatePct: number;
  verdict: EndToEndVerdict;
}

export type ProjectAnalysisReport = ProjectAnalyzeReport;

export function resolveTelemetryErrorsPath(explicitTelemetryPath?: string): string {
  if (process.env.AICE_TELEMETRY_ERRORS_PATH) {
    return path.resolve(process.env.AICE_TELEMETRY_ERRORS_PATH);
  }
  const gainsPath = resolveTelemetryPath(explicitTelemetryPath);
  return path.join(path.dirname(gainsPath), "errors.jsonl");
}

function stripTrailingControlChars(rawPath: string): string {
  for (let i = 0; i < rawPath.length; i++) {
    const code = rawPath.charCodeAt(i);
    if (code < 32 || code === 127) {
      return rawPath.slice(0, i);
    }
  }
  return rawPath;
}

function cleanAntigravityToolOutput(rawContent: string): string {
  return rawContent
    .replace(/^The tool's output was truncated[^\n]*\n+(?:Here is a preview[^\n]*:\n+)?/g, "")
    .replace(/^(?:(?:Created At|Completed At):\s*[^\n]*\n)+/g, "")
    .trim();
}

export function classifyFrictionCause(errorText: string): string {
  if (/brace\/delimiter imbalance|Unbalanced delimiter|Ambiguous ±2|half-open/i.test(errorText)) {
    return "Line-range delimiter / boundary rejection";
  }
  if (/Symbol\s+['"`].+?['"`]\s+not found/i.test(errorText)) {
    return "Symbol not found (or header hijack)";
  }
  if (/Unsupported target extension|Unsupported language/i.test(errorText)) {
    return "Unsupported file extension";
  }
  if (
    /Malformed splice stream header|Malformed or incomplete header|Empty or malformed splice/i.test(
      errorText,
    )
  ) {
    return "Malformed splice stream header / block";
  }
  if (/unknown option|unknown command/i.test(errorText)) {
    return "CLI unknown option / subcommand";
  }
  if (/is not valid JSON|YAMLParseError|Unexpected token '<'/i.test(errorText)) {
    return "Dialect hunk / JSON-YAML parse error";
  }
  if (/IndentationError|Syntax error|SyntaxError|Unterminated string/i.test(errorText)) {
    return "Syntax / indentation validation error";
  }
  if (/Invalid line range/i.test(errorText)) {
    return "Invalid line range";
  }
  if (/command not found|exit 127/i.test(errorText)) {
    return "Unquoted shell pipe / command error";
  }
  return "AICE execution / tool error";
}

export function recordTelemetryError(
  input: RecordTelemetryErrorInput,
  forceEvenIfSuppressed = false,
): TelemetryErrorEvent | null {
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
    const rawTarget = input.targetPath ? path.resolve(input.targetPath) : process.cwd();
    let isDir = false;
    try {
      if (fs.existsSync(rawTarget) && fs.statSync(rawTarget).isDirectory()) {
        isDir = true;
      }
    } catch {
      // ignore
    }
    const projectRoot = path.resolve(
      input.projectRoot ?? findProjectRoot(isDir ? rawTarget : path.dirname(rawTarget)),
    );
    if (!forceEvenIfSuppressed && isEphemeralWorkspace(projectRoot, input.telemetryPath)) {
      return null;
    }
    const projectName = path.basename(projectRoot) || "root";
    const filePath =
      input.filePath ??
      (input.targetPath
        ? path.relative(projectRoot, rawTarget).replace(/\\/g, "/") || path.basename(rawTarget)
        : "<stdin>");
    const surface: TelemetrySurface = input.surface ?? "cli";
    const agent = input.agent ?? detectCallerAgent(surface);
    const event: TelemetryErrorEvent = {
      timestamp: new Date().toISOString(),
      projectRoot,
      projectName,
      filePath,
      operation: input.operation,
      surface,
      agent,
      errorMessage: input.errorMessage.slice(0, 1000),
      ...(input.wastedInputTokens && input.wastedInputTokens > 0
        ? { wastedInputTokens: Math.round(input.wastedInputTokens) }
        : {}),
    };
    const errLedgerPath = resolveTelemetryErrorsPath(input.telemetryPath);
    fs.mkdirSync(path.dirname(errLedgerPath), { recursive: true });
    fs.appendFileSync(errLedgerPath, `${JSON.stringify(event)}\n`, "utf-8");
    return event;
  } catch {
    return null;
  }
}

export function loadTelemetryErrors(
  projectRootFilter?: string,
  explicitTelemetryPath?: string,
): TelemetryErrorEvent[] {
  const errPath = resolveTelemetryErrorsPath(explicitTelemetryPath);
  const candidateFiles: string[] = [];
  if (fs.existsSync(errPath)) {
    candidateFiles.push(errPath);
  }
  if (explicitTelemetryPath) {
    const resolvedExplicit = path.resolve(explicitTelemetryPath);
    if (
      resolvedExplicit !== errPath &&
      resolvedExplicit.endsWith("errors.jsonl") &&
      fs.existsSync(resolvedExplicit)
    ) {
      candidateFiles.push(resolvedExplicit);
    }
  }
  if (candidateFiles.length === 0) {
    return [];
  }
  const trimmedFilter = projectRootFilter?.trim();
  const isPathFilter = trimmedFilter ? isExplicitProjectPathQuery(trimmedFilter) : false;
  const normFilter = trimmedFilter && isPathFilter ? path.resolve(trimmedFilter) : undefined;
  const events: TelemetryErrorEvent[] = [];

  for (const file of candidateFiles) {
    try {
      const raw = fs.readFileSync(file, "utf-8");
      for (const line of raw.split("\n")) {
        const trimmed = line.trim();
        if (!trimmed) continue;
        try {
          const parsed = JSON.parse(trimmed) as TelemetryErrorEvent;
          if (
            parsed &&
            typeof parsed.operation === "string" &&
            typeof parsed.errorMessage === "string"
          ) {
            if (!trimmedFilter) {
              events.push(parsed);
            } else if (isPathFilter && normFilter) {
              if (path.resolve(parsed.projectRoot) === normFilter) {
                events.push(parsed);
              }
            } else if (
              parsed.projectName.toLowerCase() === trimmedFilter.toLowerCase() ||
              path.basename(parsed.projectRoot).toLowerCase() === trimmedFilter.toLowerCase()
            ) {
              events.push(parsed);
            }
          }
        } catch {
          // skip malformed line
        }
      }
    } catch {
      // ignore unreadable file
    }
  }
  return events;
}

function inspectWorkspaceFiles(projectRoot: string): ProjectAnalyzeReport["workspaceStats"] {
  if (!fs.existsSync(projectRoot)) {
    return {
      exists: false,
      fileCount: 0,
      totalLines: 0,
      totalBytes: 0,
      languages: {},
    };
  }
  let fileCount = 0;
  let totalLines = 0;
  let totalBytes = 0;
  const languages: Record<string, number> = {};
  const skipDirs = new Set([
    "node_modules",
    ".git",
    "dist",
    ".aice-cache",
    "vendor",
    "__pycache__",
    "target",
    "bin",
    "obj",
  ]);
  const skipFiles = new Set([
    "package-lock.json",
    "Cargo.lock",
    "aice.config.json",
    ".aice-idioms.json",
    "verify_bin",
    "verify.jar",
  ]);

  const walk = (dir: string): void => {
    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (!skipDirs.has(entry.name)) {
          walk(path.join(dir, entry.name));
        }
        continue;
      }
      if (!entry.isFile() || skipFiles.has(entry.name)) {
        continue;
      }
      const fullPath = path.join(dir, entry.name);
      try {
        const stat = fs.statSync(fullPath);
        const buf = fs.readFileSync(fullPath);
        let newlines = 0;
        for (let i = 0; i < buf.length; i++) {
          if (buf[i] === 10) newlines++;
        }
        const lines = newlines + (buf.length > 0 && buf[buf.length - 1] !== 10 ? 1 : 0);
        fileCount++;
        totalBytes += stat.size;
        totalLines += lines;
        const lang = detectLanguageName(fullPath);
        languages[lang] = (languages[lang] ?? 0) + 1;
      } catch {
        // ignore unreadable file
      }
    }
  };

  walk(projectRoot);
  return {
    exists: true,
    fileCount,
    totalLines,
    totalBytes,
    languages,
  };
}

function extractRawWorkspaceFromDbForCid(
  transcriptPath: string,
  conversationId: string,
): string | null {
  const candidates = [
    path.resolve(
      path.dirname(transcriptPath),
      "../../../..",
      "conversations",
      `${conversationId}.db`,
    ),
    path.join(os.homedir(), ".gemini", "antigravity-cli", "conversations", `${conversationId}.db`),
  ];
  for (const dbPath of candidates) {
    try {
      if (!fs.existsSync(dbPath)) continue;
      const raw = fs.readFileSync(dbPath).toString("latin1");
      const mCwd = raw.match(/Command Working Directory:\s*(\/[^\s<"]+)/);
      if (mCwd?.[1]) {
        const cleaned = stripTrailingControlChars(mCwd[1]);
        if (cleaned.startsWith("/")) {
          return path.resolve(cleaned);
        }
      }
      const mAct = raw.match(/Active Workspaces:\s*\r?\n-\s*(\/[^\s<"]+)/);
      if (mAct?.[1]) {
        const cleaned = stripTrailingControlChars(mAct[1]);
        if (cleaned.startsWith("/")) {
          return path.resolve(cleaned);
        }
      }
    } catch {
      // ignore unreadable db
    }
  }
  return null;
}

/**
 * Resolves Antigravity `share`/`branch` git worktrees (`/worktrees/<parentCid>/swarm-*` or `.git` worktree file)
 * back to their canonical main project repository, even after `swarm kill` deletes the worktree folder!
 */
function resolveWorkspaceToCanonicalRepo(rawWs: string, transcriptPath: string): string {
  const ws = path.resolve(rawWs);
  try {
    const dotGitPath = path.join(ws, ".git");
    if (fs.existsSync(dotGitPath) && fs.statSync(dotGitPath).isFile()) {
      const gitPtr = fs.readFileSync(dotGitPath, "utf-8");
      const mGit = gitPtr.match(/^gitdir:\s*(.+?)\/\.git\/worktrees\//m);
      if (mGit?.[1]) {
        return path.resolve(mGit[1].trim());
      }
    }
  } catch {
    // ignore
  }

  const normalized = ws.replace(/\\/g, "/");
  const worktreeMatch = normalized.match(/\/worktrees\/([0-9a-fA-F-]{36})\/swarm-/);
  if (worktreeMatch?.[1]) {
    const parentWs = extractRawWorkspaceFromDbForCid(transcriptPath, worktreeMatch[1]);
    if (parentWs) {
      return parentWs;
    }
  }

  return ws;
}

function extractAntigravityWorkspaceFromDb(
  transcriptPath: string,
  conversationId: string,
): string | null {
  const rawWs = extractRawWorkspaceFromDbForCid(transcriptPath, conversationId);
  if (!rawWs) return null;
  return resolveWorkspaceToCanonicalRepo(rawWs, transcriptPath);
}

/**
 * Decodes Antigravity CLI JSON-stringified `tool_calls[].args` values (`"\"aice splice ...\\n...\""`),
 * including truncated compact strings (`"<truncated N bytes>"`), while passing plain strings through untouched.
 */
function decodeTranscriptArgString(val: unknown): string | null {
  if (typeof val !== "string") return null;
  if (val.startsWith('"') && val.endsWith('"') && val.length >= 2) {
    try {
      const parsed: unknown = JSON.parse(val);
      if (typeof parsed === "string") {
        return parsed;
      }
    } catch {
      // fall through to manual unescape
    }
  }
  if (val.startsWith('"')) {
    const stripped = val
      .slice(1)
      .replace(/\n?<truncated \d+ bytes>[\s\S]*$/, "")
      .replace(/"$/, "");
    return stripped
      .replace(/\\n/g, "\n")
      .replace(/\\r/g, "\r")
      .replace(/\\t/g, "\t")
      .replace(/\\"/g, '"')
      .replace(/\\\\/g, "\\");
  }
  return val;
}

const AICE_READ_SUBCOMMANDS = new Set([
  "read",
  "search",
  "grep",
  "find",
  "tree",
  "outline",
  "context",
  "ctx",
  "decompile",
]);

const AICE_WRITE_SUBCOMMANDS = new Set(["write", "splice", "create", "patch"]);
const NATIVE_READ_TOOLS = new Set(["read_file", "view_file"]);
const NATIVE_WRITE_TOOLS = new Set([
  "write_file",
  "write_to_file",
  "edit_file",
  "replace_file_content",
  "multi_replace_file_content",
]);

const NON_CODE_BYPASS_EXTENSIONS = new Set([
  ".txt",
  ".log",
  ".png",
  ".jpg",
  ".jpeg",
  ".gif",
  ".webp",
  ".svg",
  ".ico",
  ".mp3",
  ".wav",
  ".ogg",
  ".mp4",
  ".webm",
  ".pdf",
  ".zip",
  ".tar",
  ".gz",
  ".wasm",
  ".ttf",
  ".woff",
  ".woff2",
  ".db",
  ".sqlite",
  ".lock",
]);

const EXTENSIONLESS_KNOWN_FILES =
  /^(?:verify|new-project|Makefile|Dockerfile|Containerfile|Vagrantfile|Jenkinsfile|Procfile|LICENSE|NOTICE|README)$/i;

function isCountableNativeFileBypass(
  rawFilePath: string,
  baseDir: string,
  targetProjectRoot: string,
): boolean {
  const normRaw = rawFilePath.replace(/\\/g, "/");
  if (
    normRaw.includes("/.gemini/") ||
    normRaw.includes("/.system_generated/") ||
    normRaw.includes("/brain/")
  ) {
    return false;
  }
  const resolved = path.isAbsolute(rawFilePath)
    ? path.resolve(rawFilePath)
    : path.resolve(baseDir, rawFilePath);
  if (resolved !== targetProjectRoot && !resolved.startsWith(`${targetProjectRoot}${path.sep}`)) {
    return false;
  }
  const ext = path.extname(resolved).toLowerCase();
  if (ext && NON_CODE_BYPASS_EXTENSIONS.has(ext)) {
    return false;
  }
  return true;
}

function splitHeredocCommand(cmd: string): {
  commandText: string;
  heredocTargetPaths: string[];
} {
  const rawLines = cmd.split("\n");
  const cmdLines: string[] = [];
  const heredocTargetPaths: string[] = [];
  let activeDelim: string | null = null;

  for (const line of rawLines) {
    if (activeDelim !== null) {
      if (line.trim() === activeDelim) {
        activeDelim = null;
        continue;
      }
      const headerMatch = line.match(/^===\s*(.+?)\s*===(?:\s+--delete)?\s*$/);
      if (headerMatch?.[1] && !/^=+$/.test(headerMatch[1].trim())) {
        heredocTargetPaths.push(headerMatch[1]);
      }
      continue;
    }

    cmdLines.push(line);
    const heredocOpen = line.match(/<<-?\s*['"]?([A-Za-z0-9_]+)['"]?/);
    if (heredocOpen?.[1]) {
      activeDelim = heredocOpen[1];
    }
  }

  return {
    commandText: cmdLines.join("\n"),
    heredocTargetPaths,
  };
}

function splitShellSegmentsOutsideQuotes(commandText: string): string[] {
  const segments: string[] = [];
  let current = "";
  let quote: "'" | '"' | "`" | null = null;

  for (let i = 0; i < commandText.length; i++) {
    const ch = commandText[i] ?? "";
    if (quote !== null) {
      if (ch === "\\" && quote !== "'" && i + 1 < commandText.length) {
        current += ch + (commandText[++i] ?? "");
        continue;
      }
      if (ch === quote) {
        quote = null;
      }
      current += ch;
      continue;
    }
    if (ch === "'" || ch === '"' || ch === "`") {
      quote = ch;
      current += ch;
      continue;
    }
    if (ch === "\n" || ch === ";") {
      if (current.trim()) segments.push(current);
      current = "";
      continue;
    }
    if ((ch === "&" && commandText[i + 1] === "&") || (ch === "|" && commandText[i + 1] === "|")) {
      if (current.trim()) segments.push(current);
      current = "";
      i++;
      continue;
    }
    if (ch === "|") {
      if (current.trim()) segments.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  if (current.trim()) {
    segments.push(current);
  }
  return segments;
}

function tokenizeShellWords(segment: string): string[] {
  const tokens: string[] = [];
  const re = /'([^']*)'|"((?:\\.|[^"\\])*)"|`([^`]*)`|([^\s'"`]+)/g;
  for (const m of segment.matchAll(re)) {
    const tok = m[1] ?? m[2] ?? m[3] ?? m[4] ?? "";
    if (tok) {
      tokens.push(tok);
    }
  }
  return tokens;
}

interface ParsedAiceCliInvocation {
  subcommands: string[];
  hasHelpOnly: boolean;
  hasNonAiceSegment: boolean;
  readTargetCandidates: string[];
  writeTargetCandidates: string[];
}

function stripShellRedirectTokens(words: string[]): string[] {
  const cleaned: string[] = [];
  for (let i = 0; i < words.length; i++) {
    const tok = words[i] ?? "";
    if (!tok) continue;
    // Standalone redirect operator whose target is the next token: >, >>, 2>, &>, <, <<-
    if (/^(?:\d*(?:>>?|<<-?|>&|<&)|&>>?)$/.test(tok)) {
      i++;
      continue;
    }
    // Attached redirect token: 2>/dev/null, 2>&1, >/dev/null, &>/tmp/out, <<'EOF', 1>/dev/null
    if (/^(?:\d*(?:>>?|<<-?|>&|<&)|&>>?).+/.test(tok)) {
      continue;
    }
    cleaned.push(tok);
  }
  return cleaned;
}

function extractAiceCliInvocations(
  commandText: string,
  heredocTargetPaths: string[],
): ParsedAiceCliInvocation {
  const subcommands: string[] = [];
  let nonHelpCount = 0;
  let helpCount = 0;
  let hasNonAiceSegment = false;
  const readTargetCandidates: string[] = [];
  const writeTargetCandidates: string[] = [];

  const segments = splitShellSegmentsOutsideQuotes(commandText);
  const readFlagsWithValue = new Set([
    "-s",
    "--symbol",
    "--search",
    "-C",
    "-c",
    "--context",
    "--context-lines",
    "-d",
    "--depth",
    "--max-depth",
    "-L",
    "--max-tokens",
  ]);
  const writeFlagsWithValue = new Set([
    "-s",
    "--symbol",
    "-c",
    "--code",
    "-t",
    "--template",
    "-b",
    "--body",
    "--from",
    "--insert-after",
    "--insert-before",
    "--edits",
    "--batch",
    "--idiom",
  ]);

  let sawAnyAiceWrite = false;

  for (const seg of segments) {
    const rawWords = tokenizeShellWords(seg);
    const words = stripShellRedirectTokens(rawWords);
    if (words.length === 0) continue;

    let idx = 0;
    while (idx < words.length && /^[A-Za-z_][A-Za-z0-9_]*=/.test(words[idx] ?? "")) {
      idx++;
    }
    while (
      idx < words.length &&
      /^(?:env|npx|tsx|node|bun)$/.test(path.basename(words[idx] ?? ""))
    ) {
      idx++;
      while (idx < words.length && words[idx]?.startsWith("-")) {
        idx++;
      }
    }
    if (idx >= words.length || !/(?:^|\/)aice(?:\.mjs|\.ts)?$/.test(words[idx] ?? "")) {
      if (idx < words.length) {
        hasNonAiceSegment = true;
      }
      continue;
    }

    const leadingFlags = words.slice(idx + 1);
    let subIdx = idx + 1;
    while (subIdx < words.length && words[subIdx]?.startsWith("-")) {
      subIdx++;
    }
    if (subIdx >= words.length) {
      if (
        leadingFlags.some(
          (f) => f === "--help" || f === "-h" || f === "--version" || f === "-V" || f === "-v",
        )
      ) {
        helpCount++;
      }
      continue;
    }

    const sub = (words[subIdx] ?? "").toLowerCase();
    if (!sub || !/^[a-z][a-z0-9_-]*$/.test(sub)) continue;
    const rest = words.slice(subIdx + 1);
    const preFlags = words.slice(idx + 1, subIdx);
    const isHelp =
      preFlags.includes("--help") ||
      preFlags.includes("-h") ||
      rest.includes("--help") ||
      rest.includes("-h");
    if (isHelp) helpCount++;
    else nonHelpCount++;

    subcommands.push(sub);

    if (
      sub === "read" ||
      sub === "outline" ||
      sub === "context" ||
      sub === "ctx" ||
      sub === "decompile"
    ) {
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i] ?? "";
        if (!tok) continue;
        if (tok === ">" || tok === ">>" || tok === "<" || tok.startsWith("<<")) break;
        if (tok === "-f" || tok === "--file") {
          const nextTok = rest[++i];
          if (nextTok) readTargetCandidates.push(nextTok);
          continue;
        }
        if (readFlagsWithValue.has(tok)) {
          i++;
          continue;
        }
        if (tok.startsWith("-")) continue;
        readTargetCandidates.push(tok);
      }
    } else if (sub === "search" || sub === "grep") {
      const positionals: string[] = [];
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i] ?? "";
        if (!tok) continue;
        if (tok === ">" || tok === ">>" || tok === "<" || tok.startsWith("<<")) break;
        if (readFlagsWithValue.has(tok)) {
          i++;
          continue;
        }
        if (tok.startsWith("-")) continue;
        positionals.push(tok);
      }
      for (const target of positionals.slice(1)) {
        readTargetCandidates.push(target);
      }
    } else if (sub === "find" || sub === "tree") {
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i] ?? "";
        if (!tok) continue;
        if (tok === ">" || tok === ">>" || tok === "<" || tok.startsWith("<<")) break;
        if (readFlagsWithValue.has(tok)) {
          i++;
          continue;
        }
        if (tok.startsWith("-")) continue;
        readTargetCandidates.push(tok);
      }
    } else if (AICE_WRITE_SUBCOMMANDS.has(sub)) {
      sawAnyAiceWrite = true;
      let capturedPositionalPath = false;
      for (let i = 0; i < rest.length; i++) {
        const tok = rest[i] ?? "";
        if (!tok) continue;
        if (tok === ">" || tok === ">>" || tok === "<" || tok.startsWith("<<")) break;
        if (tok === "-f" || tok === "--file") {
          const nextTok = rest[++i];
          if (nextTok) writeTargetCandidates.push(nextTok);
          continue;
        }
        if (writeFlagsWithValue.has(tok)) {
          i++;
          continue;
        }
        if (tok.startsWith("-")) continue;
        if (!capturedPositionalPath) {
          writeTargetCandidates.push(tok);
          capturedPositionalPath = true;
        }
      }
    }
  }

  if (sawAnyAiceWrite) {
    writeTargetCandidates.push(...heredocTargetPaths);
  }

  return {
    subcommands,
    hasHelpOnly: helpCount > 0 && nonHelpCount === 0,
    hasNonAiceSegment,
    readTargetCandidates,
    writeTargetCandidates,
  };
}

function normalizeTranscriptTargetFile(
  rawTarget: string,
  baseDir: string,
  projectRoot: string,
): string | null {
  const unquoted = rawTarget.replace(/^['"`]|['"`]$/g, "").trim();
  if (!unquoted || unquoted.startsWith("-")) return null;
  if (/^\/[^/]+\/[gimsuy]*$/.test(unquoted)) return null;

  const colonIdx = /^[A-Za-z]:[\\/]/.test(unquoted)
    ? unquoted.indexOf(":", 2)
    : unquoted.indexOf(":");
  const withoutSelector = (colonIdx >= 0 ? unquoted.slice(0, colonIdx) : unquoted).trim();
  if (
    !withoutSelector ||
    withoutSelector === "." ||
    withoutSelector === ".." ||
    withoutSelector.endsWith("/") ||
    /[*?[\]{}]/.test(withoutSelector)
  ) {
    return null;
  }

  const resolved = path.isAbsolute(withoutSelector)
    ? path.resolve(withoutSelector)
    : path.resolve(baseDir, withoutSelector);

  try {
    if (fs.existsSync(resolved)) {
      if (fs.statSync(resolved).isDirectory()) {
        return null;
      }
    } else {
      const base = path.basename(resolved);
      if (path.extname(base) === "" && !EXTENSIONLESS_KNOWN_FILES.test(base)) {
        return null;
      }
    }
  } catch {
    return null;
  }

  const rel = path.relative(projectRoot, resolved).replace(/\\/g, "/");
  if (!rel || rel === "." || rel === ".." || rel.startsWith("../")) {
    return null;
  }
  return rel;
}

interface PendingToolSlot {
  turnStepIdx: number;
  turnOutputTokens: number;
  isAiceCall: boolean;
  isHelpOnly: boolean;
  hasNonAiceSegment: boolean;
  aiceSubcommands: string[];
  hasWriteSubcommand: boolean;
}

function parseTranscriptFile(
  transcriptPath: string,
  conversationId: string,
  source: "antigravity" | "claude" | "transcript",
  targetProjectRoot: string,
): AnalyzedSessionSummary | null {
  let raw = "";
  try {
    raw = fs.readFileSync(transcriptPath, "utf-8");
  } catch {
    return null;
  }

  const lines = raw
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) return null;

  let workspace: string | null = extractAntigravityWorkspaceFromDb(transcriptPath, conversationId);
  let isOrchestratorRunner = false;
  let projectToolTargetHits = 0;
  let externalTmpToolTargetHits = 0;

  let inputTokensUncached = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let checkpointCompactions = 0;
  let checkpointInputTokens = 0;
  let checkpointCacheReadTokens = 0;
  let checkpointOutputTokens = 0;
  let toolPayloadTokensEst = 0;
  let llmTurns = 0;
  let toolCallsTotal = 0;

  const aiceSubcommands: Record<string, number> = {};
  const aiceSubcommandErrors: Record<string, number> = {};
  let aiceHardErrorsTotal = 0;
  const failedAndRetryTurnTokens = new Map<number, number>();
  const spliceFailedAndRetryTurnTokens = new Map<number, number>();

  const nativeFileBypasses: Record<string, number> = {};
  const errors: AnalyzedSessionSummary["errors"] = [];
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let firstIso: string | null = null;
  let lastIso: string | null = null;
  let lastStep: Record<string, unknown> = {};

  let transcriptReadCalls = 0;
  let transcriptWriteCalls = 0;
  let transcriptNativeCl100k = 0;
  let transcriptAiceCl100k = 0;
  let transcriptSavedCl100k = 0;
  let pendingSpliceAiceTokens = 0;

  let readTurns = 0;
  let currentReadStreak = 0;
  let maxConsecutiveReadStreak = 0;
  let extraReadTurns = 0;
  const activeFileReadStreaks = new Map<string, number>();
  const sameFileRepeatReadChains: SameFileRepeatReadChain[] = [];

  const nativeBypassTools = new Set([
    "read_file",
    "view_file",
    "write_file",
    "write_to_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
  ]);

  let pendingToolSlots: PendingToolSlot[] = [];
  let pendingSlotCursor = 0;
  let awaitingRetryTurn = false;
  let awaitingRetryHadWriteFailure = false;

  const recordPathHitForAttribution = (
    rawPath: string,
    baseCwd: string | null = workspace,
  ): void => {
    const clean = rawPath.replace(/^['"`]|['"`]$/g, "").trim();
    if (!clean) return;
    const colonIdx = /^[A-Za-z]:[\\/]/.test(clean) ? clean.indexOf(":", 2) : clean.indexOf(":");
    const pathPart = colonIdx >= 0 ? clean.slice(0, colonIdx) : clean;
    if (!pathPart) return;
    const resolvedPart = path.isAbsolute(pathPart)
      ? path.resolve(pathPart)
      : baseCwd
        ? path.resolve(baseCwd, pathPart)
        : null;
    if (
      resolvedPart !== null &&
      (resolvedPart === targetProjectRoot ||
        resolvedPart.startsWith(`${targetProjectRoot}${path.sep}`))
    ) {
      projectToolTargetHits++;
    } else if (
      resolvedPart !== null &&
      (resolvedPart.startsWith("/tmp/") || resolvedPart.startsWith(`${os.tmpdir()}${path.sep}`)) &&
      !targetProjectRoot.startsWith("/tmp/") &&
      !targetProjectRoot.startsWith(`${os.tmpdir()}${path.sep}`)
    ) {
      externalTmpToolTargetHits++;
    }
  };

  for (let i = 0; i < lines.length; i++) {
    let step: Record<string, unknown>;
    try {
      step = JSON.parse(lines[i] ?? "") as Record<string, unknown>;
    } catch {
      continue;
    }
    lastStep = step;
    const idx = typeof step.step_index === "number" ? step.step_index : i;
    const stype = typeof step.type === "string" ? step.type : "";
    const status = typeof step.status === "string" ? step.status : "";
    const createdAt =
      typeof step.created_at === "string"
        ? step.created_at
        : typeof step.timestamp === "string"
          ? step.timestamp
          : null;

    if (createdAt) {
      const ms = Date.parse(createdAt);
      if (!Number.isNaN(ms)) {
        if (firstTs === null || ms < firstTs) {
          firstTs = ms;
          firstIso = createdAt;
        }
        if (lastTs === null || ms > lastTs) {
          lastTs = ms;
          lastIso = createdAt;
        }
      }
    }

    const content = String(step.content ?? "");
    if (!workspace) {
      const mCwd = content.match(/Command Working Directory:\s*(\/[^\s<"]+)/);
      const mAct = !mCwd ? content.match(/Active Workspaces:\s*\r?\n-\s*(\/[^\s<"]+)/) : null;
      const rawMatched = mCwd?.[1] ?? mAct?.[1];
      const cleaned = rawMatched ? stripTrailingControlChars(rawMatched) : "";
      if (cleaned.startsWith("/")) {
        workspace = resolveWorkspaceToCanonicalRepo(cleaned, transcriptPath);
      } else if (typeof step.cwd === "string" && step.cwd.startsWith("/")) {
        workspace = resolveWorkspaceToCanonicalRepo(step.cwd, transcriptPath);
      }
    }
    if (content.includes("watch_campaign.py") || content.includes("watch_benchmark.py")) {
      isOrchestratorRunner = true;
    }

    if (stype === "CHECKPOINT") {
      checkpointCompactions++;
      const usage = (step.usage as Record<string, unknown> | undefined) ?? step;
      checkpointInputTokens += Number(usage.input_tokens ?? 0) || 0;
      checkpointCacheReadTokens +=
        Number(usage.cache_read_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
      checkpointOutputTokens += Number(usage.output_tokens ?? 0) || 0;
      continue;
    }

    if (stype === "PLANNER_RESPONSE" || stype === "assistant") {
      llmTurns++;
      const usage = (step.usage as Record<string, unknown> | undefined) ?? step;
      const it = Number(usage.input_tokens ?? 0) || 0;
      const ct = Number(usage.cache_read_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
      const ot = Number(usage.output_tokens ?? 0) || 0;
      inputTokensUncached += it;
      cacheReadTokens += ct;
      outputTokens += ot;

      const tcs = Array.isArray(step.tool_calls) ? step.tool_calls : [];

      // If previous turn had a hard AICE failure and this immediate next turn retries any tool call,
      // include this retry turn in the deduplicated union of failed+retry output_tokens!
      if (awaitingRetryTurn) {
        if (tcs.length > 0) {
          failedAndRetryTurnTokens.set(idx, ot);
          if (awaitingRetryHadWriteFailure) {
            spliceFailedAndRetryTurnTokens.set(idx, ot);
          }
        }
        awaitingRetryTurn = false;
        awaitingRetryHadWriteFailure = false;
      }

      pendingToolSlots = [];
      pendingSlotCursor = 0;

      let turnHasRead = false;
      let turnHasWrite = false;
      const turnReadFiles = new Set<string>();
      const effectiveBaseDir = workspace ?? targetProjectRoot;

      for (const tcRaw of tcs) {
        const tc = (tcRaw ?? {}) as Record<string, unknown>;
        const name = typeof tc.name === "string" ? tc.name : "unknown";
        const args = (tc.args ?? tc.input ?? {}) as Record<string, unknown>;
        toolCallsTotal++;

        // Decode JSON-stringified arg strings so token estimation & command parsing see true payloads
        const decodedArgsForEstimate: Record<string, unknown> = {};
        for (const [ak, av] of Object.entries(args)) {
          decodedArgsForEstimate[ak] = typeof av === "string" ? decodeTranscriptArgString(av) : av;
        }
        toolPayloadTokensEst += estimateTokens(
          JSON.stringify(decodedArgsForEstimate),
          "cl100k_base",
        );

        const slotSubcommands: string[] = [];
        let slotHasHelpOnly = false;
        let slotHasNonAiceSegment = false;
        let slotHasWrite = false;

        const rawPVal = args.Path ?? args.file_path ?? args.target_file ?? args.path;
        const pVal = decodeTranscriptArgString(rawPVal);
        if (typeof pVal === "string") {
          const cleanP = pVal.replace(/^['"`]|['"`]$/g, "");
          recordPathHitForAttribution(cleanP);

          if (nativeBypassTools.has(name)) {
            if (isCountableNativeFileBypass(cleanP, effectiveBaseDir, targetProjectRoot)) {
              nativeFileBypasses[name] = (nativeFileBypasses[name] ?? 0) + 1;
              if (NATIVE_READ_TOOLS.has(name)) {
                turnHasRead = true;
              } else if (NATIVE_WRITE_TOOLS.has(name)) {
                turnHasWrite = true;
              }
            }
          } else if (NATIVE_READ_TOOLS.has(name)) {
            turnHasRead = true;
          } else if (NATIVE_WRITE_TOOLS.has(name)) {
            turnHasWrite = true;
          }

          if (NATIVE_READ_TOOLS.has(name)) {
            const normFile = normalizeTranscriptTargetFile(
              cleanP,
              effectiveBaseDir,
              targetProjectRoot,
            );
            if (normFile) turnReadFiles.add(normFile);
          }
        } else if (nativeBypassTools.has(name)) {
          nativeFileBypasses[name] = (nativeFileBypasses[name] ?? 0) + 1;
        }

        const rawCmdVal = args.CommandLine ?? args.command;
        const cmdVal = decodeTranscriptArgString(rawCmdVal);
        if (typeof cmdVal === "string") {
          const cleanCmd = cmdVal.trim();
          if (cleanCmd.includes("watch_campaign.py") || cleanCmd.includes("agy -p")) {
            isOrchestratorRunner = true;
          }
          const { commandText, heredocTargetPaths } = splitHeredocCommand(cleanCmd);
          const cdMatch = commandText.match(/(?:^|&&|;|\n)\s*cd\s+['"]?(\/[^\s;&|'"]+)['"]?/);
          const effectiveCmdDir = cdMatch?.[1] ? path.resolve(cdMatch[1]) : effectiveBaseDir;
          const parsedCli = extractAiceCliInvocations(commandText, heredocTargetPaths);
          slotHasHelpOnly = parsedCli.hasHelpOnly;
          slotHasNonAiceSegment = parsedCli.hasNonAiceSegment;

          for (const sub of parsedCli.subcommands) {
            aiceSubcommands[sub] = (aiceSubcommands[sub] ?? 0) + 1;
            slotSubcommands.push(sub);
            if (AICE_READ_SUBCOMMANDS.has(sub)) {
              turnHasRead = true;
            } else if (AICE_WRITE_SUBCOMMANDS.has(sub)) {
              turnHasWrite = true;
              slotHasWrite = true;
            }
            if (sub === "splice" || sub === "write") {
              pendingSpliceAiceTokens = estimateTokens(cleanCmd, "cl100k_base");
            }
          }

          for (const rawCand of [
            ...parsedCli.readTargetCandidates,
            ...parsedCli.writeTargetCandidates,
          ]) {
            recordPathHitForAttribution(rawCand, effectiveCmdDir);
          }
          for (const rawReadCand of parsedCli.readTargetCandidates) {
            const normFile = normalizeTranscriptTargetFile(
              rawReadCand,
              effectiveCmdDir,
              targetProjectRoot,
            );
            if (normFile) {
              turnReadFiles.add(normFile);
            }
          }
        }

        const rawToolName = args.ToolName;
        const toolNameVal = decodeTranscriptArgString(rawToolName);
        let mcpToolClean: string | null = null;
        if (typeof toolNameVal === "string") {
          mcpToolClean = toolNameVal.replace(/^['"`]|['"`]$/g, "");
          const mcpKey = `mcp:${mcpToolClean}`;
          aiceSubcommands[mcpKey] = (aiceSubcommands[mcpKey] ?? 0) + 1;
          slotSubcommands.push(mcpKey);
        } else if (
          /^(?:mcp[_a-z0-9]*?_)?aice_(read|write|splice|outline|context|decompile|create|patch)$/i.test(
            name,
          )
        ) {
          mcpToolClean = name.replace(/^mcp[_a-z0-9]*?_(?=aice_)/i, "").toLowerCase();
          const mcpKey = `mcp:${mcpToolClean}`;
          aiceSubcommands[mcpKey] = (aiceSubcommands[mcpKey] ?? 0) + 1;
          slotSubcommands.push(mcpKey);
        }

        if (mcpToolClean) {
          const lowerMcp = mcpToolClean.toLowerCase();
          if (
            lowerMcp.includes("read") ||
            lowerMcp.includes("outline") ||
            lowerMcp.includes("context") ||
            lowerMcp.includes("decompile")
          ) {
            turnHasRead = true;
            const mcpTargets: string[] = [];
            if (Array.isArray(decodedArgsForEstimate.targets)) {
              for (const t of decodedArgsForEstimate.targets) {
                if (typeof t === "string") mcpTargets.push(t);
              }
            }
            if (Array.isArray(decodedArgsForEstimate.paths)) {
              for (const t of decodedArgsForEstimate.paths) {
                if (typeof t === "string") mcpTargets.push(t);
              }
            }
            if (typeof decodedArgsForEstimate.path === "string") {
              mcpTargets.push(decodedArgsForEstimate.path);
            }
            if (typeof decodedArgsForEstimate.target === "string") {
              mcpTargets.push(decodedArgsForEstimate.target);
            }
            for (const mt of mcpTargets) {
              recordPathHitForAttribution(mt);
              const normFile = normalizeTranscriptTargetFile(
                mt,
                effectiveBaseDir,
                targetProjectRoot,
              );
              if (normFile) turnReadFiles.add(normFile);
            }
          } else if (
            lowerMcp.includes("splice") ||
            lowerMcp.includes("write") ||
            lowerMcp.includes("create") ||
            lowerMcp.includes("patch")
          ) {
            turnHasWrite = true;
            slotHasWrite = true;
          }
        }

        pendingToolSlots.push({
          turnStepIdx: idx,
          turnOutputTokens: ot,
          isAiceCall: slotSubcommands.length > 0,
          isHelpOnly: slotHasHelpOnly,
          hasNonAiceSegment: slotHasNonAiceSegment,
          aiceSubcommands: slotSubcommands,
          hasWriteSubcommand: slotHasWrite,
        });
      }

      let hasSameFileRepeatRead = false;
      for (const rf of turnReadFiles) {
        if ((activeFileReadStreaks.get(rf) ?? 0) >= 1) {
          hasSameFileRepeatRead = true;
          break;
        }
      }

      if (turnHasRead) {
        readTurns++;
        if (hasSameFileRepeatRead) {
          extraReadTurns++;
        }
        if (turnHasWrite) {
          const settledStreak = currentReadStreak + 1;
          if (settledStreak > maxConsecutiveReadStreak) {
            maxConsecutiveReadStreak = settledStreak;
          }
          currentReadStreak = 0;
        } else {
          currentReadStreak++;
          if (currentReadStreak > maxConsecutiveReadStreak) {
            maxConsecutiveReadStreak = currentReadStreak;
          }
        }
      } else {
        currentReadStreak = 0;
      }

      if (turnHasWrite) {
        if (turnHasRead) {
          for (const rf of turnReadFiles) {
            activeFileReadStreaks.set(rf, (activeFileReadStreaks.get(rf) ?? 0) + 1);
          }
        }
        for (const [trackedFile, streak] of activeFileReadStreaks.entries()) {
          if (streak >= 2) {
            sameFileRepeatReadChains.push({
              conversationId,
              filePath: trackedFile,
              turns: streak,
            });
          }
        }
        activeFileReadStreaks.clear();
      } else {
        for (const [trackedFile, streak] of activeFileReadStreaks.entries()) {
          if (!turnReadFiles.has(trackedFile)) {
            if (streak >= 2) {
              sameFileRepeatReadChains.push({
                conversationId,
                filePath: trackedFile,
                turns: streak,
              });
            }
            activeFileReadStreaks.delete(trackedFile);
          }
        }
        for (const rf of turnReadFiles) {
          activeFileReadStreaks.set(rf, (activeFileReadStreaks.get(rf) ?? 0) + 1);
        }
      }
      continue;
    }

    if (stype === "SYSTEM_MESSAGE" || stype === "USER_INPUT") {
      continue;
    }

    // Tool response / GENERIC / ERROR_MESSAGE step
    const matchedSlot =
      pendingSlotCursor < pendingToolSlots.length ? pendingToolSlots[pendingSlotCursor++] : null;
    if (content) {
      for (const mCreate of content.matchAll(
        /Native:\s*(\d+)\s*->\s*AICE:\s*(\d+)\s*cl100k tokens,\s*net saved:\s*([+-]?\d+)/g,
      )) {
        const nat = Number(mCreate[1]) || 0;
        const aice = Number(mCreate[2]) || 0;
        const saved = Number(mCreate[3]) || 0;
        transcriptWriteCalls++;
        transcriptNativeCl100k += nat;
        transcriptAiceCl100k += aice;
        transcriptSavedCl100k += saved;
      }
      for (const mCreateClean of content.matchAll(
        /(?:Batch created|Created)\b[^\n]*?\((\d+)\s*cl100k tokens(?:,\s*saved:\s*([+-]?\d+))?/g,
      )) {
        if (mCreateClean[0]?.includes("Native:")) continue;
        const aice = Number(mCreateClean[1]) || 0;
        const saved = Number(mCreateClean[2]) || 0;
        const nat = aice + saved;
        transcriptWriteCalls++;
        transcriptNativeCl100k += nat;
        transcriptAiceCl100k += aice;
        transcriptSavedCl100k += saved;
      }
      for (const mSplice of content.matchAll(
        /(?:Batch spliced|Spliced)\b[^\n]*\(([+-]?\d+)\s+tokens saved\)/g,
      )) {
        const saved = Number(mSplice[1]) || 0;
        const aice =
          pendingSpliceAiceTokens > 0
            ? pendingSpliceAiceTokens
            : Math.max(10, Math.round(Math.abs(saved) * 0.25));
        const nat = Math.max(0, aice + saved);
        transcriptWriteCalls++;
        transcriptNativeCl100k += nat;
        transcriptAiceCl100k += aice;
        transcriptSavedCl100k += saved;
        pendingSpliceAiceTokens = 0;
      }
      const mOrig = content.match(/Original tokens:\s*([\d,]+)/);
      const mOutl = content.match(/Outline tokens:\s*([\d,]+)/);
      if (mOrig && mOutl) {
        const nat = Number(mOrig[1]?.replace(/,/g, "")) || 0;
        const aice = Number(mOutl[1]?.replace(/,/g, "")) || 0;
        transcriptReadCalls++;
        transcriptNativeCl100k += nat;
        transcriptAiceCl100k += aice;
        transcriptSavedCl100k += nat - aice;
      }
    }

    const cleanedOut = cleanAntigravityToolOutput(content);
    const exitedCleanlyZero = /^Command exited with code 0\b/m.test(cleanedOut);
    const isHardError =
      status === "ERROR" ||
      stype === "ERROR_MESSAGE" ||
      /^Command exited with code [1-9]\d*/m.test(cleanedOut) ||
      (!exitedCleanlyZero &&
        (/^❌ Error\b/m.test(cleanedOut) || /"isError"\s*:\s*true/.test(cleanedOut)));
    if (isHardError) {
      const aiceWriteSucceededBeforeChainErr =
        /✔\s*(?:Batch\s+)?(?:Spliced|Created|Patched)\b/i.test(cleanedOut) &&
        !/^❌\s*Error\b/m.test(cleanedOut) &&
        !/^error:\s+(?:unknown|missing|option|argument)\b/im.test(cleanedOut) &&
        !/"isError"\s*:\s*true/.test(cleanedOut);
      const aiceReadSucceededBeforeChainErr =
        Boolean(matchedSlot?.hasNonAiceSegment && !matchedSlot.hasWriteSubcommand) &&
        /^\/\/\s+\S+/m.test(cleanedOut) &&
        !/^❌\s*Error\b/m.test(cleanedOut) &&
        !/^error:\s+/im.test(cleanedOut) &&
        !/Target file not found:/m.test(cleanedOut) &&
        !/"isError"\s*:\s*true/.test(cleanedOut);
      const isAiceErr = Boolean(
        matchedSlot?.isAiceCall &&
          !matchedSlot.isHelpOnly &&
          !aiceWriteSucceededBeforeChainErr &&
          !aiceReadSucceededBeforeChainErr,
      );
      const cause = isAiceErr ? classifyFrictionCause(cleanedOut) : undefined;
      errors.push({
        step: idx,
        at: createdAt,
        snippet: cleanedOut.slice(0, 350),
        isAiceError: isAiceErr,
        cause,
      });

      if (isAiceErr && matchedSlot) {
        aiceHardErrorsTotal++;
        const primaryFailedSub =
          matchedSlot.aiceSubcommands[matchedSlot.aiceSubcommands.length - 1] ??
          matchedSlot.aiceSubcommands[0];
        if (primaryFailedSub) {
          aiceSubcommandErrors[primaryFailedSub] =
            (aiceSubcommandErrors[primaryFailedSub] ?? 0) + 1;
        }
        failedAndRetryTurnTokens.set(matchedSlot.turnStepIdx, matchedSlot.turnOutputTokens);
        if (matchedSlot.hasWriteSubcommand) {
          spliceFailedAndRetryTurnTokens.set(matchedSlot.turnStepIdx, matchedSlot.turnOutputTokens);
        }
        awaitingRetryTurn = true;
        awaitingRetryHadWriteFailure =
          awaitingRetryHadWriteFailure || matchedSlot.hasWriteSubcommand;
      }
    }
  }

  for (const [trackedFile, streak] of activeFileReadStreaks.entries()) {
    if (streak >= 2) {
      sameFileRepeatReadChains.push({
        conversationId,
        filePath: trackedFile,
        turns: streak,
      });
    }
  }
  activeFileReadStreaks.clear();

  let matchesTarget = false;
  if (workspace !== null) {
    if (workspace === targetProjectRoot) {
      matchesTarget = true;
    } else if (workspace.startsWith(`${targetProjectRoot}${path.sep}`)) {
      const enclosingRoot = findProjectRoot(workspace, targetProjectRoot);
      matchesTarget = path.resolve(enclosingRoot) === targetProjectRoot;
    }
    // Exclude /tmp sandbox sessions spawned from targetProjectRoot that predominantly operated inside /tmp
    if (
      matchesTarget &&
      externalTmpToolTargetHits >= 3 &&
      externalTmpToolTargetHits > projectToolTargetHits * 3 &&
      !targetProjectRoot.startsWith("/tmp/") &&
      !targetProjectRoot.startsWith(`${os.tmpdir()}${path.sep}`)
    ) {
      matchesTarget = false;
    }
  } else if (projectToolTargetHits > 0 && !isOrchestratorRunner) {
    matchesTarget = true;
  }

  if (!matchesTarget) {
    return null;
  }

  const wallClockSeconds =
    firstTs !== null && lastTs !== null && lastTs >= firstTs
      ? Math.round(((lastTs - firstTs) / 1000) * 100) / 100
      : 0;
  const isFinished =
    (lastStep.type === "PLANNER_RESPONSE" || lastStep.type === "assistant") &&
    lastStep.status === "DONE" &&
    (!Array.isArray(lastStep.tool_calls) || lastStep.tool_calls.length === 0);

  const boundedToolPayload = Math.min(outputTokens, toolPayloadTokensEst);
  const thinkingTokensEst = Math.max(0, outputTokens - boundedToolPayload);
  const thinkingRatioPct =
    outputTokens > 0 ? Math.round((thinkingTokensEst / outputTokens) * 100) : 0;
  const toolPayloadRatioPct = outputTokens > 0 ? 100 - thinkingRatioPct : 0;

  const totalPrompt = inputTokensUncached + cacheReadTokens;
  const cacheHitPct =
    totalPrompt > 0 ? Number(((cacheReadTokens / totalPrompt) * 100).toFixed(2)) : 0;

  let failedAndRetryOutputTokens = 0;
  for (const v of failedAndRetryTurnTokens.values()) {
    failedAndRetryOutputTokens += v;
  }
  let spliceFailedAndRetryOutputTokens = 0;
  for (const v of spliceFailedAndRetryTurnTokens.values()) {
    spliceFailedAndRetryOutputTokens += v;
  }

  return {
    conversationId,
    source,
    workspace: workspace ?? targetProjectRoot,
    totalSteps: lines.length,
    llmTurns,
    checkpointCompactions,
    checkpointInputTokens,
    checkpointCacheReadTokens,
    checkpointOutputTokens,
    toolCallsTotal,
    aiceSubcommands,
    aiceSubcommandErrors,
    aiceHardErrorsTotal,
    failedAndRetryTurns: failedAndRetryTurnTokens.size,
    failedAndRetryOutputTokens,
    spliceFailedAndRetryOutputTokens,
    nativeFileBypasses,
    inputTokensUncached,
    cacheReadTokens,
    cacheHitPct,
    outputTokens,
    thinkingTokensEst,
    toolPayloadTokensEst: boundedToolPayload,
    thinkingRatioPct,
    toolPayloadRatioPct,
    totalBillableTokens: inputTokensUncached + outputTokens,
    costWeightedEquivalentTokens:
      inputTokensUncached + Math.round(cacheReadTokens * 0.1) + outputTokens * 4,
    totalContextTokensProcessed: inputTokensUncached + cacheReadTokens,
    wallClockSeconds,
    firstTimestamp: firstIso,
    lastTimestamp: lastIso,
    isFinished,
    errorCount: errors.length,
    errors,
    transcriptBpe: {
      totalCalls: transcriptReadCalls + transcriptWriteCalls,
      readCalls: transcriptReadCalls,
      writeCalls: transcriptWriteCalls,
      nativeCl100k: transcriptNativeCl100k,
      aiceCl100k: transcriptAiceCl100k,
      savedCl100k: transcriptSavedCl100k,
    },
    readLoop: {
      readTurns,
      maxConsecutiveReadStreak,
      extraReadTurns,
      sameFileRepeatReadChains,
    },
  };
}

function discoverProjectTranscripts(
  projectRoot: string,
  explicitTranscriptsDir?: string,
): AnalyzedSessionSummary[] {
  const candidates: Array<{
    filePath: string;
    cid: string;
    source: "antigravity" | "claude" | "transcript";
    mtimeMs: number;
  }> = [];

  const addCandidate = (
    filePath: string,
    cid: string,
    source: "antigravity" | "claude" | "transcript",
  ): void => {
    try {
      const st = fs.statSync(filePath);
      if (st.isFile()) {
        candidates.push({ filePath, cid, source, mtimeMs: st.mtimeMs });
      }
    } catch {
      // ignore
    }
  };

  const customDir = explicitTranscriptsDir || process.env.AICE_TRANSCRIPTS_DIR;
  if (customDir) {
    if (!fs.existsSync(customDir)) {
      return [];
    }
    const resolvedCustom = path.resolve(customDir);
    const walkCustom = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      const hasFullInDir = entries.some((e) => e.isFile() && e.name === "transcript_full.jsonl");
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walkCustom(full);
        } else if (e.isFile() && e.name.endsWith(".jsonl")) {
          if (e.name === "transcript.jsonl" && hasFullInDir) {
            continue;
          }
          const isAgyTranscript =
            e.name === "transcript.jsonl" || e.name === "transcript_full.jsonl";
          const cid = isAgyTranscript
            ? path.basename(path.dirname(path.dirname(path.dirname(full))))
            : path.basename(full, ".jsonl");
          addCandidate(full, cid, isAgyTranscript ? "antigravity" : "transcript");
        }
      }
    };
    walkCustom(resolvedCustom);
  } else {
    const brainRoot = path.join(os.homedir(), ".gemini", "antigravity-cli", "brain");
    if (fs.existsSync(brainRoot)) {
      try {
        for (const entry of fs.readdirSync(brainRoot, { withFileTypes: true })) {
          if (!entry.isDirectory()) continue;
          const logsDir = path.join(brainRoot, entry.name, ".system_generated", "logs");
          const fullFile = path.join(logsDir, "transcript_full.jsonl");
          const compactFile = path.join(logsDir, "transcript.jsonl");
          if (fs.existsSync(fullFile)) {
            addCandidate(fullFile, entry.name, "antigravity");
          } else if (fs.existsSync(compactFile)) {
            addCandidate(compactFile, entry.name, "antigravity");
          }
        }
      } catch {
        // ignore
      }
    }

    const claudeRoot = path.join(os.homedir(), ".claude", "projects");
    if (fs.existsSync(claudeRoot)) {
      const walkClaude = (dir: string): void => {
        let entries: fs.Dirent[] = [];
        try {
          entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch {
          return;
        }
        for (const e of entries) {
          const full = path.join(dir, e.name);
          if (e.isDirectory()) {
            walkClaude(full);
          } else if (e.isFile() && e.name.endsWith(".jsonl")) {
            addCandidate(full, path.basename(full, ".jsonl"), "claude");
          }
        }
      };
      walkClaude(claudeRoot);
    }
  }

  candidates.sort((a, b) => b.mtimeMs - a.mtimeMs);
  const matched: AnalyzedSessionSummary[] = [];
  const seenCids = new Set<string>();
  for (const cand of candidates) {
    if (seenCids.has(cand.cid)) continue;
    if (cand.source === "antigravity") {
      const fastDbWs = extractAntigravityWorkspaceFromDb(cand.filePath, cand.cid);
      if (
        fastDbWs !== null &&
        fastDbWs !== projectRoot &&
        !fastDbWs.startsWith(`${projectRoot}${path.sep}`)
      ) {
        continue;
      }
    }
    const parsed = parseTranscriptFile(cand.filePath, cand.cid, cand.source, projectRoot);
    if (parsed) {
      seenCids.add(cand.cid);
      matched.push(parsed);
    }
  }
  return matched;
}

function resolveAnalyzeTargetProjectRoot(options: AnalyzeProjectOptions): string {
  const rawQuery = options.project?.trim();
  if (!rawQuery || rawQuery === ".") {
    return findProjectRoot(process.cwd());
  }

  if (isExplicitProjectPathQuery(rawQuery)) {
    const resolvedCandidate = path.resolve(rawQuery);
    if (fs.existsSync(resolvedCandidate)) {
      const dirCandidate = fs.statSync(resolvedCandidate).isDirectory()
        ? resolvedCandidate
        : path.dirname(resolvedCandidate);
      if (hasDirectWorkspaceMarker(dirCandidate)) {
        return dirCandidate;
      }
      const discovered = findProjectRoot(dirCandidate, dirCandidate);
      const discoveredInsideRepo =
        discovered === process.cwd() && dirCandidate.startsWith(`${os.tmpdir()}${path.sep}`);
      return discoveredInsideRepo ? dirCandidate : discovered;
    }
    return resolvedCandidate;
  }

  // Bare project name query (e.g. `aice analyze skeleton` from `/home/forart/dev/aice`):
  const gainLookup = buildGainReport({
    project: rawQuery,
    telemetryPath: options.telemetryPath,
  });
  if (gainLookup.projects.length > 0) {
    return gainLookup.projects[0]?.projectRoot;
  }
  const matchedErrs = loadTelemetryErrors(rawQuery, options.telemetryPath);
  if (matchedErrs.length > 0) {
    return path.resolve(matchedErrs[0]?.projectRoot);
  }
  return resolveBareOrPathProjectCandidate(rawQuery);
}

export function analyzeProject(options: AnalyzeProjectOptions = {}): ProjectAnalyzeReport {
  const projectRoot = resolveAnalyzeTargetProjectRoot(options);
  const projectName = path.basename(projectRoot) || "root";
  const cfg = loadProjectConfig(projectRoot);
  const configStatus = {
    enabled: isProjectAiceEnabled(projectRoot),
    idiomsEnabled: isProjectIdiomsEnabled(cfg),
    activeIdiomsCount: Object.keys(cfg.idioms ?? {}).length,
  };

  const workspaceStats = inspectWorkspaceFiles(projectRoot);
  const gainReport = buildGainReport({
    project: projectRoot,
    telemetryPath: options.telemetryPath,
  });
  const detail = gainReport.projectDetail;
  const telemetryErrors = loadTelemetryErrors(projectRoot, options.telemetryPath);
  const sessions = discoverProjectTranscripts(projectRoot, options.transcriptsDir);

  let totalSteps = 0;
  let totalTurns = 0;
  let checkpointCompactions = 0;
  let checkpointInputTokens = 0;
  let checkpointCacheReadTokens = 0;
  let checkpointOutputTokens = 0;
  let wallClockSeconds = 0;
  let inputTokensUncached = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let thinkingTokensEst = 0;
  let toolPayloadTokensEst = 0;
  let totalBillableTokens = 0;
  let costWeightedEquivalentTokens = 0;
  let totalContextTokensProcessed = 0;
  let totalToolCalls = 0;
  const aiceSubcommands: Record<string, number> = {};
  const aiceSubcommandErrors: Record<string, number> = {};
  let aiceHardErrorsTotal = 0;
  let transcriptFailedAndRetryTurns = 0;
  let failedAndRetryOutputTokens = 0;
  let spliceFailedAndRetryOutputTokens = 0;

  const nativeFileBypasses: Record<string, number> = {};
  const transcriptErrors: ProjectAnalyzeReport["frictionAudit"]["transcriptErrors"] = [];
  const causeCounts = new Map<string, { count: number; sample: string }>();

  const bumpCause = (cause: string, sampleText: string): void => {
    const cleanSample = sampleText.replace(/\s+/g, " ").trim().slice(0, 140);
    const existing = causeCounts.get(cause);
    if (existing) {
      existing.count++;
    } else {
      causeCounts.set(cause, { count: 1, sample: cleanSample });
    }
  };

  let fallbackTotalCalls = 0;
  let fallbackReadCalls = 0;
  let fallbackWriteCalls = 0;
  let fallbackNativeCl100k = 0;
  let fallbackAiceCl100k = 0;
  let fallbackSavedCl100k = 0;

  let readTurns = 0;
  let maxConsecutiveReadStreak = 0;
  let extraReadTurns = 0;
  const sameFileRepeatReadChains: SameFileRepeatReadChain[] = [];

  for (const te of telemetryErrors) {
    bumpCause(classifyFrictionCause(te.errorMessage), te.errorMessage);
  }

  for (const s of sessions) {
    totalSteps += s.totalSteps;
    totalTurns += s.llmTurns;
    checkpointCompactions += s.checkpointCompactions;
    checkpointInputTokens += s.checkpointInputTokens;
    checkpointCacheReadTokens += s.checkpointCacheReadTokens;
    checkpointOutputTokens += s.checkpointOutputTokens;
    wallClockSeconds += s.wallClockSeconds;
    inputTokensUncached += s.inputTokensUncached;
    cacheReadTokens += s.cacheReadTokens;
    outputTokens += s.outputTokens;
    thinkingTokensEst += s.thinkingTokensEst;
    toolPayloadTokensEst += s.toolPayloadTokensEst;
    totalBillableTokens += s.totalBillableTokens;
    costWeightedEquivalentTokens += s.costWeightedEquivalentTokens;
    totalContextTokensProcessed += s.totalContextTokensProcessed;
    totalToolCalls += s.toolCallsTotal;
    aiceHardErrorsTotal += s.aiceHardErrorsTotal;
    transcriptFailedAndRetryTurns += s.failedAndRetryTurns;
    failedAndRetryOutputTokens += s.failedAndRetryOutputTokens;
    spliceFailedAndRetryOutputTokens += s.spliceFailedAndRetryOutputTokens;

    if (s.transcriptBpe) {
      fallbackTotalCalls += s.transcriptBpe.totalCalls;
      fallbackReadCalls += s.transcriptBpe.readCalls;
      fallbackWriteCalls += s.transcriptBpe.writeCalls;
      fallbackNativeCl100k += s.transcriptBpe.nativeCl100k;
      fallbackAiceCl100k += s.transcriptBpe.aiceCl100k;
      fallbackSavedCl100k += s.transcriptBpe.savedCl100k;
    }
    if (s.readLoop) {
      readTurns += s.readLoop.readTurns;
      if (s.readLoop.maxConsecutiveReadStreak > maxConsecutiveReadStreak) {
        maxConsecutiveReadStreak = s.readLoop.maxConsecutiveReadStreak;
      }
      extraReadTurns += s.readLoop.extraReadTurns;
      for (const chain of s.readLoop.sameFileRepeatReadChains) {
        sameFileRepeatReadChains.push(chain);
      }
    }
    for (const [k, v] of Object.entries(s.aiceSubcommands)) {
      aiceSubcommands[k] = (aiceSubcommands[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(s.aiceSubcommandErrors)) {
      aiceSubcommandErrors[k] = (aiceSubcommandErrors[k] ?? 0) + v;
    }
    for (const [k, v] of Object.entries(s.nativeFileBypasses)) {
      nativeFileBypasses[k] = (nativeFileBypasses[k] ?? 0) + v;
    }
    for (const err of s.errors) {
      transcriptErrors.push({
        conversationId: s.conversationId,
        step: err.step,
        at: err.at,
        snippet: err.snippet,
      });
      if (err.cause) {
        bumpCause(err.cause, err.snippet);
      }
    }
  }

  const topCauses: FrictionCauseEntry[] = Array.from(causeCounts.entries())
    .map(([cause, info]) => ({ cause, count: info.count, sample: info.sample }))
    .sort((a, b) => b.count - a.count);

  const totalPromptTokens = inputTokensUncached + cacheReadTokens;
  const cacheHitPct =
    totalPromptTokens > 0 ? Number(((cacheReadTokens / totalPromptTokens) * 100).toFixed(2)) : 0;

  const thinkingRatioPct =
    outputTokens > 0 ? Math.round((thinkingTokensEst / outputTokens) * 100) : 0;
  const toolPayloadRatioPct = outputTokens > 0 ? 100 - thinkingRatioPct : 0;

  const transcriptAiceCallsTotal = Object.values(aiceSubcommands).reduce((a, b) => a + b, 0);
  const aiceOpsCount = transcriptAiceCallsTotal || (detail?.summary.totalCalls ?? 0);
  const bypassOpsCount = Object.values(nativeFileBypasses).reduce((a, b) => a + b, 0);
  const aiceCompliancePct =
    aiceOpsCount + bypassOpsCount > 0
      ? Math.round((aiceOpsCount / (aiceOpsCount + bypassOpsCount)) * 100)
      : configStatus.enabled
        ? 100
        : 0;

  const subcommandErrorRates: Record<string, SubcommandErrorStat> = {};
  let transcriptSpliceWriteCalls = 0;
  let transcriptSpliceWriteErrors = 0;
  let transcriptMcpCalls = 0;

  for (const [sub, calls] of Object.entries(aiceSubcommands)) {
    const errs = aiceSubcommandErrors[sub] ?? 0;
    const errorPct = calls > 0 ? Number(((errs / calls) * 100).toFixed(1)) : 0;
    subcommandErrorRates[sub] = { calls, errors: errs, errorPct };
    if (
      sub === "splice" ||
      sub === "write" ||
      sub === "create" ||
      sub === "patch" ||
      sub === "mcp:aice_splice" ||
      sub === "mcp:aice_write"
    ) {
      transcriptSpliceWriteCalls += calls;
      transcriptSpliceWriteErrors += errs;
    }
    if (sub.startsWith("mcp:")) {
      transcriptMcpCalls += calls;
    }
  }

  const transcriptOverallErrorPct =
    transcriptAiceCallsTotal > 0
      ? Number(((aiceHardErrorsTotal / transcriptAiceCallsTotal) * 100).toFixed(2))
      : 0;
  const transcriptSpliceWriteErrorPct =
    transcriptSpliceWriteCalls > 0
      ? Number(((transcriptSpliceWriteErrors / transcriptSpliceWriteCalls) * 100).toFixed(2))
      : 0;

  const failedAndRetryOutputPct =
    outputTokens > 0 ? Number(((failedAndRetryOutputTokens / outputTokens) * 100).toFixed(2)) : 0;
  const spliceFailedAndRetryOutputPct =
    outputTokens > 0
      ? Number(((spliceFailedAndRetryOutputTokens / outputTokens) * 100).toFixed(2))
      : 0;

  const singleFileReadCalls = detail?.summary.singleFileReadCalls ?? 0;
  const singleFileReadLossCalls = detail?.summary.singleFileReadLossCalls ?? 0;
  const singleFileReadLossPct = detail?.summary.singleFileReadLossPct ?? 0;

  const transcriptGroundTruth: TranscriptGroundTruthReport = {
    plannerResponseTurns: totalTurns,
    checkpointCompactions,
    checkpointInputTokens,
    checkpointCacheReadTokens,
    checkpointOutputTokens,
    cacheHitPct,
    aiceTotalCalls: transcriptAiceCallsTotal,
    aiceHardErrorsTotal,
    aiceOverallErrorPct: transcriptOverallErrorPct,
    spliceWriteCalls: transcriptSpliceWriteCalls,
    spliceWriteHardErrors: transcriptSpliceWriteErrors,
    spliceWriteErrorPct: transcriptSpliceWriteErrorPct,
    subcommandErrorRates,
    failedAndRetryTurns: transcriptFailedAndRetryTurns,
    failedAndRetryOutputTokens,
    failedAndRetryOutputPct,
    spliceFailedAndRetryOutputTokens,
    spliceFailedAndRetryOutputPct,
    singleFileReadCalls,
    singleFileReadLossCalls,
    singleFileReadLossPct,
  };

  const hasLedgerCalls = (detail?.summary.totalCalls ?? 0) > 0;
  const fallbackPct =
    fallbackNativeCl100k > 0 ? Math.round((fallbackSavedCl100k / fallbackNativeCl100k) * 100) : 0;

  const readTurnRatioPct = totalTurns > 0 ? Number(((readTurns / totalTurns) * 100).toFixed(1)) : 0;
  const avgSessionContextTokens =
    totalTurns > 0 ? Math.round((inputTokensUncached + cacheReadTokens) / totalTurns) : 0;
  const contextReplayTokenTax = extraReadTurns * avgSessionContextTokens;

  const turnContextSize = avgSessionContextTokens > 0 ? avgSessionContextTokens : 8_500;
  const realisticPayloadSavedTokens = hasLedgerCalls
    ? (detail?.summary.realisticSavedCl100k ??
      gainReport.totalRealisticSavedCl100k ??
      detail?.summary.savedCl100k ??
      0)
    : fallbackSavedCl100k;

  let wrapperTaxTokens = detail?.summary.wrapperTaxCl100k ?? gainReport.wrapperTaxCl100k ?? 0;
  if (wrapperTaxTokens === 0 && aiceOpsCount > 0) {
    wrapperTaxTokens = (aiceOpsCount - transcriptMcpCalls) * 70 + transcriptMcpCalls * 45;
  }

  const effectiveTurnCount =
    totalTurns > 0
      ? totalTurns
      : (detail?.summary.estimatedTurns ?? gainReport.estimatedTurns ?? 0);
  const ruleBudget = getRuleOverheadBudgetCl100k();
  // ~90% prompt-cache hit: 1x Turn 1 + 0.1x cached turns
  const ruleReplayTaxTokens =
    effectiveTurnCount === 0
      ? 0
      : ruleBudget + Math.round(ruleBudget * Math.max(0, effectiveTurnCount - 1) * 0.1);

  const effectiveMcpTurns = Math.max(
    detail?.summary.mcpEstimatedTurns ?? gainReport.mcpEstimatedTurns ?? 0,
    transcriptMcpCalls,
  );
  const mcpSchemaBudget = getMcpSchemaOverheadBudgetCl100k();
  const mcpSchemaTaxTokens =
    effectiveMcpTurns === 0
      ? 0
      : mcpSchemaBudget + Math.round(mcpSchemaBudget * Math.max(0, effectiveMcpTurns - 1) * 0.1);

  const sequentialPaginationTurns =
    extraReadTurns > 0
      ? extraReadTurns
      : (detail?.summary.sequentialPaginationTurns ?? gainReport.sequentialPaginationTurns ?? 0);
  const paginationReplayTaxTokens = sequentialPaginationTurns * turnContextSize;
  const paginationCostWeightedTaxTokens =
    sequentialPaginationTurns * (Math.round(turnContextSize * 0.1) + 320);

  const ledgerFailedTurns = detail?.summary.failedRetryTurns ?? gainReport.failedRetryTurns ?? 0;
  const failedRetryTurns = Math.max(ledgerFailedTurns, aiceHardErrorsTotal, telemetryErrors.length);

  const wastedRetryOutputTokens =
    failedAndRetryOutputTokens > 0
      ? failedAndRetryOutputTokens
      : (detail?.summary.wastedRetryOutputTokensCl100k ??
        gainReport.wastedRetryOutputTokensCl100k ??
        (failedRetryTurns > 0 ? failedRetryTurns * 450 : 0));
  const failedRetryOutputPenalty4xTokens = wastedRetryOutputTokens * 4;

  const retryReplayTaxTokens =
    failedRetryTurns === 0 ? 0 : failedRetryTurns * turnContextSize + wastedRetryOutputTokens;
  const retryCostWeightedTaxTokens =
    failedRetryTurns === 0
      ? 0
      : failedRetryTurns * Math.round(turnContextSize * 0.1) + failedRetryOutputPenalty4xTokens;

  const totalSystemicTaxTokens =
    wrapperTaxTokens +
    ruleReplayTaxTokens +
    mcpSchemaTaxTokens +
    paginationReplayTaxTokens +
    retryReplayTaxTokens;

  const netEndToEndTokens = realisticPayloadSavedTokens - totalSystemicTaxTokens;

  const costWeightedGrossSaved = hasLedgerCalls
    ? (detail?.summary.readSavedCl100k ?? 0) + (detail?.summary.writeSavedCl100k ?? 0) * 4
    : fallbackSavedCl100k;
  const totalCostWeightedTaxes =
    wrapperTaxTokens +
    ruleReplayTaxTokens +
    mcpSchemaTaxTokens +
    paginationCostWeightedTaxTokens +
    retryCostWeightedTaxTokens;
  const costWeightedNetTokens = costWeightedGrossSaved - totalCostWeightedTaxes;

  const effectiveSpliceErrorPct = Math.max(
    detail?.summary.spliceErrorRatePct ?? 0,
    transcriptSpliceWriteErrorPct,
  );
  const hasAnyActivity =
    hasLedgerCalls || transcriptAiceCallsTotal > 0 || sessions.length > 0 || failedRetryTurns > 0;
  const isSpliceHealthy =
    ((detail?.summary.writeCalls ?? 0) === 0 &&
      transcriptSpliceWriteCalls === 0 &&
      failedRetryTurns === 0) ||
    (effectiveSpliceErrorPct <= HEALTHY_SPLICE_ERR_PCT_MAX &&
      !(
        transcriptSpliceWriteCalls === 0 &&
        (detail?.summary.writeCalls ?? 0) === 0 &&
        failedRetryTurns > 0
      ));

  let verdict: EndToEndVerdict = "NEUTRAL";
  if (!hasAnyActivity) {
    verdict = "NEUTRAL";
  } else if (netEndToEndTokens > 0 && costWeightedNetTokens > 0 && isSpliceHealthy) {
    verdict = "TOKEN-REDUCING";
  } else if (netEndToEndTokens === 0 && costWeightedNetTokens === 0 && failedRetryTurns === 0) {
    verdict = "NEUTRAL";
  } else {
    verdict = "TOKEN-CONSUMING";
  }

  const endToEndEconomics: EndToEndEconomicsReport = {
    realisticPayloadSavedTokens,
    wrapperTaxTokens,
    ruleReplayTaxTokens,
    mcpSchemaTaxTokens,
    sequentialPaginationTurns,
    paginationReplayTaxTokens,
    failedRetryTurns,
    wastedRetryOutputTokens,
    failedRetryOutputPenalty4xTokens,
    retryReplayTaxTokens,
    totalSystemicTaxTokens,
    netEndToEndTokens,
    costWeightedNetTokens,
    spliceErrorRatePct: effectiveSpliceErrorPct,
    verdict,
  };

  return {
    capturedAt: new Date().toISOString(),
    projectRoot,
    projectName,
    configStatus,
    workspaceStats,
    sessionSummary: {
      sessionCount: sessions.length,
      totalSteps,
      totalTurns,
      checkpointCompactions,
      checkpointInputTokens,
      checkpointCacheReadTokens,
      checkpointOutputTokens,
      wallClockSeconds: Math.round(wallClockSeconds * 100) / 100,
      inputTokensUncached,
      cacheReadTokens,
      cacheHitPct,
      outputTokens,
      thinkingTokensEst,
      toolPayloadTokensEst,
      thinkingRatioPct,
      toolPayloadRatioPct,
      totalBillableTokens,
      costWeightedEquivalentTokens,
      totalContextTokensProcessed,
      totalToolCalls,
      aiceSubcommands,
      nativeFileBypasses,
      aiceCompliancePct,
    },
    bpeSavings: hasLedgerCalls
      ? {
          totalCalls: detail?.summary.totalCalls ?? 0,
          readCalls: detail?.summary.readCalls ?? 0,
          writeCalls: detail?.summary.writeCalls ?? 0,
          nativeCl100k: detail?.summary.nativeCl100k ?? 0,
          aiceCl100k: detail?.summary.aiceCl100k ?? 0,
          savedCl100k: detail?.summary.savedCl100k ?? 0,
          cl100kSavingsPct: detail?.summary.cl100kSavingsPct ?? 0,
          realisticNativeCl100k: detail?.summary.realisticNativeCl100k ?? 0,
          realisticSavedCl100k: detail?.summary.realisticSavedCl100k ?? 0,
          realisticSavingsPct: detail?.summary.realisticSavingsPct ?? 0,
          nativeO200k: detail?.summary.nativeO200k ?? 0,
          aiceO200k: detail?.summary.aiceO200k ?? 0,
          savedO200k: detail?.summary.savedO200k ?? 0,
          o200kSavingsPct: detail?.summary.o200kSavingsPct ?? 0,
        }
      : {
          totalCalls: fallbackTotalCalls,
          readCalls: fallbackReadCalls,
          writeCalls: fallbackWriteCalls,
          nativeCl100k: fallbackNativeCl100k,
          aiceCl100k: fallbackAiceCl100k,
          savedCl100k: fallbackSavedCl100k,
          cl100kSavingsPct: fallbackPct,
          realisticNativeCl100k: fallbackNativeCl100k,
          realisticSavedCl100k: fallbackSavedCl100k,
          realisticSavingsPct: fallbackPct,
          nativeO200k: fallbackNativeCl100k,
          aiceO200k: fallbackAiceCl100k,
          savedO200k: fallbackSavedCl100k,
          o200kSavingsPct: fallbackPct,
        },
    transcriptGroundTruth,
    readLoopAudit: {
      readTurns,
      totalTurns,
      readTurnRatioPct,
      maxConsecutiveReadStreak,
      sameFileRepeatReadChainCount: sameFileRepeatReadChains.length,
      sameFileRepeatReadChains,
      extraReadTurns,
      avgSessionContextTokens,
      contextReplayTokenTax,
    },
    frictionAudit: {
      totalErrors: Math.max(telemetryErrors.length + transcriptErrors.length, failedRetryTurns),
      telemetryErrors,
      transcriptErrors,
      topCauses,
    },
    sessions,
    endToEndEconomics,
  };
}

function formatDuration(seconds: number): string {
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.round(seconds % 60);
  if (mins < 60) return `${mins}m ${secs}s`;
  const hrs = Math.floor(mins / 60);
  const remMins = mins % 60;
  return `${hrs}h ${remMins}m ${secs}s`;
}

export function formatAnalyzeReport(report: ProjectAnalyzeReport): string {
  const lines: string[] = [];
  const sep = "================================================================================";
  const subSep = "--------------------------------------------------------------------------------";

  lines.push(sep);
  lines.push(`AICE POST-SESSION PROJECT ANALYZER — ${report.projectName} (${report.projectRoot})`);
  lines.push(sep);
  lines.push(
    `  Config Status   : AICE=${report.configStatus.enabled ? "ENABLED" : "DISABLED"} | Idioms=${report.configStatus.idiomsEnabled ? "ON" : "OFF"} (${report.configStatus.activeIdiomsCount} active)`,
  );
  lines.push(
    `  Workspace Files : ${report.workspaceStats.fileCount} file(s) | ${report.workspaceStats.totalLines.toLocaleString("en-US")} lines | ${report.workspaceStats.totalBytes.toLocaleString("en-US")} bytes`,
  );

  lines.push("");
  lines.push("1. GROUND-TRUTH TRANSCRIPT & API TOKEN TELEMETRY");
  lines.push(subSep);
  const ss = report.sessionSummary;
  lines.push(
    `  Matched Sessions       : ${ss.sessionCount} session(s) | ${ss.totalTurns} PLANNER_RESPONSE turns | ${ss.checkpointCompactions} CHECKPOINT compaction(s) | ${ss.totalSteps} steps`,
  );
  if (ss.checkpointCompactions > 0) {
    lines.push(
      `  CHECKPOINT Compactions : ${ss.checkpointCompactions} (${ss.checkpointInputTokens.toLocaleString("en-US")} in / ${ss.checkpointCacheReadTokens.toLocaleString("en-US")} cache / ${ss.checkpointOutputTokens.toLocaleString("en-US")} out)`,
    );
  }
  lines.push(
    `  Active Coding Time     : ${formatDuration(ss.wallClockSeconds)} (${ss.wallClockSeconds}s)`,
  );
  lines.push(`  Uncached Input Tokens  : ${ss.inputTokensUncached.toLocaleString("en-US")}`);
  lines.push(
    `  Cache Read Tokens      : ${ss.cacheReadTokens.toLocaleString("en-US")} (${ss.cacheHitPct.toFixed(2)}% cache hit rate)`,
  );
  lines.push(
    `  Output Tokens (Gen)    : ${ss.outputTokens.toLocaleString("en-US")} (~${ss.thinkingTokensEst.toLocaleString("en-US")} thinking/text [${ss.thinkingRatioPct}%] | ~${ss.toolPayloadTokensEst.toLocaleString("en-US")} tool payload [${ss.toolPayloadRatioPct}%])`,
  );
  lines.push(
    `  Total Billable Tokens  : ${ss.totalBillableTokens.toLocaleString("en-US")} (in + out) | Cost-Weighted (1x/0.1x/4x): ${ss.costWeightedEquivalentTokens.toLocaleString("en-US")}`,
  );

  lines.push("");
  lines.push("2. AICE SUBCOMMAND ERROR RATES, LOSS RATE & HONEST REALISTIC BPE DELTA");
  lines.push(subSep);
  const gt = report.transcriptGroundTruth;
  const aiceCmdStr =
    Object.keys(ss.aiceSubcommands).length > 0
      ? Object.entries(ss.aiceSubcommands)
          .map(([k, v]) => {
            const st = gt.subcommandErrorRates[k];
            return st && st.errors > 0
              ? `${k}:${v} (${st.errors} err=${st.errorPct}%)`
              : `${k}:${v}`;
          })
          .join(", ")
      : "none";
  const bypassStr =
    Object.keys(ss.nativeFileBypasses).length > 0
      ? Object.entries(ss.nativeFileBypasses)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")
      : "0 (zero native file bypasses)";
  lines.push(`  AICE Subcommands Used  : ${aiceCmdStr}`);
  lines.push(
    `  AICE Hard Error Rate   : ${gt.aiceHardErrorsTotal} / ${gt.aiceTotalCalls} (${gt.aiceOverallErrorPct.toFixed(2)}%) | Splice/Write Err: ${gt.spliceWriteHardErrors} / ${gt.spliceWriteCalls} (${gt.spliceWriteErrorPct.toFixed(2)}%)`,
  );
  lines.push(
    `  Failed+Retry Out Burn  : ${gt.failedAndRetryOutputTokens.toLocaleString("en-US")} output_tokens across ${gt.failedAndRetryTurns} turn(s) (${gt.failedAndRetryOutputPct.toFixed(2)}% of session output)`,
  );
  lines.push(`  Native Tool Bypasses   : ${bypassStr}`);
  lines.push(`  AICE Tool Compliance   : ${ss.aiceCompliancePct}%`);
  const bpe = report.bpeSavings;
  lines.push(
    `  Honest Realistic Delta : ${bpe.totalCalls} call(s) (${bpe.readCalls} read, ${bpe.writeCalls} write) | Realistic Nat: ${bpe.realisticNativeCl100k.toLocaleString("en-US")} -> AICE: ${bpe.aiceCl100k.toLocaleString("en-US")} | Delta: ${bpe.realisticSavedCl100k >= 0 ? `+${bpe.realisticSavedCl100k.toLocaleString("en-US")}` : bpe.realisticSavedCl100k.toLocaleString("en-US")} cl100k (${bpe.realisticSavingsPct}%)`,
  );
  lines.push(
    `  Single-File a1 > rn    : ${gt.singleFileReadLossCalls} / ${gt.singleFileReadCalls} (${gt.singleFileReadLossPct.toFixed(1)}% single-file reads lost tokens)`,
  );

  lines.push("");
  lines.push("3. READ-LOOP & TURN-AMPLIFICATION AUDIT");
  lines.push(subSep);
  const rla = report.readLoopAudit;
  lines.push(
    `  Read Turns / Ratio     : ${rla.readTurns} / ${rla.totalTurns} LLM turns (${rla.readTurnRatioPct}%)`,
  );
  lines.push(
    `  Max Consecutive Reads  : ${rla.maxConsecutiveReadStreak} turn(s) (${rla.extraReadTurns} extra read turn(s))`,
  );
  const chainStr =
    rla.sameFileRepeatReadChains.length > 0
      ? `${rla.sameFileRepeatReadChains.length} chain(s) — ${rla.sameFileRepeatReadChains
          .slice(0, 8)
          .map((c) => `${c.filePath} (${c.turns}x)`)
          .join(", ")}`
      : "0 (no multi-turn line-hunting loops)";
  lines.push(`  Repeat-Read Chains     : ${chainStr}`);
  lines.push(
    `  Context Replay Tax Est : ${rla.contextReplayTokenTax.toLocaleString("en-US")} tokens (${rla.extraReadTurns} extra read turn(s) × ${rla.avgSessionContextTokens.toLocaleString("en-US")} avg context tokens)`,
  );

  lines.push("");
  lines.push("4. FRICTION & ERROR AUDIT");
  lines.push(subSep);
  if (report.frictionAudit.totalErrors === 0) {
    lines.push("  ✔ 0 errors detected across AICE telemetry and agent transcripts (100% clean).");
  } else {
    lines.push(
      `  ⚠ ${report.frictionAudit.totalErrors} friction/error event(s) detected (${report.frictionAudit.telemetryErrors.length} AICE CLI/MCP, ${report.frictionAudit.transcriptErrors.length} transcript):`,
    );
    if (report.frictionAudit.topCauses.length > 0) {
      lines.push("  Top Friction Causes:");
      for (const tc of report.frictionAudit.topCauses.slice(0, 6)) {
        lines.push(`    - ${tc.cause}: ${tc.count}x (e.g. ${tc.sample})`);
      }
    }
    for (const te of report.frictionAudit.telemetryErrors.slice(-10)) {
      lines.push(
        `    [AICE ${te.operation}] ${te.filePath}: ${te.errorMessage.replace(/\s+/g, " ").slice(0, 140)}`,
      );
    }
    for (const tr of report.frictionAudit.transcriptErrors.slice(-10)) {
      lines.push(
        `    [Session ${tr.conversationId.slice(0, 8)} Step ${tr.step}] ${tr.snippet.replace(/\s+/g, " ").slice(0, 140)}`,
      );
    }
  }

  lines.push("");
  lines.push("5. END-TO-END TOKEN ECONOMICS & VERDICT");
  lines.push(subSep);
  const e2e = report.endToEndEconomics;
  lines.push(
    `  Realistic Payload Saved : ${e2e.realisticPayloadSavedTokens >= 0 ? `+${e2e.realisticPayloadSavedTokens.toLocaleString("en-US")}` : e2e.realisticPayloadSavedTokens.toLocaleString("en-US")} tokens`,
  );
  lines.push(`  Systemic Wrapper Tax    : -${e2e.wrapperTaxTokens.toLocaleString("en-US")} tokens`);
  lines.push(
    `  Rule Replay Tax (1x+.1x): -${e2e.ruleReplayTaxTokens.toLocaleString("en-US")} tokens`,
  );
  lines.push(
    `  MCP Schema Tax          : -${e2e.mcpSchemaTaxTokens.toLocaleString("en-US")} tokens`,
  );
  lines.push(
    `  Pagination Replay Tax   : -${e2e.paginationReplayTaxTokens.toLocaleString("en-US")} tokens (${e2e.sequentialPaginationTurns} turn(s))`,
  );
  lines.push(
    `  Retry & Output Penalty  : -${e2e.retryReplayTaxTokens.toLocaleString("en-US")} unwt / -${e2e.failedRetryOutputPenalty4xTokens.toLocaleString("en-US")} 4x-out (${e2e.failedRetryTurns} fail(s), ${e2e.wastedRetryOutputTokens.toLocaleString("en-US")} out_tok)`,
  );
  lines.push(
    `  Total Systemic Taxes    : -${e2e.totalSystemicTaxTokens.toLocaleString("en-US")} tokens`,
  );
  lines.push(
    `  Net Unweighted Tokens   : ${e2e.netEndToEndTokens >= 0 ? `+${e2e.netEndToEndTokens.toLocaleString("en-US")}` : e2e.netEndToEndTokens.toLocaleString("en-US")} tokens`,
  );
  lines.push(
    `  Cost-Weighted Delta     : ${e2e.costWeightedNetTokens >= 0 ? `+${e2e.costWeightedNetTokens.toLocaleString("en-US")}` : e2e.costWeightedNetTokens.toLocaleString("en-US")} tokens (1x in / 0.1x cached / 4x out)`,
  );
  lines.push(
    `  Splice Error Rate Gate  : ${e2e.spliceErrorRatePct.toFixed(1)}% (healthy <= ${HEALTHY_SPLICE_ERR_PCT_MAX.toFixed(1)}%)`,
  );
  lines.push(`  HONEST VERDICT          : ${e2e.verdict}`);
  lines.push(`  End-to-End Verdict      : ${e2e.verdict}`);
  lines.push(sep);
  return lines.join("\n");
}
