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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String, String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n--- A1 ---\n{a1}\n--- A2 ---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
    (a1, n1, a2, n2)
}

#[test]
fn f155_c_pointer_arrow_and_named_vs_anon_struct_2x() {
    let src = r#"struct P;

int get_x(struct P *p);

struct P {
    int x;
    struct P *next;
};

typedef struct {
    int a;
    int b;
} AnonPair;

typedef int (*IntFn)(int);

struct Ops {
    IntFn fn;
};

int get_x(struct P *p) {
    return p->x;
}

int get_val(struct P v) {
    return v.x;
}

int get_next_x(struct P *p) {
    return p->next->x;
}

int get_deref_pp(struct P **pp) {
    return (*pp)->x;
}

int call_op(struct Ops *ops, int v) {
    return ops->fn(v);
}

int sum_anon(AnonPair v, AnonPair *p) {
    return v.a + p->b;
}
"#;
    let (_, n1, _, n2) = roundtrip_2x(LanguageId::C, "ptr_struct.c", src);
    for exp in [
        "struct P;",
        "typedef struct P {",
        "struct P* next;",
        "} P;",
        "typedef struct {\n    int a;\n    int b;\n} AnonPair;",
        "typedef int (*IntFn)(int);",
        "typedef struct Ops {",
        "return p->x;",
        "return v.x;",
        "return p->next->x;",
        "return (*pp)->x;",
        "return ops->fn(v);",
        "return v.a + p->b;",
    ] {
        assert!(n1.contains(exp), "C native missing `{exp}`:\n{n1}");
        assert!(n2.contains(exp), "C 2x native missing `{exp}`:\n{n2}");
    }
    assert!(!n1.contains("p.x"), "C corrupted p->x to p.x:\n{n1}");
    assert!(!n1.contains("p.next"), "C corrupted p->next to p.next:\n{n1}");
    assert!(!n1.contains("ops.fn"), "C corrupted ops->fn to ops.fn:\n{n1}");
    assert!(!n1.contains("@tag("), "C leaked internal @tag:\n{n1}");
}

#[test]
fn f155_cpp_pointer_arrow_iter_chain_and_method_call_2x() {
    let src = r#"#include <map>
#include <memory>

struct Node {
    int x;
    Node* next;
    int fn(int d) {
        return x + d;
    }
};

int read_node(Node* p, Node v, Node** pp) {
    return p->x + v.x + p->next->x + (*pp)->x + p->fn(1);
}

int sum_map(const std::map<int, int>& m) {
    int total = 0;
    for (auto it = m.begin(); it != m.end(); ++it) {
        total += it->second;
    }
    return total;
}

int read_unique(const std::unique_ptr<Node>& up) {
    return up->x + up->fn(2);
}
"#;
    let (_, n1, _, n2) = roundtrip_2x(LanguageId::Cpp, "ptr_cpp.cpp", src);
    for exp in [
        "p->x",
        "v.x",
        "p->next->x",
        "(*pp)->x",
        "p->fn(1)",
        "it->second",
        "up->x",
        "up->fn(2)",
    ] {
        assert!(n1.contains(exp), "C++ native missing `{exp}`:\n{n1}");
        assert!(n2.contains(exp), "C++ 2x native missing `{exp}`:\n{n2}");
    }
    assert!(!n1.contains("p.x"), "C++ corrupted p->x to p.x:\n{n1}");
    assert!(!n1.contains("it.second"), "C++ corrupted it->second to it.second:\n{n1}");
    assert!(!n1.contains("up.x"), "C++ corrupted up->x to up.x:\n{n1}");
}

#[test]
fn f157_csharp_ref_out_in_params_and_args_2x() {
    let src = r#"using System;

public struct Point {
    public int X { get; set; }
    public int Y { get; set; }
}

public interface IProbe {
    bool TryGet(string k, out int v);
}

public class RefDemo {
    public static void Bump(ref int x) {
        x += 1;
    }

    public static bool TryGet(string k, out int v) {
        if (k == "ok") {
            v = 42;
            return true;
        }
        v = 0;
        return false;
    }

    public static int Read(in Point p) {
        return p.X + p.Y;
    }

    public static string Run(string s) {
        int a = 1;
        Bump(ref a);
        int g = 0;
        bool ok1 = TryGet("ok", out g);
        bool ok2 = int.TryParse(s, out int v);
        bool ok3 = int.TryParse("99", out var v2);
        bool ok4 = int.TryParse("bad", out _);
        var pt = new Point { X = 10, Y = 20 };
        int r = Read(in pt);
        return $"{a}|{ok1}:{g}|{ok2}:{v}|{ok3}:{v2}|{ok4}|{r}";
    }
}
"#;
    let (_, n1, _, n2) = roundtrip_2x(LanguageId::CSharp, "RefDemo.cs", src);
    for exp in [
        "bool TryGet(string k, out int v);",
        "public static void Bump(ref int x)",
        "public static bool TryGet(string k, out int v)",
        "public static int Read(in Point p)",
        "Bump(ref a);",
        "TryGet(\"ok\", out g)",
        "int.TryParse(s, out int v)",
        "int.TryParse(\"99\", out var v2)",
        "int.TryParse(\"bad\", out _)",
        "Read(in pt)",
    ] {
        assert!(n1.contains(exp), "C# native missing `{exp}`:\n{n1}");
        assert!(n2.contains(exp), "C# 2x native missing `{exp}`:\n{n2}");
    }
}

#[test]
fn f158_kotlin_extension_functions_and_try_expression_2x() {
    let src = r#"fun String.shout(): String = this.uppercase()

fun <T> List<T>.second(): T = this[1]

fun String?.orEmpty2(): String = this ?: ""

class Wrapper {
    fun String.bracket(): String = "[$this]"

    fun run(s: String): String = s.bracket()
}

fun parseOrZero(s: String): Int {
    val n = try { s.toInt() } catch (e: Exception) { 0 }
    return n
}

fun parseExpr(s: String): Int = try {
    s.toInt()
} catch (e: NumberFormatException) {
    -1
}

fun parseReturn(s: String): Int {
    return try {
        s.toInt()
    } catch (e: IllegalArgumentException) {
        -2
    } catch (e: Exception) {
        -3
    }
}
"#;
    let (a1, n1, _, n2) = roundtrip_2x(LanguageId::Kotlin, "ExtTry.kt", src);
    for exp in ["@receiver(String)", "@receiver(List<T>)", "@receiver(String?)"] {
        assert!(a1.contains(exp), "Kotlin AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "fun String.shout(): String {",
        "fun <T> List<T>.second(): T {",
        "fun String?.orEmpty2(): String {",
        "fun String.bracket(): String {",
        "val n = try { s.toInt() } catch (e: Exception) { 0 }",
        "return try {",
        "catch (e: NumberFormatException)",
        "catch (e: IllegalArgumentException)",
    ] {
        assert!(n1.contains(exp), "Kotlin native missing `{exp}`:\n{n1}");
        assert!(n2.contains(exp), "Kotlin 2x native missing `{exp}`:\n{n2}");
    }
    assert!(!n1.contains("fun shout()"), "Kotlin dropped String. receiver:\n{n1}");
    assert!(!n1.contains("@receiver("), "Kotlin leaked internal @receiver:\n{n1}");
}
