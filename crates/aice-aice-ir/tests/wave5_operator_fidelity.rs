use std::path::Path;

use aice_aice_ir::ir::AiceItem;
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
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

#[test]
fn f56_hollow_meridian_fnv1a_mulberry32_and_ts_tsx_js_compound_ops() {
    let ts_rng = r#"export function hashSeed(key: string): number {
  let h = 2166136261;
  for (let i = 0; i < key.length; i++) {
    h ^= key.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  h ^= h >>> 16;
  h = Math.imul(h, 0x85ebca6b);
  h ^= h >>> 13;
  h = Math.imul(h, 0xc2b2ae35);
  h ^= h >>> 16;
  return h >>> 0;
}

export function allCompoundTs(h: number, a: any, b: any, obj: any): number {
  let literal = "a += b";
  h += 1;
  h -= 2;
  h *= 3;
  h /= 4;
  h %= 5;
  h **= 2;
  h &= 0xff;
  h |= 0x10;
  h ^= 0x5a;
  h <<= 2;
  h >>= 1;
  h >>>= 3;
  a ??= b;
  a &&= b;
  a ||= b;
  const x = (a + b) * (h >>> 16);
  const masked = (h & 0xff) === 0 ? 1 : 0;
  const t = typeof a;
  const v = void 0;
  delete obj.stale;
  const pos = +h;
  const inv = ~h;
  const postInc = h++;
  const preInc = ++h;
  const postDec = h--;
  const preDec = --h;
  return x + masked + pos + inv + postInc + preInc + postDec + preDec + (t ? 1 : 0) + (v ? 0 : 1) + literal.length;
}
"#;
    for (lang, vname) in [
        (LanguageId::TypeScript, "rng.ts"),
        (LanguageId::Tsx, "rng.tsx"),
    ] {
        let (aice, native) = roundtrip(lang, vname, ts_rng);
        for op in [
            "h ^= key.charCodeAt(i)",
            "h ^= h >>> 16",
            "h ^= h >>> 13",
            "literal ::= \"a += b\"",
            "h += 1", "h -= 2", "h *= 3", "h /= 4", "h %= 5", "h **= 2",
            "h &= 0xff", "h |= 0x10", "h ^= 0x5a", "h <<= 2", "h >>= 1", "h >>>= 3",
            "a ??= b", "a &&= b", "a ||= b",
            "(a + b) * (h >>> 16)",
            "(h & 0xff) == 0 ? 1 : 0",
            "typeof a", "void 0", "delete obj.stale",
            "+h", "~h", "h++", "++h", "h--", "--h",
        ] {
            assert!(aice.contains(op), "{lang:?} AICE corrupted `{op}`:\n{aice}");
        }
        for op in [
            "h ^= key.charCodeAt(i);",
            "h ^= h >>> 16;",
            "h ^= h >>> 13;",
            "let literal = \"a += b\";",
            "h += 1;", "h -= 2;", "h *= 3;", "h /= 4;", "h %= 5;", "h **= 2;",
            "h &= 0xff;", "h |= 0x10;", "h ^= 0x5a;", "h <<= 2;", "h >>= 1;", "h >>>= 3;",
            "a ??= b;", "a &&= b;", "a ||= b;",
            "(a + b) * (h >>> 16);",
            "(h & 0xff) === 0 ? 1 : 0;",
            "typeof a;", "void 0;", "delete obj.stale;",
            "+h;", "~h;", "h++;", "++h;", "h--;", "--h;",
        ] {
            assert!(native.contains(op), "{lang:?} native corrupted `{op}`:\n{native}");
        }
        assert!(!native.contains("h = key.charCodeAt(i)"), "F-56 XOR degraded to =:\n{native}");
        assert!(!native.contains("h *= 2;"), "F-56 **= degraded to *=:\n{native}");
    }

    let js_src = r#"export function mixJs(h, a, b, obj) {
  h %= 7;
  h **= 2;
  h &= 15;
  h |= 32;
  h ^= h >>> 16;
  h <<= 3;
  h >>= 1;
  h >>>= 2;
  a ??= b;
  a &&= b;
  a ||= b;
  const k = typeof a;
  const z = void 0;
  delete obj.tmp;
  return (h + a) * (h >>> 1) + (k === "number" ? 1 : 0) + (z ? 0 : 1);
}
"#;
    let (js_aice, js_nat) = roundtrip(LanguageId::JavaScript, "mix.js", js_src);
    for op in [
        "h %= 7", "h **= 2", "h &= 15", "h |= 32", "h ^= h >>> 16",
        "h <<= 3", "h >>= 1", "h >>>= 2", "a ??= b", "a &&= b", "a ||= b",
        "typeof a", "void 0", "delete obj.tmp", "(h + a) * (h >>> 1)",
    ] {
        assert!(js_aice.contains(op), "JS AICE lost `{op}`:\n{js_aice}");
        assert!(js_nat.contains(op), "JS native lost `{op}`:\n{js_nat}");
    }
}

