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
    assert_eq!(n1, n2, "2x roundtrip drifted for {vname}:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
    (a1, n1, a2, n2)
}

#[test]
fn f142_python_decorated_methods_and_varargs_kwargs_2x() {
    let src = r#"def tag(fn):
    return fn

class Box:
    def __init__(self, v: int) -> None:
        self._v = v

    @staticmethod
    def mk(x: int) -> int:
        return x + 1

    @classmethod
    def label(cls) -> str:
        return cls.__name__

    @property
    def val(self) -> int:
        return self._v

    @val.setter
    def val(self, x: int) -> None:
        self._v = x

    @tag
    def extra(self, *args: int, **kwargs: int) -> int:
        return self._v + sum(args) + sum(kwargs.values())

def combine(base: int, *args, **kwargs):
    return base + sum(args) + sum(kwargs.values())

def only_kw(**meta: int) -> int:
    return sum(meta.values())

def only_args(*vals: int) -> int:
    return sum(vals)
"#;
    let (a1, n1, _, _) = roundtrip_2x(LanguageId::Python, "box.py", src);
    for exp in ["@staticmethod", "@classmethod", "@property", "@val.setter", "@tag"] {
        assert!(a1.contains(exp), "AICE missing `{exp}`:\n{a1}");
        assert!(n1.contains(exp), "native missing `{exp}`:\n{n1}");
    }
    for exp in [
        "def mk(x: int) -> int:",
        "def label(cls) -> str:",
        "def val(self) -> int:",
        "def extra(self, *args: int, **kwargs: int) -> int:",
        "def combine(base: int, *args, **kwargs):",
        "def only_kw(**meta: int) -> int:",
        "def only_args(*vals: int) -> int:",
    ] {
        assert!(n1.contains(exp), "native missing `{exp}`:\n{n1}");
    }
    assert!(!n1.contains("@kwargs("), "native leaked internal @kwargs:\n{n1}");
}

#[test]
fn f143_kotlin_enum_class_simple_rich_and_entry_body_2x() {
    let simple = r#"enum class Color {
    RED,
    GREEN,
    BLUE
}
"#;
    let (a1, n1, _, _) = roundtrip_2x(LanguageId::Kotlin, "Color.kt", simple);
    for exp in ["pub enum Color:", "RED", "GREEN", "BLUE"] {
        assert!(a1.contains(exp), "simple enum AICE missing `{exp}`:\n{a1}");
    }
    for exp in ["enum class Color {", "RED,", "GREEN,", "BLUE"] {
        assert!(n1.contains(exp), "simple enum native missing `{exp}`:\n{n1}");
    }

    let rich = r#"enum class Tier(val rank: Int, val code: String) {
    BRONZE(1, "b"),
    GOLD(3, "g");

    val doubled: Int = rank * 2

    fun label(): String = "$name:$rank"

    companion object {
        fun top(): Tier = GOLD
    }
}

enum class Op {
    ADD {
        override fun apply(a: Int, b: Int): Int = a + b
    },
    SUB {
        override fun apply(a: Int, b: Int): Int = a - b
    };

    abstract fun apply(a: Int, b: Int): Int
}
"#;
    let (_, n2, _, _) = roundtrip_2x(LanguageId::Kotlin, "Tier.kt", rich);
    for exp in [
        "enum class Tier(val rank: Int, val code: String) {",
        "BRONZE(1, \"b\"),",
        "GOLD(3, \"g\");",
        "val doubled: Int = rank * 2",
        "fun label(): String",
        "companion object {",
        "fun top(): Tier",
        "enum class Op {",
        "ADD {",
        "SUB {",
        "abstract fun apply(a: Int, b: Int): Int",
    ] {
        assert!(n2.contains(exp), "rich enum native missing `{exp}`:\n{n2}");
    }
}

