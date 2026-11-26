use std::path::Path;
use std::time::{Duration, Instant};

use aice_ast_engine::r6::{extract_r6_symbols, parse_r6, verify_r6_firewall};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry, ParserPool};
use aice_lang_registry::{AdapterLookup, LanguageId, SyntaxFirewall};

#[test]
fn eight_thread_concurrent_r6_verification_and_parsing_has_zero_refcell_panics() {
    let inputs: &[(LanguageId, &str, &str)] = &[
        (LanguageId::AnsiSql, "a.sql", "CREATE TABLE a (id INT PRIMARY KEY); WITH c AS (SELECT id FROM a) SELECT * FROM c;"),
        (LanguageId::PostgreSql, "p.sql", "CREATE FUNCTION f(x INT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN x + 1; END; $$;"),
        (LanguageId::MySql, "m.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; END //\nDELIMITER ;"),
        (LanguageId::Sqlite, "s.sql", "PRAGMA foreign_keys = ON; CREATE TABLE kv (k TEXT PRIMARY KEY) STRICT, WITHOUT ROWID;"),
        (LanguageId::TSql, "t.sql", "CREATE PROC dbo.P AS BEGIN SELECT TOP (1) [id] FROM [dbo].[t]; END; GO"),
        (LanguageId::Prisma, "schema.prisma", "model M { id Int @id }"),
        (LanguageId::GraphQl, "api.graphql", "type Query { ping: String! }"),
        (LanguageId::Cypher, "g.cypher", "MATCH (n:User) RETURN n LIMIT 5;"),
        (LanguageId::DbMigration, "V1__init.sql", "-- +goose Up\nCREATE TABLE m (id INT);\n-- +goose Down\nDROP TABLE m;"),
    ];

    std::thread::scope(|s| {
        for tid in 0..8 {
            s.spawn(move || {
                let fw = DefaultSyntaxFirewall;
                let reg = EngineRegistry::new();
                let mut pool = ParserPool::new();
                for round in 0..10 {
                    let (lang, file, src) = inputs[(tid + round) % inputs.len()];
                    let v = fw.verify(src, Path::new(file), lang);
                    assert!(v.is_valid(), "failed {lang:?} ({file}): {v:?}");
                    assert!(fw.verify_incremental(Some(src), src, Path::new(file), lang).is_valid());
                    assert!(verify_r6_firewall(lang, src, &mut pool).is_ok());
                    let tree = parse_r6(lang, src, &mut pool).expect("parse_r6");
                    assert!(!tree.has_error());
                    let syms = extract_r6_symbols(lang, &tree, src);
                    assert!(!syms.is_empty(), "empty syms for {lang:?}");
                    let tree2 = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
                    assert!(!tree2.has_error());
                }
            });
        }
    });
}

#[test]
fn large_utf8_and_42k_line_r6_stress_runs_linearly() {
    let fw = DefaultSyntaxFirewall;
    let limit = Duration::from_secs(if cfg!(debug_assertions) { 60 } else { 15 });

    // > 1.45 MiB UTF-8 T-SQL & ANSI SQL
    let unit_tsql = "SELECT N'café € 🚀' AS label, [id] FROM [dbo].[Ledger] WHERE [id] > 0;\n";
    let mut big_tsql = String::with_capacity(1_600_000);
    while big_tsql.len() < 1_500_000 { big_tsql.push_str(unit_tsql); }
    assert!(big_tsql.len() > 1_450_000 && big_tsql.len() < 2 * 1024 * 1024);

    let start = Instant::now();
    assert!(fw.verify(&big_tsql, Path::new("big.sql"), LanguageId::TSql).is_valid());
    assert!(start.elapsed() < limit, "1.5MB T-SQL took {:?}", start.elapsed());

    // 42,000+ lines SQLite / Migration
    let mut big_mig = String::from("-- +goose Up\n");
    for i in 0..42_000 {
        big_mig.push_str(&format!("CREATE INDEX idx_{i} ON t (c);\n"));
    }
    big_mig.push_str("-- +goose Down\nDROP TABLE IF EXISTS t;\n");
    assert!(big_mig.len() < 2 * 1024 * 1024);

    let start2 = Instant::now();
    assert!(fw.verify(&big_mig, Path::new("V999__big.sql"), LanguageId::DbMigration).is_valid());
    assert!(start2.elapsed() < limit, "42k-line migration took {:?}", start2.elapsed());
}

