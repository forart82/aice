/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Phase 2 — Language Accuracy, Extension Mapping SSOT, Decompiler Hardening,
 * and Multi-Language Syntax Validator Regression Suite.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  KNOWN_TARGET_EXTENSIONS,
  saveProjectConfig,
  TARGET_EXT_MAP,
  VALID_TARGET_LANGUAGES,
} from "../../src/config/project-config.js";
import type { ClassDecl, FunctionDecl, VarDecl } from "../../src/core/ast.js";
import { CppDecompiler } from "../../src/decompiler/cpp-decompiler.js";
import { CSharpDecompiler } from "../../src/decompiler/csharp-decompiler.js";
import { decompileGo } from "../../src/decompiler/go-decompiler.js";
import { decompile } from "../../src/decompiler/index.js";
import { decompileKotlin } from "../../src/decompiler/kotlin-decompiler.js";
import { decompilePhp } from "../../src/decompiler/php-decompiler.js";
import { decompilePython } from "../../src/decompiler/py-decompiler.js";
import { decompileRust } from "../../src/decompiler/rust-decompiler.js";
import {
  detectTargetFromPath,
  detectTargetFromPathOrContent,
  emitTarget,
} from "../../src/emitters/index.js";
import { detectLanguageName } from "../../src/tokenomics/index.js";
import { createFile } from "../../src/tools/create.js";
import { generateOutline } from "../../src/tools/outline.js";
import { maskSourceLexically } from "../../src/tools/preprocessor.js";
import { aiceRead } from "../../src/tools/read.js";
import { splice } from "../../src/tools/splice.js";
import {
  validateNativeSyntax,
  validateXmlWellFormedness,
} from "../../src/tools/syntax-validator.js";

