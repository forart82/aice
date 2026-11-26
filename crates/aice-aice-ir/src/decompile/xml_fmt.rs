use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::{child_by_kind, named_children, node_span, node_text, strip_quotes};
use crate::decompile::trivia::{clean_comment, collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia, TriviaComment, TriviaKind};
use crate::ir_domain::{DataDecl, DataFormatKind, DataNode};

pub(crate) fn decompile_xml_root(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Xml, "xml");
    let mut prolog = Vec::new();
    let mut nodes = Vec::new();
    let mut root_tr = Trivia::default();
    if root.kind() == "extSubset" {
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) { continue; }
            let tr = collect_trivia(ch, src, opts);
            let raw = node_text(ch, src).trim().to_string();
            let kind = ch.kind().trim_end_matches("Decl").trim_end_matches("decl").to_lowercase();
            let name = child_by_kind(ch, "Name").map(|n| node_text(n, src).trim().to_string()).unwrap_or_else(|| "dtd".into());
            nodes.push(DataNode::DtdDecl { kind, name, spec: raw, trivia: tr });
        }
    } else {
        for ch in named_children(root) {
            if is_comment_kind(ch.kind()) {
                if opts.preserve_docs {
                    let txt = clean_comment(node_text(ch, src));
                    if !txt.is_empty() { root_tr.leading.push(TriviaComment { kind: TriviaKind::Line, text: txt }); }
                }
                continue;
            }
            match ch.kind() {
                "prolog" => {
                    for pc in named_children(ch) {
                        if is_comment_kind(pc.kind()) {
                            if opts.preserve_docs {
                                let txt = clean_comment(node_text(pc, src));
                                if !txt.is_empty() { root_tr.leading.push(TriviaComment { kind: TriviaKind::Line, text: txt }); }
                            }
                            continue;
                        }
                        let t = node_text(pc, src).trim();
                        if !t.is_empty() { prolog.push(t.to_string()); }
                    }
                }
                "element" => nodes.push(decompile_xml_elem(ch, src, opts)),
                _ => {}
            }
        }
    }
    m.items.push(AiceItem::Data(DataDecl {
        format: DataFormatKind::Xml, prolog, root: nodes, trivia: root_tr, span: node_span(root),
    }));
    Ok(m)
}

fn decompile_xml_elem(root: Node<'_>, src: &str, opts: &TranspileOpts) -> DataNode {
    enum XTask<'a> {
        Enter(Node<'a>),
        Finish { tag: String, attrs: Vec<(String, String)>, text: Option<String>, len: usize, trivia: Trivia },
    }
    let mut tasks = vec![XTask::Enter(root)];
    let mut out: Vec<DataNode> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            XTask::Enter(node) => {
                let tr = collect_trivia(node, src, opts);
                let tag_node = child_by_kind(node, "STag").or_else(|| child_by_kind(node, "EmptyElemTag"));
                let tag = tag_node.and_then(|tn| child_by_kind(tn, "Name"))
                    .map(|n| node_text(n, src).trim().to_string())
                    .unwrap_or_else(|| "elem".into());
                let mut attrs = Vec::new();
                if let Some(tn) = tag_node {
                    for ch in named_children(tn) {
                        if ch.kind() == "Attribute" {
                            let k = child_by_kind(ch, "Name").map(|n| node_text(n, src).trim().to_string()).unwrap_or_default();
                            let v = child_by_kind(ch, "AttValue").map(|n| strip_quotes(node_text(n, src))).unwrap_or_default();
                            if !k.is_empty() { attrs.push((k, v)); }
                        }
                    }
                }
                let mut child_elems = Vec::new();
                let mut text = None;
                if let Some(content) = child_by_kind(node, "content") {
                    for ch in named_children(content) {
                        if is_comment_kind(ch.kind()) { continue; }
                        match ch.kind() {
                            "element" => child_elems.push(ch),
                            "CharData" | "CDSect" => {
                                let txt = node_text(ch, src).trim();
                                if !txt.is_empty() { text = Some(txt.to_string()); }
                            }
                            _ => {}
                        }
                    }
                }
                tasks.push(XTask::Finish { tag, attrs, text, len: child_elems.len(), trivia: tr });
                for ch in child_elems.into_iter().rev() {
                    tasks.push(XTask::Enter(ch));
                }
            }
            XTask::Finish { tag, attrs, text, len, trivia } => {
                let children = out.split_off(out.len() - len);
                out.push(DataNode::XmlElem {
                    tag, attrs, text: if children.is_empty() { text } else { None }, children, trivia,
                });
            }
        }
    }
    out.pop().expect("xml elem")
}
