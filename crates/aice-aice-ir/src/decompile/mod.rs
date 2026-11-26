pub mod c_cpp;
pub mod c_lang;
pub mod cpp_lang;
pub mod csharp;
pub mod csharp_java;
pub mod cst_util;
pub mod dart;
pub mod dart_params;
pub mod data_fmt;
pub mod data_yaml;
pub mod expr_common;
pub mod expr_lit;
pub mod go_lang;
mod iter_env;
mod iter_expr;
mod iter_expr_call;
mod iter_expr_fin;
mod iter_jsx;
mod iter_match;
mod iter_stmt;
mod iter_stmt_cf;
mod iter_stmt_fin;
pub mod java_lang;
pub mod kotlin;
pub mod kotlin_dart;
pub mod match_cf;
pub mod match_kotlin;
pub mod op_map;
pub mod php;
pub mod php_ruby;
pub mod prisma_gql_cypher;
pub mod python;
pub mod ruby;
pub mod rust_lang;
pub mod shell_md;
pub mod sql_db;
pub mod sql_rd_proc;
pub mod sql_rd_scan;
pub mod sql_rd_tbl;
pub mod sql_ts;
pub mod stmt_cf_util;
pub mod stmt_common;
pub mod stmt_for;
pub mod stmt_vars;
pub mod trivia;
pub mod ts_helpers;
pub mod ts_js;
pub mod tsx_jsx;
pub mod twig;
pub mod twig_scan;
pub mod web_html_css;
pub mod xml_fmt;

use aice_lang_registry::{LanguageId, ParsedTree};

use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile_tree(
    tree: &ParsedTree,
    src: &str,
    opts: &TranspileOpts,
) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    match lang {
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            ts_js::decompile(tree, src, opts)
        }
        LanguageId::Python => python::decompile(tree, src, opts),
        LanguageId::Rust => rust_lang::decompile(tree, src, opts),
        LanguageId::Go => go_lang::decompile(tree, src, opts),
        LanguageId::C | LanguageId::Cpp => c_cpp::decompile(tree, src, opts),
        LanguageId::CSharp | LanguageId::Java => csharp_java::decompile(tree, src, opts),
        LanguageId::Kotlin | LanguageId::Dart => kotlin_dart::decompile(tree, src, opts),
        LanguageId::Php | LanguageId::Ruby => php_ruby::decompile(tree, src, opts),
        LanguageId::Bash | LanguageId::Markdown => shell_md::decompile(tree, src, opts),
        LanguageId::Html | LanguageId::Css => web_html_css::decompile(tree, src, opts),
        LanguageId::Twig => twig::decompile(tree, src, opts),
        LanguageId::Json | LanguageId::Yaml | LanguageId::Toml | LanguageId::Xml => {
            data_fmt::decompile(tree, src, opts)
        }
        LanguageId::AnsiSql
        | LanguageId::PostgreSql
        | LanguageId::MySql
        | LanguageId::Sqlite
        | LanguageId::TSql
        | LanguageId::DbMigration => sql_db::decompile(tree, src, opts),
        LanguageId::Prisma | LanguageId::GraphQl | LanguageId::Cypher => {
            prisma_gql_cypher::decompile(tree, src, opts)
        }
        LanguageId::Aice => crate::parser::parse_aice(src).map(|mut m| {
            m.source_lang = LanguageId::Aice;
            m
        }),
        LanguageId::PlainText => {
            let mut m = AiceModule::new(lang, "raw");
            m.raw_fallback = src.to_string();
            Ok(m)
        }
    }
}
