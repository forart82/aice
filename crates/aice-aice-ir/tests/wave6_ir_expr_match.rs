use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn decompile_and_compile(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let native = tr.to_native(&m, lang).unwrap_or_else(|e| {
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
fn f61_prefixed_raw_byte_verbatim_strings_never_double_wrapped() {
    let rs = r###"pub const SIMPLE: &str = r"simple";
pub const QUOTED: &str = r#"a "b" c"#;
pub const DOUBLE_RAW: &str = r##"has "# inside raw string"##;
pub const BYTES: &[u8] = b"\x00\xffhello";
pub const RAW_BYTES: &[u8] = br#"raw "bytes""#;

pub fn demo() -> usize {
    let raw = r#"hello "quoted" \n // not a comment"#;
    raw.len()
}
"###;
    let (rs_aice, rs_nat) = roundtrip(LanguageId::Rust, "raw.rs", rs);
    for bad in ["= \"r\\\"", "= \"r#\\\"", "= \"r##\\\"", "= \"b\\\"", "= \"br#\\\"", ":= \"r#\\\""] {
        assert!(!rs_aice.contains(bad), "Rust string double-wrapped ({bad}):\n{rs_aice}");
    }
    assert!(rs_aice.contains("SIMPLE:\"&str\" = \"simple\""), "{rs_aice}");
    assert!(rs_aice.contains("QUOTED:\"&str\" = \"a \\\"b\\\" c\""), "{rs_aice}");
    assert!(rs_aice.contains("DOUBLE_RAW:\"&str\" = \"has \\\"# inside raw string\""), "{rs_aice}");
    assert!(rs_aice.contains("BYTES:\"&[u8]\" = raw \"b\\\"\\\\x00\\\\xffhello\\\"\""), "{rs_aice}");
    assert!(rs_aice.contains("RAW_BYTES:\"&[u8]\" = raw \"br#\\\"raw \\\"bytes\\\"\\\"#\""), "{rs_aice}");
    assert!(rs_aice.contains("raw := \"hello \\\"quoted\\\" \\\\n // not a comment\""), "{rs_aice}");
    assert!(rs_nat.contains("\"a \\\"b\\\" c\""), "{rs_nat}");
    assert!(rs_nat.contains("b\"\\x00\\xffhello\""), "{rs_nat}");
    assert!(rs_nat.contains("br#\"raw \"bytes\"\"#"), "{rs_nat}");

    let py = r#####"import re

_RGB_FUNC_RE = re.compile(r"^rgba?\((\d+)\)")
SINGLE_RAW = r'single\d+'
TRIPLE_RAW = r"""triple "raw" text"""
TRIPLE_SQ = r'''triple 'sq' text'''
BYTE_S = b"hello"
RB_S = rb"\s+"
BR_S = br'\w+'
UNI_S = u"unicode"

def fmt(x: int) -> str:
    return fr"val={x}"
"#####;
    let (py_aice, py_nat) = roundtrip(LanguageId::Python, "raw.py", py);
    for bad in ["::= \"r\\\"", "::= \"r'", "::= \"r\\\"\\\"\\\"", "::= \"b\\\"", "::= \"rb\\\"", "::= \"br'", "::= \"u\\\""] {
        assert!(!py_aice.contains(bad), "Python string double-wrapped ({bad}):\n{py_aice}");
    }
    assert!(py_aice.contains("re.compile(\"^rgba?\\\\((\\\\d+)\\\\)\")"), "{py_aice}");
    assert!(py_aice.contains("SINGLE_RAW ::= \"single\\\\d+\""), "{py_aice}");
    assert!(py_aice.contains("TRIPLE_RAW ::= \"triple \\\"raw\\\" text\""), "{py_aice}");
    assert!(py_aice.contains("TRIPLE_SQ ::= \"triple 'sq' text\""), "{py_aice}");
    assert!(py_aice.contains("BYTE_S ::= raw \"b\\\"hello\\\"\""), "{py_aice}");
    assert!(py_aice.contains("RB_S ::= raw \"rb\\\"\\\\s+\\\"\""), "{py_aice}");
    assert!(py_aice.contains("BR_S ::= raw \"br'\\\\w+'\""), "{py_aice}");
    assert!(py_aice.contains("UNI_S ::= raw \"u\\\"unicode\\\"\""), "{py_aice}");
    assert!(py_aice.contains("`val=${x}`"), "{py_aice}");
    assert!(py_nat.contains("f\"val={x}\""), "{py_nat}");
    assert!(py_nat.contains("b\"hello\"") && py_nat.contains("rb\"\\s+\"") && py_nat.contains("br'\\w+'") && py_nat.contains("u\"unicode\""), "{py_nat}");

    let cs = r#"public class Paths {
    public string GetPath() {
        var p = @"C:\foo\bar";
        var q = @"say ""hi""";
        return p + q;
    }
}
"#;
    let (cs_aice, cs_nat) = roundtrip(LanguageId::CSharp, "Paths.cs", cs);
    assert!(!cs_aice.contains("\"@\\\""), "C# verbatim double-wrapped:\n{cs_aice}");
    assert!(cs_aice.contains("\"C:\\\\foo\\\\bar\""), "{cs_aice}");
    assert!(cs_aice.contains("\"say \\\"hi\\\"\""), "{cs_aice}");
    assert!(cs_nat.contains("\"C:\\\\foo\\\\bar\""), "{cs_nat}");

    let cpp_raw = r###"const char* raw_demo() {
    const char* a = R"(raw "cpp" text)";
    const char* b = R"delim(a ) b)delim";
    return a ? a : b;
}
"###;
    let (cpp_aice, _) = decompile_and_compile(LanguageId::Cpp, "raw.cpp", cpp_raw);
    assert!(!cpp_aice.contains("\"R\\\""), "C++ raw string double-wrapped:\n{cpp_aice}");
    assert!(cpp_aice.contains("\"raw \\\"cpp\\\" text\""), "{cpp_aice}");
    assert!(cpp_aice.contains("\"a ) b\""), "{cpp_aice}");
}

#[test]
fn f62_rust_wildcard_closure_and_cpp_lambda_params() {
    let rs = r#"pub fn count_all(xs: &[i32]) -> usize {
    let a = xs.iter().map(|_| 1).count();
    let b = xs.iter().fold(0, |_, x| *x);
    let c = xs.iter().map(|_: &i32| 2).count();
    let d = || 0usize;
    let scale = move |x: u64| -> u64 { (x + 1) * 3 };
    a + (b as usize) + c + d() + (scale(1) as usize)
}
"#;
    let (rs_aice, rs_nat) = roundtrip(LanguageId::Rust, "closures.rs", rs);
    assert!(rs_aice.contains("map(fn(_) = 1)"), "Rust |_| dropped:\n{rs_aice}");
    assert!(!rs_aice.contains("map(fn() = 1)"), "Rust |_| degraded to 0-arg fn():\n{rs_aice}");
    assert!(rs_aice.contains("fold(0, fn(_, x) = *x)"), "Rust |_, x| dropped:\n{rs_aice}");
    assert!(rs_aice.contains("fn(_: \"&i32\") = 2"), "Rust typed wildcard dropped:\n{rs_aice}");
    assert!(rs_aice.contains("d := fn() = 0usize"), "Rust 0-arg closure regressed:\n{rs_aice}");
    assert!(rs_aice.contains("fn(x: u64) -> u64"), "Rust typed closure regressed:\n{rs_aice}");
    assert!(rs_nat.contains(".map(|_| 1)"), "Rust native lost |_|:\n{rs_nat}");
    assert!(rs_nat.contains(".fold(0, |_, x| *x)"), "Rust native lost |_, x|:\n{rs_nat}");

    let cpp = r#"#include <cstdint>
#include <vector>

namespace math {

template <typename T, std::size_t N>
class RingBuffer {
public:
    T fold_xor(T seed) const noexcept {
        T acc = seed;
        auto combine = [&](const T& item) noexcept -> T {
            return (acc ^ item) + 1;
        };
        auto add_def = [=](int a, int b = 2) {
            return a + b;
        };
        auto zero = []() {
            return 0;
        };
        auto bare = [&] {
            return acc;
        };
        for (const auto& item : data_) {
            acc ^= combine(item);
        }
        return acc + add_def(1) + zero() + bare();
    }

private:
    std::vector<T> data_;
};

}
"#;
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "ring.cpp", cpp);
    assert!(
        cpp_aice.contains("combine:auto := fn(item: \"const T&\") -> T { ret (acc ^ item) + 1 }"),
        "C++ lambda param/return/body dropped:\n{cpp_aice}"
    );
    assert!(!cpp_aice.contains("combine:auto := fn()"), "C++ lambda degraded to fn():\n{cpp_aice}");
    assert!(cpp_aice.contains("fn(a: int, b: int = 2) { ret a + b }"), "{cpp_aice}");
    assert!(cpp_aice.contains("zero:auto ::= fn() { ret 0 }"), "{cpp_aice}");
    assert!(cpp_aice.contains("bare:auto ::= fn() { ret acc }"), "{cpp_aice}");
    assert!(cpp_nat.contains("[&](const T& item) -> T { return (acc ^ item) + 1; }"), "{cpp_nat}");
}

