use super::*;

#[test]
fn w3_m4_universal_aice_read_full_auto_outline_binary_and_empty() {
    let tw = TempWorkspace::new("w3m4_read_core");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/math.ts",
        "export interface CalcResult {\n  value: number;\n  label: string;\n}\n\nexport class Calculator {\n  private offset: number;\n  constructor(offset = 0) { this.offset = offset; }\n  public add(a: number, b: number): CalcResult { return { value: a + b + this.offset, label: \"sum\" }; }\n  public mul(a: number, b: number): CalcResult { return { value: a * b + this.offset, label: \"product\" }; }\n}\n",
    );
    tw.write_file("src/notes.txt", "Plain text note [a+b]*(c?)\n");
    tw.write_file("src/empty.ts", "");
    tw.write_file("src/empty.txt", "");
    tw.write_bytes("bin/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR");
    tw.write_bytes("src/disguised.txt", b"hello\x00world\xff\xfe");

    // B-R1 & T2-F02-04: default read & --full both emit AICE IR (not raw TS)
    for args in [&["read", "src/math.ts"][..], &["read", "--full", "src/math.ts"][..]] {
        let out = tw.run_with_empty_path(args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(txt.contains("// file: src/math.ts\n"));
        assert!(txt.contains("module typescript"));
        assert!(txt.contains("Calculator"));
        assert!(!txt.contains("export interface CalcResult {"));
    }

    // PlainText passthrough & 0-byte empty files
    let txt_out = tw.run_isolated(&["read", "src/notes.txt"], true);
    assert_eq!(txt_out.status.code(), Some(0));
    assert!(stdout_str(&txt_out).contains("Plain text note [a+b]*(c?)"));
    for empty in ["src/empty.ts", "src/empty.txt"] {
        assert_eq!(tw.run_isolated(&["read", empty], true).status.code(), Some(0));
    }

    // READ-08: binary skip notice, exit 0, zero raw binary bytes
    for bin_path in ["bin/logo.png", "src/disguised.txt"] {
        let out = tw.run_isolated(&["read", bin_path], true);
        assert_eq!(out.status.code(), Some(0));
        assert!(!out.stdout.contains(&0u8), "NUL byte leaked for {bin_path}");
        let s = stdout_str(&out);
        assert!(s.contains("binary file skipped"), "missing binary notice: {s}");
    }

    // 120L vs 121L auto-outline boundary
    let mut lines_120 = String::new();
    for i in 1..=120 {
        lines_120.push_str(&format!("export const c_{i}: number = {i};\n"));
    }
    tw.write_file("src/exact_120.ts", &lines_120);
    let mut lines_121 = lines_120;
    lines_121.push_str("export function tailFn(): number { return 121; }\n");
    tw.write_file("src/over_121.ts", &lines_121);

    let r120 = tw.run_isolated(&["read", "src/exact_120.ts"], true);
    assert_eq!(r120.status.code(), Some(0));
    assert!(!stdout_str(&r120).contains("Auto-outlined"));

    let r121 = tw.run_isolated(&["read", "src/over_121.ts"], true);
    assert_eq!(r121.status.code(), Some(0));
    assert!(stdout_str(&r121).contains("Auto-outlined src/over_121.ts"));

    let r121_full = tw.run_isolated(&["read", "--full", "src/over_121.ts"], true);
    assert_eq!(r121_full.status.code(), Some(0));
    assert!(!stdout_str(&r121_full).contains("Auto-outlined"));
    assert!(stdout_str(&r121_full).contains("tailFn"));
}

