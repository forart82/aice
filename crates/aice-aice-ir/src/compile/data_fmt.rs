use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_domain::{DataDecl, DataNode, DataScalar};
use crate::printer_expr::escape_str;

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    for item in &module.items {
        if let AiceItem::Data(dd) = item {
            return Ok(match target {
                LanguageId::Json => emit_json(dd),
                LanguageId::Yaml => emit_yaml(dd),
                LanguageId::Toml => emit_toml(dd),
                LanguageId::Xml => emit_xml(dd),
                _ => emit_json(dd),
            });
        }
    }
    Ok(module.raw_fallback.clone())
}

trait KeyCheck { fn key_is_none(&self) -> bool; }
impl KeyCheck for DataNode {
    fn key_is_none(&self) -> bool {
        matches!(self, DataNode::Scalar { key: None, .. } | DataNode::Seq { key: None, .. } | DataNode::Map { key: None, .. })
    }
}

enum EmitOp<'a> {
    Json(&'a DataNode, bool),
    Yaml(&'a DataNode, bool),
    Xml(&'a DataNode),
    Push,
    Pop,
    PopLine(String),
}

fn emit_json(dd: &DataDecl) -> String {
    let mut ec = EmitCtx::new("  ");
    let mut tasks = Vec::new();
    if dd.root.len() == 1 && dd.root[0].key_is_none() {
        tasks.push(EmitOp::Json(&dd.root[0], false));
    } else {
        ec.line("{");
        ec.push();
        tasks.push(EmitOp::PopLine("}".into()));
        let len = dd.root.len();
        for (i, n) in dd.root.iter().enumerate().rev() {
            tasks.push(EmitOp::Json(n, i + 1 < len));
        }
    }
    run_data_tasks(&mut ec, tasks);
    ec.out
}

fn run_data_tasks<'a>(ec: &mut EmitCtx, mut tasks: Vec<EmitOp<'a>>) {
    while let Some(op) = tasks.pop() {
        match op {
            EmitOp::Push => ec.push(),
            EmitOp::Pop => ec.pop(),
            EmitOp::PopLine(s) => { ec.pop(); ec.line(&s); }
            EmitOp::Json(node, comma) => {
                let c = if comma { "," } else { "" };
                match node {
                    DataNode::Scalar { key, val, .. } => {
                        let k = key.as_ref().map(|x| format!("\"{}\": ", escape_str(x))).unwrap_or_default();
                        ec.line(&format!("{k}{}{c}", json_scalar(val)));
                    }
                    DataNode::Map { key, entries, .. } => {
                        let k = key.as_ref().map(|x| format!("\"{}\": ", escape_str(x))).unwrap_or_default();
                        ec.line(&format!("{k}{{"));
                        ec.push();
                        tasks.push(EmitOp::PopLine(format!("}}{c}")));
                        for (i, en) in entries.iter().enumerate().rev() { tasks.push(EmitOp::Json(en, i + 1 < entries.len())); }
                    }
                    DataNode::Seq { key, items, .. } => {
                        let k = key.as_ref().map(|x| format!("\"{}\": ", escape_str(x))).unwrap_or_default();
                        ec.line(&format!("{k}["));
                        ec.push();
                        tasks.push(EmitOp::PopLine(format!("]{c}")));
                        for (i, it) in items.iter().enumerate().rev() { tasks.push(EmitOp::Json(it, i + 1 < items.len())); }
                    }
                    _ => {}
                }
            }
            EmitOp::Yaml(node, as_seq) => step_yaml(ec, node, as_seq, &mut tasks),
            EmitOp::Xml(node) => step_xml(ec, node, &mut tasks),
        }
    }
}

fn step_yaml<'a>(ec: &mut EmitCtx, node: &'a DataNode, as_seq: bool, tasks: &mut Vec<EmitOp<'a>>) {
    let dash = if as_seq { "- " } else { "" };
    match node {
        DataNode::Scalar { key, val, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            let v = yaml_scalar(val);
            match key {
                Some(k) => ec.line(&format!("{dash}{k}: {v}")),
                None => ec.line(&format!("- {v}")),
            }
        }
        DataNode::Map { key, entries, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            if let Some(k) = key {
                ec.line(&format!("{dash}{k}:"));
                ec.push();
                tasks.push(EmitOp::Pop);
                for en in entries.iter().rev() { tasks.push(EmitOp::Yaml(en, false)); }
            } else if let Some((first, rest)) = entries.split_first() {
                tasks.push(EmitOp::Pop);
                for en in rest.iter().rev() { tasks.push(EmitOp::Yaml(en, false)); }
                tasks.push(EmitOp::Push);
                tasks.push(EmitOp::Yaml(first, true));
            }
        }
        DataNode::Seq { key, items, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Hash);
            if let Some(k) = key { ec.line(&format!("{dash}{k}:")); }
            ec.push();
            tasks.push(EmitOp::Pop);
            for it in items.iter().rev() { tasks.push(EmitOp::Yaml(it, true)); }
        }
        _ => {}
    }
}

fn step_xml<'a>(ec: &mut EmitCtx, node: &'a DataNode, tasks: &mut Vec<EmitOp<'a>>) {
    match node {
        DataNode::DtdDecl { spec, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::Html);
            ec.line(spec);
        }
        DataNode::XmlElem { tag, attrs, text, children, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Html);
            let mut attr_s = String::new();
            for (k, v) in attrs { attr_s.push_str(&format!(" {k}=\"{v}\"")); }
            if let Some(t) = text { ec.line(&format!("<{tag}{attr_s}>{t}</{tag}>")); }
            else if children.is_empty() { ec.line(&format!("<{tag}{attr_s} />")); }
            else {
                ec.line(&format!("<{tag}{attr_s}>"));
                ec.push();
                tasks.push(EmitOp::PopLine(format!("</{tag}>")));
                for ch in children.iter().rev() { tasks.push(EmitOp::Xml(ch)); }
            }
        }
        _ => {}
    }
}

