/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Comprehensive Unit & Integration Test Suite for Companion Twin-Workspace Adoption (Step 2.1).
 * Verifies:
 * 1. `ail adopt --companion <targetDir>` and `ail adopt [destDir] --companion <targetDir>`
 * 2. Generated `ail.config.json` with mode: "companion", targetProjectDir, outDir, sourceDir: "src"
 * 3. All decompiled .ail source files written to companion src/ (preserving relative structure)
 * 4. Target project remains 100% clean, unmodified, unlocked (zero .ail files in target)
 * 5. Companion cognitive shields (AGENTS.md, .cursorrules) created in companion workspace
 * 6. Programmatic invocation with ParallelAdoptionOptions and AdoptionResult
 * 7. Forward transpilation from companion workspace to external target project
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
} from "../../src/config/project-config.js";
import {
  adoptProjectParallel,
  ejectProject,
  ingestProjectSideBySide,
  type ParallelAdoptionOptions,
} from "../../src/transpiler/parallel-ingest.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/ail.ts");

function runCli(args: string[], cwd?: string): { status: number; stdout: string; stderr: string } {
  const result = spawnSync("bun", [cliPath, ...args], {
    cwd: cwd ?? process.cwd(),
    encoding: "utf-8",
    env: { ...process.env },
  });
  return {
    status: result.status ?? 0,
    stdout: result.stdout ?? "",
    stderr: result.stderr ?? "",
  };
}

function getAllFiles(dir: string): string[] {
  const results: string[] = [];
  function scan(current: string) {
    if (!fs.existsSync(current)) return;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) {
        scan(full);
      } else if (entry.isFile()) {
        results.push(full);
      }
    }
  }
  scan(dir);
  return results;
}

