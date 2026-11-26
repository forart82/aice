use aice_lang_registry::LanguageId;

use crate::compile::emit_ctx::CommentStyle;
use crate::compile::expr_emit::assign_native;
use crate::compile::iter_emit::{CTask, EvalState};
use crate::compile::iter_stmt_match::step_brace_match_task;
use crate::compile::type_map::emit_type;
use crate::ir_code::{Expr, RecordEntry, Stmt};

pub(crate) fn step_stmt_task<'a>(
    task: CTask<'a>,
    lang: LanguageId,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    let semi = if matches!(lang, LanguageId::Go | LanguageId::Kotlin) { "" } else { ";" };
    let ec = st.ctxs.last_mut().expect("active EmitCtx");
    match task {
        CTask::BracePush => ec.push(),
        CTask::BracePop => ec.pop(),
        CTask::BraceTrivia(tr) => ec.emit_trivia(tr, CommentStyle::Slash),
        CTask::BraceLine(s) => ec.line(s),
        CTask::BraceOwnedLine(s) => ec.line(&s),
        CTask::BraceStmts { stmts, tail } => {
            let last_idx = stmts.len().saturating_sub(1);
            for (idx, item) in stmts.iter().enumerate().rev() {
                tasks.push(CTask::BraceStmt { st: item, tail: tail && idx == last_idx });
            }
        }
        CTask::BraceStmt { st: stmt, tail } => push_brace_stmt(stmt, lang, semi, tail, st, tasks),
        CTask::BraceLet { name, is_mut, ty } => {
            let rhs = st.vals.pop().unwrap();
            let line = match lang {
                LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
                    let kw = if is_mut { "let" } else { "const" };
                    let t = if lang != LanguageId::JavaScript { ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default() } else { String::new() };
                    format!("{kw} {name}{t} = {rhs}{semi}")
                }
                LanguageId::Rust => format!("{} {name}{} = {rhs};", if is_mut { "let mut" } else { "let" }, ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()),
                LanguageId::Go => format!("{name} := {rhs}"),
                LanguageId::Kotlin => format!("{} {name}{} = {rhs}", if is_mut { "var" } else { "val" }, ty.map(|x| format!(": {}", emit_type(x, lang))).unwrap_or_default()),
                LanguageId::Php => format!("{} = {rhs};", if name.starts_with('$') { name.to_string() } else { format!("${name}") }),
                _ => format!("{} {name} = {rhs};", ty.map(|x| emit_type(x, lang)).unwrap_or_else(|| "var".into())),
            };
            ec.line(&line);
        }
        CTask::BraceDestructure { names, is_mut } => {
            let rhs = st.vals.pop().unwrap();
            let kw = if is_mut { "let" } else { "const" };
            ec.line(&format!("{kw} [{}] = {rhs}{semi}", names.join(", ")));
        }
        CTask::BraceAssign(op) => {
            let r = st.vals.pop().unwrap();
            let l = st.vals.pop().unwrap();
            ec.line(&format!("{l} {} {r}{semi}", assign_native(op, lang)));
        }
        CTask::BraceGoReturn(n) => {
            let start = st.vals.len() - n;
            let vs: Vec<String> = st.vals.drain(start..).collect();
            ec.line(&format!("return {}", vs.join(", ")));
        }
        CTask::BraceReturn { as_tail } => {
            let e = st.vals.pop().unwrap();
            if as_tail && lang == LanguageId::Rust { ec.line(&e); } else { ec.line(&format!("return {e}{semi}")); }
        }
        CTask::BraceExprStmt { as_tail } => {
            let s = st.vals.pop().unwrap();
            if as_tail && lang == LanguageId::Rust { ec.line(&s); } else { ec.line(&format!("{s}{semi}")); }
        }
        CTask::BraceIfHdr => {
            let c = st.vals.pop().unwrap();
            ec.line(&if matches!(lang, LanguageId::Rust | LanguageId::Go) { format!("if {c} {{") } else { format!("if ({c}) {{") });
        }
        CTask::BraceElifHdr => {
            let c = st.vals.pop().unwrap();
            ec.line(&if matches!(lang, LanguageId::Rust | LanguageId::Go) { format!("}} else if {c} {{") } else { format!("}} else if ({c}) {{") });
        }
        CTask::BraceWhileHdr => {
            let c = st.vals.pop().unwrap();
            let hdr = match lang { LanguageId::Go => format!("for {c} {{"), LanguageId::Rust => format!("while {c} {{"), _ => format!("while ({c}) {{") };
            ec.line(&hdr);
        }
        CTask::BraceForHdr(binding) => {
            let it = st.vals.pop().unwrap();
            let hdr = match lang {
                LanguageId::Rust => format!("for {binding} in {it} {{"),
                LanguageId::Go => format!("for _, {binding} := range {it} {{"),
                LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => format!("for (const {binding} of {it}) {{"),
                LanguageId::CSharp => format!("foreach (var {binding} in {it}) {{"),
                LanguageId::Java => format!("for (var {binding} : {it}) {{"),
                LanguageId::Dart => format!("for (var {binding} in {it}) {{"),
                LanguageId::Kotlin => format!("for ({binding} in {it}) {{"),
                LanguageId::Php => format!("foreach ({it} as ${binding}) {{"),
                _ => format!("for (auto& {binding} : {it}) {{"),
            };
            ec.line(&hdr);
        }
        CTask::BraceThrow => { let e = st.vals.pop().unwrap(); ec.line(&format!("throw {e}{semi}")); }
        CTask::BraceMatchStmt { .. } | CTask::BraceRustArmHdr(_) | CTask::BraceRustArmExpr(_)
        | CTask::BraceKtArmHdr(_) | CTask::BraceKtArmExpr(_) | CTask::BraceCaseHdr(_)
        | CTask::BraceMatchIfArm { .. } => step_brace_match_task(task, lang, st, tasks, semi),
        _ => unreachable!(),
    }
}

