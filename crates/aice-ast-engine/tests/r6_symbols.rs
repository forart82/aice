use std::fs;
use std::path::PathBuf;

use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{AdapterLookup, DepKind, IntraBlockSelector, LanguageId, SymbolKind, SymbolSelector};

fn workspace_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

#[test]
fn extracts_symbols_deps_slices_and_outlines_across_all_9_r6_dialects() {
    let reg = EngineRegistry::new();
    let dir = workspace_root().join("tests/e2e/fixtures/r6/valid");

    let ansi = fs::read_to_string(dir.join("ansi.sql")).unwrap();
    let pg = fs::read_to_string(dir.join("postgres_plpgsql.sql")).unwrap();
    let mysql = fs::read_to_string(dir.join("mysql_proc.sql")).unwrap();
    let sqlite = fs::read_to_string(dir.join("sqlite_pragma.sql")).unwrap();
    let tsql = fs::read_to_string(dir.join("tsql_proc.sql")).unwrap();
    let prisma = fs::read_to_string(dir.join("schema.prisma")).unwrap();
    let graphql = fs::read_to_string(dir.join("api.graphql")).unwrap();
    let cypher = fs::read_to_string(dir.join("graph.cypher")).unwrap();
    let mig = fs::read_to_string(dir.join("migrations/V001__init_ledger.sql")).unwrap();

    let cases: &[(LanguageId, &str, &str)] = &[
        (LanguageId::AnsiSql, &ansi, "active_accounts"),
        (LanguageId::PostgreSql, &pg, "credit_account"),
        (LanguageId::MySql, &mysql, "upsert_ledger_entry"),
        (LanguageId::Sqlite, &sqlite, "ledger_kv"),
        (LanguageId::TSql, &tsql, "ProcessLedgerBatch"),
        (LanguageId::Prisma, &prisma, "Account"),
        (LanguageId::GraphQl, &graphql, "Query"),
        (LanguageId::Cypher, &cypher, "Account"),
        (LanguageId::DbMigration, &mig, "ledger_audit"),
    ];

    for (lang, src, target_sym) in cases {
        let adapter = reg.adapter(*lang).unwrap_or_else(|| panic!("missing adapter {lang:?}"));
        let slicer = reg.slicer(*lang).unwrap_or_else(|| panic!("missing slicer {lang:?}"));
        let tree = adapter.parse_cst(src).expect("parse_cst");
        assert!(!tree.has_error(), "unexpected parse error in {lang:?}");
        let syms = adapter.extract_symbols(&tree, src);
        assert!(!syms.is_empty(), "expected symbols for {lang:?}");

        let slice = slicer
            .slice_symbol(&tree, src, &SymbolSelector { name: (*target_sym).to_string(), ordinal: None })
            .unwrap_or_else(|e| panic!("slice_symbol {target_sym} failed for {lang:?}: {e}; syms={syms:?}"));
        assert!(!slice.content.is_empty(), "empty slice for {lang:?}:{target_sym}");

        let outline = slicer.outline(&tree, src, 0, true);
        assert!(!outline.entries.is_empty(), "empty outline for {lang:?}");
    }

    // CTE non-bleed check
    let ansi_tree = reg.adapter(LanguageId::AnsiSql).unwrap().parse_cst(&ansi).unwrap();
    let cte = reg
        .slicer(LanguageId::AnsiSql)
        .unwrap()
        .slice_symbol(&ansi_tree, &ansi, &SymbolSelector { name: "active_accounts".to_string(), ordinal: None })
        .unwrap();
    assert!(cte.content.contains("WHERE balance > 0"));
    assert!(!cte.content.contains("CREATE TABLE"), "CTE slice bled into table: {}", cte.content);
    assert!(!cte.content.contains("ORDER BY"), "CTE slice bled into outer query: {}", cte.content);

    // Qualified T-SQL name + intra-block slicing
    let tsql_tree = reg.adapter(LanguageId::TSql).unwrap().parse_cst(&tsql).unwrap();
    let tsql_slicer = reg.slicer(LanguageId::TSql).unwrap();
    let q_slice = tsql_slicer
        .slice_symbol(&tsql_tree, &tsql, &SymbolSelector { name: "dbo.ProcessLedgerBatch".to_string(), ordinal: None })
        .unwrap();
    assert!(q_slice.content.contains("BEGIN CATCH"));
    let catch_intra = tsql_slicer
        .slice_intra_block(&tsql_tree, &tsql, &IntraBlockSelector {
            symbol: "ProcessLedgerBatch".to_string(),
            pattern: "BEGIN CATCH".to_string(),
        })
        .unwrap();
    assert!(catch_intra.content.contains("THROW"));

    // PL/pgSQL intra-block
    let pg_tree = reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&pg).unwrap();
    let pg_intra = reg
        .slicer(LanguageId::PostgreSql)
        .unwrap()
        .slice_intra_block(&pg_tree, &pg, &IntraBlockSelector {
            symbol: "credit_account".to_string(),
            pattern: "EXCEPTION".to_string(),
        })
        .unwrap();
    assert!(pg_intra.content.contains("numeric_value_out_of_range"));

    // Dependencies extraction (Prisma, GraphQL, ANSI SQL, Cypher)
    let prisma_deps = reg.adapter(LanguageId::Prisma).unwrap()
        .extract_dependencies(&reg.adapter(LanguageId::Prisma).unwrap().parse_cst(&prisma).unwrap(), &prisma);
    assert!(prisma_deps.iter().any(|d| d.source == "Entry" && d.target == "Account" && d.kind == DepKind::TypeRef));

    let gql_deps = reg.adapter(LanguageId::GraphQl).unwrap()
        .extract_dependencies(&reg.adapter(LanguageId::GraphQl).unwrap().parse_cst(&graphql).unwrap(), &graphql);
    assert!(gql_deps.iter().any(|d| d.source == "Query" && d.target == "Account" && d.kind == DepKind::TypeRef));

    let ansi_deps = reg.adapter(LanguageId::AnsiSql).unwrap().extract_dependencies(&ansi_tree, &ansi);
    assert!(ansi_deps.iter().any(|d| d.target == "accounts" && d.kind == DepKind::SchemaRef));

    // Migration sections + inner table symbols
    let mig_tree = reg.adapter(LanguageId::DbMigration).unwrap().parse_cst(&mig).unwrap();
    let mig_syms = reg.adapter(LanguageId::DbMigration).unwrap().extract_symbols(&mig_tree, &mig);
    assert!(mig_syms.iter().any(|s| s.name == "Up" && s.kind == SymbolKind::Section));
    assert!(mig_syms.iter().any(|s| s.name == "Down" && s.kind == SymbolKind::Section));
    assert!(mig_syms.iter().any(|s| s.name == "ledger_audit" && s.kind == SymbolKind::Table));
}

