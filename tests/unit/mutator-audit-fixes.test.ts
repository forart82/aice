import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createFile, parseMultiFileCreateStream } from "../../src/tools/create.js";
import {
  applyPatch,
  computeSemanticDiff,
  generateSemanticPatch,
  patchFile,
} from "../../src/tools/diff-patch.js";
import {
  parseMultiBlockSpliceStream,
  splice,
  spliceBatch,
  spliceNativeSource,
  spliceSource,
} from "../../src/tools/splice.js";
import { validateNativeSyntax } from "../../src/tools/syntax-validator.js";

describe("Mutator Audit Fixes (#7 §1 items 1–17)", () => {
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-mutator-audit-"));
    fs.writeFileSync(
      path.join(tmpDir, "aice.config.json"),
      JSON.stringify({ enabled: true, idiomsEnabled: true }, null, 2),
      "utf-8",
    );
  });

  afterEach(() => {
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it("(#7.1) multi-edit CSS, HTML, and Twig dialect splices preserve middle content once and keep @media closing braces", () => {
    const cssSource = [
      ".btn { color: red; }",
      ".middle { margin: 8px; }",
      ".card { padding: 4px; }",
      "",
    ].join("\n");
    const cssRes = spliceNativeSource(
      cssSource,
      {
        edits: [
          { symbol: ".btn", code: ".btn { color: blue; }" },
          { symbol: ".card", code: ".card { padding: 12px; }" },
        ],
      },
      "styles.css",
    );
    expect(cssRes.modifiedCode).toContain(".btn { color: blue; }");
    expect(cssRes.modifiedCode).toContain(".card { padding: 12px; }");
    expect(cssRes.modifiedCode.match(/\.middle/g)).toHaveLength(1);

    const mediaCss = ["@media (min-width: 768px) {", "  .hero { font-size: 18px; }", "}", ""].join(
      "\n",
    );
    const mediaRes = spliceNativeSource(
      mediaCss,
      { symbol: ".hero", code: ".hero { font-size: 24px; }" },
      "media.css",
    );
    expect(mediaRes.modifiedCode).toContain(".hero { font-size: 24px; }");
    expect(validateNativeSyntax(mediaRes.modifiedCode, "css", "media.css").valid).toBe(true);

    const htmlSource = [
      '<header id="header">Old Header</header>',
      '<main id="content">Keep Once</main>',
      '<footer id="footer">Old Footer</footer>',
      "",
    ].join("\n");
    const htmlRes = spliceNativeSource(
      htmlSource,
      {
        edits: [
          { symbol: "#header", code: '<header id="header">New Header</header>' },
          { symbol: "#footer", code: '<footer id="footer">New Footer</footer>' },
        ],
      },
      "index.html",
    );
    expect(htmlRes.modifiedCode).toContain("New Header");
    expect(htmlRes.modifiedCode).toContain("New Footer");
    expect(htmlRes.modifiedCode.match(/Keep Once/g)).toHaveLength(1);

    const twigSource = [
      "{% block header %}Old H{% endblock %}",
      "{% block body %}Middle Body{% endblock %}",
      "{% block footer %}Old F{% endblock %}",
      "",
    ].join("\n");
    const twigRes = spliceNativeSource(
      twigSource,
      {
        edits: [
          { symbol: "block header", code: "{% block header %}New H{% endblock %}" },
          { symbol: "block footer", code: "{% block footer %}New F{% endblock %}" },
        ],
      },
      "layout.twig",
    );
    expect(twigRes.modifiedCode).toContain("New H");
    expect(twigRes.modifiedCode).toContain("New F");
    expect(twigRes.modifiedCode.match(/Middle Body/g)).toHaveLength(1);
  });

  it("(#7.2) spliceBatch rolls back created files and idiom config on failure, and chains overlapping edits sequentially", async () => {
    const configPath = path.join(tmpDir, "aice.config.json");
    const origConfig = fs.readFileSync(configPath, "utf-8");
    const createdPath = path.join(tmpDir, "with_idiom.ts");
    const targetPath = path.join(tmpDir, "existing.ts");
    fs.writeFileSync(targetPath, "export const OK = 1;\n", "utf-8");

    const failingStream = parseMultiBlockSpliceStream(
      [
        `=== ${createdPath} ===`,
        "// @idiom $logTag => console.log($1)",
        "export const X = 1;",
        `=== ${targetPath}:MissingSymbol ===`,
        "export const MissingSymbol = 2;",
      ].join("\n"),
    );

    await expect(
      spliceBatch(failingStream?.batchItems ?? [], { projectRoot: tmpDir }),
    ).rejects.toThrow(/not found/i);

    expect(fs.existsSync(createdPath)).toBe(false);
    expect(fs.readFileSync(configPath, "utf-8")).toBe(origConfig);
    expect(fs.existsSync(path.join(tmpDir, ".aice-cache", "idioms.json"))).toBe(false);

    // Overlapping file-level hunk + symbol replacement in the same file composes cleanly without duplicating content
    const overlapFile = path.join(tmpDir, "overlap.ts");
    fs.writeFileSync(
      overlapFile,
      [
        "export const HEADER = 1;",
        "export class Box {",
        "  public get(): number {",
        "    return 10;",
        "  }",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );
    const overlapStream = parseMultiBlockSpliceStream(
      [
        `=== ${overlapFile} ===`,
        "<<<",
        "export const HEADER = 1;",
        "===",
        "export const HEADER = 2;",
        ">>>",
        `=== ${overlapFile}:Box.get ===`,
        "public get(): number {",
        "  return 99;",
        "}",
      ].join("\n"),
    );
    await spliceBatch(overlapStream?.batchItems ?? [], { projectRoot: tmpDir });
    const overlapContent = fs.readFileSync(overlapFile, "utf-8");
    expect(overlapContent).toContain("export const HEADER = 2;");
    expect(overlapContent).toContain("return 99;");
    expect(overlapContent.match(/export class Box/g)).toHaveLength(1);
  });

  it("(#7.3) comment banners, markdown horizontal rules, and non-file headers never hijack create/splice streams", () => {
    const createPayload = [
      "=== src/banner.ts ===",
      "// === Internal Section ===",
      "// FILE: fake.ts",
      "export const BANNER = '=== not_a_file.123 ===';",
      "=== docs/guide.md ===",
      "# Guide",
      "---",
      "Paragraph after horizontal rule.",
    ].join("\n");

    const createItems = parseMultiFileCreateStream(createPayload);
    expect(createItems).toHaveLength(2);
    expect(createItems?.[0]?.code).toContain("// === Internal Section ===");
    expect(createItems?.[0]?.code).toContain("// FILE: fake.ts");
    expect(createItems?.[1]?.code).toContain("---");

    const splicePayload = [
      "=== src/banner.ts:BANNER ===",
      "// === Keep Comment Banner ===",
      "// SYMBOL: not_a_header",
      "export const BANNER = 'updated';",
    ].join("\n");
    const spliceItems = parseMultiBlockSpliceStream(splicePayload);
    expect(spliceItems?.batchItems).toHaveLength(1);
    expect(spliceItems?.batchItems?.[0]?.code).toContain("// === Keep Comment Banner ===");
    expect(spliceItems?.batchItems?.[0]?.code).toContain("// SYMBOL: not_a_header");
  });

  it("(#7.5) Rust/C++ brace-language matcher respects container depth + 1 and ignores nested inner functions", () => {
    const rustSource = [
      "pub struct Counter {",
      "    pub v: i32,",
      "}",
      "",
      "impl Counter {",
      "    pub fn run(&self) -> i32 {",
      "        fn step() -> i32 {",
      "            1",
      "        }",
      "        step()",
      "    }",
      "",
      "    pub fn step(&mut self) {",
      "        self.v += 1;",
      "    }",
      "}",
      "",
    ].join("\n");

    const res = spliceNativeSource(
      rustSource,
      {
        symbol: "Counter.step",
        code: "pub fn step(&mut self) {\n    self.v += 10;\n}",
      },
      "counter.rs",
    );
    expect(res.modifiedCode).toContain("fn step() -> i32 {\n            1\n        }");
    expect(res.modifiedCode).toContain("self.v += 10;");
  });

  it("(#7.6) :imports merges cleanly on 0-import, 1-import, 'use client' prologues, and comments containing ')'", () => {
    // 0-import file
    const zeroImp = "export class App {}\n";
    const zeroRes = spliceNativeSource(
      zeroImp,
      { symbol: "imports", code: 'import { alpha } from "./alpha.js";' },
      "app.ts",
    );
    expect(zeroRes.modifiedCode).toBe(
      'import { alpha } from "./alpha.js";\n\nexport class App {}\n',
    );

    // 1-import file merges instead of overwriting
    const oneImp = 'import { alpha } from "./alpha.js";\n\nexport class App {}\n';
    const oneRes = spliceNativeSource(
      oneImp,
      { symbol: "imports", code: 'import { beta } from "./beta.js";' },
      "app.ts",
    );
    expect(oneRes.modifiedCode).toContain('import { alpha } from "./alpha.js";');
    expect(oneRes.modifiedCode).toContain('import { beta } from "./beta.js";');

    // "use client" directive stays at top
    const clientSrc =
      '"use client";\n\nimport { useState } from "react";\n\nexport function Widget() { return useState(0); }\n';
    const clientRes = spliceNativeSource(
      clientSrc,
      { symbol: "imports", code: 'import { useMemo } from "react";' },
      "widget.tsx",
    );
    expect(clientRes.modifiedCode.startsWith('"use client";')).toBe(true);
    expect(clientRes.modifiedCode).toContain("useState");
    expect(clientRes.modifiedCode).toContain("useMemo");

    // Interleaved comments (//, /* */, @ts-expect-error, inline comments) preserved on both append-new and replace-same-spec
    const commentedImpSrc = [
      'import { a } from "./a.js"; // inline a',
      "// @ts-expect-error legacy untyped module",
      'import legacy from "legacy-untyped";',
      "/* group: utils */",
      'import { u } from "./u.js";',
      "",
      "export const VAL = [a, legacy, u];",
      "",
    ].join("\n");

    const appendImpRes = spliceNativeSource(
      commentedImpSrc,
      { symbol: "imports", code: 'import { b } from "./b.js";' },
      "commented.ts",
    );
    expect(appendImpRes.modifiedCode).toContain("// inline a");
    expect(appendImpRes.modifiedCode).toContain(
      '// @ts-expect-error legacy untyped module\nimport legacy from "legacy-untyped";',
    );
    expect(appendImpRes.modifiedCode).toContain('/* group: utils */\nimport { u } from "./u.js";');
    expect(appendImpRes.modifiedCode).toContain('import { b } from "./b.js";');

    const replaceImpRes = spliceNativeSource(
      appendImpRes.modifiedCode,
      {
        symbol: "imports",
        code: [
          'import legacy, { legacyExtra } from "legacy-untyped";',
          'import { u, u2 } from "./u.js";',
        ].join("\n"),
      },
      "commented.ts",
    );
    expect(replaceImpRes.modifiedCode).toContain("// inline a");
    expect(replaceImpRes.modifiedCode).toContain(
      '// @ts-expect-error legacy untyped module\nimport legacy, { legacyExtra } from "legacy-untyped";',
    );
    expect(replaceImpRes.modifiedCode).toContain(
      '/* group: utils */\nimport { u, u2 } from "./u.js";',
    );
    expect(replaceImpRes.modifiedCode).toContain('import { b } from "./b.js";');

    // Python multi-line import with ')' in comment
    const pySrc = [
      "from pkg import (",
      "    first_fn,  # note: keep ) in comment",
      "    second_fn,",
      ")",
      "",
      "def main():",
      "    return first_fn()",
      "",
    ].join("\n");
    const pyRes = spliceNativeSource(pySrc, { symbol: "imports", code: "import os" }, "main.py");
    expect(pyRes.modifiedCode).toContain("second_fn,");
    expect(pyRes.modifiedCode).toContain("import os");
    expect(validateNativeSyntax(pyRes.modifiedCode, "python", "main.py").valid).toBe(true);
  });

  it("(#7.7) sibling auto-imports ignore comments/strings, local declarations, ambiguous multi-sibling exports, and preserve '$' identifiers", async () => {
    const srcDir = path.join(tmpDir, "src");
    fs.mkdirSync(srcDir, { recursive: true });

    fs.writeFileSync(
      path.join(srcDir, "tokens.ts"),
      "export const BASE_TOK = 'base';\nexport const $STORE_TOKEN = 'tok';\nexport const COMMENT_ONLY_TOK = 'c';\nexport const LOCAL_CLASH_TOK = 1;\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(srcDir, "dup_a.ts"),
      "export const DUP_A = 'a';\nexport const AMBIG_SHARED = 1;\n",
      "utf-8",
    );
    fs.writeFileSync(
      path.join(srcDir, "dup_b.ts"),
      "export const DUP_B = 'b';\nexport const AMBIG_SHARED = 2;\n",
      "utf-8",
    );

    const consumer = path.join(srcDir, "consumer.ts");
    fs.writeFileSync(
      consumer,
      [
        'import { BASE_TOK } from "./tokens.js";',
        'import { DUP_A } from "./dup_a.js";',
        'import { DUP_B } from "./dup_b.js";',
        'const dollarPattern = "$&";',
        "const LOCAL_CLASH_TOK = 99;",
        "const AMBIG_SHARED = 0;",
        "export function run(): string {",
        "  return [BASE_TOK, DUP_A, DUP_B, dollarPattern, LOCAL_CLASH_TOK, AMBIG_SHARED].join(':');",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    // Also test ambiguous multi-sibling export without local declaration via a second function
    const consumer2 = path.join(srcDir, "consumer2.ts");
    fs.writeFileSync(
      consumer2,
      [
        'import { BASE_TOK } from "./tokens.js";',
        'import { DUP_A } from "./dup_a.js";',
        'import { DUP_B } from "./dup_b.js";',
        'const dollarPattern = "$&";',
        "const LOCAL_CLASH_TOK = 99;",
        "export function run(): string {",
        "  return [BASE_TOK, DUP_A, DUP_B, dollarPattern, LOCAL_CLASH_TOK].join(':');",
        "}",
        "",
      ].join("\n"),
      "utf-8",
    );

    await splice(consumer2, {
      symbol: "run",
      code: [
        "export function run(): string {",
        "  // COMMENT_ONLY_TOK appears only in a comment",
        '  const label = "AMBIG_SHARED";',
        '  return [BASE_TOK, DUP_A, DUP_B, dollarPattern, LOCAL_CLASH_TOK, $STORE_TOKEN, label].join(":");',
        "}",
      ].join("\n"),
      projectRoot: tmpDir,
    });

    const result = fs.readFileSync(consumer2, "utf-8");
    expect(result).toContain('{ BASE_TOK, $STORE_TOKEN } from "./tokens.js"');
    expect(result).not.toContain("COMMENT_ONLY_TOK,");
    expect(result).not.toContain("LOCAL_CLASH_TOK } from");
    expect(result).not.toContain("AMBIG_SHARED } from");
  });

  it("(#7.8) allows 'invalid'/'Missing' test & markdown selectors, rejects missing code symbols, and rejects ambiguous prefixes", () => {
    const testSrc = [
      'test("invalid token throws error", () => {',
      "  expect(1).toBe(1);",
      "});",
      'test("TC-AUTH-01: login", () => {});',
      'test("TC-AUTH-02: logout", () => {});',
      "",
    ].join("\n");

    const updatedTest = spliceNativeSource(
      testSrc,
      {
        symbol: "invalid token throws error",
        code: 'test("invalid token throws error", () => {\n  expect(2).toBe(2);\n});',
      },
      "auth.test.ts",
    );
    expect(updatedTest.modifiedCode).toContain("expect(2).toBe(2)");

    expect(() =>
      spliceNativeSource(
        testSrc,
        { symbol: "TC-AUTH", code: 'test("TC-AUTH-01: login", () => {});' },
        "auth.test.ts",
      ),
    ).toThrow(/Ambiguous test selector/i);

    const mdSrc = [
      "# Docs",
      "",
      "## Missing Configuration",
      "Old text.",
      "",
      "## Phase 1 Alpha",
      "A",
      "",
      "## Phase 1 Beta",
      "B",
      "",
    ].join("\n");

    const updatedMd = spliceNativeSource(
      mdSrc,
      { symbol: "Missing Configuration", code: "## Missing Configuration\nUpdated text." },
      "README.md",
    );
    expect(updatedMd.modifiedCode).toContain("Updated text.");

    expect(() =>
      spliceNativeSource(mdSrc, { symbol: "Phase 1", code: "## Phase 1 Alpha\nNew" }, "README.md"),
    ).toThrow(/Ambiguous/i);

    // Missing unqualified code symbol throws instead of silently appending
    expect(() =>
      spliceNativeSource(
        "export function existingFn(): number { return 1; }\n",
        { symbol: "ghostFn", code: "export function ghostFn(): number { return 2; }" },
        "mod.ts",
      ),
    ).toThrow(/not found/i);
  });

  it("(#7.11, #7.12, #7.16) masks string/comment literals in idiom scan, compact lowering, regex-after-comment, and HTML/Twig comment validation", async () => {
    const configPath = path.join(tmpDir, "aice.config.json");
    const origConfig = fs.readFileSync(configPath, "utf-8");

    // dryRun createFile must not mutate aice.config.json
    await createFile(path.join(tmpDir, "dry_idiom.ts"), {
      code: "// @idiom $dryOnly => console.info($1)\nexport const D = 1;\n",
      projectRoot: tmpDir,
      dryRun: true,
    });
    expect(fs.readFileSync(configPath, "utf-8")).toBe(origConfig);

    // @idiom and compact AICE tokens inside string literals + regex after comment + hybrid local with trailing comment
    const trickyPath = path.join(tmpDir, "tricky.ts");
    await createFile(trickyPath, {
      code: [
        'export const LITERAL_IDIOM = "// @idiom $shouldNotStrip => 1";',
        'export const LITERAL_FN = "fn keepArrow -> untouched";',
        "export function checkRegex(v: string): boolean {",
        "  total:# = 5; // trailing hybrid comment",
        "  return total > 0 && /* comment before regex */ /^ok$/i.test(v);",
        "}",
        "",
      ].join("\n"),
      projectRoot: tmpDir,
    });
    const trickyContent = fs.readFileSync(trickyPath, "utf-8");
    expect(trickyContent).toContain("// @idiom $shouldNotStrip => 1");
    expect(trickyContent).toContain('"fn keepArrow -> untouched"');
    expect(trickyContent).toContain("let total: number = 5;");
    expect(trickyContent).toContain("/^ok$/i.test(v)");
    expect(fs.readFileSync(configPath, "utf-8")).toBe(origConfig);

    // HTML & Twig comments containing <script> / <style>
    expect(
      validateNativeSyntax(
        "<!-- <script> unclosed in comment -->\n<div>Hello</div>\n",
        "html",
        "page.html",
      ).valid,
    ).toBe(true);
    expect(
      validateNativeSyntax(
        "{# <style> unclosed in twig comment #}\n<div>{{ title }}</div>\n",
        "twig",
        "page.twig",
      ).valid,
    ).toBe(true);
    expect(
      validateNativeSyntax("<script>const x = 1;\n<div>broken</div>\n", "html", "bad.html").valid,
    ).toBe(false);
  });

  it("(#7.13) diff-patch supports native TypeScript symbol diffs, semantic patches, and preserves file permissions on patchFile", async () => {
    const oldTs = [
      "export function greet(name: string): string {",
      '  return "hi " + name;',
      "}",
      "",
    ].join("\n");
    const newTs = [
      "export function greet(name: string): string {",
      '  return "hello " + name;',
      "}",
      "",
      "export function farewell(name: string): string {",
      '  return "bye " + name;',
      "}",
      "",
    ].join("\n");

    const diff = computeSemanticDiff(oldTs, newTs, {
      oldPath: "greeter.ts",
      newPath: "greeter.ts",
    });
    expect(diff.changes.some((c) => c.name === "greet" && c.change === "modified")).toBe(true);
    expect(diff.changes.some((c) => c.name === "farewell" && c.change === "added")).toBe(true);
    expect(generateSemanticPatch(diff)).toContain("greet");

    const semPatch = [
      "--- Symbol: function greet (modified)",
      "export function greet(name: string): string {",
      '  return "patched " + name;',
      "}",
    ].join("\n");
    const patchedMem = applyPatch(oldTs, semPatch, { projectRoot: "greeter.ts" });
    expect(patchedMem.success).toBe(true);
    expect(patchedMem.modifiedSource).toContain('return "patched " + name;');

    const execFile = path.join(tmpDir, "cli_tool.ts");
    fs.writeFileSync(execFile, oldTs, { encoding: "utf-8", mode: 0o755 });
    fs.chmodSync(execFile, 0o755);

    const uniPatchRes = await patchFile(execFile, diff.unifiedDiff, { projectRoot: tmpDir });
    expect(uniPatchRes.success).toBe(true);
    const afterStat = fs.statSync(execFile);
    expect(afterStat.mode & 0o111).not.toBe(0);
    expect(fs.readFileSync(execFile, "utf-8")).toBe(newTs);
  });

  it("(#7.14) :Lstart-Lend rejects unbalanced control-flow ranges instead of relocating to another '} else {' block", () => {
    const controlSrc = [
      "export function demo(a: boolean, b: boolean): number {",
      "  if (a) {",
      "    return 1;",
      "  } else {",
      "    const x = 2;",
      "    return x;",
      "  }",
      "}",
      "export function second(c: boolean): number {",
      "  if (c) { return 3; }",
      "  else { return 4; }",
      "}",
      "",
    ].join("\n");

    // Stale line numbers (L2-L3 slices `if (a) {\n    return 1;` with +1 open brace) must NOT relocate to `} else {`
    expect(() =>
      spliceNativeSource(
        controlSrc,
        { symbol: "L2-L3", code: "  } else {\n    const x = 99;" },
        "control.ts",
      ),
    ).toThrow(/Line-range splice|unbalanced/i);
  });

  it("(#7.15) throws Ambiguous symbol when an unqualified method exists in multiple classes across TS, Python, Rust, and .aice", () => {
    const multiTs = [
      "export class Alpha { public step(): number { return 1; } }",
      "export class Beta { public step(): number { return 2; } }",
      "",
    ].join("\n");
    expect(() =>
      spliceNativeSource(
        multiTs,
        { symbol: "step", code: "public step(): number { return 9; }" },
        "multi.ts",
      ),
    ).toThrow(/Ambiguous symbol/i);

    const multiPy = [
      "class Alpha:",
      "    def step(self):",
      "        return 1",
      "",
      "class Beta:",
      "    def step(self):",
      "        return 2",
      "",
    ].join("\n");
    expect(() =>
      spliceNativeSource(
        multiPy,
        { symbol: "step", code: "def step(self):\n    return 9" },
        "multi.py",
      ),
    ).toThrow(/Ambiguous symbol/i);

    const multiRs = [
      "struct Alpha;",
      "impl Alpha {",
      "    pub fn step(&self) -> i32 { 1 }",
      "}",
      "struct Beta;",
      "impl Beta {",
      "    pub fn step(&self) -> i32 { 2 }",
      "}",
      "",
    ].join("\n");
    expect(() =>
      spliceNativeSource(
        multiRs,
        { symbol: "step", code: "pub fn step(&self) -> i32 { 9 }" },
        "multi.rs",
      ),
    ).toThrow(/Ambiguous symbol/i);

    const multiCpp = [
      "class Alpha {",
      "public:",
      "  int step() { return 1; }",
      "};",
      "class Beta {",
      "public:",
      "  int step() { return 2; }",
      "};",
      "",
    ].join("\n");
    expect(() =>
      spliceNativeSource(
        multiCpp,
        { symbol: "step", code: "int step() { return 9; }" },
        "multi.cpp",
      ),
    ).toThrow(/Ambiguous symbol/i);

    // Single-container Rust struct Counter + impl Counter still resolves unqualified `step`
    const singleRs = [
      "pub struct Counter {",
      "    pub v: i32,",
      "}",
      "impl Counter {",
      "    pub fn step(&self) -> i32 { self.v }",
      "}",
      "",
    ].join("\n");
    const singleRsRes = spliceNativeSource(
      singleRs,
      { symbol: "step", code: "pub fn step(&self) -> i32 { self.v + 1 }" },
      "single.rs",
    );
    expect(singleRsRes.modifiedCode).toContain("self.v + 1");

    const multiAice = [
      "class Alpha:",
      "  fn step() -> int:",
      "    return 1",
      "",
      "class Beta:",
      "  fn step() -> int:",
      "    return 2",
      "",
    ].join("\n");
    expect(() =>
      spliceSource(multiAice, { symbol: "step", code: "fn step() -> int:\n  return 9" }, "m.aice"),
    ).toThrow(/Ambiguous symbol/i);
  });

  it("(#7.17) guards --compile disk writes during dryRun and preserves line-1 indentation on passthrough files", async () => {
    const aiceFile = path.join(tmpDir, "calc.aice");
    const compiledTs = path.join(tmpDir, "calc.ts");
    fs.writeFileSync(aiceFile, "pub fn doubleIt(x: int) -> int:\n  return x * 2\n", "utf-8");

    const dryCompileRes = await splice(aiceFile, {
      symbol: "doubleIt",
      code: "pub fn doubleIt(x: int) -> int:\n  return x * 3",
      compile: true,
      dryRun: true,
      projectRoot: tmpDir,
    });
    expect(dryCompileRes.modifiedCode).toContain("x * 3");
    expect(fs.existsSync(compiledTs)).toBe(false);

    const indentedTxt = path.join(tmpDir, "indented.txt");
    await createFile(indentedTxt, {
      code: "  nested_first_line: true\n  second_line: false\n",
      projectRoot: tmpDir,
    });
    expect(fs.readFileSync(indentedTxt, "utf-8")).toBe(
      "  nested_first_line: true\n  second_line: false\n",
    );
  });

  it("supports compound HTML selectors, multi-declaration symbol splices, Rust tuple decompilation, and positional/--stdin/--batch - JSON arrays", async () => {
    const { decompile } = await import("../../src/decompiler/index.js");
    const { execFileSync } = await import("node:child_process");

    // 1. Compound HTML tag+id/class selector (`section#trace_explorer_pane`, `section.kpi-section#slo_burn`)
    const htmlSrc = [
      "<!DOCTYPE html>",
      '<div id="header">Header</div>',
      '<section id="trace_explorer_pane" class="panel">',
      '  <div class="metric-row">Old</div>',
      "</section>",
      '<section class="kpi-section" id="slo_burn"><span>KPI</span></section>',
      "",
    ].join("\n");
    const htmlRes1 = spliceNativeSource(
      htmlSrc,
      {
        symbol: "section#trace_explorer_pane",
        code: '<section id="trace_explorer_pane" class="panel"><div>Updated</div></section>',
      },
      "console.html",
    );
    expect(htmlRes1.modifiedCode).toContain("<div>Updated</div>");
    expect(htmlRes1.modifiedCode).toContain('<div id="header">Header</div>');

    const htmlRes2 = spliceNativeSource(
      htmlRes1.modifiedCode,
      {
        symbol: "section.kpi-section#slo_burn",
        code: '<section class="kpi-section" id="slo_burn"><strong>BurnOK</strong></section>',
      },
      "console.html",
    );
    expect(htmlRes2.modifiedCode).toContain("<strong>BurnOK</strong>");

    // 2. Multi-declaration symbol splice preserves sibling declarations (`items[1..]`) instead of dropping them
    const tsSrc = [
      "export function compactMetricSeries(points: number): number {",
      "  return points * 2;",
      "}",
      "",
    ].join("\n");
    const multiDeclRes = spliceNativeSource(
      tsSrc,
      {
        symbol: "compactMetricSeries",
        code: [
          "pub fn compactMetricSeries(points: int) -> int:",
          "  return points * 3",
          "",
          "pub fn authorizeJwtTenant(tokenLen: int) -> int:",
          "  return tokenLen + 1",
        ].join("\n"),
      },
      "telemetry_router.ts",
    );
    expect(multiDeclRes.modifiedCode).toContain("compactMetricSeries");
    expect(multiDeclRes.modifiedCode).toContain("points * 3");
    expect(multiDeclRes.modifiedCode).toContain("authorizeJwtTenant");

    // 3. RustDecompiler parses tuple return types `(i64, i64)`, tuple literals `(a, b)`, tuple let destructuring, and `.0`/`.1`
    const rustTupleSrc = [
      "pub fn slice_iceberg_order(total_qty: i64, display_qty: i64) -> (i64, i64) {",
      "    let visible = if total_qty > display_qty { display_qty } else { total_qty };",
      "    let hidden = total_qty - visible;",
      "    (visible, hidden)",
      "}",
      "pub fn total_from_slice(total_qty: i64, display_qty: i64) -> i64 {",
      "    let (vis, hid) = slice_iceberg_order(total_qty, display_qty);",
      "    let pair = slice_iceberg_order(vis, hid);",
      "    vis + hid + pair.0",
      "}",
    ].join("\n");
    const rustDecomp = decompile(rustTupleSrc, "rust", { filePath: "matcher.rs" });
    expect(rustDecomp.aice).toContain("sliceIcebergOrder");
    expect(rustDecomp.aice).toContain("-> [int, int]");

    // 4. CLI positional JSON array, `--stdin` JSON array, and `--batch -` routing
    const cliFile = path.join(tmpDir, "cli_batch.ts");
    fs.writeFileSync(cliFile, "export function calc(x: number): number {\n  return x + 1;\n}\n");
    const tsxBin = path.resolve(process.cwd(), "node_modules/.bin/tsx");
    const aiceBin = path.resolve(process.cwd(), "bin/aice.ts");

    execFileSync(
      tsxBin,
      [
        aiceBin,
        "splice",
        "--no-idioms",
        JSON.stringify([
          { file: cliFile, symbol: "calc", code: "pub fn calc(x: int) -> int:\n  return x + 10" },
        ]),
      ],
      { cwd: tmpDir, encoding: "utf-8" },
    );
    expect(fs.readFileSync(cliFile, "utf-8")).toContain("x + 10");

    execFileSync(tsxBin, [aiceBin, "splice", "--no-idioms", "--stdin"], {
      cwd: tmpDir,
      input: JSON.stringify([
        { file: cliFile, symbol: "calc", code: "pub fn calc(x: int) -> int:\n  return x + 20" },
      ]),
      encoding: "utf-8",
    });
    expect(fs.readFileSync(cliFile, "utf-8")).toContain("x + 20");

    execFileSync(tsxBin, [aiceBin, "splice", "--no-idioms", "--batch", "-"], {
      cwd: tmpDir,
      input: JSON.stringify([
        { file: cliFile, symbol: "calc", code: "pub fn calc(x: int) -> int:\n  return x + 30" },
      ]),
      encoding: "utf-8",
    });
    expect(fs.readFileSync(cliFile, "utf-8")).toContain("x + 30");
  });
});
