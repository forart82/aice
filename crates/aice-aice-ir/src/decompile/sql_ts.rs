use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, field_text, named_children, node_text, with_ts_root};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia};
use crate::ir_domain_db::{DbColumn, DbQueryDecl, DbQueryKind, DbSchemaDecl};

pub(crate) fn decompile_ansi_sql(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    with_ts_root(tree, |root| {
        let mut m = AiceModule::new(LanguageId::AnsiSql, "sql");
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            collect_sql_node(ch, src, opts, &mut m.items, None);
        }
        Ok(m)
    })
}

fn merge_sql_trivia(mut inner: Trivia, outer: Option<Trivia>) -> Trivia {
    if let Some(o) = outer {
        if inner.leading.is_empty() { inner.leading = o.leading; }
        if inner.trailing.is_none() { inner.trailing = o.trailing; }
    }
    inner
}

fn collect_sql_node(root: Node<'_>, src: &str, opts: &TranspileOpts, items: &mut Vec<AiceItem>, init_outer: Option<Trivia>) {
    let mut stack = vec![(root, init_outer)];
    while let Some((node, outer_tr)) = stack.pop() {
        let tr = merge_sql_trivia(collect_trivia(node, src, opts), outer_tr);
        match node.kind() {
            "statement" | "block" | "transaction" => {
                let kids = named_children(node);
                let has_query = kids.iter().any(|c| matches!(c.kind(), "cte" | "select" | "insert" | "update" | "delete"));
                let has_ddl = kids.iter().any(|c| matches!(c.kind(), "create_table" | "create_view" | "create_materialized_view" | "create_index" | "create_function" | "create_procedure" | "create_trigger" | "create_type"));
                if has_query {
                    let mut ctes = Vec::new();
                    let mut q_kind = DbQueryKind::Select;
                    let mut q_start: Option<usize> = None;
                    let mut q_end = 0usize;
                    for k in kids {
                        if k.kind().starts_with("keyword_") { continue; }
                        if k.kind() == "cte" {
                            let cname = child_by_kind(k, "identifier")
                                .or_else(|| k.child_by_field_name("argument"))
                                .map(|n| node_text(n, src).trim().to_string())
                                .unwrap_or_else(|| "cte".into());
                            let inner = child_by_kind(k, "statement")
                                .or_else(|| k.child_by_field_name("statement"))
                                .map(|s| node_text(s, src).trim().to_string())
                                .unwrap_or_default();
                            ctes.push((cname, inner));
                        } else {
                            if k.kind() == "insert" { q_kind = DbQueryKind::Insert; }
                            else if k.kind() == "update" { q_kind = DbQueryKind::Update; }
                            else if k.kind() == "delete" { q_kind = DbQueryKind::Delete; }
                            if q_start.is_none() { q_start = Some(k.start_byte()); }
                            q_end = k.end_byte();
                        }
                    }
                    if let Some(s) = q_start {
                        let sql = src[s..q_end].trim().trim_end_matches(';').trim().to_string();
                        items.push(AiceItem::DbQuery(DbQueryDecl {
                            dialect: LanguageId::AnsiSql, kind: q_kind, name: None,
                            ctes, clauses: vec![("sql".into(), sql)], trivia: tr,
                        }));
                    }
                } else if has_ddl {
                    let mut outer = Some(tr);
                    let mut next_nodes = Vec::new();
                    for k in kids {
                        if !k.kind().starts_with("keyword_") && !is_comment_kind(k.kind()) {
                            next_nodes.push((k, outer.take()));
                        }
                    }
                    for pair in next_nodes.into_iter().rev() { stack.push(pair); }
                } else {
                    let raw = node_text(node, src).trim().trim_end_matches(';').trim().to_string();
                    if !raw.is_empty() {
                        items.push(AiceItem::DbSchema(DbSchemaDecl::RawDdl { text: raw, trivia: tr }));
                    }
                }
            }
            "create_table" => items.push(AiceItem::DbSchema(extract_create_table(node, src, opts, tr))),
            "create_view" | "create_materialized_view" => {
                let name = child_by_kind(node, "object_reference").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "view".into());
                let q = named_children(node).into_iter().find(|c| matches!(c.kind(), "select" | "create_query" | "statement"))
                    .map(|n| node_text(n, src).trim().to_string()).unwrap_or_default();
                items.push(AiceItem::DbSchema(DbSchemaDecl::View {
                    name, materialized: node.kind() == "create_materialized_view", query_sql: q, trivia: tr,
                }));
            }
            "create_index" => {
                let raw = node_text(node, src).trim().trim_end_matches(';').trim();
                let fields_node = child_by_kind(node, "index_fields");
                let has_where = child_by_kind(node, "where").is_some();
                let has_tail = fields_node.is_some_and(|f| {
                    !src[f.end_byte()..node.end_byte()].trim().trim_end_matches(';').trim().is_empty()
                });
                let head_up = fields_node
                    .map(|f| src[node.start_byte()..f.start_byte()].to_ascii_uppercase())
                    .unwrap_or_default();
                if has_where
                    || has_tail
                    || head_up.contains("USING ")
                    || head_up.contains("CONCURRENTLY")
                    || head_up.contains("IF NOT EXISTS")
                {
                    items.push(AiceItem::DbSchema(DbSchemaDecl::RawDdl { text: raw.to_string(), trivia: tr }));
                } else {
                    let refs: Vec<String> = named_children(node).into_iter()
                        .filter(|c| matches!(c.kind(), "object_reference" | "identifier"))
                        .map(|c| node_text(c, src).trim().to_string()).collect();
                    let name = refs.first().cloned().unwrap_or_else(|| "idx".into());
                    let table = refs.get(1).cloned().unwrap_or_else(|| "tbl".into());
                    let cols = fields_node
                        .map(|f| named_children(f).into_iter().map(|c| node_text(c, src).trim().to_string()).collect())
                        .unwrap_or_default();
                    items.push(AiceItem::DbSchema(DbSchemaDecl::Index {
                        name, unique: raw.to_ascii_uppercase().contains("UNIQUE"), table, cols, trivia: tr,
                    }));
                }
            }
            _ => {
                let raw = node_text(node, src).trim().trim_end_matches(';').trim().to_string();
                if !raw.is_empty() {
                    items.push(AiceItem::DbSchema(DbSchemaDecl::RawDdl { text: raw, trivia: tr }));
                }
            }
        }
    }
}

