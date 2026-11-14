/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Live Real AI Agent Benchmark Runner (`agy -p` against isolated workspaces on disk).
 * Usage:
 *   npx tsx benchmarks/run-real-agents.ts               # Run all scenarios with a fresh random seed
 *   npx tsx benchmarks/run-real-agents.ts --seed 918273 # Run with an explicit deterministic seed
 *   npx tsx benchmarks/run-real-agents.ts RW-01 RW-11   # Run specific scenarios
 *   npx tsx benchmarks/run-real-agents.ts RW-05:aice_with_idioms
 */

import { execFileSync, spawn } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import YAML from "yaml";
import ts from "../src/compat/typescript.js";
import { parse } from "../src/core/parser.js";
import { decompile } from "../src/decompiler/index.js";
import { emitTarget } from "../src/emitters/index.js";
import { expandModuleIdioms } from "../src/idioms/index.js";
import { estimateTokens } from "../src/tokenomics/index.js";
import {
  type BenchmarkLanguageId,
  buildIdiomRegistryForLanguage,
  OFFLINE_BENCHMARKS,
  type RealWorldBenchmarkSpec,
  SUPPORTED_BENCHMARK_LANGUAGES,
} from "./offline-suite.js";
import {
  buildRealAgentBenchmarkSuiteReport,
  computeRealApiCostUsd,
  formatRealAgentBenchmarkMarkdown,
  type BenchmarkLayerMetrics,
  type RealAgentMode,
  type RealAgentRunMetrics,
} from "./real-agent-suite.js";
import { BenchmarkDashboard } from "./ui/progress-bar.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export const OAUTH_OR_RATE_LIMIT_RE =
  /\b(?:oauth|reauth|invalid_grant|unauthenticated|expired[_\s-]?token|refresh[_\s-]?token|not logged into|rate[_\s-]?limit(?:ed)?|quota[_\s-]?exceeded|too many requests|RESOURCE_EXHAUSTED|overloaded|UNAVAILABLE|ECONNRESET|EAI_AGAIN)\b|(?:status|code|HTTP\/[0-9.]+\s+)(?:401|429|502|503|504)\b/i;

export function buildIsolatedBenchmarkEnv(
  baseEnv: NodeJS.ProcessEnv = process.env,
  cwd?: string,
): NodeJS.ProcessEnv {
  const cleanEnv: NodeJS.ProcessEnv = { ...baseEnv };
  const leakRe = /\/dev\/aice(?:\/|$)|antigravity-cli\/worktrees(?:\/|$)/;

  for (const pathKey of ["PATH", "Path"]) {
    const rawPath = cleanEnv[pathKey];
    if (typeof rawPath === "string" && rawPath.length > 0) {
      cleanEnv[pathKey] = rawPath
        .split(path.delimiter)
        .filter((entry) => entry.length > 0 && !leakRe.test(entry.replace(/\\/g, "/")))
        .join(path.delimiter);
    }
  }

  for (const [k, v] of Object.entries(cleanEnv)) {
    if (k === "PATH" || k === "Path") continue;
    if (typeof v === "string" && leakRe.test(v.replace(/\\/g, "/"))) {
      delete cleanEnv[k];
    }
  }

  if (cwd) {
    cleanEnv.PWD = cwd;
    cleanEnv.INIT_CWD = cwd;
  }
  return cleanEnv;
}

