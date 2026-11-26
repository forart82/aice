use std::path::Path;

use aice_lang_registry::{LanguageId, detect_language};

#[test]
fn detects_all_34_language_variants() {
    let cases: &[(&str, &str, LanguageId)] = &[
        ("manifest.json", "{}", LanguageId::Json),
        ("tsconfig.jsonc", "// c\n{}", LanguageId::Json),
        ("app.webmanifest", "{}", LanguageId::Json),
        ("deploy.yaml", "a: 1", LanguageId::Yaml),
        ("deploy.yml", "a: 1", LanguageId::Yaml),
        ("Cargo.toml", "[package]", LanguageId::Toml),
        ("README.md", "# Hi", LanguageId::Markdown),
        ("doc.markdown", "# Hi", LanguageId::Markdown),
        ("index.html", "<html></html>", LanguageId::Html),
        ("index.htm", "<html></html>", LanguageId::Html),
        ("styles.css", "body {}", LanguageId::Css),
        ("config.xml", "<a/>", LanguageId::Xml),
        ("icon.svg", "<svg/>", LanguageId::Xml),
        ("schema.xsd", "<xs:schema/>", LanguageId::Xml),
        ("rules.dtd", "<!ELEMENT a (#PCDATA)>", LanguageId::Xml),
        ("style.xsl", "<xsl:stylesheet/>", LanguageId::Xml),
        ("transform.xslt", "<xsl:stylesheet/>", LanguageId::Xml),
        ("build.sh", "echo hi", LanguageId::Bash),
        ("init.bash", "echo hi", LanguageId::Bash),
        ("env.zsh", "echo hi", LanguageId::Bash),
        ("lib.rs", "fn main() {}", LanguageId::Rust),
        ("app.ts", "const x = 1;", LanguageId::TypeScript),
        ("mod.mts", "export const x = 1;", LanguageId::TypeScript),
        ("mod.cts", "export const x = 1;", LanguageId::TypeScript),
        ("view.tsx", "export const V = () => <div/>;", LanguageId::Tsx),
        ("index.js", "const x = 1;", LanguageId::JavaScript),
        ("index.mjs", "export const x = 1;", LanguageId::JavaScript),
        ("index.cjs", "module.exports = {};", LanguageId::JavaScript),
        ("index.jsx", "export const V = () => <div/>;", LanguageId::JavaScript),
        ("worker.py", "def f(): pass", LanguageId::Python),
        ("worker.pyi", "def f() -> None: ...", LanguageId::Python),
        ("gui.pyw", "print(1)", LanguageId::Python),
        ("server.go", "package main", LanguageId::Go),
        ("native.c", "int main(void) { return 0; }", LanguageId::C),
        ("matrix.cpp", "int main() {}", LanguageId::Cpp),
        ("matrix.hpp", "#pragma once", LanguageId::Cpp),
        ("billing.cs", "class A {}", LanguageId::CSharp),
        ("Service.java", "class Service {}", LanguageId::Java),
        ("Handler.kt", "fun main() {}", LanguageId::Kotlin),
        ("build.gradle.kts", "plugins {}", LanguageId::Kotlin),
        ("widget.dart", "void main() {}", LanguageId::Dart),
        ("controller.php", "<?php echo 1;", LanguageId::Php),
        ("jobs.rb", "puts 1", LanguageId::Ruby),
        ("card.twig", "{{ title }}", LanguageId::Twig),
        ("card.html.twig", "<div>{{ title }}</div>", LanguageId::Twig),
        ("schema.sql", "SELECT 1;", LanguageId::AnsiSql),
        ("pg.sql", "CREATE FUNCTION f() RETURNS TRIGGER LANGUAGE PL/PGSQL AS $fn$ BEGIN END $fn$;", LanguageId::PostgreSql),
        ("my.sql", "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;", LanguageId::MySql),
        ("sq.sql", "PRAGMA foreign_keys = ON;\nCREATE TABLE t(id INT) STRICT, WITHOUT ROWID;", LanguageId::Sqlite),
        ("ts.sql", "SELECT 1\nGO", LanguageId::TSql),
        ("schema.prisma", "model User { id Int @id }", LanguageId::Prisma),
        ("api.graphql", "type Query { ok: Boolean }", LanguageId::GraphQl),
        ("api.gql", "type Query { ok: Boolean }", LanguageId::GraphQl),
        ("graph.cypher", "MATCH (n) RETURN n", LanguageId::Cypher),
        ("graph.cql", "MATCH (n) RETURN n", LanguageId::Cypher),
        ("V1__init.sql", "CREATE TABLE t(id INT);", LanguageId::DbMigration),
        ("module.aice", "module m", LanguageId::Aice),
        ("notes.txt", "hello world", LanguageId::PlainText),
    ];

    for (path, sample, expected) in cases {
        assert_eq!(
            detect_language(Path::new(path), sample),
            *expected,
            "failed for {path}"
        );
    }
}

