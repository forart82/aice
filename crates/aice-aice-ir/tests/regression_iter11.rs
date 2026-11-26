use std::path::Path;

use aice_aice_ir::ir::{
    AiceItem, AiceModule, AiceType, FieldDecl, FieldSigil, FnBody, FnDecl, ParamDecl,
    PrimitiveType, Span, Stmt, TranspileOpts, Trivia, TriviaComment, TriviaKind, TypeDecl,
    TypeKind, Visibility,
};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn c_fn_module(params: Vec<(&str, AiceType)>, ret: AiceType, fields: Vec<(&str, AiceType)>) -> String {
    let mut m = AiceModule::new(LanguageId::Aice, "m");
    if !fields.is_empty() {
        m.items.push(AiceItem::Type(TypeDecl {
            vis: Visibility::Public, kind: TypeKind::Struct, name: "S".into(),
            type_params: Vec::new(), extends: Vec::new(), alias_target: None,
            fields: fields.into_iter().map(|(n, t)| FieldDecl {
                name: n.into(), vis: Visibility::Public, is_readonly: false, is_optional: false,
                sigil: FieldSigil::None, ty: Some(t), default: None, trivia: Trivia::default(),
            }).collect(),
            methods: Vec::new(), trivia: Trivia::default(), span: Span::empty(),
        }));
    }
    m.items.push(AiceItem::Fn(FnDecl {
        vis: Visibility::Public, is_async: false, is_static: false, decorators: Vec::new(),
        name: "probe".into(), type_params: Vec::new(),
        params: params.into_iter().map(|(n, t)| ParamDecl {
            name: n.into(), vis: Visibility::Default, is_readonly: false, is_mut: false,
            is_optional: false, is_rest: false, ty: Some(t), default: None, trivia: Trivia::default(),
        }).collect(),
        return_type: Some(ret), body: FnBody::Block(Vec::new()),
        trivia: Trivia::default(), span: Span::empty(),
    }));
    let c = DefaultAiceTranspiler.to_native(&m, LanguageId::C).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&c, Path::new("p.c"), LanguageId::C), FirewallVerdict::Valid, "Invalid C:\n{c}");
    c
}

#[test]
fn iter11_c_rejects_all_non_type_keywords_conflicting_specifiers_and_cpp_auto() {
    let bad = [
        "auto", "static", "extern", "typedef", "register", "inline", "_Noreturn",
        "_Alignas", "_Alignof", "_Atomic", "_Generic", "_Static_assert", "_Thread_local",
        "break", "case", "continue", "default", "do", "else", "for", "goto", "if",
        "return", "sizeof", "switch", "while", "const", "volatile", "restrict",
        "struct", "union", "enum", "const static", "unsigned unsigned",
        "long long long", "short long", "long short", "struct return",
        "unsigned long double", "signed double",
    ];
    for raw in bad {
        let c = c_fn_module(vec![("x", AiceType::Raw(raw.into()))], AiceType::Raw(raw.into()), vec![("f", AiceType::Raw(raw.into()))]);
        assert!(c.contains("void* probe(void* x)"), "raw={raw:?} not void*:\n{c}");
        assert!(c.contains("void* f;"), "field raw={raw:?} not void*:\n{c}");
        let c_n = c_fn_module(
            vec![("x", AiceType::Named { path: vec![raw.into()], args: Vec::new() })],
            AiceType::Named { path: vec![raw.into()], args: Vec::new() },
            Vec::new(),
        );
        assert!(c_n.contains("void* probe(void* x)"), "named={raw:?}:\n{c_n}");
    }
    let empty_segs = c_fn_module(
        vec![("x", AiceType::Named { path: vec!["".into(), "".into()], args: Vec::new() })],
        AiceType::Primitive(PrimitiveType::Void),
        Vec::new(),
    );
    assert!(empty_segs.contains("void probe(void* x)") && !empty_segs.contains(" _ "), "{empty_segs}");

    let cpp_src = "auto add_one(auto x) { return x + 1; }\n";
    let tree = EngineRegistry::default().adapter(LanguageId::Cpp).unwrap().parse_cst(cpp_src).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, cpp_src, &TranspileOpts::default()).unwrap() else {
        panic!("expected transpiled");
    };
    let c_out = DefaultAiceTranspiler.to_native(&m, LanguageId::C).unwrap();
    assert!(!c_out.contains("auto "), "emitted invalid auto in C:\n{c_out}");
    assert!(c_out.contains("void* add_one(void* x)"), "{c_out}");
    assert_eq!(DefaultSyntaxFirewall.verify(&c_out, Path::new("a.c"), LanguageId::C), FirewallVerdict::Valid);
}

