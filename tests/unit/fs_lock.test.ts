/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit tests for File-System Protection & Permission Locker (Step 5).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  findTargetFiles,
  getAilSiblingPath,
  getGeneratedBanner,
  hasAilSibling,
  isTargetLocked,
  lockFile,
  lockProjectTargets,
  unlockFile,
  unlockProjectTargets,
  withUnlockedTarget,
} from "../../src/shield/index.js";

describe("Step 5: File-System Protection & Permission Locker", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-fs-lock-test-"));
  });

  afterEach(() => {
    try {
      // Unlock all files before deletion so rmSync never fails on read-only files
      function makeWritable(dir: string): void {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          try {
            fs.chmodSync(fullPath, 0o777);
          } catch {
            // ignore
          }
          if (entry.isDirectory()) {
            makeWritable(fullPath);
          }
        }
      }
      makeWritable(testDir);
      fs.rmSync(testDir, { recursive: true, force: true });
    } catch {
      // ignore cleanup errors
    }
  });

  describe("lockFile and isTargetLocked", () => {
    it("locks a file to read-only (chmod 444) and blocks writes with EACCES", () => {
      const targetPath = path.join(testDir, "output.ts");
      fs.writeFileSync(targetPath, "const x = 1;\n", "utf-8");

      expect(isTargetLocked(targetPath)).toBe(false);

      const locked = lockFile(targetPath);
      expect(locked).toBe(true);
      expect(isTargetLocked(targetPath)).toBe(true);

      // Second lock attempt returns false because it is already locked
      expect(lockFile(targetPath)).toBe(false);

      // Writing to locked file must throw EACCES
      expect(() => {
        fs.writeFileSync(targetPath, "const x = 2;\n", "utf-8");
      }).toThrowError(/EACCES|permission denied/i);

      // Verify content was not modified
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("const x = 1;\n");
    });
  });

  describe("unlockFile", () => {
    it("unlocks a locked file and allows writes", () => {
      const targetPath = path.join(testDir, "output.ts");
      fs.writeFileSync(targetPath, "const a = 10;\n", "utf-8");

      lockFile(targetPath);
      expect(isTargetLocked(targetPath)).toBe(true);

      const unlocked = unlockFile(targetPath);
      expect(unlocked).toBe(true);
      expect(isTargetLocked(targetPath)).toBe(false);

      // Calling unlockFile again returns false because it is already unlocked
      expect(unlockFile(targetPath)).toBe(false);

      // Writing must succeed
      fs.writeFileSync(targetPath, "const a = 20;\n", "utf-8");
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("const a = 20;\n");
    });
  });

  describe("withUnlockedTarget", () => {
    it("executes write action and immediately relocks file", async () => {
      const targetPath = path.join(testDir, "service.ts");
      fs.writeFileSync(targetPath, "initial content", "utf-8");

      lockFile(targetPath);
      expect(isTargetLocked(targetPath)).toBe(true);

      const result = await withUnlockedTarget(targetPath, () => {
        // While inside action, file is writable
        expect(isTargetLocked(targetPath)).toBe(false);
        fs.writeFileSync(targetPath, "updated by compiler", "utf-8");
        return "success-result";
      });

      expect(result).toBe("success-result");
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("updated by compiler");

      // Immediately relocked upon return
      expect(isTargetLocked(targetPath)).toBe(true);

      // Direct write outside wrapper is blocked
      expect(() => {
        fs.writeFileSync(targetPath, "unauthorized edit", "utf-8");
      }).toThrowError(/EACCES|permission denied/i);
    });

    it("leaves already-writable file writable after execution", async () => {
      const targetPath = path.join(testDir, "unlocked.ts");
      fs.writeFileSync(targetPath, "writable content", "utf-8");

      expect(isTargetLocked(targetPath)).toBe(false);

      await withUnlockedTarget(targetPath, () => {
        fs.writeFileSync(targetPath, "modified content", "utf-8");
      });

      // Was writable before, remains writable after
      expect(isTargetLocked(targetPath)).toBe(false);
      fs.writeFileSync(targetPath, "further content", "utf-8");
      expect(fs.readFileSync(targetPath, "utf-8")).toBe("further content");
    });

    it("relocks target file even when action throws an Error", async () => {
      const targetPath = path.join(testDir, "critical.ts");
      fs.writeFileSync(targetPath, "safe code", "utf-8");

      lockFile(targetPath);
      expect(isTargetLocked(targetPath)).toBe(true);

      await expect(
        withUnlockedTarget(targetPath, () => {
          throw new Error("Transpilation failed midway");
        }),
      ).rejects.toThrow("Transpilation failed midway");

      // File must be relocked in finally block
      expect(isTargetLocked(targetPath)).toBe(true);

      expect(() => {
        fs.writeFileSync(targetPath, "tampered code", "utf-8");
      }).toThrowError(/EACCES|permission denied/i);
    });
  });

  describe("batch operations: lockProjectTargets and unlockProjectTargets", () => {
    it("locks and unlocks generated target files having a .ail sibling", async () => {
      const srcDir = path.join(testDir, "src");
      const distDir = path.join(testDir, "dist");
      const nodeModulesDir = path.join(testDir, "node_modules", "pkg");

      fs.mkdirSync(srcDir, { recursive: true });
      fs.mkdirSync(distDir, { recursive: true });
      fs.mkdirSync(nodeModulesDir, { recursive: true });

      // Target files with .ail siblings in src
      const f1 = path.join(srcDir, "main.ts");
      const f1Ail = path.join(srcDir, "main.ts.ail");
      fs.writeFileSync(f1, "// ts code\n");
      fs.writeFileSync(f1Ail, "# ail code\n");

      const f2 = path.join(srcDir, "script.py");
      const f2Ail = path.join(srcDir, "script.py.ail");
      fs.writeFileSync(f2, "# python code\n");
      fs.writeFileSync(f2Ail, "# ail code\n");

      const f3 = path.join(srcDir, "theme.css");
      const f3Ail = path.join(srcDir, "theme.css.ail");
      fs.writeFileSync(f3, "/* css code */\n");
      fs.writeFileSync(f3Ail, "# ail code\n");

      const f4 = path.join(srcDir, "index.html");
      const f4Ail = path.join(srcDir, "index.html.ail");
      fs.writeFileSync(f4, "<!-- html code -->\n");
      fs.writeFileSync(f4Ail, "# ail code\n");

      const f5 = path.join(srcDir, "engine.cpp");
      const f5Ail = path.join(srcDir, "engine.cpp.ail");
      fs.writeFileSync(f5, "// cpp code\n");
      fs.writeFileSync(f5Ail, "# ail code\n");

      // File with short sibling convention: component.tsx and component.ail
      const f6 = path.join(srcDir, "component.tsx");
      const f6Ail = path.join(srcDir, "component.ail");
      fs.writeFileSync(f6, "// tsx code\n");
      fs.writeFileSync(f6Ail, "# ail code\n");

      // Standalone file WITHOUT .ail sibling (must NOT be touched)
      const standalone = path.join(srcDir, "standalone.ts");
      fs.writeFileSync(standalone, "// standalone\n");

      // File in ignored directory (dist) - must NOT be touched
      const distFile = path.join(distDir, "bundle.ts");
      const distAil = path.join(distDir, "bundle.ts.ail");
      fs.writeFileSync(distFile, "// dist bundle\n");
      fs.writeFileSync(distAil, "# ail\n");

      // File in ignored directory (node_modules) - must NOT be touched
      const nmFile = path.join(nodeModulesDir, "dep.ts");
      const nmAil = path.join(nodeModulesDir, "dep.ts.ail");
      fs.writeFileSync(nmFile, "// dep\n");
      fs.writeFileSync(nmAil, "# ail\n");

      // Verify findTargetFiles finds exactly the 6 target files
      const targets = findTargetFiles(testDir);
      expect(targets).toHaveLength(6);
      expect(targets).toContain(f1);
      expect(targets).toContain(f2);
      expect(targets).toContain(f3);
      expect(targets).toContain(f4);
      expect(targets).toContain(f5);
      expect(targets).toContain(f6);
      expect(targets).not.toContain(standalone);
      expect(targets).not.toContain(distFile);
      expect(targets).not.toContain(nmFile);

      // Lock all targets
      const lockSummary = await lockProjectTargets(testDir);
      expect(lockSummary.totalChecked).toBe(6);
      expect(lockSummary.totalLocked).toBe(6);
      expect(lockSummary.totalUnlocked).toBe(0);
      expect(lockSummary.totalSkipped).toBe(0);
      expect(lockSummary.totalFailed).toBe(0);
      expect(lockSummary.results).toHaveLength(6);

      // Verify all 6 files are locked
      for (const t of targets) {
        expect(isTargetLocked(t)).toBe(true);
      }

      // Standalone file is still writable
      expect(isTargetLocked(standalone)).toBe(false);
      fs.writeFileSync(standalone, "// updated standalone\n");

      // Second lock run should skip all 6 (already locked)
      const reLockSummary = await lockProjectTargets(testDir);
      expect(reLockSummary.totalChecked).toBe(6);
      expect(reLockSummary.totalLocked).toBe(0);
      expect(reLockSummary.totalSkipped).toBe(6);
      expect(reLockSummary.totalFailed).toBe(0);

      // Unlock all targets
      const unlockSummary = await unlockProjectTargets(testDir);
      expect(unlockSummary.totalChecked).toBe(6);
      expect(unlockSummary.totalLocked).toBe(0);
      expect(unlockSummary.totalUnlocked).toBe(6);
      expect(unlockSummary.totalSkipped).toBe(0);
      expect(unlockSummary.totalFailed).toBe(0);

      // Verify all 6 files are unlocked and writable
      for (const t of targets) {
        expect(isTargetLocked(t)).toBe(false);
        fs.writeFileSync(t, "// modified\n");
        expect(fs.readFileSync(t, "utf-8")).toBe("// modified\n");
      }

      // Second unlock run should skip all 6 (already unlocked)
      const reUnlockSummary = await unlockProjectTargets(testDir);
      expect(reUnlockSummary.totalChecked).toBe(6);
      expect(reUnlockSummary.totalUnlocked).toBe(0);
      expect(reUnlockSummary.totalSkipped).toBe(6);
      expect(reUnlockSummary.totalFailed).toBe(0);
    });
  });

  describe("getGeneratedBanner", () => {
    it("produces correct comment syntax for TS, Python, CSS, HTML, C++", () => {
      const source = "src/modules/calc.ail";

      // TypeScript / TS / TSX
      expect(getGeneratedBanner("typescript", source)).toBe(
        `// @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
      expect(getGeneratedBanner("TS", source)).toBe(
        `// @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
      expect(getGeneratedBanner("tsx", source)).toBe(
        `// @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );

      // Python / py
      expect(getGeneratedBanner("python", source)).toBe(
        `# @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
      expect(getGeneratedBanner("Python", source)).toBe(
        `# @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
      expect(getGeneratedBanner("py", source)).toBe(
        `# @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );

      // CSS
      expect(getGeneratedBanner("css", source)).toBe(
        `/* @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source} */`,
      );
      expect(getGeneratedBanner("CSS", source)).toBe(
        `/* @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source} */`,
      );

      // HTML
      expect(getGeneratedBanner("html", source)).toBe(
        `<!-- @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source} -->`,
      );
      expect(getGeneratedBanner("HTML", source)).toBe(
        `<!-- @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source} -->`,
      );

      // C++ / CPP
      expect(getGeneratedBanner("cpp", source)).toBe(
        `// @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
      expect(getGeneratedBanner("C++", source)).toBe(
        `// @generated by AIL - DO NOT EDIT DIRECTLY. Source: ${source}`,
      );
    });
  });

  describe("hasAilSibling and getAilSiblingPath", () => {
    it("detects both direct and short sibling conventions", () => {
      const file1 = path.join(testDir, "test.ts");
      const file1Sibling = path.join(testDir, "test.ts.ail");
      fs.writeFileSync(file1, "content");
      fs.writeFileSync(file1Sibling, "content");

      expect(hasAilSibling(file1)).toBe(true);
      expect(getAilSiblingPath(file1)).toBe(file1Sibling);

      const file2 = path.join(testDir, "view.tsx");
      const file2Sibling = path.join(testDir, "view.ail");
      fs.writeFileSync(file2, "content");
      fs.writeFileSync(file2Sibling, "content");

      expect(hasAilSibling(file2)).toBe(true);
      expect(getAilSiblingPath(file2)).toBe(file2Sibling);

      const file3 = path.join(testDir, "orphan.ts");
      fs.writeFileSync(file3, "content");
      expect(hasAilSibling(file3)).toBe(false);
      expect(getAilSiblingPath(file3)).toBeNull();
    });
  });
});
