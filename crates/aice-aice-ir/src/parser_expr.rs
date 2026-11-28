use crate::ir::TranspileError;
use crate::ir_code::{AssignOp, BinaryOp, Expr, LiteralVal, MemberKind, UnaryOp};
use crate::lexer_tokens::{Token, TokenKind};
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal, run_parse_loop};

pub(crate) fn parse_expr(p: &mut Parser<'_>) -> Result<Expr, TranspileError> {
    match run_parse_loop(p, ParseCont::Expr(1))? { ParseVal::Expr(e) => Ok(e), _ => unreachable!() }
}

pub(crate) fn step_paren_open(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) {
    p.advance();
    if p.eat(TokenKind::RParen) {
        vals.push(ParseVal::Expr(Expr::Call { callee: Box::new(Expr::Ident(String::new())), args: Vec::new(), is_optional: false, is_tagged: false, is_new: false }));
    } else if Parser::is_binding_tok(p.peek()) && p.peek_n(1).kind == TokenKind::ColonEqual {
        let name = p.advance().lexeme; p.advance();
        stack.push(ParseCont::ExprWalrusClose { name, rhs_start: p.peek().span.start_byte }); stack.push(ParseCont::Expr(1));
    } else {
        stack.push(ParseCont::ExprParenClose); stack.push(ParseCont::Expr(1));
    }
}

pub(crate) fn step_paren_close(p: &mut Parser<'_>, stack: &mut Vec<ParseCont>, vals: &mut Vec<ParseVal>) -> Result<(), TranspileError> {
    if crate::parser_iter_comp::is_comp_for_ahead(p) {
        let ParseVal::Expr(first) = vals.pop().expect("paren expr") else { unreachable!() };
        return crate::parser_iter_comp::start_comp_clauses(p, crate::ir_code::CompKind::Generator, first, None, Vec::new(), None, stack);
    }
    if !p.eat(TokenKind::Comma) { p.expect(TokenKind::RParen, "Expected ')'")?; return Ok(()); }
    let ParseVal::Expr(first) = vals.pop().expect("paren expr") else { unreachable!() };
    let callee = Expr::Ident(String::new());
    if p.peek_kind() == TokenKind::RParen || p.at_eof() {
        p.expect(TokenKind::RParen, "Expected ')'")?;
        vals.push(ParseVal::Expr(Expr::Call {
            callee: Box::new(callee), args: vec![first, Expr::Ident(String::new())], is_optional: false, is_tagged: false, is_new: false,
        }));
    } else {
        stack.push(ParseCont::ExprCallArg { callee, args: vec![first], is_optional: false, is_new: false });
        stack.push(ParseCont::Expr(1));
    }
    Ok(())
}

