use std::path::{Path, PathBuf};

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_batch_write::aice_lower::lower_snippet;
use aice_batch_write::ast_splice::{apply_ast_splice, apply_insert_relative};
use aice_batch_write::diff::format_splice_json;
use aice_batch_write::execute_batch_write;
use aice_batch_write::hunk::{extract_hunk_blocks, strip_numbered_gutter_prefixes};
use aice_batch_write::hunk_match::{EnclosingContext, apply_hunk_blocks};
use aice_batch_write::json_manifest::{parse_batch_json, parse_edits_json};
use aice_batch_write::line_splice::{apply_line_range, parse_line_range_selector};
use aice_batch_write::stream_parse::parse_heredoc_stream;
use aice_batch_write::types::{JsonBatchEdit, JsonSpliceInfo};
use aice_governance::{JsonValue, OutputSurface, PipelineRequest, WriteOp, authorize, parse_json};
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

fn empty_op() -> WriteOp {
    WriteOp {
        path: None,
        symbol: None,
        code: None,
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
        batch: None,
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: false,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    }
}

#[test]
fn gutter_stripping_handles_pipes_line_colons_clamped_and_preserves_json_keys() {
    let pipe = "[Clamped L1-L20 -> L1-L10 (EOF)]\n10│   let x = 1;\n11│   return x;";
    assert_eq!(strip_numbered_gutter_prefixes(pipe), "  let x = 1;\n  return x;");

    let colon = "L5: const a = 1;\n6: const b = 2;";
    assert_eq!(strip_numbered_gutter_prefixes(colon), "const a = 1;\nconst b = 2;");

    let json_num_keys = "{\n  10: \"ten\",\n  20: true,\n  30: 123,\n}";
    assert_eq!(strip_numbered_gutter_prefixes(json_num_keys), json_num_keys);
}

#[test]
fn hunk_match_covers_whitespace_tiers_ambiguity_and_closest_context() {
    let src = "export class App {\n  inc(x: number): number {\n    let y = x + 1;\n    return y;\n  }\n}\n";
    let hunks = extract_hunk_blocks("<<<\nlet y = x + 1;\nreturn y;\n===\n    let y = x + 2;\n    return y;\n>>>").unwrap();
    let ctx = EnclosingContext::full_file(None);
    let out = apply_hunk_blocks(src, &hunks, Path::new("app.ts"), LanguageId::TypeScript, "\n", 1, &ctx).unwrap();
    assert!(out.contains("    let y = x + 2;\n    return y;"));

    let dup_src = "fn a() {\n  if flag {\n    return 1;\n  }\n}\nfn b() {\n  if flag {\n    return 1;\n  }\n}\n";
    let dup_hunk = extract_hunk_blocks("<<<\n  if flag {\n    return 1;\n  }\n===\n  if flag {\n    return 2;\n  }\n>>>").unwrap();
    let err_dup = apply_hunk_blocks(dup_src, &dup_hunk, Path::new("dup.rs"), LanguageId::Rust, "\n", 1, &ctx).unwrap_err();
    assert!(err_dup.contains("Ambiguous hunk matched 2 locations") && err_dup.contains("Match #1"));

    let miss_hunk = extract_hunk_blocks("<<<\nlet z = missing();\n===\nlet z = 0;\n>>>").unwrap();
    let err_miss = apply_hunk_blocks(src, &miss_hunk, Path::new("app.ts"), LanguageId::TypeScript, "\n", 1, &ctx).unwrap_err();
    assert!(err_miss.contains("Closest disk context"));
}

#[test]
fn line_range_guards_half_open_auto_align_and_40l_hunk_fallback() {
    assert!(parse_line_range_selector("L50-L10").unwrap().is_err());

    let app = "export class App {\n  inc(step: number): number {\n    return step + 1;\n  }\n}\n";
    // Truncating closing '}' on L2-L4 rejected
    let truncated = "  inc(delta: number): number {\n    return delta + 2;";
    assert!(apply_line_range(app, Some(app), Path::new("app.ts"), Path::new("app.ts"), LanguageId::TypeScript, "\n", 2, 4, truncated, false, false).is_err());

    // Verbatim boundary auto-align when L2-L5 includes trailing unrelated line L5 (L2..L4 replaced)
    let app2 = "export class App {\n  x = 1;\n  y = 2;\n  z = 3;\n  w = 4;\n}\n";
    let verbatim2 = "  x = 1;\n  y = 20;\n  z = 3;";
    let aligned = apply_line_range(app2, Some(app2), Path::new("app.ts"), Path::new("app.ts"), LanguageId::TypeScript, "\n", 2, 5, verbatim2, false, false).unwrap();
    assert_eq!(aligned.end_line, 4);
    assert!(aligned.new_src.contains("y = 20;") && aligned.new_src.contains("w = 4;"));

    // ±40L fallback window when hunk is slightly outside requested line range
    let mut big = String::new();
    for i in 1..=25 {
        big.push_str(&format!("export const c{i} = {i};\n"));
    }
    let hunk_payload = "<<<\nexport const c15 = 15;\n===\nexport const c15 = 150;\n>>>";
    let res = apply_line_range(&big, Some(&big), Path::new("big.ts"), Path::new("big.ts"), LanguageId::TypeScript, "\n", 1, 5, hunk_payload, false, false).unwrap();
    assert!(res.new_src.contains("export const c15 = 150;"));
}

#[test]
fn hybrid_lowering_preserves_go_channels_and_compiles_explicit_aice_ir() {
    let fw = DefaultSyntaxFirewall;
    let go_code = "func drain(ch <-chan string) string {\n\ts := \"ret <-chan literal\"\n\tmsg := <-ch\n\treturn msg + s\n}";
    let out = lower_snippet(go_code, LanguageId::Go, false, false, None, &fw, Path::new("app.go")).unwrap();
    assert!(out.contains("<-ch"));
    assert!(out.contains("\"ret <-chan literal\""));

    let ir = "module sample\npub fn add(a: i32, b: i32) -> i32:\n  ret a + b\n";
    let ts_out = lower_snippet(ir, LanguageId::TypeScript, true, false, None, &fw, Path::new("sample.ts")).unwrap();
    assert!(ts_out.contains("export function add"));
}

#[test]
fn heredoc_stream_parses_modifiers_inheritance_and_rejects_malformed_headers() {
    let stream = concat!(
        "=== src/a.ts:App.inc @replace-docs ===\n",
        "inc() { return 1; }\n",
        "=== :App.reset --delete ===\n",
        "=== src/b.ts:newFn --insert-after oldFn ===\n",
        "export function newFn() {}\n",
    );
    let items = parse_heredoc_stream(stream, &empty_op()).unwrap();
    assert_eq!(items.len(), 3);
    assert!(!items[0].preserve_docs);
    assert_eq!(items[1].file_path, Path::new("src/a.ts"));
    assert!(items[1].delete);
    assert_eq!(items[2].insert_after.as_deref(), Some("oldFn"));

    for bad in ["", "=== ===\ncode\n", "=== src/a.ts:\ncode\n", "=== src/a.ts\ncode\n"] {
        assert!(parse_heredoc_stream(bad, &empty_op()).is_err(), "expected error for {bad:?}");
    }
}

#[test]
fn heredoc_preserves_trailing_eof_txt_sections_and_rust_raw_strings() {
    let p4 = "=== notes.txt ===\ncat <<'EOF'\nhello\nEOF\n";
    let items_p4 = parse_heredoc_stream(p4, &empty_op()).unwrap();
    assert_eq!(items_p4[0].payload, "cat <<'EOF'\nhello\nEOF\n");

    let p4_shell = "=== notes.txt ===\ncat <<'EOF'\nhello\nEOF && echo done\n";
    let items_shell = parse_heredoc_stream(p4_shell, &empty_op()).unwrap();
    assert_eq!(items_shell[0].payload, "cat <<'EOF'\nhello\n");

    let p5 = "=== notes.txt ===\n# Heading\n=== Section Title\nBody\n";
    let items_p5 = parse_heredoc_stream(p5, &empty_op()).unwrap();
    assert_eq!(items_p5.len(), 1);
    assert!(items_p5[0].payload.contains("=== Section Title\nBody"));

    let t2_bad = "=== src/math.ts\nexport const x = 1;\n";
    assert!(parse_heredoc_stream(t2_bad, &empty_op()).is_err());

    let rs_raw = "=== src/a.rs:a ===\npub fn a() -> &'static str {\n    r#\"\n=== /etc/passwd ===\n\"#\n}\n";
    let items_rs = parse_heredoc_stream(rs_raw, &empty_op()).unwrap();
    assert_eq!(items_rs.len(), 1);
    assert!(items_rs[0].payload.contains("=== /etc/passwd ==="));
}

#[test]
fn hunk_preserves_numeric_kv_and_detects_same_line_tier2_ambiguity() {
    assert_eq!(strip_numbered_gutter_prefixes("123: 456"), "123: 456");

    let dup_line = "let x = val + val;\n";
    let h = extract_hunk_blocks("<<<\nval\n===\nother\n>>>").unwrap();
    let err = apply_hunk_blocks(dup_line, &h, Path::new("dup.ts"), LanguageId::TypeScript, "\n", 1, &EnclosingContext::full_file(None)).unwrap_err();
    assert!(err.contains("Ambiguous hunk matched 2 locations"), "got: {err}");
}

#[test]
fn tier6_collapsed_whitespace_hunk_succeeds_in_ts_class_method_and_line_slice() {
    let ts_src = "export class App {\n  inc(x: number): number {\n    const   y  =  x   +  1;\n    return y;\n  }\n}\n";
    let hunk_payload = "<<<\nconst y = x + 1;\nreturn y;\n===\n    const y = x + 42;\n    return y;\n>>>";

    let ast_out = apply_ast_splice(
        ts_src,
        Some(ts_src),
        Path::new("app.ts"),
        LanguageId::TypeScript,
        "\n",
        "App.inc",
        hunk_payload,
        false,
        true,
        false,
    )
    .expect("Tier 6 hunk inside TS class method must validate against enclosing class");
    assert!(ast_out.new_src.contains("const y = x + 42;"), "got:\n{}", ast_out.new_src);

    // Partial :L slice (L3-L4 inside method body, not standalone valid TS)
    let line_out = apply_line_range(
        ts_src,
        Some(ts_src),
        Path::new("app.ts"),
        Path::new("app.ts"),
        LanguageId::TypeScript,
        "\n",
        3,
        4,
        hunk_payload,
        false,
        false,
    )
    .expect("Tier 6 hunk inside :L3-L4 slice must validate against enclosing class");
    assert!(line_out.new_src.contains("const y = x + 42;"), "got:\n{}", line_out.new_src);
}

#[test]
fn utf8_intrablock_inline_block_comment_rust_attr_and_prebroken_ts_fallback() {
    // UTF-8 word_match must not panic when non-matching prefix starts with multi-byte char
    let ts_utf8 = "export function run(über_flag: boolean): number {\n  if (über_flag) {\n    return 1;\n  }\n  return 0;\n}\n";
    let out = apply_ast_splice(ts_utf8, Some(ts_utf8), Path::new("u.ts"), LanguageId::TypeScript, "\n", "run@über", "if (über_flag) {\n    return 2;\n  }", false, true, false).unwrap();
    assert!(out.new_src.contains("return 2;"));

    // Inline trailing /* note */ on preceding code line must not be eaten
    let ts_inline_doc = "const x = 1; /* note */\nexport function foo(): number { return x; }\n";
    let out_doc = apply_ast_splice(ts_inline_doc, Some(ts_inline_doc), Path::new("d.ts"), LanguageId::TypeScript, "\n", "foo", "export function foo(): number { return 42; }", false, false, false).unwrap();
    assert!(out_doc.new_src.contains("const x = 1; /* note */"));

    // Rust #[inline] must not be treated as doc comment when preserve_docs = false
    let rs_attr = "#[inline]\npub fn fast() -> i32 { 1 }\n";
    let out_rs = apply_ast_splice(rs_attr, Some(rs_attr), Path::new("a.rs"), LanguageId::Rust, "\n", "fast", "pub fn fast() -> i32 { 2 }", false, false, false).unwrap();
    assert!(out_rs.new_src.contains("#[inline]"));

    // B-W2 pre-broken TS unclosed '(' fallback
    let broken_ts = "export function broken( {\n  return 1;\n}\n\nexport function clean(x: number): number {\n  return x + 1;\n}\n";
    let out_bw2 = apply_ast_splice(broken_ts, Some(broken_ts), Path::new("b.ts"), LanguageId::TypeScript, "\n", "clean", "export function clean(x: number): number {\n  return x + 2;\n}", false, true, false).unwrap();
    assert!(out_bw2.new_src.contains("return x + 2;"));
}

#[test]
fn edits_json_new_aice_code_and_multi_file_json_formatting() {
    let fw = DefaultSyntaxFirewall;
    let edits_raw = r#"{"filePath":"app.ts","edits":[{"symbol":"f","newAiceCode":"export function f(): number { return 2; }"},{"symbol":"g","newAiceCode":"// ir\npub fn g(x: number) -> number:\n  ret x + 1\n"}]}"#;
    let items = parse_edits_json(edits_raw, &empty_op()).unwrap();
    assert_eq!(items.len(), 2);
    assert!(!items[0].force_aice_ir);
    assert_eq!(items[0].file_path, Path::new("app.ts"));
    let compiled = lower_snippet(&items[1].payload, LanguageId::TypeScript, items[1].force_aice_ir, false, None, &fw, Path::new("app.ts")).unwrap();
    assert!(compiled.contains("function g"), "compiled={compiled}");

    let single = JsonSpliceInfo {
        success: true, file_path: "a.ts".into(), symbol: "f".into(), start_line: 1, end_line: 1,
        original_snippet: "a".into(), new_snippet: "b".into(), modified_code: "b".into(),
        new_aice_source: "b".into(), preserved_trivia_text: String::new(),
        dry_run: false, modified_files: vec![], batch_edits: vec![],
    };
    let s_json = format_splice_json(&single, -10, 0, -10);
    let s_obj = parse_json(&s_json).unwrap();
    assert_eq!(s_obj.as_object().unwrap().len(), 13);

    let multi = JsonSpliceInfo {
        modified_files: vec!["a.ts".into(), "b.ts".into()],
        batch_edits: vec![JsonBatchEdit {
            file_path: "a.ts".into(), symbol: "f".into(), start_line: 1, end_line: 1,
            original_snippet: "a".into(), new_snippet: "b".into(),
        }],
        ..single
    };
    let m_json = format_splice_json(&multi, -20, 0, -20);
    let m_obj = parse_json(&m_json).unwrap();
    let map = m_obj.as_object().unwrap();
    assert_eq!(map.get("totalFiles").and_then(JsonValue::as_u64), Some(2));
    assert_eq!(map.get("totalEdits").and_then(JsonValue::as_u64), Some(1));
    assert!(map.contains_key("modifiedFiles") && map.contains_key("results"));
}

