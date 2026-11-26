use std::fs;
use std::path::PathBuf;

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_ast_engine::intra_ast::{extract_intra_blocks, extract_intra_blocks_in_span};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, IntraBlockKind, IntraBlockSelector, LanguageId, SyntaxFirewall};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn ts_big_divisible_branch_and_missing_block_error() {
    let reg = EngineRegistry::new();
    let big = fs::read_to_string(workspace_root().join("tests/golden/fixtures/src/big.ts")).unwrap();
    let adapter = reg.adapter(LanguageId::TypeScript).unwrap();
    let slicer = reg.slicer(LanguageId::TypeScript).unwrap();
    let tree = adapter.parse_cst(&big).unwrap();

    let div = slicer
        .slice_intra_block(
            &tree,
            &big,
            &IntraBlockSelector {
                symbol: "runBatchPipeline".to_string(),
                pattern: "divisible".to_string(),
            },
        )
        .unwrap();
    assert!(div.content.contains("export function runBatchPipeline"), "missing header: {}", div.content);
    assert!(div.content.contains("divisible-${idx}"), "missing branch: {}", div.content);
    assert!(!div.content.contains("fold50"), "bled into try block: {}", div.content);

    let err = slicer
        .slice_intra_block(
            &tree,
            &big,
            &IntraBlockSelector {
                symbol: "runBatchPipeline".to_string(),
                pattern: "nonexistent_block_xyz".to_string(),
            },
        )
        .unwrap_err();
    assert!(err.message.contains("nonexistent_block_xyz"));
}

#[test]
fn ts_monolith_closure_normalize_and_nested_branch_777() {
    let reg = EngineRegistry::new();
    let mono = fs::read_to_string(workspace_root().join("tests/e2e/fixtures/graph/monolith.ts")).unwrap();
    let adapter = reg.adapter(LanguageId::TypeScript).unwrap();
    let slicer = reg.slicer(LanguageId::TypeScript).unwrap();
    let tree = adapter.parse_cst(&mono).unwrap();

    let norm = slicer
        .slice_intra_block(
            &tree,
            &mono,
            &IntraBlockSelector {
                symbol: "processBatchMonolith".to_string(),
                pattern: "normalize".to_string(),
            },
        )
        .unwrap();
    assert!(norm.content.contains("normalize"), "missing normalize: {}", norm.content);
    assert!(!norm.content.contains("f35"), "bled into try checksum loop: {}", norm.content);

    let nested = concat!(
        "export function processTree(items: number[], mode: string): number[] {\n",
        "  if (mode === \"deep_target_branch\") {\n",
        "    return items.map((item) => {\n",
        "      if (item > 0) {\n",
        "        return item * 777;\n",
        "      }\n",
        "      return 0;\n",
        "    });\n",
        "  }\n",
        "  if (mode === \"shallow_sibling_branch\") {\n",
        "    return [999];\n",
        "  }\n",
        "  return [];\n",
        "}\n",
    );
    let ntree = adapter.parse_cst(nested).unwrap();
    let nslice = slicer
        .slice_intra_block(
            &ntree,
            nested,
            &IntraBlockSelector {
                symbol: "processTree".to_string(),
                pattern: "deep_target_branch".to_string(),
            },
        )
        .unwrap();
    assert!(nslice.content.contains("777"), "missing 777: {}", nslice.content);
    assert!(!nslice.content.contains("999"), "included sibling branch: {}", nslice.content);
}

#[test]
fn r5_multi_language_intra_blocks_verified_node_kinds() {
    let reg = EngineRegistry::new();

    // Rust: try_block is ErrorHandler, '?' try_expression is NOT
    let rs = "fn demo(x: Option<i32>) -> i32 {\n  let y = x?;\n  for i in 0..3 {\n    if i == y {\n      let f = |v| v + 1;\n      return f(i);\n    }\n  }\n  0\n}\n";
    let rs_tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(rs).unwrap();
    let rs_blocks = extract_intra_blocks(&rs_tree, rs);
    assert!(rs_blocks.iter().any(|b| b.kind == IntraBlockKind::Loop));
    assert!(rs_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(rs_blocks.iter().any(|b| b.kind == IntraBlockKind::Closure));
    assert!(!rs_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler), "x? must not be ErrorHandler: {rs_blocks:?}");

    // Python
    let py = "def run(items):\n    try:\n        for x in items:\n            if x > 0:\n                fn_ = lambda v: v * 2\n                return fn_(x)\n    except Exception:\n        return 0\n";
    let py_tree = reg.adapter(LanguageId::Python).unwrap().parse_cst(py).unwrap();
    let py_blocks = extract_intra_blocks(&py_tree, py);
    assert!(py_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));
    assert!(py_blocks.iter().any(|b| b.kind == IntraBlockKind::Loop));
    assert!(py_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(py_blocks.iter().any(|b| b.kind == IntraBlockKind::Closure));

    // Go (type_switch_statement, defer_statement, func_literal, for_statement)
    let go = "package main\nfunc work(v any) {\n  defer func() {}()\n  switch v.(type) {\n  case int:\n    for i := 0; i < 2; i++ {}\n  }\n}\n";
    let go_tree = reg.adapter(LanguageId::Go).unwrap().parse_cst(go).unwrap();
    let go_blocks = extract_intra_blocks(&go_tree, go);
    assert!(go_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));
    assert!(go_blocks.iter().any(|b| b.kind == IntraBlockKind::Closure));
    assert!(go_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(go_blocks.iter().any(|b| b.kind == IntraBlockKind::Loop));

    // Java switch_expression + Kotlin when/try + Ruby begin/rescue
    let java = "class A { int m(int x) { try { return switch (x) { case 1 -> 10; default -> 0; }; } catch (Exception e) { return -1; } } }\n";
    let j_tree = reg.adapter(LanguageId::Java).unwrap().parse_cst(java).unwrap();
    let j_blocks = extract_intra_blocks(&j_tree, java);
    assert!(j_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(j_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));

    let kt = "fun k(x: Int): Int { return try { when (x) { 1 -> 2 else -> 3 } } catch (e: Exception) { 0 } }\n";
    let k_tree = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt).unwrap();
    let k_blocks = extract_intra_blocks(&k_tree, kt);
    assert!(k_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(k_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));

    let rb = "class R\n  def m\n    begin\n      [1].each do |x|\n        puts x\n      end\n    rescue => e\n      nil\n    end\n  end\nend\n";
    let rb_tree = reg.adapter(LanguageId::Ruby).unwrap().parse_cst(rb).unwrap();
    let rb_blocks = extract_intra_blocks(&rb_tree, rb);
    assert!(rb_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));
    assert!(rb_blocks.iter().any(|b| b.kind == IntraBlockKind::Closure));
}

