use std::fs;
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicU64, Ordering};

use aice_find_engine::{
    FindWalkOpts, IgnorePolicy, LOCKFILE_SKIP_NAMES, count_lines_fast, is_lockfile_name,
    should_ignore_name, walk_governed, walk_governed_with_opts,
};
use aice_governance::{
    FindOp, OutputSurface, PipelineRequest, ReadOp, SearchOp, WriteOp, authorize,
};
use aice_lang_registry::LanguageId;

static TEMP_SEQ: AtomicU64 = AtomicU64::new(1);

struct TempDir {
    path: PathBuf,
}

impl TempDir {
    fn new(tag: &str) -> Self {
        let id = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let dir = std::env::temp_dir().join(format!(
            "aice_find_test_{tag}_{}_{id}",
            std::process::id()
        ));
        fs::create_dir_all(&dir).expect("create temp root");
        Self { path: dir }
    }

    fn write(&self, rel: &str, content: &[u8]) -> PathBuf {
        let p = self.path.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(&p, content).expect("write test file");
        p
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.path);
    }
}

fn make_find_op(targets: Vec<&str>) -> FindOp {
    FindOp {
        pattern: None,
        targets: targets.into_iter().map(String::from).collect(),
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    }
}

fn rels(root: &Path, paths: &[PathBuf]) -> Vec<String> {
    let canon_root = fs::canonicalize(root).unwrap_or_else(|_| root.to_path_buf());
    paths
        .iter()
        .map(|p| {
            p.strip_prefix(root)
                .or_else(|_| p.strip_prefix(&canon_root))
                .unwrap_or(p)
                .to_string_lossy()
                .replace('\\', "/")
        })
        .collect()
}

#[test]
fn binary_skip_and_line_counts_and_language_detection() {
    let td = TempDir::new("bin_skip");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("src/engine.rs", b"pub fn run() {\n    println!(\"hi\");\n}\n");
    td.write("src/diagram.svg", b"<svg></svg>");
    td.write("src/query.sql", b"CREATE TABLE users (id SERIAL PRIMARY KEY);\n");
    td.write("bin/logo.png", b"\x89PNG\r\n\x1a\n");
    td.write("bin/rawdata", b"abc\x00def");
    td.write("bin/huge.txt", &vec![b'a'; 2 * 1024 * 1024 + 10]);

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .expect("authorize find");

    let discovered = walk_governed(req.state(), None).expect("walk_governed");
    let disc_paths: Vec<PathBuf> = discovered.iter().map(|d| d.path.clone()).collect();
    assert_eq!(
        rels(&td.path, &disc_paths),
        vec!["src/diagram.svg", "src/engine.rs", "src/query.sql"]
    );
    assert!(discovered.iter().all(|d| !d.is_binary));
    assert_eq!(discovered[1].language, LanguageId::Rust);

    let with_bin = walk_governed_with_opts(
        req.state(),
        &FindWalkOpts {
            include_binary: true,
            ..FindWalkOpts::default()
        },
    )
    .expect("walk with binary");
    let bin_paths: Vec<PathBuf> = with_bin.files.iter().map(|f| f.path.clone()).collect();
    let bin_rels = rels(&td.path, &bin_paths);
    assert!(bin_rels.contains(&"bin/logo.png".to_string()));
    assert!(bin_rels.contains(&"bin/rawdata".to_string()));
    assert!(bin_rels.contains(&"bin/huge.txt".to_string()));

    let default_out = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();
    assert_eq!(default_out.files.len(), 3);
    assert_eq!(default_out.files[1].line_count, 3);
    assert_eq!(default_out.files[1].byte_size, 37);
}

