use std::cell::RefCell;

use aice_lang_registry::{LanguageId, ParseError, ParsedTree};
use tree_sitter::Parser;
use tree_sitter_language::LanguageFn;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GrammarSlot {
    Json,
    Yaml,
    Toml,
    Markdown,
    MarkdownInline,
    Html,
    Css,
    Xml,
    Dtd,
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
    PhpOnly,
    Ruby,
    Sql,
    Prisma,
    GraphQl,
    Cypher,
}

pub const ALL_GRAMMAR_SLOTS: [GrammarSlot; 29] = [
    GrammarSlot::Json,
    GrammarSlot::Yaml,
    GrammarSlot::Toml,
    GrammarSlot::Markdown,
    GrammarSlot::MarkdownInline,
    GrammarSlot::Html,
    GrammarSlot::Css,
    GrammarSlot::Xml,
    GrammarSlot::Dtd,
    GrammarSlot::Bash,
    GrammarSlot::Rust,
    GrammarSlot::TypeScript,
    GrammarSlot::Tsx,
    GrammarSlot::JavaScript,
    GrammarSlot::Python,
    GrammarSlot::Go,
    GrammarSlot::C,
    GrammarSlot::Cpp,
    GrammarSlot::CSharp,
    GrammarSlot::Java,
    GrammarSlot::Kotlin,
    GrammarSlot::Dart,
    GrammarSlot::Php,
    GrammarSlot::PhpOnly,
    GrammarSlot::Ruby,
    GrammarSlot::Sql,
    GrammarSlot::Prisma,
    GrammarSlot::GraphQl,
    GrammarSlot::Cypher,
];

impl GrammarSlot {
    pub fn index(self) -> usize {
        ALL_GRAMMAR_SLOTS
            .iter()
            .position(|&s| s == self)
            .unwrap_or(0)
    }

    pub fn name(self) -> &'static str {
        match self {
            Self::Json => "json",
            Self::Yaml => "yaml",
            Self::Toml => "toml",
            Self::Markdown => "markdown",
            Self::MarkdownInline => "markdown_inline",
            Self::Html => "html",
            Self::Css => "css",
            Self::Xml => "xml",
            Self::Dtd => "dtd",
            Self::Bash => "bash",
            Self::Rust => "rust",
            Self::TypeScript => "typescript",
            Self::Tsx => "tsx",
            Self::JavaScript => "javascript",
            Self::Python => "python",
            Self::Go => "go",
            Self::C => "c",
            Self::Cpp => "cpp",
            Self::CSharp => "c_sharp",
            Self::Java => "java",
            Self::Kotlin => "kotlin",
            Self::Dart => "dart",
            Self::Php => "php",
            Self::PhpOnly => "php_only",
            Self::Ruby => "ruby",
            Self::Sql => "sql",
            Self::Prisma => "prisma",
            Self::GraphQl => "graphql",
            Self::Cypher => "cypher",
        }
    }

    pub fn language_fn(self) -> LanguageFn {
        match self {
            Self::Json => tree_sitter_json::LANGUAGE,
            Self::Yaml => tree_sitter_yaml::LANGUAGE,
            Self::Toml => tree_sitter_toml_ng::LANGUAGE,
            Self::Markdown => tree_sitter_md::LANGUAGE,
            Self::MarkdownInline => tree_sitter_md::INLINE_LANGUAGE,
            Self::Html => tree_sitter_html::LANGUAGE,
            Self::Css => tree_sitter_css::LANGUAGE,
            Self::Xml => tree_sitter_xml::LANGUAGE_XML,
            Self::Dtd => tree_sitter_xml::LANGUAGE_DTD,
            Self::Bash => tree_sitter_bash::LANGUAGE,
            Self::Rust => tree_sitter_rust::LANGUAGE,
            Self::TypeScript => tree_sitter_typescript::LANGUAGE_TYPESCRIPT,
            Self::Tsx => tree_sitter_typescript::LANGUAGE_TSX,
            Self::JavaScript => tree_sitter_javascript::LANGUAGE,
            Self::Python => tree_sitter_python::LANGUAGE,
            Self::Go => tree_sitter_go::LANGUAGE,
            Self::C => tree_sitter_c::LANGUAGE,
            Self::Cpp => tree_sitter_cpp::LANGUAGE,
            Self::CSharp => tree_sitter_c_sharp::LANGUAGE,
            Self::Java => tree_sitter_java::LANGUAGE,
            Self::Kotlin => tree_sitter_kotlin_ng::LANGUAGE,
            Self::Dart => tree_sitter_dart::LANGUAGE,
            Self::Php => tree_sitter_php::LANGUAGE_PHP,
            Self::PhpOnly => tree_sitter_php::LANGUAGE_PHP_ONLY,
            Self::Ruby => tree_sitter_ruby::LANGUAGE,
            Self::Sql => tree_sitter_sequel::LANGUAGE,
            Self::Prisma => tree_sitter_prisma_io::LANGUAGE,
            Self::GraphQl => tree_sitter_graphql::LANGUAGE,
            Self::Cypher => tree_sitter_cypher::LANGUAGE,
        }
    }
}

