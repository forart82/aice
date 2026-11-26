use std::path::Path;

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_valid(lang: LanguageId, path: &str, src: &str) {
    let fw = DefaultSyntaxFirewall;
    let v = fw.verify(src, Path::new(path), lang);
    assert!(v.is_valid(), "Expected VALID {lang:?} ({path}):\n{src}\nGot: {v:?}");
}

fn assert_invalid(lang: LanguageId, path: &str, src: &str) {
    let fw = DefaultSyntaxFirewall;
    let v = fw.verify(src, Path::new(path), lang);
    match v {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(!diagnostics.is_empty(), "empty diags for {lang:?}");
            for d in &diagnostics {
                assert!(d.line >= 1 && d.column >= 1, "bad line/col: {d:?}");
                assert!(!d.context.is_empty(), "empty context: {d:?}");
            }
        }
        FirewallVerdict::Valid => panic!("Expected INVALID {lang:?} ({path}) to be REJECTED:\n{src}"),
    }
}

#[test]
fn bw1_bw3_bw4_positive_and_negative_across_all_9_r6_dialects() {
    // 1. ANSI SQL
    assert_valid(LanguageId::AnsiSql, "a.sql", "CREATE TABLE t (id INT PRIMARY KEY, café VARCHAR(20));");
    assert_valid(LanguageId::AnsiSql, "a.sql", "WITH c AS (SELECT 1 AS x) SELECT x FROM c;");
    assert_invalid(LanguageId::AnsiSql, "a.sql", "SELECT FROM accounts;");
    assert_invalid(LanguageId::AnsiSql, "a.sql", "CREATE TABLE t (id INT, );");
    assert_invalid(LanguageId::AnsiSql, "a.sql", "SELECT id FROM accounts WHERE ;");
    assert_invalid(LanguageId::AnsiSql, "a.sql", "SELECT (1 + 2;");

    // 2. PostgreSQL / PL/pgSQL (including T2-F06-02 unterminated $$)
    assert_valid(
        LanguageId::PostgreSql,
        "p.sql",
        "CREATE FUNCTION f(x INT) RETURNS INT LANGUAGE plpgsql AS $fn$\nBEGIN\n  IF x > 0 THEN RETURN x; ELSIF x = 0 THEN RETURN 0; ELSE RETURN -1; END IF;\nEND;\n$fn$;\nCREATE TRIGGER trg_acct AFTER UPDATE ON accounts FOR EACH ROW EXECUTE FUNCTION audit_balance_change();",
    );
    assert_valid(LanguageId::PostgreSql, "p.sql", "DO $$ BEGIN PERFORM 1; END $$;");
    assert_invalid(
        LanguageId::PostgreSql,
        "p.sql",
        "CREATE FUNCTION f() RETURNS VOID LANGUAGE plpgsql AS $$\nBEGIN\n  PERFORM 1;\nEND;\n",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "p.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $a$\nBEGIN RETURN 1; END;\n$b$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "p.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  IF true RETURN 1; END IF;\nEND;\n$$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "p.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  UPDATE t SET v = WHERE id = 1;\n  RETURN 0;\nEND;\n$$;",
    );

    // 3. MySQL / MariaDB
    assert_valid(
        LanguageId::MySql,
        "m.sql",
        "DELIMITER $$\nCREATE PROCEDURE `sync_€`(IN p_id BIGINT)\nBEGIN\n  # hash comment\n  DECLARE v INT DEFAULT 0;\n  IF p_id > 0 THEN SET v = 1; END IF;\nEND $$\nDELIMITER ;\nCREATE TABLE t (id BIGINT AUTO_INCREMENT PRIMARY KEY) ENGINE=InnoDB;",
    );
    assert_invalid(LanguageId::MySql, "m.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN INSERT INTO t (a, b) VALUES (1, ); END //");
    assert_invalid(LanguageId::MySql, "m.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1; //");
    assert_invalid(LanguageId::MySql, "m.sql", "SELECT `unclosed FROM t;");
    assert_invalid(LanguageId::MySql, "m.sql", "DELIMITER\nSELECT 1;");

    // 4. SQLite
    assert_valid(
        LanguageId::Sqlite,
        "s.sql",
        "PRAGMA journal_mode(wal);\nCREATE TABLE kv (k TEXT PRIMARY KEY, v INTEGER NOT NULL) WITHOUT ROWID, STRICT;\nCREATE TRIGGER trg AFTER INSERT ON kv BEGIN UPDATE kv SET v = v + 1 WHERE k = NEW.k; END;",
    );
    assert_invalid(LanguageId::Sqlite, "s.sql", "PRAGMA foreign_keys = ;");
    assert_invalid(LanguageId::Sqlite, "s.sql", "CREATE TABLE kv (k TEXT PRIMARY KEY,) STRICT;");
    assert_invalid(LanguageId::Sqlite, "s.sql", "CREATE TABLE kv (k TEXT) BOGUS_OPT;");
    assert_invalid(LanguageId::Sqlite, "s.sql", "CREATE TRIGGER trg AFTER INSERT ON kv BEGIN SELECT 1;");

    // 5. T-SQL
    assert_valid(
        LanguageId::TSql,
        "t.sql",
        "CREATE PROC [dbo].[Get_🚀]\n  @Id INT\nAS\nBEGIN\n  SET NOCOUNT ON;\n  BEGIN TRAN;\n  SELECT TOP (5) CASE WHEN @Id > 0 THEN 1 ELSE 0 END AS flag FROM [dbo].[Items] WHERE Id = @Id;\n  COMMIT TRAN;\nEND;\nGO 1\n",
    );
    assert_invalid(LanguageId::TSql, "t.sql", "UPDATE dbo.A SET X = WHERE Y = @Id;");
    assert_invalid(LanguageId::TSql, "t.sql", "SELECT ;");
    assert_invalid(LanguageId::TSql, "t.sql", "BEGIN TRY SELECT 1; END TRY");
    assert_invalid(LanguageId::TSql, "t.sql", "SELECT [unclosed FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t.sql", "SELECT 1;\nGO abc\n");

    // 6. Prisma
    assert_valid(
        LanguageId::Prisma,
        "schema.prisma",
        "model User {\n  id Int @id\n  email String @unique\n  @@index([\n    email\n  ])\n}",
    );
    assert_invalid(LanguageId::Prisma, "schema.prisma", "model User {\n  id\n}");
    assert_invalid(LanguageId::Prisma, "schema.prisma", "model User {\n  id Int =\n}");
    assert_invalid(LanguageId::Prisma, "schema.prisma", "model User {\n  id Int\n");

    // 7. GraphQL
    assert_valid(
        LanguageId::GraphQl,
        "api.graphql",
        "\"\"\"Doc 🚀\"\"\"\ntype User { id: ID! name: String! }\nfragment UFields on User { id name }\nquery Q($id: ID!) { user(id: $id) { ...UFields } }",
    );
    assert_invalid(LanguageId::GraphQl, "api.graphql", "type User { balance: }");
    assert_invalid(LanguageId::GraphQl, "api.graphql", "type Query { user(: ID!): User }");
    assert_invalid(LanguageId::GraphQl, "api.graphql", "query Q { user {} }");
    assert_invalid(LanguageId::GraphQl, "api.graphql", "type User { id: ID!");

    // 8. Cypher
    assert_valid(
        LanguageId::Cypher,
        "g.cypher",
        "OPTIONAL MATCH (a:Account)\nWHERE a.match = true\nMERGE (b:Audit {id: $id})\nON CREATE SET b.ts = 1\nRETURN a.id, b.id\nUNION ALL\nCALL db.labels() YIELD label\nRETURN label;",
    );
    assert_invalid(LanguageId::Cypher, "g.cypher", "MATCH (a) WHERE a.x > AND RETURN a;");
    assert_invalid(LanguageId::Cypher, "g.cypher", "WHERE a.x = 1 RETURN a;");
    assert_invalid(LanguageId::Cypher, "g.cypher", "RETURN a MATCH (a);");
    assert_invalid(LanguageId::Cypher, "g.cypher", "MATCH (a)-[r:REL- RETURN a;");

    // 9. DB Migrations
    assert_valid(
        LanguageId::DbMigration,
        "V002__fn.sql",
        "-- +goose Up\n-- +goose StatementBegin\nCREATE FUNCTION fn() RETURNS TRIGGER LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN NEW;\nEND;\n$$;\n-- +goose StatementEnd\n-- +goose Down\nDROP FUNCTION IF EXISTS fn();",
    );
    assert_invalid(
        LanguageId::DbMigration,
        "V002__bad_down.sql",
        "-- +goose Up\nCREATE TABLE a (id INT PRIMARY KEY);\n-- +goose Down\nDROP TABLE ;",
    );
    assert_invalid(
        LanguageId::DbMigration,
        "V002__unclosed.sql",
        "-- +goose Up\n-- +goose StatementBegin\nCREATE TABLE a (id INT);",
    );
}

#[test]
fn bw2_prebroken_incremental_binary_nul_limit_and_utf8_safety() {
    let fw = DefaultSyntaxFirewall;

    // Binary extensions (.sqlite, .db), NUL byte, >2 MiB rejected
    assert!(!fw.verify("SELECT 1;", Path::new("app.sqlite"), LanguageId::Sqlite).is_valid());
    assert!(!fw.verify("SELECT 1;", Path::new("app.db"), LanguageId::Sqlite).is_valid());
    assert!(!fw.verify("SELECT '\0';", Path::new("a.sql"), LanguageId::AnsiSql).is_valid());
    let oversized = "SELECT 1;\n".repeat(220_000);
    assert!(oversized.len() > 2 * 1024 * 1024);
    assert!(!fw.verify(&oversized, Path::new("big.sql"), LanguageId::AnsiSql).is_valid());

    // Multi-byte UTF-8 safety
    assert_valid(LanguageId::AnsiSql, "u.sql", "SELECT 'café € 🚀' AS txt FROM \"naïve_table\";");
    assert_valid(LanguageId::Cypher, "u.cypher", "MATCH (n:Account {sym: 'café € 🚀'}) RETURN n; // €");

    // B-W2 Pre-broken incremental verification across R6 dialects
    let base_ansi = "SELECT FROM accounts;\n\nCREATE TABLE ok_tbl (\n  id INT PRIMARY KEY\n);\n";
    let cand_clean_edit = "SELECT FROM accounts;\n\nCREATE TABLE ok_tbl (\n  id INT PRIMARY KEY,\n  name TEXT NOT NULL\n);\n";
    let cand_new_err = "SELECT FROM accounts;\n\nCREATE TABLE ok_tbl (\n  id INT PRIMARY KEY,\n  name TEXT NOT NULL,\n);\n";
    let cand_shift = "-- header comment\nSELECT FROM accounts;\n\nCREATE TABLE ok_tbl (\n  id INT PRIMARY KEY\n);\n";
    assert!(fw.verify_incremental(Some(base_ansi), cand_clean_edit, Path::new("a.sql"), LanguageId::AnsiSql).is_valid());
    assert!(!fw.verify_incremental(Some(base_ansi), cand_new_err, Path::new("a.sql"), LanguageId::AnsiSql).is_valid());
    assert!(fw.verify_incremental(Some(base_ansi), cand_shift, Path::new("a.sql"), LanguageId::AnsiSql).is_valid());

    let base_tsql = "SELECT ;\n\nCREATE PROC dbo.Ok AS\nBEGIN\n  SELECT 1;\nEND;\n";
    let cand_tsql_clean = "SELECT ;\n\nCREATE PROC dbo.Ok AS\nBEGIN\n  SELECT 2;\nEND;\n";
    let cand_tsql_err = "SELECT ;\n\nCREATE PROC dbo.Ok AS\nBEGIN\n  UPDATE dbo.T SET A = WHERE B = 1;\nEND;\n";
    assert!(fw.verify_incremental(Some(base_tsql), cand_tsql_clean, Path::new("t.sql"), LanguageId::TSql).is_valid());
    assert!(!fw.verify_incremental(Some(base_tsql), cand_tsql_err, Path::new("t.sql"), LanguageId::TSql).is_valid());
}

#[test]
fn regression_w2_m3_iter2_all_challenger_and_reviewer_fixes() {
    // Bug 1: PL/pgSQL CASE ... END inside simple statements and IF conditions
    assert_valid(
        LanguageId::PostgreSql,
        "pg_case.sql",
        "CREATE FUNCTION sign_fn(x INT) RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  IF CASE WHEN x > 0 THEN 1 ELSE 0 END = 1 THEN\n    RETURN CASE WHEN x > 0 THEN 1 ELSE -1 END;\n  END IF;\n  RETURN 0;\nEND;\n$$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_fn.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS INT LANGUAGE plpgsql AS $$\nBEGIN\n  RETURN coalesce(CAST((x) AS INT), 0);\nEND;\n$$;",
    );

    // Bug 2: MySQL CASE ... END inside stored procedures
    assert_valid(
        LanguageId::MySql,
        "my_case.sql",
        "DELIMITER $$\nCREATE PROCEDURE p_case(IN x INT)\nBEGIN\n  SELECT CASE WHEN x > 0 THEN 1 ELSE 0 END;\nEND $$\nDELIMITER ;",
    );

    // Bug 3 & challenger_2 Medium #2 & Bug 8: SQLite ON CONFLICT DDL vs DML, trigger table name, trigger header
    assert_valid(
        LanguageId::Sqlite,
        "sq_conflict.sql",
        "CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT REPLACE, code TEXT UNIQUE ON CONFLICT IGNORE);\nINSERT INTO t (id, code) VALUES (1, 'a') ON CONFLICT(id) DO NOTHING;",
    );
    assert_invalid(
        LanguageId::Sqlite,
        "sq_bad_conflict.sql",
        "CREATE TABLE t (id INTEGER PRIMARY KEY ON CONFLICT BOGUS);",
    );
    assert_valid(LanguageId::Sqlite, "sq_tbl_trg.sql", "CREATE TABLE trigger (id INT PRIMARY KEY);");
    assert_invalid(LanguageId::Sqlite, "sq_bad_trg.sql", "CREATE TRIGGER trg BEGIN SELECT 1; END;");
    assert_valid(
        LanguageId::Sqlite,
        "sq_good_trg.sql",
        "CREATE TEMP TRIGGER IF NOT EXISTS main.trg BEFORE UPDATE OF a, b ON t FOR EACH ROW WHEN NEW.a > 0 BEGIN SELECT 1; END;",
    );

    // Bug 4: ANSI SQL trailing comma before major SQL clause keywords
    assert_invalid(LanguageId::AnsiSql, "ansi_comma.sql", "SELECT a, FROM accounts;");
    assert_invalid(LanguageId::AnsiSql, "ansi_comma2.sql", "SELECT a FROM t ORDER BY a, LIMIT 5;");
    assert_valid(LanguageId::AnsiSql, "ansi_ok.sql", "SELECT a, b FROM accounts;");

    // Bug 5 & reviewer_1 Minor 2: T-SQL statement hardening & END TRY; BEGIN CATCH
    assert_invalid(LanguageId::TSql, "t_kw.sql", "SELEC 1;");
    assert_invalid(LanguageId::TSql, "t_tbl.sql", "CREATE TABLE dbo.T (id INT name NVARCHAR(50));");
    assert_invalid(LanguageId::TSql, "t_vals.sql", "INSERT INTO dbo.T VALUES (1 2);");
    assert_invalid(LanguageId::TSql, "t_ins_cols.sql", "INSERT INTO dbo.T (a b) VALUES (1, 2);");
    assert_invalid(LanguageId::TSql, "t_sel.sql", "SELECT a b c FROM dbo.T;");
    assert_valid(
        LanguageId::TSql,
        "t_ok.sql",
        "CREATE TABLE dbo.T (id INT IDENTITY(1,1) NOT NULL PRIMARY KEY, name NVARCHAR(50) NULL DEFAULT 'x', fk INT REFERENCES dbo.P(id) ON DELETE CASCADE);\nINSERT INTO dbo.T (name, fk) VALUES ('a', 1), ('b', 2);\nSELECT a AS col_a, b col_b, ROW_NUMBER() OVER (ORDER BY id) AS rn FROM dbo.T;\nBEGIN TRY SELECT 1; END TRY; BEGIN CATCH THROW; END CATCH;",
    );

    // Bug 6: Full Pratt expression consumption across PL/pgSQL, MySQL, T-SQL
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_trail1.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$ DECLARE x INT; BEGIN x := 1 GARBAGE; RETURN x; END; $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_trail2.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN 1 GARBAGE; END; $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_trail3.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$ DECLARE x INT := 1 GARBAGE; BEGIN RETURN x; END; $$;",
    );
    assert_invalid(LanguageId::MySql, "my_trail.sql", "SET @x = 1 GARBAGE;");
    assert_valid(LanguageId::MySql, "my_set_multi.sql", "SET @a = 1, @b = 2;");
    assert_invalid(LanguageId::TSql, "t_trail.sql", "SET @x = 1 GARBAGE;");

    // Bug 7 & reviewer_2 Minor 1: MySQL backtick quoting and same-line column offsets
    assert_valid(LanguageId::MySql, "my_bt1.sql", "SELECT `col\"name` FROM items;");
    assert_valid(
        LanguageId::MySql,
        "my_bt2.sql",
        "INSERT INTO kv (`k``1`, v) VALUES (1, '//') ON DUPLICATE KEY UPDATE v = VALUES(v);",
    );
    assert_valid(
        LanguageId::MySql,
        "my_bt3.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN INSERT INTO kv (`k``1`, v) VALUES (1, '//') ON DUPLICATE KEY UPDATE v = VALUES(v); END //\nDELIMITER ;",
    );
    let fw = DefaultSyntaxFirewall;
    match fw.verify("SELECT 1; SELECT FROM t;", Path::new("my_col.sql"), LanguageId::MySql) {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(diagnostics.iter().any(|d| d.line == 1 && d.column >= 11), "Expected col >= 11: {diagnostics:?}");
        }
        FirewallVerdict::Valid => panic!("Expected invalid MySQL"),
    }

    // Bug 9: DB Migrations PG $tag$, MySQL # comments with apostrophe, T-SQL GO
    assert_valid(
        LanguageId::DbMigration,
        "V003__pg_tag.sql",
        "-- +goose Up\n-- +goose StatementBegin\nDO $do$\nBEGIN\n  PERFORM 1;\nEND\n$do$;\n-- +goose StatementEnd\n-- +goose Down\nSELECT 1;",
    );
    assert_valid(
        LanguageId::DbMigration,
        "V004__mysql_hash.sql",
        "-- +goose Up\nDELIMITER //\n# it's a valid MySQL comment\nCREATE PROCEDURE p() BEGIN SELECT 1; END //\nDELIMITER ;\n-- +goose Down\nDROP PROCEDURE IF EXISTS p;",
    );
    assert_valid(
        LanguageId::DbMigration,
        "V005__tsql_go.sql",
        "-- +goose Up\nCREATE TABLE [dbo].[Items] (Id INT PRIMARY KEY);\nGO\n-- +goose Down\nDROP TABLE [dbo].[Items];\nGO",
    );

    // Prisma string-aware // stripping (URL with // and trailing // comment) + multiline /* */ doesn't emit bogus missing-type
    assert_valid(
        LanguageId::Prisma,
        "prisma_url.prisma",
        "datasource db {\n  provider = \"postgresql\"\n  url = \"postgresql://user:pass@localhost/db\" // inline comment\n}\nmodel User {\n  id Int @id\n  bio String @default(\"http://example.com\")\n}",
    );
    let fw_prisma = fw.verify(
        "model User {\n  /*\n    singleword\n  */\n  id Int @id\n}",
        Path::new("blk.prisma"),
        LanguageId::Prisma,
    );
    if let FirewallVerdict::Invalid { diagnostics } = fw_prisma {
        assert!(
            !diagnostics.iter().any(|d| d.message.contains("missing type")),
            "Unexpected missing-type FP on block comment: {diagnostics:?}"
        );
    }
}