#[test]
fn rd_dialects_intra_blocks_and_slicing() {
    let reg = EngineRegistry::new();

    // Twig: @else excludes if/elseif arms
    let twig = "{% block body %}\n{% if a %}\n  ALPHA\n{% elseif b %}\n  BETA\n{% else %}\n  GAMMA\n{% endif %}\n{% for item in items %}\n  {{ item }}\n{% endfor %}\n{% endblock %}\n";
    let tw_tree = reg.adapter(LanguageId::Twig).unwrap().parse_cst(twig).unwrap();
    let tw_else = reg
        .slicer(LanguageId::Twig)
        .unwrap()
        .slice_intra_block(&tw_tree, twig, &IntraBlockSelector { symbol: "body".into(), pattern: "else".into() })
        .unwrap();
    assert!(tw_else.content.contains("GAMMA"), "twig else missing GAMMA: {}", tw_else.content);
    assert!(!tw_else.content.contains("ALPHA"), "twig else bled into ALPHA: {}", tw_else.content);
    assert!(!tw_else.content.contains("BETA"), "twig else bled into BETA: {}", tw_else.content);

    // PostgreSQL: DO $$ ... $$ + LOOP + IF + EXCEPTION (must ignore RAISE EXCEPTION)
    let pg_do = "DO $$\nBEGIN\n  FOR i IN 1..3 LOOP\n    IF i = 2 THEN\n      RAISE EXCEPTION 'boom';\n    END IF;\n  END LOOP;\nEXCEPTION\n  WHEN others THEN\n    NULL;\nEND;\n$$;\n";
    let pg_tree = reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(pg_do).unwrap();
    let pg_blocks = extract_intra_blocks(&pg_tree, pg_do);
    assert!(pg_blocks.iter().any(|b| b.kind == IntraBlockKind::Loop));
    assert!(pg_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(pg_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "EXCEPTION"));

    // MySQL: DELIMITER //, IF/ELSEIF/ELSE, labeled LOOP, DECLARE HANDLER
    let mysql = "DELIMITER //\nCREATE PROCEDURE p()\nBEGIN\n  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION SET @e = 1;\n  IF @a > 0 THEN\n    SET @x = 1;\n  ELSE\n    SET @x = 2;\n  END IF;\n  l1: LOOP\n    LEAVE l1;\n  END LOOP l1;\nEND //\nDELIMITER ;\n";
    let my_tree = reg.adapter(LanguageId::MySql).unwrap().parse_cst(mysql).unwrap();
    let my_blocks = extract_intra_blocks(&my_tree, mysql);
    assert!(my_blocks.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler));
    assert!(my_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(my_blocks.iter().any(|b| b.kind == IntraBlockKind::Loop));
    let my_else = reg
        .slicer(LanguageId::MySql)
        .unwrap()
        .slice_intra_block(&my_tree, mysql, &IntraBlockSelector { symbol: "p".into(), pattern: "ELSE".into() })
        .unwrap();
    assert!(my_else.content.contains("SET @x = 2;"));
    assert!(!my_else.content.contains("SET @x = 1;"));

    // SQLite trigger + CTE + CASE
    let sqlite = "WITH c AS (SELECT 1 AS v) SELECT CASE WHEN v > 0 THEN (SELECT 2) ELSE 0 END FROM c;\nCREATE TRIGGER tr AFTER INSERT ON t BEGIN UPDATE t SET x = 1; END;\n";
    let sq_tree = reg.adapter(LanguageId::Sqlite).unwrap().parse_cst(sqlite).unwrap();
    let sq_blocks = extract_intra_blocks(&sq_tree, sqlite);
    assert!(sq_blocks.iter().any(|b| b.kind == IntraBlockKind::Cte));
    assert!(sq_blocks.iter().any(|b| b.kind == IntraBlockKind::Subquery));
    assert!(sq_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));
    assert!(sq_blocks.iter().any(|b| b.kind == IntraBlockKind::RuleBlock));

    // Migration: StatementBegin..StatementEnd + Postgres DO $$
    let mig = "-- +goose Up\n-- +goose StatementBegin\nDO $$\nBEGIN\n  IF true THEN PERFORM 1; END IF;\nEND;\n$$;\n-- +goose StatementEnd\n-- +goose Down\nSELECT 1;\n";
    let mig_tree = reg.adapter(LanguageId::DbMigration).unwrap().parse_cst(mig).unwrap();
    let mig_blocks = extract_intra_blocks(&mig_tree, mig);
    assert!(mig_blocks.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "StatementBegin"));
    assert!(mig_blocks.iter().any(|b| b.kind == IntraBlockKind::Branch));

    // Span filter sanity
    let sub = extract_intra_blocks_in_span(&sq_tree, sqlite, 0, 28);
    assert!(sub.iter().all(|b| b.end_byte <= 28));
}

#[test]
fn deep_4500_intra_ast_on_2mib_stack() {
    std::thread::Builder::new()
        .name("intra_ast_2mib".into())
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let reg = EngineRegistry::new();
            let d = 4_500;

            let ts = format!("function deep() {{ {}return 1;{} }}\n", "if (true) { ".repeat(d), " }".repeat(d));
            let ts_t = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(&ts).unwrap();
            assert!(extract_intra_blocks(&ts_t, &ts).len() >= d);

            let twig = format!("{{% block b %}}{}ok{}{{ % endblock %}}", "{% if ok %}".repeat(d), "{% endif %}".repeat(d))
                .replace("{ % endblock %}", "{% endblock %}");
            let tw_t = reg.adapter(LanguageId::Twig).unwrap().parse_cst(&twig).unwrap();
            assert!(extract_intra_blocks(&tw_t, &twig).len() >= d);

            let tsql = format!("CREATE PROC dbo.D AS {}SELECT 1;{}\n", "BEGIN ".repeat(d), "END ".repeat(d));
            let tsql_t = reg.adapter(LanguageId::TSql).unwrap().parse_cst(&tsql).unwrap();
            assert!(extract_intra_blocks(&tsql_t, &tsql).len() >= d);

            let pg = format!("CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$\n{}RETURN 1;{}\n$$;\n", "BEGIN ".repeat(d), "END; ".repeat(d));
            let pg_t = reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&pg).unwrap();
            assert!(extract_intra_blocks(&pg_t, &pg).len() >= d);
        })
        .unwrap()
        .join()
        .unwrap();
}

#[test]
fn regression_w3m2_utf8_word_match_tsql_else_case_and_mysql_delimiter_id() {
    let reg = EngineRegistry::new();
    let ts_adp = reg.adapter(LanguageId::TypeScript).unwrap();
    let ts_sl = reg.slicer(LanguageId::TypeScript).unwrap();

    // 1a. Multi-byte UTF-8 case-sensitive pattern must not panic in label_word_matches
    let utf8_no_hit = "function f() {\n  if (baöXböX === 1) {\n    return 1;\n  }\n}\n";
    let t1 = ts_adp.parse_cst(utf8_no_hit).unwrap();
    let s1 = ts_sl
        .slice_intra_block(&t1, utf8_no_hit, &IntraBlockSelector { symbol: "f".into(), pattern: "öX".into() })
        .unwrap();
    assert!(s1.content.contains("baöXböX"));

    let utf8_hit = "function f() {\n  if (baöXböX === 1) {\n    return 999;\n  }\n  if (éA_1 || éA) {\n    return 42;\n  }\n}\n";
    let t2 = ts_adp.parse_cst(utf8_hit).unwrap();
    let s2 = ts_sl
        .slice_intra_block(&t2, utf8_hit, &IntraBlockSelector { symbol: "f".into(), pattern: "éA".into() })
        .unwrap();
    assert!(s2.content.contains("42") && !s2.content.contains("999"));

    // 1b. Non-ASCII label with emoji keeps Tier-0 word-boundary match for ASCII "target"
    let emoji_src = concat!(
        "function f(flag: boolean, target_unrelated: boolean, target: boolean) {\n",
        "  if (target_unrelated) {\n",
        "    return 999;\n",
        "  }\n",
        "  if (flag /* 🚀 */ && target) {\n",
        "    return 777;\n",
        "  }\n",
        "  return 0;\n",
        "}\n",
    );
    let t3 = ts_adp.parse_cst(emoji_src).unwrap();
    let s3 = ts_sl
        .slice_intra_block(&t3, emoji_src, &IntraBlockSelector { symbol: "f".into(), pattern: "target".into() })
        .unwrap();
    assert!(s3.content.contains("777") && !s3.content.contains("999"), "wrong branch: {}", s3.content);

    // 2a. T-SQL END; ELSE keeps If frame open and isolates ELSE arm
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();
    let tsql_else_src = concat!(
        "CREATE PROCEDURE dbo.SemiElse @X INT AS\n",
        "BEGIN\n",
        "  IF @X > 0\n",
        "  BEGIN\n",
        "    SELECT 'POS';\n",
        "  END;\n",
        "  ELSE\n",
        "  BEGIN\n",
        "    SELECT 'NEG';\n",
        "  END;\n",
        "END;\n",
    );
    let t4 = tsql_adp.parse_cst(tsql_else_src).unwrap();
    let s4 = tsql_sl
        .slice_intra_block(&t4, tsql_else_src, &IntraBlockSelector { symbol: "SemiElse".into(), pattern: "ELSE".into() })
        .unwrap();
    assert!(s4.content.contains("NEG") && !s4.content.contains("POS"), "END; ELSE bled: {}", s4.content);

    // 2b. T-SQL single-statement IF containing CASE ... END does not close early on CASE's END
    let tsql_case_src = concat!(
        "CREATE PROCEDURE dbo.CaseInsideIf @X INT AS\n",
        "BEGIN\n",
        "  IF @X = 1\n",
        "    SELECT CASE WHEN @X > 0 THEN 1 ELSE 2 END;\n",
        "  SELECT 'AFTER';\n",
        "END;\n",
    );
    let t5 = tsql_adp.parse_cst(tsql_case_src).unwrap();
    let blocks5 = extract_intra_blocks(&t5, tsql_case_src);
    let if_blk = blocks5.iter().find(|b| b.kind == IntraBlockKind::Branch && b.label.contains("IF")).unwrap();
    assert_eq!(if_blk.start_line, 3);
    assert_eq!(if_blk.end_line, 4);
    assert!(blocks5.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "CASE"));

    // 3. MySQL identifier starting with "delimiter_" must not be masked as DELIMITER directive
    let my_adp = reg.adapter(LanguageId::MySql).unwrap();
    let my_sl = reg.slicer(LanguageId::MySql).unwrap();
    let my_src = "CREATE PROCEDURE p()\nBEGIN\n  IF delimiter_id > 0 THEN\n    SELECT 42;\n  END IF;\nEND;\n";
    let t6 = my_adp.parse_cst(my_src).unwrap();
    let s6 = my_sl
        .slice_intra_block(&t6, my_src, &IntraBlockSelector { symbol: "p".into(), pattern: "delimiter_id".into() })
        .unwrap();
    assert!(s6.content.contains("delimiter_id") && s6.content.contains("42"));
}

