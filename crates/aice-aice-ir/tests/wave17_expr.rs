use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let opts = TranspileOpts::default();
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &opts).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice_with_opts(&m, &opts);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String, String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n{n1}\n---\n{n2}");
    (a1, n1, a2, n2)
}

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f134_seven_lang_char_literals_2x_lossless() {
    let cases: &[(LanguageId, &str, &str, &[&str])] = &[
        (
            LanguageId::Rust,
            "ch.rs",
            "pub fn f(c: char, b: u8) -> bool {\n    c == '\\n' || c == 'a' || c == '\\t' || c == '\\0' || c == '\\'' || c == '\\u{1F600}' || b == b'a' || b == b'\\n'\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\0'", "'\\''", "'\\u{1F600}'", "b'a'", "b'\\n'"],
        ),
        (
            LanguageId::C,
            "ch.c",
            "int f(char c) {\n    return c == '\\n' || c == 'a' || c == '\\t' || c == '\\0' || c == '\\'' || (int)L'a' == 97;\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\0'", "'\\''", "L'a'"],
        ),
        (
            LanguageId::Cpp,
            "ch.cpp",
            "bool f(char c) {\n    return c == '\\n' || c == 'a' || c == '\\t' || c == '\\0' || c == '\\'' || L'a' == 97;\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\0'", "'\\''", "L'a'"],
        ),
        (
            LanguageId::CSharp,
            "Ch.cs",
            "public class Ch {\n    public static bool F(char c) => c == '\\n' || c == 'a' || c == '\\t' || c == '\\0' || c == '\\'' || c == '\\u0041';\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\0'", "'\\''", "'\\u0041'"],
        ),
        (
            LanguageId::Java,
            "Ch.java",
            "public class Ch {\n    public static boolean f(char c) {\n        return c == '\\n' || c == 'a' || c == '\\t' || c == '\\0' || c == '\\'' || c == '\\u0041';\n    }\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\0'", "'\\''", "'\\u0041'"],
        ),
        (
            LanguageId::Kotlin,
            "Ch.kt",
            "fun f(c: Char): Boolean = c == '\\n' || c == 'a' || c == '\\t' || c == '\\'' || c == '\\u0041'\nfun g(): String = \"${f('\\n')}\"\n",
            &["'\\n'", "'a'", "'\\t'", "'\\''", "'\\u0041'", "${f('\\n')}"],
        ),
        (
            LanguageId::Go,
            "ch.go",
            "package main\n\nfunc f(c rune) bool {\n\treturn c == '\\n' || c == 'a' || c == '\\t' || c == '\\000' || c == '\\'' || c == '\\u0041'\n}\n",
            &["'\\n'", "'a'", "'\\t'", "'\\000'", "'\\''", "'\\u0041'"],
        ),
    ];
    for (lang, vname, src, expects) in cases {
        let (_, _, _, n2) = roundtrip_2x(*lang, vname, src);
        for ex in *expects {
            assert!(n2.contains(ex), "{lang:?} missing `{ex}` in:\n{n2}");
        }
        assert!(!n2.contains("\"a\""), "{lang:?} turned char into string:\n{n2}");
        assert!(!n2.contains("\"\\\\n\""), "{lang:?} double-escaped char:\n{n2}");
    }
}

