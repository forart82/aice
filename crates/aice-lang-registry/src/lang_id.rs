#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum LanguageFamily {
    DataFormat,
    Markup,
    Shell,
    Systems,
    Scripting,
    JvmMobile,
    Database,
    Query,
    AiceIr,
    PlainText,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash, PartialOrd, Ord)]
pub enum LanguageId {
    // R5 (22) + Twig
    Json,
    Yaml,
    Toml,
    Markdown,
    Html,
    Css,
    Xml,
    Bash,
    Rust,
    TypeScript,
    Tsx,
    JavaScript,
    Python,
    Go,
    C,
    Cpp,
    CSharp,
    Java,
    Kotlin,
    Dart,
    Php,
    Ruby,
    Twig,
    // R6 (9 DB / Query dialects)
    AnsiSql,
    PostgreSql,
    MySql,
    Sqlite,
    TSql,
    Prisma,
    GraphQl,
    Cypher,
    DbMigration,
    // Native AICE IR & PlainText fallback
    Aice,
    PlainText,
}

impl LanguageId {
    pub fn canonical_name(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Yaml => "yaml",
            Self::Toml => "toml",
            Self::Markdown => "markdown",
            Self::Html => "html",
            Self::Css => "css",
            Self::Xml => "xml",
            Self::Bash => "bash",
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Python => "python",
            Self::Go => "go",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::CSharp => "csharp",
            Self::Java => "java",
            Self::Kotlin => "kotlin",
            Self::Dart => "dart",
            Self::Php => "php",
            Self::Ruby => "ruby",
            Self::Twig => "twig",
            Self::AnsiSql => "sql",
            Self::PostgreSql => "postgresql",
            Self::MySql => "mysql",
            Self::Sqlite => "sqlite",
            Self::TSql => "tsql",
            Self::Prisma => "prisma",
            Self::GraphQl => "graphql",
            Self::Cypher => "cypher",
            Self::DbMigration => "migration",
            Self::Aice => "aice",
            Self::PlainText => "plaintext",
        }
    }

    pub fn family(self) -> LanguageFamily {
        match self {
            Self::Json | Self::Yaml | Self::Toml | Self::Xml => LanguageFamily::DataFormat,
            Self::Markdown | Self::Html | Self::Css | Self::Twig => LanguageFamily::Markup,
            Self::Bash => LanguageFamily::Shell,
            Self::Rust | Self::C | Self::Cpp | Self::CSharp | Self::Go => LanguageFamily::Systems,
            Self::TypeScript | Self::Tsx | Self::JavaScript | Self::Python | Self::Php | Self::Ruby => {
                LanguageFamily::Scripting
            }
            Self::Java | Self::Kotlin | Self::Dart => LanguageFamily::JvmMobile,
            Self::AnsiSql | Self::PostgreSql | Self::MySql | Self::Sqlite | Self::TSql | Self::DbMigration => {
                LanguageFamily::Database
            }
            Self::Prisma | Self::GraphQl | Self::Cypher => LanguageFamily::Query,
            Self::Aice => LanguageFamily::AiceIr,
            Self::PlainText => LanguageFamily::PlainText,
        }
    }

    pub fn supports_aice_transpile(self) -> bool {
        self != Self::PlainText
    }
}