fn median_verify_time(lang: LanguageId, file: &str, src: &str) -> Duration {
    let fw = DefaultSyntaxFirewall;
    let mut times = [Duration::ZERO; 3];
    for t in &mut times {
        let start = Instant::now();
        let v = fw.verify(src, Path::new(file), lang);
        *t = start.elapsed();
        assert!(v.is_valid(), "Expected valid {lang:?} ({file}): {v:?}");
    }
    times.sort();
    times[1]
}

#[test]
fn nested_trim_and_mysql_labeled_blocks_scale_linearly_on_2mib_stack() {
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let trim_nest = |d: usize| -> String {
                format!("SELECT {}'x'{};", "TRIM(BOTH ' ' FROM ".repeat(d), ")".repeat(d))
            };
            let mysql_blocks = |d: usize| -> String {
                let mut s = String::from("DELIMITER //\nCREATE PROCEDURE p() BEGIN ");
                for i in 0..d {
                    s.push_str(&format!("l{i}: BEGIN "));
                }
                s.push_str("SELECT 1; ");
                for i in (0..d).rev() {
                    s.push_str(&format!("END l{i}; "));
                }
                s.push_str("END //\nDELIMITER ;");
                s
            };

            let ceiling = Duration::from_millis(if cfg!(debug_assertions) { 4_000 } else { 500 });
            let floor = Duration::from_millis(if cfg!(debug_assertions) { 75 } else { 5 });

            for (lang, file) in [
                (LanguageId::AnsiSql, "nest_trim_ansi.sql"),
                (LanguageId::PostgreSql, "nest_trim_pg.sql"),
                (LanguageId::MySql, "nest_trim_mysql.sql"),
                (LanguageId::Sqlite, "nest_trim_sqlite.sql"),
            ] {
                let s2500 = trim_nest(2_500);
                let s5000 = trim_nest(5_000);
                let s5200 = trim_nest(5_200);
                let t2500 = median_verify_time(lang, file, &s2500);
                let t5000 = median_verify_time(lang, file, &s5000);
                let t5200 = median_verify_time(lang, file, &s5200);
                assert!(t5200 < ceiling, "{lang:?} trim(5200) took {t5200:?} >= {ceiling:?}");
                if t2500 >= floor {
                    let ratio = t5000.as_secs_f64() / t2500.as_secs_f64();
                    assert!(ratio < 2.8, "{lang:?} trim 2500->5000 superlinear: {t2500:?} -> {t5000:?} ({ratio:.2}x)");
                }
            }

            let mb2500 = mysql_blocks(2_500);
            let mb5000 = mysql_blocks(5_000);
            let mb5200 = mysql_blocks(5_200);
            let mt2500 = median_verify_time(LanguageId::MySql, "nest_lbl_2500.sql", &mb2500);
            let mt5000 = median_verify_time(LanguageId::MySql, "nest_lbl_5000.sql", &mb5000);
            let mt5200 = median_verify_time(LanguageId::MySql, "nest_lbl_5200.sql", &mb5200);
            assert!(mt5200 < ceiling, "MySQL blocks(5200) took {mt5200:?} >= {ceiling:?}");
            if mt2500 >= floor {
                let ratio = mt5000.as_secs_f64() / mt2500.as_secs_f64();
                assert!(ratio < 2.8, "MySQL blocks 2500->5000 superlinear: {mt2500:?} -> {mt5000:?} ({ratio:.2}x)");
            }
        })
        .expect("spawn 2 MiB thread");
    handle.join().expect("2 MiB stack scaling test panicked");
}

