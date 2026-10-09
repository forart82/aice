/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for AI Exclusion & Cognitive Shield Generator (Step 4).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AGENT_IGNORE_FILES,
  applyAiShield,
  checkAiShieldStatus,
  DEFAULT_EXTENSIONS,
  removeAiShield,
  SHIELD_END_MARKER,
  SHIELD_START_MARKER,
} from "../../src/shield/index.js";

describe("Step 4: AI Exclusion & Cognitive Shield Generator", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-shield-test-"));
  });

  afterEach(() => {
    try {
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("applyAiShield on empty directory", () => {
    it("creates all shield files with correct configurations", async () => {
      const result = await applyAiShield(testDir);

      expect(result.createdFiles).toHaveLength(7);
      expect(result.modifiedFiles).toHaveLength(0);
      expect(result.activeShields).toEqual(["ideSettings", "agentIgnores", "cognitiveRules"]);

      // 1. Verify .vscode/settings.json
      const settingsPath = path.join(testDir, ".vscode", "settings.json");
      expect(fs.existsSync(settingsPath)).toBe(true);
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(settings["files.exclude"]).toBeDefined();
      expect(settings["search.exclude"]).toBeDefined();

      for (const ext of DEFAULT_EXTENSIONS) {
        expect(settings["files.exclude"][`**/*${ext}`]).toEqual({
          when: `$(basename)${ext}.ail`,
        });
        expect(settings["search.exclude"][`**/*${ext}`]).toEqual({
          when: `$(basename)${ext}.ail`,
        });
      }

      // 2. Verify Agent Ignore Files
      for (const ignoreFile of AGENT_IGNORE_FILES) {
        const ignorePath = path.join(testDir, ignoreFile);
        expect(fs.existsSync(ignorePath)).toBe(true);
        const content = fs.readFileSync(ignorePath, "utf-8");
        expect(content).toContain(SHIELD_START_MARKER);
        expect(content).toContain(SHIELD_END_MARKER);
        expect(content).toContain("!*.ail");
        expect(content).toContain("!*.trivia.json");
        for (const ext of DEFAULT_EXTENSIONS) {
          expect(content).toContain(`*${ext}`);
        }
      }

      // 3. Verify Cognitive Rule Files
      const agentsMdPath = path.join(testDir, "AGENTS.md");
      expect(fs.existsSync(agentsMdPath)).toBe(true);
      const agentsMdContent = fs.readFileSync(agentsMdPath, "utf-8");
      expect(agentsMdContent).toContain("AIL (*.ail)");
      expect(agentsMdContent).toContain("machine-generated, read-only build artifacts");
      expect(agentsMdContent).toContain("ail compile");

      const cursorRulesPath = path.join(testDir, ".cursorrules");
      expect(fs.existsSync(cursorRulesPath)).toBe(true);
      const cursorRulesContent = fs.readFileSync(cursorRulesPath, "utf-8");
      expect(cursorRulesContent).toContain("AIL (*.ail)");
      expect(cursorRulesContent).toContain("machine-generated read-only build artifacts");
    });

    it("respects custom extensions option", async () => {
      const customExts = [".ts", ".py", ".cpp"];
      const result = await applyAiShield(testDir, { extensions: customExts });

      expect(result.createdFiles).toHaveLength(7);

      const settingsPath = path.join(testDir, ".vscode", "settings.json");
      const settings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

      for (const ext of customExts) {
        expect(settings["files.exclude"][`**/*${ext}`]).toEqual({
          when: `$(basename)${ext}.ail`,
        });
      }
      expect(settings["files.exclude"]["**/*.css"]).toBeUndefined();

      const cursorIgnoreContent = fs.readFileSync(path.join(testDir, ".cursorignore"), "utf-8");
      expect(cursorIgnoreContent).toContain("*.ts");
      expect(cursorIgnoreContent).toContain("*.py");
      expect(cursorIgnoreContent).toContain("*.cpp");
      expect(cursorIgnoreContent).not.toContain("*.css");
    });
  });

  describe("Idempotency", () => {
    it("calling applyAiShield multiple times does not duplicate content or corrupt JSON", async () => {
      const firstResult = await applyAiShield(testDir);
      expect(firstResult.createdFiles).toHaveLength(7);
      expect(firstResult.modifiedFiles).toHaveLength(0);

      const settingsContent1 = fs.readFileSync(
        path.join(testDir, ".vscode", "settings.json"),
        "utf-8",
      );
      const cursorIgnoreContent1 = fs.readFileSync(path.join(testDir, ".cursorignore"), "utf-8");
      const agentsMdContent1 = fs.readFileSync(path.join(testDir, "AGENTS.md"), "utf-8");

      // Second run
      const secondResult = await applyAiShield(testDir);
      expect(secondResult.createdFiles).toHaveLength(0);
      expect(secondResult.modifiedFiles).toHaveLength(0);
      expect(secondResult.activeShields).toEqual(["ideSettings", "agentIgnores", "cognitiveRules"]);

      const settingsContent2 = fs.readFileSync(
        path.join(testDir, ".vscode", "settings.json"),
        "utf-8",
      );
      const cursorIgnoreContent2 = fs.readFileSync(path.join(testDir, ".cursorignore"), "utf-8");
      const agentsMdContent2 = fs.readFileSync(path.join(testDir, "AGENTS.md"), "utf-8");

      expect(settingsContent2).toBe(settingsContent1);
      expect(cursorIgnoreContent2).toBe(cursorIgnoreContent1);
      expect(agentsMdContent2).toBe(agentsMdContent1);

      // Verify no duplicate markers in ignore files
      const occurrences = (cursorIgnoreContent2.match(/# >>> AIL-SHIELD-START >>>/g) || []).length;
      expect(occurrences).toBe(1);

      // Verify valid JSON
      expect(() => JSON.parse(settingsContent2)).not.toThrow();
    });
  });

  describe("Non-destructive merge", () => {
    it("preserves pre-existing user settings in .vscode/settings.json", async () => {
      const vscodeDir = path.join(testDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      const settingsPath = path.join(vscodeDir, "settings.json");

      const initialSettings = {
        "editor.fontSize": 14,
        "editor.tabSize": 2,
        "files.exclude": {
          "**/.git": true,
          "**/dist": true,
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(initialSettings, null, 2), "utf-8");

      const result = await applyAiShield(testDir);

      expect(result.createdFiles.some((f) => f.endsWith("settings.json"))).toBe(false);
      expect(result.modifiedFiles.some((f) => f.endsWith("settings.json"))).toBe(true);

      const updatedSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));

      // Preserves original user keys
      expect(updatedSettings["editor.fontSize"]).toBe(14);
      expect(updatedSettings["editor.tabSize"]).toBe(2);
      expect(updatedSettings["files.exclude"]["**/.git"]).toBe(true);
      expect(updatedSettings["files.exclude"]["**/dist"]).toBe(true);

      // Injects AIL shields
      expect(updatedSettings["files.exclude"]["**/*.ts"]).toEqual({
        when: "$(basename).ts.ail",
      });
      expect(updatedSettings["search.exclude"]["**/*.ts"]).toEqual({
        when: "$(basename).ts.ail",
      });
    });

    it("preserves pre-existing user rules in agent ignore files and AGENTS.md", async () => {
      const cursorIgnorePath = path.join(testDir, ".cursorignore");
      fs.writeFileSync(cursorIgnorePath, "node_modules/\nbuild/\n.env\n", "utf-8");

      const agentsMdPath = path.join(testDir, "AGENTS.md");
      fs.writeFileSync(
        agentsMdPath,
        "# Original Project Instructions\nAlways write clean tests.\n",
        "utf-8",
      );

      const result = await applyAiShield(testDir);

      expect(result.modifiedFiles.some((f) => f.endsWith(".cursorignore"))).toBe(true);
      expect(result.modifiedFiles.some((f) => f.endsWith("AGENTS.md"))).toBe(true);

      const updatedCursorIgnore = fs.readFileSync(cursorIgnorePath, "utf-8");
      expect(updatedCursorIgnore).toContain("node_modules/");
      expect(updatedCursorIgnore).toContain("build/");
      expect(updatedCursorIgnore).toContain(".env");
      expect(updatedCursorIgnore).toContain(SHIELD_START_MARKER);

      const updatedAgentsMd = fs.readFileSync(agentsMdPath, "utf-8");
      expect(updatedAgentsMd).toContain("# Original Project Instructions");
      expect(updatedAgentsMd).toContain("Always write clean tests.");
      expect(updatedAgentsMd).toContain("AIL (*.ail)");
    });
  });

  describe("removeAiShield", () => {
    it("cleanly removes files created solely for AIL and cleans up empty .vscode directory", async () => {
      await applyAiShield(testDir);

      const statusBefore = await checkAiShieldStatus(testDir);
      expect(statusBefore.isActive).toBe(true);

      const removeResult = await removeAiShield(testDir);

      expect(removeResult.removedFiles).toHaveLength(7);
      expect(removeResult.revertedFiles).toHaveLength(0);

      expect(fs.existsSync(path.join(testDir, ".vscode", "settings.json"))).toBe(false);
      expect(fs.existsSync(path.join(testDir, ".vscode"))).toBe(false);

      for (const ignoreFile of AGENT_IGNORE_FILES) {
        expect(fs.existsSync(path.join(testDir, ignoreFile))).toBe(false);
      }

      expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(false);
      expect(fs.existsSync(path.join(testDir, ".cursorrules"))).toBe(false);

      const statusAfter = await checkAiShieldStatus(testDir);
      expect(statusAfter.isActive).toBe(false);
    });

    it("reverts pre-existing user settings and rules intact without deleting files", async () => {
      // 1. Seed existing files
      const vscodeDir = path.join(testDir, ".vscode");
      fs.mkdirSync(vscodeDir, { recursive: true });
      const settingsPath = path.join(vscodeDir, "settings.json");
      const userSettings = {
        "editor.fontSize": 14,
        "files.exclude": {
          "**/.git": true,
        },
      };
      fs.writeFileSync(settingsPath, JSON.stringify(userSettings, null, 2), "utf-8");

      const cursorIgnorePath = path.join(testDir, ".cursorignore");
      fs.writeFileSync(cursorIgnorePath, "node_modules/\ndist/\n", "utf-8");

      const agentsMdPath = path.join(testDir, "AGENTS.md");
      fs.writeFileSync(agentsMdPath, "# User Docs\nProject overview.\n", "utf-8");

      // 2. Apply shield
      await applyAiShield(testDir);

      // 3. Remove shield
      const removeResult = await removeAiShield(testDir);

      expect(removeResult.revertedFiles.some((f) => f.endsWith("settings.json"))).toBe(true);
      expect(removeResult.revertedFiles.some((f) => f.endsWith(".cursorignore"))).toBe(true);
      expect(removeResult.revertedFiles.some((f) => f.endsWith("AGENTS.md"))).toBe(true);

      // Check settings.json preserved user configuration
      expect(fs.existsSync(settingsPath)).toBe(true);
      const restoredSettings = JSON.parse(fs.readFileSync(settingsPath, "utf-8"));
      expect(restoredSettings["editor.fontSize"]).toBe(14);
      expect(restoredSettings["files.exclude"]["**/.git"]).toBe(true);
      expect(restoredSettings["files.exclude"]["**/*.ts"]).toBeUndefined();
      expect(restoredSettings["search.exclude"]).toBeUndefined();

      // Check .cursorignore preserved user rules
      expect(fs.existsSync(cursorIgnorePath)).toBe(true);
      const restoredCursorIgnore = fs.readFileSync(cursorIgnorePath, "utf-8");
      expect(restoredCursorIgnore).toContain("node_modules/");
      expect(restoredCursorIgnore).toContain("dist/");
      expect(restoredCursorIgnore).not.toContain(SHIELD_START_MARKER);

      // Check AGENTS.md preserved user rules
      expect(fs.existsSync(agentsMdPath)).toBe(true);
      const restoredAgentsMd = fs.readFileSync(agentsMdPath, "utf-8");
      expect(restoredAgentsMd).toContain("# User Docs");
      expect(restoredAgentsMd).not.toContain("<!-- >>> AIL-COGNITIVE-RULE-START >>> -->");
    });
  });

  describe("checkAiShieldStatus", () => {
    it("accurately reflects false states on empty directory", async () => {
      const status = await checkAiShieldStatus(testDir);

      expect(status.isActive).toBe(false);
      expect(status.ideSettingsConfigured).toBe(false);
      expect(status.agentIgnoresConfigured).toBe(false);
      expect(status.cognitiveRulesConfigured).toBe(false);

      expect(status.details[".vscode/settings.json"]).toBe(false);
      expect(status.details[".cursorignore"]).toBe(false);
      expect(status.details[".geminiignore"]).toBe(false);
      expect(status.details[".aiderignore"]).toBe(false);
      expect(status.details[".agentignore"]).toBe(false);
      expect(status.details["AGENTS.md"]).toBe(false);
      expect(status.details[".cursorrules"]).toBe(false);
    });

    it("accurately reflects true states after applyAiShield", async () => {
      await applyAiShield(testDir);
      const status = await checkAiShieldStatus(testDir);

      expect(status.isActive).toBe(true);
      expect(status.ideSettingsConfigured).toBe(true);
      expect(status.agentIgnoresConfigured).toBe(true);
      expect(status.cognitiveRulesConfigured).toBe(true);

      expect(status.details[".vscode/settings.json"]).toBe(true);
      expect(status.details[".cursorignore"]).toBe(true);
      expect(status.details[".geminiignore"]).toBe(true);
      expect(status.details[".aiderignore"]).toBe(true);
      expect(status.details[".agentignore"]).toBe(true);
      expect(status.details["AGENTS.md"]).toBe(true);
      expect(status.details[".cursorrules"]).toBe(true);
    });

    it("accurately reflects partial shield configuration", async () => {
      // Apply only ideSettings
      await applyAiShield(testDir, {
        ideSettings: true,
        agentIgnores: false,
        cognitiveRules: false,
      });

      const status = await checkAiShieldStatus(testDir);
      expect(status.isActive).toBe(true);
      expect(status.ideSettingsConfigured).toBe(true);
      expect(status.agentIgnoresConfigured).toBe(false);
      expect(status.cognitiveRulesConfigured).toBe(false);

      expect(status.details[".vscode/settings.json"]).toBe(true);
      expect(status.details[".cursorignore"]).toBe(false);
      expect(status.details["AGENTS.md"]).toBe(false);
    });
  });
});
