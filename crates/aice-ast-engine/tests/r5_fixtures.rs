use std::fs;
use std::path::PathBuf;

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, SyntaxFirewall, detect_language};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/")
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

#[test]
fn all_24_e2e_r5_valid_fixtures_pass_firewall_and_parse() {
    let valid_dir = workspace_root().join("tests/e2e/fixtures/r5/valid");
    let firewall = DefaultSyntaxFirewall;
    let registry = EngineRegistry::new();

    let mut entries: Vec<PathBuf> = fs::read_dir(&valid_dir)
        .expect("read valid fixtures")
        .map(|e| e.expect("entry").path())
        .collect();
    entries.sort();
    assert_eq!(entries.len(), 24, "expected 24 valid R5 fixtures");

    for path in entries {
        let src = fs::read_to_string(&path).expect("read fixture");
        let lang = detect_language(&path, &src);
        let verdict = firewall.verify(&src, &path, lang);
        assert!(
            verdict.is_valid(),
            "Expected valid fixture {} ({:?}) to pass firewall, got: {:?}",
            path.display(),
            lang,
            verdict
        );
        let adapter = registry
            .adapter(lang)
            .unwrap_or_else(|| panic!("missing adapter for {lang:?}"));
        let tree = adapter
            .parse_cst(&src)
            .unwrap_or_else(|e| panic!("parse_cst failed for {}: {e}", path.display()));
        assert!(
            !tree.has_error(),
            "Tree has_error() on valid fixture {}",
            path.display()
        );
    }
}

#[test]
fn all_24_e2e_r5_invalid_fixtures_are_rejected_with_diagnostics() {
    let invalid_dir = workspace_root().join("tests/e2e/fixtures/r5/invalid");
    let firewall = DefaultSyntaxFirewall;

    let mut entries: Vec<PathBuf> = fs::read_dir(&invalid_dir)
        .expect("read invalid fixtures")
        .map(|e| e.expect("entry").path())
        .collect();
    entries.sort();
    assert_eq!(entries.len(), 24, "expected 24 invalid R5 fixtures");

    for path in entries {
        let src = fs::read_to_string(&path).expect("read fixture");
        let lang = detect_language(&path, &src);
        let verdict = firewall.verify(&src, &path, lang);
        match verdict {
            FirewallVerdict::Invalid { diagnostics } => {
                assert!(
                    !diagnostics.is_empty(),
                    "Empty diagnostics for {}",
                    path.display()
                );
                assert!(
                    diagnostics[0].line >= 1 && diagnostics[0].column >= 1,
                    "Invalid line/col for {}: {:?}",
                    path.display(),
                    diagnostics[0]
                );
                assert!(
                    !diagnostics[0].context.is_empty(),
                    "Empty context snippet for {}",
                    path.display()
                );
            }
            FirewallVerdict::Valid => {
                panic!(
                    "Expected invalid fixture {} ({:?}) to be REJECTED by SyntaxFirewall!",
                    path.display(),
                    lang
                );
            }
        }
    }
}

#[test]
fn golden_r5_fixtures_all_pass_firewall() {
    let src_dir = workspace_root().join("tests/golden/fixtures/src");
    let firewall = DefaultSyntaxFirewall;
    let files = [
        "app.ts",
        "math.ts",
        "component.tsx",
        "engine.rs",
        "worker.py",
        "server.go",
        "native.c",
        "matrix.cpp",
        "billing.cs",
        "Service.java",
        "Handler.kt",
        "widget.dart",
        "controller.php",
        "jobs.rb",
        "build.sh",
        "manifest.json",
        "deploy.yaml",
        "config.toml",
        "guide.md",
        "page.html",
        "styles.css",
        "config.xml",
        "diagram.svg",
        "card.twig",
    ];
    for name in files {
        let path = src_dir.join(name);
        let src = fs::read_to_string(&path).expect("read golden fixture");
        let lang = detect_language(&path, &src);
        let verdict = firewall.verify(&src, &path, lang);
        assert!(
            verdict.is_valid(),
            "Golden fixture {name} ({lang:?}) failed firewall: {verdict:?}"
        );
    }
}
