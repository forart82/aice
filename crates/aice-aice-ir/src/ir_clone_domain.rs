use crate::ir::{AiceItem, Trivia};
use crate::ir_domain::{
    DataNode, DataScalar, DocBlock, DocSection, LayoutAttr, LayoutNode, StyleDecl, StyleProp,
    TemplateCtrlKind,
};
use crate::ir_domain_db::{DbMigrationDecl, GraphQlField};

impl Clone for LayoutNode {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a LayoutNode),
            Elem {
                tag: String,
                attrs: Vec<LayoutAttr>,
                text: Option<String>,
                child_expr: Option<crate::ir_code::Expr>,
                len: usize,
                trivia: Trivia,
            },
            Ctrl {
                kind: TemplateCtrlKind,
                arg: String,
                clen: usize,
                blabels: Vec<(String, usize)>,
                trivia: Trivia,
            },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut out: Vec<LayoutNode> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(n) => match n {
                    LayoutNode::Comment(s) => out.push(LayoutNode::Comment(s.clone())),
                    LayoutNode::Element { tag, attrs, text, child_expr, children, trivia } => {
                        tasks.push(Task::Elem {
                            tag: tag.clone(),
                            attrs: attrs.clone(),
                            text: text.clone(),
                            child_expr: child_expr.clone(),
                            len: children.len(),
                            trivia: trivia.clone(),
                        });
                        for ch in children.iter().rev() { tasks.push(Task::Enter(ch)); }
                    }
                    LayoutNode::TemplateCtrl { kind, arg, children, branches, trivia } => {
                        let blabels = branches.iter().map(|(l, v)| (l.clone(), v.len())).collect();
                        tasks.push(Task::Ctrl {
                            kind: *kind, arg: arg.clone(), clen: children.len(), blabels, trivia: trivia.clone(),
                        });
                        for (_, br) in branches.iter().rev() {
                            for ch in br.iter().rev() { tasks.push(Task::Enter(ch)); }
                        }
                        for ch in children.iter().rev() { tasks.push(Task::Enter(ch)); }
                    }
                },
                Task::Elem { tag, attrs, text, child_expr, len, trivia } => {
                    let children = out.split_off(out.len() - len);
                    out.push(LayoutNode::Element { tag, attrs, text, child_expr, children, trivia });
                }
                Task::Ctrl { kind, arg, clen, blabels, trivia } => {
                    let mut branches = Vec::with_capacity(blabels.len());
                    for (lbl, n) in blabels.into_iter().rev() {
                        branches.push((lbl, out.split_off(out.len() - n)));
                    }
                    branches.reverse();
                    let children = out.split_off(out.len() - clen);
                    out.push(LayoutNode::TemplateCtrl { kind, arg, children, branches, trivia });
                }
            }
        }
        out.pop().expect("cloned layout")
    }
}

impl Clone for DataNode {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a DataNode),
            Seq { key: Option<String>, len: usize, trivia: Trivia },
            Map { key: Option<String>, len: usize, trivia: Trivia },
            Table { path: String, arr: bool, len: usize, trivia: Trivia },
            Xml { tag: String, attrs: Vec<(String, String)>, text: Option<String>, len: usize, trivia: Trivia },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut out: Vec<DataNode> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(n) => match n {
                    DataNode::Scalar { key, val, anchor, tag, trivia } => {
                        let v = match val {
                            DataScalar::Str(s) => DataScalar::Str(s.clone()),
                            DataScalar::Int(s) => DataScalar::Int(s.clone()),
                            DataScalar::Float(s) => DataScalar::Float(s.clone()),
                            DataScalar::Bool(b) => DataScalar::Bool(*b),
                            DataScalar::Null => DataScalar::Null,
                            DataScalar::Raw(s) => DataScalar::Raw(s.clone()),
                        };
                        out.push(DataNode::Scalar { key: key.clone(), val: v, anchor: anchor.clone(), tag: tag.clone(), trivia: trivia.clone() });
                    }
                    DataNode::DtdDecl { kind, name, spec, trivia } => {
                        out.push(DataNode::DtdDecl { kind: kind.clone(), name: name.clone(), spec: spec.clone(), trivia: trivia.clone() });
                    }
                    DataNode::Seq { key, items, trivia } => {
                        tasks.push(Task::Seq { key: key.clone(), len: items.len(), trivia: trivia.clone() });
                        for it in items.iter().rev() { tasks.push(Task::Enter(it)); }
                    }
                    DataNode::Map { key, entries, trivia } => {
                        tasks.push(Task::Map { key: key.clone(), len: entries.len(), trivia: trivia.clone() });
                        for it in entries.iter().rev() { tasks.push(Task::Enter(it)); }
                    }
                    DataNode::TableSection { path, is_array_table, entries, trivia } => {
                        tasks.push(Task::Table { path: path.clone(), arr: *is_array_table, len: entries.len(), trivia: trivia.clone() });
                        for it in entries.iter().rev() { tasks.push(Task::Enter(it)); }
                    }
                    DataNode::XmlElem { tag, attrs, text, children, trivia } => {
                        tasks.push(Task::Xml { tag: tag.clone(), attrs: attrs.clone(), text: text.clone(), len: children.len(), trivia: trivia.clone() });
                        for it in children.iter().rev() { tasks.push(Task::Enter(it)); }
                    }
                },
                Task::Seq { key, len, trivia } => {
                    let items = out.split_off(out.len() - len);
                    out.push(DataNode::Seq { key, items, trivia });
                }
                Task::Map { key, len, trivia } => {
                    let entries = out.split_off(out.len() - len);
                    out.push(DataNode::Map { key, entries, trivia });
                }
                Task::Table { path, arr, len, trivia } => {
                    let entries = out.split_off(out.len() - len);
                    out.push(DataNode::TableSection { path, is_array_table: arr, entries, trivia });
                }
                Task::Xml { tag, attrs, text, len, trivia } => {
                    let children = out.split_off(out.len() - len);
                    out.push(DataNode::XmlElem { tag, attrs, text, children, trivia });
                }
            }
        }
        out.pop().expect("cloned data")
    }
}

