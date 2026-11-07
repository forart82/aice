/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * End-to-End Integration Test Suite for Side-by-Side Architecture & CLI Ergonomics (Step 7).
 * Tests `adopt`, `watch`/`dev`, `eject`, and `shield` workflows, verifying file generation,
 * AI shield containment, filesystem locks (chmod 444 / EACCES), incremental compilation,
 * and clean restoration.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { checkAiShieldStatus, isTargetLocked } from "../../src/shield/index.js";
import { type AiceWatcher, watchProject } from "../../src/watcher/index.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const cliPath = path.resolve(__dirname, "../../bin/aice.ts");

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

async function waitFor(predicate: () => boolean, timeoutMs = 3000, intervalMs = 20): Promise<void> {
  const start = Date.now();
  while (!predicate()) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(`Timeout waiting for condition after ${timeoutMs}ms`);
    }
    await new Promise((r) => setTimeout(r, intervalMs));
  }
}

describe("Step 7: Side-by-Side Architecture & CLI Ergonomics End-to-End", () => {
  let testDir: string;
  let activeWatcher: AiceWatcher | null = null;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-sbs-e2e-"));
    activeWatcher = null;

    // Create nested workspace structure
    fs.mkdirSync(path.join(testDir, "src", "math"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "styles"), { recursive: true });
    fs.mkdirSync(path.join(testDir, "public"), { recursive: true });

    // 1. TypeScript source
    fs.writeFileSync(
      path.join(testDir, "src", "math", "calculator.ts"),
      `// Calculator module
export function add(a: number, b: number): number {
  return a + b;
}

export function subtract(a: number, b: number): number {
  return a - b;
}
`,
      "utf-8",
    );

    // 2. CSS source
    fs.writeFileSync(
      path.join(testDir, "styles", "theme.css"),
      `/* Base theme styling */
body {
  margin: 0;
  padding: 0;
}
`,
      "utf-8",
    );

    // 3. HTML source
    fs.writeFileSync(
      path.join(testDir, "public", "index.html"),
      `<!-- Main page layout -->
<!DOCTYPE html>
<html>
  <head>
    <title>AICE E2E Test</title>
  </head>
  <body>
    <h1>Hello World</h1>
  </body>
</html>
`,
      "utf-8",
    );
  });

  afterEach(async () => {
    if (activeWatcher?.isWatching()) {
      await activeWatcher.stop();
      activeWatcher = null;
    }

    try {
      function makeWritable(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          try {
            fs.chmodSync(fullPath, 0o777);
          } catch {
            // ignore chmod errors during cleanup
          }
          if (entry.isDirectory()) {
            makeWritable(fullPath);
          }
        }
      }

      if (fs.existsSync(testDir)) {
        makeWritable(testDir);
        fs.rmSync(testDir, { recursive: true, force: true });
      }
    } catch {
      // ignore cleanup errors
    }
  });

  it("executes complete lifecycle: adopt -> lock -> AI modifies .aice -> watch recompile -> eject", async () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");
    const calcTrivia = path.join(testDir, "src", "math", "calculator.ts.aice.trivia.json");

    const themeCss = path.join(testDir, "styles", "theme.css");
    const themeAice = path.join(testDir, "styles", "theme.css.aice");
    const themeTrivia = path.join(testDir, "styles", "theme.css.aice.trivia.json");

    const indexHtml = path.join(testDir, "public", "index.html");
    const indexAice = path.join(testDir, "public", "index.html.aice");
    const indexTrivia = path.join(testDir, "public", "index.html.aice.trivia.json");

    // PHASE 1: aice adopt [dir]
    const adoptRes = runCli(["adopt", testDir]);
    expect(adoptRes.status).toBe(0);
    expect(adoptRes.stdout).toContain("AICE Side-by-Side Adoption Summary");
    expect(adoptRes.stdout).toContain("3 ingested");
    expect(adoptRes.stdout).toContain("AI Shield:           ✔ Active");
    expect(adoptRes.stdout).toContain("Permission Locks:    ✔ 3 target file(s) locked");

    // 1. Sibling .aice files exist, .trivia.json files do NOT exist
    expect(fs.existsSync(calcAice)).toBe(true);
    expect(fs.existsSync(calcTrivia)).toBe(false);
    expect(fs.existsSync(themeAice)).toBe(true);
    expect(fs.existsSync(themeTrivia)).toBe(false);
    expect(fs.existsSync(indexAice)).toBe(true);
    expect(fs.existsSync(indexTrivia)).toBe(false);

    // 2. AI Shield files generated
    const settingsPath = path.join(testDir, ".vscode", "settings.json");
    expect(fs.existsSync(settingsPath)).toBe(true);
    const settingsContent = fs.readFileSync(settingsPath, "utf-8");
    expect(settingsContent).toContain("files.exclude");
    expect(settingsContent).toContain("$(basename).ts.aice");

    expect(fs.existsSync(path.join(testDir, ".cursorignore"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, ".geminiignore"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, ".aiderignore"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, ".agentignore"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(true);
    expect(fs.existsSync(path.join(testDir, ".cursorrules"))).toBe(true);

    const shieldStatus = await checkAiShieldStatus(testDir);
    expect(shieldStatus.isActive).toBe(true);
    expect(shieldStatus.ideSettingsConfigured).toBe(true);
    expect(shieldStatus.agentIgnoresConfigured).toBe(true);
    expect(shieldStatus.cognitiveRulesConfigured).toBe(true);

    // 3. Target files are locked (chmod 444)
    expect(isTargetLocked(calcTs)).toBe(true);
    expect(isTargetLocked(themeCss)).toBe(true);
    expect(isTargetLocked(indexHtml)).toBe(true);

    // 4. Direct write attempts throw EACCES / error
    expect(() => {
      fs.writeFileSync(calcTs, "// direct AI edit attempt", "utf-8");
    }).toThrow();

    expect(() => {
      fs.writeFileSync(themeCss, "/* direct edit */", "utf-8");
    }).toThrow();

    // PHASE 2: AI Modifies .aice Source & Watch Daemon Recompiles
    let compileSuccess = false;
    let compiledAice = "";
    let compiledTarget = "";

    activeWatcher = await watchProject(testDir, {
      debounceMs: 25,
      lockTargets: true,
      onCompileSuccess: (aice, target) => {
        compileSuccess = true;
        compiledAice = aice;
        compiledTarget = target;
      },
    });

    expect(activeWatcher.isWatching()).toBe(true);

    // Simulate AI modifying calculator.ts.aice by appending a new function: multiply
    const updatedAiceSource = `module source

fn add(a:int, b:int) -> int = a + b

fn subtract(a:int, b:int) -> int = a - b

fn multiply(a:int, b:int) -> int = a * b
`;
    fs.writeFileSync(calcAice, updatedAiceSource, "utf-8");

    await waitFor(() => compileSuccess);
    expect(compiledAice).toBe(path.resolve(calcAice));
    expect(compiledTarget).toBe(path.resolve(calcTs));

    // Target file now contains reconstructed code with multiply
    const updatedTargetContent = fs.readFileSync(calcTs, "utf-8");
    expect(updatedTargetContent).toContain("function multiply(a: number, b: number): number");

    // Target file remains locked with chmod 444
    expect(isTargetLocked(calcTs)).toBe(true);

    await activeWatcher.stop();
    activeWatcher = null;

    // PHASE 3: aice eject [dir]
    const ejectRes = runCli(["eject", testDir]);
    expect(ejectRes.status).toBe(0);
    expect(ejectRes.stdout).toContain("AICE Eject Complete");
    expect(ejectRes.stdout).toContain("3 file(s) restored to chmod 644");
    expect(ejectRes.stdout).toContain("AI Shield:           Reverted");
    expect(ejectRes.stdout).toContain("AICE Source Files:    Preserved on disk");

    // 1. Target files are unlocked (chmod 644) and writable
    expect(isTargetLocked(calcTs)).toBe(false);
    expect(isTargetLocked(themeCss)).toBe(false);
    expect(isTargetLocked(indexHtml)).toBe(false);

    // Direct write succeeds now
    fs.writeFileSync(calcTs, `${updatedTargetContent}\n// direct write succeeds`, "utf-8");
    expect(fs.readFileSync(calcTs, "utf-8")).toContain("// direct write succeeds");

    // 2. AI Shield rules removed
    const postEjectStatus = await checkAiShieldStatus(testDir);
    expect(postEjectStatus.isActive).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".cursorignore"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".geminiignore"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(false);

    // 3. .aice files still exist because --remove-aice was not passed
    expect(fs.existsSync(calcAice)).toBe(true);
    expect(fs.existsSync(calcTrivia)).toBe(false);
  });

  it("eject --remove-aice deletes .aice files while unlocking targets", async () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");
    const calcTrivia = path.join(testDir, "src", "math", "calculator.ts.aice.trivia.json");

    // Adopt first
    const adoptRes = runCli(["adopt", testDir]);
    expect(adoptRes.status).toBe(0);
    expect(fs.existsSync(calcAice)).toBe(true);
    expect(fs.existsSync(calcTrivia)).toBe(false);
    expect(isTargetLocked(calcTs)).toBe(true);

    // Eject with --remove-aice
    const ejectRes = runCli(["eject", testDir, "--remove-aice"]);
    expect(ejectRes.status).toBe(0);
    expect(ejectRes.stdout).toContain("Deleted 3 .aice files");

    // Targets unlocked
    expect(isTargetLocked(calcTs)).toBe(false);

    // .aice deleted
    expect(fs.existsSync(calcAice)).toBe(false);
    expect(fs.existsSync(calcTrivia)).toBe(false);
    expect(fs.existsSync(path.join(testDir, "styles", "theme.css.aice"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "public", "index.html.aice"))).toBe(false);

    // Original target files remain intact
    expect(fs.existsSync(calcTs)).toBe(true);
  });

  it("adopt --dry-run calculates metrics without creating .aice files or locking targets", () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");

    const dryRes = runCli(["adopt", testDir, "--dry-run"]);
    expect(dryRes.status).toBe(0);
    expect(dryRes.stdout).toContain("[DRY-RUN] No changes were written to disk.");
    expect(dryRes.stdout).toContain("AI Shield:           💡 Simulated (--dry-run)");
    expect(dryRes.stdout).toContain("Permission Locks:    💡 Simulated (--dry-run)");

    // No files created
    expect(fs.existsSync(calcAice)).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".cursorignore"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(false);

    // Target remains unlocked
    expect(isTargetLocked(calcTs)).toBe(false);
  });

  it("adopt --no-shield skips AI shield generation while locking targets", async () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");

    const adoptRes = runCli(["adopt", testDir, "--no-shield"]);
    expect(adoptRes.status).toBe(0);
    expect(adoptRes.stdout).toContain("AI Shield:           ⊘ Skipped (--no-shield)");
    expect(adoptRes.stdout).toContain("Permission Locks:    ✔ 3 target file(s) locked");

    // .aice exists and target is locked
    expect(fs.existsSync(calcAice)).toBe(true);
    expect(isTargetLocked(calcTs)).toBe(true);

    // No shield files
    expect(fs.existsSync(path.join(testDir, ".cursorignore"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, ".geminiignore"))).toBe(false);
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(false);

    const shieldStatus = await checkAiShieldStatus(testDir);
    expect(shieldStatus.isActive).toBe(false);
  });

  it("adopt --no-lock leaves target files writable", () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");

    const adoptRes = runCli(["adopt", testDir, "--no-lock"]);
    expect(adoptRes.status).toBe(0);
    expect(adoptRes.stdout).toContain("Permission Locks:    ⊘ Skipped (--no-lock)");

    // .aice exists
    expect(fs.existsSync(calcAice)).toBe(true);

    // Target remains writable
    expect(isTargetLocked(calcTs)).toBe(false);
    expect(() => {
      fs.writeFileSync(calcTs, "// writable", "utf-8");
    }).not.toThrow();
  });

  it("adopt --overwrite re-decompiles files even if .aice exists", () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");

    // Initial adopt
    runCli(["adopt", testDir]);
    expect(fs.existsSync(calcTs)).toBe(true);
    expect(fs.existsSync(calcAice)).toBe(true);

    // Overwrite .aice with dummy content
    fs.writeFileSync(calcAice, "# dummy content\n", "utf-8");

    // Adopt without --overwrite: skips existing
    const skipRes = runCli(["adopt", testDir]);
    expect(skipRes.stdout).toContain("0 ingested, 3 skipped");
    expect(fs.readFileSync(calcAice, "utf-8")).toBe("# dummy content\n");

    // Adopt with --overwrite: forces re-decompilation
    const overwriteRes = runCli(["adopt", testDir, "--overwrite"]);
    expect(overwriteRes.stdout).toContain("3 ingested, 0 skipped");
    expect(fs.readFileSync(calcAice, "utf-8")).not.toBe("# dummy content\n");
    expect(fs.readFileSync(calcAice, "utf-8")).toContain("fn add");
  });

  it("manages shields via fine-grained shield subcommands: status, lock, unlock, remove, apply", async () => {
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");

    // Adopt with --no-lock --no-shield
    runCli(["adopt", testDir, "--no-lock", "--no-shield"]);
    expect(isTargetLocked(calcTs)).toBe(false);

    // 1. shield status
    const statusRes1 = runCli(["shield", "status", testDir]);
    expect(statusRes1.status).toBe(0);
    expect(statusRes1.stdout).toContain("Active:            ✖ NO");

    // 2. shield apply
    const applyRes = runCli(["shield", "apply", testDir]);
    expect(applyRes.status).toBe(0);
    expect(applyRes.stdout).toContain("✔ AI Shield applied");
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(true);

    // 3. shield lock
    const lockRes = runCli(["shield", "lock", testDir]);
    expect(lockRes.status).toBe(0);
    expect(lockRes.stdout).toContain("✔ Locked 3 target file(s)");
    expect(isTargetLocked(calcTs)).toBe(true);

    // 4. shield unlock
    const unlockRes = runCli(["shield", "unlock", testDir]);
    expect(unlockRes.status).toBe(0);
    expect(unlockRes.stdout).toContain("✔ Unlocked 3 target file(s)");
    expect(isTargetLocked(calcTs)).toBe(false);

    // 5. shield remove
    const removeRes = runCli(["shield", "remove", testDir]);
    expect(removeRes.status).toBe(0);
    expect(removeRes.stdout).toContain("✔ AI Shield removed");
    expect(fs.existsSync(path.join(testDir, "AGENTS.md"))).toBe(false);

    // 6. invalid action
    const invalidRes = runCli(["shield", "invalid-action", testDir]);
    expect(invalidRes.status).toBe(1);
    expect(invalidRes.stderr).toContain("Unknown shield action: 'invalid-action'");
  }, 20000);

  it("supports custom concurrency flag -c 2 during adoption", () => {
    const adoptRes = runCli(["adopt", testDir, "-c", "2"]);
    expect(adoptRes.status).toBe(0);
    expect(adoptRes.stdout).toContain("AICE Side-by-Side Adoption Summary");
    expect(adoptRes.stdout).toContain("3 ingested");
  });

  it("supports watch daemon with lockTargets: false leaving target files writable", async () => {
    runCli(["adopt", testDir, "--no-lock"]);
    const calcTs = path.join(testDir, "src", "math", "calculator.ts");
    const calcAice = path.join(testDir, "src", "math", "calculator.ts.aice");

    let compiled = false;
    activeWatcher = await watchProject(testDir, {
      debounceMs: 20,
      lockTargets: false,
      onCompileSuccess: () => {
        compiled = true;
      },
    });

    const newAice = `module source\n\nfn add(a:int, b:int) -> int = a + b + 10\n`;
    fs.writeFileSync(calcAice, newAice, "utf-8");

    await waitFor(() => compiled);
    expect(isTargetLocked(calcTs)).toBe(false);
    expect(fs.readFileSync(calcTs, "utf-8")).toContain("10");

    await activeWatcher.stop();
    activeWatcher = null;
  });

  it("exports program with adopt, watch, eject, and shield registered commands for programmatic invocation", async () => {
    const { program } = await import("../../bin/aice.ts");
    expect(program).toBeDefined();
    const commandNames = program.commands.map((c) => c.name());
    expect(commandNames).toContain("adopt");
    expect(commandNames).toContain("watch");
    expect(commandNames).toContain("eject");
    expect(commandNames).toContain("shield");

    const watchCmd = program.commands.find((c) => c.name() === "watch");
    expect(watchCmd?.aliases()).toContain("dev");
  });

  it("handles non-existent directory gracefully across subcommands", () => {
    const nonExistent = path.join(testDir, "does-not-exist");

    const adoptRes = runCli(["adopt", nonExistent]);
    expect(adoptRes.status).toBe(1);
    expect(adoptRes.stderr).toContain("Directory not found");

    const ejectRes = runCli(["eject", nonExistent]);
    expect(ejectRes.status).toBe(1);
    expect(ejectRes.stderr).toContain("Directory not found");

    const shieldRes = runCli(["shield", "status", nonExistent]);
    expect(shieldRes.status).toBe(1);
    expect(shieldRes.stderr).toContain("Directory not found");
  });
});
