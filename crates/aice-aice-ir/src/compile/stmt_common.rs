use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::EmitCtx;
use crate::compile::expr_emit::ExprEmitCtx;
use crate::ir_code::Stmt;

pub(crate) fn emit_brace_stmts(
    stmts: &[Stmt],
    lang: LanguageId,
    ec: &mut EmitCtx,
    ectx: &ExprEmitCtx,
    tail_return_expr: bool,
) {
    crate::compile::iter_emit::run_brace_stmts(stmts, lang, ec, ectx, tail_return_expr);
}