#[test]
fn tsql_left_deep_from_join_and_nested_subquery_scale_linearly_on_2mib_stack() {
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let left_deep_from = |d: usize| -> String {
                let mut s = String::from("UPDATE dbo.T SET x = 1 FROM ");
                s.push_str(&"(".repeat(d));
                s.push_str("dbo.t0");
                for i in 1..=d {
                    s.push_str(&format!(" JOIN dbo.t{i} ON 1=1)"));
                }
                s.push(';');
                s
            };
            let nested_sub = |d: usize| -> String {
                format!("SELECT * FROM {}SELECT 1 AS x{} AS s;", "(".repeat(d), ")".repeat(d))
            };

            let ceiling = Duration::from_millis(if cfg!(debug_assertions) { 4_000 } else { 500 });
            let floor = Duration::from_millis(if cfg!(debug_assertions) { 75 } else { 5 });

            let ld2500 = left_deep_from(2_500);
            let ld5000 = left_deep_from(5_000);
            let ld10000 = left_deep_from(10_000);
            let lt2500 = median_verify_time(LanguageId::TSql, "ld_from_2500.sql", &ld2500);
            let lt5000 = median_verify_time(LanguageId::TSql, "ld_from_5000.sql", &ld5000);
            let lt10000 = median_verify_time(LanguageId::TSql, "ld_from_10000.sql", &ld10000);
            assert!(lt10000 < ceiling, "left-deep FROM(10000) took {lt10000:?} >= {ceiling:?}");
            if lt2500 >= floor {
                let r1 = lt5000.as_secs_f64() / lt2500.as_secs_f64();
                assert!(r1 < 2.8, "left-deep FROM 2500->5000 superlinear: {lt2500:?} -> {lt5000:?} ({r1:.2}x)");
            }
            if lt5000 >= floor {
                let r2 = lt10000.as_secs_f64() / lt5000.as_secs_f64();
                assert!(r2 < 2.8, "left-deep FROM 5000->10000 superlinear: {lt5000:?} -> {lt10000:?} ({r2:.2}x)");
            }

            let ns2500 = nested_sub(2_500);
            let ns5000 = nested_sub(5_000);
            let ns10000 = nested_sub(10_000);
            let nt2500 = median_verify_time(LanguageId::TSql, "nest_sub_2500.sql", &ns2500);
            let nt5000 = median_verify_time(LanguageId::TSql, "nest_sub_5000.sql", &ns5000);
            let nt10000 = median_verify_time(LanguageId::TSql, "nest_sub_10000.sql", &ns10000);
            assert!(nt10000 < ceiling, "nested subquery(10000) took {nt10000:?} >= {ceiling:?}");
            if nt2500 >= floor {
                let r1 = nt5000.as_secs_f64() / nt2500.as_secs_f64();
                assert!(r1 < 2.8, "nested subquery 2500->5000 superlinear: {nt2500:?} -> {nt5000:?} ({r1:.2}x)");
            }
            if nt5000 >= floor {
                let r2 = nt10000.as_secs_f64() / nt5000.as_secs_f64();
                assert!(r2 < 2.8, "nested subquery 5000->10000 superlinear: {nt5000:?} -> {nt10000:?} ({r2:.2}x)");
            }

            let nested_from = |d: usize| -> String {
                let mut s = String::with_capacity(d * 24 + 32);
                for _ in 0..d {
                    s.push_str("SELECT * FROM (");
                }
                s.push_str("SELECT 1 AS id");
                for i in (0..d).rev() {
                    s.push_str(&format!(") t_{i}"));
                }
                s.push(';');
                s
            };
            let nested_upd = |d: usize| -> String {
                format!("UPDATE dbo.T SET a = {}(SELECT 1){};", "(".repeat(d), ")".repeat(d))
            };
            let nested_sel_proj = |d: usize| -> String {
                format!("SELECT {}1{};", "(SELECT ".repeat(d), ")".repeat(d))
            };
            let nested_where_exists = |d: usize| -> String {
                format!("SELECT 1 WHERE {}1=1{};", "EXISTS (SELECT 1 WHERE ".repeat(d), ")".repeat(d))
            };
            for (label, make_sql) in [
                ("nested_from", &nested_from as &dyn Fn(usize) -> String),
                ("nested_upd", &nested_upd as &dyn Fn(usize) -> String),
                ("nested_sel_proj", &nested_sel_proj as &dyn Fn(usize) -> String),
                ("nested_where_exists", &nested_where_exists as &dyn Fn(usize) -> String),
            ] {
                let s2500 = make_sql(2_500);
                let s5000 = make_sql(5_000);
                let s10000 = make_sql(10_000);
                let t2500 = median_verify_time(LanguageId::TSql, &format!("{label}_2500.sql"), &s2500);
                let t5000 = median_verify_time(LanguageId::TSql, &format!("{label}_5000.sql"), &s5000);
                let t10000 = median_verify_time(LanguageId::TSql, &format!("{label}_10000.sql"), &s10000);
                assert!(t10000 < ceiling, "{label}(10000) took {t10000:?} >= {ceiling:?}");
                if t2500 >= floor {
                    let r1 = t5000.as_secs_f64() / t2500.as_secs_f64();
                    assert!(r1 < 2.8, "{label} 2500->5000 superlinear: {t2500:?} -> {t5000:?} ({r1:.2}x)");
                }
                if t5000 >= floor {
                    let r2 = t10000.as_secs_f64() / t5000.as_secs_f64();
                    assert!(r2 < 2.8, "{label} 5000->10000 superlinear: {t5000:?} -> {t10000:?} ({r2:.2}x)");
                }
            }
        })
        .expect("spawn 2 MiB thread");
    handle.join().expect("2 MiB stack T-SQL scaling test panicked");
}
