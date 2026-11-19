import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CppDecompiler } from "../../src/decompiler/cpp-decompiler.js";
import { CSharpDecompiler } from "../../src/decompiler/csharp-decompiler.js";
import { decompileGo } from "../../src/decompiler/go-decompiler.js";
import { decompileRust } from "../../src/decompiler/rust-decompiler.js";
import { AiceMcpServer, type McpToolCallResult } from "../../src/mcp/server.js";
import { validateNativeSyntax } from "../../src/tools/syntax-validator.js";

const CLI_PATH = path.resolve(process.cwd(), "bin/aice.ts");
const TSX_BIN = path.resolve(process.cwd(), "node_modules/.bin/tsx");

function runCli(args: string[], cwd: string, telemetryDir: string, opts?: { input?: string }) {
  return spawnSync(TSX_BIN, [CLI_PATH, ...args], {
    cwd,
    input: opts?.input,
    env: {
      ...process.env,
      AICE_TELEMETRY_DIR: telemetryDir,
      NO_COLOR: "1",
    },
    encoding: "utf-8",
    timeout: 25000,
  });
}

async function callMcpTool(
  server: AiceMcpServer,
  name: "aice_read" | "aice_splice",
  args: Record<string, unknown>,
  id: string | number = 1,
): Promise<McpToolCallResult> {
  const res = (await server.handleRequest({
    jsonrpc: "2.0",
    id,
    method: "tools/call",
    params: { name, arguments: args },
  })) as { result?: McpToolCallResult; error?: unknown };
  expect(res.error).toBeUndefined();
  if (!res.result) {
    throw new Error(`Expected MCP result for ${name}`);
  }
  return res.result;
}

