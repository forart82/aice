use aice_batch_read::budget::{count_cl100k_exact, truncate_to_token_budget};
use aice_batch_read::discovery_format::{DiscoveryEntry, build_fd_baseline, format_discovery_json, format_discovery_text};
use aice_batch_read::glob::glob_matches;
use aice_batch_read::regex_compile::{CompiledPattern, compile_search_pattern, compile_slash_regex};
use aice_batch_read::search_rank::{build_windows, score_file_matches};
use aice_batch_read::selector::{TargetSelector, parse_target_spec};

#[test]
fn regex_and_glob_engine_handles_bre_flags_and_literal_fallback() {
    let alt = compile_search_pattern(r"export class\|CREATE TABLE", false);
    assert!(alt.is_match("export class App {"));
    assert!(alt.is_match("CREATE TABLE accounts ("));
    assert!(!alt.is_match("let x = 1;"));

    let fallback = compile_search_pattern("[a+b]*(c?)", false);
    assert!(fallback.is_literal);
    assert!(fallback.is_match("Special [a+b]*(c?) chars"));
    assert!(!fallback.is_match("unrelated line"));

    let slash = compile_slash_regex("/mul/i").expect("valid slash regex");
    assert!(slash.is_match("public MUL(a: number)"));
    assert!(glob_matches("src/**/*.rs", "src/sub/mod.rs"));
    assert!(!glob_matches("src/*.rs", "src/sub/mod.rs"));
}

#[test]
fn discovery_formatting_and_fd_baseline_match_golden_contracts() {
    let entries = vec![
        DiscoveryEntry { rel_path: "src/app.ts".into(), lines: 21, bytes: 433 },
        DiscoveryEntry { rel_path: "src/math.ts".into(), lines: 20, bytes: 406 },
        DiscoveryEntry { rel_path: "src/notes.txt".into(), lines: 3, bytes: 145 },
        DiscoveryEntry { rel_path: "src/migrations/V001.sql".into(), lines: 13, bytes: 366 },
    ];
    let text = format_discovery_text(&entries, &[], None, 5000);
    assert!(text.contains("src/: app.ts (21L), math.ts (20L), notes.txt (3L)"));
    assert!(text.contains("src/migrations/V001.sql (13L)"));

    let json = format_discovery_json(std::path::Path::new("/proj"), &entries);
    assert!(json.contains("\"mode\": \"files\""));
    assert!(json.contains("\"count\": 4"));
    assert!(json.contains("\"sizeKB\": 0.4"));

    let fd = build_fd_baseline(&entries, &["extra".into()]);
    assert!(fd.contains("extra/\n"));
    assert!(fd.contains("src/app.ts\n"));
}

#[test]
fn four_tier_search_ranking_prefers_prod_defs_over_tests_and_comments() {
    let pat = compile_search_pattern("Calculator", false);
    let prod_lines = ["// Calculator comment", "export class Calculator {"];
    let test_lines = ["const c = new Calculator();"];
    let (prod_score, prod_hits) =
        score_file_matches("src/math.ts", "Calculator", &pat, &prod_lines).unwrap();
    let (test_score, test_hits) =
        score_file_matches("src/math.spec.ts", "Calculator", &pat, &test_lines).unwrap();
    assert!(prod_score > test_score);
    assert_eq!(prod_hits, vec![1, 2]);
    assert_eq!(test_hits, vec![1]);
    assert_eq!(build_windows(&[1, 3, 10], 12, 1), vec![(1, 4), (9, 11)]);
}

#[test]
fn selector_parses_line_ranges_ordinals_and_intra_blocks() {
    assert_eq!(
        parse_target_spec("src/a.rs:10-45").selectors,
        vec![TargetSelector::LineRange { start: 10, end: 45 }]
    );
    assert_eq!(
        parse_target_spec("src/a.rs:L7").selectors,
        vec![TargetSelector::LineRange { start: 7, end: 7 }]
    );
    assert_eq!(
        parse_target_spec("src/a.rs:L50-L10").selectors,
        vec![TargetSelector::InvertedLineRange { start: 50, end: 10 }]
    );
    match &parse_target_spec("src/a.rs:run@divisible").selectors[0] {
        TargetSelector::IntraBlock(b) => {
            assert_eq!(b.symbol, "run");
            assert_eq!(b.pattern, "divisible");
        }
        other => panic!("expected IntraBlock, got {other:?}"),
    }
}

