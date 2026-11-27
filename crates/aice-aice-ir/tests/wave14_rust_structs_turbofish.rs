use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip_rs(vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let opts = TranspileOpts::default();
    let tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &opts).unwrap() else {
        panic!("expected Transpiled for {vname}");
    };
    let aice = print_aice_with_opts(&m, &opts);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, LanguageId::Rust).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), LanguageId::Rust);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

fn compile_and_run_rs(tag: &str, src: &str, expected_stdout: &str) {
    if !Command::new("which").arg("rustc").output().is_ok_and(|o| o.status.success()) {
        return;
    }
    let dir = std::env::temp_dir().join(format!("aice_w14_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let src_p = dir.join(format!("{tag}.rs"));
    let bin_p = dir.join(tag);
    std::fs::write(&src_p, src).unwrap();
    let cc = Command::new("rustc")
        .args(["--edition", "2021", "-D", "warnings"])
        .arg(&src_p)
        .arg("-o")
        .arg(&bin_p)
        .output()
        .unwrap();
    assert!(
        cc.status.success(),
        "rustc --edition 2021 -D warnings failed for {tag}:\n{}\n--- RS ---\n{src}",
        String::from_utf8_lossy(&cc.stderr)
    );
    let run = Command::new(&bin_p).output().unwrap();
    let _ = std::fs::remove_dir_all(&dir);
    assert!(run.status.success(), "run failed for {tag}: {}", String::from_utf8_lossy(&run.stderr));
    assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), expected_stdout);
}

#[test]
fn f122_rust_tuple_indexing_single_chained_self_and_assign() {
    let rs = r#"pub struct Two(pub i32, pub i32);

impl Two {
    pub fn total(&self) -> i32 {
        self.0 + self.1
    }
}

pub fn sum_pair(t: (i32, i32)) -> i32 {
    t.0 + t.1
}

pub fn sum_nested(t: ((i32, i32), i32)) -> i32 {
    t.0.1 + t.1
}

pub fn sum_deep(d: (((i32, i32), i32), i32)) -> i32 {
    d.0.0.1 + d.0.1 + d.1
}

pub fn mutate_tuple(mut t: (i32, i32)) -> i32 {
    t.0 = 5;
    t.1 += t.0;
    t.0 + t.1
}

pub fn tuple_parse(t: (&str, i32)) -> i32 {
    t.0.parse::<i32>().unwrap_or(0) + t.1
}

fn main() {
    let two = Two(10, 20);
    let a = sum_pair((3, 4));
    let b = sum_nested(((1, 8), 2));
    let c = sum_deep((((1, 9), 4), 5));
    let d = mutate_tuple((99, 7));
    let e = tuple_parse(("11", 6));
    println!("{}|{}|{}|{}|{}|{}", two.total(), a, b, c, d, e);
}
"#;
    let (_, nat) = roundtrip_rs("tuple_idx.rs", rs);
    assert!(nat.contains("t.0.1 + t.1"), "chained .0.1 lost:\n{nat}");
    assert!(nat.contains("d.0.0.1 + d.0.1 + d.1"), "3-deep .0.0.1 lost:\n{nat}");
    assert!(nat.contains("t.0 = 5;"), "tuple assign lost:\n{nat}");
    compile_and_run_rs("f122", &nat, "30|7|10|18|17|17");
    assert!(parse_aice("module rust\npub fn bad(t:i32) -> i32 = t.0e1\n").is_err());
}

#[test]
fn f123_rust_tuple_structs_standalone_and_impl_merged() {
    let rs = r#"#[derive(Debug)]
pub struct Wrapper(pub String, pub usize);

struct Id(u64);

#[derive(Debug)]
pub struct Pair(pub i32, i32);

impl Pair {
    pub fn sum(&self) -> i32 {
        self.0 + self.1
    }

    pub fn bump(&mut self, delta: i32) {
        self.0 += delta;
        self.1 += delta;
    }
}

pub struct Quad(pub i32, pub(crate) i32, i32, pub usize);

pub struct EmptyTuple();

pub struct EmptyTupleImpl();

impl EmptyTupleImpl {
    pub fn code(&self) -> i32 {
        9
    }
}

fn main() {
    let w = Wrapper(String::from("ok"), 4);
    let id = Id(42);
    let mut p = Pair(3, 5);
    p.bump(2);
    let q = Quad(1, 2, 3, 4);
    let _et = EmptyTuple();
    let eti = EmptyTupleImpl();
    println!("{}|{}|{}|{}|{}|{}", w.0, w.1, id.0, p.sum(), q.0 + q.1 + q.2 + q.3 as i32, eti.code());
}
"#;
    let (aice, nat) = roundtrip_rs("tuple_structs.rs", rs);
    assert!(aice.contains("@tuple"), "AICE missing @tuple:\n{aice}");
    assert!(nat.contains("pub struct Wrapper(pub String, pub usize);"), "Wrapper corrupted:\n{nat}");
    assert!(nat.contains("struct Id(u64);"), "Id corrupted:\n{nat}");
    assert!(nat.contains("pub struct Pair(pub i32, i32);"), "Pair corrupted:\n{nat}");
    assert!(nat.contains("pub struct Quad(pub i32, pub(crate) i32, i32, pub usize);"), "Quad corrupted:\n{nat}");
    assert!(nat.contains("pub struct EmptyTuple();"), "EmptyTuple corrupted:\n{nat}");
    compile_and_run_rs("f123", &nat, "ok|4|42|12|10|9");
}

