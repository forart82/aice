use crate::ir_code::{BinaryOp, Expr, LiteralVal, Pattern, UnaryOp};
use crate::ir_types::AiceType;
use crate::printer_expr_iter::{PTask, run_print_tasks};

pub fn print_type(ty: &AiceType) -> String {
    run_print_tasks(PTask::Ty(ty))
}

pub fn print_pattern(pat: &Pattern) -> String {
    run_print_tasks(PTask::Pat(pat))
}

pub fn print_expr(expr: &Expr) -> String {
    run_print_tasks(PTask::Expr(expr))
}

pub(crate) fn print_lit(l: &LiteralVal) -> String {
    match l {
        LiteralVal::Int(s) | LiteralVal::Float(s) | LiteralVal::HexColor(s) | LiteralVal::Regex(s) => s.clone(),
        LiteralVal::Bool(b) => if *b { "true".into() } else { "false".into() },
        LiteralVal::Nil => "nil".into(),
        LiteralVal::Str { value, multiline } => {
            if *multiline && value.contains('\n') && !value.contains("\"\"\"") && !value.contains('`') {
                format!("\"\"\"\n{value}\n\"\"\"")
            } else {
                format!("\"{}\"", escape_str(value))
            }
        }
    }
}

pub(crate) fn escape_str(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for c in s.chars() {
        match c {
            '\\' => out.push_str("\\\\"), '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"), '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"), '\0' => out.push_str("\\0"),
            _ => out.push(c),
        }
    }
    out
}

pub(crate) fn escape_template(s: &str) -> String {
    s.replace('\\', "\\\\").replace('`', "\\`").replace("${", "\\${")
}

pub(crate) fn format_raw_expr(s: &str) -> String {
    if s.contains('\n') && !s.contains("\"\"\"") {
        format!("raw \"\"\"\n{s}\n\"\"\"")
    } else {
        format!("raw \"{}\"", escape_str(s))
    }
}

fn bin_prec(op: BinaryOp) -> u8 {
    match op {
        BinaryOp::Or => 3, BinaryOp::And => 4, BinaryOp::Coalesce | BinaryOp::Elvis => 5,
        BinaryOp::BitOr => 6, BinaryOp::BitXor => 7, BinaryOp::BitAnd => 8,
        BinaryOp::Eq | BinaryOp::NotEq => 9,
        BinaryOp::Lt | BinaryOp::LtEq | BinaryOp::Gt | BinaryOp::GtEq | BinaryOp::Spaceship
        | BinaryOp::In | BinaryOp::NotIn | BinaryOp::Is | BinaryOp::IsNot | BinaryOp::Instanceof => 10,
        BinaryOp::Shl | BinaryOp::Shr | BinaryOp::Ushr => 11,
        BinaryOp::Add | BinaryOp::Concat | BinaryOp::Sub => 12,
        BinaryOp::Mul | BinaryOp::Div | BinaryOp::FloorDiv | BinaryOp::Mod | BinaryOp::BitClear => 13,
        BinaryOp::Pow => 14,
        BinaryOp::As | BinaryOp::With => 15,
    }
}

pub(crate) fn needs_binary_parens(child: &Expr, parent_op: BinaryOp, is_right: bool) -> bool {
    let Expr::Binary { op: child_op, .. } = child else {
        return matches!(child, Expr::Conditional { .. } | Expr::Assign { .. });
    };
    if matches!(
        (parent_op, *child_op),
        (BinaryOp::Coalesce | BinaryOp::Elvis, BinaryOp::And | BinaryOp::Or)
            | (BinaryOp::And | BinaryOp::Or, BinaryOp::Coalesce | BinaryOp::Elvis)
    ) {
        return true;
    }
    let pp = bin_prec(parent_op);
    let cp = bin_prec(*child_op);
    if cp < pp { return true; }
    if cp == pp {
        if matches!((parent_op, *child_op), (BinaryOp::And, BinaryOp::Or) | (BinaryOp::Or, BinaryOp::And)) {
            return true;
        }
        if is_right && parent_op != BinaryOp::Pow { return true; }
        if !is_right && parent_op == BinaryOp::Pow { return true; }
    }
    false
}

