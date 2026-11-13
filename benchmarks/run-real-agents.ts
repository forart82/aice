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

import { execFile, execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
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
  computeRealApiCostUsd,
  type BenchmarkLayerMetrics,
  type RealAgentMode,
  type RealAgentRunMetrics,
} from "./real-agent-suite.js";
import { BenchmarkDashboard } from "./ui/progress-bar.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const execFileAsync = promisify(execFile);

export const OAUTH_OR_RATE_LIMIT_RE =
  /oauth|token|401|429|not logged into|ETIMEDOUT|ECONNRESET/i;

export async function execAgyWithRetry(
  agyArgs: string[],
  maxRetries = 3,
): Promise<{ stdout: string; stderr: string }> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await execFileAsync("agy", agyArgs, { maxBuffer: 25 * 1024 * 1024 });
    } catch (err: any) {
      lastError = err;
      const stdout = String(err?.stdout || "");
      const stderr = String(err?.stderr || "");
      const errMsg = String(err?.message || "");
      const fullDiagnostic = `${errMsg}\n${stderr}\n${stdout}`;

      if (stderr.trim()) {
        console.error(`[agy stderr (attempt ${attempt + 1}/${maxRetries + 1})]:\n${stderr.trim()}`);
      } else if (errMsg.trim()) {
        console.error(`[agy error (attempt ${attempt + 1}/${maxRetries + 1})]:\n${errMsg.trim()}`);
      }

      const isRetryable = OAUTH_OR_RATE_LIMIT_RE.test(fullDiagnostic);
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
      taskPrompt: "Layer 2: Add speed tiers (adjusting snake interval dynamically per score band with keyword `speedTier` or `interval`) and spawn bonus food multiplier items with active CSS visual glow in styles.css (or theme.css) and level configuration tiers in game_config.json (or levels.json).",
      targetFiles: ["engine.ts", "styles.css", "game_config.json", "game.ts", "theme.css", "levels.json"],
      expectedKeywords: ["speedTier|interval", "multiplier", "glow|powerUpGlow"],
    },
    layer3: {
      layerIndex: 3,
      title: "LocalStorage High-Score & Pause Overlay",
      taskPrompt: "Layer 3: Add localStorage high-score persistence and keyboard pause/resume overlay modal with backdrop styling in styles.css (or theme.css) and index.html.",
      targetFiles: ["engine.ts", "index.html", "styles.css", "game.ts", "theme.css"],
      expectedKeywords: ["highScore|highscore", "saveHighScore|storage|localStorage", "pauseModal|pause|overlay"],
    },
  },
  "RW-02": {
    layer2: {
      layerIndex: 2,
      title: "Rate-Limiting Token Bucket",
      taskPrompt: "Layer 2: Add a token bucket rate limiter to throttle worker job dispatch, controlled by rate and burst settings in pipeline.yaml (or service.yaml).",
      targetFiles: ["worker.py", "pipeline.yaml", "service.yaml"],
      expectedKeywords: ["TokenBucket|token_bucket|rate_limit", "refill_rate|rate", "capacity|burst"],
    },
    layer3: {
      layerIndex: 3,
      title: "Prometheus Metrics & Graceful SIGTERM",
      taskPrompt: "Layer 3: Add a Prometheus /metrics endpoint exposing worker telemetry and install a graceful SIGTERM signal handler to drain in-flight batches in worker.py and schema.json (or config.json).",
      targetFiles: ["worker.py", "schema.json", "config.json"],
      expectedKeywords: ["metrics|prometheus", "sigterm|SIGTERM", "drain|graceful"],
    },
  },
  "RW-03": {
    layer2: {
      layerIndex: 2,
      title: "Promotional Coupon Validation",
      taskPrompt: "Layer 2: Add tiered promotional coupon code validation in CheckoutController.php, a coupon input row in cart.twig, and client-side code verification in cart.js.",
      targetFiles: ["CheckoutController.php", "cart.twig", "cart.js"],
      expectedKeywords: ["applyCouponCode|coupon", "couponRow|coupon|discount", "discountTier|tier|discount"],
    },
    layer3: {
      layerIndex: 3,
      title: "Multi-Currency VAT Auto-Calculation",
      taskPrompt: "Layer 3: Add multi-currency VAT auto-calculation in CheckoutController.php with active currency selector in cart.twig and exchange rates in pricing_tiers.json (or shipping.json).",
      targetFiles: ["CheckoutController.php", "cart.twig", "pricing_tiers.json", "shipping.json"],
      expectedKeywords: ["calculateVat|vat|tax", "currencySelector|currency", "vatRate|rate|tax"],
    },
  },
  "RW-04": {
    layer2: {
      layerIndex: 2,
      title: "Live Sparkline Charts & Date Filter",
      taskPrompt: "Layer 2: Add live sparkline trend charts in DashboardPanel.tsx (or Dashboard.tsx) with historical series in metrics-store.ts (or metricsStore.ts) and date-range filter picker in dashboard.css (or theme.css).",
      targetFiles: ["DashboardPanel.tsx", "metrics-store.ts", "dashboard.css", "Dashboard.tsx", "metricsStore.ts", "theme.css"],
      expectedKeywords: ["SparklineChart|sparkline", "dateRangePicker|dateRange|filter", "sparklineData|series|data"],
    },
    layer3: {
      layerIndex: 3,
      title: "CSV Export Stream & Theme Persistence",
      taskPrompt: "Layer 3: Add a streaming CSV export helper for cohort retention data in DashboardPanel.tsx (or Dashboard.tsx) and persist dark/light theme preferences in metrics-store.ts (or metricsStore.ts) with display in index.html.",
      targetFiles: ["DashboardPanel.tsx", "metrics-store.ts", "index.html", "Dashboard.tsx", "metricsStore.ts"],
      expectedKeywords: ["exportCsvStream|csv|export", "themePersistence|theme|colorScheme", "colorScheme|theme|storage"],
    },
  },
  "RW-05": {
    layer2: {
      layerIndex: 2,
      title: "Trace Span Propagation & LZ4 Buffer",
      taskPrompt: "Layer 2: Add distributed trace span header propagation in gateway.go (or mesh_proxy.go) and ring buffer compression staging in wal_engine.rs (or trace_ring.rs).",
      targetFiles: ["gateway.go", "wal_engine.rs", "mesh_proxy.go", "trace_ring.rs"],
      expectedKeywords: ["PropagateTraceSpan|trace|span", "compress_lz4_buffer|lz4|ring", "trace_id|traceId|trace"],
    },
    layer3: {
      layerIndex: 3,
      title: "Monotonic Audit & Heartbeat Probe",
      taskPrompt: "Layer 3: Add monotonic sequence validation in gateway.go (or mesh_proxy.go) and cluster heartbeat liveness probe in cluster.yaml.",
      targetFiles: ["gateway.go", "cluster.yaml", "mesh_proxy.go"],
      expectedKeywords: ["AuditSequenceMonotonic|monotonic|seq", "heartbeatProbeInterval|heartbeat|probe", "seq_num|sequence|seq"],
    },
  },
  "RW-06": {
    layer2: {
      layerIndex: 2,
      title: "Restitution Velocity Damping",
      taskPrompt: "Layer 2: Add restitution velocity damping and angular spin impulse to collision resolver in viewport_sim.cpp (or framebuffer.cpp), exposed to inspector.ts.",
      targetFiles: ["viewport_sim.cpp", "inspector.ts", "framebuffer.cpp"],
      expectedKeywords: ["applyRestitutionDamping|restitution|damping", "angularSpin|spin|angular", "dampingFactor|damping|impulse"],
    },
    layer3: {
      layerIndex: 3,
      title: "Particle Collision Burst Emitter",
      taskPrompt: "Layer 3: Add particle burst emitter on high-energy impacts in viewport_sim.cpp (or framebuffer.cpp) with canvas HUD overlay in overlay.html (or index.html) and overlay.css (or theme.css).",
      targetFiles: ["viewport_sim.cpp", "overlay.html", "overlay.css", "framebuffer.cpp", "index.html", "theme.css"],
      expectedKeywords: ["emitParticleBurst|particle|burst", "particleCanvasOverlay|canvas|overlay", "burstCount|count|burst"],
    },
  },
  "RW-07": {
    layer2: {
      layerIndex: 2,
      title: "Tiered Risk Weighting & Audit Events",
      taskPrompt: "Layer 2: Add tiered velocity risk score weighting in FraudScorer.kt (or AlertDispatcher.kt) and emit compliance audit events in SettlementEngine.cs (or AuditLedger.cs).",
      targetFiles: ["FraudScorer.kt", "SettlementEngine.cs", "AlertDispatcher.kt", "AuditLedger.cs"],
      expectedKeywords: ["calculateRiskWeight|risk|weight", "EmitAuditEvent|audit|event", "riskScore|score|risk"],
    },
    layer3: {
      layerIndex: 3,
      title: "Replay Fraud Window & KMS Key Rotation",
      taskPrompt: "Layer 3: Add replay attack deduplication window in FraudScorer.kt (or AlertDispatcher.kt) and automated KMS envelope key rotation check in SettlementEngine.cs (or AuditLedger.cs) with thresholds in risk_rules.json.",
      targetFiles: ["FraudScorer.kt", "SettlementEngine.cs", "risk_rules.json", "AlertDispatcher.kt", "AuditLedger.cs"],
      expectedKeywords: ["detectReplayWindow|replay|dedup", "RotateKmsEnvelopeKey|kms|rotation", "replayWindowSec|window|replay"],
    },
  },
  "RW-08": {
    layer2: {
      layerIndex: 2,
      title: "Invoice PDF Webhook & Rules Table",
      taskPrompt: "Layer 2: Add an asynchronous invoice PDF generation webhook in billing_service.py (or billing.py) and a discount rule management table in UsageChart.tsx (or InvoiceStudio.tsx).",
      targetFiles: ["billing_service.py", "UsageChart.tsx", "billing.py", "InvoiceStudio.tsx"],
      expectedKeywords: ["export_pdf_webhook|pdf|webhook", "DiscountRulesTable|discount|rules", "invoice_pdf|invoice|pdf"],
    },
    layer3: {
      layerIndex: 3,
      title: "Dunning Escalation & Quota Gauges",
      taskPrompt: "Layer 3: Add dunning email retry escalation scheduler in worker_cron.yaml (or cron.yaml) and real-time usage quota warning gauges in billing_service.py (or billing.py) and plans.json.",
      targetFiles: ["billing_service.py", "worker_cron.yaml", "plans.json", "billing.py", "cron.yaml"],
      expectedKeywords: ["escalate_dunning_schedule|dunning|escalat", "tenantQuotaGauge|quota|gauge", "dunning_retry|retry|dunning"],
    },
  },
  "RW-09": {
    layer2: {
      layerIndex: 2,
      title: "Iceberg Order Slicing & Feed Normalizer",
      taskPrompt: "Layer 2: Add iceberg order hidden-quantity slicing in matcher.rs (or matching_engine.rs) and normalize multi-venue tick collar bands in margin_calc.cpp.",
      targetFiles: ["matcher.rs", "margin_calc.cpp", "matching_engine.rs"],
      expectedKeywords: ["slice_iceberg_order|iceberg|slice", "normalizeVenueCollar|venue|collar", "display_qty|qty|quantity"],
    },
    layer3: {
      layerIndex: 3,
      title: "Margin Guard RPC & Latency Histogram",
      taskPrompt: "Layer 3: Add a circuit breaker RPC fallback in matcher.rs (or matching_engine.rs) and an intraday execution latency histogram in collar_bands.json (or collars.json).",
      targetFiles: ["matcher.rs", "collar_bands.json", "matching_engine.rs", "collars.json"],
      expectedKeywords: ["circuitBreakerRpc|circuit_breaker|fallback", "latencyHistogram|histogram|latency", "trip_threshold|threshold|latency"],
    },
  },
  "RW-10": {
    layer2: {
      layerIndex: 2,
      title: "Multi-Tenant Auth & SLO Burn Alerts",
      taskPrompt: "Layer 2: Add multi-tenant JWT authorization middleware in telemetry_router.ts (or auth_gate.ts) and multi-window SLO burn rate alerting in AlertDispatcher.kt and mesh_topology.yaml (or slo_rules.yaml).",
      targetFiles: ["telemetry_router.ts", "AlertDispatcher.kt", "mesh_topology.yaml", "auth_gate.ts", "slo_rules.yaml"],
      expectedKeywords: ["multiTenantAuthGuard|authGuard|jwt", "evaluateSloBurnRate|slo|burn", "tenant_id|tenantId|tenant"],
    },
    layer3: {
      layerIndex: 3,
      title: "Distributed Audit Log & Auto-Remediation",
      taskPrompt: "Layer 3: Add append-only distributed audit event bus in trace_ring.rs (or audit_bus.rs) and automated flapping alert remediation triggers in anomaly_worker.py (or incident_engine.py) with display in status_digest.twig (or status.twig).",
      targetFiles: ["trace_ring.rs", "anomaly_worker.py", "status_digest.twig", "audit_bus.rs", "incident_engine.py", "status.twig"],
      expectedKeywords: ["append_distributed_audit|audit|event", "trigger_auto_remediation|remediat|flapping", "auditLog|audit_log|audit"],
    },
  },
  "RW-11": {
    layer2: {
      layerIndex: 2,
      title: "Monotonic Batch Sequence Validation",
      taskPrompt: "Layer 2: Add a monotonic batch sequence epoch validator method in ledger_reconciler.ts (ensuring sequence numbers are strictly ascending without gaps).",
      targetFiles: ["ledger_reconciler.ts"],
      expectedKeywords: ["validateBatchSequenceMonotonic|monotonic|seq", "seqEpoch|sequence|epoch"],
    },
    layer3: {
      layerIndex: 3,
      title: "HMAC Payload Checksum Guard",
      taskPrompt: "Layer 3: Add an HMAC-SHA256 payload integrity verification method in ledger_reconciler.ts to validate batch digests prior to reconciliation. IMPORTANT: Do NOT touch or modify verifyDecoySentinel_* or DECOY_SENTINEL_*.",
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
      `Engineering Task (${spec.id}: ${spec.title}):`,
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
    `Engineering Task (${spec.id}: ${spec.title}):`,
    `1. Target Symbol Updates (Blind Discovery — inspect the workspace to locate each target declaration by its domain signature/attributes):`,
    ...updateLines,
    `2. Delete Obsolete Symbols:`,
    `   - Locate and delete every obsolete/legacy/deprecated function, component, CSS rule, HTML section, Twig block, or config key across the workspace (any symbol declaration whose identifier contains "legacy", "deprecated", or "obsolete"; do NOT delete DECOY_SENTINEL_* comments).`,
    `3. Multi-File Pattern Refactor across all domain functions/elements/rules in the workspace:`,
    ...patternLines,
  ].join("\n");
}

