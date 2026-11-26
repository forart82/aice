use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::count_cl100k;

static SEQ: AtomicU64 = AtomicU64::new(1);

struct Tw {
    root: PathBuf,
    ws: PathBuf,
    home: PathBuf,
    gains: PathBuf,
    errors: PathBuf,
}

impl Tw {
    fn new(name: &str) -> Self {
        let id = SEQ.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("aice_w4m2_{name}_{}_{id}", std::process::id()));
        let ws = root.join("ws");
        let home = root.join("home");
        let tel_dir = home.join("telemetry");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(ws.join("src")).unwrap();
        fs::create_dir_all(&tel_dir).unwrap();
        fs::write(ws.join("aice.config.json"), "{\"enabled\": true}\n").unwrap();
        Self { root, ws, home, gains: tel_dir.join("gains.jsonl"), errors: tel_dir.join("errors.jsonl") }
    }

    fn write(&self, rel: &str, content: &str) {
        let p = self.ws.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).unwrap();
        }
        fs::write(p, content).unwrap();
    }

    fn read(&self, rel: &str) -> String {
        fs::read_to_string(self.ws.join(rel)).unwrap()
    }

    fn run(&self, args: &[&str], stdin_data: Option<&str>) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_aice"));
        cmd.args(args)
            .current_dir(&self.ws)
            .env("HOME", &self.home)
            .env("AICE_HOME", &self.home)
            .env("AICE_TELEMETRY_PATH", &self.gains)
            .env("AICE_TELEMETRY_ERRORS_PATH", &self.errors)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin_data.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().unwrap();
        if let Some(data) = stdin_data
            && let Some(mut sin) = child.stdin.take()
        {
            sin.write_all(data.as_bytes()).unwrap();
        }
        child.wait_with_output().unwrap()
    }
}

impl Drop for Tw {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn assert_no_tmp_artifacts(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let p = entry.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        assert!(!name.starts_with(".aice.tmp") && !name.ends_with(".bak"), "leftover artifact: {}", p.display());
        if p.is_dir() && name != ".git" {
            assert_no_tmp_artifacts(&p);
        }
    }
}

#[test]
fn w4_m2_spl_create_overwrite_symbol_line_imports_eof_delete_insert_hunk() {
    let tw = Tw::new("spl_core");
    tw.write("src/app.ts", concat!(
        "import { calc } from \"./math.js\";\n\n",
        "export class App {\n",
        "  private count = 0;\n",
        "  /** Increment counter */\n",
        "  public inc(step: number): number {\n",
        "    this.count += step;\n",
        "    return this.count;\n",
        "  }\n\n",
        "  public reset(): number {\n",
        "    this.count = 0;\n",
        "    return this.count;\n",
        "  }\n",
        "}\n"
    ));

    // --create & --overwrite
    let c = tw.run(&["splice", "src/new.ts", "--create", "-c", "export const X = 1;\n"], None);
    assert_eq!(c.status.code(), Some(0));
    assert_eq!(tw.read("src/new.ts"), "export const X = 1;\n");
    assert_eq!(tw.run(&["splice", "src/new.ts", "--create", "-c", "export const X = 2;\n"], None).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "src/new.ts", "--overwrite", "-c", "export const X = 2;\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("src/new.ts"), "export const X = 2;\n");

    // Symbol splice preserves JSDoc
    let s = tw.run(&["splice", "src/app.ts", "-s", "App.inc", "-c", "public inc(step: number): number {\n  this.count += step * 2;\n  return this.count;\n}"], None);
    assert_eq!(s.status.code(), Some(0));
    let app = tw.read("src/app.ts");
    assert!(app.contains("/** Increment counter */") && app.contains("this.count += step * 2;"));

    // --insert-after, --insert-before, --delete
    assert_eq!(tw.run(&["splice", "src/app.ts", "--insert-after", "App.inc", "-c", "public peek(): number {\n  return this.count;\n}"], None).status.code(), Some(0));
    assert_eq!(tw.run(&["splice", "src/app.ts", "--insert-before", "App.reset", "-c", "public dec(): number {\n  this.count -= 1;\n  return this.count;\n}"], None).status.code(), Some(0));
    let ordered = tw.read("src/app.ts");
    assert!(ordered.find("public inc(").unwrap() < ordered.find("public peek(").unwrap());
    assert!(ordered.find("public peek(").unwrap() < ordered.find("public dec(").unwrap());
    assert!(ordered.find("public dec(").unwrap() < ordered.find("public reset(").unwrap());
    assert_eq!(tw.run(&["splice", "src/app.ts", "-s", "App.peek", "--delete"], None).status.code(), Some(0));
    assert!(!tw.read("src/app.ts").contains("public peek("));

    // :imports & :eof
    assert_eq!(tw.run(&["splice", "src/app.ts:imports", "-c", "import { calc } from \"./math.js\";\nimport { tag } from \"./tag.js\";"], None).status.code(), Some(0));
    assert_eq!(tw.run(&["splice", "src/app.ts:eof", "-c", "export const TAG = \"v1\";"], None).status.code(), Some(0));
    let after_ie = tw.read("src/app.ts");
    assert!(after_ie.contains("./tag.js") && after_ie.trim_end().ends_with("export const TAG = \"v1\";"));

    // --dry-run --diff & --json
    let before = tw.read("src/app.ts");
    let dd = tw.run(&["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 42;\n  return this.count;\n}", "--dry-run", "--diff"], None);
    assert_eq!(dd.status.code(), Some(0));
    let dd_out = String::from_utf8_lossy(&dd.stdout);
    assert!(dd_out.contains("+    this.count = 42;") && tw.read("src/app.ts") == before);

    let js = tw.run(&["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 9;\n  return this.count;\n}", "--json"], None);
    assert_eq!(js.status.code(), Some(0));
    let parsed = parse_json(&String::from_utf8_lossy(&js.stdout)).expect("valid --json");
    assert_eq!(parsed.as_object().unwrap().get("success").and_then(JsonValue::as_bool), Some(true));
}

#[test]
fn w4_m2_batch_file_governance_intrablock_clone_and_atomic_rollback() {
    let tw = Tw::new("batch_rollback");
    tw.write("src/math.ts", "export class Calc {\n  add(a: number, b: number): number {\n    if (a > 0) {\n      return a + b;\n    }\n    return b;\n  }\n  mul(a: number, b: number): number {\n    return a * b;\n  }\n}\n");
    tw.write("src/bad.rs", "pub fn ok() -> i32 { 1 }\n");
    tw.write("batch.json", "[{\"filePath\":\"cfg/gen.json\",\"create\":true,\"code\":\"{\\\"ok\\\":true}\\n\"},{\"filePath\":\"src/math.ts\",\"symbol\":\"Calc.add@if\",\"code\":\"if (a > 0) {\\n      return a + b + 10;\\n    }\"}]");

    // --batch <FILE> reads file under ReadOp governance and applies intra-block splice atomically
    let ok = tw.run(&["splice", "--batch", "batch.json"], None);
    assert_eq!(ok.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ok.stderr));
    assert!(tw.read("cfg/gen.json").contains("\"ok\":true"));
    assert!(tw.read("src/math.ts").contains("return a + b + 10;"));

    // --batch <outside> blocked by governance
    assert_eq!(tw.run(&["splice", "--batch", "../../etc/passwd"], None).status.code(), Some(1));

    // Rollback across newly created subdir + modified file + broken Rust file
    let math_before = tw.read("src/math.ts");
    let bad_stream = "=== new_dir/created.ts ===\nexport const X = 1;\n=== src/math.ts:Calc.mul ===\n  mul(a: number, b: number): number { return a * b + 1; }\n=== src/bad.rs:ok ===\npub fn ok() -> i32 { let x = ; }\n";
    let fail = tw.run(&["splice", "--stdin"], Some(bad_stream));
    assert_eq!(fail.status.code(), Some(1));
    assert!(!tw.ws.join("new_dir/created.ts").exists());
    assert!(!tw.ws.join("new_dir").exists());
    assert_eq!(tw.read("src/math.ts"), math_before);
    let err = String::from_utf8_lossy(&fail.stderr);
    assert!(err.contains("Line ") && err.contains("Context around"));
    assert_no_tmp_artifacts(&tw.ws);

    // T3-05: failed multi-file batch appends ZERO rows to gains.jsonl
    let rows_before = fs::read_to_string(&tw.gains).unwrap().lines().count();
    let fail2 = tw.run(&["splice", "--stdin"], Some(bad_stream));
    assert_eq!(fail2.status.code(), Some(1));
    let rows_after = fs::read_to_string(&tw.gains).unwrap().lines().count();
    assert_eq!(rows_after, rows_before);

    // T2-F03-04: short line-range splice meters replaced scope, not whole file
    let mut big = String::from("export interface Big {\n");
    for i in 1..=120 {
        big.push_str(&format!("  field_{i}: number;\n"));
    }
    big.push_str("}\n");
    tw.write("src/big.ts", &big);
    let big_res = tw.run(&["splice", "src/big.ts", "-s", "L2-L3", "-c", "  field_1: string;\n  field_2: string;\n"], None);
    assert_eq!(big_res.status.code(), Some(0));
    let last_line = fs::read_to_string(&tw.gains).unwrap().lines().last().unwrap().to_string();
    let ev = parse_json(&last_line).unwrap();
    let obj = ev.as_object().unwrap();
    let n1 = obj.get("n1").and_then(JsonValue::as_u64).unwrap();
    let nc = obj.get("nc").and_then(JsonValue::as_u64).unwrap();
    let a1 = obj.get("a1").and_then(JsonValue::as_u64).unwrap();
    assert!(n1 < 400 && nc < 500);
    assert_eq!(a1 as usize, count_cl100k(&String::from_utf8_lossy(&big_res.stdout)));
}

