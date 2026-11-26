use std::fs;
use std::path::{Path, PathBuf};

const EXPECTED_CRATES: [&str; 10] = [
    "aice-governance",
    "aice-telemetry",
    "aice-lang-registry",
    "aice-ast-engine",
    "aice-aice-ir",
    "aice-find-engine",
    "aice-batch-read",
    "aice-batch-write",
    "aice-pipeline",
    "aice-cli",
];

const MAX_LINES: usize = 300;
const EXCLUDED_SEGMENTS: [&str; 3] = ["generated", "bindings", "fixtures"];

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        let name = entry.file_name();
        if EXCLUDED_SEGMENTS.iter().any(|seg| name == *seg) {
            continue;
        }
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

#[test]
fn all_ten_crates_present() {
    let root = workspace_root();
    for crate_name in EXPECTED_CRATES {
        let crate_dir = root.join("crates").join(crate_name);
        assert!(
            crate_dir.join("Cargo.toml").is_file(),
            "Missing crate manifest: {}",
            crate_dir.display()
        );
        assert!(
            crate_dir.join("src").is_dir(),
            "Missing crate src/: {}",
            crate_dir.display()
        );
    }
}

#[test]
fn all_rust_sources_within_300_lines() {
    let root = workspace_root();
    let mut files = Vec::new();
    for crate_name in EXPECTED_CRATES {
        collect_rs_files(&root.join("crates").join(crate_name).join("src"), &mut files);
    }
    assert!(!files.is_empty(), "Expected Rust source files under crates/*/src");

    let mut violations = Vec::new();
    for path in files {
        let content = fs::read_to_string(&path).expect("read .rs file");
        let count = content.lines().count();
        if count > MAX_LINES {
            let rel = path.strip_prefix(&root).unwrap_or(&path);
            violations.push(format!("{}: {} lines (> {})", rel.display(), count, MAX_LINES));
        }
    }

    assert!(
        violations.is_empty(),
        "Modularity gate line-limit violations:\n{}",
        violations.join("\n")
    );
}