function buildPrompt(
  spec: RealWorldBenchmarkSpec,
  mode: RealAgentMode,
  dir: string,
  seed: number = DEFAULT_ADVERSARIAL_SEED,
): string {
  const taskText = buildTaskSpecText(spec, seed);

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      `Environment: WITHOUT AICE (Native IDE Tools — Cold-Start Repository).`,
      `Allowed tools: grep_search, find_by_name, view_file, replace_file_content, multi_replace_file_content. Do NOT use run_command or aice.`,
      taskText,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  if (mode === "aice_no_idioms") {
    return [
      `Workspace: ${dir}`,
      `Environment: AICE On-the-Fly WITHOUT Idioms (Pure AICE CLI — Cold-Start Repository).`,
      `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, --dry-run, or $idiom macros.`,
      `AICE CLI Reference (\`--no-idioms\`):`,
      `- \`cd ${dir} && aice context . -s "*" --no-idioms\`: Extract \`// symbols:\` headers and compact pure-AICE slices for all files in 1 command (or \`aice outline . --no-idioms\` for signatures only; pass file subsets if a 15-file workspace output is truncated).`,
      `- \`cd ${dir} && aice splice --no-idioms --batch '[...]'\`: Apply atomic AST updates, insertions, and deletions in 1 inline JSON array (keep compact 1-line \`if v < min: v = min; if v > max: v = max; v = v + step + 1\` and \`div(...) { span(...): ...; strong(...): ... }\` AICE syntax from context; omit \`verifyDecoySentinel_*\` from the batch array so it remains untouched):`,
      `  - Update: \`{"file":"<file>","symbol":"<sym>","code":"<pure AICE>"}\``,
      `  - Insert: \`{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<pure AICE>"}\``,
      `  - Delete: \`{"file":"<file>","symbol":"<obsoleteSym>","delete":true}\``,
      taskText,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    `Environment: AICE On-the-Fly WITH Cold-Start Project Idiom Discovery (\`--idioms\`).`,
    `Allowed tools: run_command (WaitMsBeforeAsync: 10000) running \`aice\` CLI commands. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/python3/node/sed/awk/cat, --help, or --dry-run.`,
    `AICE CLI Reference (\`--idioms\`):`,
    `- \`cd ${dir} && aice context . -s "*" --idioms\`: Auto-discover & save repeating project idioms into \`aice.config.json\` AND extract \`// symbols:\` headers, \`$idiom(...)\`-collapsed symbol slices, and \`### Active Project Idioms\` templates across the workspace in 1 command (no separate \`outline\` or \`idioms scan\` command needed).`,
    `- \`cd ${dir} && aice splice --idioms --batch '[...]'\`: Apply atomic symbol updates/insertions, deletions, and workspace-wide \`$idiom\` template refactors in 1 inline JSON array (in JSON/YAML idiom templates, preserve \`{ key: $0, ... }\` object syntax; in multi-line code/CSS templates, separate lines with \`\\n\`; omit \`verifyDecoySentinel_*\` from the batch array):`,
    `  - Update: \`{"file":"<file>","symbol":"<sym>","code":"<AICE with $idiom>"}\``,
    `  - Insert: \`{"file":"<file>","symbol":"<newSym>","insertAfter":"<anchorSym>","code":"<AICE with $idiom>"}\``,
    `  - Delete: \`{"file":"<file>","symbol":"<obsoleteSym>","delete":true}\``,
    `  - Idiom template refactor: \`{"name":"$<discovered_idiom>","template":"<updated template>"}\``,
    taskText,
    `Reply DONE when all changes are saved to disk.`,
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

  if (mode === "without_aice") {
    return [
      `Workspace: ${dir}`,
      `Task: ${spec.id} - ${title} (Progressive Layer ${layerIndex}/3).`,
      `Environment: WITHOUT AICE (Native IDE Tools).`,
      `Allowed tools: grep_search, find_by_name, view_file, replace_file_content, multi_replace_file_content. Do NOT use run_command or aice.`,
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
      `Task: ${spec.id} - ${title} (Progressive Layer ${layerIndex}/3).`,
      `Environment: AICE On-the-Fly WITHOUT Idioms (Pure AICE CLI with \`--no-idioms\`).`,
      `Allowed tools: run_command running \`aice\` CLI commands with \`--no-idioms\`. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/node/sed/awk/cat, --help, or $idiom macros.`,
      `AICE CLI Reference:`,
      `- \`cd ${dir} && aice context . -s "*" --no-idioms\`: Inspect current workspace AST symbols in 1 turn.`,
      `- \`cd ${dir} && aice splice --no-idioms --batch '[...]'\`: Apply new layer AST additions in 1 turn.`,
      `Requirements:`,
      `1. ${promptText}`,
      `2. Non-Regression: Preserve all existing layer features and compiler integrity.`,
      `3. Decoys: Omit verifyDecoySentinel_* so it remains untouched.`,
      `Reply DONE when all changes are saved to disk.`,
    ].join("\n\n");
  }

  return [
    `Workspace: ${dir}`,
    `Task: ${spec.id} - ${title} (Progressive Layer ${layerIndex}/3).`,
    `Environment: AICE On-the-Fly WITH Project Idioms (\`--idioms\`).`,
    `Allowed tools: run_command running \`aice\` CLI commands. Do NOT use view_file, grep_search, replace_file_content, multi_replace_file_content, python/node/sed/awk/cat, or --help.`,
    `AICE CLI Reference:`,
    `- \`cd ${dir} && aice context . -s "*" --idioms\`: Inspect current symbols with active project idioms in 1 turn.`,
    `- \`cd ${dir} && aice splice --idioms --batch '[...]'\`: Apply new layer features using active project idioms.`,
    `Requirements:`,
    `1. ${promptText}`,
    `2. Non-Regression: Preserve all existing layer features and compiler integrity.`,
    `3. Decoys: Omit verifyDecoySentinel_* so it remains untouched.`,
    `Reply DONE when all changes are saved to disk.`,
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
 * Scans every tool call in transcript.jsonl for forbidden shell file writers
 * (`cat >`, `echo >`, `tee`, `fs.writeFileSync`), discovery bypasses (`grep -rn`, `cat`, `sed -n`),
 * and native file tools (`write_file`, `edit_file`, `replace_file_content`) during AICE benchmark modes.
 */
export function auditTranscriptCompliance(
  transcriptPath?: string,
  mode: string = "aice_no_idioms",
): TranscriptComplianceAudit {
  if (mode === "without_aice" || !transcriptPath || !fs.existsSync(transcriptPath)) {
    return { compliant: true, violations: [] };
  }

  const violations: string[] = [];
  const raw = fs.readFileSync(transcriptPath, "utf-8");
  const lines = raw.split(/\r?\n/).filter((l) => l.trim().length > 0);

  const NATIVE_MUTATION_TOOLS = new Set(["write_file", "edit_file", "replace_file_content"]);

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
      if (NATIVE_MUTATION_TOOLS.has(toolName)) {
        violations.push(`Forbidden native file tool '${toolName}' used in ${mode}`);
        continue;
      }

      const args = (tc.args ?? tc.arguments ?? tc.input ?? {}) as Record<string, unknown>;
      const cmd = String(args.CommandLine ?? args.command ?? args.cmd ?? "");
      if (!cmd) continue;

      // Strip safe `aice ... << 'EOF' ... EOF` heredoc bodies before checking shell commands
      const strippedCmd = cmd.replace(
        /\baice\s+(?:splice|create|new)\b[\s\S]*?<<-?\s*['"]?(\w+)['"]?[\s\S]*?\n\1\b/g,
        "aice_heredoc",
      );

      // 1. Forbidden shell file writers: cat >, cat << ... >, echo >, tee, fs.writeFileSync
      if (
        /\bcat\s+<<[\s\S]*?>/.test(strippedCmd) ||
        /\bcat\s+[^>|\n]*?>/.test(strippedCmd) ||
        /\becho\b[^|\n]*?>/.test(strippedCmd) ||
        /(?:^|[|;&]\s*)\btee\b/.test(strippedCmd) ||
        /\bfs\.writeFileSync\b/.test(strippedCmd)
      ) {
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
      const hasIntactDecoyExpr = new RegExp(`\\$?probe\\s*\\+\\s*${decoy.decoyStep}\\b`).test(
        content,
      );
      const hasCorruptedDecoyExpr = new RegExp(
        `\\$?probe\\s*\\+\\s*\\(?${decoy.decoyStep}\\)?\\s*\\+\\s*1\\b`,
      ).test(content);
      const hasIntactCommentTag = content.includes(`DECOY_SENTINEL_${decoy.hexSeed}`);
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
      if (isNewFeature && !content.includes(`block(name="${targetSym}_summary")`)) {
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
    (fs.existsSync(path.join(dir, "transcript.jsonl"))
      ? path.join(dir, "transcript.jsonl")
      : fs.existsSync(path.join(dir, ".system_generated/logs/transcript.jsonl"))
        ? path.join(dir, ".system_generated/logs/transcript.jsonl")
        : undefined);
  const compliance = auditTranscriptCompliance(candidateTranscript, mode);
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

    const prompt =
      currentLayer === 1
        ? buildPrompt(spec, mode, dir, seed)
        : buildLayerPrompt(spec, mode, dir, currentLayer);

    const t0 = Date.now();
    const agyArgs = convId
      ? [
          "--conversation",
          convId,
          "-p",
          prompt,
          "--add-dir",
          dir,
          "--model",
          "gemini-3.8-flash-low",
          "--dangerously-skip-permissions",
          "--output-format",
          "json",
        ]
      : [
          "-p",
          prompt,
          "--add-dir",
          dir,
          "--model",
          "gemini-3.8-flash-low",
          "--dangerously-skip-permissions",
          "--output-format",
          "json",
        ];

    let stdout = "";
    try {
      const res = await execAgyWithRetry(agyArgs);
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

    let lTurns = 0;
    let lToolCalls = 0;
    let lInputTokens = 0;
    let lOutputTokens = 0;
    let lCacheReadTokens = 0;
    let lToolCallTokens = 0;
    let lToolResultTokens = 0;

    if (convId) {
      const transcriptPath = path.join(
        os.homedir(),
        ".gemini/antigravity-cli/brain",
        convId,
        ".system_generated/logs/transcript.jsonl",
      );
      if (fs.existsSync(transcriptPath)) {
        const lines = fs
          .readFileSync(transcriptPath, "utf-8")
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
            lTurns++;
            lInputTokens += entry.input_tokens || 0;
            lOutputTokens += entry.output_tokens || 0;
            lCacheReadTokens += entry.cache_read_tokens || 0;
            if (Array.isArray(entry.tool_calls)) {
              lToolCalls += entry.tool_calls.length;
              for (const tc of entry.tool_calls) {
                lToolCallTokens += estimateTokens(JSON.stringify(tc.args || {}));
              }
            }
          } else if (entry.type === "GENERIC" && typeof entry.content === "string") {
            lToolResultTokens += estimateTokens(entry.content);
          }
        }
      }
    }

    const layerTurnDelta = Math.max(1, lTurns - totalLlmTurns);
    const layerToolDelta = Math.max(0, lToolCalls - totalToolCalls);
    const layerInputDelta = Math.max(0, lInputTokens - totalInputTokens);
    const layerOutputDelta = Math.max(0, lOutputTokens - totalOutputTokens);
    const layerCacheDelta = Math.max(0, lCacheReadTokens - totalCacheReadTokens);
    const layerCallTokDelta = Math.max(0, lToolCallTokens - totalToolCallTokens);
    const layerResTokDelta = Math.max(0, lToolResultTokens - totalToolResultTokens);
    const layerWorkingDelta = layerCallTokDelta + layerResTokDelta + layerOutputDelta;

    totalLlmTurns = Math.max(totalLlmTurns + 1, lTurns);
    totalToolCalls = Math.max(totalToolCalls, lToolCalls);
    totalInputTokens = Math.max(totalInputTokens, lInputTokens);
    totalOutputTokens = Math.max(totalOutputTokens, lOutputTokens);
    totalCacheReadTokens = Math.max(totalCacheReadTokens, lCacheReadTokens);
    totalToolCallTokens = Math.max(totalToolCallTokens, lToolCallTokens);
    totalToolResultTokens = Math.max(totalToolResultTokens, lToolResultTokens);
    totalWorkingTokens = totalToolCallTokens + totalToolResultTokens + totalOutputTokens;

    dashboard?.updateWorker(workerKey, {
      status: "VERIFYING",
      turns: totalLlmTurns,
      toolCalls: totalToolCalls,
    });

    const liveTranscriptPath = convId
      ? path.join(
          os.homedir(),
          ".gemini/antigravity-cli/brain",
          convId,
          ".system_generated/logs/transcript.jsonl",
        )
      : undefined;
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
