use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn to_aice_str(lang: LanguageId, src: &str) -> String {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    print_aice(&m)
}

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
fn f65_kotlin_sealed_interface_nested_classes_and_companion_object() {
    let edge_kt = r#"package ledger

sealed interface Event {
    data class Credit(val id: String, val cents: Long = 0L) : Event
    data class Debit(val id: String, val cents: Long = 0L) : Event
}

fun describe(ev: Event, fallback: String? = null): String {
    val label = fallback ?: "unknown"
    return when (ev) {
        is Event.Credit -> "$label:+${ev.cents}"
        is Event.Debit -> "$label:-${ev.cents}"
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Kotlin, "EdgeKt.kt", edge_kt);
    assert!(!aice.contains("\n  pass\n"), "F-65 sealed interface erased to pass:\n{aice}");
    for expected in ["@sealed", "@interface", "class Event", "class Credit", "class Debit", "cents:Long = 0", "implements Event"] {
        assert!(aice.contains(expected), "F-65 AICE missing `{expected}`:\n{aice}");
    }
    for expected in [
        "sealed interface Event",
        "data class Credit(val id: String, val cents: Long = 0L) : Event",
        "data class Debit(val id: String, val cents: Long = 0L) : Event",
    ] {
        assert!(native.contains(expected), "F-65 native Kotlin missing `{expected}`:\n{native}");
    }

    let nested_kt = r#"class Outer {
    class Inner(val x: Int)
    companion object {
        const val TAG = "outer"
        fun make(): Outer = Outer()
    }
}

class Holder {
    val count: Int = 1
    object Singleton
    companion object Factory {
        val ID: Int = 42
    }
}
"#;
    let (aice2, native2) = roundtrip(LanguageId::Kotlin, "nested.kt", nested_kt);
    assert!(!aice2.contains("class Outer:\n  pass"), "F-65 Outer erased to pass:\n{aice2}");
    assert!(!aice2.contains("class Holder:\n  pass"), "F-65 Holder erased to pass:\n{aice2}");
    for expected in ["class Outer", "class Inner(x:int)", "TAG = \"outer\"", "fn make() -> Outer", "class Singleton", "ID:int = 42"] {
        assert!(aice2.contains(expected), "F-65 nested AICE missing `{expected}`:\n{aice2}");
    }
    for expected in [
        "class Outer {",
        "class Inner(val x: Int)",
        "companion object {",
        "const val TAG = \"outer\"",
        "fun make(): Outer",
        "object Singleton",
        "companion object Factory {",
    ] {
        assert!(native2.contains(expected), "F-65 nested native Kotlin missing `{expected}`:\n{native2}");
    }
}

#[test]
fn f66_java_nested_record_and_nested_types_preserved() {
    let edge_java = r#"package com.example.ledger;

import java.util.List;

public class EdgeJava {
    public record Tx(String id, int amount) {}

    public static class Detail {
        private final String note;
        public Detail(String note) { this.note = note; }
    }

    public interface Hook {
        void onTx(Tx tx);
    }

    public enum Status {
        OPEN,
        CLOSED
    }

    public int totalPositive(List<Tx> txs) {
        int mask = 0xFF;
        mask ^= 0x0F;
        int sum = txs.stream()
            .filter(t -> t.amount() > 0)
            .mapToInt(Tx::amount)
            .sum();
        return sum + (mask & 0x0F);
    }
}
"#;
    let (aice, native) = roundtrip(LanguageId::Java, "EdgeJava.java", edge_java);
    for expected in [
        "class EdgeJava",
        "@nested(EdgeJava)",
        "@record",
        "pub class Tx(id:str, amount:int)",
        "pub class Detail",
        "pub interface Hook",
        "pub enum Status",
        "OPEN",
        "CLOSED",
    ] {
        assert!(aice.contains(expected), "F-66 AICE missing `{expected}`:\n{aice}");
    }
    for expected in ["public record Tx(String id, int amount)", "public class Detail", "public interface Hook", "public enum Status"] {
        assert!(native.contains(expected), "F-66 native Java missing `{expected}`:\n{native}");
    }
}

