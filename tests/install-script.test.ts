import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { describe, expect, it } from "vitest";

const INSTALL_SCRIPT = path.resolve(process.cwd(), "install.sh");
const UNINSTALL_SCRIPT = path.resolve(process.cwd(), "uninstall.sh");

describe("Phase 2: Universal Linux Installer (install.sh) & Uninstaller (uninstall.sh)", () => {
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

  it("uninstall.sh exists, is executable, passes bash -n, and supports --help / --dry-run", () => {
    expect(fs.existsSync(UNINSTALL_SCRIPT)).toBe(true);
    const stat = fs.statSync(UNINSTALL_SCRIPT);
    expect(stat.mode & 0o111).toBeGreaterThan(0);

    const syntaxRes = spawnSync("bash", ["-n", UNINSTALL_SCRIPT], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(syntaxRes.status).toBe(0);
    expect(syntaxRes.stderr).toBe("");

    const helpRes = spawnSync(UNINSTALL_SCRIPT, ["--help"], {
      cwd: process.cwd(),
      encoding: "utf-8",
    });
    expect(helpRes.status).toBe(0);
    expect(helpRes.stdout).toContain("Usage: ./uninstall.sh [options]");
    expect(helpRes.stdout).toContain("--projects-dir");
    expect(helpRes.stdout).toContain("--keep-project-configs");
  });

  it("uninstall.sh removes all project aice.config.json files, .zshrc cheatsheet, ~/.aice, and ~/.local/bin/aice in an isolated HOME", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aice-uninstall-test-"));
    try {
      const localBin = path.join(tmpHome, ".local", "bin");
      fs.mkdirSync(localBin, { recursive: true });
      fs.writeFileSync(path.join(localBin, "aice"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });

      const aiceDir = path.join(tmpHome, ".aice", "telemetry");
      fs.mkdirSync(aiceDir, { recursive: true });
      fs.writeFileSync(path.join(aiceDir, "gains.jsonl"), "{}\n", "utf-8");

      const zshrcPath = path.join(tmpHome, ".zshrc");
      fs.writeFileSync(
        zshrcPath,
        [
          "aipl_cheatsheet() { echo aipl; }",
          "# >>> aice-cheatsheet >>>",
          "aice_cheatsheet() { echo aice; }",
          'alias aice-cheat="aice_cheatsheet"',
          "# <<< aice-cheatsheet <<<",
          "export FOO=bar",
        ].join("\n"),
        "utf-8",
      );

      const projA = path.join(tmpHome, "dev", "proj-a");
      const projB = path.join(tmpHome, "dev", "nested", "proj-b");
      const nodeModProj = path.join(tmpHome, "dev", "proj-a", "node_modules", "pkg");
      fs.mkdirSync(projA, { recursive: true });
      fs.mkdirSync(projB, { recursive: true });
      fs.mkdirSync(nodeModProj, { recursive: true });

      const cfgA = path.join(projA, "aice.config.json");
      const cfgB = path.join(projB, "aice.config.json");
      const cfgNodeMod = path.join(nodeModProj, "aice.config.json");
      fs.writeFileSync(cfgA, '{"enabled":false}\n', "utf-8");
      fs.writeFileSync(cfgB, '{"idiomsEnabled":false}\n', "utf-8");
      fs.writeFileSync(cfgNodeMod, '{"enabled":true}\n', "utf-8");

      const res = spawnSync(
        UNINSTALL_SCRIPT,
        ["--yes", "--keep-agents", "--projects-dir", path.join(tmpHome, "dev")],
        {
          cwd: process.cwd(),
          env: { ...process.env, HOME: tmpHome },
          encoding: "utf-8",
        },
      );

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("AICE uninstallation complete!");

      // Both project aice.config.json files removed, node_modules untouched
      expect(fs.existsSync(cfgA)).toBe(false);
      expect(fs.existsSync(cfgB)).toBe(false);
      expect(fs.existsSync(cfgNodeMod)).toBe(true);

      // ~/.local/bin/aice and ~/.aice removed
      expect(fs.existsSync(path.join(localBin, "aice"))).toBe(false);
      expect(fs.existsSync(path.join(tmpHome, ".aice"))).toBe(false);

      // .zshrc cheatsheet removed while preserving aipl_cheatsheet
      const updatedZshrc = fs.readFileSync(zshrcPath, "utf-8");
      expect(updatedZshrc).toContain("aipl_cheatsheet()");
      expect(updatedZshrc).toContain("export FOO=bar");
      expect(updatedZshrc).not.toContain("aice_cheatsheet");
      expect(updatedZshrc).not.toContain("# >>> aice-cheatsheet >>>");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });

  it("refreshes an existing # >>> aice-cheatsheet >>> block in ~/.zshrc even when --no-cheatsheet is passed", () => {
    const tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "aice-install-refresh-test-"));
    try {
      const zshrcPath = path.join(tmpHome, ".zshrc");
      fs.writeFileSync(
        zshrcPath,
        [
          "export FOO=1",
          "# >>> aice-cheatsheet >>>",
          "aice_cheatsheet() { echo old_banner; }",
          "# <<< aice-cheatsheet <<<",
        ].join("\n"),
        "utf-8",
      );

      const res = spawnSync(INSTALL_SCRIPT, ["--no-cheatsheet", "--no-agents"], {
        cwd: process.cwd(),
        env: { ...process.env, HOME: tmpHome },
        encoding: "utf-8",
      });
      expect(res.status).toBe(0);

      const updatedZshrc = fs.readFileSync(zshrcPath, "utf-8");
      expect(updatedZshrc).toContain("export FOO=1");
      expect(updatedZshrc).toContain("(@forart82)");
      expect(updatedZshrc).toContain("https://github.com/forart82/aice");
      expect(updatedZshrc).not.toContain("old_banner");
    } finally {
      fs.rmSync(tmpHome, { recursive: true, force: true });
    }
  });
});