#[test]
fn f144a_php_class_constants_and_property_initializers_2x() {
    let src = r#"<?php
declare(strict_types=1);

namespace Demo\Config;

interface HasLimits {
    public const MAX_ITEMS = 100;
    public function limit(): int;
}

class Cfg implements HasLimits {
    public const BASE = 10;
    protected const SCALE = 2;
    private const string TAG = "v17";
    public static int $count = 5;
    private string $label = "init";

    public function limit(): int {
        return Cfg::BASE;
    }
}
"#;
    let (a1, n1, _, _) = roundtrip_2x(LanguageId::Php, "Cfg.php", src);
    for exp in ["@const", "BASE = 10", "SCALE = 2", "count:int = 5", "label:str = \"init\""] {
        assert!(a1.contains(exp), "PHP AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "public const MAX_ITEMS = 100;",
        "public const BASE = 10;",
        "protected const SCALE = 2;",
        "private const string TAG = \"v17\";",
        "public static int $count = 5;",
        "private string $label = \"init\";",
    ] {
        assert!(n1.contains(exp), "PHP native missing `{exp}`:\n{n1}");
    }
    assert!(!n1.contains("@const"), "PHP native leaked internal @const:\n{n1}");
}

#[test]
fn f139_go_single_stmt_multi_return_2x() {
    let src = r#"package demo

func Pair() (int, int) { return 1, 2 }

func Split(x int) (int, error) { return x + 1, nil }

func Swap(a, b string) (string, string) { return b, a }

type Box struct {
	V int
}

func (b *Box) Unpack() (int, bool) { return b.V, true }
"#;
    let (_, n1, _, _) = roundtrip_2x(LanguageId::Go, "multi.go", src);
    for exp in [
        "return 1, 2",
        "return x + 1, nil",
        "return b, a",
        "return b.V, true",
    ] {
        assert!(n1.contains(exp), "Go multi-return missing `{exp}`:\n{n1}");
    }
}

#[test]
fn f145_csharp_enum_discriminants_and_const_fields_2x() {
    let src = r#"public enum Kind : byte {
    Alpha = 1,
    Beta = 2,
    Gamma = 10,
}

public class Config {
    public const int X = 7;
    private const string Tag = "v17";
    public static int Counter { get; set; } = 5;
    public static int Limit => 42;

    public static int Read() {
        return X + (int)Kind.Beta + Counter + Limit;
    }
}
"#;
    let (a1, n1, _, _) = roundtrip_2x(LanguageId::CSharp, "Config.cs", src);
    for exp in ["Alpha = 1", "Beta = 2", "Gamma = 10", "@const"] {
        assert!(a1.contains(exp), "C# AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "public enum Kind : byte {",
        "Alpha = 1,",
        "Beta = 2,",
        "Gamma = 10,",
        "public const int X = 7;",
        "private const string Tag = \"v17\";",
        "public static int Counter { get; set; } = 5;",
        "public static int Limit => 42;",
    ] {
        assert!(n1.contains(exp), "C# native missing `{exp}`:\n{n1}");
    }
    assert!(!n1.contains("int X => 7"), "C# const turned into property:\n{n1}");
}

#[test]
fn f146_c_enum_tag_cpp_enum_class_and_switch_break_idempotence_2x() {
    let c_src = r#"enum Mode {
    MODE_A = 1,
    MODE_B = 2
};

int eval_mode(enum Mode m) {
    int out = 0;
    switch (m) {
        case MODE_A:
            return 10;
        case MODE_B:
            out = 20;
            break;
        default:
            return 0;
    }
    return out;
}
"#;
    let (_, cn1, _, cn2) = roundtrip_2x(LanguageId::C, "mode.c", c_src);
    assert!(cn1.contains("typedef enum Mode {"), "C enum missing tag `Mode`:\n{cn1}");
    assert!(cn1.contains("} Mode;"), "C enum missing typedef name:\n{cn1}");
    assert_eq!(cn1.matches("break;").count(), 1, "C switch duplicated break;:\n{cn1}");
    assert_eq!(cn2.matches("break;").count(), 1, "C switch 2x RT duplicated break;:\n{cn2}");

    let cpp_src = r#"enum class Kind : int {
    A = 1,
    B = 2
};

int pick(int x) {
    int r = 0;
    switch (x) {
        case 1:
            r = (int)Kind::A;
            break;
        default:
            return (int)Kind::B;
    }
    return r;
}
"#;
    let (_, cpp1, _, cpp2) = roundtrip_2x(LanguageId::Cpp, "kind.cpp", cpp_src);
    assert!(cpp1.contains("enum class Kind : int {"), "C++ enum class header lost:\n{cpp1}");
    assert!(cpp1.contains("};"), "C++ enum class trailing ';' lost:\n{cpp1}");
    assert_eq!(cpp1.matches("break;").count(), 1, "C++ switch duplicated break;:\n{cpp1}");
    assert_eq!(cpp2.matches("break;").count(), 1, "C++ switch 2x RT duplicated break;:\n{cpp2}");

    let js_src = r#"function pick(x) {
    let r = 0;
    switch (x) {
        case 1:
            r = 10;
            break;
        default:
            return 0;
    }
    return r;
}
"#;
    let (_, js1, _, js2) = roundtrip_2x(LanguageId::JavaScript, "sw.js", js_src);
    assert_eq!(js1.matches("break;").count(), 1, "JS switch duplicated break;:\n{js1}");
    assert_eq!(js2.matches("break;").count(), 1, "JS switch 2x RT duplicated break;:\n{js2}");

    let java_src = r#"public class SwJava {
    public static int pick(int x) {
        int r = 0;
        switch (x) {
            case 1:
                r = 10;
                break;
            case 2:
                return 20;
            default:
                r = 30;
                break;
        }
        return r;
    }
}
"#;
    let (_, j1, _, j2) = roundtrip_2x(LanguageId::Java, "SwJava.java", java_src);
    assert_eq!(j1.matches("break;").count(), 2, "Java switch break; count wrong:\n{j1}");
    assert_eq!(j2.matches("break;").count(), 2, "Java switch 2x RT break; count wrong:\n{j2}");

    let cs_src = r#"public enum Kind { Alpha = 1, Beta = 2 }