#[test]
fn regression_w2_m3_iter3_all_8_challenger_fixes() {
    let fw = DefaultSyntaxFirewall;

    // 1. mig_detect.rs: UTF-8 multi-byte lines starting with € or 🚀 must not panic in has_tsql_go
    assert_valid(LanguageId::DbMigration, "utf8_euro.sql", "-- +goose Up\nSELECT\n'€';");
    assert_valid(LanguageId::DbMigration, "utf8_rocket.sql", "-- +goose Up\nSELECT\n'🚀';");
    assert_valid(LanguageId::DbMigration, "utf8_ident.sql", "-- +goose Up\nSELECT\n'€_val' AS x;");

    // 2. sqlite_rd.rs: CREATE TABLE t AS SELECT (1 + 2) FROM u; is CTAS, not table options
    assert_valid(LanguageId::Sqlite, "sq_ctas.sql", "CREATE TABLE t AS SELECT (1 + 2) FROM u;");
    assert_valid(LanguageId::Sqlite, "sq_gen_strict.sql", "CREATE TABLE t (a INT, b INT GENERATED ALWAYS AS (a + 1) VIRTUAL) STRICT;");
    assert_invalid(LanguageId::Sqlite, "sq_bad_opt.sql", "CREATE TABLE t (a INT) BOGUS;");

    // 3. tsql_stmt.rs + tsql_query.rs: window/WITHIN GROUP/COLLATE infix continuation & inline ON [filegroup]
    assert_valid(LanguageId::TSql, "t_win_arith.sql", "SELECT SUM(x) OVER (PARTITION BY y) + 1 AS z FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_win_paren.sql", "SELECT (SUM(x) OVER (PARTITION BY y) + 1) * 2 AS z FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_within_group.sql", "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x) * 100 AS p FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_filegroup.sql", "CREATE TABLE dbo.T (id INT PRIMARY KEY NONCLUSTERED ON [PRIMARY]);");
    assert_valid(
        LanguageId::TSql,
        "t_part_scheme.sql",
        "CREATE TABLE dbo.T (id INT PRIMARY KEY ON [ps_date](id), fk INT REFERENCES dbo.P(id) ON DELETE SET DEFAULT);",
    );

    // 4. mysql_dml.rs: adjacent backtick identifier before keyword does not fuse (_btFROM)
    assert_valid(LanguageId::MySql, "my_adj_bt.sql", "SELECT `a`FROM items WHERE id = 1;");

    // 5. tsql_stmt.rs + tsql_query.rs: missing comma in VALUES (...) (...) & WHERE/HAVING/ON predicate checks
    assert_invalid(LanguageId::TSql, "t_vals_nocomma.sql", "INSERT INTO dbo.T (a, b) VALUES (1, 2) (3, 4);");
    assert_invalid(LanguageId::TSql, "t_where_bad.sql", "SELECT a FROM dbo.T WHERE 1 2;");
    assert_invalid(LanguageId::TSql, "t_having_bad.sql", "SELECT a FROM dbo.T GROUP BY a HAVING COUNT(*) > 1 2;");
    assert_invalid(LanguageId::TSql, "t_on_bad.sql", "SELECT a FROM dbo.T JOIN dbo.U ON T.id = U.id 999;");
    assert_valid(
        LanguageId::TSql,
        "t_where_valid.sql",
        "SELECT a FROM dbo.T JOIN dbo.U ON T.id = U.id WHERE a = 1 AND b IN (1, 2) AND EXISTS (SELECT 1) AND c LIKE '%x%' ESCAPE '\\' AND d IS NOT NULL AND CASE WHEN e > 0 THEN 1 ELSE 0 END = 1;",
    );

    // 6. mysql_dml.rs & mysql_rd.rs: ON DUPLICATE KEY UPDATE & CREATE TABLE trailing options validation
    assert_invalid(
        LanguageId::MySql,
        "my_dup_bad.sql",
        "INSERT INTO kv (k, v) VALUES (1, 2) ON DUPLICATE KEY UPDATE v = 1 GARBAGE;",
    );
    assert_valid(
        LanguageId::MySql,
        "my_dup_ok.sql",
        "INSERT INTO kv (k, v) VALUES (1, 2) ON DUPLICATE KEY UPDATE v = VALUES(v), k = k + 1;",
    );
    assert_valid(
        LanguageId::MySql,
        "my_dup_alias.sql",
        "INSERT INTO kv (k, v) VALUES (1, 2) AS new_row ON DUPLICATE KEY UPDATE v = new_row.v;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_tbl_bad.sql",
        "CREATE TABLE t (id INT PRIMARY KEY) ENGINE=InnoDB BOGUS GARBAGE;",
    );
    assert_valid(
        LanguageId::MySql,
        "my_tbl_ok.sql",
        "CREATE TABLE t (id INT PRIMARY KEY) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci AUTO_INCREMENT=10 COMMENT='ok' ROW_FORMAT=DYNAMIC;",
    );

    // 7. sql_lex.rs & mysql.rs: quoted/backticked 'user'@'host' and empty '@' still flagged
    assert_valid(
        LanguageId::MySql,
        "my_definer_sq.sql",
        "DELIMITER //\nCREATE DEFINER='root'@'localhost' PROCEDURE my_proc() BEGIN SELECT 1; END //\nDELIMITER ;",
    );
    assert_valid(
        LanguageId::MySql,
        "my_definer_bt.sql",
        "DELIMITER //\nCREATE OR REPLACE DEFINER=`admin`@`%` FUNCTION my_fn() RETURNS INT BEGIN RETURN 1; END //\nDELIMITER ;",
    );
    if let FirewallVerdict::Invalid { diagnostics } = fw.verify(
        "CREATE USER 'app'@'localhost' IDENTIFIED BY 'secret';",
        Path::new("my_user.sql"),
        LanguageId::MySql,
    ) {
        assert!(
            !diagnostics.iter().any(|d| d.message.contains("Empty '@' variable identifier")),
            "Unexpected empty '@' error on 'app'@'localhost': {diagnostics:?}"
        );
    }
    match fw.verify("SET @ = 1;", Path::new("my_empty_at.sql"), LanguageId::MySql) {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(
                diagnostics.iter().any(|d| d.message.contains("Empty '@' variable identifier")),
                "Expected empty '@' error: {diagnostics:?}"
            );
        }
        FirewallVerdict::Valid => panic!("Expected SET @ = 1; to be invalid"),
    }

    // 8. mysql.rs: CREATE ALGORITHM=... DEFINER=... SQL SECURITY ... VIEW ...
    assert_valid(
        LanguageId::MySql,
        "my_view_mods.sql",
        "CREATE ALGORITHM=UNDEFINED DEFINER=CURRENT_USER() SQL SECURITY DEFINER VIEW my_view AS SELECT 1;",
    );
}

#[test]
fn regression_w2_m3_iter4_all_6_clusters_and_backtick_fusion() {
    let fw = DefaultSyntaxFirewall;

    // Cluster 1: PostgreSQL @>, <@, @@ operators vs MySQL/T-SQL @var / @@sysvar / 'user' @ 'host'
    assert_valid(LanguageId::PostgreSql, "pg_jsonb_contains.sql", "SELECT '{\"a\":1}'::jsonb @> '{\"a\":1}'::jsonb;");
    assert_valid(LanguageId::PostgreSql, "pg_jsonb_in.sql", "SELECT '{\"a\":1}'::jsonb <@ '{\"a\":1,\"b\":2}'::jsonb;");
    assert_valid(LanguageId::PostgreSql, "pg_fts.sql", "SELECT to_tsvector('fat cats') @@ to_tsquery('cat');");
    assert_valid(LanguageId::Sqlite, "sq_param.sql", "SELECT * FROM t WHERE id = @id;");
    assert_valid(
        LanguageId::MySql,
        "my_definer_sp.sql",
        "DELIMITER //\nCREATE DEFINER = 'root' @ 'localhost' PROCEDURE sp_host() BEGIN SELECT @@version; END //\nDELIMITER ;",
    );
    assert_invalid(LanguageId::MySql, "my_bad_at.sql", "SET @ = 1;");
    assert_invalid(LanguageId::MySql, "my_bad_atat.sql", "SELECT @@;");
    assert_invalid(LanguageId::TSql, "t_bad_at.sql", "SET @ = 1;");
    assert_invalid(LanguageId::TSql, "t_bad_atat.sql", "SELECT @@;");

    // Cluster 2: sql_pratt.rs — trailing '.', parameterized/array/multi-word '::', TRIM(...), OVER <ident>
    assert_invalid(LanguageId::TSql, "t_trail_dot.sql", "SELECT a. FROM dbo.T;");
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_trail_dot.sql",
        "CREATE FUNCTION f() RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN a.; END; $$;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_trail_dot.sql",
        "DELIMITER //\nCREATE FUNCTION f() RETURNS INT BEGIN RETURN a.; END //\nDELIMITER ;",
    );
    assert_valid(LanguageId::TSql, "t_star_dot.sql", "SELECT dbo.T.* FROM dbo.T;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_varchar.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS VARCHAR LANGUAGE plpgsql AS $$ BEGIN RETURN x::varchar(10); END; $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_numeric.sql",
        "CREATE FUNCTION f(x INT) RETURNS NUMERIC LANGUAGE plpgsql AS $$ DECLARE y NUMERIC; BEGIN y := x::numeric(10, 2); RETURN y; END; $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_arr.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS TEXT[] LANGUAGE plpgsql AS $$ BEGIN RETURN x::text[]; END; $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_dp.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS DOUBLE PRECISION LANGUAGE plpgsql AS $$ BEGIN RETURN x::double precision; END; $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_cast_tz.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS TIMESTAMPTZ LANGUAGE plpgsql AS $$ BEGIN RETURN x::timestamp(6) with time zone; END; $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_cast_bad1.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN x::; END; $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_cast_bad2.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS INT LANGUAGE plpgsql AS $$ BEGIN RETURN x::123; END; $$;",
    );
    assert_valid(LanguageId::TSql, "t_trim.sql", "SELECT TRIM(BOTH ' ' FROM name) FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_trim_lead.sql", "SELECT TRIM(LEADING FROM name) FROM dbo.T;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_trim.sql",
        "CREATE FUNCTION f(x TEXT) RETURNS TEXT LANGUAGE plpgsql AS $$ BEGIN RETURN trim(BOTH ' ' FROM x); END; $$;",
    );
    assert_valid(LanguageId::MySql, "my_trim.sql", "SET @x = TRIM(BOTH ' ' FROM ' a ');");
    assert_invalid(LanguageId::TSql, "t_trim_bad.sql", "SELECT TRIM(BOTH ' ' FROM ) FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_over_named.sql", "SELECT SUM(x) OVER w FROM dbo.T WINDOW w AS (PARTITION BY y);");
    assert_invalid(LanguageId::TSql, "t_over_dangling.sql", "SELECT SUM(x) OVER FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_comma.sql", "SELECT SUM(x) OVER, y FROM dbo.T;");

    // Cluster 3 + challenger_2_r3: MySQL REPEAT..UNTIL, left-adjacent backticks, ENGINE=InnoDB AS SELECT, SET NAMES, standalone INSERT AS alias
    assert_valid(
        LanguageId::MySql,
        "my_repeat.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN DECLARE x INT DEFAULT 0; REPEAT SET x = x + 1; UNTIL x >= 10 END REPEAT; END //\nDELIMITER ;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_repeat_bad_until.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN REPEAT SET x = 1; UNTIL END REPEAT; END //\nDELIMITER ;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_repeat_no_until.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN REPEAT SET x = 1; END REPEAT; END //\nDELIMITER ;",
    );
    assert_valid(LanguageId::MySql, "my_bt_l1.sql", "SELECT`a`FROM items;");
    assert_valid(LanguageId::MySql, "my_bt_l2.sql", "CREATE TABLE`users`(id INT PRIMARY KEY);");
    assert_valid(LanguageId::MySql, "my_bt_l3.sql", "SELECT * FROM`users`WHERE id = 1;");
    assert_valid(LanguageId::MySql, "my_bt_l4.sql", "UPDATE`users`SET id = 2 WHERE id = 1;");
    assert_valid(LanguageId::MySql, "my_bt_l5.sql", "DELETE FROM`users`WHERE id = 1;");
    assert_valid(LanguageId::MySql, "my_bt_l6.sql", "SELECT `a`FROM`items`WHERE`id`=1;");
    assert_valid(LanguageId::MySql, "my_ctas_engine_as.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS SELECT 1;");
    assert_valid(LanguageId::MySql, "my_ctas_engine.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB SELECT 1;");
    assert_invalid(LanguageId::MySql, "my_ctas_bad_sel.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS SELECT FROM t2;");
    assert_valid(LanguageId::MySql, "my_set_names.sql", "SET NAMES utf8mb4;");
    assert_valid(LanguageId::MySql, "my_set_names_col.sql", "SET NAMES 'utf8mb4' COLLATE 'utf8mb4_unicode_ci';");
    assert_valid(LanguageId::MySql, "my_set_charset.sql", "SET CHARACTER SET utf8mb4;");
    assert_valid(LanguageId::MySql, "my_set_tx.sql", "SET SESSION TRANSACTION ISOLATION LEVEL READ COMMITTED;");
    assert_invalid(LanguageId::MySql, "my_set_names_bad.sql", "SET NAMES;");
    assert_valid(LanguageId::MySql, "my_ins_alias.sql", "INSERT INTO kv (k, v) VALUES (1, 2) AS r;");
    assert_valid(LanguageId::MySql, "my_ins_alias_cols.sql", "INSERT INTO kv (k, v) VALUES (1, 2) AS r(a, b);");
    assert_valid(
        LanguageId::MySql,
        "my_ins_select_sub.sql",
        "INSERT INTO kv (k, v) SELECT k, v FROM (SELECT 1 AS k, 2 AS v) AS sub ON DUPLICATE KEY UPDATE v = sub.v;",
    );
    assert_invalid(LanguageId::MySql, "my_ins_alias_bad.sql", "INSERT INTO kv (k, v) VALUES (1, 2) AS r();");

    // Cluster 4: T-SQL CREATE TABLE dangling DEFAULT
    assert_invalid(LanguageId::TSql, "t_dangling_def.sql", "CREATE TABLE dbo.T (id INT DEFAULT);");
    assert_invalid(LanguageId::TSql, "t_dangling_def_nn.sql", "CREATE TABLE dbo.T (id INT DEFAULT NOT NULL);");
    assert_valid(
        LanguageId::TSql,
        "t_valid_defs.sql",
        "CREATE TABLE dbo.T (a INT DEFAULT 0 NOT NULL, b INT DEFAULT (0), c DATETIME DEFAULT GETDATE() NOT NULL, d INT DEFAULT NULL);",
    );

    // Cluster 5: SQLite backtick/bracket identifiers containing '"'
    assert_valid(LanguageId::Sqlite, "sq_dq_bt.sql", "SELECT `a\"b` FROM t;");
    assert_valid(LanguageId::Sqlite, "sq_dq_br.sql", "SELECT [a\"b] FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_empty_br.sql", "SELECT [] FROM t;");

    // Cluster 6: DbMigration SQLite ) \n STRICT
    assert_valid(
        LanguageId::DbMigration,
        "V006__sqlite_strict_nl.sql",
        "-- +goose Up\nCREATE TABLE t (\n  id INT PRIMARY KEY\n)\nSTRICT;",
    );
    let _ = fw;
}

fn first_err_pos(lang: LanguageId, path: &str, src: &str) -> (usize, usize) {
    let fw = DefaultSyntaxFirewall;
    match fw.verify(src, Path::new(path), lang) {
        FirewallVerdict::Invalid { diagnostics } => (diagnostics[0].line, diagnostics[0].column),
        FirewallVerdict::Valid => panic!("Expected INVALID {lang:?} ({path}):\n{src}"),
    }
}

