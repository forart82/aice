use std::path::Path;

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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n--- A1 ---\n{a1}\n--- A2 ---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
    (a1, n1)
}

#[test]
fn f176_postfix_non_null_4_langs_2x() {
    let cs = r#"public class Box {
    public bool Flag = true;
}

public class Program {
    public static bool Check(Box? b) {
        return b!.Flag;
    }

    public static bool NegCheck(Box? b) {
        return !b!.Flag;
    }

    public static int Len(string? s, int[]? arr, int x) {
        int n = x;
        n++;
        bool neq = s != null;
        return (neq ? s!.Length : 0) + arr![0] + n;
    }
}
"#;
    let (_cs_aice, cs_nat) = roundtrip_2x(LanguageId::CSharp, "NonNull.cs", cs);
    assert!(cs_nat.contains("return b!.Flag;"), "C# b!.Flag corrupted:\n{cs_nat}");
    assert!(!cs_nat.contains("return !b.Flag;"), "C# silent bool flip!\n{cs_nat}");
    assert!(cs_nat.contains("return !b!.Flag;"), "C# !b!.Flag lost:\n{cs_nat}");
    assert!(cs_nat.contains("s!.Length"), "C# s!.Length lost:\n{cs_nat}");
    assert!(cs_nat.contains("arr![0]"), "C# arr![0] lost:\n{cs_nat}");
    assert!(cs_nat.contains("n++;") && cs_nat.contains("s != null"), "C# inc/neq broken:\n{cs_nat}");

    let ts = r#"export function f(s: string | null, arr: number[] | null, cb: ((n: number) => number) | null): number {
  const raw = s!;
  const ok = !s!.startsWith("x");
  return (ok ? raw.length : 0) + arr![0] + cb!(1);
}
"#;
    let (_ts_aice, ts_nat) = roundtrip_2x(LanguageId::TypeScript, "nonnull.ts", ts);
    assert!(ts_nat.contains("const raw = s!;"), "{ts_nat}");
    assert!(ts_nat.contains("!s!.startsWith(\"x\")"), "{ts_nat}");
    assert!(ts_nat.contains("arr![0]") && ts_nat.contains("cb!(1)"), "{ts_nat}");

    let kt = r#"fun f(s: String?, xs: List<String>, arr: IntArray?): Int {
    val raw = s!!
    val ok = s!! in xs && !s!!.isEmpty()
    return (if (ok) raw.length else 0) + arr!![0]
}
"#;
    let (_kt_aice, kt_nat) = roundtrip_2x(LanguageId::Kotlin, "NonNull.kt", kt);
    assert!(kt_nat.contains("val raw = s!!"), "{kt_nat}");
    assert!(kt_nat.contains("s!! in xs"), "{kt_nat}");
    assert!(kt_nat.contains("!s!!.isEmpty()"), "{kt_nat}");
    assert!(kt_nat.contains("arr!![0]"), "{kt_nat}");

    let dart = r#"int f(String? s, List<int>? arr) {
  var raw = s!;
  var ok = s! is String && !s!.isEmpty;
  return (ok ? raw.length : 0) + arr![0];
}
"#;
    let (_d_aice, d_nat) = roundtrip_2x(LanguageId::Dart, "nonnull.dart", dart);
    assert!(d_nat.contains("var raw = s!;"), "{d_nat}");
    assert!(d_nat.contains("s! is String") && d_nat.contains("!s!.isEmpty"), "{d_nat}");
    assert!(d_nat.contains("arr![0]"), "{d_nat}");

    // Single postfix `!` hand-written in AICE IR must also parse cleanly.
    let manual = "module typescript\npub fn f(s:\"string | null\") -> num = s!.length\n";
    let parsed = parse_aice(manual).expect("manual single-bang AICE must parse");
    let nat = DefaultAiceTranspiler.to_native(&parsed, LanguageId::TypeScript).unwrap();
    assert!(nat.contains("s!.length"), "{nat}");
}

#[test]
fn f177_rust_raw_pointer_casts_2x() {
    let src = r#"fn f(x: i32) -> i32 {
    let ptr = &x as *const i32;
    let mut y = x;
    let mptr = &mut y as *mut i32;
    let p2 = ptr as *const _;
    let addr = ptr as usize;
    let back = addr as *const i32;
    unsafe { *ptr + *mptr + *p2 + *back }
}
"#;
    let (aice, nat) = roundtrip_2x(LanguageId::Rust, "raw_ptr.rs", src);
    assert!(aice.contains("ptr as usize"), "simple Rust cast should stay unquoted:\n{aice}");
    assert!(nat.contains("&x as *const i32"), "{nat}");
    assert!(nat.contains("&mut y as *mut i32"), "{nat}");
    assert!(nat.contains("ptr as *const _"), "{nat}");
    assert!(nat.contains("addr as *const i32"), "{nat}");
}

