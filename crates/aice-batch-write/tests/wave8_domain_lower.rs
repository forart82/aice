use std::path::{Path, PathBuf};

use aice_ast_engine::DefaultSyntaxFirewall;
use aice_batch_write::aice_lower::{decompile_to_aice, lower_snippet};
use aice_batch_write::execute_batch_write;
use aice_governance::{OutputSurface, PipelineRequest, WriteOp, authorize};
use aice_lang_registry::{FirewallVerdict, LanguageId, SyntaxFirewall};

fn empty_op() -> WriteOp {
    WriteOp {
        path: None,
        symbol: None,
        code: None,
        template: None,
        body: None,
        from_file: None,
        from_stdin: false,
        delete: None,
        insert_after: None,
        insert_before: None,
        edits: None,
        batch: None,
        create: false,
        overwrite: false,
        force: false,
        in_place: false,
        dry_run: false,
        diff: false,
        json: false,
        preserve_docs: true,
        target_paths: vec![],
    }
}

fn temp_dir(tag: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("aice_w8_{tag}_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).unwrap();
    dir
}

#[test]
fn wave8_v8_2c_05_graphql_and_mysql_exact_overwrite_repros() {
    let dir = temp_dir("repros");
    let fw = DefaultSyntaxFirewall;

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    // 1. Exact F-83 / V8-2C-05 GraphQL IR repro
    let gql_path = dir.join("schema_f83.graphql");
    std::fs::write(&gql_path, "type Query { ping: String }\n").unwrap();
    let gql_ir = concat!(
        "// file: schema_f83.graphql\n",
        "module graphql\n",
        "gql \"enum\" \"Role\": USER, ADMIN\n",
        "query \"graphql\" \"gql\" \"auth\":\n",
        "  clause \"directive\":| directive @auth(role: Role = USER) on FIELD_DEFINITION\n",
        "gql \"object\" \"User\": id:ID!\n",
        "gql \"object\" \"Post\": id:ID!\n",
        "gql \"union\" \"SearchResult\": User, Post\n",
        "gql \"input\" \"PageInput\": limit:Int = 20, cursor:String = \"\"\n",
        "gql \"object\" \"Query\":\n",
        "  search(q: String!, page: PageInput):[SearchResult!]! | \"@auth(role: ADMIN)\"\n",
    );
    let mut op = empty_op();
    op.overwrite = true;
    op.path = Some(PathBuf::from("schema_f83.graphql"));
    op.code = Some(gql_ir.into());
    let rep = run_op(op);
    assert_eq!(rep.exit_code, 0, "GraphQL IR overwrite failed: {rep:?}");
    let gql_disk = std::fs::read_to_string(&gql_path).unwrap();
    assert!(gql_disk.contains("union SearchResult = User | Post"), "gql={gql_disk}");
    assert!(gql_disk.contains("directive @auth"), "gql={gql_disk}");
    assert!(gql_disk.contains("@auth(role: ADMIN)"), "gql={gql_disk}");
    assert_eq!(fw.verify(&gql_disk, &gql_path, LanguageId::GraphQl), FirewallVerdict::Valid);

    // 2. Exact F-88 / V8-2C-05 MySQL ENUM IR repro (both --overwrite and --create)
    let my_path = dir.join("mysql_enum.sql");
    std::fs::write(&my_path, "CREATE TABLE `orders` (`id` INT PRIMARY KEY) ENGINE=InnoDB;\n").unwrap();
    let my_ir = concat!(
        "// file: mysql_enum.sql\n",
        "module mysql\n",
        "table \"`orders`\":\n",
        "  col \"`id`\": int(11) NN AI\n",
        "  col \"`status`\": \"ENUM('new', 'paid', 'shipped')\" | NN DEFAULT 'new'\n",
        "  con| PRIMARY KEY (`id`)\n",
        "  opt| ENGINE=InnoDB DEFAULT CHARSET=utf8mb4\n",
    );
    let mut op2 = empty_op();
    op2.overwrite = true;
    op2.path = Some(PathBuf::from("mysql_enum.sql"));
    op2.code = Some(my_ir.into());
    let rep2 = run_op(op2);
    assert_eq!(rep2.exit_code, 0, "MySQL IR overwrite failed: {rep2:?}");
    let my_disk = std::fs::read_to_string(&my_path).unwrap();
    assert!(my_disk.contains("CREATE TABLE `orders`"), "mysql={my_disk}");
    assert!(my_disk.contains("ENUM('new', 'paid', 'shipped')"), "mysql={my_disk}");
    assert_eq!(fw.verify(&my_disk, &my_path, LanguageId::MySql), FirewallVerdict::Valid);

    let mut op3 = empty_op();
    op3.create = true;
    op3.path = Some(PathBuf::from("mysql_created.sql"));
    op3.code = Some(my_ir.into());
    let rep3 = run_op(op3);
    assert_eq!(rep3.exit_code, 0, "MySQL IR create failed: {rep3:?}");
    let my_cr = std::fs::read_to_string(dir.join("mysql_created.sql")).unwrap();
    assert!(my_cr.contains("CREATE TABLE `orders`"), "mysql_cr={my_cr}");
    assert_eq!(fw.verify(&my_cr, Path::new("mysql_created.sql"), LanguageId::MySql), FirewallVerdict::Valid);

    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn wave8_v8_2c_05_all_domain_languages_ir_roundtrip_and_native_splices() {
    let dir = temp_dir("domains");
    let fw = DefaultSyntaxFirewall;

    let run_op = |op: WriteOp| -> aice_batch_write::BatchWriteReport {
        let gov = authorize(PipelineRequest::new(op.clone(), dir.clone(), OutputSurface::Cli)).unwrap();
        execute_batch_write(gov.state(), &op).unwrap()
    };

    let cases: &[(&str, LanguageId, &str)] = &[
        (
            "api.graphql",
            LanguageId::GraphQl,
            "type User {\n  id: ID!\n  name: String!\n}\n",
        ),
        (
            "orders_my.sql",
            LanguageId::MySql,
            "CREATE TABLE `orders` (\n  `id` INT NOT NULL AUTO_INCREMENT,\n  `total` INT NOT NULL,\n  PRIMARY KEY (`id`)\n) ENGINE=InnoDB;\n",
        ),
        (
            "ledger_pg.sql",
            LanguageId::PostgreSql,
            "CREATE TABLE accounts (\n  id BIGSERIAL PRIMARY KEY,\n  created_at TIMESTAMPTZ NOT NULL\n);\n",
        ),
        (
            "cache_sq.sql",
            LanguageId::Sqlite,
            "CREATE TABLE kv (\n  k TEXT PRIMARY KEY,\n  v INTEGER NOT NULL\n) STRICT;\n",
        ),
        (
            "proc_tsql.sql",
            LanguageId::TSql,
            "CREATE TABLE [dbo].[Items] (\n  [Id] INT NOT NULL PRIMARY KEY,\n  [Name] NVARCHAR(64) NOT NULL\n);\nGO\n",
        ),
        (
            "ansi.sql",
            LanguageId::AnsiSql,
            "CREATE TABLE ledger (\n  id INTEGER PRIMARY KEY,\n  amount INTEGER NOT NULL\n);\n",
        ),
        (
            "V001__init.sql",
            LanguageId::DbMigration,
            "-- +goose Up\nCREATE TABLE audit (\n  id INTEGER PRIMARY KEY\n);\n\n-- +goose Down\nDROP TABLE audit;\n",
        ),
        (
            "schema.prisma",
            LanguageId::Prisma,
            "datasource db {\n  provider = \"postgresql\"\n  url = env(\"DATABASE_URL\")\n}\n\nmodel User {\n  id Int @id @default(autoincrement())\n  email String @unique\n}\n",
        ),
        (
            "graph.cypher",
            LanguageId::Cypher,
            "MATCH (u:User)\nWHERE u.active = true\nRETURN u.id;\n",
        ),
        (
            "index.html",
            LanguageId::Html,
            "<!doctype html>\n<html lang=\"en\">\n  <body>\n    <main>Hello</main>\n  </body>\n</html>\n",
        ),
        (
            "styles.css",
            LanguageId::Css,
            ".card {\n  display: flex;\n  color: #ffffff;\n}\n",
        ),
    ];

    for &(file, lang, native_src) in cases {
        let p = dir.join(file);
        std::fs::write(&p, native_src).unwrap();

        // 1. Decompile to AICE IR -> overwrite via execute_batch_write -> must compile & pass firewall
        let ir = decompile_to_aice(native_src, lang);
        let lowered = lower_snippet(&ir, lang, false, false, None, &fw, &p)
            .unwrap_or_else(|e| panic!("lower_snippet failed for {file} ({lang:?}): {e}\nir:\n{ir}"));
        assert!(
            !lowered.trim().is_empty(),
            "lower_snippet produced empty output for {file} ({lang:?})"
        );
        assert_eq!(
            fw.verify(&lowered, &p, lang),
            FirewallVerdict::Valid,
            "lowered output failed firewall for {file} ({lang:?}):\n{lowered}"
        );

        let mut ow_ir = empty_op();
        ow_ir.overwrite = true;
        ow_ir.path = Some(PathBuf::from(file));
        ow_ir.code = Some(ir.clone());
        let rep = run_op(ow_ir);
        assert_eq!(rep.exit_code, 0, "IR overwrite failed for {file} ({lang:?}): {rep:?}\nir:\n{ir}");
        let on_disk = std::fs::read_to_string(&p).unwrap();
        assert!(!on_disk.starts_with("module "), "{file} wrote raw AICE IR to disk:\n{on_disk}");
        assert_eq!(fw.verify(&on_disk, &p, lang), FirewallVerdict::Valid, "{file} invalid on disk:\n{on_disk}");

        // 2. Native raw overwrite must still pass untouched
        let mut ow_native = empty_op();
        ow_native.overwrite = true;
        ow_native.path = Some(PathBuf::from(file));
        ow_native.code = Some(native_src.into());
        let rep_nat = run_op(ow_native);
        assert_eq!(rep_nat.exit_code, 0, "Native overwrite failed for {file} ({lang:?}): {rep_nat:?}");
        assert_eq!(std::fs::read_to_string(&p).unwrap(), native_src);
    }

    let _ = std::fs::remove_dir_all(&dir);
}
