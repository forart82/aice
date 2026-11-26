use std::path::Path;

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

fn assert_valid(lang: LanguageId, path: &str, src: &str) {
    let fw = DefaultSyntaxFirewall;
    let v = fw.verify(src, Path::new(path), lang);
    assert!(v.is_valid(), "Expected VALID {lang:?} ({path}):\n{src}\nGot: {v:?}");
}

fn assert_invalid_exact(lang: LanguageId, path: &str, src: &str, expected_line: Option<usize>) {
    let fw = DefaultSyntaxFirewall;
    let v = fw.verify(src, Path::new(path), lang);
    match v {
        FirewallVerdict::Invalid { diagnostics } => {
            assert!(!diagnostics.is_empty(), "empty diagnostics for {lang:?} ({path})");
            let d = &diagnostics[0];
            assert!(
                !(d.line == 1 && d.column == 1),
                "Expected non-1:1 diagnostic span for {lang:?} ({path}), got {d:?}\nsrc:\n{src}"
            );
            if let Some(line) = expected_line {
                assert_eq!(d.line, line, "Expected line {line} for {lang:?} ({path}), got {d:?}\nsrc:\n{src}");
            }
        }
        FirewallVerdict::Valid => panic!("Expected INVALID {lang:?} ({path}) to be REJECTED:\n{src}"),
    }
}

#[test]
fn wave8_v8_fw_01_tsql_create_table_and_migration_all_14_repros_rejected() {
    let tsql_repros: &[(&str, &str)] = &[
        ("collate_semi", "CREATE TABLE broken (id INT COLLATE ; );\nGO\n"),
        ("collate_eof", "CREATE TABLE broken (id INT COLLATE);\nGO\n"),
        ("constraint_semi", "CREATE TABLE broken (id INT CONSTRAINT ; );\nGO\n"),
        ("constraint_eof", "CREATE TABLE broken (id INT CONSTRAINT);\nGO\n"),
        ("references_semi", "CREATE TABLE broken (id INT REFERENCES ; );\nGO\n"),
        ("references_eof", "CREATE TABLE broken (id INT REFERENCES);\nGO\n"),
        ("references_trailing_dot", "CREATE TABLE broken (id INT REFERENCES dbo.);\nGO\n"),
        ("type_trailing_dot", "CREATE TABLE broken (id dbo.);\nGO\n"),
        ("varchar_semis", "CREATE TABLE broken (id VARCHAR(;;;));\nGO\n"),
        ("int_semis", "CREATE TABLE broken (id INT (;;;));\nGO\n"),
        ("identity_semis", "CREATE TABLE broken (id INT IDENTITY(;;;));\nGO\n"),
        ("generated_semi", "CREATE TABLE broken (id INT GENERATED ; );\nGO\n"),
        ("on_delete_missing_action", "CREATE TABLE broken (id INT REFERENCES t(id) ON DELETE );\nGO\n"),
    ];
    for (name, src) in tsql_repros {
        assert_invalid_exact(LanguageId::TSql, &format!("{name}.sql"), src, Some(1));
    }

    // Repro #14: DbMigration T-SQL block must reject on line 2 (not 1:1)
    let mig_repro = "-- migrate:up\nCREATE TABLE [dbo].[t] (id INT COLLATE ; );\nGO\n-- migrate:down\nDROP TABLE [dbo].[t];\nGO\n";
    assert_invalid_exact(LanguageId::DbMigration, "V001__broken.sql", mig_repro, Some(2));

    // Additional edge cases
    assert_invalid_exact(LanguageId::TSql, "id_empty.sql", "CREATE TABLE t (id INT IDENTITY());\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "on_upd_eof.sql", "CREATE TABLE t (id INT REFERENCES p(id) ON UPDATE );\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "gen_bad.sql", "CREATE TABLE t (id DATETIME2 GENERATED ALWAYS AS ROW );\nGO\n", Some(1));
}

#[test]
fn wave8_v8_fw_02_tsql_alter_table_and_create_index_all_5_repros_rejected() {
    let repros: &[(&str, &str)] = &[
        ("alter_empty", "ALTER TABLE dbo.t ;\nGO\n"),
        ("alter_add_empty", "ALTER TABLE dbo.t ADD ;\nGO\n"),
        ("alter_drop_empty", "ALTER TABLE dbo.t DROP ;\nGO\n"),
        ("index_empty_cols", "CREATE INDEX ix_t ON dbo.t ();\nGO\n"),
        ("index_missing_on", "CREATE INDEX ix_t (id);\nGO\n"),
    ];
    for (name, src) in repros {
        assert_invalid_exact(LanguageId::TSql, &format!("{name}.sql"), src, Some(1));
    }

    // Extra ALTER TABLE / CREATE INDEX negative cases
    assert_invalid_exact(LanguageId::TSql, "alter_drop_col_empty.sql", "ALTER TABLE dbo.t DROP COLUMN ;\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "alter_add_bad_col.sql", "ALTER TABLE dbo.t ADD id INT COLLATE ;\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "index_bad_col.sql", "CREATE UNIQUE NONCLUSTERED INDEX ix ON dbo.t (123);\nGO\n", Some(1));
}

