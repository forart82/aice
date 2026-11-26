use crate::ir::{AiceItem, TranspileError, Trivia, Visibility};
use crate::ir_code::{AccessorKind, ClassDecl, MethodDecl, PropDecl};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_decl::{parse_fn_decl, parse_param_list};
use crate::parser_expr::parse_expr;
use crate::parser_stmt::{parse_block, parse_optional_body_with_trivia};
use crate::parser_types::{parse_type_expr, parse_type_name_str, parse_type_params};

pub(crate) fn parse_class_decl(
    p: &mut Parser<'_>,
    vis: Visibility,
    is_abstract: bool,
    trivia: Trivia,
) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Class, "Expected 'class'")?;
    let name = p.expect_ident_or_kw("Expected class name")?.lexeme;
    let type_params = parse_type_params(p)?;
    let primary_ctor = if p.eat(TokenKind::LParen) { parse_param_list(p)? } else { Vec::new() };
    let extends = if p.eat(TokenKind::Extends) { Some(parse_type_name_str(p)?) } else { None };
    let mut implements = Vec::new();
    if p.eat(TokenKind::Implements) {
        loop {
            implements.push(parse_type_name_str(p)?);
            if !p.eat(TokenKind::Comma) { break; }
        }
    }
    let (mut props, mut methods, mut static_blocks) = (Vec::new(), Vec::new(), Vec::new());
    let mut tr = trivia;
    if p.eat(TokenKind::Colon) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        p.skip_newlines();
        if p.eat(TokenKind::Indent) {
            while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                let mut mtr = p.collect_leading_trivia();
                if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                p.collect_member_attrs(&mut mtr);
                if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                if p.eat(TokenKind::Pass) { p.eat_stmt_end(); continue; }
                let mvis = p.parse_visibility();
                let is_static = p.peek().lexeme == "static" && { p.advance(); true };
                if is_static && p.peek_kind() == TokenKind::Colon {
                    p.advance();
                    static_blocks.push(parse_block(p)?);
                } else if matches!(p.peek_kind(), TokenKind::Fn | TokenKind::Async)
                    || matches!(p.peek().lexeme.as_str(), "get" | "set" | "constructor")
                {
                    methods.push(parse_method_decl(p, mvis, is_static, mtr)?);
                } else {
                    props.push(parse_prop_decl(p, mvis, is_static, mtr)?);
                }
                p.eat_stmt_end();
            }
            p.eat(TokenKind::Dedent);
        }
    }
    Ok(AiceItem::Class(ClassDecl {
        vis, is_abstract, decorators: Vec::new(), name, type_params, primary_ctor,
        extends, implements, props, methods, static_blocks, trivia: tr, span: sp,
    }))
}

fn parse_prop_decl(p: &mut Parser<'_>, vis: Visibility, is_static: bool, trivia: Trivia) -> Result<PropDecl, TranspileError> {
    if p.peek().lexeme == "prop" { p.advance(); }
    let is_readonly = p.peek().lexeme == "readonly" && { p.advance(); true };
    let is_mut = p.eat(TokenKind::Mut);
    let name = p.expect_ident_or_kw("Expected property name")?.lexeme;
    let is_optional = p.eat(TokenKind::Question);
    let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
    let init = if p.eat(TokenKind::Equal) || p.eat(TokenKind::ColonEqual) { Some(parse_expr(p)?) } else { None };
    let mut tr = trivia;
    tr.trailing = p.take_trailing_comment();
    Ok(PropDecl { name, aliases: Vec::new(), vis, is_static, is_readonly, is_mut, is_optional, ty, init, trivia: tr })
}

pub(crate) fn parse_method_decl(p: &mut Parser<'_>, vis: Visibility, is_static: bool, trivia: Trivia) -> Result<MethodDecl, TranspileError> {
    let sp = p.peek().span;
    let is_async = p.eat(TokenKind::Async);
    let accessor = match p.peek().lexeme.as_str() {
        "get" if p.peek_n(1).kind != TokenKind::LParen => { p.advance(); AccessorKind::Get }
        "set" if p.peek_n(1).kind != TokenKind::LParen => { p.advance(); AccessorKind::Set }
        "constructor" => { p.advance(); AccessorKind::Constructor }
        _ => { p.eat(TokenKind::Fn); AccessorKind::Normal }
    };
    let name = if accessor == AccessorKind::Constructor && p.peek_kind() == TokenKind::LParen {
        "constructor".to_string()
    } else { p.expect_ident_or_kw("Expected method name")?.lexeme };
    let type_params = parse_type_params(p)?;
    p.expect(TokenKind::LParen, "Expected '('")?;
    let params = parse_param_list(p)?;
    let is_const = p.peek().lexeme == "const" && { p.advance(); true };
    let return_type = if p.eat(TokenKind::Arrow) { Some(parse_type_expr(p)?) } else { None };
    let mut tr = trivia;
    let body = parse_optional_body_with_trivia(p, &mut tr)?;
    Ok(MethodDecl { vis, is_static, is_async, is_const, accessor, name, type_params, params, return_type, body, trivia: tr, span: sp })
}

pub(crate) fn parse_directive_or_decorated(p: &mut Parser<'_>, vis: Visibility, mut trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    let mut decs = Vec::new();
    loop {
        if p.eat(TokenKind::At) || (p.peek_kind() == TokenKind::Hash && p.peek_n(1).kind == TokenKind::LBracket) {
            decs.push(p.line_rest_raw());
            p.eat_stmt_end();
            trivia.leading.extend(p.collect_leading_trivia().leading);
        } else {
            break;
        }
    }
    let vis2 = if vis == Visibility::Default { p.parse_visibility() } else { vis };
    let is_abs = p.peek_kind() == TokenKind::Ident && p.peek().lexeme == "abstract" && p.peek_n(1).kind == TokenKind::Class;
    if is_abs { p.advance(); }
    match p.peek_kind() {
        TokenKind::Fn | TokenKind::Async => {
            let is_async = p.eat(TokenKind::Async);
            let mut item = parse_fn_decl(p, vis2, is_async, false, trivia)?;
            if let AiceItem::Fn(ref mut f) = item { f.decorators = decs; }
            Ok(item)
        }
        TokenKind::Class => {
            let mut item = parse_class_decl(p, vis2, is_abs, trivia)?;
            if let AiceItem::Class(ref mut c) = item { c.decorators = decs; }
            Ok(item)
        }
        _ => {
            let text = decs.into_iter().map(|d| if d.starts_with("#[") { d } else { format!("@{d}") }).collect::<Vec<_>>().join(" ");
            Ok(AiceItem::Directive { text, trivia, span: sp })
        }
    }
}