#[test]
fn regression_w2_m3_iter5_verifier_fixes() {
    // Group 1: MySQL backtick widths (w = 3, 4, 5, 7), left/right/both adjacencies & 0-shift 1-based columns
    for (name, sql) in [
        ("bt_w3_r", "SELECT `a`FROM items WHERE id = 1;"),
        ("bt_w3_l", "SELECT`a` FROM items WHERE id = 1;"),
        ("bt_w3_both", "SELECT`a`FROM`t`WHERE`a`=1;"),
        ("bt_w3_utf8", "SELECT`€`FROM`t`WHERE`€`=1;"),
        ("bt_w4_sel", "SELECT`id`FROM items WHERE x = 1;"),
        ("bt_w4_ab", "SELECT`ab`FROM items WHERE id = 1;"),
        ("bt_w4_utf8", "SELECT`€a`FROM items WHERE id = 1;"),
        ("bt_w4_from", "SELECT * FROM`t1`WHERE id = 1;"),
        ("bt_w4_all", "SELECT`id`FROM`t1`WHERE`id`=1;"),
        ("bt_w4_upd1", "UPDATE`kv`SET v = 1;"),
        ("bt_w4_upd2", "UPDATE`t1`SET id = 2 WHERE id = 1;"),
        ("bt_w4_del1", "DELETE FROM`ab`WHERE id = 1;"),
        ("bt_w4_del2", "DELETE FROM`t1`WHERE`id`=1;"),
        ("bt_w4_ins1", "INSERT INTO`kv`VALUES (1);"),
        ("bt_w4_ins2", "INSERT INTO`t1`VALUES(1);"),
        ("bt_w4_join", "SELECT * FROM`t1`JOIN`t2`ON`t1`.`id`=`t2`.`id`;"),
        ("bt_w5", "SELECT`abc`FROM`col`WHERE`abc`=1;"),
        ("bt_w7", "SELECT`users`FROM`items`WHERE`users`=1;"),
    ] {
        assert_valid(LanguageId::MySql, &format!("{name}.sql"), sql);
    }
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w3_1.sql", "SELECT`a`, 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w3_1.sql", "SELECT _b, 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w3_2.sql", "SELECT`a`FROM`t`, 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w3_2.sql", "SELECT _ FROM _ , 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w4_1.sql", "SELECT`ab`, 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w4_1.sql", "SELECT _bt, 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w4_2.sql", "SELECT`id`FROM`t1`WHERE 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w4_2.sql", "SELECT _b FROM _b WHERE 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w5.sql", "SELECT * FROM`abc`WHERE 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w5.sql", "SELECT * FROM _bt WHERE 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "col_w7.sql", "SELECT * FROM`users`WHERE 1 2;"), first_err_pos(LanguageId::MySql, "ctrl_w7.sql", "SELECT * FROM _bt   WHERE 1 2;"));
    assert_invalid(LanguageId::MySql, "bt_empty1.sql", "SELECT `` FROM items;");
    assert_invalid(LanguageId::MySql, "bt_empty2.sql", "SELECT``FROM items;");

    // Group 2: SQLite '"' inside BracketIdent / BacktickIdent / QuotedIdent
    assert_valid(LanguageId::Sqlite, "sq_dq_w1.sql", "SELECT 1 FROM t WHERE [a\"b] = 1;");
    assert_valid(LanguageId::Sqlite, "sq_dq_w2.sql", "SELECT 1 FROM t WHERE `a\"b` = 1;");
    assert_valid(LanguageId::Sqlite, "sq_dq_w3.sql", "SELECT 1 FROM t WHERE \"a\"\"b\" = 1;");
    assert_valid(LanguageId::Sqlite, "sq_dq_adj.sql", "SELECT`a\"b`FROM[c\"d]WHERE[a\"b]=1;");
    assert_valid(LanguageId::Sqlite, "sq_dq_ct1.sql", "CREATE TABLE [a\"b] (id INT PRIMARY KEY, [c\"d] TEXT);");
    assert_valid(LanguageId::Sqlite, "sq_dq_ct2.sql", "CREATE TABLE `a\"b` (id INT PRIMARY KEY, `c\"d` TEXT);");
    assert_valid(LanguageId::Sqlite, "sq_dq_ins.sql", "INSERT INTO [a\"b] ([c\"d]) VALUES ('x');");
    assert_valid(LanguageId::Sqlite, "sq_dq_upd.sql", "UPDATE [a\"b] SET [c\"d] = 'y' WHERE [a\"b] = 1;");
    assert_invalid(LanguageId::Sqlite, "sq_empty_br2.sql", "SELECT [] FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_empty_bt.sql", "SELECT `` FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_dq_bad_where.sql", "SELECT 1 FROM t WHERE [a\"b] = ;");
    assert_invalid(LanguageId::Sqlite, "sq_dq_bad_ct.sql", "CREATE TABLE [a\"b] (id INT, );");

    // Group 3: MySQL labeled blocks + LEAVE/ITERATE + ENGINE=InnoDB AS (SELECT ...)
    assert_valid(
        LanguageId::MySql,
        "my_lbl_repeat.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN my_loop: REPEAT SET x = x + 1; IF x = 3 THEN LEAVE my_loop; END IF; UNTIL x > 5 END REPEAT my_loop; END //\nDELIMITER ;",
    );
    assert_valid(LanguageId::MySql, "my_lbl_begin.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN blk: BEGIN SELECT 1; END blk; END //\nDELIMITER ;");
    assert_valid(LanguageId::MySql, "my_lbl_outer.sql", "DELIMITER //\nCREATE PROCEDURE p() outer_blk: BEGIN SELECT 1; END outer_blk //\nDELIMITER ;");
    assert_valid(LanguageId::MySql, "my_lbl_while.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN wl: WHILE x < 5 DO SET x = x + 1; END WHILE wl; END //\nDELIMITER ;");
    assert_valid(LanguageId::MySql, "my_lbl_loop.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN lp: LOOP SET x = x + 1; IF x < 3 THEN ITERATE lp; END IF; LEAVE lp; END LOOP lp; END //\nDELIMITER ;");
    assert_valid(LanguageId::MySql, "my_lbl_omit_end.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN SELECT 1; END; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_mismatch.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN my_loop: REPEAT SET x = 1; UNTIL x > 5 END REPEAT other_loop; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_orphan.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN REPEAT SET x = 1; UNTIL x > 5 END REPEAT orphan_lbl; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_no_until.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN my_loop: REPEAT SET x = 1; END REPEAT my_loop; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_dup.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN a: BEGIN SELECT 1; END a; END a; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_leave_unknown.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN LEAVE missing; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_iterate_begin.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN ITERATE a; END a; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_select.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN lbl: SELECT 1; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_lbl_if.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN lbl: IF 1 = 1 THEN SELECT 1; END IF; END //\nDELIMITER ;");

    assert_valid(LanguageId::MySql, "my_ctas_paren1.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS (SELECT 1);");
    assert_valid(LanguageId::MySql, "my_ctas_paren2.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB IGNORE AS (SELECT 1);");
    assert_valid(LanguageId::MySql, "my_ctas_paren3.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AS (WITH c AS (SELECT 1 AS x) SELECT x FROM c);");
    assert_invalid(LanguageId::MySql, "my_ctas_paren_bad1.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS (SELECT FROM t2);");
    assert_invalid(LanguageId::MySql, "my_ctas_paren_bad2.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS ();");
    assert_invalid(LanguageId::MySql, "my_ctas_paren_bad3.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB AS (SELECT 1) GARBAGE;");

    // Group 4: T-SQL DEFAULT (...) / AS (...) + Pratt OVER keywords + AnsiSql TRIM(... FROM ...)
    assert_valid(
        LanguageId::TSql,
        "t_def_valid.sql",
        "CREATE TABLE dbo.T (a INT DEFAULT (0), b INT DEFAULT ((0)), c UNIQUEIDENTIFIER DEFAULT (NEWID()), d INT DEFAULT (1 + 2), e INT DEFAULT (NULL), f AS (a + 1) PERSISTED);",
    );
    assert_invalid(LanguageId::TSql, "t_def_bad1.sql", "CREATE TABLE dbo.T (id INT DEFAULT (1 2));");
    assert_invalid(LanguageId::TSql, "t_def_bad2.sql", "CREATE TABLE dbo.T (id INT DEFAULT (1,));");
    assert_invalid(LanguageId::TSql, "t_def_bad3.sql", "CREATE TABLE dbo.T (id INT DEFAULT (1 + ));");
    assert_invalid(LanguageId::TSql, "t_def_bad4.sql", "CREATE TABLE dbo.T (id INT DEFAULT ());");
    assert_invalid(LanguageId::TSql, "t_comp_bad1.sql", "CREATE TABLE dbo.T (a INT, b AS (1 2));");
    assert_invalid(LanguageId::TSql, "t_comp_bad2.sql", "CREATE TABLE dbo.T (a INT, b AS);");

    assert_valid(
        LanguageId::TSql,
        "t_over_valid.sql",
        "SELECT SUM(x) OVER w, SUM(x) OVER win_1, SUM(x) OVER [w], SUM(x) OVER \"w\", SUM(x) OVER [select] FROM dbo.T WINDOW w AS (PARTITION BY y), [select] AS (PARTITION BY y);",
    );
    assert_invalid(LanguageId::TSql, "t_over_kw_sel.sql", "SELECT SUM(x) OVER SELECT y FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_null.sql", "SELECT SUM(x) OVER NULL FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_true.sql", "SELECT SUM(x) OVER TRUE FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_false.sql", "SELECT SUM(x) OVER FALSE FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_case.sql", "SELECT SUM(x) OVER CASE, y FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_not.sql", "SELECT SUM(x) OVER NOT FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_kw_with.sql", "SELECT SUM(x) OVER WITH FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_over_empty_q.sql", "SELECT SUM(x) OVER \"\" FROM dbo.T;");

    assert_valid(LanguageId::AnsiSql, "ansi_trim1.sql", "SELECT TRIM(TRAILING 'x' FROM code) FROM t;");
    assert_valid(LanguageId::AnsiSql, "ansi_trim2.sql", "SELECT TRIM(BOTH ' ' FROM code) FROM t;");
    assert_valid(LanguageId::AnsiSql, "ansi_trim3.sql", "SELECT TRIM(LEADING FROM code) FROM t;");
    assert_valid(LanguageId::AnsiSql, "ansi_trim4.sql", "SELECT TRIM(FROM code) FROM t;");
    assert_valid(LanguageId::AnsiSql, "ansi_trim_nested.sql", "SELECT TRIM(TRAILING ' ' FROM TRIM(LEADING '0' FROM code)) FROM t;");
    assert_valid(LanguageId::PostgreSql, "pg_top_trim.sql", "SELECT TRIM(TRAILING 'x' FROM code) FROM t;");
    assert_invalid(LanguageId::AnsiSql, "ansi_trim_bad1.sql", "SELECT TRIM(TRAILING 'x' FROM ) FROM t;");
    assert_invalid(LanguageId::AnsiSql, "ansi_trim_bad2.sql", "SELECT TRIM(TRAILING 'x') FROM t;");
    assert_invalid(LanguageId::AnsiSql, "ansi_trim_bad3.sql", "SELECT TRIM(TRAILING 'x' 'y' FROM code) FROM t;");
}

#[test]
fn regression_w2_m3_iter6_verifier_fixes() {
    let fw = DefaultSyntaxFirewall;

    // 1. MySQL empty ';' / ';;' statements (top-level valid; empty routine ';' rejected in Iter 9) + B-W2 verify_incremental
    assert_valid(LanguageId::MySql, "my_top_semi.sql", "SELECT 1;;");
    assert_invalid(LanguageId::MySql, "my_semi1.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN ; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_semi2.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1;; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_semi3.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN ; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_missing_semi.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT 1 END //\nDELIMITER ;");
    let base_my = "SELECT FROM t;\n\nDELIMITER //\nCREATE PROCEDURE ok_p() BEGIN SELECT 1; END //\nDELIMITER ;\n";
    let cand_my_ok = "SELECT FROM t;\n\nDELIMITER //\nCREATE PROCEDURE ok_p() BEGIN SELECT 2; END //\nDELIMITER ;\n";
    let cand_my_err = "SELECT FROM t;\n\nDELIMITER //\nCREATE PROCEDURE ok_p() BEGIN SELECT FROM u; END //\nDELIMITER ;\n";
    assert!(fw.verify_incremental(Some(base_my), cand_my_ok, Path::new("m.sql"), LanguageId::MySql).is_valid());
    assert!(!fw.verify_incremental(Some(base_my), cand_my_err, Path::new("m.sql"), LanguageId::MySql).is_valid());

    // 2. MySQL O(1) ref-counted labels + mismatch safety + WHILE/IF/ELSEIF condition validation
    assert_valid(
        LanguageId::MySql,
        "my_lbl_seq_reuse.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN SELECT 1; END a; a: BEGIN SELECT 2; END a; END //\nDELIMITER ;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_lbl_nested_dup.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN a: BEGIN SELECT 1; END a; a: BEGIN SELECT 2; END a; END a; END //\nDELIMITER ;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_lbl_mismatch_pop.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN a: BEGIN END IF; a: BEGIN SELECT 1; END a; END //\nDELIMITER ;",
    );
    assert_invalid(LanguageId::MySql, "my_while_empty.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN WHILE DO SELECT 1; END WHILE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_while_bad.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN WHILE 1 2 DO SELECT 1; END WHILE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_while_semi.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN WHILE x < 5; SELECT 1; END WHILE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_if_empty.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_if_bad.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 2 THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_elseif_empty.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF x = 1 THEN SELECT 1; ELSEIF THEN SELECT 2; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_elseif_bad.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF x = 1 THEN SELECT 1; ELSEIF 1 2 THEN SELECT 2; END IF; END //\nDELIMITER ;");
    assert_valid(
        LanguageId::MySql,
        "my_cond_valid.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN\n  WHILE x < 10 AND EXISTS (SELECT 1 FROM t) DO SET x = x + 1; END WHILE;\n  IF x BETWEEN 1 AND 10 AND `col` IS NOT NULL THEN SELECT 1;\n  ELSEIF CASE WHEN x = 0 THEN 1 ELSE 0 END = 1 THEN SELECT 2;\n  END IF;\nEND //\nDELIMITER ;",
    );

    // 3. MySQL parenless CTAS with table options
    assert_valid(LanguageId::MySql, "my_ctas1.sql", "CREATE TABLE t2 ENGINE=InnoDB REPLACE AS (SELECT 1);");
    assert_valid(LanguageId::MySql, "my_ctas2.sql", "CREATE TABLE t2 ENGINE=InnoDB IGNORE AS (SELECT 1);");
    assert_valid(LanguageId::MySql, "my_ctas3.sql", "CREATE TABLE t2 ENGINE=InnoDB AS (WITH c AS (SELECT 1 AS x) SELECT x FROM c);");
    assert_valid(LanguageId::MySql, "my_ctas4.sql", "CREATE TABLE t2 ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 AS SELECT 1;");
    assert_valid(LanguageId::MySql, "my_ctas5.sql", "CREATE TABLE t2 AS (SELECT 1);");
    assert_valid(LanguageId::MySql, "my_ctas6.sql", "CREATE TEMPORARY TABLE IF NOT EXISTS db.t2 ENGINE=InnoDB REPLACE AS (SELECT 1);");
    assert_invalid(LanguageId::MySql, "my_ctas_bad1.sql", "CREATE TABLE t2 ENGINE=InnoDB REPLACE AS (SELECT FROM t1);");
    assert_invalid(LanguageId::MySql, "my_ctas_bad2.sql", "CREATE TABLE t2 ENGINE=InnoDB AS ();");
    assert_invalid(LanguageId::MySql, "my_ctas_bad3.sql", "CREATE TABLE t2 ENGINE=InnoDB AS (SELECT 1) GARBAGE;");
    assert_invalid(LanguageId::MySql, "my_ctas_bad4.sql", "CREATE TABLE t2 ENGINE=InnoDB BOGUS AS (SELECT 1);");
    assert_invalid(LanguageId::MySql, "my_ctas_bad5.sql", "CREATE TABLE t2 ENGINE=InnoDB;");

    // 4. TRIM consistency + MySQL backtick 0-shift parity (w = 3, 4, 5, 7) + sql_pratt FROM rules
    assert_valid(LanguageId::MySql, "my_trim_sel.sql", "SELECT TRIM(BOTH ' ' FROM 'x');");
    assert_valid(LanguageId::MySql, "my_trim_bt1.sql", "SELECT TRIM(BOTH `x` FROM `a`) FROM `t`;");
    assert_valid(LanguageId::MySql, "my_trim_bt2.sql", "SELECT TRIM(BOTH'x'FROM`a`)FROM`t`;");
    assert_valid(LanguageId::MySql, "my_trim_bt3.sql", "SELECT TRIM(TRAILING `€` FROM `a`) FROM `t`;");
    assert_valid(LanguageId::MySql, "my_trim_proc.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN SELECT TRIM(BOTH ' ' FROM `col`) FROM `t`; END //\nDELIMITER ;");
    assert_valid(LanguageId::MySql, "my_trim_tbl.sql", "CREATE TABLE t (a VARCHAR(10) DEFAULT (TRIM(BOTH ' ' FROM 'x'))) ENGINE=InnoDB;");
    assert_valid(LanguageId::MySql, "my_trim_dup.sql", "INSERT INTO t (a) VALUES (TRIM(BOTH ' ' FROM 'x')) ON DUPLICATE KEY UPDATE a = TRIM(BOTH ' ' FROM 'y');");
    assert_valid(LanguageId::AnsiSql, "ansi_trim_fn.sql", "SELECT TRIM(BOTH ' ' FROM fn(a, b)), TRIM(BOTH FROM x), TRIM(FROM x), TRIM(x), TRIM(x, 'y') FROM t;");
    assert_valid(LanguageId::Sqlite, "sq_trim_2arg.sql", "SELECT TRIM(col, ' ') FROM t;");
    assert_invalid(LanguageId::MySql, "my_trim_nofrom.sql", "SELECT TRIM(BOTH ' ');");
    assert_invalid(LanguageId::MySql, "my_trim_empty_target.sql", "SELECT TRIM(TRAILING 'x' FROM );");
    assert_invalid(LanguageId::MySql, "my_trim_zero.sql", "SELECT TRIM();");
    assert_invalid(LanguageId::MySql, "my_trim_empty_bt.sql", "SELECT TRIM(BOTH `` FROM `a`);");
    assert_invalid(LanguageId::MySql, "my_trim_dup_bad.sql", "INSERT INTO t (a) VALUES ('x') ON DUPLICATE KEY UPDATE a = TRIM(BOTH ' ');");
    assert_invalid(LanguageId::TSql, "t_trim_nofrom1.sql", "SELECT TRIM(BOTH ' ');");
    assert_invalid(LanguageId::TSql, "t_trim_nofrom2.sql", "SELECT TRIM(TRAILING 'x');");
    assert_invalid(LanguageId::TSql, "t_trim_multi.sql", "SELECT TRIM(TRAILING 'x' FROM a, b);");
    assert_invalid(LanguageId::TSql, "t_trim_order.sql", "SELECT TRIM(BOTH 'x' ORDER BY y);");
    assert_invalid(LanguageId::TSql, "t_trim_twofrom.sql", "SELECT TRIM(BOTH 'x' FROM a FROM b);");
    assert_invalid(LanguageId::TSql, "t_trim_zero.sql", "SELECT TRIM();");
    assert_invalid(LanguageId::PostgreSql, "pg_trim_ret_bad.sql", "DO $$ BEGIN RETURN TRIM(BOTH ' '); END $$;");
    assert_eq!(first_err_pos(LanguageId::MySql, "trim_bt_w3.sql", "SELECT TRIM(BOTH ' ' FROM `a`), 1 2;"), first_err_pos(LanguageId::MySql, "trim_bt_w3_c.sql", "SELECT TRIM(              _bt), 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "trim_bt_w4.sql", "SELECT TRIM(BOTH `x` FROM `ab`), 1 2;"), first_err_pos(LanguageId::MySql, "trim_bt_w4_c.sql", "SELECT TRIM(              _bt ), 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "trim_bt_w5.sql", "SELECT TRIM(BOTH ' ' FROM`abc`), 1 2;"), first_err_pos(LanguageId::MySql, "trim_bt_w5_c.sql", "SELECT TRIM(             _bt  ), 1 2;"));
    assert_eq!(first_err_pos(LanguageId::MySql, "trim_bt_w7.sql", "SELECT TRIM(BOTH ' ' FROM`users`), 1 2;"), first_err_pos(LanguageId::MySql, "trim_bt_w7_c.sql", "SELECT TRIM(             _bt    ), 1 2;"));

    // 5. T-SQL column CHECK & table-level CONSTRAINT ... DEFAULT/CHECK
    assert_invalid(LanguageId::TSql, "t_chk_col_bad1.sql", "CREATE TABLE dbo.T (id INT CHECK (1 2));");
    assert_invalid(LanguageId::TSql, "t_chk_col_bad2.sql", "CREATE TABLE dbo.T (id INT CHECK ());");
    assert_invalid(LanguageId::TSql, "t_chk_col_bad3.sql", "CREATE TABLE dbo.T (id INT CHECK);");
    assert_invalid(LanguageId::TSql, "t_tbl_def_bad.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT DF_t DEFAULT (1 2) FOR id);");
    assert_invalid(LanguageId::TSql, "t_tbl_chk_bad1.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT CK_t CHECK (1 2));");
    assert_invalid(LanguageId::TSql, "t_tbl_chk_bad2.sql", "CREATE TABLE dbo.T (id INT, CHECK (1 2));");
    assert_invalid(LanguageId::TSql, "t_tbl_con_inc.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT );");
    assert_invalid(LanguageId::TSql, "t_tbl_def_nofor.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT DF_t DEFAULT (0) FOR);");
    assert_valid(
        LanguageId::TSql,
        "t_chk_tbl_ok.sql",
        "CREATE TABLE dbo.T (id INT CHECK (id > 0), age INT CHECK NOT FOR REPLICATION (age >= 0), CONSTRAINT DF_t DEFAULT (0) FOR id, CONSTRAINT CK_t CHECK (id > 0 AND age >= 0), CONSTRAINT PK_t PRIMARY KEY (id), CONSTRAINT UQ_t UNIQUE (age), CONSTRAINT FK_t FOREIGN KEY (id) REFERENCES dbo.P(id));\nCREATE TABLE dbo.U (id INT PRIMARY KEY WITH (PAD_INDEX = ON) ON [ps](id));",
    );

    // 6. PL/pgSQL PERFORM, SELECT..INTO TRIM, LANGUAGE sql, top-level ::NULL casts & AnsiSql parse_cst
    assert_valid(
        LanguageId::PostgreSql,
        "pg_into_trim.sql",
        "CREATE FUNCTION f() RETURNS TEXT LANGUAGE plpgsql AS $$ DECLARE r TEXT; BEGIN SELECT TRIM(BOTH ' ' FROM 'x') INTO r; RETURN r; END; $$;",
    );
    assert_valid(LanguageId::PostgreSql, "pg_perf_trim.sql", "DO $$ BEGIN PERFORM TRIM(BOTH ' ' FROM 'x'); END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_perf_fn.sql", "DO $$ BEGIN PERFORM fn(a, b); END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_perf_q.sql", "DO $$ BEGIN PERFORM 1 FROM accounts WHERE id = 1; END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_lang_sql_trim.sql", "CREATE FUNCTION f() RETURNS TEXT LANGUAGE sql AS $$ SELECT TRIM(BOTH ' ' FROM 'x'); $$;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_top_casts_ok.sql",
        "SELECT x::int[], x::numeric(10, 2), x::double precision, x::timestamp(6) with time zone FROM t;",
    );
    assert_invalid(LanguageId::PostgreSql, "pg_perf_bad1.sql", "DO $$ BEGIN PERFORM TRIM(TRAILING 'x' FROM ); END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_bad2.sql", "DO $$ BEGIN PERFORM TRIM(TRAILING 'x'); END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_bad3.sql", "DO $$ BEGIN PERFORM 1 2; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_bad4.sql", "DO $$ BEGIN PERFORM; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_bad5.sql", "DO $$ BEGIN PERFORM FROM accounts; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_top_cast_null.sql", "SELECT x::NULL FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_top_cast_true.sql", "SELECT x::TRUE FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_top_cast_false.sql", "SELECT x::FALSE FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_top_cast_with.sql", "SELECT x::WITH FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_top_cast_create.sql", "SELECT x::CREATE FROM t;");

    let reg = EngineRegistry::new();
    let ansi_tree = reg
        .adapter(LanguageId::AnsiSql)
        .unwrap()
        .parse_cst("SELECT TRIM(BOTH ' ' FROM 'hello');")
        .unwrap();
    assert!(!ansi_tree.has_error(), "AnsiSqlAdapter::parse_cst failed on TRIM(BOTH ' ' FROM 'hello')");
}

