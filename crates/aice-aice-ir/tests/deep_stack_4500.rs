use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, LanguageId};

const DEPTH: usize = 4_500;

fn run_aice_roundtrip_on_2mib(lang: LanguageId, aice_src: String) {
    let builder = std::thread::Builder::new().stack_size(2 * 1024 * 1024);
    let handle = builder
        .spawn(move || {
            let transpiler = DefaultAiceTranspiler;
            let module = parse_aice(&aice_src).expect("parse_aice");
            let printed = print_aice(&module);
            assert!(!printed.is_empty(), "empty printed aice for {lang:?}");
            let native = transpiler.to_native(&module, lang).expect("to_native");
            assert!(!native.is_empty(), "empty native output for {lang:?}");
            let cloned = module.clone();
            drop(cloned);
            drop(module);
        })
        .expect("spawn 2MiB stack thread");
    handle.join().expect("2MiB thread panicked or overflowed stack");
}

fn run_pipeline_on_2mib(lang: LanguageId, src: String) {
    let builder = std::thread::Builder::new().stack_size(2 * 1024 * 1024);
    let handle = builder
        .spawn(move || {
            let reg = EngineRegistry::default();
            let tree = reg.adapter(lang).unwrap().parse_cst(&src).expect("parse_cst");
            let has_err = match &tree {
                aice_lang_registry::ParsedTree::TreeSitter { tree: t, .. } => t.lock().unwrap().root_node().has_error(),
                _ => false,
            };
            let transpiler = DefaultAiceTranspiler;
            let outcome = transpiler
                .to_aice(&tree, &src, &TranspileOpts::default())
                .expect("to_aice");
            let module = match outcome {
                TranspileOutcome::Transpiled(m) => m,
                TranspileOutcome::UnsupportedPassthrough { raw_text, .. } => {
                    panic!("unexpected passthrough for {lang:?}: {} bytes", raw_text.len())
                }
            };
            let aice = print_aice(&module);
            assert!(!aice.is_empty(), "empty aice output for {lang:?}");
            let reparsed = parse_aice(&aice).expect("parse_aice");
            let native = transpiler.to_native(&reparsed, lang).expect("to_native");
            assert!(
                !native.is_empty(),
                "empty native output for {lang:?} (cst_err={has_err}, items={}, reparsed_items={}, aice_head={:?})",
                module.items.len(),
                reparsed.items.len(),
                aice.lines().take(5).collect::<Vec<_>>()
            );
            let cloned = module.clone();
            drop(cloned);
            drop(module);
            let cloned_reparsed = reparsed.clone();
            drop(cloned_reparsed);
            drop(reparsed);
        })
        .expect("spawn 2MiB stack thread");
    handle.join().expect("2MiB thread panicked or overflowed stack");
}

#[test]
fn deep_4500_typescript_if_closures_and_expr_on_2mib_stack() {
    let mut ts_if = String::from("export function deep(x: number): number {\n");
    for _ in 0..DEPTH {
        ts_if.push_str("if (x > 0) {\n");
    }
    ts_if.push_str("return x;\n");
    for _ in 0..DEPTH {
        ts_if.push_str("}\n");
    }
    ts_if.push_str("return 0;\n}\n");
    run_pipeline_on_2mib(LanguageId::TypeScript, ts_if);

    let mut ts_expr = String::from("export const exprDeep = ");
    for _ in 0..DEPTH {
        ts_expr.push('(');
    }
    ts_expr.push('1');
    for _ in 0..DEPTH {
        ts_expr.push_str(" + 1)");
    }
    ts_expr.push_str(";\n");
    run_pipeline_on_2mib(LanguageId::TypeScript, ts_expr);

    let mut ts_clos = String::from("export const closDeep = ");
    for _ in 0..DEPTH {
        ts_clos.push_str("() => ");
    }
    ts_clos.push_str("42;\n");
    run_pipeline_on_2mib(LanguageId::TypeScript, ts_clos);
}

#[test]
fn deep_4500_js_python_rust_on_2mib_stack() {
    let mut js = String::from("export function deep(x) {\n");
    for _ in 0..DEPTH {
        js.push_str("if (x) {\n");
    }
    js.push_str("return 1;\n");
    for _ in 0..DEPTH {
        js.push_str("}\n");
    }
    js.push_str("}\n");
    run_pipeline_on_2mib(LanguageId::JavaScript, js);

    let mut py = String::from("def deep(x):\n    return ");
    for _ in 0..DEPTH {
        py.push('(');
    }
    py.push('1');
    for _ in 0..DEPTH {
        py.push_str(" + 1)");
    }
    py.push('\n');
    run_pipeline_on_2mib(LanguageId::Python, py);

    let mut py_aice = String::from("module python\nfn deep(x):\n");
    for d in 1..=DEPTH {
        py_aice.push_str(&"  ".repeat(d));
        py_aice.push_str("if x:\n");
    }
    py_aice.push_str(&"  ".repeat(DEPTH + 1));
    py_aice.push_str("ret 1\n");
    run_aice_roundtrip_on_2mib(LanguageId::Python, py_aice);

    let mut rs = String::from("pub fn deep(x: i64) -> i64 {\n");
    for _ in 0..DEPTH {
        rs.push_str("if x > 0 {\n");
    }
    rs.push_str("return 1;\n");
    for _ in 0..DEPTH {
        rs.push_str("}\n");
    }
    rs.push_str("0\n}\n");
    run_pipeline_on_2mib(LanguageId::Rust, rs);
}

