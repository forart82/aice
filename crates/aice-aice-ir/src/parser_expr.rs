use crate::ir::TranspileError;
use crate::ir_code::{AssignOp, BinaryOp, Expr, LiteralVal, MemberKind, UnaryOp};
use crate::lexer_tokens::{Token, TokenKind};
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal, run_parse_loop};

pub(crate) fn parse_expr(p: &mut Parser<'_>) -> Result<Expr, TranspileError> {
    match run_parse_loop(p, ParseCont::Expr(1))? {
        ParseVal::Expr(e) => Ok(e),
        _ => unreachable!(),
    }
}

pub(crate) fn step_member_infix(
    p: &mut Parser<'_>,
    lhs: Expr,
    kind: TokenKind,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
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
        stack.push(ParseCont::ExprIndex { object: lhs, is_optional: true });
        stack.push(ParseCont::Expr(1));
        return Ok(());
    }
    let mk = match kind {
        TokenKind::QuestionDot => MemberKind::SafeNav,
        TokenKind::ColonColon => MemberKind::Scope,
        _ => MemberKind::Dot,
    };
    let prop = if kind == TokenKind::Dot && p.eat(TokenKind::Hash) {
        format!("#{}", p.expect_ident_or_kw("Expected private member name")?.lexeme)
    } else if kind == TokenKind::Dot && p.peek_kind() == TokenKind::HexColor {
        p.advance().lexeme
    } else {
        p.expect_ident_or_kw("Expected member name")?.lexeme
    };
    vals.push(ParseVal::Expr(Expr::Member { object: Box::new(lhs), property: prop, kind: mk }));
    Ok(())
}

pub(crate) fn parse_new_prefix(
    p: &mut Parser<'_>,
    stack: &mut Vec<ParseCont>,
    vals: &mut Vec<ParseVal>,
) -> Result<(), TranspileError> {
    p.advance(); // "new"
    let mut ctor = Expr::Ident(p.advance().lexeme);
    while matches!(p.peek_kind(), TokenKind::Dot | TokenKind::ColonColon) {
        let mk = if p.advance().kind == TokenKind::ColonColon { MemberKind::Scope } else { MemberKind::Dot };
        let prop = p.expect_ident_or_kw("Expected member name")?.lexeme;
        ctor = Expr::Member { object: Box::new(ctor), property: prop, kind: mk };
    }
    if p.peek_kind() == TokenKind::Lt {
        let start = p.peek().span.start_byte;
        let (mut depth, mut end) = (0usize, start);
        while !p.at_eof() {
            let t = p.advance();
            end = t.span.end_byte;
            if t.kind == TokenKind::Lt { depth += 1; }
            else if t.kind == TokenKind::Gt {
                depth = depth.saturating_sub(1);
                if depth == 0 { break; }
            } else if t.kind == TokenKind::Shr {
                depth = depth.saturating_sub(2);
                if depth == 0 { break; }
            }
        }
        let gargs = &p.src[start..end];
        match &mut ctor {
            Expr::Ident(s) => s.push_str(gargs),
            Expr::Member { property, .. } => property.push_str(gargs),
            _ => {}
        }
    }
    if p.eat(TokenKind::LParen) {
        if p.peek_kind() == TokenKind::RParen || p.at_eof() {
            p.expect(TokenKind::RParen, "Expected ')'")?;
            vals.push(ParseVal::Expr(Expr::Call {
                callee: Box::new(ctor), args: Vec::new(), is_optional: false, is_tagged: false, is_new: true,
            }));
        } else {
            stack.push(ParseCont::ExprCallArg { callee: ctor, args: Vec::new(), is_optional: false, is_new: true });
            stack.push(ParseCont::Expr(1));
        }
    } else {
        vals.push(ParseVal::Expr(Expr::Call {
            callee: Box::new(ctor), args: Vec::new(), is_optional: false, is_tagged: false, is_new: true,
        }));
    }
    Ok(())
}

pub(crate) fn infix_prec(kind: TokenKind) -> Option<(u8, bool)> {
    if assign_op_from_tok(kind).is_some() {
        return Some((2, true));
    }
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
        TokenKind::Plus | TokenKind::Minus => Some((12, false)),
        TokenKind::Star | TokenKind::Slash | TokenKind::TildeSlash
        | TokenKind::Percent | TokenKind::AmpCaret => Some((13, false)),
        TokenKind::StarStar => Some((14, true)),
        TokenKind::As => Some((15, false)),
        TokenKind::LParen | TokenKind::LBracket | TokenKind::Dot | TokenKind::QuestionDot
        | TokenKind::ColonColon | TokenKind::PlusPlus | TokenKind::MinusMinus => Some((17, false)),
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
                | TokenKind::Arrow
        )
}

