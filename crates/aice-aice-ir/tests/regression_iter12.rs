use std::path::Path;

use aice_aice_ir::ir::{
    AiceItem, AiceModule, AiceType, ComponentDecl, FieldDecl, FieldSigil, FnBody, FnDecl,
    LayoutNode, ParamDecl, Span, TranspileOpts, Trivia, TypeDecl, TypeKind,
    Visibility,
};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::{print_aice, print_aice_with_opts};
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn to_aice_str(lang: LanguageId, src: &str, opts: &TranspileOpts) -> (AiceModule, String) {
    let tree = EngineRegistry::default().adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, src, opts).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let s = print_aice_with_opts(&m, opts);
    (m, s)
}

#[test]
fn iter12_python_if_elif_else_preserves_branches_and_comments() {
    let py_comments = "\
def f(x):
    if x > 0: # if_t
        y = 1
    elif x == 0: # elif_t
        y = 2
    else: # else_t
        y = 3
    return y
";
    let (m, aice) = to_aice_str(LanguageId::Python, py_comments, &TranspileOpts::default());
    assert!(aice.contains("y = 3"), "lost else body in:\n{aice}");
    assert_eq!(aice.matches("# if_t").count(), 1, "{aice}");
    assert_eq!(aice.matches("# elif_t").count(), 1, "{aice}");
    assert_eq!(aice.matches("# else_t").count(), 1, "{aice}");
    let after_else = aice.split("else:").nth(1).expect("missing else:");
    assert!(!after_else.contains("x == 0"), "elif leaked into else:\n{aice}");
    let reparsed = parse_aice(&aice).unwrap();
    let nat = DefaultAiceTranspiler.to_native(&reparsed, LanguageId::Python).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&nat, Path::new("f.py"), LanguageId::Python), FirewallVerdict::Valid, "{nat}");
    let nodocs = print_aice_with_opts(&m, &TranspileOpts { compact: true, include_types: true, preserve_docs: false });
    assert!(!nodocs.contains("if_t") && !nodocs.contains("elif_t") && !nodocs.contains("else_t"), "{nodocs}");

    let py_plain = "def g(x):\n    if x > 0:\n        return 1\n    elif x == 0:\n        return 0\n    else:\n        return -1\n";
    let (_, plain_aice) = to_aice_str(LanguageId::Python, py_plain, &TranspileOpts::default());
    assert!(plain_aice.contains("ret -1") && !plain_aice.split("else:").nth(1).unwrap().contains("x == 0"), "{plain_aice}");
}

#[test]
fn iter12_consecutive_siblings_no_trailing_comment_duplication() {
    let cases: &[(LanguageId, &str, &str, &[&str])] = &[
        (LanguageId::TypeScript, "c.ts", "export const a = 1; // t_first\nexport const b = 2; // t_second\n", &["t_first", "t_second"]),
        (LanguageId::Rust, "c.rs", "pub fn f(x: i64) -> i64 {\n    match x {\n        1 => 2, // arm_a\n        _ => 3, // arm_b\n    }\n}\n", &["arm_a", "arm_b"]),
        (LanguageId::Python, "c.py", "a = 1 # py_a\nb = 2 # py_b\n", &["py_a", "py_b"]),
        (LanguageId::Go, "c.go", "package main\nfunc f() int {\n\ta := 1 // go_a\n\tb := 2 // go_b\n\treturn a + b\n}\n", &["go_a", "go_b"]),
        (LanguageId::Css, "c.css", ".a {\n  color: red; /* css_a */\n  margin: 0; /* css_b */\n}\n", &["css_a", "css_b"]),
        (LanguageId::Yaml, "c.yaml", "a: 1 # y_a\nb: 2 # y_b\n", &["y_a", "y_b"]),
        (LanguageId::Xml, "c.xml", "<root>\n  <a/> <!-- xml_a_tail -->\n  <b/> <!-- xml_b_tail -->\n</root>\n", &["xml_a_tail", "xml_b_tail"]),
        (LanguageId::Html, "c.html", "<div>a</div> <!-- h_a -->\n<div>b</div> <!-- h_b -->\n", &["h_a", "h_b"]),
        (LanguageId::Prisma, "c.prisma", "model User {\n  id Int @id // pr_a\n  name String // pr_b\n}\n", &["pr_a", "pr_b"]),
        (LanguageId::GraphQl, "c.graphql", "type User {\n  id: ID! # g_a\n  name: String # g_b\n}\n", &["g_a", "g_b"]),
        (LanguageId::AnsiSql, "c1.sql", "SELECT 1; -- sq_a\nSELECT 2; -- sq_b\n", &["sq_a", "sq_b"]),
        (LanguageId::AnsiSql, "c2.sql", "CREATE TABLE t (\n  id INT, -- col_a\n  name TEXT -- col_b\n);\n", &["col_a", "col_b"]),
        (LanguageId::Bash, "c.sh", "A=1 # sh_a\nB=2 # sh_b\n", &["sh_a", "sh_b"]),
    ];
    for (lang, vpath, src, markers) in cases {
        let (m, aice) = to_aice_str(*lang, src, &TranspileOpts::default());
        for mk in *markers {
            assert_eq!(aice.matches(mk).count(), 1, "{lang:?} expected count 1 for {mk:?}:\n{aice}");
        }
        let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("{lang:?}: {e}\n{aice}"));
        let nat = DefaultAiceTranspiler.to_native(&reparsed, *lang).unwrap();
        assert_eq!(DefaultSyntaxFirewall.verify(&nat, Path::new(vpath), *lang), FirewallVerdict::Valid, "{lang:?}:\n{nat}");
        let nodocs = print_aice_with_opts(&m, &TranspileOpts { compact: true, include_types: true, preserve_docs: false });
        for mk in *markers {
            assert!(!nodocs.contains(mk), "{lang:?} leaked {mk:?} when preserve_docs=false:\n{nodocs}");
        }
    }
}