#[test]
fn f68_go_generic_type_params_and_struct_tags() {
    // 1. Exact edge_go.go repro decompile fidelity
    let edge_go = r#"package ledger

type Entry struct {
	ID, Tenant string `json:"id"`
	Amount, Fee int64
}

func MapSlice[T any, U any](xs []T, fn func(T) U) []U {
	out := make([]U, 0, len(xs))
	for _, x := range xs {
		out = append(out, fn(x))
	}
	return out
}

func ApplyFlags(base, clearMask uint64, extras ...uint64) uint64 {
	v := base &^ clearMask
	for _, e := range extras {
		v |= e
	}
	return ^v
}
"#;
    let edge_aice = to_aice_str(LanguageId::Go, edge_go);
    for expected in [
        "@tag(`json:\"id\"`)",
        "pub fn MapSlice[T: any, U: any]",
        "...extras:uint64",
    ] {
        assert!(edge_aice.contains(expected), "F-68 edge_go AICE missing `{expected}`:\n{edge_aice}");
    }

    // 2. Full roundtrip (decompile -> print_aice -> parse_aice -> to_native -> SyntaxFirewall)
    let go_rt = r#"package ledger

type Entry struct {
	ID, Tenant string `json:"id"`
	Amount, Fee int64
}

type Box[T any, U comparable] struct {
	Value T `json:"value,omitempty"`
	Key   U `json:"key"`
}

func (b *Box[T, U]) Get() T {
	return b.Value
}

func MapPair[T any, U any](a T, b U, fn func(T) U) U {
	return fn(a)
}

func ApplyFlags(base, clearMask uint64, extras ...uint64) uint64 {
	v := base &^ clearMask
	for _, e := range extras {
		v |= e
	}
	return ^v
}
"#;
    let (aice, native) = roundtrip(LanguageId::Go, "go_generics.go", go_rt);
    for expected in [
        "@tag(`json:\"id\"`)",
        "@tag(`json:\"value,omitempty\"`)",
        "pub class Box[T: any, U: comparable]:",
        "pub fn MapPair[T: any, U: any]",
    ] {
        assert!(aice.contains(expected), "F-68 Go AICE missing `{expected}`:\n{aice}");
    }
    for expected in [
        "ID string `json:\"id\"`",
        "Tenant string `json:\"id\"`",
        "type Box[T any, U comparable] struct",
        "Value T `json:\"value,omitempty\"`",
        "func (r *Box[T, U]) Get() T",
        "func MapPair[T any, U any]",
    ] {
        assert!(native.contains(expected), "F-68 Go native missing `{expected}`:\n{native}");
    }
}

#[test]
fn f69_python_variadic_no_double_sigil() {
    let py = r#"from typing import Any

@trace("eval")
def classify_payload(data: dict[str, Any], *extra: int, strict: bool = False, **meta: str) -> dict[str, Any]:
    return data

def wrapper(a: int, /, *args, **kwargs):
    return a

def typed_splats(*args: Any, **kwargs: Any) -> Any:
    return args
"#;
    let (aice, native) = roundtrip(LanguageId::Python, "variadic.py", py);
    assert!(!aice.contains("...*"), "F-69 Python double sigil `...*` leaked:\n{aice}");
    assert!(!aice.contains("...**"), "F-69 Python double sigil `...**` leaked:\n{aice}");
    assert!(aice.contains("...extra:int"), "F-69 Python missing `...extra:int`:\n{aice}");
    assert!(aice.contains("...meta:str"), "F-69 Python missing `...meta:str`:\n{aice}");
    assert!(aice.contains("...args, ...kwargs"), "F-69 Python missing untyped variadics:\n{aice}");
    assert!(aice.contains("...args:any, ...kwargs:any"), "F-69 Python missing typed splats:\n{aice}");
    assert!(native.contains("def classify_payload("), "F-69 Python native missing fn:\n{native}");
}

#[test]
fn f69_rust_generics_lifetimes_and_where_clauses() {
    let rs = r#"use std::fmt::Display;

pub struct Holder<'a, T: Display + 'a>
where
    T: Clone,
{
    pub label: &'a str,
    pub item: T,
}

impl<'a, T: Display + 'a> Holder<'a, T>
where
    T: Clone,
{
    pub fn item_ref(&self) -> &T {
        &self.item
    }
}

pub fn apply_hrtb<F>(s: &str, f: F) -> usize
where
    F: for<'a> Fn(&'a str) -> usize,
{
    f(s)
}

pub async fn process_records<'a, T: Display + Clone>(
    items: &'a [Option<i32>],
    val: T,
) -> Result<u64, String> {
    Ok(0)
}

pub enum Either<L, R = ()>
where
    L: Clone,
{
    Left(L),
    Right(R),
}

