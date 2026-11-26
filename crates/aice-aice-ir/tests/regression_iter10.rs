use std::path::Path;

use aice_aice_ir::ir::{
    AiceItem, AiceModule, AiceType, FnBody, FnDecl, ParamDecl, PrimitiveType, Span, Trivia,
    Visibility,
};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn make_c_probe(params: Vec<(&str, AiceType)>, ret: AiceType) -> String {
    let mut m = AiceModule::new(LanguageId::Aice, "m");
    let ps = params
        .into_iter()
        .map(|(name, ty)| ParamDecl {
            name: name.to_string(),
            vis: Visibility::Default,
            is_readonly: false,
            is_mut: false,
            is_optional: false,
            is_rest: false,
            ty: Some(ty),
            default: None,
            trivia: Trivia::default(),
        })
        .collect();
    m.items.push(AiceItem::Fn(FnDecl {
        vis: Visibility::Public,
        is_async: false,
        is_static: false,
        decorators: Vec::new(),
        name: "probe".to_string(),
        type_params: Vec::new(),
        params: ps,
        return_type: Some(ret),
        body: FnBody::Block(Vec::new()),
        trivia: Trivia::default(),
        span: Span::empty(),
    }));
    let c = DefaultAiceTranspiler.to_native(&m, LanguageId::C).unwrap();
    assert_eq!(
        DefaultSyntaxFirewall.verify(&c, Path::new("probe.c"), LanguageId::C),
        FirewallVerdict::Valid,
        "Invalid C emitted:\n{c}"
    );
    c
}

#[test]
fn iter10_c_rejects_standalone_qualifiers_and_malformed_raw_types() {
    let bad_raws = [
        "*const ",
        "*const",
        "const *",
        "*volatile",
        "*struct",
        "*union",
        "*enum",
        "*restrict",
        "const",
        "volatile",
        "restrict",
        "struct",
        "union",
        "enum",
        "const const",
        "const volatile",
        "*mut ",
        "*mut",
    ];
    for raw in bad_raws {
        let c = make_c_probe(vec![("x", AiceType::Raw(raw.into()))], AiceType::Raw(raw.into()));
        assert!(!c.contains("const*"), "raw={raw:?} emitted const*:\n{c}");
        assert!(!c.contains("volatile*"), "raw={raw:?} emitted volatile*:\n{c}");
        assert!(!c.contains("struct*"), "raw={raw:?} emitted struct*:\n{c}");
        assert!(!c.contains("union*"), "raw={raw:?} emitted union*:\n{c}");
        assert!(!c.contains("enum*"), "raw={raw:?} emitted enum*:\n{c}");
        assert!(!c.contains("restrict*"), "raw={raw:?} emitted restrict*:\n{c}");
        assert!(c.contains("void*"), "raw={raw:?} did not fall back to void*:\n{c}");
    }
}

#[test]
fn iter10_c_sanitizes_named_types_and_polish_cases() {
    let bad_named: &[&[&str]] = &[&["🦀"], &["a<b"], &[], &["const"], &["struct"], &["Pkg", "🦀"]];
    for segs in bad_named {
        let path: Vec<String> = segs.iter().map(|s| (*s).to_string()).collect();
        let c = make_c_probe(
            vec![("x", AiceType::Named { path: path.clone(), args: Vec::new() })],
            AiceType::Named { path, args: Vec::new() },
        );
        assert!(c.contains("void* probe(void* x)"), "bad_named={segs:?}:\n{c}");
        assert!(!c.contains('<') && !c.contains('>') && !c.contains('🦀'), "{c}");
    }

    // Polish: const <rust_scalar> and void param/field -> void*
    let c_pol = make_c_probe(
        vec![
            ("a", AiceType::Raw("const i32*".into())),
            ("b", AiceType::Raw("const boolean*".into())),
            ("u", AiceType::Primitive(PrimitiveType::Void)),
        ],
        AiceType::Primitive(PrimitiveType::Void),
    );
    assert!(c_pol.contains("const int* a"), "{c_pol}");
    assert!(c_pol.contains("const bool* b"), "{c_pol}");
    assert!(c_pol.contains("void* u"), "{c_pol}");
    assert!(!c_pol.contains("void u"), "{c_pol}");

    // Polish: TS Array(Fn) / Option(Fn) precedence parenthesization
    let aice = "module ts_fn\npub fn h(a: [fn(int) -> int], b: (fn(int) -> int)?) -> void:\n  pass\n";
    let parsed = parse_aice(aice).unwrap();
    let ts = DefaultAiceTranspiler.to_native(&parsed, LanguageId::TypeScript).unwrap();
    assert!(ts.contains("((p0: number) => number)[]"), "{ts}");
    assert!(ts.contains("((p0: number) => number) | null"), "{ts}");
    assert_eq!(
        DefaultSyntaxFirewall.verify(&ts, Path::new("ts_fn.ts"), LanguageId::TypeScript),
        FirewallVerdict::Valid
    );
}