#[test]
fn non_bleed_end_lines_and_deep_nesting_2mib_stack() {
    let reg = EngineRegistry::new();

    // Non-bleed end_line across consecutive SQL tables and T-SQL procs
    let sql_pair = "CREATE TABLE t_one (\n  id INT PRIMARY KEY\n);\n\nCREATE TABLE t_two (\n  id INT PRIMARY KEY\n);\n";
    let sql_tree = reg.adapter(LanguageId::AnsiSql).unwrap().parse_cst(sql_pair).unwrap();
    let t1 = reg.slicer(LanguageId::AnsiSql).unwrap()
        .slice_symbol(&sql_tree, sql_pair, &SymbolSelector { name: "t_one".to_string(), ordinal: None }).unwrap();
    assert!(!t1.content.contains("t_two"), "SQL bleed: {}", t1.content);
    assert_eq!(t1.end_line, 3);

    let tsql_pair = "CREATE PROC dbo.P1 AS BEGIN SELECT 1; END;\nGO\nCREATE PROC dbo.P2 AS BEGIN SELECT 2; END;\nGO\n";
    let tsql_tree = reg.adapter(LanguageId::TSql).unwrap().parse_cst(tsql_pair).unwrap();
    let p1 = reg.slicer(LanguageId::TSql).unwrap()
        .slice_symbol(&tsql_tree, tsql_pair, &SymbolSelector { name: "P1".to_string(), ordinal: None }).unwrap();
    assert!(!p1.content.contains("P2"), "TSQL bleed: {}", p1.content);

    // 4,500-deep nesting on 2 MiB thread stack (zero stack overflow) + 5,200-deep Pratt iterative test
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let reg = EngineRegistry::new();
            let depth = 4_500;
            let deep_parens = format!("SELECT {}1{};", "(".repeat(depth), ")".repeat(depth));
            let t = reg.adapter(LanguageId::AnsiSql).unwrap().parse_cst(&deep_parens).unwrap();
            assert!(!t.has_error());

            let mut deep_tsql = String::from("CREATE PROC dbo.Deep AS\n");
            for _ in 0..depth { deep_tsql.push_str("BEGIN "); }
            deep_tsql.push_str("SELECT 1; ");
            for _ in 0..depth { deep_tsql.push_str("END "); }
            let tt = reg.adapter(LanguageId::TSql).unwrap().parse_cst(&deep_tsql).unwrap();
            assert!(!tt.has_error());

            let mut deep_pg = String::from("CREATE FUNCTION deep_f() RETURNS INT LANGUAGE plpgsql AS $$\n");
            for _ in 0..depth { deep_pg.push_str("BEGIN "); }
            deep_pg.push_str("RETURN 1; ");
            for _ in 0..depth { deep_pg.push_str("END; "); }
            deep_pg.push_str("$$;");
            let pt = reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&deep_pg).unwrap();
            assert!(!pt.has_error());

            // 5,200-deep Pratt expressions across PG, MySQL, SQLite, T-SQL (challenger_2 CRITICAL)
            let pd = 5_200;
            let o = "(".repeat(pd);
            let c = ")".repeat(pd);
            let pg_parens = format!("CREATE FUNCTION dp() RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN {o}1{c};\nEND;\n$$;");
            assert!(!reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&pg_parens).unwrap().has_error());

            let pg_not = format!("CREATE FUNCTION dn() RETURNS BOOL LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN {}true;\nEND;\n$$;", "NOT ".repeat(pd));
            assert!(!reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&pg_not).unwrap().has_error());

            let pg_call = format!("CREATE FUNCTION dc() RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN {}1{};\nEND;\n$$;", "abs(".repeat(pd), c);
            assert!(!reg.adapter(LanguageId::PostgreSql).unwrap().parse_cst(&pg_call).unwrap().has_error());

            let my_parens = format!("DELIMITER //\nCREATE FUNCTION dm() RETURNS INT\nBEGIN\n  RETURN {o}1{c};\nEND //\nDELIMITER ;");
            assert!(!reg.adapter(LanguageId::MySql).unwrap().parse_cst(&my_parens).unwrap().has_error());

            let sq_pragma = format!("PRAGMA cache_size = {o}100{c};");
            assert!(!reg.adapter(LanguageId::Sqlite).unwrap().parse_cst(&sq_pragma).unwrap().has_error());

            let ts_set = format!("SET @x = {o}1{c};");
            assert!(!reg.adapter(LanguageId::TSql).unwrap().parse_cst(&ts_set).unwrap().has_error());
        })
        .expect("spawn 2MiB stack thread");
    handle.join().expect("2MiB deep R6 stack thread should not overflow");
}

