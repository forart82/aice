use crate::ir::TranspileError;
use crate::ir_types::{AiceType, PrimitiveType, RecordTypeField, TypeParam};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;

pub(crate) fn parse_type_params(p: &mut Parser<'_>) -> Result<Vec<TypeParam>, TranspileError> {
    if !p.eat(TokenKind::LBracket) {
        return Ok(Vec::new());
    }
    let mut out = Vec::new();
    while p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
        let name = p.expect_ident_or_kw("Expected type param")?.lexeme;
        let mut bounds = Vec::new();
        if p.eat(TokenKind::Colon) {
            bounds.push(parse_type_expr(p)?);
            while p.eat(TokenKind::Plus) {
                bounds.push(parse_type_expr(p)?);
            }
        }
        let default = if p.eat(TokenKind::Equal) { Some(parse_type_expr(p)?) } else { None };
        out.push(TypeParam { name, bounds, default });
        if !p.eat(TokenKind::Comma) { break; }
    }
    p.expect(TokenKind::RBracket, "Expected ']'")?;
    Ok(out)
}

pub(crate) fn parse_type_name_str(p: &mut Parser<'_>) -> Result<String, TranspileError> {
    let mut s = p.expect_ident_or_kw("Expected type name")?.lexeme;
    while p.eat(TokenKind::ColonColon) || p.eat(TokenKind::Dot) {
        s.push_str("::");
        s.push_str(&p.expect_ident_or_kw("Expected segment")?.lexeme);
    }
    Ok(s)
}

enum TyTask {
    Expr,
    Intersect,
    Primary,
    UnionTail(Vec<AiceType>),
    IntersectTail(Vec<AiceType>),
    Postfix,
    BracketFirst,
    TupleNext(Vec<AiceType>),
    RecordField { fields: Vec<RecordTypeField>, name: String, optional: bool },
    FnParam(Vec<AiceType>),
    FnRet(Vec<AiceType>),
    ParenClose,
    NamedArg { path: Vec<String>, args: Vec<AiceType> },
}

pub(crate) fn parse_type_expr(p: &mut Parser<'_>) -> Result<AiceType, TranspileError> {
    let mut stack = vec![TyTask::Expr];
    let mut vals: Vec<AiceType> = Vec::new();
    while let Some(task) = stack.pop() {
        match task {
            TyTask::Expr => {
                stack.push(TyTask::UnionTail(Vec::new()));
                stack.push(TyTask::Intersect);
            }
            TyTask::UnionTail(mut parts) => {
                parts.push(vals.pop().expect("union lhs"));
                if p.eat(TokenKind::Pipe) {
                    stack.push(TyTask::UnionTail(parts));
                    stack.push(TyTask::Intersect);
                } else if parts.len() == 1 {
                    vals.push(parts.pop().unwrap());
                } else {
                    vals.push(AiceType::Union(parts));
                }
            }
            TyTask::Intersect => {
                stack.push(TyTask::IntersectTail(Vec::new()));
                stack.push(TyTask::Postfix);
                stack.push(TyTask::Primary);
            }
            TyTask::IntersectTail(mut parts) => {
                parts.push(vals.pop().expect("intersect lhs"));
                if p.eat(TokenKind::Amp) {
                    stack.push(TyTask::IntersectTail(parts));
                    stack.push(TyTask::Postfix);
                    stack.push(TyTask::Primary);
                } else if parts.len() == 1 {
                    vals.push(parts.pop().unwrap());
                } else {
                    vals.push(AiceType::Intersection(parts));
                }
            }
            TyTask::Postfix => {
                let mut ty = vals.pop().expect("postfix ty");
                while p.eat(TokenKind::Question) {
                    ty = AiceType::Option(Box::new(ty));
                }
                vals.push(ty);
            }
            TyTask::Primary => step_primary_type(p, &mut stack, &mut vals)?,
            TyTask::BracketFirst => {
                let first = vals.pop().expect("bracket first");
                if p.eat(TokenKind::Comma) {
                    let items = vec![first];
                    if p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
                        stack.push(TyTask::TupleNext(items));
                        stack.push(TyTask::Expr);
                    } else {
                        p.expect(TokenKind::RBracket, "Expected ']'")?;
                        vals.push(AiceType::Tuple(items));
                    }
                } else {
                    p.expect(TokenKind::RBracket, "Expected ']'")?;
                    vals.push(AiceType::Array(Box::new(first)));
                }
            }
            TyTask::TupleNext(mut items) => {
                items.push(vals.pop().expect("tuple item"));
                if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
                    stack.push(TyTask::TupleNext(items));
                    stack.push(TyTask::Expr);
                } else {
                    p.expect(TokenKind::RBracket, "Expected ']'")?;
                    vals.push(AiceType::Tuple(items));
                }
            }
            TyTask::RecordField { mut fields, name, optional } => {
                let ty = vals.pop().expect("record field ty");
                fields.push(RecordTypeField { name, optional, ty });
                if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBrace && !p.at_eof() {
                    let fname = p.expect_ident_or_kw("Expected field name")?.lexeme;
                    let opt = p.eat(TokenKind::Question);
                    p.expect(TokenKind::Colon, "Expected ':'")?;
                    stack.push(TyTask::RecordField { fields, name: fname, optional: opt });
                    stack.push(TyTask::Expr);
                } else {
                    p.expect(TokenKind::RBrace, "Expected '}'")?;
                    vals.push(AiceType::Record(fields));
                }
            }
            TyTask::FnParam(mut params) => {
                params.push(vals.pop().expect("fn param"));
                if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                    stack.push(TyTask::FnParam(params));
                    stack.push(TyTask::Expr);
                } else {
                    p.expect(TokenKind::RParen, "Expected ')'")?;
                    p.expect(TokenKind::Arrow, "Expected '->'")?;
                    stack.push(TyTask::FnRet(params));
                    stack.push(TyTask::Expr);
                }
            }
            TyTask::FnRet(params) => {
                let ret = vals.pop().expect("fn ret");
                vals.push(AiceType::Fn { params, ret: Box::new(ret) });
            }
            TyTask::ParenClose => {
                p.expect(TokenKind::RParen, "Expected ')'")?;
            }
            TyTask::NamedArg { path, mut args } => {
                args.push(vals.pop().expect("named arg"));
                if p.eat(TokenKind::Comma) && p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
                    stack.push(TyTask::NamedArg { path, args });
                    stack.push(TyTask::Expr);
                } else {
                    p.expect(TokenKind::RBracket, "Expected ']'")?;
                    vals.push(finish_named_type(path, args));
                }
            }
        }
    }
    Ok(vals.pop().expect("type expr result"))
}