#[test]
fn f178_switch_fallthrough_and_php_switch_2x() {
    let js = r#"function f(x) {
  let r = "";
  switch (x) {
    case 1:
    case 2:
      r = "low";
      break;
    case 3:
      r = "mid";
      break;
    default:
      r = "other";
      break;
  }
  return r;
}
"#;
    let (_a, js_nat) = roundtrip_2x(LanguageId::JavaScript, "sw.js", js);
    assert!(!js_nat.contains("case 1:\n      break;"), "fake break injected in JS:\n{js_nat}");
    assert!(js_nat.contains("case 1:\n    case 2:"), "{js_nat}");

    let ts = r#"export function f(x: number): string {
  let r = "";
  switch (x) {
    case 1:
    case 2:
      r = "low";
      break;
    default:
      r = "other";
      break;
  }
  return r;
}
"#;
    let (_a, ts_nat) = roundtrip_2x(LanguageId::TypeScript, "sw.ts", ts);
    assert!(ts_nat.contains("case 1:\n    case 2:"), "{ts_nat}");

    let java = r#"public class Sw {
    public static String f(int x) {
        String r = "";
        switch (x) {
            case 1:
            case 2:
                r = "low";
                break;
            default:
                r = "other";
                break;
        }
        return r;
    }
}
"#;
    let (_a, j_nat) = roundtrip_2x(LanguageId::Java, "Sw.java", java);
    assert!(j_nat.contains("case 1:\n            case 2:"), "{j_nat}");

    let cs = r#"public class Sw {
    public static string F(int x) {
        string r = "";
        switch (x) {
            case 1:
            case 2:
                r = "low";
                break;
            default:
                r = "other";
                break;
        }
        return r;
    }
}
"#;
    let (_a, cs_nat) = roundtrip_2x(LanguageId::CSharp, "Sw.cs", cs);
    assert!(cs_nat.contains("case 1:\n            case 2:"), "{cs_nat}");

    let php = r#"<?php
function f($x) {
    $r = 0;
    switch ($x) {
        case 1:
        case 2:
            $r = 10;
            break;
        case 3:
            $r = 30;
            break;
        default:
            $r = 99;
            break;
    }
    return $r;
}
"#;
    let (_a, php_nat) = roundtrip_2x(LanguageId::Php, "sw.php", php);
    assert!(php_nat.contains("case 1:\n        case 2:"), "{php_nat}");
    assert!(php_nat.contains("$r = 10;") && php_nat.contains("$r = 30;"), "{php_nat}");
    assert!(php_nat.contains("default:") && php_nat.contains("$r = 99;"), "{php_nat}");

    // Defense in depth: compile-side must never inject `break;` on empty non-last arm.
    let manual_ir = "module javascript\nfn f(x):\n  r ::= \"\"\n  match x:\n    1 => {\n      pass\n    }\n    2 => {\n      r = \"low\"\n      break\n    }\n  ret r\n";
    let parsed = parse_aice(manual_ir).unwrap();
    let nat = DefaultAiceTranspiler.to_native(&parsed, LanguageId::JavaScript).unwrap();
    assert!(!nat.contains("case 1:\n      break;"), "compile injected fake break:\n{nat}");
}

#[test]
fn f182a_python_with_async_del_assert_2x() {
    let py = r#"def f(a, b, xs, cond):
    del xs[1]
    assert cond, "msg"
    assert cond
    if cond:
        with a as x, b as y:
            del xs[0]
            assert x is not None, "bad"
    return xs

async def g(ctx, gen):
    res = []
    async with ctx as c:
        res.append(c)
        async for item in gen:
            res.append(item)
    async for item in gen:
        res.append(item)
    return res
"#;
    let (_a, nat) = roundtrip_2x(LanguageId::Python, "f182a.py", py);
    assert!(nat.contains("del xs[1]"), "{nat}");
    assert!(nat.contains("assert cond, \"msg\""), "{nat}");
    assert!(nat.contains("        with a as x, b as y:\n            del xs[0]"), "{nat}");
    assert!(nat.contains("    async with ctx as c:\n        res.append(c)"), "{nat}");
    assert!(nat.contains("    async for item in gen:\n        res.append(item)"), "{nat}");
}

#[test]
fn f182a_typescript_as_const_and_satisfies_2x() {
    let ts = r#"type Cfg = { port: number };
export function f(): number {
  const x = [1, 2] as const;
  const obj = { port: 80 } satisfies Cfg;
  const p = ({ port: 90 } satisfies Cfg).port;
  const rec = ({ a: 1 }) as Record<string, number>;
  return x[0] + obj.port + p + rec["a"];
}
"#;
    let (_a, nat) = roundtrip_2x(LanguageId::TypeScript, "f182a.ts", ts);
    assert!(nat.contains("[1, 2] as const"), "{nat}");
    assert!(nat.contains("{ port: 80 } satisfies Cfg"), "{nat}");
    assert!(nat.contains("({ port: 90 } satisfies Cfg).port"), "{nat}");
    assert!(nat.contains("as Record<string, number>"), "{nat}");
}

#[test]
fn f182a_rust_labeled_loops_2x() {
    let rs = r#"fn f() -> i32 {
    let v = 'outer: loop {
        for i in 0..5 {
            if i == 3 {
                break 'outer 42;
            }
        }
    };
    let mut sum = 0;
    'outer2: for i in 0..3 {
        for j in 0..3 {
            if j == 1 {
                continue 'outer2;
            }
            sum += i + j;
        }
    }
    let mut k = 0;
    'w: while k < 5 {
        k += 1;
        if k == 2 {
            break 'w;
        }
    }
    let u = loop {
        break 7;
    };
    v + sum + k + u
}
"#;
    let (_a, nat) = roundtrip_2x(LanguageId::Rust, "labeled.rs", rs);
    assert!(nat.contains("'outer: loop") && nat.contains("break 'outer 42;"), "{nat}");
    assert!(nat.contains("'outer2: for i in 0..3") && nat.contains("continue 'outer2;"), "{nat}");
    assert!(nat.contains("'w: while k < 5") && nat.contains("break 'w;"), "{nat}");
    assert!(nat.contains("let u = loop") && nat.contains("break 7;"), "{nat}");
}
