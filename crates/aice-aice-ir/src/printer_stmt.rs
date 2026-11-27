use aice_lang_registry::LanguageId;

use crate::ir::Trivia;
use crate::ir_code::{FnBody, MatchCase, Stmt};
use crate::printer::{PrintCtx, assign_op_str};
use crate::printer_expr::{print_expr, print_pattern, print_type};

pub(crate) fn print_block_stmts(c: &mut PrintCtx<'_>, init_stmts: &[Stmt], init_d: usize) {
    enum Task<'a> {
        Block(&'a [Stmt], usize),
        Stmt(&'a Stmt, usize),
        Elif(&'a crate::ir_code::Expr, &'a [Stmt], Trivia, usize),
        Else(&'a [Stmt], &'a Trivia, usize),
        MatchArm(&'a MatchCase, usize),
        Line(usize, &'static str, Option<&'a Trivia>),
        Catch(&'a crate::ir_code::CatchClause, usize),
        Finally(&'a [Stmt], &'a Trivia, usize),
    }
    let mut tasks = vec![Task::Block(init_stmts, init_d)];
    while let Some(t) = tasks.pop() {
        match t {
            Task::Block(stmts, d) => {
                if stmts.is_empty() {
                    c.line(d, "pass");
                } else {
                    for st in stmts.iter().rev() { tasks.push(Task::Stmt(st, d)); }
                }
            }
            Task::Line(d, s, tr) => match tr {
                Some(t) => c.line_tr(d, s, t),
                None => c.line(d, s),
            },
            Task::Elif(ec, eb, etr, d) => {
                c.emit_trivia(&etr, d);
                c.line_tr(d, &format!("elif {}:", print_expr(ec)), &etr);
                tasks.push(Task::Block(eb, d + 1));
            }
            Task::Else(eb, tr, d) => {
                c.emit_trivia(tr, d);
                c.line_tr(d, "else:", tr);
                tasks.push(Task::Block(eb, d + 1));
            }
            Task::MatchArm(mc, d) => {
                c.emit_trivia(&mc.trivia, d);
                let g = mc.guard.as_ref().map(|e| format!(" if {}", print_expr(e))).unwrap_or_default();
                let pat = print_pattern(&mc.pattern);
                match &mc.body {
                    FnBody::Expr(e) => c.line_tr(d, &format!("{pat}{g} => {}", print_expr(e)), &mc.trivia),
                    FnBody::Block(b) => {
                        c.line(d, &format!("{pat}{g} => {{"));
                        tasks.push(Task::Line(d, "}", Some(&mc.trivia)));
                        tasks.push(Task::Block(b, d + 1));
                    }
                    FnBody::SignatureOnly => c.line_tr(d, &format!("{pat}{g} => pass"), &mc.trivia),
                }
            }
            Task::Catch(cc, d) => {
                c.emit_trivia(&cc.trivia, d);
                let p = match (&cc.param, &cc.ty) {
                    (Some(p), _) if p.contains(',') => format!("({p})"),
                    (Some(p), _) => p.clone(),
                    (None, Some(_)) => "()".to_string(),
                    (None, None) => "err".to_string(),
                };
                let t = cc.ty.as_ref().map(|x| format!(": {}", print_type(x))).unwrap_or_default();
                c.line_tr(d, &format!("catch {p}{t}:"), &cc.trivia);
                tasks.push(Task::Block(&cc.body, d + 1));
            }
            Task::Finally(fb, tr, d) => {
                c.emit_trivia(tr, d);
                c.line_tr(d, "finally:", tr);
                tasks.push(Task::Block(fb, d + 1));
            }
            Task::Stmt(st, d) => match st {
                Stmt::Pass => c.line(d, "pass"),
                Stmt::Comment(tr) => {
                    c.emit_trivia(tr, d);
                    if c.opts.preserve_docs && let Some(ref txt) = tr.trailing {
                        c.emit_comment_lines(d, txt);
                    }
                }
                Stmt::Let { name, is_mut, ty, init, trivia } => {
                    c.emit_trivia(trivia, d);
                    let t = if c.opts.include_types { ty.as_ref().map(|x| format!("{}{}", c.colon_sep(), print_type(x))).unwrap_or_default() } else { String::new() };
                    match init {
                        Some(e) => {
                            let op = if *is_mut { "::=" } else { ":=" };
                            c.line_tr(d, &format!("{name}{t} {op} {}", print_expr(e)), trivia);
                        }
                        None => {
                            let kw = if *is_mut { "mut" } else { "let" };
                            c.line_tr(d, &format!("{kw} {name}{t}"), trivia);
                        }
                    }
                }
                Stmt::Destructure { names, is_mut, init, trivia, .. } => {
                    c.emit_trivia(trivia, d);
                    let op = if *is_mut { "::=" } else { ":=" };
                    let (l, r) = if c.lang == LanguageId::Kotlin { ("(", ")") } else { ("[", "]") };
                    c.line_tr(d, &format!("{l}{}{r} {op} {}", names.join(", "), print_expr(init)), trivia);
                }
                Stmt::Assign { target, op, value, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &format!("{} {} {}", print_expr(target), assign_op_str(*op), print_expr(value)), trivia);
                }
                Stmt::Return { value, trivia } => {
                    c.emit_trivia(trivia, d);
                    match value {
                        Some(e) => c.line_tr(d, &format!("ret {}", print_expr(e)), trivia),
                        None => c.line_tr(d, "ret", trivia),
                    }
                }
                Stmt::Expr { expr, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &print_expr(expr), trivia);
                }
                Stmt::If { cond, then_body, elifs, elif_trivias, else_body, else_trivia, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &format!("if {}:", print_expr(cond)), trivia);
                    if let Some(eb) = else_body { tasks.push(Task::Else(eb, else_trivia, d)); }
                    for (idx, (ec, eb)) in elifs.iter().enumerate().rev() {
                        let etr = elif_trivias.get(idx).cloned().unwrap_or_default();
                        tasks.push(Task::Elif(ec, eb, etr, d));
                    }
                    tasks.push(Task::Block(then_body, d + 1));
                }
                Stmt::Match { target, cases, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &format!("match {}:", print_expr(target)), trivia);
                    for mc in cases.iter().rev() { tasks.push(Task::MatchArm(mc, d + 1)); }
                }
                Stmt::For { binding, iter, body, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &format!("for {binding} in {}:", print_expr(iter)), trivia);
                    tasks.push(Task::Block(body, d + 1));
                }
                Stmt::While { cond, body, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &format!("while {}:", print_expr(cond)), trivia);
                    tasks.push(Task::Block(body, d + 1));
                }
                Stmt::Loop { body, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, "loop:", trivia);
                    tasks.push(Task::Block(body, d + 1));
                }
                Stmt::Try { try_body, catches, else_body, else_trivia, finally_body, finally_trivia, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, "try:", trivia);
                    if let Some(fb) = finally_body { tasks.push(Task::Finally(fb, finally_trivia, d)); }
                    if let Some(eb) = else_body { tasks.push(Task::Else(eb, else_trivia, d)); }
                    for cc in catches.iter().rev() { tasks.push(Task::Catch(cc, d)); }
                    tasks.push(Task::Block(try_body, d + 1));
                }
                Stmt::Throw { expr, cause, trivia } => {
                    c.emit_trivia(trivia, d);
                    let tail = cause.as_ref().map(|e| format!(" from {}", print_expr(e))).unwrap_or_default();
                    c.line_tr(d, &format!("throw {}{tail}", print_expr(expr)), trivia);
                }
                Stmt::Break { label, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &label.as_ref().map(|l| format!("break {l}")).unwrap_or_else(|| "break".into()), trivia);
                }
                Stmt::Continue { label, trivia } => {
                    c.emit_trivia(trivia, d);
                    c.line_tr(d, &label.as_ref().map(|l| format!("continue {l}")).unwrap_or_else(|| "continue".into()), trivia);
                }
            },
        }
    }
}
