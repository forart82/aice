use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId, SymbolSelector};

#[test]
fn extracts_symbols_deps_slices_and_outlines_across_all_23_r5_targets() {
    let reg = EngineRegistry::new();

    let samples: &[(LanguageId, &str, &str)] = &[
        (LanguageId::Json, r#"{"service": {"port": 8080}}"#, "service.port"),
        (LanguageId::Yaml, "service:\n  port: 8080\n", "service.port"),
        (LanguageId::Toml, "[package]\nname = \"aice\"\n", "package.name"),
        (LanguageId::Markdown, "# Overview\n\nText\n\n## Details\n\nMore\n", "Overview"),
        (LanguageId::Html, "<html><body><section id=\"card\"><h1>Hi</h1></section></body></html>", "section#card"),
        (LanguageId::Css, ".card { color: red; }\n", ".card"),
        (LanguageId::Xml, "<catalog><service id=\"1\"/></catalog>", "catalog.service"),
        (LanguageId::Bash, "PORT=8080\nrun_job() {\n  echo $PORT\n}\n", "run_job"),
        (LanguageId::Rust, "use std::fmt;\nstruct Engine { v: i32 }\nimpl Engine {\n  fn step(&self) -> i32 { self.v }\n}\n", "Engine::step"),
        (LanguageId::TypeScript, "import { X } from './x';\nexport class App {\n  inc(n: number): number { return n + 1; }\n}\n", "App.inc"),
        (LanguageId::Tsx, "export function Btn() { return <button>Go</button>; }\n", "Btn"),
        (LanguageId::JavaScript, "const fmt = require('./fmt');\nclass Calc { add(a, b) { return a + b; } }\n", "Calc.add"),
        (LanguageId::Python, "import os\nclass Worker:\n    def run(self):\n        return 1\n", "Worker.run"),
        (LanguageId::Go, "package main\nimport \"fmt\"\ntype Srv struct{}\nfunc (s *Srv) Start() {}\n", "Srv.Start"),
        (LanguageId::C, "#include <stdint.h>\nint add(int a, int b) { return a + b; }\n", "add"),
        (LanguageId::Cpp, "#include <vector>\nnamespace core {\nclass Mat {\npublic:\n  int cols() { return 4; }\n};\n}\n", "core::Mat::cols"),
        (LanguageId::CSharp, "using System;\nclass Repo { public int Count() => 1; }\n", "Repo.Count"),
        (LanguageId::Java, "import java.util.List;\npublic class Svc { public int ping() { return 1; } }\n", "Svc.ping"),
        (LanguageId::Kotlin, "import kotlin.math.max\nclass Engine {\n  fun step(): Int {\n    return 1\n  }\n}\n", "Engine.step"),
        (LanguageId::Dart, "import 'dart:math';\nclass Box { int size() => 1; }\n", "Box.size"),
        (LanguageId::Php, "<?php\nclass Ctrl { public function index(): int { return 1; } }\n", "Ctrl::index"),
        (LanguageId::Ruby, "require 'json'\nclass Job\n  def run\n    1\n  end\nend\n", "Job::run"),
        (LanguageId::Twig, "{% extends 'base.twig' %}\n{% block header %}<h1>Hi</h1>{% endblock %}\n", "header"),
    ];

    assert_eq!(samples.len(), 23);
    for (lang, src, target_sym) in samples {
        let adapter = reg.adapter(*lang).unwrap_or_else(|| panic!("missing adapter {lang:?}"));
        let slicer = reg.slicer(*lang).unwrap_or_else(|| panic!("missing slicer {lang:?}"));
        let tree = adapter.parse_cst(src).expect("parse_cst");
        assert!(!tree.has_error(), "unexpected parse error in {lang:?}");
        let syms = adapter.extract_symbols(&tree, src);
        assert!(!syms.is_empty(), "expected symbols for {lang:?}");

        let slice = slicer
            .slice_symbol(&tree, src, &SymbolSelector { name: (*target_sym).to_string(), ordinal: None })
            .unwrap_or_else(|e| panic!("slice_symbol {target_sym} failed for {lang:?}: {e}; syms={syms:?}"));
        assert!(!slice.content.is_empty());

        let outline = slicer.outline(&tree, src, 0, true);
        assert!(!outline.entries.is_empty(), "expected outline for {lang:?}");
    }

    // Cross-separator normalization (Rust Struct::method vs Struct.method; TS Class.method vs Class::method)
    let rs = "struct Engine {}\nimpl Engine { fn step(&self) {} }\n";
    let rs_tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(rs).unwrap();
    let rs_slice = reg
        .slicer(LanguageId::Rust)
        .unwrap()
        .slice_symbol(&rs_tree, rs, &SymbolSelector { name: "Engine.step".to_string(), ordinal: None })
        .expect("normalized dot selector for Rust");
    assert!(rs_slice.content.contains("fn step"));

    // Ordinal @1 / @2 overload disambiguation
    let ts = "function f(a: number): number;\nfunction f(a: string): string;\nfunction f(a: any): any { return a; }\n";
    let ts_tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(ts).unwrap();
    let ts_slicer = reg.slicer(LanguageId::TypeScript).unwrap();
    let second = ts_slicer
        .slice_symbol(&ts_tree, ts, &SymbolSelector { name: "f".to_string(), ordinal: Some(2) })
        .unwrap();
    assert!(second.content.contains("string"));

    // Dependencies extraction
    let py = "import json\nfrom pathlib import Path\ndef main(): pass\n";
    let py_adapter = reg.adapter(LanguageId::Python).unwrap();
    let py_tree = py_adapter.parse_cst(py).unwrap();
    let deps = py_adapter.extract_dependencies(&py_tree, py);
    assert_eq!(deps.len(), 2);

    let twig = "{% extends 'base.twig' %}\n{% include 'part.twig' %}\n{% block body %}ok{% endblock %}\n";
    let tw_adapter = reg.adapter(LanguageId::Twig).unwrap();
    let tw_tree = tw_adapter.parse_cst(twig).unwrap();
    let tw_deps = tw_adapter.extract_dependencies(&tw_tree, twig);
    assert_eq!(tw_deps.len(), 2);
}
#[test]
fn regression_end_line_non_bleed_outline_depth_macro_vs_block_and_comment_dtd() {
    let reg = EngineRegistry::new();

    // TOML, Markdown, YAML end_line must not bleed onto next symbol or exceed total_lines
    let toml_src = "[alpha]\nk = 1\n\n[beta]\nk = 2\n";
    let toml_tree = reg.adapter(LanguageId::Toml).unwrap().parse_cst(toml_src).unwrap();
    let toml_slicer = reg.slicer(LanguageId::Toml).unwrap();
    let alpha = toml_slicer
        .slice_symbol(&toml_tree, toml_src, &SymbolSelector { name: "alpha".to_string(), ordinal: None })
        .unwrap();
    assert!(!alpha.content.contains("[beta]"), "TOML bleed: {}", alpha.content);
    let beta = toml_slicer
        .slice_symbol(&toml_tree, toml_src, &SymbolSelector { name: "beta".to_string(), ordinal: None })
        .unwrap();
    assert_eq!(beta.end_line, 5);

    let md_src = "# Alpha\nhello\n\n# Beta\nworld\n";
    let md_tree = reg.adapter(LanguageId::Markdown).unwrap().parse_cst(md_src).unwrap();
    let md_slicer = reg.slicer(LanguageId::Markdown).unwrap();
    let md_alpha = md_slicer
        .slice_symbol(&md_tree, md_src, &SymbolSelector { name: "Alpha".to_string(), ordinal: None })
        .unwrap();
    assert!(!md_alpha.content.contains("# Beta"), "MD bleed: {}", md_alpha.content);
    let md_beta = md_slicer
        .slice_symbol(&md_tree, md_src, &SymbolSelector { name: "Beta".to_string(), ordinal: None })
        .unwrap();
    assert_eq!(md_beta.end_line, 5);

    let yaml_src = "alpha:\n  k: 1\n\nbeta:\n  k: 2\n";
    let yaml_tree = reg.adapter(LanguageId::Yaml).unwrap().parse_cst(yaml_src).unwrap();
    let yaml_beta = reg
        .slicer(LanguageId::Yaml)
        .unwrap()
        .slice_symbol(&yaml_tree, yaml_src, &SymbolSelector { name: "beta".to_string(), ordinal: None })
        .unwrap();
    assert_eq!(yaml_beta.end_line, 5);

    // Outline depth=1 must include CSS .card and Markdown # v1.2
    let css_src = ".card { color: red; }\n";
    let css_tree = reg.adapter(LanguageId::Css).unwrap().parse_cst(css_src).unwrap();
    let css_out = reg.slicer(LanguageId::Css).unwrap().outline(&css_tree, css_src, 1, true);
    assert!(css_out.entries.iter().any(|e| e.name == ".card"));

    let md_ver = "# v1.2\ntext\n";
    let md_ver_tree = reg.adapter(LanguageId::Markdown).unwrap().parse_cst(md_ver).unwrap();
    let md_ver_out = reg.slicer(LanguageId::Markdown).unwrap().outline(&md_ver_tree, md_ver, 1, true);
    assert!(md_ver_out.entries.iter().any(|e| e.name == "v1.2"));

    // Twig macro foo vs block foo disambiguation + UTF-8 verbatim parse_cst
    let twig_src = "{% block foo %}\nBLOCK_BODY\n{% endblock %}\n{% macro foo() %}\nMACRO_BODY\n{% endmacro %}\n";
    let twig_adapter = reg.adapter(LanguageId::Twig).unwrap();
    let twig_tree = twig_adapter.parse_cst(twig_src).unwrap();
    let macro_slice = reg
        .slicer(LanguageId::Twig)
        .unwrap()
        .slice_symbol(&twig_tree, twig_src, &SymbolSelector { name: "macro foo".to_string(), ordinal: None })
        .unwrap();
    assert!(macro_slice.content.contains("MACRO_BODY"));
    assert!(!macro_slice.content.contains("BLOCK_BODY"));

    let utf8_twig = twig_adapter.parse_cst("{% verbatim %}café — 🚀{% endverbatim %}").unwrap();
    assert!(!utf8_twig.has_error());

    // Comment-prefixed DTD routes to GrammarSlot::Dtd cleanly
    let dtd_src = "<!-- Note DTD -->\n<!ELEMENT note (to)>\n<!ELEMENT to (#PCDATA)>\n";
    let xml_adapter = reg.adapter(LanguageId::Xml).unwrap();
    let dtd_tree = xml_adapter.parse_cst(dtd_src).unwrap();
    assert!(!dtd_tree.has_error());
    let dtd_syms = xml_adapter.extract_symbols(&dtd_tree, dtd_src);
    assert!(dtd_syms.iter().any(|s| s.name == "note"));
}

#[test]
fn regression_iter3_dart_class_method_slice_and_intra_block() {
    let reg = EngineRegistry::new();
    let src = "class Box {\n  int size(int n) {\n    if (n > 0) return n;\n    return 0;\n  }\n}\n";
    let adapter = reg.adapter(LanguageId::Dart).unwrap();
    let slicer = reg.slicer(LanguageId::Dart).unwrap();
    let tree = adapter.parse_cst(src).unwrap();
    assert!(!tree.has_error());

    let syms = adapter.extract_symbols(&tree, src);
    let method = syms
        .iter()
        .find(|s| s.qualified_name == "Box.size")
        .expect("Box.size symbol");
    assert_eq!(method.start_line, 2);
    assert_eq!(method.end_line, 5);
    assert_eq!(method.signature.as_deref(), Some("int size(int n)"));

    let slice = slicer
        .slice_symbol(&tree, src, &SymbolSelector { name: "Box.size".to_string(), ordinal: None })
        .unwrap();
    assert_eq!(slice.start_line, 2);
    assert_eq!(slice.end_line, 5);
    assert!(slice.content.contains("if (n > 0) return n;"));
    assert!(slice.content.contains("return 0;"));

    let intra = slicer
        .slice_intra_block(
            &tree,
            src,
            &aice_lang_registry::IntraBlockSelector {
                symbol: "Box.size".to_string(),
                pattern: "if".to_string(),
            },
        )
        .unwrap();
    assert!(intra.content.contains("if (n > 0) return n;"));
}

#[test]
fn regression_iter5_dart_constructors_getters_setters_operators_and_ext_type() {
    let reg = EngineRegistry::new();
    let src = r#"class Box {
  int w;
  int h;
  Box(this.w, this.h);
  Box.named(int s) : w = s, h = s {
    if (s < 0) w = 0;
  }
  Box.from(int s) : this(s, s);
  const Box.zero() : w = 0, h = 0;
  factory Box.empty() {
    if (true) return Box.named(0);
    return Box(0, 0);
  }
  factory Box.redir(int w, int h) = _BoxImpl.make;
  int get area => w * h;
  int get blockArea {
    if (w > 0) return w * h;
    return 0;
  }
  set width(int v) {
    if (v >= 0) w = v;
  }
  void set height(int v) => h = v;
  static Box create(int s) {
    if (s > 0) return Box(s, s);
    return Box(0, 0);
  }
  Box operator +(Box other) {
    if (other.w > 0) return Box(w + other.w, h + other.h);
    return this;
  }
  int operator [](int i) => i == 0 ? w : h;
}
int get topArea => 42;
int get topBlockArea {
  if (true) return 1;
  return 0;
}
set topWidth(int v) {
  if (v > 0) print(v);
}
extension type Id<T>(T v) {
  T get value => v;
}
"#;
    let adapter = reg.adapter(LanguageId::Dart).unwrap();
    let slicer = reg.slicer(LanguageId::Dart).unwrap();
    let tree = adapter.parse_cst(src).unwrap();
    assert!(!tree.has_error());

    let syms = adapter.extract_symbols(&tree, src);
    for expected in [
        "Box.Box",
        "Box.named",
        "Box.from",
        "Box.zero",
        "Box.empty",
        "Box.redir",
        "Box.area",
        "Box.blockArea",
        "Box.width",
        "Box.height",
        "Box.create",
        "Box.+",
        "Box.[]",
        "topArea",
        "topBlockArea",
        "topWidth",
        "Id",
        "Id.value",
    ] {
        assert!(
            syms.iter().any(|s| s.qualified_name == expected),
            "missing Dart symbol {expected}; got {:?}",
            syms.iter().map(|s| &s.qualified_name).collect::<Vec<_>>()
        );
        let sl = slicer
            .slice_symbol(&tree, src, &SymbolSelector { name: expected.to_string(), ordinal: None })
            .unwrap_or_else(|e| panic!("slice_symbol({expected}) failed: {e}"));
        assert!(!sl.content.is_empty());
    }

    for (sym, pat) in [
        ("Box.named", "if"),
        ("Box.empty", "if"),
        ("Box.area", "w * h"),
        ("Box.blockArea", "if"),
        ("Box.width", "if"),
        ("Box.+", "if"),
        ("topBlockArea", "if"),
        ("topWidth", "if"),
    ] {
        let intra = slicer
            .slice_intra_block(
                &tree,
                src,
                &aice_lang_registry::IntraBlockSelector {
                    symbol: sym.to_string(),
                    pattern: pat.to_string(),
                },
            )
            .unwrap_or_else(|e| panic!("slice_intra_block({sym}, {pat}) failed: {e}"));
        assert!(intra.content.contains(pat));
    }
    let named_sl = slicer
        .slice_symbol(&tree, src, &SymbolSelector { name: "Box.named".to_string(), ordinal: None })
        .unwrap();
    assert!(named_sl.content.contains("if (s < 0) w = 0;"));
    let top_blk = slicer
        .slice_symbol(&tree, src, &SymbolSelector { name: "topBlockArea".to_string(), ordinal: None })
        .unwrap();
    assert!(top_blk.content.contains("return 0;"));
}