#[test]
fn w3_m4_selectors_intra_ast_large_file_and_error_diagnostics() {
    let tw = TempWorkspace::new("w3m4_selectors");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/math.ts",
        "export class Calculator {\n  public add(a: number, b: number): number {\n    if (a > 0) {\n      return a + b;\n    }\n    return b;\n  }\n  public mul(a: number, b: number): number { return a * b; }\n}\n",
    );
    tw.write_file("src/bad.rs", "pub fn broken( { let x = ; }\n");

    // Symbol + sibling hints
    let sym = tw.run_isolated(&["read", "src/math.ts:Calculator.add"], true);
    assert_eq!(sym.status.code(), Some(0), "{}", stderr_str(&sym));
    let sym_txt = stdout_str(&sym);
    assert!(sym_txt.contains("add"));
    assert!(sym_txt.contains("siblings in Calculator: mul"));

    // Intra-block @branch
    let blk = tw.run_isolated(&["read", "src/math.ts:Calculator.add@branch"], true);
    assert_eq!(blk.status.code(), Some(0), "{}", stderr_str(&blk));
    assert!(stdout_str(&blk).contains("a + b"));

    // Line range, single line, regex selector, outline, imports
    assert_eq!(tw.run_isolated(&["read", "src/math.ts:L1-L5"], true).status.code(), Some(0));
    assert_eq!(tw.run_isolated(&["read", "src/math.ts:L2"], true).status.code(), Some(0));
    let rx = tw.run_isolated(&["read", "src/math.ts:/mul/"], true);
    assert_eq!(rx.status.code(), Some(0));
    assert!(stdout_str(&rx).contains("mul"));
    let ol = tw.run_isolated(&["read", "--outline", "src/math.ts"], true);
    assert_eq!(ol.status.code(), Some(0));
    assert!(!stdout_str(&ol).contains("a + b"));

    // Inverted line range & OOB safe
    let inv = tw.run_isolated(&["read", "src/math.ts:L50-L10"], true);
    assert_eq!(inv.status.code(), Some(1));
    assert!(!stderr_str(&inv).is_empty());
    assert_eq!(tw.run_isolated(&["read", "src/math.ts:L9999-L10010"], true).status.code(), Some(0));

    // B-R6: missing symbol & broken file missing symbol -> exit 1, zero [AICE AST Fallback]
    for args in [
        &["read", "src/math.ts:NoSuchSymbolXYZ"][..],
        &["read", "src/bad.rs:target_fn"][..],
        &["read", "src/math.ts:Calculator.add@no_such_block_xyz"][..],
    ] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(1), "{args:?}");
        let comb = format!("{}\n{}", stdout_str(&out), stderr_str(&out));
        assert!(!comb.contains("[AICE AST Fallback]"));
        assert!(!stderr_str(&out).is_empty());
    }

    // B-R3: >50KB file AST slice
    let mut huge = String::new();
    for i in 0..1800 {
        huge.push_str(&format!("export const filler_{i}: number = {i};\n"));
    }
    huge.push_str("export function lateTarget(x: number): number { return x * 42; }\n");
    assert!(huge.len() > 55_000);
    tw.write_file("src/huge.ts", &huge);
    let r_huge = tw.run_isolated(&["read", "src/huge.ts:lateTarget"], true);
    assert_eq!(r_huge.status.code(), Some(0), "{}", stderr_str(&r_huge));
    assert!(stdout_str(&r_huge).contains("lateTarget"));
}

#[test]
fn w3_m4_fuzzy_guessing_topo_order_json_and_stats() {
    let tw = TempWorkspace::new("w3m4_fuzzy_topo");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/math.ts",
        "export class Calculator {\n  public add(a: number, b: number): number { return a + b; }\n}\n",
    );
    tw.write_file(
        "src/app.ts",
        "import { Calculator } from \"./math\";\nexport function runApp(): number { return new Calculator().add(1, 2); }\n",
    );
    tw.write_file(
        "src/app.spec.ts",
        "import { runApp } from \"./app\";\nexport function testApp(): number { return runApp(); }\n",
    );
    tw.write_file(
        "src/calc.ts",
        "export function computeSum(a: number, b: number): number { return a + b; }\nexport function computeSub(a: number, b: number): number { return a - b; }\n",
    );

    // T1-F09-06: single-char typo auto-resolves
    let fuzzy = tw.run_isolated(&["read", "src/math.ts:Calculater.add"], true);
    assert_eq!(fuzzy.status.code(), Some(0), "{}", stderr_str(&fuzzy));
    assert!(stdout_str(&fuzzy).contains("add"));

    // T1-F09-07: ambiguous symbol suggestions
    let ambig = tw.run_isolated(&["read", "src/calc.ts:computeSu"], true);
    assert_eq!(ambig.status.code(), Some(1));
    let comb = format!("{}\n{}", stdout_str(&ambig), stderr_str(&ambig));
    assert!(comb.contains("computeSum") && comb.contains("computeSub"));

    // T2-F09-04: unrelated gibberish rejected
    let gib = tw.run_isolated(&["read", "src/zxqvbnm12345.ts"], true);
    assert_eq!(gib.status.code(), Some(1));
    assert!(!stdout_str(&gib).contains("Calculator"));

    // Topo order: --deps orders math.ts before app.ts; --callers includes app.spec.ts
    let deps_out = tw.run_isolated(&["read", "src/app.ts", "--deps"], true);
    assert_eq!(deps_out.status.code(), Some(0));
    let d_txt = stdout_str(&deps_out);
    assert!(d_txt.find("src/math.ts").unwrap() < d_txt.find("src/app.ts").unwrap());

    let callers_out = tw.run_isolated(&["read", "src/app.ts", "--callers"], true);
    assert_eq!(callers_out.status.code(), Some(0));
    assert!(stdout_str(&callers_out).contains("src/app.spec.ts"));

    // READ-12: --json without --deps has empty dependencies & callers
    let json_out = tw.run_isolated(&["read", "src/app.ts", "--json"], true);
    assert_eq!(json_out.status.code(), Some(0));
    let vj = parse_json(&stdout_str(&json_out)).expect("valid read --json");
    assert_eq!(field(&vj, "targetPath").and_then(JsonValue::as_str), Some("src/app.ts"));
    assert_eq!(field(&vj, "dependencies").and_then(JsonValue::as_array).map(|a| a.len()), Some(0));
    assert_eq!(field(&vj, "callers").and_then(JsonValue::as_array).map(|a| a.len()), Some(0));
    let bundle = field(&vj, "formattedBundle").and_then(JsonValue::as_str).unwrap();
    assert_eq!(
        field(&vj, "tokenCount").and_then(JsonValue::as_u64),
        Some(count_cl100k(bundle) as u64)
    );

    // B-T6: --stats footer included in metered telemetry
    let stats_out = tw.run_isolated(&["read", "src/app.ts", "--stats"], true);
    assert_eq!(stats_out.status.code(), Some(0));
    let st_txt = stdout_str(&stats_out);
    assert!(st_txt.contains("Context Pack Token Telemetry"));
    let last_row = fs::read_to_string(&tw.telemetry_path)
        .unwrap()
        .lines()
        .last()
        .and_then(|l| parse_json(l).ok())
        .unwrap();
    assert_eq!(
        field(&last_row, "a1").and_then(JsonValue::as_u64),
        Some(count_cl100k(&st_txt) as u64)
    );
}

