use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_with_opts(lang: LanguageId, vname: &str, src: &str, opts: &TranspileOpts) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, opts).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice_with_opts(&m, opts);
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

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    roundtrip_with_opts(lang, vname, src, &TranspileOpts::default())
}

fn verify_with_tool(tool: &str, args: &[&str], filename: &str, content: &str) {
    let Ok(which) = Command::new("which").arg(tool).output() else { return };
    if !which.status.success() { return; }
    let dir = std::env::temp_dir().join(format!("aice_w8_{}_{}", std::process::id(), filename.replace('.', "_")));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir tmp");
    let tmp = dir.join(filename);
    std::fs::write(&tmp, content).expect("write temp file");
    let out = Command::new(tool).args(args).arg(&tmp).output().expect("run tool");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        out.status.success(),
        "{tool} {args:?} failed for {filename}:\nstdout: {}\nstderr: {}\n--- SRC ---\n{content}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
}

#[test]
fn v8_2a_02_c_pointer_return_types() {
    let c_src = r#"#include <stddef.h>

int* first_ptr(int *a) {
    return &a[0];
}

void* alloc_null(size_t n) {
    return n > 0 ? NULL : NULL;
}

const char* get_label(void) {
    return "ok";
}

static const int* pick_const(const int *a) {
    return &a[0];
}

int** ptr_to_ptr(int **pp) {
    return pp;
}

const void* raw_view(const void *p) {
    return p;
}
"#;
    let (aice, native) = roundtrip(LanguageId::C, "ptr_ret.c", c_src);
    for exp in [
        "pub fn first_ptr(a:\"int*\") -> \"int*\"",
        "pub fn alloc_null(n:size_t) -> \"void*\"",
        "pub fn get_label() -> \"const char*\"",
        "priv fn pick_const(a:\"const int*\") -> \"const int*\"",
        "pub fn ptr_to_ptr(pp:\"int**\") -> \"int**\"",
        "pub fn raw_view(p:\"const void*\") -> \"const void*\"",
    ] {
        assert!(aice.contains(exp), "C AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "int* first_ptr(int* a)",
        "void* alloc_null(size_t n)",
        "const char* get_label(void)",
        "static const int* pick_const(const int* a)",
        "int** ptr_to_ptr(int** pp)",
        "const void* raw_view(const void* p)",
    ] {
        assert!(native.contains(exp), "C native missing `{exp}`:\n{native}");
    }
    verify_with_tool("gcc", &["-std=c99", "-Wall", "-Werror", "-fsyntax-only"], "ptr_ret.c", &native);
    let compact = TranspileOpts { compact: true, ..TranspileOpts::default() };
    let (_, c_compact) = roundtrip_with_opts(LanguageId::C, "ptr_ret_c.c", c_src, &compact);
    verify_with_tool("gcc", &["-std=c99", "-Wall", "-Werror", "-fsyntax-only"], "ptr_ret_c.c", &c_compact);
}

#[test]
fn v8_2a_03_c_and_cpp_const_pointee_and_ref_params() {
    let c_src = r#"#include <stddef.h>

int sum_const(const int *a, size_t n) {
    return n > 0 ? a[0] : 0;
}

char first_ch(const char *s) {
    return s[0];
}

void copy_one(int * restrict dst, const int * restrict src) {
    *dst = *src;
}

int call_c(void) {
    const int v = 10;
    return sum_const(&v, 1) + first_ch("ok");
}
"#;
    let (c_aice, c_nat) = roundtrip(LanguageId::C, "const_params.c", c_src);
    for exp in [
        "pub fn sum_const(a:\"const int*\", n:size_t) -> int",
        "pub fn first_ch(s:\"const char*\") -> char",
        "pub fn copy_one(dst:\"int*\", src:\"const int*\") -> void",
    ] {
        assert!(c_aice.contains(exp), "C const param AICE missing `{exp}`:\n{c_aice}");
    }
    for exp in [
        "int sum_const(const int* a, size_t n)",
        "char first_ch(const char* s)",
        "void copy_one(int* dst, const int* src)",
    ] {
        assert!(c_nat.contains(exp), "C const param native missing `{exp}`:\n{c_nat}");
    }
    verify_with_tool("gcc", &["-std=c99", "-Wall", "-Werror", "-fsyntax-only"], "const_params.c", &c_nat);

    let cpp_src = r#"#include <vector>
#include <string>

int sum2(const std::vector<int>& v, int i) {
    return v[i] + v[0];
}

int east_sum(std::vector<int> const& v) {
    return v[0];
}

const int* first_const(const int* a) {
    return &a[0];
}

const std::string& keep_ref(const std::string& s) {
    return s;
}

struct Reader {
    virtual const char* label(const std::string& key) const = 0;
};
"#;
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "const_ref.cpp", cpp_src);
    for exp in [
        "pub fn sum2(v:\"const std::vector<int>&\", i:int) -> int",
        "pub fn east_sum(v:\"const std::vector<int>&\") -> int",
        "pub fn first_const(a:\"const int*\") -> \"const int*\"",
        "pub fn keep_ref(s:\"const std::string&\") -> \"const std::string&\"",
        "pub fn label(key:\"const std::string&\") const -> \"const char*\"",
    ] {
        assert!(cpp_aice.contains(exp), "C++ const ref AICE missing `{exp}`:\n{cpp_aice}");
    }
    for exp in [
        "int sum2(const std::vector<int>& v, int i)",
        "int east_sum(const std::vector<int>& v)",
        "const int* first_const(const int* a)",
        "const std::string& keep_ref(const std::string& s)",
        "virtual const char* label(const std::string& key) const = 0;",
    ] {
        assert!(cpp_nat.contains(exp), "C++ const ref native missing `{exp}`:\n{cpp_nat}");
    }
    // Verify spliced declarations bind rvalue temporaries and const pointers cleanly under g++
    let cpp_with_caller = format!(
        "{cpp_nat}\nint caller() {{\n    const int x = 7;\n    return sum2(std::vector<int>{{10, 20}}, 1) + east_sum(std::vector<int>{{5}}) + *first_const(&x) + static_cast<int>(keep_ref(std::string(\"hi\")).size());\n}}\n"
    );
    verify_with_tool("g++", &["-std=c++20", "-Wall", "-Werror", "-fsyntax-only"], "const_ref.cpp", &cpp_with_caller);
}

