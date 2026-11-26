use aice_lang_registry::{LanguageId, ParsedTree, RdNode};

use crate::decompile::twig_scan::{ElemBuilder, GapToken, flush_elem_to_parent, scan_gap};
use crate::ir::{AiceItem, AiceModule, Span, TranspileError, TranspileOpts, Trivia, Visibility};
use crate::ir_domain::{ComponentDecl, LayoutNode, TemplateCtrlKind};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let ParsedTree::Rd(rd) = tree else {
        return Err(TranspileError::new("Expected Rd ParsedTree for Twig"));
    };
    let mut m = AiceModule::new(LanguageId::Twig, "twig");
    let layout = walk_twig_iter(&rd.root, src, opts);
    m.items.push(AiceItem::Component(ComponentDecl {
        vis: Visibility::Public, name: "Template".into(), type_params: Vec::new(), params: Vec::new(),
        has_doctype: false, body_stmts: Vec::new(), layout, trivia: Trivia::default(), span: Span::new(1, 1, 0, src.len()),
    }));
    Ok(m)
}

struct TwigFrame<'a> {
    node: &'a RdNode,
    children_sorted: Vec<&'a RdNode>,
    idx: usize,
    inner_end: usize,
    cursor: usize,
    cur_nodes: Vec<LayoutNode>,
    branches: Vec<(String, Vec<LayoutNode>)>,
    active_branch: Option<(String, Vec<LayoutNode>)>,
    html_stack: Vec<ElemBuilder>,
}

fn new_twig_frame<'a>(node: &'a RdNode, src: &str, is_root: bool) -> TwigFrame<'a> {
    let (inner_start, inner_end) = if is_root {
        (0usize, src.len())
    } else {
        let s = find_tag_close(src, node.start_byte);
        let e = find_last_tag_open(src, s, node.end_byte);
        (s, e)
    };
    let mut children_sorted: Vec<&RdNode> = node.children.iter().collect();
    children_sorted.sort_by_key(|c| c.start_byte);
    TwigFrame {
        node, children_sorted, idx: 0, inner_end, cursor: inner_start,
        cur_nodes: Vec::new(), branches: Vec::new(), active_branch: None, html_stack: Vec::new(),
    }
}