#[test]
fn wave8_v8_fw_03_tsql_routine_headers_all_3_repros_rejected() {
    let repros: &[(&str, &str)] = &[
        ("proc_no_as", "CREATE PROCEDURE dbo.p @id INT ;\nGO\n"),
        ("func_no_returns", "CREATE FUNCTION dbo.f(@id INT) AS BEGIN RETURN 1; END;\nGO\n"),
        ("trig_no_on", "CREATE TRIGGER dbo.tr AS BEGIN SELECT 1; END;\nGO\n"),
    ];
    for (name, src) in repros {
        assert_invalid_exact(LanguageId::TSql, &format!("{name}.sql"), src, Some(1));
    }

    // Extra header cases: CREATE OR ALTER, missing AS on function/trigger, EXECUTE AS not mistaken for body AS
    assert_invalid_exact(LanguageId::TSql, "coa_proc.sql", "CREATE OR ALTER PROC dbo.p WITH EXECUTE AS CALLER ;\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "func_no_as.sql", "CREATE OR ALTER FUNCTION dbo.f(@id INT) RETURNS INT ;\nGO\n", Some(1));
    assert_invalid_exact(LanguageId::TSql, "trig_no_as.sql", "CREATE OR ALTER TRIGGER dbo.tr ON dbo.t AFTER INSERT ;\nGO\n", Some(1));
}

#[test]
fn wave8_v8_fw_04_twig_dangling_pipe_rejected_and_valid_filters_preserved() {
    // Confirmed repro
    assert_invalid_exact(LanguageId::Twig, "pipe.twig", "<p>{{ x | }}</p>\n", Some(1));

    // Variants
    assert_invalid_exact(LanguageId::Twig, "pipe2.twig", "<p>{{ x | upper | }}</p>\n", Some(1));
    assert_invalid_exact(LanguageId::Twig, "pipe_lead.twig", "<p>{{ | upper }}</p>\n", Some(1));
    assert_invalid_exact(LanguageId::Twig, "pipe_double.twig", "<p>{{ x | | upper }}</p>\n", Some(1));
    assert_invalid_exact(LanguageId::Twig, "pipe_interp.twig", "<p>{{ \"hi #{x | }\" }}</p>\n", Some(1));
    assert_invalid_exact(LanguageId::Twig, "pipe_tag.twig", "{% if x | %}ok{% endif %}\n", Some(1));

    // Valid Twig filters, strings with '|', ternaries, interpolations
    for (name, src) in [
        ("simple_filter", "<p>{{ x | upper }}</p>\n"),
        ("chained", "<p>{{ x | upper | trim | escape('html') }}</p>\n"),
        ("string_pipe", "<p>{{ items | join(' | ') }}</p>\n"),
        ("dquote_pipe", "<p>{{ x | default(\"a | \") }}</p>\n"),
        ("ternary_pipe", "<p>{{ ok ? a | upper : b | lower }}</p>\n"),
        ("interp_pipe", "<p>{{ \"hi #{user.name | upper}\" }}</p>\n"),
        ("apply_filter", "{% apply upper | trim %}<p>hello</p>{% endapply %}\n"),
    ] {
        assert_valid(LanguageId::Twig, &format!("{name}.twig"), src);
    }
}

#[test]
fn wave8_v8_fw_05_cypher_repeated_empty_semis_rejected_and_valid_preserved() {
    // Confirmed repro
    assert_invalid_exact(
        LanguageId::Cypher,
        "dup_semi.cypher",
        "CREATE CONSTRAINT c FOR (u:User) REQUIRE u.id IS UNIQUE; ;;\n",
        Some(1),
    );
    assert_invalid_exact(LanguageId::Cypher, "dml_dup.cypher", "MATCH (n:User) RETURN n;;\n", Some(1));

    // Valid Cypher: single trailing ';', multi-statement, ';' inside string
    assert_valid(
        LanguageId::Cypher,
        "ok_ddl.cypher",
        "CREATE CONSTRAINT c FOR (u:User) REQUIRE u.id IS UNIQUE;\n",
    );
    assert_valid(
        LanguageId::Cypher,
        "ok_multi.cypher",
        "CREATE CONSTRAINT c FOR (u:User) REQUIRE u.id IS UNIQUE;\nMATCH (u:User {bio: 'a; ;; b'}) RETURN u;\n",
    );
}

#[test]
fn wave8_valid_tsql_ddl_and_routines_non_regression() {
    let valid_cases: &[(&str, LanguageId, &str)] = &[
        (
            "tsql_ctbl_rich.sql",
            LanguageId::TSql,
            "CREATE TABLE [dbo].[Orders] (\n\
              id INT IDENTITY(1, 1) NOT NULL CONSTRAINT PK_Orders PRIMARY KEY CLUSTERED,\n\
              code NVARCHAR(64) COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL,\n\
              amount DECIMAL(18, 2) NOT NULL DEFAULT (0),\n\
              payload NVARCHAR(MAX) MASKED WITH (FUNCTION = 'default()') NULL,\n\
              user_id INT REFERENCES [dbo].[Users](id) ON DELETE CASCADE ON UPDATE NO ACTION,\n\
              parent_id INT REFERENCES dbo.Orders(id) ON DELETE SET NULL,\n\
              tag dbo.CustomCode NULL,\n\
              doc XML(CONTENT dbo.OrderSchemas) NULL,\n\
              valid_from DATETIME2 GENERATED ALWAYS AS ROW START HIDDEN NOT NULL,\n\
              valid_to DATETIME2 GENERATED ALWAYS AS ROW END HIDDEN NOT NULL,\n\
              PERIOD FOR SYSTEM_TIME (valid_from, valid_to)\n\
            ) ON [PRIMARY];\nGO\n",
        ),
        (
            "tsql_alter_valid.sql",
            LanguageId::TSql,
            "ALTER TABLE dbo.Orders ADD notes NVARCHAR(200) NULL DEFAULT '' WITH VALUES;\nGO\n\
            ALTER TABLE dbo.Orders ADD CONSTRAINT FK_Orders_Users FOREIGN KEY (user_id) REFERENCES dbo.Users(id) ON DELETE NO ACTION;\nGO\n\
            ALTER TABLE dbo.Orders DROP COLUMN IF EXISTS legacy_col;\nGO\n\
            ALTER TABLE dbo.Orders DROP CONSTRAINT IF EXISTS FK_Old;\nGO\n\
            ALTER TABLE dbo.Orders ALTER COLUMN notes NVARCHAR(500) NOT NULL;\nGO\n\
            ALTER TABLE dbo.Orders WITH CHECK ADD CONSTRAINT CK_Amt CHECK (amount >= 0);\nGO\n\
            ALTER TABLE dbo.Orders CHECK CONSTRAINT ALL;\nGO\n\
            ALTER TABLE dbo.Orders ENABLE TRIGGER ALL;\nGO\n\
            ALTER TABLE dbo.Orders SET (LOCK_ESCALATION = TABLE);\nGO\n",
        ),
        (
            "tsql_idx_valid.sql",
            LanguageId::TSql,
            "CREATE INDEX ix_orders_user ON dbo.Orders (user_id);\nGO\n\
            CREATE UNIQUE NONCLUSTERED INDEX ix_orders_code ON [dbo].[Orders] (code ASC, id DESC) INCLUDE (amount) WHERE amount > 0 WITH (ONLINE = ON) ON [PRIMARY];\nGO\n\
            CREATE CLUSTERED COLUMNSTORE INDEX cci_orders ON dbo.Orders;\nGO\n",
        ),
        (
            "tsql_routines_valid.sql",
            LanguageId::TSql,
            "CREATE OR ALTER PROCEDURE dbo.usp_Sync @Id INT WITH EXECUTE AS CALLER AS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT @Id;\nEND;\nGO\n\
            CREATE OR ALTER FUNCTION dbo.fn_Double(@x INT) RETURNS INT AS\nBEGIN\n  RETURN @x * 2;\nEND;\nGO\n\
            CREATE FUNCTION dbo.fn_Inline(@id INT) RETURNS TABLE AS\nRETURN (SELECT @id AS id);\nGO\n\
            CREATE FUNCTION dbo.fn_Multi(@id INT) RETURNS @out TABLE (id INT) AS\nBEGIN\n  INSERT INTO @out (id) VALUES (@id);\n  RETURN;\nEND;\nGO\n\
            CREATE OR ALTER TRIGGER dbo.tr_Orders ON dbo.Orders AFTER INSERT, UPDATE AS\nBEGIN\n  SET NOCOUNT ON;\n  SELECT 1;\nEND;\nGO\n\
            CREATE TRIGGER tr_Ddl ON DATABASE FOR DROP_TABLE AS\nBEGIN\n  PRINT 'blocked';\nEND;\nGO\n\
            CREATE TRIGGER tr_Logon ON ALL SERVER FOR LOGON AS\nBEGIN\n  PRINT 'ok';\nEND;\nGO\n",
        ),
        (
            "V002__valid_tsql_mig.sql",
            LanguageId::DbMigration,
            "-- migrate:up\nCREATE TABLE [dbo].[t] (id INT COLLATE SQL_Latin1_General_CP1_CI_AS NOT NULL PRIMARY KEY);\nGO\n-- migrate:down\nDROP TABLE [dbo].[t];\nGO\n",
        ),
    ];

    for &(path, lang, src) in valid_cases {
        assert_valid(lang, path, src);
    }
}
