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
  type AiceProjectConfig,
  DEFAULT_PROJECT_CONFIG,
  autoDetectProjectMode,
  deriveTargetFilename,
  findProjectRoot,
  getExtensionForTarget,
  loadProjectConfig,
  resolveTargetOutputPathForConfig,
  saveProjectConfig,
  setProjectIdiomsEnabled,
  stripJsonComments,
  validateConfig,
} from "../../src/config/index.js";

describe("Step 14: Unified Project Configuration (AiceProjectConfig)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-config-test-"));
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

    it("derives target filename for dual-extension and bare .aice files", () => {
      expect(deriveTargetFilename("App.tsx.aice")).toBe("App.tsx");
      expect(deriveTargetFilename("calc.ts.aice")).toBe("calc.ts");
      expect(deriveTargetFilename("model.py.aice")).toBe("model.py");
      expect(deriveTargetFilename("lib.rs.aice")).toBe("lib.rs");
      expect(deriveTargetFilename("index.html.aice")).toBe("index.html");
      expect(deriveTargetFilename("styles.css.aice")).toBe("styles.css");

      // Bare .aice files with targetLanguage
      expect(deriveTargetFilename("calc.aice", "typescript")).toBe("calc.ts");
      expect(deriveTargetFilename("calc.aice", "python")).toBe("calc.py");
      expect(deriveTargetFilename("calc.aice", "rust")).toBe("calc.rs");
      expect(deriveTargetFilename("calc.aice", "go")).toBe("calc.go");
      expect(deriveTargetFilename("calc.aice", "cpp")).toBe("calc.cpp");
      expect(deriveTargetFilename("calc.aice", "csharp")).toBe("calc.cs");
      expect(deriveTargetFilename("calc.aice", "tsx")).toBe("calc.tsx");

      // Non-.aice file passes through
      expect(deriveTargetFilename("main.ts")).toBe("main.ts");
    });

    it("strips comments cleanly from JSON strings", () => {
      const jsonWithComments = `
        // Configuration for AICE
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
          outDir: ".aice-build",
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
    it("loads complete config from aice.config.json", () => {
      const configData = {
        mode: "isolated",
        sourceDir: "source",
        outDir: "build-dist",
        targetLanguage: "python",
        isolated: true,
        watermark: false,
      };
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify(configData, null, 2),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded).toEqual(configData);
    });

    it("loads partial config from aice.config.json and applies robust defaults", () => {
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify({ mode: "isolated" }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded).toEqual({
        mode: "isolated",
        sourceDir: "src",
        outDir: ".aice-build",
        targetLanguage: "typescript",
        isolated: true,
        watermark: true,
      });
    });

    it("loads config from aice.config.json with comments", () => {
      const content = `
        // AICE Workspace Config
        {
          /* Target output settings */
          "mode": "side-by-side",
          "targetLanguage": "rust",
          "watermark": false
        }
      `;
      fs.writeFileSync(path.join(tmpDir, "aice.config.json"), content, "utf-8");

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("side-by-side");
      expect(loaded.targetLanguage).toBe("rust");
      expect(loaded.isolated).toBe(false);
      expect(loaded.watermark).toBe(false);
      expect(loaded.sourceDir).toBe("src");
      expect(loaded.outDir).toBe(".aice-build");
    });

    it("loads config from .aicerc when aice.config.json is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".aicerc"),
        JSON.stringify({ mode: "isolated", outDir: ".custom-out" }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.outDir).toBe(".custom-out");
      expect(loaded.isolated).toBe(true);
      expect(loaded.sourceDir).toBe("src");
    });

    it("loads config from package.json's 'aice' block when config files are absent", () => {
      const packageJson = {
        name: "test-pkg",
        version: "1.0.0",
        aice: {
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

    it("prioritizes aice.config.json over .aicerc and package.json", () => {
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
        JSON.stringify({ mode: "isolated", targetLanguage: "python" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, ".aicerc"),
        JSON.stringify({ mode: "side-by-side", targetLanguage: "rust" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ aice: { mode: "side-by-side", targetLanguage: "go" } }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.targetLanguage).toBe("python");
    });

    it("prioritizes .aicerc over package.json when aice.config.json is absent", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".aicerc"),
        JSON.stringify({ mode: "isolated", targetLanguage: "rust" }),
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "package.json"),
        JSON.stringify({ aice: { mode: "side-by-side", targetLanguage: "go" } }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.mode).toBe("isolated");
      expect(loaded.targetLanguage).toBe("rust");
    });

    it("throws helpful error when aice.config.json is malformed JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "aice.config.json"), "{ unquotedKey: invalid }", "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });

    it("throws helpful error when .aicerc is malformed JSON", () => {
      fs.writeFileSync(path.join(tmpDir, ".aicerc"), "{ corrupted json ...", "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });

    it("throws helpful error when package.json is malformed JSON", () => {
      fs.writeFileSync(path.join(tmpDir, "package.json"), "{ invalid package json", "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);
    });
  });

  describe("Mode Auto-Detection (autoDetectProjectMode)", () => {
    it("auto-detects 'isolated' when .aice-build directory exists", () => {
      fs.mkdirSync(path.join(tmpDir, ".aice-build"), { recursive: true });
      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("isolated");
      expect(config.isolated).toBe(true);
    });

    it("auto-detects 'isolated' when workspace contains bare *.aice files", () => {
      fs.mkdirSync(path.join(tmpDir, "src", "math"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.aice"), "fn main() = 0;");
      fs.writeFileSync(path.join(tmpDir, "src", "math", "calc.aice"), "fn add(a, b) = a + b;");

      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("isolated");
      expect(config.isolated).toBe(true);
    });

    it("auto-detects 'side-by-side' when workspace contains dual-extension files (*.ts.aice, *.tsx.aice)", () => {
      fs.mkdirSync(path.join(tmpDir, "src", "components"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "index.ts.aice"), "export fn main() = 0;");
      fs.writeFileSync(
        path.join(tmpDir, "src", "components", "Button.tsx.aice"),
        "component Button() => <button />;",
      );

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");

      const config = loadProjectConfig(tmpDir);
      expect(config.mode).toBe("side-by-side");
      expect(config.isolated).toBe(false);
    });

    it("auto-detects 'side-by-side' when dual-extension files use other languages (*.py.aice, *.rs.aice)", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "calc.py.aice"), "def add(a, b): return a + b");
      fs.writeFileSync(path.join(tmpDir, "src", "lib.rs.aice"), "fn run() {}");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("auto-detects 'isolated' when bare *.aice files outnumber dual-extension *.ts.aice files", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "a.aice"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "b.aice"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "c.ts.aice"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("isolated");
    });

    it("auto-detects 'side-by-side' when dual-extension files outnumber bare *.aice files", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "a.ts.aice"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "b.ts.aice"), "");
      fs.writeFileSync(path.join(tmpDir, "src", "c.aice"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("defaults to 'side-by-side' when directory is empty or has no .aice files", () => {
      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");

      const config = loadProjectConfig(tmpDir);
      expect(config).toEqual(DEFAULT_PROJECT_CONFIG);
    });

    it("ignores node_modules, .git, dist, and build directories during auto-detection", () => {
      // Put bare .aice in ignored directory
      const ignoredDir = path.join(tmpDir, "node_modules", "some-dep");
      fs.mkdirSync(ignoredDir, { recursive: true });
      fs.writeFileSync(path.join(ignoredDir, "dep.aice"), "");

      // Root has dual-ext .ts.aice
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(path.join(tmpDir, "src", "main.ts.aice"), "");

      expect(autoDetectProjectMode(tmpDir)).toBe("side-by-side");
    });

    it("applies auto-detection when config file exists but mode and isolated are omitted", () => {
      fs.mkdirSync(path.join(tmpDir, ".aice-build"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "aice.config.json"),
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
    const sbsConfig: AiceProjectConfig = {
      mode: "side-by-side",
      sourceDir: "src",
      outDir: ".aice-build",
      targetLanguage: "typescript",
      isolated: false,
      watermark: true,
    };

    const isolatedConfig: AiceProjectConfig = {
      mode: "isolated",
      sourceDir: "src",
      outDir: ".aice-build",
      targetLanguage: "typescript",
      isolated: true,
      watermark: true,
    };

    describe("Side-by-Side Mode", () => {
      it("resolves dual-extension files to sibling target paths", () => {
        expect(resolveTargetOutputPathForConfig("src/App.tsx.aice", sbsConfig)).toBe("src/App.tsx");
        expect(resolveTargetOutputPathForConfig("src/math/calc.ts.aice", sbsConfig)).toBe(
          "src/math/calc.ts",
        );
        expect(resolveTargetOutputPathForConfig("scripts/build.py.aice", sbsConfig)).toBe(
          "scripts/build.py",
        );
        expect(resolveTargetOutputPathForConfig("native/core.rs.aice", sbsConfig)).toBe(
          "native/core.rs",
        );
        expect(resolveTargetOutputPathForConfig("server/main.go.aice", sbsConfig)).toBe(
          "server/main.go",
        );
        expect(resolveTargetOutputPathForConfig("cpp/engine.cpp.aice", sbsConfig)).toBe(
          "cpp/engine.cpp",
        );
        expect(resolveTargetOutputPathForConfig("dotnet/App.cs.aice", sbsConfig)).toBe(
          "dotnet/App.cs",
        );
        expect(resolveTargetOutputPathForConfig("public/index.html.aice", sbsConfig)).toBe(
          "public/index.html",
        );
        expect(resolveTargetOutputPathForConfig("styles/main.css.aice", sbsConfig)).toBe(
          "styles/main.css",
        );
      });

      it("resolves bare *.aice files to sibling paths using config.targetLanguage", () => {
        expect(resolveTargetOutputPathForConfig("src/math.aice", sbsConfig)).toBe("src/math.ts");
        expect(
          resolveTargetOutputPathForConfig("src/calc.aice", {
            ...sbsConfig,
            targetLanguage: "python",
          }),
        ).toBe("src/calc.py");
        expect(
          resolveTargetOutputPathForConfig("src/lib.aice", {
            ...sbsConfig,
            targetLanguage: "rust",
          }),
        ).toBe("src/lib.rs");
      });

      it("resolves bare root files to sibling paths in current directory", () => {
        expect(resolveTargetOutputPathForConfig("index.ts.aice", sbsConfig)).toBe("index.ts");
        expect(resolveTargetOutputPathForConfig("main.aice", sbsConfig)).toBe("main.ts");
      });

      it("preserves absolute paths for sibling resolution in side-by-side mode", () => {
        const absPath = "/workspace/project/src/math/calc.ts.aice";
        expect(resolveTargetOutputPathForConfig(absPath, sbsConfig)).toBe(
          "/workspace/project/src/math/calc.ts",
        );
      });

      it("passes through non-.aice files as siblings", () => {
        expect(resolveTargetOutputPathForConfig("src/math.ts", sbsConfig)).toBe("src/math.ts");
      });
    });

    describe("Isolated Mode", () => {
      it("mirrors relative path from sourceDir into outDir (.aice-build/)", () => {
        expect(resolveTargetOutputPathForConfig("src/math/calc.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "math", "calc.ts"),
        );
        expect(resolveTargetOutputPathForConfig("src/index.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "index.ts"),
        );
      });

      it("mirrors dual-extension files into outDir preserving target extension", () => {
        expect(
          resolveTargetOutputPathForConfig("src/components/Button.tsx.aice", isolatedConfig),
        ).toBe(path.join(".aice-build", "components", "Button.tsx"));
        expect(resolveTargetOutputPathForConfig("src/math/calc.ts.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "math", "calc.ts"),
        );
        expect(resolveTargetOutputPathForConfig("src/scripts/run.py.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "scripts", "run.py"),
        );
      });

      it("mirrors bare *.aice with non-default targetLanguage into outDir", () => {
        const pyIsolatedConfig: AiceProjectConfig = {
          ...isolatedConfig,
          targetLanguage: "python",
        };
        expect(resolveTargetOutputPathForConfig("src/math/calc.aice", pyIsolatedConfig)).toBe(
          path.join(".aice-build", "math", "calc.py"),
        );
      });

      it("mirrors absolute source path into absolute outDir with projectRoot", () => {
        const projectRoot = "/home/user/project";
        const absSourcePath = "/home/user/project/src/math/calc.aice";
        const targetPath = resolveTargetOutputPathForConfig(
          absSourcePath,
          isolatedConfig,
          projectRoot,
        );
        expect(targetPath).toBe(path.resolve("/home/user/project/.aice-build/math/calc.ts"));
      });

      it("mirrors absolute source path into absolute outDir when projectRoot is omitted", () => {
        const absSourcePath = "/workspace/my-app/src/utils/format.aice";
        const targetPath = resolveTargetOutputPathForConfig(absSourcePath, isolatedConfig);
        expect(targetPath).toBe(path.resolve("/workspace/my-app/.aice-build/utils/format.ts"));
      });

      it("handles custom sourceDir and outDir properly", () => {
        const customConfig: AiceProjectConfig = {
          mode: "isolated",
          sourceDir: "lib",
          outDir: "dist-aice",
          targetLanguage: "rust",
          isolated: true,
          watermark: true,
        };
        expect(resolveTargetOutputPathForConfig("lib/core/engine.aice", customConfig)).toBe(
          path.join("dist-aice", "core", "engine.rs"),
        );
      });

      it("handles root sourceDir ('.') mirroring into outDir", () => {
        const rootSourceConfig: AiceProjectConfig = {
          mode: "isolated",
          sourceDir: ".",
          outDir: ".aice-build",
          targetLanguage: "typescript",
          isolated: true,
          watermark: true,
        };
        expect(resolveTargetOutputPathForConfig("src/math/calc.aice", rootSourceConfig)).toBe(
          path.join(".aice-build", "src", "math", "calc.ts"),
        );
      });

      it("handles files outside sourceDir cleanly", () => {
        expect(resolveTargetOutputPathForConfig("tests/unit/calc.test.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "tests", "unit", "calc.test.ts"),
        );
      });

      it("handles normalized leading './' prefix in relative paths", () => {
        expect(resolveTargetOutputPathForConfig("./src/math/calc.aice", isolatedConfig)).toBe(
          path.join(".aice-build", "math", "calc.ts"),
        );
      });
    });
  });

  describe("Config Saving & Roundtripping (saveProjectConfig)", () => {
    it("creates aice.config.json with formatted JSON", () => {
      const config: AiceProjectConfig = {
        mode: "isolated",
        sourceDir: "source",
        outDir: ".dist",
        targetLanguage: "python",
        isolated: true,
        watermark: false,
      };

      const saved = saveProjectConfig(tmpDir, config);
      expect(saved).toEqual(config);

      const filePath = path.join(tmpDir, "aice.config.json");
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
      expect(fs.existsSync(path.join(nestedDir, "aice.config.json"))).toBe(true);
    });

    it("roundtrips configuration perfectly (save -> load)", () => {
      const config: AiceProjectConfig = {
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

    it("merges incrementally with existing aice.config.json", () => {
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
      expect(loaded.outDir).toBe(".aice-build");
      expect(loaded.isolated).toBe(false);
    });

    it("throws validation error on invalid configuration during save", () => {
      // @ts-expect-error invalid mode
      expect(() => saveProjectConfig(tmpDir, { mode: "bad-mode" })).toThrow(/Invalid project mode/);
    });
  });

  describe(".aice-idioms.json Discovery, Shorthand Normalization & Persistence", () => {
    it("discovers project root via .aice-idioms.json when aice.config.json is absent", () => {
      const subDir = path.join(tmpDir, "src", "telemetry");
      fs.mkdirSync(subDir, { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, ".aice-idioms.json"),
        JSON.stringify({
          idioms: {
            $print: {
              templateAice: "givemeabigstring.out($0)",
            },
          },
        }),
        "utf-8",
      );

      expect(findProjectRoot(subDir)).toBe(path.resolve(tmpDir));
    });

    it("normalizes shorthand .aice-idioms.json entries including multi-arg $0, $1 inference", () => {
      fs.writeFileSync(
        path.join(tmpDir, ".aice-idioms.json"),
        JSON.stringify({
          idiomsEnabled: true,
          idioms: {
            $print: {
              templateAice: "givemeabigstring.out($0)",
              description: "Custom C++ string logger",
            },
            $metric: {
              template: "telemetry.record($0, $1)",
            },
            $warn: "logger.warn($0)",
          },
        }),
        "utf-8",
      );

      const loaded = loadProjectConfig(tmpDir);
      expect(loaded.idiomsEnabled).toBe(true);
      expect(loaded.idioms?.["$print"]).toEqual({
        name: "$print",
        kind: "stmt",
        params: [{ name: "$0" }],
        templateAice: "givemeabigstring.out($0)",
        occurrences: 0,
        tokensPerOccurrenceSaved: 0,
        netTokenSavings: 0,
        description: "Custom C++ string logger",
      });
      expect(loaded.idioms?.["$metric"]?.params).toEqual([{ name: "$0" }, { name: "$1" }]);
      expect(loaded.idioms?.["$metric"]?.templateAice).toBe("telemetry.record($0, $1)");
      expect(loaded.idioms?.["$warn"]?.params).toEqual([{ name: "$0" }]);
      expect(loaded.idioms?.["$warn"]?.templateAice).toBe("logger.warn($0)");
    });

    it("persists saveProjectConfig and setProjectIdiomsEnabled directly to .aice-idioms.json when standalone", () => {
      const idiomsPath = path.join(tmpDir, ".aice-idioms.json");
      fs.writeFileSync(
        idiomsPath,
        JSON.stringify({
          idioms: {
            $print: {
              templateAice: "givemeabigstring.out($0)",
            },
          },
        }),
        "utf-8",
      );

      // Update idiom template via saveProjectConfig
      const config = loadProjectConfig(tmpDir);
      saveProjectConfig(tmpDir, {
        ...config,
        idioms: {
          ...config.idioms,
          $print: {
            ...config.idioms!["$print"],
            templateAice: "givemeabigstring.warn($0)",
          },
        },
      });

      // Should update .aice-idioms.json in place without creating aice.config.json
      expect(fs.existsSync(path.join(tmpDir, "aice.config.json"))).toBe(false);
      const reloaded = loadProjectConfig(tmpDir);
      expect(reloaded.idioms?.["$print"]?.templateAice).toBe("givemeabigstring.warn($0)");

      // Toggle idioms off/on via setProjectIdiomsEnabled
      setProjectIdiomsEnabled(tmpDir, false);
      expect(loadProjectConfig(tmpDir).idiomsEnabled).toBe(false);
      setProjectIdiomsEnabled(tmpDir, true);
      expect(loadProjectConfig(tmpDir).idiomsEnabled).toBe(true);
    });
  });
});