fn walk_twig_iter(root: &RdNode, src: &str, opts: &TranspileOpts) -> Vec<LayoutNode> {
    let mut stack = vec![new_twig_frame(root, src, true)];
    loop {
        let next_child = {
            let f = stack.last_mut().expect("twig frame");
            if f.idx < f.children_sorted.len() {
                let ch = f.children_sorted[f.idx];
                f.idx += 1;
                if ch.start_byte > f.cursor {
                    process_gap(src, f.cursor, ch.start_byte, &mut f.html_stack, &mut f.active_branch, &mut f.branches, &mut f.cur_nodes, opts);
                }
                f.cursor = ch.end_byte.max(f.cursor);
                Some(ch)
            } else {
                None
            }
        };
        if let Some(ch) = next_child {
            let f = stack.last_mut().expect("twig frame");
            match ch.kind.as_str() {
                "twig_comment" => {
                    if opts.preserve_docs {
                        let raw = src.get(ch.start_byte..ch.end_byte.min(src.len())).unwrap_or("");
                        let txt = raw.trim_start_matches("{#").trim_end_matches("#}").trim().to_string();
                        push_layout_node(LayoutNode::Comment(txt), &mut f.html_stack, &mut f.active_branch, &mut f.cur_nodes);
                    }
                }
                "twig_output" => {
                    let raw = src.get(ch.start_byte..ch.end_byte.min(src.len())).unwrap_or("");
                    let inner = raw.trim_start_matches("{{").trim_start_matches('-').trim_end_matches("}}").trim_end_matches('-').trim();
                    if let Some(top) = f.html_stack.last_mut() && top.children.is_empty() {
                        top.text_buf.push_str(&format!("{{{{ {inner} }}}}"));
                    } else {
                        push_layout_node(
                            LayoutNode::TemplateCtrl {
                                kind: TemplateCtrlKind::ExprOut, arg: inner.into(),
                                children: Vec::new(), branches: Vec::new(), trivia: Trivia::default(),
                            },
                            &mut f.html_stack, &mut f.active_branch, &mut f.cur_nodes,
                        );
                    }
                }
                "twig_tag" => {
                    let lbl = ch.label.as_deref().unwrap_or("");
                    let (kind, arg) = classify_twig_tag(lbl);
                    push_layout_node(
                        LayoutNode::TemplateCtrl { kind, arg, children: Vec::new(), branches: Vec::new(), trivia: Trivia::default() },
                        &mut f.html_stack, &mut f.active_branch, &mut f.cur_nodes,
                    );
                }
                "twig_verbatim" => {
                    let vs = find_tag_close(src, ch.start_byte);
                    let ve = find_last_tag_open(src, vs, ch.end_byte);
                    let body = src.get(vs..ve).unwrap_or("").to_string();
                    push_layout_node(
                        LayoutNode::TemplateCtrl {
                            kind: TemplateCtrlKind::Verbatim, arg: body,
                            children: Vec::new(), branches: Vec::new(), trivia: Trivia::default(),
                        },
                        &mut f.html_stack, &mut f.active_branch, &mut f.cur_nodes,
                    );
                }
                _ => stack.push(new_twig_frame(ch, src, false)),
            }
            continue;
        }
        let mut finished = stack.pop().expect("twig frame");
        if finished.inner_end > finished.cursor {
            process_gap(
                src, finished.cursor, finished.inner_end, &mut finished.html_stack,
                &mut finished.active_branch, &mut finished.branches, &mut finished.cur_nodes, opts,
            );
        }
        while let Some(elem) = finished.html_stack.pop() {
            let tgt = finished.active_branch.as_mut().map(|(_, v)| v).unwrap_or(&mut finished.cur_nodes);
            flush_elem_to_parent(elem, &mut finished.html_stack, tgt);
        }
        if let Some(ab) = finished.active_branch.take() {
            finished.branches.push(ab);
        }
        if let Some(parent) = stack.last_mut() {
            let lbl = finished.node.label.as_deref().unwrap_or("");
            let (kind, arg) = match finished.node.kind.as_str() {
                "twig_if" => (TemplateCtrlKind::If, lbl.to_string()),
                "twig_for" => (TemplateCtrlKind::For, lbl.to_string()),
                "twig_block" => (TemplateCtrlKind::Block, lbl.strip_prefix("block:").unwrap_or(lbl).to_string()),
                "twig_macro" => (TemplateCtrlKind::Macro, lbl.strip_prefix("macro:").unwrap_or(lbl).to_string()),
                "twig_set_block" => (TemplateCtrlKind::Set, lbl.strip_prefix("set:").unwrap_or(lbl).to_string()),
                _ => (TemplateCtrlKind::RawTag, finished.node.kind.clone()),
            };
            push_layout_node(
                LayoutNode::TemplateCtrl {
                    kind, arg, children: finished.cur_nodes, branches: finished.branches, trivia: Trivia::default(),
                },
                &mut parent.html_stack, &mut parent.active_branch, &mut parent.cur_nodes,
            );
        } else {
            return finished.cur_nodes;
        }
    }
}

fn push_layout_node(
    nd: LayoutNode,
    html_stack: &mut [ElemBuilder],
    active_branch: &mut Option<(String, Vec<LayoutNode>)>,
    cur_nodes: &mut Vec<LayoutNode>,
) {
    if let Some(top) = html_stack.last_mut() { top.children.push(nd); }
    else if let Some((_, bvec)) = active_branch.as_mut() { bvec.push(nd); }
    else { cur_nodes.push(nd); }
}