pub(crate) fn step_member_infix(
    p: &mut Parser<'_>,
    lhs: Expr,
    kind: TokenKind,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    if kind == TokenKind::Turbofish {
        let t = p.advance();
        let prop = t.lexeme.strip_prefix("::").unwrap_or(&t.lexeme).to_string();
        vals.push(ParseVal::Expr(Expr::Member { object: Box::new(lhs), property: prop, kind: MemberKind::Scope }));
        return Ok(());
    }
    p.advance();
    if kind == TokenKind::QuestionDot && p.eat(TokenKind::LParen) {
        if p.peek_kind() == TokenKind::RParen || p.at_eof() {
            p.expect(TokenKind::RParen, "Expected ')'")?;
            vals.push(ParseVal::Expr(Expr::Call {
                callee: Box::new(lhs), args: Vec::new(), is_optional: true, is_tagged: false, is_new: false,
            }));
        } else {
            stack.push(ParseCont::ExprCallArg { callee: lhs, args: Vec::new(), is_optional: true, is_new: false });
            stack.push(ParseCont::Expr(1));
        }
        return Ok(());
    }
    if kind == TokenKind::QuestionDot && p.eat(TokenKind::LBracket) {
        stack.push(ParseCont::ExprIndex { object: lhs, args: Vec::new(), is_optional: true });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    if kind == TokenKind::Dot && p.peek_kind() == TokenKind::Number {
        let t = p.advance();
        if t.lexeme.split('.').all(|s| !s.is_empty() && s.bytes().all(|b| b.is_ascii_digit())) {
            let expr = t.lexeme.split('.').fold(lhs, |obj, seg| Expr::Member {
                object: Box::new(obj), property: seg.to_string(), kind: MemberKind::Dot,
            });
            vals.push(ParseVal::Expr(expr));
            return Ok(());
        }
        return Err(TranspileError::at(format!("Invalid tuple index '{}'", t.lexeme), t.span));
    }
    let mk = match kind {
        TokenKind::QuestionDot => MemberKind::SafeNav,
        TokenKind::ColonColon => MemberKind::Scope,
        _ => MemberKind::Dot,
    };
    let (mut prop, prop_end) = if kind == TokenKind::Dot && p.eat(TokenKind::Hash) {
        let t = p.expect_ident_or_kw("Expected private member name")?;
        (format!("#{}", t.lexeme), t.span.end_byte)
    } else if kind == TokenKind::ColonColon && p.eat(TokenKind::Dollar) {
        let t = p.expect_ident_or_kw("Expected static property name")?;
        (format!("${}", t.lexeme), t.span.end_byte)
    } else if (kind == TokenKind::Dot && p.peek_kind() == TokenKind::HexColor)
        || matches!(p.peek_kind(), TokenKind::Nil | TokenKind::Boolean)
    {
        let t = p.advance(); (t.lexeme, t.span.end_byte)
    } else {
        let t = p.expect_ident_or_kw("Expected member name")?; (t.lexeme, t.span.end_byte)
    };
    if matches!(p.peek_kind(), TokenKind::Question | TokenKind::Bang)
        && p.peek().span.start_byte == prop_end && p.peek_n(1).kind == TokenKind::LParen
    { prop.push_str(&p.advance().lexeme); }
    vals.push(ParseVal::Expr(Expr::Member { object: Box::new(lhs), property: prop, kind: mk }));
    Ok(())
}

pub(crate) fn is_new_prefix_start(p: &Parser<'_>, tok: &Token) -> bool {
    tok.kind == TokenKind::Ident
        && tok.lexeme == "new"
        && (p.peek_n(1).kind == TokenKind::Ident
            || p.peek_n(1).kind == TokenKind::LBrace
            || (p.peek_n(1).kind == TokenKind::LBracket
                && matches!(p.peek_n(2).kind, TokenKind::RBracket | TokenKind::Comma)))
}

pub(crate) fn looks_like_gen_closure(p: &Parser<'_>, star_offset: usize) -> bool {
    if p.peek_n(star_offset).kind != TokenKind::Star || p.peek_n(star_offset + 1).kind != TokenKind::LParen {
        return false;
    }
    let (mut idx, mut depth) = (p.pos + star_offset + 2, 1usize);
    while idx < p.tokens.len() && depth > 0 {
        match p.tokens[idx].kind {
            TokenKind::LParen => depth += 1,
            TokenKind::RParen => depth -= 1,
            TokenKind::Eof => return false,
            _ => {}
        }
        idx += 1;
    }
    matches!(
        p.tokens.get(idx).map(|t| t.kind),
        Some(TokenKind::Equal | TokenKind::FatArrow | TokenKind::LBrace | TokenKind::Arrow)
    )
}

pub(crate) fn infix_prec(kind: TokenKind) -> Option<(u8, bool)> {
    if assign_op_from_tok(kind).is_some() { return Some((2, true)); }
    match kind {
        TokenKind::Question => Some((3, true)),
        TokenKind::Or | TokenKind::PipePipe => Some((3, false)),
        TokenKind::And | TokenKind::AmpAmp => Some((4, false)),
        TokenKind::QuestionQuestion => Some((5, false)),
        TokenKind::Pipe => Some((6, false)),
        TokenKind::Caret => Some((7, false)),
        TokenKind::Amp => Some((8, false)),
        TokenKind::EqEq | TokenKind::NotEq => Some((9, false)),
        TokenKind::Lt | TokenKind::LtEq | TokenKind::Gt | TokenKind::GtEq
        | TokenKind::Spaceship | TokenKind::In | TokenKind::Instanceof => Some((10, false)),
        TokenKind::Shl | TokenKind::Shr | TokenKind::Ushr => Some((11, false)),
        TokenKind::Plus | TokenKind::Minus | TokenKind::Concat => Some((12, false)),
        TokenKind::Star | TokenKind::Slash | TokenKind::TildeSlash
        | TokenKind::Percent | TokenKind::AmpCaret => Some((13, false)),
        TokenKind::StarStar => Some((14, true)),
        TokenKind::As => Some((15, false)),
        TokenKind::LParen | TokenKind::LBracket | TokenKind::Dot | TokenKind::QuestionDot
        | TokenKind::ColonColon | TokenKind::PlusPlus | TokenKind::MinusMinus
        | TokenKind::TemplateHead | TokenKind::TemplateNoSubst | TokenKind::MacroBody
        | TokenKind::Turbofish => Some((17, false)),
        _ => None,
    }
}

pub(crate) fn can_start_expr_tok(k: TokenKind) -> bool {
    assign_op_from_tok(k).is_none()
        && !matches!(
            k,
            TokenKind::Newline | TokenKind::Indent | TokenKind::Dedent | TokenKind::Eof
                | TokenKind::Comment | TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace
                | TokenKind::Comma | TokenKind::Semicolon | TokenKind::Colon
                | TokenKind::ColonEqual | TokenKind::ColonColonEqual | TokenKind::FatArrow
                | TokenKind::Arrow | TokenKind::MacroBody | TokenKind::Turbofish
        )
}

pub(crate) fn is_elvis_ahead(p: &Parser<'_>) -> bool {
    p.peek_kind() == TokenKind::Question
        && p.peek_n(1).kind == TokenKind::Colon
        && p.peek().span.end_byte == p.peek_n(1).span.start_byte
        && can_start_expr_tok(p.peek_n(2).kind)
        && !(p.peek_n(2).kind == TokenKind::LBrace && crate::parser_stmt::is_match_brace_body(p, p.pos + 2))
}

pub(crate) fn looks_like_ternary(p: &Parser<'_>) -> bool {
    if is_elvis_ahead(p) { return true; }
    if p.peek_n(1).kind == TokenKind::Colon { return false; }
    let (mut idx, mut depth) = (p.pos + 1, 0usize);
    while idx < p.tokens.len() {
        match p.tokens[idx].kind {
            TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => depth += 1,
            TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => {
                if depth == 0 { return false; }
                depth -= 1;
            }
            TokenKind::Colon if depth == 0 => return true,
            TokenKind::Newline | TokenKind::Semicolon | TokenKind::Comma | TokenKind::Eof if depth == 0 => return false,
            _ => {}
        }
        idx += 1;
    }
    false
}

pub(crate) fn try_contextual_infix(p: &mut Parser<'_>, min_prec: u8) -> Option<(BinaryOp, u8)> {
    let (k0, k1) = (p.peek_kind(), p.peek_n(1).kind);
    if min_prec <= 15 && k0 == TokenKind::Ident && p.peek().lexeme == "with" && k1 == TokenKind::LBrace {
        p.advance();
        return Some((BinaryOp::With, 16));
    }
    if min_prec > 10 { return None; }
    if k0 == TokenKind::Ident && p.peek().lexeme == "is" {
        if k1 == TokenKind::Not && can_start_expr_tok(p.peek_n(2).kind) {
            p.advance(); p.advance();
            return Some((BinaryOp::IsNot, 11));
        }
        if can_start_expr_tok(k1) { p.advance(); return Some((BinaryOp::Is, 11)); }
    } else if matches!(k0, TokenKind::Not | TokenKind::Bang) && k1 == TokenKind::In {
        p.advance(); p.advance();
        return Some((BinaryOp::NotIn, 11));
    } else if k0 == TokenKind::Bang && k1 == TokenKind::Ident && p.peek_n(1).lexeme == "is" {
        p.advance(); p.advance();
        return Some((BinaryOp::IsNot, 11));
    }
    None
}

pub(crate) fn try_contextual_unary(p: &Parser<'_>, tok: &Token) -> Option<UnaryOp> {
    if tok.kind != TokenKind::Ident { return None; }
    if tok.lexeme == "yield" && p.peek_n(1).kind == TokenKind::Star {
        return can_start_expr_tok(p.peek_n(2).kind).then_some(UnaryOp::YieldStar);
    }
    let op = match tok.lexeme.as_str() {
        "typeof" => UnaryOp::Typeof, "void" => UnaryOp::Void,
        "delete" => UnaryOp::Delete, "yield" => UnaryOp::Yield, _ => return None,
    };
    let next = p.peek_n(1);
    if !can_start_expr_tok(next.kind) || (next.kind == TokenKind::LParen && tok.span.end_byte == next.span.start_byte) {
        return None;
    }
    Some(op)
}

pub(crate) fn lit_expr_from_tok(p: &Parser<'_>, tok: &Token) -> Option<Expr> {
    Some(match tok.kind {
        TokenKind::Number => Expr::Literal(if tok.lexeme.contains(['.', 'e', 'E']) {
            LiteralVal::Float(tok.lexeme.clone())
        } else {
            LiteralVal::Int(tok.lexeme.clone())
        }),
        TokenKind::String => Expr::Literal(LiteralVal::Str { value: tok.lexeme.clone(), multiline: false }),
        TokenKind::TripleString => Expr::Literal(LiteralVal::Str { value: tok.lexeme.clone(), multiline: true }),
        TokenKind::Boolean => Expr::Literal(LiteralVal::Bool(tok.lexeme == "true")),
        TokenKind::Nil => {
            let k1 = p.peek_n(1).kind;
            if assign_op_from_tok(k1).is_some()
                || matches!(k1, TokenKind::LParen | TokenKind::LBracket | TokenKind::PlusPlus | TokenKind::MinusMinus)
            { Expr::Ident(tok.lexeme.clone()) } else { Expr::Literal(LiteralVal::Nil) }
        }
        TokenKind::HexColor => Expr::Literal(LiteralVal::HexColor(tok.lexeme.clone())),
        TokenKind::Regex => Expr::Literal(LiteralVal::Regex(tok.lexeme.clone())),
        TokenKind::TemplateNoSubst => Expr::Template { quasis: vec![tok.lexeme.clone()], exprs: Vec::new() },
        _ => return None,
    })
}

pub(crate) fn assign_op_from_tok(kind: TokenKind) -> Option<AssignOp> {
    Some(match kind {
        TokenKind::Equal => AssignOp::Assign, TokenKind::PlusEq => AssignOp::AddAssign,
        TokenKind::MinusEq => AssignOp::SubAssign, TokenKind::StarEq => AssignOp::MulAssign,
        TokenKind::SlashEq => AssignOp::DivAssign, TokenKind::SlashSlashEq => AssignOp::FloorDivAssign,
        TokenKind::TildeSlashEq => AssignOp::TruncDivAssign, TokenKind::PercentEq => AssignOp::ModAssign,
        TokenKind::StarStarEq => AssignOp::PowAssign, TokenKind::AmpEq => AssignOp::BitAndAssign,
        TokenKind::AmpCaretEq => AssignOp::BitClearAssign, TokenKind::PipeEq => AssignOp::BitOrAssign,
        TokenKind::CaretEq => AssignOp::BitXorAssign, TokenKind::ShlEq => AssignOp::ShlAssign,
        TokenKind::ShrEq => AssignOp::ShrAssign, TokenKind::UshrEq => AssignOp::UshrAssign,
        TokenKind::QuestionQuestionEq => AssignOp::CoalesceAssign, TokenKind::AmpAmpEq => AssignOp::AndAssign,
        TokenKind::PipePipeEq => AssignOp::OrAssign, TokenKind::DotEq => AssignOp::ConcatAssign, _ => return None,
    })
}

pub(crate) fn binary_op_from_tok(kind: TokenKind) -> BinaryOp {
    match kind {
        TokenKind::Plus => BinaryOp::Add, TokenKind::Concat => BinaryOp::Concat, TokenKind::Minus => BinaryOp::Sub,
        TokenKind::Star => BinaryOp::Mul, TokenKind::Slash => BinaryOp::Div, TokenKind::TildeSlash => BinaryOp::FloorDiv,
        TokenKind::Percent => BinaryOp::Mod, TokenKind::StarStar => BinaryOp::Pow,
        TokenKind::EqEq => BinaryOp::Eq, TokenKind::NotEq => BinaryOp::NotEq,
        TokenKind::Lt => BinaryOp::Lt, TokenKind::LtEq => BinaryOp::LtEq, TokenKind::Gt => BinaryOp::Gt,
        TokenKind::GtEq => BinaryOp::GtEq, TokenKind::Spaceship => BinaryOp::Spaceship,
        TokenKind::And | TokenKind::AmpAmp => BinaryOp::And, TokenKind::Or | TokenKind::PipePipe => BinaryOp::Or,
        TokenKind::QuestionQuestion => BinaryOp::Coalesce, TokenKind::Amp => BinaryOp::BitAnd,
        TokenKind::AmpCaret => BinaryOp::BitClear, TokenKind::Pipe => BinaryOp::BitOr, TokenKind::Caret => BinaryOp::BitXor,
        TokenKind::Shl => BinaryOp::Shl, TokenKind::Shr => BinaryOp::Shr, TokenKind::Ushr => BinaryOp::Ushr,
        TokenKind::In => BinaryOp::In, TokenKind::As => BinaryOp::As, _ => BinaryOp::Instanceof,
    }
}
