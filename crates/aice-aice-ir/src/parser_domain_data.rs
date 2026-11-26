use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain::{DataDecl, DataFormatKind, DataNode, DataScalar};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
pub(crate) use crate::parser_domain_doc::{parse_doc, parse_sh};
use crate::parser_domain_xml::{XmlParsed, parse_xml_attr_key, parse_xml_elem};

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
            if p.peek().lexeme == "prolog" && p.peek_n(1).kind == TokenKind::RawLine {
                p.advance(); prolog.push(p.advance().lexeme);
            } else if p.peek().lexeme == "prolog" && p.peek_n(1).kind == TokenKind::Colon {
                p.advance(); p.advance();
                prolog.push(p.expect(TokenKind::String, "Expected prolog string")?.lexeme);
                let _ = p.take_trailing_comment();
            } else {
                root.push(parse_data_node(p, ntr, format == DataFormatKind::Xml)?);
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
    Keyed { key: Option<String>, tr: Trivia, force_map: bool },
}

enum DataStep {
    Done(DataNode),
    EnterChildren(DataOwner, Vec<DataNode>),
}

fn parse_data_node(p: &mut Parser<'_>, init_trivia: Trivia, is_xml: bool) -> Result<DataNode, TranspileError> {
    let mut blocks: Vec<Vec<DataNode>> = Vec::new();
    let mut owners: Vec<DataOwner> = Vec::new();
    match step_data_node(p, init_trivia, is_xml)? {
        DataStep::Done(n) => return Ok(n),
        DataStep::EnterChildren(owner, seed) => {
            p.skip_newlines();
            if !p.eat(TokenKind::Indent) { return Ok(build_data_parent(owner, seed)); }
            blocks.push(seed);
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
        let in_xml = is_xml || matches!(owners.last(), Some(DataOwner::Xml { .. }));
        match step_data_node(p, ntr, in_xml)? {
            DataStep::Done(node) => {
                if let Some(cur) = blocks.last_mut() { cur.push(node); }
                p.eat_stmt_end();
            }
            DataStep::EnterChildren(owner, seed) => {
                p.skip_newlines();
                if p.eat(TokenKind::Indent) {
                    blocks.push(seed);
                    owners.push(owner);
                } else {
                    let node = build_data_parent(owner, seed);
                    if let Some(cur) = blocks.last_mut() { cur.push(node); }
                    p.eat_stmt_end();
                }
            }
        }
    }
}

fn build_data_parent(owner: DataOwner, children: Vec<DataNode>) -> DataNode {
    match owner {
        DataOwner::Table { path, is_array_table, tr } => DataNode::TableSection { path, is_array_table, entries: children, trivia: tr },
        DataOwner::Xml { tag, attrs, tr } => DataNode::XmlElem { tag, attrs, text: None, children, trivia: tr },
        DataOwner::Keyed { key, tr, force_map } => {
            let is_seq = !force_map && children.iter().any(|n| {
                matches!(n, DataNode::Scalar { key: None, .. } | DataNode::Map { key: None, .. } | DataNode::Seq { key: None, .. })
            });
            if is_seq { DataNode::Seq { key, items: children, trivia: tr } } else { DataNode::Map { key, entries: children, trivia: tr } }
        }
    }
}

fn parse_inline_kv_list(p: &mut Parser<'_>, end_tok: Option<TokenKind>) -> Result<Vec<DataNode>, TranspileError> {
    let mut entries = Vec::new();
    while !p.at_eof() && !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Dedent | TokenKind::Comment) {
        if end_tok.is_some_and(|et| p.peek_kind() == et) { break; }
        let k = parse_xml_attr_key(p)?;
        p.expect(TokenKind::Equal, "Expected '='")?;
        let node = if p.peek_kind() == TokenKind::LBracket && p.peek_n(1).kind != TokenKind::RBracket {
            parse_inline_seq(p, Some(k), Trivia::default())?
        } else {
            let val = parse_inline_kv_val(p)?;
            DataNode::Scalar { key: Some(k), val, anchor: None, tag: None, trivia: Trivia::default() }
        };
        entries.push(node);
        p.eat(TokenKind::Comma);
    }
    Ok(entries)
}