#[test]
fn f56_polyglot_compound_and_sibling_operators_rust_py_php_go() {
    // Rust: all compound assignments, bitwise precedence parens, &/&mut/*, postfix ? (assign + tail)
    let rust_src = r#"pub fn mix_rust(mut h: u32, a: &u32, b: &mut u32, r: Result<u32, ()>) -> Result<u32, ()> {
    h += 1;
    h -= 2;
    h *= 3;
    h /= 4;
    h %= 5;
    h &= 7;
    h |= 8;
    h ^= h >> 16;
    h <<= 2;
    h >>= 1;
    let x = (h ^ (h >> 16)) * 3;
    let y = !h;
    let p = &h;
    let q = &mut h;
    let v = *a + *b;
    let z = r?;
    Ok(h + x + y + v + z + *p + *q)
}

pub fn tail_try(r: Result<u32, ()>) -> Result<u32, ()> {
    let v = r?;
    Ok(v)
}

pub fn direct_tail_try(r: Result<u32, ()>) -> Result<u32, ()> {
    tail_try(r)?
}
"#;
    let (rs_aice, rs_nat) = roundtrip(LanguageId::Rust, "mix.rs", rust_src);
    for op in [
        "h += 1", "h -= 2", "h *= 3", "h /= 4", "h %= 5",
        "h &= 7", "h |= 8", "h ^= h >> 16", "h <<= 2", "h >>= 1",
        "(h ^ h >> 16) * 3", "r?", "tail_try(r)?", "&h", "&mut h", "*a",
    ] {
        assert!(rs_aice.contains(op), "Rust AICE lost `{op}`:\n{rs_aice}");
    }
    for op in [
        "h %= 5;", "h &= 7;", "h |= 8;", "h ^= h >> 16;", "h <<= 2;", "h >>= 1;",
        "(h ^ h >> 16) * 3;", "!h;", "&h;", "&mut h;", "*a", "r?;", "tail_try(r)?",
    ] {
        assert!(rs_nat.contains(op), "Rust native lost `{op}`:\n{rs_nat}");
    }
    assert!(!rs_aice.contains("try:"), "Rust tail try_expression miscompiled as try block:\n{rs_aice}");

    // Python: all 12 compound assignments (incl //=, %=, **=), // floor div, is/is not/in/not in, ~, +, yield
    let py_src = r#"def mix_py(h: int, a, b, xs):
    h += 1
    h -= 2
    h *= 3
    h /= 4
    h //= 2
    h %= 5
    h **= 2
    h &= 7
    h |= 8
    h ^= 9
    h <<= 1
    h >>= 1
    q = h // 2
    inv = ~h
    pos = +h
    c1 = a is None
    c2 = a is not None
    c3 = a in xs
    c4 = a not in xs
    return (h + q) * (inv + pos) if c2 else b

def gen(items):
    for item in items:
        yield item + 1
"#;
    let (py_aice, py_nat) = roundtrip(LanguageId::Python, "mix.py", py_src);
    for op in [
        "h //= 2", "h %= 5", "h **= 2", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1",
        "q = h ~/ 2", "inv = ~h", "pos = +h",
        "c1 = a is None", "c2 = a is not None", "c3 = a in xs", "c4 = a not in xs",
        "yield item + 1",
    ] {
        assert!(py_aice.contains(op), "Python AICE lost `{op}`:\n{py_aice}");
    }
    for op in [
        "h //= 2", "h %= 5", "h **= 2", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1",
        "q = h // 2", "inv = ~h", "pos = +h",
        "c1 = a is None", "c2 = a is not None", "c3 = a in xs", "c4 = a not in xs",
        "(h + q) * (inv + pos) if c2 else b",
        "yield item + 1",
    ] {
        assert!(py_nat.contains(op), "Python native lost `{op}`:\n{py_nat}");
    }

    // PHP: all 13 compound assignments (incl .=, ??=, **=, %=), Elvis ?:, ternary ? :, spaceship <=>
    let php_src = r#"<?php
