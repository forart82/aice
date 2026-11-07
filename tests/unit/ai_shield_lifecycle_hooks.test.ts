/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for Antigravity Lifecycle Hook Interceptor in AICE Shield.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  applyAiShield,
  checkAiShieldStatus,
  interceptPreToolUse,
  lockFile,
  removeAiShield,
} from "../../src/shield/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

function runCli(
  args: string[],
  options?: { input?: string; cwd?: string },
): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: options?.cwd ?? process.cwd(),
    input: options?.input,
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

describe("AICE Shield: Antigravity Lifecycle Hook Interceptor", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-hook-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore
    }
  });

  it("creates .agents/hooks.json, rules/aice-shield.md, and aice-shield-hook.mjs when lifecycleHooks is true", async () => {
    const res = await applyAiShield(testDir, { lifecycleHooks: true });

    expect(res.activeShields).toContain("lifecycleHooks");

    const hooksJsonPath = path.join(testDir, ".agents", "hooks.json");
    const hookScriptPath = path.join(testDir, ".agents", "aice-shield-hook.mjs");
    const ruleMdPath = path.join(testDir, ".agents", "rules", "aice-shield.md");

    expect(fs.existsSync(hooksJsonPath)).toBe(true);
    expect(fs.existsSync(hookScriptPath)).toBe(true);
    expect(fs.existsSync(ruleMdPath)).toBe(true);

    const hooksJson = JSON.parse(fs.readFileSync(hooksJsonPath, "utf-8"));
    expect(hooksJson["aice-shield-interceptor"]).toBeDefined();
    expect(hooksJson["aice-shield-interceptor"].PreToolUse[0].matcher).toContain("view_file");
    const cmd = hooksJson["aice-shield-interceptor"].PreToolUse[0].hooks[0].command;
    expect(cmd).toContain("aice shield intercept");
    expect(cmd).toContain("aice-shield-hook.mjs");

    const status = await checkAiShieldStatus(testDir);
    expect(status.lifecycleHooksConfigured).toBe(true);
  });

  it("updates GEMINI.md when present with stack trace translation rules", async () => {
    const geminiMdPath = path.join(testDir, "GEMINI.md");
    fs.writeFileSync(geminiMdPath, "# Scope Confinement Invariant\n\nOnly stay in root.\n", "utf-8");

    await applyAiShield(testDir, { lifecycleHooks: true });

    const content = fs.readFileSync(geminiMdPath, "utf-8");
    expect(content).toContain("Scope Confinement Invariant");
    expect(content).toContain("AICE Project Directives");
    expect(content).toContain("Stack Trace Path Translation");
    expect(content).toContain("DO NOT OPEN OR INSPECT THE TARGET FILE");
  });

  it("executes aice-shield-hook.mjs and rewrites view_file when .aice sibling exists", () => {
    const agentsDir = path.join(testDir, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    // Create target file and its .aice sibling
    const targetFile = path.join(testDir, "engine.ts");
    const aiceFile = path.join(testDir, "engine.ts.aice");
    fs.writeFileSync(targetFile, "export const x = 1;", "utf-8");
    fs.writeFileSync(aiceFile, "pub x := 1", "utf-8");

    applyAiShield(testDir, { lifecycleHooks: true });

    const hookScript = path.join(agentsDir, "aice-shield-hook.mjs");
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
    expect(parsed.overwrite.AbsolutePath).toBe(aiceFile);
  });

  it("executes aice-shield-hook.mjs and denies replace_file_content on target file when .aice exists", () => {
    const agentsDir = path.join(testDir, ".agents");
    fs.mkdirSync(agentsDir, { recursive: true });

    const targetFile = path.join(testDir, "engine.ts");
    const aiceFile = path.join(testDir, "engine.ts.aice");
    fs.writeFileSync(targetFile, "export const x = 1;", "utf-8");
    fs.writeFileSync(aiceFile, "pub x := 1", "utf-8");

    applyAiShield(testDir, { lifecycleHooks: true });

    const hookScript = path.join(agentsDir, "aice-shield-hook.mjs");
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
    expect(parsed.reason).toContain("MANDATORY AICE SHIELD");
    expect(parsed.reason).toContain("engine.ts.aice");
  });

  it("cleanly removes lifecycle hooks on removeAiShield", async () => {
    await applyAiShield(testDir, { lifecycleHooks: true });
    expect(fs.existsSync(path.join(testDir, ".agents", "hooks.json"))).toBe(true);

    const removeRes = await removeAiShield(testDir, { lifecycleHooks: true });
    expect(removeRes.removedFiles.length).toBeGreaterThan(0);
    expect(fs.existsSync(path.join(testDir, ".agents", "hooks.json"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".agents", "aice-shield-hook.mjs"))).toBe(false);

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

  describe("interceptPreToolUse function", () => {
    it("returns allow for empty input, whitespace, or invalid JSON", () => {
      expect(interceptPreToolUse("")).toEqual({ decision: "allow" });
      expect(interceptPreToolUse("   ")).toEqual({ decision: "allow" });
      expect(interceptPreToolUse("not a json string")).toEqual({ decision: "allow" });
      expect(interceptPreToolUse("{}")).toEqual({ decision: "allow" });
    });

    it("returns allow for unsupported tools", () => {
      const input = JSON.stringify({
        toolName: "run_command",
        toolInput: { command: "cat file.ts" },
      });
      expect(interceptPreToolUse(input)).toEqual({ decision: "allow" });
    });

    it("returns allow for view_file when no .aice sibling exists", () => {
      const target = path.join(testDir, "standalone.ts");
      fs.writeFileSync(target, "const x = 1;");
      const input = JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: target },
        },
      });
      expect(interceptPreToolUse(input, testDir)).toEqual({ decision: "allow" });
    });

    it("redirects view_file to .aice sibling with AbsolutePath (Antigravity camelCase format)", () => {
      const target = path.join(testDir, "engine.ts");
      const aiceSibling = path.join(testDir, "engine.ts.aice");
      fs.writeFileSync(target, "export const x = 1;");
      fs.writeFileSync(aiceSibling, "pub x := 1");

      const input = JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: target },
        },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("allow");
      expect(res.overwrite).toEqual({ AbsolutePath: aiceSibling });
    });

    it("redirects view_file with snake_case tool_name and tool_input", () => {
      const target = path.join(testDir, "service.ts");
      const aiceSibling = path.join(testDir, "service.ts.aice");
      fs.writeFileSync(target, "export const y = 2;");
      fs.writeFileSync(aiceSibling, "pub y := 2");

      const input = JSON.stringify({
        tool_name: "view_file",
        tool_input: { AbsolutePath: target },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("allow");
      expect(res.overwrite).toEqual({ AbsolutePath: aiceSibling });
    });

    it("redirects view_file with TargetFile or filePath parameter", () => {
      const target = path.join(testDir, "util.ts");
      const aiceSibling = path.join(testDir, "util.ts.aice");
      fs.writeFileSync(target, "export const z = 3;");
      fs.writeFileSync(aiceSibling, "pub z := 3");

      const input1 = JSON.stringify({
        toolName: "view_file",
        toolInput: { TargetFile: target },
      });
      const res1 = interceptPreToolUse(input1, testDir);
      expect(res1.decision).toBe("allow");
      expect(res1.overwrite).toEqual({ AbsolutePath: aiceSibling });

      const input2 = JSON.stringify({
        tool_name: "view_file",
        tool_input: { filePath: target },
      });
      const res2 = interceptPreToolUse(input2, testDir);
      expect(res2.decision).toBe("allow");
      expect(res2.overwrite).toEqual({ AbsolutePath: aiceSibling });
    });

    it("handles file:// URIs in path parameters", () => {
      const target = path.join(testDir, "uri_test.ts");
      const aiceSibling = path.join(testDir, "uri_test.ts.aice");
      fs.writeFileSync(target, "export const u = 4;");
      fs.writeFileSync(aiceSibling, "pub u := 4");

      const input = JSON.stringify({
        toolName: "view_file",
        toolInput: { AbsolutePath: `file://${target}` },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("allow");
      expect(res.overwrite).toEqual({ AbsolutePath: aiceSibling });
    });

    it("allows viewing .aice file directly without rewriting", () => {
      const aiceFile = path.join(testDir, "main.ts.aice");
      fs.writeFileSync(aiceFile, "pub main := 1");

      const input = JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: aiceFile },
        },
      });
      expect(interceptPreToolUse(input, testDir)).toEqual({ decision: "allow" });
    });

    it("denies replace_file_content on target file with .aice sibling (Antigravity format)", () => {
      const target = path.join(testDir, "engine.ts");
      const aiceSibling = path.join(testDir, "engine.ts.aice");
      fs.writeFileSync(target, "export const x = 1;");
      fs.writeFileSync(aiceSibling, "pub x := 1");

      const input = JSON.stringify({
        toolCall: {
          name: "replace_file_content",
          args: { TargetFile: target, ReplacementContent: "new content" },
        },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("deny");
      expect(res.reason).toContain("MANDATORY AICE SHIELD");
      expect(res.reason).toContain("engine.ts");
      expect(res.reason).toContain("engine.ts.aice");
    });

    it("denies write_to_file on target file with .aice sibling (snake_case format)", () => {
      const target = path.join(testDir, "engine.ts");
      const aiceSibling = path.join(testDir, "engine.ts.aice");
      fs.writeFileSync(target, "export const x = 1;");
      fs.writeFileSync(aiceSibling, "pub x := 1");

      const input = JSON.stringify({
        tool_name: "write_to_file",
        tool_input: { target_file: target, CodeContent: "new content" },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("deny");
      expect(res.reason).toContain("MANDATORY AICE SHIELD");
    });

    it("denies writes on shielded/locked target files even without .aice sibling on disk", () => {
      const target = path.join(testDir, "locked.ts");
      fs.writeFileSync(target, "const locked = true;");
      lockFile(target);

      const input = JSON.stringify({
        toolName: "write_to_file",
        toolInput: { TargetFile: target },
      });
      const res = interceptPreToolUse(input, testDir);
      expect(res.decision).toBe("deny");
      expect(res.reason).toContain("MANDATORY AICE SHIELD");
    });

    it("allows writes directly to .aice source files", () => {
      const aiceFile = path.join(testDir, "engine.ts.aice");
      fs.writeFileSync(aiceFile, "pub x := 1");

      const input = JSON.stringify({
        toolCall: {
          name: "replace_file_content",
          args: { TargetFile: aiceFile, ReplacementContent: "pub x := 2" },
        },
      });
      expect(interceptPreToolUse(input, testDir)).toEqual({ decision: "allow" });
    });

    it("allows writes to non-shielded, unlocked files without .aice sibling", () => {
      const target = path.join(testDir, "scratchpad.ts");
      fs.writeFileSync(target, "const s = 1;");

      const input = JSON.stringify({
        toolName: "replace_file_content",
        toolInput: { TargetFile: target },
      });
      expect(interceptPreToolUse(input, testDir)).toEqual({ decision: "allow" });
    });
  });

  describe("aice shield intercept CLI subcommand", () => {
    it("redirects view_file via CLI stdin", () => {
      const target = path.join(testDir, "app.ts");
      const aiceSibling = path.join(testDir, "app.ts.aice");
      fs.writeFileSync(target, "export const app = 1;");
      fs.writeFileSync(aiceSibling, "pub app := 1");

      const payload = JSON.stringify({
        toolCall: {
          name: "view_file",
          args: { AbsolutePath: target },
        },
      });

      const res = runCli(["shield", "intercept", testDir], { input: payload });
      expect(res.status).toBe(0);
      const output = JSON.parse(res.stdout);
      expect(output.decision).toBe("allow");
      expect(output.overwrite).toEqual({ AbsolutePath: aiceSibling });
    });

    it("denies replace_file_content via CLI stdin with camelCase payload", () => {
      const target = path.join(testDir, "app.ts");
      const aiceSibling = path.join(testDir, "app.ts.aice");
      fs.writeFileSync(target, "export const app = 1;");
      fs.writeFileSync(aiceSibling, "pub app := 1");

      const payload = JSON.stringify({
        toolName: "replace_file_content",
        toolInput: { TargetFile: target },
      });

      const res = runCli(["shield", "intercept", testDir], { input: payload });
      expect(res.status).toBe(0);
      const output = JSON.parse(res.stdout);
      expect(output.decision).toBe("deny");
      expect(output.reason).toContain("MANDATORY AICE SHIELD");
      expect(output.reason).toContain("app.ts.aice");
    });

    it("denies write_to_file via CLI stdin with snake_case payload", () => {
      const target = path.join(testDir, "app.ts");
      const aiceSibling = path.join(testDir, "app.ts.aice");
      fs.writeFileSync(target, "export const app = 1;");
      fs.writeFileSync(aiceSibling, "pub app := 1");

      const payload = JSON.stringify({
        tool_name: "write_to_file",
        tool_input: { target_file: target },
      });

      const res = runCli(["shield", "intercept", testDir], { input: payload });
      expect(res.status).toBe(0);
      const output = JSON.parse(res.stdout);
      expect(output.decision).toBe("deny");
      expect(output.reason).toContain("MANDATORY AICE SHIELD");
    });

    it("returns allow for non-shielded file via CLI stdin", () => {
      const target = path.join(testDir, "readme.md");
      fs.writeFileSync(target, "# Readme");

      const payload = JSON.stringify({
        tool_name: "view_file",
        tool_input: { AbsolutePath: target },
      });

      const res = runCli(["shield", "intercept", testDir], { input: payload });
      expect(res.status).toBe(0);
      const output = JSON.parse(res.stdout);
      expect(output.decision).toBe("allow");
      expect(output.overwrite).toBeUndefined();
    });

    it("handles empty stdin gracefully via CLI", () => {
      const res = runCli(["shield", "intercept", testDir], { input: "" });
      expect(res.status).toBe(0);
      const output = JSON.parse(res.stdout);
      expect(output.decision).toBe("allow");
    });
  });
});