#[test]
fn w4_m2_readonly_rollback_honest_json_bpe_and_t305_batch_rejection() {
    use std::os::unix::fs::PermissionsExt;

    let tw = Tw::new("r2_rollback_json");
    tw.write("0_existing.ts", "export const ORIG = 1;\n");
    fs::set_permissions(tw.ws.join("0_existing.ts"), fs::Permissions::from_mode(0o444)).unwrap();
    fs::create_dir_all(tw.ws.join("a")).unwrap();

    // 0o444 post-rename rollback: 0_existing.ts renames first, then 'a' fails EISDIR
    let fail_rb = tw.run(
        &["splice", "--stdin"],
        Some("=== 0_existing.ts ===\nexport const ORIG = 2;\n=== a/b/c/new.ts ===\nexport const N = 1;\n=== a ===\nfail\n"),
    );
    assert_eq!(fail_rb.status.code(), Some(1));
    assert_eq!(tw.read("0_existing.ts"), "export const ORIG = 1;\n");
    assert_eq!(fs::metadata(tw.ws.join("0_existing.ts")).unwrap().permissions().mode() & 0o777, 0o444);
    assert!(!tw.ws.join("a/b").exists());
    assert_no_tmp_artifacts(&tw.ws);
    // Restore writable before Drop cleans up
    fs::set_permissions(tw.ws.join("0_existing.ts"), fs::Permissions::from_mode(0o644)).unwrap();

    // Single-file --json honest BPE telemetry matching gains.jsonl (n1 - a1)
    tw.write("src/app.ts", "export class App {\n  private count = 0;\n  public reset(): number {\n    this.count = 0;\n    return this.count;\n  }\n}\n");
    let js1 = tw.run(&["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  this.count = 7;\n  return this.count;\n}", "--json"], None);
    assert_eq!(js1.status.code(), Some(0));
    let js1_stdout = String::from_utf8_lossy(&js1.stdout);
    let obj1 = parse_json(&js1_stdout).unwrap();
    let map1 = obj1.as_object().unwrap();
    let row1_str = fs::read_to_string(&tw.gains).unwrap().lines().last().unwrap().to_string();
    let row1 = parse_json(&row1_str).unwrap();
    let rmap1 = row1.as_object().unwrap();
    let n1 = rmap1.get("n1").and_then(JsonValue::as_i64).unwrap();
    let a1 = rmap1.get("a1").and_then(JsonValue::as_i64).unwrap();
    let rn = rmap1.get("rn").and_then(JsonValue::as_i64).unwrap();
    assert_eq!(a1 as usize, count_cl100k(&js1_stdout));
    assert_eq!(map1.get("tokensSaved").and_then(JsonValue::as_i64), Some(n1 - a1));
    assert_eq!(map1.get("realisticTokensSaved").and_then(JsonValue::as_i64), Some(rn - a1));

    // Multi-file --json pairing & BPE honesty
    tw.write("src/a.ts", "export function alpha(): number { return 1; }\n");
    tw.write("src/b.ts", "export function beta(): number { return 2; }\n");
    let js2 = tw.run(&["splice", "--stdin", "--json"], Some("=== src/a.ts:alpha ===\nexport function alpha(): number { return 10; }\n=== src/b.ts:beta ===\nexport function beta(): number { return 20; }\n"));
    assert_eq!(js2.status.code(), Some(0));
    let js2_stdout = String::from_utf8_lossy(&js2.stdout);
    let obj2 = parse_json(&js2_stdout).unwrap();
    let map2 = obj2.as_object().unwrap();
    assert!(map2.get("filePath").and_then(JsonValue::as_str).unwrap().ends_with("src/b.ts"));
    assert_eq!(map2.get("symbol").and_then(JsonValue::as_str), Some("beta"));
    assert_eq!(map2.get("totalFiles").and_then(JsonValue::as_u64), Some(2));
    assert_eq!(map2.get("totalEdits").and_then(JsonValue::as_u64), Some(2));
    let row2_str = fs::read_to_string(&tw.gains).unwrap().lines().last().unwrap().to_string();
    let row2 = parse_json(&row2_str).unwrap();
    let rmap2 = row2.as_object().unwrap();
    let n1_2 = rmap2.get("n1").and_then(JsonValue::as_i64).unwrap();
    let a1_2 = rmap2.get("a1").and_then(JsonValue::as_i64).unwrap();
    assert_eq!(map2.get("tokensSaved").and_then(JsonValue::as_i64), Some(n1_2 - a1_2));

    // T3-05 pre-commit batch rejection telemetry (binary target & outside root -> 0 gains rows)
    fs::write(tw.ws.join("bin.dat"), b"\x00\x01\x02\x03").unwrap();
    let rows_before = fs::read_to_string(&tw.gains).unwrap().lines().count();
    assert_eq!(tw.run(&["splice", "--stdin"], Some("=== src/a.ts:alpha ===\nexport function alpha(): number { return 11; }\n=== bin.dat ===\nhi\n")).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "--stdin"], Some("=== src/a.ts:alpha ===\nexport function alpha(): number { return 11; }\n=== ../outside.ts ===\nexport const X = 1;\n")).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "--batch", "../../etc/passwd"], None).status.code(), Some(1));
    assert_eq!(fs::read_to_string(&tw.gains).unwrap().lines().count(), rows_before);

    // Single-file failure still appends <cli-error>
    assert_eq!(tw.run(&["splice", "src/a.ts", "-c", "export function broken( {"], None).status.code(), Some(1));
    let last_err_row = fs::read_to_string(&tw.gains).unwrap().lines().last().unwrap().to_string();
    assert!(last_err_row.contains("\"<cli-error>\""));
}

#[test]
fn w4_m2_line_shift_create_bw2_heredoc_guards_and_hunk_fixes() {
    let tw = Tw::new("r2_line_hunk");
    // Line-shift comma --delete & --edits
    tw.write("l.rs", "fn l1() {}\nfn l2() {}\nfn l3() {}\nfn l4() {}\nfn l5() {}\n");
    assert_eq!(tw.run(&["splice", "l.rs:L2,L4", "--delete"], None).status.code(), Some(0));
    let l_after = tw.read("l.rs");
    assert!(!l_after.contains("l2") && !l_after.contains("l4") && l_after.contains("l5"), "got={l_after}");
    assert_eq!(tw.run(&["splice", "l.rs:L1-L2,L2-L3", "--delete"], None).status.code(), Some(1));

    tw.write("a.rs", "fn f() {\n    let a = 1;\n    let b = 2;\n    let c = 3;\n    let d = 4;\n    let e = 5;\n}\n");
    let edits_ok = r#"{"filePath":"a.rs","edits":[{"range":"L2","code":"    let a = 10;\n    let a2 = 11;\n    let a3 = 12;"},{"range":"L6","code":"    let e = 50;"}]}"#;
    assert_eq!(tw.run(&["splice", "--edits", edits_ok], None).status.code(), Some(0));
    let a_after = tw.read("a.rs");
    assert!(a_after.contains("let a3 = 12;") && a_after.contains("let e = 50;") && a_after.trim_end().ends_with('}'));

    let edits_ov = r#"[{"file":"a.rs","range":"L2-L4","code":"    let x = 1;"},{"file":"a.rs","range":"L3-L5","code":"    let y = 2;"}]"#;
    assert_eq!(tw.run(&["splice", "--edits", edits_ov], None).status.code(), Some(1));
    assert_eq!(tw.read("a.rs"), a_after);

    // :create on existing file rejected; :create on missing file succeeds
    tw.write("small.rs", "pub fn s() -> i32 { 1 }\n");
    assert_eq!(tw.run(&["splice", "small.rs:create", "-c", "pub fn s() -> i32 { 2 }\n"], None).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "fresh.rs:create", "-c", "pub fn f() -> i32 { 3 }\n"], None).status.code(), Some(0));
    assert!(tw.read("fresh.rs").contains("pub fn f()"));

    // B-W2 TS unclosed '('
    tw.write("bw2.ts", "export function broken( {\n  return 1;\n}\n\nexport function clean(x: number): number {\n  return x + 1;\n}\n");
    assert_eq!(tw.run(&["splice", "bw2.ts", "-s", "clean", "-c", "export function clean(x: number): number {\n  return x + 99;\n}"], None).status.code(), Some(0));
    assert!(tw.read("bw2.ts").contains("return x + 99;"));
    assert_eq!(tw.run(&["splice", "bw2.ts", "-s", "clean", "-c", "export function clean( {\n  return 0;"], None).status.code(), Some(1));

    // -c fenced markdown, python triple quotes, P4/P5, 123: 456 hunk, Tier 2 duplicate
    tw.write("doc.md", "# Title\n");
    assert_eq!(tw.run(&["splice", "doc.md", "-c", "# Updated\n```\n=== /etc/passwd ===\n```\n"], None).status.code(), Some(0));
    assert!(tw.read("doc.md").contains("=== /etc/passwd ==="));

    tw.write("app.py", "def f():\n    pass\n");
    assert_eq!(tw.run(&["splice", "app.py", "-c", "def f():\n    \"\"\"\n=== other.rs ===\n    \"\"\"\n    return 1\n"], None).status.code(), Some(0));

    tw.write("notes.txt", "init\n");
    let p45 = "=== notes.txt ===\n# Heading\n=== Section Title\ncat <<'EOF'\nhello\nEOF\n";
    assert_eq!(tw.run(&["splice", "--stdin"], Some(p45)).status.code(), Some(0));
    let notes = tw.read("notes.txt");
    assert!(notes.contains("=== Section Title") && notes.trim_end().ends_with("EOF"));

    tw.write("kv.txt", "123: 456\nother 456\n");
    assert_eq!(tw.run(&["splice", "kv.txt", "-c", "<<<\n123: 456\n===\n123: 999\n>>>"], None).status.code(), Some(0));
    assert_eq!(tw.read("kv.txt"), "123: 999\nother 456\n");

    tw.write("dup.ts", "let x = val + val;\n");
    let dup_res = tw.run(&["splice", "dup.ts", "-c", "<<<\nval\n===\nother\n>>>"], None);
    assert_eq!(dup_res.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&dup_res.stderr).contains("Ambiguous hunk matched 2 locations"));
}