function spawnAgyOnce(
  agyArgs: string[],
  cwd?: string,
  timeoutMs = 660_000,
  maxBuffer = 25 * 1024 * 1024,
): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const useProcessGroup = process.platform !== "win32";
    const child = spawn("agy", agyArgs, {
      cwd,
      env: buildIsolatedBenchmarkEnv(process.env, cwd),
      detached: useProcessGroup,
      stdio: ["ignore", "pipe", "pipe"],
    });

    const stdoutChunks: Buffer[] = [];
    const stderrChunks: Buffer[] = [];
    let stdoutLen = 0;
    let stderrLen = 0;
    let settled = false;
    let timedOut = false;
    let killTimer: ReturnType<typeof setTimeout> | undefined;

    const killChildTree = (sig: NodeJS.Signals) => {
      if (useProcessGroup && child.pid) {
        try {
          process.kill(-child.pid, sig);
        } catch {
          // Process group may already have exited
        }
      }
      try {
        child.kill(sig);
      } catch {
        // Child may already have exited
      }
    };

    const timeoutTimer = setTimeout(() => {
      timedOut = true;
      killChildTree("SIGTERM");
      killTimer = setTimeout(() => {
        killChildTree("SIGKILL");
        child.stdout?.destroy();
        child.stderr?.destroy();
        if (!settled) {
          settled = true;
          const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
          const stderr = Buffer.concat(stderrChunks).toString("utf-8");
          const err: any = new Error(`ETIMEDOUT: agy process timed out after ${timeoutMs}ms`);
          err.code = "ETIMEDOUT";
          err.stdout = stdout;
          err.stderr = stderr;
          reject(err);
        }
      }, 2000);
    }, timeoutMs);

    child.stdout?.on("data", (chunk: Buffer) => {
      if (stdoutLen < maxBuffer) {
        const slice =
          stdoutLen + chunk.length > maxBuffer ? chunk.subarray(0, maxBuffer - stdoutLen) : chunk;
        stdoutChunks.push(slice);
        stdoutLen += slice.length;
      }
    });

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderrLen < maxBuffer) {
        const slice =
          stderrLen + chunk.length > maxBuffer ? chunk.subarray(0, maxBuffer - stderrLen) : chunk;
        stderrChunks.push(slice);
        stderrLen += slice.length;
      }
    });

    child.on("error", (err: any) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      err.stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      err.stderr = Buffer.concat(stderrChunks).toString("utf-8");
      reject(err);
    });

    child.on("close", (code, signal) => {
      clearTimeout(timeoutTimer);
      if (killTimer) clearTimeout(killTimer);
      if (settled) return;
      settled = true;
      const stdout = Buffer.concat(stdoutChunks).toString("utf-8");
      const stderr = Buffer.concat(stderrChunks).toString("utf-8");
      if (timedOut) {
        const err: any = new Error(`ETIMEDOUT: agy process timed out after ${timeoutMs}ms`);
        err.code = "ETIMEDOUT";
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      if (code !== 0) {
        const err: any = new Error(
          `Command failed: agy (exit code ${code ?? "null"}, signal ${signal ?? "none"})`,
        );
        err.code = code;
        err.signal = signal;
        err.stdout = stdout;
        err.stderr = stderr;
        reject(err);
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

export async function execAgyWithRetry(
  agyArgs: string[],
  maxRetries = 3,
  cwd?: string,
): Promise<{ stdout: string; stderr: string }> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await spawnAgyOnce(agyArgs, cwd, 660_000, 25 * 1024 * 1024);
    } catch (err: any) {
      lastError = err;
      const stdout = String(err?.stdout || "");
      const stderr = String(err?.stderr || "");
      const errMsg = String(err?.message || "");
      const fullDiagnostic = `${errMsg}\n${stderr}\n${stdout}`;
      const isTimeout =
        err?.code === "ETIMEDOUT" ||
        /print_timeout|DEADLINE_EXCEEDED|timed out after/i.test(fullDiagnostic);

      if (stderr.trim()) {
        console.error(`[agy stderr (attempt ${attempt + 1}/${maxRetries + 1})]:\n${stderr.trim()}`);
      } else if (errMsg.trim()) {
        console.error(`[agy error (attempt ${attempt + 1}/${maxRetries + 1})]:\n${errMsg.trim()}`);
      }

      const authAndNetDiagnostic = `${errMsg}\n${stderr}`;
      const isRetryable = !isTimeout && OAUTH_OR_RATE_LIMIT_RE.test(authAndNetDiagnostic);
      if (isRetryable && attempt < maxRetries) {
        const delayMs = 3000 * Math.pow(2, attempt);
        console.warn(
          `[agy retry] Auth/rate-limit/network error detected. Retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`,
        );
        await new Promise((resolve) => setTimeout(resolve, delayMs));
        continue;
      }

      throw err;
    }
  }
  throw lastError;
}
export const DEFAULT_ADVERSARIAL_SEED = 20261108;

export function generateFreshBenchmarkSeed(): number {
  return 10_000_000 + Math.floor(Math.random() * 89_999_999);
}

export function hashBenchmarkSeed(seed: number, key: string): number {
  let h = (seed ^ 0x811c9dc5) >>> 0;
  const fullKey = `${key}:${seed}`;
  for (let i = 0; i < fullKey.length; i++) {
    h ^= fullKey.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

const CODE_LANGS = new Set<BenchmarkLanguageId>([
  "ts",
  "js",
  "py",
  "go",
  "rs",
  "cpp",
  "cs",
  "kt",
  "php",
]);

/**
 * RW-11: Genuine "Unfair / Hostile-to-AICE" Single-File, Zero-Idiom Scenario ("Lone Needle in a Decoy Haystack").
 * - 1 file (`ledger_reconciler.ts`) -> cross-file `--batch` gives zero advantage.
 * - 0 repeated project idioms (14 heterogeneous functions with distinct AST structures) -> `$idiom` mining/templates give zero advantage.
 * - Only 1 target function update (non-first, seeded) + 1 obsolete function deletion (`deprecatedLedgerCursor`).
 * - Decoy sentinel function (`verifyDecoySentinel_<hex>`) and decoy comment/string literal traps (`legacy_deprecated_obsolete_probe`).
 */
export const HOSTILE_LONE_NEEDLE_SPEC: RealWorldBenchmarkSpec = {
  id: "RW-11",
  title: "Single-File 0-Idiom Surgical Bug-Fix (Lone Needle in a Decoy Haystack)",
  description:
    "Hostile-to-AICE single-file TypeScript ledger reconciler with 14 heterogeneous functions, 0 repeated project idioms, and decoy traps where cross-file batching and $idioms provide zero advantage.",
  scenario: "bug_fix",
  appSurface: "non_window",
  files: [
    {
      fileName: "ledger_reconciler.ts",
      languageId: "ts",
      aiceWithIdioms: [
        "type LedgerBatchHeader:",
        "  batchId:int",
        "  shardKey:int",
        "  epochSeconds:int",
        "  isSettled:bool",
        "",
        "pub fn computeBaseFee(amountCents:int) -> int:",
        "  ret (amountCents / 100) + 5",
        "",
        "pub fn validateAccountTier(tierCode:int) -> int:",
        "  if tierCode == 1:",
        "    ret 10",
        "  ret 25",
        "",
        "pub fn reconcileBatchWindow(windowTicks:int) -> int:",
        "  cursor ::= windowTicks * 3",
        "  if cursor < 0:",
        "    cursor = 0",
        "  ret cursor + 17",
        "",
        "pub fn estimateSettlementLag(hops:int) -> int:",
        "  lagMs ::= hops * 12",
        "  if lagMs > 500:",
        "    ret 500",
        "  ret lagMs",
        "",
        "pub fn scoreVelocityRisk(txCount:int) -> int:",
        "  riskScore ::= txCount * 7",
        "  if riskScore < 10:",
        "    riskScore = 10",
        "  ret riskScore + 9",
        "",
        "pub fn normalizeCurrencyScale(decimals:int) -> int:",
        "  if decimals <= 0:",
        "    ret 1",
        "  ret decimals * 10",
        "",
        "pub fn projectReserveBuffer(balanceCents:int) -> int:",
        "  reserveVal ::= balanceCents * 4",
        "  if reserveVal < 50:",
        "    reserveVal = 50",
        "  ret reserveVal + 23",
        "",
        "pub fn auditSequenceGap(expectedSeq:int) -> int:",
        "  ret (expectedSeq - 1) * 2",
        "",
        "pub fn computeRetryBackoffMs(attemptIdx:int) -> int:",
        "  waitMs ::= attemptIdx * 25",
        "  if waitMs > 1000:",
        "    ret 1000",
        "  ret waitMs",
        "",
        "pub fn partitionShardSlot(accountHash:int) -> int:",
        "  ret accountHash % 64",
        "",
        "pub fn deriveQuorumWeight(voterCount:int) -> int:",
        "  ret (voterCount * 2) + 1",
        "",
        "pub fn capDailyWithdrawal(requestedCents:int) -> int:",
        "  if requestedCents > 250000:",
        "    ret 250000",
        "  ret requestedCents",
        "",
        "pub fn deprecatedLedgerCursor(seed:int) -> int:",
        "  ret seed - 1",
      ].join("\n"),
      targetSymbol: "reconcileBatchWindow",
      updatedTargetSymbolAiceWithIdioms: [
        "pub fn reconcileBatchWindow(windowTicks:int) -> int:",
        "  cursor ::= windowTicks * 3 + 19",
        "  if cursor < 0:",
        "    cursor = 0",
        "  ret cursor + 640",
      ].join("\n"),
      refactorSymbols: [
        "computeBaseFee",
        "validateAccountTier",
        "estimateSettlementLag",
        "scoreVelocityRisk",
        "normalizeCurrencyScale",
        "projectReserveBuffer",
        "auditSequenceGap",
        "computeRetryBackoffMs",
        "reconcileBatchWindow",
        "partitionShardSlot",
        "deriveQuorumWeight",
        "capDailyWithdrawal",
      ],
      obsoleteSymbol: "deprecatedLedgerCursor",
    },
  ],
};

export const ALL_REAL_AGENT_BENCHMARKS: readonly RealWorldBenchmarkSpec[] = [
  ...OFFLINE_BENCHMARKS,
  HOSTILE_LONE_NEEDLE_SPEC,
];

export interface ScenarioLayerDefinition {
  layerIndex: 2 | 3;
  title: string;
  taskPrompt: string;
  targetFiles: string[];
  expectedKeywords: string[];
}

export const SCENARIO_LAYER_DEFINITIONS: Record<
  string,
  { layer2: ScenarioLayerDefinition; layer3: ScenarioLayerDefinition }
> = {
  "RW-01": {
    layer2: {
      layerIndex: 2,
      title: "Speed Tiers & Food Multipliers",
      taskPrompt:
        "Layer 2: Add speed tiers (adjusting snake interval dynamically per score band with keyword `speedTier` or `interval`) in engine.ts, bonus food multiplier glow styling in styles.css, and level configuration tiers in game_config.json.",
      targetFiles: ["engine.ts", "styles.css", "game_config.json"],
      expectedKeywords: ["speedTier|interval", "multiplier", "glow|powerUpGlow"],
    },
    layer3: {
      layerIndex: 3,
      title: "LocalStorage High-Score & Pause Overlay",
      taskPrompt:
        "Layer 3: Add localStorage high-score persistence in engine.ts and keyboard pause/resume overlay modal with backdrop styling in styles.css and index.html.",
      targetFiles: ["engine.ts", "index.html", "styles.css"],
      expectedKeywords: ["highScore|highscore", "saveHighScore|storage|localStorage", "pauseModal|pause|overlay"],
    },
  },
  "RW-02": {
    layer2: {
      layerIndex: 2,
      title: "Rate-Limiting Token Bucket",
      taskPrompt:
        "Layer 2: Add a token bucket rate limiter in worker.py to throttle worker job dispatch, controlled by rate and burst settings in pipeline.yaml.",
      targetFiles: ["worker.py", "pipeline.yaml"],
      expectedKeywords: ["TokenBucket|token_bucket|rate_limit", "refill_rate|rate", "capacity|burst"],
    },
    layer3: {
      layerIndex: 3,
      title: "Prometheus Metrics & Graceful SIGTERM",
      taskPrompt:
        "Layer 3: Add a Prometheus /metrics endpoint exposing worker telemetry and install a graceful SIGTERM signal handler to drain in-flight batches in worker.py and schema.json.",
      targetFiles: ["worker.py", "schema.json"],
      expectedKeywords: ["metrics|prometheus", "sigterm|SIGTERM", "drain|graceful"],
    },
  },
  "RW-03": {
    layer2: {
      layerIndex: 2,
      title: "Promotional Coupon Validation",
      taskPrompt:
        "Layer 2: Add tiered promotional coupon code validation in CheckoutController.php, a coupon input row in checkout.twig, and client-side code verification in cart-client.js.",
      targetFiles: ["CheckoutController.php", "checkout.twig", "cart-client.js"],
      expectedKeywords: ["applyCouponCode|coupon", "couponRow|coupon|discount", "discountTier|tier|discount"],
    },
    layer3: {
      layerIndex: 3,
      title: "Multi-Currency VAT Auto-Calculation",
      taskPrompt:
        "Layer 3: Add multi-currency VAT auto-calculation in CheckoutController.php with active currency selector in checkout.twig and exchange rates in shipping_rates.json.",
      targetFiles: ["CheckoutController.php", "checkout.twig", "shipping_rates.json"],
      expectedKeywords: ["calculateVat|vat|tax", "currencySelector|currency", "vatRate|rate|tax"],
    },
  },
  "RW-04": {
    layer2: {
      layerIndex: 2,
      title: "Live Sparkline Charts & Date Filter",
      taskPrompt:
        "Layer 2: Add live sparkline trend charts in DashboardPanel.tsx with historical series in metrics-store.ts and date-range filter picker styling in dashboard.css.",
      targetFiles: ["DashboardPanel.tsx", "metrics-store.ts", "dashboard.css"],
      expectedKeywords: ["SparklineChart|sparkline", "dateRangePicker|dateRange|filter", "sparklineData|series|data"],
    },
    layer3: {
      layerIndex: 3,
      title: "CSV Export Stream & Theme Persistence",
      taskPrompt:
        "Layer 3: Add a streaming CSV export helper for cohort retention data in DashboardPanel.tsx and persist dark/light theme preferences in metrics-store.ts with display in index.html.",
      targetFiles: ["DashboardPanel.tsx", "metrics-store.ts", "index.html"],
      expectedKeywords: ["exportCsvStream|csv|export", "themePersistence|theme|colorScheme", "colorScheme|theme|storage"],
    },
  },
  "RW-05": {
    layer2: {
      layerIndex: 2,
      title: "Trace Span Propagation & LZ4 Buffer",
      taskPrompt:
        "Layer 2: Add distributed trace span header propagation in gateway.go and ring buffer LZ4 compression staging in wal_engine.rs.",
      targetFiles: ["gateway.go", "wal_engine.rs"],
      expectedKeywords: ["PropagateTraceSpan|trace|span", "compress_lz4_buffer|lz4|ring", "trace_id|traceId|trace"],
    },
    layer3: {
      layerIndex: 3,
      title: "Monotonic Audit & Heartbeat Probe",
      taskPrompt:
        "Layer 3: Add monotonic sequence validation in gateway.go and cluster heartbeat liveness probe configuration in cluster.yaml.",
      targetFiles: ["gateway.go", "cluster.yaml"],
      expectedKeywords: ["AuditSequenceMonotonic|monotonic|seq", "heartbeatProbeInterval|heartbeat|probe", "seq_num|sequence|seq"],
    },
  },
  "RW-06": {
    layer2: {
      layerIndex: 2,
      title: "Restitution Velocity Damping",
      taskPrompt:
        "Layer 2: Add restitution velocity damping and angular spin impulse to the collision resolver in viewport_sim.cpp, exposed to inspector.ts.",
      targetFiles: ["viewport_sim.cpp", "inspector.ts"],
      expectedKeywords: ["applyRestitutionDamping|restitution|damping", "angularSpin|spin|angular", "dampingFactor|damping|impulse"],
    },
    layer3: {
      layerIndex: 3,
      title: "Particle Collision Burst Emitter",
      taskPrompt:
        "Layer 3: Add particle burst emitter on high-energy impacts in viewport_sim.cpp with canvas HUD overlay in overlay.html and overlay.css.",
      targetFiles: ["viewport_sim.cpp", "overlay.html", "overlay.css"],
      expectedKeywords: ["emitParticleBurst|particle|burst", "particleCanvasOverlay|canvas|overlay", "burstCount|count|burst"],
    },
  },
  "RW-07": {
    layer2: {
      layerIndex: 2,
      title: "Tiered Risk Weighting & Audit Events",
      taskPrompt:
        "Layer 2: Add tiered velocity risk score weighting in FraudScorer.kt and emit compliance audit events in SettlementEngine.cs.",
      targetFiles: ["FraudScorer.kt", "SettlementEngine.cs"],
      expectedKeywords: ["calculateRiskWeight|risk|weight", "EmitAuditEvent|audit|event", "riskScore|score|risk"],
    },
    layer3: {
      layerIndex: 3,
      title: "Replay Fraud Window & KMS Key Rotation",
      taskPrompt:
        "Layer 3: Add replay attack deduplication window in FraudScorer.kt and automated KMS envelope key rotation check in SettlementEngine.cs with thresholds in risk_rules.json.",
      targetFiles: ["FraudScorer.kt", "SettlementEngine.cs", "risk_rules.json"],
      expectedKeywords: ["detectReplayWindow|replay|dedup", "RotateKmsEnvelopeKey|kms|rotation", "replayWindowSec|window|replay"],
    },
  },
  "RW-08": {
    layer2: {
      layerIndex: 2,
      title: "Invoice PDF Webhook & Rules Table",
      taskPrompt:
        "Layer 2: Add an asynchronous invoice PDF generation webhook in billing_service.py and a discount rule management table in UsageChart.tsx.",
      targetFiles: ["billing_service.py", "UsageChart.tsx"],
      expectedKeywords: ["export_pdf_webhook|pdf|webhook", "DiscountRulesTable|discount|rules", "invoice_pdf|invoice|pdf"],
    },
    layer3: {
      layerIndex: 3,
      title: "Dunning Escalation & Quota Gauges",
      taskPrompt:
        "Layer 3: Add dunning email retry escalation scheduler in worker_cron.yaml and real-time usage quota warning gauges in billing_service.py and plans.json.",
      targetFiles: ["billing_service.py", "worker_cron.yaml", "plans.json"],
      expectedKeywords: ["escalate_dunning_schedule|dunning|escalat", "tenantQuotaGauge|quota|gauge", "dunning_retry|retry|dunning"],
    },
  },
  "RW-09": {
    layer2: {
      layerIndex: 2,
      title: "Iceberg Order Slicing & Feed Normalizer",
      taskPrompt:
        "Layer 2: Add iceberg order hidden-quantity slicing in matcher.rs and normalize multi-venue tick collar bands in margin_calc.cpp.",
      targetFiles: ["matcher.rs", "margin_calc.cpp"],
      expectedKeywords: ["slice_iceberg_order|iceberg|slice", "normalizeVenueCollar|venue|collar", "display_qty|qty|quantity"],
    },
    layer3: {
      layerIndex: 3,
      title: "Margin Guard RPC & Latency Histogram",
      taskPrompt:
        "Layer 3: Add a circuit breaker RPC fallback in matcher.rs and an intraday execution latency histogram in collar_bands.json.",
      targetFiles: ["matcher.rs", "collar_bands.json"],
      expectedKeywords: ["circuitBreakerRpc|circuit_breaker|fallback", "latencyHistogram|histogram|latency", "trip_threshold|threshold|latency"],
    },
  },
  "RW-10": {
    layer2: {
      layerIndex: 2,
      title: "Multi-Tenant Auth & SLO Burn Alerts",
      taskPrompt:
        "Layer 2: Add multi-tenant JWT authorization middleware in telemetry_router.ts and multi-window SLO burn rate alerting in AlertDispatcher.kt and mesh_topology.yaml.",
      targetFiles: ["telemetry_router.ts", "AlertDispatcher.kt", "mesh_topology.yaml"],
      expectedKeywords: ["multiTenantAuthGuard|authGuard|jwt", "evaluateSloBurnRate|slo|burn", "tenant_id|tenantId|tenant"],
    },
    layer3: {
      layerIndex: 3,
      title: "Distributed Audit Log & Auto-Remediation",
      taskPrompt:
        "Layer 3: Add append-only distributed audit event bus in trace_ring.rs and automated flapping alert remediation triggers in anomaly_worker.py with display in status_digest.twig.",
      targetFiles: ["trace_ring.rs", "anomaly_worker.py", "status_digest.twig"],
      expectedKeywords: ["append_distributed_audit|audit|event", "trigger_auto_remediation|remediat|flapping", "auditLog|audit_log|audit"],
    },
  },
  "RW-11": {
    layer2: {
      layerIndex: 2,
      title: "Monotonic Batch Sequence Validation",
      taskPrompt:
        "Layer 2: Add a monotonic batch sequence epoch validator method in ledger_reconciler.ts (ensuring sequence numbers are strictly ascending without gaps).",
      targetFiles: ["ledger_reconciler.ts"],
      expectedKeywords: ["validateBatchSequenceMonotonic|monotonic|seq", "seqEpoch|sequence|epoch"],
    },
    layer3: {
      layerIndex: 3,
      title: "HMAC Payload Checksum Guard",
      taskPrompt:
        "Layer 3: Add an HMAC-SHA256 payload integrity verification method in ledger_reconciler.ts to validate batch digests prior to reconciliation. IMPORTANT: Do NOT touch or modify verifyDecoySentinel_* or DECOY_SENTINEL_*.",
      targetFiles: ["ledger_reconciler.ts"],
      expectedKeywords: ["verifyPayloadHmacChecksum|hmac|checksum", "hmacDigest|digest|hmac"],
    },
  },
};

export function computeFileDecoySpec(
  seed: number,
  benchmarkId: string,
  fileName: string,
): { hexSeed: string; decoyStep: number; fnName: string; commentTag: string } {
  const h = hashBenchmarkSeed(seed, `${benchmarkId}:${fileName}`);
  const hexSeed = (h & 0xffff).toString(16).padStart(4, "0");
  const decoyStep = 700 + (h % 250);
  return {
    hexSeed,
    decoyStep,
    fnName: `verifyDecoySentinel_${hexSeed}`,
    commentTag: `DECOY_SENTINEL_${hexSeed}: legacy_deprecated_obsolete_probe + ${decoyStep}`,
  };
}

export interface SeededFileMutationSpec {
  targetIdx: number;
  targetSymbol: string;
  plainEnglishLine: string;
  expectedTokens: string[];
  seededSteps?: [number, number, number];
}

/**
 * Procedurally selects a NON-FIRST target symbol (`targetIdx >= 1`) in the file
 * and generates seeded numeric parameters + a blind plain-English description that
 * identifies the symbol by its unique domain signature/attributes (never leaking the
 * symbol name and never using `@first` or "first").
 */
export function computeSeededFileMutation(
  seed: number,
  benchmarkId: string,
  f: RealWorldBenchmarkSpec["files"][number],
  isNewFeature: boolean,
): SeededFileMutationSpec {
  const h = hashBenchmarkSeed(seed, `${benchmarkId}:target:${f.fileName}`);
  const targetIdx =
    f.refactorSymbols.length > 1 ? 1 + (h % (f.refactorSymbols.length - 1)) : 0;
  const targetSymbol = f.refactorSymbols[targetIdx];
  const cleanSym = targetSymbol.replace(/^config\./, "").replace(/^[.#]/, "");

  if (benchmarkId === "RW-11") {
    const offset = 15 + ((h >>> 4) % 35);
    const finalAdd = 610 + ((h >>> 9) % 340);
    const floorMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)\\n\\s+if \\2 < (\\d+):\\n\\s+\\2 = \\4\\n\\s+ret \\2 \\+ (\\d+)`,
      ),
    );
    if (floorMatch) {
      const [, param, stateVar, scaleStr, floorStr, origAddStr] = floorMatch;
      return {
        targetIdx,
        targetSymbol,
        plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} (currently clamping ${stateVar} < ${floorStr} to ${floorStr} and returning ${stateVar} + ${origAddStr}): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, keep if ${stateVar} < ${floorStr}: ${stateVar} = ${floorStr}, and return ${stateVar} + ${finalAdd}.`,
        expectedTokens: [String(offset), String(finalAdd)],
      };
    }
    const ceilMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)\\n\\s+if \\2 > (\\d+):\\n\\s+ret \\4\\n\\s+ret \\2`,
      ),
    );
    if (ceilMatch) {
      const [, param, stateVar, scaleStr, capStr] = ceilMatch;
      return {
        targetIdx,
        targetSymbol,
        plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} and caps ${stateVar} > ${capStr}: set ${stateVar} = ${param} * ${scaleStr} + ${offset}, if ${stateVar} > ${finalAdd}: return ${finalAdd}, and return ${stateVar}.`,
        expectedTokens: [String(offset), String(finalAdd)],
      };
    }
    const genericMatch = f.aiceWithIdioms.match(
      new RegExp(`pub fn ${cleanSym}\\((\\w+):int\\) -> int:`),
    );
    if (!genericMatch) {
      throw new Error(`RW-11 target ${cleanSym} failed signature match`);
    }
    const [, param] = genericMatch;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine: `   - ${f.fileName}: update the function taking (${param}: int) -> int: compute adjusted = ${param} * 3 + ${offset}, if adjusted < 0: adjusted = 0, and return adjusted + ${finalAdd}.`,
      expectedTokens: [String(offset), String(finalAdd)],
    };
  }

  if (CODE_LANGS.has(f.languageId)) {
    const fnMatch = f.aiceWithIdioms.match(
      new RegExp(
        `pub fn ${cleanSym}\\((\\w+):int\\) -> int:\\n\\s+(\\w+) ::= \\1 \\* (\\d+)[\\s\\S]*?\\$\\w+\\(\\2,\\s*(\\d+),\\s*(\\d+),\\s*(\\d+)\\)`,
      ),
    );
    if (!fnMatch) {
      throw new Error(`Could not match target function ${cleanSym} in ${f.fileName}`);
    }
    const [, param, stateVar, scaleStr, origLo, origHi] = fnMatch;
    const offset = 11 + ((h >>> 3) % 29);
    const b0Lo = 14 + ((h >>> 7) % 18);
    const b0Hi = 520 + ((h >>> 11) % 380);
    const b0Step = 11 + ((h >>> 15) % 14);
    const b1Lo = b0Lo * 2;
    const b1Hi = b0Hi * 2;
    const b1Step = b0Step * 2;
    const b2Lo = b0Lo * 4;
    const b2Hi = b0Hi * 4;
    const b2Step = b0Step * 3;
    const bandsDesc = `(min=${b0Lo}, max=${b0Hi}, step=${b0Step}), (min=${b1Lo}, max=${b1Hi}, step=${b1Step}), (min=${b2Lo}, max=${b2Hi}, step=${b2Step})`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new public function named "<matchedFnName>Extended"(${param}: int) -> int immediately after the domain function taking (${param}: int) that initializes ${stateVar} = ${param} * ${scaleStr} (initial band [${origLo}, ${origHi}]): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bandsDesc}, and return ${stateVar}.`
      : `   - ${f.fileName}: update the domain function taking (${param}: int) -> int that initializes ${stateVar} = ${param} * ${scaleStr} (initial band [${origLo}, ${origHi}]): set ${stateVar} = ${param} * ${scaleStr} + ${offset}, clamp ${stateVar} < 0 to 0, apply 3 clamping band steps ${bandsDesc}, and return ${stateVar}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [String(b0Hi), String(b2Hi)],
      seededSteps: [b0Step, b1Step, b2Step],
    };
  }

  if (f.languageId === "tsx") {
    const compMatch = f.aiceWithIdioms.match(
      new RegExp(
        `component ${cleanSym}\\(\\):\\n\\s+section\\(class="kpi-section", id="([^"]+)"\\)`,
      ),
    );
    if (!compMatch) {
      throw new Error(`Could not match TSX component ${cleanSym} in ${f.fileName}`);
    }
    const [, secId] = compMatch;
    const v0 = String(1210 + ((h >>> 4) % 680));
    const v1 = `${14 + ((h >>> 8) % 25)}ms`;
    const v2 = `99.${91 + ((h >>> 12) % 8)}%`;
    const tilesDesc = isNewFeature
      ? `(data-metric="spark_0", label="Live Velocity", value="${v0}"), (data-metric="spark_1", label="Cohort Retention", value="${v1}"), (data-metric="spark_2", label="Alert Burn Rate", value="${v2}")`
      : `(data-metric="fixed_0", label="Verified KPI", value="${v0}"), (data-metric="fixed_1", label="Verified P95", value="${v1}"), (data-metric="fixed_2", label="Verified Uptime", value="${v2}")`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new component named "<matchedComponentName>Sparkline" immediately after the component rendering section.kpi-section#${secId}, rendering section.kpi-section#${secId}_spark with 3 KPI tiles: ${tilesDesc}.`
      : `   - ${f.fileName}: update the component rendering section.kpi-section#${secId} so its 3 KPI tiles are: ${tilesDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [v0, v1],
    };
  }

  if (f.languageId === "css") {
    const origZ = targetIdx + 1;
    const pad0 = 17 + ((h >>> 4) % 7);
    const gap0 = 9 + ((h >>> 8) % 5);
    const pad1 = pad0 + 4;
    const gap1 = gap0 + 4;
    const zNew = 40 + ((h >>> 12) % 45);
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new CSS rule named "<matchedClassSelector>-active" immediately after the class rule that currently has z-index: ${origZ}, with two flex-centered card blocks (padding: ${pad0}px, gap: ${gap0}px) and (padding: ${pad1}px, gap: ${gap1}px) and z-index: ${zNew}.`
      : `   - ${f.fileName}: update the class rule that currently has z-index: ${origZ} to two flex-centered card blocks (padding: ${pad0}px, gap: ${gap0}px) and (padding: ${pad1}px, gap: ${gap1}px) and z-index: ${zNew}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [`${pad0}px`, String(zNew)],
    };
  }

  if (f.languageId === "html") {
    const secMatch = f.aiceWithIdioms.match(
      new RegExp(
        `section\\(id="${cleanSym}", class="panel"\\) \\{\\n\\s+\\$\\w+\\("[^"]+",\\s*"([^"]+)",\\s*"([^"]+)"\\)`,
      ),
    );
    if (!secMatch) {
      throw new Error(`Could not match HTML section ${cleanSym} in ${f.fileName}`);
    }
    const [, origLabel0] = secMatch;
    const hv0 = String(815 + ((h >>> 4) % 170));
    const hv1 = String(415 + ((h >>> 8) % 170));
    const rowsDesc = isNewFeature
      ? `(data-key="new_0", label="Live Peak", value="${hv0}") and (data-key="new_1", label="Live Floor", value="${hv1}")`
      : `(data-key="upd_0", label="Verified Metric", value="${hv0}") and (data-key="upd_1", label="Verified Delta", value="${hv1}")`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new <section id="<matchedSectionId>_extra" class="panel"> immediately after the <section class="panel"> whose metric row has label="${origLabel0}", with 2 metric rows: ${rowsDesc}.`
      : `   - ${f.fileName}: update the <section class="panel"> whose metric row has label="${origLabel0}" to 2 metric rows: ${rowsDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [hv0, hv1],
    };
  }

  if (f.languageId === "twig") {
    const blkMatch = f.aiceWithIdioms.match(
      new RegExp(
        `block\\(name="${cleanSym}"\\) \\{\\n\\s+\\$\\w+\\("([^"]+)",\\s*(\\w+)\\)`,
      ),
    );
    if (!blkMatch) {
      throw new Error(`Could not match Twig block ${cleanSym} in ${f.fileName}`);
    }
    const [, origLabel0] = blkMatch;
    const tagNum = 10 + ((h >>> 4) % 85);
    const tLabel0 = isNewFeature ? `Summary Total ${tagNum}` : `Updated Total ${tagNum}`;
    const tLabel1 = isNewFeature ? "Tax Total" : "Discount Total";
    const tVar0 = isNewFeature ? "val_sum_0" : "val_upd_0";
    const tVar1 = isNewFeature ? "val_sum_1" : "val_upd_1";
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new Twig block named "<matchedBlockName>_summary" immediately after the Twig block containing summary row label="${origLabel0}", with 2 summary rows: (label="${tLabel0}", variable=${tVar0}) and (label="${tLabel1}", variable=${tVar1}).`
      : `   - ${f.fileName}: update the Twig block containing summary row label="${origLabel0}" to 2 summary rows: (label="${tLabel0}", variable=${tVar0}) and (label="${tLabel1}", variable=${tVar1}).`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [tLabel0],
    };
  }

  if (f.languageId === "json" || f.languageId === "yaml") {
    const keyMatch = f.aiceWithIdioms.match(
      new RegExp(
        `${cleanSym}:\\s*\\[\\n\\s+\\$\\w+\\("([^"]+)",\\s*(\\d+),\\s*(\\d+)\\)`,
      ),
    );
    if (!keyMatch) {
      throw new Error(`Could not match JSON/YAML key ${cleanSym} in ${f.fileName}`);
    }
    const [, origEntryId] = keyMatch;
    const jT0 = 32 + ((h >>> 4) % 40);
    const jL0 = 3250 + ((h >>> 8) % 1400);
    const jT1 = jT0 * 2;
    const jL1 = jL0 + 400;
    const eId0 = isNewFeature ? "stream_0" : "verified_0";
    const eId1 = isNewFeature ? "stream_1" : "verified_1";
    const entriesDesc =
      f.languageId === "json"
        ? `(id="${eId0}", threshold=${jT0}, limit=${jL0}) and (id="${eId1}", threshold=${jT1}, limit=${jL1})`
        : `(worker="${eId0}", port=${jT0}, concurrency=${jL0}) and (worker="${eId1}", port=${jT1}, concurrency=${jL1})`;
    const schemaHint =
      f.languageId === "json"
        ? "policy rule entries (retaining standard retries/enabled/windowSec fields)"
        : "service tier entries (retaining standard replicas/healthIntervalSec/tlsRequired fields)";
    const idField = f.languageId === "json" ? `id="${origEntryId}"` : `worker="${origEntryId}"`;
    const plainEnglishLine = isNewFeature
      ? `   - ${f.fileName}: add a new top-level key named "<matchedKey>_realtime" (config.<matchedKey>_realtime) immediately after the top-level key whose entry has ${idField}, with 2 ${schemaHint}: ${entriesDesc}.`
      : `   - ${f.fileName}: update the top-level key whose entry has ${idField} to 2 ${schemaHint}: ${entriesDesc}.`;
    return {
      targetIdx,
      targetSymbol,
      plainEnglishLine,
      expectedTokens: [eId0, String(jL0)],
    };
  }

  throw new Error(`Unhandled file spec: ${f.fileName}`);
}

