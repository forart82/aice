pub use crate::ir::Span;
use crate::ir::TranspileError;
use crate::lexer_blocks::is_stmt_block_lbrace;
use crate::lexer_scan::{RawKind, RawTok, scan_raw};
pub use crate::lexer_tokens::{Token, TokenKind};

pub fn lex(src: &str) -> Result<Vec<Token>, TranspileError> {
    let raw = scan_raw(src)?;
    filter_indentation(raw, false)
}

pub fn lex_with_trivia(src: &str) -> Result<Vec<Token>, TranspileError> {
    let raw = scan_raw(src)?;
    filter_indentation(raw, true)
}

pub fn tokenize(src: &str) -> Vec<Token> {
    lex(src).unwrap_or_default()
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum BracketKind {
    Expr,
    StmtBlock { saved_indent_len: usize },
}

fn filter_indentation(raw: Vec<RawTok>, keep_comments: bool) -> Result<Vec<Token>, TranspileError> {
    let mut out: Vec<Token> = Vec::new();
    let mut indent_stack: Vec<usize> = vec![0];
    let mut bracket_stack: Vec<BracketKind> = Vec::new();
    let mut pending_indent: Option<(usize, Span)> = None;
    let mut line_has_tokens = false;
    let mut last_line = 1usize;

    for r in raw {
        last_line = r.span.line.max(last_line);
        let in_expr_bracket = matches!(bracket_stack.last(), Some(BracketKind::Expr));
        match r.kind {
            RawKind::LeadingIndent(w) => {
                pending_indent = Some((w, r.span));
            }
            RawKind::Newline => {
                if line_has_tokens && !in_expr_bracket {
                    let last = out.last().map(|t| t.kind);
                    if !matches!(last, Some(TokenKind::Newline | TokenKind::Indent)) {
                        out.push(Token {
                            kind: TokenKind::Newline,
                            lexeme: "\n".to_string(),
                            line: r.span.line,
                            span: r.span,
                        });
                    }
                } else if keep_comments && !line_has_tokens && pending_indent.is_none() {
                    // Blank line between trivia blocks
                    out.push(Token {
                        kind: TokenKind::Newline,
                        lexeme: "\n".to_string(),
                        line: r.span.line,
                        span: r.span,
                    });
                }
                pending_indent = None;
                line_has_tokens = false;
            }
            RawKind::Tok(kind, lexeme) => {
                if kind == TokenKind::Comment {
                    if !in_expr_bracket
                        && let Some((w, ind_span)) = pending_indent.take()
                    {
                        let top = *indent_stack.last().unwrap_or(&0);
                        if w > top {
                            indent_stack.push(w);
                            out.push(Token {
                                kind: TokenKind::Indent,
                                lexeme: String::new(),
                                line: ind_span.line,
                                span: ind_span,
                            });
                        } else if w < top {
                            while let Some(&cur) = indent_stack.last() {
                                if cur <= w {
                                    break;
                                }
                                indent_stack.pop();
                                out.push(Token {
                                    kind: TokenKind::Dedent,
                                    lexeme: String::new(),
                                    line: ind_span.line,
                                    span: ind_span,
                                });
                            }
                        }
                    } else {
                        pending_indent = None;
                    }
                    if !keep_comments {
                        continue;
                    }
                    line_has_tokens = true;
                    out.push(Token {
                        kind,
                        lexeme,
                        line: r.span.line,
                        span: r.span,
                    });
                    continue;
                }
                let closing_stmt_block = kind == TokenKind::RBrace
                    && matches!(bracket_stack.last(), Some(BracketKind::StmtBlock { .. }));
                if !in_expr_bracket
                    && let Some((w, ind_span)) = pending_indent.take()
                {
                    let top = *indent_stack.last().unwrap_or(&0);
                    if w > top {
                        indent_stack.push(w);
                        out.push(Token {
                            kind: TokenKind::Indent,
                            lexeme: String::new(),
                            line: ind_span.line,
                            span: ind_span,
                        });
                    } else if w < top {
                        let min_len = match bracket_stack.last() {
                            Some(&BracketKind::StmtBlock { saved_indent_len }) if closing_stmt_block => {
                                saved_indent_len
                            }
                            _ => 1,
                        };
                        while indent_stack.len() > min_len
                            && let Some(&cur) = indent_stack.last()
                        {
                            if cur <= w {
                                break;
                            }
                            indent_stack.pop();
                            out.push(Token {
                                kind: TokenKind::Dedent,
                                lexeme: String::new(),
                                line: ind_span.line,
                                span: ind_span,
                            });
                        }
                        if !closing_stmt_block && indent_stack.last().copied().unwrap_or(0) != w {
                            return Err(TranspileError::at(
                                format!("Inconsistent indentation width {w}"),
                                ind_span,
                            ));
                        }
                    }
                } else {
                    pending_indent = None;
                }

                match kind {
                    TokenKind::LParen | TokenKind::LBracket | TokenKind::TemplateHead => {
                        bracket_stack.push(BracketKind::Expr);
                    }
                    TokenKind::LBrace => {
                        if is_stmt_block_lbrace(&out) {
                            bracket_stack.push(BracketKind::StmtBlock {
                                saved_indent_len: indent_stack.len(),
                            });
                        } else {
                            bracket_stack.push(BracketKind::Expr);
                        }
                    }
                    TokenKind::RParen | TokenKind::RBracket | TokenKind::TemplateTail => {
                        bracket_stack.pop();
                    }
                    TokenKind::RBrace => {
                        if let Some(BracketKind::StmtBlock { saved_indent_len }) = bracket_stack.pop() {
                            while indent_stack.len() > saved_indent_len {
                                indent_stack.pop();
                                out.push(Token {
                                    kind: TokenKind::Dedent,
                                    lexeme: String::new(),
                                    line: r.span.line,
                                    span: r.span,
                                });
                            }
                        }
                    }
                    _ => {}
                }

                line_has_tokens = true;
                out.push(Token {
                    kind,
                    lexeme,
                    line: r.span.line,
                    span: r.span,
                });
            }
        }
    }

    if line_has_tokens {
        let last = out.last().map(|t| t.kind);
        if !matches!(last, Some(TokenKind::Newline | TokenKind::Indent | TokenKind::Dedent)) {
            out.push(Token {
                kind: TokenKind::Newline,
                lexeme: "\n".to_string(),
                line: last_line,
                span: Span::new(last_line, 1, 0, 0),
            });
        }
    }

    while indent_stack.len() > 1 {
        indent_stack.pop();
        out.push(Token {
            kind: TokenKind::Dedent,
            lexeme: String::new(),
            line: last_line,
            span: Span::new(last_line, 1, 0, 0),
        });
    }

    out.push(Token {
        kind: TokenKind::Eof,
        lexeme: String::new(),
        line: last_line,
        span: Span::new(last_line, 1, 0, 0),
    });
    Ok(out)
}