#[test]
fn sql_dialect_disambiguation_edge_cases() {
    // ON DELETE RESTRICT must NOT match SQLite STRICT
    let ansi_fk = "CREATE TABLE child (id INT, parent_id INT REFERENCES parent(id) ON DELETE RESTRICT);";
    assert_eq!(detect_language(Path::new("fk.sql"), ansi_fk), LanguageId::AnsiSql);

    // DELIMITER $$ must detect MySql before PostgreSql $$ check
    let mysql_dollar = "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END $$\nDELIMITER ;";
    assert_eq!(detect_language(Path::new("proc.sql"), mysql_dollar), LanguageId::MySql);

    // T-SQL GO at EOF without trailing newline, and CRLF
    assert_eq!(
        detect_language(Path::new("report_tsql.sql"), "SELECT 1;\r\nGO"),
        LanguageId::TSql
    );
    assert_eq!(
        detect_language(Path::new("proc.sql"), "CREATE PROCEDURE dbo.P @id INT AS SELECT @id"),
        LanguageId::TSql
    );
    assert_eq!(
        detect_language(Path::new("nocount.sql"), "SET NOCOUNT ON;\nSELECT CAST(x AS NVARCHAR(50));"),
        LanguageId::TSql
    );

    // Postgres PL/PGSQL, DECLARE..EXCEPTION, ::JSONB
    assert_eq!(
        detect_language(Path::new("fn.sql"), "CREATE FUNCTION f() RETURNS void AS $$\nDECLARE x INT; BEGIN RAISE NOTICE 'ok'; EXCEPTION WHEN OTHERS THEN NULL; END; $$;"),
        LanguageId::PostgreSql
    );
    assert_eq!(
        detect_language(Path::new("ext.sql"), "CREATE EXTENSION IF NOT EXISTS pgcrypto;\nSELECT '{}'::jsonb;"),
        LanguageId::PostgreSql
    );

    // Migrations: Flyway V/U/R vs false-positive view__users.sql; Goose; dbmate; Liquibase
    assert_eq!(detect_language(Path::new("U12__undo.sql"), "DROP TABLE t;"), LanguageId::DbMigration);
    assert_eq!(detect_language(Path::new("R__seed.sql"), "INSERT INTO t VALUES (1);"), LanguageId::DbMigration);
    assert_eq!(detect_language(Path::new("view__users.sql"), "SELECT * FROM users;"), LanguageId::AnsiSql);
    assert_eq!(detect_language(Path::new("m.sql"), "-- +goose Up\nCREATE TABLE a(id INT);"), LanguageId::DbMigration);
    assert_eq!(detect_language(Path::new("m.sql"), "-- migrate:up\nCREATE TABLE a(id INT);"), LanguageId::DbMigration);
    assert_eq!(detect_language(Path::new("m.sql"), "-- liquibase formatted sql\nCREATE TABLE a(id INT);"), LanguageId::DbMigration);
}