#[test]
fn case_insensitive_non_ascii_find_literal_returns_valid_char_boundaries_and_never_panics() {
    let pat_e = CompiledPattern::literal("é", true, false);
    let hay_e = "İéé";
    let matches_e = pat_e.find_all_in_line(hay_e);
    assert_eq!(matches_e.len(), 2);
    for m in &matches_e {
        assert!(hay_e.is_char_boundary(m.start_byte));
        assert!(hay_e.is_char_boundary(m.end_byte));
        assert_eq!(&hay_e[m.start_byte..m.end_byte], "é");
    }

    let pat_foo = CompiledPattern::literal("foo", true, false);
    let hay_foo = "İfooé";
    let matches_foo = pat_foo.find_all_in_line(hay_foo);
    assert_eq!(matches_foo.len(), 1);
    assert_eq!(&hay_foo[matches_foo[0].start_byte..matches_foo[0].end_byte], "foo");
    assert!(score_file_matches("a.txt", "foo", &pat_foo, &[hay_foo]).is_none());
    let (_, hit_lines) = score_file_matches("a.txt", "foo", &pat_foo, &["İ foo é"]).unwrap();
    assert_eq!(hit_lines, vec![1]);

    let pat_i = CompiledPattern::literal("i", true, false);
    let hay_tr = "İstanbul";
    let matches_i = pat_i.find_all_in_line(hay_tr);
    assert!(!matches_i.is_empty());
    assert!(hay_tr.is_char_boundary(matches_i[0].start_byte));
    assert!(hay_tr.is_char_boundary(matches_i[0].end_byte));
}

#[test]
fn discovery_and_budget_respect_tight_max_tokens_and_zero() {
    let mut entries = Vec::new();
    for i in 0..13 {
        entries.push(DiscoveryEntry {
            rel_path: format!("src/extra_{i}.ts"),
            lines: 2,
            bytes: 40,
        });
    }
    let out_20 = format_discovery_text(&entries, &[], None, 20);
    assert!(count_cl100k_exact(&out_20) <= 20, "out_20={out_20}");
    assert!(out_20.contains("// +13 more entries"), "out_20={out_20}");

    let out_35 = format_discovery_text(&entries, &[], None, 35);
    assert!(count_cl100k_exact(&out_35) <= 35, "out_35={out_35}");
    let shown = out_35
        .lines()
        .find(|l| l.starts_with("src/: "))
        .map_or(0, |l| l.split(", ").count());
    assert!(shown > 0 && shown < 13, "shown={shown}, out_35={out_35}");
    let expected_rem = 13 - shown;
    assert!(
        out_35.contains(&format!("// +{expected_rem} more entries")),
        "expected +{expected_rem} in {out_35}"
    );

    let (trunc_zero, did_trunc) = truncate_to_token_budget("pub fn x() {}\n", 0, None);
    assert!(did_trunc);
    assert_eq!(count_cl100k_exact(&trunc_zero), 0);
}

fn build_deep_ts(depth: usize) -> String {
    let mut s = String::from("export function deep(x: number): number {\n");
    for _ in 0..depth {
        s.push_str("  if (x > 0) {\n");
    }
    s.push_str("  return x;\n");
    for _ in 0..depth {
        s.push_str("  }\n");
    }
    s.push_str("  return 0;\n}\n");
    s
}