#[test]
fn f63_c_cpp_switch_php8_match_python_match_case() {
    let c_src = r#"typedef struct { int kind; int ptr; } AiplVal;

static AiplVal aipl_to_str_depth(AiplVal v, int depth) {
  switch (v.kind) {
    case AIPL_MAP: return aipl_map_to_str_depth(v, depth);
    case AIPL_ARRAY: return aipl_array_to_str_depth(v, depth);
    case AIPL_RES_OK:
      return v.ptr ? aipl_to_str_depth(v, depth) : aipl_str_lit("Ok");
    case AIPL_RES_ERR:
      return v.ptr ? aipl_to_str_depth(v, depth) : aipl_str_lit("Err");
    case AIPL_OPT_SOME:
      return v.ptr ? aipl_to_str_depth(v, depth) : aipl_str_lit("Some");
    default:
      return aipl_to_str(v);
  }
}

int classify_code(int code) {
  int out = 0;
  switch (code) {
    case 1:
    case 2:
      out = 10;
      break;
    case 3: {
      out = 30;
      break;
    }
    default:
      out = -1;
      break;
  }
  return out;
}
"#;
    let (c_aice, c_nat) = roundtrip(LanguageId::C, "rt_core.c", c_src);
    for expected in [
        "AIPL_MAP => {",
        "AIPL_ARRAY => {",
        "AIPL_RES_OK => {",
        "AIPL_RES_ERR => {",
        "AIPL_OPT_SOME => {",
        "_ => {",
        "1 | 2 => {",
        "3 => {",
        "ret aipl_map_to_str_depth(v, depth)",
        "ret aipl_to_str(v)",
    ] {
        assert!(c_aice.contains(expected), "C switch lost `{expected}`:\n{c_aice}");
    }
    assert!(c_nat.contains("case AIPL_MAP:") && c_nat.contains("default:"), "{c_nat}");

    let cpp_src = r#"int route(int x) {
    switch (x) {
        case 1: return 10;
        case 2:
        case 3: return 20;
        default: return 0;
    }
}
"#;
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "route.cpp", cpp_src);
    for expected in ["1 => {", "ret 10", "2 | 3 => {", "ret 20", "_ => {", "ret 0"] {
        assert!(cpp_aice.contains(expected), "C++ switch lost `{expected}`:\n{cpp_aice}");
    }
    assert!(cpp_nat.contains("case 1:") && cpp_nat.contains("case 2:") && cpp_nat.contains("default:"), "{cpp_nat}");

    let php_src = r#"<?php