#[test]
fn header_c_vs_cpp_and_shebangs_and_empty_fallback() {
    let c_header_with_extern = "#ifdef __cplusplus\nextern \"C\" {\n#endif\nint api_init(void);\n#ifdef __cplusplus\n}\n#endif\n";
    assert_eq!(detect_language(Path::new("api.h"), c_header_with_extern), LanguageId::C);
    assert_eq!(detect_language(Path::new("my_class_id.h"), "int my_class_id;"), LanguageId::C);

    assert_eq!(detect_language(Path::new("vec.h"), "#include <vector>\nstruct S {};"), LanguageId::Cpp);
    assert_eq!(detect_language(Path::new("cls.h"), "class Engine {\npublic:\n  void run();\n};"), LanguageId::Cpp);
    assert_eq!(detect_language(Path::new("tpl.h"), "template <typename T>\nconstexpr T id(T x) { return x; }"), LanguageId::Cpp);

    // Shebangs
    assert_eq!(detect_language(Path::new("script"), "#!/usr/bin/env python3\nprint(1)"), LanguageId::Python);
    assert_eq!(detect_language(Path::new("script"), "\u{FEFF}#!/usr/bin/env sh\necho hi"), LanguageId::Bash);
    assert_eq!(detect_language(Path::new("script"), "#!/usr/bin/env -S deno run\nconsole.log(1)"), LanguageId::TypeScript);
    assert_eq!(detect_language(Path::new("script"), "#!/usr/bin/env bun\nconsole.log(1)"), LanguageId::JavaScript);
    assert_eq!(detect_language(Path::new("script"), "#!/usr/bin/env php8.2\n<?php echo 1;"), LanguageId::Php);
    assert_eq!(detect_language(Path::new("script"), "#!/usr/bin/ruby\nputs 1"), LanguageId::Ruby);

    // Empty sample fallbacks
    assert_eq!(detect_language(Path::new("empty.h"), ""), LanguageId::C);
    assert_eq!(detect_language(Path::new("empty.sql"), ""), LanguageId::AnsiSql);
    assert_eq!(detect_language(Path::new("unknown_noext"), ""), LanguageId::PlainText);
}
#[test]
fn regression_sql_comments_strings_on_conflict_cpp20_and_env_flags() {
    // GO inside SQL block comments or multiline string literals stays AnsiSql
    assert_eq!(
        detect_language(Path::new("q.sql"), "/*\nGO\n*/\nSELECT 1;"),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(
            Path::new("q.sql"),
            "INSERT INTO logs(msg) VALUES ('line1\nGO\nline3');"
        ),
        LanguageId::AnsiSql
    );

    // PostgreSQL-style ON CONFLICT upsert without SQLite markers must NOT become Sqlite
    assert_ne!(
        detect_language(
            Path::new("upsert.sql"),
            "INSERT INTO users (id, name) VALUES (1, 'a') ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name;"
        ),
        LanguageId::Sqlite
    );

    // C header with "class" in comment remains C
    assert_eq!(
        detect_language(
            Path::new("c_comm.h"),
            "/* Defines the widget class of handlers in C */\ntypedef struct widget widget_t;"
        ),
        LanguageId::C
    );

    // C++20 / modern C++ headers and keywords in .h
    assert_eq!(
        detect_language(
            Path::new("concepts.h"),
            "#pragma once\n#include <concepts>\n#include <ranges>\nconsteval int sq(int x) { return x * x; }\n"
        ),
        LanguageId::Cpp
    );
    assert_eq!(
        detect_language(
            Path::new("cmp.h"),
            "#pragma once\n#include <compare>\nstruct Point final {\n  int x;\n  auto operator<=>(const Point&) const = default;\n};\n"
        ),
        LanguageId::Cpp
    );
    assert_eq!(
        detect_language(
            Path::new("u64.h"),
            "#pragma once\n#include <cstdint>\ninline uint64_t f(uint64_t x) noexcept { return x + 1; }\n"
        ),
        LanguageId::Cpp
    );
    assert_eq!(
        detect_language(Path::new("enum_s.h"), "enum struct Color { Red, Blue };"),
        LanguageId::Cpp
    );

    // env -u / -C / --unset value arguments in shebang
    assert_eq!(
        detect_language(Path::new("run"), "#!/usr/bin/env -u FOO deno run\nconsole.log(1);"),
        LanguageId::TypeScript
    );
    assert_eq!(
        detect_language(Path::new("run"), "#!/usr/bin/env -C /tmp python3\nprint(1)"),
        LanguageId::Python
    );
    assert_eq!(
        detect_language(Path::new("run"), "#!/usr/bin/env --unset FOO bun\nconsole.log(1);"),
        LanguageId::JavaScript
    );
}