pub fn slot_for_language(lang: LanguageId) -> Option<GrammarSlot> {
    match lang {
        LanguageId::Json => Some(GrammarSlot::Json),
        LanguageId::Yaml => Some(GrammarSlot::Yaml),
        LanguageId::Toml => Some(GrammarSlot::Toml),
        LanguageId::Markdown => Some(GrammarSlot::Markdown),
        LanguageId::Html => Some(GrammarSlot::Html),
        LanguageId::Css => Some(GrammarSlot::Css),
        LanguageId::Xml => Some(GrammarSlot::Xml),
        LanguageId::Bash => Some(GrammarSlot::Bash),
        LanguageId::Rust => Some(GrammarSlot::Rust),
        LanguageId::TypeScript => Some(GrammarSlot::TypeScript),
        LanguageId::Tsx => Some(GrammarSlot::Tsx),
        LanguageId::JavaScript => Some(GrammarSlot::JavaScript),
        LanguageId::Python => Some(GrammarSlot::Python),
        LanguageId::Go => Some(GrammarSlot::Go),
        LanguageId::C => Some(GrammarSlot::C),
        LanguageId::Cpp => Some(GrammarSlot::Cpp),
        LanguageId::CSharp => Some(GrammarSlot::CSharp),
        LanguageId::Java => Some(GrammarSlot::Java),
        LanguageId::Kotlin => Some(GrammarSlot::Kotlin),
        LanguageId::Dart => Some(GrammarSlot::Dart),
        LanguageId::Php => Some(GrammarSlot::Php),
        LanguageId::Ruby => Some(GrammarSlot::Ruby),
        LanguageId::AnsiSql
        | LanguageId::PostgreSql
        | LanguageId::MySql
        | LanguageId::Sqlite => Some(GrammarSlot::Sql),
        LanguageId::Prisma => Some(GrammarSlot::Prisma),
        LanguageId::GraphQl => Some(GrammarSlot::GraphQl),
        LanguageId::Cypher => Some(GrammarSlot::Cypher),
        LanguageId::Twig
        | LanguageId::TSql
        | LanguageId::DbMigration
        | LanguageId::Aice
        | LanguageId::PlainText => None,
    }
}

pub struct ParserPool {
    parsers: [Option<Parser>; 29],
}

impl Default for ParserPool {
    fn default() -> Self {
        Self::new()
    }
}

impl ParserPool {
    pub fn new() -> Self {
        Self {
            parsers: std::array::from_fn(|_| None),
        }
    }

    pub fn parse_slot(
        &mut self,
        slot: GrammarSlot,
        src: &str,
    ) -> Result<tree_sitter::Tree, ParseError> {
        self.parse_slot_with_old(slot, src, None)
    }

    pub fn parse_slot_with_old(
        &mut self,
        slot: GrammarSlot,
        src: &str,
        old_tree: Option<&tree_sitter::Tree>,
    ) -> Result<tree_sitter::Tree, ParseError> {
        let idx = slot.index();
        if self.parsers[idx].is_none() {
            let mut parser = Parser::new();
            let language: tree_sitter::Language = slot.language_fn().into();
            parser.set_language(&language).map_err(|e| ParseError {
                message: format!("Failed to load grammar {}: {e}", slot.name()),
                line: 1,
                column: 1,
            })?;
            self.parsers[idx] = Some(parser);
        }
        let parser = self.parsers[idx].as_mut().expect("parser initialized");
        parser.parse(src, old_tree).ok_or_else(|| ParseError {
            message: format!("tree-sitter returned None for grammar {}", slot.name()),
            line: 1,
            column: 1,
        })
    }
    pub fn parse_lang(&mut self, lang: LanguageId, src: &str) -> Result<ParsedTree, ParseError> {
        let slot = slot_for_language(lang).ok_or_else(|| ParseError {
            message: format!("No tree-sitter grammar for {}", lang.canonical_name()),
            line: 1,
            column: 1,
        })?;
        let tree = self.parse_slot(slot, src)?;
        Ok(ParsedTree::from_tree_sitter(lang, tree))
    }

    pub fn parse_dtd(&mut self, src: &str) -> Result<ParsedTree, ParseError> {
        let tree = self.parse_slot(GrammarSlot::Dtd, src)?;
        Ok(ParsedTree::from_tree_sitter(LanguageId::Xml, tree))
    }

    pub fn parse_php_only(&mut self, src: &str) -> Result<ParsedTree, ParseError> {
        let tree = self.parse_slot(GrammarSlot::PhpOnly, src)?;
        Ok(ParsedTree::from_tree_sitter(LanguageId::Php, tree))
    }
}

thread_local! {
    static THREAD_POOL: RefCell<ParserPool> = RefCell::new(ParserPool::new());
}

pub fn with_parser_pool<F, R>(f: F) -> R
where
    F: FnOnce(&mut ParserPool) -> R,
{
    THREAD_POOL.with(|cell| f(&mut cell.borrow_mut()))
}

pub fn parse_slot(slot: GrammarSlot, src: &str) -> Result<tree_sitter::Tree, ParseError> {
    with_parser_pool(|pool| pool.parse_slot(slot, src))
}

pub fn parse_tree_sitter(lang: LanguageId, src: &str) -> Result<ParsedTree, ParseError> {
    with_parser_pool(|pool| pool.parse_lang(lang, src))
}

pub fn parse_dtd(src: &str) -> Result<ParsedTree, ParseError> {
    with_parser_pool(|pool| pool.parse_dtd(src))
}

pub fn parse_php_only(src: &str) -> Result<ParsedTree, ParseError> {
    with_parser_pool(|pool| pool.parse_php_only(src))
}
