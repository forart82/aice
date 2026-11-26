use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{named_children, node_span, node_text, strip_quotes, with_ts_root};
use crate::decompile::data_yaml::decompile_yaml;
use crate::decompile::trivia::{clean_comment, collect_trivia, is_comment_kind};
use crate::decompile::xml_fmt::decompile_xml_root;
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia};
use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar};

enum DTask<'a> {
    JsonPair(Node<'a>),
    JsonVal(Option<String>, Node<'a>, Trivia),
    TomlPair(Node<'a>, Trivia),
    TomlVal(Option<String>, Node<'a>, Trivia),
    FinishMap { key: Option<String>, len: usize, trivia: Trivia },
    FinishSeq { key: Option<String>, len: usize, trivia: Trivia },
}

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    with_ts_root(tree, |root| match lang {
        LanguageId::Xml => decompile_xml_root(root, src, opts),
        LanguageId::Json => decompile_json(root, src, opts),
        LanguageId::Yaml => decompile_yaml(root, src, opts),
        _ => decompile_toml(root, src, opts),
    })
}

fn decompile_json(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Json, "json");
    let mut nodes = Vec::new();
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        match ch.kind() {
            "object" => {
                for p in named_children(ch) {
                    if p.kind() == "pair" { nodes.push(run_data_task(DTask::JsonPair(p), src, opts)); }
                }
            }
            _ => nodes.push(run_data_task(DTask::JsonVal(None, ch, Trivia::default()), src, opts)),
        }
    }
    m.items.push(AiceItem::Data(DataDecl {
        format: DataFormatKind::Json, prolog: Vec::new(), root: nodes, trivia: Trivia::default(), span: node_span(root),
    }));
    Ok(m)
}

fn decompile_toml(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Toml, "toml");
    let mut nodes = Vec::new();
    for ch in named_children(root) {
        if is_comment_kind(ch.kind()) { continue; }
        let tr = collect_trivia(ch, src, opts);
        match ch.kind() {
            "pair" => nodes.push(run_data_task(DTask::TomlPair(ch, tr), src, opts)),
            "table" | "table_array_element" => {
                let is_arr = ch.kind() == "table_array_element";
                let mut kids = named_children(ch);
                let path = kids.first().map(|k| node_text(*k, src).trim().to_string()).unwrap_or_else(|| "table".into());
                let entries = kids.drain(1..).filter(|c| c.kind() == "pair")
                    .map(|p| run_data_task(DTask::TomlPair(p, collect_trivia(p, src, opts)), src, opts))
                    .collect();
                nodes.push(DataNode::TableSection { path, is_array_table: is_arr, entries, trivia: tr });
            }
            _ => {}
        }
    }
    m.items.push(AiceItem::Data(DataDecl {
        format: DataFormatKind::Toml, prolog: Vec::new(), root: nodes, trivia: Trivia::default(), span: node_span(root),
    }));
    Ok(m)
}