#[test]
fn regression_w3m2_r3_tsql_nested_else_if_no_semi_and_unicode_combining_marks() {
    let reg = EngineRegistry::new();
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();

    // 1a. NestedElseIfNoSemi: stacked IF / ELSE IF without trailing ';' must pop completely at END
    let nested_src = concat!(
        "CREATE PROCEDURE dbo.NestedElseIfNoSemi @A INT, @X INT AS\n",
        "BEGIN\n",
        "  IF @A > 0\n",
        "  BEGIN\n",
        "    IF @X = 1\n",
        "    BEGIN\n",
        "      SELECT 'ONE'\n",
        "    END\n",
        "    ELSE IF @X = 2\n",
        "    BEGIN\n",
        "      SELECT 'TWO'\n",
        "    END\n",
        "  END\n",
        "  ELSE\n",
        "  BEGIN\n",
        "    SELECT 'OUTER_ELSE'\n",
        "  END\n",
        "END\n",
    );
    let t1 = tsql_adp.parse_cst(nested_src).unwrap();
    let blocks1 = extract_intra_blocks(&t1, nested_src);
    assert!(
        blocks1.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 18),
        "missing proc BEGIN L2..L18: {blocks1:?}"
    );
    assert!(
        blocks1.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "ELSE" && b.start_line == 14 && b.end_line == 17),
        "missing outer ELSE L14..L17: {blocks1:?}"
    );
    let outer_else = tsql_sl
        .slice_intra_block(&t1, nested_src, &IntraBlockSelector { symbol: "NestedElseIfNoSemi".into(), pattern: "OUTER_ELSE".into() })
        .unwrap();
    assert!(outer_else.content.contains("OUTER_ELSE") && !outer_else.content.contains("TWO"), "bleed: {}", outer_else.content);

    // 1b. SimpleElseIfNoSemi: ELSE IF without ';' must not bleed into trailing SELECT 'AFTER'
    let simple_src = concat!(
        "CREATE PROCEDURE dbo.SimpleElseIfNoSemi @X INT AS\n",
        "BEGIN\n",
        "  IF @X = 1\n",
        "  BEGIN\n",
        "    SELECT 'ONE'\n",
        "  END\n",
        "  ELSE IF @X = 2\n",
        "  BEGIN\n",
        "    SELECT 'TWO'\n",
        "  END\n",
        "  SELECT 'AFTER'\n",
        "END\n",
    );
    let t2 = tsql_adp.parse_cst(simple_src).unwrap();
    let simple_else = tsql_sl
        .slice_intra_block(&t2, simple_src, &IntraBlockSelector { symbol: "SimpleElseIfNoSemi".into(), pattern: "ELSE".into() })
        .unwrap();
    assert!(simple_else.content.contains("TWO"), "missing TWO: {}", simple_else.content);
    assert!(!simple_else.content.contains("ONE"), "bled into ONE: {}", simple_else.content);
    assert!(!simple_else.content.contains("AFTER"), "bled into AFTER: {}", simple_else.content);

    // 2. Combining marks: Turkish 'İ' ("i\u{0307}") must not word-match ASCII "i"
    let ts_adp = reg.adapter(LanguageId::TypeScript).unwrap();
    let ts_sl = reg.slicer(LanguageId::TypeScript).unwrap();
    let turkish_src = concat!(
        "function f(İ: boolean, i: boolean, flag: boolean) {\n",
        "  if (İ) {\n",
        "    return 111;\n",
        "  }\n",
        "  if (flag && i) {\n",
        "    return 222;\n",
        "  }\n",
        "  return 0;\n",
        "}\n",
    );
    let t3 = ts_adp.parse_cst(turkish_src).unwrap();
    let s_i = ts_sl
        .slice_intra_block(&t3, turkish_src, &IntraBlockSelector { symbol: "f".into(), pattern: "i".into() })
        .unwrap();
    assert!(s_i.content.contains("222") && !s_i.content.contains("111"), "İ falsely matched i: {}", s_i.content);
    let s_cap_i = ts_sl
        .slice_intra_block(&t3, turkish_src, &IntraBlockSelector { symbol: "f".into(), pattern: "İ".into() })
        .unwrap();
    assert!(s_cap_i.content.contains("111") && !s_cap_i.content.contains("222"), "İ failed: {}", s_cap_i.content);
}

