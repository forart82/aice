pub mod c_cpp;
pub mod c_lang;
pub mod cpp_lang;
pub mod csharp;
pub mod csharp_java;
pub mod dart;
pub mod data_fmt;
pub mod db_dialects;
pub mod db_sql;
pub mod emit_ctx;
pub mod expr_emit;
pub mod go_lang;
mod iter_emit;
mod iter_expr;
mod iter_expr_call;
mod iter_expr_fmt;
mod iter_match;
mod iter_match_fmt;
mod iter_match_pat;
mod iter_py;
mod iter_rb;
mod iter_stmt;
mod iter_stmt_match;
pub mod java_lang;
pub mod kotlin;
pub mod kotlin_dart;
pub mod pattern_emit;
pub mod php;
pub mod php_ruby;
pub mod python;
pub mod ruby;
mod rust_helpers;
pub mod rust_lang;
pub mod shell_md;
pub mod stmt_common;
pub mod ts_js;
mod ts_jsx;
pub mod twig;
pub mod type_map;
pub mod type_map_c;
pub mod type_map_c_kw;
mod type_map_ts;
pub mod web_html_css;

use aice_lang_registry::LanguageId;

use crate::ir::{AiceModule, TranspileError};

pub fn compile_module(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            ts_js::compile(module, target)
        }
        LanguageId::Python => python::compile(module),
        LanguageId::Rust => rust_lang::compile(module),
        LanguageId::Go => go_lang::compile(module),
        LanguageId::C | LanguageId::Cpp => c_cpp::compile(module, target),
        LanguageId::CSharp | LanguageId::Java => csharp_java::compile(module, target),
        LanguageId::Kotlin | LanguageId::Dart => kotlin_dart::compile(module, target),
        LanguageId::Php | LanguageId::Ruby => php_ruby::compile(module, target),
        LanguageId::Bash | LanguageId::Markdown => shell_md::compile(module, target),
        LanguageId::Html | LanguageId::Css => web_html_css::compile(module, target),
        LanguageId::Twig => twig::compile(module),
        LanguageId::Json | LanguageId::Yaml | LanguageId::Toml | LanguageId::Xml => {
            data_fmt::compile(module, target)
        }
        LanguageId::AnsiSql
        | LanguageId::PostgreSql
        | LanguageId::MySql
        | LanguageId::Sqlite
        | LanguageId::TSql
        | LanguageId::DbMigration
        | LanguageId::Prisma
        | LanguageId::GraphQl
        | LanguageId::Cypher => db_dialects::compile(module, target),
        LanguageId::Aice | LanguageId::PlainText => Ok(module.raw_fallback.clone()),
    }
}
