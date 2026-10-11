/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Antigravity Lifecycle Hook Interceptor in AIL Shield.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAiShield,
  checkAiShieldStatus,
  removeAiShield,
} from "../../src/shield/index.js";

describe("AIL Shield: Antigravity Lifecycle Hook Interceptor", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-hook-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates .agents/hooks.json, rules/ail-shield.md, and ail-shield-hook.mjs when lifecycleHooks is true", async () => {
    const res = await applyAiShield(testDir, { lifecycleHooks: true });

    expect(res.activeShields).toContain("lifecycleHooks");

    const hooksJsonPath = path.join(testDir, ".agents", "hooks.json");
    const hookScriptPath = path.join(testDir, ".agents", "ail-shield-hook.mjs");
    const ruleMdPath = path.join(testDir, ".agents", "rules", "ail-shield.md");

    expect(fs.existsSync(hooksJsonPath)).toBe(true);
    expect(fs.existsSync(hookScriptPath)).toBe(true);
    expect(fs.existsSync(ruleMdPath)).toBe(true);

    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
    expect(hooksJson["ail-shield-interceptor"]).toBeDefined();
    expect(hooksJson["ail-shield-interceptor"].PreToolUse[0].matcher).toContain("view_file");

    const status = await checkAiShieldStatus(testDir);
    expect(status.lifecycleHooksConfigured).toBe(true);
  });

  it("updates GEMINI.md when present with stack trace translation rules", async () => {
    const geminiMdPath = path.join(testDir, "GEMINI.md");
    fs.writeFileSync(geminiMdPath, "# Scope Confinement Invariant\n\nOnly stay in root.\n", "utf-8");

    await applyAiShield(testDir, { lifecycleHooks: true });

    const content = fs.readFileSync(geminiMdPath, "utf-8");
    expect(content).toContain("Scope Confinement Invariant");
    expect(content).toContain("AIL Project Directives");
    expect(content).toContain("Stack Trace Path Translation");
    expect(content).toContain("DO NOT OPEN OR INSPECT THE TARGET FILE");
  });

  it("executes ail-shield-hook.mjs and rewrites view_file when .ail sibling exists", () => {
    const agentsDir = path.join(testDir, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    // Create target file and its .ail sibling
    const targetFile = path.join(testDir, "engine.ts");
    const ailFile = path.join(testDir, "engine.ts.ail");
    fs.writeFileSync(targetFile, "export const x = 1;", "utf-8");
    fs.writeFileSync(ailFile, "pub x := 1", "utf-8");

    applyAiShield(testDir, { lifecycleHooks: true });

    const hookScript = path.join(agentsDir, "ail-shield-hook.mjs");
    const inputPayload = JSON.stringify({
      toolCall: {
        name: "view_file",
        args: { AbsolutePath: targetFile },
      },
    });

    const run = spawnSync("node", [hookScript], {
      input: inputPayload,
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.decision).toBe("allow");
    expect(parsed.overwrite).toBeDefined();
    expect(parsed.overwrite.AbsolutePath).toBe(ailFile);
  });

  it("executes ail-shield-hook.mjs and denies replace_file_content on target file when .ail exists", () => {
    const agentsDir = path.join(testDir, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    const targetFile = path.join(testDir, "engine.ts");
    const ailFile = path.join(testDir, "engine.ts.ail");
    fs.writeFileSync(targetFile, "export const x = 1;", "utf-8");
    fs.writeFileSync(ailFile, "pub x := 1", "utf-8");

    applyAiShield(testDir, { lifecycleHooks: true });

    const hookScript = path.join(agentsDir, "ail-shield-hook.mjs");
    const inputPayload = JSON.stringify({
      toolCall: {
        name: "replace_file_content",
        args: { TargetFile: targetFile },
      },
    });

    const run = spawnSync("node", [hookScript], {
      input: inputPayload,
      encoding: "utf-8",
    });

    expect(run.status).toBe(0);
    const parsed = JSON.parse(run.stdout);
    expect(parsed.decision).toBe("deny");
    expect(parsed.reason).toContain("MANDATORY AIL SHIELD");
    expect(parsed.reason).toContain("engine.ts.ail");
  });

  it("cleanly removes lifecycle hooks on removeAiShield", async () => {
    await applyAiShield(testDir, { lifecycleHooks: true });
    expect(fs.existsSync(path.join(testDir, ".agents", "hooks.json"))).toBe(true);

    const removeRes = await removeAiShield(testDir, { lifecycleHooks: true });
    expect(removeRes.removedFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(testDir, ".agents", "hooks.json"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".agents", "ail-shield-hook.mjs"))).toBe(false);

    const status = await checkAiShieldStatus(testDir);
    expect(status.lifecycleHooksConfigured).toBe(false);
  });

  it("never creates a recursive symlink .agents/.agents and cleans up legacy ones", async () => {
    // 1. Fresh apply does not create .agents/.agents
    await applyAiShield(testDir, { lifecycleHooks: true });
    const nestedAgentsLink = path.join(testDir, ".agents", ".agents");
    expect(fs.existsSync(nestedAgentsLink)).toBe(false);
    expect(() => fs.lstatSync(nestedAgentsLink)).toThrow();

    // 2. Pre-existing legacy recursive symlink is removed by applyAiShield
    fs.symlinkSync(".", nestedAgentsLink);
    expect(fs.lstatSync(nestedAgentsLink).isSymbolicLink()).toBe(true);
    await applyAiShield(testDir, { lifecycleHooks: true });
    expect(() => fs.lstatSync(nestedAgentsLink)).toThrow();

    // 3. Pre-existing legacy recursive symlink is removed by removeAiShield
    fs.symlinkSync(".", nestedAgentsLink);
    expect(fs.lstatSync(nestedAgentsLink).isSymbolicLink()).toBe(true);
    await removeAiShield(testDir, { lifecycleHooks: true });
    expect(() => fs.lstatSync(nestedAgentsLink)).toThrow();
  });
});

