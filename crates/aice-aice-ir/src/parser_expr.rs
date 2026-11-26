use crate::ir::TranspileError;
use crate::ir_code::{AssignOp, BinaryOp, Expr, MemberKind};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_iter::{ParseCont, ParseVal, run_parse_loop};

pub(crate) fn parse_expr(p: &mut Parser<'_>) -> Result<Expr, TranspileError> {
    match run_parse_loop(p, ParseCont::Expr(1))? {
        ParseVal::Expr(e) => Ok(e),
        _ => unreachable!(),
    }
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
    match kind {
        TokenKind::Equal | TokenKind::PlusEq | TokenKind::MinusEq | TokenKind::StarEq
        | TokenKind::SlashEq | TokenKind::PercentEq | TokenKind::StarStarEq
        | TokenKind::AmpEq | TokenKind::PipeEq | TokenKind::CaretEq
        | TokenKind::ShlEq | TokenKind::ShrEq | TokenKind::UshrEq => Some((2, true)),
        TokenKind::Question => Some((3, true)),
        TokenKind::Or | TokenKind::PipePipe => Some((3, false)),
        TokenKind::And | TokenKind::AmpAmp => Some((4, false)),
        TokenKind::QuestionQuestion => Some((5, false)),
        TokenKind::Pipe => Some((6, false)),
        TokenKind::Caret => Some((7, false)),
        TokenKind::Amp => Some((8, false)),
        TokenKind::EqEq | TokenKind::NotEq => Some((9, false)),
        TokenKind::Lt | TokenKind::LtEq | TokenKind::Gt | TokenKind::GtEq
        | TokenKind::In | TokenKind::Instanceof => Some((10, false)),
        TokenKind::Shl | TokenKind::Shr | TokenKind::Ushr => Some((11, false)),
        TokenKind::Plus | TokenKind::Minus => Some((12, false)),
        TokenKind::Star | TokenKind::Slash | TokenKind::Percent => Some((13, false)),
        TokenKind::StarStar => Some((14, true)),
        TokenKind::As => Some((15, false)),
        TokenKind::LParen | TokenKind::LBracket | TokenKind::Dot | TokenKind::QuestionDot
        | TokenKind::ColonColon | TokenKind::PlusPlus | TokenKind::MinusMinus => Some((17, false)),
        _ => None,
    }
}

pub(crate) fn looks_like_ternary(p: &Parser<'_>) -> bool {
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

pub(crate) fn assign_op_from_tok(kind: TokenKind) -> Option<AssignOp> {
    Some(match kind {
        TokenKind::Equal => AssignOp::Assign, TokenKind::PlusEq => AssignOp::AddAssign,
        TokenKind::MinusEq => AssignOp::SubAssign, TokenKind::StarEq => AssignOp::MulAssign,
        TokenKind::SlashEq => AssignOp::DivAssign, TokenKind::PercentEq => AssignOp::ModAssign,
        TokenKind::StarStarEq => AssignOp::PowAssign, TokenKind::AmpEq => AssignOp::BitAndAssign,
        TokenKind::PipeEq => AssignOp::BitOrAssign, TokenKind::CaretEq => AssignOp::BitXorAssign,
        TokenKind::ShlEq => AssignOp::ShlAssign, TokenKind::ShrEq => AssignOp::ShrAssign,
        TokenKind::UshrEq => AssignOp::UshrAssign, _ => return None,
    })
}

pub(crate) fn binary_op_from_tok(kind: TokenKind) -> BinaryOp {
    match kind {
        TokenKind::Plus => BinaryOp::Add, TokenKind::Minus => BinaryOp::Sub,
        TokenKind::Star => BinaryOp::Mul, TokenKind::Slash => BinaryOp::Div,
        TokenKind::Percent => BinaryOp::Mod, TokenKind::StarStar => BinaryOp::Pow,
        TokenKind::EqEq => BinaryOp::Eq, TokenKind::NotEq => BinaryOp::NotEq,
        TokenKind::Lt => BinaryOp::Lt, TokenKind::LtEq => BinaryOp::LtEq,
        TokenKind::Gt => BinaryOp::Gt, TokenKind::GtEq => BinaryOp::GtEq,
        TokenKind::And | TokenKind::AmpAmp => BinaryOp::And,
        TokenKind::Or | TokenKind::PipePipe => BinaryOp::Or,
        TokenKind::QuestionQuestion => BinaryOp::Coalesce,
        TokenKind::Amp => BinaryOp::BitAnd, TokenKind::Pipe => BinaryOp::BitOr,
        TokenKind::Caret => BinaryOp::BitXor, TokenKind::Shl => BinaryOp::Shl,
        TokenKind::Shr => BinaryOp::Shr, TokenKind::Ushr => BinaryOp::Ushr,
        TokenKind::In => BinaryOp::In, TokenKind::As => BinaryOp::As,
        _ => BinaryOp::Instanceof,
    }
}
