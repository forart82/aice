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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n--- A1 ---\n{a1}\n--- A2 ---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n--- N1 ---\n{n1}\n--- N2 ---\n{n2}");
    (a1, n1)
}

#[test]
fn f179_rust_mod_extern_union_macros_2x() {
    let src = r#"pub mod sub;
pub(crate) mod util;
pub(super) mod up;
mod bar;

#[cfg(test)]
mod tests {
    pub fn ok() -> bool {
        true
    }
}

mod inner {
    pub fn val() -> i32 {
        42
    }
}

extern "C" {
    fn abs(x: i32) -> i32;
}

union IntOrFloat {
    i: i32,
    f: f32,
}

pub union Tagged {
    a: u64,
    b: [u8; 8],
}

macro_rules! mk_val {
    () => { 7 };
}

pub fn call_inner() -> i32 {
    inner::val() + mk_val!()
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "mods.rs", src);
    assert!(nat.contains("pub mod sub;"), "{nat}");
    assert!(nat.contains("pub(crate) mod util;"), "{nat}");
    assert!(nat.contains("pub(super) mod up;"), "{nat}");
    assert!(nat.contains("mod bar;"), "{nat}");
    assert!(nat.contains("#[cfg(test)]"), "{nat}");
    assert!(nat.contains("mod tests {"), "{nat}");
    assert!(nat.contains("mod inner {"), "{nat}");
    assert!(nat.contains("extern \"C\" {"), "{nat}");
    assert!(nat.contains("union IntOrFloat {"), "{nat}");
    assert!(nat.contains("pub union Tagged {"), "{nat}");
    assert!(nat.contains("macro_rules! mk_val"), "{nat}");
    assert!(!nat.contains("// pub mod"), "{nat}");
    assert!(!nat.contains("// mod "), "{nat}");
    assert!(!nat.contains("// extern "), "{nat}");
    assert!(!nat.contains("// union "), "{nat}");
}

#[test]
fn f180_rust_const_unsafe_extern_fn_and_methods_2x() {
    let src = r#"pub const fn add(a: i32, b: i32) -> i32 {
    a + b
}

pub const X: i32 = add(1, 2);

pub unsafe fn deref_p(p: *const i32) -> i32 {
    *p
}

pub extern "C" fn c_cb(x: i32) -> i32 {
    x + 1
}

pub unsafe extern "C" fn c_deref(p: *const i32) -> i32 {
    *p
}

pub const unsafe fn const_unsafe(x: i32) -> i32 {
    x
}

pub async unsafe fn async_raw(p: *const i32) -> i32 {
    *p
}

pub struct Boxed {
    pub v: i32,
}

impl Boxed {
    pub const fn new(v: i32) -> Self {
        Self { v }
    }

    pub unsafe fn read_ptr(p: *const i32) -> i32 {
        *p
    }

    pub extern "C" fn abi_get(&self) -> i32 {
        self.v
    }
}

pub trait RawOps {
    unsafe fn raw_op(&self) -> i32;
    unsafe fn raw_default(&self) -> i32 {
        0
    }
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "quals.rs", src);
    assert!(nat.contains("pub const fn add(a: i32, b: i32) -> i32"), "{nat}");
    assert!(nat.contains("pub unsafe fn deref_p(p: *const i32) -> i32"), "{nat}");
    assert!(nat.contains("pub extern \"C\" fn c_cb(x: i32) -> i32"), "{nat}");
    assert!(nat.contains("pub unsafe extern \"C\" fn c_deref(p: *const i32) -> i32"), "{nat}");
    assert!(nat.contains("pub const unsafe fn const_unsafe(x: i32) -> i32"), "{nat}");
    assert!(nat.contains("pub async unsafe fn async_raw(p: *const i32) -> i32"), "{nat}");
    assert!(nat.contains("pub const fn new(v: i32) -> Self"), "{nat}");
    assert!(nat.contains("pub unsafe fn read_ptr(p: *const i32) -> i32"), "{nat}");
    assert!(nat.contains("pub extern \"C\" fn abi_get(&self) -> i32"), "{nat}");
    assert!(nat.contains("unsafe fn raw_op(&self) -> i32;"), "{nat}");
    assert!(nat.contains("unsafe fn raw_default(&self) -> i32"), "{nat}");
}

