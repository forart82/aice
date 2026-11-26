use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_text, with_ts_root};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts};
use crate::ir_domain_db::{DbQueryDecl, DbQueryKind, DbSchemaDecl, GraphQlField, PrismaField};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    with_ts_root(tree, |root| match lang {
        LanguageId::Prisma => decompile_prisma(root, src, opts),
        LanguageId::GraphQl => decompile_graphql(root, src, opts),
        _ => decompile_cypher(root, src, opts),
    })
}

fn decompile_prisma(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Prisma, "prisma");
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        let tr = collect_trivia(ch, src, opts);
        let kind = match ch.kind() {
            "datasource_declaration" => "datasource",
            "generator_declaration" => "generator",
            "model_declaration" => "model",
            "type_declaration" => "type",
            "view_declaration" => "view",
            "enum_declaration" => "enum",
            _ => continue,
        };
        let name = child_by_kind(ch, "identifier").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "Block".into());
        let mut fields = Vec::new();
        let mut attrs = Vec::new();
        if let Some(blk) = child_by_kind(ch, "statement_block").or_else(|| child_by_kind(ch, "enum_block")) {
            for item in named_children(blk) {
                if is_comment_kind(item.kind()) { continue; }
                match item.kind() {
                    "column_declaration" => {
                        let ftr = collect_trivia(item, src, opts);
                        let fname = child_by_kind(item, "identifier").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "f".into());
                        let ftype = child_by_kind(item, "column_type").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "String".into());
                        let fattrs = named_children(item).into_iter().filter(|c| c.kind() == "attribute").map(|c| node_text(c, src).trim().into()).collect();
                        fields.push(PrismaField { name: fname, field_type: ftype, attrs: fattrs, trivia: ftr });
                    }
                    "assignment_expression" => {
                        let ftr = collect_trivia(item, src, opts);
                        let kids = named_children(item);
                        if kids.len() >= 2 {
                            fields.push(PrismaField {
                                name: node_text(kids[0], src).trim().into(),
                                field_type: node_text(kids[1], src).trim().into(),
                                attrs: Vec::new(), trivia: ftr,
                            });
                        }
                    }
                    "block_attribute_declaration" => attrs.push(node_text(item, src).trim().into()),
                    "enumeral" => fields.push(PrismaField { name: node_text(item, src).trim().into(), field_type: "".into(), attrs: Vec::new(), trivia: collect_trivia(item, src, opts) }),
                    _ => {}
                }
            }
        }
        m.items.push(AiceItem::DbSchema(DbSchemaDecl::PrismaBlock {
            kind: kind.into(), name, fields, attrs, trivia: tr,
        }));
    }
    Ok(m)
}

