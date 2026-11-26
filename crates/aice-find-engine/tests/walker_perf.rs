use std::fs;
use std::path::PathBuf;
use std::time::Instant;

use aice_find_engine::{FindWalkOpts, walk_governed_with_opts};
use aice_governance::{FindOp, OutputSurface, PipelineRequest, authorize};

#[test]
fn parallel_walk_performance_under_target() {
    let id = std::process::id();
    let root = std::env::temp_dir().join(format!("aice_find_perf_{id}"));
    let _ = fs::remove_dir_all(&root);
    fs::create_dir_all(&root).unwrap();
    fs::write(root.join("aice.config.json"), "{\"enabled\": true}\n").unwrap();

    // Generate 600 source files across 24 directories
    for d in 0..24 {
        let dir = root.join(format!("src/mod_{d:02}"));
        fs::create_dir_all(&dir).unwrap();
        for f in 0..25 {
            let p = dir.join(format!("file_{f:02}.rs"));
            fs::write(p, "pub fn item() -> usize { 42 }\n").unwrap();
        }
    }

    let op = FindOp {
        pattern: None,
        targets: Vec::new(),
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    };
    let req = authorize(PipelineRequest::new(op, root.clone(), OutputSurface::Cli))
        .expect("authorize perf root");

    // Warm up OS page cache and measure best of 3 runs
    let _ = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();

    let mut best_ms = f64::MAX;
    let mut count = 0usize;
    for _ in 0..3 {
        let t0 = Instant::now();
        let out = walk_governed_with_opts(req.state(), &FindWalkOpts::default()).unwrap();
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        if elapsed_ms < best_ms {
            best_ms = elapsed_ms;
        }
        count = out.files.len();
    }

    let _ = fs::remove_dir_all(&root);
    assert_eq!(count, 600);

    // Also benchmark walking the real workspace repository via allowedReadRoots
    // (safe even when the repo's own aice.config.json has "enabled": false)
    let repo_root = PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .unwrap()
        .parent()
        .unwrap()
        .to_path_buf();
    let wrap = std::env::temp_dir().join(format!("aice_find_repo_perf_{id}"));
    let _ = fs::remove_dir_all(&wrap);
    fs::create_dir_all(&wrap).unwrap();
    let escaped_repo = repo_root.to_string_lossy().replace('\\', "\\\\").replace('"', "\\\"");
    fs::write(
        wrap.join("aice.config.json"),
        format!("{{\"enabled\": true, \"allowedReadRoots\": [\"{escaped_repo}\"]}}\n"),
    )
    .unwrap();
    let repo_target = repo_root.to_string_lossy().into_owned();
    let repo_op = FindOp {
        pattern: None,
        targets: vec![repo_target.clone()],
        target_paths: Vec::new(),
        depth: None,
        search: None,
        full: false,
        max_tokens: None,
        json: false,
    };
    let repo_req = authorize(PipelineRequest::new(repo_op, wrap.clone(), OutputSurface::Cli))
        .expect("authorize repo wrapper");
    let repo_opts = FindWalkOpts {
        explicit_targets: vec![repo_target],
        ..FindWalkOpts::default()
    };
    let _ = walk_governed_with_opts(repo_req.state(), &repo_opts).unwrap();
    let mut repo_best_ms = f64::MAX;
    let mut repo_count = 0usize;
    for _ in 0..3 {
        let t0 = Instant::now();
        let out = walk_governed_with_opts(repo_req.state(), &repo_opts).unwrap();
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        if elapsed_ms < repo_best_ms {
            repo_best_ms = elapsed_ms;
        }
        repo_count = out.files.len();
    }
    let _ = fs::remove_dir_all(&wrap);
    assert!(repo_count > 50, "expected real workspace files, got {repo_count}");

    if cfg!(not(debug_assertions)) {
        assert!(
            best_ms <= 6.0,
            "release 600-file parallel walk exceeded 6ms target: {best_ms:.2}ms"
        );
        assert!(
            repo_best_ms <= 6.0,
            "release repo ({repo_count} files) parallel walk exceeded 6ms target: {repo_best_ms:.2}ms"
        );
    }
}