pub(crate) fn bin_op_str(op: BinaryOp) -> &'static str {
    match op {
        BinaryOp::Add => "+", BinaryOp::Concat => "<>", BinaryOp::Sub => "-", BinaryOp::Mul => "*",
        BinaryOp::Div => "/", BinaryOp::FloorDiv => "~/", BinaryOp::Mod => "%", BinaryOp::Pow => "**",
        BinaryOp::Eq => "==", BinaryOp::NotEq => "!=",
        BinaryOp::Lt => "<", BinaryOp::LtEq => "<=", BinaryOp::Gt => ">", BinaryOp::GtEq => ">=",
        BinaryOp::Spaceship => "<=>",
        BinaryOp::And => "and", BinaryOp::Or => "or",
        BinaryOp::Coalesce => "??", BinaryOp::Elvis => "?:",
        BinaryOp::BitAnd => "&", BinaryOp::BitClear => "&^", BinaryOp::BitOr => "|", BinaryOp::BitXor => "^",
        BinaryOp::Shl => "<<", BinaryOp::Shr => ">>", BinaryOp::Ushr => ">>>",
        BinaryOp::In => "in", BinaryOp::NotIn => "not in",
        BinaryOp::Is => "is", BinaryOp::IsNot => "is not",
        BinaryOp::Instanceof => "instanceof", BinaryOp::As => "as", BinaryOp::With => "with",
    }
}

pub(crate) fn unary_op_str(op: UnaryOp) -> &'static str {
    match op {
        UnaryOp::Neg => "-", UnaryOp::Pos => "+", UnaryOp::Not => "not ",
        UnaryOp::BitNot => "~", UnaryOp::Inc => "++", UnaryOp::Dec => "--",
        UnaryOp::Spread => "...",
        UnaryOp::Ref => "&", UnaryOp::RefMut => "&mut ", UnaryOp::Deref => "*",
        UnaryOp::Typeof => "typeof ", UnaryOp::Void => "void ",
        UnaryOp::Delete => "delete ", UnaryOp::Yield => "yield ",
        UnaryOp::YieldStar => "yield* ", UnaryOp::Generator => "", UnaryOp::Move => "move ",
        UnaryOp::NonNull => "!!",
    }
}

pub(crate) fn push_new_tagged_print<'a>(
    tasks: &mut Vec<PTask<'a>>,
    out: &mut String,
    callee: &'a Expr,
    args: &'a [Expr],
    is_optional: bool,
) {
    if let Some(init_rec @ Expr::Record(_)) = args.last() {
        let ctor_args = &args[..args.len() - 1];
        tasks.push(PTask::Expr(init_rec));
        tasks.push(PTask::Lit(" "));
        if is_optional || !ctor_args.is_empty() {
            tasks.push(PTask::Lit(")"));
            for (i, a) in ctor_args.iter().enumerate().rev() {
                tasks.push(PTask::Expr(a));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            tasks.push(PTask::Lit("("));
        }
        if matches!(callee, Expr::Ident(s) if s.is_empty()) {
            out.push_str("new");
        } else {
            tasks.push(PTask::Expr(callee));
            out.push_str("new ");
        }
        return;
    }
    if let Some(Expr::Array(elems)) = args.first() {
        if elems.is_empty() {
            tasks.push(PTask::Lit(" {}"));
        } else {
            tasks.push(PTask::Lit(" }"));
            for (i, el) in elems.iter().enumerate().rev() {
                tasks.push(PTask::Expr(el));
                if i > 0 { tasks.push(PTask::Lit(", ")); }
            }
            tasks.push(PTask::Lit(" { "));
        }
    }
    tasks.push(PTask::Expr(callee));
    let mut e = callee;
    while let Expr::Index { object, .. } = e { e = object; }
    out.push_str(if matches!(e, Expr::Ident(s) if s.is_empty()) { "new" } else { "new " });
}

pub(crate) fn push_comp_print<'a>(
    tasks: &mut Vec<PTask<'a>>,
    out: &mut String,
    kind: crate::ir_code::CompKind,
    body: &'a Expr,
    value: Option<&'a Expr>,
    clauses: &'a [crate::ir_code::CompClause],
    bare: bool,
) {
    use crate::ir_code::CompKind;
    let (open, close) = if bare {
        ("", "")
    } else {
        match kind {
            CompKind::List => ("[", "]"),
            CompKind::Set | CompKind::Dict => ("{", "}"),
            CompKind::Generator => ("(", ")"),
        }
    };
    if !close.is_empty() { tasks.push(PTask::Lit(close)); }
    for cl in clauses.iter().rev() {
        for f in cl.filters.iter().rev() {
            tasks.push(PTask::Expr(f));
            tasks.push(PTask::Lit(" if "));
        }
        tasks.push(PTask::Expr(&cl.iter));
        let pfx = if cl.is_async { " async for " } else { " for " };
        tasks.push(PTask::Str(format!("{pfx}{} in ", cl.target)));
    }
    if let Some(v) = value {
        tasks.push(PTask::Expr(v));
        tasks.push(PTask::Lit(": "));
    }
    tasks.push(PTask::Expr(body));
    if !open.is_empty() { out.push_str(open); }
}
