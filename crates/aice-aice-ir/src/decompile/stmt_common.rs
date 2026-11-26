use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::cst_util::named_children;
use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::ir::TranspileOpts;
use crate::ir_code::Stmt;

pub(crate) fn decompile_block(node: Node<'_>, src: &str, lang: LanguageId, opts: &TranspileOpts) -> Vec<Stmt> {
    let mut env = DecompEnv::new(src, lang, opts);
    env.tasks.push(DTask::Block(node));
    env.run();
    env.blocks.pop().unwrap_or_default()
}

pub(crate) fn find_body_node<'a>(node: Node<'a>) -> Option<Node<'a>> {
    node.child_by_field_name("body")
        .or_else(|| node.child_by_field_name("consequence"))
        .or_else(|| named_children(node).into_iter().find(|c| {
            matches!(
                c.kind(),
                "statement_block" | "block" | "compound_statement" | "statements"
                    | "body_statement" | "control_structure_body" | "statement_list" | "then"
            )
        }))
}