pub trait Mapper<I>: Sized
where
    I: Clone,
{
    fn map_one(&self, x: I) -> I;
}

pub type Pair<A, B> = (A, B);
"#;
    let (aice, native) = roundtrip(LanguageId::Rust, "generics.rs", rs);
    for expected in [
        "@lifetimes(\"'a\")",
        "pub class Holder[T: Display + \"'a\" + Clone]:",
        "pub fn apply_hrtb[F: \"for<'a> Fn(&'a str) -> usize\"]",
        "pub async fn process_records[T: Display + Clone]",
        "pub enum Either[L: Clone, R = void]:",
        "pub trait Mapper[I: Clone] extends Sized:",
        "pub type Pair[A, B] =",
    ] {
        assert!(aice.contains(expected), "F-69 Rust AICE missing `{expected}`:\n{aice}");
    }
    assert!(native.contains("pub struct Holder"), "F-69 Rust native missing Holder:\n{native}");
    assert!(native.contains("pub fn apply_hrtb"), "F-69 Rust native missing apply_hrtb:\n{native}");

    // Verify complex non-type-param where predicates survive too
    let rs_complex_where = r#"pub struct Wrap<T>
where
    T: Iterator,
    T::Item: Send,
{
    pub inner: T,
}
"#;
    let (cw_aice, _) = roundtrip(LanguageId::Rust, "complex_where.rs", rs_complex_where);
    assert!(cw_aice.contains("Wrap[T: Iterator]") && cw_aice.contains("@where(\"T::Item: Send\")"), "F-69 complex where lost:\n{cw_aice}");
}

#[test]
fn f73_go_two_var_range_and_polyglot_multi_var_loops() {
    let go = r#"package p

func sumAll(xs []int, m map[string]int) int {
	s := 0
	for i, x := range xs {
		s += i + x
	}
	for k, v := range m {
		s += len(k) + v
	}
	for _, y := range xs {
		s += y
	}
	return s
}
"#;
    let (go_aice, go_nat) = roundtrip(LanguageId::Go, "go_range.go", go);
    assert!(go_aice.contains("for (i, x) in xs:"), "F-73 Go lost index var `i`:\n{go_aice}");
    assert!(go_aice.contains("for (k, v) in m:"), "F-73 Go lost key var `k`:\n{go_aice}");
    assert!(go_aice.contains("for y in xs:"), "F-73 Go blank index should stay compact:\n{go_aice}");
    assert!(go_nat.contains("for i, x := range xs {"), "F-73 Go native lost `i, x`:\n{go_nat}");
    assert!(go_nat.contains("for k, v := range m {"), "F-73 Go native lost `k, v`:\n{go_nat}");
    assert!(go_nat.contains("for _, y := range xs {"), "F-73 Go native lost `_, y`:\n{go_nat}");

    let py = r#"def sum_map(items):
    total = 0
    for k, v in items:
        total += k + v
    return total
"#;
    let (py_aice, py_nat) = roundtrip(LanguageId::Python, "py_for.py", py);
    assert!(py_aice.contains("for (k, v) in items:"), "F-73 Python lost multi-var loop:\n{py_aice}");
    assert!(py_nat.contains("for (k, v) in items:"), "F-73 Python native lost multi-var loop:\n{py_nat}");

    let rs = r#"pub fn sum_idx(xs: &[usize]) -> usize {
    let mut s = 0;
    for (i, x) in xs.iter().enumerate() {
        s += i + *x;
    }
    s
}
"#;
    let (rs_aice, rs_nat) = roundtrip(LanguageId::Rust, "rs_for.rs", rs);
    assert!(rs_aice.contains("for (i, x) in xs.iter().enumerate():"), "F-73 Rust lost tuple loop:\n{rs_aice}");
    assert!(rs_nat.contains("for (i, x) in xs.iter().enumerate() {"), "F-73 Rust native lost tuple loop:\n{rs_nat}");

    let php = r#"<?php
function sumAssoc($m) {
    $s = 0;
    foreach ($m as $k => $v) {
        $s += $k + $v;
    }
    return $s;
}
"#;
    let (php_aice, php_nat) = roundtrip(LanguageId::Php, "php_for.php", php);
    assert!(php_aice.contains("for (k, v) in $m:"), "F-73 PHP lost key var `$k`:\n{php_aice}");
    assert!(php_nat.contains("foreach ($m as $k => $v) {"), "F-73 PHP native lost `$k => $v`:\n{php_nat}");
}
