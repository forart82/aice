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

fn roundtrip_2x(lang: LanguageId, vname: &str, src: &str) -> (String, String, String, String) {
    let (a1, n1) = roundtrip(lang, vname, src);
    let (a2, n2) = roundtrip(lang, vname, &n1);
    assert_eq!(a1, a2, "{vname} AICE 2x mismatch:\n{a1}\n---\n{a2}");
    assert_eq!(n1, n2, "{vname} native 2x mismatch:\n{n1}\n---\n{n2}");
    (a1, n1, a2, n2)
}

fn has_tool(name: &str) -> bool {
    Command::new("which").arg(name).output().is_ok_and(|o| o.status.success())
}

#[test]
fn f153_go_multi_target_decls_assigns_and_nil_rhs_2x() {
    let src = r#"package main

import (
	"fmt"
	"os"
)

func split(n int) (int, int) {
	return n / 2, n % 2
}

func makePair() (int, error) {
	x, err := 1, error(nil)
	return x, err
}

func main() {
	tmp := os.TempDir()
	_, statErr := os.Stat(tmp)
	m := map[string]int{"a": 42}
	v, ok := m["a"]
	p, q := split(9)
	a, b := 10, 20
	a, b = b, a
	xs := []int{1, 2}
	xs[0], xs[1] = xs[1], xs[0]
	var c, d = 3, 4
	var e int
	e = c + d
	n, err := makePair()
	z, nilErr := 7, error(nil)
	var k, nilErr2 error = nil, nil
	_ = statErr
	_ = err
	_ = nilErr
	_ = k
	_ = nilErr2
	fmt.Printf("%d|%v|%d|%d|%d|%d|%d|%d|%d|%d|%d\n", v, ok, p, q, a, b, xs[0], xs[1], e, n, z)
}
"#;
    let (a1, n1, _, n2) = roundtrip_2x(LanguageId::Go, "f153_go.go", src);
    for exp in [
        "v, ok ::= m[\"a\"]",
        "p, q ::= split(9)",
        "a, b = b, a",
        "var c, d = 3, 4",
        "xs[0], xs[1] = xs[1], xs[0]",
    ] {
        assert!(a1.contains(exp), "Go AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "v, ok := m[\"a\"]",
        "p, q := split(9)",
        "a, b = b, a",
        "var c, d = 3, 4",
        "var e int",
        "xs[0], xs[1] = xs[1], xs[0]",
    ] {
        assert!(n2.contains(exp), "Go native missing `{exp}`:\n{n2}");
    }
    // Also verify bare `x, err := 1, nil` parses & compiles cleanly in IR
    let bare_nil = "module p\npub fn F():\n  x, err ::= 1, nil\n  _ = x\n  _ = err\n";
    let m_nil = parse_aice(bare_nil).expect("parse x, err ::= 1, nil");
    let go_nil = DefaultAiceTranspiler.to_native(&m_nil, LanguageId::Go).unwrap();
    assert!(go_nil.contains("x, err := 1, nil"), "Go bare nil RHS broken:\n{go_nil}");

    if has_tool("go") {
        let dir = std::env::temp_dir().join(format!("aice_w18_f153_go_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("main.go");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("go").args(["run", fp.to_str().unwrap()]).output().expect("go run");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "go run failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "42|true|4|1|20|10|2|1|7|1|7");
    }
}

#[test]
fn f153_python_and_ruby_multi_target_unpack_and_swap_2x() {
    let py = r#"class Box:
    def __init__(self, p):
        self.x, self.y = p

def run(p, xs):
    a, b = p
    a, b = b, a
    c, d = 1, 2
    head, *rest = xs
    *init, last = xs
    arr = [10, 20]
    arr[0], arr[1] = arr[1], arr[0]
    u, v = None, True
    box = Box((7, 8))
    return f"{a}|{b}|{c}|{d}|{head}|{rest}|{init}|{last}|{arr[0]}|{u}|{v}|{box.x}|{box.y}"

print(run((3, 5), [1, 2, 3, 4]))
"#;
    let (py_a1, py_n1, _, py_n2) = roundtrip_2x(LanguageId::Python, "f153_py.py", py);
    for exp in ["a, b = p", "a, b = b, a", "c, d = 1, 2", "head, *rest = xs", "*init, last = xs"] {
        assert!(py_a1.contains(exp), "Py AICE missing `{exp}`:\n{py_a1}");
        assert!(py_n2.contains(exp), "Py native missing `{exp}`:\n{py_n2}");
    }
    if has_tool("python3") {
        let out = Command::new("python3").args(["-c", &py_n1]).output().expect("python3");
        assert!(out.status.success(), "python3 failed: {}\n{py_n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(
            String::from_utf8_lossy(&out.stdout).trim(),
            "5|3|1|2|1|[2, 3, 4]|[1, 2, 3]|4|20|None|True|7|8"
        );
    }

    let rb = r##"class Pair
  def initialize(p)
    @x, @y = p
  end

  def sum
    @x + @y
  end
end

def run(p, xs)
  a, b = p
  a, b = b, a
  c, d = 1, 2
  head, *rest = xs
  pr = Pair.new([6, 7])
  "#{a}|#{b}|#{c}|#{d}|#{head}|#{rest.length}|#{pr.sum}"
end

puts run([3, 5], [10, 20, 30])
"##;
    let (rb_a1, rb_n1, _, rb_n2) = roundtrip_2x(LanguageId::Ruby, "f153_rb.rb", rb);
    for exp in ["a, b = p", "a, b = b, a", "c, d = 1, 2", "head, *rest = xs", "@x, @y = p"] {
        assert!(rb_a1.contains(exp), "Rb AICE missing `{exp}`:\n{rb_a1}");
        assert!(rb_n2.contains(exp), "Rb native missing `{exp}`:\n{rb_n2}");
    }
    if has_tool("ruby") {
        let out = Command::new("ruby").args(["-e", &rb_n1]).output().expect("ruby");
        assert!(out.status.success(), "ruby failed: {}\n{rb_n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "5|3|1|2|10|2|13");
    }
}

#[test]
fn f154_go_if_and_switch_initializers_2x() {
    let src = r#"package main

import (
	"errors"
	"fmt"
)

func doWork(fail bool) error {
	if fail {
		return errors.New("boom")
	}
	return nil
}

func checkIf(fail bool, m map[string]int, k string) int {
	if err := doWork(fail); err != nil {
		return -1
	} else if v, ok := m[k]; ok {
		return v
	}
	if v, ok := m["fallback"]; ok {
		return v
	}
	return 0
}

func checkSwitch(x int) int {
	switch y := x + 1; y {
	case 2:
		return 10
	case 5:
		return 50
	default:
		return y * 3
	}
}

func main() {
	m := map[string]int{"a": 42, "fallback": 7}
	fmt.Printf("%d|%d|%d|%d|%d|%d\n",
		checkIf(true, m, "a"),
		checkIf(false, m, "a"),
		checkIf(false, m, "miss"),
		checkSwitch(1),
		checkSwitch(4),
		checkSwitch(2),
	)
}
"#;
    let (a1, n1, _, n2) = roundtrip_2x(LanguageId::Go, "f154_go.go", src);
    for exp in [
        "if err := doWork(fail); err != nil:",
        "elif v, ok := m[k]; ok:",
        "if v, ok := m[\"fallback\"]; ok:",
        "match y := x + 1; y:",
    ] {
        assert!(a1.contains(exp), "Go F-154 AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "if err := doWork(fail); err != nil {",
        "} else if v, ok := m[k]; ok {",
        "if v, ok := m[\"fallback\"]; ok {",
        "switch y := x + 1; y {",
    ] {
        assert!(n2.contains(exp), "Go F-154 native missing `{exp}`:\n{n2}");
    }
    assert!(!n2.contains("switch (y := x + 1; y)"), "Go switch init must not wrap parens:\n{n2}");

    if has_tool("go") {
        let dir = std::env::temp_dir().join(format!("aice_w18_f154_go_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("main.go");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("go").args(["run", fp.to_str().unwrap()]).output().expect("go run");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "go run failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "-1|42|7|10|50|9");
    }
}

#[test]
fn f154_cpp17_if_init_and_range_for_structured_binding_2x() {
    let src = r#"#include <iostream>
#include <map>
#include <utility>
#include <vector>

int check_if(int a) {
    if (int y = a + 1; y > 0) {
        return y * 2;
    } else if (int z = a - 1; z < -5) {
        return -z;
    }
    if (int w = a) {
        return w;
    }
    return 0;
}

int sum_bindings(std::map<int, int>& m, const std::vector<std::pair<int, int>>& vec) {
    int total = 0;
    for (const auto& [k, v] : m) {
        total += k * 10 + v;
    }
    for (auto& [k, v] : m) {
        v += 1;
        total += k;
    }
    for (auto [a, b] : vec) {
        a += 100;
        total += a + b;
    }
    for (auto&& [x, y] : vec) {
        total += x + y;
    }
    return total;
}

int main() {
    std::map<int, int> m = { { 1, 2 }, { 3, 4 } };
    std::vector<std::pair<int, int>> vec = { { 5, 6 } };
    int s = sum_bindings(m, vec);
    std::cout << check_if(3) << "|" << check_if(-10) << "|" << check_if(-1) << "|" << s << "|" << m[1] << "|" << vec[0].first << "\n";
    return 0;
}
"#;
    let (a1, n1, _, n2) = roundtrip_2x(LanguageId::Cpp, "f154_cpp.cpp", src);
    for exp in [
        "if (int y = a + 1; y > 0):",
        "elif (int z = a - 1; z < -5):",
        "if (int w = a):",
        "for const auto& [k, v] in m:",
        "for auto& [k, v] in m:",
        "for auto [a, b] in vec:",
        "for auto&& [x, y] in vec:",
    ] {
        assert!(a1.contains(exp), "C++ F-154 AICE missing `{exp}`:\n{a1}");
    }
    for exp in [
        "if (int y = a + 1; y > 0) {",
        "} else if (int z = a - 1; z < -5) {",
        "if (int w = a) {",
        "for (const auto& [k, v] : m) {",
        "for (auto& [k, v] : m) {",
        "for (auto [a, b] : vec) {",
        "for (auto&& [x, y] : vec) {",
    ] {
        assert!(n2.contains(exp), "C++ F-154 native missing `{exp}`:\n{n2}");
    }

    if has_tool("g++") {
        let dir = std::env::temp_dir().join(format!("aice_w18_f154_cpp_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let src_p = dir.join("main.cpp");
        let bin_p = dir.join("main");
        std::fs::write(&src_p, &n1).unwrap();
        let comp = Command::new("g++")
            .args(["-std=c++20", "-Wall", "-Werror", src_p.to_str().unwrap(), "-o", bin_p.to_str().unwrap()])
            .output()
            .expect("g++");
        assert!(comp.status.success(), "g++ failed: {}\n{n1}", String::from_utf8_lossy(&comp.stderr));
        let run = Command::new(&bin_p).output().expect("run cpp");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(run.status.success(), "cpp run failed: {}", String::from_utf8_lossy(&run.stderr));
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "8|11|-1|172|3|5");
    }
}

#[test]
fn f156_go_defer_and_go_statements_2x() {
    let src = r#"package main

import "fmt"

type Counter struct {
	N int
}

func (r *Counter) Close() {
	r.N += 1
}

func bump(c *Counter, fn func()) (res int) {
	defer fn()
	defer c.Close()
	defer func() { res += 1 }()
	defer func() {
		res += 10
	}()
	return 30
}

func sendVal(ch chan int) {
	go func() { ch <- 42 }()
	go func() {
		ch <- 58
	}()
}

func noop() {}

func main() {
	c := &Counter{}
	r := bump(c, noop)
	ch := make(chan int, 2)
	sendVal(ch)
	a := <-ch
	b := <-ch
	fmt.Printf("%d|%d|%d\n", r, c.N, a+b)
}
"#;
    let (_, n1, _, n2) = roundtrip_2x(LanguageId::Go, "f156_go.go", src);
    for exp in [
        "defer fn()",
        "defer c.Close()",
        "defer func() { res += 1 }()",
        "go func() { ch <- 42 }()",
        "ch <- 58",
    ] {
        assert!(n2.contains(exp), "Go F-156 native missing `{exp}`:\n{n2}");
    }
    assert!(!n2.contains("ch < -"), "Go F-156 mangled channel send:\n{n2}");
    assert!(!n2.contains("defer\n"), "Go F-156 split defer across lines:\n{n2}");
    assert!(!n2.contains("go\n"), "Go F-156 split go across lines:\n{n2}");

    if has_tool("go") {
        let dir = std::env::temp_dir().join(format!("aice_w18_f156_go_{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        let fp = dir.join("main.go");
        std::fs::write(&fp, &n1).unwrap();
        let out = Command::new("go").args(["run", fp.to_str().unwrap()]).output().expect("go run");
        let _ = std::fs::remove_dir_all(&dir);
        assert!(out.status.success(), "go run failed: {}\n{n1}", String::from_utf8_lossy(&out.stderr));
        assert_eq!(String::from_utf8_lossy(&out.stdout).trim(), "41|1|100");
    }
}