#[test]
fn regression_w3m2_r4_tsql_end_catch_and_non_latin_marks() {
    let reg = EngineRegistry::new();
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();

    // 1. TryInIf (no ';')
    let try_in_if = concat!(
        "CREATE PROCEDURE dbo.TryInIf @A INT AS\n",
        "BEGIN\n",
        "  IF @A > 0\n",
        "  BEGIN TRY\n",
        "    SELECT 1\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    SELECT 2\n",
        "  END CATCH\n",
        "  SELECT 'AFTER_CATCH'\n",
        "END\n",
    );
    let t1 = tsql_adp.parse_cst(try_in_if).unwrap();
    let b1 = extract_intra_blocks(&t1, try_in_if);
    assert!(b1.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 11), "{b1:?}");
    assert!(b1.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "IF @A > 0" && b.start_line == 3 && b.end_line == 9), "{b1:?}");
    assert!(b1.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN TRY" && b.start_line == 4 && b.end_line == 6), "{b1:?}");
    assert!(b1.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN CATCH" && b.start_line == 7 && b.end_line == 9), "{b1:?}");
    let s1 = tsql_sl.slice_intra_block(&t1, try_in_if, &IntraBlockSelector { symbol: "TryInIf".into(), pattern: "IF".into() }).unwrap();
    assert!(s1.content.contains("END CATCH") && !s1.content.contains("AFTER_CATCH"), "{}", s1.content);

    // 2. TryInWhile (no ';')
    let try_in_while = concat!(
        "CREATE PROCEDURE dbo.TryInWhile @A INT AS\n",
        "BEGIN\n",
        "  WHILE @A > 0\n",
        "  BEGIN TRY\n",
        "    SELECT 1\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    SELECT 2\n",
        "  END CATCH\n",
        "  SELECT 'AFTER_WHILE'\n",
        "END\n",
    );
    let t2 = tsql_adp.parse_cst(try_in_while).unwrap();
    let b2 = extract_intra_blocks(&t2, try_in_while);
    assert!(b2.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 11), "{b2:?}");
    assert!(b2.iter().any(|b| b.kind == IntraBlockKind::Loop && b.label == "WHILE @A > 0" && b.start_line == 3 && b.end_line == 9), "{b2:?}");
    let s2 = tsql_sl.slice_intra_block(&t2, try_in_while, &IntraBlockSelector { symbol: "TryInWhile".into(), pattern: "WHILE".into() }).unwrap();
    assert!(s2.content.contains("END CATCH") && !s2.content.contains("AFTER_WHILE"), "{}", s2.content);

    // 3. TryInIfElse (no ';', END CATCH followed by ELSE)
    let try_in_if_else = concat!(
        "CREATE PROCEDURE dbo.TryInIfElse @A INT AS\n",
        "BEGIN\n",
        "  IF @A > 0\n",
        "  BEGIN TRY\n",
        "    SELECT 1\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    SELECT 2\n",
        "  END CATCH\n",
        "  ELSE\n",
        "  BEGIN\n",
        "    SELECT 'ELSE_BRANCH'\n",
        "  END\n",
        "END\n",
    );
    let t3 = tsql_adp.parse_cst(try_in_if_else).unwrap();
    let b3 = extract_intra_blocks(&t3, try_in_if_else);
    assert!(b3.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 14), "{b3:?}");
    assert!(b3.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "ELSE" && b.start_line == 10 && b.end_line == 13), "{b3:?}");
    let s3 = tsql_sl.slice_intra_block(&t3, try_in_if_else, &IntraBlockSelector { symbol: "TryInIfElse".into(), pattern: "ELSE".into() }).unwrap();
    assert!(s3.content.contains("ELSE_BRANCH") && !s3.content.contains("SELECT 1") && !s3.content.contains("SELECT 2"), "{}", s3.content);

    // 4. IfInTryCatch (no ';', IF inside BEGIN TRY & BEGIN CATCH)
    let if_in_try_catch = concat!(
        "CREATE PROCEDURE dbo.IfInTryCatch @A INT AS\n",
        "BEGIN\n",
        "  BEGIN TRY\n",
        "    IF @A > 0\n",
        "      SELECT 'IN_TRY'\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    IF @A < 0\n",
        "      SELECT 'IN_CATCH'\n",
        "  END CATCH\n",
        "END\n",
    );
    let t4 = tsql_adp.parse_cst(if_in_try_catch).unwrap();
    let b4 = extract_intra_blocks(&t4, if_in_try_catch);
    assert!(b4.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 11), "{b4:?}");
    assert!(b4.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN TRY" && b.start_line == 3 && b.end_line == 6), "{b4:?}");
    assert!(b4.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN CATCH" && b.start_line == 7 && b.end_line == 10), "{b4:?}");
    assert!(b4.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @A > 0") && b.end_line <= 5), "{b4:?}");
    assert!(b4.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @A < 0") && b.end_line <= 9), "{b4:?}");

    // 5. SeqEndThenIfWhile (no ';', END followed by IF and WHILE)
    let seq_src = concat!(
        "CREATE PROCEDURE dbo.SeqEndThenIfWhile @A INT AS\n",
        "BEGIN\n",
        "  IF @A > 0\n",
        "  BEGIN\n",
        "    SELECT 'FIRST'\n",
        "  END\n",
        "  IF @A > 1\n",
        "  BEGIN\n",
        "    SELECT 'SECOND'\n",
        "  END\n",
        "  WHILE @A > 0\n",
        "  BEGIN\n",
        "    SET @A = @A - 1\n",
        "  END\n",
        "END\n",
    );
    let t5 = tsql_adp.parse_cst(seq_src).unwrap();
    let b5 = extract_intra_blocks(&t5, seq_src);
    assert!(b5.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 15), "{b5:?}");
    assert!(b5.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "IF @A > 0" && b.start_line == 3 && b.end_line == 6), "{b5:?}");
    assert!(b5.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "IF @A > 1" && b.start_line == 7 && b.end_line == 10), "{b5:?}");
    assert!(b5.iter().any(|b| b.kind == IntraBlockKind::Loop && b.label == "WHILE @A > 0" && b.start_line == 11 && b.end_line == 14), "{b5:?}");
    let s5 = tsql_sl.slice_intra_block(&t5, seq_src, &IntraBlockSelector { symbol: "SeqEndThenIfWhile".into(), pattern: "SECOND".into() }).unwrap();
    assert!(s5.content.contains("SECOND") && !s5.content.contains("FIRST") && !s5.content.contains("SET @A"), "{}", s5.content);

    // 6. Non-Latin combining marks (Hebrew, Arabic, Devanagari) + German sharp S preservation
    let ts_adp = reg.adapter(LanguageId::TypeScript).unwrap();
    let ts_sl = reg.slicer(LanguageId::TypeScript).unwrap();
    for (marked, plain) in [("ב\u{05B8}", "ב"), ("ب\u{064E}", "ب"), ("क\u{094D}", "क")] {
        let src = format!("function f(a: any, b: any) {{\n  if ({marked}) {{ return 111; }}\n  if ({plain}) {{ return 222; }}\n  return 0;\n}}\n");
        let tree = ts_adp.parse_cst(&src).unwrap();
        let sl = ts_sl.slice_intra_block(&tree, &src, &IntraBlockSelector { symbol: "f".into(), pattern: plain.into() }).unwrap();
        assert!(sl.content.contains("222") && !sl.content.contains("111"), "{plain} matched {marked}: {}", sl.content);
    }
    let sharp = "function f(ß: boolean) {\n  if (ß) { return 333; }\n  return 0;\n}\n";
    let t_sharp = ts_adp.parse_cst(sharp).unwrap();
    let s_sharp = ts_sl.slice_intra_block(&t_sharp, sharp, &IntraBlockSelector { symbol: "f".into(), pattern: "ẞ".into() }).unwrap();
    assert!(s_sharp.content.contains("333"), "{}", s_sharp.content);
}