fn parse_inline_kv_val(p: &mut Parser<'_>) -> Result<DataScalar, TranspileError> {
    if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
        return Ok(DataScalar::Str(p.advance().lexeme));
    }
    let at_end = |k: TokenKind| {
        matches!(k, TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon | TokenKind::Comma | TokenKind::RBracket | TokenKind::RBrace)
    };
    let (mut s, mut e) = (None, 0usize);
    let mut first_kind = None;
    let mut count = 0usize;
    while !at_end(p.peek_kind()) {
        if s.is_some() && p.peek().span.start_byte > e { break; }
        let t = p.advance();
        if first_kind.is_none() { first_kind = Some((t.kind, t.lexeme.clone())); }
        count += 1;
        if t.span.end_byte > t.span.start_byte {
            if s.is_none() { s = Some(t.span.start_byte); }
            e = t.span.end_byte;
        }
    }
    if count == 1 && let Some((k, l)) = first_kind {
        return Ok(match k {
            TokenKind::Number => if l.contains('.') || l.contains('e') || l.contains('E') { DataScalar::Float(l) } else { DataScalar::Int(l) },
            TokenKind::Boolean => DataScalar::Bool(l == "true"),
            TokenKind::Nil => DataScalar::Null,
            _ => DataScalar::Str(l),
        });
    }
    let raw = s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default();
    if raw == "[]" || raw == "{}" { return Ok(DataScalar::Raw(raw)); }
    Ok(DataScalar::Str(raw))
}

fn parse_inline_seq(p: &mut Parser<'_>, key: Option<String>, mut tr: Trivia) -> Result<DataNode, TranspileError> {
    p.expect(TokenKind::LBracket, "Expected '['")?;
    let mut items = Vec::new();
    while p.peek_kind() != TokenKind::RBracket && !p.at_eof() {
        let val = parse_data_scalar(p, true)?;
        items.push(DataNode::Scalar { key: None, val, anchor: None, tag: None, trivia: Trivia::default() });
        if !p.eat(TokenKind::Comma) { break; }
    }
    p.expect(TokenKind::RBracket, "Expected ']'")?;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(DataNode::Seq { key, items, trivia: tr })
}

fn looks_like_inline_map_key(p: &Parser<'_>) -> bool {
    let mut i = 0usize;
    loop {
        match p.peek_n(i).kind {
            TokenKind::Colon => return i > 0,
            TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::LBracket | TokenKind::LBrace => return false,
            _ => i += 1,
        }
    }
}

fn wrap_xml(res: Result<XmlParsed, TranspileError>) -> Result<DataStep, TranspileError> {
    match res? {
        XmlParsed::Done(n) => Ok(DataStep::Done(n)),
        XmlParsed::EnterChildren { tag, attrs, tr } => Ok(DataStep::EnterChildren(DataOwner::Xml { tag, attrs, tr }, Vec::new())),
    }
}