#[test]
fn f135_php_string_escapes_2x_lossless() {
    let src = "<?php\nfunction phpStrBug(string $name): array {\n    $sq_lit = 'line1\\nline2\\'ok\\\\';\n    $sq_dol = 'cost $name';\n    $hex = \"\\x1b[31m\\u{1F600}\";\n    $std = \"a\\nb\\tc\\\"d\\\\e\";\n    $esc_dol = \"price \\$5\";\n    $interp = \"hi $name\";\n    return [$sq_lit, $sq_dol, $hex, $std, $esc_dol, $interp];\n}\n";
    let (_, _, _, n2) = roundtrip_2x(LanguageId::Php, "str.php", src);
    for ex in [
        "'line1\\nline2\\'ok\\\\'",
        "'cost $name'",
        "\"\\x1b[31m\\u{1F600}\"",
        "\"a\\nb\\tc\\\"d\\\\e\"",
        "\"price \\$5\"",
        "\"hi $name\"",
    ] {
        assert!(n2.contains(ex), "PHP missing `{ex}`:\n{n2}");
    }
    if has_tool("php") {
        let body = n2.trim_start_matches("<?php");
        let code = format!("{body}\n$r = phpStrBug('Ada');\necho implode('|', [strlen($r[0]), $r[0], $r[1], bin2hex($r[2]), strlen($r[3]), $r[4], $r[5]]);\n");
        let out = Command::new("php").args(["-r", &code]).output().unwrap();
        assert!(out.status.success(), "php failed: {}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout),
            "16|line1\\nline2'ok\\|cost $name|1b5b33316df09f9880|9|price $5|hi Ada"
        );
    }
}

#[test]
fn f136_rust_and_python_byte_and_prefix_strings_2x_lossless() {
    let rs_src = r###"pub const B: &[u8] = b"hello";
pub fn f(s: &[u8]) -> (bool, &'static [u8], &'static [u8], &'static std::ffi::CStr, &'static std::ffi::CStr) {
    let raw_b = br#"raw\n"bytes""#;
    let hex_b = b"\x00\xffhello";
    let c_s = c"hello";
    let cr_s = cr#"c\nraw"#;
    (s.starts_with(b"hi") && b"hello".len() == 5, raw_b, hex_b, c_s, cr_s)
}
"###;
    let (_, _, _, rs_n2) = roundtrip_2x(LanguageId::Rust, "bytes.rs", rs_src);
    for ex in [r#"b"hello""#, r#"b"hi""#, r##"br#"raw\n"bytes""#"##, r#"b"\x00\xffhello""#, r#"c"hello""#, r##"cr#"c\nraw"#"##] {
        assert!(rs_n2.contains(ex), "Rust missing `{ex}`:\n{rs_n2}");
    }

    let py_src = "def f():\n    a = b\"hello\"\n    b = b\"\\x00\\xffhello\"\n    c = rb\"\\d+\\s+\"\n    d = br'\\w+'\n    e = u\"\\u0041ok\"\n    g = b\"\"\"multi\nline\"\"\"\n    return (a, b, c, d, e, g)\n";
    let (_, _, _, py_n2) = roundtrip_2x(LanguageId::Python, "bytes.py", py_src);
    for ex in [r#"b"hello""#, r#"b"\x00\xffhello""#, r#"rb"\d+\s+""#, r#"br'\w+'"#, r#"u"\u0041ok""#] {
        assert!(py_n2.contains(ex), "Python missing `{ex}`:\n{py_n2}");
    }
    if has_tool("python3") {
        let check = format!("{py_n2}\na, b, c, d, e, g = f()\nprint(isinstance(a, bytes), isinstance(b, bytes), len(b), b[0], b[1], isinstance(c, bytes), len(c), isinstance(d, bytes), e, isinstance(g, bytes), len(g))\n");
        let out = Command::new("python3").args(["-c", &check]).output().unwrap();
        assert!(out.status.success(), "python3 failed: {}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "True True 7 0 255 True 6 True Aok True 10");
    }
}

#[test]
fn f137_js_ts_tsx_hex_unicode_control_escapes_2x_lossless() {
    let js_src = "function jsEscBug() {\n  return { ansi: \"\\x1b[31m\", u4: \"\\u0041\", ubrace: \"\\u{1F600}\", ctrl: \"\\b\\f\\v\", nul: \"\\0\", std: \"a\\nb\\tc\\\"d\\\\e\" };\n}\n";
    for (lang, vname) in [
        (LanguageId::JavaScript, "esc.js"),
        (LanguageId::TypeScript, "esc.ts"),
        (LanguageId::Tsx, "esc.tsx"),
    ] {
        let (_, _, _, n2) = roundtrip_2x(lang, vname, js_src);
        for ex in [r#""\x1b[31m""#, r#""\u0041""#, r#""\u{1F600}""#, r#""\b\f\v""#, r#""\0""#, r#""a\nb\tc\"d\\e""#] {
            assert!(n2.contains(ex), "{lang:?} missing `{ex}`:\n{n2}");
        }
        if lang == LanguageId::JavaScript && has_tool("node") {
            let check = format!("{n2}\nconst r = jsEscBug();\nconsole.log([r.ansi.charCodeAt(0), r.u4, r.ubrace.codePointAt(0), r.ctrl.charCodeAt(0), r.ctrl.charCodeAt(1), r.ctrl.charCodeAt(2), r.nul.charCodeAt(0), r.std.length].join('|'));\n");
            let out = Command::new("node").args(["-e", &check]).output().unwrap();
            assert!(out.status.success(), "node failed: {}", String::from_utf8_lossy(&out.stderr));
            assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "27|A|128512|8|12|11|0|9");
        }
    }
}

