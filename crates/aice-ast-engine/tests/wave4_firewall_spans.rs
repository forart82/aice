use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallDiagnostic, FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_invalid_diags(
    lang: LanguageId,
    path: &str,
    baseline: Option<&str>,
    candidate: &str,
) -> Vec<FirewallDiagnostic> {
    let fw = DefaultSyntaxFirewall;
    let verdict = match baseline {
        Some(base) => fw.verify_incremental(Some(base), candidate, Path::new(path), lang),
        None => fw.verify(candidate, Path::new(path), lang),
    };
    match verdict {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(!diagnostics.is_empty(), "expected non-empty diagnostics for {lang:?} ({path})");
            diagnostics
        }
        FirewallVerdict::Valid => {
            panic!("expected Invalid verdict for {lang:?} ({path}), got Valid")
        }
    }
}

fn pad_lines(prefix_line: &str, count: usize) -> String {
    (1..=count)
        .map(|i| prefix_line.replace("{i}", &i.to_string()))
        .collect::<Vec<_>>()
        .join("\n")
}

#[test]
fn f41_unclosed_brace_on_line_20_pinpoints_offending_line_not_line_1() {
    // Rust (standalone verify — tree-sitter root ERROR spans L1:1..EOF)
    let mut rs = pad_lines("fn ok_{i}() -> i32 { {i} }", 19);
    rs.push_str("\nfn broken() -> i32 {\n    let x = 42;\n    x\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/lru.rs", None, &rs);
    assert_eq!(diags[0].line, 20, "Rust unclosed '{{' should report line 20: {diags:?}");
    assert!(diags[0].column > 1, "Rust column should point to '{{': {diags:?}");

    // TypeScript (both EOF unclosed and mid-file unclosed with trailing function)
    let mut ts = pad_lines("export function ok_{i}(): number { return {i}; }", 19);
    ts.push_str("\nexport function broken(): number {\n  return 42;\nexport function after(): number {\n  return 1;\n}\n");
    let diags = assert_invalid_diags(LanguageId::TypeScript, "src/app.ts", None, &ts);
    assert!(diags[0].line >= 20, "TS unclosed '{{' must report >= 20 (not 1:1): {diags:?}");

    // JavaScript
    let mut js = pad_lines("function ok_{i}() { return {i}; }", 19);
    js.push_str("\nfunction broken() {\n  return 42;\nfunction after() {\n  return 1;\n}\n");
    let diags = assert_invalid_diags(LanguageId::JavaScript, "src/app.js", None, &js);
    assert!(diags[0].line >= 20, "JS unclosed '{{' must report >= 20 (not 1:1): {diags:?}");

    // PHP (top-level function & inside class)
    let mut php = String::from("<?php\n");
    php.push_str(&pad_lines("function ok_{i}() { return {i}; }", 18));
    php.push_str("\nfunction broken() {\n    return 42;\n");
    let diags = assert_invalid_diags(LanguageId::Php, "src/InvoiceCalculator.php", None, &php);
    assert!((20..=21).contains(&diags[0].line), "PHP unclosed '{{' must report L20-21 (not 1:1): {diags:?}");

    let mut php_cls = String::from("<?php\nclass InvoiceCalculator {\n");
    php_cls.push_str(&pad_lines("    public function ok_{i}() { return {i}; }", 17));
    php_cls.push_str("\n    public function broken() {\n        return 42;\n");
    let diags = assert_invalid_diags(LanguageId::Php, "src/InvoiceCalculator.php", None, &php_cls);
    assert!((20..=21).contains(&diags[0].line), "PHP class unclosed '{{' must report L20-21 (not 1:1): {diags:?}");

    // C#
    let mut cs = String::from("using System;\npublic class Engine {\n");
    cs.push_str(&pad_lines("    public int Ok_{i}() { return {i}; }", 17));
    cs.push_str("\n    public int Broken() {\n        return 42;\n");
    let diags = assert_invalid_diags(LanguageId::CSharp, "BookingEngine.cs", None, &cs);
    assert_eq!(diags[0].line, 20, "C# unclosed '{{' should report line 20: {diags:?}");

    // Kotlin
    let mut kt = String::from("package demo\nclass Tracker {\n");
    kt.push_str(&pad_lines("    fun ok_{i}(): Int { return {i} }", 17));
    kt.push_str("\n    fun broken(): Int {\n        return 42\n");
    let diags = assert_invalid_diags(LanguageId::Kotlin, "src/PomodoroEngine.kt", None, &kt);
    assert_eq!(diags[0].line, 20, "Kotlin unclosed '{{' should report line 20: {diags:?}");

    // Dart
    let mut dart = String::from("class DbHelper {\n");
    dart.push_str(&pad_lines("  int ok_{i}() { return {i}; }", 18));
    dart.push_str("\n  int broken() {\n    return 42;\n");
    let diags = assert_invalid_diags(LanguageId::Dart, "lib/database_helper.dart", None, &dart);
    assert_eq!(diags[0].line, 20, "Dart unclosed '{{' should report line 20: {diags:?}");
}