fn step_data_node(p: &mut Parser<'_>, mut tr: Trivia, is_xml: bool) -> Result<DataStep, TranspileError> {
    if p.peek().lexeme == "section" && !matches!(p.peek_n(1).kind, TokenKind::Colon) {
        p.advance();
        let is_array_table = p.eat(TokenKind::LBracket) && p.eat(TokenKind::RBracket);
        let path = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
        p.expect(TokenKind::Colon, "Expected ':'")?;
        if !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
            let entries = parse_inline_kv_list(p, None)?;
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            return Ok(DataStep::Done(DataNode::TableSection { path, is_array_table, entries, trivia: tr }));
        }
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::EnterChildren(DataOwner::Table { path, is_array_table, tr }, Vec::new()));
    }
    if p.peek().lexeme == "dtd" && !matches!(p.peek_n(1).kind, TokenKind::Colon) {
        p.advance();
        let kind = p.expect_ident_or_kw("Expected dtd kind")?.lexeme;
        let name = p.expect_ident_or_kw("Expected dtd name")?.lexeme;
        p.expect(TokenKind::Colon, "Expected ':'")?;
        let spec = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw() };
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::Done(DataNode::DtdDecl { kind, name, spec, trivia: tr }));
    }
    if p.peek().lexeme == "xml" && !matches!(p.peek_n(1).kind, TokenKind::Colon) {
        p.advance();
        return wrap_xml(parse_xml_elem(p, tr));
    }
    if is_xml { return wrap_xml(parse_xml_elem(p, tr)); }
    let key = if p.eat(TokenKind::Minus) {
        if !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) && looks_like_inline_map_key(p) {
            let k = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
            p.expect(TokenKind::Colon, "Expected ':'")?;
            let first = finish_keyed_value(p, Some(k), Trivia::default())?;
            return Ok(DataStep::EnterChildren(DataOwner::Keyed { key: None, tr, force_map: true }, vec![first]));
        }
        None
    } else {
        let k = if p.peek_kind() == TokenKind::String { p.advance().lexeme } else { p.line_rest_raw_until_colon() };
        p.expect(TokenKind::Colon, "Expected ':'")?;
        Some(k)
    };
    if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataStep::EnterChildren(DataOwner::Keyed { key, tr, force_map: false }, Vec::new()));
    }
    Ok(DataStep::Done(finish_keyed_value(p, key, tr)?))
}

fn finish_keyed_value(p: &mut Parser<'_>, key: Option<String>, mut tr: Trivia) -> Result<DataNode, TranspileError> {
    if p.peek_kind() == TokenKind::LBracket && p.peek_n(1).kind != TokenKind::RBracket {
        return parse_inline_seq(p, key, tr);
    }
    if p.peek_kind() == TokenKind::LBrace && p.peek_n(1).kind != TokenKind::RBrace {
        p.advance();
        let entries = parse_inline_kv_list(p, Some(TokenKind::RBrace))?;
        p.expect(TokenKind::RBrace, "Expected '}'")?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(DataNode::Map { key, entries, trivia: tr });
    }
    let val = parse_data_scalar(p, false)?;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(DataNode::Scalar { key, val, anchor: None, tag: None, trivia: tr })
}

fn parse_data_scalar(p: &mut Parser<'_>, in_delim: bool) -> Result<DataScalar, TranspileError> {
    let at_end = |k: TokenKind| {
        matches!(k, TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment | TokenKind::Semicolon)
            || (in_delim && matches!(k, TokenKind::Comma | TokenKind::RBracket | TokenKind::RBrace))
    };
    match p.peek_kind() {
        TokenKind::String | TokenKind::TripleString if at_end(p.peek_n(1).kind) => Ok(DataScalar::Str(p.advance().lexeme)),
        TokenKind::Number if at_end(p.peek_n(1).kind) => {
            let l = p.advance().lexeme;
            Ok(if l.contains('.') || l.contains('e') || l.contains('E') { DataScalar::Float(l) } else { DataScalar::Int(l) })
        }
        TokenKind::Boolean if at_end(p.peek_n(1).kind) => Ok(DataScalar::Bool(p.advance().lexeme == "true")),
        TokenKind::Nil if at_end(p.peek_n(1).kind) => { p.advance(); Ok(DataScalar::Null) }
        TokenKind::LBracket if p.peek_n(1).kind == TokenKind::RBracket => { p.advance(); p.advance(); Ok(DataScalar::Raw("[]".into())) }
        TokenKind::LBrace if p.peek_n(1).kind == TokenKind::RBrace => { p.advance(); p.advance(); Ok(DataScalar::Raw("{}".into())) }
        _ => {
            let (mut s, mut e) = (None, 0usize);
            while !at_end(p.peek_kind()) {
                let t = p.advance();
                if t.span.end_byte > t.span.start_byte {
                    if s.is_none() { s = Some(t.span.start_byte); }
                    e = t.span.end_byte;
                }
            }
            Ok(DataScalar::Str(s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default()))
        }
    }
}