#[test]
fn regression_iter2_sql_dialects_and_c_header_edge_cases() {
    // PostgreSQL dollar-quoted bodies containing GO must classify as PostgreSql, not TSql
    assert_eq!(
        detect_language(
            Path::new("emit.sql"),
            "CREATE FUNCTION emit() RETURNS text AS $body$\nSELECT 1;\nGO\nSELECT 2;\n$body$ LANGUAGE sql;"
        ),
        LanguageId::PostgreSql
    );
    assert_eq!(
        detect_language(
            Path::new("emit2.sql"),
            "CREATE FUNCTION emit() RETURNS text AS $$\nSELECT 1;\nGO\nSELECT 2;\n$$ LANGUAGE sql;"
        ),
        LanguageId::PostgreSql
    );

    // Column/table identifiers named `strict` stay AnsiSql; SQLite STRICT table option stays Sqlite
    assert_eq!(
        detect_language(Path::new("q.sql"), "SELECT strict, mode FROM config;"),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(Path::new("t.sql"), "CREATE TABLE validation (strict INT NOT NULL);"),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(Path::new("sq1.sql"), "CREATE TABLE t(id INT) STRICT;"),
        LanguageId::Sqlite
    );
    assert_eq!(
        detect_language(Path::new("sq2.sql"), "CREATE TABLE t(id INT) WITHOUT ROWID, STRICT"),
        LanguageId::Sqlite
    );

    // Migration markers inside SQL string literals or inline comments must NOT trigger DbMigration
    assert_eq!(
        detect_language(Path::new("s.sql"), "SELECT '-- +goose Up';"),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(Path::new("s2.sql"), "SELECT 'line1\n-- +goose Up\nline3';"),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(Path::new("s3.sql"), "SELECT 1; -- +goose Up"),
        LanguageId::AnsiSql
    );

    // T-SQL GO <repeat_count> and MySQL DELIMITER<tab>$$
    assert_eq!(
        detect_language(Path::new("tsql_rep.sql"), "SELECT 1;\nGO 5\nSELECT 2;"),
        LanguageId::TSql
    );
    assert_eq!(
        detect_language(
            Path::new("my_tab.sql"),
            "DELIMITER\t$$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;"
        ),
        LanguageId::MySql
    );

    // C headers with `final`/`override` identifiers or `\`-continued line comments stay C
    assert_eq!(
        detect_language(Path::new("cfg.h"), "struct cfg { int final; int override; };"),
        LanguageId::C
    );
    assert_eq!(
        detect_language(
            Path::new("cont.h"),
            "// comment \\\nclass Foo {};\ntypedef int t;"
        ),
        LanguageId::C
    );
}

#[test]
fn regression_iter3_unclosed_dollar_quotes_and_ctas_strict() {
    // Unclosed PG dollar quotes containing GO or -- +goose must stay PostgreSql
    assert_eq!(
        detect_language(
            Path::new("unclosed_go.sql"),
            "CREATE FUNCTION f() RETURNS text AS $body$\nSELECT 1;\nGO\nSELECT 2;"
        ),
        LanguageId::PostgreSql
    );
    assert_eq!(
        detect_language(
            Path::new("unclosed_goose.sql"),
            "CREATE FUNCTION f() RETURNS text AS $body$\nSELECT 1;\n-- +goose Up\nSELECT 2;"
        ),
        LanguageId::PostgreSql
    );
    assert_eq!(
        detect_language(
            Path::new("unclosed_dd.sql"),
            "CREATE FUNCTION f() RETURNS text AS $$\nSELECT 1;\nGO\n-- +goose Up\n"
        ),
        LanguageId::PostgreSql
    );

    // MySQL DELIMITER $$ (even unclosed) must remain MySql
    assert_eq!(
        detect_language(
            Path::new("mysql_unclosed.sql"),
            "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END"
        ),
        LanguageId::MySql
    );

    // CREATE TABLE ... AS SELECT ... strict alias must stay AnsiSql
    assert_eq!(
        detect_language(
            Path::new("ctas.sql"),
            "CREATE TABLE t AS SELECT fn(a) strict;"
        ),
        LanguageId::AnsiSql
    );

    // SQLite GENERATED ALWAYS AS (...) STORED STRICT and WITHOUT ROWID, STRICT stay Sqlite
    assert_eq!(
        detect_language(
            Path::new("gen_strict.sql"),
            "CREATE TABLE t (a INT GENERATED ALWAYS AS (1) STORED) STRICT;"
        ),
        LanguageId::Sqlite
    );
    assert_eq!(
        detect_language(
            Path::new("without_rowid_strict.sql"),
            "CREATE TABLE t (a INT) WITHOUT ROWID, STRICT;"
        ),
        LanguageId::Sqlite
    );
}