fn step_primary_type(
    p: &mut Parser<'_>,
    stack: &mut Vec<TyTask>,
    vals: &mut Vec<AiceType>,
) -> Result<(), TranspileError> {
    match p.peek_kind() {
        TokenKind::String => vals.push(AiceType::Raw(p.advance().lexeme)),
        TokenKind::LBracket => {
            p.advance();
            stack.push(TyTask::BracketFirst);
            stack.push(TyTask::Expr);
        }
        TokenKind::LBrace => {
            p.advance();
            if p.peek_kind() == TokenKind::RBrace || p.at_eof() {
                p.expect(TokenKind::RBrace, "Expected '}'")?;
                vals.push(AiceType::Record(Vec::new()));
            } else {
                let name = p.expect_ident_or_kw("Expected field name")?.lexeme;
                let optional = p.eat(TokenKind::Question);
                p.expect(TokenKind::Colon, "Expected ':'")?;
                stack.push(TyTask::RecordField { fields: Vec::new(), name, optional });
                stack.push(TyTask::Expr);
            }
        }
        TokenKind::Fn => {
            p.advance();
            p.expect(TokenKind::LParen, "Expected '('")?;
            if p.peek_kind() == TokenKind::RParen || p.at_eof() {
                p.expect(TokenKind::RParen, "Expected ')'")?;
                p.expect(TokenKind::Arrow, "Expected '->'")?;
                stack.push(TyTask::FnRet(Vec::new()));
                stack.push(TyTask::Expr);
            } else {
                stack.push(TyTask::FnParam(Vec::new()));
                stack.push(TyTask::Expr);
            }
        }
        TokenKind::LParen => {
            p.advance();
            stack.push(TyTask::ParenClose);
            stack.push(TyTask::Expr);
        }
        TokenKind::Nil => { p.advance(); vals.push(AiceType::Primitive(PrimitiveType::Nil)); }
        _ => step_named_or_prim(p, stack, vals)?,
    }
    Ok(())
}

fn step_named_or_prim(
    p: &mut Parser<'_>,
    stack: &mut Vec<TyTask>,
    vals: &mut Vec<AiceType>,
) -> Result<(), TranspileError> {
    let mut path = vec![p.expect_ident_or_kw("Expected type")?.lexeme];
    while p.eat(TokenKind::ColonColon) || p.eat(TokenKind::Dot) {
        path.push(p.expect_ident_or_kw("Expected type segment")?.lexeme);
    }
    if path.len() == 1 && !matches!(p.peek_kind(), TokenKind::LBracket) {
        let prim = match path[0].as_str() {
            "str" => Some(PrimitiveType::Str), "int" => Some(PrimitiveType::Int),
            "float" | "flt" => Some(PrimitiveType::Float), "num" => Some(PrimitiveType::Num),
            "bool" => Some(PrimitiveType::Bool), "byte" => Some(PrimitiveType::Byte),
            "char" => Some(PrimitiveType::Char), "void" => Some(PrimitiveType::Void),
            "nil" => Some(PrimitiveType::Nil), "any" => Some(PrimitiveType::Any),
            "unknown" => Some(PrimitiveType::Unknown), _ => None,
        };
        if let Some(pr) = prim {
            vals.push(AiceType::Primitive(pr));
            return Ok(());
        }
    }
    if p.eat(TokenKind::LBracket) {
        if p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
            stack.push(TyTask::NamedArg { path, args: Vec::new() });
            stack.push(TyTask::Expr);
            return Ok(());
        }
        p.expect(TokenKind::RBracket, "Expected ']'")?;
    }
    vals.push(AiceType::Named { path, args: Vec::new() });
    Ok(())
}

fn finish_named_type(path: Vec<String>, mut args: Vec<AiceType>) -> AiceType {
    if path.len() == 1 && path[0] == "Option" && args.len() == 1 {
        return AiceType::Option(Box::new(args.remove(0)));
    }
    if path.len() == 1 && path[0] == "Result" && args.len() == 2 {
        let err = args.remove(1);
        let ok = args.remove(0);
        return AiceType::Result { ok: Box::new(ok), err: Box::new(err) };
    }
    AiceType::Named { path, args }
}