fn push_brace_stmt<'a>(stmt: &'a Stmt, lang: LanguageId, semi: &str, as_tail: bool, st: &mut EvalState, tasks: &mut Vec<CTask<'a>>) {
    let ec = st.ctxs.last_mut().unwrap();
    match stmt {
        Stmt::Pass => {}
        Stmt::Comment(tr) => ec.emit_trivia(tr, CommentStyle::Slash),
        Stmt::Let { name, is_mut, ty, init, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceLet { name, is_mut: *is_mut, ty: ty.as_ref() });
            tasks.push(CTask::EvalExpr(init));
        }
        Stmt::Destructure { names, is_mut, init, trivia, .. } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceDestructure { names, is_mut: *is_mut });
            tasks.push(CTask::EvalExpr(init));
        }
        Stmt::Assign { target, op, value, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceAssign(*op));
            tasks.push(CTask::EvalExpr(value));
            tasks.push(CTask::EvalExpr(target));
        }
        Stmt::Return { value, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            match value {
                Some(Expr::Record(entries)) if lang == LanguageId::Go && !entries.is_empty() && entries.iter().all(|e| matches!(e, RecordEntry::Field { key: None, .. })) => {
                    let vals_ex: Vec<&Expr> = entries.iter().filter_map(|e| match e { RecordEntry::Field { value, .. } => Some(value), _ => None }).collect();
                    tasks.push(CTask::BraceGoReturn(vals_ex.len()));
                    for ex in vals_ex.into_iter().rev() { tasks.push(CTask::EvalExpr(ex)); }
                }
                Some(e) => { tasks.push(CTask::BraceReturn { as_tail }); tasks.push(CTask::EvalExpr(e)); }
                None => ec.line(&format!("return{semi}")),
            }
        }
        Stmt::Expr { expr, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceExprStmt { as_tail });
            tasks.push(CTask::EvalExpr(expr));
        }
        Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceLine("}"));
            if let Some(eb) = else_body {
                tasks.push(CTask::BracePop); tasks.push(CTask::BraceStmts { stmts: eb, tail: false });
                tasks.push(CTask::BracePush); tasks.push(CTask::BraceLine("} else {")); tasks.push(CTask::BraceTrivia(else_trivia));
            }
            for (idx, (c, b)) in elifs.iter().enumerate().rev() {
                tasks.push(CTask::BracePop); tasks.push(CTask::BraceStmts { stmts: b, tail: false });
                tasks.push(CTask::BracePush); tasks.push(CTask::BraceElifHdr); tasks.push(CTask::EvalExpr(c));
                if let Some(etr) = elif_trivias.get(idx) { tasks.push(CTask::BraceTrivia(etr)); }
            }
            tasks.push(CTask::BracePop); tasks.push(CTask::BraceStmts { stmts: then_body, tail: false });
            tasks.push(CTask::BracePush); tasks.push(CTask::BraceIfHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::While { cond, body, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
            tasks.push(CTask::BraceStmts { stmts: body, tail: false }); tasks.push(CTask::BracePush);
            tasks.push(CTask::BraceWhileHdr); tasks.push(CTask::EvalExpr(cond));
        }
        Stmt::Loop { body, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            let hdr = match lang { LanguageId::Rust => "loop {", LanguageId::Go => "for {", _ => "while (true) {" };
            ec.line(hdr); ec.push();
            tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
            tasks.push(CTask::BraceStmts { stmts: body, tail: false });
        }
        Stmt::For { binding, iter, body, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
            tasks.push(CTask::BraceStmts { stmts: body, tail: false }); tasks.push(CTask::BracePush);
            tasks.push(CTask::BraceForHdr(binding)); tasks.push(CTask::EvalExpr(iter));
        }
        Stmt::Try { try_body, catches, finally_body, finally_trivia, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            if matches!(lang, LanguageId::Rust | LanguageId::Go) {
                if let Some(fb) = finally_body {
                    tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                    tasks.push(CTask::BraceStmts { stmts: fb, tail: false }); tasks.push(CTask::BracePush);
                    tasks.push(CTask::BraceLine("{ // finally")); tasks.push(CTask::BraceTrivia(finally_trivia));
                }
                tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                tasks.push(CTask::BraceStmts { stmts: try_body, tail: false });
                ec.line("{ // try"); ec.push();
                return;
            }
            if let Some(fb) = finally_body {
                if lang == LanguageId::Cpp {
                    tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                    tasks.push(CTask::BraceStmts { stmts: fb, tail: false }); tasks.push(CTask::BracePush);
                    tasks.push(CTask::BraceLine("{ // finally")); tasks.push(CTask::BraceTrivia(finally_trivia));
                    tasks.push(CTask::BraceLine("}"));
                } else {
                    tasks.push(CTask::BraceLine("}")); tasks.push(CTask::BracePop);
                    tasks.push(CTask::BraceStmts { stmts: fb, tail: false }); tasks.push(CTask::BracePush);
                    tasks.push(CTask::BraceLine("} finally {")); tasks.push(CTask::BraceTrivia(finally_trivia));
                }
            } else { tasks.push(CTask::BraceLine("}")); }
            if lang == LanguageId::Cpp && catches.is_empty() {
                tasks.push(CTask::BracePop); tasks.push(CTask::BraceLine("throw;"));
                tasks.push(CTask::BracePush); tasks.push(CTask::BraceLine("} catch (...) {"));
            }
            for cc in catches.iter().rev() {
                let is_all = cc.param.as_deref() == Some("...") || (cc.param.is_none() && cc.ty.is_none());
                let p_raw = cc.param.as_deref().filter(|s| *s != "...");
                let p = p_raw.and_then(|s| s.split(',').next()).map(str::trim).filter(|s| !s.is_empty()).unwrap_or("e");
                let hdr = match lang {
                    LanguageId::Kotlin => format!("}} catch ({p}: Exception) {{"),
                    LanguageId::CSharp | LanguageId::Java => format!("}} catch ({} {p}) {{", cc.ty.as_ref().map(|x| emit_type(x, lang)).unwrap_or_else(|| "Exception".into())),
                    LanguageId::Cpp if is_all => "} catch (...) {".into(),
                    LanguageId::Cpp => format!("}} catch ({} {p}) {{", cc.ty.as_ref().map(|x| emit_type(x, lang)).unwrap_or_else(|| "const std::exception&".into())),
                    LanguageId::Dart => match (cc.ty.as_ref().map(|x| emit_type(x, lang)), p_raw) {
                        (Some(t), Some(pr)) => format!("}} on {t} catch ({pr}) {{"),
                        (Some(t), None) => format!("}} on {t} {{"),
                        (None, Some(pr)) => format!("}} catch ({pr}) {{"),
                        (None, None) => "} catch (e) {".into(),
                    },
                    _ => format!("}} catch ({p}) {{"),
                };
                tasks.push(CTask::BracePop); tasks.push(CTask::BraceStmts { stmts: &cc.body, tail: false });
                tasks.push(CTask::BracePush); tasks.push(CTask::BraceOwnedLine(hdr));
            }
            ec.line("try {"); ec.push();
            tasks.push(CTask::BracePop); tasks.push(CTask::BraceStmts { stmts: try_body, tail: false });
        }
        Stmt::Throw { expr, trivia } => { ec.emit_trivia(trivia, CommentStyle::Slash); tasks.push(CTask::BraceThrow); tasks.push(CTask::EvalExpr(expr)); }
        Stmt::Break { trivia, .. } => { ec.emit_trivia(trivia, CommentStyle::Slash); ec.line(&format!("break{semi}")); }
        Stmt::Continue { trivia, .. } => { ec.emit_trivia(trivia, CommentStyle::Slash); ec.line(&format!("continue{semi}")); }
        Stmt::Match { target, cases, trivia } => {
            ec.emit_trivia(trivia, CommentStyle::Slash);
            tasks.push(CTask::BraceMatchStmt { target, cases });
            tasks.push(CTask::EvalExpr(target));
        }
    }
}
