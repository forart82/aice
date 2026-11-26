use crate::lexer_tokens::{Token, TokenKind};

pub(crate) fn is_stmt_block_lbrace(out: &[Token]) -> bool {
    let toks: Vec<&Token> = out.iter().filter(|t| t.kind != TokenKind::Comment).collect();
    let Some(last) = toks.last() else {
        return false;
    };
    match last.kind {
        TokenKind::FatArrow => true,
        TokenKind::Colon => {
            if is_method_header_before(&toks[..toks.len() - 1]) {
                return true;
            }
            let mut d = 0usize;
            for (idx, t) in toks[..toks.len() - 1].iter().enumerate().rev() {
                match t.kind {
                    TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => d += 1,
                    TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => {
                        if d == 0 {
                            return false;
                        } else {
                            d -= 1;
                        }
                    }
                    TokenKind::Arrow if d == 0 => return is_fn_header_before(&toks[..idx]),
                    TokenKind::Newline
                    | TokenKind::Indent
                    | TokenKind::Dedent
                    | TokenKind::Semicolon
                        if d == 0 =>
                    {
                        break;
                    }
                    TokenKind::If
                    | TokenKind::Elif
                    | TokenKind::Else
                    | TokenKind::While
                    | TokenKind::For
                    | TokenKind::Loop
                    | TokenKind::Try
                    | TokenKind::Catch
                    | TokenKind::Finally
                    | TokenKind::Match
                    | TokenKind::Fn
                    | TokenKind::Async
                        if d == 0 =>
                    {
                        return true;
                    }
                    _ => {}
                }
            }
            false
        }
        TokenKind::Ident if last.lexeme == "static" => true,
        TokenKind::Arrow => false,
        _ => {
            if matches!(last.kind, TokenKind::RParen | TokenKind::Const) && is_fn_header_before(&toks) {
                return true;
            }
            let mut d = 0usize;
            for (idx, t) in toks.iter().enumerate().rev() {
                match t.kind {
                    TokenKind::RParen | TokenKind::RBracket | TokenKind::RBrace => d += 1,
                    TokenKind::LParen | TokenKind::LBracket | TokenKind::LBrace => {
                        if d == 0 {
                            return false;
                        } else {
                            d -= 1;
                        }
                    }
                    TokenKind::Arrow if d == 0 => return is_fn_header_before(&toks[..idx]),
                    TokenKind::Newline
                    | TokenKind::Indent
                    | TokenKind::Dedent
                    | TokenKind::Semicolon
                    | TokenKind::ColonEqual
                    | TokenKind::ColonColonEqual
                    | TokenKind::Equal
                    | TokenKind::Comma
                        if d == 0 =>
                    {
                        return false;
                    }
                    _ => {}
                }
            }
            false
        }
    }
}

fn find_header_pre_idx(toks: &[&Token]) -> Option<usize> {
    let toks = if toks.last().map(|t| t.kind) == Some(TokenKind::Const) {
        &toks[..toks.len() - 1]
    } else {
        toks
    };
    if toks.last().map(|t| t.kind) != Some(TokenKind::RParen) {
        return None;
    }
    let (mut d, mut open_idx) = (0usize, None);
    for (idx, t) in toks.iter().enumerate().rev() {
        match t.kind {
            TokenKind::RParen => d += 1,
            TokenKind::LParen => {
                d -= 1;
                if d == 0 {
                    open_idx = Some(idx);
                    break;
                }
            }
            _ => {}
        }
    }
    let mut pre = open_idx?;
    if pre >= 1 && toks[pre - 1].kind == TokenKind::RBracket {
        let (mut bd, mut lb_idx) = (0usize, None);
        for idx in (0..pre).rev() {
            match toks[idx].kind {
                TokenKind::RBracket => bd += 1,
                TokenKind::LBracket => {
                    bd -= 1;
                    if bd == 0 {
                        lb_idx = Some(idx);
                        break;
                    }
                }
                _ => {}
            }
        }
        pre = lb_idx?;
    }
    Some(pre)
}

fn is_fn_header_before(toks: &[&Token]) -> bool {
    let Some(pre) = find_header_pre_idx(toks) else {
        return false;
    };
    (pre >= 1 && toks[pre - 1].kind == TokenKind::Fn)
        || (pre >= 2 && toks[pre - 2].kind == TokenKind::Fn)
        || has_class_method_head(&toks[..pre])
}

fn is_method_header_before(toks: &[&Token]) -> bool {
    let Some(pre) = find_header_pre_idx(toks) else {
        return false;
    };
    has_class_method_head(&toks[..pre])
}

fn has_class_method_head(head: &[&Token]) -> bool {
    let n = head.len();
    if n >= 1 && head[n - 1].lexeme == "constructor" && has_decl_prefix(&head[..n - 1]) {
        return true;
    }
    if n >= 2
        && is_ident_or_kw(head[n - 1])
        && (head[n - 2].kind == TokenKind::Async
            || matches!(head[n - 2].lexeme.as_str(), "get" | "set"))
        && has_decl_prefix(&head[..n - 2])
    {
        return true;
    }
    n >= 3
        && head[n - 3].kind == TokenKind::Async
        && matches!(head[n - 2].lexeme.as_str(), "get" | "set")
        && is_ident_or_kw(head[n - 1])
        && has_decl_prefix(&head[..n - 3])
}

fn is_ident_or_kw(t: &Token) -> bool {
    t.kind == TokenKind::Ident || t.is_keyword()
}

fn has_decl_prefix(prefix: &[&Token]) -> bool {
    for t in prefix.iter().rev() {
        match t.kind {
            TokenKind::Newline
            | TokenKind::Indent
            | TokenKind::Dedent
            | TokenKind::Semicolon
            | TokenKind::LBrace => return true,
            TokenKind::Pub
            | TokenKind::Priv
            | TokenKind::Prot
            | TokenKind::Pkg
            | TokenKind::Async => {}
            TokenKind::Ident
                if matches!(
                    t.lexeme.as_str(),
                    "static" | "abstract" | "override" | "final" | "virtual"
                ) => {}
            _ => return false,
        }
    }
    true
}