describe("Phase 2: Language Accuracy & Syntax Validator Hardening", () => {
  describe("1. Extension-Mapping SSOT Alignment (.xml, .svg, .java, .gradle, .pro, .properties, .example)", () => {
    it("maps .xml and .svg accurately to 'xml' everywhere (never 'typescript' or 'html')", () => {
      expect(TARGET_EXT_MAP[".xml"]).toBe("xml");
      expect(TARGET_EXT_MAP[".svg"]).toBe("xml");
      expect(KNOWN_TARGET_EXTENSIONS.has(".xml")).toBe(true);
      expect(KNOWN_TARGET_EXTENSIONS.has(".svg")).toBe(true);
      expect(VALID_TARGET_LANGUAGES.has("xml")).toBe(true);

      expect(detectTargetFromPath("AndroidManifest.xml")).toBe("xml");
      expect(detectTargetFromPath("assets/logo.svg")).toBe("xml");
      expect(detectTargetFromPathOrContent("res/values/styles.xml")).toBe("xml");
      expect(detectTargetFromPathOrContent("icons/play.svg")).toBe("xml");
      expect(detectLanguageName("res/values/styles.xml")).toBe("XML");
      expect(detectLanguageName("icons/play.svg")).toBe("SVG");
    });

    it("maps .java to 'java' and config/build files (.gradle, .pro, .properties, .example) to 'text' consistently", () => {
      expect(TARGET_EXT_MAP[".java"]).toBe("java");
      expect(VALID_TARGET_LANGUAGES.has("java")).toBe(true);
      expect(detectTargetFromPath("MainActivity.java")).toBe("java");
      expect(detectTargetFromPathOrContent("com/app/MainActivity.java")).toBe("java");

      for (const ext of [".gradle", ".pro", ".properties", ".example"]) {
        expect(TARGET_EXT_MAP[ext]).toBe("text");
        expect(detectTargetFromPath(`config${ext}`)).toBe("text");
        expect(detectTargetFromPathOrContent(`config${ext}`)).toBe("text");
        expect(detectTargetFromPath(`config${ext}`)).not.toBe("typescript");
        expect(detectTargetFromPath(`config${ext}`)).not.toBe("shell");
      }

      // .gradle.kts remains Kotlin
      expect(detectTargetFromPath("build.gradle.kts")).toBe("kotlin");
      expect(detectTargetFromPathOrContent("build.gradle.kts")).toBe("kotlin");
      expect(detectTargetFromPath("manifest.webmanifest")).toBe("json");
      expect(detectTargetFromPathOrContent("manifest.webmanifest")).toBe("json");
    });

    it("guarantees 100% agreement between TARGET_EXT_MAP, detectTargetFromPath, and detectTargetFromPathOrContent", () => {
      for (const [ext, expectedTarget] of Object.entries(TARGET_EXT_MAP)) {
        const sample = `sample${ext}`;
        expect(detectTargetFromPath(sample)).toBe(expectedTarget);
        expect(detectTargetFromPathOrContent(sample)).toBe(expectedTarget);
      }
      // Truly unknown extensions still return passthrough from detectTargetFromPathOrContent
      expect(detectTargetFromPathOrContent("notes.customblob")).toBe("passthrough");
    });
  });

  describe("2. Decompiler Hardening (Zero Silent/Lossy Fallbacks)", () => {
    describe("Python (py-decompiler.ts)", () => {
      it("parses Ellipsis (...), lambda, set literals, soft keywords (match/case), PEP 695 type aliases, and top-level if __name__ cleanly", () => {
        const pyCode = [
          "type UserId = int",
          "def compute(items: list[int]):",
          "    match = 10",
          "    case = {1, 2, 3}",
          "    fn = lambda x, y=1: x + y",
          "    placeholder = ...",
          "    return fn(match)",
          "",
          'if __name__ == "__main__":',
          "    compute([1, 2])",
          "",
        ].join("\n");

        const res = decompilePython(pyCode, "sample.py");
        expect(res.ast.items.some((i) => i.kind === "TypeDecl" && i.name === "UserId")).toBe(true);
        const fn = res.ast.items.find(
          (i): i is FunctionDecl => i.kind === "FunctionDecl" && i.name === "compute",
        );
        expect(fn).toBeDefined();
        const stmts = (fn!.body as { statements: unknown[] }).statements;
        expect(stmts.length).toBeGreaterThanOrEqual(5);
        expect(res.aice).toContain("Ellipsis");
        expect(res.aice).not.toContain("placeholder := nil");
      });

      it("throws explicit errors on illegal characters and unexpected expression tokens instead of silent drop / LiteralExpr(nil)", () => {
        expect(() => decompilePython("x = $bad\n", "bad_char.py")).toThrow(
          /Unexpected character '\$'/,
        );
        expect(() => decompilePython("def f():\n    x = )\n", "bad_expr.py")).toThrow(
          /Unexpected token/,
        );
      });
    });

    describe("C++ (cpp-decompiler.ts)", () => {
      it('preserves :: scope resolution, C++14 digit separators, raw strings R"delim(...)delim", and string-safe -> / <...>', () => {
        const cppCode = [
          "namespace app::core {",
          "class Engine : public base::Runner {",
          "public:",
          "    int compute(bool flag) {",
          "        int limit = 1'000'000;",
          '        std::string raw = R"tag(keep::scope -> and <int>(x) (unbalanced)tag";',
          "        int v = flag ? math::Limits::MAX : math::Limits::MIN;",
          "        custom::Logger::log(raw);",
          "        return v + limit;",
          "    }",
          "};",
          "}",
          "",
        ].join("\n");

        const res = decompile(cppCode, "cpp", { filePath: "Engine.cpp" });
        const cls = res.ast.items.find(
          (i): i is ClassDecl => i.kind === "ClassDecl" && i.name === "Engine",
        );
        expect(cls!.extends).toBe("base::Runner");
        expect(res.aice).toContain("math::Limits::MAX");
        expect(res.aice).toContain("custom::Logger::log");
        expect(res.aice).toContain("1000000");
        expect(res.aice).toContain("keep::scope -> and <int>(x) (unbalanced");

        const emitted = emitTarget(res.ast, "cpp", { watermark: false });
        expect(emitted).toContain("custom::Logger::log");
        expect(emitted).toContain("math::Limits::MAX");
      });

      it("throws on empty C++ expression instead of silently producing LiteralExpr(nil)", () => {
        const dec = new CppDecompiler("", "empty.cpp");
        expect(() => dec.parseCppExpr("   ")).toThrow(/Empty C\+\+ expression/);
      });
    });

    describe("Rust (rust-decompiler.ts)", () => {
      it("preserves A::B::C path qualifiers, ..spread struct update syntax, as Type casts, and top-level trait/mod/macro_rules!", () => {
        const rustCode = [
          "pub trait Scorable { fn score(&self) -> f64; }",
          "mod helpers;",
          "macro_rules! noop { () => {}; }",
          "pub struct Config { pub port: i64, pub host: String }",
          "pub fn build(base: Config, raw: i32) -> Config {",
          "    let a = crate::math::Limits::min(1, 2);",
          "    let f = raw as f64;",
          "    let cfg = Config { port: 8080, ..base };",
          "    return cfg;",
          "}",
          "",
        ].join("\n");

        const res = decompileRust(rustCode, "config.rs");
        expect(res.ast.items.some((i) => i.kind === "TypeDecl" && i.name === "Scorable")).toBe(
          true,
        );
        expect(res.aice).toContain("crate::math::Limits::min(1, 2)");
        expect(res.aice).toContain("as(raw, f64)");
        expect(res.aice).toContain("...base");

        const emitted = emitTarget(res.ast, "rust", { watermark: false });
        expect(emitted).toContain("crate::math::Limits::min(1, 2)");
        expect(emitted).toContain("(raw as f64)");
        expect(emitted).toContain("Config { port: 8080, ..base }");
      });

      it("throws explicit error on stray unrecognized top-level Rust token instead of silent skip", () => {
        expect(() => decompileRust(")))", "broken.rs")).toThrow(/Unexpected top-level token/);
      });
    });

    describe("Go (go-decompiler.ts)", () => {
      it('initializes uninitialized Go vars with typed zero values (0, "", false, Struct()) rather than nil', () => {
        const goCode = [
          "package demo",
          "var GlobalCount int64",
          "var GlobalName string",
          "var GlobalFlag bool",
          "func Work() int64 {",
          "    var local int64",
          "    return local + GlobalCount",
          "}",
          "",
        ].join("\n");

        const res = decompileGo(goCode, "vars.go");
        const countVar = res.ast.items.find(
          (i): i is VarDecl => i.kind === "VarDecl" && i.name === "GlobalCount",
        );
        const nameVar = res.ast.items.find(
          (i): i is VarDecl => i.kind === "VarDecl" && i.name === "GlobalName",
        );
        const flagVar = res.ast.items.find(
          (i): i is VarDecl => i.kind === "VarDecl" && i.name === "GlobalFlag",
        );
        expect(countVar?.value).toMatchObject({
          kind: "LiteralExpr",
          literalKind: "number",
          value: 0,
        });
        expect(nameVar?.value).toMatchObject({
          kind: "LiteralExpr",
          literalKind: "string",
          value: "",
        });
        expect(flagVar?.value).toMatchObject({
          kind: "LiteralExpr",
          literalKind: "boolean",
          value: false,
        });
      });

      it("preserves non-idiomatic if err != nil blocks with side effects/logging while collapsing pure propagation", () => {
        const goCode = [
          "package svc",
          "func WithSideEffect(id string) (string, error) {",
          "    res, err := Fetch(id)",
          "    if err != nil {",
          "        LogError(err)",
          '        return "fallback", nil',
          "    }",
          "    return res, nil",
          "}",
          "func PureProp(id string) (string, error) {",
          "    res, err := Fetch(id)",
          "    if err != nil {",
          '        return "", err',
          "    }",
          "    return res, nil",
          "}",
          "",
        ].join("\n");

        const res = decompileGo(goCode, "svc.go");
        const sideEffectFn = res.ast.items.find(
          (i): i is FunctionDecl => i.kind === "FunctionDecl" && i.name === "withSideEffect",
        );
        const pureFn = res.ast.items.find(
          (i): i is FunctionDecl => i.kind === "FunctionDecl" && i.name === "pureProp",
        );
        expect(sideEffectFn).toBeDefined();
        expect(pureFn).toBeDefined();

        const sideStmts = (sideEffectFn!.body as { statements: Array<{ kind: string }> })
          .statements;
        expect(sideStmts.some((s) => s.kind === "IfStmt")).toBe(true);
        expect(res.aice).toContain("LogError(err)");

        const pureStmts = (
          pureFn!.body as { statements: Array<{ kind: string; init?: { kind: string } }> }
        ).statements;
        expect(pureStmts.some((s) => s.kind === "IfStmt")).toBe(false);
        expect(pureStmts[0]?.init?.kind).toBe("PostfixTryExpr");
      });

      it("throws explicit error on stray top-level Go token", () => {
        expect(() => decompileGo("package p\n)))", "bad.go")).toThrow(/Unexpected top-level token/);
      });
    });

    describe("C# (csharp-decompiler.ts)", () => {
      it("preserves nested class/struct/enum declarations, out/ref modifiers, and named argument labels", () => {
        const csCode = [
          "namespace App.Core {",
          "  public class Outer {",
          "    public enum Mode { Fast, Safe }",
          "    public struct Point { public int X; public int Y; }",
          "    public class Inner { public int Value; }",
          "    public void Run(int a) {",
          "      TryParse(a, out var parsed);",
          "      Swap(ref a);",
          "      Configure(godMode: true, maxHp: 100);",
          "    }",
          "  }",
          "}",
          "",
        ].join("\n");
        const res = decompile(csCode, "csharp", { filePath: "Outer.cs" });
        expect(res.ast.items.some((i) => i.kind === "TypeDecl" && i.name === "Outer.Mode")).toBe(
          true,
        );
        expect(res.ast.items.some((i) => i.kind === "ClassDecl" && i.name === "Outer.Point")).toBe(
          true,
        );
        expect(res.ast.items.some((i) => i.kind === "ClassDecl" && i.name === "Outer.Inner")).toBe(
          true,
        );
        expect(res.aice).toContain("out(parsed)");
        expect(res.aice).toContain("ref(a)");
        expect(res.aice).toContain("godMode = true");
        expect(res.aice).toContain("maxHp = 100");
      });

      it("rejects malformed non-identifier C# expressions instead of emitting opaque IdentifierExpr", () => {
        const dec = new CSharpDecompiler("", "Bad.cs");
        expect(() => dec.parseCSharpExpr("??? broken expr ###")).toThrow(
          /Unsupported or malformed C# expression/,
        );
      });
    });

    describe("Kotlin (kotlin-decompiler.ts)", () => {
      it("parses @Annotations without truncating subsequent declarations and throws on illegal chars / unexpected expr tokens", () => {
        const ktCode = [
          '@Suppress("UNUSED")',
          "fun greet(name: String): String {",
          '    return "hi"',
          "}",
          "",
        ].join("\n");
        const res = decompileKotlin(ktCode, "Greet.kt");
        expect(res.ast.items.some((i) => i.kind === "FunctionDecl" && i.name === "greet")).toBe(
          true,
        );

        expect(() => decompileKotlin("val x = ~bad\n", "BadChar.kt")).toThrow(
          /Unexpected character '~'/,
        );
        expect(() => decompileKotlin("fun f(): Int { return ) }\n", "BadExpr.kt")).toThrow(
          /Unexpected token/,
        );
      });
    });

    describe("PHP (php-decompiler.ts)", () => {
      it("parses PHP 8 attributes, heredoc, top-level const, and match enum arms cleanly, and throws on invalid chars/tokens", () => {
        const phpCode = [
          "<?php",
          "declare(strict_types=1);",
          'const APP_VERSION = "2.0";',
          '#[Route("/health")]',
          "function health(): string {",
          "    $msg = <<<EOT",
          "ok ( ' \"",
          "EOT;",
          "    return $msg;",
          "}",
          "",
        ].join("\n");

        const res = decompilePhp(phpCode, "health.php");
        expect(res.ast.items.some((i) => i.kind === "ConstDecl" && i.name === "APP_VERSION")).toBe(
          true,
        );
        expect(res.ast.items.some((i) => i.kind === "FunctionDecl" && i.name === "health")).toBe(
          true,
        );

        expect(() => decompilePhp("<?php `ls`;", "bad_char.php")).toThrow(
          /Unexpected character '`'/i,
        );
        expect(() => decompilePhp("<?php )))", "bad_top.php")).toThrow(
          /Unexpected top-level token/,
        );
        expect(() => decompilePhp("<?php function f() { return ); }", "bad_expr.php")).toThrow(
          /Unexpected token/,
        );
      });
    });
  });

  describe("3. Strengthened Syntax Validator (Rust, Go, C++, C#, Kotlin, PHP, Java, XML/SVG, HTML/Twig)", () => {
    it("Rust: validates nested block comments, raw strings, byte strings, lifetimes vs char literals, and catches real defects", () => {
      const validRust = [
        "/* outer /* inner { unclosed */ still outer */",
        "pub fn parse<'a>(input: &'a str) -> &'static str {",
        '    let raw = r#"unclosed ( { [ " \' "#;',
        '    let raw2 = br##"bytes "# still raw"##;',
        '    let bytes = b"hello (";',
        "    let ch = '\\n';",
        "    let uni = '\\u{1F600}';",
        '    "ok"',
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validRust, "rust", "lib.rs").valid).toBe(true);

      expect(validateNativeSyntax("/* outer /* inner */", "rust", "a.rs").valid).toBe(false);
      expect(validateNativeSyntax('let s = r#"unclosed', "rust", "b.rs").valid).toBe(false);
      expect(validateNativeSyntax("let c = '';", "rust", "c.rs").valid).toBe(false);
      expect(validateNativeSyntax("let c = 'ab';", "rust", "d.rs").valid).toBe(false);
      const mis = validateNativeSyntax("fn main() {\n  let x = (1 + 2];\n}", "rust", "e.rs");
      expect(mis.valid).toBe(false);
      expect(mis.items[0]?.line).toBe(2);
      expect(mis.diagnostics[0]).toMatch(/Mismatched delimiter/);
      expect(
        validateNativeSyntax("fn f() {}\n<<<<<<< HEAD\n=======\n>>>>>>> main\n", "rust", "f.rs")
          .valid,
      ).toBe(false);
    });

    it("Go: validates backtick raw strings and rune literals, and catches unclosed/invalid runes and delimiters", () => {
      const validGo = [
        "package main",
        "func demo() {",
        "    raw := `multiline ( { \" ' not closed`",
        "    r1 := 'a'",
        "    r2 := '\\u4e16'",
        "    _ = raw; _ = r1; _ = r2",
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validGo, "go", "main.go").valid).toBe(true);

      expect(validateNativeSyntax("package p\nvar s = `unclosed", "go", "a.go").valid).toBe(false);
      expect(validateNativeSyntax("package p\nvar r = ''", "go", "b.go").valid).toBe(false);
      expect(validateNativeSyntax("package p\nvar r = 'ab'", "go", "c.go").valid).toBe(false);
      expect(validateNativeSyntax("package p\nvar r = 'a\n", "go", "d.go").valid).toBe(false);
      expect(validateNativeSyntax("package p\nfunc f( {", "go", "e.go").valid).toBe(false);
    });

    it("C++: validates R\"delim(...)delim\" raw strings, u8R/LR prefixes, C++14 digit separators, and u8'a' chars", () => {
      const validCpp = [
        "int main() {",
        "    int big = 1'000'000;",
        "    int hex = 0xFF'FF;",
        "    int bin = 0b1010'0101;",
        "    char8_t c = u8'a';",
        '    const char* s1 = R"xyz(raw ( { [ " \' )xyz";',
        '    const char* s2 = u8R"(utf8 raw ( )";',
        "    return big + hex + bin + c;",
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validCpp, "cpp", "main.cpp").valid).toBe(true);

      expect(validateNativeSyntax('const char* s = R"d(unclosed', "cpp", "a.cpp").valid).toBe(
        false,
      );
      expect(validateNativeSyntax("char c = '';", "cpp", "b.cpp").valid).toBe(false);
      expect(validateNativeSyntax("char c = 'a\n;", "cpp", "c.cpp").valid).toBe(false);
      expect(validateNativeSyntax("int f() { return (1 + 2; }", "cpp", "d.cpp").valid).toBe(false);
    });

    it('C#: validates verbatim @"...", raw """...""", interpolated $"..." / $@"...", and catches unclosed strings/interpolations', () => {
      const validCs = [
        "class C {",
        "  void M(string name) {",
        '    var v = @"path\\to\\""quoted"" (unclosed";',
        '    var r = """raw "quotes" ( [ """;',
        '    var i1 = $"hello {name == "a" ? "b" : "c"} {{escaped}}";',
        '    var i2 = $@"multi\n{name.ToUpper()} ""ok""";',
        "    char ch = 'x';",
        "  }",
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validCs, "csharp", "Demo.cs").valid).toBe(true);

      expect(validateNativeSyntax('var v = @"unclosed', "csharp", "a.cs").valid).toBe(false);
      expect(validateNativeSyntax('var s = $"hello {unclosed";', "csharp", "b.cs").valid).toBe(
        false,
      );
      expect(validateNativeSyntax('var r = """unclosed', "csharp", "c.cs").valid).toBe(false);
      expect(validateNativeSyntax("char c = '';", "csharp", "d.cs").valid).toBe(false);
      expect(validateNativeSyntax("char c = 'ab';", "csharp", "e.cs").valid).toBe(false);
    });

    it('Kotlin: validates triple-quoted strings, nested /* /* */ */, interpolated "${...}", and catches errors', () => {
      const validKt = [
        "/* outer /* inner { */ still outer */",
        "fun demo(map: Map<String, String>): String {",
        '    val raw = """unclosed ( { " """',
        '    val msg = "val=${map["key"]}"',
        "    val ch = 'k'",
        "    return raw + msg + ch",
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validKt, "kotlin", "Demo.kt").valid).toBe(true);

      expect(validateNativeSyntax("/* outer /* inner */", "kotlin", "a.kt").valid).toBe(false);
      expect(validateNativeSyntax('val s = """unclosed', "kotlin", "b.kt").valid).toBe(false);
      expect(validateNativeSyntax('val s = "bad ${unclosed";', "kotlin", "c.kt").valid).toBe(false);
      expect(validateNativeSyntax("val c = 'ab'", "kotlin", "d.kt").valid).toBe(false);
    });

    it("PHP: validates single/double strings, heredoc/nowdoc, comments, and catches unclosed heredoc & leaked hunks", () => {
      const validPhp = [
        "<?php",
        "# hash comment (",
        "// line comment {",
        "/* block comment [ */",
        "$html = <<<EOT",
        '<div class="unclosed \' (">',
        "EOT;",
        "$sql = <<<'SQL'",
        "SELECT 'unclosed (",
        "SQL;",
        "echo $html . $sql;",
      ].join("\n");
      expect(validateNativeSyntax(validPhp, "php", "index.php").valid).toBe(true);

      expect(validateNativeSyntax("<?php\n$s = <<<EOT\nno end\n", "php", "a.php").valid).toBe(
        false,
      );
      expect(validateNativeSyntax("<?php\n<<<\nold\n===\nnew\n>>>\n", "php", "b.php").valid).toBe(
        false,
      );
      expect(validateNativeSyntax("<?php\nfunction f() { return (1; }", "php", "c.php").valid).toBe(
        false,
      );
    });

    it("Java: ALWAYS dispatches .java as Java even if caller passes 'kotlin' or 'typescript', validates text blocks & chars", () => {
      const validJava = [
        "public class App {",
        "  /* Java block comments do NOT nest: /* ends here */",
        '  String json = """',
        '    {"key": "escaped \\"quote\\" ("}',
        '    """;',
        "  char c = 'J';",
        "}",
      ].join("\n");
      expect(validateNativeSyntax(validJava, "java", "App.java").valid).toBe(true);
      // Even when a legacy caller passes "kotlin" or "typescript", .java MUST still validate as Java!
      expect(validateNativeSyntax(validJava, "kotlin", "App.java").valid).toBe(true);
      expect(validateNativeSyntax(validJava, "typescript", "App.java").valid).toBe(true);

      expect(
        validateNativeSyntax('class A { String s = """unclosed; }', "kotlin", "A.java").valid,
      ).toBe(false);
      expect(validateNativeSyntax("class A { char c = ''; }", "java", "A.java").valid).toBe(false);
      expect(validateNativeSyntax("class A { char c = 'ab'; }", "java", "A.java").valid).toBe(
        false,
      );
      expect(validateNativeSyntax("class A { void f() { }", "kotlin", "A.java").valid).toBe(false);
      expect(
        validateNativeSyntax("public class A {\n=== A.java:L1-L2 ===\n}", "java", "A.java").valid,
      ).toBe(false);
    });

    it("XML / SVG: validates well-formed XML & SVG accurately and catches mismatched/unclosed tags, comments, CDATA, PIs, and attributes", () => {
      const validXml = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        "<!DOCTYPE manifest [<!ENTITY app 'AICE'>]>",
        "<!-- comment with <unclosed> tags -->",
        '<manifest xmlns:android="http://schemas.android.com/apk/res/android">',
        '  <uses-permission android:name="android.permission.INTERNET" />',
        "  <data><![CDATA[<raw & unclosed <tag>]]></data>",
        "</manifest>",
      ].join("\n");
      expect(validateNativeSyntax(validXml, "xml", "AndroidManifest.xml").valid).toBe(true);
      // Even if a caller passes "html" for an .xml/.svg path, XML well-formedness MUST run!
      expect(validateNativeSyntax(validXml, "html", "AndroidManifest.xml").valid).toBe(true);

      const validSvg =
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path d="M0 0h24v24H0z"/><circle cx="12" cy="12" r="5"/></svg>';
      expect(validateNativeSyntax(validSvg, "xml", "icon.svg").valid).toBe(true);

      // Mismatched tags (including case-sensitive XML mismatch)
      const mismatch = validateNativeSyntax("<root><View></view></root>", "xml", "layout.xml");
      expect(mismatch.valid).toBe(false);
      expect(mismatch.diagnostics.some((d) => d.includes("Mismatched XML closing tag"))).toBe(true);

      // Unclosed tag
      expect(validateNativeSyntax("<svg><g><circle r='2'/></svg>", "xml", "bad.svg").valid).toBe(
        false,
      );
      // Unexpected closing tag
      expect(validateNativeSyntax("<a/></b>", "xml", "bad.xml").valid).toBe(false);
      // Unclosed comment / CDATA / PI / attribute quote / truncated tag
      expect(validateXmlWellFormedness("<a/><!-- unclosed").length).toBeGreaterThan(0);
      expect(validateXmlWellFormedness("<a><![CDATA[unclosed</a>").length).toBeGreaterThan(0);
      expect(validateXmlWellFormedness('<?xml version="1.0"<a/>').length).toBeGreaterThan(0);
      expect(validateXmlWellFormedness('<a id="unclosed></a>').length).toBeGreaterThan(0);
      expect(validateXmlWellFormedness('<svg><path d="M0"\n</svg>').length).toBeGreaterThan(0);
    });

    it("keeps valid HTML fragments and Twig templates passing cleanly", () => {
      const htmlFrag = '<div class="card"><img src="a.png" alt="ok"><br><input type="text"></div>';
      expect(validateNativeSyntax(htmlFrag, "html", "card.html").valid).toBe(true);

      const twigTpl = '{# comment #}{% if user %}<div class="u">{{ user.name }}</div>{% endif %}';
      expect(validateNativeSyntax(twigTpl, "twig", "card.twig").valid).toBe(true);
    });

    it("maskSourceLexically handles C++14 digit separators vs u8'a' cleanly", () => {
      const res = maskSourceLexically("int n = 1'000'000; char8_t c = u8'a';", "cpp");
      expect(res.unterminatedDiagnostics).toEqual([]);
      expect(res.maskedCode).toContain("1'000'000");
    });
  });

  describe("4. End-to-End Java & XML/SVG Outline, Read, Splice & Pre-Write Validation", () => {
    let tmpDir: string;

    beforeEach(() => {
      tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "aice-phase2-lang-"));
      saveProjectConfig(tmpDir, { enabled: true });
    });

    afterEach(() => {
      fs.rmSync(tmpDir, { recursive: true, force: true });
    });

    it("outlines, reads, splices by symbol, and rejects syntax-corrupt writes on .java files end-to-end", async () => {
      const javaFile = path.join(tmpDir, "Calculator.java");
      const javaSrc = [
        "package com.demo;",
        "",
        "import java.util.List;",
        "",
        "public class Calculator {",
        "    public int add(int a, int b) {",
        "        return a + b;",
        "    }",
        "",
        "    public int multiply(int a, int b) {",
        "        return a * b;",
        "    }",
        "}",
        "",
      ].join("\n");

      const created = await createFile(javaFile, { code: javaSrc, projectRoot: tmpDir });
      expect(created.success).toBe(true);

      const outline = generateOutline(javaSrc, { filePath: javaFile, lineRanges: true });
      expect(outline.symbols.some((s) => s.name === "Calculator")).toBe(true);
      expect(outline.text).toContain("add");
      expect(outline.text).toContain("multiply");

      const readMethod = await aiceRead("Calculator.java:add", {
        projectRoot: tmpDir,
        surface: "cli",
      });
      expect(readMethod.output).toContain("return a + b;");

      const spliced = await splice(javaFile, {
        symbol: "Calculator.add",
        code: "    public int add(int a, int b) {\n        return a + b + 1;\n    }",
        projectRoot: tmpDir,
      });
      expect(spliced.modifiedCode).toContain("return a + b + 1;");
      expect(fs.readFileSync(javaFile, "utf-8")).toContain("return a + b + 1;");

      await expect(
        splice(javaFile, {
          symbol: "Calculator.multiply",
          code: "    public int multiply(int a, int b) {\n        return (a * b;\n    }",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Pre-write syntax validation failed/i);
    });

    it("outlines .xml/.svg and rejects malformed XML/SVG writes via pre-write syntax validation", async () => {
      const svgFile = path.join(tmpDir, "badge.svg");
      const validSvg = [
        '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 16 16">',
        '  <circle id="dot" cx="8" cy="8" r="6" />',
        "</svg>",
        "",
      ].join("\n");

      const created = await createFile(svgFile, { code: validSvg, projectRoot: tmpDir });
      expect(created.success).toBe(true);

      const outline = generateOutline(validSvg, { filePath: svgFile, lineRanges: true });
      expect(outline.symbols.some((s) => s.name === "svg" || s.name === "dot")).toBe(true);

      await expect(
        createFile(path.join(tmpDir, "broken.xml"), {
          code: "<resources><string name='app'>AICE</wrong></resources>\n",
          projectRoot: tmpDir,
        }),
      ).rejects.toThrow(/Mismatched XML closing tag/i);
    });
  });
});