#[test]
fn w3_m4_ranked_search_find_gitignore_and_cli_patterns() {
    let tw = TempWorkspace::new("w3m4_search_find");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(".gitignore", "*.secret.ts\nignored_dir/\n");
    tw.write_file("src/visible.ts", "export class Calculator { add(a: number, b: number): number { return a + b; } }\n");
    tw.write_file("src/app.spec.ts", "import { Calculator } from \"./visible\";\nconst c = new Calculator();\n");
    tw.write_file("src/hidden.secret.ts", "export class Calculator {}\n");
    tw.write_file("ignored_dir/cache.ts", "export class Calculator {}\n");
    tw.write_file("src/notes.txt", "Regex probe [a+b]*(c?) literal\n");
    tw.write_bytes("bin/data.bin", b"\x00\x01\x02Calculator");

    // T2-F09-05 + B-R2 + SRCH-01: ranking, .gitignore exclusion, binary skip, AICE snippet
    let s_out = tw.run_isolated(&["search", "Calculator"], true);
    assert_eq!(s_out.status.code(), Some(0));
    let s_txt = stdout_str(&s_out);
    assert!(s_txt.find("src/visible.ts").unwrap() < s_txt.find("src/app.spec.ts").unwrap());
    assert!(!s_txt.contains("hidden.secret.ts"));
    assert!(!s_txt.contains("ignored_dir"));
    assert!(!s_txt.contains("data.bin"));
    assert!(!s_txt.contains("export class Calculator {"));

    // SRCH-04 & SRCH-05 & SRCH-06
    let l_out = tw.run_isolated(&["search", "-l", "Calculator"], true);
    assert_eq!(l_out.status.code(), Some(0));
    assert!(stdout_str(&l_out).contains("src/visible.ts"));

    let lit_out = tw.run_isolated(&["search", "[a+b]*(c?)"], true);
    assert_eq!(lit_out.status.code(), Some(0));
    assert!(stdout_str(&lit_out).contains("src/notes.txt"));

    let json_s = tw.run_isolated(&["search", "Calculator|Regex", "--json"], true);
    assert_eq!(json_s.status.code(), Some(0));
    let sj = parse_json(&stdout_str(&json_s)).expect("valid search --json");
    assert_eq!(field(&sj, "mode").and_then(JsonValue::as_str), Some("search"));

    // FIND: gitignore, depth, `find <dir> <pat>`, `find src/*.ts`, `read --files <pat>`
    let f_all = tw.run_isolated(&["find"], true);
    assert_eq!(f_all.status.code(), Some(0));
    let f_txt = stdout_str(&f_all);
    assert!(f_txt.contains("visible.ts") && !f_txt.contains("hidden.secret.ts") && !f_txt.contains("cache.ts"));

    let f_d1 = tw.run_isolated(&["find", "-d1"], true);
    assert_eq!(f_d1.status.code(), Some(0));
    assert_eq!(stdout_str(&f_d1).trim(), "src/");

    let f_dir_pat = tw.run_isolated(&["find", "src", "visible"], true);
    assert_eq!(f_dir_pat.status.code(), Some(0));
    assert!(stdout_str(&f_dir_pat).contains("src/visible.ts"));

    let f_glob = tw.run_isolated(&["find", "src/*.txt"], true);
    assert_eq!(f_glob.status.code(), Some(0));
    assert!(stdout_str(&f_glob).contains("src/notes.txt"));

    let r_files = tw.run_isolated(&["read", "--files", "visible"], true);
    assert_eq!(r_files.status.code(), Some(0));
    assert!(stdout_str(&r_files).contains("src/visible.ts"));

    // tree alias + find --json FIND-07 schema + grep alias + -C clamping
    let tree_out = tw.run_isolated(&["tree"], true);
    assert_eq!(tree_out.status.code(), Some(0));
    assert_eq!(stdout_str(&tree_out), f_txt);

    let f_json = tw.run_isolated(&["find", "--json"], true);
    assert_eq!(f_json.status.code(), Some(0));
    let fj = parse_json(&stdout_str(&f_json)).expect("valid find --json");
    assert_eq!(field(&fj, "mode").and_then(JsonValue::as_str), Some("files"));
    assert!(field(&fj, "files").and_then(JsonValue::as_array).is_some());

    let grep_out = tw.run_isolated(&["grep", "Calculator"], true);
    assert_eq!(grep_out.status.code(), Some(0));
    assert_eq!(stdout_str(&grep_out), s_txt);

    assert_eq!(tw.run_isolated(&["search", "Calculator", "-C", "0"], true).status.code(), Some(0));
    assert_eq!(tw.run_isolated(&["search", "Calculator", "-C", "500"], true).status.code(), Some(0));
}