#[test]
fn regression_w2_m3_iter7_verifier_fixes() {
    // 1. sql_pratt.rs: TRIM('x' FROM a, b), duplicate FROM, FN_STOP_KWS bypass
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::TSql] {
        assert_invalid(lang, "trim_from_multi.sql", "SELECT TRIM('x' FROM a, b) FROM t;");
        assert_invalid(lang, "trim_from_dup.sql", "SELECT TRIM('x' FROM a FROM b) FROM t;");
        assert_invalid(lang, "trim_order_by.sql", "SELECT TRIM('x' ORDER BY y) FROM t;");
        assert_invalid(lang, "trim_as.sql", "SELECT TRIM('x' AS y) FROM t;");
        assert_invalid(lang, "trim_from_order.sql", "SELECT TRIM('x' FROM a ORDER BY y) FROM t;");
        assert_invalid(lang, "trim_comma_from.sql", "SELECT TRIM('x', 'y' FROM z) FROM t;");
        assert_valid(lang, "trim_chars_from_ok.sql", "SELECT TRIM('x' FROM a), TRIM(FROM x), TRIM(BOTH FROM x), TRIM(BOTH ' ' FROM fn(a, b)), TRIM(x) FROM t;");
    }
    assert_valid(LanguageId::AnsiSql, "trim_sqlite_ok.sql", "SELECT TRIM(x, 'y') FROM t;");
    assert_valid(LanguageId::Sqlite, "sq_trim_ok.sql", "SELECT TRIM(x), TRIM(x, 'y') FROM t;");
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::TSql] {
        assert_invalid(lang, "trim_3arg.sql", "SELECT TRIM(x, 'y', 'z') FROM t;");
    }
    assert_valid(LanguageId::PostgreSql, "pg_fn_stop_ok.sql", "SELECT STRING_AGG(x, ',' ORDER BY x), CAST(x AS INT) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_trim_multi.sql", "DO $$ BEGIN PERFORM TRIM('x' FROM a, b); END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_ret_trim_dup.sql", "DO $$ BEGIN RETURN TRIM('x' FROM a FROM b); END $$;");
    assert_invalid(LanguageId::MySql, "my_nested_trim_multi.sql", "SELECT TRIM(BOTH 'x' FROM TRIM('a' FROM 'b', 'c')) FROM t;");

    // 2. sql_pratt_ext.rs: reserved SQL keywords as atoms + PG double type modifier
    assert_invalid(LanguageId::MySql, "my_if_and.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF AND THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_while_or.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN WHILE OR DO SELECT 1; END WHILE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::PostgreSql, "pg_if_where.sql", "DO $$ BEGIN IF WHERE THEN PERFORM 1; END IF; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_sel.sql", "DO $$ BEGIN PERFORM SELECT; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_perf_vals.sql", "DO $$ BEGIN PERFORM VALUES; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_double_mod1.sql", "SELECT x::timestamp(6) with time zone (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_double_mod2.sql", "SELECT x::timestamp(6)(10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_double_mod3.sql", "SELECT x::timestamp with time zone (10) FROM t;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_val_kws_and_casts.sql",
        "SELECT NULL, TRUE, FALSE, CURRENT_DATE, CURRENT_TIME, CURRENT_TIMESTAMP, LOCALTIME, LOCALTIMESTAMP, CURRENT_USER, USER, SESSION_USER, SYSTEM_USER, t.order, t.select, t.from, \"select\", x::timestamp(6) with time zone, x::timestamp(6)[], x::character varying(10), x::interval day to second(6) FROM t;",
    );
    assert_valid(LanguageId::PostgreSql, "pg_default_val.sql", "INSERT INTO t (a) VALUES (DEFAULT);");
    assert_valid(LanguageId::MySql, "my_qual_bt.sql", "SELECT t.order, t.select, t.from, `order`, `select` FROM t;");
    assert_valid(LanguageId::TSql, "t_qual_br.sql", "SELECT t.order, t.select, t.from, [order], [select] FROM dbo.T;");

    // 3. mysql_stmt.rs & mysql_ctrl.rs: stored-routine CASE, duplicate/orphan ELSE, single-stmt routines
    assert_valid(
        LanguageId::MySql,
        "my_case_simple.sql",
        "DELIMITER //\nCREATE PROCEDURE p(x INT)\nBEGIN\n  CASE x\n    WHEN 1 THEN SELECT 1;\n    WHEN 2 THEN SELECT 2;\n    ELSE SELECT 3;\n  END CASE;\nEND //\nDELIMITER ;",
    );
    assert_valid(
        LanguageId::MySql,
        "my_case_searched.sql",
        "DELIMITER //\nCREATE PROCEDURE p(x INT)\nBEGIN\n  CASE\n    WHEN x = 1 THEN SELECT 1;\n    ELSE SELECT 2;\n  END CASE;\nEND //\nDELIMITER ;",
    );
    assert_valid(LanguageId::MySql, "my_single_proc_ok.sql", "CREATE PROCEDURE p() INSERT INTO t VALUES (1, 2);");
    assert_valid(LanguageId::MySql, "my_single_fn_ok.sql", "CREATE FUNCTION f(x INT) RETURNS VARCHAR(50) CHARSET utf8mb4 DETERMINISTIC RETURN CONCAT(x, 'a');");
    assert_valid(LanguageId::MySql, "my_single_trig_ok.sql", "CREATE TRIGGER tr AFTER INSERT ON t FOR EACH ROW INSERT INTO audit (id) VALUES (NEW.id);");
    assert_valid(LanguageId::MySql, "my_single_trig_set.sql", "CREATE TRIGGER tr AFTER INSERT ON t FOR EACH ROW SET NEW.x = 1;");
    assert_valid(LanguageId::MySql, "my_single_evt_ok.sql", "CREATE EVENT ev ON SCHEDULE EVERY 1 HOUR DO DELETE FROM logs WHERE old = 1;");
    assert_valid(LanguageId::MySql, "my_drop_alter_proc.sql", "DROP PROCEDURE IF EXISTS p; ALTER PROCEDURE p COMMENT 'ok';");
    assert_invalid(LanguageId::MySql, "my_alter_proc_bad.sql", "ALTER PROCEDURE p GARBAGE;");
    assert_invalid(LanguageId::MySql, "my_case_no_when.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_else_first.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x ELSE SELECT 1; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_dup_else.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN SELECT 1; ELSE SELECT 2; ELSE SELECT 3; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_when_after_else.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN SELECT 1; ELSE SELECT 2; WHEN 3 THEN SELECT 3; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_if_dup_else.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; ELSE SELECT 2; ELSE SELECT 3; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_orphan_else.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN ELSE SELECT 1; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_single_proc_bad.sql", "CREATE PROCEDURE p() INSERT INTO t VALUES (1 2);");
    assert_invalid(LanguageId::MySql, "my_single_fn_bad.sql", "CREATE FUNCTION f() RETURNS INT RETURN 1 2;");
    assert_invalid(LanguageId::MySql, "my_single_trig_bad.sql", "CREATE TRIGGER tr AFTER INSERT ON t FOR EACH ROW INSERT INTO audit VALUES (1 2);");
    assert_invalid(LanguageId::MySql, "my_single_evt_bad.sql", "CREATE EVENT ev ON SCHEDULE EVERY 1 HOUR DO INSERT INTO t VALUES (1 2);");
    assert_invalid(LanguageId::MySql, "my_begin_ret_bad.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN RETURN 1 2; END //\nDELIMITER ;");

    // 4. mysql_opt.rs: PARTITION BY validation
    assert_valid(LanguageId::MySql, "my_part_hash.sql", "CREATE TABLE t (id INT) PARTITION BY HASH(id) PARTITIONS 4;");
    assert_valid(LanguageId::MySql, "my_part_key.sql", "CREATE TABLE t (id INT) ENGINE=InnoDB PARTITION BY LINEAR KEY ALGORITHM=2 (id) PARTITIONS 2;");
    assert_valid(LanguageId::MySql, "my_part_range.sql", "CREATE TABLE t (id INT, y INT) PARTITION BY RANGE(y) (PARTITION p0 VALUES LESS THAN (2024), PARTITION p1 VALUES LESS THAN MAXVALUE);");
    assert_valid(LanguageId::MySql, "my_part_list_cols.sql", "CREATE TABLE t (id INT, k VARCHAR(10)) PARTITION BY LIST COLUMNS(k) (PARTITION p_a VALUES IN ('a'));");
    assert_valid(LanguageId::MySql, "my_part_sub.sql", "CREATE TABLE t (id INT, y INT) PARTITION BY RANGE(y) SUBPARTITION BY HASH(id) SUBPARTITIONS 2 (PARTITION p0 VALUES LESS THAN (2024));");
    assert_invalid(LanguageId::MySql, "my_part_garbage.sql", "CREATE TABLE t (id INT) PARTITION BY GARBAGE;");
    assert_invalid(LanguageId::MySql, "my_part_empty.sql", "CREATE TABLE t (id INT) PARTITION BY HASH();");
    assert_invalid(LanguageId::MySql, "my_part_bad_expr.sql", "CREATE TABLE t (id INT) PARTITION BY HASH(1 2);");
    assert_invalid(LanguageId::MySql, "my_part_bad_cnt.sql", "CREATE TABLE t (id INT) PARTITION BY RANGE(id) PARTITIONS abc;");
    assert_invalid(LanguageId::MySql, "my_part_trail.sql", "CREATE TABLE t (id INT) PARTITION BY HASH(id) GARBAGE;");

    // 5. tsql_ddl.rs, tsql_rd.rs, tsql_stmt.rs: CONSTRAINT trailing/target, IF/WHILE, SET @x, RETURN
    assert_invalid(LanguageId::TSql, "t_con_def_trail.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT DF_t DEFAULT (0) FOR id GARBAGE);");
    assert_invalid(LanguageId::TSql, "t_con_def_num.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT DF_t DEFAULT (0) FOR 123);");
    assert_invalid(LanguageId::TSql, "t_con_def_nofor.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT DF_t DEFAULT (0));");
    assert_invalid(LanguageId::TSql, "t_con_pk_trail.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT PK_t PRIMARY KEY (id) GARBAGE);");
    assert_invalid(LanguageId::TSql, "t_con_fk_trail.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT FK_t FOREIGN KEY (id) REFERENCES dbo.P(id) GARBAGE);");
    assert_invalid(LanguageId::TSql, "t_con_uq_empty.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT UQ_t UNIQUE ());");
    assert_invalid(LanguageId::TSql, "t_if_bad.sql", "IF 1 = BEGIN SELECT 1; END;");
    assert_invalid(LanguageId::TSql, "t_while_bad.sql", "WHILE 1 2 BEGIN BREAK; END;");
    assert_invalid(LanguageId::TSql, "t_set_bare.sql", "SET @x;");
    assert_invalid(LanguageId::TSql, "t_set_noop.sql", "SET @x 1;");
    assert_invalid(LanguageId::TSql, "t_ret_bad.sql", "CREATE PROC dbo.P AS BEGIN RETURN 1 2; END;");
    assert_valid(
        LanguageId::TSql,
        "t_con_and_flow_ok.sql",
        "CREATE TABLE dbo.T (id INT, p_id INT, CONSTRAINT PK_t PRIMARY KEY CLUSTERED (id ASC) WITH (PAD_INDEX = ON) ON [PRIMARY], CONSTRAINT UQ_t UNIQUE NONCLUSTERED (p_id) ON [ps](p_id), CONSTRAINT FK_t FOREIGN KEY (p_id) REFERENCES dbo.P(id) ON DELETE CASCADE ON UPDATE NO ACTION NOT FOR REPLICATION, CONSTRAINT DF_t DEFAULT (0) FOR p_id);\nSET NOCOUNT ON;\nSET ANSI_NULLS ON;\nSET TRANSACTION ISOLATION LEVEL READ COMMITTED;\nIF EXISTS (SELECT 1 FROM dbo.T) AND OBJECT_ID('dbo.T') IS NOT NULL BEGIN SET @x += 1; RETURN 0; END ELSE BEGIN RETURN @rc; END;\nIF UPDATE(p_id) BEGIN RETURN; END;\nWHILE @i < 10 BEGIN SET @i = @i + 1; END;\nRETURN (SELECT 1);",
    );

    // 6. plpgsql_stmt.rs: empty INTO [STRICT] target
    assert_invalid(LanguageId::PostgreSql, "pg_into_strict_empty.sql", "DO $$ BEGIN SELECT a INTO STRICT FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_empty.sql", "DO $$ BEGIN SELECT a INTO FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_strict_eof.sql", "DO $$ BEGIN SELECT a INTO STRICT; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_strict_num.sql", "DO $$ BEGIN SELECT a INTO STRICT 123 FROM t; END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_into_strict_ok.sql", "DO $$ BEGIN SELECT a INTO STRICT r FROM t; SELECT a, b INTO r1, r2 FROM t; INSERT INTO t (a) VALUES (1) RETURNING id INTO STRICT v_id; END $$;");
}

#[test]
fn regression_w2_m3_iter8_verifier_fixes() {
    // 1. Dot-preceded member-access guards across all 5 SQL dialects
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::TSql, LanguageId::Sqlite] {
        assert_valid(lang, "dot_and_or.sql", "SELECT t.and, t.or FROM t;");
        assert_valid(lang, "dot_where_and.sql", "SELECT x FROM t WHERE a = t.and AND b = t.or;");
        assert_valid(lang, "dot_where_set.sql", "SELECT 1 FROM t WHERE t.where = 1 AND t.set = 1;");
        assert_valid(lang, "dot_on_join.sql", "SELECT * FROM dbo.T JOIN dbo.U ON dbo.T.on = dbo.U.id WHERE a.where = 1;");
    }
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::TSql] {
        assert_valid(lang, "dot_trim_from_expr.sql", "SELECT TRIM(t.from || ' ') FROM t;");
        assert_valid(lang, "dot_trim_sel_where.sql", "SELECT TRIM(BOTH FROM t.from), t.select, t.where FROM t;");
    }
    assert_valid(LanguageId::TSql, "t_dot_clauses.sql", "SELECT t.where, t.having, t.join, t.on FROM dbo.T AS t;");
    assert_valid(LanguageId::TSql, "t_dot_where_cmp.sql", "SELECT 1 FROM dbo.T WHERE x = t.where;");
    assert_valid(LanguageId::TSql, "t_dot_sel_and.sql", "SELECT 1 FROM dbo.T WHERE x = t.select AND y = 1;");
    assert_valid(LanguageId::TSql, "t_dot_if_sel.sql", "IF t.select = 1 BEGIN RETURN; END;");
    assert_valid(LanguageId::TSql, "t_dot_if_open.sql", "IF t.open = 1 BEGIN RETURN; END;");
    assert_valid(LanguageId::PostgreSql, "pg_dot_into.sql", "DO $$ BEGIN SELECT t.into FROM t; PERFORM t.into; END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_dot_into_var.sql", "DO $$ BEGIN SELECT t.into INTO r FROM t; END $$;");

    // 2. PostgreSQL array cast double modifiers & INTERVAL unit modifiers
    assert_invalid(LanguageId::PostgreSql, "pg_arr_mod1.sql", "SELECT x::int[] (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_arr_mod2.sql", "SELECT x::varchar(10)[] (20) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_arr_mod3.sql", "DO $$ BEGIN PERFORM x::int[] (10); END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_mod_bad.sql", "SELECT x::interval year(4) to month (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_mod_bad2.sql", "SELECT x::interval day(2) to second(6) (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_mod_bad3.sql", "SELECT x::interval hour to minute (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_dup_mod.sql", "SELECT x::interval(6)(10) FROM t;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_intv_ok.sql",
        "SELECT x::interval year(4) to month, x::interval day(2) to second(6), x::interval hour to minute, x::interval(6), x::int[] FROM t;",
    );

    // 3. PL/pgSQL INTO [STRICT] comma/ident grammar
    assert_invalid(LanguageId::PostgreSql, "pg_into_nocomma.sql", "DO $$ BEGIN SELECT a INTO r1 r2 FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_leadcomma.sql", "DO $$ BEGIN SELECT a INTO , r FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_trailcomma.sql", "DO $$ BEGIN SELECT a INTO r, FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_traildot.sql", "DO $$ BEGIN SELECT a INTO r. FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_into_strict_nocomma.sql", "DO $$ BEGIN SELECT a INTO STRICT r1 r2 FROM t; END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_into_rec_ok.sql", "DO $$ BEGIN SELECT a, b INTO STRICT rec.f1, rec.f2 FROM t; END $$;");

    // 4. MySQL PARTITION BY item body, ALTER PROCEDURE/FUNCTION, empty IF/CASE/RETURN;
    assert_invalid(LanguageId::MySql, "my_part_item_garbage.sql", "CREATE TABLE t (id INT) PARTITION BY RANGE(y) (PARTITION p0 GARBAGE);");
    assert_invalid(LanguageId::MySql, "my_part_lt_empty.sql", "CREATE TABLE t (id INT) PARTITION BY RANGE(y) (PARTITION p0 VALUES LESS THAN ());");
    assert_invalid(LanguageId::MySql, "my_part_in_empty.sql", "CREATE TABLE t (id INT) PARTITION BY LIST(y) (PARTITION p0 VALUES IN ());");
    assert_invalid(LanguageId::MySql, "my_subpart_garbage.sql", "CREATE TABLE t (id INT) PARTITION BY RANGE(y) (PARTITION p0 VALUES LESS THAN (2024) (SUBPARTITION s0 GARBAGE));");
    assert_valid(
        LanguageId::MySql,
        "my_part_full_ok.sql",
        "CREATE TABLE t (id INT, a INT, b INT) PARTITION BY RANGE COLUMNS(a, b) SUBPARTITION BY HASH(id) SUBPARTITIONS 2 (PARTITION p0 VALUES LESS THAN (2024, MAXVALUE) ENGINE=InnoDB COMMENT='ok' (SUBPARTITION s0, SUBPARTITION s1));",
    );
    assert_invalid(LanguageId::MySql, "my_alter_num.sql", "ALTER PROCEDURE 123;");
    assert_invalid(LanguageId::MySql, "my_alter_comment_empty.sql", "ALTER PROCEDURE p COMMENT;");
    assert_invalid(LanguageId::MySql, "my_alter_lang_empty.sql", "ALTER PROCEDURE p LANGUAGE;");
    assert_invalid(LanguageId::MySql, "my_alter_sec_empty.sql", "ALTER PROCEDURE p SQL SECURITY;");
    assert_invalid(LanguageId::MySql, "my_alter_fn_dot.sql", "ALTER FUNCTION db.;");
    assert_valid(LanguageId::MySql, "my_alter_ok.sql", "ALTER PROCEDURE db.p COMMENT 'ok' SQL SECURITY DEFINER;");
    assert_invalid(LanguageId::MySql, "my_if_empty_body.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_if_empty_else.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; ELSE END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_if_empty_elseif.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; ELSEIF 2 = 2 THEN END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_empty_when.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN ELSE SELECT 2; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_empty_else.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN SELECT 1; ELSE END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_empty_when2.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN WHEN 2 THEN SELECT 2; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_fn_empty_ret1.sql", "CREATE FUNCTION f() RETURNS INT RETURN;");
    assert_invalid(LanguageId::MySql, "my_fn_empty_ret2.sql", "DELIMITER //\nCREATE FUNCTION f() RETURNS INT BEGIN RETURN; END //\nDELIMITER ;");
    assert_valid(
        LanguageId::MySql,
        "my_if_nested_ok.sql",
        "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN IF x = 1 THEN IF x > 0 THEN SELECT 1; END IF; ELSEIF x = 2 THEN SELECT 2; ELSE SELECT 3; END IF; END //\nDELIMITER ;",
    );

    // 5. SQLite PRAGMA keyword settings
    assert_valid(
        LanguageId::Sqlite,
        "sq_pragma_kws_ok.sql",
        "PRAGMA journal_mode = DELETE;\nPRAGMA journal_mode = WAL;\nPRAGMA synchronous = NORMAL;\nPRAGMA locking_mode = EXCLUSIVE;\nPRAGMA temp_store = MEMORY;\nPRAGMA auto_vacuum = INCREMENTAL;\nPRAGMA foreign_keys = ON;\nPRAGMA foreign_keys = OFF;\nPRAGMA journal_mode(TRUNCATE);\nPRAGMA legacy_file_format = YES;\nPRAGMA reverse_unordered_selects = NO;\nPRAGMA synchronous = FULL;\nPRAGMA journal_mode = PERSIST;\nPRAGMA encoding = NONE;",
    );
    assert_invalid(LanguageId::Sqlite, "sq_pragma_garbage.sql", "PRAGMA foreign_keys = ON GARBAGE;");
    assert_invalid(LanguageId::Sqlite, "sq_pragma_and.sql", "PRAGMA foreign_keys = AND;");
    assert_invalid(LanguageId::Sqlite, "sq_pragma_paren_bad.sql", "PRAGMA journal_mode(DELETE GARBAGE);");

    // 6. Bare EXISTS/LOOP/REPEAT/WHILE & empty WITH ()
    assert_invalid(LanguageId::TSql, "t_bare_exists.sql", "IF EXISTS BEGIN SELECT 1; END;");
    assert_invalid(LanguageId::PostgreSql, "pg_bare_exists.sql", "DO $$ BEGIN IF EXISTS THEN PERFORM 1; END IF; END $$;");
    assert_invalid(LanguageId::MySql, "my_bare_loop.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF LOOP THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_bare_repeat.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF REPEAT THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_bare_while.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF WHILE THEN SELECT 1; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::TSql, "t_empty_with_con.sql", "CREATE TABLE dbo.T (id INT, CONSTRAINT PK_t PRIMARY KEY (id) WITH ());");
    assert_invalid(LanguageId::TSql, "t_empty_with_col.sql", "CREATE TABLE dbo.T (id INT PRIMARY KEY WITH ());");
    assert_valid(LanguageId::TSql, "t_exists_ok.sql", "IF EXISTS (SELECT 1 FROM dbo.T) BEGIN SELECT 1; END;");
    assert_valid(LanguageId::PostgreSql, "pg_exists_ok.sql", "DO $$ BEGIN IF EXISTS (SELECT 1) THEN PERFORM 1; END IF; END $$;");
    assert_valid(LanguageId::PostgreSql, "pg_dot_loop_ok.sql", "SELECT t.exists, t.loop, t.repeat, t.while FROM t;");
}