function mix_php($h, $a, $b, $s) {
    $h += 1;
    $h -= 2;
    $h *= 3;
    $h /= 4;
    $h %= 5;
    $h **= 2;
    $h &= 7;
    $h |= 8;
    $h ^= 9;
    $h <<= 1;
    $h >>= 1;
    $s .= "x";
    $a ??= $b;
    $elvis = $a ?: $b;
    $tern = $a ? $b : 0;
    $cmp = $a <=> $b;
    $coal = $a ?? $b;
    return $h + $cmp + $tern + $elvis + $coal;
}
"#;
    let (php_aice, php_nat) = roundtrip(LanguageId::Php, "mix.php", php_src);
    for op in [
        "$h %= 5", "$h **= 2", "$h &= 7", "$h |= 8", "$h ^= 9", "$h <<= 1", "$h >>= 1",
        "$s .= \"x\"", "$a ??= $b", "$elvis = $a ?: $b", "$tern = $a ? $b : 0",
        "$cmp = $a <=> $b", "$coal = $a ?? $b",
    ] {
        assert!(php_aice.contains(op), "PHP AICE lost `{op}`:\n{php_aice}");
        assert!(php_nat.contains(op), "PHP native lost `{op}`:\n{php_nat}");
    }
    assert!(!php_aice.contains("$a ? $b : $b"), "PHP Elvis corrupted to ternary:\n{php_aice}");

    // Go: all 11 compound assignments (incl &^=), &^ binary, ^ unary bitnot, h++, k--
    let go_src = r#"package main
func mixGo(h, k int) int {
    h += 1
    h -= 2
    h *= 3
    h /= 4
    h %= 5
    h &= 7
    h |= 8
    h ^= 9
    h <<= 1
    h >>= 1
    h &^= 4
    inv := ^h
    clr := h &^ (k + 1)
    h++
    k--
    return h + inv + clr + k
}
"#;
    let (go_aice, go_nat) = roundtrip(LanguageId::Go, "mix.go", go_src);
    for op in [
        "h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "h &^= 4",
        "inv ::= ~h", "clr ::= h &^ (k + 1)", "h++", "k--",
    ] {
        assert!(go_aice.contains(op), "Go AICE lost `{op}`:\n{go_aice}");
    }
    for op in [
        "h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "h &^= 4",
        "inv := ^h", "clr := h &^ (k + 1)", "h++", "k--",
    ] {
        assert!(go_nat.contains(op), "Go native lost `{op}`:\n{go_nat}");
    }
}