#[test]
fn regression_w2_m3_iter2_mysql_table_procedure_and_tsql_update_deps() {
    let reg = EngineRegistry::new();

    // challenger_2 Medium #3: CREATE TABLE procedure (...) -> Table "procedure", not Procedure "("
    let my_src = "CREATE TABLE procedure (id INT PRIMARY KEY);";
    let my_adp = reg.adapter(LanguageId::MySql).unwrap();
    let my_tree = my_adp.parse_cst(my_src).unwrap();
    assert!(!my_tree.has_error());
    let my_syms = my_adp.extract_symbols(&my_tree, my_src);
    assert_eq!(my_syms.len(), 1);
    assert_eq!(my_syms[0].kind, SymbolKind::Table);
    assert_eq!(my_syms[0].name, "procedure");

    // T-SQL UPDATE target dependency extraction
    let tsql_src = "CREATE PROCEDURE dbo.P AS BEGIN UPDATE dbo.Accounts SET Balance = 0 WHERE Id = 1; END;";
    let tsql_adp = reg.adapter(LanguageId::TSql).unwrap();
    let tsql_tree = tsql_adp.parse_cst(tsql_src).unwrap();
    let deps = tsql_adp.extract_dependencies(&tsql_tree, tsql_src);
    assert!(deps.iter().any(|d| d.target == "dbo.Accounts" && d.kind == DepKind::SchemaRef), "deps={deps:?}");
}

#[test]
fn regression_w2_m3_iter3_mysql_definer_and_view_symbols() {
    let reg = EngineRegistry::new();
    let my_adp = reg.adapter(LanguageId::MySql).unwrap();

    let proc_src = "DELIMITER //\nCREATE DEFINER='root'@'localhost' PROCEDURE my_proc() BEGIN SELECT 1; END //\nDELIMITER ;";
    let proc_tree = my_adp.parse_cst(proc_src).unwrap();
    assert!(!proc_tree.has_error(), "unexpected parse error in proc_src");
    let proc_syms = my_adp.extract_symbols(&proc_tree, proc_src);
    assert!(
        proc_syms.iter().any(|s| s.kind == SymbolKind::Procedure && s.name == "my_proc"),
        "expected Procedure(my_proc), got {proc_syms:?}"
    );

    let fn_src = "DELIMITER //\nCREATE OR REPLACE DEFINER=`admin`@`%` FUNCTION my_fn() RETURNS INT BEGIN RETURN 1; END //\nDELIMITER ;";
    let fn_tree = my_adp.parse_cst(fn_src).unwrap();
    assert!(!fn_tree.has_error(), "unexpected parse error in fn_src");
    let fn_syms = my_adp.extract_symbols(&fn_tree, fn_src);
    assert!(
        fn_syms.iter().any(|s| s.kind == SymbolKind::Function && s.name == "my_fn"),
        "expected Function(my_fn), got {fn_syms:?}"
    );

    let view_src = "CREATE ALGORITHM=UNDEFINED DEFINER=CURRENT_USER() SQL SECURITY DEFINER VIEW my_view AS SELECT 1;";
    let view_tree = my_adp.parse_cst(view_src).unwrap();
    assert!(!view_tree.has_error(), "unexpected parse error in view_src");
    let view_syms = my_adp.extract_symbols(&view_tree, view_src);
    assert!(
        view_syms.iter().any(|s| s.kind == SymbolKind::View && s.name == "my_view"),
        "expected View(my_view), got {view_syms:?}"
    );
}