#[test]
fn regression_iter6_dart_extension_type_primary_ctor() {
    let reg = EngineRegistry::new();
    let src = r#"extension type Id<T>(T v) {
  T get value => v;
}
extension type const Id2<T>.named(T v) implements Object { T get inner => v; }
extension type Id3<T>.new(T v) { T get inner => v; }
extension type const Id4<T>.named(T v) implements Object {
  T get inner => v;
}
"#;
    let adapter = reg.adapter(LanguageId::Dart).unwrap();
    let slicer = reg.slicer(LanguageId::Dart).unwrap();
    let tree = adapter.parse_cst(src).unwrap();
    assert!(!tree.has_error());
    let syms = adapter.extract_symbols(&tree, src);
    let qnames: Vec<&str> = syms.iter().map(|s| s.qualified_name.as_str()).collect();
    for expected in ["Id", "Id.value", "Id2", "Id2.named", "Id2.inner", "Id3", "Id3.new", "Id3.inner", "Id4", "Id4.named", "Id4.inner"] {
        assert!(qnames.contains(&expected), "missing {expected}; got {qnames:?}");
    }
    assert!(!qnames.contains(&"Id.Id") && !qnames.contains(&"Id.new"), "false ctor on Id: {qnames:?}");
    let named_sym = syms.iter().find(|s| s.qualified_name == "Id2.named").unwrap();
    assert_eq!(named_sym.kind, aice_lang_registry::SymbolKind::Method);
    let sl2 = slicer.slice_symbol(&tree, src, &SymbolSelector { name: "Id2.named".to_string(), ordinal: None }).unwrap();
    assert!(sl2.content.contains("Id2<T>.named(T v)"));
    let sl3 = slicer.slice_symbol(&tree, src, &SymbolSelector { name: "Id3.new".to_string(), ordinal: None }).unwrap();
    assert!(sl3.content.contains("Id3<T>.new(T v)"));
    let intra = slicer
        .slice_intra_block(&tree, src, &aice_lang_registry::IntraBlockSelector { symbol: "Id2.named".to_string(), pattern: "T v".to_string() })
        .unwrap();
    assert!(intra.content.contains("T v"));
    let sl4 = slicer.slice_symbol(&tree, src, &SymbolSelector { name: "Id4.named".to_string(), ordinal: None }).unwrap();
    assert!(sl4.content.contains("Id4<T>.named(T v)") && !sl4.content.contains("T get inner"), "Id4.named bled into body: {}", sl4.content);
}