#[test]
fn f56_polyglot_compound_and_sibling_operators_cs_kt_dart_rb_java_c_cpp() {
    // C#: %= &= |= ^= <<= >>= >>>= ??= ?? ~ ++ -- ternary
    let cs_src = r#"public class BitOps {
    public int Run(int h, int? a, int b) {
        h %= 5;
        h &= 7;
        h |= 8;
        h ^= 9;
        h <<= 1;
        h >>= 1;
        h >>>= 1;
        a ??= b;
        var c = a ?? b;
        var inv = ~h;
        var inc = h++;
        var dec = --h;
        return (h + c) * 2 + inv + inc + dec;
    }
}
"#;
    let (cs_aice, cs_nat) = roundtrip(LanguageId::CSharp, "BitOps.cs", cs_src);
    for op in ["h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "h >>>= 1", "a ??= b", "a ?? b", "~h", "h++", "--h", "(h + c) * 2"] {
        assert!(cs_aice.contains(op), "C# AICE lost `{op}`:\n{cs_aice}");
        assert!(cs_nat.contains(op), "C# native lost `{op}`:\n{cs_nat}");
    }

    // Kotlin: += -= *= /= %= Elvis ?: if-expr ternary in !in ++ --
    let kt_src = r#"fun runKt(a: Int?, b: Int, items: List<Int>): Int {
    var h = b
    h += 1
    h -= 2
    h *= 3
    h /= 4
    h %= 5
    val elvis = a ?: b
    val tern = if (h > 0) 1 else 2
    val has = h in items
    val missing = h !in items
    val inc = h++
    return h + elvis + tern + inc
}
"#;
    let (kt_aice, kt_nat) = roundtrip(LanguageId::Kotlin, "Ops.kt", kt_src);
    for op in ["h %= 5", "elvis := a ?: b", "tern := h > 0 ? 1 : 2", "has := h in items", "missing := h not in items", "inc := h++"] {
        assert!(kt_aice.contains(op), "Kotlin AICE lost `{op}`:\n{kt_aice}");
    }
    for op in ["h %= 5", "val elvis = a ?: b", "if (h > 0) 1 else 2", "h in items", "h !in items", "h++"] {
        assert!(kt_nat.contains(op), "Kotlin native lost `{op}`:\n{kt_nat}");
    }

    // Dart: ~/= %= &= |= ^= <<= >>= >>>= ??= ~/ ?? ~
    let dart_src = r#"int runDart(int h, int? a, int b) {
  h ~/= 2;
  h %= 5;
  h &= 7;
  h |= 8;
  h ^= 9;
  h <<= 1;
  h >>= 1;
  h >>>= 1;
  a ??= b;
  var q = h ~/ 2;
  var c = a ?? b;
  var inv = ~h;
  return h + q + c + inv;
}
"#;
    let (dart_aice, dart_nat) = roundtrip(LanguageId::Dart, "ops.dart", dart_src);
    for op in ["h ~/= 2", "h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "h >>>= 1", "a ??= b", "h ~/ 2", "a ?? b", "~h"] {
        assert!(dart_aice.contains(op), "Dart AICE lost `{op}`:\n{dart_aice}");
        assert!(dart_nat.contains(op), "Dart native lost `{op}`:\n{dart_nat}");
    }

    // Ruby: %= **= &= |= ^= <<= >>= ||= &&= <=> ternary
    let rb_src = r#"def run_rb(h, a, b)
  h %= 5
  h **= 2
  h &= 7
  h |= 8
  h ^= 9
  h <<= 1
  h >>= 1
  a ||= b
  a &&= b
  sp = a <=> b
  t = a ? 1 : 2
  h + sp + t
end
"#;
    let (rb_aice, rb_nat) = roundtrip(LanguageId::Ruby, "ops.rb", rb_src);
    for op in ["h %= 5", "h **= 2", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "a ||= b", "a &&= b", "a <=> b", "a ? 1 : 2"] {
        assert!(rb_aice.contains(op), "Ruby AICE lost `{op}`:\n{rb_aice}");
        assert!(rb_nat.contains(op), "Ruby native lost `{op}`:\n{rb_nat}");
    }

    // Java: %= &= |= ^= <<= >>= >>>= >>> ~
    let java_src = r#"class BitMath {
    int mix(int h) {
        h %= 5;
        h &= 7;
        h |= 8;
        h ^= 9;
        h <<= 1;
        h >>= 1;
        h >>>= 2;
        int x = ~h;
        int y = (h ^ (h >>> 16)) * 3;
        return h + x + y;
    }
}
"#;
    let (java_aice, java_nat) = roundtrip(LanguageId::Java, "BitMath.java", java_src);
    for op in ["h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "h >>>= 2", "~h", "(h ^ h >>> 16) * 3"] {
        assert!(java_aice.contains(op), "Java AICE lost `{op}`:\n{java_aice}");
        assert!(java_nat.contains(op), "Java native lost `{op}`:\n{java_nat}");
    }

    // C & C++: %= &= |= ^= <<= >>= ~, C++ <=>
    let c_src = r#"int mix_c(int h, int k) {
    h %= 5;
    h &= 7;
    h |= 8;
    h ^= 9;
    h <<= 1;
    h >>= 1;
    int inv = ~h;
    return (h + k) * inv;
}
"#;
    let (c_aice, c_nat) = roundtrip(LanguageId::C, "mix.c", c_src);
    for op in ["h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "~h", "(h + k) * inv"] {
        assert!(c_aice.contains(op), "C AICE lost `{op}`:\n{c_aice}");
        assert!(c_nat.contains(op), "C native lost `{op}`:\n{c_nat}");
    }

    let cpp_src = r#"int mix_cpp(int h, int a) {
    h %= 5;
    h &= 7;
    h |= 8;
    h ^= 9;
    h <<= 1;
    h >>= 1;
    auto cmp = a <=> h;
    int inv = ~h;
    return h + inv;
}
"#;
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "mix.cpp", cpp_src);
    for op in ["h %= 5", "h &= 7", "h |= 8", "h ^= 9", "h <<= 1", "h >>= 1", "a <=> h", "~h"] {
        assert!(cpp_aice.contains(op), "C++ AICE lost `{op}`:\n{cpp_aice}");
        assert!(cpp_nat.contains(op), "C++ native lost `{op}`:\n{cpp_nat}");
    }
}