#[test]
fn regression_w2_m3_iter9_verifier_fixes() {
    // 1. .case / .end Dot predecessor guards in CASE/END depth counters (T-SQL, MySQL, PL/pgSQL)
    assert_valid(LanguageId::TSql, "t_dot_case_sel.sql", "SELECT t.case FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_dot_case_end_sel.sql", "SELECT t.case, t.end, CASE WHEN t.end = 1 THEN t.case ELSE 0 END FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_dot_case_if.sql", "IF t.case = 1 BEGIN RETURN; END;");
    assert_valid(LanguageId::TSql, "t_dot_case_if_stmt.sql", "IF 1 = 1 SELECT t.case FROM dbo.T ELSE SELECT t.end FROM dbo.T;");
    assert_valid(
        LanguageId::MySql,
        "my_dot_case_ctrl.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF t.case = 1 THEN SELECT t.end FROM t; END IF; WHILE t.case = 1 DO SELECT 1; END WHILE; REPEAT SELECT t.case; UNTIL t.end = 1 END REPEAT; CASE t.case WHEN 1 THEN SELECT 1; END CASE; END //\nDELIMITER ;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_dot_case_ctrl.sql",
        "DO $$ BEGIN IF t.case = 1 THEN PERFORM 1; END IF; PERFORM t.case FROM t; PERFORM t.case; IF CASE WHEN t.end = 1 THEN 1 ELSE 0 END = 1 THEN PERFORM 1; END IF; END $$;",
    );

    // 2. .then / .end / stop-keyword Dot guards in MySQL & PL/pgSQL condition scanners
    assert_valid(
        LanguageId::MySql,
        "my_dot_then_end.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF t.then = 1 THEN SELECT 1; END IF; IF t.end = 1 THEN SELECT 1; END IF; IF t.else = 1 THEN SELECT 1; END IF; IF t.elseif = 1 THEN SELECT 1; END IF; WHILE t.do = 1 DO SELECT 1; END WHILE; CASE x WHEN t.then THEN SELECT 1; END CASE; END //\nDELIMITER ;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_dot_then_end.sql",
        "DO $$ BEGIN IF t.then = 1 THEN PERFORM 1; ELSIF t.end = 1 THEN PERFORM 1; ELSIF t.select = 1 THEN PERFORM 1; END IF; WHILE t.loop = 1 LOOP PERFORM 1; END LOOP; CASE t.when WHEN 1 THEN PERFORM 1; END CASE; END $$;",
    );
    assert_invalid(
        LanguageId::MySql,
        "my_dot_then_missing_then.sql",
        "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF t.then = 1 SELECT 1; END IF; END //\nDELIMITER ;",
    );

    // 3. PL/pgSQL duplicate INTO rejection
    assert_invalid(LanguageId::PostgreSql, "pg_dup_into.sql", "DO $$ BEGIN SELECT a INTO r1 INTO r2 FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_dup_into_strict.sql", "DO $$ BEGIN SELECT a INTO STRICT r1 INTO r2 FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_dup_into_consec.sql", "DO $$ BEGIN SELECT a INTO INTO r2 FROM t; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_dup_into_ret.sql", "DO $$ BEGIN INSERT INTO t (a) VALUES (1) RETURNING a INTO r1 INTO r2; END $$;");
    assert_invalid(LanguageId::PostgreSql, "pg_dup_into_perf.sql", "DO $$ BEGIN PERFORM a INTO r1 INTO r2 FROM t; END $$;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_ins_and_dot_into_ok.sql",
        "DO $$ BEGIN INSERT INTO t (a) VALUES (1) RETURNING a INTO r1; SELECT t.into INTO r2 FROM t; END $$;",
    );

    // 4. PostgreSQL INTERVAL cast structured unit grammar
    assert_invalid(LanguageId::PostgreSql, "pg_intv_to_to.sql", "SELECT x::interval to to FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_bare_to.sql", "SELECT x::interval to FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_year_year.sql", "SELECT x::interval year year FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_dangling_to.sql", "SELECT x::interval year(4) to FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_trail_mod.sql", "SELECT x::interval year(4) to month (10) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_year_mod.sql", "SELECT x::interval year(4) FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_chain_to.sql", "SELECT x::interval day to hour to second FROM t;");
    assert_invalid(LanguageId::PostgreSql, "pg_intv_perf_to.sql", "DO $$ BEGIN PERFORM x::interval to; END $$;");
    assert_valid(
        LanguageId::PostgreSql,
        "pg_intv_valid_all.sql",
        "SELECT x::interval, x::interval(6), x::interval year, x::interval year(4) to month, x::interval day(2) to second(6), x::interval second(6), x::interval day to hour, x::interval hour to second(6) FROM t;",
    );

    // 5. MySQL empty ';' in branches & empty BEGIN/WHILE/LOOP/REPEAT bodies
    assert_invalid(LanguageId::MySql, "my_if_semi.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN ; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_else_semi.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; ELSE ; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_elseif_semi.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN IF 1 = 1 THEN SELECT 1; ELSEIF 2 = 2 THEN ; END IF; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_when_semi.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN ; ELSE SELECT 2; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_case_else_semi.sql", "DELIMITER //\nCREATE PROCEDURE p(x INT) BEGIN CASE x WHEN 1 THEN SELECT 1; ELSE ; END CASE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_empty_while.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN WHILE 1 = 1 DO END WHILE; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_empty_loop.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN LOOP END LOOP; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_empty_repeat.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN REPEAT UNTIL 1 = 1 END REPEAT; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_empty_inner_begin.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN BEGIN END; END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_empty_outer_begin.sql", "DELIMITER //\nCREATE PROCEDURE p() BEGIN END //\nDELIMITER ;");
    assert_invalid(LanguageId::MySql, "my_single_semi_proc.sql", "DELIMITER //\nCREATE PROCEDURE p() ; //\nDELIMITER ;");
    assert_valid(
        LanguageId::MySql,
        "my_nested_ctrl_ok.sql",
        "SELECT 1;;\nDELIMITER //\nCREATE PROCEDURE p() BEGIN lp: LOOP IF 1 = 1 THEN LEAVE lp; END IF; END LOOP lp; WHILE 1 = 1 DO BEGIN SELECT 1; END; END WHILE; END //\nDELIMITER ;",
    );

    // 6. T-SQL empty EXISTS () & SQLite numeric PRAGMA main.123
    assert_invalid(LanguageId::TSql, "t_empty_exists_if.sql", "IF EXISTS () BEGIN SELECT 1; END;");
    assert_invalid(LanguageId::TSql, "t_empty_exists_not.sql", "IF NOT EXISTS () BEGIN RETURN; END;");
    assert_invalid(LanguageId::TSql, "t_empty_exists_where.sql", "SELECT 1 FROM dbo.T WHERE EXISTS ();");
    assert_valid(LanguageId::TSql, "t_dot_exists_fn_ok.sql", "SELECT t.exists() FROM dbo.T;");
    assert_invalid(LanguageId::Sqlite, "sq_pragma_num_member.sql", "PRAGMA main.123;");
    assert_invalid(LanguageId::Sqlite, "sq_pragma_num.sql", "PRAGMA 123;");
    assert_invalid(LanguageId::Sqlite, "sq_pragma_dot_eof.sql", "PRAGMA main.;");
    assert_valid(LanguageId::Sqlite, "sq_pragma_schema_ok.sql", "PRAGMA main.journal_mode = DELETE;\nPRAGMA main.table_info('users');");
}

#[test]
fn regression_w2_m3_iter10_verifier_fixes() {
    // 1. T-SQL WITH CTE syntax & body validation (positive & negative)
    assert_invalid(LanguageId::TSql, "t_with_empty_parens.sql", "WITH () SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_empty_body.sql", "WITH c AS () SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_garbage_body.sql", "WITH c AS (GARBAGE) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_no_main.sql", "WITH c AS (SELECT 1);");
    assert_invalid(LanguageId::TSql, "t_with_lead_comma.sql", "WITH , c AS (SELECT 1) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_empty_cols.sql", "WITH c () AS (SELECT 1) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_cols_nocomma.sql", "WITH c (a b) AS (SELECT 1, 2) SELECT a FROM c;");
    assert_invalid(LanguageId::TSql, "t_with_trail_comma.sql", "WITH c AS (SELECT 1), SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_bad_main_kw.sql", "WITH c AS (SELECT 1) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_ddl_main.sql", "WITH c AS (SELECT 1) CREATE TABLE dbo.T (id INT);");
    assert_invalid(LanguageId::TSql, "t_with_union_trail.sql", "WITH c AS (SELECT 1 UNION ALL) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_union_garbage.sql", "WITH c AS (SELECT 1 UNION ALL GARBAGE) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_bad_select.sql", "WITH c AS (SELECT FROM dbo.T) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_with_nested_bad.sql", "WITH c1 AS (WITH c2 AS () SELECT 1) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_view_with_bad.sql", "CREATE VIEW dbo.V AS WITH c AS () SELECT 1;");

    assert_valid(LanguageId::TSql, "t_with_ok.sql", "WITH c AS (SELECT 1 AS x) SELECT x FROM c;");
    assert_valid(LanguageId::TSql, "t_with_cols_ok.sql", "WITH c (col1, col2) AS (SELECT 1, 2) SELECT col1, col2 FROM c;");
    assert_valid(
        LanguageId::TSql,
        "t_with_multi_ok.sql",
        "WITH c1 AS (SELECT 1 AS x), c2 (y) AS (SELECT x + 1 FROM c1) SELECT y FROM c2;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_with_rec_ok.sql",
        "WITH nums (n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM nums WHERE n < 5) SELECT n FROM nums OPTION (MAXRECURSION 5);",
    );
    assert_valid(
        LanguageId::TSql,
        "t_with_ins_ok.sql",
        "WITH c AS (SELECT id FROM dbo.Src) INSERT INTO dbo.Dst (id) SELECT id FROM c;",
    );
    assert_valid(LanguageId::TSql, "t_with_upd_ok.sql", "WITH c AS (SELECT id FROM dbo.T WHERE x = 1) UPDATE c SET x = 2;");
    assert_valid(LanguageId::TSql, "t_with_del_ok.sql", "WITH c AS (SELECT TOP (10) id FROM dbo.T ORDER BY id) DELETE FROM c;");
    assert_valid(
        LanguageId::TSql,
        "t_with_merge_ok.sql",
        "WITH c AS (SELECT id, v FROM dbo.Src) MERGE dbo.Dst AS t USING c AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.v = s.v;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_with_xml_ok.sql",
        "WITH XMLNAMESPACES (DEFAULT 'urn:example'), c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_with_proc_ok.sql",
        "CREATE PROC dbo.P AS BEGIN WITH c AS (SELECT 1 AS x) SELECT x FROM c; END;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_view_with_ok.sql",
        "CREATE VIEW dbo.V AS WITH c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_tbl_with_opts_ok.sql",
        "CREATE TABLE dbo.T (id INT PRIMARY KEY WITH (PAD_INDEX = ON));",
    );

    // 2. PL/pgSQL CASE statement selector (d, c) depth tracking & validation
    assert_valid(
        LanguageId::PostgreSql,
        "pg_case_sel_paren_nested.sql",
        "DO $$ BEGIN CASE (CASE WHEN t.x = 1 THEN 1 ELSE 2 END) WHEN 1 THEN PERFORM 1; END CASE; END $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_case_sel_bare_nested.sql",
        "DO $$ BEGIN CASE CASE WHEN t.x = 1 THEN 1 ELSE 2 END WHEN 1 THEN PERFORM 1; END CASE; END $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_case_searched_ok.sql",
        "DO $$ BEGIN CASE WHEN t.x = 1 THEN PERFORM 1; ELSE PERFORM 2; END CASE; END $$;",
    );
    assert_valid(
        LanguageId::PostgreSql,
        "pg_case_sel_dot_ok.sql",
        "DO $$ BEGIN CASE (CASE WHEN t.end = 1 THEN t.case ELSE 0 END) WHEN t.when THEN PERFORM 1; END CASE; END $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_case_sel_bad_trail.sql",
        "DO $$ BEGIN CASE 1 2 WHEN 1 THEN PERFORM 1; END CASE; END $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_case_sel_dangling.sql",
        "DO $$ BEGIN CASE x + WHEN 1 THEN PERFORM 1; END CASE; END $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_case_no_when.sql",
        "DO $$ BEGIN CASE x END CASE; END $$;",
    );
    assert_invalid(
        LanguageId::PostgreSql,
        "pg_case_else_no_when.sql",
        "DO $$ BEGIN CASE x ELSE PERFORM 1; END CASE; END $$;",
    );

    // 3. 2 MiB stack iterative safety on deeply nested CTEs & PL/pgSQL CASE selector
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let depth = 2_000;
            let mut deep_with = String::new();
            for i in 0..depth {
                deep_with.push_str(&format!("WITH c{i} AS ("));
            }
            deep_with.push_str("SELECT 1 AS x");
            for i in (0..depth).rev() {
                deep_with.push_str(&format!(") SELECT x FROM c{i}"));
            }
            deep_with.push(';');
            assert_valid(LanguageId::TSql, "t_deep_with.sql", &deep_with);

            let deep_pg_case = format!(
                "DO $$ BEGIN CASE {}CASE WHEN t.x = 1 THEN 1 ELSE 2 END{} WHEN 1 THEN PERFORM 1; END CASE; END $$;",
                "(".repeat(depth),
                ")".repeat(depth),
            );
            assert_valid(LanguageId::PostgreSql, "pg_deep_case_sel.sql", &deep_pg_case);
        })
        .expect("spawn 2MiB stack thread");
    handle.join().expect("2MiB deep iter10 thread should not overflow");
}

#[test]
fn regression_w2_m3_iter11_verifier_fixes() {
    // 1. CREATE OR ALTER VIEW ... (plain, WITH SCHEMABINDING + AS WITH, WITH XMLNAMESPACES)
    assert_valid(LanguageId::TSql, "t_coa_view_plain.sql", "CREATE OR ALTER VIEW dbo.V AS SELECT 1 AS x;");
    assert_valid(
        LanguageId::TSql,
        "t_coa_view_with.sql",
        "CREATE OR ALTER VIEW dbo.V (x) WITH SCHEMABINDING AS WITH c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_coa_view_xml.sql",
        "CREATE OR ALTER VIEW dbo.V AS WITH XMLNAMESPACES (DEFAULT 'urn:ex'), c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_coa_view_after_stmt.sql",
        "SELECT 1; CREATE OR ALTER VIEW dbo.V AS WITH c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_invalid(
        LanguageId::TSql,
        "t_coa_view_bad_with.sql",
        "CREATE OR ALTER VIEW dbo.V AS WITH c AS () SELECT 1;",
    );

    // 2. Empty / trailing-comma column lists in INSERT & WITH CTE
    assert_invalid(LanguageId::TSql, "t_ins_empty_cols.sql", "INSERT INTO dbo.T () VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_ins_trail_comma.sql", "INSERT INTO dbo.T (a,) VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_ins_lead_comma.sql", "INSERT INTO dbo.T (,a) VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_with_ins_empty_cols.sql", "WITH c AS (SELECT 1) INSERT INTO dbo.T () VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_with_cte_trail_comma.sql", "WITH c (a,) AS (SELECT 1) SELECT a FROM c;");
    assert_invalid(LanguageId::TSql, "t_with_cte_lead_comma.sql", "WITH c (,a) AS (SELECT 1) SELECT a FROM c;");

    // 3. T-SQL DML tail validation (WITH-prefixed & standalone INSERT/UPDATE/MERGE/DELETE)
    assert_invalid(LanguageId::TSql, "t_with_ins_notail.sql", "WITH c AS (SELECT 1) INSERT INTO dbo.T;");
    assert_invalid(LanguageId::TSql, "t_with_ins_garbage.sql", "WITH c AS (SELECT 1) INSERT GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_notail.sql", "INSERT INTO dbo.T;");
    assert_invalid(LanguageId::TSql, "t_ins_garbage.sql", "INSERT GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_vals_garbage.sql", "INSERT INTO dbo.T VALUES (1) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_default_only.sql", "INSERT INTO dbo.T DEFAULT;");
    assert_invalid(LanguageId::TSql, "t_with_upd_notail.sql", "WITH c AS (SELECT 1) UPDATE c;");
    assert_invalid(LanguageId::TSql, "t_with_upd_garbage.sql", "WITH c AS (SELECT 1) UPDATE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_upd_notail.sql", "UPDATE c;");
    assert_invalid(LanguageId::TSql, "t_upd_garbage.sql", "UPDATE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_upd_set_garbage.sql", "UPDATE dbo.T SET x = 1 GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_merge_notail.sql", "WITH c AS (SELECT 1) MERGE dbo.T;");
    assert_invalid(LanguageId::TSql, "t_with_merge_garbage.sql", "WITH c AS (SELECT 1) MERGE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_merge_notail.sql", "MERGE dbo.T;");
    assert_invalid(LanguageId::TSql, "t_merge_garbage.sql", "MERGE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_merge_no_when.sql", "MERGE dbo.T USING dbo.S AS s ON dbo.T.id = s.id;");
    assert_invalid(LanguageId::TSql, "t_del_bare.sql", "DELETE;");
    assert_invalid(LanguageId::TSql, "t_del_from_bare.sql", "DELETE FROM;");
    assert_invalid(LanguageId::TSql, "t_del_num.sql", "DELETE 123;");
    assert_invalid(LanguageId::TSql, "t_del_garbage.sql", "DELETE t GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_del_garbage.sql", "WITH c AS (SELECT 1) DELETE c GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_del_output_empty.sql", "DELETE t OUTPUT;");
    assert_invalid(LanguageId::TSql, "t_del_opt_empty.sql", "DELETE t OPTION ();");

    // Valid DML variants preserved
    assert_valid(LanguageId::TSql, "t_del_bare_tbl_ok.sql", "DELETE dbo.T;");
    assert_valid(LanguageId::TSql, "t_del_from_tbl_ok.sql", "DELETE FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_with_del_no_from_ok.sql", "WITH c AS (SELECT 1 AS id) DELETE c;");
    assert_valid(LanguageId::TSql, "t_del_top_where_ok.sql", "DELETE TOP (10) FROM dbo.T WHERE id > 0;");
    assert_valid(LanguageId::TSql, "t_del_alias_join_ok.sql", "DELETE t FROM dbo.T AS t JOIN dbo.U AS u ON t.id = u.id WHERE u.flag = 1;");
    assert_valid(LanguageId::TSql, "t_del_output_ok.sql", "DELETE dbo.T OUTPUT deleted.id INTO @ids (id) WHERE id > 0;");
    assert_valid(LanguageId::TSql, "t_ins_default_vals_ok.sql", "INSERT INTO dbo.T DEFAULT VALUES;");
    assert_valid(LanguageId::TSql, "t_with_ins_exec_ok.sql", "WITH c AS (SELECT 1 AS x) INSERT INTO dbo.T EXEC dbo.MyProc;");
    assert_valid(LanguageId::TSql, "t_ins_paren_sel_ok.sql", "INSERT INTO dbo.T (SELECT 1);");
    assert_invalid(LanguageId::TSql, "t_ins_paren_garbage.sql", "INSERT INTO dbo.T (SELECT 1) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_sel_union_garbage.sql", "INSERT INTO dbo.T SELECT 1 UNION ALL GARBAGE;");
    assert_valid(LanguageId::TSql, "t_ins_top_cols_ok.sql", "INSERT TOP (5) INTO dbo.T (a, b) OUTPUT inserted.a VALUES (1, 2);");
    assert_valid(LanguageId::TSql, "t_upd_from_ok.sql", "UPDATE TOP (5) t SET t.x = s.x OUTPUT inserted.x FROM dbo.T AS t JOIN dbo.S AS s ON t.id = s.id WHERE s.active = 1 OPTION (MAXDOP 1);");
    assert_valid(LanguageId::TSql, "t_upd_case_ok.sql", "UPDATE dbo.T SET x = CASE WHEN a = 1 THEN 10 ELSE 20 END, y = DEFAULT, z = NULL WHERE id = 1;");
    assert_valid(
        LanguageId::TSql,
        "t_merge_full_ok.sql",
        "MERGE INTO dbo.Dst AS t USING (SELECT id, v FROM dbo.Src) AS s ON t.id = s.id WHEN MATCHED THEN UPDATE SET t.v = CASE WHEN s.v > 0 THEN s.v ELSE 0 END WHEN NOT MATCHED THEN INSERT (id, v) VALUES (s.id, s.v) OUTPUT $action, inserted.id OPTION (MAXDOP 1);",
    );

    // 4. T-SQL CTE ORDER BY before set operators (UNION/INTERSECT/EXCEPT)
    assert_invalid(LanguageId::TSql, "t_cte_order_union.sql", "WITH c AS (SELECT 1 ORDER BY 1 UNION ALL SELECT 2) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_cte_order_intersect.sql", "WITH c AS (SELECT 1 ORDER BY 1 INTERSECT SELECT 2) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_cte_order_except.sql", "WITH c AS (SELECT 1 UNION SELECT 2 ORDER BY 1 EXCEPT SELECT 3) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_cte_paren_order_union.sql", "WITH c AS ((SELECT 1) ORDER BY 1 UNION ALL SELECT 2) SELECT 1;");
    assert_valid(LanguageId::TSql, "t_cte_order_final_ok.sql", "WITH c AS (SELECT 1 UNION ALL SELECT 2 ORDER BY 1) SELECT 1;");
    assert_valid(LanguageId::TSql, "t_cte_paren_order_ok.sql", "WITH c AS ((SELECT TOP (1) 1 ORDER BY 1) UNION ALL SELECT 2) SELECT 1;");
    assert_valid(LanguageId::TSql, "t_cte_over_order_union_ok.sql", "WITH c AS (SELECT ROW_NUMBER() OVER (ORDER BY id) AS rn FROM dbo.T UNION ALL SELECT 1 FROM dbo.U) SELECT rn FROM c;");
    assert_valid(LanguageId::TSql, "t_cte_dot_order_union_ok.sql", "WITH c AS (SELECT t.order FROM dbo.T UNION ALL SELECT 1 FROM dbo.U) SELECT * FROM c;");
}

