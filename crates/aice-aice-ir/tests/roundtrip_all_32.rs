use std::fs;
use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, ParsedTree, SyntaxFirewall};

fn fixture_path(rel: &str) -> std::path::PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .join("../../tests/golden/fixtures/src")
        .join(rel)
}

fn verify_roundtrip(lang: LanguageId, virtual_name: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let firewall = DefaultSyntaxFirewall;

    let adapter = reg.adapter(lang).unwrap_or_else(|| panic!("missing adapter for {lang:?}"));
    let tree = adapter.parse_cst(src).unwrap_or_else(|e| panic!("parse_cst failed for {lang:?}: {e:?}"));
    let outcome = transpiler
        .to_aice(&tree, src, &TranspileOpts::default())
        .unwrap_or_else(|e| panic!("to_aice failed for {lang:?}: {e:?}"));

    let module = match outcome {
        TranspileOutcome::Transpiled(m) => m,
        TranspileOutcome::UnsupportedPassthrough { .. } => {
            panic!("unexpected UnsupportedPassthrough for {lang:?}");
        }
    };
    assert!(!module.items.is_empty(), "{lang:?} produced empty AiceModule.items");
    assert!(module.raw_fallback.is_empty(), "{lang:?} fell back to raw_fallback");

    let aice_text = print_aice(&module);
    assert!(!aice_text.trim().is_empty(), "{lang:?} printed empty AICE text");

    let reparsed = parse_aice(&aice_text)
        .unwrap_or_else(|e| panic!("parse_aice failed for {lang:?}: {e}\n--- AICE ---\n{aice_text}"));

    let native_out = transpiler
        .to_native(&reparsed, lang)
        .unwrap_or_else(|e| panic!("to_native failed for {lang:?}: {e}"));

    let verdict = firewall.verify(&native_out, Path::new(virtual_name), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "SyntaxFirewall rejected {lang:?} native output:\n--- NATIVE ---\n{native_out}\n--- AICE ---\n{aice_text}"
    );
    (aice_text, native_out)
}

#[test]
fn roundtrip_all_32_supported_languages_and_fixtures() {
    let fixture_cases: &[(&str, LanguageId)] = &[
        ("manifest.json", LanguageId::Json),
        ("deploy.yaml", LanguageId::Yaml),
        ("config.toml", LanguageId::Toml),
        ("config.xml", LanguageId::Xml),
        ("diagram.svg", LanguageId::Xml),
        ("guide.md", LanguageId::Markdown),
        ("page.html", LanguageId::Html),
        ("styles.css", LanguageId::Css),
        ("build.sh", LanguageId::Bash),
        ("card.twig", LanguageId::Twig),
        ("math.ts", LanguageId::TypeScript),
        ("app.ts", LanguageId::TypeScript),
        ("app.spec.ts", LanguageId::TypeScript),
        ("big.ts", LanguageId::TypeScript),
        ("component.tsx", LanguageId::Tsx),
        ("helper.js", LanguageId::JavaScript),
        ("worker.py", LanguageId::Python),
        ("engine.rs", LanguageId::Rust),
        ("server.go", LanguageId::Go),
        ("native.c", LanguageId::C),
        ("matrix.cpp", LanguageId::Cpp),
        ("billing.cs", LanguageId::CSharp),
        ("Service.java", LanguageId::Java),
        ("Handler.kt", LanguageId::Kotlin),
        ("widget.dart", LanguageId::Dart),
        ("controller.php", LanguageId::Php),
        ("jobs.rb", LanguageId::Ruby),
        ("schema_ansi.sql", LanguageId::AnsiSql),
        ("trigger_pg.sql", LanguageId::PostgreSql),
        ("proc_mysql.sql", LanguageId::MySql),
        ("local_sqlite.sql", LanguageId::Sqlite),
        ("report_tsql.sql", LanguageId::TSql),
        ("migrations/V001__init_ledger.sql", LanguageId::DbMigration),
        ("schema.prisma", LanguageId::Prisma),
        ("api.graphql", LanguageId::GraphQl),
        ("graph.cypher", LanguageId::Cypher),
    ];

    for (rel, lang) in fixture_cases {
        let src = fs::read_to_string(fixture_path(rel))
            .unwrap_or_else(|e| panic!("read fixture {rel}: {e}"));
        let (aice, native) = verify_roundtrip(*lang, rel, &src);
        assert!(!native.contains("dynamic pass;"), "{rel} collapsed to dynamic pass;:\n{native}");
        assert!(!native.contains("def constructor("), "{rel} emitted def constructor:\n{native}");
        assert!(!native.contains("object pass { get; set; }"), "{rel} emitted object pass:\n{native}");
        match *rel {
            "widget.dart" => {
                assert!(aice.contains("StatusBadge") && aice.contains("renderText"), "Dart lost members:\n{aice}");
                assert!(native.contains("renderText") && native.contains("this.label"), "Dart native lost members:\n{native}");
            }
            "jobs.rb" => {
                assert!(native.contains("def initialize"), "Ruby lost initialize:\n{native}");
            }
            "card.twig" => {
                assert!(native.contains("{# Status card component #}"), "Twig lost comment trivia:\n{native}");
            }
            "trigger_pg.sql" => {
                assert!(aice.contains("proc \"postgresql\" fn \"audit_balance_change\""), "PG trigger fn lost:\n{aice}");
            }
            "report_tsql.sql" => {
                assert!(!aice.contains("(\"10\")"), "TSQL extracted SELECT TOP (10) as proc param:\n{aice}");
            }
            "proc_mysql.sql" => {
                assert!(!aice.contains("DECIMAL(10,2\""), "MySQL truncated DECIMAL(10,2) param:\n{aice}");
            }
            _ => {}
        }
    }
}

