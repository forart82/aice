use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain::ShellDecl;
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;

pub(crate) fn parse_sh(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    if p.peek().lexeme != "sh" && p.peek_n(1).kind == TokenKind::RawLine {
        let kind = p.advance().lexeme;
        let payload = p.advance().lexeme;
        return match kind.as_str() {
            "shebang" => Ok(AiceItem::Shell(ShellDecl::Shebang(payload))),
            "set" => Ok(AiceItem::Shell(ShellDecl::SetFlags(payload))),
            "var" => {
                let (exported, r1) = match payload.strip_prefix("export ") { Some(r) => (true, r), None => (false, payload.as_str()) };
                let (readonly, r2) = match r1.strip_prefix("ro ") { Some(r) => (true, r), None => (false, r1) };
                let (name, value) = r2.split_once('=').unwrap_or((r2, ""));
                Ok(AiceItem::Shell(ShellDecl::Var { name: name.into(), value: value.into(), exported, readonly, trivia }))
            }
            _ => Ok(AiceItem::Shell(ShellDecl::Cmd { text: payload, trivia })),
        };
    }
    p.advance(); // "sh"
    let kind = p.expect_ident_or_kw("Expected sh kind")?.lexeme;
    match kind.as_str() {
        "shebang" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(AiceItem::Shell(ShellDecl::Shebang(p.advance().lexeme))) }
        "set" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(AiceItem::Shell(ShellDecl::SetFlags(p.advance().lexeme))) }
        "var" => {
            let exported = p.peek().lexeme == "export" && { p.advance(); true };
            let readonly = p.peek().lexeme == "ro" && { p.advance(); true };
            let name = p.expect_ident_or_kw("Expected var")?.lexeme;
            p.expect(TokenKind::Equal, "Expected '='")?;
            let value = p.advance().lexeme;
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::Shell(ShellDecl::Var { name, value, exported, readonly, trivia: tr }))
        }
        "fn" => {
            let name = p.expect_ident_or_kw("Expected fn name")?.lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let mut tr = trivia;
            if p.peek_kind() == TokenKind::TripleString {
                let body = p.advance().lexeme;
                let body_lines: Vec<String> = body.split('\n').map(str::to_string).collect();
                if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
                return Ok(AiceItem::Shell(ShellDecl::Fn { name, body_lines, trivia: tr }));
            }
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            let mut body_lines = Vec::new();
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let _ = p.collect_leading_trivia();
                    if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                    if matches!(p.peek_kind(), TokenKind::RawLine | TokenKind::String | TokenKind::TripleString) {
                        body_lines.push(p.advance().lexeme);
                    } else { body_lines.push(p.line_rest_raw()); }
                    p.eat_stmt_end();
                }
                p.eat(TokenKind::Dedent);
            }
            Ok(AiceItem::Shell(ShellDecl::Fn { name, body_lines, trivia: tr }))
        }
        _ => {
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let text = p.advance().lexeme;
            let mut tr = trivia;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            Ok(AiceItem::Shell(ShellDecl::Cmd { text, trivia: tr }))
        }
    }
}
