use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{named_children, node_span, node_text, strip_quotes};
use crate::decompile::data_fmt::set_node_trivia;
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia};
use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar};

enum YTask<'a> {
    Node(Option<String>, Node<'a>, Trivia),
    FinishMap { key: Option<String>, len: usize, anchor: Option<String>, trivia: Trivia },
    FinishSeq { key: Option<String>, len: usize, anchor: Option<String>, trivia: Trivia },
}

pub(crate) fn decompile_yaml(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Yaml, "yaml");
    let mut nodes = Vec::new();
    for doc in named_children(root) {
        if doc.kind() == "document" {
            for ch in named_children(doc) {
                if !is_comment_kind(ch.kind()) {
                    nodes.push(yaml_node_iter(ch, src, opts));
                }
            }
        } else if !is_comment_kind(doc.kind()) {
            nodes.push(yaml_node_iter(doc, src, opts));
        }
    }
    let flat = if nodes.len() == 1 && matches!(nodes[0], DataNode::Map { key: None, anchor: None, .. }) {
        if let DataNode::Map { entries, .. } = &mut nodes[0] {
            std::mem::take(entries)
        } else {
            nodes
        }
    } else {
        nodes
    };
    m.items.push(AiceItem::Data(DataDecl {
        format: DataFormatKind::Yaml,
        prolog: Vec::new(),
        root: flat,
        trivia: Trivia::default(),
        span: node_span(root),
    }));
    Ok(m)
}

fn unwrap_yaml_wrapper<'a>(mut node: Node<'a>, src: &str) -> (Option<Node<'a>>, Option<String>) {
    let mut anchor: Option<String> = None;
    loop {
        if !matches!(node.kind(), "block_node" | "flow_node") {
            return (Some(node), anchor);
        }
        let mut next = None;
        for c in named_children(node) {
            if c.kind() == "anchor" && anchor.is_none() {
                let a = node_text(c, src).trim().trim_start_matches('&').trim();
                if !a.is_empty() { anchor = Some(a.to_string()); }
            } else if next.is_none() && !matches!(c.kind(), "anchor" | "tag" | "comment") {
                next = Some(c);
            }
        }
        let Some(n) = next else { return (None, anchor); };
        node = n;
    }
}

fn yaml_node_iter(root: Node<'_>, src: &str, opts: &TranspileOpts) -> DataNode {
    let mut tasks = vec![YTask::Node(None, root, Trivia::default())];
    let mut out: Vec<DataNode> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            YTask::Node(key, raw_node, tr) => {
                let (inner_opt, anchor) = unwrap_yaml_wrapper(raw_node, src);
                let Some(node) = inner_opt else {
                    out.push(DataNode::Scalar {
                        key, val: DataScalar::Null, anchor, tag: None, trivia: tr,
                    });
                    continue;
                };
                match node.kind() {
                    "block_mapping" | "flow_mapping" => {
                        let pairs: Vec<_> = named_children(node)
                            .into_iter()
                            .filter(|p| matches!(p.kind(), "block_mapping_pair" | "flow_pair"))
                            .collect();
                        tasks.push(YTask::FinishMap { key, len: pairs.len(), anchor, trivia: tr });
                        for p in pairs.into_iter().rev() {
                            let ptr = collect_trivia(p, src, opts);
                            let k = p.child_by_field_name("key")
                                .map(|n| strip_quotes(node_text(n, src)))
                                .unwrap_or_default();
                            if let Some(v) = p.child_by_field_name("value") {
                                tasks.push(YTask::Node(Some(k), v, ptr));
                            } else {
                                out.push(DataNode::Scalar {
                                    key: Some(k), val: DataScalar::Null, anchor: None, tag: None, trivia: ptr,
                                });
                            }
                        }
                    }
                    "block_sequence" | "flow_sequence" => {
                        let items: Vec<_> = named_children(node)
                            .into_iter()
                            .filter(|c| !is_comment_kind(c.kind()))
                            .collect();
                        tasks.push(YTask::FinishSeq { key, len: items.len(), anchor, trivia: tr });
                        for it in items.into_iter().rev() {
                            let inner = if it.kind() == "block_sequence_item" {
                                named_children(it).into_iter().find(|c| !is_comment_kind(c.kind()))
                            } else {
                                Some(it)
                            };
                            if let Some(n) = inner {
                                tasks.push(YTask::Node(None, n, Trivia::default()));
                            } else {
                                out.push(DataNode::Scalar {
                                    key: None, val: DataScalar::Null, anchor: None, tag: None, trivia: Trivia::default(),
                                });
                            }
                        }
                    }
                    _ => {
                        let raw = node_text(node, src).trim();
                        let val = match raw {
                            "true" | "True" => DataScalar::Bool(true),
                            "false" | "False" => DataScalar::Bool(false),
                            "null" | "~" => DataScalar::Null,
                            _ if raw.starts_with('"') || raw.starts_with('\'') => DataScalar::Str(strip_quotes(raw)),
                            _ if raw.parse::<i64>().is_ok() => DataScalar::Int(raw.into()),
                            _ if raw.parse::<f64>().is_ok() => DataScalar::Float(raw.into()),
                            _ => DataScalar::Str(raw.into()),
                        };
                        out.push(DataNode::Scalar { key, val, anchor, tag: None, trivia: tr });
                    }
                }
            }
            YTask::FinishMap { key, len, anchor, trivia } => {
                let entries = out.split_off(out.len() - len);
                let mut dn = DataNode::Map { key, entries, anchor, trivia: Trivia::default() };
                set_node_trivia(&mut dn, trivia);
                out.push(dn);
            }
            YTask::FinishSeq { key, len, anchor, trivia } => {
                let items = out.split_off(out.len() - len);
                let mut dn = DataNode::Seq { key, items, anchor, trivia: Trivia::default() };
                set_node_trivia(&mut dn, trivia);
                out.push(dn);
            }
        }
    }
    out.pop().unwrap_or(DataNode::Scalar {
        key: None, val: DataScalar::Null, anchor: None, tag: None, trivia: Trivia::default(),
    })
}
