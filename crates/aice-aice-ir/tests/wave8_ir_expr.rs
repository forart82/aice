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

fn verify_with_tool(tool: &str, args: &[&str], filename: &str, content: &str) {
    let Ok(which) = Command::new("which").arg(tool).output() else { return };
    if !which.status.success() { return; }
    let tmp = std::env::temp_dir().join(format!("aice_w8_{}_{filename}", std::process::id()));
    std::fs::write(&tmp, content).expect("write temp file");
    let out = Command::new(tool).args(args).arg(&tmp).output().expect("run tool");
    let _ = std::fs::remove_file(&tmp);
    assert!(
        out.status.success(),
        "{tool} {args:?} failed for {filename}:\nstdout: {}\nstderr: {}\n--- SRC ---\n{content}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
}

#[test]
fn v8_2a_01_c_and_cpp_cast_expressions_roundtrip() {
    let c_exact = "int f(long x) {\n    int y = (int)x + 1;\n    return y;\n}\n";
    let (aice_c, nat_c) = roundtrip(LanguageId::C, "cast_exact.c", c_exact);
    assert!(aice_c.contains("y:int ::= x as int + 1"), "C cast AICE:\n{aice_c}");
    assert!(nat_c.contains("int y = (int)x + 1;"), "C cast native:\n{nat_c}");
    assert!(!nat_c.contains("int y = int;"), "C cast corrupted:\n{nat_c}");
    verify_with_tool("gcc", &["-std=c99", "-Wall", "-Werror", "-fsyntax-only"], "cast_exact.c", &nat_c);

    let c_adv = r#"int g(long x, void* p) {
    int a = (int)(x + 1);
    unsigned long b = (unsigned long)x;
    int* q = (int*)p;
    int c = *(int*)p;
    int d = (int)(long)x;
    return a + (int)b + *q + c + d;
}
"#;
    let (aice_adv, nat_adv) = roundtrip(LanguageId::C, "cast_adv.c", c_adv);
    assert!(aice_adv.contains("(x + 1) as int"), "C paren cast AICE:\n{aice_adv}");
    assert!(aice_adv.contains("x as \"unsigned long\""), "C multi-word cast AICE:\n{aice_adv}");
    assert!(aice_adv.contains("p as \"int*\""), "C ptr cast AICE:\n{aice_adv}");
    assert!(nat_adv.contains("(int)(x + 1)"), "C paren cast native:\n{nat_adv}");
    assert!(nat_adv.contains("(unsigned long)x"), "C multi-word cast native:\n{nat_adv}");
    assert!(nat_adv.contains("(int*)p"), "C ptr cast native:\n{nat_adv}");
    verify_with_tool("gcc", &["-std=c99", "-Wall", "-fsyntax-only"], "cast_adv.c", &nat_adv);

    let cpp_src = "int f(long x, void* p) {\n    int y = (int)x + (int)(x + 1);\n    int* q = (int*)p;\n    return y + *q;\n}\n";
    let (_, nat_cpp) = roundtrip(LanguageId::Cpp, "cast.cpp", cpp_src);
    assert!(nat_cpp.contains("(int)x + (int)(x + 1)"), "C++ cast native:\n{nat_cpp}");
    assert!(nat_cpp.contains("(int*)p"), "C++ ptr cast native:\n{nat_cpp}");
    verify_with_tool("g++", &["-std=c++20", "-Wall", "-fsyntax-only"], "cast.cpp", &nat_cpp);
}

#[test]
fn v8_tsw_01_js_ts_yield_star_delegation() {
    let ts_src = r#"export function* g(xs: number[]): Generator<number> {
  yield* xs;
}

export class Vault {
  #secret = 42;
  *values(): Generator<number> {
    yield this.#secret;
  }
  async *stream(): AsyncGenerator<number> {
    yield* this.values();
    const res = yield* [1, 2];
    yield res;
  }
}
"#;
    let (aice_ts, nat_ts) = roundtrip(LanguageId::TypeScript, "yield_star.ts", ts_src);
    assert!(aice_ts.contains("yield* xs"), "TS yield* AICE:\n{aice_ts}");
    assert!(aice_ts.contains("yield* this.values()"), "TS yield* method AICE:\n{aice_ts}");
    assert!(aice_ts.contains("yield* [1, 2]"), "TS yield* array AICE:\n{aice_ts}");
    assert!(nat_ts.contains("yield* xs;"), "TS yield* dropped *:\n{nat_ts}");
    assert!(nat_ts.contains("yield* this.values();"), "TS yield* method dropped *:\n{nat_ts}");
    assert!(nat_ts.contains("const res = yield* [1, 2];"), "TS yield* assign dropped *:\n{nat_ts}");
    assert!(nat_ts.contains("yield this.#secret;"), "TS plain yield broken:\n{nat_ts}");

    let js_src = "export function* g(xs) {\n  yield* xs;\n  yield 99;\n}\n";
    let (aice_js, nat_js) = roundtrip(LanguageId::JavaScript, "yield_star.mjs", js_src);
    assert!(aice_js.contains("yield* xs"), "JS yield* AICE:\n{aice_js}");
    assert!(nat_js.contains("yield* xs;"), "JS yield* native:\n{nat_js}");
    verify_with_tool("node", &["--check"], "yield_star.mjs", &nat_js);

    // Runtime delegation check via node
    if Command::new("which").arg("node").output().is_ok_and(|o| o.status.success()) {
        let script = format!("{}\nconst out = [...g([1, 2, 3])]; if (JSON.stringify(out) !== '[1,2,3,99]') process.exit(1);", nat_js.replace("export ", ""));
        let out = Command::new("node").args(["-e", &script]).output().expect("node -e");
        assert!(out.status.success(), "JS yield* runtime failed: {}", String::from_utf8_lossy(&out.stderr));
    }
}