#[test]
fn regression_w3m2_r6_tsql_single_stmt_before_end_and_header_guard() {
    let reg = EngineRegistry::new();
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();

    // 1. OuterIfInnerSingleIf: bare END closes inner BEGIN after unwinding inner single-stmt IF
    let outer_inner = concat!(
        "CREATE PROCEDURE dbo.OuterIfInnerSingleIf @A INT, @X INT AS\n",
        "BEGIN\n",
        "  IF @A > 0\n",
        "  BEGIN\n",
        "    IF @X = 1\n",
        "      SELECT 'INNER'\n",
        "  END\n",
        "  ELSE\n",
        "    SELECT 'OUTER_ELSE'\n",
        "END\n",
    );
    let t1 = tsql_adp.parse_cst(outer_inner).unwrap();
    assert!(!t1.has_error());
    let b1 = extract_intra_blocks(&t1, outer_inner);
    assert!(
        b1.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 10),
        "missing outer BEGIN L2..L10: {b1:?}"
    );
    assert!(
        b1.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 4 && b.end_line == 7),
        "missing inner BEGIN L4..L7: {b1:?}"
    );
    let inner_if = b1
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.start_line == 5 && b.end_line == 6)
        .unwrap_or_else(|| panic!("missing inner IF L5..L6: {b1:?}"));
    assert_eq!(inner_if.label, "IF @X = 1 SELECT 'INNER'");
    assert!(!inner_if.label.contains("END") && !inner_if.label.contains("ELSE"));
    assert!(
        b1.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "ELSE" && b.start_line == 8 && b.end_line == 9),
        "missing outer ELSE L8..L9: {b1:?}"
    );
    let slice_outer_else = tsql_sl
        .slice_intra_block(
            &t1,
            outer_inner,
            &IntraBlockSelector { symbol: "OuterIfInnerSingleIf".into(), pattern: "OUTER_ELSE".into() },
        )
        .unwrap();
    assert_eq!(
        slice_outer_else.content,
        concat!(
            "CREATE PROCEDURE dbo.OuterIfInnerSingleIf @A INT, @X INT AS\n",
            "// ... [L2-L7 skipped — 6 unrelated lines] ...\n",
            "  ELSE\n",
            "    SELECT 'OUTER_ELSE'\n",
            "// ... [L10-L10 skipped] ...",
        )
    );

    // 2. SingleStmtWhile: WHILE without BEGIN or ';' before END
    let single_while = concat!(
        "CREATE PROCEDURE dbo.SingleStmtWhile @W INT AS\n",
        "BEGIN\n",
        "  WHILE @W > 0\n",
        "    SET @W = @W - 1\n",
        "END\n",
    );
    let t2 = tsql_adp.parse_cst(single_while).unwrap();
    assert!(!t2.has_error());
    let b2 = extract_intra_blocks(&t2, single_while);
    assert!(
        b2.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 5),
        "missing BEGIN L2..L5: {b2:?}"
    );
    let w_blk = b2
        .iter()
        .find(|b| b.kind == IntraBlockKind::Loop && b.start_line == 3 && b.end_line == 4)
        .unwrap_or_else(|| panic!("missing WHILE L3..L4: {b2:?}"));
    assert_eq!(w_blk.label, "WHILE @W > 0 SET @W = @W - 1");
    assert!(!w_blk.label.contains("END"));

    // 3. SingleStmtElseIf: IF / ELSE IF / ELSE without BEGIN or ';' before END
    let single_else_if = concat!(
        "CREATE PROCEDURE dbo.SingleStmtElseIf @X INT AS\n",
        "BEGIN\n",
        "  IF @X = 1\n",
        "    SELECT 'S_ONE'\n",
        "  ELSE IF @X = 2\n",
        "    SELECT 'S_TWO'\n",
        "  ELSE\n",
        "    SELECT 'S_THREE'\n",
        "END\n",
    );
    let t3 = tsql_adp.parse_cst(single_else_if).unwrap();
    assert!(!t3.has_error());
    let b3 = extract_intra_blocks(&t3, single_else_if);
    assert!(
        b3.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 9),
        "missing BEGIN L2..L9: {b3:?}"
    );
    let arm1 = b3
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.start_line == 3 && b.end_line == 4)
        .unwrap_or_else(|| panic!("missing IF1 arm L3..L4: {b3:?}"));
    assert_eq!(arm1.label, "IF @X = 1 SELECT 'S_ONE'");
    let arm2 = b3
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.start_line == 5 && b.end_line == 6)
        .unwrap_or_else(|| panic!("missing IF2 arm L5..L6: {b3:?}"));
    assert_eq!(arm2.label, "IF @X = 2 SELECT 'S_TWO'");
    let slice_s_one = tsql_sl
        .slice_intra_block(
            &t3,
            single_else_if,
            &IntraBlockSelector { symbol: "SingleStmtElseIf".into(), pattern: "S_ONE".into() },
        )
        .unwrap();
    assert_eq!(
        slice_s_one.content,
        concat!(
            "CREATE PROCEDURE dbo.SingleStmtElseIf @X INT AS\n",
            "// ... [L2-L2 skipped — 1 unrelated lines] ...\n",
            "  IF @X = 1\n",
            "    SELECT 'S_ONE'\n",
            "// ... [L5-L9 skipped] ...",
        )
    );

    // 4. CASE inside single-statement IF without ';' before END + stray END inside TRY does not corrupt TRY
    let case_in_if = concat!(
        "CREATE PROCEDURE dbo.CaseNoSemi @X INT AS\n",
        "BEGIN\n",
        "  IF @X = 1\n",
        "    SELECT CASE WHEN @X > 0 THEN 1 ELSE 2 END\n",
        "END\n",
    );
    let t4 = tsql_adp.parse_cst(case_in_if).unwrap();
    let b4 = extract_intra_blocks(&t4, case_in_if);
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 5),
        "{b4:?}"
    );
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "CASE" && b.start_line == 4 && b.end_line == 4),
        "{b4:?}"
    );
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @X = 1") && b.start_line == 3 && b.end_line == 4),
        "{b4:?}"
    );

    // 5. Stray bare END without Begin/Case must not corrupt TRY frame
    let stray_end_in_try = concat!(
        "CREATE PROCEDURE dbo.StrayEnd @X INT AS\n",
        "BEGIN TRY\n",
        "  END\n",
        "  SELECT 1\n",
        "END TRY\n",
        "BEGIN CATCH\n",
        "  SELECT 2\n",
        "END CATCH\n",
    );
    let t5 = tsql_adp.parse_cst(stray_end_in_try).unwrap();
    let b5 = extract_intra_blocks(&t5, stray_end_in_try);
    assert!(
        b5.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN TRY" && b.start_line == 2 && b.end_line == 5),
        "{b5:?}"
    );
    assert!(
        b5.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN CATCH" && b.start_line == 6 && b.end_line == 8),
        "{b5:?}"
    );
}

#[test]
fn regression_w3m2_r7_tsql_if_exists_eof_and_stray_end_try_barrier() {
    let reg = EngineRegistry::new();
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();

    // 1. IF NOT EXISTS (...) with ELSE
    let if_not_exists = concat!(
        "CREATE PROCEDURE dbo.IfNotExistsProc @X INT AS\n",
        "BEGIN\n",
        "  IF NOT EXISTS (SELECT 1 FROM dbo.T WHERE a = @X)\n",
        "  BEGIN\n",
        "    INSERT INTO dbo.T (a) VALUES (@X)\n",
        "  END\n",
        "  ELSE\n",
        "  BEGIN\n",
        "    UPDATE dbo.T SET a = @X\n",
        "  END\n",
        "END\n",
    );
    let t1 = tsql_adp.parse_cst(if_not_exists).unwrap();
    assert!(!t1.has_error());
    let b1 = extract_intra_blocks(&t1, if_not_exists);
    assert!(
        b1.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF NOT EXISTS")),
        "missing Branch for IF NOT EXISTS: {b1:?}"
    );
    let s1_ins = tsql_sl
        .slice_intra_block(&t1, if_not_exists, &IntraBlockSelector { symbol: "IfNotExistsProc".into(), pattern: "INSERT".into() })
        .unwrap();
    assert!(s1_ins.content.contains("INSERT") && !s1_ins.content.contains("UPDATE"), "bleed: {}", s1_ins.content);
    let s1_else = tsql_sl
        .slice_intra_block(&t1, if_not_exists, &IntraBlockSelector { symbol: "IfNotExistsProc".into(), pattern: "ELSE".into() })
        .unwrap();
    assert!(s1_else.content.contains("UPDATE") && !s1_else.content.contains("INSERT"), "bleed: {}", s1_else.content);

    // 2. IF EXISTS (...) ELSE (single-statement arms) + negative DDL IF [NOT] EXISTS check
    let if_exists_else = concat!(
        "CREATE PROCEDURE dbo.IfExistsElse @X INT AS\n",
        "BEGIN\n",
        "  IF EXISTS (SELECT 1 FROM dbo.T WHERE a = @X)\n",
        "    SELECT 'FOUND'\n",
        "  ELSE\n",
        "    SELECT 'NOT_FOUND'\n",
        "END\n",
    );
    let t2 = tsql_adp.parse_cst(if_exists_else).unwrap();
    assert!(!t2.has_error());
    let b2 = extract_intra_blocks(&t2, if_exists_else);
    assert!(
        b2.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF EXISTS")),
        "missing Branch for IF EXISTS: {b2:?}"
    );
    let s2_nf = tsql_sl
        .slice_intra_block(&t2, if_exists_else, &IntraBlockSelector { symbol: "IfExistsElse".into(), pattern: "NOT_FOUND".into() })
        .unwrap();
    assert!(s2_nf.content.contains("NOT_FOUND") && !s2_nf.content.contains("'FOUND'"), "bleed: {}", s2_nf.content);

    for (lang, ddl) in [
        (LanguageId::TSql, "DROP TABLE IF EXISTS dbo.T;\n"),
        (LanguageId::MySql, "CREATE TABLE IF NOT EXISTS t (a INT);\n"),
        (LanguageId::PostgreSql, "ALTER TABLE t DROP COLUMN IF EXISTS a;\n"),
    ] {
        let dt = reg.adapter(lang).unwrap().parse_cst(ddl).unwrap();
        let db = extract_intra_blocks(&dt, ddl);
        assert!(!db.iter().any(|b| b.kind == IntraBlockKind::Branch), "DDL emitted spurious Branch: {db:?}");
    }

    // 3. BEGIN-less T-SQL IF ... ELSE and WHILE at EOF without ';'
    let no_begin_if = concat!(
        "CREATE PROCEDURE dbo.NoBeginProc @X INT AS\n",
        "IF @X = 1\n",
        "  SELECT 'YES'\n",
        "ELSE\n",
        "  SELECT 'NO'\n",
    );
    let t3 = tsql_adp.parse_cst(no_begin_if).unwrap();
    assert!(!t3.has_error());
    let b3 = extract_intra_blocks(&t3, no_begin_if);
    assert!(
        b3.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @X = 1") && b.start_line == 2),
        "missing Branch at EOF: {b3:?}"
    );
    assert!(
        b3.iter().any(|b| b.kind == IntraBlockKind::Branch && b.label == "ELSE" && b.start_line == 4 && b.end_line == 5),
        "missing ELSE at EOF: {b3:?}"
    );
    let s3_no = tsql_sl
        .slice_intra_block(&t3, no_begin_if, &IntraBlockSelector { symbol: "NoBeginProc".into(), pattern: "NO".into() })
        .unwrap();
    assert!(s3_no.content.contains("'NO'") && !s3_no.content.contains("'YES'"), "bleed: {}", s3_no.content);

    let no_begin_while = "CREATE PROCEDURE dbo.NoBeginWhile @X INT AS\nWHILE @X > 0\n  SET @X = @X - 1\n";
    let t3w = tsql_adp.parse_cst(no_begin_while).unwrap();
    let b3w = extract_intra_blocks(&t3w, no_begin_while);
    assert!(b3w.iter().any(|b| b.kind == IntraBlockKind::Loop && b.start_line == 2 && b.end_line == 3), "{b3w:?}");

    // 4. Stray END inside nested BEGIN -> BEGIN TRY ... END TRY must not steal outer BEGIN
    let stray_nested = concat!(
        "CREATE PROCEDURE dbo.StrayInNestedTry @X INT AS\n",
        "BEGIN\n",
        "  BEGIN TRY\n",
        "    END\n",
        "    SELECT 1\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    SELECT 2\n",
        "  END CATCH\n",
        "END\n",
    );
    let t4 = tsql_adp.parse_cst(stray_nested).unwrap();
    let b4 = extract_intra_blocks(&t4, stray_nested);
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::RuleBlock && b.label == "BEGIN" && b.start_line == 2 && b.end_line == 10),
        "outer BEGIN stolen across TRY barrier: {b4:?}"
    );
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN TRY" && b.start_line == 3 && b.end_line == 6),
        "{b4:?}"
    );
    assert!(
        b4.iter().any(|b| b.kind == IntraBlockKind::ErrorHandler && b.label == "BEGIN CATCH" && b.start_line == 7 && b.end_line == 9),
        "{b4:?}"
    );
}