#[test]
fn regression_iter5_mysql_delimiter_token_specificity() {
    // Columns named `delimiter` in SELECT / CREATE TABLE must stay AnsiSql
    assert_eq!(
        detect_language(
            Path::new("sel_delim.sql"),
            "SELECT\ndelimiter AS sep\nFROM settings;"
        ),
        LanguageId::AnsiSql
    );
    assert_eq!(
        detect_language(
            Path::new("tbl_delim.sql"),
            "CREATE TABLE settings (\n  delimiter VARCHAR(10)\n);"
        ),
        LanguageId::AnsiSql
    );

    // Genuine MySQL DELIMITER directives with symbol tokens remain MySql
    for src in [
        "DELIMITER $$\nCREATE PROCEDURE p() BEGIN SELECT 1; END$$\nDELIMITER ;",
        "DELIMITER\t$$\nSELECT 1$$",
        "DELIMITER //\nCREATE TRIGGER t BEFORE INSERT ON x FOR EACH ROW BEGIN END//",
        "DELIMITER ;\nSELECT 1;",
        "DELIMITER ;; -- reset\nSELECT 1;;",
    ] {
        assert_eq!(
            detect_language(Path::new("my.sql"), src),
            LanguageId::MySql,
            "expected MySql for: {src}"
        );
    }
}

#[test]
fn regression_iter6_mysql_delimiter_operators_and_stmt_boundaries() {
    for op in ["+", "/", "-", "*", "%", "&", "|", "^", "~", "!", "=", "<", ">", "!=", "<>", "<=", ">="] {
        let src = format!("SELECT\n  delimiter {op}\n  1\nFROM settings;");
        assert_eq!(
            detect_language(Path::new("q.sql"), &src),
            LanguageId::AnsiSql,
            "expected AnsiSql for operator {op}"
        );
    }
    for src in [
        "SELECT\n  delimiter ||\n  'x'\nFROM settings;",
        "SELECT\n  delimiter ::\n  TEXT\nFROM settings;",
        "DELIMITER +\nSELECT 1;",
    ] {
        assert_eq!(
            detect_language(Path::new("q.sql"), src),
            LanguageId::AnsiSql,
            "expected AnsiSql for: {src}"
        );
    }
    for src in [
        "DELIMITER @@\nSELECT 1@@",
        "DELIMITER ||\nSELECT 1||",
        "DELIMITER ##\nSELECT 1##",
        "DELIMITER ::\nSELECT 1::",
        "DELIMITER ~~\nSELECT 1~~",
        "DELIMITER %%\nSELECT 1%%",
        "SELECT 1;\nDELIMITER $$\nSELECT 2$$",
    ] {
        assert_eq!(
            detect_language(Path::new("my.sql"), src),
            LanguageId::MySql,
            "expected MySql for: {src}"
        );
    }
}

#[test]
fn detects_msbuild_xaml_and_ecosystem_xml_extensions() {
    let xml_cases = [
        ("src/App.csproj", "<Project Sdk=\"Microsoft.NET.Sdk\"></Project>"),
        ("SRC/APP.CSPROJ", "<Project></Project>"),
        ("Legacy/Tool.vbproj", "<Project></Project>"),
        ("Lib/Core.fsproj", "<Project></Project>"),
        ("Directory.Build.props", "<Project><PropertyGroup /></Project>"),
        ("Directory.Build.targets", "<Project><Target Name=\"Build\" /></Project>"),
        ("Views/MainWindow.xaml", "<Window><broken></nope>\n"),
        ("Views/Dialog.XAML", "<Window />"),
        ("Views/MainView.axaml", "<UserControl />"),
        ("MyPkg.nuspec", "<package><metadata /></package>"),
        ("ios/Info.plist", "<?xml version=\"1.0\"?><plist version=\"1.0\"><dict/></plist>"),
        ("Properties/Resources.resx", "<root><data name=\"A\"><value>1</value></data></root>"),
    ];

    for (path, sample) in xml_cases {
        assert_eq!(
            detect_language(Path::new(path), sample),
            LanguageId::Xml,
            "expected Xml for {path}"
        );
    }

    // Do not blindly classify arbitrary .config files as Xml (could be INI/key-value)
    assert_eq!(
        detect_language(Path::new("app.config"), "[section]\nkey = value\n"),
        LanguageId::PlainText
    );
}
