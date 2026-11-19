/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Regression suite for CLI multi-target `aice context` (`bin/aice.ts`):
 * - Shared `WorkspaceCallerScanCache` across multi-file CLI targets
 * - Unified single `<multi-context>` telemetry event (and single-target fallback when siblings are missing)
 * - Merged deduplicated contracts, downstream callers, and adaptive sibling outlines
 * - `--json`, `--stats`, `// not found:` resilience, and cross-file `-s "fnA,fnB"` reconciliation
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { loadTelemetryEvents } from "../../src/telemetry/index.js";
import type { ContextResult } from "../../src/tools/context.js";

const CLI_ENTRY = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, telemetryPath?: string) {
  const env: NodeJS.ProcessEnv = { ...process.env };
  if (telemetryPath) {
    env.AICE_TELEMETRY_PATH = telemetryPath;
  } else {
    delete env.AICE_TELEMETRY_PATH;
    delete env.AICE_TELEMETRY_DIR;
  }
  return spawnSync(TSX_BIN, [CLI_ENTRY, ...args], {
    cwd,
    encoding: "utf-8",
    env,
    timeout: 60000,
  });
}

describe("CLI multi-target `aice context` shared scan cache & unified telemetry", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-cli-multictx-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: true }, null, 2),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "a.ts"),
      [
        "export interface SharedContextOpts {",
        "  factor: number;",
        "  label: string;",
        "}",
        "",
        "export class AlphaEngine {",
        "  public fnA(opts: SharedContextOpts): number {",
        "    return opts.factor * 2;",
        "  }",
        "",
        "  public resetAlpha(): void {}",
        "",
        "  public describeAlpha(prefix: string): string {",
        '    return prefix + ":alpha";',
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "b.ts"),
      [
        'import { AlphaEngine, type SharedContextOpts } from "./a.js";',
        "",
        "export class BetaService {",
        "  private readonly engine = new AlphaEngine();",
        "",
        "  public fnB(opts: SharedContextOpts): number {",
        "    const base = this.engine.fnA(opts);",
        "    return base + 10;",
        "  }",
        "",
        "  public validateBeta(value: number): boolean {",
        "    return value > 0;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    fs.writeFileSync(
      path.join(tmpDir, "c.ts"),
      [
        'import { AlphaEngine, type SharedContextOpts } from "./a.js";',
        'import { BetaService } from "./b.js";',
        "",
        "export class GammaController {",
        "  private readonly alpha = new AlphaEngine();",
        "  private readonly beta = new BetaService();",
        "",
        "  public fnC(factor: number): string {",
        '    const opts: SharedContextOpts = { factor, label: "gamma" };',
        "    const total = this.alpha.fnA(opts) + this.beta.fnB(opts);",
        '    return opts.label + ":" + String(total);',
        "  }",
        "",
        "  public healthCheck(): string {",
        '    return "ok";',
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("1. outputs merged deduplicated contracts, downstream callers, and adaptive sibling outlines for a.ts:fnA b.ts:fnB c.ts:fnC", () => {
    const res = runCli(["context", "a.ts:fnA", "b.ts:fnB", "c.ts:fnC"], tmpDir);
    expect(res.status).toBe(0);

    expect(res.stdout).toContain("# AICE Multi-File Context Stream (3 targets: a.ts, b.ts, c.ts)");

    // Deduplicated contracts: both b.ts and c.ts import ./a.js (SharedContextOpts),
    // and BetaService from ./b.js is pruned as already in target stream, so ./a.js appears once
    expect(res.stdout).toContain("## Imported Dependency Contracts (1):");
    const depAMatches = res.stdout.match(/### Dependency: `\.\/a\.js`/g) ?? [];
    expect(depAMatches.length).toBe(1);
    expect(res.stdout).toContain("type SharedContextOpts:");

    // Extracted target method slices
    expect(res.stdout).toContain("fnA");
    expect(res.stdout).toContain("fnB");
    expect(res.stdout).toContain("fnC");

    // Adaptive sibling outlines for enclosing classes
    expect(res.stdout).toContain("// siblings in AlphaEngine:");
    expect(res.stdout).toContain("resetAlpha");
    expect(res.stdout).toContain("describeAlpha");
    expect(res.stdout).toContain("// siblings in BetaService:");
    expect(res.stdout).toContain("validateBeta");
    expect(res.stdout).toContain("// siblings in GammaController:");
    expect(res.stdout).toContain("healthCheck");

    // Downstream callers across the workspace
    expect(res.stdout).toContain("## Downstream Callers");
    expect(res.stdout).toContain("b.ts imports:");
    expect(res.stdout).toContain("c.ts imports:");
  });

  it("2. records exactly 1 unified <multi-context> telemetry event instead of 3 separate per-file events", () => {
    const telemetryFile = path.join(tmpDir, "telemetry", "gains.jsonl");
    const res = runCli(["context", "a.ts:fnA", "b.ts:fnB", "c.ts:fnC"], tmpDir, telemetryFile);
    expect(res.status).toBe(0);

    const events = loadTelemetryEvents(telemetryFile);
    expect(events.length).toBe(1);
    const ev = events[0];
    expect(ev).toBeDefined();
    expect(ev?.filePath).toBe("<multi-context>");
    expect(ev?.operation).toBe("context");
    expect(ev?.surface).toBe("cli");
    expect(ev?.nativeChars).toBeGreaterThan(0);
    expect(ev?.nativeCl100k).toBeGreaterThan(0);
    expect(ev?.nativeO200k).toBeGreaterThan(0);
    expect(ev?.aiceCl100k).toBeGreaterThan(0);
    expect(ev?.realisticNativeCl100k).toBe(ev?.nativeCl100k);
  });

  it("3. returns a JSON array of 3 ContextResult objects with --json and single object for 1 target", () => {
    const telemetryFile = path.join(tmpDir, "telemetry", "json-gains.jsonl");
    const multiRes = runCli(
      ["context", "a.ts:fnA", "b.ts:fnB", "c.ts:fnC", "--json"],
      tmpDir,
      telemetryFile,
    );
    expect(multiRes.status).toBe(0);

    const parsed = JSON.parse(multiRes.stdout) as ContextResult[];
    expect(Array.isArray(parsed)).toBe(true);
    expect(parsed.length).toBe(3);
    expect(parsed.map((r) => r.targetPath)).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect(parsed[0]?.targetContent).toContain("fnA");
    expect(parsed[1]?.targetContent).toContain("fnB");
    expect(parsed[2]?.targetContent).toContain("fnC");

    const events = loadTelemetryEvents(telemetryFile);
    expect(events.length).toBe(1);
    expect(events[0]?.filePath).toBe("<multi-context>");

    const singleRes = runCli(["context", "a.ts:fnA", "--json"], tmpDir);
    expect(singleRes.status).toBe(0);
    const singleParsed = JSON.parse(singleRes.stdout) as ContextResult;
    expect(Array.isArray(singleParsed)).toBe(false);
    expect(singleParsed.targetPath).toBe("a.ts");
  });

  it("4. prints fnA + // not found: missing.ts without crashing and preserves single-target telemetry", () => {
    const telemetryFile = path.join(tmpDir, "telemetry", "partial-missing-gains.jsonl");
    const res = runCli(["context", "a.ts:fnA", "missing.ts"], tmpDir, telemetryFile);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("fnA");
    expect(res.stdout).toContain("// not found: missing.ts");

    const events = loadTelemetryEvents(telemetryFile);
    expect(events.length).toBe(1);
    expect(events[0]?.filePath).toBe("a.ts");
    expect(events[0]?.operation).toBe("context");

    const allMissing = runCli(["context", "missing1.ts", "missing2.ts"], tmpDir);
    expect(allMissing.status).not.toBe(0);
    expect(allMissing.stderr).toContain("Path not found:");
  });

  it('5. resolves shared -s "fnA,fnB" across a.ts b.ts cleanly without stale // missing: annotations and supports --stats', () => {
    const telemetryFile = path.join(tmpDir, "telemetry", "shared-sym-gains.jsonl");
    const res = runCli(["context", "a.ts", "b.ts", "-s", "fnA,fnB"], tmpDir, telemetryFile);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("fnA");
    expect(res.stdout).toContain("fnB");
    expect(res.stdout).not.toContain("// missing:");

    const events = loadTelemetryEvents(telemetryFile);
    expect(events.length).toBe(1);
    expect(events[0]?.filePath).toBe("<multi-context>");

    // Truly missing symbol across all targets is still reported once
    const withGhost = runCli(["context", "a.ts", "b.ts", "-s", "fnA,fnB,ghostSym"], tmpDir);
    expect(withGhost.status).toBe(0);
    expect(withGhost.stdout).toContain("fnA");
    expect(withGhost.stdout).toContain("fnB");
    const missingLines = withGhost.stdout.match(/\/\/ missing:[^\n]+/g) ?? [];
    expect(missingLines).toEqual(["// missing: ghostSym"]);

    // --stats flag works identically on multi-target context
    const statsRes = runCli(["context", "a.ts:fnA", "b.ts:fnB", "--stats"], tmpDir);
    expect(statsRes.status).toBe(0);
    expect(statsRes.stdout).toContain("📊 Context Pack Token Telemetry:");
    expect(statsRes.stdout).toContain("Total pack tokens:");
  });
});