#[test]
fn w4_m2_t305_malformed_and_empty_inline_or_file_batch_edits_stdin_zero_telemetry() {
    let tw = Tw::new("t305_malformed_inline");
    tw.write("src/app.ts", "export const A = 1;\n");
    tw.write("bad_json.json", "{bad");
    let before_app = tw.read("src/app.ts");

    let cases: &[(&[&str], Option<&str>, &str)] = &[
        (&["splice", "--batch", "{bad"], None, "Invalid --batch JSON"),
        (&["splice", "--dry-run", "--batch", "{bad"], None, "Invalid --batch JSON"),
        (&["splice", "--batch", "[]"], None, "--batch JSON array must not be empty"),
        (&["splice", "--batch", ""], None, "Empty --batch payload"),
        (&["splice", "--edits", "{bad"], None, "Invalid --edits JSON"),
        (&["splice", "--edits", "[]"], None, "--edits JSON array must not be empty"),
        (&["splice", "--stdin"], Some("{bad"), "Invalid --batch JSON"),
        (&["splice", "--stdin"], Some(""), "Empty --batch payload"),
        (&["splice", "--batch", "bad_json.json"], None, "Invalid --batch JSON"),
    ];

    for (args, stdin_data, expected_err) in cases {
        let out = tw.run(args, *stdin_data);
        let stderr = String::from_utf8_lossy(&out.stderr);
        assert_eq!(out.status.code(), Some(1), "args={args:?} stderr={stderr}");
        assert!(out.stdout.is_empty(), "args={args:?}");
        assert!(stderr.contains(expected_err), "args={args:?} stderr={stderr}");
        assert!(!stderr.contains("requires a target file"), "args={args:?} stderr={stderr}");
    }

    assert_eq!(tw.read("src/app.ts"), before_app);
    assert!(
        !tw.gains.exists() || fs::read_to_string(&tw.gains).unwrap().trim().is_empty(),
        "gains.jsonl must have 0 rows for malformed/empty batch/edits/stdin"
    );

    // Targetless `splice` without --batch/--edits/--stdin still fails early in parse_write_args
    let bare = tw.run(&["splice"], None);
    assert_eq!(bare.status.code(), Some(1));
    assert!(String::from_utf8_lossy(&bare.stderr).contains("requires a target file"));
}

