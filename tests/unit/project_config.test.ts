/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit Test Suite for Unified Project Configuration (Step 14).
 * Tests `loadProjectConfig`, `saveProjectConfig`, `autoDetectProjectMode`,
 * and `resolveTargetOutputPathForConfig` across side-by-side and isolated workspaces.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AICE_DIRECTIVE_START,
  type AiceProjectConfig,
  autoDetectProjectMode,
  DEFAULT_PROJECT_CONFIG,
  deriveTargetFilename,
  findAllDirectiveSpansOutsideFences,
  findProjectRoot,
  getExtensionForTarget,
  hasAgentsMdInclude,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  removeMarkdownDirective,
  resolvePathTargets,
  resolveTargetOutputPathForConfig,
  resolveWorktreeRoot,
  saveProjectConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
  stripAllMarkdownDirectives,
  stripJsonComments,
  syncProjectWorkspaceRules,
  upsertMarkdownDirective,
  validateConfig,
} from "../../src/config/index.js";
import { MANDATORY_AGENT_RULES_MARKDOWN } from "../../src/rules/mandatory-rules.js";
import {
  detectLanguageName,
  estimateTokens,
  TiktokenTokenizer,
} from "../../src/tokenomics/index.js";

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

  describe("External Directory Isolation, Path Resolution & 2-Pillar Rule Regressions", () => {
    it("does not leak disabled fallbackDir/cwd config into external temp directories without markers", () => {
      const disabledRepoDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-disabled-repo-"));
      const externalSandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-ext-sandbox-"));
      try {
        fs.writeFileSync(
          path.join(disabledRepoDir, "aice.config.json"),
          JSON.stringify({ enabled: false }),
          "utf-8",
        );
        fs.mkdirSync(path.join(disabledRepoDir, "src"), { recursive: true });

        // Inside disabledRepoDir -> resolves to disabledRepoDir (enabled: false)
        const internalRoot = findProjectRoot(
          path.join(disabledRepoDir, "src", "index.ts"),
          disabledRepoDir,
        );
        expect(internalRoot).toBe(disabledRepoDir);
        expect(isProjectAiceEnabled(internalRoot)).toBe(false);

        // External directory outside disabledRepoDir -> must NOT fall back to disabledRepoDir!
        const externalRoot = findProjectRoot(externalSandboxDir, disabledRepoDir);
        expect(externalRoot).toBe(externalSandboxDir);
        expect(isProjectAiceEnabled(externalRoot)).toBe(true);

        // Non-existent target file inside externalSandboxDir -> normalizes to parent dir
        const missingFileRoot = findProjectRoot(
          path.join(externalSandboxDir, "new_worker.ts"),
          disabledRepoDir,
        );
        expect(missingFileRoot).toBe(externalSandboxDir);
        expect(isProjectAiceEnabled(missingFileRoot)).toBe(true);

        // resolveWorktreeRoot also isolates externalSandboxDir from disabledRepoDir
        expect(resolveWorktreeRoot(externalSandboxDir, disabledRepoDir)).toBe(externalSandboxDir);
        expect(
          resolveWorktreeRoot(path.join(externalSandboxDir, "draft.aipl"), disabledRepoDir),
        ).toBe(externalSandboxDir);
      } finally {
        fs.rmSync(disabledRepoDir, { recursive: true, force: true });
        fs.rmSync(externalSandboxDir, { recursive: true, force: true });
      }
    });

    it("preserves fallbackDir when startDir is a nested subdirectory inside fallbackDir without markers", () => {
      const nestedDir = path.join(tmpDir, "packages", "sub", "deep");
      fs.mkdirSync(nestedDir, { recursive: true });

      expect(findProjectRoot(nestedDir, tmpDir)).toBe(tmpDir);
      expect(resolveWorktreeRoot(nestedDir, tmpDir)).toBe(tmpDir);
    });

    it("resolves relative paths against explicit external options.projectRoot even when cwd has matching names", () => {
      const extSrcDir = path.join(tmpDir, "src");
      fs.mkdirSync(extSrcDir, { recursive: true });
      const extFile = path.join(extSrcDir, "external.ts");
      fs.writeFileSync(extFile, "export const external = 1;\n", "utf-8");

      // Note: process.cwd() (the AICE repo) also has a "src" directory!
      const dirResolved = resolvePathTargets("src", {
        projectRoot: tmpDir,
        includeTargets: true,
      });
      expect(dirResolved.isDirectory).toBe(true);
      expect(dirResolved.resolvedPath).toBe(extSrcDir);
      expect(dirResolved.projectRoot).toBe(tmpDir);
      expect(dirResolved.files).toEqual([extFile]);

      const missingRelFile = resolvePathTargets("src/brand_new.ts", {
        projectRoot: tmpDir,
      });
      expect(missingRelFile.isSingleFile).toBe(true);
      expect(missingRelFile.resolvedPath).toBe(path.join(extSrcDir, "brand_new.ts"));
      expect(missingRelFile.projectRoot).toBe(tmpDir);
    });

    it("rejects non-object root JSON values in aice.config.json and .aicerc while allowing comment-only files", () => {
      fs.writeFileSync(path.join(tmpDir, "aice.config.json"), '["not", "an", "object"]', "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);

      fs.writeFileSync(path.join(tmpDir, "aice.config.json"), '"primitive"', "utf-8");
      expect(() => loadProjectConfig(tmpDir)).toThrow(/Failed to parse/);

      fs.writeFileSync(path.join(tmpDir, "aice.config.json"), "// empty with comments\n", "utf-8");
      expect(isProjectAiceEnabled(loadProjectConfig(tmpDir))).toBe(true);
    });

    it("aligns MANDATORY_AGENT_RULES_MARKDOWN with 2-Pillar architecture without active-mode write_file contradiction", () => {
      expect(MANDATORY_AGENT_RULES_MARKDOWN).not.toContain(", or standard `write_file`");
      expect(MANDATORY_AGENT_RULES_MARKDOWN.match(/<!--\s*AICE:START[^>]*-->/g)).toHaveLength(1);
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("'f:/a|b/'");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice write");
    });

    it("detects .aipl language name in tokenomics", () => {
      expect(detectLanguageName("src/workflow.aipl")).toBe("AIPL");
    });

    it("enforces <= 900B & <= 300 BPE token budget (cl100k_base & o200k_base) and all core invariants in MANDATORY_AGENT_RULES_MARKDOWN", () => {
      const cl100k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base");
      const o200k = TiktokenTokenizer.count(MANDATORY_AGENT_RULES_MARKDOWN, "o200k_base");
      expect(Buffer.byteLength(MANDATORY_AGENT_RULES_MARKDOWN, "utf-8")).toBeLessThanOrEqual(900);
      expect(cl100k).toBeLessThanOrEqual(300);
      expect(o200k).toBeLessThanOrEqual(300);
      expect(estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "cl100k_base")).toBeLessThanOrEqual(
        300,
      );
      expect(estimateTokens(MANDATORY_AGENT_RULES_MARKDOWN, "o200k_base")).toBeLessThanOrEqual(300);

      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice read");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice_read");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice splice");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice_splice");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice splice --stdin << 'EOF'");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("=== f:sym ===");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("=== f:L1-L20 ===");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("--delete");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toMatch(/multi-line[\s\S]*<<</i);
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice.config.json");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain('"enabled": true');
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice disable");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain("aice enable");
      expect(MANDATORY_AGENT_RULES_MARKDOWN).toContain(
        "Use AICE (aice read / aice splice) for all file exploration and edits.",
      );
    });

    it("defaults idiomsEnabled to false while honoring explicit idiomsEnabled: true and --idioms overrides", () => {
      expect(DEFAULT_PROJECT_CONFIG.idiomsEnabled).toBe(false);
      expect(isProjectIdiomsEnabled(DEFAULT_PROJECT_CONFIG)).toBe(false);
      expect(isProjectIdiomsEnabled(undefined)).toBe(false);

      const loadedDefault = loadProjectConfig(tmpDir);
      expect(loadedDefault.idiomsEnabled).toBe(false);
      expect(isProjectIdiomsEnabled(loadedDefault)).toBe(false);
      expect(isProjectIdiomsEnabled(loadedDefault, true)).toBe(true);

      const enabledCfg = setProjectAiceEnabled(tmpDir, true);
      expect(enabledCfg.idiomsEnabled).toBe(false);
      expect(isProjectIdiomsEnabled(loadProjectConfig(tmpDir))).toBe(false);

      setProjectIdiomsEnabled(tmpDir, true);
      expect(loadProjectConfig(tmpDir).idiomsEnabled).toBe(true);
      expect(isProjectIdiomsEnabled(loadProjectConfig(tmpDir))).toBe(true);
      expect(isProjectIdiomsEnabled(loadProjectConfig(tmpDir), false)).toBe(false);

      const reEnabled = setProjectAiceEnabled(tmpDir, true);
      expect(reEnabled.idiomsEnabled).toBe(true);
    });

    it("injects single-file AGENTS.md (plus conditional CLAUDE.md without @AGENTS.md) and purges legacy GEMINI.md / .GEMINI.md / .agents/rules/aice.md on both enable and disable", () => {
      const legacyRulePath = path.join(tmpDir, ".agents", "rules", "aice.md");
      fs.mkdirSync(path.dirname(legacyRulePath), { recursive: true });
      fs.writeFileSync(
        legacyRulePath,
        "---\ntrigger: always_on\n---\n<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "GEMINI.md"),
        "<!-- AICE:START -->\nlegacy gemini block only\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, ".GEMINI.md"),
        "# Custom Gemini Notes\n\n<!-- AICE:START -->\nlegacy dot-gemini\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "CLAUDE.md"),
        "# Claude Config\n\n@AGENTS.md\n\n<!-- AICE:START -->\nduplicate block\n<!-- AICE:END -->\n",
        "utf-8",
      );

      expect(hasAgentsMdInclude("# Claude\n@AGENTS.md\n")).toBe(true);
      expect(hasAgentsMdInclude("# Claude\nSee @./AGENTS.md for rules.\n")).toBe(true);
      expect(hasAgentsMdInclude("```md\n@AGENTS.md\n```\n")).toBe(false);
      expect(hasAgentsMdInclude("# Claude\ncontact dev@AGENTS.md\n")).toBe(false);

      syncProjectWorkspaceRules(tmpDir, true);

      expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "AGENTS.md"), "utf-8")).toContain(
        AICE_DIRECTIVE_START,
      );
      expect(fs.existsSync(path.join(tmpDir, "GEMINI.md"))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, ".GEMINI.md"))).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, ".GEMINI.md"), "utf-8")).toBe(
        "# Custom Gemini Notes\n",
      );
      expect(fs.existsSync(legacyRulePath)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, ".agents"))).toBe(false);

      const claudeWithInclude = fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8");
      expect(claudeWithInclude).toContain("@AGENTS.md");
      expect(claudeWithInclude).not.toContain(AICE_DIRECTIVE_START);

      fs.writeFileSync(path.join(tmpDir, "CLAUDE.md"), "# Standalone Claude Rules\n", "utf-8");
      syncProjectWorkspaceRules(tmpDir, true);
      expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8")).toContain(
        AICE_DIRECTIVE_START,
      );

      fs.mkdirSync(path.dirname(legacyRulePath), { recursive: true });
      fs.writeFileSync(legacyRulePath, "legacy", "utf-8");
      fs.writeFileSync(
        path.join(tmpDir, "GEMINI.md"),
        "<!-- AICE:START -->\nlegacy\n<!-- AICE:END -->\n",
        "utf-8",
      );
      syncProjectWorkspaceRules(tmpDir, false);
      expect(fs.existsSync(path.join(tmpDir, "AGENTS.md"))).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, "GEMINI.md"))).toBe(false);
      expect(fs.existsSync(legacyRulePath)).toBe(false);
      expect(fs.existsSync(path.join(tmpDir, ".agents"))).toBe(false);
      expect(fs.readFileSync(path.join(tmpDir, "CLAUDE.md"), "utf-8")).toBe(
        "# Standalone Claude Rules\n",
      );
    });

    it("respects enabled: false in tools/bump-version.ts without injecting AGENTS.md", () => {
      const bumpSandbox = fs.mkdtempSync(path.join(os.tmpdir(), "aice-bump-disabled-"));
      try {
        fs.mkdirSync(path.join(bumpSandbox, "src"), { recursive: true });
        fs.writeFileSync(
          path.join(bumpSandbox, "package.json"),
          `${JSON.stringify({ name: "sandbox", version: "0.9.35" }, null, 2)}\n`,
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bumpSandbox, "src", "version.ts"),
          'export const AICE_VERSION = "0.9.35";\n',
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bumpSandbox, "aice.config.json"),
          `${JSON.stringify({ enabled: false, idiomsEnabled: false }, null, 2)}\n`,
          "utf-8",
        );
        fs.writeFileSync(
          path.join(bumpSandbox, "GEMINI.md"),
          "<!-- AICE:START -->\nstale\n<!-- AICE:END -->\n",
          "utf-8",
        );

        const tsxBin = path.resolve(
          process.cwd(),
          "node_modules",
          ".bin",
          process.platform === "win32" ? "tsx.cmd" : "tsx",
        );
        const bumpScript = path.resolve(process.cwd(), "tools", "bump-version.ts");
        const res = spawnSync(tsxBin, [bumpScript, "patch"], {
          cwd: process.cwd(),
          encoding: "utf-8",
          env: {
            ...process.env,
            AICE_BUMP_ROOT_DIR: bumpSandbox,
            AICE_BUMP_SKIP_BUILD: "1",
          },
        });
        expect(res.status).toBe(0);
        expect(
          JSON.parse(fs.readFileSync(path.join(bumpSandbox, "package.json"), "utf-8")).version,
        ).toBe("0.9.36");
        expect(fs.existsSync(path.join(bumpSandbox, "AGENTS.md"))).toBe(false);
        expect(fs.existsSync(path.join(bumpSandbox, "GEMINI.md"))).toBe(false);
      } finally {
        fs.rmSync(bumpSandbox, { recursive: true, force: true });
      }
    });

    it("parses and cleanly removes multiple separate AICE blocks while preserving user markdown between them", () => {
      const doc = [
        "# Top Level Heading",
        "",
        "<!-- AICE:START -->",
        "Directive block 1",
        "<!-- AICE:END -->",
        "",
        "## User Section 1",
        "Important user notes here.",
        "",
        "<!-- AICE:START v0.9.40 -->",
        "Directive block 2",
        "<!-- AICE:END -->",
        "",
        "## User Section 2",
        "End of user notes.",
      ].join("\n");

      const spans = findAllDirectiveSpansOutsideFences(doc);
      expect(spans).toHaveLength(2);
      expect(spans[0]?.startIdx).toBe(doc.indexOf("<!-- AICE:START -->"));
      expect(spans[1]?.startIdx).toBe(doc.indexOf("<!-- AICE:START v0.9.40 -->"));

      const { stripped, hadDirective } = stripAllMarkdownDirectives(doc);
      expect(hadDirective).toBe(true);
      expect(stripped).toContain("# Top Level Heading");
      expect(stripped).toContain("## User Section 1\nImportant user notes here.");
      expect(stripped).toContain("## User Section 2\nEnd of user notes.");
      expect(stripped).not.toContain("Directive block 1");
      expect(stripped).not.toContain("Directive block 2");

      const testMd = path.join(tmpDir, "multi-block.md");
      fs.writeFileSync(testMd, doc, "utf-8");

      removeMarkdownDirective(testMd, true);
      const remaining = fs.readFileSync(testMd, "utf-8");
      expect(remaining).toContain("## User Section 1\nImportant user notes here.");
      expect(remaining).toContain("## User Section 2\nEnd of user notes.");
      expect(remaining).not.toContain("AICE:START");

      // Now test upsert: should replace all legacy blocks with a single clean directive
      upsertMarkdownDirective(
        testMd,
        "<!-- AICE:START -->\nNew Consolidated Rules\n<!-- AICE:END -->",
      );
      const upserted = fs.readFileSync(testMd, "utf-8");
      expect(upserted).toContain("New Consolidated Rules");
      expect(upserted).toContain("## User Section 1\nImportant user notes here.");
      expect(upserted).toContain("## User Section 2\nEnd of user notes.");
      const updatedSpans = findAllDirectiveSpansOutsideFences(upserted);
      expect(updatedSpans).toHaveLength(1);
    });

    it("heals unclosed AICE:START block before a non-AICE heading without eating the heading", () => {
      const doc = [
        "# Project Title",
        "",
        "<!-- AICE:START -->",
        "Corrupted unclosed rules content...",
        "",
        "## Custom Section",
        "Do not eat this section!",
      ].join("\n");

      const spans = findAllDirectiveSpansOutsideFences(doc);
      expect(spans).toHaveLength(1);
      const span = spans[0]!;
      expect(span.startIdx).toBe(doc.indexOf("<!-- AICE:START -->"));
      expect(span.endOffset).toBe(doc.indexOf("## Custom Section"));

      const { stripped, hadDirective } = stripAllMarkdownDirectives(doc);
      expect(hadDirective).toBe(true);
      expect(stripped).toContain("# Project Title");
      expect(stripped).toContain("## Custom Section\nDo not eat this section!");
      expect(stripped).not.toContain("Corrupted unclosed rules content");

      const testMd = path.join(tmpDir, "unclosed.md");
      fs.writeFileSync(testMd, doc, "utf-8");
      removeMarkdownDirective(testMd, true);
      expect(fs.readFileSync(testMd, "utf-8")).toBe(
        "# Project Title\n\n## Custom Section\nDo not eat this section!\n",
      );
    });

    it("heals unclosed AICE:START block that runs until EOF cleanly", () => {
      const doc = [
        "# Project Title",
        "",
        "<!-- AICE:START -->",
        "Corrupted unclosed rules content at end of file",
      ].join("\n");

      const spans = findAllDirectiveSpansOutsideFences(doc);
      expect(spans).toHaveLength(1);
      expect(spans[0]?.endOffset).toBe(doc.length);

      const { stripped, hadDirective } = stripAllMarkdownDirectives(doc);
      expect(hadDirective).toBe(true);
      expect(stripped).toBe("# Project Title");
    });

    it("treats consecutive AICE:START lines as part of the same active block", () => {
      const doc = [
        "<!-- AICE:START -->",
        "<!-- AICE:START v0.9.40 -->",
        "Rule line",
        "<!-- AICE:END -->",
      ].join("\n");

      const spans = findAllDirectiveSpansOutsideFences(doc);
      expect(spans).toHaveLength(1);
      expect(spans[0]?.startIdx).toBe(0);
      expect(spans[0]?.endOffset).toBe(doc.length);

      const { stripped, hadDirective } = stripAllMarkdownDirectives(doc);
      expect(hadDirective).toBe(true);
      expect(stripped).toBe("");
    });

    it("ignores AICE:START and AICE:END inside markdown code fences", () => {
      const doc = [
        "# Code Example",
        "",
        "```markdown",
        "<!-- AICE:START -->",
        "Fenced directive example",
        "<!-- AICE:END -->",
        "```",
        "",
        "~~~",
        "## AICE - MANDATORY",
        "Fenced tilde example",
        "~~~",
      ].join("\n");

      const spans = findAllDirectiveSpansOutsideFences(doc);
      expect(spans).toHaveLength(0);

      const { stripped, hadDirective } = stripAllMarkdownDirectives(doc);
      expect(hadDirective).toBe(false);
      expect(stripped).toBe(doc.trim());
    });

    it("synchronizes workspace rules, unlinks empty surfaces, and cleans secondary directories", () => {
      const projDir = path.join(tmpDir, "full-sync-test");
      fs.mkdirSync(projDir, { recursive: true });

      // Seed all secondary and duplicate surfaces
      fs.writeFileSync(
        path.join(projDir, "GEMINI.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projDir, ".GEMINI.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projDir, "CODEX.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projDir, ".CODEX.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );

      fs.mkdirSync(path.join(projDir, ".codex"), { recursive: true });
      fs.writeFileSync(
        path.join(projDir, ".codex", "AGENTS.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projDir, ".codex", "CODEX.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );
      fs.writeFileSync(
        path.join(projDir, ".codex", "instructions.md"),
        "<!-- AICE:START -->\nold\n<!-- AICE:END -->\n",
        "utf-8",
      );

      fs.mkdirSync(path.join(projDir, ".agents", "rules"), { recursive: true });
      fs.writeFileSync(path.join(projDir, ".agents", "rules", "aice.md"), "legacy", "utf-8");
      fs.mkdirSync(path.join(projDir, ".gemini", "rules"), { recursive: true });
      fs.writeFileSync(path.join(projDir, ".gemini", "rules", "aice.md"), "legacy", "utf-8");
      fs.mkdirSync(path.join(projDir, ".claude", "rules"), { recursive: true });
      fs.writeFileSync(path.join(projDir, ".claude", "rules", "aice.md"), "legacy", "utf-8");

      fs.writeFileSync(path.join(projDir, "CLAUDE.md"), "# Standalone Claude Rules\n", "utf-8");

      // Enable workspace rules
      syncProjectWorkspaceRules(projDir, true);

      // AGENTS.md created
      expect(fs.existsSync(path.join(projDir, "AGENTS.md"))).toBe(true);
      expect(fs.readFileSync(path.join(projDir, "AGENTS.md"), "utf-8")).toContain("AICE:START");

      // Secondary duplicate surfaces purged
      expect(fs.existsSync(path.join(projDir, "GEMINI.md"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".GEMINI.md"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, "CODEX.md"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".CODEX.md"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".codex"))).toBe(false);

      expect(fs.existsSync(path.join(projDir, ".agents"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".gemini"))).toBe(false);
      expect(fs.existsSync(path.join(projDir, ".claude", "rules"))).toBe(false);

      // CLAUDE.md has directive injected after heading
      const claudeContent = fs.readFileSync(path.join(projDir, "CLAUDE.md"), "utf-8");
      expect(claudeContent).toContain("# Standalone Claude Rules");
      expect(claudeContent).toContain("AICE:START");

      // Disable workspace rules
      syncProjectWorkspaceRules(projDir, false);

      // AGENTS.md was AICE-only so it must be unlinked (no 0-byte orphan file)
      expect(fs.existsSync(path.join(projDir, "AGENTS.md"))).toBe(false);
      // CLAUDE.md has user content so it must remain intact without AICE directive
      expect(fs.existsSync(path.join(projDir, "CLAUDE.md"))).toBe(true);
      expect(fs.readFileSync(path.join(projDir, "CLAUDE.md"), "utf-8")).toBe(
        "# Standalone Claude Rules\n",
      );
    });
  });
});