#[test]
fn v8_tsw_02_js_ts_array_destructuring_rest_and_nested() {
    let ts_src = r#"export function f(xs: number[]) {
  const [head, ...rest] = xs;
  let [first = 0, ...tail] = xs;
  const [, second, ...more] = xs;
  return [head, rest.length, first, tail.length, second, more.length];
}
"#;
    let (aice_ts, nat_ts) = roundtrip(LanguageId::TypeScript, "arr_destr.ts", ts_src);
    assert!(aice_ts.contains("[head, ...rest] := xs"), "TS rest destr AICE:\n{aice_ts}");
    assert!(aice_ts.contains("[first = 0, ...tail] ::= xs"), "TS default rest destr AICE:\n{aice_ts}");
    assert!(nat_ts.contains("const [head, ...rest] = xs;"), "TS rest destr native:\n{nat_ts}");
    assert!(nat_ts.contains("let [first = 0, ...tail] = xs;"), "TS mut rest destr native:\n{nat_ts}");
    assert!(nat_ts.contains("const [, second, ...more] = xs;"), "TS hole rest destr native:\n{nat_ts}");

    let js_nested = "export function unpack(pair) {\n  const [[a, b], { id }, ...rest] = pair;\n  return [a, b, id, rest.length];\n}\n";
    let (_, nat_nested) = roundtrip(LanguageId::JavaScript, "arr_nested.mjs", js_nested);
    assert!(nat_nested.contains("const [[a, b], { id }, ...rest] = pair;"), "JS nested destr native:\n{nat_nested}");
    verify_with_tool("node", &["--check"], "arr_nested.mjs", &nat_nested);
}

#[test]
fn v8_tsw_03_js_ts_object_literal_and_expr_generators() {
    let js_exact = r#"export const o = {
  *items() { yield 1; yield 2; },
  async *ticks() { yield 3; },
  *[Symbol.iterator]() { yield 4; },
};

export const standalone = function*(n) {
  yield n;
};

export const asyncStandalone = async function*(n) {
  yield n;
};
"#;
    let (aice_js, nat_js) = roundtrip(LanguageId::JavaScript, "obj_gen.mjs", js_exact);
    assert!(aice_js.contains("items: fn*()"), "JS obj gen AICE:\n{aice_js}");
    assert!(aice_js.contains("ticks: async fn*()"), "JS obj async gen AICE:\n{aice_js}");
    assert!(aice_js.contains("standalone := fn*(n)"), "JS standalone gen AICE:\n{aice_js}");
    assert!(aice_js.contains("asyncStandalone := async fn*(n)"), "JS async standalone gen AICE:\n{aice_js}");
    assert!(nat_js.contains("*items()"), "JS obj gen native:\n{nat_js}");
    assert!(nat_js.contains("async *ticks()"), "JS obj async gen native:\n{nat_js}");
    assert!(nat_js.contains("*[Symbol.iterator]()"), "JS computed gen native:\n{nat_js}");
    assert!(nat_js.contains("function*(n)"), "JS standalone gen native:\n{nat_js}");
    assert!(nat_js.contains("async function*(n)"), "JS async standalone gen native:\n{nat_js}");
    assert!(!nat_js.contains("() => { yield"), "JS emitted illegal arrow yield:\n{nat_js}");
    verify_with_tool("node", &["--check"], "obj_gen.mjs", &nat_js);

    // Full ds_edge_js.mjs pattern with default parameter & loop
    let ds_edge = r#"export function createStore(initial = 0) {
  let value = initial;
  return {
    get() { return value; },
    async *ticks(limit = 3) {
      for (let i = 0; i < limit; i++) {
        yield value + i;
      }
    },
  };
}
"#;
    let (_, nat_ds) = roundtrip(LanguageId::JavaScript, "ds_edge.mjs", ds_edge);
    assert!(nat_ds.contains("async *ticks(limit = 3)"), "ds_edge async *ticks native:\n{nat_ds}");
    verify_with_tool("node", &["--check"], "ds_edge.mjs", &nat_ds);

    // TypeScript typed object-literal generator
    let ts_obj = "export const seq = {\n  *nums(): Generator<number> { yield 1; },\n  async *asyncNums(): AsyncGenerator<number> { yield 2; },\n};\n";
    let (_, nat_ts) = roundtrip(LanguageId::TypeScript, "obj_gen.ts", ts_obj);
    assert!(nat_ts.contains("*nums(): Generator<number>"), "TS obj gen native:\n{nat_ts}");
    assert!(nat_ts.contains("async *asyncNums(): AsyncGenerator<number>"), "TS obj async gen native:\n{nat_ts}");
}

