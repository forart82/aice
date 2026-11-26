use aice_lang_registry::LanguageId;
use tree_sitter::Node;

use crate::decompile::iter_env::{DTask, DecompEnv};
use crate::ir::TranspileOpts;
use crate::ir_code::Expr;

pub(crate) fn decompile_expr(node: Node<'_>, src: &str, lang: LanguageId) -> Expr {
    let opts = TranspileOpts::default();
    let mut env = DecompEnv::new(src, lang, &opts);
    env.tasks.push(DTask::Expr(node));
    env.run();
    env.exprs.pop().unwrap_or_else(|| Expr::Ident(String::new()))
}
