use crate::ir_code::Pattern;
use crate::ir_types::AiceType;
use crate::printer_expr::{escape_str, print_lit};
use crate::printer_expr_iter::PTask;

pub(crate) fn push_type<'a>(tasks: &mut Vec<PTask<'a>>, ty: &'a AiceType, out: &mut String) {
    match ty {
        AiceType::Primitive(p) => out.push_str(p.aice_name()),
        AiceType::Raw(s) => {
            out.push('"');
            out.push_str(&escape_str(s));
            out.push('"');
        }
        AiceType::Array(inner) => {
            tasks.push(PTask::Lit("]"));
            tasks.push(PTask::Ty(inner));
            out.push('[');
        }
        AiceType::Tuple(items) => {
            tasks.push(PTask::Lit("]"));
            for (i, item) in items.iter().enumerate().rev() {
                tasks.push(PTask::Ty(item));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            out.push('[');
        }
        AiceType::Record(fields) => {
            tasks.push(PTask::Lit(" }"));
            for (i, f) in fields.iter().enumerate().rev() {
                tasks.push(PTask::Ty(&f.ty));
                let opt = if f.optional { "?" } else { "" };
                tasks.push(PTask::Str(format!("{}{opt}: ", f.name)));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            out.push_str("{ ");
        }
        AiceType::Result { ok, err } => {
            tasks.push(PTask::Lit("]"));
            tasks.push(PTask::Ty(err));
            tasks.push(PTask::Lit(", "));
            tasks.push(PTask::Ty(ok));
            out.push_str("Result[");
        }
        AiceType::Option(inner) => {
            let wrap = matches!(inner.as_ref(), AiceType::Union(_) | AiceType::Intersection(_) | AiceType::Fn { .. });
            if wrap {
                tasks.push(PTask::Lit(")?"));
                tasks.push(PTask::Ty(inner));
                out.push('(');
            } else {
                tasks.push(PTask::Lit("?"));
                tasks.push(PTask::Ty(inner));
            }
        }
        AiceType::Union(parts) => {
            for (i, p) in parts.iter().enumerate().rev() {
                tasks.push(PTask::Ty(p));
                if i > 0 { tasks.push(PTask::Lit(" | ")); }
            }
        }
        AiceType::Intersection(parts) => {
            for (i, p) in parts.iter().enumerate().rev() {
                tasks.push(PTask::Ty(p));
                if i > 0 { tasks.push(PTask::Lit(" & ")); }
            }
        }
        AiceType::Refinement { param, base, predicate } => {
            tasks.push(PTask::Lit(" }"));
            tasks.push(PTask::Expr(predicate));
            out.push_str(&format!("{{ {param}: {} | ", base.aice_name()));
        }
        AiceType::Fn { params, ret } => {
            tasks.push(PTask::Ty(ret));
            tasks.push(PTask::Lit(") -> "));
            for (i, p) in params.iter().enumerate().rev() {
                tasks.push(PTask::Ty(p));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            out.push_str("fn(");
        }
        AiceType::Named { path, args } => {
            out.push_str(&path.join("::"));
            if !args.is_empty() {
                tasks.push(PTask::Lit("]"));
                for (i, a) in args.iter().enumerate().rev() {
                    tasks.push(PTask::Ty(a));
                    if i > 0 { tasks.push(PTask::Lit(", ")); }
                }
                out.push('[');
            }
        }
    }
}

pub(crate) fn push_pattern<'a>(tasks: &mut Vec<PTask<'a>>, pat: &'a Pattern, out: &mut String) {
    use crate::ir_code::Expr;
    match pat {
        Pattern::Wildcard => out.push('_'),
        Pattern::Literal(l) => out.push_str(&print_lit(l)),
        Pattern::Ident(s) => out.push_str(s),
        Pattern::Constructor { name, args } => {
            out.push_str(name);
            out.push('(');
            tasks.push(PTask::Lit(")"));
            for (i, a) in args.iter().enumerate().rev() {
                tasks.push(PTask::Pat(a));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
        }
        Pattern::Or(ps) => {
            for (i, p) in ps.iter().enumerate().rev() {
                tasks.push(PTask::Pat(p));
                if i > 0 { tasks.push(PTask::Lit(" | ")); }
            }
        }
        Pattern::Range { start, end, inclusive, negated } => {
            let neg = if *negated { "!" } else { "" };
            let dots = if *inclusive { "..=" } else { ".." };
            let wrap_s = !matches!(start.as_ref(), Expr::Literal(_) | Expr::Ident(_))
                && !matches!(start.as_ref(), Expr::Unary { operand, .. } if matches!(operand.as_ref(), Expr::Literal(_) | Expr::Ident(_)));
            let wrap_e = !matches!(end.as_ref(), Expr::Literal(_) | Expr::Ident(_))
                && !matches!(end.as_ref(), Expr::Unary { operand, .. } if matches!(operand.as_ref(), Expr::Literal(_) | Expr::Ident(_)));
            if wrap_e { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(end));
            if wrap_e { tasks.push(PTask::Lit("(")); }
            tasks.push(PTask::Lit(dots));
            if wrap_s { tasks.push(PTask::Lit(")")); }
            tasks.push(PTask::Expr(start));
            if wrap_s { tasks.push(PTask::Lit("(")); }
            out.push_str(&format!("{neg}in "));
        }
        Pattern::TypeCheck { ty, negated } => {
            if *negated { out.push_str("!is "); } else { out.push_str("is "); }
            tasks.push(PTask::Ty(ty));
        }
    }
}
