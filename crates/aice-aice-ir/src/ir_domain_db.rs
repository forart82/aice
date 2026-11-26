use aice_lang_registry::LanguageId;

use crate::ir::{AiceItem, Trivia};

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbColumn {
    pub name: String,
    pub sql_type: String,
    pub constraints: Vec<String>,
    pub default: Option<String>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct PrismaField {
    pub name: String,
    pub field_type: String,
    pub attrs: Vec<String>,
    pub trivia: Trivia,
}

#[derive(Debug, PartialEq, Eq)]
pub struct GraphQlField {
    pub name: String,
    pub args: Vec<String>,
    pub field_type: String,
    pub directives: Vec<String>,
    pub children: Vec<GraphQlField>,
    pub trivia: Trivia,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum DbSchemaDecl {
    Table {
        name: String,
        if_not_exists: bool,
        columns: Vec<DbColumn>,
        constraints: Vec<String>,
        options: Vec<String>,
        trivia: Trivia,
    },
    View {
        name: String,
        materialized: bool,
        query_sql: String,
        trivia: Trivia,
    },
    Index {
        name: String,
        unique: bool,
        table: String,
        cols: Vec<String>,
        trivia: Trivia,
    },
    Procedure {
        dialect: LanguageId,
        is_fn: bool,
        name: String,
        params: Vec<String>,
        returns: Option<String>,
        lang_tag: Option<String>,
        declares: Vec<String>,
        body_lines: Vec<String>,
        trivia: Trivia,
    },
    Trigger {
        name: String,
        timing: String,
        events: Vec<String>,
        table: String,
        for_each: Option<String>,
        body_lines: Vec<String>,
        trivia: Trivia,
    },
    TypeDef {
        name: String,
        is_enum: bool,
        members: Vec<String>,
        trivia: Trivia,
    },
    PrismaBlock {
        kind: String,
        name: String,
        fields: Vec<PrismaField>,
        attrs: Vec<String>,
        trivia: Trivia,
    },
    GraphQlType {
        kind: String,
        name: String,
        implements: Vec<String>,
        directives: Vec<String>,
        fields: Vec<GraphQlField>,
        trivia: Trivia,
    },
    RawDdl {
        text: String,
        trivia: Trivia,
    },
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum DbQueryKind {
    Select,
    Insert,
    Update,
    Delete,
    Pragma,
    DoBlock,
    Exec,
    GraphQlOp,
    Cypher,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct DbQueryDecl {
    pub dialect: LanguageId,
    pub kind: DbQueryKind,
    pub name: Option<String>,
    pub ctes: Vec<(String, String)>,
    pub clauses: Vec<(String, String)>,
    pub trivia: Trivia,
}

#[derive(Debug, PartialEq, Eq)]
pub struct DbMigrationDecl {
    pub tool: String,
    pub sections: Vec<(String, Vec<AiceItem>)>,
    pub trivia: Trivia,
}