#[allow(clippy::too_many_arguments)]
fn process_gap(
    src: &str, s: usize, e: usize, html_stack: &mut Vec<ElemBuilder>,
    active_branch: &mut Option<(String, Vec<LayoutNode>)>, branches: &mut Vec<(String, Vec<LayoutNode>)>,
    cur_nodes: &mut Vec<LayoutNode>, opts: &TranspileOpts,
) {
    for tok in scan_gap(src, s, e) {
        match tok {
            GapToken::ElseIf(cond) => {
                while let Some(elem) = html_stack.pop() {
                    let tgt = active_branch.as_mut().map(|(_, v)| v).unwrap_or(cur_nodes);
                    flush_elem_to_parent(elem, html_stack, tgt);
                }
                if let Some(prev) = active_branch.take() { branches.push(prev); }
                *active_branch = Some((cond, Vec::new()));
            }
            GapToken::Else => {
                while let Some(elem) = html_stack.pop() {
                    let tgt = active_branch.as_mut().map(|(_, v)| v).unwrap_or(cur_nodes);
                    flush_elem_to_parent(elem, html_stack, tgt);
                }
                if let Some(prev) = active_branch.take() { branches.push(prev); }
                *active_branch = Some(("else".into(), Vec::new()));
            }
            GapToken::Comment(txt) => {
                if opts.preserve_docs {
                    push_layout_node(LayoutNode::Comment(txt), html_stack, active_branch, cur_nodes);
                }
            }
            GapToken::OpenTag { tag, attrs, self_close } => {
                let eb = ElemBuilder { tag, attrs, children: Vec::new(), text_buf: String::new() };
                if self_close {
                    let tgt = active_branch.as_mut().map(|(_, v)| v).unwrap_or(cur_nodes);
                    flush_elem_to_parent(eb, html_stack, tgt);
                } else {
                    html_stack.push(eb);
                }
            }
            GapToken::CloseTag => {
                if let Some(elem) = html_stack.pop() {
                    let tgt = active_branch.as_mut().map(|(_, v)| v).unwrap_or(cur_nodes);
                    flush_elem_to_parent(elem, html_stack, tgt);
                }
            }
            GapToken::Text(t) => {
                if let Some(top) = html_stack.last_mut() {
                    top.text_buf.push_str(t);
                } else {
                    let trimmed = t.trim();
                    if !trimmed.is_empty() {
                        push_layout_node(
                            LayoutNode::Element {
                                tag: "#text".into(), attrs: Vec::new(), text: Some(trimmed.to_string()),
                                child_expr: None, children: Vec::new(), trivia: Trivia::default(),
                            },
                            html_stack, active_branch, cur_nodes,
                        );
                    }
                }
            }
        }
    }
}

fn classify_twig_tag(lbl: &str) -> (TemplateCtrlKind, String) {
    if let Some(rest) = lbl.strip_prefix("extends ") { (TemplateCtrlKind::Extends, rest.trim_matches('"').trim_matches('\'').into()) }
    else if let Some(rest) = lbl.strip_prefix("include ") { (TemplateCtrlKind::Include, rest.trim_matches('"').trim_matches('\'').into()) }
    else if let Some(rest) = lbl.strip_prefix("block:") { (TemplateCtrlKind::Block, rest.into()) }
    else if let Some(rest) = lbl.strip_prefix("set ") { (TemplateCtrlKind::Set, rest.into()) }
    else { (TemplateCtrlKind::RawTag, lbl.into()) }
}

fn find_tag_close(src: &str, start: usize) -> usize {
    src.get(start.min(src.len())..).and_then(|s| s.find("%}")).map(|o| start + o + 2).unwrap_or(start)
}

fn find_last_tag_open(src: &str, min_pos: usize, end: usize) -> usize {
    let hi = end.min(src.len());
    let lo = min_pos.min(hi);
    src.get(lo..hi).and_then(|s| s.rfind("{%")).map(|o| lo + o).unwrap_or(hi)
}