#[test]
fn iter10_trailing_comments_preserved_across_all_challenger_languages() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let cases: &[(LanguageId, &str, &str, &str)] = &[
        (LanguageId::TypeScript, "t.ts", "export const x = 1; // ts_single\n", "ts_single"),
        (LanguageId::JavaScript, "t.js", "const x = 1; // js_single\n", "js_single"),
        (LanguageId::Rust, "t.rs", "pub fn f() -> i64 { 1 } // rs_single\n", "rs_single"),
        (LanguageId::Python, "t.py", "x = 1 # py_single\n", "py_single"),
        (LanguageId::Css, "t.css", ".a { color: red; } /* css_single */\n", "css_single"),
        (LanguageId::Go, "t.go", "package main\nfunc F() int { return 1 } // go_single\n", "go_single"),
        (LanguageId::C, "t.c", "int f(void) { return 1; } // c_single\n", "c_single"),
        (
            LanguageId::TypeScript,
            "blk.ts",
            "export function f(): number {\n  return 1; // last_stmt_tail\n}\n",
            "last_stmt_tail",
        ),
        (LanguageId::Html, "t.html", "<div>hi</div> <!-- html_single -->\n", "html_single"),
        (LanguageId::Yaml, "t.yaml", "a: 1 # yaml_single\n", "yaml_single"),
        (LanguageId::Toml, "t.toml", "a = 1 # toml_single\nb = 2\n", "toml_single"),
    ];

    for (lang, vpath, src, marker) in cases {
        let tree = reg.adapter(*lang).unwrap().parse_cst(src).unwrap();
        let TranspileOutcome::Transpiled(m) = transpiler
            .to_aice(&tree, src, &TranspileOpts::default())
            .unwrap()
        else {
            panic!("expected Transpiled for {lang:?}");
        };
        let aice = print_aice(&m);
        assert!(aice.contains(marker), "{lang:?} missing {marker:?} in AICE:\n{aice}");

        let reparsed = parse_aice(&aice)
            .unwrap_or_else(|e| panic!("reparse failed for {lang:?}: {e}\n{aice}"));
        let reprinted = print_aice(&reparsed);
        assert!(
            reprinted.contains(marker),
            "{lang:?} lost {marker:?} after parse_aice -> print_aice:\n{reprinted}"
        );

        let native = transpiler.to_native(&reparsed, *lang).unwrap();
        assert_eq!(
            fw.verify(&native, Path::new(vpath), *lang),
            FirewallVerdict::Valid,
            "Invalid native for {lang:?}:\n{native}"
        );

        let no_docs = print_aice_with_opts(
            &m,
            &TranspileOpts { compact: true, include_types: true, preserve_docs: false },
        );
        assert!(!no_docs.contains(marker), "{lang:?} emitted {marker:?} with preserve_docs=false:\n{no_docs}");
    }
}

#[test]
fn iter10_trailing_comments_in_cf_blocks_domain_and_db_roundtrip() {
    let aice = "\
module mixed_trail
pub fn flow(x: int) -> int: # fn_tail
  if x > 0: # if_tail
    ret 1 # ret_tail
  for i in [1, 2]: # for_tail
    pass
  while x > 10: # while_tail
    break
  try: # try_tail
    ret 0
  catch e: # catch_tail
    ret -1
  match x: # match_tail
    1 => 2
    _ => 3
style \".btn\": # rule_tail
  color: red # prop_tail
data toml: # data_tail
  section \"pkg\": # sec_tail
    name: \"demo\" # scalar_tail
table \"users\": # tbl_tail
  col \"id\": \"INT\" # col_tail
";
    let parsed = parse_aice(aice).expect("parse mixed_trail");
    let printed = print_aice(&parsed);
    for marker in [
        "fn_tail", "if_tail", "ret_tail", "for_tail", "while_tail", "try_tail", "catch_tail",
        "match_tail", "rule_tail", "prop_tail", "data_tail", "sec_tail", "scalar_tail",
        "tbl_tail", "col_tail",
    ] {
        assert!(printed.contains(marker), "missing {marker} in:\n{printed}");
    }
    let reparsed = parse_aice(&printed).expect("reparse mixed_trail");
    assert_eq!(parsed.items.len(), reparsed.items.len());
}
