/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { describe, expect, it } from "vitest";
import {
  ALL_REAL_AGENT_BENCHMARKS,
  buildLayerPrompt,
  SCENARIO_LAYER_DEFINITIONS,
  OAUTH_OR_RATE_LIMIT_RE,
  execAgyWithRetry,
} from "../../benchmarks/run-real-agents.js";
import { BenchmarkDashboard } from "../../benchmarks/ui/progress-bar.js";

describe("3-Layer Progressive Benchmark & Dashboard Engine", () => {
  it("defines Layer 2 and Layer 3 specifications for all 11 benchmark scenarios", () => {
    expect(ALL_REAL_AGENT_BENCHMARKS.length).toBe(11);
    for (const spec of ALL_REAL_AGENT_BENCHMARKS) {
      const def = SCENARIO_LAYER_DEFINITIONS[spec.id];
      expect(def, `Missing layer definitions for ${spec.id}`).toBeDefined();
      expect(def.layer2.layerIndex).toBe(2);
      expect(def.layer2.title.length).toBeGreaterThan(3);
      expect(def.layer2.taskPrompt.length).toBeGreaterThan(10);
      expect(def.layer2.targetFiles.length).toBeGreaterThan(0);
      expect(def.layer2.expectedKeywords.length).toBeGreaterThan(0);

      expect(def.layer3.layerIndex).toBe(3);
      expect(def.layer3.title.length).toBeGreaterThan(3);
      expect(def.layer3.taskPrompt.length).toBeGreaterThan(10);
      expect(def.layer3.targetFiles.length).toBeGreaterThan(0);
      expect(def.layer3.expectedKeywords.length).toBeGreaterThan(0);
    }
  });

  it("builds clean Layer 2 and Layer 3 prompts across all modes", () => {
    const spec = ALL_REAL_AGENT_BENCHMARKS[0];
    const l2PromptNoAice = buildLayerPrompt(spec, "without_aice", "/tmp/test", 2);
    expect(l2PromptNoAice).toContain("Progressive Layer 2/3");
    expect(l2PromptNoAice).toContain("WITHOUT AICE");
    expect(l2PromptNoAice).toContain("Non-Regression");

    const l2PromptAice = buildLayerPrompt(spec, "aice_no_idioms", "/tmp/test", 2);
    expect(l2PromptAice).toContain("Progressive Layer 2/3");
    expect(l2PromptAice).toContain("aice context");
    expect(l2PromptAice).toContain("aice splice");

    const l3PromptIdioms = buildLayerPrompt(spec, "aice_with_idioms", "/tmp/test", 3);
    expect(l3PromptIdioms).toContain("Progressive Layer 3/3");
    expect(l3PromptIdioms).toContain("--idioms");
  });

  it("renders unicode progress bars and tracks worker states without crashing", () => {
    const bar = BenchmarkDashboard.buildBar(0.5, 10);
    expect(bar).toContain("█");
    expect(bar).toContain("░");

    const dashboard = new BenchmarkDashboard(33, 3);
    dashboard.registerWorker("RW-01:without_aice", {
      id: "RW-01",
      mode: "without_aice",
      title: "HTML5 Snake",
      layer: 1,
      layerTitle: "Layer 1: Baseline",
      status: "RUNNING",
    });

    dashboard.updateWorker("RW-01:without_aice", {
      turns: 2,
      status: "VERIFYING",
    });
    dashboard.stepCompleted();

    dashboard.updateWorker("RW-01:without_aice", {
      layer: 2,
      layerTitle: "Layer 2: Speed Tiers",
      status: "RUNNING",
    });
    dashboard.stepCompleted();

    dashboard.updateWorker("RW-01:without_aice", {
      layer: 3,
      layerTitle: "Layer 3: LocalStorage",
      status: "DONE",
    });
    dashboard.stepCompleted();

    expect(() => dashboard.render()).not.toThrow();
  });
});
it("identifies retryable OAuth, rate-limit, and connection errors", () => {
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Error: OAuth token refresh failed")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Request failed with status code 401")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Resource exhausted: 429 Too Many Requests")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("User is not logged into Google Cloud")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("connect ETIMEDOUT 142.250.180.10")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("read ECONNRESET")).toBe(true);
  expect(OAUTH_OR_RATE_LIMIT_RE.test("Random compilation bug")).toBe(false);
});

it("exports execAgyWithRetry and fails cleanly on non-retryable errors", async () => {
  await expect(execAgyWithRetry(["--non-existent-flag-xyz-12345"], 0)).rejects.toThrow();
});