#[test]
fn f41_unclosed_paren_and_bracket_across_code_and_structured_langs() {
    // Python unclosed '(' on line 20
    let mut py = pad_lines("def ok_{i}(): return {i}", 19);
    py.push_str("\ndef broken(a, b:\n    return a\n");
    let diags = assert_invalid_diags(LanguageId::Python, "src/ledger.py", None, &py);
    assert!((20..=21).contains(&diags[0].line), "Python unclosed '(' must report L20-21 (not 1:1): {diags:?}");

    // Python root-ERROR unclosed '(' with valid defs before
    let mut py2 = pad_lines("def ok_{i}(): return {i}", 19);
    py2.push_str("\ndef broken(:\n    pass\n");
    let diags = assert_invalid_diags(LanguageId::Python, "src/ledger2.py", None, &py2);
    assert!(diags[0].line >= 20, "Python def broken(: must report >= 20 (not 1:1): {diags:?}");

    // Rust unclosed '[' on line 20 with comments/strings containing fake delimiters earlier
    let mut rs = String::from("// decoy { ( [\n");
    rs.push_str(&pad_lines("const S_{i}: &str = \"{ [ (\";", 18));
    rs.push_str("\nfn broken() { let a = [1, 2, 3; }\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/arr.rs", None, &rs);
    assert_eq!(diags[0].line, 20, "Rust unclosed '[' should report line 20: {diags:?}");

    // Nested unclosed delimiters: '{' on L10, '(' on L20, '[' on L22 -> innermost L22
    let mut nested = pad_lines("fn ok_{i}() {}", 9);
    nested.push_str("\nfn outer() {\n");
    nested.push_str(&pad_lines("    let v_{i} = {i};", 9));
    nested.push_str("\n    let x = compute(\n        1,\n        [1, 2\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/nested.rs", None, &nested);
    assert_eq!(diags[0].line, 22, "Innermost unclosed '[' should report line 22: {diags:?}");

    // TOML unclosed '[' on line 20
    let mut toml = pad_lines("k_{i} = {i}", 19);
    toml.push_str("\nbad = [1, 2, 3\n");
    let diags = assert_invalid_diags(LanguageId::Toml, "Cargo.toml", None, &toml);
    assert_eq!(diags[0].line, 20, "TOML unclosed '[' should report line 20: {diags:?}");

    // YAML unclosed '[' on line 20 (with apostrophe in earlier plain scalar!)
    let mut yaml = String::from("title: It's a valid scalar\n");
    yaml.push_str(&pad_lines("k_{i}: {i}", 18));
    yaml.push_str("\nbad: [1, 2, 3\n");
    let diags = assert_invalid_diags(LanguageId::Yaml, "openapi.yaml", None, &yaml);
    assert_eq!(diags[0].line, 20, "YAML unclosed '[' should report line 20: {diags:?}");

    // Cypher unclosed '(' on line 20
    let mut cypher = pad_lines("MATCH (n{i}:Node) RETURN n{i};", 19);
    cypher.push_str("\nMATCH (u:User RETURN u;\n");
    let diags = assert_invalid_diags(LanguageId::Cypher, "graph.cypher", None, &cypher);
    assert_eq!(diags[0].line, 20, "Cypher unclosed '(' should report line 20: {diags:?}");
}

