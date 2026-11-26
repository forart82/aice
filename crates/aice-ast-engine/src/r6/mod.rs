pub mod cypher;
mod cypher_rd;
pub mod graphql;
pub(crate) mod mig_detect;
pub mod migrations;
pub mod mysql;
mod mysql_ctrl;
mod mysql_dml;
mod mysql_opt;
mod mysql_part;
mod mysql_rd;
mod mysql_stmt;
mod mysql_ts_norm;
pub mod plpgsql;
mod plpgsql_rd;
mod plpgsql_stmt;
pub mod prisma;
pub mod sql_ansi;
pub(crate) mod sql_dep_scan;
mod sql_expr;
pub(crate) mod sql_lex;
mod sql_lex_scan;
mod sql_pratt;
mod sql_pratt_ext;
pub(crate) mod sql_symbols;
mod sql_trim;
pub mod sqlite;
mod sqlite_rd;
pub mod tsql;
mod tsql_ctbl;
mod tsql_ddl;
mod tsql_dml;
mod tsql_dml_from;
mod tsql_dml_ops;
mod tsql_exec;
mod tsql_from_ext;
mod tsql_output;
mod tsql_paren;
mod tsql_query;
pub(crate) mod tsql_rd;
mod tsql_stmt;
mod tsql_tail;
mod tsql_with;

use aice_lang_registry::{LanguageAdapter, LanguageId, ParseError, ParsedTree, SymbolNode};

use crate::r5::checks::{ErrorSpan, format_context, spans_to_diagnostics};
use crate::ts_pool::ParserPool;
use crate::{AdapterBundle, SyntaxIssue};

pub fn all_adapters() -> Vec<Box<dyn AdapterBundle>> {
    vec![
        Box::new(sql_ansi::AnsiSqlAdapter),
        Box::new(plpgsql::PostgreSqlAdapter),
        Box::new(mysql::MySqlAdapter),
        Box::new(sqlite::SqliteAdapter),
        Box::new(tsql::TSqlAdapter),
        Box::new(prisma::PrismaAdapter),
        Box::new(graphql::GraphQlAdapter),
        Box::new(cypher::CypherAdapter),
        Box::new(migrations::DbMigrationAdapter),
    ]
}

pub fn parse_r6(
    lang: LanguageId,
    src: &str,
    pool: &mut ParserPool,
) -> Result<ParsedTree, ParseError> {
    match lang {
        LanguageId::AnsiSql => sql_ansi::parse_ansi(src, pool),
        LanguageId::Prisma
        | LanguageId::GraphQl
        | LanguageId::Cypher => pool.parse_lang(lang, src),
        LanguageId::PostgreSql => plpgsql::parse_pg(src, pool),
        LanguageId::MySql => mysql::parse_mysql(src, pool),
        LanguageId::Sqlite => sqlite::parse_sqlite(src, pool),
        LanguageId::TSql => tsql::parse_tsql(src),
        LanguageId::DbMigration => migrations::parse_migration(src, pool),
        _ => Err(ParseError {
            message: format!("Unsupported R6 language: {}", lang.canonical_name()),
            line: 1,
            column: 1,
        }),
    }
}

pub fn extract_r6_symbols(lang: LanguageId, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
    match lang {
        LanguageId::AnsiSql => sql_ansi::AnsiSqlAdapter.extract_symbols(tree, src),
        LanguageId::PostgreSql => plpgsql::PostgreSqlAdapter.extract_symbols(tree, src),
        LanguageId::MySql => mysql::MySqlAdapter.extract_symbols(tree, src),
        LanguageId::Sqlite => sqlite::SqliteAdapter.extract_symbols(tree, src),
        LanguageId::TSql => tsql::TSqlAdapter.extract_symbols(tree, src),
        LanguageId::Prisma => prisma::PrismaAdapter.extract_symbols(tree, src),
        LanguageId::GraphQl => graphql::GraphQlAdapter.extract_symbols(tree, src),
        LanguageId::Cypher => cypher::CypherAdapter.extract_symbols(tree, src),
        LanguageId::DbMigration => migrations::DbMigrationAdapter.extract_symbols(tree, src),
        _ => Vec::new(),
    }
}

pub fn verify_r6_firewall(
    lang: LanguageId,
    src: &str,
    pool: &mut ParserPool,
) -> Result<(), Vec<SyntaxIssue>> {
    let spans: Vec<ErrorSpan> = match lang {
        LanguageId::AnsiSql => sql_ansi::verify_ansi_spans(src, pool),
        LanguageId::PostgreSql => plpgsql::verify_pg_spans(src, pool),
        LanguageId::MySql => mysql::verify_mysql_spans(src, pool),
        LanguageId::Sqlite => sqlite::verify_sqlite_spans(src, pool),
        LanguageId::TSql => tsql::verify_tsql_spans(src),
        LanguageId::Prisma => prisma::verify_prisma_spans(src, pool),
        LanguageId::GraphQl => graphql::verify_graphql_spans(src, pool),
        LanguageId::Cypher => cypher::verify_cypher_spans(src, pool),
        LanguageId::DbMigration => migrations::verify_migration_spans(src, pool),
        _ => {
            return Err(vec![SyntaxIssue {
                line: 1,
                column: 1,
                message: format!("Unsupported R6 language: {}", lang.canonical_name()),
                context: format_context(src, 1),
            }]);
        }
    };
    if spans.is_empty() {
        Ok(())
    } else {
        Err(spans_to_diagnostics(src, spans))
    }
}