#[test]
fn iter12_graphql_enum_comments_and_rd_sql_multiline_and_col_comments() {
    let gql = "enum Role {\n  ADMIN # gql_enum_tail\n  USER # gql_enum_user\n}\n";
    let (gm, gaice) = to_aice_str(LanguageId::GraphQl, gql, &TranspileOpts::default());
    assert!(gaice.contains("ADMIN # gql_enum_tail"), "{gaice}");
    assert!(!gaice.contains("field \"# gql_enum_tail\""), "phantom comment field:\n{gaice}");
    assert_eq!(gaice.matches("gql_enum_tail").count(), 1, "{gaice}");
    assert_eq!(gaice.matches("gql_enum_user").count(), 1, "{gaice}");
    let g_nodocs = print_aice_with_opts(&gm, &TranspileOpts { compact: true, include_types: true, preserve_docs: false });
    assert!(!g_nodocs.contains("gql_enum_tail"), "{g_nodocs}");
    let g_nat = DefaultAiceTranspiler.to_native(&parse_aice(&gaice).unwrap(), LanguageId::GraphQl).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&g_nat, Path::new("r.graphql"), LanguageId::GraphQl), FirewallVerdict::Valid, "{g_nat}");

    let pg_ml = "/* pg1\npg2 */\nSELECT 1; /* pg3\npg4 */\n";
    let (_, pg_aice) = to_aice_str(LanguageId::PostgreSql, pg_ml, &TranspileOpts::default());
    assert!(pg_aice.contains("query \"postgresql\" \"select\":"), "misclassified SELECT:\n{pg_aice}");
    assert!(!pg_aice.contains("ddl:"), "phantom ddl item:\n{pg_aice}");
    for mk in ["pg1", "pg2", "pg3", "pg4"] {
        assert_eq!(pg_aice.matches(mk).count(), 1, "expected 1 {mk} in:\n{pg_aice}");
    }
    let nodocs_opts = TranspileOpts { compact: true, include_types: true, preserve_docs: false };
    let (_, pg_nodocs) = to_aice_str(LanguageId::PostgreSql, pg_ml, &nodocs_opts);
    assert!(pg_nodocs.contains("query \"postgresql\" \"select\":"), "{pg_nodocs}");
    assert!(!pg_nodocs.contains("pg1") && !pg_nodocs.contains("pg3") && !pg_nodocs.contains("ddl:"), "{pg_nodocs}");

    let pg_cols = "CREATE TABLE t (\n  id INT, -- pg_col_1\n  name TEXT /* pg_col_2 */\n);\n";
    let (_, col_aice) = to_aice_str(LanguageId::PostgreSql, pg_cols, &TranspileOpts::default());
    assert_eq!(col_aice.matches("pg_col_1").count(), 1, "{col_aice}");
    assert_eq!(col_aice.matches("pg_col_2").count(), 1, "{col_aice}");
    let (_, col_nodocs) = to_aice_str(LanguageId::PostgreSql, pg_cols, &nodocs_opts);
    assert!(!col_nodocs.contains("pg_col_1") && !col_nodocs.contains("pg_col_2"), "{col_nodocs}");
    let my_cols = "CREATE TABLE t (\n  id INT # my_col_1\n);\n";
    let (_, my_aice) = to_aice_str(LanguageId::MySql, my_cols, &TranspileOpts::default());
    assert_eq!(my_aice.matches("my_col_1").count(), 1, "{my_aice}");
}