#[test]
fn f41_unterminated_comment_string_xml_and_balanced_deep_errors() {
    // Unterminated block comment on line 20 inside an outer mod opened on line 1
    let mut blk = String::from("mod outer {\n");
    blk.push_str(&pad_lines("    fn ok_{i}() -> i32 { {i} }", 18));
    blk.push_str("\n    /* unterminated block comment\n    fn after() {}\n}\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/blk.rs", None, &blk);
    assert!(diags[0].line >= 20, "Unterminated '/*' must report >= 20 (not 1:1): {diags:?}");

    // Unterminated raw string literal on line 20 inside an outer block opened on line 1
    let mut raw_str = String::from("mod outer {\n");
    raw_str.push_str(&pad_lines("    fn ok_{i}() -> i32 { {i} }", 18));
    raw_str.push_str("\n    const BAD: &str = r#\"unterminated\n}\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/raw_str.rs", None, &raw_str);
    assert!(diags[0].line >= 20, "Unterminated raw string must report >= 20 (not 1:1): {diags:?}");

    // XML unclosed start tag on line 20 must NOT be shadowed by tree-sitter Line 1:1 wrapper
    let mut xml = String::from("<?xml version=\"1.0\"?>\n<manifest>\n");
    xml.push_str(&pad_lines("  <item id=\"{i}\" />", 17));
    xml.push_str("\n  <broken attr=\"x\"\n</manifest>\n");
    let diags = assert_invalid_diags(LanguageId::Xml, "AndroidManifest.xml", None, &xml);
    assert!(diags[0].line > 1, "XML unclosed tag must NOT report Line 1:1: {diags:?}");
    assert!(diags.iter().any(|d| d.line == 20), "XML must pinpoint unclosed <broken> at line 20: {diags:?}");

    // Ruby missing `end` on line 20 (balanced parens/braces!)
    let mut rb = pad_lines("def ok_{i}; {i}; end", 19);
    rb.push_str("\ndef broken\n  x = 1\n");
    let diags = assert_invalid_diags(LanguageId::Ruby, "billing_job.rb", None, &rb);
    assert!(diags[0].line >= 20, "Ruby missing end must report >= 20 (not 1:1): {diags:?}");

    // Incremental splice from valid baseline where outer brace closes inner unclosed brace
    let mut cs_base = String::from("namespace Demo {\npublic class Engine {\n");
    cs_base.push_str(&pad_lines("    public int Ok_{i}() { return {i}; }", 17));
    cs_base.push_str("\n    public int Target() {\n        return 1;\n    }\n}\n}\n");
    let cs_cand = cs_base.replace(
        "    public int Target() {\n        return 1;\n    }\n",
        "    public int Target() {\n        return 1;\n",
    );
    let diags = assert_invalid_diags(LanguageId::CSharp, "BookingEngine.cs", Some(&cs_base), &cs_cand);
    assert!(diags[0].line >= 20, "Incremental C# missing inner '}}' must report >= 20 (not 1:1): {diags:?}");

    // Incremental splice from valid baseline on Rust/Python/PHP/YAML/TOML/Cypher/Kotlin/Dart/Ruby
    let mut rs_base = pad_lines("fn ok_{i}() -> i32 { {i} }", 19);
    rs_base.push_str("\nfn target() -> i32 { 1 }\n");
    let rs_cand = rs_base.replace("fn target() -> i32 { 1 }", "fn target() -> i32 { let = ;");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/lru.rs", Some(&rs_base), &rs_cand);
    assert_eq!(diags[0].line, 20, "Incremental Rust broken fn at line 20 must report 20: {diags:?}");
    // XML without <?xml?> prolog: root <manifest> opens on line 1, unclosed <broken> on line 20
    let mut xml_no_prolog = String::from("<manifest>\n");
    xml_no_prolog.push_str(&pad_lines("  <item id=\"{i}\" />", 18));
    xml_no_prolog.push_str("\n  <broken attr=\"x\"\n</manifest>\n");
    let diags = assert_invalid_diags(LanguageId::Xml, "AndroidManifest.xml", None, &xml_no_prolog);
    assert_eq!(diags[0].line, 20, "XML innermost unclosed <broken> must report line 20 first: {diags:?}");

    // Balanced-delimiter deep errors (standalone verify, NO baseline!)
    let mut toml_bal = pad_lines("k_{i} = {i}", 19);
    toml_bal.push_str("\nbad == 1\n");
    let diags = assert_invalid_diags(LanguageId::Toml, "Cargo.toml", None, &toml_bal);
    assert_eq!(diags[0].line, 20, "TOML balanced deep error must report line 20: {diags:?}");

    let mut cypher_bal = pad_lines("MATCH (n{i}:Node) RETURN n{i};", 19);
    cypher_bal.push_str("\nMATCH (u:User) WHERE;\n");
    let diags = assert_invalid_diags(LanguageId::Cypher, "graph.cypher", None, &cypher_bal);
    assert!(diags[0].line >= 20, "Cypher balanced deep error must report >= 20: {diags:?}");

    let mut rs_bal = pad_lines("fn ok_{i}() -> i32 { {i} }", 19);
    rs_bal.push_str("\nfn broken() -> i32 { let = ; }\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/bal.rs", None, &rs_bal);
    assert_eq!(diags[0].line, 20, "Rust balanced deep error must report line 20: {diags:?}");

    let mut py_bal = pad_lines("def ok_{i}(): return {i}", 19);
    py_bal.push_str("\ndef broken():\n    if x > :\n        return 1\n");
    let diags = assert_invalid_diags(LanguageId::Python, "src/bal.py", None, &py_bal);
    assert!(diags[0].line >= 20, "Python balanced deep error must report >= 20: {diags:?}");

    // Unmatched closing delimiter on line 20
    let mut unm = pad_lines("fn ok_{i}() -> i32 { {i} }", 19);
    unm.push_str("\nfn broken() -> i32 { 1 ) }\n");
    let diags = assert_invalid_diags(LanguageId::Rust, "src/unm.rs", None, &unm);
    assert_eq!(diags[0].line, 20, "Rust unmatched ')' must report line 20: {diags:?}");
}

