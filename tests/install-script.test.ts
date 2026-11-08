import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const INSTALL_SCRIPT = path.resolve(process.cwd(), "install.sh");

describe("Phase 2: Universal Linux Installer (install.sh)", () => {
  it("exists, is executable, and passes bash -n syntax validation", () => {
    expect(fs.existsSync(INSTALL_SCRIPT)).toBe(true);
    const stat = fs.statSync(INSTALL_SCRIPT);
    expect(stat.mode & 0o111).toBeGreaterThan(0);

    const syntaxRes = spawnSync("bash", ["-n", INSTALL_SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(syntaxRes.status).toBe(0);
    expect(syntaxRes.stderr).toBe("");
  });

  it("supports --help and --dry-run --no-cheatsheet without mutating disk", () => {
    const helpRes = spawnSync(INSTALL_SCRIPT, ["--help"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(helpRes.status).toBe(0);
    expect(helpRes.stdout).toContain("Usage: ./install.sh [options]");
    expect(helpRes.stdout).toContain("--no-cheatsheet");
    expect(helpRes.stdout).toContain("--no-agents");
    expect(helpRes.stdout).toContain("--dry-run");

    const dryRunRes = spawnSync(INSTALL_SCRIPT, ["--dry-run", "--no-cheatsheet"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(dryRunRes.status).toBe(0);
    expect(dryRunRes.stdout).toContain("Detected OS:");
    expect(dryRunRes.stdout).toContain("Prerequisites verified:");
    expect(dryRunRes.stdout).toContain("Installing npm dependencies");
    expect(dryRunRes.stdout).toContain("Skipping Zsh startup cheatsheet");
    expect(dryRunRes.stdout).toContain("[dry-run] /home/forart/.local/bin/aice agents setup");
    expect(dryRunRes.stdout).toContain("AICE installation complete!");
  });
});