#[test]
fn iter12_cpp_try_finally_c_restrict_layout_cr_and_cpp_default_param() {
    let aice_try = "module cf\npub fn f(x: int) -> int:\n  try:\n    ret 1\n  catch e:\n    ret -2\n  finally: # before_finally\n    x = 0\n";
    let cpp = DefaultAiceTranspiler.to_native(&parse_aice(aice_try).unwrap(), LanguageId::Cpp).unwrap();
    assert!(!cpp.contains("} finally {"), "invalid C++ finally:\n{cpp}");
    assert_eq!(DefaultSyntaxFirewall.verify(&cpp, Path::new("cf.cpp"), LanguageId::Cpp), FirewallVerdict::Valid, "{cpp}");

    let mut cm = AiceModule::new(LanguageId::Aice, "c_rest");
    let bad = ["restrict int", "restrict char", "restrict int*", "restrict char*", "restrict struct Foo", "restrict void*"];
    cm.items.push(AiceItem::Type(TypeDecl {
        vis: Visibility::Public, kind: TypeKind::Struct, name: "S".into(),
        type_params: Vec::new(), extends: Vec::new(), alias_target: None,
        fields: vec![
            FieldDecl { name: "f0".into(), vis: Visibility::Public, is_readonly: false, is_optional: false, sigil: FieldSigil::None, ty: Some(AiceType::Raw("restrict int".into())), default: None, trivia: Trivia::default() },
            FieldDecl { name: "f1".into(), vis: Visibility::Public, is_readonly: false, is_optional: false, sigil: FieldSigil::None, ty: Some(AiceType::Raw("const restrict void".into())), default: None, trivia: Trivia::default() },
        ],
        methods: Vec::new(), trivia: Trivia::default(), span: Span::empty(),
    }));
    for (idx, raw) in bad.iter().enumerate() {
        cm.items.push(AiceItem::Fn(FnDecl {
            vis: Visibility::Public, is_async: false, is_static: false, decorators: Vec::new(),
            name: format!("p{idx}"), type_params: Vec::new(),
            params: vec![ParamDecl { name: "x".into(), vis: Visibility::Default, is_readonly: false, is_mut: false, is_optional: false, is_rest: false, ty: Some(AiceType::Raw((*raw).into())), default: None, trivia: Trivia::default() }],
            return_type: Some(AiceType::Raw("const volatile restrict void".into())),
            body: FnBody::Block(Vec::new()), trivia: Trivia::default(), span: Span::empty(),
        }));
    }
    let c_out = DefaultAiceTranspiler.to_native(&cm, LanguageId::C).unwrap();
    assert!(!c_out.contains("restrict"), "leaked restrict:\n{c_out}");
    assert!(c_out.contains("const void* f1;") && c_out.contains("const volatile void p0("), "{c_out}");
    assert_eq!(DefaultSyntaxFirewall.verify(&c_out, Path::new("r.c"), LanguageId::C), FirewallVerdict::Valid, "{c_out}");

    let c_real = "void copy_val(int* restrict dst, const int* restrict src) { *dst = *src; }\n";
    let (_, c_real_aice) = to_aice_str(LanguageId::C, c_real, &TranspileOpts::default());
    let c_real_nat = DefaultAiceTranspiler.to_native(&parse_aice(&c_real_aice).unwrap(), LanguageId::C).unwrap();
    assert_eq!(DefaultSyntaxFirewall.verify(&c_real_nat, Path::new("cv.c"), LanguageId::C), FirewallVerdict::Valid, "{c_real_nat}");

    let mut lm = AiceModule::new(LanguageId::Aice, "lc");
    lm.items.push(AiceItem::Component(ComponentDecl {
        vis: Visibility::Public, name: "Page".into(), type_params: Vec::new(), params: Vec::new(),
        has_doctype: false, body_stmts: Vec::new(),
        layout: vec![LayoutNode::Comment("h_c1\r\n\nh_c2\rline3".into())],
        trivia: Trivia::default(), span: Span::empty(),
    }));
    let lc_aice = print_aice(&lm);
    assert!(!lc_aice.contains('\r'), "raw CR leaked:\n{lc_aice:?}");
    assert!(lc_aice.contains("# h_c1\n  #\n  # h_c2\n  # line3"), "{lc_aice}");
    assert!(parse_aice(&lc_aice).is_ok(), "{lc_aice}");

    let cpp_def = "int inc(int x = 1) { return x + 1; }\n";
    let (_, cpp_aice) = to_aice_str(LanguageId::Cpp, cpp_def, &TranspileOpts::default());
    assert!(cpp_aice.contains("inc(x:int = 1)"), "dropped optional param:\n{cpp_aice}");
    let c_from_cpp = DefaultAiceTranspiler.to_native(&parse_aice(&cpp_aice).unwrap(), LanguageId::C).unwrap();
    assert!(c_from_cpp.contains("int inc(int x)"), "{c_from_cpp}");
}