#[test]
fn deep_4500_twig_json_xml_html_css_yaml_on_2mib_stack() {
    let mut twig = String::new();
    for _ in 0..DEPTH {
        twig.push_str("{% if flag %}<div>");
    }
    twig.push_str("ok");
    for _ in 0..DEPTH {
        twig.push_str("</div>{% endif %}");
    }
    run_pipeline_on_2mib(LanguageId::Twig, twig);

    let mut json = String::new();
    for _ in 0..DEPTH {
        json.push_str("{\"a\":");
    }
    json.push('1');
    for _ in 0..DEPTH {
        json.push('}');
    }
    run_pipeline_on_2mib(LanguageId::Json, json);

    let mut xml_aice = String::from("module xml\ndata xml:\n");
    for d in 1..=DEPTH {
        xml_aice.push_str(&"  ".repeat(d));
        xml_aice.push_str("xml a:\n");
    }
    xml_aice.push_str(&"  ".repeat(DEPTH + 1));
    xml_aice.push_str("xml leaf: \"x\"\n");
    run_aice_roundtrip_on_2mib(LanguageId::Xml, xml_aice);

    let mut html_aice = String::from("module html\npub component Deep:\n");
    for d in 1..=DEPTH {
        html_aice.push_str(&"  ".repeat(d));
        html_aice.push_str("div:\n");
    }
    html_aice.push_str(&"  ".repeat(DEPTH + 1));
    html_aice.push_str("span: \"ok\"\n");
    run_aice_roundtrip_on_2mib(LanguageId::Html, html_aice);

    let mut css = String::new();
    for i in 0..DEPTH {
        css.push_str(&format!(".c{i} {{ "));
    }
    css.push_str("color: red;");
    for _ in 0..DEPTH {
        css.push_str(" }");
    }
    run_pipeline_on_2mib(LanguageId::Css, css);

    let mut yaml_aice = String::from("module yaml\ndata yaml:\n");
    for d in 1..=DEPTH {
        yaml_aice.push_str(&"  ".repeat(d));
        yaml_aice.push_str("a:\n");
    }
    yaml_aice.push_str(&"  ".repeat(DEPTH + 1));
    yaml_aice.push_str("v: 1\n");
    run_aice_roundtrip_on_2mib(LanguageId::Yaml, yaml_aice);
}

#[test]
fn deep_4500_sql_dialects_on_2mib_stack() {
    let mut tsql = String::from("CREATE PROCEDURE dbo.deep_proc AS\nBEGIN\n");
    for _ in 0..DEPTH {
        tsql.push_str("BEGIN\n");
    }
    tsql.push_str("SELECT 1;\n");
    for _ in 0..DEPTH {
        tsql.push_str("END\n");
    }
    tsql.push_str("END;\n");
    run_pipeline_on_2mib(LanguageId::TSql, tsql);

    let mut pgsql = String::from("SELECT ");
    for _ in 0..DEPTH {
        pgsql.push('(');
    }
    pgsql.push('1');
    for _ in 0..DEPTH {
        pgsql.push_str(" + 1)");
    }
    pgsql.push_str(";\n");
    run_pipeline_on_2mib(LanguageId::PostgreSql, pgsql);
}

#[test]
fn deep_4500_c_style_for_and_continue_on_2mib_stack() {
    let mut ts_for = String::from("export function deepFor(n: number): number {\nlet acc = 0;\n");
    for _ in 0..DEPTH {
        ts_for.push_str("for (let i = 0; i < 1; i++) {\n");
    }
    ts_for.push_str("acc += 1;\n");
    for _ in 0..DEPTH {
        ts_for.push_str("}\n");
    }
    ts_for.push_str("return acc;\n}\n");
    run_pipeline_on_2mib(LanguageId::TypeScript, ts_for);

    let mut ts_cont = String::from(
        "export function deepCont(n: number): number {\nlet acc = 0;\nfor (let i = 0; i < n; i++) {\n",
    );
    for _ in 0..DEPTH {
        ts_cont.push_str("if (i > 0) {\n");
    }
    ts_cont.push_str("continue;\n");
    for _ in 0..DEPTH {
        ts_cont.push_str("}\n");
    }
    ts_cont.push_str("acc += i;\n}\nreturn acc;\n}\n");
    let builder = std::thread::Builder::new().stack_size(2 * 1024 * 1024);
    builder
        .spawn(move || {
            let reg = EngineRegistry::default();
            let tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(&ts_cont).expect("parse");
            let transpiler = DefaultAiceTranspiler;
            let TranspileOutcome::Transpiled(m) = transpiler
                .to_aice(&tree, &ts_cont, &TranspileOpts::default())
                .expect("to_aice")
            else {
                panic!("expected Transpiled");
            };
            let aice = print_aice(&m);
            assert!(aice.contains("while i < n:"));
            assert!(aice.matches("i++").count() >= 2);
            assert!(!aice.contains("for item in"));
            let reparsed = parse_aice(&aice).expect("parse_aice");
            let native = transpiler.to_native(&reparsed, LanguageId::TypeScript).expect("to_native");
            assert!(!native.is_empty());
        })
        .expect("spawn")
        .join()
        .expect("2MiB deep continue failed");
}