#[test]
fn deep_4500_batch_read_succeeds_on_2mib_stack_and_preserves_cls() {
    use aice_batch_read::execute_batch_read;
    use aice_batch_read::search::execute_search;
    use aice_governance::{OutputSurface, PipelineRequest, ReadOp, SearchOp, authorize};

    let root = std::env::temp_dir().join(format!("aice_br_deep_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&root);
    std::fs::create_dir_all(root.join("src")).expect("mkdir");
    std::fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").expect("write cfg");

    std::fs::write(root.join("src/deep.ts"), build_deep_ts(4_500)).expect("write deep.ts");
    let mut twig = String::new();
    for _ in 0..4_500 { twig.push_str("{% if flag %}<div>"); }
    twig.push_str("ok");
    for _ in 0..4_500 { twig.push_str("</div>{% endif %}"); }
    std::fs::write(root.join("src/deep.twig"), twig).expect("write deep.twig");

    let mut json = String::new();
    for _ in 0..4_500 { json.push_str("{\"a\":"); }
    json.push('1');
    for _ in 0..4_500 { json.push('}'); }
    std::fs::write(root.join("src/deep.json"), json).expect("write deep.json");

    std::fs::write(
        root.join("src/cls.py"),
        "class Node:\n    @classmethod\n    def make(cls, flag: bool):\n        if flag:\n            return cls(\n                flag\n            )\n        return cls(False)\n",
    )
    .expect("write cls.py");
    std::fs::write(
        root.join("src/cls.ts"),
        "export class Node {\n  static make(cls: Node, flag: boolean): Node {\n    if (flag) {\n      return cls;\n    }\n    return cls;\n  }\n}\n",
    )
    .expect("write cls.ts");

    let ws = root.clone();
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || {
            let make_read = |targets: Vec<String>, full: bool| ReadOp {
                targets,
                target_paths: Vec::new(),
                outline: false,
                outline_target: false,
                full,
                depth: None,
                symbol: None,
                search: None,
                context_lines: None,
                files_only: false,
                compact: true,
                include_types: true,
                include_deps: false,
                include_callers: false,
                max_tokens: None,
                json: false,
                stats: false,
            };

            for (tgt, full) in [
                ("src/deep.ts", true),
                ("src/deep.ts:deep", true),
                ("src/deep.ts:L1-L5", false),
                ("src/deep.twig", true),
                ("src/deep.json", true),
            ] {
                let op = make_read(vec![tgt.into()], full);
                let gov = authorize(PipelineRequest::new(op.clone(), ws.clone(), OutputSurface::Cli)).expect("auth");
                let pack = execute_batch_read(gov.state(), &op).expect("batch read");
                assert!(!pack.emitted_output.is_empty(), "empty output for {tgt}");
            }

            let py_blk_op = make_read(vec!["src/cls.py:make@cls".into()], false);
            let gov_py = authorize(PipelineRequest::new(py_blk_op.clone(), ws.clone(), OutputSurface::Cli)).unwrap();
            let py_pack = execute_batch_read(gov_py.state(), &py_blk_op).unwrap();
            assert!(py_pack.emitted_output.contains("ret cls"), "py intra missing 'ret cls':\n{}", py_pack.emitted_output);
            assert!(!py_pack.emitted_output.contains("return class"), "corrupted cls -> class:\n{}", py_pack.emitted_output);
            assert!(!py_pack.emitted_output.contains("def make("), "emitted raw python:\n{}", py_pack.emitted_output);

            let ts_blk_op = make_read(vec!["src/cls.ts:make@cls".into()], false);
            let gov_ts = authorize(PipelineRequest::new(ts_blk_op.clone(), ws.clone(), OutputSurface::Cli)).unwrap();
            let ts_pack = execute_batch_read(gov_ts.state(), &ts_blk_op).unwrap();
            assert!(ts_pack.emitted_output.contains("ret cls"), "ts intra missing 'ret cls':\n{}", ts_pack.emitted_output);
            assert!(!ts_pack.emitted_output.contains("return class"), "corrupted ts cls -> class:\n{}", ts_pack.emitted_output);

            let search_op = SearchOp {
                pattern: "cls".into(),
                targets: vec!["src/cls.py".into()],
                target_paths: Vec::new(),
                context_lines: Some(1),
                line_numbers: true,
                symbol: None,
                files_with_matches: false,
                full: false,
                max_tokens: None,
                json: false,
                stats: false,
            };
            let gov_s = authorize(PipelineRequest::new(search_op.clone(), ws.clone(), OutputSurface::Cli)).unwrap();
            let s_pack = execute_search(gov_s.state(), &search_op).unwrap();
            assert!(s_pack.emitted_output.contains("cls("), "search corrupted cls:\n{}", s_pack.emitted_output);
            assert!(!s_pack.emitted_output.contains("class("), "search corrupted cls -> class:\n{}", s_pack.emitted_output);
        })
        .expect("spawn 2MiB");
    let res = handle.join();
    let _ = std::fs::remove_dir_all(&root);
    res.expect("2MiB thread panicked");
}
