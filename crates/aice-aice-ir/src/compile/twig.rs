use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_code::{Expr, LiteralVal};
use crate::ir_domain::{LayoutNode, TemplateCtrlKind};

const VOID_TAGS: &[&str] = &[
    "area", "base", "br", "col", "embed", "hr", "img", "input", "link", "meta", "param", "source", "track", "wbr",
];

pub fn compile(module: &AiceModule) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    let mut ec = EmitCtx::new("  ");
    for it in &module.items {
        if let AiceItem::Component(comp) = it {
            emit_twig_nodes(&mut ec, &comp.layout);
        }
    }
    Ok(ec.out)
}

enum TwigOp<'a> {
    Node(&'a LayoutNode),
    Push,
    Pop,
    Line(&'static str),
    PopLine(String),
    BranchHdr(String),
}

fn emit_twig_nodes(ec: &mut EmitCtx, roots: &[LayoutNode]) {
    let mut tasks: Vec<TwigOp<'_>> = roots.iter().rev().map(TwigOp::Node).collect();
    while let Some(op) = tasks.pop() {
        match op {
            TwigOp::Push => ec.push(),
            TwigOp::Pop => ec.pop(),
            TwigOp::Line(s) => ec.line(s),
            TwigOp::PopLine(s) => { ec.pop(); ec.line(&s); }
            TwigOp::BranchHdr(s) => ec.line(&s),
            TwigOp::Node(node) => step_twig_node(ec, node, &mut tasks),
        }
    }
}

fn step_twig_node<'a>(ec: &mut EmitCtx, node: &'a LayoutNode, tasks: &mut Vec<TwigOp<'a>>) {
    match node {
        LayoutNode::Comment(txt) => ec.line(&format!("{{# {txt} #}}")),
        LayoutNode::Element { tag, attrs, text, children, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::Twig);
            if tag == "#text" {
                if let Some(t) = text { ec.line(t); }
                return;
            }
            let mut attr_s = String::new();
            for a in attrs {
                match &a.value {
                    Some(Expr::Literal(LiteralVal::Str { value, .. })) => attr_s.push_str(&format!(" {}=\"{value}\"", a.name)),
                    Some(ex) => attr_s.push_str(&format!(" {}=\"{:?}\"", a.name, ex)),
                    None => attr_s.push_str(&format!(" {}", a.name)),
                }
            }
            if VOID_TAGS.contains(&tag.as_str()) {
                ec.line(&format!("<{tag}{attr_s} />"));
            } else if let Some(t) = text {
                ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>"));
            } else if children.is_empty() {
                ec.line(&format!("<{tag}{attr_s}></{tag}>"));
            } else {
                ec.line(&format!("<{tag}{attr_s}>"));
                ec.push();
                tasks.push(TwigOp::PopLine(format!("</{tag}>")));
                for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
            }
        }
        LayoutNode::TemplateCtrl { kind, arg, children, branches, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Twig);
            match kind {
                TemplateCtrlKind::ExprOut => ec.line(&format!("{{{{ {arg} }}}}")),
                TemplateCtrlKind::Extends => ec.line(&format!("{{% extends \"{arg}\" %}}")),
                TemplateCtrlKind::Include => ec.line(&format!("{{% include \"{arg}\" %}}")),
                TemplateCtrlKind::Set => {
                    ec.line(&format!("{{% set {arg} %}}"));
                    if !children.is_empty() {
                        ec.push();
                        tasks.push(TwigOp::PopLine("{% endset %}".into()));
                        for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                    }
                }
                TemplateCtrlKind::If => {
                    ec.line(&format!("{{% if {arg} %}}"));
                    tasks.push(TwigOp::Line("{% endif %}"));
                    for (cond, bkids) in branches.iter().rev() {
                        let hdr = if cond == "else" { "{% else %}".into() } else { format!("{{% elseif {cond} %}}") };
                        tasks.push(TwigOp::Pop);
                        for ch in bkids.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                        tasks.push(TwigOp::Push);
                        tasks.push(TwigOp::BranchHdr(hdr));
                    }
                    tasks.push(TwigOp::Pop);
                    for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                    ec.push();
                }
                TemplateCtrlKind::For => {
                    ec.line(&format!("{{% for {arg} %}}"));
                    tasks.push(TwigOp::Line("{% endfor %}"));
                    for (_, bkids) in branches.iter().rev() {
                        tasks.push(TwigOp::Pop);
                        for ch in bkids.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                        tasks.push(TwigOp::Push);
                        tasks.push(TwigOp::Line("{% else %}"));
                    }
                    tasks.push(TwigOp::Pop);
                    for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                    ec.push();
                }
                TemplateCtrlKind::Block => {
                    ec.line(&format!("{{% block {arg} %}}"));
                    ec.push();
                    tasks.push(TwigOp::PopLine("{% endblock %}".into()));
                    for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                }
                TemplateCtrlKind::Macro => {
                    ec.line(&format!("{{% macro {arg} %}}"));
                    ec.push();
                    tasks.push(TwigOp::PopLine("{% endmacro %}".into()));
                    for ch in children.iter().rev() { tasks.push(TwigOp::Node(ch)); }
                }
                TemplateCtrlKind::Verbatim => {
                    ec.line("{% verbatim %}");
                    ec.line(arg);
                    ec.line("{% endverbatim %}");
                }
                _ => ec.line(&format!("{{% {arg} %}}")),
            }
        }
    }
}