describe("Phase 5A Integration: Universal Text Files, Binary Guard & Polyglot Validation (CLI + MCP)", () => {
  let tmpDir: string;
  let telemetryDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-p5-integration-"));
    telemetryDir = path.join(tmpDir, ".telemetry");
    fs.mkdirSync(telemetryDir, { recursive: true });
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: false }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  describe("1. Universal Arbitrary & Unknown Text/String-Like Files (CLI + MCP)", () => {
    const UNIVERSAL_FIXTURES: Record<string, string> = {
      "assets/logo.svg":
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" data-tag="UNI_MARKER_V1"/></svg>\n',
      "config/settings.xml":
        '<?xml version="1.0" encoding="UTF-8"?>\n<settings><flag name="marker">UNI_MARKER_V1</flag></settings>\n',
      "config/app.toml": '[service]\nname = "aice"\nmarker = "UNI_MARKER_V1"\n',
      "config/legacy.ini": "[core]\nmarker=UNI_MARKER_V1\nmode=safe\n",
      "data/metrics.csv": "id,tag,value\n1,UNI_MARKER_V1,42\n",
      "logs/runtime.log": "2026-11-19T00:00:00Z INFO startup marker=UNI_MARKER_V1\n",
      "infra/main.tf": 'variable "marker" {\n  default = "UNI_MARKER_V1"\n}\n',
      "docs/guide.rst": "Guide Title\n===========\n\nMarker: UNI_MARKER_V1\n",
      "docs/page.mdx": '# MDX Page\n\n<Badge label="UNI_MARKER_V1" />\n',
      Makefile: "all:\n\t@echo UNI_MARKER_V1\n",
      NOTES: "Release notes checklist: UNI_MARKER_V1\n",
      ".env.local": "APP_MARKER=UNI_MARKER_V1\n",
      ".customrc": "preset=strict\nmarker=UNI_MARKER_V1\n",
      "blobs/inline-svg.html":
        '<div class="icon"><img src="data:image/svg+xml;utf8,<svg><rect width=\'4\' height=\'4\'/></svg>" alt="UNI_MARKER_V1" /></div>\n',
      "blobs/payload.customblob":
        'HEADER=1\nMARKER=UNI_MARKER_V1\nINLINE_SVG=<svg><path d="M0 0"/></svg>\n',
    };

    function seedUniversalFixtures(root: string): void {
      for (const [rel, content] of Object.entries(UNIVERSAL_FIXTURES)) {
        const abs = path.join(root, rel);
        fs.mkdirSync(path.dirname(abs), { recursive: true });
        fs.writeFileSync(abs, content, "utf-8");
      }
    }

    it("supports CLI find, search, and read across all arbitrary/unknown text files", () => {
      seedUniversalFixtures(tmpDir);

      // 1. CLI `find` discovers all arbitrary text files (compact dir grouping: `dir/: fileA, fileB`)
      const findRes = runCli(["find", "."], tmpDir, telemetryDir);
      expect(findRes.status).toBe(0);
      for (const entry of [
        "assets/logo.svg",
        "config/:",
        "settings.xml",
        "app.toml",
        "legacy.ini",
        "data/metrics.csv",
        "logs/runtime.log",
        "infra/main.tf",
        "docs/:",
        "guide.rst",
        "page.mdx",
        "Makefile",
        "NOTES",
        "blobs/:",
        "inline-svg.html",
        "payload.customblob",
      ]) {
        expect(findRes.stdout).toContain(entry);
      }

      // 2. CLI `search` locates UNI_MARKER_V1 across arbitrary formats (including extensionless & unknown extensions)
      const searchRes = runCli(["search", "UNI_MARKER_V1", "."], tmpDir, telemetryDir);
      expect(searchRes.status).toBe(0);
      expect(searchRes.stdout).toContain("assets/logo.svg");
      expect(searchRes.stdout).toContain("config/app.toml");
      expect(searchRes.stdout).toContain("Makefile");
      expect(searchRes.stdout).toContain("NOTES");
      expect(searchRes.stdout).toContain("blobs/payload.customblob");

      // 3. CLI `read` reads arbitrary files including dotfiles, extensionless, inline SVG & .customblob
      const readRes = runCli(
        [
          "read",
          "assets/logo.svg",
          "Makefile",
          ".env.local",
          ".customrc",
          "blobs/inline-svg.html",
          "blobs/payload.customblob",
        ],
        tmpDir,
        telemetryDir,
      );
      expect(readRes.status).toBe(0);
      expect(readRes.stdout).toContain("UNI_MARKER_V1");
      expect(readRes.stdout).toContain("data:image/svg+xml");
      expect(readRes.stdout).toContain("APP_MARKER=UNI_MARKER_V1");
      expect(readRes.stdout).toContain("preset=strict");
    });

    it("supports CLI write and atomic splice --stdin across .svg, .toml, Makefile, dotfiles & .customblob", () => {
      seedUniversalFixtures(tmpDir);

      // 1. CLI `write` creates a brand-new unknown extension file cleanly
      const writeRes = runCli(
        ["write", "blobs/created.customblob", "-c", "KIND=CREATED\nSVG=<svg><g/></svg>\n"],
        tmpDir,
        telemetryDir,
      );
      expect(writeRes.status).toBe(0);
      expect(fs.readFileSync(path.join(tmpDir, "blobs/created.customblob"), "utf-8")).toContain(
        "KIND=CREATED",
      );

      // 2. CLI `splice --stdin` mutates .svg, .toml, Makefile, .env.local, and .customblob atomically in 1 turn
      const spliceStream = [
        "=== assets/logo.svg ===",
        "<<<",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" data-tag="UNI_MARKER_V1"/></svg>',
        "===",
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16"><circle cx="8" cy="8" r="6" data-tag="UNI_MARKER_V2"/></svg>',
        ">>>",
        "=== config/app.toml:L1-L3 ===",
        "[service]",
        'name = "aice"',
        'marker = "UNI_MARKER_V2"',
        "=== Makefile:L1-L2 ===",
        "all:",
        "\t@echo UNI_MARKER_V2",
        "=== .env.local:L1-L1 ===",
        "APP_MARKER=UNI_MARKER_V2",
        "=== blobs/payload.customblob ===",
        "<<<",
        "HEADER=1",
        "MARKER=UNI_MARKER_V1",
        "===",
        "HEADER=1",
        "MARKER=UNI_MARKER_V2",
        ">>>",
      ].join("\n");
      const spliceRes = runCli(["splice", "--stdin"], tmpDir, telemetryDir, {
        input: spliceStream,
      });
      expect(spliceRes.status).toBe(0);
      expect(fs.readFileSync(path.join(tmpDir, "assets/logo.svg"), "utf-8")).toContain(
        "UNI_MARKER_V2",
      );
      expect(fs.readFileSync(path.join(tmpDir, "config/app.toml"), "utf-8")).toContain(
        "UNI_MARKER_V2",
      );
      expect(fs.readFileSync(path.join(tmpDir, "Makefile"), "utf-8")).toContain("UNI_MARKER_V2");
      expect(fs.readFileSync(path.join(tmpDir, ".env.local"), "utf-8")).toContain("UNI_MARKER_V2");
      expect(fs.readFileSync(path.join(tmpDir, "blobs/payload.customblob"), "utf-8")).toContain(
        "UNI_MARKER_V2",
      );
    });

    it("exposes strictly 2 MCP tools (aice_read, aice_splice) and handles all universal text formats end-to-end", async () => {
      seedUniversalFixtures(tmpDir);
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // Enforce strict 2-tool MCP contract via JSON-RPC `tools/list`
      const listRes = (await server.handleRequest({
        jsonrpc: "2.0",
        id: "list-1",
        method: "tools/list",
      })) as { result?: { tools: Array<{ name: string }> }; error?: unknown };
      expect(listRes.error).toBeUndefined();
      expect(listRes.result?.tools.map((t) => t.name)).toEqual(["aice_read", "aice_splice"]);

      // MCP `aice_read` filesOnly discovery (compact grouped directory output)
      const filesRes = await callMcpTool(server, "aice_read", { path: ".", filesOnly: true }, 2);
      expect(filesRes.isError).toBeFalsy();
      const filesText = filesRes.content[0]?.text ?? "";
      expect(filesText).toContain("assets/logo.svg");
      expect(filesText).toContain("blobs/:");
      expect(filesText).toContain("payload.customblob");
      expect(filesText).toContain("NOTES");

      // MCP `aice_read` search across arbitrary extensions
      const searchRes = await callMcpTool(
        server,
        "aice_read",
        { path: ".", search: "UNI_MARKER_V1" },
        3,
      );
      expect(searchRes.isError).toBeFalsy();
      const searchText = searchRes.content[0]?.text ?? "";
      expect(searchText).toContain("config/legacy.ini");
      expect(searchText).toContain("data/metrics.csv");
      expect(searchText).toContain("infra/main.tf");
      expect(searchText).toContain("docs/guide.rst");
      expect(searchText).toContain("docs/page.mdx");

      // MCP `aice_splice` creates a new unknown-extension file and splices dotfiles/extensionless/CSV/INI
      const createRes = await callMcpTool(
        server,
        "aice_splice",
        {
          filePath: "blobs/mcp-created.customblob",
          code: "SOURCE=MCP\nDATA=data:image/svg+xml;base64,PHN2Zy8+\n",
        },
        4,
      );
      expect(createRes.isError).toBeFalsy();
      expect(fs.readFileSync(path.join(tmpDir, "blobs/mcp-created.customblob"), "utf-8")).toContain(
        "SOURCE=MCP",
      );

      const batchRes = await callMcpTool(
        server,
        "aice_splice",
        {
          code: [
            "=== NOTES:L1-L1 ===",
            "Release notes checklist: MCP_UPDATED",
            "=== .customrc ===",
            "<<<",
            "preset=strict",
            "marker=UNI_MARKER_V1",
            "===",
            "preset=strict",
            "marker=MCP_UPDATED",
            ">>>",
            "=== data/metrics.csv:L2-L2 ===",
            "1,MCP_UPDATED,99",
          ].join("\n"),
        },
        5,
      );
      expect(batchRes.isError).toBeFalsy();

      // MCP `aice_read` immediately reflects fresh post-splice contents (no stale cache)
      const verifyRead = await callMcpTool(
        server,
        "aice_read",
        { targets: ["NOTES", ".customrc", "data/metrics.csv"] },
        6,
      );
      expect(verifyRead.isError).toBeFalsy();
      const verifyText = verifyRead.content[0]?.text ?? "";
      expect(verifyText).toContain("MCP_UPDATED");
      expect(verifyText).not.toContain("UNI_MARKER_V1");
    });
  });

  describe("2. Binary Guard Protections & Transactional Rollback (CLI + MCP)", () => {
    const PNG_BYTES = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44,
      0x52, 0xde, 0xad, 0xbe, 0xef,
    ]);
    const WASM_BYTES = Buffer.from([
      0x00, 0x61, 0x73, 0x6d, 0x01, 0x00, 0x00, 0x00, 0x01, 0x04, 0x01, 0x60, 0x00, 0x00,
    ]);
    const NUL_TEXT_BYTES = Buffer.from("BIN_NEEDLE_SECRET\x00\x01\x02PAYLOAD", "binary");

    function seedBinaryWorkspace(root: string): void {
      fs.writeFileSync(path.join(root, "icon.png"), PNG_BYTES);
      fs.writeFileSync(path.join(root, "module.wasm"), WASM_BYTES);
      fs.writeFileSync(path.join(root, "disguised.dat"), NUL_TEXT_BYTES);
      fs.writeFileSync(path.join(root, "safe.toml"), 'status = "ORIGINAL_SAFE"\n', "utf-8");
    }

    it("skips .png, .wasm, and NUL-byte files cleanly in CLI find, search, and read", () => {
      seedBinaryWorkspace(tmpDir);

      const findRes = runCli(["find", "."], tmpDir, telemetryDir);
      expect(findRes.status).toBe(0);
      expect(findRes.stdout).toContain("safe.toml");
      expect(findRes.stdout).not.toContain("icon.png");
      expect(findRes.stdout).not.toContain("module.wasm");
      expect(findRes.stdout).not.toContain("disguised.dat");

      const searchRes = runCli(["search", "BIN_NEEDLE_SECRET", "."], tmpDir, telemetryDir);
      expect(searchRes.status).toBe(0);
      expect(searchRes.stdout).not.toContain("disguised.dat");
      expect(searchRes.stdout).not.toContain("icon.png");

      const dirReadRes = runCli(["read", "."], tmpDir, telemetryDir);
      expect(dirReadRes.status).toBe(0);
      expect(dirReadRes.stdout).toContain("safe.toml");
      expect(dirReadRes.stdout).not.toContain("icon.png");
      expect(dirReadRes.stdout).not.toContain("module.wasm");
      expect(dirReadRes.stdout).not.toContain("disguised.dat");
    });

    it("rejects binary CLI splice/write without corruption and rolls back mixed batches atomically", () => {
      seedBinaryWorkspace(tmpDir);

      const writePng = runCli(["write", "icon.png", "-c", "corrupted"], tmpDir, telemetryDir);
      expect(writePng.status).not.toBe(0);
      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "icon.png")), PNG_BYTES)).toBe(0);

      const writeWasm = runCli(["write", "new.wasm", "-c", "fake wasm"], tmpDir, telemetryDir);
      expect(writeWasm.status).not.toBe(0);
      expect(fs.existsSync(path.join(tmpDir, "new.wasm"))).toBe(false);

      const spliceNul = runCli(
        ["splice", "disguised.dat", "-s", "overwrite", "-c", "plain text"],
        tmpDir,
        telemetryDir,
      );
      expect(spliceNul.status).not.toBe(0);
      expect(
        Buffer.compare(fs.readFileSync(path.join(tmpDir, "disguised.dat")), NUL_TEXT_BYTES),
      ).toBe(0);

      const rollbackStream = [
        "=== safe.toml:L1-L1 ===",
        'status = "SHOULD_ROLLBACK"',
        "=== icon.png:overwrite ===",
        "corrupted binary payload",
      ].join("\n");
      const batchRes = runCli(["splice", "--stdin"], tmpDir, telemetryDir, {
        input: rollbackStream,
      });
      expect(batchRes.status).not.toBe(0);
      expect(fs.readFileSync(path.join(tmpDir, "safe.toml"), "utf-8")).toBe(
        'status = "ORIGINAL_SAFE"\n',
      );
      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "icon.png")), PNG_BYTES)).toBe(0);
    });

    it("enforces binary guard & transactional rollback through MCP aice_read and aice_splice", async () => {
      seedBinaryWorkspace(tmpDir);
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // MCP discovery/search omit binaries
      const listFiles = await callMcpTool(server, "aice_read", { path: ".", filesOnly: true }, 10);
      expect(listFiles.isError).toBeFalsy();
      const text = listFiles.content[0]?.text ?? "";
      expect(text).toContain("safe.toml");
      expect(text).not.toContain("icon.png");
      expect(text).not.toContain("module.wasm");
      expect(text).not.toContain("disguised.dat");

      // Direct MCP read on a binary file emits a safe skip notice without leaking binary bytes
      const readBin = await callMcpTool(server, "aice_read", { path: "icon.png" }, 11);
      const readBinText = readBin.content[0]?.text ?? "";
      expect(readBinText).toMatch(/\[binary file skipped:/i);
      expect(readBinText).not.toContain("IHDR");

      // MCP splice rejecting NUL-byte payload into text file without corruption
      const nulWrite = await callMcpTool(
        server,
        "aice_splice",
        { filePath: "safe.toml", symbol: "overwrite", code: "bad\x00content" },
        12,
      );
      expect(nulWrite.isError).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "safe.toml"), "utf-8")).toBe(
        'status = "ORIGINAL_SAFE"\n',
      );

      // MCP batch stream rollback: valid safe.toml update + rejected module.wasm write
      const mcpRollback = await callMcpTool(
        server,
        "aice_splice",
        {
          code: [
            "=== safe.toml:L1-L1 ===",
            'status = "MCP_SHOULD_ROLLBACK"',
            "=== module.wasm:overwrite ===",
            "not valid wasm text",
          ].join("\n"),
        },
        13,
      );
      expect(mcpRollback.isError).toBe(true);
      expect(fs.readFileSync(path.join(tmpDir, "safe.toml"), "utf-8")).toBe(
        'status = "ORIGINAL_SAFE"\n',
      );
      expect(Buffer.compare(fs.readFileSync(path.join(tmpDir, "module.wasm")), WASM_BYTES)).toBe(0);
    });
  });

  describe("3. Polyglot Language Accuracy & Pre-Write Syntax Validation (CLI + MCP)", () => {
    it("validates, decompiles accurately, and rejects malformed code across Rust, C++, Go, C#, Kotlin, PHP, Java, Python & XML/SVG via MCP", async () => {
      const server = new AiceMcpServer({ workspaceRoot: tmpDir });

      // Seed valid polyglot fixtures showcasing every hardened construct
      const validFiles: Record<string, string> = {
        "src/engine.rs": [
          "/* outer /* nested block comment */ still outer */",
          "pub struct Config { pub timeout: usize, pub retries: usize }",
          "pub fn pick_limit<'a>(label: &'static str, base: Config, raw: i64) -> (usize, &'a str) {",
          '    let raw_str = r#"raw "quoted" {not a block}"#;',
          "    let _ch = 'x';",
          "    let cfg = Config { timeout: 30, ..base };",
          "    let clamped = std::cmp::min(cfg.timeout, raw as usize);",
          "    let _ = (label, raw_str, _ch);",
          '    (clamped, "ok")',
          "}",
          "",
        ].join("\n"),
        "src/math.cpp": [
          "#include <algorithm>",
          "#include <string>",
          "int computeLimit(int x) {",
          "    const int cap = 1'000'000;",
          '    const char* raw = R"delim(literal ) and { brace)delim";',
          "    (void)raw;",
          "    return std::min(x, cap);",
          "}",
          "",
        ].join("\n"),
        "src/worker.go": [
          "package worker",
          'import "fmt"',
          "func runJob(input string) (int, error) {",
          "    var count int",
          "    raw := `backtick {raw} string`",
          "    r := 'G'",
          "    if len(raw) == 0 && r == 'X' {",
          '        fmt.Println("unexpected")',
          "        return count, nil",
          "    }",
          "    return count + len(input), nil",
          "}",
          "",
        ].join("\n"),
        "src/Settlement.cs": [
          "namespace Payments {",
          "    public class Outer {",
          "        public class Inner {",
          "            public string Format(string id) {",
          '                var verbatim = @"C:\\data\\{not_interp}";',
          '                var raw = """',
          '                    {"status": "ok"}',
          '                    """;',
          "                return verbatim + raw + id;",
          "            }",
          "        }",
          "    }",
          "}",
          "",
        ].join("\n"),
        "src/Score.kt": [
          "/* outer /* nested kotlin comment */ end */",
          "class ScoreEngine {",
          "    fun compute(name: String): String {",
          '        val raw = """line1 {not_brace} line2"""',
          '        return "$name:$raw"',
          "    }",
          "}",
          "",
        ].join("\n"),
        "src/Invoice.php": [
          "<?php",
          "function renderTemplate(string $title): string {",
          "    $doc = <<<EOT",
          "Title: $title {not a syntax brace}",
          "EOT;",
          "    return $doc;",
          "}",
          "",
        ].join("\n"),
        "src/Greeter.java": [
          "public class Greeter {",
          "    public String greet(String user) {",
          '        String block = """',
          '            Hello, "world" {text block}',
          '            """;',
          "        return block + user;",
          "    }",
          "}",
          "",
        ].join("\n"),
        "src/pipeline.py": [
          "def classify(val: int) -> str:",
          "    tags = {'alpha', 'beta'}",
          "    norm = lambda x: x + 1",
          "    match val:",
          "        case 0:",
          '            return "zero"',
          "        case _:",
          '            return f"{norm(val)}:{len(tags)}"',
          "",
          "def placeholder():",
          "    ...",
          "",
        ].join("\n"),
        "assets/diagram.xml": [
          '<?xml version="1.0" encoding="UTF-8"?>',
          "<diagram>",
          '  <node id="n1" label="Start" />',
          '  <edge from="n1" to="n1" />',
          "</diagram>",
          "",
        ].join("\n"),
        "assets/badge.svg": [
          '<svg xmlns="http://www.w3.org/2000/svg" width="32" height="32">',
          '  <g id="layer1">',
          '    <rect x="0" y="0" width="32" height="32" />',
          "  </g>",
          "</svg>",
          "",
        ].join("\n"),
      };

      // 1. Write all valid polyglot files in one MCP batch stream — all must pass pre-write validation
      const createStream = Object.entries(validFiles)
        .map(([rel, body]) => `=== ${rel} ===\n${body.trimEnd()}`)
        .join("\n");
      const createRes = await callMcpTool(server, "aice_splice", { code: createStream }, 20);
      expect(createRes.isError).toBeFalsy();

      // 2. Verify hardened decompiler accuracy on Rust, C++, Go, C# constructs
      const rustMod = decompileRust(
        [
          "pub struct Opts { pub a: i32, pub b: i32 }",
          "pub fn f(x: i64, base: Opts) -> usize {",
          "    let o = Opts { a: 1, ..base };",
          "    A::B::C(o.a, x as usize)",
          "}",
        ].join("\n"),
        "src/sample.rs",
      );
      expect(JSON.stringify(rustMod)).toContain('"isScopeAccess":true');
      expect(JSON.stringify(rustMod)).toContain("..base");

      const cppMod = new CppDecompiler(
        "int g(int a) { int cap = 1'000'000; return std::min(a, cap); }",
        "src/sample.cpp",
      ).decompile();
      expect(JSON.stringify(cppMod)).toContain('"isScopeAccess":true');

      const goMod = decompileGo(
        "package p\nfunc h() (int, error) {\n  var n int\n  val, err := step()\n  if err != nil {\n    logErr(err)\n    return n, err\n  }\n  return val, nil\n}\n",
        "src/sample.go",
      );
      expect(JSON.stringify(goMod)).toContain("logErr");

      const csMod = new CSharpDecompiler(
        "public class Outer { public class Inner { public int Run() { return 1; } } }",
        "src/Sample.cs",
      ).decompile();
      expect(JSON.stringify(csMod)).toContain("Outer.Inner");

      // 3. Verify native `.java` symbol splice succeeds cleanly via MCP
      const javaSplice = await callMcpTool(
        server,
        "aice_splice",
        {
          filePath: "src/Greeter.java",
          symbol: "Greeter.greet",
          code: [
            "    public String greet(String user) {",
            '        String block = """',
            "            Updated Java text block",
            '            """;',
            "        return block + user;",
            "    }",
          ].join("\n"),
        },
        21,
      );
      expect(javaSplice.isError).toBeFalsy();
      expect(fs.readFileSync(path.join(tmpDir, "src/Greeter.java"), "utf-8")).toContain(
        "Updated Java text block",
      );

      // 4. Direct syntax validator checks for nested comments across Rust & Kotlin
      expect(validateNativeSyntax("/* outer /* inner */", "rust", "src/engine.rs").valid).toBe(
        false,
      );
      expect(validateNativeSyntax("/* outer /* inner */", "kotlin", "src/Score.kt").valid).toBe(
        false,
      );

      // 5. Pre-write syntax validation rejects invalid native payloads across EVERY language via MCP & leaves disk untouched
      const invalidCases: Array<{
        filePath: string;
        symbol: string;
        badCode: string;
        expectPattern: RegExp;
      }> = [
        {
          filePath: "src/engine.rs",
          symbol: "L1-L10",
          badCode:
            "/* outer /* inner */ unclosed nested comment\npub fn pick_limit() -> usize { let x = (1 + 2]; x }",
          expectPattern: /Line \d+:\d+|unterminated|comment|mismatch|syntax/i,
        },
        {
          filePath: "src/math.cpp",
          symbol: "L1-L8",
          badCode: 'int computeLimit(int x) { const char* s = R"delim(never closed; return x; }',
          expectPattern: /Line \d+:\d+|unterminated|raw|syntax/i,
        },
        {
          filePath: "src/worker.go",
          symbol: "L1-L12",
          badCode: "package worker\nfunc runJob() { r := 'ab'",
          expectPattern: /Line \d+:\d+|rune|brace|unclosed|syntax/i,
        },
        {
          filePath: "src/Settlement.cs",
          symbol: "L1-L14",
          badCode: 'namespace Payments { public class Outer { string s = @"unclosed; } }',
          expectPattern: /Line \d+:\d+|unterminated|string|syntax/i,
        },
        {
          filePath: "src/Score.kt",
          symbol: "L1-L7",
          badCode:
            "/* outer /* nested */ still open\nclass ScoreEngine { fun compute() = (1 + 2] }",
          expectPattern: /Line \d+:\d+|unterminated|comment|mismatch|syntax/i,
        },
        {
          filePath: "src/Invoice.php",
          symbol: "L1-L7",
          badCode: "<?php\nfunction renderTemplate() {\n    $s = <<<EOT\nnever closed\n}",
          expectPattern: /Line \d+:\d+|heredoc|unterminated|syntax/i,
        },
        {
          filePath: "src/Greeter.java",
          symbol: "L1-L8",
          badCode: 'public class Greeter { String s = """unclosed text block; }',
          expectPattern: /Line \d+:\d+|unterminated|text block|syntax/i,
        },
        {
          filePath: "src/pipeline.py",
          symbol: "L1-L11",
          badCode: "def classify(val: int) -> str:\n    if (val > 0:\n        return 'x'",
          expectPattern: /Line \d+:\d+|syntax|invalid|unclosed/i,
        },
        {
          filePath: "assets/diagram.xml",
          symbol: "overwrite",
          badCode: '<diagram>\n  <node id="n1">\n</diagram>\n',
          expectPattern: /Line \d+:\d+.*Mismatched XML closing tag/i,
        },
        {
          filePath: "assets/badge.svg",
          symbol: "overwrite",
          badCode: '<svg xmlns="http://www.w3.org/2000/svg">\n  <g>\n    <rect />\n</svg>\n',
          expectPattern: /Line \d+:\d+.*Mismatched XML closing tag/i,
        },
      ];

      let reqId = 30;
      for (const tc of invalidCases) {
        const before = fs.readFileSync(path.join(tmpDir, tc.filePath), "utf-8");
        const res = await callMcpTool(
          server,
          "aice_splice",
          { filePath: tc.filePath, symbol: tc.symbol, code: tc.badCode },
          reqId++,
        );
        expect(res.isError, `Expected pre-write rejection for ${tc.filePath}`).toBe(true);
        const msg = res.content[0]?.text ?? "";
        expect(msg, `Unexpected diagnostic for ${tc.filePath}: ${msg}`).toMatch(tc.expectPattern);
        expect(fs.readFileSync(path.join(tmpDir, tc.filePath), "utf-8")).toBe(before);
      }

      // Also verify unclosed XML tag specifically reports Line:Col
      const unclosedXml = await callMcpTool(
        server,
        "aice_splice",
        {
          filePath: "assets/diagram.xml",
          symbol: "overwrite",
          code: '<diagram>\n  <node id="open">\n',
        },
        99,
      );
      expect(unclosedXml.isError).toBe(true);
      expect(unclosedXml.content[0]?.text ?? "").toMatch(/Line \d+:\d+.*Unclosed XML tag/i);
    });

    it("verifies CLI pre-write validation & valid splice round-trip on .rs, .java, and .svg/.xml", () => {
      fs.mkdirSync(path.join(tmpDir, "src"), { recursive: true });
      fs.writeFileSync(
        path.join(tmpDir, "src/icon.svg"),
        '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="4" cy="4" r="2"/></svg>\n',
        "utf-8",
      );
      fs.writeFileSync(
        path.join(tmpDir, "src/App.java"),
        'public class App {\n    public String msg() {\n        return "v1";\n    }\n}\n',
        "utf-8",
      );

      // Valid CLI read + splice on .java and .svg
      const readRes = runCli(["read", "src/App.java", "src/icon.svg"], tmpDir, telemetryDir);
      expect(readRes.status).toBe(0);
      expect(readRes.stdout).toContain("public class App");
      expect(readRes.stdout).toContain("<circle");

      const validSplice = runCli(["splice", "--stdin"], tmpDir, telemetryDir, {
        input: [
          "=== src/App.java:App.msg ===",
          "    public String msg() {",
          '        return """',
          "            v2",
          '            """;',
          "    }",
          "=== src/icon.svg:L1-L1 ===",
          '<svg xmlns="http://www.w3.org/2000/svg"><circle cx="8" cy="8" r="4"/></svg>',
        ].join("\n"),
      });
      expect(validSplice.status).toBe(0);
      expect(fs.readFileSync(path.join(tmpDir, "src/App.java"), "utf-8")).toContain("v2");
      expect(fs.readFileSync(path.join(tmpDir, "src/icon.svg"), "utf-8")).toContain('r="4"');

      // Malformed SVG rejected via CLI with Line:Col and zero disk corruption
      const badSvg = runCli(
        ["write", "src/icon.svg", "-c", "<svg>\n  <g>\n</svg>\n"],
        tmpDir,
        telemetryDir,
      );
      expect(badSvg.status).not.toBe(0);
      expect(`${badSvg.stderr}\n${badSvg.stdout}`).toMatch(/Line \d+:\d+/);
      expect(fs.readFileSync(path.join(tmpDir, "src/icon.svg"), "utf-8")).toContain('r="4"');
    });
  });
});
