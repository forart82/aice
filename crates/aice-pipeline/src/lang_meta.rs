use std::path::Path;

use aice_lang_registry::LanguageId;

pub(crate) fn rel_path_label(root: &Path, path: &Path) -> String {
    let rel = path.strip_prefix(root).unwrap_or(path);
    rel.display().to_string()
}

pub(crate) fn telemetry_lang_name(lang: LanguageId) -> &'static str {
    match lang {
        LanguageId::Json => "JSON",
        LanguageId::Yaml => "YAML",
        LanguageId::Toml => "TOML",
        LanguageId::Markdown => "Markdown",
        LanguageId::Html => "HTML",
        LanguageId::Css => "CSS",
        LanguageId::Xml => "XML",
        LanguageId::Bash => "Shell",
        LanguageId::Rust => "Rust",
        LanguageId::TypeScript => "TypeScript",
        LanguageId::Tsx => "TSX",
        LanguageId::JavaScript => "JavaScript",
        LanguageId::Python => "Python",
        LanguageId::Go => "Go",
        LanguageId::C => "C",
        LanguageId::Cpp => "C++",
        LanguageId::CSharp => "C#",
        LanguageId::Java => "Java",
        LanguageId::Kotlin => "Kotlin",
        LanguageId::Dart => "Dart",
        LanguageId::Php => "PHP",
        LanguageId::Ruby => "Ruby",
        LanguageId::Twig => "Twig",
        LanguageId::AnsiSql
        | LanguageId::PostgreSql
        | LanguageId::MySql
        | LanguageId::Sqlite
        | LanguageId::TSql
        | LanguageId::DbMigration => "SQL",
        LanguageId::Prisma => "Prisma",
        LanguageId::GraphQl => "GraphQL",
        LanguageId::Cypher => "Cypher",
        LanguageId::Aice => "AICE",
        LanguageId::PlainText => "PlainText",
    }
}