/**
 * Cold-Start Workspace Setup:
 * Writes ONLY native source files (with procedurally seeded decoy sentinel functions and
 * decoy comment traps in code files). Never writes `aice.config.json`, `.aice-idioms.json`, or `.aice` files.
 */
export function setupWorkspace(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `aice-${spec.id.toLowerCase()}-${mode}-`));
  for (const f of spec.files) {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === f.languageId);
    if (!langSpec) throw new Error(`Unknown languageId ${f.languageId}`);
    const { idioms } = buildIdiomRegistryForLanguage(f.languageId);
    const decoy = computeFileDecoySpec(seed, spec.id, f.fileName);
    const sourceAice = CODE_LANGS.has(f.languageId)
      ? `${f.aiceWithIdioms.trimEnd()}\n\npub fn ${decoy.fnName}(probe:int) -> int:\n  ret probe + ${decoy.decoyStep}\n`
      : f.aiceWithIdioms;
    const ast = parse(sourceAice, `${f.fileName}.aice`);
    const expanded = expandModuleIdioms(ast, idioms);
    let native = emitTarget(expanded, langSpec.target, { watermark: false });
    if (CODE_LANGS.has(f.languageId)) {
      const commentLine =
        f.languageId === "py" ? `# ${decoy.commentTag}\n` : `// ${decoy.commentTag}\n`;
      native = `${native.trimEnd()}\n${commentLine}`;
    }
    fs.writeFileSync(path.join(dir, f.fileName), native, "utf-8");
  }
  return dir;
}

