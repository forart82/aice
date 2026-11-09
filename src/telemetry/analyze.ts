import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  findProjectRoot,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
} from "../config/index.js";
import { detectLanguageName } from "../tokenomics/index.js";
import {
  buildGainReport,
  detectCallerAgent,
  isTelemetrySuppressed,
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
}

export interface RecordTelemetryErrorInput {
  targetPath?: string;
  projectRoot?: string;
  filePath?: string;
  operation: TelemetryOperation;
  surface?: TelemetrySurface;
  agent?: string;
  errorMessage: string;
  telemetryPath?: string;
}

export interface AnalyzedSessionSummary {
  conversationId: string;
  source: "antigravity" | "claude" | "transcript";
  workspace: string;
  totalSteps: number;
  llmTurns: number;
  toolCallsTotal: number;
  aiceSubcommands: Record<string, number>;
  nativeFileBypasses: Record<string, number>;
  inputTokensUncached: number;
  cacheReadTokens: number;
  outputTokens: number;
  totalBillableTokens: number;
  totalContextTokensProcessed: number;
  wallClockSeconds: number;
  firstTimestamp: string | null;
  lastTimestamp: string | null;
  isFinished: boolean;
  errorCount: number;
  errors: Array<{ step: number; at: string | null; snippet: string }>;
}

export interface AnalyzeProjectOptions {
  project?: string;
  telemetryPath?: string;
  transcriptsDir?: string;
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
    wallClockSeconds: number;
    inputTokensUncached: number;
    cacheReadTokens: number;
    outputTokens: number;
    totalBillableTokens: number;
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
    nativeO200k: number;
    aiceO200k: number;
    savedO200k: number;
    o200kSavingsPct: number;
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
  };
  sessions: AnalyzedSessionSummary[];
}

export function resolveTelemetryErrorsPath(explicitTelemetryPath?: string): string {
  if (process.env.AICE_TELEMETRY_ERRORS_PATH) {
    return path.resolve(process.env.AICE_TELEMETRY_ERRORS_PATH);
  }
  const baseLedger = resolveTelemetryPath(explicitTelemetryPath);
  if (explicitTelemetryPath || process.env.AICE_TELEMETRY_PATH) {
    return `${baseLedger}.errors.jsonl`;
  }
  return path.join(path.dirname(baseLedger), "errors.jsonl");
}

