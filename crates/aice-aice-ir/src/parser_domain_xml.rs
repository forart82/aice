use crate::ir::{TranspileError, Trivia};
use crate::ir_domain::DataNode;
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;

pub(crate) fn parse_xml_attr_key(p: &mut Parser<'_>) -> Result<String, TranspileError> {
    if p.peek_kind() == TokenKind::String { return Ok(p.advance().lexeme); }
    let (mut s, mut e) = (None, 0usize);
    while !matches!(p.peek_kind(), TokenKind::Equal | TokenKind::Colon | TokenKind::Comma | TokenKind::RParen | TokenKind::Newline | TokenKind::Eof) {
        let t = p.advance();
        if t.span.end_byte > t.span.start_byte {
            if s.is_none() { s = Some(t.span.start_byte); }
            e = t.span.end_byte;
        }
    }
    Ok(s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default())
}

pub(crate) fn parse_xml_attr_val(p: &mut Parser<'_>) -> String {
    if p.peek_kind() == TokenKind::String { return p.advance().lexeme; }
    let (mut s, mut e) = (None, 0usize);
    while !matches!(p.peek_kind(), TokenKind::Comma | TokenKind::RParen | TokenKind::Newline | TokenKind::Eof) {
        if s.is_some()
            && p.peek().span.start_byte > e
            && (p.peek_kind() == TokenKind::String || p.peek_kind() == TokenKind::Ident || p.peek().is_keyword())
        {
            break;
        }
        let t = p.advance();
        if t.span.end_byte > t.span.start_byte {
            if s.is_none() { s = Some(t.span.start_byte); }
            e = t.span.end_byte;
        }
    }
    s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default()
}

pub(crate) enum XmlParsed {
    Done(DataNode),
    EnterChildren { tag: String, attrs: Vec<(String, String)>, tr: Trivia },
}

pub(crate) fn parse_xml_elem(p: &mut Parser<'_>, mut tr: Trivia) -> Result<XmlParsed, TranspileError> {
    let tag = if p.peek_kind() == TokenKind::String {
        p.advance().lexeme
    } else {
        let mut s = p.expect_ident_or_kw("Expected xml tag")?.lexeme;
        while p.eat(TokenKind::Minus) { s.push('-'); s.push_str(&p.expect_ident_or_kw("Expected xml tag segment")?.lexeme); }
        s
    };
    let mut attrs = Vec::new();
    if p.eat(TokenKind::LParen) {
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            let k = parse_xml_attr_key(p)?;
            if !p.eat(TokenKind::Equal) { p.expect(TokenKind::Colon, "Expected '=' or ':'")?; }
            attrs.push((k, parse_xml_attr_val(p)));
            p.eat(TokenKind::Comma);
        }
        p.expect(TokenKind::RParen, "Expected ')'")?;
    }
    if p.eat(TokenKind::Colon) {
        if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            return Ok(XmlParsed::EnterChildren { tag, attrs, tr });
        }
        let text = Some(if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString)
            && matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof)
        { p.advance().lexeme } else { p.line_rest_raw() });
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(XmlParsed::Done(DataNode::XmlElem { tag, attrs, text, children: Vec::new(), trivia: tr }));
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(XmlParsed::Done(DataNode::XmlElem { tag, attrs, text: None, children: Vec::new(), trivia: tr }))
}