#[test]
fn iter11_c_qualified_void_promotion_and_ts_compound_precedence() {
    let c = c_fn_module(
        vec![
            ("a", AiceType::Primitive(PrimitiveType::Void)),
            ("b", AiceType::Raw("const void".into())),
            ("c", AiceType::Raw("volatile void".into())),
            ("d", AiceType::Raw("restrict void".into())),
            ("e", AiceType::Raw("const volatile void".into())),
        ],
        AiceType::Primitive(PrimitiveType::Void),
        vec![
            ("fa", AiceType::Primitive(PrimitiveType::Void)),
            ("fb", AiceType::Raw("const void".into())),
            ("fc", AiceType::Raw("volatile void".into())),
        ],
    );
    assert!(c.contains("void probe(void* a, const void* b, volatile void* c, void* d, const volatile void* e)"), "{c}");
    assert!(c.contains("void* fa;") && c.contains("const void* fb;") && c.contains("volatile void* fc;"), "{c}");

    let zero_p = c_fn_module(Vec::new(), AiceType::Primitive(PrimitiveType::Void), Vec::new());
    assert!(zero_p.contains("void probe(void)"), "{zero_p}");

    let aice = "module ts_prec\npub fn f(a: (fn(int) -> int) | str, b: [int | str], c: [(fn(int) -> int)?], d: [A & B]) -> void:\n  pass\n";
    let parsed = parse_aice(aice).unwrap();
    for lang in [LanguageId::TypeScript, LanguageId::Tsx] {
        let ts = DefaultAiceTranspiler.to_native(&parsed, lang).unwrap();
        assert!(ts.contains("((p0: number) => number) | string"), "{ts}");
        assert!(ts.contains("(number | string)[]"), "{ts}");
        assert!(ts.contains("(((p0: number) => number) | null)[]"), "{ts}");
        assert!(ts.contains("(A & B)[]"), "{ts}");
        assert_eq!(DefaultSyntaxFirewall.verify(&ts, Path::new("p.tsx"), lang), FirewallVerdict::Valid);
    }

    let mut m = AiceModule::new(LanguageId::Aice, "ts_inter");
    let fn_ty = AiceType::Fn { params: vec![AiceType::Primitive(PrimitiveType::Int)], ret: Box::new(AiceType::Primitive(PrimitiveType::Int)) };
    let tag_ty = AiceType::Named { path: vec!["Tag".into()], args: Vec::new() };
    let inter = AiceType::Intersection(vec![fn_ty, tag_ty.clone()]);
    let inter_u = AiceType::Intersection(vec![AiceType::Union(vec![AiceType::Primitive(PrimitiveType::Int), AiceType::Primitive(PrimitiveType::Str)]), tag_ty]);
    m.items.push(AiceItem::Fn(FnDecl {
        vis: Visibility::Public, is_async: false, is_static: false, decorators: Vec::new(),
        name: "g".into(), type_params: Vec::new(),
        params: vec![
            ParamDecl { name: "x".into(), vis: Visibility::Default, is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: Some(inter), default: None, trivia: Trivia::default() },
            ParamDecl { name: "y".into(), vis: Visibility::Default, is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: Some(inter_u), default: None, trivia: Trivia::default() },
        ],
        return_type: Some(AiceType::Primitive(PrimitiveType::Void)),
        body: FnBody::Block(Vec::new()), trivia: Trivia::default(), span: Span::empty(),
    }));
    let ts_i = DefaultAiceTranspiler.to_native(&m, LanguageId::TypeScript).unwrap();
    assert!(ts_i.contains("((p0: number) => number) & Tag"), "{ts_i}");
    assert!(ts_i.contains("(number | string) & Tag"), "{ts_i}");
    assert_eq!(DefaultSyntaxFirewall.verify(&ts_i, Path::new("i.ts"), LanguageId::TypeScript), FirewallVerdict::Valid);
}