function isTestEnvWithoutExplicitTelemetry(explicitPath?: string): boolean {
  if (
    explicitPath ||
    process.env.AICE_TELEMETRY_PATH ||
    process.env.AICE_TELEMETRY_ERRORS_PATH
  ) {
    return false;
  }
  return Boolean(process.env.VITEST || process.env.NODE_ENV === "test");
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
  if (!fs.existsSync(errPath)) {
    return [];
  }
  try {
    const raw = fs.readFileSync(errPath, "utf-8");
    const normFilter = projectRootFilter ? path.resolve(projectRootFilter) : undefined;
    const events: TelemetryErrorEvent[] = [];
    for (const line of raw.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      try {
        const parsed = JSON.parse(trimmed) as TelemetryErrorEvent;
        if (parsed && typeof parsed.operation === "string" && typeof parsed.errorMessage === "string") {
          if (
            !normFilter ||
            path.resolve(parsed.projectRoot) === normFilter ||
            parsed.projectName.toLowerCase() === path.basename(normFilter).toLowerCase()
          ) {
            events.push(parsed);
          }
        }
      } catch {
        // skip malformed line
      }
    }
    return events;
  } catch {
    return [];
  }
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

  let workspace: string | null = null;
  let mentionsProjectRoot = false;
  let isOrchestratorRunner = false;
  let inputTokensUncached = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let llmTurns = 0;
  let toolCallsTotal = 0;
  const aiceSubcommands: Record<string, number> = {};
  const nativeFileBypasses: Record<string, number> = {};
  const errors: Array<{ step: number; at: string | null; snippet: string }> = [];
  let firstTs: number | null = null;
  let lastTs: number | null = null;
  let firstIso: string | null = null;
  let lastIso: string | null = null;
  let lastStep: Record<string, unknown> = {};

  const nativeBypassTools = new Set([
    "read_file",
    "view_file",
    "write_file",
    "write_to_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
  ]);

  for (let i = 0; i < lines.length; i++) {
    let step: Record<string, unknown>;
    try {
      step = JSON.parse(lines[i]) as Record<string, unknown>;
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
      const m = content.match(/Command Working Directory:\s*(\/[^\s\n<]+)/);
      if (m) {
        workspace = path.resolve(m[1]);
      } else if (typeof step.cwd === "string" && step.cwd.startsWith("/")) {
        workspace = path.resolve(step.cwd);
      }
    }
    if (content.includes("watch_campaign.py") || content.includes("watch_benchmark.py")) {
      isOrchestratorRunner = true;
    }
    if (content.includes(targetProjectRoot)) {
      mentionsProjectRoot = true;
    }

    if (stype === "PLANNER_RESPONSE" || stype === "assistant") {
      llmTurns++;
      const usage = (step.usage as Record<string, unknown> | undefined) ?? step;
      const it = Number(usage.input_tokens ?? 0) || 0;
      const ct =
        Number(usage.cache_read_tokens ?? usage.cache_read_input_tokens ?? 0) || 0;
      const ot = Number(usage.output_tokens ?? 0) || 0;
      inputTokensUncached += it;
      cacheReadTokens += ct;
      outputTokens += ot;

      const tcs = Array.isArray(step.tool_calls) ? step.tool_calls : [];
      for (const tcRaw of tcs) {
        const tc = (tcRaw ?? {}) as Record<string, unknown>;
        const name = typeof tc.name === "string" ? tc.name : "unknown";
        const args = (tc.args ?? tc.input ?? {}) as Record<string, unknown>;
        toolCallsTotal++;

        if (nativeBypassTools.has(name)) {
          nativeFileBypasses[name] = (nativeFileBypasses[name] ?? 0) + 1;
        }

        const pVal = args.Path ?? args.file_path ?? args.target_file;
        if (typeof pVal === "string") {
          const cleanP = pVal.replace(/^['"`]|['"`]$/g, "");
          if (cleanP.startsWith(`${targetProjectRoot}/`) || cleanP === targetProjectRoot) {
            mentionsProjectRoot = true;
            if (!workspace) workspace = targetProjectRoot;
          } else if (!workspace && cleanP.startsWith("/home/")) {
            const parts = cleanP.split("/");
            if (parts.length >= 5) {
              workspace = parts.slice(0, 5).join("/");
            }
          }
        }

        const cmdVal = args.CommandLine ?? args.command;
        if (typeof cmdVal === "string") {
          const cleanCmd = cmdVal.replace(/^['"`]|['"`]$/g, "");
          if (cleanCmd.includes("watch_campaign.py") || cleanCmd.includes("agy -p")) {
            isOrchestratorRunner = true;
          }
          for (const mSub of cleanCmd.matchAll(/\baice\s+(create|splice|outline|context|decompile|patch|idioms|gain|analyze)\b/g)) {
            const sub = mSub[1];
            aiceSubcommands[sub] = (aiceSubcommands[sub] ?? 0) + 1;
          }
        }

        const toolNameVal = args.ToolName;
        if (typeof toolNameVal === "string") {
          const cleanTn = toolNameVal.replace(/^['"`]|['"`]$/g, "");
          aiceSubcommands[`mcp:${cleanTn}`] = (aiceSubcommands[`mcp:${cleanTn}`] ?? 0) + 1;
        }
      }
    }

    if (
      status === "ERROR" ||
      /^❌ Error\b/m.test(content) ||
      /^Command exited with code [1-9]\d*/m.test(content)
    ) {
      errors.push({
        step: idx,
        at: createdAt,
        snippet: content.slice(0, 350),
      });
    }
  }

  if (isOrchestratorRunner && workspace !== targetProjectRoot) {
    return null;
  }

  const matchesTarget =
    workspace === targetProjectRoot ||
    (workspace === null && mentionsProjectRoot);
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

  return {
    conversationId,
    source,
    workspace: workspace ?? targetProjectRoot,
    totalSteps: lines.length,
    llmTurns,
    toolCallsTotal,
    aiceSubcommands,
    nativeFileBypasses,
    inputTokensUncached,
    cacheReadTokens,
    outputTokens,
    totalBillableTokens: inputTokensUncached + outputTokens,
    totalContextTokensProcessed: inputTokensUncached + cacheReadTokens + outputTokens,
    wallClockSeconds,
    firstTimestamp: firstIso,
    lastTimestamp: lastIso,
    isFinished,
    errorCount: errors.length,
    errors,
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
  if (customDir && fs.existsSync(customDir)) {
    const resolvedCustom = path.resolve(customDir);
    const walkCustom = (dir: string): void => {
      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          walkCustom(full);
        } else if (e.isFile() && e.name.endsWith(".jsonl")) {
          const cid =
            e.name === "transcript.jsonl"
              ? path.basename(path.dirname(path.dirname(path.dirname(full))))
              : path.basename(full, ".jsonl");
          addCandidate(full, cid, "transcript");
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
          const tFile = path.join(
            brainRoot,
            entry.name,
            ".system_generated",
            "logs",
            "transcript.jsonl",
          );
          if (fs.existsSync(tFile)) {
            addCandidate(tFile, entry.name, "antigravity");
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
  for (const cand of candidates) {
    const parsed = parseTranscriptFile(cand.filePath, cand.cid, cand.source, projectRoot);
    if (parsed) {
      matched.push(parsed);
    }
  }
  return matched;
}

export function analyzeProject(options: AnalyzeProjectOptions = {}): ProjectAnalyzeReport {
  const rawQuery = options.project?.trim();
  let projectRoot = process.cwd();
  if (rawQuery) {
    const resolvedCandidate = path.resolve(rawQuery);
    if (fs.existsSync(resolvedCandidate)) {
      projectRoot = fs.statSync(resolvedCandidate).isDirectory()
        ? resolvedCandidate
        : path.dirname(resolvedCandidate);
    } else {
      const gainLookup = buildGainReport({
        project: rawQuery,
        telemetryPath: options.telemetryPath,
      });
      if (gainLookup.projectDetail) {
        projectRoot = gainLookup.projectDetail.projectRoot;
      } else {
        projectRoot = resolvedCandidate;
      }
    }
  } else {
    projectRoot = findProjectRoot(process.cwd());
  }

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
  let wallClockSeconds = 0;
  let inputTokensUncached = 0;
  let cacheReadTokens = 0;
  let outputTokens = 0;
  let totalBillableTokens = 0;
  let totalContextTokensProcessed = 0;
  let totalToolCalls = 0;
  const aiceSubcommands: Record<string, number> = {};
  const nativeFileBypasses: Record<string, number> = {};
  const transcriptErrors: ProjectAnalyzeReport["frictionAudit"]["transcriptErrors"] = [];

  for (const s of sessions) {
    totalSteps += s.totalSteps;
    totalTurns += s.llmTurns;
    wallClockSeconds += s.wallClockSeconds;
    inputTokensUncached += s.inputTokensUncached;
    cacheReadTokens += s.cacheReadTokens;
    outputTokens += s.outputTokens;
    totalBillableTokens += s.totalBillableTokens;
    totalContextTokensProcessed += s.totalContextTokensProcessed;
    totalToolCalls += s.toolCallsTotal;
    for (const [k, v] of Object.entries(s.aiceSubcommands)) {
      aiceSubcommands[k] = (aiceSubcommands[k] ?? 0) + v;
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
    }
  }

  const aiceOpsCount =
    Object.values(aiceSubcommands).reduce((a, b) => a + b, 0) ||
    (detail?.summary.totalCalls ?? 0);
  const bypassOpsCount = Object.values(nativeFileBypasses).reduce((a, b) => a + b, 0);
  const aiceCompliancePct =
    aiceOpsCount + bypassOpsCount > 0
      ? Math.round((aiceOpsCount / (aiceOpsCount + bypassOpsCount)) * 100)
      : configStatus.enabled
        ? 100
        : 0;

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
      wallClockSeconds: Math.round(wallClockSeconds * 100) / 100,
      inputTokensUncached,
      cacheReadTokens,
      outputTokens,
      totalBillableTokens,
      totalContextTokensProcessed,
      totalToolCalls,
      aiceSubcommands,
      nativeFileBypasses,
      aiceCompliancePct,
    },
    bpeSavings: {
      totalCalls: detail?.summary.totalCalls ?? 0,
      readCalls: detail?.summary.readCalls ?? 0,
      writeCalls: detail?.summary.writeCalls ?? 0,
      nativeCl100k: detail?.summary.nativeCl100k ?? 0,
      aiceCl100k: detail?.summary.aiceCl100k ?? 0,
      savedCl100k: detail?.summary.savedCl100k ?? 0,
      cl100kSavingsPct: detail?.summary.cl100kSavingsPct ?? 0,
      nativeO200k: detail?.summary.nativeO200k ?? 0,
      aiceO200k: detail?.summary.aiceO200k ?? 0,
      savedO200k: detail?.summary.savedO200k ?? 0,
      o200kSavingsPct: detail?.summary.o200kSavingsPct ?? 0,
    },
    frictionAudit: {
      totalErrors: telemetryErrors.length + transcriptErrors.length,
      telemetryErrors,
      transcriptErrors,
    },
    sessions,
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
  lines.push(
    `AICE POST-SESSION PROJECT ANALYZER — ${report.projectName} (${report.projectRoot})`,
  );
  lines.push(sep);
  lines.push(
    `  Config Status   : AICE=${report.configStatus.enabled ? "ENABLED" : "DISABLED"} | Idioms=${report.configStatus.idiomsEnabled ? "ON" : "OFF"} (${report.configStatus.activeIdiomsCount} active)`,
  );
  lines.push(
    `  Workspace Files : ${report.workspaceStats.fileCount} file(s) | ${report.workspaceStats.totalLines.toLocaleString("en-US")} lines | ${report.workspaceStats.totalBytes.toLocaleString("en-US")} bytes`,
  );

  lines.push("");
  lines.push("1. CODING AGENT SESSION & API TOKEN TELEMETRY");
  lines.push(subSep);
  const ss = report.sessionSummary;
  lines.push(
    `  Matched Sessions       : ${ss.sessionCount} session(s) | ${ss.totalTurns} LLM turns | ${ss.totalSteps} steps`,
  );
  lines.push(
    `  Active Coding Time     : ${formatDuration(ss.wallClockSeconds)} (${ss.wallClockSeconds}s)`,
  );
  lines.push(
    `  Uncached Input Tokens  : ${ss.inputTokensUncached.toLocaleString("en-US")}`,
  );
  lines.push(
    `  Cache Read Tokens      : ${ss.cacheReadTokens.toLocaleString("en-US")}`,
  );
  lines.push(
    `  Output Tokens (Gen)    : ${ss.outputTokens.toLocaleString("en-US")}`,
  );
  lines.push(
    `  Total Billable Tokens  : ${ss.totalBillableTokens.toLocaleString("en-US")} (in + out)`,
  );

  lines.push("");
  lines.push("2. AICE TOOL USAGE, COMPLIANCE & BPE TOKEN SAVINGS");
  lines.push(subSep);
  const aiceCmdStr =
    Object.keys(ss.aiceSubcommands).length > 0
      ? Object.entries(ss.aiceSubcommands)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")
      : "none";
  const bypassStr =
    Object.keys(ss.nativeFileBypasses).length > 0
      ? Object.entries(ss.nativeFileBypasses)
          .map(([k, v]) => `${k}:${v}`)
          .join(", ")
      : "0 (zero native file bypasses)";
  lines.push(`  AICE Subcommands Used  : ${aiceCmdStr}`);
  lines.push(`  Native Tool Bypasses   : ${bypassStr}`);
  lines.push(`  AICE Tool Compliance   : ${ss.aiceCompliancePct}%`);
  const bpe = report.bpeSavings;
  lines.push(
    `  Ledger BPE Savings     : ${bpe.totalCalls} call(s) (${bpe.readCalls} read, ${bpe.writeCalls} write) | Saved: ${bpe.savedCl100k >= 0 ? `+${bpe.savedCl100k.toLocaleString("en-US")}` : bpe.savedCl100k.toLocaleString("en-US")} cl100k (${bpe.cl100kSavingsPct}%)`,
  );

  lines.push("");
  lines.push("3. FRICTION & ERROR AUDIT");
  lines.push(subSep);
  if (report.frictionAudit.totalErrors === 0) {
    lines.push("  ✔ 0 errors detected across AICE telemetry and agent transcripts (100% clean).");
  } else {
    lines.push(
      `  ⚠ ${report.frictionAudit.totalErrors} friction/error event(s) detected (${report.frictionAudit.telemetryErrors.length} AICE CLI/MCP, ${report.frictionAudit.transcriptErrors.length} transcript):`,
    );
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
  lines.push(sep);
  return lines.join("\n");
}
