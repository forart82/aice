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
fn f111_csharp_object_collection_dict_target_typed_and_with_roundtrip() {
    let cs_src = r#"using System;
using System.Collections.Generic;

public record Point(int X, int Y);

public class Meta {
    public int Count { get; set; }
}

public class User {
    public int Id { get; set; }
    public string Name { get; set; } = "";
    public List<string> Tags { get; set; } = new();
    public Meta Info { get; set; } = new();
    public User() {}
    public User(int id) { Id = id; }
    public string Describe() => Id + ":" + Name + ":" + Tags.Count + ":" + Info.Count;
}

public class Program {
    public static User MakeTargetTyped() => new() { Id = 9, Name = "Neo" };

    public static void Main() {
        var u1 = new User { Id = 7, Name = "Ada", Tags = new List<string> { "ok", "v10" }, Info = new() { Count = 3 } };
        var u2 = new User() { Id = 8, Name = "Bob" };
        var u3 = new User(11) { Name = "Carl", Info = { Count = 4 } };
        User u4 = MakeTargetTyped();
        User u5 = new(12) { Name = "Eve" };
        var xs = new List<string> { "ok", "v10" };
        var dict = new Dictionary<string, int> { { "a", 1 }, { "b", 2 } };
        var idxDict = new Dictionary<string, int> { ["x"] = 10, ["y"] = 20 };
        var deep = new Dictionary<string, Dictionary<string, List<int>>> { ["k"] = new() { ["m"] = new() { 5, 6 } } };
        var emptyU = new User {};
        var anon = new { Id = 77, Tag = "anon" };
        var chained = new User { Id = 42, Name = "Zed" }.Describe();
        var p1 = new Point(1, 2);
        var p2 = p1 with { X = 10, Y = 20 };
        var px = (p1 with { X = 99 }).X;
        var arr = new[] { 10, 20 };
        var summary = string.Join("|", new string[] {
            u1.Describe(), u2.Id + ":" + u2.Name, u3.Describe(), u4.Id + ":" + u4.Name,
            u5.Id + ":" + u5.Name, string.Join(",", xs), (dict["a"] + dict["b"]).ToString(),
            (idxDict["x"] + idxDict["y"]).ToString(), deep["k"]["m"][1].ToString(),
            emptyU.Id.ToString(), anon.Id + ":" + anon.Tag, chained,
            p2.X + "," + p2.Y, px.ToString(), (arr[0] + arr[1]).ToString()
        });
        Console.WriteLine(summary);
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::CSharp, "Program.cs", cs_src);

    for exp in [
        "new User { Id = 7, Name = \"Ada\", Tags = new List<string> { \"ok\", \"v10\" }, Info = new() { Count = 3 } }",
        "new User() { Id = 8, Name = \"Bob\" }",
        "new User(11) { Name = \"Carl\", Info = { Count = 4 } }",
        "new() { Id = 9, Name = \"Neo\" }",
        "new(12) { Name = \"Eve\" }",
        "new List<string> { \"ok\", \"v10\" }",
        "new Dictionary<string, int> { { \"a\", 1 }, { \"b\", 2 } }",
        "new Dictionary<string, int> { [\"x\"] = 10, [\"y\"] = 20 }",
        "new Dictionary<string, Dictionary<string, List<int>>> { [\"k\"] = new() { [\"m\"] = new() { 5, 6 } } }",
        "new User {}",
        "new { Id = 77, Tag = \"anon\" }",
        "new User { Id = 42, Name = \"Zed\" }.Describe()",
        "p1 with { X = 10, Y = 20 }",
        "(p1 with { X = 99 }).X",
        "new[] { 10, 20 }",
    ] {
        assert!(aice.contains(exp), "C# AICE missing `{exp}`:\n{aice}");
        assert!(native.contains(exp), "C# native missing `{exp}`:\n{native}");
    }

    if has_tool("dotnet") {
        let dir = std::env::temp_dir().join(format!("aice_w10_cs_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir cs");
        std::fs::write(
            dir.join("Demo.csproj"),
            "<Project Sdk=\"Microsoft.NET.Sdk\">\n  <PropertyGroup>\n    <OutputType>Exe</OutputType>\n    <TargetFramework>net8.0</TargetFramework>\n    <Nullable>enable</Nullable>\n  </PropertyGroup>\n</Project>\n",
        ).expect("write csproj");
        std::fs::write(dir.join("Program.cs"), &native).expect("write Program.cs");

        let run = Command::new("dotnet")
            .args(["run", "--nologo", "--project"])
            .arg(dir.join("Demo.csproj"))
            .output()
            .expect("run dotnet");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            run.status.success(),
            "dotnet run failed:\nstdout: {}\nstderr: {}\n--- CS ---\n{native}",
            String::from_utf8_lossy(&run.stdout),
            String::from_utf8_lossy(&run.stderr),
        );
        assert_eq!(
            String::from_utf8_lossy(&run.stdout).trim(),
            "7:Ada:2:3|8:Bob|11:Carl:0:4|9:Neo|12:Eve|ok,v10|3|30|6|0|77:anon|42:Zed:0:0|10,20|99|30"
        );
    }
}

#[test]
fn f111_java_anonymous_classes_roundtrip_and_javac_run() {
    let java_src = r#"import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;

class BaseGreeter {
    protected final String prefix;
    protected final int factor;
    public BaseGreeter(String prefix, int factor) {
        this.prefix = prefix;
        this.factor = factor;
    }
    public String greet(String name) {
        return prefix + ":" + name;
    }
}

public class AnonDemo {
    public static Runnable makeRunner(StringBuilder out) {
        return new Runnable() {
            @Override
            public void run() {
                out.append("ret-run|");
            }
        };
    }

    public static void main(String[] args) {
        StringBuilder out = new StringBuilder();
        Runnable r = new Runnable() {
            @Override
            public void run() {
                out.append("local-run|");
            }
        };
        r.run();
        makeRunner(out).run();
        new Runnable() { public void run() { out.append("chained|"); } }.run();
        BaseGreeter g = new BaseGreeter("hi", 3) {
            private int calls = 0;
            @Override
            public String greet(String name) {
                calls++;
                return prefix + ":" + name + ":" + (factor * calls);
            }
        };
        out.append(g.greet("Ada")).append("|");
        List<String> items = new ArrayList<>();
        items.add("bbb");
        items.add("a");
        items.sort(new Comparator<String>() {
            @Override
            public int compare(String a, String b) {
                return Integer.compare(a.length(), b.length());
            }
        });
        out.append(String.join(",", items));
        System.out.println(out.toString());
    }
}
"#;
    let (_aice, native) = roundtrip(LanguageId::Java, "AnonDemo.java", java_src);

    assert!(native.contains("new Runnable() {"), "Java Runnable body dropped:\n{native}");
    assert!(native.contains("new BaseGreeter(\"hi\", 3) {"), "Java BaseGreeter body dropped:\n{native}");
    assert!(native.contains("new Comparator<String>() {"), "Java Comparator body dropped:\n{native}");
    assert!(native.contains("new ArrayList<>()"), "Java diamond ctor regressed:\n{native}");
    assert!(!native.contains("new Runnable();"), "Java emitted abstract instantiation:\n{native}");

    if has_tool("javac") {
        let dir = std::env::temp_dir().join(format!("aice_w10_java_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir java");
        let src_path = dir.join("AnonDemo.java");
        std::fs::write(&src_path, &native).expect("write AnonDemo.java");

        let compile = Command::new("javac").arg(&src_path).output().expect("run javac");
        assert!(
            compile.status.success(),
            "javac failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
            String::from_utf8_lossy(&compile.stdout),
            String::from_utf8_lossy(&compile.stderr),
        );
        if has_tool("java") {
            let run = Command::new("java").args(["-cp"]).arg(&dir).arg("AnonDemo").output().expect("run java");
            assert!(
                run.status.success(),
                "java failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
                String::from_utf8_lossy(&run.stdout),
                String::from_utf8_lossy(&run.stderr),
            );
            assert_eq!(
                String::from_utf8_lossy(&run.stdout).trim(),
                "local-run|ret-run|chained|hi:Ada:3|a,bbb"
            );
        }
        let _ = std::fs::remove_dir_all(&dir);
    }
}

#[test]
fn f111_sister_kotlin_object_literal_and_php_anonymous_class() {
    let kt_src = r#"fun demo(): String {
    var ran = ""
    val r = object : Runnable {
        override fun run() {
            ran = "kt-run"
        }
    }
    r.run()
    val sub = object : java.util.concurrent.Callable<String> {
        override fun call(): String = "kt:7"
    }
    val anon = object {
        val x = 21
        fun twice(): Int = x * 2
    }
    return "$ran|${sub.call()}|${anon.twice()}"
}
"#;
    let (_aice_kt, nat_kt) = roundtrip(LanguageId::Kotlin, "ObjLit.kt", kt_src);
    assert!(nat_kt.contains("object : Runnable {"), "Kotlin Runnable object_literal lost:\n{nat_kt}");
    assert!(nat_kt.contains("object : java.util.concurrent.Callable<String> {"), "Kotlin Callable object_literal lost:\n{nat_kt}");
    assert!(nat_kt.contains("object {"), "Kotlin anon object_literal lost:\n{nat_kt}");

    if has_tool("kotlinc") {
        let dir = std::env::temp_dir().join(format!("aice_w10_kt_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir kt");
        let kt_path = dir.join("ObjLit.kt");
        let jar_path = dir.join("objlit.jar");
        std::fs::write(&kt_path, &nat_kt).expect("write ObjLit.kt");
        let comp = Command::new("kotlinc").arg(&kt_path).arg("-d").arg(&jar_path).output().expect("run kotlinc");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            comp.status.success(),
            "kotlinc failed:\nstdout: {}\nstderr: {}\n--- KT ---\n{nat_kt}",
            String::from_utf8_lossy(&comp.stdout),
            String::from_utf8_lossy(&comp.stderr),
        );
    }

    let php_src = r#"<?php
interface Greeter {
    public function greet(): string;
}

class BaseItem {
    public function prefix(): string {
        return "php";
    }
}

function makeDemo(int $x): string {
    $obj = new class($x) extends BaseItem implements Greeter {
        public function __construct(private int $id) {}
        public function greet(): string {
            return $this->prefix() . ":" . $this->id;
        }
    };
    $chained = (new class($x + 1) {
        public function __construct(private int $v) {}
        public function get(): int { return $this->v; }
    })->get();
    $one = new class { public function ok(): string { return "ok"; } };
    return $obj->greet() . "|" . $chained . "|" . $one->ok();
}
"#;
    let (_aice_php, nat_php) = roundtrip(LanguageId::Php, "anon_php.php", php_src);
    assert!(nat_php.contains("new class($x) extends BaseItem implements Greeter {"), "PHP anon class lost:\n{nat_php}");
    assert!(nat_php.contains("(new class($x + 1) {"), "PHP chained anon class lost parens:\n{nat_php}");
    assert!(!nat_php.contains("}()"), "PHP emitted bogus trailing ():\n{nat_php}");

    if has_tool("php") {
        let dir = std::env::temp_dir().join(format!("aice_w10_php_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).expect("mkdir php");
        let php_path = dir.join("anon_php.php");
        std::fs::write(&php_path, &nat_php).expect("write anon_php.php");
        let lint = Command::new("php").arg("-l").arg(&php_path).output().expect("php -l");
        assert!(lint.status.success(), "php -l failed:\n{}\n--- PHP ---\n{nat_php}", String::from_utf8_lossy(&lint.stderr));
        let run = Command::new("php")
            .args(["-r", &format!("require '{}'; echo makeDemo(7);", php_path.display())])
            .output()
            .expect("php -r");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(
            run.status.success(),
            "php run failed:\nstdout: {}\nstderr: {}\n--- PHP ---\n{nat_php}",
            String::from_utf8_lossy(&run.stdout),
            String::from_utf8_lossy(&run.stderr),
        );
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "php:7|8|ok");
    }
}

#[test]
fn f111_raw_ident_non_conflict_and_triple_quote_escape() {
    let ir = "module m\npub fn f(raw:str) -> str:\n  a := raw(\"hi\")\n  b := raw + \"!\"\n  ret a\n";
    let parsed = parse_aice(ir).expect("parse raw ident");
    let ts = DefaultAiceTranspiler.to_native(&parsed, LanguageId::TypeScript).expect("ts");
    assert!(ts.contains("raw(\"hi\")") && ts.contains("raw + \"!\""), "raw ident broken:\n{ts}");

    let java_tb = r#"public class TbDemo {
    public static Runnable make() {
        return new Runnable() {
            public void run() {
                String s = """
                        hello
                        """;
                System.out.println(s);
            }
        };
    }
}
"#;
    let (aice, nat) = roundtrip(LanguageId::Java, "TbDemo.java", java_tb);
    assert!(aice.contains("raw \""), "triple-quote body should escape via raw \"...\":\n{aice}");
    assert!(nat.contains("\"\"\""), "Java text block inside anon class lost:\n{nat}");
}
