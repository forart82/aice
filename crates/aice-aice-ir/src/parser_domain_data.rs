use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
pub(crate) use crate::parser_domain_doc::{parse_doc, parse_sh};

pub(crate) fn parse_data(p: &mut Parser<'_>, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.advance(); // "data"
    let fmt_str = p.expect_ident_or_kw("Expected data format")?.lexeme;
    let format = match fmt_str.as_str() {
        "yaml" => DataFormatKind::Yaml,
        "toml" => DataFormatKind::Toml,
        "xml" => DataFormatKind::Xml,
        _ => DataFormatKind::Json,
    };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    let (mut prolog, mut root) = (Vec::new(), Vec::new());
    p.skip_newlines();
    if p.eat(TokenKind::Indent) {
        while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
            let ntr = p.collect_leading_trivia();
            if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
            if p.peek().lexeme == "prolog" {
                p.advance();
                p.expect(TokenKind::Colon, "Expected ':'")?;
                prolog.push(p.expect(TokenKind::String, "Expected prolog string")?.lexeme);
                let _ = p.take_trailing_comment();
            } else {
                root.push(parse_data_node(p, ntr)?);
            }
            p.eat_stmt_end();
        }
        p.eat(TokenKind::Dedent);
    }
    Ok(AiceItem::Data(DataDecl { format, prolog, root, trivia: tr, span: sp }))
}

enum DataOwner {
    Table { path: String, is_array_table: bool, tr: Trivia },
    Xml { tag: String, attrs: Vec<(String, String)>, tr: Trivia },
    Keyed { key: Option<String>, tr: Trivia },
}

enum DataStep {
    Done(DataNode),
    EnterChildren(DataOwner),
}

fn parse_data_node(p: &mut Parser<'_>, init_trivia: Trivia) -> Result<DataNode, TranspileError> {
    let mut blocks: Vec<Vec<DataNode>> = Vec::new();
    let mut owners: Vec<DataOwner> = Vec::new();
    match step_data_node(p, init_trivia)? {
        DataStep::Done(n) => return Ok(n),
        DataStep::EnterChildren(owner) => {
            p.skip_newlines();
            let has_indent = p.eat(TokenKind::Indent);
            if !has_indent { return Ok(build_data_parent(owner, Vec::new())); }
            blocks.push(Vec::new());
            owners.push(owner);
        }
    }
    loop {
        if p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            let children = blocks.pop().unwrap_or_default();
            p.eat(TokenKind::Dedent);
            let owner = owners.pop().unwrap();
            let node = build_data_parent(owner, children);
            if let Some(parent_list) = blocks.last_mut() {
                parent_list.push(node);
                p.eat_stmt_end();
                continue;
            }
            return Ok(node);
        }
        let ntr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        match step_data_node(p, ntr)? {
            DataStep::Done(node) => {
                if let Some(cur) = blocks.last_mut() { cur.push(node); }
                p.eat_stmt_end();
            }
            DataStep::EnterChildren(owner) => {
                p.skip_newlines();
                if p.eat(TokenKind::Indent) {
                    blocks.push(Vec::new());
                    owners.push(owner);
                } else {
                    let node = build_data_parent(owner, Vec::new());
                    if let Some(cur) = blocks.last_mut() { cur.push(node); }
                    p.eat_stmt_end();
                }
            }
        }
    }
}

fn build_data_parent(owner: DataOwner, children: Vec<DataNode>) -> DataNode {
    match owner {
        DataOwner::Table { path, is_array_table, tr } => {
            DataNode::TableSection { path, is_array_table, entries: children, trivia: tr }
        }
        DataOwner::Xml { tag, attrs, tr } => {
            DataNode::XmlElem { tag, attrs, text: None, children, trivia: tr }
        }
        DataOwner::Keyed { key, tr } => {
            let is_seq = children.iter().any(|n| {
                matches!(n, DataNode::Scalar { key: None, .. } | DataNode::Map { key: None, .. } | DataNode::Seq { key: None, .. })
            });
            if is_seq { DataNode::Seq { key, items: children, trivia: tr } }
            else { DataNode::Map { key, entries: children, trivia: tr } }
        }
    }
}

fn step_data_node(p: &mut Parser<'_>, mut tr: Trivia) -> Result<DataStep, TranspileError> {
    if p.peek().lexeme == "section" {
        p.advance();
        let is_array_table = p.eat(TokenKind::LBracket) && p.eat(TokenKind::RBracket);
        let path = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
        p.expect(TokenKind::Colon, "Expected ':'")?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::EnterChildren(DataOwner::Table { path, is_array_table, tr }));
    }
    if p.peek().lexeme == "dtd" {
        p.advance();
        let kind = p.expect_ident_or_kw("Expected dtd kind")?.lexeme;
        let name = p.expect_ident_or_kw("Expected dtd name")?.lexeme;
        p.expect(TokenKind::Colon, "Expected ':'")?;
        let spec = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw() };
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::Done(DataNode::DtdDecl { kind, name, spec, trivia: tr }));
    }
    if p.peek().lexeme == "xml" {
        p.advance();
        let tag = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.expect_ident_or_kw("Expected xml tag")?.lexeme };
        let mut attrs = Vec::new();
        if p.eat(TokenKind::LParen) {
            while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
                let k = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
                p.expect(TokenKind::Colon, "Expected ':'")?;
                let v = p.expect(TokenKind::String, "Expected attr value")?.lexeme;
                attrs.push((k, v));
                if !p.eat(TokenKind::Comma) { break; }
            }
            p.expect(TokenKind::RParen, "Expected ')'")?;
        }
        if p.eat(TokenKind::Colon) {
            if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
                let text = Some(p.advance().lexeme);
                if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
                return Ok(DataStep::Done(DataNode::XmlElem { tag, attrs, text, children: Vec::new(), trivia: tr }));
            }
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            return Ok(DataStep::EnterChildren(DataOwner::Xml { tag, attrs, tr }));
        }
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::Done(DataNode::XmlElem { tag, attrs, text: None, children: Vec::new(), trivia: tr }));
    }
    let key = if p.eat(TokenKind::Minus) { None } else {
        let k = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
        p.expect(TokenKind::Colon, "Expected ':'")?;
        Some(k)
    };
    if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::EnterChildren(DataOwner::Keyed { key, tr }));
    }
    let val = parse_data_scalar(p)?;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(DataStep::Done(DataNode::Scalar { key, val, anchor: None, tag: None, trivia: tr }))
}

fn parse_data_scalar(p: &mut Parser<'_>) -> Result<DataScalar, TranspileError> {
    match p.peek_kind() {
        TokenKind::String | TokenKind::TripleString => Ok(DataScalar::Str(p.advance().lexeme)),
        TokenKind::Number => {
            let l = p.advance().lexeme;
            Ok(if l.contains('.') || l.contains('e') || l.contains('E') { DataScalar::Float(l) } else { DataScalar::Int(l) })
        }
        TokenKind::Boolean => Ok(DataScalar::Bool(p.advance().lexeme == "true")),
        TokenKind::Nil => { p.advance(); Ok(DataScalar::Null) }
        TokenKind::LBracket => { p.advance(); p.expect(TokenKind::RBracket, "Expected ']'")?; Ok(DataScalar::Raw("[]".into())) }
        TokenKind::LBrace => { p.advance(); p.expect(TokenKind::RBrace, "Expected '}'")?; Ok(DataScalar::Raw("{}".into())) }
        _ => Ok(DataScalar::Raw(p.line_rest_raw())),
    }
}
