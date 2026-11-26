use std::fs;
use std::path::Path;

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_ast_engine::dep_graph::{
    FileDepInput, expand_dependency_closure, find_workspace_callers, order_files_topologically,
    sort_by_dependency,
};
use aice_ast_engine::dep_resolve::{
    ResolveOutcome, WorkspaceIndex, normalize_rel_path, resolve_dep_edge,
};
use aice_lang_registry::{
    AdapterLookup, DepEdge, DepKind, FirewallVerdict, LanguageId, SyntaxFirewall,
};

fn parse_input(reg: &EngineRegistry, path: &str, lang: LanguageId, src: &str) -> FileDepInput {
    let adp = reg.adapter(lang).unwrap();
    let tree = adp.parse_cst(src).unwrap();
    FileDepInput {
        path: path.to_string(),
        lang,
        symbols: adp.extract_symbols(&tree, src),
        edges: adp.extract_dependencies(&tree, src),
    }
}

fn verify_and_parse(
    reg: &EngineRegistry,
    fw: &DefaultSyntaxFirewall,
    path: &str,
    lang: LanguageId,
    src: &str,
) -> FileDepInput {
    assert_eq!(
        fw.verify(src, Path::new(path), lang),
        FirewallVerdict::Valid,
        "firewall rejected fixture {path}:\n{src}"
    );
    parse_input(reg, path, lang, src)
}

#[test]
fn r5_scoped_typeref_call_schema_comment_and_import_preservation() {
    let reg = EngineRegistry::new();

    // TS: scoped TypeRef, Call, // schema:, and Import
    let ts_src = "// schema: ../prisma/schema.prisma\nimport { Calc } from './calc.js';\nexport class Service {\n  run(c: Calc): number { return c.add(1, 2); }\n}\n";
    let ts_in = parse_input(&reg, "src/service.ts", LanguageId::TypeScript, ts_src);
    assert!(ts_in.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "../prisma/schema.prisma"));
    assert!(ts_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./calc.js"));
    assert!(ts_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.source == "Service.run" && e.target == "Calc"));
    assert!(ts_in.edges.iter().any(|e| e.kind == DepKind::Call && e.source == "Service.run" && e.target == "c.add"));
    assert!(!ts_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.target == "number"));

    // Rust: mod sub;, scoped TypeRef/Call, no self-TypeRef on struct Engine
    let rs_src = "mod sub;\nuse crate::types::Cfg;\nstruct Engine { cfg: Cfg }\nimpl Engine {\n  fn step(&self, cfg: Cfg) { helper(cfg); }\n}\n";
    let rs_in = parse_input(&reg, "src/engine.rs", LanguageId::Rust, rs_src);
    assert!(rs_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "mod:sub"));
    assert!(rs_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "crate::types::Cfg"));
    assert!(rs_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.source == "Engine::step" && e.target == "Cfg"));
    assert!(rs_in.edges.iter().any(|e| e.kind == DepKind::Call && e.source == "Engine::step" && e.target == "helper"));
    assert!(!rs_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.source == "Engine" && e.target == "Engine"));
}

#[test]
fn r6_mysql_sqlite_migration_schema_deps() {
    let reg = EngineRegistry::new();
    let my = parse_input(&reg, "db/m.sql", LanguageId::MySql, "SELECT * FROM accounts JOIN ledger ON accounts.id = ledger.acc_id;");
    assert!(my.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "accounts"));
    assert!(my.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "ledger"));

    let sq = parse_input(&reg, "db/s.sql", LanguageId::Sqlite, "UPDATE balances SET amt = 0 WHERE id = 1;");
    assert!(sq.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "balances"));

    let mig = parse_input(&reg, "db/V1.sql", LanguageId::DbMigration, "-- +goose Up\nINSERT INTO audit_log VALUES (1);\n");
    assert!(mig.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "audit_log"));
}

#[test]
fn dep_resolve_ts_python_rust_containment_and_misses() {
    let reg = EngineRegistry::new();
    let root = Path::new("/virtual/ws");
    let files = vec![
        parse_input(&reg, "src/app.ts", LanguageId::TypeScript, "import { x } from './math.js';\nimport 'react';\nimport './missing.js';\nimport '../../etc/passwd';\n"),
        parse_input(&reg, "src/math.ts", LanguageId::TypeScript, "export const x = 1;"),
        parse_input(&reg, "src/ui/index.tsx", LanguageId::Tsx, "export const Ui = () => <div/>;"),
        parse_input(&reg, "src/main.rs", LanguageId::Rust, "mod sub;\nuse crate::math::Calc;\nuse std::io;\n"),
        parse_input(&reg, "src/sub.rs", LanguageId::Rust, "pub fn hi() {}"),
        parse_input(&reg, "src/math.rs", LanguageId::Rust, "pub struct Calc;"),
        parse_input(&reg, "pkg/a.py", LanguageId::Python, "from .b import fn_b\nimport os\n"),
        parse_input(&reg, "pkg/b.py", LanguageId::Python, "def fn_b(): pass\n"),
    ];
    let idx = WorkspaceIndex::build(&files, root);

    let r_ts = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "./math.js".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_ts, ResolveOutcome::WorkspaceFile("src/math.ts".into()));

    let r_idx = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "./ui".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_idx, ResolveOutcome::WorkspaceFile("src/ui/index.tsx".into()));

    let r_ext = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "react".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_ext, ResolveOutcome::ExternalPackage);

    let r_miss = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "./missing.js".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_miss, ResolveOutcome::MissingLocal);

    let r_esc = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "../../etc/passwd".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_esc, ResolveOutcome::MissingLocal);

    let r_self = resolve_dep_edge(0, &files[0], &DepEdge { source: "module".into(), target: "./app.ts".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_self, ResolveOutcome::SelfReference);

    let r_mod = resolve_dep_edge(3, &files[3], &DepEdge { source: "crate".into(), target: "mod:sub".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_mod, ResolveOutcome::WorkspaceFile("src/sub.rs".into()));

    let r_py = resolve_dep_edge(6, &files[6], &DepEdge { source: "module".into(), target: ".b".into(), kind: DepKind::Import }, &idx, root);
    assert_eq!(r_py, ResolveOutcome::WorkspaceFile("pkg/b.py".into()));
}

#[test]
fn dep_graph_topo_sort_diamonds_cycles_schemas_and_closures() {
    let reg = EngineRegistry::new();
    let root = Path::new("/virtual/ws");

    // Empty edges preserves order; dependency precedes dependent
    let basic = sort_by_dependency(
        vec!["app".into(), "svc".into(), "base".into()],
        &[
            DepEdge { source: "app".into(), target: "svc".into(), kind: DepKind::Import },
            DepEdge { source: "svc".into(), target: "base".into(), kind: DepKind::Import },
        ],
    );
    assert_eq!(basic, vec!["base", "svc", "app"]);

    // T1-F08-03 + T1-F08-04: prisma schema + 4-tier chain
    let files = vec![
        parse_input(&reg, "src/handler.spec.ts", LanguageId::TypeScript, "import { handle } from './handler.js';\nexport function spec() { handle(); }\n"),
        parse_input(&reg, "src/handler.ts", LanguageId::TypeScript, "import { svc } from './service.js';\nexport function handle() { svc(); }\n"),
        parse_input(&reg, "src/service.ts", LanguageId::TypeScript, "// schema: ../prisma/schema.prisma\nimport { Req } from './types.js';\nexport function svc(r: Req) {}\n"),
        parse_input(&reg, "src/types.ts", LanguageId::TypeScript, "export interface Req { id: number }\n"),
        parse_input(&reg, "prisma/schema.prisma", LanguageId::Prisma, "model Account { id Int @id }\n"),
    ];
    let ord = order_files_topologically(&files, root);
    let pos = |p: &str| ord.iter().position(|x| x == p).unwrap();
    assert!(pos("prisma/schema.prisma") < pos("src/service.ts"));
    assert!(pos("src/types.ts") < pos("src/service.ts"));
    assert!(pos("src/service.ts") < pos("src/handler.ts"));
    assert!(pos("src/handler.ts") < pos("src/handler.spec.ts"));

    // T2-F08-04: -d 0 vs -d 1 vs -d 3
    let d0 = expand_dependency_closure(&["src/handler.spec.ts".into()], 0, &files, root);
    assert_eq!(d0, vec!["src/handler.spec.ts"]);
    let d1 = expand_dependency_closure(&["src/handler.spec.ts".into()], 1, &files, root);
    assert_eq!(d1, vec!["src/handler.ts", "src/handler.spec.ts"]);
    let d3 = expand_dependency_closure(&["src/handler.spec.ts".into()], 3, &files, root);
    assert_eq!(d3.len(), 5);

    // T2-F08-01: cycle single emission + T2-F08-03: diamond deduplication
    let cyc_diamond = vec![
        parse_input(&reg, "src/cycle_a.ts", LanguageId::TypeScript, "import { pingB } from './cycle_b.js';\nexport function pingA() { pingB(); }\n"),
        parse_input(&reg, "src/cycle_b.ts", LanguageId::TypeScript, "import { pingA } from './cycle_a.js';\nexport function pingB() { pingA(); }\n"),
        parse_input(&reg, "src/d_top.ts", LanguageId::TypeScript, "import './b_left.js';\nimport './c_right.js';\nimport './a_base.js';\n"),
        parse_input(&reg, "src/b_left.ts", LanguageId::TypeScript, "import './a_base.js';\n"),
        parse_input(&reg, "src/c_right.ts", LanguageId::TypeScript, "import './a_base.js';\n"),
        parse_input(&reg, "src/a_base.ts", LanguageId::TypeScript, "export const BASE = 1;\n"),
    ];
    let cd_ord = order_files_topologically(&cyc_diamond, root);
    assert_eq!(cd_ord.iter().filter(|x| *x == "src/cycle_a.ts").count(), 1);
    assert_eq!(cd_ord.iter().filter(|x| *x == "src/a_base.ts").count(), 1);
    let cpos = |p: &str| cd_ord.iter().position(|x| x == p).unwrap();
    assert!(cpos("src/a_base.ts") < cpos("src/b_left.ts"));
    assert!(cpos("src/a_base.ts") < cpos("src/c_right.ts"));
    assert!(cpos("src/b_left.ts") < cpos("src/d_top.ts"));
    assert!(cpos("src/c_right.ts") < cpos("src/d_top.ts"));
}

#[test]
fn find_workspace_callers_disk_and_virtual() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_dep_callers_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    let h_src = "export function handleTransfer(id: number) { return id; }\n";
    let s_src = "import { handleTransfer } from './handler.js';\nexport function verifySpec() {\n  return handleTransfer(42);\n}\n";
    let u_src = "export function unrelated() { return 0; }\n";
    fs::write(dir.join("src/handler.ts"), h_src).unwrap();
    fs::write(dir.join("src/handler.spec.ts"), s_src).unwrap();
    fs::write(dir.join("src/unrelated.ts"), u_src).unwrap();

    let ws = vec![
        parse_input(&reg, "src/handler.ts", LanguageId::TypeScript, h_src),
        parse_input(&reg, "src/handler.spec.ts", LanguageId::TypeScript, s_src),
        parse_input(&reg, "src/unrelated.ts", LanguageId::TypeScript, u_src),
    ];
    let hits = find_workspace_callers("src/handler.ts", Some("handleTransfer"), &ws, &dir);
    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].caller_path, "src/handler.spec.ts");
    assert_eq!(hits[0].imported_symbols, vec!["handleTransfer"]);
    assert_eq!(hits[0].call_lines, vec![3]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn deep_4500_node_chain_and_cycle_on_2mib_stack() {
    std::thread::Builder::new()
        .name("dep_graph_2mib".into())
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let n = 4_500usize;
            let items: Vec<String> = (0..n).map(|i| format!("n{i}")).collect();
            let mut chain_edges = Vec::with_capacity(n);
            for i in 1..n {
                chain_edges.push(DepEdge {
                    source: format!("n{i}"),
                    target: format!("n{}", i - 1),
                    kind: DepKind::Import,
                });
            }
            let sorted = sort_by_dependency(items.clone(), &chain_edges);
            assert_eq!(sorted.len(), n);
            assert_eq!(sorted[0], "n0");
            assert_eq!(sorted[n - 1], format!("n{}", n - 1));

            let mut cyc_edges = chain_edges;
            cyc_edges.push(DepEdge { source: "n0".into(), target: format!("n{}", n - 1), kind: DepKind::Import });
            let cyc_sorted = sort_by_dependency(items, &cyc_edges);
            assert_eq!(cyc_sorted.len(), n);
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn regression_w3m2_callers_python_types_utf8_and_abs_norm() {
    let reg = EngineRegistry::new();

    // 1. Virtual find_workspace_callers excludes files that import target module but only call other symbols
    let v_root = Path::new("/virtual/ws");
    let v_ws = vec![
        parse_input(&reg, "src/math.ts", LanguageId::TypeScript, "export function foo() {}\nexport function bar() {}\n"),
        parse_input(&reg, "src/calls_foo.ts", LanguageId::TypeScript, "import { foo } from './math.js';\nexport function run() { return foo(); }\n"),
        parse_input(&reg, "src/only_bar.ts", LanguageId::TypeScript, "import { bar } from './math.js';\nexport function run() { return bar(); }\n"),
    ];
    let v_hits = find_workspace_callers("src/math.ts", Some("foo"), &v_ws, v_root);
    assert_eq!(v_hits.len(), 1, "expected only calls_foo.ts, got {v_hits:?}");
    assert_eq!(v_hits[0].caller_path, "src/calls_foo.ts");

    // 2. Disk callers: multi-line TS, comments, Python from-import, Rust multi-line use, UTF-8 élan/élan_v2
    let dir = std::env::temp_dir().join(format!("aice_w3m2_callers_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    let files_disk: &[(&str, LanguageId, &str)] = &[
        ("src/math.ts", LanguageId::TypeScript, "export function foo() { return 1; }\nexport function bar() { return 2; }\nexport function élan() { return 3; }\n"),
        ("src/real_foo.ts", LanguageId::TypeScript, "import { foo } from './math.js';\nexport function run() { return foo(); }\n"),
        ("src/multi_bar.ts", LanguageId::TypeScript, "import {\n  bar,\n} from './math.js';\nexport function run() { return bar(); }\n"),
        ("src/comment_foo.ts", LanguageId::TypeScript, "import { bar } from './math.js';\n// foo was replaced by bar\nexport function run() { return bar(); }\n"),
        ("src/side_comment.ts", LanguageId::TypeScript, "import './math.js';\n// foo in comment only\nexport function run() { return 0; }\n"),
        ("src/utf8_elan_prefix.ts", LanguageId::TypeScript, "import * as m from './math.js';\nexport function run() { return élan_v2(); }\n"),
        ("src/utf8_elan_hit.ts", LanguageId::TypeScript, "import { élan } from './math.js';\nexport function run() { return élan_v2() + élan(); }\n"),
        ("src/py_mod.py", LanguageId::Python, "def foo():\n    return 1\ndef bar():\n    return 2\n"),
        ("src/py_foo.py", LanguageId::Python, "from .py_mod import foo\ndef run():\n    return foo()\n"),
        ("src/py_bar.py", LanguageId::Python, "from .py_mod import (\n    bar,\n)\ndef run():\n    return bar()\n"),
        ("src/rs_math.rs", LanguageId::Rust, "pub fn foo() {}\npub fn bar() {}\n"),
        ("src/rs_bar.rs", LanguageId::Rust, "use crate::rs_math::{\n    bar,\n};\npub fn run() { bar(); }\n"),
        ("src/rs_foo.rs", LanguageId::Rust, "use crate::rs_math::foo;\npub fn run() { foo(); }\n"),
    ];
    let mut d_ws = Vec::new();
    for (p, lang, src) in files_disk {
        fs::write(dir.join(p), src).unwrap();
        d_ws.push(parse_input(&reg, p, *lang, src));
    }

    let ts_hits = find_workspace_callers("src/math.ts", Some("foo"), &d_ws, &dir);
    let ts_paths: Vec<&str> = ts_hits.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(ts_paths, vec!["src/real_foo.ts"], "unexpected TS callers: {ts_hits:?}");

    let elan_hits = find_workspace_callers("src/math.ts", Some("élan"), &d_ws, &dir);
    let elan_paths: Vec<&str> = elan_hits.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(elan_paths, vec!["src/utf8_elan_hit.ts"], "unexpected UTF-8 callers: {elan_hits:?}");

    let py_hits = find_workspace_callers("src/py_mod.py", Some("foo"), &d_ws, &dir);
    let py_paths: Vec<&str> = py_hits.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(py_paths, vec!["src/py_foo.py"], "unexpected Python callers: {py_hits:?}");

    let rs_hits = find_workspace_callers("src/rs_math.rs", Some("foo"), &d_ws, &dir);
    let rs_paths: Vec<&str> = rs_hits.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(rs_paths, vec!["src/rs_foo.rs"], "unexpected Rust callers: {rs_hits:?}");
    let _ = fs::remove_dir_all(&dir);

    // 3. Python parameter/return/assignment TypeRef extraction
    let py_src = "class Service:\n    def run(self, req: Req, opt: Opt = None) -> Resp:\n        local: LocalTy = req\n        return helper(local)\n";
    let py_in = parse_input(&reg, "src/svc.py", LanguageId::Python, py_src);
    for expected in ["Req", "Opt", "Resp", "LocalTy"] {
        assert!(
            py_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.target == expected),
            "missing Python TypeRef {expected} in {:?}",
            py_in.edges
        );
    }

    // 4. Out-of-root absolute path must not collapse into workspace-relative "etc/passwd"
    let norm_abs = normalize_rel_path("/etc/passwd", Path::new("/tmp/some_ws"), None);
    assert_ne!(norm_abs, "etc/passwd");
    assert_eq!(norm_abs, "/etc/passwd");
}

#[test]
fn regression_w3m2_r3_reexports_kotlin_csharp_php_and_caller_scanning() {
    let reg = EngineRegistry::new();

    // 1. TS & JS re-exports emit DepKind::Import
    for lang in [LanguageId::TypeScript, LanguageId::JavaScript] {
        let re_src = "export { foo } from './math.js';\nexport * from './util.js';\n";
        let re_in = parse_input(&reg, "src/barrel.ts", lang, re_src);
        assert!(
            re_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./math.js"),
            "{lang:?} missing named re-export Import: {:?}",
            re_in.edges
        );
        assert!(
            re_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./util.js"),
            "{lang:?} missing star re-export Import: {:?}",
            re_in.edges
        );
    }

    // 2. Kotlin import, user_type TypeRef, and call_expression Call + JVM resolution
    let kt_src = "package com.example.svc\nimport com.example.models.User\nclass Svc {\n    fun run(u: User): Resp { return helper(u) }\n}\n";
    let kt_user = "package com.example.models\nclass User\n";
    let kt_in = parse_input(&reg, "src/main/kotlin/com/example/svc/Svc.kt", LanguageId::Kotlin, kt_src);
    assert!(kt_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "com.example.models.User"), "{:?}", kt_in.edges);
    assert!(kt_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.source == "Svc.run" && e.target == "User"), "{:?}", kt_in.edges);
    assert!(kt_in.edges.iter().any(|e| e.kind == DepKind::TypeRef && e.source == "Svc.run" && e.target == "Resp"), "{:?}", kt_in.edges);
    assert!(kt_in.edges.iter().any(|e| e.kind == DepKind::Call && e.source == "Svc.run" && e.target == "helper"), "{:?}", kt_in.edges);
    let kt_ws = vec![
        kt_in.clone(),
        parse_input(&reg, "src/main/kotlin/com/example/models/User.kt", LanguageId::Kotlin, kt_user),
    ];
    let kt_idx = WorkspaceIndex::build(&kt_ws, Path::new("/virtual/ws"));
    assert_eq!(
        resolve_dep_edge(0, &kt_ws[0], &DepEdge { source: "kotlin".into(), target: "com.example.models.User".into(), kind: DepKind::Import }, &kt_idx, Path::new("/virtual/ws")),
        ResolveOutcome::WorkspaceFile("src/main/kotlin/com/example/models/User.kt".into())
    );

    // 3. C# using_directive Import + resolution
    let cs_src = "using MyApp.Models;\nnamespace MyApp.Svc { public class Svc { public Resp Run(User u) => new Resp(); } }\n";
    let cs_models = "namespace MyApp.Models { public class User {} }\n";
    let cs_in = parse_input(&reg, "src/Svc.cs", LanguageId::CSharp, cs_src);
    assert!(cs_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "MyApp.Models"), "{:?}", cs_in.edges);
    let cs_ws = vec![cs_in, parse_input(&reg, "src/Models.cs", LanguageId::CSharp, cs_models)];
    let cs_idx = WorkspaceIndex::build(&cs_ws, Path::new("/virtual/ws"));
    assert_eq!(
        resolve_dep_edge(0, &cs_ws[0], &DepEdge { source: "assembly".into(), target: "MyApp.Models".into(), kind: DepKind::Import }, &cs_idx, Path::new("/virtual/ws")),
        ResolveOutcome::WorkspaceFile("src/Models.cs".into())
    );

    // 4. PHP require / require_once / include / include_once + disk resolution
    let php_dir = std::env::temp_dir().join(format!("aice_w3m2_php_{}", std::process::id()));
    let _ = fs::remove_dir_all(&php_dir);
    fs::create_dir_all(php_dir.join("src")).unwrap();
    let php_main = "<?php\nrequire 'helper.php';\nrequire_once 'helper2.php';\ninclude 'helper3.php';\ninclude_once './helper4.php';\n";
    for f in ["src/helper.php", "src/helper2.php", "src/helper3.php", "src/helper4.php"] {
        fs::write(php_dir.join(f), "<?php\nfunction h() {}\n").unwrap();
    }
    fs::write(php_dir.join("src/main.php"), php_main).unwrap();
    let php_in = parse_input(&reg, "src/main.php", LanguageId::Php, php_main);
    for req in ["helper.php", "helper2.php", "helper3.php", "./helper4.php"] {
        assert!(
            php_in.edges.iter().any(|e| e.kind == DepKind::Import && e.target == req),
            "PHP missing Import {req:?}: {:?}",
            php_in.edges
        );
    }
    let php_ws = vec![php_in];
    let php_idx = WorkspaceIndex::build(&php_ws, &php_dir);
    for (spec, expected) in [
        ("helper.php", "src/helper.php"),
        ("helper2.php", "src/helper2.php"),
        ("helper3.php", "src/helper3.php"),
        ("./helper4.php", "src/helper4.php"),
    ] {
        assert_eq!(
            resolve_dep_edge(0, &php_ws[0], &DepEdge { source: "php".into(), target: spec.into(), kind: DepKind::Import }, &php_idx, &php_dir),
            ResolveOutcome::WorkspaceFile(expected.into())
        );
    }
    let _ = fs::remove_dir_all(&php_dir);

    // 5. Caller scan: string literals, multi-line `...` / """...""" / r#"..."#, aliases, wildcards
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r3_callers_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();
    let files_disk: &[(&str, LanguageId, &str)] = &[
        ("src/math.ts", LanguageId::TypeScript, "export function foo() { return 1; }\nexport function bar() { return 2; }\n"),
        ("src/url_str.ts", LanguageId::TypeScript, "import * as m from './math.js';\nexport function run() { const u = \"http://example.com/foo\"; return m.bar(); }\n"),
        ("src/tpl_multi.ts", LanguageId::TypeScript, "import * as m from './math.js';\nexport function run() {\n  const u = `line1\n/*\n`; return m.foo();\n}\n"),
        ("src/alias_foo.ts", LanguageId::TypeScript, "import { foo as myFoo } from './math.js';\nexport function run() { return myFoo(); }\n"),
        ("src/wild_foo.ts", LanguageId::TypeScript, "import * as math from './math.js';\nexport function run() { return math.foo(); }\n"),
        ("src/py_mod.py", LanguageId::Python, "def foo():\n    return 1\ndef bar():\n    return 2\n"),
        ("src/py_doc.py", LanguageId::Python, "from .py_mod import *\n\"\"\"doc\n# mention foo here\nfoo()\n\"\"\"\ndef run():\n    return bar()\n"),
        ("src/py_alias.py", LanguageId::Python, "from .py_mod import foo as my_foo\ndef run():\n    return my_foo()\n"),
        ("src/py_wild.py", LanguageId::Python, "from .py_mod import *\ndef run():\n    return foo()\n"),
        ("src/rs_math.rs", LanguageId::Rust, "pub fn foo() {}\npub fn bar() {}\n"),
        ("src/rs_raw.rs", LanguageId::Rust, "use crate::rs_math::foo;\npub fn run() { let s = r#\"a \" // b\"#; foo(); }\n"),
        ("src/rs_raw_multi.rs", LanguageId::Rust, "use crate::rs_math::*;\npub fn run() {\n  let s = r##\"\n  foo();\n\"##;\n  bar();\n}\n"),
        ("src/rs_alias.rs", LanguageId::Rust, "use crate::rs_math::foo as my_foo;\npub fn run() { my_foo(); }\n"),
    ];
    let mut ws = Vec::new();
    for (p, lang, src) in files_disk {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, *lang, src));
    }

    let ts_foo = find_workspace_callers("src/math.ts", Some("foo"), &ws, &dir);
    let ts_foo_paths: Vec<&str> = ts_foo.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(ts_foo_paths, vec!["src/alias_foo.ts", "src/tpl_multi.ts", "src/wild_foo.ts"], "{ts_foo:?}");
    assert_eq!(ts_foo[0].imported_symbols, vec!["foo"]);
    assert_eq!(ts_foo[0].call_lines, vec![2]);
    assert_eq!(ts_foo[1].call_lines, vec![5]);
    assert_eq!(ts_foo[2].call_lines, vec![2]);

    let ts_any = find_workspace_callers("src/math.ts", None, &ws, &dir);
    let wild_hit = ts_any.iter().find(|h| h.caller_path == "src/wild_foo.ts").unwrap();
    assert_eq!(wild_hit.imported_symbols, vec!["*"]);
    assert_eq!(wild_hit.call_lines, vec![2]);
    let alias_hit = ts_any.iter().find(|h| h.caller_path == "src/alias_foo.ts").unwrap();
    assert_eq!(alias_hit.imported_symbols, vec!["foo"]);
    assert_eq!(alias_hit.call_lines, vec![2]);

    let py_foo = find_workspace_callers("src/py_mod.py", Some("foo"), &ws, &dir);
    let py_foo_paths: Vec<&str> = py_foo.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(py_foo_paths, vec!["src/py_alias.py", "src/py_wild.py"], "{py_foo:?}");
    assert_eq!(py_foo[0].call_lines, vec![3]);
    let py_any = find_workspace_callers("src/py_mod.py", None, &ws, &dir);
    let py_wild_hit = py_any.iter().find(|h| h.caller_path == "src/py_wild.py").unwrap();
    assert_eq!(py_wild_hit.call_lines, vec![3]);

    let rs_foo = find_workspace_callers("src/rs_math.rs", Some("foo"), &ws, &dir);
    let rs_foo_paths: Vec<&str> = rs_foo.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(rs_foo_paths, vec!["src/rs_alias.rs", "src/rs_raw.rs"], "{rs_foo:?}");
    assert_eq!(rs_foo[0].call_lines, vec![2]);
    assert_eq!(rs_foo[1].call_lines, vec![2]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r4_sql_references_alter_and_topo_order() {
    let reg = EngineRegistry::new();
    let root = Path::new("/virtual/ws");

    let s_inline = "CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id));\n";
    let s_qual = "CREATE TABLE orders_q (id INT PRIMARY KEY, user_id INT REFERENCES public.users(id));\n";
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::TSql] {
        let e1 = parse_input(&reg, "db/o1.sql", lang, s_inline);
        assert!(e1.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "users"), "{lang:?}: {:?}", e1.edges);
        let e2 = parse_input(&reg, "db/o2.sql", lang, s_qual);
        assert!(e2.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "public.users"), "{lang:?}: {:?}", e2.edges);
    }

    let tsql_bracket = "CREATE TABLE dbo.Orders (id INT PRIMARY KEY, user_id INT REFERENCES [dbo].[Users](id));\n";
    let tb = parse_input(&reg, "db/tsql.sql", LanguageId::TSql, tsql_bracket);
    assert!(tb.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "dbo.Users"), "{:?}", tb.edges);

    // Ensure custom_type like TSVECTOR does not emit phantom SchemaRef
    let pg_tsvec = "CREATE TABLE docs (id INT PRIMARY KEY, body TSVECTOR, user_id INT REFERENCES users(id));\n";
    let pv = parse_input(&reg, "db/docs.sql", LanguageId::PostgreSql, pg_tsvec);
    assert!(pv.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "users"));
    assert!(!pv.edges.iter().any(|e| e.target.eq_ignore_ascii_case("tsvector")), "{:?}", pv.edges);

    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql] {
        let alt = parse_input(&reg, "db/alt.sql", lang, "ALTER TABLE orders ADD COLUMN org_id INT REFERENCES orgs(id);\n");
        assert!(alt.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "orders"), "{lang:?}: {:?}", alt.edges);
        assert!(alt.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "orgs"), "{lang:?}: {:?}", alt.edges);
    }
    let tsql_alt = parse_input(&reg, "db/talt.sql", LanguageId::TSql, "ALTER TABLE dbo.Orders ADD CONSTRAINT FK_U FOREIGN KEY (user_id) REFERENCES dbo.Users(id);\n");
    assert!(tsql_alt.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "dbo.Users"), "{:?}", tsql_alt.edges);

    let ws = vec![
        parse_input(&reg, "db/002_orders.sql", LanguageId::PostgreSql, "CREATE TABLE orders (id INT PRIMARY KEY, user_id INT REFERENCES users(id));\n"),
        parse_input(&reg, "db/001_users.sql", LanguageId::PostgreSql, "CREATE TABLE users (id INT PRIMARY KEY);\n"),
        parse_input(&reg, "db/003_alter_orders.sql", LanguageId::PostgreSql, "ALTER TABLE orders ADD COLUMN org_id INT;\n"),
        parse_input(&reg, "src/repo.ts", LanguageId::TypeScript, "// schema: ../db/002_orders.sql\nexport function load() { return 1; }\n"),
    ];
    let ord = order_files_topologically(&ws, root);
    let pos = |p: &str| ord.iter().position(|x| x == p).unwrap();
    assert!(pos("db/001_users.sql") < pos("db/002_orders.sql"), "{ord:?}");
    assert!(pos("db/002_orders.sql") < pos("db/003_alter_orders.sql"), "{ord:?}");
    assert!(pos("db/002_orders.sql") < pos("src/repo.ts"), "{ord:?}");
}

#[test]
fn regression_w3m2_r4_plpgsql_and_migration_dollar_quotes() {
    let reg = EngineRegistry::new();
    let root = Path::new("/virtual/ws");

    let pg_src = concat!(
        "CREATE FUNCTION credit_account(p_id BIGINT) RETURNS NUMERIC LANGUAGE plpgsql AS $$\n",
        "DECLARE v_bal NUMERIC;\n",
        "BEGIN\n",
        "  UPDATE accounts SET balance = balance + 1 WHERE id = p_id RETURNING balance INTO v_bal;\n",
        "  SELECT balance INTO v_bal FROM ledger;\n",
        "  INSERT INTO audit_log VALUES (p_id);\n",
        "  RETURN v_bal;\n",
        "END;\n",
        "$$;\n",
        "DO $$ BEGIN INSERT INTO events VALUES (1); END $$;\n",
    );
    let pg_in = parse_input(&reg, "db/002_credit.sql", LanguageId::PostgreSql, pg_src);
    for tbl in ["accounts", "ledger", "audit_log", "events"] {
        assert!(pg_in.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == tbl), "missing {tbl}: {:?}", pg_in.edges);
    }
    assert!(!pg_in.edges.iter().any(|e| e.target == "v_bal"), "false INTO variable edge: {:?}", pg_in.edges);

    let ws = vec![
        pg_in,
        parse_input(&reg, "db/001_accounts.sql", LanguageId::PostgreSql, "CREATE TABLE accounts (id BIGINT PRIMARY KEY, balance NUMERIC);\n"),
    ];
    let ord = order_files_topologically(&ws, root);
    let pos = |p: &str| ord.iter().position(|x| x == p).unwrap();
    assert!(pos("db/001_accounts.sql") < pos("db/002_credit.sql"), "{ord:?}");

    let mig_src = concat!(
        "-- +goose Up\n",
        "CREATE TYPE status_t AS ENUM ('ok');\n",
        "CREATE MATERIALIZED VIEW mv_acc AS SELECT * FROM accounts;\n",
        "-- +goose StatementBegin\n",
        "DO $$ BEGIN INSERT INTO audit_log VALUES (1); END $$;\n",
        "-- +goose StatementEnd\n",
    );
    let mig_in = parse_input(&reg, "db/V2.sql", LanguageId::DbMigration, mig_src);
    assert!(mig_in.symbols.iter().any(|s| s.name == "status_t"), "{:?}", mig_in.symbols);
    assert!(mig_in.symbols.iter().any(|s| s.name == "mv_acc"), "{:?}", mig_in.symbols);
    assert!(mig_in.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "accounts"), "{:?}", mig_in.edges);
    assert!(mig_in.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "audit_log"), "{:?}", mig_in.edges);
}

#[test]
fn regression_w3m2_r4_cypher_label_expressions_and_rels() {
    let reg = EngineRegistry::new();
    let cy_src = "MATCH (a:Person:Employee)-[:WORKS_AT]->(c IS Company) WHERE a:Active AND c:Public|Private SET a:Verified CALL db.labels() YIELD label RETURN a, c;\n";
    let cy_in = parse_input(&reg, "q/graph.cypher", LanguageId::Cypher, cy_src);

    for lbl in ["Person", "Employee", "WORKS_AT", "Company", "Active", "Public", "Private", "Verified"] {
        assert!(cy_in.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == lbl), "missing {lbl}: {:?}", cy_in.edges);
    }
    for bad in ["Person:Employee", "IS Company", "Public|Private"] {
        assert!(!cy_in.edges.iter().any(|e| e.target == bad), "raw slice {bad}: {:?}", cy_in.edges);
    }
    assert!(cy_in.edges.iter().any(|e| e.kind == DepKind::Call && e.target == "db.labels"), "{:?}", cy_in.edges);
    assert_eq!(cy_in.symbols[0].name, "Person");
}

#[test]
fn regression_w3m2_r4_ts_type_imports_no_leak() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r4_ts_type_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let files: &[(&str, &str)] = &[
        ("src/math.ts", "export type Bar = number;\nexport type Foo = string;\nexport function foo() {}\nexport function baz() {}\n"),
        ("src/barrel.ts", "export { foo } from './math.js';\nexport * from './math.js';\nexport type { Bar } from './math.js';\n"),
        ("src/type_only.ts", "import type { Bar } from './math.js';\nexport const x: Bar = 1;\n"),
        ("src/default_type.ts", "import type Foo from './math.js';\nexport const y: Foo = 'a';\n"),
        ("src/inline_type.ts", "import { type Bar as B, baz } from './math.js';\nexport const z: B = baz();\n"),
        ("src/export_type_ns.ts", "export type * as mathTypes from './math.js';\n"),
    ];
    let mut ws = Vec::new();
    for (p, src) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::TypeScript, src));
    }

    let hits_foo = find_workspace_callers("src/math.ts", Some("foo"), &ws, &dir);
    let barrel = hits_foo.iter().find(|h| h.caller_path == "src/barrel.ts").unwrap();
    assert_eq!(barrel.imported_symbols, vec!["foo", "*", "Bar"]);
    assert!(!barrel.imported_symbols.contains(&"type".into()));

    let hits_all = find_workspace_callers("src/math.ts", None, &ws, &dir);
    let type_only = hits_all.iter().find(|h| h.caller_path == "src/type_only.ts").unwrap();
    assert_eq!(type_only.imported_symbols, vec!["Bar"]);
    let def_type = hits_all.iter().find(|h| h.caller_path == "src/default_type.ts").unwrap();
    assert_eq!(def_type.imported_symbols, vec!["Foo"]);
    assert_eq!(def_type.call_lines, vec![2]);
    let inline_t = hits_all.iter().find(|h| h.caller_path == "src/inline_type.ts").unwrap();
    assert_eq!(inline_t.imported_symbols, vec!["Bar", "baz"]);
    assert_eq!(inline_t.call_lines, vec![2]);
    let exp_ns = hits_all.iter().find(|h| h.caller_path == "src/export_type_ns.ts").unwrap();
    assert_eq!(exp_ns.imported_symbols, vec!["*"]);

    assert!(find_workspace_callers("src/math.ts", Some("type"), &ws, &dir).is_empty());
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r4_python_dot_relative_imports() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r4_py_dot_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("pkg/sub")).unwrap();

    let files: &[(&str, &str)] = &[
        ("pkg/__init__.py", "INIT_VAL = 1\n"),
        ("pkg/math_mod.py", "def foo(): return 1\ndef bar(): return 2\n"),
        ("pkg/other_mod.py", "def foo(): return 9\n"),
        ("pkg/dot_rel.py", "from . import math_mod\nmath_mod.foo()\n"),
        ("pkg/multi_alias.py", "from . import other_mod, math_mod as mm\nother_mod.foo()\nmm.bar()\n"),
        ("pkg/sub/up_rel.py", "from .. import math_mod\nmath_mod.foo()\n"),
        ("pkg/sym_rel.py", "from .math_mod import foo\nfoo()\n"),
        ("pkg/star_init.py", "from . import *\n"),
        ("top.py", "from .. import math_mod\n"),
    ];
    let mut ws = Vec::new();
    for (p, src) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::Python, src));
    }

    assert!(ws[3].edges.iter().any(|e| e.kind == DepKind::Import && e.target == ".math_mod"));
    assert!(!ws[3].edges.iter().any(|e| e.target == "."));
    assert!(ws[4].edges.iter().any(|e| e.kind == DepKind::Import && e.target == ".other_mod"));
    assert!(ws[4].edges.iter().any(|e| e.kind == DepKind::Import && e.target == ".math_mod"));
    assert!(ws[5].edges.iter().any(|e| e.kind == DepKind::Import && e.target == "..math_mod"));
    assert!(ws[6].edges.iter().any(|e| e.kind == DepKind::Import && e.target == ".math_mod"));

    let idx = WorkspaceIndex::build(&ws, &dir);
    assert_eq!(resolve_dep_edge(3, &ws[3], &DepEdge { source: "module".into(), target: ".math_mod".into(), kind: DepKind::Import }, &idx, &dir), ResolveOutcome::WorkspaceFile("pkg/math_mod.py".into()));
    assert_eq!(resolve_dep_edge(5, &ws[5], &DepEdge { source: "module".into(), target: "..math_mod".into(), kind: DepKind::Import }, &idx, &dir), ResolveOutcome::WorkspaceFile("pkg/math_mod.py".into()));
    assert_eq!(resolve_dep_edge(7, &ws[7], &DepEdge { source: "module".into(), target: ".".into(), kind: DepKind::Import }, &idx, &dir), ResolveOutcome::WorkspaceFile("pkg/__init__.py".into()));
    assert_eq!(resolve_dep_edge(8, &ws[8], &DepEdge { source: "module".into(), target: "..math_mod".into(), kind: DepKind::Import }, &idx, &dir), ResolveOutcome::MissingLocal);

    let ord = order_files_topologically(&ws, &dir);
    let pos = |p: &str| ord.iter().position(|x| x == p).unwrap();
    for dep in ["pkg/dot_rel.py", "pkg/multi_alias.py", "pkg/sub/up_rel.py", "pkg/sym_rel.py"] {
        assert!(pos("pkg/math_mod.py") < pos(dep), "{dep}: {ord:?}");
    }

    let foo_hits = find_workspace_callers("pkg/math_mod.py", Some("foo"), &ws, &dir);
    let foo_paths: Vec<&str> = foo_hits.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(foo_paths, vec!["pkg/dot_rel.py", "pkg/sub/up_rel.py", "pkg/sym_rel.py"], "{foo_hits:?}");
    for h in &foo_hits {
        assert_eq!(h.call_lines, vec![2], "{h:?}");
    }

    let bar_hits = find_workspace_callers("pkg/math_mod.py", Some("bar"), &ws, &dir);
    assert_eq!(bar_hits.len(), 1, "{bar_hits:?}");
    assert_eq!(bar_hits[0].caller_path, "pkg/multi_alias.py");
    assert_eq!(bar_hits[0].imported_symbols, vec!["*"]);
    assert_eq!(bar_hits[0].call_lines, vec![3]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r4_config_json_yaml_toml_schema_refs() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r4_cfg_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("schemas")).unwrap();
    fs::create_dir_all(dir.join("config")).unwrap();

    let files: &[(&str, LanguageId, &str)] = &[
        ("schemas/app.schema.json", LanguageId::Json, "{\"type\":\"object\"}\n"),
        ("config/app.yaml", LanguageId::Yaml, "# schema: ../schemas/app.schema.json\nname: svc\n"),
        ("config/app.toml", LanguageId::Toml, "# schema: ../schemas/app.schema.json\nname = \"svc\"\n"),
        ("config/app.json", LanguageId::Json, "{\"$schema\":\"../schemas/app.schema.json\",\"name\":\"svc\"}\n"),
        ("config/remote.json", LanguageId::Json, "{\"$schema\":\"https://json-schema.org/draft/2020-12/schema\",\"name\":\"r\"}\n"),
        ("tsconfig.json", LanguageId::Json, "// schema: ./schemas/app.schema.json\n{\"compilerOptions\":{}}\n"),
    ];
    let mut ws = Vec::new();
    for (p, lang, src) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, *lang, src));
    }

    for i in [1usize, 2, 3] {
        assert!(ws[i].edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "../schemas/app.schema.json"), "{:?}", ws[i].edges);
    }
    assert!(ws[5].edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "./schemas/app.schema.json"));

    let idx = WorkspaceIndex::build(&ws, &dir);
    for i in [1usize, 2, 3, 5] {
        assert_eq!(
            resolve_dep_edge(i, &ws[i], &ws[i].edges[0], &idx, &dir),
            ResolveOutcome::WorkspaceFile("schemas/app.schema.json".into())
        );
    }
    assert_eq!(
        resolve_dep_edge(4, &ws[4], &ws[4].edges[0], &idx, &dir),
        ResolveOutcome::ExternalPackage
    );

    let ord = order_files_topologically(&ws, &dir);
    let pos = |p: &str| ord.iter().position(|x| x == p).unwrap();
    for cfg in ["config/app.yaml", "config/app.toml", "config/app.json", "tsconfig.json"] {
        assert!(pos("schemas/app.schema.json") < pos(cfg), "{cfg}: {ord:?}");
    }

    let callers = find_workspace_callers("schemas/app.schema.json", None, &ws, &dir);
    let paths: Vec<&str> = callers.iter().map(|h| h.caller_path.as_str()).collect();
    assert_eq!(paths, vec!["config/app.json", "config/app.toml", "config/app.yaml", "tsconfig.json"]);
    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r5_triggers_indexes_merge_and_export_type_nospace() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r5_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("db")).unwrap();
    fs::create_dir_all(dir.join("src")).unwrap();
    fs::create_dir_all(dir.join("schemas")).unwrap();
    fs::create_dir_all(dir.join("config")).unwrap();

    // 1. BEFORE UPDATE & BEFORE INSERT OR UPDATE triggers across MySql, Sqlite, DbMigration, TSql
    let trig_cases: &[(LanguageId, &str)] = &[
        (LanguageId::MySql, "CREATE TRIGGER a_trig BEFORE UPDATE ON accounts FOR EACH ROW BEGIN SET @x = 1; END;\n"),
        (LanguageId::Sqlite, "CREATE TRIGGER a_trig BEFORE UPDATE ON accounts BEGIN SELECT 1; END;\n"),
        (LanguageId::DbMigration, "-- +migrate Up\nCREATE TRIGGER a_trig BEFORE INSERT OR UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION fn_a();\n"),
        (LanguageId::TSql, "CREATE TRIGGER a_trig BEFORE UPDATE ON accounts FOR EACH ROW BEGIN INSERT INTO log VALUES (1); END;\n"),
    ];
    for &(lang, trig_src) in trig_cases {
        let f_tbl = parse_input(&reg, "db/z_accounts.sql", lang, "CREATE TABLE accounts (id INT PRIMARY KEY);\n");
        let f_trg = parse_input(&reg, "db/a_trig.sql", lang, trig_src);
        assert!(!f_trg.edges.iter().any(|e| e.target.eq_ignore_ascii_case("ON")), "{lang:?}: {:?}", f_trg.edges);
        assert!(f_trg.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "accounts"), "{lang:?}: {:?}", f_trg.edges);
        let ord = order_files_topologically(&[f_trg, f_tbl], &dir);
        assert_eq!(ord, vec!["db/z_accounts.sql", "db/a_trig.sql"], "{lang:?}: {ord:?}");
    }
    let tsql_trg = parse_input(
        &reg,
        "db/tsql_trg.sql",
        LanguageId::TSql,
        "CREATE OR ALTER TRIGGER [dbo].[tr_acc] ON [dbo].[Accounts] AFTER INSERT, UPDATE AS BEGIN INSERT INTO dbo.Audit SELECT * FROM inserted; END;\n",
    );
    assert!(tsql_trg.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "dbo.Accounts"), "{:?}", tsql_trg.edges);
    assert!(!tsql_trg.edges.iter().any(|e| matches!(e.target.as_str(), "ON" | "AS")), "{:?}", tsql_trg.edges);

    // Negative check: JOIN ... ON and GRANT ... ON must not emit bogus ON targets
    let neg_sql = parse_input(&reg, "db/q.sql", LanguageId::MySql, "SELECT * FROM alpha JOIN beta USING (id);\nGRANT SELECT ON accounts TO app_user;\nSELECT * FROM gamma JOIN delta ON gamma.id = delta.id;\n");
    let neg_tgts: Vec<&str> = neg_sql.edges.iter().map(|e| e.target.as_str()).collect();
    assert!(!neg_tgts.contains(&"accounts") && !neg_tgts.contains(&"id") && !neg_tgts.contains(&"gamma.id"), "{neg_tgts:?}");

    // 2. CREATE INDEX ... ON <table> across MySql, Sqlite, TSql, DbMigration + CONCURRENTLY symbol
    for lang in [LanguageId::MySql, LanguageId::Sqlite, LanguageId::TSql, LanguageId::DbMigration] {
        let idx_src = if lang == LanguageId::DbMigration {
            "-- +migrate Up\nCREATE INDEX idx_u_name ON users (name);\n"
        } else {
            "CREATE INDEX idx_u_name ON users (name);\n"
        };
        let f_tbl = parse_input(&reg, "db/z_users.sql", lang, "CREATE TABLE users (id INT, name VARCHAR(64));\n");
        let f_idx = parse_input(&reg, "db/a_idx.sql", lang, idx_src);
        assert!(f_idx.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "users"), "{lang:?}: {:?}", f_idx.edges);
        let ord = order_files_topologically(&[f_idx, f_tbl], &dir);
        assert_eq!(ord, vec!["db/z_users.sql", "db/a_idx.sql"], "{lang:?}: {ord:?}");
    }
    let tsql_idx = parse_input(&reg, "db/tsql_idx.sql", LanguageId::TSql, "CREATE UNIQUE CLUSTERED INDEX IX_U ON [dbo].[Users] (id) ON [PRIMARY];\n");
    assert!(tsql_idx.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "dbo.Users"), "{:?}", tsql_idx.edges);
    assert!(!tsql_idx.edges.iter().any(|e| e.target == "PRIMARY"), "{:?}", tsql_idx.edges);

    let mig_conc = parse_input(
        &reg,
        "db/V2__idx.sql",
        LanguageId::DbMigration,
        "-- +migrate Up\nCREATE INDEX CONCURRENTLY IF NOT EXISTS idx_o ON orders (id);\n",
    );
    assert!(mig_conc.symbols.iter().any(|s| s.name == "idx_o"), "{:?}", mig_conc.symbols);
    assert!(!mig_conc.symbols.iter().any(|s| s.name == "CONCURRENTLY"), "{:?}", mig_conc.symbols);
    assert!(mig_conc.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "orders"), "{:?}", mig_conc.edges);

    // 3. MERGE INTO target USING source across SQL dialects
    let merge_sql = "MERGE INTO target_tbl USING source_tbl ON target_tbl.id = source_tbl.id WHEN MATCHED THEN UPDATE SET val = source_tbl.val;\n";
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::Sqlite, LanguageId::TSql, LanguageId::DbMigration] {
        let f_m = parse_input(&reg, "db/merge.sql", lang, merge_sql);
        assert!(f_m.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "target_tbl"), "{lang:?}: {:?}", f_m.edges);
        assert!(f_m.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "source_tbl"), "{lang:?}: {:?}", f_m.edges);
    }

    // 4. export type{Bar}from './math.js' & export type*from (with and without ';') & non-reexport rejection
    let ts_ws_files: &[(&str, &str)] = &[
        ("src/math.ts", "export interface Bar { x: number }\nexport function foo(): number { return 1; }\nexport function baz(): number { return 2; }\n"),
        ("src/reexport_nospace.ts", "export type{Bar}from './math.js';\n"),
        ("src/reexport_star_nospace.ts", "export type*from './math.js';\n"),
        ("src/reexport_star_nospace_nosemi.ts", "export type*from './math.js'\nexport function helper(): number { return baz(); }\n"),
        ("src/local_type_decl.ts", "export type Bar = { x: number };\nexport typedef = 1;\n"),
    ];
    let mut ts_ws = Vec::new();
    for (p, src) in ts_ws_files {
        fs::write(dir.join(p), src).unwrap();
        ts_ws.push(parse_input(&reg, p, LanguageId::TypeScript, src));
    }
    let bar_hits = find_workspace_callers("src/math.ts", Some("Bar"), &ts_ws, &dir);
    let h_nospace = bar_hits.iter().find(|h| h.caller_path == "src/reexport_nospace.ts").unwrap();
    assert_eq!(h_nospace.imported_symbols, vec!["Bar"]);
    assert!(h_nospace.call_lines.is_empty(), "{h_nospace:?}");
    let all_hits = find_workspace_callers("src/math.ts", None, &ts_ws, &dir);
    let h_star = all_hits.iter().find(|h| h.caller_path == "src/reexport_star_nospace.ts").unwrap();
    assert_eq!(h_star.imported_symbols, vec!["*"]);
    assert!(h_star.call_lines.is_empty(), "{h_star:?}");
    let h_star_nosemi = all_hits.iter().find(|h| h.caller_path == "src/reexport_star_nospace_nosemi.ts").unwrap();
    assert_eq!(h_star_nosemi.imported_symbols, vec!["*"]);
    assert_eq!(h_star_nosemi.call_lines, vec![2], "{h_star_nosemi:?}");
    let baz_hits = find_workspace_callers("src/math.ts", Some("baz"), &ts_ws, &dir);
    let h_baz = baz_hits.iter().find(|h| h.caller_path == "src/reexport_star_nospace_nosemi.ts").unwrap();
    assert_eq!(h_baz.imported_symbols, vec!["*"]);
    assert_eq!(h_baz.call_lines, vec![2], "{h_baz:?}");
    assert!(!bar_hits.iter().any(|h| h.caller_path == "src/local_type_decl.ts"));
    assert!(!all_hits.iter().any(|h| h.caller_path == "src/local_type_decl.ts"));

    // 5. Taplo #:schema in TOML
    fs::write(dir.join("schemas/app.schema.json"), "{\"type\":\"object\"}\n").unwrap();
    let taplo_src = "#:schema ../schemas/app.schema.json\nname = \"svc\"\n";
    fs::write(dir.join("config/taplo.toml"), taplo_src).unwrap();
    let f_schema = parse_input(&reg, "schemas/app.schema.json", LanguageId::Json, "{\"type\":\"object\"}\n");
    let f_taplo = parse_input(&reg, "config/taplo.toml", LanguageId::Toml, taplo_src);
    assert!(f_taplo.edges.iter().any(|e| e.kind == DepKind::SchemaRef && e.target == "../schemas/app.schema.json"));
    let cfg_ord = order_files_topologically(&[f_taplo, f_schema], &dir);
    assert_eq!(cfg_ord, vec!["schemas/app.schema.json", "config/taplo.toml"]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r7_asi_whitespace_from_and_local_export() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r7_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let files: &[(&str, &str)] = &[
        ("src/math.ts", "export type Bar = number;\nexport function baz(): number { return 2; }\nexport function from(): number { return 3; }\n"),
        ("src/other.ts", "export const Other = 1;\n"),
        ("src/c_tab_from.ts", "export type {\n  Bar\n}\tfrom './math.js'\nexport function helper(): number { return Bar(); }\n"),
        ("src/c_nl_from.ts", "import {\n  Bar\n}\nfrom './math.js'\nexport function helper(): number { return Bar(); }\n"),
        ("src/c_seq_nl_from.ts", "import {\n  Other\n}\nfrom './other.js'\nimport { baz } from './math.js';\nexport function helper(): number { return baz(); }\n"),
        ("src/c_local_export_asi.ts", "import { Bar } from './math.js';\nexport type { Bar }\nexport function helper(): number { return Bar(); }\n"),
        ("src/c_local_export_multi.ts", "import { Bar } from './math.js';\nexport type {\n  Bar,\n}\nexport function helper(): number { return Bar(); }\n"),
        ("src/c_star_nl_from.ts", "export type *\nfrom './math.js'\nexport function helper(): number { return baz(); }\n"),
        ("src/c_from_ident.ts", "import { from } from './math.js';\nexport function helper(): number { return from(); }\n"),
    ];
    let mut ws = Vec::new();
    for (p, src) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::TypeScript, src));
    }

    let bar_hits = find_workspace_callers("src/math.ts", Some("Bar"), &ws, &dir);
    for (path, expected_line) in [
        ("src/c_tab_from.ts", 4usize),
        ("src/c_nl_from.ts", 5usize),
        ("src/c_local_export_asi.ts", 3usize),
        ("src/c_local_export_multi.ts", 5usize),
    ] {
        let hit = bar_hits.iter().find(|h| h.caller_path == path).unwrap_or_else(|| panic!("missing {path}: {bar_hits:?}"));
        assert_eq!(hit.imported_symbols, vec!["Bar"], "{path}: {hit:?}");
        assert_eq!(hit.call_lines, vec![expected_line], "{path}: {hit:?}");
    }

    let baz_hits = find_workspace_callers("src/math.ts", Some("baz"), &ws, &dir);
    let h_seq = baz_hits.iter().find(|h| h.caller_path == "src/c_seq_nl_from.ts").unwrap_or_else(|| panic!("missing c_seq_nl_from: {baz_hits:?}"));
    assert_eq!(h_seq.imported_symbols, vec!["baz"]);
    assert_eq!(h_seq.call_lines, vec![6]);

    let h_star = baz_hits.iter().find(|h| h.caller_path == "src/c_star_nl_from.ts").unwrap_or_else(|| panic!("missing c_star_nl_from: {baz_hits:?}"));
    assert_eq!(h_star.imported_symbols, vec!["*"]);
    assert_eq!(h_star.call_lines, vec![3]);

    let from_hits = find_workspace_callers("src/math.ts", Some("from"), &ws, &dir);
    let h_from = from_hits.iter().find(|h| h.caller_path == "src/c_from_ident.ts").unwrap_or_else(|| panic!("missing c_from_ident: {from_hits:?}"));
    assert_eq!(h_from.imported_symbols, vec!["from"]);
    assert_eq!(h_from.call_lines, vec![2]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r8_star_nospace_from_ident_type_alias_and_multiline_require() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r8_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let ts_files: &[(&str, &str)] = &[
        (
            "src/math.ts",
            "export function Bar(): number { return 1; }\nexport function type(): number { return 2; }\nexport default function from(): number { return 3; }\n",
        ),
        (
            "src/a_imp_star_nospace.ts",
            "import*as ns from './math.js'\nexport function helper(): number { return ns.Bar(); }\n",
        ),
        (
            "src/a_exp_star_nospace.ts",
            "export*as ns from './math.js'\nexport function helper(): number { return ns.Bar(); }\n",
        ),
        (
            "src/a_exp_type_star_nospace.ts",
            "export type*as ns from './math.js'\nexport function helper(): number { return ns.Bar(); }\n",
        ),
        (
            "src/a_imp_def_star_nospace.ts",
            "import defFn,*as ns from './math.js'\nexport function helper(): number { return ns.Bar(); }\n",
        ),
        (
            "src/c_from_default.ts",
            "import from from './math.js'\nexport function helper(): number { return from(); }\n",
        ),
        (
            "src/c_from_default_nl.ts",
            "import from\nfrom './math.js'\nexport function helper(): number { return from(); }\n",
        ),
        (
            "src/c_export_from_nl.ts",
            "export { Bar } from\n'./math.js'\nexport function helper(): number { return Bar(); }\n",
        ),
        (
            "src/c_type_as_ident.ts",
            "import { type as myType } from './math.js'\nexport function helper(): number { return myType(); }\n",
        ),
    ];
    let mut ws = Vec::new();
    for (p, src) in ts_files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::TypeScript, src));
    }

    let bar_hits = find_workspace_callers("src/math.ts", Some("Bar"), &ws, &dir);
    for (path, expected_syms, expected_lines) in [
        ("src/a_imp_star_nospace.ts", vec!["*"], vec![2usize]),
        ("src/a_exp_star_nospace.ts", vec!["*"], vec![2]),
        ("src/a_exp_type_star_nospace.ts", vec!["*"], vec![2]),
        ("src/a_imp_def_star_nospace.ts", vec!["defFn", "*"], vec![2]),
        ("src/c_export_from_nl.ts", vec!["Bar"], vec![3]),
    ] {
        let hit = bar_hits
            .iter()
            .find(|h| h.caller_path == path)
            .unwrap_or_else(|| panic!("missing Bar hit for {path}: {bar_hits:?}"));
        assert_eq!(hit.imported_symbols, expected_syms, "{path}: {hit:?}");
        assert_eq!(hit.call_lines, expected_lines, "{path}: {hit:?}");
    }

    let all_hits = find_workspace_callers("src/math.ts", None, &ws, &dir);
    for (path, expected_line) in [("src/c_from_default.ts", 2usize), ("src/c_from_default_nl.ts", 3)] {
        let hit = all_hits
            .iter()
            .find(|h| h.caller_path == path)
            .unwrap_or_else(|| panic!("missing {path}: {all_hits:?}"));
        assert_eq!(hit.imported_symbols, vec!["from"], "{path}: {hit:?}");
        assert_eq!(hit.call_lines, vec![expected_line], "{path}: {hit:?}");
    }

    let type_hits = find_workspace_callers("src/math.ts", Some("type"), &ws, &dir);
    let h_type = type_hits
        .iter()
        .find(|h| h.caller_path == "src/c_type_as_ident.ts")
        .unwrap_or_else(|| panic!("missing c_type_as_ident: {type_hits:?}"));
    assert_eq!(h_type.imported_symbols, vec!["type"]);
    assert_eq!(h_type.call_lines, vec![2]);

    // Multi-line CommonJS require(...) destructuring and default values
    let js_files: &[(&str, &str)] = &[
        (
            "src/cjs_math.js",
            "exports.foo = () => 1;\nexports.bar = () => 2;\n",
        ),
        (
            "src/cjs_multiline.js",
            "const {\n  foo,\n  bar: baz,\n} = require('./cjs_math');\nfunction run() { return foo() + baz(); }\n",
        ),
        (
            "src/cjs_defaults.js",
            "const { foo = () => 0, bar: baz = () => 0 } = require('./cjs_math');\nfunction run() { return foo() + baz(); }\n",
        ),
    ];
    let mut js_ws = Vec::new();
    for (p, src) in js_files {
        fs::write(dir.join(p), src).unwrap();
        js_ws.push(parse_input(&reg, p, LanguageId::JavaScript, src));
    }
    let foo_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &js_ws, &dir);
    for (path, expected_line) in [("src/cjs_multiline.js", 5usize), ("src/cjs_defaults.js", 2)] {
        let hit = foo_hits
            .iter()
            .find(|h| h.caller_path == path)
            .unwrap_or_else(|| panic!("missing foo hit for {path}: {foo_hits:?}"));
        assert_eq!(hit.imported_symbols, vec!["foo", "bar"], "{path}: {hit:?}");
        assert_eq!(hit.call_lines, vec![expected_line], "{path}: {hit:?}");
    }
    let bar_cjs_hits = find_workspace_callers("src/cjs_math.js", Some("bar"), &js_ws, &dir);
    for (path, expected_line) in [("src/cjs_multiline.js", 5usize), ("src/cjs_defaults.js", 2)] {
        let hit = bar_cjs_hits
            .iter()
            .find(|h| h.caller_path == path)
            .unwrap_or_else(|| panic!("missing bar hit for {path}: {bar_cjs_hits:?}"));
        assert_eq!(hit.imported_symbols, vec!["foo", "bar"], "{path}: {hit:?}");
        assert_eq!(hit.call_lines, vec![expected_line], "{path}: {hit:?}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r9_cjs_require_defaults_quotes_and_nested_scope() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r9_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let files: &[(&str, &str, Vec<usize>)] = &[
        (
            "src/cjs_math.js",
            "exports.foo = () => 1;\nexports.bar = () => 2;\n",
            vec![],
        ),
        (
            "src/c5_str_rbrace.js",
            "const {\n  foo = '}',\n  bar,\n} = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n",
            vec![5],
        ),
        (
            "src/c6_str_lbrace.js",
            "const {\n  foo = '{',\n  bar,\n} = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n",
            vec![5],
        ),
        (
            "src/c7_str_semi.js",
            "const { foo = ';', bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n",
            vec![2],
        ),
        (
            "src/c8_str_eq_colon.js",
            "const { foo = 'x = 1', bar = 'a:b' } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n",
            vec![2],
        ),
        (
            "src/c9_def_obj_fn.js",
            "const { foo = { a: 1, b: 2 }, bar: baz = (x, y) => x + y } = require('./cjs_math');\nfunction r() { return foo() + baz(); }\n",
            vec![2],
        ),
        (
            "src/c10_def_block_semi.js",
            "const { foo = () => { return 1; }, bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n",
            vec![2],
        ),
        (
            "src/c11_nested_fn.js",
            "function outer() {\n  const prep = 1;\n  if (prep) {\n    const {\n      foo = '};}',\n      bar: baz = () => { return '{;}'; },\n    } = require('./cjs_math');\n    return foo() + baz();\n  }\n}\n",
            vec![8],
        ),
        (
            "src/c12_tpl_utf8_def.js",
            "const {\n  foo = `café ${String({ k: '};' })} 日本語`,\n  bar: qux = 'α:β',\n} = require('./cjs_math');\nfunction r() { return foo() + qux(); }\n",
            vec![5],
        ),
    ];

    let mut ws = Vec::new();
    for (p, src, _) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::JavaScript, src));
    }
    let ns_path = "src/c13_ns_col0_eq.js";
    let ns_src = "const m\n= require('./cjs_math');\nfunction r() { return m.foo() + m.bar(); }\n";
    fs::write(dir.join(ns_path), ns_src).unwrap();
    ws.push(parse_input(&reg, ns_path, LanguageId::JavaScript, ns_src));

    let foo_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &ws, &dir);
    let bar_hits = find_workspace_callers("src/cjs_math.js", Some("bar"), &ws, &dir);
    for (path, _, expected_lines) in &files[1..] {
        let fh = foo_hits
            .iter()
            .find(|h| h.caller_path == *path)
            .unwrap_or_else(|| panic!("missing foo hit for {path}: {foo_hits:?}"));
        assert_eq!(fh.imported_symbols, vec!["foo", "bar"], "foo {path}: {fh:?}");
        assert_eq!(fh.call_lines, *expected_lines, "foo {path}: {fh:?}");

        let bh = bar_hits
            .iter()
            .find(|h| h.caller_path == *path)
            .unwrap_or_else(|| panic!("missing bar hit for {path}: {bar_hits:?}"));
        assert_eq!(bh.imported_symbols, vec!["foo", "bar"], "bar {path}: {bh:?}");
        assert_eq!(bh.call_lines, *expected_lines, "bar {path}: {bh:?}");
    }

    let ns_foo = foo_hits
        .iter()
        .find(|h| h.caller_path == ns_path)
        .unwrap_or_else(|| panic!("missing ns foo hit: {foo_hits:?}"));
    assert_eq!(ns_foo.imported_symbols, vec!["*"]);
    assert_eq!(ns_foo.call_lines, vec![3]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r10_cjs_multiline_tpl_comment_eq_and_utf8() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r10_a_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let files: &[(&str, &str, Vec<&str>, Vec<usize>)] = &[
        ("src/cjs_math.js", "exports.foo = () => 1;\nexports.bar = () => 2;\n", vec![], vec![]),
        ("src/h3_tpl_ml_close_req.js", "const { foo = `line1\nline2`, bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec!["foo", "bar"], vec![3]),
        ("src/c14_tpl_ml_interp_close_req.js", "const { foo = `line1\n${String({ a: '}' })}\nline2`, bar: qux } = require('./cjs_math');\nfunction r() { return foo() + qux(); }\n", vec!["foo", "bar"], vec![4]),
        ("src/c15_tpl_ml_before_ns_req.js", "const s = `line1\nline2`; const m = require('./cjs_math');\nfunction r() { return m.foo() + m.bar(); }\n", vec!["*"], vec![3]),
        ("src/h12_eq_comment_nl_req.js", "const m =\n  // load math\n  require('./cjs_math');\nfunction r() { return m.foo() + m.bar(); }\n", vec!["*"], vec![4]),
        ("src/h13_destr_eq_comment_nl_req.js", "const { foo: myFoo } =\n  // load math\n  require('./cjs_math');\nfunction r() { return myFoo(); }\n", vec!["foo"], vec![4]),
        ("src/c16_tpl_ml_plus_block_comment_blank_eq.js", "const {\n  foo = `line1\nline2`,\n  bar: myBar,\n} =\n  /* multi\n     comment */\n\n  require('./cjs_math');\nfunction r() { return foo() + myBar(); }\n", vec!["foo", "bar"], vec![10]),
        ("src/c17_ns_split_comments.js", "const m\n  // c1\n  =\n  // c2\n  require('./cjs_math');\nfunction r() { return m.foo() + m.bar(); }\n", vec!["*"], vec![6]),
        ("src/c18_utf8_col0_eq_ns.js", "const α\n= require('./cjs_math');\nfunction r() { return α.foo() + α.bar(); }\n", vec!["*"], vec![3]),
        ("src/c19_nbsp_before_eq.js", "const { foo }\u{00A0}= require('./cjs_math');\nfunction r() { return foo(); }\n", vec!["foo"], vec![2]),
        ("src/c20_strict_eq_not_assign.js", "if (globalThis.x === require('./cjs_math').foo) { /* ok */ }\n", vec!["foo"], vec![1]),
        ("src/c20b_strict_eq_bare.js", "if (globalThis.x === require('./cjs_math')) { /* ok */ }\n", vec![], vec![]),
    ];

    let mut ws = Vec::new();
    for (p, src, _, _) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, LanguageId::JavaScript, src));
    }

    let foo_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &ws, &dir);
    for (path, _, exp_syms, exp_lines) in &files[1..11] {
        let fh = foo_hits.iter().find(|h| h.caller_path == *path).unwrap_or_else(|| panic!("missing foo hit for {path}: {foo_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(fh.imported_symbols, exp, "foo {path}: {fh:?}");
        assert_eq!(fh.call_lines, *exp_lines, "foo {path}: {fh:?}");
    }
    assert!(!foo_hits.iter().any(|h| h.caller_path == "src/c20b_strict_eq_bare.js"));

    let bar_hits = find_workspace_callers("src/cjs_math.js", Some("bar"), &ws, &dir);
    for path in ["src/h3_tpl_ml_close_req.js", "src/c14_tpl_ml_interp_close_req.js", "src/c15_tpl_ml_before_ns_req.js", "src/h12_eq_comment_nl_req.js", "src/c16_tpl_ml_plus_block_comment_blank_eq.js", "src/c17_ns_split_comments.js", "src/c18_utf8_col0_eq_ns.js"] {
        assert!(bar_hits.iter().any(|h| h.caller_path == path), "missing bar hit for {path}: {bar_hits:?}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r10_multi_require_esm_and_same_line_calls() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r10_b_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let js_files: &[(&str, &str)] = &[
        ("src/cjs_math.js", "exports.foo = () => 1;\nexports.bar = () => 2;\n"),
        ("src/x.js", "exports.a = () => 1;\nexports.foo = () => 9;\n"),
        ("src/y.js", "exports.b = () => 2;\n"),
        ("src/b1_multi_sep.js", "const { a } = require('./x'), { b } = require('./y');\nconst { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b2_multi_same_decl.js", "const { a } = require('./x'), { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b3_ns_then_destr.js", "const x = require('./x'), { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b4_two_from_same.js", "const { foo } = require('./cjs_math'), { bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/b5_semi_then_destr.js", "require('./x'); const { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b6a_prop_comma.js", "const a = require('./x').a, b = require('./cjs_math').bar;\nfunction r() { return b(); }\n"),
        ("src/b6b_nospace_comma.js", "const x=require('./x'),m=require('./cjs_math');\nfunction r(){return m.foo();}\n"),
        ("src/b7_no_leak_semi.js", "const { a } = require('./x'); require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b8_false_pos_guard.js", "const { foo } = require('./x'), ns = require('./cjs_math');\nfunction r() { return 0; }\n"),
        ("src/b9_str_require.js", "const s = \"require('./x')\"; const { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b10_same_line_call.js", "const { foo } = require('./cjs_math'); foo();\n"),
        ("src/b10b_comma_call.js", "const { foo } = require('./cjs_math'), res = foo();\n"),
        ("src/b11_immediate_prop_call.js", "const r = require('./cjs_math').foo();\n"),
        ("src/b11b_bare_prop_call.js", "require('./cjs_math').foo();\n"),
        ("src/b11c_prop_alias_call.js", "const fn = require('./cjs_math').foo; fn();\n"),
        ("src/b11d_array_destr_no_bracket.js", "const [a, b] = require('./cjs_math');\nfunction r() { return foo(); }\n"),
        ("src/b15_mixed_esm_cjs.js", "import { a } from './x.js'; const { foo } = require('./cjs_math');\nfunction r() { return foo(); }\n"),
    ];
    let mut js_ws = Vec::new();
    for (p, src) in js_files {
        fs::write(dir.join(p), src).unwrap();
        js_ws.push(parse_input(&reg, p, LanguageId::JavaScript, src));
    }

    let foo_js = find_workspace_callers("src/cjs_math.js", Some("foo"), &js_ws, &dir);
    for (p, exp_syms, exp_lines) in [
        ("src/b1_multi_sep.js", vec!["foo"], vec![3usize]),
        ("src/b2_multi_same_decl.js", vec!["foo"], vec![2]),
        ("src/b3_ns_then_destr.js", vec!["foo"], vec![2]),
        ("src/b4_two_from_same.js", vec!["foo", "bar"], vec![2]),
        ("src/b5_semi_then_destr.js", vec!["foo"], vec![2]),
        ("src/b6b_nospace_comma.js", vec!["*"], vec![2]),
        ("src/b7_no_leak_semi.js", vec![], vec![2]),
        ("src/b9_str_require.js", vec!["foo"], vec![2]),
        ("src/b10_same_line_call.js", vec!["foo"], vec![1]),
        ("src/b10b_comma_call.js", vec!["foo"], vec![1]),
        ("src/b11_immediate_prop_call.js", vec!["foo"], vec![1]),
        ("src/b11b_bare_prop_call.js", vec!["foo"], vec![1]),
        ("src/b11c_prop_alias_call.js", vec!["foo"], vec![1]),
        ("src/b11d_array_destr_no_bracket.js", vec![], vec![2]),
        ("src/b15_mixed_esm_cjs.js", vec!["foo"], vec![2]),
    ] {
        let h = foo_js.iter().find(|x| x.caller_path == p).unwrap_or_else(|| panic!("missing {p}: {foo_js:?}"));
        assert_eq!(h.imported_symbols, exp_syms, "{p}: {h:?}");
        assert_eq!(h.call_lines, exp_lines, "{p}: {h:?}");
    }
    assert!(!foo_js.iter().any(|x| x.caller_path == "src/b8_false_pos_guard.js"), "false positive on b8: {foo_js:?}");
    assert!(!foo_js.iter().any(|x| x.caller_path == "src/b6a_prop_comma.js"), "b6a should only import bar: {foo_js:?}");

    let bar_js = find_workspace_callers("src/cjs_math.js", Some("bar"), &js_ws, &dir);
    let hb6a = bar_js.iter().find(|x| x.caller_path == "src/b6a_prop_comma.js").unwrap();
    assert_eq!(hb6a.imported_symbols, vec!["bar"]);
    assert_eq!(hb6a.call_lines, vec![2]);

    // ESM multi-statement, same-line calls, and target stem isolation
    let ts_files: &[(&str, &str)] = &[
        ("src/math.ts", "export function foo(): number { return 1; }\nexport function bar(): number { return 2; }\n"),
        ("src/foo.ts", "export function foo(): number { return 1; }\nexport function bar(): number { return 2; }\n"),
        ("src/x_mod.ts", "export function a(): number { return 1; }\nexport function foo(): number { return 2; }\n"),
        ("src/b12_multi_esm.ts", "import { a } from './x_mod.js'; import { foo } from './math.js';\nexport function r() { return foo(); }\n"),
        ("src/b13_imp_exp_esm.ts", "import { foo } from './math.js'; export { bar } from './math.js';\nexport function r() { return foo() + bar(); }\n"),
        ("src/b14_esm_same_line_call.ts", "import { foo } from './math.js'; foo();\n"),
        ("src/b16_const_then_imp.ts", "const x = 1; import { foo } from './math.js';\nexport function r() { return foo(); }\n"),
        ("src/b17_spec_isolation.ts", "import { foo } from './x_mod.js'; import { bar } from './foo.js';\nexport function r() { return bar(); }\n"),
    ];
    let mut ts_ws = Vec::new();
    for (p, src) in ts_files {
        fs::write(dir.join(p), src).unwrap();
        ts_ws.push(parse_input(&reg, p, LanguageId::TypeScript, src));
    }
    let foo_ts = find_workspace_callers("src/math.ts", Some("foo"), &ts_ws, &dir);
    for (p, exp_syms, exp_lines) in [
        ("src/b12_multi_esm.ts", vec!["foo"], vec![2usize]),
        ("src/b13_imp_exp_esm.ts", vec!["foo", "bar"], vec![2]),
        ("src/b14_esm_same_line_call.ts", vec!["foo"], vec![1]),
        ("src/b16_const_then_imp.ts", vec!["foo"], vec![2]),
    ] {
        let h = foo_ts.iter().find(|x| x.caller_path == p).unwrap_or_else(|| panic!("missing {p}: {foo_ts:?}"));
        assert_eq!(h.imported_symbols, exp_syms, "{p}: {h:?}");
        assert_eq!(h.call_lines, exp_lines, "{p}: {h:?}");
    }
    let foo_stem_hits = find_workspace_callers("src/foo.ts", Some("foo"), &ts_ws, &dir);
    assert!(!foo_stem_hits.iter().any(|x| x.caller_path == "src/b17_spec_isolation.ts"), "b17 false hit: {foo_stem_hits:?}");

    // Rust & Python multi-statement lines
    let rp_files: &[(&str, LanguageId, &str)] = &[
        ("src/rs_math.rs", LanguageId::Rust, "pub fn foo() {}\n"),
        ("src/rs_x.rs", LanguageId::Rust, "pub fn a() {}\n"),
        ("src/b18_rs_multi.rs", LanguageId::Rust, "use crate::rs_x::a; use crate::rs_math::foo; pub fn r() { foo(); }\n"),
        ("src/py_mod.py", LanguageId::Python, "def foo():\n    return 1\n"),
        ("src/py_x.py", LanguageId::Python, "def a():\n    return 1\n"),
        ("src/b19_py_multi.py", LanguageId::Python, "from .py_x import a; from .py_mod import foo; foo()\n"),
    ];
    let mut rp_ws = Vec::new();
    for (p, lang, src) in rp_files {
        fs::write(dir.join(p), src).unwrap();
        rp_ws.push(parse_input(&reg, p, *lang, src));
    }
    let rs_hits = find_workspace_callers("src/rs_math.rs", Some("foo"), &rp_ws, &dir);
    assert_eq!(rs_hits[0].imported_symbols, vec!["foo"]);
    assert_eq!(rs_hits[0].call_lines, vec![1]);

    let py_hits = find_workspace_callers("src/py_mod.py", Some("foo"), &rp_ws, &dir);
    assert_eq!(py_hits[0].imported_symbols, vec!["foo"]);
    assert_eq!(py_hits[0].call_lines, vec![1]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r10_js_regex_literals_division_and_tsx() {
    let reg = EngineRegistry::new();
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r10_c_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let files: &[(&str, LanguageId, &str, Vec<usize>)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\nexports.bar = () => 2;\n", vec![]),
        ("src/r1_rbrace.js", LanguageId::JavaScript, "const { foo = /}/, bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r2_lbrace_quotes.js", LanguageId::JavaScript, "const { foo = /{/, bar = /['\"`]/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r3_class_brace_slash.js", LanguageId::JavaScript, "const { foo = /[}]/, bar = /[/}]/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r4_class_comment.js", LanguageId::JavaScript, "const { foo = /[//]/, bar = /[/*]/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r5_class_brackets.js", LanguageId::JavaScript, "const { foo = /[[]/, bar = /[\\]]/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r6_escapes_semi.js", LanguageId::JavaScript, "const { foo = /\\//, bar = /a\\/b;/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r7_backslash_commas.js", LanguageId::JavaScript, "const { foo = /\\\\/, bar = /a,b=${x}:y=1/gi } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r8_tpl_regex.js", LanguageId::JavaScript, "const { foo = `${/}/}`, bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r9_div_basic.js", LanguageId::JavaScript, "const { foo = 10 / 2, bar = 20 / 5 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r10_div_paren_postinc.js", LanguageId::JavaScript, "const { foo = (a + b) / 2, bar = x++ / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r11_div_ml_afterdot.js", LanguageId::JavaScript, "const { foo = 10\n  / 2, bar = obj.return / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![3]),
        ("src/r12_cond_ret_div_regex.js", LanguageId::JavaScript, "const { foo = () => { if (ok) return /}/; }, bar = 10 / /a/.source.length } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r13_regex_div_utf8.js", LanguageId::JavaScript, "const { foo = /}/ / 2, bar = café / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![2]),
        ("src/r14_tsx_jsx.tsx", LanguageId::Tsx, "import './cjs_math';\nconst { foo = <div>a</div>, bar = <Comp a={1} /> } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n", vec![3]),
        ("src/r15_regex_body_suppress.js", LanguageId::JavaScript, "const { foo } = require('./cjs_math');\nconst re = /foo/g;\nfunction r() { return foo(); }\n", vec![3]),
    ];

    let mut ws = Vec::new();
    for (p, lang, src, _) in files {
        fs::write(dir.join(p), src).unwrap();
        ws.push(parse_input(&reg, p, *lang, src));
    }

    let foo_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &ws, &dir);
    let bar_hits = find_workspace_callers("src/cjs_math.js", Some("bar"), &ws, &dir);
    for (p, _, _, exp_lines) in &files[1..] {
        let fh = foo_hits.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing foo hit {p}: {foo_hits:?}"));
        assert_eq!(fh.call_lines, *exp_lines, "foo {p}: {fh:?}");
        if *p != "src/r15_regex_body_suppress.js" {
            assert_eq!(fh.imported_symbols, vec!["foo", "bar"], "foo {p}: {fh:?}");
            let bh = bar_hits.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing bar hit {p}: {bar_hits:?}"));
            assert_eq!(bh.imported_symbols, vec!["foo", "bar"], "bar {p}: {bh:?}");
            assert_eq!(bh.call_lines, *exp_lines, "bar {p}: {bh:?}");
        } else {
            assert_eq!(fh.imported_symbols, vec!["foo"], "foo {p}: {fh:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r11_tsx_jsx_slashes_for_of_and_ts_casts() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r11_a_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    // 1. TSX JSX child text slashes & nested containers
    type TsxCase<'a> = (&'a str, LanguageId, &'a str, Vec<usize>, Vec<usize>);
    let tsx_files: &[TsxCase<'_>] = &[
        ("src/math.ts", LanguageId::TypeScript, "export function foo() { return 1; }\nexport function bar() { return 2; }\n", vec![], vec![]),
        ("src/t1_multi_slash.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div>{foo()} / {bar()} / {foo()}</div>;\n", vec![2], vec![2]),
        ("src/t2_leading_trailing.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div>/ {foo()} /</div>;\n", vec![2], vec![]),
        ("src/t3_between_spans.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div><span>1</span> / {foo()} / <span>2</span></div>;\n", vec![2], vec![]),
        ("src/t4_after_br.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div><br /> / {foo()} /</div>;\n", vec![2], vec![]),
        ("src/t5_fragment.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <>{foo()} / {bar()} / {foo()}</>;\n", vec![2], vec![2]),
        ("src/t6_prop_regex_cb.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <Comp a={/}/} b={() => <div>{foo()} / {bar()} / {foo()}</div>} />;\n", vec![2], vec![2]),
        ("src/t7_comp_slash_expr.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div><Comp a={1} />/{foo()}/</div>;\n", vec![2], vec![]),
        ("src/t8_div_and_regex.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div>{foo() / bar()} {/}/.test('}') ? foo() : 0}</div>;\n", vec![2], vec![2]),
        ("src/t9_jsx_text_only.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div>/foo/bar</div>;\n", vec![], vec![]),
        ("src/t10_jsx_punct_comments.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <div>It's \"hi\" http://x.com /* c */ {foo()} / {bar()}</div>;\n", vec![2], vec![2]),
        ("src/t11_generic_jsx.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const C = () => <List<() => void>>{foo()} / {bar()}</List>;\n", vec![2], vec![2]),
        ("src/t12_tpl_jsx_rbrace.tsx", LanguageId::Tsx, "import { foo, bar } from './math.js';\nexport const s = `${<div>a {'}'} {foo()} / {bar()}</div>}`;\n", vec![2], vec![2]),
    ];
    let mut tsx_ws = Vec::new();
    for (p, lang, src, _, _) in tsx_files {
        fs::write(dir.join(p), src).unwrap();
        tsx_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let tsx_foo = find_workspace_callers("src/math.ts", Some("foo"), &tsx_ws, &dir);
    let tsx_bar = find_workspace_callers("src/math.ts", Some("bar"), &tsx_ws, &dir);
    for (p, _, _, exp_f, exp_b) in &tsx_files[1..] {
        let fh = tsx_foo.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing foo {p}: {tsx_foo:?}"));
        assert_eq!(fh.call_lines, *exp_f, "foo {p}: {fh:?}");
        let bh = tsx_bar.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing bar {p}: {tsx_bar:?}"));
        assert_eq!(bh.call_lines, *exp_b, "bar {p}: {bh:?}");
    }

    // 2. TSX generics, comparisons, JS `for (... of /}/)`, and non-TSX TS casts
    let cjs_files: &[(&str, LanguageId, &str)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\nexports.bar = () => 2;\n"),
        ("src/g1_tsx_arrow_generic.tsx", LanguageId::Tsx, "const { foo = <T,>(x: T) => /}/, bar = <T extends string>(y: T) => /{/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/g2_tsx_const_eq_generic.tsx", LanguageId::Tsx, "const { foo = <const T,>(x: T) => /}/, bar = <T = string>(y: T) => /{/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/g3_tsx_extends_quote_obj.tsx", LanguageId::Tsx, "const { foo = <T extends 'a'>(x: T) => /}/, bar = <T extends { a: 1 }>(y: T) => /{/ } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/g4_tsx_cmp.tsx", LanguageId::Tsx, "const { foo = (a < b && c > /}/), bar = (x > 1 ? /}/ : /{/) } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/f1_for_of.js", LanguageId::JavaScript, "const { foo = (() => { for (const x of /}/g.source) {} })(), bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/f2_for_of_obj.js", LanguageId::JavaScript, "const { foo = (() => { for (const { a } of [/}/g.source]) {} })(), bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/f3_for_of_arr.js", LanguageId::JavaScript, "const { foo = (() => { for (const [a] of [/}/g.source]) {} })(), bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/f4_for_await_of.js", LanguageId::JavaScript, "const { foo = (async () => { for await (const x of /}/g.source) {} }), bar } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/f5_ident_of_div.js", LanguageId::JavaScript, "const of = 10; const { foo = of / 2, bar = (() => { for (let x = of / 2; x < 1; x++) {} })() } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/c1_ts_angle_cast.ts", LanguageId::TypeScript, "const { foo = (<Foo>x) / 2, bar = <Foo>x / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/c2_ts_cast_regex.ts", LanguageId::TypeScript, "const { foo = <RegExp>/}/g.source, bar = <{ a: number }>x / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/c3_ts_as_satisfies.ts", LanguageId::TypeScript, "const { foo = (x as number) / 2, bar = (y satisfies number) / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
        ("src/c4_ts_call_generic_div.ts", LanguageId::TypeScript, "const { foo = fn<Foo>(x) / 2, bar = a < b / 2 } = require('./cjs_math');\nfunction r() { return foo() + bar(); }\n"),
    ];
    let mut cjs_ws = Vec::new();
    for (p, lang, src) in cjs_files {
        fs::write(dir.join(p), src).unwrap();
        cjs_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let cjs_foo = find_workspace_callers("src/cjs_math.js", Some("foo"), &cjs_ws, &dir);
    let cjs_bar = find_workspace_callers("src/cjs_math.js", Some("bar"), &cjs_ws, &dir);
    for (p, _, _) in &cjs_files[1..] {
        let fh = cjs_foo.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing foo {p}: {cjs_foo:?}"));
        assert_eq!(fh.imported_symbols, vec!["foo", "bar"], "foo {p}: {fh:?}");
        assert_eq!(fh.call_lines, vec![2], "foo {p}: {fh:?}");
        let bh = cjs_bar.iter().find(|h| h.caller_path == *p).unwrap_or_else(|| panic!("missing bar {p}: {cjs_bar:?}"));
        assert_eq!(bh.imported_symbols, vec!["foo", "bar"], "bar {p}: {bh:?}");
        assert_eq!(bh.call_lines, vec![2], "bar {p}: {bh:?}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r11_rust_and_python_callers() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r11_b_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src")).unwrap();

    let rs_files: &[(&str, &str, Vec<&str>, Vec<usize>)] = &[
        ("src/rs_math.rs", "pub fn foo() {}\npub fn bar() {}\n", vec![], vec![]),
        ("src/rs_x.rs", "pub fn a() {}\n", vec![], vec![]),
        ("src/r1_chars_before_use.rs", "const Q: char = '\"'; const B: char = '{'; const E: char = '\\''; const S: char = ';'; use crate::rs_math::foo as my_foo;\npub fn r() { my_foo(); }\n", vec!["foo"], vec![2]),
        ("src/r2_fn_char_then_use.rs", "fn is_q(c: char) -> bool { c == '\"' || c == '{' }\nuse crate::rs_math::foo;\npub fn r() { foo(); }\n", vec!["foo"], vec![3]),
        ("src/r3_raw_byte_char.rs", "const BR: &[u8] = br#\"a \" {\"#; const BC: u8 = b'\"'; use crate::rs_math::foo;\npub fn r() { foo(); }\n", vec!["foo"], vec![2]),
        ("src/r4_fn_local_use.rs", "pub fn main() { use crate::rs_math::foo as my_foo; my_foo(); }\n", vec!["foo"], vec![1]),
        ("src/r5_cfg_test_mod.rs", "#[cfg(test)]\nmod tests {\n    use crate::rs_math::foo as my_foo;\n    #[test]\n    fn t() { my_foo(); }\n}\n", vec!["foo"], vec![5]),
        ("src/r6_inline_mod.rs", "mod inner { use crate::rs_math::foo as my_foo; pub fn r() { my_foo(); } }\n", vec!["foo"], vec![1]),
        ("src/r7_attr_doc_use.rs", "#[allow(unused)]\n#[doc = \"use fake\"]\nuse crate::rs_math::foo as my_foo;\npub fn r() { my_foo(); }\n", vec!["foo"], vec![4]),
        ("src/r8_pub_super.rs", "pub(super) use crate::rs_math::foo as my_foo;\npub fn r() { my_foo(); }\n", vec!["foo"], vec![2]),
        ("src/r9_pub_in_group.rs", "pub(in crate::sub) use crate::rs_math::{foo as my_foo, bar};\npub fn r() { my_foo(); }\n", vec!["foo", "bar"], vec![2]),
        ("src/r10_multi_stmt_alias.rs", "use crate::rs_x::a; use crate::rs_math::foo as my_foo; pub fn r() { my_foo(); }\n", vec!["foo"], vec![1]),
    ];
    let mut rs_ws = Vec::new();
    for (p, src, _, _) in rs_files {
        fs::write(dir.join(p), src).unwrap();
        rs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Rust, src));
    }
    let rs_hits = find_workspace_callers("src/rs_math.rs", Some("foo"), &rs_ws, &dir);
    for (p, _, exp_syms, exp_lines) in &rs_files[2..] {
        let h = rs_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing Rust {p}: {rs_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "Rust syms {p}: {h:?}");
        assert_eq!(h.call_lines, *exp_lines, "Rust lines {p}: {h:?}");
    }

    let py_files: &[(&str, &str, Vec<&str>, Vec<usize>)] = &[
        ("src/py_mod.py", "def foo():\n    return 1\ndef bar():\n    return 2\n", vec![], vec![]),
        ("src/p1_bslash_nl.py", "from .py_mod \\\nimport foo\nfoo()\n", vec!["foo"], vec![3]),
        ("src/p2_bslash_crlf_alias.py", "from .py_mod \\\r\n  import foo as my_foo\r\nmy_foo()\n", vec!["foo"], vec![3]),
        ("src/p3_bslash_parens.py", "from .py_mod import \\\n  (foo, bar)\nfoo()\n", vec!["foo", "bar"], vec![3]),
        ("src/p4_bslash_nospace_paren.py", "from .py_mod \\\nimport(foo, bar)\nbar()\n", vec!["foo", "bar"], vec![3]),
    ];
    let mut py_ws = Vec::new();
    for (p, src, _, _) in py_files {
        fs::write(dir.join(p), src).unwrap();
        py_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Python, src));
    }
    let py_foo = find_workspace_callers("src/py_mod.py", Some("foo"), &py_ws, &dir);
    for (p, _, exp_syms, exp_lines) in &py_files[1..4] {
        let h = py_foo.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing Py foo {p}: {py_foo:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "Py syms {p}: {h:?}");
        assert_eq!(h.call_lines, *exp_lines, "Py lines {p}: {h:?}");
    }
    let py_bar = find_workspace_callers("src/py_mod.py", Some("bar"), &py_ws, &dir);
    let p4 = py_bar.iter().find(|x| x.caller_path == "src/p4_bslash_nospace_paren.py").unwrap();
    assert_eq!(p4.imported_symbols, vec!["foo", "bar"]);
    assert_eq!(p4.call_lines, vec![3]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r11_other_langs_cjs_prop_and_long_spans() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r11_c_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for sub in ["src/App", "src/pkg", "app/math", "include/pkg", "db"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }

    // 1. PHP (require_once, use, group use, closure use NOT masked)
    let php_files: &[(&str, &str)] = &[
        ("src/php_math.php", "<?php\nfunction foo() { return 1; }\n"),
        ("src/App/Math.php", "<?php\nnamespace App\\Math;\nclass Foo {}\nfunction foo() { return 1; }\n"),
        ("src/php_req_same_line.php", "<?php\nrequire_once './php_math.php'; foo();\n"),
        ("src/php_closure_use.php", "<?php\nrequire_once './php_math.php';\n$f = function () use ($x) { return foo(); };\n"),
        ("src/php_use_cls.php", "<?php use App\\Math\\Foo; new Foo();\n"),
        ("src/php_use_fn.php", "<?php\nuse App\\Math\\foo; foo();\n"),
        ("src/php_use_group.php", "<?php\nuse App\\Math\\{foo as myFoo}; myFoo();\n"),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    let php_req_foo = find_workspace_callers("src/php_math.php", Some("foo"), &php_ws, &dir);
    let php_req_any = find_workspace_callers("src/php_math.php", None, &php_ws, &dir);
    for (p, line) in [("src/php_req_same_line.php", 2usize), ("src/php_closure_use.php", 3)] {
        assert_eq!(php_req_foo.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![line], "{p}");
        assert_eq!(php_req_any.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![line], "{p}");
    }
    let php_cls_hits = find_workspace_callers("src/App/Math.php", Some("Foo"), &php_ws, &dir);
    assert_eq!(php_cls_hits.iter().find(|h| h.caller_path == "src/php_use_cls.php").unwrap().call_lines, vec![1]);
    let php_fn_hits = find_workspace_callers("src/App/Math.php", Some("foo"), &php_ws, &dir);
    assert_eq!(php_fn_hits.iter().find(|h| h.caller_path == "src/php_use_fn.php").unwrap().call_lines, vec![2]);
    assert_eq!(php_fn_hits.iter().find(|h| h.caller_path == "src/php_use_group.php").unwrap().call_lines, vec![2]);
    let php_any_hits = find_workspace_callers("src/App/Math.php", None, &php_ws, &dir);
    assert_eq!(php_any_hits.iter().find(|h| h.caller_path == "src/php_use_group.php").unwrap().call_lines, vec![2]);

    // 2. C# (using same-line, using static, using (...) / using var NOT masked)
    let cs_files: &[(&str, &str)] = &[
        ("src/MyNs.cs", "namespace MyNs { public class Math { public static void foo() {} } public class Foo { public static void Bar() {} public static Foo Open() => new Foo(); } }\n"),
        ("src/cs_using.cs", "using MyNs; class C { void M() { Foo.Bar(); } }\n"),
        ("src/cs_static.cs", "using static MyNs.Math; class C2 { void M() { foo(); } }\n"),
        ("src/cs_stmt.cs", "using MyNs;\nclass C3 { void M() {\nusing (var x = Foo.Open()) {}\nusing var y = Foo.Open();\n} }\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    let cs_foo = find_workspace_callers("src/MyNs.cs", Some("Foo"), &cs_ws, &dir);
    assert_eq!(cs_foo.iter().find(|h| h.caller_path == "src/cs_using.cs").unwrap().call_lines, vec![1]);
    assert_eq!(cs_foo.iter().find(|h| h.caller_path == "src/cs_stmt.cs").unwrap().call_lines, vec![3, 4]);
    let cs_fn = find_workspace_callers("src/MyNs.cs", Some("foo"), &cs_ws, &dir);
    assert_eq!(cs_fn.iter().find(|h| h.caller_path == "src/cs_static.cs").unwrap().call_lines, vec![1]);

    // 3. Java & Kotlin
    let jv_files: &[(&str, LanguageId, &str)] = &[
        ("src/pkg/Math.java", LanguageId::Java, "package pkg; public class Math { public static void foo() {} }\n"),
        ("src/jv_same.java", LanguageId::Java, "package p; import pkg.Math; class C { void m() { Math.foo(); } }\n"),
        ("src/jv_static.java", LanguageId::Java, "import static pkg.Math.foo; class C2 { void m() { foo(); } }\n"),
    ];
    let mut jv_ws = Vec::new();
    for (p, lang, src) in jv_files {
        fs::write(dir.join(p), src).unwrap();
        jv_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let jv_hits = find_workspace_callers("src/pkg/Math.java", Some("foo"), &jv_ws, &dir);
    let jv_any = find_workspace_callers("src/pkg/Math.java", None, &jv_ws, &dir);
    for p in ["src/jv_same.java", "src/jv_static.java"] {
        assert_eq!(jv_hits.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![1], "{p}");
        assert_eq!(jv_any.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![1], "{p}");
    }

    let kt_files: &[(&str, &str)] = &[
        ("src/pkg/Math.kt", "package pkg\nclass Math {\n    fun foo() {}\n}\n"),
        ("src/kt_alias_ns.kt", "import pkg.Math as M; fun f() { M.foo() }\n"),
        ("src/kt_alias_fn.kt", "import pkg.Math.foo as myFoo\nfun f() { myFoo() }\n"),
    ];
    let mut kt_ws = Vec::new();
    for (p, src) in kt_files {
        fs::write(dir.join(p), src).unwrap();
        kt_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Kotlin, src));
    }
    let kt_hits = find_workspace_callers("src/pkg/Math.kt", Some("foo"), &kt_ws, &dir);
    let kt_any = find_workspace_callers("src/pkg/Math.kt", None, &kt_ws, &dir);
    assert_eq!(kt_hits.iter().find(|h| h.caller_path == "src/kt_alias_ns.kt").unwrap().call_lines, vec![1]);
    assert_eq!(kt_any.iter().find(|h| h.caller_path == "src/kt_alias_ns.kt").unwrap().call_lines, vec![1]);
    assert_eq!(kt_hits.iter().find(|h| h.caller_path == "src/kt_alias_fn.kt").unwrap().call_lines, vec![2]);
    assert_eq!(kt_any.iter().find(|h| h.caller_path == "src/kt_alias_fn.kt").unwrap().call_lines, vec![2]);

    // 4. Ruby, Go, C/C++, and SQL (lowercase `from`)
    let rb_files: &[(&str, &str)] = &[
        ("src/rb_math.rb", "def foo; 1; end\n"),
        ("src/rb_caller.rb", "require_relative './rb_math'; foo()\n"),
    ];
    let mut rb_ws = Vec::new();
    for (p, src) in rb_files {
        fs::write(dir.join(p), src).unwrap();
        rb_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Ruby, src));
    }
    assert_eq!(find_workspace_callers("src/rb_math.rb", Some("foo"), &rb_ws, &dir)[0].call_lines, vec![1]);
    assert_eq!(find_workspace_callers("src/rb_math.rb", None, &rb_ws, &dir)[0].call_lines, vec![1]);

    let go_files: &[(&str, &str)] = &[
        ("app/math/ops.go", "package math\nfunc Foo() {}\n"),
        ("src/go_same.go", "package main\nimport \"app/math\"; func f() { math.Foo() }\n"),
        ("src/go_alias.go", "package main\nimport m \"app/math\"\nfunc f() { m.Foo() }\n"),
    ];
    let mut go_ws = Vec::new();
    for (p, src) in go_files {
        fs::write(dir.join(p), src).unwrap();
        go_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Go, src));
    }
    let go_hits = find_workspace_callers("app/math/ops.go", Some("Foo"), &go_ws, &dir);
    let go_any = find_workspace_callers("app/math/ops.go", None, &go_ws, &dir);
    assert_eq!(go_hits.iter().find(|h| h.caller_path == "src/go_same.go").unwrap().call_lines, vec![2]);
    assert_eq!(go_any.iter().find(|h| h.caller_path == "src/go_same.go").unwrap().call_lines, vec![2]);
    assert_eq!(go_hits.iter().find(|h| h.caller_path == "src/go_alias.go").unwrap().call_lines, vec![3]);
    assert_eq!(go_any.iter().find(|h| h.caller_path == "src/go_alias.go").unwrap().call_lines, vec![3]);

    let c_files: &[(&str, &str)] = &[
        ("include/pkg/foo.h", "void foo(void);\n"),
        ("src/c_inc_only.c", "#include <pkg/foo.h>\nvoid g(void) {}\n"),
    ];
    let mut c_ws = Vec::new();
    for (p, src) in c_files {
        fs::write(dir.join(p), src).unwrap();
        c_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::C, src));
    }
    assert!(find_workspace_callers("include/pkg/foo.h", Some("foo"), &c_ws, &dir).is_empty());

    let cpp_files: &[(&str, &str)] = &[
        ("include/math.hpp", "namespace math { void foo() {} }\n"),
        ("src/cpp_using.cpp", "#include \"math.hpp\"\nusing namespace math; void f() { foo(); }\n"),
    ];
    let mut cpp_ws = Vec::new();
    for (p, src) in cpp_files {
        fs::write(dir.join(p), src).unwrap();
        cpp_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Cpp, src));
    }
    assert_eq!(find_workspace_callers("include/math.hpp", Some("foo"), &cpp_ws, &dir)[0].call_lines, vec![2]);
    assert_eq!(find_workspace_callers("include/math.hpp", None, &cpp_ws, &dir)[0].call_lines, vec![2]);

    let sql_files: &[(&str, &str)] = &[
        ("db/accounts.sql", "CREATE TABLE accounts (id INT PRIMARY KEY);\n"),
        ("db/q.sql", "select id\nfrom accounts;\n"),
    ];
    let mut sql_ws = Vec::new();
    for (p, src) in sql_files {
        fs::write(dir.join(p), src).unwrap();
        sql_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::PostgreSql, src));
    }
    let sql_hits = find_workspace_callers("db/accounts.sql", Some("accounts"), &sql_ws, &dir);
    assert_eq!(sql_hits[0].call_lines, vec![2]);

    // 5. Minor Note 1 (non-target require('./other').foo()) & >64-line CJS/ESM imports
    let mut long_cjs = String::from("const {\n");
    let mut long_esm = String::from("import {\n");
    for k in 0..72 {
        long_cjs.push_str(&format!("  s{k},\n"));
        long_esm.push_str(&format!("  s{k},\n"));
    }
    long_cjs.push_str("  foo,\n} = require('./cjs_math');\nfoo();\n");
    long_esm.push_str("  foo,\n} from './math.js';\nfoo();\n");

    let js_long_files: &[(&str, LanguageId, &str, Vec<usize>)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\n", vec![]),
        ("src/other.js", LanguageId::JavaScript, "exports.foo = (x) => x;\n", vec![]),
        ("src/math.ts", LanguageId::TypeScript, "export function foo() { return 1; }\n", vec![]),
        ("src/mn1_no_fp.js", LanguageId::JavaScript, "const { foo } = require('./cjs_math');\nconst x = require('./other').foo();\nrequire('./other').foo();\nconst { a } = require('./other').foo();\nif (x === require('./other').foo) {}\n", vec![]),
        ("src/mn1_arg_hit.js", LanguageId::JavaScript, "const { foo } = require('./cjs_math');\nconst x = require('./other').foo(foo());\n", vec![2]),
        ("src/long_cjs.js", LanguageId::JavaScript, &long_cjs, vec![76]),
        ("src/long_esm.ts", LanguageId::TypeScript, &long_esm, vec![76]),
    ];
    let mut long_ws = Vec::new();
    for (p, lang, src, _) in js_long_files {
        fs::write(dir.join(p), src).unwrap();
        long_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let long_cjs_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &long_ws, &dir);
    for (p, _, _, exp) in &js_long_files[3..6] {
        let h = long_cjs_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {long_cjs_hits:?}"));
        assert!(h.imported_symbols.contains(&"foo".to_string()), "{p}: {h:?}");
        assert_eq!(h.call_lines, *exp, "{p}: {h:?}");
    }
    let long_esm_hits = find_workspace_callers("src/math.ts", Some("foo"), &long_ws, &dir);
    let h_esm = long_esm_hits.iter().find(|x| x.caller_path == "src/long_esm.ts").unwrap();
    assert!(h_esm.imported_symbols.contains(&"foo".to_string()));
    assert_eq!(h_esm.call_lines, vec![76]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r12_js_ts_deps_exts_alias_block_scope_php_cpp_and_cjs_generics() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r12_all_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for sub in ["src/App/Math", "src/dir", "src/pkg", "app/math", "include"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }

    // 1. JS/TS extract_dependencies: dedup, static require, template require, import = require(...)
    let imp_targets = |lang: LanguageId, p: &str, src: &str| -> Vec<String> {
        verify_and_parse(&reg, &fw, p, lang, src)
            .edges
            .into_iter()
            .filter(|e| e.kind == DepKind::Import)
            .map(|e| e.target)
            .collect()
    };
    for (lang, ext) in [(LanguageId::TypeScript, "ts"), (LanguageId::Tsx, "tsx"), (LanguageId::JavaScript, "js")] {
        let mixed = "import { a } from './x';\nconst b = require('./x');\nimport { c } from './y';\n";
        assert_eq!(imp_targets(lang, &format!("src/dedup_mix.{ext}"), mixed), vec!["./x", "./y"]);
        let dup_req = "const a = require('./x');\nconst b = require('./x');\n";
        assert_eq!(imp_targets(lang, &format!("src/dedup_req.{ext}"), dup_req), vec!["./x"]);
        let dyn_req = "const a = require(modName);\nconst b = require(`./dir/${name}`);\nconst c = require(`./tpl`);\n";
        assert_eq!(imp_targets(lang, &format!("src/dyn_req.{ext}"), dyn_req), vec!["./tpl"]);
    }
    for (lang, ext) in [(LanguageId::TypeScript, "ts"), (LanguageId::Tsx, "tsx")] {
        let ts_type_dup = "import type { T } from './x';\nimport { v } from './x';\n";
        assert_eq!(imp_targets(lang, &format!("src/type_dup.{ext}"), ts_type_dup), vec!["./x"]);
        let ts_req_clause = "import mod = require('./legacy');\nimport Alias = Ns.Member;\n";
        assert_eq!(imp_targets(lang, &format!("src/req_clause.{ext}"), ts_req_clause), vec!["./legacy"]);
    }

    // 2. .mts/.cts/.mjs/.cjs & @/ local miss classification
    let res_files = vec![
        verify_and_parse(&reg, &fw, "src/main.ts", LanguageId::TypeScript, "export const m = 1;\n"),
        verify_and_parse(&reg, &fw, "src/a.ts", LanguageId::TypeScript, "export const a = 1;\n"),
        verify_and_parse(&reg, &fw, "src/b.mjs", LanguageId::JavaScript, "export const b = 2;\n"),
        verify_and_parse(&reg, &fw, "src/c.cjs", LanguageId::JavaScript, "exports.c = 3;\n"),
        verify_and_parse(&reg, &fw, "src/dir/index.mts", LanguageId::TypeScript, "export const d = 4;\n"),
        verify_and_parse(&reg, &fw, "src/utils.ts", LanguageId::TypeScript, "export const u = 5;\n"),
        verify_and_parse(&reg, &fw, "src/entry.tsx", LanguageId::Tsx, "export const e = 6;\n"),
        verify_and_parse(&reg, &fw, "src/entry.js", LanguageId::JavaScript, "export const j = 7;\n"),
    ];
    let idx = WorkspaceIndex::build(&res_files, &dir);
    let edge = |t: &str| DepEdge { source: "module".into(), target: t.into(), kind: DepKind::Import };
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("./a.mts"), &idx, &dir), ResolveOutcome::WorkspaceFile("src/a.ts".into()));
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("./b"), &idx, &dir), ResolveOutcome::WorkspaceFile("src/b.mjs".into()));
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("./c"), &idx, &dir), ResolveOutcome::WorkspaceFile("src/c.cjs".into()));
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("./dir"), &idx, &dir), ResolveOutcome::WorkspaceFile("src/dir/index.mts".into()));
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("@/utils"), &idx, &dir), ResolveOutcome::WorkspaceFile("src/utils.ts".into()));
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("@/missing_alias"), &idx, &dir), ResolveOutcome::MissingLocal);
    assert_eq!(resolve_dep_edge(6, &res_files[6], &edge("@/missing_alias"), &idx, &dir), ResolveOutcome::MissingLocal);
    assert_eq!(resolve_dep_edge(7, &res_files[7], &edge("@/missing_alias"), &idx, &dir), ResolveOutcome::MissingLocal);
    assert_eq!(resolve_dep_edge(0, &res_files[0], &edge("@scope/pkg"), &idx, &dir), ResolveOutcome::ExternalPackage);

    // 3. Block scope, PHP group use + CI PHP + >128L, C# using static\t + alias, C++ generic alias, Go >128L
    let mut long_php = String::from("<?php\nuse App\\Math\\{\n");
    for k in 0..135 {
        long_php.push_str(&format!("  const C{k},\n"));
    }
    long_php.push_str("  function foo as myFoo\n};\nmyFoo();\n");
    let php_files: &[(&str, &str)] = &[
        ("src/php_math.php", "<?php\nfunction foo() { return 1; }\n"),
        ("src/App/Math.php", "<?php\nnamespace App\\Math;\nfunction foo() { return 1; }\nconst BAR = 2;\n"),
        ("src/App/Math/Foo.php", "<?php\nnamespace App\\Math;\nclass Foo {}\n"),
        ("src/php_ns_blk.php", "<?php\nnamespace Consumer { use App\\Math\\foo as myFoo;\nmyFoo(); }\n"),
        ("src/php_grp_fn.php", "<?php\nuse App\\Math\\{function foo as myFoo, const BAR};\nmyFoo();\n"),
        ("src/php_ci.php", "<?PHP\nnamespace Consumer { USE App\\Math\\{FUNCTION foo AS myFoo, CONST BAR};\nmyFoo(); }\n"),
        ("src/php_ci_psr4.php", "<?php\nUSE App\\Math\\Foo AS MyFoo;\nnew MyFoo();\n"),
        ("src/php_grp_nested_fn.php", "<?php\nuse App\\{function Math\\foo AS myFoo};\nmyFoo();\n"),
        ("src/php_trait_guard.php", "<?php\nrequire_once './php_math.php';\nclass C { use SomeTrait { SomeTrait::a insteadof B; }\npublic function r() { return foo(); } }\n"),
        ("src/php_ns_closure.php", "<?php\nnamespace Consumer { use App\\Math\\foo as myFoo;\n$f = function () use ($x) {\nreturn myFoo(); }; }\n"),
        ("src/php_long_use.php", &long_php),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    let php_foo = find_workspace_callers("src/App/Math.php", Some("foo"), &php_ws, &dir);
    for (p, exp_line) in [
        ("src/php_ns_blk.php", 3usize),
        ("src/php_grp_fn.php", 3),
        ("src/php_ci.php", 3),
        ("src/php_grp_nested_fn.php", 3),
        ("src/php_ns_closure.php", 4),
        ("src/php_long_use.php", 140),
    ] {
        let h = php_foo.iter().find(|x| x.caller_path == p).unwrap_or_else(|| panic!("missing PHP {p}: {php_foo:?}"));
        assert!(h.imported_symbols.contains(&"foo".to_string()), "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![exp_line], "{p}: {h:?}");
    }
    let php_psr4 = find_workspace_callers("src/App/Math/Foo.php", Some("Foo"), &php_ws, &dir);
    let h_psr4 = php_psr4.iter().find(|x| x.caller_path == "src/php_ci_psr4.php").unwrap();
    assert_eq!(h_psr4.imported_symbols, vec!["Foo", "*"]);
    assert_eq!(h_psr4.call_lines, vec![3]);
    let php_order = order_files_topologically(&[php_ws[6].clone(), php_ws[2].clone()], &dir);
    assert_eq!(php_order, vec!["src/App/Math/Foo.php", "src/php_ci_psr4.php"]);
    let php_trait = find_workspace_callers("src/php_math.php", Some("foo"), &php_ws, &dir);
    assert_eq!(php_trait.iter().find(|x| x.caller_path == "src/php_trait_guard.php").unwrap().call_lines, vec![4]);

    let cs_files: &[(&str, &str)] = &[
        ("src/MyNs.cs", "namespace MyNs { public class Math { public static void foo() {} } public class Foo { public static void Bar() {} public static Foo Open() => new Foo(); } public class Box<T> {} }\n"),
        ("src/cs_ns_blk.cs", "namespace Consumer {\n  using MyNs;\n  class C { void M() { Foo.Bar(); } }\n}\n"),
        ("src/cs_tab.cs", "using static\tMyNs.Math;\nclass C { void M() { foo(); } }\n"),
        ("src/cs_nl.cs", "using static\nMyNs.Math;\nclass C { void M() { foo(); } }\n"),
        ("src/cs_alias_gen.cs", "using IntBox = MyNs.Box<int>;\nclass C { void M() { IntBox b = new IntBox(); } }\n"),
        ("src/cs_ns_guard.cs", "namespace Consumer {\n  using MyNs;\n  class C { void M() {\n    using (var x = Foo.Open()) { Foo.Bar(); }\n    using var y = Foo.Open();\n  } }\n}\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    let cs_foo = find_workspace_callers("src/MyNs.cs", Some("Foo"), &cs_ws, &dir);
    assert_eq!(cs_foo.iter().find(|x| x.caller_path == "src/cs_ns_blk.cs").unwrap().call_lines, vec![3]);
    assert_eq!(cs_foo.iter().find(|x| x.caller_path == "src/cs_ns_guard.cs").unwrap().call_lines, vec![4, 5]);
    let cs_fn = find_workspace_callers("src/MyNs.cs", Some("foo"), &cs_ws, &dir);
    assert_eq!(cs_fn.iter().find(|x| x.caller_path == "src/cs_tab.cs").unwrap().call_lines, vec![2]);
    assert_eq!(cs_fn.iter().find(|x| x.caller_path == "src/cs_nl.cs").unwrap().call_lines, vec![3]);
    let cs_box = find_workspace_callers("src/MyNs.cs", Some("Box"), &cs_ws, &dir);
    let h_cs_box = cs_box.iter().find(|x| x.caller_path == "src/cs_alias_gen.cs").unwrap();
    assert!(h_cs_box.imported_symbols.contains(&"Box".to_string()));
    assert_eq!(h_cs_box.call_lines, vec![2]);

    let cpp_files: &[(&str, &str)] = &[
        ("include/math.hpp", "namespace ns { template<typename T> struct Box {}; }\nnamespace math { void foo() {} }\n"),
        ("src/cpp_fn_blk.cpp", "#include \"math.hpp\"\nvoid f() {\n  using namespace math;\n  foo();\n}\n"),
        ("src/cpp_ns_blk.cpp", "#include \"math.hpp\"\nnamespace app {\n  using math::foo;\n  void f() { foo(); }\n}\n"),
        ("src/cpp_tab.cpp", "#include \"math.hpp\"\nusing namespace\tmath;\nvoid f() { foo(); }\n"),
        ("src/cpp_gen_alias.cpp", "#include \"math.hpp\"\nusing Alias = ns::Box<int>;\nvoid f() { Alias a; }\n"),
        ("src/cpp_nested_gen.cpp", "#include \"math.hpp\"\nusing Alias2 = ns::Box<ns2::Item>;\nvoid g() { Alias2 b; }\n"),
    ];
    let mut cpp_ws = Vec::new();
    for (p, src) in cpp_files {
        fs::write(dir.join(p), src).unwrap();
        cpp_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Cpp, src));
    }
    let cpp_foo = find_workspace_callers("include/math.hpp", Some("foo"), &cpp_ws, &dir);
    assert_eq!(cpp_foo.iter().find(|x| x.caller_path == "src/cpp_fn_blk.cpp").unwrap().call_lines, vec![4]);
    assert_eq!(cpp_foo.iter().find(|x| x.caller_path == "src/cpp_ns_blk.cpp").unwrap().call_lines, vec![4]);
    assert_eq!(cpp_foo.iter().find(|x| x.caller_path == "src/cpp_tab.cpp").unwrap().call_lines, vec![3]);
    let cpp_box = find_workspace_callers("include/math.hpp", Some("Box"), &cpp_ws, &dir);
    for (p, line) in [("src/cpp_gen_alias.cpp", 3usize), ("src/cpp_nested_gen.cpp", 3)] {
        let h = cpp_box.iter().find(|x| x.caller_path == p).unwrap_or_else(|| panic!("missing C++ {p}: {cpp_box:?}"));
        assert!(h.imported_symbols.contains(&"Box".to_string()), "{p}: {h:?}");
        assert!(!h.imported_symbols.iter().any(|s| s.contains('<') || s.contains('>')), "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![line], "{p}: {h:?}");
    }

    let mut long_go = String::from("package main\nimport (\n");
    for k in 0..135 {
        long_go.push_str(&format!("  _ \"fmt{k}\"\n"));
    }
    long_go.push_str("  m \"app/math\"\n)\nfunc f() { m.Foo() }\n");
    let go_ws = vec![
        verify_and_parse(&reg, &fw, "app/math/ops.go", LanguageId::Go, "package math\nfunc Foo() {}\n"),
        verify_and_parse(&reg, &fw, "src/go_long.go", LanguageId::Go, &long_go),
    ];
    fs::write(dir.join("app/math/ops.go"), "package math\nfunc Foo() {}\n").unwrap();
    fs::write(dir.join("src/go_long.go"), &long_go).unwrap();
    let go_hits = find_workspace_callers("app/math/ops.go", Some("Foo"), &go_ws, &dir);
    assert_eq!(go_hits[0].imported_symbols, vec!["*"]);
    assert_eq!(go_hits[0].call_lines, vec![140]);

    // 4. CJS arrow/async/return/function* generic defaults & comparison non-regression
    let cjs_files: &[(&str, LanguageId, &str, Vec<&str>)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\nexports.bar = () => 2;\n", vec![]),
        ("src/cjs_arrow_gen.ts", LanguageId::TypeScript, "const { foo = () => <T, U = string>(x: T) => x } = require('./cjs_math');\nfoo();\n", vec!["foo"]),
        ("src/cjs_async_gen.ts", LanguageId::TypeScript, "const { foo = async <T, U = string>(x: T) => x } = require('./cjs_math');\nfoo();\n", vec!["foo"]),
        ("src/cjs_fn_gen.ts", LanguageId::TypeScript, "const { foo = x => <T, U = string>(y: T) => y, bar: myBar = function<A, B = number>(a: A) { return a; } } = require('./cjs_math');\nfoo(); myBar();\n", vec!["foo", "bar"]),
        ("src/cjs_gen_star.ts", LanguageId::TypeScript, "const { foo = function* <T, U = number>(x: T) { yield x; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_ret_gen.ts", LanguageId::TypeScript, "const { foo = () => { return <T, U = string>(x: T) => x; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_paren_lt.js", LanguageId::JavaScript, "const { foo = (x) < b, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_str_lt.js", LanguageId::JavaScript, "const { foo = 'a' < b, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_cmp_pair.js", LanguageId::JavaScript, "const { foo = a < b, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_call_typeargs.ts", LanguageId::TypeScript, "const { foo = fn<A, B>(x), bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_trailing_comma_regex.ts", LanguageId::TypeScript, "const { foo = <T,>(x: T) => /}/, bar = <T = () => 1, U = 2>(x: T) => x } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
    ];
    let mut cjs_ws = Vec::new();
    for (p, lang, src, _) in cjs_files {
        fs::write(dir.join(p), src).unwrap();
        cjs_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let cjs_foo = find_workspace_callers("src/cjs_math.js", Some("foo"), &cjs_ws, &dir);
    for (p, _, _, exp_syms) in &cjs_files[1..] {
        let h = cjs_foo.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing CJS {p}: {cjs_foo:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![2], "{p}: {h:?}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r13_cpp_csharp_mismatch_ns_and_nested_generics() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r13_cpp_cs_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("include")).unwrap();
    fs::create_dir_all(dir.join("src")).unwrap();

    let cpp_files: &[(&str, &str)] = &[
        ("include/math.hpp", "namespace ns { int ns_foo() { return 2; } template<typename T> struct NsBox { T v; }; }\n"),
        ("include/item.hpp", "namespace ns2 { struct Item { int x; }; }\n"),
        ("include/ab.hpp", "namespace a { namespace b {} }\n"),
        ("include/other.hpp", "namespace a { namespace c {} }\n"),
        ("src/cpp_alias2_nested.cpp", "#include \"math.hpp\"\n#include \"item.hpp\"\nusing Alias2 = ns::NsBox<ns2::Item>;\nAlias2 x;\n"),
        ("src/cpp_alias2_both.cpp", "#include \"math.hpp\"\n#include \"item.hpp\"\nusing Alias2 = ns::NsBox<ns2::Item>;\nAlias2 x;\nns2::Item y;\n"),
        ("src/cpp_mismatch_using_ns_only.cpp", "#include \"math.hpp\"\nvoid f() {\nusing namespace ns;\nns_foo();\n}\n"),
        ("src/cpp_both_ns_and_alias.cpp", "#include \"math.hpp\"\nusing Alias = ns::NsBox<int>;\nvoid f() {\nusing namespace ns;\nAlias a;\nns_foo();\n}\n"),
        ("src/cpp_ns_neg.cpp", "#include \"ab.hpp\"\n#include \"other.hpp\"\nvoid f() { using namespace a::c; }\n"),
    ];
    let mut cpp_ws = Vec::new();
    for (p, src) in cpp_files {
        fs::write(dir.join(p), src).unwrap();
        cpp_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Cpp, src));
    }

    let math_box = find_workspace_callers("include/math.hpp", Some("NsBox"), &cpp_ws, &dir);
    assert_eq!(math_box.iter().find(|h| h.caller_path == "src/cpp_alias2_nested.cpp").unwrap().call_lines, vec![4]);
    let math_foo = find_workspace_callers("include/math.hpp", Some("ns_foo"), &cpp_ws, &dir);
    let h_ns_only = math_foo.iter().find(|h| h.caller_path == "src/cpp_mismatch_using_ns_only.cpp").unwrap();
    assert_eq!(h_ns_only.imported_symbols, vec!["*"]);
    assert_eq!(h_ns_only.call_lines, vec![4]);
    let h_both = math_foo.iter().find(|h| h.caller_path == "src/cpp_both_ns_and_alias.cpp").unwrap();
    assert_eq!(h_both.imported_symbols, vec!["NsBox", "*"]);
    assert_eq!(h_both.call_lines, vec![6]);
    let math_all = find_workspace_callers("include/math.hpp", None, &cpp_ws, &dir);
    assert_eq!(math_all.iter().find(|h| h.caller_path == "src/cpp_both_ns_and_alias.cpp").unwrap().call_lines, vec![5, 6]);

    let item_sym = find_workspace_callers("include/item.hpp", Some("Item"), &cpp_ws, &dir);
    assert!(!item_sym.iter().any(|h| h.caller_path == "src/cpp_alias2_nested.cpp"));
    let h_item_both = item_sym.iter().find(|h| h.caller_path == "src/cpp_alias2_both.cpp").unwrap();
    assert!(h_item_both.imported_symbols.is_empty());
    assert_eq!(h_item_both.call_lines, vec![5]);
    let item_all = find_workspace_callers("include/item.hpp", None, &cpp_ws, &dir);
    let h_item_nested_all = item_all.iter().find(|h| h.caller_path == "src/cpp_alias2_nested.cpp").unwrap();
    assert!(h_item_nested_all.imported_symbols.is_empty());
    assert!(h_item_nested_all.call_lines.is_empty());
    let h_item_both_all = item_all.iter().find(|h| h.caller_path == "src/cpp_alias2_both.cpp").unwrap();
    assert!(h_item_both_all.imported_symbols.is_empty());
    assert_eq!(h_item_both_all.call_lines, vec![5]);

    let ab_all = find_workspace_callers("include/ab.hpp", None, &cpp_ws, &dir);
    assert!(ab_all.iter().find(|h| h.caller_path == "src/cpp_ns_neg.cpp").unwrap().imported_symbols.is_empty());

    let cs_files: &[(&str, &str)] = &[
        ("src/MyTypes.cs", "namespace MyNs { public class Box<T> {} public static class Math { public static void foo() {} } }\n"),
        ("src/ItemTypes.cs", "namespace Ns2 { public class Item {} }\n"),
        ("src/cs_mismatch_alias.cs", "using Alias = MyNs.Box<int>;\nclass C { void M() { Alias x = new Alias(); } }\n"),
        ("src/cs_mismatch_static.cs", "using static\tMyNs.Math;\nclass C { void M() { foo(); } }\n"),
        ("src/cs_alias2_both.cs", "using Alias2 = MyNs.Box<Ns2.Item>;\nclass C { void M() { Alias2 x = new Alias2(); Ns2.Item y = new Ns2.Item(); } }\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    let cs_box = find_workspace_callers("src/MyTypes.cs", Some("Box"), &cs_ws, &dir);
    assert_eq!(cs_box.iter().find(|h| h.caller_path == "src/cs_mismatch_alias.cs").unwrap().imported_symbols, vec!["Box", "*"]);
    assert_eq!(cs_box.iter().find(|h| h.caller_path == "src/cs_alias2_both.cs").unwrap().call_lines, vec![2]);
    let cs_foo = find_workspace_callers("src/MyTypes.cs", Some("foo"), &cs_ws, &dir);
    let h_cs_st = cs_foo.iter().find(|h| h.caller_path == "src/cs_mismatch_static.cs").unwrap();
    assert_eq!(h_cs_st.imported_symbols, vec!["*"]);
    assert_eq!(h_cs_st.call_lines, vec![2]);
    let cs_item = find_workspace_callers("src/ItemTypes.cs", Some("Item"), &cs_ws, &dir);
    let h_cs_item = cs_item.iter().find(|h| h.caller_path == "src/cs_alias2_both.cs").unwrap();
    assert!(h_cs_item.imported_symbols.is_empty());
    assert_eq!(h_cs_item.call_lines, vec![2]);
    let cs_item_all = find_workspace_callers("src/ItemTypes.cs", None, &cs_ws, &dir);
    assert_eq!(cs_item_all.iter().find(|h| h.caller_path == "src/cs_alias2_both.cs").unwrap().call_lines, vec![2]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r13_java_kotlin_dart_ruby_bash() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r13_jvm_dart_rb_sh_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for sub in ["src", "lib", "scripts"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }

    // 1. Java mismatched stem + >128L commented import + isolation from Other.java
    let mut long_java = String::from("import\n");
    for k in 0..140 {
        long_java.push_str(&format!("  // pad {k}\n"));
    }
    long_java.push_str("  com.acme.core.Widget;\npublic class LongApp { void run() { new Widget(); } }\n");
    let java_files: &[(&str, &str)] = &[
        ("src/MyFile.java", "package com.acme.core;\npublic class Widget { public static Widget make() { return new Widget(); } }\n"),
        ("src/Other.java", "package com.acme.core;\npublic class Other {}\n"),
        ("src/App.java", "import com.acme.core.Widget;\npublic class App { void run() { new Widget(); } }\n"),
        ("src/StaticCall.java", "import com.acme.core.Widget;\npublic class StaticCall { void run() { Widget.make(); } }\n"),
        ("src/StarApp.java", "import com.acme.core.*;\npublic class StarApp { void run() { new Widget(); } }\n"),
        ("src/StaticMakeApp.java", "import static com.acme.core.Widget.make;\npublic class StaticMakeApp { void run() { make(); } }\n"),
        ("src/StaticStarApp.java", "import static com.acme.core.Widget.*;\npublic class StaticStarApp { void run() { make(); } }\n"),
        ("src/LongApp.java", &long_java),
        ("src/OtherConsumer.java", "import com.acme.core.Other;\npublic class OtherConsumer { void run() { new Other(); } }\n"),
    ];
    let mut java_ws = Vec::new();
    for (p, src) in java_files {
        fs::write(dir.join(p), src).unwrap();
        java_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Java, src));
    }
    let j_widget = find_workspace_callers("src/MyFile.java", Some("Widget"), &java_ws, &dir);
    assert!(!j_widget.iter().any(|h| h.caller_path == "src/OtherConsumer.java"));
    assert_eq!(j_widget.iter().find(|h| h.caller_path == "src/App.java").unwrap().call_lines, vec![2]);
    assert_eq!(j_widget.iter().find(|h| h.caller_path == "src/StarApp.java").unwrap().call_lines, vec![2]);
    assert_eq!(j_widget.iter().find(|h| h.caller_path == "src/LongApp.java").unwrap().call_lines, vec![143]);
    let j_make = find_workspace_callers("src/MyFile.java", Some("make"), &java_ws, &dir);
    for p in ["src/StaticCall.java", "src/StaticMakeApp.java", "src/StaticStarApp.java"] {
        assert_eq!(j_make.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![2], "{p}");
    }
    assert_eq!(
        order_files_topologically(&[java_ws[2].clone(), java_ws[0].clone()], &dir),
        vec!["src/MyFile.java", "src/App.java"]
    );

    // 2. Kotlin mismatched stem + wildcard + alias + companion + >128L comment
    let mut long_kt = String::from("import /*\n");
    for k in 0..140 {
        long_kt.push_str(&format!("  pad {k}\n"));
    }
    long_kt.push_str("*/ com.acme.util.helper\nfun main() { helper() }\n");
    let kt_files: &[(&str, &str)] = &[
        ("src/Helpers.kt", "package com.acme.util\nfun helper() = 1\nclass Box {\n  companion object {\n    fun create() = Box()\n  }\n}\n"),
        ("src/KtDirect.kt", "import com.acme.util.helper\nfun main() { helper() }\n"),
        ("src/KtStar.kt", "import com.acme.util.*\nfun main() { helper() }\n"),
        ("src/KtAlias.kt", "import com.acme.util.helper as h\nfun main() { h() }\n"),
        ("src/KtBoxAlias.kt", "import com.acme.util.Box as B\nfun main() { B.create() }\n"),
        ("src/KtLong.kt", &long_kt),
    ];
    let mut kt_ws = Vec::new();
    for (p, src) in kt_files {
        fs::write(dir.join(p), src).unwrap();
        kt_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Kotlin, src));
    }
    let kt_helper = find_workspace_callers("src/Helpers.kt", Some("helper"), &kt_ws, &dir);
    for (p, exp) in [
        ("src/KtDirect.kt", 2usize),
        ("src/KtStar.kt", 2),
        ("src/KtAlias.kt", 2),
        ("src/KtLong.kt", 143),
    ] {
        assert_eq!(kt_helper.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![exp], "{p}");
    }
    assert!(!kt_helper.iter().any(|h| h.caller_path == "src/KtBoxAlias.kt"));
    let kt_create = find_workspace_callers("src/Helpers.kt", Some("create"), &kt_ws, &dir);
    assert_eq!(kt_create.iter().find(|h| h.caller_path == "src/KtBoxAlias.kt").unwrap().call_lines, vec![2]);
    assert!(!kt_create.iter().any(|h| h.caller_path == "src/KtAlias.kt"));
    assert_eq!(
        order_files_topologically(&[kt_ws[1].clone(), kt_ws[0].clone()], &dir),
        vec!["src/Helpers.kt", "src/KtDirect.kt"]
    );

    // 3. Dart show/hide/as/multiline/>128L/triple-quotes/static member
    let mut long_dart = String::from("import 'my_lib.dart' show\n");
    for k in 0..147 {
        long_dart.push_str(&format!("  N{k},\n"));
    }
    long_dart.push_str("  Foo;\nvoid main() { Foo(); }\n");
    let dart_files: &[(&str, &str)] = &[
        ("lib/my_lib.dart", "class Foo { static void make() {} }\nclass Bar {}\n"),
        ("lib/d_hide.dart", "import 'my_lib.dart' hide Bar;\nvoid main() { Foo.make(); }\n"),
        ("lib/d_as_show.dart", "import 'my_lib.dart' as m show Foo;\nvoid main() { m.Foo(); }\n"),
        ("lib/d_show_static.dart", "import 'my_lib.dart' show Foo;\nvoid main() { Foo.make(); }\n"),
        ("lib/d_ml_show.dart", "import 'my_lib.dart'\n  show\n  Foo;\nvoid main() { Foo(); }\n"),
        ("lib/d_ml_as.dart", "import 'my_lib.dart'\n  as m;\nvoid main() { m.Foo(); }\n"),
        ("lib/d_triple.dart", "import 'my_lib.dart';\nconst s = '''\n  (\n''';\nvoid main() { Foo(); }\n"),
        ("lib/d_150.dart", &long_dart),
    ];
    let mut dart_ws = Vec::new();
    for (p, src) in dart_files {
        fs::write(dir.join(p), src).unwrap();
        dart_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Dart, src));
    }
    assert!(find_workspace_callers("lib/my_lib.dart", Some("Bar"), &dart_ws, &dir).is_empty());
    let d_make = find_workspace_callers("lib/my_lib.dart", Some("make"), &dart_ws, &dir);
    assert_eq!(d_make.iter().find(|h| h.caller_path == "lib/d_hide.dart").unwrap().call_lines, vec![2]);
    assert_eq!(d_make.iter().find(|h| h.caller_path == "lib/d_show_static.dart").unwrap().call_lines, vec![2]);
    let d_foo = find_workspace_callers("lib/my_lib.dart", Some("Foo"), &dart_ws, &dir);
    assert_eq!(d_foo.iter().find(|h| h.caller_path == "lib/d_ml_show.dart").unwrap().imported_symbols, vec!["Foo"]);
    assert_eq!(d_foo.iter().find(|h| h.caller_path == "lib/d_ml_as.dart").unwrap().imported_symbols, vec!["*"]);
    assert_eq!(d_foo.iter().find(|h| h.caller_path == "lib/d_triple.dart").unwrap().call_lines, vec![5]);
    let h_d150 = d_foo.iter().find(|h| h.caller_path == "lib/d_150.dart").unwrap();
    assert_eq!(h_d150.imported_symbols.last().map(String::as_str), Some("Foo"));
    assert_eq!(h_d150.call_lines, vec![150]);

    // 4. Ruby >128L commented require_relative + heredoc + =begin..=end
    let mut long_rb = String::from("require_relative(\n");
    for k in 0..140 {
        long_rb.push_str(&format!("  # comment {k}\n"));
    }
    long_rb.push_str("  './utils'\n)\nHelpers.run\n");
    let rb_files: &[(&str, &str)] = &[
        ("lib/utils.rb", "module Helpers\n  def self.run\n    1\n  end\nend\n"),
        ("lib/r_150.rb", &long_rb),
        ("lib/r_heredoc.rb", "TXT = <<~EOF\n  (\nEOF\nrequire_relative './utils'\nHelpers.run\n"),
        ("lib/r_pod.rb", "=begin\n(\n=end\nrequire_relative './utils'\nHelpers.run\n"),
    ];
    let mut rb_ws = Vec::new();
    for (p, src) in rb_files {
        fs::write(dir.join(p), src).unwrap();
        rb_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Ruby, src));
    }
    let rb_hits = find_workspace_callers("lib/utils.rb", Some("run"), &rb_ws, &dir);
    assert_eq!(rb_hits.iter().find(|h| h.caller_path == "lib/r_150.rb").unwrap().call_lines, vec![144]);
    assert_eq!(rb_hits.iter().find(|h| h.caller_path == "lib/r_heredoc.rb").unwrap().call_lines, vec![5]);
    assert_eq!(rb_hits.iter().find(|h| h.caller_path == "lib/r_pod.rb").unwrap().call_lines, vec![5]);

    // 5. Bash FOO=1 source, $#, heredoc, >128L continuation
    let mut long_sh = String::from("source \\\n");
    for _ in 0..140 {
        long_sh.push_str("  \\\n");
    }
    long_sh.push_str("  ./helpers.sh\ndo_work\n");
    let sh_files: &[(&str, &str)] = &[
        ("scripts/helpers.sh", "do_work() { echo ok; }\n"),
        ("scripts/b_env.sh", "FOO=1 source ./helpers.sh\ndo_work\n"),
        ("scripts/b_hash.sh", "echo $#; source ./helpers.sh\ndo_work\n"),
        ("scripts/b_heredoc.sh", "cat <<'EOF'\n(\nEOF\nsource ./helpers.sh\ndo_work\n"),
        ("scripts/b_145.sh", &long_sh),
    ];
    let mut sh_ws = Vec::new();
    for (p, src) in sh_files {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("scripts/helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, exp) in [
        ("scripts/b_env.sh", 2usize),
        ("scripts/b_hash.sh", 2),
        ("scripts/b_heredoc.sh", 5),
        ("scripts/b_145.sh", 143),
    ] {
        assert_eq!(sh_hits.iter().find(|h| h.caller_path == p).unwrap().call_lines, vec![exp], "{p}");
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r13_php_comments_cjs_generics_require_comments_and_import_eq() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r13_php_cjs_req_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/App")).unwrap();

    // 1. PHP comments in group use & no-space /*c*/ + non-comment string path
    let php_files: &[(&str, &str)] = &[
        ("src/App/Math.php", "<?php\nnamespace App\\Math;\nfunction foo() { return 1; }\nconst BAR = 2;\n"),
        ("src/a#b.php", "<?php\nfunction hash_fn() { return 3; }\n"),
        ("src/php_grp_comments.php", "<?php\nuse App\\Math\\{\n  /* lead, with } */\n  function foo /* mid */ as /* a */ myFoo,\n  // line comment with }\n  # hash comment with ,\n  const BAR\n};\nmyFoo();\n"),
        ("src/php_nospace_comment.php", "<?php\nuse/*c*/App\\Math\\{function/*c*/foo/*c*/as/*c*/myFoo};\nmyFoo();\n"),
        ("src/php_hash_path.php", "<?php\nrequire 'a#b.php';\nhash_fn();\n"),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    let php_hits = find_workspace_callers("src/App/Math.php", Some("foo"), &php_ws, &dir);
    assert_eq!(php_hits.iter().find(|h| h.caller_path == "src/php_grp_comments.php").unwrap().call_lines, vec![9]);
    assert_eq!(php_hits.iter().find(|h| h.caller_path == "src/php_nospace_comment.php").unwrap().call_lines, vec![3]);
    assert_eq!(
        order_files_topologically(&[php_ws[2].clone(), php_ws[0].clone()], &dir),
        vec!["src/App/Math.php", "src/php_grp_comments.php"]
    );
    let php_hash = find_workspace_callers("src/a#b.php", Some("hash_fn"), &php_ws, &dir);
    assert_eq!(php_hash.iter().find(|h| h.caller_path == "src/php_hash_path.php").unwrap().call_lines, vec![3]);

    // 2. CJS destructuring generic defaults (named fn, fn*, async fn*, class, class Box, extends) + non-regressions
    let cjs_files: &[(&str, LanguageId, &str, Vec<&str>)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\nexports.bar = () => 2;\n", vec![]),
        ("src/cjs_named_fn.ts", LanguageId::TypeScript, "const { foo = function named<A, B = number>(a: A) { return a; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_named_star.ts", LanguageId::TypeScript, "const { foo = function* named<A, B = number>(a: A) { yield a; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_async_named.ts", LanguageId::TypeScript, "const { foo = async function named<A, B = number>(a: A) { return a; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_async_star.ts", LanguageId::TypeScript, "const { foo = async function* named<A, B = number>(a: A) { yield a; }, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_anon_class.ts", LanguageId::TypeScript, "const { foo = class<T, U = string> {}, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_named_class.ts", LanguageId::TypeScript, "const { foo = class Box<T, U = string> {}, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_extends_class.ts", LanguageId::TypeScript, "const { foo = class Box<T> extends Base<A, B, C> {}, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_mul_lt.js", LanguageId::JavaScript, "const { foo = a * b < c, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_dot_class.js", LanguageId::JavaScript, "const { foo = obj.class < b, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/cjs_cmp_lt_gt.js", LanguageId::JavaScript, "const { foo = a < b, B = 1 > (x) } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"]),
    ];
    let mut cjs_ws = Vec::new();
    for (p, lang, src, _) in cjs_files {
        fs::write(dir.join(p), src).unwrap();
        cjs_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let cjs_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &cjs_ws, &dir);
    for (p, _, _, exp_syms) in &cjs_files[1..] {
        let h = cjs_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {cjs_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![2], "{p}: {h:?}");
    }

    // 3. require(/* leading */ './a') across JS/TS/TSX + rejection of dynamic first arg
    for lang in [LanguageId::JavaScript, LanguageId::TypeScript, LanguageId::Tsx] {
        let p = match lang {
            LanguageId::JavaScript => "src/req_c.js",
            LanguageId::TypeScript => "src/req_c.ts",
            _ => "src/req_c.tsx",
        };
        let src = "const a = require(/* leading */ './a');\nconst b = require(/* c1 */ /* c2 */ './b');\nconst c = require(/* leading */ modName, './c');\n";
        let f = verify_and_parse(&reg, &fw, p, lang, src);
        let imps: Vec<&str> = f.edges.iter().filter(|e| e.kind == DepKind::Import).map(|e| e.target.as_str()).collect();
        assert_eq!(imps, vec!["./a", "./b"], "{lang:?}");
    }

    // 4. TS import mod = require('./legacy');
    let legacy_src = "export function greet() { return 1; }\n";
    let mod_caller_src = "import mod = require('./legacy');\nmod.greet();\n";
    fs::write(dir.join("src/legacy.ts"), legacy_src).unwrap();
    fs::write(dir.join("src/mod_caller.ts"), mod_caller_src).unwrap();
    let leg_ws = vec![
        verify_and_parse(&reg, &fw, "src/legacy.ts", LanguageId::TypeScript, legacy_src),
        verify_and_parse(&reg, &fw, "src/mod_caller.ts", LanguageId::TypeScript, mod_caller_src),
    ];
    let leg_hits = find_workspace_callers("src/legacy.ts", Some("greet"), &leg_ws, &dir);
    assert_eq!(leg_hits.len(), 1);
    assert_eq!(leg_hits[0].imported_symbols, vec!["*"]);
    assert_eq!(leg_hits[0].call_lines, vec![2]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r14_heredocs_bash_subshells_and_cpp_ns() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r14_sh_rb_cpp_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    for sub in ["scripts", "lib", "include", "src"] {
        fs::create_dir_all(dir.join(sub)).unwrap();
    }

    // 1. Bash <<< here-strings, multi-heredoc per line, keywords, & nested ( / $(
    let mut sh_files: Vec<(&str, &str, Vec<usize>)> = vec![
        ("scripts/helpers.sh", "do_work() { echo ok; }\n", vec![]),
        ("scripts/evil.sh", "do_evil() { echo no; }\n", vec![]),
        ("scripts/b_hs_q.sh", "cat <<< \"(\"\nsource ./helpers.sh\ndo_work\n", vec![3]),
        ("scripts/b_hs_w.sh", "cat <<< word\nsource ./helpers.sh\ndo_work\n", vec![3]),
        ("scripts/b_hs_ns.sh", "cat <<<\"(\"\nsource ./helpers.sh\ndo_work\n", vec![3]),
        ("scripts/b_multi_hd.sh", "cat <<EOF1\n(\nEOF1\ncat <<EOF2\nsource ./evil.sh\nEOF2\nsource ./helpers.sh\ndo_work\n", vec![8]),
        ("scripts/b_if_then.sh", "if true; then source ./helpers.sh; fi\ndo_work\n", vec![2]),
        ("scripts/b_elif.sh", "if false; then :; elif source ./helpers.sh; then do_work; fi\n", vec![1]),
        ("scripts/b_else.sh", "if false; then :; else source ./helpers.sh; fi\ndo_work\n", vec![2]),
        ("scripts/b_while.sh", "while false; do source ./helpers.sh; done\ndo_work\n", vec![2]),
        ("scripts/b_bang.sh", "! source ./helpers.sh\ndo_work\n", vec![2]),
        ("scripts/b_time.sh", "time source ./helpers.sh\ndo_work\n", vec![2]),
        ("scripts/b_subshell.sh", "(source ./helpers.sh)\ndo_work\n", vec![2]),
        ("scripts/b_cmd_sub.sh", "x=$(source ./helpers.sh; do_work)\n", vec![1]),
        ("scripts/b_if_sub.sh", "if (source ./helpers.sh); then do_work; fi\n", vec![1]),
        ("scripts/b_brace.sh", "{ source ./helpers.sh; }\ndo_work\n", vec![2]),
    ];
    let mut sh_ws = Vec::new();
    for (p, src, _) in &sh_files {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    for (p, src) in [
        ("scripts/b_neg_echo.sh", "echo then source ./helpers.sh\ndo_work\n"),
        ("scripts/b_neg_arr.sh", "arr=(source ./helpers.sh)\ndo_work\n"),
    ] {
        fs::write(dir.join(p), src).unwrap();
        let mut neg = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        assert!(!neg.edges.iter().any(|e| e.kind == DepKind::Import), "unexpected import edge in {p}");
        neg.edges.push(DepEdge { source: "module".into(), target: "./helpers.sh".into(), kind: DepKind::Import });
        sh_ws.push(neg);
        sh_files.push((p, src, vec![]));
    }
    let sh_hits = find_workspace_callers("scripts/helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, exp) in &sh_files[2..] {
        let h = sh_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {sh_hits:?}"));
        if exp.is_empty() {
            assert!(h.imported_symbols.is_empty(), "false positive for {p}: {h:?}");
        } else {
            assert_eq!(h.imported_symbols, vec!["*"], "{p}");
            assert_eq!(h.call_lines, *exp, "{p}");
        }
    }
    assert!(find_workspace_callers("scripts/evil.sh", Some("do_evil"), &sh_ws, &dir).is_empty());

    // 2. Ruby arr<<'x' / expr<<'x' operator variants, positive heredocs, & multi-heredoc per line
    let rb_files: &[(&str, &str, Vec<usize>)] = &[
        ("lib/utils.rb", "module Helpers\n  def self.run\n    1\n  end\nend\n", vec![]),
        ("lib/evil.rb", "module Evil\n  def self.bad\n    1\n  end\nend\n", vec![]),
        ("lib/rb_ops.rb", "1<<'x'\nf()<<'x'\nf()<<\"x\"\nf()<<`x`\nf()<<~'x'\na[0]<<'x'\na[0]<<-'x'\n(\"s\")<<'x'\n({}<<'x')\nrequire_relative './utils'\nHelpers.run\n", vec![11]),
        ("lib/rb_pos_hd.rb", "puts <<'EOF'\n(\nEOF\nx=<<'EOF'\n(\nEOF\n(<<'EOF')\n(\nEOF\n[<<'EOF']\n(\nEOF\n{a:<<'EOF'}\n(\nEOF\nrequire_relative './utils'\nHelpers.run\n", vec![17]),
        ("lib/rb_multi_hd.rb", "puts <<~EOF1, <<~EOF2\n  (\nEOF1\n  require_relative './evil'\nEOF2\nrequire_relative './utils'\nHelpers.run\n", vec![7]),
    ];
    let mut rb_ws = Vec::new();
    for (p, src, _) in rb_files {
        fs::write(dir.join(p), src).unwrap();
        rb_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Ruby, src));
    }
    let rb_arr_src = "arr = []\narr<<'x'\narr<<\"x\"\narr<<`x`\narr<<-'x'\narr<<~'x'\nrequire_relative './utils'\nHelpers.run\n";
    fs::write(dir.join("lib/rb_arr_shift.rb"), rb_arr_src).unwrap();
    let mut rb_arr = parse_input(&reg, "lib/rb_arr_shift.rb", LanguageId::Ruby, rb_arr_src);
    rb_arr.edges.push(DepEdge { source: "ruby".into(), target: "./utils".into(), kind: DepKind::Import });
    rb_ws.push(rb_arr);
    let rb_hits = find_workspace_callers("lib/utils.rb", Some("run"), &rb_ws, &dir);
    for (p, _, exp) in &rb_files[2..] {
        let h = rb_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {rb_hits:?}"));
        assert_eq!(h.imported_symbols, vec!["*"]);
        assert_eq!(h.call_lines, *exp, "{p}");
    }
    let h_arr = rb_hits.iter().find(|x| x.caller_path == "lib/rb_arr_shift.rb").unwrap_or_else(|| panic!("missing rb_arr_shift: {rb_hits:?}"));
    assert_eq!(h_arr.imported_symbols, vec!["*"]);
    assert_eq!(h_arr.call_lines, vec![8]);
    assert!(find_workspace_callers("lib/evil.rb", Some("bad"), &rb_ws, &dir).is_empty());

    // 3. C++ using namespace leaf symbol collision & C++17 nested namespaces
    let cpp_files: &[(&str, &str)] = &[
        ("include/ab.hpp", "namespace a { namespace b { int c() { return 1; } } }\n"),
        ("include/bc.hpp", "namespace b { namespace c { int d() { return 2; } } }\n"),
        ("include/c.hpp", "namespace c { int d() { return 3; } }\n"),
        ("include/ac17.hpp", "namespace a::c { int d() { return 4; } }\n"),
        ("include/xac.hpp", "namespace x { namespace a { namespace c { int d() { return 5; } } } }\n"),
        ("include/other.hpp", "namespace a { namespace c { int d() { return 6; } } }\n"),
        ("src/use_ac.cpp", "#include \"ab.hpp\"\n#include \"bc.hpp\"\n#include \"c.hpp\"\n#include \"ac17.hpp\"\n#include \"xac.hpp\"\n#include \"other.hpp\"\nvoid f() {\nusing namespace a::c;\nd();\n}\n"),
        ("src/use_c.cpp", "#include \"ab.hpp\"\n#include \"c.hpp\"\nvoid g() {\nusing namespace c;\nc();\nd();\n}\n"),
    ];
    let mut cpp_ws = Vec::new();
    for (p, src) in cpp_files {
        fs::write(dir.join(p), src).unwrap();
        cpp_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Cpp, src));
    }
    for neg_hdr in ["include/ab.hpp", "include/bc.hpp", "include/c.hpp"] {
        let all = find_workspace_callers(neg_hdr, None, &cpp_ws, &dir);
        let h = all.iter().find(|x| x.caller_path == "src/use_ac.cpp").unwrap();
        assert!(h.imported_symbols.is_empty(), "{neg_hdr}: {h:?}");
    }
    for pos_hdr in ["include/ac17.hpp", "include/xac.hpp", "include/other.hpp"] {
        let hits = find_workspace_callers(pos_hdr, Some("d"), &cpp_ws, &dir);
        let h = hits.iter().find(|x| x.caller_path == "src/use_ac.cpp").unwrap();
        assert_eq!(h.imported_symbols, vec!["*"], "{pos_hdr}");
        assert_eq!(h.call_lines, vec![9], "{pos_hdr}");
    }
    let ab_from_use_c = find_workspace_callers("include/ab.hpp", None, &cpp_ws, &dir);
    assert!(ab_from_use_c.iter().find(|x| x.caller_path == "src/use_c.cpp").unwrap().imported_symbols.is_empty());
    let c_from_use_c = find_workspace_callers("include/c.hpp", Some("d"), &cpp_ws, &dir);
    assert_eq!(c_from_use_c.iter().find(|x| x.caller_path == "src/use_c.cpp").unwrap().call_lines, vec![6]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r14_cjs_type_args_and_iter13_caveats() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r14_cjs_caveats_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/App/Sub")).unwrap();

    // 1. CJS 3+ type arguments, implements, multiline, TSX, & JS comparison non-regressions
    let cjs_cases: &[(&str, LanguageId, &str, Vec<&str>, usize)] = &[
        ("src/cjs_math.js", LanguageId::JavaScript, "exports.foo = () => 1;\nexports.bar = () => 2;\nexports.B = () => 3;\nexports.c = () => 4;\n", vec![], 0),
        ("src/cjs_call3.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>(x), bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_new3.ts", LanguageId::TypeScript, "const { foo = new Box<A, B, C>(), bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_impl3.ts", LanguageId::TypeScript, "const { foo = class Box<T> implements Iface<A, B, C> {}, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_ext_impl2.ts", LanguageId::TypeScript, "const { foo = class Box<T> extends Base<A, B> implements I1<C, D>, I2<E, F> {}, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_qual_nested.ts", LanguageId::TypeScript, "const { foo = obj.fn<Map<K, V>, Set<T>, C>(x), bar = new ns.Box<A, B, C>() } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_fn_tuple_obj.ts", LanguageId::TypeScript, "const { foo = fn<(x: A) => B, { a: A; b: B }, [C, D]>(x), bar = fn!<A, B, C>(y) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_tag_call.ts", LanguageId::TypeScript, "const { foo = fn?.<A, B, C>(x), bar = getFn()<A, B, C>(x) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_multiline.ts", LanguageId::TypeScript, "const {\n  foo = fn<\n    A,\n    B,\n    C\n  >(x),\n  bar,\n} = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 9),
        ("src/cjs_tsx3.tsx", LanguageId::Tsx, "const { foo = fn<A, B, C>(x), bar = class Box<T> implements Iface<A, B, C> {}, baz = <Box a={1} /> } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar", "baz"], 2),
        ("src/cjs_cmp1.js", LanguageId::JavaScript, "const { foo = a < b, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_cmp2.js", LanguageId::JavaScript, "const { foo = a < b, B = 1 > (x) } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"], 2),
        ("src/cjs_cmp3.js", LanguageId::JavaScript, "const { foo = a < b, c = d > e } = require('./cjs_math');\nfoo(); c();\n", vec!["foo", "c"], 2),
        ("src/cjs_cmp4.js", LanguageId::JavaScript, "const { foo = a * b < c, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_cmp5.js", LanguageId::JavaScript, "const { foo = obj.class < b, bar = c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_cmp6.ts", LanguageId::TypeScript, "const { foo = x! < b, B = 1 > (y) } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"], 2),
        ("src/cjs_cmp7.js", LanguageId::JavaScript, "const { foo = a << b, bar = c >> d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
        ("src/cjs_cmp8.js", LanguageId::JavaScript, "const { foo = a <= b, bar = c >= d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"], 2),
    ];
    let mut cjs_ws = Vec::new();
    for (p, lang, src, _, _) in cjs_cases {
        fs::write(dir.join(p), src).unwrap();
        cjs_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let cjs_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &cjs_ws, &dir);
    for (p, _, _, exp_syms, exp_line) in &cjs_cases[1..] {
        let h = cjs_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {cjs_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
    }

    // 2. Kotlin standalone `as` line
    let kt_helper_src = "package com.acme.util\nclass Box {\n  companion object {\n    fun create() = Box()\n  }\n}\n";
    let kt_ws = vec![
        verify_and_parse(&reg, &fw, "src/Helpers.kt", LanguageId::Kotlin, kt_helper_src),
        verify_and_parse(&reg, &fw, "src/KtAsLine.kt", LanguageId::Kotlin, "import com.acme.util.Box\n  as\n  B\nfun main() { B.create() }\n"),
    ];
    fs::write(dir.join("src/Helpers.kt"), kt_helper_src).unwrap();
    fs::write(dir.join("src/KtAsLine.kt"), "import com.acme.util.Box\n  as\n  B\nfun main() { B.create() }\n").unwrap();
    assert_eq!(find_workspace_callers("src/Helpers.kt", Some("create"), &kt_ws, &dir)[0].call_lines, vec![4]);

    // 3. C# generic ? / [] / * suffixes do not spill into sibling Ns2 files
    let cs_files: &[(&str, &str)] = &[
        ("src/MyTypes.cs", "namespace MyNs { public class Box<T> {} }\n"),
        ("src/ItemTypes.cs", "namespace Ns2 { public class Item {} }\n"),
        ("src/OtherNs2.cs", "namespace Ns2 { public class Other {} }\n"),
        ("src/CsNull.cs", "using Alias = MyNs.Box<Ns2.Item?>;\nclass C { Alias x; }\n"),
        ("src/CsArr.cs", "using Alias = MyNs.Box<Ns2.Item[]>;\nclass C { Alias x; }\n"),
        ("src/CsPtr.cs", "using Alias = MyNs.Box<Ns2.Item*>;\nclass C { Alias x; }\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    for seed in ["src/CsNull.cs", "src/CsArr.cs", "src/CsPtr.cs"] {
        let clos = expand_dependency_closure(&[seed.into()], 2, &cs_ws, &dir);
        assert!(clos.contains(&"src/MyTypes.cs".to_string()), "{seed}: {clos:?}");
        assert!(clos.contains(&"src/ItemTypes.cs".to_string()), "{seed}: {clos:?}");
        assert!(!clos.contains(&"src/OtherNs2.cs".to_string()), "{seed}: {clos:?}");
    }

    // 4. PHP comment between `\` separator & require 'use helper.php'
    let php_files: &[(&str, &str)] = &[
        ("src/App/Sub/Leaf.php", "<?php\nnamespace App\\Sub;\nclass Leaf {}\n"),
        ("src/use helper.php", "<?php\nfunction h() { return 1; }\n"),
        ("src/php_mid_c.php", "<?php\nuse App\\Sub /* mid */ \\Leaf;\nnew Leaf();\n"),
        ("src/php_req_use.php", "<?php\nrequire 'use helper.php';\nh();\n"),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    let clos_mid = expand_dependency_closure(&["src/php_mid_c.php".into()], 2, &php_ws, &dir);
    assert!(clos_mid.contains(&"src/App/Sub/Leaf.php".to_string()), "{clos_mid:?}");
    assert_eq!(find_workspace_callers("src/App/Sub/Leaf.php", Some("Leaf"), &php_ws, &dir)[0].call_lines, vec![3]);
    let clos_req = expand_dependency_closure(&["src/php_req_use.php".into()], 2, &php_ws, &dir);
    assert!(clos_req.contains(&"src/use helper.php".to_string()), "{clos_req:?}");
    assert_eq!(find_workspace_callers("src/use helper.php", Some("h"), &php_ws, &dir)[0].call_lines, vec![3]);

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r15_bash_ruby_ts_cs_php_cpp() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r15_regressions_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/App/Math")).unwrap();
    fs::create_dir_all(dir.join("src/use dir")).unwrap();

    // 1. Bash heredocs, case, wrappers (time/builtin/command), &/| chains, "$(...)", & negatives
    let sh_helpers = "do_work() { echo ok; }\n";
    let sh_b = "do_b() { echo b; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    fs::write(dir.join("b.sh"), sh_b).unwrap();
    let bash_cases: &[(&str, &str, bool, usize)] = &[
        ("hd_hyphen.sh", "cat <<END-OF-FILE\n(\nEND-OF-FILE\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("hd_strip_ws.sh", "cat <<-END-OF-FILE\n\t(\n\tEND-OF-FILE\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("hd_dot_num.sh", "cat <<EOF.1\n(\nEOF.1\ncat <<123\n\"\n123\nsource ./helpers.sh\ndo_work\n", true, 8),
        ("case_bare.sh", "case x in a) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("case_paren.sh", "case x in (a) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("case_multipat.sh", "case x in\n  (source)\n    echo pat\n    ;;\n  (a)\n    source ./helpers.sh\n    ;;\nesac\ndo_work\n", true, 9),
        ("chain_amp_pipe.sh", "source ./b.sh & source ./helpers.sh | cat\ndo_b; do_work\n", true, 2),
        ("wrap_time_p.sh", "time -p source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_time_env.sh", "time FOO=1 source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_env_time_p.sh", "FOO=1 time -p source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_time_p_env.sh", "time -p FOO=1 source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_builtin.sh", "builtin source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_cmd_dot.sh", "command . ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_cmd_p.sh", "command -p source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_nested.sh", "time -p builtin source ./helpers.sh\ndo_work\n", true, 2),
        ("wrap_nested_cmd.sh", "time command -p . ./helpers.sh\ndo_work\n", true, 2),
        ("dq_cmdsub.sh", "x=\"$(source ./helpers.sh; do_work)\"\n", true, 1),
        ("dq_cmdsub_nested.sh", "x=\"$(echo \"a $(source ./helpers.sh)\" && do_work)\"\n", true, 1),
        ("dq_arith_cmdsub.sh", "x=\"$((1+2)) $(source ./helpers.sh; do_work)\"\n", true, 1),
        ("dq_param_cmdsub.sh", "x=\"${foo:-$(source ./helpers.sh; do_work)}\"\n", true, 1),
        ("dq_utf8_cmdsub.sh", "x=\"$(echo \"héllo 🚀 $(source ./helpers.sh)\" && do_work)\"\n", true, 1),
        ("dq_assign_after.sh", "FOO=\"$(source ./b.sh)\" source ./helpers.sh\ndo_b; do_work\n", true, 2),
        ("neg_dq_lit.sh", "echo \"source ./helpers.sh\"\necho \"do_work\"\n", false, 0),
        ("neg_cmd_v.sh", "command -v source ./helpers.sh\ncommand -V source ./helpers.sh\ncommand -pv source ./helpers.sh\ndo_work\n", false, 0),
        ("neg_time_echo.sh", "time echo source ./helpers.sh\ndo_work\n", false, 0),
        ("neg_subshell_arg.sh", "echo $(foo) source ./helpers.sh\ndo_work\n", false, 0),
    ];
    let mut sh_ws = vec![
        verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers),
        verify_and_parse(&reg, &fw, "b.sh", LanguageId::Bash, sh_b),
    ];
    for (p, src, _, _) in bash_cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in bash_cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }
    let b_hits = find_workspace_callers("b.sh", Some("do_b"), &sh_ws, &dir);
    assert!(b_hits.iter().any(|h| h.caller_path == "chain_amp_pipe.sh"), "{b_hits:?}");
    assert!(b_hits.iter().any(|h| h.caller_path == "dq_assign_after.sh"), "{b_hits:?}");

    // 2. Ruby foo!<<'x', foo?<<'x', /a/<<'x' and positive unary x = !<<'A'
    let rb_utils = "module Helpers\n  def self.run; 1; end\nend\n";
    fs::write(dir.join("utils.rb"), rb_utils).unwrap();
    let rb_cases: &[(&str, &str, bool, usize)] = &[
        ("rb_bang_call.rb", "def foo!; []; end\nfoo!<<'x'\nrequire_relative './utils'\nHelpers.run\n", true, 4),
        ("rb_q_call.rb", "def foo?; []; end\nfoo?<<'x'\nrequire_relative './utils'\nHelpers.run\n", true, 4),
        ("rb_regex_shift.rb", "/a/<<'x'\nrequire_relative './utils'\nHelpers.run\n", false, 3),
        ("rb_unary_bang.rb", "x = !<<'A'\n(\nA\nrequire_relative './utils'\nHelpers.run\n", false, 5),
    ];
    let mut rb_ws = vec![verify_and_parse(&reg, &fw, "utils.rb", LanguageId::Ruby, rb_utils)];
    for (p, src, needs_edge, _) in rb_cases {
        fs::write(dir.join(p), src).unwrap();
        let mut f = verify_and_parse(&reg, &fw, p, LanguageId::Ruby, src);
        if *needs_edge {
            f.edges.push(DepEdge { source: "ruby".into(), target: "./utils".into(), kind: DepKind::Import });
        }
        rb_ws.push(f);
    }
    let rb_hits = find_workspace_callers("utils.rb", Some("run"), &rb_ws, &dir);
    for (p, _, _, exp_line) in rb_cases {
        let h = rb_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {rb_hits:?}"));
        assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
    }

    // 3. TS generic instantiation continuations & JS comparison non-regressions
    let cjs_math = "exports.foo = () => 1;\nexports.bar = () => 2;\nexports.B = () => 3;\n";
    fs::write(dir.join("src/cjs_math.js"), cjs_math).unwrap();
    let ts_cases: &[(&str, LanguageId, &str, Vec<&str>)] = &[
        ("src/ts_opt_prop.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>?.name, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_member_bind.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>.bind(null), bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_or.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> || g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_and.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> && g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_nullish.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> ?? g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_eq3.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> === g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_neq3.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> !== g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_tern.ts", LanguageId::TypeScript, "const { foo = cond ? fn<A, B, C> : g, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_eq2_neq2.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> == g, bar = fn<D, E> != h } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_opt_idx_bang.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>?.[k], bar = fn<A, B, C>!.bind(null) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_wrapped.ts", LanguageId::TypeScript, "const { foo = (fn<A, B, C>), bar = [fn<A, B, C>] } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/ts_union_cond.ts", LanguageId::TypeScript, "const { foo = fn<A & B, C | D>(x), bar = fn<T extends A ? B : C>(y) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/js_cmp_dot5.js", LanguageId::JavaScript, "const { foo = a < b, B = c > .5 } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"]),
        ("src/js_cmp_and_p.js", LanguageId::JavaScript, "const { foo = a < b && c > (d), bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/js_cmp_or_null.js", LanguageId::JavaScript, "const { foo = a < b || c > (d), bar = a < b ?? c > (d) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/js_cmp_tern_bang.ts", LanguageId::TypeScript, "const { foo = cond ? a < b : c > !(d), bar = cond ? a < b : c > .5 } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
    ];
    let mut ts_ws = vec![verify_and_parse(&reg, &fw, "src/cjs_math.js", LanguageId::JavaScript, cjs_math)];
    for (p, lang, src, _) in ts_cases {
        fs::write(dir.join(p), src).unwrap();
        ts_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let ts_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &ts_ws, &dir);
    for (p, _, _, exp_syms) in ts_cases {
        let h = ts_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {ts_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![2], "{p}: {h:?}");
    }

    // 4. C# tuple generics & delegates without sibling Ns2 leak
    let cs_files: &[(&str, &str)] = &[
        ("src/MyBox.cs", "namespace MyNs { public class Box<T> {} }\n"),
        ("src/Ns2Item.cs", "namespace Ns2 { public class Item {} }\n"),
        ("src/Ns2Del.cs", "namespace Ns2 { public delegate void DelItem(int x); }\n"),
        ("src/Ns2Other.cs", "namespace Ns2 { public class Other {} }\n"),
        ("src/CsTupSimple.cs", "using Alias = MyNs.Box<(Ns2.Item, int)>;\nclass C { Alias x; }\n"),
        ("src/CsTupNamed.cs", "using Alias = MyNs.Box<(Ns2.Item First, Ns2.Other Second)>;\nclass C { Alias x; }\n"),
        ("src/CsTupNested.cs", "using Alias = MyNs.Box<((Ns2.Item First, int Second) Inner, string Label)>;\nclass C { Alias x; }\n"),
        ("src/CsDel.cs", "using Alias = MyNs.Box<Ns2.DelItem>;\nclass C { Alias x; }\n"),
        ("src/CsUnknown.cs", "using Alias = MyNs.Box<Ns2.Unknown>;\nclass C { Alias x; }\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    for seed in ["src/CsTupSimple.cs", "src/CsTupNested.cs"] {
        let clos = expand_dependency_closure(&[seed.into()], 2, &cs_ws, &dir);
        assert!(clos.contains(&"src/MyBox.cs".to_string()), "{seed}: {clos:?}");
        assert!(clos.contains(&"src/Ns2Item.cs".to_string()), "{seed}: {clos:?}");
        assert!(!clos.contains(&"src/Ns2Other.cs".to_string()), "{seed}: {clos:?}");
    }
    let clos_named = expand_dependency_closure(&["src/CsTupNamed.cs".into()], 2, &cs_ws, &dir);
    assert!(clos_named.contains(&"src/Ns2Item.cs".to_string()), "{clos_named:?}");
    assert!(clos_named.contains(&"src/Ns2Other.cs".to_string()), "{clos_named:?}");
    let clos_del = expand_dependency_closure(&["src/CsDel.cs".into()], 2, &cs_ws, &dir);
    assert!(clos_del.contains(&"src/Ns2Del.cs".to_string()), "{clos_del:?}");
    assert!(!clos_del.contains(&"src/Ns2Other.cs".to_string()), "{clos_del:?}");
    let clos_unk = expand_dependency_closure(&["src/CsUnknown.cs".into()], 2, &cs_ws, &dir);
    assert!(!clos_unk.contains(&"src/Ns2Other.cs".to_string()), "{clos_unk:?}");

    // 5. PHP .inc / .phtml / extensionless / synthetic use/*c*/
    let php_files: &[(&str, &str)] = &[
        ("src/App/Math/Foo.php", "<?php\nnamespace App\\Math;\nclass Foo {}\n"),
        ("src/use helper.inc", "<?php\nfunction h_inc() { return 1; }\n"),
        ("src/use helper.phtml", "<?php\nfunction h_phtml() { return 1; }\n"),
        ("src/use dir/helper", "<?php\nfunction h_extless() { return 1; }\n"),
        ("src/use helper.php8", "<?php\nfunction h_php8() { return 1; }\n"),
        ("src/php_inc.php", "<?php\nrequire 'use helper.inc';\nh_inc();\n"),
        ("src/php_phtml.php", "<?php\nrequire 'use helper.phtml';\nh_phtml();\n"),
        ("src/php_extless.php", "<?php\nrequire 'use dir/helper';\nh_extless();\n"),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    for (caller, target, sym) in [
        ("src/php_inc.php", "src/use helper.inc", "h_inc"),
        ("src/php_phtml.php", "src/use helper.phtml", "h_phtml"),
        ("src/php_extless.php", "src/use dir/helper", "h_extless"),
    ] {
        let clos = expand_dependency_closure(&[caller.into()], 2, &php_ws, &dir);
        assert!(clos.contains(&target.to_string()), "{caller}: {clos:?}");
        assert_eq!(find_workspace_callers(target, Some(sym), &php_ws, &dir)[0].call_lines, vec![3]);
    }
    let php_idx = WorkspaceIndex::build(&php_ws, &dir);
    let syn_use = DepEdge { source: "php".into(), target: "use/*c*/App\\Math\\Foo".into(), kind: DepKind::Import };
    assert_eq!(resolve_dep_edge(5, &php_ws[5], &syn_use, &php_idx, &dir), ResolveOutcome::WorkspaceFile("src/App/Math/Foo.php".into()));
    let syn_php8 = DepEdge { source: "php".into(), target: "use helper.php8".into(), kind: DepKind::Import };
    assert_eq!(resolve_dep_edge(5, &php_ws[5], &syn_php8, &php_idx, &dir), ResolveOutcome::WorkspaceFile("src/use helper.php8".into()));

    // 6. C++ inline namespace (nested & C++20), #ifdef, and #define \
    let cpp_files: &[(&str, &str)] = &[
        ("src/ns_nested.hpp", "namespace a { inline namespace v1 { namespace c { int d() { return 1; } } } }\n"),
        ("src/ns_cpp20.hpp", "namespace a::inline v1::c { int d20() { return 2; } }\n"),
        ("src/use_nested_ac.cpp", "#include \"ns_nested.hpp\"\nusing namespace a::c;\nint f() { return d(); }\n"),
        ("src/use_nested_av1c.cpp", "#include \"ns_nested.hpp\"\nusing namespace a::v1::c;\nint f() { return d(); }\n"),
        ("src/use_cpp20_ac.cpp", "#include \"ns_cpp20.hpp\"\n#ifdef USE_NS\nusing namespace a::c;\n#endif\nint f() { return d20(); }\n"),
        ("src/use_cpp20_av1c.cpp", "#include \"ns_cpp20.hpp\"\nusing namespace a::v1::c;\nint f() { return d20(); }\n"),
        ("src/use_define_cont.cpp", "#include \"ns_nested.hpp\"\n#define USE_AC \\\n    using namespace a::c;\nint f() { return a::c::d(); }\n"),
    ];
    let mut cpp_ws = Vec::new();
    for (p, src) in cpp_files {
        fs::write(dir.join(p), src).unwrap();
        cpp_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Cpp, src));
    }
    let nested_hits = find_workspace_callers("src/ns_nested.hpp", Some("d"), &cpp_ws, &dir);
    assert_eq!(nested_hits.iter().find(|h| h.caller_path == "src/use_nested_ac.cpp").unwrap().call_lines, vec![3]);
    assert_eq!(nested_hits.iter().find(|h| h.caller_path == "src/use_nested_av1c.cpp").unwrap().call_lines, vec![3]);
    let def_hit = nested_hits.iter().find(|h| h.caller_path == "src/use_define_cont.cpp").unwrap();
    assert!(def_hit.imported_symbols.is_empty(), "macro body should not emit *: {def_hit:?}");
    let cpp20_hits = find_workspace_callers("src/ns_cpp20.hpp", Some("d20"), &cpp_ws, &dir);
    assert_eq!(cpp20_hits.iter().find(|h| h.caller_path == "src/use_cpp20_ac.cpp").unwrap().call_lines, vec![5]);
    assert_eq!(cpp20_hits.iter().find(|h| h.caller_path == "src/use_cpp20_av1c.cpp").unwrap().call_lines, vec![3]);

    let _ = fs::remove_dir_all(&dir);
}


#[test]
fn regression_w3m2_r16_bash_ts_cs_php() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r16_regressions_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(dir.join("src/App/Sub")).unwrap();

    // 1. Bash case inside "$(...)" / $(...), Bash 4+ ;& / ;;&, and <<E\OF heredocs
    let sh_helpers = "do_work() { echo ok; }\n";
    let sh_b = "do_b() { echo b; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    fs::write(dir.join("b.sh"), sh_b).unwrap();
    let bash_cases: &[(&str, &str, bool, usize)] = &[
        ("r16_dq_case.sh", "x=\"$(case a in a) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_dq_case_after.sh", "x=\"$(case a in a) echo hi ;; esac; source ./helpers.sh; do_work)\"\n", true, 1),
        ("r16_uq_case.sh", "x=$(case a in a) source ./helpers.sh ;; esac; do_work)\n", true, 1),
        ("r16_dq_nested_case.sh", "x=\"$(case a in \"$(case b in b) echo x ;; esac)\") source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_dq_nested_case_body.sh", "x=\"$(case a in a) y=$(case b in b) echo x ;; esac); source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_dq_nested_sub.sh", "x=\"$(y=$(case a in a) source ./helpers.sh ;; esac); do_work)\"\n", true, 1),
        ("r16_uq_paren_pat.sh", "x=$(case a in (a|b) source ./helpers.sh ;; esac; do_work)\n", true, 1),
        ("r16_dq_alt_pat.sh", "x=\"$(case a in a|b) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_dq_brace_pat.sh", "x=\"$(case a in {a,b}) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_dq_param_rp.sh", "x=\"$(echo ${a:-)} && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r16_fall_semi_amp.sh", "case x in a) echo 1 ;& b) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r16_fall_dsemi_amp.sh", "case x in a) source ./b.sh ;;& b) source ./helpers.sh ;; esac\ndo_b; do_work\n", true, 2),
        ("r16_dq_fall.sh", "x=\"$(case x in a) echo 1 ;& (b) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r16_neg_fall_pat.sh", "case x in a) echo 1 ;& source) echo hi ;; esac\ndo_work\n", false, 0),
        ("r16_neg_paren_or.sh", "case x in (a|source) echo hi ;; esac\ndo_work\n", false, 0),
        ("r16_hd_esc_mid.sh", "cat <<E\\OF\n(\nEOF\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("r16_hd_strip_esc.sh", "cat <<-E\\OF\n\t(\n\tEOF\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("r16_hd_esc_lead.sh", "cat <<\\E\\OF\n(\nEOF\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("r16_hd_esc_bs.sh", "cat <<E\\\\OF\n(\nE\\OF\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("r16_hd_esc_hash.sh", "cat <<\\#EOF\n(\n#EOF\nsource ./helpers.sh\ndo_work\n", true, 5),
        ("r16_neg_dq_lit.sh", "echo \"case a in a) source ./helpers.sh ;; esac\"\ndo_work\n", false, 0),
        ("r16_amp_chain.sh", "source ./b.sh & source ./helpers.sh && do_b && do_work\n", true, 1),
    ];
    let mut sh_ws = vec![
        verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers),
        verify_and_parse(&reg, &fw, "b.sh", LanguageId::Bash, sh_b),
    ];
    for (p, src, _, _) in bash_cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in bash_cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }
    let b_hits = find_workspace_callers("b.sh", Some("do_b"), &sh_ws, &dir);
    assert_eq!(b_hits.iter().find(|h| h.caller_path == "r16_fall_dsemi_amp.sh").unwrap().call_lines, vec![2]);
    assert_eq!(b_hits.iter().find(|h| h.caller_path == "r16_amp_chain.sh").unwrap().call_lines, vec![1]);

    // 2. TS generic instantiation continuations (?, in, ! + ops/kws, comments) & comparisons
    let cjs_math = "exports.foo = () => 1;\nexports.bar = () => 2;\nexports.B = () => 3;\n";
    fs::write(dir.join("src/cjs_math.js"), cjs_math).unwrap();
    let ts_cases: &[(&str, LanguageId, &str, Vec<&str>)] = &[
        ("src/r16_ts_q.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> ? x : y, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_in.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> in obj, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_bang_eq3.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>! === g, bar = fn<A, B, C>! !== h } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_bang_eq2.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>! == g, bar = fn<A, B, C>! != h } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_bang_as.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>! as unknown, bar = fn<A, B, C>! satisfies Fn } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_bang_inst_in.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>! instanceof Function, bar = fn<A, B, C>! in obj } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_bang_q.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C>! ? x : y, bar } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_ts_cmt_bang.ts", LanguageId::TypeScript, "const { foo = fn<A, B, C> /* c */ ! /* c */ === g, bar = fn<A, B, C> /* c */ ? x : y } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_js_cmp_bang_id.js", LanguageId::JavaScript, "const { foo = cond ? a < b : c > !flag, bar = cond ? a < b : c > !!flag } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_js_cmp_bang_num.js", LanguageId::JavaScript, "const { foo = cond ? a < b : c > !.5, bar = cond ? a < b : c > !(d) } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_js_cmp_q_and.js", LanguageId::JavaScript, "const { foo = a < b ? c : d, bar = a < b && c > d } = require('./cjs_math');\nfoo(); bar();\n", vec!["foo", "bar"]),
        ("src/r16_js_cmp_plus.js", LanguageId::JavaScript, "const { foo = a < b + c > +1, B = c > +1 } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"]),
        ("src/r16_js_cmp_comma.js", LanguageId::JavaScript, "const { foo = a < b, B = c > .5 } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"]),
        ("src/r16_js_cmp_comma_id.js", LanguageId::JavaScript, "const { foo = a < b, B = c > d } = require('./cjs_math');\nfoo(); B();\n", vec!["foo", "B"]),
    ];
    let mut ts_ws = vec![verify_and_parse(&reg, &fw, "src/cjs_math.js", LanguageId::JavaScript, cjs_math)];
    for (p, lang, src, _) in ts_cases {
        fs::write(dir.join(p), src).unwrap();
        ts_ws.push(verify_and_parse(&reg, &fw, p, *lang, src));
    }
    let ts_hits = find_workspace_callers("src/cjs_math.js", Some("foo"), &ts_ws, &dir);
    for (p, _, _, exp_syms) in ts_cases {
        let h = ts_hits.iter().find(|x| x.caller_path == *p).unwrap_or_else(|| panic!("missing {p}: {ts_hits:?}"));
        let exp: Vec<String> = exp_syms.iter().map(|s| (*s).to_string()).collect();
        assert_eq!(h.imported_symbols, exp, "{p}: {h:?}");
        assert_eq!(h.call_lines, vec![2], "{p}: {h:?}");
    }

    // 3. C# 12 bare tuple aliases (positive & negative)
    let cs_files: &[(&str, &str)] = &[
        ("src/MyBox.cs", "namespace MyNs { public class Box<T> {} }\n"),
        ("src/Ns2Item.cs", "namespace Ns2 { public class Item {} }\n"),
        ("src/Ns2Other.cs", "namespace Ns2 { public class Other {} }\n"),
        ("src/CsBareTup.cs", "using Alias = (Ns2.Item, int);\nclass C { Alias x; }\n"),
        ("src/CsBareTupNull.cs", "using Alias = (Ns2.Item, int)?;\nclass C { Alias x; }\n"),
        ("src/CsBareTupArr.cs", "using Alias = (Ns2.Item, int)[];\nclass C { Alias x; }\n"),
        ("src/CsBareTupBox.cs", "using Alias = (MyNs.Box<Ns2.Item>, int);\nclass C { Alias x; }\n"),
        ("src/CsBareTupUnk.cs", "using Alias = (Ns2.Unknown, int);\nclass C { Alias x; }\n"),
        ("src/CsPredef.cs", "using MyInt = int;\nclass C { MyInt x; }\n"),
    ];
    let mut cs_ws = Vec::new();
    for (p, src) in cs_files {
        fs::write(dir.join(p), src).unwrap();
        cs_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::CSharp, src));
    }
    for seed in ["src/CsBareTup.cs", "src/CsBareTupNull.cs", "src/CsBareTupArr.cs"] {
        let clos = expand_dependency_closure(&[seed.into()], 2, &cs_ws, &dir);
        assert!(clos.contains(&"src/Ns2Item.cs".to_string()), "{seed}: {clos:?}");
        assert!(!clos.contains(&"src/Ns2Other.cs".to_string()), "{seed}: {clos:?}");
    }
    let clos_tbox = expand_dependency_closure(&["src/CsBareTupBox.cs".into()], 2, &cs_ws, &dir);
    assert!(clos_tbox.contains(&"src/MyBox.cs".to_string()), "{clos_tbox:?}");
    assert!(clos_tbox.contains(&"src/Ns2Item.cs".to_string()), "{clos_tbox:?}");
    assert!(!clos_tbox.contains(&"src/Ns2Other.cs".to_string()), "{clos_tbox:?}");
    let clos_unk = expand_dependency_closure(&["src/CsBareTupUnk.cs".into()], 2, &cs_ws, &dir);
    assert!(!clos_unk.contains(&"src/Ns2Other.cs".to_string()), "{clos_unk:?}");
    assert!(cs_ws.iter().find(|f| f.path == "src/CsPredef.cs").unwrap().edges.iter().all(|e| e.kind != DepKind::Import));
    let cs_item_hits = find_workspace_callers("src/Ns2Item.cs", None, &cs_ws, &dir);
    assert_eq!(cs_item_hits.iter().find(|h| h.caller_path == "src/CsBareTup.cs").unwrap().call_lines, vec![2]);

    // 4. PHP extensionless same-dir `require 'use helper';` & negative non-leak
    let php_files: &[(&str, &str)] = &[
        ("src/App/Sub/Leaf.php", "<?php\nnamespace App\\Sub;\nclass Leaf {}\n"),
        ("src/use helper", "<?php\nfunction h_bare() { return 1; }\n"),
        ("src/USE something", "<?php\nfunction h_upper() { return 1; }\n"),
        ("src/helper.php", "<?php\nfunction h_trap() { return 9; }\n"),
        ("src/trap.php", "<?php\nfunction t_fn() { return 9; }\n"),
        ("src/php_req_use_bare.php", "<?php\nrequire 'use helper';\nh_bare();\n"),
        ("src/php_req_use_upper.php", "<?php\nrequire 'USE something';\nh_upper();\n"),
        ("src/php_req_use_missing.php", "<?php\nrequire 'use trap';\nt_fn();\n"),
    ];
    let mut php_ws = Vec::new();
    for (p, src) in php_files {
        fs::write(dir.join(p), src).unwrap();
        php_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Php, src));
    }
    let clos_bare = expand_dependency_closure(&["src/php_req_use_bare.php".into()], 2, &php_ws, &dir);
    assert!(clos_bare.contains(&"src/use helper".to_string()), "{clos_bare:?}");
    assert!(!clos_bare.contains(&"src/helper.php".to_string()), "{clos_bare:?}");
    assert_eq!(find_workspace_callers("src/use helper", Some("h_bare"), &php_ws, &dir)[0].call_lines, vec![3]);
    let clos_up = expand_dependency_closure(&["src/php_req_use_upper.php".into()], 2, &php_ws, &dir);
    assert!(clos_up.contains(&"src/USE something".to_string()), "{clos_up:?}");
    assert_eq!(find_workspace_callers("src/USE something", Some("h_upper"), &php_ws, &dir)[0].call_lines, vec![3]);
    let clos_miss = expand_dependency_closure(&["src/php_req_use_missing.php".into()], 2, &php_ws, &dir);
    assert!(!clos_miss.contains(&"src/trap.php".to_string()), "{clos_miss:?}");
    let php_idx = WorkspaceIndex::build(&php_ws, &dir);
    let syn_use = DepEdge { source: "php".into(), target: "use/*c*/App\\Sub\\Leaf".into(), kind: DepKind::Import };
    assert_eq!(resolve_dep_edge(5, &php_ws[5], &syn_use, &php_idx, &dir), ResolveOutcome::WorkspaceFile("src/App/Sub/Leaf.php".into()));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r17_bash_nested_braces() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r17_bash_braces_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        ("r17_dq_nested_uq_param_rp.sh", "x=\"$(y=$(echo ${a:-)}); source ./helpers.sh; do_work)\"\n", true, 1),
        ("r17_dq_nested_uq_param_rp_inside.sh", "x=\"$(y=$(echo ${a:-)} && source ./helpers.sh); do_work)\"\n", true, 1),
        ("r17_dq_case_paren_param_rp.sh", "x=\"$(case a in (${a:-)}) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r17_dq_case_bare_param_rp.sh", "x=\"$(case a in ${a:-)}) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r17_dq_subshell_param_rp.sh", "x=\"$(case a in a) (echo ${b:-)} && source ./helpers.sh) ;; esac; do_work)\"\n", true, 1),
        ("r17_top_case_bare_param_rp.sh", "case a in ${a:-)}) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r17_top_case_paren_param_rp.sh", "case a in (${a:-)}) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r17_top_brace_pat.sh", "case a in {a,b}) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r17_dq_brace_group_case.sh", "x=\"$( { case a in a) source ./helpers.sh ;; esac; } && do_work)\"\n", true, 1),
        ("r17_top_fn_brace_case.sh", "f() { case a in a) source ./helpers.sh ;; esac; }\ndo_work\n", true, 2),
        ("r17_uq_param_cmdsub_case.sh", "x=${a:-$(case b in b) source ./helpers.sh ;; esac)}\ndo_work\n", true, 2),
        ("r17_dq_nested_param_rp.sh", "x=\"$(case a in ${a:-${b:-)}} ) source ./helpers.sh ;; esac; do_work)\"\n", true, 1),
        ("r17_top_param_esac_pat.sh", "case a in ${esac}) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r17_neg_param_source_pat.sh", "x=\"$(case a in ${a:-)}) echo hi ;; source) echo no ;; esac; do_work)\"\n", false, 0),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r18_bash_braces_and_parens() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r18_bash_braces_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // reviewer_2 Finding 1 (5 fixtures)
        ("r18_rev2_src_arg_lbrace_do_work.sh", "source ./helpers.sh ${a:-{do_work}\n", false, 0),
        ("r18_rev2_src_arg_lbrace_nl.sh", "source ./helpers.sh ${a:-{b}\ndo_work\n", true, 2),
        ("r18_rev2_dq_src_arg_lbrace_after.sh", "x=\"$(source ./helpers.sh ${a:-{b})\"; do_work\n", true, 1),
        ("r18_rev2_dq_src_arg_lbrace_and.sh", "x=\"$(source ./helpers.sh ${a:-{b} && do_work)\"\n", true, 1),
        ("r18_rev2_src_lit_lbrace_nl.sh", "source ./helpers.sh {\ndo_work\n", true, 2),
        // challenger_2 Cluster 1 (4 fixtures)
        ("r18_c1_param_prefix_lparen_dq.sh", "a=\"foo(bar\"; x=\"$(echo ${a#*(})\"; source ./helpers.sh; do_work\n", true, 1),
        ("r18_c3_param_subst_lparen_dq.sh", "a=\"x(y\"; x=\"$(echo ${a//(/Z})\"; source ./helpers.sh; do_work\n", true, 1),
        ("r18_c4_param_rp_lp_dq.sh", "x=\"$(echo ${a:-)(})\"; source ./helpers.sh; do_work\n", true, 1),
        ("r18_c26_src_arg_param_lparen.sh", "a=\"x(\"\nsource ./helpers.sh ${a#*(}\ndo_work\n", true, 3),
        // challenger_2 Cluster 2 (5 fixtures)
        ("r18_c8_dq_param_case_x_in_after.sh", "x=\"$(echo ${a:-hi} case x in)\"; source ./helpers.sh; do_work\n", true, 1),
        ("r18_c9_dq_param_case_x_in_inside.sh", "x=\"$(echo ${a:-hi} case x in && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r18_c10_dq_brace_case_x_in_after.sh", "x=\"$(echo {a,b} case x in)\"; source ./helpers.sh; do_work\n", true, 1),
        ("r18_c24_top_param_case_x_in_and.sh", "echo ${a:-hi} case x in && source ./helpers.sh\ndo_work\n", true, 2),
        ("r18_c25_top_param_case_x_in_nl.sh", "echo ${a:-hi} case x in\nsource ./helpers.sh\ndo_work\n", true, 3),
        // Brace groups, function headers, non-boundary braces & env-prefix expansions
        ("r18_fn_kw_case.sh", "function f { case a in a) source ./helpers.sh ;; esac; }\ndo_work\n", true, 2),
        ("r18_fn_parens_sp_case.sh", "f() { case a in a) source ./helpers.sh ;; esac; }\ndo_work\n", true, 2),
        ("r18_fn_parens_nosp_case.sh", "f(){ case a in a) source ./helpers.sh ;; esac; }\ndo_work\n", true, 2),
        ("r18_brace_group_case.sh", "{ case a in a) source ./helpers.sh ;; esac; }\ndo_work\n", true, 2),
        ("r18_echo_empty_braces_case.sh", "echo {} case x in\nsource ./helpers.sh\ndo_work\n", true, 3),
        ("r18_echo_lbrace_case_and.sh", "echo { case x in && source ./helpers.sh\ndo_work\n", true, 2),
        ("r18_env_param_src.sh", "VAR=${a:-x} source ./helpers.sh\ndo_work\n", true, 2),
        ("r18_case_brace_esac_lit.sh", "case \"{esac}\" in {esac}) source ./helpers.sh ;; esac\ndo_work\n", true, 2),
        ("r18_dq_param_semi.sh", "x=\"$(echo ${a:-;} && source ./helpers.sh; do_work)\"\n", true, 1),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    let rev2_neg = all_hits
        .iter()
        .find(|h| h.caller_path == "r18_rev2_src_arg_lbrace_do_work.sh")
        .expect("expected import hit for r18_rev2_src_arg_lbrace_do_work.sh");
    assert_eq!(rev2_neg.imported_symbols, vec!["*".to_string()]);
    assert!(rev2_neg.call_lines.is_empty(), "{rev2_neg:?}");

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r19_bash_env_subshell_hash_dq() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r19_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // 1. Env-prefix VAR=$(...) / VAR=$((...)) / VAR=${a:-$(...)} & negative non-assignment
        ("r19_env_cmdsub_src.sh", "VAR=$(echo hi) source ./helpers.sh\ndo_work\n", true, 2),
        ("r19_env_arith_src.sh", "VAR=$((1+2)) source ./helpers.sh\ndo_work\n", true, 2),
        ("r19_env_param_cmdsub_src.sh", "VAR=${a:-$(echo hi)} source ./helpers.sh\ndo_work\n", true, 2),
        ("r19_env_case_cmdsub_src.sh", "VAR=$(case x in x) echo hi ;; esac) source ./helpers.sh\ndo_work\n", true, 2),
        ("r19_neg_echo_var_cmdsub_src.sh", "echo VAR=$(echo hi) source ./helpers.sh\ndo_work\n", false, 0),
        // 2. Function subshell body f() ( ... )
        ("r19_fn_subshell.sh", "f() ( source ./helpers.sh; do_work )\nf\n", true, 1),
        ("r19_fn_subshell_case.sh", "f() ( case x in x) source ./helpers.sh ;; esac; do_work )\nf\n", true, 1),
        ("r19_fn_kw_subshell.sh", "function f() ( source ./helpers.sh; do_work )\nf\n", true, 1),
        // 3. Backtick `...${...}` in Bash
        ("r19_bt_param_lbrace.sh", "x=`echo ${a:-{b}`\nsource ./helpers.sh\ndo_work\n", true, 3),
        ("r19_bt_dq_param_lbrace.sh", "x=`echo \"${a:-{b}\"`\nsource ./helpers.sh\ndo_work\n", true, 3),
        // 4. `#` after whitespace inside ${...} vs inside ${a:-$(... # cmt)} and outside ${...}
        ("r19_dq_param_space_hash.sh", "x=\"$(echo ${a:- #} && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_top_param_space_hash.sh", "echo ${a:- #} && source ./helpers.sh\ndo_work\n", true, 2),
        ("r19_top_param_cmdsub_cmt.sh", "echo ${a:-$(echo hi # cmt\n)} && source ./helpers.sh\ndo_work\n", true, 3),
        ("r19_dq_param_cmdsub_cmt.sh", "x=\"$(echo ${a:-$(echo hi # cmt\n)} && source ./helpers.sh; do_work)\"\n", true, 2),
        ("r19_neg_top_real_cmt.sh", "echo ${a:-#} # real comment source ./helpers.sh\ndo_work\n", false, 0),
        // 5. Nested "..." inside "${...}" inside "$(...)" (plus nested ${...}, $(...), \")
        ("r19_dq_nested_dq_rp.sh", "x=\"$(echo \"${a:-\")\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_dq_nested_dq_rb.sh", "x=\"$(echo \"${a:-\"}\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_dq_nested_dq_cmdsub_sq.sh", "x=\"$(echo \"${a:-\"$(echo ')')\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_dq_nested_dq_esc.sh", "x=\"$(echo \"${a:-\"\\\"}\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_dq_nested_param_dq_rb.sh", "x=\"$(echo \"${a:-${b:-\"}\"}}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_dq_param_sq_hash.sh", "x=\"$(echo \"${a:-'#'}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r19_var_dq_nested_rb.sh", "VAR=\"${a:-\"}\"}\" source ./helpers.sh\ndo_work\n", true, 2),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r20_bash_param_ws_and_bt() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r20_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // 1. Unquoted whitespace / newline inside ${...} on env-prefix assignments + negative
        ("r20_var_param_space_hash.sh", "VAR=${a:- #} source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_var_param_foobar.sh", "VAR=${a:-foo bar} source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_var_param_space.sh", "VAR=${a:- } source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_var_param_nl.sh", "VAR=${a:-foo\nbar} source ./helpers.sh\ndo_work\n", true, 3),
        ("r20_neg_echo_param_foobar.sh", "echo ${a:-foo bar} source ./helpers.sh\ndo_work\n", false, 0),
        ("r20_neg_echo_param_nl.sh", "echo ${a:-foo\nbar} source ./helpers.sh\ndo_work\n", false, 0),
        // 2. Backticks `...` (escapes, quotes) and '...' inside "${...}"
        ("r20_dq_param_bt_dq_odd.sh", "x=\"$(echo \"${a:-`echo '\"'`}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r20_dq_param_bt_esc_rbrace.sh", "x=\"$(echo \"${a:-`echo \\\"}\\\"` \"x)\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r20_top_dq_param_bt_rbrace_dq.sh", "echo \"${a:-`echo \"}\"`}\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_top_dq_param_bt_rbrace_sq.sh", "echo \"${a:-`echo '}'`}\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_top_dq_param_bt_dq_odd.sh", "echo \"${a:-`echo '\"'`}\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_top_dq_param_bt_sq_odd.sh", "echo \"${a:-`echo \"'\"`}\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_top_dq_param_bt_esc_bt.sh", "echo \"${a:-`echo \\`hi\\``}\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r20_dq_param_bt_nl.sh", "x=\"$(echo \"${a:-`echo '\"'\n`}\" && source ./helpers.sh; do_work)\"\n", true, 2),
        ("r20_dq_param_sq_dq_odd.sh", "x=\"$(echo \"${a:-'x\"y'}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r20_dq_param_sq_rbrace_dq.sh", "x=\"$(echo \"${a:-'x}' \"y)\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}


#[test]
fn regression_w3m2_r21_bash_rparen_bt_dq() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r21_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // 1. `)` inside VAR=${...} on env-prefix assignment + negative
        ("r21_var_param_rparen.sh", "VAR=${a:-)} source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_neg_echo_param_rparen.sh", "echo ${a:-)} source ./helpers.sh\ndo_work\n", false, 0),
        // 2. Double-quoted backticks `...` outside ${...} & inside nested "..." within "${...}"
        ("r21_dq_bt_dq_odd_nl.sh", "echo \"`echo '\"'`\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_dq_bt_dq_odd_same.sh", "echo \"`echo '\"'`\" && source ./helpers.sh; do_work\n", true, 1),
        ("r21_sub_dq_bt_dq_odd.sh", "x=\"$(echo \"`echo '\"'`\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r21_sub_dq_param_dq_bt_dq_odd.sh", "x=\"$(echo \"${a:-\"`echo '\"'`\"}\" && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r21_dq_bt_sq_odd_nl.sh", "echo \"`echo \"'\"`\" && source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_sub_dq_bt_nl.sh", "x=\"$(echo \"`echo '\"'\n`\" && source ./helpers.sh; do_work)\"\n", true, 2),
        ("r21_msg_dq_bt_awk.sh", "MSG=\"`awk -F'\"' '{print $1}' \"$f\"`\" && source ./helpers.sh; do_work\n", true, 1),
        ("r21_neg_dq_bt_lit_src.sh", "echo \"`echo '\"'` source ./helpers.sh\"\ndo_work\n", false, 0),
        // 3. Escaped backticks \` inside top-level / unquoted Bash backticks
        ("r21_top_bt_esc_bt_and.sh", "x=`echo \\`hi\\`` && source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_top_bt_esc_bt_nl.sh", "x=`echo \\`hi\\``\nsource ./helpers.sh\ndo_work\n", true, 3),
        ("r21_var_param_bt_esc_bt.sh", "VAR=${a:-`echo \\`hi\\``} source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_sub_uq_bt_esc_bt.sh", "x=\"$(echo `echo \\`hi\\`` && source ./helpers.sh; do_work)\"\n", true, 1),
        ("r21_var_top_bt_esc_bt_src.sh", "x=`echo \\`hi\\`` source ./helpers.sh\ndo_work\n", true, 2),
        ("r21_src_then_bt_call.sh", "source ./helpers.sh\nx=`do_work`\n", true, 2),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r22_bash_comment_and_bt_source() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r22_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // 1. Bash `#` comments after `)` and opening `` ` `` (including inside `${...`...`}`)
        ("r22_rparen_hash_cmt.sh", "(echo a >/dev/null)# \"\nsource ./helpers.sh\ndo_work\n", true, 3),
        ("r22_arith_rparen_hash_cmt.sh", "((1))# \"\nsource ./helpers.sh\ndo_work\n", true, 3),
        ("r22_subshell_rparen_hash_cmt.sh", "x=\"$( (echo a >/dev/null)# \"\nsource ./helpers.sh; do_work )\"\n", true, 2),
        ("r22_top_bt_hash_cmt.sh", "x=`# \"\necho hi`\nsource ./helpers.sh\ndo_work\n", true, 4),
        ("r22_var_param_bt_hash_cmt.sh", "VAR=${a:-`# \"\necho hi`} source ./helpers.sh\ndo_work\n", true, 3),
        ("r22_cmdsub_rparen_hash_and.sh", "echo $(echo hi)# && source ./helpers.sh\ndo_work\n", true, 2),
        ("r22_var_param_lit_hash.sh", "VAR=${a:-#} source ./helpers.sh\ndo_work\n", true, 2),
        ("r22_var_param_nl_hash.sh", "VAR=${a:-foo\n# }\n source ./helpers.sh\ndo_work\n", true, 4),
        ("r22_var_param_nl_hash_neg.sh", "VAR=${a:-foo\n# source ./helpers.sh\n}\ndo_work\n", false, 0),
        ("r22_case_rparen_hash_cmt.sh", "case \"$x\" in a)# \"\nsource ./helpers.sh; do_work ;; esac\n", true, 2),
        ("r22_bt_close_hash_and.sh", "x=`echo a`# && source ./helpers.sh\ndo_work\n", true, 2),
        // 2. `source`/`.` inside unquoted and double-quoted `` `...` `` command substitutions
        ("r22_uq_bt_source.sh", "x=`source ./helpers.sh; do_work`\n", true, 1),
        ("r22_dq_bt_source.sh", "x=\"`source ./helpers.sh; do_work`\"\n", true, 1),
        ("r22_param_dq_bt_source.sh", "VAR=${a:-\"`source ./helpers.sh; do_work`\"} :\n", true, 1),
        ("r22_param_uq_bt_source.sh", "VAR=${a:-`source ./helpers.sh; do_work`} :\n", true, 1),
        ("r22_echo_param_uq_bt_source.sh", "echo ${a:-`source ./helpers.sh; do_work`}\n", true, 1),
        ("r22_dq_bt_src_then_call.sh", "x=\"`source ./helpers.sh`\" && do_work\n", true, 1),
        ("r22_uq_bt_dot_source.sh", "x=`. ./helpers.sh; do_work`\n", true, 1),
        ("r22_dq_bt_dot_source.sh", "x=\". ./helpers.sh; do_work\"\n", false, 0),
        ("r22_dq_bt_dot_cmdsub.sh", "x=\"`. ./helpers.sh; do_work`\"\n", true, 1),
        // 3. Negative quoted `source` inside backticks & preserved r21 guarantees
        ("r22_neg_uq_bt_dq_src.sh", "x=`echo \"source ./helpers.sh\"`\n", false, 0),
        ("r22_neg_uq_bt_dq_src_call.sh", "x=`echo \"source ./helpers.sh\"` && do_work\n", false, 0),
        ("r22_neg_uq_bt_sq_src.sh", "x=`echo 'source ./helpers.sh'`\n", false, 0),
        ("r22_neg_dq_bt_dq_src.sh", "x=\"`echo \"source ./helpers.sh\"`\"\n", false, 0),
        ("r22_neg_dq_bt_sq_src.sh", "x=\"`echo 'source ./helpers.sh'`\"\n", false, 0),
        ("r22_neg_bt_cmt_src.sh", "x=`# source ./helpers.sh\necho hi`\ndo_work\n", false, 0),
        ("r22_neg_dq_bt_lit_src.sh", "echo \"`echo '\"'` source ./helpers.sh\"\ndo_work\n", false, 0),
        ("r22_dq_bt_esc_bt.sh", "echo \"`echo \\`hi\\``\" && source ./helpers.sh\ndo_work\n", true, 2),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}


#[test]
fn regression_w3m2_r23_bash_nested_bt_and_param_sq() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r23_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    let cases: &[(&str, &str, bool, usize)] = &[
        // 1a. `expansion` (`word` / `concatenation`) & `"${a:-'...'}"`
        ("r23_param_concat_nested_param_bt.sh", "VAR=${a:-`echo ${b:-1} && source ./helpers.sh; do_work`}\n", true, 1),
        ("r23_param_concat_simple_exp_bt.sh", "VAR=${a:-`echo $b && source ./helpers.sh; do_work`}\n", true, 1),
        ("r23_dq_param_concat_simple_exp_bt.sh", "VAR=\"${a:-`echo $b && source ./helpers.sh; do_work`}\"\n", true, 1),
        ("r23_param_concat_cmdsub_bt.sh", "VAR=${a:-`echo $(echo 1) && source ./helpers.sh; do_work`}\n", true, 1),
        ("r23_dq_param_sq_bt_call.sh", "source ./helpers.sh\nVAR=\"${a:-'`do_work`'}\"\n", true, 2),
        ("r23_dq_param_sq_sub_call.sh", "source ./helpers.sh\nVAR=\"${a:-'$(do_work)'}\"\n", true, 2),
        ("r23_dq_param_sq_bt_src.sh", "VAR=\"${a:-'`source ./helpers.sh; do_work`'}\" :\n", true, 1),
        ("r23_dq_param_sq_sub_src.sh", "VAR=\"${a:-'$(source ./helpers.sh; do_work)'}\" :\n", true, 1),
        ("r23_neg_uq_param_sq_bt_src.sh", "VAR=${a:-'`source ./helpers.sh; do_work`'} :\n", false, 0),
        ("r23_neg_dq_param_sq_echo_src.sh", "VAR=\"${a:-'echo source ./helpers.sh; do_work'}\" :\n", false, 0),
        ("r23_dq_param_sq_rbrace.sh", "echo \"${a:-'}'}\" && source ./helpers.sh\ndo_work\n", true, 2),
        // 1b / 2c. `\"` targets & `\"...\"` quoting inside ``"`...`"``
        ("r23_dq_bt_esc_dq_target.sh", "x=\"`source \\\"./helpers.sh\\\"; do_work`\"\n", true, 1),
        ("r23_neg_dq_bt_esc_dq_echo.sh", "x=\"`echo \\\"foo; source ./helpers.sh; do_work\\\"`\"\n", false, 0),
        ("r23_dq_bt_esc_dq_escaped_inner.sh", "x=\"`echo \\\"a \\\\\\\" b; source ./helpers.sh; do_work\\\"`\"\n", false, 0),
        ("r23_dq_bt_esc_dq_esc_bt_src.sh", "x=\"`echo \\\"\\`source ./helpers.sh; do_work\\`\\\"`\"\n", true, 1),
        // 1c / 2b. Nested escaped backticks `` \`...\` `` inside `` `...` `` / ``"`...`"``
        ("r23_uq_bt_esc_bt_src.sh", "x=`echo \\`source ./helpers.sh; do_work\\``\n", true, 1),
        ("r23_dq_bt_esc_bt_src.sh", "x=\"`echo \\`source ./helpers.sh; do_work\\``\"\n", true, 1),
        ("r23_uq_bt_direct_esc_bt_src.sh", "x=`\\`source ./helpers.sh; do_work\\``\n", true, 1),
        ("r23_param_bt_esc_bt_src.sh", "VAR=${a:-`echo \\`source ./helpers.sh; do_work\\``} :\n", true, 1),
        ("r23_dq_param_bt_esc_bt_src.sh", "VAR=\"${a:-`echo \\`source ./helpers.sh; do_work\\``}\"\n", true, 1),
        ("r23_param_bt_esc_bt_line2.sh", "VAR=${a:-`echo \\`source ./helpers.sh\\``} :\ndo_work\n", true, 2),
        ("r23_param_bt3_esc_bt_src.sh", "VAR=${a:-`echo \\`echo \\\\\\`source ./helpers.sh; do_work\\\\\\`\\``} :\n", true, 1),
        ("r23_neg_bt_esc_bt_quoted_src.sh", "x=`echo \\`echo \"source ./helpers.sh; do_work\"\\``\n", false, 0),
        ("r23_neg_bt_cmt_esc_bt_src.sh", "x=`# cmt \\` source ./helpers.sh\necho hi`\ndo_work\n", false, 0),
        ("r23_dq_param_sq_sub_case.sh", "VAR=\"${a:-'$(case b in b) source ./helpers.sh; do_work ;; esac)'}\" :\n", true, 1),
        ("r23_dq_param_sq_nested_bt.sh", "VAR=\"${a:-'`echo \\`source ./helpers.sh; do_work\\``'}\" :\n", true, 1),
        ("r23_dq_bt_esc_dq_and_src.sh", "x=\"`echo \\\"foo\\\" && source \\\"./helpers.sh\\\"; do_work`\"\n", true, 1),
        ("r23_neg_dq_bt_esc_dq_then_call.sh", "x=\"`echo \\\"foo; source ./helpers.sh\\\" && do_work`\"\n", false, 0),
        ("r23_param_bt3_esc_bt_line2.sh", "VAR=${a:-`echo \\`echo \\\\\\`source ./helpers.sh\\\\\\`\\``} :\ndo_work\n", true, 2),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        sh_ws.push(verify_and_parse(&reg, &fw, p, LanguageId::Bash, src));
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_hit, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_hit {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
        }
    }

    let _ = fs::remove_dir_all(&dir);
}


#[test]
fn regression_w3m2_r24_bash_escdq_and_param_sq_esc() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r24_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    // (filename, src, expect_import, expect_call, expected_line)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // 1. Nested `${...}` with literal `"}"` inside `in_inner_dq`
        ("r24_d1_pos_param_inner_dq_rbrace.sh", "VAR=${a:-\"${b:-\"}\"}'$(source ./helpers.sh; do_work)'\"}\n", true, true, 1),
        ("r24_d1_neg_param_unquoted_sq.sh", "VAR=${a:-${b:-\"}\"}'$(source ./helpers.sh; do_work)'}\n", false, false, 0),
        // 2. Backslash escapes inside `"${a:-'...'}"` (`SqInParam` / `in_sq`)
        ("r24_d2_neg_sq_esc_sub.sh", "VAR=\"${a:-'\\$(source ./helpers.sh; do_work)'}\" :\n", false, false, 0),
        ("r24_d2_neg_sq_3bs_sub.sh", "VAR=\"${a:-'\\\\\\$(source ./helpers.sh; do_work)'}\"\n", false, false, 0),
        ("r24_d2_neg_sq_esc_bt_then_bt.sh", "VAR=\"${a:-'\\`source ./helpers.sh; do_work\\`' `echo hi`}\" :\n", false, false, 0),
        ("r24_d2_neg_sq_esc_bt_src1.sh", "source ./helpers.sh\nVAR=\"${a:-'\\`do_work\\`'}\" :\n", true, false, 0),
        ("r24_d2_neg_sq_esc_sub_src1.sh", "source ./helpers.sh\nVAR=\"${a:-'\\$(do_work)'}\" :\n", true, false, 0),
        ("r24_d2_pos_sq_2bs_sub.sh", "VAR=\"${a:-'\\\\$(source ./helpers.sh; do_work)'}\" :\n", true, true, 1),
        ("r24_d2_pos_sq_2bs_bt.sh", "VAR=\"${a:-'\\\\`source ./helpers.sh; do_work`'}\" :\n", true, true, 1),
        ("r24_d2_pos_sq_esc_q_reopen.sh", "VAR=\"${a:-'\\''$(source ./helpers.sh; do_work)'}\" :\n", true, true, 1),
        // 3. Depth >= 3 nested backticks inside `EscDq` at backtick depth 2
        ("r24_d3_pos_bt2_escdq_bt3.sh", "x=\"`echo \\`echo \\\"\\\\\\`source ./helpers.sh; do_work\\\\\\`\\\"\\` `\"\n", true, true, 1),
        ("r24_d3_neg_bt2_escdq_bt3_escdq_5bs.sh", "x=\"`echo \\`echo \\\"\\\\\\`echo \\\\\\\\\\\"foo; source ./helpers.sh; do_work\\\\\\\\\\\"\\\\\\`\\\"\\` `\"\n", false, false, 0),
        ("r24_d3_pos_bt2_escdq_bt3_escdq_sp.sh", "x=\"`echo \\`echo \\\"\\\\\\`echo \\\\\\\\\\\\\\\"foo; source ./helpers.sh; do_work \\\\\\\\\\\\\\\"\\\\\\`\\\"\\` `\"\n", true, true, 1),
        // 4. `(bs % 4) == 1` when entering `EscDq` (5 backslashes `\\\\\"`)
        ("r24_d4_pos_5bs_escdq.sh", "x=\"`echo \\\\\\\\\\\"foo\\\" && source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("r24_d4_neg_5bs_escdq.sh", "x=\"`echo \\\\\\\\\\\"foo; source ./helpers.sh; do_work\\\\\\\\\\\"`\"\n", false, false, 0),
        // 5. `EscDq` `$` backslash parity (`(bs >> d) & 1 == 1` escapes `$`)
        ("r24_d5_neg_escdq_2bs_sub_src1.sh", "source ./helpers.sh\nx=\"`echo \\\"\\\\$(do_work)\\\"`\"\n", true, false, 0),
        ("r24_d5_neg_escdq_2bs_sub.sh", "x=\"`echo \\\"\\\\$(source ./helpers.sh; do_work)\\\"`\"\n", false, false, 0),
        ("r24_d5_neg_escdq_6bs_sub.sh", "x=\"`echo \\\"\\\\\\\\\\\\$(source ./helpers.sh; do_work)\\\"`\"\n", false, false, 0),
        ("r24_d5_pos_escdq_0bs_sub.sh", "x=\"`echo \\\"$(source ./helpers.sh; do_work)\\\"`\"\n", true, true, 1),
        ("r24_d5_pos_escdq_4bs_sub.sh", "x=\"`echo \\\"\\\\\\\\$(source ./helpers.sh; do_work)\\\"`\"\n", true, true, 1),
        ("r24_d5_pos_escdq_2bs_param_sub.sh", "x=\"`echo \\\"\\\\${a:-$(source ./helpers.sh; do_work)}\\\"`\"\n", true, true, 1),
        // 6. `EscDq` inside nested `$(...)` and `` \`...\` `` within `\"...\"` inside ``"`...`"``
        ("r24_d6_neg_sub_escdq.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \\\"foo; do_work\\\")\\\"`\"\n", true, false, 0),
        ("r24_d6_neg_sub_5bs_escdq.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \\\\\\\\\\\"foo; do_work\\\\\\\\\\\")\\\"`\"\n", true, false, 0),
        ("r24_d6_neg_bt_3bs_escdq.sh", "x=\"`source ./helpers.sh; echo \\\"\\`echo \\\\\\\"foo; do_work\\\\\\\"\\`\\\"`\"\n", true, false, 0),
        ("r24_d6_pos_sub_escdq.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \\\"foo\\\"; do_work)\\\"`\"\n", true, true, 1),
        ("r24_d6_pos_bt_3bs_escdq.sh", "x=\"`source ./helpers.sh; echo \\\"\\`echo \\\\\\\"foo\\\\\\\"; do_work\\`\\\"`\"\n", true, true, 1),
        ("r24_d6_pos_param_dq_bt_preserved.sh", "VAR=\"${a:-\"`echo \\\"foo; source ./helpers.sh; do_work \\\"`\"}\"\n", true, true, 1),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        assert_eq!(has_imp, *expect_import, "edge mismatch for {p}: {:?}", parsed.edges);
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            if *expect_import {
                if let Some(hn) = hit_none {
                    assert!(hn.call_lines.is_empty(), "unexpected call_lines (None) {p}: {hn:?}");
                }
            } else {
                assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
            }
        }
    }

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r25_bash_escdq_param_and_depth() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r25_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    let mut open_bts = String::new();
    let mut close_bts = String::new();
    for d in 0..9usize {
        let sl = "\\".repeat((1usize << d) - 1);
        open_bts.push_str(&sl);
        open_bts.push('`');
        if d < 8 {
            open_bts.push_str("echo ");
        }
        close_bts = format!(" {sl}`{close_bts}");
    }
    let bt9_src = format!("x=\"{open_bts}source ./helpers.sh; do_work{close_bts}\"\n");
    let sub9_src = "VAR=${a:-$(echo ${b:-$(echo ${c:-$(echo ${d:-$(echo ${e:-$(echo ${f:-$(echo ${g:-$(echo ${h:-$(echo ${i:-$(source ./helpers.sh; do_work)})})})})})})})})}\n".to_string();

    let cases: Vec<(&str, String, bool, bool, usize)> = vec![
        // EscDq -> Param -> SqInParam -> Sub / NestedBt (`esc_dq_layers` & parity)
        ("r25_z1_escdq_param_sq_sub.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-'$(echo \\\"foo; do_work\\\")'}\\\"`\"\n".into(), true, false, 0),
        ("r25_z3_escdq_param_sq_bt.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-'\\`echo \\\"foo; do_work\\\"\\`'}\\\"`\"\n".into(), true, false, 0),
        ("r25_z3_src_1bs_pos.sh", "x=\"`echo \\\"${a:-'\\`source ./helpers.sh; do_work\\`'}\\\"`\"\n".into(), true, true, 1),
        ("r25_z3_src_3bs_neg.sh", "x=\"`echo \\\"${a:-'\\\\\\`source ./helpers.sh; do_work\\\\\\`'}\\\"`\"\n".into(), false, false, 0),
        ("r25_z4_1bs_escdq_bt_escdq_param_sq_sub_neg.sh", "x=\"`source ./helpers.sh; echo \\`echo \\\"${a:-'$(echo \\\"foo; do_work\\\")'}\\\"\\``\"\n".into(), true, false, 0),
        ("r25_z4_3bs_escdq_bt_escdq_param_sq_sub_pos.sh", "x=\"`source ./helpers.sh; echo \\`echo \\\"${a:-'$(echo \\\\\\\"foo; do_work \\\\\\\")'}\\\"\\``\"\n".into(), true, true, 1),
        // EscDq -> Param -> NestedBt (`classify_esc_dq_bs` & `step_quote_esc_dq_bs`)
        ("r25_z5_p6a_escdq_param_bt_pos.sh", "x=\"`echo \\\"${a:-\\`source ./helpers.sh; do_work\\`}\\\"`\"\n".into(), true, true, 1),
        ("r25_z5_src_out_escdq_param_bt.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\\`do_work\\`}\\\"`\"\n".into(), true, true, 1),
        ("r25_escdq_param_escdq_sub_escdq_1bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\\\"$(echo \\\"foo; do_work\\\")\\\"}\\\"`\"\n".into(), true, false, 0),
        ("r25_escdq_param_escdq_sub_escdq_3bs_pos.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\\\"$(echo \\\\\\\"foo; do_work \\\\\\\")\\\"}\\\"`\"\n".into(), true, true, 1),
        ("r25_z3_escdq_param_sq_bt_src1.sh", "x=\"`echo \\\"${a:-'\\`echo \\\"foo; source ./helpers.sh; do_work \\\"\\`'}\\\"`\"\n".into(), false, false, 0),
        ("r25_p6g_escdq_param_bt_rbrace.sh", "x=\"`echo \\\"${a:-\\`echo \\\"}\\\"\\`}\\\" && source ./helpers.sh; do_work`\"\n".into(), true, true, 1),
        ("r25_p6h_escdq_param_3bs_bt_neg.sh", "x=\"`echo \\\"${a:-\\\\\\`source ./helpers.sh; do_work\\\\\\`}\\\"`\"\n".into(), false, false, 0),
        ("r25_d2_param_3bs_bt_pos.sh", "x=\"`echo \\`echo \\\"${a:-\\\\\\`source ./helpers.sh; do_work\\\\\\`}\\\"\\``\"\n".into(), true, true, 1),
        ("r25_d2_param_7bs_bt_neg.sh", "x=\"`echo \\`echo \\\"${a:-\\\\\\\\\\\\\\`source ./helpers.sh; do_work\\\\\\\\\\\\\\`}\\\"\\``\"\n".into(), false, false, 0),
        // EscDq -> Param -> EscDq `\"}\"` & Challenger 2 cases 1..9
        ("r25_c2_1_escdq_param_rbrace_swallow.sh", "x=\"`echo \\\"${a:-\\\"}\\\"}\\\"`\"\nsource ./helpers.sh\ndo_work\n".into(), true, true, 3),
        ("r25_c2_2_escdq_param_rbrace_same_line.sh", "x=\"`echo \\\"${a:-\\\"}\\\"}\\\" && source ./helpers.sh; do_work`\"\n".into(), true, true, 1),
        ("r25_c2_4_collect_stmt_param_rbrace.sh", "x=\"`source ./helpers.sh \\\"${a:-\\\"}\\\"}\\\"; do_work`\"\n".into(), true, true, 1),
        ("r25_c2_5_escdq_param_bt_rbrace_swallow.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"`\"\nsource ./helpers.sh\ndo_work\n".into(), true, true, 3),
        ("r25_c2_6_escdq_param_bt_rbrace_same_line.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && source ./helpers.sh; do_work`\"\n".into(), true, true, 1),
        ("r25_c2_7_collect_stmt_param_bt_rbrace.sh", "x=\"`source ./helpers.sh \\\"${a:-\\`echo }\\`}\\\"; do_work`\"\n".into(), true, true, 1),
        ("r25_c2_8_sub_escdq_param_rbrace.sh", "x=\"`echo \\\"$(echo \\\"${a:-\\\"}\\\"}\\\")\\\"`\"\nsource ./helpers.sh\ndo_work\n".into(), true, true, 3),
        ("r25_c2_9_nested_param_escdq_rbrace.sh", "x=\"`echo \\\"${a:-\\\"${b:-\\\"}\\\"}\\\"}\\\"`\"\nsource ./helpers.sh\ndo_work\n".into(), true, true, 3),
        // 9+ layer iterative `walk_bash_deps` depth tests (`depth < 64`)
        ("r25_depth8_bt_9layers_pos.sh", bt9_src.clone(), true, true, 1),
        ("r25_depth9_sub_exp_pos.sh", sub9_src.clone(), true, true, 1),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in &cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        assert_eq!(has_imp, *expect_import, "edge mismatch for {p}: {:?}", parsed.edges);
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in &cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            if *expect_import {
                if let Some(hn) = hit_none {
                    assert!(hn.call_lines.is_empty(), "unexpected call_lines (None) {p}: {hn:?}");
                }
            } else {
                assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
            }
        }
    }

    // Verify 9+ layer depth parsing on a 2 MiB thread stack
    let dir_cl = dir.clone();
    std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(move || {
            let reg_t = EngineRegistry::new();
            let fw_t = DefaultSyntaxFirewall;
            let ws_t = vec![
                verify_and_parse(&reg_t, &fw_t, "helpers.sh", LanguageId::Bash, sh_helpers),
                verify_and_parse(&reg_t, &fw_t, "r25_depth8_bt_9layers_pos.sh", LanguageId::Bash, &bt9_src),
                verify_and_parse(&reg_t, &fw_t, "r25_depth9_sub_exp_pos.sh", LanguageId::Bash, &sub9_src),
            ];
            let hits = find_workspace_callers("helpers.sh", Some("do_work"), &ws_t, &dir_cl);
            assert_eq!(hits.len(), 2, "2 MiB stack depth9 hits: {hits:?}");
        })
        .unwrap()
        .join()
        .unwrap();

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r26_bash_recovery_and_param_dq() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r26_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    // (filename, src, expect_import, expect_call, expected_line)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // RC1: Unquoted `${...}` recovery across `UnqBt`/`UnqSub`/`QuotedSub`
        ("r26_r1_1_unq_param_bt_rbrace.sh", "x=\"`VAR=${a:-\\`source ./helpers.sh; do_work; echo }\\`}`\"\n", true, true, 1),
        ("r26_r1_2_unq_param_sub_then_bt_rbrace.sh", "x=\"`VAR=${a:-$(source ./helpers.sh; do_work)} && echo ${b:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_r1_3_unq_param_sub_then_escdq_rbrace.sh", "x=\"`VAR=${a:-$(source ./helpers.sh; do_work)} && echo \\\"${b:-\\`echo }\\`}\\\"`\"\n", true, true, 1),
        ("r26_r1_4_cmdsub_var_unq_param_bt_rbrace.sh", "x=\"`echo \\\"$(VAR=${a:-\\`source ./helpers.sh; do_work; echo }\\`})\\\"`\"\n", true, true, 1),
        ("r26_r1_4b_cmdsub_var_unq_param_sub_rbrace.sh", "x=\"`echo $(VAR=${a:-$(source ./helpers.sh; do_work)}) && echo ${b:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_r1_5_cmdsub_echo_unq_param_bt_rbrace.sh", "x=\"`echo \\\"$(echo ${b:-\\`source ./helpers.sh; do_work; echo }\\`})\\\"`\"\n", true, true, 1),
        ("r26_r1_6_unq_param_sub_newline_bt_rbrace.sh", "x=\"`VAR=${a:-$(source ./helpers.sh\ndo_work)} && echo ${b:-\\`echo }\\`}`\"\n", true, true, 2),
        ("r26_r2_1_esc_dollar_unq_param_bt.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && VAR=\\${b:-\\`source ./helpers.sh; do_work\\`}`\"\n", true, true, 1),
        ("r26_r2_2_semi_unq_param_bt.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; ${b:-\\`source ./helpers.sh; do_work\\`}`\"\n", true, true, 1),
        ("r26_r2_3_semi_unq_param_bt_sp.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; ${b:-\\` source ./helpers.sh; do_work \\`}`\"\n", true, true, 1),
        ("r26_r2_4_semi_echo_unq_param_bt.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; echo ${b:-\\`source ./helpers.sh; do_work\\`}`\"\n", true, true, 1),
        ("r26_r2_5_semi_unq_param_sub.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; ${b:-$(source ./helpers.sh; do_work)}`\"\n", true, true, 1),
        ("r26_r2_6_semi_unq_param_sub_sp.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; ${b:-$( source ./helpers.sh; do_work )}`\"\n", true, true, 1),
        ("r26_r2_7_nested_unq_param_sub.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\"; echo ${b:-${c:-$(source ./helpers.sh; do_work)}}`\"\n", true, true, 1),
        ("r26_c1_1_echo_unq_param_bt_rbrace.sh", "x=\"`echo ${a:-\\`source ./helpers.sh; do_work; echo }\\`}`\"\n", true, true, 1),
        ("r26_c1_2_echo_two_unq_param_bt.sh", "x=\"`echo ${a:-\\`echo }\\`} ${b:-\\`source ./helpers.sh; do_work\\`}`\"\n", true, true, 1),
        ("r26_c2_1_echo_unq_sub_and_err_param.sh", "x=\"`echo ${a:-$(source ./helpers.sh; do_work)} && y=\\\"${b:-\\`echo }\\`}\\\"`\"\n", true, true, 1),
        ("r26_c2_2_assign_unq_param_bt_rbrace_and.sh", "x=\"`y=${a:-\\`source ./helpers.sh; do_work; echo }\\`} && echo ok`\"\n", true, true, 1),
        ("r26_c2_3_assign_unq_sub_sq_rbrace_and_err.sh", "x=\"`y=${a:-$(source ./helpers.sh; do_work; echo '}')} && z=\\\"${b:-\\`echo }\\`}\\\"`\"\n", true, true, 1),
        ("r26_c2_4_assign_unq_bt_and_err.sh", "x=\"`y=${a:-\\`source ./helpers.sh; do_work\\`} && z=\\\"${b:-\\`echo }\\`}\\\"`\"\n", true, true, 1),
        // RC2: `#` comment inside backtick before closing backtick
        ("r26_r2_8_bt_hash_comment_newline.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\`}\\\"\nsource ./helpers.sh; do_work`\"\n", true, true, 2),
        // RC3: `EscDq -> Param -> Dq` (`in_esc_dq_context` & `esc_dq_layers`)
        ("r26_c1_3_escdq_param_dq_bt_pos.sh", "x=\"`echo \\\"${a:-\"\\`source ./helpers.sh; do_work\\`\"}\\\"`\"\n", true, true, 1),
        ("r26_c1_4_escdq_param_dq_bt_src_out_pos.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\"\\`do_work\\`\"}\\\"`\"\n", true, true, 1),
        ("r26_c1_5_escdq_param_dq_bt_3bs_pos.sh", "x=\"`echo \\\"${a:-\"\\`echo \\\\\\\"foo; source ./helpers.sh; do_work \\\\\\\"\\`\"}\\\"`\"\n", true, true, 1),
        ("r26_c1_6_escdq_param_dq_sub_1bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\"$(echo \\\"foo; do_work \\\")\"}\\\"`\"\n", true, false, 0),
        // RC4: `EscDq -> Param -> Bt` in same recovery layer (`bt_depth` 1 and 2)
        ("r26_c2_5_escdq_param_bt_in_same_l1_err.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && echo \\\"\\`echo \\\\\\\"${b:-\\\\\\`source ./helpers.sh; do_work\\\\\\`}\\\\\\\"\\`\\\"`\"\n", true, true, 1),
        ("r26_c2_5b_escdq_param_bt_depth2_err.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && echo \\\"\\`echo \\\\\\\"$(echo \\\\\\\"${c:-\\\\\\`source ./helpers.sh; do_work\\\\\\`}\\\\\\\")\\\\\\\"\\`\\\"`\"\n", true, true, 1),
        // Non-`${` Brace-Group & Paren Invariants
        ("r26_bg_1_simple_brace_group.sh", "{ source ./helpers.sh; do_work; }\n", true, true, 1),
        ("r26_bg_2_brace_grp_in_unq_param_sub.sh", "x=\"`VAR=${a:-$( { source ./helpers.sh; do_work; } )} && echo ${b:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_bg_3_lit_lbrace_in_param_then_sub.sh", "x=\"`VAR=${a:-{b}$(source ./helpers.sh; do_work) && echo ${c:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_bg_4_eval_brace_then_src.sh", "eval { echo hi\\; } && source ./helpers.sh; do_work\n", true, true, 1),
        ("r26_bg_5_eval_brace_in_unq_param_sub.sh", "x=\"`VAR=${a:-$(eval { echo hi\\; } && source ./helpers.sh; do_work)} && echo ${b:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_bg_6_brace_grp_wrapping_param_sub.sh", "x=\"`{ VAR=${a:-$(source ./helpers.sh; do_work)}; } && echo ${b:-\\`echo }\\`}`\"\n", true, true, 1),
        ("r26_bg_7_param_rparen_inside_sub.sh", "x=\"`VAR=${a:-$(echo ${b:-)}; source ./helpers.sh; do_work)} && echo ${c:-\\`echo }\\`}`\"\n", true, true, 1),
        // Explorer B additional ground-truth cases (`DefaultSyntaxFirewall::verify == Valid` + `bash -n -c` + `bash -c`)
        ("r26_eb_param_dq_sub_bt_1bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\"$(echo \\`echo \\\"foo; do_work \\\"\\`)\"}\\\"`\"\n", true, false, 0),
        ("r26_eb_param_dq_sub_bt_3bs_pos.sh", "x=\"`echo \\\"${a:-\"$(echo \\`echo \\\\\\\"foo; source ./helpers.sh; do_work \\\\\\\"\\`)\"}\\\"`\"\n", true, true, 1),
        ("r26_eb_param_dq_bt_preserved.sh", "VAR=\"${a:-\"`echo \\\"foo; source ./helpers.sh; do_work \\\"`\"}\"\n", true, true, 1),
    ];

    // Explorer B ground-truth cases valid in `bash -n -c` / `bash -c` whose layer-0 CST nesting hits tree-sitter-bash quirks
    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        ("r26_eb_sub_dq_param_bt_1bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \"${a:-\\`echo \\\"foo; do_work \\\"\\`}\")\\\"`\"\n", true, false, 0),
        ("r26_eb_sub_dq_param_bt_3bs_pos.sh", "x=\"`echo \\\"$(echo \"${a:-\\`echo \\\\\\\"foo; source ./helpers.sh; do_work \\\\\\\"\\`}\")\\\"`\"\n", true, true, 1),
        ("r26_eb_param_escdq_bt_1bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"${a:-\\\"\\`echo \\\"foo; do_work \\\"\\`\\\"}\\\"`\"\n", true, false, 0),
        ("r26_eb_param_escdq_bt_3bs_pos.sh", "x=\"`echo \\\"${a:-\\\"\\`echo \\\\\\\"foo; source ./helpers.sh; do_work \\\\\\\"\\`\\\"}\\\"`\"\n", true, true, 1),
        ("r26_eb_sub_dq_bt_3bs_neg.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \"\\`echo \\\\\\\"foo; do_work \\\\\\\"\\`\")\\\"`\"\n", true, false, 0),
        ("r26_eb_param_escdq_mixed_close.sh", "x=\"`echo \\\"${a:-\\\"foo\"$(source ./helpers.sh; do_work)}\\\"`\"\n", true, true, 1),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        assert_eq!(has_imp, *expect_import, "edge mismatch for {p}: {:?}", parsed.edges);
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        assert_eq!(has_imp, *expect_import, "edge mismatch for {p}: {:?}", parsed.edges);
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            if *expect_import {
                if let Some(hn) = hit_none {
                    assert!(hn.call_lines.is_empty(), "unexpected call_lines (None) {p}: {hn:?}");
                }
            } else {
                assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
            }
        }
    }

    let _ = fs::remove_dir_all(&dir);
}


#[test]
fn regression_w3m2_r27_bash_escdq_bt_hash_and_paired_exp() {
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r27_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    // (filename, src, expect_import, expect_call, expected_line)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Bug 1 (reviewer_2 + challenger_1): `EscDq` 0-backslash `"` exit under non-`Param` parents
        ("r27_r2_1_mixed_bt_escdq_0bs_pos.sh", "x=\"`echo \\\"foo\"; source ./helpers.sh; do_work; echo \"bar\\\"`\"\n", true, true, 1),
        ("r27_r2_2_mixed_bt_sub_escdq_0bs_pos.sh", "x=\"`echo \\\"$(echo \\\"foo\"; source ./helpers.sh; do_work; echo \"bar\\\")\\\"`\"\n", true, true, 1),
        ("r27_r2_3_mixed_bt_param_bt_escdq_0bs_pos.sh", "x=\"`echo \\\"${a:-\\`echo \\\"foo\"; source ./helpers.sh; do_work; echo \"bar\\\"\\`}\\\"`\"\n", true, true, 1),
        ("r27_r2_4_false_pos_escdq_0bs_flip.sh", "x=\"`source ./helpers.sh; echo \\\"foo\" && echo \\\"do_work\\\" && echo \"bar\\\"`\"\n", true, false, 0),
        ("r27_r2_5_false_pos_escdq_0bs_flip_sub.sh", "x=\"`source ./helpers.sh; echo \\\"$(echo \\\"foo\" && echo \\\"do_work\\\" && echo \"bar\\\")\\\"`\"\n", true, false, 0),
        ("r27_c1_1_escdq_0bs_close_balanced_cmd.sh", "x=\"`echo \\\"foo\" && source ./helpers.sh; do_work && echo \"bar\\\"`\"\n", true, true, 1),
        ("r27_c1_2_escdq_0bs_close_balanced_two_strs.sh", "x=\"`echo \\\"foo\" && source ./helpers.sh; do_work && echo \\\"bar\"`\"\n", true, true, 1),
        ("r27_c1_3_escdq_0bs_close_after_param_balanced.sh", "x=\"`echo \\\"${a:-\\\"foo\\\"}\" && source ./helpers.sh; do_work && echo \"bar\\\"`\"\n", true, true, 1),
        ("r27_c1_4_escdq_0bs_close_after_param_balanced2.sh", "x=\"`echo \\\"${a:-\\\"foo\\\"}\" && source ./helpers.sh; do_work && echo \\\"bar\"`\"\n", true, true, 1),
        ("r27_c1_5_bug1_neg_inverted_parity.sh", "x=\"`source ./helpers.sh; echo \\\"foo\" && echo \\\"bar; do_work\"`\"\n", true, false, 0),
        ("r27_c1_6_bug1_pos_0bs_close_then_sub_then_0bs_a.sh", "x=\"`echo \\\"foo\" && source ./helpers.sh; do_work && echo \\\"$(echo ok)\"`\"\n", true, true, 1),
        ("r27_c1_6b_bug1_pos_0bs_close_then_sub_then_0bs_b.sh", "x=\"`echo \\\"foo\" && source ./helpers.sh; do_work && echo \"$(echo ok)\\\"`\"\n", true, true, 1),
        ("r27_c1_7_bug1_pos_sub_escdq_0bs_close.sh", "x=\"`echo $(echo \\\"foo\" && source ./helpers.sh; do_work && echo \\\"bar\")`\"\n", true, true, 1),
        ("r27_c1_8_bug1_pos_other_stmt_escdq_0bs.sh", "x=\"`source ./helpers.sh && echo \\\"foo\" && do_work && echo \\\"bar\"`\"\n", true, true, 1),
        // Bug 2 (challenger_1 + challenger_2): Backtick `#` comment + `\<newline>` line continuation
        ("r27_c1_9_recov_bt_hash_escaped_nl_2bs.sh", "x=\"`echo ${a:-\\`echo }; # cmt\\\\\nsource ./helpers.sh; do_work\\`}`\"\n", false, false, 0),
        ("r27_c1_10_recov_bt_hash_1bs_nl_quoted_bt.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_c1_11_plain_bt_hash_1bs_nl.sh", "x=`echo ok; # cmt\\\nsource ./helpers.sh; do_work`\n", false, false, 0),
        ("r27_c1_12_plain_dqbt_hash_1bs_nl.sh", "x=\"`echo ok; # cmt\\\nsource ./helpers.sh; do_work`\"\n", false, false, 0),
        ("r27_c1_13_recov_bt_hash_1bs_nl.sh", "x=\"`echo ${a:-\\`echo }; # cmt\\\nsource ./helpers.sh; do_work\\`} && echo ${b:-\\`echo }\\`}`\"\n", false, false, 0),
        ("r27_c2_b2_1_unq_bt_1bs_nl.sh", "x=`# cmt \\\nsource ./helpers.sh; do_work`\n", false, false, 0),
        ("r27_c2_b2_2_dq_bt_1bs_nl.sh", "x=\"`# cmt \\\nsource ./helpers.sh; do_work`\"\n", false, false, 0),
        ("r27_c2_b2_3_unq_bt_3bs_nl.sh", "x=`# cmt \\\\\\\nsource ./helpers.sh; do_work`\n", false, false, 0),
        ("r27_c2_b2_4_dq_bt_3bs_nl.sh", "x=\"`# cmt \\\\\\\nsource ./helpers.sh; do_work`\"\n", false, false, 0),
        ("r27_c2_b2_5_unq_bt_5bs_nl.sh", "x=`# cmt \\\\\\\\\\\nsource ./helpers.sh; do_work`\n", false, false, 0),
        ("r27_c2_b2_6_dq_bt_5bs_nl.sh", "x=\"`# cmt \\\\\\\\\\\nsource ./helpers.sh; do_work`\"\n", false, false, 0),
        // Bug 2 `bt_depth = 2` sweep (`bs = 0..8`) + multi-line continuation
        ("r27_sweep_d2_0bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", true, true, 2),
        ("r27_sweep_d2_1bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_2bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_3bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_4bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", true, true, 2),
        ("r27_sweep_d2_5bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_6bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_7bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\\\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", false, false, 0),
        ("r27_sweep_d2_8bs.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt\\\\\\\\\\\\\\\\\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", true, true, 2),
        ("r27_bt_hash_multiline_cont_then_live.sh", "x=`# cmt \\\nstill_comment \\\\\nsource ./helpers.sh; do_work`\n", true, true, 3),
        // Bug 3 (challenger_2): Paired `${...:-`echo }`}` CST desync (`root.has_error() == false`)
        ("r27_c2_b1_1_two_err.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && echo \\\"${b:-\\`source ./helpers.sh; do_work; echo }\\`}\\\"`\"\n", true, true, 1),
        ("r27_c2_b1_2_two_err_simpler.sh", "echo \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 1),
        ("r27_c2_b1_3_two_err_unq.sh", "echo ${a:-`echo }`} && echo ${b:-`source ./helpers.sh; do_work; echo }`}\n", true, true, 1),
        ("r27_c2_b1_4_two_err_l0_dq.sh", "x=\"`echo ${a:-\\`echo }\\`} && echo ${b:-\\`source ./helpers.sh; do_work; echo }\\`}`\"\n", true, true, 1),
        ("r27_c2_b1_5_between_two_err_dq.sh", "echo \"${a:-`echo }`}\" && source ./helpers.sh; do_work && echo \"${b:-`echo }`}\"\n", true, true, 1),
        ("r27_c2_b1_6_between_two_err_l0_dq.sh", "x=\"`echo \\\"${a:-\\`echo }\\`}\\\" && source ./helpers.sh; do_work && echo \\\"${b:-\\`echo }\\`}\\\"`\"\n", true, true, 1),
        ("r27_healthy_sq_heredoc_with_param.sh", "cat <<'EOF'\n${FOO}\nEOF\nsource ./helpers.sh; do_work\n", true, true, 4),
    ];

    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        assert_eq!(has_imp, *expect_import, "edge mismatch for {p}: {:?}", parsed.edges);
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            let h = hit.unwrap_or_else(|| panic!("missing bash caller {p}: {sh_hits:?}"));
            assert_eq!(h.imported_symbols, vec!["*".to_string()], "{p}: {h:?}");
            assert_eq!(h.call_lines, vec![*exp_line], "{p}: {h:?}");
            let hn = hit_none.unwrap_or_else(|| panic!("missing bash caller (None) {p}: {all_hits:?}"));
            assert_eq!(hn.imported_symbols, vec!["*".to_string()], "{p} (None): {hn:?}");
            assert_eq!(hn.call_lines, vec![*exp_line], "{p} (None): {hn:?}");
        } else {
            assert!(hit.is_none(), "unexpected bash caller {p}: {hit:?}");
            if *expect_import {
                if let Some(hn) = hit_none {
                    assert!(hn.call_lines.is_empty(), "unexpected call_lines (None) {p}: {hn:?}");
                }
            } else {
                assert!(hit_none.is_none(), "unexpected bash caller (None) {p}: {hit_none:?}");
            }
        }
    }

    // Also confirm depth >= 60 recovery does not overflow or lose callers, and healthy `${DIR}` import target is preserved.
    let mut deep_src = String::new();
    for _ in 0..64 {
        deep_src.push_str("echo ${a:-");
    }
    deep_src.push_str("$(source ./helpers.sh; do_work)");
    for _ in 0..64 {
        deep_src.push('}');
    }
    deep_src.push('\n');
    let parsed_deep = verify_and_parse(&reg, &fw, "r27_depth64.sh", LanguageId::Bash, &deep_src);
    assert!(parsed_deep.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh"));
    let parsed_healthy_var = verify_and_parse(&reg, &fw, "r27_healthy_var.sh", LanguageId::Bash, "source \"${DIR}/helpers.sh\"\n");
    assert!(parsed_healthy_var.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "${DIR}/helpers.sh"));

    let _ = fs::remove_dir_all(&dir);
}

#[test]
fn regression_w3m2_r28_bash_heredoc_sq_unqbt() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r28_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();
    // 40 deduplicated Explorer C fixtures + Explorer A/B extra edge cases
    // (filename, src, expect_import, expect_call, expected_line)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // 1-3: Empty line resets BashBtComment (`reviewer_2` Bug 1)
        ("r28_r2_empty_bt_hash_unq.sh", "x=`# cmt \\\n\nsource ./helpers.sh; do_work`\n", true, true, 3),
        ("r28_r2_empty_bt_hash_dq.sh", "x=\"`# cmt \\\n\nsource ./helpers.sh; do_work`\"\n", true, true, 3),
        ("r28_r2_empty_bt_hash_d2.sh", "x=\"`echo \\\"${a:-\\`echo }; # cmt \\\\\n\nsource ./helpers.sh; do_work\\`}\\\"`\"\n", true, true, 3),
        // 4-9: Quoted heredocs in `recover_bash_error_expansions` (`challenger_1b` Bug 1)
        ("r28_c1_b1_sq_unclosed_sq_desync.sh", "cat <<'EOF'\n'unclosed\nEOF\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 4),
        ("r28_c1_b1_sq_unclosed_param_desync.sh", "cat <<'EOF'\n${FOO:-\nEOF\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 4),
        ("r28_c1_b1_dash_sq_unclosed_param.sh", "cat <<-'EOF'\n\t${FOO:-\n\tEOF\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 4),
        ("r28_c1_b1_sq_bt_desync.sh", "cat <<'EOF'\n`unclosed_bt\nEOF\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 4),
        ("r28_c1_b1_param_eats_fn_source.sh", "cat <<'EOF'\n${FOO:-\nEOF\nf() { source ./helpers.sh; do_work; }\nf\necho \"${a:-`echo }`}\" && echo \"${b:-`echo }`}\"\n", true, true, 4),
        ("r28_c1_b1_sq_eats_trailing_after_fn.sh", "cat <<'EOF'\n'unclosed\nEOF\nf() { echo hi; }\nf\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 6),
        // 10-15: Bash `\<newline>` line-continuation coalescing (`challenger_1b` Bug 2 + top-level)
        ("r28_c1_b2_bt_nl_splits_kw.sh", "x=`sou\\\nrce ./helpers.sh; do_\\\nwork`\n", true, true, 1),
        ("r28_c1_b2_dqbt_nl_splits_kw.sh", "x=\"`sou\\\nrce ./helpers.sh; do_\\\nwork`\"\n", true, true, 1),
        ("r28_c1_b2_parambt_nl_splits_kw.sh", "x=\"${a:-`sou\\\nrce ./helpers.sh; do_\\\nwork`}\"\n", true, true, 1),
        ("r28_c1_top_nl_splits_kw.sh", "sou\\\nrce ./helpers.sh; do_\\\nwork\n", true, true, 1),
        ("r28_c1_top_nl_before_hash.sh", "echo ok\\\n#cmt; source ./helpers.sh; do_work\n", true, true, 1),
        ("r28_c1_top_nl_ws_before_hash.sh", "echo ok \\\n#cmt\nsource ./helpers.sh; do_work\n", true, true, 3),
        // 16-22: `UnqBt` / `Param->Bt` -> `Dq` -> `\`` (`challenger_2b` Bug 1)
        ("r28_c2_b1_paired_exp_in_bt_l0.sh", "x=`echo \"${a:-\\`echo }\\`}\" && echo \"${b:-\\`source ./helpers.sh; do_work; echo }\\`}\"`\n", true, true, 1),
        ("r28_c2_b1_unqbt_dq_nested_bt.sh", "x=`echo \"\\`source ./helpers.sh; do_work\\`\"`\n", true, true, 1),
        ("r28_c2_b1_unqbt_dq_nested_bt_hash.sh", "x=`echo \"\\`echo \\\"#\\\"; source ./helpers.sh; do_work\\`\"`\n", true, true, 1),
        ("r28_c2_b1_unqbt_dq_param_bt.sh", "x=`echo \"${a:-\\`source ./helpers.sh; do_work\\`}\"`\n", true, true, 1),
        ("r28_c2_b1_param_bt_dq_nested_bt.sh", "echo ${a:-`echo \"\\`source ./helpers.sh; do_work\\`\"`}\n", true, true, 1),
        ("r28_c2_b1_unqbt_dq_bt_bs2_dq.sh", "x=`echo \"\\`echo \\\"hi\\\" && source ./helpers.sh; do_work\\`\"`\n", true, true, 1),
        ("r28_c2_b1_unqbt_dq_bt_bs3_dq.sh", "x=`echo \"\\`echo \\\\\"hi\\\\\" && source ./helpers.sh; do_work\\`\"`\n", true, true, 1),
        // 23: `$'...'` ANSI-C quoting (`challenger_2b` Bug 2)
        ("r28_c2_b2_ansi_c_rbrace_in_param.sh", "echo ${a:-$'\\'}'} && source ./helpers.sh; do_work\n", true, true, 1),
        // 24-30: Bash single-quote lexer (`challenger_2b` Bug 3)
        ("r28_c2_b3_bt_sq_line_cont.sh", "x=`echo 'hello \\\nworld' && source ./helpers.sh; do_work`\n", true, true, 2),
        ("r28_c2_b3_ml_sq_after_valid.sh", "x='hello\nworld' && source ./helpers.sh; do_work\n", true, true, 2),
        ("r28_c2_b3_ml_sq_false_pos.sh", "source ./helpers.sh\nx='hello\ndo_work\nworld'\n", true, false, 0),
        ("r28_c2_b3_ml_sq_in_bt_false_pos.sh", "x=`source ./helpers.sh\necho 'hello\ndo_work\nworld'`\n", true, false, 0),
        ("r28_c2_b3_sq_bs_end_valid_after.sh", "x='\\' && source ./helpers.sh; do_work\n", true, true, 1),
        ("r28_c2_b3_sq_bs_end_in_bt.sh", "x=`echo '\\' && source ./helpers.sh; do_work`\n", true, true, 1),
        ("r28_c2_b3_sq_trail_bs_multiline.sh", "x='a\\\nb' && source ./helpers.sh; do_work\n", true, true, 2),
        // 31-36: Unquoted heredocs (`challenger_2b` Bug 4 + `<<-EOF` tabs + backticks + paired desync)
        ("r28_c2_b4_exp_in_heredoc_only.sh", "cat <<EOF\n${a:-`source ./helpers.sh; do_work`}\nEOF\n", true, true, 2),
        ("r28_c2_b4_heredoc_unq_sub.sh", "source ./helpers.sh\ncat <<EOF\n$(do_work)\nEOF\n", true, true, 3),
        ("r28_c2_b4_heredoc_strip_tabs_unq.sh", "source ./helpers.sh\ncat <<-EOF\n\t$(do_work)\n\tEOF\n", true, true, 3),
        ("r28_c2_b4_heredoc_unq_bt.sh", "cat <<EOF\n`source ./helpers.sh; do_work`\nEOF\n", true, true, 2),
        ("r28_heredoc_unq_paired_desync.sh", "cat <<EOF\n${a:-`echo }`}\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 3),
        ("r28_heredoc_unq_cmdsub.sh", "cat <<EOF\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        // 37-40: Negative controls
        ("r28_neg_heredoc_unq_lit_escaped.sh", "source ./helpers.sh\ncat <<EOF\ndo_work\n${do_work}\n\\$(do_work)\n\\`do_work\\`\nEOF\n", true, false, 0),
        ("r28_neg_heredoc_dq_lit.sh", "source ./helpers.sh\ncat <<\"EOF\"\n$(do_work)\n`do_work`\nEOF\n", true, false, 0),
        ("r28_neg_heredoc_bs_lit.sh", "source ./helpers.sh\ncat <<\\EOF\n$(do_work)\n`do_work`\nEOF\n", true, false, 0),
        ("r28_neg_ansic_ml_false_pos.sh", "source ./helpers.sh\nx=$'hello\\'\ndo_work\nworld'\n", true, false, 0),
        // Extra Explorer A + B edge cases
        ("r28_eb_unqbt_3bs_dq_falsepos.sh", "x=`echo \\\\\\\"do_work\\\\\\\" && source ./helpers.sh`\n", true, false, 0),
        ("r28_eb_ansic_3bs_rbrace_in_param.sh", "echo ${a:-$'\\\\\\'}'} && source ./helpers.sh; do_work\n", true, true, 1),
        ("r28_eb_ansic_rbrace_then_sub_in_param.sh", "echo ${a:-$'\\'}'$(source ./helpers.sh; do_work)}\n", true, true, 1),
        ("r28_eb_ansic_ml_after.sh", "x=$'hello\nworld' && source ./helpers.sh; do_work\n", true, true, 2),
        ("r28_eb_dollar2_plain_sq_pos.sh", "x=$$'a\\' && source ./helpers.sh; do_work\n", true, true, 1),
        ("r28_eb_dollar3_ansic_pos.sh", "x=$$$'a\\'b' && source ./helpers.sh; do_work\n", true, true, 1),
        ("r28_eb_dollar3_ansic_neg.sh", "source ./helpers.sh\nx=$$$'a\\'\ndo_work\n'\n", true, false, 0),
        ("r28_eb_unqbt_ansic_4bs.sh", "x=`echo $'\\\\\\\\' && source ./helpers.sh; do_work`\n", true, true, 1),
        ("r28_ea_arith_lshift_guard.sh", "x=$((1 << 2))\necho \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 2),
        ("r28_ea_heredoc_tab_exp_bt.sh", "cat <<-EOF\n\t${a:-`source ./helpers.sh; do_work`}\n\tEOF\n", true, true, 2),
        ("r28_ea_heredoc_tab_raw_bt.sh", "cat <<-EOF\n\t`source ./helpers.sh; do_work`\n\tEOF\n", true, true, 2),
        ("r28_ea_heredoc_composite_sq_lit.sh", "source ./helpers.sh\ncat <<E'O'F\n$(do_work)\nEOF\n", true, false, 0),
        ("r28_ea_heredoc_bs_mid_lit.sh", "source ./helpers.sh\ncat <<E\\OF\n$(do_work)\nEOF\n", true, false, 0),
        ("r28_ea_heredoc_hdr_sibling_then_sq.sh", "cat <<'EOF' && echo \"${a:-`echo }`}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n'unclosed\nEOF\n", true, true, 1),
    ];

    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        ("r28_eb_unqbt_2bs_dq_live.sh", "x=`echo \\\\\" && source ./helpers.sh; do_work`\n", true, true, 1),
        ("r28_ea_cmdsub_sq_heredoc_in_param.sh", "echo \"${a:-$(cat <<'EOF'\n'unclosed\nEOF\n)}\" && echo \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 4),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "r28 failures ({}):\n{}", errs.len(), errs.join("\n"));
}

#[test]
fn regression_w3m2_r29_bash_arith_heredoc_cont() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r29_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    // Valid Bash & tree-sitter-bash fixtures (verified via DefaultSyntaxFirewall::verify)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Cluster 1: $((...)), "$((...))", ((...)), for ((...)), and ( (cat <<EOF subshell preservation
        ("r29_r2_arith_cont.sh", "x=$((1 << 2))\nsou\\\nrce ./helpers.sh; do_work\n", true, true, 2),
        ("r29_r2_arith_in_param_heredoc.sh", "echo \"${a:-$(x=$((1 << 2)); cat <<'EOF'\n'unclosed\nEOF\nsource ./helpers.sh; do_work\n)}\"\n", true, true, 4),
        ("r29_r2_dq_arith_cont.sh", "echo \"$((1 << 2))\"\nsou\\\nrce ./helpers.sh; do_work\n", true, true, 2),
        ("r29_r2_dq_arith_hash.sh", "echo \"$((1 << 2))\"\n# ${a:-`source ./helpers.sh; do_work`}\n", false, false, 0),
        ("r29_c1_arith_cmd_lshift_source.sh", "a=1; ((a << 2))\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("r29_c1_arith_cmd_lshift_split.sh", "a=1; (( a << 2 ))\nsource ./helpers.sh\ndo_work\n", true, true, 3),
        ("r29_c1_arith_cmd_cont_deps.sh", "((a << 2))\nsou\\\nrce ./helpers.sh; do_\\\nwork\n", true, true, 2),
        ("r29_c1_for_arith_lshift.sh", "for ((i = 1 << 2; i < 5; i++)); do\nsource ./helpers.sh; do_work\nbreak\ndone\n", true, true, 2),
        ("r29_c1_nested_subshell_heredoc.sh", "source ./helpers.sh\n( (cat <<EOF\ndo_work\nEOF\n) )\n", true, false, 0),
        // Cluster 2: Nested heredoc in scan_heredoc_end & UnquotedBody
        ("r29_c1_u_param_cmdsub_sq_heredoc_then_sub.sh", "cat <<EOF >/dev/null\n${a:-$(cat <<'INNER'\n'unclosed\nINNER\n)}\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 6),
        ("r29_u_param_unq_nested_heredoc.sh", "cat <<EOF >/dev/null\n${a:-$(cat <<INNER\n'unclosed\nINNER\n)}\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 6),
        // Cluster 3 & 4: $'...' EOL backslashes inside backticks & sq_carry_bs leading-backslash
        ("r29_c2_ansic_k3_m1.sh", "x=`echo $'a\\\\\\\n\\' && source ./helpers.sh; do_work`\n", true, true, 2),
        ("r29_c2_ansic_k3_m2.sh", "x=`echo $'a\\\\\\\n\\\\' && source ./helpers.sh; do_work`\n", true, true, 2),
        ("r29_c2_ansic_k3_m3.sh", "x=`echo $'a\\\\\\\n\\\\\\' && source ./helpers.sh; do_work`\n", false, false, 0),
        ("r29_c2_ansic_k3_chained.sh", "x=`echo $'a\\\\\\\n\\\\\\\n' && source ./helpers.sh; do_work`\n", true, true, 3),
        // Cluster 5: Escaped \$ / \< + \<newline> carry
        ("r29_c2_dq_esc_dollar_nl.sh", "source ./helpers.sh\nx=\"\\$\\\n(do_work)\"\n", true, false, 0),
        ("r29_c2_dq_3bs_dollar_nl.sh", "source ./helpers.sh\nx=\"\\\\\\$\\\n(do_work)\"\n", true, false, 0),
        ("r29_c2_dq_2bs_dollar_nl.sh", "source ./helpers.sh\nx=\"\\\\$\\\n(do_work)\"\n", true, true, 2),
        ("r29_c2_code_esc_lt_nl.sh", "source ./helpers.sh\necho \\<\\\n<EOF\ndo_work\nEOF\n", true, true, 4),
        // Cluster 6: Multi-backslash \<newline> in backticks & unquoted heredoc substitutions
        ("r29_c2_bt_d1_bs2_kw.sh", "x=`sou\\\nrce ./helpers.sh; do_\\\nwork`\n", true, true, 1),
        ("r29_r29c_bt_d1_actual_bs2.sh", "x=`sou\\\\\nrce ./helpers.sh; do_\\\\\nwork`\n", true, true, 1),
        ("r29_c2_bt_d1_bs3_kw.sh", "x=`sou\\\\\\\nrce ./helpers.sh; do_\\\\\\\nwork`\n", true, true, 1),
        ("r29_c2_bt_d2_bs6_kw.sh", "x=`echo \\`sou\\\\\\\\\\\\\nrce ./helpers.sh; do_\\\\\\\\\\\\\nwork\\``\n", true, true, 1),
        ("r29_c2_hd_unq_cont_in_sub.sh", "cat <<EOF\n$(sou\\\nrce ./helpers.sh; do_\\\nwork)\nEOF\n", true, true, 2),
        ("r29_c2_hd_unq_cont_param.sh", "cat <<EOF\n${a:-$(sou\\\nrce ./helpers.sh; do_\\\nwork)}\nEOF\n", true, true, 2),
        ("r29_c2_hd_unq_cont_call_only.sh", "source ./helpers.sh\ncat <<EOF\n$(do_\\\nwork)\nEOF\n", true, true, 3),
        ("r29_c2_hd_unq_cont_bt.sh", "cat <<EOF\n`sou\\\nrce ./helpers.sh; do_\\\nwork`\nEOF\n", true, true, 2),
    ];

    // Valid under live `bash -n -c` / syntax-error recovery probes (rejected by tree-sitter-bash grammar)
    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        ("r29_r2_arith_hash.sh", "x=$((1 << 2))\n# ${a:-`source ./helpers.sh; do_work`}\necho \"${b:-`echo }`}\"\n", false, false, 0),
        ("r29_r2_ml_arith_in_heredoc.sh", "cat <<EOF\n$((1 <<\n2))\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 4),
        ("r29_r2_ml_arith_heredoc_paired.sh", "cat <<EOF\n$((1 <<\n2))\n${a:-`echo }`}\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 5),
        ("r29_r2_arith_in_param_direct.sh", "echo \"${a:-$((1 << 2))$(source ./helpers.sh; do_work)}\"\n", true, true, 1),
        ("r29_r2_arith_sq_heredoc.sh", "x=$((1 << 2))\ncat <<'EOF'\n${a:-$(\nEOF\necho \"${b:-`source ./helpers.sh; do_work; echo }`}\"\n", true, true, 5),
        ("r29_c1_u_param_cmdsub_sq_heredoc_then_paired.sh", "cat <<EOF >/dev/null\n${a:-$(cat <<'INNER'\n'unclosed\nINNER\n)}\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 6),
        ("r29_r29c_hd_cmdsub_unq_nested_desync.sh", "cat <<EOF >/dev/null\n$(cat <<INNER\n'unclosed\nINNER\n)\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 6),
        ("r29_c1_u_broken_unclosed_param_eof.sh", "cat <<EOF >/dev/null\n${UNCLOSED\nEOF\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("r29_c1_ansi_sq_in_bt_eol_3bs.sh", "x=`echo $'hello\\\\\\\n' && echo \"${a:-a}\" && source ./helpers.sh; do_work; echo '`\n", false, false, 0),
        ("r29_c1_err_bt_inside_sq_heredoc.sh", "if then\ncat <<'EOF'\n`source ./helpers.sh; do_work`\nEOF\n", false, false, 0),
        ("r29_c2_dollar_nl_arith2.sh", "source ./helpers.sh\necho $\\\n((1 << 2))\ncat <<'EOF'\n${FOO:-\nEOF\necho \"${a:-`echo }`}\" && do_work\n", true, true, 7),
        ("r29_c2_code_2bs_lt_nl.sh", "source ./helpers.sh\necho \\\\<\\\n<EOF\ndo_work\nEOF\n", true, false, 0),
        ("r29_r29c_code_lshift_nl_eof.sh", "source ./helpers.sh\ncat <<\\\nEOF\ndo_work\nEOF\n", true, false, 0),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "r29 failures ({}):\n{}", errs.len(), errs.join("\n"));
}

#[test]
fn regression_w3m2_r30_bash_edge_cases() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r30_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    // Valid Bash & tree-sitter-bash fixtures (verified via DefaultSyntaxFirewall::verify)
    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Cluster 1: Space-less `for((...))` arithmetic `<<` guard + negative controls
        ("r30_for_nospace_arith.sh", "for((i = 1 << 2; i < 5; i++)); do\nsource ./helpers.sh; do_work\nbreak\ndone\n", true, true, 2),
        ("r30_for_nospace_cont.sh", "for((i = 1 << 2; i < 5; i++)); do\nsou\\\nrce ./helpers.sh; do_work\nbreak\ndone\n", true, true, 2),
        ("r30_for_nospace_semi_arith.sh", "echo ok; for((i = 1 << 2; i < 5; i++)); do\nsou\\\nrce ./helpers.sh; do_work\nbreak\ndone\n", true, true, 2),
        ("r30_for_nospace_then_arith.sh", "if true; then for((i = 1 << 2; i < 5; i++)); do\nsource ./helpers.sh; do_work\nbreak\ndone\nfi\n", true, true, 2),
        ("r30_for_nospace_subshell_heredoc.sh", "source ./helpers.sh\nfor((i=0;i<1;i++)); do\ncat <<EOF\ndo_work\nEOF\ndone\n", true, false, 0),
        ("r30_neg_echo_for_heredoc.sh", "source ./helpers.sh\necho for <<EOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_neg_var_for_heredoc.sh", "source ./helpers.sh\nx=for; cat <<EOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_neg_fn_for_heredoc.sh", "source ./helpers.sh\nfoo_for() { cat <<EOF\ndo_work\nEOF\n}\n", true, false, 0),
        // Cluster 2: Heredoc inside backticks (valid tree-sitter-bash cases)
        ("r30_hd_raw_bt_sq_hd_then_sub.sh", "cat <<EOF >/dev/null\n`cat <<'INNER'\n'unclosed\nINNER\n`\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 6),
        ("r30_hd_raw_bt_sq_hd_then_sq_lit.sh", "cat <<EOF >/dev/null\n`cat <<'INNER'\n'unclosed\nINNER\n`\n'$(source ./helpers.sh; do_work)'\nEOF\n", true, true, 6),
        ("r30_hd_bt_unq_hd_nested_sub.sh", "cat <<EOF >/dev/null\n`cat <<INNER\n'unclosed\n$(source ./helpers.sh; do_work)\nINNER\n`\nEOF\n", true, true, 4),
        ("r30_bt_sq_hd_then_cont.sh", "x=`cat <<'INNER'\n'unclosed\nINNER\n`\nsou\\\nrce ./helpers.sh; do_work\n", true, true, 5),
        ("r30_neg_bt_sq_hd_call_inside_sq.sh", "source ./helpers.sh\nx=`cat <<'INNER'\ndo_work\nINNER\n`\n", true, false, 0),
        // Cluster 3: Unquoted heredoc `$\<newline>(...)` at `hd_sub.is_none()` + negative controls
        ("r30_hd_unq_bare_dollar_nl_call.sh", "source ./helpers.sh\ncat <<EOF\n$\\\n(do_work)\nEOF\n", true, true, 3),
        ("r30_hd_unq_2bs_dq_dollar_nl_call.sh", "source ./helpers.sh\ncat <<EOF\n\"\\\\$\\\n(do_work)\"\nEOF\n", true, true, 3),
        ("r30_hd_unq_bare_dollar_nl_imp_call.sh", "cat <<EOF\n$\\\n(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r30_hd_unq_dollar_2nl_call.sh", "cat <<EOF\n$\\\n\\\n(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r30_hd_unq_dollar_nl_brace.sh", "cat <<EOF\n$\\\n{a:-$(source ./helpers.sh; do_work)}\nEOF\n", true, true, 2),
        ("r30_hd_unq_dollar_nl_eof_delim.sh", "cat <<EOF\n$\\\nEOF\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 4),
        ("r30_hd_nested_unq_dollar_nl.sh", "cat <<OUTER\n$(cat <<INNER\n$\\\n(source ./helpers.sh; do_work)\nINNER\n)\nOUTER\n", true, true, 3),
        ("r30_neg_hd_unq_dq_esc_dollar_nl.sh", "source ./helpers.sh\ncat <<EOF\n\"\\\\\\$\\\n(do_work)\"\nEOF\n", true, false, 0),
    ];

    // Valid live Bash / syntax-error recovery cases (not accepted by upstream tree-sitter-bash)
    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        // Cluster 2 recovery / same-line backtick close / escaped delim inside backtick
        ("r30_err_bt_sq_hd_then_src.sh", "if then\nx=`cat <<'INNER'\n'unclosed\nINNER\n`\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("r30_err_bt_unq_hd_inner_sub.sh", "if then\nx=`cat <<INNER\n'unclosed\n$(source ./helpers.sh; do_work)\nINNER\n`\n", true, true, 4),
        ("r30_bt_sq_hd_sameline_close.sh", "x=`cat <<INNER`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("r30_bt_sq_hd_delim_bt_end.sh", "x=`cat <<'INNER'\n'unclosed\nINNER`\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("r30_bt_in_dq_delim_esc.sh", "x=\"`cat <<\\\"INNER\\\"\n'unclosed\nINNER\n`\" && source ./helpers.sh; do_work\n", true, true, 4),
        ("r30_bt_nested_arith_and_hd.sh", "cat <<EOF >/dev/null\n`echo $((1 << 2)) && cat <<'INNER'\n'unclosed\nINNER\n`\n$(source ./helpers.sh; do_work)\nEOF\n", true, true, 6),
        ("r30_neg_bt_2bs_ltlt_not_hd.sh", "source ./helpers.sh\nx=`echo \\\\<<EOF`\ndo_work\nEOF\n", true, true, 3),
        ("r30_hd_bt_sq_hd_then_paired.sh", "cat <<EOF >/dev/null\n`cat <<'INNER'\n'unclosed\nINNER\n`\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 6),
        ("r30_hd_paired_desync_and_bt_sq_hd.sh", "cat <<EOF >/dev/null\n${a:-`echo }`}\n`cat <<'INNER'\n'unclosed\nINNER\n`\n${b:-`source ./helpers.sh; do_work; echo }`}\nEOF\n", true, true, 7),
        ("r30_neg_hd_unq_esc_dollar_nl.sh", "source ./helpers.sh\ncat <<EOF\n\\$\\\n(do_work)\nEOF\n", true, false, 0),
        ("r30_neg_hd_unq_dollar_3bs_nl.sh", "source ./helpers.sh\ncat <<EOF\n$\\\\\\\n(do_work)\nEOF\n", true, false, 0),
        ("r30_neg_hd_unq_dollar_2bs_nl.sh", "source ./helpers.sh\ncat <<EOF\n$\\\\\n(do_work)\nEOF\n", true, false, 0),
        // Cluster 4: `prev_lt` / `trail_lt` on `<<\<newline>EOF`, `<<\<newline>-EOF`, `<<\<newline><EOF`, `<<<\<newline>EOF`
        ("r30_ltlt_nl_eof.sh", "source ./helpers.sh\ncat <<\\\nEOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_ltlt_nl_dash_eof.sh", "source ./helpers.sh\ncat <<\\\n-EOF\n\tdo_work\nEOF\n", true, false, 0),
        ("r30_semi_ltlt_nl_eof.sh", "source ./helpers.sh\necho ok; cat <<\\\nEOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_sub_ltlt_nl_eof.sh", "source ./helpers.sh\nx=$(cat <<\\\nEOF\ndo_work\nEOF\n)\n", true, false, 0),
        ("r30_2bs_ltlt_nl_eof.sh", "source ./helpers.sh\ncat \\\\<<\\\nEOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_4bs_ltlt_nl_eof.sh", "source ./helpers.sh\ncat \\\\\\\\<<\\\nEOF\ndo_work\nEOF\n", true, false, 0),
        ("r30_ltlt_nl_lt_eof.sh", "source ./helpers.sh\ncat <<\\\n<EOF\ndo_work\n", true, true, 4),
        ("r30_ltltlt_nl_eof.sh", "source ./helpers.sh\ncat <<<\\\nEOF\ndo_work\n", true, true, 4),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "r30 failures ({}):\n{}", errs.len(), errs.join("\n"));
}

#[test]
fn regression_w3m2_r31_bash_edge_cases() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r31_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Cluster 2: `$$` / `$$$$` / `$\<nl>$` PID expansion odd/even `$` parity
        ("r31_hd_double_dollar_nl.sh", "cat <<EOF >/dev/null\n$$\\\n(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("r31_hd_double_dollar_nospace.sh", "cat <<EOF >/dev/null\n$$(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("r31_hd_quad_dollar_nl.sh", "cat <<EOF >/dev/null\n$$$$\\\n(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("r31_hd_dollar_nl_dollar_sub.sh", "cat <<EOF >/dev/null\n$\\\n$(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("r31_hd_dollar_nl_dollar_nl_sub.sh", "cat <<EOF >/dev/null\n$\\\n$\\\n(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("r31_hd_triple_dollar_nl.sh", "cat <<EOF >/dev/null\n$$$\\\n(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r31_hd_3dollar_3nl_sub.sh", "cat <<EOF >/dev/null\n$\\\n$\\\n$\\\n(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r31_dq_double_dollar_nl.sh", "source ./helpers.sh\necho \"$$\\\n(do_work)\"\n", true, false, 0),
        ("r31_dq_double_dollar_nospace.sh", "source ./helpers.sh\necho \"$$(do_work)\"\n", true, false, 0),
        ("r31_dq_dollar_nl_dollar.sh", "source ./helpers.sh\necho \"$\\\n$(do_work)\"\n", true, false, 0),
        ("r31_dq_quad_dollar_nl.sh", "source ./helpers.sh\necho \"$$$$\\\n(do_work)\"\n", true, false, 0),
        ("r31_dq_triple_dollar_nl.sh", "source ./helpers.sh\necho \"$$$\\\n(do_work)\"\n", true, true, 2),
        ("r31_code_paren_double_dollar.sh", "source ./helpers.sh\n(echo $$)\n", true, false, 0),
        // Cluster 3: `${...}` with `$\<newline>(...)` (and `$$\\\n(...)`) in unquoted heredocs
        ("r31_param_dollar_nl_sub.sh", "cat <<EOF >/dev/null\n${FOO:-$\\\n(source ./helpers.sh; do_work)}\nEOF\n", true, true, 2),
        ("r31_param_dollar_nl_in_sub_hd.sh", "$(cat <<EOF >/dev/null\n${FOO:-$\\\n(source ./helpers.sh; do_work)}\nEOF\n)\n", true, true, 2),
        ("r31_param_nested_dollar_nl.sh", "cat <<EOF >/dev/null\n${A:-${B:-$\\\n(source ./helpers.sh; do_work)}}\nEOF\n", true, true, 2),
        ("r31_param_dollar_2nl_sub.sh", "cat <<EOF >/dev/null\n${FOO:-$\\\n\\\n(source ./helpers.sh; do_work)}\nEOF\n", true, true, 2),
        ("r31_param_sq_dollar_nl_sub.sh", "cat <<EOF >/dev/null\n${FOO:-'$\\\n(source ./helpers.sh; do_work)'}\nEOF\n", true, true, 2),
        ("r31_param_neg_double_dollar_nl.sh", "cat <<EOF >/dev/null\n${FOO:-$$\\\n(source ./helpers.sh; do_work)}\nEOF\n", false, false, 0),
        ("r31_param_triple_dollar_nl.sh", "cat <<EOF >/dev/null\n${FOO:-$$$\\\n(source ./helpers.sh; do_work)}\nEOF\n", true, true, 2),
        ("r31_param_nested_dollar_nl_brace.sh", "cat <<EOF >/dev/null\n${FOO:-$\\\n{BAR:-$(source ./helpers.sh; do_work)}}\nEOF\n", true, true, 2),
        // Cluster 4: Unquoted heredoc inside backticks `bt_depth > 0`
        ("r31_bt_unq_hd_2bs_dollar_neg.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\$(do_work)\nINNER\n`\n", true, false, 0),
        ("r31_bt_unq_hd_2bs_dollar_src_neg.sh", "x=`cat <<INNER\n\\\\$(source ./helpers.sh; do_work)\nINNER\n`\n", false, false, 0),
        ("r31_bt_unq_hd_4bs_dollar_pos.sh", "x=`cat <<INNER\n\\\\\\\\$(source ./helpers.sh; do_work)\nINNER\n`\n", true, true, 2),
        ("r31_qbt_unq_hd_esc_dq_in_sub_neg.sh", "source ./helpers.sh\nx=\"`cat <<INNER\n$(echo \\\"hi; do_work\\\")\nINNER\n`\"\n", true, false, 0),
        ("r31_qbt_unq_hd_esc_dq_src_in_sub_neg.sh", "x=\"`cat <<INNER\n$(source ./helpers.sh; echo \\\"hi; do_work\\\")\nINNER\n`\"\n", true, false, 0),
        ("r31_unq_bt_hd_esc_dq_in_sub_pos.sh", "source ./helpers.sh\nx=`cat <<INNER\n$(echo \\\"hi; do_work \\\")\nINNER\n`\n", true, true, 3),
        ("r31_qbt_unq_hd_unclosed_esc_dq_neg.sh", "x=\"`cat <<INNER\n$(source ./helpers.sh; echo \\\"; do_work)\nINNER\n`\"\n", true, false, 0),
    ];

    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        // Cluster 1: `bt_cut` raw-vs-`work` UTF-8 offset, ASCII truncation, `hd_sub` / `sub.nested` cleanup
        ("r31_bt_cut_utf8_dollar_nl.sh", "source ./helpers.sh\nx=`cat <<INNER\n$\\\nä`\ndo_work\n", true, true, 5),
        ("r31_bt_cut_utf8_euro_dollar_nl.sh", "source ./helpers.sh\nx=`cat <<INNER\n$\\\n€`\ndo_work\n", true, true, 5),
        ("r31_bt_cut_utf8_3bs_sub_bt.sh", "source ./helpers.sh\nx=`cat <<INNER\n$(echo \\\\\\\nä)`\ndo_work\n", true, true, 5),
        ("r31_bt_cut_utf8_euro_3bs_nl.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\\\n€`\ndo_work\n", true, true, 5),
        ("r31_bt_cut_3bs_nl_in_hd_bt_call.sh", "source ./helpers.sh\nx=`cat <<INNER\n$(true \\\\\\\n&& do_work)`\n", true, true, 3),
        ("r31_bt_cut_dollar_nl_sub_bt_close.sh", "source ./helpers.sh\nx=`cat <<INNER\n$\\\n(true)`\ncat <<OUTER\ndo_work\nOUTER\n", true, false, 0),
        ("r31_bt_cut_hd_sub_leak_wipes_import.sh", "x=`cat <<INNER\n$\\\n{a:-1}`\nsource ./helpers.sh\ndo_work\ncat <<OUTER >/dev/null\nhello\nOUTER\n", true, true, 5),
        ("r31_bt_cut_unclosed_sub_before_outer_hd.sh", "x=`cat <<INNER\n$(true\n`\nsource ./helpers.sh\ndo_work\ncat <<OUTER >/dev/null\nhello\nOUTER\n", true, true, 5),
        ("r31_bt_cut_unclosed_sub_in_nested_hd.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n`cat <<INNER\n$(true\n`\ncat <<INNER2\ndo_work\nINNER2\nOUTER\n", true, false, 0),
        ("r31_bt_cut_unclosed_sub_drops_inner_call.sh", "source ./helpers.sh\nx=`cat <<INNER\n$(do_work\n`\n", true, false, 0),
        // Cluster 4 forms rejected by upstream tree-sitter-bash but valid live Bash 5.2
        ("r31_bt_unq_hd_1bs_dollar_pos.sh", "x=`cat <<INNER\n\\$(source ./helpers.sh; do_work)\nINNER\n`\n", true, true, 2),
        ("r31_bt_unq_hd_3bs_dollar_neg.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\\$(do_work)\nINNER\n`\n", true, false, 0),
        ("r31_bt_unq_hd_dollar_esc_dollar_neg.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\$\\$(do_work)\nINNER\n`\n", true, false, 0),
        ("r31_qbt_param_esc_dq_neg.sh", "source ./helpers.sh\nx=\"`cat <<INNER\n${FOO:-\\\"hi; do_work\\\"}\nINNER\n`\"\n", true, false, 0),
        ("r31_bt_unq_hd_1bs_bt_pos.sh", "x=`cat <<INNER\n\\`source ./helpers.sh; do_work\\`\nINNER\n`\n", true, true, 2),
        ("r31_bt_depth2_3bs_dollar_pos.sh", "x=`echo \\`cat <<INNER\n\\\\\\$(source ./helpers.sh; do_work)\nINNER\n\\``\n", true, true, 2),
        ("r31_bt_depth2_4bs_dollar_neg.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\n\\\\\\\\$(do_work)\nINNER\n\\``\n", true, false, 0),
        ("r31_qbt_unq_hd_1bs_dollar_pos.sh", "x=\"`cat <<INNER\n\\$(source ./helpers.sh; do_work)\nINNER\n`\"\n", true, true, 2),
        ("r31_qbt_unq_hd_1bs_bt_pos.sh", "x=\"`cat <<INNER\n\\`source ./helpers.sh; do_work\\`\nINNER\n`\"\n", true, true, 2),
        // Cluster 5: Multi-continuation `trail_lt`, `<<-\<newline>EOF`, and `<<\\\<newline>EOF`
        ("r31_ltlt_2nl_eof.sh", "source ./helpers.sh\ncat <<\\\n\\\nEOF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("r31_ltlt_3nl_eof.sh", "source ./helpers.sh\ncat <<\\\n\\\n\\\nEOF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("r31_sub_ltlt_2nl_eof.sh", "source ./helpers.sh\nx=$(cat <<\\\n\\\nEOF >/dev/null\ndo_work\nEOF\n)\n", true, false, 0),
        ("r31_ltlt_dash_nl_eof.sh", "source ./helpers.sh\ncat <<-\\\nEOF >/dev/null\n\tdo_work\nEOF\n", true, false, 0),
        ("r31_ltlt_dash_2nl_eof.sh", "source ./helpers.sh\ncat <<-\\\n\\\nEOF >/dev/null\n\tdo_work\nEOF\n", true, false, 0),
        ("r31_ltlt_nl_dash_2nl_eof.sh", "source ./helpers.sh\ncat <<\\\n-\\\nEOF >/dev/null\n\tdo_work\nEOF\n", true, false, 0),
        ("r31_ltlt_3bs_nl_eof.sh", "source ./helpers.sh\ncat <<\\\\\\\nEOF >/dev/null\n$(do_work)\n\\EOF\n", true, false, 0),
        ("r31_ltlt_3bs_nl_eof_then_call.sh", "source ./helpers.sh\ncat <<\\\\\\\nEOF >/dev/null\n$(do_work)\n\\EOF\ndo_work\n", true, true, 6),
        ("r31_ltlt_ws_nl_eof.sh", "source ./helpers.sh\ncat << \\\nEOF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("r31_ltlt_dash_ws_nl_eof.sh", "source ./helpers.sh\ncat <<- \\\nEOF >/dev/null\n\tdo_work\nEOF\n", true, false, 0),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "r31 failures ({}):\n{}", errs.len(), errs.join("\n"));
}

#[test]
fn regression_w3m2_r32_bash_edge_cases() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2_r32_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Fix 1: step_code_char prev_dollar parity, Code $\<nl>, and backtick \$\$ vs \$\\\\$
        ("r32_code_dd_nl_brace_comment.sh", "source ./helpers.sh\necho $$\\\n{a # do_work\n", true, false, 0),
        ("r32_code_4d_nl_brace_comment.sh", "source ./helpers.sh\necho $$$$\\\n{a # do_work\n", true, false, 0),
        ("r32_code_dd_nl_brace_heredoc.sh", "source ./helpers.sh\necho $$\\\n{a\ncat <<EOF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("r32_code_dd_nl_brace_esc_heredoc.sh", "source ./helpers.sh\necho $$\\\n{a\ncat <<'EOF' >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("r32_code_sub_dd_nl_brace_comment.sh", "source ./helpers.sh\nx=$(echo $$\\\n{FOO)\n# do_work\n", true, false, 0),
        ("r32_bt_esc_dq_dd_single_line.sh", "source ./helpers.sh\nx=`echo \"\\$\\$(do_work)\"`\n", true, false, 0),
        ("r32_bt_esc_dq_dollar_nl_dollar_sub.sh", "source ./helpers.sh\nx=`echo \"\\$\\\n\\$(do_work)\"`\n", true, false, 0),
        ("r32_bt_esc_dq_dd_nl_sub.sh", "source ./helpers.sh\nx=`echo \"\\$\\$\\\n(do_work)\"`\n", true, false, 0),
        ("r32_bt_esc_dq_esc_sq_dd.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'\\$\\$(do_work)'}\"`\n", true, false, 0),
        ("r32_bt_esc_dq_3d_pos.sh", "source ./helpers.sh\nx=`echo \"\\$\\$\\$(do_work)\"`\n", true, true, 2),
        ("r32_bt_esc_dq_d_2d_pos.sh", "source ./helpers.sh\nx=`echo \"\\$$$(do_work)\"`\n", true, true, 2),
        ("r32_bt_esc_dq_d_3d_neg.sh", "source ./helpers.sh\nx=`echo \"\\$$$$(do_work)\"`\n", true, false, 0),
        ("r32_bt_esc_dq_d_4bs_d_sub_pos.sh", "source ./helpers.sh\nx=`echo \"\\$\\\\\\\\$(do_work)\"`\n", true, true, 2),
        ("r32_bt_esc_dq_esc_sq_d_4bs_d_sub_pos.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'\\$\\\\\\\\$(do_work)'}\"`\n", true, true, 2),
        ("r32_bt_code_d_4bs_d_sub_pos.sh", "source ./helpers.sh\nx=`echo \\$\\\\\\\\$(do_work)`\n", true, true, 2),
        ("r32_bt_code_dd_brace_comment_neg.sh", "source ./helpers.sh\nx=`echo \\$\\${a # do_work\n`\n", true, false, 0),
        ("r32_bt_code_dd_brace_sub_pos.sh", "source ./helpers.sh\nx=`echo \\$\\${a:-$(do_work)}`\n", true, true, 2),
        ("r32_bt_code_d_nl_d_brace_comment_neg.sh", "source ./helpers.sh\nx=`echo \\$\\\n\\${a # do_work\n`\n", true, false, 0),
        ("r32_bt_code_dd_nl_brace_heredoc.sh", "source ./helpers.sh\nx=`echo \\$\\$\\\n{a\ncat <<EOF >/dev/null\ndo_work\nEOF\n`\n", true, false, 0),
        // Fix 2: step_hd_unq_bs resets trail_dollar when literal backslash(es) separate $ from $
        ("r32_hd_unq_x_d_2bs_d_sub_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nx$\\\\$(do_work)\nEOF\n", true, true, 3),
        ("r32_hd_unq_x_d_4bs_d_sub_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nx$\\\\\\\\$(do_work)\nEOF\n", true, true, 3),
        ("r32_hd_unq_x_d_2bs_src_inside_pos.sh", "cat <<EOF >/dev/null\nx$\\\\$(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r32_hd_unq_x_d_nl_2bs_d_sub_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nx$\\\n\\\\$(do_work)\nEOF\n", true, true, 3),
        ("r32_bt1_hd_unq_x_d_4bs_d_sub_pos.sh", "source ./helpers.sh\nx=`cat <<INNER\nx$\\\\\\\\$(do_work)\nINNER\n`\n", true, true, 3),
        // Fix 3 positive control (valid tree-sitter-bash)
        ("r32_nested_hd_closed_sub_pos.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(x=`cat <<INNER\n$(do_work)\nINNER\n`\n)\nOUTER\n", true, true, 4),
    ];

    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        // Fix 1 raw forms (valid live bash 5.2, rejected by tree-sitter-bash)
        ("r32_code_dnld_brace_sub_pos.sh", "source ./helpers.sh\nx=$(echo $\\\n{a:-)}\ndo_work)\n", true, true, 4),
        ("r32_code_dnld_brace_comment_neg.sh", "source ./helpers.sh\nx=$(echo $\\\n{a:-)}\n# do_work\n)\n", true, false, 0),
        ("r32_qbt_esc_dq_dd_single_line.sh", "source ./helpers.sh\nx=\"`echo \\\"\\$\\$(do_work)\\\"`\"\n", true, false, 0),
        // Fix 2 raw forms
        ("r32_hd_unq_d_2bs_d_sub_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n$\\\\$(do_work)\nEOF\n", true, true, 3),
        ("r32_hd_unq_d_2bs_d_src_pos.sh", "cat <<EOF >/dev/null\n$\\\\$(source ./helpers.sh; do_work)\nEOF\n", true, true, 2),
        ("r32_bt1_hd_unq_dd_neg.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\$\\$(do_work)\nINNER\n`\n", true, false, 0),
        // Fix 3: sub.nested persists nested_ln and masks unclosed subs on DelimiterOrQuoted / bt_cut
        ("r32_nested_hd_unclosed_sub_bt_cut.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(x=`cat <<INNER\n$(do_work\n`\n)\nOUTER\n", true, false, 0),
        ("r32_nested_hd_unclosed_param_bt_cut.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(x=`cat <<INNER\n${FOO:-$(do_work\n`\n)\nOUTER\n", true, false, 0),
        ("r32_nested_hd_unclosed_sub_1line_bt_cut.sh", "cat <<OUTER >/dev/null\n`cat <<INNER\n$(source ./helpers.sh; do_work; echo unclosed`\nOUTER\n", true, false, 0),
        ("r32_nested_hd_unclosed_sub_1line_outer_src.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n`cat <<INNER\n$(do_work; echo unclosed`\nOUTER\n", true, false, 0),
        ("r32_nested_hd_unclosed_sub_delim_line.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(x=`cat <<INNER\n$(do_work\nINNER\n`\n)\nOUTER\n", true, false, 0),
        // Fix 4: bt_cut-truncated slice never triggers EOL continuation
        ("r32_bt1_3bs_nl_btcut_outer_esc_bt.sh", "source ./helpers.sh\nx=`cat <<INNER\nfoo\\\\\\\n`\ncat <<OUTER >/dev/null\n\\`do_work\\`\nOUTER\n", true, false, 0),
        ("r32_bt2_3bs_nl_btcut_1line_close.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\nfoo\\\\\\\n\\` \\``\ncat <<OUTER >/dev/null\n\\`do_work\\`\nOUTER\n", true, false, 0),
        ("r32_bt1_3bs_nl_btcut_call_line.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\\\n`\ndo_work\n", true, true, 5),
        ("r32_bt1_3bs_nl_btcut_dq_after.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\\\n`\ny=\"\\\\\"\ndo_work\n", true, true, 6),
        ("r32_bt1_3bs_nl_btcut_ansisq_after.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\\\n`\ny=$'a\\\\'\ndo_work\n", true, true, 6),
        ("r32_bt1_sub_3bs_nl_btcut_dq_after.sh", "source ./helpers.sh\nx=`cat <<INNER\n$(echo \\\\\\\n`\ny=\"\\\\\"\ndo_work\n", true, true, 6),
        ("r32_bt1_param_3bs_nl_btcut_dq_after.sh", "source ./helpers.sh\nx=`cat <<INNER\n\"${FOO:-\\\\\\\n`\ny=\"\\\\\"\ndo_work\n", true, true, 6),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "r32 failures ({}):\n{}", errs.len(), errs.join("\n"));
}

#[test]
fn regression_w3m2b_bash_edge_cases() {
    struct DirCleanup(std::path::PathBuf);
    impl Drop for DirCleanup {
        fn drop(&mut self) {
            let _ = fs::remove_dir_all(&self.0);
        }
    }

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let dir = std::env::temp_dir().join(format!("aice_w3m2b_bash_fixes_{}", std::process::id()));
    let _ = fs::remove_dir_all(&dir);
    fs::create_dir_all(&dir).unwrap();
    let _cleanup = DirCleanup(dir.clone());

    let sh_helpers = "do_work() { echo ok; }\n";
    fs::write(dir.join("helpers.sh"), sh_helpers).unwrap();

    let cases: &[(&str, &str, bool, bool, usize)] = &[
        // Feature 1 (Explorer A): BashStripState::on_newline resets dq.prev_dollar across all frames
        ("w3m2b_dq_dollar_lit_nl_sub.sh", "source ./helpers.sh\nx=\"$\n$(do_work)\"\n", true, true, 3),
        ("w3m2b_dq_param_dollar_lit_nl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-$\n$(do_work)}\"\n", true, true, 3),
        ("w3m2b_escdq_dollar_lit_nl_sub.sh", "source ./helpers.sh\nx=`echo \"$\n$(do_work)\"`\n", true, true, 3),
        ("w3m2b_hd_param_dollar_lit_nl_sub.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n\"${FOO:-$\n$(do_work)}\"\nEOF\n", true, true, 4),
        ("w3m2b_sqinparam_dollar_lit_nl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-'$\n$(do_work)'}\"\n", true, true, 3),
        ("w3m2b_bt_dq_lit_nl_1bs_sub.sh", "source ./helpers.sh\nx=`echo \"$\n\\$(do_work)\"`\n", true, true, 3),
        ("w3m2b_hd_unq_param_lit_nl_sub.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n${FOO:-$\n$(do_work)}\nEOF\n", true, true, 4),
        ("w3m2b_hd_unq_bt_dq_lit_nl_sub.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n`echo \"$\n$(do_work)\"`\nEOF\n", true, true, 4),
        ("w3m2b_btinparam_dq_lit_nl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-`echo \"$\n$(do_work)\"`}\"\n", true, true, 3),
        ("w3m2b_btinparam_3bs_escdq_lit_nl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-`echo \\\\\\\"$\n$(do_work)\\\\\\\"`}\"\n", true, true, 3),
        ("w3m2b_dq_dd_lit_nl_neg.sh", "source ./helpers.sh\nx=\"$$\n$(do_work)\"\n", true, true, 3),
        ("w3m2b_dq_dollar_dd_lit_nl_neg.sh", "source ./helpers.sh\nx=\"$\n$$(do_work)\"\n", true, false, 0),
        ("w3m2b_btinparam_3bs_nl_neg.sh", "source ./helpers.sh\nx=\"${FOO:-`echo \"a$\\\\\\\n$(do_work)\"`}\"\n", true, false, 0),
        ("w3m2b_btinparam_5bs_nl_pos.sh", "source ./helpers.sh\nx=\"${FOO:-`echo \"a$\\\\\\\\\\\n$(do_work)\"`}\"\n", true, true, 2),
        ("w3m2b_btinparam_dq_5bs_nl_src.sh", "x=\"${FOO:-`echo \"a$\\\\\\\\\\\n$(source ./helpers.sh; do_work)\"`}\"\n", true, true, 1),
        // Feature 2 (Explorer B): Heredoc EOL continuation, bt_depth, <<- tab-only, Import coalescing
        ("w3m2b_bt1_hd_2bs_eol.sh", "source ./helpers.sh\nx=`cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n`\n", true, false, 0),
        ("w3m2b_bt1_hd_2bs_src.sh", "x=`cat <<INNER\nfoo\\\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n`\n", false, false, 0),
        ("w3m2b_bt0_hd_1bs_src.sh", "cat <<INNER\nfoo\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_bt1_hd_dash_2bs_eol.sh", "source ./helpers.sh\nx=`cat <<-INNER\n\tfoo\\\\\n\tINNER\ndo_work\n\tINNER\n`\n", true, false, 0),
        ("w3m2b_bt0_dash_tab_1bs.sh", "source ./helpers.sh\ncat <<-INNER\n\t\\\n\tINNER\ndo_work\n\tINNER\n", true, true, 5),
        ("w3m2b_bt1_dash_tab_2bs.sh", "source ./helpers.sh\nx=`cat <<-INNER\n\t\\\\\n\tINNER\ndo_work\n\tINNER\n`\n", true, true, 5),
        ("w3m2b_bt0_dash_tab_3bs.sh", "source ./helpers.sh\ncat <<-INNER\n\t\\\\\\\n\tINNER\ndo_work\n\tINNER\n", true, false, 0),
        ("w3m2b_bt2_hd_2bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, false, 0),
        ("w3m2b_bt2_hd_4bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\nfoo\\\\\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, false, 0),
        ("w3m2b_bt2_hd_6bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\nfoo\\\\\\\\\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, false, 0),
        ("w3m2b_bt2_hd_8bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<INNER\nfoo\\\\\\\\\\\\\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, true, 5),
        ("w3m2b_bt1_qhd_1bs_eol.sh", "source ./helpers.sh\nx=`cat <<'INNER'\nfoo\\\nINNER\ndo_work\nINNER\n`\n", true, false, 0),
        ("w3m2b_bt1_qhd_2bs_eol.sh", "source ./helpers.sh\nx=`cat <<'INNER'\nfoo\\\\\nINNER\ndo_work\nINNER\n`\n", true, true, 5),
        ("w3m2b_bt1_qhd_1bs_chain_sub.sh", "source ./helpers.sh\nx=`cat <<'INNER'\nfoo\\\n$(do_work)\nINNER\n`\n", true, false, 0),
        ("w3m2b_bt1_qhd_1bs_multi_chain.sh", "source ./helpers.sh\nx=`cat <<'INNER'\nfoo\\\nbar\\\nINNER\ndo_work\nINNER\n`\n", true, false, 0),
        ("w3m2b_bt1_bshd_1bs_eol.sh", "source ./helpers.sh\nx=`cat <<\\INNER\nfoo\\\nINNER\ndo_work\nINNER\n`\n", true, false, 0),
        ("w3m2b_bt2_qhd_1bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<'INNER'\nfoo\\\nINNER\ndo_work\nINNER\n\\``\n", true, false, 0),
        ("w3m2b_bt2_qhd_2bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<'INNER'\nfoo\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, false, 0),
        ("w3m2b_bt2_qhd_4bs_eol.sh", "source ./helpers.sh\nx=`echo \\`cat <<'INNER'\nfoo\\\\\\\\\nINNER\ndo_work\nINNER\n\\``\n", true, true, 5),
        ("w3m2b_bt1_qhd_dash_1bs_eol.sh", "source ./helpers.sh\nx=`cat <<-'INNER'\n\tfoo\\\n\tINNER\ndo_work\n\tINNER\n`\n", true, false, 0),
        ("w3m2b_bt1_qdash_tab_1bs.sh", "source ./helpers.sh\nx=`cat <<-'INNER'\n\t\\\n\tINNER\ndo_work\n\tINNER\n`\n", true, true, 5),
        ("w3m2b_cmdsub_in_bt_hd.sh", "source ./helpers.sh\nx=`$(cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n)`\n", true, false, 0),
        ("w3m2b_bt_in_cmdsub_hd.sh", "source ./helpers.sh\nx=$(`cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n`)\n", true, false, 0),
        ("w3m2b_hd_in_hd_bt.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n`cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n`\nOUTER\n", true, false, 0),
        ("w3m2b_hd_in_hd_q_bt.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n`cat <<'INNER'\nfoo\\\nINNER\n$(do_work)\nINNER\n`\nOUTER\n", true, false, 0),
        ("w3m2b_two_hd_outer_inner_bt.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(x=`cat <<INNER\nfoo\\\\\nINNER\ndo_work\nINNER\n`)\nOUTER\n", true, false, 0),
        // Feature 3 (Explorer C): SqInParam bt_depth == 0 vs >= 1 vs unquoted heredoc
        ("w3m2b_sqinparam_bt0_dnl_lit.sh", "source ./helpers.sh\nx=\"${FOO:-'$\\\n(do_work)'}\"\n", true, false, 0),
        ("w3m2b_sqinparam_bt0_dnl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-'$\\\n$(do_work)'}\"\n", true, true, 2),
        ("w3m2b_sqinparam_bt0_dnl_2nl_lit.sh", "source ./helpers.sh\nx=\"${FOO:-'$\\\n\\\n(do_work)'}\"\n", true, false, 0),
        ("w3m2b_sqinparam_bt0_dnl_2nl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-'$\\\n\\\n$(do_work)'}\"\n", true, true, 2),
        ("w3m2b_sqinparam_bt0_3dnl_lit.sh", "source ./helpers.sh\nx=\"${FOO:-'$$$\\\n(do_work)'}\"\n", true, false, 0),
        ("w3m2b_sqinparam_bt0_3dnl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-'$$$\\\n$(do_work)'}\"\n", true, true, 2),
        ("w3m2b_sqinparam_bt0_3dnl_src_sub.sh", "x=\"${FOO:-'$$$\\\n$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_sqinparam_sub_dnl_lit.sh", "source ./helpers.sh\nx=$(echo \"${FOO:-'$\\\n(do_work)'}\")\n", true, false, 0),
        ("w3m2b_sqinparam_sub_dnl_sub.sh", "source ./helpers.sh\nx=$(echo \"${FOO:-'$\\\n$(do_work)'}\")\n", true, true, 2),
        ("w3m2b_sqinparam_nested_param_dnl_lit.sh", "source ./helpers.sh\nx=\"${FOO:-'${BAR:-$\\\n(do_work)}'}\"\n", true, false, 0),
        ("w3m2b_sqinparam_nested_param_dnl_sub.sh", "source ./helpers.sh\nx=\"${FOO:-'${BAR:-$\\\n$(do_work)}'}\"\n", true, true, 2),
        ("w3m2b_sqinparam_dnl_src_in_sub.sh", "x=\"${FOO:-'$\\\n$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_sqinparam_dnl_src_lit_neg.sh", "x=\"${FOO:-'$\\\n(source ./helpers.sh; do_work)'}\"\n", false, false, 0),
        ("w3m2b_sqinparam_bt1_dnl_lit_pos.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'$\\\n(do_work)'}\"`\n", true, true, 2),
        ("w3m2b_sqinparam_bt1_dnl_sub_neg.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'$\\\n$(do_work)'}\"`\n", true, false, 0),
        ("w3m2b_sqinparam_qbt_escdq_dnl_pos.sh", "source ./helpers.sh\nx=\"`echo \\\"${FOO:-'$\\\n(do_work)'}\\\"`\"\n", true, true, 2),
        ("w3m2b_hd_dq_param_sq_dnl_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n\"${FOO:-'$\\\n(do_work)'}\"\nEOF\n", true, true, 3),
        ("w3m2b_hd_sub_dq_sqinparam_dnl_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n$(echo \"${FOO:-'$\\\n(do_work)'}\")\nEOF\n", true, true, 3),
        ("w3m2b_qbt_escdq_3bs_nl_sub_neg.sh", "source ./helpers.sh\nx=\"`echo \\\"a\\\\\\\n$(do_work)\\\"`\"\n", true, false, 0),
        ("w3m2b_qbt_escdq_5bs_nl_dq_pos.sh", "source ./helpers.sh\nx=\"`echo \\\"a\\\\\\\\\\\n\\\" ; do_work`\"\n", true, true, 2),
        ("w3m2b_sqinparam_3bs_nl_sub_pos.sh", "source ./helpers.sh\nx=\"${FOO:-'a\\\\\\\n$(do_work)'}\"\n", true, true, 2),
        // Iter 2 Class 1: SqInParam bt_depth >= 1 & local_bt_depth > 0
        ("w3m2b_sqinparam_bt1_2bs_lit.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'$\\\\\n(do_work)'}\"`\n", true, false, 0),
        ("w3m2b_sqinparam_bt1_2bs_sub.sh", "source ./helpers.sh\nx=`echo \"${FOO:-'$\\\\\n$(do_work)'}\"`\n", true, true, 2),
        ("w3m2b_sqinparam_bt1_2bs_src_sub.sh", "x=`echo \"${FOO:-'$\\\\\n$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_sqinparam_bt1_2bs_3d_src.sh", "x=`echo \"${FOO:-'$$$\\\\\n$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_sqinparam_bt2_4bs_lit.sh", "source ./helpers.sh\nx=`echo \\`echo \"${FOO:-'$\\\\\\\\\n(do_work)'}\"\\``\n", true, false, 0),
        ("w3m2b_sqinparam_bt2_4bs_sub.sh", "source ./helpers.sh\nx=`echo \\`echo \"${FOO:-'$\\\\\\\\\n$(do_work)'}\"\\``\n", true, true, 2),
        ("w3m2b_sqinparam_qbt_escdq_2bs_lit.sh", "source ./helpers.sh\nx=\"`echo \\\"${FOO:-'$\\\\\n(do_work)'}\\\"`\"\n", true, false, 0),
        ("w3m2b_sqinparam_qbt_escdq_2bs_sub.sh", "source ./helpers.sh\nx=\"`echo \\\"${FOO:-'$\\\\\n$(do_work)'}\\\"`\"\n", true, true, 2),
        ("w3m2b_sqinparam_param_bt1_dq_2bs_lit.sh", "source ./helpers.sh\nx=\"${BAR:-`echo \"${FOO:-'$\\\\\n(do_work)'}\"`}\"\n", true, false, 0),
        ("w3m2b_sqinparam_param_bt1_dq_2bs_sub.sh", "source ./helpers.sh\nx=\"${BAR:-`echo \"${FOO:-'$\\\\\n$(do_work)'}\"`}\"\n", true, true, 2),
        ("w3m2b_sqinparam_param_bt1_dq_2bs_src_sub.sh", "x=\"${BAR:-`echo \"${FOO:-'$\\\\\n$(source ./helpers.sh; do_work)'}\"`}\"\n", true, true, 1),
        ("w3m2b_sqinparam_hd_unq_param_bt1_2bs_lit.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n${FOO:-`echo \"${BAR:-'$\\\\\n(do_work)'}\"`}\nEOF\n", true, false, 0),
        ("w3m2b_sqinparam_hd_unq_param_bt1_2bs_sub.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n${FOO:-`echo \"${BAR:-'$\\\\\n$(do_work)'}\"`}\nEOF\n", true, true, 3),
        ("w3m2b_sqinparam_bt1_hd_param_2bs_lit.sh", "source ./helpers.sh\nx=`cat <<EOF\n${BAR:-'$\\\\\n(do_work)'}\nEOF\n`\n", true, true, 3),
        ("w3m2b_sqinparam_bt1_hd_bt1_4bs_lit.sh", "source ./helpers.sh\nx=`cat <<EOF\n\\`echo \"${BAR:-'$\\\\\\\\\n(do_work)'}\"\\`\nEOF\n`\n", true, false, 0),
        ("w3m2b_sqinparam_bt1_hd_bt1_4bs_sub.sh", "source ./helpers.sh\nx=`cat <<EOF\n\\`echo \"${BAR:-'$\\\\\\\\\n$(do_work)'}\"\\`\nEOF\n`\n", true, true, 3),
        // Iter 2 Class 2: Plain <<INNER empty-prefix \<nl> before delimiter
        ("w3m2b_plain_hd_empty_1bs_call.sh", "source ./helpers.sh\ncat <<INNER >/dev/null\n\\\nINNER\ndo_work\nINNER\n", true, true, 5),
        ("w3m2b_plain_hd_empty_1bs_imp.sh", "cat <<INNER >/dev/null\n\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n", true, true, 5),
        ("w3m2b_plain_hd_empty_3bs_neg.sh", "source ./helpers.sh\ncat <<INNER >/dev/null\n\\\\\\\nINNER\ndo_work\nINNER\n", true, false, 0),
        ("w3m2b_plain_hd_tab_1bs_neg.sh", "source ./helpers.sh\ncat <<INNER >/dev/null\n\t\\\nINNER\ndo_work\nINNER\n", true, false, 0),
        ("w3m2b_bt1_plain_hd_empty_2bs_call.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\\\nINNER\ndo_work\nINNER\n`\n", true, true, 5),
        ("w3m2b_bt1_plain_hd_empty_1bs_call.sh", "source ./helpers.sh\nx=`cat <<INNER\n\\\nINNER\ndo_work\nINNER\n`\n", true, true, 5),
        // Iter 2 Class 3: Inner heredoc inside $(...) / `...` inside <<OUTER
        ("w3m2b_outer_sub_qinner_1bs.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<'INNER'\nfoo\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_sub_qinner_3bs.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<'INNER'\nfoo\\\\\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_sub_qinner_2bs_pos.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<'INNER'\nfoo\\\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, true, 6),
        ("w3m2b_outer_sub_qinner_empty_1bs_pos.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<'INNER'\n\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, true, 6),
        ("w3m2b_outer_sub_qinner_empty_3bs_neg.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<'INNER'\n\\\\\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_sub_qdash_1bs.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<-'INNER'\n\tfoo\\\n\tINNER\ndo_work\n\tINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_sub_qdash_tab_1bs_pos.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<-'INNER'\n\t\\\n\tINNER\ndo_work\n\tINNER\n)\nOUTER\n", true, true, 6),
        ("w3m2b_outer_sub_dqinner_1bs.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<\"INNER\"\nfoo\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_sub_bsinner_1bs.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n$(cat <<\\INNER\nfoo\\\nINNER\ndo_work\nINNER\n)\nOUTER\n", true, false, 0),
        ("w3m2b_outer_bt_qinner_empty_1bs_pos.sh", "source ./helpers.sh\ncat <<OUTER >/dev/null\n`cat <<'INNER'\n\\\nINNER\ndo_work\nINNER\n`\nOUTER\n", true, true, 6),
        // Iter 2 Class 4: $\n$(source ./helpers.sh; do_work) CST Desync in Dq, EscDq, BtInParam, \\\"
        ("w3m2b_dq_dollar_nl_src_sub.sh", "x=\"$\n$(source ./helpers.sh; do_work)\"\n", true, true, 2),
        ("w3m2b_dq_dollar_sp_src_sub.sh", "x=\"$ $(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_dq_dd_nl_src_sub.sh", "x=\"$$\n$(source ./helpers.sh; do_work)\"\n", true, true, 2),
        ("w3m2b_dq_dollar_nl_dd_src_neg.sh", "x=\"$\n$$(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_dq_dollar_nl_lit_src_neg.sh", "x=\"$\n(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_dq_dollar_nl_param_bt_src.sh", "x=\"$\n${FOO:-`source ./helpers.sh; do_work`}\"\n", true, true, 2),
        ("w3m2b_dq_dollar_nl_dd_param_src.sh", "x=\"$\n$${FOO:-$(source ./helpers.sh; do_work)}\"\n", true, true, 2),
        ("w3m2b_escdq_dollar_nl_src_sub.sh", "x=`echo \"$\n$(source ./helpers.sh; do_work)\"`\n", true, true, 2),
        ("w3m2b_btinparam_dollar_nl_src_sub.sh", "x=\"${FOO:-`echo \"$\n$(source ./helpers.sh; do_work)\"`}\"\n", true, true, 2),
        ("w3m2b_btinparam_3bs_escdq_dollar_nl_src_sub.sh", "x=\"${FOO:-`echo \\\\\\\"$\n$(source ./helpers.sh; do_work)\\\\\\\"`}\"\n", true, true, 2),
        ("w3m2b_btinparam_3bs_escdq_dollar_nl_param_src.sh", "x=\"${FOO:-`echo \\\\\\\"$\n${BAR:-$(source ./helpers.sh; do_work)}\\\\\\\"`}\"\n", true, true, 2),
        // Iter 3 Bug 1: dep_callers_bash_strip.rs reset_dollar() at bt_depth >= 2, surv > 0
        ("w3m2b_f_0886_sqinparam_hd_bt.sh", "x=`cat <<EOF\n\\`echo \"${BAR:-'$\\\\\\\n$(source ./helpers.sh; do_work)'}\"\\`\nEOF\n`\n", false, false, 0),
        ("w3m2b_hyp_nohd_bt2_dq_3bs.sh", "x=`echo \\`echo \"$\\\\\\\n$(source ./helpers.sh; do_work)\"\\``\n", false, false, 0),
        ("w3m2b_hyp_nohd_bt2_sqp_3bs.sh", "x=`echo \\`echo \"${BAR:-'$\\\\\\\n$(source ./helpers.sh; do_work)'}\"\\``\n", false, false, 0),
        ("w3m2b_hyp_nohd_bt2_dq_2bs_neg.sh", "x=`echo \\`echo \"$\\\\\n$(source ./helpers.sh; do_work)\"\\``\n", false, false, 0),
        ("w3m2b_hyp_nohd_bt2_dq_4bs_neg.sh", "x=`echo \\`echo \"$\\\\\\\\\n$(source ./helpers.sh; do_work)\"\\``\n", false, false, 0),
        ("w3m2b_hyp_nohd_bt2_dq_8bs_pos.sh", "x=`echo \\`echo \"$\\\\\\\\\\\\\\\\\n$(source ./helpers.sh; do_work)\"\\``\n", true, true, 2),
        ("w3m2b_hyp_nohd_bt2_sqp_4bs_pos.sh", "x=`echo \\`echo \"${BAR:-'$\\\\\\\\\n$(source ./helpers.sh; do_work)'}\"\\``\n", true, true, 1),
        ("w3m2b_hyp_nohd_bt2_dq_5bs_neg.sh", "x=`echo \\`echo \"$\\\\\\\\\\\n$(source ./helpers.sh; do_work)\"\\``\n", false, false, 0),
        // Iter 3 Bug 2: Quoted heredocs with odd trailing backslashes before delimiter
        ("w3m2b_qhd_1bs.sh", "cat <<'INNER'\n\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n", true, true, 4),
        ("w3m2b_qhd_3bs.sh", "cat <<'INNER'\n\\\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n", true, true, 4),
        ("w3m2b_bshd_1bs.sh", "cat <<\\INNER\n\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n", true, true, 4),
        ("w3m2b_dqhd_1bs.sh", "cat <<\"INNER\"\n\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n", true, true, 4),
        ("w3m2b_qhd_2bs_pos.sh", "cat <<'INNER'\n\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n", true, true, 4),
        ("w3m2b_outer_bt_qhd_2bs.sh", "cat <<OUTER >/dev/null\n`cat <<'INNER'\n\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n`\nOUTER\n", true, true, 5),
        ("w3m2b_outer_bt_qhd_6bs.sh", "cat <<OUTER >/dev/null\n`cat <<'INNER'\n\\\\\\\\\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n`\nOUTER\n", true, true, 5),
        ("w3m2b_cmdsub_sq_hd_1bs_empty.sh", "x=$(cat <<'INNER'\n\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n)\n", true, true, 5),
        // Iter 3 Bug 3: Non-<<- leading ws & <<- leading space before delimiter
        ("w3m2b_plain_sp.sh", "cat <<INNER >/dev/null\n INNER\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_plain_tab.sh", "cat <<INNER >/dev/null\n\tINNER\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_t_plain_hd_space_1bs_neg.sh", "cat <<INNER >/dev/null\n \\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_f_0010_hd_plain_cont.sh", "x=`cat <<INNER\n\t\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n`\n", false, false, 0),
        ("w3m2b_f_0354.sh", "cat <<OUTER >/dev/null\n`cat <<INNER\n\t\\\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n`\nOUTER\n", false, false, 0),
        ("w3m2b_f_0377.sh", "cat <<OUTER >/dev/null\n$(cat <<INNER\n\t\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n)\nOUTER\n", false, false, 0),
        ("w3m2b_f_0453.sh", "cat <<OUTER >/dev/null\n$(cat <<'INNER'\n\t\\\nINNER\nsource ./helpers.sh\ndo_work\nINNER\n)\nOUTER\n", false, false, 0),
        ("w3m2b_f_0818.sh", "cat <<OUTER >/dev/null\n`cat <<\\INNER\n\t\\\nINNER\nsource ./helpers.sh; do_work\nINNER\n`\nOUTER\n", false, false, 0),
        ("w3m2b_dash_space_before_delim_neg.sh", "cat <<-INNER >/dev/null\n  INNER\nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_dash_space_tab_cont_neg.sh", "cat <<-INNER >/dev/null\n \t\\\n\tINNER\nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_dash_tab_space_cont_neg.sh", "cat <<-INNER >/dev/null\n\t \\\n\tINNER\nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_dash_q_space_before_delim_neg.sh", "cat <<-'INNER' >/dev/null\n  INNER\nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_outer_tab_delim_with_sub_pos.sh", "cat <<OUTER >/dev/null\n\tOUTER\n$(source ./helpers.sh; do_work)\nOUTER\n", true, true, 3),
        ("w3m2b_outer_tab_delim_with_top_neg.sh", "cat <<OUTER >/dev/null\n\tOUTER\nsource ./helpers.sh; do_work\nOUTER\n", false, false, 0),
        // Iter 4 Bug 1: false_delim trailing ws & delimiter-prefixed lines
        ("w3m2b_b1_unq_sp.sh", "cat <<INNER >/dev/null\nINNER \nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_unq_tab.sh", "cat <<INNER >/dev/null\nINNER\t\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_sp.sh", "cat <<'INNER' >/dev/null\nINNER \nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_tab.sh", "cat <<'INNER' >/dev/null\nINNER\t\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_dq_sp.sh", "cat <<\"INNER\" >/dev/null\nINNER \nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_dash_tab.sh", "cat <<-INNER >/dev/null\n\tINNER\t\nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_b1_dash_q_sp.sh", "cat <<-'INNER' >/dev/null\n\tINNER \nsource ./helpers.sh\ndo_work\n\tINNER\n", false, false, 0),
        ("w3m2b_b1_sq_semi.sh", "cat <<'INNER' >/dev/null\nINNER;\nsource ./helpers.sh; do_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_hash.sh", "cat <<'INNER' >/dev/null\nINNER#c\nsource ./helpers.sh; do_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_amp.sh", "cat <<'INNER' >/dev/null\nINNER&\nsource ./helpers.sh; do_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_pipe.sh", "cat <<'INNER' >/dev/null\nINNER|\nsource ./helpers.sh; do_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_sq_semi_sub.sh", "cat <<'INNER' >/dev/null\nINNER; $(source ./helpers.sh; do_work)\nINNER\n", false, false, 0),
        ("w3m2b_b1_unq_semi_sub.sh", "cat <<INNER >/dev/null\nINNER; $(source ./helpers.sh; do_work)\nINNER\n", true, true, 2),
        ("w3m2b_b1_sp_delim_2sp.sh", "cat <<'INNER ' >/dev/null\nINNER  \nsource ./helpers.sh; do_work\nINNER \n", false, false, 0),
        ("w3m2b_b1_delim_x_false.sh", "cat <<'x' >/dev/null\nx \nsource ./helpers.sh\ndo_work\nx\n", false, false, 0),
        ("w3m2b_b1_delim_x_unq.sh", "cat <<x >/dev/null\nx \n$(source ./helpers.sh; do_work)\nx\n", true, true, 3),
        // Iter 4 Bug 2: $$<ws>${FOO:-...} CST expansion leading-whitespace desync
        ("w3m2b_b2_dd_sp.sh", "x=\"$$ ${FOO:-$(source ./helpers.sh\ndo_work)}\"\n", true, true, 2),
        ("w3m2b_b2_dd_tab.sh", "x=\"$$\t${FOO:-$(source ./helpers.sh\ndo_work)}\"\n", true, true, 2),
        ("w3m2b_b2_dd_nl_tab.sh", "x=\"$$\n\t${FOO:-$(source ./helpers.sh\ndo_work)}\"\n", true, true, 3),
        ("w3m2b_b2_dd_bt_sp.sh", "x=`echo \"$$ ${FOO:-$(source ./helpers.sh\ndo_work)}\"`\n", true, true, 2),
        ("w3m2b_b2_dd_btinparam.sh", "x=\"${BAR:-`echo \\\"$$\\t${FOO:-$(source ./helpers.sh\ndo_work)}\\\"`}\"\n", true, true, 2),
        ("w3m2b_b2_neg_dd_lit.sh", "x=\"$${FOO:-'$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_b2_neg_ddd.sh", "x=\"$$${FOO:-$(source ./helpers.sh; do_work)}\"\n", true, true, 1),
        ("w3m2b_b2_neg_3d_lit.sh", "x=\"$$$\"\n", false, false, 0),
        // Iter 4 Bug 3 & 4 (FirewallVerdict::Valid cases)
        ("w3m2b_b3_sq_empty_sp.sh", "source ./helpers.sh\ncat <<'EO'\\\n >/dev/null\ndo_work\nEO\n", true, false, 0),
        ("w3m2b_b3_sq_empty_tab.sh", "source ./helpers.sh\ncat <<'EO'\\\n\t>/dev/null\ndo_work\nEO\n", true, false, 0),
        ("w3m2b_b3_dq_empty_sp.sh", "source ./helpers.sh\ncat <<\"EO\"\\\n >/dev/null\ndo_work\nEO\n", true, false, 0),
        ("w3m2b_b3_dash_sq_empty_sp.sh", "source ./helpers.sh\ncat <<-'EO'\\\n >/dev/null\n\tdo_work\n\tEO\n", true, false, 0),
        ("w3m2b_b3_dq_nl_delim.sh", "cat <<\"EO\nF\"\nsource ./helpers.sh\ndo_work\nEO\nF\n", false, false, 0),
        ("w3m2b_b4_comp_bs.sh", "cat <<EO\\aF\nfoo\nEOaF\nsource ./helpers.sh; do_work\n", true, true, 4),
        // Iter 5 Finding 1: Heredoc delimiter symbol/substitution masking (FirewallVerdict::Valid)
        ("w3m2b_i5_delim_unq.sh", "source ./helpers.sh\ncat <<do_work >/dev/null\nbody\ndo_work\n", true, false, 0),
        ("w3m2b_i5_delim_sq.sh", "source ./helpers.sh\ncat <<'do_work' >/dev/null\nbody\ndo_work\n", true, false, 0),
        ("w3m2b_i5_delim_dq.sh", "source ./helpers.sh\ncat <<\"do_work\" >/dev/null\nbody\ndo_work\n", true, false, 0),
        ("w3m2b_i5_delim_dq_sub.sh", "source ./helpers.sh\ncat <<\"EO$(do_work)\" >/dev/null\nbody\nEO$(do_work)\n", true, false, 0),
        ("w3m2b_i5_delim_dq_bt.sh", "source ./helpers.sh\ncat <<\"EO`do_work`\" >/dev/null\nbody\nEO`do_work`\n", true, false, 0),
        ("w3m2b_i5_delim_dq_param.sh", "source ./helpers.sh\ncat <<\"EO${FOO:-$(do_work)}\" >/dev/null\nbody\nEO${FOO:-$(do_work)}\n", true, false, 0),
        ("w3m2b_i5_delim_dq_esc.sh", "source ./helpers.sh\ncat <<\"EO\\\"$(do_work)\\\"\" >/dev/null\nbody\nEO\"$(do_work)\"\n", true, false, 0),
        // Iter 5 Finding 3: Multiline double-quoted delimiter with $(do_work) & subshell after heredoc
        ("w3m2b_i5_dq_nl_sub_closed.sh", "source ./helpers.sh\ncat <<\"EO\n$(do_work)\"\nbody\nEO\n$(do_work)\n", true, false, 0),
        ("w3m2b_i5_subshell_after_hd.sh", "source ./helpers.sh\n(cat <<EOF\nhi\nEOF\n); do_work\n", true, true, 5),
        // Iter 6: CoalesceHdDelim (hd_p, hd_bt), ContLineAccum rollback on <<EO${FOO:-\\\nF}, & bt_depth closing delim
        ("w3m2b_i6_c8_bt1_dq_nl_sub.sh", "x=`cat <<\"EO\n$(do_work)\" >/dev/null\nbody\nEO\n$(do_work)\n`\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i6_bt1_dq_nl_delim_body.sh", "x=`cat <<\"EO\n$(source ./helpers.sh; do_work)\" >/dev/null\nbody\nEO\n$(source ./helpers.sh; do_work)\n`\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i6_unq_split_param_body_call.sh", "cat <<EO${FOO:-\\\nF} >/dev/null\n$(source ./helpers.sh; do_work)\nEO${FOO:-F}\n", true, true, 3),
        ("w3m2b_i6_unq_split_param_src_before_sub.sh", "source ./helpers.sh\ncat <<EO${FOO:-\\\nF} >/dev/null\n$(do_work)\nEO${FOO:-F}\n", true, true, 4),
        ("w3m2b_i6_unq_split_param_then_call.sh", "source ./helpers.sh\ncat <<EO${FOO:-\\\nF} >/dev/null\nbody\nEO${FOO:-F}\n$(do_work)\n", true, true, 6),
        ("w3m2b_i6_dash_split_param_valid.sh", "source ./helpers.sh\ncat <<-EO${FOO:-\\\nF} >/dev/null\n\tbody\n\tEO${FOO:-F}\n$(do_work)\n", true, true, 6),
        ("w3m2b_i6_src_after_split_param_valid.sh", "cat <<EO${FOO:-\\\nF} >/dev/null\nbody\nEO${FOO:-F}\nsource ./helpers.sh\n$(do_work)\n", true, true, 6),
        // Iter 7: hd_need_ml_push + <<SECOND, bt_depth==0 delim \<nl> cont, NUL truncation in $'...'
        ("w3m2b_i7_two_hd_src_top_dq_nl_then_second_valid.sh", "source ./helpers.sh\ncat <<\"EO\nF\" <<SECOND >/dev/null\nbody1\nEO\nF\nbody2\nSECOND\ndo_work\n", true, false, 0),
        ("w3m2b_i7_tail_bs_src_after.sh", "cat <<EOF >/dev/null\nbody\nEOF\\\n\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i7_tail_bs_src_before.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nbody\nEOF\\\n\ndo_work\n", true, true, 6),
        ("w3m2b_i7_tail_bs_dash_tab.sh", "cat <<-EOF >/dev/null\n\tbody\n\tEOF\\\n\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i7_tail_bs_dash_2tab.sh", "source ./helpers.sh\ncat <<-EOF >/dev/null\n\tbody\n\t\tEOF\\\n\ndo_work\n", true, true, 6),
        ("w3m2b_i7_tail_bs_2x_nl.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nbody\nEOF\\\n\\\n\ndo_work\n", true, true, 7),
        ("w3m2b_i7_bt0_bs_then_eof_tail_bs.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nbody\n\\\nEOF\\\n\ndo_work\n", true, true, 7),
        ("w3m2b_i7_tail_bs_nested_inner.sh", "cat <<OUTER >/dev/null\n$(cat <<INNER\nbody\nINNER\\\n\nsource ./helpers.sh; do_work\n)\nOUTER\n", true, true, 6),
        ("w3m2b_i7_ansisq_nul.sh", "cat <<$'EO\\0F' >/dev/null\n$(source ./helpers.sh; do_work)\nEO\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i7_ansisq_nul_hex.sh", "cat <<$'EO\\x00F' >/dev/null\n$(source ./helpers.sh; do_work)\nEO\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i7_ansisq_nul_u4.sh", "cat <<$'EO\\u0000F' >/dev/null\n$(source ./helpers.sh; do_work)\nEO\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i7_ansisq_nul_then_g.sh", "cat <<$'EO\\0F'G >/dev/null\n$(source ./helpers.sh; do_work)\nEOG\nsource ./helpers.sh; do_work\n", true, true, 4),
        // Iter 8: multi-backtick CST merge, $'...' runtime bad substitution, delim $'...' reset
        ("w3m2b_i8_two_bt_dq.sh", "x=\"`echo a` `source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i8_two_bt_bare_sp.sh", "echo `echo a` `source ./helpers.sh; do_work`\n", true, true, 1),
        ("w3m2b_i8_two_bt_bare_adj.sh", "x=`echo a``source ./helpers.sh; do_work`\n", true, true, 1),
        ("w3m2b_i8_fz_1542.sh", "x=\"`:``. ./helpers.sh`\"\n", true, false, 0),
        ("w3m2b_i8_esc_dq_bt.sh", "x=\"`echo \\\"a\\\"` `source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i8_nested_bt.sh", "x=\"`echo \\`echo nested\\`` `source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i8_ansi_in_bt.sh", "x=\"`echo $'a\\'b'` `source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i8_hash_in_bt.sh", "x=\"`echo # cmt\necho 1` `source ./helpers.sh; do_work`\"\n", true, true, 2),
        ("w3m2b_i8_cont_bt.sh", "x=\"`echo a`\\\n`source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i8_hd_in_bt.sh", "x=\"`cat <<EOF\nhi\nEOF\n` `source ./helpers.sh; do_work`\"\n", true, true, 4),
        ("w3m2b_i8_r1_bt1_2bs.sh", "x=`echo \"${FOO:-$'a\\\\'$(source ./helpers.sh; do_work)'}\"`\n", false, false, 0),
        ("w3m2b_i8_r1_bt1_3bs.sh", "x=`echo \"${FOO:-$'a\\\\\\'b'}\" ; source ./helpers.sh; do_work`\n", false, false, 0),
        ("w3m2b_i8_r1_bt1_5bs.sh", "x=`echo \"${FOO:-$'a\\\\\\\\\\'b'}\" ; source ./helpers.sh; do_work`\n", true, true, 1),
        ("w3m2b_i8_bt2_4bs.sh", "x=`echo \\`echo \"${FOO:-$'a\\\\\\\\'$(source ./helpers.sh; do_work)'}\"\\``\n", false, false, 0),
        ("w3m2b_i8_bt2_5bs.sh", "x=`echo \\`echo \"${FOO:-$'a\\\\\\\\\\'b'}\" ; source ./helpers.sh; do_work\\``\n", false, false, 0),
        ("w3m2b_i8_delim_dq_q_sq.sh", "cat <<\"EO${X:-$\\\"'a'}\"\n$(source ./helpers.sh; do_work)\nEO${X:-$\"'a'}\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i8_fz_1230.sh", "x=\"val`. ./helpers.sh`${X:-$'a\\'b'}\"\n", false, false, 0),
        ("w3m2b_i8_fz_1252.sh", "x=\"$(do_work)$(source ./helpers.sh; do_work)${X:-$'a\\'b'}\"\n", false, false, 0),
        ("w3m2b_i8_line2_after_badsub.sh", "x=\"${X:-$'a\\'b'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i8_reg_dq_3bs_after.sh", "x=\"${X:-$'a\\\\\\'b'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        // Iter 9: in_ansi_sq $/`, bad_sub abort scope, UnclosedSq, u3_delim_unbal
        ("w3m2b_i9_ex_bt0_3bs_dollar.sh", "echo \"${FOO:-$'a\\\\\\$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_i9_ex_bt0_7bs_dollar.sh", "echo \"${FOO:-$'a\\\\\\\\\\\\\\$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_i9_ex_bt0_3bs_after_src.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\\\\\$(do_work)'}\"\n", true, true, 2),
        ("w3m2b_i9_adv_bs2_dollar.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\\\$(do_work)'}\"\n", true, false, 0),
        ("w3m2b_i9_ex_bt1_5bs_dollar.sh", "source ./helpers.sh\nx=`echo \"${FOO:-$'a\\\\\\\\\\$(do_work)'}\"`\n", true, false, 0),
        ("w3m2b_i9_ex_bt1_6bs_dollar.sh", "x=`echo \"${FOO:-$'a\\\\\\\\\\\\$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_i9_ex_bt1_7bs_dollar.sh", "x=`echo \"${FOO:-$'a\\\\\\\\\\\\\\$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_i9_bt2_8bs_dollar.sh", "source ./helpers.sh\nx=`echo \\`echo \"${FOO:-$'a\\\\\\\\\\\\\\\\$(do_work)'}\"\\``\n", true, false, 0),
        ("w3m2b_i9_bt2_12bs_dollar.sh", "x=`echo \\`echo \"${FOO:-$'a\\\\\\\\\\\\\\\\\\\\\\\\$(source ./helpers.sh; do_work)'}\"\\``\n", true, true, 1),
        ("w3m2b_i9_bt0_bt_k2.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\\\`do_work`'}\"\n", true, false, 0),
        ("w3m2b_i9_bt0_bt_k3.sh", "echo \"${FOO:-$'a\\\\\\`source ./helpers.sh; do_work`'}\"\n", true, true, 1),
        ("w3m2b_i9_bt0_bt_k6.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\\\\\\\\\\\`do_work`'}\"\n", true, false, 0),
        ("w3m2b_i9_bt0_bt_k7.sh", "echo \"${FOO:-$'a\\\\\\\\\\\\\\`source ./helpers.sh; do_work`'}\"\n", true, true, 1),
        ("w3m2b_i9_bt1_bt_k5.sh", "source ./helpers.sh\nx=`echo \"${FOO:-$'a\\\\\\\\\\`do_work\\`'}\"`\n", true, false, 0),
        ("w3m2b_i9_bt1_bt_k7.sh", "x=`echo \"${FOO:-$'a\\\\\\\\\\\\\\`source ./helpers.sh; do_work\\`'}\"`\n", true, true, 1),
        ("w3m2b_i9_ex_bt0_3bs_bt_inside.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\\\\\`do_work`'}\"\n", true, true, 2),
        ("w3m2b_i9_pre_same_dq.sh", "source ./helpers.sh\nx=\"$(do_work)${FOO:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i9_pre_adj_dq.sh", "source ./helpers.sh\nx=\"$(do_work)\"\"${FOO:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i9_prev_arg_dq.sh", "source ./helpers.sh\necho \"$(do_work)\" \"${X:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i9_prev_arg_cmdsub_bad.sh", "source ./helpers.sh\necho \"$(do_work)\" \"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, false, 0),
        ("w3m2b_i9_unq_param_1bs.sh", "echo ${X:-$'a\\'b'}; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i9_badsub_then_sub.sh", "echo \"${X:-$'a\\'b'}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i9_badsub_semi.sh", "x=\"${X:-$'a\\'b'}\"; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i9_badsub_and.sh", "x=\"${X:-$'a\\'b'}\" && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i9_badsub_or.sh", "x=\"${X:-$'a\\'b'}\" || source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i9_badsub_bg.sh", "x=\"${X:-$'a\\'b'}\" & source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i9_badsub_pipe.sh", "echo \"${X:-$'a\\'b'}\" | { cat >/dev/null; source ./helpers.sh; do_work; }\n", true, true, 1),
        ("w3m2b_i9_badsub_subshell_ml.sh", "(x=\"${X:-$'a\\'b'}\"\nsource ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i9_badsub_brace_ml.sh", "{ x=\"${X:-$'a\\'b'}\"\nsource ./helpers.sh; do_work; }\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i9_badsub_cmdsub_ml.sh", "y=$(echo \"${X:-$'a\\'b'}\"\nsource ./helpers.sh; do_work); source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i9_badsub_minor3.sh", "x=\"$(echo \"${Y:-$'a\\'b'}\")$(source ./helpers.sh; do_work)\"; source ./helpers.sh\n", false, false, 0),
        ("w3m2b_i9_badsub_bt_then_sub.sh", "x=\"`echo \"${Y:-$'a\\'b'}\"`$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i9_r1_bt1_9bs.sh", "x=`echo \"${FOO:-$'a\\\\\\\\\\\\\\\\\\'b'}\" ; source ./helpers.sh; do_work`\n", false, false, 0),
        ("w3m2b_i9_unq_hd_k1.sh", "cat <<EOF >/dev/null\n${X:-$'a\\'b'}\n$(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("w3m2b_i9_unq_hd_k3.sh", "cat <<EOF >/dev/null\n${X:-$'a\\\\\\'b'}\n$(source ./helpers.sh; do_work)\nEOF\n", false, false, 0),
        ("w3m2b_i9_unq_hd_pre_inline.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\n$(do_work) ${X:-$'a\\'b'}\n$(do_work)\nEOF\n", true, true, 3),
        // Iter 10 Explorer A: k in {3,7,11,15} bt in "$'...'", unclosed ` in SqInParam, glued x=`...`
        ("w3m2b_i10_a_bt0_k3_in.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\\\`'}\"\n", true, true, 1),
        ("w3m2b_i10_a_bt0_k3_after.sh", "echo \"${FOO:-$'a`echo ok \\\\\\`'}\"\nsource ./helpers.sh\ndo_work\n", true, true, 3),
        ("w3m2b_i10_a_bt0_k7_in.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\\\\\\\\\\\`'}\"\n", true, true, 1),
        ("w3m2b_i10_a_bt0_k11_in.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\\\\\\\\\\\\\\\\\\\`'}\"\n", true, true, 1),
        ("w3m2b_i10_a_bt0_k15_in.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\\\\\\\\\\\\\\\\\\\\\\\\\\\`'}\"\n", true, true, 1),
        ("w3m2b_i10_a_bt0_k2_badsub.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\`'}\"\n", false, false, 0),
        ("w3m2b_i10_a_bt0_k5_badsub.sh", "echo \"${FOO:-$'a`source ./helpers.sh; do_work \\\\\\\\\\`'}\"\n", false, false, 0),
        ("w3m2b_i10_a_bt1_k7_in.sh", "x=`echo \"${FOO:-$'a\\`source ./helpers.sh; do_work \\\\\\\\\\\\\\`'}\"`\n", true, true, 1),
        ("w3m2b_i10_a_bt1_k11_bad.sh", "x=`echo \"${FOO:-$'a\\`source ./helpers.sh; do_work \\\\\\\\\\\\\\\\\\\\\\`'}\"`\n", false, false, 0),
        ("w3m2b_i10_a_b2_single_bt.sh", "echo \"${X:-$'a`b'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i10_a_b2_sq_no_dollar.sh", "echo \"${X:-'a`b'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i10_a_b2_p0093.sh", "source ./helpers.sh\necho \"${FOO:-$'a\\`do_work`'}\" | { source ./helpers.sh; do_work; }\n", true, true, 2),
        ("w3m2b_i10_a_b2_fz0595.sh", "{\n  echo \"${FOO:-$'a\\\\\\`source ./helpers.sh; do_work'}\"\n  source ./helpers.sh\n}\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i10_a_b2_dq_inside.sh", "echo \"${X:-$'a`echo \"b'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i10_a_b2_cmdsub_inside.sh", "echo \"${X:-$'a`echo $(echo hi)'}\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        // Iter 10 Explorer B Scope 1: simple command W -> A -> R
        ("w3m2b_i10_b_s1_1.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" BAR=\"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_5.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" echo \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_6.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" $(echo ok) \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_9.sh", "source ./helpers.sh\necho >$(do_work; echo /dev/null) \"${X:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_10.sh", "source ./helpers.sh\necho \"$(do_work)\" >\"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_13.sh", "source ./helpers.sh\necho >\"$(echo \"${Y:-$'a\\'b'}\")\" \"$(do_work)\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_20.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" >$(echo R; echo /dev/null) echo \"${X:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_25.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" >\"$(echo \"${Y:-$'a\\'b'}\")\" echo ok\n", true, true, 2),
        ("w3m2b_i10_b_s1_procsub.sh", "source ./helpers.sh\necho >(do_work) \"${X:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_redir_procsub.sh", "source ./helpers.sh\necho > >(do_work) \"${X:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_assign_bad_word.sh", "source ./helpers.sh\nBAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i10_b_s1_assign_subbad_word.sh", "source ./helpers.sh\nBAZ=\"$(echo \"${Z:-$'a\\'b'}\")\" >$(do_work; echo /dev/null) \"$(do_work)\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_assign_bad_bare.sh", "source ./helpers.sh\nBAR=\"${Y:-$'a\\'b'}\" do_work\n", true, false, 0),
        ("w3m2b_i10_b_s1_redir_bad_bare.sh", "source ./helpers.sh\n>\"${Y:-$'a\\'b'}\" do_work\n", true, false, 0),
        // Iter 10 Explorer B Scope 2: unquoted heredoc bad_sub header &&
        ("w3m2b_i10_b_s2_and_cmd.sh", "cat <<EOF >/dev/null && source ./helpers.sh && do_work\n${X:-$'a\\'b'}\nEOF\n", false, false, 0),
        ("w3m2b_i10_b_s2_trailing_and_nl.sh", "cat <<EOF >/dev/null &&\n${X:-$'a\\'b'}\nEOF\nsource ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i10_b_s2_in_cmdsub_and.sh", "x=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) && source ./helpers.sh\n", false, false, 0),
        ("w3m2b_i10_b_s2_cmdsub_bad_and.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n$(echo \"${X:-$'a\\'b'}\")\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_param_bad_cmdsub.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n${X:-$(echo \"${Y:-$'a\\'b'}\")}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_unq_sq_bal.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n${X:-$'a\\\\'}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_redir_before.sh", "source ./helpers.sh\ncat >$(do_work; echo /dev/null) <<EOF && echo A\n${X:-$'a\\'b'}\nEOF\n", true, true, 2),
        ("w3m2b_i10_b_s2_redir_after.sh", "source ./helpers.sh\ncat <<EOF >$(do_work; echo /dev/null) && echo A\n${X:-$'a\\'b'}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_assign_before.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" cat <<EOF >/dev/null && echo A\n${X:-$'a\\'b'}\nEOF\n", true, true, 2),
        ("w3m2b_i10_b_s2_word_after.sh", "source ./helpers.sh\ncat <<EOF >/dev/null \"$(do_work)\" && echo A\n${X:-$'a\\'b'}\nEOF\n", true, true, 2),
        // Iter 10 Explorer C: in_ansi_sq \\\<nl> & multiline compound abort_floor
        ("w3m2b_i10_c_ansi_bt0_k2_sub.sh", "echo \"${FOO:-$'a\\\\\n$(source ./helpers.sh; do_work)'}\"\n", true, true, 1),
        ("w3m2b_i10_c_ansi_bt0_k3_sub.sh", "echo \"${FOO:-$'a\\\\\\\n$(source ./helpers.sh; do_work)'}\"\n", true, true, 2),
        ("w3m2b_i10_c_ansi_bt0_k4_dollar.sh", "echo \"${FOO:-$'a$\\\\\\\\\n(source ./helpers.sh; do_work)'}\"\n", false, false, 0),
        ("w3m2b_i10_c_ansi_bt0_k5_dollar.sh", "echo \"${FOO:-$'a$\\\\\\\\\\\n(source ./helpers.sh; do_work)'}\"\n", false, false, 0),
        ("w3m2b_i10_c_ansi_bt1_k1_sub.sh", "x=`printf %s \"${FOO:-$'a\\\n$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_i10_c_ansi_bt1_k2_sub.sh", "x=`printf %s \"${FOO:-$'a\\\\\n$(source ./helpers.sh; do_work)'}\"`\n", true, true, 1),
        ("w3m2b_i10_c_ansi_bt1_k6_sub.sh", "x=`printf %s \"${FOO:-$'a\\\\\\\\\\\\\n$(source ./helpers.sh; do_work)'}\"`\n", true, true, 2),
        ("w3m2b_i10_c_if_cond_ml.sh", "if x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh\nthen\n  do_work\nfi\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_i10_c_if_then_ml.sh", "source ./helpers.sh\nif true; then\n  x=\"${X:-$'a\\'b'}\"\n  do_work\nfi\ndo_work\n", true, true, 6),
        ("w3m2b_i10_c_if_elif_ml.sh", "if false; then echo a\nelif true; then\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh\nelse\n  source ./helpers.sh\nfi\nsource ./helpers.sh; do_work\n", true, true, 8),
        ("w3m2b_i10_c_while_ml.sh", "while true; do\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh; do_work\n  break\ndone\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_i10_c_until_ml.sh", "until false; do\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh; do_work\n  break\ndone\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_i10_c_for_ml.sh", "for i in 1; do\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh; do_work\ndone\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i10_c_for_arith_ml.sh", "for((i=0;i<1;i++)); do\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh; do_work\ndone\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i10_c_case_ml.sh", "case a in\n  a)\n    x=\"${X:-$'a\\'b'}\"\n    source ./helpers.sh; do_work\n    ;;\nesac\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i10_c_if_brace_then.sh", "if true; then { x=\"${X:-$'a\\'b'}\"; source ./helpers.sh; }\nsource ./helpers.sh\nfi\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i10_c_if_inside_brace.sh", "{\n  if true; then x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh\n  fi\n  source ./helpers.sh\n}\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i10_c_if_subshell_then.sh", "if true; then (x=\"${X:-$'a\\'b'}\"); source ./helpers.sh; do_work; fi\n", true, true, 1),
        ("w3m2b_i10_c_if_pipe_then.sh", "if true; then x=\"${X:-$'a\\'b'}\" | { source ./helpers.sh; do_work; }; fi\n", true, true, 1),
        ("w3m2b_i10_c_if_bg_then.sh", "if true; then x=\"${X:-$'a\\'b'}\" & source ./helpers.sh; do_work; fi\n", true, true, 1),
        ("w3m2b_i10_c_if_semi_after_fi.sh", "if true; then\n  x=\"${X:-$'a\\'b'}\"\nfi; source ./helpers.sh; do_work\n", true, true, 3),
        ("w3m2b_i12_if_cond_semi_after_fi.sh", "if x=\"${X:-$'a\\'b'}\"; then echo ok; fi; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i10_c_non_kw_echo_if.sh", "echo if\nx=\"${X:-$'a\\'b'}\"\nsource ./helpers.sh; do_work\n", true, true, 3),
        ("w3m2b_i10_c_non_kw_fi_in_if.sh", "if true; then\n  echo fi\n  x=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh\nfi\n", false, false, 0),
        // Iter 11 Explorer A Item 1 (rem % 4 == 2 closing ' before })
        ("w3m2b_i11_a_b1_chal2.sh", "echo \"${X:-$'a\\\\`echo ok \\\\\\\\\\\\'}\"; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_a_b1_sq_k2.sh", "echo \"${X:-$'a\\\\'}\"; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_a_b1_sq_k4.sh", "echo \"${X:-$'a\\\\\\\\'}\"; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_a_b1_sq_k2_extra_brace.sh", "echo \"${X:-$'a\\\\'}}\"; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_a_b1_sq_k2_nested_param.sh", "echo \"${Y:-${X:-$'a\\\\'}}\"; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_a_b1_bt1_sq_k3.sh", "x=`echo \"${X:-$'a\\\\\\'}\"; source ./helpers.sh; do_work`\nsource ./helpers.sh\n", true, false, 0),
        // Iter 11 Explorer B Clusters 1-6
        ("w3m2b_i11_bare_word_bad.sh", "source ./helpers.sh\ndo_work \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i11_bare_word_redir_bad.sh", "source ./helpers.sh\ndo_work >$(do_work; echo /dev/null) \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i11_bare_word_sub_then_bad.sh", "source ./helpers.sh\ndo_work $(do_work) \"${Y:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i11_bare_word_procsub_bad.sh", "source ./helpers.sh\ndo_work > >(do_work) \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i11_assign_sub_bare_bad.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" do_work \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i11_bare_before_r_subbad.sh", "source ./helpers.sh\ndo_work >\"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, false, 0),
        ("w3m2b_i11_sub_w_before_r_subbad.sh", "source ./helpers.sh\necho \"$(do_work)\" >\"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, true, 2),
        ("w3m2b_i11_war_w_r_trail_sub.sh", "source ./helpers.sh\n\"${Y:-$'a\\'b'}\" >\"${W:-$'a\\'b'}\" \"$(do_work)\"\n", true, false, 0),
        ("w3m2b_i11_war_w_r_trail_procsub.sh", "source ./helpers.sh\n\"${Y:-$'a\\'b'}\" >\"${W:-$'a\\'b'}\" <(do_work)\n", true, false, 0),
        ("w3m2b_i11_war_a_r_trail_a_sub.sh", "source ./helpers.sh\nA=\"${Y:-$'a\\'b'}\" >\"${W:-$'a\\'b'}\" B=\"$(do_work)\" echo ok\n", true, false, 0),
        ("w3m2b_i11_war_a_r_trail_w_sub.sh", "source ./helpers.sh\nA=\"${Y:-$'a\\'b'}\" >\"${W:-$'a\\'b'}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i11_nested_floor_assign_bt.sh", "source ./helpers.sh\nV0=\"${Y:-$'a\\'b'}\" V1=\"`echo \"${Y:-$'a\\'b'}\"`\"; do_work\n", true, false, 0),
        ("w3m2b_i11_nested_floor_redir_bt.sh", "source ./helpers.sh\n>\"${Y:-$'a\\'b'}\" >`echo \"${Y:-$'a\\'b'}\"`; do_work\n", true, false, 0),
        ("w3m2b_i11_nested_floor_if_bt.sh", "source ./helpers.sh\nif true; then\n  x=\"${Y:-$'a\\'b'}\"\n  y=`echo \"${Y:-$'a\\'b'}\"`\n  do_work\nfi\n", true, false, 0),
        ("w3m2b_i11_cmd_ready_r_sub_bare.sh", "source ./helpers.sh\n>$(echo a; echo /dev/null) do_work \"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i11_cmd_wrap_a_bad_sub.sh", "source ./helpers.sh\ncommand BAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_cmd_p_wrap_a_bad_sub.sh", "source ./helpers.sh\ncommand -p BAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_cmd_dd_wrap_a_bad_sub.sh", "source ./helpers.sh\ncommand -- BAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_builtin_wrap_a_bad_sub.sh", "source ./helpers.sh\nbuiltin BAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_cmd_wrap_a_sub_w_bad.sh", "source ./helpers.sh\ncommand BAR=\"$(do_work)\" \"${Y:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i11_builtin_wrap_a_sub_w_bad.sh", "source ./helpers.sh\nbuiltin BAR=\"$(do_work)\" \"${Y:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i11_time_a_bad_sub.sh", "source ./helpers.sh\ntime BAR=\"${Y:-$'a\\'b'}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i11_empty_dq_sub.sh", "source ./helpers.sh\necho \"${}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_empty_dq_sp_procsub.sh", "source ./helpers.sh\necho \"${  }\" <(do_work)\n", true, false, 0),
        ("w3m2b_i11_empty_dq_assign.sh", "source ./helpers.sh\nA=\"${}\" B=\"$(do_work)\"\n", true, false, 0),
        ("w3m2b_i11_empty_dq_after_assign.sh", "source ./helpers.sh\nA=\"$(do_work)\" \"${}\"\n", true, false, 0),
        ("w3m2b_i11_empty_unq_sub.sh", "source ./helpers.sh\necho ${} $(do_work)\n", true, false, 0),
        ("w3m2b_i11_empty_unq_sp_sub.sh", "source ./helpers.sh\necho ${  } $(do_work)\n", true, false, 0),
        ("w3m2b_i11_empty_nested_alt.sh", "source ./helpers.sh\necho \"${A:-${}}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i11_bt_assign_and.sh", "x=\"`echo \"${Y:-$'a\\'b'}\"`\" && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_bt_assign_or.sh", "x=\"`echo \"${Y:-$'a\\'b'}\"`\" || source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_bt_cmd_and.sh", "echo \"`echo \"${Y:-$'a\\'b'}\"`\" && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_hd_subshell_and.sh", "(cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n) && source ./helpers.sh && do_work\n", false, false, 0),
        ("w3m2b_i11_hd_subshell_or.sh", "(cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n) || source ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i11_hd_brace_and.sh", "{ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n} && source ./helpers.sh && do_work\n", false, false, 0),
        ("w3m2b_i11_hd_brace_or.sh", "{ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n} || source ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i11_subshell_assign_and.sh", "(\n  FOO=\"${X:-$'a\\'b'}\"\n  source ./helpers.sh\n) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_subshell_assign_or.sh", "(\n  FOO=\"${X:-$'a\\'b'}\"\n) || source ./helpers.sh; do_work\n", true, true, 3),
        ("w3m2b_i11_subshell_assign_semi.sh", "(\n  FOO=\"${X:-$'a\\'b'}\"\n); source ./helpers.sh; do_work\n", true, true, 3),
        ("w3m2b_i11_adj_sq_dq.sh", "source ./helpers.sh\nx=\"$(do_work)\"'x'\"${FOO:-$'a\\'b'}\"\n", true, true, 2),
        // Iter 11 Explorer C case ;& / ;;& and a|b) pattern alternation (reconciled for sound case_item isolation)
        ("w3m2b_i11_c_arm_semi_amp_ml.sh", "case a in a) x=\"${X:-$'a\\'b'}\";& b) source ./helpers.sh; do_work;; esac\n", true, true, 1),
        ("w3m2b_i11_c_arm_dsemi_amp_ml.sh", "case a in a) x=\"${X:-$'a\\'b'}\";;& b) source ./helpers.sh; do_work;; esac\n", true, true, 1),
        ("w3m2b_i11_c_arm_semi_amp_sp.sh", "case a in a) x=\"${X:-$'a\\'b'}\" ;& b) source ./helpers.sh; do_work;; esac\n", true, true, 1),
        ("w3m2b_i12_c_arm_semi_amp_after.sh", "case a in a) x=\"${X:-$'a\\'b'}\";& b) echo ok;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_arm_semi_amp_1line.sh", "case a in a) x=\"${X:-$'a\\'b'}\";& b) source ./helpers.sh; do_work;; esac; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_c_arm_dsemi_amp_1line.sh", "case a in a) x=\"${X:-$'a\\'b'}\";;& b) source ./helpers.sh; do_work;; esac; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_c_arm_semi_amp_and_esac.sh", "case a in a) x=\"${X:-$'a\\'b'}\";& b) source ./helpers.sh; do_work;; esac && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i11_c_arm_semi_amp_bg_inside.sh", "case a in a) x=\"${X:-$'a\\'b'}\" & source ./helpers.sh; do_work;; esac\n", true, true, 1),
        ("w3m2b_i11_c_arm_bad_pipe_semi_amp.sh", "case a in a) x=\"${X:-$'a\\'b'}\" | cat >/dev/null;& b) source ./helpers.sh; do_work;; esac\n", true, true, 1),
        ("w3m2b_i11_c_word_bare_pipe.sh", "case \"${X:-$'a\\'b'}\" in a|b) source ./helpers.sh; do_work;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_word_bare_3pipe.sh", "case \"${X:-$'a\\'b'}\" in a|b|c) source ./helpers.sh; do_work;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_word_paren_pipe.sh", "case \"${X:-$'a\\'b'}\" in (a|b) source ./helpers.sh; do_work;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_word_bare_pipe_1line.sh", "case \"${X:-$'a\\'b'}\" in a|b) source ./helpers.sh; do_work;; esac; source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_c_word_bad_esac_and.sh", "case \"${X:-$'a\\'b'}\" in a|b) source ./helpers.sh; do_work;; esac && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i11_c_word_bad_esac_pipe.sh", "case \"${X:-$'a\\'b'}\" in a|b) echo ok;; esac | { cat >/dev/null; source ./helpers.sh; do_work; }\n", true, true, 1),
        ("w3m2b_i11_c_pat_bad_sub_pipe.sh", "case a in \"${X:-$'a\\'b'}\"|b) source ./helpers.sh; do_work;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_pat_extglob.sh", "case \"${X:-$'a\\'b'}\" in @(a|b)) source ./helpers.sh; do_work;; esac\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_case_in_if_nl.sh", "if true; then case \"${X:-$'a\\'b'}\" in a|b) source ./helpers.sh; do_work;; esac; fi\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i11_c_case_in_subshell_semi.sh", "(case \"${X:-$'a\\'b'}\" in a|b) source ./helpers.sh; do_work;; esac); source ./helpers.sh; do_work\n", true, true, 1),
        // Iter 12 Explorer A: Heredoc oscillation, if/while/case condition heredocs, pre-<<A abort, glued source
        ("w3m2b_i12_hd_sub_and_pre.sh", "source ./helpers.sh\n(cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n) && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_sub_echo_and_pre.sh", "source ./helpers.sh\n(cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\necho ok\n) && do_work\n", true, true, 6),
        ("w3m2b_i12_hd_brace_and_pre.sh", "source ./helpers.sh\n{ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n} && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_brace_echo_and_pre.sh", "source ./helpers.sh\n{ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\necho ok\n} && do_work\n", true, true, 6),
        ("w3m2b_i12_hd_cmdsub_var_and_pre.sh", "source ./helpers.sh\nv=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_cmdsub_dq_var_and_pre.sh", "source ./helpers.sh\nv=\"$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n)\" && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_cmdsub_var_echo_pre.sh", "source ./helpers.sh\nv=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) echo ok && do_work\n", true, true, 5),
        ("w3m2b_i12_hd_cmdsub_var_y_pre.sh", "source ./helpers.sh\nv=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) y=1 && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_bare_cmdsub_and_pre.sh", "source ./helpers.sh\n$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) && do_work\n", true, false, 0),
        ("w3m2b_i12_hd_brace_in_sub_pre.sh", "source ./helpers.sh\n({ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n} && do_work)\n", true, false, 0),
        ("w3m2b_i12_if_cond_hd_then.sh", "if cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen source ./helpers.sh; do_work; fi\n", false, false, 0),
        ("w3m2b_i12_if_cond_hd_then_pre.sh", "source ./helpers.sh\nif cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen do_work; fi\n", true, false, 0),
        ("w3m2b_i12_if_cond_hd_else.sh", "if cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen echo ok; else source ./helpers.sh; do_work; fi\n", true, true, 4),
        ("w3m2b_i12_if_cond_hd_elif.sh", "if cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen echo ok; elif true; then source ./helpers.sh; do_work; fi\n", true, true, 4),
        ("w3m2b_i12_if_cond_hd_fi_and.sh", "if cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen echo ok; fi && source ./helpers.sh && do_work\n", true, true, 4),
        ("w3m2b_i12_if_cond_hd_true.sh", "if cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\ntrue\nthen source ./helpers.sh; do_work; fi\n", true, true, 5),
        ("w3m2b_i12_elif_cond_hd.sh", "if false; then echo a; elif cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\nthen source ./helpers.sh; do_work; fi\n", false, false, 0),
        ("w3m2b_i12_while_cond_hd.sh", "while cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\ndo source ./helpers.sh; do_work; break; done\n", false, false, 0),
        ("w3m2b_i12_until_cond_hd.sh", "until cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\ndo source ./helpers.sh; do_work; break; done\n", true, true, 4),
        ("w3m2b_i12_case_hd_match_and.sh", "case a in a) cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n;; esac && source ./helpers.sh && do_work\n", false, false, 0),
        ("w3m2b_i12_case_hd_match_and_pre.sh", "source ./helpers.sh\ncase a in a) cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n;; esac && do_work\n", true, false, 0),
        ("w3m2b_i12_case_hd_nomatch_and.sh", "case b in a) cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\n;; esac && source ./helpers.sh && do_work\n", true, true, 4),
        ("w3m2b_i12_hd_word_before_pre.sh", "source ./helpers.sh\ncat \"${}\" <<A\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_word_after_pre.sh", "source ./helpers.sh\ncat <<A \"${}\"\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_word_after_r5.sh", "cat <<A \"${}\"\n$(source ./helpers.sh; do_work)\nA\n", false, false, 0),
        ("w3m2b_i12_hd_redir_before_pre.sh", "source ./helpers.sh\ncat >\"${}\" <<A\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_redir_before_ansi_pre.sh", "source ./helpers.sh\ncat >\"${Y:-$'a\\'b'}\" <<A\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_redir_after_pre.sh", "source ./helpers.sh\ncat <<A >\"${}\"\n$(do_work)\nA\n", true, true, 3),
        ("w3m2b_i12_hd_redir_after_r5.sh", "cat <<A >\"${}\"\n$(source ./helpers.sh; do_work)\nA\n", true, true, 2),
        ("w3m2b_i12_hd_assign_before_pre.sh", "source ./helpers.sh\nA=\"${}\" cat <<A\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_assign_ok_word_bad_pre.sh", "source ./helpers.sh\nA=\"$(do_work)\" cat \"${}\" <<A\n$(do_work)\nA\n", true, false, 0),
        ("w3m2b_i12_hd_word_ok_word_bad_pre.sh", "source ./helpers.sh\ncat \"$(do_work)\" \"${}\" <<A\n$(do_work)\nA\n", true, true, 2),
        ("w3m2b_i12_src_glued_bt.sh", "source ./helpers.sh`echo ok`; do_work\n", false, false, 0),
        ("w3m2b_i12_dot_glued_bt.sh", ". ./helpers.sh`echo ok`; do_work\n", false, false, 0),
        ("w3m2b_i12_src_space_bt.sh", "source ./helpers.sh `echo ok`; do_work\n", true, true, 1),
        ("w3m2b_i12_src_empty_sq_glued.sh", "source ./helpers.sh''; do_work\n", true, true, 1),
        // Iter 12 Explorer B: ${foo:-...} vs ${}, active_braces>0 & <<<, stale Param, <(...) isolation, ParamHdr
        ("w3m2b_i12_c1_unq_dq_adj.sh", "source ./helpers.sh\necho ${foo:-\"$(do_work)\"\"${Y:-$'a\\'b'}\"}\n", true, false, 0),
        ("w3m2b_i12_c1_unq_dq_sp.sh", "source ./helpers.sh\necho ${foo:-\"$(do_work)\" \"${Y:-$'a\\'b'}\"}\n", true, false, 0),
        ("w3m2b_i12_c1_dq_empty_adj.sh", "source ./helpers.sh\necho \"${foo:-\"$(do_work)\"\"${}\"}\"\n", true, true, 2),
        ("w3m2b_i12_c1_unq_sub_empty.sh", "source ./helpers.sh\necho ${foo:-$(do_work)${}}\n", true, true, 2),
        ("w3m2b_i12_c1_dq_prev_sub_empty.sh", "source ./helpers.sh\necho \"$(do_work) ${foo:-\"$(echo ok)\"\"${}\"}\"\n", true, true, 2),
        ("w3m2b_i12_c1_dq_prev_sub_ansi.sh", "source ./helpers.sh\necho \"$(do_work) ${foo:-\"$(echo ok)\"\"${Y:-$'a\\'b'}\"}\"\n", true, false, 0),
        ("w3m2b_i12_c1_r5_dq_empty.sh", "echo \"${foo:-\"$(source ./helpers.sh; do_work)\"\"${}\"}\"\n", true, true, 1),
        ("w3m2b_i12_c1_r5_unq_empty.sh", "echo ${foo:-\"$(source ./helpers.sh; do_work)\"\"${}\"}\n", true, true, 1),
        ("w3m2b_i12_c1_r5_dq_empty_then_sub.sh", "echo \"${foo:-\"${}\"\"$(source ./helpers.sh; do_work)\"}\"\n", false, false, 0),
        ("w3m2b_i12_c1_r5_sub_empty_in_dq.sh", "echo \"$(source ./helpers.sh; do_work) ${}\"\n", true, true, 1),
        ("w3m2b_i12_c2_assign_nested_empty.sh", "source ./helpers.sh\nA=${A:-${}} $(do_work)\n", true, true, 2),
        ("w3m2b_i12_c2_bang_redir_nested.sh", "source ./helpers.sh\n! >>${A:-${}} \"$(do_work)\" C=\"$(do_work)\"\n", true, true, 2),
        ("w3m2b_i12_c2_time_amp_redir_nested.sh", "source ./helpers.sh\ntime &>${A:-${}} C=\"$(do_work)\" echo ok\n", true, true, 2),
        ("w3m2b_i12_c2_cmd_p_redir_nested.sh", "source ./helpers.sh\ncommand -p 2>${A:-${}} C=\"$(do_work)\"\n", true, true, 2),
        ("w3m2b_i12_c2_cmd_hs_nested.sh", "source ./helpers.sh\ncommand <<<${A:-${}} $(do_work)\n", true, true, 2),
        ("w3m2b_i12_c2_assign_nested_bare.sh", "source ./helpers.sh\nA=${A:-${}} do_work\n", true, false, 0),
        ("w3m2b_i12_c3_cmd_2r_sub_ps_emp.sh", "source ./helpers.sh\ncommand 2>${} \"$(do_work)\" <(do_work) ${}\n", true, true, 2),
        ("w3m2b_i12_c3_echo_r_asg_emp.sh", "source ./helpers.sh\necho >${} A=\"$(do_work)\" ${}\n", true, true, 2),
        ("w3m2b_i12_c3_r_sub_r_emp.sh", "source ./helpers.sh\n>${} \"$(do_work)\" >${}\n", true, true, 2),
        ("w3m2b_i12_c3_asg_sub_asg_emp.sh", "source ./helpers.sh\nA=${} \"$(do_work)\" B=${}\n", true, true, 2),
        ("w3m2b_i12_c3_cmd_r_asg_emp_semi.sh", "source ./helpers.sh\ncommand >${} A=\"$(do_work)\" ${}; do_work\n", true, true, 2),
        ("w3m2b_i12_c3_r_asg_emp_semi.sh", "source ./helpers.sh\n>${} A=\"$(do_work)\" ${}; do_work\n", true, false, 0),
        ("w3m2b_i12_c4_ps_empty_ps.sh", "source ./helpers.sh\ncat <(echo \"${}\") <(do_work)\n", true, true, 2),
        ("w3m2b_i12_c4_ps_empty_cmdsub.sh", "source ./helpers.sh\ncat <(echo \"${}\") $(do_work)\n", true, true, 2),
        ("w3m2b_i12_c4_out_ps_empty_cmdsub.sh", "source ./helpers.sh\necho ok > >(cat \"${}\") $(do_work)\n", true, true, 2),
        ("w3m2b_i12_c4_ps_empty_semi.sh", "source ./helpers.sh\ncat <(echo \"${}\") ; do_work\n", true, true, 2),
        ("w3m2b_i12_c4_ps_empty_and.sh", "source ./helpers.sh\ncat <(echo \"${}\") && do_work\n", true, true, 2),
        ("w3m2b_i12_c4_ps_empty_or.sh", "source ./helpers.sh\ncat <(echo \"${}\") || do_work\n", true, true, 2),
        ("w3m2b_i12_c4_ps_nl_inside_src.sh", "cat <(echo \"${}\"\nsource ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i12_c4_r5_ps_empty_ps_src.sh", "cat <(echo \"${}\") <(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i12_c4_ps_src_empty_call.sh", "cat <(source ./helpers.sh; echo \"${}\"; do_work)\n", true, false, 0),
        ("w3m2b_i12_c4_ps_ansi_ps.sh", "source ./helpers.sh\ncat <(echo \"${Y:-$'a\\'b'}\") <(do_work)\n", true, false, 0),
        ("w3m2b_i12_c4_ps_ansi_prev_sub.sh", "source ./helpers.sh\necho \"$(do_work)\" <(echo \"${Y:-$'a\\'b'}\")\n", true, false, 0),
        ("w3m2b_i12_c4_ps_ansi_nl.sh", "source ./helpers.sh\ncat <(echo \"${Y:-$'a\\'b'}\")\ndo_work\n", true, true, 3),
        ("w3m2b_i12_c5_dq_bs_sp.sh", "source ./helpers.sh\necho \"${\\ }\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_unq_bs_sp.sh", "source ./helpers.sh\necho ${\\ } $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_dq_bs_tab.sh", "source ./helpers.sh\necho \"${\\\t}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_unq_bs_tab.sh", "source ./helpers.sh\necho ${\\\t} $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_dq_x_bs_sp.sh", "source ./helpers.sh\necho \"${x\\ }\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_dq_foo_sp.sh", "source ./helpers.sh\necho \"${foo }\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_dq_sp_foo.sh", "source ./helpers.sh\necho \"${ foo}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_arr_bs_sp.sh", "source ./helpers.sh\necho \"${a[0]\\ }\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_nested_bs_sp.sh", "source ./helpers.sh\necho \"${foo:-${\\ }}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_c5_bt_dq_bs_sp.sh", "source ./helpers.sh\nx=`echo \"${\\ }\" $(do_work)`\n", true, false, 0),
        ("w3m2b_i12_c5_r5_dq_bs_sp.sh", "echo \"${\\ }\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i12_c5_r5_unq_bs_sp.sh", "echo ${\\ } $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i12_c5_default_bs_sp_ok.sh", "source ./helpers.sh\necho \"${foo:-\\ }\" $(do_work)\n", true, true, 2),
        ("w3m2b_i12_c5_bs_nl_foo_ok.sh", "source ./helpers.sh\necho \"${\\\nfoo}\" $(do_work)\n", true, true, 2),
        // Iter 12 Explorer C: multi-assign bt &&, if/elif/else/fi; isolation, $(...) separation, case arm isolation & &;;
        ("w3m2b_i12_c_multi_bt_v0_v1_and.sh", "V0=\"`echo ok`\" V1=\"`echo \"${Y:-$'a\\'b'}\"`\" && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_multi_bt_x_y1_and.sh", "x=\"`echo \"${X:-$'a\\'b'}\"`\" y=1 && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_multi_bt_y1_x_and.sh", "y=1 x=\"`echo \"${X:-$'a\\'b'}\"`\" && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_multi_bt_redir_and.sh", "x=\"`echo \"${X:-$'a\\'b'}\"`\" y=1 >/dev/null && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_multi_bt_then_sub_r5.sh", "x=\"`echo \"${X:-$'a\\'b'}\"`\" y=\"$(source ./helpers.sh; do_work)\" && echo ok\n", true, true, 1),
        ("w3m2b_i12_c_multi_bt_then_sub_pre.sh", "source ./helpers.sh\nx=\"`echo \"${X:-$'a\\'b'}\"`\" y=\"$(echo ok)\" && do_work\n", true, true, 2),
        ("w3m2b_i12_c_if_false_else_r5.sh", "if false; then x=\"${X:-$'a\\'b'}\"; else source ./helpers.sh; do_work; fi\n", true, true, 1),
        ("w3m2b_i12_c_if_false_else_pre.sh", "source ./helpers.sh\nif false; then x=\"${X:-$'a\\'b'}\"; else do_work; fi\n", true, true, 2),
        ("w3m2b_i12_c_if_elif_then_r5.sh", "if false; then x=\"${X:-$'a\\'b'}\"; elif true; then source ./helpers.sh; do_work; fi\n", true, true, 1),
        ("w3m2b_i12_c_if_elif_cond_bad.sh", "if false; then echo a; elif x=\"${X:-$'a\\'b'}\"; then echo b; else source ./helpers.sh; do_work; fi\n", false, false, 0),
        ("w3m2b_i12_c_cmdsub_emp_semi.sh", "v=$(echo \"${}\"); source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_emp_or.sh", "v=$(echo \"${}\") || source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_emp_and.sh", "v=$(echo \"${}\") && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_cmdsub_emp_and_pre.sh", "source ./helpers.sh\nv=$(echo \"${}\") && do_work\n", true, false, 0),
        ("w3m2b_i12_c_cmdsub_echo_and.sh", "source ./helpers.sh\necho $(echo \"${}\") && do_work\n", true, true, 2),
        ("w3m2b_i12_c_cmdsub_if_cond_else.sh", "if v=$(echo \"${}\"); then echo ok; else source ./helpers.sh; do_work; fi\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_bare_semi.sh", "$(echo \"${}\"); source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_bare_and.sh", "$(echo \"${}\") && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_c_cmdsub_emp_w_ok_and.sh", "v=$(echo \"${}\") w=$(echo ok) && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_adj_dq.sh", "x=\"$(echo \"${}\")$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i12_c_cmdsub_prev_dq.sh", "echo \"$(source ./helpers.sh; do_work)\" \"$(echo \"${}\")\"\n", true, true, 1),
        ("w3m2b_i12_c_case_b_dsemi_pre.sh", "source ./helpers.sh\ncase b in\n a) A=${} ;;\n b) $(do_work) ;;\nesac\n", true, true, 4),
        ("w3m2b_i12_c_case_b_dsemi_r5.sh", "case b in\n a) A=${} ;;\n b) source ./helpers.sh; do_work ;;\nesac\n", true, true, 3),
        ("w3m2b_i12_c_case_esac_semi_pre.sh", "source ./helpers.sh\ncase b in a) A=${} ;; esac; do_work\n", true, true, 2),
        ("w3m2b_i12_c_case_bg_dsemi.sh", "case a in a) x=\"${X:-$'a\\'b'}\" &;; b) source ./helpers.sh; do_work;; esac; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_case_bg_semi_amp.sh", "case a in a) x=\"${X:-$'a\\'b'}\" &;& b) source ./helpers.sh; do_work;; esac && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_c_case_bg_dsemi_amp.sh", "case a in a) x=\"${X:-$'a\\'b'}\" &;;& b) source ./helpers.sh; do_work;; esac && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i12_diff_bang_star_ok.sh", "echo \"${!*:-x}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        // Iter 13: Valid unquoted heredoc ${...}, backtick heredoc abort, r5 subsh/grp/cmdsub, nested paren
        ("w3m2b_i13_hd_unq_brace_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null && do_work\n${X}\nEOF\n", true, true, 2),
        ("w3m2b_i13_hd_unq_def_pos.sh", "source ./helpers.sh\ncat <<EOF >/dev/null && do_work\n${X:-ok}\nEOF\n", true, true, 2),
        ("w3m2b_i13_hd_unq_if_pos.sh", "source ./helpers.sh\nif cat <<EOF >/dev/null\n${X:-ok}\nEOF\nthen do_work; fi\n", true, true, 5),
        ("w3m2b_i13_hd_unq_while_pos.sh", "source ./helpers.sh\nwhile cat <<EOF >/dev/null\n${X:-ok}\nEOF\ndo do_work; break; done\n", true, true, 5),
        ("w3m2b_i13_hd_unq_subsh_pos.sh", "source ./helpers.sh\n(cat <<EOF >/dev/null\n${X:-ok}\nEOF\n) && do_work\n", true, true, 5),
        ("w3m2b_i13_hd_unq_grp_pos.sh", "source ./helpers.sh\n{ cat <<EOF >/dev/null\n${X:-ok}\nEOF\n} && do_work\n", true, true, 5),
        ("w3m2b_i13_hd_unq_cmdsub_pos.sh", "source ./helpers.sh\nv=\"$(cat <<EOF\n${X:-ok}\nEOF\n)\" && do_work\n", true, true, 5),
        ("w3m2b_i13_hd_unq_case_pos.sh", "source ./helpers.sh\ncase a in a) cat <<EOF >/dev/null\n${X:-ok}\nEOF\n;; esac && do_work\n", true, true, 5),
        ("w3m2b_i13_hd_bt1_pos.sh", "source ./helpers.sh\nx=`cat <<EOF >/dev/null\n${X:-ok}\nEOF\n` && do_work\n", true, true, 5),
        ("w3m2b_i13_hd_bt1_bad_sp.sh", "source ./helpers.sh\nx=`cat <<EOF >/dev/null\n${\\ }\nEOF\n` && do_work\n", true, false, 0),
        ("w3m2b_i13_hd_bt1_bad_bang.sh", "source ./helpers.sh\nx=`cat <<EOF >/dev/null\n${!!}\nEOF\n` && do_work\n", true, false, 0),
        ("w3m2b_i13_hd_bt1_bad_empty.sh", "source ./helpers.sh\nx=`cat <<EOF >/dev/null\n${}\nEOF\n` && do_work\n", true, false, 0),
        ("w3m2b_i13_r5_subsh_cont.sh", "(cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\necho ok\n) && source ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i13_r5_grp_cont.sh", "{ cat <<EOF >/dev/null\n${X:-$'a\\'b'}\nEOF\necho ok\n} && source ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i13_r5_cmdsub_cont.sh", "v=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\necho ok) && source ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i13_r5_cmdsub_ab.sh", "v=$(cat <<EOF\n${X:-$'a\\'b'}\nEOF\n) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i13_nested_sub_nl_ab.sh", "source ./helpers.sh\n(\n(x=\"${}\")\n) && do_work\n", true, false, 0),
        ("w3m2b_i13_nested_sub_nl_ok.sh", "source ./helpers.sh\n(\n(x=\"${}\")\necho ok\n) && do_work\n", true, true, 5),
        // Iter 13: time wrapper + glued/FD redirections & assignments
        ("w3m2b_i13_time_pos_dq.sh", "time A=\"${}\" \"$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i13_time_pos_procsub.sh", "time A=\"${}\" <(source ./helpers.sh; do_work) ok\n", true, true, 1),
        ("w3m2b_i13_time_pos_bang.sh", "time BAR=\"${!$}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_ansi.sh", "time BAR=\"${Y:-$'a\\'b'}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_p.sh", "time -p BAR=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_dashdash.sh", "time -- A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_double.sh", "time time A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_neg.sh", "! time A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_redir_ok.sh", "time 2>/dev/null A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_redir_bad_pre.sh", "time >\"${}\" A=\"$(source ./helpers.sh; do_work)\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_redir_cmd_pre.sh", "time >\"$(source ./helpers.sh; echo /dev/null)\" A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_redir_mid.sh", "time A=\"${}\" >\"$(source ./helpers.sh; echo /dev/null)\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_time_pos_assign_ok_then_bad.sh", "time A=\"$(source ./helpers.sh; do_work)\" B=\"${}\"\n", true, true, 1),
        ("w3m2b_i13_time_pos_source.sh", "time -p -- A=1 source ./helpers.sh\n", true, false, 0),
        ("w3m2b_i13_time_neg_word.sh", "time A=\"$(source ./helpers.sh; do_work)\" \"${}\"\n", false, false, 0),
        ("w3m2b_i13_time_neg_assign2.sh", "time A=\"${}\" B=\"$(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_i13_time_neg_and.sh", "time A=\"$(echo \"${}\")\" && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_time_neg_quoted_assign.sh", "time \"A=${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_time_neg_pp.sh", "time -p -p A=\"${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_time_neg_command.sh", "time command A=\"${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_time_neg_env.sh", "time env A=\"${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_command_neg.sh", "command A=\"${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_env_neg.sh", "env A=\"${}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_time_dc_neg_dd.sh", "source ./helpers.sh\ntime -- A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_time_dc_neg_p_dd.sh", "source ./helpers.sh\ntime -p -- A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_time_dc_pos_redir.sh", "source ./helpers.sh\ntime 2>/dev/null A=\"${}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i13_fd_bad_dq.sh", "source ./helpers.sh\n2>\"${}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_bad_bang.sh", "source ./helpers.sh\n2>\"${!!}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_sq.sh", "source ./helpers.sh\n2>'x' A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_ansi.sh", "source ./helpers.sh\n2>$'x' A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_cmdsub.sh", "source ./helpers.sh\n2>$(echo ok) A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_ok_dq.sh", "source ./helpers.sh\n2>\"${X:-ok}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_unq_bad.sh", "source ./helpers.sh\n2>${} A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd0_bad.sh", "source ./helpers.sh\n0<\"${}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd10_append.sh", "source ./helpers.sh\n10>>\"${}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_herestr.sh", "source ./helpers.sh\n2<<<\"${}\" A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_dup1.sh", "source ./helpers.sh\n2>&1 A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_close.sh", "source ./helpers.sh\n2>&- \"${}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i13_fd_clobber_ok.sh", "source ./helpers.sh\n>|out A=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_fd_clobber_bad.sh", "source ./helpers.sh\n>|\"${}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i13_fd_echo_pos.sh", "source ./helpers.sh\n2>\"${}\" A=\"$(do_work)\" echo ok\n", true, true, 2),
        ("w3m2b_i13_fd_herestr_pos.sh", "source ./helpers.sh\n<<<\"${}\" $(do_work)\n", true, true, 2),
        ("w3m2b_i13_assign_plus_eq.sh", "source ./helpers.sh\nA+=\"$(do_work)\" ${}\n", true, false, 0),
        ("w3m2b_i13_assign_subscript.sh", "source ./helpers.sh\nA[0]=\"$(do_work)\" ${}\n", true, false, 0),
        // Iter 13: pipeline isolation, ! negation, case reconciliation
        ("w3m2b_i13_pipe_semi_dc.sh", "source ./helpers.sh\necho ok | echo \"${}\" ; do_work\n", true, true, 2),
        ("w3m2b_i13_pipe_semi_r5.sh", "echo ok | echo \"${}\" ; (source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_pipeamp_semi_dc.sh", "source ./helpers.sh\necho ok |& echo \"${}\" ; do_work\n", true, true, 2),
        ("w3m2b_i13_pipeamp_semi_r5.sh", "echo ok |& echo \"${}\" ; (source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_pipe_and_dc.sh", "source ./helpers.sh\necho ok | echo \"${}\" && do_work\n", true, false, 0),
        ("w3m2b_i13_pipe_and_r5.sh", "echo ok | echo \"${}\" && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_pipeamp_and_r5.sh", "echo ok |& echo \"${}\" && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_pipe_or_dc.sh", "source ./helpers.sh\necho ok | echo \"${}\" || do_work\n", true, true, 2),
        ("w3m2b_i13_pipe_stage1_r5.sh", "echo \"${}\" | echo ok && (source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_pipe_ml_r5.sh", "echo ok |\necho \"${}\" && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_pipe_subsh_r5.sh", "echo ok | (echo \"${}\") && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_bang_sub_and_dc.sh", "source ./helpers.sh\n! ( echo \"${}\" ) && do_work\n", true, true, 2),
        ("w3m2b_i13_bang_sub_and_r5.sh", "! ( echo \"${}\" ) && (source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i13_bang_sub_or_dc.sh", "source ./helpers.sh\n! ( echo \"${}\" ) || do_work\n", true, false, 0),
        ("w3m2b_i13_bang_sub_or_r5.sh", "! ( echo \"${}\" ) || (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_bang_grp_and_dc.sh", "source ./helpers.sh\n! { echo \"${}\"; } && do_work\n", true, false, 0),
        ("w3m2b_i13_bang_grp_or_dc.sh", "source ./helpers.sh\n! { echo \"${}\"; } || do_work\n", true, false, 0),
        ("w3m2b_i13_bang_cmd_and_dc.sh", "source ./helpers.sh\n! echo \"${}\" && do_work\n", true, false, 0),
        ("w3m2b_i13_bang_sub_pipe_dc.sh", "source ./helpers.sh\n! ( echo ok | echo \"${}\" ) && do_work\n", true, true, 2),
        ("w3m2b_i13_bang_pipe_and_dc.sh", "source ./helpers.sh\n! echo ok | echo \"${}\" && do_work\n", true, true, 2),
        ("w3m2b_i13_bang_pipe_or_r5.sh", "! echo ok | echo \"${}\" || (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_bang_double_dc.sh", "source ./helpers.sh\n! ! ( echo \"${}\" ) && do_work\n", true, false, 0),
        ("w3m2b_i13_bang_hd_sub_r5.sh", "! (cat <<EOF >/dev/null\n${}\nEOF\n) && (source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i13_case_arm2_hd_dc.sh", "source ./helpers.sh\ncase b in a) echo ok ;; *) cat <<A >/dev/null\n${}\nA\n;; esac && do_work\n", true, false, 0),
        ("w3m2b_i13_case_arm2_hd_r5.sh", "case b in a) echo ok ;; *) cat <<A >/dev/null\n${}\nA\n;; esac && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_case_dsemi_amp_nomatch_dc.sh", "source ./helpers.sh\ncase x in *) cat <<A >/dev/null\n${}\nA\n;;& b) echo ok ;; esac && do_work\n", true, false, 0),
        ("w3m2b_i13_case_dsemi_amp_nomatch_r5.sh", "case x in *) cat <<A >/dev/null\n${}\nA\n;;& b) echo ok ;; esac && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_case_dsemi_amp_match_r5.sh", "case b in *) cat <<A >/dev/null\n${}\nA\n;;& b) echo ok ;; esac && (source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i13_case_star_word_semi_dc.sh", "source ./helpers.sh\ncase b in *) echo \"${}\" ;; *) echo ok ;; esac; do_work\n", true, false, 0),
        ("w3m2b_i13_case_star_word_semi_r5.sh", "case b in *) echo \"${}\" ;; *) echo ok ;; esac; (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_case_lit_word_semi_dc.sh", "source ./helpers.sh\ncase a in a) echo \"${}\" ;; esac; do_work\n", true, false, 0),
        ("w3m2b_i13_case_lit_word_and_r5.sh", "case a in a) echo \"${}\" ;; esac && (source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i13_case_dyn_word_safe_r5.sh", "case \"${x}\" in a) echo ok ;; *) cat <<A >/dev/null\n${}\nA\n;; esac && (source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i13_case_lit_arm2_hd_r5.sh", "case b in a) echo ok ;; b) cat <<A >/dev/null\n${}\nA\n;; esac && (source ./helpers.sh; do_work)\n", false, false, 0),
        // Iter 14: Clusters 1-5 & Explorer A/B/C edge-case closure
        ("w3m2b_i14_c1_bang_time_redir_assign_pos.sh", "! time 2>\"${}\" A=\"${X:-ok}\" \"$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i14_c1_bang_time_redir_nl_pos.sh", "! time 2>\"${}\" A=\"${X:-ok}\" \"$(echo ok)\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i14_c1_bang_time_devnull_assign_bad.sh", "! time 2>/dev/null A=\"${}\" B=\"$(source ./helpers.sh; do_work)\" \"$(source ./helpers.sh)\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i14_c1_bang_time_10redir_psub.sh", "! time 10>>\"${}\" <(source ./helpers.sh; do_work) ok\n", true, true, 1),
        ("w3m2b_i14_c1_fd0_assign_word_pos.sh", "0<\"${}\" A=\"${}\" \"$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i14_c1_fd0_append_assign_neg.sh", "0<\"${}\" A+=\"${}\" \"${}\" \"$(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_i14_c1_fd0_quoted_assign_neg.sh", "0<\"${}\" \"${}\" \"A=$(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_i14_c1_fd0_echo_arg_neg.sh", "0<\"${}\" echo A=\"${}\" \"$(source ./helpers.sh; do_work)\"\n", false, false, 0),
        ("w3m2b_i14_c1_bang_time_subshell_or_neg.sh", "source ./helpers.sh\n! time (echo \"${}\") || do_work\n", true, false, 0),
        ("w3m2b_i14_c1_bang_time_subshell_and_pos.sh", "! time (echo \"${}\") && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c1_time_subshell_and_neg.sh", "source ./helpers.sh\ntime (echo \"${}\") && do_work\n", true, false, 0),
        ("w3m2b_i14_c1_time_subshell_or_pos.sh", "time (echo \"${}\") || source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c1_time_p_fd0_assign_neg.sh", "time -p 0<\"${}\" A=\"${}\" B=\"$(source ./helpers.sh; do_work)\" \"${}\"\n", false, false, 0),
        ("w3m2b_i14_c1_subscript_assign_src_pos.sh", "A[${}]=\"$(source ./helpers.sh; do_work)\"\n", true, true, 1),
        ("w3m2b_i14_c1_subscript_assign_after_neg.sh", "source ./helpers.sh\nA[${}]=\"ok\"; do_work\n", true, false, 0),
        ("w3m2b_i14_c1_subscript_prefix_word_pos.sh", "A[0]=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i14_c2_bang_nl_sub_and_neg.sh", "source ./helpers.sh\n!\n(echo \"${}\") && do_work\n", true, false, 0),
        ("w3m2b_i14_c2_bang_bsnl_sub_and_pos.sh", "! \\\n(echo \"${}\") && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c2_bang_bang_brace_hd_or_pos.sh", "source ./helpers.sh\n! ! { cat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, true, 5),
        ("w3m2b_i14_c2_bang_bang_brace_hd_and_neg.sh", "! ! { cat <<EOF >/dev/null\n${}\nEOF\n} && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c2_if_bang_hd_elif_dead.sh", "if ! cat <<EOF >/dev/null\n${}\nEOF\nthen echo ok\nelif source ./helpers.sh; then do_work\nelse source ./helpers.sh; do_work\nfi\n", false, false, 0),
        ("w3m2b_i14_c2_if_bang_hd_then_pos.sh", "if ! cat <<EOF >/dev/null\n${}\nEOF\nthen source ./helpers.sh; do_work\nelse echo dead\nfi\n", true, true, 4),
        ("w3m2b_i14_c2_while_bang_hd_pos.sh", "while ! cat <<EOF >/dev/null\n${}\nEOF\ndo source ./helpers.sh; do_work; break; done\n", true, true, 4),
        ("w3m2b_i14_c2_until_bang_hd_neg.sh", "source ./helpers.sh\nuntil ! cat <<EOF >/dev/null\n${}\nEOF\ndo do_work; break; done\n", true, false, 0),
        ("w3m2b_i14_c2_until_bang_grp_sub_neg.sh", "until ! { (echo \"${}\"); }; do source ./helpers.sh; do_work; break; done\n", false, false, 0),
        ("w3m2b_i14_c2_until_x_cmdsub_pos.sh", "until x=$(cat <<EOF\n${}\nEOF\n)\n do source ./helpers.sh; do_work; break; done\n", true, true, 5),
        ("w3m2b_i14_c2_until_bang_x_cmdsub_neg.sh", "source ./helpers.sh\nuntil ! x=$(cat <<EOF\n${}\nEOF\n)\n do do_work; break; done\n", true, false, 0),
        ("w3m2b_i14_c2_bang_brace_pipe_semi_pos.sh", "! { echo \"${}\"; } | echo ok; source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c2_bang_brace_pipe_last_and_pos.sh", "! { echo ok; } | { echo \"${}\"; } && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c2_bang_pipe_3stage_last_and_pos.sh", "! true |& true |& (echo \"${}\") && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c2_bang_pipe_3stage_last_or_neg.sh", "source ./helpers.sh\n! true |& true |& (echo \"${}\") || do_work\n", true, false, 0),
        ("w3m2b_i14_c3_brace_sub_semi_and_neg.sh", "source ./helpers.sh\n{ (echo \"${}\"); } && do_work\n", true, false, 0),
        ("w3m2b_i14_c3_brace_sub_nl_and_neg.sh", "source ./helpers.sh\n{ (echo \"${}\")\n} && do_work\n", true, false, 0),
        ("w3m2b_i14_c3_bang_brace_sub_semi_or_neg.sh", "source ./helpers.sh\n! { (echo \"${}\"); } || do_work\n", true, false, 0),
        ("w3m2b_i14_c3_bang_brace_sub_semi_and_pos.sh", "! { (echo \"${}\"); } && source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c3_1line_cmdsub_sub_and_neg.sh", "source ./helpers.sh\nv=\"$( (echo \"${}\") )\" && do_work\n", true, false, 0),
        ("w3m2b_i14_c3_1line_cmdsub_sub_or_pos.sh", "v=\"$( (echo \"${}\") )\" || source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c3_grp_case_semi_nl_and_neg.sh", "source ./helpers.sh\n{ case a in a) echo \"${}\" ;; esac;\n} && do_work\n", true, false, 0),
        ("w3m2b_i14_c3_grp_case_semi_nl_or_pos.sh", "{ case a in a) echo \"${}\" ;; esac;\n} || source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c4_glued_esac_paren_and_neg.sh", "source ./helpers.sh\n(case a in a) echo \"${}\" ;; esac) && do_work\n", true, false, 0),
        ("w3m2b_i14_c4_glued_esac_paren_or_pos.sh", "(case a in a) echo \"${}\" ;; esac) || source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i14_c4_glued_esac_hd_paren_and_neg.sh", "(case a in a) cat <<A\n${}\nA\n;; esac) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c4_sub_x_cmdsub_hd_and_neg.sh", "source ./helpers.sh\n(x=$(cat <<EOF\n${}\nEOF\n)) && do_work\n", true, false, 0),
        ("w3m2b_i14_c4_sub_x_bt_hd_and_neg.sh", "(x=`cat <<EOF\n${}\nEOF\n`) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c4_if_x_bt_hd_then_neg.sh", "source ./helpers.sh\nif x=`cat <<EOF\n${}\nEOF\n`; then do_work; fi\n", true, false, 0),
        ("w3m2b_i14_c4_if_x_cmdsub_hd_else_pos.sh", "if x=$(cat <<EOF\n${}\nEOF\n); then echo dead; else source ./helpers.sh; do_work; fi\n", true, true, 4),
        ("w3m2b_i14_c4_while_x_bt_hd_do_neg.sh", "while x=`cat <<EOF\n${}\nEOF\n`; do source ./helpers.sh; do_work; break; done\n", false, false, 0),
        ("w3m2b_i14_c4_if_grp_sub_then_neg.sh", "source ./helpers.sh\nif { (echo \"${}\"); }; then do_work; else echo ok; fi\n", true, false, 0),
        ("w3m2b_i14_c5_bare_bt_hd_and_neg.sh", "source ./helpers.sh\n`cat <<EOF\n${}\nEOF\n` && do_work\n", true, false, 0),
        ("w3m2b_i14_c5_bang_bare_bt_hd_or_neg.sh", "source ./helpers.sh\n! `cat <<EOF\n${}\nEOF\n` || do_work\n", true, false, 0),
        ("w3m2b_i14_c5_bang_bare_bt_hd_and_pos.sh", "source ./helpers.sh\n! `cat <<EOF\n${}\nEOF\n` && do_work\n", true, true, 5),
        ("w3m2b_i14_c5_bt_seg_aborts_neg.sh", "v=`echo ok; echo \"${}\"` && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c5_pre_cmdsub_post_neg.sh", "source ./helpers.sh\nv=\"pre$(echo \"${}\")post\" && do_work\n", true, false, 0),
        ("w3m2b_i14_c5_utf8_sq_copy_neg.sh", "echo 'foo_\u{00e9}_\u{03b2}_\u{4e2d}' \"${}\" && source ./helpers.sh; do_work\n", false, false, 0),
        // Iter 15 Clusters A-E + Explorer coverage (live bash 5.2 verified)
        ("w3m2b_i15_b1_bang_bang_time_pos.sh", "! ! time 2>/dev/null A=\"${}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i15_b2_bang_bang_assign_pos.sh", "! ! A=\"${}\" \"$(source ./helpers.sh; do_work)\" \"${!!}\"\n", true, true, 1),
        ("w3m2b_i15_b3_bang_bang_brace_pipe_pos.sh", "source ./helpers.sh\n! ! { { echo \"${}\"; }; } | cat && do_work\n", true, true, 2),
        ("w3m2b_i15_b4_bang_brace_pipe_false_pos.sh", "source ./helpers.sh\n! { { echo \"${}\"; }; } | false && do_work\n", true, true, 2),
        ("w3m2b_i15_b5_bang_bang_brace_semi_neg.sh", "source ./helpers.sh\n! ! { { echo \"${}\"; }; }; do_work\n", true, false, 0),
        ("w3m2b_i15_b6_bang_bang_brace_or_neg.sh", "source ./helpers.sh\n! ! { { echo \"${}\"; }; } || do_work\n", true, false, 0),
        ("w3m2b_i15_c1_time_brace_ml_or_neg.sh", "source ./helpers.sh\ntime {\necho \"${}\"\n} || do_work\n", true, false, 0),
        ("w3m2b_i15_c2_time_brace_ml_and_neg.sh", "source ./helpers.sh\ntime {\necho \"${}\"\n} && do_work\n", true, false, 0),
        ("w3m2b_i15_c3_time_brace_ml_semi_neg.sh", "source ./helpers.sh\ntime {\necho \"${}\"\n}; do_work\n", true, false, 0),
        ("w3m2b_i15_c4_time_brace_ml_nl_pos.sh", "source ./helpers.sh\ntime {\necho \"${}\"\n}\ndo_work\n", true, true, 5),
        ("w3m2b_i15_c5_time_brace_1l_semi_neg.sh", "source ./helpers.sh\ntime { echo \"${}\"; }; do_work\n", true, false, 0),
        ("w3m2b_i15_c6_time_brace_1l_pipe_and_pos.sh", "source ./helpers.sh\ntime { echo \"${}\"; } | cat && do_work\n", true, true, 2),
        ("w3m2b_i15_c7_time_brace_1l_pipe_false_pos.sh", "source ./helpers.sh\ntime { echo \"${}\"; } | false || do_work\n", true, true, 2),
        ("w3m2b_i15_c8_bang_brace_redir_pipe_or_pos.sh", "source ./helpers.sh\n! { echo \"${}\" >/dev/null; } | cat || do_work\n", true, true, 2),
        ("w3m2b_i15_c9_bang_brace_redir_pipe_semi_pos.sh", "source ./helpers.sh\n! { echo \"${}\" >/dev/null; } | cat; do_work\n", true, true, 2),
        ("w3m2b_i15_c10_split_bang_brace_ml_and_neg.sh", "source ./helpers.sh\n! { echo \"${}\"\n} && do_work\n", true, false, 0),
        ("w3m2b_i15_c11_split_bang_brace_ml_or_neg.sh", "source ./helpers.sh\n! { echo \"${}\"\n} || do_work\n", true, false, 0),
        ("w3m2b_i15_c12_split_bang_brace_ml_nl_pos.sh", "source ./helpers.sh\n! { echo \"${}\"\n}\ndo_work\n", true, true, 4),
        ("w3m2b_i15_c13_time_brace_hd_or_pos.sh", "source ./helpers.sh\ntime { cat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, true, 5),
        ("w3m2b_i15_c13_r5_time_brace_hd_or_pos.sh", "time { cat <<EOF >/dev/null\n${}\nEOF\n} || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i15_c14_time_brace_hd_and_neg.sh", "source ./helpers.sh\ntime { cat <<EOF >/dev/null\n${}\nEOF\n} && do_work\n", true, false, 0),
        ("w3m2b_i15_c14_r5_time_brace_hd_and_neg.sh", "time { cat <<EOF >/dev/null\n${}\nEOF\n} && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i15_c15_bang_time_brace_hd_and_pos.sh", "source ./helpers.sh\n! time { cat <<EOF >/dev/null\n${}\nEOF\n} && do_work\n", true, true, 5),
        ("w3m2b_i15_c16_bang_time_brace_hd_or_neg.sh", "source ./helpers.sh\n! time { cat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, false, 0),
        ("w3m2b_i15_c17_time_brace_ml_hd_and_neg.sh", "source ./helpers.sh\ntime {\ncat <<EOF >/dev/null\n${}\nEOF\n} && do_work\n", true, false, 0),
        ("w3m2b_i15_c18_time_brace_ml_hd_or_pos.sh", "source ./helpers.sh\ntime {\ncat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, true, 6),
        ("w3m2b_i15_d1_bare_bt_and_neg.sh", "source ./helpers.sh\n`echo \"${}\"` && do_work\n", true, false, 0),
        ("w3m2b_i15_d2_bare_bt_or_pos.sh", "source ./helpers.sh\n`echo \"${}\"` || do_work\n", true, true, 2),
        ("w3m2b_i15_d3_bare_bt_bang_or_neg.sh", "source ./helpers.sh\n! `echo \"${}\"` || do_work\n", true, false, 0),
        ("w3m2b_i15_d4_bare_bt_semi_and_neg.sh", "source ./helpers.sh\n`echo ok; echo \"${}\"` && do_work\n", true, false, 0),
        ("w3m2b_i15_d5_bang_v_bt_semi_and_pos.sh", "source ./helpers.sh\n! v=`echo ok; echo \"${}\"` && do_work\n", true, true, 2),
        ("w3m2b_i15_d6_bang_v_bt_semi_or_neg.sh", "source ./helpers.sh\n! v=`echo ok; echo \"${}\"` || do_work\n", true, false, 0),
        ("w3m2b_i15_d7_bt_d2_x_hd_and_neg.sh", "source ./helpers.sh\nx=`\\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` && do_work\n", true, false, 0),
        ("w3m2b_i15_d7b_bt_d2_x_hd_or_pos.sh", "source ./helpers.sh\nx=`\\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` || do_work\n", true, true, 5),
        ("w3m2b_i15_d8_bt_d2_bare_hd_and_neg.sh", "source ./helpers.sh\n`true; \\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` && do_work\n", true, false, 0),
        ("w3m2b_i15_d8b_bt_d2_bare_hd_or_pos.sh", "source ./helpers.sh\n`true; \\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` || do_work\n", true, true, 5),
        ("w3m2b_i15_d9_bt_d2_bang_x_hd_or_neg.sh", "source ./helpers.sh\n! x=`true; \\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` || do_work\n", true, false, 0),
        ("w3m2b_i15_d9b_bt_d2_bang_x_hd_and_pos.sh", "source ./helpers.sh\n! x=`true; \\`cat <<EOF >/dev/null\n\\${}\nEOF\n\\`` && do_work\n", true, true, 5),
        ("w3m2b_i15_d10_redir_sub_asg_cmd_neg.sh", "source ./helpers.sh\n2>\"${}\" A[0]+=\"${}\" do_work\n", true, false, 0),
        ("w3m2b_i15_d11_fd0_redir_asg_or_pos.sh", "source ./helpers.sh\n0<\"${}\" A[0]=$(echo r1) || do_work\n", true, true, 2),
        ("w3m2b_i15_d11_r5_fd0_redir_asg_or_pos.sh", "0<\"${}\" A[0]=$(echo r1) || $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i15_d12_fd0_redir_asg_semi_pos.sh", "source ./helpers.sh\n0<\"${}\" A[0]=$(echo r1); do_work\n", true, true, 2),
        ("w3m2b_i15_d13_fd0_redir_asg_and_neg.sh", "source ./helpers.sh\n0<\"${}\" A[0]=$(echo r1) && do_work\n", true, false, 0),
        ("w3m2b_i15_d14_time_fd0_redir_asg_or_pos.sh", "source ./helpers.sh\ntime 0<\"${}\" A[0]=$(echo r1) || do_work\n", true, true, 2),
        ("w3m2b_i15_d16_case_bt_hd_and_neg.sh", "source ./helpers.sh\ncase a in a) x=`cat <<EOF >/dev/null\n${}\nEOF\n`;; esac && do_work\n", true, false, 0),
        ("w3m2b_i15_d17_case_bt_hd_or_pos.sh", "source ./helpers.sh\ncase a in a) x=`cat <<EOF >/dev/null\n${}\nEOF\n`;; esac || do_work\n", true, true, 5),
        ("w3m2b_i15_d18_fd0_sub_asg_echo_neg.sh", "source ./helpers.sh\n0<\"${}\" A[0]+=\"${}\" echo hi; do_work\n", true, false, 0),
        ("w3m2b_i15_d18_r5_fd0_sub_asg_echo_neg.sh", "0<\"${}\" A[0]+=\"${}\" echo hi; $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i15_d19_fd0_sub_asg_semi_neg.sh", "source ./helpers.sh\n0<\"${}\" A[0]+=\"${}\"; do_work\n", true, false, 0),
        ("w3m2b_i15_e1_brace_case_hd_next_arm_and_neg.sh", "source ./helpers.sh\n{ case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; b) echo ok;; esac; } && do_work\n", true, false, 0),
        ("w3m2b_i15_e2_brace_case_hd_next_arm_or_pos.sh", "source ./helpers.sh\n{ case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; b) echo ok;; esac; } || do_work\n", true, true, 5),
        ("w3m2b_i15_e5_bang_subshell_bang_hd_and_pos.sh", "source ./helpers.sh\n! ( ! cat <<EOF >/dev/null\n${}\nEOF\n ) && do_work\n", true, true, 5),
        ("w3m2b_i15_e6_bang_subshell_bang_hd_or_neg.sh", "source ./helpers.sh\n! ( ! cat <<EOF >/dev/null\n${}\nEOF\n ) || do_work\n", true, false, 0),
        ("w3m2b_i15_e7_bang_subshell_true_bang_hd_and_neg.sh", "source ./helpers.sh\n! ( true; ! cat <<EOF >/dev/null\n${}\nEOF\n ) && do_work\n", true, false, 0),
        ("w3m2b_i15_e8_bang_subshell_bang_echo_neg.sh", "source ./helpers.sh\n! ( ! echo \"${}\" ) && do_work\n", true, false, 0),
        ("w3m2b_i15_e8b_bang_subshell_bang_echo_or_pos.sh", "source ./helpers.sh\n! ( ! echo \"${}\" ) || do_work\n", true, true, 2),
        ("w3m2b_i15_x1_if_subshell_hd_then_pos.sh", "source ./helpers.sh\nif (cat <<EOF >/dev/null\n${}\nEOF\n); then echo no; else do_work; fi\n", true, true, 5),
        ("w3m2b_i15_x2_if_subshell_bad_sub_fi_pos.sh", "source ./helpers.sh\nif (echo \"${!!}\"); then echo no; else echo no2; fi; do_work\n", true, true, 2),
        ("w3m2b_i15_x3_case_fallthrough_hd_neg.sh", "source ./helpers.sh\ncase a in a) cat <<EOF >/dev/null\n${}\nEOF\n;;& b) echo ok;; esac && do_work\n", true, false, 0),
        // Iter 16 paired regressions (Explorer A, B, C): time/brace/pipe, subshell !, ! ! bt, cmdsub ! hd, if/while/until, dq bt, redir/assign
        ("w3m2b_i16_a_time_bang_brace_hd_and_pos.sh", "source ./helpers.sh\ntime ! { cat <<EOF >/dev/null\n${}\nEOF\n} && do_work\n", true, true, 5),
        ("w3m2b_i16_a_r5_time_bang_brace_hd_and_pos.sh", "time ! { cat <<EOF >/dev/null\n${}\nEOF\n} && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_bang_brace_hd_or_neg.sh", "source ./helpers.sh\ntime ! { cat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_time_bang_brace_hd_or_neg.sh", "time ! { cat <<EOF >/dev/null\n${}\nEOF\n} || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_time_p_bang_brace_hd_or_neg.sh", "source ./helpers.sh\ntime -p ! { cat <<EOF >/dev/null\n${}\nEOF\n} || do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_time_dd_bang_brace_hd_and_pos.sh", "time -- ! { cat <<EOF >/dev/null\n${}\nEOF\n} && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_bang_time_bang_brace_hd_and_neg.sh", "source ./helpers.sh\n! time ! { cat <<EOF >/dev/null\n${}\nEOF\n} && do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_bang_time_bang_brace_hd_or_pos.sh", "! time ! { cat <<EOF >/dev/null\n${}\nEOF\n} || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_brace_pipe_cat_and_pos.sh", "source ./helpers.sh\ntime { echo \"${}\"; } | cat && do_work\n", true, true, 2),
        ("w3m2b_i16_a_r5_time_brace_pipe_cat_and_pos.sh", "time { echo \"${}\"; } | cat && $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_a_time_brace_ml_pipe_false_or_pos.sh", "source ./helpers.sh\ntime {\necho \"${}\"\n} | false || do_work\n", true, true, 4),
        ("w3m2b_i16_a_r5_time_brace_ml_pipe_false_or_pos.sh", "time {\necho \"${}\"\n} | false || $(source ./helpers.sh; do_work)\n", true, true, 3),
        ("w3m2b_i16_a_bang_brace_ml_pipe_cat_and_pos.sh", "source ./helpers.sh\n! {\necho \"${}\"\n} | cat && do_work\n", true, true, 4),
        ("w3m2b_i16_a_r5_bang_brace_ml_pipe_cat_and_pos.sh", "! {\necho \"${}\"\n} | cat && $(source ./helpers.sh; do_work)\n", true, true, 3),
        ("w3m2b_i16_a_bang_time_brace_pipe_badsub_or_neg.sh", "source ./helpers.sh\n! time { echo \"${}\"; } | echo \"${}\" || do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_time_bang_brace_pipe_badsub_or_neg.sh", "time ! { echo \"${}\"; } | echo \"${}\" || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_sub_bang_echo_semi_pos.sh", "source ./helpers.sh\n( ! echo \"${}\" ); do_work\n", true, true, 2),
        ("w3m2b_i16_b_r5_sub_bang_echo_and_pos.sh", "( ! echo \"${}\" ) && $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_b_r5_sub_bang_echo_or_neg.sh", "( ! echo \"${}\" ) || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_sub_bang_brace_echo_and_pos.sh", "source ./helpers.sh\n( ! { echo \"${}\"; } ) && do_work\n", true, true, 2),
        ("w3m2b_i16_b_r5_sub_bang_brace_echo_and_pos.sh", "( ! { echo \"${}\"; } ) && $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_b_r5_sub_bang_brace_echo_or_neg.sh", "( ! { echo \"${}\"; } ) || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_bang_sub_bang_brace_echo_and_neg.sh", "source ./helpers.sh\n! ( ! { echo \"${}\"; } ) && do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_bang_sub_bang_brace_echo_and_neg.sh", "! ( ! { echo \"${}\"; } ) && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_sub_bang_brace_hd_and_neg.sh", "source ./helpers.sh\n( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) && do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_sub_bang_brace_hd_and_neg.sh", "( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_sub_bang_brace_hd_or_pos.sh", "source ./helpers.sh\n( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) || do_work\n", true, true, 5),
        ("w3m2b_i16_b_r5_sub_bang_brace_hd_or_pos.sh", "( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_b_bang_sub_bang_brace_hd_and_pos.sh", "source ./helpers.sh\n! ( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) && do_work\n", true, true, 5),
        ("w3m2b_i16_b_r5_bang_sub_bang_brace_hd_and_pos.sh", "! ( ! { cat <<EOF >/dev/null\n${}\nEOF\n} ) && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_b_sub_bang_time_brace_hd_or_pos.sh", "source ./helpers.sh\n( ! time { cat <<EOF >/dev/null\n${}\nEOF\n} ) || do_work\n", true, true, 5),
        ("w3m2b_i16_b_r5_sub_bang_time_brace_hd_or_pos.sh", "( ! time { cat <<EOF >/dev/null\n${}\nEOF\n} ) || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_b_bang_bang_bt_or_pos.sh", "source ./helpers.sh\n! ! `echo \"${}\"` || do_work\n", true, true, 2),
        ("w3m2b_i16_b_r5_bang_bang_bt_or_pos.sh", "! ! `echo \"${}\"` || $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_b_r5_bang_bang_assign_bt_and_neg.sh", "! ! v=`echo \"${}\"` && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_r5_bang_bang_time_bt_and_neg.sh", "! ! time `echo \"${}\"` && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_assign_cmdsub_bang_hd_and_pos.sh", "source ./helpers.sh\nv=$(! cat <<EOF >/dev/null\n${}\nEOF\n) && do_work\n", true, true, 5),
        ("w3m2b_i16_b_r5_assign_cmdsub_bang_hd_and_pos.sh", "v=$(! cat <<EOF >/dev/null\n${}\nEOF\n) && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_b_r5_bang_assign_cmdsub_bang_hd_or_pos.sh", "! v=$(! cat <<EOF >/dev/null\n${}\nEOF\n) || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_b_r5_assign_cmdsub_bang_hd_or_neg.sh", "v=$(! cat <<EOF >/dev/null\n${}\nEOF\n) || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_bang_if_bang_and_neg.sh", "source ./helpers.sh\n! if ! echo \"${}\"; then :; fi && do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_bang_if_bang_and_neg.sh", "! if ! echo \"${}\"; then :; fi && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_bang_if_sub_and_neg.sh", "source ./helpers.sh\n! if ( echo \"${}\" ); then :; fi && do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_bang_if_sub_and_neg.sh", "! if ( echo \"${}\" ); then :; fi && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_while_sub_or_neg.sh", "source ./helpers.sh\nwhile ( echo \"${}\" ); do :; done || do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_while_sub_or_neg.sh", "while ( echo \"${}\" ); do :; done || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_bang_dq_bt_or_neg.sh", "source ./helpers.sh\n! \"`echo \"${}\"`\" || do_work\n", true, false, 0),
        ("w3m2b_i16_b_r5_bang_dq_bt_or_neg.sh", "! \"`echo \"${}\"`\" || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_b_dq_lit_bt_pos.sh", "source ./helpers.sh\n! \"true`echo \"${}\"`\" || do_work\n", true, true, 2),
        ("w3m2b_i16_b_r5_dq_lit_bt_pos.sh", "! \"true`echo \"${}\"`\" || $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_pos_ok_brace_and.sh", "source ./helpers.sh\ntime ! { echo \"${X:-ok}\"; } || do_work\n", true, true, 2),
        ("w3m2b_i16_pos_ok_sub_bang_hd.sh", "source ./helpers.sh\n( ! { cat <<EOF >/dev/null\n${X:-ok}\nEOF\n} ) && do_work\n", true, true, 5),
        ("w3m2b_i16_c_fd0_lhs_sub_cmd_pos.sh", "source ./helpers.sh\n0<\"${}\" A[${}]=\"ok\" echo hi; do_work\n", true, false, 0),
        ("w3m2b_i16_c_r5_fd0_lhs_sub_cmd_pos.sh", "0<\"${}\" A[${}]=\"ok\" echo hi; $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_c_fd0_lhs_0_pos.sh", "source ./helpers.sh\n0<\"${}\" A[0]=\"ok\"; do_work\n", true, true, 2),
        ("w3m2b_i16_c_r5_fd0_lhs_rhs_cmdsub_pos.sh", "0<\"${}\" A[${}]=\"$(source ./helpers.sh; do_work)\"\n", true, true, 1),
    ];

    let raw_cases: &[(&str, &str, bool, bool, usize)] = &[
        // Differential probe catches: ClosedBadSub error recovery inside backtick & ParamHdr prefix special cases
        ("w3m2b_i12_diff_bt_hash_foo_r5.sh", "x=`echo \"${#foo:-x}\" $(source ./helpers.sh; do_work)`\n", false, false, 0),
        ("w3m2b_i12_diff_bt_hash_foo_pre.sh", "source ./helpers.sh\nx=`echo \"${#foo:-x}\" $(do_work)`\n", true, false, 0),
        ("w3m2b_i12_diff_hash_q_colon_ok.sh", "echo \"${#?:-x}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i12_diff_hash_dash_colon_ok.sh", "echo \"${#-:-x}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i12_diff_bang_bang_bad.sh", "source ./helpers.sh\necho \"${!!}\" $(do_work)\n", true, false, 0),
        ("w3m2b_i12_diff_hash_bang_colon_bad.sh", "echo \"${#!:-x}\" $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_dq_dollar_lit_nl_param_sq_dq.sh", "source ./helpers.sh\nx=\"$\n${FOO:-'\"'}\"\ndo_work\n", true, true, 4),
        ("w3m2b_bt1_dqhd_1bs_eol.sh", "source ./helpers.sh\nx=`cat <<\"INNER\"\nfoo\\\nINNER\ndo_work\nINNER\n`\n", true, false, 0),
        ("w3m2b_multi_pending_hd_cont.sh", "source ./helpers.sh\ncat <<A >/dev/null; cat <<B >/dev/null\nfoo\\\nA\ndo_work\nA\nbar\nB\n", true, false, 0),
        ("w3m2b_bt1_multi_pending_hd_cont.sh", "source ./helpers.sh\nx=`cat <<A; cat <<B\nfoo\\\\\nA\ndo_work\nA\nbar\nB\n`\n", true, false, 0),
        ("w3m2b_single_sq_1bs_empty.sh", "cat <<'INNER' >/dev/null\n\\\nINNER\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_single_dq_1bs_empty.sh", "cat <<\"INNER\" >/dev/null\n\\\nINNER\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_single_bs_1bs_empty.sh", "cat <<\\INNER >/dev/null\n\\\nINNER\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_t_lt2_split_delim.sh", "source ./helpers.sh\ncat <<EO\\\nF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_t_lt2_split_delim_after.sh", "cat <<EO\\\nF >/dev/null\nbody\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_t_lt2_split_dash_delim.sh", "source ./helpers.sh\ncat <<-EO\\\nF >/dev/null\n\tdo_work\n\tEOF\n", true, false, 0),
        // Iter 4 Bug 1, 3, 4 raw_cases (bash -n valid, FirewallVerdict::Invalid due to tree-sitter-bash)
        ("w3m2b_b1_unq_extra.sh", "cat <<INNER >/dev/null\nINNER_extra\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b1_unq_utf8.sh", "cat <<INNER >/dev/null\nINNER🚀\nsource ./helpers.sh\ndo_work\nINNER\n", false, false, 0),
        ("w3m2b_b3_sq_split.sh", "source ./helpers.sh\ncat <<'EO'\\\nF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_dq_split.sh", "source ./helpers.sh\ncat <<\"EO\"\\\nF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_midq_split.sh", "source ./helpers.sh\ncat <<E'O'\\\nF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_bschar_split.sh", "source ./helpers.sh\ncat <<EO\\a\\\nF >/dev/null\ndo_work\nEOaF\n", true, false, 0),
        ("w3m2b_b3_bslead_split.sh", "source ./helpers.sh\ncat <<\\E\\\nOF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_bsmid_split.sh", "source ./helpers.sh\ncat <<E\\O\\\nF >/dev/null\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_hash_split.sh", "source ./helpers.sh\ncat <<EO#\\\nF >/dev/null\ndo_work\nEO#F\n", true, false, 0),
        ("w3m2b_b3_dollar_split.sh", "source ./helpers.sh\ncat <<EO$\\\nF >/dev/null\ndo_work\nEO$F\n", true, false, 0),
        ("w3m2b_b3_dollar_only_split.sh", "source ./helpers.sh\ncat <<$\\\nF >/dev/null\ndo_work\n$F\n", true, false, 0),
        ("w3m2b_b3_sq_nl_delim.sh", "source ./helpers.sh\ncat <<'EO\\\nF'\ndo_work\nEO\\\nF\n", true, false, 0),
        ("w3m2b_b3_sq_nl_delim_cmd.sh", "cat <<'EO\\\nF' $(source ./helpers.sh; do_work)\ninside\n", true, true, 2),
        ("w3m2b_b3_dq_cont_delim.sh", "source ./helpers.sh\ncat <<\"EO\\\nF\"\ndo_work\nEOF\n", true, false, 0),
        ("w3m2b_b3_dq_lt_in_dq.sh", "source ./helpers.sh\ncat <<EO\"<<\"\\\nF >/dev/null\ndo_work\nEO<<F\n", true, false, 0),
        ("w3m2b_b3_sq_split_after.sh", "cat <<'EO'\\\nF >/dev/null\nbody\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_b4_comp_sq.sh", "cat <<EO\\\n'F'\nfoo\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_b4_comp_mid.sh", "cat <<E'O'\\\nF\nfoo\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_b4_comp_dq.sh", "cat <<EO\"F\"\nfoo\nEOF\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_b4_q_bs.sh", "cat <<'A\\B'\nfoo\nA\\B\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_b4_q_bs_1bs.sh", "cat <<'A\\B'\n\\\nA\\B\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_b4_two_hd.sh", "cat <<A >/dev/null <<EO\\\nF\nbodyA\nA\nsource ./helpers.sh\ndo_work\nEOF\n", false, false, 0),
        ("w3m2b_b4_two_hd_after.sh", "cat <<A >/dev/null <<EO\\\nF\nbodyA\nA\nbodyEOF\nEOF\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_b4_two_hd_sub.sh", "cat <<A >/dev/null <<EO\\\nF\n$(source ./helpers.sh; do_work)\nA\nbodyEOF\nEOF\n", true, true, 3),
        ("w3m2b_b4_two_cmd_semi.sh", "cat <<A >/dev/null; cat <<B\nbodyA\nA\n$(source ./helpers.sh; do_work)\nB\n", true, true, 4),
        ("w3m2b_b4_two_hd_pipe.sh", "cat <<A | cat <<B\nbodyA\nA\nbodyB\nB\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_b4_nested_unbal.sh", "cat <<OUTER >/dev/null\n$(cat <<'INNER'\n INNER\n'\nINNER\n)\n$(source ./helpers.sh; do_work)\nOUTER\n", true, true, 7),
        ("w3m2b_b4_hd_empty.sh", "cat <<''\nfoo\n\nsource ./helpers.sh; do_work\n", true, true, 4),
        // Iter 5 Finding 2: Backslash-escaped split delimiters preserve quoted=true & bt \'
        ("w3m2b_i5_bslead_split_sub.sh", "source ./helpers.sh\ncat <<\\E\\\nOF >/dev/null\n$(do_work)\nEOF\n", true, false, 0),
        ("w3m2b_i5_bsmid_split_sub.sh", "source ./helpers.sh\ncat <<E\\O\\\nF >/dev/null\n$(do_work)\nEOF\n", true, false, 0),
        ("w3m2b_i5_bschar_split_sub.sh", "source ./helpers.sh\ncat <<EO\\a\\\nF >/dev/null\n$(do_work)\nEOaF\n", true, false, 0),
        ("w3m2b_i5_bt1_bslead_split_sub.sh", "source ./helpers.sh\nx=`cat <<\\E\\\nOF >/dev/null\n$(do_work)\nEOF\n`\n", true, false, 0),
        ("w3m2b_i5_bt1_bsmid_split_sub.sh", "source ./helpers.sh\nx=`cat <<E\\O\\\nF >/dev/null\n$(do_work)\nEOF\n`\n", true, false, 0),
        ("w3m2b_i5_bt2_bslead_split_sub.sh", "source ./helpers.sh\nx=`echo \\`cat <<\\E\\\\\nOF >/dev/null\n$(do_work)\nEOF\n\\``\n", true, false, 0),
        ("w3m2b_i5_bt1_esc_sq_cont.sh", "x=`cat <<\\'EO\\'\\\nF >/dev/null\n$(source ./helpers.sh; do_work)\n'EO'F\n`\n", false, false, 0),
        // Iter 5 Finding 3: Attached/split $(...) & `...` in or after heredoc delimiters
        ("w3m2b_i5_dq_nl_sub.sh", "source ./helpers.sh\ncat <<\"EO\n$(do_work)\"\nbody\n", true, false, 0),
        ("w3m2b_i5_dq_cmdsub_cont.sh", "source ./helpers.sh\ncat <<\"EO$(echo x)\\\nF\" >/dev/null\ndo_work\nEO$(echo x)F\n", true, false, 0),
        ("w3m2b_i5_dq_bt_cont.sh", "source ./helpers.sh\ncat <<\"EO`echo x`\\\nF\" >/dev/null\ndo_work\nEO`echo x`F\n", true, false, 0),
        ("w3m2b_i5_sq_nl_dq_sub.sh", "cat <<'EO\nF'\"$(source ./helpers.sh; do_work)\" >/dev/null\ninside\n", false, false, 0),
        ("w3m2b_i5_sq_cont_sub_att.sh", "cat <<'EO\\\nF'$(source ./helpers.sh; do_work)\ninside\nEO\\\nF$(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i5_dq_nl_sub_att.sh", "cat <<\"EO\nF\"$(source ./helpers.sh; do_work)\ninside\n", false, false, 0),
        ("w3m2b_i5_unq_cmdsub_delim.sh", "cat <<EO$(source ./helpers.sh; do_work) >/dev/null\nhello\nEO$(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i5_sq_cmdsub_delim.sh", "cat <<'EO'$(source ./helpers.sh; do_work) >/dev/null\nhello\nEO$(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i5_dq_cont_cmdsub.sh", "cat <<\"EO\\\n$(source ./helpers.sh; do_work)\" >/dev/null\nhello\nEO$(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i5_unq_param_delim.sh", "cat <<EO${FOO:-$(source ./helpers.sh; do_work)} >/dev/null\nhello\nEO${FOO:-$(source ./helpers.sh; do_work)}\n", false, false, 0),
        // Iter 5 Finding 4: coalesce_bash_continuations split-heredoc carry (EOF\ + EOF)
        ("w3m2b_i5_split_dq_bs_body.sh", "cat <<\"EO\"\\\nF >/dev/null\nEOF\\\nEOF\nsource ./helpers.sh\ndo_work\n", true, true, 6),
        ("w3m2b_i5_split_sq_bs_body.sh", "cat <<'EO'\\\nF >/dev/null\nEOF\\\nEOF\nsource ./helpers.sh\ndo_work\n", true, true, 6),
        ("w3m2b_i5_split_midq_bs_body.sh", "cat <<E'O'\\\nF >/dev/null\nEOF\\\nEOF\nsource ./helpers.sh\ndo_work\n", true, true, 6),
        ("w3m2b_i5_split_dash_dq_bs_body.sh", "cat <<-\"EO\"\\\nF >/dev/null\n\tEOF\\\n\tEOF\nsource ./helpers.sh\ndo_work\n", true, true, 6),
        ("w3m2b_i5_split_bslead_bs_body.sh", "cat <<\\E\\\nOF >/dev/null\nEOF\\\nEOF\nsource ./helpers.sh\ndo_work\n", true, true, 6),
        // Iter 5 Finding 5: Backtick bt_depth > 0 sq \<nl> & recover_bash_heredoc_impl
        ("w3m2b_i5_bt_sq_cont_after.sh", "x=`cat <<'EO\\\nF'\nhi\nEOF\nsource ./helpers.sh\ndo_work`\n", true, true, 6),
        ("w3m2b_i5_bt_unq_split_unbal.sh", "x=`cat <<EO\\\nF >/dev/null\n'unbalanced\nEOF\n`\nsource ./helpers.sh\ndo_work\n", true, true, 7),
        ("w3m2b_i5_bt_dash_sq_split_unbal.sh", "x=`cat <<-'EO\\\nF' >/dev/null\n'unbalanced\nEO\\\nF\n`\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i5_bt_multi_hd_unbal.sh", "x=`cat <<A >/dev/null; cat <<B >/dev/null\n'unbalA\nA\n'unbalB\nB\n`\nsource ./helpers.sh\ndo_work\n", true, true, 8),
        // Iter 5 Finding 6: Header-line ) / while ...; do & ansi_sq_in_bt_hd
        ("w3m2b_i5_cmdsub_same_line.sh", "x=$(cat <<EOF)\nhi\nEOF\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i5_wrap_paren.sh", "(cat <<EOF >/dev/null) && { source ./helpers.sh; do_work; }\nhi\nEOF\n", true, true, 1),
        ("w3m2b_i5_wrap_while.sh", "while read -r l <<EOF; do source ./helpers.sh; do_work; break; done\nhi\nEOF\n", true, true, 1),
        ("w3m2b_i5_ansi_sq_in_bt_hd.sh", "x=`cat <<EOF\n$'abc\\'\n'\nEOF\nsource ./helpers.sh\ndo_work`\n", true, true, 6),
        // Iter 6: Multiline/nested $(...) in delim, $'...' / $"..." delims, dq param/bt unquoting, split $(...)/$((...))/"${...}"
        ("w3m2b_i6_c1_bt1_dq_nl_sub.sh", "x=`cat <<\"EO\n$(echo hi)\" >/dev/null\nbody\n`\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i6_c5_top_dq_nl_sub_same_line.sh", "cat <<\"EO\n$(echo hi)\" >/dev/null; source ./helpers.sh; do_work\nbody\n", true, true, 2),
        ("w3m2b_i6_c6_bt1_dq_nl_param_sub.sh", "x=`cat <<\"EO\n${FOO:-$(echo hi)}\" >/dev/null\nbody\n`\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i6_ml_sq_sub_nl.sh", "cat <<'EO'$(source ./helpers.sh; echo \"<<\nb\") >/dev/null\ninside\n", false, false, 0),
        ("w3m2b_i6_comp_sq_then_hd_sub_src.sh", "cat <<'EO'$(cat <<INNER\n$(source ./helpers.sh; do_work)\nINNER\n) >/dev/null\ninside\n", false, false, 0),
        ("w3m2b_i6_comp_dq_then_hd_sub_src.sh", "cat <<\"EO\"$(cat <<INNER\n$(source ./helpers.sh; do_work)\nINNER\n) >/dev/null\ninside\n", false, false, 0),
        ("w3m2b_i6_unq_then_hd_sub_src.sh", "cat <<EO$(cat <<INNER\n$(source ./helpers.sh; do_work)\nINNER\n) >/dev/null\ninside\n", false, false, 0),
        ("w3m2b_i6_dq_param_dq_after.sh", "source ./helpers.sh\ncat <<\"EO${X:-\"hi\"}\" >/dev/null\nbody\nEO${X:-hi}\ndo_work\n", true, true, 5),
        ("w3m2b_i6_dq_param_dq_after_lit.sh", "source ./helpers.sh\ncat <<\"EO${X:-\"hi\"}\" >/dev/null\nbody\nEO${X:-\"hi\"}\ndo_work\n", true, false, 0),
        ("w3m2b_i6_dq_bt_dq_after.sh", "source ./helpers.sh\ncat <<\"EO`echo \\\"hi\\\"`\" >/dev/null\nbody\nEO`echo \"hi\"`\ndo_work\n", true, true, 5),
        ("w3m2b_i6_dq_bt_dq_after2.sh", "source ./helpers.sh\ncat <<\"EO`echo \\\"hi\\\"`\" >/dev/null\nbody\nEO`echo \\\"hi\\\"`\ndo_work\n", true, false, 0),
        ("w3m2b_i6_ansisq_eo.sh", "cat <<$'EO' >/dev/null\n$(source ./helpers.sh; do_work)\nEO\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i6_ansisq_do_work.sh", "cat <<$'do_work' >/dev/null\nbody\ndo_work\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i6_locdq_do_work.sh", "cat <<$\"do_work\" >/dev/null\nbody\ndo_work\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i6_ansisq_hex.sh", "cat <<$'EO\\x41' >/dev/null\n$(source ./helpers.sh; do_work)\nEOA\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i6_ansisq_split.sh", "cat <<$'EO'\\\nF >/dev/null\nEOF\\\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i6_ansisq_esc_sq.sh", "cat <<$'E\\'O' >/dev/null\n$(source ./helpers.sh; do_work)\nE'O\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i6_unq_split_sub_lit.sh", "source ./helpers.sh\ncat <<EO$(echo \\\nF) >/dev/null\ndo_work\nEO$(echo F)\n", true, false, 0),
        ("w3m2b_i6_dq_split_param_lit.sh", "source ./helpers.sh\ncat <<\"EO${FOO:-\\\nF}\" >/dev/null\ndo_work\nEO${FOO:-F}\n", true, false, 0),
        ("w3m2b_i6_ml_bs_a_sub.sh", "cat <<'EO\nF'\\a\"$(source ./helpers.sh)\" >/dev/null\nbody\n", false, false, 0),
        ("w3m2b_i6_bt1_dbl_bs_ltlt.sh", "x=`true \\\\<<'EOF'\nsource ./helpers.sh; do_work\nEOF\n`\n", true, true, 2),
        ("w3m2b_i6_bt1_delim_close_src.sh", "x=`cat <<EO\\`source ./helpers.sh; do_work\\` >/dev/null\nhello\nEO\\`source ./helpers.sh; do_work\\`\n`\n", false, false, 0),
        ("w3m2b_i6_bt1_delim_close_after.sh", "x=`cat <<EO\\`hi\\` >/dev/null\nhello\nEO\\`hi\\`\nsource ./helpers.sh\ndo_work`\n", true, true, 5),
        // Iter 7: multi-heredoc after ml delim, split delim close, UTF-8 non-ASCII delim, $'...' in "${...}"
        ("w3m2b_i7_dq_nl_then_second_hd_same_line_call.sh", "source ./helpers.sh\ncat <<\"EO\nF\" >/dev/null; cat <<SECOND >/dev/null\nbody1\nSECOND\ndo_work\n", true, false, 0),
        ("w3m2b_i7_dq_nl_nospace_second.sh", "source ./helpers.sh\ncat <<\"EO\nF\"<<SECOND >/dev/null\nbody1\nSECOND\ndo_work\n", true, false, 0),
        ("w3m2b_i7_sq_nl_then_sq_second.sh", "source ./helpers.sh\ncat <<'EO\nF' <<'SECOND' >/dev/null\nbody1\nSECOND\ndo_work\n", true, false, 0),
        ("w3m2b_i7_dq_nl_then_second_after.sh", "cat <<\"EO\nF\" <<SECOND >/dev/null\nbody1\nSECOND\nbody2\nsource ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i7_bt1_dq_nl_then_second_after.sh", "x=`cat <<\"EO\nF\" <<SECOND >/dev/null\nbody1\nSECOND\n`\nsource ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_i7_split_eo_f.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nbody\nEO\\\nF\ndo_work\n", true, true, 6),
        ("w3m2b_i7_dash_split_eo_f.sh", "source ./helpers.sh\ncat <<-EOF >/dev/null\n\tbody\n\tEO\\\nF\ndo_work\n", true, true, 6),
        ("w3m2b_i7_bt0_bs_then_eo_split.sh", "source ./helpers.sh\ncat <<EOF >/dev/null\nbody\n\\\nEO\\\nF\ndo_work\n", true, true, 7),
        ("w3m2b_i7_tail_bs_split_param_delim.sh", "source ./helpers.sh\ncat <<EO${FOO:-\\\nF} >/dev/null\nbody\nEO${FOO:-F}\\\n\ndo_work\n", true, true, 7),
        ("w3m2b_i7_bt1_unq_2bs_eol.sh", "x=`cat <<EOF >/dev/null\nbody\nEOF\\\\\n\nsource ./helpers.sh; do_work\n`\n", true, true, 5),
        ("w3m2b_i7_utf8_subshell.sh", "(cat <<EO_é >/dev/null\nhéllo 🚀\nEO_é\nsource ./helpers.sh)\n", true, false, 0),
        ("w3m2b_i7_utf8_dash_space.sh", "cat <<- EO_é >/dev/null\nhéllo 🚀\nEO_é\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i7_utf8_split_delim.sh", "x=$(cat <<EO_é\\\nF >/dev/null\nhéllo 🚀\nEO_éF\nsource ./helpers.sh\ndo_work)\n", true, true, 6),
        ("w3m2b_i7_dq_param_ansi_sq.sh", "cat <<\"EO${X:-$'a'}\" >/dev/null\n$(source ./helpers.sh; do_work)\nEO${X:-a}\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i7_dq_param_ansi_sq_hex.sh", "cat <<\"EO${X:-$'a\\x41'}\" >/dev/null\n$(source ./helpers.sh; do_work)\nEO${X:-aA}\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i7_dq_param_ansi_sq_esc.sh", "cat <<\"EO${X:-$'a\\'b'}\" >/dev/null\n$(source ./helpers.sh; do_work)\nEO${X:-a'b}\nsource ./helpers.sh\ndo_work\n", true, true, 5),
        ("w3m2b_i7_dq_param_ansi_sq_ml.sh", "cat <<\"EO${X:-$'a\\'\nF'}\" >/dev/null\n$(source ./helpers.sh; do_work)\nEO${X:-a'\nF}\nsource ./helpers.sh\ndo_work\n", false, false, 0),
        // Iter 8: surv>0 heredoc chains, nested bt1+qinner+2bs, \c+UTF-8, delim $'...' reset & inner dq
        ("w3m2b_i8_bt1_eof_3bs_nl_nl.sh", "x=`cat <<EOF >/dev/null\nbody\nEOF\\\\\\\n\n\nsource ./helpers.sh; do_work\n`\n", true, true, 6),
        ("w3m2b_i8_bt1_3bs_eo_f.sh", "x=`cat <<EOF >/dev/null\nbody\nEO\\\\\\\n\nF\nsource ./helpers.sh; do_work\n`\n", true, true, 6),
        ("w3m2b_i8_bt1_3bs_eo_3nl_f.sh", "x=`cat <<EOF >/dev/null\nbody\nEO\\\\\\\n\n\nF\nsource ./helpers.sh; do_work\n`\n", false, false, 0),
        ("w3m2b_i8_bt1_eof_3bs_1nl_bt_close.sh", "x=`cat <<EOF >/dev/null\nbody\nEOF\\\\\\\n`\n", false, false, 0),
        ("w3m2b_i8_bt2_eof_5bs_nl_nl.sh", "x=`echo \\`cat <<EOF >/dev/null\nbody\nEOF\\\\\\\\\\\n\n\n\nsource ./helpers.sh; do_work\n\\``\n", true, true, 7),
        ("w3m2b_i8_bt2_eof_6bs_nl_nl.sh", "x=`echo \\`cat <<EOF >/dev/null\nbody\nEOF\\\\\\\\\\\\\n\n\n\nsource ./helpers.sh; do_work\n\\``\n", true, true, 7),
        ("w3m2b_i8_bt1_eof_2bs_foo.sh", "x=`cat <<EOF >/dev/null\nbody\nEOF\\\\\nfoo\nEOF\n`\nsource ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i8_bt0_eof_1bs_foo.sh", "cat <<EOF >/dev/null\nEOF\\\nfoo\nEOF\nsource ./helpers.sh; do_work\n", true, true, 5),
        ("w3m2b_i8_nested_outer_bt1_qinner_2bs.sh", "x=`cat <<OUTER >/dev/null\n$(cat <<'INNER'\nbody\nINNER\\\\\n\n$(source ./helpers.sh; do_work)\n)\nOUTER\n`\n", true, true, 6),
        ("w3m2b_i8_ansisq_ctrl_utf8_e.sh", "cat <<$'\\cé'\nhi\n", false, false, 0),
        ("w3m2b_i8_ansisq_ctrl_utf8_nul.sh", "cat <<$'\\cअ'\nhi\n\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i8_delim_dq_bs_sq.sh", "cat <<\"EO${X:-$\\\\'a'}\"\n$(source ./helpers.sh; do_work)\nEO${X:-$\\'a'}\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i8_delim_dq_a_sq.sh", "cat <<\"EO${X:-$\\a'b'}\"\n$(source ./helpers.sh; do_work)\nEO${X:-$\\a'b'}\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i8_delim_dq_e_sq.sh", "cat <<\"EO${X:-$\\é'a'}\"\n$(source ./helpers.sh; do_work)\nEO${X:-$\\é'a'}\nsource ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i8_dq_param_inner_dq_ansi.sh", "cat <<\"EO${X:-\"$'a'\"}\" >/dev/null\n$(source ./helpers.sh; do_work)\nEO${X:-$a}\nsource ./helpers.sh; do_work\n", true, true, 4),
        // Iter 9 raw_cases: bt1/bt2 unclosed quotes, layer<=d backtick exit, fz_0235/0207, bt1_*_semi
        ("w3m2b_i9_valid_1026_no_bt_after.sh", ". ./helpers.sh\nx=`echo \"${X:-$'a\\'b'}`\nsource ./helpers.sh; do_work\n", true, true, 3),
        ("w3m2b_i9_unclosed_dq_in_bt1.sh", "x=`echo \"unclosed`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_unclosed_sq_in_bt1.sh", "x=`echo 'unclosed`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_unclosed_ansisq_in_bt1.sh", "x=`echo $'unclosed`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_q_bt1_unclosed_escdq.sh", "x=\"`echo \\\"unclosed`\"\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_bt2_unclosed_dq_close_bt1.sh", "x=`echo \\`echo \"unclosed`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_bt1_dq_2bs_bt.sh", "x=`echo \"unclosed\\\\`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_bt1_sq_2bs_bt.sh", "x=`echo 'unclosed\\\\`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_bt_src_unclosed_dq.sh", "x=`source \"unclosed`\nsource ./helpers.sh; do_work\n", true, true, 2),
        ("w3m2b_i9_split_bt_esc_dq.sh", "x=\"`echo \\\"` `source ./helpers.sh; do_work`\"\n", true, true, 1),
        ("w3m2b_i9_fz_0235_param_ansi_sq.sh", "x=`echo \"${FOO:-$'a'b'}\" ; source ./helpers.sh; do_work`\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i9_bt1_3bs_outside.sh", "x=`echo \"${X:-$'a\\\\\\'b'} $(source ./helpers.sh; do_work)\" ; echo ok`\n", false, false, 0),
        ("w3m2b_i9_bt1_2bs_semi.sh", "x=`echo \"${X:-$'a\\\\'b'}\" ; source ./helpers.sh; do_work`\n", false, false, 0),
        ("w3m2b_i9_bt1_1bs_semi.sh", "x=`echo \"${X:-$'a\\'b'}\" ; source ./helpers.sh; do_work`\n", false, false, 0),
        ("w3m2b_i9_fz_0207_unclosed_sq.sh", "x=`echo \"${FOO:-$'a\\\\\\\\'$(source ./helpers.sh; do_work)'}\" ; source ./helpers.sh; do_work`\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i9_bt0_sqinparam_then_bt.sh", "x=\"${X:-$'a\\'b'} `source ./helpers.sh; do_work`\"\n", false, false, 0),
        ("w3m2b_i9_u3_delim_unbal.sh", "cat <<\"EO${X:-\"a'b\"}${Y:-\"c\"}\" >/dev/null\nBODY\nEO${X:-ab\"}${Y:-\"c\"}\"\nsource ./helpers.sh; do_work\n", true, true, 4),
        // Iter 10 raw_cases: glued x=`...` early bt close, unclosed "/escdq in bt1, unclosed '/"/empty in unquoted heredoc
        ("w3m2b_i10_a_b3_glued_no_src.sh", "x=`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", false, false, 0),
        ("w3m2b_i10_a_b3_glued_with_src.sh", "source ./helpers.sh\nx=`echo \"${FOO:-$'a`do_work`'}\"`\n", true, false, 0),
        ("w3m2b_i10_a_b3_unglued_bt.sh", "`echo \"unclosed` source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i10_a_b3_unglued_param_bt.sh", "`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", true, true, 1),
        ("w3m2b_i10_a_b3_assign_space.sh", "x=`echo \"unclosed` source ./helpers.sh; do_work\n", true, true, 1),
        ("w3m2b_i10_a_b4_unclosed_dq.sh", "x=`source ./helpers.sh; do_work; echo \"unclosed`\n", false, false, 0),
        ("w3m2b_i10_a_b4_unclosed_escdq.sh", "x=\"`source ./helpers.sh; do_work; echo \\\"unclosed`\" ; do_work\n", false, false, 0),
        ("w3m2b_i10_b_s2_unq_1sq.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n${X:-'a}\nEOF\n", false, false, 0),
        ("w3m2b_i10_b_s2_unq_1dq.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n${X:-\"a}\nEOF\n", false, false, 0),
        ("w3m2b_i10_b_s2_unq_empty_param.sh", "cat <<EOF >/dev/null && source ./helpers.sh\n${}\nEOF\n", false, false, 0),
        ("w3m2b_i10_b_s1_15.sh", "source ./helpers.sh\nFOO=\"$(do_work)\" >\"$(echo \"${Y:-$'a\\'b'}\")\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_18.sh", "source ./helpers.sh\n>\"$(echo \"${Y:-$'a\\'b'}\")\" FOO=\"$(do_work)\"\n", true, true, 2),
        ("w3m2b_i10_b_s1_19.sh", "source ./helpers.sh\n>$(do_work; echo /dev/null) FOO=\"$(echo hi)\" BAR=\"${Y:-$'a\\'b'}\"\n", true, false, 0),
        ("w3m2b_i10_b_s1_19b.sh", "source ./helpers.sh\n>$(echo r; echo /dev/null) FOO=\"$(do_work)\" BAR=\"${Y:-$'a\\'b'}\"\n", true, true, 2),
        ("w3m2b_i10_b_s2_or_cmd.sh", "cat <<EOF >/dev/null || source ./helpers.sh\n${X:-$'a\\'b'}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_or_and.sh", "cat <<EOF >/dev/null || source ./helpers.sh && do_work\n${X:-$'a\\'b'}\nEOF\n", true, true, 1),
        ("w3m2b_i10_b_s2_and_or.sh", "cat <<EOF >/dev/null && echo X || source ./helpers.sh\n${X:-$'a\\'b'}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_and_semi.sh", "cat <<EOF >/dev/null && echo X; source ./helpers.sh; do_work\n${X:-$'a\\'b'}\nEOF\n", true, true, 1),
        ("w3m2b_i10_b_s2_and_pipe_and.sh", "cat <<EOF >/dev/null && echo a1 | cat && source ./helpers.sh\n${X:-$'a\\'b'}\nEOF\n", false, false, 0),
        ("w3m2b_i10_b_s2_pipe_cat_and.sh", "cat <<EOF >/dev/null | cat >/dev/null && source ./helpers.sh\n${X:-$'a\\'b'}\nEOF\n", true, false, 0),
        ("w3m2b_i10_b_s2_in_cmdsub_semi.sh", "x=$(cat <<EOF; echo ok\n${X:-$'a\\'b'}\nEOF\n) && source ./helpers.sh\n", true, false, 0),
        ("w3m2b_i10_b_s2_hd2_first_bad.sh", "cat <<EOF1 <<EOF2 >/dev/null && source ./helpers.sh\n${X:-$'a\\'b'}\nEOF1\nok\nEOF2\n", false, false, 0),
        // Iter 11 Explorer A Item 2 (m_layer < depth nested bt) & Item 3 (glued assign/concat)
        ("w3m2b_i11_a_b2_ansi_k5.sh", "echo \"${FOO:-$'a`echo \\`source ./helpers.sh; do_work \\\\\\\\\\` `'}\"\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b2_ansi_k6.sh", "echo \"${FOO:-$'a`echo \\`source ./helpers.sh; do_work \\\\\\\\\\\\` `'}\"\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b2_ansi_k13.sh", "echo \"${FOO:-$'a`echo \\`source ./helpers.sh; do_work \\\\\\\\\\\\\\\\\\\\\\\\\\` `'}\"\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b2_ansi_bt1_k11.sh", "x=`echo \"${FOO:-$'a\\`echo \\\\\\`source ./helpers.sh; do_work \\\\\\\\\\\\\\\\\\\\\\` \\`'}\"`\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b2_ansi_d3_to_1.sh", "source ./helpers.sh\necho \"${FOO:-$'a`echo B1; \\`echo B2; \\\\\\\\\\`do_work \\` ; echo B4 `'}\"\n", true, false, 0),
        ("w3m2b_i11_a_b2_ansi_d3_to_2_b4.sh", "source ./helpers.sh\necho \"${FOO:-$'a`echo B1; \\`echo B2; \\\\\\\\\\`echo B3 \\` ; do_work `'}\"\n", true, true, 2),
        ("w3m2b_i11_a_b2_reg_top_k3.sh", "`echo B1; \\`source ./helpers.sh; do_work \\\\\\` `\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b2_reg_param_src_b1.sh", "echo \"${FOO:-`source ./helpers.sh; \\`do_work \\\\\\` `}\"\n", false, false, 0),
        ("w3m2b_i11_a_b2_reg_dq_k3.sh", "echo \"`echo B1; \\`source ./helpers.sh; do_work \\\\\\` `\"\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_a_b3_glued_x_pre.sh", "x=pre`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", false, false, 0),
        ("w3m2b_i11_a_b3_glued_a0_pre.sh", "a[0]=pre`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", false, false, 0),
        ("w3m2b_i11_a_b3_glued_x_pe_pre.sh", "x+=pre`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", false, false, 0),
        ("w3m2b_i11_a_b3_glued_pre_word.sh", "pre`echo \"${FOO:-$'a`source ./helpers.sh; do_work`'}\"`\n", false, false, 0),
        ("w3m2b_i11_a_b3_glued_src_concat.sh", "source ./helpers.sh`echo \"${FOO:-$'a`echo ok`'}\"`; do_work\n", false, false, 0),
        ("w3m2b_i11_a_b3_glued_src_space_after.sh", "source ./helpers.sh`echo \"${FOO:-$'a` echo ok`'}\"`; do_work\n", true, true, 1),
        ("w3m2b_i11_param_ansi_bt_pipe_ok.sh", "x=`echo \"${Y:-${X:-$'a\\\\\\\\'}}\" | cat >/dev/null; source ./helpers.sh; do_work`\n", true, true, 1),
        ("w3m2b_i11_param_ansi_bt_ml_bad.sh", "x=`echo \"${X:-$'a\\\\\\'}\"\nsource ./helpers.sh; do_work`\nsource ./helpers.sh\n", true, false, 0),
        ("w3m2b_i11_hd2_first_bad_second_cmdsub.sh", "cat <<A <<B >/dev/null && source ./helpers.sh\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n", false, false, 0),
        // Iter 12 Explorer A Cluster 2: Chained heredocs inside subshell/brace/cmdsub (tree-sitter Invalid -> raw_cases)
        ("w3m2b_i12_hd2_sub_abort_a_pre.sh", "source ./helpers.sh\n(cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(do_work)\nB\n) && do_work\n", true, false, 0),
        ("w3m2b_i12_hd2_sub_abort_b_pre.sh", "source ./helpers.sh\n(cat <<A <<B >/dev/null\n$(echo ok)\nA\n${X:-$'a\\'b'}\nB\n) && do_work\n", true, false, 0),
        ("w3m2b_i12_hd2_brace_abort_a_pre.sh", "source ./helpers.sh\n{ cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(do_work)\nB\n} && do_work\n", true, false, 0),
        ("w3m2b_i12_hd2_sub_abort_a_r5.sh", "(cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_hd2_sub_abort_b_r5.sh", "(cat <<A <<B >/dev/null\n$(echo ok)\nA\n${X:-$'a\\'b'}\nB\n) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_hd2_brace_abort_a_r5.sh", "{ cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n} && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_hd2_cmdsub_abort_a_r5.sh", "v=$(cat <<A <<B\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i12_hd2_sub_then_cmd_r5.sh", "(cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\necho ok\n) && source ./helpers.sh; do_work\n", true, true, 7),
        ("w3m2b_i12_hd2_sub_hdr_close_r5.sh", "(cat <<A <<B >/dev/null) && source ./helpers.sh; do_work\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\n", false, false, 0),
        // Iter 13: nested escaped backtick heredoc, r5 chained <<A <<B, and ; then inline heredoc cases
        ("w3m2b_i13_hd_bt2_pos.sh", "source ./helpers.sh\nx=`echo \\`cat <<EOF >/dev/null\n\\${X:-ok}\nEOF\\`` && do_work\n", true, true, 4),
        ("w3m2b_i13_ch_if.sh", "if cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\nthen source ./helpers.sh; do_work; fi\n", false, false, 0),
        ("w3m2b_i13_ch_while.sh", "while cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\ndo source ./helpers.sh; do_work; break; done\n", false, false, 0),
        ("w3m2b_i13_ch_case_dsemi.sh", "case a in a) cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\n;; esac && source ./helpers.sh && do_work\n", false, false, 0),
        ("w3m2b_i13_ch_case_fall.sh", "case a in a) cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\n;& b) source ./helpers.sh; do_work;; esac\n", true, true, 6),
        ("w3m2b_i13_ch_word_after.sh", "cat <<A <<B \"${}\"\n$(source ./helpers.sh; do_work)\nA\n$(source ./helpers.sh; do_work)\nB\n", false, false, 0),
        ("w3m2b_i13_ch_word_before.sh", "cat \"${}\" <<A <<B\n$(source ./helpers.sh; do_work)\nA\n$(source ./helpers.sh; do_work)\nB\n", false, false, 0),
        ("w3m2b_i13_ch_assign_before.sh", "A=\"${}\" cat <<A <<B\n$(source ./helpers.sh; do_work)\nA\n$(source ./helpers.sh; do_work)\nB\n", false, false, 0),
        ("w3m2b_i13_ch_redir_before.sh", "cat >\"${}\" <<A <<B\n$(source ./helpers.sh; do_work)\nA\n$(source ./helpers.sh; do_work)\nB\n", false, false, 0),
        ("w3m2b_i13_ch_redir_mid.sh", "cat <<A >\"${}\" <<B\n$(source ./helpers.sh; do_work)\nA\n$(source ./helpers.sh; do_work)\nB\n", true, true, 2),
        ("w3m2b_i13_ch_redir_after_a.sh", "cat <<A <<B >\"${}\"\n$(source ./helpers.sh; do_work)\nA\n$(echo ok)\nB\n", true, true, 2),
        ("w3m2b_i13_ch_redir_after_b.sh", "cat <<A <<B >\"${}\"\n$(echo ok)\nA\n$(source ./helpers.sh; do_work)\nB\n", true, true, 4),
        ("w3m2b_i13_ch_nested_sub.sh", "( (cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n) ) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i13_ch_nested_grp.sh", "{ { cat <<A <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(source ./helpers.sh; do_work)\nB\n}; } && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i13_ch_cmdsub.sh", "v=\"$(cat <<A <<B\n${X:-$'a\\'b'}\nA\n$(echo ok)\nB\n)\" && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i13_if_semi_dc.sh", "source ./helpers.sh\nif cat <<EOF >/dev/null; then do_work; fi\n${X:-$'a\\'b'}\nEOF\n", true, false, 0),
        ("w3m2b_i13_if_semi_r5_inline.sh", "if cat <<EOF >/dev/null; then source ./helpers.sh; do_work; fi\n${X:-$'a\\'b'}\nEOF\n", false, false, 0),
        ("w3m2b_i13_if_semi_r5_ml.sh", "if cat <<EOF >/dev/null; then\n${X:-$'a\\'b'}\nEOF\nsource ./helpers.sh; do_work\nfi\n", false, false, 0),
        // Iter 14 raw_cases: tree-sitter-bash desync/error constructs verified against live bash 5.2
        ("w3m2b_i14_c1_time_dbl_dash_sub_neg.sh", "time -- (echo \"${}\") && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c2_bang_case_hd_or_neg.sh", "! case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac || source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c2_bang_case_hd_and_pos.sh", "! case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac && source ./helpers.sh; do_work\n", true, true, 4),
        ("w3m2b_i14_c3_nested_sub_hd2_semi_and_neg.sh", "( (cat <<A <<B >/dev/null\n${}\nA\nok\nB\n); ) && source ./helpers.sh; do_work\n", false, false, 0),
        ("w3m2b_i14_c3_nested_grp_hd2_nl_and_neg.sh", "source ./helpers.sh\n{ { cat <<A <<B >/dev/null\n${}\nA\nok\nB\n}\n} && do_work\n", true, false, 0),
        ("w3m2b_i14_c5_bang_hd2_and_pos.sh", "! cat <<A <<B >/dev/null && source ./helpers.sh; do_work\n${}\nA\nok\nB\n", true, true, 1),
        ("w3m2b_i14_c5_x_bt_hd2_or_pos.sh", "x=`cat <<A <<B >/dev/null\n${}\nA\nok\nB\n` || source ./helpers.sh; do_work\n", true, true, 6),
        ("w3m2b_i14_c5_mixed_quote_hd2_pos.sh", "source ./helpers.sh\ncat <<'A' <<B >/dev/null\n${X:-$'a\\'b'}\nA\n$(do_work)\nB\n", true, true, 5),
        // Iter 15 Clusters A/D/E + Explorer raw_cases (FirewallVerdict::Invalid, live bash 5.2 verified)
        ("w3m2b_i15_a1_time_dash_err_pos.sh", "time -- 2>&- A+=\"${!!}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i15_a2_fd0_close_err_pos.sh", "0<&- A+=\"${!!}\" $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i15_d15_fd2_redir_asg_or_neg.sh", "source ./helpers.sh\n2>\"${}\" A[0]=$(echo r1) || do_work\n", true, false, 0),
        ("w3m2b_i15_e3_bang_case_bang_hd_and_neg.sh", "source ./helpers.sh\n! case a in a) ! cat <<EOF >/dev/null\n${}\nEOF\n;; esac && do_work\n", true, false, 0),
        ("w3m2b_i15_e4_bang_case_bang_hd_or_pos.sh", "source ./helpers.sh\n! case a in a) ! cat <<EOF >/dev/null\n${}\nEOF\n;; esac || do_work\n", true, true, 5),
        ("w3m2b_i15_e9_pre_subshell_cmdsub_hd2_or_pos.sh", "source ./helpers.sh\nv=\"pre$((cat <<A <<B >/dev/null)\n${}\nA\nok\nB\n)post\" || do_work\n", true, true, 7),
        ("w3m2b_i15_e10_pre_subshell_cmdsub_hd2_and_neg.sh", "source ./helpers.sh\nv=\"pre$((cat <<A <<B >/dev/null)\n${}\nA\nok\nB\n)post\" && do_work\n", true, false, 0),
        ("w3m2b_i15_x4_bang_subshell_hd2_and_pos.sh", "source ./helpers.sh\n! (cat <<A <<B >/dev/null\n${}\nA\nok\nB\n) && do_work\n", true, true, 7),
        ("w3m2b_i15_x5_bang_subshell_hd2_or_neg.sh", "source ./helpers.sh\n! (cat <<A <<B >/dev/null\n${}\nA\nok\nB\n) || do_work\n", true, false, 0),
        ("w3m2b_i15_x6_bang_brace_hd2_and_pos.sh", "source ./helpers.sh\n! { cat <<A <<B >/dev/null\n${}\nA\nok\nB\n} && do_work\n", true, true, 7),
        ("w3m2b_i15_x6_r5_bang_brace_hd2_and_pos.sh", "! { cat <<A <<B >/dev/null\n${}\nA\nok\nB\n} && $(source ./helpers.sh; do_work)\n", true, true, 6),
        ("w3m2b_i15_x7_bang_brace_hd2_or_neg.sh", "source ./helpers.sh\n! { cat <<A <<B >/dev/null\n${}\nA\nok\nB\n} || do_work\n", true, false, 0),
        ("w3m2b_i15_x8_nested_subshell_1l_hd2_and_neg.sh", "source ./helpers.sh\n( (cat <<A <<B >/dev/null\n${}\nA\nok\nB\n) ) && do_work\n", true, false, 0),
        ("w3m2b_i15_x9_nested_brace_ml_hd2_and_neg.sh", "source ./helpers.sh\n{ { cat <<A <<B >/dev/null\n${}\nA\nok\nB\n}\n} && do_work\n", true, false, 0),
        // Iter 16 raw_cases (Invalid CSTs verified against bash 5.2)
        ("w3m2b_i16_a_nested_open_brace_pipe_badsub_or_neg.sh", "source ./helpers.sh\n! time { { echo \"${}\"; }; } | echo \"${}\" || do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_nested_open_brace_pipe_badsub_or_neg.sh", "! time { { echo \"${}\"; }; } | echo \"${}\" || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_bang_bang_nested_brace_pipe_cat_and_pos.sh", "source ./helpers.sh\n! ! { { echo \"${}\"; }; } | cat && do_work\n", true, true, 2),
        ("w3m2b_i16_a_r5_bang_bang_nested_brace_pipe_cat_and_pos.sh", "! ! { { echo \"${}\"; }; } | cat && $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_a_bang_time_nested_brace_pipe_semi_pos.sh", "source ./helpers.sh\n! time { { echo \"${}\"; }; } | cat; do_work\n", true, true, 2),
        ("w3m2b_i16_a_r5_bang_time_nested_brace_pipe_semi_pos.sh", "! time { { echo \"${}\"; }; } | cat; $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_a_r5_nested_bang_brace_hd_or_neg.sh", "! { { cat <<EOF >/dev/null\n${}\nEOF\n}; } || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_r5_bang_bang_nested_brace_hd_and_neg.sh", "! ! { { cat <<EOF >/dev/null\n${}\nEOF\n}; } && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_brace_case_hd_and_pos.sh", "source ./helpers.sh\n{ case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && do_work\n", true, true, 5),
        ("w3m2b_i16_a_r5_brace_case_hd_and_pos.sh", "{ case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_brace_case_hd_and_pos.sh", "source ./helpers.sh\ntime { case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && do_work\n", true, true, 5),
        ("w3m2b_i16_a_r5_time_brace_case_hd_and_pos.sh", "time { case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_brace_case_a_hd_and_neg.sh", "source ./helpers.sh\ntime { case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_time_brace_case_a_hd_and_neg.sh", "time { case a in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_time_p_brace_case_hd_and_pos.sh", "source ./helpers.sh\ntime -p { case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && do_work\n", true, true, 5),
        ("w3m2b_i16_a_r5_bang_bang_brace_case_hd_and_pos.sh", "! ! { case b in a) cat <<EOF >/dev/null\n${}\nEOF\n;; esac; } && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_brace_if_hd_and_pos.sh", "source ./helpers.sh\n{ if true; then cat <<EOF >/dev/null\n${}\nEOF\nfi; } && do_work\n", true, true, 5),
        ("w3m2b_i16_a_r5_brace_if_hd_and_pos.sh", "{ if true; then cat <<EOF >/dev/null\n${}\nEOF\nfi; } && $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_p_sub_bang_hd_and_neg.sh", "source ./helpers.sh\ntime -p ( ! cat <<EOF >/dev/null\n${}\nEOF\n) && do_work\n", true, false, 0),
        ("w3m2b_i16_a_r5_time_p_sub_bang_hd_and_neg.sh", "time -p ( ! cat <<EOF >/dev/null\n${}\nEOF\n) && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_a_r5_time_dd_sub_bang_hd_or_pos.sh", "time -- ( ! cat <<EOF >/dev/null\n${}\nEOF\n) || $(source ./helpers.sh; do_work)\n", true, true, 4),
        ("w3m2b_i16_a_time_p_sub_true_bang_hd_and_pos.sh", "source ./helpers.sh\ntime -p ( true; ! cat <<EOF >/dev/null\n${}\nEOF\n) && do_work\n", true, true, 5),
        ("w3m2b_i16_c_fd0_lhs_sub_semi_neg.sh", "source ./helpers.sh\n0<\"${}\" A[${}]=\"ok\"; do_work\n", true, false, 0),
        ("w3m2b_i16_c_r5_fd0_lhs_sub_semi_neg.sh", "0<\"${}\" A[${}]=\"ok\"; $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_c_fd0_lhs_sub_or_neg.sh", "source ./helpers.sh\n0<\"${}\" A[${}]=\"ok\" || do_work\n", true, false, 0),
        ("w3m2b_i16_c_r5_fd2_lhs_sub_err_semi_neg.sh", "2>\"${}\" A[${}]=\"ok\" ;/$(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_c_r5_pre_subshell_cmdsub_hd2_and_neg.sh", "v=\"pre$((cat <<A <<B >/dev/null)\n${}\nA\nok\nB\n)post\" && $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_c_r5_pre_subshell_cmdsub_hd2_or_pos.sh", "v=\"pre$((cat <<A <<B >/dev/null)\n${}\nA\nok\nB\n)post\" || $(source ./helpers.sh; do_work)\n", true, true, 6),
        ("w3m2b_i16_c_bang_case_assign_bt_hd_or_neg.sh", "source ./helpers.sh\n! case a in a) x=`cat <<EOF\n${}\nEOF\n`;; esac || do_work\n", true, false, 0),
        ("w3m2b_i16_c_r5_bang_case_assign_bt_hd_or_neg.sh", "! case a in a) x=`cat <<EOF\n${}\nEOF\n`;; esac || $(source ./helpers.sh; do_work)\n", false, false, 0),
        ("w3m2b_i16_c_rw_redir_no_cmd_semi_pos.sh", "source ./helpers.sh\n<>\"${}\"; do_work\n", true, true, 2),
        ("w3m2b_i16_c_r5_rw_redir_no_cmd_semi_pos.sh", "<>\"${}\"; $(source ./helpers.sh; do_work)\n", true, true, 1),
        ("w3m2b_i16_c_bang_rw_redir_no_cmd_or_neg.sh", "source ./helpers.sh\n! <>\"${}\" || do_work\n", true, false, 0),
        ("w3m2b_i16_c_r5_bang_0rw_redir_no_cmd_and_pos.sh", "! 0<>\"${}\" && $(source ./helpers.sh; do_work)\n", true, true, 1),
    ];

    let mut errs = Vec::new();
    let mut sh_ws = vec![verify_and_parse(&reg, &fw, "helpers.sh", LanguageId::Bash, sh_helpers)];
    for (p, src, expect_import, _, _) in cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = verify_and_parse(&reg, &fw, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    for (p, src, expect_import, _, _) in raw_cases {
        fs::write(dir.join(p), src).unwrap();
        let parsed = parse_input(&reg, p, LanguageId::Bash, src);
        let has_imp = parsed.edges.iter().any(|e| e.kind == DepKind::Import && e.target == "./helpers.sh");
        if has_imp != *expect_import {
            errs.push(format!("edge mismatch for {p}: got={has_imp} exp={expect_import} edges={:?}", parsed.edges));
        }
        sh_ws.push(parsed);
    }
    let sh_hits = find_workspace_callers("helpers.sh", Some("do_work"), &sh_ws, &dir);
    let all_hits = find_workspace_callers("helpers.sh", None, &sh_ws, &dir);
    for (p, _, expect_import, expect_call, exp_line) in cases.iter().chain(raw_cases.iter()) {
        let hit = sh_hits.iter().find(|h| h.caller_path == *p);
        let hit_none = all_hits.iter().find(|h| h.caller_path == *p);
        if *expect_call {
            match hit {
                None => errs.push(format!("missing caller {p}")),
                Some(h) if h.imported_symbols != vec!["*".to_string()] || h.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch {p}: got={h:?} exp_line={exp_line}"));
                }
                _ => {}
            }
            match hit_none {
                None => errs.push(format!("missing caller (None) {p}")),
                Some(hn) if hn.imported_symbols != vec!["*".to_string()] || hn.call_lines != vec![*exp_line] => {
                    errs.push(format!("caller mismatch (None) {p}: got={hn:?} exp_line={exp_line}"));
                }
                _ => {}
            }
        } else {
            if let Some(h) = hit {
                errs.push(format!("unexpected caller {p}: {h:?}"));
            }
            if *expect_import {
                if let Some(hn) = hit_none && !hn.call_lines.is_empty() {
                    errs.push(format!("unexpected call_lines (None) {p}: {hn:?}"));
                }
            } else if let Some(hn) = hit_none {
                errs.push(format!("unexpected caller (None) {p}: {hn:?}"));
            }
        }
    }
    assert!(errs.is_empty(), "w3m2b failures ({}):\n{}", errs.len(), errs.join("\n"));
}

