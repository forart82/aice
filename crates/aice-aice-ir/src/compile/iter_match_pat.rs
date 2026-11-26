use aice_lang_registry::LanguageId;

use crate::compile::expr_emit::{ExprEmitCtx, emit_lit};
use crate::compile::iter_emit::{CTask, EvalState};
use crate::compile::pattern_emit::{emit_type_check_expr, pat_has_wildcard, wrap_range_bound_str};
use crate::compile::type_map::emit_type;
use crate::ir_code::{MatchCase, Pattern};

pub(crate) fn step_pat_task<'a>(
    task: CTask<'a>,
    lang: LanguageId,
    _ectx: &ExprEmitCtx,
    st: &mut EvalState,
    tasks: &mut Vec<CTask<'a>>,
) {
    match task {
        CTask::EvalPat(pat) => match pat {
            Pattern::Wildcard => st.vals.push("_".into()),
            Pattern::Literal(l) => st.vals.push(emit_lit(l, lang)),
            Pattern::Ident(s) => st.vals.push(s.clone()),
            Pattern::Constructor { name, args } => {
                if args.is_empty() { st.vals.push(name.clone()); }
                else {
                    tasks.push(CTask::MakePatCtor { name, n_args: args.len() });
                    for a in args.iter().rev() { tasks.push(CTask::EvalPat(a)); }
                }
            }
            Pattern::Or(ps) => {
                tasks.push(CTask::MakePatOr { n_parts: ps.len() });
                for p in ps.iter().rev() { tasks.push(CTask::EvalPat(p)); }
            }
            Pattern::Range { start, end, inclusive, negated } => {
                tasks.push(CTask::MakePatRange { start, end, inclusive: *inclusive, negated: *negated });
                tasks.push(CTask::EvalExpr(end));
                tasks.push(CTask::EvalExpr(start));
            }
            Pattern::TypeCheck { ty, negated } => {
                let neg = if *negated { "!" } else { "" };
                st.vals.push(format!("{neg}is {}", emit_type(ty, lang)));
            }
        },
        CTask::MakePatCtor { name, n_args } => {
            let s = st.vals.len() - n_args;
            let ps: Vec<String> = st.vals.drain(s..).collect();
            st.vals.push(format!("{name}({})", ps.join(", ")));
        }
        CTask::MakePatOr { n_parts } => {
            let s = st.vals.len() - n_parts;
            let ps: Vec<String> = st.vals.drain(s..).collect();
            let sep = if matches!(lang, LanguageId::Kotlin | LanguageId::Ruby | LanguageId::Go) { ", " } else { " | " };
            st.vals.push(ps.join(sep));
        }
        CTask::MakePatRange { start, end, inclusive, negated } => {
            let hi = wrap_range_bound_str(end, st.vals.pop().unwrap());
            let lo = wrap_range_bound_str(start, st.vals.pop().unwrap());
            let s = match lang {
                LanguageId::Kotlin => format!("{}in {lo}{}{hi}", if negated { "!" } else { "" }, if inclusive { ".." } else { " until " }),
                LanguageId::Rust => format!("{lo}{}{hi}", if inclusive { "..=" } else { ".." }),
                LanguageId::Ruby => format!("{lo}{}{hi}", if inclusive { ".." } else { "..." }),
                _ => format!("{lo}..{hi}"),
            };
            st.vals.push(s);
        }
        CTask::EvalCaseCond { mc, subj, subjectless } => {
            if subjectless || matches!(mc.pattern, Pattern::Wildcard) {
                if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
                return;
            }
            tasks.push(CTask::MakeCaseCond { has_guard: mc.guard.is_some() });
            if let Some(g) = &mc.guard { tasks.push(CTask::EvalExpr(g)); }
            tasks.push(CTask::EvalPatCond { pat: &mc.pattern, subj });
        }
        CTask::MakeCaseCond { has_guard } => {
            if !has_guard { return; }
            let g = st.vals.pop().unwrap();
            let base = st.vals.pop().unwrap();
            let and_op = if matches!(lang, LanguageId::Python | LanguageId::Ruby) { " and " } else { " && " };
            st.vals.push(format!("({base}){and_op}({g})"));
        }
        CTask::EvalPatCond { pat, subj } => {
            let eq_op = if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Php) { "===" } else { "==" };
            match pat {
                Pattern::Wildcard => st.vals.push("true".into()),
                Pattern::Literal(l) => st.vals.push(format!("{subj} {eq_op} {}", emit_lit(l, lang))),
                Pattern::Ident(s) => st.vals.push(format!("{subj} {eq_op} {s}")),
                Pattern::Constructor { .. } => {
                    tasks.push(CTask::MakePatCondCtor { subj });
                    tasks.push(CTask::EvalPat(pat));
                }
                Pattern::Or(ps) => {
                    tasks.push(CTask::MakePatCondOr(ps.len()));
                    for p in ps.iter().rev() { tasks.push(CTask::EvalPatCond { pat: p, subj: subj.clone() }); }
                }
                Pattern::Range { start, end, inclusive, negated } => {
                    tasks.push(CTask::MakePatCondRange { start, end, inclusive: *inclusive, negated: *negated, subj });
                    tasks.push(CTask::EvalExpr(end));
                    tasks.push(CTask::EvalExpr(start));
                }
                Pattern::TypeCheck { ty, negated } => {
                    let raw = emit_type_check_expr(&subj, ty, lang);
                    let s = if *negated {
                        if lang == LanguageId::Python { format!("not ({raw})") } else { format!("!({raw})") }
                    } else { raw };
                    st.vals.push(s);
                }
            }
        }
        CTask::MakePatCondCtor { subj } => {
            let pat_s = st.vals.pop().unwrap();
            let eq_op = if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Php) { "===" } else { "==" };
            st.vals.push(format!("{subj} {eq_op} {pat_s}"));
        }
        CTask::MakePatCondOr(n) => {
            let s = st.vals.len() - n;
            let mut ps: Vec<String> = st.vals.drain(s..).collect();
            let or_op = if matches!(lang, LanguageId::Python | LanguageId::Ruby) { " or " } else { " || " };
            if ps.len() == 1 { st.vals.push(ps.remove(0)); } else { st.vals.push(format!("({})", ps.join(or_op))); }
        }
        CTask::MakePatCondRange { start, end, inclusive, negated, subj } => {
            let hi = wrap_range_bound_str(end, st.vals.pop().unwrap());
            let lo = wrap_range_bound_str(start, st.vals.pop().unwrap());
            let and_op = if matches!(lang, LanguageId::Python | LanguageId::Ruby) { " and " } else { " && " };
            let hi_op = if inclusive { "<=" } else { "<" };
            let cond = format!("({subj} >= {lo}{and_op}{subj} {hi_op} {hi})");
            let s = if negated {
                if lang == LanguageId::Python { format!("not {cond}") } else { format!("!{cond}") }
            } else { cond };
            st.vals.push(s);
        }
        _ => unreachable!(),
    }
}

pub(crate) fn case_has_cond(mc: &MatchCase, subjectless: bool) -> bool {
    if subjectless || matches!(mc.pattern, Pattern::Wildcard) {
        mc.guard.is_some()
    } else {
        !pat_has_wildcard(&mc.pattern)
    }
}