#[test]
fn regression_w2_m3_iter12_verifier_fixes() {
    // Cluster 1: Cross-dialect DEFAULT VALUES guard, UPDATE/MERGE SET hardening, OUTPUT validation
    for lang in [LanguageId::AnsiSql, LanguageId::PostgreSql, LanguageId::MySql, LanguageId::Sqlite, LanguageId::TSql] {
        assert_invalid(lang, "sel_default_vals.sql", "SELECT DEFAULT VALUES;");
        assert_invalid(lang, "sel_from_default_vals.sql", "SELECT 1 FROM t DEFAULT VALUES;");
    }
    assert_invalid(LanguageId::TSql, "t_ins_sel_def_vals.sql", "INSERT INTO dbo.T SELECT DEFAULT VALUES;");
    assert_invalid(LanguageId::TSql, "t_with_sel_def_vals.sql", "WITH c AS (SELECT DEFAULT VALUES) SELECT 1;");
    assert_valid(LanguageId::TSql, "t_with_ins_def_vals_ok.sql", "WITH c AS (SELECT 1) INSERT INTO dbo.T DEFAULT VALUES;");
    assert_valid(
        LanguageId::TSql,
        "t_merge_ins_def_vals_ok.sql",
        "MERGE INTO dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN NOT MATCHED THEN INSERT DEFAULT VALUES;",
    );

    assert_invalid(LanguageId::TSql, "t_set_lead_comma.sql", "UPDATE dbo.T SET , a = 1;");
    assert_invalid(LanguageId::TSql, "t_set_empty_output.sql", "UPDATE dbo.T SET , OUTPUT INSERTED.a;");
    assert_invalid(LanguageId::TSql, "t_set_trail_comma_opt.sql", "UPDATE dbo.T SET a = 1, OPTION (RECOMPILE);");
    assert_invalid(LanguageId::TSql, "t_set_missing_rhs_out.sql", "UPDATE dbo.T SET a = OUTPUT INSERTED.a;");
    assert_invalid(LanguageId::TSql, "t_set_bare_call.sql", "UPDATE dbo.T SET x();");
    assert_invalid(LanguageId::TSql, "t_merge_set_empty.sql", "MERGE dbo.T USING dbo.S ON 1=1 WHEN MATCHED THEN UPDATE SET , WHEN NOT MATCHED THEN DELETE;");
    assert_invalid(LanguageId::TSql, "t_merge_set_trail.sql", "MERGE dbo.T USING dbo.S ON 1=1 WHEN MATCHED THEN UPDATE SET t.a = 1, WHEN NOT MATCHED THEN DELETE;");
    assert_invalid(LanguageId::TSql, "t_merge_set_no_rhs.sql", "MERGE dbo.T USING dbo.S ON 1=1 WHEN MATCHED THEN UPDATE SET t.a = WHEN NOT MATCHED THEN DELETE;");
    assert_valid(LanguageId::TSql, "t_set_defaults_ok.sql", "UPDATE dbo.T SET x = DEFAULT, y = NULL, z += 1 WHERE id = 1;");
    assert_valid(LanguageId::TSql, "t_set_clr_write_ok.sql", "UPDATE dbo.T SET doc.Write('abc', 0, 1) WHERE id = 1;");

    assert_invalid(LanguageId::TSql, "t_out_123.sql", "INSERT INTO dbo.T OUTPUT 1 2 3 VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_out_garbage.sql", "UPDATE dbo.T SET x = 1 OUTPUT GARBAGE GARBAGE WHERE id = 1;");
    assert_invalid(LanguageId::TSql, "t_out_dangling_as.sql", "UPDATE dbo.T SET x = 1 OUTPUT INSERTED.x AS WHERE id = 1;");
    assert_invalid(LanguageId::TSql, "t_out_lead_comma.sql", "UPDATE dbo.T SET x = 1 OUTPUT , INSERTED.x WHERE id = 1;");
    assert_invalid(LanguageId::TSql, "t_out_star_alias.sql", "UPDATE dbo.T SET x = 1 OUTPUT INSERTED.* AS a WHERE id = 1;");
    assert_valid(LanguageId::TSql, "t_out_star_ok.sql", "INSERT INTO dbo.T (a) OUTPUT INSERTED.* VALUES (1);");
    assert_valid(LanguageId::TSql, "t_out_as_alias_ok.sql", "DELETE dbo.T OUTPUT DELETED.id AS old_id WHERE id > 0;");
    assert_valid(LanguageId::TSql, "t_out_bare_alias_ok.sql", "DELETE dbo.T OUTPUT DELETED.id old_id WHERE id > 0;");
    assert_valid(
        LanguageId::TSql,
        "t_out_action_into_ok.sql",
        "MERGE INTO dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN MATCHED THEN DELETE OUTPUT $action INTO @t (act);",
    );

    // Cluster 2: INSERT (cols) DEFAULT VALUES, EXEC, UPDATE/DELETE FROM/WHERE ordering, MERGE WHEN, mutual recursion guard
    assert_invalid(LanguageId::TSql, "t_ins_cols_def_vals.sql", "INSERT INTO dbo.T (a) DEFAULT VALUES;");
    assert_invalid(LanguageId::TSql, "t_merge_ins_cols_def_vals.sql", "MERGE dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN NOT MATCHED THEN INSERT (a) DEFAULT VALUES;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_empty.sql", "INSERT INTO dbo.T EXEC ();");
    assert_invalid(LanguageId::TSql, "t_ins_exec_num.sql", "INSERT INTO dbo.T EXEC 123;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_dot.sql", "INSERT INTO dbo.T EXEC dbo.;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_rc_eof.sql", "INSERT INTO dbo.T EXEC @rc = ;");
    assert_valid(LanguageId::TSql, "t_ins_exec_proc_ok.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @p = 1;");
    assert_valid(LanguageId::TSql, "t_ins_exec_rc_ok.sql", "INSERT INTO dbo.T EXEC @rc = dbo.MyProc;");
    assert_valid(LanguageId::TSql, "t_ins_exec_str_ok.sql", "INSERT INTO dbo.T EXEC ('SELECT 1');");
    assert_valid(LanguageId::TSql, "t_ins_exec_var_ok.sql", "INSERT INTO dbo.T EXEC (@sql);");

    assert_invalid(LanguageId::TSql, "t_upd_where_from.sql", "UPDATE dbo.T SET x = 1 WHERE id = 1 FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_del_where_from.sql", "DELETE t WHERE id = 1 FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t_upd_from_garbage.sql", "UPDATE dbo.T SET x = 1 FROM GARBAGE GARBAGE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_del_from_garbage.sql", "DELETE t FROM GARBAGE GARBAGE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_upd_join_no_on.sql", "UPDATE dbo.T SET x = 1 FROM dbo.A JOIN dbo.B;");
    assert_invalid(LanguageId::TSql, "t_upd_cross_join_on.sql", "UPDATE dbo.T SET x = 1 FROM dbo.A CROSS JOIN dbo.B ON a.id = b.id;");
    assert_valid(LanguageId::TSql, "t_upd_inner_join_ok.sql", "UPDATE dbo.T SET x = 1 FROM dbo.A AS a INNER JOIN dbo.B b ON a.id = b.id;");
    assert_valid(LanguageId::TSql, "t_upd_cross_apply_ok.sql", "UPDATE dbo.T SET x = 1 FROM dbo.A a CROSS APPLY (SELECT TOP (1) * FROM dbo.B b WHERE b.id = a.id) x;");
    assert_valid(LanguageId::TSql, "t_upd_comma_nolock_ok.sql", "UPDATE dbo.T SET x = 1 FROM dbo.A a, dbo.B b WITH (NOLOCK);");
    assert_valid(LanguageId::TSql, "t_upd_derived_ok.sql", "UPDATE dbo.T SET x = 1 FROM (SELECT id FROM dbo.S) AS sub WHERE dbo.T.id = sub.id;");
    assert_valid(LanguageId::TSql, "t_upd_distinct_from_ok.sql", "UPDATE dbo.T SET x = 1 WHERE a IS NOT DISTINCT FROM b OPTION (MAXDOP 1);");
    assert_valid(LanguageId::TSql, "t_upd_current_of_ok.sql", "UPDATE dbo.T SET x = 1 WHERE CURRENT OF cur;");

    assert_invalid(LanguageId::TSql, "t_merge_when_garbage.sql", "MERGE dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN GARBAGE THEN DELETE;");
    assert_invalid(LanguageId::TSql, "t_merge_when_by_garbage.sql", "MERGE dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN NOT MATCHED BY GARBAGE THEN INSERT (id) VALUES (s.id);");
    assert_valid(
        LanguageId::TSql,
        "t_merge_when_by_ok.sql",
        "MERGE dbo.T AS t USING dbo.S AS s ON t.id = s.id WHEN MATCHED AND s.v > 0 THEN UPDATE SET t.v = s.v WHEN NOT MATCHED BY SOURCE THEN DELETE WHEN NOT MATCHED BY TARGET AND s.v > 0 THEN INSERT (id, v) VALUES (s.id, s.v);",
    );
    assert_invalid(LanguageId::TSql, "t_ins_paren_with_dml.sql", "INSERT INTO dbo.T (WITH c AS (SELECT 1) INSERT INTO dbo.T VALUES (1));");
    assert_invalid(LanguageId::TSql, "t_nested_cte_dml.sql", "WITH c1 AS (WITH c2 AS (SELECT 1) INSERT INTO dbo.T VALUES (1)) SELECT 1;");

    // Cluster 3: Query tails (OPTION, ORDER BY, OFFSET..FETCH, FOR) & CREATE [OR ALTER] DDL / VIEW
    assert_invalid(LanguageId::TSql, "t_with_opt_empty.sql", "WITH c AS (SELECT 1) SELECT * FROM c OPTION ();");
    assert_invalid(LanguageId::TSql, "t_sel_opt_empty.sql", "SELECT * FROM dbo.T OPTION ();");
    assert_invalid(LanguageId::TSql, "t_ins_paren_opt_empty.sql", "INSERT INTO dbo.T (SELECT 1) OPTION ();");
    assert_invalid(LanguageId::TSql, "t_ins_paren_opt_garbage.sql", "INSERT INTO dbo.T (SELECT 1) OPTION (MAXDOP 1) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_paren_opt_garbage.sql", "WITH c AS (SELECT 1) (SELECT * FROM c) OPTION (MAXDOP 1) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_paren_ord_garbage.sql", "WITH c AS (SELECT 1) (SELECT * FROM c) ORDER BY 1 GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_with_paren_for_garbage.sql", "WITH c AS (SELECT 1) (SELECT * FROM c) FOR XML PATH('') GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_paren_ord_garbage.sql", "INSERT INTO dbo.T (SELECT 1) ORDER BY 1 GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_paren_offset_no_ord.sql", "INSERT INTO dbo.T (SELECT 1) OFFSET 0 ROWS;");
    assert_invalid(LanguageId::TSql, "t_coa_table_bad.sql", "CREATE OR ALTER TABLE dbo.T (id INT);");
    assert_invalid(LanguageId::TSql, "t_coa_index_bad.sql", "CREATE OR ALTER INDEX ix ON dbo.T (id);");
    assert_invalid(LanguageId::TSql, "t_alter_or_alter_bad.sql", "ALTER OR ALTER VIEW dbo.V AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_create_or_replace_bad.sql", "CREATE OR REPLACE VIEW dbo.V AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_view_no_as.sql", "CREATE VIEW dbo.V;");
    assert_invalid(LanguageId::TSql, "t_coa_view_no_as.sql", "CREATE OR ALTER VIEW dbo.V;");
    assert_invalid(LanguageId::TSql, "t_coa_view_as_empty.sql", "CREATE OR ALTER VIEW dbo.V AS;");
    assert_invalid(LanguageId::TSql, "t_alter_view_as_empty.sql", "ALTER VIEW dbo.V AS;");
    assert_invalid(LanguageId::TSql, "t_coa_view_as_garbage.sql", "CREATE OR ALTER VIEW dbo.V AS GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_coa_view_dml.sql", "CREATE OR ALTER VIEW dbo.V AS WITH c AS (SELECT 1 AS x) INSERT INTO dbo.T VALUES (1);");
    assert_invalid(LanguageId::TSql, "t_coa_view_empty_cols.sql", "CREATE OR ALTER VIEW dbo.V () AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_coa_view_bad_attr.sql", "CREATE OR ALTER VIEW dbo.V WITH BOGUS AS SELECT 1;");

    assert_valid(LanguageId::TSql, "t_with_paren_tail_ok.sql", "WITH c AS (SELECT 1) (SELECT * FROM c) ORDER BY 1 OFFSET 0 ROWS FETCH NEXT 5 ROWS ONLY OPTION (MAXDOP 1);");
    assert_valid(LanguageId::TSql, "t_with_paren_xml_ok.sql", "WITH c AS (SELECT 1) (SELECT * FROM c) FOR XML PATH('');");
    assert_valid(LanguageId::TSql, "t_sel_xml_opts_ok.sql", "SELECT * FROM dbo.T FOR XML AUTO, ELEMENTS, ROOT('items'), TYPE OPTION (MAXDOP 1);");
    assert_valid(LanguageId::TSql, "t_sel_json_ok.sql", "SELECT * FROM dbo.T FOR JSON PATH, INCLUDE_NULL_VALUES;");
    assert_valid(LanguageId::TSql, "t_sel_systime_ok.sql", "SELECT * FROM dbo.T FOR SYSTEM_TIME AS OF '2025-01-01' OPTION (RECOMPILE);");
    assert_valid(LanguageId::TSql, "t_view_check_opt_ok.sql", "CREATE VIEW dbo.V AS SELECT 1 AS x WITH CHECK OPTION;");
    assert_valid(
        LanguageId::TSql,
        "t_coa_view_full_ok.sql",
        "CREATE OR ALTER VIEW dbo.V (x) WITH SCHEMABINDING, VIEW_METADATA AS WITH c AS (SELECT 1 AS x) SELECT x FROM c WITH CHECK OPTION;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_coa_view_xml_ok.sql",
        "CREATE OR ALTER VIEW dbo.V AS WITH XMLNAMESPACES (DEFAULT 'urn:ex'), c AS (SELECT 1 AS x) SELECT x FROM c;",
    );
    assert_valid(LanguageId::TSql, "t_dot_tail_kws_ok.sql", "SELECT t.order, t.option, t.for, t.offset FROM dbo.T;");

    let reg = EngineRegistry::new();
    let v_src = "CREATE OR ALTER VIEW dbo.V (x) WITH SCHEMABINDING AS SELECT 1 AS x;";
    let v_adp = reg.adapter(LanguageId::TSql).unwrap();
    let v_tree = v_adp.parse_cst(v_src).unwrap();
    assert!(!v_tree.has_error());
    let v_syms = v_adp.extract_symbols(&v_tree, v_src);
    assert!(v_syms.iter().any(|s| s.name == "V" && s.qualified_name == "dbo.V"), "syms={v_syms:?}");

    // 2 MiB stack iterative O(N) safety for deep INSERT (((SELECT ...))) and UPDATE ... FROM (((SELECT ...)))
    let handle = std::thread::Builder::new()
        .stack_size(2 * 1024 * 1024)
        .spawn(|| {
            let depth = 2_000;
            let o = "(".repeat(depth);
            let c = ")".repeat(depth);
            let deep_ins = format!("INSERT INTO dbo.T {o}SELECT 1{c};");
            assert_valid(LanguageId::TSql, "t_deep_ins_paren.sql", &deep_ins);
            let deep_upd = format!("UPDATE dbo.T SET x = 1 FROM {o}SELECT 1 AS id{c} AS s WHERE dbo.T.id = s.id;");
            assert_valid(LanguageId::TSql, "t_deep_upd_from_paren.sql", &deep_upd);
        })
        .expect("spawn 2MiB stack thread");
    handle.join().expect("2MiB deep iter12 thread should not overflow");
}