#[test]
fn f57_go_grouped_params_struct_fields_and_variadic_params() {
    let go_src = r#"package geom

type Vec3 struct {
    X, Y, Z int
    Label string
}

type Adder interface {
    Sum(a, b int, extra ...int) int
}

func combine(a, b int, prefix string, rest ...int) int {
    acc := a + b
    for _, v := range rest {
        acc += v
    }
    return acc
}
"#;
    let (aice, native) = roundtrip(LanguageId::Go, "geom.go", go_src);
    for expected in [
        "pub X:int",
        "pub Y:int",
        "pub Z:int",
        "pub Label:str",
        "fn Sum(a:int, b:int, ...extra:int) -> int",
        "pkg fn combine(a:int, b:int, prefix:str, ...rest:int) -> int:",
    ] {
        assert!(aice.contains(expected), "F-57 Go AICE dropped `{expected}`:\n{aice}");
    }
    for expected in [
        "X int",
        "Y int",
        "Z int",
        "Label string",
        "Sum(a int, b int, extra ...int) int",
        "func combine(a int, b int, prefix string, rest ...int) int",
    ] {
        assert!(native.contains(expected), "F-57 Go native dropped `{expected}`:\n{native}");
    }
}

#[test]
fn f58_php_braced_namespace_directive_span_clamped_to_header() {
    let php_src = r#"<?php

namespace Symfony\Tests {
    class BaseCase {
        public function boot(): void {
            $this->ok();
        }
    }
}

namespace App\Tests {
    class OrderTest {
        public function run(): int {
            return 42;
        }
    }
}
"#;
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(LanguageId::Php).unwrap().parse_cst(php_src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, php_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled PHP module");
    };

    let ns_dir = m
        .items
        .iter()
        .find_map(|it| match it {
            AiceItem::Directive { text, span, .. } if text == "namespace App\\Tests;" => Some(*span),
            _ => None,
        })
        .expect("expected Directive for second braced namespace");
    let order_cls = m
        .items
        .iter()
        .find_map(|it| match it {
            AiceItem::Class(c) if c.name == "OrderTest" => Some(c.span),
            _ => None,
        })
        .expect("expected OrderTest class item");

    let open_brace = php_src[ns_dir.start_byte..].find('{').expect("namespace brace") + ns_dir.start_byte;
    assert!(
        ns_dir.end_byte <= open_brace,
        "F-58 regression: namespace Directive span {:?} extends past header brace at byte {open_brace}",
        ns_dir
    );
    assert!(
        ns_dir.end_byte < order_cls.start_byte,
        "F-58 regression: namespace Directive span {:?} overlaps inner class span {:?}",
        ns_dir,
        order_cls
    );

    let (aice, native) = roundtrip(LanguageId::Php, "multi_ns.php", php_src);
    assert!(aice.contains("OrderTest") && native.contains("namespace App\\Tests;"), "{aice}\n{native}");
}

#[test]
fn f59_php_global_namespace_leading_backslash_preserved() {
    let php_src = r#"<?php

namespace App\Http;

class Dispatcher {
    public function inspect(object $controller): object {
        $ref = new \ReflectionClass($controller);
        $flags = \ReflectionMethod::IS_PUBLIC;
        $runner = new \App\Services\Runner($ref, $flags);
        if (!$runner) {
            throw new \RuntimeException("missing");
        }
        return $runner;
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Php, "Dispatcher.php", php_src);
    for expected in [
        "new \\ReflectionClass($controller)",
        "\\ReflectionMethod::IS_PUBLIC",
        "new \\App\\Services\\Runner($ref, $flags)",
        "throw new \\RuntimeException(\"missing\")",
    ] {
        assert!(aice.contains(expected), "F-59 PHP AICE dropped leading backslash `{expected}`:\n{aice}");
        assert!(native.contains(expected), "F-59 PHP native dropped leading backslash `{expected}`:\n{native}");
    }
}
