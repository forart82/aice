/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Unit & Roundtrip Test Suite for Multi-Language Dialects for Data & Config (`.json`, `.yaml`) (Step 24).
 * Verifies:
 * 1. JSON Dialect: Decompilation to token-dense AICE, forward emission, and lossless data equivalence.
 * 2. YAML Dialect: Decompilation with comment retention, forward emission with YAML.stringify, and lossless equivalence.
 * 3. Core System Registration: TargetLanguage, detectTargetFromPath, emitTarget, decompile, KNOWN_TARGET_EXTENSIONS, TARGET_EXT_MAP.
 * 4. Polymorphic CLI Integration: `aice compile`, `aice outline`, and `aice context` on data files.
 * 5. Edge cases: Nested hierarchies, empty collections, special keys, negative numbers, multiple const decls.
 */

import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import YAML from "yaml";
import {
  getExtensionForTarget,
  KNOWN_TARGET_EXTENSIONS,
  TARGET_EXT_MAP,
  VALID_TARGET_LANGUAGES,
} from "../../src/config/index.js";
import { parse, parseWithTrivia } from "../../src/core/parser.js";
import {
  decompile,
  decompileFile,
  executeRoundtrip,
  JsonDecompiler,
  YamlDecompiler,
} from "../../src/decompiler/index.js";
import {
  detectTargetFromPath,
  emitTarget,
  JsonEmitter,
  YamlEmitter,
} from "../../src/emitters/index.js";

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