#[test]
fn f180_cpp_constexpr_consteval_inline_2x() {
    let src = r#"constexpr int sq(int x) {
    return x * x;
}

consteval int cube(int x) {
    return x * x * x;
}

inline int twice(int x) {
    return x * 2;
}

inline constexpr int add_pair(int a, int b) {
    return a + b;
}

template <typename T>
constexpr T id(T x) {
    return x;
}

struct Calc {
    constexpr int mul(int a, int b) const {
        return a * b;
    }

    static constexpr int zero() {
        return 0;
    }

    inline int inc(int x) const {
        return x + 1;
    }

    consteval int tag() const {
        return 7;
    }
};

static_assert(sq(5) == 25);
static_assert(cube(3) == 27);
static_assert(add_pair(4, 6) == 10);
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Cpp, "quals.cpp", src);
    assert!(nat.contains("constexpr int sq(int x)"), "{nat}");
    assert!(nat.contains("consteval int cube(int x)"), "{nat}");
    assert!(nat.contains("inline int twice(int x)"), "{nat}");
    assert!(nat.contains("inline constexpr int add_pair(int a, int b)"), "{nat}");
    assert!(nat.contains("constexpr T id(T x)"), "{nat}");
    assert!(nat.contains("constexpr int mul(int a, int b) const"), "{nat}");
    assert!(nat.contains("static constexpr int zero()"), "{nat}");
    assert!(nat.contains("inline int inc(int x) const"), "{nat}");
    assert!(nat.contains("consteval int tag() const"), "{nat}");
    assert!(nat.contains("static_assert(sq(5) == 25);"), "{nat}");
}

#[test]
fn f181_rust_unsized_str_in_generics_2x() {
    let src = r#"use std::borrow::Cow;
use std::sync::Arc;

pub struct Holder<'a> {
    pub slice: &'a str,
    pub boxed: Box<str>,
    pub shared: Arc<str>,
    pub owned: String,
}

pub enum Text<'a> {
    Ref(&'a str),
    Boxed(Box<str>),
    Owned(String),
}

pub type StrBox = Box<str>;

pub struct TupleStr<'a>(pub &'a str, pub Box<str>, pub String);

pub fn f<T: AsRef<str>>(x: T, b: Box<str>) -> usize {
    let local_b: Box<str> = "hi".into();
    let local_a: Arc<str> = Arc::from("ok");
    let local_s: String = String::from("yes");
    let cl = |z: Box<str>| z.len();
    x.as_ref().len() + b.len() + local_b.len() + local_a.len() + local_s.len() + cl("x".into())
}

pub fn h<T>(x: T, d: Box<dyn AsRef<str>>) -> usize
where
    T: AsRef<str> + Clone,
{
    x.as_ref().len() + d.as_ref().as_ref().len()
}

