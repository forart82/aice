use std::path::Path;

use aice_ast_engine::{ALL_GRAMMAR_SLOTS, DefaultSyntaxFirewall, GrammarSlot, ParserPool};
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

#[test]
fn binary_nul_and_size_guards_run_even_for_plaintext() {
    let fw = DefaultSyntaxFirewall;

    assert!(!fw.verify("corrupt", Path::new("logo.png"), LanguageId::PlainText).is_valid());
    assert!(!fw.verify("corrupt", Path::new("data.bin"), LanguageId::PlainText).is_valid());
    assert!(!fw.verify("abc\0def", Path::new("notes.txt"), LanguageId::PlainText).is_valid());

    let huge = "a".repeat(2 * 1024 * 1024 + 1);
    assert!(!fw.verify(&huge, Path::new("notes.txt"), LanguageId::PlainText).is_valid());
    assert!(fw.verify("hello\nworld", Path::new("notes.txt"), LanguageId::PlainText).is_valid());
}

#[test]
fn strict_json_vs_jsonc_and_markup_supplemental_checks() {
    let fw = DefaultSyntaxFirewall;

    // Strict JSON rejects comments, trailing commas, empty, multi-root
    assert!(!fw.verify("// comment\n{\"a\": 1}", Path::new("a.json"), LanguageId::Json).is_valid());
    assert!(!fw.verify("{\"a\": 1,}", Path::new("a.json"), LanguageId::Json).is_valid());
    assert!(!fw.verify("", Path::new("a.json"), LanguageId::Json).is_valid());
    assert!(!fw.verify("{\"a\":1}{\"b\":2}", Path::new("a.json"), LanguageId::Json).is_valid());
    assert!(fw.verify("// comment\n{\"a\": 1}", Path::new("tsconfig.json"), LanguageId::Json).is_valid());
    assert!(fw.verify("// comment\n{\"a\": 1}", Path::new("a.jsonc"), LanguageId::Json).is_valid());

    // Markdown frontmatter, fences, conflict markers
    assert!(fw.verify("---\ntitle: ok\n---\n# Hi\n```rs\nfn a() {}\n```\n", Path::new("a.md"), LanguageId::Markdown).is_valid());
    assert!(!fw.verify("---\ntitle: ok\n# Missing close\n", Path::new("a.md"), LanguageId::Markdown).is_valid());
    assert!(!fw.verify("---\ntitle: [bad\n---\n# Hi\n", Path::new("a.md"), LanguageId::Markdown).is_valid());
    assert!(!fw.verify("# Hi\n```rust\nfn x() {}\n", Path::new("a.md"), LanguageId::Markdown).is_valid());
    assert!(!fw.verify("# Hi\n<<<<<<< HEAD\na\n=======\nb\n>>>>>>> main\n", Path::new("a.md"), LanguageId::Markdown).is_valid());

    // HTML void tags vs unclosed tags + <script>/<style>
    assert!(fw.verify("<div><br><img src='a.png'><hr></div>", Path::new("a.html"), LanguageId::Html).is_valid());
    assert!(!fw.verify("<div><span></div>", Path::new("a.html"), LanguageId::Html).is_valid());
    assert!(!fw.verify("<html><body><script>const x = 1;</body></html>", Path::new("a.html"), LanguageId::Html).is_valid());

    // CSS hidden MISSING token, missing semicolon, unclosed comment
    assert!(!fw.verify(".a { color: ; }", Path::new("a.css"), LanguageId::Css).is_valid());
    assert!(!fw.verify(".a {\n  color: red\n  margin: 0;\n}", Path::new("a.css"), LanguageId::Css).is_valid());
    assert!(!fw.verify(".a { color: red; /* open", Path::new("a.css"), LanguageId::Css).is_valid());
    assert!(fw.verify(".a { color: red }", Path::new("a.css"), LanguageId::Css).is_valid());

    // XML vs DTD
    assert!(fw.verify("<!ELEMENT note (to,from)>\n<!ELEMENT to (#PCDATA)>", Path::new("note.dtd"), LanguageId::Xml).is_valid());
    assert!(!fw.verify("<!ELEMENT broken (", Path::new("note.dtd"), LanguageId::Xml).is_valid());
    assert!(!fw.verify("<root><child></root>", Path::new("a.xml"), LanguageId::Xml).is_valid());

    // PHP with <?php vs tagless PhpOnly
    assert!(fw.verify("<?php function add(int $a): int { return $a + 1; }", Path::new("a.php"), LanguageId::Php).is_valid());
    assert!(fw.verify("function add(int $a): int { return $a + 1; }", Path::new("a.php"), LanguageId::Php).is_valid());
    assert!(!fw.verify("function add(int $a): int { $x = ; }", Path::new("a.php"), LanguageId::Php).is_valid());
}

#[test]
fn twig_rd_parser_handles_complex_valid_and_invalid_templates() {
    let fw = DefaultSyntaxFirewall;

    let valid_twig = r#"{# <style> unclosed comment should be ignored #}
{% extends 'base.html.twig' %}
{% block title "Dashboard" %}
{% block body %}
  {% set greeting = "hello #{ {'k': 1}['k'] } }} %}" %}
  {% set captured %}
    <div {{ attrs }} class="box">
      <{{ heading_tag }}>{{ greeting }}</{{ heading_tag }}>
    </div>
  {% endset %}
  {% if items is not empty %}
    {% for item in items %}
      <span>{{ item.name }}</span>
    {% else %}
      <span>empty</span>
    {% endfor %}
  {% elseif fallback %}
    {{ captured }}
  {% else %}
    {% verbatim %}{{ not parsed }}{% if broken %}{% endverbatim %}
  {% endif %}
{% endblock body %}
"#;
    assert!(fw.verify(valid_twig, Path::new("view.html.twig"), LanguageId::Twig).is_valid());

    let invalid_twigs = [
        "{% if ok %}<div>hi</div>",
        "{% block a %}hi{% endblock b %}",
        "{% for x %}hi{% endfor %}",
        "{{ unclosed",
        "{{ \"unclosed string }}",
        "{% if ok %}<div><span></div>{% endif %}",
        "{% if ok %}<script>const x = 1;{% endif %}",
        "<div><span></div>",
        "{% verbatim %}hello",
    ];
    for bad in invalid_twigs {
        assert!(
            !fw.verify(bad, Path::new("bad.twig"), LanguageId::Twig).is_valid(),
            "Expected Twig firewall to reject: {bad}"
        );
    }
}

#[test]
fn bw2_incremental_verification_pre_broken_files() {
    let fw = DefaultSyntaxFirewall;
    let path = Path::new("broken.ts");

    let base = "export const broken = ;\nexport function okFn(): number {\n  return 1;\n}\n";
    let valid_edit = "export const broken = ;\nexport function okFn(): number {\n  const x = 42;\n  return x;\n}\n";
    let bad_edit = "export const broken = ;\nexport function okFn(): { {{{\n";
    let fix_one_break_other = "export const broken = 1;\nexport function okFn(): { {{{\n";

    assert!(fw.verify_incremental(Some(base), valid_edit, path, LanguageId::TypeScript).is_valid());
    assert!(!fw.verify_incremental(Some(base), bad_edit, path, LanguageId::TypeScript).is_valid());
    assert!(!fw.verify_incremental(Some(base), fix_one_break_other, path, LanguageId::TypeScript).is_valid());

    // Valid edit above a pre-broken line shifts the error line down by +1 -> must stay Valid
    let base_below = "export function topOk(): number {\n  return 1;\n}\nexport const broken = ;\n";
    let valid_above = "export function topOk(): number {\n  const a = 2;\n  return a;\n}\nexport const broken = ;\n";
    assert!(fw.verify_incremental(Some(base_below), valid_above, path, LanguageId::TypeScript).is_valid());
}

#[test]
fn bw3_bw4_all_23_r5_targets_reject_balanced_brace_and_property_malformed_inputs() {
    let fw = DefaultSyntaxFirewall;

    let malformed_cases: &[(&str, LanguageId, &[&str])] = &[
        ("a.json", LanguageId::Json, &["{\"a\": }", "[1, 2, ]", "{1: 2}"]),
        ("a.yaml", LanguageId::Yaml, &["a: [1, 2\nb: 3", "a: \"unclosed"]),
        ("a.toml", LanguageId::Toml, &["[pkg]\nname = \n", "[unclosed\nx = 1"]),
        ("a.md", LanguageId::Markdown, &["```ts\nconst x = 1;", "---\na: [1\n---\n"]),
        ("a.html", LanguageId::Html, &["<section><h1>hi</section>", "<div></span>"]),
        ("a.css", LanguageId::Css, &[".a { color: ; }", ".a {\n  color: red\n  margin: 0;\n}"]),
        ("a.xml", LanguageId::Xml, &["<a><b></a>", "<root>"]),
        ("a.sh", LanguageId::Bash, &["f() {\n  if then\n}", "echo \"unclosed"]),
        ("a.rs", LanguageId::Rust, &["fn f() { let x = ; }", "fn f( { }"]),
        ("a.ts", LanguageId::TypeScript, &["function f(): { const x = ; }", "const x: = 1;"]),
        ("a.tsx", LanguageId::Tsx, &["const C = () => <section></div>;", "const x: = 1;"]),
        ("a.js", LanguageId::JavaScript, &["function f() { const x = ; }", "const s = `unclosed;"]),
        ("a.py", LanguageId::Python, &["def f():\n    x = \n", "if True\n    pass"]),
        ("a.go", LanguageId::Go, &["package main\nfunc f() { var x := }", "func f( {}"]),
        ("a.c", LanguageId::C, &["int f(void) { int x = ; }", "int f( { return 0; }"]),
        ("a.cpp", LanguageId::Cpp, &["int f() { return 1 + * ; }", "class A { void f() { ; }"]),
        ("a.cs", LanguageId::CSharp, &["class A { void F() { int x = ; } }"]),
        ("a.java", LanguageId::Java, &["class A { void f() { int x = ; } }"]),
        ("a.kt", LanguageId::Kotlin, &["fun f() { val x = \n }"]),
        ("a.dart", LanguageId::Dart, &["int f() { var x = ; }"]),
        ("a.php", LanguageId::Php, &["<?php function f() { $x = ; }"]),
        ("a.rb", LanguageId::Ruby, &["def f\n  x = \nend", "def f\n  puts 1"]),
        ("a.twig", LanguageId::Twig, &["{% if a %}ok", "{% block a %}x{% endblock b %}"]),
    ];

    assert_eq!(malformed_cases.len(), 23);
    for (fname, lang, samples) in malformed_cases {
        for sample in *samples {
            let verdict = fw.verify(sample, Path::new(fname), *lang);
            assert!(
                matches!(verdict, FirewallVerdict::Invalid { .. }),
                "Expected {lang:?} ({fname}) to reject malformed sample:\n{sample}"
            );
        }
    }
}

#[test]
fn parser_pool_reuses_parsers_across_all_29_slots() {
    let mut pool = ParserPool::new();
    for pass in 0..2 {
        for slot in ALL_GRAMMAR_SLOTS {
            let src = match slot {
                GrammarSlot::Json => "{\"ok\": true}",
                GrammarSlot::Xml => "<root/>",
                GrammarSlot::Dtd => "<!ELEMENT root (#PCDATA)>",
                GrammarSlot::Php => "<?php $x = 1;",
                GrammarSlot::PhpOnly => "$x = 1;",
                _ => "x",
            };
            let tree = pool
                .parse_slot(slot, src)
                .unwrap_or_else(|e| panic!("pass {pass} slot {slot:?} failed: {e}"));
            assert!(tree.root_node().end_byte() <= src.len());
        }
    }
}
#[test]
fn regression_twig_utf8_verbatim_attrs_tags_and_markup_edge_cases() {
    let fw = DefaultSyntaxFirewall;

    // Non-ASCII UTF-8 outside tags and inside {% verbatim %} must never panic
    assert!(fw.verify("<div>Café — €5 🚀</div>", Path::new("utf8.twig"), LanguageId::Twig).is_valid());
    assert!(
        fw.verify("{% verbatim %}café — {{ x }}{% endverbatim %}", Path::new("v.twig"), LanguageId::Twig)
            .is_valid()
    );

    // Verbatim HTML masking and conditional HTML attribute masking
    assert!(
        fw.verify("<div>{% verbatim %}{{ a }} < {{ b }}{% endverbatim %}</div>", Path::new("v2.twig"), LanguageId::Twig)
            .is_valid()
    );
    assert!(
        fw.verify("{% verbatim %}<div<span>{% endverbatim %}", Path::new("v3.twig"), LanguageId::Twig)
            .is_valid()
    );
    assert!(
        fw.verify(
            "<div class={% if active %}\"on\"{% else %}\"off\"{% endif %}></div>",
            Path::new("attr.twig"),
            LanguageId::Twig
        )
        .is_valid()
    );

    // Dynamic tag name with differing internal whitespace
    assert!(
        fw.verify("<{{tag}}>hi</{{ tag }}>", Path::new("dyn.twig"), LanguageId::Twig)
            .is_valid()
    );

    // Invalid Twig tag & interpolation forms must be rejected
    let invalid_twig_regs = [
        "{% set x != 1 %}",
        "{% set x == 1 %}{% endset %}",
        "{% if ok %}x{% endif wrong %}",
        "{% if ok %}x{% else wrong %}y{% endif %}",
        "{% for x in %}{{ x }}{% endfor %}",
        "{% for in items %}{{ x }}{% endfor %}",
        "{{ \"hello #{ foo }} bar\" }}",
        "<div class={% if active %}\"on\"{% else %}\"off{% endif %}></div>",
    ];
    for bad in invalid_twig_regs {
        assert!(
            !fw.verify(bad, Path::new("bad.twig"), LanguageId::Twig).is_valid(),
            "Expected Twig firewall to reject: {bad}"
        );
    }

    // CSS comment containing ':' and HTML rawtext closer with trailing whitespace
    assert!(
        fw.verify(".a { color: /* note: ok */ red; }", Path::new("ok.css"), LanguageId::Css)
            .is_valid()
    );
    assert!(
        fw.verify("<html><script>const x = 1;</script ></html>", Path::new("ok.html"), LanguageId::Html)
            .is_valid()
    );
    assert!(
        fw.verify("<html><style>a{}</style\t></html>", Path::new("ok2.html"), LanguageId::Html)
            .is_valid()
    );
}

#[test]
fn regression_bw2_error_span_expansion_and_shifts() {
    let fw = DefaultSyntaxFirewall;

    // Pure insertion of broken line inside existing 1..3 error node must be rejected
    let rs_base = "fn top() {}\nfn broken() { let a = \nfn end() {}\n";
    let rs_bad = "fn top() {}\nfn broken() { let a = \nlet new_bad = ;\nfn end() {}\n";
    assert!(!fw.verify_incremental(Some(rs_base), rs_bad, Path::new("a.rs"), LanguageId::Rust).is_valid());

    // Breaking line 3 inside an existing multi-line error span in JS and Bash must be rejected
    let js_base = "function f() {\n  const a = ;\n  const b = 1;\n}\n";
    let js_bad = "function f() {\n  const a = ;\n  const b = ;\n}\n";
    assert!(
        !fw.verify_incremental(Some(js_base), js_bad, Path::new("a.js"), LanguageId::JavaScript)
            .is_valid()
    );

    let sh_base = "f() {\n  if then\n  echo ok\n}\n";
    let sh_bad = "f() {\n  if then\n  echo \"unclosed\n}\n";
    assert!(
        !fw.verify_incremental(Some(sh_base), sh_bad, Path::new("a.sh"), LanguageId::Bash)
            .is_valid()
    );

    // Shifting a prebroken error line down (+3) or up (-1) via valid edits must stay Valid
    let mut lines: Vec<String> = (1..=19).map(|i| format!("let v{i}: i32 = {i};")).collect();
    lines.push("let broken = ;".to_string());
    let base_l20 = format!("{}\n", lines.join("\n"));
    let shift_down = format!("let a1 = 1;\nlet a2 = 2;\nlet a3 = 3;\n{base_l20}");
    assert!(
        fw.verify_incremental(Some(&base_l20), &shift_down, Path::new("s.rs"), LanguageId::Rust)
            .is_valid()
    );

    let rs_del_base = "fn a() {}\nfn b() {}\nfn c() {}\nlet broken = ;\n";
    let rs_del_cand = "fn a() {}\nfn c() {}\nlet broken = ;\n";
    assert!(
        fw.verify_incremental(Some(rs_del_base), rs_del_cand, Path::new("d.rs"), LanguageId::Rust)
            .is_valid()
    );
}

#[test]
fn regression_iter2_class_wrappers_bash_error_merge_and_twig_checks() {
    let fw = DefaultSyntaxFirewall;

    // Valid class methods and C++ access specifiers inside pre-broken classes must be Valid
    let ts_base = "class C {\n  bad( {\n  ok() { return 1; }\n}\n";
    let ts_cand = "class C {\n  bad( {\n  added() { return 2; }\n  ok() { return 1; }\n}\n";
    assert!(fw.verify_incremental(Some(ts_base), ts_cand, Path::new("c.ts"), LanguageId::TypeScript).is_valid());
    assert!(fw.verify_incremental(Some(ts_base), ts_cand, Path::new("c.js"), LanguageId::JavaScript).is_valid());

    let tsx_cand = "class C {\n  bad( {\n  added() { return <span />; }\n  ok() { return 1; }\n}\n";
    assert!(fw.verify_incremental(Some(ts_base), tsx_cand, Path::new("c.tsx"), LanguageId::Tsx).is_valid());

    let cpp_base = "class C {\n  int bad( {\n  int ok() { return 1; }\n};\n";
    let cpp_cand = "class C {\n  int bad( {\npublic:\n  int added() { return 2; }\n  int ok() { return 1; }\n};\n";
    assert!(fw.verify_incremental(Some(cpp_base), cpp_cand, Path::new("c.cpp"), LanguageId::Cpp).is_valid());

    // Bash edit touching broken L2 and breaking L3 inside the same span must be Invalid
    let sh_base = "if true; then\n  x=(\n  echo ok\nfi\n";
    let sh_bad = "if true; then\n  x=( #\n  echo \"unclosed\nfi\n";
    assert!(!fw.verify_incremental(Some(sh_base), sh_bad, Path::new("a.sh"), LanguageId::Bash).is_valid());

    // Nested in-tag {% if %} must be Valid; multi-assign set and flush must be Valid
    assert!(
        fw.verify(
            "<div {% if a %}class={% if b %}\"1\"{% else %}\"2\"{% endif %}{% else %}id=\"3\"{% endif %}></div>",
            Path::new("nested.twig"),
            LanguageId::Twig
        ).is_valid()
    );
    assert!(fw.verify("{% set a, b = 1, 2 %}{% flush %}", Path::new("ok.twig"), LanguageId::Twig).is_valid());

    // In-tag HTML validation bypasses and Twig RD tag validation bypasses must be Invalid
    let invalid_twigs = [
        "<div {% if active %}class=\"on\"{% else %}><span{% endif %}></div>",
        "<div {% if active %}class=\"on\"{% else %}class=\"off\"{% endif %}><span></div>",
        "<div {% if a==1 %}a=\"1\"{% elseif a==2 %}a=\"2\"{% elseif a==3 %}a=\"3\"{% elseif a==4 %}a=\"4\"{% elseif a==5 %}a=\"5\"{% elseif a==6 %}a=\"6\"{% elseif a==7 %}a=\"7\"{% elseif a==8 %}a=\"8\"{% else %}class={% endif %}></div>",
        "{% for x in xs %}<div {% if active %}class=\"on\"{% else %}><span{% endif %}></div>{% endfor %}",
        "{% set 123 = 1 %}",
        "{% set a + b = 1 %}",
        "{% set a, = 1 %}",
        "{% include %}",
        "{% extends %}",
        "{% use %}",
        "{% import %}",
        "{% from %}",
        "{% do %}",
        "{% macro 123() %}{% endmacro %}",
    ];
    for bad in invalid_twigs {
        assert!(
            !fw.verify(bad, Path::new("bad.twig"), LanguageId::Twig).is_valid(),
            "Expected Twig firewall to reject: {bad}"
        );
    }
}

#[test]
fn regression_iter3_bash_error_merge_and_twig_cartesian_html_tags() {
    let fw = DefaultSyntaxFirewall;
    let reg = aice_ast_engine::EngineRegistry::new();
    let sh_path = Path::new("test.sh");

    // 1a. >24-line edit touching broken L2 and breaking L27 must be Invalid
    let mut gt24_base = String::from("if true; then\n  x=(\n");
    let mut gt24_bad = String::from("if true; then\n  x=( #\n");
    let mut gt24_valid = String::from("if true; then\n  x=( #\n");
    for i in 1..=25 {
        gt24_base.push_str(&format!("  echo {i}\n"));
        if i < 25 {
            gt24_bad.push_str(&format!("  echo x{i}\n"));
        } else {
            gt24_bad.push_str("  echo \"unclosed\n");
        }
        gt24_valid.push_str(&format!("  echo x{i}\n"));
    }
    gt24_base.push_str("fi\n");
    gt24_bad.push_str("fi\n");
    gt24_valid.push_str("fi\n");
    assert!(!fw.verify_incremental(Some(&gt24_base), &gt24_bad, sh_path, LanguageId::Bash).is_valid());
    assert!(fw.verify_incremental(Some(&gt24_base), &gt24_valid, sh_path, LanguageId::Bash).is_valid());

    // 1b. 2 pre-broken lines (untouched L3) + break L4 must be Invalid
    let sh_2broken = "if true; then\n  x=(\n  y=(\n  echo ok\nfi\n";
    let sh_2broken_bad = "if true; then\n  x=( #\n  y=(\n  echo \"unclosed\nfi\n";
    assert!(!fw.verify_incremental(Some(sh_2broken), sh_2broken_bad, sh_path, LanguageId::Bash).is_valid());

    // 1c. Single-line edit adding unclosed quote must be Invalid; comment edit stays Valid
    let sh_1l_base = "if true; then\n  x=(\n  echo ok\nfi\n";
    let sh_1l_bad = "if true; then\n  x=( ; echo \"unclosed\n  echo ok\nfi\n";
    let sh_1l_ok = "if true; then\n  x=( # comment\n  echo ok\nfi\n";
    assert!(!fw.verify_incremental(Some(sh_1l_base), sh_1l_bad, sh_path, LanguageId::Bash).is_valid());
    assert!(fw.verify_incremental(Some(sh_1l_base), sh_1l_ok, sh_path, LanguageId::Bash).is_valid());

    // 1d. Valid multi-line & pure deletion edits inside pre-broken spans stay Valid
    let sh_if_base = "f() {\n  if then\n  echo ok\n}\n";
    let sh_if_multi_ok = "f() {\n  if then # ok\n  if false; then\n    echo added\n  fi\n  echo ok\n}\n";
    assert!(fw.verify_incremental(Some(sh_if_base), sh_if_multi_ok, sh_path, LanguageId::Bash).is_valid());
    let sh_arr_multi_ok = "if true; then\n  x=( #\n  echo added1\n  echo added2\n  echo ok\nfi\n";
    assert!(fw.verify_incremental(Some(sh_1l_base), sh_arr_multi_ok, sh_path, LanguageId::Bash).is_valid());
    let sh_del_base = "if true; then\n  x=(\n  echo drop_me\n  echo ok\nfi\n";
    let sh_del_ok = "if true; then\n  x=(\n  echo ok\nfi\n";
    assert!(fw.verify_incremental(Some(sh_del_base), sh_del_ok, sh_path, LanguageId::Bash).is_valid());
    let rs_multi_base = "fn f() {\n  let bad = ;\n  let ok = 1;\n}\n";
    let rs_multi_ok = "fn f() {\n  let bad = ; // ok\n  if true {\n    let added = 2;\n  }\n  let ok = 1;\n}\n";
    assert!(fw.verify_incremental(Some(rs_multi_base), rs_multi_ok, Path::new("m.rs"), LanguageId::Rust).is_valid());
    let js_multi_base = "function f() {\n  const bad = ;\n  const ok = 1;\n}\n";
    let js_multi_ok = "function f() {\n  const bad = ; // ok\n  const fn2 = () => {\n    return 2;\n  };\n  const ok = 1;\n}\n";
    assert!(fw.verify_incremental(Some(js_multi_base), js_multi_ok, Path::new("m.js"), LanguageId::JavaScript).is_valid());
    let py_multi_base = "class C:\n    def bad(:\n        pass\n    def ok(self):\n        return 1\n";
    let py_multi_ok = "class C:\n    def bad(: # ok\n        pass\n    def added(self):\n        return 2\n    def ok(self):\n        return 1\n";
    assert!(fw.verify_incremental(Some(py_multi_base), py_multi_ok, Path::new("m.py"), LanguageId::Python).is_valid());

    // 2. Twig sibling & nested-sibling in-tag {% if %} cross-combos must be Invalid
    assert!(!fw.verify(
        "<div {% if a %}data-a=\"1\"{% else %}class={% endif %} {% if b %}id=\"2\"{% else %}\"foo\"{% endif %}></div>",
        Path::new("sib.twig"), LanguageId::Twig
    ).is_valid());
    assert!(!fw.verify(
        "<div {% if a %}{% if b %}data-a=\"1\"{% else %}class={% endif %} {% if c %}id=\"2\"{% else %}\"foo\"{% endif %}{% else %}hidden{% endif %}></div>",
        Path::new("nsib.twig"), LanguageId::Twig
    ).is_valid());

    // 2b. Flat 257-branch elseif chain with malformed 257th branch must be Invalid
    let mut chain257 = String::from("<div {% if v == 0 %}a=\"0\"");
    for i in 1..256 {
        chain257.push_str(&format!("{{% elseif v == {i} %}}a=\"{i}\""));
    }
    chain257.push_str("{% else %}class={% endif %}></div>");
    assert!(!fw.verify(&chain257, Path::new("c257.twig"), LanguageId::Twig).is_valid());

    // 2c. 9-level full binary tree (512 leaves): valid passes, leaf 511 malformed fails
    fn gen_bin(depth: usize, idx: usize, bad_leaf: Option<usize>) -> String {
        if depth == 0 {
            return if bad_leaf == Some(idx) {
                "class=".to_string()
            } else {
                format!("data-l=\"{idx}\"")
            };
        }
        let l = gen_bin(depth - 1, idx * 2, bad_leaf);
        let r = gen_bin(depth - 1, idx * 2 + 1, bad_leaf);
        format!("{{% if b{depth} %}}{l}{{% else %}}{r}{{% endif %}}")
    }
    let bin_valid = format!("<div {}></div>", gen_bin(9, 0, None));
    let bin_bad = format!("<div {}></div>", gen_bin(9, 0, Some(511)));
    assert!(fw.verify(&bin_valid, Path::new("b9ok.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&bin_bad, Path::new("b9bad.twig"), LanguageId::Twig).is_valid());

    // 3. Outer if/for + in-tag if split unclosed <span> vs balanced cross-block <div>
    assert!(!fw.verify(
        "{% if show %}<div {% if active %}class=\"on\"{% else %}class=\"off\"{% endif %}><span>{% endif %}</div>",
        Path::new("if_split.twig"), LanguageId::Twig
    ).is_valid());
    assert!(!fw.verify(
        "{% for item in items %}<div {% if active %}class=\"on\"{% else %}class=\"off\"{% endif %}><span>{% endfor %}</div>",
        Path::new("for_split.twig"), LanguageId::Twig
    ).is_valid());
    assert!(fw.verify(
        "{% if show %}<div>{% endif %}<p>mid</p>{% if show %}</div>{% endif %}",
        Path::new("cross_ok.twig"), LanguageId::Twig
    ).is_valid());

    // 4. Twig RD tag validation for block & macro
    let twig_adapter = aice_lang_registry::AdapterLookup::adapter(&reg, LanguageId::Twig).unwrap();
    for bad_tag in [
        "{% block 123 %}{% endblock %}",
        "{% block a+b %}{% endblock %}",
        "{% macro ok %}{% endmacro %}",
        "{% macro ok(123) %}{% endmacro %}",
    ] {
        assert!(!fw.verify(bad_tag, Path::new("bad_tag.twig"), LanguageId::Twig).is_valid(), "firewall: {bad_tag}");
        assert!(twig_adapter.parse_cst(bad_tag).unwrap().has_error(), "parse_cst: {bad_tag}");
    }
    for ok_tag in [
        "{% macro ok() %}{% endmacro %}",
        "{% macro ok(a, b = 1) %}{% endmacro %}",
    ] {
        assert!(fw.verify(ok_tag, Path::new("ok_tag.twig"), LanguageId::Twig).is_valid(), "firewall: {ok_tag}");
        assert!(!twig_adapter.parse_cst(ok_tag).unwrap().has_error(), "parse_cst: {ok_tag}");
    }
}

#[test]
fn regression_iter5_prebroken_delta_comments_headers_and_error_merges() {
    let fw = DefaultSyntaxFirewall;

    // ATK_A1: Comment edits on pre-broken lines must stay Valid
    let sh_c_base = "if true; then\n  x=( # ok\n  echo ok\nfi\n";
    for cmt in ["# don't", "# \"quoted"] {
        let cand = format!("if true; then\n  x=( {cmt}\n  echo ok\nfi\n");
        assert!(
            fw.verify_incremental(Some(sh_c_base), &cand, Path::new("a.sh"), LanguageId::Bash).is_valid(),
            "Bash comment {cmt}"
        );
    }
    let rs_c_base = "fn f() {\n  let x = (; // ok\n}\n";
    let rs_c_cand = "fn f() {\n  let x = (; // don't\n}\n";
    assert!(fw.verify_incremental(Some(rs_c_base), rs_c_cand, Path::new("a.rs"), LanguageId::Rust).is_valid());
    let py_c_base = "def f():\n  x = ( # ok\n  return 1\n";
    let py_c_cand = "def f():\n  x = ( # don't\n  return 1\n";
    assert!(fw.verify_incremental(Some(py_c_base), py_c_cand, Path::new("a.py"), LanguageId::Python).is_valid());
    let js_c_base = "function f() {\n  const x = ( // ok\n}\n";
    let js_c_cand = "function f() {\n  const x = ( // don't\n}\n";
    assert!(fw.verify_incremental(Some(js_c_base), js_c_cand, Path::new("a.js"), LanguageId::JavaScript).is_valid());
    let tsx_c_base = "const c = (<div>ok</div>\n";
    let tsx_c_cand = "const c = (<div>don't</div>\n";
    let tsx_v = fw.verify_incremental(Some(tsx_c_base), tsx_c_cand, Path::new("a.tsx"), LanguageId::Tsx);
    assert!(tsx_v.is_valid(), "TSX jsx_text: {tsx_v:?}");
    let yaml_c_base = "broken: [1\nmsg: ok\n";
    let yaml_c_cand = "broken: [1\nmsg: don't\n";
    assert!(fw.verify_incremental(Some(yaml_c_base), yaml_c_cand, Path::new("a.yaml"), LanguageId::Yaml).is_valid());

    // ATK_A2: Valid 1x1 header/condition/param edits inside pre-broken span vs invalid edits
    let py_cond_base = "def f(a, b):\n  x = (\n  k = 1\n  if a:\n    return 1\n";
    let py_cond_ok = "def f(a, b):\n  x = ( # ok\n  k = 1\n  if a and b:\n    return 1\n";
    let py_cond_bad = "def f(a, b):\n  x = ( # ok\n  k = 1\n  if a and :\n    return 1\n";
    assert!(fw.verify_incremental(Some(py_cond_base), py_cond_ok, Path::new("c.py"), LanguageId::Python).is_valid());
    assert!(!fw.verify_incremental(Some(py_cond_base), py_cond_bad, Path::new("c.py"), LanguageId::Python).is_valid());

    let py_param_base = "def f(a, b):\n  x = (\n  k = 1\n  def g(a):\n    return a\n";
    let py_param_ok = "def f(a, b):\n  x = ( # ok\n  k = 1\n  def g(a, b):\n    return a\n";
    let py_param_bad = "def f(a, b):\n  x = ( # ok\n  k = 1\n  def g(a, 123):\n    return a\n";
    assert!(fw.verify_incremental(Some(py_param_base), py_param_ok, Path::new("p.py"), LanguageId::Python).is_valid());
    assert!(!fw.verify_incremental(Some(py_param_base), py_param_bad, Path::new("p.py"), LanguageId::Python).is_valid());

    let js_param_base = "function f() {\n  const x = (\n  const k = 1;\n  function g(a) {\n    return a;\n  }\n}\n";
    let js_param_ok = "function f() {\n  const x = ( // ok\n  const k = 1;\n  function g(a, b) {\n    return a;\n  }\n}\n";
    let js_param_bad = "function f() {\n  const x = ( // ok\n  const k = 1;\n  function g(a, 123) {\n    return a;\n  }\n}\n";
    assert!(fw.verify_incremental(Some(js_param_base), js_param_ok, Path::new("p.js"), LanguageId::JavaScript).is_valid());
    assert!(!fw.verify_incremental(Some(js_param_base), js_param_bad, Path::new("p.js"), LanguageId::JavaScript).is_valid());

    // ATK_B1 / ATK_B2: Bash error-merge bypasses must all be rejected
    let sh_path = Path::new("atk.sh");
    let b1_base = "if true; then\n  x=(\n  echo ok\nfi\n";
    let b1_cand = "if true; then\n  x=( ; echo \"unclosed\nfi\n";
    assert!(!fw.verify_incremental(Some(b1_base), b1_cand, sh_path, LanguageId::Bash).is_valid());

    let b2_1x1 = "if true; then\n  y=( ; echo \"unclosed\n  echo ok\nfi\n";
    let b2_nonquote_1 = "if true; then\n  y=( ; if then\n  echo ok\nfi\n";
    let b2_nonquote_2 = "if true; then\n  if then ; foo=(\n  echo ok\nfi\n";
    assert!(!fw.verify_incremental(Some(b1_base), b2_1x1, sh_path, LanguageId::Bash).is_valid());
    assert!(!fw.verify_incremental(Some(b1_base), b2_nonquote_1, sh_path, LanguageId::Bash).is_valid());
    assert!(!fw.verify_incremental(Some(b1_base), b2_nonquote_2, sh_path, LanguageId::Bash).is_valid());

    let b2_2_base = "if true; then\n  x=(\n  echo a\nfi\n";
    let b2_2x2 = "if true; then\n  y=( ; echo \"unclosed\n  echo b\nfi\n";
    let b2_1x2 = "if true; then\n  x=( \"unclosed\n  echo b\nfi\n";
    assert!(!fw.verify_incremental(Some(b2_2_base), b2_2x2, sh_path, LanguageId::Bash).is_valid());
    assert!(!fw.verify_incremental(Some(b2_2_base), b2_1x2, sh_path, LanguageId::Bash).is_valid());

    // ATK_B3: k >= 4 pre-broken lines + inserted broken line must be rejected; valid insert passes
    let b3_base = "if true; then\n  a=(\n  b=(\n  c=(\n  d=(\n  echo ok\nfi\n";
    let b3_bad = "if true; then\n  a=( #\n  b=(\n  c=(\n  d=(\n  echo ok\n  echo \"unclosed\nfi\n";
    let b3_ok = "if true; then\n  a=( #\n  b=(\n  c=(\n  d=(\n  echo ok\n  echo added\nfi\n";
    assert!(!fw.verify_incremental(Some(b3_base), b3_bad, sh_path, LanguageId::Bash).is_valid());
    assert!(fw.verify_incremental(Some(b3_base), b3_ok, sh_path, LanguageId::Bash).is_valid());
}

#[test]
fn regression_iter5_twig_scoped_html_balance_and_implicit_false_branches() {
    let fw = DefaultSyntaxFirewall;

    // Scoped CtrlBlock mutual-exclusivity and forced-branch interval checks
    let invalid_twig_html = [
        "{% if a %}<p>ok</p>{% else %}<p>alt</p>{% endif %}{% if show %}<div><span>{% endif %}</div><span>ok</span>",
        "{% if header %}<p>A</p>{% else %}<p>B</p>{% endif %}{% if show %}<div {% if active %}class=\"on\"{% else %}class=\"off\"{% endif %}><span>{% endif %}</div><footer><span>ok</span></footer>",
        "{% if show %}<div><span>{% else %}<p>alt</p>{% endif %}</div><span>ok</span>",
        "{% if show %}<div>{% endif %}<div>ok</div>",
        "{% for x in items %}{% if a %}<p>ok</p>{% else %}<p>alt</p>{% endif %}<div><span>{% endfor %}</div><span>ok</span>",
    ];
    for bad in invalid_twig_html {
        assert!(
            !fw.verify(bad, Path::new("bad_bal.twig"), LanguageId::Twig).is_valid(),
            "expected Invalid for: {bad}"
        );
    }

    let valid_twig_html = [
        "{% if show %}<div>{% endif %}<p>hi</p>{% if show %}</div>{% endif %}",
        "{% if a %}<div class=\"1\">ok</div>{% else %}<div class=\"2\">alt</div>{% endif %}",
        "{% if show %}<img src=\"a.png\"><br>{% endif %}",
    ];
    for ok in valid_twig_html {
        let v = fw.verify(ok, Path::new("ok_bal.twig"), LanguageId::Twig);
        assert!(v.is_valid(), "expected Valid for: {ok}: {v:?}");
    }
    // In-tag {% if %} without {% else %} must verify implicit false branch
    for bad in [
        "<div {% if a %}class={% endif %}\"foo\"></div>",
        "<div {% if a %}class={% endif %} {% if b %}\"foo\"{% endif %}></div>",
        "<div {% if a %}data-a=\"1\" {% if b %}class={% endif %}{% endif %}\"foo\"></div>",
    ] {
        assert!(
            !fw.verify(bad, Path::new("bad_noelse.twig"), LanguageId::Twig).is_valid(),
            "expected Invalid for no-else in-tag if: {bad}"
        );
    }

    assert!(
        fw.verify("<div {% if a %}class=\"on\"{% endif %}></div>", Path::new("ok_noelse.twig"), LanguageId::Twig)
            .is_valid()
    );
    let sib11: String = (0..11)
        .map(|i| format!("{{% if b{i} %}}data-x{i}=\"{i}\"{{% endif %}}"))
        .collect::<Vec<_>>()
        .join(" ");
    assert!(
        fw.verify(&format!("<div {sib11}></div>"), Path::new("sib11.twig"), LanguageId::Twig)
            .is_valid()
    );
}

fn gen_bin_twig(depth: usize, bad_leaf: Option<usize>, next_id: &mut usize) -> String {
    if depth == 0 {
        let id = *next_id;
        *next_id += 1;
        return if bad_leaf == Some(id) {
            format!("data-x{id}=")
        } else {
            format!("data-x{id}=\"1\"")
        };
    }
    let a = gen_bin_twig(depth - 1, bad_leaf, next_id);
    let b = gen_bin_twig(depth - 1, bad_leaf, next_id);
    format!("{{% if c{depth} %}}{a}{{% else %}}{b}{{% endif %}}")
}

#[test]
fn regression_iter6_twig_correlated_outer_if_and_cross_branch_bypasses() {
    let fw = DefaultSyntaxFirewall;
    let valid_cases = [
        "<div>{% if a %}</div>{% else %}</div>{% endif %}",
        "{% if card %}<section>{% else %}<div>{% endif %}<p>hi</p>{% if card %}</section>{% else %}</div>{% endif %}",
        "{% if show %}<div>{% endif %}<p>hi</p>{% if show %}</div>{% endif %}",
        "{% if a %}<div class=\"1\">{% else %}<div class=\"2\">{% endif %}<p>hi</p></div>",
        "{% if k == 1 %}<section>{% elseif k == 2 %}<div>{% else %}<article>{% endif %}<p>x</p>{% if k == 1 %}</section>{% elseif k == 2 %}</div>{% else %}</article>{% endif %}",
        "{% if a %}<div>{% endif %}<p>x</p>{% if a %}</div>{% else %}<span>alt</span>{% endif %}",
        "{% if a %}{% for x in xs %}<div></div>{% else %}empty{% endfor %}{% else %}<p>ok</p>{% endif %}",
        "<p>café 🚀</p>{% if show %}<div>{% endif %}<script>var s='</div>';</script><!-- </div> -->{% if show %}</div>{% endif %}",
    ];
    for ok in valid_cases {
        let v = fw.verify(ok, Path::new("ok_r6.twig"), LanguageId::Twig);
        assert!(v.is_valid(), "expected Valid for: {ok}: {v:?}");
    }
    let self_bal_15: String = (0..15).map(|i| format!("{{% if c{i} %}}<p>{i}</p>{{% endif %}}")).collect();
    assert!(fw.verify(&self_bal_15, Path::new("bal15.twig"), LanguageId::Twig).is_valid());

    // Scale bounds: gen_bin(9) = 512 leaves, chain257, flat_4096
    let (mut id_ok, mut id_bad) = (0, 0);
    let bin_ok = format!("<div {}></div>", gen_bin_twig(9, None, &mut id_ok));
    let bin_bad = format!("<div {}></div>", gen_bin_twig(9, Some(511), &mut id_bad));
    assert!(fw.verify(&bin_ok, Path::new("bin9_ok.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&bin_bad, Path::new("bin9_bad.twig"), LanguageId::Twig).is_valid());

    let mut chain_ok = String::from("{% if c0 %}data-a=\"0\"");
    for i in 1..257 {
        chain_ok.push_str(&format!("{{% elseif c{i} %}}data-a=\"{i}\""));
    }
    let chain_noelse_bad = format!("<div {chain_ok}{{% endif %}}\"tail\"></div>");
    chain_ok.push_str("{% else %}data-a=\"end\"{% endif %}");
    assert!(fw.verify(&format!("<div {chain_ok}></div>"), Path::new("ch257.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&chain_noelse_bad, Path::new("ch257_bad.twig"), LanguageId::Twig).is_valid());

    let mut flat = String::from("{% if f0 %}data-f=\"0\"");
    for i in 1..4096 {
        flat.push_str(&format!("{{% elseif f{i} %}}data-f=\"{i}\""));
    }
    assert!(fw.verify(&format!("<div {flat}{{% endif %}}></div>"), Path::new("f4096.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&format!("<div {flat}{{% endif %}}\"bad\"></div>"), Path::new("f4096_bad.twig"), LanguageId::Twig).is_valid());

    let invalid_cases = [
        "{% if a %}<div>{% else %}</div>{% endif %}",
        "{% if a %}<span>{% else %}</span>{% endif %}",
        "{% for x in y %}<div>{% else %}</div>{% endfor %}",
        "{% if a %}<div><span>{% else %}</span></div>{% endif %}",
        "{% if a %}<div><span>{% else %}</div>{% endif %}",
        "<div>{% if a %}<span>{% else %}</div>{% endif %}",
        "{% if a %}<div><p>{% else %}</div>{% endif %}",
        "{% if a %}<b><i>{% else %}</b>{% endif %}",
        "{% for x in y %}<div><span>{% else %}</div>{% endfor %}",
        "{% if a %}<div>{% else %}<div></div>{% endif %}</div>",
        "{% if a %}<div>{% endif %}<p>hi</p>{% if b %}</div>{% endif %}",
        "<div {% if a %}class={% for x in xs %}data-x=\"1\"{% else %}data-x=\"0\"{% endfor %}{% endif %}\"foo\"></div>",
        "{% if a %}{% for x in xs %}<div>{% endfor %}{% else %}</div>{% endif %}",
    ];
    for bad in invalid_cases {
        assert!(
            !fw.verify(bad, Path::new("bad_r6.twig"), LanguageId::Twig).is_valid(),
            "expected Invalid for: {bad}"
        );
    }
}

#[test]
fn regression_iter6_2x2_paren_merges_multiline_call_args_and_backticks() {
    let fw = DefaultSyntaxFirewall;
    // 2x2 non-semicolon error merges
    let py_2x2_base = "def f():\n  a = (\n  x = (\n  y = (\n";
    let py_2x2_bad = "def f():\n  a = (\n  x1 = (\n  y1 = ( + (\n";
    assert!(!fw.verify_incremental(Some(py_2x2_base), py_2x2_bad, Path::new("m.py"), LanguageId::Python).is_valid());
    let py_2x2_ok = "def f():\n  a = (\n  x1 = (\n  y1 = (\n";
    assert!(fw.verify_incremental(Some(py_2x2_base), py_2x2_ok, Path::new("m.py"), LanguageId::Python).is_valid());

    let py_1_to_unclosed_base = "def f():\n  a = (\n  x = (\n  y = 1\n";
    let py_1_to_unclosed_bad = "def f():\n  a = (\n  x1 = (\n  y1 = (1,\n";
    assert!(!fw.verify_incremental(Some(py_1_to_unclosed_base), py_1_to_unclosed_bad, Path::new("m2.py"), LanguageId::Python).is_valid());

    let js_2x2_base = "function f() {\n  const a = (\n  const x = (\n  const y = (\n}\n";
    let js_2x2_bad = "function f() {\n  const a = (\n  const x1 = (\n  const y1 = ( + (\n}\n";
    assert!(!fw.verify_incremental(Some(js_2x2_base), js_2x2_bad, Path::new("m.js"), LanguageId::JavaScript).is_valid());

    // Multi-line call args: valid vs invalid controls
    let js_arg_base = "function f() {\n  const x = (\n  const r = foo(a,\n    c);\n}\n";
    let js_arg_ok = "function f() {\n  const x = (\n  const r = foo(a, b,\n    c);\n}\n";
    assert!(fw.verify_incremental(Some(js_arg_base), js_arg_ok, Path::new("arg.js"), LanguageId::JavaScript).is_valid());

    let go_arg_base = "package p\nfunc f() {\n  x := (\n  r := foo(a,\n    c)\n}\n";
    let go_arg_ok = "package p\nfunc f() {\n  x := (\n  r := foo(a, b,\n    c)\n}\n";
    assert!(fw.verify_incremental(Some(go_arg_base), go_arg_ok, Path::new("arg.go"), LanguageId::Go).is_valid());

    let mid_base = "function f() {\n  const x = (\n  const r = foo(\n    a,\n    c);\n}\n";
    let mid_ok = "function f() {\n  const x = (\n  const r = foo(\n    a, b,\n    c);\n}\n";
    assert!(fw.verify_incremental(Some(mid_base), mid_ok, Path::new("mid.js"), LanguageId::JavaScript).is_valid());

    for bad_line in ["const r = foo(a, +", "const r = foo(a, \"unclosed", "const r = foo(a, ,", "const r = foo(a, b, ("] {
        let cand = format!("function f() {{\n  const x = (\n  {bad_line}\n    c);\n}}\n");
        assert!(
            !fw.verify_incremental(Some(js_arg_base), &cand, Path::new("bad.js"), LanguageId::JavaScript).is_valid(),
            "expected Invalid for: {bad_line}"
        );
    }
    let go_bad = "package p\nfunc f() {\n  x := (\n  r := foo(a, 123 +\n    c)\n}\n";
    assert!(!fw.verify_incremental(Some(go_arg_base), go_bad, Path::new("bad.go"), LanguageId::Go).is_valid());

    // Backtick template literal + comment boundaries
    let js_bt_base = "function f() {\n  const u = `https://a`; let y = (\n}\n";
    let js_bt_bad = "function f() {\n  const u = `https://a`; let y = ( +\n}\n";
    assert!(!fw.verify_incremental(Some(js_bt_base), js_bt_bad, Path::new("bt.js"), LanguageId::JavaScript).is_valid());

    let go_bt_base = "package p\nfunc f() {\n  s := `a // b`; x := ( // ok\n}\n";
    let go_bt_ok = "package p\nfunc f() {\n  s := `a // b`; x := ( // don't\n}\n";
    assert!(fw.verify_incremental(Some(go_bt_base), go_bt_ok, Path::new("bt.go"), LanguageId::Go).is_valid());

    let go_raw_bs_base = "package p\nfunc f() {\n  s := `foo\\`; x := ( // ok\n}\n";
    let go_raw_bs_ok = "package p\nfunc f() {\n  s := `foo\\`; x := ( // don't\n}\n";
    assert!(fw.verify_incremental(Some(go_raw_bs_base), go_raw_bs_ok, Path::new("bs.go"), LanguageId::Go).is_valid());
}

#[test]
fn regression_iter7_utf8_mids_twig_fallbacks_rawtext_comments_and_inner_delims() {
    let fw = DefaultSyntaxFirewall;

    // 1. UTF-8 continuation-byte divergence in diff_line_mids & comment_or_string_boundary
    for (lang, p, b, c, exp) in [
        (LanguageId::JavaScript, "u.js", "let x = ( // café", "let x = ( // cafè", true),
        (LanguageId::JavaScript, "u.js", "let x = ( + '🚀'", "let x = ( + '🛸'", true),
        (LanguageId::Python, "u.py", "x = ( # café", "x = ( # cafè", true),
        (LanguageId::Rust, "u.rs", "let café = (", "let cafè = (", true),
        (LanguageId::Rust, "u.rs", "let café = (", "let cafè = (,", false),
        (LanguageId::JavaScript, "u.js", "const s = ('🚀'", "const s = ('🛸'", true),
        (LanguageId::JavaScript, "u.js", "const s = ('🚀'", "const s = ('🛸' + *", false),
    ] {
        assert_eq!(
            fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(),
            exp,
            "utf8 {p}: {b:?} -> {c:?}"
        );
    }

    // 2. Twig truncation fallbacks (flat 4096/4097 branch + multi-block 1025 Cartesian)
    let mut flat_4095_bad = String::from("{% if f0 %}data-f=\"0\"");
    for i in 1..4095 {
        flat_4095_bad.push_str(&format!("{{% elseif f{i} %}}data-f=\"{i}\""));
    }
    flat_4095_bad.push_str("{% elseif f4095 %}class={% endif %}");
    assert!(!fw.verify(&format!("<div {flat_4095_bad}></div>"), Path::new("f4095.twig"), LanguageId::Twig).is_valid());
    let mut flat_4097_bad = String::from("{% if f0 %}data-f=\"0\"");
    for i in 1..4096 {
        flat_4097_bad.push_str(&format!("{{% elseif f{i} %}}data-f=\"{i}\""));
    }
    flat_4097_bad.push_str("{% elseif f4096 %}class={% endif %}");
    assert!(!fw.verify(&format!("<div {flat_4097_bad}></div>"), Path::new("f4097.twig"), LanguageId::Twig).is_valid());

    let mut blk1025 = String::from("{% if b0 %}data-b=\"0\"");
    for i in 1..1024 {
        blk1025.push_str(&format!("{{% elseif b{i} %}}data-b=\"{i}\""));
    }
    let blk1025_ok = format!("<div {{% if a0 %}}data-x=\"1\"{{% else %}}data-x=\"0\"{{% endif %}} {blk1025}{{% else %}}data-b=\"ok\"{{% endif %}}></div>");
    let blk1025_bad = format!("<div {{% if a0 %}}data-x=\"1\"{{% else %}}data-x=\"0\"{{% endif %}} {blk1025}{{% else %}}class={{% endif %}}></div>");
    let blk1025_first_bad = format!("<div {blk1025}{{% else %}}class={{% endif %}} {{% if a0 %}}data-x=\"1\"{{% else %}}data-x=\"0\"{{% endif %}}></div>");
    assert!(fw.verify(&blk1025_ok, Path::new("b1025_ok.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&blk1025_bad, Path::new("b1025_bad.twig"), LanguageId::Twig).is_valid());
    assert!(!fw.verify(&blk1025_first_bad, Path::new("b1025_first.twig"), LanguageId::Twig).is_valid());

    // 3. 1x1 & 2x2 identifier-rename + inner-syntax-defect error merges
    for (lang, p, b, c) in [
        (LanguageId::Python, "a.py", "def f():\n  a = (\n  x = (\n  y = (\n", "def f():\n  a = (\n  x1 = (\n  y1 = (,\n"),
        (LanguageId::JavaScript, "a.js", "function f() {\n  const a = (\n  const x = (\n  const y = (\n}\n", "function f() {\n  const a = (\n  const x1 = (\n  const y1 = (,\n}\n"),
        (LanguageId::Go, "a.go", "package p\nfunc f() {\n  a := (\n  x := (\n  y := (\n}\n", "package p\nfunc f() {\n  a := (\n  x1 := (\n  y1 := (,\n}\n"),
        (LanguageId::Rust, "a.rs", "fn f() {\n  let a = (\n  let x = (\n  let y = (\n}\n", "fn f() {\n  let a = (\n  let x1 = (\n  let y1 = (,\n}\n"),
        (LanguageId::JavaScript, "b.js", "function f() {\n  const a = (\n  const y = (\n}\n", "function f() {\n  const a = (\n  const y1 = ( + *\n}\n"),
        (LanguageId::JavaScript, "c.js", "function f() {\n  const a = (\n  const y = (\n}\n", "function f() {\n  const a = (\n  const y1 = (,\n}\n"),
        (LanguageId::Go, "c.go", "package p\nfunc f() {\n  a := (\n  y := (\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (,\n}\n"),
        (LanguageId::Rust, "c.rs", "fn f() {\n  let a = (\n  let y = (\n}\n", "fn f() {\n  let a = (\n  let y1 = (,\n}\n"),
        (LanguageId::Python, "b.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = ( + *\n"),
        (LanguageId::Python, "d.py", "def f():\n  a = (\n  y = 1\n", "def f():\n  a = (\n  y1 = (1,\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
    }
    for (lang, p, b, c) in [
        (LanguageId::Python, "ok.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = (\n"),
        (LanguageId::JavaScript, "ok.js", "function f() {\n  const a = (\n  const y = (\n}\n", "function f() {\n  const a = (\n  const y1 = (\n}\n"),
        (LanguageId::Go, "ok.go", "package p\nfunc f() {\n  a := (\n  y := (\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (\n}\n"),
        (LanguageId::Rust, "ok.rs", "fn f() {\n  let a = (\n  let y = (\n}\n", "fn f() {\n  let a = (\n  let y1 = (\n}\n"),
        (LanguageId::JavaScript, "arg2.js", "function f() {\n  const x = (\n  const y = (\n  const r = foo(a,\n    c);\n}\n", "function f() {\n  const x = (\n  const y1 = (\n  const r = foo(a, b,\n    c);\n}\n"),
        (LanguageId::JavaScript, "hdr.js", "function f() {\n  const a = (\n  if (a &&\n    b) {}\n}\n", "function f() {\n  const a = (\n  if (a && b &&\n    b) {}\n}\n"),
        (LanguageId::Python, "op.py", "def f():\n  a = (\n  x = (1 +\n", "def f():\n  a = (\n  x1 = (1 +\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid for {p}");
    }

    // 4. Twig rawtext + non-output Twig tags & cross-branch HTML comment splits
    for ok in [
        "<title>{% if page_title %}{{ page_title }}{% else %}Home{% endif %}</title>",
        "<title>App{% if sub %} - {{ sub }}{% endif %}</title>",
        "<script>{% if debug %}const dbg = true;{% endif %}</script>",
        "<script>{% for id in ids %}reg({{ id }});{% endfor %}</script>",
        "<script>{# note #}var a = 1;</script>{% if x %}<p>hi</p>{% endif %}",
        "<style>{% if dark %}body{color:#fff}{% else %}body{color:#000}{% endif %}</style>",
        "<textarea>{% if val %}{{ val }}{% endif %}</textarea>",
        "{% if a %}<script>var x = 1;{% else %}<script>var y = 2;{% endif %}</script>",
        "<script>if (x < y) { {% if a %}var z = 1;{% endif %} }</script>",
        "<script>if (x<y) { {% if a %}var z = 1;{% endif %} }</script>",
        "<script>{% for id in ids %}if (a<b) {}{% endfor %}</script>",
        "<!-- {% if a %}hi{% endif %} -->",
        "{% if a %}<!-- ok -->{% endif %}",
    ] {
        let v = fw.verify(ok, Path::new("raw_ok.twig"), LanguageId::Twig);
        assert!(v.is_valid(), "expected Valid for: {ok}: {v:?}");
    }
    for bad in [
        "{% if a %}<script>{% else %}<div>{% endif %}</script>",
        "{% if a %}<script>{% endif %}</script>",
        "<script>{% if a %}</script>{% endif %}",
        "<script>{% for id in ids %}</script>{% endfor %}",
        "<div>{% if a %}<!--{% else %}-->{% endif %}</div>",
        "<div>{% if a %}-->{% else %}<!--{% endif %}</div>",
    ] {
        assert!(!fw.verify(bad, Path::new("raw_bad.twig"), LanguageId::Twig).is_valid(), "expected Invalid for: {bad}");
    }

    // 5. apply_events_range unclosed tag names report each inner tag accurately
    let v = fw.verify("<div>{% if a %}<span><b>{% endif %}</div>", Path::new("unclosed.twig"), LanguageId::Twig);
    let msgs = format!("{v:?}");
    assert!(msgs.contains("Unclosed tag '<span>' before '</div>'"), "got: {msgs}");
    assert!(msgs.contains("Unclosed tag '<b>' before '</div>'"), "got: {msgs}");
}

#[test]
fn regression_iter8_trailing_operator_rename_error_merges() {
    let fw = DefaultSyntaxFirewall;
    // 4 reproduced bypasses + cross-language trailing double-op variants -> Invalid
    for (lang, p, b, c) in [
        (LanguageId::Python, "b1.py", "def f():\n  a = (\n  y = (1 +\n", "def f():\n  a = (\n  y1 = (1 + *\n"),
        (LanguageId::JavaScript, "b2.js", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 + *\n}\n"),
        (LanguageId::Python, "b3.py", "def f():\n  a = (\n  x = (1 +\n  y = (1 +\n", "def f():\n  a = (\n  x1 = (1 +\n  y1 = (1 + *\n"),
        (LanguageId::JavaScript, "b4.js", "function f() {\n  const x = (\n  if (a &&\n    b) {}\n}\n", "function f() {\n  const x = (\n  if (a1 && ||\n    b) {}\n}\n"),
        (LanguageId::Go, "b5.go", "package p\nfunc f() {\n  a := (\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (1 + *\n}\n"),
        (LanguageId::Rust, "b6.rs", "fn f() {\n  let a = (\n  let y = (1 +\n}\n", "fn f() {\n  let a = (\n  let y1 = (1 + *\n}\n"),
        (LanguageId::Go, "b7.go", "package p\nfunc f() {\n  a := (\n  x := (1 +\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  x1 := (1 +\n  y1 := (1 + *\n}\n"),
        (LanguageId::Rust, "b8.rs", "fn f() {\n  let a = (\n  let x = (\n  let y = (1 +\n}\n", "fn f() {\n  let a = (\n  let x1 = (\n  let y1 = (1 + *\n}\n"),
        (LanguageId::JavaScript, "b9.js", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + *\n}\n"),
        (LanguageId::Python, "b10.py", "def f():\n  x = (\n  if (a and\n    b): pass\n", "def f():\n  x = (\n  if (a1 and or\n    b): pass\n"),
        (LanguageId::Python, "b11.py", "def f():\n  a = (\n  y = (1 +\n", "def f():\n  a = (\n  y1 = (1 +*\n"),
        (LanguageId::Python, "b12.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = ( + *\n"),
        (LanguageId::Python, "b13.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = (,\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
    }
    // Valid trailing-operator & delimiter controls -> Valid
    for (lang, p, b, c) in [
        (LanguageId::Python, "v1.py", "def f():\n  a = (\n  y = (1 +\n", "def f():\n  a = (\n  y1 = (1 +\n"),
        (LanguageId::JavaScript, "v2.js", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 +\n}\n"),
        (LanguageId::Go, "v3.go", "package p\nfunc f() {\n  a := (\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (1 +\n}\n"),
        (LanguageId::Rust, "v4.rs", "fn f() {\n  let a = (\n  let y = (1 +\n}\n", "fn f() {\n  let a = (\n  let y1 = (1 +\n}\n"),
        (LanguageId::Python, "v5.py", "def f():\n  a = (\n  x = (1 +\n  y = (1 +\n", "def f():\n  a = (\n  x1 = (1 +\n  y1 = (1 +\n"),
        (LanguageId::JavaScript, "v6.js", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 +\n}\n"),
        (LanguageId::Go, "v7.go", "package p\nfunc f() {\n  a := (\n  x := (1 +\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  x1 := (1 +\n  y1 := (1 +\n}\n"),
        (LanguageId::Rust, "v8.rs", "fn f() {\n  let a = (\n  let x = (\n  let y = (1 +\n}\n", "fn f() {\n  let a = (\n  let x1 = (\n  let y1 = (1 +\n}\n"),
        (LanguageId::JavaScript, "v9.js", "function f() {\n  const x = (\n  if (a &&\n    b) {}\n}\n", "function f() {\n  const x = (\n  if (a && b &&\n    b) {}\n}\n"),
        (LanguageId::JavaScript, "v10.js", "function f() {\n  const x = (\n  const y = (1 +\n  if (a &&\n    b) {}\n}\n", "function f() {\n  const x = (\n  const y1 = (1 +\n  if (a && b &&\n    b) {}\n}\n"),
        (LanguageId::Python, "v11.py", "def f():\n  x = (\n  if (a and\n    b): pass\n", "def f():\n  x = (\n  if (a1 and\n    b): pass\n"),
        (LanguageId::Python, "v12.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = (\n"),
        (LanguageId::JavaScript, "v13.js", "function f() {\n  const x = (\n  const r = foo(a,\n    c);\n}\n", "function f() {\n  const x = (\n  const r = foo(a, b,\n    c);\n}\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid for {p}");
    }
}

#[test]
fn regression_iter9_all_6_clusters() {
    let fw = DefaultSyntaxFirewall;
    // Clusters 1-5: Invalid attacks -> must be rejected
    for (lang, p, b, c) in [
        // Cluster 1: missing operators (??, .., >>>, in, not in, is, is not, ?:, =~) & UTF-8 caféand
        (LanguageId::JavaScript, "c1_nullish.js", "function f() {\n  const a = (\n  const y = (x ??\n}\n", "function f() {\n  const a = (\n  const y1 = (x1 ?? *\n}\n"),
        (LanguageId::JavaScript, "c1_nullish_2x2.js", "function f() {\n  const a = (\n  const x = (a ??\n  const y = (b ??\n}\n", "function f() {\n  const a = (\n  const x1 = (a ??\n  const y1 = (b1 ?? *\n}\n"),
        (LanguageId::Python, "c1_in.py", "def f():\n  a = (\n  if (x in\n    y): pass\n", "def f():\n  a = (\n  if (x1 in *\n    y): pass\n"),
        (LanguageId::Python, "c1_not_in.py", "def f():\n  a = (\n  if (x not in\n    y): pass\n", "def f():\n  a = (\n  if (x1 not in *\n    y): pass\n"),
        (LanguageId::Python, "c1_is.py", "def f():\n  a = (\n  if (x is\n    y): pass\n", "def f():\n  a = (\n  if (x1 is *\n    y): pass\n"),
        (LanguageId::Python, "c1_is_not.py", "def f():\n  a = (\n  if (x is not\n    y): pass\n", "def f():\n  a = (\n  if (x1 is not *\n    y): pass\n"),
        (LanguageId::Java, "c1_ushr.java", "class C { void f() {\n  int a = (\n  int y = (x >>>\n}}\n", "class C { void f() {\n  int a = (\n  int y1 = (x1 >>> *\n}}\n"),
        (LanguageId::Rust, "c1_range.rs", "fn f() {\n  let a = (\n  let y = (0..\n}\n", "fn f() {\n  let a = (\n  let y1 = (0.. *\n}\n"),
        (LanguageId::Kotlin, "c1_elvis.kt", "fun f() {\n  val a = (\n  val y = (x ?:\n}\n", "fun f() {\n  val a = (\n  val y1 = (x1 ?: *\n}\n"),
        (LanguageId::Ruby, "c1_match.rb", "def f\n  a = (\n  if (x =~\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 =~ *\n    y)\n  end\nend\n"),
        (LanguageId::Python, "c1_cafe_1x1.py", "def f():\n  a = (\n  if (caféand +\n    b): pass\n", "def f():\n  a = (\n  if (caféand1 + *\n    b): pass\n"),
        (LanguageId::Python, "c1_cafe_2x2.py", "def f():\n  a = (\n  x = (1 +\n  if (caféand +\n    b): pass\n", "def f():\n  a = (\n  x1 = (1 +\n  if (caféand1 + *\n    b): pass\n"),
        (LanguageId::JavaScript, "c1_cafe_js.js", "function f() {\n  const a = (\n  if (caféand +\n    b) {}\n}\n", "function f() {\n  const a = (\n  if (caféand1 + *\n    b) {}\n}\n"),
        // Cluster 2: Open-delimiter strictly-binary / Python (* / (**
        (LanguageId::Python, "c2_open_star.py", "def f():\n  a = (\n  y = (1 +\n", "def f():\n  a = (\n  y1 = ( *\n"),
        (LanguageId::Python, "c2_open_starstar.py", "def f():\n  a = (\n  y = (1 +\n", "def f():\n  a = (\n  y1 = ( **\n"),
        (LanguageId::Python, "c2_open_star_2x2.py", "def f():\n  a = (\n  x = (1 +\n  y = (1 +\n", "def f():\n  a = (\n  x1 = (1 +\n  y1 = ( *\n"),
        (LanguageId::Python, "c2_paren_to_star.py", "def f():\n  a = (\n  y = (\n", "def f():\n  a = (\n  y1 = ( *\n"),
        (LanguageId::JavaScript, "c2_open_and.js", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y1 = ( &&\n}\n"),
        // Cluster 3: Ruby & PHP `if (... and or`
        (LanguageId::Ruby, "c3_rb_and_or.rb", "def f\n  a = (\n  if (x and\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 and or\n    y)\n  end\nend\n"),
        (LanguageId::Ruby, "c3_rb_or_and.rb", "def f\n  a = (\n  if (x or\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 or and\n    y)\n  end\nend\n"),
        (LanguageId::Php, "c3_php_and_or.php", "<?php\nfunction f() {\n  $a = (\n  if ($x and\n    $y) {}\n}\n", "<?php\nfunction f() {\n  $a = (\n  if ($x1 and or\n    $y) {}\n}\n"),
        (LanguageId::Php, "c3_php_cmt_and_or.php", "<?php\nfunction f() {\n  $a = (\n  if ($x and\n    $y) {}\n}\n", "<?php\nfunction f() {\n  $a = (\n  if ($x1 and /* c */ or\n    $y) {}\n}\n"),
        // Cluster 4: JS/TS 2x2 closed-delimiter + trailing op
        (LanguageId::JavaScript, "c4_js_2x2.js", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + ) *\n}\n"),
        (LanguageId::TypeScript, "c4_ts_2x2.ts", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + ) *\n}\n"),
        // Cluster 5: Inline / leading `/* ... */` block comments
        (LanguageId::JavaScript, "c5_js_lead.js", "function f() {\n  const a = (\n  /* c */ const y = (1 +\n}\n", "function f() {\n  const a = (\n  /* c */ const y1 = (1 + *\n}\n"),
        (LanguageId::JavaScript, "c5_js_mid.js", "function f() {\n  const a = (\n  const y = (1 /* c */ +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 /* c */ + *\n}\n"),
        (LanguageId::Cpp, "c5_cpp_mid.cpp", "void f() {\n  int a = (\n  int y = (1 /* cmt */ +\n}\n", "void f() {\n  int a = (\n  int y1 = (1 /* cmt */ + *\n}\n"),
        (LanguageId::Rust, "c5_rust_lead.rs", "fn f() {\n  let a = (\n  /* c */ let y = (1 +\n}\n", "fn f() {\n  let a = (\n  /* c */ let y1 = (1 + *\n}\n"),
        (LanguageId::Go, "c5_go_2x2.go", "package p\nfunc f() {\n  a := (\n  /* c */ x := (1 +\n  /* c */ y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  /* c */ x1 := (1 +\n  /* c */ y1 := (1 + *\n}\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
    }

    // Valid controls across Clusters 1-5 -> must remain Valid
    for (lang, p, b, c) in [
        (LanguageId::Rust, "ok_rust_and.rs", "fn f() {\n  let a = (\n  let y = (and1 +\n}\n", "fn f() {\n  let a = (\n  let y = (and +\n}\n"),
        (LanguageId::JavaScript, "ok_js_or.js", "function f() {\n  const a = (\n  const y = (or1 +\n}\n", "function f() {\n  const a = (\n  const y = (or +\n}\n"),
        (LanguageId::JavaScript, "ok_js_obj_in.js", "function f() {\n  const a = (\n  if (obj.in +\n    b) {}\n}\n", "function f() {\n  const a = (\n  if (obj1.in +\n    b) {}\n}\n"),
        (LanguageId::Php, "ok_php_dollar_or.php", "<?php\nfunction f() {\n  $a = (\n  if ($or +\n    $b) {}\n}\n", "<?php\nfunction f() {\n  $a = (\n  if ($or1 +\n    $b) {}\n}\n"),
        (LanguageId::Python, "ok_py_cafe.py", "def f():\n  a = (\n  if (caféand1 +\n    b): pass\n", "def f():\n  a = (\n  if (caféand +\n    b): pass\n"),
        (LanguageId::Python, "ok_py_unary_minus.py", "def f():\n  a = (\n  y = ( -\n", "def f():\n  a = (\n  y1 = ( -\n"),
        (LanguageId::Rust, "ok_rust_deref.rs", "fn f() {\n  let a = (\n  let y = ( *\n}\n", "fn f() {\n  let a = (\n  let y1 = ( *\n}\n"),
        (LanguageId::Ruby, "ok_rb_and.rb", "def f\n  a = (\n  if (x and\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 and\n    y)\n  end\nend\n"),
        (LanguageId::Php, "ok_php_and.php", "<?php\nfunction f() {\n  $a = (\n  if ($x and\n    $y) {}\n}\n", "<?php\nfunction f() {\n  $a = (\n  if ($x1 and\n    $y) {}\n}\n"),
        (LanguageId::JavaScript, "ok_js_2x2.js", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 +\n}\n"),
        (LanguageId::JavaScript, "ok_js_trail_blk.js", "function f() {\n  const a = (\n  const y = (1 + /* old */\n}\n", "function f() {\n  const a = (\n  const y1 = (1 + /* new */\n}\n"),
        (LanguageId::JavaScript, "ok_js_mid_blk.js", "function f() {\n  const a = (\n  const y = (1 /* c */ +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 /* c */ +\n}\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid for {p}");
    }

    // Cluster 6: Twig split HTML comments
    for ok in [
        "<!-- {% if a %}x-->{% else %}y-->{% endif %}",
        "<!-- {% if a %}x-->{% elseif b %}y-->{% else %}z-->{% endif %}",
        "<div>{% if a %}<!--{% else %}<!--{% endif %} --></div>",
        "<!-- <script><div> -->",
        "<!-- {% if a %}<span>{% endif %} -->",
    ] {
        let v = fw.verify(ok, Path::new("c6_ok.twig"), LanguageId::Twig);
        assert!(v.is_valid(), "expected Valid for Twig: {ok}: {v:?}");
    }
    for bad in [
        "<!-- {% if a %}x-->{% else %}y{% endif %}",
        "<!-- {% if a %}x-->{% endif %}<div>",
        "<div>{% if a %}<!--{% endif %}<span>--></div>",
    ] {
        let v = fw.verify(bad, Path::new("c6_bad.twig"), LanguageId::Twig);
        assert!(!v.is_valid(), "expected Invalid for Twig: {bad}: {v:?}");
    }
}

#[test]
fn regression_iter10_all_findings() {
    let fw = DefaultSyntaxFirewall;

    // 1. Twig UTF-8 post-comment panic fix -> Valid
    for ok in [
        "<!-- ok -->{% if a %}café{% endif %}",
        "<!-- {% if a %}café-->{% else %}naïve-->{% endif %}",
    ] {
        let v = fw.verify(ok, Path::new("t10.twig"), LanguageId::Twig);
        assert!(v.is_valid(), "expected Valid for Twig UTF-8: {ok}: {v:?}");
    }

    // 2. PHP $obj->and / $obj->or / Foo::and valid incremental renames -> Valid
    for (p, b, c) in [
        ("p_and.php", "<?php\nfunction f($obj) {\n  $a = (\n  if ($obj->and1 +\n    $b) {}\n}\n", "<?php\nfunction f($obj) {\n  $a = (\n  if ($obj->and +\n    $b) {}\n}\n"),
        ("p_or.php", "<?php\nfunction f($obj) {\n  $a = (\n  if ($obj->or1 +\n    $b) {}\n}\n", "<?php\nfunction f($obj) {\n  $a = (\n  if ($obj->or +\n    $b) {}\n}\n"),
        ("p_static.php", "<?php\nfunction f() {\n  $a = (\n  if (Foo::and1 +\n    $b) {}\n}\n", "<?php\nfunction f() {\n  $a = (\n  if (Foo::and +\n    $b) {}\n}\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), LanguageId::Php).is_valid(), "expected Valid for {p}");
    }

    // 3. Ruby `and or y` receiverless call bypass -> Invalid (full & incremental), controls Valid
    for bad in [
        "def f\n  if (x1 and or y)\n  end\nend\n",
        "def f\n  if (x1 and\n    or y)\n  end\nend\n",
        "def f\n  x = a and or y\nend\n",
    ] {
        assert!(!fw.verify(bad, Path::new("rb_bad.rb"), LanguageId::Ruby).is_valid(), "expected Invalid full Ruby: {bad}");
    }
    for (b, c) in [
        ("def f\n  a = (\n  if (x and\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 and\n    or y)\n  end\nend\n"),
        ("def f\n  a = (\n  if (x and\n    y)\n  end\nend\n", "def f\n  a = (\n  if (x1 and or y)\n  end\nend\n"),
        ("def f\n  a = (\n  x = a and\n    y\nend\n", "def f\n  a = (\n  x = a and or y\nend\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new("rb_inc.rb"), LanguageId::Ruby).is_valid(), "expected Invalid inc Ruby");
    }
    for ok in [
        "def f(obj)\n  obj.and\n  obj.or(1)\nend\n",
        "def and(x)\n  x\nend\n",
        "h = { and: 1 }\n",
    ] {
        assert!(fw.verify(ok, Path::new("rb_ok.rb"), LanguageId::Ruby).is_valid(), "expected Valid Ruby: {ok}");
    }

    // 4. Kotlin `*` spread expression outside `value_argument` -> Invalid, `foo(*arr)` -> Valid
    for bad in [
        "fun f() { val y = 1 + * 2 }\n",
        "fun f() { if (x1 in * y) {} }\n",
        "fun f() { if (x1 !in * y) {} }\n",
        "val y = *x\n",
    ] {
        assert!(!fw.verify(bad, Path::new("kt_bad.kt"), LanguageId::Kotlin).is_valid(), "expected Invalid full Kotlin: {bad}");
    }
    for (b, c) in [
        ("fun f() {\n  val a = (\n  if (x in\n    y) {}\n}\n", "fun f() {\n  val a = (\n  if (x1 in *\n    y) {}\n}\n"),
        ("fun f() {\n  val a = (\n  if (x !in\n    y) {}\n}\n", "fun f() {\n  val a = (\n  if (x1 !in *\n    y) {}\n}\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new("kt_inc.kt"), LanguageId::Kotlin).is_valid(), "expected Invalid inc Kotlin");
    }
    assert!(fw.verify("fun f(arr: IntArray) { foo(*arr) }\n", Path::new("kt_ok.kt"), LanguageId::Kotlin).is_valid());
    assert!(fw.verify("fun f(arr: IntArray) { foo(a = *arr) }\n", Path::new("kt_ok_named.kt"), LanguageId::Kotlin).is_valid());

    // 5-8. Incremental invalid attacks -> all Invalid
    for (lang, p, b, c) in [
        // 5: Remaining R5 operators + PHP AND/OR/XOR + unparen 1x1
        (LanguageId::Ruby, "op_rb_range3.rb", "def f\n  a = (\n  if (0...\n  end\nend\n", "def f\n  a = (\n  if (0... *\n  end\nend\n"),
        (LanguageId::Kotlin, "op_kt_open_range.kt", "fun f() {\n  val a = (\n  val y = (0..<\n}\n", "fun f() {\n  val a = (\n  val y1 = (0..< *\n}\n"),
        (LanguageId::Kotlin, "op_kt_not_in.kt", "fun f() {\n  val a = (\n  if (x !in\n}\n", "fun f() {\n  val a = (\n  if (x1 !in *\n}\n"),
        (LanguageId::Kotlin, "op_kt_as.kt", "fun f() {\n  val a = (\n  val y = (x as\n}\n", "fun f() {\n  val a = (\n  val y1 = (x1 as *\n}\n"),
        (LanguageId::Kotlin, "op_kt_as_q.kt", "fun f() {\n  val a = (\n  val y = (x as?\n}\n", "fun f() {\n  val a = (\n  val y1 = (x1 as? *\n}\n"),
        (LanguageId::CSharp, "op_cs_as.cs", "class C { void f() {\n  int a = (\n  var x = (x0 as\n  var y = (x as\n}}\n", "class C { void f() {\n  int a = (\n  var x1 = (x0 as\n  var y1 = (x1 as *\n}}\n"),
        (LanguageId::Dart, "op_dart_tdiv.dart", "void f() {\n  var a = (\n  var y = (x ~/\n}\n", "void f() {\n  var a = (\n  var y1 = (x1 ~/ *\n}\n"),
        (LanguageId::Dart, "op_dart_tdiveq.dart", "void f() {\n  var a = (\n  var y = (x ~/=\n}\n", "void f() {\n  var a = (\n  var y1 = (x1 ~/= *\n}\n"),
        (LanguageId::Dart, "op_dart_qdotdot.dart", "void f() {\n  var a = (\n  var y = (x ?..\n}\n", "void f() {\n  var a = (\n  var y1 = (x1 ?.. *\n}\n"),
        (LanguageId::Python, "op_py_matmul.py", "def f():\n  a = (\n  y = (x @\n", "def f():\n  a = (\n  y1 = (x1 @ *\n"),
        (LanguageId::Python, "op_py_matmuleq.py", "def f():\n  a = (\n  x @=\n", "def f():\n  a = (\n  x1 @= *\n"),
        (LanguageId::Go, "op_go_bitclear.go", "package p\nfunc f() {\n  a := (\n  y := (x &^\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (x1 &^ *\n}\n"),
        (LanguageId::Go, "op_go_bitcleareq.go", "package p\nfunc f() {\n  a := (\n  x &^=\n}\n", "package p\nfunc f() {\n  a := (\n  x1 &^= *\n}\n"),
        (LanguageId::Php, "op_php_concat.php", "<?php\nfunction f() {\n  $a = (\n  $y = ($x .\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = ($x1 . *\n}\n"),
        (LanguageId::Php, "op_php_concateq.php", "<?php\nfunction f() {\n  $a = (\n  $y = ($x .=\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = ($x1 .= *\n}\n"),
        (LanguageId::Php, "op_php_and_noparen.php", "<?php\nfunction f() {\n  $a = (\n  $y = $x AND\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = $x1 AND *\n}\n"),
        (LanguageId::Php, "op_php_or_noparen.php", "<?php\nfunction f() {\n  $a = (\n  $y = $x OR\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = $x1 OR *\n}\n"),
        (LanguageId::Php, "op_php_xor_noparen.php", "<?php\nfunction f() {\n  $a = (\n  $y = $x XOR\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = $x1 XOR *\n}\n"),
        // 6: Closed-delimiter + trailing-op 1x1 & 2x2
        (LanguageId::Java, "cd_java_1x1.java", "class C { void f() {\n  int a = (\n  int y = (1 +\n}}\n", "class C { void f() {\n  int a = (\n  int y1 = (1 + ) *\n}}\n"),
        (LanguageId::Kotlin, "cd_kt_1x1_star.kt", "fun f() {\n  val a = (\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) *\n}\n"),
        (LanguageId::Kotlin, "cd_kt_1x1_plus.kt", "fun f() {\n  val a = (\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) +\n}\n"),
        (LanguageId::Kotlin, "cd_kt_2x2.kt", "fun f() {\n  val a = (\n  val x = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val x1 = (1 +\n  val y1 = (1 + ) *\n}\n"),
        (LanguageId::Ruby, "cd_rb_1x1.rb", "def f\n  a = (\n  y = (1 +\nend\n", "def f\n  a = (\n  y1 = (1 + ) *\nend\n"),
        (LanguageId::Ruby, "cd_rb_2x2.rb", "def f\n  a = (\n  x = (1 +\n  y = (1 +\nend\n", "def f\n  a = (\n  x1 = (1 +\n  y1 = (1 + ) *\nend\n"),
        // 7: Go unclosed `[1 +` array/slice probes
        (LanguageId::Go, "go_brk_1x1.go", "package p\nfunc f() {\n  a := [\n  y := [1 +\n}\n", "package p\nfunc f() {\n  a := [\n  y1 := [1 + *\n}\n"),
        (LanguageId::Go, "go_brk_2x2.go", "package p\nfunc f() {\n  a := (\n  x := [1 +\n  y := [1 +\n}\n", "package p\nfunc f() {\n  a := (\n  x1 := [1 +\n  y1 := [1 + ] *\n}\n"),
        // 8: Lexical literal blindness & multi-line `*/` line prefix
        (LanguageId::Rust, "lit_rs_raw1.rs", "fn f() {\n  let a = (\n  let y = (r#\"a\"/*\"# +\n}\n", "fn f() {\n  let a = (\n  let y1 = (r#\"a\"/*\"# + *\n}\n"),
        (LanguageId::Rust, "lit_rs_raw2.rs", "fn f() {\n  let a = (\n  let y = (r#\"a\"/*\"# + x +\n}\n", "fn f() {\n  let a = (\n  let y = (r#\"a\"/*\"# + x + *\n}\n"),
        (LanguageId::Rust, "lit_rs_braw.rs", "fn f() {\n  let a = (\n  let y = (br#\"a\"/*\"# +\n}\n", "fn f() {\n  let a = (\n  let y1 = (br#\"a\"/*\"# + *\n}\n"),
        (LanguageId::Python, "lit_py_tq.py", "def f():\n  a = (\n  y = (\"\"\"a\" #\"\"\" +\n", "def f():\n  a = (\n  y1 = (\"\"\"a\" #\"\"\" + *\n"),
        (LanguageId::Python, "lit_py_sq.py", "def f():\n  a = (\n  y = ('''a' #''' +\n", "def f():\n  a = (\n  y1 = ('''a' #''' + *\n"),
        (LanguageId::JavaScript, "lit_js_regex.js", "function f() {\n  const a = (\n  const y = (/\\/\\*/ +\n}\n", "function f() {\n  const a = (\n  const y1 = (/\\/\\*/ + *\n}\n"),
        (LanguageId::JavaScript, "lit_js_regex_cls.js", "function f() {\n  const a = (\n  const y = (/[/*]/ +\n}\n", "function f() {\n  const a = (\n  const y1 = (/[/*]/ + *\n}\n"),
        (LanguageId::JavaScript, "ml_blk.js", "function f() {\n  const a = (\n  /* start\n     end */ const y = (1 +\n}\n", "function f() {\n  const a = (\n  /* start\n     end */ const y1 = (1 + *\n}\n"),
        (LanguageId::JavaScript, "stray_blk_end.js", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  end */ const y1 = (1 + *\n}\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
    }

    // Valid incremental controls -> must remain Valid
    for (lang, p, b, c) in [
        (LanguageId::Php, "ok_php_concat.php", "<?php\nfunction f() {\n  $a = (\n  $y = ($x .\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = ($x .\n}\n"),
        (LanguageId::Php, "ok_php_and_noparen.php", "<?php\nfunction f() {\n  $a = (\n  $y = $x AND\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = $x1 AND\n}\n"),
        (LanguageId::Go, "ok_go_brk.go", "package p\nfunc f() {\n  a := [\n  y := [1 +\n}\n", "package p\nfunc f() {\n  a := [\n  y1 := [1 +\n}\n"),
        (LanguageId::Rust, "ok_rs_raw.rs", "fn f() {\n  let a = (\n  let y = (r#\"a\"/*\"# +\n}\n", "fn f() {\n  let a = (\n  let y1 = (r#\"a\"/*\"# +\n}\n"),
        (LanguageId::Python, "ok_py_tq.py", "def f():\n  a = (\n  y = (\"\"\"a\" #\"\"\" +\n", "def f():\n  a = (\n  y1 = (\"\"\"a\" #\"\"\" +\n"),
        (LanguageId::JavaScript, "ok_js_regex.js", "function f() {\n  const a = (\n  const y = (/\\/\\*/ +\n}\n", "function f() {\n  const a = (\n  const y1 = (/\\/\\*/ +\n}\n"),
        (LanguageId::JavaScript, "ok_ml_blk.js", "function f() {\n  const a = (\n  /* start\n     end */ const y = (1 +\n}\n", "function f() {\n  const a = (\n  /* start\n     end */ const y1 = (1 +\n}\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid for {p}");
    }
}

#[test]
fn regression_iter11_all_findings() {
    let fw = DefaultSyntaxFirewall;

    // Cluster 1: Infix double-op + RHS (`1 + * 2`), closed-delim + op + RHS (`(1 + ) * 2`),
    // and 2x1 Kotlin merge -> all Invalid
    for (lang, p, b, c) in [
        // 1x1 `1 +` -> `1 + * 2`
        (LanguageId::JavaScript, "c1_js_1x1_plus_star_2.js", "function f() {\n  const a = (\n  const y = 1 +\n}\n", "function f() {\n  const a = (\n  const y1 = 1 + * 2\n}\n"),
        (LanguageId::TypeScript, "c1_ts_1x1_plus_star_2.ts", "function f() {\n  const a = (\n  const y = 1 +\n}\n", "function f() {\n  const a = (\n  const y1 = 1 + * 2\n}\n"),
        (LanguageId::Tsx, "c1_tsx_1x1_plus_star_2.tsx", "function f() {\n  const a = (\n  const y = 1 +\n}\n", "function f() {\n  const a = (\n  const y1 = 1 + * 2\n}\n"),
        (LanguageId::Python, "c1_py_1x1_plus_star_2.py", "def f():\n  a = (\n  y = 1 +\n", "def f():\n  a = (\n  y1 = 1 + * 2\n"),
        (LanguageId::Rust, "c1_rs_1x1_plus_star_2.rs", "fn f() {\n  let a = (\n  let y = 1 +\n}\n", "fn f() {\n  let a = (\n  let y1 = 1 + * 2\n}\n"),
        (LanguageId::Ruby, "c1_rb_1x1_plus_star_2.rb", "def f\n  a = (\n  y = 1 +\nend\n", "def f\n  a = (\n  y1 = 1 + * 2\nend\n"),
        (LanguageId::Kotlin, "c1_kt_1x1_plus_star_2.kt", "fun f() {\n  val a = (\n  val y = 1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = 1 + * 2\n}\n"),
        (LanguageId::Go, "c1_go_1x1_plus_star_2.go", "package p\nfunc f() {\n  a := (\n  y := 1 +\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := 1 + * 2\n}\n"),
        // 2x2 `1 +` -> `1 + * 2`
        (LanguageId::Python, "c1_py_2x2_plus_star_2.py", "def f():\n  a = (\n  x = 1 +\n  y = 1 +\n", "def f():\n  a = (\n  x1 = 1 +\n  y1 = 1 + * 2\n"),
        (LanguageId::Rust, "c1_rs_2x2_plus_star_2.rs", "fn f() {\n  let a = (\n  let x = 1 +\n  let y = 1 +\n}\n", "fn f() {\n  let a = (\n  let x1 = 1 +\n  let y1 = 1 + * 2\n}\n"),
        (LanguageId::Ruby, "c1_rb_2x2_plus_star_2.rb", "def f\n  a = (\n  x = 1 +\n  y = 1 +\nend\n", "def f\n  a = (\n  x1 = 1 +\n  y1 = 1 + * 2\nend\n"),
        (LanguageId::JavaScript, "c1_js_2x2_plus_star_2.js", "function f() {\n  const a = (\n  const x = 1 +\n  const y = 1 +\n}\n", "function f() {\n  const a = (\n  const x1 = 1 +\n  const y1 = 1 + * 2\n}\n"),
        // 1x1 `(1 +` -> `(1 + ) * 2`
        (LanguageId::TypeScript, "c1_ts_1x1_paren_star_2.ts", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Tsx, "c1_tsx_1x1_paren_star_2.tsx", "function f() {\n  const a = (\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Go, "c1_go_1x1_paren_star_2.go", "package p\nfunc f() {\n  a := (\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  y1 := (1 + ) * 2\n}\n"),
        (LanguageId::Kotlin, "c1_kt_1x1_paren_star_2.kt", "fun f() {\n  val a = (\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Ruby, "c1_rb_1x1_paren_star_2.rb", "def f\n  a = (\n  y = (1 +\nend\n", "def f\n  a = (\n  y1 = (1 + ) * 2\nend\n"),
        // 2x2 `(1 +` -> `(1 + ) * 2`
        (LanguageId::Python, "c1_py_2x2_paren_star_2.py", "def f():\n  a = (\n  x = (1 +\n  y = (1 +\n", "def f():\n  a = (\n  x1 = (1 +\n  y1 = (1 + ) * 2\n"),
        (LanguageId::JavaScript, "c1_js_2x2_paren_star_2.js", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + ) * 2\n}\n"),
        (LanguageId::TypeScript, "c1_ts_2x2_paren_star_2.ts", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Tsx, "c1_tsx_2x2_paren_star_2.tsx", "function f() {\n  const a = (\n  const x = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const x1 = (1 +\n  const y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Go, "c1_go_2x2_paren_star_2.go", "package p\nfunc f() {\n  a := (\n  x := (1 +\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  x1 := (1 +\n  y1 := (1 + ) * 2\n}\n"),
        (LanguageId::Kotlin, "c1_kt_2x2_paren_star_2.kt", "fun f() {\n  val a = (\n  val x = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val x1 = (1 +\n  val y1 = (1 + ) * 2\n}\n"),
        // 2x1 Kotlin merge
        (LanguageId::Kotlin, "c1_kt_2x1_merge.kt", "fun f() {\n  val a = (\n  val x = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) *\n}\n"),
        (LanguageId::Kotlin, "c1_kt_2x1_merge_rhs.kt", "fun f() {\n  val a = (\n  val x = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) * 2\n}\n"),
        // Cluster 2: JS/TS regex literal after `/` division and `default`
        (LanguageId::JavaScript, "c2_js_div_regex_cls_plus.js", "function f(x1) {\n  const a = (\n  const y = (x / /[/*]/ +\n}\n", "function f(x1) {\n  const a = (\n  const y1 = (x1 / /[/*]/ + *\n}\n"),
        (LanguageId::TypeScript, "c2_ts_div_regex_cls_plus.ts", "function f(x1: any) {\n  const a = (\n  const y = (x / /[/*]/ +\n}\n", "function f(x1: any) {\n  const a = (\n  const y1 = (x1 / /[/*]/ + *\n}\n"),
        (LanguageId::JavaScript, "c2_js_div_regex_cls_div.js", "function f(x1) {\n  const a = (\n  const y = (x / /[/*]/ /\n}\n", "function f(x1) {\n  const a = (\n  const y1 = (x1 / /[/*]/ / *\n}\n"),
        (LanguageId::JavaScript, "c2_js_div_regex_esc.js", "function f() {\n  const a = (\n  const y = (x / /\\/*/ +\n}\n", "function f() {\n  const a = (\n  const y1 = (x / /\\/*/ + *\n}\n"),
        (LanguageId::JavaScript, "c2_js_export_default_paren.js", "const a = (\nexport default (/[/*]/ +\n", "const a = (\nexport default /[/*]/ + *\n"),
        (LanguageId::JavaScript, "c2_js_export_default_noparen.js", "const a = (\nexport default /[/*]/ +\n", "const a = (\nexport default /[/*]/ + *\n"),
        // Cluster 3: Rust nested block comments
        (LanguageId::Rust, "c3_rs_nested_blk_end.rs", "fn f() {\n  let a = (\n  /* outer /* inner */\n     end */ let y = (1 +\n}\n", "fn f() {\n  let a = (\n  /* outer /* inner */\n     end */ let y1 = (1 + *\n}\n"),
        (LanguageId::Rust, "c3_rs_nested_blk_still.rs", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still */ let y = (1 +\n}\n", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still */ let y1 = (1 + *\n}\n"),
        (LanguageId::Rust, "c3_rs_nested_blk_drop_close.rs", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still */ let y = (1 +\n}\n", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still let y1 = (1 +\n}\n"),
        (LanguageId::Rust, "c3_rs_nested_blk_delim_after.rs", "fn f() {\n  let a = (\n  let y = (1 + /* outer /* inner */ ) */\n}\n", "fn f() {\n  let a = (\n  let y1 = (1 + * /* outer /* inner */ ) */\n}\n"),
        // Cluster 5: Non-binary trailing-token continuations
        (LanguageId::Python, "c5_py_not_star.py", "def f():\n  a = (\n  y = (not\n", "def f():\n  a = (\n  y1 = (not *\n"),
        (LanguageId::Python, "c5_py_not_star_2.py", "def f():\n  a = (\n  y = (not\n", "def f():\n  a = (\n  y1 = (not * 2\n"),
        (LanguageId::JavaScript, "c5_js_ternary_colon_star.js", "function f() {\n  const a = (\n  const y = (c ? b :\n}\n", "function f() {\n  const a = (\n  const y1 = (c ? b : *\n}\n"),
        (LanguageId::JavaScript, "c5_js_ternary_colon_star_2.js", "function f() {\n  const a = (\n  const y = (c ? b :\n}\n", "function f() {\n  const a = (\n  const y1 = (c ? b : * 2\n}\n"),
        (LanguageId::JavaScript, "c5_js_dot_star.js", "function f() {\n  const a = (\n  const y = (obj.\n}\n", "function f() {\n  const a = (\n  const y1 = (obj. *\n}\n"),
        (LanguageId::JavaScript, "c5_js_dot_star_2.js", "function f() {\n  const a = (\n  const y = (obj.\n}\n", "function f() {\n  const a = (\n  const y1 = (obj. * 2\n}\n"),
        (LanguageId::Java, "c1_java_1x1_paren_star_2.java", "class C { void f() {\n  int a = (\n  int y = (1 +\n}}\n", "class C { void f() {\n  int a = (\n  int y1 = (1 + ) * 2\n}}\n"),
        (LanguageId::CSharp, "c1_cs_1x1_paren_star_2.cs", "class C { void f() {\n  int a = (\n  int y = (1 +\n}}\n", "class C { void f() {\n  int a = (\n  int y1 = (1 + ) * 2\n}}\n"),
        (LanguageId::Dart, "c1_dart_1x1_paren_star_2.dart", "void f() {\n  var a = (\n  var y = (1 +\n}\n", "void f() {\n  var a = (\n  var y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Php, "c1_php_1x1_paren_star_2.php", "<?php\nfunction f() {\n  $a = (\n  $y = (1 +\n}\n", "<?php\nfunction f() {\n  $a = (\n  $y1 = (1 + ) * 2\n}\n"),
        (LanguageId::Rust, "c1_rs_1x1_paren_star_2.rs", "fn f() {\n  let a = (\n  let y = (1 +\n}\n", "fn f() {\n  let a = (\n  let y1 = (1 + ) * 2\n}\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
    }

    // Cluster 4: Ruby bare identifier `and`/`or` -> Invalid full & incremental; valid controls -> Valid
    for bad in [
        "def f\n  if (and)\n  end\nend\n",
        "def f\n  x = (and)\nend\n",
        "def f\n  if (or)\n  end\nend\n",
        "def f\n  x = (or)\nend\n",
        "def f\n  x = and\nend\n",
        "def f(and)\nend\n",
    ] {
        assert!(!fw.verify(bad, Path::new("c4_rb_bad.rb"), LanguageId::Ruby).is_valid(), "expected Invalid Ruby full: {bad}");
    }
    for ok in [
        "def f(obj, o)\n  obj.and\n  obj.or(1)\n  alias foo and\n  h = { and: 1 }\n  o.send(:and)\nend\n",
        "def and(x)\n  x\nend\n",
        "def f(and: 1)\n  1\nend\n",
    ] {
        assert!(fw.verify(ok, Path::new("c4_rb_ok.rb"), LanguageId::Ruby).is_valid(), "expected Valid Ruby full: {ok}");
    }

    // Cluster 2 full-file controls
    assert!(fw.verify("const y = x / /[/*]/;\n", Path::new("c2_full1.js"), LanguageId::JavaScript).is_valid());
    assert!(fw.verify("export default /[/*]/;\n", Path::new("c2_full2.js"), LanguageId::JavaScript).is_valid());

    // Valid incremental controls across Clusters 1, 2, 3, 5
    for (lang, p, b, c) in [
        (LanguageId::JavaScript, "c1_ok_allman.js", "function f(a, b) {\n  const z = (\n  if (a && b)\n  {\n  }\n}\n", "function f(a1, b1) {\n  const z = (\n  if (a1 && b1)\n  {\n  }\n}\n"),
        (LanguageId::Java, "c1_ok_allman.java", "class C { void f(boolean a, boolean b) {\n  int z = (\n  if (a && b)\n  {\n  }\n}}\n", "class C { void f(boolean a1, boolean b1) {\n  int z = (\n  if (a1 && b1)\n  {\n  }\n}}\n"),
        (LanguageId::Ruby, "c1_ok_elsif.rb", "def f\n  a = (\n  if x\n    1\n  elsif y and\n    z\n  end\nend\n", "def f\n  a = (\n  if x\n    1\n  elsif y1 and\n    z\n  end\nend\n"),
        (LanguageId::Python, "c1_ok_elif.py", "def f():\n  a = (\n  if x:\n    pass\n  elif y and\n    z:\n    pass\n", "def f():\n  a = (\n  if x:\n    pass\n  elif y1 and\n    z:\n    pass\n"),
        (LanguageId::Rust, "c1_ok_else_if.rs", "fn f() {\n  let a = (\n  if x {\n  } else if y &&\n    z {\n  }\n}\n", "fn f() {\n  let a = (\n  if x {\n  } else if y1 &&\n    z {\n  }\n}\n"),
        (LanguageId::JavaScript, "c2_ok_div_regex.js", "function f(x1) {\n  const a = (\n  const y = (x / /[/*]/ +\n}\n", "function f(x1) {\n  const a = (\n  const y1 = (x1 / /[/*]/ +\n}\n"),
        (LanguageId::JavaScript, "c2_ok_obj_default.js", "function f(obj, x1) {\n  const a = (\n  const y = (obj.default / x /\n}\n", "function f(obj, x1) {\n  const a = (\n  const y1 = (obj.default / x1 /\n}\n"),
        (LanguageId::Rust, "c3_ok_nested_blk.rs", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still */ let y = (1 +\n}\n", "fn f() {\n  let a = (\n  /* outer /* inner */\n     still */ let y1 = (1 +\n}\n"),
        (LanguageId::Python, "c5_ok_not.py", "def f():\n  a = (\n  y = (not\n", "def f():\n  a = (\n  y1 = (not\n"),
        (LanguageId::JavaScript, "c5_ok_colon.js", "function f() {\n  const a = (\n  const y = (c ? b :\n}\n", "function f() {\n  const a = (\n  const y1 = (c ? b :\n}\n"),
        (LanguageId::JavaScript, "c5_ok_dot.js", "function f() {\n  const a = (\n  const y = (obj.\n}\n", "function f() {\n  const a = (\n  const y1 = (obj.\n}\n"),
        (LanguageId::Python, "c5_ok_float_dot.py", "def f():\n  a = (\n  y = (1.\n", "def f():\n  a = (\n  y1 = (1.\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid for {p}");
    }
}

#[test]
fn regression_iter12_all_findings() {
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;
    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Explorer 1: Challenges 1-3 (no panic on a /\n  /b/, depth > 8 chains, non-nesting /* outer /* inner */)
    for (lang, p) in [
        (LanguageId::JavaScript, "c1_ml_div.js"),
        (LanguageId::TypeScript, "c1_ml_div.ts"),
        (LanguageId::Tsx, "c1_ml_div.tsx"),
    ] {
        let base_ok = "/* ok */\nconst r = a /\n  /b/;\nconst z = (\nconst y = 1;\n";
        let cand_ok = "/* ok */\nconst r = a /\n  /b/;\nconst z = (\nconst y = 2;\n";
        assert!(fw.verify_incremental(Some(base_ok), cand_ok, Path::new(p), lang).is_valid(), "Challenge 1 valid control {p}");

        let base_bad = "/* ok */\nconst r = a /\n  /b/;\nconst z = (\nconst y = 1 +\n";
        let cand_bad = "/* ok */\nconst r = a /\n  /b/;\nconst z = (\nconst y1 = 1 + *\n";
        assert!(!fw.verify_incremental(Some(base_bad), cand_bad, Path::new(p), lang).is_valid(), "Challenge 1 invalid {p}");
    }
    let ch10_div_b = "const a = (\nconst y = (/a/ / /b/ / /c/ / /d/ / /e/ / /f/ / /g/ / /h/ / /i/ / /j/ / /[/*]/ +\n";
    let ch10_div_c = "const a = (\nconst y1 = (/a/ / /b/ / /c/ / /d/ / /e/ / /f/ / /g/ / /h/ / /i/ / /j/ / /[/*]/ + *\n";
    assert!(!fw.verify_incremental(Some(ch10_div_b), ch10_div_c, Path::new("c2_div10.js"), LanguageId::JavaScript).is_valid());
    let ch10_blk_b = "const a = (\nconst y = (/*1*//*2*//*3*//*4*//*5*//*6*//*7*//*8*//*9*//*10*/ /[/*]/ +\n";
    let ch10_blk_c = "const a = (\nconst y1 = (/*1*//*2*//*3*//*4*//*5*//*6*//*7*//*8*//*9*//*10*/ /[/*]/ + *\n";
    assert!(!fw.verify_incremental(Some(ch10_blk_b), ch10_blk_c, Path::new("c2_blk10.js"), LanguageId::JavaScript).is_valid());
    let ch3_b = "const a = (\nconst y = /* outer /* inner */ /[/*]/ +\n";
    let ch3_c = "const a = (\nconst y1 = /* outer /* inner */ /[/*]/ + *\n";
    assert!(!fw.verify_incremental(Some(ch3_b), ch3_c, Path::new("c3_nest.js"), LanguageId::JavaScript).is_valid());
    assert!(fw.verify_incremental(Some(ch3_b), "const a = (\nconst y1 = /* outer /* inner */ /[/*]/ +\n", Path::new("c3_ok.js"), LanguageId::JavaScript).is_valid());
    let patho = format!("const a = (\nconst x = {}\nconst y = 1;\n", "/[".repeat(4000));
    let patho2 = format!("const a = (\nconst x = {}\nconst y = 2;\n", "/[".repeat(4000));
    assert!(fw.verify_incremental(Some(&patho), &patho2, Path::new("patho.js"), LanguageId::JavaScript).is_valid());

    // Explorer 2: Cluster B & Challenge 4 (multi-line strings containing /* in prefix_lines)
    for (lang, p, b, c_bad, c_ok) in [
        (
            LanguageId::Rust, "cb_rs_str.rs",
            "fn f() {\n  let a = (\n  let s = \"hello\n/* world\";\n  let y = 1 +\n}\n",
            "fn f() {\n  let a = (\n  let s = \"hello\n/* world\";\n  let y1 = 1 + *\n}\n",
            "fn f() {\n  let a = (\n  let s = \"hello\n/* world\";\n  let y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Rust, "cb_rs_bstr.rs",
            "fn f() {\n  let a = (\n  let s = b\"hello\n/* world\";\n  let y = 1 +\n}\n",
            "fn f() {\n  let a = (\n  let s = b\"hello\n/* world\";\n  let y1 = 1 + *\n}\n",
            "fn f() {\n  let a = (\n  let s = b\"hello\n/* world\";\n  let y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Rust, "cb_rs_raw.rs",
            "fn f() {\n  let a = (\n  let s = r#\"hello\n/* world\"#;\n  let y = 1 +\n}\n",
            "fn f() {\n  let a = (\n  let s = r#\"hello\n/* world\"#;\n  let y1 = 1 + *\n}\n",
            "fn f() {\n  let a = (\n  let s = r#\"hello\n/* world\"#;\n  let y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Php, "cb_php_str.php",
            "<?php\nfunction f() {\n  $a = (;\n  $s = \"hello\n/* world\";\n  $y = 1 +\n}\n",
            "<?php\nfunction f() {\n  $a = (;\n  $s = \"hello\n/* world\";\n  $y1 = 1 + *\n}\n",
            "<?php\nfunction f() {\n  $a = (;\n  $s = \"hello\n/* world\";\n  $y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Php, "cb_php_heredoc.php",
            "<?php\nfunction f() {\n  $a = (;\n  $s = <<<EOT\n/*\nEOT;\n  $y = 1 +\n}\n",
            "<?php\nfunction f() {\n  $a = (;\n  $s = <<<EOT\n/*\nEOT;\n  $y1 = 1 + *\n}\n",
            "<?php\nfunction f() {\n  $a = (;\n  $s = <<<EOT\n/*\nEOT;\n  $y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Java, "cb_java_tb.java",
            "class C { void f() {\n  int a = (;\n  String s = \"\"\"\n/*\n\"\"\";\n  int y = 1 +\n} }\n",
            "class C { void f() {\n  int a = (;\n  String s = \"\"\"\n/*\n\"\"\";\n  int y1 = 1 + /\n} }\n",
            "class C { void f() {\n  int a = (;\n  String s = \"\"\"\n/*\n\"\"\";\n  int y1 = 1 +\n} }\n",
        ),
        (
            LanguageId::CSharp, "cb_cs_verb.cs",
            "class C { void f() {\n  var a = (;\n  var s = @\"\n/*\n\";\n  var y = 1 +\n} }\n",
            "class C { void f() {\n  var a = (;\n  var s = @\"\n/*\n\";\n  var y1 = 1 + *\n} }\n",
            "class C { void f() {\n  var a = (;\n  var s = @\"\n/*\n\";\n  var y1 = 1 +\n} }\n",
        ),
        (
            LanguageId::CSharp, "cb_cs_interp_raw.cs",
            "class C { void f() {\n  var a = (;\n  var s = @$\"\n/*\n\";\n  var t = \"\"\"\n/*\n\"\"\";\n  var y = 1 +\n} }\n",
            "class C { void f() {\n  var a = (;\n  var s = @$\"\n/*\n\";\n  var t = \"\"\"\n/*\n\"\"\";\n  var y1 = 1 + *\n} }\n",
            "class C { void f() {\n  var a = (;\n  var s = @$\"\n/*\n\";\n  var t = \"\"\"\n/*\n\"\"\";\n  var y1 = 1 +\n} }\n",
        ),
        (
            LanguageId::Cpp, "cb_cpp_raw.cpp",
            "void f() {\n  int a = (;\n  const char* s = R\"(\n/*\n)\";\n  int y = 1 +\n}\n",
            "void f() {\n  int a = (;\n  const char* s = R\"(\n/*\n)\";\n  int y1 = 1 + /\n}\n",
            "void f() {\n  int a = (;\n  const char* s = R\"(\n/*\n)\";\n  int y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Cpp, "cb_cpp_raw_delim.cpp",
            "void f() {\n  int a = (;\n  const char* s = u8R\"delim(\n/*\n)delim\";\n  int y = 1 +\n}\n",
            "void f() {\n  int a = (;\n  const char* s = u8R\"delim(\n/*\n)delim\";\n  int y1 = 1 + /\n}\n",
            "void f() {\n  int a = (;\n  const char* s = u8R\"delim(\n/*\n)delim\";\n  int y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Kotlin, "cb_kt_raw.kt",
            "fun f() {\n  val a = (\n  val s = \"\"\"\n/*\n\"\"\"\n  val y = 1 +\n}\n",
            "fun f() {\n  val a = (\n  val s = \"\"\"\n/*\n\"\"\"\n  val y1 = 1 + *\n}\n",
            "fun f() {\n  val a = (\n  val s = \"\"\"\n/*\n\"\"\"\n  val y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Dart, "cb_dart_raw.dart",
            "void f() {\n  var a = (;\n  var s = r'''\n/*\n''';\n  var y = (1 +\n}\n",
            "void f() {\n  var a = (;\n  var s = r'''\n/*\n''';\n  var y = (1 + *\n}\n",
            "void f() {\n  var a = (;\n  var s = r'''\n/*\n''';\n  var y = (2 +\n}\n",
        ),
        // Genuine unclosed single-line `"` followed by real `/*` comment
        (
            LanguageId::Java, "cb_java_unclosed_sl_then_blk.java",
            "class C { void f() {\n  String s = \"unclosed\n  /* real blk\n  int y = 1 +\n  */\n} }\n",
            "class C { void f() {\n  String s = \"unclosed\n  /* real blk\n  int y = 1 +\n  let bad = 1 + /\n} }\n",
            "class C { void f() {\n  String s = \"unclosed\n  /* real blk\n  int y1 = 1 +\n  */\n} }\n",
        ),
        // Rust UTF-8 char literal `'🚀'` before `/*`
        (
            LanguageId::Rust, "cb_rs_utf8_char.rs",
            "fn f() {\n  let a = (\n  let c = '🚀';\n  let s = \"café\n/* world\";\n  let y = 1 +\n}\n",
            "fn f() {\n  let a = (\n  let c = '🚀';\n  let s = \"café\n/* world\";\n  let y1 = 1 + *\n}\n",
            "fn f() {\n  let a = (\n  let c = '🚀';\n  let s = \"café\n/* world\";\n  let y1 = 1 +\n}\n",
        ),
    ] {
        assert!(!fw.verify_incremental(Some(b), c_bad, Path::new(p), lang).is_valid(), "Cluster B invalid {p}");
        let res_ok = fw.verify_incremental(Some(b), c_ok, Path::new(p), lang);
        assert!(res_ok.is_valid(), "Cluster B valid control {p}: {res_ok:?}");
    }

    // Explorer 3: Cluster A — extra closer + inner corruption `(1 + ) * 2)`
    for (lang, p, b, c) in [
        (LanguageId::Kotlin, "ca_1x1_kt.kt", "fun f() {\n  val a = (\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) * 2)\n}\n"),
        (LanguageId::Kotlin, "ca_2x2_kt.kt", "fun f() {\n  val a = (\n  val y = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y = (1 +\n  val y1 = (1 + ) * 2)\n}\n"),
        (LanguageId::TypeScript, "ca_2x2_ts.ts", "function f() {\n  const a = (\n  const y = (1 +\n  const y = (1 +\n}\n", "function f() {\n  const a = (\n  const y = (1 +\n  const y1 = (1 + ) * 2)\n}\n"),
        (LanguageId::Go, "ca_2x2_go.go", "package p\nfunc f() {\n  a := (\n  y := (1 +\n  y := (1 +\n}\n", "package p\nfunc f() {\n  a := (\n  y := (1 +\n  y1 := (1 + ) * 2)\n}\n"),
        // Cluster D — C/C++ 2x2 & 2x1 `[1 + ] * 2`
        (LanguageId::C, "cd_2x2_c.c", "void f(void) {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n}\n", "void f(void) {\n  int a = (\n  int x1 = [1 +\n  int y1 = [1 + ] * 2\n}\n"),
        (LanguageId::Cpp, "cd_2x2_cpp.cpp", "void f() {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n}\n", "void f() {\n  int a = (\n  int x1 = [1 +\n  int y1 = [1 + ] * 2\n}\n"),
        (LanguageId::C, "cd_2x1_c.c", "void f(void) {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n}\n", "void f(void) {\n  int a = (\n  int y1 = [1 + ] * 2\n}\n"),
        (LanguageId::Cpp, "cd_2x1_cpp.cpp", "void f() {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n}\n", "void f() {\n  int a = (\n  int y1 = [1 + ] * 2\n}\n"),
        // Negative controls: 2x1 Kotlin merge & 1x2 trailing op
        (LanguageId::Kotlin, "cc_neg_2x1_kt.kt", "fun f() {\n  val a = (\n  val x = (1 +\n  val y = (1 +\n}\n", "fun f() {\n  val a = (\n  val y1 = (1 + ) *\n}\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Invalid {p}");
    }

    // Cluster A valid unmatched-closer controls + Cluster C PHP arrow + Cluster D valid C/C++ 2x2 rename
    for (lang, p, b, c) in [
        (LanguageId::TypeScript, "ca_ok_close_ts.ts", "function f() {\n  const x = (\n  const y = foo(\n    a,\n    1\n  )\n}\n", "function f() {\n  const x = (\n  const y = foo(\n    a,\n    2\n  )\n}\n"),
        (LanguageId::TypeScript, "ca_ok_obj_close.ts", "function f() {\n  const x = (\n  foo({\n    a: 1\n  });\n}\n", "function f() {\n  const x = (\n  foo({\n    a: 2\n  });\n}\n"),
        (LanguageId::Kotlin, "ca_ok_sig_kt.kt", "fun f() {\n  val x = (\n  fun g(\n    a: Int\n  ): Unit {\n  }\n}\n", "fun f() {\n  val x = (\n  fun g(\n    b: Int\n  ): Unit {\n  }\n}\n"),
        (LanguageId::Php, "cc_ok_php_arrow.php", "<?php\nfunction f() {\n  $arr = [\n    1,\n    $foo->bar(),\n    2\n}\n", "<?php\nfunction f() {\n  $arr = [\n    1,\n    $foo\n      ->bar(),\n    2\n}\n"),
        (LanguageId::C, "cd_ok_2x2_c.c", "void f(void) {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n}\n", "void f(void) {\n  int a = (\n  int x1 = [1 +\n  int y1 = [1 +\n}\n"),
        (LanguageId::Cpp, "cd_ok_2x1_cpp.cpp", "void f() {\n  int a = (;\n  int x = 1;\n  int y = 2;\n}\n", "void f() {\n  int a = (;\n  int z = 3;\n}\n"),
    ] {
        assert!(fw.verify_incremental(Some(b), c, Path::new(p), lang).is_valid(), "expected Valid {p}");
    }

    // CSS `url(http://...) /*` must NOT ignore `/*` due to `//`
    let css_b = ".a { background: url(http://x); /*\n  color: red;\n}\n";
    let css_c = ".a { background: url(http://x); /*\n  color: blue;\n}\n";
    assert!(fw.verify_incremental(Some(css_b), css_c, Path::new("c.css"), LanguageId::Css).is_valid());

    // UTF-8 prefix truncation sweep across multi-line & JS regex snippets (zero panics)
    for (lang, p, sample) in [
        (LanguageId::JavaScript, "u.js", "const café = a /\n  /b/;\nconst s = `é🚀`;"),
        (LanguageId::Rust, "u.rs", "fn f() { let c = '🚀'; let s = \"café\\n/*\"; let r = r#\"é\"#; }"),
        (LanguageId::Python, "u.py", "s = \"\"\"café\\n🚀\"\"\""),
        (LanguageId::Java, "u.java", "String s = \"\"\"\ncafé\n🚀\n\"\"\";"),
        (LanguageId::Dart, "u.dart", "var s = r'''café🚀''';"),
        (LanguageId::Php, "u.php", "<?php\n$s = <<<EOT\ncafé🚀\nEOT;\n"),
    ] {
        for (idx, _) in sample.char_indices() {
            let prefix = &sample[..idx];
            let _ = fw.verify(prefix, Path::new(p), lang);
            let _ = fw.verify_incremental(Some(prefix), sample, Path::new(p), lang);
        }
    }

    // Direct `has_merged_edit_error` Cluster C & D guards (valid -> false; broken -> true)
    assert!(!has_merged_edit_error(LanguageId::JavaScript, Path::new("c.js"), &mut pool, &["  const x = foo().bar();"], &["  const x = foo()", "    ?.bar();"], 1));
    assert!(!has_merged_edit_error(LanguageId::TypeScript, Path::new("c.ts"), &mut pool, &["  type X = Foo<A, B>;"], &["  type X = Foo<", "    A,", "    B", "  >;"], 1));
    assert!(!has_merged_edit_error(LanguageId::Rust, Path::new("c.rs"), &mut pool, &["  fn g<T: Clone>(x: T) {}"], &["  fn g<T>(x: T)", "  where T: Clone", "  {}"], 1));
    assert!(!has_merged_edit_error(LanguageId::Rust, Path::new("c.rs"), &mut pool, &["  fn g() -> i32 { 1 }"], &["  fn g()", "  -> i32", "  { 1 }"], 1));
    assert!(!has_merged_edit_error(LanguageId::Cpp, Path::new("c.cpp"), &mut pool, &["  template <typename T> void g(T x) {}"], &["  template <typename T>", "  void g(T x) {}"], 1));
    assert!(!has_merged_edit_error(LanguageId::JavaScript, Path::new("c.js"), &mut pool, &["  if (a"], &["  if (a &&", "  b) {}"], 1));
    assert!(!has_merged_edit_error(LanguageId::Cpp, Path::new("c.cpp"), &mut pool, &["  int x = [1 +", "  int y = [1 +"], &["  int x = [1 +"], 1));
    assert!(has_merged_edit_error(LanguageId::Rust, Path::new("c.rs"), &mut pool, &["  let a = 1;"], &["  let x = 1; // c", "  let y = 2 +"], 1));
    assert!(has_merged_edit_error(LanguageId::Bash, Path::new("c.sh"), &mut pool, &["  if true; then", "    echo ok"], &["  if true; then", "    echo $("], 1));
}

#[test]
fn regression_iter13_all_clusters() {
    use aice_ast_engine::r5::snippet_lex::scan_unmasked_delims;
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;
    use std::time::Instant;

    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Cluster 1a: `ends_with_js_regex` with multi-line `//` comment and trailing `/regex/`
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript,
        Path::new("obj.js"),
        &mut pool,
        &["  x = 1", "  y = 2"],
        &["  a: 1, // c", "  b: /a/"],
        0
    ));
    assert!(!has_merged_edit_error(
        LanguageId::TypeScript,
        Path::new("obj.ts"),
        &mut pool,
        &["  x = 1", "  y = 2"],
        &["  a: 1, // \"unclosed", "  b: /a/"],
        0
    ));
    assert!(has_merged_edit_error(
        LanguageId::TypeScript,
        Path::new("obj.ts"),
        &mut pool,
        &["  x = 1", "  y = 2"],
        &["  a: \"unclosed", "  b: /a/"],
        0
    ));
    // Cluster 1b: `match_js_regex_body` O(n) scaling on `"/[".repeat(25000) + "]"` (< 50 ms)
    let patho_rbrack = format!("{}]", "/[".repeat(25000));
    let t0 = Instant::now();
    let (stk, unm) = scan_unmasked_delims(LanguageId::JavaScript, &patho_rbrack, &[]);
    let elapsed_ms = t0.elapsed().as_millis();
    let limit_ms = if cfg!(debug_assertions) { 2_000 } else { 200 };
    assert!(elapsed_ms < limit_ms, "pathological /[... ] scan took {elapsed_ms} ms (limit {limit_ms} ms)");
    assert_eq!(unm, 0);
    assert_eq!(stk.len(), 24999);
    // Cluster 2: statement-header `)`, block vs expr `}`, `for (... of /regex/)`, and negative controls
    for (lang, p, b, c_bad, c_ok) in [
        (
            LanguageId::JavaScript, "c2_if_regex.js",
            "function f(x) {\n  const a = (;\n  if (x) /[/*]/.test(\"a\");\n  const y = 1 +\n}\n",
            "function f(x) {\n  const a = (;\n  if (x) /[/*]/.test(\"a\");\n  const y1 = 1 + *\n}\n",
            "function f(x) {\n  const a = (;\n  if (x) /[/*]/.test(\"a\");\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::TypeScript, "c2_while_regex.ts",
            "function f(x: boolean) {\n  const a = (;\n  while (x) /[/*]/.test(\"a\");\n  const y = 1 +\n}\n",
            "function f(x: boolean) {\n  const a = (;\n  while (x) /[/*]/.test(\"a\");\n  const y1 = 1 + *\n}\n",
            "function f(x: boolean) {\n  const a = (;\n  while (x) /[/*]/.test(\"a\");\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c2_for_regex.js",
            "function f() {\n  const a = (;\n  for (;;) /[/*]/.test(\"a\");\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  for (;;) /[/*]/.test(\"a\");\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  for (;;) /[/*]/.test(\"a\");\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::Tsx, "c2_else_if_regex.tsx",
            "function f(x: boolean, y0: boolean) {\n  const a = (;\n  if (x) g(); else if (foo(y0)) /[/*]/.test(\"a\");\n  const y = 1 +\n}\n",
            "function f(x: boolean, y0: boolean) {\n  const a = (;\n  if (x) g(); else if (foo(y0)) /[/*]/.test(\"a\");\n  const y1 = 1 + *\n}\n",
            "function f(x: boolean, y0: boolean) {\n  const a = (;\n  if (x) g(); else if (foo(y0)) /[/*]/.test(\"a\");\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c2_fn_rbrace_nl.js",
            "const a = (\nfunction g() {}\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nfunction g() {}\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nfunction g() {}\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_if_rbrace_sameline.js",
            "const a = (\nif (x) { f(); } /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nif (x) { f(); } /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nif (x) { f(); } /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_if_rbrace_nl.ts",
            "const a = (\nif (x) { f(); }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nif (x) { f(); }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nif (x) { f(); }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_class_rbrace.js",
            "const a = (\nclass C {}\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nclass C {}\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nclass C {}\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_arrow_rbrace.js",
            "const a = (\nconst f = () => { return 1; }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nconst f = () => { return 1; }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nconst f = () => { return 1; }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_lbl_rbrace.js",
            "const a = (\nlbl: { f(); } /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_for_of_regex.js",
            "const a = (\nfor (const m of /[/*]/.exec(s) || []) {}\nconst y = 1 +\n",
            "const a = (\nfor (const m of /[/*]/.exec(s) || []) {}\nconst y1 = 1 + *\n",
            "const a = (\nfor (const m of /[/*]/.exec(s) || []) {}\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_for_await_of_regex.ts",
            "async function f(s: any) {\n  const a = (;\n  for await (const x of /[/*]/.exec(s) || []) {}\n  const y = 1 +\n}\n",
            "async function f(s: any) {\n  const a = (;\n  for await (const x of /[/*]/.exec(s) || []) {}\n  const y1 = 1 + *\n}\n",
            "async function f(s: any) {\n  const a = (;\n  for await (const x of /[/*]/.exec(s) || []) {}\n  const y1 = 1 +\n}\n",
        ),
        // Negative controls: division after object literal / `of` / `obj.of` / `foo(x)` / `obj.if(x)`
        (
            LanguageId::JavaScript, "c2_neg_obj_div.js",
            "const a = (\nconst obj = { a: 1 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst obj = { a: 1 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst obj = { a: 1 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_neg_of_div.js",
            "const a = (\nconst x = of / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = of / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = of / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_neg_obj_of_div.js",
            "const a = (\nconst x = obj.of / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = obj.of / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = obj.of / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_neg_foo_div.js",
            "const a = (\nconst x = foo(x) / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = foo(x) / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = foo(x) / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_neg_obj_if_div.js",
            "const a = (\nconst x = obj.if(x) / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = obj.if(x) / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = obj.if(x) / /[/*]/;\nconst y1 = 1 +\n",
        ),
        // Cluster 3: template literal `${ ... }` interpolation nesting
        (
            LanguageId::JavaScript, "c3_tmpl_bt_in_quote.js",
            "function f() {\n  const a = (;\n  const s = `hello ${\"`\"}\n/*`;\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  const s = `hello ${\"`\"}\n/*`;\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  const s = `hello ${\"`\"}\n/*`;\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::TypeScript, "c3_tmpl_nested.ts",
            "function f() {\n  const a = (;\n  const s = `x ${`a ${\"`\"}`}\n/*`;\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  const s = `x ${`a ${\"`\"}`}\n/*`;\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  const s = `x ${`a ${\"`\"}`}\n/*`;\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c3_tmpl_regex_obj.js",
            "function f() {\n  const a = (;\n  const s = `a ${ /[\"`]/ } ${ { k: 1 } }\n/*`;\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  const s = `a ${ /[\"`]/ } ${ { k: 1 } }\n/*`;\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  const s = `a ${ /[\"`]/ } ${ { k: 1 } }\n/*`;\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c3_tmpl_rbrace_in_parts.js",
            "function f() {\n  const a = (;\n  const s = `a ${\"}\"} ${ /}/ } ${ /* } */ 1 }\n/*`;\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  const s = `a ${\"}\"} ${ /}/ } ${ /* } */ 1 }\n/*`;\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  const s = `a ${\"}\"} ${ /}/ } ${ /* } */ 1 }\n/*`;\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c2_fn_expr_div.js",
            "const a = (\nconst f = function() {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function() {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function() {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_switch_do_try.js",
            "const a = (\nswitch (x) { case 1: { f(); } /[/*]/; } do { f(); } while (x) /[/*]/; try {} catch (e) {} finally {} /[/*]/;\nconst y = 1 +\n",
            "const a = (\nswitch (x) { case 1: { f(); } /[/*]/; } do { f(); } while (x) /[/*]/; try {} catch (e) {} finally {} /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nswitch (x) { case 1: { f(); } /[/*]/; } do { f(); } while (x) /[/*]/; try {} catch (e) {} finally {} /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_for_nested_of_div.js",
            "const a = (\nfor (const m of foo(of / /[/*]/)) {}\nconst y = 1 +\n",
            "const a = (\nfor (const m of foo(of / /[/*]/)) {}\nconst y1 = 1 + *\n",
            "const a = (\nfor (const m of foo(of / /[/*]/)) {}\nconst y1 = 1 +\n",
        ),
    ] {
        assert!(!fw.verify_incremental(Some(b), c_bad, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
        let res_ok = fw.verify_incremental(Some(b), c_ok, Path::new(p), lang);
        assert!(res_ok.is_valid(), "expected Valid for {p}: {res_ok:?}");
    }

    // Cluster 3 additional: nested unclosed `(` inside `${...}` and UTF-8 truncation safety
    let (stk_t, _) = scan_unmasked_delims(LanguageId::JavaScript, "const s = `a ${(1 +}`;", &[]);
    assert_eq!(stk_t, vec![b'(']);
    let utf8_tmpl = "const s = `café ${\"🚀`\"}\n/*`;";
    for (idx, _) in utf8_tmpl.char_indices() {
        let _ = fw.verify(&utf8_tmpl[..idx], Path::new("u_tmpl.js"), LanguageId::JavaScript);
    }

    // Cluster 4: C++ 3x2 `[1 + ] * 2` end-to-end and `has_merged_edit_error`
    assert!(!fw.verify_incremental(
        Some("void f() {\n  int a = (\n  int x = [1 +\n  int y = [1 +\n  int z = [1 +\n}\n"),
        "void f() {\n  int a = (\n  int x1 = [1 +\n  int y1 = [1 + ] * 2\n}\n",
        Path::new("adv_cd_3x2.cpp"),
        LanguageId::Cpp
    ).is_valid());
    assert!(has_merged_edit_error(
        LanguageId::Cpp,
        Path::new("adv_cd_3x2.cpp"),
        &mut pool,
        &["  int x = [1 +", "  int y = [1 +", "  int z = [1 +"],
        &["  int x1 = [1 +", "  int y1 = [1 + ] * 2"],
        3
    ));
    assert!(!has_merged_edit_error(
        LanguageId::Cpp,
        Path::new("adv_cd_3x2_ok.cpp"),
        &mut pool,
        &["  int x = [1 +", "  int y = [1 +", "  int z = [1 +"],
        &["  int x1 = [1 +", "  int y1 = [1 +"],
        3
    ));

    // Cluster 5: partial-hunk edge cases & Rust struct-field in fn guard
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5.js"), &mut pool,
        &["  const x = a +"], &["  const x = a +", "    c +"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5.js"), &mut pool,
        &["  foo("], &["  bar(", "    10,", "    20,"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5.js"), &mut pool,
        &["  if (a"], &["  if (a &&", "    b) {"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("c5.rs"), &mut pool,
        &["  let b = 1;"], &["  x: i32,", "  y: i32,"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::Rust, Path::new("c5_struct.rs"), &mut pool,
        &["  x: i32,"], &["  x: i64,", "  y: String,"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::Rust, Path::new("c5_enum.rs"), &mut pool,
        &["  A,"], &["  A(i32),", "  B,"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5_neg.js"), &mut pool,
        &["  const x = a +"], &["  const x = a +", "    c + *"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5_neg2.js"), &mut pool,
        &["  let a = 1;"], &["  let a = 1;", "  let y = 2 +"], 0
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c5_neg3.js"), &mut pool,
        &["  let a = 1;"], &["  foo(", "    10,", "    20,"], 0
    ));
}

#[test]
fn regression_iter14_all_clusters() {
    use aice_ast_engine::r5::snippet_lex::scan_unmasked_delims;
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;

    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Clusters 1-3: scoped ternary_scopes, TS return-type / generic-default braces,
    // (\nfunction() {}) vs (\nfunction g() {}), ASI after break/continue/debugger, TS type T = { ... }
    for (lang, p, b, c_bad, c_ok) in [
        // Cluster 1: ternary with object literals & TS optional tuples/params/fields
        (
            LanguageId::JavaScript, "c1_ternary_obj_div.js",
            "const a = (\nconst x = cond ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = cond ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = cond ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c1_ternary_nested_obj.js",
            "const a = (\nconst x = a ? b ? { c: 1 } : { d: 2 } : { e: 3 } / Number(\"1/2\") + \"/*\";\nconst y = 1 +\n",
            "const a = (\nconst x = a ? b ? { c: 1 } : { d: 2 } : { e: 3 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 + *\n",
            "const a = (\nconst x = a ? b ? { c: 1 } : { d: 2 } : { e: 3 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c1_ternary_in_obj.js",
            "const a = (\nconst o = { k: c ? { x: 1 } : { y: 2 } } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst o = { k: c ? { x: 1 } : { y: 2 } } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst o = { k: c ? { x: 1 } : { y: 2 } } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c1_ternary_opt_chain.js",
            "const a = (\nconst x = obj?.prop ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = obj?.prop ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = obj?.prop ? { a: 1 } : { b: 2 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c1_ternary_fn_semi.js",
            "const a = (\nconst x = c ? function() { a; b; } : { c: 1 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst x = c ? function() { a; b; } : { c: 1 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst x = c ? function() { a; b; } : { c: 1 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c1_ts_opt_tuple_lbl.ts",
            "const a = (\ntype T = [string, number?]\nlbl: { f(); } /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype T = [string, number?]\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype T = [string, number?]\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c1_ts_opt_field_lbl.ts",
            "const a = (\ntype O = { a?: number }\nlbl: { f(); } /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype O = { a?: number }\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype O = { a?: number }\nlbl: { f(); } /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c1_ts_opt_param_lbl.ts",
            "const a = (\nfunction p(x?: string) {} /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nfunction p(x?: string) {} /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nfunction p(x?: string) {} /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        // Cluster 2a: TS/TSX return-type & generic-default braces
        (
            LanguageId::TypeScript, "c2_ts_fn_ret_obj.ts",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::Tsx, "c2_tsx_fn_ret_obj.tsx",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_ret_union.ts",
            "const a = (\nconst f = function(): { a: number } | { b: string } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function(): { a: number } | { b: string } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function(): { a: number } | { b: string } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_ret_prim.ts",
            "const a = (\nconst f = function(): number { return 1; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function(): number { return 1; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function(): number { return 1; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_ret_void.ts",
            "const a = (\nconst f = function(): void {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function(): void {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function(): void {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_decl_ret_obj.ts",
            "const a = (\nfunction g(): { a: number } { return { a: 1 }; }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nfunction g(): { a: number } { return { a: 1 }; }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nfunction g(): { a: number } { return { a: 1 }; }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_async_fn_ret.ts",
            "const a = (\nconst f = async function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = async function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = async function(): { a: number } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_generic_def.ts",
            "const a = (\nconst f = function<T = { a: number }>() {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function<T = { a: number }>() {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function<T = { a: number }>() {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_fn_nested_generic.ts",
            "const a = (\nconst f = function<T = Partial<{ a: number }>>(): (x: number) => { b: number } { return () => ({ b: 1 }); } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst f = function<T = Partial<{ a: number }>>(): (x: number) => { b: number } { return () => ({ b: 1 }); } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst f = function<T = Partial<{ a: number }>>(): (x: number) => { b: number } { return () => ({ b: 1 }); } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c2_ts_class_generic_def.ts",
            "const a = (\nclass C<T = { a: number }> {}\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nclass C<T = { a: number }> {}\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nclass C<T = { a: number }> {}\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        // Cluster 2b: (\nfunction() {}) vs export default function() {}
        (
            LanguageId::JavaScript, "c2_lparen_nl_anon_fn.js",
            "const a = (;\nconst x = (\nfunction() {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\nfunction() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\nfunction() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_lparen_nl_async_anon_fn.js",
            "const a = (;\nconst x = (\nasync function() {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\nasync function() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\nasync function() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c2_export_default_anon_fn.js",
            "const a = (\nexport default function() {}\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nexport default function() {}\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nexport default function() {}\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        // Cluster 3: ASI after break/continue/debugger & TS type T = { ... }
        (
            LanguageId::JavaScript, "c3_break_asi.js",
            "const a = (;\nfor (;;) {\n  break\n  /[/*]/.test(\"a\")\n}\nconst y = 1 +\n",
            "const a = (;\nfor (;;) {\n  break\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 + *\n",
            "const a = (;\nfor (;;) {\n  break\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c3_break_lbl_asi.js",
            "const a = (;\nouter: for (;;) {\n  break outer\n  /[/*]/.test(\"a\")\n}\nconst y = 1 +\n",
            "const a = (;\nouter: for (;;) {\n  break outer\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 + *\n",
            "const a = (;\nouter: for (;;) {\n  break outer\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c3_continue_asi.js",
            "const a = (;\nfor (;;) {\n  continue\n  /[/*]/.test(\"a\")\n}\nconst y = 1 +\n",
            "const a = (;\nfor (;;) {\n  continue\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 + *\n",
            "const a = (;\nfor (;;) {\n  continue\n  /[/*]/.test(\"a\")\n}\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c3_debugger_asi.js",
            "const a = (;\ndebugger\n/[/*]/.test(\"a\")\nconst y = 1 +\n",
            "const a = (;\ndebugger\n/[/*]/.test(\"a\")\nconst y1 = 1 + *\n",
            "const a = (;\ndebugger\n/[/*]/.test(\"a\")\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c3_ts_type_obj.ts",
            "const a = (\ntype T = { a: number }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c3_ts_type_generic_union.ts",
            "const a = (\ntype T<U = { k: 1 }> = { a: U } | { b: string }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype T<U = { k: 1 }> = { a: U } | { b: string }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype T<U = { k: 1 }> = { a: U } | { b: string }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c3_ts_const_type_div.ts",
            "const a = (\nconst type = { a: 1 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst type = { a: 1 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst type = { a: 1 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c3_ts_obj_type_div.ts",
            "const a = (\nobj.type = { a: 1 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nobj.type = { a: 1 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nobj.type = { a: 1 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
    ] {
        assert!(!fw.verify_incremental(Some(b), c_bad, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
        let res_ok = fw.verify_incremental(Some(b), c_ok, Path::new(p), lang);
        assert!(res_ok.is_valid(), "expected Valid for {p}: {res_ok:?}");
    }

    // Polarity positive control: real unclosed block comment after ExprBrace `/` masks trailing line
    assert!(fw.verify_incremental(
        Some("const a = (\nconst x = c ? { a: 1 } : { b: 2 } /[/*]/;\nconst y = 1 +\n"),
        "const a = (\nconst x = c ? { a: 1 } : { b: 2 } /[/*]/;\nconst y1 = 1 + *\n",
        Path::new("c1_real_blk.js"),
        LanguageId::JavaScript
    ).is_valid());
    let (stk_t1, unm_t1) = scan_unmasked_delims(
        LanguageId::JavaScript,
        "const x = cond ? { a: 1 } : { b: 2 } / (1 + 2 / 3);",
        &[],
    );
    assert!(stk_t1.is_empty() && unm_t1 == 0);

    // Cluster 4: unmatched-closer gate in hunk_completable_ok
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c4.js"), &mut pool,
        &["  let b = 1;"], &["  10,", "  20)"], 0
    ));
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("c4.rs"), &mut pool,
        &["  let b = 1;"], &["  10,", "  20)"], 0
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c4b.js"), &mut pool,
        &["  foo("], &["  bar(", "    10,", "    20))"], 1
    ));
    assert!(!fw.verify_incremental(
        Some("function f() {\n  const z = (;\n  let b = 1;\n}\n"),
        "function f() {\n  const z = (;\n  10,\n  20)\n}\n",
        Path::new("c4_e2e.js"),
        LanguageId::JavaScript
    ).is_valid());
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c4_ok.js"), &mut pool,
        &["  20)"], &["  10,", "  20)"], 1
    ));

    let rs_ins_ok = fw.verify_incremental(
        Some("struct S {\n  a: u32,\n"),
        "struct S {\n  a: u32,\n  b: i32,\n",
        Path::new("rs_open_struct.rs"),
        LanguageId::Rust
    );
    assert!(rs_ins_ok.is_valid(), "rs_open_struct: {rs_ins_ok:?}");
    assert!(!fw.verify_incremental(
        Some("struct S {\n  a: u32,\n"),
        "struct S {\n  a: u32,\n  let x = 1;\n",
        Path::new("rs_open_struct_bad_let.rs"),
        LanguageId::Rust
    ).is_valid());
    let rs_pre_ok = fw.verify_incremental(
        Some("struct S {\n  bad: (,\n  a: u32,\n"),
        "struct S {\n  bad: (,\n  a: u32,\n  b: i32,\n",
        Path::new("rs_prebroken_open_struct.rs"),
        LanguageId::Rust
    );
    assert!(rs_pre_ok.is_valid(), "rs_prebroken_open_struct: {rs_pre_ok:?}");
    assert!(!fw.verify_incremental(
        Some("struct S {\n  bad: (,\n  a: u32,\n"),
        "struct S {\n  bad: (,\n  a: u32,\n  let x = 1;\n",
        Path::new("rs_prebroken_open_struct_bad.rs"),
        LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("fn f() {\n  let a = 1;\n"),
        "fn f() {\n  let a = 1;\n  b: i32,\n",
        Path::new("rs_open_fn_bad_field.rs"),
        LanguageId::Rust
    ).is_valid());
    assert!(!has_merged_edit_error(
        LanguageId::Rust, Path::new("b5.rs"), &mut pool,
        &["struct S {", "  a: u32,"], &["struct S {", "  a: u32,", "  b: i32,"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("a8.rs"), &mut pool,
        &["  a: u32,"], &["  a: u32,", "  let x = 1;"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("b2.rs"), &mut pool,
        &["  a: u32,"], &["  let x = 1;", "  b: u32,"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Java, Path::new("U.java"), &mut pool,
        &["  int b = 1;"], &["  A,", "  B,"], 0
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("u.js"), &mut pool,
        &["  let b = 1;"], &["  foo,", "  bar,"], 0
    ));
    assert!(!has_merged_edit_error(
        LanguageId::Java, Path::new("E.java"), &mut pool,
        &["  A,"], &["  A,", "  B,"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::JavaScript, Path::new("arr.js"), &mut pool,
        &["  foo,"], &["  foo,", "  bar,"], 1
    ));
}
#[test]
fn regression_iter15_all_clusters() {
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;

    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Cluster 1: DeclFrame stack, TS declare/overload/interface/type scoping, and (\nfunction g())
    for (lang, p, b, c_bad, c_ok) in [
        (
            LanguageId::JavaScript, "c15_fn_default_arrow_semi.js",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()) {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()) {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()) {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_fn_default_arrow_semi.ts",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()): number { return 1; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()): number { return 1; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(a = (() => { let x = 1; })()): number { return 1; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_arrow_return_semi.js",
            "const a = (\nconst fn1 = function(x = () => { return 1; }) {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(x = () => { return 1; }) {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(x = () => { return 1; }) {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_ret_obj_semi_div.ts",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::Tsx, "c15_tsx_ret_obj_semi_div.tsx",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(): { a: number; } { return { a: 1 }; } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_fn_default_inner_fn.js",
            "const a = (\nconst fn1 = function(x = function() {}) {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(x = function() {}) {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(x = function() {}) {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_fn_default_inner_class.js",
            "const a = (\nconst fn1 = function(x = class {}) {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst fn1 = function(x = class {}) {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst fn1 = function(x = class {}) {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_class_extends_inner_class.js",
            "const a = (\nconst C = class extends (class {}) {} / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nconst C = class extends (class {}) {} / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nconst C = class extends (class {}) {} / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_type_semi_intersection.ts",
            "const a = (\ntype Obj = { a: number; } & { b: string }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype Obj = { a: number; } & { b: string }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype Obj = { a: number; } & { b: string }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_export_type_semi_union.ts",
            "const a = (\nexport type T = { a: number; } | { b: string }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nexport type T = { a: number; } | { b: string }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nexport type T = { a: number; } | { b: string }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_type_multiline_union.ts",
            "const a = (\ntype T = { a: number }\n| { b: string }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ntype T = { a: number }\n| { b: string }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ntype T = { a: number }\n| { b: string }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_declare_fn_void.ts",
            "const a = (\ndeclare function foo(x: number): void\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y = 1 +\n",
            "const a = (\ndeclare function foo(x: number): void\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 + *\n",
            "const a = (\ndeclare function foo(x: number): void\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_declare_fn_ret_obj.ts",
            "const a = (\ndeclare function foo(x: number): { k: number }\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y = 1 +\n",
            "const a = (\ndeclare function foo(x: number): { k: number }\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 + *\n",
            "const a = (\ndeclare function foo(x: number): { k: number }\nconst x = { a: 1 } / Number(\"1/2\") + \"/*\";\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_overload_no_semi.ts",
            "const a = (\nfunction foo(x: number): { a: number }\nconst x = { b: 1 } / /[/*]/;\nconst y = 1 +\n",
            "const a = (\nfunction foo(x: number): { a: number }\nconst x = { b: 1 } / /[/*]/;\nconst y1 = 1 + *\n",
            "const a = (\nfunction foo(x: number): { a: number }\nconst x = { b: 1 } / /[/*]/;\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_declare_lt_if.ts",
            "const a = (\ndeclare function foo(x: number): void\nconst b = x < y\nif (c) {} /[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ndeclare function foo(x: number): void\nconst b = x < y\nif (c) {} /[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ndeclare function foo(x: number): void\nconst b = x < y\nif (c) {} /[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_fn_ret_obj_nl_body_ok.ts",
            "const a = (\nfunction foo(): { a: number }\n{ const x = { b: 1 }; return x; }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nfunction foo(): { a: number }\n{ const x = { b: 1 }; return x; }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nfunction foo(): { a: number }\n{ const x = { b: 1 }; return x; }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_interface_generic_default.ts",
            "const a = (\ninterface Foo<T = { a: number }> { x: T }\n/[/*]/.test(\"/*\")\nconst y = 1 +\n",
            "const a = (\ninterface Foo<T = { a: number }> { x: T }\n/[/*]/.test(\"/*\")\nconst y1 = 1 + *\n",
            "const a = (\ninterface Foo<T = { a: number }> { x: T }\n/[/*]/.test(\"/*\")\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_declare_type.ts",
            "const a = (\ndeclare type T = { a: number }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\ndeclare type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\ndeclare type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_export_type_nl.ts",
            "const a = (\nexport type T = { a: number }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nexport type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nexport type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_export_declare_type.ts",
            "const a = (\nexport declare type T = { a: number }\n/[/*]/.test(s)\nconst y = 1 +\n",
            "const a = (\nexport declare type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 + *\n",
            "const a = (\nexport declare type T = { a: number }\n/[/*]/.test(s)\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::TypeScript, "c15_ts_type_after_unclosed_lparen.ts",
            "function f() {\n  const a = (;\n  const x = 1\n  type T = { a: number }\n  /[/*]/.test(s)\n  const y = 1 +\n}\n",
            "function f() {\n  const a = (;\n  const x = 1\n  type T = { a: number }\n  /[/*]/.test(s)\n  const y1 = 1 + *\n}\n",
            "function f() {\n  const a = (;\n  const x = 1\n  type T = { a: number }\n  /[/*]/.test(s)\n  const y1 = 1 +\n}\n",
        ),
        (
            LanguageId::JavaScript, "c15_js_lparen_nl_named_fn_expr.js",
            "const a = (;\nconst x = (\nfunction g() {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\nfunction g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\nfunction g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_js_lparen_nl_named_async_fn_expr.js",
            "const a = (;\nconst x = (\nasync function g() {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\nasync function g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\nasync function g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_js_lparen_nl_named_class_expr.js",
            "const a = (;\nconst x = (\nclass C {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\nclass C {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\nclass C {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
        (
            LanguageId::JavaScript, "c15_js_lparen_nl_indented_named_fn.js",
            "const a = (;\nconst x = (\n  function g() {} / Number(\"1/2\") + \"/*\");\nconst y = 1 +\n",
            "const a = (;\nconst x = (\n  function g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 + *\n",
            "const a = (;\nconst x = (\n  function g() {} / Number(\"1/2\") + \"/*\");\nconst y1 = 1 +\n",
        ),
    ] {
        assert!(!fw.verify_incremental(Some(b), c_bad, Path::new(p), lang).is_valid(), "expected Invalid for {p}");
        let res_ok = fw.verify_incremental(Some(b), c_ok, Path::new(p), lang);
        assert!(res_ok.is_valid(), "expected Valid for {p}: {res_ok:?}");
    }
    // Polarity positive control: real unclosed /* after ExprBrace / masks trailing line
    assert!(fw.verify_incremental(
        Some("const a = (\nconst fn1 = function(x = function() {}) {} /[/*]/;\nconst y = 1 +\n"),
        "const a = (\nconst fn1 = function(x = function() {}) {} /[/*]/;\nconst y1 = 1 + *\n",
        Path::new("c15_real_blk.js"),
        LanguageId::JavaScript
    ).is_valid());

    // Cluster 2: EOF-append soundness (`is_shifted_eof` + `context_insert_verdict`)
    assert!(!fw.verify_incremental(
        Some("const a = 1 +\n"), "const a = 1 +\nlet x = 2;\n",
        Path::new("c15_js_eof_plus.js"), LanguageId::JavaScript
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("const a = 1 +\n"), "const a = 1 +\nlet x = 2;\n",
        Path::new("c15_ts_eof_plus.ts"), LanguageId::TypeScript
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("fn f() {\n  let a = 1 +\n"), "fn f() {\n  let a = 1 +\n  let x = 2;\n",
        Path::new("c15_rs_eof_plus.rs"), LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("fn f() {\n  let a = (\n"), "fn f() {\n  let a = (\n  let x = 2;\n",
        Path::new("c15_rs_eof_paren.rs"), LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("fn f(x: i32) {\n  match x {\n    1 => {},\n"),
        "fn f(x: i32) {\n  match x {\n    1 => {},\n    let y = 1;\n",
        Path::new("c15_rs_match_let.rs"), LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some("interface I {\n  a: number;\n"),
        "interface I {\n  a: number;\n  let x = 1;\n",
        Path::new("c15_ts_iface_let.ts"), LanguageId::TypeScript
    ).is_valid());
    // Positive controls for Cluster 2
    assert!(fw.verify_incremental(
        Some("fn f() {\n  let a = 1 +\n"), "fn f() {\n  let a = 1 +\n  2;\n",
        Path::new("c15_rs_eof_plus_ok.rs"), LanguageId::Rust
    ).is_valid());
    assert!(fw.verify_incremental(
        Some("enum E {\n  A,\n"), "enum E {\n  A,\n  B(i32),\n",
        Path::new("c15_rs_enum_ok.rs"), LanguageId::Rust
    ).is_valid());
    assert!(fw.verify_incremental(
        Some("impl S {\n  fn a() {}\n"), "impl S {\n  fn a() {}\n  fn b() {}\n",
        Path::new("c15_rs_impl_ok.rs"), LanguageId::Rust
    ).is_valid());
    assert!(fw.verify_incremental(
        Some("fn f(x: i32) {\n  match x {\n    1 => {},\n"),
        "fn f(x: i32) {\n  match x {\n    1 => {},\n    2 => {},\n",
        Path::new("c15_rs_match_ok.rs"), LanguageId::Rust
    ).is_valid());
    assert!(fw.verify_incremental(
        Some("interface I {\n  a: number;\n"),
        "interface I {\n  a: number;\n  b: string;\n",
        Path::new("c15_ts_iface_ok.ts"), LanguageId::TypeScript
    ).is_valid());

    // Cluster 3: Valid EOF container closing with earlier pre-broken error
    for (lang, p, b, c_ok) in [
        (
            LanguageId::Rust, "c15_close_struct.rs",
            "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n",
            "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n  b: i32,\n}\n",
        ),
        (
            LanguageId::Rust, "c15_close_struct_only.rs",
            "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n",
            "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n}\n",
        ),
        (
            LanguageId::Rust, "c15_close_fn.rs",
            "fn broken() { let z = (; }\nfn ok() {\n  let x = 1;\n",
            "fn broken() { let z = (; }\nfn ok() {\n  let x = 1;\n  let y = 2;\n}\n",
        ),
        (
            LanguageId::JavaScript, "c15_close_js_fn.js",
            "function broken() { const z = (; }\nfunction ok() {\n  let x = 1;\n",
            "function broken() { const z = (; }\nfunction ok() {\n  let x = 1;\n  let y = 2;\n}\n",
        ),
        (
            LanguageId::JavaScript, "c15_close_lparen.js",
            "const bad = (;\nconst x = (\n  1 +\n  2\n",
            "const bad = (;\nconst x = (\n  1 +\n  2\n  );\n",
        ),
        (
            LanguageId::TypeScript, "c15_close_lparen.ts",
            "const bad = (;\nconst x = (\n  1 +\n  2\n",
            "const bad = (;\nconst x = (\n  1 +\n  2\n  );\n",
        ),
        (
            LanguageId::Rust, "c15_close_lbrack.rs",
            "fn bad() { let z = (; }\nfn ok() {\n  let v = [\n    1,\n    2\n",
            "fn bad() { let z = (; }\nfn ok() {\n  let v = [\n    1,\n    2\n  ];\n",
        ),
        (
            LanguageId::Rust, "c15_close_top_lbrack.rs",
            "let bad = (;\nlet v = [\n  1,\n  2\n",
            "let bad = (;\nlet v = [\n  1,\n  2\n];\n",
        ),
        (
            LanguageId::Java, "C15Close.java",
            "class C {\n  int bad = (;\n  int f() {\n    return foo(\n      1,\n      2\n",
            "class C {\n  int bad = (;\n  int f() {\n    return foo(\n      1,\n      2\n    );\n  }\n}\n",
        ),
    ] {
        let res = fw.verify_incremental(Some(b), c_ok, Path::new(p), lang);
        assert!(res.is_valid(), "expected Valid for {p}: {res:?}");
    }
    assert!(!fw.verify_incremental(
        Some("fn broken() { let z = (; }\nstruct S {\n  a: u32,\n"),
        "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n  b: i32,\n}}\n",
        Path::new("c15_close_struct_double_bad.rs"), LanguageId::Rust
    ).is_valid());

    // Cluster 4: Rust 4-line struct where-clause & enum struct variants
    let rs_4line = "pub struct S<T>\nwhere\n    T: Clone,\n    T: Default,\n{\n  a: T,\n";
    assert!(fw.verify_incremental(
        Some(rs_4line), &format!("{rs_4line}  b: u32,\n"),
        Path::new("c15_4line_struct.rs"), LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some(rs_4line), &format!("{rs_4line}  let x = 1;\n"),
        Path::new("c15_4line_struct_bad.rs"), LanguageId::Rust
    ).is_valid());
    let rs_enum_v = "enum E {\n  V {\n    a: u32,\n";
    assert!(fw.verify_incremental(
        Some(rs_enum_v), &format!("{rs_enum_v}    b: i32,\n"),
        Path::new("c15_enum_variant.rs"), LanguageId::Rust
    ).is_valid());
    assert!(fw.verify_incremental(
        Some(rs_enum_v), &format!("{rs_enum_v}    b: i32,\n  }}\n"),
        Path::new("c15_enum_variant_close.rs"), LanguageId::Rust
    ).is_valid());
    assert!(!fw.verify_incremental(
        Some(rs_enum_v), &format!("{rs_enum_v}    let x = 1;\n"),
        Path::new("c15_enum_variant_bad.rs"), LanguageId::Rust
    ).is_valid());

    // Cluster 5: bh_looks_like_container_body, allow_container, & type-body guard
    assert!(!fw.verify_incremental(
        Some("function f() {\n  const z = 1 +\n  foo()\n}\n"),
        "function f() {\n  const z = 1 +\n  10,\n  20,\n}\n",
        Path::new("c15_js_e2e.js"), LanguageId::JavaScript
    ).is_valid());
    for (lang, f, bh, ch) in [
        (LanguageId::JavaScript, "c15.js", &["  foo()"][..], &["  10,", "  20,"][..]),
        (LanguageId::Python, "c15.py", &["    x = 1", "    y = 2"], &["    10,", "    20,"]),
        (LanguageId::Go, "c15.go", &["  x := 1", "  y := 2"], &["  10,", "  20,"]),
        (LanguageId::Kotlin, "c15.kt", &["  val x = 1", "  val y = 2"], &["  10,", "  20,"]),
        (LanguageId::Ruby, "c15.rb", &["  x = 1", "  y = 2"], &["  10,", "  20,"]),
        (LanguageId::Rust, "c15.rs", &["  foo()"], &["  10,", "  20,"]),
    ] {
        assert!(has_merged_edit_error(lang, Path::new(f), &mut pool, bh, ch, 0), "expected true for {f}");
    }
    assert!(!fw.verify_incremental(
        Some("def f():\n    z = 1 + *\n    x = 1\n    y = 2\n"),
        "def f():\n    z1 = 1 + *\n    10,\n    20,\n",
        Path::new("c15_py_e2e.py"), LanguageId::Python
    ).is_valid());
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("c15_sf.rs"), &mut pool,
        &["  a: u32,"], &["  10,", "  20,"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Rust, Path::new("c15_sf2.rs"), &mut pool,
        &["  a: u32,", "  b: i32,"], &["  let x = 1;"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::Rust, Path::new("c15_sf2_ok.rs"), &mut pool,
        &["  a: u32,", "  b: i32,"], &["  c: bool,"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::Java, Path::new("C15Enum.java"), &mut pool,
        &["  A,"], &["  A,", "  int x = 1;"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::TypeScript, Path::new("c15_iface.ts"), &mut pool,
        &["  a: number;"], &["  a: number;", "  let x = 1;"], 1
    ));
    assert!(!has_merged_edit_error(
        LanguageId::TypeScript, Path::new("c15_iface_ok.ts"), &mut pool,
        &["  a: number;"], &["  a: number;", "  b: string;"], 1
    ));
    assert!(has_merged_edit_error(
        LanguageId::JavaScript, Path::new("c15_unm.js"), &mut pool,
        &["  20)"], &["  let x = 1;", "  20)"], 1
    ));
}

#[test]
fn regression_iter16_all_clusters() {
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;
    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Cluster 1a: Whitespace before_token ASI guards (6+ C2 bypasses + positive controls)
    for (name, base) in [
        (
            "c16_asi_ret_lbrace.ts",
            "const a = (\nconst f = function foo(): { a: number }\n  {\n    return { a: 1 };\n  } / /[/*]/;\nconst y = 1 +\n",
        ),
        (
            "c16_asi_fn_paren_lbrace.ts",
            "const a = (\nconst f = function foo(x: number)\n  {\n    return { a: 1 };\n  } / /[/*]/;\nconst y = 1 +\n",
        ),
        (
            "c16_asi_fn_paren_colon.ts",
            "const a = (\nconst f = function foo(x: number)\n  : { a: number }\n  {\n    return { a: 1 };\n  } / /[/*]/;\nconst y = 1 +\n",
        ),
        (
            "c16_asi_ret_pipe.ts",
            "const a = (\nconst f = function foo(): { a: number }\n  | { b: string }\n  {\n    return { a: 1 };\n  } / /[/*]/;\nconst y = 1 +\n",
        ),
        (
            "c16_asi_ret_cmt.ts",
            "const a = (\nconst f = function foo(): { a: number } /* cmt */\n  {\n    return { a: 1 };\n  } / /[/*]/;\nconst y = 1 +\n",
        ),
        (
            "c16_asi_type_pipe.ts",
            "const a = (\ntype T = { a: number; }\n  | { b: string; }\n/[/*]/.test(s)\nconst y = 1 +\n",
        ),
        (
            "c16_asi_type_and.ts",
            "const a = (\ntype T = { a: number; }\n  & { b: string; }\n/[/*]/.test(s)\nconst y = 1 +\n",
        ),
    ] {
        assert!(!fw.verify_incremental(
            Some(base), &format!("{base}y1 = 1 + *\n").replace("const y = 1 +\ny1", "const y1"),
            Path::new(name), LanguageId::TypeScript
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 +"),
            Path::new(name), LanguageId::TypeScript
        ).is_valid(), "expected Valid control for {name}");
    }

    // Cluster 1b: Class fields named function/class/interface (8 C2 bypasses + positive control)
    for (lang, name, base) in [
        (LanguageId::JavaScript, "c16_cf_fn.js", "const a = (\nclass C {\n  function = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "c16_cf_cls.js", "const a = (\nclass C {\n  class = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "c16_cf_fn_asi.js", "const a = (\nclass C {\n  function\n  foo = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "c16_cf_cls_asi.js", "const a = (\nclass C {\n  class\n  foo = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "c16_cf_fn.ts", "const a = (\nclass C {\n  function = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "c16_cf_cls.ts", "const a = (\nclass C {\n  class = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "c16_cf_iface.ts", "const a = (\nclass C {\n  interface = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "c16_cf_pub_fn.ts", "const a = (\nclass C {\n  public function: any = { a: 1 } / /[/*]/;\n}\nconst y = 1 +\n"),
        // Cluster 1c: export default interface
        (LanguageId::TypeScript, "c16_exp_def_iface.ts", "const a = (\nexport default interface Foo<T = { a: number }> { x: T }\n/[/*]/.test(\"/*\");\nconst y = 1 +\n"),
    ] {
        assert!(!fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 + *"),
            Path::new(name), lang
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 +"),
            Path::new(name), lang
        ).is_valid(), "expected Valid control for {name}");
    }
    let cls_gen = "const a = (\nclass C<T = { a: number }> extends Base<{ b: number }> {}\n/[/*]/.test(s)\nconst y = 1 +\n";
    assert!(!fw.verify_incremental(Some(cls_gen), &cls_gen.replace("1 +", "1 + *"), Path::new("c16_cls_gen.ts"), LanguageId::TypeScript).is_valid());

    // Cluster 1d: Unbounded paren lookahead, regex/template/comment handling, same-line /
    let pad = " ".repeat(4300);
    for (lang, name, base) in [
        (LanguageId::JavaScript, "c16_gt4096_fn.js", format!("const a = (\nfunction g() {{ /*{pad}*/ }} / /[/*]/.source.length\n)\nconst y = 1 +\n")),
        (LanguageId::JavaScript, "c16_gt4096_async.js", format!("const a = (\nasync function g() {{ /*{pad}*/ }} / /[/*]/.source.length\n)\nconst y = 1 +\n")),
        (LanguageId::JavaScript, "c16_gt4096_cls.js", format!("const a = (\nclass C {{ /*{pad}*/ }}\n/[/*]/.test(s)\nconst y = 1 +\n")),
        (LanguageId::JavaScript, "c16_esc_regex.js", "const a = (\nfunction g() { return /\\)/; }\n/[/*]/\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_regex_rparen.js", "const a = (\nfunction g() { const r = /)/; }\n/[/*]/.test(s)\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_regex_slashstar_rparen.js", "const a = (\nfunction g() {}\n/[/*)]/.test(s)\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_cls_regex_slashstar_rparen.js", "const a = (\nclass C {}\n/[/*)]/.test(s)\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_rparen_regex_trick.js", "const a = (\nfunction g() {}\n/)[/*]/.test(s)\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_nested_tmpl_rparen.js", "const a = (\nfunction g() {}\n`${`a)`}` / /[/*]/\nconst y = 1 +\n".to_string()),
        (LanguageId::JavaScript, "c16_blk_cmt_4200.js", format!("const a = (\nfunction g() {{ /* ){pad} */ }}\n/[/*]/\nconst y = 1 +\n")),
        (LanguageId::JavaScript, "c16_sameline_div.js", "const a = (\nfunction g() {} / /[/*]/;\nconst y = 1 +\n".to_string()),
        (LanguageId::TypeScript, "c16_sameline_div.ts", "const a = (\nfunction g() {} / /[/*]/;\nconst y = 1 +\n".to_string()),
        (LanguageId::Tsx, "c16_sameline_div.tsx", "const a = (\nfunction foo<T = { a: number }>(): { b: T } { return { b: {} as T }; } / /[/*]/;\nconst y = 1 +\n".to_string()),
    ] {
        assert!(!fw.verify_incremental(
            Some(&base), &base.replace("const y = 1 +", "const y1 = 1 + *"),
            Path::new(name), lang
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(&base), &base.replace("const y = 1 +", "const y1 = 1 +"),
            Path::new(name), lang
        ).is_valid(), "expected Valid control for {name}");
    }
    let stress = format!("const a = (\nfunction g() {{}}\n{}", "/[".repeat(25_000));
    let t0 = std::time::Instant::now();
    let _ = aice_ast_engine::r5::snippet_lex::scan_unmasked_delims(LanguageId::JavaScript, &stress, &[]);
    let elapsed = t0.elapsed();
    let limit_ms = if cfg!(debug_assertions) { 2_000 } else { 200 };
    assert!(elapsed.as_millis() < limit_ms, "expected fast O(n) lexing (< {limit_ms} ms), got {elapsed:?}");

    // Cluster 2: snippet_eof + snippet_ctx + Bash EOF
    for (lang, name, b, c) in [
        (LanguageId::Rust, "c16_h1_broken_plus.rs", "fn f() {\n  let a = (1 + *) +\n", "fn f() {\n  let a = (1 + *) +\n  let x = 2;\n"),
        (LanguageId::Rust, "c16_h4_call_mid.rs", "fn f() {\n  foo(\n    1,\n    2\n", "fn f() {\n  foo(\n    1,\n    let x = 1;\n    2\n"),
        (LanguageId::Java, "C16H4.java", "class C {\n  void f() {\n    foo(\n      1,\n      2\n", "class C {\n  void f() {\n    foo(\n      1,\n      int x = 1;\n      2\n"),
        (LanguageId::Python, "c16_h4_list.py", "def f():\n    xs = [\n        1,\n        2\n", "def f():\n    xs = [\n        1,\n        def g(): pass\n        2\n"),
        (LanguageId::Rust, "c16_match_mid.rs", "fn f(x: i32) {\n  match x {\n    1 => {},\n    2 => {},\n", "fn f(x: i32) {\n  match x {\n    1 => {},\n    let x = 1;\n    2 => {},\n"),
        (LanguageId::TypeScript, "c16_iface_mid_let.ts", "interface I {\n  a: number;\n  b: string;\n", "interface I {\n  let x = 1;\n  a: number;\n  b: string;\n"),
        (LanguageId::Rust, "c16_eof_rust_call.rs", "fn f() {\n    let x = 1;\n", "fn f() {\n    let x = 1;\n    foo(\n"),
        (LanguageId::Bash, "c16_sh_eof_bad.sh", "if true; then\n", "if true; then\n  if ;\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(name), lang).is_valid(), "expected Invalid for {name}");
    }
    let long_iface_base = format!("interface I {{\n{}", (0..52).map(|k| format!("  f{k}: number;\n")).collect::<String>());
    assert!(!fw.verify_incremental(Some(&long_iface_base), &format!("{long_iface_base}  let x = 1;\n"), Path::new("c16_long_iface.ts"), LanguageId::TypeScript).is_valid());
    assert!(fw.verify_incremental(Some(&long_iface_base), &format!("{long_iface_base}  f52: string;\n"), Path::new("c16_long_iface_ok.ts"), LanguageId::TypeScript).is_valid());

    let long_call_base = format!("function broken() {{ const z = (; }}\nfoo(\n{}", (0..51).map(|k| format!("  {k},\n")).collect::<String>());
    let long_arr_base = format!("const bad = (;\nconst arr = [\n{}", (0..51).map(|k| format!("  {k},\n")).collect::<String>());
    let long_fn_base = format!("fn broken() {{ let z = (; }}\nfn ok() {{\n{}", (0..55).map(|k| format!("  let v{k} = {k};\n")).collect::<String>());
    for (lang, name, b, c) in [
        (LanguageId::Rust, "c16_h1_broken_plus_ok.rs", "fn f() {\n  let a = (1 + *) +\n", "fn f() {\n  let a = (1 + *) +\n  2;\n"),
        (LanguageId::Rust, "c16_h4_call_mid_ok.rs", "fn f() {\n  foo(\n    1,\n    2\n", "fn f() {\n  foo(\n    1,\n    3,\n    2\n"),
        (LanguageId::TypeScript, "c16_prebroken_iface_ok.ts", "interface I {\n  bad = ;\n  a: number;\n", "interface I {\n  bad = ;\n  a: number;\n  b: string;\n"),
        (LanguageId::JavaScript, "c16_50line_call_ok.js", long_call_base.as_str(), &format!("{long_call_base});\n")),
        (LanguageId::JavaScript, "c16_50line_arr_ok.js", long_arr_base.as_str(), &format!("{long_arr_base}];\n")),
        (LanguageId::Rust, "c16_nested_paren_cont_ok.rs", "fn broken() { let z = (; }\nfn ok() {\n  let v = (\n    1 +\n", "fn broken() { let z = (; }\nfn ok() {\n  let v = (\n    1 +\n    2\n"),
        (LanguageId::Rust, "c16_nested_paren_plus_ok.rs", "fn broken() { let z = (; }\nfn ok() {\n  let v = (\n    1 +\n", "fn broken() { let z = (; }\nfn ok() {\n  let v = (\n    1 +\n    2 +\n"),
        (LanguageId::Bash, "c16_sh_eof_then_ok.sh", "if true; then\n", "if true; then\n  echo hi\n"),
        (LanguageId::Bash, "c16_sh_eof_for_ok.sh", "for x in a b; do\n", "for x in a b; do\n  echo $x\n"),
        // Cluster 3: Shrunken unchanged-prefix span
        (LanguageId::Rust, "c16_nested_if_close_ok.rs", "fn broken() { let z = (; }\nfn f(c: bool) {\n  if c {\n    let x = 1;\n", "fn broken() { let z = (; }\nfn f(c: bool) {\n  if c {\n    let x = 1;\n  }\n}\n"),
        (LanguageId::Rust, "c16_p7_ok.rs", "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n}\nfn ok(c: bool) {\n  if c {\n    let x = 1;\n", "fn broken() { let z = (; }\nstruct S {\n  a: u32,\n}\nfn ok(c: bool) {\n  if c {\n    let x = 1;\n  }\n}\n"),
        (LanguageId::Rust, "c16_long55_fn_close_ok.rs", long_fn_base.as_str(), &format!("{long_fn_base}}}\n")),
        // Cluster 4: snippet_rs_blk
        (LanguageId::Rust, "c16_nested_struct_close_ok.rs", "fn broken() { let z = (; }\nfn f() {\n  struct S {\n    a: u32,\n", "fn broken() { let z = (; }\nfn f() {\n  struct S {\n    a: u32,\n    b: i32,\n  }\n}\n"),
        (LanguageId::Rust, "c16_impl_arg_close_ok.rs", "fn broken() { let z = (; }\nimpl Foo {\n  fn bar(x: impl Copy) {\n    let y = 1;\n", "fn broken() { let z = (; }\nimpl Foo {\n  fn bar(x: impl Copy) {\n    let y = 1;\n    let z = 2;\n  }\n}\n"),
    ] {
        let res = fw.verify_incremental(Some(b), c, Path::new(name), lang);
        assert!(res.is_valid(), "expected Valid for {name}: {res:?}");
    }
    assert!(!fw.verify_incremental(
        Some("fn broken() { let z = (; }\nfn f() {\n  struct S {\n    a: u32,\n"),
        "fn broken() { let z = (; }\nfn f() {\n  struct S {\n    a: u32,\n    let x = 1;\n  }\n}\n",
        Path::new("c16_nested_struct_bad.rs"), LanguageId::Rust
    ).is_valid());

    // Cluster 5: bh_looks_like_container_body & scoped is_type_body_compatible_for
    for (lang, name, b, c) in [
        (LanguageId::Rust, "c16_enum_comma.rs", "enum E {\n  A,\n  B(\n", "enum E {\n  10,\n  20,\n  B(\n"),
        (LanguageId::Rust, "c16_struct_mut.rs", "struct S {\n  a: u32,\n  b: (\n", "struct S {\n  mut b: i32,\n  b: (\n"),
        (LanguageId::TypeScript, "c16_iface_def_param.ts", "interface I {\n  a: number;\n  b: (\n", "interface I {\n  a: number = 1,\n  b: string = \"x\"\n  b: (\n"),
    ] {
        assert!(!fw.verify_incremental(Some(b), c, Path::new(name), lang).is_valid(), "expected Invalid for {name}");
    }
    for (lang, f, bh, ch, exp) in [
        (LanguageId::Rust, "c16_m_enum.rs", &["  A,"][..], &["  10,", "  20,"][..], true),
        (LanguageId::Rust, "c16_m_struct_mut.rs", &["  a: u32,"], &["  mut b: i32,"], true),
        (LanguageId::TypeScript, "c16_m_iface_param.ts", &["  a: number;"], &["  a: number = 1,", "  b: string = \"x\""], true),
        (LanguageId::Java, "C16EnumParam.java", &["  A,"], &["  int x,", "  int y"], true),
        (LanguageId::Go, "c16_struct_param.go", &["  A int"], &["  x int,", "  y string"], true),
        (LanguageId::Rust, "c16_m_struct_ok.rs", &["  a: u32,"], &["  b: i32,"], false),
        (LanguageId::Rust, "c16_m_fn_param_ok.rs", &["  mut a: u32,"], &["  mut b: i32,"], false),
        (LanguageId::Go, "c16_m_struct_ok.go", &["  A int"], &["  B string"], false),
        (LanguageId::Java, "C16EnumOk.java", &["  A,"], &["  A,", "  B,"], false),
    ] {
        assert_eq!(has_merged_edit_error(lang, Path::new(f), &mut pool, bh, ch, 1), exp, "mismatch for {f}");
    }
}

#[test]
fn regression_iter17_all_clusters() {
    use aice_ast_engine::r5::snippet_probe::has_merged_edit_error;
    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();

    // Part A: Firewall Gate & Enclosing-Context Architecture
    for (lang, name, base, cand, exp_valid) in [
        (LanguageId::TypeScript, "r15_p1.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n}\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  let x = 1;\n}\n", false),
        (LanguageId::TypeScript, "r15_p1_ok.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n}\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  b: string;\n}\n", true),
        (LanguageId::TypeScript, "adv_p1_ts_iface_expr_a_plus_b.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n}\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  a + b;\n}\n", false),
        (LanguageId::TypeScript, "adv_p1_ts_iface_expr_call_arg.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n}\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  foo(1);\n}\n", false),
        (LanguageId::TypeScript, "adv_p1_ts_iface_method_sig_ok.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n}\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  foo();\n}\n", true),
        (LanguageId::TypeScript, "adv_p1_eof_iface_expr.ts",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n",
         "const broken = (\ninterface I {\n  a: number;\n  c?: boolean;\n  a + b;\n", false),
        (LanguageId::Rust, "b1_rs_broken_arg_call_mid_let.rs",
         "fn f() {\n  foo( (1 + *),\n    1,\n    2\n",
         "fn f() {\n  foo( (1 + *),\n    1,\n    let x = 1;\n    2\n", false),
        (LanguageId::Rust, "b1_rs_broken_arg_call_mid_ok.rs",
         "fn f() {\n  foo( (1 + *),\n    1,\n    2\n",
         "fn f() {\n  foo( (1 + *),\n    1,\n    3,\n    2\n", true),
        (LanguageId::Java, "B1Java.java",
         "class C {\n  void f() {\n    foo( (1 + *),\n      1,\n      2\n",
         "class C {\n  void f() {\n    foo( (1 + *),\n      1,\n      int x = 1;\n      2\n", false),
        (LanguageId::Python, "b1_py_broken_elem_list_mid_def.py",
         "def f():\n    xs = [ (1 + *),\n        1,\n        2\n",
         "def f():\n    xs = [ (1 + *),\n        1,\n        def g(): pass\n        2\n", false),
        (LanguageId::Python, "b1_py_broken_elem_list_mid_ok.py",
         "def f():\n    xs = [ (1 + *),\n        1,\n        2\n",
         "def f():\n    xs = [ (1 + *),\n        1,\n        3,\n        2\n", true),
        (LanguageId::TypeScript, "b2_ts_broken_iface_hdr_let.ts",
         "interface I extends {\n  a: number;\n",
         "interface I extends {\n  a: number;\n  let x = 1;\n", false),
        (LanguageId::TypeScript, "b2_ts_broken_iface_hdr_ok.ts",
         "interface I extends {\n  a: number;\n",
         "interface I extends {\n  a: number;\n  b: string;\n", true),
        (LanguageId::Rust, "adv_rs_match_replace_eof_let.rs",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    2 => {},\n",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    let x = 1;\n", false),
        (LanguageId::Rust, "adv_rs_match_replace_mid_let.rs",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    2 => {},\n    3 => {},\n",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    let x = 1;\n    3 => {},\n", false),
        (LanguageId::Rust, "adv_rs_match_replace_ok.rs",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    2 => {},\n    3 => {},\n",
         "fn f(x: i32) {\n  match x {\n    1 => {},\n    4 => {},\n    3 => {},\n", true),
        (LanguageId::Rust, "fr1_rs_unclosed_arr_ident_to_int.rs",
         "fn ok() {\n  let arr = [\n    A,\n    B,\n",
         "fn ok() {\n  let arr = [\n    10,\n    B,\n", true),
        (LanguageId::Java, "Fr1Java.java",
         "class C {\n  int[] arr = {\n    A,\n    B,\n",
         "class C {\n  int[] arr = {\n    10,\n    B,\n", true),
        (LanguageId::TypeScript, "fr2_ts_unclosed_obj_prop_to_expr.ts",
         "const obj = {\n  a: 1,\n  b: 2\n",
         "const obj = {\n  a: 1,\n  b: x + 1\n", true),
        (LanguageId::TypeScript, "fr3_ts_unclosed_fn_label_to_let.ts",
         "function ok() {\n  a: number;\n",
         "function ok() {\n  let x = 1;\n", true),
        (LanguageId::TypeScript, "ts_lbl_fp.ts",
         "function f() {\n  const z = (;\n  lbl: bar;\n  baz();\n}\n",
         "function f() {\n  const z = (;\n  const x = 1;\n  const y = 2;\n}\n", true),
        (LanguageId::Rust, "fr4_ret_trailing_err.rs",
         "fn f() {\n  struct S {\n    a: u32,\nfn bad(;\n",
         "fn f() {\n  struct S {\n    a: u32,\n  }\n  return;\nfn bad(;\n", true),
        (LanguageId::TypeScript, "ts_nested_iface_prop_bad.ts",
         "interface I {\n  a?: {\n",
         "interface I {\n  a?: {\n  let x = 1;\n", false),
        (LanguageId::TypeScript, "ts_nested_iface_prop_ok.ts",
         "interface I {\n  a?: {\n",
         "interface I {\n  a?: {\n  x: number;\n", true),
        (LanguageId::JavaScript, "adv_js_bad_paren_lbrace.js",
         "class C {\n  bad( {\n  ok() {}\n}\n",
         "class C {\n  bad( {\n  let x = 1;\n  ok() {}\n}\n", false),
        // Part B: Prefix-Aware Type-Body & Container Classification
        (LanguageId::TypeScript, "u_ts_iface_comma_props_bad.ts",
         "interface I {\n  a: number,\n  b: string,\n  c: (\n",
         "interface I {\n  a: number = 1,\n  b: string = \"x\"\n  c: (\n", false),
        (LanguageId::Rust, "u_rust_enum_tuple_variant_bad.rs",
         "enum E {\n  A(u32),\n  B(\n",
         "enum E {\n  10,\n  20,\n  B(\n", false),
        (LanguageId::Rust, "new_rs_enum_disc_var_to_ints_bad.rs",
         "enum E {\n  A = 1,\n  B(\n",
         "enum E {\n  10,\n  20,\n  B(\n", false),
        (LanguageId::Rust, "rs_enum_struct_var_to_ints.rs",
         "enum E {\n  A { x: u32 },\n  B(\n",
         "enum E {\n  10,\n  20,\n  B(\n", false),
        (LanguageId::CSharp, "CsEnumEq.cs",
         "enum E {\n  A = 1,\n  B(\n",
         "enum E {\n  10,\n  20,\n  B(\n", false),
        (LanguageId::Rust, "new_rs_fn_param_add_mut_ok.rs",
         "fn foo(\n  a: u32,\n  b: (\n",
         "fn foo(\n  mut a: u32,\n  b: (\n", true),
        (LanguageId::Rust, "rs_fn_two_params_mut_ok.rs",
         "fn foo(\n  a: u32,\n  b: i32,\n  c: (\n",
         "fn foo(\n  mut a: u32,\n  b: i32,\n  c: (\n", true),
        (LanguageId::Go, "go_fn_param_to_struct_ok.go",
         "package p\nfunc f(\n  a int,\n  b (\n",
         "package p\nfunc f(\n  a int, b string,\n  b (\n", true),
        (LanguageId::TypeScript, "ts_fn_param_default_ok.ts",
         "function f(\n  a: number,\n  b: (\n",
         "function f(\n  a: number = 1,\n  b: (\n", true),
    ] {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(got.is_valid(), exp_valid, "Part A/B mismatch for {name}: {got:?}");
    }

    for (lang, name, bh, ch, exp) in [
        (LanguageId::Rust, "m_rs_enum_tuple.rs", &["  A(u32),"][..], &["  10,", "  20,"][..], true),
        (LanguageId::Rust, "m_rs_enum_disc.rs", &["  A = 1,"], &["  10,", "  20,"], true),
        (LanguageId::TypeScript, "m_ts_iface_comma.ts", &["  a: number,", "  b: string,"], &["  a: number = 1,", "  b: string = \"x\""], true),
    ] {
        assert_eq!(has_merged_edit_error(lang, Path::new(name), &mut pool, bh, ch, 1), exp, "merged mismatch for {name}");
    }

    // Part C: JsLexState ExprBlockBrace (15 cases), ParenNlDeclBrace / 2 / (6+multiline+ctrl), => function (4), js_plus
    for (lang, name, base) in [
        (LanguageId::JavaScript, "a1.js", "const f = function() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::TypeScript, "a1.ts", "const f = function() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::JavaScript, "a2.js", "const f = function foo() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::JavaScript, "a3.js", "const a = (\n  function foo() {\n    { const z = 1; }\n    /[/*]/.test(\"/*\");\n    const y = 1 +\n  }\n);\n"),
        (LanguageId::JavaScript, "a4.js", "const obj = {\n  function() {\n    { const z = 1; }\n    /[/*]/.test(\"/*\");\n    const y = 1 +\n  }\n};\n"),
        (LanguageId::JavaScript, "a5.js", "const C = class {\n  function() {\n    { const z = 1; }\n    /[/*]/.test(\"/*\");\n    const y = 1 +\n  }\n};\n"),
        (LanguageId::JavaScript, "a6.js", "const f = function() {\n  class D {}\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::JavaScript, "a7.js", "const f = function() {\n  function inner() {}\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::TypeScript, "a8.ts", "const f = function() {\n  interface Foo<T = { a: number }> { x: T }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::JavaScript, "a10.js", "const f = async function() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n"),
        (LanguageId::JavaScript, "a11.js", "const obj = {\n  async function() {\n    { const z = 1; }\n    /[/*]/.test(\"/*\");\n    const y = 1 +\n  }\n};\n"),
        (LanguageId::JavaScript, "a12.js", "(function() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n})();\n"),
        (LanguageId::JavaScript, "a13.js", "!function() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n}();\n"),
        (LanguageId::JavaScript, "a14.js", "const f = function*() {\n  { const z = 1; }\n  /[/*]/.test(\"/*\");\n  const y = 1 +\n};\n"),
        (LanguageId::JavaScript, "a15.js", "const obj = {\n  *function() {\n    { const z = 1; }\n    /[/*]/.test(\"/*\");\n    const y = 1 +\n  }\n};\n"),
        (LanguageId::JavaScript, "js_fn_div_two_regex.js", "const a = (\nfunction g() {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "ts_fn_div_two_regex.ts", "const a = (\nfunction g() {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::Tsx, "tsx_fn_div_two_regex.tsx", "const a = (\nfunction g() {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_gen_fn_div_two_regex.js", "const a = (\nfunction* g() {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_async_fn_div_two_regex.js", "const a = (\nasync function g() {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_class_div_two_regex.js", "const a = (\nclass C {}\n/ 2 / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_fn_div_two_nl_regex.js", "const a = (\nfunction g() {}\n/ 2 /\n/[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_arrow_paren_nl_fn.js", "const a = (\n() => function g() {} / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "ts_arrow_paren_nl_fn.ts", "const a = (\n() => function g() {} / /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "arrow_fn_div_no_paren.js", "const f = () => function g() {} / /[/*]/;\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "ts_arrow_fn_div_no_paren.ts", "const f = () => function g() {} / /[/*]/;\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "js_plus.js", "const a = (\nfunction g() {} /[/*]/ + \"\";\nconst y = 1 +\n"),
    ] {
        assert!(!fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 + *"),
            Path::new(name), lang
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const z = 1 +"),
            Path::new(name), lang
        ).is_valid(), "expected Valid control for {name}");
    }
    let unclosed_cmt = "const a = (\nfunction g() {}\n/ 2 /* unclosed\nconst y = 1 +\n";
    assert!(fw.verify_incremental(
        Some(unclosed_cmt), &unclosed_cmt.replace("const y = 1 +", "const y1 = 1 + *"),
        Path::new("paren_nl_unclosed_cmt_ok.js"), LanguageId::JavaScript
    ).is_valid());
}

#[test]
fn regression_iter18_deep_stacks() {
    let run_2mb = |name: &'static str, f: Box<dyn FnOnce() + Send>| {
        std::thread::Builder::new()
            .name(name.into())
            .stack_size(2 * 1024 * 1024)
            .spawn(f)
            .unwrap()
            .join()
            .unwrap();
    };
    run_2mb("deep_4500_r5", Box::new(|| {
        let fw = DefaultSyntaxFirewall;
        let d = 4_500;
        let rb_p = format!("x = {}1{}\n", "(".repeat(d), ")".repeat(d));
        assert!(fw.verify(&rb_p, Path::new("deep.rb"), LanguageId::Ruby).is_valid());
        let rb_b = format!("{}1{}\n", "begin\n".repeat(d), "\nend".repeat(d));
        assert!(fw.verify(&rb_b, Path::new("deep_blk.rb"), LanguageId::Ruby).is_valid());
        let php_p = format!("<?php $x = {}1{};\n", "(".repeat(d), ")".repeat(d));
        assert!(fw.verify(&php_p, Path::new("deep.php"), LanguageId::Php).is_valid());
        let php_a = format!("<?php $x = {}1{};\n", "[".repeat(d), "]".repeat(d));
        assert!(fw.verify(&php_a, Path::new("deep_arr.php"), LanguageId::Php).is_valid());
        let kt_p = format!("val x = {}1{}\n", "(".repeat(d), ")".repeat(d));
        assert!(fw.verify(&kt_p, Path::new("deep.kt"), LanguageId::Kotlin).is_valid());
        let kt_b = format!("fun f() {{ {}1{} }}\n", "run { ".repeat(d), " }".repeat(d));
        assert!(fw.verify(&kt_b, Path::new("deep_blk.kt"), LanguageId::Kotlin).is_valid());
        let json_o = format!("{}1{}", "{\"a\":".repeat(d), "}".repeat(d));
        assert!(fw.verify(&json_o, Path::new("deep.json"), LanguageId::Json).is_valid());
        let css_m = format!("{}a{{color:red;}}{}", "@media all {".repeat(d), "}".repeat(d));
        assert!(fw.verify(&css_m, Path::new("deep.css"), LanguageId::Css).is_valid());
        let html_t = format!("{}x{}", "<div>".repeat(500), "</div>".repeat(500));
        assert!(fw.verify(&html_t, Path::new("deep.html"), LanguageId::Html).is_valid());
        let html_deep = format!("{}x{}", "<div>".repeat(d), "</div>".repeat(d));
        let _ = fw.verify(&html_deep, Path::new("deep4500.html"), LanguageId::Html);
        let xml_t = format!("{}x{}", "<a>".repeat(500), "</a>".repeat(500));
        assert!(fw.verify(&xml_t, Path::new("deep.xml"), LanguageId::Xml).is_valid());
        let xml_deep = format!("{}x{}", "<a>".repeat(d), "</a>".repeat(d));
        let _ = fw.verify(&xml_deep, Path::new("deep4500.xml"), LanguageId::Xml);
    }));
    run_2mb("deep_12k_js_and_rd", Box::new(|| {
        let fw = DefaultSyntaxFirewall;
        let d = 12_000;
        let js_b = format!("{}let a=1;{}", "{".repeat(d), "}".repeat(d));
        let js_c = format!("{}let a=2;{}", "{".repeat(d), "}".repeat(d));
        assert!(fw.verify_incremental(Some(&js_b), &js_c, Path::new("deep12k.js"), LanguageId::JavaScript).is_valid());
        // Twig RD deep tree
        let mut cur = aice_lang_registry::RdNode {
            kind: "twig_block".into(),
            label: Some("block:leaf".into()),
            start_line: 1, end_line: 1, start_byte: 0, end_byte: 1,
            children: Vec::new(),
        };
        for _ in 0..4_500 {
            cur = aice_lang_registry::RdNode {
                kind: "twig_tag".into(),
                label: Some("include 'a.twig'".into()),
                start_line: 1, end_line: 1, start_byte: 0, end_byte: 1,
                children: vec![cur],
            };
        }
        let mut syms = Vec::new();
        let mut deps = Vec::new();
        aice_ast_engine::r5::twig_rd::collect_rd_symbols(&cur, &mut syms);
        aice_ast_engine::r5::twig_rd::collect_rd_deps(&cur, &mut deps);
        assert_eq!(syms.len(), 1);
        assert_eq!(deps.len(), 4_500);
        // Deep walk_*_deps on 2 MiB stack
        use aice_lang_registry::LanguageAdapter;
        let rb_dep_src = format!("x = {}require('dep'){}\n", "(".repeat(4_500), ")".repeat(4_500));
        let rb_adapter = aice_ast_engine::r5::ruby_lang::RubyAdapter;
        let rb_tree = rb_adapter.parse_cst(&rb_dep_src).unwrap();
        assert_eq!(rb_adapter.extract_dependencies(&rb_tree, &rb_dep_src).len(), 1);
    }));
}
#[test]
fn regression_iter18_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();
    let has_merged = aice_ast_engine::r5::snippet_probe::has_merged_edit_error;

    // Cluster 1: JsLexState::paren_nl_regex_ok with comments between / 2 / and /[/*]/
    for (lang, name, base) in [
        (LanguageId::JavaScript, "A1_div_blk_cmt_regex.js",
         "const a = (\nfunction g() {}\n/ 2 / /* cmt */ /[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "A2_div_line_cmt_regex.js",
         "const a = (\nfunction g() {}\n/ 2 / // cmt\n/[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "A3_div_nl_line_cmt_regex.js",
         "const a = (\nfunction g() {}\n/ 2 /\n// cmt\n/[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "A4_div_nl_blk_cmt_regex.js",
         "const a = (\nfunction g() {}\n/ 2 /\n/* cmt */ /[/*]/\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "A5_div_blk_cmt_regex_ts.ts",
         "const a = (\nfunction g() {}\n/ 2 / /* cmt */ /[/*]/\nconst y = 1 +\n"),
        (LanguageId::TypeScript, "c1_ts_cmt_mid_div.ts",
         "const a = (\nfunction g() {}\n/ 2 / // cmt\n/[/*]/\nconst y = 1 +\n"),
        (LanguageId::JavaScript, "multi_cmt_div_regex.js",
         "const a = (\nfunction g() {}\n/ 2 / /* a */ // b\n/* c\nd */ /[/*]/\nconst y = 1 +\n"),
    ] {
        assert!(!fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 + *"),
            Path::new(name), lang
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const z = 1 +"),
            Path::new(name), lang
        ).is_valid(), "expected Valid control for {name}");
    }

    // Cluster 2: innermost_kept==false routing, C/Cpp multi-delim, tail_broken, Rust broken/close, mid '{', >48L Bash
    for (lang, name, base, cand, exp_valid) in [
        (LanguageId::Rust, "def1_rs_struct_call_mid.rs",
         "struct S {\n  foo( (1 + *),\n}\n", "struct S {\n  foo( (1 + *),\n  a: u32,\n}\n", false),
        (LanguageId::Rust, "def1_rs_impl_call_mid.rs",
         "impl Foo {\n  bar( (1 + *),\n}\n", "impl Foo {\n  bar( (1 + *),\n  fn ok() {}\n}\n", false),
        (LanguageId::Java, "def1_java_class_call_mid.java",
         "class C {\n  foo( (1 + *),\n}\n", "class C {\n  foo( (1 + *),\n  void m() {}\n}\n", false),
        (LanguageId::Java, "s3_java_class_field_call_insert_stmt.java",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n    int x = 1;\n", false),
        (LanguageId::Java, "s3_java_class_field_call_insert_method.java",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n    void g() {}\n", false),
        (LanguageId::Java, "s3_java_class_field_call_valid_arg.java",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n",
         "class C {\n  int bad = foo( (1 + *),\n    1,\n    2\n    3,\n", true),
        (LanguageId::Rust, "s3_rs_impl_const_call_insert_fn.rs",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n    fn g() {}\n", false),
        (LanguageId::Rust, "s3_rs_impl_const_call_valid_arg.rs",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n    3,\n", true),
        (LanguageId::TypeScript, "s3_ts_class_field_call_valid_arg.ts",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2\n",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2\n    3,\n", true),
        (LanguageId::TypeScript, "A17_class_broken_arr_field_ok.ts",
         "class C {\n  x = [ (1 + *),\n    1,\n",
         "class C {\n  x = [ (1 + *),\n    1,\n    2,\n", true),
        (LanguageId::TypeScript, "A17_class_broken_arr_field_bad.ts",
         "class C {\n  x = [ (1 + *),\n    1,\n",
         "class C {\n  x = [ (1 + *),\n    1,\n    let x = 1;\n", false),
        (LanguageId::C, "s2_c_multi_delim_valid_arg.c",
         "void f() {\n  foo( bar(1 + *,\n    1,\n    2,\n",
         "void f() {\n  foo( bar(1 + *,\n    1,\n    2,\n    3,\n", true),
        (LanguageId::Rust, "b2_rs_struct_bad_hdr_ok.rs",
         "struct S<T: {\n  a: u32,\n", "struct S<T: {\n  a: u32,\n  b: i32,\n", true),
        (LanguageId::Rust, "b2_rs_struct_bad_hdr_bad.rs",
         "struct S<T: {\n  a: u32,\n", "struct S<T: {\n  a: u32,\n  let x = 1;\n", false),
        (LanguageId::Rust, "b2_rs_enum_bad_hdr_ok.rs",
         "enum E<T: {\n  A,\n", "enum E<T: {\n  A,\n  B,\n", true),
        (LanguageId::TypeScript, "b2_ts_type_alias_bad_hdr_ok.ts",
         "type T = extends {\n  a: number;\n", "type T = extends {\n  a: number;\n  b: string;\n", true),
        (LanguageId::Rust, "adv_rs_mid_unclosed_lbrace_rep_bad.rs",
         "fn f() {\n  let a = 1;\n  let b = (;\n", "fn f() {\n  if true {\n  let b = (;\n", false),
        (LanguageId::Rust, "rs_ins_unclosed_lbrace_bad.rs",
         "fn f() {\n  let a = 1;\n  let b = (;\n",
         "fn f() {\n  let a = 1;\n  if true {\n  let b = (;\n", false),
        (LanguageId::TypeScript, "s3_ts_class_field_call_valid_arg_comma.ts",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2,\n",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2,\n    3,\n", true),
        (LanguageId::TypeScript, "s3_ts_class_field_call_insert_stmt.ts",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2\n",
         "class C {\n  x = foo( (1 + *),\n    1,\n    2\n    let y = 1;\n", false),
        (LanguageId::Rust, "rs_mid_else_if_before_rbrace_ok.rs",
         "fn f() {\n  if a {\n    let x = 1;\n  }\nfn trailing_bad(;\n",
         "fn f() {\n  if a {\n    let x = 1;\n  } else if b {\n    let y = 2;\n  }\nfn trailing_bad(;\n", true),
        (LanguageId::Rust, "u_container_rs_struct_close_and_valid_fn.rs",
         "struct S {\n  bad_field;\nfn trailing_bad(;\n",
         "struct S {\n}\nfn ok() {}\nfn trailing_bad(;\n", true),
        (LanguageId::Rust, "u_container_rs_struct_close_eof_fn.rs",
         "struct S {\n  a: u32,\n",
         "struct S {\n  a: u32,\n}\nfn ok() {}\n", true),
        (LanguageId::Rust, "u_container_rs_nested_struct_close_fn.rs",
         "mod m {\n  struct S {\n    a: u32,\n",
         "mod m {\n  struct S {\n    a: u32,\n  }\n  fn ok() {}\n", true),
        (LanguageId::Rust, "rs_healthy_tail_after_earlier_err.rs",
         "fn f() {\n  let bad = (;\n  if a &&\n  b {}\n}\n",
         "fn f() {\n  let bad = (;\n  if a &&\n  c &&\n  b {}\n}\n", true),
        // Cluster 3: Python & PHP typed params, TS return-type {, arrow params, C/C++ agg init, Rust struct lit
        (LanguageId::Python, "py_fn_param_type_annot_ok.py",
         "def f(\n    a: int,\n    b = (\n", "def f(\n    a: int,\n    c: str,\n    b = (\n", true),
        (LanguageId::Python, "py_fn_param_ins_type_annot_ok.py",
         "def f(\n    a,\n    b = (\n", "def f(\n    a,\n    c: str,\n    b = (\n", true),
        (LanguageId::Php, "php_fn_param_ok.php",
         "<?php\nfunction f(\n  int $a,\n  $b = (\n",
         "<?php\nfunction f(\n  int $a,\n  string $c,\n  $b = (\n", true),
        (LanguageId::Php, "php_param_notrail_ok.php",
         "<?php\nfunction f(\n  int $a,\n  $b\n) {}\nfunction bad(;\n",
         "<?php\nfunction f(\n  int $a,\n  string $c\n) {}\nfunction bad(;\n", true),
        (LanguageId::Php, "php_param_2nd_ok.php",
         "<?php\nfunction f(\n  $x,\n  $b = (\n", "<?php\nfunction f(\n  $x,\n  int $a,\n  $b = (\n", true),
        (LanguageId::Php, "php_param_in_bracket_bad.php",
         "<?php\n$arr = [\n  $a,\n  $b = (\n",
         "<?php\n$arr = [\n  int $a,\n  $b = (\n", false),
        (LanguageId::TypeScript, "A14_ts_ret_obj_insert_ok.ts",
         "const f = (x: number): {\n  a: number;\n",
         "const f = (x: number): {\n  a: number;\n  c: boolean;\n", true),
        (LanguageId::TypeScript, "A14b_ts_ret_obj_expr_bad.ts",
         "const f = (x: number): {\n  a: number;\n",
         "const f = (x: number): {\n  a: number;\n  c: 1 + 2,\n", false),
        (LanguageId::TypeScript, "s6_ts_fn_ret_type_brace_valid.ts",
         "function f() {\n  const x = (a: number): {\n    a: number;\n    b: string;\n",
         "function f() {\n  const x = (a: number): {\n    a: number;\n    b: string;\n    c: boolean;\n", true),
        (LanguageId::TypeScript, "A18_ts_arrow_param_insert_ok.ts",
         "const f = (\n  a: number,\n  b: (\n",
         "const f = (\n  a: number,\n  c: boolean,\n  b: (\n", true),
        (LanguageId::C, "def2_c_struct_init_broken_hdr.c",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n}\n",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n  1,\n}\n", true),
        (LanguageId::C, "def2_c_struct_init_broken_hdr_bad.c",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n}\n",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n  int x = 1;\n}\n", false),
        (LanguageId::Cpp, "def2_cpp_struct_init_broken_hdr.cpp",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n}\n",
         "struct Point { int x; int y; };\nvoid f() {\n  struct Point p = { (1 + *),\n  1,\n}\n", true),
        (LanguageId::Rust, "s6_rs_call_struct_lit_bad.rs",
         "fn f() {\n  foo( (1 + *), S {\n    a: 1,\n    b: 2,\n",
         "fn f() {\n  foo( (1 + *), S {\n    a: 1,\n    b: 2,\n    let x = 1;\n", false),
        (LanguageId::Rust, "s6_rs_call_struct_lit_ok.rs",
         "fn f() {\n  foo( (1 + *), S {\n    a: 1,\n    b: 2,\n",
         "fn f() {\n  foo( (1 + *), S {\n    a: 1,\n    b: 2,\n    c: 3,\n", true),
        (LanguageId::Rust, "s6_rs_broken_let_struct_lit_bad.rs",
         "fn f() {\n  let s = (1 + *) + S {\n    a: 1,\n    b: 2,\n",
         "fn f() {\n  let s = (1 + *) + S {\n    a: 1,\n    b: 2,\n    let x = 1;\n", false),
        (LanguageId::Rust, "s6_rs_broken_let_struct_lit_ok.rs",
         "fn f() {\n  let s = (1 + *) + S {\n    a: 1,\n    b: 2,\n",
         "fn f() {\n  let s = (1 + *) + S {\n    a: 1,\n    b: 2,\n    c: 3,\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }

    // >48L Rust broken struct & Bash >48L case recovery
    let mut rs55 = String::from("struct S<T: {\n");
    for i in 0..55 { rs55.push_str(&format!("  f{i}: u32,\n")); }
    let rs55_ok = format!("{rs55}  f56: i32,\n");
    let rs55_bad = format!("{rs55}  let x = 1;\n");
    assert!(fw.verify_incremental(Some(&rs55), &rs55_ok, Path::new("u_synth_rs_broken_struct_55_ok.rs"), LanguageId::Rust).is_valid());
    assert!(!fw.verify_incremental(Some(&rs55), &rs55_bad, Path::new("u_synth_rs_broken_struct_55_bad.rs"), LanguageId::Rust).is_valid());

    let mut sh55 = String::from("case \"$x\" in\n");
    for i in 0..55 { sh55.push_str(&format!("  p{i}) echo {i} ;;\n")); }
    let sh55_ok = format!("{sh55}  p56) echo 56 ;;\n");
    assert!(fw.verify_incremental(Some(&sh55), &sh55_ok, Path::new("u_synth_bash_case_55_ok.sh"), LanguageId::Bash).is_valid());

    let mut sh55_arm = String::from("case \"$x\" in\n");
    for i in 0..25 { sh55_arm.push_str(&format!("  p{i}) echo {i} ;;\n")); }
    sh55_arm.push_str("  p25)\n");
    for i in 0..30 { sh55_arm.push_str(&format!("    echo {i}\n")); }
    let sh55_arm_ok = format!("{sh55_arm}    echo 30\n");
    assert!(fw.verify_incremental(Some(&sh55_arm), &sh55_arm_ok, Path::new("u_synth_bash_arm_55_ok.sh"), LanguageId::Bash).is_valid());

    // Direct 6-arg has_merged_edit_error checks
    assert!(!has_merged(LanguageId::Php, Path::new("p.php"), &mut pool, &["  $a,"], &["  int $a,"], 1));
    assert!(has_merged(
        LanguageId::TypeScript, Path::new("ro.ts"), &mut pool,
        &["  readonly a?: number,", "  b: string,"],
        &["  readonly a?: number = 1,", "  b: string = \"x\""],
        1
    ));
    assert!(!has_merged(
        LanguageId::TypeScript, Path::new("lbl.ts"), &mut pool,
        &["  lbl: bar;", "  baz();"], &["  const x = 1;", "  const y = 2;"], 0
    ));
}

#[test]
fn regression_iter19_deep_twig_2mib() {
    std::thread::Builder::new()
        .name("twig_2mib".into())
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let fw = DefaultSyntaxFirewall;
            let tw_if_html = format!("{}<div>hi</div>{}", "{% if a %}".repeat(2_000), "{% endif %}".repeat(2_000));
            assert!(fw.verify(&tw_if_html, Path::new("deep_if.twig"), LanguageId::Twig).is_valid());
            let tw_for_html = format!("{}<div>hi</div>{}", "{% for x in xs %}".repeat(1_500), "{% endfor %}".repeat(1_500));
            assert!(fw.verify(&tw_for_html, Path::new("deep_for.twig"), LanguageId::Twig).is_valid());
            let tw_12k = format!("{}hi{}", "{% if a %}".repeat(12_000), "{% endif %}".repeat(12_000));
            assert!(fw.verify(&tw_12k, Path::new("deep_12k.twig"), LanguageId::Twig).is_valid());
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn regression_iter19_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    let mut pool = ParserPool::new();
    let has_merged = aice_ast_engine::r5::snippet_probe::has_merged_edit_error;
    // 2. JsLexState::paren_nl_regex_ok operand vs keyword gate
    for (name, base) in [
        ("adv_js_paren_nl_div_num_regex.js",
         "const a = (\nfunction g() {}\n/ 2 /\n3\n/[/*]/\nconst y = 1 +\n"),
        ("adv_js_paren_nl_div_cmt_num_regex.js",
         "const a = (\nfunction g() {}\n/ 2 / /* a */\n3\n/[/*]/\nconst y = 1 +\n"),
        ("adv_js_paren_nl_div_foo_regex.js",
         "const a = (\nfunction g() {}\n/ 2 /\nfoo\n/[/*]/\nconst y = 1 +\n"),
        ("u_js_div_blk_nl_num_regex_bad.js",
         "const a = (\nfunction g() {}\n/ 2 / /* cmt\n */ 3 /[/*]/\nconst y = 1 +\n"),
        ("js_paren_nl_regex_const_control.js",
         "const a = (\nfunction g() {}\n/[/*]/\nconst y = 1 +\n"),
    ] {
        assert!(!fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const y1 = 1 + *"),
            Path::new(name), LanguageId::JavaScript
        ).is_valid(), "expected Invalid for {name}");
        assert!(fw.verify_incremental(
            Some(base), &base.replace("const y = 1 +", "const z = 1 +"),
            Path::new(name), LanguageId::JavaScript
        ).is_valid(), "expected Valid ctrl for {name}");
    }

    // 3-8: multiline nocomma (, mid } opener {, Rust unclosed (, TS ret/arrow, C++ lambda, C ValueBracket, Rust closure/if-let, Kotlin TB_PARAM
    let mut cpp50 = String::new();
    for i in 0..50 { cpp50.push_str(&format!("int _p{i} = {i};\n")); }
    let cpp50_base = format!("{cpp50}void g() {{\n  auto f = [x = (1 + *)](int y) {{\n    int z = 1;\n  }};\n  int bad = (;\n}}\n");
    let cpp50_cand = format!("{cpp50}void g() {{\n  auto f = [x = (1 + *)](int y) {{\n    int z = 1;\n    int w = 2;\n  }};\n  int bad = (;\n}}\n");

    for (lang, name, base, cand, exp_valid) in [
        // 3. Multi-line non-comma unclosed ( tail_broken
        (LanguageId::Rust, "adv_rs_struct_multiline_call_nocomma_bad.rs",
         "struct S {\n  foo(\n    (1 + *)\n}\n", "struct S {\n  foo(\n    (1 + *)\n    a: u32,\n}\n", false),
        (LanguageId::Rust, "rs_impl_multiline_call_nocomma_bad.rs",
         "impl Foo {\n  bar(\n    (1 + *)\n}\n", "impl Foo {\n  bar(\n    (1 + *)\n    fn ok() {}\n}\n", false),
        (LanguageId::Java, "java_class_multiline_call_nocomma_bad.java",
         "class C {\n  foo(\n    (1 + *)\n}\n", "class C {\n  foo(\n    (1 + *)\n    void m() {}\n}\n", false),
        // 4. Mid-file } opener { net_lbrace guard
        (LanguageId::JavaScript, "adv_js_rbrace_lbrace_ins_bad.js",
         "function f() {\n  let a = 1;\n  let b = (;\n}\n", "function f() {\n  let a = 1;\n  } if (true) {\n  let b = (;\n}\n", false),
        (LanguageId::JavaScript, "js_rbrace_while_lbrace_ins_bad.js",
         "function f() {\n  let a = 1;\n  let b = (;\n}\n", "function f() {\n  let a = 1;\n  } while (true) {\n  let b = (;\n}\n", false),
        (LanguageId::TypeScript, "ts_rbrace_if_lbrace_ins_bad.ts",
         "function f() {\n  let a = 1;\n  let b = (;\n}\n", "function f() {\n  let a = 1;\n  } if (true) {\n  let b = (;\n}\n", false),
        (LanguageId::Php, "php_rbrace_if_lbrace_ins_bad.php",
         "<?php\nfunction f() {\n  $a = 1;\n  $b = (;\n}\n", "<?php\nfunction f() {\n  $a = 1;\n  } if (true) {\n  $b = (;\n}\n", false),
        (LanguageId::JavaScript, "js_rbrace_if_lbrace_rep_bad.js",
         "function f() {\n  let a = 1;\n  let b = (;\n}\n", "function f() {\n  } if (true) {\n  let b = (;\n}\n", false),
        // 5. Rust struct unclosed paren before bad
        (LanguageId::Rust, "rs_struct_unclosed_paren_with_bad_after_ins_field.rs",
         "struct S {\n    a: (u32,\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: (u32,\n    b: u32,\n    c: i32,\n    bad: (;\n}\n", false),
        // 6. TS compound/generic return-type { & non-arrow ) => {} gating
        (LanguageId::TypeScript, "adv_ts_ret_intersection_obj_ok.ts",
         "const f = (x: number): T & {\n  a: number;\n",
         "const f = (x: number): T & {\n  a: number;\n  b: string;\n", true),
        (LanguageId::TypeScript, "ts_ret_intersect_bad.ts",
         "const f = (x: number): Foo & {\n  a: number;\n",
         "const f = (x: number): Foo & {\n  a: number;\n  b: 1 + 2,\n", false),
        (LanguageId::TypeScript, "ts_ret_union_ok.ts",
         "const f = (x: number): Foo | {\n  a: number;\n",
         "const f = (x: number): Foo | {\n  a: number;\n  b: string;\n", true),
        (LanguageId::TypeScript, "ts_ret_union_bad.ts",
         "const f = (x: number): Foo | {\n  a: number;\n",
         "const f = (x: number): Foo | {\n  a: number;\n  b: 1 + 2,\n", false),
        (LanguageId::TypeScript, "ts_ret_array_ok.ts",
         "const f = (x: number): Array<{\n  a: number;\n",
         "const f = (x: number): Array<{\n  a: number;\n  b: string;\n", true),
        (LanguageId::TypeScript, "ts_ret_array_bad.ts",
         "const f = (x: number): Array<{\n  a: number;\n",
         "const f = (x: number): Array<{\n  a: number;\n  b: 1 + 2,\n", false),
        (LanguageId::TypeScript, "ts_paren_non_arrow_colon.ts",
         "const x = (\n  (1 + *),\n  foo,\n", "const x = (\n  (1 + *),\n  foo: number,\n", false),
        (LanguageId::TypeScript, "ts_paren_non_arrow_rest_type.ts",
         "const x = (\n  (1 + *),\n  foo,\n", "const x = (\n  (1 + *),\n  ...foo: number[],\n", false),
        (LanguageId::TypeScript, "ts_paren_return_colon.ts",
         "function f() {\n  return (\n    (1 + *),\n    foo,\n",
         "function f() {\n  return (\n    (1 + *),\n    foo: number,\n", false),
        // 7. C++ lambdas, C ValueBracket, Rust closures -> Ret {, Rust if let S {
        (LanguageId::Cpp, "adv_cpp_lambda_broken_hdr_eof_ok.cpp",
         "void g() {\n  auto f = [](int a, {\n    (1 + *);\n",
         "void g() {\n  auto f = [](int a, {\n    (1 + *);\n    int x = 1;\n", true),
        (LanguageId::Cpp, "cpp_lambda_broken_hdr_after_err_ok.cpp",
         "void g() {\n  auto f = [x = (1 + *)](int y) {\n    int z = 1;\n  };\n  int bad = (;\n}\n",
         "void g() {\n  auto f = [x = (1 + *)](int y) {\n    int z = 1;\n    int w = 2;\n  };\n  int bad = (;\n}\n", true),
        (LanguageId::Cpp, "cpp_lambda_50l_broken_hdr_ok.cpp",
         &cpp50_base, &cpp50_cand, true),
        (LanguageId::Cpp, "u_cpp_lambda_broken_capture_stmt_ok.cpp",
         "void g() {\n  auto f = [ (1 + *) ]() {\n    int x = 1;\n",
         "void g() {\n  auto f = [ (1 + *) ]() {\n    int x = 1;\n    int y = 2;\n", true),
        (LanguageId::C, "u_c_multi_delim_call_bracket_ok.c",
         "void f() {\n  foo( arr[ (1 + *),\n    0,\n",
         "void f() {\n  foo( arr[ (1 + *),\n    0,\n    1,\n", true),
        (LanguageId::C, "u_c_multi_delim_call_bracket_bad.c",
         "void f() {\n  foo( arr[ (1 + *),\n    0,\n",
         "void f() {\n  foo( arr[ (1 + *),\n    0,\n    int x = 1;\n", false),
        (LanguageId::Rust, "rs_closure_ret_broken_hdr_after_err_ok.rs",
         "fn g() {\n  let f = |x: (1 + *)| -> i32 {\n    let y = 1;\n    y\n  };\n  let bad = (;\n}\n",
         "fn g() {\n  let f = |x: (1 + *)| -> i32 {\n    let y = 1;\n    let z = 2;\n    y\n  };\n  let bad = (;\n}\n", true),
        (LanguageId::Rust, "rs_closure_ret_broken_outer_and_after_ok.rs",
         "fn g() {\n  let e = (;\n  let f = |x: (1 + *)| -> i32 {\n    let y = 1;\n    y\n  };\n  let bad = (;\n}\n",
         "fn g() {\n  let e = (;\n  let f = |x: (1 + *)| -> i32 {\n    let y = 1;\n    let z = 2;\n    y\n  };\n  let bad = (;\n}\n", true),
        (LanguageId::Rust, "adv_rs_if_let_struct_pat_ok.rs",
         "fn f() {\n  if let S {\n    a: 1,\n", "fn f() {\n  if let S {\n    a: 1,\n    b: 2,\n", true),
        (LanguageId::Rust, "adv_rs_if_let_struct_pat_bad.rs",
         "fn f() {\n  if let S {\n    a: 1,\n", "fn f() {\n  if let S {\n    a: 1,\n    let x = 1;\n", false),
        // 8. Kotlin TB_PARAM
        (LanguageId::Kotlin, "kt_broken_fun_param_valid.kt",
         "fun f(\n  a: Int,\n  b: (1 + *),\n) {}\n",
         "fun f(\n  a: Int,\n  c: String,\n  b: (1 + *),\n) {}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }

    // 8c. Direct 6-arg ts_lbl_fp non-call statements
    for stmt in ["  return;", "  break;", "  continue;", "  debugger;"] {
        assert!(!has_merged(
            LanguageId::TypeScript, Path::new("lbl_stmt.ts"), &mut pool,
            &["  lbl: bar;", stmt], &["  const a = 1;", "  const b = 2;"], 0
        ), "unexpected false positive for {stmt}");
    }
}

#[test]
fn regression_iter20_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // 1. Comment-only last_ln & prefix_ends_incomplete
        (LanguageId::Rust, "adv_rs_struct_multiline_call_cmt_bad.rs",
         "struct S {\n  foo(\n    (1 + *)\n  // trailing comment\n}\n",
         "struct S {\n  foo(\n    (1 + *)\n  // trailing comment\n    a: u32,\n}\n", false),
        (LanguageId::Rust, "adv_rs_impl_multiline_call_cmt_bad.rs",
         "impl Foo {\n  bar(\n    (1 + *)\n  // trailing comment\n}\n",
         "impl Foo {\n  bar(\n    (1 + *)\n  // trailing comment\n    fn ok() {}\n}\n", false),
        (LanguageId::Java, "adv_java_class_multiline_call_cmt_bad.java",
         "class C {\n  foo(\n    (1 + *)\n  // trailing comment\n}\n",
         "class C {\n  foo(\n    (1 + *)\n  // trailing comment\n    void m() {}\n}\n", false),
        (LanguageId::Rust, "rs_cmt_trailing_op.rs",
         "struct S {\n  foo(\n    1 +\n  // trailing comment\n}\n",
         "struct S {\n  foo(\n    1 +\n  // trailing comment\n    a: u32,\n}\n", false),
        (LanguageId::Rust, "adv_rs_struct_multiline_call_blk_cmt_bad.rs",
         "struct S {\n  foo(\n    (1 + *)\n  /* multi\n     line */\n}\n",
         "struct S {\n  foo(\n    (1 + *)\n  /* multi\n     line */\n    a: u32,\n}\n", false),
        (LanguageId::Rust, "rs_healthy_tail_after_earlier_err.rs",
         "fn f() {\n  let bad = (;\n  let ok = 1;\n  // cmt\n}\n",
         "fn f() {\n  let bad = (;\n  let ok = 1;\n  // cmt\n  let x = 2;\n}\n", true),
        (LanguageId::Rust, "rs_healthy_tail_cmt.rs",
         "fn f() {\n  let bad = (;\n  if a &&\n  // cmt\n}\n",
         "fn f() {\n  let bad = (;\n  if a &&\n  // cmt\n  b {}\n}\n", true),
        // 2. Mid-file } else { / } catch splits across 6 languages + mid_rbrace_else_valid.js
        (LanguageId::JavaScript, "adv_b8_valid_else_split_stmt_suffix.js",
         "function f() {\n  if (a) {\n    let x = 1;\n    let c = 2;\n  }\n  let bad = (;\n}\n",
         "function f() {\n  if (a) {\n    let x = 1;\n  } else {\n    let c = 2;\n  }\n  let bad = (;\n}\n", true),
        (LanguageId::TypeScript, "adv_b8_ts_valid_else_split_stmt_suffix.ts",
         "function f() {\n  if (a) {\n    let x = 1;\n    let c = 2;\n  }\n  let bad = (;\n}\n",
         "function f() {\n  if (a) {\n    let x = 1;\n  } else {\n    let c = 2;\n  }\n  let bad = (;\n}\n", true),
        (LanguageId::Php, "adv_b8_php_valid_else_split_stmt_suffix.php",
         "<?php\nfunction f() {\n  if ($a) {\n    $x = 1;\n    $c = 2;\n  }\n  $bad = (;\n}\n",
         "<?php\nfunction f() {\n  if ($a) {\n    $x = 1;\n  } else {\n    $c = 2;\n  }\n  $bad = (;\n}\n", true),
        (LanguageId::Rust, "adv_b8_rs_valid_else_split_stmt_suffix.rs",
         "fn f() {\n  if a {\n    let x = 1;\n    let c = 2;\n  }\n  let bad = (;\n}\n",
         "fn f() {\n  if a {\n    let x = 1;\n  } else {\n    let c = 2;\n  }\n  let bad = (;\n}\n", true),
        (LanguageId::JavaScript, "adv_b9_valid_catch_split_stmt_suffix.js",
         "function f() {\n  try {\n    let x = 1;\n    handle(e);\n  }\n  let bad = (;\n}\n",
         "function f() {\n  try {\n    let x = 1;\n  } catch (e) {\n    handle(e);\n  }\n  let bad = (;\n}\n", true),
        (LanguageId::Cpp, "cpp_else_split_stmt_suf.cpp",
         "void f() {\n  if (a) {\n    int x = 1;\n    int c = 2;\n  }\n  int bad = (;\n}\n",
         "void f() {\n  if (a) {\n    int x = 1;\n  } else {\n    int c = 2;\n  }\n  int bad = (;\n}\n", true),
        (LanguageId::Java, "JavaElseSplitStmtSuf.java",
         "class A {\n  void f() {\n    if (a) {\n      int x = 1;\n      int c = 2;\n    }\n    int bad = (;\n  }\n}\n",
         "class A {\n  void f() {\n    if (a) {\n      int x = 1;\n    } else {\n      int c = 2;\n    }\n    int bad = (;\n  }\n}\n", true),
        (LanguageId::JavaScript, "mid_rbrace_else_valid.js",
         "function f() {\n  if (true) {\n    let a = 1;\n    let b = (;\n  }\n}\n",
         "function f() {\n  if (true) {\n    let a = 1;\n    let b = (;\n  } else {\n    let c = 2;\n  }\n}\n", true),
        (LanguageId::JavaScript, "mid_rbrace_else_bad_body.js",
         "function f() {\n  if (true) {\n    let a = 1;\n    let b = (;\n  }\n}\n",
         "function f() {\n  if (true) {\n    let a = 1;\n    let b = (;\n  } else {\n    1 + *;\n  }\n}\n", false),
        (LanguageId::Rust, "mid_rbrace_else_in_struct_bad.rs",
         "struct S {\n  a: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: u32,\n  } else {\n  bad: (;\n}\n", false),
        (LanguageId::JavaScript, "mid_rbrace_else_empty_if_bad.js",
         "function f() {\n  if (true) {\n    let a = 1;\n  }\n  let bad = (;\n}\n",
         "function f() {\n  if (true) {\n    let a = 1;\n  } else {} if (true) {\n  }\n  let bad = (;\n}\n", false),
        (LanguageId::JavaScript, "mid_rbrace_else_dbl_bad.js",
         "function f() {\n  if (true) {\n    let a = 1;\n  }\n  let bad = (;\n}\n",
         "function f() {\n  if (true) {\n    let a = 1;\n  } } else {\n  }\n  let bad = (;\n}\n", false),
        // 3. TS/TSX foo( calls & a > ( comparisons
        (LanguageId::TypeScript, "call_eof.ts",
         "foo(\n  (1 + *),\n  bar,\n", "foo(\n  (1 + *),\n  bar: number,\n", false),
        (LanguageId::Tsx, "call_eof.tsx",
         "foo(\n  (1 + *),\n  bar,\n", "foo(\n  (1 + *),\n  bar: number,\n", false),
        (LanguageId::TypeScript, "call_eof_rest.ts",
         "foo(\n  (1 + *),\n  bar,\n", "foo(\n  (1 + *),\n  ...bar: number[],\n", false),
        (LanguageId::TypeScript, "call_clean_prefix.ts",
         "foo(\n  bar,\n", "foo(\n  bar: number,\n", false),
        (LanguageId::TypeScript, "call_nocomma_eof.ts",
         "foo(\n  bar\n", "foo(\n  bar: number\n", false),
        (LanguageId::TypeScript, "gt_eof.ts",
         "const x = a > (\n  (1 + *),\n  foo,\n", "const x = a > (\n  (1 + *),\n  foo: number,\n", false),
        (LanguageId::TypeScript, "gt_lt_eof.ts",
         "const x = a < b && c > (\n  (1 + *),\n  foo,\n", "const x = a < b && c > (\n  (1 + *),\n  foo: number,\n", false),
        (LanguageId::TypeScript, "generic_call_eof.ts",
         "foo<number>(\n  (1 + *),\n  bar,\n", "foo<number>(\n  (1 + *),\n  bar: number,\n", false),
        (LanguageId::TypeScript, "ts_arrow_generic_ok.ts",
         "const f = <T>(\n  (1 + *),\n  foo,\n", "const f = <T>(\n  (1 + *),\n  foo: number,\n", true),
        (LanguageId::TypeScript, "ts_class_method_param_ok.ts",
         "class C {\n  foo(\n    (1 + *),\n    bar,\n", "class C {\n  foo(\n    (1 + *),\n    bar: number,\n", true),
        (LanguageId::TypeScript, "ts_fn_param_ok.ts",
         "function foo(\n  (1 + *),\n  bar,\n", "function foo(\n  (1 + *),\n  bar: number,\n", true),
        // 4. TS is_ts_ret_type_colon depth-0 =>
        (LanguageId::TypeScript, "adv_f3_ts_ret_type_arrow_generic_valid_prop.ts",
         "function f(a: (1 + *)): Foo<() => void> & {\n  x: number;\n} {\n  return null as any;\n}\nconst bad = (;\n",
         "function f(a: (1 + *)): Foo<() => void> & {\n  x: number;\n  readonly y?: string;\n} {\n  return null as any;\n}\nconst bad = (;\n", true),
        (LanguageId::TypeScript, "adv_f1_ts_ret_type_arrow_generic_bad_stmt.ts",
         "function f(a: (1 + *)): Foo<() => void> & {\n  x: number;\n} {\n  return null as any;\n}\nconst bad = (;\n",
         "function f(a: (1 + *)): Foo<() => void> & {\n  x: number;\n  const z = 1;\n} {\n  return null as any;\n}\nconst bad = (;\n", false),
        (LanguageId::TypeScript, "ts_record_arrow_ret_prop_ok.ts",
         "const f = (x: number): Record<string, () => void> & {\n  a: number;\n} => ({} as any);\nconst bad = (;\n",
         "const f = (x: number): Record<string, () => void> & {\n  a: number;\n  b: string;\n} => ({} as any);\nconst bad = (;\n", true),
        (LanguageId::TypeScript, "ts_ret_fn_intersect_ok.ts",
         "const f = (x: number): (() => void) & {\n  a: number;\n",
         "const f = (x: number): (() => void) & {\n  a: number;\n  b: string;\n", true),
        (LanguageId::TypeScript, "ts_ret_fn_intersect_bad.ts",
         "const f = (x: number): (() => void) & {\n  a: number;\n",
         "const f = (x: number): (() => void) & {\n  a: number;\n  b: 1 + 2,\n", false),
        (LanguageId::TypeScript, "ts_arrow_generic_ret_body_ok.ts",
         "const f = (x: number): Foo<() => void> => {\n  const a = 1;\n",
         "const f = (x: number): Foo<() => void> => {\n  const a = 1;\n  const b = 2;\n", true),
        (LanguageId::TypeScript, "ts_arrow_generic_ret_body_bad.ts",
         "const f = (x: number): Foo<() => void> => {\n  const a = 1;\n",
         "const f = (x: number): Foo<() => void> => {\n  const a = 1;\n  readonly b: number;\n", false),
        // 5. Rust rust_type_container_insert_verdict unclosed (/[ bypasses
        (LanguageId::Rust, "rs_struct_vec_unclosed_paren_ins_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: i32,\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "adv_e1_rs_struct_broken_array_unclosed_ins_bad.rs",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    c: i32,\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "adv_e1_rs_struct_nested_unclosed_paren_ins_bad.rs",
         "struct S {\n    a: (u32, i32\n    b: (u8,\n    c: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: (u32, i32\n    b: (u8,\n    c: u32,\n    d: bool,\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "adv_e1_rs_struct_unclosed_attr_ins_bad.rs",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    bad: (;\n}\n",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    b: i32,\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_prebroken_open_struct_with_attr_ok.rs",
         "struct S {\n  #[derive(Debug)]\n  bad: (,\n  a: u32,\n",
         "struct S {\n  #[derive(Debug)]\n  bad: (,\n  a: u32,\n  b: i32,\n", true),
        // 6. ends_in_block_comment comment-preceded /[/*]/
        (LanguageId::JavaScript, "js_lex_paren_nl_fn_comment_then_regex_bad_cand_ok.js",
         "const a = (\nfunction g() {} /* c */\n/[/*]/\nconst y = 1 +\n",
         "const a = (\nfunction g() {} /* c */\n/[/*]/\nconst y1 = 1 + *\n", true),
        (LanguageId::JavaScript, "js_lex_paren_nl_fn_comment_then_regex_ctrl_ok.js",
         "const a = (\nfunction g() {} /* c */\n/[/*]/\nconst y = 1 +\n",
         "const a = (\nfunction g() {} /* c */\n/[/*]/\nconst z = 1 +\n", true),
        // 8. C++ nested lambda param lists & ends_with(']') hardening
        (LanguageId::Cpp, "cpp_nested_lambda_param_ok.cpp",
         "void f() {\n  auto g = [](int a,\n",
         "void f() {\n  auto g = [](int a,\n    int b\n", true),
        (LanguageId::Cpp, "cpp_nested_lambda_param_comma_ok.cpp",
         "void f() {\n  auto g = [](int a,\n",
         "void f() {\n  auto g = [](int a,\n    int b,\n", true),
        (LanguageId::Cpp, "cpp_nested_lambda_param_bad_stmt.cpp",
         "void f() {\n  auto g = [](int a,\n",
         "void f() {\n  auto g = [](int a,\n    return;\n", false),
        (LanguageId::Cpp, "cpp_subscript_call_decl_bad.cpp",
         "void f() {\n  fn_arr[0](\n    (1 + *),\n    1,\n",
         "void f() {\n  fn_arr[0](\n    (1 + *),\n    1,\n    int x = 1,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }

    // 7. Sub-quadratic scaling on 2,000-line /[/*]/\n file
    let slash_2k = format!("{}const y = 1 +\n", "/[/*]/\n".repeat(2_000));
    let slash_2k_cand = format!("{}const y1 = 1 + *\n", "/[/*]/\n".repeat(2_000));
    let t0 = std::time::Instant::now();
    let v_2k = fw.verify_incremental(
        Some(&slash_2k),
        &slash_2k_cand,
        Path::new("perf_slash_lbrack_2k.js"),
        LanguageId::JavaScript,
    );
    let elapsed_2k = t0.elapsed();
    assert!(v_2k.is_valid(), "perf_slash_lbrack_2k: {v_2k:?}");
    let limit_2k_ms = if cfg!(debug_assertions) { 30_000 } else { 10_000 };
    assert!(elapsed_2k.as_millis() < limit_2k_ms, "2k /[/*]/ took {:?} (limit {limit_2k_ms} ms)", elapsed_2k);
}

#[test]
fn regression_iter21_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // 2. Rust cand_closes, is_trivial_prebroken, impl/trait, and where T: Fn(
        (LanguageId::Rust, "rs_struct_vec_unclosed_paren_tuple_field_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: (i32, u32),\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_vec_unclosed_paren_array_field_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: [u8; 4],\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_vec_unclosed_paren_unit_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: (),\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_vec_cmt_rparen_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: i32, // )\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_str_rparen_bad.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    c: &'static str, // )\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_broken_array_tuple_field_bad.rs",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    c: (i32,),\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_unclosed_attr_tuple_field_bad.rs",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    bad: (;\n}\n",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    b: (i32,),\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_enum_vec_unclosed_paren_bad.rs",
         "enum E {\n  A(Vec<(\n  B(u32),\n  bad: (;\n}\n",
         "enum E {\n  A(Vec<(\n  B(u32),\n  C(i32),\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_enum_vec_paren_cmt_bad.rs",
         "enum E {\n  A(Vec<(\n  B,\n  Bad(;\n}\n",
         "enum E {\n  A(Vec<(\n  B,\n  C, // )\n  Bad(;\n}\n", false),
        (LanguageId::Rust, "atk_a5_foo_comma_struct.rs",
         "struct S {\n  foo(,\n  a: u32,\n  bad: (;\n}\n",
         "struct S {\n  foo(,\n  a: u32,\n  b: i32,\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_impl_vec_paren_bad.rs",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  fn b() {}\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_trait_vec_paren_bad.rs",
         "trait T {\n  fn f(x: Vec<(\n  fn a(&self);\n  bad: (;\n}\n",
         "trait T {\n  fn f(x: Vec<(\n  fn a(&self);\n  fn b(&self);\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_impl_attr_unclosed_bad.rs",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  fn b() {}\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_impl_fn_param_ok.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "rs_trait_fn_param_ok.rs",
         "trait T {\n  fn f(\n    a: u32,\n",
         "trait T {\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "rs_impl_fn_empty_param_ok.rs",
         "impl Foo {\n  fn f(\n",
         "impl Foo {\n  fn f(\n    a: u32,\n", true),
        (LanguageId::Rust, "rs_impl_fn_param_bad_stmt.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    let x = 1;\n", false),
        (LanguageId::Rust, "rs_where_fn_insert_field_eof.rs",
         "struct S<T> where T: Fn(\n  a: u32,\n",
         "struct S<T> where T: Fn(\n  a: u32,\n  b: i32,\n", false),
        (LanguageId::Rust, "rs_where_fn_insert_field.rs",
         "struct S<T> where T: Fn(\n  a: u32,\n) {\n}\n",
         "struct S<T> where T: Fn(\n  a: u32,\n  b: i32,\n) {\n}\n", false),
        (LanguageId::Rust, "rs_where_fn_valid_type_ok.rs",
         "struct S<T> where T: Fn(\n  i32,\n",
         "struct S<T> where T: Fn(\n  i32,\n  u32,\n", true),
        // 3. JS/TS/TSX container_compatible_for ValueParen class _AiceProbe_ bypass
        (LanguageId::TypeScript, "broken_sum_call_colon.ts",
         "const x = (1 + *) + foo(\n  bar,\n",
         "const x = (1 + *) + foo(\n  bar,\n  baz: number,\n", false),
        (LanguageId::TypeScript, "broken_sum_call_rest.ts",
         "const x = (1 + *) + foo(\n  bar,\n",
         "const x = (1 + *) + foo(\n  bar,\n  ...baz: number[],\n", false),
        (LanguageId::TypeScript, "broken_and_call_colon.ts",
         "const x = (1 + *) && foo(\n  bar,\n",
         "const x = (1 + *) && foo(\n  bar,\n  baz: number,\n", false),
        (LanguageId::TypeScript, "broken_sum_call_valid_arg.ts",
         "const x = (1 + *) + foo(\n  bar,\n",
         "const x = (1 + *) + foo(\n  bar,\n  baz,\n", true),
        (LanguageId::TypeScript, "ts_ternary_gt_bad.ts",
         "const x = a ? b > (\n  (1 + *),\n  foo,\n",
         "const x = a ? b > (\n  (1 + *),\n  foo: number,\n", false),
        (LanguageId::TypeScript, "ts_ternary_call_param_bad.ts",
         "const x = a ? foo(\n  bar,\n",
         "const x = a ? foo(\n  bar: number,\n", false),
        (LanguageId::TypeScript, "ts_ternary_call_rest_bad.ts",
         "const x = a ? foo(\n  (1 + *),\n  bar,\n",
         "const x = a ? foo(\n  (1 + *),\n  ...bar: number[],\n", false),
        (LanguageId::Tsx, "tsx_ternary_call_param_bad.tsx",
         "const x = a ? foo(\n  bar,\n",
         "const x = a ? foo(\n  bar: number,\n", false),
        // 4. TSX jsx_text masking, template_string regex parity, step_quote \\\n line_idx parity
        (LanguageId::Tsx, "tsx_jsx_slash_star_valid.tsx",
         "function C() {\n  const x = <div>/*</div>;\n  const ok = 1;\n  const bad = (;\n}\n",
         "function C() {\n  const x = <div>/*</div>;\n  const ok = 2;\n  const bad = (;\n}\n", true),
        (LanguageId::Tsx, "tsx_jsx_slash_star_enclosing_bypass.tsx",
         "const wrap = (\nfunction C() {\n  const x = <div>/*</div>;\n  const y = 1 +\n}\n",
         "const wrap = (\nfunction C() {\n  const x = <div>/*</div>;\n  const y1 = 1 + *;\n}\n", false),
        (LanguageId::JavaScript, "js_tmpl_regex_slash_star_ok.js",
         "const s = `a ${/[/*]/}`;\nconst y = 1 +\n",
         "const s = `a ${/[/*]/}`;\nconst z = 1 +\n", true),
        (LanguageId::JavaScript, "js_tmpl_regex_slash_star_bad.js",
         "const s = `a ${/[/*]/}`;\nconst y = 1 +\n",
         "const s = `a ${/[/*]/}`;\nconst y1 = 1 + *;\n", false),
        (LanguageId::JavaScript, "js_step_quote_escaped_nl_line_idx_bad.js",
         "const s = \"a\\\nb\"; /* c */\nconst y = 1 +\n",
         "const s = \"a\\\nb\"; /* c */\nconst y1 = 1 + *;\n", false),
        // 5. TS conditional return types & curried generic arrows
        (LanguageId::TypeScript, "atk_b1_ts_cond_ret_valid_prop.ts",
         "function f(a: (1 + *)): Foo<T extends string ? number : boolean> & {\n  x: number;\n} {\n  return null as any;\n}\nconst bad = (;\n",
         "function f(a: (1 + *)): Foo<T extends string ? number : boolean> & {\n  x: number;\n  readonly y?: string;\n} {\n  return null as any;\n}\nconst bad = (;\n", true),
        (LanguageId::TypeScript, "atk_b2_ts_cond_ret_bad_stmt.ts",
         "function f(a: (1 + *)): Foo<T extends string ? number : boolean> & {\n  x: number;\n} {\n  return null as any;\n}\nconst bad = (;\n",
         "function f(a: (1 + *)): Foo<T extends string ? number : boolean> & {\n  x: number;\n  const z = 1;\n} {\n  return null as any;\n}\nconst bad = (;\n", false),
        (LanguageId::TypeScript, "atk_b3_ts_arrow_cond_ret_valid_prop.ts",
         "const f = (x: number): Record<string, T extends A ? () => void : never> & {\n  a: number;\n} => ({} as any);\nconst bad = (;\n",
         "const f = (x: number): Record<string, T extends A ? () => void : never> & {\n  a: number;\n  b: string;\n} => ({} as any);\nconst bad = (;\n", true),
        (LanguageId::TypeScript, "atk_b4_ts_arrow_cond_ret_bad_stmt.ts",
         "const f = (x: number): Record<string, T extends A ? () => void : never> & {\n  a: number;\n} => ({} as any);\nconst bad = (;\n",
         "const f = (x: number): Record<string, T extends A ? () => void : never> & {\n  a: number;\n  const z = 1;\n} => ({} as any);\nconst bad = (;\n", false),
        (LanguageId::TypeScript, "ts_ret_conditional_top_qmark_ok.ts",
         "const f = <T>(x: T): T extends string ? { a: number } : {\n  c: boolean;\n",
         "const f = <T>(x: T): T extends string ? { a: number } : {\n  c: boolean;\n  d: string;\n", true),
        (LanguageId::TypeScript, "ts_ret_conditional_top_qmark_bad.ts",
         "const f = <T>(x: T): T extends string ? { a: number } : {\n  c: boolean;\n",
         "const f = <T>(x: T): T extends string ? { a: number } : {\n  c: boolean;\n  d: 1 + 2,\n", false),
        (LanguageId::TypeScript, "ts_ternary_call_ret_brace_bad.ts",
         "const x = cond ? f(): {\n  a: 1,\n",
         "const x = cond ? f(): {\n  a: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "adv_curried_gen_arrow_ok.ts",
         "const f = () => <T>(\n  (1 + *),\n  a,\n",
         "const f = () => <T>(\n  (1 + *),\n  a: number,\n", true),
        // 6. is_valid_mid_continuation_brace comment/string } & comment-reopen */ ... /*
        (LanguageId::JavaScript, "atk_c1_else_rbrace_only_in_cmt.js",
         "function f(c) {\n  if (c) {\n    return 1;\n  // }\n  let bad = (;\n",
         "function f(c) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  // }\n  let bad = (;\n", false),
        (LanguageId::JavaScript, "js_else_rbrace_only_in_string.js",
         "function f(c) {\n  if (c) {\n    return 1;\n  const s = \"}\";\n  let bad = (;\n",
         "function f(c) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  const s = \"}\";\n  let bad = (;\n", false),
        (LanguageId::JavaScript, "atk_d3_blk_depth_valid_reopen.js",
         "function f() {\n  /* open\n  */\n  let bad = (;\n}\n",
         "function f() {\n  /* open\n  */ let z = 1; /*\n  */\n  let bad = (;\n}\n", true),
        (LanguageId::JavaScript, "js_blk_reopen_bad_code.js",
         "function f() {\n  /* open\n  */\n  let bad = (;\n}\n",
         "function f() {\n  /* open\n  */ let z = 1 + *; /*\n  */\n  let bad = (;\n}\n", false),
        (LanguageId::JavaScript, "js_blk_reopen_unclosed_eof_bad.js",
         "function f() {\n  /* open\n",
         "function f() {\n  /* open\n  */ let z = 1; /*\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }

    // 1. PrefixCache base_tree reuse across 2k clean prefix lines with non-EOF last-line edit
    let base_2k = format!("{}const y = 1 +\n", "/[/*]/\n".repeat(2_000));
    let cand_2k = format!("{}const y1 = 1 + *\n", "/[/*]/\n".repeat(2_000));
    let v = fw.verify_incremental(
        Some(&base_2k),
        &cand_2k,
        Path::new("iter21_prefix_cache_2k.js"),
        LanguageId::JavaScript,
    );
    assert!(v.is_valid(), "iter21_prefix_cache_2k: {v:?}");
}

#[test]
fn regression_iter22_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // 1. Rust cand_closes unmatched-closer escape hatch + clean controls
        (LanguageId::Rust, "rs_struct_vec_bare_rparen.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    )\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_vec_unclosed_paren_u32_rparen.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    u32)\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_vec_multi_ty_rparen.rs",
         "struct S {\n    a: Vec<(\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: Vec<(\n    b: u32,\n    i32, u32)\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "struct_vec_paren_rparen_bad.rs",
         "struct S {\n  a: Vec<(\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: Vec<(\n  b: u32,\n  i32)\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_attr_bare_rparen.rs",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    bad: (;\n}\n",
         "struct S {\n    #[serde(rename = \"x\"\n    a: u32,\n    )\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_enum_vec_bare_rparen.rs",
         "enum E {\n  A(Vec<(\n  B(u32),\n  bad: (;\n}\n",
         "enum E {\n  A(Vec<(\n  B(u32),\n  )\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "enum_vec_paren_rparen_bad.rs",
         "enum E {\n  A(Vec<(\n  B,\n  Bad(;\n}\n",
         "enum E {\n  A(Vec<(\n  B,\n  i32)\n  Bad(;\n}\n", false),
        (LanguageId::Rust, "rs_struct_bracket_rbrack.rs",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    bad: (;\n}\n",
         "struct S {\n    a: [u8; 4,\n    b: u32,\n    ]\n    bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_clean_tuple_close_ctrl.rs",
         "struct S {\n  a: (\n    u32,\n",
         "struct S {\n  a: (\n    u32,\n  ),\n", true),
        (LanguageId::Rust, "rs_struct_clean_tuple_close_eof_ctrl.rs",
         "struct S {\n  a: (\n    u32,\n",
         "struct S {\n  a: (\n    u32,\n  ),\n}", true),
        (LanguageId::Rust, "rs_prebroken_open_struct_iter22_ctrl.rs",
         "struct S {\n  bad: (,\n  a: u32,\n",
         "struct S {\n  bad: (,\n  a: u32,\n  b: i32,\n", true),
        // 2. Rust is_fn_params generic method trait bounds
        (LanguageId::Rust, "impl_generic_fn_param_ok.rs",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "trait_generic_fn_param_ok.rs",
         "trait T {\n  fn f<U: Clone>(\n    a: U,\n",
         "trait T {\n  fn f<U: Clone>(\n    a: U,\n    b: i32,\n", true),
        (LanguageId::Rust, "impl_generic_fn_param_mid_ok.rs",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n  ) {}\n  const bad: usize = (;\n}\n",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n    b: i32,\n  ) {}\n  const bad: usize = (;\n}\n", true),
        (LanguageId::Rust, "impl_generic_fn_param_stmt_bad.rs",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n",
         "impl Foo {\n  fn f<T: Debug>(\n    a: u32,\n    let x = 1;\n", false),
        // 3. Rust unclosed generic < in containers
        (LanguageId::Rust, "new_A1_unclosed_angle_struct.rs",
         "struct S {\n  a: Vec<\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: Vec<\n  b: u32,\n  c: i32,\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "p2_A4_struct_nested_angle_bad.rs",
         "struct S {\n  a: Option<Vec<\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: Option<Vec<\n  b: u32,\n  c: i32,\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "p3_A1_struct_angle_with_extra_err.rs",
         "struct S {\n  a: Result<i32,\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: Result<i32,\n  b: u32,\n  c: i32,\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "rs_struct_angle_eof_bad.rs",
         "struct S {\n  a: Vec<\n  b: u32,\n",
         "struct S {\n  a: Vec<\n  b: u32,\n  c: i32,\n", false),
        (LanguageId::Rust, "rs_struct_angle_clean_close_ok.rs",
         "struct S {\n  a: Vec<\n",
         "struct S {\n  a: Vec<\n  i32>,\n", true),
        (LanguageId::Rust, "rs_impl_closed_angle_expr_ok.rs",
         "impl Foo {\n  fn helper() -> bool { 1 < 2 }\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn helper() -> bool { 1 < 2 }\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        // 4. Rust fn foo<T: Fn( vs struct S { f: fn(
        (LanguageId::Rust, "fn_generic_fn_trait_bound_named_param_bad.rs",
         "fn foo<T: Fn(\n  i32,\n",
         "fn foo<T: Fn(\n  i32,\n  b: u32,\n", false),
        (LanguageId::Rust, "fn_generic_fn_trait_bound_eof_bad.rs",
         "fn foo<T: Fn(\n  a: u32,\n",
         "fn foo<T: Fn(\n  a: u32,\n  b: i32,\n", false),
        (LanguageId::Rust, "fn_generic_fnmut_bound_bad.rs",
         "fn foo<T: FnMut(\n  i32,\n",
         "fn foo<T: FnMut(\n  i32,\n  b: u32,\n", false),
        (LanguageId::Rust, "fn_generic_fnonce_bound_bad.rs",
         "fn foo<T: FnOnce(\n  i32,\n",
         "fn foo<T: FnOnce(\n  i32,\n  b: u32,\n", false),
        (LanguageId::Rust, "fn_generic_fn_trait_bound_valid_ok.rs",
         "fn foo<T: Fn(\n  i32,\n",
         "fn foo<T: Fn(\n  i32,\n  u32,\n", true),
        (LanguageId::Rust, "fn_generic_debug_bound_param_ok.rs",
         "fn foo<T: Debug>(\n  a: u32,\n",
         "fn foo<T: Debug>(\n  a: u32,\n  b: i32,\n", true),
        (LanguageId::Rust, "new_A3_struct_fn_ptr_named_param_valid.rs",
         "struct S {\n  f: fn(\n    a: u32,\n",
         "struct S {\n  f: fn(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "p2_A5_enum_fn_ptr_named_param_valid.rs",
         "enum E {\n  A(fn(\n    a: u32,\n",
         "enum E {\n  A(fn(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "p3_A3_struct_fn_ptr_with_closing_bad.rs",
         "struct S {\n  f: fn(\n    a: u32,\n  ),\n  bad: (;\n}\n",
         "struct S {\n  f: fn(\n    a: u32,\n    b: i32,\n  ),\n  bad: (;\n}\n", true),
        (LanguageId::Rust, "rs_struct_fn_ptr_bad_stmt.rs",
         "struct S {\n  f: fn(\n    a: u32,\n",
         "struct S {\n  f: fn(\n    a: u32,\n    let x = 1;\n", false),
        // 5. TS/TSX decorator calls @dec(
        (LanguageId::TypeScript, "class_decorator_call_clean.ts",
         "class C {\n  @dec(\n    a,\n",
         "class C {\n  @dec(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "class_decorator_call_broken.ts",
         "class C {\n  bad = (1 + *);\n  @dec(\n    a,\n",
         "class C {\n  bad = (1 + *);\n  @dec(\n    a,\n    b: number,\n", false),
        (LanguageId::Tsx, "class_decorator_call_clean.tsx",
         "class C {\n  @ns.dec(\n    a,\n",
         "class C {\n  @ns.dec(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "class_decorator_call_valid_arg.ts",
         "class C {\n  @dec(\n    a,\n",
         "class C {\n  @dec(\n    a,\n    b,\n", true),
        (LanguageId::TypeScript, "class_decorated_method_valid_param.ts",
         "class C {\n  @dec\n  foo(\n    a: number,\n",
         "class C {\n  @dec\n  foo(\n    a: number,\n    b: string,\n", true),
        // 6. TS/TSX object literal shorthand methods vs JS & property calls
        (LanguageId::TypeScript, "obj_shorthand_method_eof.ts",
         "const obj = {\n  foo(\n    a: number,\n",
         "const obj = {\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "obj_shorthand_method_broken_prefix.ts",
         "const obj = {\n  bad: (1 + *),\n  foo(\n    a: number,\n",
         "const obj = {\n  bad: (1 + *),\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "obj_shorthand_method_closed_broken_eof.ts",
         "const obj = {\n  foo(\n    a: number,\n  ) {}\n};\nconst bad = (;\n",
         "const obj = {\n  foo(\n    a: number,\n    b: string,\n  ) {}\n};\nconst bad = (;\n", true),
        (LanguageId::Tsx, "obj_shorthand_method_eof.tsx",
         "const obj = {\n  foo(\n    a: number,\n",
         "const obj = {\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "obj_shorthand_method_bad_stmt.ts",
         "const obj = {\n  foo(\n    a: number,\n",
         "const obj = {\n  foo(\n    a: number,\n    const z = 1;\n", false),
        (LanguageId::JavaScript, "obj_shorthand_method_js_bad.js",
         "const obj = {\n  foo(\n    a,\n",
         "const obj = {\n  foo(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "obj_prop_call_arg_ts_bad.ts",
         "const obj = {\n  x: foo(\n    a,\n",
         "const obj = {\n  x: foo(\n    a,\n    b: number,\n", false),
        // 7. TS is_ts_ret_type_colon (=> in conditional type) & has_depth0_qmark (unpaired <)
        (LanguageId::TypeScript, "new_C2a_cond_ret_arrow_valid_prop.ts",
         "function f<T>(a: (1 + *)): T extends () => number ? {\n  x: number;\n} : never {\n  return null as any;\n}\nconst bad = (;\n",
         "function f<T>(a: (1 + *)): T extends () => number ? {\n  x: number;\n  readonly y?: string;\n} : never {\n  return null as any;\n}\nconst bad = (;\n", true),
        (LanguageId::TypeScript, "new_C2b_cond_ret_arrow_bad_stmt.ts",
         "function f<T>(a: (1 + *)): T extends () => number ? {\n  x: number;\n} : never {\n  return null as any;\n}\nconst bad = (;\n",
         "function f<T>(a: (1 + *)): T extends () => number ? {\n  x: number;\n  const z = 1;\n} : never {\n  return null as any;\n}\nconst bad = (;\n", false),
        (LanguageId::TypeScript, "ts_ternary_lt_broken_expr_valid.ts",
         "const x = a < b ? (1 + *) + f(1) : {\n  c: 1,\n",
         "const x = a < b ? (1 + *) + f(1) : {\n  c: 1,\n  d: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_ternary_lt_broken_prop_bad.ts",
         "const x = a < b ? (1 + *) + f(1) : {\n  c: 1,\n",
         "const x = a < b ? (1 + *) + f(1) : {\n  c: 1,\n  d: string;\n", false),
        (LanguageId::TypeScript, "ts_ternary_lt_nospace_valid.ts",
         "const x = a<b ? (1 + *) + f(1): {\n  c: 1,\n",
         "const x = a<b ? (1 + *) + f(1): {\n  c: 1,\n  d: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_ternary_lt_nospace_bad.ts",
         "const x = a<b ? (1 + *) + f(1): {\n  c: 1,\n",
         "const x = a<b ? (1 + *) + f(1): {\n  c: 1,\n  d: string;\n", false),
        (LanguageId::TypeScript, "ts_ternary_lt_gt_qmark_bad.ts",
         "const x = a < b ? c > d ? f(1): {\n  c: 1,\n",
         "const x = a < b ? c > d ? f(1): {\n  c: 1,\n  d: string;\n", false),
        (LanguageId::TypeScript, "ts_ret_cond_generic_preserve_ok.ts",
         "const f = <T extends string ? number : boolean>(x: (1 + *)): {\n  a: number;\n",
         "const f = <T extends string ? number : boolean>(x: (1 + *)): {\n  a: number;\n  b: string;\n", true),
        // 8. is_valid_mid_continuation_brace unmatched } only
        (LanguageId::JavaScript, "new_D1a_else_rbrace_only_in_tmpl_interp.js",
         "function f(c) {\n  if (c) {\n    return 1;\n  const s = `${c}`;\n  let bad = (;\n",
         "function f(c) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  const s = `${c}`;\n  let bad = (;\n", false),
        (LanguageId::TypeScript, "mid_else_rbrace_only_in_tmpl_interp.ts",
         "function f(c: boolean) {\n  if (c) {\n    return 1;\n  const s = `${c}`;\n  let bad = (;\n",
         "function f(c: boolean) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  const s = `${c}`;\n  let bad = (;\n", false),
        (LanguageId::JavaScript, "p2_D5_else_rbrace_only_balanced_obj_in_suffix.js",
         "function f(c) {\n  if (c) {\n    return 1;\n  const obj = { a: 1 };\n  let bad = (;\n",
         "function f(c) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  const obj = { a: 1 };\n  let bad = (;\n", false),
        (LanguageId::JavaScript, "p2_D6_else_rbrace_only_balanced_fn_in_suffix.js",
         "function f(c) {\n  if (c) {\n    return 1;\n  function inner() { return 3; }\n  let bad = (;\n",
         "function f(c) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  function inner() { return 3; }\n  let bad = (;\n", false),
        (LanguageId::Tsx, "mid_else_rbrace_only_tsx_jsx_expr.tsx",
         "function C(c: boolean) {\n  if (c) {\n    return 1;\n  const e = <div>{c}</div>;\n  let bad = (;\n",
         "function C(c: boolean) {\n  if (c) {\n    return 1;\n  } else {\n    return 2;\n  const e = <div>{c}</div>;\n  let bad = (;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }

    // 9. Clean 2k /[/*]/;\n exercising PrefixCache base_tree reuse (can_reuse == true)
    let clean_2k = format!("{}const y = 1 +\n", "/[/*]/;\n".repeat(2_000));
    let clean_2k_ok = format!("{}const z = 1 +\n", "/[/*]/;\n".repeat(2_000));
    let clean_2k_bad = format!("{}const y1 = 1 + *;\n", "/[/*]/;\n".repeat(2_000));
    let t0 = std::time::Instant::now();
    let v_ok = fw.verify_incremental(Some(&clean_2k), &clean_2k_ok, Path::new("clean_2k_semi_ok.js"), LanguageId::JavaScript);
    let elapsed = t0.elapsed();
    assert!(v_ok.is_valid(), "clean_2k_semi_ok: {v_ok:?}");
    let limit_clean_2k_ms = if cfg!(debug_assertions) { 20_000 } else { 5_000 };
    assert!(elapsed.as_millis() < limit_clean_2k_ms, "clean 2k /[/*]/; took {:?} (limit {limit_clean_2k_ms} ms)", elapsed);
    let v_bad = fw.verify_incremental(Some(&clean_2k), &clean_2k_bad, Path::new("clean_2k_semi_bad.js"), LanguageId::JavaScript);
    assert!(!v_bad.is_valid(), "clean_2k_semi_bad: {v_bad:?}");
}

#[test]
fn regression_iter23_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Focus 1: Rust containers, angles, nested openers & tuple return types
        (LanguageId::Rust, "N1a_struct_const_arr_lt_valid.rs",
         "struct S {\n  a: [u8; (1 < 2) as usize],\n  b: u32,\n",
         "struct S {\n  a: [u8; (1 < 2) as usize],\n  b: u32,\n  c: i32,\n", true),
        (LanguageId::Rust, "N1a_struct_const_arr_lt_prebroken_valid.rs",
         "struct S {\n  a: [u8; (1 < 2) as usize],\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: [u8; (1 < 2) as usize],\n  b: u32,\n  c: i32,\n  bad: (;\n}\n", true),
        (LanguageId::Rust, "u_rs_array_lt_in_struct_ctrl.rs",
         "struct S {\n  a: [u8; 1 < 2],\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: [u8; 1 < 2],\n  b: u32,\n  c: i32,\n  bad: (;\n}\n", true),
        (LanguageId::Rust, "N1a_impl_const_arr_lt_valid.rs",
         "impl Foo {\n  const X: [u8; (1 < 2) as usize] = [0; 1];\n  fn f() {}\n",
         "impl Foo {\n  const X: [u8; (1 < 2) as usize] = [0; 1];\n  fn f() {}\n  fn g() {}\n", true),
        (LanguageId::Rust, "N1a_enum_discrim_lt_valid.rs",
         "enum E {\n  A = (1 < 2) as isize,\n  B = 3,\n",
         "enum E {\n  A = (1 < 2) as isize,\n  B = 3,\n  C = 4,\n", true),
        (LanguageId::Rust, "N1b_struct_assoc_proj_unclosed_bad.rs",
         "struct S {\n  a: Box<<T as Trait>::Item,\n  b: u32,\n",
         "struct S {\n  a: Box<<T as Trait>::Item,\n  b: u32,\n  c: i32,\n", false),
        (LanguageId::Rust, "N1b_struct_assoc_proj_single_unclosed_bad.rs",
         "struct S {\n  a: Vec<Box<<T as Trait>::Item>,\n  b: u32,\n",
         "struct S {\n  a: Vec<Box<<T as Trait>::Item>,\n  b: u32,\n  c: i32,\n", false),
        (LanguageId::Rust, "rs_struct_assoc_proj_close_ok.rs",
         "struct S {\n  a: Vec<Box<<T as Trait>::Item>,\n",
         "struct S {\n  a: Vec<Box<<T as Trait>::Item>,\n  String>,\n", true),
        (LanguageId::Rust, "rs_struct_arr_lt_cand_close_ok.rs",
         "struct S {\n  a: Result<[u8; (1 < 2) as usize],\n",
         "struct S {\n  a: Result<[u8; (1 < 2) as usize],\n  String>,\n", true),
        (LanguageId::Rust, "adv_rs_single_line_struct_tuple_close_ok.rs",
         "struct S { a: (\n  u32,\n",
         "struct S { a: (\n  u32,\n  ),\n", true),
        (LanguageId::Rust, "adv_rs_single_line_struct_result_close_ok.rs",
         "struct S { a: Result<i32,\n",
         "struct S { a: Result<i32,\n  String>,\n", true),
        (LanguageId::Rust, "adv_rs_single_line_struct_tuple_bad_close.rs",
         "struct S { a: Vec<(\n  b: u32,\n",
         "struct S { a: Vec<(\n  b: u32,\n  ),\n", false),
        (LanguageId::Rust, "N2a_impl_type_eq_unclosed_angle_eof_bad.rs",
         "impl Foo {\n  type Item = Vec<\n",
         "impl Foo {\n  type Item = Vec<\n  fn g() {}\n", false),
        (LanguageId::Rust, "N2a_impl_type_eq_unclosed_angle_mid_bad.rs",
         "impl Foo {\n  type Item = Vec<\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  type Item = Vec<\n  fn a() {}\n  fn g() {}\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "N2b_impl_fn_multiline_gen_valid.rs",
         "impl Foo {\n  fn f<\n    A,\n",
         "impl Foo {\n  fn f<\n    A,\n    B,\n", true),
        (LanguageId::Rust, "N2b_impl_fn_multiline_gen_stmt_bad.rs",
         "impl Foo {\n  fn f<\n    A,\n",
         "impl Foo {\n  fn f<\n    A,\n    let x = 1;\n", false),
        (LanguageId::Rust, "N2b_struct_tuple_field_elem_valid.rs",
         "struct S {\n  a: (\n    u32,\n",
         "struct S {\n  a: (\n    u32,\n    i32,\n", true),
        (LanguageId::Rust, "N2b_struct_tuple_field_named_bad.rs",
         "struct S {\n  a: (\n    u32,\n",
         "struct S {\n  a: (\n    u32,\n    b: i32,\n", false),
        (LanguageId::Rust, "N2b_struct_dyn_fn_trait_elem_valid.rs",
         "struct S {\n  f: Box<dyn Fn(\n    i32,\n",
         "struct S {\n  f: Box<dyn Fn(\n    i32,\n    u32,\n", true),
        (LanguageId::Rust, "N2b_struct_dyn_fn_trait_named_bad.rs",
         "struct S {\n  f: Box<dyn Fn(\n    i32,\n",
         "struct S {\n  f: Box<dyn Fn(\n    i32,\n    b: u32,\n", false),
        (LanguageId::Rust, "N2b_struct_fn_ptr_nested_tuple_valid.rs",
         "struct S {\n  f: fn(\n    a: (\n      u32,\n",
         "struct S {\n  f: fn(\n    a: (\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "N2b_impl_fn_nested_tuple_param_valid.rs",
         "impl Foo {\n  fn f(\n    a: (\n      u32,\n",
         "impl Foo {\n  fn f(\n    a: (\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "adv_struct_nested_tuple_ok.rs",
         "struct S {\n  a: (\n    (\n      u32,\n",
         "struct S {\n  a: (\n    (\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "adv_impl_fn_ptr_param_ok.rs",
         "impl Foo {\n  fn outer(\n    a: fn(\n      x: u32,\n",
         "impl Foo {\n  fn outer(\n    a: fn(\n      x: u32,\n      y: i32,\n", true),
        (LanguageId::Rust, "rs_impl_const_arr_lt_paren_ctrl.rs",
         "impl Foo {\n  const X: [u8; (1 < 2) as usize] = foo(\n    1,\n",
         "impl Foo {\n  const X: [u8; (1 < 2) as usize] = foo(\n    1,\n    2,\n", true),
        (LanguageId::Rust, "adv_fn_broken_ret_tuple_named_bad.rs",
         "fn foo(x: (1 + *)) -> (\n  i32,\n",
         "fn foo(x: (1 + *)) -> (\n  i32,\n  b: u32,\n", false),
        (LanguageId::Rust, "adv_fn_broken_ret_tuple_elem_ok.rs",
         "fn foo(x: (1 + *)) -> (\n  i32,\n",
         "fn foo(x: (1 + *)) -> (\n  i32,\n  u32,\n", true),
        (LanguageId::Rust, "adv_fn_broken_ret_fn_ptr_named_ok.rs",
         "fn foo(x: (1 + *)) -> fn(\n  a: u32,\n",
         "fn foo(x: (1 + *)) -> fn(\n  a: u32,\n  b: i32,\n", true),
        (LanguageId::Rust, "adv_fn_lt_in_param_ret_tuple_bad.rs",
         "fn foo(x: (1 < 2)) -> (\n  i32,\n",
         "fn foo(x: (1 < 2)) -> (\n  i32,\n  b: u32,\n", false),
        // Focus 2: TS/JS return types, conditional generics, arrow bodies & expression braces
        (LanguageId::TypeScript, "adv_ts_arrow_ret_ternary_obj_broken_prefix_bad.ts",
         "const f = (x: (1 + *)): number => cond ? 1 : {\n  a: 1,\n",
         "const f = (x: (1 + *)): number => cond ? 1 : {\n  a: 1,\n  b: string;\n", false),
        (LanguageId::TypeScript, "adv_ts_arrow_ret_ternary_obj_broken_prefix_ok.ts",
         "const f = (x: (1 + *)): number => cond ? 1 : {\n  a: 1,\n",
         "const f = (x: (1 + *)): number => cond ? 1 : {\n  a: 1,\n  b: 2,\n", true),
        (LanguageId::TypeScript, "adv_ts_ret_type_fn_body_stmt_ok.ts",
         "function f(x: (1 + *)): Foo {\n  const z = 1;\n",
         "function f(x: (1 + *)): Foo {\n  const z = 1;\n  return z;\n", true),
        (LanguageId::TypeScript, "adv_ts_ret_type_fn_body_prop_bad.ts",
         "function f(x: (1 + *)): Foo {\n  const z = 1;\n",
         "function f(x: (1 + *)): Foo {\n  const z = 1;\n  readonly y?: string;\n", false),
        (LanguageId::TypeScript, "adv_ts_ret_arrow_void_body_ok.ts",
         "function f(x: (1 + *)): () => void {\n  return () => {};\n",
         "function f(x: (1 + *)): () => void {\n  return () => {};\n  const z = 1;\n", true),
        (LanguageId::TypeScript, "adv_ts_ret_arrow_void_prop_bad.ts",
         "function f(x: (1 + *)): () => void {\n",
         "function f(x: (1 + *)): () => void {\n  readonly y?: string;\n", false),
        (LanguageId::TypeScript, "N3a_prebroken_arrow_body_valid_stmt.ts",
         "const f = (a: (1 + *)): number => {\n  const x = 1;\n};\n",
         "const f = (a: (1 + *)): number => {\n  const x = 1;\n  const y = 2;\n};\n", true),
        (LanguageId::TypeScript, "N3a_prebroken_arrow_body_bad_obj_spread.ts",
         "const f = (a: (1 + *)): number => {\n  const x = 1;\n};\n",
         "const f = (a: (1 + *)): number => {\n  const x = 1;\n  ...other,\n};\n", false),
        (LanguageId::TypeScript, "N3b_ret_fn_type_obj_ret_valid_prop.ts",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n} {\n  return () => ({ y: 1 });\n}\n",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n  readonly z?: boolean;\n} {\n  return () => ({ y: 1 });\n}\n", true),
        (LanguageId::TypeScript, "N3b_ret_fn_type_obj_ret_bad_stmt.ts",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n} {\n  return () => ({ y: 1 });\n}\n",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n  const z = 1;\n} {\n  return () => ({ y: 1 });\n}\n", false),
        (LanguageId::TypeScript, "ts_ret_fn_type_second_brace_body_ok.ts",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n} {\n  const a = 1;\n",
         "function f(a: (1 + *)): (x: string) => {\n  y: number;\n} {\n  const a = 1;\n  return () => ({ y: a });\n", true),
        (LanguageId::TypeScript, "N3b_generic_default_cond_obj_valid_prop.ts",
         "function f<T = Foo<U extends string ? { a: number } : boolean>>(a: (1 + *)): {\n  x: number;\n} {\n  return { x: 1 };\n}\n",
         "function f<T = Foo<U extends string ? { a: number } : boolean>>(a: (1 + *)): {\n  x: number;\n  readonly y?: string;\n} {\n  return { x: 1 };\n}\n", true),
        (LanguageId::TypeScript, "N3b_generic_default_cond_obj_bad_stmt.ts",
         "function f<T = Foo<U extends string ? { a: number } : boolean>>(a: (1 + *)): {\n  x: number;\n} {\n  return { x: 1 };\n}\n",
         "function f<T = Foo<U extends string ? { a: number } : boolean>>(a: (1 + *)): {\n  x: number;\n  const z = 1;\n} {\n  return { x: 1 };\n}\n", false),
        (LanguageId::TypeScript, "c2_cond_gen_brace_branch_valid_readonly.ts",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n  readonly d: string;\n", true),
        (LanguageId::TypeScript, "c2_cond_gen_brace_branch_valid_opt.ts",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n  d?: string;\n", true),
        (LanguageId::TypeScript, "c2_cond_gen_brace_branch_bad_ret.ts",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n",
         "function f<T, U = T extends string ? { a: number } : { b: string }>(\n  x = (1 + *)\n): {\n  c: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "ts_ret_fn_intersect_valid.ts",
         "function f(x: (1 + *)): (() => void) & {\n  a: number;\n",
         "function f(x: (1 + *)): (() => void) & {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "adv_ts_return_obj_shorthand_ok.ts",
         "function g() {\n  return {\n    foo(\n      a: number,\n",
         "function g() {\n  return {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_export_default_obj_shorthand_ok.ts",
         "export default {\n  foo(\n    a: number,\n",
         "export default {\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_return_ternary_obj_shorthand_ok.ts",
         "function g(c: boolean) {\n  return c ? {} : {\n    foo(\n      a: number,\n",
         "function g(c: boolean) {\n  return c ? {} : {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_switch_case_block_stmt_ctrl.ts",
         "switch (x) {\n  case 1: {\n    const a = 1;\n",
         "switch (x) {\n  case 1: {\n    const a = 1;\n    return a;\n", true),
        // Focus 3: TS/TSX nested generic decorators & object shorthand methods
        (LanguageId::TypeScript, "adv_ts_decorator_nested_generic_bad.ts",
         "class C {\n  @dec<A, B<C>>(\n    a,\n",
         "class C {\n  @dec<A, B<C>>(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_decorator_nested_generic_ok.ts",
         "class C {\n  @dec<A, B<C>>(\n    a,\n",
         "class C {\n  @dec<A, B<C>>(\n    a,\n    b,\n", true),
        (LanguageId::TypeScript, "adv_ts_ns_decorator_nested_generic_bad.ts",
         "class C {\n  @ns.dec<Map<string, number>>(\n    a,\n",
         "class C {\n  @ns.dec<Map<string, number>>(\n    a,\n    b: number,\n", false),
        (LanguageId::Tsx, "adv_tsx_decorator_nested_generic_bad.tsx",
         "class C {\n  @ns.dec<Map<string, number>>(\n    a,\n",
         "class C {\n  @ns.dec<Map<string, number>>(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_decorator_array_generic_bad.ts",
         "class C {\n  @dec<Array<T>>(\n    a,\n",
         "class C {\n  @dec<Array<T>>(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_decorator_broken_prefix_bad.ts",
         "class C {\n  bad = (1 + *);\n  @dec<Foo<Bar>>(\n    a,\n",
         "class C {\n  bad = (1 + *);\n  @dec<Foo<Bar>>(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_decorated_method_generic_ctrl.ts",
         "class C {\n  @dec<T>()\n  foo(\n    a: number,\n",
         "class C {\n  @dec<T>()\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_computed_dot_ok.ts",
         "const obj = {\n  [Symbol.iterator](\n    a: number,\n",
         "const obj = {\n  [Symbol.iterator](\n    a: number,\n    b: string,\n", true),
        (LanguageId::Tsx, "adv_tsx_obj_shorthand_computed_dot_ok.tsx",
         "const obj = {\n  [Symbol.iterator](\n    a: number,\n",
         "const obj = {\n  [Symbol.iterator](\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_computed_nested_ok.ts",
         "const obj = {\n  [arr[0]](\n    a: number,\n",
         "const obj = {\n  [arr[0]](\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_async_star_nospace_ok.ts",
         "const obj = {\n  async*foo(\n    a: number,\n",
         "const obj = {\n  async*foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_async_star_computed_ok.ts",
         "const obj = {\n  async * [Symbol.asyncIterator](\n    a: number,\n",
         "const obj = {\n  async * [Symbol.asyncIterator](\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_get_name_ok.ts",
         "const obj = {\n  get(\n    a: number,\n",
         "const obj = {\n  get(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_shorthand_after_lt_prop_ok.ts",
         "const obj = {\n  a: x < 1,\n  foo(\n    a: number,\n",
         "const obj = {\n  a: x < 1,\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "adv_ts_obj_arr_idx_call_bad.ts",
         "const obj = {\n  x: 1,\n  arr[0](\n    a,\n",
         "const obj = {\n  x: 1,\n  arr[0](\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_obj_a_idx_call_bad.ts",
         "const obj = {\n  a[0](\n    x,\n",
         "const obj = {\n  a[0](\n    x,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_obj_chained_bracket_call_bad.ts",
         "const obj = {\n  [a][0](\n    x,\n",
         "const obj = {\n  [a][0](\n    x,\n    b: number,\n", false),
        (LanguageId::TypeScript, "adv_ts_obj_dot_call_bad.ts",
         "const obj = {\n  obj.foo(\n    x,\n",
         "const obj = {\n  obj.foo(\n    x,\n    b: number,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
}

#[test]
fn regression_iter24_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // 1. Partial Rust delimiter closing
        (LanguageId::Rust, "r24_c1_struct_nested_tuple_partial_close_ok.rs",
         "struct S {\n  a: (\n    (\n      u32,\n",
         "struct S {\n  a: (\n    (\n      u32,\n    ),\n", true),
        (LanguageId::Rust, "r24_c1_impl_nested_tuple_partial_close_ok.rs",
         "impl Foo {\n  fn outer(\n    a: (\n      u32,\n",
         "impl Foo {\n  fn outer(\n    a: (\n      u32,\n    ),\n", true),
        (LanguageId::Rust, "r24_c1_struct_vec_paren_partial_close_ok.rs",
         "struct S {\n  a: Vec<(\n    u32,\n",
         "struct S {\n  a: Vec<(\n    u32,\n  ),\n", true),
        (LanguageId::Rust, "r24_c1_struct_result_paren_partial_close_ok.rs",
         "struct S {\n  a: Result<(\n    u32,\n",
         "struct S {\n  a: Result<(\n    u32,\n  ),\n", true),
        (LanguageId::Rust, "r24_c1_impl_fn_vec_angle_close_ok.rs",
         "impl Foo {\n  fn f(\n    a: Vec<\n",
         "impl Foo {\n  fn f(\n    a: Vec<\n    i32>,\n", true),
        (LanguageId::Rust, "r24_c1_struct_tuple_vec_angle_close_ok.rs",
         "struct S {\n  a: (\n    Vec<\n",
         "struct S {\n  a: (\n    Vec<\n    i32>,\n", true),
        (LanguageId::Rust, "r24_c1_impl_fn_hashmap_angle_close_ok.rs",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n    i32>,\n", true),
        (LanguageId::Rust, "r24_c1_struct_vec_paren_named_bad.rs",
         "struct S {\n  a: Vec<(\n    b: u32,\n",
         "struct S {\n  a: Vec<(\n    b: u32,\n  ),\n", false),
        (LanguageId::Rust, "r24_c1_struct_tuple_mismatch_rbrack_bad.rs",
         "struct S {\n  a: (\n    u32,\n",
         "struct S {\n  a: (\n    u32,\n  ]),\n", false),
        (LanguageId::Rust, "r24_c1_struct_vec_paren_mid_broken_bad.rs",
         "struct S {\n  a: Vec<(\n  b: u32,\n  bad: (;\n}\n",
         "struct S {\n  a: Vec<(\n  b: u32,\n  i32)\n  bad: (;\n}\n", false),
        // 2. Rust const/static RHS unclosed ::< and <
        (LanguageId::Rust, "r24_c2_impl_const_turbofish_fn_bad.rs",
         "impl Foo {\n  const X: Vec<i32> = Vec::<\n",
         "impl Foo {\n  const X: Vec<i32> = Vec::<\n  fn g() {}\n", false),
        (LanguageId::Rust, "r24_c2_impl_const_turbofish_arg_ok.rs",
         "impl Foo {\n  const X: Vec<i32> = Vec::<\n",
         "impl Foo {\n  const X: Vec<i32> = Vec::<\n  i32\n", true),
        (LanguageId::Rust, "r24_c2_impl_const_fn_turbofish_prebroken_bad.rs",
         "impl Foo {\n  const X: usize = foo::<\n  fn a() {}\n",
         "impl Foo {\n  const X: usize = foo::<\n  fn a() {}\n  fn g() {}\n", false),
        (LanguageId::Rust, "r24_c2_impl_const_cmp_lt_fn_bad.rs",
         "impl Foo {\n  const X: bool = 1 <\n",
         "impl Foo {\n  const X: bool = 1 <\n  fn g() {}\n", false),
        (LanguageId::Rust, "r24_c2_impl_const_cmp_lt_rhs_ok.rs",
         "impl Foo {\n  const X: bool = 1 <\n",
         "impl Foo {\n  const X: bool = 1 <\n  2;\n", true),
        (LanguageId::Rust, "r24_c2_impl_const_call_arg_ctrl_ok.rs",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n",
         "impl S {\n  const X: i32 = foo( (1 + *),\n    1,\n    2\n    3,\n", true),
        // 3. find_hdr_start multi-line fn signatures
        (LanguageId::Rust, "r24_c3_multiline_fn_params_ret_result_ok.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> Result<\n    String,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> Result<\n    String,\n    Error,\n", true),
        (LanguageId::Rust, "r24_c3_multiline_fn_params_ret_result_stmt_bad.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> Result<\n    String,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> Result<\n    String,\n    let x = 1;\n", false),
        (LanguageId::Rust, "r24_c3_multiline_fn_params_ret_tuple_ok.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> (\n    u32,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> (\n    u32,\n    i32,\n", true),
        (LanguageId::Rust, "r24_c3_multiline_fn_params_ret_tuple_named_bad.rs",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> (\n    u32,\n",
         "impl Foo {\n  fn f(\n    a: u32,\n    b: i32,\n  ) -> (\n    u32,\n    b: i32,\n", false),
        (LanguageId::Rust, "r24_c3_multiline_fn_gen_params_ok.rs",
         "impl Foo {\n  fn f<\n    A,\n    B,\n  >(\n    x: A,\n",
         "impl Foo {\n  fn f<\n    A,\n    B,\n  >(\n    x: A,\n    y: B,\n", true),
        (LanguageId::Rust, "r24_c3_multiline_fn_gen_params_stmt_bad.rs",
         "impl Foo {\n  fn f<\n    A,\n    B,\n  >(\n    x: A,\n",
         "impl Foo {\n  fn f<\n    A,\n    B,\n  >(\n    x: A,\n    let z = 1;\n", false),
        // 4. rust_suffix_close_prefix multi-bound where clauses
        (LanguageId::Rust, "r24_c4_where_multi_bound_ok.rs",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n    b: U,\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n", true),
        (LanguageId::Rust, "r24_c4_where_multi_bound_mid_broken_ok.rs",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n  const bad: usize = (;\n}\n",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n    b: U,\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n  const bad: usize = (;\n}\n", true),
        (LanguageId::Rust, "r24_c4_where_multi_bound_stmt_bad.rs",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n    let x = 1;\n  ) where\n    T: Clone,\n    U: Debug,\n  {}\n", false),
        // 5. rust_in_ctx_probe return-type <
        (LanguageId::Rust, "r24_c5_impl_ret_box_dyn_fn_ok.rs",
         "impl Foo {\n  fn f() -> Box<dyn Fn(\n    u32,\n",
         "impl Foo {\n  fn f() -> Box<dyn Fn(\n    u32,\n    i32,\n", true),
        (LanguageId::Rust, "r24_c5_impl_ret_box_dyn_fn_named_bad.rs",
         "impl Foo {\n  fn f() -> Box<dyn Fn(\n    u32,\n",
         "impl Foo {\n  fn f() -> Box<dyn Fn(\n    u32,\n    b: i32,\n", false),
        (LanguageId::Rust, "r24_c5_impl_ret_result_ok.rs",
         "impl Foo {\n  fn f() -> Result<i32,\n",
         "impl Foo {\n  fn f() -> Result<i32,\n    String,\n", true),
        (LanguageId::Rust, "r24_c5_trait_ret_result_ok.rs",
         "trait Foo {\n  fn f() -> Result<i32,\n",
         "trait Foo {\n  fn f() -> Result<i32,\n    String,\n", true),
        (LanguageId::Rust, "r24_c5_impl_ret_option_tuple_ok.rs",
         "impl Foo {\n  fn f() -> Option<(\n    u32,\n",
         "impl Foo {\n  fn f() -> Option<(\n    u32,\n    i32,\n", true),
        (LanguageId::Rust, "r24_c5_impl_ret_option_tuple_named_bad.rs",
         "impl Foo {\n  fn f() -> Option<(\n    u32,\n",
         "impl Foo {\n  fn f() -> Option<(\n    u32,\n    b: i32,\n", false),
        // 6. rust_in_ctx_probe HashMap<String, matching tree-sitter-rust truth
        (LanguageId::Rust, "r24_c6_impl_fn_hashmap_stmt_bad.rs",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n    let x = 1;\n", false),
        (LanguageId::Rust, "r24_c6_impl_fn_iter_assoc_bound_ok.rs",
         "impl Foo {\n  fn f(\n    a: impl Iterator<\n",
         "impl Foo {\n  fn f(\n    a: impl Iterator<\n    Item: Clone,\n", true),
        // 7. ts_ret_after_expects_obj_type nested <...> / [...] / (...) & arrow-var return-fn types
        (LanguageId::TypeScript, "r24_c7_arrow_ret_paren_fn_obj_ok.ts",
         "const f = (x: (1 + *)): ((y: string) => {\n  a: number;\n}) => {\n  return () => ({ a: 1 });\n}\n",
         "const f = (x: (1 + *)): ((y: string) => {\n  a: number;\n  readonly b: string;\n}) => {\n  return () => ({ a: 1 });\n}\n", true),
        (LanguageId::TypeScript, "r24_c7_arrow_ret_paren_fn_obj_bad.ts",
         "const f = (x: (1 + *)): ((y: string) => {\n  a: number;\n}) => {\n  return () => ({ a: 1 });\n}\n",
         "const f = (x: (1 + *)): ((y: string) => {\n  a: number;\n  const z = 1;\n}) => {\n  return () => ({ a: 1 });\n}\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_generic_arrow_obj_ok.ts",
         "function f(x: (1 + *)): Foo<() => {\n  a: number;\n",
         "function f(x: (1 + *)): Foo<() => {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_generic_arrow_obj_bad.ts",
         "function f(x: (1 + *)): Foo<() => {\n  a: number;\n",
         "function f(x: (1 + *)): Foo<() => {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_generic_cond_obj_ok.ts",
         "function f<T>(x: (1 + *)): Foo<T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): Foo<T extends string ? {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_generic_cond_obj_bad.ts",
         "function f<T>(x: (1 + *)): Foo<T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): Foo<T extends string ? {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_cond_qmark_ok.ts",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_cond_qmark_bad.ts",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? {\n  a: number;\n  const z = 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_cond_colon_ok.ts",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? { a: number } : {\n  b: string;\n",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? { a: number } : {\n  b: string;\n  readonly c: number;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_cond_colon_bad.ts",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? { a: number } : {\n  b: string;\n",
         "function f<T>(x: (1 + *)): Record<string, T extends string ? { a: number } : {\n  b: string;\n  const z = 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_tuple_cond_qmark_ok.ts",
         "function f<T>(x: (1 + *)): [T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): [T extends string ? {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_tuple_cond_qmark_bad.ts",
         "function f<T>(x: (1 + *)): [T extends string ? {\n  a: number;\n",
         "function f<T>(x: (1 + *)): [T extends string ? {\n  a: number;\n  const z = 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_arrow_obj_ok.ts",
         "function f(x: (1 + *)): Record<string, () => {\n  a: number;\n",
         "function f(x: (1 + *)): Record<string, () => {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c7_fn_ret_record_arrow_obj_bad.ts",
         "function f(x: (1 + *)): Record<string, () => {\n  a: number;\n",
         "function f(x: (1 + *)): Record<string, () => {\n  a: number;\n  const z = 1;\n", false),
        (LanguageId::TypeScript, "r24_c7_arrow_var_ret_fn_obj_ok.ts",
         "const f = (x: (1 + *)): (y: number) => {\n  a: string;\n} => (y) => ({ a: String(y) });\n",
         "const f = (x: (1 + *)): (y: number) => {\n  a: string;\n  readonly b?: number;\n} => (y) => ({ a: String(y) });\n", true),
        (LanguageId::TypeScript, "r24_c7_arrow_var_ret_fn_obj_bad.ts",
         "const f = (x: (1 + *)): (y: number) => {\n  a: string;\n} => (y) => ({ a: String(y) });\n",
         "const f = (x: (1 + *)): (y: number) => {\n  a: string;\n  const z = 1;\n} => (y) => ({ a: String(y) });\n", false),
        (LanguageId::TypeScript, "r24_c7_arrow_var_paren_union_body_ok.ts",
         "const f = (x: (1 + *)): (A | B) => {\n  const z = 1;\n",
         "const f = (x: (1 + *)): (A | B) => {\n  const z = 1;\n  return z;\n", true),
        (LanguageId::TypeScript, "r24_c7_arrow_var_paren_union_prop_bad.ts",
         "const f = (x: (1 + *)): (A | B) => {\n  const z = 1;\n",
         "const f = (x: (1 + *)): (A | B) => {\n  const z = 1;\n  readonly b: string;\n", false),
        // 8. TS tuple return type [number, { / [string, { / [{
        (LanguageId::TypeScript, "r24_c8_fn_ret_tuple_num_obj_ok.ts",
         "function f(x: (1 + *)): [number, {\n  a: string;\n",
         "function f(x: (1 + *)): [number, {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r24_c8_fn_ret_tuple_num_obj_spread_bad.ts",
         "function f(x: (1 + *)): [number, {\n  a: string;\n",
         "function f(x: (1 + *)): [number, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r24_c8_fn_ret_tuple_only_obj_ok.ts",
         "function f(x: (1 + *)): [{\n  a: string;\n",
         "function f(x: (1 + *)): [{\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r24_c8_fn_ret_tuple_only_obj_spread_bad.ts",
         "function f(x: (1 + *)): [{\n  a: string;\n",
         "function f(x: (1 + *)): [{\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r24_c8_fn_ret_tuple_str_obj_ok.ts",
         "function f(x: (1 + *)): [string, {\n  a: number;\n",
         "function f(x: (1 + *)): [string, {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r24_c8_arrow_ret_tuple_num_obj_ok.ts",
         "const f = (x: (1 + *)): [number, {\n  a: string;\n",
         "const f = (x: (1 + *)): [number, {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r24_c8_fn_ret_multiline_tuple_obj_ok.ts",
         "function f(x: (1 + *)): [\n  number,\n  {\n    a: string;\n",
         "function f(x: (1 + *)): [\n  number,\n  {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r24_c8_fn_ret_multiline_tuple_obj_bad.ts",
         "function f(x: (1 + *)): [\n  number,\n  {\n    a: string;\n",
         "function f(x: (1 + *)): [\n  number,\n  {\n    a: string;\n    ...other,\n", false),
        // 9. Pre-broken TS class methods & nested object methods/arrows
        (LanguageId::TypeScript, "r24_c9_class_method_ret_type_ok.ts",
         "class C {\n  foo(x: (1 + *)): Bar {\n    const a = 1;\n",
         "class C {\n  foo(x: (1 + *)): Bar {\n    const a = 1;\n    return a;\n", true),
        (LanguageId::TypeScript, "r24_c9_class_method_ret_type_prop_bad.ts",
         "class C {\n  foo(x: (1 + *)): Bar {\n    const a = 1;\n",
         "class C {\n  foo(x: (1 + *)): Bar {\n    const a = 1;\n    readonly y?: string;\n", false),
        (LanguageId::TypeScript, "r24_c9_class_method_arrow_ret_ok.ts",
         "class C {\n  foo(x: (1 + *)): () => void {\n    const a = 1;\n",
         "class C {\n  foo(x: (1 + *)): () => void {\n    const a = 1;\n    return () => {};\n", true),
        (LanguageId::TypeScript, "r24_c9_class_method_arrow_ret_prop_bad.ts",
         "class C {\n  foo(x: (1 + *)): () => void {\n",
         "class C {\n  foo(x: (1 + *)): () => void {\n    readonly y?: string;\n", false),
        (LanguageId::TypeScript, "r24_c9_class_method_noret_ok.ts",
         "class C {\n  foo(x: (1 + *)) {\n    const a = 1;\n",
         "class C {\n  foo(x: (1 + *)) {\n    const a = 1;\n    return a;\n", true),
        (LanguageId::TypeScript, "r24_c9_class_method_noret_prop_bad.ts",
         "class C {\n  foo(x: (1 + *)) {\n",
         "class C {\n  foo(x: (1 + *)) {\n    readonly y?: string;\n", false),
        (LanguageId::TypeScript, "r24_c9_obj_method_ret_num_ok.ts",
         "const obj = {\n  foo(x: (1 + *)): number {\n    const a = 1;\n",
         "const obj = {\n  foo(x: (1 + *)): number {\n    const a = 1;\n    return a;\n", true),
        (LanguageId::TypeScript, "r24_c9_obj_method_ret_num_prop_bad.ts",
         "const obj = {\n  foo(x: (1 + *)): number {\n    const a = 1;\n",
         "const obj = {\n  foo(x: (1 + *)): number {\n    const a = 1;\n    readonly y?: string;\n", false),
        (LanguageId::TypeScript, "r24_c9_obj_arrow_ret_num_ok.ts",
         "const obj = {\n  bar: (x: (1 + *)): number => {\n    const a = 1;\n",
         "const obj = {\n  bar: (x: (1 + *)): number => {\n    const a = 1;\n    return a;\n", true),
        (LanguageId::TypeScript, "r24_c9_obj_arrow_ret_num_prop_bad.ts",
         "const obj = {\n  bar: (x: (1 + *)): number => {\n    const a = 1;\n",
         "const obj = {\n  bar: (x: (1 + *)): number => {\n    const a = 1;\n    readonly y?: string;\n", false),
        // 10. Object literal non-method call x: y ? foo(
        (LanguageId::TypeScript, "r24_c10_obj_ternary_call_typed_param_bad.ts",
         "const obj = {\n  x: y ? foo(\n    a,\n",
         "const obj = {\n  x: y ? foo(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r24_c10_obj_ternary_call_arg_ok.ts",
         "const obj = {\n  x: y ? foo(\n    a,\n",
         "const obj = {\n  x: y ? foo(\n    a,\n    b,\n", true),
        // 11. Decorator object-type generics & parenthesized decorators
        (LanguageId::TypeScript, "r24_c11_dec_obj_generic_bad.ts",
         "class C {\n  @dec<{ a: number }>(\n    a,\n",
         "class C {\n  @dec<{ a: number }>(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r24_c11_dec_obj_generic_ok.ts",
         "class C {\n  @dec<{ a: number }>(\n    a,\n",
         "class C {\n  @dec<{ a: number }>(\n    a,\n    b,\n", true),
        (LanguageId::TypeScript, "r24_c11_dec_parens_expr_bad.ts",
         "class C {\n  @(getDec())(\n    a,\n",
         "class C {\n  @(getDec())(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r24_c11_dec_cond_expr_bad.ts",
         "class C {\n  @(cond ? dec1 : dec2)(\n    a,\n",
         "class C {\n  @(cond ? dec1 : dec2)(\n    a,\n    b: number,\n", false),
        // 12. is_js_expr_brace_hdr ternaries/logical-or/case/export default & numeric/string keys
        (LanguageId::TypeScript, "r24_c12_return_multiline_ternary_shorthand_ok.ts",
         "function g(c: boolean) {\n  return c ?\n    1 :\n    {\n      foo(\n        a: number,\n",
         "function g(c: boolean) {\n  return c ?\n    1 :\n    {\n      foo(\n        a: number,\n        b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_return_multiline_ternary_braced_ok.ts",
         "function g(c: boolean) {\n  return c ?\n    { a: 1 } :\n    {\n      foo(\n        a: number,\n",
         "function g(c: boolean) {\n  return c ?\n    { a: 1 } :\n    {\n      foo(\n        a: number,\n        b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_return_ternary_first_branch_ok.ts",
         "function g(c: boolean) {\n  return c ? {\n    foo(\n      a: number,\n",
         "function g(c: boolean) {\n  return c ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_return_broken_ternary_first_branch_ok.ts",
         "function g() {\n  return (1 + *) ? {\n    foo(\n      a: number,\n",
         "function g() {\n  return (1 + *) ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_return_or_shorthand_ok.ts",
         "function g(x: any) {\n  return x || {\n    foo(\n      a: number,\n",
         "function g(x: any) {\n  return x || {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_case_return_ternary_shorthand_ok.ts",
         "switch (x) {\n  case 1: return c ? {} : {\n    foo(\n      a: number,\n",
         "switch (x) {\n  case 1: return c ? {} : {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_export_default_ternary_shorthand_ok.ts",
         "export default cond ? {} : {\n  foo(\n    a: number,\n",
         "export default cond ? {} : {\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_switch_case_stmt_blk_ctrl_bad.ts",
         "switch (x) {\n  case 1: {\n    foo(\n      a,\n",
         "switch (x) {\n  case 1: {\n    foo(\n      a,\n      b: number,\n", false),
        (LanguageId::TypeScript, "r24_c12_switch_default_stmt_blk_ctrl_bad.ts",
         "switch (x) {\n  default: {\n    foo(\n      a,\n",
         "switch (x) {\n  default: {\n    foo(\n      a,\n      b: number,\n", false),
        (LanguageId::TypeScript, "r24_c12_obj_numeric_shorthand_ok.ts",
         "const obj = {\n  0(\n    a: number,\n",
         "const obj = {\n  0(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r24_c12_obj_dquote_shorthand_ok.ts",
         "const obj = {\n  \"my-method\"(\n    a: number,\n",
         "const obj = {\n  \"my-method\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r24_c11_dec_obj_generic_prebroken_bad.ts",
         "class C {\n  const broken = (;\n  @dec<{ a: number }>(\n    a,\n",
         "class C {\n  const broken = (;\n  @dec<{ a: number }>(\n    a,\n    b: number,\n", false),
        (LanguageId::Rust, "r24_rs_blk_extra_rbrace_no_panic_bad.rs",
         "struct S {\n  a: u32,\n",
         "struct S {\n  a: u32,\n  }\n}\n", false),
        (LanguageId::Rust, "r24_rs_blk_eof_nested_fn_ok.rs",
         "impl Foo {\n",
         "impl Foo {\n  fn f(\n    a: i32,\n  ) -> i32 {\n    let y = 1;\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
    // Verify Cluster 6 HashMap<String, and Result<i32, match standalone tree-sitter-rust truth
    for (name, full, base, cand) in [
        (
            "r24_c6_hm",
            "impl Foo {\n  fn f(\n    a: HashMap<String,\n    b: u32,\n  >) {}\n}\n",
            "impl Foo {\n  fn f(\n    a: HashMap<String,\n",
            "impl Foo {\n  fn f(\n    a: HashMap<String,\n    b: u32,\n",
        ),
        (
            "r24_c6_res",
            "impl Foo {\n  fn f(\n    a: Result<i32,\n    b: u32,\n  >) {}\n}\n",
            "impl Foo {\n  fn f(\n    a: Result<i32,\n",
            "impl Foo {\n  fn f(\n    a: Result<i32,\n    b: u32,\n",
        ),
    ] {
        let full_valid = fw.verify(full, Path::new(name), LanguageId::Rust).is_valid();
        let inc_valid = fw
            .verify_incremental(Some(base), cand, Path::new(name), LanguageId::Rust)
            .is_valid();
        assert_eq!(inc_valid, full_valid, "{name} should match standalone tree-sitter-rust truth");
    }
}

#[test]
fn regression_iter25_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // 1. Rust impl/trait with pre-broken prior item editing subsequent fn
        (LanguageId::Rust, "r25_c1_impl_prior_const_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "r25_c1_impl_prior_const_stmt_bad.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r25_c1_impl_prior_fn_body_ok.rs",
         "impl Foo {\n  fn prev() {\n    let x = (;\n  }\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn prev() {\n    let x = (;\n  }\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "r25_c1_impl_prior_fn_body_stmt_bad.rs",
         "impl Foo {\n  fn prev() {\n    let x = (;\n  }\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn prev() {\n    let x = (;\n  }\n  fn f(\n    a: u32,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r25_c1_impl_prior_fn_sig_ok.rs",
         "impl Foo {\n  fn bad(x: (;)\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn bad(x: (;)\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "r25_c1_impl_prior_fn_sig_stmt_bad.rs",
         "impl Foo {\n  fn bad(x: (;)\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  fn bad(x: (;)\n  fn f(\n    a: u32,\n    let bad = ;\n", false),
        // 2. rust_scan_container_tail multi-bound where clauses
        (LanguageId::Rust, "r25_c2_where_2nd_paren_eof_ok.rs",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: From<(\n      u32,\n",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: From<(\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "r25_c2_where_2nd_paren_mid_ok.rs",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: From<(\n      u32,\n    )>\n  {}\n  const bad: usize = (;\n}\n",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: From<(\n      u32,\n      i32,\n    )>\n  {}\n  const bad: usize = (;\n}\n", true),
        (LanguageId::Rust, "r25_c2_where_2nd_vec_eof_ok.rs",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: Iterator<Item = Vec<\n",
         "impl Foo {\n  fn f<T, U>()\n  where\n    T: Clone,\n    U: Iterator<Item = Vec<\n      u32>,\n", true),
        (LanguageId::Rust, "r25_c2_where_2nd_fn_bound_ok.rs",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Fn(\n      u32,\n",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Fn(\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "r25_c2_where_2nd_fn_bound_named_bad.rs",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Fn(\n      u32,\n",
         "impl Foo {\n  fn f<T, U>(\n    a: T,\n  ) where\n    T: Clone,\n    U: Fn(\n      u32,\n      x: i32,\n", false),
        // 3. Rust trait associated type bounds
        (LanguageId::Rust, "r25_c3_trait_assoc_bound_ok.rs",
         "trait T {\n  type Assoc: Iterator<\n",
         "trait T {\n  type Assoc: Iterator<\n    Item: Clone,\n", true),
        (LanguageId::Rust, "r25_c3_trait_assoc_bound_send_ok.rs",
         "trait T {\n  type Assoc: IntoIterator<\n",
         "trait T {\n  type Assoc: IntoIterator<\n    Item: Send + 'static,\n", true),
        (LanguageId::Rust, "r25_c3_trait_assoc_bound_stmt_bad.rs",
         "trait T {\n  type Assoc: Iterator<\n",
         "trait T {\n  type Assoc: Iterator<\n    let x = 1;\n", false),
        (LanguageId::Rust, "r25_c3_struct_vec_field_bad.rs",
         "struct S {\n  a: Vec<\n",
         "struct S {\n  a: Vec<\n  b: u32,\n", false),
        (LanguageId::Rust, "r25_c3_impl_fn_hashmap_stmt_bad.rs",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n",
         "impl Foo {\n  fn f(\n    a: HashMap<String,\n    let x = 1;\n", false),
        // 4. Rust incomplete const/static RHS completion before }
        (LanguageId::Rust, "r25_c4_prebroken_const_lt_ok.rs",
         "fn broken( {}\nimpl Foo {\n  const X: bool = 1 <\n}\n",
         "fn broken( {}\nimpl Foo {\n  const X: bool = 1 <\n  2;\n}\n", true),
        (LanguageId::Rust, "r25_c4_prebroken_const_lt_fn_bad.rs",
         "fn broken( {}\nimpl Foo {\n  const X: bool = 1 <\n}\n",
         "fn broken( {}\nimpl Foo {\n  const X: bool = 1 <\n  fn g() {}\n}\n", false),
        (LanguageId::Rust, "r25_c4_prebroken_const_add_ok.rs",
         "fn broken( {}\nimpl Foo {\n  const X: usize = 1 +\n}\n",
         "fn broken( {}\nimpl Foo {\n  const X: usize = 1 +\n  2;\n}\n", true),
        (LanguageId::Rust, "r25_c4_top_const_add_ok.rs",
         "const X: usize = 1 +\n",
         "const X: usize = 1 +\n  2;\n", true),
        // 5. Rust array length after ;
        (LanguageId::Rust, "r25_c5_struct_array_len_ok.rs",
         "struct S {\n  x: [u8;\n",
         "struct S {\n  x: [u8;\n    4\n", true),
        (LanguageId::Rust, "r25_c5_struct_array_len_fn_bad.rs",
         "struct S {\n  x: [u8;\n",
         "struct S {\n  x: [u8;\n    fn f() {}\n", false),
        // 6. TS generic-wrapped type annotations
        (LanguageId::TypeScript, "r25_c6_const_array_obj_ok.ts",
         "const x: Array<{\n  a: string;\n",
         "const x: Array<{\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_const_array_obj_spread_bad.ts",
         "const x: Array<{\n  a: string;\n",
         "const x: Array<{\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_const_array_obj_stmt_bad.ts",
         "const x: Array<{\n  a: (1 + *);\n",
         "const x: Array<{\n  a: (1 + *);\n  return 1;\n", false),
        (LanguageId::TypeScript, "r25_c6_const_array_tuple_obj_ok.ts",
         "const x: Array<[number, {\n  a: string;\n",
         "const x: Array<[number, {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_const_array_tuple_obj_spread_bad.ts",
         "const x: Array<[number, {\n  a: string;\n",
         "const x: Array<[number, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_iface_array_obj_ok.ts",
         "interface I {\n  prop: Array<{\n    a: string;\n",
         "interface I {\n  prop: Array<{\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_iface_array_obj_spread_bad.ts",
         "interface I {\n  prop: Array<{\n    a: string;\n",
         "interface I {\n  prop: Array<{\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_iface_array_tuple_obj_ok.ts",
         "interface I {\n  prop: Array<[number, {\n    a: string;\n",
         "interface I {\n  prop: Array<[number, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_iface_array_tuple_obj_spread_bad.ts",
         "interface I {\n  prop: Array<[number, {\n    a: string;\n",
         "interface I {\n  prop: Array<[number, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_fn_param_array_obj_ok.ts",
         "function f(a: Array<{\n  x: string;\n",
         "function f(a: Array<{\n  x: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_fn_param_array_obj_spread_bad.ts",
         "function f(a: Array<{\n  x: string;\n",
         "function f(a: Array<{\n  x: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_fn_param_array_tuple_obj_ok.ts",
         "function f(a: Array<[number, {\n  x: string;\n",
         "function f(a: Array<[number, {\n  x: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_fn_param_array_tuple_obj_spread_bad.ts",
         "function f(a: Array<[number, {\n  x: string;\n",
         "function f(a: Array<[number, {\n  x: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c6_record_obj_ok.ts",
         "const x: Record<string, {\n  a: number;\n",
         "const x: Record<string, {\n  a: number;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r25_c6_record_obj_spread_bad.ts",
         "const x: Record<string, {\n  a: number;\n",
         "const x: Record<string, {\n  a: number;\n  ...other,\n", false),
        // 7. TS type-level =>
        (LanguageId::TypeScript, "r25_c7_type_arrow_obj_ok.ts",
         "type T = (x: (1 + *)) => {\n  a: number;\n",
         "type T = (x: (1 + *)) => {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r25_c7_type_arrow_obj_stmt_bad.ts",
         "type T = (x: (1 + *)) => {\n  a: number;\n",
         "type T = (x: (1 + *)) => {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r25_c7_const_fn_annot_obj_ok.ts",
         "const x: (a: (1 + *)) => {\n  a: number;\n",
         "const x: (a: (1 + *)) => {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r25_c7_const_fn_annot_obj_stmt_bad.ts",
         "const x: (a: (1 + *)) => {\n  a: number;\n",
         "const x: (a: (1 + *)) => {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r25_c7_ctrl_const_arrow_num_ok.ts",
         "const f = (x): number => {\n  const a = 1;\n",
         "const f = (x): number => {\n  const a = 1;\n  return a;\n", true),
        (LanguageId::TypeScript, "r25_c7_ctrl_const_arrow_union_prop_bad.ts",
         "const f = (x): (A | B) => {\n  const a = 1;\n",
         "const f = (x): (A | B) => {\n  const a = 1;\n  readonly b: string;\n", false),
        // 8. TS parenthesized object return types
        (LanguageId::TypeScript, "r25_c8_ret_paren_obj_ok.ts",
         "function f(x: (1 + *)): ({\n  a: number;\n}) {\n  return {} as any;\n}\n",
         "function f(x: (1 + *)): ({\n  a: number;\n  readonly b?: string;\n}) {\n  return {} as any;\n}\n", true),
        (LanguageId::TypeScript, "r25_c8_ret_paren_obj_spread_bad.ts",
         "function f(x: (1 + *)): ({\n  a: number;\n}) {\n  return {} as any;\n}\n",
         "function f(x: (1 + *)): ({\n  a: number;\n  ...other,\n}) {\n  return {} as any;\n}\n", false),
        (LanguageId::TypeScript, "r25_c8_ret_arr_paren_obj_ok.ts",
         "function f(x: (1 + *)): Array<({\n  a: number;\n})> {\n  return [] as any;\n}\n",
         "function f(x: (1 + *)): Array<({\n  a: number;\n  readonly b?: string;\n})> {\n  return [] as any;\n}\n", true),
        (LanguageId::TypeScript, "r25_c8_ret_arrow_paren_obj_ok.ts",
         "function f(x: (1 + *)): (a: string) => ({\n  x: number;\n}) {\n  return () => ({ x: 1 });\n}\n",
         "function f(x: (1 + *)): (a: string) => ({\n  x: number;\n  readonly y?: string;\n}) {\n  return () => ({ x: 1 });\n}\n", true),
        (LanguageId::TypeScript, "r25_c8_ret_cond_paren_obj_ok.ts",
         "function f<T>(x: (1 + *)): T extends string ? ({\n  x: number;\n}) : never {\n  return {} as any;\n}\n",
         "function f<T>(x: (1 + *)): T extends string ? ({\n  x: number;\n  readonly y?: string;\n}) : never {\n  return {} as any;\n}\n", true),
        // 9. synthetic_opener_cands unclosed [/ ( offset & >= 2 nested wrappers
        (LanguageId::TypeScript, "r25_c9_tuple_param_tuple_ret_ok.ts",
         "function f(a: [string], x: (1 + *)): [string, {\n  a: number;\n",
         "function f(a: [string], x: (1 + *)): [string, {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r25_c9_tuple_param_tuple_ret_spread_bad.ts",
         "function f(a: [string], x: (1 + *)): [string, {\n  a: number;\n",
         "function f(a: [string], x: (1 + *)): [string, {\n  a: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c9_nested_tuple_obj_ok.ts",
         "function f(x: (1 + *)): [string, [number, {\n  id: number;\n",
         "function f(x: (1 + *)): [string, [number, {\n  id: number;\n  name: string;\n", true),
        (LanguageId::TypeScript, "r25_c9_nested_tuple_obj_spread_bad.ts",
         "function f(x: (1 + *)): [string, [number, {\n  id: number;\n",
         "function f(x: (1 + *)): [string, [number, {\n  id: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r25_c9_paren_tuple_obj_ok.ts",
         "function f(x: (1 + *)): ([number, {\n  id: number;\n",
         "function f(x: (1 + *)): ([number, {\n  id: number;\n  name: string;\n", true),
        // 11. JS/TS cond ? { / x || { / unbraced if/else if/lbl: / quoted method comments
        (LanguageId::TypeScript, "r25_c11_obj_ternary_shorthand_ok.ts",
         "const obj = {\n  a: cond ? {\n    foo(\n      a: number,\n",
         "const obj = {\n  a: cond ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_arr_ternary_shorthand_ok.ts",
         "const arr = [\n  cond ? {\n    bar(\n      a: number,\n",
         "const arr = [\n  cond ? {\n    bar(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_arr_or_shorthand_ok.ts",
         "const arr = [\n  x || {\n    bar(\n      a: number,\n",
         "const arr = [\n  x || {\n    bar(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_if_ret_multiline_ternary_ok.ts",
         "function g(c: boolean) {\n  if (c) return c ?\n    1 :\n    {\n      foo(\n        a: number,\n",
         "function g(c: boolean) {\n  if (c) return c ?\n    1 :\n    {\n      foo(\n        a: number,\n        b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_if_throw_multiline_ternary_ok.ts",
         "function g(c: boolean) {\n  if (c) throw c ?\n    new Error() :\n    {\n      foo(\n        a: number,\n",
         "function g(c: boolean) {\n  if (c) throw c ?\n    new Error() :\n    {\n      foo(\n        a: number,\n        b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_if_ret_ternary_ok.ts",
         "function g(cond: boolean, c: boolean) {\n  if (cond) return c ? {\n    foo(\n      a: number,\n",
         "function g(cond: boolean, c: boolean) {\n  if (cond) return c ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_else_if_ret_ternary_ok.ts",
         "function g(a: boolean, cond: boolean, c: boolean) {\n  if (a) {} else if (cond) return c ? {\n    foo(\n      a: number,\n",
         "function g(a: boolean, cond: boolean, c: boolean) {\n  if (a) {} else if (cond) return c ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_label_ret_ternary_ok.ts",
         "function g(c: boolean) {\n  lbl: return c ? {\n    foo(\n      a: number,\n",
         "function g(c: boolean) {\n  lbl: return c ? {\n    foo(\n      a: number,\n      b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_quoted_method_trail_comment_ok.ts",
         "const obj = {\n  \"my-method\" /* c */ (\n    a: number,\n",
         "const obj = {\n  \"my-method\" /* c */ (\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r25_c11_quoted_method_lead_comment_ok.ts",
         "const obj = {\n  /* c */ \"my-method\"(\n    a: number,\n",
         "const obj = {\n  /* c */ \"my-method\"(\n    a: number,\n    b: string,\n", true),
        // 12. TS subscript, optional-chain, and factory-call decorators
        (LanguageId::TypeScript, "r25_c12_dec_subscript_bad.ts",
         "class C {\n  @decs[0](\n    a,\n",
         "class C {\n  @decs[0](\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r25_c12_dec_ns_subscript_bad.ts",
         "class C {\n  @ns.decs[0](\n    a,\n",
         "class C {\n  @ns.decs[0](\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r25_c12_dec_optional_call_bad.ts",
         "class C {\n  @ns?.dec(\n    a,\n",
         "class C {\n  @ns?.dec(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r25_c12_dec_factory_call_bad.ts",
         "class C {\n  @dec()(\n    a,\n",
         "class C {\n  @dec()(\n    a,\n    b: number,\n", false),
        (LanguageId::TypeScript, "r25_c12_ctrl_dec_method_ok.ts",
         "class C {\n  @dec\n  foo(\n    a: number,\n",
         "class C {\n  @dec\n  foo(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r25_c12_ctrl_dec_call_method_ok.ts",
         "class C {\n  @dec()\n  foo(\n    a: number,\n",
         "class C {\n  @dec()\n  foo(\n    a: number,\n    b: string,\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
    // 10. Deep JS/TS object literals (> 24 opener groups) must stay ValueBrace, never labeled StmtBlock
    for (depth, prebroken) in [(26usize, true), (26usize, false), (100usize, true)] {
        let mut base = String::from("const obj = {\n");
        if prebroken {
            base.push_str("  broken: (*),\n");
        } else {
            for p in 0..25 { base.push_str(&format!("  // pad {p}\n")); }
        }
        for i in 1..=depth {
            base.push_str(&format!("  a{i}: {{\n"));
        }
        let cand_bad = format!("{base}  return 1;\n");
        let cand_ok = format!("{base}  k: 1,\n");
        let v_bad = fw.verify_incremental(Some(&base), &cand_bad, Path::new("deep_obj.ts"), LanguageId::TypeScript);
        let v_ok = fw.verify_incremental(Some(&base), &cand_ok, Path::new("deep_obj.ts"), LanguageId::TypeScript);
        assert!(!v_bad.is_valid(), "deep={depth} prebroken={prebroken} return 1; must be Invalid: {v_bad:?}");
        assert!(v_ok.is_valid(), "deep={depth} prebroken={prebroken} k: 1, must be Valid: {v_ok:?}");
    }
}

#[test]
fn regression_iter26_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Cluster 1A: object literal `<` ternary vs actual TS type annotations
        (LanguageId::TypeScript, "r26_c1a_obj_lt_tern_spread_ok.ts",
         "const obj = {\n  a: x < y ? {\n    k: 1,\n",
         "const obj = {\n  a: x < y ? {\n    k: 1,\n    ...other,\n", true),
        (LanguageId::TypeScript, "r26_c1a_obj_lt_tern_ro_bad.ts",
         "const obj = {\n  a: x < y ? {\n    k: 1,\n",
         "const obj = {\n  a: x < y ? {\n    k: 1,\n    readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r26_c1a_obj_lt_nospace_tern_spread_ok.ts",
         "const obj = {\n  a: x<y ? {\n    k: 1,\n",
         "const obj = {\n  a: x<y ? {\n    k: 1,\n    ...other,\n", true),
        (LanguageId::TypeScript, "r26_c1a_obj_lt_nospace_tern_ro_bad.ts",
         "const obj = {\n  a: x<y ? {\n    k: 1,\n",
         "const obj = {\n  a: x<y ? {\n    k: 1,\n    readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r26_c1a_fn_param_arr_obj_ok.ts",
         "function f(a: Array<{\n  k: string;\n",
         "function f(a: Array<{\n  k: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r26_c1a_fn_param_arr_obj_bad.ts",
         "function f(a: Array<{\n  k: string;\n",
         "function f(a: Array<{\n  k: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c1a_fn_param_arr_bracket_ok.ts",
         "function f(a: Array<[\n  string,\n",
         "function f(a: Array<[\n  string,\n  readonly number[],\n", true),
        // Cluster 1B: TS generic `extends` constraints (not `class C<T> extends Foo {`)
        (LanguageId::TypeScript, "r26_c1b_fn_gen_ext_obj_ok.ts",
         "function f<T extends {\n  a: string;\n",
         "function f<T extends {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c1b_fn_gen_ext_obj_bad.ts",
         "function f<T extends {\n  a: string;\n",
         "function f<T extends {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1b_fn_gen_ext_arr_obj_ok.ts",
         "function f<T extends Array<{\n  a: string;\n",
         "function f<T extends Array<{\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c1b_fn_gen_ext_arr_obj_bad.ts",
         "function f<T extends Array<{\n  a: string;\n",
         "function f<T extends Array<{\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1b_type_gen_ext_obj_ok.ts",
         "type Foo<T extends {\n  a: string;\n",
         "type Foo<T extends {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c1b_type_gen_ext_obj_bad.ts",
         "type Foo<T extends {\n  a: string;\n",
         "type Foo<T extends {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1b_class_gen_ext_arr_obj_ok.ts",
         "class C<T extends Array<{\n  a: string;\n",
         "class C<T extends Array<{\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c1b_class_gen_ext_arr_obj_bad.ts",
         "class C<T extends Array<{\n  a: string;\n",
         "class C<T extends Array<{\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1b_arrow_gen_ext_obj_ok.ts",
         "const f = <T extends {\n  a: string;\n",
         "const f = <T extends {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c1b_arrow_gen_ext_obj_bad.ts",
         "const f = <T extends {\n  a: string;\n",
         "const f = <T extends {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1b_class_outside_ext_ok.ts",
         "class C<T> extends Foo {\n  a: string;\n",
         "class C<T> extends Foo {\n  a: string;\n  m() {}\n", true),
        (LanguageId::TypeScript, "r26_c1b_class_outside_ext_bad.ts",
         "class C<T> extends Foo {\n  a: string;\n",
         "class C<T> extends Foo {\n  a: string;\n  return 1;\n", false),
        // Cluster 1C: TS call-expression generic object types vs `foo(a<b, {`
        (LanguageId::TypeScript, "r26_c1c_call_gen_obj_ok.ts",
         "foo<{\n  a: (1 + *);\n",
         "foo<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r26_c1c_call_gen_obj_spread_bad.ts",
         "foo<{\n  a: (1 + *);\n",
         "foo<{\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c1c_call_gen_obj_stmt_bad.ts",
         "foo<{\n  a: (1 + *);\n",
         "foo<{\n  a: (1 + *);\n  return 1;\n", false),
        (LanguageId::TypeScript, "r26_c1c_member_call_gen_obj_ok.ts",
         "obj.foo<{\n  a: (1 + *);\n",
         "obj.foo<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r26_c1c_member_call_gen_obj_spread_bad.ts",
         "obj.foo<{\n  a: (1 + *);\n",
         "obj.foo<{\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c1c_call_arg_cmp_obj_ok.ts",
         "foo(a<b, {\n  k: 1,\n",
         "foo(a<b, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r26_c1c_call_arg_cmp_obj_bad.ts",
         "foo(a<b, {\n  k: 1,\n",
         "foo(a<b, {\n  k: 1,\n  readonly b: string;\n", false),
        // Cluster 2: multi-level TS parameter types in synthetic_opener_cands
        (LanguageId::TypeScript, "r26_c2_fn_param_paren_obj_ok.ts",
         "function f(x: (1 + *), a: ({\n  id: number;\n",
         "function f(x: (1 + *), a: ({\n  id: number;\n  readonly name: string;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_paren_obj_bad.ts",
         "function f(x: (1 + *), a: ({\n  id: number;\n",
         "function f(x: (1 + *), a: ({\n  id: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c2_fn_param_arr_paren_obj_ok.ts",
         "function f(x: (1 + *), a: Array<({\n  id: number;\n",
         "function f(x: (1 + *), a: Array<({\n  id: number;\n  readonly name: string;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_arr_paren_obj_bad.ts",
         "function f(x: (1 + *), a: Array<({\n  id: number;\n",
         "function f(x: (1 + *), a: Array<({\n  id: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c2_fn_param_paren_inter_ok.ts",
         "function f(x: (1 + *), a: (A & {\n  y: string;\n",
         "function f(x: (1 + *), a: (A & {\n  y: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_paren_inter_bad.ts",
         "function f(x: (1 + *), a: (A & {\n  y: string;\n",
         "function f(x: (1 + *), a: (A & {\n  y: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c2_fn_param_arr_paren_inter_ok.ts",
         "function f(x: (1 + *), a: Array<(A & {\n  y: string;\n",
         "function f(x: (1 + *), a: Array<(A & {\n  y: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_arr_paren_inter_bad.ts",
         "function f(x: (1 + *), a: Array<(A & {\n  y: string;\n",
         "function f(x: (1 + *), a: Array<(A & {\n  y: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c2_fn_param_arrow_paren_obj_ok.ts",
         "function f(x: (1 + *), b: (x: number) => ({\n  y: string;\n",
         "function f(x: (1 + *), b: (x: number) => ({\n  y: string;\n  readonly z: number;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_arrow_paren_obj_bad.ts",
         "function f(x: (1 + *), b: (x: number) => ({\n  y: string;\n",
         "function f(x: (1 + *), b: (x: number) => ({\n  y: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r26_c2_fn_param_nested_obj_ok.ts",
         "function f(x: (1 + *), a: { prop: {\n  y: string;\n",
         "function f(x: (1 + *), a: { prop: {\n  y: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r26_c2_fn_param_nested_obj_bad.ts",
         "function f(x: (1 + *), a: { prop: {\n  y: string;\n",
         "function f(x: (1 + *), a: { prop: {\n  y: string;\n  ...other,\n", false),
        // Cluster 4: Rust pre-broken prior items (multi-line fn & unclosed `<`)
        (LanguageId::Rust, "r26_c4_impl_multiline_gen_fn_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n    b: U,\n", true),
        (LanguageId::Rust, "r26_c4_impl_multiline_gen_fn_bad.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r26_c4_impl_where_paren_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T, U>(\n    a: T,\n  )\n  where\n    T: Clone,\n    U: From<(\n      u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T, U>(\n    a: T,\n  )\n  where\n    T: Clone,\n    U: From<(\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "r26_c4_impl_ret_tuple_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n  ) -> (\n    u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f(\n    a: u32,\n  ) -> (\n    u32,\n    i32,\n", true),
        (LanguageId::Rust, "r26_c4_impl_fn_nl_lparen_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f\n  (\n    a: u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f\n  (\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "r26_c4_impl_const_multiline_ty_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  const V: Vec<\n    (\n      u32,\n",
         "impl Foo {\n  const BAD: usize = (;\n  const V: Vec<\n    (\n      u32,\n      i32,\n", true),
        (LanguageId::Rust, "r26_c4_trait_multiline_gen_fn_ok.rs",
         "trait Tr {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n",
         "trait Tr {\n  const BAD: usize = (;\n  fn f<T,\n    U>(\n    a: T,\n    b: U,\n", true),
        (LanguageId::Rust, "r26_c4_impl_prior_unclosed_lt_fn_ok.rs",
         "impl Foo {\n  const BAD: Vec< = 1;\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  const BAD: Vec< = 1;\n  fn f(\n    a: u32,\n    b: i32,\n", true),
        (LanguageId::Rust, "r26_c4_impl_prior_unclosed_lt_fn_bad.rs",
         "impl Foo {\n  const BAD: Vec< = 1;\n  fn f(\n    a: u32,\n",
         "impl Foo {\n  const BAD: Vec< = 1;\n  fn f(\n    a: u32,\n    let bad = ;\n", false),
        // Cluster 5: TS decorator before quoted method
        (LanguageId::TypeScript, "r26_c5_dec_quoted_method_ok.ts",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r26_c5_dec_call_quoted_method_ok.ts",
         "class C {\n  @dec()\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec()\n  \"my-method\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r26_c5_dec_sq_quoted_method_ok.ts",
         "class C {\n  @dec\n  'my-method'(\n    a: number,\n",
         "class C {\n  @dec\n  'my-method'(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r26_c5_dec_quoted_method_opt_ok.ts",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r26_c5_dec_quoted_method_stmt_bad.ts",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"my-method\"(\n    a: number,\n    return 1;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
    for (hdr, prebroken) in [
        ("interface Root {\n", true),
        ("interface Root {\n", false),
        ("type Root = {\n", true),
    ] {
        let mut prefix = String::from(hdr);
        if prebroken {
            prefix.push_str("  broken: (1 + *);\n");
        } else {
            for p in 0..25 { prefix.push_str(&format!("  // pad {p}\n")); }
        }
        for i in 1..=26 { prefix.push_str(&format!("  f{i}: {{\n")); }
        let base = format!("{prefix}    a: number;\n");
        let cand_bad = format!("{prefix}    return 1;\n");
        let cand_ok = format!("{prefix}    readonly b: boolean;\n");
        let v_bad = fw.verify_incremental(Some(&base), &cand_bad, Path::new("deep_iface.ts"), LanguageId::TypeScript);
        let v_ok = fw.verify_incremental(Some(&base), &cand_ok, Path::new("deep_iface.ts"), LanguageId::TypeScript);
        assert!(!v_bad.is_valid(), "hdr={hdr:?} prebroken={prebroken} return 1; must be Invalid: {v_bad:?}");
        assert!(v_ok.is_valid(), "hdr={hdr:?} prebroken={prebroken} readonly must be Valid: {v_ok:?}");
    }
    let mut deep_arr = String::from("interface I {\n  broken: (1 + *);\n");
    for i in 1..=25 { deep_arr.push_str(&format!("  a{i}: {{\n")); }
    deep_arr.push_str("  prop: Array<{\n");
    let v_arr_ok = fw.verify_incremental(Some(&deep_arr), &format!("{deep_arr}    readonly b: boolean;\n"), Path::new("deep_arr.ts"), LanguageId::TypeScript);
    let v_arr_bad = fw.verify_incremental(Some(&deep_arr), &format!("{deep_arr}    ...other,\n"), Path::new("deep_arr.ts"), LanguageId::TypeScript);
    assert!(v_arr_ok.is_valid(), "deep iface prop: Array<{{ readonly must be Valid: {v_arr_ok:?}");
    assert!(!v_arr_bad.is_valid(), "deep iface prop: Array<{{ ...other, must be Invalid: {v_arr_bad:?}");
    // Cluster 3B: > 24-group-drained JS/TS object literal entering shorthand method foo(a: number,
    let mut deep_short = String::from("const obj = {\n  broken: (*),\n  arr: [\n    {\n");
    for i in 1..=25 { deep_short.push_str(&format!("      a{i}: {{\n")); }
    deep_short.push_str("        foo(\n          a: number,\n");
    let v_sh_ok = fw.verify_incremental(Some(&deep_short), &format!("{deep_short}          b: string,\n"), Path::new("deep_sh.ts"), LanguageId::TypeScript);
    let v_sh_bad = fw.verify_incremental(Some(&deep_short), &format!("{deep_short}          return 1;\n"), Path::new("deep_sh.ts"), LanguageId::TypeScript);
    assert!(v_sh_ok.is_valid(), "drained obj literal shorthand method b: string, must be Valid: {v_sh_ok:?}");
    assert!(!v_sh_bad.is_valid(), "drained obj literal shorthand method return 1; must be Invalid: {v_sh_bad:?}");
}

#[test]
fn regression_iter27_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Cluster 1: UTF-8 multi-byte inside decorated/quoted/shorthand TS/JS methods
        (LanguageId::TypeScript, "r27_c1_utf8_umlaut_method_ok.ts",
         "class C {\n  @dec\n  \"ä\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"ä\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r27_c1_utf8_umlaut_method_bad.ts",
         "class C {\n  @dec\n  \"ä\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"ä\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r27_c1_utf8_emoji_method_ok.ts",
         "class C {\n  @dec\n  \"🦀\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"🦀\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r27_c1_utf8_emoji_method_bad.ts",
         "class C {\n  @dec\n  \"🦀\"(\n    a: number,\n",
         "class C {\n  @dec\n  \"🦀\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r27_c1_utf8_dec_arg_method_ok.ts",
         "class C {\n  @dec(\"ä\")\n  \"ä-m\"(\n    a: number,\n",
         "class C {\n  @dec(\"ä\")\n  \"ä-m\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r27_c1_utf8_obj_quoted_method_ok.ts",
         "const obj = {\n  \"ä\"(\n    a: number,\n",
         "const obj = {\n  \"ä\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r27_c1_utf8_obj_quoted_method_bad.ts",
         "const obj = {\n  \"ä\"(\n    a: number,\n",
         "const obj = {\n  \"ä\"(\n    a: number,\n    return 1;\n", false),
        // Cluster 2A: ts_multi_delim_cands ValueParen & container-accurate inner_ctx
        (LanguageId::TypeScript, "r27_c2a_call_prebroken_cmp_obj_ok.ts",
         "foo((1 + *), a<b, {\n  k: 1,\n",
         "foo((1 + *), a<b, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_prebroken_cmp_obj_bad.ts",
         "foo((1 + *), a<b, {\n  k: 1,\n",
         "foo((1 + *), a<b, {\n  k: 1,\n  readonly c: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_ret_ok.ts",
         "foo((1 + *), (a: number): MyRet => {\n  const x = 1;\n",
         "foo((1 + *), (a: number): MyRet => {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_ret_bad.ts",
         "foo((1 + *), (a: number): MyRet => {\n  const x = 1;\n",
         "foo((1 + *), (a: number): MyRet => {\n  const x = 1;\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_obj_ret_ok.ts",
         "foo((1 + *), (a: number): { x: number } => {\n  const z = 1;\n",
         "foo((1 + *), (a: number): { x: number } => {\n  const z = 1;\n  return { x: z };\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_obj_ret_bad.ts",
         "foo((1 + *), (a: number): { x: number } => {\n  const z = 1;\n",
         "foo((1 + *), (a: number): { x: number } => {\n  const z = 1;\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_union_ret_ok.ts",
         "foo((1 + *), (a: number): { x: number } | null => {\n  const z = 1;\n",
         "foo((1 + *), (a: number): { x: number } | null => {\n  const z = 1;\n  return null;\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_arrow_union_ret_bad.ts",
         "foo((1 + *), (a: number): { x: number } | null => {\n  const z = 1;\n",
         "foo((1 + *), (a: number): { x: number } | null => {\n  const z = 1;\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_obj_lt_tern_ok.ts",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_obj_lt_tern_bad.ts",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_arr_obj_lt_tern_ok.ts",
         "foo((1 + *), [{ a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), [{ a: x < y ? {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_arr_obj_lt_tern_bad.ts",
         "foo((1 + *), [{ a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), [{ a: x < y ? {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_somecall_obj_paren_ok.ts",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_somecall_obj_paren_bad.ts",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_somecall_obj_arr_paren_ok.ts",
         "someCall({ k: (1 + *), b: Array<({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: Array<({\n  x: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_somecall_obj_arr_paren_bad.ts",
         "someCall({ k: (1 + *), b: Array<({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: Array<({\n  x: 1,\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_paren_obj_paren_ok.ts",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_paren_obj_paren_bad.ts",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n  readonly bad: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_obj_paren_same_line_ok.ts",
         "foo(1 + *, { a: ({\n  k: 1,\n",
         "foo(1 + *, { a: ({\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_obj_paren_same_line_bad.ts",
         "foo(1 + *, { a: ({\n  k: 1,\n",
         "foo(1 + *, { a: ({\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c2a_call_obj_arr_same_line_ok.ts",
         "foo(1 + *, { a: [{\n  k: 1,\n",
         "foo(1 + *, { a: [{\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c2a_call_obj_arr_same_line_bad.ts",
         "foo(1 + *, { a: [{\n  k: 1,\n",
         "foo(1 + *, { a: [{\n  k: 1,\n  readonly b: number;\n", false),
        // Cluster 2B: innermost-first ordering in ts_multi_delim_cands
        (LanguageId::TypeScript, "r27_c2b_fn_param_obj_paren_obj_ok.ts",
         "function f(a: (1 + *), b: { c: ({\n  x: number;\n",
         "function f(a: (1 + *), b: { c: ({\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r27_c2b_fn_param_obj_paren_obj_bad.ts",
         "function f(a: (1 + *), b: { c: ({\n  x: number;\n",
         "function f(a: (1 + *), b: { c: ({\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r27_c2b_fn_param_obj_paren_p_ok.ts",
         "function f(x: (1 + *), a: { p: ({\n  k: string;\n",
         "function f(x: (1 + *), a: { p: ({\n  k: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r27_c2b_fn_param_obj_paren_p_bad.ts",
         "function f(x: (1 + *), a: { p: ({\n  k: string;\n",
         "function f(x: (1 + *), a: { p: ({\n  k: string;\n  ...other,\n", false),
        // Cluster 3A: conditional types inside generic constraints/defaults/args
        (LanguageId::TypeScript, "r27_c3a_gen_ext_cond_ok.ts",
         "function f<T extends A extends B ? C : {\n  a: string;\n",
         "function f<T extends A extends B ? C : {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r27_c3a_gen_ext_cond_bad.ts",
         "function f<T extends A extends B ? C : {\n  a: string;\n",
         "function f<T extends A extends B ? C : {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r27_c3a_gen_default_cond_ok.ts",
         "function f<T = A extends B ? {\n  a: string;\n",
         "function f<T = A extends B ? {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r27_c3a_gen_default_cond_bad.ts",
         "function f<T = A extends B ? {\n  a: string;\n",
         "function f<T = A extends B ? {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r27_c3a_type_arg_cond_ok.ts",
         "type X = Foo<A extends B ? {\n  a: string;\n",
         "type X = Foo<A extends B ? {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r27_c3a_type_arg_cond_bad.ts",
         "type X = Foo<A extends B ? {\n  a: string;\n",
         "type X = Foo<A extends B ? {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r27_c3a_runtime_tern_ctrl_ok.ts",
         "const x = a < b ? {\n  k: 1,\n",
         "const x = a < b ? {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c3a_runtime_tern_ctrl_bad.ts",
         "const x = a < b ? {\n  k: 1,\n",
         "const x = a < b ? {\n  k: 1,\n  readonly b: number;\n", false),
        // Cluster 3B: runtime let/const `<` expressions vs generic defaults/unions
        (LanguageId::TypeScript, "r27_c3b_let_cmp_comma_obj_ok.ts",
         "let y = x < 1, z = {\n  broken: (1 + *),\n  k: 1,\n",
         "let y = x < 1, z = {\n  broken: (1 + *),\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c3b_let_cmp_comma_obj_bad.ts",
         "let y = x < 1, z = {\n  broken: (1 + *),\n  k: 1,\n",
         "let y = x < 1, z = {\n  broken: (1 + *),\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c3b_let_pb_cmp_comma_obj_ok.ts",
         "let y = (1 + *), a = x < 1, z = {\n  k: 1,\n",
         "let y = (1 + *), a = x < 1, z = {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c3b_let_pb_cmp_comma_obj_bad.ts",
         "let y = (1 + *), a = x < 1, z = {\n  k: 1,\n",
         "let y = (1 + *), a = x < 1, z = {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c3b_const_bitor_ok.ts",
         "const r = x<y | {\n  broken: (1 + *),\n  k: 1,\n",
         "const r = x<y | {\n  broken: (1 + *),\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r27_c3b_const_bitor_bad.ts",
         "const r = x<y | {\n  broken: (1 + *),\n  k: 1,\n",
         "const r = x<y | {\n  broken: (1 + *),\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r27_c3b_const_gen_union_ok.ts",
         "const r = foo<Bar | {\n  a: string;\n",
         "const r = foo<Bar | {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r27_c3b_const_gen_union_bad.ts",
         "const r = foo<Bar | {\n  a: string;\n",
         "const r = foo<Bar | {\n  a: string;\n  ...other,\n", false),
        // Cluster 3C: comparison `<` before generic call `bar<{`
        (LanguageId::TypeScript, "r27_c3c_call_cmp_then_gen_ok.ts",
         "foo(a < b, bar<{\n  a: (1 + *);\n",
         "foo(a < b, bar<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r27_c3c_call_cmp_then_gen_bad.ts",
         "foo(a < b, bar<{\n  a: (1 + *);\n",
         "foo(a < b, bar<{\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r27_c3c_tern_cmp_then_gen_ok.ts",
         "const z = x < y ? bar<{\n  a: (1 + *);\n",
         "const z = x < y ? bar<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r27_c3c_tern_cmp_then_gen_bad.ts",
         "const z = x < y ? bar<{\n  a: (1 + *);\n",
         "const z = x < y ? bar<{\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r27_c3c_tern_else_cmp_gen_ok.ts",
         "const z = flag ? x < y : bar<{\n  a: (1 + *);\n",
         "const z = flag ? x < y : bar<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r27_c3c_and_cmp_then_gen_ok.ts",
         "const z = a < b && bar<{\n  a: (1 + *);\n",
         "const z = a < b && bar<{\n  a: (1 + *);\n  readonly b: string;\n", true),
        // Cluster 3D: user-defined type args in ValueParen
        (LanguageId::TypeScript, "r27_c3d_wrap_gen_bar_ok.ts",
         "const x = wrap(foo<Bar, {\n  a: (1 + *);\n",
         "const x = wrap(foo<Bar, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r27_c3d_wrap_gen_bar_bad.ts",
         "const x = wrap(foo<Bar, {\n  a: (1 + *);\n",
         "const x = wrap(foo<Bar, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r27_c3d_wrap_gen_mytype_ok.ts",
         "const x = wrap(foo<MyType, {\n  a: (1 + *);\n",
         "const x = wrap(foo<MyType, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r27_c3d_wrap_gen_mytype_bad.ts",
         "const x = wrap(foo<MyType, {\n  a: (1 + *);\n",
         "const x = wrap(foo<MyType, {\n  a: (1 + *);\n  ...other,\n", false),
        // Cluster 4: decorator quotes & ASI class field before quoted method
        (LanguageId::TypeScript, "r27_c4a_dec_obj_rparen_str_ok.ts",
         "class C {\n  @dec({ x: \")\" })\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec({ x: \")\" })\n  \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r27_c4a_dec_obj_rparen_str_bad.ts",
         "class C {\n  @dec({ x: \")\" })\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec({ x: \")\" })\n  \"my-method\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r27_c4a_dec_rparen_str_ok.ts",
         "class C {\n  @dec(\")\")\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec(\")\")\n  \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r27_c4a_dec_rparen_str_bad.ts",
         "class C {\n  @dec(\")\")\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  @dec(\")\")\n  \"my-method\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r27_c4b_asi_field_dec_quoted_ok.ts",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"(\n    a: number,\n    b: string,\n", true),
        (LanguageId::TypeScript, "r27_c4b_asi_field_dec_quoted_bad.ts",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"(\n    a: number,\n    return 1;\n", false),
        // Cluster 5: Rust struct/enum 2nd-item `(` & impl unclosed `<` after broken const
        (LanguageId::Rust, "r27_c5a_struct_2nd_paren_ok.rs",
         "struct Foo {\n  bad: (u32;\n  good: (i32,\n",
         "struct Foo {\n  bad: (u32;\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r27_c5a_struct_2nd_paren_bad.rs",
         "struct Foo {\n  bad: (u32;\n  good: (i32,\n",
         "struct Foo {\n  bad: (u32;\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r27_c5a_enum_2nd_paren_ok.rs",
         "enum E {\n  Bad(u32;\n  Good(i32,\n",
         "enum E {\n  Bad(u32;\n  Good(i32,\n  u64,\n", true),
        (LanguageId::Rust, "r27_c5a_enum_2nd_paren_bad.rs",
         "enum E {\n  Bad(u32;\n  Good(i32,\n",
         "enum E {\n  Bad(u32;\n  Good(i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r27_c5b_impl_broken_const_fn_gen_ok.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U: Clone,\n    V: Copy,\n", true),
        (LanguageId::Rust, "r27_c5b_impl_broken_const_fn_gen_bad.rs",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: usize = (;\n  fn f<T,\n    U: Clone,\n    let bad = ;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
    let mut pad50 = String::new();
    for p in 0..50 { pad50.push_str(&format!("const _p{p} = {p};\n")); }
    let base50 = format!("{pad50}foo((1 + *), a<b, {{\n  k: 1,\n");
    let v50_ok = fw.verify_incremental(Some(&base50), &format!("{base50}  ...other,\n"), Path::new("c50pb.ts"), LanguageId::TypeScript);
    let v50_bad = fw.verify_incremental(Some(&base50), &format!("{base50}  readonly c: number;\n"), Path::new("c50pbb.ts"), LanguageId::TypeScript);
    assert!(v50_ok.is_valid(), "50-line foo((1 + *), a<b, {{ ...other, must be Valid: {v50_ok:?}");
    assert!(!v50_bad.is_valid(), "50-line foo((1 + *), a<b, {{ readonly must be Invalid: {v50_bad:?}");
}

#[test]
fn regression_iter28_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Focus 1 / 2 (snippet_ts_gen): call/subscript <, ValueBracket < guard, comma exprs, DTO/ID/T1/"a", async/function/class <T = {
        (LanguageId::TypeScript, "r28_arr_call_lt_ok.ts",
         "const arr = [(1 + *), bar(1)<2, {\n  k: 1,\n",
         "const arr = [(1 + *), bar(1)<2, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_arr_call_lt_bad.ts",
         "const arr = [(1 + *), bar(1)<2, {\n  k: 1,\n",
         "const arr = [(1 + *), bar(1)<2, {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r28_call_call_lt_ok.ts",
         "foo((1 + *), bar(1)<MaxVal, {\n  k: 1,\n",
         "foo((1 + *), bar(1)<MaxVal, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_call_call_lt_bad.ts",
         "foo((1 + *), bar(1)<MaxVal, {\n  k: 1,\n",
         "foo((1 + *), bar(1)<MaxVal, {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r28_call_idx_lt_ok.ts",
         "foo((1 + *), arr[0]<MaxVal, {\n  k: 1,\n",
         "foo((1 + *), arr[0]<MaxVal, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_call_idx_lt_bad.ts",
         "foo((1 + *), arr[0]<MaxVal, {\n  k: 1,\n",
         "foo((1 + *), arr[0]<MaxVal, {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r28_arr_cmp_ok.ts",
         "const arr = [(1 + *), a<b, {\n  k: 1,\n",
         "const arr = [(1 + *), a<b, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_arr_cmp_bad.ts",
         "const arr = [(1 + *), a<b, {\n  k: 1,\n",
         "const arr = [(1 + *), a<b, {\n  k: 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r28_ret_cmp_comma_ok.ts",
         "function g() {\n  return a<b, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b, {\n    x: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r28_ret_cmp_comma_bad.ts",
         "function g() {\n  return a<b, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b, {\n    x: (1 + *),\n    readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_assign_cmp_comma_ok.ts",
         "function g() {\n  let x = 0;\n  x = a<b, {\n    k: (1 + *),\n",
         "function g() {\n  let x = 0;\n  x = a<b, {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r28_assign_cmp_comma_bad.ts",
         "function g() {\n  let x = 0;\n  x = a<b, {\n    k: (1 + *),\n",
         "function g() {\n  let x = 0;\n  x = a<b, {\n    k: (1 + *),\n    readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_assign_cmp_default_bad_as_obj_ok.ts",
         "let y = x<1, z = {\n  k: (1 + *),\n",
         "let y = x<1, z = {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_assign_cmp_default_bad_as_obj_bad.ts",
         "let y = x<1, z = {\n  k: (1 + *),\n",
         "let y = x<1, z = {\n  k: (1 + *),\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_wrap_dto_ok.ts",
         "const x = wrap(foo<DTO, {\n  a: (1 + *);\n",
         "const x = wrap(foo<DTO, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_wrap_dto_bad.ts",
         "const x = wrap(foo<DTO, {\n  a: (1 + *);\n",
         "const x = wrap(foo<DTO, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_wrap_id_ok.ts",
         "const x = wrap(foo<ID, {\n  a: (1 + *);\n",
         "const x = wrap(foo<ID, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_wrap_id_bad.ts",
         "const x = wrap(foo<ID, {\n  a: (1 + *);\n",
         "const x = wrap(foo<ID, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_wrap_t1_ok.ts",
         "const x = wrap(foo<T1, {\n  a: (1 + *);\n",
         "const x = wrap(foo<T1, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_wrap_t1_bad.ts",
         "const x = wrap(foo<T1, {\n  a: (1 + *);\n",
         "const x = wrap(foo<T1, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_wrap_lit_ok.ts",
         "const x = wrap(foo<\"a\", {\n  a: (1 + *);\n",
         "const x = wrap(foo<\"a\", {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_wrap_lit_bad.ts",
         "const x = wrap(foo<\"a\", {\n  a: (1 + *);\n",
         "const x = wrap(foo<\"a\", {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_cmp_max_val_pipe_ok.ts",
         "const x = (a < MAX_VAL | {\n  k: 1,\n",
         "const x = (a < MAX_VAL | {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_cmp_max_val_pipe_bad.ts",
         "const x = (a < MAX_VAL | {\n  k: 1,\n",
         "const x = (a < MAX_VAL | {\n  k: 1,\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r28_async_gen_default_ok.ts",
         "const f = async <T = {\n  a: string;\n",
         "const f = async <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r28_async_gen_default_bad.ts",
         "const f = async <T = {\n  a: string;\n",
         "const f = async <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_fn_gen_default_ok.ts",
         "const f = function<T = {\n  a: string;\n",
         "const f = function<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r28_fn_gen_default_bad.ts",
         "const f = function<T = {\n  a: string;\n",
         "const f = function<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r28_cls_gen_default_ok.ts",
         "const c = class<T = {\n  a: string;\n",
         "const c = class<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r28_cls_gen_default_bad.ts",
         "const c = class<T = {\n  a: string;\n",
         "const c = class<T = {\n  a: string;\n  return 1;\n", false),
        // Focus 1 / 2: interface/type call, ctor, quoted sigs; arrow params; inline obj/tuple types; JS/TS runtime fn/method/class; ASI quoted & modifier methods
        (LanguageId::TypeScript, "r28_iface_call_sig_ok.ts",
         "interface I {\n  (a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  (a: (1 + *), b: {\n    x: number;\n    readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_iface_call_sig_bad.ts",
         "interface I {\n  (a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  (a: (1 + *), b: {\n    x: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r28_type_call_sig_ok.ts",
         "type F = {\n  (a: (1 + *), b: {\n    x: number;\n",
         "type F = {\n  (a: (1 + *), b: {\n    x: number;\n    readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_type_call_sig_bad.ts",
         "type F = {\n  (a: (1 + *), b: {\n    x: number;\n",
         "type F = {\n  (a: (1 + *), b: {\n    x: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r28_iface_new_sig_ok.ts",
         "interface I {\n  new (a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  new (a: (1 + *), b: {\n    x: number;\n    readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_iface_new_sig_bad.ts",
         "interface I {\n  new (a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  new (a: (1 + *), b: {\n    x: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r28_iface_quoted_sig_ok.ts",
         "interface I {\n  \"my-m\"(a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  \"my-m\"(a: (1 + *), b: {\n    x: number;\n    readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_iface_quoted_sig_bad.ts",
         "interface I {\n  \"my-m\"(a: (1 + *), b: {\n    x: number;\n",
         "interface I {\n  \"my-m\"(a: (1 + *), b: {\n    x: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r28_top_arrow_param_ok.ts",
         "const fn1 = (a: (1 + *), b: {\n  x: number;\n",
         "const fn1 = (a: (1 + *), b: {\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_top_arrow_param_bad.ts",
         "const fn1 = (a: (1 + *), b: {\n  x: number;\n",
         "const fn1 = (a: (1 + *), b: {\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_exp_arrow_param_ok.ts",
         "export const fn1 = (a: (1 + *), b: {\n  x: number;\n",
         "export const fn1 = (a: (1 + *), b: {\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_exp_arrow_param_bad.ts",
         "export const fn1 = (a: (1 + *), b: {\n  x: number;\n",
         "export const fn1 = (a: (1 + *), b: {\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_async_arrow_param_ok.ts",
         "const f = async (a: (1 + *), b: {\n  x: number;\n",
         "const f = async (a: (1 + *), b: {\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_async_arrow_param_bad.ts",
         "const f = async (a: (1 + *), b: {\n  x: number;\n",
         "const f = async (a: (1 + *), b: {\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_call_arrow_inline_obj_ok.ts",
         "foo((1 + *), (a: {\n  x: number;\n",
         "foo((1 + *), (a: {\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_call_arrow_inline_obj_bad.ts",
         "foo((1 + *), (a: {\n  x: number;\n",
         "foo((1 + *), (a: {\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_call_arrow_destruct_obj_ok.ts",
         "foo((1 + *), ({ a }: {\n  x: number;\n",
         "foo((1 + *), ({ a }: {\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_call_arrow_destruct_obj_bad.ts",
         "foo((1 + *), ({ a }: {\n  x: number;\n",
         "foo((1 + *), ({ a }: {\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_call_arrow_paren_obj_ok.ts",
         "foo((1 + *), (a: ({\n  x: number;\n",
         "foo((1 + *), (a: ({\n  x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_call_arrow_paren_obj_bad.ts",
         "foo((1 + *), (a: ({\n  x: number;\n",
         "foo((1 + *), (a: ({\n  x: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_call_arrow_tuple_ok.ts",
         "foo((1 + *), (a: Array<[\n  string,\n",
         "foo((1 + *), (a: Array<[\n  string,\n  number?,\n", true),
        (LanguageId::TypeScript, "r28_call_arrow_tuple_named_ok.ts",
         "foo((1 + *), (a: Array<[\n  string,\n",
         "foo((1 + *), (a: Array<[\n  string,\n  x: number,\n", true),
        (LanguageId::TypeScript, "r28_call_arrow_tuple_bad.ts",
         "foo((1 + *), (a: Array<[\n  string,\n",
         "foo((1 + *), (a: Array<[\n  string,\n  return 1;\n", false),
        (LanguageId::TypeScript, "r28_call_obj_arrow_tuple_ok.ts",
         "foo((1 + *), { f: (a: Array<[\n  string,\n",
         "foo((1 + *), { f: (a: Array<[\n  string,\n  number?,\n", true),
        (LanguageId::TypeScript, "r28_call_obj_arrow_tuple_bad.ts",
         "foo((1 + *), { f: (a: Array<[\n  string,\n",
         "foo((1 + *), { f: (a: Array<[\n  string,\n  return 1;\n", false),
        (LanguageId::TypeScript, "r28_asi_class_quoted_multi_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-method\"(a: (1 + *), b: {\n    x: number;\n",
         "class C {\n  broken = (1 + *)\n  \"my-method\"(a: (1 + *), b: {\n    x: number;\n    readonly y: string;\n", true),
        (LanguageId::TypeScript, "r28_asi_class_quoted_multi_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-method\"(a: (1 + *), b: {\n    x: number;\n",
         "class C {\n  broken = (1 + *)\n  \"my-method\"(a: (1 + *), b: {\n    x: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r28_asi_class_static_quoted_ok.ts",
         "class C {\n  x = 1\n  @dec\n  static \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  @dec\n  static \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r28_asi_class_static_quoted_bad.ts",
         "class C {\n  x = 1\n  @dec\n  static \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  @dec\n  static \"my-method\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r28_asi_class_public_quoted_ok.ts",
         "class C {\n  x = 1\n  public \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  public \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r28_asi_class_public_quoted_bad.ts",
         "class C {\n  x = 1\n  public \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  public \"my-method\"(\n    a: number,\n    return 1;\n", false),
        (LanguageId::TypeScript, "r28_asi_class_private_quoted_ok.ts",
         "class C {\n  x = 1\n  private \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  private \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r28_asi_class_override_quoted_ok.ts",
         "class C {\n  x = 1\n  override \"my-method\"(\n    a: number,\n",
         "class C {\n  x = 1\n  override \"my-method\"(\n    a: number,\n    b?: string,\n", true),
        (LanguageId::TypeScript, "r28_asi_class_static_method_body_ok.ts",
         "class C {\n  broken = (1 + *)\n  static m() {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static m() {\n  const x = (1 + *)\n  return 1;\n", true),
        (LanguageId::TypeScript, "r28_asi_class_static_method_body_bad.ts",
         "class C {\n  broken = (1 + *)\n  static m() {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static m() {\n  const x = (1 + *)\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_asi_class_quoted_body_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(a = (1 + 2)) {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(a = (1 + 2)) {\n  const x = (1 + *)\n  return 1;\n", true),
        (LanguageId::TypeScript, "r28_asi_class_quoted_body_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(a = (1 + 2)) {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(a = (1 + 2)) {\n  const x = (1 + *)\n  readonly y: number;\n", false),
        // Same-line function(), shorthand m(), class C inside ValueParen/ValueBrace/ValueBracket (TS + JS)
        (LanguageId::JavaScript, "r28_js_call_fn_ok.js",
         "foo((1 + *), function() {\n  const x = 1;\n",
         "foo((1 + *), function() {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::JavaScript, "r28_js_call_fn_bad.js",
         "foo((1 + *), function() {\n  const x = 1;\n",
         "foo((1 + *), function() {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::JavaScript, "r28_js_obj_shorthand_ok.js",
         "const obj = { broken: (1 + *), m() {\n  const x = 1;\n",
         "const obj = { broken: (1 + *), m() {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::JavaScript, "r28_js_obj_shorthand_bad.js",
         "const obj = { broken: (1 + *), m() {\n  const x = 1;\n",
         "const obj = { broken: (1 + *), m() {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::JavaScript, "r28_js_arr_fn_ok.js",
         "const arr = [(1 + *), function() {\n  const x = 1;\n",
         "const arr = [(1 + *), function() {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::JavaScript, "r28_js_arr_fn_bad.js",
         "const arr = [(1 + *), function() {\n  const x = 1;\n",
         "const arr = [(1 + *), function() {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::JavaScript, "r28_js_call_cls_ok.js",
         "foo((1 + *), class C {\n  m() { return 1; }\n",
         "foo((1 + *), class C {\n  m() { return 1; }\n  n() { return 2; }\n", true),
        (LanguageId::JavaScript, "r28_js_call_cls_bad.js",
         "foo((1 + *), class C {\n  m() { return 1; }\n",
         "foo((1 + *), class C {\n  m() { return 1; }\n  return 2;\n", false),
        (LanguageId::TypeScript, "r28_ts_call_cls_ok.ts",
         "foo((1 + *), class C {\n  m() { return 1; }\n",
         "foo((1 + *), class C {\n  m() { return 1; }\n  n(): number { return 2; }\n", true),
        (LanguageId::TypeScript, "r28_ts_call_cls_bad.ts",
         "foo((1 + *), class C {\n  m() { return 1; }\n",
         "foo((1 + *), class C {\n  m() { return 1; }\n  return 2;\n", false),
        // Preservation controls
        (LanguageId::TypeScript, "r28_ctrl_obj_lt_tern_ok.ts",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_ctrl_obj_lt_tern_bad.ts",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n",
         "foo((1 + *), { a: x < y ? {\n  k: 1,\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_ctrl_call_obj_paren_obj_ok.ts",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_ctrl_call_obj_paren_obj_bad.ts",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n",
         "someCall({ k: (1 + *), b: ({\n  x: 1,\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_ctrl_assign_paren_obj_ok.ts",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r28_ctrl_assign_paren_obj_bad.ts",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n",
         "const x = ({ k: (1 + *), b: ({\n  x: 1,\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_ctrl_call_arrow_ret_ok.ts",
         "foo((1 + *), (a: MyType): MyRet => {\n  const x = 1;\n",
         "foo((1 + *), (a: MyType): MyRet => {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r28_ctrl_call_arrow_ret_bad.ts",
         "foo((1 + *), (a: MyType): MyRet => {\n  const x = 1;\n",
         "foo((1 + *), (a: MyType): MyRet => {\n  const x = 1;\n  readonly y: number;\n", false),
        (LanguageId::TypeScript, "r28_ctrl_obj_array_paren_ok.ts",
         "const obj = { k: (1 + *), b: Array<(\n  1 + 2\n",
         "const obj = { k: (1 + *), b: Array<(\n  1 + 2\n  ) < 5,\n", true),
        (LanguageId::TypeScript, "r28_ctrl_arr_generic_ok.ts",
         "const arr = [foo<Bar, {\n  a: number;\n",
         "const arr = [foo<Bar, {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_ctrl_arr_generic_bad.ts",
         "const arr = [foo<Bar, {\n  a: number;\n",
         "const arr = [foo<Bar, {\n  a: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r28_ctrl_arr_cmp_then_generic_ok.ts",
         "const arr = [a<b, bar<{\n  a: number;\n",
         "const arr = [a<b, bar<{\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r28_ctrl_arr_cmp_then_generic_bad.ts",
         "const arr = [a<b, bar<{\n  a: number;\n",
         "const arr = [a<b, bar<{\n  a: number;\n  ...other,\n", false),
        // Focus 3 (Rust): broken [ across ; in struct/impl, open_after.len() > 1 + fn f<T,, valid [T;\n N] preservation guards
        (LanguageId::Rust, "r28_rs_struct_broken_bracket_ok.rs",
         "struct Foo {\n  bad: [u32;\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r28_rs_struct_broken_bracket_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_struct_broken_bracket_paren_ok.rs",
         "struct Foo {\n  bad: [u32; (\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; (\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r28_rs_struct_broken_bracket_paren_bad.rs",
         "struct Foo {\n  bad: [u32; (\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; (\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_struct_multi_broken_ok.rs",
         "struct S {\n  bad: (u32;\n  bad2: [i32;\n  good: (u64,\n",
         "struct S {\n  bad: (u32;\n  bad2: [i32;\n  good: (u64,\n  u32,\n", true),
        (LanguageId::Rust, "r28_rs_struct_multi_broken_bad.rs",
         "struct S {\n  bad: (u32;\n  bad2: [i32;\n  good: (u64,\n",
         "struct S {\n  bad: (u32;\n  bad2: [i32;\n  good: (u64,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_fn_gen_ok.rs",
         "impl Foo {\n  const BAD: [u32 = 1;\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32 = 1;\n  fn f<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_fn_gen_bad.rs",
         "impl Foo {\n  const BAD: [u32 = 1;\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32 = 1;\n  fn f<T,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_lit_fn_gen_ok.rs",
         "impl Foo {\n  const BAD: [u32; 4] = [1;\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32; 4] = [1;\n  fn f<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_lit_fn_gen_bad.rs",
         "impl Foo {\n  const BAD: [u32; 4] = [1;\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32; 4] = [1;\n  fn f<T,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_const_ok.rs",
         "impl Foo {\n  const BAD: [u32 = 1;\n  const GOOD: i32 = (\n    1 +\n",
         "impl Foo {\n  const BAD: [u32 = 1;\n  const GOOD: i32 = (\n    1 +\n    2\n", true),
        (LanguageId::Rust, "r28_rs_impl_broken_arr_const_bad.rs",
         "impl Foo {\n  const BAD: [u32 = 1;\n  const GOOD: i32 = (\n    1 +\n",
         "impl Foo {\n  const BAD: [u32 = 1;\n  const GOOD: i32 = (\n    1 +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_arr_broken_paren_semi_fn_ok.rs",
         "impl Foo {\n  const BAD: [u32; (1; 2;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: [u32; (1; 2;\n  fn f<T,\n    U: Clone,\n    V: Copy,\n", true),
        (LanguageId::Rust, "r28_rs_impl_arr_broken_paren_semi_fn_bad.rs",
         "impl Foo {\n  const BAD: [u32; (1; 2;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: [u32; (1; 2;\n  fn f<T,\n    U: Clone,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_const_2paren_semi_fn_ok.rs",
         "impl Foo {\n  const BAD: (usize = (1;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: (usize = (1;\n  fn f<T,\n    U: Clone,\n    V: Copy,\n", true),
        (LanguageId::Rust, "r28_rs_impl_const_2paren_semi_fn_bad.rs",
         "impl Foo {\n  const BAD: (usize = (1;\n  fn f<T,\n    U: Clone,\n",
         "impl Foo {\n  const BAD: (usize = (1;\n  fn f<T,\n    U: Clone,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_two_broken_const_ok.rs",
         "impl S {\n  const A: [u8; 2] = [1;\n  const B: usize = (;\n  fn g<T,\n    U: Clone,\n",
         "impl S {\n  const A: [u8; 2] = [1;\n  const B: usize = (;\n  fn g<T,\n    U: Clone,\n    V: Copy,\n", true),
        (LanguageId::Rust, "r28_rs_impl_two_broken_const_bad.rs",
         "impl S {\n  const A: [u8; 2] = [1;\n  const B: usize = (;\n  fn g<T,\n    U: Clone,\n",
         "impl S {\n  const A: [u8; 2] = [1;\n  const B: usize = (;\n  fn g<T,\n    U: Clone,\n    let bad = ;\n", false),
        // Valid Rust multi-line array [T;\n N] preservation guards
        (LanguageId::Rust, "r28_rs_struct_ml_arr_ok.rs",
         "struct S {\n  arr: [u8;\n",
         "struct S {\n  arr: [u8;\n  4],\n", true),
        (LanguageId::Rust, "r28_rs_struct_ml_arr_bad.rs",
         "struct S {\n  arr: [u8;\n",
         "struct S {\n  arr: [u8;\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_struct_ml_arr_close_ok.rs",
         "struct S {\n  arr: [u8;\n  4\n",
         "struct S {\n  arr: [u8;\n  4\n  ],\n", true),
        (LanguageId::Rust, "r28_rs_struct_ml_arr_close_bad.rs",
         "struct S {\n  arr: [u8;\n  4\n",
         "struct S {\n  arr: [u8;\n  4\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_ml_const_arr_ok.rs",
         "impl Foo {\n  const X: [u8;\n",
         "impl Foo {\n  const X: [u8;\n  4] = [0; 4];\n", true),
        (LanguageId::Rust, "r28_rs_impl_ml_const_arr_bad.rs",
         "impl Foo {\n  const X: [u8;\n",
         "impl Foo {\n  const X: [u8;\n  let bad = ;\n", false),
        (LanguageId::Rust, "r28_rs_impl_ml_const_arr_lit_ok.rs",
         "impl Foo {\n  const X: [u8; 4] = [0;\n",
         "impl Foo {\n  const X: [u8; 4] = [0;\n  4];\n", true),
        (LanguageId::Rust, "r28_rs_impl_ml_const_arr_lit_bad.rs",
         "impl Foo {\n  const X: [u8; 4] = [0;\n",
         "impl Foo {\n  const X: [u8; 4] = [0;\n  let bad = ;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
    let mut pad50 = String::new();
    for p in 0..50 { pad50.push_str(&format!("const _p{p} = {p};\n")); }
    let base50 = format!("{pad50}const arr = [a<b, {{\n  k: 1,\n");
    let v50_ok = fw.verify_incremental(Some(&base50), &format!("{base50}  ...other,\n"), Path::new("r28_50_arr_ok.ts"), LanguageId::TypeScript);
    let v50_bad = fw.verify_incremental(Some(&base50), &format!("{base50}  readonly b: number;\n"), Path::new("r28_50_arr_bad.ts"), LanguageId::TypeScript);
    assert!(v50_ok.is_valid(), "50-line const arr = [a<b, {{ ...other, must be Valid: {v50_ok:?}");
    assert!(!v50_bad.is_valid(), "50-line const arr = [a<b, {{ readonly must be Invalid: {v50_bad:?}");
}

#[test]
fn regression_iter29_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Cluster 1: export default <T = {, ASI newlines before <T = {, expr/arrow/obj/ternary/post-cmp <T = {
        (LanguageId::TypeScript, "r29_exp_def_gen_ok.ts",
         "export default <T = {\n  a: string;\n",
         "export default <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_exp_def_gen_bad.ts",
         "export default <T = {\n  a: string;\n",
         "export default <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_exp_def_async_gen_ok.ts",
         "export default async <T = {\n  a: string;\n",
         "export default async <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_exp_def_async_gen_bad.ts",
         "export default async <T = {\n  a: string;\n",
         "export default async <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_exp_def_fn_gen_ok.ts",
         "export default function<T = {\n  a: string;\n",
         "export default function<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_exp_def_fn_gen_bad.ts",
         "export default function<T = {\n  a: string;\n",
         "export default function<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r29_exp_def_cls_gen_ok.ts",
         "export default class<T = {\n  a: string;\n",
         "export default class<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_exp_def_cls_gen_bad.ts",
         "export default class<T = {\n  a: string;\n",
         "export default class<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_fn_gen_ok.ts",
         "namespace N {\n  const f = 1\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  function g<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_fn_gen_bad.ts",
         "namespace N {\n  const f = 1\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  function g<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_cmp_fn_gen_ok.ts",
         "namespace N {\n  let x = a < b\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  let x = a < b\n  function g<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_cmp_fn_gen_bad.ts",
         "namespace N {\n  let x = a < b\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  let x = a < b\n  function g<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_colon_fn_gen_ok.ts",
         "namespace N {\n  const f: number = 1\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  const f: number = 1\n  function g<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_colon_fn_gen_bad.ts",
         "namespace N {\n  const f: number = 1\n  function g<T = {\n    a: number;\n",
         "namespace N {\n  const f: number = 1\n  function g<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_export_fn_gen_ok.ts",
         "namespace N {\n  const f = 1\n  export function g<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  export function g<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_export_fn_gen_bad.ts",
         "namespace N {\n  const f = 1\n  export function g<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  export function g<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_cls_gen_ok.ts",
         "namespace N {\n  const f = 1\n  class C<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  class C<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_cls_gen_bad.ts",
         "namespace N {\n  const f = 1\n  class C<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  class C<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_iface_gen_ok.ts",
         "namespace N {\n  const f = 1\n  interface I<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  interface I<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_iface_gen_bad.ts",
         "namespace N {\n  const f = 1\n  interface I<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  interface I<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_asi_type_gen_ok.ts",
         "namespace N {\n  const f = 1\n  type Foo<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  type Foo<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_asi_type_gen_bad.ts",
         "namespace N {\n  const f = 1\n  type Foo<T = {\n    a: number;\n",
         "namespace N {\n  const f = 1\n  type Foo<T = {\n    a: number;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_m_gen_ok.ts",
         "class C {\n  a = 1\n  m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  m<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_m_gen_bad.ts",
         "class C {\n  a = 1\n  m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  m<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_broken_m_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number;\n",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_broken_m_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number;\n",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_static_m_gen_ok.ts",
         "class C {\n  x = 1\n  static m<T = {\n    a: number;\n",
         "class C {\n  x = 1\n  static m<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_static_m_gen_bad.ts",
         "class C {\n  x = 1\n  static m<T = {\n    a: number;\n",
         "class C {\n  x = 1\n  static m<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_async_m_gen_ok.ts",
         "class C {\n  a = 1\n  async m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  async m<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_async_m_gen_bad.ts",
         "class C {\n  a = 1\n  async m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  async m<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_ret_fn_gen_ok.ts",
         "function g() {\n  return function<T = {\n    a: string;\n",
         "function g() {\n  return function<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_ret_fn_gen_bad.ts",
         "function g() {\n  return function<T = {\n    a: string;\n",
         "function g() {\n  return function<T = {\n    a: string;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_ret_async_fn_gen_ok.ts",
         "function g() {\n  return async function<T = {\n    a: string;\n",
         "function g() {\n  return async function<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_ret_async_fn_gen_bad.ts",
         "function g() {\n  return async function<T = {\n    a: string;\n",
         "function g() {\n  return async function<T = {\n    a: string;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r29_tern_fn_gen_ok.ts",
         "const f = cond ? function<T = {\n  a: string;\n",
         "const f = cond ? function<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_tern_fn_gen_bad.ts",
         "const f = cond ? function<T = {\n  a: string;\n",
         "const f = cond ? function<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r29_tern_anon_gen_ok.ts",
         "const y = cond ? <T = {\n  a: string;\n",
         "const y = cond ? <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_tern_anon_gen_bad.ts",
         "const y = cond ? <T = {\n  a: string;\n",
         "const y = cond ? <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_arrow_gen_ok.ts",
         "const f = () => <T = {\n  a: string;\n",
         "const f = () => <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_arrow_gen_bad.ts",
         "const f = () => <T = {\n  a: string;\n",
         "const f = () => <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_typed_arrow_gen_ok.ts",
         "const f = (x: number) => <T = {\n  a: string;\n",
         "const f = (x: number) => <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_typed_arrow_gen_bad.ts",
         "const f = (x: number) => <T = {\n  a: string;\n",
         "const f = (x: number) => <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_typed_arrow_async_gen_ok.ts",
         "const f = (x: number) => async <T = {\n  a: string;\n",
         "const f = (x: number) => async <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_typed_arrow_async_gen_bad.ts",
         "const f = (x: number) => async <T = {\n  a: string;\n",
         "const f = (x: number) => async <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_obj_prop_gen_ok.ts",
         "const obj = {\n  m: <T = {\n    a: string;\n",
         "const obj = {\n  m: <T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_obj_prop_gen_bad.ts",
         "const obj = {\n  m: <T = {\n    a: string;\n",
         "const obj = {\n  m: <T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_obj_prop_async_gen_ok.ts",
         "const obj = {\n  m: async <T = {\n    a: string;\n",
         "const obj = {\n  m: async <T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r29_obj_prop_async_gen_bad.ts",
         "const obj = {\n  m: async <T = {\n    a: string;\n",
         "const obj = {\n  m: async <T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r29_ret_cmp_fn_gen_ok.ts",
         "function g() {\n  return a<b, function<T = {\n    x: string;\n",
         "function g() {\n  return a<b, function<T = {\n    x: string;\n    readonly y: number;\n", true),
        (LanguageId::TypeScript, "r29_ret_cmp_fn_gen_bad.ts",
         "function g() {\n  return a<b, function<T = {\n    x: string;\n",
         "function g() {\n  return a<b, function<T = {\n    x: string;\n    return 1;\n", false),
        // Cluster 2: string/keyword/numeric/uppercase-underscore type args vs comparisons + sibling comma comparisons
        (LanguageId::TypeScript, "r29_ret_str_cmp_ok.ts",
         "function g() {\n  return a<\"x\", {\n    k: (1 + *),\n",
         "function g() {\n  return a<\"x\", {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r29_ret_str_cmp_bad.ts",
         "function g() {\n  return a<\"x\", {\n    k: (1 + *),\n",
         "function g() {\n  return a<\"x\", {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_assign_str_cmp_ok.ts",
         "function g() {\n  let x = 0;\n  x = a<\"x\", {\n    k: (1 + *),\n",
         "function g() {\n  let x = 0;\n  x = a<\"x\", {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r29_assign_str_cmp_bad.ts",
         "function g() {\n  let x = 0;\n  x = a<\"x\", {\n    k: (1 + *),\n",
         "function g() {\n  let x = 0;\n  x = a<\"x\", {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_arr_str_cmp_ok.ts",
         "const arr = [(1 + *), a<\"x\", {\n  k: 1,\n",
         "const arr = [(1 + *), a<\"x\", {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r29_arr_str_cmp_bad.ts",
         "const arr = [(1 + *), a<\"x\", {\n  k: 1,\n",
         "const arr = [(1 + *), a<\"x\", {\n  k: 1,\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_call_str_cmp_ok.ts",
         "foo((1 + *), a<\"x\", {\n  k: 1,\n",
         "foo((1 + *), a<\"x\", {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r29_call_str_cmp_bad.ts",
         "foo((1 + *), a<\"x\", {\n  k: 1,\n",
         "foo((1 + *), a<\"x\", {\n  k: 1,\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_wrap_lit_b_ok.ts",
         "const x = wrap(foo<\"a\", b, {\n  a: (1 + *);\n",
         "const x = wrap(foo<\"a\", b, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_lit_b_bad.ts",
         "const x = wrap(foo<\"a\", b, {\n  a: (1 + *);\n",
         "const x = wrap(foo<\"a\", b, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_wrap_my_type_ok.ts",
         "const x = wrap(foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(foo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_my_type_bad.ts",
         "const x = wrap(foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(foo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_arr_my_type_ok.ts",
         "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_arr_my_type_bad.ts",
         "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_wrap_abc_ok.ts",
         "const x = wrap(foo<A_B_C, {\n  a: (1 + *);\n",
         "const x = wrap(foo<A_B_C, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_abc_bad.ts",
         "const x = wrap(foo<A_B_C, {\n  a: (1 + *);\n",
         "const x = wrap(foo<A_B_C, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_wrap_true_ok.ts",
         "const x = wrap(foo<true, {\n  a: (1 + *);\n",
         "const x = wrap(foo<true, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_true_bad.ts",
         "const x = wrap(foo<true, {\n  a: (1 + *);\n",
         "const x = wrap(foo<true, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_wrap_this_ok.ts",
         "class C {\n  m() {\n    return wrap(foo<this, {\n      a: (1 + *);\n",
         "class C {\n  m() {\n    return wrap(foo<this, {\n      a: (1 + *);\n      readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_this_bad.ts",
         "class C {\n  m() {\n    return wrap(foo<this, {\n      a: (1 + *);\n",
         "class C {\n  m() {\n    return wrap(foo<this, {\n      a: (1 + *);\n      ...other,\n", false),
        (LanguageId::TypeScript, "r29_wrap_1_ok.ts",
         "const x = wrap(foo<1, {\n  a: (1 + *);\n",
         "const x = wrap(foo<1, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r29_wrap_1_bad.ts",
         "const x = wrap(foo<1, {\n  a: (1 + *);\n",
         "const x = wrap(foo<1, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_foo_space_max_val_ok.ts",
         "foo(a < MAX_VAL, {\n  k: 1,\n",
         "foo(a < MAX_VAL, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r29_foo_space_max_val_bad.ts",
         "foo(a < MAX_VAL, {\n  k: 1,\n",
         "foo(a < MAX_VAL, {\n  k: 1,\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_arr_limit_cmp_ok.ts",
         "const arr = [(1 + *), a<LIMIT, {\n  k: 1,\n",
         "const arr = [(1 + *), a<LIMIT, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r29_arr_limit_cmp_bad.ts",
         "const arr = [(1 + *), a<LIMIT, {\n  k: 1,\n",
         "const arr = [(1 + *), a<LIMIT, {\n  k: 1,\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r29_ret_two_cmp_ok.ts",
         "function g() {\n  return a<b, c<d, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b, c<d, {\n    x: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r29_ret_two_cmp_bad.ts",
         "function g() {\n  return a<b, c<d, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b, c<d, {\n    x: (1 + *),\n    readonly y: number;\n", false),
        // Cluster 3: multi-line ASI class methods, static {} blocks, multi-line generic quoted method
        (LanguageId::TypeScript, "r29_cls_asi_ml_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_ml_static_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  static m(\n    a: number,\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  static m(\n    a: number,\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_static_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  static m(\n    a: number,\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  static m(\n    a: number,\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_ml_pub_ret_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  public m(\n    a: number,\n    b: string\n  ): number {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  public m(\n    a: number,\n    b: string\n  ): number {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_pub_ret_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  public m(\n    a: number,\n    b: string\n  ): number {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  public m(\n    a: number,\n    b: string\n  ): number {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_ml_dec_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_dec_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_ml_quoted_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number,\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number,\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_quoted_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number,\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number,\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_ml_static_quoted_ok.ts",
         "class C {\n  broken = (1 + *)\n  static \"my-m\"(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  static \"my-m\"(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_ml_static_quoted_bad.ts",
         "class C {\n  broken = (1 + *)\n  static \"my-m\"(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  static \"my-m\"(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_expr_asi_ml_m_ok.ts",
         "const C = class {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "const C = class {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_cls_expr_asi_ml_m_bad.ts",
         "const C = class {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "const C = class {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_call_cls_asi_ml_m_ok.ts",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r29_call_cls_asi_ml_m_bad.ts",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::JavaScript, "r29_js_cls_asi_ml_m_ok.js",
         "class C {\n  broken = (1 + *)\n  m(\n    a,\n    b\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(\n    a,\n    b\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::JavaScript, "r29_js_cls_asi_ml_m_bad.js",
         "class C {\n  broken = (1 + *)\n  m(\n    a,\n    b\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(\n    a,\n    b\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_ts_cls_asi_static_blk_ok.ts",
         "class C {\n  broken = (1 + *)\n  static {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static {\n  const x = (1 + *)\n  const y = 2;\n", true),
        (LanguageId::TypeScript, "r29_ts_cls_asi_static_blk_ret_bad.ts",
         "class C {\n  broken = (1 + *)\n  static {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static {\n  const x = (1 + *)\n  ...other,\n", false),
        (LanguageId::TypeScript, "r29_cls_asi_dec_quoted_ml_gen_ok.ts",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"<\n    T\n  >(\n    a: (1 + *),\n",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"<\n    T\n  >(\n    a: (1 + *),\n    b?: T,\n", true),
        (LanguageId::TypeScript, "r29_cls_asi_dec_quoted_ml_gen_bad.ts",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"<\n    T\n  >(\n    a: (1 + *),\n",
         "class C {\n  x = 1\n  @dec\n  \"my-method\"<\n    T\n  >(\n    a: (1 + *),\n    let bad = ;\n", false),
        // Cluster 4 & Auditor Low C3/C4: Rust comments/docs/attrs after ;, trait type B: (Clone +, impl broken [ / fn open
        (LanguageId::Rust, "r29_rs_struct_cmt_after_semi_ok.rs",
         "struct Foo {\n  bad: [u32;\n  // comment\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  // comment\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r29_rs_struct_cmt_after_semi_bad.rs",
         "struct Foo {\n  bad: [u32;\n  // comment\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  // comment\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_struct_doc_after_semi_ok.rs",
         "struct Foo {\n  bad: [u32;\n  /// doc\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /// doc\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r29_rs_struct_doc_after_semi_bad.rs",
         "struct Foo {\n  bad: [u32;\n  /// doc\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /// doc\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_struct_attr_after_semi_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r29_rs_struct_attr_after_semi_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_struct_attr_vec_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n  >,\n}\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n    u64,\n  >,\n}\n", true),
        (LanguageId::Rust, "r29_rs_struct_attr_vec_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n  >,\n}\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n  let bad = ;\n  >,\n}\n", false),
        (LanguageId::Rust, "r29_rs_struct_ml_arr_cmt_bad.rs",
         "struct S {\n  arr: [u8;\n\n  // comment\n}\n",
         "struct S {\n  arr: [u8;\n\n  // comment\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "r29_rs_trait_paren_clone_plus_ok.rs",
         "trait Tr {\n  type B: (\n    Clone +\n",
         "trait Tr {\n  type B: (\n    Clone +\n    Send +\n", true),
        (LanguageId::Rust, "r29_rs_trait_paren_clone_plus_bad.rs",
         "trait Tr {\n  type B: (\n    Clone +\n",
         "trait Tr {\n  type B: (\n    Clone +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_trait_broken_then_clone_plus_ok.rs",
         "trait Tr {\n  type A = Vec<;\n  type B: (\n    Clone +\n",
         "trait Tr {\n  type A = Vec<;\n  type B: (\n    Clone +\n    Send +\n", true),
        (LanguageId::Rust, "r29_rs_trait_broken_then_clone_plus_bad.rs",
         "trait Tr {\n  type A = Vec<;\n  type B: (\n    Clone +\n",
         "trait Tr {\n  type A = Vec<;\n  type B: (\n    Clone +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_impl_no_semi_arr_fn_ok.rs",
         "impl Foo {\n  const BAD: [u32 = 1\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32 = 1\n  fn f<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r29_rs_impl_no_semi_arr_fn_bad.rs",
         "impl Foo {\n  const BAD: [u32 = 1\n  fn f<T,\n",
         "impl Foo {\n  const BAD: [u32 = 1\n  fn f<T,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r29_rs_impl_two_fn_open_ok.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T,\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r29_rs_impl_two_fn_open_bad.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T,\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T,\n  let bad = ;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
}
#[test]
fn regression_iter30_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Group A: Unwrapped Iter 28/29 firewall.rs pre-r5 EOF shapes (13 pairs + 3 negative controls)
        (LanguageId::TypeScript, "r30_bare_asi_fn_gen_ok.ts",
         "const f = 1\nfunction g<T = {\n  a: number;\n",
         "const f = 1\nfunction g<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_fn_gen_bad.ts",
         "const f = 1\nfunction g<T = {\n  a: number;\n",
         "const f = 1\nfunction g<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_cmp_fn_gen_ok.ts",
         "let x = a < b\nfunction g<T = {\n  a: number;\n",
         "let x = a < b\nfunction g<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_cmp_fn_gen_bad.ts",
         "let x = a < b\nfunction g<T = {\n  a: number;\n",
         "let x = a < b\nfunction g<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_colon_fn_gen_ok.ts",
         "const f: number = 1\nfunction g<T = {\n  a: number;\n",
         "const f: number = 1\nfunction g<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_colon_fn_gen_bad.ts",
         "const f: number = 1\nfunction g<T = {\n  a: number;\n",
         "const f: number = 1\nfunction g<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_export_fn_gen_ok.ts",
         "const f = 1\nexport function g<T = {\n  a: number;\n",
         "const f = 1\nexport function g<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_export_fn_gen_bad.ts",
         "const f = 1\nexport function g<T = {\n  a: number;\n",
         "const f = 1\nexport function g<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_cls_gen_ok.ts",
         "const f = 1\nclass C<T = {\n  a: number;\n",
         "const f = 1\nclass C<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_cls_gen_bad.ts",
         "const f = 1\nclass C<T = {\n  a: number;\n",
         "const f = 1\nclass C<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_iface_gen_ok.ts",
         "const f = 1\ninterface I<T = {\n  a: number;\n",
         "const f = 1\ninterface I<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_iface_gen_bad.ts",
         "const f = 1\ninterface I<T = {\n  a: number;\n",
         "const f = 1\ninterface I<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_type_gen_ok.ts",
         "const f = 1\ntype Foo<T = {\n  a: number;\n",
         "const f = 1\ntype Foo<T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_type_gen_bad.ts",
         "const f = 1\ntype Foo<T = {\n  a: number;\n",
         "const f = 1\ntype Foo<T = {\n  a: number;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_exp_def_fn_gen_ok.ts",
         "const f = 1\nexport default function<T = {\n  a: string;\n",
         "const f = 1\nexport default function<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_exp_def_fn_gen_bad.ts",
         "const f = 1\nexport default function<T = {\n  a: string;\n",
         "const f = 1\nexport default function<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_bare_asi_exp_def_gen_ok.ts",
         "const f = 1\nexport default <T = {\n  a: string;\n",
         "const f = 1\nexport default <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_bare_asi_exp_def_gen_bad.ts",
         "const f = 1\nexport default <T = {\n  a: string;\n",
         "const f = 1\nexport default <T = {\n  a: string;\n  ...other,\n", false),
        (LanguageId::Rust, "r30_eof_rs_struct_attr_vec_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    u64,\n", true),
        (LanguageId::Rust, "r30_eof_rs_struct_attr_vec_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    let bad = ;\n", false),
        (LanguageId::Rust, "r30_eof_rs_struct_attr_vec_i32_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n    u64,\n", true),
        (LanguageId::Rust, "r30_eof_rs_struct_attr_vec_i32_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    i32,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r30_eof_rs_struct_ml_arr_cmt_ok.rs",
         "struct S {\n  arr: [u8;\n\n  // comment\n",
         "struct S {\n  arr: [u8;\n\n  // comment\n  4],\n", true),
        (LanguageId::Rust, "r30_eof_rs_struct_ml_arr_cmt_bad.rs",
         "struct S {\n  arr: [u8;\n\n  // comment\n",
         "struct S {\n  arr: [u8;\n\n  // comment\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_eof_rs_struct_ml_arr_blank_ok.rs",
         "struct S {\n  arr: [u8;\n\n",
         "struct S {\n  arr: [u8;\n\n  4],\n", true),
        (LanguageId::Rust, "r30_eof_rs_struct_ml_arr_blank_bad.rs",
         "struct S {\n  arr: [u8;\n\n",
         "struct S {\n  arr: [u8;\n\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_neg_eof_unclosed_call_bad.rs",
         "fn broken() { let z = (; }\nfn f() {\n  let x = 1;\n",
         "fn broken() { let z = (; }\nfn f() {\n  let x = 1;\n  foo(\n", false),
        (LanguageId::Rust, "r30_neg_eof_broken_cmt_bad.rs",
         "fn broken() { let z = (; }\n// cmt\n",
         "fn broken() { let z = (; }\n// cmt\n  let bad = ;\n", false),
        (LanguageId::TypeScript, "r30_neg_eof_upward_shift_bad.ts",
         "const ok = 1;\nconst broken = (\n",
         "const ok = 1;\nconst broken = (\n  let x = 1;\n", false),

        // Group B: TS Generic Defaults <T = {, default/case, throw/yield/await, Object Shorthand
        (LanguageId::TypeScript, "r30_obj_default_prop_gen_ok.ts",
         "const obj = {\n  default: <T = {\n    a: string;\n",
         "const obj = {\n  default: <T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_default_prop_gen_bad.ts",
         "const obj = {\n  default: <T = {\n    a: string;\n",
         "const obj = {\n  default: <T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_obj_default_fn_gen_ok.ts",
         "const obj = {\n  default: function<T = {\n    a: string;\n",
         "const obj = {\n  default: function<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_default_fn_gen_bad.ts",
         "const obj = {\n  default: function<T = {\n    a: string;\n",
         "const obj = {\n  default: function<T = {\n    a: string;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r30_obj_case_prop_gen_ok.ts",
         "const obj = {\n  case: <T = {\n    a: string;\n",
         "const obj = {\n  case: <T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_case_prop_gen_bad.ts",
         "const obj = {\n  case: <T = {\n    a: string;\n",
         "const obj = {\n  case: <T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_default_gen_ok.ts",
         "class C {\n  default<T = {\n    a: string;\n",
         "class C {\n  default<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_cls_default_gen_bad.ts",
         "class C {\n  default<T = {\n    a: string;\n",
         "class C {\n  default<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_case_gen_ok.ts",
         "class C {\n  case<T = {\n    a: string;\n",
         "class C {\n  case<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_cls_case_gen_bad.ts",
         "class C {\n  case<T = {\n    a: string;\n",
         "class C {\n  case<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_switch_case_fn_gen_ok.ts",
         "switch (x) {\n  case 1:\n    function g<T = {\n      a: string;\n",
         "switch (x) {\n  case 1:\n    function g<T = {\n      a: string;\n      readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_switch_case_fn_gen_bad.ts",
         "switch (x) {\n  case 1:\n    function g<T = {\n      a: string;\n",
         "switch (x) {\n  case 1:\n    function g<T = {\n      a: string;\n      return 1;\n", false),
        (LanguageId::TypeScript, "r30_switch_default_fn_gen_ok.ts",
         "switch (x) {\n  default:\n    function g<T = {\n      a: string;\n",
         "switch (x) {\n  default:\n    function g<T = {\n      a: string;\n      readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_switch_default_fn_gen_bad.ts",
         "switch (x) {\n  default:\n    function g<T = {\n      a: string;\n",
         "switch (x) {\n  default:\n    function g<T = {\n      a: string;\n      return 1;\n", false),
        (LanguageId::TypeScript, "r30_switch_default_const_gen_ok.ts",
         "switch (x) {\n  default:\n    const f = <T = {\n      a: string;\n",
         "switch (x) {\n  default:\n    const f = <T = {\n      a: string;\n      readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_switch_default_const_gen_bad.ts",
         "switch (x) {\n  default:\n    const f = <T = {\n      a: string;\n",
         "switch (x) {\n  default:\n    const f = <T = {\n      a: string;\n      ...other,\n", false),
        (LanguageId::TypeScript, "r30_switch_case_const_gen_ok.ts",
         "switch (x) {\n  case 1: const f = <T = {\n    a: string;\n",
         "switch (x) {\n  case 1: const f = <T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_switch_case_const_gen_bad.ts",
         "switch (x) {\n  case 1: const f = <T = {\n    a: string;\n",
         "switch (x) {\n  case 1: const f = <T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_switch_neg_default_broken_obj_ok.ts",
         "switch (x) {\n  default: const y = (1 + *), z = {\n    k: (1 + *),\n",
         "switch (x) {\n  default: const y = (1 + *), z = {\n    k: (1 + *),\n    a: 1,\n", true),
        (LanguageId::TypeScript, "r30_switch_neg_default_broken_obj_bad.ts",
         "switch (x) {\n  default: const y = (1 + *), z = {\n    k: (1 + *),\n",
         "switch (x) {\n  default: const y = (1 + *), z = {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_switch_neg_case_blk_ok.ts",
         "switch (x) {\n  case 1: {\n    const y = 1;\n",
         "switch (x) {\n  case 1: {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r30_switch_neg_case_blk_bad.ts",
         "switch (x) {\n  case 1: {\n    const y = 1;\n",
         "switch (x) {\n  case 1: {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_switch_neg_default_blk_ok.ts",
         "switch (x) {\n  default: {\n    const y = 1;\n",
         "switch (x) {\n  default: {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r30_switch_neg_default_blk_bad.ts",
         "switch (x) {\n  default: {\n    const y = 1;\n",
         "switch (x) {\n  default: {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_asi_throw_fn_gen_ok.ts",
         "const f = 1\nthrow function<T = {\n  a: string;\n",
         "const f = 1\nthrow function<T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_asi_throw_fn_gen_bad.ts",
         "const f = 1\nthrow function<T = {\n  a: string;\n",
         "const f = 1\nthrow function<T = {\n  a: string;\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_asi_yield_fn_gen_ok.ts",
         "function* g() {\n  const f = 1\n  yield function<T = {\n    a: string;\n",
         "function* g() {\n  const f = 1\n  yield function<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_asi_yield_fn_gen_bad.ts",
         "function* g() {\n  const f = 1\n  yield function<T = {\n    a: string;\n",
         "function* g() {\n  const f = 1\n  yield function<T = {\n    a: string;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r30_asi_await_async_fn_gen_ok.ts",
         "async function g() {\n  const f = 1\n  await async function<T = {\n    a: string;\n",
         "async function g() {\n  const f = 1\n  await async function<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_asi_await_async_fn_gen_bad.ts",
         "async function g() {\n  const f = 1\n  await async function<T = {\n    a: string;\n",
         "async function g() {\n  const f = 1\n  await async function<T = {\n    a: string;\n    return 1;\n", false),
        (LanguageId::TypeScript, "r30_obj_shorthand_m_gen_ok.ts",
         "const obj = {\n  m<T = {\n    a: string;\n",
         "const obj = {\n  m<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_shorthand_m_gen_bad.ts",
         "const obj = {\n  m<T = {\n    a: string;\n",
         "const obj = {\n  m<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_obj_async_m_gen_ok.ts",
         "const obj = {\n  async m<T = {\n    a: string;\n",
         "const obj = {\n  async m<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_async_m_gen_bad.ts",
         "const obj = {\n  async m<T = {\n    a: string;\n",
         "const obj = {\n  async m<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_obj_star_gen_ok.ts",
         "const obj = {\n  *gen<T = {\n    a: string;\n",
         "const obj = {\n  *gen<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_star_gen_bad.ts",
         "const obj = {\n  *gen<T = {\n    a: string;\n",
         "const obj = {\n  *gen<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_obj_quoted_gen_ok.ts",
         "const obj = {\n  \"my-m\"<T = {\n    a: string;\n",
         "const obj = {\n  \"my-m\"<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_quoted_gen_bad.ts",
         "const obj = {\n  \"my-m\"<T = {\n    a: string;\n",
         "const obj = {\n  \"my-m\"<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_obj_computed_gen_ok.ts",
         "const obj = {\n  [sym]<T = {\n    a: string;\n",
         "const obj = {\n  [sym]<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r30_obj_computed_gen_bad.ts",
         "const obj = {\n  [sym]<T = {\n    a: string;\n",
         "const obj = {\n  [sym]<T = {\n    a: string;\n    ...other,\n", false),
        // Option A: under TS 4.7+ instantiation expressions (`Foo<{ ... }>`), `fw.verify`
        // accepts both `k: 1,` and `readonly b: string;` / `x: number;`; `return 1;` is genuinely invalid.
        (LanguageId::TypeScript, "r30_obj_neg_prop_lt_brace_ok.ts",
         "const obj = {\n  a: Foo<{\n",
         "const obj = {\n  a: Foo<{\n  k: 1,\n", true),
        (LanguageId::TypeScript, "r30_obj_neg_prop_lt_brace_bad.ts",
         "const obj = {\n  a: Foo<{\n",
         "const obj = {\n  a: Foo<{\n  return 1;\n", false),
        (LanguageId::TypeScript, "r30_if_ret_str_cmp_ok.ts",
         "function g(c: boolean) {\n  if (c) return a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return a<\"x\", {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r30_if_ret_str_cmp_bad.ts",
         "function g(c: boolean) {\n  if (c) return a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return a<\"x\", {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_if_ret_limit_cmp_ok.ts",
         "function g(c: boolean) {\n  if (c) return a<LIMIT, {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return a<LIMIT, {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r30_if_ret_limit_cmp_bad.ts",
         "function g(c: boolean) {\n  if (c) return a<LIMIT, {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return a<LIMIT, {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_else_ret_str_cmp_ok.ts",
         "function g(c: boolean) {\n  if (c) return 0;\n  else return a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return 0;\n  else return a<\"x\", {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r30_else_ret_str_cmp_bad.ts",
         "function g(c: boolean) {\n  if (c) return 0;\n  else return a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) return 0;\n  else return a<\"x\", {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_ret_plus_two_cmp_ok.ts",
         "function g() {\n  return a<b + c<d, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b + c<d, {\n    x: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r30_ret_plus_two_cmp_bad.ts",
         "function g() {\n  return a<b + c<d, {\n    x: (1 + *),\n",
         "function g() {\n  return a<b + c<d, {\n    x: (1 + *),\n    readonly y: number;\n", false),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_my_type_ok.ts",
         "const x = wrap(1, foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_my_type_bad.ts",
         "const x = wrap(1, foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_id_ok.ts",
         "const x = wrap(arg1, foo<ID, {\n  a: (1 + *);\n",
         "const x = wrap(arg1, foo<ID, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_id_bad.ts",
         "const x = wrap(arg1, foo<ID, {\n  a: (1 + *);\n",
         "const x = wrap(arg1, foo<ID, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_str_ok.ts",
         "const x = wrap(1, foo<\"a\", {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<\"a\", {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_str_bad.ts",
         "const x = wrap(1, foo<\"a\", {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<\"a\", {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_true_ok.ts",
         "const x = wrap(1, foo<true, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<true, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_true_bad.ts",
         "const x = wrap(1, foo<true, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<true, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_1_ok.ts",
         "const x = wrap(1, foo<1, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<1, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_2nd_arg_1_bad.ts",
         "const x = wrap(1, foo<1, {\n  a: (1 + *);\n",
         "const x = wrap(1, foo<1, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_wrap_cmp_then_my_type_ok.ts",
         "const x = wrap(a < b, foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(a < b, foo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_wrap_cmp_then_my_type_bad.ts",
         "const x = wrap(a < b, foo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = wrap(a < b, foo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_foo_2nd_arg_bar_my_type_ok.ts",
         "foo(arg1, bar<MY_TYPE, {\n  a: (1 + *);\n",
         "foo(arg1, bar<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_foo_2nd_arg_bar_my_type_bad.ts",
         "foo(arg1, bar<MY_TYPE, {\n  a: (1 + *);\n",
         "foo(arg1, bar<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_arr_2nd_elem_bar_my_type_ok.ts",
         "const arr = [arg1, bar<MY_TYPE, {\n  a: (1 + *);\n",
         "const arr = [arg1, bar<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_arr_2nd_elem_bar_my_type_bad.ts",
         "const arr = [arg1, bar<MY_TYPE, {\n  a: (1 + *);\n",
         "const arr = [arg1, bar<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_neg_arr_a_str_cmp_ok.ts",
         "const arr = [(1 + *), a<\"x\", {\n  k: (1 + *),\n",
         "const arr = [(1 + *), a<\"x\", {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r30_neg_arr_a_str_cmp_bad.ts",
         "const arr = [(1 + *), a<\"x\", {\n  k: (1 + *),\n",
         "const arr = [(1 + *), a<\"x\", {\n  k: (1 + *),\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_neg_call_a_str_cmp_ok.ts",
         "foo((1 + *), a<\"x\", {\n  k: (1 + *),\n",
         "foo((1 + *), a<\"x\", {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r30_neg_call_a_str_cmp_bad.ts",
         "foo((1 + *), a<\"x\", {\n  k: (1 + *),\n",
         "foo((1 + *), a<\"x\", {\n  k: (1 + *),\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_neg_arr_a_limit_cmp_ok.ts",
         "const arr = [(1 + *), a<LIMIT, {\n  k: (1 + *),\n",
         "const arr = [(1 + *), a<LIMIT, {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r30_neg_arr_a_limit_cmp_bad.ts",
         "const arr = [(1 + *), a<LIMIT, {\n  k: (1 + *),\n",
         "const arr = [(1 + *), a<LIMIT, {\n  k: (1 + *),\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_neg_foo_a_max_val_ok.ts",
         "foo(a < MAX_VAL, {\n  k: (1 + *),\n",
         "foo(a < MAX_VAL, {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r30_neg_foo_a_max_val_bad.ts",
         "foo(a < MAX_VAL, {\n  k: (1 + *),\n",
         "foo(a < MAX_VAL, {\n  k: (1 + *),\n  readonly b: string;\n", false),

        // Group D: TS/JS Class ASI Fields, Generics, Decorators, #priv, Quoted, Computed, static\n{
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_t_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T\n  >() {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T\n  >() {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_t_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T\n  >() {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T\n  >() {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_def_t_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T = number\n  >(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T = number\n  >(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_def_t_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T = number\n  >(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T = number\n  >(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_extends_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_extends_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_multi_tparam_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T,\n    U\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T,\n    U\n  >(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_multi_tparam_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<\n    T,\n    U\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<\n    T,\n    U\n  >(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_call_cls_asi_ml_gen_extends_ok.ts",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_call_cls_asi_ml_gen_extends_bad.ts",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "foo((1 + *), class C {\n  broken = (1 + *)\n  m<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_brace_def_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number\n  }>(\n    x: T\n  ) {\n  const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number\n  }>(\n    x: T\n  ) {\n  const y = 1;\n  return y;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_brace_def_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number\n  }>(\n    x: T\n  ) {\n  const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<T = {\n    a: number\n  }>(\n    x: T\n  ) {\n  const y = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_ret_type_ok.ts",
         "class C {\n  broken = (1 + *)\n  m(a: number): Foo<\n    Bar\n  > {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(a: number): Foo<\n    Bar\n  > {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_gen_ret_type_bad.ts",
         "class C {\n  broken = (1 + *)\n  m(a: number): Foo<\n    Bar\n  > {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(a: number): Foo<\n    Bar\n  > {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_union_ret_ok.ts",
         "class C {\n  broken = (1 + *)\n  m(a: number):\n    | string\n    | number {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(a: number):\n    | string\n    | number {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_union_ret_bad.ts",
         "class C {\n  broken = (1 + *)\n  m(a: number):\n    | string\n    | number {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  m(a: number):\n    | string\n    | number {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_dec_1arg_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  m() {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  m() {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_dec_1arg_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  m() {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  m() {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_dec_obj_static_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec({ a: 1 })\n  static m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec({ a: 1 })\n  static m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_dec_obj_static_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec({ a: 1 })\n  static m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec({ a: 1 })\n  static m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_dec_nl_str_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(\"a\\nb\")\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(\"a\\nb\")\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_dec_nl_str_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(\"a\\nb\")\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(\"a\\nb\")\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_dec_1arg_quoted_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  \"my-m\"(a: number) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  \"my-m\"(a: number) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_dec_1arg_quoted_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  \"my-m\"(a: number) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1)\n  \"my-m\"(a: number) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_ml_dec_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(\n    1,\n    2\n  )\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(\n    1,\n    2\n  )\n  m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_ml_dec_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(\n    1,\n    2\n  )\n  m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(\n    1,\n    2\n  )\n  m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_multi_dec_m_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec1(1)\n  @dec2\n  public async m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec1(1)\n  @dec2\n  public async m(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_multi_dec_m_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec1(1)\n  @dec2\n  public async m(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec1(1)\n  @dec2\n  public async m(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_dec_star_gen_def_ok.ts",
         "class C {\n  a = 1\n  @dec\n  *m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  *m<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_dec_star_gen_def_bad.ts",
         "class C {\n  a = 1\n  @dec\n  *m<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  *m<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_priv_ml_ok.ts",
         "class C {\n  broken = (1 + *)\n  #priv(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  #priv(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_priv_ml_bad.ts",
         "class C {\n  broken = (1 + *)\n  #priv(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  #priv(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_priv_gen_def_ok.ts",
         "class C {\n  a = 1\n  #priv<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  #priv<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_priv_gen_def_bad.ts",
         "class C {\n  a = 1\n  #priv<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  #priv<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_gen_def_ok.ts",
         "class C {\n  a = 1\n  \"my-m\"<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  \"my-m\"<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_gen_def_bad.ts",
         "class C {\n  a = 1\n  \"my-m\"<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  \"my-m\"<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_pub_quoted_gen_def_ok.ts",
         "class C {\n  a = 1\n  public \"my-m\"<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  public \"my-m\"<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_pub_quoted_gen_def_bad.ts",
         "class C {\n  a = 1\n  public \"my-m\"<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  public \"my-m\"<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_computed_gen_def_ok.ts",
         "class C {\n  [sym]<T = {\n    a: number;\n",
         "class C {\n  [sym]<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r30_cls_computed_gen_def_bad.ts",
         "class C {\n  [sym]<T = {\n    a: number;\n",
         "class C {\n  [sym]<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_cmt_before_brace_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number\n  )\n  // comment before brace\n  {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number\n  )\n  // comment before brace\n  {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_cmt_before_brace_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number\n  )\n  // comment before brace\n  {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    a: number\n  )\n  // comment before brace\n  {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_ml_gen_extends_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r30_cls_asi_quoted_ml_gen_extends_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<\n    T extends Foo\n  >(\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r30_ts_cls_asi_static_nl_brace_ok.ts",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n  const y = 2;\n", true),
        (LanguageId::TypeScript, "r30_ts_cls_asi_static_nl_brace_bad.ts",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n  ...other,\n", false),
        (LanguageId::JavaScript, "r30_js_cls_asi_static_nl_brace_ok.js",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n  const y = 2;\n", true),
        (LanguageId::JavaScript, "r30_js_cls_asi_static_nl_brace_bad.js",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n",
         "class C {\n  broken = (1 + *)\n  static\n  {\n  const x = (1 + *)\n  ...other,\n", false),

        // Group E: Rust r5/ Fixes & Bypass Controls
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_attr_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_attr_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_unix_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg(\n    unix\n  )]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg(\n    unix\n  )]\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_unix_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg(\n    unix\n  )]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg(\n    unix\n  )]\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_attr_vec_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: Vec<\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_ml_cfg_attr_vec_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[cfg_attr(\n    all(),\n    allow(dead_code)\n  )]\n  good: Vec<\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_struct_ml_blk_cmt_bracket_ok.rs",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line ]\n  */\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line ]\n  */\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_ml_blk_cmt_bracket_bad.rs",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line ]\n  */\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line ]\n  */\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_struct_brack_len_4_ok.rs",
         "struct Foo {\n  bad: [u32; 4\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; 4\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_brack_len_4_bad.rs",
         "struct Foo {\n  bad: [u32; 4\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; 4\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_struct_brack_len_1_attr_ok.rs",
         "struct Foo {\n  bad: [u32; 1\n  #[allow(dead_code)]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; 1\n  #[allow(dead_code)]\n  good: (i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_struct_brack_len_1_attr_bad.rs",
         "struct Foo {\n  bad: [u32; 1\n  #[allow(dead_code)]\n  good: (i32,\n",
         "struct Foo {\n  bad: [u32; 1\n  #[allow(dead_code)]\n  good: (i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_enum_cmt_attr_variant_ok.rs",
         "enum E {\n  A([u32;\n  // cmt\n  #[allow(dead_code)]\n  B(i32,\n",
         "enum E {\n  A([u32;\n  // cmt\n  #[allow(dead_code)]\n  B(i32,\n  u64,\n", true),
        (LanguageId::Rust, "r30_rs_enum_cmt_attr_variant_bad.rs",
         "enum E {\n  A([u32;\n  // cmt\n  #[allow(dead_code)]\n  B(i32,\n",
         "enum E {\n  A([u32;\n  // cmt\n  #[allow(dead_code)]\n  B(i32,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_impl_broken_arr_param_fn_gen_ok.rs",
         "impl Foo {\n  fn a(x: [u32\n  fn g<T,\n",
         "impl Foo {\n  fn a(x: [u32\n  fn g<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r30_rs_impl_broken_arr_param_fn_gen_bad.rs",
         "impl Foo {\n  fn a(x: [u32\n  fn g<T,\n",
         "impl Foo {\n  fn a(x: [u32\n  fn g<T,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_impl_two_broken_fn_open_gen_ok.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn c(y: (i32,\n  fn g<T,\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn c(y: (i32,\n  fn g<T,\n  U: Clone,\n", true),
        (LanguageId::Rust, "r30_rs_impl_two_broken_fn_open_gen_bad.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn c(y: (i32,\n  fn g<T,\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn c(y: (i32,\n  fn g<T,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_ctrl_impl_broken_arr_closed_fn_bad.rs",
         "impl Foo {\n  fn a(x: [u32\n  fn b() {}\n  bad: (;\n}\n",
         "impl Foo {\n  fn a(x: [u32\n  fn b() {}\n  bad: (;\n  fn c() {}\n}\n", false),
        (LanguageId::Rust, "r30_rs_ctrl_impl_attr_unclosed_bad.rs",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  bad: (;\n  fn b() {}\n}\n", false),
        (LanguageId::Rust, "r30_rs_ctrl_struct_arr_n_ok.rs",
         "struct S {\n  arr: [u8;\n  N\n",
         "struct S {\n  arr: [u8;\n  N\n  ],\n", true),
        (LanguageId::Rust, "r30_rs_ctrl_struct_arr_n_bad.rs",
         "struct S {\n  arr: [u8;\n  N\n",
         "struct S {\n  arr: [u8;\n  N\n  let bad = ;\n", false),
        (LanguageId::Rust, "r30_rs_ctrl_enum_arr_call_ok.rs",
         "enum E {\n  A([u8;\n",
         "enum E {\n  A([u8;\n  foo(1)],\n", true),
        (LanguageId::Rust, "r30_rs_ctrl_enum_arr_call_bad.rs",
         "enum E {\n  A([u8;\n",
         "enum E {\n  A([u8;\n  let bad = ;\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
}

#[test]
fn regression_iter31_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    for (lang, name, base, cand, exp_valid) in [
        // Cluster 1A: ASI tail isolation in pre_lt_has_cmp_ctx
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_my_type_ok.ts",
         "function g() {\n  const x = 1\n  foo<MY_TYPE, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<MY_TYPE, {\n    a: (1 + *);\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_my_type_bad.ts",
         "function g() {\n  const x = 1\n  foo<MY_TYPE, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<MY_TYPE, {\n    a: (1 + *);\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_top_asi_foo_my_type_ok.ts",
         "const x = 1\nfoo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = 1\nfoo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1a_top_asi_foo_my_type_bad.ts",
         "const x = 1\nfoo<MY_TYPE, {\n  a: (1 + *);\n",
         "const x = 1\nfoo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_id_ok.ts",
         "function g() {\n  const x = 1\n  foo<ID, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<ID, {\n    a: (1 + *);\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_id_bad.ts",
         "function g() {\n  const x = 1\n  foo<ID, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<ID, {\n    a: (1 + *);\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_1_ok.ts",
         "function g() {\n  const x = 1\n  foo<1, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<1, {\n    a: (1 + *);\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1a_fn_asi_foo_1_bad.ts",
         "function g() {\n  const x = 1\n  foo<1, {\n    a: (1 + *);\n",
         "function g() {\n  const x = 1\n  foo<1, {\n    a: (1 + *);\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_top_asi_pipe_ok.ts",
         "const f = 1\nfoo<MY_TYPE | {\n  a: string;\n",
         "const f = 1\nfoo<MY_TYPE | {\n  a: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r31_1a_top_asi_pipe_bad.ts",
         "const f = 1\nfoo<MY_TYPE | {\n  a: string;\n",
         "const f = 1\nfoo<MY_TYPE | {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_top_asi_ml_comma_ok.ts",
         "const f = 1\nfoo<MY_TYPE,\n  {\n    a: string;\n",
         "const f = 1\nfoo<MY_TYPE,\n  {\n    a: string;\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "r31_1a_top_asi_ml_comma_bad.ts",
         "const f = 1\nfoo<MY_TYPE,\n  {\n    a: string;\n",
         "const f = 1\nfoo<MY_TYPE,\n  {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_top_asi_ml_pipe_ok.ts",
         "const f = 1\nfoo<MY_TYPE |\n  {\n    a: string;\n",
         "const f = 1\nfoo<MY_TYPE |\n  {\n    a: string;\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "r31_1a_top_asi_ml_pipe_bad.ts",
         "const f = 1\nfoo<MY_TYPE |\n  {\n    a: string;\n",
         "const f = 1\nfoo<MY_TYPE |\n  {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1a_ctrl_if_nl_ret_cmp_ok.ts",
         "function g(c: boolean) {\n  if (c)\n    return a<\"x\", {\n      k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c)\n    return a<\"x\", {\n      k: (1 + *),\n      ...other,\n", true),
        (LanguageId::TypeScript, "r31_1a_ctrl_if_nl_ret_cmp_bad.ts",
         "function g(c: boolean) {\n  if (c)\n    return a<\"x\", {\n      k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c)\n    return a<\"x\", {\n      k: (1 + *),\n      readonly b: string;\n", false),
        // Cluster 1B: const/let/var declarator initializers vs expression assignment
        (LanguageId::TypeScript, "r31_1b_const_foo_my_type_ok.ts",
         "const x = foo<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = foo<MY_TYPE, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_const_foo_my_type_bad.ts",
         "const x = foo<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = foo<MY_TYPE, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1b_let_foo_id_ok.ts",
         "let x = foo<ID, {\n  a: (1 + *),\n",
         "let x = foo<ID, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_let_foo_id_bad.ts",
         "let x = foo<ID, {\n  a: (1 + *),\n",
         "let x = foo<ID, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1b_var_foo_true_ok.ts",
         "var x = foo<true, {\n  a: (1 + *),\n",
         "var x = foo<true, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_var_foo_true_bad.ts",
         "var x = foo<true, {\n  a: (1 + *),\n",
         "var x = foo<true, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1b_const_foo_str_ok.ts",
         "const x = foo<\"a\", {\n  a: (1 + *),\n",
         "const x = foo<\"a\", {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_const_foo_str_bad.ts",
         "const x = foo<\"a\", {\n  a: (1 + *),\n",
         "const x = foo<\"a\", {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1b_const_foo_1_ok.ts",
         "const x = foo<1, {\n  a: (1 + *),\n",
         "const x = foo<1, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_const_foo_1_bad.ts",
         "const x = foo<1, {\n  a: (1 + *),\n",
         "const x = foo<1, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_1b_const_comma_y_eq_foo_ok.ts",
         "const x = a < b, y = foo<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = a < b, y = foo<MY_TYPE, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1b_const_comma_y_eq_foo_bad.ts",
         "const x = a < b, y = foo<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = a < b, y = foo<MY_TYPE, {\n  a: (1 + *),\n  ...other,\n", false),
        // Cluster 1C: return/throw/await/yield + multi-char generic calls
        (LanguageId::TypeScript, "r31_1c_ret_foo_neg1_ok.ts",
         "function g() {\n  return foo<-1, {\n    a: string;\n",
         "function g() {\n  return foo<-1, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_ret_foo_neg1_bad.ts",
         "function g() {\n  return foo<-1, {\n    a: string;\n",
         "function g() {\n  return foo<-1, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_ret_foo_true_ok.ts",
         "function g() {\n  return foo<true, {\n    a: string;\n",
         "function g() {\n  return foo<true, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_ret_foo_true_bad.ts",
         "function g() {\n  return foo<true, {\n    a: string;\n",
         "function g() {\n  return foo<true, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_ret_foo_my_type_ok.ts",
         "function g() {\n  return foo<MY_TYPE, {\n    a: string;\n",
         "function g() {\n  return foo<MY_TYPE, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_ret_foo_my_type_bad.ts",
         "function g() {\n  return foo<MY_TYPE, {\n    a: string;\n",
         "function g() {\n  return foo<MY_TYPE, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_ret_foo_this_ok.ts",
         "class C {\n  m() {\n    return foo<this, {\n      a: string;\n",
         "class C {\n  m() {\n    return foo<this, {\n      a: string;\n      readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_ret_foo_this_bad.ts",
         "class C {\n  m() {\n    return foo<this, {\n      a: string;\n",
         "class C {\n  m() {\n    return foo<this, {\n      a: string;\n      ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_throw_foo_ok.ts",
         "function g() {\n  throw foo<MY_TYPE, {\n    a: string;\n",
         "function g() {\n  throw foo<MY_TYPE, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_throw_foo_bad.ts",
         "function g() {\n  throw foo<MY_TYPE, {\n    a: string;\n",
         "function g() {\n  throw foo<MY_TYPE, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_await_fetch_ok.ts",
         "async function g() {\n  await fetch<MY_TYPE, {\n    a: string;\n",
         "async function g() {\n  await fetch<MY_TYPE, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_await_fetch_bad.ts",
         "async function g() {\n  await fetch<MY_TYPE, {\n    a: string;\n",
         "async function g() {\n  await fetch<MY_TYPE, {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1c_yield_gen_ok.ts",
         "function* g() {\n  yield gen<MY_TYPE, {\n    a: string;\n",
         "function* g() {\n  yield gen<MY_TYPE, {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1c_yield_gen_bad.ts",
         "function* g() {\n  yield gen<MY_TYPE, {\n    a: string;\n",
         "function* g() {\n  yield gen<MY_TYPE, {\n    a: string;\n    ...other,\n", false),
        // Cluster 1D: arrow body & bare if/while comparisons
        (LanguageId::TypeScript, "r31_1d_arrow_str_cmp_ok.ts",
         "foo((x) => a<\"x\", {\n  k: (1 + *),\n",
         "foo((x) => a<\"x\", {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "r31_1d_arrow_str_cmp_bad.ts",
         "foo((x) => a<\"x\", {\n  k: (1 + *),\n",
         "foo((x) => a<\"x\", {\n  k: (1 + *),\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r31_1d_if_no_ret_cmp_ok.ts",
         "function g(c: boolean) {\n  if (c) a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) a<\"x\", {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r31_1d_if_no_ret_cmp_bad.ts",
         "function g(c: boolean) {\n  if (c) a<\"x\", {\n    k: (1 + *),\n",
         "function g(c: boolean) {\n  if (c) a<\"x\", {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r31_1d_ctrl_arrow_anon_gen_ok.ts",
         "const f = (x) => <T = {\n  a: string;\n",
         "const f = (x) => <T = {\n  a: string;\n  readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_1d_ctrl_arrow_anon_gen_bad.ts",
         "const f = (x) => <T = {\n  a: string;\n",
         "const f = (x) => <T = {\n  a: string;\n  return 1;\n", false),
        // Cluster 1E: @dec [sym]<T = { and @dec *[sym]<T = { after ASI field
        (LanguageId::TypeScript, "r31_1e_dec_computed_gen_ok.ts",
         "class C {\n  a = 1\n  @dec\n  [sym]<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  [sym]<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1e_dec_computed_gen_bad.ts",
         "class C {\n  a = 1\n  @dec\n  [sym]<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  [sym]<T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_1e_dec_star_computed_gen_ok.ts",
         "class C {\n  a = 1\n  @dec\n  *[sym]<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  *[sym]<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r31_1e_dec_star_computed_gen_bad.ts",
         "class C {\n  a = 1\n  @dec\n  *[sym]<T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  *[sym]<T = {\n    a: number;\n    ...other,\n", false),
        // Cluster 2A-2C: quoted method comments, <...> parens, same-line @dec
        (LanguageId::TypeScript, "r31_2a_quoted_ml_blk_cmt_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    /* a\n       b */\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    /* a\n       b */\n    a: number\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r31_2a_quoted_ml_blk_cmt_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    /* a\n       b */\n    a: number\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"(\n    /* a\n       b */\n    a: number\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_2b_quoted_paren_in_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r31_2b_quoted_paren_in_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_2b_quoted_arrow_in_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends () => void>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends () => void>(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r31_2b_quoted_arrow_in_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends () => void>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends () => void>(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r31_2c_sameline_dec_quoted_gen_ok.ts",
         "class C {\n  a = 1\n  @dec \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec \"my-m\"<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_2c_sameline_dec_quoted_gen_bad.ts",
         "class C {\n  a = 1\n  @dec \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec \"my-m\"<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_2c_sameline_dec1_quoted_gen_ok.ts",
         "class C {\n  a = 1\n  @dec(1) \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec(1) \"my-m\"<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_2c_sameline_dec1_quoted_gen_bad.ts",
         "class C {\n  a = 1\n  @dec(1) \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec(1) \"my-m\"<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r31_2c_sameline_dec_gen_quoted_ok.ts",
         "class C {\n  a = 1\n  @dec<number>(1) \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec<number>(1) \"my-m\"<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r31_2c_sameline_dec_gen_quoted_bad.ts",
         "class C {\n  a = 1\n  @dec<number>(1) \"my-m\"<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec<number>(1) \"my-m\"<T = {\n    a: string;\n    ...other,\n", false),
        // Cluster 2D: foo<T, [ and foo<T, ( TypeBracket/TypeParen synthesis
        (LanguageId::TypeScript, "r31_2d_semi_my_type_named_tuple_ok.ts",
         "const f = 1;\nfoo<MY_TYPE, [\n",
         "const f = 1;\nfoo<MY_TYPE, [\n  a: string,\n", true),
        (LanguageId::TypeScript, "r31_2d_semi_my_type_named_tuple_bad.ts",
         "const f = 1;\nfoo<MY_TYPE, [\n",
         "const f = 1;\nfoo<MY_TYPE, [\n  let bad = ;\n", false),
        (LanguageId::TypeScript, "r31_2d_asi_my_type_named_tuple_ok.ts",
         "const f = 1\nfoo<MY_TYPE, [\n",
         "const f = 1\nfoo<MY_TYPE, [\n  a: string,\n", true),
        (LanguageId::TypeScript, "r31_2d_asi_my_type_named_tuple_bad.ts",
         "const f = 1\nfoo<MY_TYPE, [\n",
         "const f = 1\nfoo<MY_TYPE, [\n  let bad = ;\n", false),
        (LanguageId::TypeScript, "r31_2d_semi_string_named_tuple_ok.ts",
         "const f = 1;\nfoo<string, [\n",
         "const f = 1;\nfoo<string, [\n  a: string,\n", true),
        (LanguageId::TypeScript, "r31_2d_semi_opt_tuple_ok.ts",
         "const f = 1;\nfoo<MY_TYPE, [\n",
         "const f = 1;\nfoo<MY_TYPE, [\n  string?,\n", true),
        (LanguageId::TypeScript, "r31_2d_semi_my_type_type_paren_ok.ts",
         "const f = 1;\nfoo<MY_TYPE, (\n",
         "const f = 1;\nfoo<MY_TYPE, (\n  a: string,\n", true),
        (LanguageId::TypeScript, "r31_2d_semi_my_type_type_paren_bad.ts",
         "const f = 1;\nfoo<MY_TYPE, (\n",
         "const f = 1;\nfoo<MY_TYPE, (\n  let bad = ;\n", false),
        // Cluster 3A-3B: firewall_delta.rs & midfile span split
        (LanguageId::Rust, "r31_3a_eof_open_paren_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (\n    i32,\n", true),
        (LanguageId::Rust, "r31_3a_eof_open_paren_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (\n    let bad = ;\n", false),
        (LanguageId::Rust, "r31_3a_eof_open_brack_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: [\n    u8;\n", true),
        (LanguageId::Rust, "r31_3a_eof_open_brack_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: [\n    let bad = ;\n", false),
        (LanguageId::Rust, "r31_3a_eof_close_and_open_vec_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    u64,\n", true),
        (LanguageId::Rust, "r31_3a_eof_close_and_open_vec_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    let bad = ;\n", false),
        (LanguageId::TypeScript, "r31_3a_eof_ts_asi_trailing_blank_ok.ts",
         "const f = 1\nfunction g<T = {\n  a: number;\n",
         "const f = 1\nfunction g<T = {\n  a: number;\n  readonly b: string;\n\n", true),
        (LanguageId::TypeScript, "r31_3a_eof_ts_asi_trailing_blank_bad.ts",
         "const f = 1\nfunction g<T = {\n  a: number;\n",
         "const f = 1\nfunction g<T = {\n  a: number;\n  return 1;\n\n", false),
        (LanguageId::TypeScript, "r31_3a_eof_ts_asi_trailing_cmt_blank_ok.ts",
         "const f = 1\nfunction g<T = {\n  a: number;\n",
         "const f = 1\nfunction g<T = {\n  a: number;\n  readonly b: string;\n  // trailing\n\n", true),
        (LanguageId::Rust, "r31_3a_eof_rs_vec_trailing_blank_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    u64,\n\n", true),
        (LanguageId::Rust, "r31_3a_eof_rs_vec_trailing_blank_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n    let bad = ;\n\n", false),
        (LanguageId::Rust, "r31_3b_midfile_impl_semi_arr_fn_gen_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "r31_3b_midfile_impl_semi_arr_fn_gen_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        // Cluster 4A-4C + Auditor Low FR
        (LanguageId::Rust, "r31_4a_struct_blk_cmt_same_line_field_mid_ok.rs",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n  ),\n}\n",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n    u64,\n  ),\n}\n", true),
        (LanguageId::Rust, "r31_4a_struct_blk_cmt_same_line_field_eof_ok.rs",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n    u64,\n", true),
        (LanguageId::Rust, "r31_4a_struct_blk_cmt_same_line_field_eof_bad.rs",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n",
         "struct Foo {\n  bad: [u32;\n  /* multi\n  line */ good: (i32,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r31_4a_impl_blk_cmt_same_line_fn_gen_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n    U: Clone,\n", true),
        (LanguageId::Rust, "r31_4a_enum_blk_cmt_same_line_variant_ok.rs",
         "enum E {\n  A([u32;\n  /* multi\n  line */ B(i32,\n",
         "enum E {\n  A([u32;\n  /* multi\n  line */ B(i32,\n    u64,\n", true),
        (LanguageId::Rust, "r31_4a_impl_ml_attr_same_line_fn_gen_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n    U: Clone,\n", true),
        (LanguageId::Rust, "r31_4b_enum_struct_variant_broken_arr_ok.rs",
         "enum E {\n  A {\n    bad: [u32;\n    good: (i32,\n",
         "enum E {\n  A {\n    bad: [u32;\n    good: (i32,\n    u64,\n", true),
        (LanguageId::Rust, "r31_4b_enum_struct_variant_broken_arr_bad.rs",
         "enum E {\n  A {\n    bad: [u32;\n    good: (i32,\n",
         "enum E {\n  A {\n    bad: [u32;\n    good: (i32,\n    let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_enum_struct_variant_broken_vec_ok.rs",
         "enum E {\n  A {\n    bad: [u32;\n    good: Vec<\n",
         "enum E {\n  A {\n    bad: [u32;\n    good: Vec<\n      u64,\n", true),
        (LanguageId::Rust, "r31_4b_enum_variant_nested_arr_ok.rs",
         "enum E {\n  A([u32;\n  B([u8; 4],\n    (i32,\n",
         "enum E {\n  A([u32;\n  B([u8; 4],\n    (i32,\n      u64,\n", true),
        (LanguageId::Rust, "r31_4b_enum_variant_nested_arr_bad.rs",
         "enum E {\n  A([u32;\n  B([u8; 4],\n    (i32,\n",
         "enum E {\n  A([u32;\n  B([u8; 4],\n    (i32,\n      let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_trait_broken_arr_assoc_plus_ok.rs",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n  Send;\n", true),
        (LanguageId::Rust, "r31_4b_trait_broken_arr_assoc_plus_bad.rs",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_impl_broken_arr_type_add_ok.rs",
         "impl Foo {\n  fn a(x: [u32\n  type Item = i32 +\n",
         "impl Foo {\n  fn a(x: [u32\n  type Item = i32 +\n  u64;\n", true),
        (LanguageId::Rust, "r31_4b_impl_broken_arr_type_add_bad.rs",
         "impl Foo {\n  fn a(x: [u32\n  type Item = i32 +\n",
         "impl Foo {\n  fn a(x: [u32\n  type Item = i32 +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_trait_broken_arr_const_eq_ok.rs",
         "trait T {\n  fn a(x: [u32\n  const N: usize =\n",
         "trait T {\n  fn a(x: [u32\n  const N: usize =\n  1;\n", true),
        (LanguageId::Rust, "r31_4b_trait_broken_arr_const_eq_bad.rs",
         "trait T {\n  fn a(x: [u32\n  const N: usize =\n",
         "trait T {\n  fn a(x: [u32\n  const N: usize =\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_impl_broken_arr_fn_ret_plus_ok.rs",
         "impl Foo {\n  fn a(x: [u32\n  fn b() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32\n  fn b() -> impl Clone +\n  Send {\n", true),
        (LanguageId::Rust, "r31_4b_impl_broken_arr_fn_ret_plus_bad.rs",
         "impl Foo {\n  fn a(x: [u32\n  fn b() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32\n  fn b() -> impl Clone +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4b_impl_two_broken_fn_where_ok.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T>(x: T)\n  where\n    T: Clone +\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T>(x: T)\n  where\n    T: Clone +\n    Send,\n", true),
        (LanguageId::Rust, "r31_4b_impl_two_broken_fn_where_bad.rs",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T>(x: T)\n  where\n    T: Clone +\n",
         "impl Foo {\n  fn a() { let x = (1; }\n  fn b(x: i32\n  fn g<T>(x: T)\n  where\n    T: Clone +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r31_4c_attr_vec_trailing_cmt_blank_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n\n  // trailing\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n\n  // trailing\n  u64,\n", true),
        (LanguageId::Rust, "r31_4c_attr_vec_trailing_cmt_blank_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n\n  // trailing\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n\n  // trailing\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4c_vec_trailing_cmt_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n  // trailing\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: Vec<\n  // trailing\n  u64,\n", true),
        (LanguageId::Rust, "r31_4c_aud_vec_two_line_good_vs_second_ok.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n  u64>,\n  next: i32,\n", true),
        (LanguageId::Rust, "r31_4c_aud_vec_two_line_good_vs_second_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n  u64>,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r31_4c_aud_nested_angle_colon_still_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: HashMap<K, Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: HashMap<K, Vec<\n  V>, next: i32,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        assert_eq!(v.is_valid(), exp_valid, "{name}: {v:?}");
    }
}

#[test]
fn regression_iter32_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp_valid) in [
        // A. Focus 1 (firewall.rs & r5/firewall_delta.rs & r5/firewall_mid.rs)
        (LanguageId::Rust, "r32_f1_rs_impl_unclosed_attr_fn_open_let_bad.rs",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n}\n",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "r32_f1_rs_impl_unclosed_attr_closed_fn_ok.rs",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n  let ok = 1;\n  let ok2 = 2;\n}\n", true),
        (LanguageId::Rust, "r32_f1_rs_impl_unclosed_attr_closed_fn_bad.rs",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix\n  fn b() {\n  let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "r32_f1_rs_paren_vec_close_then_field_ok.rs",
         "struct Foo {\n  bad: [u32;\n  good: (Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: (Vec<\n    u64>, i32),\n  next: i32,\n", true),
        (LanguageId::Rust, "r32_f1_rs_paren_vec_close_then_field_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: (Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: (Vec<\n    u64>, i32),\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f1_rs_fresh_cand_closes_struct_then_fn_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: i32,\n}\nfn ok(x: i32) {}\n", true),
        (LanguageId::Rust, "r32_f1_rs_fresh_cand_closes_struct_then_fn_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: i32,\n}\nfn bad(x: ;\n", false),
        (LanguageId::Rust, "r32_f1_rs_struct_cand_closes_vec_then_field_ok.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n  >,\n  next_field: i32,\n", true),
        (LanguageId::Rust, "r32_f1_rs_struct_cand_closes_vec_then_field_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n  >,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f1_rs_struct_cand_closes_brace_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: i32,\n}\n", true),
        (LanguageId::Rust, "r32_f1_rs_struct_cand_closes_brace_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "r32_f1_mid_impl_trailing_fn_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n  >() {}\n  fn h() {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_mid_impl_trailing_fn_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n  fn h() {}\n}\n", false),
        (LanguageId::Rust, "r32_f1_mid_trait_assoc_plus_ok.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n}\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n    Send;\n}\n", true),
        (LanguageId::Rust, "r32_f1_mid_trait_assoc_plus_bad.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n}\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n    let bad = ;\n}\n", false),
        (LanguageId::Rust, "r32_f1_mid_trait_no_semi_assoc_plus_ok.rs",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n}\n",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n    Send;\n}\n", true),
        (LanguageId::Rust, "r32_f1_mid_trait_no_semi_assoc_plus_bad.rs",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n}\n",
         "trait T {\n  fn a(x: [u32\n  type Assoc: Clone +\n    let bad = ;\n}\n", false),
        (LanguageId::Rust, "r32_f1_exact_f3b_impl_fn_semi_arr_midfile_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_exact_f3b_impl_fn_semi_arr_midfile_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        (LanguageId::Rust, "r32_f1_exact_f3a_impl_blk_cmt_same_line_fn_gen_mid_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_exact_f3a_impl_blk_cmt_same_line_fn_gen_mid_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  /* multi\n  line */ fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        (LanguageId::Rust, "r32_f1_exact_f3a_impl_ml_attr_same_line_fn_gen_mid_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_exact_f3a_impl_ml_attr_same_line_fn_gen_mid_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(\n    unix\n  )] fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        (LanguageId::Rust, "r32_f1_midfile_impl_fn_open_paren_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  ) {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    x: i32,\n  ) {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_midfile_impl_fn_open_paren_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  ) {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    let bad = ;\n  ) {}\n}\n", false),
        (LanguageId::Rust, "r32_f1_midfile_struct_open_paren_ok.rs",
         "struct Foo {\n  bad: [u32;\n  ),\n}\n",
         "struct Foo {\n  bad: [u32;\n  good: (\n    i32,\n  ),\n}\n", true),
        (LanguageId::Rust, "r32_f1_midfile_struct_open_paren_bad.rs",
         "struct Foo {\n  bad: [u32;\n  ),\n}\n",
         "struct Foo {\n  bad: [u32;\n  good: (\n    let bad = ;\n  ),\n}\n", false),
        (LanguageId::Rust, "r32_f1_midfile_struct_attr_open_paren_ok.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  ),\n}\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (\n    i32,\n  ),\n}\n", true),
        (LanguageId::Rust, "r32_f1_midfile_struct_attr_open_paren_bad.rs",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  ),\n}\n",
         "struct Foo {\n  bad: [u32;\n  #[allow(dead_code)]\n  good: (\n    let bad = ;\n  ),\n}\n", false),
        (LanguageId::Rust, "r32_f1_midfile_replace_cmt_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    // TODO\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "r32_f1_midfile_replace_cmt_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    // TODO\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        // B. Focus 2 (TS r5/ + auditor_1_r31_rep Challenges 1-3)
        (LanguageId::TypeScript, "r32_f2_else_if_nl_bare_cmp_ok.ts",
         "function g(a: boolean, c: boolean) {\n  if (a) x = 1\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: boolean, c: boolean) {\n  if (a) x = 1\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      ...other,\n", true),
        (LanguageId::TypeScript, "r32_f2_else_if_nl_bare_cmp_bad.ts",
         "function g(a: boolean, c: boolean) {\n  if (a) x = 1\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: boolean, c: boolean) {\n  if (a) x = 1\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      readonly b: string;\n", false),
        (LanguageId::TypeScript, "r32_f2_brace_else_if_nl_bare_cmp_ok.ts",
         "function g(a: boolean, c: boolean) {\n  if (a) { x = 1; } else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: boolean, c: boolean) {\n  if (a) { x = 1; } else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      ...other,\n", true),
        (LanguageId::TypeScript, "r32_f2_brace_else_if_nl_bare_cmp_bad.ts",
         "function g(a: boolean, c: boolean) {\n  if (a) { x = 1; } else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: boolean, c: boolean) {\n  if (a) { x = 1; } else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      readonly b: string;\n", false),
        (LanguageId::TypeScript, "r32_f2_else_if_asi_limit_cmp_ok.ts",
         "if (a) { 1 }\nelse if (b)\n  a<LIMIT, {\n    k: (1 + *),\n",
         "if (a) { 1 }\nelse if (b)\n  a<LIMIT, {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "r32_f2_else_if_asi_limit_cmp_bad.ts",
         "if (a) { 1 }\nelse if (b)\n  a<LIMIT, {\n    k: (1 + *),\n",
         "if (a) { 1 }\nelse if (b)\n  a<LIMIT, {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r32_f2_aud_c1_else_if_nl_bare_cmp_ok.ts",
         "function g(a: number, b: number, c: boolean) {\n  if (b) return 1;\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: number, b: number, c: boolean) {\n  if (b) return 1;\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      ...other,\n", true),
        (LanguageId::TypeScript, "r32_f2_aud_c1_else_if_nl_bare_cmp_bad.ts",
         "function g(a: number, b: number, c: boolean) {\n  if (b) return 1;\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(a: number, b: number, c: boolean) {\n  if (b) return 1;\n  else if (c)\n    a<\"x\", {\n      k: (1 + *),\n      readonly b: string;\n", false),
        (LanguageId::TypeScript, "r32_f2_for_nl_bare_cmp_ok.ts",
         "function g(xs: number[]) {\n  for (const x of xs)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(xs: number[]) {\n  for (const x of xs)\n    a<\"x\", {\n      k: (1 + *),\n      ...other,\n", true),
        (LanguageId::TypeScript, "r32_f2_for_nl_bare_cmp_bad.ts",
         "function g(xs: number[]) {\n  for (const x of xs)\n    a<\"x\", {\n      k: (1 + *),\n",
         "function g(xs: number[]) {\n  for (const x of xs)\n    a<\"x\", {\n      k: (1 + *),\n      readonly b: string;\n", false),
        (LanguageId::TypeScript, "r32_f2_const_lt_then_asi_foo_gen_ok.ts",
         "function g(a: number, b: number) {\n  const y = a < b\n  foo<MY_TYPE, {\n    a: (1 + *),\n",
         "function g(a: number, b: number) {\n  const y = a < b\n  foo<MY_TYPE, {\n    a: (1 + *),\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_const_lt_then_asi_foo_gen_bad.ts",
         "function g(a: number, b: number) {\n  const y = a < b\n  foo<MY_TYPE, {\n    a: (1 + *),\n",
         "function g(a: number, b: number) {\n  const y = a < b\n  foo<MY_TYPE, {\n    a: (1 + *),\n    ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_export_const_f_my_type_ok.ts",
         "export const x = f<MY_TYPE, {\n  a: string;\n",
         "export const x = f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_export_const_f_my_type_bad.ts",
         "export const x = f<MY_TYPE, {\n  a: string;\n",
         "export const x = f<MY_TYPE, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_export_const_a_my_type_ok.ts",
         "export const x = a<MY_TYPE, {\n  a: (1 + *),\n",
         "export const x = a<MY_TYPE, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_export_const_a_my_type_bad.ts",
         "export const x = a<MY_TYPE, {\n  a: (1 + *),\n",
         "export const x = a<MY_TYPE, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_export_let_f_my_type_ok.ts",
         "export let x = f<MY_TYPE, {\n  a: (1 + *),\n",
         "export let x = f<MY_TYPE, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_export_let_f_my_type_bad.ts",
         "export let x = f<MY_TYPE, {\n  a: (1 + *),\n",
         "export let x = f<MY_TYPE, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_const_comma_y_eq_f_my_type_ok.ts",
         "const x = 1, y = f<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = 1, y = f<MY_TYPE, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_const_comma_y_eq_f_my_type_bad.ts",
         "const x = 1, y = f<MY_TYPE, {\n  a: (1 + *),\n",
         "const x = 1, y = f<MY_TYPE, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_const_foo_lower_u_pipe_ok.ts",
         "const x = foo<u |\n  {\n    a: string;\n",
         "const x = foo<u |\n  {\n    a: string;\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "r32_f2_const_foo_lower_u_pipe_bad.ts",
         "const x = foo<u |\n  {\n    a: string;\n",
         "const x = foo<u |\n  {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_cls_sameline_dec_computed_gen_ok.ts",
         "class C {\n  a = 1\n  @dec(1) [sym]<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec(1) [sym]<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r32_f2_cls_sameline_dec_computed_gen_bad.ts",
         "class C {\n  a = 1\n  @dec(1) [sym]<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec(1) [sym]<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_cls_sameline_bare_dec_computed_gen_ok.ts",
         "class C {\n  a = 1\n  @dec [sym]<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec [sym]<T = {\n    a: string;\n    readonly b: boolean;\n", true),
        (LanguageId::TypeScript, "r32_f2_cls_sameline_bare_dec_computed_gen_bad.ts",
         "class C {\n  a = 1\n  @dec [sym]<T = {\n    a: string;\n",
         "class C {\n  a = 1\n  @dec [sym]<T = {\n    a: string;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_aud_c2_dec_computed_space_before_lt_ok.ts",
         "class C {\n  a = 1\n  @dec\n  [sym] <T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  [sym] <T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r32_f2_aud_c2_dec_computed_space_before_lt_bad.ts",
         "class C {\n  a = 1\n  @dec\n  [sym] <T = {\n    a: number;\n",
         "class C {\n  a = 1\n  @dec\n  [sym] <T = {\n    a: number;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_cls_quoted_multi_tparam_paren_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T, U extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T, U extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r32_f2_cls_quoted_multi_tparam_paren_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T, U extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T, U extends (string | number)>(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_cls_quoted_record_arrow_in_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends Record<string, (a: number) => void>>(\n    x: T\n  ) {\n  const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends Record<string, (a: number) => void>>(\n    x: T\n  ) {\n  const y = 1;\n  return y;\n", true),
        (LanguageId::TypeScript, "r32_f2_cls_quoted_record_arrow_in_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends Record<string, (a: number) => void>>(\n    x: T\n  ) {\n  const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends Record<string, (a: number) => void>>(\n    x: T\n  ) {\n  const y = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_aud_c3_cls_quoted_multi_param_gen_parens_ok.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r32_f2_aud_c3_cls_quoted_multi_param_gen_parens_bad.ts",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r32_f2_obj_quoted_multi_param_gen_parens_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n  return x;\n", true),
        (LanguageId::TypeScript, "r32_f2_obj_quoted_multi_param_gen_parens_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  \"my-m\"<T extends (A | B), U = (C) => D>(\n    a: T\n  ) {\n  const x = 1;\n  ...other,\n", false),
        // C. Focus 3 (Rust r5/) + Negative Controls
        (LanguageId::Rust, "r32_f3_rs_vec_close_then_open_second_vec_ok.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n  u64>,\n  next: Vec<\n", true),
        (LanguageId::Rust, "r32_f3_rs_vec_close_then_open_second_vec_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n  u64>,\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_trait_semi_arr_assoc_plus_eof_ok.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n  Send;\n", true),
        (LanguageId::Rust, "r32_f3_trait_semi_arr_assoc_plus_eof_bad.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc: Clone +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_semi_arr_type_add_eof_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  type Item = i32 +\n",
         "impl Foo {\n  fn a(x: [u32;\n  type Item = i32 +\n  u64;\n", true),
        (LanguageId::Rust, "r32_f3_impl_semi_arr_type_add_eof_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  type Item = i32 +\n",
         "impl Foo {\n  fn a(x: [u32;\n  type Item = i32 +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_trait_semi_arr_const_eq_eof_ok.rs",
         "trait T {\n  fn a(x: [u32;\n  const N: usize =\n",
         "trait T {\n  fn a(x: [u32;\n  const N: usize =\n  1;\n", true),
        (LanguageId::Rust, "r32_f3_trait_semi_arr_const_eq_eof_bad.rs",
         "trait T {\n  fn a(x: [u32;\n  const N: usize =\n",
         "trait T {\n  fn a(x: [u32;\n  const N: usize =\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_semi_arr_fn_ret_plus_eof_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn b() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn b() -> impl Clone +\n  Send {\n", true),
        (LanguageId::Rust, "r32_f3_impl_semi_arr_fn_ret_plus_eof_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn b() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn b() -> impl Clone +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_pub_async_unsafe_fn_ret_plus_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  pub async unsafe fn b<T>() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  pub async unsafe fn b<T>() -> impl Clone +\n  Send {\n", true),
        (LanguageId::Rust, "r32_f3_impl_pub_async_unsafe_fn_ret_plus_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  pub async unsafe fn b<T>() -> impl Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  pub async unsafe fn b<T>() -> impl Clone +\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_trait_assoc_where_plus_ok.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc<T>\n  where\n    T: Clone +\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc<T>\n  where\n    T: Clone +\n    Send;\n", true),
        (LanguageId::Rust, "r32_f3_trait_assoc_where_plus_bad.rs",
         "trait T {\n  fn a(x: [u32;\n  type Assoc<T>\n  where\n    T: Clone +\n",
         "trait T {\n  fn a(x: [u32;\n  type Assoc<T>\n  where\n    T: Clone +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_fn_where_no_plus_then_plus_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n  + Send,\n", true),
        (LanguageId::Rust, "r32_f3_impl_fn_where_no_plus_then_plus_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_trait_fn_where_no_plus_ok.rs",
         "trait Tr {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n",
         "trait Tr {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n  + Send;\n", true),
        (LanguageId::Rust, "r32_f3_trait_fn_where_no_plus_bad.rs",
         "trait Tr {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n",
         "trait Tr {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_fn_params_then_where_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone,\n", true),
        (LanguageId::Rust, "r32_f3_impl_fn_params_then_where_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_fn_ret_arrow_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n  i32 {\n    1\n  }\n}\n", true),
        (LanguageId::Rust, "r32_f3_impl_fn_ret_arrow_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n  let bad = ;\n  }\n}\n", false),
        (LanguageId::Rust, "r32_f3_impl_fn_ret_arrow_open_body_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n  i32 {\n    1\n", true),
        (LanguageId::Rust, "r32_f3_impl_fn_ret_arrow_open_body_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() ->\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_enum_unit_variant_after_attr_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B,\n", true),
        (LanguageId::Rust, "r32_f3_enum_unit_variant_after_attr_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_enum_discrim_unit_variant_after_attr_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B = 1,\n", true),
        (LanguageId::Rust, "r32_f3_enum_discrim_unit_variant_after_attr_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  bad: (;\n", false),
        (LanguageId::Rust, "r32_f3_impl_where_trailing_plus_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone +\n    Send +\n", true),
        (LanguageId::Rust, "r32_f3_impl_where_trailing_plus_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone +\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T)\n  where\n    T: Clone +\n    let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_where_no_trailing_op_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n    + Send,\n", true),
        (LanguageId::Rust, "r32_f3_impl_where_no_trailing_op_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n    let bad = ;\n", false),
        (LanguageId::Rust, "r32_f3_impl_where_open_brace_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n  {\n    1\n", true),
        (LanguageId::Rust, "r32_f3_impl_where_open_brace_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T>(x: T) -> i32\n  where\n    T: Clone\n  {\n    let bad = ;\n", false),
        // Negative Controls
        (LanguageId::Rust, "r32_neg_rs_impl_vec_paren_bad.rs",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  fn b() {}\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "r32_neg_rs_trait_vec_paren_bad.rs",
         "trait T {\n  fn f(x: Vec<(\n  fn a(&self);\n  bad: (;\n}\n",
         "trait T {\n  fn f(x: Vec<(\n  fn a(&self);\n  fn b(&self);\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "r32_neg_rs_impl_attr_unclosed_bad.rs",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  bad: (;\n}\n",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn a() {}\n  fn b() {}\n  bad: (;\n}\n", false),
        (LanguageId::Rust, "r32_neg_rs_impl_complete_fn_then_junk_bad.rs",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  foo\n",
         "impl Foo {\n  fn f(x: Vec<(\n  fn a() {}\n  foo\n  fn b() {}\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp_valid {
            failures.push(format!("{name}: exp={exp_valid} got={v:?}"));
        }
    }
    assert!(failures.is_empty(), "regression_iter32_all_clusters failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_all_clusters() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp_valid) in [
        // Cluster 1: Rust unclosed #[... / #![... attributes
        (LanguageId::Rust, "bug6_rs_impl_attr_same_line_fn_bad.rs",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "bug6_rs_impl_attr_same_line_fn_ok.rs",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "bug6b_rs_impl_attr_same_line_fn_eof_bad.rs",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n  let bad = ;\n", false),
        (LanguageId::Rust, "bug6b_rs_impl_attr_same_line_fn_eof_ok.rs",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n",
         "impl Foo {\n  #[cfg(unix fn b() {\n  let ok = 1;\n  let y = 2;\n", true),
        (LanguageId::Rust, "bug6c_rs_fn_attr_same_line_stmt_bad.rs",
         "fn outer() {\n  #[cfg(unix let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "bug6c_rs_fn_attr_same_line_stmt_ok.rs",
         "fn outer() {\n  #[cfg(unix let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix let ok = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "bug6d_rs_attr_last_group_let_bad.rs",
         "impl Foo {\n  #[cfg(unix\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix\n  let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "bug6d_rs_attr_last_group_let_ok.rs",
         "impl Foo {\n  #[cfg(unix\n  let ok = 1;\n}\n",
         "impl Foo {\n  #[cfg(unix\n  let ok = 1;\n  fn ok() {}\n}\n", true),
        (LanguageId::Rust, "bug6e_f1_v2_fn_unclosed_attr_inside_fn_ok.rs",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "bug6e_f1_v2_fn_unclosed_attr_inside_fn_bad.rs",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "bug6f_f1_v2c_fn_unclosed_attr_eof_ok.rs",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n  let y = 2;\n", true),
        (LanguageId::Rust, "bug6f_f1_v2c_fn_unclosed_attr_eof_bad.rs",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n  let bad = ;\n", false),
        (LanguageId::Rust, "f1_v2b_fn_unclosed_attr_no_prev_stmt_ok.rs",
         "fn outer() {\n  #[cfg(unix\n}\n",
         "fn outer() {\n  #[cfg(unix\n  let y = 2;\n}\n", false), // W2-M2b Iter 5 Option B1
        (LanguageId::Rust, "f1_v2b_fn_unclosed_attr_no_prev_stmt_bad.rs",
         "fn outer() {\n  #[cfg(unix\n}\n",
         "fn outer() {\n  #[cfg(unix\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "f1_v1_struct_unclosed_attr_field_ok.rs",
         "struct Foo {\n  #[cfg(unix\n  a: i32,\n}\n",
         "struct Foo {\n  #[cfg(unix\n  a: i32,\n  b: u32,\n}\n", true),
        (LanguageId::Rust, "f1_v1_struct_unclosed_attr_field_bad.rs",
         "struct Foo {\n  #[cfg(unix\n  a: i32,\n}\n",
         "struct Foo {\n  #[cfg(unix\n  a: i32,\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_inner_bang_attr_fn_ok.rs",
         "fn outer() {\n  #![allow(unused\n  let ok = 1;\n}\n",
         "fn outer() {\n  #![allow(unused\n  let ok = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "c1_inner_bang_attr_fn_bad.rs",
         "fn outer() {\n  #![allow(unused\n  let ok = 1;\n}\n",
         "fn outer() {\n  #![allow(unused\n  let ok = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_plus_6a_enum_unclosed_attr_bare_variant_ok.rs",
         "enum E {\n  #[cfg(unix\n  A,\n}\n",
         "enum E {\n  #[cfg(unix\n  A,\n  B\n}\n", true),
        (LanguageId::Rust, "c1_enum_unclosed_attr_variant_bad.rs",
         "enum E {\n  #[cfg(unix\n  A,\n}\n",
         "enum E {\n  #[cfg(unix\n  A,\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_trait_unclosed_attr_method_ok.rs",
         "trait T {\n  #[cfg(unix\n  fn a(&self);\n}\n",
         "trait T {\n  #[cfg(unix\n  fn a(&self);\n  fn b(&self);\n}\n", true),
        (LanguageId::Rust, "c1_trait_unclosed_attr_method_bad.rs",
         "trait T {\n  #[cfg(unix\n  fn a(&self);\n}\n",
         "trait T {\n  #[cfg(unix\n  fn a(&self);\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_fn_close_attr_ok.rs",
         "fn outer() {\n  #[cfg(unix\n",
         "fn outer() {\n  #[cfg(unix\n  )]\n  let x = 1;\n", true),
        (LanguageId::Rust, "c1_fn_close_attr_bad.rs",
         "fn outer() {\n  #[cfg(unix\n",
         "fn outer() {\n  #[cfg(unix\n  )]\n  let bad = ;\n", false),
        (LanguageId::Rust, "c1_top_level_unclosed_attr_ok.rs",
         "#[cfg(unix\n",
         "#[cfg(unix\nfn ok() {}\n", false), // W2-M2b Iter 5 Option B1
        (LanguageId::Rust, "c1_top_level_unclosed_attr_bad.rs",
         "#[cfg(unix\n",
         "#[cfg(unix\nlet bad = ;\n", false),
        (LanguageId::Rust, "c1_top_level_close_attr_ok.rs",
         "#[cfg(unix\n",
         "#[cfg(unix\n)]\nfn ok() {}\n", true),
        (LanguageId::Rust, "c1_top_level_close_attr_bad.rs",
         "#[cfg(unix\n",
         "#[cfg(unix\n)]\nlet bad = ;\n", false),
        (LanguageId::Rust, "c1_multi_unclosed_attr_ok.rs",
         "fn outer() {\n  #[cfg(unix\n  #![allow(unused\n",
         "fn outer() {\n  #[cfg(unix\n  #![allow(unused\n  let y = 2;\n", false), // W2-M2b Iter 5 Option B1
        (LanguageId::Rust, "c1_multi_unclosed_attr_bad.rs",
         "fn outer() {\n  #[cfg(unix\n  #![allow(unused\n",
         "fn outer() {\n  #[cfg(unix\n  #![allow(unused\n  let bad = ;\n", false),
        // Cluster 2: TS same-line decorated quoted class methods
        (LanguageId::TypeScript, "c2_cls_dec_quoted_nogen_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"(a: number) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"(a: number) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_dec_quoted_nogen_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"(a: number) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"(a: number) {\n    const x = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c2_cls_dec_quoted_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T, U>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T, U>(a: T) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_dec_quoted_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T, U>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T, U>(a: T) {\n    const x = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c2_cls_bare_dec_quoted_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec \"my-m\"<T extends (A | B), U = (C) => D>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec \"my-m\"<T extends (A | B), U = (C) => D>(a: T) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_bare_dec_quoted_gen_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec \"my-m\"<T extends (A | B), U = (C) => D>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec \"my-m\"<T extends (A | B), U = (C) => D>(a: T) {\n    const x = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c2_cls_multi_dec_quoted_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  @d1 @d2(1) \"my-m\"<T>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @d1 @d2(1) \"my-m\"<T>(a: T) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_member_dec_quoted_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec.sub(1) \"my-m\"(a: number) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec.sub(1) \"my-m\"(a: number) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_gen_dec_escaped_quote_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec<number>(1) 'a\\'b'<T>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec<number>(1) 'a\\'b'<T>(a: T) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_cls_mod_dec_quoted_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) public async * \"my-m\"<T>(a: T) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) public async * \"my-m\"<T>(a: T) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_ctrl_spaced_dec_call_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec (1) m(a: number) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec (1) m(a: number) {\n    const x = 1;\n    return x;\n", true),
        (LanguageId::TypeScript, "c2_ctrl_spaced_dec_call_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec (1) m(a: number) {\n    const x = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec (1) m(a: number) {\n    const x = 1;\n    ...other,\n", false),
        // Cluster 3: Object-type defaults/constraints & nested delimiters inside <...> + Combined 2+3
        (LanguageId::TypeScript, "c3_cls_quoted_obj_default_ok.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_cls_quoted_obj_default_bad.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c3_obj_quoted_obj_default_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_obj_quoted_obj_default_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c2_plus_c3_cls_dec_quoted_obj_default_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c2_plus_c3_cls_dec_quoted_obj_default_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }, U extends (A | B)>(\n    x: T\n  ) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "c3_cls_nested_delims_arrow_ok.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T extends { a: { b: number } }, U = [string, number], V = (x: number) => void>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T extends { a: { b: number } }, U = [string, number], V = (x: number) => void>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_obj_nested_delims_arrow_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T extends { a: { b: number } }, U = [string, number], V = (x: number) => void>(\n    x: T\n  ) {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T extends { a: { b: number } }, U = [string, number], V = (x: number) => void>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_cls_tpl_lit_inside_gen_ok.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T extends `p_${infer U}`, V = (x: U) => void>(\n    x: T\n  ) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T extends `p_${infer U}`, V = (x: U) => void>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_neg_lt_then_obj_then_if_ok.ts",
         "function f() {\n  const ok = a < b\n  const obj = { a: 1 }\n  if (x) {\n    const y = 1;\n",
         "function f() {\n  const ok = a < b\n  const obj = { a: 1 }\n  if (x) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "c3_neg_lt_then_obj_then_if_bad.ts",
         "function f() {\n  const ok = a < b\n  const obj = { a: 1 }\n  if (x) {\n    const y = 1;\n",
         "function f() {\n  const ok = a < b\n  const obj = { a: 1 }\n  if (x) {\n    const y = 1;\n    ...other,\n", false),
        // Cluster 4: 4a-4d TS generic/comparison disambiguation
        (LanguageId::TypeScript, "c4a_bug2_const_lt_no_eq_bad.ts",
         "const a<MY_TYPE, {\n",
         "const a<MY_TYPE, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_bug2b_export_const_lt_no_eq_bad.ts",
         "export const a<MY_TYPE, {\n",
         "export const a<MY_TYPE, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_bug2c_let_comma_lt_no_eq_bad.ts",
         "let x = 1, a<MY_TYPE, {\n",
         "let x = 1, a<MY_TYPE, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_declare_const_lt_no_eq_bad.ts",
         "declare const a<MY_TYPE, {\n",
         "declare const a<MY_TYPE, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_const_destr_lt_bad.ts",
         "const [a = 1]<T, {\n",
         "const [a = 1]<T, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_const_foo_string_bad.ts",
         "const foo<string, {\n",
         "const foo<string, {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_const_extends_bad.ts",
         "const a<T extends Foo & {\n",
         "const a<T extends Foo & {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4a_ctrl_const_type_annot_ok.ts",
         "const x: Foo<MY_TYPE, {\n",
         "const x: Foo<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4a_ctrl_const_type_annot_bad.ts",
         "const x: Foo<MY_TYPE, {\n",
         "const x: Foo<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4a_ctrl_let_comma_assign_ok.ts",
         "let x = 1, y = f<MY_TYPE, {\n",
         "let x = 1, y = f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4b_rev2_f2_const_comma_asi_f_ok.ts",
         "const a = 1, b = 2\nf<MY_TYPE, {\n",
         "const a = 1, b = 2\nf<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4b_rev2_f2_const_comma_asi_f_bad.ts",
         "const a = 1, b = 2\nf<MY_TYPE, {\n",
         "const a = 1, b = 2\nf<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4b_let_comma_asi_f_ok.ts",
         "let a = 1, b = 2\nf<MY_TYPE, {\n",
         "let a = 1, b = 2\nf<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4b_export_const_comma_asi_f_ok.ts",
         "export const a = 1, b = 2\nf<MY_TYPE, {\n",
         "export const a = 1, b = 2\nf<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4c_f2_v6_obj_in_asi_ok.ts",
         "const y = a < obj.in\n  foo<MY_TYPE, {\n",
         "const y = a < obj.in\n  foo<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4c_f2_v6_obj_in_asi_bad.ts",
         "const y = a < obj.in\n  foo<MY_TYPE, {\n",
         "const y = a < obj.in\n  foo<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4c_opt_chain_in_asi_ok.ts",
         "const y = a < obj?.in\n  foo<MY_TYPE, {\n",
         "const y = a < obj?.in\n  foo<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4c_super_type_asi_ok.ts",
         "const y = a < super.type\n  foo<MY_TYPE, {\n",
         "const y = a < super.type\n  foo<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4c_priv_in_asi_ok.ts",
         "const y = a < this.#in\n  foo<MY_TYPE, {\n",
         "const y = a < this.#in\n  foo<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4d_bug3_assign_foo_union_ok.ts",
         "r = foo<u | {\n",
         "r = foo<u | {\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4d_bug3_assign_foo_union_bad.ts",
         "r = foo<u | {\n",
         "r = foo<u | {\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4d_bug3b_this_r_assign_foo_union_ok.ts",
         "this.r = foo<u | {\n",
         "this.r = foo<u | {\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4d_bug3c_const_r_f_union_iface_ok.ts",
         "const r = f<u | {\n  a: string;\n",
         "const r = f<u | {\n  a: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4d_bug3c_const_r_f_union_iface_bad.ts",
         "const r = f<u | {\n  a: string;\n",
         "const r = f<u | {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4d_f2_v7_const_x_a_union_iface_ok.ts",
         "const x = a<u | {\n  a: string;\n",
         "const x = a<u | {\n  a: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4d_f2_v7_const_x_a_union_iface_bad.ts",
         "const x = a<u | {\n  a: string;\n",
         "const x = a<u | {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4d_f2_v5_lt_asi_a_limit_obj_ok.ts",
         "const y = a < b\n  a<LIMIT, {\n  k: (1 + *),\n",
         "const y = a < b\n  a<LIMIT, {\n  k: (1 + *),\n  m: 1,\n", true),
        (LanguageId::TypeScript, "c4d_f2_v5_lt_asi_a_limit_obj_bad.ts",
         "const y = a < b\n  a<LIMIT, {\n  k: (1 + *),\n",
         "const y = a < b\n  a<LIMIT, {\n  k: (1 + *),\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4d_f2_v5b_bare_a_limit_obj_ok.ts",
         "a<LIMIT, {\n  k: (1 + *),\n",
         "a<LIMIT, {\n  k: (1 + *),\n  m: 1,\n", true),
        (LanguageId::TypeScript, "c4d_f2_v5b_bare_a_limit_obj_bad.ts",
         "a<LIMIT, {\n  k: (1 + *),\n",
         "a<LIMIT, {\n  k: (1 + *),\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4d_rev2_f4_else_f_my_type_iface_ok.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n  a: string;\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  a: string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4d_rev2_f4_else_f_my_type_iface_bad.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n  a: string;\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4d_ctrl_else_str_obj_ok.ts",
         "else a<\"x\", {\n  k: (1 + *),\n",
         "else a<\"x\", {\n  k: (1 + *),\n  m: 1,\n", true),
        (LanguageId::JavaScript, "c4d_js_vs_ts_sep_ok.js",
         "const r = foo<u | {\n  k: 1,\n",
         "const r = foo<u | {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::JavaScript, "c4d_js_vs_ts_sep_bad.js",
         "const r = foo<u | {\n  k: 1,\n",
         "const r = foo<u | {\n  k: 1,\n  readonly b: number;\n", false),
        // Cluster 5: Mid-file & EOF corner cases
        (LanguageId::Rust, "c5_adv_mid_replace_ml_cmt_part_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    /* TODO\n       note */\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "c5_adv_mid_replace_ml_cmt_part_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    /* TODO\n       note */\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        (LanguageId::Rust, "c5_adv_mid_impl_replace_ml_cmt_with_good.rs",
         "impl Foo {\n  fn a(x: [u32;\n  /* TODO\n     line2 */\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() {}\n  fn h() {}\n}\n", true),
        (LanguageId::Rust, "c5_f1_v7_midfile_close_prefix_paren_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    // todo\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    x: i32) {}\n  fn h() {}\n}\n", true),
        (LanguageId::Rust, "c5_f1_v7_midfile_close_prefix_paren_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    // todo\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    x: i32)\n  fn h() {}\n}\n", false),
        (LanguageId::Rust, "c5_adv_mid_close_paren_pure_insert_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n  fn h() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(\n    x: i32) {}\n  fn h() {}\n}\n", true),
        (LanguageId::Rust, "c5_neg_mid_close_paren_new_suf_err_bad.rs",
         "fn f() {\n  let a = (\n  let b = 1;\n}\n",
         "fn f() {\n  let a = (\n  )\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "c5_f1_v6b_midfile_replace_code_expand_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Debug\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Clone,\n    V: Send,\n  >() {}\n}\n", true),
        (LanguageId::Rust, "c5_f1_v6b_midfile_replace_code_expand_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    U: Debug\n  >() {}\n}\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T,\n    let bad = ;\n  >() {}\n}\n", false),
        (LanguageId::TypeScript, "c5_bug1_ts_mid_replace_cmt_ok.ts",
         "const a = (;\n  // TODO\n",
         "const a = (;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "c5_bug1_ts_mid_replace_cmt_bad.ts",
         "const a = (;\n  // TODO\n",
         "const a = (;\n  let bad = ;\n", false),
        (LanguageId::JavaScript, "c5_bug1b_js_mid_replace_cmt_ok.js",
         "let a = (;\n  // TODO\n",
         "let a = (;\n  const c = 2;\n", true),
        (LanguageId::JavaScript, "c5_bug1b_js_mid_replace_cmt_bad.js",
         "let a = (;\n  // TODO\n",
         "let a = (;\n  let bad = ;\n", false),
        (LanguageId::Rust, "c5_bug1e_rs_mid_replace_cmt_inside_fn_ok.rs",
         "fn f() {\n  let a = (;\n  // TODO\n}\n",
         "fn f() {\n  let a = (;\n  let c = 2;\n}\n", true),
        (LanguageId::Rust, "c5_bug1e_rs_mid_replace_cmt_inside_fn_bad.rs",
         "fn f() {\n  let a = (;\n  // TODO\n}\n",
         "fn f() {\n  let a = (;\n  let bad = ;\n}\n", false),
        (LanguageId::TypeScript, "c5_ts_brack_semi_ok.ts",
         "const a = [;\n  // TODO\n",
         "const a = [;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "c5_ts_brace_semi_ok.ts",
         "const a = {;\n  // TODO\n",
         "const a = {;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "c5_neg_for_semi_bad.ts",
         "for (let i = 0;\n  // TODO\n",
         "for (let i = 0;\n  const c = 2;\n", false),
        (LanguageId::Rust, "c5_adv_rs_semi_arr_then_unclosed_attr_eof_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n  )]\n  fn b() {}\n", true),
        (LanguageId::Rust, "c5_adv_rs_semi_arr_then_unclosed_attr_eof_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n  )]\n  let bad = ;\n", false),
        (LanguageId::Rust, "c5_adv_rs_semi_arr_then_unclosed_attr_eof_noclose_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n",
         "impl Foo {\n  fn a(x: [u32;\n  #[cfg(unix\n  let bad = ;\n", false),
        // Cluster 6: Rust enum trailing unit variant & const-generic { 1 }
        (LanguageId::Rust, "c6a_bug4_f3_v1_enum_bare_unit_variant_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B\n}\n", true),
        (LanguageId::Rust, "c6a_enum_attr_then_bare_variant_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  #[attr]\n  B\n}\n", true),
        (LanguageId::Rust, "c6a_enum_discrim_no_comma_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B = 1\n}\n", true),
        (LanguageId::Rust, "c6a_enum_tuple_no_comma_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B(u32)\n}\n", true),
        (LanguageId::Rust, "c6a_enum_struct_no_comma_ok.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B { x: u32 }\n}\n", true),
        (LanguageId::Rust, "c6a_neg_enum_let_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c6a_neg_enum_fn_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  fn f() {}\n}\n", false),
        (LanguageId::Rust, "c6a_neg_enum_expr_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  x + 1\n}\n", false),
        (LanguageId::Rust, "c6a_neg_enum_two_bare_variants_bad.rs",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n",
         "enum E {\n  A([u32;\n  #[allow(dead_code)]\n  B\n  C\n}\n", false),
        (LanguageId::Rust, "c6a_ctrl_enum_arr_len_n_ok.rs",
         "enum E {\n  A([u32;\n  N\n",
         "enum E {\n  A([u32;\n  N\n  ]),\n", true),
        (LanguageId::Rust, "c6b_bug5_const_generic_where_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n  where\n    Self: Sized,\n", true),
        (LanguageId::Rust, "c6b_bug5_const_generic_where_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n  let bad = ;\n", false),
        (LanguageId::Rust, "c6b_bug5b_const_generic_body_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g() -> Bar<{ 1 }>\n  {\n    1\n  }\n}\n", true),
        (LanguageId::Rust, "c6b_f3_v5_fn_param_const_generic_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T: Foo<{ 1 }>>(x: T) ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T: Foo<{ 1 }>>(x: T) ->\n  T {\n    x\n  }\n}\n", true),
        (LanguageId::Rust, "c6b_f3_v5_fn_param_const_generic_bad.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T: Foo<{ 1 }>>(x: T) ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g<T: Foo<{ 1 }>>(x: T) ->\n  let bad = ;\n", false),
        (LanguageId::Rust, "c6b_const_cmp_then_fn_const_generic_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  const C: bool = a < b;\n  fn g() -> Bar<{ 1 }>\n",
         "impl Foo {\n  fn a(x: [u32;\n  const C: bool = a < b;\n  fn g() -> Bar<{ 1 }>\n  where\n    Self: Sized,\n", true),
        (LanguageId::Rust, "c6b_arr_const_generic_ok.rs",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(x: [u32; { 1 }]) ->\n",
         "impl Foo {\n  fn a(x: [u32;\n  fn g(x: [u32; { 1 }]) ->\n  i32 {\n    1\n  }\n}\n", true),
        // Iter 2 Explorer 1: TS generic arrow/tpl inside <...> & method inline return-type object literal
        (LanguageId::TypeScript, "r2_c1_cls_dec_quoted_nested_arrow_tpl_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T extends { a: { b: [number, (x: string) => { c: boolean }] } }, U = `p_${infer K}`, V = () => { d: number }>(\n    x: T\n  ): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T extends { a: { b: [number, (x: string) => { c: boolean }] } }, U = `p_${infer K}`, V = () => { d: number }>(\n    x: T\n  ): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c1_cls_dec_quoted_nested_arrow_tpl_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T extends { a: { b: [number, (x: string) => { c: boolean }] } }, U = `p_${infer K}`, V = () => { d: number }>(\n    x: T\n  ): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T extends { a: { b: [number, (x: string) => { c: boolean }] } }, U = `p_${infer K}`, V = () => { d: number }>(\n    x: T\n  ): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c1_obj_quoted_arrow_tpl_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U extends `p_${infer K}`, V = [string, (x: number) => { b: number }]>(\n    x: T\n  ) {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U extends `p_${infer K}`, V = [string, (x: number) => { b: number }]>(\n    x: T\n  ) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r2_c1_obj_quoted_arrow_tpl_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U extends `p_${infer K}`, V = [string, (x: number) => { b: number }]>(\n    x: T\n  ) {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U extends `p_${infer K}`, V = [string, (x: number) => { b: number }]>(\n    x: T\n  ) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c1_cls_curried_arrow_generic_ok.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = (a: number) => (b: string) => { c: boolean }, U = `p_${infer K}`>(x: T) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = (a: number) => (b: string) => { c: boolean }, U = `p_${infer K}`>(x: T) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r2_c1_cls_curried_arrow_generic_bad.ts",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = (a: number) => (b: string) => { c: boolean }, U = `p_${infer K}`>(x: T) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  'my-m'<T = (a: number) => (b: string) => { c: boolean }, U = `p_${infer K}`>(x: T) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c1_cls_cond_type_arrow_generic_ok.ts",
         "class C {\n  broken = (1 + *)\n  m<T extends infer R ? (x: R) => { a: R } : () => { b: never }, U = string>(x: T) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<T extends infer R ? (x: R) => { a: R } : () => { b: never }, U = string>(x: T) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r2_c1_cls_cond_type_arrow_generic_bad.ts",
         "class C {\n  broken = (1 + *)\n  m<T extends infer R ? (x: R) => { a: R } : () => { b: never }, U = string>(x: T) {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  m<T extends infer R ? (x: R) => { a: R } : () => { b: never }, U = string>(x: T) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c1_ctrl_lt_then_arrow_fn_ok.ts",
         "const ok = a < b\nconst fn = () => {\n  const y = 1;\n",
         "const ok = a < b\nconst fn = () => {\n  const y = 1;\n  return y;\n", true),
        (LanguageId::TypeScript, "r2_c1_ctrl_lt_then_arrow_fn_bad.ts",
         "const ok = a < b\nconst fn = () => {\n  const y = 1;\n",
         "const ok = a < b\nconst fn = () => {\n  const y = 1;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r2_c1_ctrl_lt_then_arrow_fn_closed_then_if_ok.ts",
         "function f() {\n  const ok = a < b\n  const fn = () => {\n    return 1;\n  }\n  if (x) {\n    const y = 1;\n",
         "function f() {\n  const ok = a < b\n  const fn = () => {\n    return 1;\n  }\n  if (x) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r2_c1_ctrl_lt_then_arrow_fn_closed_then_if_bad.ts",
         "function f() {\n  const ok = a < b\n  const fn = () => {\n    return 1;\n  }\n  if (x) {\n    const y = 1;\n",
         "function f() {\n  const ok = a < b\n  const fn = () => {\n    return 1;\n  }\n  if (x) {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_cls_unquoted_ret_obj_ok.ts",
         "class C {\n  broken = (1 + *)\n  myM(\n    x: number\n  ): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  myM(\n    x: number\n  ): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_cls_unquoted_ret_obj_bad.ts",
         "class C {\n  broken = (1 + *)\n  myM(\n    x: number\n  ): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  myM(\n    x: number\n  ): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_cls_dec_quoted_gen_ret_obj_ok.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }>(x: T): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }>(x: T): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_cls_dec_quoted_gen_ret_obj_bad.ts",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }>(x: T): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  @dec(1) \"my-m\"<T = { a: number }>(x: T): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_obj_unquoted_ret_obj_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_obj_unquoted_ret_obj_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_obj_quoted_gen_ret_obj_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U = `p_${infer K}`>(x: T): { ok: number } {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U = `p_${infer K}`>(x: T): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_obj_quoted_gen_ret_obj_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U = `p_${infer K}`>(x: T): { ok: number } {\n    const y = 1;\n",
         "const obj = {\n  broken: (1 + *),\n  'my-m'<T = () => { a: number }, U = `p_${infer K}`>(x: T): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_cls_ret_obj_union_ok.ts",
         "class C {\n  broken = (1 + *)\n  myM(x: number): { a: number } & { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  myM(x: number): { a: number } & { ok: number } {\n    const y = 1;\n    return { a: y, ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_cls_ret_obj_union_bad.ts",
         "class C {\n  broken = (1 + *)\n  myM(x: number): { a: number } & { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  myM(x: number): { a: number } & { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_bnd_prev_member_then_next_ret_obj_ok.ts",
         "class C {\n  broken = (1 + *)\n  prev() { return 1; }\n  next(): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  prev() { return 1; }\n  next(): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_bnd_prev_member_then_next_ret_obj_bad.ts",
         "class C {\n  broken = (1 + *)\n  prev() { return 1; }\n  next(): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  prev() { return 1; }\n  next(): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_bnd_prev_ret_obj_member_then_quoted_ok.ts",
         "class C {\n  broken = (1 + *)\n  prev(): { r: number } { return { r: 1 }; }\n  \"next-m\"(): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  prev(): { r: number } { return { r: 1 }; }\n  \"next-m\"(): { ok: number } {\n    const y = 1;\n    return { ok: y };\n", true),
        (LanguageId::TypeScript, "r2_c2_bnd_prev_ret_obj_member_then_quoted_bad.ts",
         "class C {\n  broken = (1 + *)\n  prev(): { r: number } { return { r: 1 }; }\n  \"next-m\"(): { ok: number } {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  prev(): { r: number } { return { r: 1 }; }\n  \"next-m\"(): { ok: number } {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_bnd_const_obj_then_bare_block_ok.ts",
         "function f() {\n  const obj = { a: 1 }\n  {\n    const y = 1;\n",
         "function f() {\n  const obj = { a: 1 }\n  {\n    const y = 1;\n    return;\n", true),
        (LanguageId::TypeScript, "r2_c2_bnd_const_obj_then_bare_block_bad.ts",
         "function f() {\n  const obj = { a: 1 }\n  {\n    const y = 1;\n",
         "function f() {\n  const obj = { a: 1 }\n  {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_bnd_ternary_obj_then_bare_block_ok.ts",
         "function f(c: boolean) {\n  const x = c ? (1) : { a: 1 }\n  {\n    const y = 1;\n",
         "function f(c: boolean) {\n  const x = c ? (1) : { a: 1 }\n  {\n    const y = 1;\n    return;\n", true),
        (LanguageId::TypeScript, "r2_c2_bnd_ternary_obj_then_bare_block_bad.ts",
         "function f(c: boolean) {\n  const x = c ? (1) : { a: 1 }\n  {\n    const y = 1;\n",
         "function f(c: boolean) {\n  const x = c ? (1) : { a: 1 }\n  {\n    const y = 1;\n    ...other,\n", false),
        (LanguageId::TypeScript, "r2_c2_bnd_prop_type_then_bare_block_bad.ts",
         "class C {\n  prop: { a: number }\n  {\n",
         "class C {\n  prop: { a: number }\n  {\n  ...other,\n", false),
        // Iter 2 Explorer 2: TS generic/object-brace disambiguation & Option A r30_obj_x_number
        (LanguageId::TypeScript, "c4_adv_myfn_foo_u_pipe_obj_ok.ts",
         "myFn = foo<u |\n  {\n    a: 1 + 2,\n",
         "myFn = foo<u |\n  {\n    a: 1 + 2,\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "c4_adv_myfn_foo_u_pipe_obj_bad.ts",
         "myFn = foo<u |\n  {\n    a: 1 + 2,\n",
         "myFn = foo<u |\n  {\n    a: 1 + 2,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4_adv_myfn_foo_u_pipe_bad_prop.ts",
         "myFn = foo<u |\n  {\n    a: 1 + *,\n",
         "myFn = foo<u |\n  {\n    a: 1 + *,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4_adv_r_foo_u_pipe_obj_ok.ts",
         "r = foo<u |\n  {\n    a: 1 + 2,\n",
         "r = foo<u |\n  {\n    a: 1 + 2,\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "c4_adv_r_foo_u_pipe_obj_bad.ts",
         "r = foo<u |\n  {\n    a: 1 + 2,\n",
         "r = foo<u |\n  {\n    a: 1 + 2,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4_adv_const_r_foo_u_pipe_obj_ok.ts",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "c4_adv_const_r_foo_u_pipe_obj_bad.ts",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4_adv_let_r_foo_u_pipe_obj_ok.ts",
         "let r = foo<u |\n  {\n    a: 1 + 2,\n",
         "let r = foo<u |\n  {\n    a: 1 + 2,\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "c4_adv_let_r_foo_u_pipe_obj_bad.ts",
         "let r = foo<u |\n  {\n    a: 1 + 2,\n",
         "let r = foo<u |\n  {\n    a: 1 + 2,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "c4_adv_r_foo_u_pipe_nested_iface_ok.ts",
         "r = foo<u |\n  {\n    a: string;\n    nested: {\n",
         "r = foo<u |\n  {\n    a: string;\n    nested: {\n      readonly x: number;\n", true),
        (LanguageId::TypeScript, "c4_adv_r_foo_u_pipe_nested_iface_bad.ts",
         "r = foo<u |\n  {\n    a: string;\n    nested: {\n",
         "r = foo<u |\n  {\n    a: string;\n    nested: {\n      ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_const_r_foo_u_pipe_nested_iface_ok.ts",
         "const r = foo<u |\n  {\n    a: string;\n    nested: {\n",
         "const r = foo<u |\n  {\n    a: string;\n    nested: {\n      readonly x: number;\n", true),
        (LanguageId::TypeScript, "c4_adv_const_r_foo_u_pipe_nested_obj_ok.ts",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    nested: {\n      x: 1 + 2,\n", true),
        (LanguageId::TypeScript, "c4_adv_const_r_foo_u_pipe_nested_obj_bad.ts",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    a: 1 + 2,\n    nested: {\n      readonly x: number;\n", false),
        (LanguageId::TypeScript, "c4_rev2_f1_const_comma_asi_f_limit_k1_closed_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n  k2: 1 + 2,\n};\n", true),
        (LanguageId::TypeScript, "c4_rev2_f1_const_comma_asi_f_limit_k1_closed_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n  readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "c4_rev2_f1_const_comma_asi_f_limit_k1_open_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n  ...other,\n", true),
        (LanguageId::TypeScript, "c4_rev2_f1_const_comma_asi_f_limit_k1_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "c4_rev2_f1_const_comma_asi_f_limit_k1_stmt_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1,\n  const bad = ;\n", false),
        (LanguageId::TypeScript, "c4_adv_f_my_type_semi_without_gt_bad.ts",
         "f<MY_TYPE, {\n  a: string;\n",
         "f<MY_TYPE, {\n  a: string;\n  readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "c4_adv_f_my_type_semi_with_gt_ok.ts",
         "f<MY_TYPE, {\n  a: string;\n",
         "f<MY_TYPE, {\n  a: string;\n  readonly b: number;\n}>();\n", true),
        (LanguageId::TypeScript, "c4_adv_const_x_lt_y_comma_b_lt_my_type_bad.ts",
         "const a = x<y, b<MY_TYPE, {\n  a: string;\n",
         "const a = x<y, b<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_if_nl_ok.ts",
         "if (a < b)\n  c<T, {\n  a: (1 + *),\n",
         "if (a < b)\n  c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_if_nl_bad.ts",
         "if (a < b)\n  c<T, {\n  a: (1 + *),\n",
         "if (a < b)\n  c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_if_same_ok.ts",
         "if (a < b) c<T, {\n  a: (1 + *),\n",
         "if (a < b) c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_if_same_bad.ts",
         "if (a < b) c<T, {\n  a: (1 + *),\n",
         "if (a < b) c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_else_ok.ts",
         "if (cond) {} else c<T, {\n  a: (1 + *),\n",
         "if (cond) {} else c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_else_bad.ts",
         "if (cond) {} else c<T, {\n  a: (1 + *),\n",
         "if (cond) {} else c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_while_ok.ts",
         "while (a < b)\n  c<T, {\n  a: (1 + *),\n",
         "while (a < b)\n  c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_while_bad.ts",
         "while (a < b)\n  c<T, {\n  a: (1 + *),\n",
         "while (a < b)\n  c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_return_ok.ts",
         "function f() {\n  return c<T, {\n  a: (1 + *),\n",
         "function f() {\n  return c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_return_bad.ts",
         "function f() {\n  return c<T, {\n  a: (1 + *),\n",
         "function f() {\n  return c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_await_ok.ts",
         "async function f() {\n  await c<T, {\n  a: (1 + *),\n",
         "async function f() {\n  await c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_await_bad.ts",
         "async function f() {\n  await c<T, {\n  a: (1 + *),\n",
         "async function f() {\n  await c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_adv_c_T_arrow_ok.ts",
         "const f = () => c<T, {\n  a: (1 + *),\n",
         "const f = () => c<T, {\n  a: (1 + *),\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_adv_c_T_arrow_bad.ts",
         "const f = () => c<T, {\n  a: (1 + *),\n",
         "const f = () => c<T, {\n  a: (1 + *),\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_ctrl_c_LIMIT_if_ok.ts",
         "if (a < b) c<LIMIT, {\n  k: (1 + *),\n",
         "if (a < b) c<LIMIT, {\n  k: (1 + *),\n  ...other,\n", true),
        (LanguageId::TypeScript, "c4_ctrl_c_LIMIT_if_bad.ts",
         "if (a < b) c<LIMIT, {\n  k: (1 + *),\n",
         "if (a < b) c<LIMIT, {\n  k: (1 + *),\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4_ctrl_c_LIMIT_return_ok.ts",
         "function f() {\n  return c<LIMIT, {\n    k: (1 + *),\n",
         "function f() {\n  return c<LIMIT, {\n    k: (1 + *),\n    ...other,\n", true),
        (LanguageId::TypeScript, "c4_ctrl_c_LIMIT_return_bad.ts",
         "function f() {\n  return c<LIMIT, {\n    k: (1 + *),\n",
         "function f() {\n  return c<LIMIT, {\n    k: (1 + *),\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r30_obj_x_number.ts",
         "const obj = {\n  a: Foo<{\n",
         "const obj = {\n  a: Foo<{\n    x: number;\n", true),
        // Iter 2 Explorer 3: Semi-terminated broken openers, Rust nested attrs, & Rust enum A = (1 + #[attr] B
        (LanguageId::TypeScript, "c5_adv_ts_mid_semi_paren_expr_ok.ts",
         "function f() {\n  const a = (1;\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  const a = (1;\n  const c = 2;\n  const b = 1;\n}\n", true),
        (LanguageId::TypeScript, "c5_adv_ts_mid_semi_paren_expr_bad.ts",
         "function f() {\n  const a = (1;\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  const a = (1;\n  let bad = ;\n  const b = 1;\n}\n", false),
        (LanguageId::TypeScript, "c5_adv_ts_mid_semi_paren_call_ok.ts",
         "function f() {\n  const a = (foo();\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  const a = (foo();\n  const c = 2;\n  const b = 1;\n}\n", true),
        (LanguageId::TypeScript, "c5_adv_ts_mid_semi_brack_expr_ok.ts",
         "function f() {\n  const a = [1;\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  const a = [1;\n  const c = 2;\n  const b = 1;\n}\n", true),
        (LanguageId::TypeScript, "c5_adv_ts_top_semi_paren_tokens_ok.ts",
         "const a = (1 + *;\n  // TODO\n",
         "const a = (1 + *;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "c5_adv_ts_top_semi_paren_tokens_bad.ts",
         "const a = (1 + *;\n  // TODO\n",
         "const a = (1 + *;\n  let bad = ;\n", false),
        (LanguageId::TypeScript, "c5_adv_ts_top_semi_brack_tokens_ok.ts",
         "const a = [1, *;\n  // TODO\n",
         "const a = [1, *;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "c5_adv_ts_top_semi_brack_tokens_bad.ts",
         "const a = [1, *;\n  // TODO\n",
         "const a = [1, *;\n  let bad = ;\n", false),
        (LanguageId::Rust, "c5_adv_rs_mid_semi_paren_expr_ok.rs",
         "fn f() {\n  let a = (1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = (1;\n  let c = 2;\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "c5_adv_rs_fn_semi_paren_tokens_ok.rs",
         "fn f() {\n  let a = (1 + *;\n  // TODO\n}\n",
         "fn f() {\n  let a = (1 + *;\n  let c = 2;\n}\n", true),
        (LanguageId::Rust, "c5_adv_rs_fn_semi_paren_tokens_bad.rs",
         "fn f() {\n  let a = (1 + *;\n  // TODO\n}\n",
         "fn f() {\n  let a = (1 + *;\n  let bad = ;\n}\n", false),
        (LanguageId::Cpp, "c5_adv_cpp_mid_semi_paren_expr_ok.cpp",
         "void f() {\n  int a = (1;\n  // TODO\n  int b = 1;\n}\n",
         "void f() {\n  int a = (1;\n  int c = 2;\n  int b = 1;\n}\n", true),
        (LanguageId::Java, "c5_adv_java_mid_semi_paren_expr_ok.java",
         "class C {\n  void f() {\n    int a = (1;\n    // TODO\n    int b = 1;\n  }\n}\n",
         "class C {\n  void f() {\n    int a = (1;\n    int c = 2;\n    int b = 1;\n  }\n}\n", true),
        (LanguageId::TypeScript, "c5_ctrl_ts_type_brace_semi_ok.ts",
         "type T = { a: number;\n",
         "type T = { a: number;\n  readonly b: string;\n}\n", true),
        (LanguageId::TypeScript, "c5_ctrl_ts_type_brace_semi_bad.ts",
         "type T = { a: number;\n",
         "type T = { a: number;\n  let bad = ;\n}\n", false),
        (LanguageId::TypeScript, "c5_ctrl_ts_iface_brace_semi_bad.ts",
         "interface I { a: number;\n",
         "interface I { a: number;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c5_ctrl_rs_trait_semi_bad.rs",
         "trait T { fn a();\n",
         "trait T { fn a();\n  let bad = ;\n}\n", false),
        (LanguageId::TypeScript, "c5_ctrl_ts_arrow_in_paren_semi_ok.ts",
         "foo(() => { const x = 1;\n",
         "foo(() => { const x = 1;\n  return x;\n});\n", true),
        (LanguageId::Rust, "c1_adv_rs_multiline_nested_attr_fn_ok.rs",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let x = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "c1_adv_rs_multiline_nested_attr_fn_bad.rs",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let x = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_adv_rs_nested_attr_fn_no_prev_stmt_ok.rs",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n}\n",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let y = 2;\n}\n", false), // W2-M2b Iter 5 Option B1
        (LanguageId::Rust, "c1_adv_rs_nested_attr_fn_no_prev_stmt_bad.rs",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n}\n",
         "fn outer() {\n  #[cfg(all(\n    any(\n      unix\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_adv_rs_nested_attr_2line_fn_ok.rs",
         "fn outer() {\n  #[cfg(all(\n    any(\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n    any(\n  let x = 1;\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "c1_adv_rs_inner_attr_nested_fn_bad.rs",
         "fn outer() {\n  #![cfg(all(\n    any(\n      unix\n  let x = 1;\n}\n",
         "fn outer() {\n  #![cfg(all(\n    any(\n      unix\n  let x = 1;\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c1_adv_rs_attr_no_close_insert_in_all_ok.rs",
         "fn outer() {\n  #[cfg(all(\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n  unix,\n  let x = 1;\n}\n", true),
        (LanguageId::Rust, "c1_adv_rs_attr_no_close_insert_let_bad.rs",
         "fn outer() {\n  #[cfg(all(\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n  let bad = ;\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "c1_adv_rs_attr_no_close_insert_colon_bad.rs",
         "fn outer() {\n  #[cfg(all(\n  let x = 1;\n}\n",
         "fn outer() {\n  #[cfg(all(\n  bad: (;\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "c1_adv_rs_impl_attr_no_close_arg_ok.rs",
         "impl Foo {\n  #[cfg(all(\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(all(\n  unix,\n  fn a() {}\n}\n", true),
        (LanguageId::Rust, "c1_adv_rs_impl_attr_no_close_let_bad.rs",
         "impl Foo {\n  #[cfg(all(\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(all(\n  let bad = ;\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "c6a_adv_rs_enum_eq_paren_attr_bare_variant_ok.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B\n}\n", true),
        (LanguageId::Rust, "c6a_adv_rs_enum_eq_paren_attr_let_bad.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c6a_adv_rs_enum_eq_paren_no_attr_bare_variant_bad.rs",
         "enum E {\n  A = (1 +\n",
         "enum E {\n  A = (1 +\n  B\n}\n", false),
        (LanguageId::Rust, "c6a_adv_rs_enum_eq_paren_no_attr_close_ok.rs",
         "enum E {\n  A = (1 +\n",
         "enum E {\n  A = (1 +\n  2),\n  B\n}\n", true),
        (LanguageId::Rust, "c6a_adv_rs_enum_eq_paren_attr_tuple_cont_ok.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B(i32,\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B(i32,\n    u64,\n", true),
        // W2-M2b Iter 3 Explorer 1: 3-declarator var_decl stmt_cut, empty-tail <IDENT, {, body signals, & depth-2 Foo<{
        (LanguageId::TypeScript, "c4_adv_let_3decl_b1_c_my_type_bad.ts",
         "let a = x<y, b = 1, c<MY_TYPE, {\n  a: string;\n",
         "let a = x<y, b = 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4_adv_const_3decl_bz_c_my_type_bad.ts",
         "const a = x<y, b = z, c<MY_TYPE, {\n  a: string;\n",
         "const a = x<y, b = z, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4_adv_const_3decl_b1_c_T_bad.ts",
         "const a = x<y, b = 1, c<T, {\n  a: string;\n",
         "const a = x<y, b = 1, c<T, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "c4_adv_const_3decl_b1_c_my_type_empty_spread_bad.ts",
         "const a = x<y, b = 1, c<MY_TYPE, {\n",
         "const a = x<y, b = 1, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_ctrl_const_3decl_c_eq_f_my_type_ok.ts",
         "const a = x<y, b = 1, c = f<MY_TYPE, {\n  a: string;\n",
         "const a = x<y, b = 1, c = f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_ctrl_const_3decl_c_eq_f_my_type_bad.ts",
         "const a = x<y, b = 1, c = f<MY_TYPE, {\n  a: string;\n",
         "const a = x<y, b = 1, c = f<MY_TYPE, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "c4_ctrl_let_2decl_y_eq_f_my_type_ok.ts",
         "let x = 1, y = f<MY_TYPE, {\n  a: string;\n",
         "let x = 1, y = f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "c4_ctrl_let_2decl_y_eq_f_my_type_bad.ts",
         "let x = 1, y = f<MY_TYPE, {\n  a: string;\n",
         "let x = 1, y = f<MY_TYPE, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "ts_else_f_my_type_empty_body_tail_ro_ok.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_else_f_my_type_empty_body_tail_spread_ok.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_else_f_my_type_empty_body_tail_stmt_bad.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  const bad = ;\n", false),
        (LanguageId::TypeScript, "ts_else_f_my_type_empty_body_tail_no_gt_bad.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  readonly b: string;\n};\n", false),
        (LanguageId::TypeScript, "ts_else_f_my_type_empty_body_tail_spread_gt_bad.ts",
         "if (x) a < b\nelse f<MY_TYPE, {\n",
         "if (x) a < b\nelse f<MY_TYPE, {\n  ...other,\n}>();\n", false),
        (LanguageId::TypeScript, "ts_arrow_f_my_type_empty_tail_ro_ok.ts",
         "const g = () => f<MY_TYPE, {\n",
         "const g = () => f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_return_f_my_type_empty_tail_ro_ok.ts",
         "function g() {\n  return f<MY_TYPE, {\n",
         "function g() {\n  return f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_await_f_my_type_empty_tail_ro_ok.ts",
         "async function g() {\n  await f<MY_TYPE, {\n",
         "async function g() {\n  await f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_if_f_my_type_empty_tail_ro_ok.ts",
         "if (a < b) f<MY_TYPE, {\n",
         "if (a < b) f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_while_f_my_type_empty_tail_ro_ok.ts",
         "while (a < b) f<MY_TYPE, {\n",
         "while (a < b) f<MY_TYPE, {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_else_foo_my_type_empty_tail_spread_ok.ts",
         "if (x) a < b\nelse foo<MY_TYPE, {\n",
         "if (x) a < b\nelse foo<MY_TYPE, {\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_else_foo_my_type_empty_tail_spread_gt_bad.ts",
         "if (x) a < b\nelse foo<MY_TYPE, {\n",
         "if (x) a < b\nelse foo<MY_TYPE, {\n  ...other,\n}>();\n", false),
        (LanguageId::TypeScript, "ts_else_f_MyType_empty_tail_spread_ok.ts",
         "if (x) a < b\nelse f<MyType, {\n",
         "if (x) a < b\nelse f<MyType, {\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_else_c_LIMIT_empty_tail_spread_ok.ts",
         "if (x) a < b\nelse c<LIMIT, {\n",
         "if (x) a < b\nelse c<LIMIT, {\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_else_c_LIMIT_empty_tail_ro_ok.ts",
         "if (x) a < b\nelse c<LIMIT, {\n",
         "if (x) a < b\nelse c<LIMIT, {\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "ts_else_c_LIMIT_empty_tail_no_gt_bad.ts",
         "if (x) a < b\nelse c<LIMIT, {\n",
         "if (x) a < b\nelse c<LIMIT, {\n  readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "ts_f_LIMIT_bang_k2_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_bang_spread_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_bang_no_gt_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n  readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "ts_f_LIMIT_ident_k2_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: foo,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: foo,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_ident_spread_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: foo,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: foo,\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_arr_k2_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: [1, 2],\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: [1, 2],\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_arr_spread_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: [1, 2],\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: [1, 2],\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_obj_k2_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: { x: 1 },\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: { x: 1 },\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_obj_spread_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: { x: 1 },\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: { x: 1 },\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_float_k2_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_float_spread_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n  ...other,\n", true),
        (LanguageId::TypeScript, "ts_f_LIMIT_float_no_gt_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: 1.5,\n  readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "ts_export_let_f_my_type_string_comma_ro_ok.ts",
         "export let x = f<MY_TYPE, {\n  a: string,\n",
         "export let x = f<MY_TYPE, {\n  a: string,\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "ts_const_r_foo_u_pipe_str_arith_ok.ts",
         "const r = foo<u |\n  {\n    a: \"hello\",\n",
         "const r = foo<u |\n  {\n    a: \"hello\",\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_const_r_foo_u_pipe_str_spread_ok.ts",
         "const r = foo<u |\n  {\n    a: \"hello\",\n",
         "const r = foo<u |\n  {\n    a: \"hello\",\n    ...other,\n", true),
        (LanguageId::TypeScript, "ts_const_r_foo_u_pipe_str_ro_ok.ts",
         "const r = foo<u |\n  {\n    a: \"hello\",\n",
         "const r = foo<u |\n  {\n    a: \"hello\",\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "ts_const_r_foo_u_pipe_str_no_gt_bad.ts",
         "const r = foo<u |\n  {\n    a: \"hello\",\n",
         "const r = foo<u |\n  {\n    a: \"hello\",\n    readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "ts_const_r_foo_u_pipe_str_arith_gt_bad.ts",
         "const r = foo<u |\n  {\n    a: \"hello\",\n",
         "const r = foo<u |\n  {\n    a: \"hello\",\n    b: 1 + 2,\n}>();\n", false),
        (LanguageId::TypeScript, "ts_r_foo_u_pipe_neg1_arith_ok.ts",
         "r = foo<u |\n  {\n    a: -1,\n",
         "r = foo<u |\n  {\n    a: -1,\n    b: 1 + 2,\n", true),
        (LanguageId::TypeScript, "ts_r_foo_u_pipe_neg1_ro_ok.ts",
         "r = foo<u |\n  {\n    a: -1,\n",
         "r = foo<u |\n  {\n    a: -1,\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "ts_r_foo_u_pipe_neg1_no_gt_bad.ts",
         "r = foo<u |\n  {\n    a: -1,\n",
         "r = foo<u |\n  {\n    a: -1,\n    readonly b: number;\n};\n", false),
        (LanguageId::TypeScript, "c4_adv_obj_depth2_foo_spread_ok.ts",
         "const obj = {\n  outer: {\n    a: Foo<{\n",
         "const obj = {\n  outer: {\n    a: Foo<{\n      ...other,\n", true),
        (LanguageId::TypeScript, "c4_adv_obj_depth2_foo_x_number_ok.ts",
         "const obj = {\n  outer: {\n    a: Foo<{\n",
         "const obj = {\n  outer: {\n    a: Foo<{\n      x: number;\n", true),
        (LanguageId::TypeScript, "c4_adv_obj_depth2_foo_closed_no_gt_bad.ts",
         "const obj = {\n  outer: {\n    a: Foo<{\n",
         "const obj = {\n  outer: {\n    a: Foo<{\n      x: number;\n    }\n  }\n};\n", false),
        // Iter 3 Explorer 2: TS/JS missing-arrow function headers
        (LanguageId::TypeScript, "r3_c2_ts_const_f_ret_no_arrow_bad.ts",
         "const f = (x: number): { ok: number } {\n",
         "const f = (x: number): { ok: number } {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r3_c2_ts_const_f_ret_no_arrow_closed_bad.ts",
         "const f = (x: number): { ok: number } {\n",
         "const f = (x: number): { ok: number } {\n  ...other,\n}\n", false),
        (LanguageId::TypeScript, "r3_c2_ts_const_f_no_ret_no_arrow_bad.ts",
         "const f = (x: number) {\n",
         "const f = (x: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r3_c2_ts_let_f_ret_no_arrow_bad.ts",
         "let f = (x: number): { ok: number } {\n",
         "let f = (x: number): { ok: number } {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r3_c2_ts_var_f_no_arrow_bad.ts",
         "var f = (x: number) {\n",
         "var f = (x: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r3_c2_ts_const_f_async_no_arrow_bad.ts",
         "const f = async (x: number) {\n",
         "const f = async (x: number) {\n  ...other,\n", false),
        (LanguageId::JavaScript, "r3_c2_js_const_f_no_arrow_bad.js",
         "const f = (x) {\n",
         "const f = (x) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r3_c2_ctrl_obj_method_ret_obj_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n",
         "const obj = {\n  broken: (1 + *),\n  m(x: number): { ok: number } {\n    return { ok: x };\n", true),
        (LanguageId::TypeScript, "r3_c2_ctrl_fn_decl_ret_obj_ok.ts",
         "function f(x: number): { ok: number } {\n  const y = 1;\n",
         "function f(x: number): { ok: number } {\n  const y = 1;\n  return { ok: y };\n", true),
        (LanguageId::TypeScript, "r3_c2_ctrl_const_f_arrow_ret_obj_ok.ts",
         "const f = (x: number): { ok: number } => {\n  const y = 1;\n",
         "const f = (x: number): { ok: number } => {\n  const y = 1;\n  return { ok: y };\n", true),
        (LanguageId::TypeScript, "r3_c2_ctrl_ternary_colon_obj_ok.ts",
         "const x = cond ? (1) : {\n  a: 1,\n",
         "const x = cond ? (1) : {\n  a: 1,\n  ...other,\n", true),
        // Iter 3 Explorer 2: Rust mid-file semi-terminated [1 + *;, [1 +;, [1;, [1 + 2;
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_star_ok.rs",
         "fn f() {\n  let a = [1 + *;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1 + *;\n  let c = 2;\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_star_bad.rs",
         "fn f() {\n  let a = [1 + *;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1 + *;\n  let bad = ;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_plus_ok.rs",
         "fn f() {\n  let a = [1 +;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1 +;\n  let c = 2;\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_1_ok.rs",
         "fn f() {\n  let a = [1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1;\n  let c = 2;\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_1_bad.rs",
         "fn f() {\n  let a = [1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1;\n  let bad = ;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_add_ok.rs",
         "fn f() {\n  let a = [1 + 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1 + 2;\n  let c = 2;\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r3_c5_rs_mid_semi_brack_add_bad.rs",
         "fn f() {\n  let a = [1 + 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let a = [1 + 2;\n  let bad = ;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r3_c5_rs_ctrl_repeat_arr_const_ok.rs",
         "const X: [u8; 4] = [0;\n",
         "const X: [u8; 4] = [0;\n  4];\n", true),
        (LanguageId::Rust, "r3_c5_rs_ctrl_repeat_arr_add_ok.rs",
         "fn f() {\n  let a = [1 + 2;\n",
         "fn f() {\n  let a = [1 + 2;\n  4];\n", true),
        (LanguageId::Rust, "r3_c5_rs_ctrl_repeat_arr_midfile_bad.rs",
         "fn f() {\n  let a = [1 + 2;\n  // TODO\n  4];\n}\n",
         "fn f() {\n  let a = [1 + 2;\n  let c = 2;\n  4];\n}\n", false),
        (LanguageId::Rust, "r3_c5_rs_ctrl_eof_arr_1_bad.rs",
         "fn f() {\n  let a = [1;\n",
         "fn f() {\n  let a = [1;\n  let c = 2;\n", false),
        // Iter 3 Explorer 2: firewall.rs:189,235 mid-file { k: 1; & controls
        (LanguageId::TypeScript, "r3_w2_ts_mid_semi_curly_const_bad.ts",
         "const a = { k: 1;\n  // TODO\n",
         "const a = { k: 1;\n  const c = 2;\n", false),
        (LanguageId::TypeScript, "r3_w2_ts_mid_semi_curly_prop_ok.ts",
         "const a = { k: 1;\n  // TODO\n",
         "const a = { k: 1;\n  m: 2,\n", true),
        (LanguageId::TypeScript, "r3_w2_ts_mid_semi_curly_code_replace_bad.ts",
         "const a = { k: 1;\n  x: 2,\n",
         "const a = { k: 1;\n  const c = 2;\n", false),
        (LanguageId::TypeScript, "r3_w2_ts_mid_semi_curly_closed_bad.ts",
         "const a = { k: 1;\n  // TODO\n};\n",
         "const a = { k: 1;\n  const c = 2;\n};\n", false),
        (LanguageId::TypeScript, "r3_w2_ts_ctrl_empty_semi_curly_ok.ts",
         "const a = {;\n  // TODO\n",
         "const a = {;\n  const c = 2;\n", true),
        (LanguageId::TypeScript, "r3_w2_ts_ctrl_type_semi_mid_ok.ts",
         "type T = { a: number;\n  // TODO\n",
         "type T = { a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r3_w2_ts_ctrl_iface_semi_mid_ok.ts",
         "interface I { a: number;\n  // TODO\n",
         "interface I { a: number;\n  b: string;\n", true),
        (LanguageId::Rust, "r3_w2_rs_ctrl_trait_semi_mid_ok.rs",
         "trait T { fn a();\n  // TODO\n",
         "trait T { fn a();\n  fn b();\n", true),
        // Iter 3 Explorer 3: EOF unclosed Rust attrs & enum attr/expression continuations
        (LanguageId::Rust, "c1_eof_impl_unclosed_attr_close_bad.rs",
         "impl Foo {\n  #[cfg(\n",
         "impl Foo {\n  #[cfg(\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "c1_eof_impl_feat_unclosed_attr_close_bad.rs",
         "impl Foo {\n  #[cfg(feature = \"x\"\n",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "c1_eof_mod_unclosed_attr_close_bad.rs",
         "mod m {\n  #[cfg(\n",
         "mod m {\n  #[cfg(\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "c1_eof_fn_unclosed_attr_close_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "c1_eof_struct_unclosed_attr_close_bad.rs",
         "struct S {\n  #[cfg(\n",
         "struct S {\n  #[cfg(\n  a: i32,\n}\n", false),
        (LanguageId::Rust, "c1_eof_enum_unclosed_attr_close_bad.rs",
         "enum E {\n  #[cfg(\n",
         "enum E {\n  #[cfg(\n  A,\n}\n", false),
        (LanguageId::Rust, "c1_eof_trait_unclosed_attr_close_bad.rs",
         "trait T {\n  #[cfg(\n",
         "trait T {\n  #[cfg(\n  fn a(&self);\n}\n", false),
        (LanguageId::Rust, "c1_eof_impl_inner_attr_close_bad.rs",
         "impl Foo {\n  #![cfg(\n",
         "impl Foo {\n  #![cfg(\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "c1_eof_impl_unclosed_attr_arg_ok.rs",
         "impl Foo {\n  #[cfg(\n",
         "impl Foo {\n  #[cfg(\n  unix,\n", true),
        (LanguageId::Rust, "c1_eof_impl_close_attr_fn_ok.rs",
         "impl Foo {\n  #[cfg(\n",
         "impl Foo {\n  #[cfg(\n  all())]\n  fn ok() {}\n}\n", true),
        (LanguageId::Rust, "c1_eof_mod_close_attr_fn_ok.rs",
         "mod m {\n  #[cfg(\n",
         "mod m {\n  #[cfg(\n  all())]\n  fn ok() {}\n}\n", true),
        (LanguageId::Rust, "c1_eof_fn_close_attr_let_ok.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  all())]\n  let x = 1;\n}\n", true),
        (LanguageId::Rust, "c1_eof_fn_close_attr_bad_stmt_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  all())]\n  let bad = ;\n}\n", false),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_attr_2_close_b_bad.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  2),\n  B\n}\n", false),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_attr_2_close_only_bad.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  2),\n}\n", false),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_attr_tuple_var_ok.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B(u32)\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_attr_struct_var_ok.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B { x: i32 }\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_attr_disc_var_ok.rs",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = (1 +\n  #[allow(dead_code)]\n  B = 1\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_no_paren_attr_bare_var_ok.rs",
         "enum E {\n  A = 1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = 1 +\n  #[allow(dead_code)]\n  B\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_no_paren_attr_2_bad.rs",
         "enum E {\n  A = 1 +\n  #[allow(dead_code)]\n",
         "enum E {\n  A = 1 +\n  #[allow(dead_code)]\n  2,\n  B\n}\n", false),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_ml_attr_bare_var_ok.rs",
         "enum E {\n  A = (1 +\n  #[cfg(\n    all()\n  )]\n",
         "enum E {\n  A = (1 +\n  #[cfg(\n    all()\n  )]\n  B\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_ml_attr_tuple_var_ok.rs",
         "enum E {\n  A = (1 +\n  #[cfg(\n    all()\n  )]\n",
         "enum E {\n  A = (1 +\n  #[cfg(\n    all()\n  )]\n  B(u32)\n}\n", true),
        (LanguageId::Rust, "c6_rs_enum_eq_paren_ml_attr_2_close_bad.rs",
         "enum E {\n  A = (1 +\n  #[cfg(\n    all()\n  )]\n",
         "enum E {\n  A = (1 +\n  [1, 2]\n  B\n}\n", false),
        // Iter 4 Explorer 1: multi-declarator operators, multi-letter, destructuring, & ts_refine controls
        (LanguageId::TypeScript, "r4_e1_multi_decl_ctrl_fn_my_type_ok.ts",
         "const a = x<y && z, b = f<MY_TYPE, {\n  a: string;\n",
         "const a = x<y && z, b = f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_multi_decl_ctrl_fn_my_type_spread_bad.ts",
         "const a = x<y && z, b = f<MY_TYPE, {\n  a: string;\n",
         "const a = x<y && z, b = f<MY_TYPE, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_e1_multi_decl_and_fn_my_type_ok.ts",
         "const a = x<y && fn<MyType, {\n  a: string;\n",
         "const a = x<y && fn<MyType, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_multi_decl_nested_ctrl_bad.ts",
         "const a = f<y, b = g<z, c<MY_TYPE, {\n  a: string;\n",
         "const a = f<y, b = g<z, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_e1_multi_decl_d4_my_type_ro_bad.ts",
         "const a = 1, b = foo<y, c = 2, d<MY_TYPE, {\n  a: string;\n",
         "const a = 1, b = foo<y, c = 2, d<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_e1_multi_decl_obj_then_cmp_bad.ts",
         "const a = { x: 1 }, b = x<y, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }, b = x<y, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_e1_ctrl_foo_u_ok.ts",
         "const r = foo<u, {\n  a: string;\n",
         "const r = foo<u, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_ctrl_obj_then_b_f_my_type_ok.ts",
         "const a = { x: 1 }, b = f<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }, b = f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_destr_arr_t_spread_bad.ts",
         "const [a = 1]<T, {\n  a: string;\n",
         "const [a = 1]<T, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_arr_t_open_spread_bad.ts",
         "const [a = 1]<T, {\n",
         "const [a = 1]<T, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_let_arr_t_spread_bad.ts",
         "let [a = 1]<T, {\n  a: string;\n",
         "let [a = 1]<T, {\n  a: string;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_obj_def_t_ro_bad.ts",
         "const { a = 1 }<T, {\n  a: string;\n",
         "const { a = 1 }<T, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_obj_t_ro_bad.ts",
         "const { a }<T, {\n  a: string;\n",
         "const { a }<T, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_obj_t_spread_bad.ts",
         "const { a }<T, {\n",
         "const { a }<T, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_e1_destr_ctrl_arr_foo_t_ok.ts",
         "const [a = 1] = foo<T, {\n  a: string;\n",
         "const [a = 1] = foo<T, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_destr_ctrl_obj_foo_t_ok.ts",
         "const { a } = foo<T, {\n  a: string;\n",
         "const { a } = foo<T, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r4_e1_ts_fn_type_ctrl_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => void,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => void,\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r4_e1_f_my_type_spread_bad.ts",
         "const r = f<MY_TYPE, {\n",
         "const r = f<MY_TYPE, {\n  ...other,\n", false),
        // Iter 4 Explorer 2: trim_after_last_sep `{ ... },` multi-declarator & controls
        (LanguageId::TypeScript, "r4_c1_ts_const_obj_comma_c_my_type_spread_bad.ts",
         "const a = { x: 1 }, c<MY_TYPE, {\n",
         "const a = { x: 1 }, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_c1_ts_const_obj_comma_c_my_type_ro_bad.ts",
         "const a = { x: 1 }, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_c1_ts_const_arrow_comma_c_my_type_ro_bad.ts",
         "const a = () => {}, c<MY_TYPE, {\n  a: string;\n",
         "const a = () => {}, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_c1_ts_const_fn_comma_c_my_type_ro_bad.ts",
         "const a = function() {}, c<MY_TYPE, {\n  a: string;\n",
         "const a = function() {}, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_c1_ts_let_obj_comma_c_my_type_ro_bad.ts",
         "let a = { x: 1 }, c<MY_TYPE, {\n  a: string;\n",
         "let a = { x: 1 }, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r4_c1_ctrl_const_fn_comma_b_obj_ok.ts",
         "const a = function() {}, b = {\n",
         "const a = function() {}, b = {\n  k: 1,\n", true),
        (LanguageId::TypeScript, "r4_c1_ctrl_const_if_key_obj_comma_b_obj_ok.ts",
         "const a = { if: 1 }, b = {\n",
         "const a = { if: 1 }, b = {\n  k: 1,\n", true),
        // Iter 4 Explorer 2: TS missing-arrow extends / closed / 2-level nested & controls
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_extends_spread_bad.ts",
         "const f = (x: number): { ok: number } extends infer R ? R : never {\n",
         "const f = (x: number): { ok: number } extends infer R ? R : never {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_extends_spread_closed_bad.ts",
         "const f = (x: number): { ok: number } extends infer R ? R : never {\n",
         "const f = (x: number): { ok: number } extends infer R ? R : never {\n  ...other,\n}\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_closed_ret1_bad.ts",
         "const f = (x: number) {\n",
         "const f = (x: number) {\n  return 1;\n}\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_ret_obj_closed_bad.ts",
         "const f = (x: number): { ok: number } {\n",
         "const f = (x: number): { ok: number } {\n  return { ok: 1 };\n}\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_nested_a_spread_bad.ts",
         "const f = (x: number) {\n  a: {\n",
         "const f = (x: number) {\n  a: {\n    ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_nested_a_const_bad.ts",
         "const f = (x: number) {\n  a: {\n",
         "const f = (x: number) {\n  a: {\n    const z = 1;\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_nested_ret_obj_a_spread_bad.ts",
         "const f = (x: number): { ok: number } {\n  a: {\n",
         "const f = (x: number): { ok: number } {\n  a: {\n    ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_nested_if_spread_bad.ts",
         "const f = (x: number) {\n  if (true) {\n",
         "const f = (x: number) {\n  if (true) {\n    ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_nested_ret_obj_if_spread_bad.ts",
         "const f = (x: number): { ok: number } {\n  if (true) {\n",
         "const f = (x: number): { ok: number } {\n  if (true) {\n    ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ts_no_arrow_sameline_if_spread_bad.ts",
         "const f = (x: number) { if (true) {\n",
         "const f = (x: number) { if (true) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r4_c2_ctrl_asi_const_then_if_ok.ts",
         "const y = 1\nif (x) {\n",
         "const y = 1\nif (x) {\n  const z = 2;\n", true),
        (LanguageId::TypeScript, "r4_c2_ctrl_const_fn_expr_ok.ts",
         "const f = function(x: number) {\n",
         "const f = function(x: number) {\n  return x;\n}\n", true),
        (LanguageId::TypeScript, "r4_c2_ctrl_arrow_ret_extends_ok.ts",
         "const f = (x: number): { ok: number } extends infer R ? R : never => {\n",
         "const f = (x: number): { ok: number } extends infer R ? R : never => {\n  return null as any;\n}\n", true),
        // Iter 4 Explorer 2: Rust mid-file foo([1; & brace control
        (LanguageId::Rust, "r4_c3_rs_mid_foo_paren_brack_let_bad.rs",
         "fn f() {\n  let x = foo([1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = foo([1;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r4_c3_rs_mid_brace_then_brack_let_ok.rs",
         "fn f() { let a = [1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() { let a = [1;\n  let c = 2;\n  let b = 1;\n}\n", true),
        // Iter 4 Explorer 3: EOF & top-level unclosed Rust #[cfg( / #![cfg( without }
        (LanguageId::Rust, "c1_eof_struct_unclosed_attr_no_rbrace_bad.rs",
         "struct S {\n  #[cfg(\n",
         "struct S {\n  #[cfg(\n  a: i32,\n", false),
        (LanguageId::Rust, "c1_eof_impl_unclosed_attr_no_rbrace_bad.rs",
         "impl Foo {\n  #[cfg(\n",
         "impl Foo {\n  #[cfg(\n  fn bad() {}\n", false),
        (LanguageId::Rust, "c1_eof_impl_inner_unclosed_attr_no_rbrace_bad.rs",
         "impl Foo {\n  #![cfg(\n",
         "impl Foo {\n  #![cfg(\n  fn bad() {}\n", false),
        (LanguageId::Rust, "c1_eof_mod_unclosed_attr_no_rbrace_bad.rs",
         "mod m {\n  #[cfg(\n",
         "mod m {\n  #[cfg(\n  fn bad() {}\n", false),
        (LanguageId::Rust, "c1_eof_fn_unclosed_attr_no_rbrace_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n", false),
        (LanguageId::Rust, "c1_eof_trait_unclosed_attr_no_rbrace_bad.rs",
         "trait T {\n  #[cfg(\n",
         "trait T {\n  #[cfg(\n  fn a(&self);\n", false),
        (LanguageId::Rust, "c1_eof_top_level_unclosed_attr_no_rbrace_bad.rs",
         "#[cfg(\n",
         "#[cfg(\nfn bad() {}\n", false),
        (LanguageId::Rust, "c1_eof_enum_unclosed_attr_struct_var_no_rbrace_bad.rs",
         "enum E {\n  #[cfg(\n",
         "enum E {\n  #[cfg(\n  A { x: i32 },\n", false),
        (LanguageId::Rust, "c1_eof_top_level_unclosed_attr_arg_ok.rs",
         "#[cfg(\n",
         "#[cfg(\nunix,\n", true),
        (LanguageId::Rust, "c1_eof_fn_unclosed_attr_arg_ok.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  unix,\n", true),
        (LanguageId::Rust, "c1_eof_struct_unclosed_attr_arg_ok.rs",
         "struct S {\n  #[cfg(\n",
         "struct S {\n  #[cfg(\n  unix,\n", true),
        (LanguageId::Rust, "c1_eof_enum_unclosed_attr_arg_ok.rs",
         "enum E {\n  #[cfg(\n",
         "enum E {\n  #[cfg(\n  A,\n", true),
        (LanguageId::Rust, "c1_eof_cmt_replace_unclosed_attr_fn_bad.rs",
         "fn f() {\n  #[cfg(\n  // TODO\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n", false),
        (LanguageId::Rust, "c1_eof_nested_all_unclosed_attr_bad.rs",
         "mod m {\n  #[cfg(all(\n    unix,\n",
         "mod m {\n  #[cfg(all(\n    unix,\n  fn bad() {}\n", false),
        (LanguageId::Rust, "c1_eof_nested_all_unclosed_attr_arg_ok.rs",
         "mod m {\n  #[cfg(all(\n    unix,\n",
         "mod m {\n  #[cfg(all(\n    unix,\n    windows,\n", true),
        // Iter 5 Explorer 1 Cluster 1: trim_after_last_sep destructuring & { ... } infix continuations + controls
        (LanguageId::TypeScript, "r5_c1_const_destr_obj_comma_c_ro_bad.ts",
         "const { a } = obj, c<MY_TYPE, {\n  a: string;\n",
         "const { a } = obj, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_destr_num_comma_c_k2_bad.ts",
         "const { a } = 1, c<MY_TYPE, {\n  a: string;\n",
         "const { a } = 1, c<MY_TYPE, {\n  a: string;\n  k2: 2,\n", false),
        (LanguageId::TypeScript, "r5_c1_let_destr_num_comma_c_ro_bad.ts",
         "let { a } = 1, c<MY_TYPE, {\n  a: string;\n",
         "let { a } = 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_var_destr_num_comma_c_ro_bad.ts",
         "var { a } = 1, c<MY_TYPE, {\n  a: string;\n",
         "var { a } = 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_destr_annot_comma_c_ro_bad.ts",
         "const { a }: { a: number } = { a: 1 }, c<MY_TYPE, {\n  a: string;\n",
         "const { a }: { a: number } = { a: 1 }, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_destr_both_lt_ro_bad.ts",
         "const { a } = 1, { b }<T, {\n  a: string;\n",
         "const { a } = 1, { b }<T, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_destr_both_lt_k2_bad.ts",
         "const { a } = 1, { b }<T, {\n  a: string;\n",
         "const { a } = 1, { b }<T, {\n  a: string;\n  k2: 2,\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_as_const_comma_c_ro_bad.ts",
         "const a = { x: 1 } as const, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } as const, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_satisfies_comma_c_ro_bad.ts",
         "const a = { x: 1 } satisfies Foo, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } satisfies Foo, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_let_obj_satisfies_comma_c_ro_bad.ts",
         "let a = { x: 1 } satisfies Foo, c<MY_TYPE, {\n  a: string;\n",
         "let a = { x: 1 } satisfies Foo, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_in_comma_c_ro_bad.ts",
         "const a = { x: 1 } in obj, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } in obj, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_instanceof_comma_c_ro_bad.ts",
         "const a = { x: 1 } instanceof Foo, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } instanceof Foo, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_eq_comma_c_ro_bad.ts",
         "const a = { x: 1 } === obj, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } === obj, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_const_obj_plus_comma_c_ro_bad.ts",
         "const a = { x: 1 } + 1, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } + 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c1_ctrl_const_obj_asi_f_my_type_ro_ok.ts",
         "const a = { x: 1 }\nf<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\nf<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r5_c1_ctrl_const_obj_as_const_b_eq_ok.ts",
         "const a = { x: 1 } as const, b = c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 } as const, b = c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        // Iter 5 Explorer 1 Cluster 2: nested/chained < multi-declarator & controls
        (LanguageId::TypeScript, "r5_c2_const_nested_lt_comma_c_spread_bad.ts",
         "const a = x<y<z, c<MY_TYPE, {\n",
         "const a = x<y<z, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_c2_let_nested_lt_comma_c_spread_bad.ts",
         "let a = x<y<z, c<MY_TYPE, {\n",
         "let a = x<y<z, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_c2_const_nested_lt_comma_c_ro_bad.ts",
         "const a = x<y<z, c<MY_TYPE, {\n  a: string;\n",
         "const a = x<y<z, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r5_c2_const_nested_3lt_comma_c_spread_bad.ts",
         "const a = x<y<z<w, c<MY_TYPE, {\n",
         "const a = x<y<z<w, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_c2_ctrl_nested_generic_comma_b_eq_ok.ts",
         "const a = f<A<B>, C>, b = g<MY_TYPE, {\n  a: string;\n",
         "const a = f<A<B>, C>, b = g<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        // Iter 5 Explorer 2: curried missing-arrow, extends\n ASI split, comment replacement in missing-arrow, Rust mid-file same-line [ masking
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_spread_bad.ts",
         "const f = (x: number) => (y: number) {\n",
         "const f = (x: number) => (y: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_ret_spread_bad.ts",
         "const f = (x: number) => (y: number): number {\n",
         "const f = (x: number) => (y: number): number {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_nested_if_spread_bad.ts",
         "const f = (x: number) => (y: number) {\n  if (true) {\n",
         "const f = (x: number) => (y: number) {\n  if (true) {\n    ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_ret_before_arrow_bad.ts",
         "const f = (x: number): number => (y: number) {\n",
         "const f = (x: number): number => (y: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_generic_async_bad.ts",
         "const f = (x: number) => async <T>(y: T) {\n",
         "const f = (x: number) => async <T>(y: T) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_arrow_ctrl_ok.ts",
         "const f = (x: number) => (y: number) => {\n  const z = x + y;\n",
         "const f = (x: number) => (y: number) => {\n  const z = x + y;\n  return z;\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_arrow_paren_obj_eof_ctrl_ok.ts",
         "const f = (x: number) => ({\n  a: x,\n",
         "const f = (x: number) => ({\n  a: x,\n  ...other,\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_arrow_paren_obj_asi_block_ctrl_ok.ts",
         "const f = (x: number) => ({ a: 1 })\n{\n  const y = 1;\n",
         "const f = (x: number) => ({ a: 1 })\n{\n  const y = 1;\n  const z = 2;\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_class_method_ctrl_ok.ts",
         "class C {\n  m(x: number) {\n    const y = 1;\n",
         "class C {\n  m(x: number) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_extends_nl_open_bad.ts",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never {\n",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_extends_nl_closed_bad.ts",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never {\n",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never {\n  ...other,\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_extends_nl_foo_bad.ts",
         "const f = (x: number): Foo extends\n  Bar ? 1 : 0 {\n",
         "const f = (x: number): Foo extends\n  Bar ? 1 : 0 {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_arrow_extends_nl_ctrl_ok.ts",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never => {\n  const y = 1;\n",
         "const f = (x: number): { ok: number } extends\n  infer R ? R : never => {\n  const y = 1;\n  return null as any;\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_asi_prop_is_ctrl_ok.ts",
         "const x = obj.is\nf<MY_TYPE, {\n  a: string;\n",
         "const x = obj.is\nf<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_mid_cmt_ret1_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  return 1;\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_mid_cmt_const_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  const y = 1;\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_eof_cmt_ret1_bad.ts",
         "const f = (x: number) {\n  // TODO\n",
         "const f = (x: number) {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_mid_cmt_ret_obj_bad.ts",
         "const f = (x: number): { ok: number } {\n  // TODO\n}\n",
         "const f = (x: number): { ok: number } {\n  return { ok: 1 };\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_nested_if_mid_cmt_bad.ts",
         "const f = (x: number) {\n  if (true) {\n    // TODO\n  }\n}\n",
         "const f = (x: number) {\n  if (true) {\n    return 1;\n  }\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_curried_no_arrow_mid_cmt_bad.ts",
         "const f = (x: number) => (y: number) {\n  // TODO\n}\n",
         "const f = (x: number) => (y: number) {\n  return 1;\n}\n", false),
        (LanguageId::TypeScript, "r5_e2_ts_no_arrow_mid_cmt_to_cmt_ctrl_ok.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  // DONE\n}\n", true),
        (LanguageId::TypeScript, "r5_e2_ts_valid_arrow_mid_cmt_ctrl_ok.ts",
         "const f = (x: number) => {\n  // TODO\n}\n",
         "const f = (x: number) => {\n  return 1;\n}\n", true),
        (LanguageId::Rust, "r5_e2_rs_mid_brack_brack_bad.rs",
         "fn f() {\n  let x = [1, [2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, [2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r5_e2_rs_mid_brack_foo_brack_bad.rs",
         "fn f() {\n  let x = [1, foo([2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, foo([2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r5_e2_rs_mid_brack_foo_paren_bad.rs",
         "fn f() {\n  let x = [foo(1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [foo(1;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r5_e2_rs_mid_foo_paren_brack_ctrl_bad.rs",
         "fn f() {\n  let x = foo([1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = foo([1;\n  let c = 2;\n  let b = 1;\n}\n", false),
        // Iter 5 Explorer 3 (Option B1): Rust unclosed attrs (EOF, empty-body }, mid-file comment replacement + controls)
        (LanguageId::Rust, "r5_e3_rs_impl_feat_eof_bad.rs",
         "impl Foo {\n  #[cfg(feature = \"x\"\n",
         "impl Foo {\n  #[cfg(feature = \"x\"\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_impl_all_unix_eof_bad.rs",
         "impl Foo {\n  #[cfg(all(unix\n",
         "impl Foo {\n  #[cfg(all(unix\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_impl_allow_eof_bad.rs",
         "impl Foo {\n  #[allow(dead_code\n",
         "impl Foo {\n  #[allow(dead_code\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_impl_inner_allow_eof_bad.rs",
         "impl Foo {\n  #![allow(dead_code\n",
         "impl Foo {\n  #![allow(dead_code\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_struct_feat_eof_bad.rs",
         "struct S {\n  #[cfg(feature = \"x\"\n",
         "struct S {\n  #[cfg(feature = \"x\"\n  a: i32,\n", false),
        (LanguageId::Rust, "r5_e3_rs_mod_feat_eof_bad.rs",
         "mod m {\n  #[cfg(feature = \"x\"\n",
         "mod m {\n  #[cfg(feature = \"x\"\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_trait_feat_eof_bad.rs",
         "trait T {\n  #[cfg(feature = \"x\"\n",
         "trait T {\n  #[cfg(feature = \"x\"\n  fn a(&self);\n", false),
        (LanguageId::Rust, "r5_e3_rs_enum_feat_struct_var_eof_bad.rs",
         "enum E {\n  #[cfg(feature = \"x\"\n",
         "enum E {\n  #[cfg(feature = \"x\"\n  A { x: i32 },\n", false),
        (LanguageId::Rust, "r5_e3_rs_fn_feat_eof_bad.rs",
         "fn f() {\n  #[cfg(feature = \"x\"\n",
         "fn f() {\n  #[cfg(feature = \"x\"\n  let x = 1;\n", false),
        (LanguageId::Rust, "r5_e3_rs_top_feat_eof_bad.rs",
         "#[cfg(feature = \"x\"\n",
         "#[cfg(feature = \"x\"\nfn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_fn_open_rbrace_bad.rs",
         "fn f() {\n  #[cfg(\n}\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "r5_e3_rs_mod_open_rbrace_bad.rs",
         "mod m {\n  #[cfg(\n}\n",
         "mod m {\n  #[cfg(\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "r5_e3_rs_struct_unix_eof_bad.rs",
         "struct S {\n  #[cfg(unix\n",
         "struct S {\n  #[cfg(unix\n  a: i32,\n", false),
        (LanguageId::Rust, "r5_e3_rs_struct_all_unix_eof_bad.rs",
         "struct S {\n  #[cfg(all(\n    unix\n",
         "struct S {\n  #[cfg(all(\n    unix\n  a: i32,\n", false),
        (LanguageId::Rust, "r5_e3_rs_fn_any_unix_eof_bad.rs",
         "fn f() {\n  #[cfg(any(\n    unix\n",
         "fn f() {\n  #[cfg(any(\n    unix\n  let x = 1;\n", false),
        (LanguageId::Rust, "r5_e3_rs_fn_unix_eof_bad.rs",
         "fn f() {\n  #[cfg(unix\n",
         "fn f() {\n  #[cfg(unix\n  let x = 1;\n", false),
        (LanguageId::Rust, "r5_e3_rs_top_all_unix_eof_bad.rs",
         "#[cfg(all(unix\n",
         "#[cfg(all(unix\nfn bad() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_mid_top_cmt_bad.rs",
         "#[cfg(\n  // TODO\nfn foo() {}\n",
         "#[cfg(\n  let x = 1;\nfn foo() {}\n", false),
        (LanguageId::Rust, "r5_e3_rs_mid_fn_cmt_bad.rs",
         "fn f() {\n  #[cfg(\n    // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  #[cfg(\n    let x = 1;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r5_e3_rs_mid_mod_cmt_bad.rs",
         "mod m {\n  #[cfg(\n    // TODO\n  fn g() {}\n}\n",
         "mod m {\n  #[cfg(\n    fn bad() {}\n  fn g() {}\n}\n", false),
        (LanguageId::Rust, "r5_e3_rs_mid_fn_cmt_to_cmt_ok.rs",
         "fn f() {\n  #[cfg(\n    // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  #[cfg(\n    // DONE\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r5_e3_rs_mid_fn_cmt_close_ok.rs",
         "fn f() {\n  #[cfg(\n    // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  #[cfg(\n    )]\n  let b = 1;\n}\n", true),
        // Iter 6 Explorer 1: multi-line TS const/let/var continuations + controls + TSX JSX RHS
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_as_any_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  as any, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  as any, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_as_const_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  as const, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  as const, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_satisfies_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  satisfies Foo, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  satisfies Foo, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_implements_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  implements Foo, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  implements Foo, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_plus_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  + 1, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  + 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_minus_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  - 1, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  - 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_obj_nl_lt_comma_c_ro_bad.ts",
         "const a = { x: 1 }\n  < 2, c<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n  < 2, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_1_plus_nl_y_comma_c_ro_bad.ts",
         "const a = 1 +\n  y, c<MY_TYPE, {\n  a: string;\n",
         "const a = 1 +\n  y, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_let_1_plus_nl_y_comma_c_ro_bad.ts",
         "let a = 1 +\n  y, c<MY_TYPE, {\n  a: string;\n",
         "let a = 1 +\n  y, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_var_obj_nl_plus_comma_c_ro_bad.ts",
         "var a = { x: 1 }\n  + 1, c<MY_TYPE, {\n  a: string;\n",
         "var a = { x: 1 }\n  + 1, c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r6_c1_const_1_plus_nl_y_empty_spread_bad.ts",
         "const a = 1 +\n  y, c<MY_TYPE, {\n",
         "const a = 1 +\n  y, c<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_c1_ctrl_const_obj_nl_bang_asi_ro_ok.ts",
         "const a = { x: 1 }\n!flag && f<MY_TYPE, {\n  a: string;\n",
         "const a = { x: 1 }\n!flag && f<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r6_c1_ctrl_const_1_plus_nl_y_b_eq_ro_ok.ts",
         "const a = 1 +\n  y, b = c<MY_TYPE, {\n  a: string;\n",
         "const a = 1 +\n  y, b = c<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r6_c1_ctrl_class_as_method_ok.ts",
         "class C {\n  as<T>(x: T) {\n",
         "class C {\n  as<T>(x: T) {\n    return x;\n", true),
        (LanguageId::Tsx, "r6_c3_tsx_jsx_k2_ok.tsx",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: <div/>,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: <div/>,\n  k2: 1 + 2,\n", true),
        (LanguageId::Tsx, "r6_c3_tsx_jsx_ro_bad.tsx",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: <div/>,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: <div/>,\n  readonly b: number;\n", false),
        // Iter 6 Explorer 2: bare-param curried & multi-arrow : RetType missing-arrow + Rust mid-file [1, foo(2;
        (LanguageId::TypeScript, "r6_e2_ts_curried_bare_x_bad.ts",
         "const f = x => (y: number) {\n",
         "const f = x => (y: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_curried_async_bare_x_bad.ts",
         "const f = async x => (y: number) {\n",
         "const f = async x => (y: number) {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_curried_bare_y_bad.ts",
         "const f = (x: number) => y {\n",
         "const f = (x: number) => y {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_curried_bare_x_mid_cmt_bad.ts",
         "const f = x => (y: number) {\n  // TODO\n}\n",
         "const f = x => (y: number) {\n  return 1;\n}\n", false),
        (LanguageId::JavaScript, "r6_e2_js_curried_bare_x_mid_cmt_bad.js",
         "const f = x => (y) {\n  // TODO\n}\n",
         "const f = x => (y) {\n  return 1;\n}\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_multi_arrow_ret_bad.ts",
         "const f = (x: number): (y: string) => (z: boolean) => number {\n",
         "const f = (x: number): (y: string) => (z: boolean) => number {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_foo_multi_arrow_ret_bad.ts",
         "const f = (x: number): Foo => (y: string) => number {\n",
         "const f = (x: number): Foo => (y: string) => number {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r6_e2_ts_bare_arrow_ctrl_ok.ts",
         "const f = x => {\n  const y = 1;\n",
         "const f = x => {\n  const y = 1;\n  return y;\n", true),
        (LanguageId::TypeScript, "r6_e2_ts_obj_shorthand_ctrl_ok.ts",
         "const obj = {\n  m(x: number) {\n    const y = 1;\n",
         "const obj = {\n  m(x: number) {\n    const y = 1;\n    return y;\n", true),
        (LanguageId::Rust, "r6_e2_rs_mid_1_foo_paren_bad.rs",
         "fn f() {\n  let x = [1, foo(2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, foo(2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r6_e2_rs_mid_1_foo_paren_cmt_ctrl_ok.rs",
         "fn f() {\n  let x = [1, foo(2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, foo(2;\n  // DONE\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r6_e2_rs_mid_1_foo_brack_bad.rs",
         "fn f() {\n  let x = [1, foo([2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, foo([2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        // Iter 6 Explorer 3: mid-file Rust unclosed attr in impl/trait/struct/enum, whitespace-separated attr lines, unclosed quote in attr
        (LanguageId::Rust, "r6_e3_rs_impl_mid_cmt_let_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    let x = 1;\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_impl_mid_cmt_fn_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    fn bad() {}\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_trait_mid_cmt_let_bad.rs",
         "trait T {\n  #[cfg(\n    // TODO\n  fn a(&self);\n}\n",
         "trait T {\n  #[cfg(\n    let x = 1;\n  fn a(&self);\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_trait_mid_cmt_fn_bad.rs",
         "trait T {\n  #[cfg(\n    // TODO\n  fn a(&self);\n}\n",
         "trait T {\n  #[cfg(\n    fn bad(&self);\n  fn a(&self);\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_struct_mid_cmt_field_bad.rs",
         "struct S {\n  #[cfg(\n    // TODO\n  a: i32,\n}\n",
         "struct S {\n  #[cfg(\n    x: i32,\n  a: i32,\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_enum_mid_cmt_struct_var_bad.rs",
         "enum E {\n  #[cfg(\n    // TODO\n  A,\n}\n",
         "enum E {\n  #[cfg(\n    B { x: i32 },\n  A,\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_impl_all_mid_cmt_fn_bad.rs",
         "impl Foo {\n  #[cfg(all(\n    unix,\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(all(\n    unix,\n    fn bad() {}\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_struct_all_mid_cmt_field_bad.rs",
         "struct S {\n  #[cfg(all(\n    unix,\n    // TODO\n  a: i32,\n}\n",
         "struct S {\n  #[cfg(all(\n    unix,\n    x: i32,\n  a: i32,\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_impl_mid_cmt_done_ok.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    // DONE\n  fn a() {}\n}\n", true),
        (LanguageId::Rust, "r6_e3_rs_impl_mid_cmt_close_ok.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    )]\n  fn a() {}\n}\n", true),
        (LanguageId::Rust, "r6_e3_rs_impl_all_mid_cmt_arg_ok.rs",
         "impl Foo {\n  #[cfg(all(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(all(\n    unix,\n  fn a() {}\n}\n", true),
        (LanguageId::Rust, "r6_e3_rs_enum_cfg_arg_ok.rs",
         "enum E {\n  #[cfg(\n",
         "enum E {\n  #[cfg(\n  A,\n", true),
        (LanguageId::Rust, "r6_e3_rs_impl_all_unix_windows_eof_bad.rs",
         "impl Foo {\n  #[cfg(all(\n    unix\n    windows\n",
         "impl Foo {\n  #[cfg(all(\n    unix\n    windows\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r6_e3_rs_impl_all_unix_windows_mid_bad.rs",
         "impl Foo {\n  #[cfg(all(\n    unix\n    windows\n}\n",
         "impl Foo {\n  #[cfg(all(\n    unix\n    windows\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_fn_unix_all_eof_bad.rs",
         "fn f() {\n  #[cfg(\n    unix\n    all\n",
         "fn f() {\n  #[cfg(\n    unix\n    all\n  let x = 1;\n", false),
        (LanguageId::Rust, "r6_e3_rs_fn_unix_all_mid_bad.rs",
         "fn f() {\n  #[cfg(\n    unix\n    all\n}\n",
         "fn f() {\n  #[cfg(\n    unix\n    all\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "r6_e3_rs_fn_unix_all_cmt_done_ok.rs",
         "fn f() {\n  #[cfg(\n    unix\n    all\n",
         "fn f() {\n  #[cfg(\n    unix\n    all\n  // DONE\n", true),
        (LanguageId::Rust, "r6_e3_rs_fn_unix_quote_eof_bad.rs",
         "fn f() {\n  #[cfg(unix\n",
         "fn f() {\n  #[cfg(unix\n  \"hello\n", false),
        (LanguageId::Rust, "r6_e3_rs_fn_open_quote_eof_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  \"hello\n", false),
        (LanguageId::Rust, "r6_e3_rs_impl_mid_cmt_quote_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    \"hello\n  fn a() {}\n}\n", false),
        // Iter 7 Explorer 1: multi-line /* */ & strings, paren/trailing-op & || union_type, nested { no comma, kw props, as/satisfies/implements
        (LanguageId::TypeScript, "r7_e1_blk_cmt_nested_ro_bad.ts",
         "const r = foo<u |\n  {\n    /* c1\n       c2 */\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    /* c1\n       c2 */\n    a: 1 + 2,\n    nested: {\n      readonly x: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_blk_cmt_nested_obj_ok.ts",
         "const r = foo<u |\n  {\n    /* c1\n       c2 */\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    /* c1\n       c2 */\n    a: 1 + 2,\n    nested: {\n      x: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r7_e1_flimit_blk_cmt_nested_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  /* c1\n     c2 */\n  a: 1 + 2,\n  nested: {\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  /* c1\n     c2 */\n  a: 1 + 2,\n  nested: {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_tpl_str_nested_ro_bad.ts",
         "const r = foo<u |\n  {\n    k: `line1\nline2`,\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    k: `line1\nline2`,\n    a: 1 + 2,\n    nested: {\n      readonly x: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_esc_nl_nested_ro_bad.ts",
         "const r = foo<u |\n  {\n    k: \"line1 \\\nline2\",\n    a: 1 + 2,\n    nested: {\n",
         "const r = foo<u |\n  {\n    k: \"line1 \\\nline2\",\n    a: 1 + 2,\n    nested: {\n      readonly x: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_cmt_after_comma_nested_ro_bad.ts",
         "const r = foo<u |\n  {\n    a: 1 + 2, /* c1\n       c2 */\n    nested: {\n",
         "const r = foo<u |\n  {\n    a: 1 + 2, /* c1\n       c2 */\n    nested: {\n      readonly x: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_myfn_paren_star_ro_bad.ts",
         "myFn = foo<u |\n  {\n    a: (1 + *),\n",
         "myFn = foo<u |\n  {\n    a: (1 + *),\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_myfn_paren_plus1_ro_bad.ts",
         "myFn = foo<u |\n  {\n    a: (1 + *) + 1,\n",
         "myFn = foo<u |\n  {\n    a: (1 + *) + 1,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_myfn_paren2_star_ro_bad.ts",
         "myFn = foo<u |\n  {\n    a: (1 + 2) + *,\n",
         "myFn = foo<u |\n  {\n    a: (1 + 2) + *,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_paren2_star_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  a: (1 + 2) + *,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  a: (1 + 2) + *,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_a_star_expr_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a) + *,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a) + *,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r7_e1_flimit_a_star_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a) + *,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a) + *,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_a_star_p1_expr_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a + *) + 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a + *) + 1,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r7_e1_flimit_a_star_p1_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a + *) + 1,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (a + *) + 1,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_a_minus_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a - ,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a - ,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_a_and_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a && ,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a && ,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_or_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_or_expr_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b,\n  k2: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r7_e1_flimit_or3_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b || c,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: a || b || c,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_or_arrow_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => a || b,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => a || b,\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_flimit_valid_union_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: string | number,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  k: string | number,\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r7_e1_nest_nocomma_expr_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    k: !flag,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    k: !flag,\n    y: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r7_e1_nest_nocomma_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    k: !flag,\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    k: !flag,\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r7_e1_nest_iface_ctrl_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    a: string;\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  nested: {\n    a: string;\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "r7_e1_kw_prop_let_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  let : number;\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  let : number;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r7_e1_kw_prop_if_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  if : number;\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  if : number;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r7_e1_kw_prop_return_ro_ok.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  return : string;\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  return : string;\n  readonly b: number;\n", true),
        (LanguageId::TypeScript, "r7_e1_nl_as_generic_ro_bad.ts",
         "const x = foo\n  as<MY_TYPE, {\n  a: string;\n",
         "const x = foo\n  as<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r7_e1_nl_satisfies_generic_ro_bad.ts",
         "const x = foo\n  satisfies<MY_TYPE, {\n  a: string;\n",
         "const x = foo\n  satisfies<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r7_e1_nl_implements_generic_ro_bad.ts",
         "class C\n  implements<MY_TYPE, {\n  a: string;\n",
         "class C\n  implements<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r7_e1_foo_dot_as_generic_ro_ok.ts",
         "const x = foo.as<MY_TYPE, {\n  a: string;\n",
         "const x = foo.as<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", true),
        // W2-M2b Iter 7 Explorer 2: C4 non-`=` missing-arrow headers & C5 Rust semi_brack
        (LanguageId::TypeScript, "c4_exp_def_no_arrow_bad.ts",
         "export default (x: number) {\n",
         "export default (x: number) {\n  return x;\n", false),
        (LanguageId::TypeScript, "c4_exp_def_async_no_arrow_bad.ts",
         "export default async (x: number) {\n",
         "export default async (x: number) {\n  return x;\n", false),
        (LanguageId::TypeScript, "c4_return_no_arrow_bad.ts",
         "function g() {\n  return (x: number) {\n",
         "function g() {\n  return (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "c4_obj_prop_no_arrow_bad.ts",
         "const obj = {\n  f: (x: number) {\n",
         "const obj = {\n  f: (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "c4_obj_prop_async_no_arrow_bad.ts",
         "const obj = {\n  f: async (x: number) {\n",
         "const obj = {\n  f: async (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "c4_obj_prop_curried_no_arrow_bad.ts",
         "const obj = {\n  f: x => (y: number) {\n",
         "const obj = {\n  f: x => (y: number) {\n    return y;\n", false),
        (LanguageId::TypeScript, "c4_ctrl_exp_def_fn_ok.ts",
         "export default function (x: number) {\n",
         "export default function (x: number) {\n  return x;\n", true),
        (LanguageId::TypeScript, "c4_ctrl_class_return_method_ok.ts",
         "class C {\n  return(x: number) {\n",
         "class C {\n  return(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "c4_ctrl_obj_method_ret_fn_ok.ts",
         "const obj = {\n  m(x: number): ((y: number) => number) {\n",
         "const obj = {\n  m(x: number): ((y: number) => number) {\n    return (y) => y;\n", true),
        (LanguageId::Rust, "c5_fn_g_err_foo_brack_close_ok.rs",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, foo([2;\n  // TODO\n  let b = 1;\n}\n",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, foo([2;\n  3])];\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "c5_fn_g_err_nested_brack_close_ok.rs",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, [2;\n  // TODO\n  let b = 1;\n}\n",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, [2;\n  3]];\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "c5_fn_g_err_partial_3brack_bad.rs",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, foo([2;\n  // TODO\n  let b = 1;\n}\n",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, foo([2;\n  3];\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "c5_bp_semi_brack_unclosed_lt_bad.rs",
         "fn f() {\n  let x = [a, b<c(1);\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [a, b<c(1);\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "c5_bp_semi_brack_brace_field_bad.rs",
         "fn f() {\n  let x = [1, { a: 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, { a: 2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "c5_bp_semi_brack_call_brace_field_bad.rs",
         "fn f() {\n  let x = [1, foo({ a: 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, foo({ a: 2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "c5_ctrl_semi_brack_brace_let_ok.rs",
         "fn f() {\n  let x = [1, { let a = 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, { let a = 2;\n  let c = 2;\n  let b = 1;\n}\n", true),
        // Iter 7 Explorer 3: multi-line Rust //+code & unclosed quote in unclosed attr; non-comment mod/fn/top-level unclosed attr edits
        (LanguageId::Rust, "r7_e3_rs_impl_mid_cmt_then_let_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    // DONE\n    let x = 1;\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_impl_mid_cmt_then_fn_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    // ok\n    fn bad() {}\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_impl_mid_cmt_then_rbraces_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    // ok\n    }}}\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_impl_mid_cmt_then_quote_bad.rs",
         "impl Foo {\n  #[cfg(\n    // TODO\n  fn a() {}\n}\n",
         "impl Foo {\n  #[cfg(\n    // DONE\n    \"hello\n  fn a() {}\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_enum_mid_cmt_then_let_bad.rs",
         "enum E {\n  #[cfg(\n    // TODO\n  A,\n}\n",
         "enum E {\n  #[cfg(\n    // ok\n    let bad = ;\n  A,\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_struct_mid_cmt_then_let_bad.rs",
         "struct S {\n  #[cfg(\n    // TODO\n  a: i32,\n}\n",
         "struct S {\n  #[cfg(\n    // ok\n    let bad = ;\n  a: i32,\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_trait_mid_cmt_then_let_bad.rs",
         "trait T {\n  #[cfg(\n    // TODO\n  fn a(&self);\n}\n",
         "trait T {\n  #[cfg(\n    // ok\n    let bad = ;\n  fn a(&self);\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_eof_cmt_then_let_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  // DONE\n  let x = 1;\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_eof_cmt_then_quote_bad.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  // ok\n  \"hello\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_eof_unclosed_quote_base_cmt_bad.rs",
         "fn outer() {\n  #[cfg(feature = \"a\n",
         "fn outer() {\n  #[cfg(feature = \"a\n  // cmt\n", false),
        (LanguageId::Rust, "r7_e3_rs_impl_eof_unclosed_raw_quote_base_cmt_bad.rs",
         "impl Foo {\n  #[cfg(feature = r#\"a\n",
         "impl Foo {\n  #[cfg(feature = r#\"a\n  // cmt\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_eof_ml_blkcmt_ok.rs",
         "fn f() {\n  #[cfg(\n",
         "fn f() {\n  #[cfg(\n  /* l1\n     /* nested */\n     l2 */\n", true),
        (LanguageId::Rust, "r7_e3_rs_mod_noncmt_fn_bad.rs",
         "mod m {\n  #[cfg(\n  foo\n}\n",
         "mod m {\n  #[cfg(\n  fn bad() {}\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_noncmt_let_bad.rs",
         "fn f() {\n  #[cfg(\n  foo\n}\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "r7_e3_rs_top_noncmt_fn_bad.rs",
         "#[cfg(\n  foo\nfn a() {}\n",
         "#[cfg(\n  fn bad() {}\nfn a() {}\n", false),
        (LanguageId::Rust, "r7_e3_rs_eof_mod_noncmt_fn_bad.rs",
         "mod m {\n  #[cfg(\n  foo\n",
         "mod m {\n  #[cfg(\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r7_e3_rs_eof_fn_noncmt_let_bad.rs",
         "fn f() {\n  #[cfg(\n  foo\n",
         "fn f() {\n  #[cfg(\n  let x = 1;\n", false),
        (LanguageId::Rust, "r7_e3_rs_eof_top_noncmt_fn_bad.rs",
         "#[cfg(\n  foo\n",
         "#[cfg(\n  fn bad() {}\n", false),
        (LanguageId::Rust, "r7_e3_rs_fn_noncmt_foo_to_unix_comma_ok.rs",
         "fn f() {\n  #[cfg(all(\n  foo\n  let a = 1;\n}\n",
         "fn f() {\n  #[cfg(all(\n  unix,\n  let a = 1;\n}\n", true),
        (LanguageId::Rust, "r7_e3_rs_fn_noncmt_foo_to_close_ok.rs",
         "fn f() {\n  #[cfg(unix\n  foo\n}\n",
         "fn f() {\n  #[cfg(unix\n  )]\n  let x = 1;\n}\n", true),
        (LanguageId::Rust, "r7_e3_rs_fn_exited_replace_let_ok.rs",
         "fn outer() {\n  #[cfg(unix\n  let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "r7_e3_rs_fn_ml_cmt_then_let_ok.rs",
         "fn outer() {\n  #[cfg(unix\n  // TODO\n  let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix\n  // DONE\n  let y = 2;\n}\n", true),
        (LanguageId::Rust, "r7_e3_rs_fn_ml_cmt_then_let_bad.rs",
         "fn outer() {\n  #[cfg(unix\n  // TODO\n  let ok = 1;\n}\n",
         "fn outer() {\n  #[cfg(unix\n  // DONE\n  let bad = ;\n}\n", false),
        // Iter 8 Explorer 2 + Explorer 3 (deduplicated): multi-line //+code, unclosed /*/quote, C4 yield/await/throw & class/obj broken+return(), Rust mid-file nested [, struct semi, [1, a > b;
        (LanguageId::TypeScript, "r8_e2_eof_193_const_arrow_ml_cmt_ret_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  // DONE\n  return 1;\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_eof_193_const_arrow_ml_cmt_done_ok.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  // DONE\n  // line2\n}\n", true),
        (LanguageId::TypeScript, "r8_e2_eof_193_const_arrow_unclosed_blk_cmt_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  /* unclosed\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_eof_193_const_arrow_unclosed_quote_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  // DONE\n  \"unclosed\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_eof_193_const_arrow_closed_str_bad.ts",
         "const f = (x: number) {\n  // TODO\n}\n",
         "const f = (x: number) {\n  // DONE\n  \"hello\"\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_bh1_c4_return_ml_cmt_eof_bad.ts",
         "function g() {\n  return (x: number) {\n",
         "function g() {\n  return (x: number) {\n    // comment\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e2_bh1_c4_return_ml_cmt_mid_bad.ts",
         "function g() {\n  return (x: number) {\n    // TODO\n  }\n}\n",
         "function g() {\n  return (x: number) {\n    // DONE\n    return x;\n  }\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_bh1_c4_obj_prop_ml_cmt_mid_bad.ts",
         "const obj = {\n  f: (x: number) {\n    // TODO\n  }\n};\n",
         "const obj = {\n  f: (x: number) {\n    // DONE\n    return x;\n  }\n};\n", false),
        (LanguageId::JavaScript, "r8_e2_adv_c4_js_return_ml_cmt_then_ret_bad.js",
         "function g() {\n  return (x) {\n    // TODO\n  }\n}\n",
         "function g() {\n  return (x) {\n    // DONE\n    return x;\n  }\n}\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_yield_no_arrow_bad.ts",
         "function* g() {\n  yield (x: number) {\n",
         "function* g() {\n  yield (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_await_no_arrow_bad.ts",
         "async function g() {\n  await (x: number) {\n",
         "async function g() {\n  await (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_throw_no_arrow_bad.ts",
         "function g() {\n  throw (x: number) {\n",
         "function g() {\n  throw (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_for_await_valid_ok.ts",
         "async function g(xs: any[]) {\n  for await (const x of xs) {\n",
         "async function g(xs: any[]) {\n  for await (const x of xs) {\n    console.log(x);\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_class_broken_then_return_method_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_obj_broken_then_return_method_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_class_broken_then_return_method_mid_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    // TODO\n  }\n}\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    // DONE\n    return x;\n  }\n}\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_obj_broken_then_return_method_mid_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    // TODO\n  }\n};\n",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    // DONE\n    return x;\n  }\n};\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_class_broken_then_return_method_prop_bad.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_class_await_ok.ts",
         "class C {\n  await(x: number) {\n",
         "class C {\n  await(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_class_yield_ok.ts",
         "class C {\n  yield(x: number) {\n",
         "class C {\n  yield(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_obj_await_ok.ts",
         "const obj = {\n  await(x: number) {\n",
         "const obj = {\n  await(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e2_c4_class_field_await_no_arrow_bad.ts",
         "class C {\n  f = await (x: number) {\n",
         "class C {\n  f = await (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e2_c4_obj_prop_await_no_arrow_bad.ts",
         "const obj = {\n  f: await (x: number) {\n",
         "const obj = {\n  f: await (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e3_c4_return_ml_cmt_done_ok.ts",
         "function g() {\n  return (x: number) {\n    // TODO\n  }\n}\n",
         "function g() {\n  return (x: number) {\n    // DONE\n    // line2\n  }\n}\n", true),
        (LanguageId::TypeScript, "r8_e3_c4_return_unclosed_blk_bad.ts",
         "function g() {\n  return (x: number) {\n    // TODO\n  }\n}\n",
         "function g() {\n  return (x: number) {\n    /* unclosed\n  }\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_brace_field_ml_cmt_bad.rs",
         "fn f() {\n  let x = [1, { a: 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, { a: 2;\n  // DONE\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_struct_field_ml_cmt_bad.rs",
         "fn f() {\n  let x = [1, S { a: 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, S { a: 2;\n  // DONE\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_brace_field_ml_cmt_done_ok.rs",
         "fn f() {\n  let x = [1, { a: 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, { a: 2;\n  // DONE\n  // line2\n  let b = 1;\n}\n", true),
        (LanguageId::TypeScript, "r8_e3_c4_class_broken_prev_paren_return_ok.ts",
         "class C {\n  broken( { }\n  return(x: number) {\n",
         "class C {\n  broken( { }\n  return(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r8_e3_c4_obj_broken_then_prop_missing_arrow_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  f: (x: number) {\n",
         "const obj = {\n  broken: (1 + *),\n  f: (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r8_e3_c4_class_method_stmt_return_bad.ts",
         "class C {\n  broken = (1 + *)\n  m() {\n    return (x: number) {\n",
         "class C {\n  broken = (1 + *)\n  m() {\n    return (x: number) {\n      return x;\n", false),
        (LanguageId::Rust, "r8_e3_c5_ml_nested_brack_partial_bad.rs",
         "fn f() {\n  let x = [1,\n    [2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1,\n    [2;\n  3];\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_ml_struct_semi_let_bad.rs",
         "fn f() {\n  let s = S {\n    a: 1;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let s = S {\n    a: 1;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_ml_struct_semi_field_bad.rs",
         "fn f() {\n  let x = Foo {\n    a: 2;\n    // TODO\n  };\n}\n",
         "fn f() {\n  let x = Foo {\n    a: 2;\n    b: 3,\n  };\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_ml_struct_valid_blk_field_ok.rs",
         "fn f() {\n  let x = Foo {\n    a: { let y = 1; y },\n    // TODO\n  };\n}\n",
         "fn f() {\n  let x = Foo {\n    a: { let y = 1; y },\n    b: 3,\n  };\n}\n", true),
        (LanguageId::Rust, "r8_e3_c5_comma_cmp_gt_semi_brack_let_bad.rs",
         "fn f() {\n  let x = [1, a > b;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, a > b;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_fn_g_cmp_gt_semi_brack_let_bad.rs",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, a > b;\n  // TODO\n  let b = 1;\n}\n",
         "fn g() { let z = ; }\nfn f() {\n  let x = [1, a > b;\n  let c = 2;\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r8_e3_c5_comma_cmp_gt_semi_brack_cmt_ok.rs",
         "fn f() {\n  let x = [1, a > b;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, a > b;\n  // DONE\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r8_e3_c5_comma_semi_brack_2_let_bad.rs",
         "fn f() {\n  let x = [1, 2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1, 2;\n  let c = 2;\n  let b = 1;\n}\n", false),
        // Iter 9 Explorer 2: kw-attached <MY_TYPE, { gaps, yield * / kw-method probes, TSX return (<div>
        (LanguageId::TypeScript, "r9_e2_kw_impl_cmt_eof_bad.ts",
         "class C\n  implements<MY_TYPE, { // cmt\n",
         "class C\n  implements<MY_TYPE, { // cmt\n  m() {}\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_impl_blk_cmt_eof_bad.ts",
         "class C\n  implements<MY_TYPE, { /* cmt */\n",
         "class C\n  implements<MY_TYPE, { /* cmt */\n  m() {}\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_impl_cmt_mid_bad.ts",
         "class C\n  implements<MY_TYPE, { // cmt\n  // TODO\n}\n",
         "class C\n  implements<MY_TYPE, { // cmt\n  m() {}\n}\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_as_cmt_eof_bad.ts",
         "const x = foo as<MY_TYPE, { // cmt\n",
         "const x = foo as<MY_TYPE, { // cmt\n  ...other,\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_sat_blk_cmt_mid_bad.ts",
         "const x = foo satisfies<MY_TYPE, { /* cmt */\n  // TODO\n};\n",
         "const x = foo satisfies<MY_TYPE, { /* cmt */\n  ...other,\n};\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_nested_foo_keyof_bad.ts",
         "type T = Foo<keyof<MY_TYPE, {\n  a: string;\n",
         "type T = Foo<keyof<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_nested_foo_infer_bad.ts",
         "type T = Foo<infer<MY_TYPE, {\n  a: string;\n",
         "type T = Foo<infer<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_nested_foo_a_keyof_mid_bad.ts",
         "type T = Foo<A, keyof<MY_TYPE, {\n  // TODO\n}>\n",
         "type T = Foo<A, keyof<MY_TYPE, {\n  readonly b: string;\n}>\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_f_as_paren_bad.ts",
         "f(foo as<MY_TYPE, {\n",
         "f(foo as<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r9_e2_kw_f_sat_paren_bad.ts",
         "f(foo satisfies<MY_TYPE, {\n",
         "f(foo satisfies<MY_TYPE, {\n  ...other,\n", false),
        (LanguageId::TypeScript, "r9_e2_c4_yield_space_star_ts_bad.ts",
         "function* g() {\n  yield * (x: number) {\n",
         "function* g() {\n  yield * (x: number) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r9_e2_c4_yield_space_star_mid_bad.ts",
         "function* g() {\n  yield * (x: number) {\n    // TODO\n  }\n}\n",
         "function* g() {\n  yield * (x: number) {\n    // DONE\n    return x;\n  }\n}\n", false),
        (LanguageId::JavaScript, "r9_e2_c4_yield_space_star_js_bad.js",
         "function* g() {\n  yield * (x) {\n",
         "function* g() {\n  yield * (x) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r9_e2_c4_yield_cmt_star_bad.ts",
         "function* g() {\n  yield /* c */ * (x) {\n",
         "function* g() {\n  yield /* c */ * (x) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r9_e2_c4_cls_star_yield_ok.ts",
         "class C {\n  *yield(x: number) {\n",
         "class C {\n  *yield(x: number) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_cls_ret_str_replace_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(x = \"hello\") {\n    const y = 1;\n",
         "class C {\n  broken = (1 + *)\n  return(x = \"hello\") {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_cls_ret_ml_str_param_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(\n    x: string = \"a\" + \"b\"\n  ) {\n",
         "class C {\n  broken = (1 + *)\n  return(\n    x: string = \"a\" + \"b\"\n  ) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_cls_ret_inner_lparen_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    foo(\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    foo(\n      x\n    );\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_obj_ret_inner_lparen_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    foo(\n",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    foo(\n      x\n    );\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_obj_ret_broken_stmt_if_ok.ts",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    const z = (1 + *);\n    if (x > 0) {\n",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    const z = (1 + *);\n    if (x > 0) {\n      return x;\n", true),
        (LanguageId::TypeScript, "r9_e2_c4_obj_ret_inner_missing_arrow_bad.ts",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    const z = (1 + *);\n    const f = (y: number) {\n",
         "const obj = {\n  broken: (1 + *),\n  return(x: number) {\n    const z = (1 + *);\n    const f = (y: number) {\n      return y;\n", false),
        (LanguageId::Tsx, "r9_e2_tsx_fn_ret_div_ok.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <span>hi</span>\n  </div>);\n", true),
        (LanguageId::Tsx, "r9_e2_tsx_broken_ret_div_ok.tsx",
         "const bad = (1 + *);\nreturn (<div>\n",
         "const bad = (1 + *);\nreturn (<div>\n  <span>hi</span>\n</div>);\n", true),
        (LanguageId::Tsx, "r9_e2_tsx_ml_ret_div_ok.tsx",
         "function C() {\n  return (\n    <div>\n",
         "function C() {\n  return (\n    <div>\n      <span>hi</span>\n    </div>);\n", true),
        (LanguageId::Tsx, "r9_e2_tsx_jsx_apostrophe_ok.tsx",
         "function C() {\n  return (<div>\n    don't\n",
         "function C() {\n  return (<div>\n    don't\n    <span>hi</span>\n  </div>);\n", true),
        (LanguageId::Tsx, "r9_e2_tsx_div_mismatch_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <span>hi</span>\n  </span>);\n", false),
        (LanguageId::Tsx, "r9_e2_tsx_div_expr_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    {1 + *}\n  </div>);\n", false),
        (LanguageId::Tsx, "r9_e2_tsx_div_unclosed_span_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <span>hi\n  </div>);\n", false),
        // Iter 9 Explorer 3: C5 nested [ & ( multi/partial closes, C4 mid-file kw shorthand & sibling C5 analogues
        (LanguageId::Rust, "r9_e3_rs_ml_nested_brack_valid_repeat_ok.rs",
         "fn f() {\n  let x = [1,\n    [2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1,\n    [2;\n  3]];\n  let b = 1;\n}\n", true),
        (LanguageId::Rust, "r9_e3_rs_ml_nested_brack_comma_semi_both_bad.rs",
         "fn f() {\n  let x = [1,\n    [2, 3;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [1,\n    [2, 3;\n  4]];\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r9_e3_rs_ml_nested_brack_broken_outer_no_semi_bad.rs",
         "fn f() {\n  let broken = (1 + *);\n  let x = [1,\n    [2;\n  foo\n  let b = 1;\n}\n",
         "fn f() {\n  let broken = (1 + *);\n  let x = [1,\n    [2;\n  3]]\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r9_e3_rs_ml_nested_brack_3_close_2_bad.rs",
         "fn f() {\n  let x = [0, [1,\n    [2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  let x = [0, [1,\n    [2;\n  3]];\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r9_e3_rs_ml_nested_paren_semi_partial_rp_bad.rs",
         "fn f() {\n  foo(1,\n    bar(2;\n  // TODO\n  let b = 1;\n}\n",
         "fn f() {\n  foo(1,\n    bar(2;\n  3);\n  let b = 1;\n}\n", false),
        (LanguageId::Rust, "r9_e3_rs_ml_nested_paren_semi_suf_rp_bad.rs",
         "fn f() {\n  foo(1,\n    bar(2;\n  // TODO\n  );\n  let b = 1;\n}\n",
         "fn f() {\n  foo(1,\n    bar(2;\n  3)\n  );\n  let b = 1;\n}\n", false),
        (LanguageId::TypeScript, "r9_e3_ts_ml_nested_paren_semi_3rp_bad.ts",
         "function f() {\n  foo(1,\n    bar(2;\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  foo(1,\n    bar(2;\n  3);\n  const b = 1;\n}\n", false),
        (LanguageId::TypeScript, "r9_e3_ts_ml_nested_brack_semi_3rb_bad.ts",
         "function f() {\n  const x = [1,\n    [2;\n  // TODO\n  const b = 1;\n}\n",
         "function f() {\n  const x = [1,\n    [2;\n  3];\n  const b = 1;\n}\n", false),
        (LanguageId::Go, "r9_e3_go_mid_nested_paren_semi_bad.go",
         "package p\nfunc f() {\n  foo(1,\n    bar(2;\n  // TODO\n  b := 1\n}\n",
         "package p\nfunc f() {\n  foo(1,\n    bar(2;\n  3)\n  b := 1\n}\n", false),
        (LanguageId::Java, "r9_e3_java_mid_nested_paren_semi_bad.java",
         "class A {\n  void f() {\n    foo(1,\n      bar(2;\n    // TODO\n    int b = 1;\n  }\n}\n",
         "class A {\n  void f() {\n    foo(1,\n      bar(2;\n    3);\n    int b = 1;\n  }\n}\n", false),
        (LanguageId::Python, "r9_e3_py_mid_if_paren_x_eq_1_bad.py",
         "def f():\n  if (\n    # TODO\n  b = 1\n",
         "def f():\n  if (\n    x = 1\n  b = 1\n", false),
        (LanguageId::Python, "r9_e3_py_mid_if_paren_done_ok.py",
         "def f():\n  if (\n    # TODO\n  b = 1\n",
         "def f():\n  if (\n    # DONE\n  b = 1\n", true),
        (LanguageId::Python, "r9_e3_py_mid_if_paren_eq_eq_bad.py",
         "def f():\n  if (\n    # TODO\n  b = 1\n",
         "def f():\n  if (\n    x == 1\n  b = 1\n", false),
        (LanguageId::Ruby, "r9_e3_rb_mid_if_paren_x_eq_1_bad.rb",
         "def f\n  if (\n    # TODO\n  b = 1\nend\n",
         "def f\n  if (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r9_e3_rb_mid_if_paren_done_ok.rb",
         "def f\n  if (\n    # TODO\n  b = 1\nend\n",
         "def f\n  if (\n    # DONE\n  b = 1\nend\n", true),
        (LanguageId::Ruby, "r9_e3_rb_mid_if_paren_with_rp_ok.rb",
         "def f\n  if (\n    # TODO\n  )\n    b = 1\n  end\nend\n",
         "def f\n  if (\n    x = 1\n  )\n    b = 1\n  end\nend\n", true),
        (LanguageId::Python, "r9_e3_py_mid_arr_colon_close_bad.py",
         "def f():\n  x = [1,\n    [2:\n  # TODO\n  b = 1\n",
         "def f():\n  x = [1,\n    [2:\n  3]\n  b = 1\n", false),
        (LanguageId::TypeScript, "r9_e3_ts_ml_str_param_mid_cmt_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(\n    x: string = \"a\" + \"b\"\n  ) {\n    // TODO\n  }\n}\n",
         "class C {\n  broken = (1 + *)\n  return(\n    x: string = \"a\" + \"b\"\n  ) {\n    return x;\n  }\n}\n", true),
        (LanguageId::TypeScript, "r9_e3_ts_gen_star_ml_str_param_mid_ok.ts",
         "class C {\n  broken = (1 + *)\n  * return(\n    x: string = \"a\" + \"b\"\n  ) {\n    // TODO\n  }\n}\n",
         "class C {\n  broken = (1 + *)\n  * return(\n    x: string = \"a\" + \"b\"\n  ) {\n    yield x;\n  }\n}\n", true),
        (LanguageId::TypeScript, "r9_e3_ts_dangling_plus_in_kw_method_bad.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    const a = 1 +\n    // TODO\n  }\n}\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    const a = 1 +\n    const b = 2;\n  }\n}\n", false),
        (LanguageId::TypeScript, "r9_e3_ts_invalid_kw_lt_cmt_mid_bad.ts",
         "const x = keyof<T> { // cmt\n  // TODO\n}\n",
         "const x = keyof<T> { // cmt\n  const y = 1;\n}\n", false),
        // Combined r9_2 + r9_3 multi-closer EOF ts_kw_method case
        (LanguageId::TypeScript, "r9_e23_cls_ret_inner_lparen_multi_closer_eof_ok.ts",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    foo(\n      1\n",
         "class C {\n  broken = (1 + *)\n  return(x: number) {\n    foo(\n      1\n    );\n  }\n}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp_valid {
            failures.push(format!("{name}: exp={exp_valid} got={v:?}"));
        }
    }
    for kw in ["const", "let", "var"] {
        for expr in ["x<y && z", "x<y || z", "x<y + 1", "x<y - 1", "x<y * 2", "x<y / 2", "x<y % 2", "x<y == 1", "x<y != 1", "x<y << 1", "x<y && z<w", "x<y && z<MAX"] {
            let base = format!("{kw} a = {expr}, c<MY_TYPE, {{\n  a: string;\n");
            for (tag, tail) in [("ro", "  readonly b: string;\n"), ("spread", "  ...other,\n")] {
                let cand = format!("{base}{tail}");
                let v = fw.verify_incremental(Some(&base), &cand, Path::new("r4_e1_op.ts"), LanguageId::TypeScript);
                if v.is_valid() { failures.push(format!("r4_e1_{kw}_{expr}_{tag}: exp=false got={v:?}")); }
            }
        }
        let base = format!("{kw} a = foo<y, b = 1, c<MY_TYPE, {{\n  a: string;\n");
        for (tag, tail) in [("ro", "  readonly b: string;\n"), ("spread", "  ...other,\n")] {
            let cand = format!("{base}{tail}");
            let v = fw.verify_incremental(Some(&base), &cand, Path::new("r4_e1_ml.ts"), LanguageId::TypeScript);
            if v.is_valid() { failures.push(format!("r4_e1_ml_{kw}_{tag}: exp=false got={v:?}")); }
        }
    }
    for rhs in [
        "foo", "[1, 2]", "{ x: 1 }", "1.5", "\"hi\"", "1", "string",
        "(foo)", "a.b", "(Foo)", "typeof x", "`hi ${x}`", "(x: number) => x",
        "a & b", "a | b", "() => ({ a: 1 })", "(x) => x", "() => ({\n    a: 1,\n  })",
    ] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        for (tag, tail, exp) in [
            ("ro", "  readonly b: number;\n", true),
            ("expr", "  k2: 1 + 2,\n", true),
            ("spread", "  ...other,\n", true),
            ("ro_semi", "  readonly b: number;\n};\n", false),
        ] {
            let cand = format!("{base}{tail}");
            let v = fw.verify_incremental(Some(&base), &cand, Path::new("r4_e1_ambig.ts"), LanguageId::TypeScript);
            if v.is_valid() != exp { failures.push(format!("r4_e1_ambig_{rhs}_{tag}: exp={exp} got={v:?}")); }
        }
    }
    for rhs in [
        "!flag", "() => 1", "a ? 1 : 2", "x && y", "x ?? y", "arr[0]",
        "() => MyClass()", "~flags", "void 0", "a > b", "a < b",
        "a ^ b", "await bar", "new Foo", "a instanceof Foo", "\"x\" in obj",
        "x as const", "x satisfies Foo", "[1, 2] as const", "{ a: 1 } as const",
        "yield x", "x as number", "x satisfies number",
        "[\n    1,\n    2,\n  ] as const", "{\n    a: 1,\n  } as const",
    ] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        for (tag, tail, exp) in [
            ("expr", "  k2: 1 + 2,\n", true),
            ("spread", "  ...other,\n", true),
            ("ro", "  readonly b: number;\n", false),
        ] {
            let cand = format!("{base}{tail}");
            let v = fw.verify_incremental(Some(&base), &cand, Path::new("r4_e1_js.ts"), LanguageId::TypeScript);
            if v.is_valid() != exp { failures.push(format!("r4_e1_js_{rhs}_{tag}: exp={exp} got={v:?}")); }
        }
    }
    let mut r7_big_js = String::from("const a = 1, b = 2\nf<LIMIT, {\n  k: !flag,\n");
    let mut r7_big_ambig = String::from("const a = 1, b = 2\nf<LIMIT, {\n");
    for i in 0..800 {
        r7_big_js.push_str(&format!("  prop_number_{i}: 1,\n"));
        r7_big_ambig.push_str(&format!("  prop_number_{i}: 1,\n"));
    }
    for (name, base, tail, exp) in [
        ("r7_e1_big_js_ro_bad", r7_big_js.as_str(), "  readonly b: number;\n", false),
        ("r7_e1_big_js_expr_ok", r7_big_js.as_str(), "  k2: 1 + 2,\n", true),
        ("r7_e1_big_ambig_expr_ok", r7_big_ambig.as_str(), "  k2: 1 + 2,\n", true),
        ("r7_e1_big_ambig_ro_ok", r7_big_ambig.as_str(), "  readonly b: number;\n", true),
    ] {
        let cand = format!("{base}{tail}");
        let v = fw.verify_incremental(Some(base), &cand, Path::new("r7_big.ts"), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 8 Explorer 1: >16KB middle/single-prop, broken/multi-line/comma-less RHS, non-ident nested keys, keyword-attached <MY_TYPE, {
    for (name, base, cand, exp) in [
        ("r8_e1_ml_neg_empty_paren_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: - (),\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: - (),\n  readonly b: number;\n", false),
        ("r8_e1_ml_minus_empty_paren_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: a\n    - (),\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: a\n    - (),\n  readonly b: number;\n", false),
        ("r8_e1_ml_paren_star_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: (\n    1 + *\n  ),\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: (\n    1 + *\n  ),\n  readonly b: number;\n", false),
        ("r8_e1_ml_paren_star_k2_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: (\n    1 + *\n  ),\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: (\n    1 + *\n  ),\n  k2: 1 + 2,\n", true),
        ("r8_e1_nocomma_add_star_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: a +\n    b + *\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: a +\n    b + *\n  readonly b: number;\n", false),
        ("r8_e1_fn_void_ctrl_ro_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => void,\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: (x: number) => void,\n  readonly b: number;\n", true),
        ("r8_e1_type_broken_or_ro_ok.ts", "type T = Foo<A, {\n  k: string | ,\n", "type T = Foo<A, {\n  k: string | ,\n  readonly b: number;\n", true),
        ("r8_e1_nest_quoted_d_y_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r8_e1_nest_quoted_d_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": {\n    k: !flag,\n    readonly b: number;\n", false),
        ("r8_e1_nest_quoted_s_y_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  'nested': {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  'nested': {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r8_e1_nest_computed_y_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  [key]: {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  [key]: {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r8_e1_nest_numeric_y_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  0: {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  0: {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r8_e1_nest_sib_quoted_y_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  other: 1,\n  \"nested\": {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  other: 1,\n  \"nested\": {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r8_e1_kw_impl_m_bad.ts", "class C\n  implements<MY_TYPE, {\n", "class C\n  implements<MY_TYPE, {\n  m() {}\n", false),
        ("r8_e1_kw_as_spread_bad.ts", "const x = foo as<MY_TYPE, {\n", "const x = foo as<MY_TYPE, {\n  ...other,\n", false),
        ("r8_e1_kw_sat_spread_bad.ts", "const x = foo satisfies<MY_TYPE, {\n", "const x = foo satisfies<MY_TYPE, {\n  ...other,\n", false),
        ("r8_e1_kw_nl_as_spread_asi_ok.ts", "const x = foo\n  as<MY_TYPE, {\n", "const x = foo\n  as<MY_TYPE, {\n  ...other,\n", true),
        ("r8_e1_kw_exp_def_lt_ro_bad.ts", "export default<MY_TYPE, {\n  a: string;\n", "export default<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        ("r8_e1_kw_exp_def_arrow_ro_ok.ts", "export default <T = {\n  a: string;\n", "export default <T = {\n  a: string;\n  readonly b: string;\n", true),
        ("r8_e1_kw_keyof_lt_ro_bad.ts", "type T = keyof<MY_TYPE, {\n  a: string;\n", "type T = keyof<MY_TYPE, {\n  a: string;\n  readonly b: string;\n", false),
        ("r8_e1_kw_exp_def_cmt_ro_bad.ts", "export default<MY_TYPE, {\n  // TODO\n", "export default<MY_TYPE, {\n  readonly b: string;\n", false),
        ("r8_e1_kw_exp_def_mid_cmt_ro_bad.ts", "export default<MY_TYPE, {\n  // TODO\n}\n", "export default<MY_TYPE, {\n  readonly b: string;\n}\n", false),
        ("r8_e1_kw_exp_def_mid_cmt_done_ok.ts", "export default<MY_TYPE, {\n  // TODO\n}\n", "export default<MY_TYPE, {\n  // DONE\n}\n", true),
        ("r8_e1_kw_impl_mid_cmt_m_bad.ts", "class C\n  implements<MY_TYPE, {\n  // TODO\n}\n", "class C\n  implements<MY_TYPE, {\n  m() {}\n}\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    for rhs in ["a & ", "a | ", "a << ", "a >> ", "a === ", "a != ", "~ ", "! ", "await ", "typeof ", "void ", "delete ", "new "] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        for (tag, tail, exp) in [("ro", "  readonly b: number;\n", false), ("k2", "  k2: 1 + 2,\n", true)] {
            let cand = format!("{base}{tail}");
            let v = fw.verify_incremental(Some(&base), &cand, Path::new("r8_e1_brk.ts"), LanguageId::TypeScript);
            if v.is_valid() != exp { failures.push(format!("r8_e1_brk_{rhs}_{tag}: exp={exp} got={v:?}")); }
        }
    }
    let yield_base = "const a = 1, b = 2\nf<LIMIT, {\n  k: yield ,\n";
    if fw.verify_incremental(Some(yield_base), &format!("{yield_base}  readonly b: number;\n"), Path::new("r8_y.ts"), LanguageId::TypeScript).is_valid() {
        failures.push("r8_e1_brk_yield_ro: exp=false".to_string());
    }
    let mut r8_big_mid = String::from("const a = 1, b = 2\nf<LIMIT, {\n");
    for i in 0..350 { r8_big_mid.push_str(&format!("  prop_name_padding_key_{i}: 1,\n")); }
    r8_big_mid.push_str("  k_mid: !flag,\n");
    for i in 350..700 { r8_big_mid.push_str(&format!("  prop_name_padding_key_{i}: 1,\n")); }
    let big_s = "a".repeat(20000);
    let r8_big_lit = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: \"{big_s}\",\n");
    let r8_big_new = format!("const a = 1\nf<LIMIT, {{\n  k: new Foo(\"{big_s}\"),\n");
    for (name, base, tail, exp) in [
        ("r8_e1_big_mid_ro_bad", r8_big_mid.as_str(), "  readonly b: number;\n", false),
        ("r8_e1_big_mid_expr_ok", r8_big_mid.as_str(), "  k2: 1 + 2,\n", true),
        ("r8_e1_big_single_lit_k2_ok", r8_big_lit.as_str(), "  k2: 1 + 2,\n", true),
        ("r8_e1_big_single_new_k2_ok", r8_big_new.as_str(), "  k2: 1 + 2,\n", true),
        ("r8_e1_big_single_new_ro_bad", r8_big_new.as_str(), "  readonly b: number;\n", false),
    ] {
        let cand = format!("{base}{tail}");
        let v = fw.verify_incremental(Some(base), &cand, Path::new("r8_big.ts"), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 9 Explorer 1: UTF-8/comment offsets, >16KB short-string delimiters, >384KB/>1MB tail+middle, valid TS generics/negatives, nested key comments
    for (name, base, cand, exp) in [
        ("r9_e1_utf8_cmt_no_panic_k3.ts", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n  ???\n", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n  ???\n  k3: 1,\n", true),
        ("r9_e1_utf8_cmt_valid_ro.ts", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n  readonly c: number;\n", true),
        ("r9_e1_utf8_cmt_brk_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n  c: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  /*  */ a: 1,\n  b: \"éééééééé\",\n  c: !flag,\n  readonly d: number;\n", false),
        ("r9_e1_nest_cmt_after_colon_y.ts", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": /* c */ {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\": /* c */ {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r9_e1_nest_cmt_before_colon_y.ts", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\" /* c */ : {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  \"nested\" /* c */ : {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r9_e1_nest_squote_both_cmt_y.ts", "const a = 1, b = 2\nf<LIMIT, {\n  'nested' /* c */ : /* c */ {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  'nested' /* c */ : /* c */ {\n    k: !flag,\n    y: 1 + 2,\n", true),
        ("r9_e1_nest_backtick_key_y_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    k: !flag,\n    y: 1 + 2,\n", false),
        ("r9_e1_nest_comp_backtick_y.ts", "const a = 1, b = 2\nf<LIMIT, {\n  [`nested`] /* c */ : /* c */ {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  [`nested`] /* c */ : /* c */ {\n    k: !flag,\n    y: 1 + 2,\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    for rhs in [
        "Array<Array<number>>", "Map<string, Array<number>>", "Array<string >",
        "Partial<Record<string, number> >", "Foo<A >", "-1 | -2", "1 | -1",
        "(-1)", "(x: -1) => void", "{ x: -1 }", "1e-5", "1E-5",
    ] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        let v = fw.verify_incremental(Some(&base), &format!("{base}  readonly b: number;\n"), Path::new("r9_ts.ts"), LanguageId::TypeScript);
        if !v.is_valid() { failures.push(format!("r9_e1_valid_ts_{rhs}: exp=true got={v:?}")); }
    }
    for rhs in ["a - 1", "Foo<A> - 1", "e-5", "a1e-5", "a > ", "Array<a >> "] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        if fw.verify_incremental(Some(&base), &format!("{base}  readonly b: number;\n"), Path::new("r9_brk.ts"), LanguageId::TypeScript).is_valid() {
            failures.push(format!("r9_e1_brk_ro_{rhs}: exp=false"));
        }
    }
    let r9_small_comp = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k1: \"{big_s}\",\n  k2: \"{{\",\n");
    let mut r9_chunked = String::from("const a = 1, b = 2\nf<LIMIT, {\n  k: \"{\",\n");
    for i in 0..900 { r9_chunked.push_str(&format!("  prop_padding_item_{i}: 1,\n")); }
    let mut r9_410k = String::from("const a = 1, b = 2\nf<LIMIT, {\n");
    for i in 0..14200 { r9_410k.push_str(&format!("  prop_key_name_{i}: 1,\n")); }
    let r9_410k_call = format!("{r9_410k}  k_late: foo(),\n");
    let r9_410k_tern = format!("{r9_410k}  k_late: x ? 1 : 2,\n");
    let mut r9_1100k_mid = String::from("const a = 1, b = 2\nf<LIMIT, {\n");
    for i in 0..20000 { r9_1100k_mid.push_str(&format!("  prop_key_name_{i}: 1,\n")); }
    r9_1100k_mid.push_str("  k_mid: x ? 1 : 2,\n");
    for i in 20000..40000 { r9_1100k_mid.push_str(&format!("  prop_key_name_{i}: 1,\n")); }
    for (name, base, tail, exp) in [
        ("r9_e1_small_comp_k3_ok", r9_small_comp.as_str(), "  k3: 1 + 2,\n", true),
        ("r9_e1_small_comp_ro_ok", r9_small_comp.as_str(), "  readonly c: number;\n", true),
        ("r9_e1_chunked_k2_ok", r9_chunked.as_str(), "  k2: 1 + 2,\n", true),
        ("r9_e1_chunked_ro_ok", r9_chunked.as_str(), "  readonly c: number;\n", true),
        ("r9_e1_410k_tail_call_ro_bad", r9_410k_call.as_str(), "  readonly b: number;\n", false),
        ("r9_e1_410k_tail_tern_ro_bad", r9_410k_tern.as_str(), "  readonly b: number;\n", false),
        ("r9_e1_1100k_mid_tern_ro_bad", r9_1100k_mid.as_str(), "  readonly b: number;\n", false),
    ] {
        let cand = format!("{base}{tail}");
        let v = fw.verify_incremental(Some(base), &cand, Path::new("r9_big.ts"), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 10 Explorer 1: >16KB UTF-8 strings/templates, string/template unions, 1_000e-5, unbracketed backtick key + readonly
    let x20k = "x".repeat(20000);
    let r5k = "🚀".repeat(5000);
    let r10_x20k_rocket = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k1: \"{x20k}\",\n  k2: \"🚀\",\n");
    let r10_5k_rocket = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: \"{r5k}\",\n");
    let r10_ml_t_gt16 = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k1: \"{x20k}\",\n  k2: `🚀🚀🚀🚀🚀\n🚀🚀🚀🚀🚀`,\n");
    for (name, base, tail, exp) in [
        ("r10_e1_x20k_rocket_ro_ok", r10_x20k_rocket.as_str(), "  readonly c: number;\n", true),
        ("r10_e1_x20k_rocket_y_ok", r10_x20k_rocket.as_str(), "  y: 1 + 2,\n", true),
        ("r10_e1_5k_rocket_ro_ok", r10_5k_rocket.as_str(), "  readonly c: number;\n", true),
        ("r10_e1_ml_tmpl_utf8_ro_ok", r10_ml_t_gt16.as_str(), "  readonly c: number;\n", true),
    ] {
        let cand = format!("{base}{tail}");
        let v = fw.verify_incremental(Some(base), &cand, Path::new("r10_utf8.ts"), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    for (name, base, cand, exp) in [
        ("r10_e1_str_union_arr_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | \"b\",\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | \"b\",\n  c: string[],\n", true),
        ("r10_e1_str_union_fn_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | \"b\",\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | \"b\",\n  c: (x: number) => void,\n", true),
        ("r10_e1_tmpl_union_arr_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: `a` | `b`,\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: `a` | `b`,\n  c: string[],\n", true),
        ("r10_e1_tmpl_interp_union_ok.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: `a_${string}` | `b_${number}`,\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: `a_${string}` | `b_${number}`,\n  c: string[],\n", true),
        ("r10_e1_str_plus_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" + \"b\",\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" + \"b\",\n  readonly b: number;\n", false),
        ("r10_e1_str_broken_or_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | ,\n", "const a = 1, b = 2\nf<LIMIT, {\n  k: \"a\" | ,\n  readonly b: number;\n", false),
        ("r10_e1_nest_backtick_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    k: !flag,\n", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    k: !flag,\n    readonly b: number;\n", false),
        ("r10_e1_nest_backtick_empty_ro_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    readonly b: number;\n", false),
        ("r10_e1_nest_backtick_empty_const_bad.ts", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n", "const a = 1, b = 2\nf<LIMIT, {\n  `nested`: {\n    const x = 1;\n", false),
        ("r10_e1_type_cond_backtick_ro_ok.ts", "type T<A> = A extends B ? `a` : {\n  readonly x: number;\n", "type T<A> = A extends B ? `a` : {\n  readonly x: number;\n  readonly y: string;\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), LanguageId::TypeScript);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    for rhs in ["1_000e-5", "1_000.5e-5", "1_000e-1_0", "1_000E+5", "1_000_000e-2"] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        let v = fw.verify_incremental(Some(&base), &format!("{base}  readonly b: number;\n"), Path::new("r10_sci.ts"), LanguageId::TypeScript);
        if !v.is_valid() { failures.push(format!("r10_e1_valid_sci_{rhs}: exp=true got={v:?}")); }
    }
    for rhs in ["_e-5", "_1e-5", ".e-5", "a1e-5", "1_e-5"] {
        let base = format!("const a = 1, b = 2\nf<LIMIT, {{\n  k: {rhs},\n");
        if fw.verify_incremental(Some(&base), &format!("{base}  readonly b: number;\n"), Path::new("r10_sci_brk.ts"), LanguageId::TypeScript).is_valid() {
            failures.push(format!("r10_e1_brk_sci_{rhs}: exp=false"));
        }
    }
    // Iter 10 Explorer 2: extends</await< & sibling kw<MY_TYPE,{, same-line opener after {, TSX interleaved closer & partial child EOF
    for (name, lang, base, cand, exp) in [
        ("r10_e2_kw_extends_cls_bad.ts", LanguageId::TypeScript, "class C extends<MY_TYPE, {\n", "class C extends<MY_TYPE, {\n  m() {}\n", false),
        ("r10_e2_kw_extends_sp_bad.ts", LanguageId::TypeScript, "class C extends <MY_TYPE, {\n", "class C extends <MY_TYPE, {\n  m() {}\n", false),
        ("r10_e2_kw_extends_nl_bad.ts", LanguageId::TypeScript, "class C\n  extends<MY_TYPE, {\n", "class C\n  extends<MY_TYPE, {\n  m() {}\n", false),
        ("r10_e2_kw_extends_mid_bad.ts", LanguageId::TypeScript, "class C extends<MY_TYPE, {\n  // TODO\n}\n", "class C extends<MY_TYPE, {\n  m() {}\n}\n", false),
        ("r10_e2_kw_extends_nested_type_bad.ts", LanguageId::TypeScript, "type T = Foo<A, B extends<MY_TYPE, {\n", "type T = Foo<A, B extends<MY_TYPE, {\n  a: string;\n", false),
        ("r10_e2_kw_extends_cls_def_bad.ts", LanguageId::TypeScript, "class C extends <A = {\n  x: number;\n", "class C extends <A = {\n  x: number;\n  readonly y: string;\n", false),
        ("r10_e2_kw_extends_cond_fn_ok.ts", LanguageId::TypeScript, "type F<T> = T extends <A>(x: A) => {\n", "type F<T> = T extends <A>(x: A) => {\n  a: A;\n", true),
        ("r10_e2_kw_extends_cond_fn_def_ok.ts", LanguageId::TypeScript, "type F<T> = T extends <A = {\n  x: number;\n", "type F<T> = T extends <A = {\n  x: number;\n  readonly y: string;\n", true),
        ("r10_e2_kw_extends_tparam_ext_ok.ts", LanguageId::TypeScript, "class C<T extends <A extends {\n  x: number;\n", "class C<T extends <A extends {\n  x: number;\n  readonly y: string;\n", true),
        ("r10_e2_kw_await_async_bad.ts", LanguageId::TypeScript, "async function f() {\n  await<MY_TYPE, {\n", "async function f() {\n  await<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_await_mid_bad.ts", LanguageId::TypeScript, "async function f() {\n  await<MY_TYPE, {\n  // TODO\n}\n}\n", "async function f() {\n  await<MY_TYPE, {\n  a: 1,\n}\n}\n", false),
        ("r10_e2_kw_for_await_ok.ts", LanguageId::TypeScript, "async function f(xs: any) {\n  for await (const x of xs) {\n", "async function f(xs: any) {\n  for await (const x of xs) {\n    console.log(x);\n", true),
        ("r10_e2_kw_obj_await_ok.ts", LanguageId::TypeScript, "const x = obj.await<MY_TYPE, {\n  a: 1,\n", "const x = obj.await<MY_TYPE, {\n  a: 1,\n  b: 2,\n", true),
        ("r10_e2_kw_return_lt_bad.ts", LanguageId::TypeScript, "function f() {\n  return<MY_TYPE, {\n", "function f() {\n  return<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_return_mid_bad.ts", LanguageId::TypeScript, "function f() {\n  return<MY_TYPE, {\n  // TODO\n}\n}\n", "function f() {\n  return<MY_TYPE, {\n  a: 1,\n}\n}\n", false),
        ("r10_e2_kw_return_gen_arrow_ok.ts", LanguageId::TypeScript, "function f() {\n  return <T = {\n    a: number;\n", "function f() {\n  return <T = {\n    a: number;\n    readonly b: string;\n", true),
        ("r10_e2_kw_throw_lt_bad.ts", LanguageId::TypeScript, "function f() {\n  throw<MY_TYPE, {\n", "function f() {\n  throw<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_yield_lt_bad.ts", LanguageId::TypeScript, "function* g() {\n  yield<MY_TYPE, {\n", "function* g() {\n  yield<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_typeof_lt_bad.ts", LanguageId::TypeScript, "type T = typeof<MY_TYPE, {\n", "type T = typeof<MY_TYPE, {\n  a: number;\n", false),
        ("r10_e2_kw_in_lt_bad.ts", LanguageId::TypeScript, "const x = k in<MY_TYPE, {\n", "const x = k in<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_instanceof_lt_bad.ts", LanguageId::TypeScript, "const x = k instanceof<MY_TYPE, {\n", "const x = k instanceof<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_new_lt_bad.ts", LanguageId::TypeScript, "const x = new<MY_TYPE, {\n", "const x = new<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_else_lt_bad.ts", LanguageId::TypeScript, "if (a) {} else<MY_TYPE, {\n", "if (a) {} else<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_kw_for_of_lt_bad.ts", LanguageId::TypeScript, "for (const x of<MY_TYPE, {\n", "for (const x of<MY_TYPE, {\n  a: 1,\n", false),
        ("r10_e2_same_line_lp_after_brace_bad.ts", LanguageId::TypeScript, "f(foo as<MY_TYPE, { bar(\n", "f(foo as<MY_TYPE, { bar(\n  1\n)\n", false),
        ("r10_e2_same_line_brack_after_brace_bad.ts", LanguageId::TypeScript, "f(foo as<MY_TYPE, { bar[\n", "f(foo as<MY_TYPE, { bar[\n  0\n]\n", false),
        ("r10_e2_same_line_nested_brace_lp_bad.ts", LanguageId::TypeScript, "f(foo as<MY_TYPE, { x: { bar(\n", "f(foo as<MY_TYPE, { x: { bar(\n  1\n)\n", false),
        ("r10_e2_same_line_impl_lp_bad.ts", LanguageId::TypeScript, "class C implements<MY_TYPE, { m(\n", "class C implements<MY_TYPE, { m(\n  x: number\n)\n", false),
        ("r10_e2_tsx_inner_map_ok.tsx", LanguageId::Tsx, "function C() {\n  return (<div>\n    {items.map(x => (\n", "function C() {\n  return (<div>\n    {items.map(x => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        ("r10_e2_tsx_inner_map_frag_ok.tsx", LanguageId::Tsx, "function C() {\n  return (<>\n    {items.map(x => (\n", "function C() {\n  return (<>\n    {items.map(x => (\n      <span>{x}</span>\n    ))}\n  </>);\n", true),
        ("r10_e2_tsx_partial_child_eof_ok.tsx", LanguageId::Tsx, "function C() {\n  return (<div>\n", "function C() {\n  return (<div>\n    <span>hi</span>\n", true),
        ("r10_e2_tsx_inner_map_partial_child_ok.tsx", LanguageId::Tsx, "function C() {\n  return (<div>\n    {items.map(x => (\n", "function C() {\n  return (<div>\n    {items.map(x => (\n      <span>{x}</span>\n", true),
        ("r10_e2_tsx_partial_child_unclosed_span_bad.tsx", LanguageId::Tsx, "function C() {\n  return (<div>\n", "function C() {\n  return (<div>\n    <span>hi\n", false),
        ("r10_e2_tsx_partial_child_expr_bad.tsx", LanguageId::Tsx, "function C() {\n  return (<div>\n", "function C() {\n  return (<div>\n    {1 + *}\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 10 Explorer 3: Python/Ruby control-paren, Rust midfile repeat-array/struct-lit, Python lambda, Python if ( EOF
    for (lang, name, base, cand, exp) in [
        (LanguageId::Python, "r10_e3_py_if_paren_later_suf_err_ok.py",
         "def f():\n  if (\n    # TODO\n  ):\n    b = 1\n  broken = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n  ):\n    b = 1\n  broken = (1 + *)\n", true),
        (LanguageId::Python, "r10_e3_py_if_paren_4space_later_err_ok.py",
         "def f():\n    if (\n        # TODO\n    ):\n        b = 1\n    broken = (1 + *)\n",
         "def f():\n    if (\n        x == 1\n    ):\n        b = 1\n    broken = (1 + *)\n", true),
        (LanguageId::Python, "r10_e3_py_if_paren_multicond_later_err_ok.py",
         "def f():\n  if (\n    # TODO\n    and a == 1\n  ):\n    b = 1\n  broken = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n    and a == 1\n  ):\n    b = 1\n  broken = (1 + *)\n", true),
        (LanguageId::Python, "r10_e3_py_if_paren_sibling_stmt_later_err_ok.py",
         "def f():\n  if (\n    # TODO\n  ):\n    b = 1\n    c = 2\n  broken = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n  ):\n    b = 1\n    c = 2\n  broken = (1 + *)\n", true),
        (LanguageId::Python, "r10_e3_py_if_valid_rp_suf1_broken_ok.py",
         "def f():\n  if (\n    # TODO\n  ):\n    b = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n  ):\n    b = (1 + *)\n", true),
        (LanguageId::Python, "r10_e3_py_if_valid_rp_suf0_broken_ok.py",
         "def f():\n  if (\n    # TODO\n  ): b = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n  ): b = (1 + *)\n", true),
        (LanguageId::Ruby, "r10_e3_rb_if_paren_extra_end_later_err_ok.rb",
         "def f\n  if (\n    # TODO\n    a == 1\n  )\n    b = 1\n  end\n  broken = (1 + *)\nend\n",
         "def f\n  if (\n    x == 1 &&\n    a == 1\n  )\n    b = 1\n  end\n  broken = (1 + *)\nend\n", true),
        (LanguageId::Ruby, "r10_e3_rb_if_valid_suf0_broken_ok.rb",
         "def f\n  if (\n    # TODO\n  ) then b = (1 + *) end\nend\n",
         "def f\n  if (\n    x = 1\n  ) then b = (1 + *) end\nend\n", true),
        (LanguageId::Python, "r10_e3_py_if_with_rp_later_broken_ok.py",
         "def f():\n  if (\n    # TODO\n  ):\n    y = (1 + *)\n",
         "def f():\n  if (\n    x == 1\n  ):\n    y = (1 + *)\n", true),
        (LanguageId::Ruby, "r10_e3_rb_while_paren_x_eq_1_bad.rb",
         "def f\n  while (\n    # TODO\n  b = 1\nend\n",
         "def f\n  while (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_elsif_paren_x_eq_1_bad.rb",
         "def f(a)\n  if a\n    c = 1\n  elsif (\n    # TODO\n  b = 1\nend\n",
         "def f(a)\n  if a\n    c = 1\n  elsif (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_unless_paren_x_eq_1_bad.rb",
         "def f\n  unless (\n    # TODO\n  b = 1\nend\n",
         "def f\n  unless (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_until_paren_x_eq_1_bad.rb",
         "def f\n  until (\n    # TODO\n  b = 1\nend\n",
         "def f\n  until (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_assign_paren_stmt_bad.rb",
         "def f\n  x = (\n    # TODO\n  b = 1\nend\n",
         "def f\n  x = (\n    y = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_assign_if_paren_x_eq_1_bad.rb",
         "def f\n  y = if (\n    # TODO\n  b = 1\nend\n",
         "def f\n  y = if (\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r10_e3_rb_call_paren_x_eq_1_bad.rb",
         "def f\n  foo(\n    # TODO\n  b = 1\nend\n",
         "def f\n  foo(\n    x = 1\n  b = 1\nend\n", false),
        (LanguageId::Python, "r10_e3_py_elif_paren_top_eq_eq_bad.py",
         "if a:\n  pass\nelif (\n  # TODO\nb = 1\n",
         "if a:\n  pass\nelif (\n  x == 1\nb = 1\n", false),
        (LanguageId::Python, "r10_e3_py_if_code_replace_x_eq_eq_bad.py",
         "def f():\n  if (\n    y == 2\n  b = 1\n",
         "def f():\n  if (\n    x == 1\n  b = 1\n", false),
        (LanguageId::Ruby, "r10_e3_rb_if_no_rp_code_replace_bad.rb",
         "def f\n  if (\n    x = 1\n  b = 1\nend\n",
         "def f\n  if (\n    y = 2\n  b = 1\nend\n", false),
        (LanguageId::Rust, "r10_e3_rs_repeat_array_rbrace_earlier_err_ok.rs",
         "fn f() {\n  let broken = (1 + *);\n  let x = [1,\n    [2;\n  // TODO\nfn g() {}\n",
         "fn f() {\n  let broken = (1 + *);\n  let x = [1,\n    [2;\n  3]];\n}\nfn g() {}\n", true),
        (LanguageId::Rust, "r10_e3_rs_struct_lit_repeat_array_after_err_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let s = Foo {\n    a: [1,\n      [2;\n    // TODO\n  };\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let s = Foo {\n    a: [1,\n      [2;\n    3]],\n  };\n}\n", true),
        (LanguageId::Python, "r10_e3_py_valid_lambda_after_earlier_err_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n  x + 1)\n  b = 1\n", true),
        (LanguageId::Python, "r10_e3_py_valid_lambda_indented_after_earlier_err_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n    # TODO\n  )\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n    x + 1\n  )\n  b = 1\n", true),
        (LanguageId::Python, "r10_e3_py_if_paren_eof_x_eq_eq_1_ok.py",
         "def f():\n  if (\n    # TODO\n",
         "def f():\n  if (\n    x == 1\n", true),
        (LanguageId::Python, "r10_e3_py_elif_eof_ok.py",
         "if a:\n  pass\nelif (\n  # TODO\n",
         "if a:\n  pass\nelif (\n  x == 1\n", true),
        (LanguageId::Python, "r10_e3_py_elif_ind_eof_ok.py",
         "def f():\n  if a:\n    pass\n  elif (\n    # TODO\n",
         "def f():\n  if a:\n    pass\n  elif (\n    x == 1\n", true),
        (LanguageId::Python, "r10_e3_py_while_eof_ok.py",
         "def f():\n  while (\n    # TODO\n",
         "def f():\n  while (\n    x == 1\n", true),
        (LanguageId::Python, "r10_e3_py_if_cmt_only_suf_ok.py",
         "def f():\n  if (\n    # TODO\n  # tail\n",
         "def f():\n  if (\n    x == 1\n  # tail\n", true),
        (LanguageId::Python, "r10_e3_py_broken_colon_call_bad.py",
         "def f():\n  foo(a:\n  # TODO\n  b = 1\n",
         "def f():\n  foo(a:\n  x + 1)\n  b = 1\n", false),
        (LanguageId::Python, "r10_e3_py_lambda_assign_bad.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n    # TODO\n  )\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x:\n    x = 1\n  )\n  b = 1\n", false),
        (LanguageId::Rust, "r10_e3_rs_tail_struct_lit_no_semi_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() -> Foo {\n  let broken = (1 + *);\n  Foo {\n    a: [1,\n      [2;\n    // TODO\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() -> Foo {\n  let broken = (1 + *);\n  Foo {\n    a: [1,\n      [2;\n    3]],\n  }\n}\n", true),
        (LanguageId::Rust, "r10_e3_rs_mod_fn_2rbrace_after_err_ok.rs",
         "mod m {\n  fn f() {\n    let broken = (1 + *);\n    let x = [1,\n      [2;\n    // TODO\n}\nfn g() {}\n",
         "mod m {\n  fn f() {\n    let broken = (1 + *);\n    let x = [1,\n      [2;\n    3]];\n  }\n}\nfn g() {}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 11 Explorer 1: unbracketed backtick keys (${...} & ValueBrace), reserved control keywords + default< + export default class extends< + for (x of<, else <T = {
    for (lang, name, base, cand, exp) in [
        (LanguageId::TypeScript, "r11_e1_bt_interp_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  `nested_${x}`: {\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  `nested_${x}`: {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_interp_cmt_ro_bad.ts",
         "const a = 1, b = 2\nf<LIMIT, {\n  `a_${x}` /* c */ : {\n",
         "const a = 1, b = 2\nf<LIMIT, {\n  `a_${x}` /* c */ : {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_valbrace_y_bad.ts",
         "const o = {\n  `nested`: {\n",
         "const o = {\n  `nested`: {\n    y: 1 + 2,\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_valbrace_k_bad.ts",
         "const o = {\n  `nested`: {\n",
         "const o = {\n  `nested`: {\n    k: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_valbrace_interp_k_bad.ts",
         "const o = {\n  `a_${x}`: {\n",
         "const o = {\n  `a_${x}`: {\n    k: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_valbrace_nonempty_y_bad.ts",
         "const o = {\n  `nested`: {\n    k: 1,\n",
         "const o = {\n  `nested`: {\n    k: 1,\n    y: 1 + 2,\n", false),
        (LanguageId::TypeScript, "r11_e1_bt_comp_valbrace_ok.ts",
         "const o = {\n  [`a_${x}`]: {\n",
         "const o = {\n  [`a_${x}`]: {\n    k: 1,\n", true),
        (LanguageId::TypeScript, "r11_e1_bt_tern_valbrace_ok.ts",
         "const o = {\n  a: cond ? `a_${x}` : {\n",
         "const o = {\n  a: cond ? `a_${x}` : {\n    k: 1,\n", true),
        (LanguageId::TypeScript, "r11_e1_bt_tern_type_interp_ok.ts",
         "type T<A> = A extends B ? `a_${string}` : {\n  readonly x: number;\n",
         "type T<A> = A extends B ? `a_${string}` : {\n  readonly x: number;\n  readonly y: string;\n", true),
        (LanguageId::TypeScript, "r11_e1_kw_if_lt_bad.ts", "if<MY_TYPE, {\n", "if<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_if_sp_lt_bad.ts", "if <MY_TYPE, {\n", "if <MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_while_lt_bad.ts", "while<MY_TYPE, {\n", "while<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_try_lt_bad.ts", "try<MY_TYPE, {\n", "try<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_finally_lt_bad.ts", "try {} finally<MY_TYPE, {\n", "try {} finally<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_do_lt_bad.ts", "do<MY_TYPE, {\n", "do<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_switch_lt_bad.ts", "switch<MY_TYPE, {\n", "switch<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_catch_lt_bad.ts", "try {} catch<MY_TYPE, {\n", "try {} catch<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_for_lt_bad.ts", "for<MY_TYPE, {\n", "for<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_with_lt_bad.ts", "with<MY_TYPE, {\n", "with<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_exp_def_cls_ext_bad.ts",
         "export default class C extends <A = {\n  x: number;\n",
         "export default class C extends <A = {\n  x: number;\n  readonly y: string;\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_default_def_lt_bad.ts",
         "switch (x) { default <A = {\n  x: number;\n",
         "switch (x) { default <A = {\n  x: number;\n  readonly y: string;\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_default_stmt_lt_bad.ts",
         "switch (x) { default<MY_TYPE, {\n",
         "switch (x) { default<MY_TYPE, {\n  const y = 1;\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_default_lt_bad.ts",
         "switch (x) { default<MY_TYPE, {\n",
         "switch (x) { default<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_for_x_of_lt_bad.ts",
         "for (x of<MY_TYPE, {\n",
         "for (x of<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_for_await_x_of_lt_bad.ts",
         "async function f() {\n  for await (x of<MY_TYPE, {\n",
         "async function f() {\n  for await (x of<MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e1_kw_obj_if_ok.ts",
         "const x = obj.if<MY_TYPE, {\n  a: 1,\n",
         "const x = obj.if<MY_TYPE, {\n  a: 1,\n  b: 2,\n", true),
        (LanguageId::TypeScript, "r11_e1_kw_cls_try_method_ok.ts",
         "class C {\n  try<T>(x: T) {\n",
         "class C {\n  try<T>(x: T) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r11_e1_kw_for_let_eq_of_ok.ts",
         "for (let x = of<MY_TYPE, {\n  a: 1,\n",
         "for (let x = of<MY_TYPE, {\n  a: 1,\n  b: 2,\n", true),
        (LanguageId::TypeScript, "r11_e1_else_gen_arrow_ok.ts",
         "if (a) {} else <T = {\n  a: number;\n",
         "if (a) {} else <T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r11_e1_else_gen_arrow_empty_ok.ts",
         "if (a) {} else <T = {\n",
         "if (a) {} else <T = {\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r11_e1_else_gen_arrow_nl_ok.ts",
         "if (a) b = 1\nelse <T = {\n  a: number;\n",
         "if (a) b = 1\nelse <T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r11_e1_else_gen_arrow_bad_prop.ts",
         "if (a) {} else <T = {\n  a: number;\n",
         "if (a) {} else <T = {\n  a: number;\n  k: 1 + 2,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 11 Explorer 2: has_unrec / case< & default<, TSX interleaved closers & <T extends Foo>, Py EOF trailing #
    for (lang, name, base, cand, exp) in [
        (LanguageId::TypeScript, "r11_e2_switch_case_lt_eof_bad.ts", "switch (x) { case<MY_TYPE, {\n", "switch (x) { case<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e2_switch_case_sp_lt_eof_bad.ts", "switch (x) { case <MY_TYPE, {\n", "switch (x) { case <MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e2_switch_case_lt_mid_bad.ts", "switch (x) { case<MY_TYPE, {\n  // TODO\n}>();\n}\n", "switch (x) { case<MY_TYPE, {\n  a: 1,\n}>();\n}\n", false),
        (LanguageId::TypeScript, "r11_e2_switch_case_lt_mid_cmt_ok.ts", "switch (x) { case<MY_TYPE, {\n  // TODO\n}\n}\n", "switch (x) { case<MY_TYPE, {\n  // DONE\n}\n}\n", true),
        (LanguageId::TypeScript, "r11_e2_switch_case_lt_ml_eof_bad.ts", "switch (x) {\n  case<MY_TYPE, {\n", "switch (x) {\n  case<MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e2_switch_default_lt_eof_bad.ts", "switch (x) { default<MY_TYPE, {\n", "switch (x) { default<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r11_e2_switch_default_lt_mid_bad.ts", "switch (x) { default<MY_TYPE, {\n  // TODO\n}>();\n}\n", "switch (x) { default<MY_TYPE, {\n  a: 1,\n}>();\n}\n", false),
        (LanguageId::Tsx, "r11_e2_tsx_cand_unclosed_map_bad.tsx", "function C() {\n  return (<div>\n", "function C() {\n  return (<div>\n    {items.map(x => (\n      <span>{x}</span>\n", false),
        (LanguageId::Tsx, "r11_e2_tsx_cand_unclosed_arr_bad.tsx", "function C() {\n  return (<div>\n", "function C() {\n  return (<div>\n    {arr[\n", false),
        (LanguageId::Tsx, "r11_e2_tsx_close_map_leave_div_ok.tsx", "function C() {\n  return (<div>\n    {items.map(x => (\n      <span>{x}</span>\n", "function C() {\n  return (<div>\n    {items.map(x => (\n      <span>{x}</span>\n    ))}\n", true),
        (LanguageId::Tsx, "r11_e2_tsx_t_extends_foo_ok.tsx", "function C() {\n  return (<div>\n    {items.map(<T extends Foo>(x: T) => (\n", "function C() {\n  return (<div>\n    {items.map(<T extends Foo>(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r11_e2_tsx_t_extends_obj_ok.tsx", "function C() {\n  return (<div>\n    {items.map(<T extends { a: number }>(x: T) => (\n", "function C() {\n  return (<div>\n    {items.map(<T extends { a: number }>(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r11_e2_tsx_t_extends_fn_ok.tsx", "function C() {\n  return (<div>\n    {items.map(<T extends () => void>(x: T) => (\n", "function C() {\n  return (<div>\n    {items.map(<T extends () => void>(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r11_e2_tsx_jsx_extends_attr_bad.tsx", "function C() {\n  return (<div>\n    <Comp extends={true}>\n", "function C() {\n  return (<div>\n    <Comp extends={true}>\n    </div>);\n", false),
        (LanguageId::Python, "r11_e2_py_if_eof_trailing_cmt_ok.py", "def f():\n  if (\n    # TODO\n", "def f():\n  if (\n    x == 1 # ok\n", true),
        (LanguageId::Python, "r11_e2_py_if_eof_assign_cmt_bad.py", "def f():\n  if (\n    # TODO\n", "def f():\n  if (\n    x = 1 # ok\n", false),
        (LanguageId::Python, "r11_e2_py_elif_eof_trailing_cmt_ok.py", "def f():\n  if a:\n    pass\n  elif (\n    # TODO\n", "def f():\n  if a:\n    pass\n  elif (\n    x == 1 # ok\n", true),
        (LanguageId::Python, "r11_e2_py_while_eof_trailing_cmt_ok.py", "def f():\n  while (\n    # TODO\n", "def f():\n  while (\n    x == 1 # ok\n", true),
        (LanguageId::Python, "r11_e2_py_if_and_cont_cmt_ok.py", "def f():\n  if (\n    a and\n", "def f():\n  if (\n    a and b # ok\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 11 Explorer 3: Py/Rb control-paren pure insertions & nested (/[, multi/default/dict/multiline lambda, Rust encl (/[, match arm {
    for (lang, name, base, cand, exp) in [
        (LanguageId::Python, "r11_e3_py_if_pure_insert_unclosed_bad.py",
         "def f():\n  if (\n    y == 2\n  b = 1\n",
         "def f():\n  if (\n    x == 1\n    y == 2\n  b = 1\n", false),
        (LanguageId::Python, "r11_e3_py_if_pure_insert_closed_ok.py",
         "def f():\n  bad = (1 + *)\n  if (\n    y == 2\n  ):\n    b = 1\n",
         "def f():\n  bad = (1 + *)\n  if (\n    x == 1 and\n    y == 2\n  ):\n    b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_if_pure_insert_closed_bad.py",
         "def f():\n  bad = (1 + *)\n  if (\n    y == 2\n  ):\n    b = 1\n",
         "def f():\n  bad = (1 + *)\n  if (\n    x == 1\n    y == 2\n  ):\n    b = 1\n", false),
        (LanguageId::Ruby, "r11_e3_rb_if_pure_insert_two_exprs_unclosed_bad.rb",
         "def f\n  if (\n    y == 2\n  b = 1\nend\n",
         "def f\n  if (\n    x == 1\n    y == 2\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r11_e3_rb_if_pure_insert_broken_op_unclosed_bad.rb",
         "def f\n  if (\n    y == 2\n  b = 1\nend\n",
         "def f\n  if (\n    x +\n    y == 2\n  b = 1\nend\n", false),
        (LanguageId::Ruby, "r11_e3_rb_if_pure_insert_closed_ok.rb",
         "def f\n  bad = (1 + *)\n  if (\n    y == 2\n  )\n    b = 1\n  end\nend\n",
         "def f\n  bad = (1 + *)\n  if (\n    x == 1 &&\n    y == 2\n  )\n    b = 1\n  end\nend\n", true),
        (LanguageId::Ruby, "r11_e3_rb_if_pure_insert_closed_bad.rb",
         "def f\n  bad = (1 + *)\n  if (\n    y == 2\n  )\n    b = 1\n  end\nend\n",
         "def f\n  bad = (1 + *)\n  if (\n    x + *\n    y == 2\n  )\n    b = 1\n  end\nend\n", false),
        (LanguageId::Python, "r11_e3_py_if_nested_brack_unclosed_ok_stmt_bad.py",
         "def f():\n  if (\n    foo([\n      # TODO\n  b = 1\n",
         "def f():\n  if (\n    foo([\n      1\n  b = 1\n", false),
        (LanguageId::Python, "r11_e3_py_if_nested_brack_closed_ok.py",
         "def f():\n  bad = (1 + *)\n  if (\n    foo([\n      # TODO\n    ])\n  ):\n    b = 1\n",
         "def f():\n  bad = (1 + *)\n  if (\n    foo([\n      1,\n    ])\n  ):\n    b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_if_nested_brack_closed_bad.py",
         "def f():\n  bad = (1 + *)\n  if (\n    foo([\n      # TODO\n    ])\n  ):\n    b = 1\n",
         "def f():\n  bad = (1 + *)\n  if (\n    foo([\n      1 + *,\n    ])\n  ):\n    b = 1\n", false),
        (LanguageId::Python, "r11_e3_py_lambda_multi_arg_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x, y:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x, y:\n  x + y)\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_default_arg_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x=1:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x=1:\n  x + 1)\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_kwarg_multi_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(key=lambda x, y:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(key=lambda x, y:\n  x + y)\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_multi_default_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(lambda x, y=1:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(lambda x, y=1:\n  x + y)\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_dict_paren_ok.py",
         "def f():\n  bad = (1 + *)\n  d = {'k': (lambda x, y:\n  # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  d = {'k': (lambda x, y:\n  x + y)}\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_multiline_ok.py",
         "def f():\n  bad = (1 + *)\n  foo(\n    lambda\n      x, y:\n    # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(\n    lambda\n      x, y:\n    x + y)\n  b = 1\n", true),
        (LanguageId::Python, "r11_e3_py_lambda_multiline_assign_bad.py",
         "def f():\n  bad = (1 + *)\n  foo(\n    lambda\n      x, y:\n    # TODO\n  b = 1\n",
         "def f():\n  bad = (1 + *)\n  foo(\n    lambda\n      x, y:\n    x = 1)\n  b = 1\n", false),
        (LanguageId::Python, "r11_e3_py_lambda_after_colon_bad.py",
         "def f():\n  foo(lambda x: 1, a:\n  # TODO\n  b = 1\n",
         "def f():\n  foo(lambda x: 1, a:\n  x + 1)\n  b = 1\n", false),
        (LanguageId::Python, "r11_e3_py_cafe_lambda_colon_bad.py",
         "def f():\n  foo(cafélambda:\n  # TODO\n  b = 1\n",
         "def f():\n  foo(cafélambda:\n  x + 1)\n  b = 1\n", false),
        (LanguageId::Rust, "r11_e3_rs_paren_struct_lit_repeat_array_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = (\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n    }\n  );\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = (\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", true),
        (LanguageId::Rust, "r11_e3_rs_paren_struct_lit_close_paren_cand_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = (\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = (\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", true),
        (LanguageId::Rust, "r11_e3_rs_match_arm_repeat_arr_ok.rs",
         "fn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => {\n      let a = [1,\n        [2;\n      // TODO\n    }\n  }\n}\n",
         "fn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => {\n      let a = [1,\n        [2;\n      3]];\n    }\n  }\n}\n", true),
        (LanguageId::Rust, "r11_e3_rs_match_arm_paren_struct_lit_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        // TODO\n      }\n    ),\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        3]],\n      }\n    ),\n  }\n}\n", true),
        (LanguageId::Rust, "r11_e3_rs_match_arm_repeat_arr_bad.rs",
         "fn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => {\n      let a = [1,\n        [2;\n      // TODO\n    }\n  }\n}\n",
         "fn f(x: i32) {\n  let broken = (1 + *);\n  match x {\n    1 => {\n      let a = [1,\n        [2;\n      let bad = ; 3]];\n    }\n  }\n}\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 12 Explorer 1: UTF-8 safety in snippet_hdr_ts.rs, JS & StmtBlock backtick keys, and for /* c */ await
    for (lang, name, base, cand, exp) in [
        (LanguageId::Tsx, "r12_e1_tsx_utf8_generic_leave_div_ok.tsx",
         "function C() {\n  return (<div>\n    <span>café 🚀 中文</span>\n    {items.map(<T extends Foo>(x: T) => (\n      <span>{x}</span>\n",
         "function C() {\n  return (<div>\n    <span>café 🚀 中文</span>\n    {items.map(<T extends Foo>(x: T) => (\n      <span>{x}</span>\n    ))}\n", true),
        (LanguageId::TypeScript, "r12_e1_ts_utf8_ident_brace_ok.ts",
         "const café = {\n",
         "const café = {\n  a: 1,\n", true),
        (LanguageId::TypeScript, "r12_e1_ts_utf8_ident_prebroken_brace_ok.ts",
         "const broken = (1 + *);\nconst café = {\n",
         "const broken = (1 + *);\nconst café = {\n  a: 1,\n", true),
        (LanguageId::TypeScript, "r12_e1_ts_utf8_lead_ident_brace_ok.ts",
         "const é = {\n",
         "const é = {\n  a: 1,\n", true),
        (LanguageId::TypeScript, "r12_e1_ts_utf8_arrow_param_missing_arrow_bad.ts",
         "const f = (café): void {\n",
         "const f = (café): void {\n  return;\n", false),
        (LanguageId::TypeScript, "r12_e1_ts_utf8_arrow_param_ok.ts",
         "const f = (café): void => {\n",
         "const f = (café): void => {\n  return;\n", true),
        (LanguageId::JavaScript, "r12_e1_bt_js_valbrace_k_bad.js",
         "const o = {\n  `nested`: {\n",
         "const o = {\n  `nested`: {\n    k: 1,\n", false),
        (LanguageId::JavaScript, "r12_e1_bt_js_valbrace_interp_k_bad.js",
         "const o = {\n  `a_${x}`: {\n",
         "const o = {\n  `a_${x}`: {\n    k: 1,\n", false),
        (LanguageId::JavaScript, "r12_e1_bt_js_valbrace_nonempty_bad.js",
         "const o = {\n  `nested`: {\n    a: 1,\n",
         "const o = {\n  `nested`: {\n    a: 1,\n    b: 2,\n", false),
        (LanguageId::TypeScript, "r12_e1_bt_stmt_block_semi_bad.ts",
         "if (x) {\n  `nested`: {\n",
         "if (x) {\n  `nested`: {\n    k: 1;\n", false),
        (LanguageId::TypeScript, "r12_e1_bt_stmt_block_interp_bad.ts",
         "if (x) {\n  `a_${x}`: {\n",
         "if (x) {\n  `a_${x}`: {\n    k: 1;\n", false),
        (LanguageId::JavaScript, "r12_e1_bt_js_stmt_block_semi_bad.js",
         "if (x) {\n  `nested`: {\n",
         "if (x) {\n  `nested`: {\n    k: 1;\n", false),
        (LanguageId::JavaScript, "r12_e1_bt_js_stmt_block_interp_bad.js",
         "if (x) {\n  `a_${x}`: {\n",
         "if (x) {\n  `a_${x}`: {\n    k: 1;\n", false),
        (LanguageId::JavaScript, "r12_e1_bt_js_comp_valbrace_ok.js",
         "const o = {\n  [`nested`]: {\n",
         "const o = {\n  [`nested`]: {\n    k: 1,\n", true),
        (LanguageId::JavaScript, "r12_e1_bt_js_tern_valbrace_ok.js",
         "const o = {\n  a: cond ? `x` : {\n",
         "const o = {\n  a: cond ? `x` : {\n    k: 1,\n", true),
        (LanguageId::TypeScript, "r12_e1_bt_ts_tern_bare_stmt_ok.ts",
         "if (x) {\n  cond ? `x` : {\n",
         "if (x) {\n  cond ? `x` : {\n    a: 1\n", true),
        (LanguageId::TypeScript, "r12_e1_bt_ts_labeled_block_ok.ts",
         "if (x) {\n  lbl: {\n",
         "if (x) {\n  lbl: {\n    const a = 1;\n", true),
        (LanguageId::TypeScript, "r12_e1_bt_ts_switch_case_bt_ok.ts",
         "switch (x) {\n  case `a`: {\n",
         "switch (x) {\n  case `a`: {\n    break;\n", true),
        (LanguageId::JavaScript, "r12_e1_bt_js_switch_case_bt_ok.js",
         "switch (x) {\n  case `a_${y}`: {\n",
         "switch (x) {\n  case `a_${y}`: {\n    break;\n", true),
        (LanguageId::TypeScript, "r12_e1_bt_ts_switch_case_tern_bt_ok.ts",
         "switch (x) {\n  case c ? `a` : `b`: {\n",
         "switch (x) {\n  case c ? `a` : `b`: {\n    break;\n", true),
        (LanguageId::TypeScript, "r12_e1_for_cmt_await_of_lt_bad.ts",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r12_e1_for_cmt_await_cmt_of_lt_bad.ts",
         "async function f() {\n  for /* c */ await /* c2 */ (x of /* d */ <MY_TYPE, {\n",
         "async function f() {\n  for /* c */ await /* c2 */ (x of /* d */ <MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r12_e1_for_cmt_of_lt_bad.ts",
         "for /* c */ (x of<MY_TYPE, {\n",
         "for /* c */ (x of<MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r12_e1_for_cmt_await_of_ok.ts",
         "async function f() {\n  for /* c */ await (const x of items) {\n",
         "async function f() {\n  for /* c */ await (const x of items) {\n    console.log(x);\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 12 Explorer 2: trailing # / // comments under needs_placeholder, p4/p5/p6 base-tail # comments, TSX <T = { ... }>
    for (lang, name, base, cand, exp) in [
        (LanguageId::Python, "r12_e2_py_foo_comma_cmt_ok.py",
         "def f():\n  foo(\n    # TODO\n",
         "def f():\n  foo(\n    1, # ok\n", true),
        (LanguageId::Python, "r12_e2_py_list_comma_cmt_ok.py",
         "def f():\n  a = [\n    # TODO\n",
         "def f():\n  a = [\n    1, # ok\n", true),
        (LanguageId::Python, "r12_e2_py_list_plus_cmt_eof_ok.py",
         "def f():\n  a = [\n",
         "def f():\n  a = [\n    1 + # ok\n", true),
        (LanguageId::Python, "r12_e2_py_tuple_comma_cmt_ok.py",
         "def f():\n  t = (\n    # TODO\n",
         "def f():\n  t = (\n    1, # ok\n", true),
        (LanguageId::Python, "r12_e2_py_foo_broken_op_comma_cmt_bad.py",
         "def f():\n  foo(\n    # TODO\n",
         "def f():\n  foo(\n    1 + *, # bad\n", false),
        (LanguageId::TypeScript, "r12_e2_ts_foo_comma_cmt_ok.ts",
         "function f() {\n  foo(\n    // TODO\n",
         "function f() {\n  foo(\n    1, // ok\n", true),
        (LanguageId::TypeScript, "r12_e2_ts_arr_plus_cmt_eof_ok.ts",
         "function f() {\n  const a = [\n",
         "function f() {\n  const a = [\n    1 + // ok\n", true),
        (LanguageId::Rust, "r12_e2_rs_foo_comma_cmt_ok.rs",
         "fn f() {\n  foo(\n    // TODO\n",
         "fn f() {\n  foo(\n    1, // ok\n", true),
        (LanguageId::Rust, "r12_e2_rs_let_foo_no_comma_cmt_ok.rs",
         "fn f() {\n  let x = foo(\n    // TODO\n",
         "fn f() {\n  let x = foo(\n    1 // ok\n", true),
        (LanguageId::Python, "r12_e2_p4_py_if_eof_after_cmt_missing_and_bad.py",
         "def f():\n  if (\n    x == 1 # comment\n",
         "def f():\n  if (\n    x == 1 # comment\n    y == 2 # ok\n", false),
        (LanguageId::Python, "r12_e2_p4_no_cmt2_bad.py",
         "def f():\n  if (\n    x == 1 # comment\n",
         "def f():\n  if (\n    x == 1 # comment\n    y == 2\n", false),
        (LanguageId::Python, "r12_e2_p4_closed_bad.py",
         "def f():\n  if (\n    x == 1 # comment\n",
         "def f():\n  if (\n    x == 1 # comment\n    y == 2\n  ):\n    pass\n", false),
        (LanguageId::Python, "r12_e2_p5_py_if_eof_after_and_cmt_ok.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y == 2 # ok\n", true),
        (LanguageId::Python, "r12_e2_p5_no_cmt2_ok.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y == 2\n", true),
        (LanguageId::Python, "r12_e2_p5_closed_ok.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y == 2\n  ):\n    pass\n", true),
        (LanguageId::Python, "r12_e2_p6_py_if_eof_after_and_cmt_assign_bad.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y = 2 # ok\n", false),
        (LanguageId::Python, "r12_e2_p6_no_cmt2_bad.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y = 2\n", false),
        (LanguageId::Python, "r12_e2_p6_closed_bad.py",
         "def f():\n  if (\n    x == 1 and # comment\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y = 2\n  ):\n    pass\n", false),
        (LanguageId::Tsx, "r12_e2_tsx_m3_t_eq_obj_in_base_ok.tsx",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>(x: T) => (\n",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r12_e2_tsx_m3_t_eq_obj_leave_div_ok.tsx",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>(x: T) => (\n      <span>{x}</span>\n",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>(x: T) => (\n      <span>{x}</span>\n    ))}\n", true),
        (LanguageId::Tsx, "r12_e2_tsx_jsx_comp_prop_obj_unclosed_bad.tsx",
         "function C() {\n  return (<div>\n    <Comp prop={1}>\n",
         "function C() {\n  return (<div>\n    <Comp prop={1}>\n    </div>);\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 12 Explorer 3: pure-deletion single-span ERROR bypasses, valid pure-deletion preservation, Rust broken outer (/[, match arm separator
    for (lang, name, base, cand, exp) in [
        (LanguageId::Python, "r12_e3_del_py_if_unclosed_broken.py",
         "def f():\n  if (\n    x == 1\n    and y == 2\n  b = 1\n",
         "def f():\n  if (\n    and y == 2\n  b = 1\n", false),
        (LanguageId::Ruby, "r12_e3_del_rb_if_and_rhs_unclosed.rb",
         "def f\n  if (\n    x == 1 &&\n    y == 2\n  )\n    b = 1\n",
         "def f\n  if (\n    x == 1 &&\n  )\n    b = 1\n", false),
        (LanguageId::Ruby, "r12_e3_del_rb_if_lhs_before_and_unclosed.rb",
         "def f\n  if (\n    x == 1\n    && y == 2\n  )\n    b = 1\n",
         "def f\n  if (\n    && y == 2\n  )\n    b = 1\n", false),
        (LanguageId::Rust, "r12_e3_del_rs_plus_rhs_unclosed_fn.rs",
         "fn f() {\n  let a = 1 +\n    2;\n",
         "fn f() {\n  let a = 1 +\n", false),
        (LanguageId::Rust, "r12_e3_del_rs_if_cond_unclosed_fn.rs",
         "fn f() {\n  if\n    x == 1\n  {\n    return;\n",
         "fn f() {\n  if\n  {\n    return;\n", false),
        (LanguageId::TypeScript, "r12_e3_del_ts_broken_obj_single_error_span.ts",
         "function f() {\n  const x = (\n    1 +\n    2\n  \n",
         "function f() {\n  const x = (\n    1 +\n  \n", false),
        (LanguageId::TypeScript, "r12_e3_del_ts_unclosed_if_and_rhs.ts",
         "function f() {\n  if (\n    x == 1 &&\n    y == 2\n",
         "function f() {\n  if (\n    x == 1 &&\n", false),
        (LanguageId::Java, "r12_e3_del_java_if_cond_bad.java",
         "class A { void f() {\n  if (\n    x == 1\n  ) {\n",
         "class A { void f() {\n  if (\n  ) {\n", false),
        (LanguageId::Python, "r12_e3_del_py_if_valid_rhs.py",
         "def f():\n  bad = (1 + *)\n  if (\n    x == 1\n    and y == 2\n  ):\n    pass\n",
         "def f():\n  bad = (1 + *)\n  if (\n    x == 1\n  ):\n    pass\n", true),
        (LanguageId::Python, "r12_e3_del_py_lambda_arg_valid.py",
         "def f():\n  bad = (1 + *)\n  foo(\n    lambda x: x + 1,\n    y\n  )\n",
         "def f():\n  bad = (1 + *)\n  foo(\n    y\n  )\n", true),
        (LanguageId::Rust, "r12_e3_del_rs_struct_field_valid.rs",
         "struct Foo {\n  bad: [u32;\n  a: i32,\n  b: i32,\n}\n",
         "struct Foo {\n  bad: [u32;\n  b: i32,\n}\n", true),
        (LanguageId::Rust, "r12_e3_del_rs_struct_vec_valid.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n    u64,\n  >,\n}\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u32,\n  >,\n}\n", true),
        (LanguageId::Rust, "r12_e3_del_rs_struct_vec_empty_bad.rs",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n    u64,\n  >,\n}\n",
         "struct Foo {\n  bad: [u32;\n  good: Vec<\n  >,\n}\n", false),
        (LanguageId::Rust, "r12_e3_del_rs_opt_stmt_after_unclosed_paren.rs",
         "fn f() {\n  let broken = (1 + *;\n  let a = 1;\n  let b = 2;\n}\n",
         "fn f() {\n  let broken = (1 + *;\n  let b = 2;\n}\n", true),
        (LanguageId::TypeScript, "r12_e3_del_ts_paren_lhs_valid.ts",
         "function f() {\n  const broken = (1 + *);\n  const x = (\n    1 +\n    2\n  );\n}\n",
         "function f() {\n  const broken = (1 + *);\n  const x = (\n    2\n  );\n}\n", true),
        (LanguageId::Rust, "r12_e3_del_blk_cmt_close_bad.rs",
         "fn f() {\n  /* open\n  */\n  let x = 1;\n}\n",
         "fn f() {\n  /* open\n  let x = 1;\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_c2_1_semi_outer_paren_close_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1; 2\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1; 2\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_r2_semi_outer_brack_close_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = [1; 2\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = [1; 2\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  ];\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_r3_semi_outer_paren_pure_insert_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1; 2\n    Foo {\n      a: [1,\n        [2;\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1; 2\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_r5_broken_outer_paren_stmt_close_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (let x = 1\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (let x = 1\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_broken_line_between_paren_struct_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (\n    1; 2\n    Foo {\n      a: [1,\n        [2;\n      // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (\n    1; 2\n    Foo {\n      a: [1,\n        [2;\n      3]],\n    }\n  );\n}\n", false),
        (LanguageId::Rust, "r12_e3_rs_same_line_paren_struct_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = ( Foo { a: [1, [2;\n  // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f() {\n  let broken = (1 + *);\n  let x = ( Foo { a: [1, [2;\n  3]], } );\n}\n", true),
        (LanguageId::Rust, "r12_e3_rs_broken_earlier_match_arm_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => { let broken = (1 + *); },\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => { let broken = (1 + *); },\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        3]],\n      }\n    ),\n  }\n}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 13 Explorer 2: Python EOF # TODO DEDENT, for /* c */ await EOF // TODO, Python/Ruby & valid pure deletions
    for (lang, name, base, cand, exp) in [
        (LanguageId::Python, "r13_e2_py_if_and_cmt_eof_todo_ok.py",
         "def f():\n  if (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y == 2 # ok\n", true),
        (LanguageId::Python, "r13_e2_py_if_and_cmt_eof_todo_assign_bad.py",
         "def f():\n  if (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y = 2 # ok\n", false),
        (LanguageId::Python, "r13_e2_py_if_and_cmt_eof_todo_nocmt2_ok.py",
         "def f():\n  if (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y == 2\n", true),
        (LanguageId::Python, "r13_e2_py_if_and_cmt_eof_todo_nocmt2_bad.py",
         "def f():\n  if (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and # comment\n    y = 2\n", false),
        (LanguageId::Python, "r13_e2_py_if_and_nocmt_eof_todo_ok.py",
         "def f():\n  if (\n    x == 1 and\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and\n    y == 2\n", true),
        (LanguageId::Python, "r13_e2_py_if_and_nocmt_eof_todo_bad.py",
         "def f():\n  if (\n    x == 1 and\n    # TODO\n",
         "def f():\n  if (\n    x == 1 and\n    y = 2\n", false),
        (LanguageId::Python, "r13_e2_py_elif_and_cmt_eof_todo_ok.py",
         "def f(a):\n  if a:\n    pass\n  elif (\n    x == 1 and # comment\n    # TODO\n",
         "def f(a):\n  if a:\n    pass\n  elif (\n    x == 1 and # comment\n    y == 2 # ok\n", true),
        (LanguageId::Python, "r13_e2_py_elif_and_cmt_eof_todo_bad.py",
         "def f(a):\n  if a:\n    pass\n  elif (\n    x == 1 and # comment\n    # TODO\n",
         "def f(a):\n  if a:\n    pass\n  elif (\n    x == 1 and # comment\n    y = 2 # ok\n", false),
        (LanguageId::Python, "r13_e2_py_while_and_cmt_eof_todo_ok.py",
         "def f():\n  while (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  while (\n    x == 1 and # comment\n    y == 2 # ok\n", true),
        (LanguageId::Python, "r13_e2_py_while_and_cmt_eof_todo_bad.py",
         "def f():\n  while (\n    x == 1 and # comment\n    # TODO\n",
         "def f():\n  while (\n    x == 1 and # comment\n    y = 2 # ok\n", false),
        (LanguageId::Python, "r13_e2_py_class_def_or_cmt_eof_todo_ok.py",
         "class C:\n  def m(self):\n    if (\n      x == 1 or # comment\n      # TODO\n",
         "class C:\n  def m(self):\n    if (\n      x == 1 or # comment\n      y == 2 # ok\n", true),
        (LanguageId::Python, "r13_e2_py_class_def_or_cmt_eof_todo_bad.py",
         "class C:\n  def m(self):\n    if (\n      x == 1 or # comment\n      # TODO\n",
         "class C:\n  def m(self):\n    if (\n      x == 1 or # comment\n      y = 2 # ok\n", false),
        (LanguageId::Python, "r13_e2_py_if_no_and_to_and_ok.py",
         "def f():\n  if (\n    x == 1\n    # TODO\n",
         "def f():\n  if (\n    x == 1\n    and y == 2\n", true),
        (LanguageId::Python, "r13_e2_py_if_no_and_to_and_bad.py",
         "def f():\n  if (\n    x == 1\n    # TODO\n",
         "def f():\n  if (\n    x == 1\n    and y = 2\n", false),
        (LanguageId::TypeScript, "r13_e2_ts_for_cmt_await_eof_comment_ok.ts",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n    // TODO\n", true),
        (LanguageId::TypeScript, "r13_e2_ts_for_cmt_await_eof_code_bad.ts",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n",
         "async function f() {\n  for /* c */ await (x of<MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r13_e2_ts_const_arrow_missing_eof_comment_ok.ts",
         "const f = (x) {\n",
         "const f = (x) {\n  // TODO\n", true),
        (LanguageId::Python, "r13_e2_del_py_inner_rparen_outer_unclosed_bad.py",
         "x = (\n  foo(\n    1\n  )\n  + 2\n",
         "x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::Ruby, "r13_e2_del_rb_inner_rparen_outer_unclosed_bad.rb",
         "x = (\n  foo(\n    1\n  )\n  + 2\n",
         "x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::Rust, "r13_e2_del_rs_else_branch_valid.rs",
         "fn f() {\n  let bad = (1 + *);\n  if true {\n    g();\n  } else {\n    h();\n  }\n}\n",
         "fn f() {\n  let bad = (1 + *);\n  if true {\n    g();\n  }\n}\n", true),
        (LanguageId::Rust, "r13_e2_del_rs_spurious_rparen_valid.rs",
         "fn f() {\n  let bad = (1 + *);\n  let a = 1;\n  )\n}\n",
         "fn f() {\n  let bad = (1 + *);\n  let a = 1;\n}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    // Iter 13 Explorer 3: 13-lang inner closer pure-del bypass, valid pure-del before broken suf, line-repl inside unclosed {, Rust match arm cutoff, TOML/Bash/Twig/XML pure-del
    for (lang, name, base, cand, exp) in [
        (LanguageId::Rust, "r13_e3_del_rs_rbrace_eof_bad.rs",
         "fn f() {\n  if true {\n    let x = 1;\n  }\n",
         "fn f() {\n  if true {\n    let x = 1;\n", false),
        (LanguageId::Rust, "r13_e3_del_rs_inner_rbrace_outer_unclosed_bad.rs",
         "fn f() {\n  if true {\n    let y = 1;\n  }\n  let z = 2;\n",
         "fn f() {\n  if true {\n    let y = 1;\n  let z = 2;\n", false),
        (LanguageId::Rust, "r13_e3_del_rs_rbrack_nested_eof_bad.rs",
         "fn f() {\n  let x = [\n    [\n      1\n    ]\n",
         "fn f() {\n  let x = [\n    [\n      1\n", false),
        (LanguageId::Php, "r13_e3_del_php_rbrace_prebroken_bad.php",
         "<?php\n$bad = (1 + *);\nfunction f() {\n  if ($x) {\n    return 1;\n  }\n}\n",
         "<?php\n$bad = (1 + *);\nfunction f() {\n  if ($x) {\n    return 1;\n}\n", false),
        (LanguageId::CSharp, "r13_e3_del_cs_inner_rbrace_outer_unclosed_bad.cs",
         "class C { void F() {\n  if (true) {\n    int y = 1;\n  }\n  int z = 2;\n",
         "class C { void F() {\n  if (true) {\n    int y = 1;\n  int z = 2;\n", false),
        (LanguageId::Kotlin, "r13_e3_del_kt_inner_rbrace_outer_unclosed_bad.kt",
         "fun f() {\n  if (true) {\n    val y = 1\n  }\n  val z = 2\n",
         "fun f() {\n  if (true) {\n    val y = 1\n  val z = 2\n", false),
        (LanguageId::TypeScript, "r13_e3_del_ts_inner_rparen_outer_unclosed_bad.ts",
         "const x = (\n  foo(\n    1\n  )\n  + 2\n",
         "const x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::JavaScript, "r13_e3_del_js_inner_rparen_outer_unclosed_bad.js",
         "const x = (\n  foo(\n    1\n  )\n  + 2\n",
         "const x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::Go, "r13_e3_del_go_inner_rparen_outer_unclosed_bad.go",
         "package p\nfunc f() {\n  x := (\n    foo(\n      1\n    )\n    + 2\n",
         "package p\nfunc f() {\n  x := (\n    foo(\n      1\n    + 2\n", false),
        (LanguageId::Java, "r13_e3_del_java_inner_rparen_outer_unclosed_bad.java",
         "class C { void f() {\n  int x = (\n    foo(\n      1\n    )\n    + 2\n",
         "class C { void f() {\n  int x = (\n    foo(\n      1\n    + 2\n", false),
        (LanguageId::C, "r13_e3_del_c_inner_rparen_outer_unclosed_bad.c",
         "void f() {\n  int x = (\n    foo(\n      1\n    )\n    + 2\n",
         "void f() {\n  int x = (\n    foo(\n      1\n    + 2\n", false),
        (LanguageId::Cpp, "r13_e3_del_cpp_inner_rparen_outer_unclosed_bad.cpp",
         "void f() {\n  int x = (\n    foo(\n      1\n    )\n    + 2\n",
         "void f() {\n  int x = (\n    foo(\n      1\n    + 2\n", false),
        (LanguageId::Dart, "r13_e3_del_dart_inner_rparen_outer_unclosed_bad.dart",
         "void f() {\n  var x = (\n    foo(\n      1\n    )\n    + 2\n",
         "void f() {\n  var x = (\n    foo(\n      1\n    + 2\n", false),
        (LanguageId::Python, "r13_e3_del_py_inner_rparen_outer_unclosed_bad.py",
         "x = (\n  foo(\n    1\n  )\n  + 2\n",
         "x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::Ruby, "r13_e3_del_rb_inner_rparen_outer_unclosed_bad.rb",
         "x = (\n  foo(\n    1\n  )\n  + 2\n",
         "x = (\n  foo(\n    1\n  + 2\n", false),
        (LanguageId::Rust, "r13_e3_del_rs_stray_rbrace_ok.rs",
         "fn f() {\n  let bad = (1 + *);\n  }\n  let x = 1;\n}\n",
         "fn f() {\n  let bad = (1 + *);\n  let x = 1;\n}\n", true),
        (LanguageId::Rust, "r13_e3_del_rs_valid_stmt_before_broken_stmt_suf_ok.rs",
         "fn f() {\n  let a = 1;\n  let b = (1 + *);\n}\n",
         "fn f() {\n  let b = (1 + *);\n}\n", true),
        (LanguageId::Python, "r13_e3_del_py_valid_stmt_before_broken_stmt_suf_ok.py",
         "def f():\n  a = 1\n  b = (1 + *)\n",
         "def f():\n  b = (1 + *)\n", true),
        (LanguageId::Rust, "r13_e3_del_rs_valid_inside_broken_impl_eof_ok.rs",
         "impl S {\n  fn bad( {}\n  fn a() {}\n  fn b() {}\n",
         "impl S {\n  fn bad( {}\n  fn b() {}\n", true),
        (LanguageId::Rust, "r13_e3_del_rs_bad_operand_before_broken_stmt_suf.rs",
         "fn f() {\n  let a = 1 +\n    2;\n  let b = (1 + *);\n}\n",
         "fn f() {\n  let a = 1 +\n  let b = (1 + *);\n}\n", false),
        (LanguageId::Tsx, "r13_e3_tsx_comp_prop_1_nested_ok.tsx",
         "function C() {\n  return (<Comp prop={1}>\n    <div><span>hi</span>\n",
         "function C() {\n  return (<Comp prop={1}>\n    <div><span>hi</span></div>\n  </Comp>);\n", true),
        (LanguageId::Tsx, "r13_e3_tsx_edit_closing_tag_replace_ok.tsx",
         "function C() {\n  return (<div>\n    <span>hi\n",
         "function C() {\n  return (<div>\n    <span>hi</span>\n  </div>);\n", true),
        (LanguageId::TypeScript, "r13_e3_fw210_ts_replace_last_close_paren_ok.ts",
         "function f() {\n  const x = (\n    1\n",
         "function f() {\n  const x = (\n    1 + 2\n  );\n", true),
        (LanguageId::JavaScript, "r13_e3_fw210_js_replace_last_close_paren_ok.js",
         "function f() {\n  const x = (\n    1\n",
         "function f() {\n  const x = (\n    1 + 2\n  );\n", true),
        (LanguageId::Java, "r13_e3_fw210_java_replace_last_close_paren_ok.java",
         "class C {\n  void f() {\n    foo(\n      1\n",
         "class C {\n  void f() {\n    foo(\n      1 + 2\n    );\n", true),
        (LanguageId::TypeScript, "r13_e3_fw210_ts_replace_last_close_paren_bad.ts",
         "function f() {\n  const x = (\n    1\n",
         "function f() {\n  const x = (\n    1 +\n  );\n", false),
        (LanguageId::Rust, "r13_e3_rs_mid_match_earlier_non_brace_arm_broken_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => (1 + *),\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => (1 + *),\n    1 => (\n      Foo {\n        a: [1,\n          [2;\n        3]],\n      }\n    ),\n  }\n}\n", true),
        (LanguageId::Rust, "r13_e3_rs_mid_match_arm_after_brace_arm_broken_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => { let ok = 1; },\n    1 => (1 + *),\n    2 => (\n      Foo {\n        a: [1,\n          [2;\n        // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32) {\n  match x {\n    0 => { let ok = 1; },\n    1 => (1 + *),\n    2 => (\n      Foo {\n        a: [1,\n          [2;\n        3]],\n      }\n    ),\n  }\n}\n", true),
        (LanguageId::Rust, "r13_e3_rs_mid_match_multiline_pat_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: (i32, i32)) {\n  match x {\n    (0, 0) => (1 + *),\n    (\n      1,\n      2,\n    ) => (\n      Foo {\n        a: [1,\n          [2;\n        // TODO\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: (i32, i32)) {\n  match x {\n    (0, 0) => (1 + *),\n    (\n      1,\n      2,\n    ) => (\n      Foo {\n        a: [1,\n          [2;\n        3]],\n      }\n    ),\n  }\n}\n", true),
        (LanguageId::Toml, "r13_e3_del_toml_rhs_prebroken_bad.toml",
         "bad = [1,\nx =\n  1\n", "bad = [1,\nx =\n", false),
        (LanguageId::Toml, "r13_e3_del_toml_rbrack_prebroken_bad.toml",
         "bad = [1,\narr = [\n  1,\n  2,\n]\n", "bad = [1,\narr = [\n  1,\n  2,\n", false),
        (LanguageId::Toml, "r13_e3_del_toml_valid_after_broken_ok.toml",
         "bad = [\na = 1\nb = 2\n", "bad = [\nb = 2\n", true),
        (LanguageId::Bash, "r13_e3_del_bash_valid_stmt_prebroken_ok.sh",
         "x=$(echo (\n)\necho a\necho b\n", "x=$(echo (\n)\necho b\n", true),
        (LanguageId::Bash, "r13_e3_del_bash_empty_subst_bad.sh",
         "bad = (\nx=$(\n  echo a\n)\n", "bad = (\nx=$(\n)\n", false),
        (LanguageId::Twig, "r13_e3_del_twig_endblock_after_broken_tag_bad.twig",
         "{% if broken\n{% block body %}\n  hi\n{% endblock %}\n", "{% if broken\n{% block body %}\n  hi\n", false),
        (LanguageId::Twig, "r13_e3_del_twig_endif_after_broken_tag_bad.twig",
         "{% if broken\n{% if ok %}\n  hi\n{% endif %}\n", "{% if broken\n{% if ok %}\n  hi\n", false),
        (LanguageId::Xml, "r13_e3_del_xml_valid_elem_ok.xml",
         "<root><bad>\n<a/>\n<b/>\n</root>\n", "<root><bad>\n<b/>\n</root>\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_all_clusters failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r13_e1() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp) in [
        // 1. Unbracketed backtick shorthand methods (JS/TS/TSX) + valid computed/quoted siblings
        (LanguageId::JavaScript, "r13_e1_bt_js_obj_method_bad.js",
         "const o = {\n  `m`() {\n", "const o = {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r13_e1_bt_ts_obj_method_bad.ts",
         "const o = {\n  `m`() {\n", "const o = {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r13_e1_bt_js_cls_method_bad.js",
         "class C {\n  `m`() {\n", "class C {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r13_e1_bt_ts_cls_method_bad.ts",
         "class C {\n  `m`() {\n", "class C {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r13_e1_bt_ts_cls_gen_method_bad.ts",
         "class C {\n  `m`<T>(x: T) {\n", "class C {\n  `m`<T>(x: T) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r13_e1_bt_ts_obj_interp_gen_bad.ts",
         "const o = {\n  `m${x}`<T>(y: T) {\n", "const o = {\n  `m${x}`<T>(y: T) {\n    return y;\n", false),
        (LanguageId::TypeScript, "r13_e1_bt_ts_cls_async_star_bad.ts",
         "class C {\n  public async *`m`<T>(x: T): T {\n", "class C {\n  public async *`m`<T>(x: T): T {\n    return x;\n", false),
        (LanguageId::JavaScript, "r13_e1_bt_js_obj_computed_ok.js",
         "const o = {\n  [`m`]() {\n", "const o = {\n  [`m`]() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r13_e1_bt_ts_cls_computed_gen_ok.ts",
         "class C {\n  [`m`]<T>(x: T) {\n", "class C {\n  [`m`]<T>(x: T) {\n    return x;\n", true),
        (LanguageId::JavaScript, "r13_e1_bt_js_obj_quoted_ok.js",
         "const o = {\n  \"m\"() {\n", "const o = {\n  \"m\"() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r13_e1_bt_ts_cls_quoted_gen_ok.ts",
         "class C {\n  'm'<T>(x: T) {\n", "class C {\n  'm'<T>(x: T) {\n    return x;\n", true),
        (LanguageId::TypeScript, "r13_e1_bt_ts_obj_after_bt_prop_ok.ts",
         "const o = {\n  a: `hello`,\n  m() {\n", "const o = {\n  a: `hello`,\n  m() {\n    return 1;\n", true),
        // 2. yield * <MY_TYPE, { (with and without comments) + valid yield * / mul < siblings
        (LanguageId::TypeScript, "r13_e1_kw_yield_star_no_cmt_bad.ts",
         "function* f() {\n  yield * <MY_TYPE, {\n", "function* f() {\n  yield * <MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r13_e1_kw_yield_star_cmt_bad.ts",
         "function* f() {\n  yield /* c */ * /* c2 */ <MY_TYPE, {\n", "function* f() {\n  yield /* c */ * /* c2 */ <MY_TYPE, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r13_e1_kw_yield_star_call_ok.ts",
         "function* f() {\n  yield * foo<T>({\n", "function* f() {\n  yield * foo<T>({\n    a: 1,\n", true),
        (LanguageId::TypeScript, "r13_e1_kw_return_mul_cmp_ok.ts",
         "function f() {\n  return a * b < c ? {\n", "function f() {\n  return a * b < c ? {\n    a: 1,\n", true),
        (LanguageId::TypeScript, "r13_e1_kw_yield_star_gen_arrow_ok.ts",
         "function* f() {\n  yield * <T = { a: number }>(x: T) => ({\n", "function* f() {\n  yield * <T = { a: number }>(x: T) => ({\n    x,\n", true),
        // 3. TSX <T = { a: number }> with comments & top-level arrow ( + JSX <Comp ...> rejections
        (LanguageId::Tsx, "r13_e1_tsx_t_eq_obj_cmt_before_paren_ok.tsx",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>/* c */(x: T) => (\n",
         "function C() {\n  return (<div>\n    {items.map(<T = { a: number }>/* c */(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r13_e1_tsx_t_cmt_eq_obj_ok.tsx",
         "function C() {\n  return (<div>\n    {items.map(<T /* c */ = { a: number }>(x: T) => (\n",
         "function C() {\n  return (<div>\n    {items.map(<T /* c */ = { a: number }>(x: T) => (\n      <span>{x}</span>\n    ))}\n  </div>);\n", true),
        (LanguageId::Tsx, "r13_e1_tsx_const_t_eq_obj_arrow_ok.tsx",
         "const f = <T = { a: number }>(x: T) => (\n",
         "const f = <T = { a: number }>(x: T) => (\n  <div>{x}</div>\n", true),
        (LanguageId::Tsx, "r13_e1_tsx_export_default_t_eq_obj_arrow_ok.tsx",
         "export default <T = { a: number }>(x: T) => (\n",
         "export default <T = { a: number }>(x: T) => (\n  <div>{x}</div>\n", true),
        (LanguageId::Tsx, "r13_e1_tsx_const_t_ext_arrow_ok.tsx",
         "const f = <T extends Foo>(x: T) => (\n",
         "const f = <T extends Foo>(x: T) => (\n  <div>{x}</div>\n", true),
        (LanguageId::Tsx, "r13_e1_tsx_comp_prop_1_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <Comp prop={1}>\n", false),
        (LanguageId::Tsx, "r13_e1_tsx_comp_extends_true_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <Comp extends={true}>\n", false),
        (LanguageId::Tsx, "r13_e1_tsx_comp_cmt_prop_bad.tsx",
         "function C() {\n  return (<div>\n",
         "function C() {\n  return (<div>\n    <Comp /* c */ prop={1}>\n", false),
        // 4. TS arrow param EOF + non-arrow call rejection
        (LanguageId::TypeScript, "r13_e1_ts_arrow_param_eof_ok.ts",
         "const f = (\n", "const f = (\n  a: number,\n", true),
        (LanguageId::TypeScript, "r13_e1_ts_arrow_param_eof_nocomma_ok.ts",
         "const f = (\n", "const f = (\n  a: number\n", true),
        (LanguageId::TypeScript, "r13_e1_ts_export_default_arrow_param_eof_ok.ts",
         "export default (\n", "export default (\n  a: number,\n", true),
        (LanguageId::TypeScript, "r13_e1_ts_call_param_eof_bad.ts",
         "foo(\n", "foo(\n  a: number,\n", false),
        (LanguageId::TypeScript, "r13_e1_ts_member_async_call_param_bad.ts",
         "obj.async(\n", "obj.async(\n  a: number,\n", false),
        (LanguageId::TypeScript, "r13_e1_ts_if_param_eof_bad.ts",
         "if (\n", "if (\n  a: number,\n", false),
        (LanguageId::TypeScript, "r13_e1_ts_plus_paren_param_bad.ts",
         "const x = 1 + (\n", "const x = 1 + (\n  a: number,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r13_e1 failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r14_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp) in [
        // Iter 14 Explorer 1: modifier-prefixed & StmtBlock backtick shorthand, yield*/function*/for-await/.ts cast, TSX <const T = {}>, TS arrow dropped params
        (LanguageId::JavaScript, "r14_e1_bt_js_obj_async_bad.js",
         "const o = {\n  async `m`() {\n", "const o = {\n  async `m`() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r14_e1_bt_js_obj_get_bad.js",
         "const o = {\n  get `m`() {\n", "const o = {\n  get `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_obj_set_bad.ts",
         "const o = {\n  set `m`(v: number) {\n", "const o = {\n  set `m`(v: number) {\n    this.x = v;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_cls_static_bad.ts",
         "class C {\n  static `m`() {\n", "class C {\n  static `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_cls_private_gen_bad.ts",
         "class C {\n  private `m`<T>(x: T) {\n", "class C {\n  private `m`<T>(x: T) {\n    return x;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_stmt_block_bad.ts",
         "function f() {\n  `m`() {\n", "function f() {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_stmt_asi_bad.ts",
         "function f() {\n  foo()\n  async `m`() {\n", "function f() {\n  foo()\n  async `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_emoji_bad.ts",
         "const o = {\n  `m🚀`() {\n", "const o = {\n  `m🚀`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_interp_brace_bad.ts",
         "const o = {\n  async `m${\"}\"}`() {\n", "const o = {\n  async `m${\"}\"}`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_star_bad.ts",
         "const o = {\n  *`m`() {\n", "const o = {\n  *`m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r14_e1_bt_ts_async_computed_ok.ts",
         "const o = {\n  async [`m`]() {\n", "const o = {\n  async [`m`]() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r14_e1_bt_ts_key_block_ok.ts",
         "const o = {\n  `a`: {\n    m() {\n", "const o = {\n  `a`: {\n    m() {\n      return 1;\n", true),
        (LanguageId::TypeScript, "r14_e1_bt_ts_stmt_after_bt_ok.ts",
         "function f() {\n  let x = `a`;\n  m() {\n", "function f() {\n  let x = `a`;\n  m() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r14_e1_kw_fn_star_lt_bad.ts",
         "function* <MY_TYPE, {\n", "function* <MY_TYPE, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_yield_star_eq_bad.ts",
         "const broken = (\nfunction* g() {\n  yield * <T = number, {\n",
         "const broken = (\nfunction* g() {\n  yield * <T = number, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_yield_star_ext_bad.ts",
         "const broken = (\nfunction* g() {\n  yield * <T extends Foo, {\n",
         "const broken = (\nfunction* g() {\n  yield * <T extends Foo, {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_for_await_eq_bad.ts",
         "async function f() {\n  for /* c */ await (x of <T = number, {\n",
         "async function f() {\n  for /* c */ await (x of <T = number, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_for_await_ext_bad.ts",
         "async function f() {\n  for /* c */ await (x of <T extends Foo, {\n",
         "async function f() {\n  for /* c */ await (x of <T extends Foo, {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_obj_yield_star_ts_expr_bad.ts",
         "const broken = (\nfunction f(obj: any) {\n  return obj.yield * < {\n",
         "const broken = (\nfunction f(obj: any) {\n  return obj.yield * < {\n  a: 1 + 2,\n", false),
        (LanguageId::Tsx, "r14_e1_kw_obj_yield_star_tsx_bad.tsx",
         "const broken = (\nfunction f(obj: any) {\n  return obj.yield * < {\n",
         "const broken = (\nfunction f(obj: any) {\n  return obj.yield * < {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r14_e1_kw_ts_yield_star_cast_ok.ts",
         "const broken = (\nfunction* g(x: any) {\n  yield * <{\n",
         "const broken = (\nfunction* g(x: any) {\n  yield * <{\n  a: number;\n", true),
        (LanguageId::TypeScript, "r14_e1_kw_ts_yield_star_cast_close_ok.ts",
         "function* g(x: any) {\n  yield * <{\n  a: number;\n",
         "function* g(x: any) {\n  yield * <{\n  a: number;\n}[]>x;\n", true),
        (LanguageId::TypeScript, "r14_e1_kw_ts_return_cast_ok.ts",
         "const broken = (\nfunction f(x: any) {\n  return <{\n",
         "const broken = (\nfunction f(x: any) {\n  return <{\n  a: number;\n", true),
        (LanguageId::Tsx, "r14_e1_kw_tsx_yield_star_cast_bad.tsx",
         "const broken = (\nfunction* g(x: any) {\n  yield * <{\n",
         "const broken = (\nfunction* g(x: any) {\n  yield * <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r14_e1_tsx_t_eq_obj_closed_span_ok.tsx",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n    <span>hi</span>\n", true),
        (LanguageId::Tsx, "r14_e1_tsx_t_eq_obj_close_span_ok.tsx",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n    <span>\n",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n    <span>\n    </span>\n", true),
        (LanguageId::Tsx, "r14_e1_tsx_const_t_eq_obj_close_span_ok.tsx",
         "const broken = (\nconst f = <const T = { a: number }>(x: T) => (\n  <div>\n    <span>\n",
         "const broken = (\nconst f = <const T = { a: number }>(x: T) => (\n  <div>\n    <span>\n    </span>\n", true),
        (LanguageId::Tsx, "r14_e1_tsx_t_eq_obj_unclosed_span_bad.tsx",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n",
         "const broken = (\nconst f = <T = { a: number }>(x: T) => (\n  <div>\n    <span>\n", false),
        (LanguageId::TypeScript, "r14_e1_ts_arrow_prebroken_arg_typed_ok.ts",
         "const f = (\n  x = (1 + *),\n", "const f = (\n  x = (1 + *),\n  y: number,\n", true),
        (LanguageId::TypeScript, "r14_e1_ts_async_arrow_broken_expr_bad.ts",
         "const broken = (\nconst f = async (\n  (1 + *),\n",
         "const broken = (\nconst f = async (\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r14_e1_ts_async_arrow_prebroken_arg_ok.ts",
         "const f = async (\n  x = (1 + *),\n", "const f = async (\n  x = (1 + *),\n  a: number,\n", true),
        (LanguageId::TypeScript, "r14_e1_ts_call_prebroken_arg_bad.ts",
         "foo(\n  x = (1 + *),\n", "foo(\n  x = (1 + *),\n  y: number,\n", false),
        // Iter 14 Explorer 2: fw210 TSX/JSX/HTML/XML EOF tag closers, pure/structural deletions, YAML prefix del, Kt/PHP stray closer unmerge
        (LanguageId::Tsx, "r14_e2_tsx_close_inner_span_eof_ok.tsx",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n        hi\n",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n      </span>\n", true),
        (LanguageId::Tsx, "r14_e2_tsx_close_span_div_eof_ok.tsx",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n        hi\n",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n      </span>\n    </div>\n", true),
        (LanguageId::Tsx, "r14_e2_tsx_close_utf8_span_eof_ok.tsx",
         "const App = () => (\n  <div>\n    <span>\n      café 🚀\n",
         "const App = () => (\n  <div>\n    <span>\n    </span>\n", true),
        (LanguageId::JavaScript, "r14_e2_jsx_close_inner_span_eof_ok.jsx",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n        hi\n",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n      </span>\n", true),
        (LanguageId::Tsx, "r14_e2_tsx_close_div_mismatch_bad.tsx",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n        hi\n",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n      </div>\n", false),
        (LanguageId::Tsx, "r14_e2_tsx_close_extra_span_bad.tsx",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n        hi\n",
         "function App() {\n  const bad = (1 + *);\n  return (\n    <div>\n      <span>\n      </span></span>\n", false),
        (LanguageId::Tsx, "r14_e2_tsx_close_unclosed_lt_bad.tsx",
         "<div>\n  <span>\n    hi\n", "<div>\n  <span>\n  </span\n", false),
        (LanguageId::Tsx, "r14_e2_tsx_mismatch_expr_bad.tsx",
         "const bad = (1 + *);\nfunction App() {\n  return (\n    <div>\n      <span>\n        {x}\n",
         "const bad = (1 + *);\nfunction App() {\n  return (\n    <div>\n      <span>\n      </div>\n", false),
        (LanguageId::Html, "r14_e2_html_close_p_eof_repl_ok.html",
         "<div><span\n<section>\n  <p>\n    hi\n", "<div><span\n<section>\n  <p>\n  </p>\n", true),
        (LanguageId::Xml, "r14_e2_xml_close_item_eof_repl_ok.xml",
         "<bad><\n<list>\n  <item>\n    hi\n", "<bad><\n<list>\n  <item>\n  </item>\n", true),
        (LanguageId::Xml, "r14_e2_xml_mismatch_close_bad.xml",
         "<bad><\n<list>\n  <item>\n    hi\n", "<bad><\n<list>\n  <item>\n  </list>\n", false),
        (LanguageId::Php, "r14_e2_php_del_inner_rbrace_bad.php",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  if ($x) {\n    g();\n  }\n  $a = 1;\n}",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  if ($x) {\n    g();\n  $a = 1;\n}", false),
        (LanguageId::Php, "r14_e2_php_comment_out_inner_rbrace_bad.php",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  if ($x) {\n    g();\n  }\n  $a = 1;\n}",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  if ($x) {\n    g();\n  // removed\n  $a = 1;\n}", false),
        (LanguageId::Java, "r14_e2_java_del_if_hdr_else_bad.java",
         "class C { void f() {\n  int bad = (1 + *);\n  if (true) {\n    g();\n  } else {\n    h();\n  }\n",
         "class C { void f() {\n  int bad = (1 + *);\n    g();\n  } else {\n    h();\n  }\n", false),
        (LanguageId::Kotlin, "r14_e2_kt_del_if_hdr_else_bad.kt",
         "fun f() {\n  val bad = (1 + *)\n  if (true) {\n    g()\n  } else {\n    h()\n  }\n",
         "fun f() {\n  val bad = (1 + *)\n    g()\n  } else {\n    h()\n  }\n", false),
        (LanguageId::Php, "r14_e2_php_del_if_hdr_else_bad.php",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  if ($x) {\n    g();\n  } else {\n    h();\n  }\n",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n    g();\n  } else {\n    h();\n  }\n", false),
        (LanguageId::Bash, "r14_e2_bash_del_fi_eof_bad.sh",
         "bad=$(()\nif true; then\n  echo ok\nfi\n", "bad=$(()\nif true; then\n  echo ok\n", false),
        (LanguageId::Bash, "r14_e2_bash_del_esac_bad.sh",
         "bad = (\ncase $x in\n  a) echo 1 ;;\nesac\n", "bad = (\ncase $x in\n  a) echo 1 ;;\n", false),
        (LanguageId::Bash, "r14_e2_bash_del_valid_echo_before_if_ok.sh",
         "bad=$(()\necho hi\nif true; then\n  echo 1\nfi\n", "bad=$(()\nif true; then\n  echo 1\nfi\n", true),
        (LanguageId::Html, "r14_e2_html_del_section_close_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n", "<div><span\n<section>\n  <p>hi</p>\n", false),
        (LanguageId::Css, "r14_e2_css_del_selector_lbrace_bad.css",
         ".bad { color: ;\n.a {\n  color: red;\n}\n", ".bad { color: ;\n  color: red;\n}\n", false),
        (LanguageId::Json, "r14_e2_json_del_valid_prop_ok.json",
         "{\n  \"bad\": (1 + *),\n  \"a\": 1,\n  \"b\": 2\n}\n", "{\n  \"bad\": (1 + *),\n  \"b\": 2\n}\n", true),
        (LanguageId::Css, "r14_e2_css_del_valid_rule_ok.css",
         ".bad { color: ;\n.a { color: red; }\n.b { color: blue; }\n", ".bad { color: ;\n.b { color: blue; }\n", true),
        (LanguageId::Yaml, "r14_e2_yaml_del_prefix_before_bad_list_ok.yaml",
         "a: 1\nb: 2\nbad: [1,\n", "b: 2\nbad: [1,\n", true),
        (LanguageId::Yaml, "r14_e2_yaml_del_prefix_before_bad_map_ok.yaml",
         "a: 1\nb: 2\nbad: {\n  x: 1\n", "b: 2\nbad: {\n  x: 1\n", true),
        (LanguageId::Yaml, "r14_e2_yaml_del_2lines_before_bad_list_ok.yaml",
         "a: 1\nb: 2\nbad: [1,\n", "bad: [1,\n", true),
        (LanguageId::Yaml, "r14_e2_yaml_del_parent_key_bad_indent_bad.yaml",
         "a:\n  b: 1\nbad: [1,\n", "  b: 1\nbad: [1,\n", false),
        (LanguageId::Yaml, "r14_e2_yaml_del_prefix_new_err_bad.yaml",
         "a: 1\nb: 2\nbad: [1,\n", "b: [2\nbad: [1,\n", false),
        (LanguageId::Kotlin, "r14_e2_kt_del_stray_rparen_ok.kt",
         "fun f() {\n  val bad = (1 + *)\n  val a = 1\n  )\n}", "fun f() {\n  val bad = (1 + *)\n  val a = 1\n}", true),
        (LanguageId::Php, "r14_e2_php_del_stray_rparen_ok.php",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  $a = 1;\n  )\n}",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  $a = 1;\n}", true),
        (LanguageId::Php, "r14_e2_php_del_stray_rparen_before_stmt_ok.php",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  )\n  $a = 1;\n}",
         "<?php\nfunction f() {\n  $bad = (1 + *);\n  $a = 1;\n}", true),
        (LanguageId::Kotlin, "r14_e2_kt_del_matched_rparen_bad.kt",
         "fun f() {\n  val bad = (1 + *\n  val a = 1\n  )\n}", "fun f() {\n  val bad = (1 + *\n  val a = 1\n}", false),
        (LanguageId::Php, "r14_e2_php_del_matched_rparen_bad.php",
         "<?php\nfunction f() {\n  $bad = (1 + *;\n  $a = 1;\n  )\n}",
         "<?php\nfunction f() {\n  $bad = (1 + *;\n  $a = 1;\n}", false),
        // Iter 14 Explorer 3 (unique cases): Java nested broken body, Bash mid fi/do/stray fi, HTML mid/valid, CSS valid, Twig nested broken, Rust nested match/StructLit
        (LanguageId::Java, "r14_e3_del_java_if_hdr_nested_broken_body_bad.java",
         "class C { void f() {\n  int bad = (1 + *);\n  if (true) {\n    g(1 + *);\n  } else {\n    h();\n  }\n",
         "class C { void f() {\n  int bad = (1 + *);\n    g(1 + *);\n  } else {\n    h();\n  }\n", false),
        (LanguageId::Bash, "r14_e3_del_bash_fi_mid_bad.sh",
         "bad=$(()\nif true; then\n  echo ok\nfi\necho done\n",
         "bad=$(()\nif true; then\n  echo ok\necho done\n", false),
        (LanguageId::Bash, "r14_e3_bash_drop_do_mid_bad.sh",
         "bad = (\nfor x in 1 2; do\n  echo $x\ndone\n",
         "bad = (\nfor x in 1 2;\n  echo $x\ndone\n", false),
        (LanguageId::Bash, "r14_e3_del_bash_stray_fi_ok.sh",
         "bad=$(()\necho ok\nfi\n", "bad=$(()\necho ok\n", true),
        (LanguageId::Html, "r14_e3_del_html_section_close_mid_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n<p>after</p>\n",
         "<div><span\n<section>\n  <p>hi</p>\n<p>after</p>\n", false),
        (LanguageId::Html, "r14_e3_del_html_valid_p_inside_section_ok.html",
         "<div><span\n<section>\n  <p>hi</p>\n  <p>ok</p>\n</section>\n",
         "<div><span\n<section>\n  <p>ok</p>\n</section>\n", true),
        (LanguageId::Css, "r14_e3_del_css_valid_decl_ok.css",
         ".bad { color: ;\n.a {\n  color: red;\n  margin: 0;\n}\n",
         ".bad { color: ;\n.a {\n  margin: 0;\n}\n", true),
        (LanguageId::Twig, "r14_e3_del_twig_endblock_nested_broken_var_bad.twig",
         "{% if broken\n{% block body %}\n  {{ broken_var\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  {{ broken_var\n", false),
        (LanguageId::Twig, "r14_e3_del_twig_endif_nested_broken_var_bad.twig",
         "{% if broken\n{% if ok %}\n  {{ broken_var\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  {{ broken_var\n", false),
        (LanguageId::Twig, "r14_e3_del_twig_valid_p_nested_broken_var_ok.twig",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n  {{ broken_var\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  {{ broken_var\n{% endblock %}\n", true),
        (LanguageId::Rust, "r14_e3_rs_nested_match_arm_close_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => match y {\n      0 => (1 + *),\n      1 => (\n        Foo {\n          a: [1,\n            [2;\n          // TODO\n    },\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => match y {\n      0 => (1 + *),\n      1 => (\n        Foo {\n          a: [1,\n            [2;\n          3]],\n        }\n      ),\n    },\n  }\n}\n", true),
        (LanguageId::Rust, "r14_e3_rs_match_structlit_before_stmt_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(x: i32) {\n  match x {\n    0 => (1 + *),\n    1 => Bar {\n      f: (\n        Foo {\n          a: [1,\n            [2;\n          // TODO\n    },\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(x: i32) {\n  match x {\n    0 => (1 + *),\n    1 => Bar {\n      f: (\n        Foo {\n          a: [1,\n            [2;\n          3]],\n        }\n      ),\n    },\n  }\n}\n", true),
        (LanguageId::Rust, "r14_e3_rs_nested_match_bad_arm_close_bad.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => match y {\n      0 => (1 + *),\n      1 => (\n        Foo {\n          a: [1,\n            [2;\n          // TODO\n    },\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => match y {\n      0 => (1 + *),\n      1 => (\n        Foo {\n          a: [1,\n            [2;\n          3];\n        }\n      ),\n    },\n  }\n}\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    let toml_body: String = (1..=40).map(|i| format!("  {i},\n")).collect();
    let toml_base = format!("bad = [1,\narr = [\n{toml_body}]\n");
    let toml_del_rbrack = format!("bad = [1,\narr = [\n{toml_body}");
    let toml_valid_body: String = (1..=39).map(|i| format!("  {i},\n")).collect();
    let toml_del_elem = format!("bad = [1,\narr = [\n{toml_valid_body}]\n");
    let twig_p: String = (1..=40).map(|i| format!("  <p>{i}</p>\n")).collect();
    let twig_if_base = format!("{{% if broken\n{{% if ok %}}\n{twig_p}{{% endif %}}\n");
    let twig_if_del = format!("{{% if broken\n{{% if ok %}}\n{twig_p}");
    let twig_blk_base = format!("{{% if broken\n{{% block body %}}\n{twig_p}{{% endblock %}}\n");
    let twig_blk_del = format!("{{% if broken\n{{% block body %}}\n{twig_p}");
    for (lang, name, base, cand, exp) in [
        (LanguageId::Toml, "r14_e3_del_toml_gt32_rbrack_bad.toml", toml_base.as_str(), toml_del_rbrack.as_str(), false),
        (LanguageId::Toml, "r14_e3_del_toml_gt32_valid_elem_ok.toml", toml_base.as_str(), toml_del_elem.as_str(), true),
        (LanguageId::Twig, "r14_e3_del_twig_gt32_endif_bad.twig", twig_if_base.as_str(), twig_if_del.as_str(), false),
        (LanguageId::Twig, "r14_e3_del_twig_gt32_endblock_bad.twig", twig_blk_base.as_str(), twig_blk_del.as_str(), false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r14_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r15_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp) in [
        // Explorer 1 Cluster 1: Backtick shorthand methods (ValueParen, ValueBracket, TypeBody, => {, (): {, multi-line, ${// })
        (LanguageId::TypeScript, "r15_e1_bt_vparen_bad.ts",
         "const broken = (\n`m`() {\n", "const broken = (\n`m`() {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_async_vparen_bad.ts",
         "const broken = (\nasync `m`() {\n", "const broken = (\nasync `m`() {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_vbrack_bad.ts",
         "const broken = [\n`m`() {\n", "const broken = [\n`m`() {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_iface_bad.ts",
         "interface I {\n  `m`() {\n", "interface I {\n  `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_arrow_bad.ts",
         "const o = {\n  `m`() => {\n", "const o = {\n  `m`() => {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_obj_ret_empty_bad.ts",
         "const o = {\n  `m`(): {\n", "const o = {\n  `m`(): {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_cls_ret_empty_bad.ts",
         "class C {\n  async `m`(): {\n", "class C {\n  async `m`(): {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_multiline_bad.ts",
         "const o = {\n  async `a\nb`() {\n", "const o = {\n  async `a\nb`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_multiline_3l_bad.ts",
         "const o = {\n  `a\n\nb`() {\n", "const o = {\n  `a\n\nb`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_interp_cmt_bad.ts",
         "const o = {\n  `m${// }\n}`() {\n", "const o = {\n  `m${// }\n}`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r15_e1_bt_computed_ml_ok.ts",
         "const o = {\n  async [`a\nb`]() {\n", "const o = {\n  async [`a\nb`]() {\n    return 1;\n", true),
        // Explorer 1 Cluster 2: TSX <{ angle casts vs valid TSX/TS forms
        (LanguageId::Tsx, "r15_e1_tsx_bare_eq_lt_brace_bad.tsx",
         "const x = <{\n", "const x = <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_eq_lt_brace_bad.tsx",
         "const broken = (\nconst x = <{\n", "const broken = (\nconst x = <{\n  a: 1,\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_lparen_lt_brace_bad.tsx",
         "const broken = (\nconst x = (<{\n", "const broken = (\nconst x = (<{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_comma_lt_brace_bad.tsx",
         "foo(1, <{\n", "foo(1, <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_tern_lt_brace_bad.tsx",
         "const x = a ? <{\n", "const x = a ? <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_arrow_lt_brace_bad.tsx",
         "const broken = (\nconst f = () => <{\n", "const broken = (\nconst f = () => <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_arrow_param_lt_brace_bad.tsx",
         "const broken = (\nconst f = (x: any) => <{\n", "const broken = (\nconst f = (x: any) => <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_obj_prop_lt_brace_bad.tsx",
         "const o = {\n  k: <{\n", "const o = {\n  k: <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_cls_field_lt_brace_bad.tsx",
         "class C {\n  f = <{\n", "class C {\n  f = <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r15_e1_tsx_foo_lt_brace_ok.tsx",
         "foo<{\n", "foo<{\n  a: number;\n", true),
        (LanguageId::Tsx, "r15_e1_tsx_foo_dbl_lt_brace_ok.tsx",
         "foo<A><{\n", "foo<A><{\n  a: number;\n", true),
        (LanguageId::TypeScript, "r15_e1_ts_eq_lt_brace_ok.ts",
         "const broken = (\nconst x = <{\n", "const broken = (\nconst x = <{\n  a: number;\n", true),
        // Explorer 1 Cluster 3: TSX <const /* c */ T = { a: number }>
        (LanguageId::Tsx, "r15_e1_tsx_const_cmt_t_eq_obj_ok.tsx",
         "const broken = (\nconst f = <const /* c */ T = { a: number }>(x: T) => (\n  <div>\n    <span>\n",
         "const broken = (\nconst f = <const /* c */ T = { a: number }>(x: T) => (\n  <div>\n    <span>\n    </span>\n", true),
        (LanguageId::Tsx, "r15_e1_tsx_const_eq_cmt_t_eq_obj_ok.tsx",
         "const broken = (\nconst f = <const /* a=b */ T = { a: number }>(x: T) => (\n  <div>\n    <span>\n",
         "const broken = (\nconst f = <const /* a=b */ T = { a: number }>(x: T) => (\n  <div>\n    <span>\n    </span>\n", true),
        // Explorer 1 Cluster 4: TS arrow broken param lists
        (LanguageId::TypeScript, "r15_e1_ts_arrow_arr_broken_bad.ts",
         "const f = (\n  [1 + *],\n", "const f = (\n  [1 + *],\n  y: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_obj_broken_bad.ts",
         "const f = (\n  { 1 + * },\n", "const f = (\n  { 1 + * },\n  y: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_rest_arr_broken_bad.ts",
         "const f = (\n  ...[1 + *],\n", "const f = (\n  ...[1 + *],\n  y: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_obj_def_broken_bad.ts",
         "const f = (\n  { a = 1 + * },\n", "const f = (\n  { a = 1 + * },\n  y: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_missing_comma_bad.ts",
         "const f = (\n  x = (1 + *)\n  y,\n", "const f = (\n  x = (1 + *)\n  y,\n  z: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_async_gen_broken_bad.ts",
         "const f = async <T>(\n  (1 + *),\n", "const f = async <T>(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_async_gen_after_broken_bad.ts",
         "const broken = (\nconst f = async <T>(\n  (1 + *),\n",
         "const broken = (\nconst f = async <T>(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_destr_valid_ok.ts",
         "const f = (\n  { a, b = 1 }: { a: number; b?: number },\n",
         "const f = (\n  { a, b = 1 }: { a: number; b?: number },\n  y: number,\n", true),
        (LanguageId::TypeScript, "r15_e1_ts_arrow_map_param_ok.ts",
         "const f = (\n  x: Map<string, number>,\n",
         "const f = (\n  x: Map<string, number>,\n  y: number,\n", true),
        // Explorer 2: Twig {# ... #} & multi-line markup/config comment-out stripping (shared E2/E3 cases deduplicated)
        (LanguageId::Twig, "r15_e2_twig_cmt_endif_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{# {% endif %} #}\n", false),
        (LanguageId::Twig, "r15_e2_twig_cmt_endblock_bad.twig",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{# {% endblock %} #}\n", false),
        (LanguageId::Twig, "r15_e2_twig_cmt_endfor_bad.twig",
         "{% if broken\n{% for x in xs %}\n  <p>{{ x }}</p>\n{% endfor %}\n",
         "{% if broken\n{% for x in xs %}\n  <p>{{ x }}</p>\n{# {% endfor %} #}\n", false),
        (LanguageId::Twig, "r15_e2_twig_cmt_if_open_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{# {% if ok %} #}\n  <p>hi</p>\n{% endif %}\n", false),
        (LanguageId::Twig, "r15_e2_twig_cmt_ml_endif_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{# c1 café 🚀 #}\n{# {% endif %} #}\n", false),
        (LanguageId::Twig, "r15_e2_twig_cmt_block_ml_endif_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{#\n{% endif %}\n#}\n", false),
        (LanguageId::Twig, "r15_e2_twig_html_cmt_div_bad.twig",
         "{% if broken\n<div>\n  <p>hi</p>\n</div>\n",
         "{% if broken\n<div>\n  <p>hi</p>\n<!-- </div> -->\n", false),
        (LanguageId::Twig, "r15_e2_twig_html_cmt_with_endif_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n<!-- {% endif %} -->\n", false),
        (LanguageId::Twig, "r15_e2_twig_html_cmt_balanced_ok.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <!-- <p>hi</p> -->\n{% endif %}\n", true),
        (LanguageId::Twig, "r15_e2_twig_cmt_to_cmt_ok.twig",
         "{% if broken\n{# old1 #}\n{# old2 #}\n",
         "{% if broken\n{# new1\nnew2 café 🚀 #}\n", true),
        (LanguageId::Html, "r15_e2_html_cmt_2line_section_close_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<section>\n  <p>hi</p>\n<!-- c1 -->\n<!-- </section> -->\n", false),
        (LanguageId::Html, "r15_e2_html_cmt_ml_section_close_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<section>\n  <p>hi</p>\n<!--\n</section>\n-->\n", false),
        (LanguageId::Html, "r15_e2_html_cmt_2line_section_open_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<!-- c1 -->\n<!-- <section> -->\n  <p>hi</p>\n</section>\n", false),
        (LanguageId::Xml, "r15_e2_xml_cmt_2line_close_bad.xml",
         "<root><broken\n<item>\n  <a>1</a>\n</item>\n",
         "<root><broken\n<item>\n  <a>1</a>\n<!-- c1 -->\n<!-- </item> -->\n", false),
        (LanguageId::Css, "r15_e2_css_cmt_2line_rbrace_bad.css",
         ".bad {\n.ok {\n  color: red;\n}\n",
         ".bad {\n.ok {\n  color: red;\n/* c1 */\n/* } */\n", false),
        (LanguageId::Toml, "r15_e2_toml_cmt_2line_rbrack_bad.toml",
         "bad = [1,\narr = [\n  1\n]\n",
         "bad = [1,\narr = [\n  1\n# c1\n# ]\n", false),
        (LanguageId::Toml, "r15_e2_toml_cmt_to_cmt_ok.toml",
         "bad = [1,\n# old1\n# old2\nk = 1\n",
         "bad = [1,\n# new1\n# new2\nk = 1\n", true),
        (LanguageId::Yaml, "r15_e2_yaml_cmt_to_cmt_ok.yaml",
         "bad: [\n# old1\n# old2\nk: 1\n",
         "bad: [\n# new1\n# new2\nk: 1\n", true),
        (LanguageId::Html, "r15_e2_html_cmt_to_cmt_ok.html",
         "<div><span\n<!-- old1 -->\n<!-- old2 -->\n",
         "<div><span\n<!-- new1 -->\n<!-- new2 -->\n", true),
        (LanguageId::Rust, "r15_e2_rs_ml_cmt_plus_code_bad.rs",
         "fn f() {\n  let a = (\n  // old\n}\n",
         "fn f() {\n  let a = (\n  // DONE\n  let x = 1 + *;\n}\n", false),
        // Explorer 3: Twig mismatched end-tags, HTML 1-line & rawtext, Rust StructLit-containing-match
        (LanguageId::Twig, "r15_e3_twig_cmt_ml_endif_bad.twig",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n",
         "{% if broken\n{% if ok %}\n  <p>hi</p>\n{# c1 #}\n{# {% endif %} #}\n", false),
        (LanguageId::Twig, "r15_e3_twig_repl_endblock_endif_bad.twig",
         "{% if broken %}\n{% block body %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% if broken %}\n{% block body %}\n  <p>hi</p>\n{% endif %}\n", false),
        (LanguageId::Twig, "r15_e3_twig_repl_endblock_wrong_name_bad.twig",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r15_e3_twig_repl_valid_p_ok.twig",
         "{% if broken\n{% block body %}\n  <p>a</p>\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  <p>b</p>\n{% endblock %}\n", true),
        (LanguageId::Twig, "r15_e3_twig_repl_valid_endblock_name_ok.twig",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% if broken\n{% block body %}\n  <p>hi</p>\n{% endblock body %}\n", true),
        (LanguageId::Html, "r15_e3_html_cmt_1line_section_open_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<!-- <section> -->\n  <p>hi</p>\n</section>\n", false),
        (LanguageId::Html, "r15_e3_html_del_script_str_div_ok.html",
         "<div><span>\n<script>\n  const s = \"</div>\";\n  const x = 1;\n</script>\n",
         "<div><span>\n<script>\n  const x = 1;\n</script>\n", true),
        (LanguageId::Rust, "r15_e3_rs_struct_in_match_in_struct_in_match_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => Bar {\n      f: match y {\n        0 => (1 + *),\n        1 => Foo {\n          a: [1,\n            [2;\n          // TODO\n        },\n      },\n    },\n  }\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(x: i32, y: i32) {\n  match x {\n    0 => (1 + *),\n    1 => Bar {\n      f: match y {\n        0 => (1 + *),\n        1 => Foo {\n          a: [1,\n            [2;\n          3]],\n        },\n      },\n    },\n  }\n}\n", true),
        (LanguageId::Rust, "r15_e3_rs_match_in_struct_in_fn_ok.rs",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(y: i32) {\n  let bad = (1 + *);\n  let _b = Bar {\n    f: match y {\n      0 => (1 + *),\n      1 => Foo {\n        a: [1,\n          [2;\n        // TODO\n      },\n    },\n  };\n}\n",
         "struct Foo { a: [[i32; 3]; 1] }\nstruct Bar { f: Foo }\nfn f(y: i32) {\n  let bad = (1 + *);\n  let _b = Bar {\n    f: match y {\n      0 => (1 + *),\n      1 => Foo {\n        a: [1,\n          [2;\n        3]],\n      },\n    },\n  };\n}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    let twig_rows = "<p>row</p>\n".repeat(107);
    let twig_110_base = format!("{{% if broken\n{{% if ok %}}\n{twig_rows}{{% endif %}}\n");
    let twig_110_cmt = format!("{{% if broken\n{{% if ok %}}\n{twig_rows}{{# {{% endif %}} #}}\n");
    let twig_110_endfor = format!("{{% if broken\n{{% if ok %}}\n{twig_rows}{{% endfor %}}\n");
    let toml_rows: String = (1..=109).map(|i| format!("  {{ k = {i} }},\n")).collect();
    let toml_110_base = format!("bad = [1,\narr = [\n{toml_rows}  {{ k = 110 }},\n]\n");
    let toml_110_del_rbrace = format!("bad = [1,\narr = [\n{toml_rows}  {{ k = 110\n]\n");
    let toml_110_repl_ok = format!("bad = [1,\narr = [\n{toml_rows}  {{ k = 111 }},\n]\n");
    let toml_110_kv_base = format!("bad = [1,\narr = [\n{toml_rows}  {{ k = 1, v = 2 }},\n]\n");
    let toml_110_kv_bad = format!("bad = [1,\narr = [\n{toml_rows}  {{ k = 1, v = 2,\n]\n");
    for (lang, name, base, cand, exp) in [
        (LanguageId::Twig, "r15_e2_twig_110_cmt_endif_bad.twig", twig_110_base.as_str(), twig_110_cmt.as_str(), false),
        (LanguageId::Twig, "r15_e3_twig_110_repl_endif_endfor_bad.twig", twig_110_base.as_str(), twig_110_endfor.as_str(), false),
        (LanguageId::Toml, "r15_e3_toml_110_del_inline_rbrace_bad.toml", toml_110_base.as_str(), toml_110_del_rbrace.as_str(), false),
        (LanguageId::Toml, "r15_e3_toml_110_repl_rbrace_comma_bad.toml", toml_110_kv_base.as_str(), toml_110_kv_bad.as_str(), false),
        (LanguageId::Toml, "r15_e3_toml_110_repl_valid_inline_ok.toml", toml_110_base.as_str(), toml_110_repl_ok.as_str(), true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r15_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r16_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp) in [
        // Explorer 1: backtick optional methods, optional property keys, JS return-type colon, binary-op method headers, TS single-broken-param
        (LanguageId::TypeScript, "r16_e1_bt_cls_opt_q_bad.ts",
         "class C {\n  `m`?() {\n", "class C {\n  `m`?() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_cls_async_opt_q_bad.ts",
         "class C {\n  async `m`?() {\n", "class C {\n  async `m`?() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_cls_gen_opt_q_bad.ts",
         "class C {\n  `m`?<A, B>() {\n", "class C {\n  `m`?<A, B>() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_obj_opt_q_bad.ts",
         "const o = {\n  `m`?() {\n", "const o = {\n  `m`?() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_cls_m_opt_q_ok.ts",
         "class C {\n  m?() {\n", "class C {\n  m?() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r16_e1_cls_comp_opt_q_ok.ts",
         "class C {\n  [`m`]?() {\n", "class C {\n  [`m`]?() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r16_e1_bt_iface_opt_colon_bad.ts",
         "interface I {\n  `m`?: {\n", "interface I {\n  `m`?: {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_type_opt_colon_bad.ts",
         "type T = {\n  `m`?: {\n", "type T = {\n  `m`?: {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_cls_opt_colon_bad.ts",
         "class C {\n  `m`?: {\n", "class C {\n  `m`?: {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r16_e1_bt_obj_opt_colon_bad.ts",
         "const o = {\n  `m`?: {\n", "const o = {\n  `m`?: {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r16_e1_obj_ident_opt_colon_bad.ts",
         "const o = {\n  m?: {\n", "const o = {\n  m?: {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r16_e1_iface_sq_opt_colon_ok.ts",
         "interface I {\n  'm'?: {\n", "interface I {\n  'm'?: {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r16_e1_cls_ident_opt_colon_ok.ts",
         "class C {\n  m?: {\n", "class C {\n  m?: {\n    a: number;\n", true),
        (LanguageId::JavaScript, "r16_e1_js_obj_m_ret_colon_bad.js",
         "const o = {\n  m(): {\n", "const o = {\n  m(): {\n    a: 1,\n", false),
        (LanguageId::JavaScript, "r16_e1_js_arrow_ret_colon_bad.js",
         "const f = (x): {\n", "const f = (x): {\n  a: 1,\n", false),
        (LanguageId::JavaScript, "r16_e1_js_fn_ret_colon_bad.js",
         "function f(x): {\n", "function f(x): {\n  return 1;\n", false),
        (LanguageId::JavaScript, "r16_e1_js_cls_m_ret_colon_bad.js",
         "class C {\n  m(): {\n", "class C {\n  m(): {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r16_e1_js_obj_m_ret_type_bad.js",
         "const o = {\n  m(): T {\n", "const o = {\n  m(): T {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r16_e1_js_obj_m_ret_colon_todo_bad.js",
         "const o = {\n  m(): {\n  // TODO\n", "const o = {\n  m(): {\n  return 1;\n", false),
        (LanguageId::JavaScript, "r16_e1_js_obj_m_ret_colon_cmt_ok.js",
         "const o = {\n  m(): {\n  // TODO\n", "const o = {\n  m(): {\n  // DONE\n", true),
        (LanguageId::JavaScript, "r16_e1_js_obj_tern_call_colon_ok.js",
         "const o = {\n  a: cond ? foo() : {\n", "const o = {\n  a: cond ? foo() : {\n    c: 2,\n", true),
        (LanguageId::JavaScript, "r16_e1_js_switch_case_call_ok.js",
         "switch (x) {\n  case foo(): {\n", "switch (x) {\n  case foo(): {\n    break;\n", true),
        (LanguageId::TypeScript, "r16_e1_obj_bt_plus_bt_bad.ts",
         "const o = {\n  `a` + `m`() {\n", "const o = {\n  `a` + `m`() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_obj_a_plus_m_bad.ts",
         "const o = {\n  a + m() {\n", "const o = {\n  a + m() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_obj_a_plus_m_todo_bad.ts",
         "const o = {\n  a + m() {\n  // TODO\n", "const o = {\n  a + m() {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_obj_a_plus_m_cmt_ok.ts",
         "const o = {\n  a + m() {\n  // TODO\n", "const o = {\n  a + m() {\n  // DONE\n", true),
        (LanguageId::TypeScript, "r16_e1_cls_a_plus_m_bad.ts",
         "class C {\n  a + m() {\n", "class C {\n  a + m() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r16_e1_obj_comp_plus_ok.ts",
         "const o = {\n  [a + b]() {\n", "const o = {\n  [a + b]() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r16_e1_obj_async_star_ok.ts",
         "const o = {\n  async *m() {\n", "const o = {\n  async *m() {\n    yield 1;\n", true),
        (LanguageId::TypeScript, "r16_e1_gen_arrow_no_2nd_bad.ts",
         "const f = <T>(\n  (1 + *),\n", "const f = <T>(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_gen_arrow_todo_bad.ts",
         "const f = <T>(\n  (1 + *),\n  // TODO\n", "const f = <T>(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_curried_gen_arrow_no_2nd_bad.ts",
         "const f = () => <T>(\n  (1 + *),\n", "const f = () => <T>(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_fn_decl_no_2nd_bad.ts",
         "function foo(\n  (1 + *),\n", "function foo(\n  (1 + *),\n  a: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_fn_gen_no_2nd_bad.ts",
         "function foo<T>(\n  (1 + *),\n", "function foo<T>(\n  (1 + *),\n  y: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_cls_method_no_2nd_bad.ts",
         "class C {\n  foo(\n    (1 + *),\n", "class C {\n  foo(\n    (1 + *),\n    a: number,\n", false),
        (LanguageId::TypeScript, "r16_e1_gen_arrow_simple_def_ok.ts",
         "const f = <T>(\n  x = (1 + *),\n", "const f = <T>(\n  x = (1 + *),\n  y: number,\n", true),
        (LanguageId::TypeScript, "r16_e1_fn_simple_def_ok.ts",
         "function foo(\n  x = (1 + *),\n", "function foo(\n  x = (1 + *),\n  y: number,\n", true),
        // Explorer 2: TSX keyword/control/export <{ + non-identifier callee generic calls
        (LanguageId::Tsx, "r16_e2_tsx_typeof_vbrace_bad.tsx",
         "const o = {\n  a: typeof <{\n", "const o = {\n  a: typeof <{\n    x: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_typeof_cls_bad.tsx",
         "class C {\n  x = typeof <{\n", "class C {\n  x = typeof <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_void_vbrace_bad.tsx",
         "const o = {\n  a: void <{\n", "const o = {\n  a: void <{\n    x: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_new_vbrace_bad.tsx",
         "const o = {\n  a: new <{\n", "const o = {\n  a: new <{\n    x: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_keyof_iface_bad.tsx",
         "interface I {\n  x: keyof <{\n", "interface I {\n  x: keyof <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_infer_type_body_bad.tsx",
         "type T<X> = X extends {\n  a: infer <{\n", "type T<X> = X extends {\n  a: infer <{\n    b: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_export_lt_t_eq_bad.tsx",
         "export <T = {\n", "export <T = {\n  a: number;\n", false),
        (LanguageId::TypeScript, "r16_e2_ts_export_lt_t_eq_bad.ts",
         "export <T = {\n", "export <T = {\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_if_paren_lt_brace_bad.tsx",
         "if (x) <{\n", "if (x) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_if_nl_lt_brace_bad.tsx",
         "if (x)\n  <{\n", "if (x)\n  <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_if_cmp_lt_brace_bad.tsx",
         "if (a < b) <{\n", "if (a < b) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_while_paren_lt_brace_bad.tsx",
         "while (x) <{\n", "while (x) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_for_paren_lt_brace_bad.tsx",
         "for (const k of xs) <{\n", "for (const k of xs) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_catch_paren_lt_brace_bad.tsx",
         "try {} catch (e) <{\n", "try {} catch (e) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_with_paren_lt_brace_bad.tsx",
         "with (x) <{\n", "with (x) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_cls_try_t_eq_ok.tsx",
         "class C {\n  try<T = {\n    a: number;\n", "class C {\n  try<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_iface_new_t_eq_ok.tsx",
         "interface I {\n  new<T = {\n    a: number;\n", "interface I {\n  new<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_if_gen_arrow_ok.tsx",
         "if (x) <T = {\n  a: number;\n", "if (x) <T = {\n  a: number;\n  readonly b: string;\n", true),
        (LanguageId::TypeScript, "r16_e2_ts_typeof_vbrace_ok.ts",
         "const o = {\n  a: typeof <{\n", "const o = {\n  a: typeof <{\n    x: number;\n", true),
        (LanguageId::TypeScript, "r16_e2_ts_typeof_iface_bad.ts",
         "interface I {\n  x: typeof <{\n", "interface I {\n  x: typeof <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r16_e2_tsx_typeof_vbrace_mid_cmt_ok.tsx",
         "const o = {\n  a: typeof <{\n  // TODO\n}\n", "const o = {\n  a: typeof <{\n  // DONE\n}\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_as_any_call_ok.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  a: number;\n", true),
        // GT=true: valid JSX-free TSX callee generic/call object-literal spread; updated per Iter 17 Explorer 2 §2.4
        (LanguageId::Tsx, "r16_e2_tsx_as_any_call_spread_bad.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  ...other,\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_call_ret_ok.tsx",
         "const x = foo()<{\n", "const x = foo()<{\n  a: number;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_vbrace_call_ret_ok.tsx",
         "const o = {\n  x: foo()<{\n", "const o = {\n  x: foo()<{\n    a: number;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_cls_idx_call_ok.tsx",
         "class C {\n  x = a[b]<{\n", "class C {\n  x = a[b]<{\n    a: number;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_obj_if_call_ok.tsx",
         "const x = obj.if(y)<{\n", "const x = obj.if(y)<{\n  a: number;\n", true),
        (LanguageId::Tsx, "r16_e2_tsx_if_body_paren_call_ok.tsx",
         "if (a) (b)<{\n", "if (a) (b)<{\n  a: number;\n", true),
        // Explorer 3: Twig block/endblock mismatch + HTML/XML non-comment tag-mismatch replacements
        (LanguageId::Twig, "r16_e3_twig_block_broken_endblock_other_bad.twig",
         "{% block body %}\n  {% if broken\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if broken\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r16_e3_twig_block_broken_endblock_body_to_other_bad.twig",
         "{% block body %}\n  {{ broken\n  <p>hi</p>\n{% endblock body %}\n",
         "{% block body %}\n  {{ broken\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r16_e3_twig_block_trim_ws_endblock_other_bad.twig",
         "{%- block body -%}\n  {% if broken\n{%- endblock -%}\n",
         "{%- block body -%}\n  {% if broken\n{%- endblock other -%}\n", false),
        (LanguageId::Twig, "r16_e3_twig_nested_block_endblock_wrong_bad.twig",
         "{% block outer %}\n{% block inner %}\n  {% if broken\n{% endblock inner %}\n{% endblock outer %}\n",
         "{% block outer %}\n{% block inner %}\n  {% if broken\n{% endblock outer %}\n{% endblock outer %}\n", false),
        (LanguageId::Twig, "r16_e3_twig_block_endblock_anon_to_body_ok.twig",
         "{% block body %}\n  {% if broken\n{% endblock %}\n",
         "{% block body %}\n  {% if broken\n{% endblock body %}\n", true),
        (LanguageId::Twig, "r16_e3_twig_block_endblock_body_to_anon_ok.twig",
         "{% block body %}\n  {% if broken\n{% endblock body %}\n",
         "{% block body %}\n  {% if broken\n{% endblock %}\n", true),
        (LanguageId::Twig, "r16_e3_twig_nested_block_endblock_anon_ok.twig",
         "{% block outer %}\n{% block inner %}\n  {% if broken\n{% endblock inner %}\n{% endblock outer %}\n",
         "{% block outer %}\n{% block inner %}\n  {% if broken\n{% endblock %}\n{% endblock outer %}\n", true),
        (LanguageId::Html, "r16_e3_html_repl_section_open_article_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<article>\n  <p>hi</p>\n</section>\n", false),
        (LanguageId::Html, "r16_e3_html_repl_section_open_div_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<div>\n  <p>hi</p>\n</section>\n", false),
        (LanguageId::Html, "r16_e3_html_repl_section_close_div_bad.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<section>\n  <p>hi</p>\n</div>\n", false),
        (LanguageId::Html, "r16_e3_html_repl_article_close_span_bad.html",
         "<div><span\n<article>\n  <p>hi</p>\n</article>\n",
         "<div><span\n<article>\n  <p>hi</p>\n</span>\n", false),
        (LanguageId::Html, "r16_e3_html_repl_article_close_div_bad.html",
         "<div><span\n<article>\n  <p>hi</p>\n</article>\n",
         "<div><span\n<article>\n  <p>hi</p>\n</div>\n", false),
        (LanguageId::Xml, "r16_e3_xml_repl_item_open_other_bad.xml",
         "<root><broken\n<item>\n  <a>1</a>\n</item>\n",
         "<root><broken\n<other>\n  <a>1</a>\n</item>\n", false),
        (LanguageId::Xml, "r16_e3_xml_repl_item_close_broken_bad.xml",
         "<root><broken><item>\n  <a>1</a>\n</item>\n",
         "<root><broken><item>\n  <a>1</a>\n</broken>\n", false),
        (LanguageId::Xml, "r16_e3_xml_repl_item_close_broken_after_bad.xml",
         "<root><broken><item>\n  <a>1</a>\n</item>\n</broken>\n",
         "<root><broken><item>\n  <a>1</a>\n</broken>\n</broken>\n", false),
        (LanguageId::Html, "r16_e3_html_repl_both_section_article_ok.html",
         "<div><span>\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span>\n<article>\n  <p>hi</p>\n</article>\n", true),
        (LanguageId::Html, "r16_e3_html_repl_section_attr_ok.html",
         "<div><span\n<section class=\"a\">\n  <p>hi</p>\n</section>\n",
         "<div><span\n<section class=\"b\">\n  <p>hi</p>\n</section>\n", true),
        (LanguageId::Html, "r16_e3_html_void_and_selfclose_ok.html",
         "<div><span\n<section>\n  <p>hi</p>\n</section>\n",
         "<div><span\n<section>\n  <p>hi<br><img src=\"x.png\"/></p>\n</section>\n", true),
        (LanguageId::Html, "r16_e3_html_rawtext_script_edit_ok.html",
         "<div><span>\n<script>\n  const s = \"</div>\";\n</script>\n",
         "<div><span>\n<script>\n  const s = \"</section>\";\n</script>\n", true),
        (LanguageId::Xml, "r16_e3_xml_repl_both_item_other_ok.xml",
         "<root><broken><item>\n  <a>1</a>\n</item>\n",
         "<root><broken><other>\n  <a>1</a>\n</other>\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    let p20 = "  <p>row</p>\n".repeat(20);
    let twig_20_base = format!("{{% block body %}}\n  {{% if broken\n{p20}{{% endblock %}}\n");
    let twig_20_cand = format!("{{% block body %}}\n  {{% if broken\n{p20}{{% endblock other %}}\n");
    let p45 = "  <p>row</p>\n".repeat(45);
    let html_45_base = format!("<div><span\n<section>\n{p45}</section>\n");
    let html_45_cand = format!("<div><span\n<section>\n{p45}</div>\n");
    for (lang, name, base, cand, exp) in [
        (LanguageId::Twig, "r16_e3_twig_block_20l_broken_endblock_other_bad.twig", twig_20_base.as_str(), twig_20_cand.as_str(), false),
        (LanguageId::Html, "r16_e3_html_45l_repl_section_close_div_bad.html", html_45_base.as_str(), html_45_cand.as_str(), false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r16_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r17_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for &(lang, name, base, cand, exp) in &[
        // Explorer 1: JS case(): / case(x):, JS optional methods m?() / [a]?(), TS a + b?(), broken-param // TODO
        (LanguageId::JavaScript, "r17_e1_js_obj_case_ret_colon_bad.js",
         "const o = {\n  case(): {\n", "const o = {\n  case(): {\n    a: 1,\n", false),
        (LanguageId::JavaScript, "r17_e1_js_cls_case_ret_colon_bad.js",
         "class C {\n  case(): {\n", "class C {\n  case(): {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_cls_case_arg_ret_colon_bad.js",
         "class C {\n  case(x): {\n", "class C {\n  case(x): {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_obj_case_todo_bad.js",
         "const o = {\n  case(): {\n  // TODO\n", "const o = {\n  case(): {\n  return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_cls_m_opt_q_bad.js",
         "class C {\n  m?() {\n", "class C {\n  m?() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_obj_m_opt_q_bad.js",
         "const o = {\n  m?() {\n", "const o = {\n  m?() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_cls_async_m_opt_q_bad.js",
         "class C {\n  async m?() {\n", "class C {\n  async m?() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_obj_comp_opt_q_bad.js",
         "const o = {\n  [a]?() {\n", "const o = {\n  [a]?() {\n    return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_cls_m_opt_q_todo_bad.js",
         "class C {\n  m?() {\n  // TODO\n", "class C {\n  m?() {\n  return 1;\n", false),
        (LanguageId::JavaScript, "r17_e1_js_obj_m_opt_ret_colon_bad.js",
         "const o = {\n  m?(): {\n", "const o = {\n  m?(): {\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r17_e1_ts_cls_a_plus_b_opt_q_bad.ts",
         "class C {\n  a + b?() {\n", "class C {\n  a + b?() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r17_e1_ts_obj_a_plus_b_opt_q_bad.ts",
         "const o = {\n  a + b?() {\n", "const o = {\n  a + b?() {\n    return 1;\n", false),
        (LanguageId::TypeScript, "r17_e1_ts_cls_a_plus_b_opt_q_todo_bad.ts",
         "class C {\n  a + b?() {\n  // TODO\n", "class C {\n  a + b?() {\n  return 1;\n", false),
        (LanguageId::TypeScript, "r17_e1_ts_cls_method_broken_param_todo_bad.ts",
         "class C {\n  foo(\n    (1 + *),\n    // TODO\n", "class C {\n  foo(\n    (1 + *),\n    a: number,\n", false),
        (LanguageId::TypeScript, "r17_e1_ts_obj_method_broken_param_todo_bad.ts",
         "const o = {\n  foo(\n    (1 + *),\n    // TODO\n", "const o = {\n  foo(\n    (1 + *),\n    a: number,\n", false),
        (LanguageId::JavaScript, "r17_e1_js_obj_case_cmt_ok.js",
         "const o = {\n  case(): {\n  // TODO\n", "const o = {\n  case(): {\n  // DONE\n", true),
        (LanguageId::JavaScript, "r17_e1_js_cls_m_opt_q_cmt_ok.js",
         "class C {\n  m?() {\n  // TODO\n", "class C {\n  m?() {\n  // DONE\n", true),
        (LanguageId::JavaScript, "r17_e1_js_switch_case_tern_ok.js",
         "switch (x) {\n  case (a ? b : c): {\n", "switch (x) {\n  case (a ? b : c): {\n    break;\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_obj_m_opt_q_ok.ts",
         "const o = {\n  m?() {\n", "const o = {\n  m?() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_cls_comp_plus_opt_q_ok.ts",
         "class C {\n  [a + b]?() {\n", "class C {\n  [a + b]?() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_obj_comp_plus_opt_q_ok.ts",
         "const o = {\n  [a + b]?() {\n", "const o = {\n  [a + b]?() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_cls_method_broken_param_cmt_ok.ts",
         "class C {\n  foo(\n    (1 + *),\n    // TODO\n", "class C {\n  foo(\n    (1 + *),\n    // DONE\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_obj_method_broken_param_cmt_ok.ts",
         "const o = {\n  foo(\n    (1 + *),\n    // TODO\n", "const o = {\n  foo(\n    (1 + *),\n    // DONE\n", true),
        (LanguageId::TypeScript, "r17_e1_ts_cls_method_second_param_todo_ok.ts",
         "class C {\n  foo(\n    (1 + *),\n    x: number,\n    // TODO\n",
         "class C {\n  foo(\n    (1 + *),\n    x: number,\n    y: number,\n", true),
        // Explorer 2 F1: member-context foo(x) <{
        (LanguageId::Tsx, "r17_e2_f1_tsx_cls_foo_paren_lt_bad.tsx",
         "class C {\n  foo(x) <{\n", "class C {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f1_ts_cls_foo_paren_lt_bad.ts",
         "class C {\n  foo(x) <{\n", "class C {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f1_tsx_obj_foo_paren_lt_bad.tsx",
         "const o = {\n  foo(x) <{\n", "const o = {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f1_ts_obj_foo_paren_lt_bad.ts",
         "const o = {\n  foo(x) <{\n", "const o = {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f1_tsx_iface_foo_paren_lt_bad.tsx",
         "interface I {\n  foo(x) <{\n", "interface I {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f1_ts_iface_foo_paren_lt_bad.ts",
         "interface I {\n  foo(x) <{\n", "interface I {\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f1_tsx_cls_asi_foo_paren_lt_bad.tsx",
         "class C {\n  x = 1\n  foo(x) <{\n", "class C {\n  x = 1\n  foo(x) <{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f1_tsx_obj_colon_call_ok.tsx",
         "const o = {\n  x: foo()<{\n", "const o = {\n  x: foo()<{\n    a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f1_tsx_cls_assign_cast_ok.tsx",
         "class C {\n  x = (a as any)<{\n", "class C {\n  x = (a as any)<{\n    a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f1_tsx_cls_foo_paren_lt_cmt_ok.tsx",
         "class C {\n  foo(x) <{\n  // TODO\n", "class C {\n  foo(x) <{\n  // DONE\n", true),
        // Explorer 2 F2: bare computed member [sym]<{
        (LanguageId::Tsx, "r17_e2_f2_tsx_obj_comp_lt_bad.tsx",
         "const o = {\n  [sym]<{\n", "const o = {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f2_ts_obj_comp_lt_bad.ts",
         "const o = {\n  [sym]<{\n", "const o = {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f2_tsx_cls_comp_lt_bad.tsx",
         "class C {\n  [sym]<{\n", "class C {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f2_ts_cls_comp_lt_bad.ts",
         "class C {\n  [sym]<{\n", "class C {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f2_tsx_iface_comp_lt_bad.tsx",
         "interface I {\n  [sym]<{\n", "interface I {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f2_ts_iface_comp_lt_bad.ts",
         "interface I {\n  [sym]<{\n", "interface I {\n  [sym]<{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f2_ts_obj_comp_t_eq_ok.ts",
         "const o = {\n  [sym]<T = {\n", "const o = {\n  [sym]<T = {\n    a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f2_tsx_obj_colon_idx_ok.tsx",
         "const o = {\n  x: a[b]<{\n", "const o = {\n  x: a[b]<{\n    a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f2_tsx_cls_assign_idx_ok.tsx",
         "class C {\n  x = a[b]<{\n", "class C {\n  x = a[b]<{\n    a: number;\n", true),
        // Explorer 2 F3: export async / export declare / declare <T = {
        (LanguageId::Tsx, "r17_e2_f3_tsx_export_async_t_eq_bad.tsx",
         "export async <T = {\n", "export async <T = {\n  a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f3_ts_export_async_t_eq_bad.ts",
         "export async <T = {\n", "export async <T = {\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f3_tsx_export_declare_t_eq_bad.tsx",
         "export declare <T = {\n", "export declare <T = {\n  a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f3_ts_export_declare_t_eq_bad.ts",
         "export declare <T = {\n", "export declare <T = {\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f3_tsx_declare_t_eq_bad.tsx",
         "declare <T = {\n", "declare <T = {\n  a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f3_ts_declare_t_eq_bad.ts",
         "declare <T = {\n", "declare <T = {\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f3_tsx_export_default_async_ok.tsx",
         "export default async <T = {\n", "export default async <T = {\n  a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f3_tsx_export_declare_fn_ok.tsx",
         "export declare function f<T = {\n", "export declare function f<T = {\n  a: number;\n", true),
        (LanguageId::Tsx, "r17_e2_f3_tsx_export_async_cmt_ok.tsx",
         "export async <T = {\n  // TODO\n", "export async <T = {\n  // DONE\n", true),
        // Explorer 2 F4: TSX function* generator paren <{
        (LanguageId::Tsx, "r17_e2_f4_tsx_fn_star_paren_bad.tsx",
         "const x = function*(y) <{\n", "const x = function*(y) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f4_tsx_fn_star_named_paren_bad.tsx",
         "const x = function* g(y) <{\n", "const x = function* g(y) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f4_tsx_stmt_fn_star_paren_bad.tsx",
         "function* (x) <{\n", "function* (x) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f4_tsx_async_fn_star_paren_bad.tsx",
         "async function* (x) <{\n", "async function* (x) <{\n  a: number;\n", false),
        (LanguageId::Tsx, "r17_e2_f4_tsx_mul_paren_call_ok.tsx",
         "const x = a * (y)<{\n", "const x = a * (y)<{\n  a: number;\n", true),
        // Explorer 2 F5: keyword-named generic members <T = {
        (LanguageId::Tsx, "r17_e2_f5_tsx_cls_if_t_eq_ok.tsx",
         "class C {\n  if<T = {\n    a: number;\n", "class C {\n  if<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_obj_if_t_eq_ok.ts",
         "const o = {\n  if<T = {\n    a: number;\n", "const o = {\n  if<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_for_t_eq_ok.ts",
         "class C {\n  for<T = {\n    a: number;\n", "class C {\n  for<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_while_t_eq_ok.ts",
         "class C {\n  while<T = {\n    a: number;\n", "class C {\n  while<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_switch_t_eq_ok.ts",
         "class C {\n  switch<T = {\n    a: number;\n", "class C {\n  switch<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_typeof_t_eq_ok.ts",
         "class C {\n  typeof<T = {\n    a: number;\n", "class C {\n  typeof<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_iface_if_t_eq_ok.ts",
         "interface I {\n  if<T = {\n    a: number;\n", "interface I {\n  if<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_asi_if_t_eq_ok.ts",
         "class C {\n  a: number\n  if<T = {\n    a: number;\n", "class C {\n  a: number\n  if<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r17_e2_f5_ts_obj_val_typeof_t_eq_bad.ts",
         "const o = {\n  a: typeof <T = {\n    a: number;\n", "const o = {\n  a: typeof <T = {\n    a: number;\n    readonly b: string;\n", false),
        (LanguageId::Tsx, "r17_e2_f5_tsx_cls_assign_typeof_bad.tsx",
         "class C {\n  x = typeof <{\n", "class C {\n  x = typeof <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_assign_typeof_t_eq_bad.ts",
         "class C {\n  x = typeof <T = {\n", "class C {\n  x = typeof <T = {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f5_ts_cls_assign_typeof_cast_ok.ts",
         "class C {\n  x = typeof <{\n", "class C {\n  x = typeof <{\n    a: number;\n", true),
        (LanguageId::TypeScript, "r17_e2_f6_b1_arr_cmp_call_lt_ro_bad.ts",
         "const xs = [\n  a < b,\n  bar(1)<2, {\n", "const xs = [\n  a < b,\n  bar(1)<2, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b2_arr_cmp_idx_lt_ro_bad.ts",
         "const xs = [\n  a < b,\n  a[b]<2, {\n", "const xs = [\n  a < b,\n  a[b]<2, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b3_arr_cmp_call_max_ro_bad.ts",
         "const xs = [\n  a < b,\n  foo(a)<MaxVal, {\n", "const xs = [\n  a < b,\n  foo(a)<MaxVal, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b4_call_cmp_call_lt_ro_bad.ts",
         "foo(a < b, bar(1)<2, {\n", "foo(a < b, bar(1)<2, {\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b5_call_cmp_idx_max_ro_bad.ts",
         "foo(a < b, a[b]<MaxVal, {\n", "foo(a < b, a[b]<MaxVal, {\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b6_paren_cmp_call_lt_ro_bad.ts",
         "const x = (a < b, bar(1)<2, {\n", "const x = (a < b, bar(1)<2, {\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_b7_paren_cmp_idx_lt_ro_bad.ts",
         "const x = (a < b, a[b]<2, {\n", "const x = (a < b, a[b]<2, {\n  readonly b: number;\n", false),
        (LanguageId::TypeScript, "r17_e2_f6_arr_cmp_call_lt_obj_ok.ts",
         "const xs = [\n  a < b,\n  bar(1)<2, {\n", "const xs = [\n  a < b,\n  bar(1)<2, {\n    a: 1,\n", true),
        (LanguageId::TypeScript, "r17_e2_f6_arr_cmp_bar_pascal_ro_ok.ts",
         "const xs = [\n  a < b,\n  bar<Foo, {\n", "const xs = [\n  a < b,\n  bar<Foo, {\n    readonly b: number;\n", true),
        (LanguageId::TypeScript, "r17_e2_f6_arr_cmp_call_obj_sib_ok.ts",
         "const xs = [\n  a < b,\n  bar(1)<2,\n", "const xs = [\n  a < b,\n  bar(1)<2,\n  { a: 1 },\n", true),
        // Explorer 2 F7: Cluster C callee <{ object-literal comparisons
        (LanguageId::Tsx, "r17_e2_f7_c1_tsx_as_any_add_ok.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c2_ts_as_any_add_ok.ts",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c3_ts_as_any_spread_ok.ts",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  ...other,\n", true),
        (LanguageId::Tsx, "r17_e2_f7_c4_tsx_as_any_method_ok.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  m() { return 1; },\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c5_ts_as_any_method_ok.ts",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  m() { return 1; },\n", true),
        (LanguageId::Tsx, "r17_e2_f7_c6_tsx_call_add_ok.tsx",
         "const x = foo()<{\n", "const x = foo()<{\n  a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c7_ts_call_add_ok.ts",
         "const x = foo()<{\n", "const x = foo()<{\n  a: 1 + 2,\n", true),
        (LanguageId::Tsx, "r17_e2_f7_c8_tsx_call_spread_ok.tsx",
         "const x = foo()<{\n", "const x = foo()<{\n  ...other,\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c9_ts_call_spread_ok.ts",
         "const x = foo()<{\n", "const x = foo()<{\n  ...other,\n", true),
        (LanguageId::Tsx, "r17_e2_f7_c10_tsx_call_method_ok.tsx",
         "const x = foo()<{\n", "const x = foo()<{\n  m() { return 1; },\n", true),
        (LanguageId::TypeScript, "r17_e2_f7_c11_ts_idx_spread_ok.ts",
         "const x = a[b]<{\n", "const x = a[b]<{\n  ...other,\n", true),
        (LanguageId::Tsx, "r17_e2_f7_tsx_cls_idx_spread_ok.tsx",
         "class C {\n  x = a[b]<{\n", "class C {\n  x = a[b]<{\n    ...other,\n", true),
        (LanguageId::Tsx, "r17_e2_f7_tsx_as_any_broken_expr_bad.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  a: 1 + *,\n", false),
        (LanguageId::Tsx, "r17_e2_f7_tsx_as_any_iface_plus_spread_bad.tsx",
         "const x = (a as any)<{\n", "const x = (a as any)<{\n  a: number;\n  ...other,\n", false),
        (LanguageId::TypeScript, "r17_e2_f7_ts_type_alias_paren_spread_bad.ts",
         "type T = (A)<{\n", "type T = (A)<{\n  ...other,\n", false),
        // Explorer 3: Twig inner closed-syntax tag masking + EOF closer after {% if broken
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_if_ok_endblock_other_bad.twig",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_if_ok_endblock_body_to_other_bad.twig",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock body %}\n",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_for_endblock_other_bad.twig",
         "{% block body %}\n  {% for x in xs %}\n  <p>{{ x }}</p>\n{% endblock %}\n",
         "{% block body %}\n  {% for x in xs %}\n  <p>{{ x }}</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_set_endblock_other_bad.twig",
         "{% block body %}\n  {% set x %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% set x %}\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_embed_endblock_other_bad.twig",
         "{% block body %}\n  {% embed \"x.twig\" %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% embed \"x.twig\" %}\n  <p>hi</p>\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_macro_unclosed_if_endmacro_bar_bad.twig",
         "{% macro foo(a) %}\n  {% if ok %}\n  <p>{{ a }}</p>\n{% endmacro %}\n",
         "{% macro foo(a) %}\n  {% if ok %}\n  <p>{{ a }}</p>\n{% endmacro bar %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_trim_block_unclosed_if_ok_endblock_other_bad.twig",
         "{%- block body -%}\n  {%- if ok -%}\n  <p>hi</p>\n{%- endblock -%}\n",
         "{%- block body -%}\n  {%- if ok -%}\n  <p>hi</p>\n{%- endblock other -%}\n", false),
        (LanguageId::Twig, "r17_e3_twig_pure_del_endblock_inner_if_ok_bad.twig",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n", false),
        (LanguageId::Twig, "r17_e3_twig_pure_del_endif_inner_for_bad.twig",
         "{% if ok %}\n  {% for x in xs %}\n  <p>{{ x }}</p>\n{% endif %}\n",
         "{% if ok %}\n  {% for x in xs %}\n  <p>{{ x }}</p>\n", false),
        (LanguageId::Twig, "r17_e3_twig_pure_del_endmacro_inner_if_ok_bad.twig",
         "{% macro foo(a) %}\n  {% if ok %}\n  <p>{{ a }}</p>\n{% endmacro %}\n",
         "{% macro foo(a) %}\n  {% if ok %}\n  <p>{{ a }}</p>\n", false),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endblock_other_after_broken_bad.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% endblock other %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endmacro_bar_after_broken_bad.twig",
         "{% macro foo(a) %}\n  {% if broken\n",
         "{% macro foo(a) %}\n  {% if broken\n{% endmacro bar %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_block_unclosed_if_ok_endblock_body_ok.twig",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock body %}\n", true),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endblock_after_broken_ok.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% endblock %}\n", true),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endblock_body_after_broken_ok.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% endblock body %}\n", true),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endmacro_foo_after_broken_ok.twig",
         "{% macro foo(a) %}\n  {% if broken\n",
         "{% macro foo(a) %}\n  {% if broken\n{% endmacro foo %}\n", true),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endblock_plus_unclosed_if_bad.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% endblock %}\n{% if ok %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_eof_append_endblock_plus_unclosed_div_bad.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% endblock %}\n<div>\n", false),
        (LanguageId::Twig, "r17_e3_twig_eof_append_unclosed_if_ok_bad.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% if ok %}\n", false),
        (LanguageId::Twig, "r17_e3_twig_eof_append_balanced_if_ok.twig",
         "{% block body %}\n  {% if broken\n",
         "{% block body %}\n  {% if broken\n{% if ok %}\n  <p>hi</p>\n{% endif %}\n", true),
        (LanguageId::Twig, "r17_e3_twig_pure_del_p_inside_unclosed_if_ok.twig",
         "{% block body %}\n  {% if ok %}\n  <p>hi</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if ok %}\n{% endblock %}\n", true),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    let twig_20_rows = "  <p>row</p>\n".repeat(20);
    let twig_20_base = format!("{{% block body %}}\n  {{% if ok %}}\n{twig_20_rows}{{% endblock %}}\n");
    let twig_20_cand = format!("{{% block body %}}\n  {{% if ok %}}\n{twig_20_rows}{{% endblock other %}}\n");
    let toml_arr_rows: String = (0..105).map(|i| format!("  {{ k = {i} }},\n")).collect();
    let toml_arr_base = format!("bad = [\narr = [\n{toml_arr_rows}]\n");
    let toml_arr_ok = format!("bad = [\narr = [\n{toml_arr_rows}  {{ k = 110 }},\n]\n");
    let toml_arr_bad_brace = format!("bad = [\narr = [\n{toml_arr_rows}  {{ k = 110\n]\n");
    let toml_arr_bad_rbrace = format!("bad = [\narr = [\n{toml_arr_rows}  }}\n]\n");
    let toml_itbl_rows: String = (0..105).map(|i| format!("  \"v{i}\",\n")).collect();
    let toml_itbl_base = format!("bad = [\ntbl = {{ a = [\n{toml_itbl_rows}] }}\n");
    let toml_itbl_ok = format!("bad = [\ntbl = {{ a = [\n{toml_itbl_rows}  \"v106\",\n] }}\n");
    let toml_itbl_bad_kv = format!("bad = [\ntbl = {{ a = [\n{toml_itbl_rows}  k = \n] }}\n");
    for (lang, name, base, cand, exp) in [
        (LanguageId::Twig, "r17_e3_twig_20l_block_unclosed_if_ok_endblock_other_bad.twig", twig_20_base.as_str(), twig_20_cand.as_str(), false),
        (LanguageId::Toml, "r17_e3_toml_105l_arr_pure_insert_ok.toml", toml_arr_base.as_str(), toml_arr_ok.as_str(), true),
        (LanguageId::Toml, "r17_e3_toml_105l_itbl_pure_insert_ok.toml", toml_itbl_base.as_str(), toml_itbl_ok.as_str(), true),
        (LanguageId::Toml, "r17_e3_toml_105l_arr_pure_insert_unclosed_brace_bad.toml", toml_arr_base.as_str(), toml_arr_bad_brace.as_str(), false),
        (LanguageId::Toml, "r17_e3_toml_105l_arr_pure_insert_stray_rbrace_bad.toml", toml_arr_base.as_str(), toml_arr_bad_rbrace.as_str(), false),
        (LanguageId::Toml, "r17_e3_toml_105l_itbl_pure_insert_invalid_kv_bad.toml", toml_itbl_base.as_str(), toml_itbl_bad_kv.as_str(), false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r17_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r18_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    for (lang, name, base, cand, exp) in [
        // Explorer 1 Negative Controls (Problem 1: foo(x)<..., a[b]<..., [sym]<..., {)
        (LanguageId::TypeScript, "r18_e1_cls_foo_paren_t_comma_ts_bad.ts",
         "class C {\n  foo(x) <T, {\n", "class C {\n  foo(x) <T, {\n    a: number;\n", false),
        (LanguageId::Tsx, "r18_e1_cls_foo_paren_t_comma_tsx_bad.tsx",
         "class C {\n  foo(x) <T, {\n", "class C {\n  foo(x) <T, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_foo_paren_ro_ts_bad.ts",
         "class C {\n  foo(x)<T, {\n", "class C {\n  foo(x)<T, {\n    readonly b: number;\n", false),
        (LanguageId::Tsx, "r18_e1_cls_foo_paren_ro_tsx_bad.tsx",
         "class C {\n  foo(x)<T, {\n", "class C {\n  foo(x)<T, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_foo_paren_t_comma_bad.ts",
         "interface I {\n  foo(x) <T, {\n", "interface I {\n  foo(x) <T, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_foo_paren_ro_bad.ts",
         "interface I {\n  foo(x) <T, {\n", "interface I {\n  foo(x) <T, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_foo_paren_ext_ts_bad.ts",
         "class C {\n  foo(x) <T extends {\n", "class C {\n  foo(x) <T extends {\n    a: number;\n", false),
        (LanguageId::Tsx, "r18_e1_cls_foo_paren_ext_tsx_bad.tsx",
         "class C {\n  foo(x) <T extends {\n", "class C {\n  foo(x) <T extends {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_foo_paren_ext_cmt_repl_bad.ts",
         "class C {\n  foo(x) <T extends {\n  // TODO\n", "class C {\n  foo(x) <T extends {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_obj_foo_paren_ext_bad.ts",
         "const o = {\n  foo(x) <T extends {\n", "const o = {\n  foo(x) <T extends {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_foo_paren_ext_bad.ts",
         "interface I {\n  foo(x) <T extends {\n", "interface I {\n  foo(x) <T extends {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_ab_ext_ts_bad.ts",
         "class C {\n  a[b]<T extends {\n", "class C {\n  a[b]<T extends {\n    a: number;\n", false),
        (LanguageId::Tsx, "r18_e1_cls_ab_ext_tsx_bad.tsx",
         "class C {\n  a[b]<T extends {\n", "class C {\n  a[b]<T extends {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_ab_t_comma_bad.ts",
         "class C {\n  a[b]<T, {\n", "class C {\n  a[b]<T, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_foo_comma_bad.ts",
         "class C {\n  [sym]<Foo, {\n", "class C {\n  [sym]<Foo, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_sym_foo_comma_bad.ts",
         "interface I {\n  [sym]<Foo, {\n", "interface I {\n  [sym]<Foo, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_obj_sym_foo_comma_bad.ts",
         "const o = {\n  [sym]<Foo, {\n", "const o = {\n  [sym]<Foo, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_mytype_ts_bad.ts",
         "class C {\n  [sym]<MY_TYPE, {\n", "class C {\n  [sym]<MY_TYPE, {\n    a: number;\n", false),
        (LanguageId::Tsx, "r18_e1_cls_sym_mytype_tsx_bad.tsx",
         "class C {\n  [sym]<MY_TYPE, {\n", "class C {\n  [sym]<MY_TYPE, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_obj_sym_mytype_ts_bad.ts",
         "const o = {\n  [sym]<MY_TYPE, {\n", "const o = {\n  [sym]<MY_TYPE, {\n    a: number;\n", false),
        (LanguageId::Tsx, "r18_e1_obj_sym_mytype_tsx_bad.tsx",
         "const o = {\n  [sym]<MY_TYPE, {\n", "const o = {\n  [sym]<MY_TYPE, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_sym_mytype_bad.ts",
         "interface I {\n  [sym]<MY_TYPE, {\n", "interface I {\n  [sym]<MY_TYPE, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_number_comma_bad.ts",
         "class C {\n  [sym]<number, {\n", "class C {\n  [sym]<number, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_t_comma_ro_bad.ts",
         "class C {\n  [sym]<T, {\n", "class C {\n  [sym]<T, {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_ext_foo_comma_bad.ts",
         "class C {\n  [sym]<T extends Foo, {\n", "class C {\n  [sym]<T extends Foo, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_sym_eq_foo_comma_bad.ts",
         "class C {\n  [sym]<T = Foo, {\n", "class C {\n  [sym]<T = Foo, {\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_obj_prior_lt_foo_paren_bad.ts",
         "const o = {\n  x: a < b,\n  foo(x) <{\n", "const o = {\n  x: a < b,\n  foo(x) <{\n    a: 1,\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_dec1_quoted_paren_t_comma_bad.ts",
         "class C {\n  a = 1\n  @dec(1) \"my-m\"(x)<T, {\n", "class C {\n  a = 1\n  @dec(1) \"my-m\"(x)<T, {\n    a: number;\n", false),
        // Explorer 1 Negative Controls (Problem 2: ClassOrType type-annotation colon)
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_foo_spread_bad.ts",
         "class C {\n  x: foo(x) <{\n", "class C {\n  x: foo(x) <{\n    ...other,\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_foo_expr_bad.ts",
         "class C {\n  x: foo(x) <{\n", "class C {\n  x: foo(x) <{\n    a: 1 + 2,\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_foo_ro_bad.ts",
         "class C {\n  x: foo(x) <{\n", "class C {\n  x: foo(x) <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_type_colon_foo_spread_bad.ts",
         "interface I {\n  x: foo(x) <{\n", "interface I {\n  x: foo(x) <{\n    ...other,\n", false),
        (LanguageId::TypeScript, "r18_e1_iface_type_colon_foo_type_bad.ts",
         "interface I {\n  x: foo(x) <{\n", "interface I {\n  x: foo(x) <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_ab_spread_bad.ts",
         "class C {\n  x: a[b] <{\n", "class C {\n  x: a[b] <{\n    ...other,\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_ab_expr_bad.ts",
         "class C {\n  x: a[b] <{\n", "class C {\n  x: a[b] <{\n    a: 1 + 2,\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_ab_type_bad.ts",
         "class C {\n  x: a[b] <{\n", "class C {\n  x: a[b] <{\n    a: number;\n", false),
        (LanguageId::TypeScript, "r18_e1_cls_type_colon_typeof_foo_bad.ts",
         "class C {\n  x: typeof foo(x) <{\n", "class C {\n  x: typeof foo(x) <{\n    a: number;\n", false),
        // Explorer 1 Negative Controls (Problem 3: JavaScript member <{)
        (LanguageId::JavaScript, "r18_e1_js_obj_tern_method_lt_bad.js",
         "const o = {\n  [cond ? a : b]() <{\n", "const o = {\n  [cond ? a : b]() <{\n    x: 1,\n", false),
        (LanguageId::JavaScript, "r18_e1_js_obj_foo_lt_bad.js",
         "const o = {\n  foo(x) <{\n", "const o = {\n  foo(x) <{\n    x: 1,\n", false),
        (LanguageId::JavaScript, "r18_e1_js_cls_foo_lt_bad.js",
         "class C {\n  foo(x) <{\n", "class C {\n  foo(x) <{\n    x: 1,\n", false),
        (LanguageId::JavaScript, "r18_e1_js_obj_sym_lt_bad.js",
         "const o = {\n  [sym]<{\n", "const o = {\n  [sym]<{\n    x: 1,\n", false),
        (LanguageId::JavaScript, "r18_e1_js_cls_sym_lt_bad.js",
         "class C {\n  [sym]<{\n", "class C {\n  [sym]<{\n    x: 1,\n", false),
        (LanguageId::JavaScript, "r18_e1_js_obj_prior_lt_foo_bad.js",
         "const o = {\n  x: a < b,\n  foo(x) <{\n", "const o = {\n  x: a < b,\n  foo(x) <{\n    x: 1,\n", false),
        // Explorer 1 Positive Controls
        (LanguageId::TypeScript, "r18_e1_cls_sym_t_eq_ok.ts",
         "class C {\n  [sym]<T = {\n", "class C {\n  [sym]<T = {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_sym_tu_eq_ok.ts",
         "class C {\n  [sym]<T, U = {\n", "class C {\n  [sym]<T, U = {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_sym_t_ext_ok.ts",
         "class C {\n  [sym]<T extends {\n", "class C {\n  [sym]<T extends {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_sym_t_ext_foo_u_eq_ok.ts",
         "class C {\n  [sym]<T extends Foo, U = {\n", "class C {\n  [sym]<T extends Foo, U = {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_sym_t_eq_foobar_ok.ts",
         "class C {\n  [sym]<T = Foo<Bar, {\n", "class C {\n  [sym]<T = Foo<Bar, {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_obj_sym_t_ext_ok.ts",
         "const o = {\n  [sym]<T extends {\n", "const o = {\n  [sym]<T extends {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_iface_sym_t_ext_ok.ts",
         "interface I {\n  [sym]<T extends {\n", "interface I {\n  [sym]<T extends {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_obj_x_foo_t_comma_ts_ok.ts",
         "const o = {\n  x: foo()<T, {\n", "const o = {\n  x: foo()<T, {\n    a: number;\n", true),
        (LanguageId::Tsx, "r18_e1_obj_x_foo_t_comma_tsx_ok.tsx",
         "const o = {\n  x: foo()<T, {\n", "const o = {\n  x: foo()<T, {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_x_eq_foo_t_comma_ok.ts",
         "class C {\n  x = foo()<T, {\n", "class C {\n  x = foo()<T, {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_foo_t_ext_ok.ts",
         "class C {\n  foo<T extends {\n", "class C {\n  foo<T extends {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_x_eq_foo_paren_lt_ok.ts",
         "class C {\n  x = foo(x) <{\n", "class C {\n  x = foo(x) <{\n    ...other,\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_x_typed_eq_foo_paren_lt_ok.ts",
         "class C {\n  x: Foo = foo(x) <{\n", "class C {\n  x: Foo = foo(x) <{\n    ...other,\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_x_foo_gen_ok.ts",
         "class C {\n  x: Foo<{\n", "class C {\n  x: Foo<{\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_cls_x_obj_type_ok.ts",
         "class C {\n  x: {\n", "class C {\n  x: {\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e1_obj_x_foo_paren_lt_ts_ok.ts",
         "const o = {\n  x: foo(x) <{\n", "const o = {\n  x: foo(x) <{\n    a: 1 + 2,\n", true),
        (LanguageId::JavaScript, "r18_e1_obj_x_foo_paren_lt_js_ok.js",
         "const o = {\n  x: foo(x) <{\n", "const o = {\n  x: foo(x) <{\n    x: 1,\n", true),
        (LanguageId::TypeScript, "r18_e1_obj_x_ab_lt_ts_ok.ts",
         "const o = {\n  x: a[b] <{\n", "const o = {\n  x: a[b] <{\n    a: 1 + 2,\n", true),
        (LanguageId::JavaScript, "r18_e1_obj_x_ab_lt_js_ok.js",
         "const o = {\n  x: a[b] <{\n", "const o = {\n  x: a[b] <{\n    x: 1,\n", true),
        (LanguageId::TypeScript, "r18_e1_obj_spread_foo_lt_ts_ok.ts",
         "const o = {\n  ...foo(x) <{\n", "const o = {\n  ...foo(x) <{\n    x: 1,\n", true),
        (LanguageId::JavaScript, "r18_e1_obj_spread_foo_lt_js_ok.js",
         "const o = {\n  ...foo(x) <{\n", "const o = {\n  ...foo(x) <{\n    x: 1,\n", true),
        (LanguageId::JavaScript, "r18_e1_js_obj_tern_method_ok.js",
         "const o = {\n  [cond ? a : b]() {\n", "const o = {\n  [cond ? a : b]() {\n    return 1;\n", true),
        (LanguageId::TypeScript, "r18_e1_cmt_under_cls_foo_ext_ok.ts",
         "class C {\n  foo(x)<T extends {\n  // TODO\n", "class C {\n  foo(x)<T extends {\n  // DONE\n", true),
        (LanguageId::TypeScript, "r18_e1_cmt_under_cls_x_colon_foo_ok.ts",
         "class C {\n  x: foo(x) <{\n  // TODO\n", "class C {\n  x: foo(x) <{\n  // DONE\n", true),
        (LanguageId::JavaScript, "r18_e1_cmt_under_js_obj_foo_ok.js",
         "const o = {\n  foo(x) <{\n  // TODO\n", "const o = {\n  foo(x) <{\n  // DONE\n", true),
        (LanguageId::JavaScript, "r18_e1_cmt_under_js_obj_tern_ok.js",
         "const o = {\n  [cond ? a : b]() <{\n  // TODO\n", "const o = {\n  [cond ? a : b]() <{\n  // DONE\n", true),
        // Explorer 2 Cluster 2 Positive Controls (StmtBlock-nested callee <{ object literals)
        (LanguageId::TypeScript, "r18_e2_c2_fn_as_any_expr_ts_ok.ts",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    a: 1 + 2,\n", true),
        (LanguageId::Tsx, "r18_e2_c2_fn_as_any_expr_tsx_ok.tsx",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_fn_as_any_spread_ts_ok.ts",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    ...other,\n", true),
        (LanguageId::Tsx, "r18_e2_c2_fn_as_any_spread_tsx_ok.tsx",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    ...other,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_fn_inline_as_any_ts_ok.ts",
         "function f() { const x = (a as any)<{\n", "function f() { const x = (a as any)<{\n  a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_if_foo_expr_ts_ok.ts",
         "if (ok) {\n  const x = foo()<{\n", "if (ok) {\n  const x = foo()<{\n    a: 1 + 2,\n", true),
        (LanguageId::Tsx, "r18_e2_c2_if_foo_spread_tsx_ok.tsx",
         "if (ok) {\n  const x = foo()<{\n", "if (ok) {\n  const x = foo()<{\n    ...other,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_arrow_as_any_ts_ok.ts",
         "const f = () => {\n  const x = (a as any)<{\n", "const f = () => {\n  const x = (a as any)<{\n    a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_fn_obj_as_any_ts_ok.ts",
         "function f() {\n  const o = {\n    x: (a as any)<{\n",
         "function f() {\n  const o = {\n    x: (a as any)<{\n      a: 1 + 2,\n", true),
        (LanguageId::Tsx, "r18_e2_c2_fn_obj_as_any_tsx_ok.tsx",
         "function f() {\n  const o = {\n    x: (a as any)<{\n",
         "function f() {\n  const o = {\n    x: (a as any)<{\n      a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r18_e2_c2_fn_as_any_a1_b1p2_ts_ok.ts",
         "function f() {\n  const x = (a as any)<{\n    a: 1,\n",
         "function f() {\n  const x = (a as any)<{\n    a: 1,\n    b: 1 + 2,\n", true),
        // Explorer 2 Cluster 2 Negative Controls
        (LanguageId::TypeScript, "r18_e2_c2_fn_ro_stmt_ts_bad.ts",
         "function f() {\n", "function f() {\n  readonly a: number;\n", false),
        (LanguageId::Tsx, "r18_e2_c2_fn_ro_stmt_tsx_bad.tsx",
         "function f() {\n", "function f() {\n  readonly a: number;\n", false),
        (LanguageId::TypeScript, "r18_e2_c2_fn_a_lt_ro_ts_bad.ts",
         "function f() {\n  const x = a < {\n", "function f() {\n  const x = a < {\n    readonly b: number;\n", false),
        (LanguageId::TypeScript, "r18_e2_c2_if_ro_ts_bad.ts",
         "if (ok) {\n", "if (ok) {\n  readonly a: number;\n", false),
        (LanguageId::TypeScript, "r18_e2_c2_fn_as_any_semi_bad.ts",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    a: 1 + 2;\n", false),
        (LanguageId::Tsx, "r18_e2_c2_fn_as_any_const_bad.tsx",
         "function f() {\n  const x = (a as any)<{\n", "function f() {\n  const x = (a as any)<{\n    const y = 1;\n", false),
        (LanguageId::TypeScript, "r18_e2_c2_fn_as_any_mixed_ro_expr_bad.ts",
         "function f() {\n  const x = (a as any)<{\n    a: number;\n",
         "function f() {\n  const x = (a as any)<{\n    a: number;\n    b: 1 + 2,\n", false),
        (LanguageId::TypeScript, "r18_e2_c2_fn_obj_foo_semi_bad.ts",
         "function f() {\n  const o = {\n    x: foo(x) <{\n",
         "function f() {\n  const o = {\n    x: foo(x) <{\n      a: 1 + 2;\n", false),
        // Explorer 2 Cluster 3 Positive Controls (await/return/throw/yield <T = { members)
        (LanguageId::TypeScript, "r18_e2_c3_cls_await_ts_ok.ts",
         "class C {\n  await<T = {\n    a: number;\n", "class C {\n  await<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_return_ts_ok.ts",
         "class C {\n  return<T = {\n    a: number;\n", "class C {\n  return<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_throw_ts_ok.ts",
         "class C {\n  throw<T = {\n    a: number;\n", "class C {\n  throw<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_yield_ts_ok.ts",
         "class C {\n  yield<T = {\n    a: number;\n", "class C {\n  yield<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::Tsx, "r18_e2_c3_cls_return_tsx_ok.tsx",
         "class C {\n  return<T = {\n    a: number;\n", "class C {\n  return<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_obj_await_ts_ok.ts",
         "const o = {\n  await<T = {\n    a: number;\n", "const o = {\n  await<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::Tsx, "r18_e2_c3_obj_return_tsx_ok.tsx",
         "const o = {\n  return<T = {\n    a: number;\n", "const o = {\n  return<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_iface_await_ts_ok.ts",
         "interface I {\n  await<T = {\n    a: number;\n", "interface I {\n  await<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_iface_return_ts_ok.ts",
         "interface I {\n  return<T = {\n    a: number;\n", "interface I {\n  return<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_async_await_ok.ts",
         "class C {\n  async await<T = {\n    a: number;\n", "class C {\n  async await<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_static_return_ok.ts",
         "class C {\n  static return<T = {\n    a: number;\n", "class C {\n  static return<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_public_yield_ok.ts",
         "class C {\n  public yield<T = {\n    a: number;\n", "class C {\n  public yield<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_star_yield_ok.ts",
         "class C {\n  *yield<T = {\n    a: number;\n", "class C {\n  *yield<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_async_star_await_ok.ts",
         "class C {\n  async *await<T = {\n    a: number;\n", "class C {\n  async *await<T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_cls_asi_await_ok.ts",
         "class C {\n  x = 1\n  await<T = {\n", "class C {\n  x = 1\n  await<T = {\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_fn_return_detached_gen_ok.ts",
         "function f() {\n  return <T = {\n    a: number;\n", "function f() {\n  return <T = {\n    a: number;\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_fn_return_cast_type_ok.ts",
         "function f() {\n  return <{\n", "function f() {\n  return <{\n    a: number;\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_fn_return_foo_cast_obj_ok.ts",
         "function f() {\n  return foo()<{\n", "function f() {\n  return foo()<{\n    a: 1 + 2,\n", true),
        (LanguageId::TypeScript, "r18_e2_c3_fn_return_cast_obj_bad.ts",
         "function f() {\n  return <{\n", "function f() {\n  return <{\n    a: 1 + 2,\n", false),
        // Explorer 2 Cluster 3 Negative Controls
        (LanguageId::TypeScript, "r18_e2_c3_obj_a_colon_await_bad.ts",
         "const o = {\n  a: await <T = {\n", "const o = {\n  a: await <T = {\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r18_e2_c3_cls_x_eq_await_bad.ts",
         "class C {\n  x = await <T = {\n", "class C {\n  x = await <T = {\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r18_e2_c3_top_const_await_bad.ts",
         "const x = await<T = {\n", "const x = await<T = {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r18_e2_c3_cls_gen_yield_star_bad.ts",
         "class C {\n  *f() { yield * <T = {\n", "class C {\n  *f() { yield * <T = {\n    readonly b: string;\n", false),
        (LanguageId::TypeScript, "r18_e2_c3_cls_return_foo_bad.ts",
         "class C {\n  return foo<T = {\n", "class C {\n  return foo<T = {\n    readonly b: string;\n", false),
        // Explorer 3 C1 Positive Controls (Twig else/elseif)
        (LanguageId::Twig, "r18_e3_c1_broken_outer_inner_else_ok.twig",
         "{% if broken\n{% if ok %}\n  a\n", "{% if broken\n{% if ok %}\n  a\n{% else %}\n  b\n{% endif %}\n", true),
        (LanguageId::Twig, "r18_e3_c1_elseif_before_else_ok.twig",
         "{% if a %}\n  1\n{% else %}\n  2\n{% endif %}\n",
         "{% if a %}\n  1\n{% elseif b %}\n  3\n{% else %}\n  2\n{% endif %}\n", true),
        (LanguageId::Twig, "r18_e3_c1_sameline_else_nested_if_ok.twig",
         "{% if a %}{% else %}{% if b %}\n", "{% if a %}{% else %}{% if b %}\n{% endif %}\n", true),
        // Explorer 3 C1 Negative Controls (Twig duplicate else / elseif-after-else)
        (LanguageId::Twig, "r18_e3_c1_dup_else_eof_bad.twig",
         "{% if a %}\n  1\n{% else %}\n  2\n", "{% if a %}\n  1\n{% else %}\n  2\n{% else %}\n", false),
        (LanguageId::Twig, "r18_e3_c1_dup_else_mid_bad.twig",
         "{% if a %}\n  1\n{% else %}\n  2\n{% endif %}\n",
         "{% if a %}\n  1\n{% else %}\n  2\n{% else %}\n  3\n{% endif %}\n", false),
        (LanguageId::Twig, "r18_e3_c1_dup_dash_else_eof_bad.twig",
         "{% if a %}\n  1\n{% else %}\n  2\n", "{% if a %}\n  1\n{% else %}\n  2\n{%- else -%}\n", false),
        (LanguageId::Twig, "r18_e3_c1_elseif_after_else_bad.twig",
         "{% if a %}\n  1\n{% else %}\n  2\n{% endif %}\n",
         "{% if a %}\n  1\n{% else %}\n  2\n{% elseif c %}\n  3\n{% endif %}\n", false),
        (LanguageId::Twig, "r18_e3_c1_for_dup_else_bad.twig",
         "{% for x in xs %}\n  1\n{% else %}\n  2\n{% endfor %}\n",
         "{% for x in xs %}\n  1\n{% else %}\n  2\n{% else %}\n  3\n{% endfor %}\n", false),
        (LanguageId::Twig, "r18_e3_c1_block_nested_dup_else_bad.twig",
         "{% block b %}\n  {% if a %}\n    1\n  {% else %}\n    2\n",
         "{% block b %}\n  {% if a %}\n    1\n  {% else %}\n    2\n  {% else %}\n", false),
        (LanguageId::Twig, "r18_e3_c1_repl_endfor_with_else_under_else_bad.twig",
         "{% if ok %}\n  {% for x in xs %}\n    1\n{% else %}\n  2\n{% endfor %}\n{% endif %}\n",
         "{% if ok %}\n  {% for x in xs %}\n    1\n{% else %}\n  2\n{% else %}\n{% endif %}\n", false),
        // Explorer 3 C2 Positive & Negative Controls (Twig unclosed {% replaced by closer)
        (LanguageId::Twig, "r18_e3_c2_outer_if_repl_broken_with_endif_ok.twig",
         "{% if outer %}\n  {% if broken\n", "{% if outer %}\n  {% endif %}\n", true),
        (LanguageId::Twig, "r18_e3_c2_nested_repl_broken_with_fixed_ok.twig",
         "{% if top_broken\n{% block body %}\n  {% if broken\n  <p>a</p>\n{% endblock %}\n",
         "{% if top_broken\n{% block body %}\n  {% if fixed %}\n  <p>a</p>\n  {% endif %}\n{% endblock %}\n", true),
        (LanguageId::Twig, "r18_e3_c2_nested_repl_broken_with_cmt_ok.twig",
         "{% if top_broken\n{% block body %}\n  {% if broken\n  <p>a</p>\n{% endblock %}\n",
         "{% if top_broken\n{% block body %}\n  {# fixed #}\n  <p>a</p>\n{% endblock %}\n", true),
        (LanguageId::Twig, "r18_e3_c2_repl_broken_with_endblock_other_bad.twig",
         "{% block body %}\n  {% if broken\n", "{% block body %}\n  {% endblock other %}\n", false),
        (LanguageId::Twig, "r18_e3_c2_repl_broken_with_endif_no_if_bad.twig",
         "{% block body %}\n  {% if broken\n", "{% block body %}\n  {% endif %}\n", false),
        (LanguageId::Twig, "r18_e3_c2_repl_broken_with_unclosed_fixed_bad.twig",
         "{% block body %}\n  {% if broken\n  <p>a</p>\n{% endblock %}\n",
         "{% block body %}\n  {% if fixed %}\n  <p>a</p>\n{% endblock %}\n", false),
        // Explorer 3 C3 Positive & Negative Controls (TOML unclosed array pure insertion)
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_item_ok.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  3,\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_itbl_ok.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  { a = 3 },\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_rbrack_str_ok.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  \"a]b\",\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_prior_bad_arr_insert_ok.toml",
         "bad = [\narr = [\n  1,\n  2,\n", "bad = [\narr = [\n  1,\n  2,\n  3,\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_tbl_arr_insert_ok.toml",
         "tbl = { a = [\n  1,\n  2,\n", "tbl = { a = [\n  1,\n  2,\n  3,\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_unclosed_brace_bad.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  { k = 110\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_rbrace_bad.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  }\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_kv_bad.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  k = \n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_lbrack_bad.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  [\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_close_eof_ok.toml",
         "arr = [\n  1,\n  2,\n", "arr = [\n  1,\n  2,\n  ]\n", true),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_insert_stray_rbrack_bad.toml",
         "arr = [\n  1,\n  2,\n]\n", "arr = [\n  1,\n  2,\n  ]\n]\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_missing_comma_eof_bad.toml",
         "arr = [\n  1\n", "arr = [\n  1\n  2,\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_missing_comma_mid_bad.toml",
         "arr = [\n  1,\n  3,\n", "arr = [\n  1,\n  2\n  3,\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_itbl_insert_bare_item_bad.toml",
         "tbl = {\n  a = 1,\n", "tbl = {\n  a = 1,\n  3,\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_arr_unclosed_itbl_insert_bad.toml",
         "arr = [\n  { a = 1,\n", "arr = [\n  { a = 1,\n  3,\n", false),
        (LanguageId::Toml, "r18_e3_c3_toml_broken_hdr_insert_bad.toml",
         "[broken\n", "[broken\n  3,\n", false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    let toml_rows: String = (0..105).map(|i| format!("  {i},\n")).collect();
    let toml_105_base = format!("arr = [\n{toml_rows}");
    let toml_105_ok = format!("arr = [\n{toml_rows}  105,\n");
    let toml_105_bad = format!("arr = [\n{toml_rows}  {{ k = 105\n");
    for (name, base, cand, exp) in [
        ("r18_e3_c3_toml_105l_arr_eof_pure_insert_ok.toml", toml_105_base.as_str(), toml_105_ok.as_str(), true),
        ("r18_e3_c3_toml_105l_arr_eof_pure_insert_bad.toml", toml_105_base.as_str(), toml_105_bad.as_str(), false),
    ] {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), LanguageId::Toml);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r18_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r19_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures: Vec<String> = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp { failures.push(format!("{name}: exp={exp} got={v:?}")); }
    };

    // Explorer 1 P1, P2, P3 + E1/E2 multi-param harmonization (.ts & .tsx)
    for (suf, lang) in [(".ts", LanguageId::TypeScript), (".tsx", LanguageId::Tsx)] {
        for (tag, s) in [
            ("r19_e1_p1_cls_comma", "class C {\n  foo<T, {\n"),
            ("r19_e1_p1_cls_def_comma", "class C {\n  foo<T = number, {\n"),
            ("r19_e1_p1_cls_ext_comma", "class C {\n  foo<T extends Foo, {\n"),
            ("r19_e1_p1_cls_def_foo", "class C {\n  foo<T = Foo, {\n"),
            ("r19_e1_p1_cls_def_obj", "class C {\n  foo<T = { a: number }, {\n"),
            ("r19_e1_p1_dec_q_comma", "class C {\n  @dec(1) \"my-m\"<T, {\n"),
            ("r19_e1_p1_dq_comma", "class C {\n  \"my-m\"<T, {\n"),
            ("r19_e1_p1_sq_comma", "class C {\n  'my-m'<T, {\n"),
            ("r19_e1_p1_priv_comma", "class C {\n  #m<T, {\n"),
            ("r19_e1_p1_async_comma", "class C {\n  async m<T, {\n"),
            ("r19_e1_p1_star_comma", "class C {\n  *m<T, {\n"),
            ("r19_e1_p1_obj_comma", "const o = {\n  foo<T, {\n"),
            ("r19_e1_p1_iface_comma", "interface I {\n  foo<T, {\n"),
            ("r19_e1_p1_fn_comma", "function foo<T, {\n"),
            ("r19_e1_p1_exp_fn_comma", "export default function foo<T, {\n"),
            ("r19_e1_p1_cls_hdr_comma", "class C<T, {\n"),
            ("r19_e1_p1_iface_hdr_comma", "interface I<T, {\n"),
            ("r19_e1_p1_type_hdr_comma", "type X<T, {\n"),
            ("r19_e1_p1_expr_cls_comma", "const f = class C<T, {\n"),
            ("r19_e1_p1_expr_fn_comma", "const f = function foo<T, {\n"),
            ("r19_e1_p1_cls_bare", "class C {\n  foo<{\n"),
            ("r19_e1_p1_obj_bare", "const o = {\n  foo<{\n"),
            ("r19_e1_p1_iface_bare", "interface I {\n  foo<{\n"),
            ("r19_e1_p1_fn_bare", "function foo<{\n"),
            ("r19_e1_p1_cls_hdr_bare", "class C<{\n"),
            ("r19_e1_p1_iface_hdr_bare", "interface I<{\n"),
            ("r19_e1_p1_type_hdr_bare", "type X<{\n"),
        ] {
            let cand = format!("{s}  a: number;\n");
            chk(lang, &format!("{tag}{suf}"), s, &cand, false);
        }
        for (tag, s, body) in [
            ("r19_e1_p1_ok_val_assign", "const x = foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_cls_field_val", "class C {\n  x = foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_obj_prop_val", "const o = {\n  x: foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_cls_ann", "class C {\n  x: Foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_iface_ann", "interface I {\n  x: Foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_type_rhs", "type X = Foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_cls_ext", "class C extends Base<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_fn_ret", "function f(): Foo<T, {\n", "  a: number;\n"),
            ("r19_e1_p1_ok_cls_t_def", "class C {\n  foo<T = {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_cls_t_ext", "class C {\n  foo<T extends {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_cls_multi_u", "class C {\n  foo<T = number, U = {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_cls_multi_uext", "class C {\n  foo<T, U extends {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_cls_nested_gen", "class C {\n  foo<T = Foo<U, {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_dec_q_def", "class C {\n  @dec(1) \"my-m\"<T = {\n", "  readonly a: number;\n"),
            ("r19_e1_p1_ok_cls_comma_sep", "class C {\n  x = a < b,\n  foo<T = {\n", "  readonly a: number;\n"),
        ] {
            let cand = format!("{s}{body}");
            chk(lang, &format!("{tag}{suf}"), s, &cand, true);
        }
        for (tag, s, body, exp) in [
            ("r19_e1_p2_ok_dec_q_cmt", "class C {\n  @dec(1) \"my-m\" /* c */ <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p2_ok_q_line_cmt", "class C {\n  \"my-m\" // c\n  <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p2_ok_cls_q_ws", "class C {\n  \"x\" <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p2_ok_obj_q_ws", "const o = {\n  \"x\" <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p2_ok_iface_q_ws", "interface I {\n  \"x\" <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p2_bad_obj_q_bare", "const o = {\n  \"x\" <{\n", "  a: number;\n", false),
            ("r19_e1_p2_bad_obj_q_comma_bare", "const o = {\n  a: 1, \"x\" <{\n", "  a: number;\n", false),
            ("r19_e1_p2_bad_cls_q_bare", "class C {\n  \"x\" <{\n", "  a: number;\n", false),
            ("r19_e1_p3_bad_cls_ret_ann", "class C {\n  a: return<T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_bad_iface_ret_ann", "interface I {\n  a: return<T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_bad_type_ret", "type X = return<T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_bad_cls_ret_att", "class K {\n  v = return<T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_bad_cls_ret_det", "class K {\n  v = return <T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_bad_const_ret_det", "const x = return <T = {\n", "  readonly a: number;\n", false),
            ("r19_e1_p3_ok_cls_ret_meth", "class C {\n  return<T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p3_ok_fn_ret_det", "function f() {\n  return <T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p3_ok_fn_ret_att", "function f() {\n  return<T = {\n", "  readonly a: number;\n", true),
            ("r19_e1_p3_ok_cls_ret_lt_obj", "class K {\n  v = return < {\n    a: 1,\n", "    b: 2,\n", true),
        ] {
            let cand = format!("{s}{body}");
            chk(lang, &format!("{tag}{suf}"), s, &cand, exp);
        }

        // Explorer 2 P1, P2
        for (tag, base, cand, exp) in [
            ("r19_e2_p1_ok_dq_call", "const o = {\n  \"m\": foo(x) <{\n", "const o = {\n  \"m\": foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_sq_call", "const o = {\n  'm': foo(x) <{\n", "const o = {\n  'm': foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_dq_idx", "const o = {\n  \"m\": a[b] <{\n", "const o = {\n  \"m\": a[b] <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_dq_as", "const o = {\n  \"m\": (a as any) <{\n", "const o = {\n  \"m\": (a as any) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_comp_call", "const o = {\n  [k]: foo(x) <{\n", "const o = {\n  [k]: foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_comp_tern", "const o = {\n  [a ? b : c]: foo(x) <{\n", "const o = {\n  [a ? b : c]: foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_comp_lt_tern", "const o = {\n  [a < b ? \"x\" : \"y\"]: foo(x) <{\n", "const o = {\n  [a < b ? \"x\" : \"y\"]: foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_comp_idx", "const o = {\n  [k]: a[b] <{\n", "const o = {\n  [k]: a[b] <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_comp_as", "const o = {\n  [k]: (a as any)<{\n", "const o = {\n  [k]: (a as any)<{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_num_call", "const o = {\n  1: foo(x) <{\n", "const o = {\n  1: foo(x) <{\n  a: 1 + 2,\n", true),
            ("r19_e2_p1_ok_spread_call", "const o = {\n  ...foo(x) <{\n", "const o = {\n  ...foo(x) <{\n  ...other,\n", true),
            ("r19_e2_p1_ok_spread_as", "const o = {\n  ...((a as any))<{\n", "const o = {\n  ...((a as any))<{\n  ...other,\n", true),
            ("r19_e2_p1_ok_nested", "const a = {\n  \"b\": {\n    [k]: foo(x) <{\n", "const a = {\n  \"b\": {\n    [k]: foo(x) <{\n    c: 1 + 2,\n", true),
            ("r19_e2_p1_bad_dq_semi", "const o = {\n  \"m\": foo(x) <{\n", "const o = {\n  \"m\": foo(x) <{\n  a: 1 + 2;\n", false),
            ("r19_e2_p1_bad_comp_semi", "const o = {\n  [k]: foo(x) <{\n", "const o = {\n  [k]: foo(x) <{\n  a: 1 + 2;\n", false),
            ("r19_e2_p1_bad_comp_bare", "const o = {\n  [k]: Foo<{\n", "const o = {\n  [k]: Foo<{\n  a: 1 + 2;\n", false),
            ("r19_e2_p1_bad_comp_comma", "const o = {\n  [k]: foo<T, {\n", "const o = {\n  [k]: foo<T, {\n  a: 1 + 2,\n", false),
        ] {
            chk(lang, &format!("{tag}{suf}"), base, cand, exp);
        }
        for (tag, s, exp) in [
            ("r19_e2_p2_ok_cls_foo_ws", "class C {\n  foo <T = {\n", true),
            ("r19_e2_p2_ok_obj_foo_ws", "const o = {\n  foo <T = {\n", true),
            ("r19_e2_p2_ok_iface_foo_ws", "interface I {\n  foo <T = {\n", true),
            ("r19_e2_p2_ok_dec_q_ws", "class C {\n  @dec(1) \"my-m\" <T = {\n", true),
            ("r19_e2_p2_ok_dec_q_cmt", "class C {\n  @dec(1) \"my-m\" /* c */ <T = {\n", true),
            ("r19_e2_p2_ok_q_ws", "class C {\n  \"my-m\" <T = {\n", true),
            ("r19_e2_p2_ok_if_ws", "class C {\n  if <T = {\n", true),
            ("r19_e2_p2_ok_for_ws", "class C {\n  for <T = {\n", true),
            ("r19_e2_p2_ok_priv_ws", "class C {\n  #m <T = {\n", true),
            ("r19_e2_p2_ok_multi_ws", "class C {\n  foo <T, U = {\n", true),
            ("r19_e2_p2_ok_num_cls", "class C {\n  1<T = {\n", true),
            ("r19_e2_p2_ok_num_ws_cls", "class C {\n  1 <T = {\n", true),
            ("r19_e2_p2_ok_num_obj", "const o = {\n  1<T = {\n", true),
            ("r19_e2_p2_ok_num_iface", "interface I {\n  1<T = {\n", true),
            ("r19_e2_p2_ok_num_multi", "class C {\n  1<T, U = {\n", true),
            ("r19_e2_p2_ok_num_float", "class C {\n  1.5<T = {\n", true),
            ("r19_e2_p2_ok_num_hex", "class C {\n  0x1<T = {\n", true),
            ("r19_e2_p2_ok_num_after_field", "class C {\n  a = 1\n  1<T = {\n", true),
            ("r19_e2_p2_ok_foo_after_field", "class C {\n  a = 1\n  foo <T = {\n", true),
            ("r19_e2_p2_ok_public_type", "class C {\n  public type <T = {\n", true),
            ("r19_e2_p2_bad_cls_val", "class C {\n  x = foo <T = {\n", false),
            ("r19_e2_p2_bad_obj_ann_if", "const o = {\n  a: if <T = {\n", false),
            ("r19_e2_p2_bad_obj_ann_foo", "const o = {\n  a: foo <T = {\n", false),
            ("r19_e2_p2_bad_await_top", "const x = await <T = {\n", false),
            ("r19_e2_p2_bad_1a", "class C {\n  1a<T = {\n", false),
            ("r19_e2_p2_bad_star_ws", "class C {\n  a = 1\n  *foo <T = {\n", false),
            ("r19_e2_p2_bad_type_foo", "class C {\n  type foo<T = {\n", false),
            ("r19_e2_p2_bad_obj_ret", "const o = {\n  a: return <T = {\n", false),
            ("r19_e2_p2_bad_if_cond_lt", "class C {\n  if (x) <T = {\n", false),
            ("r19_harm_detached_empty_bad", "class C {\n  foo <T, {\n", false),
            ("r19_harm_fn_multi_bad", "function foo<T, {\n", false),
        ] {
            let cand = format!("{s}    readonly b: string;\n");
            chk(lang, &format!("{tag}{suf}"), s, &cand, exp);
        }
    }

    // Explorer 2 P3 (JS / TS / TSX) + multi-param detached harmonization
    for (lang, name, base, cand, exp) in [
        (LanguageId::JavaScript, "r19_e2_p3_js_cls_lt_ok.js", "class C {\n  x = foo\n  < {\n", "class C {\n  x = foo\n  < {\n    a: 1,\n", true),
        (LanguageId::JavaScript, "r19_e2_p3_js_cls_lt_att_ok.js", "class C {\n  x = foo\n  <{\n", "class C {\n  x = foo\n  <{\n    a: 1,\n", true),
        (LanguageId::JavaScript, "r19_e2_p3_js_obj_lt_ok.js", "const o = {\n  x: foo\n  < {\n", "const o = {\n  x: foo\n  < {\n    a: 1,\n", true),
        (LanguageId::JavaScript, "r19_e2_p3_js_obj_iface_ok.js", "const o = {\n  interface: {\n", "const o = {\n  interface: {\n    a: 1,\n", true),
        (LanguageId::TypeScript, "r19_e2_p3_ts_cls_ann_if_ok.ts", "class C {\n  a: number\n  if<T = {\n", "class C {\n  a: number\n  if<T = {\n    readonly b: string;\n", true),
        (LanguageId::TypeScript, "r19_e2_p3_ts_cls_eq_foo_ok.ts", "class C {\n  a = 1\n  foo<T = {\n", "class C {\n  a = 1\n  foo<T = {\n    readonly b: string;\n", true),
        (LanguageId::Tsx, "r19_e2_p3_tsx_semi_div_ok.tsx", "function f() {\n  const x = 1;\n  <div>\n", "function f() {\n  const x = 1;\n  <div>\n    ok\n", true),
        (LanguageId::JavaScript, "r19_e2_p3_js_static_iface_bad.js", "class C {\n  static {\n    interface I {\n", "class C {\n  static {\n    interface I {\n  p: 1;\n", false),
        (LanguageId::JavaScript, "r19_e2_p3_js_top_iface_bad.js", "interface I {\n", "interface I {\n  p: 1;\n", false),
        (LanguageId::JavaScript, "r19_e2_p3_js_cls_bare_x_lt_bad.js", "class C {\n  x\n  < {\n", "class C {\n  x\n  < {\n  a: 1,\n", false),
        (LanguageId::JavaScript, "r19_e2_p3_js_cls_semi_lt_bad.js", "class C {\n  x = foo;\n  < {\n", "class C {\n  x = foo;\n  < {\n  a: 1,\n", false),
        (LanguageId::TypeScript, "r19_e2_p3_ts_cls_asi_lt_bad.ts", "class C {\n  a = 1\n  <T = {\n", "class C {\n  a = 1\n  <T = {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r19_e2_p3_ts_obj_asi_lt_bad.ts", "const o = {\n  x: 1\n  <T = {\n", "const o = {\n  x: 1\n  <T = {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r19_e2_p3_ts_type_asi_lt_bad.ts", "type A = number\n<T = {\n", "type A = number\n<T = {\n  readonly b: string;\n", false),
        (LanguageId::TypeScript, "r19_e2_p3_ts_cmp_asi_lt_bad.ts", "const x = a < b\n<T = {\n", "const x = a < b\n<T = {\n  readonly b: string;\n", false),
        (LanguageId::Tsx, "r19_e2_p3_tsx_nosemi_div_bad.tsx", "function f() {\n  const x = 1\n  <div>\n", "function f() {\n  const x = 1\n  <div>\n    ok\n", false),
        (LanguageId::TypeScript, "r19_harm_detached_multi_ok.ts", "const f = <T, U = {\n", "const f = <T, U = {\n  readonly a: number;\n", true),
        (LanguageId::TypeScript, "r19_harm_num_multi_ok.ts", "class C {\n  1<T, U = {\n", "class C {\n  1<T, U = {\n  readonly a: number;\n", true),
        (LanguageId::TypeScript, "r19_harm_cls_q_multi_ok.ts", "class C {\n  \"my-m\" <T, U = {\n", "class C {\n  \"my-m\" <T, U = {\n  readonly a: number;\n", true),
        (LanguageId::TypeScript, "r19_harm_iface_q_multi_ok.ts", "interface I {\n  \"my-m\" <T, U = {\n", "interface I {\n  \"my-m\" <T, U = {\n  readonly a: number;\n", true),
    ] {
        chk(lang, name, base, cand, exp);
    }

    // Explorer 3: XML closed-container siblings (small & 55L)
    let xml_base_small = "<broken>\n<list>\n  <a>1</a>\n</list>\n";
    let mut xml_55_pre = String::from("<root>\n  <broken>\n  <list>\n");
    for i in 0..50 { xml_55_pre.push_str(&format!("    <i>{i}</i>\n")); }
    let xml_55_base = format!("{xml_55_pre}    <a>1</a>\n  </list>\n</root>\n");
    let xml_55_cand = format!("{xml_55_pre}    <a>1</a>\n    <b>2</b>\n  </list>\n</root>\n");
    for (name, base, cand, exp) in [
        ("r19_e3_xml_small_ok.xml", xml_base_small, "<broken>\n<list>\n  <a>1</a>\n  <b>2</b>\n</list>\n", true),
        ("r19_e3_xml_55l_ok.xml", xml_55_base.as_str(), xml_55_cand.as_str(), true),
        ("r19_e3_xml_repl_ok.xml", "<broken>\n<list>\n  <a>1</a>\n  <b>2</b>\n</list>\n", "<broken>\n<list>\n  <a>1</a>\n  <c>3</c>\n</list>\n", true),
        ("r19_e3_xml_bad_unclosed.xml", xml_base_small, "<broken>\n<list>\n  <a>1</a>\n  <bad\n</list>\n", false),
        ("r19_e3_xml_bad_mismatch.xml", xml_base_small, "<broken>\n<list>\n  <a>1</a>\n  </wrong>\n</list>\n", false),
        ("r19_e3_xml_bad_nested.xml", xml_base_small, "<broken>\n<list>\n  <a>1</a>\n  <a>1<b>\n</list>\n", false),
        ("r19_e3_xml_bad_two_roots.xml", "<broken>\n<a>1</a>\n", "<broken>\n<a>1</a>\n<b>2</b>\n", false),
    ] {
        chk(LanguageId::Xml, name, base, cand, exp);
    }

    // Explorer 3: Ruby & Python py_rb_mid_err
    for hdr in ["if (", "while (", "unless (", "until (", "y = if ("] {
        let b_top = format!("{hdr}\n  a &&\n  c\n)\n  broken =\nend\n");
        let c_top = format!("{hdr}\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n");
        chk(LanguageId::Ruby, &format!("r19_e3_rb_top_ok_{hdr}.rb"), &b_top, &c_top, true);
        for (bad_tag, bad_line) in [("star", "  *"), ("lparen", "  ("), ("rparen", "  b)")] {
            let c_bad = format!("{hdr}\n  a &&\n{bad_line}\n  c\n)\n  broken =\nend\n");
            chk(LanguageId::Ruby, &format!("r19_e3_rb_top_bad_{hdr}_{bad_tag}.rb"), &b_top, &c_bad, false);
        }
        let b_ind = format!("def f\n  {hdr}\n    a &&\n    c\n  )\n    broken =\n  end\nend\n");
        let c_ind = format!("def f\n  {hdr}\n    a &&\n    b &&\n    c\n  )\n    broken =\n  end\nend\n");
        chk(LanguageId::Ruby, &format!("r19_e3_rb_ind_ok_{hdr}.rb"), &b_ind, &c_ind, true);
    }
    let py_base = "if (\n  a and\n  c\n):\n  broken =\n";
    for (name, cand, exp) in [
        ("r19_e3_py_ok.py", "if (\n  a and\n  b and\n  c\n):\n  broken =\n", true),
        ("r19_e3_py_bad_and.py", "if (\n  a and\n  and\n  c\n):\n  broken =\n", false),
        ("r19_e3_py_bad_lp.py", "if (\n  a and\n  (\n  c\n):\n  broken =\n", false),
    ] {
        chk(LanguageId::Python, name, py_base, cand, exp);
    }

    // Explorer 3: Twig verbatim
    let tw_base = "{% if top_broken\n{% verbatim %}\n  hello\n{% endverbatim %}\n";
    for (tag, ins, exp) in [
        ("else", "  {% else %}\n", true),
        ("endblock", "  {% endblock other %}\n", true),
        ("if_ok", "  {% if ok %}\n", true),
        ("var_unclosed", "  {{ unclosed\n", true),
        ("div_close", "  </div>\n", true),
        ("break_verb", "  {% endverbatim %}\n  {% else %}\n", false),
    ] {
        let cand = format!("{{% if top_broken\n{{% verbatim %}}\n  hello\n{ins}{{% endverbatim %}}\n");
        chk(LanguageId::Twig, &format!("r19_e3_twig_verb_{tag}.twig"), tw_base, &cand, exp);
    }
    chk(
        LanguageId::Twig, "r19_e3_twig_verb_del_if_ok.twig",
        "{% if top_broken\n{% verbatim %}\n  {% if a %}\n  {% endif %}\n{% endverbatim %}\n",
        "{% if top_broken\n{% verbatim %}\n  {% endif %}\n{% endverbatim %}\n", true,
    );
    chk(
        LanguageId::Twig, "r19_e3_twig_trim_verb_ok.twig",
        "{%- verbatim -%}\n  {% else %}\n{%- endverbatim -%}\n",
        "{%- verbatim -%}\n  {% else %}\n  {% endif %}\n{%- endverbatim -%}\n", true,
    );

    // Explorer 3: TOML multiline strings, 5-level arrays, broken-sibling arrays
    for (name, base, cand, exp) in [
        ("r19_e3_toml_ml_dq_word_ok.toml", "s = \"\"\"\nhello\n", "s = \"\"\"\nhello\nworld\n", true),
        ("r19_e3_toml_ml_dq_kv_ok.toml", "s = \"\"\"\nhello\n", "s = \"\"\"\nhello\nfoo = 1\n", true),
        ("r19_e3_toml_ml_sq_word_ok.toml", "s = '''\nhello\n", "s = '''\nhello\nworld\n", true),
        ("r19_e3_toml_arr_ml_dq_ok.toml", "arr = [\n  \"\"\"\nhello\n", "arr = [\n  \"\"\"\nhello\nworld\n", true),
        ("r19_e3_toml_ml_dq_bad_close.toml", "s = \"\"\"\nhello\n", "s = \"\"\"\nhello\n\"\"\" bad\n", false),
        ("r19_e3_toml_ml_dq_bad_esc.toml", "s = \"\"\"\nhello\n", "s = \"\"\"\nhello\n\\q\n", false),
        ("r19_e3_toml_ml_sq_bad_close.toml", "s = '''\nhello\n", "s = '''\nhello\n''' bad\n", false),
        ("r19_e3_toml_5lvl_ok.toml", "arr = [\n  [\n    [\n      [\n        [\n          1,\n", "arr = [\n  [\n    [\n      [\n        [\n          1,\n          2,\n", true),
        ("r19_e3_toml_brok_sib1_ok.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  2,\n", true),
        ("r19_e3_toml_brok_sib2_ok.toml", "arr = [\n  1,\n  2,\n  bad =\n", "arr = [\n  1,\n  2,\n  3,\n  bad =\n", true),
        ("r19_e3_toml_brok_sib1_bad_nocomma.toml", "arr = [\n  { bad = },\n  1\n", "arr = [\n  { bad = },\n  1\n  2,\n", false),
        ("r19_e3_toml_brok_sib2_bad_nocomma.toml", "arr = [\n  1,\n  2,\n  bad =\n", "arr = [\n  1,\n  2,\n  3\n  bad =\n", false),
        ("r19_e3_toml_brok_sib1_bad_kv.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  k = 1,\n", false),
        ("r19_e3_toml_brok_sib1_bad_obj.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  { k = 110\n", false),
        ("r19_e3_toml_brok_sib1_bad_rbrack.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  ]\n", false),
    ] {
        chk(LanguageId::Toml, name, base, cand, exp);
    }

    assert!(failures.is_empty(), "regression_w2_m2b_r19_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r20_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp {
            failures.push(format!("{name}: exp={exp} got={v:?}"));
        }
    };

    // Issue 1 (reviewer_1 F1) + Issue 2 (challenger_1 Cluster B) + Issue 3 (reviewer_2 F3 & Cluster C) + Issue 4 (Cluster A)
    for (lang, suf) in [(LanguageId::TypeScript, ".ts"), (LanguageId::Tsx, ".tsx")] {
        for (tag, base, body, exp) in [
            // Issue 1: switch / case / default / lbl: return / throw <T = { & negative controls
            ("r20_i1_case_ret_ok", "switch (x) {\n  case 1: return <T = {\n", "    readonly b: string;\n", true),
            ("r20_i1_default_ret_ok", "switch (x) {\n  default: return <T = {\n", "    readonly b: string;\n", true),
            ("r20_i1_case_throw_ok", "switch (x) {\n  case 1: throw <T = {\n", "    readonly b: string;\n", true),
            ("r20_i1_lbl_ret_ok", "lbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r20_i1_lbl_throw_ok", "lbl: throw <T = {\n", "  readonly b: string;\n", true),
            ("r20_i1_case_ml_ret_ok", "switch (x) {\n  case 1:\n  return <T = {\n", "    readonly b: string;\n", true),
            ("r20_i1_asi_lbl_ret_ok", "let x = 1\nlbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r20_i1_else_ret_ok", "if (x) a < b\nelse return <T = {\n", "  readonly b: string;\n", true),
            ("r20_i1_if_ret_ok", "if (cond) return <T = {\n", "  readonly b: string;\n", true),
            ("r20_i1_case_tern_ret_ok", "switch (x) {\n  case a ? b : c: return <T = {\n", "    readonly b: string;\n", true),
            ("r20_i1_type_ret_bad", "type X = return<T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_const_ret_bad", "const x = return <T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_cls_v_ret_bad", "class K { v = return<T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_cls_a_ret_bad", "class C { a: return<T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_tern_ret_bad", "const x = a ? b : return <T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_bare_tern_ret_bad", "a ? b : return <T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_paren_a_ret_bad", "foo(a: return<T = {\n", "  readonly b: string;\n", false),
            ("r20_i1_obj_a_ret_bad", "const o = {\n  a: return <T = {\n", "    readonly b: string;\n", false),
            // Issue 2: challenger_1 Cluster B (nested < inside uninitialized decl generics)
            ("r20_i2_fn_nested_bad", "function foo<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_exp_fn_nested_bad", "export function foo<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_cls_nested_bad", "class C<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_type_nested_bad", "type X<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_iface_nested_bad", "interface I<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_exp_def_cls_nested_bad", "export default class C<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_abs_cls_nested_bad", "abstract class C<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_decl_fn_nested_bad", "declare function foo<T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r20_i2_cls_m_nested_bad", "class C {\n  foo<T, Foo<U, {\n", "    readonly b: string;\n", false),
            ("r20_i2_iface_m_nested_bad", "interface I {\n  foo<T, Foo<U, {\n", "    readonly b: string;\n", false),
            ("r20_i2_call_eq_nested_ok", "foo<T = A<B, {\n", "  readonly b: string;\n", true),
            ("r20_i2_fn_eq_nested_ok", "function foo<T = A<B, {\n", "  readonly b: string;\n", true),
            ("r20_i2_fn_ext_nested_ok", "function foo<T extends A<B, {\n", "  readonly b: string;\n", true),
            ("r20_i2_call_double_nested_ok", "foo<T = Foo<U, {\n", "  readonly b: string;\n", true),
            ("r20_i2_const_call_nested_ok", "const x = foo<A<B, {\n", "  readonly b: string;\n", true),
            ("r20_i2_cls_m_eq_nested_ok", "class C {\n  foo<T = Foo<U, {\n", "    readonly b: string;\n", true),
            ("r20_i2_fn_u_eq_nested_ok", "function foo<T, U = Foo<V, {\n", "  readonly b: string;\n", true),
            ("r20_i2_call_inner_v_eq_bad", "foo<T = Foo<U, V = {\n", "  readonly b: string;\n", false),
            // Issue 3: reviewer_2 F3 + Cluster C (kw+ident in members + multiline ASI <T)
            ("r20_i3_iface_type_foo_bad", "interface I {\n  type foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_iface_fn_foo_bad", "interface I {\n  function foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_iface_cls_foo_bad", "interface I {\n  class foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_cls_decl_foo_bad", "class C {\n  declare foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_cls_fn_foo_bad", "class C {\n  function foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_cls_cls_foo_bad", "class C {\n  class foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_cls_iface_foo_bad", "class C {\n  interface foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_obj_fn_foo_bad", "const o = {\n  function foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_obj_type_foo_bad", "const o = {\n  type foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_obj_cls_foo_bad", "const o = {\n  class foo<T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_cls_fn_star_bad", "class C {\n  function* <T = {\n", "    readonly b: string;\n", false),
            ("r20_i3_ml_asi_type_bad", "type A = number\n<T\n  = {\n", "  readonly b: string;\n", false),
            ("r20_i3_ml_asi_comma_bad", "type A = number\n<T,\n  U = {\n", "  readonly b: string;\n", false),
            ("r20_i3_ml_asi_cmp_bad", "const x = a < b\n<T\n  = {\n", "  readonly b: string;\n", false),
            ("r20_i3_cls_declare_m_ok", "class C {\n  declare<T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_cls_type_m_ok", "class C {\n  type<T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_cls_type_colon_ok", "class C {\n  type: <T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_obj_fn_expr_ok", "const o = {\n  x: function foo<T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_ml_cmp_tern_ok", "const x = a\n  < b\n  ? {\n", "    a: 1,\n", true),
            ("r20_i3_ml_cmp_comma_ok", "const x = a\n  < b,\n  c = {\n", "    a: 1,\n", true),
            ("r20_i3_ml_cmp_fn_foo_ok", "const x = a < b\n  function foo<T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_ml_cmp_cls_foo_ok", "class C {\n  x = a < b\n  foo<T = {\n", "    readonly b: string;\n", true),
            ("r20_i3_ml_if_cond_ok", "if (cond)\n<T\n  = {\n", "  readonly b: string;\n", true),
            // Issue 4: challenger_1 Cluster A (closed string/template/regex before ASI / member <T = {)
            ("r20_i4_cls_str_asi_val_bad", "class C {\n  x = \"a\"\n  <T = {\n", "    a: 1,\n", false),
            ("r20_i4_cls_str_asi_ro_bad", "class C {\n  x = \"a\"\n  <T = {\n", "    readonly b: string;\n", false),
            ("r20_i4_cls_sq_asi_bad", "class C {\n  x = 'a'\n  <T = {\n", "    readonly b: string;\n", false),
            ("r20_i4_cls_bt_asi_bad", "class C {\n  x = `a`\n  <T = {\n", "    readonly b: string;\n", false),
            ("r20_i4_top_str_asi_bad", "const x = \"a\"\n<T = {\n", "  readonly b: string;\n", false),
            ("r20_i4_top_ml_bt_asi_bad", "const x = `a\nb`\n<T = {\n", "  readonly b: string;\n", false),
            ("r20_i4_top_interp_bt_asi_bad", "const x = `a${1}`\n<T = {\n", "  readonly b: string;\n", false),
            ("r20_i4_top_regex_asi_bad", "const x = /a/\n<T = {\n", "  readonly b: string;\n", false),
            ("r20_i4_fn_quoted_lt_bad", "function f() {\n  \"m\" <T = {\n", "    readonly b: string;\n", false),
            ("r20_i4_cls_quoted_lt_bad", "class C {\n  \"x\" <{\n", "    a: 1,\n", false),
            ("r20_i4_obj_quoted_lt_bad", "const o = {\n  \"x\" <{\n", "    a: 1,\n", false),
            ("r20_i4_cls_bt_method_bad", "class C {\n  `a`<T = {\n", "    readonly b: string;\n", false),
            ("r20_i4_cls_str_foo_ok", "class C {\n  x = \"a\"\n  foo <T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_bt_foo_ok", "class C {\n  x = `a\nb`\n  foo <T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_foo_ok", "class C {\n  foo<T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_num_ok", "class C {\n  1<T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_quoted_m_ok", "class C {\n  \"m\" <T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_quoted_mym_ok", "class C {\n  \"my-m\" <T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_cls_dec_quoted_cmt_ok", "class C {\n  @dec(1) \"my-m\" /* c */ <T = {\n", "    readonly b: string;\n", true),
            ("r20_i4_top_str_fn_ok", "const x = \"a\"\nfunction foo<T = {\n", "  readonly b: string;\n", true),
            ("r20_i4_top_str_tern_ok", "const x = \"a\" ?\n<T = {\n", "  readonly b: string;\n", true),
        ] {
            let cand = format!("{base}{body}");
            chk(lang, &format!("{tag}{suf}"), base, &cand, exp);
        }
    }

    // Explorer 2 Issue 2: JavaScript invalid/valid headers (Cluster D + reviewer_1 F2 + reviewer_2 F1)
    for (name, base, cand, exp) in [
        ("r20_js_cls_interface_m_ok.js", "class C {\n  interface() {\n", "class C {\n  interface() {\n    return 1;\n", true),
        ("r20_js_obj_interface_m_ok.js", "const o = {\n  interface() {\n", "const o = {\n  interface() {\n    return 1;\n", true),
        ("r20_js_obj_comma_interface_m_ok.js", "const o = {\n  a: 1, interface() {\n", "const o = {\n  a: 1, interface() {\n    return 1;\n", true),
        ("r20_js_obj_interface_prop_ok.js", "const o = {\n  interface: {\n", "const o = {\n  interface: {\n    a: 1,\n", true),
        ("r20_js_obj_ns_prop_ok.js", "const o = {\n  namespace: {\n", "const o = {\n  namespace: {\n    a: 1,\n", true),
        ("r20_js_obj_ns_m_ok.js", "const o = {\n  namespace() {\n", "const o = {\n  namespace() {\n    return 1;\n", true),
        ("r20_js_obj_mod_prop_ok.js", "const o = {\n  module: {\n", "const o = {\n  module: {\n    a: 1,\n", true),
        ("r20_js_obj_abs_m_ok.js", "const o = {\n  abstract() {\n", "const o = {\n  abstract() {\n    return 1;\n", true),
        ("r20_js_cls_abs_m_ok.js", "class C {\n  abstract() {\n", "class C {\n  abstract() {\n    return 1;\n", true),
        ("r20_js_cls_decl_m_ok.js", "class C {\n  declare() {\n", "class C {\n  declare() {\n    return 1;\n", true),
        ("r20_js_declare_asi_ok.js", "function f() {\n  declare\n  const x = 1;\n", "function f() {\n  declare\n  const x = 1;\n  return x;\n", true),
        ("r20_js_top_iface_bad.js", "interface I {\n", "interface I {\n  a: 1;\n", false),
        ("r20_js_exp_iface_bad.js", "export interface I {\n", "export interface I {\n  a: 1;\n", false),
        ("r20_js_exp_def_iface_bad.js", "export default interface I {\n", "export default interface I {\n  a: 1;\n", false),
        ("r20_js_top_ns_bad.js", "namespace N {\n", "namespace N {\n  const x = 1;\n", false),
        ("r20_js_top_mod_bad.js", "module M {\n", "module M {\n  const x = 1;\n", false),
        ("r20_js_cls_static_ns_bad.js", "class C {\n  static {\n    namespace N {\n", "class C {\n  static {\n    namespace N {\n      const x = 1;\n", false),
        ("r20_js_decl_ns_bad.js", "declare namespace N {\n", "declare namespace N {\n  const x = 1;\n", false),
        ("r20_js_decl_mod_bad.js", "declare module \"foo\" {\n", "declare module \"foo\" {\n  const x = 1;\n", false),
        ("r20_js_abs_cls_bad.js", "abstract class C {\n", "abstract class C {\n  m() {}\n", false),
    ] {
        chk(LanguageId::JavaScript, name, base, cand, exp);
    }

    // Explorer 2 Issue 3: TSX tsx_no_semi / JSX open (reviewer_2 F2 + Cluster D)
    for (name, base, cand, exp) in [
        ("r20_tsx_if_div_ok.tsx", "if (cond)\n  <div>\n", "if (cond)\n  <div>\n    <span>ok</span>\n", true),
        ("r20_tsx_while_div_ok.tsx", "while (cond)\n  <div>\n", "while (cond)\n  <div>\n    <span>ok</span>\n", true),
        ("r20_tsx_for_div_ok.tsx", "for (const x of xs)\n  <div>\n", "for (const x of xs)\n  <div>\n    <span>ok</span>\n", true),
        ("r20_tsx_for_await_div_ok.tsx", "for await (const x of xs)\n  <div>\n", "for await (const x of xs)\n  <div>\n    <span>ok</span>\n", true),
        ("r20_tsx_top_tern_div_ok.tsx", "const x = flag ?\n<div>\n", "const x = flag ?\n<div>\n  <span>ok</span>\n", true),
        ("r20_tsx_fn_tern_div_ok.tsx", "function f() {\n  const x = flag ?\n  <div>\n", "function f() {\n  const x = flag ?\n  <div>\n    <span>ok</span>\n", true),
        ("r20_tsx_fn_cmt_nosemi_bad.tsx", "function f() {\n  const x = 1\n  // cmt\n  <div>\n", "function f() {\n  const x = 1\n  // cmt\n  <div>\n    <span>ok</span>\n", false),
        ("r20_tsx_top_nosemi_bad.tsx", "const x = 1\n<div>\n", "const x = 1\n<div>\n  <span>ok</span>\n</div>\n", false),
        ("r20_tsx_fn_ml_tag_nosemi_bad.tsx", "function f() {\n  const x = 1\n  <div\n    className=\"a\">\n", "function f() {\n  const x = 1\n  <div\n    className=\"a\">\n    <span>ok</span>\n", false),
        ("r20_tsx_fn_ml_tag_nosemi_ok_bad.tsx", "function f() {\n  const x = 1\n  <div\n    className=\"a\">\n", "function f() {\n  const x = 1\n  <div\n    className=\"a\">\n    ok\n", false),
    ] {
        chk(LanguageId::Tsx, name, base, cand, exp);
    }

    // Explorer 3 C1: Ruby elsif ( & inner ) closure
    let rb_elsif_b = "if a0\n  1\nelsif (\n  a &&\n  c\n)\n  broken =\nend\n";
    chk(LanguageId::Ruby, "r20_rb_elsif_ok.rb", rb_elsif_b, "if a0\n  1\nelsif (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", true);
    chk(LanguageId::Ruby, "r20_rb_elsif_rparen_bad.rb", rb_elsif_b, "if a0\n  1\nelsif (\n  a &&\n  b)\n  c\n)\n  broken =\nend\n", false);
    chk(LanguageId::Ruby, "r20_rb_elsif_rp_lp_bad.rb", rb_elsif_b, "if a0\n  1\nelsif (\n  a &&\n  b) (\n  c\n)\n  broken =\nend\n", false);
    let rb_elsif_ind = "def f\n  if a0\n    1\n  elsif (\n    a &&\n    c\n  )\n    broken =\n  end\nend\n";
    chk(LanguageId::Ruby, "r20_rb_elsif_ind_ok.rb", rb_elsif_ind, "def f\n  if a0\n    1\n  elsif (\n    a &&\n    b &&\n    c\n  )\n    broken =\n  end\nend\n", true);
    chk(LanguageId::Ruby, "r20_rb_elsif_ind_rp_bad.rb", rb_elsif_ind, "def f\n  if a0\n    1\n  elsif (\n    a &&\n    b)\n    c\n  )\n    broken =\n  end\nend\n", false);
    chk(LanguageId::Ruby, "r20_rb_elsif_pfx_err_ok.rb", &format!("z =\n{rb_elsif_b}"), "z =\nif a0\n  1\nelsif (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", true);
    chk(LanguageId::Ruby, "r20_rb_inner_rparen_ok.rb", "if (\n  a && (\n    x +\n  c\n)\n  broken =\nend\n", "if (\n  a && (\n    x +\n    y)\n  c\n)\n  broken =\nend\n", true);

    // Explorer 3 C2 + F3: TOML multiline strings in arrays & broken-sibling arrays
    for (name, base, cand, exp) in [
        ("r20_toml_arr_ml_dq_close_ok.toml", "arr = [\n  \"\"\"\nhello\n]\n", "arr = [\n  \"\"\"\nhello\n  \"\"\",\n]\n", true),
        ("r20_toml_pfx_brok_arr_ml_dq_ok.toml", "broken =\narr = [\n  \"\"\"\n  hello\n]\n", "broken =\narr = [\n  \"\"\"\n  hello\n  \"\"\"\n]\n", true),
        ("r20_toml_arr_ml_sq_close_ok.toml", "arr = [\n  '''\n  hello\n]\n", "arr = [\n  '''\n  hello\n  '''\n]\n", true),
        ("r20_toml_brok_sib_ml_dq_ok.toml", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n]\n", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n  \"\"\",\n]\n", true),
        ("r20_toml_brok_sib_ml_dq_bad_trail.toml", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n]\n", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n  \"\"\" bad\n]\n", false),
        ("r20_toml_brok_sib_ml_dq_bad_esc.toml", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n]\n", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n  \\q\n  \"\"\"\n]\n", false),
        ("r20_toml_brok_sib_nested_arr_ok.toml", "arr = [\n  { bad = },\n  [1],\n", "arr = [\n  { bad = },\n  [1],\n  [2, 3],\n", true),
        ("r20_toml_brok_sib_rbrack_str_ok.toml", "arr = [\n  { bad = },\n  \"a\",\n", "arr = [\n  { bad = },\n  \"a\",\n  \"x]y\",\n", true),
        ("r20_toml_brok_sib_foo_rbrack_bad.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  foo]\n", false),
        ("r20_toml_brok_sib1_bad_rbrack_keep.toml", "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  ]\n", false),
    ] {
        chk(LanguageId::Toml, name, base, cand, exp);
    }

    // Explorer 3 C3: XML sibling inside <list> containing <bad> + preserved controls
    let xml_bad_sib = "<list>\n  <bad>\n  <a>1</a>\n</list>\n";
    for (name, base, cand, exp) in [
        ("r20_xml_bad_sib_ok.xml", xml_bad_sib, "<list>\n  <bad>\n  <a>1</a>\n  <b>2</b>\n</list>\n", true),
        ("r20_xml_bad_sib_unclosed_bad.xml", xml_bad_sib, "<list>\n  <bad>\n  <a>1</a>\n  <bad2>\n</list>\n", false),
        ("r20_xml_bad_sib_mismatch_bad.xml", xml_bad_sib, "<list>\n  <bad>\n  <a>1</a>\n  <b>2</B>\n</list>\n", false),
        ("r20_xml_bad_two_roots_keep.xml", "<broken>\n<a>1</a>\n", "<broken>\n<a>1</a>\n<b>2</b>\n", false),
        ("r20_xml_bad_unclosed_pfx_two_roots.xml", "<broken\n<a>1</a>\n", "<broken\n<a>1</a>\n<b>2</b>\n", false),
        ("r20_xml_self_closed_two_roots.xml", "<br/>\n<a>1</a>\n", "<br/>\n<a>1</a>\n<b>2</b>\n", false),
    ] {
        chk(LanguageId::Xml, name, base, cand, exp);
    }

    assert!(failures.is_empty(), "regression_w2_m2b_r20_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r21_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp {
            failures.push(format!("{name}: exp={exp} got={v:?}"));
        }
    };

    // Explorer 1: C1 (type F = <T, Foo<U, { & async <T, Foo<U, { & TSX const f = <T, Foo<U, {),
    // C3 (interface I { <T = { & type T = { <U = {), F2/F3 (a.do & ctrl lbl: return <T = {), F1/C2 (regex & [foo() < "a", {)
    for (lang, suf) in [(LanguageId::TypeScript, ".ts"), (LanguageId::Tsx, ".tsx")] {
        for (tag, base, body, exp) in [
            ("r21_c1_type_arrow_2p_bad", "type F = <T, Foo<U, {\n", "  readonly b: string;\n", false),
            ("r21_c1_type_anon_bad", "type F = <{\n", "  a: number;\n", false),
            ("r21_c1_type_t_anon_bad", "type F = <T, {\n", "  a: number;\n", false),
            ("r21_c1_const_async_bad", "const f = async <T, Foo<U, {\n", "  a: number;\n", false),
            ("r21_c1_exp_const_async_bad", "export const f = async <T, Foo<U, {\n", "  a: number;\n", false),
            ("r21_c1_let_async_bad", "let f = async <T, Foo<U, {\n", "  a: number;\n", false),
            ("r21_c1_arrow_async_bad", "const f = (x: number) => async <T, Foo<U, {\n", "  a: number;\n", false),
            ("r21_c1_exp_def_async_bad", "export default async <T, Foo<U, {\n", "  a: number;\n", false),
            ("r21_c1_async_anon_bad", "const f = async <{\n", "  a: number;\n", false),
            ("r21_c1_ret_async_bad", "function g() {\n  return async <T, Foo<U, {\n", "    a: number;\n", false),
            ("r21_c1_def_ok", "const f = <T = Foo<U, {\n", "  readonly b: string;\n", true),
            ("r21_c1_async_def_ok", "const f = async <T = Foo<U, {\n", "  readonly b: string;\n", true),
            ("r21_c1_type_def_ok", "type F = <T, U = Foo<V, {\n", "  readonly b: string;\n", true),
            ("r21_c1_callee_ok", "foo<T, Foo<U, {\n", "  readonly b: string;\n", true),
            ("r21_c1_const_callee_ok", "const f = foo<T, Foo<U, {\n", "  readonly b: string;\n", true),
            ("r21_c1_type_fn_def_ok", "type F = () => <T = Foo<U, {\n", "  readonly b: string;\n", true),
            ("r21_c1_ret_async_ok", "function g() {\n  return async <T = Foo<U, {\n", "    readonly b: string;\n", true),
            ("r21_c3_iface_prop_ok", "interface I {\n  x: number;\n  <T = {\n", "    readonly a: number;\n", true),
            ("r21_c3_iface_asi_ok", "interface I {\n  x: number\n  <T = {\n", "    readonly a: number;\n", true),
            ("r21_c3_iface_ml_ok", "interface I {\n  x: number;\n  <T\n    = {\n", "      readonly a: number;\n", true),
            ("r21_c3_iface_bare_ok", "interface I {\n  <T = {\n", "    readonly a: number;\n", true),
            ("r21_c3_type_bare_ok", "type T = {\n  <U = {\n", "    readonly a: number;\n", true),
            ("r21_c3_class_bad", "class C {\n  <T = {\n", "    readonly a: number;\n", false),
            ("r21_f2_a_do_bad", "a.do return <T = {\n", "  readonly b: string;\n", false),
            ("r21_f2_do_ok", "do return <T = {\n", "  readonly b: string;\n", true),
            ("r21_f3_if_lbl_ok", "if (cond) lbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r21_f3_else_lbl_ok", "if (c) x(); else lbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r21_f3_do_lbl_ok", "do lbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r21_f3_for_lbl_ok", "for (;;) lbl: return <T = {\n", "  readonly b: string;\n", true),
            ("r21_f3_tern_bad", "a ? b : return <T = {\n", "  readonly b: string;\n", false),
            ("r21_f3_if_tern_bad", "if (cond) a ? b : return <T = {\n", "  readonly b: string;\n", false),
            ("r21_f3_sw_tern_bad", "switch (x) { case 1: a ? b : return <T = {\n", "  readonly b: string;\n", false),
            ("r21_f1_regex_lt_bad", "foo</a/, {\n", "  readonly b: string;\n", false),
            ("r21_f1_regex_asi_bad", "x = /foo/gi\n<T = {\n", "  readonly b: string;\n", false),
            ("r21_c2_dq_val_ok", "const x = [foo() < \"a\", {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_dq_ro_bad", "const x = [foo() < \"a\", {\n", "  readonly b: number;\n", false),
            ("r21_c2_sq_val_ok", "const x = [foo() < 'a', {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_sq_ro_bad", "const x = [foo() < 'a', {\n", "  readonly b: number;\n", false),
            ("r21_c2_bt_val_ok", "const x = [foo() < `a`, {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_bt_ro_bad", "const x = [foo() < `a`, {\n", "  readonly b: number;\n", false),
            ("r21_c2_rx_val_ok", "const x = [foo() < /a/, {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_rx_ro_bad", "const x = [foo() < /a/, {\n", "  readonly b: number;\n", false),
            ("r21_c2_idx_val_ok", "const x = [a[0] < \"a\", {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_idx_ro_bad", "const x = [a[0] < \"a\", {\n", "  readonly b: number;\n", false),
            ("r21_c2_obj_val_ok", "const o = { k: [foo() < \"a\", {\n", "  k: 1 + 2,\n", true),
            ("r21_c2_obj_ro_bad", "const o = { k: [foo() < \"a\", {\n", "  readonly b: number;\n", false),
            ("r21_c2_ctrl_att_str_ok", "foo<\"a\", {\n", "  readonly b: string;\n", true),
            ("r21_c2_ctrl_att_bt_ok", "foo<`a`, {\n", "  readonly b: string;\n", true),
            ("r21_c2_ctrl_att_paren_ok", "foo(a)<\"a\", {\n", "  readonly b: string;\n", true),
            ("r21_c2_ctrl_obj_callee_ok", "const o = {\n  x: foo(x) <{\n", "    a: 1 + 2,\n", true),
            ("r21_r2f3_iface_type_bar_bad", "interface I {\n  foo: type bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_iface_fn_bar_bad", "interface I {\n  foo: function bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_iface_fn_bare_bad", "interface I {\n  foo: function<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_iface_cls_bar_bad", "interface I {\n  foo: class bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_cls_type_bar_bad", "class C {\n  foo: type bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_cls_fn_bar_bad", "class C {\n  foo: function bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_obj_type_bar_bad", "const o = {\n  foo: type bar<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_obj_abs_cls_bad", "const o = {\n  x: abstract class Foo<T = {\n", "    a: number;\n", false),
            ("r21_r2f3_obj_new_bad", "const o = {\n  foo: new <T = {\n", "    a: number;\n", false),
            ("r21_r2f3_obj_fn_ok", "const o = {\n  x: function foo<T = {\n", "    a: number;\n", true),
            ("r21_r2f3_obj_cls_ok", "const o = {\n  x: class Foo<T = {\n", "    a: number;\n", true),
            ("r21_r2f3_iface_new_ok", "interface I {\n  foo: new <T = {\n", "    a: number;\n", true),
            ("r21_r2f3_iface_type_ok", "interface I {\n  foo: type<{\n", "    a: number;\n", true),
            ("r21_r2f3_cls_eq_cls_ok", "class C {\n  foo = class Bar<T = {\n", "    a: number;\n", true),
        ] {
            chk(lang, &format!("{tag}{suf}"), base, &format!("{base}{body}"), exp);
        }
    }
    chk(LanguageId::Tsx, "r21_c1_tsx_const_f_bad.tsx", "const f = <T, Foo<U, {\n", "const f = <T, Foo<U, {\n  a: number;\n", false);
    chk(LanguageId::TypeScript, "r21_c1_ts_const_f_cast_ok.ts", "const f = <T, Foo<U, {\n", "const f = <T, Foo<U, {\n  readonly b: string;\n", true);

    // Explorer 2 Issue 3: JS declare Cluster 4
    for (name, base, cand, exp) in [
        ("r21_c4_decl_const_col.js", "declare const o: {\n", "declare const o: {\n  a: number;\n", false),
        ("r21_c4_decl_let_col.js", "declare let o: {\n", "declare let o: {\n  a: number;\n", false),
        ("r21_c4_decl_var_col.js", "declare var o: {\n", "declare var o: {\n  a: number;\n", false),
        ("r21_c4_exp_decl_const.js", "export declare const o: {\n", "export declare const o: {\n  a: number;\n", false),
        ("r21_c4_decl_const_eq.js", "declare const o = {\n", "declare const o = {\n  a: 1,\n", false),
        ("r21_c4_decl_async_fn.js", "declare async function f() {\n", "declare async function f() {\n  return 1;\n", false),
        ("r21_c4_exp_decl_async.js", "export declare async function f() {\n", "export declare async function f() {\n  return 1;\n", false),
        ("r21_c4_cls_decl_col.js", "class C {\n  declare x: {\n", "class C {\n  declare x: {\n    a: number;\n", false),
        ("r21_c4_cls_static_decl.js", "class C {\n  static declare x: {\n", "class C {\n  static declare x: {\n    a: number;\n", false),
        ("r21_c4_obj_decl_ok.js", "const o = {\n  declare: {\n", "const o = {\n  declare: {\n    a: 1,\n", true),
        ("r21_c4_fn_decl_ok.js", "function declare() {\n", "function declare() {\n  return 1;\n", true),
        ("r21_c4_cls_decl_m_ok.js", "class C {\n  declare() {\n", "class C {\n  declare() {\n    return 1;\n", true),
        ("r21_c4_asi_decl_ok.js", "declare\nconst x = {\n", "declare\nconst x = {\n  a: 1,\n", true),
    ] {
        chk(LanguageId::JavaScript, name, base, cand, exp);
    }

    // Explorer 2 Issue 4: TSX trailing } before <div>
    for (name, pre, in_fn, exp) in [
        ("r21_tsx_obj_1l_bad", "const o = { a: 1 }", true, false),
        ("r21_tsx_obj_ml_bad", "const o = {\n  a: 1\n}", true, false),
        ("r21_tsx_arr_1l_bad", "const g = () => {}", true, false),
        ("r21_tsx_arr_ml_bad", "const g = () => {\n  return 1;\n}", true, false),
        ("r21_tsx_let_bad", "let o = { a: 1 }", true, false),
        ("r21_tsx_assign_bad", "x = { a: 1 }", true, false),
        ("r21_tsx_ret_bad", "return { a: 1 }", true, false),
        ("r21_tsx_type_bad", "type T = { a: number }", false, false),
        ("r21_tsx_cls_expr_bad", "const C = class {\n  x = 1;\n}", true, false),
        ("r21_tsx_exp_def_bad", "export default { a: 1 }", false, false),
        ("r21_tsx_if_ok", "if (c) {}", true, true),
        ("r21_tsx_fn_ok", "function g() {}", true, true),
        ("r21_tsx_blk_ok", "{ /* c */ }", true, true),
        ("r21_tsx_iface_ok", "interface I { a: number }", false, true),
        ("r21_tsx_else_ok", "if (c) {} else { b(); }", true, true),
        ("r21_tsx_call_blk_ok", "foo()\n{\n  a();\n}", true, true),
    ] {
        chk(LanguageId::Tsx, &format!("{name}_top.tsx"), &format!("{pre}\n<div>\n"), &format!("{pre}\n<div>\n  <span>ok</span>\n</div>\n"), exp);
        if in_fn {
            chk(LanguageId::Tsx, &format!("{name}_fn.tsx"), &format!("function outer() {{\n  {pre}\n  <div>\n"), &format!("function outer() {{\n  {pre}\n  <div>\n    <span>ok</span>\n"), exp);
        }
    }

    // Explorer 3: Ruby/Python pure deletions inside (, TOML F5/C2/C3, XML F1
    for (name, lang, base, cand, exp) in [
        ("r21_rb_del_elsif_ok.rb", LanguageId::Ruby, "if x\n  1\nelsif (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "if x\n  1\nelsif (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_rb_del_if_ok.rb", LanguageId::Ruby, "if (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "if (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_rb_del_while_ok.rb", LanguageId::Ruby, "while (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "while (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_rb_del_unless_ok.rb", LanguageId::Ruby, "unless (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "unless (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_rb_del_until_ok.rb", LanguageId::Ruby, "until (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "until (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_rb_del_assign_if_ok.rb", LanguageId::Ruby, "y = if (\n  a &&\n  b &&\n  c\n)\n  broken =\nend\n", "y = if (\n  a &&\n  c\n)\n  broken =\nend\n", true),
        ("r21_py_del_if_ok.py", LanguageId::Python, "if (\n  a and\n  b and\n  c\n):\n  broken =\n", "if (\n  a and\n  c\n):\n  broken =\n", true),
        ("r21_py_del_elif_ok.py", LanguageId::Python, "if x:\n  pass\nelif (\n  a and\n  b and\n  c\n):\n  broken =\n", "if x:\n  pass\nelif (\n  a and\n  c\n):\n  broken =\n", true),
        ("r21_rb_del_last_op_bad.rb", LanguageId::Ruby, "if (\n  a &&\n  c\n)\n  broken =\nend\n", "if (\n  a &&\n)\n  broken =\nend\n", false),
        ("r21_py_del_last_op_bad.py", LanguageId::Python, "if (\n  a and\n  c\n):\n  broken =\n", "if (\n  a and\n):\n  broken =\n", false),
        ("r21_toml_f5_steal_bad.toml", LanguageId::Toml, "arr = [\n  \"\"\"\n  hello\n]\n", "arr = [\n  \"\"\"\n  hello\n  \"\"\",\n  [\n]\n", false),
        ("r21_toml_f5_brok_bad.toml", LanguageId::Toml, "arr = [\n  { bad = },\n  \"\"\"\n  hello\n]\n", "arr = [\n  { bad = },\n  \"\"\"\n  hello\n  \"\"\",\n  [\n]\n", false),
        ("r21_toml_c2_dq_ins_ok.toml", LanguageId::Toml, "t = { bad = , arr = [\n  \"\"\"\nhello\n] }\n", "t = { bad = , arr = [\n  \"\"\"\nhello\nworld\n] }\n", true),
        ("r21_toml_c2_dq_cls_ok.toml", LanguageId::Toml, "t = { bad = , arr = [\n  \"\"\"\nhello\n] }\n", "t = { bad = , arr = [\n  \"\"\"\nhello\n  \"\"\"\n] }\n", true),
        ("r21_toml_c2_sq_ins_ok.toml", LanguageId::Toml, "t = { bad = , arr = [\n  '''\nhello\n] }\n", "t = { bad = , arr = [\n  '''\nhello\nworld\n] }\n", true),
        ("r21_toml_c2_sq_cls_ok.toml", LanguageId::Toml, "t = { bad = , arr = [\n  '''\nhello\n] }\n", "t = { bad = , arr = [\n  '''\nhello\n  '''\n] }\n", true),
        ("r21_toml_c3_brok_sib_bad.toml", LanguageId::Toml, "arr = [\n  { bad = },\n  1,\n", "arr = [\n  { bad = },\n  1,\n  ]\n", false),
        ("r21_xml_f1_eof_two_roots_bad.xml", LanguageId::Xml, "<list>\n  <bad>\n  <a>1</a>\n</list>\n", "<list>\n  <bad>\n  <a>1</a>\n</list>\n<extra/>\n", false),
        ("r21_xml_f1_mid_two_roots_bad.xml", LanguageId::Xml, "<list>\n  <bad>\n  <a>1</a>\n</list>\n<!-- tail -->\n", "<list>\n  <bad>\n  <a>1</a>\n</list>\n<extra/>\n<!-- tail -->\n", false),
        ("r21_xml_f1_cmt_ok.xml", LanguageId::Xml, "<list>\n  <bad>\n  <a>1</a>\n</list>\n", "<list>\n  <bad>\n  <a>1</a>\n</list>\n<!-- cmt -->\n", true),
        ("r21_xml_f1_sib_ok.xml", LanguageId::Xml, "<list>\n  <bad>\n  <a>1</a>\n</list>\n", "<list>\n  <bad>\n  <a>1</a>\n  <b>2</b>\n</list>\n", true),
    ] {
        chk(lang, name, base, cand, exp);
    }

    assert!(failures.is_empty(), "regression_w2_m2b_r21_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r22_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let v = fw.verify_incremental(Some(base), cand, Path::new(name), lang);
        if v.is_valid() != exp {
            failures.push(format!("{name}: exp={exp} got={v:?}"));
        }
    };

    // Explorer 1: TS/TSX type-position keywords, [abstract] new<T = {, call vs generic in expr list, Cluster D
    for (lang, suf) in [(LanguageId::TypeScript, ".ts"), (LanguageId::Tsx, ".tsx")] {
        for (tag, base, body, exp) in [
            ("r22_f1_iface_async_bad", "interface I {\n  foo: async <T = {\n", "    a: number;\n", false),
            ("r22_f1_type_async_bad", "type F = async <T = {\n", "  a: number;\n", false),
            ("r22_f1_cls_async_bad", "class C {\n  foo: async <T = {\n", "    a: number;\n", false),
            ("r22_f1_typelit_async_bad", "type T = {\n  foo: async <T = {\n", "    a: number;\n", false),
            ("r22_f1_type_arrow_async_bad", "type F = () => async <T = {\n", "  a: number;\n", false),
            ("r22_f1_iface_type_t_eq_bad", "interface I {\n  foo: type <T = {\n", "    a: number;\n", false),
            ("r22_f1_type_fn_t_eq_bad", "type F = function <T = {\n", "  a: number;\n", false),
            ("r22_f1_type_cls_t_eq_bad", "type F = class <T = {\n", "  a: number;\n", false),
            ("r22_f1_type_abs_t_eq_bad", "type F = abstract <T = {\n", "  a: number;\n", false),
            ("r22_f1_type_typeof_bad", "type F = typeof <T = {\n", "  a: number;\n", false),
            ("r22_f1_obj_async_ok", "const o = {\n  foo: async <T = {\n", "    a: 1,\n", true),
            ("r22_f1_var_async_ok", "const f = async <T = Foo<U, {\n", "  a: number;\n", true),
            ("r22_f1_arrow_ret_async_ok", "const f = (x: number): Foo => async <T = {\n", "  a: number;\n", true),
            ("r22_c_iface_new_att_ok", "interface I {\n  foo: new<T = {\n", "    a: number;\n", true),
            ("r22_c_iface_opt_new_att_ok", "interface I {\n  foo?: new<T = {\n", "    a: number;\n", true),
            ("r22_c_cls_new_att_ok", "class C {\n  foo: new<T = {\n", "    a: number;\n", true),
            ("r22_c_iface_abs_new_sp_ok", "interface I {\n  foo: abstract new <T = {\n", "    a: number;\n", true),
            ("r22_c_iface_abs_new_att_ok", "interface I {\n  foo: abstract new<T = {\n", "    a: number;\n", true),
            ("r22_c_cls_abs_new_sp_ok", "class C {\n  foo: abstract new <T = {\n", "    a: number;\n", true),
            ("r22_c_cls_abs_new_att_ok", "class C {\n  foo: abstract new<T = {\n", "    a: number;\n", true),
            ("r22_c_type_new_sp_ok", "type F = new <T = {\n", "  a: number;\n", true),
            ("r22_c_type_new_att_ok", "type F = new<T = {\n", "  a: number;\n", true),
            ("r22_c_type_abs_new_sp_ok", "type F = abstract new <T = {\n", "  a: number;\n", true),
            ("r22_c_type_abs_new_att_ok", "type F = abstract new<T = {\n", "  a: number;\n", true),
            ("r22_c_type_union_new_ok", "type F = A | new <T = {\n", "  a: number;\n", true),
            ("r22_c_type_union_abs_new_ok", "type F = A | abstract new<T = {\n", "  a: number;\n", true),
            ("r22_c_iface_union_abs_new_ok", "interface I {\n  foo: A | abstract new <T = {\n", "    a: number;\n", true),
            ("r22_c_obj_new_att_bad", "const o = {\n  foo: new<T = {\n", "    a: number;\n", false),
            ("r22_c_cls_eq_new_att_bad", "class C {\n  foo = new<T = {\n", "    a: number;\n", false),
            ("r22_c_var_eq_new_bad", "const x = new <T = {\n", "  a: number;\n", false),
            ("r22_c_iface_new_comma_bad", "interface I {\n  foo: new<T, {\n", "    a: number;\n", false),
            ("r22_c_iface_ctor_abs_new_bad", "interface I {\n  abstract new <T = {\n", "    a: number;\n", false),
            ("r22_b_call_sp_mytype_ok", "foo() <MY_TYPE, {\n", "  readonly b: string;\n", true),
            ("r22_b_arr_call_att_dq_ro_bad", "const x = [foo()<\"a\", {\n", "  readonly b: number;\n", false),
            ("r22_b_arr_call_att_dq_kv_ok", "const x = [foo()<\"a\", {\n", "  k: 1 + 2,\n", true),
            ("r22_b_arr_idx_att_dq_ro_bad", "const x = [a[0]<\"a\", {\n", "  readonly b: number;\n", false),
            ("r22_b_arr_idx_att_dq_kv_ok", "const x = [a[0]<\"a\", {\n", "  k: 1 + 2,\n", true),
            ("r22_b_arr_call_att_bt_ro_bad", "const x = [foo()<`a`, {\n", "  readonly b: number;\n", false),
            ("r22_b_arr_call_att_bt_kv_ok", "const x = [foo()<`a`, {\n", "  k: 1 + 2,\n", true),
            ("r22_b_obj_arr_att_dq_ro_bad", "const o = {\n  k: [foo()<\"a\", {\n", "    readonly b: number;\n", false),
            ("r22_b_obj_arr_att_dq_kv_ok", "const o = {\n  k: [foo()<\"a\", {\n", "    k: 1 + 2,\n", true),
            ("r22_b_arr_call_interp_ro_bad", "const x = [foo()<`a${y}`, {\n", "  readonly b: number;\n", false),
            ("r22_b_arr_call_interp_kv_ok", "const x = [foo()<`a${y}`, {\n", "  k: 1 + 2,\n", true),
            ("r22_b_ctrl_att_paren_ok", "foo(a)<\"a\", {\n", "  readonly b: string;\n", true),
            ("r22_b_ctrl_regex_bad", "foo</a/, {\n", "  readonly b: string;\n", false),
            ("r22_b_ctrl_arr_sp_dq_bad", "const x = [foo() < \"a\", {\n", "  readonly b: number;\n", false),
            ("r22_b_ctrl_arr_sp_dq_ok", "const x = [foo() < \"a\", {\n", "  k: 1 + 2,\n", true),
            ("r22_b_ctrl_arr_foo_bad", "const x = [Foo() < \"a\", {\n", "  readonly b: number;\n", false),
            ("r22_b_ctrl_arr_foo_ok", "const x = [Foo() < \"a\", {\n", "  k: 1 + 2,\n", true),
            ("r22_d_type_union_nested_bad", "type F = A | <T, Foo<U, {\n", "  a: number;\n", false),
            ("r22_d_type_inter_nested_bad", "type F = A & <T, Foo<U, {\n", "  a: number;\n", false),
            ("r22_d_type_paren_nested_bad", "type F = (<T, Foo<U, {\n", "  a: number;\n", false),
            ("r22_d_type_union_paren_bad", "type F = A | (<T, Foo<U, {\n", "  a: number;\n", false),
            ("r22_d_type_cond_else_bad", "type F = A extends B ? C : <T, Foo<U, {\n", "  a: number;\n", false),
            ("r22_d_type_union_t_anon_bad", "type F = A | <T, {\n", "  a: number;\n", false),
            ("r22_d_type_bar_t_foo_ok", "type F = Bar<T, Foo<U, {\n", "  a: number;\n", true),
            ("r22_d_type_union_paren_gen_ok", "type F = A | (<T = {\n", "  a: number;\n", true),
            ("r22_d_iface_union_type_bad", "interface I {\n  foo: A | type bar<T = {\n", "    a: number;\n", false),
            ("r22_d_iface_union_fn_bad", "interface I {\n  foo: A | function bar<T = {\n", "    a: number;\n", false),
            ("r22_d_iface_inter_type_bad", "interface I {\n  foo: A & type bar<T = {\n", "    a: number;\n", false),
            ("r22_d_cls_union_type_bad", "class C {\n  foo: A | type bar<T = {\n", "    a: number;\n", false),
            ("r22_d_typelit_union_fn_bad", "type T = {\n  foo: A | function bar<T = {\n", "    a: number;\n", false),
            ("r22_d_type_union_type_bad", "type F = A | type bar<T = {\n", "  a: number;\n", false),
        ] {
            chk(lang, &format!("{tag}{suf}"), base, &format!("{base}{body}"), exp);
        }
    }

    // Explorer 2: TSX >48L JSX siblings + trailing comments before <div>
    let pad50 = "// pad\n".repeat(50);
    let sibs30 = "      <div />\n".repeat(30);
    for (name, base, body, exp) in [
        ("r22_tsx_gt48_frag_selfclose_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <>\n      <div />\n      <span>\n"), "        hello\n", true),
        ("r22_tsx_gt48_div_selfclose_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <div>\n      <a />\n      <span>\n"), "        hello\n", true),
        ("r22_tsx_gt48_frag_closed_sib_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <>\n      <div>x</div>\n      <span>\n"), "        hello\n", true),
        ("r22_tsx_gt48_frag_ml_closed_sib_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <>\n      <div>\n        x\n      </div>\n      <span>\n"), "        hello\n", true),
        ("r22_tsx_gt48_ret_no_paren_ok.tsx", format!("{pad50}function f() {{\n  return <>\n    <div />\n    <span>\n"), "      hello\n", true),
        ("r22_tsx_gt48_frag_text_span_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <>\n      <div />\n      hello\n      <span>\n"), "        ok\n", true),
        ("r22_tsx_gt48_frag_30_sibs_ok.tsx", format!("function f() {{\n  return (\n    <>\n{sibs30}      <span>\n"), "        hello\n", true),
        ("r22_tsx_gt48_semi_jsx_in_fn_ok.tsx", format!("{pad50}function f() {{\n  const o = {{ a: 1 }};\n  <div>\n    <a />\n    <span>\n"), "      hello\n", true),
        ("r22_tsx_gt48_no_semi_frag_bad.tsx", format!("{pad50}function f() {{\n  const o = {{ a: 1 }}\n  <>\n    <div />\n    <span>\n"), "      hello\n", false),
        ("r22_tsx_gt48_semi_2sibs_no_parent_bad.tsx", format!("{pad50}function f() {{\n  const o = {{ a: 1 }};\n  <div />\n  <span>\n"), "    hello\n", false),
        ("r22_tsx_obj_1l_cmt_bad.tsx", "const o = { a: 1 } // comment\n<div>\n".to_string(), "  <span>ok</span>\n</div>\n", false),
        ("r22_tsx_obj_1l_cmt_fn_bad.tsx", "function outer() {\n  const o = { a: 1 } // comment\n  <div>\n".to_string(), "    <span>ok</span>\n", false),
        ("r22_tsx_obj_ml_cmt_bad.tsx", "const o = {\n  a: 1\n} // comment\n<div>\n".to_string(), "  <span>ok</span>\n</div>\n", false),
        ("r22_tsx_obj_ml_cmt_fn_bad.tsx", "function outer() {\n  const o = {\n    a: 1\n  } // comment\n  <div>\n".to_string(), "    <span>ok</span>\n", false),
        ("r22_tsx_obj_blk_cmt_bad.tsx", "const o = { a: 1 } /* c1\n  c2 */\n<div>\n".to_string(), "  <span>ok</span>\n</div>\n", false),
        ("r22_tsx_obj_blk_cmt_fn_bad.tsx", "function outer() {\n  const o = { a: 1 } /* c1\n    c2 */\n  <div>\n".to_string(), "    <span>ok</span>\n", false),
        ("r22_tsx_prebrok_ml_cmt_bad.tsx", "const broken = ;\nconst o = { a: 1 } // c\n<div>\n".to_string(), "  <span>ok</span>\n", false),
        ("r22_tsx_if_1l_cmt_ok.tsx", "if (c) {} // comment\n<div>\n".to_string(), "  <span>ok</span>\n", true),
        ("r22_tsx_fn_1l_cmt_ok.tsx", "function g() {} // comment\n<div>\n".to_string(), "  <span>ok</span>\n", true),
    ] {
        chk(LanguageId::Tsx, name, &base, &format!("{base}{body}"), exp);
    }

    // Explorer 2: JS multi-line declare & ASI
    for (name, base, body, exp) in [
        ("r22_js_decl_const_nl_col_bad.js", "declare const\no: {\n", "  a: number;\n", false),
        ("r22_js_decl_let_nl_col_bad.js", "declare let\no: {\n", "  a: number;\n", false),
        ("r22_js_decl_var_nl_col_bad.js", "declare var\no: {\n", "  a: number;\n", false),
        ("r22_js_decl_const_nl_eq_bad.js", "declare const\no = {\n", "  a: 1,\n", false),
        ("r22_js_exp_decl_const_nl_bad.js", "export declare const\no: {\n", "  a: number;\n", false),
        ("r22_js_decl_cmt_const_bad.js", "declare /* c */\nconst o: {\n", "  a: number;\n", false),
        ("r22_js_cls_decl_nl_col_bad.js", "class C {\n  declare\n  x: {\n", "    a: number;\n", false),
        ("r22_js_cls_static_decl_nl_col_bad.js", "class C {\n  static\n  declare\n  x: {\n", "    a: number;\n", false),
        ("r22_js_decl_fn_nl_bad.js", "declare function\nf() {\n", "  return 1;\n", false),
        ("r22_js_decl_nl_const_col_bad.js", "declare\nconst o: {\n", "  a: number;\n", false),
        ("r22_js_exp_nl_decl_fn_bad.js", "export\ndeclare function f() {\n", "  return 1;\n", false),
        ("r22_js_asi_decl_const_ok.js", "declare\nconst x = {\n", "  a: 1,\n", true),
        ("r22_js_asi_decl_cmt_const_ok.js", "declare /* c */\nconst x = {\n", "  a: 1,\n", true),
        ("r22_js_asi_decl_fn_ok.js", "declare\nfunction f() {\n", "  return 1;\n", true),
        ("r22_js_asi_decl_cls_ok.js", "declare\nclass C {\n", "  m() {}\n", true),
        ("r22_js_asi_decl_async_fn_ok.js", "declare\nasync function f() {\n", "  return 1;\n", true),
        ("r22_js_cls_asi_decl_eq_ok.js", "class C {\n  declare\n  x = {\n", "    a: 1,\n", true),
        ("r22_js_cls_asi_decl_m_ok.js", "class C {\n  declare\n  m() {\n", "    return 1;\n", true),
        ("r22_js_obj_decl_nl_col_ok.js", "const o = {\n  declare\n  : {\n", "    a: 1,\n", true),
    ] {
        chk(LanguageId::JavaScript, name, base, &format!("{base}{body}"), exp);
    }

    // Explorer 3: XML depth-0 prolog/PI/DOCTYPE/text/element-content/.dtd/>1.45MB UTF-8
    let brok = "<list>\n  <bad>\n  <a>1</a>\n</list>\n";
    for (name, base, cand, exp) in [
        ("r22_xml_c2_byp_hello_eof_bad.xml", format!("{brok}<!-- old -->\n"), format!("{brok}hello\n"), false),
        ("r22_xml_c2_byp_prolog_eof_bad.xml", format!("{brok}<!-- old -->\n"), format!("{brok}<?xml version=\"1.0\"?>\n"), false),
        ("r22_xml_c2_byp_doctype_eof_bad.xml", format!("{brok}<!-- old -->\n"), format!("{brok}<!DOCTYPE list>\n"), false),
        ("r22_xml_c2_fr_prolog_top_ok.xml", brok.to_string(), format!("<?xml version=\"1.0\"?>\n{brok}"), true),
        ("r22_xml_c2_fr_pi_top_ok.xml", brok.to_string(), format!("<?xml-stylesheet type=\"text/xsl\" href=\"a.xsl\"?>\n{brok}"), true),
        ("r22_xml_c2_fr_pi_eof_ok.xml", brok.to_string(), format!("{brok}<?xml-stylesheet type=\"text/xsl\" href=\"a.xsl\"?>\n"), true),
        ("r22_xml_c2_fr_doctype_top_ok.xml", brok.to_string(), format!("<!DOCTYPE list>\n{brok}"), true),
        ("r22_xml_adv_hello_top_bad.xml", format!("<!-- old -->\n{brok}"), format!("hello\n{brok}"), false),
        ("r22_xml_adv_repl_prolog_hello_bad.xml", format!("<?xml version=\"1.0\"?>\n{brok}"), format!("hello\n{brok}"), false),
        ("r22_xml_adv_malformed_pi_eof_bad.xml", format!("{brok}<!-- old -->\n"), format!("{brok}<??>\n"), false),
        ("r22_xml_adv_malformed_decl_eof_bad.xml", format!("{brok}<!-- old -->\n"), format!("{brok}<!bad>\n"), false),
        ("r22_xml_adv_cmt_before_prolog_bad.xml", format!("<?xml version=\"1.0\"?>\n{brok}"), format!("<!-- cmt -->\n<?xml version=\"1.0\"?>\n{brok}"), false),
        ("r22_xml_adv_doctype_after_prolog_ok.xml", format!("<?xml version=\"1.0\"?>\n{brok}"), format!("<?xml version=\"1.0\"?>\n<!DOCTYPE list>\n{brok}"), true),
        ("r22_xml_adv_pi_after_doctype_ok.xml", format!("<!DOCTYPE list>\n{brok}"), format!("<!DOCTYPE list>\n<?pi x?>\n{brok}"), true),
        ("r22_xml_adv_two_pi_eof_ok.xml", format!("{brok}<!-- old -->\n"), format!("{brok}<?pi a?>\n<?pi b?>\n"), true),
        ("r22_xml_adv_doctype_subset_top_ok.xml", brok.to_string(), format!("<!DOCTYPE list [\n  <!ELEMENT list (a*)>\n]>\n{brok}"), true),
        ("r22_xml_prolog_after_cmt_bad.xml", format!("<!-- cmt -->\n{brok}"), format!("<!-- cmt -->\n<?xml version=\"1.0\"?>\n{brok}"), false),
        ("r22_xml_dup_prolog_bad.xml", format!("<?xml version=\"1.0\"?>\n{brok}"), format!("<?xml version=\"1.0\"?>\n<?xml version=\"1.0\"?>\n{brok}"), false),
        ("r22_xml_dup_doctype_bad.xml", format!("<!DOCTYPE list>\n{brok}"), format!("<!DOCTYPE list>\n<!DOCTYPE list>\n{brok}"), false),
        ("r22_xml_prolog_no_ver_bad.xml", brok.to_string(), format!("<?xml encoding=\"UTF-8\"?>\n{brok}"), false),
        ("r22_xml_cdata_d0_bad.xml", brok.to_string(), format!("{brok}<![CDATA[hi]]>\n"), false),
        ("r22_xml_cdata_in_elem_ok.xml", "<list>\n  <bad>\n</list>\n".to_string(), "<list>\n  <bad>\n  <![CDATA[hi]]>\n</list>\n".to_string(), true),
        ("r22_xml_pi_in_elem_ok.xml", "<list>\n  <bad>\n</list>\n".to_string(), "<list>\n  <bad>\n  <?pi x?>\n</list>\n".to_string(), true),
        ("r22_xml_hello_in_elem_ok.xml", "<list>\n  <bad>\n</list>\n".to_string(), "<list>\n  <bad>\n  hello\n</list>\n".to_string(), true),
        ("r22_xml_prolog_in_elem_bad.xml", "<list>\n  <bad>\n</list>\n".to_string(), "<list>\n  <bad>\n  <?xml version=\"1.0\"?>\n</list>\n".to_string(), false),
        ("r22_xml_two_root_top_bad.xml", brok.to_string(), format!("<extra/>\n{brok}"), false),
        ("r22_xml_dtd_ok.dtd", "<!ELEMENT list (a*)>\n".to_string(), "<!ELEMENT list (a*)>\n<!ELEMENT a (#PCDATA)>\n".to_string(), true),
    ] {
        chk(LanguageId::Xml, name, &base, &cand, exp);
    }
    let big_items: String = (0..42_000).map(|i| format!("  <item id=\"{i}\">café 🚀</item>\n")).collect();
    let big_base = format!("<list>\n  <bad>\n{big_items}</list>\n<!-- old -->\n");
    assert!(big_base.len() > 1_450_000);
    chk(LanguageId::Xml, "r22_xml_big_prolog_top_ok.xml", &big_base, &format!("<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{big_base}"), true);
    chk(LanguageId::Xml, "r22_xml_big_pi_eof_ok.xml", &big_base, &format!("{big_base}<?xml-stylesheet type=\"text/xsl\" href=\"a.xsl\"?>\n"), true);
    chk(LanguageId::Xml, "r22_xml_big_hello_eof_bad.xml", &big_base,
        &format!("<list>\n  <bad>\n{big_items}</list>\nhello 🚀\n"), false);
    chk(LanguageId::Xml, "r22_xml_big_prolog_eof_bad.xml", &big_base,
        &format!("<list>\n  <bad>\n{big_items}</list>\n<?xml version=\"1.0\"?>\n"), false);

    assert!(failures.is_empty(), "regression_w2_m2b_r22_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r23_cluster_b_type_pos() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), lang).is_valid();
        if got != exp {
            failures.push(format!("{name}: exp={exp}, got={got}"));
        }
    };
    for (lang, ext) in [(LanguageId::TypeScript, "ts"), (LanguageId::Tsx, "tsx")] {
        // 1. Cluster B empty-body
        for (tag, base) in [
            ("arr_call_t", "const x = [foo()<T, {\n"),
            ("arr_call_my", "const x = [foo()<MY_TYPE, {\n"),
            ("arr_id_t", "const x = [a<T, {\n"),
            ("arr_idx_t", "const x = [a[0]<T, {\n"),
            ("arr_idx_my", "const x = [a[0]<MY_TYPE, {\n"),
            ("bar_call_t", "bar(foo()<T, {\n"),
            ("bar_idx_my", "bar(a[0]<MY_TYPE, {\n"),
            ("bare_call_t", "foo()<T, {\n"),
        ] {
            chk(lang, &format!("r23_cb_{tag}_expr.{ext}"), base, &format!("{base}  k: 1 + 2,\n"), true);
            chk(lang, &format!("r23_cb_{tag}_ro.{ext}"), base, &format!("{base}  readonly b: number;\n"), true);
        }
        chk(lang, &format!("r23_r29_arr_my_ok.{ext}"), "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n", "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n  readonly b: string;\n", true);
        chk(lang, &format!("r23_r29_arr_my_bad.{ext}"), "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n", "const arr = [foo<MY_TYPE, {\n  a: (1 + *);\n  ...other,\n", false);
        chk(lang, &format!("r23_arr_call_dq_ro_bad.{ext}"), "const x = [foo()<\"a\", {\n", "const x = [foo()<\"a\", {\n  readonly b: string;\n", false);

        // 2. Cluster B non-empty & spaced literal
        for (tag, base) in [
            ("idx_my", "const x = [a[0]<MY_TYPE, {\n  k: 1,\n"),
            ("call_my", "const x = [foo()<MY_TYPE, {\n  k: 1,\n"),
        ] {
            chk(lang, &format!("r23_cb_ne_{tag}_ok.{ext}"), base, &format!("{base}  k2: 1 + 2,\n"), true);
            chk(lang, &format!("r23_cb_ne_{tag}_bad.{ext}"), base, &format!("{base}  readonly b: string;\n"), false);
        }
        for (tag, base) in [("sp_dq", "foo() <\"a\", {\n"), ("sp_arg_dq", "foo(a) <\"a\", {\n")] {
            chk(lang, &format!("r23_cb_{tag}_ok.{ext}"), base, &format!("{base}  readonly b: string;\n"), true);
        }

        // 3. TypeParen / TypeBracket / ValueParen [abstract] new <T = { & <T = {
        for (tag, base) in [
            ("tp_new_att", "type F = (new<T = {\n"),
            ("tp_new_sp", "type F = (new <T = {\n"),
            ("tp_abs_new", "type F = (abstract new<T = {\n"),
            ("tp_union_abs_new", "type F = A | (abstract new<T = {\n"),
            ("iface_tp_new", "interface I {\n  foo: (new<T = {\n"),
            ("tb_new", "type F = [new<T = {\n"),
            ("tb_abs_new", "type F = [abstract new<T = {\n"),
            ("tb_elem_new", "type F = [A, new <T = {\n"),
            ("tb_elem_abs_new", "type F = [A, abstract new <T = {\n"),
            ("vp_fn_new_sp", "function fn(cb: new <T = {\n"),
            ("vp_fn_new_att", "function fn(cb: new<T = {\n"),
            ("vp_fn_abs_new", "function fn(cb: abstract new <T = {\n"),
            ("vp_arr_new", "const fn = (cb: new <T = {\n"),
            ("vp_arr_abs_new", "const fn = (cb: abstract new <T = {\n"),
            ("vp_fn_union_new", "function fn(cb: A | new <T = {\n"),
            ("vp_fn_union_abs_new", "function fn(cb: A | abstract new <T = {\n"),
            ("vp_fn_union_gen", "function fn(cb: A | <T = {\n"),
            ("vp_arr_union_gen", "const fn = (cb: A | <T = {\n"),
            ("vp_fn_paren_new", "function fn(cb: (new<T = {\n"),
            ("type_new_nested", "type F = new<T = Foo<U, {\n"),
            ("vp_ret_async_gen", "const f = ((x: number): Foo => async <T = {\n"),
        ] {
            chk(lang, &format!("r23_tp_{tag}_ok.{ext}"), base, &format!("{base}  a: number;\n"), true);
        }
        chk(lang, &format!("r23_tp_abs_no_new_bad.{ext}"), "function fn(cb: abstract <T = {\n", "function fn(cb: abstract <T = {\n  a: number;\n", false);
        chk(lang, &format!("r23_tb_new_no_def_bad.{ext}"), "type F = [A, new <T, {\n", "type F = [A, new <T, {\n  a: number;\n", false);
        chk(lang, &format!("r23_vp_tern_new_bad.{ext}"), "bar(a ? b : new <T = {\n", "bar(a ? b : new <T = {\n  a: number;\n", false);
        chk(lang, &format!("r23_vp_expr_foo_ok.{ext}"), "bar(foo < T, {\n", "bar(foo < T, {\n  k: 1 + 2,\n", true);
        chk(lang, &format!("r23_vp_tern_foo_ok.{ext}"), "bar(a ? b : foo < T, {\n", "bar(a ? b : foo < T, {\n  k: 1 + 2,\n", true);

        // 4. Cluster 4 bypasses & positive controls
        for (tag, base) in [
            ("vp_fn_union_nested", "function fn(cb: A | <T, Foo<U, {\n"),
            ("vp_arr_union_nested", "const fn = (cb: A | <T, Foo<U, {\n"),
            ("vp_fn_nested", "function fn(cb: <T, Foo<U, {\n"),
            ("vp_arr_nested", "const fn = (cb: <T, Foo<U, {\n"),
            ("tb_nested", "type F = [A, <T, Foo<U, {\n"),
            ("vp_fn_tp_nested", "function fn(cb: (<T, Foo<U, {\n"),
            ("vp_fn_type_kw", "function fn(cb: A | type bar<T = {\n"),
            ("vp_arr_type_kw", "const fn = (cb: A | type bar<T = {\n"),
            ("vp_fn_fn_kw", "function fn(cb: A | function bar<T = {\n"),
            ("vp_arr_fn_kw", "const fn = (cb: A | function bar<T = {\n"),
            ("tb_type_kw", "type F = [A, type bar<T = {\n"),
            ("tb_fn_kw", "type F = [A, function bar<T = {\n"),
            ("tb_gen_star_kw", "type F = [A, function* <T = {\n"),
        ] {
            chk(lang, &format!("r23_c4_{tag}_bad.{ext}"), base, &format!("{base}  a: number;\n"), false);
        }
        chk(lang, &format!("r23_c4_fn_bar_ok.{ext}"), "function fn(cb: A | Bar<T, Foo<U, {\n", "function fn(cb: A | Bar<T, Foo<U, {\n  a: number;\n", true);
        chk(lang, &format!("r23_c4_tb_bar_ok.{ext}"), "type F = [A, Bar<T, Foo<U, {\n", "type F = [A, Bar<T, Foo<U, {\n  a: number;\n", true);
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r23_cluster_b_type_pos failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r23_e2_all() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), lang).is_valid();
        if got != exp {
            failures.push(format!("{name}: exp={exp}, got={got}"));
        }
    };
    let pad50: String = (0..50).map(|i| format!("const _p{i} = {i};\n")).collect();

    // 1. F2: >48L TSX same-line return (<div> / const el = (<div> / <> + siblings/text
    for (name, base, body, exp) in [
        ("r23_f2_gt48_ret_div_selfclose_ok.tsx", format!("{pad50}function f() {{\n  return (<div>\n    <a />\n    <span>\n"), "      hello\n", true),
        ("r23_f2_gt48_ret_div_text_ok.tsx", format!("{pad50}function f() {{\n  return (<div>\n    hello\n    <span>\n"), "      ok\n", true),
        ("r23_f2_gt48_const_div_selfclose_ok.tsx", format!("{pad50}function f() {{\n  const el = (<div>\n    <a />\n    <span>\n"), "      hello\n", true),
        ("r23_f2_gt48_ret_frag_selfclose_ok.tsx", format!("{pad50}function f() {{\n  return (<>\n    <a />\n    <span>\n"), "      hello\n", true),
        ("r23_f2_gt48_ret_div_sib_div_ok.tsx", format!("{pad50}function f() {{\n  return (<div>\n    <div>x</div>\n    <span>\n"), "      hello\n", true),
        ("r23_f2_gt48_ret_ml_div_ok.tsx", format!("{pad50}function f() {{\n  return (\n    <div>\n      <a />\n      <span>\n"), "        hello\n", true),
        ("r23_f2_gt48_ret_div_closed_2root_bad.tsx", format!("{pad50}function f() {{\n  return (<div>x</div>\n    <span>\n"), "      hello\n", false),
        ("r23_f2_gt48_ret_paren_2sibs_bad.tsx", format!("{pad50}function f() {{\n  return (\n    <div />\n    <span>\n"), "      hello\n", false),
        // 2. Cluster 1: TSX same-line } + block-comment/direct <div> bypasses + controls
        ("r23_c1_fn_blk_div_bad.tsx", "function outer() {\n  const o = { a: 1 } /* c */ <div>\n".into(), "    <span>ok</span>\n", false),
        ("r23_c1_fn_ml_blk_div_bad.tsx", "function outer() {\n  const o = { a: 1 } /* c1\n    c2 */ <div>\n".into(), "    <span>ok</span>\n", false),
        ("r23_c1_top_blk_div_bad.tsx", "const o = { a: 1 } /* c */ <div>\n".into(), "  <span>ok</span>\n</div>\n", false),
        ("r23_c1_top_blk_brok_div_bad.tsx", "const brok = ;\nconst o = { a: 1 } /* c */ <div>\n".into(), "  <span>ok</span>\n", false),
        ("r23_c1_fn_no_cmt_div_bad.tsx", "function outer() {\n  const o = { a: 1 } <div>\n".into(), "    <span>ok</span>\n", false),
        ("r23_c1_gt48_fn_blk_div_bad.tsx", format!("{pad50}function outer() {{\n  const o = {{ a: 1 }} /* c */ <div>\n"), "    <span>ok</span>\n", false),
        ("r23_c1_gt48_ml_blk_div_sib_bad.tsx", format!("{pad50}function outer() {{\n  const o = {{ a: 1 }} /* c1\n    c2 */ <div>\n    <a />\n    <span>\n"), "      ok\n", false),
        ("r23_c1_ret_same_blk_div_bad.tsx", "function outer() {\n  return { a: 1 } /* c */ <div>\n".into(), "  <span>ok</span>\n", false),
        ("r23_c1_str_blk_div_bad.tsx", "const s = \"a\" /* c */ <div>\n".into(), "  <span>ok</span>\n</div>\n", false),
        ("r23_c1_str_blk_brok_div_bad.tsx", "const brok = ;\nconst s = \"a\" /* c */ <div>\n".into(), "  <span>ok</span>\n", false),
        ("r23_c1_if_blk_div_ok.tsx", "if (c) {} /* c */ <div>\n".into(), "  <span>ok</span>\n", true),
        ("r23_c1_fng_blk_div_ok.tsx", "function g() {} /* c */ <div>\n".into(), "  <span>ok</span>\n", true),
        ("r23_c1_semi_div_ok.tsx", "const o = { a: 1 }; <div>\n".into(), "  <span>ok</span>\n", true),
        ("r23_c1_ret_ml_blk_nl_div_bad.tsx", "function outer() {\n  return { a: 1 } /* c1\n  c2 */\n<div>\n".into(), "  <span>ok</span>\n", false),
    ] {
        chk(LanguageId::Tsx, name, &base, &format!("{base}{body}"), exp);
    }

    // 3. F3: declare ASI in class across .js, .ts, .tsx
    for (lang, ext) in [(LanguageId::JavaScript, "js"), (LanguageId::TypeScript, "ts"), (LanguageId::Tsx, "tsx")] {
        for (tag, base, body, exp) in [
            ("decl_nl_star_m", "class C {\n  declare\n  *m() {\n", "    yield 1;\n", false),
            ("static_nl_decl_nl_star_m", "class C {\n  static\n  declare\n  *m() {\n", "    yield 1;\n", false),
            ("async_nl_decl_nl_star_m", "class C {\n  async\n  declare\n  *m() {\n", "    yield 1;\n", false),
            ("async_decl_nl_m", "class C {\n  async declare\n  m() {\n", "    return 1;\n", false),
            ("static_nl_decl_nl_m", "class C {\n  static\n  declare\n  m() {\n", "    return 1;\n", true),
            ("static_decl_nl_m", "class C {\n  static declare\n  m() {\n", "    return 1;\n", true),
            ("async_nl_decl_nl_m", "class C {\n  async\n  declare\n  m() {\n", "    return 1;\n", true),
            ("decl_nl_async_m", "class C {\n  declare\n  async m() {\n", "    return 1;\n", true),
            ("decl_nl_async_star_m", "class C {\n  declare\n  async *m() {\n", "    yield 1;\n", true),
            ("static_decl_nl_async_m", "class C {\n  static declare\n  async m() {\n", "    return 1;\n", true),
            ("priv_nl_decl_nl_m", "class C {\n  private\n  declare\n  m() {\n", "    return 1;\n", true),
        ] {
            chk(lang, &format!("r23_f3_{tag}.{ext}"), base, &format!("{base}{body}"), exp);
        }
        let ts_only = lang != LanguageId::JavaScript;
        chk(lang, &format!("r23_f3_decl_async_nl_m.{ext}"), "class C {\n  declare async\n  m() {\n", "class C {\n  declare async\n  m() {\n    return 1;\n", ts_only);
        chk(lang, &format!("r23_f3_priv_decl_nl_m.{ext}"), "class C {\n  private declare\n  m() {\n", "class C {\n  private declare\n  m() {\n    return 1;\n", ts_only);
    }

    // 4. Cluster 5: JS TS-only class modifiers + export\ndeclare\n
    for kw in ["readonly", "private", "public", "protected", "override"] {
        for (tag, base, body, exp) in [
            ("field_eq", format!("class C {{\n  {kw} x = {{\n"), "    a: 1,\n", false),
            ("method", format!("class C {{\n  {kw} m() {{\n"), "    return 1;\n", false),
            ("static_field_eq", format!("class C {{\n  static {kw} x = {{\n"), "    a: 1,\n", false),
            ("static_method", format!("class C {{\n  static {kw} m() {{\n"), "    return 1;\n", false),
            ("kw_method_ok", format!("class C {{\n  {kw}() {{\n"), "    return 1;\n", true),
            ("static_kw_method_ok", format!("class C {{\n  static {kw}() {{\n"), "    return 1;\n", true),
            ("kw_field_ok", format!("class C {{\n  {kw} = {{\n"), "    a: 1,\n", true),
            ("kw_nl_field_ok", format!("class C {{\n  {kw}\n  x = {{\n"), "    a: 1,\n", true),
            ("kw_nl_method_ok", format!("class C {{\n  {kw}\n  m() {{\n"), "    return 1;\n", true),
        ] {
            chk(LanguageId::JavaScript, &format!("r23_c5_{kw}_{tag}.js"), &base, &format!("{base}{body}"), exp);
        }
    }
    for (name, base, body, exp) in [
        ("r23_c5_static_nl_priv_x_bad.js", "class C {\n  static\n  private x = {\n", "    a: 1,\n", false),
        ("r23_c5_priv_hash_x_bad.js", "class C {\n  private #x = {\n", "    a: 1,\n", false),
        ("r23_c5_priv_comp_x_bad.js", "class C {\n  private [k] = {\n", "    a: 1,\n", false),
        ("r23_c5_priv_quoted_m_bad.js", "class C {\n  private \"m\"() {\n", "    return 1;\n", false),
        ("r23_c5_priv_star_m_bad.js", "class C {\n  private *m() {\n", "    yield 1;\n", false),
        ("r23_c5_async_priv_m_bad.js", "class C {\n  async private m() {\n", "    return 1;\n", false),
        ("r23_c5_static_async_priv_m_bad.js", "class C {\n  static async private m() {\n", "    return 1;\n", false),
        ("r23_c5_static_nl_priv_nl_m_ok.js", "class C {\n  static\n  private\n  m() {\n", "    return 1;\n", true),
        ("r23_c5_async_priv_ok.js", "class C {\n  async private() {\n", "    return 1;\n", true),
        ("r23_c5_static_async_priv_ok.js", "class C {\n  static async private() {\n", "    return 1;\n", true),
        ("r23_c5_priv_nl_hash_x_ok.js", "class C {\n  private\n  #x = {\n", "    a: 1,\n", true),
        ("r23_c5_exp_nl_decl_const_ok.js", "export\ndeclare\nconst x = {\n", "  a: 1,\n", true),
        ("r23_c5_exp_nl_decl_fn_ok.js", "export\ndeclare\nfunction f() {\n", "  return 1;\n", true),
        ("r23_c5_exp_nl_decl_cls_ok.js", "export\ndeclare\nclass C {\n", "  m() {}\n", true),
        ("r23_c5_exp_def_nl_decl_fn_ok.js", "export default\ndeclare\nfunction f() {\n", "  return 1;\n", true),
        ("r23_c5_exp_nl_decl_const_col_bad.js", "export\ndeclare const\no: {\n", "  a: number;\n", false),
        ("r23_c5_exp_decl_nl_const_col_bad.js", "export declare\nconst o: {\n", "  a: number;\n", false),
        ("r23_c5_exp_decl_nl_const_eq_bad.js", "export declare\nconst x = {\n", "  a: 1,\n", false),
        ("r23_c5_exp_nl_decl_iface_bad.js", "export\ndeclare\ninterface I {\n", "  a: number;\n", false),
        ("r23_c5_exp_nl_def_nl_decl_fn_bad.js", "export\ndefault\ndeclare\nfunction f() {\n", "  return 1;\n", false),
    ] {
        chk(LanguageId::JavaScript, name, base, &format!("{base}{body}"), exp);
    }
    assert!(failures.is_empty(), "regression_w2_m2b_r23_e2_all failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r23_xml_bom_root_del() {
    let fw = DefaultSyntaxFirewall;
    let brok = "<list>\n  <bad>\n  <a>1</a>\n</list>\n";
    let bom_brok = "\u{FEFF}<list>\n  <bad>\n  <a>1</a>\n</list>\n";
    let mut failures = Vec::new();
    let mut chk = |name: &str, base: &str, cand: &str, exp: bool| {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), LanguageId::Xml).is_valid();
        if got != exp {
            failures.push(format!("{name}: exp={exp}, got={got}"));
        }
    };
    // 1. reviewer_1 F2: BOM + prolog line-1 insertion/replacement & invalid controls
    chk("r23_bom_top_prolog_ok.xml", brok, &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{brok}"), true);
    chk("r23_bom_repl_cmt_prolog_ok.xml", &format!("<!-- old -->\n{brok}"), &format!("\u{FEFF}<?xml version=\"1.0\"?>\n{brok}"), true);
    chk("r23_bom_rm_prolog_ok.xml", &format!("\u{FEFF}<?xml version=\"1.0\"?>\n{brok}"), &format!("<?xml version=\"1.0\"?>\n{brok}"), true);
    chk("r23_bom_rm_root_ok.xml", bom_brok, brok, true);
    chk("r23_bom_eof_prolog_bad.xml", brok, &format!("{brok}\u{FEFF}<?xml version=\"1.0\"?>\n"), false);
    chk("r23_bom_after_cmt_prolog_bad.xml", &format!("<!-- cmt -->\n{brok}"), &format!("<!-- cmt -->\n\u{FEFF}<?xml version=\"1.0\"?>\n{brok}"), false);
    chk("r23_bom_malformed_prolog_bad.xml", brok, &format!("\u{FEFF}<?xml encoding=\"UTF-8\"?>\n{brok}"), false);
    // 2. challenger_2 #1-#5: BOM-prefixed root shift + root/nested attribute edits
    chk("r23_c1_bom_ins_prolog_ok.xml", bom_brok, &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{brok}"), true);
    chk("r23_c2_bom_ins_pi_ok.xml", bom_brok, &format!("\u{FEFF}<?pi x?>\n{brok}"), true);
    chk("r23_c3_bom_ins_doctype_ok.xml", bom_brok, &format!("\u{FEFF}<!DOCTYPE list>\n{brok}"), true);
    chk("r23_c4_bom_ins_cmt_ok.xml", bom_brok, &format!("\u{FEFF}<!-- c -->\n{brok}"), true);
    chk("r23_c5_prolog_root_attr_ok.xml", brok, "<?xml version=\"1.0\"?>\n<list id=\"1\">\n  <bad>\n  <a>1</a>\n</list>\n", true);
    chk("r23_c5_prolog_root_attr_bad.xml", brok, "<?xml version=\"1.0\"?>\n<list id=bad>\n  <bad>\n  <a>1</a>\n</list>\n", false);
    chk("r23_bom_prolog_root_attr_ok.xml", bom_brok, "\u{FEFF}<?xml version=\"1.0\"?>\n<list id=\"1\">\n  <bad>\n  <a>1</a>\n</list>\n", true);
    chk("r23_bom_prolog_root_attr_bad.xml", bom_brok, "\u{FEFF}<?xml version=\"1.0\"?>\n<list id=bad>\n  <bad>\n  <a>1</a>\n</list>\n", false);
    chk("r23_root_attr_ok.xml", brok, "<list id=\"1\">\n  <bad>\n  <a>1</a>\n</list>\n", true);
    chk("r23_root_attr_bad.xml", brok, "<list id=bad>\n  <bad>\n  <a>1</a>\n</list>\n", false);
    chk("r23_nested_attr_ok.xml", "<root>\n  <list>\n    <bad>\n  </list>\n</root>\n", "<root>\n  <list id=\"1\">\n    <bad>\n  </list>\n</root>\n", true);
    chk("r23_nested_attr_bad.xml", "<root>\n  <list>\n    <bad>\n  </list>\n</root>\n", "<root>\n  <list id=bad>\n    <bad>\n  </list>\n</root>\n", false);
    // 3. challenger_2 #6-#9 + siblings: sole-root deletion / replacement / empty file
    chk("r23_c6_del_root_prolog_bad.xml", &format!("<?xml version=\"1.0\"?>\n{brok}"), "<?xml version=\"1.0\"?>\n", false);
    chk("r23_c7_del_root_cmt_bad.xml", &format!("<!-- cmt -->\n{brok}"), "<!-- cmt -->\n", false);
    chk("r23_c8_del_root_pi_bad.xml", &format!("<?pi x?>\n{brok}"), "<?pi x?>\n", false);
    chk("r23_c9_del_root_doctype_bad.xml", &format!("<!DOCTYPE list>\n{brok}"), "<!DOCTYPE list>\n", false);
    chk("r23_del_root_bom_prolog_bad.xml", &format!("\u{FEFF}<?xml version=\"1.0\"?>\n{brok}"), "\u{FEFF}<?xml version=\"1.0\"?>\n", false);
    chk("r23_del_root_before_cmt_bad.xml", &format!("{brok}<!-- cmt -->\n"), "<!-- cmt -->\n", false);
    chk("r23_del_root_empty_bad.xml", brok, "", false);
    chk("r23_del_root_ws_bad.xml", brok, "   \n", false);
    chk("r23_repl_root_cmt_bad.xml", brok, "<!-- cmt -->\n", false);
    chk("r23_repl_root_pi_bad.xml", brok, "<?pi x?>\n", false);
    // 4. >1.45MB UTF-8 XML BOM + attr edit
    let big_items: String = (0..42_000).map(|i| format!("  <item id=\"{i}\">café 🚀</item>\n")).collect();
    let big_base = format!("<list>\n  <bad>\n{big_items}</list>\n");
    assert!(big_base.len() > 1_450_000);
    chk("r23_big_bom_prolog_ok.xml", &big_base, &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n{big_base}"), true);
    chk("r23_big_bom_attr_ok.xml", &format!("\u{FEFF}{big_base}"), &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<list id=\"1\">\n  <bad>\n{big_items}</list>\n"), true);
    chk("r23_big_bom_attr_bad.xml", &format!("\u{FEFF}{big_base}"), &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<list id=bad>\n  <bad>\n{big_items}</list>\n"), false);
    assert!(failures.is_empty(), "regression_w2_m2b_r23_xml_bom_root_del failed ({}): {failures:#?}", failures.len());
}

#[test]
fn regression_w2_m2b_r24_colon_hdr_and_xml_perf() {
    use std::time::{Duration, Instant};
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), lang).is_valid();
        if got != exp {
            failures.push(format!("{name} ({lang:?}): exp={exp}, got={got}"));
        }
    };
    let py_pre = "def brok():\n    x = \n";
    let ts_pre = "const brok = ;\n";
    // 1. E1/E3 colon-header bypasses & ground-truth variants
    chk(LanguageId::Python, "p_def.py", &format!("{py_pre}def ok():\n    return 1\n"), &format!("{py_pre}def ok():\n    y = \n    return 1\n"), false);
    chk(LanguageId::Python, "p_1_plus_star.py", &format!("{py_pre}def ok():\n    return 1\n"), &format!("{py_pre}def ok():\n    1 + *\n    return 1\n"), false);
    chk(LanguageId::Python, "p_if.py", &format!("{py_pre}if cond:\n    pass\n"), &format!("{py_pre}if cond:\n    y = \n    pass\n"), false);
    chk(LanguageId::Python, "p_cls_def.py", &format!("{py_pre}class Ok:\n    def m(self):\n        return 1\n"), &format!("{py_pre}class Ok:\n    y = \n    def m(self):\n        return 1\n"), false);
    chk(LanguageId::Python, "p_cls_star.py", &format!("{py_pre}class Ok:\n    v = 1\n"), &format!("{py_pre}class Ok:\n    1 + *\n    v = 1\n"), false);
    chk(LanguageId::TypeScript, "ts_case_const_z.ts", &format!("{ts_pre}switch (x) {{\n  case 1:\n    const z = 1;\n    break;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n    const z = 1;\n    break;\n}}\n"), false);
    chk(LanguageId::TypeScript, "ts_case_before_rbrace.ts", &format!("{ts_pre}switch (x) {{\n  case 1:\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n}}\n"), false);
    chk(LanguageId::Python, "p_def_eof_y.py", &format!("{py_pre}def ok():\n"), &format!("{py_pre}def ok():\n    y = \n"), false);
    chk(LanguageId::TypeScript, "ts_case_eof_y.ts", &format!("{ts_pre}switch (x) {{\n  case 1:\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n"), false);
    chk(LanguageId::Python, "p_if_paren_1_plus_star.py", &format!("{py_pre}if (\n    a\n):\n    pass\n"), &format!("{py_pre}if (\n    1 + *\n):\n    pass\n"), false);
    chk(LanguageId::Python, "p_dict_1_plus_star.py", &format!("{py_pre}d = {{\n    \"a\":\n        1\n}}\n"), &format!("{py_pre}d = {{\n    \"a\":\n        1 + *\n}}\n"), false);
    chk(LanguageId::Python, "p_ml_sig_bad.py", &format!("{py_pre}def ok(\n    a: int\n):\n    return 1\n"), &format!("{py_pre}def ok(\n    a: int\n):\n    y = \n    return 1\n"), false);
    chk(LanguageId::Python, "p_ml_sig_ok.py", &format!("{py_pre}def ok(\n    a: int\n):\n    return 1\n"), &format!("{py_pre}def ok(\n    a: int\n):\n    y = 2\n    return 1\n"), true);
    chk(LanguageId::Python, "p_nested_colon_ok.py", &format!("{py_pre}class C:\n    def m(self):\n        if x:\n"), &format!("{py_pre}class C:\n    def m(self):\n        if x:\n            return 1\n"), true);
    // Sibling colon headers & valid controls
    for (name, hdr, tail) in [
        ("p_elif.py", "if c:\n    pass\nelif d:\n", "    return 1\n"),
        ("p_else.py", "if c:\n    pass\nelse:\n", "    return 1\n"),
        ("p_for.py", "for x in xs:\n", "    return 1\n"),
        ("p_while.py", "while cond:\n", "    return 1\n"),
        ("p_with.py", "with ctx() as c:\n", "    return 1\n"),
        ("p_try.py", "try:\n", "    return 1\n"),
        ("p_except.py", "try:\n    pass\nexcept Exception:\n", "    return 1\n"),
        ("p_finally.py", "try:\n    pass\nfinally:\n", "    return 1\n"),
        ("p_async_def.py", "async def f():\n", "    return 1\n"),
        ("p_match_case.py", "match v:\n    case 1:\n", "        return 1\n"),
    ] {
        let indent = if name == "p_match_case.py" { "        " } else { "    " };
        chk(LanguageId::Python, name, &format!("{py_pre}{hdr}{tail}"), &format!("{py_pre}{hdr}{indent}y = \n{tail}"), false);
        chk(LanguageId::Python, &format!("ok_{name}"), &format!("{py_pre}{hdr}{tail}"), &format!("{py_pre}{hdr}{indent}y = 2\n{tail}"), true);
    }
    chk(LanguageId::Python, "py_cls_async_valid.py", &format!("{py_pre}class C:\n    async def ok(self):\n        return 1\n"), &format!("{py_pre}class C:\n    async def ok(self):\n        await foo()\n        return 1\n"), true);
    chk(LanguageId::TypeScript, "ts_default_bad.ts", &format!("{ts_pre}switch (x) {{\n  default:\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  default:\n    const y = \n    const z = 1;\n}}\n"), false);
    chk(LanguageId::TypeScript, "ts_default_ok.ts", &format!("{ts_pre}switch (x) {{\n  default:\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  default:\n    const y = 2;\n    const z = 1;\n}}\n"), true);
    chk(LanguageId::JavaScript, "js_case_bad.js", &format!("{ts_pre}switch (x) {{\n  case 1:\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n    const z = 1;\n}}\n"), false);
    chk(LanguageId::JavaScript, "js_case_ok.js", &format!("{ts_pre}switch (x) {{\n  case 1:\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = 2;\n    const z = 1;\n}}\n"), true);
    chk(LanguageId::Tsx, "tsx_case_bad.tsx", &format!("{ts_pre}switch (x) {{\n  case 1:\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n    const z = 1;\n}}\n"), false);
    chk(LanguageId::TypeScript, "ts_lbl_bad.ts", &format!("{ts_pre}lbl:\n  const z = 1;\n"), &format!("{ts_pre}lbl:\n  const y = \n  const z = 1;\n"), false);
    chk(LanguageId::TypeScript, "ts_lbl_ok.ts", &format!("{ts_pre}lbl:\n  const z = 1;\n"), &format!("{ts_pre}lbl:\n  const y = 2;\n  const z = 1;\n"), true);
    chk(LanguageId::TypeScript, "ts_cmt_repl_bad.ts", &format!("{ts_pre}switch (x) {{\n  case 1:\n    // todo\n    const z = 1;\n}}\n"), &format!("{ts_pre}switch (x) {{\n  case 1:\n    const y = \n    const z = 1;\n}}\n"), false);
    chk(LanguageId::C, "c_case_bad.c", "int brok = ;\nvoid f(int x) {\n  switch (x) {\n  case 1:\n    int z = 1;\n  }\n}\n", "int brok = ;\nvoid f(int x) {\n  switch (x) {\n  case 1:\n    int y = \n    int z = 1;\n  }\n}\n", false);
    chk(LanguageId::Cpp, "cpp_pub_bad.cpp", "int brok = ;\nclass C {\npublic:\n  int z = 1;\n};\n", "int brok = ;\nclass C {\npublic:\n  int y = \n  int z = 1;\n};\n", false);
    chk(LanguageId::CSharp, "cs_case_bad.cs", "class B { int x = ; }\nclass C { void M(int x) {\n  switch (x) {\n  case 1:\n    int z = 1;\n  }\n}}\n", "class B { int x = ; }\nclass C { void M(int x) {\n  switch (x) {\n  case 1:\n    int y = \n    int z = 1;\n  }\n}}\n", false);
    chk(LanguageId::Java, "j_case_bad.java", "class B { int x = ; }\nclass C { void m(int x) {\n  switch (x) {\n  case 1:\n    int z = 1;\n  }\n}}\n", "class B { int x = ; }\nclass C { void m(int x) {\n  switch (x) {\n  case 1:\n    int y = \n    int z = 1;\n  }\n}}\n", false);
    chk(LanguageId::Php, "php_if_bad.php", "<?php\n$b = ;\nif ($c):\n  return 1;\nendif;\n", "<?php\n$b = ;\nif ($c):\n  $y = \n  return 1;\nendif;\n", false);
    chk(LanguageId::Php, "php_if_ok.php", "<?php\n$b = ;\nif ($c):\n  return 1;\nendif;\n", "<?php\n$b = ;\nif ($c):\n  $y = 2;\n  return 1;\nendif;\n", true);
    // TS object/ternary/type-annotation colons
    chk(LanguageId::TypeScript, "ts_obj_cont_ok.ts", &format!("{ts_pre}const o = {{\n  a:\n    1,\n}};\n"), &format!("{ts_pre}const o = {{\n  a:\n    2 +\n    1,\n}};\n"), true);
    chk(LanguageId::TypeScript, "ts_tern_cont_ok.ts", &format!("{ts_pre}const x = c ? a :\n  b;\n"), &format!("{ts_pre}const x = c ? a :\n  d +\n  b;\n"), true);
    chk(LanguageId::TypeScript, "ts_iface_cont_ok.ts", &format!("{ts_pre}interface I {{\n  a:\n    number;\n}}\n"), &format!("{ts_pre}interface I {{\n  a:\n    string |\n    number;\n}}\n"), true);
    chk(LanguageId::TypeScript, "ts_obj_plus_bad.ts", &format!("{ts_pre}const o = {{\n  a:\n    1,\n}};\n"), &format!("{ts_pre}const o = {{\n  a:\n    1 +\n}};\n"), false);
    chk(LanguageId::TypeScript, "ts_obj_const_bad.ts", &format!("{ts_pre}const o = {{\n  a:\n    1,\n}};\n"), &format!("{ts_pre}const o = {{\n  a:\n    const y = \n    1,\n}};\n"), false);
    chk(LanguageId::TypeScript, "ts_tern_star_bad.ts", &format!("{ts_pre}const x = c ? a :\n  b;\n"), &format!("{ts_pre}const x = c ? a :\n  1 + *\n  b;\n"), false);
    chk(LanguageId::TypeScript, "ts_param_colon_bad.ts", &format!("{ts_pre}function ok(\n  a: number,\n) {{}}\n"), &format!("{ts_pre}function ok(\n  a: number,\n  b:\n) {{}}\n"), false);
    // 2. E3 mid-file closer & Bash compound bypasses
    for (lang, name, pre, base_b, bad_b) in [
        (LanguageId::Rust, "rs_call_plus.rs", "fn b() { let x = ; }\nfn f() {\n", "  foo(\n  );\n}\n", "  foo(\n    1 +\n  );\n}\n"),
        (LanguageId::TypeScript, "ts_call_plus.ts", ts_pre, "foo(\n);\n", "foo(\n  1 +\n);\n"),
        (LanguageId::Python, "py_call_plus.py", py_pre, "foo(\n)\n", "foo(\n  1 +\n)\n"),
        (LanguageId::Ruby, "rb_call_plus.rb", "def b\n  x = \nend\n", "foo(\n)\n", "foo(\n  1 +\n)\n"),
        (LanguageId::Cpp, "cpp_call_plus.cpp", "int b = ;\nvoid f() {\n", "  foo(\n  );\n}\n", "  foo(\n    1 +\n  );\n}\n"),
        (LanguageId::CSharp, "cs_call_plus.cs", "class B { int x = ; }\nclass C { void M() {\n", "  foo(\n  );\n}}\n", "  foo(\n    1 +\n  );\n}}\n"),
        (LanguageId::Php, "php_call_plus.php", "<?php\n$b = ;\n", "foo(\n);\n", "foo(\n  1 +\n);\n"),
        (LanguageId::Kotlin, "kt_call_plus.kt", "val b = \nfun f() {\n", "  foo(\n  )\n}\n", "  foo(\n    1 +\n  )\n}\n"),
        (LanguageId::Dart, "dart_call_plus.dart", "var b = ;\nvoid f() {\n", "  foo(\n  );\n}\n", "  foo(\n    1 +\n  );\n}\n"),
        (LanguageId::Java, "java_call_plus.java", "class B { int x = ; }\nclass C { void m() {\n", "  foo(\n  );\n}}\n", "  foo(\n    1 +\n  );\n}}\n"),
        (LanguageId::Rust, "rs_arr_plus.rs", "fn b() { let x = ; }\nfn f() {\n", "  let a = [\n  ];\n}\n", "  let a = [\n    1 +\n  ];\n}\n"),
        (LanguageId::TypeScript, "ts_arr_plus.ts", ts_pre, "const a = [\n];\n", "const a = [\n  1 +\n];\n"),
        (LanguageId::Python, "py_arr_plus.py", py_pre, "a = [\n]\n", "a = [\n  1 +\n]\n"),
    ] {
        chk(lang, name, &format!("{pre}{base_b}"), &format!("{pre}{bad_b}"), false);
    }
    chk(LanguageId::Python, "py_dict_plus_rbrace.py", &format!("{py_pre}d = {{\n    \"a\":\n        2\n}}\n"), &format!("{py_pre}d = {{\n    \"a\":\n        1 +\n}}\n"), false);
    chk(LanguageId::Ruby, "rb_hash_plus_rbrace.rb", "def b\n  x = \nend\nh = {\n  a:\n    2\n}\n", "def b\n  x = \nend\nh = {\n  a:\n    1 +\n}\n", false);
    chk(LanguageId::TypeScript, "ts_call_cont_ok.ts", &format!("{ts_pre}foo(\n  b\n);\n"), &format!("{ts_pre}foo(\n  a +\n  b\n);\n"), true);
    let sh_base = "echo \"unclosed\nif true; then\n  echo ok\nfi\n";
    chk(LanguageId::Bash, "sh_unclosed_if_mid.sh", sh_base, "echo \"unclosed\nif true; then\n  if false; then\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_closed_if_mid_ok.sh", sh_base, "echo \"unclosed\nif true; then\n  if false; then\n    echo 1\n  fi\n  echo ok\nfi\n", true);
    // 3. E2 42k-line XML + Css/Toml/Twig/Html/Bash O(N) perf & correctness
    let big_items: String = (0..42_000).map(|i| format!("  <item id=\"{i}\">café 🚀</item>\n")).collect();
    let big_base = format!("<list>\n  <bad>\n{big_items}</list>\n");
    let t_xml = Instant::now();
    chk(LanguageId::Xml, "r24_big_bom_attr_ok.xml", &format!("\u{FEFF}{big_base}"), &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<list id=\"1\">\n  <bad>\n{big_items}</list>\n"), true);
    chk(LanguageId::Xml, "r24_big_bom_attr_bad.xml", &format!("\u{FEFF}{big_base}"), &format!("\u{FEFF}<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<list id=bad>\n  <bad>\n{big_items}</list>\n"), false);
    let xml_elapsed = t_xml.elapsed();
    let big_css: String = (0..42_000).map(|i| format!("  --v{i}: {i}px;\n")).collect();
    let big_toml: String = (0..42_000).map(|i| format!("  {i},\n")).collect();
    let big_twig: String = (0..42_000).map(|i| format!("  <span>{i}</span>\n")).collect();
    let big_html: String = (0..42_000).map(|i| format!("  <li>{i}</li>\n")).collect();
    let big_sh: String = (0..42_000).map(|i| format!("  echo \"l{i}\"\n")).collect();
    let t_other = Instant::now();
    chk(LanguageId::Css, "r24_big_css_ok.css", &format!(".bad {{ color: ; }}\n.box {{\n{big_css}}}\n/* unclosed\n"), &format!(".bad {{ color: ; }}\n.box {{\n  color: red;\n{big_css}}}\n/* unclosed\n"), true);
    chk(LanguageId::Css, "r24_big_css_bad.css", &format!(".bad {{ color: ; }}\n.box {{\n{big_css}}}\n/* unclosed\n"), &format!(".bad {{ color: ; }}\n.box {{\n  color: ;\n{big_css}}}\n/* unclosed\n"), false);
    chk(LanguageId::Toml, "r24_big_toml_ok.toml", &format!("bad = \narr = [\n{big_toml}]\nml = \"\"\"a\nb\"\"\"\n"), &format!("bad = \narr = [\n  0,\n{big_toml}]\nml = \"\"\"a\nb\"\"\"\n"), true);
    chk(LanguageId::Toml, "r24_big_toml_bad.toml", &format!("bad = \narr = [\n{big_toml}]\n"), &format!("bad = \narr = [\n  = 1,\n{big_toml}]\n"), false);
    chk(LanguageId::Twig, "r24_big_twig_ok.twig", &format!("{{% if bad == %}}\n{{% if ok %}}\n{big_twig}{{% endif %}}\n"), &format!("{{% if bad == %}}\n{{% if ok %}}\n  {{% verbatim %}}\n  raw\n  {{% endverbatim %}}\n{big_twig}{{% endif %}}\n"), true);
    chk(LanguageId::Twig, "r24_big_twig_bad.twig", &format!("{{% if bad == %}}\n{{% if ok %}}\n{big_twig}{{% endif %}}\n"), &format!("{{% if bad == %}}\n{{% if ok %}}\n  {{% if inner_unclosed %}}\n{big_twig}{{% endif %}}\n"), false);
    chk(LanguageId::Html, "r24_big_html_ok.html", &format!("<div>\n  <span>\n<script>\nvar x = 1;\n</script>\n<ul>\n{big_html}</ul>\n"), &format!("<div>\n  <span>\n<script>\nvar x = 1;\n</script>\n<ul id=\"1\">\n{big_html}</ul>\n"), true);
    chk(LanguageId::Html, "r24_big_html_bad.html", &format!("<div>\n  <span>\n<script>\nvar x = 1;\n</script>\n<ul>\n{big_html}</ul>\n"), &format!("<div>\n  <span>\n<script>\nvar x = 1;\n</script>\n<ul\n{big_html}</ul>\n"), false);
    chk(LanguageId::Bash, "r24_big_sh_ok.sh", &format!("echo $(\nif true; then\n{big_sh}fi\n"), &format!("echo $(\nif false; then\n{big_sh}fi\n"), true);
    chk(LanguageId::Bash, "r24_big_sh_bad.sh", &format!("echo $(\nif true; then\n{big_sh}fi\n"), &format!("echo $(\nif ((\n{big_sh}fi\n"), false);
    let other_elapsed = t_other.elapsed();
    assert!(failures.is_empty(), "regression_w2_m2b_r24_colon_hdr_and_xml_perf failed ({}): {failures:#?}", failures.len());
    let xml_limit = Duration::from_secs(if cfg!(debug_assertions) { 90 } else { 20 });
    let other_limit = Duration::from_secs(if cfg!(debug_assertions) { 120 } else { 40 });
    assert!(xml_elapsed < xml_limit, "42k-line XML O(N) perf exceeded {xml_limit:?}: {xml_elapsed:?}");
    assert!(other_elapsed < other_limit, "42k-line Css/Toml/Twig/Html/Bash O(N) perf exceeded {other_limit:?}: {other_elapsed:?}");
}

#[test]
fn regression_w2_m2b_r25_bash_cross_compound() {
    let fw = DefaultSyntaxFirewall;
    let mut failures = Vec::new();
    let mut chk = |lang: LanguageId, name: &str, base: &str, cand: &str, exp: bool| {
        let got = fw.verify_incremental(Some(base), cand, Path::new(name), lang).is_valid();
        if got != exp {
            failures.push(format!("{name} ({lang:?}): exp={exp}, got={got}"));
        }
    };
    let sh_dangling_while = "echo \"dangling\nwhile true; do\n  echo hi\ndone\n";
    let sh_dangling_if = "echo \"dangling\nif true; then\n  echo hi\nfi\n";
    let sh_unclosed_if = "echo \"unclosed\nif true; then\n  echo ok\nfi\n";
    let sh_semi_if = "if\nif true; then\n  echo ok\nfi\n";
    let sh_del_if_base = "echo \"unclosed\nif true; then\n  if false; then\n    echo 1\n  fi\nfi\n";
    let sh_del_if_ok_base = "echo \"unclosed\nif true; then\n  if false; then\n    echo 1\n  fi\n  echo ok\nfi\n";
    let sh_del_while_base = "echo \"unclosed\nif true; then\n  while false; do\n    echo 1\n  done\nfi\n";

    // 1. Auditor Check 4 cross-kind nested compound bypasses behind unclosed quote
    chk(LanguageId::Bash, "ush_mid_bad.sh", sh_dangling_while, "echo \"dangling\nwhile true; do\n  if true; then\n  echo hi\ndone\n", false);
    chk(LanguageId::Bash, "ush_mid_bad_case.sh", sh_dangling_if, "echo \"dangling\nif true; then\n  case x in\n  echo hi\nfi\n", false);

    // 2. Challenger 2 cross-kind compound + pure-deletion bypasses
    chk(LanguageId::Bash, "sh_q_insert_for_in_if.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  for x in a; do\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_q_insert_case_in_if.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  case $x in\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_for_semi.sh", sh_semi_if, "if\nif true; then\n  for x in a; do\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_q_del_fi_mid.sh", sh_del_if_base, "echo \"unclosed\nif true; then\n  if false; then\n    echo 1\nfi\n", false);
    chk(LanguageId::Bash, "sh_q_del_done_in_if_mid.sh", sh_del_while_base, "echo \"unclosed\nif true; then\n  while false; do\n    echo 1\nfi\n", false);

    // 3. Valid closed controls behind unclosed quote
    chk(LanguageId::Bash, "sh_q_nested_closed_ok.sh", sh_dangling_while, "echo \"dangling\nwhile true; do\n  if false; then\n    echo 1\n  fi\n  echo hi\ndone\n", true);
    chk(LanguageId::Bash, "sh_q_nested_closed_case_ok.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  case $x in\n    a) echo 1 ;;\n  esac\n  echo ok\nfi\n", true);
    chk(LanguageId::Bash, "sh_q_for_done_in_if_ok.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  for x in a; do\n    echo $x\n  done\n  echo ok\nfi\n", true);
    chk(LanguageId::Bash, "sh_q_del_whole_if_ok.sh", sh_del_if_ok_base, sh_unclosed_if, true);

    // 4. E1 additional Bash edge cases (case arm if), for((...)), >30L while, inner-quote, select/until)
    let sh_case_base = "echo \"unclosed\ncase \"$x\" in\n  a) echo 0 ;;\nesac\n";
    chk(LanguageId::Bash, "sh_case_if_arm_ok.sh", sh_case_base, "echo \"unclosed\ncase \"$x\" in\n  a) echo 0 ;;\n  if) echo 1 ;;\nesac\n", true);
    let sh_for_arith_base = "echo \"unclosed\nfor((i=0;i<3;i++)); do\n  echo $i\ndone\n";
    chk(LanguageId::Bash, "sh_for_arith_ok.sh", sh_for_arith_base, "echo \"unclosed\nfor((i=0;i<3;i++)); do\n  echo $i\n  echo next\ndone\n", true);
    chk(LanguageId::Bash, "sh_for_arith_bad.sh", sh_for_arith_base, "echo \"unclosed\nfor((i=0;i<3;i++)); do\n  if true; then\n  echo $i\ndone\n", false);
    let pad32: String = (0..32).map(|i| format!("  echo {i}\n")).collect();
    let sh_32_while_base = format!("echo \"unclosed\nwhile true; do\n{pad32}done\n");
    let sh_32_while_bad = format!("echo \"unclosed\nwhile true; do\n{pad32}  while false; do\n  echo tail\ndone\n");
    chk(LanguageId::Bash, "sh_32_while_bad.sh", &sh_32_while_base, &sh_32_while_bad, false);
    let sh_inner_q_base = "if true; then\n  echo \"unclosed\n  echo ok\nfi\n";
    chk(LanguageId::Bash, "sh_inner_q_del_fi_bad.sh", sh_inner_q_base, "if true; then\n  echo \"unclosed\n  echo ok\n", false);
    chk(LanguageId::Bash, "sh_inner_q_ins_if_bad.sh", sh_inner_q_base, "if true; then\n  echo \"unclosed\n  if false; then\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_select_unclosed_bad.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  select x in a b; do\n  echo ok\nfi\n", false);
    chk(LanguageId::Bash, "sh_until_unclosed_bad.sh", sh_unclosed_if, "echo \"unclosed\nif true; then\n  until false; do\n  echo ok\nfi\n", false);

    // 5. E3 snippet_eof.rs pb_inc cases (mid-file unclosed '(' / '[' behind unclosed multiline quotes)
    let rs_q_base = "let s = \"dangling\nfn ok() {\n  let x = 1;\n}\n";
    chk(LanguageId::Rust, "r25_pb_inc_rs_bad.rs", rs_q_base, "let s = \"dangling\nfn ok() {\n  foo(\n  1\n  let x = 1;\n}\n", false);
    chk(LanguageId::Rust, "r25_pb_inc_rs_ok.rs", rs_q_base, "let s = \"dangling\nfn ok() {\n  let y = 2;\n  let x = 1;\n}\n", true);
    let py_q_base = "s = \"\"\"dangling\ndef ok():\n    x = 1\n";
    chk(LanguageId::Python, "r25_pb_inc_py_bad.py", py_q_base, "s = \"\"\"dangling\ndef ok():\n    foo(\n    1\n    x = 1\n", false);
    chk(LanguageId::Python, "r25_pb_inc_py_ok.py", py_q_base, "s = \"\"\"dangling\ndef ok():\n    y = 2\n    x = 1\n", true);
    let ts_q_base = "const s = `dangling\nfunction ok() {\n  const x = 1;\n}\n";
    chk(LanguageId::TypeScript, "r25_pb_inc_ts_bad.ts", ts_q_base, "const s = `dangling\nfunction ok() {\n  foo(\n  1\n  const x = 1;\n}\n", false);
    chk(LanguageId::TypeScript, "r25_pb_inc_ts_ok.ts", ts_q_base, "const s = `dangling\nfunction ok() {\n  const y = 2;\n  const x = 1;\n}\n", true);

    assert!(failures.is_empty(), "regression_w2_m2b_r25_bash_cross_compound failed ({}): {failures:#?}", failures.len());
}