describe("Step 24: Multi-Language Dialects for Data & Config (.json, .yaml)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-data-config-test-"));
    fs.writeFileSync(
      path.join(tmpDir, "sample.json"),
      JSON.stringify(
        {
          name: "aice-data-service",
          version: "2.4.0",
          port: 8080,
          timeout: 30.5,
          negativeOffset: -10,
          enabled: true,
          debug: false,
          fallback: null,
          tags: ["transpiler", "compiler", "homoiconic", "ast"],
          matrix: [
            [1, 2],
            [3, 4],
          ],
          server: {
            host: "127.0.0.1",
            ssl: true,
            maxConnections: 5000,
            cors: {
              origins: ["https://example.com", "https://api.example.com"],
              credentials: true,
            },
          },
          emptyObject: {},
          emptyList: [],
        },
        null,
        2,
      ) + "\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(tmpDir, "sample.yaml"),
      `# AICE Unified Configuration Spec
app:
  name: aice-cluster-manager
  version: 1.0.0
  active: true
  replicas: 3
  cpuLimit: 2.5
  memoryOffset: -256
  leader: null
  zones:
    - us-east-1a
    - us-east-1b
    - us-east-1c
  network:
    bind: 0.0.0.0
    port: 9090
    ingress:
      enabled: true
      hosts:
        - cluster.local
  emptyRecord: {}
  emptyArray: []
`,
      "utf-8",
    );
  });

  afterEach(() => {
    try {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error
    }
  });

  describe("1. JSON Dialect Implementation", () => {
    it("decompiles nested JSON with diverse data types into canonical AICE code", () => {
      const jsonSource = JSON.stringify(
        {
          name: "data-service",
          version: 1,
          ratio: 3.14,
          negativeOffset: -42,
          enabled: true,
          disabled: false,
          fallback: null,
          tags: ["transpiler", "ast"],
          server: {
            host: "127.0.0.1",
            port: 8080,
          },
          emptyObj: {},
          emptyArr: [],
        },
        null,
        2,
      );

      const decompiler = new JsonDecompiler(jsonSource, "service.json");
      const result = decompiler.decompile();

      expect(result.ast).toBeDefined();
      expect(result.ast.kind).toBe("Module");
      expect(result.ast.path).toBe("service");
      expect(result.ast.items.length).toBe(1);

      const decl = result.ast.items[0];
      expect(decl.kind).toBe("ConstDecl");
      if (decl.kind === "ConstDecl") {
        expect(decl.name).toBe("config");
        expect(decl.isExported).toBe(true);
        expect(decl.value.kind).toBe("RecordLiteralExpr");
      }

      // Check generated AICE code
      expect(result.aice).toContain("module service");
      expect(result.aice).toContain('pub const config = { name: "data-service"');
      expect(result.aice).toContain("fallback: nil");
      expect(result.aice).toContain("enabled: true");
      expect(result.aice).toContain("disabled: false");
      expect(result.aice).toContain("negativeOffset: -42");
      expect(result.aice).toContain("emptyObj: {}");
      expect(result.aice).toContain("emptyArr: []");

      // Verify generated AICE code can be parsed back into AST without syntax errors
      const parsed = parse(result.aice);
      expect(parsed.items.length).toBe(1);
    });

    it("supports custom constName option in JsonDecompiler", () => {
      const jsonSource = JSON.stringify({ key: "val" });
      const decompiler = new JsonDecompiler(jsonSource, "my_config.json", {
        constName: "customSettings",
      });
      const result = decompiler.decompile();
      expect(result.aice).toContain('pub const customSettings = { key: "val" }');
    });

    it("parses JSON containing line and block comments by stripping comments cleanly", () => {
      const jsonWithComments = `
      // Top configuration comment
      {
        "host": "localhost", /* inline comment */
        "port": 3000 // trailing comment
      }
      `;
      const decompiler = new JsonDecompiler(jsonWithComments, "commented.json");
      const result = decompiler.decompile();
      expect(result.aice).toContain('host: "localhost"');
      expect(result.aice).toContain("port: 3000");
    });

    it("emits valid formatted JSON from AICE AST using JsonEmitter", () => {
      const aiceSource = `module test\n\npub const config = { app: "aice", count: 10, debug: false, meta: nil }\n`;
      const ast = parse(aiceSource);
      const emitter = new JsonEmitter({ indent: "  " });
      const emitted = emitter.emit(ast);

      const parsedJson = JSON.parse(emitted);
      expect(parsedJson).toEqual({
        app: "aice",
        count: 10,
        debug: false,
        meta: null,
      });
    });

    it("guarantees 100% lossless data equivalence for JSON -> AICE -> JSON", () => {
      const originalData = {
        title: "AICE Benchmark",
        active: true,
        score: 99.85,
        depth: -5,
        matrix: [
          [1, 2],
          [3, 4],
        ],
        attributes: {
          color: "cyan",
          opacity: 0.8,
          visible: true,
          deletedAt: null,
        },
        emptyRecord: {},
        emptyList: [],
      };
      const jsonStr = JSON.stringify(originalData, null, 2);

      const decompResult = decompile(jsonStr, "json", { filePath: "benchmark.json" });
      const ast = parse(decompResult.aice);
      const emittedJson = emitTarget(ast, "json");

      const roundtrippedData = JSON.parse(emittedJson);
      expect(roundtrippedData).toEqual(originalData);
    });

    it("executes lossless roundtrip via executeRoundtrip for JSON", () => {
      const originalData = {
        service: "auth",
        port: 8080,
        ssl: true,
        tokens: null,
      };
      const originalJson = JSON.stringify(originalData, null, 2) + "\n";
      const result = executeRoundtrip(originalJson, "json", "auth.json");

      expect(result.target).toBe("json");
      expect(result.aice).toContain("pub const config");
      expect(JSON.parse(result.reconstructed)).toEqual(originalData);
    });
  });

  describe("2. YAML Dialect Implementation", () => {
    it("decompiles YAML with comments and hierarchy into canonical AICE code", () => {
      const yamlSource = `# Cluster configuration
server:
  host: 0.0.0.0
  port: 8080
  workers: 4
  rateLimit: 12.5
  negativeMargin: -50
  healthy: true
  maintenance: false
  drainTarget: null
  endpoints:
    - /healthz
    - /metrics
  emptyMap: {}
  emptySeq: []
`;

      const decompiler = new YamlDecompiler(yamlSource, "cluster.yaml");
      const result = decompiler.decompile();

      expect(result.ast).toBeDefined();
      expect(result.ast.kind).toBe("Module");
      expect(result.ast.path).toBe("cluster");
      expect(result.ast.items.length).toBe(1);

      // Verify comment retention in decompiled AICE
      expect(result.aice).toContain("# Cluster configuration");
      expect(result.aice).toContain("module cluster");
      expect(result.aice).toContain("pub const config =");
      expect(result.aice).toContain('host: "0.0.0.0"');
      expect(result.aice).toContain("drainTarget: nil");
      expect(result.aice).toContain("healthy: true");
      expect(result.aice).toContain("maintenance: false");
      expect(result.aice).toContain("negativeMargin: -50");
      expect(result.aice).toContain('endpoints: ["/healthz", "/metrics"]');
      expect(result.aice).toContain("emptyMap: {}");
      expect(result.aice).toContain("emptySeq: []");

      // Verify valid parse
      const parsed = parse(result.aice);
      expect(parsed.items.length).toBe(1);
    });

    it("emits valid YAML from AICE AST using YamlEmitter", () => {
      const aiceSource = `module test\n\npub const config = { service: "gateway", port: 443, secure: true, cert: nil }\n`;
      const ast = parse(aiceSource);
      const emitter = new YamlEmitter();
      const emitted = emitter.emit(ast);

      const parsedYaml = YAML.parse(emitted);
      expect(parsedYaml).toEqual({
        service: "gateway",
        port: 443,
        secure: true,
        cert: null,
      });
    });

    it("preserves comments when emitting YAML with trivia", () => {
      const yamlSource = `# Top secret credentials\napiKey: "xyz123"\nsecret: "topsecret"\n`;
      const decompileResult = decompile(yamlSource, "yaml", { filePath: "creds.yaml" });
      const { ast, trivia } = parseWithTrivia(decompileResult.aice, "creds.yaml");

      const emitter = new YamlEmitter({ trivia });
      const emitted = emitter.emit(ast);

      expect(emitted).toContain("# Top secret credentials");
      expect(YAML.parse(emitted)).toEqual({
        apiKey: "xyz123",
        secret: "topsecret",
      });
    });

    it("guarantees 100% lossless data equivalence for YAML -> AICE -> YAML", () => {
      const originalData = {
        deployment: "k8s-prod",
        replicas: 5,
        ratio: 1.75,
        offset: -128,
        tags: ["core", "edge"],
        network: {
          ip: "10.0.0.1",
          enabled: true,
          disabled: false,
          gateway: null,
        },
        emptyObj: {},
        emptyList: [],
      };
      const yamlStr = YAML.stringify(originalData);

      const decompResult = decompile(yamlStr, "yaml", { filePath: "k8s.yaml" });
      const ast = parse(decompResult.aice);
      const emittedYaml = emitTarget(ast, "yaml");

      const roundtrippedData = YAML.parse(emittedYaml);
      expect(roundtrippedData).toEqual(originalData);
    });

    it("executes roundtrip via executeRoundtrip for YAML", () => {
      const originalData = {
        app: "worker",
        concurrency: 8,
        retries: 3,
      };
      const originalYaml = YAML.stringify(originalData);
      const result = executeRoundtrip(originalYaml, "yaml", "worker.yaml");

      expect(result.target).toBe("yaml");
      expect(result.aice).toContain("pub const config");
      expect(YAML.parse(result.reconstructed)).toEqual(originalData);
    });
  });

  describe("3. Core Systems Registration & Target Detection", () => {
    it("detects TargetLanguage correctly from paths and extensions", () => {
      expect(detectTargetFromPath("config.json")).toBe("json");
      expect(detectTargetFromPath("config.json.aice")).toBe("json");
      expect(detectTargetFromPath("data/app.yaml")).toBe("yaml");
      expect(detectTargetFromPath("data/app.yaml.aice")).toBe("yaml");
      expect(detectTargetFromPath("data/settings.yml")).toBe("yaml");
      expect(detectTargetFromPath("data/settings.yml.aice")).toBe("yaml");
    });

    it("includes .json, .yaml, and .yml in KNOWN_TARGET_EXTENSIONS and TARGET_EXT_MAP", () => {
      expect(KNOWN_TARGET_EXTENSIONS.has(".json")).toBe(true);
      expect(KNOWN_TARGET_EXTENSIONS.has(".yaml")).toBe(true);
      expect(KNOWN_TARGET_EXTENSIONS.has(".yml")).toBe(true);

      expect(TARGET_EXT_MAP[".json"]).toBe("json");
      expect(TARGET_EXT_MAP[".yaml"]).toBe("yaml");
      expect(TARGET_EXT_MAP[".yml"]).toBe("yaml");
    });

    it("includes json and yaml in VALID_TARGET_LANGUAGES and getExtensionForTarget", () => {
      expect(VALID_TARGET_LANGUAGES.has("json")).toBe(true);
      expect(VALID_TARGET_LANGUAGES.has("yaml")).toBe(true);

      expect(getExtensionForTarget("json")).toBe(".json");
      expect(getExtensionForTarget("yaml")).toBe(".yaml");
    });

    it("routes through decompile and emitTarget dispatchers seamlessly", () => {
      const sampleObj = { greeting: "hello", count: 7 };

      const jsonDecompiled = decompile(JSON.stringify(sampleObj), "json");
      expect(jsonDecompiled.aice).toContain("pub const config");
      const jsonEmitted = emitTarget(jsonDecompiled.ast, "json");
      expect(JSON.parse(jsonEmitted)).toEqual(sampleObj);

      const yamlDecompiled = decompile(YAML.stringify(sampleObj), "yaml");
      expect(yamlDecompiled.aice).toContain("pub const config");
      const yamlEmitted = emitTarget(yamlDecompiled.ast, "yaml");
      expect(YAML.parse(yamlEmitted)).toEqual(sampleObj);
    });
  });

  describe("4. Example Test Files and Lossless Roundtrip", () => {
    it("decompiles and re-emits examples/data_config/sample.json without data loss", async () => {
      const samplePath = path.join(tmpDir, "sample.json");
      const originalContent = fs.readFileSync(samplePath, "utf-8");
      const originalJson = JSON.parse(originalContent);

      const decompResult = await decompileFile(samplePath);
      expect(decompResult.aice).toContain("module sample");
      expect(decompResult.aice).toContain("pub const config");

      const ast = parse(decompResult.aice);
      const reEmitted = emitTarget(ast, "json");
      const reEmittedJson = JSON.parse(reEmitted);

      expect(reEmittedJson).toEqual(originalJson);
    });

    it("decompiles and re-emits examples/data_config/sample.yaml without data loss", async () => {
      const samplePath = path.join(tmpDir, "sample.yaml");
      const originalContent = fs.readFileSync(samplePath, "utf-8");
      const originalYaml = YAML.parse(originalContent);

      const decompResult = await decompileFile(samplePath);
      expect(decompResult.aice).toContain("# AICE Unified Configuration Spec");
      expect(decompResult.aice).toContain("module sample");
      expect(decompResult.aice).toContain("pub const config");

      const { ast, trivia } = parseWithTrivia(decompResult.aice, samplePath);
      const reEmitted = emitTarget(ast, "yaml", { trivia });
      const reEmittedYaml = YAML.parse(reEmitted);

      expect(reEmittedYaml).toEqual(originalYaml);
      expect(reEmitted).toContain("# AICE Unified Configuration Spec");
    });
  });

  describe("5. Polymorphic CLI Integration on Data Files", () => {
    it("runs 'aice outline' on sample.json and yields symbol outline with high token savings", () => {
      const samplePath = path.join(tmpDir, "sample.json");
      const res = runCli(["outline", samplePath, "--stats"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("pub const config");
      expect(res.stdout).toContain("Token savings:");
      expect(res.stdout).toContain("98.");
    });

    it("runs 'aice outline' on sample.yaml and yields symbol outline with high token savings", () => {
      const samplePath = path.join(tmpDir, "sample.yaml");
      const res = runCli(["outline", samplePath, "--stats"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("pub const config");
      expect(res.stdout).toContain("Token savings:");
      expect(res.stdout).toContain("97.");
    });

    it("runs 'aice outline --json' on sample.json and outputs structured symbols payload", () => {
      const samplePath = path.join(tmpDir, "sample.json");
      const res = runCli(["outline", samplePath, "--json"]);

      expect(res.status).toBe(0);
      const parsed = JSON.parse(res.stdout);
      expect(parsed.file).toBe(samplePath);
      expect(parsed.symbols).toBeDefined();
      expect(parsed.symbols.length).toBeGreaterThanOrEqual(1);
      expect(parsed.symbols[0].name).toBe("config");
      expect(parsed.symbols[0].kind).toBe("const");
    });

    it("runs 'aice context' on sample.json and packages file content", () => {
      const samplePath = path.join(tmpDir, "sample.json");
      const res = runCli(["context", samplePath, "--no-callers"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("# AICE Context Pack:");
      expect(res.stdout).toContain("aice-data-service");
    });

    it("runs 'aice context --outline-target' on sample.json and packages outline representation", () => {
      const samplePath = path.join(tmpDir, "sample.json");
      const res = runCli(["context", samplePath, "--outline-target", "--no-callers"]);

      expect(res.status).toBe(0);
      expect(res.stdout).toContain("pub const config");
    });

    it("runs 'aice compile' on a .json.aice file and compiles to .json", () => {
      const aiceFile = path.join(tmpDir, "server_config.json.aice");
      fs.writeFileSync(
        aiceFile,
        `module server_config\n\npub const config = { port: 9000, secure: false }\n`,
        "utf-8",
      );

      const res = runCli(["compile", aiceFile], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Compiled");
      expect(res.stdout).toContain("[json]");

      const generatedJson = path.join(tmpDir, "server_config.json");
      expect(fs.existsSync(generatedJson)).toBe(true);

      const content = JSON.parse(fs.readFileSync(generatedJson, "utf-8"));
      expect(content).toEqual({ port: 9000, secure: false });
    });

    it("runs 'aice compile' on a .yaml.aice file and compiles to .yaml", () => {
      const aiceFile = path.join(tmpDir, "manifest.yaml.aice");
      fs.writeFileSync(
        aiceFile,
        `# App Manifest\nmodule manifest\n\npub const config = { name: "demo", replicas: 2 }\n`,
        "utf-8",
      );

      const res = runCli(["compile", aiceFile], tmpDir);
      expect(res.status).toBe(0);
      expect(res.stdout).toContain("Compiled");
      expect(res.stdout).toContain("[yaml]");

      const generatedYaml = path.join(tmpDir, "manifest.yaml");
      expect(fs.existsSync(generatedYaml)).toBe(true);

      const content = YAML.parse(fs.readFileSync(generatedYaml, "utf-8"));
      expect(content).toEqual({ name: "demo", replicas: 2 });
    });
  });

  describe("6. Real-World Edge Cases & Robustness", () => {
    it("handles special keys containing dashes, dots, spaces, numbers, and empty string", () => {
      const original = {
        "content-type": "application/json",
        "app.config.path": "/etc/aice",
        "hello world": "greeting",
        "123": "numeric-key",
        "": "empty-key",
      };

      const jsonStr = JSON.stringify(original);
      const decomp = decompile(jsonStr, "json");
      const ast = parse(decomp.aice);
      const reEmitted = emitTarget(ast, "json");

      expect(JSON.parse(reEmitted)).toEqual(original);
    });

    it("handles multiple top-level ConstDecl items and combines them into an object", () => {
      const aiceSource = `module settings\n\npub const host = "localhost"\npub const port = 5000\npub const debug = true\n`;
      const ast = parse(aiceSource);

      const jsonEmitted = emitTarget(ast, "json");
      expect(JSON.parse(jsonEmitted)).toEqual({
        host: "localhost",
        port: 5000,
        debug: true,
      });

      const yamlEmitted = emitTarget(ast, "yaml");
      expect(YAML.parse(yamlEmitted)).toEqual({
        host: "localhost",
        port: 5000,
        debug: true,
      });
    });

    it("handles top-level arrays in JSON and YAML", () => {
      const listData = ["item1", 42, true, null, { sub: "val" }];

      const jsonStr = JSON.stringify(listData);
      const jsonDecomp = decompile(jsonStr, "json");
      const jsonAst = parse(jsonDecomp.aice);
      expect(JSON.parse(emitTarget(jsonAst, "json"))).toEqual(listData);

      const yamlStr = YAML.stringify(listData);
      const yamlDecomp = decompile(yamlStr, "yaml");
      const yamlAst = parse(yamlDecomp.aice);
      expect(YAML.parse(emitTarget(yamlAst, "yaml"))).toEqual(listData);
    });

    it("handles top-level scalar primitives in JSON and YAML", () => {
      const scalarNumber = 123.456;
      const numDecomp = decompile(JSON.stringify(scalarNumber), "json");
      const numAst = parse(numDecomp.aice);
      expect(JSON.parse(emitTarget(numAst, "json"))).toBe(scalarNumber);

      const scalarString = "Hello AICE World";
      const strDecomp = decompile(JSON.stringify(scalarString), "json");
      const strAst = parse(strDecomp.aice);
      expect(JSON.parse(emitTarget(strAst, "json"))).toBe(scalarString);
    });
  });
});