fn run_data_task<'a>(init: DTask<'a>, src: &str, opts: &TranspileOpts) -> DataNode {
    let mut tasks = vec![init];
    let mut out: Vec<DataNode> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            DTask::JsonPair(p) => {
                let tr = collect_trivia(p, src, opts);
                let key = p.child_by_field_name("key").map(|k| strip_quotes(node_text(k, src))).unwrap_or_default();
                if let Some(v) = p.child_by_field_name("value") {
                    tasks.push(DTask::JsonVal(Some(key), v, tr));
                } else {
                    out.push(DataNode::Scalar { key: Some(key), val: DataScalar::Null, anchor: None, tag: None, trivia: tr });
                }
            }
            DTask::JsonVal(key, node, tr) => {
                let raw = node_text(node, src).trim();
                match node.kind() {
                    "object" => {
                        let pairs: Vec<_> = named_children(node).into_iter().filter(|c| c.kind() == "pair").collect();
                        tasks.push(DTask::FinishMap { key, len: pairs.len(), trivia: tr });
                        for c in pairs.into_iter().rev() { tasks.push(DTask::JsonPair(c)); }
                    }
                    "array" => {
                        let items: Vec<_> = named_children(node).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                        tasks.push(DTask::FinishSeq { key, len: items.len(), trivia: tr });
                        for c in items.into_iter().rev() { tasks.push(DTask::JsonVal(None, c, Trivia::default())); }
                    }
                    _ => {
                        let val = match node.kind() {
                            "string" => DataScalar::Str(strip_quotes(raw)),
                            "number" => if raw.contains('.') || raw.contains('e') || raw.contains('E') { DataScalar::Float(raw.into()) } else { DataScalar::Int(raw.into()) },
                            "true" => DataScalar::Bool(true),
                            "false" => DataScalar::Bool(false),
                            "null" => DataScalar::Null,
                            _ => DataScalar::Raw(raw.into()),
                        };
                        out.push(DataNode::Scalar { key, val, anchor: None, tag: None, trivia: tr });
                    }
                }
            }
            DTask::TomlPair(p, mut tr) => {
                let mut kv = Vec::new();
                for ch in named_children(p) {
                    if is_comment_kind(ch.kind()) {
                        if opts.preserve_docs && tr.trailing.is_none() {
                            let txt = clean_comment(node_text(ch, src));
                            if !txt.is_empty() { tr.trailing = Some(txt); }
                        }
                    } else { kv.push(ch); }
                }
                let key = kv.first().map(|k| strip_quotes(node_text(*k, src))).unwrap_or_default();
                if let Some(&v) = kv.get(1) {
                    tasks.push(DTask::TomlVal(Some(key), v, tr));
                } else {
                    out.push(DataNode::Scalar { key: Some(key), val: DataScalar::Null, anchor: None, tag: None, trivia: tr });
                }
            }
            DTask::TomlVal(key, v, tr) => {
                let raw = node_text(v, src).trim();
                match v.kind() {
                    "inline_table" => {
                        let pairs: Vec<_> = named_children(v).into_iter().filter(|c| c.kind() == "pair").collect();
                        tasks.push(DTask::FinishMap { key, len: pairs.len(), trivia: tr });
                        for c in pairs.into_iter().rev() { tasks.push(DTask::TomlPair(c, Trivia::default())); }
                    }
                    "array" => {
                        let items: Vec<_> = named_children(v).into_iter().filter(|c| !is_comment_kind(c.kind())).collect();
                        tasks.push(DTask::FinishSeq { key, len: items.len(), trivia: tr });
                        for c in items.into_iter().rev() { tasks.push(DTask::TomlVal(None, c, Trivia::default())); }
                    }
                    _ => {
                        let val = match v.kind() {
                            "string" => DataScalar::Str(strip_quotes(raw)),
                            "integer" => DataScalar::Int(raw.into()),
                            "float" => DataScalar::Float(raw.into()),
                            "boolean" => DataScalar::Bool(raw == "true"),
                            _ => DataScalar::Raw(raw.into()),
                        };
                        out.push(DataNode::Scalar { key, val, anchor: None, tag: None, trivia: tr });
                    }
                }
            }
            DTask::FinishMap { key, len, trivia } => {
                let entries = out.split_off(out.len() - len);
                out.push(DataNode::Map { key, entries, trivia });
            }
            DTask::FinishSeq { key, len, trivia } => {
                let items = out.split_off(out.len() - len);
                out.push(DataNode::Seq { key, items, trivia });
            }
        }
    }
    out.pop().unwrap_or(DataNode::Scalar { key: None, val: DataScalar::Null, anchor: None, tag: None, trivia: Trivia::default() })
}

pub(crate) fn set_node_trivia(dn: &mut DataNode, tr: Trivia) {
    match dn {
        DataNode::Scalar { trivia, .. } | DataNode::Seq { trivia, .. } | DataNode::Map { trivia, .. }
        | DataNode::TableSection { trivia, .. } | DataNode::XmlElem { trivia, .. } | DataNode::DtdDecl { trivia, .. } => *trivia = tr,
    }
}