#[test]
fn f124_rust_unit_structs_standalone_impl_and_empty_braced() {
    let rs = r#"#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct Marker;

struct PrivMarker;

#[derive(Debug, Clone, Copy)]
pub struct Tag;

impl Tag {
    pub fn label(&self) -> &'static str {
        "tag"
    }
}

#[derive(Debug)]
pub struct EmptyBraced {}

pub struct EmptyBracedImpl {}

impl EmptyBracedImpl {
    pub fn val(&self) -> i32 {
        3
    }
}

pub fn make() -> Marker {
    Marker
}

fn main() {
    let m = make();
    let _pm = PrivMarker;
    let t = Tag;
    let _eb = EmptyBraced {};
    let ebi = EmptyBracedImpl {};
    println!("{:?}|{}|{}", m, t.label(), ebi.val());
}
"#;
    let (aice, nat) = roundtrip_rs("unit_structs.rs", rs);
    assert!(aice.contains("@unit"), "AICE missing @unit:\n{aice}");
    assert!(nat.contains("pub struct Marker;"), "Marker compiled braced:\n{nat}");
    assert!(nat.contains("struct PrivMarker;"), "PrivMarker compiled braced:\n{nat}");
    assert!(nat.contains("pub struct Tag;"), "Tag compiled braced:\n{nat}");
    assert!(nat.contains("pub struct EmptyBraced {"), "EmptyBraced lost braces:\n{nat}");
    assert!(nat.contains("pub struct EmptyBracedImpl {}"), "EmptyBracedImpl lost braces:\n{nat}");
    compile_and_run_rs("f124", &nat, "Marker|tag|3");
}

#[test]
fn f125_rust_turbofish_all_forms_nested_lifetimes_and_chaining() {
    let rs = r#"pub fn parse_i32(s: &str) -> i32 {
    s.parse::<i32>().unwrap_or(0)
}

pub fn collect_vec(v: &[i32]) -> Vec<i32> {
    v.iter().copied().collect::<Vec<_>>()
}

pub fn new_vec() -> Vec<i32> {
    let mut v = Vec::<i32>::new();
    v.push(7);
    v
}

pub fn ok_string(x: i32) -> Result<i32, String> {
    Ok::<i32, String>(x)
}

pub fn ok_static(x: i32) -> Result<i32, &'static str> {
    Ok::<i32, &'static str>(x)
}

pub fn none_usize() -> Option<usize> {
    None::<usize>
}

pub fn sizes() -> usize {
    std::mem::size_of::<u64>()
        + std::mem::size_of::<&[u8]>()
        + std::mem::size_of::<[u8; 4]>()
        + std::mem::size_of::<[u8; 1 << 2]>()
        + std::mem::size_of::<(i32, i32)>()
}

pub fn nested_triple() -> usize {
    let mut v = Vec::<Option<Vec<_>>>::new();
    v.push(Some(vec![1i32, 2]));
    v.len()
}

pub fn boxed_fn(x: i32) -> i32 {
    let opt = Option::<Box<dyn Fn(i32) -> i32>>::Some(Box::new(|n| n + 10));
    let fp = Option::<fn(i32) -> i32>::Some(|n| n * 2);
    opt.unwrap()(x) + fp.unwrap()(x)
}

pub fn filter_parse(xs: &[&str]) -> Vec<i32> {
    xs.iter().filter_map(|s| s.parse::<i32>().ok()).collect::<Vec<_>>()
}

pub fn qualified_some(x: i32) -> Option<i32> {
    std::option::Option::<i32>::Some(x)
}

fn main() {
    let a = parse_i32("42");
    let b = collect_vec(&[1, 2, 3]).len();
    let c = new_vec()[0];
    let d = ok_string(5).unwrap();
    let e = ok_static(6).unwrap();
    let f = none_usize().is_none();
    let g = sizes() > 0;
    let h = nested_triple();
    let i = boxed_fn(4);
    let j = filter_parse(&["10", "bad", "20"]);
    let k = qualified_some(9).unwrap();
    println!("{a}|{b}|{c}|{d}|{e}|{f}|{g}|{h}|{i}|{:?}|{k}", j);
}
"#;
    let (_, nat) = roundtrip_rs("turbofish.rs", rs);
    assert!(nat.contains("s.parse::<i32>().unwrap_or(0)"), "parse turbofish lost:\n{nat}");
    assert!(nat.contains(".collect::<Vec<_>>()"), "collect turbofish lost:\n{nat}");
    assert!(nat.contains("Vec::<i32>::new()"), "Vec::new turbofish lost:\n{nat}");
    assert!(nat.contains("Ok::<i32, String>(x)"), "Ok String turbofish lost:\n{nat}");
    assert!(nat.contains("Ok::<i32, &'static str>(x)"), "Ok static lifetime turbofish lost:\n{nat}");
    assert!(nat.contains("None::<usize>"), "None turbofish lost:\n{nat}");
    assert!(nat.contains("std::mem::size_of::<u64>()"), "size_of turbofish lost:\n{nat}");
    assert!(nat.contains("Vec::<Option<Vec<_>>>::new()"), "nested >>> turbofish lost:\n{nat}");
    compile_and_run_rs("f125", &nat, "42|3|7|5|6|true|true|1|22|[10, 20]|9");
    assert!(parse_aice("module rust\npub fn bad() = foo::<i32\n").is_err());
}