class Pricer {
    public function compute(float $base, Tier $t, int $code): array {
        $mult = match ($t) {
            Tier::Pro => 0.85,
            Tier::Standard => 1.0,
        };
        $label = match ($code) {
            200, 201 => 'ok',
            404 => 'not_found',
            default => 'err',
        };
        return ['net' => $base * $mult, 'label' => $label];
    }
}
"#;
    let (php_aice, php_nat) = roundtrip(LanguageId::Php, "pricer.php", php_src);
    assert!(!php_aice.contains("match $t: {  }"), "PHP match arms still erased:\n{php_aice}");
    assert!(php_aice.contains("Tier::Pro => 0.85"), "{php_aice}");
    assert!(php_aice.contains("Tier::Standard => 1.0"), "{php_aice}");
    assert!(php_aice.contains("200 | 201 => \"ok\""), "{php_aice}");
    assert!(php_aice.contains("404 => \"not_found\""), "{php_aice}");
    assert!(php_aice.contains("_ => \"err\""), "{php_aice}");
    assert!(php_nat.contains("Tier::Pro") && php_nat.contains("0.85") && php_nat.contains("\"not_found\""), "{php_nat}");

    let py_src = r#"def classify(kind: str, strict: bool, count: int, pt) -> str:
    status = "init"
    match kind:
        case "metric" if strict:
            status = "strict_metric"
        case "metric" | "event" | "trace":
            status = "telemetry"
        case _:
            status = "unknown"
    match pt:
        case Point(x, y):
            status = "point"
        case _:
            pass
    match count:
        case 0:
            return "empty"
        case n if n > 5:
            return status
        case _:
            return "small"