#[test]
fn w3_m4_polyglot_aice_read_cyclic_diamond_and_path_fuzzy() {
    let tw = TempWorkspace::new("w3m4_polyglot_graph");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/cycle_a.ts", "import { pingB } from \"./cycle_b\";\nexport function pingA(): number { return pingB(); }\n");
    tw.write_file("src/cycle_b.ts", "import { pingA } from \"./cycle_a\";\nexport function pingB(): number { return 1 + pingA(); }\n");
    tw.write_file("src/leaf.ts", "export const LEAF = 1;\n");
    tw.write_file("src/mid_b.ts", "import { LEAF } from \"./leaf\";\nexport const B = LEAF + 1;\n");
    tw.write_file("src/mid_c.ts", "import { LEAF } from \"./leaf\";\nexport const C = LEAF + 2;\n");
    tw.write_file("src/top_d.ts", "import { B } from \"./mid_b\";\nimport { C } from \"./mid_c\";\nexport const D = B + C;\n");

    // Cyclic imports deduplicate (appear once)
    let cyc = tw.run_isolated(&["read", "src/cycle_a.ts", "--deps", "--callers"], true);
    assert_eq!(cyc.status.code(), Some(0));
    let cyc_txt = stdout_str(&cyc);
    assert!(cyc_txt.contains("pingA") && cyc_txt.contains("pingB"));
    assert_eq!(cyc_txt.matches("// file: src/cycle_a.ts").count(), 1);

    // Diamond dependency graph orders leaf before mid_b/mid_c before top_d
    let dia = tw.run_isolated(&["read", "src/top_d.ts", "--deps", "-d", "3"], true);
    assert_eq!(dia.status.code(), Some(0));
    let d_txt = stdout_str(&dia);
    let p_leaf = d_txt.find("// file: src/leaf.ts").unwrap();
    let p_b = d_txt.find("// file: src/mid_b.ts").unwrap();
    let p_c = d_txt.find("// file: src/mid_c.ts").unwrap();
    let p_d = d_txt.find("// file: src/top_d.ts").unwrap();
    assert!(p_leaf < p_b && p_leaf < p_c && p_b < p_d && p_c < p_d);

    // Short-name 2-char transposition emits "Did you mean: src/leaf.ts"; 1-char typo on longer name auto-resolves
    let p_did = tw.run_isolated(&["read", "src/laef.ts"], true);
    assert_eq!(p_did.status.code(), Some(1));
    assert!(stderr_str(&p_did).contains("src/leaf.ts"));

    tw.write_file("src/calculator.ts", "export const CALC_TAG = 42;\n");
    let p_fuzzy = tw.run_isolated(&["read", "src/calculatr.ts"], true);
    assert_eq!(p_fuzzy.status.code(), Some(0), "{}", stderr_str(&p_fuzzy));
    assert!(stdout_str(&p_fuzzy).contains("CALC_TAG"));

    // B-R4 & B-R7: polyglot R5 + Twig + R6 all emit AICE IR
    tw.write_file("src/worker.py", "def run_job(x: int) -> int:\n    return x + 1\n");
    tw.write_file("src/engine.rs", "pub fn step(x: i32) -> i32 { x + 1 }\n");
    tw.write_file("src/server.go", "package main\nfunc Start(port int) int { return port }\n");
    tw.write_file("src/config.toml", "[package]\nname = \"demo\"\n");
    tw.write_file("src/schema.sql", "CREATE TABLE items (id INT PRIMARY KEY);\n");
    tw.write_file("src/schema.prisma", "model Item {\n  id Int @id\n}\n");
    tw.write_file("src/api.graphql", "type Query {\n  ping: String\n}\n");
    tw.write_file("src/graph.cypher", "MATCH (n:Item) RETURN n.id;\n");
    tw.write_file("src/card.twig", "{% if ok %}<p>{{ name }}</p>{% endif %}\n");

    let poly = tw.run_isolated(
        &[
            "read",
            "src/worker.py",
            "src/engine.rs",
            "src/server.go",
            "src/config.toml",
            "src/schema.sql",
            "src/schema.prisma",
            "src/api.graphql",
            "src/graph.cypher",
            "src/card.twig",
        ],
        true,
    );
    assert_eq!(poly.status.code(), Some(0), "{}", stderr_str(&poly));
    let pt = stdout_str(&poly);
    for mod_hdr in [
        "module python",
        "module rust",
        "module main",
        "module toml",
        "module sql",
        "module prisma",
        "module graphql",
        "module cypher",
        "module twig",
    ] {
        assert!(pt.contains(mod_hdr), "Missing '{mod_hdr}' in polyglot AICE output:\n{pt}");
    }
}

