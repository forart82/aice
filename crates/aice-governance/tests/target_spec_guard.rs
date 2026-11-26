use std::path::PathBuf;

use aice_governance::{
    FindOp, GovernanceError, OutputSurface, PipelineRequest, ReadOp, SearchOp, WriteOp, authorize,
    split_target_selector,
};

fn make_temp_project(name: &str, config_body: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aice_tspec_{name}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp project");
    std::fs::write(dir.join("aice.config.json"), config_body).expect("write config");
    dir
}

fn read_op(target: &str) -> ReadOp {
    ReadOp {
        targets: vec![target.to_string()],
        target_paths: vec![],
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

fn search_op(target: &str) -> SearchOp {
    SearchOp {
        pattern: "pat".into(),
        targets: vec![target.to_string()],
        target_paths: vec![],
        context_lines: None,
        line_numbers: false,
        symbol: None,
        files_with_matches: false,
        full: false,
        max_tokens: None,
        json: false,
        stats: false,
    }
}

fn find_op(target: &str) -> FindOp {
    FindOp {
        pattern: None,
        targets: vec![target.to_string()],
        target_paths: vec![],
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    }
}

fn write_op(path: Option<&str>, batch: Option<&str>, edits: Option<&str>) -> WriteOp {
    WriteOp {
        path: path.map(PathBuf::from),
        symbol: None,
        code: Some("pub fn ok() {}".into()),
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: edits.map(str::to_string),
        batch: batch.map(str::to_string),
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: true,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    }
}

#[test]
fn disambiguates_windows_two_segment_paths_and_regex_selectors() {
    for raw in [
        "C:/Windows/sys", "C:/etc/sys", "C:/foo/gui", "C:/etc/gi",
        "C:/src/img", "C:/var/msg", "D:/a/m", "C:/Windows/",
    ] {
        assert_eq!(split_target_selector(raw), (raw, None), "for {raw}");
    }
    assert_eq!(split_target_selector("C:/foo/bar.rs:/pat/gi"), ("C:/foo/bar.rs", Some("/pat/gi")));
    assert_eq!(split_target_selector("C:/foo/bar.rs:L1-L5"), ("C:/foo/bar.rs", Some("L1-L5")));
    for (raw, file, sel) in [
        ("f:/a|b/gi", "f", "/a|b/gi"),
        (r"f:/fn\s+foo/", "f", r"/fn\s+foo/"),
        ("f:/a:b/", "f", "/a:b/"),
        ("f:/a#b/", "f", "/a#b/"),
        ("f:/abc/gi", "f", "/abc/gi"),
        ("f:/pat/", "f", "/pat/"),
        ("f:/[a/b]/gi", "f", "/[a/b]/gi"),
        (r"f:/a\/b,c/,Sym", "f", r"/a\/b,c/,Sym"),
        ("F:/a|b/gi", "F", "/a|b/gi"),
    ] {
        assert_eq!(split_target_selector(raw), (file, Some(sel)), "for {raw}");
    }
}

#[test]
fn blocks_non_drive_colon_slash_laundering_across_all_ops() {
    let no_safe = make_temp_project("no_safe", r#"{"enabled": true}"#);
    let with_colon_dir = make_temp_project("colon_dir", r#"{"enabled": true}"#);
    std::fs::create_dir_all(with_colon_dir.join("safe:")).expect("create safe: dir");

    for dir in [&no_safe, &with_colon_dir] {
        for raw in ["safe:/etc/sys", "safe:/etc/gi", "safe:/etc/img", "safe:/etc/shadow", "c:/etc/gi"] {
            assert!(matches!(authorize(PipelineRequest::new(read_op(raw), dir.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))), "ReadOp {raw}");
            assert!(matches!(authorize(PipelineRequest::new(search_op(raw), dir.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))), "SearchOp {raw}");
            assert!(matches!(authorize(PipelineRequest::new(find_op(raw), dir.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))), "FindOp {raw}");
            if raw != "c:/etc/gi" {
                assert!(matches!(authorize(PipelineRequest::new(write_op(Some(raw), None, None), dir.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))), "WriteOp {raw}");
            }
        }
    }

    std::fs::write(no_safe.join("safe_file"), "pat\n").expect("write safe_file");
    let ok_read = authorize(PipelineRequest::new(read_op("safe_file:/pat/i"), no_safe.clone(), OutputSurface::Cli))
        .expect("contained existing file with regex selector allowed");
    assert!(ok_read.state().authorized_paths()[0].requested.ends_with("safe_file"));
    assert!(authorize(PipelineRequest::new(search_op("safe_file:/pat/i"), no_safe.clone(), OutputSurface::Cli)).is_ok());
    assert!(matches!(authorize(PipelineRequest::new(find_op("safe_file:/pat/i"), no_safe.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))));
    assert!(matches!(authorize(PipelineRequest::new(write_op(Some("safe_file:/pat/i"), None, None), no_safe.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))));

    #[cfg(unix)]
    {
        let outside = make_temp_project("outside_sym", r#"{"enabled": true}"#);
        std::fs::write(outside.join("secret.txt"), "secret\n").expect("write outside secret");
        std::os::unix::fs::symlink(outside.join("secret.txt"), no_safe.join("safe")).expect("create symlink");
        assert!(matches!(authorize(PipelineRequest::new(read_op("safe:/etc/gi"), no_safe.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))));
        let _ = std::fs::remove_dir_all(&outside);
    }

    let _ = std::fs::remove_dir_all(&no_safe);
    let _ = std::fs::remove_dir_all(&with_colon_dir);
}

#[test]
fn handles_bom_prefixed_json_heredocs_bare_cr_and_config() {
    let dir = make_temp_project("bom_enabled", r#"{"enabled": true}"#);
    for (batch, edits) in [
        (Some("\u{FEFF}[{\"path\":\"/etc/shadow\"}]"), None),
        (Some("  \u{FEFF}{\"path\":\"/etc/shadow\"}"), None),
        (None, Some("\u{FEFF}[{\"file\":\"/etc/shadow\"}]")),
        (Some("\u{FEFF}=== /etc/shadow ===\nevil\n"), None),
        (Some("=== safe.rs ===\r=== /etc/shadow ===\revil\r"), None),
    ] {
        assert!(matches!(authorize(PipelineRequest::new(write_op(Some("safe.rs"), batch, edits), dir.clone(), OutputSurface::Cli)), Err(GovernanceError::PathOutsideAllowedRoots(_))));
    }
    let bom_disabled = make_temp_project("bom_disabled", "\u{FEFF}// comment\n{\"enabled\": false}\n");
    assert_eq!(authorize(PipelineRequest::new(read_op("safe.rs"), bom_disabled.clone(), OutputSurface::Cli)).unwrap_err(), GovernanceError::Disabled);
    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&bom_disabled);
}

#[test]
fn heredoc_multi_selector_and_regex_selector_guards() {
    let dir = make_temp_project("heredoc_multi_sel", r#"{"enabled": true}"#);
    std::fs::create_dir_all(dir.join("src")).expect("create src");
    std::fs::write(dir.join("src/a.rs"), "pub fn pat() {}\n").expect("write a.rs");
    std::fs::write(dir.join("src/secret.png"), b"\x89PNG\r\n\x1a\n\x00\x00").expect("write png");

    for header in [
        "=== src/a.rs:Sym,/pat/ ===",
        "=== src/a.rs:/pat/,Sym ===",
        "=== src/a.rs:/a,b/ ===",
        "=== src/a.rs:/a,b/,Sym ===",
    ] {
        let batch = format!("{header}\npub fn ok() {{}}\n");
        let gov = authorize(PipelineRequest::new(
            write_op(None, Some(&batch), None),
            dir.clone(),
            OutputSurface::Cli,
        ))
        .unwrap_or_else(|e| panic!("expected Ok for {header}: {e}"));
        assert_eq!(gov.state().authorized_paths().len(), 1);
        assert!(
            gov.state().authorized_paths()[0].requested.ends_with("src/a.rs"),
            "clean requested path expected for {header}, got {:?}",
            gov.state().authorized_paths()[0].requested
        );
    }

    let mut code_op = write_op(None, None, None);
    code_op.code = Some("=== src/a.rs:/pat/,Sym ===\npub fn ok() {}\n".into());
    let code_gov = authorize(PipelineRequest::new(code_op, dir.clone(), OutputSurface::Cli))
        .expect("code heredoc regex selector allowed");
    assert!(code_gov.state().authorized_paths()[0].requested.ends_with("src/a.rs"));

    for bad_batch in [
        "=== safe:/etc/gi ===\nevil\n",
        "=== c:/etc/gi ===\nevil\n",
        "=== src/a.rs:Sym,/../../etc/passwd/ ===\nevil\n",
        "=== src/a.rs#Sym,/../../etc/passwd/ ===\nevil\n",
    ] {
        assert!(
            matches!(
                authorize(PipelineRequest::new(
                    write_op(None, Some(bad_batch), None),
                    dir.clone(),
                    OutputSurface::Cli
                )),
                Err(GovernanceError::PathOutsideAllowedRoots(_))
            ),
            "expected PathOutsideAllowedRoots for {bad_batch}"
        );
    }

    assert!(matches!(
        authorize(PipelineRequest::new(
            write_op(None, Some("=== src/secret.png:Sym,/pat/ ===\nevil\n"), None),
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::BinaryWriteForbidden(_))
    ));

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/etc/shadow", dir.join("dangling_etc")).expect("symlink");
        assert!(matches!(
            authorize(PipelineRequest::new(
                write_op(None, Some("=== dangling_etc:Sym,/pat/ ===\nevil\n"), None),
                dir.clone(),
                OutputSurface::Cli
            )),
            Err(GovernanceError::PathOutsideAllowedRoots(_))
        ));

        let outside = make_temp_project("heredoc_outside_sym", r#"{"enabled": true}"#);
        std::fs::write(outside.join("secret.txt"), "secret\n").expect("write outside");
        std::os::unix::fs::symlink(outside.join("secret.txt"), dir.join("safe")).expect("safe sym");
        assert!(matches!(
            authorize(PipelineRequest::new(
                write_op(None, Some("=== safe:/etc/gi ===\nevil\n"), None),
                dir.clone(),
                OutputSurface::Cli
            )),
            Err(GovernanceError::PathOutsideAllowedRoots(_))
        ));
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn json_edits_and_batch_selector_guards() {
    let dir = make_temp_project("json_multi_sel", r#"{"enabled": true}"#);
    std::fs::create_dir_all(dir.join("src")).expect("create src");
    std::fs::write(dir.join("src/a.rs"), "pub fn pat() {}\n").expect("write a.rs");
    std::fs::write(dir.join("src/secret.png"), b"\x89PNG\r\n\x1a\n\x00\x00").expect("write png");

    for target in [
        "src/a.rs:/pat/,Sym",
        "src/a.rs:Sym,/pat/",
        "src/a.rs:/a,b/",
        "src/a.rs:/a,b/,Sym",
    ] {
        for key in ["path", "file", "filePath", "file_path", "target"] {
            let payload = format!("[{{\"{key}\":\"{target}\",\"code\":\"ok\"}}]");
            for (batch, edits) in [(None, Some(payload.as_str())), (Some(payload.as_str()), None)] {
                let gov = authorize(PipelineRequest::new(
                    write_op(None, batch, edits),
                    dir.clone(),
                    OutputSurface::Cli,
                ))
                .unwrap_or_else(|e| panic!("expected Ok for {key}={target}: {e}"));
                assert_eq!(gov.state().authorized_paths().len(), 1);
                assert!(gov.state().authorized_paths()[0].requested.ends_with("src/a.rs"));
            }
        }
    }

    let nested = "\u{FEFF}{\"edits\":[{\"target\":\"src/a.rs:/pat/,Sym\",\"code\":\"ok\"},{\"filePath\":\"src/a.rs:Sym,/pat/\",\"code\":\"ok\"}]}";
    for (batch, edits) in [(None, Some(nested)), (Some(nested), None)] {
        let gov = authorize(PipelineRequest::new(
            write_op(None, batch, edits),
            dir.clone(),
            OutputSurface::Cli,
        ))
        .expect("nested BOM JSON selector allowed");
        assert_eq!(gov.state().authorized_paths().len(), 1);
        assert!(gov.state().authorized_paths()[0].requested.ends_with("src/a.rs"));
    }

    for bad_target in [
        "safe:Sym,/etc/gi",
        "safe:/etc/gi",
        "c:/etc/gi",
        "src/a.rs:Sym,/../../etc/passwd/",
        "src/a.rs#Sym,/../../etc/passwd/",
    ] {
        for key in ["path", "file", "filePath", "file_path", "target"] {
            let payload = format!("[{{\"{key}\":\"{bad_target}\",\"code\":\"evil\"}}]");
            for (batch, edits) in [(None, Some(payload.as_str())), (Some(payload.as_str()), None)] {
                assert!(
                    matches!(
                        authorize(PipelineRequest::new(
                            write_op(None, batch, edits),
                            dir.clone(),
                            OutputSurface::Cli,
                        )),
                        Err(GovernanceError::PathOutsideAllowedRoots(_))
                    ),
                    "expected PathOutsideAllowedRoots for {key}={bad_target}"
                );
            }
        }
    }

    let nested_bad = r#"{"items":[{"file_path":"src/a.rs:Sym,/../../etc/passwd/","code":"evil"}]}"#;
    for (batch, edits) in [(None, Some(nested_bad)), (Some(nested_bad), None)] {
        assert!(matches!(
            authorize(PipelineRequest::new(write_op(None, batch, edits), dir.clone(), OutputSurface::Cli)),
            Err(GovernanceError::PathOutsideAllowedRoots(_))
        ));
    }

    let bin_json = r#"[{"path":"src/secret.png:Sym,/pat/","code":"evil"}]"#;
    for (batch, edits) in [(None, Some(bin_json)), (Some(bin_json), None)] {
        assert!(matches!(
            authorize(PipelineRequest::new(write_op(None, batch, edits), dir.clone(), OutputSurface::Cli)),
            Err(GovernanceError::BinaryWriteForbidden(_))
        ));
    }

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink("/etc/shadow", dir.join("dangling_etc")).expect("dangling");
        for raw in ["dangling_etc:Sym,/pat/", "dangling_etc:Sym"] {
            let payload = format!(r#"[{{"path":"{raw}","code":"evil"}}]"#);
            for (batch, edits) in [(None, Some(payload.as_str())), (Some(payload.as_str()), None)] {
                assert!(matches!(
                    authorize(PipelineRequest::new(write_op(None, batch, edits), dir.clone(), OutputSurface::Cli)),
                    Err(GovernanceError::PathOutsideAllowedRoots(_))
                ));
            }
        }

        let outside = make_temp_project("json_outside_sym", r#"{"enabled": true}"#);
        std::fs::write(outside.join("secret.txt"), "secret\n").expect("write outside");
        std::os::unix::fs::symlink(outside.join("secret.txt"), dir.join("src/link_out")).expect("link_out");
        std::os::unix::fs::symlink(dir.join("src/secret.png"), dir.join("src/link_png")).expect("link_png");

        let out_payload = r#"[{"filePath":"src/link_out:Sym,/pat/","code":"evil"}]"#;
        let png_payload = r#"[{"target":"src/link_png:Sym,/pat/","code":"evil"}]"#;
        for (batch, edits) in [(None, Some(out_payload)), (Some(out_payload), None)] {
            assert!(matches!(
                authorize(PipelineRequest::new(write_op(None, batch, edits), dir.clone(), OutputSurface::Cli)),
                Err(GovernanceError::PathOutsideAllowedRoots(_))
            ));
        }
        for (batch, edits) in [(None, Some(png_payload)), (Some(png_payload), None)] {
            assert!(matches!(
                authorize(PipelineRequest::new(write_op(None, batch, edits), dir.clone(), OutputSurface::Cli)),
                Err(GovernanceError::BinaryWriteForbidden(_))
            ));
        }
        let _ = std::fs::remove_dir_all(&outside);
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn json_escaped_nul_and_control_bytes_in_edits_and_batch() {
    let dir = make_temp_project("json_escaped_nul", r#"{"enabled": true}"#);
    std::fs::create_dir_all(dir.join("src")).expect("create src");
    std::fs::write(dir.join("src/a.rs"), "pub fn pat() {}\n").expect("write a.rs");

    let nul_edits = r#"[{"path":"src/a.rs","code":"fn pat() {}\u0000ELF"}]"#;
    let bom_nul = "\u{FEFF}  [{\"target\":\"src/a.rs\",\"code\":\"ok\\u0000bad\"}]";
    let nested_nul = r#"{"items":[{"file":"src/a.rs","nested":{"body":"ok\u0000bad"}}]}"#;
    let ctrl_payload = r#"[{"filePath":"src/a.rs","code":"\u0007\u0007\u0007\u0007\u0007"}]"#;
    let long_tail_nul = format!(
        r#"[{{"path":"src/a.rs","code":"{}\u0000tail"}}]"#,
        "a".repeat(9000)
    );

    for bad in [nul_edits, bom_nul, nested_nul, ctrl_payload, long_tail_nul.as_str()] {
        for (batch, edits) in [(None, Some(bad)), (Some(bad), None)] {
            assert!(
                matches!(
                    authorize(PipelineRequest::new(
                        write_op(None, batch, edits),
                        dir.clone(),
                        OutputSurface::Mcp,
                    )),
                    Err(GovernanceError::BinaryWriteForbidden(_))
                ),
                "expected BinaryWriteForbidden for payload: {}",
                &bad[..bad.len().min(120)]
            );
        }
    }

    let valid_text = format!(
        r#"[{{"path":"src/a.rs","code":"fn pat() {{\n\tlet s = \"🚀\";\n\t// {}\n}}\n"}}]"#,
        "x".repeat(9000)
    );
    for (batch, edits) in [(None, Some(valid_text.as_str())), (Some(valid_text.as_str()), None)] {
        let gov = authorize(PipelineRequest::new(
            write_op(None, batch, edits),
            dir.clone(),
            OutputSurface::Mcp,
        ))
        .expect("valid UTF-8 with newlines/tabs/emoji should pass");
        assert_eq!(gov.state().authorized_paths().len(), 1);
    }

    let mut json_file_write = write_op(Some("src/data.json"), None, None);
    json_file_write.code = Some(r#"{"esc":"\u0000"}"#.into());
    assert!(
        authorize(PipelineRequest::new(json_file_write, dir.clone(), OutputSurface::Cli)).is_ok(),
        "literal \\u0000 in non-manifest code payload should remain allowed text"
    );

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn rejects_nul_in_target_strings_and_paths_across_all_ops() {
    let dir = make_temp_project("nul_targets", r#"{"enabled": true}"#);
    std::fs::create_dir_all(dir.join("src")).expect("create src");
    std::fs::write(dir.join("src/a.rs"), "pub fn ok() {}\n").expect("write a.rs");

    for payload in [
        r#"[{"file_path":"src/new\u0000.txt","code":"evil"}]"#,
        r#"[{"path":"src/secret.png\u0000.txt","code":"evil"}]"#,
        r#"{"edits":[{"target":"src/new\u0000.txt","code":"evil"}]}"#,
    ] {
        for (batch, edits) in [(None, Some(payload)), (Some(payload), None)] {
            assert!(
                matches!(
                    authorize(PipelineRequest::new(
                        write_op(None, batch, edits),
                        dir.clone(),
                        OutputSurface::Mcp,
                    )),
                    Err(GovernanceError::PathOutsideAllowedRoots(_))
                ),
                "expected PathOutsideAllowedRoots for {payload}"
            );
        }
    }

    assert!(matches!(
        authorize(PipelineRequest::new(
            write_op(None, Some("=== src/new\0.txt ===\nevil\n"), None),
            dir.clone(),
            OutputSurface::Cli,
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));
    assert!(matches!(
        authorize(PipelineRequest::new(
            write_op(Some("src/new\0.txt"), None, None),
            dir.clone(),
            OutputSurface::Cli,
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut from_file_op = write_op(None, None, None);
    from_file_op.from_file = Some(PathBuf::from("src/new\0.txt"));
    assert!(matches!(
        authorize(PipelineRequest::new(from_file_op, dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut tp_write = write_op(None, None, None);
    tp_write.target_paths = vec![PathBuf::from("src/new\0.txt")];
    assert!(matches!(
        authorize(PipelineRequest::new(tp_write, dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    assert!(matches!(
        authorize(PipelineRequest::new(read_op("src/new\0.txt"), dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));
    let mut tp_read = read_op("src/a.rs");
    tp_read.target_paths = vec![PathBuf::from("src/new\0.txt")];
    assert!(matches!(
        authorize(PipelineRequest::new(tp_read, dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    assert!(matches!(
        authorize(PipelineRequest::new(search_op("src/new\0.txt"), dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));
    let mut tp_search = search_op("src");
    tp_search.target_paths = vec![PathBuf::from("src/new\0.txt")];
    assert!(matches!(
        authorize(PipelineRequest::new(tp_search, dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    assert!(matches!(
        authorize(PipelineRequest::new(find_op("src/new\0.txt"), dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));
    let mut tp_find = find_op(".");
    tp_find.target_paths = vec![PathBuf::from("src/new\0.txt")];
    assert!(matches!(
        authorize(PipelineRequest::new(tp_find, dir.clone(), OutputSurface::Cli)),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let _ = std::fs::remove_dir_all(&dir);
}