#[test]
fn roundtrip_extended_dialects_dtd_twig_branches_and_queries() {
    // DTD
    verify_roundtrip(
        LanguageId::Xml,
        "note.dtd",
        "<!ELEMENT note (to,from,body)>\n<!ATTLIST note id ID #REQUIRED>",
    );
    // Twig with elseif + else
    verify_roundtrip(
        LanguageId::Twig,
        "branch.twig",
        "{# branch test #}\n{% if role == 'admin' %}\n<span class=\"badge\">Admin</span>\n{% elseif role == 'mod' %}\n<span class=\"badge\">Mod</span>\n{% else %}\n<span class=\"badge\">User</span>\n{% endif %}",
    );
    // Markdown frontmatter + code fence + table
    verify_roundtrip(
        LanguageId::Markdown,
        "doc.md",
        "---\ntitle: Spec\n---\n\n# Heading\n\n```rust\nfn main() {}\n```\n\n| A | B |\n| --- | --- |\n| 1 | 2 |\n",
    );
    // TOML array of tables
    verify_roundtrip(
        LanguageId::Toml,
        "Cargo.toml",
        "[package]\nname = \"demo\"\n\n[[bin]]\nname = \"cli\"\n",
    );
}

#[test]
fn plaintext_only_yields_passthrough_and_aice_parses_directly() {
    let transpiler = DefaultAiceTranspiler;
    let pt = ParsedTree::PlainText { line_count: 2 };
    let out = transpiler
        .to_aice(&pt, "hello\nworld", &TranspileOpts::default())
        .expect("plaintext");
    assert!(matches!(
        out,
        TranspileOutcome::UnsupportedPassthrough { lang: LanguageId::PlainText, .. }
    ));

    let aice_src = "module demo\npub fn add(a:num, b:num) -> num = a + b\n";
    let parsed = parse_aice(aice_src).expect("parse_aice");
    assert_eq!(parsed.module_name, "demo");
    assert_eq!(parsed.items.len(), 1);
}

#[test]
fn roundtrip_b_r5_minimal_one_liners_all_32() {
    let cases: &[(LanguageId, &str, &str)] = &[
        (LanguageId::Tsx, "el.tsx", "export const El = () => <div/>;"),
        (LanguageId::Rust, "el.rs", "pub struct Empty;\nimpl Empty { pub fn ping(&self) -> i64 { 1 } }"),
        (LanguageId::Kotlin, "el.kt", "fun f(x: Int): String = when (x) { 1 -> \"a\"; else -> \"b\" }"),
        (LanguageId::Ruby, "el.rb", "def f(u); unless u.nil?; 1; end; end"),
        (LanguageId::MySql, "el.sql", "CREATE PROCEDURE p()\nBEGIN\n  SELECT 1;\nEND;"),
        (LanguageId::CSharp, "el.cs", "class A { int F(int x) => x + 1; }"),
    ];
    for (lang, path, src) in cases {
        let (_, native) = verify_roundtrip(*lang, path, src);
        assert!(!native.trim().is_empty(), "{lang:?} emitted empty native");
    }
}