#[test]
fn v8_2c_01_and_02_php_trait_interface_and_declare_order() {
    let php_src = r#"<?php declare(strict_types=1);
namespace Demo;

trait AuditTrait {
    public function auditTag(): string {
        return 'ok';
    }
    public static function ver(): int {
        return 1;
    }
}

interface Greeter {
    public function hi(): string;
}

interface TagAware {
    public function tag(): string;
}

interface LoudGreeter extends Greeter, TagAware {
    public function shout(): string;
}

abstract class BaseBot implements LoudGreeter {
    abstract public function hi(): string;
    public function tag(): string {
        return 'bot';
    }
    public function shout(): string {
        return strtoupper($this->hi());
    }
}

class Svc extends BaseBot {
    use AuditTrait;

    public function hi(): string {
        return 'hello';
    }

    public function greet(string $a, string $b): string {
        try {
            return $a . " " . $b;
        } catch (\RuntimeException $e) {
            return "err:" . $e->getMessage();
        }
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Php, "php_full.php", php_src);
    for exp in [
        "directive declare(strict_types=1);",
        "@trait\npub class AuditTrait:",
        "@interface\npub class Greeter:",
        "@interface\npub class LoudGreeter extends Greeter implements TagAware:",
        "@use(AuditTrait)",
    ] {
        assert!(aice.contains(exp), "PHP AICE missing `{exp}`:\n{aice}");
    }
    let decl_pos = native.find("declare(strict_types=1);").expect("declare missing");
    let ns_pos = native.find("namespace Demo;").expect("namespace missing");
    assert!(decl_pos < ns_pos, "declare must precede namespace:\n{native}");
    for exp in [
        "trait AuditTrait {",
        "public static function ver(): int",
        "interface Greeter {",
        "public function hi(): string;",
        "interface LoudGreeter extends Greeter, TagAware {",
        "public function shout(): string;",
        "abstract class BaseBot implements LoudGreeter {",
        "abstract public function hi(): string;",
        "class Svc extends BaseBot {",
        "use AuditTrait;",
    ] {
        assert!(native.contains(exp), "PHP native missing `{exp}`:\n{native}");
    }
    assert!(!native.contains("class AuditTrait"), "trait downgraded to class:\n{native}");
    assert!(!native.contains("class Greeter"), "interface downgraded to class:\n{native}");
    verify_with_tool("php", &["-l"], "php_full.php", &native);

    // Runtime execution check with `php -r`
    if Command::new("which").arg("php").output().is_ok_and(|o| o.status.success()) {
        let tmp = std::env::temp_dir().join(format!("aice_w8_php_rt_{}.php", std::process::id()));
        std::fs::write(&tmp, &native).expect("write php rt");
        let code = format!(
            "require '{}'; $s = new Demo\\Svc(); echo $s->auditTag() . '|' . $s->shout() . '|' . $s->greet('a', 'b');",
            tmp.display()
        );
        let out = Command::new("php").args(["-r", &code]).output().expect("php -r");
        let _ = std::fs::remove_file(&tmp);
        assert!(
            out.status.success(),
            "php -r failed:\nstdout: {}\nstderr: {}\n--- PHP ---\n{native}",
            String::from_utf8_lossy(&out.stdout),
            String::from_utf8_lossy(&out.stderr),
        );
        assert_eq!(String::from_utf8_lossy(&out.stdout), "ok|HELLO|a b");
    }
}

#[test]
fn v8_2c_04_java_static_initializer_blocks() {
    let java_src = r#"import java.util.HashMap;
import java.util.Map;

public class JavaF87 {
    public static final int BASE = 50;
    public static final int DEFAULT_LIMIT;
    private final Map<String, Integer> counts = new HashMap<>();

    static {
        DEFAULT_LIMIT = BASE * 2;
    }

    public enum Mode {
        FAST,
        SAFE
    }

    public int size() {
        return counts.size();
    }

    public static int limit() {
        return DEFAULT_LIMIT;
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Java, "JavaF87.java", java_src);
    for exp in [
        "static:",
        "DEFAULT_LIMIT = BASE * 2",
        "pub static readonly DEFAULT_LIMIT:int",
    ] {
        assert!(aice.contains(exp), "Java AICE missing `{exp}`:\n{aice}");
    }
    let field_pos = native.find("public static final int DEFAULT_LIMIT;").expect("field missing");
    let static_pos = native.find("static {").expect("static block missing");
    assert!(field_pos < static_pos, "static block should follow field decls:\n{native}");
    assert!(native.contains("DEFAULT_LIMIT = BASE * 2;"), "static body missing:\n{native}");
    verify_with_tool("javac", &[], "JavaF87.java", &native);
}

#[test]
fn v8_2c_04_dart_field_initializers() {
    let dart_src = r#"enum Status { idle, running, done }

mixin Loggable {
  void log(String msg) {
    print(msg);
  }
}

class Worker with Loggable {
  Status state = Status.idle;
  final int count = 0;
  static const int maxItems = 10;
  static final String tag = "ok";
  final List<int> items = [1, 2, 3];
  final String label = makeLabel("w");
}

extension StrExt on String {
  String shout() => toUpperCase();
}
"#;
    let (aice, native) = roundtrip(LanguageId::Dart, "dart_types.dart", dart_src);
    for exp in [
        "pub mut state:Status = Status.idle",
        "pub readonly count:int = 0",
        "pub static readonly maxItems:int = 10",
        "pub static readonly tag:str = \"ok\"",
        "pub readonly items:List[int] = [1, 2, 3]",
        "pub readonly label:str = makeLabel(\"w\")",
    ] {
        assert!(aice.contains(exp), "Dart AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "Status state = Status.idle;",
        "final int count = 0;",
        "static final int maxItems = 10;",
        "static final String tag = \"ok\";",
        "final List<int> items = [1, 2, 3];",
        "final String label = makeLabel(\"w\");",
    ] {
        assert!(native.contains(exp), "Dart native missing `{exp}`:\n{native}");
    }
}
