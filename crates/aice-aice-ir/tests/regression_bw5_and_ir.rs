use std::path::Path;
use std::sync::mpsc;
use std::thread;
use std::time::Duration;

use aice_aice_ir::hybrid_lower::lower_hybrid_sigils_for;
use aice_aice_ir::lexer::lex;
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_lex_err_bounded(input: &'static str) {
    let (tx, rx) = mpsc::channel();
    thread::spawn(move || {
        let _ = tx.send(lex(input));
    });
    let res = rx
        .recv_timeout(Duration::from_secs(1))
        .unwrap_or_else(|_| panic!("lex hung (>1s) on input: {input:?}"));
    assert!(res.is_err(), "expected Err on {input:?}, got {res:?}");
}

#[test]
fn group_a_lexer_terminates_on_non_ascii_symbols() {
    assert_lex_err_bounded("🚀");
    assert_lex_err_bounded("x := 1 — 2");
    assert_lex_err_bounded("•");
    let ok = lex("café := \"🚀 — ok\"\n");
    assert!(ok.is_ok(), "non-ASCII alphabetic ident & string should lex: {ok:?}");
}

#[test]
fn group_a_expr_match_and_block_closure_roundtrip() {
    let aice = "module cf\npub fn demo(x:int) -> int:\n  y := match x:\n    0 => 1\n    _ => 2\n  g := fn(b:int) -> int {\n    if b > 0:\n      ret b\n    ret 0\n  }\n  ret y + g(x)\n";
    let parsed = parse_aice(aice).expect("parse initial");
    let printed = print_aice(&parsed);
    assert!(!printed.contains("pass;"), "closure dropped if to pass:\n{printed}");
    let reparsed = parse_aice(&printed).unwrap_or_else(|e| panic!("reparse failed: {e}\n{printed}"));

    let transpiler = DefaultAiceTranspiler;
    let ts_out = transpiler.to_native(&reparsed, LanguageId::TypeScript).unwrap();
    assert!(!ts_out.contains("=> null"), "TS closure compiled to null:\n{ts_out}");
    assert!(ts_out.contains("if (b > 0)"), "TS closure lost if:\n{ts_out}");
    assert!(ts_out.contains("case 0:") && ts_out.contains("default:"), "TS match lost cases:\n{ts_out}");
    let fw = DefaultSyntaxFirewall;
    assert_eq!(fw.verify(&ts_out, Path::new("demo.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts_out}");

    let rs_out = transpiler.to_native(&reparsed, LanguageId::Rust).unwrap();
    assert!(rs_out.contains("0 => 1") && rs_out.contains("_ => 2"), "Rust match lost arms:\n{rs_out}");
    assert_eq!(fw.verify(&rs_out, Path::new("demo.rs"), LanguageId::Rust), FirewallVerdict::Valid, "{rs_out}");
}

#[test]
fn group_a_rust_try_and_multi_lang_match_compile_valid() {
    let aice = r#"module cf
pub fn handle(x:int) -> int:
  try:
    if x < 0:
      ret -1
  catch err:
    ret -2
  finally:
    pass
  match x:
    0 => 10
    _ => 20
  ret x
"#;
    let parsed = parse_aice(aice).expect("parse cf");
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    for (lang, path) in [
        (LanguageId::Rust, "cf.rs"),
        (LanguageId::TypeScript, "cf.ts"),
        (LanguageId::Kotlin, "cf.kt"),
        (LanguageId::Go, "cf.go"),
        (LanguageId::Ruby, "cf.rb"),
    ] {
        let native = transpiler.to_native(&parsed, lang).unwrap();
        assert_eq!(
            fw.verify(&native, Path::new(path), lang),
            FirewallVerdict::Valid,
            "Firewall failed for {lang:?}:\n{native}"
        );
        if lang == LanguageId::Rust {
            assert!(!native.contains("catch (err)"), "Rust emitted JS try/catch:\n{native}");
            assert!(native.contains("0 => 10"), "Rust match collapsed arm:\n{native}");
        }
    }
}

#[test]
fn group_a_css_url_and_keyframes_roundtrip() {
    let css = "body {\n  background-image: url(https://example.com/a.png);\n  content: \"hello\";\n}\n@keyframes pulse {\n  0% { opacity: 0.4; }\n  100% { opacity: 1; }\n}\n";
    let reg = EngineRegistry::default();
    let tree = reg.adapter(LanguageId::Css).unwrap().parse_cst(css).unwrap();
    let TranspileOutcome::Transpiled(m) = DefaultAiceTranspiler.to_aice(&tree, css, &TranspileOpts::default()).unwrap() else { panic!() };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice css: {e}\n{aice}"));
    let native = DefaultAiceTranspiler.to_native(&reparsed, LanguageId::Css).unwrap();
    assert!(native.contains("url(https://example.com/a.png)"), "CSS url truncated:\n{native}");
    assert!(native.contains("0%") && native.contains("100%"), "CSS keyframes lost selectors:\n{native}");
    assert!(!native.contains("* {"), "CSS keyframes fell back to *:\n{native}");
    assert_eq!(DefaultSyntaxFirewall.verify(&native, Path::new("s.css"), LanguageId::Css), FirewallVerdict::Valid, "{native}");
}

#[test]
fn group_b_bw5_guards_prevent_double_let_ident_corruption_and_cpp_arrow() {
    let rs = lower_hybrid_sigils_for("let y := std::cmp::min(1, 2);", LanguageId::Rust);
    assert_eq!(rs, "let y = std::cmp::min(1, 2);");

    let go = lower_hybrid_sigils_for("ret := \"ok\"; pub := 1;", LanguageId::Go);
    assert!(go.contains("ret := \"ok\"") && go.contains("pub := 1"), "Go corrupted: {go}");

    let ts = lower_hybrid_sigils_for(
        "ret = 5; ret += 1; return obj.fn(); export const pub = 1; A::fn();",
        LanguageId::TypeScript,
    );
    assert!(ts.contains("ret = 5;"), "TS ret= corrupted: {ts}");
    assert!(ts.contains("ret += 1;"), "TS ret+= corrupted: {ts}");
    assert!(ts.contains("obj.fn()"), "TS obj.fn corrupted: {ts}");
    assert!(ts.contains("export const pub = 1;"), "TS pub var corrupted: {ts}");
    assert!(ts.contains("A::fn()"), "TS A::fn corrupted: {ts}");

    let cpp = lower_hybrid_sigils_for("fn foo(x: :#) -> MyVec { <- x; }", LanguageId::Cpp);
    assert!(cpp.contains("MyVec foo(double x)"), "C++ header corrupted: {cpp}");
    assert!(!cpp.contains("-> MyVec"), "C++ arrow left behind: {cpp}");

    // Item 16: Typed `:=` declarations and binary infix `ret` guards
    assert_eq!(lower_hybrid_sigils_for("let y: i32 := 1;", LanguageId::Rust), "let y: i32 = 1;");
    assert_eq!(lower_hybrid_sigils_for("let y: :i := 1;", LanguageId::Rust), "let y: i64 = 1;");
    assert_eq!(lower_hybrid_sigils_for("const x: number := 1;", LanguageId::TypeScript), "const x: number = 1;");
    assert_eq!(lower_hybrid_sigils_for("val x: Int := 1", LanguageId::Kotlin), "val x: Int = 1");

    for op in ["<<", ">>", "!=", "<=", ">=", "&&", "||", "<", ">", "+", "-", "*", "/", "%", "&", "|", "^"] {
        let src = format!("ret {op} 1;");
        let out = lower_hybrid_sigils_for(&src, LanguageId::TypeScript);
        assert_eq!(out, src, "B-W5 corrupted binary infix ret with '{op}': {out}");
    }
    assert_eq!(lower_hybrid_sigils_for("ret -1;", LanguageId::Rust), "return -1;");
    assert_eq!(lower_hybrid_sigils_for("ret *p;", LanguageId::Rust), "return *p;");
    assert_eq!(lower_hybrid_sigils_for("ret &x;", LanguageId::Rust), "return &x;");
    let rs_fn = lower_hybrid_sigils_for("fn check(ret: :i) -> bool {\n  ret > 0\n}\nfn mask(ret: :i) -> :i {\n  ret & 255\n}\n", LanguageId::Rust);
    assert!(rs_fn.contains("  ret > 0\n") && rs_fn.contains("  ret & 255\n"), "B-W5 corrupted ret ident:\n{rs_fn}");

    // Item 6: ** exponentiation vs C/C++ double-pointer deref
    for lang in [LanguageId::Python, LanguageId::TypeScript, LanguageId::JavaScript, LanguageId::Ruby] {
        assert_eq!(lower_hybrid_sigils_for("ret ** 2", lang), "ret ** 2");
        assert_eq!(lower_hybrid_sigils_for("ret **2", lang), "ret **2");
        assert_eq!(lower_hybrid_sigils_for("ret **= 2", lang), "ret **= 2");
    }
    assert_eq!(lower_hybrid_sigils_for("ret **p;", LanguageId::C), "return **p;");
    assert_eq!(lower_hybrid_sigils_for("ret **p;", LanguageId::Cpp), "return **p;");
}

#[test]
fn group_a_block_closure_and_expr_match_all_code_langs() {
    let aice = "module mx\npub fn demo(x:int) -> int:\n  y := match x:\n    0 => 10\n    1 => 20\n    _ => 30\n  g := fn(b:int) -> int {\n    if b > 0:\n      ret b\n    ret 0\n  }\n  arr := [1, 2, 3]\n  for i in arr:\n    y += i\n  ret y + g(x)\n";
    let parsed = parse_aice(aice).expect("parse mx");
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let langs = [
        (LanguageId::Rust, "mx.rs"),
        (LanguageId::TypeScript, "mx.ts"),
        (LanguageId::Tsx, "mx.tsx"),
        (LanguageId::JavaScript, "mx.js"),
        (LanguageId::Python, "mx.py"),
        (LanguageId::Go, "mx.go"),
        (LanguageId::CSharp, "mx.cs"),
        (LanguageId::Java, "Mx.java"),
        (LanguageId::Kotlin, "mx.kt"),
        (LanguageId::Dart, "mx.dart"),
        (LanguageId::Php, "mx.php"),
        (LanguageId::Ruby, "mx.rb"),
        (LanguageId::Cpp, "mx.cpp"),
    ];
    for (lang, vpath) in langs {
        let native = transpiler.to_native(&parsed, lang).unwrap();
        assert_eq!(
            fw.verify(&native, Path::new(vpath), lang),
            FirewallVerdict::Valid,
            "Firewall rejected {lang:?}:\n{native}"
        );
        assert!(
            native.contains("10") && native.contains("20") && native.contains("30"),
            "{lang:?} dropped Expr::Match arm values:\n{native}"
        );
        match lang {
            LanguageId::Ruby => {
                assert!(native.contains("->(b) {") && !native.contains("{ {"), "Ruby closure invalid:\n{native}");
            }
            LanguageId::Python => {
                assert!(native.contains("b if b > 0 else 0"), "Python closure collapsed:\n{native}");
            }
            LanguageId::Go => {
                assert!(native.contains("[]any{1, 2, 3}"), "Go slice literal invalid:\n{native}");
            }
            LanguageId::Dart => {
                assert!(native.contains("for (var i in arr)"), "Dart for..in invalid:\n{native}");
            }
            LanguageId::Java => {
                assert!(native.contains("class Mx") && native.contains("demo("), "Java dropped top-level fn:\n{native}");
            }
            _ => {}
        }
    }
}

#[test]
fn group_a_subjectless_when_and_dart_arrow_closure_all_targets() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let kt_src = "fun classify(n: Int): Int {\n  when {\n    n < 0 -> return -1\n    n == 0 -> return 0\n    else -> return 1\n  }\n}\n";
    let kt_tree = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt_src).unwrap();
    let TranspileOutcome::Transpiled(m) = transpiler.to_aice(&kt_tree, kt_src, &TranspileOpts::default()).unwrap() else { panic!() };
    let aice = print_aice(&m);
    assert!(!aice.contains("\"return -1\""), "Kotlin jump_expression leaked as Ident:\n{aice}");
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| panic!("parse_aice kt: {e}\n{aice}"));

    for (lang, vpath) in [
        (LanguageId::Rust, "c.rs"),
        (LanguageId::TypeScript, "c.ts"),
        (LanguageId::Tsx, "c.tsx"),
        (LanguageId::JavaScript, "c.js"),
        (LanguageId::Python, "c.py"),
        (LanguageId::Go, "c.go"),
        (LanguageId::CSharp, "c.cs"),
        (LanguageId::Java, "C.java"),
        (LanguageId::Kotlin, "c.kt"),
        (LanguageId::Dart, "c.dart"),
        (LanguageId::Php, "c.php"),
        (LanguageId::Ruby, "c.rb"),
        (LanguageId::Cpp, "c.cpp"),
    ] {
        let native = transpiler.to_native(&reparsed, lang).unwrap();
        assert_eq!(fw.verify(&native, Path::new(vpath), lang), FirewallVerdict::Valid, "Firewall rejected {lang:?}:\n{native}");
        assert!(!native.contains("switch (true)") && !native.contains("case true") && !native.contains("$return"), "{lang:?} emitted invalid subjectless match:\n{native}");
        assert!(native.contains("< 0") && native.contains("== 0"), "{lang:?} dropped conditions:\n{native}");
    }

    let dart_aice = "module dt\npub fn demo(x:int) -> int:\n  g := fn(b:int) -> int => b + 1\n  ret g(x)\n";
    let dart_mod = parse_aice(dart_aice).unwrap();
    let dart_native = transpiler.to_native(&dart_mod, LanguageId::Dart).unwrap();
    assert!(dart_native.contains("=> b + 1"), "Dart arrow closure missing '=>':\n{dart_native}");
    assert_eq!(fw.verify(&dart_native, Path::new("dt.dart"), LanguageId::Dart), FirewallVerdict::Valid, "{dart_native}");

    let prec_aice = "module pr\npub fn f(seq:int) -> int = *seq as int\n";
    let prec_mod = parse_aice(prec_aice).unwrap();
    if let aice_aice_ir::ir::AiceItem::Fn(fd) = &prec_mod.items[0]
        && let aice_aice_ir::ir_code::FnBody::Expr(aice_aice_ir::ir_code::Expr::Binary { op, left, .. }) = &fd.body
    {
        assert_eq!(*op, aice_aice_ir::ir_code::BinaryOp::As);
        assert!(matches!(left.as_ref(), aice_aice_ir::ir_code::Expr::Unary { op: aice_aice_ir::ir_code::UnaryOp::Deref, .. }));
    } else {
        panic!("Unexpected AST for *seq as int: {:?}", prec_mod.items);
    }
}
