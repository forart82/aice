/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Cross-Process Shared CLI Invocation Budget for AICE.
 * Tracks cumulative emitted bytes across chained shell commands (e.g. `cmd1 && cmd2`)
 * within the same subshell/pipeline to guarantee aggregate output never exceeds host
 * middle-truncation limits (<= 9,216 bytes).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

export interface CliShellInvocation {
  key: string | null;
  isInteractiveHuman: boolean;
}

export interface SharedCliBudgetLease {
  priorUsedBytes: number;
  maxBytes: number;
  exhausted: boolean;
  emitDeferralNotice: boolean;
}

interface BudgetEntry {
  usedBytes: number;
  ts: number;
}

type BudgetState = Record<string, BudgetEntry>;

export function detectCliShellInvocation(): CliShellInvocation {
  if (process.env.AICE_CLI_INVOCATION_KEY !== undefined) {
    return {
      key: process.env.AICE_CLI_INVOCATION_KEY || null,
      isInteractiveHuman: process.env.AICE_CLI_INTERACTIVE === "1",
    };
  }

  const forcedInteractive = process.env.AICE_CLI_INTERACTIVE === "1";
  const forcedNonInteractive = process.env.AICE_CLI_INTERACTIVE === "0";

  if (forcedInteractive) {
    return { key: null, isInteractiveHuman: true };
  }

  const hasAgentEnv = Boolean(
    process.env.CI ||
      process.env.ANTIGRAVITY_CLI ||
      process.env.CLAUDECODE ||
      process.env.CODEX_SANDBOX,
  );

  let st: fs.Stats | null = null;
  try {
    st = fs.fstatSync(1);
  } catch {
    st = null;
  }

  const isFdNonInteractive = !process.stdout.isTTY || (st !== null && (st.isFIFO() || st.isFile()));

  if (process.platform === "linux") {
    try {
      const raw = fs.readFileSync("/proc/self/stat", "utf-8");
      const afterParen = raw
        .slice(raw.lastIndexOf(")") + 2)
        .trim()
        .split(/\s+/);
      const sid = afterParen[3];
      if (sid !== undefined && st !== null) {
        let isNonInteractive = forcedNonInteractive || isFdNonInteractive || hasAgentEnv;
        if (!isNonInteractive) {
          try {
            const cmdlineRaw = fs.readFileSync(`/proc/${sid}/cmdline`, "utf-8");
            const args = cmdlineRaw.split("\0");
            if (Number(sid) === process.pid || args.includes("-c")) {
              isNonInteractive = true;
            }
          } catch {}
          if (!isNonInteractive) {
            try {
              const ppidCmdRaw = fs.readFileSync(`/proc/${process.ppid}/cmdline`, "utf-8");
              if (ppidCmdRaw.split("\0").includes("-c")) {
                isNonInteractive = true;
              }
            } catch {}
          }
        }
        return isNonInteractive
          ? { key: `${st.dev}:${st.ino}:${sid}`, isInteractiveHuman: false }
          : { key: null, isInteractiveHuman: true };
      }
    } catch {
      // Fall through to non-Linux fallback on /proc read error
    }
  }

  // Non-Linux fallback
  const isTTY = Boolean(process.stdout.isTTY);
  if (!st || (st.dev === 0 && st.ino === 0) || isTTY) {
    return {
      key: null,
      isInteractiveHuman: !forcedNonInteractive && !hasAgentEnv && isTTY,
    };
  }

  const ppid = process.ppid;
  const key = st.isFIFO() ? `pipe:${st.dev}:${st.ino}:${ppid}` : `${st.dev}:${st.ino}:${ppid}`;
  return { key, isInteractiveHuman: false };
}

function getStateFilePath(): string {
  if (process.env.AICE_CLI_BUDGET_STATE_FILE) {
    const override = process.env.AICE_CLI_BUDGET_STATE_FILE;
    try {
      fs.mkdirSync(path.dirname(override), { recursive: true, mode: 0o700 });
    } catch {}
    return override;
  }
  const aiceHome = process.env.AICE_HOME || path.join(os.homedir(), ".aice");
  const runDir = path.join(aiceHome, "run");
  try {
    fs.mkdirSync(runDir, { recursive: true, mode: 0o700 });
  } catch {}
  return path.join(runDir, "cli-invocation-budget.json");
}

function pruneAndSortEntries(state: BudgetState, now: number): BudgetState {
  const TTL = 20_000;
  const validEntries: Array<[string, BudgetEntry]> = [];
  for (const [k, v] of Object.entries(state)) {
    if (v && typeof v.usedBytes === "number" && typeof v.ts === "number") {
      if (now - v.ts <= TTL) {
        validEntries.push([k, v]);
      }
    }
  }
  validEntries.sort((a, b) => b[1].ts - a[1].ts);
  const capped = validEntries.slice(0, 48);
  const result: BudgetState = {};
  for (const [k, v] of capped) {
    result[k] = v;
  }
  return result;
}

function readStateFile(): BudgetState {
  try {
    const filePath = getStateFilePath();
    if (!fs.existsSync(filePath)) return {};
    const lst = fs.lstatSync(filePath);
    if (!lst.isFile()) return {};
    const content = fs.readFileSync(filePath, "utf-8");
    const parsed = JSON.parse(content) as BudgetState;
    if (parsed && typeof parsed === "object") {
      return pruneAndSortEntries(parsed, Date.now());
    }
  } catch {
    // Wrap all fs I/O in try/catch so it never throws
  }
  return {};
}

function writeStateFile(state: BudgetState): void {
  try {
    const filePath = getStateFilePath();
    const pruned = pruneAndSortEntries(state, Date.now());
    const tmpPath = `${filePath}.tmp.${process.pid}.${Math.random().toString(36).slice(2)}`;
    fs.writeFileSync(tmpPath, JSON.stringify(pruned), { encoding: "utf-8", mode: 0o600 });
    fs.renameSync(tmpPath, filePath);
  } catch {
    // Wrap all fs I/O in try/catch so it never throws
  }
}

export function acquireSharedCliReadBudget(
  key: string | null,
  totalCapBytes = 9_216,
): SharedCliBudgetLease {
  if (!key) {
    return {
      priorUsedBytes: 0,
      maxBytes: totalCapBytes,
      exhausted: false,
      emitDeferralNotice: false,
    };
  }

  const state = readStateFile();
  const entry = Object.hasOwn(state, key) ? state[key] : undefined;
  const priorUsedBytes = entry ? entry.usedBytes : 0;

  if (priorUsedBytes <= 0) {
    return {
      priorUsedBytes: 0,
      maxBytes: totalCapBytes,
      exhausted: false,
      emitDeferralNotice: false,
    };
  }

  // Reserve 256 bytes margin for shell echo separators between chained commands
  const remaining = Math.max(0, totalCapBytes - 256 - priorUsedBytes);
  if (remaining >= 1_200) {
    return {
      priorUsedBytes,
      maxBytes: remaining,
      exhausted: false,
      emitDeferralNotice: false,
    };
  }

  return {
    priorUsedBytes,
    maxBytes: 0,
    exhausted: true,
    emitDeferralNotice: remaining >= 160,
  };
}

export function commitSharedCliReadBytes(key: string | null, emittedBytes: number): void {
  if (!key) return;
  try {
    const state = readStateFile();
    const prev = Object.hasOwn(state, key) ? (state[key]?.usedBytes ?? 0) : 0;
    state[key] = {
      usedBytes: prev + Math.max(0, emittedBytes),
      ts: Date.now(),
    };
    writeStateFile(state);
  } catch {
    // Wrap all fs I/O in try/catch so it never throws
  }
}