#[test]
fn w3_m4_r2_multiline_search_line_bounds_ordinals_late_nul_and_cli_fixes() {
    let tw = TempWorkspace::new("w3m4_r2_fixes");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/math.ts",
        "export interface CalcResult {\n  value: number;\n  label: string;\n}\n\nexport class Calculator {\n  private offset: number;\n\n  constructor(offset = 0) {\n    this.offset = offset;\n  }\n\n  public add(a: number, b: number): CalcResult {\n    return { value: a + b + this.offset, label: \"sum\" };\n  }\n\n  public mul(a: number, b: number): CalcResult {\n    return { value: a * b + this.offset, label: \"product\" };\n  }\n}\n",
    );
    tw.write_file(
        "src/app.ts",
        "import { Calculator, type CalcResult } from \"./math.js\";\n\nexport class App {\n  private calc: Calculator;\n  private count = 0;\n\n  constructor(offset = 1) {\n    this.calc = new Calculator(offset);\n  }\n}\n",
    );
    tw.write_file(
        "src/engine.rs",
        "pub struct Engine {\n    pub count: u64,\n}\nimpl Engine {\n    pub fn step(&mut self, delta: u64) -> u64 {\n        self.count += delta;\n        self.count\n    }\n}\n",
    );
    tw.write_file(
        "src/schema.sql",
        "CREATE TABLE accounts (\n  id BIGINT PRIMARY KEY,\n  owner TEXT NOT NULL\n);\n",
    );
    tw.write_file("src/a_comment.ts", "// Calculator helper comment only\n");
    tw.write_file("src/api.ts", "const endpoint = \"/api/v1/users\";\n");
    tw.write_file(
        "src/single.ts",
        "export function onlyOne(x: number): number { return x + 42; }\nexport function runLoop(n: number): number {\n  for (let i = 0; i < n; i++) { if (i > 10) return i; }\n  return 0;\n}\n",
    );
    let mut big = String::from("export interface PipelineMetrics {\n  processed: number;\n  checksum: number;\n  warnings: string[];\n}\n\nexport function runBatchPipeline(seed: number, limit: number): PipelineMetrics {\n  const warnings: string[] = [];\n  let acc = seed;\n  let processed = 0;\n\n  if (limit <= 0) {\n    warnings.push(\"limit-non-positive\");\n    return { processed: 0, checksum: acc, warnings };\n  }\n\n");
    for i in 1..=90 {
        big.push_str(&format!("  const step_{i} = acc + {i};\n"));
    }
    big.push_str("  return { processed, checksum: acc, warnings };\n}\n");
    tw.write_file("src/big.ts", &big);
    let mut late_nul = vec![b'A'; 9000];
    late_nul.extend_from_slice(b"\n\x00LATE_NUL\n");
    tw.write_bytes("src/late_nul.txt", &late_nul);
    tw.write_file("src/empty.ts", "");
    tw.write_file("src/sub/deep.ts", "export const DEEP = 1;\n");

    // Fix 1: Multi-line search AICE IR transformation (B-R2 / R3)
    for args in [&["search", "Calculator"][..], &["search", "Calculator", "-C", "2"][..]] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(0));
        let txt = stdout_str(&out);
        assert!(!txt.contains("export class Calculator {"), "{args:?}: {txt}");
        assert!(!txt.contains("export class App {"), "{args:?}: {txt}");
        assert!(!txt.contains("// Calculator helper"), "{args:?}: {txt}");
        assert!(txt.contains("# Calculator helper comment only"), "{args:?}: {txt}");
    }
    let eng_s = tw.run_isolated(&["search", "Engine"], true);
    assert_eq!(eng_s.status.code(), Some(0));
    let eng_txt = stdout_str(&eng_s);
    assert!(!eng_txt.contains("pub struct Engine {") && !eng_txt.contains("impl Engine {"));

    let sql_s = tw.run_isolated(&["search", "accounts", "-C", "2"], true);
    assert_eq!(sql_s.status.code(), Some(0));
    let sql_txt = stdout_str(&sql_s);
    assert!(sql_txt.contains("table \"accounts\":"), "{sql_txt}");
    assert!(!sql_txt.contains("CREATE TABLE accounts ("), "{sql_txt}");

    // Fix 2: Closed /pattern/flags & literal path fallback in search
    let rx_s = tw.run_isolated(&["search", "/mul/i"], true);
    assert_eq!(rx_s.status.code(), Some(0));
    assert!(stdout_str(&rx_s).contains("mul"));
    let lit_slash = tw.run_isolated(&["search", "/api/v1"], true);
    assert_eq!(lit_slash.status.code(), Some(0));
    assert!(stdout_str(&lit_slash).contains("src/api.ts"));

    // Fix 3: Line-range slice bounding past end_line
    let r_1_15 = tw.run_isolated(&["read", "src/math.ts:L1-L15"], true);
    assert_eq!(r_1_15.status.code(), Some(0));
    let t_1_15 = stdout_str(&r_1_15);
    assert!(t_1_15.contains("CalcResult") && t_1_15.contains("add"));
    assert!(!t_1_15.contains("label: \"product\"") && !t_1_15.contains("fn mul("), "{t_1_15}");

    let r_6_10 = tw.run_isolated(&["read", "src/math.ts:L6-L10"], true);
    assert_eq!(r_6_10.status.code(), Some(0));
    let t_6_10 = stdout_str(&r_6_10);
    assert!(t_6_10.contains("Calculator") && !t_6_10.contains("fn add(") && !t_6_10.contains("fn mul("), "{t_6_10}");

    let r_big = tw.run_isolated(&["read", "src/big.ts:L1-L15"], true);
    assert_eq!(r_big.status.code(), Some(0));
    let t_big = stdout_str(&r_big);
    assert!(t_big.contains("PipelineMetrics") && t_big.contains("runBatchPipeline"));
    assert!(!t_big.contains("step_1") && !t_big.contains("step_90"), "{t_big}");
    assert!(t_big.lines().count() <= 20, "unexpected line count: {t_big}");

    // Fix 4: Out-of-bounds / zero @ordinal exits 1 with diagnostic
    for sel in [
        "src/single.ts:onlyOne@2",
        "src/single.ts:onlyOne@0",
        "src/single.ts:onlyOne@99",
        "src/single.ts:onlyOn@2",
        "src/single.ts:runLoop@77",
    ] {
        let out = tw.run_isolated(&["read", sel], true);
        assert_eq!(out.status.code(), Some(1), "expected exit 1 for {sel}");
        assert!(!stderr_str(&out).is_empty(), "missing diagnostic for {sel}");
    }

    // Fix 5: Late NUL past 8192 bytes blocked in read, search, and find
    let rn = tw.run_isolated(&["read", "src/late_nul.txt"], true);
    assert_eq!(rn.status.code(), Some(0));
    assert!(!rn.stdout.contains(&0u8));
    assert!(stdout_str(&rn).contains("binary file skipped"));
    assert!(!stdout_str(&rn).contains("LATE_NUL"));
    let sn = tw.run_isolated(&["search", "LATE_NUL"], true);
    assert_eq!(sn.status.code(), Some(0));
    assert!(!sn.stdout.contains(&0u8));
    assert!(!stdout_str(&sn).contains("LATE_NUL"));
    let fn_out = tw.run_isolated(&["find"], true);
    assert_eq!(fn_out.status.code(), Some(0));
    assert!(!stdout_str(&fn_out).contains("late_nul.txt"), "find leaked late_nul: {}", stdout_str(&fn_out));

    // Fix 7: read --outline -d 2 does not trigger --deps
    let ro = tw.run_isolated(&["read", "src/app.ts", "--outline", "-d", "2"], true);
    assert_eq!(ro.status.code(), Some(0));
    assert!(!stdout_str(&ro).contains("src/math.ts"));

    // Fix 8: find --max-tokens 20 & --max-tokens 0 stay within budget
    for i in 0..10 {
        tw.write_file(&format!("src/pad_{i}.ts"), "export const x = 1;\n");
    }
    let f20 = tw.run_isolated(&["find", "--max-tokens", "20"], true);
    assert_eq!(f20.status.code(), Some(0));
    let f20_txt = stdout_str(&f20);
    assert!(count_cl100k(&f20_txt) <= 20, "f20_txt={f20_txt}");
    assert!(f20_txt.contains("more entries"), "f20_txt={f20_txt}");

    // Fix 9: 0-byte invalid selectors exit 1, find <dir> "sub/*.ts", --outline-target
    assert_eq!(tw.run_isolated(&["read", "src/empty.ts:L50-L10"], true).status.code(), Some(1));
    assert_eq!(tw.run_isolated(&["read", "src/empty.ts:NoSuchSym"], true).status.code(), Some(1));

    let f_sub = tw.run_isolated(&["find", "src", "sub/*.ts"], true);
    assert_eq!(f_sub.status.code(), Some(0), "{}", stderr_str(&f_sub));
    let f_sub_txt = stdout_str(&f_sub);
    assert!(f_sub_txt.contains("src/sub/deep.ts"), "{f_sub_txt}");
    assert!(!f_sub_txt.contains("math.ts"), "{f_sub_txt}");

    let ot = tw.run_isolated(&["read", "src/math.ts", "--outline-target"], true);
    assert_eq!(ot.status.code(), Some(0));
    let ot_txt = stdout_str(&ot);
    assert!(ot_txt.contains("Calculator") && ot_txt.contains("Calculator.add"));
    assert!(!ot_txt.contains("label: \"sum\""), "{ot_txt}");
}