#[test]
fn f140_jsx_string_attr_quotes_and_newlines_2x_lossless() {
    let src = "export function B() {\n  return <div title='say \"hi\"' nl={\"line1\\nline2\"} cr={\"a\\rb\"} plain=\"ok\">hi</div>;\n}\nexport function Inline(ok: boolean) {\n  const el = ok ? <span title='say \"hi\"' nl={\"x\\ny\"} /> : null;\n  return el;\n}\n";
    let (_, _, _, n2) = roundtrip_2x(LanguageId::Tsx, "qattr.tsx", src);
    assert!(n2.contains(r#"title={"say \"hi\""}"#), "missing escaped title expr:\n{n2}");
    assert!(n2.contains(r#"nl={"line1\nline2"}"#), "missing nl expr:\n{n2}");
    assert!(n2.contains(r#"cr={"a\rb"}"#), "missing cr expr:\n{n2}");
    assert!(n2.contains(r#"plain="ok""#), "plain attr should stay quoted:\n{n2}");
}

#[test]
fn f144b_php_scope_keywords_static_prop_and_arrow_fn_2x_lossless() {
    let src = "<?php\nfunction f(): int {\n    $a = fn($x) => $x + 1;\n    $b = fn(int $x): int => $x * 2;\n    $c = static fn(?int $x = null): int => $x ?? 0;\n    return $a(1) + $b(3) + $c(4);\n}\nclass Child extends Base {\n    public static function probe(): array {\n        self::$count = self::$count + 1;\n        return [self::BASE, parent::BASE, static::BASE, self::$count, Base::$other];\n    }\n}\n";
    let (_, _, _, n2) = roundtrip_2x(LanguageId::Php, "scope.php", src);
    for ex in [
        "fn($x) => $x + 1",
        "fn(int $x): int => $x * 2",
        "static fn(?int $x = null): int => $x ?? 0",
        "self::$count = self::$count + 1",
        "self::BASE",
        "parent::BASE",
        "static::BASE",
        "Base::$other",
    ] {
        assert!(n2.contains(ex), "PHP missing `{ex}`:\n{n2}");
    }
    assert!(!n2.contains("$self::"), "PHP emitted $self:::\n{n2}");
    assert!(!n2.contains("$parent::"), "PHP emitted $parent:::\n{n2}");
    assert!(!n2.contains("$static::"), "PHP emitted $static:::\n{n2}");
    if has_tool("php") {
        let body = n2.trim_start_matches("<?php");
        let code = format!("class Base {{ public const BASE = 10; public static int $count = 5; public static int $other = 9; }}\n{body}\necho f() . '|' . implode(',', Child::probe());\n");
        let out = Command::new("php").args(["-r", &code]).output().unwrap();
        assert!(out.status.success(), "php failed: {}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout), "12|10,10,10,6,9");
    }
}

#[test]
fn f148a_java_text_block_go_channels_and_switch_exprs_2x_lossless() {
    let jtb = "public class JTB {\n    public static String s() {\n        return \"\"\"\n            hello\n            world\"\"\";\n    }\n}\n";
    let (_, _, _, jtb_n2) = roundtrip_2x(LanguageId::Java, "JTB.java", jtb);
    assert!(jtb_n2.contains("\"\"\""), "Java text block delimiters lost:\n{jtb_n2}");

    let gch = "package main\n\nfunc f() int {\n\tch := make(chan int, 1)\n\tch <- 1\n\treturn <-ch\n}\n";
    let (_, _, _, gch_n2) = roundtrip_2x(LanguageId::Go, "g_ch.go", gch);
    for ex in ["make(chan int, 1)", "ch <- 1", "return <-ch"] {
        assert!(gch_n2.contains(ex), "Go channel missing `{ex}`:\n{gch_n2}");
    }

    let jsw = "public class JSW {\n    public static String f(int x) {\n        return switch (x) { case 1 -> \"a\"; default -> \"b\"; };\n    }\n    public static String g(int x) {\n        String r = switch (x) {\n            case 1 -> \"one\";\n            default -> \"other\";\n        };\n        return r;\n    }\n}\n";
    let (_, _, _, jsw_n2) = roundtrip_2x(LanguageId::Java, "JSW.java", jsw);
    assert!(jsw_n2.contains("switch (x)"), "Java switch expr lost:\n{jsw_n2}");

    let cssw = "public class C {\n    public static string F(int x) => x switch { 1 => \"a\", _ => \"b\" };\n    public static string G(int x) {\n        var r = x switch {\n            1 => \"one\",\n            _ => \"other\",\n        };\n        return r;\n    }\n}\n";
    let (_, _, _, cssw_n2) = roundtrip_2x(LanguageId::CSharp, "CsSw.cs", cssw);
    assert!(cssw_n2.contains("x switch"), "C# switch expr lost:\n{cssw_n2}");
}

#[test]
fn f149_f150_f151_rust_ranges_go_composite_cpp_casts_2x_lossless() {
    let rs = "pub fn f(n: usize, v: &[i32]) -> (usize, &[i32], usize) {\n    let mut s = 0;\n    for i in 0..n { s += i; }\n    for i in 0..=n { s += i; }\n    let t: usize = (0..n).sum();\n    (s, &v[1..3], t + v[..2].len() + v[1..].len())\n}\n";
    let (_, _, _, rs_n2) = roundtrip_2x(LanguageId::Rust, "rng.rs", rs);
    for ex in ["for i in 0..n", "for i in 0..=n", "&v[1..3]", "(0..n).sum()", "v[..2]", "v[1..]"] {
        assert!(rs_n2.contains(ex), "Rust range missing `{ex}`:\n{rs_n2}");
    }

    let go = "package main\n\ntype Pt struct { X int }\n\nfunc f1() map[string]int { return map[string]int{\"a\": 1} }\nfunc f2() []int { return []int{1, 2, 3} }\nfunc f3() Pt {\n\tp := Pt{X: 1}\n\treturn p\n}\n";
    let (_, _, _, go_n2) = roundtrip_2x(LanguageId::Go, "comp.go", go);
    for ex in ["map[string]int{\"a\": 1}", "[]int{1, 2, 3}", "Pt{X: 1}"] {
        assert!(go_n2.contains(ex), "Go composite missing `{ex}`:\n{go_n2}");
    }

    let cpp = "int f(double d, const int* p, void* q) {\n    int a = static_cast<int>(d);\n    int b = *const_cast<int*>(p);\n    long c = reinterpret_cast<long>(q);\n    return a + b + static_cast<int>(c);\n}\n";
    let (_, _, _, cpp_n2) = roundtrip_2x(LanguageId::Cpp, "casts.cpp", cpp);
    for ex in ["static_cast<int>(d)", "*const_cast<int*>(p)", "reinterpret_cast<long>(q)"] {
        assert!(cpp_n2.contains(ex), "C++ cast missing `{ex}`:\n{cpp_n2}");
    }
}