#[test]
fn f41_genuine_line_1_errors_still_report_line_1() {
    let diags = assert_invalid_diags(LanguageId::Rust, "src/one.rs", None, "fn broken( { let x = 1;\n");
    assert_eq!(diags[0].line, 1, "Single-line error must stay on line 1: {diags:?}");
    assert!(diags[0].column > 1, "Unclosed delimiter on line 1 should pinpoint column > 1: {diags:?}");

    let diags = assert_invalid_diags(LanguageId::Rust, "src/top.rs", None, "@@@\nfn ok() -> i32 { 1 }\n");
    assert_eq!(diags[0].line, 1, "Genuine line 1 col 1 token error stays on line 1: {diags:?}");
}

#[test]
fn f70_cypher_create_constraint_and_l4_error_never_prepends_line_1_1() {
    let base = concat!(
        "CREATE CONSTRAINT account_id IF NOT EXISTS FOR (a:Account) REQUIRE a.id IS UNIQUE;\n",
        "\n",
        "MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)\n",
        "WHERE tx.amount > 100 AND src.active = true\n",
        "WITH src, dst, sum(tx.amount) AS moved\n",
        "RETURN src.id, dst.id, moved\n",
        "ORDER BY moved DESC\n",
        "LIMIT 10;\n",
    );

    // 1. Unclosed '(' and '[' on L4 (standalone & incremental) must pinpoint L4, NEVER prepend L1:1
    let bad_delim = base.replace(
        "WHERE tx.amount > 100 AND src.active = true",
        "WHERE   (tx.amount >  [100 AND src.active = true",
    );
    for (mode, baseline) in [("standalone", None), ("incremental", Some(base))] {
        let diags = assert_invalid_diags(LanguageId::Cypher, "edge_graph.cypher", baseline, &bad_delim);
        assert_eq!(diags[0].line, 4, "Cypher ({mode}) L4 delim error must report line 4 first: {diags:?}");
        assert!(
            diags.iter().all(|d| d.line > 1),
            "Cypher ({mode}) must NEVER prepend misleading Line 1:1 on valid L1 CREATE CONSTRAINT: {diags:?}"
        );
    }

    // 2. Balanced-delimiter L4 syntax error (dangling operator) must pinpoint L4, NEVER L1:1
    let bad_balanced = base.replace(
        "WHERE tx.amount > 100 AND src.active = true",
        "WHERE tx.amount > AND src.active = true",
    );
    for (mode, baseline) in [("standalone", None), ("incremental", Some(base))] {
        let diags = assert_invalid_diags(LanguageId::Cypher, "edge_graph.cypher", baseline, &bad_balanced);
        assert_eq!(diags[0].line, 4, "Cypher ({mode}) L4 balanced error must report line 4 first: {diags:?}");
        assert!(
            diags.iter().all(|d| d.line > 1),
            "Cypher ({mode}) balanced L4 error must NEVER report Line 1:1: {diags:?}"
        );
    }

    // 3. Tree-sitter-only L4 error (not flagged by cypher_rd) after valid L1 CREATE CONSTRAINT
    let bad_ts_only = base.replace(
        "WHERE tx.amount > 100 AND src.active = true",
        "WHERE tx.amount === 100",
    );
    for (mode, baseline) in [("standalone", None), ("incremental", Some(base))] {
        let diags = assert_invalid_diags(LanguageId::Cypher, "edge_graph.cypher", baseline, &bad_ts_only);
        assert!(
            diags[0].line >= 3 && diags.iter().all(|d| d.line > 1),
            "Cypher ({mode}) tree-sitter-only L4 error must report L3-4, NEVER L1:1: {diags:?}"
        );
    }

    // 4. Pre-broken Cypher baseline (genuinely broken L1 + NEW L4 error) must NOT prepend broad L1:1 wrapper
    let prebroken_base = concat!(
        "MATCH (bad:Account) WHERE ;\n",
        "\n",
        "MATCH (src:Account)-[tx:TRANSFERRED]->(dst:Account)\n",
        "WHERE tx.amount > 100 AND src.active = true\n",
        "RETURN src.id;\n",
    );
    let prebroken_cand = prebroken_base.replace(
        "WHERE tx.amount > 100 AND src.active = true",
        "WHERE (tx.amount > [100 AND src.active = true",
    );
    let diags = assert_invalid_diags(LanguageId::Cypher, "prebroken.cypher", Some(prebroken_base), &prebroken_cand);
    assert_eq!(diags[0].line, 4, "Pre-broken Cypher L4 edit must report line 4 first: {diags:?}");
    assert!(
        diags.iter().all(|d| d.line > 1),
        "Pre-broken Cypher L4 edit must NOT prepend Line 1:1 wrapper: {diags:?}"
    );
}
