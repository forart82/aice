use std::path::{Path, PathBuf};

use aice_governance::{
    BinaryProbeResult, GovernanceError, OutputSurface, PipelineRequest, ReadOp, WriteOp, authorize,
    is_binary_extension, is_valid_selector_tail, parse_json, probe_binary, probe_bytes,
    probe_bytes_with_partial, probe_file, strip_jsonc_comments,
    target_spec::has_regex_selector_part,
};

fn fresh_dir(name: &str) -> PathBuf {
    let nanos = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    let dir = std::env::temp_dir().join(format!("aice_sec_{name}_{}_{nanos}", std::process::id()));
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

fn write_op(path: Option<&str>, code: Option<&str>, batch: Option<&str>) -> WriteOp {
    WriteOp {
        path: path.map(PathBuf::from),
        symbol: None,
        code: code.map(str::to_string),
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
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
fn allowed_read_roots_allows_read_but_denies_write_and_blocks_system_paths() {
    let ws = fresh_dir("ws");
    let shared = fresh_dir("shared");
    std::fs::write(shared.join("lib.rs"), "pub fn shared() {}\n").unwrap();
    std::fs::write(
        ws.join("aice.config.json"),
        format!("{{\"enabled\":true,\"allowedReadRoots\":[\"{}\"]}}", shared.display()),
    )
    .unwrap();

    // Read inside allowedReadRoots succeeds
    let shared_file = shared.join("lib.rs");
    let ok = authorize(PipelineRequest::new(
        read_op(&shared_file.display().to_string()),
        ws.clone(),
        OutputSurface::Cli,
    ));
    assert!(ok.is_ok());

    // Write inside allowedReadRoots is DENIED
    let write_err = authorize(PipelineRequest::new(
        write_op(Some(&shared_file.display().to_string()), Some("pub fn x() {}"), None),
        ws.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(write_err, GovernanceError::PathOutsideAllowedRoots(_)));

    // System paths "/" and "/etc/passwd" blocked even if listed in allowedReadRoots
    for sys_target in ["/", "/etc/passwd", "/proc/version"] {
        let err = authorize(PipelineRequest::new(
            read_op(sys_target),
            ws.clone(),
            OutputSurface::Cli,
        ))
        .unwrap_err();
        assert!(matches!(err, GovernanceError::PathOutsideAllowedRoots(_)));
    }

    let _ = std::fs::remove_dir_all(&ws);
    let _ = std::fs::remove_dir_all(&shared);
}

#[cfg(unix)]
#[test]
fn rejects_dangling_symlinks_escaping_root_and_nul_inline_write_payloads() {
    let ws = fresh_dir("dangling");
    std::fs::write(ws.join("aice.config.json"), "{\"enabled\":true}").unwrap();

    std::os::unix::fs::symlink("/etc/shadow", ws.join("dangling_etc")).unwrap();
    let err1 = authorize(PipelineRequest::new(
        write_op(Some("dangling_etc"), Some("evil"), None),
        ws.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(err1, GovernanceError::PathOutsideAllowedRoots(_)));

    let outside_dir = fresh_dir("outside_target");
    std::os::unix::fs::symlink(&outside_dir, ws.join("out_link")).unwrap();
    let err2 = authorize(PipelineRequest::new(
        read_op("out_link/new_secret.txt"),
        ws.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(err2, GovernanceError::PathOutsideAllowedRoots(_)));

    // NUL byte in WriteOp inline payload rejected even for non-existent target
    let nul_err = authorize(PipelineRequest::new(
        write_op(Some("brand_new.txt"), Some("abc\0def"), None),
        ws.clone(),
        OutputSurface::Cli,
    ))
    .unwrap_err();
    assert!(matches!(nul_err, GovernanceError::BinaryWriteForbidden(_)));

    let _ = std::fs::remove_dir_all(&ws);
    let _ = std::fs::remove_dir_all(&outside_dir);
}

#[test]
fn binary_probe_extensions_8kb_partial_utf8_and_watch_item_1_exports() {
    assert!(is_binary_extension(Path::new("app.APK")));
    assert!(is_binary_extension(Path::new("weights.safetensors")));
    assert!(!is_binary_extension(Path::new("diagram.svg")));
    assert!(!is_binary_extension(Path::new("index.ts")));

    // 8192-byte boundary splitting a 4-byte emoji (🚀 = F0 9F 9A 80)
    let mut big_utf8 = vec![b'a'; 8190];
    big_utf8.extend_from_slice("🚀more".as_bytes());
    assert_eq!(probe_bytes_with_partial(&big_utf8[..8192], true), BinaryProbeResult::Text);
    assert_eq!(probe_bytes(&big_utf8), BinaryProbeResult::Text);

    // >10% suspicious C0 control bytes rejected
    let ctrl = vec![0x01u8; 20];
    assert_eq!(probe_bytes(&ctrl), BinaryProbeResult::NulByteOrInvalidUtf8);

    // >2 MiB file rejected cleanly without full-file OOM
    let dir = fresh_dir("probe_file");
    let huge = dir.join("huge.txt");
    std::fs::write(&huge, vec![b'a'; 2 * 1024 * 1024 + 10]).unwrap();
    assert!(matches!(probe_file(&huge), BinaryProbeResult::ExceedsMaxBytes(_)));
    assert!(matches!(probe_binary(&[0u8; 4], Path::new("ok.txt")), BinaryProbeResult::NulByteOrInvalidUtf8));

    // Watch Item #1: root exports & Sym,/pat/ multi-selector regex symmetry
    assert!(parse_json("{\"ok\":true}").is_ok());
    assert_eq!(strip_jsonc_comments("// hi\r{}"), "\r{}");
    assert!(is_valid_selector_tail("Sym,/pat/i"));
    assert!(has_regex_selector_part("Sym,/pat/i"));
    assert!(!has_regex_selector_part("Sym,Other"));

    std::fs::write(dir.join("aice.config.json"), "{\"enabled\":true}").unwrap();
    use aice_governance::OperationTargets;
    let w_front = write_op(None, None, Some("=== safe.rs:/pat/,Sym ===\nok\n"));
    let w_back = write_op(None, None, Some("=== safe.rs:Sym,/pat/ ===\nok\n"));
    assert_eq!(w_front.target_paths(), vec![PathBuf::from("safe.rs")]);
    assert_eq!(w_back.target_paths(), vec![PathBuf::from("safe.rs")]);
    let w_plain = write_op(None, None, Some("=== safe.rs:Sym,Other ===\nok\n"));
    assert_eq!(w_plain.target_paths(), vec![PathBuf::from("safe.rs")]);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn path_guard_empty_and_adversarial_symlink_nul_matrix() {
    use aice_governance::path_guard::{is_path_contained, resolve_contained_path};

    let ws = fresh_dir("pg_matrix");
    let outside = fresh_dir("pg_outside");
    std::fs::write(ws.join("inside.rs"), "pub fn ok() {}\n").unwrap();
    std::fs::write(outside.join("secret.txt"), "top secret\n").unwrap();

    // C1-G7: Empty candidate or empty root must fail closed
    assert_eq!(resolve_contained_path(Path::new(""), &ws), None);
    assert!(!is_path_contained(Path::new(""), &ws, &[]));
    assert!(!is_path_contained(Path::new("inside.rs"), Path::new(""), &[]));

    #[cfg(unix)]
    {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        // Embedded NUL byte in OsStr
        let nul_path = Path::new(OsStr::from_bytes(b"inside.rs\0.txt"));
        assert_eq!(resolve_contained_path(nul_path, &ws), None);
        assert!(!is_path_contained(nul_path, &ws, &[]));

        // Symlink depth 31 accepted vs 33 rejected (MAX_LINK_DEPTH = 32)
        std::fs::write(ws.join("chain_0"), "target").unwrap();
        for i in 1..=33 {
            let prev = format!("chain_{}", i - 1);
            let cur = ws.join(format!("chain_{i}"));
            std::os::unix::fs::symlink(prev, cur).unwrap();
        }
        assert!(is_path_contained(Path::new("chain_31"), &ws, &[]));
        assert!(is_path_contained(Path::new("chain_32"), &ws, &[]));
        assert!(!is_path_contained(Path::new("chain_33"), &ws, &[]));

        // Symlink loop a -> b -> a
        std::os::unix::fs::symlink("loop_b", ws.join("loop_a")).unwrap();
        std::os::unix::fs::symlink("loop_a", ws.join("loop_b")).unwrap();
        assert!(!is_path_contained(Path::new("loop_a"), &ws, &[]));

        // Relative ../../ file & directory symlink escapes
        let sub = ws.join("sub");
        std::fs::create_dir_all(&sub).unwrap();
        let rel_file_target = format!("../../{}/secret.txt", outside.file_name().unwrap().to_string_lossy());
        let rel_dir_target = format!("../../{}", outside.file_name().unwrap().to_string_lossy());
        std::os::unix::fs::symlink(&rel_file_target, sub.join("rel_file_esc")).unwrap();
        std::os::unix::fs::symlink(&rel_dir_target, sub.join("rel_dir_esc")).unwrap();
        assert!(!is_path_contained(Path::new("sub/rel_file_esc"), &ws, &[]));
        assert!(!is_path_contained(Path::new("sub/rel_dir_esc/new_file.txt"), &ws, &[]));

        // Dangling symlink pointing outside root
        std::os::unix::fs::symlink(outside.join("does_not_exist.txt"), ws.join("dangling_out")).unwrap();
        assert!(!is_path_contained(Path::new("dangling_out"), &ws, &[]));
    }

    let _ = std::fs::remove_dir_all(&ws);
    let _ = std::fs::remove_dir_all(&outside);
}
