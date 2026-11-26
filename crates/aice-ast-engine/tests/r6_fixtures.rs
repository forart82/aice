use std::fs;
use std::path::{Path, PathBuf};

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall, detect_language};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .expect("crates/")
        .parent()
        .expect("workspace root")
        .to_path_buf()
}

fn collect_files(dir: &Path, out: &mut Vec<PathBuf>) {
    for entry in fs::read_dir(dir).expect("read dir").flatten() {
        let p = entry.path();
        if p.is_dir() {
            collect_files(&p, out);
        } else {
            out.push(p);
        }
    }
}

#[test]
fn all_9_e2e_r6_valid_fixtures_pass_firewall_and_parse() {
    let valid_dir = workspace_root().join("tests/e2e/fixtures/r6/valid");
    let firewall = DefaultSyntaxFirewall;
    let registry = EngineRegistry::new();

    let mut entries = Vec::new();
    collect_files(&valid_dir, &mut entries);
    entries.sort();
    assert_eq!(entries.len(), 9, "expected 9 valid R6 fixtures");

    for path in entries {
        let src = fs::read_to_string(&path).expect("read fixture");
        let lang = detect_language(&path, &src);
        let verdict = firewall.verify(&src, &path, lang);
        assert!(
            verdict.is_valid(),
            "Expected valid R6 fixture {} ({lang:?}) to pass firewall, got: {verdict:?}",
            path.display(),
        );
        let adapter = registry
            .adapter(lang)
            .unwrap_or_else(|| panic!("missing adapter for {lang:?}"));
        let tree = adapter
            .parse_cst(&src)
            .unwrap_or_else(|e| panic!("parse_cst failed for {}: {e}", path.display()));
        assert!(
            !tree.has_error(),
            "Tree has_error() on valid R6 fixture {}",
            path.display()
        );
    }
}

#[test]
fn all_9_e2e_r6_invalid_fixtures_are_rejected_with_diagnostics() {
    let invalid_dir = workspace_root().join("tests/e2e/fixtures/r6/invalid");
    let firewall = DefaultSyntaxFirewall;

    let mut entries = Vec::new();
    collect_files(&invalid_dir, &mut entries);
    entries.sort();
    assert_eq!(entries.len(), 9, "expected 9 invalid R6 fixtures");

    for path in entries {
        let src = fs::read_to_string(&path).expect("read fixture");
        let lang = detect_language(&path, &src);
        let verdict = firewall.verify(&src, &path, lang);
        match verdict {
            FirewallVerdict::Invalid { diagnostics } => {
                assert!(!diagnostics.is_empty(), "Empty diagnostics for {}", path.display());
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
                    "Expected invalid R6 fixture {} ({lang:?}) to be REJECTED by SyntaxFirewall!",
                    path.display(),
                );
            }
        }
    }
}

#[test]
fn golden_r6_fixtures_all_pass_firewall_and_parse() {
    let src_dir = workspace_root().join("tests/golden/fixtures/src");
    let firewall = DefaultSyntaxFirewall;
    let registry = EngineRegistry::new();
    let files = [
        ("schema_ansi.sql", LanguageId::AnsiSql),
        ("trigger_pg.sql", LanguageId::PostgreSql),
        ("proc_mysql.sql", LanguageId::MySql),
        ("local_sqlite.sql", LanguageId::Sqlite),
        ("report_tsql.sql", LanguageId::TSql),
        ("schema.prisma", LanguageId::Prisma),
        ("api.graphql", LanguageId::GraphQl),
        ("graph.cypher", LanguageId::Cypher),
        ("migrations/V001__init_ledger.sql", LanguageId::DbMigration),
    ];
    for (name, expected_lang) in files {
        let path = src_dir.join(name);
        let src = fs::read_to_string(&path).expect("read golden fixture");
        let lang = detect_language(&path, &src);
        assert_eq!(lang, expected_lang, "lang mismatch for {name}");
        let verdict = firewall.verify(&src, &path, lang);
        assert!(
            verdict.is_valid(),
            "Golden R6 fixture {name} ({lang:?}) failed firewall: {verdict:?}"
        );
        let tree = registry.adapter(lang).unwrap().parse_cst(&src).unwrap();
        assert!(!tree.has_error(), "Golden R6 fixture {name} has_error()");
    }
}
