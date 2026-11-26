use std::path::PathBuf;

use aice_governance::{
    AiceMode, FindOp, GovernanceError, JsonValue, OutputSurface, PipelineRequest, ReadOp, WriteOp,
    authorize, find_project_root, load_config_checked, parse_json, project_status,
    set_project_enabled, strip_jsonc_comments,
};

fn fresh_dir(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aice_cfg_{name}_{}_{nanos}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("create temp dir");
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

#[test]
fn gov_01_to_06_config_lifecycle_and_unknown_field_preservation() {
    let dir = fresh_dir("gov01_06");

    // GOV-01: missing config defaults
    let st0 = project_status(&dir).expect("default status");
    assert!(st0.enabled);
    let st0_json = parse_json(&st0.to_json_string()).expect("valid status json");
    assert_eq!(st0_json.as_object().unwrap().get("enabled"), Some(&JsonValue::Bool(true)));

    // GOV-02: enable creates aice.config.json + AGENTS.md idempotently
    let (st1, sync1) = set_project_enabled(&dir, true, false).expect("enable");
    assert!(st1.enabled);
    assert!(sync1.updated);
    assert!(dir.join("aice.config.json").is_file());
    let agents_md = std::fs::read_to_string(dir.join("AGENTS.md")).expect("read AGENTS.md");
    assert_eq!(agents_md.matches("<!-- AICE:START").count(), 1);
    let _ = set_project_enabled(&dir, true, false).expect("repeat enable");
    let agents_md_2 = std::fs::read_to_string(dir.join("AGENTS.md")).expect("read AGENTS.md");
    assert_eq!(agents_md_2.matches("<!-- AICE:START").count(), 1);

    // GOV-06: disable then enable preserves legacy idioms fields and unknown fields
    std::fs::write(
        dir.join("aice.config.json"),
        r#"{
  "enabled": true,
  "idiomsEnabled": true,
  "customOwner": "team-core",
  "idioms": {
    "$clamp": { "name": "$clamp", "templateAice": "Math.min(Math.max($0, $1), $2)" }
  }
}
"#,
    )
    .expect("write idioms config");

    let (disabled_st, _) = set_project_enabled(&dir, false, false).expect("disable");
    assert!(!disabled_st.enabled);

    // GOV-04: disabled blocks ReadOp, FindOp, WriteOp
    let err = authorize(PipelineRequest::new(read_op("a.rs"), dir.clone(), OutputSurface::Cli)).unwrap_err();
    assert_eq!(err, GovernanceError::Disabled);
    assert!(err.to_string().contains("aice.config.json"));
    assert!(err.to_string().contains("\"enabled\": false"));
    let find_err = authorize(PipelineRequest::new(
        FindOp { pattern: None, targets: vec![], target_paths: vec![], depth: None, search: None, full: false, max_tokens: None, json: false },
        dir.clone(),
        OutputSurface::Cli,
    )).unwrap_err();
    assert_eq!(find_err, GovernanceError::Disabled);
    let write_err = authorize(PipelineRequest::new(
        WriteOp {
            path: Some(PathBuf::from("a.rs")), symbol: None, code: Some("fn f() {}".into()), template: None,
            body: None, from_file: None, from_stdin: false, delete: None, insert_after: None, insert_before: None,
            edits: None, batch: None, create: false, overwrite: false, force: false, in_place: false, dry_run: true,
            diff: false, json: false, preserve_docs: true, target_paths: vec![],
        },
        dir.clone(),
        OutputSurface::Cli,
    )).unwrap_err();
    assert_eq!(write_err, GovernanceError::Disabled);

    let (reenabled_st, _) = set_project_enabled(&dir, true, false).expect("re-enable");
    assert!(reenabled_st.enabled);
    let persisted = load_config_checked(&dir).expect("reload");
    assert_eq!(persisted.extra_fields.get("customOwner").and_then(JsonValue::as_str), Some("team-core"));
    assert_eq!(persisted.extra_fields.get("idiomsEnabled"), Some(&JsonValue::Bool(true)));
    assert!(persisted.extra_fields.contains_key("idioms"));

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn discovery_precedence_jsonc_bare_cr_surrogates_and_fail_closed() {
    let dir = fresh_dir("precedence");
    // GOV-05: .aicerc discovered when aice.config.json absent, over package.json#aice
    std::fs::write(dir.join("package.json"), r#"{"name":"p","aice":{"enabled":false}}"#).unwrap();
    std::fs::write(dir.join(".aicerc"), "\u{FEFF}// bare-cr comment\r{\"enabled\": true, \"mode\": \"isolated\"}\r").unwrap();
    let cfg = load_config_checked(&dir).expect("load .aicerc");
    assert!(cfg.enabled);
    assert_eq!(cfg.mode, AiceMode::Isolated);
    assert!(cfg.isolated);

    // package.json#aice fallback when neither aice.config.json nor .aicerc exists
    std::fs::remove_file(dir.join(".aicerc")).unwrap();
    let cfg_pkg = load_config_checked(&dir).expect("load package.json#aice");
    assert!(!cfg_pkg.enabled);

    // Fail-closed on malformed aice.config.json
    std::fs::write(dir.join("aice.config.json"), "{ bad json").unwrap();
    assert!(load_config_checked(&dir).is_err());
    let auth_err = authorize(PipelineRequest::new(read_op("x.rs"), dir.clone(), OutputSurface::Cli)).unwrap_err();
    assert!(matches!(auth_err, GovernanceError::Io(_)));

    // Watch Item #2 & JSON RFC 8259 checks
    let stripped = strip_jsonc_comments("\u{FEFF}// line1\r{\"url\":\"http://a//b\", /* c */ \"n\": 1}");
    let parsed = parse_json(&stripped).expect("parse bare-CR jsonc");
    assert_eq!(parsed.as_object().unwrap().get("url").and_then(JsonValue::as_str), Some("http://a//b"));

    let astro = parse_json(r#""\uD83D\uDE80""#).expect("UTF-16 surrogate pair");
    assert_eq!(astro.as_str(), Some("🚀"));
    assert!(parse_json(r#""\uD83D""#).is_err());
    assert!(parse_json("01").is_err());
    assert!(parse_json("1.").is_err());
    assert!(parse_json("1e").is_err());
    assert!(parse_json("\"a\nb\"").is_err());

    // composer.json root marker
    let php_dir = fresh_dir("composer");
    std::fs::write(php_dir.join("composer.json"), "{}").unwrap();
    let sub = php_dir.join("src/Controller");
    std::fs::create_dir_all(&sub).unwrap();
    assert_eq!(find_project_root(&sub.join("User.php")), php_dir);

    let _ = std::fs::remove_dir_all(&dir);
    let _ = std::fs::remove_dir_all(&php_dir);
}

#[test]
fn unclosed_block_comment_in_jsonc_fails_closed_and_rejects_plus_hex() {
    use aice_governance::strip_jsonc_comments_checked;

    for raw in [
        "/* {\"enabled\": false} unclosed",
        "{\"enabled\": false} /* unclosed",
    ] {
        assert!(strip_jsonc_comments_checked(raw).is_err(), "expected Err for {raw}");
        let dir = fresh_dir("unclosed_comment");
        std::fs::write(dir.join("aice.config.json"), raw).expect("write config");
        assert!(load_config_checked(&dir).is_err(), "load_config_checked must fail closed");
        let auth_err = authorize(PipelineRequest::new(read_op("a.rs"), dir.clone(), OutputSurface::Cli))
            .expect_err("authorize must fail closed on unclosed /*");
        assert!(matches!(auth_err, GovernanceError::Io(_)));
        let _ = std::fs::remove_dir_all(&dir);
    }

    assert!(strip_jsonc_comments_checked("/* ok */ {\"enabled\": false}").is_ok());
    assert!(parse_json(r#""\u+041""#).is_err());
}

#[test]
fn admin_target_dir_validation_covers_missing_files_nested_and_symlinks() {
    let base = fresh_dir("target_dir_base");
    let missing = base.join("nonexistent_subdir_xyz");
    assert!(project_status(&missing).is_err());
    assert!(set_project_enabled(&missing, true, false).is_err());
    assert!(set_project_enabled(&missing, false, false).is_err());
    assert!(!missing.exists(), "missing target directory must not be created");

    let empty = std::path::Path::new("");
    assert!(project_status(empty).is_err());
    assert!(set_project_enabled(empty, true, false).is_err());

    let proj = fresh_dir("target_dir_proj");
    std::fs::create_dir_all(proj.join("src/nested")).expect("create nested dir");
    let app_file = proj.join("src/app.ts");
    std::fs::write(&app_file, "export const x = 1;\n").expect("write app.ts");
    set_project_enabled(&proj, false, false).expect("disable proj");

    // Non-existent path inside existing project must fail and NOT mutate ancestor config.
    let missing_in_proj = proj.join("nonexistent_subdir_xyz");
    assert!(set_project_enabled(&missing_in_proj, true, false).is_err());
    assert!(project_status(&missing_in_proj).is_err());
    assert!(!missing_in_proj.exists());
    assert!(
        !load_config_checked(&proj).expect("reload proj").enabled,
        "ancestor config must stay disabled"
    );

    // Regular file rejected.
    assert!(project_status(&app_file).is_err());
    assert!(set_project_enabled(&app_file, true, false).is_err());
    assert!(set_project_enabled(&app_file, false, false).is_err());

    // Existing directory without aice.config.json defaults enabled and can be enabled.
    let fresh = fresh_dir("no_cfg");
    assert!(project_status(&fresh).expect("status no_cfg").enabled);
    let (st_fresh, _) = set_project_enabled(&fresh, true, false).expect("enable no_cfg");
    assert!(st_fresh.enabled);
    assert!(fresh.join("aice.config.json").is_file());
    assert!(fresh.join("AGENTS.md").is_file());

    // Nested subdirectory resolves enclosing project root.
    let nested = proj.join("src/nested");
    let st_nested = project_status(&nested).expect("status nested");
    assert_eq!(st_nested.project_root, proj);
    assert!(!st_nested.enabled);
    let (st_nested_en, _) = set_project_enabled(&nested, true, false).expect("enable via nested");
    assert_eq!(st_nested_en.project_root, proj);
    assert!(st_nested_en.enabled);
    assert!(!nested.join("aice.config.json").exists());
    assert!(load_config_checked(&proj).expect("proj enabled").enabled);

    #[cfg(unix)]
    {
        use std::os::unix::fs::symlink;

        let broken_link = proj.join("broken_link");
        symlink(proj.join("non_existent_target"), &broken_link).expect("broken symlink");
        assert!(project_status(&broken_link).is_err());
        assert!(set_project_enabled(&broken_link, true, false).is_err());
        assert!(set_project_enabled(&broken_link, false, false).is_err());

        let file_link = proj.join("file_link");
        symlink(&app_file, &file_link).expect("file symlink");
        assert!(project_status(&file_link).is_err());
        assert!(set_project_enabled(&file_link, true, false).is_err());

        let outside_dir = fresh_dir("outside_target");
        let dir_link = proj.join("dir_link");
        symlink(&outside_dir, &dir_link).expect("dir symlink");
        let (st_sym, _) = set_project_enabled(&dir_link, false, false).expect("disable via dir symlink");
        assert!(!st_sym.enabled);
        assert!(outside_dir.join("aice.config.json").is_file());
        assert!(!load_config_checked(&outside_dir).expect("outside disabled").enabled);
        assert!(
            load_config_checked(&proj).expect("proj stays enabled").enabled,
            "symlink target must not mutate enclosing proj"
        );
        let _ = std::fs::remove_dir_all(&outside_dir);
    }

    let _ = std::fs::remove_dir_all(&base);
    let _ = std::fs::remove_dir_all(&proj);
    let _ = std::fs::remove_dir_all(&fresh);
}