impl Clone for StyleDecl {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a StyleDecl),
            Finish { selector: String, props: Vec<StyleProp>, len: usize, trivia: Trivia, span: crate::ir::Span },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut out: Vec<StyleDecl> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(s) => {
                    tasks.push(Task::Finish {
                        selector: s.selector.clone(), props: s.props.clone(), len: s.children.len(), trivia: s.trivia.clone(), span: s.span,
                    });
                    for ch in s.children.iter().rev() { tasks.push(Task::Enter(ch)); }
                }
                Task::Finish { selector, props, len, trivia, span } => {
                    let children = out.split_off(out.len() - len);
                    out.push(StyleDecl { selector, props, children, trivia, span });
                }
            }
        }
        out.pop().expect("cloned style")
    }
}

impl Clone for DocSection {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a DocSection),
            Finish { level: u8, heading: String, blocks: Vec<DocBlock>, len: usize, trivia: Trivia },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut out: Vec<DocSection> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(d) => {
                    tasks.push(Task::Finish {
                        level: d.level, heading: d.heading.clone(), blocks: d.blocks.clone(), len: d.children.len(), trivia: d.trivia.clone(),
                    });
                    for ch in d.children.iter().rev() { tasks.push(Task::Enter(ch)); }
                }
                Task::Finish { level, heading, blocks, len, trivia } => {
                    let children = out.split_off(out.len() - len);
                    out.push(DocSection { level, heading, blocks, children, trivia });
                }
            }
        }
        out.pop().expect("cloned doc")
    }
}

impl Clone for GraphQlField {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a GraphQlField),
            Finish { name: String, args: Vec<String>, field_type: String, directives: Vec<String>, len: usize, trivia: Trivia },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut out: Vec<GraphQlField> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(g) => {
                    tasks.push(Task::Finish {
                        name: g.name.clone(), args: g.args.clone(), field_type: g.field_type.clone(),
                        directives: g.directives.clone(), len: g.children.len(), trivia: g.trivia.clone(),
                    });
                    for ch in g.children.iter().rev() { tasks.push(Task::Enter(ch)); }
                }
                Task::Finish { name, args, field_type, directives, len, trivia } => {
                    let children = out.split_off(out.len() - len);
                    out.push(GraphQlField { name, args, field_type, directives, children, trivia });
                }
            }
        }
        out.pop().expect("cloned gql")
    }
}

impl Clone for DbMigrationDecl {
    fn clone(&self) -> Self {
        enum Task<'a> {
            Enter(&'a DbMigrationDecl),
            Item(&'a AiceItem),
            Finish { tool: String, sec_lens: Vec<(String, usize)>, trivia: Trivia },
        }
        let mut tasks = vec![Task::Enter(self)];
        let mut items: Vec<AiceItem> = Vec::new();
        let mut migs: Vec<DbMigrationDecl> = Vec::new();
        while let Some(t) = tasks.pop() {
            match t {
                Task::Enter(dm) => {
                    let sec_lens = dm.sections.iter().map(|(s, v)| (s.clone(), v.len())).collect();
                    tasks.push(Task::Finish { tool: dm.tool.clone(), sec_lens, trivia: dm.trivia.clone() });
                    for (_, v) in dm.sections.iter().rev() {
                        for it in v.iter().rev() { tasks.push(Task::Item(it)); }
                    }
                }
                Task::Item(it) => match it {
                    AiceItem::DbMigration(dm) => tasks.push(Task::Enter(dm)),
                    other => items.push(other.clone()),
                },
                Task::Finish { tool, sec_lens, trivia } => {
                    let mut sections = Vec::with_capacity(sec_lens.len());
                    for (s, len) in sec_lens.into_iter().rev() {
                        sections.push((s, items.split_off(items.len() - len)));
                    }
                    sections.reverse();
                    let dm = DbMigrationDecl { tool, sections, trivia };
                    if tasks.is_empty() {
                        migs.push(dm);
                    } else {
                        items.push(AiceItem::DbMigration(dm));
                    }
                }
            }
        }
        migs.pop().expect("cloned db migration")
    }
}
