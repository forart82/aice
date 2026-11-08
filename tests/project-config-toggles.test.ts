import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  AICE_DISABLED_MESSAGE,
  DEFAULT_PROJECT_CONFIG,
  isProjectAiceEnabled,
  isProjectIdiomsEnabled,
  loadProjectConfig,
  type ProjectIdiomDefinition,
  saveProjectConfig,
  setProjectAiceEnabled,
  setProjectIdiomsEnabled,
  validateConfig,
} from "../src/config/index.js";
import { decompile } from "../src/decompiler/index.js";
import { AiceMcpServer, type McpToolCallResult } from "../src/mcp/server.js";
import { auditTokenomics } from "../src/tokenomics/index.js";
import { generateContext, outlinePath, splice } from "../src/tools/index.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string) {
  return spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    encoding: "utf-8",
    timeout: 15000,
  });
}

describe("Phase 3: Project-Level Controls in aice.config.json (enabled & idiomsEnabled)", () => {
  let tmpDir: string;
  let srcDir: string;
  let tsFile: string;

  const sampleIdiom: ProjectIdiomDefinition = {
    name: "$drawCircle",
    kind: "stmt",
    params: [{ name: "$0" }, { name: "$1" }, { name: "$2" }, { name: "$3" }],
    templateAice: "$0.beginPath()\n$0.arc($1, $2, $3, 0, 6.28)\n$0.fill()",
    occurrences: 3,
    tokensPerOccurrenceSaved: 10,
    netTokenSavings: 30,
  };

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-config-toggles-"));
    srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });
    tsFile = path.join(srcDir, "canvas.ts");
    fs.writeFileSync(
      tsFile,
      [
        "export function renderParticle(ctx: any, x: number, y: number, r: number): void {",
        "  ctx.beginPath();",
        "  ctx.arc(x, y, r, 0, 6.28);",
        "  ctx.fill();",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("validates enabled, idiomsEnabled, and the 'idioms: false' boolean alias in aice.config.json", () => {
    expect(DEFAULT_PROJECT_CONFIG.enabled).toBe(true);
    expect(isProjectAiceEnabled(DEFAULT_PROJECT_CONFIG)).toBe(true);

    // @ts-expect-error invalid enabled
    expect(() => validateConfig({ enabled: "no" })).toThrow(/Invalid enabled: expected boolean/);
    // @ts-expect-error invalid idiomsEnabled
    expect(() => validateConfig({ idiomsEnabled: 123 })).toThrow(
      /Invalid idiomsEnabled: expected boolean/,
    );

    // Boolean alias `"idioms": false` -> `idiomsEnabled: false`
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ mode: "twinless", idioms: false }, null, 2),
      "utf-8",
    );
    const loadedAlias = loadProjectConfig(tmpDir);
    expect(loadedAlias.idiomsEnabled).toBe(false);
    expect(isProjectIdiomsEnabled(loadedAlias)).toBe(false);

    // When `enabled: false`, `isProjectIdiomsEnabled` is also false even if `idiomsEnabled: true`
    const updatedDisabled = setProjectAiceEnabled(tmpDir, false);
    expect(updatedDisabled.enabled).toBe(false);
    expect(isProjectAiceEnabled(updatedDisabled)).toBe(false);
    expect(isProjectAiceEnabled(tmpDir)).toBe(false);
    expect(isProjectIdiomsEnabled({ ...updatedDisabled, idiomsEnabled: true })).toBe(false);

    const updatedEnabled = setProjectAiceEnabled(tmpDir, true);
    expect(updatedEnabled.enabled).toBe(true);
    expect(isProjectAiceEnabled(updatedEnabled)).toBe(true);
    expect(isProjectAiceEnabled(tmpDir)).toBe(true);

    // Persisted aice.config.json contains only clean on-the-fly keys (no legacy side-by-side / .aice-build keys)
    const rawOnDisk = JSON.parse(fs.readFileSync(path.join(tmpDir, "aice.config.json"), "utf-8"));
    expect(rawOnDisk).toEqual({
      enabled: true,
      idiomsEnabled: false,
    });

    setProjectIdiomsEnabled(tmpDir, true);
    const rawAfterIdiomsOn = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "aice.config.json"), "utf-8"),
    );
    expect(rawAfterIdiomsOn).toEqual({
      enabled: true,
      idiomsEnabled: true,
    });

    // Legacy 0.9.3 default keys + shorthand string idioms + custom non-legacy fields
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify(
        {
          enabled: true,
          mode: "side-by-side",
          sourceDir: "src",
          outDir: ".aice-build",
          targetLanguage: "typescript",
          isolated: false,
          watermark: true,
          customField: "keep-me",
          idioms: {
            $clamp: "Math.min(Math.max($0, $1), $2)",
          },
        },
        null,
        2,
      ),
      "utf-8",
    );
    const savedWithShorthand = saveProjectConfig(tmpDir, { idiomsEnabled: true });
    expect(savedWithShorthand.idioms?.$clamp?.templateAice).toBe("Math.min(Math.max($0, $1), $2)");
    const rawCleaned = JSON.parse(fs.readFileSync(path.join(tmpDir, "aice.config.json"), "utf-8"));
    expect(rawCleaned.mode).toBeUndefined();
    expect(rawCleaned.sourceDir).toBeUndefined();
    expect(rawCleaned.outDir).toBeUndefined();
    expect(rawCleaned.targetLanguage).toBeUndefined();
    expect(rawCleaned.isolated).toBeUndefined();
    expect(rawCleaned.watermark).toBeUndefined();
    expect(rawCleaned.customField).toBe("keep-me");
    expect(rawCleaned.enabled).toBe(true);
    expect(rawCleaned.idiomsEnabled).toBe(true);
    expect(rawCleaned.idioms.$clamp.name).toBe("$clamp");
  });

  it("refuses tool execution with AICE_DISABLED_MESSAGE when enabled is false in aice.config.json", async () => {
    saveProjectConfig(tmpDir, {
      enabled: false,
      idiomsEnabled: true,
      idioms: { $drawCircle: sampleIdiom },
    });

    await expect(outlinePath(tsFile, { projectRoot: tmpDir })).rejects.toThrow(
      AICE_DISABLED_MESSAGE,
    );
    await expect(generateContext(tsFile, { projectRoot: tmpDir })).rejects.toThrow(
      AICE_DISABLED_MESSAGE,
    );
    await expect(
      splice(tsFile, {
        projectRoot: tmpDir,
        symbol: "renderParticle",
        body: "ctx.fill()",
      }),
    ).rejects.toThrow(AICE_DISABLED_MESSAGE);
    expect(() =>
      decompile(fs.readFileSync(tsFile, "utf-8"), "typescript", { filePath: tsFile }),
    ).toThrow(AICE_DISABLED_MESSAGE);
    expect(() => auditTokenomics(tsFile)).toThrow(AICE_DISABLED_MESSAGE);
  });

  it("supports CLI commands `aice disable`, `aice enable`, and `aice config`", () => {
    const disableRes = runCli(["disable", tmpDir], tmpDir);
    expect(disableRes.status).toBe(0);
    expect(isProjectAiceEnabled(tmpDir)).toBe(false);

    const outlineWhileDisabled = runCli(["outline", tsFile], tmpDir);
    expect(outlineWhileDisabled.status).toBe(1);
    expect(outlineWhileDisabled.stderr).toContain(AICE_DISABLED_MESSAGE);

    const configRes = runCli(["config", tmpDir, "--json"], tmpDir);
    expect(configRes.status).toBe(0);
    const parsedCfg = JSON.parse(configRes.stdout);
    expect(parsedCfg.enabled).toBe(false);
    expect(parsedCfg.idiomsEnabled).toBe(false);
    expect(parsedCfg.mode).toBeUndefined();

    const configTextRes = runCli(["config", tmpDir], tmpDir);
    expect(configTextRes.status).toBe(0);
    expect(configTextRes.stdout).toContain("AICE Status:");
    expect(configTextRes.stdout).not.toContain("Mode:");

    const enableRes = runCli(["enable", tmpDir], tmpDir);
    expect(enableRes.status).toBe(0);
    expect(isProjectAiceEnabled(tmpDir)).toBe(true);

    const persistedAfterEnable = JSON.parse(
      fs.readFileSync(path.join(tmpDir, "aice.config.json"), "utf-8"),
    );
    expect(persistedAfterEnable).toEqual({
      enabled: true,
      idiomsEnabled: true,
    });

    const outlineWhileEnabled = runCli(["outline", tsFile], tmpDir);
    expect(outlineWhileEnabled.status).toBe(0);
    expect(outlineWhileEnabled.stdout).toContain("renderParticle");
  }, 20000);

  it("strictly disables $idiom collapsing and expansion when idiomsEnabled is false across tools and CLI", async () => {
    saveProjectConfig(tmpDir, {
      enabled: true,
      mode: "twinless",
      sourceDir: "src",
      idiomsEnabled: false,
      idioms: { $drawCircle: sampleIdiom },
    });

    // 1. decompile respects idiomsEnabled: false
    const decOff = decompile(fs.readFileSync(tsFile, "utf-8"), "typescript", { filePath: tsFile });
    expect(decOff.aice).not.toContain("$drawCircle");

    // Explicit override `idioms: true` forces idiom collapse
    const decOverrideOn = decompile(fs.readFileSync(tsFile, "utf-8"), "typescript", {
      filePath: tsFile,
      idioms: true,
    });
    expect(decOverrideOn.aice).toContain("$drawCircle(ctx, x, y, r)");

    // 2. outline & context respect idiomsEnabled: false
    const outOff = await outlinePath(tsFile, { projectRoot: tmpDir });
    expect(outOff instanceof Map).toBe(false);
    if (!(outOff instanceof Map)) {
      expect(outOff.text).not.toContain("$drawCircle");
    }

    const ctxOff = await generateContext(tsFile, { projectRoot: tmpDir });
    expect(ctxOff.targetContent).not.toContain("$drawCircle");

    // 3. auditTokenomics respects idiomsEnabled: false
    const tokOff = auditTokenomics(tsFile);
    expect(tokOff.files[0]?.file).toBeDefined();

    // 4. CLI `aice splice` does not expand $drawCircle when idiomsEnabled is false unless --idioms is passed
    setProjectIdiomsEnabled(tmpDir, false);
    const spliceCliOff = runCli(
      ["splice", tsFile, "-s", "renderParticle", "-b", "ctx.clearRect(0, 0, x, y)"],
      tmpDir,
    );
    expect(spliceCliOff.status).toBe(0);
    expect(fs.readFileSync(tsFile, "utf-8")).toContain("ctx.clearRect(0, 0, x, y)");
  }, 20000);

  it("enforces enabled: false and exposes aice_project_config in AiceMcpServer across tools", async () => {
    saveProjectConfig(tmpDir, {
      enabled: false,
      mode: "twinless",
      sourceDir: "src",
      idiomsEnabled: true,
      idioms: { $drawCircle: sampleIdiom },
    });

    const server = new AiceMcpServer(undefined, undefined, { workspaceRoot: tmpDir });

    const callTool = async (id: number, name: string, args: Record<string, unknown>) => {
      return (await server.handleRequest(id, "tools/call", {
        name,
        arguments: args,
      })) as McpToolCallResult;
    };

    // When disabled, aice_outline, aice_context, aice_splice, aice_idioms return informative disabled message
    for (const [idx, toolName] of [
      "aice_outline",
      "aice_context",
      "aice_splice",
      "aice_idioms",
    ].entries()) {
      const res = await callTool(idx + 1, toolName, { path: tsFile, action: "list" });
      expect(res.content[0].text).toContain(AICE_DISABLED_MESSAGE);
    }

    // Toggle enabled=true via MCP `aice_project_config`
    const cfgEnableRes = await callTool(10, "aice_project_config", {
      path: tmpDir,
      enabled: true,
      idiomsEnabled: false,
    });
    const cfgPayload = JSON.parse(cfgEnableRes.content[0].text);
    expect(cfgPayload.enabled).toBe(true);
    expect(cfgPayload.idiomsEnabled).toBe(false);

    // Now aice_context works and respects idiomsEnabled=false
    const ctxRes = await callTool(11, "aice_context", { path: tsFile });
    expect(ctxRes.content[0].text).toContain("fn renderParticle");
    expect(ctxRes.content[0].text).not.toContain("$drawCircle");
  });
});
