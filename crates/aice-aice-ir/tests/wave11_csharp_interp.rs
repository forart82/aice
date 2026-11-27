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

fn run_dotnet(tag: &str, cs_code: &str, expected_stdout: &str) {
    if !has_tool("dotnet") {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aice_w11_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir cs");
    std::fs::write(
        dir.join("Demo.csproj"),
        "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n",
    )
    .expect("write csproj");
    std::fs::write(dir.join("Program.cs"), cs_code).expect("write Program.cs");
    let run = Command::new("dotnet")
        .args(["run", "--nologo", "--project"])
        .arg(dir.join("Demo.csproj"))
        .output()
        .expect("run dotnet");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        run.status.success(),
        "dotnet run ({tag}) failed:\nstdout: {}\nstderr: {}\n--- CS ---\n{cs_code}",
        String::from_utf8_lossy(&run.stdout),
        String::from_utf8_lossy(&run.stderr),
    );
    assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), expected_stdout);
}

#[test]
fn f112_csharp_interpolated_strings_roundtrip_and_dotnet_run() {
    let cs_src = r#"using System;
using System.Collections.Generic;
using System.Globalization;
using System.IO;

public class InterpDemo {
    public static string MissingFile(string file) => $"Required file missing: {file}";
    public static string Pair(int id, string name) => $"{id}:{name}";
    public static string Joined(string[] xs) => $"{string.Join(",", xs)}";
    public static string Lookup(Dictionary<string, int> d) => $"v={d["a"]}";
    public static string Ternary(bool ok) => $"{(ok ? "pos" : "neg")}";
    public static string Fixed(double v) => $"{v:F2}";
    public static string Aligned(double v) => $"{v,6:N1}";
    public static string Verbatim1(string name) => $@"C:\path\{name}";
    public static string Verbatim2(string name) => @$"C:\dir\{name}";
    public static string Braces(int x) => $"{{escaped}} {x}";
    public static string Quoted(string s) => $"quoted \"{s}\"";
    public static string Plain() => $"plain no interp";
    public static string RawInterp(string x) => $"""raw "{x}" ok""";

    public static void Main() {
        CultureInfo.CurrentCulture = CultureInfo.InvariantCulture;
        var dict = new Dictionary<string, int> { ["a"] = 42 };
        var xs = new string[] { "x", "y" };
        if (false) {
            throw new FileNotFoundException($"Required file missing: {xs[0]}");
        }
        var parts = new string[] {
            MissingFile("rooms.yaml"),
            Pair(7, "Ada"),
            Joined(xs),
            Lookup(dict),
            Ternary(true),
            Fixed(3.5),
            Aligned(12.34),
            Verbatim1("sub"),
            Verbatim2("sub"),
            Braces(9),
            Quoted("hi"),
            Plain(),
            RawInterp("z")
        };
        Console.WriteLine(string.Join("|", parts));
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::CSharp, "Program.cs", cs_src);

    for exp in [
        "`Required file missing: ${file}`",
        "`${id}:${name}`",
        "`${string.Join(\",\", xs)}`",
        "`v=${d[\"a\"]}`",
        "`{escaped} ${x}`",
        "`quoted \"${s}\"`",
    ] {
        assert!(aice.contains(exp), "C# AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "$\"Required file missing: {file}\"",
        "$\"{id}:{name}\"",
        "$\"{string.Join(\",\", xs)}\"",
        "$\"v={d[\"a\"]}\"",
        "$\"{(ok ? \"pos\" : \"neg\")}\"",
        "$\"{v:F2}\"",
        "$\"{v,6:N1}\"",
        "$@\"C:\\path\\{name}\"",
        "@$\"C:\\dir\\{name}\"",
        "$\"{{escaped}} {x}\"",
        "$\"quoted \\\"{s}\\\"\"",
        "$\"\"\"raw \"{x}\" ok\"\"\"",
    ] {
        assert!(native.contains(exp), "C# native missing `{exp}`:\n{native}");
    }

    run_dotnet(
        "f112_interp",
        &native,
        "Required file missing: rooms.yaml|7:Ada|x,y|v=42|pos|3.50|  12.3|C:\\path\\sub|C:\\dir\\sub|{escaped} 9|quoted \"hi\"|plain no interp|raw \"z\" ok",
    );
}

#[test]
fn f112_cross_language_template_string_audit() {
    let py_src = r#"def demo(x, d, name):
    a = f"hello {name}"
    b = f"{x:.2f}"
    c = f"{d['a']}"
    e = f"{{escaped}} {x}"
    g = rf"C:\path\{name}"
    h = f"quoted \"{name}\""
    return "|".join([a, b, c, e, g, h])
"#;
    let (py_aice, py_nat) = roundtrip(LanguageId::Python, "tpl.py", py_src);
    assert!(py_aice.contains("`hello ${name}`"), "Py AICE:\n{py_aice}");
    assert!(py_nat.contains("f\"{{escaped}} {x}\""), "Py native:\n{py_nat}");
    assert!(py_nat.contains("f\"{x:.2f}\""), "Py native:\n{py_nat}");
    if has_tool("python3") {
        let code = format!("{py_nat}\nprint(demo(3.5, {{'a': 'ok'}}, 'Ada'))\n");
        let out = Command::new("python3").args(["-c", &code]).output().expect("python3");
        assert!(out.status.success(), "python3 failed: {}\n{py_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "hello Ada|3.50|ok|{escaped} 3.5|C:\\path\\Ada|quoted \"Ada\""
        );
    }

    let kt_src = r#"class Box(val b: Int)
fun demo(x: Int, a: Box, xs: List<String>): String {
    val s1 = "$x/${a.b}"
    val s2 = "${xs.joinToString(",")}"
    val s3 = "quoted \"$x\""
    val s4 = "\$literal $x"
    return "$s1|$s2|$s3|$s4"
}
"#;
    let (_kt_aice, kt_nat) = roundtrip(LanguageId::Kotlin, "Tpl.kt", kt_src);
    assert!(kt_nat.contains("\"quoted \\\"${x}\\\"\""), "Kt quote escape:\n{kt_nat}");
    assert!(kt_nat.contains("\"\\$literal ${x}\""), "Kt dollar escape:\n{kt_nat}");
    if has_tool("kotlinc") {
        let dir = std::env::temp_dir().join(format!("aice_w11_kt_tpl_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let kp = dir.join("Tpl.kt");
        let jar = dir.join("tpl.jar");
        std::fs::write(&kp, &kt_nat).unwrap();
        let comp = Command::new("kotlinc").arg(&kp).arg("-d").arg(&jar).output().unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(comp.status.success(), "kotlinc failed:\n{}\n{kt_nat}", String::from_utf8_lossy(&comp.stderr));
    }

    let dart_src = r#"class Box { final int b; Box(this.b); }
String demo(int x, Box a, List<String> xs) {
  final s1 = "$x/${a.b}";
  final s2 = "${xs.join(',')}";
  final s3 = 'single $x ${a.b}';
  final s4 = r"$raw";
  return "$s1|$s2|$s3|$s4";
}
"#;
    let (_dt_aice, dt_nat) = roundtrip(LanguageId::Dart, "tpl.dart", dart_src);
    assert!(dt_nat.contains("r\"$raw\""), "Dart raw string lost:\n{dt_nat}");
    assert!(dt_nat.contains("\"${x}/${a.b}\""), "Dart interp lost:\n{dt_nat}");

    let rb_src = r##"class Greeter
  def initialize(name)
    @name = name
  end
  def greet(xs)
    a = "hello #{@name}"
    b = "#{xs.join(',')}"
    c = "quoted \"#{@name}\""
    d = 'literal #{no}'
    "#{a}|#{b}|#{c}|#{d}"
  end
end
"##;
    let (_rb_aice, rb_nat) = roundtrip(LanguageId::Ruby, "tpl.rb", rb_src);
    assert!(rb_nat.contains("'literal #{no}'"), "Ruby single-quote literal lost:\n{rb_nat}");
    if has_tool("ruby") {
        let code = format!("{rb_nat}\nputs Greeter.new('Ada').greet(['a', 'b'])\n");
        let out = Command::new("ruby").args(["-e", &code]).output().unwrap();
        assert!(out.status.success(), "ruby failed:\n{}\n{rb_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "hello Ada|a,b|quoted \"Ada\"|literal #{no}"
        );
    }

    let php_src = r#"<?php
function demo(string $x, array $arr): string {
    $a = "hello {$x}";
    $b = "plain $x";
    $c = "key {$arr['k']}";
    return "$a|$b|$c";
}
"#;
    let (_php_aice, php_nat) = roundtrip(LanguageId::Php, "tpl.php", php_src);
    if has_tool("php") {
        let dir = std::env::temp_dir().join(format!("aice_w11_php_tpl_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let pp = dir.join("tpl.php");
        std::fs::write(&pp, &php_nat).unwrap();
        let out = Command::new("php")
            .args(["-r", &format!("require '{}'; echo demo('Ada', ['k' => 'v']);", pp.display())])
            .output()
            .unwrap();
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "php failed:\n{}\n{php_nat}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "hello Ada|plain Ada|key v");
    }

    let js_src = "export function demo(x, xs) {\n  const a = `hello ${x}`;\n  const b = `${xs.join(\",\")}`;\n  const c = `q\\`${x}\\``;\n  return `${a}|${b}|${c}`;\n}\n";
    let (_js_aice, js_nat) = roundtrip(LanguageId::JavaScript, "tpl.mjs", js_src);
    assert!(js_nat.contains("`hello ${x}`") && js_nat.contains("`q\\`${x}\\``"), "JS native:\n{js_nat}");
}

#[test]
fn f113_java_abstract_static_nested_extends_implements_and_javac_run() {
    let java_src = r#"import java.util.List;

interface BaseTag {
    String tag();
}

interface SubTag extends BaseTag {
    int code();
}

class Holder<T> {
    protected final T value;
    public Holder(T value) { this.value = value; }
    public T get() { return value; }
}

class NestedListHolder extends Holder<List<String>> {
    public NestedListHolder(List<String> v) { super(v); }
}

public abstract class AbstractBug {
    public abstract String greet(String name);

    public static class Nested {
        public static int id() { return 1; }
    }

    public static abstract class InnerBase {
        public abstract int bonus();
    }

    public record Tagged(String label) implements BaseTag {
        public String tag() { return label; }
    }

    public static Nested makeNested() {
        return new Nested();
    }

    public static void main(String[] args) {
        Child c = new Child();
        c.run();
        Nested n = makeNested();
        InnerBase ib = new InnerBase() {
            public int bonus() { return 5; }
        };
        NestedListHolder h = new NestedListHolder(List.of("ok"));
        Tagged t = new Tagged("rec");
        System.out.println(c.greet("Ada") + "|" + c.tag() + ":" + c.code() + "|" + n.id() + "|" + ib.bonus() + "|" + h.get().get(0) + "|" + t.tag());
    }
}

class Child extends AbstractBug implements Runnable, SubTag {
    private String state = "init";
    public String greet(String name) { return state + ":" + name; }
    public void run() { state = "ran"; }
    public String tag() { return "child"; }
    public int code() { return 7; }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Java, "AbstractBug.java", java_src);

    for exp in [
        "pkg interface SubTag extends BaseTag:",
        "pub abstract class AbstractBug:",
        "@abstract",
        "@nested(AbstractBug)",
        "@static",
        "pkg class Child extends AbstractBug implements Runnable, SubTag:",
        "pkg class NestedListHolder extends Holder<List<String>>:",
    ] {
        assert!(aice.contains(exp), "Java AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "interface SubTag extends BaseTag {",
        "public abstract class AbstractBug {",
        "public abstract String greet(String name);",
        "public static class Nested {",
        "public static abstract class InnerBase {",
        "public abstract int bonus();",
        "public record Tagged(String label) implements BaseTag {",
        "class Child extends AbstractBug implements Runnable, SubTag {",
        "class NestedListHolder extends Holder<List<String>> {",
    ] {
        assert!(native.contains(exp), "Java native missing `{exp}`:\n{native}");
    }

    if has_tool("javac") {
        let dir = std::env::temp_dir().join(format!("aice_w11_java_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir java");
        let sp = dir.join("AbstractBug.java");
        std::fs::write(&sp, &native).expect("write AbstractBug.java");
        let comp = Command::new("javac").arg(&sp).output().expect("javac");
        assert!(
            comp.status.success(),
            "javac failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
            String::from_utf8_lossy(&comp.stdout),
            String::from_utf8_lossy(&comp.stderr),
        );
        if has_tool("java") {
            let run = Command::new("java").args(["-cp"]).arg(&dir).arg("AbstractBug").output().expect("java");
            assert!(
                run.status.success(),
                "java run failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
                String::from_utf8_lossy(&run.stdout),
                String::from_utf8_lossy(&run.stderr),
            );
            assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "ran:Ada|child:7|1|5|ok|rec");
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn f113_sister_csharp_dart_kotlin_abstract_and_heritage() {
    let cs_src = r#"using System;

public interface IBase {
    string Tag();
}

public interface ISub : IBase {
    int Code();
}

public abstract class BaseGreeter {
    public abstract string Greet(string name);
}

public static class Util {
    public static string Wrap(string s) => $"[{s}]";
}

public class ChildGreeter : BaseGreeter, ISub {
    public override string Greet(string name) => Util.Wrap($"Hi {name}");
    public string Tag() => "cs";
    public int Code() => 9;
    public static void Main() {
        var c = new ChildGreeter();
        BaseGreeter g = c;
        ISub s = c;
        Console.WriteLine($"{g.Greet("Ada")}|{s.Tag()}:{s.Code()}");
    }
}
"#;
    let (_cs_aice, cs_nat) = roundtrip(LanguageId::CSharp, "Program.cs", cs_src);
    for exp in [
        "public interface ISub : IBase {",
        "public abstract class BaseGreeter {",
        "public abstract string Greet(string name);",
        "public static class Util {",
        "public class ChildGreeter : BaseGreeter, ISub {",
        "public override string Greet(string name)",
    ] {
        assert!(cs_nat.contains(exp), "C# native missing `{exp}`:\n{cs_nat}");
    }
    run_dotnet("f113_cs_abs", &cs_nat, "[Hi Ada]|cs:9");

    let dart_src = r#"abstract class Shape {
  double area();
}
class Square extends Shape {
  final double side;
  Square(this.side);
  double area() => side * side;
}
"#;
    let (_dt_aice, dt_nat) = roundtrip(LanguageId::Dart, "shape.dart", dart_src);
    assert!(dt_nat.contains("abstract class Shape {") && dt_nat.contains("double area();"), "Dart abstract:\n{dt_nat}");
    assert!(dt_nat.contains("class Square extends Shape {"), "Dart extends:\n{dt_nat}");

    let kt_src = r#"abstract class Animal {
    abstract fun speak(): String
}
class Dog : Animal() {
    fun speak(): String = "woof"
}
"#;
    let (_kt_aice, kt_nat) = roundtrip(LanguageId::Kotlin, "Animal.kt", kt_src);
    assert!(kt_nat.contains("abstract class Animal {") && kt_nat.contains("abstract fun speak(): String"), "Kotlin abstract:\n{kt_nat}");
}
