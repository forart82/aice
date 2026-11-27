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

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f114_all_20_keyword_vars_direct_aice_and_polyglot() {
    let kws = [
        "val", "type", "style", "from", "mut", "module", "component", "match", "as", "async",
        "interface", "trait", "pub", "priv", "prot", "pkg", "fn", "ret", "pass", "nil",
    ];
    let mut aice_src = String::from("module test_kws\nfn f(val:int, type:str, mut:int, pub:int, nil:int) -> int:\n");
    for kw in kws {
        aice_src.push_str(&format!("  {kw} := 1\n  {kw}:int ::= 2\n  {kw} = {kw} + 1\n  {kw} += 2\n  {kw}.push(1)\n  {kw}[0] = 1\n  for {kw} in xs:\n    log({kw})\n"));
    }
    aice_src.push_str("  (val, type, nil) := pair\n  { type, style, val } := props\n  val x = 1\n  let mut y = 2\n");
    aice_src.push_str("  if match(s):\n    ret [1, 2]\n  match x:\n    1 => {\n      ret match\n    }\n    2 => match\n    _ => pass\n  loop:\n    break\n");
    parse_aice(&aice_src).unwrap_or_else(|e| panic!("direct AICE failed: {e}\n{aice_src}"));

    // Rust, TS, Go
    roundtrip(LanguageId::Rust, "kw.rs", "fn run(val: i32, nil: i32, xs: &[i32]) -> i32 { let mut style = val + nil; style += 1; let from = style; let pass = from; let ret = pass; for val in xs { let _ = val; } ret }\n");
    roundtrip(LanguageId::TypeScript, "kw.ts", "export function run(val: number, type: string, mut: number, pub: number, nil: number): number { const style = type; const from = val + mut + pub + nil; let match = from; match += 1; let ret = match; ret = ret + 1; let pass = ret; return pass; }\n");
    roundtrip(LanguageId::Go, "kw.go", "package p\nfunc run(xs []int) int { val := 3; style := 1; from := 2; mut := 4; match := 5; ret := val + style + from + mut + match; ret += 1; for val := range xs { _ = val }; return ret }\n");

    // Python + runtime verification
    let py_src = "val = 3\ntype = 'ok'\nnil = 5\ndef run(val, style, mut, nil):\n    match = val + style + mut + nil\n    match += 1\n    ret = match\n    ret = ret + 1\n    arr = [0]\n    arr[0] = ret\n    for val in arr:\n        nil = nil + val\n    return nil\nprint(run(val, 2, 4, nil), type)\n";
    let (_, py_nat) = roundtrip(LanguageId::Python, "kw.py", py_src);
    if has_tool("python3") {
        let out = Command::new("python3").args(["-c", &py_nat]).output().expect("python3");
        assert!(out.status.success(), "python3 failed: {}\n{py_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "21 ok");
    }

    // C with ALL 20 identifiers + gcc compile & run
    let c_src = r#"#include <stdio.h>
int main(void) {
    int val = 1, type = 2, style = 3, from = 4, mut = 5;
    int module = 6, component = 7, match = 8, as = 9, async = 10;
    int interface = 11, trait = 12, pub = 13, priv = 14, prot = 15;
    int pkg = 16, fn = 17, ret = 18, pass = 19, nil = 20;
    val = val + 1; nil = nil + 1; match += 1; ret += 1; pass += 1;
    int sum = val + type + style + from + mut + module + component + match + as + async
        + interface + trait + pub + priv + prot + pkg + fn + ret + pass + nil;
    printf("%d", sum);
    return 0;
}
"#;
    let (_, c_nat) = roundtrip(LanguageId::C, "kw.c", c_src);
    if has_tool("gcc") {
        let dir = std::env::temp_dir().join(format!("aice_w12_c_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_p = dir.join("kw.c");
        let bin_p = dir.join("kw");
        std::fs::write(&src_p, &c_nat).unwrap();
        let cc = Command::new("gcc").arg(&src_p).arg("-o").arg(&bin_p).output().unwrap();
        assert!(cc.status.success(), "gcc failed: {}\n{c_nat}", String::from_utf8_lossy(&cc.stderr));
        let run = Command::new(&bin_p).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success());
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "215");
    }

    // Java + C#
    let java_src = "public class KwJ { public static void main(String[] args) { int val = 3; int type = 4; int style = 5; int from = 6; int mut = 7; int match = 8; int fn = 9; int ret = 10; int pass = 11; int nil = 12; val = val + 1; nil = nil + 1; System.out.println(val + type + style + from + mut + match + fn + ret + pass + nil); } }\n";
    let (_, java_nat) = roundtrip(LanguageId::Java, "KwJ.java", java_src);
    if has_tool("javac") && has_tool("java") {
        let dir = std::env::temp_dir().join(format!("aice_w12_javakw_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jp = dir.join("KwJ.java");
        std::fs::write(&jp, &java_nat).unwrap();
        let jc = Command::new("javac").arg(&jp).output().unwrap();
        assert!(jc.status.success(), "javac failed: {}\n{java_nat}", String::from_utf8_lossy(&jc.stderr));
        let jr = Command::new("java").args(["-cp"]).arg(&dir).arg("KwJ").output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert_eq!(String::from_utf8_lossy(&jr.stdout).trim(), "77");
    }
    let cs_src = "using System;\npublic class KwCs { public static void Main() { double val = 3.5; val = val + 1.5; string type = \"ok\"; string style = \"s\"; int from = 1; int mut = 2; int match = 3; int fn = 4; int ret = 5; int pass = 6; int nil = 7; nil = nil + 1; Console.WriteLine($\"{val}:{type}:{style}:{from + mut + match + fn + ret + pass + nil}\"); } }\n";
    let (_, cs_nat) = roundtrip(LanguageId::CSharp, "KwCs.cs", cs_src);
    assert!(cs_nat.contains("double val = 3.5;") && cs_nat.contains("nil = nil + 1;"), "C# kw:\n{cs_nat}");
}

#[test]
fn f115_kotlin_subclass_ctor_override_open_interface_and_kotlinc() {
    let kt_src = r#"interface Named {
    fun tag(): String
}

abstract class BaseK {
    abstract fun greet(s: String): String
}

class ChildK : BaseK() {
    override fun greet(s: String): String = "kt:$s"
}

open class OpenBase(val x: Int) {
    open val label: String = "base"
    open fun f(): Int = x
}

class Sub(p: String) : OpenBase(7), Named {
    override val label: String = p
    override fun f(): Int = x + 1
    override fun tag(): String = "$label:${f()}"
}

open class GenBase<T>(val v: T)

class ChildGen : GenBase<String>("hi")

fun main() {
    val c: BaseK = ChildK()
    val s: OpenBase = Sub("sub")
    val n: Named = s as Named
    val g: GenBase<String> = ChildGen()
    println("${c.greet("v13")}|${s.f()}|${s.label}|${n.tag()}|${g.v}")
}
"#;
    let (_aice, native) = roundtrip(LanguageId::Kotlin, "Abs.kt", kt_src);
    for exp in [
        "interface Named {",
        "fun tag(): String",
        "abstract class BaseK {",
        "abstract fun greet(s: String): String",
        "class ChildK : BaseK() {",
        "override fun greet(s: String): String {",
        "open class OpenBase(val x: Int) {",
        "open val label: String = \"base\"",
        "open fun f(): Int {",
        "class Sub(p: String) : OpenBase(7), Named {",
        "override val label: String = p",
        "override fun f(): Int {",
        "override fun tag(): String {",
        "open class GenBase<T>(val v: T)",
        "class ChildGen : GenBase<String>(\"hi\")",
    ] {
        assert!(native.contains(exp), "Kotlin native missing `{exp}`:\n{native}");
    }
    assert!(!native.contains("    fun tag(): String {"), "interface method got empty body:\n{native}");
    assert!(!native.contains("class Sub(val p: String)"), "non-property ctor param forced to val:\n{native}");

    if has_tool("kotlinc") && has_tool("java") {
        let dir = std::env::temp_dir().join(format!("aice_w12_kt_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_p = dir.join("Abs.kt");
        let jar_p = dir.join("abs.jar");
        std::fs::write(&src_p, &native).unwrap();
        let kc = Command::new("kotlinc").arg(&src_p).args(["-include-runtime", "-d"]).arg(&jar_p).output().unwrap();
        assert!(kc.status.success(), "kotlinc failed:\n{}\n--- KT ---\n{native}", String::from_utf8_lossy(&kc.stderr));
        let jr = Command::new("java").args(["-jar"]).arg(&jar_p).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(jr.status.success(), "java -jar failed: {}", String::from_utf8_lossy(&jr.stderr));
        assert_eq!(String::from_utf8_lossy(&jr.stdout).trim(), "kt:v13|8|sub|sub:8|hi");
    }
}

#[test]
fn f116_java_enum_constant_bodies_and_implements_javac() {
    let java_src = r#"interface FancyBase {
    String prefix();
    String tag();
}

interface Marker {}

enum Flag implements Marker {
    ON,
    OFF
}

enum Mode implements FancyBase {
    FAST {
        @Override
        public String prefix() { return "F"; }
        @Override
        public String tag() { return "v13"; }
    },
    SLOW {
        @Override
        public String prefix() { return "S"; }
        @Override
        public String tag() { return "v13"; }
    };
}

enum Op {
    ADD("add") {
        @Override
        public int apply(int a, int b) { return a + b; }
    };
    final String label;
    Op(String l) { this.label = l; }
    public abstract int apply(int a, int b);
}

public class EnumDemo {
    public static void main(String[] args) {
        FancyBase f = Mode.FAST;
        FancyBase s = Mode.SLOW;
        Marker m = Flag.ON;
        System.out.println(f.prefix() + ":" + f.tag() + "|" + s.prefix() + "|" + Op.ADD.label + ":" + Op.ADD.apply(3, 4) + "|" + m);
    }
}
"#;
    let (_aice, native) = roundtrip(LanguageId::Java, "EnumDemo.java", java_src);
    for exp in [
        "enum Flag implements Marker {",
        "enum Mode implements FancyBase {",
        "FAST {",
        "SLOW {",
        "ADD(\"add\") {",
        "public abstract int apply(int a, int b);",
    ] {
        assert!(native.contains(exp), "Java enum missing `{exp}`:\n{native}");
    }
    if has_tool("javac") && has_tool("java") {
        let dir = std::env::temp_dir().join(format!("aice_w12_enum_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let jp = dir.join("EnumDemo.java");
        std::fs::write(&jp, &native).unwrap();
        let jc = Command::new("javac").arg(&jp).output().unwrap();
        assert!(jc.status.success(), "javac failed:\n{}\n--- JAVA ---\n{native}", String::from_utf8_lossy(&jc.stderr));
        let jr = Command::new("java").args(["-cp"]).arg(&dir).arg("EnumDemo").output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(jr.status.success(), "java failed: {}", String::from_utf8_lossy(&jr.stderr));
        assert_eq!(String::from_utf8_lossy(&jr.stdout).trim(), "F:v13|S|add:7|ON");
    }
}

#[test]
fn f117_ruby_top_level_statements_preserved() {
    let rb_src = "def greet(x)\n  \"hi #{x}\"\nend\nx = 7\nputs greet(\"v13\")\nif x > 0\n  puts x\nend\n";
    let (aice, native) = roundtrip(LanguageId::Ruby, "script.rb", rb_src);
    assert!(aice.contains("puts greet(\"v13\")"), "Ruby AICE dropped top-level call:\n{aice}");
    assert!(native.contains("puts greet(\"v13\")"), "Ruby native dropped top-level call:\n{native}");
    assert!(native.contains("x = 7"), "Ruby native dropped top-level assign:\n{native}");
    assert!(native.contains("if x > 0") && native.contains("puts x"), "Ruby native dropped top-level if:\n{native}");
    if has_tool("ruby") {
        let out = Command::new("ruby").args(["-e", &native]).output().unwrap();
        assert!(out.status.success(), "ruby failed: {}\n{native}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hi v13\n7");
    }
}
