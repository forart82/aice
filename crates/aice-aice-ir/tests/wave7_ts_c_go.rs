use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
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
    let tmp = std::env::temp_dir().join(format!("aice_w7_{}_{filename}", std::process::id()));
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
fn v7_sweep_07_js_class_private_static_accessors_and_generators() {
    let js = r#"export class Bag {
  #secret = 42;
  #abc = 7;
  static ver = 2;
  static #hidden = 9;
  flag = true ? 1 : 0;
  get size() { return 1; }
  set size(v) { this.#secret = v; }
  get #val() { return this.#secret; }
  *gen() { yield this.#secret; }
  async *stream() { yield this.#secret; }
  async *#privStream() { yield this.#secret; }
  static async *all() { yield Bag.ver; }
}

function* localGen() {
  yield 0;
}

export function* range(n) {
  let i = 0;
  while (i < n) {
    yield i;
    i += 1;
  }
}

export async function* fetchPages(n) {
  yield n;
}
"#;
    let (aice, native) = roundtrip(LanguageId::JavaScript, "bag.mjs", js);
    for exp in [
        "#secret = 42",
        "#abc = 7",
        "static ver = 2",
        "static #hidden = 9",
        "flag = ",
        "get size()",
        "set size(v)",
        "get #val()",
        "fn* gen()",
        "async fn* stream()",
        "async fn* #privStream()",
        "static async fn* all()",
        "fn* localGen()",
        "pub fn* range(n)",
        "pub async fn* fetchPages(n)",
    ] {
        assert!(aice.contains(exp), "JS AICE missing `{exp}`:\n{aice}");
    }
    assert!(!aice.contains("priv secret"), "JS stripped `#` from #secret:\n{aice}");
    assert!(!aice.contains("flag?"), "JS ternary init falsely marked optional:\n{aice}");
    for exp in [
        "#secret = 42;",
        "#abc = 7;",
        "static ver = 2;",
        "static #hidden = 9;",
        "get size() {",
        "set size(v) {",
        "get #val() {",
        "*gen() {",
        "async *stream() {",
        "async *#privStream() {",
        "static async *all() {",
        "function* localGen() {",
        "export function* range(n) {",
        "export async function* fetchPages(n) {",
    ] {
        assert!(native.contains(exp), "JS native missing `{exp}`:\n{native}");
    }
    verify_with_tool("node", &["--check"], "bag.mjs", &native);

    // Compact mode roundtrip must also pass node --check
    let compact = TranspileOpts { compact: true, ..TranspileOpts::default() };
    let (_, compact_native) = roundtrip_with_opts(LanguageId::JavaScript, "bag_c.mjs", js, &compact);
    verify_with_tool("node", &["--check"], "bag_c.mjs", &compact_native);

    // TSX generator function must NOT be misclassified as JSX component
    let tsx = "export function* steps(): Generator<number> {\n  yield 1;\n}\n";
    let (tsx_aice, tsx_nat) = roundtrip(LanguageId::Tsx, "gen.tsx", tsx);
    assert!(tsx_aice.contains("pub fn* steps()"), "TSX gen AICE:\n{tsx_aice}");
    assert!(tsx_nat.contains("export function* steps(): Generator<number>"), "TSX gen native:\n{tsx_nat}");
}

#[test]
fn v7_sweep_07_ts_typed_private_static_accessors_and_generators() {
    let ts = r#"export class Store {
  #secret: number = 42;
  private label: string = "ok";
  static readonly ver: number = 2;
  get count(): number { return this.#secret; }
  set count(v: number) { this.#secret = v; }
  get(key: string): string { return key; }
  *values(): Generator<number> { yield this.#secret; }
  async *stream(): AsyncGenerator<number> { yield this.#secret; }
}

export function* ids(): Generator<number> {
  yield 1;
}

export async function* events(): AsyncGenerator<string> {
  yield "ready";
}
"#;
    let (aice, native) = roundtrip(LanguageId::TypeScript, "store.ts", ts);
    for exp in [
        "#secret:num = 42",
        "priv label:str = \"ok\"",
        "static readonly ver:num = 2",
        "get count() -> num",
        "set count(v:num)",
        "fn get(key:str) -> str",
        "fn* values() -> Generator[num]",
        "async fn* stream() -> AsyncGenerator[num]",
        "pub fn* ids() -> Generator[num]",
        "pub async fn* events() -> AsyncGenerator[str]",
    ] {
        assert!(aice.contains(exp), "TS AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "#secret: number = 42;",
        "private label: string = \"ok\";",
        "static readonly ver: number = 2;",
        "get count(): number {",
        "set count(v: number) {",
        "get(key: string): string {",
        "*values(): Generator<number> {",
        "async *stream(): AsyncGenerator<number> {",
        "export function* ids(): Generator<number> {",
        "export async function* events(): AsyncGenerator<string> {",
    ] {
        assert!(native.contains(exp), "TS native missing `{exp}`:\n{native}");
    }
    assert!(!native.contains("private #secret"), "TS must not emit `private #secret`:\n{native}");
}

#[test]
fn v7_sweep_09_c_typedef_enum_roundtrip() {
    let c_src = r#"typedef enum {
    ST_IDLE = 0,
    ST_RUN = 1,
    ST_DONE
} State;

typedef enum ColorTag {
    CLR_RED = 10,
    CLR_BLUE = 20
} Color;

int is_run(State s) {
    return s == ST_RUN;
}
"#;
    let (aice, native) = roundtrip(LanguageId::C, "state.c", c_src);
    assert!(!aice.contains("type State:\n  pass"), "C enum erased to pass:\n{aice}");
    for exp in [
        "pub enum State:",
        "ST_IDLE = 0",
        "ST_RUN = 1",
        "ST_DONE",
        "pub enum Color:",
        "CLR_RED = 10",
        "CLR_BLUE = 20",
    ] {
        assert!(aice.contains(exp), "C AICE missing `{exp}`:\n{aice}");
    }
    for exp in ["typedef enum {", "ST_IDLE = 0,", "ST_RUN = 1,", "ST_DONE", "} State;", "} Color;"] {
        assert!(native.contains(exp), "C native missing `{exp}`:\n{native}");
    }
    verify_with_tool("gcc", &["-fsyntax-only", "-Wall", "-Wextra"], "state.c", &native);
}

#[test]
fn v7_sweep_09_cpp_pure_virtual_and_base_class_inheritance() {
    let cpp_src = r#"struct Base {
    virtual ~Base() {}
    virtual int compute(int x) const = 0;
    virtual int* data() const = 0;
    virtual void reset();
    virtual int bonus() const { return 1; }
    int tag;
};

struct Extra {
    virtual int ping() const = 0;
};

class Impl : public Base, public Extra {
public:
    int compute(int x) const override {
        return x + bonus();
    }
    int* data() const override {
        return nullptr;
    }
    int ping() const override {
        return 7;
    }
};
"#;
    let (aice, native) = roundtrip(LanguageId::Cpp, "virt.cpp", cpp_src);
    assert!(!aice.contains("mut compute("), "C++ pure virtual mis-decompiled as prop:\n{aice}");
    for exp in [
        "@virtual",
        "@pure",
        "pub fn ~Base()",
        "pub fn compute(x:int) const -> int",
        "pub fn data() const -> \"int*\"",
        "pub fn reset() -> void",
        "pub class Impl extends Base implements Extra:",
        "@override",
    ] {
        assert!(aice.contains(exp), "C++ AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "virtual ~Base() {",
        "virtual int compute(int x) const = 0;",
        "virtual int* data() const = 0;",
        "virtual void reset();",
        "class Impl : public Base, public Extra {",
        "int compute(int x) const override {",
        "int* data() const override {",
        "int ping() const override {",
    ] {
        assert!(native.contains(exp), "C++ native missing `{exp}`:\n{native}");
    }
    verify_with_tool("g++", &["-std=c++20", "-fsyntax-only"], "virt.cpp", &native);
}

#[test]
fn v7_sweep_12_go_type_constraint_interfaces() {
    let go_src = r#"package p

import "io"

type Number interface {
	~int | ~float64
}

type Bytes interface {
	~[]byte | ~string
}

type Mixed interface {
	~int | ~int64
	String() string
}

type UnionNoTilde interface {
	int | float64
}

type ReadCloser interface {
	io.Reader
	Close() error
}

type Extended interface {
	Number
	Reset()
}

type Empty interface{}

func Double[T Number](x T) T {
	return x + x
}
"#;
    let (aice, native) = roundtrip(LanguageId::Go, "constraints.go", go_src);
    assert!(!aice.contains("pub interface Number:\n  pass"), "Go type_elem erased to pass:\n{aice}");
    for exp in [
        "pub interface Number:",
        "~int | ~float64",
        "~[]byte | ~string",
        "pub interface Mixed:",
        "~int | ~int64",
        "pub fn String() -> str",
        "int | float64",
        "io.Reader",
        "pub fn Close() -> error",
        "Number",
    ] {
        assert!(aice.contains(exp), "Go AICE missing `{exp}`:\n{aice}");
    }
    for exp in [
        "type Number interface {",
        "~int | ~float64",
        "~[]byte | ~string",
        "type Mixed interface {",
        "~int | ~int64",
        "String() string",
        "int | float64",
        "io.Reader",
        "Close() error",
        "type Extended interface {",
        "func Double[T Number](x T) T {",
    ] {
        assert!(native.contains(exp), "Go native missing `{exp}`:\n{native}");
    }
    verify_with_tool("gofmt", &["-e"], "constraints.go", &native);
    verify_go_build("constraints_pkg", &native);

    // Compact mode inline interface roundtrip
    let compact = TranspileOpts { compact: true, ..TranspileOpts::default() };
    let (caice, cnative) = roundtrip_with_opts(LanguageId::Go, "constraints_c.go", go_src, &compact);
    assert!(caice.contains("pub interface Number: ~int | ~float64"), "compact Go AICE:\n{caice}");
    verify_with_tool("gofmt", &["-e"], "constraints_c.go", &cnative);
    verify_go_build("constraints_pkg_c", &cnative);
    let _ = print_aice(&parse_aice(&caice).unwrap());
}

fn verify_go_build(tag: &str, content: &str) {
    let Ok(which) = Command::new("which").arg("go").output() else { return };
    if !which.status.success() { return; }
    let dir = std::env::temp_dir().join(format!("aice_w7_go_{}_{tag}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir go tmp");
    std::fs::write(dir.join("go.mod"), "module example.com/p\n\ngo 1.21\n").expect("write go.mod");
    std::fs::write(dir.join("p.go"), content).expect("write p.go");
    let out = Command::new("go").args(["build", "./..."]).current_dir(&dir).output().expect("run go build");
    let _ = std::fs::remove_dir_all(&dir);
    assert!(
        out.status.success(),
        "go build failed for {tag}:\nstdout: {}\nstderr: {}\n--- SRC ---\n{content}",
        String::from_utf8_lossy(&out.stdout),
        String::from_utf8_lossy(&out.stderr),
    );
}
