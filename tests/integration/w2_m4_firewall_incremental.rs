use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_inc_valid(lang: LanguageId, path: &str, baseline: &str, candidate: &str) {
    let fw = DefaultSyntaxFirewall;
    let verdict = fw.verify_incremental(Some(baseline), candidate, Path::new(path), lang);
    assert!(
        verdict.is_valid(),
        "Expected valid incremental splice on pre-broken {lang:?} ({path}), got: {verdict:?}"
    );
}

fn assert_inc_invalid(lang: LanguageId, path: &str, baseline: &str, candidate: &str) {
    let fw = DefaultSyntaxFirewall;
    let verdict = fw.verify_incremental(Some(baseline), candidate, Path::new(path), lang);
    match verdict {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(
                !diagnostics.is_empty(),
                "Expected non-empty diagnostics for {lang:?} ({path})"
            );
            for d in diagnostics {
                assert!(d.line >= 1 && d.column >= 1, "Invalid line/col: {d:?}");
            }
        }
        FirewallVerdict::Valid => {
            panic!("Expected invalid incremental splice on pre-broken {lang:?} ({path}) to be REJECTED")
        }
    }
}

#[test]
fn bw2_prebroken_file_incremental_firewall_across_r5_twig_and_r6() {
    // R5 TypeScript
    let ts_base = "export const broken = ;\nexport function okFn(): number {\n  return 1;\n}\n";
    let ts_good = "export const broken = ;\nexport function okFn(): number {\n  return 42;\n}\n";
    let ts_bad = "export const broken = ;\nexport function okFn(): { {{{\n";
    assert_inc_valid(LanguageId::TypeScript, "src/broken.ts", ts_base, ts_good);
    assert_inc_invalid(LanguageId::TypeScript, "src/broken.ts", ts_base, ts_bad);

    // R5 Rust
    let rs_base = "pub fn broken_top( { let x = ; }\npub fn ok_fn() -> i32 { 7 }\n";
    let rs_good = "pub fn broken_top( { let x = ; }\npub fn ok_fn() -> i32 { 99 }\n";
    let rs_bad = "pub fn broken_top( { let x = ; }\npub fn ok_fn() -> i32 { let = ; }\n";
    assert_inc_valid(LanguageId::Rust, "src/bad.rs", rs_base, rs_good);
    assert_inc_invalid(LanguageId::Rust, "src/bad.rs", rs_base, rs_bad);

    // R5 Python
    let py_base = "def broken_top(:\n    pass\n\ndef ok_fn():\n    return 1\n";
    let py_good = "def broken_top(:\n    pass\n\ndef ok_fn():\n    return 2\n";
    let py_bad = "def broken_top(:\n    pass\n\ndef ok_fn():\n    if x > :\n        return 2\n";
    assert_inc_valid(LanguageId::Python, "src/bad.py", py_base, py_good);
    assert_inc_invalid(LanguageId::Python, "src/bad.py", py_base, py_bad);

    // Twig
    let twig_base = "{% if open %}\n<p>unclosed</p>\n<p>{{ ok_var }}</p>\n";
    let twig_good = "{% if open %}\n<p>unclosed</p>\n<p>{{ better_var|upper }}</p>\n";
    let twig_bad = "{% if open %}\n<p>unclosed</p>\n<p>{{ broken_tag</p>\n";
    assert_inc_valid(LanguageId::Twig, "src/bad.twig", twig_base, twig_good);
    assert_inc_invalid(LanguageId::Twig, "src/bad.twig", twig_base, twig_bad);

    // R6 ANSI SQL
    let sql_base = "SELECT FROM broken_tbl;\nSELECT id, name FROM users;\n";
    let sql_good = "SELECT FROM broken_tbl;\nSELECT id, email FROM users;\n";
    let sql_bad = "SELECT FROM broken_tbl;\nSELECT id FROM users WHERE ;\n";
    assert_inc_valid(LanguageId::AnsiSql, "src/bad.sql", sql_base, sql_good);
    assert_inc_invalid(LanguageId::AnsiSql, "src/bad.sql", sql_base, sql_bad);

    // R6 PostgreSQL
    let pg_base = "SELECT FROM broken_tbl;\nDO $$ BEGIN PERFORM 1; END $$;\n";
    let pg_good = "SELECT FROM broken_tbl;\nDO $$ BEGIN PERFORM 2; END $$;\n";
    let pg_bad = "SELECT FROM broken_tbl;\nDO $$ BEGIN PERFORM 1; END;\n";
    assert_inc_valid(LanguageId::PostgreSql, "src/pg_bad.sql", pg_base, pg_good);
    assert_inc_invalid(LanguageId::PostgreSql, "src/pg_bad.sql", pg_base, pg_bad);

    // R6 Prisma
    let prisma_base = "model Broken {\n  id Int @id\n\nmodel User {\n  id Int @id\n}\n";
    let prisma_bad = "model Broken {\n  id Int @id\n\nmodel User {\n  id Int @id\n  name\n}\n";
    assert_inc_invalid(LanguageId::Prisma, "schema.prisma", prisma_base, prisma_bad);

    // R6 GraphQL
    let gql_base = "type Broken { id: }\ntype Query { ping: String! }\n";
    let gql_good = "type Broken { id: }\ntype Query { pong: String! }\n";
    let gql_bad = "type Broken { id: }\ntype Query { pong: }\n";
    assert_inc_valid(LanguageId::GraphQl, "api.graphql", gql_base, gql_good);
    assert_inc_invalid(LanguageId::GraphQl, "api.graphql", gql_base, gql_bad);

    // R6 Cypher
    let cypher_base = "MATCH (n) WHERE;\nMATCH (u:User) RETURN u.id;\n";
    let cypher_good = "MATCH (n) WHERE;\nMATCH (u:User) RETURN u.name;\n";
    let cypher_bad = "MATCH (n) WHERE;\nMATCH (u:User RETURN u.name;\n";
    assert_inc_valid(LanguageId::Cypher, "graph.cypher", cypher_base, cypher_good);
    assert_inc_invalid(LanguageId::Cypher, "graph.cypher", cypher_base, cypher_bad);
}