public class SwCs {
    public static int Pick(Kind k) {
        int r = 0;
        switch (k) {
            case Kind.Alpha:
                r = 10;
                break;
            case Kind.Beta:
                return 20;
            default:
                r = 30;
                break;
        }
        return r;
    }
}
"#;
    let (_, cs1, _, cs2) = roundtrip_2x(LanguageId::CSharp, "SwCs.cs", cs_src);
    assert_eq!(cs1.matches("break;").count(), 2, "C# switch break; count wrong:\n{cs1}");
    assert_eq!(cs2.matches("break;").count(), 2, "C# switch 2x RT break; count wrong:\n{cs2}");
    assert!(cs1.contains("case Kind.Alpha:"), "C# qualified case pattern lost:\n{cs1}");
}

#[test]
fn f147_go_grouped_const_iota_and_type_switch_2x() {
    let src = r#"package main

const (
	A = iota + 1
	B
	C
)

const Single = 42

func inspect(v any) int {
	switch x := v.(type) {
	case int:
		return x + B
	case int32, int64:
		return C
	default:
		return A
	}
}

func tagOnly(v any) int {
	switch v.(type) {
	case string:
		return 1
	default:
		return 0
	}
}
"#;
    let (_, n1, _, _) = roundtrip_2x(LanguageId::Go, "iota_tsw.go", src);
    for exp in [
        "const (",
        "A = iota + 1",
        "\tB",
        "\tC",
        "const Single = 42",
        "switch x := v.(type) {",
        "case int:",
        "case int32, int64:",
        "switch v.(type) {",
        "case string:",
    ] {
        assert!(n1.contains(exp), "Go output missing `{exp}`:\n{n1}");
    }
    assert!(!n1.contains("const B = nil"), "Go implicit iota corrupted to nil:\n{n1}");
}

#[test]
fn f152_cpp_namespace_preserves_global_sibling_main_2x() {
    let src = r#"#include <vector>

namespace ns {
int sum2(int a, int b) {
    return a + b;
}
}

int main() {
    return ns::sum2(1, 2) - 3;
}
"#;
    let (_, n1, _, _) = roundtrip_2x(LanguageId::Cpp, "ns_main.cpp", src);
    let ns_open = n1.find("namespace ns {").expect("missing namespace ns {");
    let sum_pos = n1.find("int sum2(").expect("missing sum2");
    let ns_close = n1[sum_pos..].find("\n}\n\nint main()").map(|i| sum_pos + i);
    assert!(ns_open < sum_pos, "sum2 must be inside namespace ns:\n{n1}");
    assert!(ns_close.is_some(), "main() was swallowed inside namespace ns:\n{n1}");
}
