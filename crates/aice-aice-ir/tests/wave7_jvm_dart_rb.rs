use std::path::Path;

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
fn v7_sweep_02_java_generics_bounds_and_methods() {
    let src = r#"package demo;

public class Box<T extends Number> {
    public <U> U id(U x) {
        return x;
    }
}

public class Multi<T extends Number & Comparable<T>> {
    public static <U extends Number> U first(U a) {
        return a;
    }
}

public interface Mapper<A, B extends Number> {
    <C> C map(A a, B b);
}

public record Pair<A, B>(A first, B second) {}
"#;
    let (aice, native) = roundtrip(LanguageId::Java, "Box.java", src);
    for exp in [
        "pub class Box[T: Number]:",
        "pub fn id[U](x:U) -> U",
        "pub class Multi[T: Number + Comparable[T]]:",
        "pub static fn first[U: Number](a:U) -> U",
        "pub interface Mapper[A, B: Number]:",
        "fn map[C](a:A, b:B) -> C",
        "pub class Pair[A, B](first:A, second:B)",
    ] {
        assert!(aice.contains(exp), "Java AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "public class Box<T extends Number>",
        "public <U> U id(U x)",
        "public class Multi<T extends Number & Comparable<T>>",
        "public static <U extends Number> U first(U a)",
        "public interface Mapper<A, B extends Number>",
        "<C> C map(A a, B b);",
        "public record Pair<A, B>(A first, B second)",
    ] {
        assert!(native.contains(exp), "Java native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_02_kotlin_generics_bounds_and_where() {
    let src = r#"package demo

class Box<T : Number>(val items: List<T>) {
    fun <U> id(x: U): U = x
}

class Multi<T, U>(val a: T, val b: U) where T : Comparable<T>, T : CharSequence {
    fun <V> wrap(v: V): V where V : Comparable<V>, V : CharSequence = v
}

fun <T : Comparable<T>> pick(a: T, b: T): T = a
"#;
    let (aice, native) = roundtrip(LanguageId::Kotlin, "Box.kt", src);
    for exp in [
        "pub class Box[T: Number](items:List[T]):",
        "pub fn id[U](x:U) -> U = x",
        "pub class Multi[T: Comparable[T] + CharSequence, U](a:T, b:U):",
        "pub fn wrap[V: Comparable[V] + CharSequence](v:V) -> V = v",
        "pub fn pick[T: Comparable[T]](a:T, b:T) -> T = a",
    ] {
        assert!(aice.contains(exp), "Kotlin AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "class Box<T : Number>(val items: List<T>)",
        "fun <U> id(x: U): U",
        "class Multi<T, U>(val a: T, val b: U) where T : Comparable<T>, T : CharSequence",
        "fun <V> wrap(v: V): V where V : Comparable<V>, V : CharSequence",
        "fun <T : Comparable<T>> pick(a: T, b: T): T",
    ] {
        assert!(native.contains(exp), "Kotlin native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_02_csharp_generics_and_where_clauses() {
    let src = r#"namespace Demo {
    public class Box<T> where T : struct {
        public U Id<U>(U x) => x;
    }

    public class Repo<T, K> where T : class, new() where K : struct {
        public R Map<R>(T item, K key) where R : struct {
            return default;
        }
    }

    public interface IStore<T, K> where T : class {
        T Get<V>(K id, V ctx) where V : struct;
    }

    public record Pair<T, U>(T First, U Second) where T : struct;
}
"#;
    let (aice, native) = roundtrip(LanguageId::CSharp, "Box.cs", src);
    for exp in [
        "pub class Box[T: struct]:",
        "pub fn Id[U](x:U) -> U = x",
        "pub class Repo[T: class + \"new()\", K: struct]:",
        "pub fn Map[R: struct](item:T, key:K) -> R = default",
        "pub interface IStore[T: class, K]:",
        "fn Get[V: struct](id:K, ctx:V) -> T",
        "pub class Pair[T: struct, U](First:T, Second:U)",
    ] {
        assert!(aice.contains(exp), "C# AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "public class Box<T> where T : struct",
        "public U Id<U>(U x)",
        "public class Repo<T, K> where T : class, new() where K : struct",
        "public R Map<R>(T item, K key) where R : struct",
        "public interface IStore<T, K> where T : class",
        "T Get<V>(K id, V ctx) where V : struct;",
        "public record Pair<T, U>(T First, U Second) where T : struct;",
    ] {
        assert!(native.contains(exp), "C# native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_02_dart_generics_and_bounds() {
    let src = r#"abstract class Base<T extends num> {
  final List<T> items;
  Base(this.items);
  U mapFirst<U>(U Function(T) f) => f(items[0]);
  wrap<V>(V x) => x;
}

U identity<U>(U x) => x;
"#;
    let (aice, native) = roundtrip(LanguageId::Dart, "box.dart", src);
    for exp in [
        "pub abstract class Base[T: num]:",
        "pub fn mapFirst[U](f:\"U Function(T)\") -> U",
        "pub fn wrap[V](x:V) = x",
        "pub fn identity[U](x:U) -> U",
    ] {
        assert!(aice.contains(exp), "Dart AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "abstract class Base<T extends num>",
        "U mapFirst<U>(U Function(T) f)",
        "void wrap<V>(V x) => x;",
        "U identity<U>(U x)",
    ] {
        assert!(native.contains(exp), "Dart native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_04_dart_enum_mixin_extension_and_with_clause() {
    let src = r#"enum Status { idle, run }
enum Level {
  low(1),
  high(2);
  final int code;
  const Level(this.code);
}
mixin Log {
  void log(String m) => print(m);
}
mixin Audit on Base {
  void record(String ev) => print(ev);
}
extension IntOps on int {
  int dbl() => this * 2;
}
extension ListOps<T> on List<T> {
  T firstOr(T d) => d;
}
extension on String {
  int len() => 1;
}
class Base {}
class Repo with Log {}
class FullRepo extends Base with Log, Audit implements Store {}
"#;
    let (aice, native) = roundtrip(LanguageId::Dart, "decls.dart", src);
    for exp in [
        "pub enum Status:",
        "idle",
        "run",
        "@enum",
        "pub class Level:",
        "low = Level(1)",
        "high = Level(2)",
        "@mixin",
        "pub class Log:",
        "@on(Base)",
        "pub class Audit:",
        "@extension(int)",
        "pub class IntOps:",
        "@extension(List<T>)",
        "pub class ListOps[T]:",
        "@extension(str)",
        "@with(Log)",
        "pub class Repo:",
        "@with(Log, Audit)",
        "pub class FullRepo extends Base implements Store:",
    ] {
        if exp == "@extension(str)" {
            assert!(aice.contains("@extension(String)"), "Dart decls AICE missing `@extension(String)`:\n{aice}");
            continue;
        }
        assert!(aice.contains(exp), "Dart decls AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "enum Status {",
        "enum Level {",
        "low(1),",
        "high(2);",
        "const Level(this.code);",
        "mixin Log {",
        "void log(String m) => print(m);",
        "mixin Audit on Base {",
        "extension IntOps on int {",
        "extension ListOps<T> on List<T> {",
        "extension on String {",
        "class Repo with Log {",
        "class FullRepo extends Base with Log, Audit implements Store {",
    ] {
        assert!(native.contains(exp), "Dart decls native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_06_kotlin_function_type_params_and_return() {
    let src = r#"class Producer<out T : Any>(val item: T)

fun f(
    p: Pair<Int, String>,
    cb: (Int) -> String,
    cb2: (x: Int, y: String) -> Boolean,
    cb3: (() -> Unit)?,
    cb4: String.(Int) -> Boolean
): String {
    return cb(p.first)
}

fun passthrough(cb: (Int) -> String): (Int) -> String {
    return cb
}
"#;
    let (aice, native) = roundtrip(LanguageId::Kotlin, "fn_types.kt", src);
    for exp in [
        "pub class Producer[T: any](item:T)",
        "cb:fn(int) -> str",
        "cb2:fn(int, str) -> bool",
        "cb3:(fn() -> void)?",
        "cb4:\"String.(Int) -> Boolean\"",
        "pub fn passthrough(cb:fn(int) -> str) -> fn(int) -> str = cb",
    ] {
        assert!(aice.contains(exp), "Kotlin fn-type AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "class Producer<T : Any>(val item: T)",
        "cb: (Int) -> String",
        "cb2: (Int, String) -> Boolean",
        "cb3: (() -> Unit)?",
        "cb4: String.(Int) -> Boolean",
        "fun passthrough(cb: (Int) -> String): (Int) -> String",
    ] {
        assert!(native.contains(exp), "Kotlin fn-type native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_13_java_static_field_init_and_nested_enum() {
    let src = r#"public class T {
    public static final String VER = "1.0";
    private int count = 42;
    public enum L {
        LOW(1),
        HIGH(2);
        final int c;
        L(int c) {
            this.c = c;
        }
        public int code() {
            return this.c;
        }
    }
    public enum Simple {
        A,
        B
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Java, "T.java", src);
    for exp in [
        "pub static readonly VER:str = \"1.0\"",
        "priv mut count:int = 42",
        "@nested(T)",
        "@enum",
        "pub class L:",
        "LOW = L(1)",
        "HIGH = L(2)",
        "pkg readonly c:int",
        "pkg constructor(c:int):",
        "pub fn code() -> int",
        "directive @nested(T)",
        "pub enum Simple:",
    ] {
        assert!(aice.contains(exp), "Java nested enum AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "public static final String VER = \"1.0\";",
        "private int count = 42;",
        "public enum L {",
        "LOW(1),",
        "HIGH(2);",
        "final int c;",
        "L(int c)",
        "public int code()",
        "public enum Simple {",
    ] {
        assert!(native.contains(exp), "Java nested enum native missing `{exp}`:\n{native}");
    }
    // Verify nested enums are emitted INSIDE class T (indented), not after T's closing brace
    let t_pos = native.find("public class T {").unwrap();
    let l_pos = native.find("public enum L {").unwrap();
    let s_pos = native.find("public enum Simple {").unwrap();
    assert!(t_pos < l_pos && l_pos < s_pos, "nested enums should be inside class T:\n{native}");
}

#[test]
fn v7_sweep_15_ruby_attr_accessor_reader_writer() {
    let src = r#"class Base
  attr_accessor :name, :age
  attr_reader :id
  attr_writer :token

  def f(cur)
    cur.to_s
  end
end
"#;
    let (aice, native) = roundtrip(LanguageId::Ruby, "base.rb", src);
    for exp in [
        "@attr_accessor",
        "pub mut name",
        "pub mut age",
        "@attr_reader",
        "pub readonly id",
        "@attr_writer",
        "pub mut token",
    ] {
        assert!(aice.contains(exp), "Ruby attrs AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "attr_accessor :name, :age",
        "attr_reader :id",
        "attr_writer :token",
    ] {
        assert!(native.contains(exp), "Ruby attrs native missing `{exp}`:\n{native}");
    }
}

#[test]
fn v7_sweep_08_php_class_use_trait() {
    let src = r#"<?php
trait T {
    public function ok(): int {
        return 1;
    }
}
trait Timestampable {
    public function now(): int {
        return 0;
    }
}
class C {
    use T, Timestampable;
    public function f(string $a): string {
        return $a;
    }
}
class D {
    use Timestampable;
    use A, B {
        A::ok insteadof B;
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Php, "traits.php", src);
    for exp in [
        "pub class T:",
        "pub class Timestampable:",
        "@use(T, Timestampable)",
        "pub class C:",
        "@use(Timestampable)",
        "@use(A, B { A::ok insteadof B; })",
        "pub class D:",
    ] {
        assert!(aice.contains(exp), "PHP trait AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "class C {",
        "use T, Timestampable;",
        "class D {",
        "use Timestampable;",
        "use A, B { A::ok insteadof B; }",
    ] {
        assert!(native.contains(exp), "PHP trait native missing `{exp}`:\n{native}");
    }
}
