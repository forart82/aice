use std::path::{Path, PathBuf};

use aice_governance::{
    AdminAction, AdminOp, FindOp, GovernanceError, OperationKind, OutputSurface, PipelineRequest,
    ReadOp, WriteOp, authorize, authorize_admin, path_guard::is_path_contained,
};

fn make_temp_project(name: &str, enabled: bool) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aice_gov_{name}_{}", std::process::id()));
    let _ = std::fs::create_dir_all(&dir);
    let cfg = format!("{{\"enabled\": {enabled}}}");
    std::fs::write(dir.join("aice.config.json"), cfg).expect("write config");
    dir
}

fn read_op_for(target: &str) -> ReadOp {
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
fn authorize_enforces_disabled_and_rejects_nonexistent_traversal() {
    let disabled_dir = make_temp_project("disabled", false);
    let req = PipelineRequest::new(read_op_for("foo.rs"), disabled_dir.clone(), OutputSurface::Cli);
    assert_eq!(authorize(req).unwrap_err(), GovernanceError::Disabled);

    let admin_req = PipelineRequest::new(
        AdminOp {
            action: AdminAction::Version,
        },
        disabled_dir.clone(),
        OutputSurface::Cli,
    );
    let admin_gov = authorize_admin(admin_req).expect("admin allowed when disabled");
    assert!(!admin_gov.state().config().enabled);

    let enabled_dir = make_temp_project("enabled", true);
    let escape_req = PipelineRequest::new(
        read_op_for("../../etc/evil"),
        enabled_dir.clone(),
        OutputSurface::Cli,
    );
    assert!(matches!(
        authorize(escape_req),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let non_existent_etc = enabled_dir.join("missing_sub/../../../../../etc/evil");
    assert!(!is_path_contained(&non_existent_etc, &enabled_dir, &[]));
    assert!(!is_path_contained(Path::new("../escape.rs"), &enabled_dir, &[]));
    assert!(is_path_contained(
        &enabled_dir.join("sub/../ok_new.rs"),
        &enabled_dir,
        &[]
    ));

    // Bypass B closure: empty target_paths MUST NOT bypass raw targets/path validation.
    let mut split_brain_read = read_op_for("/etc/shadow");
    split_brain_read.target_paths.clear();
    let split_req = PipelineRequest::new(split_brain_read, enabled_dir.clone(), OutputSurface::Cli);
    assert!(matches!(
        authorize(split_req),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut selector_read = read_op_for("hello.rs:MyStruct::run");
    selector_read.target_paths.clear();
    let sel_gov = authorize(PipelineRequest::new(
        selector_read,
        enabled_dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("selector read inside root allowed");
    assert_eq!(sel_gov.state().authorized_paths().len(), 1);
    assert!(
        sel_gov.state().authorized_paths()[0]
            .requested
            .ends_with("hello.rs")
    );

    let split_write = WriteOp {
        path: Some(PathBuf::from("/etc/shadow")),
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
            split_write,
            enabled_dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let empty_find = FindOp {
        pattern: None,
        targets: vec![],
        target_paths: vec![],
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    };
    let find_gov = authorize(PipelineRequest::new(
        empty_find,
        enabled_dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("empty find defaults to project root '.'");
    assert_eq!(find_gov.state().authorized_paths().len(), 1);

    assert_eq!(
        aice_governance::strip_selector("C:\\src\\foo.rs:Sym"),
        "C:\\src\\foo.rs"
    );
    assert_eq!(aice_governance::strip_selector("a:L1-L5"), "a");
    assert_eq!(
        aice_governance::strip_selector("foo.rs#Struct::method"),
        "foo.rs"
    );
    assert_eq!(
        aice_governance::strip_selector("/etc/shadow:L1-L10"),
        "/etc/shadow"
    );

    let _ = std::fs::remove_dir_all(&disabled_dir);
    let _ = std::fs::remove_dir_all(&enabled_dir);
}

#[test]
fn rejects_colon_traversal_write_and_empty_targets() {
    let dir = make_temp_project("colon_guard", true);
    std::fs::create_dir_all(dir.join("safe:")).expect("create colon dir");

    let base_write = |path: Option<&str>, from_file: Option<&str>| WriteOp {
        path: path.map(PathBuf::from),
        symbol: None,
        code: Some("evil".into()),
        template: None,
        body: None,
        from_file: from_file.map(PathBuf::from),
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
            base_write(Some("safe:/../../../etc/shadow"), None),
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));
    assert!(matches!(
        authorize(PipelineRequest::new(
            base_write(None, Some("safe:/../../../etc/shadow")),
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut four_eq_batch = base_write(None, None);
    four_eq_batch.batch = Some("==== /etc/shadow ====\nevil\n".into());
    assert!(matches!(
        authorize(PipelineRequest::new(
            four_eq_batch,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut json_batch = base_write(None, None);
    json_batch.batch = Some("[{\"path\":\"/etc/shadow\"}]".into());
    assert!(matches!(
        authorize(PipelineRequest::new(
            json_batch,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut json_edits = base_write(None, None);
    json_edits.edits = Some("[{\"file\":\"/etc/shadow\"}]".into());
    assert!(matches!(
        authorize(PipelineRequest::new(
            json_edits,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut empty_read = read_op_for("");
    empty_read.target_paths.clear();
    assert!(matches!(
        authorize(PipelineRequest::new(
            empty_read,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    let mut colon_read = read_op_for("safe:/../../../etc/shadow");
    colon_read.target_paths.clear();
    assert!(matches!(
        authorize(PipelineRequest::new(
            colon_read,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    assert_eq!(
        aice_governance::strip_selector("safe:/../../../etc/shadow"),
        "safe:/../../../etc/shadow"
    );
    assert_eq!(aice_governance::strip_selector("f:/a|b/"), "f");

    let mut single_read = read_op_for("a:L1-L5");
    single_read.target_paths.clear();
    let valid_read = authorize(PipelineRequest::new(
        single_read,
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("valid read authorized");
    assert_eq!(valid_read.state().cwd(), dir.as_path());
    assert_eq!(valid_read.state().op_kind(), OperationKind::Read);
    assert_eq!(valid_read.state().authorized_paths().len(), 1);
    assert!(valid_read.state().authorized_paths()[0].requested.ends_with("a"));
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn blocks_heredoc_modifier_whitespace_variants_and_two_segment_paths() {
    let dir = make_temp_project("iter5_guard", true);
    std::fs::create_dir_all(dir.join("safe:")).expect("create colon dir");
    let heredoc_write = |batch: &str| WriteOp {
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
        batch: Some(batch.to_string()),
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

    for batch in [
        "=== safe.rs ===\npub fn ok() {}\n=== /etc/shadow === --delete\n",
        "=== safe.rs ===\npub fn ok() {}\n=== /etc/shadow === -d\n",
        "=== safe.rs ===\npub fn ok() {}\n=== /etc/shadow === (delete)\n",
        "=== safe.rs ===\npub fn ok() {}\n===/etc/shadow===\nevil\n",
        "=== safe.rs ===\npub fn ok() {}\n===\t/etc/shadow\t===\nevil\n",
    ] {
        assert!(
            matches!(
                authorize(PipelineRequest::new(
                    heredoc_write(batch),
                    dir.clone(),
                    OutputSurface::Cli
                )),
                Err(GovernanceError::PathOutsideAllowedRoots(_))
            ),
            "expected PathOutsideAllowedRoots for batch: {batch}"
        );
    }

    let safe_divider = authorize(PipelineRequest::new(
        heredoc_write("=== safe.rs ===\n=======\npub fn ok() {}\n"),
        dir.clone(),
        OutputSurface::Cli,
    ))
    .expect("pure-equals divider inside safe heredoc should authorize");
    assert_eq!(safe_divider.state().authorized_paths().len(), 1);

    let mut two_seg_read = read_op_for("safe:/etc/shadow");
    two_seg_read.target_paths.clear();
    assert!(matches!(
        authorize(PipelineRequest::new(
            two_seg_read,
            dir.clone(),
            OutputSurface::Cli
        )),
        Err(GovernanceError::PathOutsideAllowedRoots(_))
    ));

    assert_eq!(
        aice_governance::split_target_selector("C:/foo/bar"),
        ("C:/foo/bar", None)
    );
    assert_eq!(
        aice_governance::split_target_selector("C:/Windows/System32"),
        ("C:/Windows/System32", None)
    );
    assert_eq!(
        aice_governance::split_target_selector("C:/etc/shadow"),
        ("C:/etc/shadow", None)
    );
    assert_eq!(
        aice_governance::split_target_selector("safe:/etc/shadow"),
        ("safe:/etc/shadow", None)
    );
    assert_eq!(
        aice_governance::split_target_selector("C:/path/to/file.rs:Sym"),
        ("C:/path/to/file.rs", Some("Sym"))
    );
    assert_eq!(
        aice_governance::split_target_selector("f:/a|b/"),
        ("f", Some("/a|b/"))
    );
    assert_eq!(
        aice_governance::split_target_selector("f:/a|b/gi"),
        ("f", Some("/a|b/gi"))
    );
    assert_eq!(
        aice_governance::split_target_selector(r"f:/fn\s+foo/"),
        ("f", Some(r"/fn\s+foo/"))
    );
    assert_eq!(
        aice_governance::split_target_selector("f:/a:b/"),
        ("f", Some("/a:b/"))
    );
    assert_eq!(
        aice_governance::split_target_selector("f:/a#b/"),
        ("f", Some("/a#b/"))
    );

    let _ = std::fs::remove_dir_all(&dir);
}