#[test]
fn w4_m2_r4_aice_ir_unwrapping_heredoc_spoofs_and_batch_edge_telemetry() {
    let tw = Tw::new("r4_remediation");
    // 1. Go, Java, PHP, Kotlin, Dart, C# AICE IR symbol splices
    tw.write("d.go", "package main\n\nimport \"fmt\"\n\nfunc div(a int, b int) int {\n\tfmt.Println(a)\n\treturn a / b\n}\n");
    tw.write("App.java", "public class App {\n    public static int add(int a, int b) {\n        return a + b;\n    }\n}\n");
    tw.write("a.php", "<?php\nfunction add(int $a, int $b): int {\n    return $a + $b;\n}\n");
    tw.write("a.kt", "fun add(a: Int, b: Int): Int {\n    return a + b\n}\n");
    tw.write("a.dart", "int add(int a, int b) {\n  return a + b;\n}\n");
    tw.write("App.cs", "public class App {\n    public static int add(int a, int b) {\n        return a + b;\n    }\n}\n");

    let go_res = tw.run(&["splice", "--edits", r#"[{"filePath":"d.go","symbol":"div","newAiceCode":"fn div(a: int, b: int) -> int:\n  ret a / b + 1"}]"#], None);
    assert_eq!(go_res.status.code(), Some(0), "go stderr={}", String::from_utf8_lossy(&go_res.stderr));
    let go_disk = tw.read("d.go");
    assert_eq!(go_disk.matches("package main").count(), 1, "go_disk={go_disk}");
    assert!(go_disk.contains("import \"fmt\"") && go_disk.contains("return a / b + 1"));

    let java_res = tw.run(&["splice", "--edits", r#"[{"filePath":"App.java","symbol":"App.add","newAiceCode":"pub fn add(a: int, b: int) -> int:\n  ret a + b + 1"}]"#], None);
    assert_eq!(java_res.status.code(), Some(0), "java stderr={}", String::from_utf8_lossy(&java_res.stderr));
    let java_disk = tw.read("App.java");
    assert!(!java_disk.contains("class Module"), "java_disk={java_disk}");
    assert!(java_disk.contains("return a + b + 1;"));

    let php_res = tw.run(&["splice", "--edits", r#"[{"filePath":"a.php","symbol":"add","newAiceCode":"fn add(a: int, b: int) -> int:\n  ret a + b + 1"}]"#], None);
    assert_eq!(php_res.status.code(), Some(0), "php stderr={}", String::from_utf8_lossy(&php_res.stderr));
    let php_disk = tw.read("a.php");
    assert_eq!(php_disk.matches("<?php").count(), 1, "php_disk={php_disk}");
    assert!(php_disk.contains("return $a + $b + 1;"));

    assert_eq!(tw.run(&["splice", "--edits", r#"[{"filePath":"a.kt","symbol":"add","newAiceCode":"fn add(a: int, b: int) -> int:\n  ret a + b + 1"}]"#], None).status.code(), Some(0));
    assert_eq!(tw.run(&["splice", "--edits", r#"[{"filePath":"a.dart","symbol":"add","newAiceCode":"fn add(a: int, b: int) -> int:\n  ret a + b + 1"}]"#], None).status.code(), Some(0));
    assert_eq!(tw.run(&["splice", "--edits", r#"[{"filePath":"App.cs","symbol":"App.add","newAiceCode":"pub fn add(a: int, b: int) -> int:\n  ret a + b + 1"}]"#], None).status.code(), Some(0));

    // 2. Heredoc spoofing: md closed heading, Rust multiline /* */, TS template literal + /* */
    let md_res = tw.run(&["splice", "--stdin"], Some("=== README.md ===\n# Title\n\n=== Section Inside Markdown ===\nBody text.\n"));
    assert_eq!(md_res.status.code(), Some(0), "md stderr={}", String::from_utf8_lossy(&md_res.stderr));
    assert!(tw.read("README.md").contains("=== Section Inside Markdown ==="));
    assert!(!tw.ws.join("Section Inside Markdown").exists());

    let rs_res = tw.run(&["splice", "--stdin"], Some("=== lib.rs ===\n/*\n=== fake_rs_comment.rs ===\n*/\npub fn ok() -> i32 { 42 }\n"));
    assert_eq!(rs_res.status.code(), Some(0), "rs stderr={}", String::from_utf8_lossy(&rs_res.stderr));
    assert!(tw.read("lib.rs").contains("pub fn ok()"));
    assert!(!tw.ws.join("fake_rs_comment.rs").exists());

    let ts_res = tw.run(&["splice", "--stdin"], Some("=== a.ts ===\nconst s = `\n=== fake_tpl.ts ===\n`;\n/*\n=== fake_cmt.ts ===\n*/\nexport const X = 1;\n"));
    assert_eq!(ts_res.status.code(), Some(0), "ts stderr={}", String::from_utf8_lossy(&ts_res.stderr));
    assert!(tw.read("a.ts").contains("export const X = 1;"));
    assert!(!tw.ws.join("fake_tpl.ts").exists() && !tw.ws.join("fake_cmt.ts").exists());

    // 3. Polish 1 & 2: [{"edits":[]}] and inline --batch / --dry-run /regex/ selector produce 0 gains rows
    tw.write("src/a.ts", "export function f(): number { return 1; }\n");
    let rows_before = fs::read_to_string(&tw.gains).unwrap().lines().count();
    for args in [
        &["splice", "--json", "--batch", r#"[{"edits":[]}]"#][..],
        &["splice", "--batch", r#"[{"file":"src/a.ts","symbol":"f,/evil/","code":"x"}]"#][..],
        &["splice", "--dry-run", "--batch", r#"[{"file":"src/a.ts","symbol":"f,/evil/","code":"x"}]"#][..],
        &["splice", "--dry-run", "src/a.ts:/evil/", "-c", "x"][..],
    ] {
        let out = tw.run(args, None);
        assert_eq!(out.status.code(), Some(1), "args={args:?}");
        assert!(out.stdout.is_empty(), "args={args:?}");
        assert!(!out.stderr.is_empty(), "args={args:?}");
    }
    assert_eq!(fs::read_to_string(&tw.gains).unwrap().lines().count(), rows_before);
}

#[test]
fn w4_m2_r5_standalone_class_ir_go_import_strip_and_java_comment_tq_precedence() {
    let tw = Tw::new("r5_remediation");

    // 1A: Standalone `pub class` AICE IR for symbol splice and :create
    tw.write("App.java", "public class App {\n    public static int add(int a, int b) { return a + b; }\n}\n");
    let app_res = tw.run(
        &["splice", "--edits", r#"[{"filePath":"App.java","symbol":"App","newAiceCode":"pub class App:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 2"}]"#],
        None,
    );
    assert_eq!(app_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&app_res.stderr));
    assert!(tw.read("App.java").contains("a + b + 2"));

    let new_res = tw.run(
        &["splice", "--stdin"],
        Some("=== NewApp.java:create ===\npub class NewApp:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b\n"),
    );
    assert_eq!(new_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&new_res.stderr));
    assert!(tw.read("NewApp.java").contains("public class NewApp") && tw.read("NewApp.java").contains("return a + b;"));

    // 1B: Go symbol splice after another func strips top-level `import "fmt"`
    tw.write("d.go", "package main\n\nimport \"fmt\"\n\nfunc add(a int, b int) int { return a + b }\n\nfunc div(a int, b int) int {\n\tfmt.Println(a)\n\treturn a / b\n}\n");
    let go_res = tw.run(
        &["splice", "--edits", r#"[{"filePath":"d.go","symbol":"div","newAiceCode":"module main\nimport \"fmt\"\nfn div(a: int, b: int) -> int:\n  fmt.Println(a)\n  ret a / b + 1"}]"#],
        None,
    );
    assert_eq!(go_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&go_res.stderr));
    let d_go = tw.read("d.go");
    assert_eq!(d_go.matches("import \"fmt\"").count(), 1, "d_go={d_go}");
    assert_eq!(d_go.matches("package main").count(), 1, "d_go={d_go}");
    assert!(d_go.contains("return a / b + 1"));

    // 2: Java /* """ */, multiline /*\n"""\n*/, // """, and real text block """
    let java_stream = concat!(
        "=== A.java ===\n",
        "public class A {\n",
        "  /* note about \"\"\" text blocks */\n",
        "  /*\n\"\"\"\n*/\n",
        "  // \"\"\"\n",
        "  String s = \"\"\"\n",
        "=== fake.java ===\n",
        "\"\"\";\n",
        "  public int ok() { return 1; }\n",
        "}\n",
        "=== B.java ===\n",
        "public class B {\n  public int ok2() { return 2; }\n}\n",
    );
    let j_res = tw.run(&["splice", "--stdin"], Some(java_stream));
    assert_eq!(j_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&j_res.stderr));
    assert!(tw.ws.join("A.java").exists() && tw.ws.join("B.java").exists());
    assert!(!tw.ws.join("fake.java").exists());
    assert!(tw.read("A.java").contains("=== fake.java ==="));
}

#[test]
fn w4_m2_r6_plaintext_non_truncation_and_python_subclass_preservation() {
    let tw = Tw::new("r6_remediation");

    // Finding 1: PlainText .txt writes starting with AICE-IR-looking lines keep exact payload
    let txt_stream = concat!(
        "=== notes.txt:create ===\nclass Notes:\n  x = 1\n",
        "=== readme.txt:create ===\nmodule architecture\nconst x = 1\n",
        "=== pseudocode.txt:create ===\nfn f():\n  ret 1\n",
    );
    let txt_res = tw.run(&["splice", "--stdin"], Some(txt_stream));
    assert_eq!(txt_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&txt_res.stderr));
    assert_eq!(tw.read("notes.txt"), "class Notes:\n  x = 1\n");
    assert_eq!(tw.read("readme.txt"), "module architecture\nconst x = 1\n");
    assert_eq!(tw.read("pseudocode.txt"), "fn f():\n  ret 1\n");

    // Finding 2: Native Python subclasses preserve base classes on :create and symbol splice
    let py_create = tw.run(
        &["splice", "--stdin"],
        Some("=== pycls.py:create ===\nclass Foo(Base):\n    x = 1\n=== user.py:create ===\nclass User(BaseModel):\n    name: str\n"),
    );
    assert_eq!(py_create.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&py_create.stderr));
    assert_eq!(tw.read("pycls.py"), "class Foo(Base):\n    x = 1\n");
    assert_eq!(tw.read("user.py"), "class User(BaseModel):\n    name: str\n");

    let py_splice = tw.run(
        &["splice", "user.py", "-s", "User", "-c", "class User(BaseModel):\n    name: str\n    active: bool = True\n"],
        None,
    );
    assert_eq!(py_splice.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&py_splice.stderr));
    assert!(tw.read("user.py").contains("class User(BaseModel):"));

    // Existing AICE IR constructs across Python, Java, Go, TypeScript, Rust, Kotlin, PHP still work
    tw.write("c.py", "class Calc:\n    def add(self, a: int, b: int) -> int:\n        return a + b\n");
    tw.write("app.ts", "export class User {\n  name: string = '';\n}\n");
    tw.write("a.rs", "pub struct Point {\n    pub x: i32,\n}\n");
    tw.write("a.kt", "class Calc {\n    fun add(a: Int, b: Int): Int {\n        return a + b\n    }\n}\n");
    tw.write("a.php", "<?php\nclass Calc {\n    public function add(int $a, int $b): int {\n        return $a + $b;\n    }\n}\n");

    let ir_batch = concat!(
        "=== c.py:Calc ===\npub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 1\n",
        "=== app.ts:User ===\npub class User:\n  name: str\n",
        "=== a.rs:Point ===\npub struct Point:\n  x: i32\n  y: i32\n",
        "=== a.kt:Calc ===\npub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 1\n",
        "=== a.php:Calc ===\npub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 1\n",
    );
    let ir_res = tw.run(&["splice", "--stdin"], Some(ir_batch));
    assert_eq!(ir_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ir_res.stderr));
    assert!(tw.read("c.py").contains("return a + b + 1"));
    assert!(tw.read("app.ts").contains("export class User") && tw.read("app.ts").contains("name: string"));
    assert!(tw.read("a.rs").contains("pub struct Point") && tw.read("a.rs").contains("y: i32"));
    assert!(tw.read("a.kt").contains("return a + b + 1"));
    assert!(tw.read("a.php").contains("return $a + $b + 1;"));
}

#[test]
fn w4_m2_r7_cpp_c_include_non_standalone_splices_and_makefile_guards() {
    let tw = Tw::new("r7_remediation");

    // 1. C & C++ #include stripping + leading // comment preserved
    tw.write("main.c", "#include <stdio.h>\n\nint add(int a, int b) {\n    return a + b;\n}\n");
    let c_res = tw.run(&["splice", "main.c", "-s", "add", "-c", "// note\nmodule main\nimport \"<stdio.h>\"\nfn add(a: int, b: int) -> int:\n  ret a + b + 1\n"], None);
    assert_eq!(c_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&c_res.stderr));
    let main_c = tw.read("main.c");
    assert_eq!(main_c.matches("#include <stdio.h>").count(), 1, "main_c={main_c}");
    assert!(main_c.contains("// note") && main_c.contains("return a + b + 1;"), "main_c={main_c}");

    tw.write("math.cpp", "#include <vector>\n\nclass Math {\npublic:\n    int add(int a, int b) {\n        return a + b;\n    }\n};\n");
    let cpp_res = tw.run(&["splice", "math.cpp", "-s", "Math.add", "-c", "// note\nmodule main\nimport \"<vector>\"\nfn add(a: int, b: int) -> int:\n  ret a + b + 2\n"], None);
    assert_eq!(cpp_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&cpp_res.stderr));
    let math_cpp = tw.read("math.cpp");
    assert_eq!(math_cpp.matches("#include <vector>").count(), 1, "math_cpp={math_cpp}");
    assert!(!math_cpp.split("class Math").nth(1).unwrap().contains("#include"), "math_cpp={math_cpp}");
    assert!(math_cpp.contains("// note") && math_cpp.contains("return a + b + 2;"), "math_cpp={math_cpp}");

    // 2. Non-standalone Python & TS splices: py_else, walrus, app.ts --insert-after, sw.ts, ret_expr.ts
    tw.write("py_else.py", "def f(x, cls):\n    if x:\n        y = 1\n        return y\n    else:\n        y = 0\n        return y\n");
    let py_res = tw.run(&["splice", "py_else.py:L5-L7", "-c", "    else:\n        y = 42\n        return cls(y)"], None);
    assert_eq!(py_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&py_res.stderr));
    assert!(tw.read("py_else.py").contains("return cls(y)"));

    tw.write("walrus.py", "def f(s, p1, p2):\n    if (m := p1(s)):\n        return m\n    elif (m := p2(s)):\n        return m\n");
    let wal_res = tw.run(&["splice", "walrus.py:L4-L5", "-c", "    elif (m := p2(s)):\n        return m + 1"], None);
    assert_eq!(wal_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&wal_res.stderr));
    assert!(tw.read("walrus.py").contains("elif (m := p2(s)):") && tw.read("walrus.py").contains("return m + 1"));

    tw.write("app.ts", "export class App {\n  public inc(cls: number): number {\n    return cls + 1;\n  }\n}\n");
    let ins_res = tw.run(&["splice", "app.ts", "--insert-after", "App.inc", "-c", "public make(cls: string): string { return cls; }"], None);
    assert_eq!(ins_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ins_res.stderr));
    assert!(tw.read("app.ts").contains("public make(cls: string): string { return cls; }"));

    tw.write("sw.ts", "export function f(x: number, cls: number): number {\n  switch (x) {\n    case 1: {\n      const y = cls;\n      return y;\n    }\n    default:\n      return 0;\n  }\n}\n");
    let sw_res = tw.run(&["splice", "sw.ts:L3-L6", "-c", "    case 1: {\n      const cls = 99;\n      return cls;\n    }"], None);
    assert_eq!(sw_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&sw_res.stderr));
    assert!(tw.read("sw.ts").contains("const cls = 99;") && tw.read("sw.ts").contains("return cls;"));

    tw.write("ret_expr.ts", "export function pick(x: number, ret: number): number {\n  switch (x) {\n    case 1:\n      ret + 1;\n      return 1;\n    default:\n      return 0;\n  }\n}\n");
    let ret_orig = tw.read("ret_expr.ts");
    let ret_diff = tw.run(&["splice", "ret_expr.ts:L3-L5", "-c", "    case 1:\n      ret;\n      return 2;", "--dry-run", "--diff"], None);
    assert_eq!(ret_diff.status.code(), Some(0));
    let diff_out = String::from_utf8_lossy(&ret_diff.stdout);
    assert!(diff_out.contains("+      ret;") && !diff_out.contains("+      return;"), "diff={diff_out}");
    assert_eq!(tw.read("ret_expr.ts"), ret_orig);

    let ret_json = tw.run(&["splice", "ret_expr.ts:L3-L5", "-c", "    case 1:\n      ret;\n      return 2;", "--json"], None);
    assert_eq!(ret_json.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ret_json.stderr));
    let ret_stdout = String::from_utf8_lossy(&ret_json.stdout);
    let ret_obj = parse_json(&ret_stdout).unwrap();
    let ret_map = ret_obj.as_object().unwrap();
    assert!(ret_map.get("modifiedCode").and_then(JsonValue::as_str).unwrap().contains("      ret;\n      return 2;"));
    let last_row = fs::read_to_string(&tw.gains).unwrap().lines().last().unwrap().to_string();
    let row_obj = parse_json(&last_row).unwrap();
    let row_map = row_obj.as_object().unwrap();
    let n1 = row_map.get("n1").and_then(JsonValue::as_i64).unwrap();
    let a1 = row_map.get("a1").and_then(JsonValue::as_i64).unwrap();
    assert_eq!(a1 as usize, count_cl100k(&ret_stdout));
    assert_eq!(ret_map.get("tokensSaved").and_then(JsonValue::as_i64), Some(n1 - a1));
    assert!(tw.read("ret_expr.ts").contains("      ret;\n      return 2;") && !tw.read("ret_expr.ts").contains("return;"));

    // 3. Makefile odd ''' vs bin/pytool Python shebang
    let mk_stream = concat!(
        "=== Makefile:create ===\n",
        "all:\n",
        "\techo '''hello\n",
        "=== after_mk.txt:create ===\n",
        "hello world\n",
        "=== bin/pytool:create ===\n",
        "#!/usr/bin/env python3\n",
        "DOC = '''\n",
        "=== fake.py ===\n",
        "'''\n",
    );
    let mk_res = tw.run(&["splice", "--stdin"], Some(mk_stream));
    assert_eq!(mk_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&mk_res.stderr));
    assert!(tw.ws.join("Makefile").exists() && tw.ws.join("after_mk.txt").exists() && tw.ws.join("bin/pytool").exists());
    assert!(!tw.ws.join("fake.py").exists());
    assert!(tw.read("bin/pytool").contains("=== fake.py ==="));
}

#[test]
fn w4_m2_r8_challenger1_repros_and_all_7_lang_class_unwrap() {
    let tw = Tw::new("r8_fixes");

    // Bug 1: Python/Ruby # comments, Rust directive #[inline], and native preservations
    tw.write("p.py", "import os\n\ndef f(x: int) -> int:\n    return x\n");
    let py_res = tw.run(&["splice", "p.py:f", "-c", "# note\nimport \"os\"\nfn f(x: int) -> int:\n  ret x + 1\n"], None);
    assert_eq!(py_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&py_res.stderr));
    let p_py = tw.read("p.py");
    assert!(!p_py.contains("import \"os\"") && p_py.matches("import os").count() == 1 && p_py.contains("# note") && p_py.contains("return x + 1"));

    tw.write("app.rb", "require 'json'\n\ndef greet(name)\n  name\nend\n");
    let rb_res = tw.run(&["splice", "app.rb:greet", "-c", "# rb-note\nimport \"json\"\nfn greet(name: str) -> str:\n  ret name\n"], None);
    assert_eq!(rb_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&rb_res.stderr));
    let app_rb = tw.read("app.rb");
    assert!(!app_rb.contains("import \"json\"") && app_rb.matches("require 'json'").count() == 1 && app_rb.contains("def greet(name)"));

    tw.write("lib.rs", "use std::fmt;\n\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n");
    let rs_res = tw.run(&["splice", "lib.rs:add", "-c", "// rs-note\nimport \"std::fmt\"\ndirective #[inline]\npub fn add(a: i32, b: i32) -> i32:\n  ret a + b + 1\n"], None);
    assert_eq!(rs_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&rs_res.stderr));
    let lib_rs = tw.read("lib.rs");
    assert_eq!(lib_rs.matches("use std::fmt;").count(), 1);
    assert!(lib_rs.contains("// rs-note") && lib_rs.contains("#[inline]") && !lib_rs.contains("directive"));

    let nat_py = "# comment\nclass Foo(Base):\n    x = 1\n";
    assert_eq!(tw.run(&["splice", "nat.py:create", "-c", nat_py], None).status.code(), Some(0));
    assert_eq!(tw.read("nat.py"), nat_py);
    let nat_rs = "#![allow(dead_code)]\n#[inline]\npub fn foo() {}\n";
    assert_eq!(tw.run(&["splice", "nat.rs:create", "-c", nat_rs], None).status.code(), Some(0));
    assert_eq!(tw.read("nat.rs"), nat_rs);

    // Bug 2: Single-class unwrapping across C++, TS, TSX, JS, Python, Dart, Rust
    tw.write("math.cpp", "#include <vector>\n\nclass Math {\npublic:\n    int add(int a, int b) {\n        return a + b;\n    }\n};\n");
    assert_eq!(tw.run(&["splice", "math.cpp:Math::add", "-c", "module main\nimport \"<vector>\"\nclass Math:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 3\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("math.cpp").matches("class Math").count(), 1);

    tw.write("app.ts", "export class App {\n  public inc(x: number): number {\n    return x + 1;\n  }\n}\n");
    assert_eq!(tw.run(&["splice", "app.ts:App.inc", "-c", "module ts\npub class App:\n  pub fn inc(x: number) -> number:\n    ret x + 2\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("app.ts").matches("class App").count(), 1);

    tw.write("card.tsx", "export class Card {\n  public render(): string {\n    return \"hi\";\n  }\n}\n");
    assert_eq!(tw.run(&["splice", "card.tsx:Card.render", "-c", "module tsx\npub class Card:\n  pub fn render() -> string:\n    ret \"ok\"\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("card.tsx").matches("class Card").count(), 1);

    tw.write("calc.js", "export class Calc {\n  add(a, b) {\n    return a + b;\n  }\n}\n");
    assert_eq!(tw.run(&["splice", "calc.js:Calc.add", "-c", "module js\npub class Calc:\n  fn add(a, b):\n    ret a + b + 2\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("calc.js").matches("class Calc").count(), 1);

    tw.write("calc.py", "class Calc:\n    def add(self, a: int, b: int) -> int:\n        return a + b\n");
    assert_eq!(tw.run(&["splice", "calc.py:Calc.add", "-c", "module python\nclass Calc:\n  fn add(self, a: int, b: int) -> int:\n    ret a + b + 2\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("calc.py").matches("class Calc:").count(), 1);

    tw.write("calc.dart", "class Calc {\n  int add(int a, int b) {\n    return a + b;\n  }\n}\n");
    assert_eq!(tw.run(&["splice", "calc.dart:Calc.add", "-c", "module dart\nclass Calc:\n  fn add(a: int, b: int) -> int:\n    ret a + b + 2\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("calc.dart").matches("class Calc").count(), 1);

    tw.write("calc.rs", "pub struct Calc;\n\nimpl Calc {\n    pub fn add(&self, a: i32, b: i32) -> i32 {\n        a + b\n    }\n}\n");
    assert_eq!(tw.run(&["splice", "calc.rs:Calc::add", "-c", "module rust\npub class Calc:\n  pub fn add(&self, a: i32, b: i32) -> i32:\n    ret a + b + 2\n"], None).status.code(), Some(0));
    assert_eq!(tw.read("calc.rs").matches("struct Calc;").count(), 1);
    assert_eq!(tw.read("calc.rs").matches("impl Calc").count(), 1);

    // Bug 3: Python y := x + 1 lowering & illegal := firewall check
    tw.write("hyb_py.py", "def old(x):\n    return x\n");
    let hyb_ok = tw.run(&["splice", "hyb_py.py:old", "-c", "def old(x):\n    y := x + 1\n    return y"], None);
    assert_eq!(hyb_ok.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&hyb_ok.stderr));
    assert!(tw.read("hyb_py.py").contains("y = x + 1") && !tw.read("hyb_py.py").contains(":="));

    let before_bad = tw.read("hyb_py.py");
    let bad_hunk = tw.run(&["splice", "hyb_py.py:old", "-c", "<<<\n    return y\n===\n    z := 2\n    return z\n>>>"], None);
    assert_eq!(bad_hunk.status.code(), Some(1));
    assert_eq!(tw.read("hyb_py.py"), before_bad);

    let bad_ret = tw.run(&["splice", "hyb_py.py:old", "-c", "def old(x):\n    return y := 1"], None);
    assert_eq!(bad_ret.status.code(), Some(1));
    assert_eq!(tw.read("hyb_py.py"), before_bad);
}

#[test]
fn w4_m2_r9_challenger_fixes_walrus_bw2_kotlin_and_mixed_walrus() {
    let tw = Tw::new("r9_fixes");

    // 1. Compound if/elif/while/case..if headers & comprehension if filters blocked pre-disk
    tw.write("blk.py", "def f(a, v, xs):\n    return 0\n");
    let blk_orig = tw.read("blk.py");
    for bad in [
        "def f(a, v, xs):\n    if a and y := 1:\n        return y\n    return 0",
        "def f(a, v, xs):\n    if a:\n        return 1\n    elif a or y := 1:\n        return y\n    return 0",
        "def f(a, v, xs):\n    while a and y := 1:\n        break\n    return 0",
        "def f(a, v, xs):\n    if not y := a:\n        return 1\n    return 0",
        "def f(a, v, xs):\n    match v:\n        case _ if a and m := v:\n            return m\n    return 0",
        "def f(a, v, xs):\n    return [x for x in xs if y := x]",
    ] {
        let res = tw.run(&["splice", "blk.py:f", "-c", bad], None);
        assert_eq!(res.status.code(), Some(1), "expected rc=1 for:\n{bad}");
        assert_eq!(tw.read("blk.py"), blk_orig);
    }
    let ok_comp = tw.run(&["splice", "blk.py:f", "-c", "def f(a, v, xs):\n    if (a and (y := 1)):\n        pass\n    return [x for x in xs if (z := x)]"], None);
    assert_eq!(ok_comp.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ok_comp.stderr));

    // 2. B-W2 unclosed '(' and '"""' before target block illegal := (with/without --force & :hunk)
    let bw2_init = "def broken(:\n    pass\n\ndef ok(x):\n    return x\n";
    tw.write("bw2.py", bw2_init);
    assert_eq!(tw.run(&["splice", "bw2.py:ok", "--force", "-c", "def ok(x):\n    return y := 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("bw2.py"), bw2_init);
    assert_eq!(tw.run(&["splice", "bw2.py:ok", "-c", "<<<\n    return x\n===\n    z := 2\n    return z\n>>>"], None).status.code(), Some(1));
    assert_eq!(tw.read("bw2.py"), bw2_init);
    assert_eq!(tw.run(&["splice", "bw2.py:ok", "-c", "def ok(x):\n    return x + 1"], None).status.code(), Some(0));

    let tq_init = "s = \"\"\"unclosed\n\ndef ok(x):\n    return x\n";
    tw.write("bw2_tq.py", tq_init);
    assert_eq!(tw.run(&["splice", "bw2_tq.py:ok", "-c", "def ok(x):\n    return y := 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("bw2_tq.py"), tq_init);

    let bw2_w = "broken_walrus := 1\n\ndef ok(x):\n    return x\n";
    tw.write("bw2_w.py", bw2_w);
    assert_eq!(tw.run(&["splice", "bw2_w.py:ok", "-c", "def ok(x):\n    return x + 2"], None).status.code(), Some(0));
    assert!(tw.read("bw2_w.py").contains("broken_walrus := 1") && tw.read("bw2_w.py").contains("return x + 2"));

    // 3. Kotlin `module kotlin` + `import "..."` + `class App:` round-trip & :create
    tw.write("K.kt", "import kotlin.math.abs\n\nclass App {\n    fun add(a: Int, b: Int): Int {\n        return a + b\n    }\n}\n");
    let kt_read = tw.run(&["read", "K.kt"], None);
    assert_eq!(kt_read.status.code(), Some(0));
    let kt_sp = tw.run(&["splice", "K.kt:App.add", "-c", "module kotlin\nimport \"kotlin.math.abs\"\npub class App:\n  pub fn add(a: int, b: int) -> int = a + b + 1\n"], None);
    assert_eq!(kt_sp.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&kt_sp.stderr));
    let k_disk = tw.read("K.kt");
    assert_eq!(k_disk.matches("class App").count(), 1, "K.kt={k_disk}");
    assert_eq!(k_disk.matches("import kotlin.math.abs").count(), 1, "K.kt={k_disk}");
    assert!(!k_disk.contains("module kotlin") && k_disk.contains("a + b + 1"), "K.kt={k_disk}");

    let kt_cr = tw.run(&["splice", "kt_c.kt:create", "-c", "module kotlin\nimport \"kotlin.math.abs\"\nclass App:\n  fn add(a: int, b: int) -> int:\n    ret a + b + 1\n"], None);
    assert_eq!(kt_cr.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&kt_cr.stderr));
    let kt_c_disk = tw.read("kt_c.kt");
    assert!(kt_c_disk.contains("import kotlin.math.abs") && kt_c_disk.contains("class App") && kt_c_disk.contains("return a + b + 1") && !kt_c_disk.contains("module kotlin"), "kt_c={kt_c_disk}");

    // 4. Mixed Python `y := x + 1` + valid PEP 572 `:=`
    tw.write("mix.py", "def f(s, x):\n    return x\n");
    let mix_res = tw.run(&["splice", "mix.py:f", "-c", "def f(s, x):\n    if (m := s):\n        y := m + 1\n        a := [w := y + 2]\n        return max(y, z := a[0] + 1)\n    return 0"], None);
    assert_eq!(mix_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&mix_res.stderr));
    let mix_disk = tw.read("mix.py");
    assert!(mix_disk.contains("if (m := s):") && mix_disk.contains("y = m + 1") && mix_disk.contains("a = [w := y + 2]") && mix_disk.contains("max(y, z := a[0] + 1)"), "mix={mix_disk}");
}

#[test]
fn w4_m2_r10_module_lang_non_wipe_walrus_parity_and_match_decorator() {
    let tw = Tw::new("r10_fixes");

    // 1. Bug 1: `module <lang>\nfn foo():\n  ret 1` never wipes files to ""
    tw.write("doc.md", "# Existing Doc\n");
    tw.write("cfg.yaml", "service: api\nport: 8080\n");
    tw.write("q.sql", "SELECT 1;\n");

    let md_in = "module markdown\nfn foo():\n  ret 1\n";
    let md_res = tw.run(&["splice", "doc.md:overwrite", "-c", md_in], None);
    assert_eq!(md_res.status.code(), Some(0));
    assert_eq!(tw.read("doc.md"), md_in);

    let cfg_res = tw.run(&["splice", "cfg.yaml:overwrite", "-c", "module yaml\nfn foo():\n  ret 1\n"], None);
    assert!(!tw.read("cfg.yaml").is_empty());
    if cfg_res.status.code() == Some(1) {
        assert_eq!(tw.read("cfg.yaml"), "service: api\nport: 8080\n");
    }

    let sql_res = tw.run(&["splice", "q.sql:overwrite", "-c", "module sql\nfn foo():\n  ret 1\n"], None);
    assert_eq!(sql_res.status.code(), Some(1));
    assert_eq!(tw.read("q.sql"), "SELECT 1;\n");

    let sh_res = tw.run(&["splice", "mod.sh:create", "-c", "#!/usr/bin/env bash\nmodule bash\nfn hi():\n  ret 0\n"], None);
    assert_eq!(sh_res.status.code(), Some(1));
    assert!(!tw.ws.join("mod.sh").exists());

    // 2. Bug 2: CPython SyntaxError `:=` and hybrid fallback corruption prevented
    let py_orig = "def f(arr, xs, v):\n    return 0\n";
    tw.write("p.py", py_orig);
    for bad in [
        "def f(arr, xs, v):\n    return {y := 1: 2}",
        "def f(arr, xs, v):\n    return {k := x: x for x in xs}",
        "def f(arr, xs, v):\n    return arr[y := 0 : 2]",
        "def f(arr, xs, v):\n    return f'{ {y := 1: 2} }'",
        "def f(arr, xs, v):\n    match v:\n        case [y := 1]:\n            return y\n    return 0",
        "def f(arr, xs, v):\n    return [(x := 1) for x in xs]",
        "def f(arr, xs, v):\n    return [(y := x) for x in xs for y in [1]]",
        "def f(arr, xs, v):\n    type X = (y := int)\n    return X",
        "def f(arr, xs, v):\n    y ::= 1\n    return 0",
        "def f(arr, xs, v):\n    type X := int\n    return X",
    ] {
        let r = tw.run(&["splice", "p.py:f", "-c", bad], None);
        assert_eq!(r.status.code(), Some(1), "expected rc=1 for:\n{bad}");
        assert_eq!(tw.read("p.py"), py_orig);
    }

    // Also block via :L line-range splice
    assert_eq!(tw.run(&["splice", "p.py:L2", "-c", "    y ::= 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("p.py"), py_orig);

    // 3. Bug 3: Valid `match y := v:`, `@y := 1`, f-string format spec, set literal accepted
    let ok_code = concat!(
        "def f(arr, xs, v):\n",
        "    s = {y := 1}\n",
        "    fs = f\"{q := 1:>5}\"\n",
        "    match y := v:\n",
        "        case 1:\n",
        "            return y\n",
        "    @dec := (lambda g: g)\n",
        "    def inner():\n",
        "        return len(s) + len(fs)\n",
        "    return inner()\n",
    );
    let ok_res = tw.run(&["splice", "p.py:f", "-c", ok_code], None);
    assert_eq!(ok_res.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&ok_res.stderr));
    let p_after = tw.read("p.py");
    assert!(p_after.contains("match y := v:") && p_after.contains("@dec := (lambda g: g)") && p_after.contains("f\"{q := 1:>5}\""));
}

#[test]
fn w4_m2_r11_cst_walrus_bw2_nested_fstr_and_context_lowering() {
    let tw = Tw::new("r11_cst");

    // 1. Challenge 1 & Reviewer 2 rejected pre-disk
    for (i, bad) in [
        "with ctx() as (y := 1):\n    pass\n",
        "try:\n    pass\nexcept Exception as (y := 1):\n    pass\n",
        "def f():\n    del (y := 1)\n",
        "def g(a := 1):\n    return a\n",
        "def g(*, a := 1):\n    return a\n",
    ].into_iter().enumerate() {
        let f = format!("bad_{i}.py:create");
        assert_eq!(tw.run(&["splice", &f, "--stdin"], Some(bad)).status.code(), Some(1), "bad={bad}");
        assert!(!tw.ws.join(format!("bad_{i}.py")).exists());
    }

    // 2. Challenge 2 :L positional lowering trap & kw_pos preservation
    let kw_init = "def f():\n    return g(\n        a=1,\n        b=2\n    )\n";
    tw.write("kw.py", kw_init);
    assert_eq!(tw.run(&["splice", "kw.py:L4", "-c", "        y := 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("kw.py"), kw_init);

    let df_init = "def f(\n    a=1,\n    b=2\n):\n    return a + b\n";
    tw.write("df.py", df_init);
    assert_eq!(tw.run(&["splice", "df.py:L3", "-c", "    y := 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("df.py"), df_init);

    tw.write("kw_pos.py", "def f():\n    return g(\n        a,\n        b\n    )\n");
    assert_eq!(tw.run(&["splice", "kw_pos.py:L4", "-c", "        y := 1"], None).status.code(), Some(0));
    assert!(tw.read("kw_pos.py").contains("        y := 1"));

    // 3. Challenge 3 valid edge cases accepted
    let ok_c3 = concat!(
        "def ok(a, xs, v):\n",
        "    x1 = [y := lambda: 1]\n",
        "    x2 = {y := lambda: 1}\n",
        "    x3 = f\"{a and y := 1}\"\n",
        "    x4 = f\"{a + y := 1}\"\n",
        "    x5 = f\"{1:{a + y := 5}}\"\n",
        "    x6 = case([y := 1])\n",
        "    match 1, y := v:\n",
        "        case _:\n",
        "            pass\n",
        "    return [x for a.b in xs if (b := 1)]\n",
    );
    let r3 = tw.run(&["splice", "c3.py:create", "--stdin"], Some(ok_c3));
    assert_eq!(r3.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&r3.stderr));
    assert!(tw.read("c3.py").contains("case([y := 1])"));

    // 4. Challenger 2 B-W2 nested f-string (with/without --force), CRLF, auto_align, and multi-hunk straddle
    let nf_init = "s = f\"outer { f'''unclosed\n\ndef ok(x):\n    return x\n";
    tw.write("nf.py", nf_init);
    for bad_l4 in ["    return y := 1", "    return {y := 1: 2}", "    return [(x := 1) for x in [1]]", "    if x and y := 1:"] {
        assert_eq!(tw.run(&["splice", "nf.py:L4", "-c", bad_l4], None).status.code(), Some(1));
        assert_eq!(tw.run(&["splice", "nf.py:L4", "--force", "-c", bad_l4], None).status.code(), Some(1));
        assert_eq!(tw.read("nf.py"), nf_init);
    }
    assert_eq!(tw.run(&["splice", "nf.py:L4", "-c", "    y := x + 1\n    return y"], None).status.code(), Some(0));
    assert!(tw.read("nf.py").contains("    y = x + 1"));

    tw.write("mix3b.py", "def f(s, x):\n    if (m := s):\n        y = m + 1\n        a = [w := y + 2]\n        return max(y, z := a[0] + 1)\n    return 0\n");
    assert_eq!(tw.run(&["splice", "mix3b.py:L3-L6", "--stdin"], Some("        y := m + 1\n        a := [w := y + 20]\n        return max(y, z := a[0] + 1)\n")).status.code(), Some(0));
    let m3 = tw.read("mix3b.py");
    assert!(m3.contains("a = [w := y + 20]") && m3.contains("    return 0\n"), "m3={m3}");

    let strad_init = "def ok1(x):\n    return x\n\ns = f\"outer { f'''unclosed\n\ndef ok2(x):\n    return x\n";
    tw.write("straddle.py", strad_init);
    assert_eq!(tw.run(&["splice", "--edits", "[{\"file\":\"straddle.py\",\"range\":\"L2\",\"code\":\"    return x + 1\"},{\"file\":\"straddle.py\",\"range\":\"L7\",\"code\":\"    return y := 1\"}]"], None).status.code(), Some(1));
    assert_eq!(tw.read("straddle.py"), strad_init);
}

#[test]
fn w4_m2_r12_fixes_1_to_6_cli_regression() {
    let tw = Tw::new("r12_fixes");

    // Fix 1: no rc=101 panic on trailing_nl == false + \n\n or empty payload
    tw.write("panic1.py", "s = f\"outer { f'''unclosed := 1\nx = 1");
    let p1 = tw.run(&["splice", "panic1.py:L2", "-c", "y := 1\n\n"], None);
    assert_ne!(p1.status.code(), Some(101), "stderr={}", String::from_utf8_lossy(&p1.stderr));
    tw.write("panic2.py", "s = f\"outer { f'''unclosed := 1\n\nreturn 1\n");
    let p2 = tw.run(&["splice", "panic2.py:L3", "-c", ""], None);
    assert_ne!(p2.status.code(), Some(101), "stderr={}", String::from_utf8_lossy(&p2.stderr));

    // Fixes 2, 3, 4: CLI rejections
    for (i, bad) in [
        "r = {k: v := 1 for k in ks}\n",
        "s = f\"{ {x: y := x for x in xs} }\"\n",
        "s = f\"{1 if y := 1 else 2}\"\n",
        "s = f\"{1 if a and y := 1 else 2}\"\n",
        "s = f\"{1:{2 if y := 3 else 4}}\"\n",
        "s = f\"{(x := 1):{2 if y := 3 else 4}}\"\n",
        "s = f\"{lambda: y := 1}\"\n",
        "class C:\n    def m(self, r=[y := x for x in [1]]):\n        return r\n",
        "class C:\n    def m(self, *, r=[y := x for x in [1]]):\n        return r\n",
        "class C:\n    def m(self, x: [y := i for i in [1]]):\n        pass\n",
        "class C:\n    def m(self) -> [y := i for i in [1]]:\n        pass\n",
        "class C:\n    f = lambda r=[y := x for x in [1]]: r\n",
    ].into_iter().enumerate() {
        let tgt = format!("bad_{i}.py:create");
        let r = tw.run(&["splice", &tgt, "--stdin"], Some(bad));
        assert_eq!(r.status.code(), Some(1), "expected rc=1 for:\n{bad}");
        assert!(!tw.ws.join(format!("bad_{i}.py")).exists());
    }

    // Fixes 2, 3, 4: CLI acceptances
    let ok_py = concat!(
        "d = {x: (y := x) for x in [1]}\n",
        "def ok(a, y):\n",
        "    return (f\"{y := 1}\", f\"{a + y := 1}\", f\"{a and y := 1}\", f\"{1:{a + y := 5}}\", f\"{1 if a else y := 2}\", f\"{y := 1 if a else 2}\")\n",
        "class C:\n",
        "    def m(self):\n",
        "        return [y := x for x in [1]]\n",
    );
    let r_ok = tw.run(&["splice", "ok_r12.py:create", "--stdin"], Some(ok_py));
    assert_eq!(r_ok.status.code(), Some(0), "stderr={}", String::from_utf8_lossy(&r_ok.stderr));

    // Fix 5: >400L straddling B-W2 (5 repro variants)
    let mut big = String::from("def f1(x):\n    return alpha_unique\ns = f\"outer { f'''unclosed\n");
    for _ in 0..420 {
        big.push_str("# pad\n");
    }
    big.push_str("def f2(x):\n    return beta_unique\n");
    tw.write("h.py", &big);
    let hunk_illegal = "<<<\n    return alpha_unique\n===\n    return alpha_unique + 1\n>>>\n<<<\n    return beta_unique\n===\n    return y := 1\n>>>\n";
    let hunk_hybrid = "<<<\n    return alpha_unique\n===\n    return alpha_unique + 1\n>>>\n<<<\n    return beta_unique\n===\n    y := 1\n    return y\n>>>\n";
    assert_eq!(tw.run(&["splice", "h.py", "--stdin"], Some(hunk_illegal)).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "h.py", "--force", "--stdin"], Some(hunk_illegal)).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "h.py", "--stdin"], Some(hunk_hybrid)).status.code(), Some(1));
    assert_eq!(tw.run(&["splice", "h.py:L1-L426", "--stdin"], Some(hunk_illegal)).status.code(), Some(1));
    assert_eq!(tw.read("h.py"), big);

    let big2 = format!("s = f\"outer {{ f'''unclosed\n{big}");
    tw.write("h2.py", &big2);
    assert_eq!(tw.run(&["splice", "h2.py", "--stdin"], Some(hunk_illegal)).status.code(), Some(1));
    assert_eq!(tw.read("h2.py"), big2);

    // Fix 6: B-W2 same-indent call
    let si = "def f():\n    bad = (\n    return g(\n    a=1,\n    b=2\n    )\n";
    tw.write("bw2_same_ind.py", si);
    assert_eq!(tw.run(&["splice", "bw2_same_ind.py:L5", "-c", "    y := 1"], None).status.code(), Some(1));
    assert_eq!(tw.read("bw2_same_ind.py"), si);
}

#[test]
fn w4_m2_bom_crlf_splice_and_first_delete_cli_regression() {
    let tw = Tw::new("bom_crlf_cli");
    let init = "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\nexport function second(): number {\r\n  return 2;\r\n}\r\n";
    tw.write("bom.ts", init);

    let r_sym = tw.run(&["splice", "bom.ts:first", "-c", "export function first(): number {\n  return 11;\n}"], None);
    assert_eq!(r_sym.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_sym.stderr));
    let after_sym = tw.read("bom.ts");
    assert!(after_sym.starts_with('\u{FEFF}') && after_sym.contains("\r\n") && after_sym.contains("return 11;"));

    let r_hunk = tw.run(&["splice", "bom.ts:second", "-c", "<<<\n  return 2;\n===\n  return 22;\n>>>"], None);
    assert_eq!(r_hunk.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_hunk.stderr));
    let after_hunk = tw.read("bom.ts");
    assert!(after_hunk.starts_with('\u{FEFF}') && after_hunk.contains("\r\n") && after_hunk.contains("return 22;"));

    let r_del_sym = tw.run(&["splice", "bom.ts", "-s", "first", "--delete"], None);
    assert_eq!(r_del_sym.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_del_sym.stderr));
    let after_del_sym = tw.read("bom.ts");
    assert!(after_del_sym.starts_with('\u{FEFF}') && after_del_sym.contains("\r\n") && !after_del_sym.contains("first"));

    tw.write("bom_l1.ts", "\u{FEFF}export const a = 1;\r\nexport const b = 2;\r\n");
    let r_del_l1 = tw.run(&["splice", "bom_l1.ts:L1", "--delete"], None);
    assert_eq!(r_del_l1.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_del_l1.stderr));
    assert_eq!(tw.read("bom_l1.ts"), "\u{FEFF}export const b = 2;\r\n");

    // C2-R2-G2: L1 replace, L1 multi-line hunk, --insert-before first symbol, :imports, line-1 doc replace/delete
    tw.write("rep_l1.ts", "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\n");
    let r_rep_l1 = tw.run(&["splice", "rep_l1.ts:L1-L1", "-c", "export function first(): number {"], None);
    assert_eq!(r_rep_l1.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_rep_l1.stderr));
    assert_eq!(tw.read("rep_l1.ts"), "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\n");

    let r_mh_l1 = tw.run(
        &["splice", "rep_l1.ts", "-c", "<<<\nexport function first(): number {\n  return 1;\n===\nexport function first(): number {\n  return 77;\n>>>"],
        None,
    );
    assert_eq!(r_mh_l1.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_mh_l1.stderr));
    assert_eq!(tw.read("rep_l1.ts"), "\u{FEFF}export function first(): number {\r\n  return 77;\r\n}\r\n");

    let r_ins = tw.run(&["splice", "rep_l1.ts", "--insert-before", "first", "-c", "export function zero(): number { return 0; }"], None);
    assert_eq!(r_ins.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_ins.stderr));
    let after_ins = tw.read("rep_l1.ts");
    assert!(after_ins.starts_with("\u{FEFF}export function zero()"), "{after_ins:?}");
    assert_eq!(after_ins.matches('\u{FEFF}').count(), 1);

    tw.write("imp.ts", "\u{FEFF}import { a } from './a';\r\nexport const x = a;\r\n");
    let r_imp = tw.run(&["splice", "imp.ts:imports", "-c", "import { b } from './b';"], None);
    assert_eq!(r_imp.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_imp.stderr));
    assert_eq!(tw.read("imp.ts"), "\u{FEFF}import { b } from './b';\r\nexport const x = a;\r\n");

    tw.write(
        "doc_bom.ts",
        "\u{FEFF}/// leading doc\r\nexport function first(): number { return 1; }\r\nexport function second(): number { return 2; }\r\n",
    );
    let r_doc_rep = tw.run(&["splice", "doc_bom.ts:first", "-c", "/// new doc\nexport function first(): number { return 10; }"], None);
    assert_eq!(r_doc_rep.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_doc_rep.stderr));
    let after_doc_rep = tw.read("doc_bom.ts");
    assert!(after_doc_rep.starts_with("\u{FEFF}/// new doc\r\n"), "{after_doc_rep:?}");
    assert!(!after_doc_rep.contains("leading doc"), "{after_doc_rep:?}");

    let r_doc_del = tw.run(&["splice", "doc_bom.ts", "-s", "first", "--delete"], None);
    assert_eq!(r_doc_del.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_doc_del.stderr));
    let after_doc_del = tw.read("doc_bom.ts");
    assert!(after_doc_del.starts_with("\u{FEFF}export function second()"), "{after_doc_del:?}");
    assert!(!after_doc_del.contains("new doc"), "{after_doc_del:?}");

    let r_ow = tw.run(&["splice", "doc_bom.ts:overwrite", "--overwrite", "-c", "export const plain = 1;\n"], None);
    assert_eq!(r_ow.status.code(), Some(0), "{}", String::from_utf8_lossy(&r_ow.stderr));
    assert_eq!(tw.read("doc_bom.ts"), "export const plain = 1;\n");
}
