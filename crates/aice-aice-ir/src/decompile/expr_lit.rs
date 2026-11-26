use crate::ir_code::{Expr, LiteralVal, MemberKind};

pub(crate) fn parse_interp_text(s: &str, open: &str, close: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let mut pos = 0usize;
    while let Some(rel) = s[pos..].find(open) {
        let start = pos + rel;
        quasis.push(s[pos..start].to_string());
        let inner_start = start + open.len();
        if let Some(end_rel) = s[inner_start..].find(close) {
            let ex_txt = s[inner_start..inner_start + end_rel].trim();
            let ex = if let Some(ivar) = ex_txt.strip_prefix('@') {
                Expr::Member {
                    object: Box::new(Expr::Ident("this".into())),
                    property: ivar.to_string(),
                    kind: MemberKind::Dot,
                }
            } else {
                Expr::Ident(ex_txt.to_string())
            };
            exprs.push(ex);
            pos = inner_start + end_rel + close.len();
        } else {
            pos = start;
            break;
        }
    }
    if exprs.is_empty() {
        return Expr::Literal(LiteralVal::Str { value: s.to_string(), multiline: s.contains('\n') });
    }
    quasis.push(s[pos..].to_string());
    Expr::Template { quasis, exprs }
}

pub(crate) fn parse_dollar_interp(s: &str) -> Expr {
    let mut quasis = Vec::new();
    let mut exprs = Vec::new();
    let (mut i, mut q_start) = (0usize, 0usize);
    let b = s.as_bytes();
    while i < b.len() {
        if b[i] == b'$' {
            if b.get(i + 1) == Some(&b'{') {
                quasis.push(s[q_start..i].to_string());
                if let Some(end_rel) = s[i + 2..].find('}') {
                    exprs.push(Expr::Ident(s[i + 2..i + 2 + end_rel].trim().to_string()));
                    i = i + 2 + end_rel + 1;
                    q_start = i;
                    continue;
                }
            } else if b.get(i + 1).is_some_and(|c| c.is_ascii_alphabetic() || *c == b'_') {
                quasis.push(s[q_start..i].to_string());
                let mut k = i + 1;
                while k < b.len() && (b[k].is_ascii_alphanumeric() || b[k] == b'_') { k += 1; }
                exprs.push(Expr::Ident(s[i + 1..k].to_string()));
                i = k;
                q_start = i;
                continue;
            }
        }
        i += 1;
    }
    if exprs.is_empty() {
        return Expr::Literal(LiteralVal::Str { value: s.to_string(), multiline: s.contains('\n') });
    }
    quasis.push(s[q_start..].to_string());
    Expr::Template { quasis, exprs }
}