#[test]
fn w5_m3_unreadable_perm_and_search_tight_budget_honesty_cli() {
    let tw = TempWorkspace::new("w5_m3_rsf");
    tw.write_file("aice.config.json", "{\"enabled\":true}\n");
    for i in 0..5 {
        tw.write_file(
            &format!("f{i}.ts"),
            &format!("export function hitFn{i}(): number {{ return {i}; }} // HIT_ME\n"),
        );
    }

    // C2-G1: 0o000 unreadable .rs exits 1 with permission diagnostic (never binary skip)
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        tw.write_file("unreadable.rs", "pub fn secret() {}\n");
        let p = tw.ws().join("unreadable.rs");
        fs::set_permissions(&p, fs::Permissions::from_mode(0o000)).unwrap();
        let out = tw.run_isolated(&["read", "unreadable.rs"], true);
        let _ = fs::set_permissions(&p, fs::Permissions::from_mode(0o644));
        assert_eq!(out.status.code(), Some(1));
        assert!(stderr_str(&out).contains("Failed reading unreadable.rs"), "{}", stderr_str(&out));
        assert!(!stdout_str(&out).contains("binary file skipped"));
    }

    // C2-G3: search HIT_ME -l --max-tokens 5 logs zero fake savings & empty mf in gains.jsonl
    let _ = fs::remove_file(&tw.telemetry_path);
    let sl5 = tw.run_isolated(&["search", "HIT_ME", "-l", "--max-tokens", "5"], true);
    assert_eq!(sl5.status.code(), Some(0));
    assert!(count_cl100k(&stdout_str(&sl5)) <= 5, "{}", stdout_str(&sl5));
    let gains_raw = fs::read_to_string(&tw.telemetry_path).expect("read gains.jsonl");
    let row = parse_json(gains_raw.lines().next().unwrap()).unwrap();
    assert!(field(&row, "mf").is_none(), "must not log omitted mf: {gains_raw}");
    assert_eq!(field(&row, "n1").and_then(JsonValue::as_f64), Some(0.0), "{gains_raw}");

    let sl5_json = tw.run_isolated(&["search", "HIT_ME", "-l", "--max-tokens", "5", "--json"], true);
    assert_eq!(sl5_json.status.code(), Some(0));
    let sl5_parsed = parse_json(&stdout_str(&sl5_json)).unwrap();
    assert_eq!(field(&sl5_parsed, "count").and_then(JsonValue::as_f64), Some(0.0));

    let s15 = tw.run_isolated(&["search", "HIT_ME", "--max-tokens", "15"], true);
    assert_eq!(s15.status.code(), Some(0));
    assert!(!stdout_str(&s15).contains("f0.ts:\n// +"), "{}", stdout_str(&s15));
    assert!(count_cl100k(&stdout_str(&s15)) <= 15, "{}", stdout_str(&s15));

    // C1-R2-G1: targeted omitted/0-match search must NOT log `mf` in gains.jsonl
    let _ = fs::remove_file(&tw.telemetry_path);
    for args in [
        &["search", "HIT_ME", "f0.ts", "-l", "--max-tokens", "1"][..],
        &["search", "HIT_ME", "f0.ts", "--max-tokens", "5"][..],
        &["search", "NO_MATCH_XYZ", "f0.ts"][..],
    ] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr_str(&out));
    }
    let c1_rows = fs::read_to_string(&tw.telemetry_path).expect("read gains.jsonl");
    assert_eq!(c1_rows.lines().count(), 3, "{c1_rows}");
    for line in c1_rows.lines() {
        let row = parse_json(line).unwrap();
        assert!(field(&row, "mf").is_none(), "C1-R2-G1 leaked mf: {line}");
        assert_eq!(field(&row, "n1").and_then(JsonValue::as_f64), Some(0.0), "{line}");
    }

    // C2-R2-G1: module <lang> / # L... must not count as search hit content (Rust 15, TS 25, 60 --stats)
    let _ = fs::remove_file(&tw.telemetry_path);
    for i in 0..5 {
        tw.write_file(&format!("mod_{i}.rs"), &format!("pub fn fn_{i}() -> usize {{ /* needle_marker */ {i} }}\n"));
    }
    let ts_ten: String = (0..10).map(|i| format!("export function tsFn{i}(): number {{ return {i}; }} // TARGET_WORD\n")).collect();
    tw.write_file("app.ts", &ts_ten);
    tw.write_file("a.rs", "pub fn alpha(x: i32) -> i32 { x + 1 } // findme_c2\n");

    let rs15 = tw.run_isolated(&["search", "needle_marker", "--max-tokens", "15"], true);
    assert_eq!(rs15.status.code(), Some(0));
    assert!(!stdout_str(&rs15).contains("module rust"), "{}", stdout_str(&rs15));

    let rs15_json = tw.run_isolated(&["search", "needle_marker", "--max-tokens", "15", "--json"], true);
    assert_eq!(rs15_json.status.code(), Some(0));
    let rs15_p = parse_json(&stdout_str(&rs15_json)).unwrap();
    assert_eq!(field(&rs15_p, "count").and_then(JsonValue::as_f64), Some(0.0));

    let ts25 = tw.run_isolated(&["search", "TARGET_WORD", "--max-tokens", "25"], true);
    assert_eq!(ts25.status.code(), Some(0));
    assert!(!stdout_str(&ts25).contains("module typescript"), "{}", stdout_str(&ts25));

    let s60 = tw.run_isolated(&["search", "findme_c2", "--max-tokens", "60", "--stats"], true);
    assert_eq!(s60.status.code(), Some(0));
    assert!(!stdout_str(&s60).contains("module rust\n// ..."), "{}", stdout_str(&s60));
    assert!(count_cl100k(&stdout_str(&s60)) <= 60, "{}", stdout_str(&s60));

    let c2_rows = fs::read_to_string(&tw.telemetry_path).expect("read gains.jsonl");
    for line in c2_rows.lines() {
        let row = parse_json(line).unwrap();
        let mf_none = field(&row, "mf").is_none();
        let rs_val = field(&row, "rs").and_then(JsonValue::as_f64).unwrap_or(0.0);
        if mf_none {
            assert!(rs_val <= 0.0, "0-hit search logged fake savings: {line}");
        }
    }

    // C2-R2-G3: late invalid UTF-8 (> 8192B, no NUL) parity across find / read / search + 64 KiB split UTF-8 positive control
    let mut late_bad = b"hello_utf8_r2\n".to_vec();
    late_bad.extend(std::iter::repeat_n(b'a', 9000));
    late_bad.extend_from_slice(b"\xff\xfe\xfd\n");
    tw.write_bytes("late_bad_utf8.txt", &late_bad);

    let mut split_64k = vec![b'a'; 65_534];
    split_64k.extend_from_slice("🦀".as_bytes());
    split_64k.extend_from_slice(b"\nhello_utf8_r2\n");
    tw.write_bytes("split_64k.txt", &split_64k);

    let f_out = tw.run_isolated(&["find"], true);
    assert_eq!(f_out.status.code(), Some(0));
    let f_txt = stdout_str(&f_out);
    assert!(!f_txt.contains("late_bad_utf8.txt"), "find leaked late_bad_utf8: {f_txt}");
    assert!(f_txt.contains("split_64k.txt"), "find dropped valid 64KiB split UTF-8: {f_txt}");

    let r_bad = tw.run_isolated(&["read", "late_bad_utf8.txt"], true);
    assert_eq!(r_bad.status.code(), Some(0));
    assert!(stdout_str(&r_bad).contains("binary file skipped"));

    let s_utf8 = tw.run_isolated(&["search", "hello_utf8_r2"], true);
    assert_eq!(s_utf8.status.code(), Some(0));
    let s_txt = stdout_str(&s_utf8);
    assert!(!s_txt.contains("late_bad_utf8.txt"), "{s_txt}");
    assert!(s_txt.contains("split_64k.txt"), "{s_txt}");
}