#[test]
fn malformed_and_empty_batch_or_edits_report_manifest_errors_with_rollback_flag() {
    let dir = std::env::temp_dir().join(format!("aice_bw_malformed_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();

    for (batch, edits, expect_sub) in [
        (Some("{bad"), None, "Invalid --batch JSON"),
        (Some("[]"), None, "--batch JSON array must not be empty"),
        (Some(""), None, "Empty --batch payload"),
        (None, Some("{bad"), "Invalid --edits JSON"),
        (None, Some("[]"), "--edits JSON array must not be empty"),
        (None, Some(""), "Invalid --edits JSON"),
    ] {
        let mut op = empty_op();
        op.batch = batch.map(str::to_string);
        op.edits = edits.map(str::to_string);
        let gov = aice_governance::authorize(aice_governance::PipelineRequest::new(
            op.clone(),
            dir.clone(),
            aice_governance::OutputSurface::Cli,
        ))
        .unwrap();
        let report = aice_batch_write::execute_batch_write(gov.state(), &op).unwrap();
        assert_eq!(report.exit_code, 1);
        assert!(report.is_batch_rollback);
        assert!(report.emitted_output.contains(expect_sub), "got: {}", report.emitted_output);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn aice_ir_symbol_splice_unwraps_module_wrappers_and_heredoc_ignores_spoofs() {
    // Go: single package main + preserves import
    let go_src = "package main\n\nimport \"fmt\"\n\nfunc div(a int, b int) int {\n\tfmt.Println(a)\n\treturn a / b\n}\n";
    let go_ir = "fn div(a: int, b: int) -> int:\n  ret a / b + 1\n";
    let go_out = apply_ast_splice(go_src, Some(go_src), Path::new("d.go"), LanguageId::Go, "\n", "div", go_ir, false, true, false).unwrap();
    assert_eq!(go_out.new_src.matches("package main").count(), 1, "go={}", go_out.new_src);
    assert!(go_out.new_src.contains("import \"fmt\"") && go_out.new_src.contains("return a / b + 1"));

    // Java: no nested public class Module inside class App
    let java_src = "public class App {\n    public static int add(int a, int b) {\n        return a + b;\n    }\n}\n";
    let java_ir = "pub fn add(a: int, b: int) -> int:\n  ret a + b + 1\n";
    let java_out = apply_ast_splice(java_src, Some(java_src), Path::new("App.java"), LanguageId::Java, "\n", "App.add", java_ir, false, true, false).unwrap();
    assert!(!java_out.new_src.contains("class Module"), "java={}", java_out.new_src);
    assert!(java_out.new_src.contains("return a + b + 1;"));

    // PHP: no duplicate <?php
    let php_src = "<?php\nfunction add(int $a, int $b): int {\n    return $a + $b;\n}\n";
    let php_ir = "fn add(a: int, b: int) -> int:\n  ret a + b + 1\n";
    let php_out = apply_ast_splice(php_src, Some(php_src), Path::new("a.php"), LanguageId::Php, "\n", "add", php_ir, false, true, false).unwrap();
    assert_eq!(php_out.new_src.matches("<?php").count(), 1, "php={}", php_out.new_src);
    assert!(php_out.new_src.contains("return $a + $b + 1;"));

    // Whole-file lower_snippet still emits complete module wrappers
    let fw = DefaultSyntaxFirewall;
    let go_full = lower_snippet(go_ir, LanguageId::Go, true, false, None, &fw, Path::new("d.go")).unwrap();
    assert!(go_full.contains("package main"));

    // Heredoc spoofing: md closed heading, Rust/TS multiline /* */, TS template literal
    let md_stream = "=== README.md ===\n# Title\n\n=== Section Inside Markdown ===\nBody text.\n=== src/next.ts ===\nexport const X = 1;\n";
    let md_items = parse_heredoc_stream(md_stream, &empty_op()).unwrap();
    assert_eq!(md_items.len(), 2);
    assert_eq!(md_items[0].file_path, Path::new("README.md"));
    assert!(md_items[0].payload.contains("=== Section Inside Markdown ==="));
    assert_eq!(md_items[1].file_path, Path::new("src/next.ts"));

    let code_stream = concat!(
        "=== lib.rs ===\n/*\n=== fake_rs_comment.rs ===\n*/\npub fn ok() -> i32 { 42 }\n",
        "=== a.ts ===\nconst s = `\n=== fake_tpl.ts ===\n${x}\n`;\n/*\n=== fake_cmt.ts ===\n*/\nexport const X = 1;\n",
    );
    let code_items = parse_heredoc_stream(code_stream, &empty_op()).unwrap();
    assert_eq!(code_items.len(), 2);
    assert_eq!(code_items[0].file_path, Path::new("lib.rs"));
    assert_eq!(code_items[1].file_path, Path::new("a.ts"));

    // Empty nested edits array in parse_batch_json fails cleanly
    assert!(parse_batch_json(r#"[{"edits":[]}]"#, &empty_op()).is_err());
    assert!(parse_batch_json(r#"[{"filePath":"a.ts","edits":[]}]"#, &empty_op()).is_err());
}

#[test]
fn standalone_class_ir_go_import_unwrap_and_java_comment_triple_quote_precedence() {
    let fw = DefaultSyntaxFirewall;

    // Bug 1A: standalone `pub class` AICE IR for :create and class symbol splice
    let new_java = lower_snippet(
        "pub class NewApp:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b\n",
        LanguageId::Java,
        false,
        false,
        None,
        &fw,
        Path::new("NewApp.java"),
    )
    .unwrap();
    assert!(new_java.contains("public class NewApp") && new_java.contains("return a + b;"), "got={new_java}");

    let app_java_src = "public class App {\n    public static int add(int a, int b) { return a + b; }\n}\n";
    let app_java_out = apply_ast_splice(
        app_java_src,
        Some(app_java_src),
        Path::new("App.java"),
        LanguageId::Java,
        "\n",
        "App",
        "pub class App:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 2\n",
        false,
        true,
        false,
    )
    .unwrap();
    assert!(app_java_out.new_src.contains("public class App") && app_java_out.new_src.contains("a + b + 2"), "got={}", app_java_out.new_src);

    // Bug 1B: Go symbol splice with `module main\nimport "fmt"` strips top-level import when whole_file == false
    let go_src = "package main\n\nimport \"fmt\"\n\nfunc add(a int, b int) int { return a + b }\n\nfunc div(a int, b int) int {\n\tfmt.Println(a)\n\treturn a / b\n}\n";
    let go_ir = "module main\nimport \"fmt\"\nfn div(a: int, b: int) -> int:\n  fmt.Println(a)\n  ret a / b + 1\n";
    let go_out = apply_ast_splice(go_src, Some(go_src), Path::new("d.go"), LanguageId::Go, "\n", "div", go_ir, false, true, false).unwrap();
    assert_eq!(go_out.new_src.matches("import \"fmt\"").count(), 1, "got={}", go_out.new_src);
    assert_eq!(go_out.new_src.matches("package main").count(), 1, "got={}", go_out.new_src);
    assert!(go_out.new_src.contains("return a / b + 1"));

    // Whole-file lower_snippet keeps import "fmt"
    let go_full = lower_snippet(go_ir, LanguageId::Go, false, false, None, &fw, Path::new("d.go")).unwrap();
    assert!(go_full.contains("import \"fmt\"") && go_full.contains("package main"));

    // Bug 2: Java/C#/Kotlin /* """ */ and // """ do not swallow next section; real """ suppresses fake header
    let stream = concat!(
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
        "=== C.cs ===\n",
        "public class C {\n  /* \"\"\" */\n  string s = \"\"\"\n=== fake.cs ===\n\"\"\";\n}\n",
        "=== D.kt ===\n",
        "class D {\n  /*\n\"\"\"\n*/\n  val s = \"\"\"\n=== fake.kt ===\n\"\"\"\n}\n",
    );
    let items = parse_heredoc_stream(stream, &empty_op()).unwrap();
    assert_eq!(items.len(), 4);
    assert_eq!(items[0].file_path, Path::new("A.java"));
    assert!(items[0].payload.contains("=== fake.java ==="));
    assert_eq!(items[1].file_path, Path::new("B.java"));
    assert_eq!(items[2].file_path, Path::new("C.cs"));
    assert!(items[2].payload.contains("=== fake.cs ==="));
    assert_eq!(items[3].file_path, Path::new("D.kt"));
    assert!(items[3].payload.contains("=== fake.kt ==="));
}

#[test]
fn plaintext_and_native_python_subclasses_preserved_and_multi_lang_aice_ir_works() {
    let fw = DefaultSyntaxFirewall;

    // Finding 1: PlainText payloads matching AICE IR headers must never compile to ""
    for txt in [
        "class Notes:\n  x = 1\n",
        "module architecture\nconst x = 1\n",
        "fn f():\n  ret 1\n",
        "data Config:\n  x = 1\n",
        "table users:\n  id int\n",
    ] {
        let out = lower_snippet(txt, LanguageId::PlainText, false, false, None, &fw, Path::new("notes.txt")).unwrap();
        assert_eq!(out, txt, "PlainText truncated/altered for {txt:?}");
    }

    // Finding 2: Native Python subclasses and @classmethod cls parameter stay intact
    for py in [
        "class Foo(Base):\n    x = 1\n",
        "class User(BaseModel):\n    name: str\n",
        "class Sub(Base):\n    @classmethod\n    def make(cls):\n        return cls()\n",
    ] {
        let out = lower_snippet(py, LanguageId::Python, false, false, None, &fw, Path::new("pycls.py")).unwrap();
        assert_eq!(out, py, "Native Python corrupted: {out}");
    }
    let py_src = "class User(BaseModel):\n    name: str\n";
    let py_splice = apply_ast_splice(
        py_src,
        Some(py_src),
        Path::new("user.py"),
        LanguageId::Python,
        "\n",
        "User",
        "class User(BaseModel):\n    name: str\n    age: int = 0\n",
        false,
        true,
        false,
    )
    .unwrap();
    assert!(py_splice.new_src.contains("class User(BaseModel):"), "got={}", py_splice.new_src);

    // Go leading comment + module + import stripped on symbol splice
    let go_src = "package main\n\nimport \"fmt\"\n\nfunc div(a int, b int) int {\n\tfmt.Println(a)\n\treturn a / b\n}\n";
    let go_ir = "// note\nmodule main\nimport \"fmt\"\nfn div(a: int, b: int) -> int:\n  fmt.Println(a)\n  ret a / b + 2\n";
    let go_out = apply_ast_splice(go_src, Some(go_src), Path::new("d.go"), LanguageId::Go, "\n", "div", go_ir, false, true, false).unwrap();
    assert_eq!(go_out.new_src.matches("import \"fmt\"").count(), 1, "got={}", go_out.new_src);
    assert!(go_out.new_src.contains("// note") && go_out.new_src.contains("return a / b + 2"));

    // Legitimate AICE IR across Python, TypeScript, Rust, Kotlin, PHP continues to lower cleanly
    let py_ir = lower_snippet("pub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b\n", LanguageId::Python, false, false, None, &fw, Path::new("c.py")).unwrap();
    assert!(py_ir.contains("class Calc:") && py_ir.contains("return a + b"), "py_ir={py_ir}");
    let py_ext = lower_snippet("class Sub extends Base:\n  fn f() -> int:\n    ret 1\n", LanguageId::Python, false, false, None, &fw, Path::new("c.py")).unwrap();
    assert!(py_ext.contains("class Sub(Base):") && py_ext.contains("return 1"), "py_ext={py_ext}");
    let ts_ir = lower_snippet("pub class User:\n  name: str\n", LanguageId::TypeScript, false, false, None, &fw, Path::new("app.ts")).unwrap();
    assert!(ts_ir.contains("export class User") && ts_ir.contains("name: string"), "ts_ir={ts_ir}");
    let rs_ir = lower_snippet("pub struct Point:\n  x: i32\n  y: i32\n", LanguageId::Rust, false, false, None, &fw, Path::new("a.rs")).unwrap();
    assert!(rs_ir.contains("pub struct Point") && rs_ir.contains("x: i32"), "rs_ir={rs_ir}");
    let kt_ir = lower_snippet("pub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b\n", LanguageId::Kotlin, false, false, None, &fw, Path::new("a.kt")).unwrap();
    assert!(kt_ir.contains("class Calc") && kt_ir.contains("return a + b"), "kt_ir={kt_ir}");
    let php_ir = lower_snippet("pub class Calc:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b\n", LanguageId::Php, false, false, None, &fw, Path::new("a.php")).unwrap();
    assert!(php_ir.contains("class Calc") && php_ir.contains("return $a + $b;"), "php_ir={php_ir}");
}

#[test]
fn c_cpp_include_stripping_non_standalone_splices_and_extensionless_heredoc_guards() {
    // 1. C / C++ #include stripping + leading // comment + Python # comment
    let c_src = "#include <stdio.h>\n\nint add(int a, int b) {\n    return a + b;\n}\n";
    let c_ir = "// note\nmodule main\nimport \"<stdio.h>\"\nfn add(a: int, b: int) -> int:\n  ret a + b + 1\n";
    let c_out = apply_ast_splice(c_src, Some(c_src), Path::new("main.c"), LanguageId::C, "\n", "add", c_ir, false, true, false).unwrap();
    assert_eq!(c_out.new_src.matches("#include <stdio.h>").count(), 1, "c={}", c_out.new_src);
    assert!(c_out.new_src.contains("// note") && c_out.new_src.contains("return a + b + 1;"), "c={}", c_out.new_src);

    let cpp_src = "#include <vector>\n\nclass Math {\npublic:\n    int add(int a, int b) {\n        return a + b;\n    }\n};\n";
    let cpp_ir = "// note\nmodule main\nimport \"<vector>\"\nfn add(a: int, b: int) -> int:\n  ret a + b + 2\n";
    let cpp_out = apply_ast_splice(cpp_src, Some(cpp_src), Path::new("math.cpp"), LanguageId::Cpp, "\n", "Math.add", cpp_ir, false, true, false).unwrap();
    assert_eq!(cpp_out.new_src.matches("#include <vector>").count(), 1, "cpp={}", cpp_out.new_src);
    assert!(!cpp_out.new_src.split("class Math").nth(1).unwrap().contains("#include"), "cpp={}", cpp_out.new_src);
    assert!(cpp_out.new_src.contains("// note") && cpp_out.new_src.contains("return a + b + 2;"), "cpp={}", cpp_out.new_src);

    let py_src = "import os\n\ndef f(x: int) -> int:\n    return x\n";
    let py_ir = "# note\nimport \"os\"\nfn f(x: int) -> int:\n  ret x + 1\n";
    let py_out = apply_ast_splice(py_src, Some(py_src), Path::new("p.py"), LanguageId::Python, "\n", "f", py_ir, false, true, false).unwrap();
    assert_eq!(py_out.new_src.matches("import os").count(), 1, "py={}", py_out.new_src);
    assert!(!py_out.new_src.contains("import \"os\""), "py={}", py_out.new_src);
    assert!(py_out.new_src.contains("def f(x: int) -> int:") && py_out.new_src.contains("# note") && py_out.new_src.contains("return x + 1"), "py={}", py_out.new_src);
    assert!(matches!(DefaultSyntaxFirewall.verify_incremental(Some(py_src), &py_out.new_src, Path::new("p.py"), LanguageId::Python), FirewallVerdict::Valid), "py={}", py_out.new_src);

    // 2. Non-standalone Python & TS :L splices preserve cls, :=, and ret;
    let py_else = "def f(x, cls):\n    if x:\n        return 1\n    else:\n        return 0\n";
    let py_else_out = apply_line_range(py_else, Some(py_else), Path::new("py_else.py"), Path::new("py_else.py"), LanguageId::Python, "\n", 4, 5, "    else:\n        return cls(42)", false, false).unwrap();
    assert!(py_else_out.new_src.contains("return cls(42)") && !py_else_out.new_src.contains("class(42)"));

    let walrus = "def f(s, p1, p2):\n    if (m := p1(s)):\n        return m\n    elif (m := p2(s)):\n        return m\n";
    let walrus_out = apply_line_range(walrus, Some(walrus), Path::new("walrus.py"), Path::new("walrus.py"), LanguageId::Python, "\n", 4, 5, "    elif (m := p2(s)):\n        return m + 1", false, false).unwrap();
    assert!(walrus_out.new_src.contains("elif (m := p2(s)):") && walrus_out.new_src.contains("return m + 1"));

    let sw_ts = "export function f(x: number, cls: number): number {\n  switch (x) {\n    case 1: {\n      const y = cls;\n      return y;\n    }\n    default:\n      return 0;\n  }\n}\n";
    let sw_out = apply_line_range(sw_ts, Some(sw_ts), Path::new("sw.ts"), Path::new("sw.ts"), LanguageId::TypeScript, "\n", 3, 6, "    case 1: {\n      const cls = 99;\n      return cls;\n    }", false, false).unwrap();
    assert!(sw_out.new_src.contains("const cls = 99;") && sw_out.new_src.contains("return cls;"));

    let app_ts = "export class App {\n  public inc(cls: number): number {\n    return cls + 1;\n  }\n}\n";
    let app_l_out = apply_line_range(app_ts, Some(app_ts), Path::new("app.ts"), Path::new("app.ts"), LanguageId::TypeScript, "\n", 2, 4, "  public inc(cls: number): number {\n    return cls + 2;\n  }", false, false).unwrap();
    assert!(app_l_out.new_src.contains("inc(cls: number)") && app_l_out.new_src.contains("return cls + 2;"));

    let ret_expr = "export function pick(x: number, ret: number): number {\n  switch (x) {\n    case 1:\n      ret;\n      return 1;\n    default:\n      return 0;\n  }\n}\n";
    let ret_out = apply_line_range(ret_expr, Some(ret_expr), Path::new("ret_expr.ts"), Path::new("ret_expr.ts"), LanguageId::TypeScript, "\n", 3, 5, "    case 1:\n      ret;\n      return 2;", false, false).unwrap();
    assert!(ret_out.new_src.contains("      ret;\n      return 2;") && !ret_out.new_src.contains("return;"));

    // ast_splice also preserves ret;
    let ret_ast = apply_ast_splice(ret_expr, Some(ret_expr), Path::new("ret_expr.ts"), LanguageId::TypeScript, "\n", "pick", "export function pick(x: number, ret: number): number {\n  switch (x) {\n    case 1:\n      ret;\n      return 3;\n    default:\n      return 0;\n  }\n}", false, true, false).unwrap();
    assert!(ret_ast.new_src.contains("      ret;\n      return 3;") && !ret_ast.new_src.contains("return;"));

    // 3. --insert-after / --insert-before with cls and ret; including B-W2 pre-broken file
    let ins_after = apply_insert_relative(app_ts, Some(app_ts), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", true, "public make(cls: string): string { return cls; }", false).unwrap();
    assert!(ins_after.new_src.contains("public make(cls: string): string { return cls; }"));

    let ins_before = apply_insert_relative(app_ts, Some(app_ts), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", false, "public pre(ret: number): number { ret; return 1; }", false).unwrap();
    assert!(ins_before.new_src.contains("ret; return 1;") && !ins_before.new_src.contains("return;"));

    let broken_app = "export function broken( {\n  return 1;\n}\nexport class App {\n  public inc(x: number): number {\n    return x + 1;\n  }\n}\n";
    let bw2_ins = apply_insert_relative(broken_app, Some(broken_app), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", true, "public make(cls: string): string { return cls; }", false).unwrap();
    assert!(bw2_ins.new_src.contains("public make(cls: string): string { return cls; }"));

    // 4. Half-open assignment guard still rejects off-by-one edits even with raw-first
    let half_open_src = "const a = 1;\nconst b = 2;\nconst c = 3;\nconst d = 4;\nconsole.log(d);\n";
    assert!(apply_line_range(half_open_src, Some(half_open_src), Path::new("ho.ts"), Path::new("ho.ts"), LanguageId::TypeScript, "\n", 1, 4, "const a = 10;\nconst b = 2;\nconst c = 3;", false, false).is_err());

    // 5. Extensionless Makefile odd ''' vs #!/usr/bin/env python3
    let mk_stream = "=== Makefile:create ===\nall:\n\techo '''hello\n=== after_mk.txt:create ===\nhello world\n";
    let mk_items = parse_heredoc_stream(mk_stream, &empty_op()).unwrap();
    assert_eq!(mk_items.len(), 2);
    assert_eq!(mk_items[0].file_path, Path::new("Makefile"));
    assert_eq!(mk_items[1].file_path, Path::new("after_mk.txt"));

    let py_tool = "=== bin/tool:create ===\n#!/usr/bin/env python3\nDOC = '''\n=== /etc/passwd ===\n'''\n";
    let py_items = parse_heredoc_stream(py_tool, &empty_op()).unwrap();
    assert_eq!(py_items.len(), 1);
    assert_eq!(py_items[0].file_path, Path::new("bin/tool"));
    assert!(py_items[0].payload.contains("=== /etc/passwd ==="));
}

#[test]
fn w4_m2_r8_bug1_aice_ir_leading_headers_and_preservations() {
    let fw = DefaultSyntaxFirewall;

    // Ruby # comment + import
    let rb_src = "require 'json'\n\ndef greet(name)\n  name\nend\n";
    let rb_ir = "# rb-note\nimport \"json\"\nfn greet(name: str) -> str:\n  ret name\n";
    let rb_out = apply_ast_splice(rb_src, Some(rb_src), Path::new("app.rb"), LanguageId::Ruby, "\n", "greet", rb_ir, false, true, false).unwrap();
    assert_eq!(rb_out.new_src.matches("require 'json'").count(), 1, "rb={}", rb_out.new_src);
    assert!(!rb_out.new_src.contains("import \"json\""), "rb={}", rb_out.new_src);
    assert!(rb_out.new_src.contains("# rb-note"), "rb={}", rb_out.new_src);
    assert!(matches!(fw.verify_incremental(Some(rb_src), &rb_out.new_src, Path::new("app.rb"), LanguageId::Ruby), FirewallVerdict::Valid));

    // Rust // comment + import + directive #[inline]
    let rs_src = "use std::fmt;\n\npub fn add(a: i32, b: i32) -> i32 {\n    a + b\n}\n";
    let rs_ir = "// rs-note\nimport \"std::fmt\"\ndirective #[inline]\npub fn add(a: i32, b: i32) -> i32:\n  ret a + b + 1\n";
    let rs_out = apply_ast_splice(rs_src, Some(rs_src), Path::new("lib.rs"), LanguageId::Rust, "\n", "add", rs_ir, false, true, false).unwrap();
    assert_eq!(rs_out.new_src.matches("use std::fmt;").count(), 1, "rs={}", rs_out.new_src);
    assert!(rs_out.new_src.contains("#[inline]") && rs_out.new_src.contains("// rs-note"), "rs={}", rs_out.new_src);
    assert!(!rs_out.new_src.contains("directive") && !rs_out.new_src.contains("import \"std::fmt\""), "rs={}", rs_out.new_src);
    assert!(matches!(fw.verify_incremental(Some(rs_src), &rs_out.new_src, Path::new("lib.rs"), LanguageId::Rust), FirewallVerdict::Valid));

    // Multi-line block comment + pub import + @decorator
    let py_src = "import os\n\ndef f(x: int) -> int:\n    return x\n";
    let blk_ir = "/* note\n   line 2 */\npub import \"os\"\n@dec\nfn f(x: int) -> int:\n  ret x + 1\n";
    let blk_out = apply_ast_splice(py_src, Some(py_src), Path::new("p.py"), LanguageId::Python, "\n", "f", blk_ir, false, true, false).unwrap();
    assert!(!blk_out.new_src.contains("import \"os\"") && blk_out.new_src.contains("@dec"), "blk={}", blk_out.new_src);
    assert!(matches!(fw.verify_incremental(Some(py_src), &blk_out.new_src, Path::new("p.py"), LanguageId::Python), FirewallVerdict::Valid));

    // Preservation: native Python, native Rust #![...], PlainText .txt, B-W2 pre-broken Python, non-skipped export/extern/use
    let native_py = "# comment\nclass Foo(Base):\n    x = 1\n";
    assert_eq!(lower_snippet(native_py, LanguageId::Python, false, false, None, &fw, Path::new("f.py")).unwrap(), native_py);
    let native_rs = "#![allow(dead_code)]\n#[inline]\npub fn foo() {}\n";
    assert_eq!(lower_snippet(native_rs, LanguageId::Rust, false, false, None, &fw, Path::new("f.rs")).unwrap(), native_rs);
    let plain_txt = "# note\nimport \"os\"\nfn f():\n  ret 1\n";
    assert_eq!(lower_snippet(plain_txt, LanguageId::PlainText, false, false, None, &fw, Path::new("notes.txt")).unwrap(), plain_txt);

    let broken_py = "def broken(:\n    return 1\n\nimport os\n\ndef f(x: int) -> int:\n    return x\n";
    let bw2_ir = "# note\nimport \"os\"\nfn f(x: int) -> int:\n  ret x + 1\n";
    let bw2_out = apply_ast_splice(broken_py, Some(broken_py), Path::new("b.py"), LanguageId::Python, "\n", "f", bw2_ir, false, true, false).unwrap();
    assert!(!bw2_out.new_src.contains("import \"os\"") && bw2_out.new_src.contains("return x + 1"), "bw2={}", bw2_out.new_src);
    assert!(matches!(fw.verify_incremental(Some(broken_py), &bw2_out.new_src, Path::new("b.py"), LanguageId::Python), FirewallVerdict::Valid));
    for kw in ["export", "extern", "use"] {
        let non_ir = format!("{kw}\nimport \"os\"\nfn f():\n  ret 1\n");
        let lowered = lower_snippet(&non_ir, LanguageId::Rust, false, false, None, &fw, Path::new("k.rs")).unwrap();
        assert!(lowered.contains("import \"os\""), "keyword {kw} must not be skipped: {lowered}");
    }
}

#[test]
fn w4_m2_r8_bug2_single_class_unwrapping_all_7_languages_and_guards() {
    let fw = DefaultSyntaxFirewall;

    // T1 & T2: C++ class + import + namespace + priv fn
    let cpp_src = "#include <vector>\n\nclass Math {\npublic:\n    int add(int a, int b) {\n        return a + b;\n    }\n};\n";
    let cpp_ir = "module main\nimport \"<vector>\"\nclass Math:\n  pub fn add(a: int, b: int) -> int:\n    ret a + b + 3\n";
    let cpp_out = apply_ast_splice(cpp_src, Some(cpp_src), Path::new("math.cpp"), LanguageId::Cpp, "\n", "Math::add", cpp_ir, false, true, false).unwrap();
    assert_eq!(cpp_out.new_src.matches("class Math").count(), 1, "cpp={}", cpp_out.new_src);
    assert_eq!(cpp_out.new_src.matches("public:").count(), 1, "cpp={}", cpp_out.new_src);
    assert_eq!(cpp_out.new_src.matches("#include <vector>").count(), 1, "cpp={}", cpp_out.new_src);
    assert!(cpp_out.new_src.contains("return a + b + 3;") && matches!(fw.verify(&cpp_out.new_src, Path::new("math.cpp"), LanguageId::Cpp), FirewallVerdict::Valid));

    let cpp_ns_src = "namespace myns {\nclass Math {\nprivate:\n    int secret() { return 1; }\n};\n}\n";
    let cpp_ns_ir = "module myns\nclass Math:\n  priv fn secret() -> int:\n    ret 7\n";
    let cpp_ns_out = apply_ast_splice(cpp_ns_src, Some(cpp_ns_src), Path::new("ns.cpp"), LanguageId::Cpp, "\n", "myns::Math::secret", cpp_ns_ir, false, true, false).unwrap();
    assert_eq!(cpp_ns_out.new_src.matches("namespace myns").count(), 1, "cpp_ns={}", cpp_ns_out.new_src);
    assert_eq!(cpp_ns_out.new_src.matches("class Math").count(), 1, "cpp_ns={}", cpp_ns_out.new_src);
    assert!(cpp_ns_out.new_src.contains("return 7;") && matches!(fw.verify(&cpp_ns_out.new_src, Path::new("ns.cpp"), LanguageId::Cpp), FirewallVerdict::Valid));

    // T3-T8: TS, TSX, JS, Python (@dataclass + # comment + import), Dart, Rust (pub class & class)
    let ts_src = "export class App {\n  /// doc\n  public inc(x: number): number {\n    return x + 1;\n  }\n}\n";
    let ts_ir = "module ts\npub class App:\n  pub fn inc(x: number) -> number:\n    ret x + 2\n";
    let ts_out = apply_ast_splice(ts_src, Some(ts_src), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", ts_ir, false, true, false).unwrap();
    assert_eq!(ts_out.new_src.matches("class App").count(), 1, "ts={}", ts_out.new_src);
    assert!(ts_out.new_src.contains("/// doc") && ts_out.new_src.contains("return x + 2;") && matches!(fw.verify(&ts_out.new_src, Path::new("app.ts"), LanguageId::TypeScript), FirewallVerdict::Valid));

    let tsx_src = "export class Card {\n  public render(): string {\n    return \"hi\";\n  }\n}\n";
    let tsx_ir = "module tsx\npub class Card:\n  pub fn render() -> string:\n    ret \"ok\"\n";
    let tsx_out = apply_ast_splice(tsx_src, Some(tsx_src), Path::new("card.tsx"), LanguageId::Tsx, "\n", "Card.render", tsx_ir, false, true, false).unwrap();
    assert_eq!(tsx_out.new_src.matches("class Card").count(), 1, "tsx={}", tsx_out.new_src);
    assert!(tsx_out.new_src.contains("return \"ok\";") && matches!(fw.verify(&tsx_out.new_src, Path::new("card.tsx"), LanguageId::Tsx), FirewallVerdict::Valid));

    let js_src = "export class Calc {\n  add(a, b) {\n    return a + b;\n  }\n}\n";
    let js_ir = "module js\npub class Calc:\n  fn add(a, b):\n    ret a + b + 2\n";
    let js_out = apply_ast_splice(js_src, Some(js_src), Path::new("calc.js"), LanguageId::JavaScript, "\n", "Calc.add", js_ir, false, true, false).unwrap();
    assert_eq!(js_out.new_src.matches("class Calc").count(), 1, "js={}", js_out.new_src);
    assert!(js_out.new_src.contains("return a + b + 2;") && matches!(fw.verify(&js_out.new_src, Path::new("calc.js"), LanguageId::JavaScript), FirewallVerdict::Valid));

    let py_src = "import math\n\nclass Calc:\n    def add(self, a: int, b: int) -> int:\n        return a + b\n";
    let py_ir = "# py-cls-note\nmodule python\nimport \"math\"\n@dataclass\nclass Calc:\n  fn add(self, a: int, b: int) -> int:\n    ret a + b + 2\n";
    let py_out = apply_ast_splice(py_src, Some(py_src), Path::new("calc.py"), LanguageId::Python, "\n", "Calc.add", py_ir, false, true, false).unwrap();
    assert_eq!(py_out.new_src.matches("class Calc:").count(), 1, "py={}", py_out.new_src);
    assert!(!py_out.new_src.contains("@dataclass") && py_out.new_src.contains("# py-cls-note"), "py={}", py_out.new_src);
    assert!(py_out.new_src.contains("return a + b + 2") && matches!(fw.verify(&py_out.new_src, Path::new("calc.py"), LanguageId::Python), FirewallVerdict::Valid));

    let dart_src = "import 'dart:math';\n\nclass Calc {\n  int add(int a, int b) {\n    return a + b;\n  }\n}\n";
    let dart_ir = "module dart\nimport \"dart:math\"\nclass Calc:\n  fn add(a: int, b: int) -> int:\n    ret a + b + 2\n";
    let dart_out = apply_ast_splice(dart_src, Some(dart_src), Path::new("calc.dart"), LanguageId::Dart, "\n", "Calc.add", dart_ir, false, true, false).unwrap();
    assert_eq!(dart_out.new_src.matches("class Calc").count(), 1, "dart={}", dart_out.new_src);
    assert!(dart_out.new_src.contains("return a + b + 2;") && matches!(fw.verify(&dart_out.new_src, Path::new("calc.dart"), LanguageId::Dart), FirewallVerdict::Valid));

    let rs_src = "use std::fmt;\n\npub struct Calc;\n\nimpl Calc {\n    pub fn add(&self, a: i32, b: i32) -> i32 {\n        a + b\n    }\n}\n";
    for rs_ir in [
        "module rust\nimport \"std::fmt\"\npub class Calc:\n  pub fn add(&self, a: i32, b: i32) -> i32:\n    ret a + b + 2\n",
        "module rust\nclass Calc:\n  pub fn add(&self, a: i32, b: i32) -> i32:\n    ret a + b + 2\n",
    ] {
        let rs_out = apply_ast_splice(rs_src, Some(rs_src), Path::new("calc.rs"), LanguageId::Rust, "\n", "Calc::add", rs_ir, false, true, false).unwrap();
        assert_eq!(rs_out.new_src.matches("struct Calc;").count(), 1, "rs={}", rs_out.new_src);
        assert_eq!(rs_out.new_src.matches("impl Calc").count(), 1, "rs={}", rs_out.new_src);
        assert!(rs_out.new_src.contains("a + b + 2") && matches!(fw.verify(&rs_out.new_src, Path::new("calc.rs"), LanguageId::Rust), FirewallVerdict::Valid), "rs={}", rs_out.new_src);
    }

    // T9: Whole-class splices preserve class/struct/impl declarations
    let whole_ts = apply_ast_splice(ts_src, Some(ts_src), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App", ts_ir, false, true, false).unwrap();
    assert!(whole_ts.new_src.contains("export class App {"));
    let whole_py = apply_ast_splice(py_src, Some(py_src), Path::new("calc.py"), LanguageId::Python, "\n", "Calc", py_ir, false, true, false).unwrap();
    assert!(whole_py.new_src.contains("class Calc:") && whole_py.new_src.contains("@dataclass"));
    let whole_rs = apply_ast_splice(rs_src, Some(rs_src), Path::new("calc.rs"), LanguageId::Rust, "\n", "Calc", "module rust\npub class Calc:\n  pub fn add(&self, a: i32, b: i32) -> i32:\n    ret a + b\n", false, true, false).unwrap();
    assert!(whole_rs.new_src.contains("pub struct Calc;"));

    // T10 & T11: Multi-method guard & --insert-after unwrap
    let two_m = "module ts\npub class App:\n  pub fn a() -> number:\n    ret 1\n  pub fn b() -> number:\n    ret 2\n";
    let two_m_out = apply_ast_splice(ts_src, Some(ts_src), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", two_m, false, true, false).unwrap();
    assert!(two_m_out.new_src.matches("class App").count() > 1);
    let ins_ir = "module ts\npub class App:\n  pub fn dec(x: number) -> number:\n    ret x - 1\n";
    let ins_out = apply_insert_relative(ts_src, Some(ts_src), Path::new("app.ts"), LanguageId::TypeScript, "\n", "App.inc", true, ins_ir, false).unwrap();
    assert_eq!(ins_out.new_src.matches("class App").count(), 1, "ins={}", ins_out.new_src);
    assert!(ins_out.new_src.contains("dec(x: number): number") && matches!(fw.verify(&ins_out.new_src, Path::new("app.ts"), LanguageId::TypeScript), FirewallVerdict::Valid));
}

#[test]
fn w4_m2_r8_bug3_python_walrus_lowering_and_firewall() {
    let dir = std::env::temp_dir().join(format!("aice_bw_walrus_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // :symbol lowers y := x + 1
    let p = dir.join("hyb.py");
    std::fs::write(&p, "def old(x):\n    return x\n").unwrap();
    let mut op = empty_op();
    op.dry_run = false;
    op.path = Some(PathBuf::from("hyb.py"));
    op.symbol = Some("old".into());
    op.code = Some("def old(x):\n    y := x + 1\n    return y".into());
    let rep = run_op(op);
    assert_eq!(rep.exit_code, 0, "{}", rep.emitted_output);
    let on_disk = std::fs::read_to_string(&p).unwrap();
    assert!(on_disk.contains("y = x + 1") && !on_disk.contains(":="), "disk={on_disk}");

    // :L, :create, :overwrite, :eof, --insert-after lower standalone y := x + 1
    let mut op_l = empty_op();
    op_l.dry_run = false;
    op_l.path = Some(PathBuf::from("hyb.py"));
    op_l.symbol = Some("L2-L3".into());
    op_l.code = Some("    y := x + 2\n    return y".into());
    assert_eq!(run_op(op_l).exit_code, 0);
    assert!(std::fs::read_to_string(&p).unwrap().contains("y = x + 2"));

    let mut op_cr = empty_op();
    op_cr.dry_run = false;
    op_cr.create = true;
    op_cr.path = Some(PathBuf::from("created.py"));
    op_cr.code = Some("def mk(x):\n    y := x + 3\n    return y\n".into());
    assert_eq!(run_op(op_cr).exit_code, 0);
    assert!(std::fs::read_to_string(dir.join("created.py")).unwrap().contains("y = x + 3"));

    let mut op_ins = empty_op();
    op_ins.dry_run = false;
    op_ins.path = Some(PathBuf::from("hyb.py"));
    op_ins.insert_after = Some("old".into());
    op_ins.code = Some("def nxt(x):\n    z := x + 4\n    return z".into());
    assert_eq!(run_op(op_ins).exit_code, 0);
    assert!(std::fs::read_to_string(&p).unwrap().contains("z = x + 4"));

    // :hunk with unlowered y := x + 1 is blocked pre-disk
    let before_hunk = std::fs::read_to_string(&p).unwrap();
    let mut op_hunk = empty_op();
    op_hunk.dry_run = false;
    op_hunk.path = Some(PathBuf::from("hyb.py"));
    op_hunk.symbol = Some("old".into());
    op_hunk.code = Some("<<<\n    return y\n===\n    w := 9\n    return w\n>>>".into());
    let hunk_rep = run_op(op_hunk);
    assert_eq!(hunk_rep.exit_code, 1, "hunk should fail");
    assert_eq!(std::fs::read_to_string(&p).unwrap(), before_hunk);

    // Illegal non-standalone := statements are blocked pre-disk
    for bad in [
        "def old(x):\n    return y := 1",
        "def old(x):\n    a = y := 1\n    return a",
        "def old(x):\n    assert y := 1\n    return x",
        "def old(x):\n    f = lambda: y := 1\n    return f",
        "def old(x):\n    if True: y := 1\n    return x",
        "def old(x):\n    y := \n    return x",
    ] {
        let mut bad_op = empty_op();
        bad_op.dry_run = false;
        bad_op.path = Some(PathBuf::from("hyb.py"));
        bad_op.symbol = Some("old".into());
        bad_op.code = Some(bad.into());
        let bad_rep = run_op(bad_op);
        assert_eq!(bad_rep.exit_code, 1, "expected reject for: {bad}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), before_hunk);
    }

    // Valid PEP 572 + strings/comments preserved verbatim
    let pep_p = dir.join("pep.py");
    std::fs::write(&pep_p, "def f(s, p1, p2, xs):\n    return 0\n").unwrap();
    let pep_code = "def f(s, p1, p2, xs):\n    if m := p1(s):\n        return m\n    elif (m := p2(s)):\n        return m\n    while (l := p1(s)):\n        break\n    z = (y := len(xs) + 1)\n    comp = [w := x for x in xs]\n    fstr = f\"{q := 1}\"\n    lit = \"y := 1\"\n    tri = \"\"\"\ny := 1\n\"\"\"\n    # y := 1\n    return z + len(comp) + len(fstr) + len(lit) + len(tri)\n";
    let mut pep_op = empty_op();
    pep_op.dry_run = false;
    pep_op.path = Some(PathBuf::from("pep.py"));
    pep_op.symbol = Some("f".into());
    pep_op.code = Some(pep_code.into());
    let pep_rep = run_op(pep_op);
    assert_eq!(pep_rep.exit_code, 0, "{}", pep_rep.emitted_output);
    let pep_disk = std::fs::read_to_string(&pep_p).unwrap();
    assert!(pep_disk.contains("if m := p1(s):") && pep_disk.contains("elif (m := p2(s)):") && pep_disk.contains("\"y := 1\"") && pep_disk.contains("# y := 1"));

    // B-W2 pre-broken Python file: untouched prefix walrus ignored, editing line 1 rejected
    let bw2_p = dir.join("bw2.py");
    std::fs::write(&bw2_p, "broken_walrus := 1\n\n\ndef ok(x):\n    return x\n").unwrap();
    let mut bw2_ok = empty_op();
    bw2_ok.dry_run = false;
    bw2_ok.path = Some(PathBuf::from("bw2.py"));
    bw2_ok.symbol = Some("L4-L5".into());
    bw2_ok.code = Some("def ok(x):\n    return x + 1".into());
    assert_eq!(run_op(bw2_ok).exit_code, 0);
    let mut bw2_bad = empty_op();
    bw2_bad.dry_run = false;
    bw2_bad.path = Some(PathBuf::from("bw2.py"));
    bw2_bad.symbol = Some("L1-L1".into());
    bw2_bad.code = Some("a = bad := 2".into());
    assert_eq!(run_op(bw2_bad).exit_code, 1);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn w4_m2_r9_compound_walrus_bw2_unclosed_kotlin_module_and_mixed_walrus() {
    let dir = std::env::temp_dir().join(format!("aice_bw_r9_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. Compound if/elif/while/case..if headers & comprehension if filters
    let cmp_p = dir.join("cmp.py");
    std::fs::write(&cmp_p, "def f(a, v, xs):\n    return 0\n").unwrap();
    for bad in [
        "def f(a, v, xs):\n    if a and y := 1:\n        return y\n    return 0",
        "def f(a, v, xs):\n    if a:\n        return 1\n    elif a or y := 1:\n        return y\n    return 0",
        "def f(a, v, xs):\n    while a and y := 1:\n        break\n    return 0",
        "def f(a, v, xs):\n    while a or y := 1:\n        break\n    return 0",
        "def f(a, v, xs):\n    if not y := a:\n        return 1\n    return 0",
        "def f(a, v, xs):\n    match v:\n        case _ if a and m := v:\n            return m\n    return 0",
        "def f(a, v, xs):\n    return [x for x in xs if y := x]",
        "def f(a, v, xs):\n    return {x for x in xs if y := x}",
        "def f(a, v, xs):\n    return (x for x in xs if y := x)",
        "def f(a, v, xs):\n    return [x for x in xs if (w := x) and y := x]",
        "def f(a, v, xs):\n    return (1 + y := 2)",
        "def f(a, v, xs):\n    return {1: y := 2}",
    ] {
        let mut op = empty_op();
        op.dry_run = false;
        op.path = Some(PathBuf::from("cmp.py"));
        op.symbol = Some("f".into());
        op.code = Some(bad.into());
        assert_eq!(run_op(op).exit_code, 1, "expected reject for:\n{bad}");
    }
    let valid_cmp = "def f(a, v, xs):\n    if (a and (y := 1)):\n        pass\n    match v:\n        case _ if (a and (m := v)):\n            pass\n    c1 = [x for x in xs if (z := x)]\n    c2 = [w := x for x in xs]\n    c3 = [x for x in xs if a in (q := xs)]\n    return (len(c1) + len(c2) + len(c3))\n";
    let mut ok_cmp = empty_op();
    ok_cmp.dry_run = false;
    ok_cmp.path = Some(PathBuf::from("cmp.py"));
    ok_cmp.symbol = Some("f".into());
    ok_cmp.code = Some(valid_cmp.into());
    let cmp_rep = run_op(ok_cmp);
    assert_eq!(cmp_rep.exit_code, 0, "{}", cmp_rep.emitted_output);

    // 2. B-W2 unclosed '(' and '"""' before edited target
    let bw2_p = dir.join("bw2_open.py");
    let bw2_init = "def broken(:\n    pass\n\ndef ok(x):\n    return x\n";
    std::fs::write(&bw2_p, bw2_init).unwrap();
    for force in [false, true] {
        let mut bad = empty_op();
        bad.dry_run = false;
        bad.force = force;
        bad.path = Some(PathBuf::from("bw2_open.py"));
        bad.symbol = Some("ok".into());
        bad.code = Some("def ok(x):\n    return y := 1".into());
        assert_eq!(run_op(bad).exit_code, 1, "force={force}");
        assert_eq!(std::fs::read_to_string(&bw2_p).unwrap(), bw2_init);
    }
    let mut bad_hunk = empty_op();
    bad_hunk.dry_run = false;
    bad_hunk.path = Some(PathBuf::from("bw2_open.py"));
    bad_hunk.symbol = Some("ok".into());
    bad_hunk.code = Some("<<<\n    return x\n===\n    z := 2\n    return z\n>>>".into());
    assert_eq!(run_op(bad_hunk).exit_code, 1);
    assert_eq!(std::fs::read_to_string(&bw2_p).unwrap(), bw2_init);

    let bw2_tq = dir.join("bw2_tq.py");
    let tq_init = "s = \"\"\"unclosed\n\ndef ok(x):\n    return x\n";
    std::fs::write(&bw2_tq, tq_init).unwrap();
    let mut bad_tq = empty_op();
    bad_tq.dry_run = false;
    bad_tq.path = Some(PathBuf::from("bw2_tq.py"));
    bad_tq.symbol = Some("ok".into());
    bad_tq.code = Some("def ok(x):\n    return y := 1".into());
    assert_eq!(run_op(bad_tq).exit_code, 1);
    assert_eq!(std::fs::read_to_string(&bw2_tq).unwrap(), tq_init);
    let mut ok_tq = empty_op();
    ok_tq.dry_run = false;
    ok_tq.path = Some(PathBuf::from("bw2_tq.py"));
    ok_tq.symbol = Some("ok".into());
    ok_tq.code = Some("def ok(x):\n    return x + 1".into());
    let ok_tq_rep = run_op(ok_tq);
    assert_eq!(ok_tq_rep.exit_code, 0, "{}", ok_tq_rep.emitted_output);

    // 3. Kotlin `module kotlin` + `import "..."` + `class App:` round-trip & :create
    let kt_p = dir.join("K.kt");
    std::fs::write(&kt_p, "import kotlin.math.abs\n\nclass App {\n    fun add(a: Int, b: Int): Int {\n        return a + b\n    }\n}\n").unwrap();
    let mut kt_op = empty_op();
    kt_op.dry_run = false;
    kt_op.path = Some(PathBuf::from("K.kt"));
    kt_op.symbol = Some("App.add".into());
    kt_op.code = Some("module kotlin\nimport \"kotlin.math.abs\"\npub class App:\n  pub fn add(a: int, b: int) -> int = a + b + 1\n".into());
    let kt_rep = run_op(kt_op);
    assert_eq!(kt_rep.exit_code, 0, "{}", kt_rep.emitted_output);
    let kt_disk = std::fs::read_to_string(&kt_p).unwrap();
    assert_eq!(kt_disk.matches("class App").count(), 1, "kt={kt_disk}");
    assert_eq!(kt_disk.matches("import kotlin.math.abs").count(), 1, "kt={kt_disk}");
    assert!(!kt_disk.contains("module kotlin") && kt_disk.contains("a + b + 1"), "kt={kt_disk}");

    let mut kt_cr = empty_op();
    kt_cr.dry_run = false;
    kt_cr.create = true;
    kt_cr.path = Some(PathBuf::from("kt_c.kt"));
    kt_cr.code = Some("module kotlin\nimport \"kotlin.math.abs\"\nclass App:\n  fn add(a: int, b: int) -> int:\n    ret a + b + 1\n".into());
    let kt_cr_rep = run_op(kt_cr);
    assert_eq!(kt_cr_rep.exit_code, 0, "{}", kt_cr_rep.emitted_output);
    let kt_c_disk = std::fs::read_to_string(dir.join("kt_c.kt")).unwrap();
    assert!(kt_c_disk.contains("import kotlin.math.abs") && kt_c_disk.contains("class App") && kt_c_disk.contains("return a + b + 1") && !kt_c_disk.contains("module kotlin"), "kt_c={kt_c_disk}");

    // Native Ruby `module MyMod` must stay untouched
    let mut rb_cr = empty_op();
    rb_cr.dry_run = false;
    rb_cr.create = true;
    rb_cr.path = Some(PathBuf::from("native_mod.rb"));
    let rb_native = "module MyMod\n  def foo\n    1\n  end\nend\n";
    rb_cr.code = Some(rb_native.into());
    assert_eq!(run_op(rb_cr).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("native_mod.rb")).unwrap(), rb_native);

    // 4. Mixed Python `y := x + 1` + valid PEP 572 `:=`
    let mix_p = dir.join("mix.py");
    std::fs::write(&mix_p, "def f(s, x):\n    return x\n").unwrap();
    let mut mix_op = empty_op();
    mix_op.dry_run = false;
    mix_op.path = Some(PathBuf::from("mix.py"));
    mix_op.symbol = Some("f".into());
    mix_op.code = Some("def f(s, x):\n    if (m := s):\n        y := m + 1\n        a := [w := y + 2]\n        return max(y, z := a[0] + 1)\n    return 0".into());
    let mix_rep = run_op(mix_op);
    assert_eq!(mix_rep.exit_code, 0, "{}", mix_rep.emitted_output);
    let mix_disk = std::fs::read_to_string(&mix_p).unwrap();
    assert!(mix_disk.contains("if (m := s):") && mix_disk.contains("y = m + 1") && mix_disk.contains("a = [w := y + 2]") && mix_disk.contains("max(y, z := a[0] + 1)"), "mix={mix_disk}");

    let mut mix_l = empty_op();
    mix_l.dry_run = false;
    mix_l.path = Some(PathBuf::from("mix.py"));
    mix_l.symbol = Some("L3-L5".into());
    mix_l.code = Some("        y := m + 10\n        a := [w := y + 20]\n        return max(y, z := a[0] + 1)".into());
    let mix_l_rep = run_op(mix_l);
    assert_eq!(mix_l_rep.exit_code, 0, "{}", mix_l_rep.emitted_output);
    let mix_disk2 = std::fs::read_to_string(&mix_p).unwrap();
    assert!(mix_disk2.contains("y = m + 10") && mix_disk2.contains("a = [w := y + 20]") && mix_disk2.contains("max(y, z := a[0] + 1)"), "mix2={mix_disk2}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn w4_m2_r10_module_lang_non_wipe_cpython_walrus_parity_and_match_dec() {
    let dir = std::env::temp_dir().join(format!("aice_bw_r10_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // Bug 1: `module <lang>\nfn foo():\n  ret 1` must NEVER wipe files to ""
    std::fs::write(dir.join("doc.md"), "# Existing\n").unwrap();
    std::fs::write(dir.join("cfg.yaml"), "service: api\nport: 8080\n").unwrap();
    std::fs::write(dir.join("q.sql"), "SELECT 1;\n").unwrap();

    let md_payload = "module markdown\nfn foo():\n  ret 1\n";
    let mut md_ow = empty_op();
    md_ow.dry_run = false;
    md_ow.overwrite = true;
    md_ow.path = Some(PathBuf::from("doc.md"));
    md_ow.code = Some(md_payload.into());
    assert_eq!(run_op(md_ow).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("doc.md")).unwrap(), md_payload);

    let md_nat = "# Title\n\nmodule markdown\n\nfn = 1\n";
    let mut md_cr = empty_op();
    md_cr.dry_run = false;
    md_cr.create = true;
    md_cr.path = Some(PathBuf::from("nat.md"));
    md_cr.code = Some(md_nat.into());
    assert_eq!(run_op(md_cr).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("nat.md")).unwrap(), md_nat);

    for (file, create, payload, orig) in [
        ("cfg.yaml", false, "module yaml\nfn foo():\n  ret 1\n", Some("service: api\nport: 8080\n")),
        ("mod.sh", true, "#!/usr/bin/env bash\nmodule bash\nfn hi():\n  ret 0\n", None),
        ("mod.toml", true, "module toml\nfn foo():\n  ret 1\n", None),
        ("q.sql", false, "module sql\nfn foo():\n  ret 1\n", Some("SELECT 1;\n")),
        ("mod.css", true, "module css\nfn foo():\n  ret 1\n", None),
    ] {
        let mut op = empty_op();
        op.dry_run = false;
        op.create = create;
        op.overwrite = !create;
        op.path = Some(PathBuf::from(file));
        op.code = Some(payload.into());
        let rep = run_op(op);
        if let Some(expected) = orig {
            let on_disk = std::fs::read_to_string(dir.join(file)).unwrap();
            assert!(!on_disk.is_empty(), "{file} wiped to empty!");
            if rep.exit_code == 1 {
                assert_eq!(on_disk, expected);
            }
        } else if rep.exit_code == 0 {
            assert!(!std::fs::read_to_string(dir.join(file)).unwrap().is_empty(), "{file} created empty!");
        }
    }

    // Valid bash with `module bash` preserved cleanly
    let mut sh_ok = empty_op();
    sh_ok.dry_run = false;
    sh_ok.create = true;
    sh_ok.path = Some(PathBuf::from("ok.sh"));
    let sh_src = "#!/usr/bin/env bash\nmodule bash\necho hi\n";
    sh_ok.code = Some(sh_src.into());
    assert_eq!(run_op(sh_ok).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("ok.sh")).unwrap(), sh_src);

    // Bug 2: CPython SyntaxError `:=` cases & hybrid fallback corruption prevention
    let py_p = dir.join("p.py");
    let py_init = "def f(arr, xs, v):\n    return 0\n";
    std::fs::write(&py_p, py_init).unwrap();
    for bad in [
        "def f(arr, xs, v):\n    return {y := 1: 2}",
        "def f(arr, xs, v):\n    return {k := x: x for x in xs}",
        "def f(arr, xs, v):\n    return arr[y := 0 : 2]",
        "def f(arr, xs, v):\n    return f'{ {y := 1: 2} }'",
        "def f(arr, xs, v):\n    match v:\n        case [y := 1]:\n            return y\n    return 0",
        "def f(arr, xs, v):\n    return [(x := 1) for x in xs]",
        "def f(arr, xs, v):\n    return [(y := x) for x in xs for y in [1]]",
        "def f(arr, xs, v):\n    return [[(x := 1) for y in xs] for x in xs]",
        "def f(arr, xs, v):\n    return [x for x in xs if (x := 1)]",
        "def f(arr, xs, v):\n    type X = (y := int)\n    return X",
        "def f(arr, xs, v):\n    y ::= 1\n    return 0",
        "def f(arr, xs, v):\n    type X := int\n    return X",
    ] {
        let mut op = empty_op();
        op.dry_run = false;
        op.path = Some(PathBuf::from("p.py"));
        op.symbol = Some("f".into());
        op.code = Some(bad.into());
        assert_eq!(run_op(op).exit_code, 1, "expected reject for:\n{bad}");
        assert_eq!(std::fs::read_to_string(&py_p).unwrap(), py_init);
    }

    // Valid f-strings, sets, dict-comp values, slices, type var, and Bug 3 `match y := v:` & `@y := 1`
    let valid_py = concat!(
        "def f(arr, xs, v):\n",
        "    s = {y := 1}\n",
        "    d = {k: (v2 := x) for k, x in xs}\n",
        "    sl = arr[(y := 0) : (z := 2)]\n",
        "    fs = f\"{q := 1:>5}\"\n",
        "    fs2 = f\"{ {r := 1} }\"\n",
        "    fs3 = f\"{1:{w := 5}}\"\n",
        "    type = (tv := 1)\n",
        "    match m := v:\n",
        "        case 1:\n",
        "            return m\n",
        "    @dec := (lambda fn: fn)\n",
        "    def inner():\n",
        "        return 1\n",
        "    return len(s) + len(d) + len(sl) + len(fs) + len(fs2) + len(fs3) + type + inner()\n",
    );
    let mut ok_op = empty_op();
    ok_op.dry_run = false;
    ok_op.path = Some(PathBuf::from("p.py"));
    ok_op.symbol = Some("f".into());
    ok_op.code = Some(valid_py.into());
    let ok_rep = run_op(ok_op);
    assert_eq!(ok_rep.exit_code, 0, "{}", ok_rep.emitted_output);
    let p_disk = std::fs::read_to_string(&py_p).unwrap();
    assert!(p_disk.contains("match m := v:") && p_disk.contains("@dec := (lambda fn: fn)") && p_disk.contains("f\"{q := 1:>5}\""));

    // Compound match & decorator must still reject
    for bad_m in [
        "def f(arr, xs, v):\n    match a and y := v:\n        case _:\n            return 0",
        "def f(arr, xs, v):\n    @a + y := 1\n    def g():\n        return 0\n    return g",
        "def f(arr, xs, v):\n    @(1 + y := 2)\n    def g():\n        return 0\n    return g",
    ] {
        let mut op = empty_op();
        op.dry_run = false;
        op.path = Some(PathBuf::from("p.py"));
        op.symbol = Some("f".into());
        op.code = Some(bad_m.into());
        assert_eq!(run_op(op).exit_code, 1, "expected reject for:\n{bad_m}");
    }

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn w4_m2_r11_cst_walrus_challenger_repros_bw2_and_context_lowering() {
    let dir = std::env::temp_dir().join(format!("aice_bw_r11_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. Challenge 1 + Reviewer 2 + PEP 572/695/comprehension illegal cases
    for (i, bad) in [
        "with ctx() as (y := 1):\n    pass\n",
        "try:\n    pass\nexcept Exception as (y := 1):\n    pass\n",
        "try:\n    pass\nexcept* Exception as (y := 1):\n    pass\n",
        "def f():\n    del (y := 1)\n",
        "def f():\n    del a, (b, (y := 1))\n",
        "def g(a := 1):\n    return a\n",
        "def g(*, a := 1):\n    return a\n",
        "def g(a: int = y := 1):\n    return a\n",
        "def g(a=1, y := 1):\n    return a\n",
        "class C:\n    r = [y := x for x in [1]]\n",
        "class C:\n    r = [x for x in [1] if (y := x)]\n",
        "r = [x for x in (lambda: (y := [1]))()]\n",
        "r = [[(x := 1) for y in [1]] for x in [1]]\n",
        "def f[T: (y := int)]():\n    pass\n",
        "type X = int | (y := str)\n",
        "y := 1,\n",
        "def f(a):\n    return a, y := 1\n",
        "def f():\n    yield y := 1\n",
        "a.b := 1\n",
        "(y := 1) += 2\n",
        "for (y := 1) in [1]:\n    pass\n",
    ].into_iter().enumerate() {
        let mut op = empty_op();
        op.dry_run = false;
        op.create = true;
        op.path = Some(PathBuf::from(format!("bad_{i}.py")));
        op.code = Some(bad.into());
        assert_eq!(run_op(op).exit_code, 1, "expected reject for:\n{bad}");
    }

    // 2. Challenge 3 + valid PEP 572/comprehension/f-string edge cases
    let valid_py = concat!(
        "def ok(a, b, arr, xs, v, ctx):\n",
        "    l1 = [y := lambda: 1]\n",
        "    s1 = {y := lambda: 1}\n",
        "    fs1 = f\"{a and y := 1}\"\n",
        "    fs2 = f\"{a + y := 1}\"\n",
        "    fs3 = f\"{1:{a + y := 5}}\"\n",
        "    c1 = case([y := 1])\n",
        "    match 1, y := v:\n",
        "        case _:\n",
        "            pass\n",
        "    match x := 1, y := v:\n",
        "        case _:\n",
        "            pass\n",
        "    c2 = [x for a.b in xs if (b := 1)]\n",
        "    c3 = [(lambda: (x := 1))() for x in [1]]\n",
        "    del a[(y := 0)]\n",
        "    with (y := ctx()) as w:\n",
        "        pass\n",
        "    return arr[y := 0, 1]\n",
    );
    let mut ok_op = empty_op();
    ok_op.dry_run = false;
    ok_op.create = true;
    ok_op.path = Some(PathBuf::from("ok_r11.py"));
    ok_op.code = Some(valid_py.into());
    let ok_rep = run_op(ok_op);
    assert_eq!(ok_rep.exit_code, 0, "{}", ok_rep.emitted_output);
    let disk_ok = std::fs::read_to_string(dir.join("ok_r11.py")).unwrap();
    assert!(disk_ok.contains("[y := lambda: 1]") && disk_ok.contains("match 1, y := v:") && disk_ok.contains("[x for a.b in xs if (b := 1)]"));

    // 3. Challenge 2 :L positional lowering trap & kw_pos preservation
    let kw_init = "def f():\n    return g(\n        a=1,\n        b=2\n    )\n";
    std::fs::write(dir.join("kw.py"), kw_init).unwrap();
    let mut kw_bad = empty_op();
    kw_bad.dry_run = false;
    kw_bad.path = Some(PathBuf::from("kw.py"));
    kw_bad.symbol = Some("L4".into());
    kw_bad.code = Some("        y := 1".into());
    assert_eq!(run_op(kw_bad).exit_code, 1);
    assert_eq!(std::fs::read_to_string(dir.join("kw.py")).unwrap(), kw_init);

    let df_init = "def f(\n    a=1,\n    b=2\n):\n    return a + b\n";
    std::fs::write(dir.join("df.py"), df_init).unwrap();
    let mut df_bad = empty_op();
    df_bad.dry_run = false;
    df_bad.path = Some(PathBuf::from("df.py"));
    df_bad.symbol = Some("L3".into());
    df_bad.code = Some("    y := 1".into());
    assert_eq!(run_op(df_bad).exit_code, 1);
    assert_eq!(std::fs::read_to_string(dir.join("df.py")).unwrap(), df_init);

    std::fs::write(dir.join("kw_pos.py"), "def f():\n    return g(\n        a,\n        b\n    )\n").unwrap();
    let mut kwp_ok = empty_op();
    kwp_ok.dry_run = false;
    kwp_ok.path = Some(PathBuf::from("kw_pos.py"));
    kwp_ok.symbol = Some("L4".into());
    kwp_ok.code = Some("        y := 1".into());
    assert_eq!(run_op(kwp_ok).exit_code, 0);
    assert!(std::fs::read_to_string(dir.join("kw_pos.py")).unwrap().contains("        y := 1"));

    // 4. Challenger 2 B-W2 nested f-strings (with/without --force), multi-line docstring preservation, and CRLF
    let nf_init = "s = f\"outer { f'''unclosed\n\ndef ok(x):\n    return x\n";
    std::fs::write(dir.join("nf.py"), nf_init).unwrap();
    for bad_l4 in ["    return y := 1", "    return {y := 1: 2}", "    return [(x := 1) for x in [1]]", "    if x and y := 1:"] {
        for force in [false, true] {
            let mut b = empty_op();
            b.dry_run = false;
            b.force = force;
            b.path = Some(PathBuf::from("nf.py"));
            b.symbol = Some("L4".into());
            b.code = Some(bad_l4.into());
            assert_eq!(run_op(b).exit_code, 1, "nf force={force} bad={bad_l4}");
            assert_eq!(std::fs::read_to_string(dir.join("nf.py")).unwrap(), nf_init);
        }
    }
    let mut nf_ok = empty_op();
    nf_ok.dry_run = false;
    nf_ok.path = Some(PathBuf::from("nf.py"));
    nf_ok.symbol = Some("L4".into());
    nf_ok.code = Some("    y := x + 1\n    return y".into());
    assert_eq!(run_op(nf_ok).exit_code, 0);
    assert!(std::fs::read_to_string(dir.join("nf.py")).unwrap().contains("    y = x + 1"));

    std::fs::write(dir.join("docstr.py"), "s = \"\"\"unclosed\n\ndoc = \"\"\"para 1\n\nold text\n\"\"\"\n").unwrap();
    let mut doc_op = empty_op();
    doc_op.dry_run = false;
    doc_op.path = Some(PathBuf::from("docstr.py"));
    doc_op.symbol = Some("L5".into());
    doc_op.code = Some("    y := 1".into());
    assert_eq!(run_op(doc_op).exit_code, 0);
    assert!(std::fs::read_to_string(dir.join("docstr.py")).unwrap().contains("    y := 1"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn w4_m2_r12_fixes_1_to_6_bounds_dictcomp_fstr_classdef_400l_and_same_indent() {
    let dir = std::env::temp_dir().join(format!("aice_bw_r12_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // Fix 1: no slice-bounds panic on trailing_nl == false + \n\n or empty payload
    std::fs::write(dir.join("panic1.py"), "s = f\"outer { f'''unclosed := 1\nx = 1").unwrap();
    let mut p1 = empty_op();
    p1.dry_run = false;
    p1.path = Some(PathBuf::from("panic1.py"));
    p1.symbol = Some("L2".into());
    p1.code = Some("y := 1\n\n".into());
    let r1 = run_op(p1);
    assert!(matches!(r1.exit_code, 0 | 1));

    std::fs::write(dir.join("panic2.py"), "s = f\"outer { f'''unclosed := 1\n\nreturn 1\n").unwrap();
    let mut p2 = empty_op();
    p2.dry_run = false;
    p2.path = Some(PathBuf::from("panic2.py"));
    p2.symbol = Some("L3".into());
    p2.code = Some(String::new());
    let r2 = run_op(p2);
    assert!(matches!(r2.exit_code, 0 | 1));

    std::fs::write(dir.join("panic3.py"), "s = f\"outer { f'''unclosed := 1\nx = 1").unwrap();
    let mut p3 = empty_op();
    p3.dry_run = false;
    p3.path = Some(PathBuf::from("panic3.py"));
    p3.symbol = Some("L2".into());
    p3.code = Some(String::new());
    let r3 = run_op(p3);
    assert!(matches!(r3.exit_code, 0 | 1));

    // Fixes 2, 3, 4: illegal cases rejected
    for (i, bad) in [
        "r = {x: y := x for x in xs}\n",
        "def f(xs):\n    return {x: y := x for x in xs}\n",
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
        let mut op = empty_op();
        op.dry_run = false;
        op.create = true;
        op.path = Some(PathBuf::from(format!("r12_bad_{i}.py")));
        op.code = Some(bad.into());
        assert_eq!(run_op(op).exit_code, 1, "expected reject for:\n{bad}");
    }

    // Fixes 2, 3, 4: valid cases accepted
    let ok_src = concat!(
        "d1 = {x: (y := x) for x in [1]}\n",
        "d2 = {x: [y := x] for x in [1]}\n",
        "def ok(a, y):\n",
        "    f1 = f\"{y := 1}\"\n",
        "    f2 = f\"{a + y := 1}\"\n",
        "    f3 = f\"{a and y := 1}\"\n",
        "    f4 = f\"{1:{a + y := 5}}\"\n",
        "    f5 = f\"{1 if a else y := 2}\"\n",
        "    f6 = f\"{y := 1 if a else 2}\"\n",
        "    f7 = f\"{1 if (y := 1) else 2}\"\n",
        "    return (f1, f2, f3, f4, f5, f6, f7)\n",
        "class C:\n",
        "    def m(self):\n",
        "        return [y := x for x in [1]]\n",
        "    g = lambda: [y := x for x in [1]]\n",
    );
    let mut ok_op = empty_op();
    ok_op.dry_run = false;
    ok_op.create = true;
    ok_op.path = Some(PathBuf::from("r12_ok.py"));
    ok_op.code = Some(ok_src.into());
    let ok_rep = run_op(ok_op);
    assert_eq!(ok_rep.exit_code, 0, "{}", ok_rep.emitted_output);

    // Fix 5: >400L multi-hunk straddling B-W2 rejected (with & without --force, + :L1-L426)
    let mut big_bw2 = String::from("def f1(x):\n    return alpha_unique\ns = f\"outer { f'''unclosed\n");
    for _ in 0..420 {
        big_bw2.push_str("# pad\n");
    }
    big_bw2.push_str("def f2(x):\n    return beta_unique\n");
    std::fs::write(dir.join("h400.py"), &big_bw2).unwrap();
    let bad_hunks = "<<<\n    return alpha_unique\n===\n    return alpha_unique + 1\n>>>\n<<<\n    return beta_unique\n===\n    return y := 1\n>>>\n";
    for (force, sym) in [(false, None), (true, None), (false, Some("L1-L426"))] {
        let mut op = empty_op();
        op.dry_run = false;
        op.force = force;
        op.path = Some(PathBuf::from("h400.py"));
        op.symbol = sym.map(str::to_string);
        op.code = Some(bad_hunks.into());
        assert_eq!(run_op(op).exit_code, 1, "force={force} sym={sym:?}");
        assert_eq!(std::fs::read_to_string(dir.join("h400.py")).unwrap(), big_bw2);
    }

    // Fix 6: B-W2 same-indent call rejected instead of lowering positional `y := 1`
    let si_init = "def f():\n    bad = (\n    return g(\n    a=1,\n    b=2\n    )\n";
    std::fs::write(dir.join("bw2_same_ind.py"), si_init).unwrap();
    let mut si_op = empty_op();
    si_op.dry_run = false;
    si_op.path = Some(PathBuf::from("bw2_same_ind.py"));
    si_op.symbol = Some("L5".into());
    si_op.code = Some("    y := 1".into());
    assert_eq!(run_op(si_op).exit_code, 1);
    assert_eq!(std::fs::read_to_string(dir.join("bw2_same_ind.py")).unwrap(), si_init);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn bom_and_crlf_preserved_across_symbol_line_hunk_and_first_delete() {
    let dir = std::env::temp_dir().join(format!("aice_bw_bom_crlf_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();

    let run_op = |op: WriteOp| {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. Symbol splice, hunk splice, and first-symbol --delete preserve \u{FEFF} and \r\n
    let ts_init = "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\nexport function second(): number {\r\n  return 2;\r\n}\r\n";
    std::fs::write(dir.join("bom.ts"), ts_init).unwrap();

    let sym_op = empty_op_clone_fix("bom.ts", Some("first"), Some("export function first(): number {\n  return 10;\n}"), None);
    assert_eq!(run_op(sym_op).exit_code, 0);
    let after_sym = std::fs::read_to_string(dir.join("bom.ts")).unwrap();
    assert!(after_sym.starts_with('\u{FEFF}') && after_sym.contains("\r\n") && after_sym.contains("return 10;"));

    let hunk_op = empty_op_clone_fix("bom.ts", Some("second"), Some("<<<\n  return 2;\n===\n  return 20;\n>>>"), None);
    assert_eq!(run_op(hunk_op).exit_code, 0);
    let after_hunk = std::fs::read_to_string(dir.join("bom.ts")).unwrap();
    assert!(after_hunk.starts_with('\u{FEFF}') && after_hunk.contains("\r\n") && after_hunk.contains("return 20;"));

    let del_sym = empty_op_clone_fix("bom.ts", Some("first"), None, Some("first"));
    assert_eq!(run_op(del_sym).exit_code, 0);
    let after_del_sym = std::fs::read_to_string(dir.join("bom.ts")).unwrap();
    assert!(after_del_sym.starts_with('\u{FEFF}'), "first-symbol delete dropped BOM: {after_del_sym:?}");
    assert!(after_del_sym.contains("second") && !after_del_sym.contains("first"));
    assert!(after_del_sym.contains("\r\n"));

    // 2. Line splice and L1 --delete preserve \u{FEFF} and \r\n
    let line_init = "\u{FEFF}export const a = 1;\r\nexport const b = 2;\r\n";
    std::fs::write(dir.join("bom_line.ts"), line_init).unwrap();
    let del_l1 = empty_op_clone_fix("bom_line.ts", Some("L1"), None, Some("L1"));
    assert_eq!(run_op(del_l1).exit_code, 0);
    let after_del_l1 = std::fs::read_to_string(dir.join("bom_line.ts")).unwrap();
    assert_eq!(after_del_l1, "\u{FEFF}export const b = 2;\r\n");

    // 3. Deleting sole symbol leaves empty file without orphan BOM
    let sole = "\u{FEFF}export const only = 1;\r\n";
    std::fs::write(dir.join("sole.ts"), sole).unwrap();
    let del_sole = empty_op_clone_fix("sole.ts", Some("only"), None, Some("only"));
    assert_eq!(run_op(del_sole).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("sole.ts")).unwrap(), "");

    // 4. C2-R2-G2: L1 replace, L1 multi-line hunk, --insert-before first symbol, :imports, line-1 doc replace/delete
    std::fs::write(
        dir.join("rep_l1.ts"),
        "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\n",
    ).unwrap();
    let rep_l1 = empty_op_clone_fix("rep_l1.ts", Some("L1-L1"), Some("export function first(): number {"), None);
    assert_eq!(run_op(rep_l1).exit_code, 0);
    let after_rep_l1 = std::fs::read_to_string(dir.join("rep_l1.ts")).unwrap();
    assert_eq!(after_rep_l1, "\u{FEFF}export function first(): number {\r\n  return 1;\r\n}\r\n");

    let mh_l1 = empty_op_clone_fix(
        "rep_l1.ts",
        None,
        Some("<<<\nexport function first(): number {\n  return 1;\n===\nexport function first(): number {\n  return 99;\n>>>"),
        None,
    );
    assert_eq!(run_op(mh_l1).exit_code, 0);
    let after_mh_l1 = std::fs::read_to_string(dir.join("rep_l1.ts")).unwrap();
    assert_eq!(after_mh_l1, "\u{FEFF}export function first(): number {\r\n  return 99;\r\n}\r\n");

    let mut ins_before = empty_op_clone_fix("rep_l1.ts", None, Some("export function zero(): number { return 0; }"), None);
    ins_before.insert_before = Some("first".into());
    assert_eq!(run_op(ins_before).exit_code, 0);
    let after_ins = std::fs::read_to_string(dir.join("rep_l1.ts")).unwrap();
    assert!(after_ins.starts_with("\u{FEFF}export function zero()"), "{after_ins:?}");
    assert_eq!(after_ins.matches('\u{FEFF}').count(), 1);
    assert!(after_ins.contains("\r\n"));

    std::fs::write(dir.join("imp.ts"), "\u{FEFF}import { a } from './a';\r\nexport const x = a;\r\n").unwrap();
    let imp_op = empty_op_clone_fix("imp.ts", Some(":imports"), Some("import { b } from './b';"), None);
    assert_eq!(run_op(imp_op).exit_code, 0);
    let after_imp = std::fs::read_to_string(dir.join("imp.ts")).unwrap();
    assert_eq!(after_imp, "\u{FEFF}import { b } from './b';\r\nexport const x = a;\r\n");

    std::fs::write(
        dir.join("doc_bom.ts"),
        "\u{FEFF}/// leading doc\r\nexport function first(): number { return 1; }\r\nexport function second(): number { return 2; }\r\n",
    ).unwrap();
    let doc_rep = empty_op_clone_fix(
        "doc_bom.ts",
        Some("first"),
        Some("/// updated doc\nexport function first(): number { return 10; }"),
        None,
    );
    assert_eq!(run_op(doc_rep).exit_code, 0);
    let after_doc_rep = std::fs::read_to_string(dir.join("doc_bom.ts")).unwrap();
    assert!(after_doc_rep.starts_with("\u{FEFF}/// updated doc\r\n"), "{after_doc_rep:?}");
    assert!(!after_doc_rep.contains("leading doc"), "{after_doc_rep:?}");
    assert_eq!(after_doc_rep.matches('\u{FEFF}').count(), 1);

    let doc_del = empty_op_clone_fix("doc_bom.ts", Some("first"), None, Some("first"));
    assert_eq!(run_op(doc_del).exit_code, 0);
    let after_doc_del = std::fs::read_to_string(dir.join("doc_bom.ts")).unwrap();
    assert!(after_doc_del.starts_with("\u{FEFF}export function second()"), "{after_doc_del:?}");
    assert!(!after_doc_del.contains("updated doc"), "{after_doc_del:?}");

    // 5. :overwrite without BOM keeps overwrite contract intact
    let mut ow = empty_op_clone_fix("doc_bom.ts", Some(":overwrite"), Some("export const plain = 1;\n"), None);
    ow.overwrite = true;
    assert_eq!(run_op(ow).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("doc_bom.ts")).unwrap(), "export const plain = 1;\n");

    let _ = std::fs::remove_dir_all(&dir);
}

fn empty_op_clone_fix(path: &str, sym: Option<&str>, code: Option<&str>, delete: Option<&str>) -> WriteOp {
    let mut op = empty_op();
    op.dry_run = false;
    op.path = Some(PathBuf::from(path));
    op.symbol = sym.map(str::to_string);
    op.code = code.map(str::to_string);
    op.delete = delete.map(str::to_string);
    op
}

#[test]
fn wave1_f14_force_overwrite_truncation_and_single_file_create_guards() {
    let dir = std::env::temp_dir().join(format!("aice_bw_w1_f14_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();

    let run_op = |op: WriteOp| {
        let gov = aice_governance::authorize(aice_governance::PipelineRequest::new(
            op.clone(),
            dir.clone(),
            aice_governance::OutputSurface::Cli,
        ))
        .unwrap();
        aice_batch_write::execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. >25L file overwrite with --overwrite (no --force) MUST reject; with --force MUST succeed
    let big_40l: String = (0..40).map(|i| format!("export const V_{i} = {i};\n")).collect();
    std::fs::write(dir.join("big.ts"), &big_40l).unwrap();

    let mut ow_no_force = empty_op_clone_fix("big.ts", None, Some("export const SMALL = 1;\n"), None);
    ow_no_force.overwrite = true;
    let rep = run_op(ow_no_force);
    assert_eq!(rep.exit_code, 1, "expected >25L overwrite without --force to fail");
    assert!(rep.emitted_output.contains("--force"), "msg={}", rep.emitted_output);
    assert_eq!(std::fs::read_to_string(dir.join("big.ts")).unwrap(), big_40l);

    // 2. Truncating non-empty >25L OR <=25L file to 0B with --overwrite (no --force) MUST reject
    let mut trunc_big = empty_op_clone_fix("big.ts", None, Some(""), None);
    trunc_big.overwrite = true;
    let rep_tb = run_op(trunc_big);
    assert_eq!(rep_tb.exit_code, 1);
    assert!(rep_tb.emitted_output.contains("--force"), "msg={}", rep_tb.emitted_output);
    assert_eq!(std::fs::read_to_string(dir.join("big.ts")).unwrap(), big_40l);

    std::fs::write(dir.join("small.ts"), "export const S = 1;\n").unwrap();
    let mut trunc_small = empty_op_clone_fix("small.ts", None, Some(""), None);
    trunc_small.overwrite = true;
    let rep_ts = run_op(trunc_small);
    assert_eq!(rep_ts.exit_code, 1);
    assert!(rep_ts.emitted_output.contains("--force"), "msg={}", rep_ts.emitted_output);
    assert_eq!(std::fs::read_to_string(dir.join("small.ts")).unwrap(), "export const S = 1;\n");

    // Non-empty <=25L overwrite with --overwrite (no --force) MUST still succeed (E2E contract)
    let mut ow_small = empty_op_clone_fix("small.ts", None, Some("export const S = 2;\n"), None);
    ow_small.overwrite = true;
    assert_eq!(run_op(ow_small).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("small.ts")).unwrap(), "export const S = 2;\n");

    // Truncating with --overwrite --force succeeds; overwriting >25L with --force succeeds
    let mut trunc_forced = empty_op_clone_fix("small.ts", None, Some(""), None);
    trunc_forced.overwrite = true;
    trunc_forced.force = true;
    assert_eq!(run_op(trunc_forced).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("small.ts")).unwrap(), "");

    let mut ow_forced = empty_op_clone_fix("big.ts", None, Some("export const REPLACED = true;\n"), None);
    ow_forced.overwrite = true;
    ow_forced.force = true;
    assert_eq!(run_op(ow_forced).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("big.ts")).unwrap(), "export const REPLACED = true;\n");

    // 3. Single-file CLI writes to nonexistent file reject without --create (even with --overwrite)
    let no_create = empty_op_clone_fix("missing.ts", None, Some("export const M = 1;\n"), None);
    assert_eq!(run_op(no_create).exit_code, 1);
    assert!(!dir.join("missing.ts").exists());

    let mut ow_missing = empty_op_clone_fix("missing.ts", None, Some("export const M = 1;\n"), None);
    ow_missing.overwrite = true;
    let rep_owm = run_op(ow_missing);
    assert_eq!(rep_owm.exit_code, 1);
    assert!(rep_owm.emitted_output.contains("--create"), "msg={}", rep_owm.emitted_output);
    assert!(!dir.join("missing.ts").exists());

    let mut with_create = empty_op_clone_fix("missing.ts", None, Some("export const M = 1;\n"), None);
    with_create.create = true;
    assert_eq!(run_op(with_create).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("missing.ts")).unwrap(), "export const M = 1;\n");

    // 4. Bare heredoc === newfile === in --stdin stream STILL creates without --create (T1-F12-01)
    let mut heredoc_create = empty_op();
    heredoc_create.dry_run = false;
    heredoc_create.batch = Some("=== heredoc_new.ts ===\nexport const HD = 1;\n".into());
    assert_eq!(run_op(heredoc_create).exit_code, 0);
    assert_eq!(std::fs::read_to_string(dir.join("heredoc_new.ts")).unwrap(), "export const HD = 1;\n");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wave1_f15_multiline_imports_across_js_py_go_rs_and_bom() {
    let dir = std::env::temp_dir().join(format!("aice_bw_w1_f15_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}\n").unwrap();

    let run_imp = |file: &str, payload: &str| {
        let op = empty_op_clone_fix(file, Some(":imports"), Some(payload), None);
        let gov = aice_governance::authorize(aice_governance::PipelineRequest::new(
            op.clone(),
            dir.clone(),
            aice_governance::OutputSurface::Cli,
        ))
        .unwrap();
        aice_batch_write::execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. JS/TS multi-line import with comments, braces, separate-line `from`, and preserved doc comment
    let js_src = concat!(
        "import assert from 'node:assert/strict';\n",
        "import {\n",
        "  createMidpoint,\n",
        "  // comment with } inside\n",
        "  computeBounds,\n",
        "} from '../assets/js/whiteboard.js';\n",
        "import {\n",
        "  helperA,\n",
        "  helperB,\n",
        "}\n",
        "  from './helpers.js';\n\n",
        "/** Keep this doc */\n",
        "export function run() {\n",
        "  return assert.ok(true);\n",
        "}\n",
    );
    std::fs::write(dir.join("sample.mjs"), js_src).unwrap();
    let r_js = run_imp("sample.mjs", "import assert from \"node:assert/strict\";\nimport { createMidpoint } from '../assets/js/whiteboard.js';");
    assert_eq!(r_js.exit_code, 0, "js err: {}", r_js.emitted_output);
    let after_js = std::fs::read_to_string(dir.join("sample.mjs")).unwrap();
    assert!(!after_js.contains("computeBounds") && !after_js.contains("helperA"), "dangling JS imports:\n{after_js}");
    assert!(after_js.contains("/** Keep this doc */") && after_js.contains("export function run()"), "{after_js}");

    // 2. Python multi-line parenthesized import, backslash continuation, comment with ')', and module docstring
    let py_src = concat!(
        "\"\"\"Module doc.\"\"\"\n\n",
        "import os, \\\n",
        "    sys\n",
        "from pkg.sub import (\n",
        "    Alpha,\n",
        "    # comment with ) inside\n",
        "    Beta,\n",
        ")\n\n",
        "def work():\n",
        "    return 1\n",
    );
    std::fs::write(dir.join("mod.py"), py_src).unwrap();
    let r_py = run_imp("mod.py", "from pkg.sub import Gamma");
    assert_eq!(r_py.exit_code, 0, "py err: {}", r_py.emitted_output);
    let after_py = std::fs::read_to_string(dir.join("mod.py")).unwrap();
    assert!(after_py.starts_with("\"\"\"Module doc.\"\"\"\n\nfrom pkg.sub import Gamma\n\ndef work():"), "{after_py:?}");
    assert!(!after_py.contains("Alpha") && !after_py.contains("Beta"), "{after_py}");

    // 3. Go multi-line grouped import (...) after package declaration
    let go_src = concat!(
        "package main\n\n",
        "import (\n",
        "\t\"fmt\"\n",
        "\t// comment with ) inside\n",
        "\t\"os\"\n",
        ")\n\n",
        "func main() {\n",
        "\tfmt.Println(\"ok\")\n",
        "}\n",
    );
    std::fs::write(dir.join("main.go"), go_src).unwrap();
    let r_go = run_imp("main.go", "import \"fmt\"");
    assert_eq!(r_go.exit_code, 0, "go err: {}", r_go.emitted_output);
    let after_go = std::fs::read_to_string(dir.join("main.go")).unwrap();
    assert_eq!(after_go, "package main\n\nimport \"fmt\"\n\nfunc main() {\n\tfmt.Println(\"ok\")\n}\n");

    // 4. Rust nested multi-line use::{...} + block comment + wrapped path + preserved #[derive]
    let rs_src = concat!(
        "//! Crate doc\n\n",
        "use std::{\n",
        "    collections::{\n",
        "        BTreeMap,\n",
        "        BTreeSet,\n",
        "    },\n",
        "    /* comment } ; */\n",
        "    path::Path,\n",
        "};\n",
        "use std::fmt::\n",
        "    Display;\n\n",
        "#[derive(Debug)]\n",
        "pub struct Item;\n",
    );
    std::fs::write(dir.join("lib.rs"), rs_src).unwrap();
    let r_rs = run_imp("lib.rs", "use std::path::PathBuf;");
    assert_eq!(r_rs.exit_code, 0, "rs err: {}", r_rs.emitted_output);
    let after_rs = std::fs::read_to_string(dir.join("lib.rs")).unwrap();
    assert!(!after_rs.contains("BTreeMap") && !after_rs.contains("Display"), "{after_rs}");
    assert!(after_rs.starts_with("//! Crate doc\n\nuse std::path::PathBuf;\n\n#[derive(Debug)]\npub struct Item;\n"), "{after_rs:?}");

    // 5. BOM + CRLF multi-line TS import
    std::fs::write(
        dir.join("bom_multi.ts"),
        "\u{FEFF}import {\r\n  a,\r\n  b,\r\n} from './a';\r\nexport const x = 1;\r\n",
    ).unwrap();
    let r_bom = run_imp("bom_multi.ts", "import { c } from './c';");
    assert_eq!(r_bom.exit_code, 0, "bom err: {}", r_bom.emitted_output);
    assert_eq!(
        std::fs::read_to_string(dir.join("bom_multi.ts")).unwrap(),
        "\u{FEFF}import { c } from './c';\r\nexport const x = 1;\r\n"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn regression_f21_dry_run_diff_trim_prefix_suffix_and_no_body_dump() {
    use aice_batch_write::diff::unified_diff;

    // 1. 3,100-line file with a 1-line edit at line 1500: O(1) trimmed LCS, compact ~11-line diff
    let mut old_lines: Vec<String> = (1..=3100).map(|i| format!("const line_{i} = {i};")).collect();
    let old = format!("{}\n", old_lines.join("\n"));
    old_lines[1499] = "const line_1500 = 99999;".to_string();
    let new = format!("{}\n", old_lines.join("\n"));

    let diff = unified_diff("big.ts", &old, &new);
    let diff_lines: Vec<&str> = diff.lines().collect();
    assert!(
        diff_lines.len() <= 15,
        "expected compact diff (~11 lines), got {} lines:\n{}",
        diff_lines.len(),
        diff
    );
    assert!(diff.contains("@@ -1497,7 +1497,7 @@"), "bad hunk header:\n{diff}");
    assert!(diff.contains("-const line_1500 = 1500;"));
    assert!(diff.contains("+const line_1500 = 99999;"));
    assert!(!diff.contains("line_1 = 1;") && !diff.contains("line_3100 = 3100;"));

    // 2. Identical 3,100-line files emit header only, zero hunks
    let same_diff = unified_diff("big.ts", &old, &old);
    assert_eq!(same_diff, "--- a/big.ts\n+++ b/big.ts\n");

    // 3. Pure insertion & pure deletion in 3,100-line file emit compact hunks
    let mut ins_lines: Vec<String> = (1..=3100).map(|i| format!("const line_{i} = {i};")).collect();
    ins_lines.insert(1500, "const inserted = 42;".to_string());
    let ins_src = format!("{}\n", ins_lines.join("\n"));
    let ins_diff = unified_diff("big.ts", &old, &ins_src);
    assert!(ins_diff.lines().count() <= 15 && ins_diff.contains("+const inserted = 42;"), "{ins_diff}");
    let del_diff = unified_diff("big.ts", &ins_src, &old);
    assert!(del_diff.lines().count() <= 15 && del_diff.contains("-const inserted = 42;"), "{del_diff}");

    // 4. execute_batch_write with --dry-run --diff emits ONLY unified diff + concise banner (no full body dump)
    let dir = std::env::temp_dir().join(format!("aice_f21_dry_run_diff_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    let file = dir.join("big.ts");
    std::fs::write(&file, &old).unwrap();
    let mut op = empty_op();
    op.path = Some(PathBuf::from("big.ts"));
    op.symbol = Some("L1500-L1500".into());
    op.code = Some("const line_1500 = 99999;".into());
    op.dry_run = true;
    op.diff = true;
    let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
    let rep = execute_batch_write(gov.state(), &op).unwrap();
    assert_eq!(rep.exit_code, 0, "err: {}", rep.emitted_output);
    assert_eq!(std::fs::read_to_string(&file).unwrap(), old, "dry-run must not modify disk");
    let out_lines: Vec<&str> = rep.emitted_output.lines().collect();
    assert!(
        out_lines.len() <= 16,
        "dry-run --diff dumped body ({} lines):\n{}",
        out_lines.len(),
        rep.emitted_output
    );
    assert!(rep.emitted_output.contains("-const line_1500 = 1500;"));
    assert!(rep.emitted_output.contains("+const line_1500 = 99999;"));
    assert!(rep.emitted_output.ends_with("[Dry Run] Successfully spliced big.ts\n"), "out={:?}", rep.emitted_output);
    assert!(!rep.emitted_output.contains("const line_1 = 1;"));
    assert!(!rep.emitted_output.contains("const line_3100 = 3100;"));

    // 5. Intra-block splice @match must not false-match string literal "match_block"
    let rs_no_match = "fn f(k: &str) -> &'static str {\n    let c = || \"match_block\";\n    if k == \"match\" { return c(); }\n    \"ok\"\n}\n";
    let err = apply_ast_splice(
        rs_no_match,
        Some(rs_no_match),
        Path::new("f.rs"),
        LanguageId::Rust,
        "\n",
        "f@match",
        "match k { _ => \"x\" }",
        false,
        true,
        false,
    )
    .err()
    .expect("f@match must fail when no match_expression exists");
    assert!(err.contains("not found"), "err={err}");

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn regression_wave3_f43_bounded_firewall_diagnostics_no_220_line_dump() {
    use aice_batch_write::diagnostics::{format_context_window, format_firewall_diagnostics};
    use aice_lang_registry::FirewallDiagnostic;

    let mut lines: Vec<String> = (1..=300).map(|i| format!("SELECT {i};")).collect();
    // Simulate a huge single-line mysqldump INSERT at L248
    lines[247] = format!("INSERT INTO `big` VALUES {};", "(1,'payload'),".repeat(200));
    let src = format!("{}\n", lines.join("\n"));

    // 1. Two diagnostics 221 lines apart (L28 and L249): must emit <= 30 total lines (<= 25 context lines)
    let diags = vec![
        FirewallDiagnostic { line: 28, column: 12, message: "Syntax error near L28".into(), context: String::new() },
        FirewallDiagnostic { line: 249, column: 5, message: "Syntax error near L249".into(), context: String::new() },
    ];
    let out = format_firewall_diagnostics(Path::new("outilModule.sql"), LanguageId::MySql, &src, &diags);
    let total_lines = out.lines().count();
    let ctx_lines = out.lines().filter(|l| l.contains('│')).count();
    assert!(total_lines <= 30, "expected <= 30 total lines, got {total_lines}:\n{out}");
    assert!(ctx_lines <= 25, "expected <= 25 context lines, got {ctx_lines}:\n{out}");
    assert!(out.contains("Context around L28") && out.contains("Context around L249"), "missing per-diag windows:\n{out}");
    assert!(!out.contains("140│"), "must NOT dump unrelated middle lines between L28 and L249:\n{out}");
    assert!(out.len() < 4096, "giant single-line dump should be truncated in context, len={}", out.len());

    // 2. Five diagnostics spread across 300 lines: capped to top 3 windows and <= 25 context lines
    let many_diags: Vec<FirewallDiagnostic> = [20, 90, 160, 230, 290]
        .into_iter()
        .map(|ln| FirewallDiagnostic { line: ln, column: 1, message: format!("err L{ln}"), context: String::new() })
        .collect();
    let out_many = format_firewall_diagnostics(Path::new("big.sql"), LanguageId::MySql, &src, &many_diags);
    assert!(out_many.lines().count() <= 30, "many_diags lines={}", out_many.lines().count());
    assert!(out_many.lines().filter(|l| l.contains('│')).count() <= 25);

    // 3. Direct format_context_window(src, 28, 249) is also strictly capped to <= 25 context lines
    let win = format_context_window(&src, 28, 249);
    assert!(win.lines().count() <= 28, "format_context_window dumped {} lines", win.lines().count());
    assert!(win.contains("lines omitted"), "expected omission marker:\n{win}");
}

#[test]
fn regression_wave17_f141_hunk_exact_match_no_indent_doubling() {
    let ctx = EnclosingContext::full_file(None);
    let fw = DefaultSyntaxFirewall;

    // 1. Python exact-match hunk appending col-0 `def bar():` must NOT double-indent foo() or nest bar()
    let py_src = "def foo():\n    x = 1\n    return x\n";
    let py_hunk = extract_hunk_blocks(
        "<<<\n    x = 1\n    return x\n===\n    x = 1\n    return x\n\ndef bar():\n    return 2\n>>>",
    )
    .unwrap();
    let py_out = apply_hunk_blocks(py_src, &py_hunk, Path::new("ind2.py"), LanguageId::Python, "\n", 1, &ctx).unwrap();
    let py_exp = "def foo():\n    x = 1\n    return x\n\ndef bar():\n    return 2\n";
    assert_eq!(py_out, py_exp, "Python exact-match hunk corrupted indentation:\n{py_out}");
    assert!(matches!(fw.verify(&py_out, Path::new("ind2.py"), LanguageId::Python), FirewallVerdict::Valid));

    // 2. YAML exact-match hunk appending col-0 comment (`budgets.yaml` repro) must preserve 2-space mapping indent
    let yaml_src = "default_currency: USD\ncategories:\n  cloud: 300\n  entertainment: 200\n";
    let yaml_hunk = extract_hunk_blocks(
        "<<<\n  cloud: 300\n  entertainment: 200\n===\n  cloud: 300\n  entertainment: 200\n# v17-proof\n>>>",
    )
    .unwrap();
    let yaml_out = apply_hunk_blocks(yaml_src, &yaml_hunk, Path::new("budgets.yaml"), LanguageId::Yaml, "\n", 1, &ctx).unwrap();
    let yaml_exp = "default_currency: USD\ncategories:\n  cloud: 300\n  entertainment: 200\n# v17-proof\n";
    assert_eq!(yaml_out, yaml_exp, "YAML exact-match hunk corrupted indentation:\n{yaml_out}");
    assert!(matches!(fw.verify(&yaml_out, Path::new("budgets.yaml"), LanguageId::Yaml), FirewallVerdict::Valid));

    // 3. Same-indent fuzzy matches (trailing spaces on multi-line & single-line whole-line) must NOT double-indent
    let yaml_ws = "default_currency: USD\ncategories:\n  cloud: 300  \n  entertainment: 200\n";
    let yaml_ws_out = apply_hunk_blocks(yaml_ws, &yaml_hunk, Path::new("budgets.yaml"), LanguageId::Yaml, "\n", 1, &ctx).unwrap();
    assert_eq!(yaml_ws_out, yaml_exp, "Same-indent fuzzy YAML hunk doubled indent:\n{yaml_ws_out}");

    let py_single = "def foo():\n    return 1  \n";
    let py_single_hunk = extract_hunk_blocks(
        "<<<\n    return 1\n===\n    return 1\n\ndef bar():\n    return 2\n>>>",
    )
    .unwrap();
    let py_single_out = apply_hunk_blocks(py_single, &py_single_hunk, Path::new("ind1.py"), LanguageId::Python, "\n", 1, &ctx).unwrap();
    assert_eq!(py_single_out, "def foo():\n    return 1\n\ndef bar():\n    return 2\n");

    // 4. Fuzzy indent-shift MUST still work when search matched via a stripped indentation offset != 0
    let py_fuzzy = extract_hunk_blocks("<<<\nx = 1\nreturn x\n===\nx = 2\nif x:\n    return x\n>>>").unwrap();
    let py_fuzzy_out = apply_hunk_blocks(py_src, &py_fuzzy, Path::new("fuzzy.py"), LanguageId::Python, "\n", 1, &ctx).unwrap();
    assert_eq!(py_fuzzy_out, "def foo():\n    x = 2\n    if x:\n        return x\n");

    let py_shift2 = extract_hunk_blocks("<<<\n  x = 1\n  return x\n===\n  x = 9\n  return x\n>>>").unwrap();
    let py_shift2_out = apply_hunk_blocks(py_src, &py_shift2, Path::new("shift2.py"), LanguageId::Python, "\n", 1, &ctx).unwrap();
    assert_eq!(py_shift2_out, "def foo():\n    x = 9\n    return x\n");

    // 5. True inline single-line substring replacement stays intact
    let inline_src = "    let total = old_val + 1;\n";
    let inline_hunk = extract_hunk_blocks("<<<\nold_val\n===\nnew_val\n>>>").unwrap();
    let inline_out = apply_hunk_blocks(inline_src, &inline_hunk, Path::new("in.ts"), LanguageId::TypeScript, "\n", 1, &ctx).unwrap();
    assert_eq!(inline_out, "    let total = new_val + 1;\n");
}