fn json_scalar(v: &DataScalar) -> String {
    match v {
        DataScalar::Str(s) => format!("\"{}\"", escape_str(s)),
        DataScalar::Int(s) | DataScalar::Float(s) | DataScalar::Raw(s) => s.clone(),
        DataScalar::Bool(b) => if *b { "true".into() } else { "false".into() },
        DataScalar::Null => "null".into(),
    }
}

fn emit_yaml(dd: &DataDecl) -> String {
    let mut ec = EmitCtx::new("  ");
    let tasks: Vec<EmitOp<'_>> = dd.root.iter().rev().map(|n| EmitOp::Yaml(n, false)).collect();
    run_data_tasks(&mut ec, tasks);
    ec.out
}

fn yaml_scalar(v: &DataScalar) -> String {
    match v {
        DataScalar::Str(s) => {
            let needs_q = s.is_empty() || matches!(s.as_str(), "true" | "false" | "null" | "~")
                || s.contains(": ") || s.contains('#') || s.starts_with('-');
            if needs_q { format!("\"{}\"", escape_str(s)) } else { s.clone() }
        }
        DataScalar::Int(s) | DataScalar::Float(s) | DataScalar::Raw(s) => s.clone(),
        DataScalar::Bool(b) => if *b { "true".into() } else { "false".into() },
        DataScalar::Null => "null".into(),
    }
}

fn emit_toml(dd: &DataDecl) -> String {
    let mut ec = EmitCtx::new("  ");
    for n in &dd.root {
        match n {
            DataNode::Scalar { key: Some(k), val, trivia, .. } => {
                ec.emit_trivia(trivia, CommentStyle::Hash);
                ec.line(&format!("{k} = {}", json_scalar(val)));
            }
            DataNode::Map { key: Some(k), entries, trivia } => {
                ec.emit_trivia(trivia, CommentStyle::Hash);
                let inner: Vec<String> = entries.iter().filter_map(toml_kv_pair).collect();
                ec.line(&format!("{k} = {{ {} }}", inner.join(", ")));
            }
            DataNode::Seq { key: Some(k), items, trivia } => {
                ec.emit_trivia(trivia, CommentStyle::Hash);
                let inner: Vec<String> = items.iter().map(toml_node_val).collect();
                ec.line(&format!("{k} = [{}]", inner.join(", ")));
            }
            DataNode::TableSection { path, is_array_table, entries, trivia } => {
                ec.blank();
                ec.emit_trivia(trivia, CommentStyle::Hash);
                if *is_array_table { ec.line(&format!("[[{path}]]")); } else { ec.line(&format!("[{path}]")); }
                for en in entries {
                    if let Some(pair) = toml_kv_pair(en) { ec.line(&pair); }
                }
            }
            _ => {}
        }
    }
    ec.out
}

fn toml_kv_pair(node: &DataNode) -> Option<String> {
    match node {
        DataNode::Scalar { key: Some(k), .. } | DataNode::Map { key: Some(k), .. } | DataNode::Seq { key: Some(k), .. } => {
            Some(format!("{k} = {}", toml_node_val(node)))
        }
        _ => None,
    }
}

fn toml_node_val(root: &DataNode) -> String {
    enum TTask<'a> { Eval(&'a DataNode), JoinSeq(usize), JoinMap(Vec<String>) }
    let mut tasks = vec![TTask::Eval(root)];
    let mut vals: Vec<String> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            TTask::Eval(node) => match node {
                DataNode::Scalar { val, .. } => vals.push(json_scalar(val)),
                DataNode::Seq { items, .. } => {
                    tasks.push(TTask::JoinSeq(items.len()));
                    for it in items.iter().rev() { tasks.push(TTask::Eval(it)); }
                }
                DataNode::Map { entries, .. } => {
                    let mut ks = Vec::new();
                    let mut sub = Vec::new();
                    for en in entries {
                        match en {
                            DataNode::Scalar { key: Some(k), .. } | DataNode::Map { key: Some(k), .. }
                            | DataNode::Seq { key: Some(k), .. } => { ks.push(k.clone()); sub.push(en); }
                            _ => {}
                        }
                    }
                    tasks.push(TTask::JoinMap(ks));
                    for en in sub.into_iter().rev() { tasks.push(TTask::Eval(en)); }
                }
                _ => vals.push("\"\"".into()),
            },
            TTask::JoinSeq(n) => {
                let s = vals.len() - n;
                let ps: Vec<String> = vals.drain(s..).collect();
                vals.push(format!("[{}]", ps.join(", ")));
            }
            TTask::JoinMap(ks) => {
                let s = vals.len() - ks.len();
                let ps: Vec<String> = ks.into_iter().zip(vals.drain(s..)).map(|(k, v)| format!("{k} = {v}")).collect();
                vals.push(format!("{{ {} }}", ps.join(", ")));
            }
        }
    }
    vals.pop().unwrap_or_default()
}

fn emit_xml(dd: &DataDecl) -> String {
    let mut ec = EmitCtx::new("  ");
    for pr in &dd.prolog { ec.line(pr); }
    let tasks: Vec<EmitOp<'_>> = dd.root.iter().rev().map(EmitOp::Xml).collect();
    run_data_tasks(&mut ec, tasks);
    ec.out
}
