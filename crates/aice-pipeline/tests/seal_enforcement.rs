use std::path::PathBuf;

use aice_governance::{
    AdminAction, AdminOp, GovernanceError, OutputSurface, PipelineRequest, ReadOp, WriteOp,
    authorize, authorize_admin,
};
use aice_pipeline::{DefaultPipelineExecutor, PipelineExecutor, meter_and_seal};

fn make_temp_project(name: &str, enabled: bool) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aice_pipe_{name}_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    std::fs::write(
        dir.join("aice.config.json"),
        format!("{{\"enabled\": {enabled}}}"),
    )
    .expect("write config");
    dir
}

fn read_op(target: &str) -> ReadOp {
    ReadOp {
        targets: vec![target.to_string()],
        target_paths: vec![PathBuf::from(target)],
        outline: false,
        outline_target: false,
        full: false,
        depth: None,
        symbol: None,
        search: None,
        context_lines: None,
        files_only: false,
        compact: true,
        include_types: true,
        include_deps: true,
        include_callers: true,
        max_tokens: None,
        json: false,
        stats: false,
    }
}

#[test]
fn pipeline_enforces_governance_and_seals_output() {
    let enabled_dir = make_temp_project("enabled", true);
    let sample = enabled_dir.join("hello.rs");
    std::fs::write(&sample, "pub fn hi() {}\n").expect("write sample");

    let req = PipelineRequest::new(
        read_op("hello.rs"),
        enabled_dir.clone(),
        OutputSurface::Cli,
    );
    let gov = authorize(req).expect("authorize valid read");
    let exec = DefaultPipelineExecutor
        .execute_read(gov)
        .expect("execute read");
    let metered = meter_and_seal(exec);
    assert_eq!(metered.exit_code(), 0);
    assert!(metered.payload().contains("hello.rs"));

    let disabled_dir = make_temp_project("disabled", false);
    let blocked_req = PipelineRequest::new(
        read_op("hello.rs"),
        disabled_dir.clone(),
        OutputSurface::Cli,
    );
    assert_eq!(authorize(blocked_req).unwrap_err(), GovernanceError::Disabled);

    let admin_req = PipelineRequest::new(
        AdminOp {
            action: AdminAction::Version,
        },
        disabled_dir.clone(),
        OutputSurface::Cli,
    );
    let admin_gov = authorize_admin(admin_req).expect("admin allowed when disabled");
    let admin_exec = DefaultPipelineExecutor
        .execute_admin(admin_gov)
        .expect("execute admin");
    let admin_metered = meter_and_seal(admin_exec);
    assert_eq!(admin_metered.exit_code(), 0);
    assert_eq!(admin_metered.payload().trim(), "0.9.53");

    let mut split_brain_read = read_op("/etc/shadow");
    split_brain_read.target_paths.clear();
    assert!(matches!(
        authorize(PipelineRequest::new(
            split_brain_read,
            enabled_dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut selector_read = read_op("hello.rs:hi");
    selector_read.target_paths.clear();
    let sel_gov = authorize(PipelineRequest::new(
        selector_read,
        enabled_dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("selector read authorized");
    let sel_exec = DefaultPipelineExecutor
        .execute_read(sel_gov)
        .expect("execute selector read");
    let sel_metered = meter_and_seal(sel_exec);
    assert_eq!(sel_metered.exit_code(), 0);
    assert!(sel_metered.payload().contains("hello.rs"));

    let help_gov = authorize_admin(PipelineRequest::new(
        AdminOp {
            action: AdminAction::Help,
        },
        disabled_dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("admin help allowed");
    let help_exec = DefaultPipelineExecutor
        .execute_admin(help_gov)
        .expect("execute help");
    let help_metered = meter_and_seal(help_exec);
    assert_eq!(help_metered.exit_code(), 0);
    assert!(help_metered.payload().contains("COMMANDS:"));
    assert!(help_metered.payload().contains("benchmark"));

    let _ = std::fs::remove_dir_all(&enabled_dir);
    let _ = std::fs::remove_dir_all(&disabled_dir);
}

#[test]
fn pipeline_rejects_colon_traversal_write_and_unifies_single_letter_selector() {
    let dir = make_temp_project("colon_pipe", true);
    std::fs::create_dir_all(dir.join("safe:")).expect("create colon dir");
    std::fs::write(dir.join("a"), "line1\nline2\n").expect("write a");

    let evil_write = WriteOp {
        path: Some(PathBuf::from("safe:/../../../etc/shadow")),
        symbol: None,
        code: Some("evil".into()),
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
        dry_run: true,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    };
    assert!(matches!(
        authorize(PipelineRequest::new(
            evil_write,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut single_letter_read = read_op("a:L1-L5");
    single_letter_read.target_paths.clear();
    let gov = authorize(PipelineRequest::new(
        single_letter_read,
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("single letter selector read authorized");
    let exec = DefaultPipelineExecutor
        .execute_read(gov)
        .expect("execute read");
    let metered = meter_and_seal(exec);
    assert_eq!(metered.exit_code(), 0);
    assert!(metered.payload().contains("// file: a\n"));

    let _ = std::fs::remove_dir_all(&dir);
}


#[test]
fn pipeline_execute_write_blocks_watch1_regex_and_invalid_selector_tails() {
    let dir = make_temp_project("write_guard_pipe", true);
    std::fs::write(dir.join("file.rs"), "pub fn Sym() {}\n").expect("write file.rs");

    let base = WriteOp {
        path: None,
        symbol: None,
        code: Some("pub fn ok() {}".into()),
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
        dry_run: true,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    };

    let mut space_comma = base.clone();
    space_comma.path = Some(PathBuf::from("file.rs:Sym, /evil/"));
    let gov1 = authorize(PipelineRequest::new(space_comma, dir.clone(), OutputSurface::Mcp))
        .expect("governed");
    assert!(DefaultPipelineExecutor.execute_write(gov1).is_err());

    let mut batch_regex = base.clone();
    batch_regex.batch = Some("=== file.rs:Sym,/evil/ ===\npub fn ok() {}\n".into());
    let gov2 = authorize(PipelineRequest::new(batch_regex, dir.clone(), OutputSurface::Mcp))
        .expect("governed");
    assert!(DefaultPipelineExecutor.execute_write(gov2).is_err());

    let mut edits_regex = base.clone();
    edits_regex.edits = Some(r#"[{"path":"file.rs:/evil/","code":"pub fn ok() {}"}]"#.into());
    let gov3 = authorize(PipelineRequest::new(edits_regex, dir.clone(), OutputSurface::Mcp))
        .expect("governed");
    assert!(DefaultPipelineExecutor.execute_write(gov3).is_err());

    for (key, sel) in [
        ("insert_after", "Sym,/evil/"),
        ("insertAfter", "Sym,/evil/"),
        ("insert_before", "Sym,/evil/"),
        ("insertBefore", "Sym,/evil/"),
    ] {
        let mut edits_anchor = base.clone();
        edits_anchor.edits = Some(format!(
            r#"[{{"path":"file.rs","{key}":"{sel}","code":"pub fn ok() {{}}"}}]"#
        ));
        let gov_e = authorize(PipelineRequest::new(edits_anchor, dir.clone(), OutputSurface::Mcp))
            .expect("governed");
        assert!(
            DefaultPipelineExecutor.execute_write(gov_e).is_err(),
            "edits key {key} must reject regex selector"
        );

        let mut batch_anchor = base.clone();
        batch_anchor.batch = Some(format!(
            r#"[{{"path":"file.rs","{key}":"{sel}","code":"pub fn ok() {{}}"}}]"#
        ));
        let gov_b = authorize(PipelineRequest::new(batch_anchor, dir.clone(), OutputSurface::Mcp))
            .expect("governed");
        assert!(
            DefaultPipelineExecutor.execute_write(gov_b).is_err(),
            "batch key {key} must reject regex selector"
        );
    }

    let _ = std::fs::remove_dir_all(&dir);
}


#[test]
fn pipeline_execute_write_rejects_targetless_write_ops_and_preserves_heredoc_code() {
    let dir = make_temp_project("targetless_write_pipe", true);
    std::fs::write(dir.join("file.rs"), "pub fn Sym() {}\n").expect("write file.rs");
    std::fs::write(dir.join("patch.rs"), "pub fn BROKEN( {\n").expect("write patch.rs");

    let base = WriteOp {
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
    };

    let targetless_cases: Vec<(&str, WriteOp)> = vec![
        ("code", {
            let mut op = base.clone();
            op.code = Some("pub fn BROKEN( {".into());
            op
        }),
        ("body", {
            let mut op = base.clone();
            op.body = Some("pub fn BROKEN( {".into());
            op
        }),
        ("template", {
            let mut op = base.clone();
            op.template = Some("pub fn BROKEN( {".into());
            op
        }),
        ("delete", {
            let mut op = base.clone();
            op.delete = Some("Sym".into());
            op
        }),
        ("from_file", {
            let mut op = base.clone();
            op.from_file = Some(PathBuf::from("patch.rs"));
            op
        }),
        ("from_stdin", {
            let mut op = base.clone();
            op.from_stdin = true;
            op
        }),
        ("edits_empty", {
            let mut op = base.clone();
            op.edits = Some("[]".into());
            op
        }),
        ("batch_empty", {
            let mut op = base.clone();
            op.batch = Some(String::new());
            op
        }),
        ("empty_write_op", base.clone()),
    ];

    for (label, op) in targetless_cases {
        let gov = authorize(PipelineRequest::new(op, dir.clone(), OutputSurface::Mcp))
            .unwrap_or_else(|e| panic!("expected authorize ok for {label}: {e}"));
        let res = DefaultPipelineExecutor.execute_write(gov);
        assert!(
            matches!(res, Err(aice_pipeline::PipelineError::Execution(_))),
            "targetless write op '{label}' must be rejected"
        );
    }

    let mut heredoc_ok = base.clone();
    heredoc_ok.code = Some("=== file.rs ===\npub fn ok() {}\n".into());
    let gov_ok = authorize(PipelineRequest::new(heredoc_ok, dir.clone(), OutputSurface::Mcp))
        .expect("authorize heredoc code");
    assert!(
        DefaultPipelineExecutor.execute_write(gov_ok).is_ok(),
        "heredoc --code with valid target must still execute"
    );

    let mut smuggled_targets = base;
    smuggled_targets.target_paths = vec![PathBuf::from("file.rs:Sym,/evil/")];
    let gov_smuggle =
        authorize(PipelineRequest::new(smuggled_targets, dir.clone(), OutputSurface::Mcp))
            .expect("authorize smuggled target_paths");
    assert!(
        DefaultPipelineExecutor.execute_write(gov_smuggle).is_err(),
        "target_paths with regex selector must be rejected"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn meter_and_seal_error_path_telemetry_invariants_and_operation_targets() {
    use aice_governance::{FindOp, OperationTargets, SearchOp};
    use aice_pipeline::meter_and_seal_to;
    use aice_telemetry::{
        count_cl100k, load_telemetry_errors, load_telemetry_events,
    };

    let dir = make_temp_project("seal_err_invariants", true);
    let gains = dir.join("telemetry/gains.jsonl");
    let errors = dir.join("telemetry/errors.jsonl");
    std::fs::write(dir.join("sample.rs"), "pub fn alpha() {}\n").unwrap();

    // 1. ReadOp failure with wasted_input_tokens: Some(...) (missing symbol)
    let mut bad_sym_read = read_op("sample.rs:nonexistent_sym");
    bad_sym_read.target_paths.clear();
    let gov1 = authorize(PipelineRequest::new(bad_sym_read, dir.clone(), OutputSurface::Cli)).unwrap();
    let exec1 = DefaultPipelineExecutor.execute_read(gov1).unwrap();
    let m1 = meter_and_seal_to(exec1, Some(&gains));
    assert_eq!(m1.exit_code(), 1);
    assert_eq!(m1.summary().native_cl100k, 0);
    assert_eq!(m1.summary().saved_cl100k, -(m1.summary().aice_cl100k as isize));

    // 2. ReadOp failure with wasted_input_tokens: None (missing file)
    let mut missing_read = read_op("does_not_exist.rs");
    missing_read.target_paths.clear();
    let gov2 = authorize(PipelineRequest::new(missing_read, dir.clone(), OutputSurface::Cli)).unwrap();
    let exec2 = DefaultPipelineExecutor.execute_read(gov2).unwrap();
    let m2 = meter_and_seal_to(exec2, Some(&gains));
    assert_eq!(m2.exit_code(), 1);
    assert_eq!(m2.summary().native_cl100k, 0);

    // 3. WriteOp failure with wasted_input_tokens: Some(...) (missing symbol)
    let bad_write = WriteOp {
        path: Some(PathBuf::from("sample.rs")),
        symbol: Some("missing_fn".into()),
        code: Some("pub fn missing_fn() { let x = 1; }".into()),
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
        target_paths: vec![PathBuf::from("sample.rs")],
    };
    let gov3 = authorize(PipelineRequest::new(bad_write, dir.clone(), OutputSurface::Cli)).unwrap();
    let exec3 = DefaultPipelineExecutor.execute_write(gov3).unwrap();
    let m3 = meter_and_seal_to(exec3, Some(&gains));
    assert_eq!(m3.exit_code(), 1);
    let expected_wasted = Some(count_cl100k("pub fn missing_fn() { let x = 1; }"));
    assert_eq!(m3.summary().native_cl100k, 0);
    assert_eq!(m3.summary().saved_cl100k, -(m3.summary().aice_cl100k as isize));

    let gain_rows = load_telemetry_events(&gains, false);
    assert_eq!(gain_rows.len(), 3, "expected 3 error rows in gains.jsonl");
    for row in &gain_rows {
        assert_eq!(row.file_path, "<cli-error>");
        assert_eq!(row.native_cl100k, 0);
        assert_eq!(row.saved_cl100k, -(row.aice_cl100k as isize));
    }
    assert!(gain_rows[0].wasted_input_tokens.is_some());
    assert_eq!(gain_rows[1].wasted_input_tokens, None);
    assert_eq!(gain_rows[2].wasted_input_tokens, expected_wasted);

    let err_rows = load_telemetry_errors(None, Some(&errors));
    assert_eq!(err_rows.len(), 3, "expected 3 rows in errors.jsonl");
    assert_eq!(err_rows[0].file_path, "sample.rs");
    assert!(err_rows[0].wasted_input_tokens.is_some());
    assert_eq!(err_rows[1].wasted_input_tokens, None);
    assert_eq!(err_rows[2].file_path, "sample.rs");
    assert_eq!(err_rows[2].wasted_input_tokens, expected_wasted);

    // 4. OperationTargets::raw_target_strings vs target_paths across ReadOp/SearchOp/FindOp/WriteOp
    let mut r_mix = read_op("src/a.rs:L1-L5");
    r_mix.target_paths.clear();
    assert_eq!(r_mix.raw_target_strings(), vec!["src/a.rs:L1-L5"]);
    assert_eq!(r_mix.target_paths(), vec![PathBuf::from("src/a.rs")]);

    let s_op = SearchOp {
        pattern: "foo".into(),
        targets: vec!["--".into(), "src/a.rs:1-3".into()],
        target_paths: vec![],
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: None,
        json: false,
        stats: false,
    };
    assert_eq!(s_op.raw_target_strings(), vec!["--", "src/a.rs:1-3"]);
    assert_eq!(s_op.target_paths(), vec![PathBuf::from("--"), PathBuf::from("src/a.rs")]);

    let f_op = FindOp {
        pattern: None,
        targets: vec!["src".into()],
        target_paths: vec![],
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    };
    assert_eq!(f_op.raw_target_strings(), vec!["src"]);
    assert_eq!(f_op.target_paths(), vec![PathBuf::from("src")]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn c1_r2_g1_targeted_search_omitted_or_unmatched_leaves_mf_empty_in_gains() {
    use aice_governance::SearchOp;
    use aice_pipeline::meter_and_seal_to;
    use aice_telemetry::load_telemetry_events;

    let dir = make_temp_project("c1_r2_g1_search_mf", true);
    let gains = dir.join("telemetry/gains.jsonl");
    std::fs::write(dir.join("f0.ts"), "export function hitFn(): number { return 1; } // HIT_ME\n").unwrap();

    let cases = [
        ("HIT_ME", true, Some(1usize)),
        ("HIT_ME", false, Some(5usize)),
        ("NO_MATCH_XYZ", false, None),
    ];
    for (pat, fwm, mt) in cases {
        let op = SearchOp {
            pattern: pat.into(),
            targets: vec!["f0.ts".into()],
            target_paths: vec![PathBuf::from("f0.ts")],
            context_lines: None,
            line_numbers: !fwm,
            symbol: None,
            files_with_matches: fwm,
            full: false,
            max_tokens: mt,
            json: false,
            stats: false,
        };
        let gov = authorize(PipelineRequest::new(op, dir.clone(), OutputSurface::Cli)).unwrap();
        let exec = DefaultPipelineExecutor.execute_search(gov).unwrap();
        let m = meter_and_seal_to(exec, Some(&gains));
        assert_eq!(m.exit_code(), 0);
        assert_eq!(m.summary().native_cl100k, 0);
    }

    let rows = load_telemetry_events(&gains, false);
    assert_eq!(rows.len(), 3);
    for row in rows {
        assert!(row.multi_files.is_empty(), "targeted omitted/0-match search leaked mf: {:?}", row.multi_files);
        assert_eq!(row.native_cl100k, 0);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wave3_f39_mcp_schemas_expose_required_empty_array_on_both_tools() {
    use aice_governance::{JsonValue, parse_json};
    use aice_pipeline::{build_tools_list_result, render_mcp_schema_files};

    let list = build_tools_list_result();
    let tools = list
        .as_object()
        .unwrap()
        .get("tools")
        .unwrap()
        .as_array()
        .unwrap();
    assert_eq!(tools.len(), 2);
    for expected_name in ["aice_read", "aice_splice"] {
        let tool = tools
            .iter()
            .find(|t| {
                t.as_object()
                    .and_then(|o| o.get("name"))
                    .and_then(JsonValue::as_str)
                    == Some(expected_name)
            })
            .unwrap_or_else(|| panic!("missing tool {expected_name}"));
        let req = tool
            .as_object()
            .unwrap()
            .get("inputSchema")
            .unwrap()
            .as_object()
            .unwrap()
            .get("required")
            .and_then(JsonValue::as_array);
        assert_eq!(req, Some([].as_slice()), "tool {expected_name} missing required: []");
    }

    let rendered = render_mcp_schema_files();
    let splice_raw = rendered
        .iter()
        .find(|(name, _)| *name == "aice_splice.json")
        .map(|(_, body)| body.as_str())
        .expect("aice_splice.json rendered");
    let parsed = parse_json(splice_raw).expect("valid aice_splice.json");
    let obj = parsed.as_object().unwrap();
    for key in ["inputSchema", "parameters"] {
        let req = obj
            .get(key)
            .unwrap()
            .as_object()
            .unwrap()
            .get("required")
            .and_then(JsonValue::as_array);
        assert_eq!(req, Some([].as_slice()), "aice_splice.json {key} missing required: []");
    }
}
