/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit Test Suite for Unified Project Configuration (Step 14).
 * Tests `loadProjectConfig`, `saveProjectConfig`, `autoDetectProjectMode`,
 * and `resolveTargetOutputPathForConfig` across side-by-side and isolated workspaces.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  type AilProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  autoDetectProjectMode,
  deriveTargetFilename,
  getExtensionForTarget,
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
  saveProjectConfig,
  stripJsonComments,
  validateConfig,
} from "../../src/config/index.js";

describe("Step 14: Unified Project Configuration (AilProjectConfig)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "ail-config-test-"));
  });

  afterEach(() => {
    if (fs.existsSync(tmpDir)) {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    }
  });

  describe("Utility & Validation Functions", () => {
    it("returns correct file extensions for each TargetLanguage", () => {
      expect(getExtensionForTarget("typescript")).toBe(".ts");
      expect(getExtensionForTarget("tsx")).toBe(".tsx");
      expect(getExtensionForTarget("python")).toBe(".py");
      expect(getExtensionForTarget("rust")).toBe(".rs");
      expect(getExtensionForTarget("go")).toBe(".go");
      expect(getExtensionForTarget("cpp")).toBe(".cpp");
      expect(getExtensionForTarget("csharp")).toBe(".cs");
      expect(getExtensionForTarget("html")).toBe(".html");
      expect(getExtensionForTarget("css")).toBe(".css");
    });

    it("derives target filename for dual-extension and bare .ail files", () => {
      expect(deriveTargetFilename("App.tsx.ail")).toBe("App.tsx");
      expect(deriveTargetFilename("calc.ts.ail")).toBe("calc.ts");
      expect(deriveTargetFilename("model.py.ail")).toBe("model.py");
      expect(deriveTargetFilename("lib.rs.ail")).toBe("lib.rs");
      expect(deriveTargetFilename("index.html.ail")).toBe("index.html");
      expect(deriveTargetFilename("styles.css.ail")).toBe("styles.css");

      // Bare .ail files with targetLanguage
      expect(deriveTargetFilename("calc.ail", "typescript")).toBe("calc.ts");
      expect(deriveTargetFilename("calc.ail", "python")).toBe("calc.py");
      expect(deriveTargetFilename("calc.ail", "rust")).toBe("calc.rs");
      expect(deriveTargetFilename("calc.ail", "go")).toBe("calc.go");
      expect(deriveTargetFilename("calc.ail", "cpp")).toBe("calc.cpp");
      expect(deriveTargetFilename("calc.ail", "csharp")).toBe("calc.cs");
      expect(deriveTargetFilename("calc.ail", "tsx")).toBe("calc.tsx");

      // Non-.ail file passes through
      expect(deriveTargetFilename("main.ts")).toBe("main.ts");
    });

    it("strips comments cleanly from JSON strings", () => {
      const jsonWithComments = `
        // Configuration for AIL
        {
          "mode": "isolated", /* mode setting */
          "url": "https://example.com/api", // preserve URLs with slashes
          "watermark": true
        }
      `;
      const stripped = stripJsonComments(jsonWithComments);
      const parsed = JSON.parse(stripped);
      expect(parsed.mode).toBe("isolated");
      expect(parsed.url).toBe("https://example.com/api");
      expect(parsed.watermark).toBe(true);
    });

    it("validates valid configuration without throwing", () => {
      expect(() =>
        validateConfig({
          mode: "isolated",
          isolated: true,
          sourceDir: "src",
          outDir: ".ail-build",
          targetLanguage: "typescript",
          watermark: true,
        }),
      ).not.toThrow();
    });

    it("throws errors on invalid configuration values", () => {
      // @ts-expect-error invalid mode
      expect(() => validateConfig({ mode: "invalid-mode" })).toThrow(/Invalid project mode/);
      // @ts-expect-error invalid targetLanguage
      expect(() => validateConfig({ targetLanguage: "ruby" })).toThrow(/Invalid target language/);
      // @ts-expect-error invalid sourceDir
      expect(() => validateConfig({ sourceDir: 123 })).toThrow(/Invalid sourceDir/);
      // @ts-expect-error invalid outDir
      expect(() => validateConfig({ outDir: 456 })).toThrow(/Invalid outDir/);
      // @ts-expect-error invalid isolated
      expect(() => validateConfig({ isolated: "true" })).toThrow(/Invalid isolated/);
      // @ts-expect-error invalid watermark
      expect(() => validateConfig({ watermark: "false" })).toThrow(/Invalid watermark/);

      // Inconsistent mode vs isolated
      expect(() => validateConfig({ mode: "side-by-side", isolated: true })).toThrow(
        /Inconsistent project config/,
      );
      expect(() => validateConfig({ mode: "isolated", isolated: false })).toThrow(
        /Inconsistent project config/,
      );
    });
  });

  describe("Config Loading (loadProjectConfig)", () => {
    it("loads complete config from ail.config.json", () => {
      const configData = {
        mode: "isolated",
        sourceDir: "source",
        outDir: "build-dist",
        targetLanguage: "python",
        isolated: true,
        watermark: false,
      };
      fs.writeFileSync(
        path.join(tmpDir, "ail.config.json"),
        JSON.stringify(configData, null, 2),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded).toEqual(configData);
    });

    it("loads partial config from ail.config.json and applies robust defaults", () => {
      fs.writeFileSync(
        path.join(tmpDir, "ail.config.json"),
        JSON.stringify({ mode: "isolated" }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded).toEqual({
        mode: "isolated",
        sourceDir: "src",
        outDir: ".ail-build",
        targetLanguage: "typescript",
        isolated: true,
        watermark: true,
      });
    });

    it("loads config from ail.config.json with comments", () => {
      const content = `
        // AIL Workspace Config
        {
          /* Target output settings */
          "mode": "side-by-side",
          "targetLanguage": "rust",
          "watermark": false
        }
      `;
      fs.writeFileSync(path.join(tmpDir, "ail.config.json"), content, "utf-8");

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("side-by-side");
      expect(loaded.targetLanguage).toBe("rust");
      expect(loaded.isolated).toBe(false);
      expect(loaded.watermark).toBe(false);
      expect(loaded.sourceDir).toBe("src");
      expect(loaded.outDir).toBe(".ail-build");
    });

    it("loads config from .ailrc when ail.config.json is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".ailrc"),
        JSON.stringify({ mode: "isolated", outDir: ".custom-out" }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.outDir).toBe(".custom-out");
      expect(loaded.isolated).toBe(true);
      expect(loaded.sourceDir).toBe("src");
    });

    it("loads config from package.json's 'ail' block when config files are absent", () => {
      const packageJson = {
        name: "test-pkg",
        version: "1.0.0",
        ail: {
          mode: "side-by-side",
          targetLanguage: "go",
          watermark: false,
        },
      };
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify(packageJson, null, 2),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("side-by-side");
      expect(loaded.targetLanguage).toBe("go");
      expect(loaded.watermark).toBe(false);
      expect(loaded.isolated).toBe(false);
    });

    it("prioritizes ail.config.json over .ailrc and package.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "ail.config.json"),
        JSON.stringify({ mode: "isolated", targetLanguage: "python" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, ".ailrc"),
        JSON.stringify({ mode: "side-by-side", targetLanguage: "rust" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ ail: { mode: "side-by-side", targetLanguage: "go" } }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.targetLanguage).toBe("python");
    });

    it("prioritizes .ailrc over package.json when ail.config.json is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".ailrc"),
        JSON.stringify({ mode: "isolated", targetLanguage: "rust" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ ail: { mode: "side-by-side", targetLanguage: "go" } }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.targetLanguage).toBe("rust");
    });

    it("throws helpful error when ail.config.json is malformed JSON", () => {
      fs.writeFileSync(
        path.join(tmpDir, "ail.config.json"),
        "{ unquotedKey: invalid }",
        "utf-8",
      );
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });

    it("throws helpful error when .ailrc is malformed JSON", () => {
      fs.writeFileSync(path.join(tmpDir, ".ailrc"), "{ corrupted json ...", "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });

    it("throws helpful error when package.json is malformed JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ invalid package json", "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });
  });

  describe("Mode Auto-Detection (autoDetectProjectMode)", () => {
    it("auto-detects 'isolated' when .ail-build directory exists", () => {
      fs.mkdirSync(path.join(tmpDir, ".ail-build"), { recursive: true });
      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("isolated");
      expect(config.isolated).toBe(true);
    });

    it("auto-detects 'isolated' when workspace contains bare *.ail files", () => {
      fs.mkdirSync(path.join(tmpDir, "src", "math"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.ail"), "fn main() = 0;");
      fs.writeFileSync(path.join(tmpDir, "src", "math", "calc.ail"), "fn add(a, b) = a + b;");

      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("isolated");
      expect(config.isolated).toBe(true);
    });

    it("auto-detects 'side-by-side' when workspace contains dual-extension files (*.ts.ail, *.tsx.ail)", () => {
      fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts.ail"), "export fn main() = 0;");
      fs.writeFileSync(
        path.join(tmpDir, "src", "components", "Button.tsx.ail"),
        "component Button() => <button />;",
      );

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("side-by-side");
      expect(config.isolated).toBe(false);
    });

    it("auto-detects 'side-by-side' when dual-extension files use other languages (*.py.ail, *.rs.ail)", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "calc.py.ail"), "def add(a, b): return a + b");
      fs.writeFileSync(path.join(tmpDir, "src", "lib.rs.ail"), "fn run() {}");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("auto-detects 'isolated' when bare *.ail files outnumber dual-extension *.ts.ail files", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "a.ail"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "b.ail"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "c.ts.ail"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");
    });

    it("auto-detects 'side-by-side' when dual-extension files outnumber bare *.ail files", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "a.ts.ail"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "b.ts.ail"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "c.ail"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("defaults to 'side-by-side' when directory is empty or has no .ail files", () => {
      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");

      const config = loadProjectConfig(tmpDir);
      expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
    });

    it("ignores node_modules, .git, dist, and build directories during auto-detection", () => {
      // Put bare .ail in ignored directory
      const ignoredDir = path.join(tmpDir, "node_modules", "some-dep");
      fs.mkdirSync(ignoredDir, { recursive: true });
      fs.writeFileSync(path.join(ignoredDir, "dep.ail"), "");

      // Root has dual-ext .ts.ail
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "main.ts.ail"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("applies auto-detection when config file exists but mode and isolated are omitted", () => {
      fs.mkdirSync(path.join(tmpDir, ".ail-build"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "ail.config.json"),
        JSON.stringify({ targetLanguage: "python" }),
        "utf-8",
      );

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("isolated");
      expect(config.isolated).toBe(true);
      expect(config.targetLanguage).toBe("python");
    });
  });

  describe("Target Path Resolution (resolveTargetOutputPathForConfig)", () => {
    const sbsConfig: AilProjectConfig = {
      mode: "side-by-side",
      sourceDir: "src",
      outDir: ".ail-build",
      targetLanguage: "typescript",
      isolated: false,
      watermark: true,
    };

    const isolatedConfig: AilProjectConfig = {
      mode: "isolated",
      sourceDir: "src",
      outDir: ".ail-build",
      targetLanguage: "typescript",
      isolated: true,
      watermark: true,
    };

    describe("Side-by-Side Mode", () => {
      it("resolves dual-extension files to sibling target paths", () => {
        expect(resolveTargetOutputPathForConfig("src/App.tsx.ail", sbsConfig)).toBe("src/App.tsx");
        expect(resolveTargetOutputPathForConfig("src/math/calc.ts.ail", sbsConfig)).toBe(
          "src/math/calc.ts",
        );
        expect(resolveTargetOutputPathForConfig("scripts/build.py.ail", sbsConfig)).toBe(
          "scripts/build.py",
        );
        expect(resolveTargetOutputPathForConfig("native/core.rs.ail", sbsConfig)).toBe(
          "native/core.rs",
        );
        expect(resolveTargetOutputPathForConfig("server/main.go.ail", sbsConfig)).toBe(
          "server/main.go",
        );
        expect(resolveTargetOutputPathForConfig("cpp/engine.cpp.ail", sbsConfig)).toBe(
          "cpp/engine.cpp",
        );
        expect(resolveTargetOutputPathForConfig("dotnet/App.cs.ail", sbsConfig)).toBe(
          "dotnet/App.cs",
        );
        expect(resolveTargetOutputPathForConfig("public/index.html.ail", sbsConfig)).toBe(
          "public/index.html",
        );
        expect(resolveTargetOutputPathForConfig("styles/main.css.ail", sbsConfig)).toBe(
          "styles/main.css",
        );
      });

      it("resolves bare *.ail files to sibling paths using config.targetLanguage", () => {
        expect(resolveTargetOutputPathForConfig("src/math.ail", sbsConfig)).toBe("src/math.ts");
        expect(
          resolveTargetOutputPathForConfig("src/calc.ail", {
            ...sbsConfig,
            targetLanguage: "python",
          }),
        ).toBe("src/calc.py");
        expect(
          resolveTargetOutputPathForConfig("src/lib.ail", {
            ...sbsConfig,
            targetLanguage: "rust",
          }),
        ).toBe("src/lib.rs");
      });

      it("resolves bare root files to sibling paths in current directory", () => {
        expect(resolveTargetOutputPathForConfig("index.ts.ail", sbsConfig)).toBe("index.ts");
        expect(resolveTargetOutputPathForConfig("main.ail", sbsConfig)).toBe("main.ts");
      });

      it("preserves absolute paths for sibling resolution in side-by-side mode", () => {
        const absPath = "/workspace/project/src/math/calc.ts.ail";
        expect(resolveTargetOutputPathForConfig(absPath, sbsConfig)).toBe(
          "/workspace/project/src/math/calc.ts",
        );
      });

      it("passes through non-.ail files as siblings", () => {
        expect(resolveTargetOutputPathForConfig("src/math.ts", sbsConfig)).toBe("src/math.ts");
      });
    });

    describe("Isolated Mode", () => {
      it("mirrors relative path from sourceDir into outDir (.ail-build/)", () => {
        expect(resolveTargetOutputPathForConfig("src/math/calc.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "math", "calc.ts"),
        );
        expect(resolveTargetOutputPathForConfig("src/index.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "index.ts"),
        );
      });

      it("mirrors dual-extension files into outDir preserving target extension", () => {
        expect(
          resolveTargetOutputPathForConfig("src/components/Button.tsx.ail", isolatedConfig),
        ).toBe(path.join(".ail-build", "components", "Button.tsx"));
        expect(resolveTargetOutputPathForConfig("src/math/calc.ts.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "math", "calc.ts"),
        );
        expect(resolveTargetOutputPathForConfig("src/scripts/run.py.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "scripts", "run.py"),
        );
      });

      it("mirrors bare *.ail with non-default targetLanguage into outDir", () => {
        const pyIsolatedConfig: AilProjectConfig = {
          ...isolatedConfig,
          targetLanguage: "python",
        };
        expect(resolveTargetOutputPathForConfig("src/math/calc.ail", pyIsolatedConfig)).toBe(
          path.join(".ail-build", "math", "calc.py"),
        );
      });

      it("mirrors absolute source path into absolute outDir with projectRoot", () => {
        const projectRoot = "/home/user/project";
        const absSourcePath = "/home/user/project/src/math/calc.ail";
        const targetPath = resolveTargetOutputPathForConfig(
          absSourcePath,
          isolatedConfig,
          projectRoot,
        );
        expect(targetPath).toBe(path.resolve("/home/user/project/.ail-build/math/calc.ts"));
      });

      it("mirrors absolute source path into absolute outDir when projectRoot is omitted", () => {
        const absSourcePath = "/workspace/my-app/src/utils/format.ail";
        const targetPath = resolveTargetOutputPathForConfig(absSourcePath, isolatedConfig);
        expect(targetPath).toBe(path.resolve("/workspace/my-app/.ail-build/utils/format.ts"));
      });

      it("handles custom sourceDir and outDir properly", () => {
        const customConfig: AilProjectConfig = {
          mode: "isolated",
          sourceDir: "lib",
          outDir: "dist-ail",
          targetLanguage: "rust",
          isolated: true,
          watermark: true,
        };
        expect(resolveTargetOutputPathForConfig("lib/core/engine.ail", customConfig)).toBe(
          path.join("dist-ail", "core", "engine.rs"),
        );
      });

      it("handles root sourceDir ('.') mirroring into outDir", () => {
        const rootSourceConfig: AilProjectConfig = {
          mode: "isolated",
          sourceDir: ".",
          outDir: ".ail-build",
          targetLanguage: "typescript",
          isolated: true,
          watermark: true,
        };
        expect(resolveTargetOutputPathForConfig("src/math/calc.ail", rootSourceConfig)).toBe(
          path.join(".ail-build", "src", "math", "calc.ts"),
        );
      });

      it("handles files outside sourceDir cleanly", () => {
        expect(resolveTargetOutputPathForConfig("tests/unit/calc.test.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "tests", "unit", "calc.test.ts"),
        );
      });

      it("handles normalized leading './' prefix in relative paths", () => {
        expect(resolveTargetOutputPathForConfig("./src/math/calc.ail", isolatedConfig)).toBe(
          path.join(".ail-build", "math", "calc.ts"),
        );
      });
    });
  });

  describe("Config Saving & Roundtripping (saveProjectConfig)", () => {
    it("creates ail.config.json with formatted JSON", () => {
      const config: AilProjectConfig = {
        mode: "isolated",
        sourceDir: "source",
        outDir: ".dist",
        targetLanguage: "python",
        isolated: true,
        watermark: false,
      };

      const saved = saveProjectConfig(tmpDir, config);
      expect(saved).toEqual(config);

      const filePath = path.join(tmpDir, "ail.config.json");
      expect(fs.existsSync(filePath)).toBe(true);

      const raw = fs.readFileSync(filePath, "utf-8");
      expect(raw.endsWith("\n")).toBe(true);
      const parsed = JSON.parse(raw);
      expect(parsed).toEqual(config);
    });

    it("creates missing directories if projectDir does not exist", () => {
      const nestedDir = path.join(tmpDir, "nested", "sub", "project");
      const saved = saveProjectConfig(nestedDir, { mode: "isolated" });
      expect(saved.mode).toBe("isolated");
      expect(fs.existsSync(path.join(nestedDir, "ail.config.json"))).toBe(true);
    });

    it("roundtrips configuration perfectly (save -> load)", () => {
      const config: AilProjectConfig = {
        mode: "isolated",
        sourceDir: "source",
        outDir: ".build-out",
        targetLanguage: "rust",
        isolated: true,
        watermark: false,
      };

      saveProjectConfig(tmpDir, config);
      const loaded = loadProjectConfig(tmpDir);
      expect(loaded).toEqual(config);
    });

    it("synchronizes isolated: true when mode is 'isolated'", () => {
      saveProjectConfig(tmpDir, { mode: "isolated" });
      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.isolated).toBe(true);
    });

    it("synchronizes mode: 'isolated' when isolated: true is provided", () => {
      saveProjectConfig(tmpDir, { isolated: true });
      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.isolated).toBe(true);
    });

    it("synchronizes isolated: false when mode is 'side-by-side'", () => {
      saveProjectConfig(tmpDir, { mode: "side-by-side" });
      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("side-by-side");
      expect(loaded.isolated).toBe(false);
    });

    it("merges incrementally with existing ail.config.json", () => {
      saveProjectConfig(tmpDir, {
        mode: "side-by-side",
        targetLanguage: "python",
      });

      // Second save updates targetLanguage and watermark
      saveProjectConfig(tmpDir, {
        targetLanguage: "rust",
        watermark: false,
      });

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("side-by-side");
      expect(loaded.targetLanguage).toBe("rust");
      expect(loaded.watermark).toBe(false);
      expect(loaded.sourceDir).toBe("src");
      expect(loaded.outDir).toBe(".ail-build");
      expect(loaded.isolated).toBe(false);
    });

    it("throws validation error on invalid configuration during save", () => {
      // @ts-expect-error invalid mode
      expect(() => saveProjectConfig(tmpDir, { mode: "bad-mode" })).toThrow(
        /Invalid project mode/,
      );
    });
  });
});
