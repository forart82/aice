use aice_aice_ir::hybrid_lower::{lower_hybrid_sigils, lower_hybrid_sigils_for};
use aice_lang_registry::LanguageId;

#[test]
fn bw5_go_channels_and_string_literals_preserved() {
    let go_src = r#"package events

func DrainEvents(ch <-chan string, fallback string) string {
    marker := "ret <-chan literal must stay intact"
    select {
    case msg := <-ch:
        return msg + ":" + marker
    default:
        return fallback
    }
}
"#;
    let out = lower_hybrid_sigils_for(go_src, LanguageId::Go);
    assert!(out.contains("ch <-chan string"), "corrupted channel type: {out}");
    assert!(out.contains("case msg := <-ch:"), "corrupted channel receive: {out}");
    assert!(
        out.contains("\"ret <-chan literal must stay intact\""),
        "corrupted string literal: {out}"
    );
}

#[test]
fn bw5_php_arrow_fn_preserved_while_named_fn_lowers() {
    let src = "pub fn add($a: :#, $b: :#) -> :# { <- $a + $b }\n$inc = fn($x) => $x + 1;\n";
    let out = lower_hybrid_sigils_for(src, LanguageId::Php);
    assert!(out.contains("public function add(float $a, float $b): float"), "got: {out}");
    assert!(out.contains("return $a + $b"), "got: {out}");
    assert!(out.contains("fn($x) => $x + 1"), "corrupted PHP arrow fn: {out}");
}

#[test]
fn bw5_js_template_with_regex_and_comment_preserved() {
    let src = r#"export const check = (s: string) => `res: ${ /don't/.test(s) && /}/g.test(s) && /* } */ true }`;"#;
    let out = lower_hybrid_sigils(src);
    assert_eq!(out, src);
}

#[test]
fn bw5_rust_raw_strings_lifetimes_and_nested_comments() {
    let src = "/* /* ret <- pub fn */ */\npub fn calc<'a>(s: &'a str, x: :#) -> :# {\n  let raw = r#\"ret <- pub fn\"#;\n  <- std::cmp::min(1, 2) as f64 + x\n}\n";
    let out = lower_hybrid_sigils_for(src, LanguageId::Rust);
    assert!(out.contains("/* /* ret <- pub fn */ */"), "nested comment changed: {out}");
    assert!(out.contains("<'a>(s: &'a str, x: f64) -> f64"), "lifetime or type broken: {out}");
    assert!(out.contains("r#\"ret <- pub fn\"#"), "raw string changed: {out}");
    assert!(out.contains("std::cmp::min"), "path broken: {out}");
    assert!(out.contains("return std::cmp::min"), "return missing: {out}");
}

#[test]
fn bw5_cpp_csharp_python_dart_literals_and_sigils() {
    let cpp = "pub fn sum(xs: [#]) -> :# { auto n = 1'000'000; auto r = R\"raw(ret <-)raw\"; <- xs[0]; }";
    let cpp_out = lower_hybrid_sigils_for(cpp, LanguageId::Cpp);
    assert!(cpp_out.contains("double sum(std::vector<double> xs)"), "cpp: {cpp_out}");
    assert!(cpp_out.contains("1'000'000"), "cpp digit sep: {cpp_out}");
    assert!(cpp_out.contains("R\"raw(ret <-)raw\""), "cpp raw str: {cpp_out}");
    assert!(cpp_out.contains("return xs[0];"), "cpp ret: {cpp_out}");

    let cs = "pub fn reset(x: :#) { var a = @\"ret \"\" <-\"; var b = $\"\"\"{x}\"\"\"; <-; }";
    let cs_out = lower_hybrid_sigils_for(cs, LanguageId::CSharp);
    assert!(cs_out.contains("public void reset(double x)"), "cs: {cs_out}");
    assert!(cs_out.contains("@\"ret \"\" <-\""), "cs verbatim: {cs_out}");
    assert!(cs_out.contains("$\"\"\"{x}\"\"\""), "cs raw interp: {cs_out}");

    let py = "fn f(x: :#) -> :#:\n  s = r\"ret\\n\"\n  t = \"\"\"ret <-\"\"\"\n  <- x\n";
    let py_out = lower_hybrid_sigils_for(py, LanguageId::Python);
    assert!(py_out.contains("def f(x: float) -> float:"), "py: {py_out}");
    assert!(py_out.contains("r\"ret\\n\""), "py raw: {py_out}");
    assert!(py_out.contains("\"\"\"ret <-\"\"\""), "py triple: {py_out}");

    let dart = "fn g(x: :$) -> :$ { final s = r'ret <-'; <- s; }";
    let dart_out = lower_hybrid_sigils_for(dart, LanguageId::Dart);
    assert!(dart_out.contains("String g(String x)"), "dart: {dart_out}");
    assert!(dart_out.contains("r'ret <-'"), "dart raw: {dart_out}");
}