#[test]
fn regression_w2_m3_iter13_verifier_fixes() {
    // Cluster 1: T-SQL FROM derived joins, (()), FOR SYSTEM_TIME, TABLESAMPLE, TVF/PIVOT args, double-FROM DELETE
    assert_valid(
        LanguageId::TSql,
        "t_upd_systime_asof_ok.sql",
        "UPDATE t SET t.x = s.v FROM dbo.T t JOIN dbo.S FOR SYSTEM_TIME AS OF '2024-01-01' AS s ON t.id = s.id;",
    );
    assert_valid(LanguageId::TSql, "t_upd_systime_all_ok.sql", "UPDATE t SET t.x = 1 FROM dbo.T t FOR SYSTEM_TIME ALL;");
    assert_valid(
        LanguageId::TSql,
        "t_upd_systime_contained_ok.sql",
        "UPDATE t SET t.x = 1 FROM dbo.T FOR SYSTEM_TIME CONTAINED IN ('2024-01-01', '2025-01-01') AS t;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_systime_between_ok.sql",
        "UPDATE t SET t.x = 1 FROM dbo.T FOR SYSTEM_TIME BETWEEN @s AND @e AS t;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_systime_fromto_ok.sql",
        "UPDATE t SET t.x = 1 FROM dbo.T FOR SYSTEM_TIME FROM @s TO @e AS t;",
    );
    assert_valid(LanguageId::TSql, "t_upd_tablesample_ok.sql", "UPDATE t SET t.x = 1 FROM dbo.T t TABLESAMPLE (10 PERCENT);");
    assert_valid(
        LanguageId::TSql,
        "t_upd_tablesample_rep_ok.sql",
        "UPDATE t SET t.x = 1 FROM dbo.T TABLESAMPLE SYSTEM (1000 ROWS) REPEATABLE (42) AS t;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_del_double_from_ok.sql",
        "DELETE FROM dbo.T FROM dbo.T t JOIN dbo.S s ON t.id = s.id WHERE s.flag = 1;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_del_top_output_double_from_ok.sql",
        "DELETE TOP (10) FROM dbo.T OUTPUT DELETED.id FROM dbo.T t JOIN dbo.S s ON t.id = s.id;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_derived_join_ok.sql",
        "UPDATE dbo.T SET a = 1 FROM ((SELECT 1 AS x) a JOIN (SELECT 2 AS y) b ON a.x = b.y);",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_derived_union_join_ok.sql",
        "UPDATE dbo.T SET a = 1 FROM (((SELECT 1 AS x) UNION (SELECT 2 AS x)) a JOIN dbo.T t ON t.id = a.x);",
    );
    assert_valid(LanguageId::TSql, "t_upd_tvf0_ok.sql", "UPDATE dbo.T SET a = 1 FROM dbo.fn();");
    assert_valid(LanguageId::TSql, "t_upd_tvf2_ok.sql", "UPDATE dbo.T SET a = 1 FROM dbo.fn(1, 'x') AS f;");
    assert_valid(
        LanguageId::TSql,
        "t_upd_pivot_ok.sql",
        "UPDATE dbo.T SET a = 1 FROM dbo.S PIVOT (SUM(v) FOR [m] IN ([Jan], [Feb])) p;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_unpivot_ok.sql",
        "UPDATE dbo.T SET a = 1 FROM dbo.S UNPIVOT (v FOR m IN (c1, c2)) u;",
    );
    assert_valid(
        LanguageId::TSql,
        "t_upd_openjson_ok.sql",
        "UPDATE dbo.T SET a = 1 FROM OPENJSON(@j) WITH (id INT '$.id') AS j;",
    );

    assert_invalid(LanguageId::TSql, "t_upd_nested_empty_paren.sql", "UPDATE dbo.T SET x = 1 FROM (());");
    assert_invalid(LanguageId::TSql, "t_upd_nested_empty_paren3.sql", "UPDATE dbo.T SET x = 1 FROM ((()));");
    assert_invalid(LanguageId::TSql, "t_upd_pivot_garbage.sql", "UPDATE dbo.T SET a = 1 FROM dbo.S PIVOT (GARBAGE GARBAGE) p;");
    assert_invalid(
        LanguageId::TSql,
        "t_upd_pivot_tail_garbage.sql",
        "UPDATE dbo.T SET a = 1 FROM dbo.S PIVOT (SUM(v) FOR m IN ([Jan]) GARBAGE) p;",
    );
    assert_invalid(LanguageId::TSql, "t_upd_unpivot_for.sql", "UPDATE dbo.T SET a = 1 FROM dbo.S UNPIVOT (FOR m IN (c1)) u;");
    assert_invalid(LanguageId::TSql, "t_upd_tvf_garbage.sql", "UPDATE dbo.T SET a = 1 FROM dbo.fn(GARBAGE GARBAGE);");
    assert_invalid(LanguageId::TSql, "t_upd_tvf_trail_comma.sql", "UPDATE dbo.T SET a = 1 FROM dbo.fn(1,);");
    assert_invalid(LanguageId::TSql, "t_upd_for_bogus.sql", "UPDATE dbo.T SET x = 1 FROM dbo.T FOR BOGUS;");
    assert_invalid(
        LanguageId::TSql,
        "t_upd_systime_bad_contained.sql",
        "UPDATE dbo.T SET x = 1 FROM dbo.T FOR SYSTEM_TIME CONTAINED IN ('a');",
    );
    assert_invalid(
        LanguageId::TSql,
        "t_upd_systime_dup.sql",
        "UPDATE dbo.T SET x = 1 FROM dbo.T FOR SYSTEM_TIME ALL FOR SYSTEM_TIME ALL;",
    );
    assert_invalid(LanguageId::TSql, "t_upd_tablesample_empty.sql", "UPDATE dbo.T SET x = 1 FROM dbo.T TABLESAMPLE ();");
    assert_invalid(
        LanguageId::TSql,
        "t_upd_tablesample_garbage.sql",
        "UPDATE dbo.T SET x = 1 FROM dbo.T TABLESAMPLE (10 GARBAGE);",
    );
    assert_invalid(
        LanguageId::TSql,
        "t_upd_tablesample_rep_empty.sql",
        "UPDATE dbo.T SET x = 1 FROM dbo.T TABLESAMPLE (10 PERCENT) REPEATABLE ();",
    );
    assert_invalid(LanguageId::TSql, "t_del_from_as_from.sql", "DELETE FROM dbo.T AS t FROM dbo.T t;");
    assert_invalid(LanguageId::TSql, "t_del_where_from_first.sql", "DELETE FROM dbo.T WHERE id = 1 FROM dbo.S;");

    // Cluster 2: Nested (WITH ...) / (SELECT ...) subqueries, ALTER OR REPLACE, bare ORDER GARBAGE
    assert_invalid(LanguageId::TSql, "t_sub_with_empty.sql", "SELECT * FROM (WITH c AS () SELECT 1) x;");
    assert_invalid(
        LanguageId::TSql,
        "t_sub_with_dml.sql",
        "SELECT * FROM (WITH c AS (SELECT 1) INSERT INTO dbo.T VALUES (1)) x;",
    );
    assert_invalid(LanguageId::TSql, "t_sub_double_with_empty.sql", "SELECT * FROM ((WITH c AS () SELECT 1)) x;");
    assert_invalid(
        LanguageId::TSql,
        "t_sub_join_with_empty.sql",
        "SELECT * FROM (dbo.A JOIN (WITH c AS () SELECT 1) x ON 1=1);",
    );
    assert_invalid(
        LanguageId::TSql,
        "t_sub_order_union.sql",
        "SELECT * FROM (SELECT 1 ORDER BY 1 UNION ALL SELECT 2) x;",
    );
    assert_invalid(
        LanguageId::TSql,
        "t_sub_deep_with_empty.sql",
        "SELECT * FROM (SELECT 1 FROM (WITH c AS () SELECT 1) y) x;",
    );
    assert_invalid(LanguageId::TSql, "t_alter_or_replace_view.sql", "ALTER OR REPLACE VIEW dbo.V AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_alter_or_replace_proc.sql", "ALTER OR REPLACE PROC dbo.P AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_alter_or_replace_tbl.sql", "ALTER OR REPLACE TABLE dbo.T (id INT);");
    assert_invalid(LanguageId::TSql, "t_alter_or_eof.sql", "ALTER OR;");
    assert_invalid(LanguageId::TSql, "t_order_garbage.sql", "SELECT 1 ORDER GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_order_num.sql", "SELECT * FROM dbo.T ORDER 1;");
    assert_invalid(LanguageId::TSql, "t_order_eof.sql", "SELECT 1 ORDER;");
    assert_invalid(LanguageId::TSql, "t_cte_order_garbage.sql", "WITH c AS (SELECT 1 ORDER GARBAGE) SELECT 1;");
    assert_invalid(LanguageId::TSql, "t_sub_order_garbage.sql", "SELECT * FROM (SELECT 1 ORDER GARBAGE) x;");

    assert_valid(
        LanguageId::TSql,
        "t_sel_derived_join_ok.sql",
        "SELECT * FROM ((SELECT 1 AS x) a JOIN (SELECT 2 AS y) b ON a.x = b.y);",
    );
    assert_valid(
        LanguageId::TSql,
        "t_sel_paren_union_ok.sql",
        "SELECT * FROM ((SELECT 1 AS a) UNION ALL (SELECT 2 AS a)) x;",
    );
    assert_valid(LanguageId::TSql, "t_sel_in_sub_ok.sql", "SELECT 1 WHERE x IN ((SELECT 1), (SELECT 2));");
    assert_valid(LanguageId::TSql, "t_sel_arith_sub_ok.sql", "SELECT ((SELECT 1) + 1);");
    assert_valid(LanguageId::TSql, "t_ins_vals_sub_ok.sql", "INSERT INTO dbo.T VALUES ((SELECT 1));");
    assert_valid(LanguageId::TSql, "t_sub_top_order_ok.sql", "SELECT * FROM (SELECT TOP (1) 1 ORDER BY 1) x;");
    assert_valid(
        LanguageId::TSql,
        "t_sub_with_ok.sql",
        "SELECT * FROM (WITH c AS (SELECT 1 AS a) SELECT a FROM c) x;",
    );
    assert_valid(LanguageId::TSql, "t_sel_order_ident_ok.sql", "SELECT t.order, [order], 1 AS order FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t_sel_over_order_ok.sql", "SELECT ROW_NUMBER() OVER (ORDER BY id) FROM dbo.T;");

    // Cluster 3: INSERT EXEC trailing, CREATE TABLE (), VALUES () / trailing, SQLite TRIM + 0-shift col
    assert_valid(LanguageId::TSql, "t_ins_exec_at_ok.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT LinkedSrv;");
    assert_valid(
        LanguageId::TSql,
        "t_ins_exec_sp_ok.sql",
        "INSERT INTO dbo.T EXEC (N'SELECT @x', N'@x int', @x = 1);",
    );
    assert_invalid(LanguageId::TSql, "t_ins_exec_garbage.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') GARBAGE;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_as_alias.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AS x;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_option.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') OPTION (MAXDOP 1);");
    assert_invalid(LanguageId::TSql, "t_ins_exec_at_eof.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT;");
    assert_invalid(LanguageId::TSql, "t_ins_exec_at_num.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT 123;");
    assert_invalid(
        LanguageId::TSql,
        "t_ins_exec_at_garbage.sql",
        "INSERT INTO dbo.T EXEC ('SELECT 1') AT LinkedSrv GARBAGE;",
    );

    assert_invalid(LanguageId::TSql, "t_ctbl_empty_parens.sql", "CREATE TABLE dbo.T ();");
    assert_invalid(LanguageId::TSql, "t_ctbl_trail_comma.sql", "CREATE TABLE dbo.T (id INT, );");
    assert_invalid(LanguageId::TSql, "t_ctbl_lead_comma.sql", "CREATE TABLE dbo.T (, id INT);");

    assert_invalid(LanguageId::TSql, "t_vals_second_empty.sql", "INSERT INTO dbo.T VALUES (1), ();");
    assert_invalid(
        LanguageId::TSql,
        "t_with_vals_second_empty.sql",
        "WITH c AS (SELECT 1) INSERT INTO dbo.T VALUES (1), ();",
    );
    assert_invalid(LanguageId::TSql, "t_from_vals_second_empty.sql", "SELECT * FROM (VALUES (1), ()) AS v(a);");
    assert_invalid(LanguageId::TSql, "t_from_vals_garbage.sql", "SELECT * FROM (VALUES (1) GARBAGE) AS v(a);");
    assert_invalid(
        LanguageId::TSql,
        "t_merge_vals_empty.sql",
        "MERGE dbo.T USING dbo.S ON 1=1 WHEN NOT MATCHED THEN INSERT VALUES ();",
    );
    assert_valid(LanguageId::TSql, "t_vals_opt_ok.sql", "INSERT INTO dbo.T VALUES (1), (2) OPTION (MAXDOP 1);");
    assert_valid(LanguageId::TSql, "t_dot_values_ok.sql", "SELECT t.values FROM dbo.T AS t;");
    assert_valid(
        LanguageId::TSql,
        "t_from_vals_ok.sql",
        "SELECT * FROM (VALUES (1, 'a'), (2, 'b')) AS v(id, val);",
    );

    assert_invalid(LanguageId::Sqlite, "sq_trim_garbage.sql", "SELECT TRIM('x' GARBAGE) FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_trim_empty.sql", "SELECT TRIM() FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_trim_from_multi.sql", "SELECT TRIM('x' FROM a, b) FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_trim_from_dup.sql", "SELECT TRIM('x' FROM a FROM b) FROM t;");
    assert_invalid(LanguageId::Sqlite, "sq_trim_3arg.sql", "SELECT TRIM(x, 'y', 'z') FROM t;");
    assert_invalid(
        LanguageId::Sqlite,
        "sq_tbl_check_trim_garbage.sql",
        "CREATE TABLE t (a TEXT CHECK (TRIM('x' GARBAGE) = 'x'));",
    );
    assert_invalid(
        LanguageId::Sqlite,
        "sq_trg_trim_garbage.sql",
        "CREATE TRIGGER trg AFTER INSERT ON t BEGIN SELECT TRIM('x' GARBAGE); END;",
    );
    assert_invalid(
        LanguageId::Sqlite,
        "sq_upsert_trim_garbage.sql",
        "INSERT INTO t (a) VALUES ('x') ON CONFLICT(a) DO UPDATE SET a = TRIM('x' GARBAGE);",
    );
    assert_valid(
        LanguageId::Sqlite,
        "sq_trim_forms_ok.sql",
        "SELECT TRIM(x), TRIM(x, 'y'), TRIM(FROM x), TRIM(BOTH ' ' FROM x) FROM t;",
    );
    assert_valid(LanguageId::Sqlite, "sq_no_fusion_ok.sql", "SELECT`a\"b`FROM[c\"d]WHERE[a\"b]=1;");

    // Verify 0-shift column reporting for SQLite TRIM diagnostics
    let fw = DefaultSyntaxFirewall;
    let trim_sql = "SELECT 'a', TRIM('x' GARBAGE) FROM t;";
    let FirewallVerdict::Invalid { diagnostics: sq_diags } =
        fw.verify(trim_sql, Path::new("sq_trim_col.sql"), LanguageId::Sqlite)
    else {
        panic!("expected invalid sqlite trim");
    };
    let FirewallVerdict::Invalid { diagnostics: ansi_diags } =
        fw.verify(trim_sql, Path::new("ansi_trim_col.sql"), LanguageId::AnsiSql)
    else {
        panic!("expected invalid ansi trim");
    };
    assert_eq!(sq_diags[0].line, 1);
    assert_eq!(sq_diags[0].column, ansi_diags[0].column);
    assert!(sq_diags[0].column > 10, "expected 0-shift TRIM column > 10, got {}", sq_diags[0].column);
}