#[test]
fn iter11_multiline_comments_and_aice_cf_branch_match_arms_roundtrip() {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let ml_cases: &[(LanguageId, &str, &str, &[&str])] = &[
        (LanguageId::TypeScript, "ml.ts", "/* lead1\nlead2 */\nexport const x = 1; /* tail1\ntail2 */\n", &["lead1", "lead2", "tail1", "tail2"]),
        (LanguageId::Css, "ml.css", "/* css\nmulti */\n.a {\n  color: red; /* c_tail */\n}\n", &["css", "multi", "c_tail"]),
        (LanguageId::Rust, "ml.rs", "/* rs_l1\nrs_l2 */\npub fn f() -> i64 { 1 }\n", &["rs_l1", "rs_l2"]),
        (LanguageId::Html, "ml.html", "<!-- html_lead1\nhtml_lead2 -->\n<div>hi</div>\n", &["html_lead1", "html_lead2"]),
        (LanguageId::Xml, "ml.xml", "<!-- x1\nx2 -->\n<root><item>1</item></root>\n", &["x1", "x2"]),
    ];
    for (lang, vpath, src, markers) in ml_cases {
        let tree = reg.adapter(*lang).unwrap().parse_cst(src).unwrap();
        let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else { panic!(); };
        let aice = print_aice(&m);
        for mk in *markers {
            assert!(aice.contains(mk), "{lang:?} missing {mk:?} in:\n{aice}");
        }
        let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("{lang:?} parse_aice failed: {e}\n{aice}"));
        let nat = tr.to_native(&reparsed, *lang).unwrap();
        assert_eq!(fw.verify(&nat, Path::new(vpath), *lang), FirewallVerdict::Valid, "{nat}");
    }

    let mut sc_mod = AiceModule::new(LanguageId::Aice, "sc");
    sc_mod.items.push(AiceItem::Fn(FnDecl {
        vis: Visibility::Public, is_async: false, is_static: false, decorators: Vec::new(),
        name: "f".into(), type_params: Vec::new(), params: Vec::new(), return_type: None,
        body: FnBody::Block(vec![Stmt::Comment(Trivia {
            leading: vec![TriviaComment { kind: TriviaKind::Line, text: "ld1\nld2".into() }],
            trailing: Some("sc_line1\nsc_line2".into()),
            blank_lines_before: 0,
        })]),
        trivia: Trivia::default(), span: Span::empty(),
    }));
    let sc_aice = print_aice(&sc_mod);
    assert!(sc_aice.contains("# ld1\n  # ld2") && sc_aice.contains("# sc_line1\n  # sc_line2"), "{sc_aice}");
    assert!(parse_aice(&sc_aice).is_ok(), "Stmt::Comment multi-line broke parse_aice:\n{sc_aice}");
    let sc_nodocs = print_aice_with_opts(&sc_mod, &TranspileOpts { compact: true, include_types: true, preserve_docs: false });
    assert!(!sc_nodocs.contains("sc_line1"), "{sc_nodocs}");

    let cf_aice = "\
module cf_all
pub fn flow(x: int) -> int:
  if x > 0: # if_tail
    ret 1
  elif x == 0: # elif_tail
    ret 0
  else: # else_tail
    ret -1
  try: # try_tail
    throw \"boom\"
  catch e: # catch_tail
    ret -2
  finally: # finally_tail
    pass
  match x: # match_tail
    1 => 2 # arm_tail
    2 => { ret 3 } # arm_blk_tail
    _ => pass # arm_pass_tail
";
    let p1 = parse_aice(cf_aice).unwrap();
    let out1 = print_aice(&p1);
    for mk in ["if_tail", "elif_tail", "else_tail", "try_tail", "catch_tail", "finally_tail", "match_tail", "arm_tail", "arm_blk_tail", "arm_pass_tail"] {
        assert!(out1.contains(mk), "missing {mk} in:\n{out1}");
    }
    let out2 = print_aice(&parse_aice(&out1).unwrap());
    assert_eq!(out1, out2);
}

#[test]
fn iter11_native_trailing_comments_xml_sql_prisma_gql_py_rust() {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let cases = [
        (LanguageId::Xml, "t.xml", "<root><item>1</item> <!-- xml_tail --></root>\n", "xml_tail"),
        (LanguageId::AnsiSql, "t1.sql", "CREATE TABLE t (id INT); -- sql_tbl_tail\n", "sql_tbl_tail"),
        (LanguageId::AnsiSql, "t2.sql", "CREATE TABLE t (\n  id INT -- sql_col_tail\n);\n", "sql_col_tail"),
        (LanguageId::PostgreSql, "p1.sql", "SELECT 1; -- pg_sel_tail\n", "pg_sel_tail"),
        (LanguageId::PostgreSql, "p2.sql", "SELECT 1; /* pg_blk_tail */\n", "pg_blk_tail"),
        (LanguageId::Prisma, "s.prisma", "model User {\n  id Int @id // prisma_field_tail\n}\n", "prisma_field_tail"),
        (LanguageId::GraphQl, "s.graphql", "type User {\n  id: ID! # gql_field_tail\n}\n", "gql_field_tail"),
        (LanguageId::Python, "w.py", "def f(x, items):\n    while x > 0: # py_while_tail\n        x -= 1\n    for i in items: # py_for_tail\n        x += i\n", "py_while_tail"),
        (LanguageId::Python, "f.py", "def f(x, items):\n    for i in items: # py_for_tail\n        x += i\n", "py_for_tail"),
        (LanguageId::Rust, "m.rs", "pub fn f(x: i64) -> i64 {\n    match x { // rs_match_tail\n        1 => 2,\n        _ => 3,\n    }\n}\n", "rs_match_tail"),
    ];
    for (lang, vpath, src, marker) in cases {
        let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
        let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap() else { panic!(); };
        let aice = print_aice(&m);
        assert_eq!(aice.matches(marker).count(), 1, "{lang:?} expected 1 occurrence of {marker:?} in:\n{aice}");
        let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("{lang:?}: {e}\n{aice}"));
        let nat = tr.to_native(&reparsed, lang).unwrap();
        assert_eq!(fw.verify(&nat, Path::new(vpath), lang), FirewallVerdict::Valid, "{lang:?}:\n{nat}");
        let nodocs = print_aice_with_opts(&m, &TranspileOpts { compact: true, include_types: true, preserve_docs: false });
        assert!(!nodocs.contains(marker), "{lang:?} leaked {marker:?} when preserve_docs=false:\n{nodocs}");
    }
}
