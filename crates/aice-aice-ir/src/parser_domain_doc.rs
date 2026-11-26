use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain::{DocBlock, DocSection, ShellDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;

pub(crate) fn parse_doc(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    Ok(AiceItem::Doc(parse_doc_section(p, trivia)?))
}

struct DocFrame {
    level: u8,
    heading: String,
    blocks: Vec<DocBlock>,
    children: Vec<DocSection>,
    tr: Trivia,
    has_indent: bool,
}

fn start_doc_section(p: &mut Parser<'_>, trivia: Trivia) -> Result<DocFrame, TranspileError> {
    p.advance(); // "doc"
    let level = p.expect(TokenKind::Number, "Expected heading level")?.lexeme.parse::<u8>().unwrap_or(1);
    let heading = p.expect(TokenKind::String, "Expected heading text")?.lexeme;
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    p.skip_newlines();
    let has_indent = p.eat(TokenKind::Indent);
    Ok(DocFrame { level, heading, blocks: Vec::new(), children: Vec::new(), tr, has_indent })
}

fn parse_doc_section(p: &mut Parser<'_>, trivia: Trivia) -> Result<DocSection, TranspileError> {
    let mut stack = vec![start_doc_section(p, trivia)?];
    loop {
        let has_indent = stack.last().map(|f| f.has_indent).unwrap_or(false);
        if !has_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            let cur = stack.pop().unwrap();
            if cur.has_indent { p.eat(TokenKind::Dedent); }
            let sec = DocSection {
                level: cur.level, heading: cur.heading, blocks: cur.blocks, children: cur.children, trivia: cur.tr,
            };
            if let Some(parent) = stack.last_mut() {
                parent.children.push(sec);
                p.eat_stmt_end();
                continue;
            }
            return Ok(sec);
        }
        let btr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        if p.peek().lexeme == "doc" {
            stack.push(start_doc_section(p, btr)?);
            continue;
        }
        let blk = parse_doc_block(p)?;
        if let Some(cur) = stack.last_mut() { cur.blocks.push(blk); }
        p.eat_stmt_end();
    }
}

fn parse_doc_block(p: &mut Parser<'_>) -> Result<DocBlock, TranspileError> {
    let kind = p.expect_ident_or_kw("Expected doc block")?.lexeme;
    match kind.as_str() {
        "hr" => Ok(DocBlock::ThematicBreak),
        "p" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(DocBlock::Paragraph(p.advance().lexeme)) }
        "quote" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(DocBlock::Quote(p.advance().lexeme)) }
        "li" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(DocBlock::ListItem { ordered: false, checked: None, text: p.advance().lexeme }) }
        "ol" => { p.expect(TokenKind::Colon, "Expected ':'")?; Ok(DocBlock::ListItem { ordered: true, checked: None, text: p.advance().lexeme }) }
        "todo" => {
            let chk = p.eat(TokenKind::LBracket) && { let v = p.peek().lexeme == "x"; p.advance(); p.expect(TokenKind::RBracket, "Expected ']'")?; v };
            p.expect(TokenKind::Colon, "Expected ':'")?;
            Ok(DocBlock::ListItem { ordered: false, checked: Some(chk), text: p.advance().lexeme })
        }
        "code" => {
            let lang = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { String::new() };
            p.expect(TokenKind::Colon, "Expected ':'")?;
            Ok(DocBlock::CodeFence { lang, code: p.advance().lexeme })
        }
        "fm" => {
            let marker = p.advance().lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            Ok(DocBlock::Frontmatter { marker, body: p.advance().lexeme })
        }
        "ref" => {
            let label = p.advance().lexeme;
            p.expect(TokenKind::Colon, "Expected ':'")?;
            Ok(DocBlock::LinkRef { label, dest: p.advance().lexeme })
        }
        "table" => {
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let (mut headers, mut rows) = (Vec::new(), Vec::new());
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let rk = p.expect_ident_or_kw("Expected th/tr")?.lexeme;
                    p.expect(TokenKind::Colon, "Expected ':'")?;
                    let mut cells = Vec::new();
                    while matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
                        cells.push(p.advance().lexeme);
                        if !p.eat(TokenKind::Comma) { break; }
                    }
                    if rk == "th" { headers = cells; } else { rows.push(cells); }
                    p.eat_stmt_end();
                }
                p.eat(TokenKind::Dedent);
            }
            Ok(DocBlock::Table { headers, rows })
        }
        _ => Ok(DocBlock::Paragraph(p.line_rest_raw())),
    }
}

pub(crate) fn parse_sh(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
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
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            let mut body_lines = Vec::new();
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let _ = p.collect_leading_trivia();
                    if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                    if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
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