#[cfg(unix)]
#[test]
fn eloop_cycles_escape_symlinks_and_allowed_read_roots() {
    use std::os::unix::fs::symlink;

    let outer = TempDir::new("outer");
    let proj = outer.path.join("proj");
    let outside = outer.path.join("outside");
    let shared = outer.path.join("shared");
    fs::create_dir_all(proj.join("src/sub")).unwrap();
    fs::create_dir_all(&outside).unwrap();
    fs::create_dir_all(&shared).unwrap();

    fs::write(
        proj.join("aice.config.json"),
        "{\"enabled\": true, \"allowedReadRoots\": [\"../shared\"]}\n",
    )
    .unwrap();
    fs::write(proj.join("src/ok.rs"), "pub fn ok() {}\n").unwrap();
    fs::write(outside.join("secret.txt"), "secret\n").unwrap();
    fs::write(shared.join("lib.rs"), "pub fn shared_fn() {}\n").unwrap();

    symlink(outside.join("secret.txt"), proj.join("src/leak_file.txt")).unwrap();
    symlink(&outside, proj.join("src/leak_dir")).unwrap();
    symlink(".", proj.join("src/loop_dot")).unwrap();
    symlink("../..", proj.join("src/sub/loop_root")).unwrap();

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .expect("authorize");
    let out = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();
    let r = rels(
        &proj,
        &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
    );
    assert_eq!(r, vec!["src/ok.rs"]);

    // Explicitly targeting allowedReadRoots works cleanly
    let shared_req = authorize(PipelineRequest::new(
        make_find_op(vec!["../shared"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .expect("authorize shared");
    let shared_out = walk_governed_with_opts(
        shared_req.state(),
        &FindWalkOpts {
            explicit_targets: vec!["../shared".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(shared_out.files.len(), 1);
    assert!(shared_out.files[0].path.ends_with("lib.rs"));
}

#[test]
fn depth_clamping_and_boundary_dirs_parity() {
    let td = TempDir::new("depth");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("root.rs", b"fn r() {}\n");
    td.write("src/a.rs", b"fn a() {}\n");
    td.write("src/deep/b.rs", b"fn b() {}\n");
    td.write("bin/logo.png", b"\x89PNG\r\n");
    td.write("ignored_only/node_modules/x.js", b"export {};\n");
    fs::create_dir_all(td.path.join("empty_dir")).unwrap();

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();

    for max_d in [Some(0), Some(1)] {
        let out = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: max_d,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let file_rels = rels(
            &td.path,
            &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
        );
        let bd_rels = rels(&td.path, &out.boundary_dirs);
        assert_eq!(file_rels, vec!["root.rs"]);
        assert_eq!(bd_rels, vec!["src"]);
    }

    let out_d2 = walk_governed_with_opts(
        req.state(),
        &FindWalkOpts {
            max_depth: Some(2),
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let d2_files = rels(
        &td.path,
        &out_d2.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
    );
    let d2_bds = rels(&td.path, &out_d2.boundary_dirs);
    assert_eq!(d2_files, vec!["root.rs", "src/a.rs"]);
    assert_eq!(d2_bds, vec!["src/deep"]);
}

#[test]
fn ignore_rules_dotfiles_lockfiles_outdir_and_explicit_overrides() {
    let td = TempDir::new("build");
    let proj = td.path.join("proj");
    fs::create_dir_all(&proj).unwrap();
    let write_p = |rel: &str, data: &[u8]| {
        let p = proj.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, data).unwrap();
    };

    write_p(
        "aice.config.json",
        b"{\"enabled\": true, \"outDir\": \"custom_out\"}\n",
    );
    write_p("src/main.rs", b"fn main() {}\n");
    write_p("src/main.trivia.json", b"{}\n");
    write_p(".git/HEAD", b"ref: refs/heads/main\n");
    write_p(".env.local", b"KEY=1\n");
    write_p(".hidden_dir/x.rs", b"fn x() {}\n");
    write_p("node_modules/pkg/index.js", b"export {};\n");
    write_p("node_modules/pkg/dist/bundle.js", b"export {};\n");
    write_p("dist/app.js", b"export {};\n");
    write_p("build/out.txt", b"built\n");
    write_p("out/out.txt", b"out\n");
    write_p("coverage/lcov.info", b"TN:\n");
    write_p("vendor/dep.php", b"<?php\n");
    write_p(".agents/rule.md", b"# r\n");
    write_p(".next/cache.txt", b"c\n");
    write_p(".turbo/log.txt", b"t\n");
    write_p("custom_out/gen.ts", b"export {};\n");
    write_p("Cargo.lock", b"# lock\n");
    write_p("package-lock.json", b"{}\n");

    for dir in [
        ".git",
        "node_modules",
        "target",
        "dist",
        "build",
        "out",
        "coverage",
        "vendor",
        ".aice-cache",
        ".aice-build",
        "__pycache__",
        ".agents",
        ".next",
        ".turbo",
    ] {
        assert!(should_ignore_name(dir), "expected ignored dir: {dir}");
    }
    assert_eq!(LOCKFILE_SKIP_NAMES.len(), 19);
    for lf in LOCKFILE_SKIP_NAMES {
        assert!(is_lockfile_name(lf), "expected lockfile: {lf}");
    }

    // Notice ancestor path contains "build" — verify IgnorePolicy does NOT leak "build" into explicit_allowed_dirs!
    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let policy = IgnorePolicy::from_governed(req.state(), None, false, true, &[]);
    assert!(!policy.explicit_allowed_dirs.contains("build"));

    let out = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();
    assert_eq!(
        rels(
            &proj,
            &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()
        ),
        vec!["src/main.rs"]
    );

    // --full includes dotfiles (except .git)
    let full_out = walk_governed_with_opts(
        req.state(),
        &FindWalkOpts {
            include_hidden: true,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let full_rels = rels(
        &proj,
        &full_out
            .files
            .iter()
            .map(|f| f.path.clone())
            .collect::<Vec<_>>(),
    );
    assert!(full_rels.contains(&".env.local".to_string()));
    assert!(full_rels.contains(&".hidden_dir/x.rs".to_string()));
    assert!(!full_rels.iter().any(|r| r.starts_with(".git")));

    // Explicit node_modules target allows dist/build/out inside node_modules
    let nm_req = authorize(PipelineRequest::new(
        make_find_op(vec!["node_modules"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let nm_out = walk_governed_with_opts(
        nm_req.state(),
        &FindWalkOpts {
            explicit_targets: vec!["node_modules".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let nm_rels = rels(
        &proj,
        &nm_out
            .files
            .iter()
            .map(|f| f.path.clone())
            .collect::<Vec<_>>(),
    );
    assert!(nm_rels.contains(&"node_modules/pkg/index.js".to_string()));
    assert!(nm_rels.contains(&"node_modules/pkg/dist/bundle.js".to_string()));

    // Explicit lockfile target surfaces Cargo.lock
    let lf_req = authorize(PipelineRequest::new(
        make_find_op(vec!["Cargo.lock"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let lf_out = walk_governed_with_opts(
        lf_req.state(),
        &FindWalkOpts {
            explicit_targets: vec!["Cargo.lock".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(
        rels(
            &proj,
            &lf_out
                .files
                .iter()
                .map(|f| f.path.clone())
                .collect::<Vec<_>>()
        ),
        vec!["Cargo.lock"]
    );
}

#[test]
fn op_kinds_and_count_lines_fast_edge_cases() {
    assert_eq!(count_lines_fast(b""), 0);
    assert_eq!(count_lines_fast(b"\n"), 1);
    assert_eq!(count_lines_fast(b"\r\n"), 1);
    assert_eq!(count_lines_fast(b"a"), 1);
    assert_eq!(count_lines_fast(b"a\n"), 1);
    assert_eq!(count_lines_fast(b"a\r\n"), 1);
    assert_eq!(count_lines_fast(b"a\nb"), 2);
    assert_eq!(count_lines_fast(b"a\nb\n"), 2);
    assert_eq!(count_lines_fast(b"\n\n"), 2);

    let td = TempDir::new("opkinds");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("src/lib.rs", b"pub fn x() {}\n");

    let read_req = authorize(PipelineRequest::new(
        ReadOp {
            targets: vec![],
            target_paths: vec![],
            outline: false,
            outline_target: false,
            full: false,
            depth: None,
            symbol: None,
            search: None,
            context_lines: None,
            files_only: true,
            compact: false,
            include_types: true,
            include_deps: false,
            include_callers: false,
            max_tokens: None,
            json: false,
            stats: false,
        },
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    assert_eq!(
        walk_governed_with_opts(read_req.state(), &FindWalkOpts::default())
            .unwrap()
            .files
            .len(),
        1
    );

    let search_req = authorize(PipelineRequest::new(
        SearchOp {
            pattern: "x".into(),
            targets: vec![],
            target_paths: vec![],
            context_lines: None,
            line_numbers: true,
            symbol: None,
            files_with_matches: false,
            full: false,
            max_tokens: None,
            json: false,
            stats: false,
        },
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    assert_eq!(
        walk_governed_with_opts(search_req.state(), &FindWalkOpts::default())
            .unwrap()
            .files
            .len(),
        1
    );

    let write_req = authorize(PipelineRequest::new(
        WriteOp {
            path: Some(PathBuf::from("src/lib.rs")),
            symbol: None,
            code: Some("pub fn x() {}\n".into()),
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
            overwrite: true,
            force: false,
            in_place: true,
            dry_run: true,
            diff: false,
            json: false,
            preserve_docs: true,
            target_paths: vec![],
        },
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let err = walk_governed_with_opts(write_req.state(), &FindWalkOpts::default())
        .expect_err("WriteOp must be rejected");
    assert_eq!(err.kind(), std::io::ErrorKind::PermissionDenied);
}

#[test]
fn explicit_git_targets_are_unconditionally_rejected() {
    let td = TempDir::new("git_reject");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write(".git/config", b"[core]\n");
    td.write(".git/hooks/pre-commit", b"#!/bin/sh\n");
    td.write("sub/.git/config", b"[core]\n");
    td.write("src/main.rs", b"fn main() {}\n");

    for target in [".git", ".git/hooks", ".git/config", "sub/.git/config"] {
        let req = authorize(PipelineRequest::new(
            make_find_op(vec![target]),
            td.path.clone(),
            OutputSurface::Cli,
        ))
        .unwrap();
        let out = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                include_hidden: true,
                explicit_targets: vec![target.into()],
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert!(
            out.files.is_empty() && out.boundary_dirs.is_empty(),
            "explicit target `{target}` leaked .git contents: {out:?}"
        );
    }
}

#[test]
fn absolute_and_cross_branch_explicit_targets_do_not_leak_ignored_dirs() {
    let td = TempDir::new("build");
    let proj = td.path.join("my_proj");
    fs::create_dir_all(&proj).unwrap();
    let write_p = |rel: &str, data: &[u8]| {
        let p = proj.join(rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, data).unwrap();
    };
    write_p("aice.config.json", b"{\"enabled\": true}\n");
    write_p("src/main.rs", b"fn main() {}\n");
    write_p("src/build/should_ignore.rs", b"fn bad() {}\n");
    write_p("other/build/wanted.rs", b"fn wanted() {}\n");

    let abs_src = proj.join("src").to_string_lossy().into_owned();
    let req_abs = authorize(PipelineRequest::new(
        make_find_op(vec![&abs_src]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let abs_opts = FindWalkOpts {
        explicit_targets: vec![abs_src],
        ..FindWalkOpts::default()
    };
    let policy = IgnorePolicy::from_governed(
        req_abs.state(),
        None,
        false,
        true,
        &abs_opts.explicit_targets,
    );
    assert!(!policy.explicit_allowed_dirs.contains("build"));
    let abs_out = walk_governed_with_opts(req_abs.state(), &abs_opts).unwrap();
    assert_eq!(
        rels(
            &proj,
            &abs_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()
        ),
        vec!["src/main.rs"]
    );

    // Cross-branch target other/build/wanted.rs must NOT expose src/build/should_ignore.rs
    let req_cross = authorize(PipelineRequest::new(
        make_find_op(vec!["src", "other/build/wanted.rs"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let cross_opts = FindWalkOpts {
        explicit_targets: vec!["src".into(), "other/build/wanted.rs".into()],
        ..FindWalkOpts::default()
    };
    let cross_out = walk_governed_with_opts(req_cross.state(), &cross_opts).unwrap();
    assert_eq!(
        rels(
            &proj,
            &cross_out
                .files
                .iter()
                .map(|f| f.path.clone())
                .collect::<Vec<_>>()
        ),
        vec!["other/build/wanted.rs", "src/main.rs"]
    );

    // Even when walking "." with explicit other/build/wanted.rs, src/build remains skipped
    let req_dot = authorize(PipelineRequest::new(
        make_find_op(vec![".", "other/build/wanted.rs"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let dot_out = walk_governed_with_opts(
        req_dot.state(),
        &FindWalkOpts {
            explicit_targets: vec![".".into(), "other/build/wanted.rs".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let dot_rels = rels(
        &proj,
        &dot_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
    );
    assert!(dot_rels.contains(&"other/build/wanted.rs".to_string()));
    assert!(!dot_rels.contains(&"src/build/should_ignore.rs".to_string()));

    // cwd != project_root resolves relative explicit_targets against cwd
    write_p("sub/build/sub_wanted.rs", b"fn sw() {}\n");
    write_p("build/root_bad.rs", b"fn rb() {}\n");
    let sub_cwd = proj.join("sub");
    let req_cwd = authorize(PipelineRequest::new(
        make_find_op(vec!["build"]),
        sub_cwd,
        OutputSurface::Cli,
    ))
    .unwrap();
    let cwd_opts = FindWalkOpts {
        explicit_targets: vec!["build".into()],
        ..FindWalkOpts::default()
    };
    let cwd_policy = IgnorePolicy::from_governed(
        req_cwd.state(),
        None,
        false,
        true,
        &cwd_opts.explicit_targets,
    );
    assert!(!cwd_policy.should_skip_dir("build", &proj.join("sub/build"), false));
    assert!(cwd_policy.should_skip_dir("build", &proj.join("build"), false));
    let cwd_out = walk_governed_with_opts(req_cwd.state(), &cwd_opts).unwrap();
    assert_eq!(
        rels(
            &proj,
            &cwd_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()
        ),
        vec!["sub/build/sub_wanted.rs"]
    );
}

#[test]
fn source_dir_and_out_dir_normalized_equality_and_untargeted_read_guard() {
    let td = TempDir::new("outdir_norm");
    td.write(
        "aice.config.json",
        b"{\"enabled\": true, \"sourceDir\": \"./src\", \"outDir\": \"src\"}\n",
    );
    td.write("src/lib.rs", b"pub fn ok() {}\n");

    let find_req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out = walk_governed_with_opts(find_req.state(), &FindWalkOpts::default()).unwrap();
    assert_eq!(
        rels(&td.path, &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
        vec!["src/lib.rs"]
    );

    let read_req = authorize(PipelineRequest::new(
        ReadOp {
            targets: vec![],
            target_paths: vec![],
            outline: false,
            outline_target: false,
            full: false,
            depth: None,
            symbol: None,
            search: None,
            context_lines: None,
            files_only: true,
            compact: false,
            include_types: true,
            include_deps: false,
            include_callers: false,
            max_tokens: None,
            json: false,
            stats: false,
        },
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let empty_out = walk_governed_with_opts(
        read_req.state(),
        &FindWalkOpts {
            walk_project_root_if_untargeted: false,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert!(empty_out.files.is_empty());
    assert!(empty_out.boundary_dirs.is_empty());
}

#[test]
fn overlapping_seeded_boundary_dirs_and_node_modules_edge_cases() {
    let outer = TempDir::new("overlap_nm");
    let proj = outer.path.join("proj");
    let shared = outer.path.join("shared");
    fs::create_dir_all(&proj).unwrap();
    fs::create_dir_all(&shared).unwrap();
    fs::write(
        proj.join("aice.config.json"),
        "{\"enabled\": true, \"allowedReadRoots\": [\"../shared\"]}\n",
    )
    .unwrap();
    fs::create_dir_all(proj.join("src/deep/nested")).unwrap();
    fs::write(proj.join("src/deep/nested/c.rs"), "pub fn c() {}\n").unwrap();

    // Overlapping ["src", "src/deep"] at max_depth=1 omits entered "src/deep", keeps "src/deep/nested"
    let req = authorize(PipelineRequest::new(
        make_find_op(vec!["src", "src/deep"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out = walk_governed_with_opts(
        req.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            explicit_targets: vec!["src".into(), "src/deep".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(rels(&proj, &out.boundary_dirs), vec!["src/deep/nested"]);

    // node_modules at boundary depth surfaces boundary_dir even if it only contains dist/
    fs::create_dir_all(proj.join("parent/node_modules/pkg/dist")).unwrap();
    fs::write(proj.join("parent/node_modules/pkg/dist/bundle.js"), "export {};\n").unwrap();
    let nm_bound_req = authorize(PipelineRequest::new(
        make_find_op(vec!["parent", "parent/node_modules"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let nm_bound_out = walk_governed_with_opts(
        nm_bound_req.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            explicit_targets: vec!["parent".into(), "parent/node_modules".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let bd_rels = rels(&proj, &nm_bound_out.boundary_dirs);
    assert!(bd_rels.contains(&"parent/node_modules/pkg".to_string()));

    // allowedReadRoots target inside node_modules sets root_in_node_modules = true
    fs::create_dir_all(shared.join("node_modules/pkg/dist")).unwrap();
    fs::write(shared.join("node_modules/pkg/dist/ext.js"), "export {};\n").unwrap();
    let shared_nm_req = authorize(PipelineRequest::new(
        make_find_op(vec!["../shared/node_modules/pkg"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let shared_nm_out = walk_governed_with_opts(
        shared_nm_req.state(),
        &FindWalkOpts {
            explicit_targets: vec!["../shared/node_modules/pkg".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(shared_nm_out.files.len(), 1);
    assert!(shared_nm_out.files[0].path.ends_with("dist/ext.js"));
}

#[cfg(unix)]
#[test]
fn unreadable_files_are_omitted_from_boundary_dirs() {
    use std::os::unix::fs::PermissionsExt;

    let td = TempDir::new("unreadable_bd");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("src/ok.rs", b"pub fn ok() {}\n");
    let secret = td.write("only_unreadable/secret.txt", b"secret\n");
    fs::set_permissions(&secret, fs::Permissions::from_mode(0o000)).unwrap();

    struct RestorePerm(PathBuf);
    impl Drop for RestorePerm {
        fn drop(&mut self) {
            let _ = fs::set_permissions(&self.0, fs::Permissions::from_mode(0o644));
        }
    }
    let _restore = RestorePerm(secret.clone());

    // Skip assertion if running as root where mode 000 is still readable
    if fs::File::open(&secret).is_ok() {
        return;
    }

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out = walk_governed_with_opts(
        req.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(rels(&td.path, &out.boundary_dirs), vec!["src"]);
}

#[test]
fn allowed_read_roots_with_git_components_never_leak_git_files() {
    let outer = TempDir::new("allowed_git");
    let proj = outer.path.join("proj");
    let shared = outer.path.join("shared");
    let shared_git = outer.path.join("shared_git");
    let shared_hooks = outer.path.join("shared_hooks");

    fs::create_dir_all(proj.join("src")).unwrap();
    fs::create_dir_all(shared.join(".git")).unwrap();
    fs::create_dir_all(shared.join(".github/workflows")).unwrap();
    fs::create_dir_all(shared_git.join(".git/hooks")).unwrap();
    fs::create_dir_all(shared_hooks.join(".git/hooks")).unwrap();

    fs::write(
        proj.join("aice.config.json"),
        "{\"enabled\": true, \"allowedReadRoots\": [\"../shared\", \"../shared_git/.git\", \"../shared_hooks/.git/hooks\"]}\n",
    )
    .unwrap();
    fs::write(proj.join("src/main.rs"), "fn main() {}\n").unwrap();
    fs::write(shared.join("ok.rs"), "pub fn ok() {}\n").unwrap();
    fs::write(shared.join(".git/config"), "[core]\n").unwrap();
    fs::write(shared.join(".github/workflows/ci.yml"), "name: ci\n").unwrap();
    fs::write(shared_git.join(".git/config"), "[core]\n").unwrap();
    fs::write(shared_git.join(".git/hooks/post-commit"), "#!/bin/sh\n").unwrap();
    fs::write(shared_hooks.join(".git/hooks/pre-rebase"), "#!/bin/sh\n").unwrap();

    #[cfg(unix)]
    {
        let link_target = outer.path.join("link_target_git/.git");
        fs::create_dir_all(&link_target).unwrap();
        fs::write(link_target.join("config"), "[core]\n").unwrap();
        std::os::unix::fs::symlink(&link_target, outer.path.join("shared_link")).unwrap();
        fs::write(
            proj.join("aice.config.json"),
            "{\"enabled\": true, \"allowedReadRoots\": [\"../shared\", \"../shared_git/.git\", \"../shared_hooks/.git/hooks\", \"../shared_link\"]}\n",
        )
        .unwrap();
    }

    let blocked_targets = [
        "../shared/.git",
        "../shared/.git/config",
        "../shared_git/.git",
        "../shared_git/.git/config",
        "../shared_git/.git/hooks",
        "../shared_git/.git/hooks/post-commit",
        "../shared_hooks/.git/hooks",
        "../shared_hooks/.git/hooks/pre-rebase",
        #[cfg(unix)]
        "../shared_link",
        #[cfg(unix)]
        "../shared_link/config",
    ];

    for target in blocked_targets {
        let find_req = authorize(PipelineRequest::new(
            make_find_op(vec![target]),
            proj.clone(),
            OutputSurface::Cli,
        ))
        .unwrap();
        let find_out = walk_governed_with_opts(
            find_req.state(),
            &FindWalkOpts {
                include_hidden: true,
                explicit_targets: vec![target.into()],
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert!(
            find_out.files.is_empty() && find_out.boundary_dirs.is_empty(),
            "FindOp leaked .git for allowedReadRoots target `{target}`: {find_out:?}"
        );

        let legacy_out = walk_governed(find_req.state(), None).unwrap();
        assert!(
            legacy_out.is_empty(),
            "walk_governed leaked .git for target `{target}`: {legacy_out:?}"
        );

        let read_req = authorize(PipelineRequest::new(
            ReadOp {
                targets: vec![target.into()],
                target_paths: vec![],
                outline: false,
                outline_target: false,
                full: false,
                depth: None,
                symbol: None,
                search: None,
                context_lines: None,
                files_only: true,
                compact: false,
                include_types: true,
                include_deps: false,
                include_callers: false,
                max_tokens: None,
                json: false,
                stats: false,
            },
            proj.clone(),
            OutputSurface::Cli,
        ))
        .unwrap();
        let read_out = walk_governed_with_opts(
            read_req.state(),
            &FindWalkOpts {
                include_hidden: true,
                explicit_targets: vec![target.into()],
                walk_project_root_if_untargeted: false,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert!(
            read_out.files.is_empty() && read_out.boundary_dirs.is_empty(),
            "ReadOp leaked .git for allowedReadRoots target `{target}`: {read_out:?}"
        );
    }

    // Untargeted FindOp walks only project_root
    let untargeted_find = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let uf_out = walk_governed_with_opts(
        untargeted_find.state(),
        &FindWalkOpts {
            include_hidden: true,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(
        rels(&proj, &uf_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
        vec!["src/main.rs"]
    );

    // Benign ../shared + .github remain readable while ../shared/.git stays skipped
    let shared_req = authorize(PipelineRequest::new(
        make_find_op(vec!["../shared"]),
        proj.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let shared_out = walk_governed_with_opts(
        shared_req.state(),
        &FindWalkOpts {
            include_hidden: true,
            explicit_targets: vec!["../shared".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let shared_rels = rels(
        &shared,
        &shared_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>(),
    );
    assert_eq!(shared_rels, vec![".github/workflows/ci.yml", "ok.rs"]);

    // Untargeted FindOp when project_root itself is inside .git returns empty
    let git_proj = outer.path.join("repo/.git/hooks");
    fs::create_dir_all(&git_proj).unwrap();
    fs::write(git_proj.join("aice.config.json"), "{\"enabled\": true}\n").unwrap();
    fs::write(git_proj.join("pre-rebase"), "#!/bin/sh\n").unwrap();
    let git_root_req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        git_proj,
        OutputSurface::Cli,
    ))
    .unwrap();
    let git_root_out =
        walk_governed_with_opts(git_root_req.state(), &FindWalkOpts::default()).unwrap();
    assert!(git_root_out.files.is_empty() && git_root_out.boundary_dirs.is_empty());
}

#[test]
fn streaming_probe_large_files_disguised_binaries_and_batched_flat_dir() {
    let td = TempDir::new("stream_batch");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("sub/aice.config.json", b"{\"enabled\": true}\n");

    // 40 KB (<= 64 KB single-read) and 130 KB (> 64 KB streaming) files
    let med = "let x = 1;\n".repeat(4000);
    let large = "pub fn line() {}\n".repeat(8000);
    td.write("src/med.rs", med.as_bytes());
    td.write("src/large.rs", large.as_bytes());

    // Disguised binaries with non-binary extensions (.txt and .rs) must still be probed
    td.write("src/nul_disguised.txt", b"hello\x00world\n");
    td.write("src/invalid_utf8.txt", &[0xFF, 0xFE, 0xFD, b'\n']);
    td.write("src/nul_disguised.rs", b"fn bad() {}\x00\n");

    // > 24 files in a single flat dir exercises WalkTask::Files batching
    for i in 0..40 {
        td.write(&format!("batch/f_{i:02}.rs"), b"pub fn b() {}\n");
    }

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();
    let rel = rels(&td.path, &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
    assert!(rel.contains(&"src/med.rs".to_string()));
    assert!(rel.contains(&"src/large.rs".to_string()));
    assert!(!rel.iter().any(|r| r.contains("nul_disguised") || r.contains("invalid_utf8")));
    assert!(!rel.iter().any(|r| r.ends_with("aice.config.json")));
    assert_eq!(rel.iter().filter(|r| r.starts_with("batch/")).count(), 40);

    let med_f = out.files.iter().find(|f| f.path.ends_with("med.rs")).unwrap();
    assert_eq!(med_f.line_count, 4000);
    assert_eq!(med_f.byte_size, med.len() as u64);
    let large_f = out.files.iter().find(|f| f.path.ends_with("large.rs")).unwrap();
    assert_eq!(large_f.line_count, 8000);
    assert_eq!(large_f.byte_size, large.len() as u64);

    // Explicitly targeting sub/aice.config.json surfaces ONLY sub/aice.config.json
    let cfg_req = authorize(PipelineRequest::new(
        make_find_op(vec!["sub/aice.config.json"]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let cfg_out = walk_governed_with_opts(
        cfg_req.state(),
        &FindWalkOpts {
            explicit_targets: vec!["sub/aice.config.json".into()],
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(
        rels(&td.path, &cfg_out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
        vec!["sub/aice.config.json"]
    );
}

#[test]
fn overlapping_roots_min_depth_and_boundary_pruning_are_deterministic() {
    let td = TempDir::new("overlap_race");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    for i in 0..8 {
        td.write(&format!("src/z_{i}/f.rs"), b"pub fn f() {}\n");
    }
    td.write("src/deep/d.rs", b"pub fn d() {}\n");
    td.write("src/deep/deeper/e.rs", b"pub fn e() {}\n");

    let targets = vec![
        "src".to_string(),
        "src/z_0".to_string(),
        "src/z_1".to_string(),
        "src/z_2".to_string(),
        "src/deep".to_string(),
    ];
    let req = authorize(PipelineRequest::new(
        make_find_op(vec!["src", "src/z_0", "src/z_1", "src/z_2", "src/deep"]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();

    for iter in 0..100 {
        let d2 = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: Some(2),
                explicit_targets: targets.clone(),
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let d2_rels = rels(&td.path, &d2.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
        assert!(
            d2_rels.contains(&"src/deep/deeper/e.rs".to_string()),
            "iter {iter}: missed src/deep/deeper/e.rs under max_depth=2: {d2_rels:?}"
        );
        assert_eq!(d2_rels.len(), 10, "iter {iter}: unexpected file set {d2_rels:?}");
        assert!(
            d2.boundary_dirs.is_empty(),
            "iter {iter}: unexpected boundary_dirs {:?}",
            rels(&td.path, &d2.boundary_dirs)
        );
        let e_d2 = d2.files.iter().find(|f| f.path.ends_with("deep/deeper/e.rs")).unwrap();
        assert_eq!(e_d2.depth, 2, "iter {iter}: max_depth=2 depth mismatch");

        let full = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: None,
                explicit_targets: targets.clone(),
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let e_full = full.files.iter().find(|f| f.path.ends_with("deep/deeper/e.rs")).unwrap();
        assert_eq!(e_full.depth, 2, "iter {iter}: max_depth=None depth mismatch");
        let d_full = full.files.iter().find(|f| f.path.ends_with("deep/d.rs")).unwrap();
        assert_eq!(d_full.depth, 1, "iter {iter}: src/deep/d.rs depth mismatch");
    }

    // Verify superseded parent boundary_dir without direct files is pruned when a deeper boundary exists
    td.write("src/deep/only_nested/inner/h.rs", b"pub fn h() {}\n");
    for iter in 0..100 {
        let d2 = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: Some(2),
                explicit_targets: targets.clone(),
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let bd_rels = rels(&td.path, &d2.boundary_dirs);
        assert_eq!(
            bd_rels,
            vec!["src/deep/only_nested/inner"],
            "iter {iter}: superseded parent boundary dir leaked"
        );
    }
}

#[test]
fn unentered_ancestor_boundary_dirs_are_preserved_under_deeper_targets() {
    // Reviewer 2 Counter-example A: ["src", "src/a/b/c"] at max_depth=1
    let td_a = TempDir::new("bd_counter_a");
    td_a.write("aice.config.json", b"{\"enabled\": true}\n");
    td_a.write("src/a/sibling.rs", b"pub fn sib() {}\n");
    td_a.write("src/a/b/c/d/e.rs", b"pub fn e() {}\n");
    let targets_a = vec!["src".to_string(), "src/a/b/c".to_string()];
    let req_a = authorize(PipelineRequest::new(
        make_find_op(vec!["src", "src/a/b/c"]),
        td_a.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out_a = walk_governed_with_opts(
        req_a.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            explicit_targets: targets_a,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert!(out_a.files.is_empty());
    assert_eq!(
        rels(&td_a.path, &out_a.boundary_dirs),
        vec!["src/a", "src/a/b/c/d"]
    );

    // Reviewer 2 Counter-example B: ["src", "src/a/b/c"] and ["src", "src/a/b/c/file.rs"]
    let td_b = TempDir::new("bd_counter_b");
    td_b.write("aice.config.json", b"{\"enabled\": true}\n");
    td_b.write("src/a/sibling.rs", b"pub fn sib() {}\n");
    td_b.write("src/a/b/c/file.rs", b"pub fn f() {}\n");
    for explicit in [vec!["src", "src/a/b/c"], vec!["src", "src/a/b/c/file.rs"]] {
        let targets: Vec<String> = explicit.iter().map(|s| (*s).to_string()).collect();
        let req = authorize(PipelineRequest::new(
            make_find_op(explicit),
            td_b.path.clone(),
            OutputSurface::Cli,
        ))
        .unwrap();
        let out = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: Some(1),
                explicit_targets: targets,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert_eq!(
            rels(&td_b.path, &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
            vec!["src/a/b/c/file.rs"]
        );
        assert_eq!(rels(&td_b.path, &out.boundary_dirs), vec!["src/a"]);
    }

    // Challenger 2 Scenarios A & C: ["src", "src/deep/sub"] and ["src", "src/deep/sub/x.rs"]
    let td_ac = TempDir::new("bd_scen_ac");
    td_ac.write("aice.config.json", b"{\"enabled\": true}\n");
    td_ac.write("src/deep/sub/x.rs", b"pub fn x() {}\n");
    td_ac.write("src/deep/other/y.rs", b"pub fn y() {}\n");
    for explicit in [vec!["src", "src/deep/sub"], vec!["src", "src/deep/sub/x.rs"]] {
        let targets: Vec<String> = explicit.iter().map(|s| (*s).to_string()).collect();
        let req = authorize(PipelineRequest::new(
            make_find_op(explicit),
            td_ac.path.clone(),
            OutputSurface::Cli,
        ))
        .unwrap();
        let out = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                max_depth: Some(1),
                explicit_targets: targets,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert_eq!(
            rels(&td_ac.path, &out.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
            vec!["src/deep/sub/x.rs"]
        );
        assert_eq!(rels(&td_ac.path, &out.boundary_dirs), vec!["src/deep"]);
    }

    // Challenger 2 Scenario B + ./ dot-prefix + max_depth=2 entered pruning
    let td_b2 = TempDir::new("bd_scen_b");
    td_b2.write("aice.config.json", b"{\"enabled\": true}\n");
    td_b2.write("src/deep/only_nested/inner/h.rs", b"pub fn h() {}\n");
    td_b2.write("src/deep/sibling/k.rs", b"pub fn k() {}\n");
    let scen_b_targets = vec!["src".to_string(), "src/deep/only_nested".to_string()];
    let req_b = authorize(PipelineRequest::new(
        make_find_op(vec!["src", "src/deep/only_nested"]),
        td_b2.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out_b = walk_governed_with_opts(
        req_b.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            explicit_targets: scen_b_targets,
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert!(out_b.files.is_empty());
    assert_eq!(
        rels(&td_b2.path, &out_b.boundary_dirs),
        vec!["src/deep", "src/deep/only_nested/inner"]
    );

    // Dot-prefixed targets ["./src", "./src/deep"] at max_depth=1 and max_depth=2
    let dot_targets = vec!["./src".to_string(), "./src/deep".to_string()];
    let req_dot = authorize(PipelineRequest::new(
        make_find_op(vec!["./src", "./src/deep"]),
        td_b2.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out_dot_d1 = walk_governed_with_opts(
        req_dot.state(),
        &FindWalkOpts {
            max_depth: Some(1),
            explicit_targets: dot_targets.clone(),
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    assert_eq!(
        rels(&td_b2.path, &out_dot_d1.boundary_dirs),
        vec!["src/deep/only_nested", "src/deep/sibling"]
    );
    for iter in 0..25 {
        let out_dot_d2 = walk_governed_with_opts(
            req_dot.state(),
            &FindWalkOpts {
                max_depth: Some(2),
                explicit_targets: dot_targets.clone(),
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        assert_eq!(
            rels(&td_b2.path, &out_dot_d2.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>()),
            vec!["src/deep/sibling/k.rs"],
            "iter {iter}"
        );
        assert_eq!(
            rels(&td_b2.path, &out_dot_d2.boundary_dirs),
            vec!["src/deep/only_nested/inner"],
            "iter {iter}"
        );
    }

    // Dot-component project_root untargeted prescan_root at max_depth=2 and max_depth=3
    let req_untargeted_dot = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td_b2.path.join("./."),
        OutputSurface::Cli,
    ))
    .unwrap();
    let out_untargeted_d2 = walk_governed_with_opts(
        req_untargeted_dot.state(),
        &FindWalkOpts {
            max_depth: Some(2),
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let bd_untargeted_d2 = rels(&td_b2.path, &out_untargeted_d2.boundary_dirs);
    assert_eq!(bd_untargeted_d2.len(), 1);
    assert!(bd_untargeted_d2[0].ends_with("src/deep"));

    let out_untargeted_d3 = walk_governed_with_opts(
        req_untargeted_dot.state(),
        &FindWalkOpts {
            max_depth: Some(3),
            ..FindWalkOpts::default()
        },
    )
    .unwrap();
    let bd_untargeted_d3 = rels(&td_b2.path, &out_untargeted_d3.boundary_dirs);
    assert_eq!(bd_untargeted_d3.len(), 2);
    assert!(bd_untargeted_d3[0].ends_with("src/deep/only_nested"));
    assert!(bd_untargeted_d3[1].ends_with("src/deep/sibling"));
}

#[test]
fn late_nul_past_8192_is_detected_as_binary_across_all_probe_modes() {
    let td = TempDir::new("late_nul_find");
    td.write("aice.config.json", b"{\"enabled\": true}\n");
    td.write("ok.txt", b"hello\n");
    let mut late = b"hello_needle\n".to_vec();
    late.extend(std::iter::repeat_n(b'a', 9000));
    late.extend_from_slice(b"\x00after_nul\n");
    td.write("late_nul.txt", &late);

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();

    for measure_lines in [true, false] {
        let omitted = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                include_binary: false,
                probe_binary: true,
                measure_lines,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let omitted_rels = rels(&td.path, &omitted.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
        assert_eq!(omitted_rels, vec!["ok.txt"], "measure_lines={measure_lines}");

        let included = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                include_binary: true,
                probe_binary: true,
                measure_lines,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let late_entry = included.files.iter().find(|f| f.path.ends_with("late_nul.txt")).unwrap();
        assert!(late_entry.is_binary, "measure_lines={measure_lines} must mark late_nul as binary");
    }
}

#[test]
fn late_invalid_utf8_and_split_64k_multibyte_utf8_parity() {
    let td = TempDir::new("late_utf8_find");
    td.write("aice.config.json", b"{\"enabled\": true}\n");

    // Positive control: valid 4-byte UTF-8 emoji straddling the 64 KiB (65536) chunk boundary
    let mut split_64k = vec![b'a'; 65_534];
    split_64k.extend_from_slice("🦀".as_bytes()); // bytes 65534..65538
    split_64k.extend_from_slice(b"\nend_64k\n");
    td.write("split_64k.txt", &split_64k);

    // Negative 1: invalid UTF-8 past 8192 bytes with zero NUL bytes
    let mut late_bad = b"hello_utf8\n".to_vec();
    late_bad.extend(std::iter::repeat_n(b'a', 9000));
    late_bad.extend_from_slice(b"\xff\xfe\xfd\n");
    td.write("late_bad_utf8.txt", &late_bad);

    // Negative 2: incomplete UTF-8 sequence at EOF past 8192 bytes
    let mut late_eof_trunc = b"hello_trunc\n".to_vec();
    late_eof_trunc.extend(std::iter::repeat_n(b'b', 70_000));
    late_eof_trunc.extend_from_slice(&[0xE2, 0x82]);
    td.write("late_eof_trunc.txt", &late_eof_trunc);

    let req = authorize(PipelineRequest::new(
        make_find_op(vec![]),
        td.path.clone(),
        OutputSurface::Cli,
    ))
    .unwrap();

    for measure_lines in [true, false] {
        let omitted = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                include_binary: false,
                probe_binary: true,
                measure_lines,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let omitted_rels = rels(&td.path, &omitted.files.iter().map(|f| f.path.clone()).collect::<Vec<_>>());
        assert_eq!(omitted_rels, vec!["split_64k.txt"], "measure_lines={measure_lines}");

        let included = walk_governed_with_opts(
            req.state(),
            &FindWalkOpts {
                include_binary: true,
                probe_binary: true,
                measure_lines,
                ..FindWalkOpts::default()
            },
        )
        .unwrap();
        let split_entry = included.files.iter().find(|f| f.path.ends_with("split_64k.txt")).unwrap();
        assert!(!split_entry.is_binary, "split_64k must stay text for measure_lines={measure_lines}");
        for bad_name in ["late_bad_utf8.txt", "late_eof_trunc.txt"] {
            let entry = included.files.iter().find(|f| f.path.ends_with(bad_name)).unwrap();
            assert!(entry.is_binary, "{bad_name} must be binary for measure_lines={measure_lines}");
        }
    }
}