"#;
    let (py_aice, py_nat) = roundtrip(LanguageId::Python, "match_py.py", py_src);
    for expected in [
        "\"metric\" if strict => {",
        "\"metric\" | \"event\" | \"trace\" => {",
        "Point(x, y) => {",
        "0 => {",
        "n if n > 5 => {",
        "_ => {",
    ] {
        assert!(py_aice.contains(expected), "Python match lost `{expected}`:\n{py_aice}");
    }
    for expected in [
        "case \"metric\" if strict:",
        "case \"metric\" | \"event\" | \"trace\":",
        "case Point(x, y):",
        "case 0:",
        "case n if n > 5:",
        "case _:",
    ] {
        assert!(py_nat.contains(expected), "Python native match lost `{expected}`:\n{py_nat}");
    }
}

#[test]
fn f64_python_walrus_parens_and_assign_in_comparison_preserved() {
    let py_src = r#"def walrus_check(data: list[int], needle: int) -> int:
    total = 0
    if (count := len(data)) > 0 and needle not in data:
        total += count
    while (chunk := read_next()) != "":
        total += len(chunk)
    summed = (a := first_val()) + (b := second_val())
    if not (found := len(data)):
        return -1
    return total + summed
"#;
    let (py_aice, py_nat) = decompile_and_compile(LanguageId::Python, "walrus.py", py_src);
    assert!(
        py_aice.contains("if (count := len(data)) > 0 and needle not in data:"),
        "Python walrus dropped parens in AICE:\n{py_aice}"
    );
    assert!(
        !py_aice.contains("if count := len(data) > 0"),
        "Python walrus precedence corrupted in AICE:\n{py_aice}"
    );
    assert!(py_aice.contains("while (chunk := read_next()) != \"\":"), "{py_aice}");
    assert!(py_aice.contains("summed = (a := first_val()) + (b := second_val())"), "{py_aice}");
    assert!(py_aice.contains("if not (found := len(data)):"), "{py_aice}");
    assert!(
        py_nat.contains("if (count := len(data)) > 0 and needle not in data:"),
        "Python walrus dropped parens in native:\n{py_nat}"
    );
    assert!(py_nat.contains("while (chunk := read_next()) != \"\":"), "{py_nat}");
    assert!(py_nat.contains("summed = (a := first_val()) + (b := second_val())"), "{py_nat}");
    assert!(py_nat.contains("if not (found := len(data)):"), "{py_nat}");

    // C assignment-in-comparison also preserves parens across full roundtrip
    let c_src = r#"int read_nonzero(int x) {
    int c = 0;
    if ((c = next_val(x)) != 0) {
        return c;
    }
    return 0;
}
"#;
    let (c_aice, c_nat) = roundtrip(LanguageId::C, "assign_cmp.c", c_src);
    assert!(c_aice.contains("if (c = next_val(x)) != 0:"), "{c_aice}");
    assert!(c_nat.contains("if ((c = next_val(x)) != 0)"), "{c_nat}");
}