#[test]
fn iter5_aice_block_scoping_pass_arm_and_ruby_match_return() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // Item 1a: Direct AICE { ... } statement blocks preserve nested `if` scope
    let aice_brace = "module m\npub fn f(x:int) -> int:\n  match x:\n    1 => {\n      if x > 0:\n        a ::= 1\n        a += 1\n      ret 0\n    }\n    _ => pass\n  g := fn(b:int) -> int {\n    if b > 0:\n      c ::= 1\n      c += 2\n      ret c\n    ret 0\n  }\n  ret g(x)\n";
    let parsed = parse_aice(aice_brace).expect("parse brace block AICE");
    let rs = transpiler.to_native(&parsed, LanguageId::Rust).unwrap();
    assert!(rs.contains("if x > 0 {\n                let mut a = 1;\n                a += 1;\n            }"), "Rust scope escaped if inside match brace block:\n{rs}");
    assert!(rs.contains("if b > 0 {\n  let mut c = 1;\n  c += 2;\n  return c;\n}"), "Rust scope escaped if inside closure brace block:\n{rs}");
    assert_eq!(fw.verify(&rs, Path::new("m.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs}");

    // Multi-line record literal continuation still parses cleanly
    let rec_aice = "module r\npub fn mk() -> int:\n  obj := {\n    k1: 1,\n    k2: 2\n  }\n  ret 0\n";
    assert!(parse_aice(rec_aice).is_ok(), "multi-line record literal failed parse_aice");

    // Item 2: `_ => pass` in C# and C-family targets
    let cs = transpiler.to_native(&parsed, LanguageId::CSharp).unwrap();
    assert!(!cs.contains("pass;"), "C# emitted invalid pass;:\n{cs}");
    assert_eq!(fw.verify(&cs, Path::new("M.cs"), LanguageId::CSharp), FirewallVerdict::Valid, "{cs}");

    // Item 5 + Minor polish: Ruby `ret match` with `if`-lowering + `Integer`/`String` + Python `List<String>` + wildcard-first
    let aice_rb = "module rb\npub fn pat_expr(x:any) -> int:\n  ret match x:\n    is int => 1\n    !is str => 2\n    is List[str] => 3\n    _ => 4\npub fn gmatch3(x:int, ok:bool) -> int:\n  ret match x:\n    0 if ok => 1\n    1 if ok => 2\n    _ => 3\npub fn wfirst(x:any) -> int:\n  ret match x:\n    _ => 1\n    is int => 2\n";
    let rb_mod = parse_aice(aice_rb).expect("parse rb match expr");
    let rb_nat = transpiler.to_native(&rb_mod, LanguageId::Ruby).unwrap();
    assert!(rb_nat.contains("return (if x.is_a?(Integer)"), "Ruby missing parenthesized return (if ...) or Integer:\n{rb_nat}");
    assert!(rb_nat.contains("x.is_a?(String)"), "Ruby missing String in is_a?:\n{rb_nat}");
    assert_eq!(fw.verify(&rb_nat, Path::new("rb.rb"), LanguageId::Ruby), FirewallVerdict::Valid, "{rb_nat}");

    let py_nat = transpiler.to_native(&rb_mod, LanguageId::Python).unwrap();
    assert!(!py_nat.contains("List<"), "Python isinstance emitted <...>:\n{py_nat}");
    assert_eq!(fw.verify(&py_nat, Path::new("rb.py"), LanguageId::Python), FirewallVerdict::Valid, "{py_nat}");

    for (lang, path) in [(LanguageId::Rust, "wf.rs"), (LanguageId::TypeScript, "wf.ts"), (LanguageId::Kotlin, "wf.kt")] {
        let nat = transpiler.to_native(&rb_mod, lang).unwrap();
        assert_eq!(fw.verify(&nat, Path::new(path), lang), FirewallVerdict::Valid, "Wildcard-first failed {lang:?}:\n{nat}");
    }
}