#[test]
fn regression_iter19_deep_stacks_2mib() {
    std::thread::Builder::new()
        .name("r5_sym_2mib".into())
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let reg = EngineRegistry::new();
            let cases: &[(LanguageId, String, usize)] = &[
                (LanguageId::Rust, format!("{}fn f() {{}}{}", "mod m { ".repeat(4_500), " }".repeat(4_500)), 1),
                (LanguageId::JavaScript, format!("{}function f() {{}}{}", "if (1) { ".repeat(4_500), " }".repeat(4_500)), 1),
                (LanguageId::TypeScript, format!("{}const x = 1;{}", "namespace N { ".repeat(4_500), " }".repeat(4_500)), 4_500),
                (LanguageId::Ruby, format!("{}def f; 1; end{}", "module M; ".repeat(2_000), "; end".repeat(2_000)), 2_001),
                (LanguageId::Ruby, format!("x = {}1{}\n", "(".repeat(4_500), ")".repeat(4_500)), 0),
                (LanguageId::Php, format!("<?php {}function f() {{}}{}", "if (1) { ".repeat(4_500), " }".repeat(4_500)), 1),
                (LanguageId::Dart, format!("void f() {{ {}var x = 1;{} }}", "{".repeat(4_500), "}".repeat(4_500)), 1),
                (LanguageId::Css, format!("{}a{{color:red;}}{}", "@media all {".repeat(4_500), "}".repeat(4_500)), 4_501),
                (LanguageId::Json, format!("{}1{}", "{\"a\":".repeat(4_500), "}".repeat(4_500)), 4_500),
                (LanguageId::Cpp, format!("{}void f() {{}}{}", "namespace N { ".repeat(4_500), " }".repeat(4_500)), 4_501),
                (LanguageId::Bash, format!("{}true{}", "if true; then\n".repeat(4_500), "\nfi".repeat(4_500)), 0),
                (LanguageId::Java, format!("{}void f() {{}}{}", "class C { ".repeat(4_500), " }".repeat(4_500)), 4_501),
                (LanguageId::CSharp, format!("{}class C {{}}{}", "namespace N { ".repeat(4_500), " }".repeat(4_500)), 4_501),
            ];
            for (lang, src, min_syms) in cases {
                let adapter = reg.adapter(*lang).unwrap();
                let tree = adapter.parse_cst(src).unwrap();
                let syms = adapter.extract_symbols(&tree, src);
                assert!(syms.len() >= *min_syms, "{lang:?}: expected >= {min_syms} syms, got {}", syms.len());
                let _ = adapter.extract_dependencies(&tree, src);
            }
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn regression_wave3_f34_compact_json_outline_preserves_deep_symbol_slicing() {
    let reg = EngineRegistry::new();
    let adapter = reg.adapter(LanguageId::Json).unwrap();
    let slicer = reg.slicer(LanguageId::Json).unwrap();

    // 1. Nested 160+ line JSON Schema modeled after session_state.schema.json
    let mut schema = String::from(concat!(
        "{\n",
        "  \"$schema\": \"https://json-schema.org/draft/2020-12/schema\",\n",
        "  \"title\": \"AgentSessionStateCheckpoint\",\n",
        "  \"description\": \"Structured AI agent state checkpoint schema for context economics and compaction survival.\",\n",
        "  \"type\": \"object\",\n",
        "  \"required\": [\"session_id\", \"project_name\", \"tool_call_budget\"],\n",
        "  \"properties\": {\n",
    ));
    for i in 1..=18 {
        schema.push_str(&format!(
            "    \"field_{i}\": {{\n      \"type\": \"object\",\n      \"description\": \"Detailed description for field_{i} with long explanatory text.\",\n      \"properties\": {{\n        \"nested_a\": {{ \"type\": \"string\", \"description\": \"Inner value a for field_{i}.\" }},\n        \"nested_b\": {{ \"type\": \"integer\", \"minimum\": 0 }}\n      }}\n    }},\n"
        ));
    }
    schema.push_str(concat!(
        "    \"tool_call_budget\": {\n",
        "      \"type\": \"object\",\n",
        "      \"properties\": {\n",
        "        \"consumed\": { \"type\": \"integer\", \"minimum\": 0 },\n",
        "        \"remaining\": { \"type\": \"integer\", \"minimum\": 0 }\n",
        "      }\n",
        "    }\n",
        "  },\n",
        "  \"additionalProperties\": false\n",
        "}\n",
    ));
    assert!(schema.lines().count() >= 150, "schema lines={}", schema.lines().count());

    let tree = adapter.parse_cst(&schema).unwrap();
    assert!(!tree.has_error());

    // Compact default outline (depth == 0)
    let outline = slicer.outline(&tree, &schema, 0, true);
    assert!(!outline.entries.is_empty());
    let rendered: String = outline
        .entries
        .iter()
        .map(|e| match &e.signature {
            Some(sig) => format!("const {} # [L{}-L{}] : {sig}\n", e.name, e.start_line, e.end_line),
            None => format!("const {} # [L{}-L{}]\n", e.name, e.start_line, e.end_line),
        })
        .collect();
    assert!(
        rendered.len() * 3 < schema.len(),
        "JSON outline must be much smaller than raw JSON (outline={}B, raw={}B):\n{rendered}",
        rendered.len(),
        schema.len()
    );
    assert!(
        outline.entries.iter().any(|e| e.name == "properties")
            && outline.entries.iter().any(|e| e.name == "properties.tool_call_budget"),
        "expected top-level & level-2 container landmarks: {:?}",
        outline.entries.iter().map(|e| &e.name).collect::<Vec<_>>()
    );
    assert!(
        !outline.entries.iter().any(|e| e.name.contains("nested_a") || e.name.ends_with(".description")),
        "default JSON outline must not bloat with deep leaf dotted paths"
    );
    assert!(
        !rendered.contains("Detailed description for field_1"),
        "JSON outline must not echo full raw JSON scalar values"
    );

    // Deep dotted symbol slicing MUST remain 100% intact via extract_symbols()
    let deep = slicer
        .slice_symbol(
            &tree,
            &schema,
            &SymbolSelector { name: "properties.tool_call_budget.properties.consumed".to_string(), ordinal: None },
        )
        .expect("deep dotted JSON symbol slice must still succeed");
    assert!(deep.content.contains("\"consumed\""));

    // 2. package.json with 80 scalar dependencies stays ultra-compact in outline while scripts.build slices cleanly
    let mut pkg = String::from("{\n  \"name\": \"demo-app\",\n  \"version\": \"1.0.0\",\n  \"scripts\": {\n    \"build\": \"tsc\",\n    \"test\": \"vitest\"\n  },\n  \"dependencies\": {\n");
    for i in 1..=80 {
        let comma = if i < 80 { "," } else { "" };
        pkg.push_str(&format!("    \"dep-pkg-{i}\": \"^1.{i}.0\"{comma}\n"));
    }
    pkg.push_str("  }\n}\n");
    let pkg_tree = adapter.parse_cst(&pkg).unwrap();
    let pkg_outline = slicer.outline(&pkg_tree, &pkg, 0, true);
    assert_eq!(pkg_outline.entries.len(), 4, "only top-level keys expected for scalar-only dependencies: {:?}", pkg_outline.entries);
    let build_slice = slicer
        .slice_symbol(&pkg_tree, &pkg, &SymbolSelector { name: "scripts.build".to_string(), ordinal: None })
        .expect("scripts.build must still slice");
    assert!(build_slice.content.contains("\"tsc\""));
}