#[test]
fn f67_tsx_destructured_props_and_params_stay_bound() {
    let tsx = r#"import React, { useState, useMemo, useCallback } from "react";

interface Item { id: string; label: string; active: boolean }
interface Props { items: Item[]; onPick: (id: string) => void }

export function FilterList({ items, onPick }: Props) {
  const [query, setQuery] = useState("");
  const filtered = useMemo(
    () => items.filter((it) => it.active && it.label.toLowerCase().includes(query.toLowerCase())),
    [items, query]
  );
  const handleSelect = useCallback((id: string) => {
    if (!id) return;
    onPick(id);
  }, [onPick]);

  if (filtered.length === 0) {
    return <div className="empty">No matches</div>;
  }
  return (
    <>
      <input value={query} onChange={(e) => setQuery(e.target.value)} />
      <ul>
        {filtered.map((it) => (
          <li key={it.id} onClick={() => handleSelect(it.id)}>{it.label}</li>
        ))}
      </ul>
    </>
  );
}

export function Badge({ label, count = 0 }: { label: string; count?: number }) {
  return <span>{label}: {count}</span>;
}

export function StatusCard(props: { title: string }) {
  return <section><h2>{props.title}</h2></section>;
}
"#;
    let (aice, native) = roundtrip(LanguageId::Tsx, "FilterList.tsx", tsx);
    assert!(
        aice.contains("{ items, onPick } := props"),
        "TSX FilterList dropped destructured prop bindings:\n{aice}"
    );
    assert!(
        aice.contains("{ label, count = 0 } := props"),
        "TSX Badge dropped destructured prop bindings:\n{aice}"
    );
    assert!(
        native.contains("const { items, onPick } = props;"),
        "Compiled TSX FilterList left items/onPick unbound:\n{native}"
    );
    assert!(
        native.contains("const { label, count = 0 } = props;"),
        "Compiled TSX Badge left label/count unbound:\n{native}"
    );
    // Non-destructured component StatusCard must NOT get a synthetic destructure statement
    let status_idx = aice.find("pub component StatusCard(").expect("StatusCard missing");
    assert!(
        !aice[status_idx..].contains(":= props"),
        "Non-destructured StatusCard got spurious binding:\n{aice}"
    );

    // Regular TS function + method + closure with destructured object/array params
    let ts = r#"export function sumPair({ a, b }: { a: number; b: number }, [x, y]: [number, number]): number {
  const f = ({ k }: { k: number }) => k + 1;
  return a + b + x + y + f({ k: 1 });
}
"#;
    let (ts_aice, ts_nat) = roundtrip(LanguageId::TypeScript, "destruct.ts", ts);
    assert!(ts_aice.contains("{ a, b } := arg0"), "{ts_aice}");
    assert!(ts_aice.contains("[x, y] := arg1"), "{ts_aice}");
    assert!(ts_aice.contains("{ k } := arg0"), "{ts_aice}");
    assert!(ts_nat.contains("const { a, b } = arg0;"), "{ts_nat}");
    assert!(ts_nat.contains("const [x, y] = arg1;"), "{ts_nat}");
}