#[test]
fn v8_2c_03_csharp_array_creation_and_php_non_regression() {
    let cs_src = r#"namespace Demo;

public class ArrDemo {
    public int Run(int n) {
        var a = new int[2];
        var b = new int[] { 1, 2 };
        var c = new[] { 10, 20 };
        var d = new int[2, 3];
        var e = new int[2][];
        var f = new int[2] { 3, 4 };
        var g = new string[] { "x", "y" };
        var h = new int[n + 1];
        var nested = new[] { new[] { 1, 2 }, new[] { 3, 4 } };
        return a.Length + b[0] + c[1] + d.Length + e.Length + f[0] + g.Length + h.Length + nested.Length;
    }
}
"#;
    let (aice_cs, nat_cs) = roundtrip(LanguageId::CSharp, "ArrDemo.cs", cs_src);
    for exp in [
        "new int[2]",
        "new int[] { 1, 2 }",
        "new[] { 10, 20 }",
        "new int[2, 3]",
        "new int[2][]",
        "new int[2] { 3, 4 }",
        "new string[] { \"x\", \"y\" }",
        "new int[n + 1]",
        "new[] { new[] { 1, 2 }, new[] { 3, 4 } }",
    ] {
        assert!(aice_cs.contains(exp), "C# AICE missing `{exp}`:\n{aice_cs}");
        assert!(nat_cs.contains(exp), "C# native missing `{exp}`:\n{nat_cs}");
    }
    assert!(!aice_cs.contains("a ::= []"), "C# new int[2] corrupted to []:\n{aice_cs}");
    assert!(!nat_cs.contains("var a = [];"), "C# native new int[2] corrupted to []:\n{nat_cs}");

    // PHP array_creation_expression non-regression
    let php_src = "<?php\nfunction demo() {\n    $a = [1, 2, 3];\n    $m = [\"k\" => 1];\n    return $a;\n}\n";
    let (aice_php, nat_php) = roundtrip(LanguageId::Php, "arr.php", php_src);
    assert!(aice_php.contains("[1, 2, 3]"), "PHP array AICE:\n{aice_php}");
    assert!(nat_php.contains("[1, 2, 3]"), "PHP array native:\n{nat_php}");

    // Java array_creation_expression also works
    let java_src = "public class JArr {\n    public int run() {\n        int[] a = new int[2];\n        int[] b = new int[] { 1, 2 };\n        return a.length + b[0];\n    }\n}\n";
    let (_, nat_java) = roundtrip(LanguageId::Java, "JArr.java", java_src);
    assert!(nat_java.contains("new int[2]"), "Java new int[2] native:\n{nat_java}");
    assert!(nat_java.contains("new int[] { 1, 2 }"), "Java new int[] {{ 1, 2 }} native:\n{nat_java}");

    // JS `new handlers[0](x)` must stay constructor call, not array creation
    let js_new_idx = "export function make(handlers, x) {\n  return new handlers[0](x);\n}\n";
    let (_, nat_js_idx) = roundtrip(LanguageId::JavaScript, "new_idx.mjs", js_new_idx);
    assert!(nat_js_idx.contains("new handlers[0](x)"), "JS new handlers[0](x):\n{nat_js_idx}");
    verify_with_tool("node", &["--check"], "new_idx.mjs", &nat_js_idx);
}

#[test]
fn v8_2c_06_ruby_logical_or_and_precedence() {
    let rb_src = r#"module Accounts
  class Profile
    def display_label(user, active, fallback)
      x = user&.name || "anon"
      y = active && user&.role || fallback
      x
    end
  end
end
"#;
    let (aice_rb, nat_rb) = roundtrip(LanguageId::Ruby, "profile.rb", rb_src);
    assert!(aice_rb.contains("or \"anon\""), "Ruby AICE or:\n{aice_rb}");
    assert!(nat_rb.contains("x = user&.name() || \"anon\""), "Ruby native ||:\n{nat_rb}");
    assert!(nat_rb.contains("&&"), "Ruby native &&:\n{nat_rb}");
    assert!(!nat_rb.contains(" or "), "Ruby emitted low-precedence `or`:\n{nat_rb}");
    assert!(!nat_rb.contains(" and "), "Ruby emitted low-precedence `and`:\n{nat_rb}");

    // Python must still emit `and` / `or`
    let py_src = "def check(a, b, c):\n    return (a and b) or c\n";
    let (_, nat_py) = roundtrip(LanguageId::Python, "check.py", py_src);
    assert!(nat_py.contains("and") && nat_py.contains("or"), "Python must keep and/or:\n{nat_py}");
}