fn extract_create_table(node: Node<'_>, src: &str, opts: &TranspileOpts, tr: Trivia) -> DbSchemaDecl {
    let raw = node_text(node, src);
    let if_not_exists = raw.to_ascii_uppercase().contains("IF NOT EXISTS");
    let name = child_by_kind(node, "object_reference").map(|n| node_text(n, src).trim().to_string())
        .or_else(|| child_by_kind(node, "identifier").map(|n| node_text(n, src).trim().to_string()))
        .unwrap_or_else(|| "table".into());
    let mut columns = Vec::new();
    let mut constraints = Vec::new();
    if let Some(cdl) = child_by_kind(node, "column_definitions") {
        for ch in named_children(cdl) {
            if ch.kind() == "column_definition" {
                let ctr = collect_trivia(ch, src, opts);
                let cname = field_text(ch, "name", src).unwrap_or("col").trim().to_string();
                let tnode = ch.child_by_field_name("type").or_else(|| ch.child_by_field_name("custom_type"));
                let ctype = tnode.map(|n| node_text(n, src).trim().to_string()).unwrap_or_else(|| "TEXT".into());
                let tail_start = tnode.map(|n| n.end_byte()).unwrap_or(ch.start_byte());
                let tail = src[tail_start..ch.end_byte()].trim();
                let cons = if tail.is_empty() { Vec::new() } else { vec![tail.to_string()] };
                columns.push(DbColumn { name: cname, sql_type: ctype, constraints: cons, default: None, trivia: ctr });
            } else if ch.kind() == "constraints" || ch.kind() == "constraint" {
                constraints.push(node_text(ch, src).trim().to_string());
            }
        }
    }
    DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options: Vec::new(), trivia: tr }
}