#[test]
fn regression_w3m2_r12_tsql_and_migration_go_batch_splitting() {
    use std::path::Path;

    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_sl = reg.slicer(LanguageId::TSql).unwrap();

    // 1. T-SQL >8-line proc with BEGIN TRY/CATCH + un-semicoloned IF before GO
    let tsql_go = concat!(
        "CREATE PROCEDURE dbo.P1 @A INT AS\n",
        "BEGIN\n",
        "  BEGIN TRY\n",
        "    SELECT 1\n",
        "  END TRY\n",
        "  BEGIN CATCH\n",
        "    SELECT 2\n",
        "  END CATCH\n",
        "  IF @A = 1\n",
        "    SELECT 'IN_P1'\n",
        "END\n",
        "GO\n",
        "CREATE PROCEDURE dbo.P2 @B INT AS\n",
        "BEGIN\n",
        "  IF @B = 2\n",
        "    SELECT 'IN_P2'\n",
        "END\n",
    );
    assert_eq!(fw.verify(tsql_go, Path::new("p.sql"), LanguageId::TSql), FirewallVerdict::Valid);
    let t1 = tsql_adp.parse_cst(tsql_go).unwrap();
    let b1 = extract_intra_blocks(&t1, tsql_go);
    let if_p1 = b1
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @A = 1"))
        .unwrap_or_else(|| panic!("missing IF @A = 1: {b1:?}"));
    assert_eq!((if_p1.start_line, if_p1.end_line), (9, 10));

    // Also un-closed proc/IF right before GO (no END/no ';') must flush at GO
    let tsql_unclosed_go = concat!(
        "CREATE PROCEDURE dbo.P1 @A INT AS\n",
        "WITH c AS (SELECT 1 AS v)\n",
        "SELECT v FROM c;\n",
        "SELECT 1;\n",
        "SELECT 2;\n",
        "SELECT 3;\n",
        "SELECT 4;\n",
        "SELECT 5;\n",
        "IF @A = 1\n",
        "  SELECT 'IN_P1'\n",
        "GO 2\n",
        "CREATE PROCEDURE dbo.P2 @B INT AS\n",
        "IF @B = 2\n",
        "  SELECT 'IN_P2'\n",
        "GO -- batch comment\n",
        "SELECT 'AFTER_GO'\n",
    );
    assert_eq!(fw.verify(tsql_unclosed_go, Path::new("p_unclosed.sql"), LanguageId::TSql), FirewallVerdict::Valid);
    let t2 = tsql_adp.parse_cst(tsql_unclosed_go).unwrap();
    let b2 = extract_intra_blocks(&t2, tsql_unclosed_go);
    let if_u1 = b2
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @A = 1"))
        .unwrap_or_else(|| panic!("missing unclosed IF @A = 1: {b2:?}"));
    assert_eq!((if_u1.start_line, if_u1.end_line), (9, 10));
    let s_u1 = tsql_sl
        .slice_intra_block(&t2, tsql_unclosed_go, &IntraBlockSelector { symbol: "P1".into(), pattern: "IN_P1".into() })
        .unwrap();
    assert!(s_u1.content.contains("IN_P1") && !s_u1.content.contains("P2") && !s_u1.content.contains("IN_P2"), "{}", s_u1.content);

    // 2. Negative: 'GO' inside string literal, -- GO, /* GO */ must NOT split
    let tsql_fake_go = concat!(
        "CREATE PROCEDURE dbo.FakeGo @A INT AS\n",
        "BEGIN\n",
        "  IF @A = 1\n",
        "  BEGIN\n",
        "    SELECT '\nGO\n';\n",
        "    -- GO\n",
        "    /*\nGO\n    */\n",
        "    SELECT 'AFTER_FAKE_GO';\n",
        "  END\n",
        "END\n",
    );
    assert_eq!(fw.verify(tsql_fake_go, Path::new("fake_go.sql"), LanguageId::TSql), FirewallVerdict::Valid);
    let t3 = tsql_adp.parse_cst(tsql_fake_go).unwrap();
    let s3 = tsql_sl
        .slice_intra_block(&t3, tsql_fake_go, &IntraBlockSelector { symbol: "FakeGo".into(), pattern: "IF".into() })
        .unwrap();
    assert!(s3.content.contains("AFTER_FAKE_GO"), "fake GO split prematurely: {}", s3.content);

    // 3. DbMigration (-- +goose Up) with T-SQL GO batch separation
    let mig_adp = reg.adapter(LanguageId::DbMigration).unwrap();
    let mig_tsql = concat!(
        "-- +goose Up\n",
        "CREATE PROCEDURE dbo.M1 @X INT AS\n",
        "IF @X = 1\n",
        "  SELECT 'M1_ONLY'\n",
        "GO\n",
        "CREATE PROCEDURE dbo.M2 @Y INT AS\n",
        "IF @Y = 2\n",
        "  SELECT 'M2_ONLY'\n",
    );
    assert_eq!(fw.verify(mig_tsql, Path::new("V1__tsql.sql"), LanguageId::DbMigration), FirewallVerdict::Valid);
    let tm = mig_adp.parse_cst(mig_tsql).unwrap();
    let bm = extract_intra_blocks(&tm, mig_tsql);
    let m1_if = bm
        .iter()
        .find(|b| b.kind == IntraBlockKind::Branch && b.label.starts_with("IF @X = 1"))
        .unwrap_or_else(|| panic!("missing migration IF @X = 1: {bm:?}"));
    assert_eq!((m1_if.start_line, m1_if.end_line), (3, 4));
}