#[test]
fn regression_w2_m3_iter14_verifier_fixes() {
    // Cluster 1A: Nested (SELECT ...) in joins/IN/expressions & multi-wrapped set-ops
    assert_invalid(LanguageId::TSql, "t14_join_sub_bad.sql", "SELECT * FROM (dbo.A JOIN (SELECT 1 ORDER GARBAGE) x ON 1=1);");
    assert_invalid(LanguageId::TSql, "t14_join_sub2_bad.sql", "SELECT * FROM ((SELECT 1 ORDER GARBAGE) a JOIN (SELECT 2 AS y) b ON a.x = b.y);");
    assert_invalid(LanguageId::TSql, "t14_in_sub_bad.sql", "SELECT 1 WHERE x IN ((SELECT 1 ORDER GARBAGE), (SELECT 2));");
    assert_invalid(LanguageId::TSql, "t14_arith_sub_bad.sql", "SELECT ((SELECT 1 ORDER GARBAGE) + 1);");
    assert_invalid(LanguageId::TSql, "t14_join_setop_bad.sql", "SELECT * FROM (dbo.A JOIN (SELECT 1 ORDER BY 1 UNION ALL SELECT 2) x ON 1=1);");
    assert_invalid(LanguageId::TSql, "t14_wrap_setop_bad.sql", "SELECT * FROM (((SELECT 1) ORDER BY 1 UNION ALL (SELECT 2))) x;");
    assert_invalid(LanguageId::TSql, "t14_join_wrap_setop_bad.sql", "SELECT * FROM (dbo.A JOIN ((SELECT 1) ORDER BY 1 UNION ALL (SELECT 2)) x ON 1=1);");

    assert_valid(LanguageId::TSql, "t14_join_sub_ok.sql", "SELECT * FROM ((SELECT 1 AS x) a JOIN (SELECT 2 AS y) b ON a.x = b.y);");
    assert_valid(LanguageId::TSql, "t14_in_sub_ok.sql", "SELECT 1 WHERE x IN ((SELECT 1), (SELECT 2));");
    assert_valid(LanguageId::TSql, "t14_arith_sub_ok.sql", "SELECT ((SELECT 1) + 1);");
    assert_valid(LanguageId::TSql, "t14_wrap_top_setop_ok.sql", "SELECT * FROM (((SELECT TOP (1) 1 ORDER BY 1) UNION ALL (SELECT 2))) x;");
    assert_valid(LanguageId::TSql, "t14_getdate_ok.sql", "SELECT GETDATE();");

    // Cluster 1B: Scalar (WITH ...) / (SELECT ...) in DML, SET, RETURN, IF/WHILE, DECLARE & MERGE USING
    assert_invalid(LanguageId::TSql, "t14_upd_with_bad.sql", "UPDATE dbo.T SET a = (WITH c AS () SELECT 1);");
    assert_invalid(LanguageId::TSql, "t14_del_with_bad.sql", "DELETE FROM dbo.T WHERE id = (WITH c AS () SELECT 1);");
    assert_invalid(LanguageId::TSql, "t14_upd_ord_bad.sql", "UPDATE dbo.T SET a = (SELECT 1 ORDER BY 1 GARBAGE);");
    assert_invalid(LanguageId::TSql, "t14_del_ord_bad.sql", "DELETE FROM dbo.T WHERE id = (SELECT 1 ORDER BY 1 GARBAGE);");
    assert_invalid(LanguageId::TSql, "t14_ins_vals_sub_bad.sql", "INSERT INTO dbo.T VALUES ((SELECT 1 ORDER GARBAGE));");
    assert_invalid(LanguageId::TSql, "t14_merge_using_with_bad.sql", "MERGE INTO dbo.T USING (WITH c AS () SELECT 1) s ON 1=1 WHEN MATCHED THEN DELETE;");
    assert_invalid(LanguageId::TSql, "t14_merge_using_ord_bad.sql", "MERGE INTO dbo.T USING (SELECT 1 ORDER BY 1 GARBAGE) s ON 1=1 WHEN MATCHED THEN DELETE;");
    assert_invalid(LanguageId::TSql, "t14_with_upd_with_bad.sql", "WITH c AS (SELECT 1) UPDATE dbo.T SET a = (WITH d AS () SELECT 1);");
    assert_invalid(LanguageId::TSql, "t14_set_sub_bad.sql", "SET @x = (SELECT 1 ORDER GARBAGE);");
    assert_invalid(LanguageId::TSql, "t14_ret_sub_bad.sql", "RETURN (SELECT 1 ORDER GARBAGE);");
    assert_invalid(LanguageId::TSql, "t14_if_sub_bad.sql", "IF (SELECT 1 ORDER GARBAGE) = 1 SELECT 1;");
    assert_invalid(LanguageId::TSql, "t14_decl_sub_bad.sql", "DECLARE @x INT = (SELECT 1 ORDER GARBAGE);");

    assert_valid(LanguageId::TSql, "t14_upd_with_ok.sql", "UPDATE dbo.T SET a = (WITH c AS (SELECT 1 AS x) SELECT x FROM c);");
    assert_valid(LanguageId::TSql, "t14_del_top_ok.sql", "DELETE FROM dbo.T WHERE id = (SELECT TOP (1) id FROM dbo.U ORDER BY id);");
    assert_valid(LanguageId::TSql, "t14_ins_vals_sub_ok.sql", "INSERT INTO dbo.T VALUES ((SELECT 1));");
    assert_valid(LanguageId::TSql, "t14_merge_using_with_ok.sql", "MERGE INTO dbo.T USING (WITH c AS (SELECT 1 AS id) SELECT id FROM c) s ON t.id = s.id WHEN MATCHED THEN DELETE;");
    assert_valid(LanguageId::TSql, "t14_set_sub_ok.sql", "SET @x = (SELECT 1);");
    assert_valid(LanguageId::TSql, "t14_if_sub_ok.sql", "IF (SELECT 1) = 1 SELECT 1;");

    // Cluster 2: SELECT ... FROM parity (PIVOT, TVF, FOR SYSTEM_TIME, ((())), empty FROM, subqueries)
    assert_invalid(LanguageId::TSql, "t14_sel_pivot_bad.sql", "SELECT * FROM dbo.S PIVOT (GARBAGE GARBAGE) p;");
    assert_invalid(LanguageId::TSql, "t14_sel_tvf_bad.sql", "SELECT * FROM dbo.fn(GARBAGE GARBAGE);");
    assert_invalid(LanguageId::TSql, "t14_sel_systime_bad.sql", "SELECT * FROM dbo.S FOR SYSTEM_TIME GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_sel_empty_parens_bad.sql", "SELECT * FROM ((()));");
    assert_invalid(LanguageId::TSql, "t14_sel_empty_from_bad.sql", "SELECT * FROM;");
    assert_invalid(LanguageId::TSql, "t14_sel_from_where_bad.sql", "SELECT * FROM WHERE 1=1;");
    assert_invalid(LanguageId::TSql, "t14_view_pivot_bad.sql", "CREATE VIEW dbo.V AS SELECT * FROM dbo.S PIVOT (GARBAGE) p;");
    assert_invalid(LanguageId::TSql, "t14_cte_tvf_bad.sql", "WITH c AS (SELECT * FROM dbo.fn(1,)) SELECT * FROM c;");
    assert_invalid(LanguageId::TSql, "t14_ins_sel_systime_bad.sql", "INSERT INTO dbo.T SELECT * FROM dbo.S FOR SYSTEM_TIME GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_join_sub_pivot_bad.sql", "SELECT * FROM (dbo.A JOIN (SELECT 1 FROM dbo.S PIVOT (GARBAGE) p) x ON 1=1);");
    assert_invalid(LanguageId::TSql, "t14_where_in_ord_bad.sql", "SELECT * FROM dbo.A WHERE x IN ((SELECT 1), (SELECT 2 ORDER BY 1 GARBAGE));");
    assert_invalid(LanguageId::TSql, "t14_tvf_sub_bad.sql", "SELECT * FROM dbo.fn(((SELECT 1 ORDER GARBAGE) + 1));");
    assert_invalid(LanguageId::TSql, "t14_systime_sub_bad.sql", "SELECT * FROM dbo.S FOR SYSTEM_TIME AS OF (SELECT 1 ORDER GARBAGE);");

    assert_valid(LanguageId::TSql, "t14_sel_pivot_ok.sql", "SELECT * FROM dbo.S PIVOT (SUM(v) FOR [m] IN ([Jan], [Feb])) p;");
    assert_valid(LanguageId::TSql, "t14_sel_unpivot_ok.sql", "SELECT * FROM dbo.S UNPIVOT (v FOR m IN (c1, c2)) u;");
    assert_valid(LanguageId::TSql, "t14_sel_tvf_ok.sql", "SELECT * FROM dbo.fn(1, 'x') AS f;");
    assert_valid(LanguageId::TSql, "t14_sel_systime_json_ok.sql", "SELECT * FROM dbo.T FOR SYSTEM_TIME CONTAINED IN ('2024-01-01', '2025-01-01') AS t FOR JSON PATH;");
    assert_valid(LanguageId::TSql, "t14_sel_tablesample_ok.sql", "SELECT * FROM dbo.T TABLESAMPLE SYSTEM (1000 ROWS) REPEATABLE (42) AS t;");
    assert_valid(LanguageId::TSql, "t14_sel_distinct_from_ok.sql", "SELECT CASE WHEN x IS NOT DISTINCT FROM y THEN 1 ELSE 0 END FROM dbo.T WHERE a IS NOT DISTINCT FROM b;");
    assert_valid(LanguageId::TSql, "t14_sel_nested_arith_ok.sql", "SELECT (((SELECT 1) + (SELECT 2)) + 1);");
    assert_valid(LanguageId::TSql, "t14_sel_window_ok.sql", "SELECT SUM(x) OVER w FROM dbo.T WINDOW w AS (PARTITION BY y);");
    assert_valid(LanguageId::TSql, "t14_on_in_arith_ok.sql", "SELECT * FROM dbo.A JOIN dbo.B ON a.x IN (((SELECT 1) + 1));");
    assert_valid(LanguageId::TSql, "t14_systime_xml_ok.sql", "SELECT * FROM dbo.T FOR SYSTEM_TIME AS OF '2025-01-01' FOR XML AUTO;");

    // Cluster 3: CREATE TABLE (...) tails & INSERT ... EXEC proc tails / AT ident
    assert_invalid(LanguageId::TSql, "t14_ctbl_garbage.sql", "CREATE TABLE dbo.T (a INT) GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_on_eof.sql", "CREATE TABLE dbo.T (a INT) ON;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_on_num.sql", "CREATE TABLE dbo.T (a INT) ON 123;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_on_garbage.sql", "CREATE TABLE dbo.T (a INT) ON [PRIMARY] GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_on_dup.sql", "CREATE TABLE dbo.T (a INT) ON [PRIMARY] ON [SECONDARY];");
    assert_invalid(LanguageId::TSql, "t14_ctbl_ps_empty.sql", "CREATE TABLE dbo.T (a INT) ON [ps]();");
    assert_invalid(LanguageId::TSql, "t14_ctbl_ps_multi.sql", "CREATE TABLE dbo.T (a INT) ON [ps](a, b);");
    assert_invalid(LanguageId::TSql, "t14_ctbl_on_with.sql", "CREATE TABLE dbo.T (a INT) ON WITH (DATA_COMPRESSION = PAGE);");
    assert_invalid(LanguageId::TSql, "t14_ctbl_ti_eof.sql", "CREATE TABLE dbo.T (a INT) TEXTIMAGE_ON;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_fs_eof.sql", "CREATE TABLE dbo.T (a INT) FILESTREAM_ON;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_with_empty.sql", "CREATE TABLE dbo.T (a INT) WITH ();");
    assert_invalid(LanguageId::TSql, "t14_ctbl_with_eq_eof.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = );");
    assert_invalid(LanguageId::TSql, "t14_ctbl_with_comma.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = PAGE, );");
    assert_invalid(LanguageId::TSql, "t14_ctbl_with_nest_empty.sql", "CREATE TABLE dbo.T (a INT) WITH (SYSTEM_VERSIONING = ON ());");
    assert_invalid(LanguageId::TSql, "t14_ctbl_as_garbage.sql", "CREATE TABLE dbo.T (a INT) AS GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_cols_as_sel.sql", "CREATE TABLE dbo.T (a INT) AS SELECT 1;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_cols_as_ft.sql", "CREATE TABLE dbo.T (a INT) AS FILETABLE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_nocol_as_garbage.sql", "CREATE TABLE dbo.T AS GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_ft_garbage.sql", "CREATE TABLE dbo.T AS FILETABLE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_ctbl_ft_with_empty.sql", "CREATE TABLE dbo.T AS FILETABLE WITH ();");
    assert_invalid(LanguageId::TSql, "t14_ctbl_pre_garbage.sql", "CREATE TABLE dbo.T GARBAGE (a INT);");
    assert_invalid(LanguageId::TSql, "t14_ctbl_var_name.sql", "CREATE TABLE @t (a INT);");
    assert_invalid(LanguageId::TSql, "t14_exec_proc_garbage.sql", "INSERT INTO dbo.T EXEC dbo.MyProc GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_exec_param_garbage.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @a = 1 GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_exec_rc_garbage.sql", "INSERT INTO dbo.T EXEC @rc = dbo.MyProc GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_exec_eq_eof.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @a = ;");
    assert_invalid(LanguageId::TSql, "t14_exec_trail_comma.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @a = 1, ;");
    assert_invalid(LanguageId::TSql, "t14_exec_lit_out.sql", "INSERT INTO dbo.T EXEC dbo.MyProc 1 OUTPUT;");
    assert_invalid(LanguageId::TSql, "t14_exec_with_garbage.sql", "INSERT INTO dbo.T EXEC dbo.MyProc WITH GARBAGE;");
    assert_invalid(LanguageId::TSql, "t14_exec_proc_at.sql", "INSERT INTO dbo.T EXEC dbo.MyProc AT LinkedSrv;");
    assert_invalid(LanguageId::TSql, "t14_exec_at_dot.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT dbo.Srv;");
    assert_invalid(LanguageId::TSql, "t14_exec_at_tmp.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT #tmp;");
    assert_invalid(LanguageId::TSql, "t14_exec_at_var.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT @srv;");

    assert_valid(LanguageId::TSql, "t14_ctbl_tmp_on_ok.sql", "CREATE TABLE #t (a INT) ON [PRIMARY];");
    assert_valid(LanguageId::TSql, "t14_ctbl_ti_ok.sql", "CREATE TABLE dbo.T (a INT) ON [PRIMARY] TEXTIMAGE_ON [PRIMARY];");
    assert_valid(LanguageId::TSql, "t14_ctbl_fs_ok.sql", "CREATE TABLE dbo.T (a INT, b VARBINARY(MAX) FILESTREAM, c UNIQUEIDENTIFIER ROWGUIDCOL) ON [PRIMARY] FILESTREAM_ON [FS];");
    assert_valid(LanguageId::TSql, "t14_ctbl_part_comp_ok.sql", "CREATE TABLE dbo.T (a INT, dt DATETIME2) ON [ps_date](dt) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (1, 3 TO 5));");
    assert_valid(LanguageId::TSql, "t14_ctbl_sysver_ok.sql", "CREATE TABLE dbo.T (id INT PRIMARY KEY, s DATETIME2 GENERATED ALWAYS AS ROW START, e DATETIME2 GENERATED ALWAYS AS ROW END, PERIOD FOR SYSTEM_TIME (s, e)) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.T_History, DATA_CONSISTENCY_CHECK = ON));");
    assert_valid(LanguageId::TSql, "t14_ctbl_node_ok.sql", "CREATE TABLE dbo.T (id INT) AS NODE;");
    assert_valid(LanguageId::TSql, "t14_ctbl_edge_ok.sql", "CREATE TABLE dbo.E (id INT) AS EDGE ON [PRIMARY];");
    assert_valid(LanguageId::TSql, "t14_ctbl_ft_ok.sql", "CREATE TABLE dbo.FT AS FILETABLE ON [PRIMARY] FILESTREAM_ON [FS] WITH (FILETABLE_DIRECTORY = N'dir');");
    assert_valid(LanguageId::TSql, "t14_exec_bare_ok.sql", "INSERT INTO dbo.T EXEC dbo.MyProc;");
    assert_valid(LanguageId::TSql, "t14_exec_params_ok.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @a = 1, @b = @out OUTPUT;");
    assert_valid(LanguageId::TSql, "t14_exec_default_ok.sql", "INSERT INTO dbo.T EXEC dbo.MyProc @a = DEFAULT;");
    assert_valid(LanguageId::TSql, "t14_exec_mixed_ok.sql", "INSERT INTO dbo.T EXEC dbo.MyProc 1, N'x', -5, NULL, @v OUT WITH RECOMPILE;");
    assert_valid(LanguageId::TSql, "t14_exec_at_bracket_ok.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT [LinkedSrv];");
}

#[test]
fn regression_w2_m3_iter15_verifier_fixes() {
    // Cluster 1: IS [NOT] DISTINCT FROM, stray FROM after WHERE/GROUP/HAVING/WINDOW, ORDER/OFFSET/FETCH subqueries, FROM (VALUES ((SELECT ...)))
    assert_valid(LanguageId::TSql, "t15_sel_not_distinct_ok.sql", "SELECT a IS NOT DISTINCT FROM b FROM dbo.S;");
    assert_valid(LanguageId::TSql, "t15_sel_distinct_ok.sql", "SELECT a IS DISTINCT FROM b FROM dbo.S;");
    assert_valid(LanguageId::TSql, "t15_sel_not_distinct_lit_ok.sql", "SELECT a IS NOT DISTINCT FROM 1;");
    assert_valid(LanguageId::TSql, "t15_sel_not_distinct_sub_ok.sql", "SELECT * FROM (SELECT a IS NOT DISTINCT FROM b AS eq FROM dbo.S) x;");
    assert_valid(LanguageId::TSql, "t15_where_not_distinct_ok.sql", "SELECT a FROM dbo.S WHERE x IS NOT DISTINCT FROM y;");
    assert_valid(LanguageId::TSql, "t15_dot_is_alias_ok.sql", "SELECT s.is DISTINCT FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t15_within_group_ok.sql", "SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY x) * 100 AS p FROM dbo.T;");
    assert_valid(LanguageId::TSql, "t15_order_sub_ok.sql", "SELECT 1 ORDER BY (SELECT 1);");
    assert_valid(LanguageId::TSql, "t15_from_vals_sub_ok.sql", "SELECT * FROM (VALUES ((SELECT 1)), ((SELECT 2))) v(x);");

    assert_invalid(LanguageId::TSql, "t15_sel_distinct_from_bad.sql", "SELECT DISTINCT FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t15_sel_ndf_missing_rhs_bad.sql", "SELECT a IS NOT DISTINCT FROM FROM dbo.S;");
    assert_invalid(LanguageId::TSql, "t15_sel_ndf_plus_bad.sql", "SELECT a IS NOT DISTINCT FROM + FROM dbo.S;");
    assert_invalid(LanguageId::TSql, "t15_where_then_from_bad.sql", "SELECT 1 WHERE 1=1 FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t15_where_then_from_g_bad.sql", "SELECT 1 WHERE 1=1 FROM GARBAGE GARBAGE;");
    assert_invalid(LanguageId::TSql, "t15_group_then_from_bad.sql", "SELECT 1 GROUP BY a FROM ((()));");
    assert_invalid(LanguageId::TSql, "t15_having_then_from_bad.sql", "SELECT 1 HAVING 1=1 FROM ((()));");
    assert_invalid(LanguageId::TSql, "t15_window_then_from_bad.sql", "SELECT a FROM dbo.T WINDOW w AS (ORDER BY a) FROM ((()));");
    assert_invalid(LanguageId::TSql, "t15_where_ndf_then_from_bad.sql", "SELECT a FROM dbo.S WHERE x IS NOT DISTINCT FROM y FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t15_after_paren_order_sub_bad.sql", "SELECT * FROM ((SELECT 1) ORDER BY (SELECT 1 ORDER GARBAGE)) x;");
    assert_invalid(LanguageId::TSql, "t15_top_paren_order_sub_bad.sql", "(SELECT 1) ORDER BY (SELECT 1 ORDER GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_order_sub_bad.sql", "SELECT 1 ORDER BY (SELECT 1 ORDER GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_order_sub_empty_from_bad.sql", "SELECT 1 ORDER BY (SELECT 1 FROM ((())));");
    assert_invalid(LanguageId::TSql, "t15_offset_sub_bad.sql", "SELECT 1 ORDER BY 1 OFFSET (SELECT 1 ORDER GARBAGE) ROWS;");
    assert_invalid(LanguageId::TSql, "t15_fetch_with_bad.sql", "SELECT 1 ORDER BY 1 OFFSET 0 ROWS FETCH NEXT (WITH c AS () SELECT 1) ROWS ONLY;");
    assert_invalid(LanguageId::TSql, "t15_from_vals_sub_bad.sql", "SELECT * FROM (VALUES ((SELECT 1 ORDER GARBAGE))) v(x);");

    // Cluster 2: exact diagnostics & Pratt/subquery edge checks
    let fw = DefaultSyntaxFirewall;
    let FirewallVerdict::Invalid { diagnostics: d1 } = fw.verify("SELECT (SELECT 1) (SELECT 2);", Path::new("t15_c2_col.sql"), LanguageId::TSql) else { panic!("expected invalid"); };
    assert_eq!((d1[0].line, d1[0].column), (1, 19));
    let FirewallVerdict::Invalid { diagnostics: d2 } = fw.verify("SELECT (SELECT 1;", Path::new("t15_c2_unclosed.sql"), LanguageId::TSql) else { panic!("expected invalid"); };
    assert_eq!((d2[0].line, d2[0].column), (1, 8));
    assert_valid(LanguageId::TSql, "t15_over_ok.sql", "SELECT SUM(x) OVER (PARTITION BY y) + 1 FROM dbo.T;");
    assert_invalid(LanguageId::TSql, "t15_exists_empty_bad.sql", "SELECT 1 WHERE EXISTS ();");

    // Cluster 3: strict CREATE TABLE ... WITH (...) & INSERT ... EXEC ... AT <ident>
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_two_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (GARBAGE GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_tail_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = PAGE GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_bad_comp.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_on_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = PAGE ON GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_part_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (DATA_COMPRESSION = PAGE ON PARTITIONS (GARBAGE));");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_sysver_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (SYSTEM_VERSIONING = ON (GARBAGE));");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_hist_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.TH GARBAGE));");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_num.sql", "CREATE TABLE dbo.T (a INT) WITH (123);");
    assert_invalid(LanguageId::TSql, "t15_ctbl_with_heap_garbage.sql", "CREATE TABLE dbo.T (a INT) WITH (HEAP GARBAGE);");
    assert_invalid(LanguageId::TSql, "t15_exec_at_null.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT NULL;");
    assert_invalid(LanguageId::TSql, "t15_exec_at_default.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT DEFAULT;");

    assert_valid(LanguageId::TSql, "t15_ctbl_with_xml_comp_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (XML_COMPRESSION = ON ON PARTITIONS (1 TO 2));");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_sysver_ret_ok.sql", "CREATE TABLE dbo.T (id INT PRIMARY KEY, s DATETIME2 GENERATED ALWAYS AS ROW START, e DATETIME2 GENERATED ALWAYS AS ROW END, PERIOD FOR SYSTEM_TIME (s, e)) WITH (SYSTEM_VERSIONING = ON (HISTORY_TABLE = dbo.T_History, DATA_CONSISTENCY_CHECK = ON, HISTORY_RETENTION_PERIOD = 6 MONTHS));");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_mem_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (SYSTEM_VERSIONING = OFF, MEMORY_OPTIMIZED = ON, DURABILITY = SCHEMA_ONLY);");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_ft_ok.sql", "CREATE TABLE dbo.FT AS FILETABLE WITH (FILETABLE_DIRECTORY = N'dir', FILETABLE_COLLATE_FILENAME = database_default, FILETABLE_PRIMARY_KEY_CONSTRAINT_NAME = PK_FT);");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_ledger_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (LEDGER = ON (LEDGER_VIEW = dbo.V (TRANSACTION_ID_COLUMN_NAME = tid), APPEND_ONLY = ON));");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_rda_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (REMOTE_DATA_ARCHIVE = ON (FILTER_PREDICATE = dbo.fn(a), MIGRATION_STATE = OUTBOUND));");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_del_ok.sql", "CREATE TABLE dbo.T (a INT, ts DATETIME2) WITH (DATA_DELETION = ON (FILTER_COLUMN = ts, RETENTION_PERIOD = 30 DAYS));");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_synapse_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (DISTRIBUTION = HASH(a), CLUSTERED COLUMNSTORE INDEX);");
    assert_valid(LanguageId::TSql, "t15_ctbl_with_rr_heap_ok.sql", "CREATE TABLE dbo.T (a INT) WITH (DISTRIBUTION = ROUND_ROBIN, HEAP);");
    assert_valid(LanguageId::TSql, "t15_exec_at_ident_ok.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT LinkedSrv;");
    assert_valid(LanguageId::TSql, "t15_exec_at_bracket_null_ok.sql", "INSERT INTO dbo.T EXEC ('SELECT 1') AT [NULL];");
}