pub(crate) fn is_elvis_ahead(p: &Parser<'_>) -> bool {
    p.peek_kind() == TokenKind::Question
        && p.peek_n(1).kind == TokenKind::Colon
        && p.peek().span.end_byte == p.peek_n(1).span.start_byte
        && can_start_expr_tok(p.peek_n(2).kind)
}

pub(crate) fn looks_like_ternary(p: &Parser<'_>) -> bool {
    if is_elvis_ahead(p) {
        return true;
    }
    if p.peek_n(1).kind == TokenKind::Colon {
        return false;
    }
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
    if min_prec > 10 {
        return None;
    }
    let k0 = p.peek_kind();
    let k1 = p.peek_n(1).kind;
    if k0 == TokenKind::Ident && p.peek().lexeme == "is" {
        if k1 == TokenKind::Not && can_start_expr_tok(p.peek_n(2).kind) {
            p.advance();
            p.advance();
            return Some((BinaryOp::IsNot, 11));
        }
        if can_start_expr_tok(k1) {
            p.advance();
            return Some((BinaryOp::Is, 11));
        }
    } else if matches!(k0, TokenKind::Not | TokenKind::Bang) && k1 == TokenKind::In {
        p.advance();
        p.advance();
        return Some((BinaryOp::NotIn, 11));
    } else if k0 == TokenKind::Bang && k1 == TokenKind::Ident && p.peek_n(1).lexeme == "is" {
        p.advance();
        p.advance();
        return Some((BinaryOp::IsNot, 11));
    }
    None
}

pub(crate) fn try_contextual_unary(p: &Parser<'_>, tok: &Token) -> Option<UnaryOp> {
    if tok.kind != TokenKind::Ident {
        return None;
    }
    let op = match tok.lexeme.as_str() {
        "typeof" => UnaryOp::Typeof,
        "void" => UnaryOp::Void,
        "delete" => UnaryOp::Delete,
        "yield" => UnaryOp::Yield,
        _ => return None,
    };
    let next = p.peek_n(1);
    if !can_start_expr_tok(next.kind) {
        return None;
    }
    if next.kind == TokenKind::LParen && tok.span.end_byte == next.span.start_byte {
        return None;
    }
    Some(op)
}

pub(crate) fn lit_expr_from_tok(tok: &Token) -> Option<Expr> {
    Some(match tok.kind {
        TokenKind::Number => {
            let lit = if tok.lexeme.contains('.') || tok.lexeme.contains('e') || tok.lexeme.contains('E') {
                LiteralVal::Float(tok.lexeme.clone())
            } else {
                LiteralVal::Int(tok.lexeme.clone())
            };
            Expr::Literal(lit)
        }
        TokenKind::String => Expr::Literal(LiteralVal::Str { value: tok.lexeme.clone(), multiline: false }),
        TokenKind::TripleString => Expr::Literal(LiteralVal::Str { value: tok.lexeme.clone(), multiline: true }),
        TokenKind::Boolean => Expr::Literal(LiteralVal::Bool(tok.lexeme == "true")),
        TokenKind::Nil => Expr::Literal(LiteralVal::Nil),
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
        TokenKind::PipePipeEq => AssignOp::OrAssign, TokenKind::DotEq => AssignOp::ConcatAssign,
        _ => return None,
    })
}

pub(crate) fn binary_op_from_tok(kind: TokenKind) -> BinaryOp {
    match kind {
        TokenKind::Plus => BinaryOp::Add, TokenKind::Minus => BinaryOp::Sub,
        TokenKind::Star => BinaryOp::Mul, TokenKind::Slash => BinaryOp::Div,
        TokenKind::TildeSlash => BinaryOp::FloorDiv,
        TokenKind::Percent => BinaryOp::Mod, TokenKind::StarStar => BinaryOp::Pow,
        TokenKind::EqEq => BinaryOp::Eq, TokenKind::NotEq => BinaryOp::NotEq,
        TokenKind::Lt => BinaryOp::Lt, TokenKind::LtEq => BinaryOp::LtEq,
        TokenKind::Gt => BinaryOp::Gt, TokenKind::GtEq => BinaryOp::GtEq,
        TokenKind::Spaceship => BinaryOp::Spaceship,
        TokenKind::And | TokenKind::AmpAmp => BinaryOp::And,
        TokenKind::Or | TokenKind::PipePipe => BinaryOp::Or,
        TokenKind::QuestionQuestion => BinaryOp::Coalesce,
        TokenKind::Amp => BinaryOp::BitAnd, TokenKind::AmpCaret => BinaryOp::BitClear,
        TokenKind::Pipe => BinaryOp::BitOr, TokenKind::Caret => BinaryOp::BitXor,
        TokenKind::Shl => BinaryOp::Shl, TokenKind::Shr => BinaryOp::Shr, TokenKind::Ushr => BinaryOp::Ushr,
        TokenKind::In => BinaryOp::In, TokenKind::As => BinaryOp::As,
        _ => BinaryOp::Instanceof,
    }
}