#[test]
fn regression_w3m5_error_handler_clause_ranking_shorter_finally() {
    let reg = EngineRegistry::new();
    let brace_cases: &[(LanguageId, &str)] = &[
        (LanguageId::TypeScript, "function f() {\n  try {\n    work();\n  } catch (err) {\n    log(err);\n    return -1;\n  } finally {\n    y = 1;\n  }\n}\n"),
        (LanguageId::JavaScript, "function f() {\n  try {\n    work();\n  } catch (err) {\n    log(err);\n    return -1;\n  } finally {\n    y = 1;\n  }\n}\n"),
        (LanguageId::Java, "class C { int f() {\n  try {\n    work();\n  } catch (Exception e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n} }\n"),
        (LanguageId::CSharp, "class C { int f() {\n  try {\n    work();\n  } catch (Exception e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n} }\n"),
        (LanguageId::Php, "<?php\nfunction f() {\n  try {\n    work();\n  } catch (Exception $e) {\n    log($e);\n    return -1;\n  } finally {\n    $y = 1;\n  }\n}\n"),
        (LanguageId::Kotlin, "fun f(): Int {\n  try {\n    work()\n  } catch (e: Exception) {\n    log(e)\n    return -1\n  } finally {\n    y = 1\n  }\n  return 0\n}\n"),
        (LanguageId::Dart, "int f() {\n  try {\n    work();\n  } catch (e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n"),
    ];
    for (lang, src) in brace_cases {
        let adp = reg.adapter(*lang).unwrap();
        let sl = reg.slicer(*lang).unwrap();
        let tree = adp.parse_cst(src).unwrap();
        let c = sl.slice_intra_block(&tree, src, &IntraBlockSelector { symbol: "f".into(), pattern: "catch".into() }).unwrap();
        assert!(c.content.contains("catch") && !c.content.contains("y = 1"), "{lang:?} @catch:\n{}", c.content);
        assert!(c.content.contains("return -1"), "{lang:?} @catch body:\n{}", c.content);
        let fin = sl.slice_intra_block(&tree, src, &IntraBlockSelector { symbol: "f".into(), pattern: "finally".into() }).unwrap();
        assert!(fin.content.contains("finally") && !fin.content.contains("return -1"), "{lang:?} @finally:\n{}", fin.content);
        assert!(fin.content.contains("y = 1"), "{lang:?} @finally body:\n{}", fin.content);
        let t = sl.slice_intra_block(&tree, src, &IntraBlockSelector { symbol: "f".into(), pattern: "try".into() }).unwrap();
        assert!(t.content.contains("try {"), "{lang:?} @try:\n{}", t.content);
    }

    // C++ SEH
    let seh = "int f() {\n  __try {\n    work();\n  } __except (1) {\n    log();\n    return -1;\n  }\n  __try {\n    work();\n  } __finally {\n    y = 1;\n  }\n  return 0;\n}\n";
    let cpp_t = reg.adapter(LanguageId::Cpp).unwrap().parse_cst(seh).unwrap();
    let cpp_sl = reg.slicer(LanguageId::Cpp).unwrap();
    for pat in ["catch", "__except"] {
        let c = cpp_sl.slice_intra_block(&cpp_t, seh, &IntraBlockSelector { symbol: "f".into(), pattern: pat.into() }).unwrap();
        assert!(c.content.contains("__except") && c.content.contains("return -1") && !c.content.contains("y = 1"), "C++ @{pat}:\n{}", c.content);
    }
    let cpp_fin = cpp_sl.slice_intra_block(&cpp_t, seh, &IntraBlockSelector { symbol: "f".into(), pattern: "__finally".into() }).unwrap();
    assert!(cpp_fin.content.contains("__finally") && cpp_fin.content.contains("y = 1") && !cpp_fin.content.contains("return -1"), "{}", cpp_fin.content);

    // Python
    let py = "def f():\n    try:\n        work()\n    except ValueError as err:\n        log(err)\n        return -1\n    finally:\n        y = 1\n";
    let py_t = reg.adapter(LanguageId::Python).unwrap().parse_cst(py).unwrap();
    let py_sl = reg.slicer(LanguageId::Python).unwrap();
    for pat in ["except", "catch"] {
        let c = py_sl.slice_intra_block(&py_t, py, &IntraBlockSelector { symbol: "f".into(), pattern: pat.into() }).unwrap();
        assert!(c.content.contains("except ValueError") && !c.content.contains("finally:"), "Py @{pat}:\n{}", c.content);
    }
    let py_fin = py_sl.slice_intra_block(&py_t, py, &IntraBlockSelector { symbol: "f".into(), pattern: "finally".into() }).unwrap();
    assert!(py_fin.content.contains("finally:") && !py_fin.content.contains("except"), "{}", py_fin.content);

    // Ruby
    let rb = "def f\n  begin\n    work\n  rescue => e\n    log(e)\n    return -1\n  ensure\n    y = 1\n  end\nend\n";
    let rb_t = reg.adapter(LanguageId::Ruby).unwrap().parse_cst(rb).unwrap();
    let rb_sl = reg.slicer(LanguageId::Ruby).unwrap();
    for pat in ["rescue", "catch"] {
        let c = rb_sl.slice_intra_block(&rb_t, rb, &IntraBlockSelector { symbol: "f".into(), pattern: pat.into() }).unwrap();
        assert!(c.content.contains("rescue => e") && !c.content.contains("ensure"), "Rb @{pat}:\n{}", c.content);
    }
    let rb_ens = rb_sl.slice_intra_block(&rb_t, rb, &IntraBlockSelector { symbol: "f".into(), pattern: "ensure".into() }).unwrap();
    assert!(rb_ens.content.contains("ensure") && !rb_ens.content.contains("rescue"), "{}", rb_ens.content);

    // C# using + try/catch/finally
    let cs_using = "class C { int f() {\n  using (var r = open()) {\n    try {\n      work(r);\n    } catch (Exception e) {\n      log(e);\n      return -1;\n    } finally {\n      y = 1;\n    }\n  }\n  return 0;\n} }\n";
    let csu_t = reg.adapter(LanguageId::CSharp).unwrap().parse_cst(cs_using).unwrap();
    let csu_s = reg.slicer(LanguageId::CSharp).unwrap().slice_intra_block(&csu_t, cs_using, &IntraBlockSelector { symbol: "f".into(), pattern: "catch".into() }).unwrap();
    assert!(csu_s.content.contains("catch (Exception e)") && csu_s.content.contains("return -1") && !csu_s.content.contains("y = 1") && !csu_s.content.contains("using ("), "{}", csu_s.content);
}

#[test]
fn dart_on_catch_finally_intra_blocks() {
    let reg = EngineRegistry::new();
    let adp = reg.adapter(LanguageId::Dart).unwrap();
    let sl = reg.slicer(LanguageId::Dart).unwrap();

    let dart_try = "int f() {\n  try {\n    work();\n  } on FormatException catch (e, st) {\n    log(e, st);\n    return -1;\n  } catch (e) {\n    fallback(e);\n    return -2;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n";
    let t1 = adp.parse_cst(dart_try).unwrap();
    let c = sl.slice_intra_block(&t1, dart_try, &IntraBlockSelector { symbol: "f".into(), pattern: "catch".into() }).unwrap();
    assert!(c.content.contains("catch (e)") && c.content.contains("fallback(e)") && c.content.contains("return -2"), "{}", c.content);
    assert!(!c.content.contains("cleanup()") && !c.content.contains("try {"), "{}", c.content);

    for pat in ["on", "FormatException"] {
        let s = sl.slice_intra_block(&t1, dart_try, &IntraBlockSelector { symbol: "f".into(), pattern: pat.into() }).unwrap();
        assert!(s.content.contains("FormatException") && s.content.contains("log(e, st)") && s.content.contains("return -1"), "@{pat}:\n{}", s.content);
        assert!(!s.content.contains("cleanup()") && !s.content.contains("try {"), "@{pat}:\n{}", s.content);
    }

    let fin = sl.slice_intra_block(&t1, dart_try, &IntraBlockSelector { symbol: "f".into(), pattern: "finally".into() }).unwrap();
    assert!(fin.content.contains("finally") && fin.content.contains("cleanup()") && !fin.content.contains("return -1") && !fin.content.contains("return -2"), "{}", fin.content);

    let dart_nested = "int h(bool flag) {\n  try {\n    work();\n  } catch (e) {\n    if (flag) {\n      inner();\n    }\n    return -1;\n  }\n  return 0;\n}\n";
    let t_nested = adp.parse_cst(dart_nested).unwrap();
    let nested = sl.slice_intra_block(&t_nested, dart_nested, &IntraBlockSelector { symbol: "h".into(), pattern: "inner".into() }).unwrap();
    assert!(nested.content.contains("if (flag)") && nested.content.contains("inner()"), "{}", nested.content);

    let dart_on_only = "int g() {\n  try {\n    work();\n  } on StateError {\n    log(\"state\");\n    return -3;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n";
    let t2 = adp.parse_cst(dart_on_only).unwrap();
    for pat in ["on", "StateError", "catch"] {
        let s = sl.slice_intra_block(&t2, dart_on_only, &IntraBlockSelector { symbol: "g".into(), pattern: pat.into() }).unwrap();
        assert!(s.content.contains("on StateError") && s.content.contains("log(\"state\")") && s.content.contains("return -3"), "@{pat}:\n{}", s.content);
        assert!(!s.content.contains("cleanup()") && !s.content.contains("try {"), "@{pat}:\n{}", s.content);
    }
}