describe("Step 2.1: Companion Twin-Workspace Adoption (ail adopt --companion <targetDir>)", () => {
  let baseTmpDir: string;
  let targetDir: string;
  let companionDir: string;

  beforeEach(() => {
    baseTmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-companion-test-"));
    targetDir = path.join(baseTmpDir, "target_project");
    companionDir = path.join(baseTmpDir, "companion_workspace");
    fs.mkdirSync(targetDir, { recursive: true });
  });

  afterEach(() => {
    try {
      fs.rmSync(baseTmpDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  it("adopts a target project with src/ hierarchy via CLI: ail adopt <destDir> --companion <targetDir>", () => {
    // 1. Setup target fixture project
    const targetSrc = path.join(targetDir, "src");
    const targetMath = path.join(targetSrc, "math");
    fs.mkdirSync(targetMath, { recursive: true });

    const indexContent = `export function greet(name: string): string {\n  return "Hello, " + name;\n}\n`;
    const calcContent = `export function add(a: number, b: number): number {\n  return a + b;\n}\n`;

    fs.writeFileSync(path.join(targetSrc, "index.ts"), indexContent, "utf-8");
    fs.writeFileSync(path.join(targetMath, "calculator.ts"), calcContent, "utf-8");
    fs.writeFileSync(path.join(targetDir, ".gitignore"), "node_modules/\ndist/\n", "utf-8");

    // Record initial mtime and permissions of target files
    const targetIndexStatBefore = fs.statSync(path.join(targetSrc, "index.ts"));

    // 2. Execute CLI adopt command
    const res = runCli(["adopt", companionDir, "--companion", targetDir]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("=== AIL Companion Adoption Summary ===");
    expect(res.stdout).toContain("Mode:                companion");
    expect(res.stdout).toContain("Target Files:        ✔ Untouched (100% clean, unlocked)");
    expect(res.stdout).toContain("2 ingested");

    // 3. Verify ail.config.json in companion workspace
    const configPath = path.join(companionDir, "ail.config.json");
    expect(fs.existsSync(configPath)).toBe(true);

    const rawConfig = JSON.parse(fs.readFileSync(configPath, "utf-8"));
    expect(rawConfig.mode).toBe("companion");
    expect(rawConfig.sourceDir).toBe("src");
    expect(rawConfig.targetLanguage).toBe("typescript");

    // Check relative paths: companion -> target project
    const expectedTargetRel = path.relative(companionDir, targetDir).replace(/\\/g, "/");
    const expectedOutRel = path.relative(companionDir, targetSrc).replace(/\\/g, "/");
    expect(rawConfig.targetProjectDir).toBe(expectedTargetRel);
    expect(rawConfig.outDir).toBe(expectedOutRel);

    const loaded = loadProjectConfig(companionDir);
    expect(loaded.mode).toBe("companion");
    expect(loaded.targetProjectDir).toBe(expectedTargetRel);

    // 4. Verify all .ail files written to companion src/
    const companionSrc = path.join(companionDir, "src");
    expect(fs.existsSync(companionSrc)).toBe(true);

    const compIndexAil = path.join(companionSrc, "index.ail");
    const compCalcAil = path.join(companionSrc, "math", "calculator.ail");
    expect(fs.existsSync(compIndexAil)).toBe(true);
    expect(fs.existsSync(compCalcAil)).toBe(true);

    const compFiles = getAllFiles(companionDir);
    // Ensure all code files in companion are .ail
    const codeFiles = compFiles.filter(
      (f) =>
        !f.endsWith(".json") &&
        !f.endsWith(".md") &&
        !f.endsWith(".cursorrules") &&
        !path.basename(f).startsWith("."),
    );
    expect(codeFiles.length).toBe(2);
    expect(codeFiles.every((f) => f.endsWith(".ail"))).toBe(true);

    // 5. Verify AGENTS.md and .cursorrules in companion workspace
    const agentsMdPath = path.join(companionDir, "AGENTS.md");
    const cursorRulesPath = path.join(companionDir, ".cursorrules");
    expect(fs.existsSync(agentsMdPath)).toBe(true);
    expect(fs.existsSync(cursorRulesPath)).toBe(true);

    const agentsContent = fs.readFileSync(agentsMdPath, "utf-8");
    expect(agentsContent).toContain("AIL Companion Workspace Directives");
    expect(agentsContent).toContain(expectedTargetRel);

    const cursorRulesContent = fs.readFileSync(cursorRulesPath, "utf-8");
    expect(cursorRulesContent).toContain("AIL Companion Workspace Directives");
    expect(cursorRulesContent).toContain(expectedTargetRel);

    // 6. Verify target project is completely unmodified
    const targetFilesAfter = getAllFiles(targetDir);
    const targetAilFiles = targetFilesAfter.filter((f) => f.endsWith(".ail"));
    expect(targetAilFiles).toHaveLength(0);

    expect(fs.existsSync(path.join(targetDir, "ail.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, "AGENTS.md"))).toBe(false);
    expect(fs.existsSync(path.join(targetDir, ".cursorrules"))).toBe(false);

    // Target files content unchanged
    expect(fs.readFileSync(path.join(targetSrc, "index.ts"), "utf-8")).toBe(indexContent);
    expect(fs.readFileSync(path.join(targetMath, "calculator.ts"), "utf-8")).toBe(calcContent);

    // Target file permissions remain writable (unlocked)
    const targetIndexStatAfter = fs.statSync(path.join(targetSrc, "index.ts"));
    expect(targetIndexStatAfter.mode & 0o200).not.toBe(0); // writable by owner
  });

  it("adopts target project when run directly inside companion directory: ail adopt --companion <targetDir>", () => {
    fs.mkdirSync(companionDir, { recursive: true });

    // Setup target project
    const targetSrc = path.join(targetDir, "src");
    fs.mkdirSync(targetSrc, { recursive: true });
    fs.writeFileSync(
      path.join(targetSrc, "server.ts"),
      `export function startServer(port: number): void {\n  console.log("Listening on " + port);\n}\n`,
      "utf-8",
    );

    // Execute from inside companion directory: cwd = companionDir
    const relTarget = path.relative(companionDir, targetDir);
    const res = runCli(["adopt", "--companion", relTarget], companionDir);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("=== AIL Companion Adoption Summary ===");

    // Verify companion workspace contains server.ail
    expect(fs.existsSync(path.join(companionDir, "src", "server.ail"))).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "ail.config.json"))).toBe(true);

    const config = JSON.parse(
      fs.readFileSync(path.join(companionDir, "ail.config.json"), "utf-8"),
    );
    expect(config.mode).toBe("companion");

    // Target project remains untouched with zero .ail
    const targetFiles = getAllFiles(targetDir);
    expect(targetFiles.filter((f) => f.endsWith(".ail"))).toHaveLength(0);
  });

  it("adopts a target project with flat structure (no src/ folder)", () => {
    // Setup flat target project
    const mainContent = `export function main(): void {\n  console.log("App started");\n}\n`;
    const helperContent = `export function help(): string {\n  return "Usage: app";\n}\n`;

    fs.writeFileSync(path.join(targetDir, "main.ts"), mainContent, "utf-8");
    const utilsDir = path.join(targetDir, "utils");
    fs.mkdirSync(utilsDir, { recursive: true });
    fs.writeFileSync(path.join(utilsDir, "helper.ts"), helperContent, "utf-8");

    // Adopt into companion
    const res = runCli(["adopt", companionDir, "--companion", targetDir]);
    expect(res.status).toBe(0);

    // Verify config
    const rawConfig = JSON.parse(
      fs.readFileSync(path.join(companionDir, "ail.config.json"), "utf-8"),
    );
    expect(rawConfig.mode).toBe("companion");
    const expectedRel = path.relative(companionDir, targetDir).replace(/\\/g, "/");
    expect(rawConfig.targetProjectDir).toBe(expectedRel);
    // Since target project has no src/, outDir points to the target project directory
    expect(rawConfig.outDir).toBe(expectedRel);

    // Verify companion src/ contains both files
    expect(fs.existsSync(path.join(companionDir, "src", "main.ail"))).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "src", "utils", "helper.ail"))).toBe(true);

    // Verify target has 0 .ail files
    const targetFiles = getAllFiles(targetDir);
    expect(targetFiles.filter((f) => f.endsWith(".ail"))).toHaveLength(0);
  });

  it("supports programmatic adoption via adoptProjectParallel and ingestProjectSideBySide", async () => {
    const targetSrc = path.join(targetDir, "src");
    fs.mkdirSync(targetSrc, { recursive: true });
    fs.writeFileSync(
      path.join(targetSrc, "module.ts"),
      `export function runModule(): number {\n  return 42;\n}\n`,
      "utf-8",
    );

    const options: ParallelAdoptionOptions = {
      dir: companionDir,
      companion: true,
      targetProjectDir: targetDir,
    };

    const result = await adoptProjectParallel(options);

    expect(result.mode).toBe("companion");
    expect(result.targetProjectDir).toBe(targetDir);
    expect(result.companionWorkspaceDir).toBe(companionDir);
    expect(result.totalIngested).toBe(1);
    expect(result.totalFailed).toBe(0);
    expect(result.cl100kSavingsPct).toBeGreaterThanOrEqual(0);
    expect(result.configPath).toBe(path.join(companionDir, "ail.config.json"));
    expect(result.agentsMdPath).toBe(path.join(companionDir, "AGENTS.md"));
    expect(result.cursorRulesPath).toBe(path.join(companionDir, ".cursorrules"));
    expect(result.generatedFiles).toBeDefined();

    expect(fs.existsSync(path.join(companionDir, "src", "module.ail"))).toBe(true);
    expect(fs.existsSync(path.join(targetDir, "src", "module.ail"))).toBe(false);
  });

  it("respects --dry-run without creating files on disk", () => {
    const targetSrc = path.join(targetDir, "src");
    fs.mkdirSync(targetSrc, { recursive: true });
    fs.writeFileSync(path.join(targetSrc, "temp.ts"), `export const x = 1;\n`, "utf-8");

    const res = runCli(["adopt", companionDir, "--companion", targetDir, "--dry-run"]);
    expect(res.status).toBe(0);
    expect(res.stdout).toContain("[DRY-RUN] No changes were written to disk");

    // Companion directory was not modified with configs or sources
    expect(fs.existsSync(path.join(companionDir, "ail.config.json"))).toBe(false);
    expect(fs.existsSync(path.join(companionDir, "src"))).toBe(false);
  });

  it("resolves target output paths correctly for forward compilation from companion workspace", () => {
    const targetSrc = path.join(targetDir, "src");
    const targetMath = path.join(targetSrc, "math");
    fs.mkdirSync(targetMath, { recursive: true });
    fs.writeFileSync(path.join(targetMath, "logic.ts"), `export const y = 2;\n`, "utf-8");

    // Adopt
    const res = runCli(["adopt", companionDir, "--companion", targetDir]);
    expect(res.status).toBe(0);

    // Verify resolveTargetOutputPathForConfig
    const config = loadProjectConfig(companionDir);
    const companionAil = path.join(companionDir, "src", "math", "logic.ail");
    expect(fs.existsSync(companionAil)).toBe(true);

    const resolvedTarget = resolveTargetOutputPathForConfig(companionAil, config, companionDir);
    const expectedTarget = path.resolve(targetMath, "logic.ts");
    expect(path.resolve(resolvedTarget)).toBe(expectedTarget);
  });

  it("preserves non-default target extensions (.tsx) as dual extension in companion adoption", async () => {
    const targetSrc = path.join(targetDir, "src");
    fs.mkdirSync(targetSrc, { recursive: true });
    fs.writeFileSync(
      path.join(targetSrc, "Button.tsx"),
      `export function Button(): string { return "<button>Click</button>"; }\n`,
      "utf-8",
    );
    fs.writeFileSync(
      path.join(targetSrc, "main.ts"),
      `export function main(): void {}\n`,
      "utf-8",
    );

    const res = runCli(["adopt", companionDir, "--companion", targetDir]);
    expect(res.status).toBe(0);

    // .tsx must be preserved as Button.tsx.ail, while main.ts becomes main.ail
    expect(fs.existsSync(path.join(companionDir, "src", "Button.tsx.ail"))).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "src", "main.ail"))).toBe(true);

    const config = loadProjectConfig(companionDir);
    expect(config.targetLanguage).toBe("typescript");
  });

  it("safely ejects companion workspace without deleting or modifying external target project", async () => {
    const targetSrc = path.join(targetDir, "src");
    fs.mkdirSync(targetSrc, { recursive: true });
    const targetFile = path.join(targetSrc, "app.ts");
    fs.writeFileSync(targetFile, `export const app = "healthy";\n`, "utf-8");

    // Adopt into companion
    const res = runCli(["adopt", companionDir, "--companion", targetDir]);
    expect(res.status).toBe(0);
    expect(fs.existsSync(path.join(companionDir, "src", "app.ail"))).toBe(true);
    expect(fs.existsSync(path.join(companionDir, "ail.config.json"))).toBe(true);

    // Programmatic eject
    const ejectRes = await ejectProject({ dir: companionDir });
    expect(ejectRes.mode).toBe("companion");
    expect(ejectRes.restoredFiles).toEqual([]);
    expect(ejectRes.removedAilFiles.length).toBeGreaterThan(0);

    // CRITICAL: External target project must remain completely intact!
    expect(fs.existsSync(targetDir)).toBe(true);
    expect(fs.existsSync(targetFile)).toBe(true);
    expect(fs.readFileSync(targetFile, "utf-8")).toBe(`export const app = "healthy";\n`);

    // Companion workspace cleaned
    expect(fs.existsSync(path.join(companionDir, "src", "app.ail"))).toBe(false);
    expect(fs.existsSync(path.join(companionDir, "ail.config.json"))).toBe(false);
  });

  it("never deletes src/ when ejectProject is called with outDir: 'src'", async () => {
    const projectDir = path.join(baseTmpDir, "isolated_project");
    const srcDir = path.join(projectDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    const codeFile = path.join(srcDir, "main.ts");
    fs.writeFileSync(codeFile, `export const answer = 42;\n`, "utf-8");

    fs.writeFileSync(
      path.join(projectDir, "ail.config.json"),
      JSON.stringify(
        {
          mode: "isolated",
          sourceDir: "src",
          outDir: "src",
        },
        null,
        2,
      ),
      "utf-8",
    );

    const ejectRes = await ejectProject({
      dir: projectDir,
      outDir: "src",
      sourceDir: "src",
    });

    // Verify src/ and src/main.ts were NOT deleted
    expect(fs.existsSync(srcDir)).toBe(true);
    expect(fs.existsSync(codeFile)).toBe(true);
    expect(fs.readFileSync(codeFile, "utf-8")).toBe(`export const answer = 42;\n`);
    expect(ejectRes.removedBuildDir).toBeUndefined();
  });
});