export function buildTaskSpecText(
  spec: RealWorldBenchmarkSpec,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const isNewFeature = spec.scenario === "new_feature";
  const updateLines = spec.files.map(
    (f) => computeSeededFileMutation(seed, spec.id, f, isNewFeature).plainEnglishLine,
  );

  if (spec.id === "RW-11") {
    return [
      `Engineering Task (${spec.title}):`,
      `1. Target Symbol Update (Blind Discovery — inspect the file to identify the matching domain function by its parameter & formula; do NOT touch verifyDecoySentinel_* or DECOY_SENTINEL_* comments):`,
      ...updateLines,
      `2. Delete Obsolete Symbol:`,
      `   - Locate and delete the obsolete function declaration whose identifier starts with "deprecated", "legacy", or "obsolete" (do NOT delete the DECOY_SENTINEL_* comment at the end of the file).`,
    ].join("\n");
  }

  const patternLines: string[] = [];
  const presentLangs = new Set(spec.files.map((f) => f.languageId));
  if (spec.files.some((f) => CODE_LANGS.has(f.languageId))) {
    const codeFiles = spec.files
      .filter((f) => CODE_LANGS.has(f.languageId))
      .map((f) => f.fileName)
      .join(", ");
    patternLines.push(
      `   - Code files (${codeFiles}): in every clamping band step across all domain functions in the workspace (including updated/newly added ones), change the step increment at the end of each band from "+ step" to "+ step + 1". IMPORTANT: Do NOT modify or delete any verifyDecoySentinel_* function or DECOY_SENTINEL_* comment (its "probe + <N>" expression is a sentinel check, NOT a clamping band step).`,
    );
  }
  if (presentLangs.has("tsx")) {
    patternLines.push(
      `   - TSX files: change every KPI tile container class from "kpi-tile" to "kpi-tile-v2".`,
    );
  }
  if (presentLangs.has("css")) {
    patternLines.push(`   - CSS files: change every card border-radius from 8px to 12px.`);
  }
  if (presentLangs.has("html")) {
    patternLines.push(
      `   - HTML files: change every metric row container class from "metric-row" to "metric-row-v2".`,
    );
  }
  if (presentLangs.has("twig")) {
    patternLines.push(
      `   - Twig files: change every summary row container class from "summary-row" to "summary-row-v2".`,
    );
  }
  if (presentLangs.has("json")) {
    patternLines.push(
      `   - JSON files: in every policy rule entry across the file, change retries from 3 to 5 and windowSec from 60 to 120.`,
    );
  }
  if (presentLangs.has("yaml")) {
    patternLines.push(
      `   - YAML files: in every service tier entry across the file, change replicas from 3 to 4 and healthIntervalSec from 15 to 10.`,
    );
  }

  return [
    `Engineering Task (${spec.title}):`,
    `1. Target Symbol Updates (Blind Discovery — inspect the workspace to locate each target declaration by its domain signature/attributes):`,
    ...updateLines,
    `2. Delete Obsolete Symbols:`,
    `   - Locate and delete every obsolete/legacy/deprecated function, component, CSS rule, HTML section, Twig block, or config key across the workspace (any symbol declaration whose identifier contains "legacy", "deprecated", or "obsolete"; do NOT delete DECOY_SENTINEL_* comments).`,
    `3. Multi-File Pattern Refactor across all domain functions/elements/rules in the workspace:`,
    ...patternLines,
  ].join("\n");
}