#[test]
fn regression_f30_structural_keywords_never_false_match_string_literals() {
    use aice_ast_engine::intra_ast::find_intra_block_in_span;

    let reg = EngineRegistry::new();
    let rs_adp = reg.adapter(LanguageId::Rust).unwrap();
    let rs_sl = reg.slicer(LanguageId::Rust).unwrap();

    // 1. Repro S2-025: function with "match_block", "switch_block", "when_expression", "case" in strings/closures, zero real match
    let rs_no_match = concat!(
        "fn push_match_task(kind: &str) -> &str {\n",
        "    let res = if kind == \"when_expression\" {\n",
        "        \"when\"\n",
        "    } else if kind == \"case\" {\n",
        "        \"case\"\n",
        "    } else {\n",
        "        \"other\"\n",
        "    };\n",
        "    let fallback = || find_child(\"match_block\");\n",
        "    let sw = || find_child(\"switch_block\");\n",
        "    if kind == \"match\" { return fallback(); }\n",
        "    let _ = (res, sw);\n",
        "    \"done\"\n",
        "}\n",
        "fn tiny_str() -> &'static str {\n",
        "    \"match_block while_loop for_each try_catch\"\n",
        "}\n",
    );
    let t_rs = rs_adp.parse_cst(rs_no_match).unwrap();
    for kw in ["match", "switch", "for", "while", "loop", "try", "catch", "finally", "cte", "subquery"] {
        assert!(
            rs_sl.slice_intra_block(&t_rs, rs_no_match, &IntraBlockSelector { symbol: "push_match_task".into(), pattern: kw.into() }).is_err(),
            "push_match_task@{kw} must not false-match string literal or unrelated block"
        );
    }
    // Small symbol <= 8 lines must also reject structural keyword inside string literal
    for kw in ["match", "while", "for", "try", "catch", "if"] {
        assert!(
            rs_sl.slice_intra_block(&t_rs, rs_no_match, &IntraBlockSelector { symbol: "tiny_str".into(), pattern: kw.into() }).is_err(),
            "tiny_str@{kw} must not fall back to string literal"
        );
    }
    // Real blocks inside push_match_task still match
    let if_sl = rs_sl.slice_intra_block(&t_rs, rs_no_match, &IntraBlockSelector { symbol: "push_match_task".into(), pattern: "if".into() }).unwrap();
    assert!(if_sl.content.contains("if kind =="), "{}", if_sl.content);
    let cl_sl = rs_sl.slice_intra_block(&t_rs, rs_no_match, &IntraBlockSelector { symbol: "push_match_task".into(), pattern: "closure".into() }).unwrap();
    assert!(cl_sl.content.contains("|| find_child("), "{}", cl_sl.content);

    // 2. Real iter_match.rs from workspace: push_match_task@match errors, push_match_arms@match matches real match_expression
    let iter_match = fs::read_to_string(workspace_root().join("crates/aice-aice-ir/src/decompile/iter_match.rs")).unwrap();
    let t_im = rs_adp.parse_cst(&iter_match).unwrap();
    let im_syms = rs_adp.extract_symbols(&t_im, &iter_match);
    assert!(
        rs_sl.slice_intra_block(&t_im, &iter_match, &IntraBlockSelector { symbol: "push_match_task".into(), pattern: "match".into() }).is_err(),
        "real iter_match.rs:push_match_task@match must error"
    );
    let task_sym = im_syms.iter().find(|s| s.name == "push_match_task").unwrap();
    assert!(find_intra_block_in_span(&t_im, &iter_match, task_sym.start_byte, task_sym.end_byte, "match").is_none());

    let arms_match = rs_sl
        .slice_intra_block(&t_im, &iter_match, &IntraBlockSelector { symbol: "push_match_arms".into(), pattern: "match".into() })
        .unwrap();
    assert!(arms_match.content.contains("match ch.kind()"), "expected real match block:\n{}", arms_match.content);

    // 3. True match/switch/case/when nodes across Rust, TS, Kotlin, C, Bash win over earlier if-with-string
    let rs_real = "fn f(s: &str, x: i32) -> i32 {\n  if s == \"match\" { return -1; }\n  match x {\n    1 => 10,\n    _ => 20,\n  }\n}\n";
    let t_r2 = rs_adp.parse_cst(rs_real).unwrap();
    let r2 = rs_sl.slice_intra_block(&t_r2, rs_real, &IntraBlockSelector { symbol: "f".into(), pattern: "match".into() }).unwrap();
    assert!(r2.content.contains("match x") && !r2.content.contains("return -1"), "{}", r2.content);

    let ts_real = "function f(s: string, x: number): number {\n  if (s === \"match\" || s === \"switch\") { return -1; }\n  switch (x) {\n    case 1: return 10;\n    default: return 20;\n  }\n}\n";
    let ts_t = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(ts_real).unwrap();
    for kw in ["match", "switch"] {
        let ts_s = reg.slicer(LanguageId::TypeScript).unwrap().slice_intra_block(&ts_t, ts_real, &IntraBlockSelector { symbol: "f".into(), pattern: kw.into() }).unwrap();
        assert!(ts_s.content.contains("switch (x)") && !ts_s.content.contains("return -1"), "ts @{kw}:\n{}", ts_s.content);
    }

    let kt_real = "fun f(s: String, x: Int): Int {\n  if (s == \"match\") return -1\n  return when (x) {\n    1 -> 10\n    else -> 20\n  }\n}\n";
    let kt_t = reg.adapter(LanguageId::Kotlin).unwrap().parse_cst(kt_real).unwrap();
    let kt_s = reg.slicer(LanguageId::Kotlin).unwrap().slice_intra_block(&kt_t, kt_real, &IntraBlockSelector { symbol: "f".into(), pattern: "match".into() }).unwrap();
    assert!(kt_s.content.contains("when (x)") && !kt_s.content.contains("return -1"), "{}", kt_s.content);

    let c_real = "int f(const char *s, int x) {\n  if (s[0] == 'm') { return -1; }\n  switch (x) {\n    case 1: return 10;\n    default: return 20;\n  }\n}\n";
    let c_t = reg.adapter(LanguageId::C).unwrap().parse_cst(c_real).unwrap();
    let c_s = reg.slicer(LanguageId::C).unwrap().slice_intra_block(&c_t, c_real, &IntraBlockSelector { symbol: "f".into(), pattern: "match".into() }).unwrap();
    assert!(c_s.content.contains("switch (x)") && c_s.content.contains("default: return 20;"), "{}", c_s.content);

    let sh_real = "f() {\n  if [ \"$1\" = \"match\" ]; then return 1; fi\n  case \"$2\" in\n    a) echo A ;;\n    *) echo B ;;\n  esac\n}\n";
    let sh_t = reg.adapter(LanguageId::Bash).unwrap().parse_cst(sh_real).unwrap();
    let sh_s = reg.slicer(LanguageId::Bash).unwrap().slice_intra_block(&sh_t, sh_real, &IntraBlockSelector { symbol: "f".into(), pattern: "match".into() }).unwrap();
    assert!(sh_s.content.contains("case \"$2\" in") && !sh_s.content.contains("return 1"), "{}", sh_s.content);
}