fn decompile_graphql(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::GraphQl, "graphql");
    let doc = child_by_kind(root, "document").unwrap_or(root);
    for def in named_children(doc) {
        let mut inner = def;
        while matches!(
            inner.kind(),
            "definition" | "type_system_definition" | "type_definition" | "executable_definition" | "type_system_extension"
        ) {
            let Some(next) = named_children(inner).into_iter().next() else { break; };
            inner = next;
        }
        if is_comment_kind(inner.kind()) { continue; }
        let tr = collect_trivia(inner, src, opts);
        if inner.kind() == "operation_definition" {
            let op_type = child_by_kind(inner, "operation_type").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "query".into());
            let name = child_by_kind(inner, "name").map(|n| node_text(n, src).trim().into());
            let body = node_text(inner, src).trim().to_string();
            m.items.push(AiceItem::DbQuery(DbQueryDecl {
                dialect: LanguageId::GraphQl, kind: DbQueryKind::GraphQlOp, name,
                ctes: Vec::new(), clauses: vec![(op_type, body)], trivia: tr,
            }));
        } else {
            let raw_kind = inner.kind().trim_end_matches("_definition").replace("_type", "");
            let kind = if raw_kind == "input_object" { "input".to_string() } else { raw_kind };
            let name = child_by_kind(inner, "name").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "Type".into());
            let mut fields = Vec::new();
            if let Some(fdef) = child_by_kind(inner, "fields_definition").or_else(|| child_by_kind(inner, "input_fields_definition")) {
                for f in named_children(fdef) {
                    if matches!(f.kind(), "field_definition" | "input_value_definition") {
                        let ftr = collect_trivia(f, src, opts);
                        let fnm = child_by_kind(f, "name").map(|n| node_text(n, src).trim().into()).unwrap_or_else(|| "f".into());
                        let args = child_by_kind(f, "arguments_definition")
                            .map(|a| named_children(a).into_iter().map(|c| node_text(c, src).trim().into()).collect())
                            .unwrap_or_default();
                        let fty = named_children(f).into_iter().find(|c| c.kind().contains("type"))
                            .map(|c| node_text(c, src).trim().into()).unwrap_or_else(|| "String".into());
                        fields.push(GraphQlField { name: fnm, args, field_type: fty, directives: Vec::new(), children: Vec::new(), trivia: ftr });
                    }
                }
            } else if let Some(edef) = child_by_kind(inner, "enum_values_definition") {
                for ev in named_children(edef) {
                    if is_comment_kind(ev.kind()) { continue; }
                    let ftr = collect_trivia(ev, src, opts);
                    let vnm = child_by_kind(ev, "enum_value")
                        .and_then(|v| child_by_kind(v, "name"))
                        .or_else(|| child_by_kind(ev, "name"))
                        .map(|n| node_text(n, src).trim().to_string())
                        .unwrap_or_else(|| node_text(ev, src).trim().to_string());
                    if !vnm.is_empty() {
                        fields.push(GraphQlField { name: vnm, args: Vec::new(), field_type: String::new(), directives: Vec::new(), children: Vec::new(), trivia: ftr });
                    }
                }
            }
            let mut implements = Vec::new();
            if let Some(imp) = child_by_kind(inner, "implements_interfaces") {
                collect_gql_implements(imp, src, &mut implements);
            }
            m.items.push(AiceItem::DbSchema(DbSchemaDecl::GraphQlType {
                kind, name, implements, directives: Vec::new(), fields, trivia: tr,
            }));
        }
    }
    Ok(m)
}

fn collect_gql_implements(root: Node<'_>, src: &str, out: &mut Vec<String>) {
    let mut stack: Vec<Node<'_>> = named_children(root)
        .into_iter()
        .rev()
        .filter(|c| !is_comment_kind(c.kind()))
        .collect();
    while let Some(n) = stack.pop() {
        if n.kind() == "implements_interfaces" {
            for ch in named_children(n).into_iter().rev() {
                if !is_comment_kind(ch.kind()) { stack.push(ch); }
            }
        } else {
            let t = node_text(n, src).trim();
            if !t.is_empty() { out.push(t.to_string()); }
        }
    }
}

fn decompile_cypher(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Cypher, "cypher");
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        let tr = collect_trivia(ch, src, opts);
        let mut clauses = Vec::new();
        collect_cypher_clauses(ch, src, &mut clauses);
        if clauses.is_empty() {
            let raw = node_text(ch, src).trim().trim_end_matches(';').trim().to_string();
            if !raw.is_empty() { clauses.push(("cypher".into(), raw)); }
        }
        m.items.push(AiceItem::DbQuery(DbQueryDecl {
            dialect: LanguageId::Cypher, kind: DbQueryKind::Cypher, name: None,
            ctes: Vec::new(), clauses, trivia: tr,
        }));
    }
    Ok(m)
}

fn collect_cypher_clauses(root: Node<'_>, src: &str, out: &mut Vec<(String, String)>) {
    let mut stack = vec![root];
    while let Some(node) = stack.pop() {
        if node.kind().ends_with("_clause") {
            let kw = node.kind().trim_end_matches("_clause").to_ascii_uppercase();
            out.push((kw, node_text(node, src).trim().to_string()));
            continue;
        }
        for ch in named_children(node).into_iter().rev() {
            stack.push(ch);
        }
    }
}