export function buildPrompt(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  dir: string,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const taskText = buildTaskSpecText(spec, seed);
  const boundaryRule = `Workspace Boundary: Work strictly inside ${dir}. Never inspect, search, or access parent directories (..) or external repositories.`;

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      boundaryRule,
      `Environment: WITHOUT AICE (Native File & Search Tools — Cold-Start Repository).`,
      `Allowed tools: Native file and search tools (read_file, edit_file, write_file, view_file, replace_file_content, multi_replace_file_content, grep_search, find_by_name, or ls/rg discovery via run_command). Do NOT run \`aice\` or write files via shell scripts/redirection.`,
      taskText,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  if (mode === "aice_no_idioms") {
    return [
      `Workspace: ${dir}`,
      boundaryRule,
      `Environment: AICE On-the-Fly WITHOUT Idioms (2-Pillar Unified AICE CLI — Cold-Start Repository).`,
      `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use read_file, write_file, edit_file, view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, --dry-run, or $idiom macros.`,
      `AICE 2-Pillar CLI Reference (\`--no-idioms\`):`,
      `1. Read (\`aice context\`):`,
      `   - \`aice context . -s "*" --no-idioms\`: Extract \`// symbols:\` headers and compact pure-AICE slices across the workspace (for >8 files, pass 2 file-list subsets so 4KB tool output is never truncated).`,
      `2. Mutate (\`aice splice\` / \`aice write\` — pre-validates AST & native compiler syntax before writing; omit \`verifyDecoySentinel_*\` so it stays untouched):`,
      `   - Zero-escaping unified heredoc stream (preferred for multi-line edits, updates, deletions, or appends):`,
      `     \`aice splice --no-idioms --stdin << 'EOF'\``,
      `     \`=== <file>:<symbol> ===\` (prefer compact \`<<< / === / >>>\` hunks inside \`:symbol\` for localized statement/step/constant edits instead of rewriting full function bodies, or pass pure AICE to replace the whole symbol)`,
      `     \`=== <file>:<symbol> --delete ===\` (delete obsolete symbol)`,
      `     \`=== <file>:eof ===\` (append new symbol/rule)`,
      `     \`EOF\``,
      `   - Or JSON batch array (supports \`insertAfter\` anchor placement):`,
      `     \`aice splice --no-idioms --batch '[{"file":"<file>","symbol":"<sym>","code":"<pure AICE>"},{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<pure AICE>"},{"file":"<file>","symbol":"<obsoleteSym>","delete":true}]'\``,
      taskText,
      `Once \`aice splice\` reports \`✔\` for all required edits, reply DONE immediately without redundant full-workspace re-reads.`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    boundaryRule,
    `Environment: AICE On-the-Fly WITH Cold-Start Project Idiom Discovery (\`--idioms\`).`,
    `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands. Do NOT use read_file, write_file, edit_file, view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, or --dry-run.`,
    `AICE 2-Pillar CLI Reference (\`--idioms\`):`,
    `1. Read & Mine Idioms (\`aice context\`):`,
    `   - \`aice context . -s "*" --idioms\`: Auto-discover & save repeating project idioms into \`aice.config.json\` AND extract \`// symbols:\` headers, \`$idiom(...)\`-collapsed symbol slices, and \`### Active Project Idioms\` templates in 1 command (for >8 files, pass 2 file-list subsets so 4KB tool output is never truncated).`,
    `2. Mutate & Refactor Idioms (\`aice splice\` / \`aice write\` — pre-validates AST & native syntax before writing; omit \`verifyDecoySentinel_*\` so it stays untouched):`,
    `   - Atomic JSON batch for symbol updates/insertions, deletions, AND workspace-wide \`$idiom\` template refactors in 1 call (write idiom \`"template"\` in the exact AICE DSL syntax shown under \`### Active Project Idioms\`, e.g. \`div(class: "...", ...)\` / \`fl-center\`, never raw \`<div ...>\` HTML/JSX; in JSON/YAML idioms preserve \`{ key: $0, ... }\`; pass via \`--batch '[...]'\`, \`--batch -\`, or \`--stdin << 'EOF'\`):`,
    `     \`aice splice --idioms --batch '[{"file":"<file>","symbol":"<sym>","code":"<AICE with $idiom>"},{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<AICE with $idiom>"},{"file":"<file>","symbol":"<obsoleteSym>","delete":true},{"name":"$<discovered_idiom>","template":"<updated AICE DSL template>"}]'\``,
    `   - Or zero-escaping heredoc stream for multi-file symbol updates/deletions/appends: \`aice splice --idioms --stdin << 'EOF'\` (\`=== <file>:<existingSymbol> ===\`, \`=== <file>:<Class.newMethod> ===\`, \`=== <file>:<obsoleteSymbol> --delete ===\`, \`=== <file>:eof ===\`).`,
    taskText,
    `Once \`aice splice\` reports \`✔\` for all required edits, reply DONE immediately without redundant full-workspace re-reads.`,
  ].join("\n\n");
}

export function buildLayerPrompt(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  dir: string,
  layerIndex: 2 | 3,
): string {
  const layerDefs = SCENARIO_LAYER_DEFINITIONS[spec.id];
  const layerDef = layerIndex === 2 ? layerDefs?.layer2 : layerDefs?.layer3;
  const title = layerDef?.title || `Layer ${layerIndex}`;
  const promptText = layerDef?.taskPrompt || `Implement Layer ${layerIndex} features`;
  const targetFilesHint =
    layerDef && layerDef.targetFiles.length > 0 ? layerDef.targetFiles.join(" ") : ".";
  const boundaryRule = `Workspace Boundary: Work strictly inside ${dir}. Never inspect, search, or access parent directories (..) or external repositories.`;

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      boundaryRule,
      `Task: ${title} (Progressive Layer ${layerIndex}/3).`,
      `Environment: WITHOUT AICE (Native File & Search Tools).`,
      `Allowed tools: Native file and search tools (read_file, edit_file, write_file, view_file, replace_file_content, multi_replace_file_content, grep_search, find_by_name, or ls/rg discovery via run_command). Do NOT run \`aice\` or write files via shell scripts/redirection.`,
      `Requirements:`,
      `1. ${promptText}`,
      `2. Non-Regression: Do NOT break or revert previous layer functionality or compiler checks.`,
      `3. Decoys: Do NOT modify or delete any verifyDecoySentinel_* function or DECOY_SENTINEL_* comment.`,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  if (mode === "aice_no_idioms") {
    return [
      `Workspace: ${dir}`,
      boundaryRule,
      `Task: ${title} (Progressive Layer ${layerIndex}/3).`,
      `Environment: AICE On-the-Fly WITHOUT Idioms (2-Pillar AICE CLI with \`--no-idioms\`).`,
      `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use read_file, write_file, edit_file, view_file, grep_search, replace_file_content, multi_replace_file_content, python/node/sed/awk/cat, --help, or $idiom macros.`,
      `AICE CLI Reference:`,
      `- Inspect only needed target files (skip if already known from previous layer): \`aice context ${targetFilesHint} -s "*" --no-idioms\`.`,
      `- Apply all new layer AST additions in 1 stream call via \`aice splice --no-idioms --stdin << 'EOF'\` (use \`=== <file>:eof ===\` to append new top-level functions/types/rules/keys, \`=== <file>:<Class.newMethod> ===\` to add class methods, or \`=== <file>:<existingSymbol> ===\` to replace existing symbols) or \`aice splice --no-idioms --batch '[...]'\`.`,
      `Requirements:`,
      `1. ${promptText}`,
      `2. Non-Regression: Preserve all existing layer features and compiler integrity.`,
      `3. Decoys: Omit verifyDecoySentinel_* and DECOY_SENTINEL_* so they remain untouched.`,
      `Once \`aice splice\` reports \`✔\`, reply DONE immediately.`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    boundaryRule,
    `Task: ${title} (Progressive Layer ${layerIndex}/3).`,
    `Environment: AICE On-the-Fly WITH Project Idioms (\`--idioms\`).`,
    `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands. Do NOT use read_file, write_file, edit_file, view_file, grep_search, replace_file_content, multi_replace_file_content, python/node/sed/awk/cat, or --help.`,
    `AICE CLI Reference:`,
    `- Inspect only needed target files (skip if already known from previous layer): \`aice context ${targetFilesHint} -s "*" --idioms\`.`,
    `- Apply all new layer AST additions in 1 stream call via \`aice splice --idioms --stdin << 'EOF'\` (use \`=== <file>:eof ===\` to append new top-level functions/types/rules/keys, \`=== <file>:<Class.newMethod> ===\` to add class methods, or \`=== <file>:<existingSymbol> ===\` to replace existing symbols) or \`aice splice --idioms --batch '[...]'\`.`,
    `Requirements:`,
    `1. ${promptText}`,
    `2. Non-Regression: Preserve all existing layer features and compiler integrity.`,
    `3. Decoys: Omit verifyDecoySentinel_* and DECOY_SENTINEL_* so they remain untouched.`,
    `Once \`aice splice\` reports \`✔\`, reply DONE immediately.`,
  ].join("\n\n");
}

function checkBalancedDelimiters(code: string): string | null {
  const stack: string[] = [];
  let inStr: string | null = null;
  let inLineComment = false;
  let inBlockComment = false;
  for (let i = 0; i < code.length; i++) {
    const ch = code[i];
    const next = code[i + 1];
    if (inLineComment) {
      if (ch === "\n") inLineComment = false;
      continue;
    }
    if (inBlockComment) {
      if (ch === "*" && next === "/") {
        inBlockComment = false;
        i++;
      }
      continue;
    }
    if (inStr) {
      if (ch === "\\" && inStr !== "`") {
        i++;
      } else if (ch === inStr) {
        inStr = null;
      }
      continue;
    }
    if (ch === "/" && next === "/") {
      inLineComment = true;
      i++;
      continue;
    }
    if (ch === "/" && next === "*") {
      inBlockComment = true;
      i++;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      inStr = ch;
      continue;
    }
    if (ch === "{" || ch === "(" || ch === "[") {
      stack.push(ch);
    } else if (ch === "}" || ch === ")" || ch === "]") {
      const open = stack.pop();
      const expected = ch === "}" ? "{" : ch === ")" ? "(" : "[";
      if (open !== expected) {
        return `Unbalanced delimiter '${ch}' at offset ${i}`;
      }
    }
  }
  if (inStr) return `Unclosed string literal (${inStr})`;
  if (inBlockComment) return "Unclosed block comment";
  if (stack.length > 0) return `Unclosed delimiter '${stack[stack.length - 1]}'`;
  return null;
}

function checkBalancedMarkupTags(content: string): string | null {
  const stack: string[] = [];
  const tagRegex = /<\/?([a-zA-Z][a-zA-Z0-9_-]*)\b[^>]*?(\/?)>/g;
  const voidTags = new Set(["br", "hr", "img", "input", "link", "meta"]);
  for (const m of content.matchAll(tagRegex)) {
    const full = m[0];
    const tag = m[1].toLowerCase();
    const selfClose = m[2] === "/";
    if (voidTags.has(tag) || selfClose) continue;
    if (full.startsWith("</")) {
      const top = stack.pop();
      if (top !== tag) {
        return `Mismatched closing tag </${tag}> (expected </${top ?? "none"}>)`;
      }
    } else {
      stack.push(tag);
    }
  }
  if (stack.length > 0) {
    return `Unclosed markup tag <${stack[stack.length - 1]}>`;
  }
  return null;
}

export function verifyCompilerAndSyntaxOnFile(
  filePath: string,
  languageId: BenchmarkLanguageId,
  dir: string,
): string | null {
  try {
    const langSpec = SUPPORTED_BENCHMARK_LANGUAGES.find((l) => l.id === languageId);
    const content = fs.readFileSync(filePath, "utf-8");
    if (langSpec) {
      const decomp = decompile(content, langSpec.target, { filePath });
      if (!decomp.ast.items || decomp.ast.items.length === 0) {
        return "Decompiled AST has 0 items";
      }
    }
    if (languageId === "ts" || languageId === "js" || languageId === "tsx") {
      const transpiled = ts.transpileModule(content, {
        fileName: filePath,
        reportDiagnostics: true,
        compilerOptions: {
          target: ts.ScriptTarget.ESNext,
          module: ts.ModuleKind.ESNext,
          ...(languageId === "tsx" ? { jsx: ts.JsxEmit.ReactJSX } : {}),
        },
      });
      if (transpiled.diagnostics && transpiled.diagnostics.length > 0) {
        const msg = ts.flattenDiagnosticMessageText(transpiled.diagnostics[0].messageText, "\n");
        return `TypeScript syntax diagnostic: ${msg}`;
      }
      if (languageId === "ts" || languageId === "js") {
        execFileSync("node", ["--check", filePath], { stdio: "pipe" });
      } else {
        const tagErr = checkBalancedMarkupTags(content);
        if (tagErr) return tagErr;
      }
    } else if (languageId === "py") {
      execFileSync("python3", ["-m", "py_compile", filePath], { stdio: "pipe" });
      const pycache = path.join(dir, "__pycache__");
      if (fs.existsSync(pycache)) {
        fs.rmSync(pycache, { recursive: true, force: true });
      }
    } else if (languageId === "php") {
      execFileSync("php", ["-l", filePath], { stdio: "pipe" });
    } else if (languageId === "cpp") {
      execFileSync(
        "g++",
        ["-std=c++20", "-fsyntax-only", "-Wno-pragma-once-outside-header", "-x", "c++", filePath],
        { stdio: "pipe" },
      );
    } else if (languageId === "rs") {
      const rmetaPath = path.join(dir, ".aice_check.rmeta");
      const tmpRsPath = path.join(dir, ".aice_check.rs");
      const rsClean = content
        .replace(/^\s*use\s+serde::[^\n]+;\n?/gm, "")
        .replace(/,\s*Serialize,\s*Deserialize/g, "");
      fs.writeFileSync(tmpRsPath, rsClean, "utf-8");
      try {
        execFileSync(
          "rustc",
          [
            "-A",
            "warnings",
            "--edition=2021",
            "--crate-name",
            "aice_check",
            "--crate-type=lib",
            "--emit=metadata",
            "-o",
            rmetaPath,
            tmpRsPath,
          ],
          { stdio: "pipe" },
        );
      } finally {
        if (fs.existsSync(rmetaPath)) fs.rmSync(rmetaPath, { force: true });
        if (fs.existsSync(tmpRsPath)) fs.rmSync(tmpRsPath, { force: true });
      }
    } else if (languageId === "cs" || languageId === "kt" || languageId === "go") {
      const delimErr = checkBalancedDelimiters(content);
      if (delimErr) return delimErr;
      if (
        /(?:^|[^+\-*/%&|^=<>!])[+\-*/%]\s*(?:;|\}|\r?\n)/m.test(content) ||
        /\breturn\s*(?:;|\}|\r?\n)/m.test(content)
      ) {
        return `Dangling operator or incomplete expression in ${languageId}`;
      }
    } else if (languageId === "html") {
      const tagErr = checkBalancedMarkupTags(content);
      if (tagErr) return tagErr;
    } else if (languageId === "twig") {
      const tagErr = checkBalancedMarkupTags(content);
      if (tagErr) return tagErr;
      const openBlocks = (content.match(/\{%\s*block\b/g) || []).length;
      const closeBlocks = (content.match(/\{%\s*endblock\b/g) || []).length;
      if (openBlocks === 0 || openBlocks !== closeBlocks) {
        return `Unbalanced Twig blocks: ${openBlocks} block vs ${closeBlocks} endblock`;
      }
    } else if (languageId === "css") {
      const delimErr = checkBalancedDelimiters(content);
      if (delimErr) return delimErr;
    } else if (languageId === "json") {
      JSON.parse(content);
    } else if (languageId === "yaml") {
      const parsedYaml = YAML.parse(content);
      if (!parsedYaml || typeof parsedYaml !== "object") {
        return "YAML did not parse to a valid object";
      }
    }
    return null;
  } catch (err) {
    return err instanceof Error ? err.message : String(err);
  }
}

export interface TranscriptComplianceAudit {
  compliant: boolean;
  violations: string[];
}

/**
 * Scans every tool call in transcript_full.jsonl / transcript.jsonl for:
 * - Sandbox escapes outside `workspaceDir` or benchmark harness inspection (across ALL modes)
 * - `aice` CLI usage or shell/Python file writers during `without_aice`
 * - Forbidden shell file writers (`cat >`, `echo >`, `tee`, `fs.writeFileSync`, Python `open(..., 'w')`),
 *   shell discovery bypasses (`grep -rn`, `cat <file>`, `sed -n`), and native file/search tools
 *   (`read_file`, `write_file`, `edit_file`, `view_file`, `replace_file_content`, `multi_replace_file_content`,
 *   `grep_search`, `find_by_name`) during AICE benchmark modes.
 */
export function auditTranscriptCompliance(
  transcriptPath?: string,
  mode: string = "aice_no_idioms",
  workspaceDir?: string,
): TranscriptComplianceAudit {
  if (!transcriptPath || !fs.existsSync(transcriptPath)) {
    return { compliant: true, violations: [] };
  }

  const violations: string[] = [];
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);
  const resolvedWorkspace = workspaceDir ? path.resolve(workspaceDir) : undefined;

  const FORBIDDEN_AICE_MODE_NATIVE_TOOLS = new Set([
    "write_file",
    "edit_file",
    "replace_file_content",
    "multi_replace_file_content",
    "read_file",
    "view_file",
    "grep_search",
    "find_by_name",
  ]);

  const BENCHMARK_HARNESS_ESCAPE_RE =
    /(?:benchmarks\/(?:run-real-agents|offline-suite|real-agent-suite|real-agent-results)|computeSeededFileMutation|computeFileDecoySpec|verifyWorkspaceOnDisk|SCENARIO_LAYER_DEFINITIONS|HOSTILE_LONE_NEEDLE_SPEC|\/dev\/aice\b|antigravity-cli\/worktrees\b)/;

  const SHELL_FILE_WRITER_RE =
    /\bcat\s+<<[\s\S]*?>|\bcat\s+[^>|\n]*?>|\becho\b[^|\n]*?>|(?:^|[|;&]\s*)\btee\b|\bfs\.writeFileSync\b|\bpython3?\b[\s\S]*?\b(?:open\s*\([^)]*['"][wa]['"]|write_text\s*\()/;

  for (const line of lines) {
    let entry: Record<string, unknown>;
    try {
      entry = JSON.parse(line) as Record<string, unknown>;
    } catch {
      continue;
    }

    const toolCalls = Array.isArray(entry.tool_calls)
      ? (entry.tool_calls as Array<Record<string, unknown>>)
      : [];

    for (const tc of toolCalls) {
      const toolName = String(tc.name ?? tc.tool ?? "");
      const args = (tc.args ?? tc.arguments ?? tc.input ?? {}) as Record<string, unknown>;
      const serializedArgs = JSON.stringify(args);

      if (BENCHMARK_HARNESS_ESCAPE_RE.test(serializedArgs)) {
        violations.push(
          `Forbidden benchmark harness or external repo escape in '${toolName}': ${serializedArgs.slice(0, 120)}`,
        );
      }

      if (resolvedWorkspace) {
        for (const key of [
          "Path",
          "TargetFile",
          "DirectoryPath",
          "SearchPath",
          "file_path",
          "path",
        ]) {
          const rawTarget = args[key];
          if (
            typeof rawTarget === "string" &&
            rawTarget.trim().length > 0 &&
            rawTarget !== "/dev/null"
          ) {
            const resolvedTarget = path.resolve(resolvedWorkspace, rawTarget);
            if (
              resolvedTarget !== resolvedWorkspace &&
              !resolvedTarget.startsWith(`${resolvedWorkspace}${path.sep}`)
            ) {
              violations.push(
                `Sandbox boundary escape via '${toolName}' outside workspace: ${rawTarget.slice(0, 120)}`,
              );
            }
          }
        }
      }

      if (mode !== "without_aice" && FORBIDDEN_AICE_MODE_NATIVE_TOOLS.has(toolName)) {
        violations.push(`Forbidden native tool '${toolName}' used in ${mode}`);
        continue;
      }

      const cmd = String(args.CommandLine ?? args.command ?? args.cmd ?? "");
      if (!cmd) continue;

      if (mode === "without_aice") {
        if (/\baice\s+(?:context|outline|splice|write|create|new|idioms|compile)\b/.test(cmd)) {
          violations.push(`Forbidden aice CLI usage in without_aice mode: ${cmd.slice(0, 120)}`);
        }
        if (SHELL_FILE_WRITER_RE.test(cmd)) {
          violations.push(
            `Forbidden shell file writer detected in without_aice mode: ${cmd.slice(0, 120)}`,
          );
        }
        if (
          resolvedWorkspace &&
          /(?:^|[\s;&|])(?:cd|ls|rg|grep|find)\s+\.\.(?:\/|\s|$)|(?:\s|^)\.\.\//.test(cmd)
        ) {
          violations.push(`Sandbox parent-directory escape detected: ${cmd.slice(0, 120)}`);
        }
        continue;
      }

      // Strip safe `aice (splice|write|create|new) ... << 'EOF' ... EOF` heredoc bodies before checking shell commands
      const strippedCmd = cmd.replace(
        /\baice\s+(?:splice|write|create|new)\b[\s\S]*?<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g,
        "aice_heredoc",
      );

      if (mode === "aice_no_idioms" && /(?:^|\s)--idioms(?:\s|$)/.test(strippedCmd)) {
        violations.push(`Forbidden --idioms flag used in aice_no_idioms mode: ${cmd.slice(0, 120)}`);
      }

      if (
        resolvedWorkspace &&
        /(?:^|[\s;&|])(?:cd|ls|rg|grep|find|aice\s+\w+)\s+\.\.(?:\/|\s|$)|(?:\s|^)\.\.\//.test(
          strippedCmd,
        )
      ) {
        violations.push(`Sandbox parent-directory escape detected: ${cmd.slice(0, 120)}`);
      }

      // 1. Forbidden shell file writers: cat >, cat << ... >, echo >, tee, fs.writeFileSync, python open(...,'w')
      if (SHELL_FILE_WRITER_RE.test(strippedCmd)) {
        violations.push(`Forbidden shell file writer detected: ${cmd.slice(0, 120)}`);
      }

      // 2. Forbidden discovery bypasses: grep -rn, cat <file>, sed -n
      if (
        /\bgrep\s+-[a-zA-Z]*r[a-zA-Z]*n\b|\bgrep\s+-[a-zA-Z]*n[a-zA-Z]*r\b/.test(strippedCmd) ||
        /(?:^|[;&|]\s*)cat\s+(?!<<)[^\s>|]+/.test(strippedCmd) ||
        /\bsed\s+-n\b/.test(strippedCmd)
      ) {
        violations.push(`Forbidden shell discovery bypass detected: ${cmd.slice(0, 120)}`);
      }
    }
  }

  return {
    compliant: violations.length === 0,
    violations,
  };
}

export function verifyWorkspaceOnDisk(
  spec: RealWorldBenchmarkSpec,
  dir: string,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
  layerIndex: 1 | 2 | 3 = 1,
  transcriptPath?: string,
  mode: string = "aice_no_idioms",
): {
  verified: boolean;
  zeroAice: boolean;
  decoysInjected: number;
  decoysIntact: boolean;
  compilerVerified: boolean;
  details: string[];
} {
  const details: string[] = [];
  let decoysInjected = 0;
  let decoysIntact = true;
  let compilerVerified = true;
  const isNewFeature = spec.scenario === "new_feature";

  for (const f of spec.files) {
    const filePath = path.join(dir, f.fileName);
    if (!fs.existsSync(filePath)) {
      details.push(`${f.fileName}: missing file on disk`);
      continue;
    }
    const content = fs.readFileSync(filePath, "utf-8");
    const seededMut = computeSeededFileMutation(seed, spec.id, f, isNewFeature);
    const targetSym = seededMut.targetSymbol;

    const compileErr = verifyCompilerAndSyntaxOnFile(filePath, f.languageId, dir);
    if (compileErr) {
      compilerVerified = false;
      details.push(`${f.fileName}: compiler/syntax check failed: ${compileErr}`);
    }

    if (f.obsoleteSymbol) {
      const cleanObs = f.obsoleteSymbol.replace(/^config\./, "").replace(/^[.#]/, "");
      const snakeObs = cleanObs.replace(/([a-z0-9])([A-Z])/g, "$1_$2").toLowerCase();
      if (
        content.includes(cleanObs) ||
        content.includes(cleanObs.replace(/_/g, "-")) ||
        content.includes(snakeObs)
      ) {
        details.push(`${f.fileName}: obsoleteSymbol ${f.obsoleteSymbol} still present`);
      }
    }
    if (content.includes("namespace ::") || /public\s+static\s+\w+\s+public\s+/.test(content)) {
      details.push(`${f.fileName}: contains corrupted splice header/namespace`);
    }

    for (const tok of seededMut.expectedTokens) {
      if (!content.includes(tok)) {
        details.push(
          `${f.fileName}: target symbol ${targetSym} missing seeded update token '${tok}'`,
        );
      }
    }

    const minSymCount = f.refactorSymbols.length;
    if (CODE_LANGS.has(f.languageId)) {
      decoysInjected++;
      const decoy = computeFileDecoySpec(seed, spec.id, f.fileName);
      const hasDecoyFn = new RegExp(`verify_?decoy_?sentinel_?${decoy.hexSeed}`, "i").test(
        content,
      );
      const hasIntactDecoyExpr = new RegExp(
        `(?:^|[^A-Za-z0-9_])\\$?probe\\s*\\+\\s*\\(?${decoy.decoyStep}\\)?\\b(?!\\s*\\+\\s*1\\b)`,
      ).test(content);
      const hasCorruptedDecoyExpr =
        new RegExp(
          `(?:^|[^A-Za-z0-9_])\\$?probe\\s*\\+\\s*\\(?${decoy.decoyStep}\\)?\\s*\\+\\s*1\\b`,
        ).test(content) ||
        new RegExp(
          `(?:^|[^A-Za-z0-9_])\\$?probe\\s*\\+\\s*\\(?${decoy.decoyStep + 1}\\)?\\b`,
        ).test(content);
      const hasIntactCommentTag = content.includes(decoy.commentTag);
      if (!hasDecoyFn || !hasIntactDecoyExpr || hasCorruptedDecoyExpr || !hasIntactCommentTag) {
        decoysIntact = false;
        details.push(`${f.fileName}: decoy sentinel ${decoy.fnName} was deleted or corrupted`);
      }

      const hasExtendedFn =
        content.includes(`${targetSym}Extended`) ||
        new RegExp(`${targetSym.replace(/_/g, "_?")}_?extended`, "i").test(content);
      if (isNewFeature && !hasExtendedFn) {
        details.push(`${f.fileName}: missing new feature function ${targetSym}Extended`);
      }

      if (spec.id !== "RW-11") {
        const explicitPlusOnes = (content.match(/\+\s*\d+\)?\s*\+\s*1\b/g) || []).length;
        const rawSteps = [
          ...[...f.aiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g)].map((m) =>
            Number(m[1]),
          ),
          ...[
            ...f.updatedTargetSymbolAiceWithIdioms.matchAll(/\(\w+,\s*\d+,\s*\d+,\s*(\d+)\)/g),
          ].map((m) => Number(m[1])),
          ...(seededMut.seededSteps || []),
        ];
        const foldedSet = new Set(rawSteps.map((s) => s + 1));
        const foldedMatches = [...content.matchAll(/\+\s*(\d+)\b(?!\s*\+\s*1\b)/g)].filter((m) =>
          foldedSet.has(Number(m[1])),
        ).length;
        const totalRefactored = explicitPlusOnes + foldedMatches;
        if (totalRefactored < minSymCount * 3) {
          details.push(
            `${f.fileName}: expected >= ${minSymCount * 3} refactored band steps, got ${totalRefactored}`,
          );
        }
      }
    } else if (f.languageId === "tsx") {
      if (isNewFeature && !content.includes(`${targetSym}Sparkline`)) {
        details.push(`${f.fileName}: missing new component ${targetSym}Sparkline`);
      }
      const c = (content.match(/kpi-tile-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing kpi-tile-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "css") {
      if (isNewFeature && !content.includes(`${targetSym}-active`)) {
        details.push(`${f.fileName}: missing new CSS rule ${targetSym}-active`);
      }
      const c = (content.match(/12px/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing 12px border-radius (${c}/${minSymCount})`);
    } else if (f.languageId === "html") {
      const cleanSec = targetSym.replace(/^[.#]/, "");
      if (
        isNewFeature &&
        !content.includes(`id="${cleanSec}_extra"`) &&
        !content.includes(`id="${targetSym}_extra"`)
      ) {
        details.push(`${f.fileName}: missing new section ${cleanSec}_extra`);
      }
      const c = (content.match(/metric-row-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing metric-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "twig") {
      const hasTwigSummaryBlock =
        new RegExp(`\\{%\\s*block\\s+${targetSym}_summary\\b`).test(content) ||
        content.includes(`block(name="${targetSym}_summary")`);
      if (isNewFeature && !hasTwigSummaryBlock) {
        details.push(`${f.fileName}: missing new block ${targetSym}_summary`);
      }
      const c = (content.match(/summary-row-v2/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing summary-row-v2 (${c}/${minSymCount})`);
    } else if (f.languageId === "json") {
      const cleanKey = targetSym.replace(/^config\./, "");
      if (
        isNewFeature &&
        !content.includes(`"${cleanKey}_extra"`) &&
        !content.includes(`"${cleanKey}_realtime"`)
      ) {
        details.push(`${f.fileName}: missing new JSON key ${cleanKey}_realtime`);
      }
      const c = (content.match(/retries":\s*5/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing retries: 5 (${c}/${minSymCount})`);
    } else if (f.languageId === "yaml") {
      const cleanKey = targetSym.replace(/^config\./, "");
      if (
        isNewFeature &&
        !content.includes(`${cleanKey}_realtime`) &&
        !content.includes(`${cleanKey}_extra`)
      ) {
        details.push(`${f.fileName}: missing new YAML key ${cleanKey}_realtime`);
      }
      const c = (content.match(/replicas:\s*4/g) || []).length;
      if (c < minSymCount) details.push(`${f.fileName}: missing replicas: 4 (${c}/${minSymCount})`);
    }
  }

  if (layerIndex >= 2) {
    const l2Def = SCENARIO_LAYER_DEFINITIONS[spec.id]?.layer2;
    if (l2Def) {
      const allFiles = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      for (const kw of l2Def.expectedKeywords) {
        let found = false;
        const kwParts = kw.split("|");
        const targets = Array.from(new Set([...l2Def.targetFiles, ...allFiles]));
        for (const tf of targets) {
          const p = path.join(dir, tf);
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            const content = fs.readFileSync(p, "utf-8");
            if (kwParts.some((part) => new RegExp(part.trim(), "i").test(content))) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          details.push(
            `Layer 2: expected feature keyword '${kw}' not found in workspace files (${l2Def.targetFiles.join(", ")})`,
          );
        }
      }
    }
  }

  if (layerIndex >= 3) {
    const l3Def = SCENARIO_LAYER_DEFINITIONS[spec.id]?.layer3;
    if (l3Def) {
      const allFiles = fs.existsSync(dir) ? fs.readdirSync(dir) : [];
      for (const kw of l3Def.expectedKeywords) {
        let found = false;
        const kwParts = kw.split("|");
        const targets = Array.from(new Set([...l3Def.targetFiles, ...allFiles]));
        for (const tf of targets) {
          const p = path.join(dir, tf);
          if (fs.existsSync(p) && fs.statSync(p).isFile()) {
            const content = fs.readFileSync(p, "utf-8");
            if (kwParts.some((part) => new RegExp(part.trim(), "i").test(content))) {
              found = true;
              break;
            }
          }
        }
        if (!found) {
          details.push(
            `Layer 3: expected feature keyword '${kw}' not found in workspace files (${l3Def.targetFiles.join(", ")})`,
          );
        }
      }
    }
  }

  const aiceFiles = fs.readdirSync(dir).filter((f) => f.endsWith(".aice"));
  const zeroAice = aiceFiles.length === 0;
  if (!zeroAice) details.push(`Found .aice files: ${aiceFiles.join(",")}`);

  const candidateTranscript =
    transcriptPath ??
    (fs.existsSync(path.join(dir, "transcript_full.jsonl"))
      ? path.join(dir, "transcript_full.jsonl")
      : fs.existsSync(path.join(dir, "transcript.jsonl"))
        ? path.join(dir, "transcript.jsonl")
        : fs.existsSync(path.join(dir, ".system_generated/logs/transcript_full.jsonl"))
          ? path.join(dir, ".system_generated/logs/transcript_full.jsonl")
          : fs.existsSync(path.join(dir, ".system_generated/logs/transcript.jsonl"))
            ? path.join(dir, ".system_generated/logs/transcript.jsonl")
            : undefined);
  const compliance = auditTranscriptCompliance(candidateTranscript, mode, dir);
  if (!compliance.compliant) {
    details.push(`DISQUALIFIED: Forbidden workaround detected (${compliance.violations.join("; ")})`);
  }

  return {
    verified:
      details.length === 0 &&
      zeroAice &&
      decoysIntact &&
      compilerVerified &&
      compliance.compliant,
    zeroAice,
    decoysInjected,
    decoysIntact,
    compilerVerified,
    details,
  };
}
export interface RunAgentBenchmarkOptions {
  seed?: number;
  dashboard?: BenchmarkDashboard;
  targetLayer?: 1 | 2 | 3;
  existingConvId?: string;
  existingDir?: string;
  keepWorkspace?: boolean;
}

export async function runAgentBenchmarkMode(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  seedOrOpts: number | RunAgentBenchmarkOptions = DEFAULT_ADVERSARIAL_SEED,
  dashboardArg?: BenchmarkDashboard,
): Promise<RealAgentRunMetrics> {
  const opts: RunAgentBenchmarkOptions =
    typeof seedOrOpts === "object"
      ? seedOrOpts
      : { seed: seedOrOpts, dashboard: dashboardArg };
  const seed = opts.seed ?? DEFAULT_ADVERSARIAL_SEED;
  const dashboard = opts.dashboard ?? dashboardArg;
  const targetLayer = opts.targetLayer;
  const dir = opts.existingDir || setupWorkspace(spec, mode, seed);
  const coldStartRepo =
    !fs.existsSync(path.join(dir, "aice.config.json")) &&
    !fs.existsSync(path.join(dir, ".aice-idioms.json"));
  const taskSpecText = buildTaskSpecText(spec, seed);
  const blindPrompt = spec.files.every((f) => {
    const seededTarget = computeSeededFileMutation(
      seed,
      spec.id,
      f,
      spec.scenario === "new_feature",
    ).targetSymbol;
    return (
      !taskSpecText.includes(seededTarget) &&
      !taskSpecText.includes(f.targetSymbol) &&
      (!f.obsoleteSymbol || !taskSpecText.includes(f.obsoleteSymbol))
    );
  });

  const workerKey = `${spec.id}:${mode}`;
  const layerDefs = SCENARIO_LAYER_DEFINITIONS[spec.id];
  const layerTitles = [
    "Layer 1: Baseline",
    layerDefs?.layer2?.title || "Layer 2: Feature #1",
    layerDefs?.layer3?.title || "Layer 3: Feature #2",
  ];

  dashboard?.registerWorker(workerKey, {
    id: spec.id,
    mode,
    title: spec.title,
    layer: 1,
    layerTitle: layerTitles[0],
    status: "RUNNING",
  });

  const layerMetrics: BenchmarkLayerMetrics[] = [];
  let convId: string = opts.existingConvId || "";
  let totalLlmTurns = 0;
  let totalToolCalls = 0;
  let totalWorkingTokens = 0;
  let totalToolCallTokens = 0;
  let totalToolResultTokens = 0;
  let totalOutputTokens = 0;
  let totalInputTokens = 0;
  let totalCacheReadTokens = 0;
  let totalDurationSeconds = 0;
  let lastCheck = {
    verified: false,
    zeroAice: true,
    decoysInjected: 0,
    decoysIntact: true,
    compilerVerified: true,
    details: [] as string[],
  };

  const resolveLiveTranscriptPath = (cid: string): string | undefined => {
    if (!cid) return undefined;
    const logsDir = path.join(
      os.homedir(),
      ".gemini/antigravity-cli/brain",
      cid,
      ".system_generated/logs",
    );
    const fullPath = path.join(logsDir, "transcript_full.jsonl");
    if (fs.existsSync(fullPath)) return fullPath;
    const compactPath = path.join(logsDir, "transcript.jsonl");
    if (fs.existsSync(compactPath)) return compactPath;
    return undefined;
  };

  const readTranscriptCounters = (tPath?: string) => {
    let turns = 0;
    let toolCalls = 0;
    let inputTokens = 0;
    let outputTokens = 0;
    let cacheReadTokens = 0;
    let toolCallTokens = 0;
    let toolResultTokens = 0;
    if (tPath && fs.existsSync(tPath)) {
      const lines = fs
        .readFileSync(tPath, "utf-8")
        .trim()
        .split("\n")
        .map((l) => {
          try {
            return JSON.parse(l);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      for (const entry of lines) {
        if (entry.type === "PLANNER_RESPONSE") {
          turns++;
          inputTokens += entry.input_tokens || 0;
          outputTokens += entry.output_tokens || 0;
          cacheReadTokens += entry.cache_read_tokens || 0;
          if (Array.isArray(entry.tool_calls)) {
            toolCalls += entry.tool_calls.length;
            for (const tc of entry.tool_calls) {
              toolCallTokens += estimateTokens(JSON.stringify(tc.args || {}));
            }
          }
        } else if (entry.type === "GENERIC" && typeof entry.content === "string") {
          toolResultTokens += estimateTokens(entry.content);
        }
      }
    }
    return {
      turns,
      toolCalls,
      inputTokens,
      outputTokens,
      cacheReadTokens,
      toolCallTokens,
      toolResultTokens,
    };
  };

  const startLayer = targetLayer ?? 1;
  const endLayer = targetLayer ?? 3;
  for (let lIdx = startLayer; lIdx <= endLayer; lIdx++) {
    if (lIdx > 1) {
      // Pacing cooldown delay (1500ms) between scenario layers to prevent bursting the keyring and Google APIs
      await new Promise((resolve) => setTimeout(resolve, 1500));
    }
    const currentLayer = lIdx as 1 | 2 | 3;
    dashboard?.updateWorker(workerKey, {
      layer: currentLayer,
      layerTitle: layerTitles[lIdx - 1],
      status: "RUNNING",
    });

    const prevCounters = readTranscriptCounters(resolveLiveTranscriptPath(convId));

    const prompt =
      currentLayer === 1
        ? buildPrompt(spec, mode, dir, seed)
        : buildLayerPrompt(spec, mode, dir, currentLayer);

    const t0 = Date.now();
    const baseAgyArgs = [
      "-p",
      prompt,
      "--add-dir",
      dir,
      "--model",
      "gemini-3.8-flash-low",
      "--print-timeout",
      "600s",
      "--dangerously-skip-permissions",
      "--output-format",
      "json",
    ];
    const agyArgs = convId ? ["--conversation", convId, ...baseAgyArgs] : baseAgyArgs;

    let stdout = "";
    try {
      const res = await execAgyWithRetry(agyArgs, 3, dir);
      stdout = res.stdout;
    } catch (e: any) {
      if (e?.stderr) {
        console.error(`[agy final failure stderr]:\n${e.stderr}`);
      }
      stdout = e.stdout || "{}";
    }

    const durationSeconds = Number(((Date.now() - t0) / 1000).toFixed(2));
    totalDurationSeconds += durationSeconds;

    let parsed: any = {};
    try {
      parsed = JSON.parse(stdout);
    } catch {}
    if (parsed.conversation_id) {
      convId = parsed.conversation_id;
    }
    console.log(
      `[RUNNER_STARTED] conversation_id=${convId} workspace=${dir} scenario=${spec.id} mode=${mode}`,
    );

    const liveTranscriptPath = resolveLiveTranscriptPath(convId);
    const postCounters = readTranscriptCounters(liveTranscriptPath);

    const layerTurnDelta = Math.max(1, postCounters.turns - prevCounters.turns);
    const layerToolDelta = Math.max(0, postCounters.toolCalls - prevCounters.toolCalls);
    const layerInputDelta = Math.max(0, postCounters.inputTokens - prevCounters.inputTokens);
    const layerOutputDelta = Math.max(0, postCounters.outputTokens - prevCounters.outputTokens);
    const layerCacheDelta = Math.max(
      0,
      postCounters.cacheReadTokens - prevCounters.cacheReadTokens,
    );
    const layerCallTokDelta = Math.max(
      0,
      postCounters.toolCallTokens - prevCounters.toolCallTokens,
    );
    const layerResTokDelta = Math.max(
      0,
      postCounters.toolResultTokens - prevCounters.toolResultTokens,
    );
    const layerWorkingDelta = layerCallTokDelta + layerResTokDelta + layerOutputDelta;

    totalLlmTurns += layerTurnDelta;
    totalToolCalls += layerToolDelta;
    totalInputTokens += layerInputDelta;
    totalOutputTokens += layerOutputDelta;
    totalCacheReadTokens += layerCacheDelta;
    totalToolCallTokens += layerCallTokDelta;
    totalToolResultTokens += layerResTokDelta;
    totalWorkingTokens = totalToolCallTokens + totalToolResultTokens + totalOutputTokens;

    dashboard?.updateWorker(workerKey, {
      status: "VERIFYING",
      turns: totalLlmTurns,
      toolCalls: totalToolCalls,
    });

    lastCheck = verifyWorkspaceOnDisk(
      spec,
      dir,
      seed,
      currentLayer,
      liveTranscriptPath,
      mode,
    );
    if (
      mode === "aice_with_idioms" &&
      spec.id !== "RW-11" &&
      !fs.existsSync(path.join(dir, "aice.config.json"))
    ) {
      lastCheck.verified = false;
      lastCheck.details.push("aice_with_idioms did not discover/save aice.config.json during live run");
    }

    layerMetrics.push({
      layerIndex: currentLayer,
      layerTitle: layerTitles[lIdx - 1],
      turns: layerTurnDelta,
      toolCalls: layerToolDelta,
      workingTokens: layerWorkingDelta,
      outputTokens: layerOutputDelta,
      inputTokens: layerInputDelta,
      cacheReadTokens: layerCacheDelta,
      billableTokens: layerInputDelta + layerOutputDelta,
      apiTotalTokens: layerInputDelta + layerCacheDelta + layerOutputDelta,
      apiCostUsd: computeRealApiCostUsd(layerInputDelta, layerCacheDelta, layerOutputDelta),
      durationSeconds,
      verified: lastCheck.verified,
    });

    console.log(
      `[RUNNER_MILESTONE] conversation_id=${convId} workspace=${dir} scenario=${spec.id} mode=${mode} layer=${currentLayer} turns=${layerTurnDelta} inTok=${layerInputDelta} outTok=${layerOutputDelta} workTok=${layerWorkingDelta} verified=${lastCheck.verified}`,
    );

    if (!lastCheck.verified) {
      dashboard?.updateWorker(workerKey, {
        status: "FAILED",
        error: lastCheck.details.join("; "),
      });
      break;
    } else {
      dashboard?.stepCompleted();
    }
  }

  dashboard?.updateWorker(workerKey, {
    status: lastCheck.verified ? "DONE" : "FAILED",
    turns: totalLlmTurns,
    toolCalls: totalToolCalls,
  });

  if (!opts.keepWorkspace && !opts.existingDir && !targetLayer) {
    fs.rmSync(dir, { recursive: true, force: true });
  }
  return {
    benchmarkId: spec.id,
    mode,
    conversationId: convId,
    workspaceDir: dir,
    llmTurns: totalLlmTurns,
    toolCalls: totalToolCalls,
    workingTokens: totalWorkingTokens,
    toolCallTokens: totalToolCallTokens,
    toolResultTokens: totalToolResultTokens,
    outputTokens: totalOutputTokens,
    inputTokens: totalInputTokens,
    cacheReadTokens: totalCacheReadTokens,
    billableTokens: totalInputTokens + totalOutputTokens,
    apiTotalTokens: totalInputTokens + totalCacheReadTokens + totalOutputTokens,
    apiCostUsd: computeRealApiCostUsd(totalInputTokens, totalCacheReadTokens, totalOutputTokens),
    durationSeconds: totalDurationSeconds,
    verifiedOnDisk: lastCheck.verified,
    zeroAiceFilesLeftOnDisk: lastCheck.zeroAice,
    seed,
    coldStartRepo,
    blindPrompt,
    decoysInjected: lastCheck.decoysInjected,
    decoysIntact: lastCheck.decoysIntact,
    layers: layerMetrics,
    regressionFree: lastCheck.verified,
  };
}

async function runWithConcurrencyPool<T, R>(
  items: T[],
  concurrency: number,
  workerFn: (item: T) => Promise<R>,
): Promise<R[]> {
  const results: R[] = [];
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (index < items.length) {
      const currentIdx = index++;
      results[currentIdx] = await workerFn(items[currentIdx]);
    }
  });
  await Promise.all(workers);
  return results;
}

export function syncBenchmarkDocsMarkdown(
  existing: Record<string, Record<RealAgentMode, RealAgentRunMetrics>>,
): void {
  try {
    const docsPath = path.resolve(process.cwd(), "docs/BENCHMARKS.md");
    const hasAllBaselineScenarios = OFFLINE_BENCHMARKS.every(
      (spec) =>
        existing[spec.id]?.without_aice &&
        existing[spec.id]?.aice_no_idioms &&
        existing[spec.id]?.aice_with_idioms,
    );
    if (hasAllBaselineScenarios) {
      const report = buildRealAgentBenchmarkSuiteReport(existing);
      const markdown = formatRealAgentBenchmarkMarkdown(report);
      fs.mkdirSync(path.dirname(docsPath), { recursive: true });
      fs.writeFileSync(docsPath, markdown, "utf-8");
      return;
    }

    const lines: string[] = [];

    lines.push("# AICE 2.0 — Real AI Agent Benchmark Suite Report (3-Layer Progressive Lifecycle)");
    lines.push("");
    lines.push(
      "> **Ground-Truth Adversarial Real AI Agent Proof**: Every metric in this report comes from **real autonomous AI agent (`agy -p`) executions** running against **cold-start, procedurally seeded, decoy-minefielded workspaces** on disk under **blind issue prompts** across **3 sequential progressive layers** (Layer 1 Baseline, Layer 2 Feature Addition, Layer 3 Cross-Cutting Persistence/Telemetry) and measured directly from each agent's ground-truth `.system_generated/logs/transcript.jsonl` telemetry log.",
    );
    lines.push("");
    lines.push("> For the deterministic offline benchmark suite, see [`BENCHMARKS_OFFLINE.md`](BENCHMARKS_OFFLINE.md).");
    lines.push("");
    lines.push("## 1. 3-Layer Progressive Lifecycle Breakdown (Live Telemetry)");
    lines.push("");
    lines.push(
      "| Scenario | Mode | L1 Baseline | L2 Feature Add | L3 Cross-Cutting | Total Turns | Working Tokens | LLM Output Tokens | Real Cost (USD) | Status |",
    );
    lines.push(
      "| :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    );

    const scenarioIds = Object.keys(existing);
    for (const id of scenarioIds) {
      const modes = existing[id];
      for (const mode of ["without_aice", "aice_no_idioms", "aice_with_idioms"] as RealAgentMode[]) {
        const run = modes?.[mode];
        if (!run) continue;
        const l1 = run.layers?.find((l) => l.layerIndex === 1);
        const l2 = run.layers?.find((l) => l.layerIndex === 2);
        const l3 = run.layers?.find((l) => l.layerIndex === 3);

        const fmtL = (l?: BenchmarkLayerMetrics) =>
          l ? `${l.turns}t / $${l.apiCostUsd.toFixed(4)} / ${l.verified ? "✅" : "❌"}` : "—";

        const modeBadge =
          mode === "without_aice"
            ? "`without_aice`"
            : mode === "aice_no_idioms"
              ? "**`aice_no_idioms`**"
              : "**`aice_with_idioms`**";

        const statusBadge =
          run.verifiedOnDisk && run.regressionFree
            ? "✅ 100%"
            : run.verifiedOnDisk
              ? "✅ Verified"
              : "⚠️ Partial";

        lines.push(
          `| **${id}** | ${modeBadge} | ${fmtL(l1)} | ${fmtL(l2)} | ${fmtL(l3)} | **${run.llmTurns}** | **${run.workingTokens.toLocaleString("en-US")}** | **${run.outputTokens.toLocaleString("en-US")}** | **$${run.apiCostUsd.toFixed(4)}** | ${statusBadge} |`,
        );
      }
    }

    lines.push("");
    lines.push("## 2. Overall Aggregate Comparison Across Completed Scenarios");
    lines.push("");
    lines.push(
      "| Mode | Scenarios Tracked | Total Turns | Total Working Tokens | Total Output Tokens | Total Real API Cost | Compiler & Decoys Verified |",
    );
    lines.push("| :--- | :---: | :---: | :---: | :---: | :---: | :---: |");

    for (const mode of ["without_aice", "aice_no_idioms", "aice_with_idioms"] as RealAgentMode[]) {
      let count = 0;
      let turns = 0;
      let workTok = 0;
      let outTok = 0;
      let cost = 0;
      let ok = 0;

      for (const id of scenarioIds) {
        const run = existing[id]?.[mode];
        if (run) {
          count++;
          turns += run.llmTurns;
          workTok += run.workingTokens;
          outTok += run.outputTokens;
          cost += run.apiCostUsd;
          if (run.verifiedOnDisk) ok++;
        }
      }

      const label =
        mode === "without_aice"
          ? "Without AICE (Native Tools)"
          : mode === "aice_no_idioms"
            ? "AICE Without Idioms (Pure AICE)"
            : "AICE With Idioms (Dynamic Mining)";

      lines.push(
        `| **${label}** | ${count} | ${turns.toLocaleString("en-US")} | ${workTok.toLocaleString("en-US")} | ${outTok.toLocaleString("en-US")} | $${cost.toFixed(4)} | ${ok}/${count} |`,
      );
    }

    lines.push("");
    lines.push("## 3. Ground-Truth Conversation ID Audit Trail (Real Agent Sessions)");
    lines.push("");
    lines.push(
      "| Scenario | Mode | Conversation ID (`brain/<id>`) | Seed | Turns | Working Tokens | Output Tokens | API Cost (USD) | Duration | Status |",
    );
    lines.push(
      "| :--- | :--- | :--- | :---: | :---: | :---: | :---: | :---: | :---: | :---: |",
    );
    for (const id of scenarioIds) {
      for (const mode of ["without_aice", "aice_no_idioms", "aice_with_idioms"] as RealAgentMode[]) {
        const run = existing[id]?.[mode];
        if (!run) continue;
        lines.push(
          `| **${id}** | \`${mode}\` | \`${run.conversationId}\` | \`${run.seed ?? 20261108}\` | ${run.llmTurns} | ${run.workingTokens.toLocaleString("en-US")} | ${run.outputTokens.toLocaleString("en-US")} | $${run.apiCostUsd.toFixed(4)} | ${run.durationSeconds.toFixed(1)}s | ${run.verifiedOnDisk ? "✅" : "❌"} |`,
        );
      }
    }
    lines.push("");

    fs.mkdirSync(path.dirname(docsPath), { recursive: true });
    fs.writeFileSync(docsPath, lines.join("\n"), "utf-8");
  } catch (err) {
    console.error("Failed to sync benchmark docs markdown:", err);
  }
}

async function main() {
  const rawArgs = process.argv.slice(2);
  let seed = process.env.AICE_BENCH_SEED
    ? Number(process.env.AICE_BENCH_SEED)
    : generateFreshBenchmarkSeed();
  let noSave = false;
  let concurrency = 1;
  let targetLayer: (1 | 2 | 3) | undefined;
  let cliDir: string | undefined;
  let cliConvId: string | undefined;
  let keepDir = false;

  if (process.env.AICE_BENCH_CONCURRENCY) {
    concurrency = Math.max(1, Number(process.env.AICE_BENCH_CONCURRENCY));
  }
  const targetIds: string[] = [];
  for (let i = 0; i < rawArgs.length; i++) {
    if (rawArgs[i] === "--seed" && rawArgs[i + 1]) {
      seed = Number(rawArgs[++i]);
    } else if (rawArgs[i].startsWith("--seed=")) {
      seed = Number(rawArgs[i].slice("--seed=".length));
    } else if (rawArgs[i] === "--concurrency" && rawArgs[i + 1]) {
      concurrency = Math.max(1, Number(rawArgs[++i]));
    } else if (rawArgs[i].startsWith("--concurrency=")) {
      concurrency = Math.max(1, Number(rawArgs[i].slice("--concurrency=".length)));
    } else if (rawArgs[i] === "--only" && rawArgs[i + 1]) {
      targetIds.push(rawArgs[++i]);
    } else if (rawArgs[i].startsWith("--only=")) {
      targetIds.push(rawArgs[i].slice("--only=".length));
    } else if (rawArgs[i] === "--layer" && rawArgs[i + 1]) {
      targetLayer = Number(rawArgs[++i]) as 1 | 2 | 3;
    } else if (rawArgs[i].startsWith("--layer=")) {
      targetLayer = Number(rawArgs[i].slice("--layer=".length)) as 1 | 2 | 3;
    } else if (rawArgs[i] === "--dir" && rawArgs[i + 1]) {
      cliDir = rawArgs[++i];
    } else if (rawArgs[i].startsWith("--dir=")) {
      cliDir = rawArgs[i].slice("--dir=".length);
    } else if (rawArgs[i] === "--conv" && rawArgs[i + 1]) {
      cliConvId = rawArgs[++i];
    } else if (rawArgs[i].startsWith("--conv=")) {
      cliConvId = rawArgs[i].slice("--conv=".length);
    } else if (rawArgs[i] === "--keep-dir") {
      keepDir = true;
    } else if (rawArgs[i] === "--no-save" || rawArgs[i] === "--dry-run") {
      noSave = true;
    } else {
      targetIds.push(rawArgs[i]);
    }
  }
  const outPath = path.resolve(__dirname, "real-agent-results.json");
  let existing: Record<string, Record<RealAgentMode, RealAgentRunMetrics>> = {};
  if (fs.existsSync(outPath)) {
    existing = JSON.parse(fs.readFileSync(outPath, "utf-8"));
  }

  interface BenchmarkTask {
    spec: RealWorldBenchmarkSpec;
    mode: RealAgentMode;
  }
  const tasks: BenchmarkTask[] = [];

  if (targetIds.some((t) => t.includes(":"))) {
    for (const t of targetIds) {
      const [id, mode] = t.split(":") as [string, RealAgentMode];
      const spec = ALL_REAL_AGENT_BENCHMARKS.find((s) => s.id === id);
      if (!spec) throw new Error(`Unknown spec ${id}`);
      tasks.push({ spec, mode });
    }
  } else {
    const specs = ALL_REAL_AGENT_BENCHMARKS.filter((s) =>
      targetIds.length === 0 ? true : targetIds.includes(s.id),
    );
    for (const spec of specs) {
      tasks.push({ spec, mode: "without_aice" });
      tasks.push({ spec, mode: "aice_no_idioms" });
      tasks.push({ spec, mode: "aice_with_idioms" });
    }
  }

  if (targetLayer) {
    const task = tasks[0];
    if (!task) throw new Error("No benchmark task specified for --layer");
    const res = await runAgentBenchmarkMode(task.spec, task.mode, {
      seed,
      targetLayer,
      existingConvId: cliConvId,
      existingDir: cliDir,
      keepWorkspace: keepDir || targetLayer < 3,
    });
    console.log(`\n[BENCHMARK_RESULT] ${JSON.stringify(res)}\n`);
    return;
  }

  const dashboard = new BenchmarkDashboard(tasks.length * 3, concurrency);
  dashboard.start();

  try {
    await runWithConcurrencyPool(tasks, concurrency, async ({ spec, mode }) => {
      const res = await runAgentBenchmarkMode(spec, mode, seed, dashboard);
      existing[spec.id] = existing[spec.id] || ({} as Record<RealAgentMode, RealAgentRunMetrics>);
      existing[spec.id][mode] = res;
      if (!noSave) {
        fs.writeFileSync(outPath, `${JSON.stringify(existing, null, 2)}\n`);
        syncBenchmarkDocsMarkdown(existing);
      }
      return res;
    });
  } finally {
    dashboard.stop();
  }

  console.log(`\n\x1b[1;32m✔ Completed ${tasks.length} scenarios across 3 progressive layers!\x1b[0m`);
  for (const { spec, mode } of tasks) {
    const res = existing[spec.id]?.[mode];
    if (!res) continue;
    const lInfo = res.layers?.map((l) => `L${l.layerIndex}: ${l.turns}t/${l.durationSeconds}s`).join(", ") || "";
    console.log(
      `  [${spec.id}:${mode.padEnd(16)}] totalTurns=${res.llmTurns} cost=$${res.apiCostUsd.toFixed(4)} regFree=${res.regressionFree} (${lInfo})`,
    );
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === __filename) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