pub fn g<'a>(s: &'a str, a: Arc<str>, c: Cow<'a, str>, owned: String) -> (Option<Box<str>>, Result<Arc<str>, String>) {
    let _ = (s, c);
    (Some(owned.into_boxed_str()), Ok(a))
}
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Rust, "str_generics.rs", src);
    assert!(nat.contains("pub type StrBox = Box<str>;"), "{nat}");
    assert!(nat.contains("pub struct TupleStr<'a>(pub &'a str, pub Box<str>, pub String);"), "{nat}");
    assert!(nat.contains("pub slice: &'a str,"), "{nat}");
    assert!(nat.contains("pub boxed: Box<str>,"), "{nat}");
    assert!(nat.contains("pub shared: Arc<str>,"), "{nat}");
    assert!(nat.contains("pub owned: String,"), "{nat}");
    assert!(nat.contains("Ref(&'a str),"), "{nat}");
    assert!(nat.contains("Boxed(Box<str>),"), "{nat}");
    assert!(nat.contains("Owned(String),"), "{nat}");
    assert!(nat.contains("pub fn f<T: AsRef<str>>(x: T, b: Box<str>) -> usize"), "{nat}");
    assert!(nat.contains("let local_b: Box<str> ="), "{nat}");
    assert!(nat.contains("let local_a: Arc<str> ="), "{nat}");
    assert!(nat.contains("let local_s: String ="), "{nat}");
    assert!(nat.contains("|z: Box<str>|"), "{nat}");
    assert!(nat.contains("Box<dyn AsRef<str>>"), "{nat}");
    assert!(nat.contains("T: AsRef<str> + Clone"), "{nat}");
    assert!(nat.contains("c: Cow<'a, str>, owned: String"), "{nat}");
    assert!(nat.contains("Option<Box<str>>"), "{nat}");
    assert!(nat.contains("Result<Arc<str>, String>"), "{nat}");
    assert!(!nat.contains("Box<String>"), "{nat}");
    assert!(!nat.contains("Arc<String>"), "{nat}");
    assert!(!nat.contains("AsRef<String>"), "{nat}");
    assert!(!nat.contains("Cow<'a, String>"), "{nat}");
}

#[test]
fn f182b_cpp_operator_overloading_2x() {
    let src = r#"#include <iostream>

struct Vec2 {
    int x;
    int y;

    constexpr Vec2 operator+(const Vec2& o) const {
        return Vec2{x + o.x, y + o.y};
    }

    constexpr bool operator==(const Vec2& o) const {
        return x == o.x && y == o.y;
    }

    int& operator[](int i) {
        return i == 0 ? x : y;
    }

    const int& operator[](int i) const {
        return i == 0 ? x : y;
    }

    Vec2& operator+=(const Vec2& o) {
        x += o.x;
        y += o.y;
        return *this;
    }

    int operator()(int a, int b) const {
        return x * a + y * b;
    }

    friend std::ostream& operator<<(std::ostream& os, const Vec2& v) {
        os << "(" << v.x << "," << v.y << ")";
        return os;
    }

    explicit operator bool() const {
        return x != 0 || y != 0;
    }

    Vec2 operator*(int s) const;
};

Vec2 Vec2::operator*(int s) const {
    return Vec2{x * s, y * s};
}

Vec2 operator-(const Vec2& a, const Vec2& b) {
    return Vec2{a.x - b.x, a.y - b.y};
}

struct Pt {
    int x;
    int y;
    bool operator==(const Pt& o) const = default;
};
"#;
    let (_aice, nat) = roundtrip_2x(LanguageId::Cpp, "ops.cpp", src);
    assert!(nat.contains("constexpr Vec2 operator+(const Vec2& o) const"), "{nat}");
    assert!(nat.contains("constexpr bool operator==(const Vec2& o) const"), "{nat}");
    assert!(nat.contains("int& operator[](int i)"), "{nat}");
    assert!(nat.contains("const int& operator[](int i) const"), "{nat}");
    assert!(nat.contains("Vec2& operator+=(const Vec2& o)"), "{nat}");
    assert!(nat.contains("int operator()(int a, int b) const"), "{nat}");
    assert!(nat.contains("friend std::ostream& operator<<(std::ostream& os, const Vec2& v)"), "{nat}");
    assert!(nat.contains("explicit operator bool() const"), "{nat}");
    assert!(nat.contains("Vec2 operator*(int s) const;"), "{nat}");
    assert!(nat.contains("Vec2 Vec2::operator*(int s) const"), "{nat}");
    assert!(nat.contains("Vec2 operator-(const Vec2& a, const Vec2& b)"), "{nat}");
    assert!(nat.contains("bool operator==(const Pt& o) const = default;"), "{nat}");
}
