use crate::ir::{AiceItem, ImportDecl, ImportSpec, TranspileError, Trivia, Visibility};
use crate::ir_code::{ConstDecl, FnDecl, VarDecl};
use crate::ir_types::{EnumDecl, EnumVariant, FieldDecl, FieldSigil, ParamDecl, TypeDecl, TypeKind, VariantPayload};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_class::parse_method_decl;
use crate::parser_expr::parse_expr;
use crate::parser_stmt::parse_optional_body_with_trivia;
pub(crate) use crate::parser_types::{parse_type_expr, parse_type_name_str, parse_type_params};

pub(crate) fn parse_import(p: &mut Parser<'_>, vis: Visibility, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    let (mut specs, mut is_type_only) = (Vec::new(), false);
    let source = if p.eat(TokenKind::From) {
        let src_tok = p.expect(TokenKind::String, "Expected import source string")?;
        p.expect(TokenKind::Import, "Expected 'import'")?;
        loop {
            if p.eat(TokenKind::Star) {
                let alias = if p.eat(TokenKind::As) { Some(p.expect_ident_or_kw("Expected alias")?.lexeme) } else { None };
                specs.push(ImportSpec { name: "*".into(), alias, is_wildcard: true, is_default: false, is_type: false });
            } else {
                let is_t = p.eat(TokenKind::Type);
                if is_t { is_type_only = true; }
                let is_def = p.peek().lexeme == "default";
                let name = p.expect_ident_or_kw("Expected import specifier")?.lexeme;
                let alias = if p.eat(TokenKind::As) { Some(p.expect_ident_or_kw("Expected alias")?.lexeme) } else { None };
                specs.push(ImportSpec { name, alias, is_wildcard: false, is_default: is_def, is_type: is_t });
            }
            if !p.eat(TokenKind::Comma) { break; }
        }
        src_tok.lexeme
    } else {
        p.expect(TokenKind::Import, "Expected 'import'")?;
        if p.peek_kind() == TokenKind::String {
            let s = p.advance().lexeme;
            if p.eat(TokenKind::As) {
                let alias = p.expect_ident_or_kw("Expected import alias")?.lexeme;
                specs.push(ImportSpec { name: "*".into(), alias: Some(alias), is_wildcard: true, is_default: false, is_type: false });
            }
            s
        } else { p.line_rest_raw() }
    };
    let mut tr = trivia;
    tr.trailing = p.take_trailing_comment();
    Ok(AiceItem::Import(ImportDecl { vis, source, specifiers: specs, is_type_only, trivia: tr, span: sp }))
}

pub(crate) fn parse_type_decl(p: &mut Parser<'_>, vis: Visibility, default_kind: TypeKind, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    let kw = p.advance();
    let mut kind = match kw.kind { TokenKind::Interface => TypeKind::Interface, TokenKind::Trait => TypeKind::Trait, _ => default_kind };
    let name = p.expect_ident_or_kw("Expected type name")?.lexeme;
    let type_params = parse_type_params(p)?;
    let mut extends = Vec::new();
    if p.eat(TokenKind::Extends) {
        loop { extends.push(parse_type_name_str(p)?); if !p.eat(TokenKind::Comma) { break; } }
    }
    let (mut fields, mut methods, mut alias_target) = (Vec::new(), Vec::new(), None);
    let mut tr = trivia;
    if p.eat(TokenKind::Equal) {
        kind = TypeKind::Alias;
        alias_target = Some(parse_type_expr(p)?);
    } else if p.eat(TokenKind::Colon) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        if p.peek_kind() == TokenKind::Newline {
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let mtr = p.collect_leading_trivia();
                    if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                    if p.eat(TokenKind::Pass) { p.eat_stmt_end(); continue; }
                    let mvis = p.parse_visibility();
                    if p.peek_kind() == TokenKind::Fn || p.peek_kind() == TokenKind::Async {
                        methods.push(parse_method_decl(p, mvis, false, mtr)?);
                    } else {
                        let mut fld = parse_field_decl(p, mtr)?;
                        if fld.vis == Visibility::Default { fld.vis = mvis; }
                        fields.push(fld);
                    }
                    p.eat_stmt_end();
                }
                p.eat(TokenKind::Dedent);
            }
        } else {
            loop { fields.push(parse_field_decl(p, Trivia::default())?); if !p.eat(TokenKind::Comma) { break; } }
        }
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::Type(TypeDecl { vis, kind, name, type_params, extends, fields, methods, alias_target, trivia: tr, span: sp }))
}

pub(crate) fn parse_enum_decl(p: &mut Parser<'_>, vis: Visibility, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Enum, "Expected 'enum'")?;
    let name = p.expect_ident_or_kw("Expected enum name")?.lexeme;
    let type_params = parse_type_params(p)?;
    let mut variants = Vec::new();
    let mut tr = trivia;
    if p.eat(TokenKind::Colon) {
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        if p.peek_kind() == TokenKind::Newline {
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                while !p.at_eof() && p.peek_kind() != TokenKind::Dedent {
                    let vtr = p.collect_leading_trivia();
                    if p.peek_kind() == TokenKind::Dedent || p.at_eof() { break; }
                    if p.eat(TokenKind::Pass) { p.eat_stmt_end(); continue; }
                    variants.push(parse_enum_variant(p, vtr)?);
                    p.eat_stmt_end();
                }
                p.eat(TokenKind::Dedent);
            }
        } else {
            loop { variants.push(parse_enum_variant(p, Trivia::default())?); if !p.eat(TokenKind::Comma) { break; } }
        }
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::Enum(EnumDecl { vis, name, type_params, variants, trivia: tr, span: sp }))
}

fn parse_enum_variant(p: &mut Parser<'_>, trivia: Trivia) -> Result<EnumVariant, TranspileError> {
    let name = p.expect_ident_or_kw("Expected enum variant")?.lexeme;
    let payload = if p.eat(TokenKind::LParen) {
        let mut tys = Vec::new();
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            tys.push(parse_type_expr(p)?);
            if !p.eat(TokenKind::Comma) { break; }
        }
        p.expect(TokenKind::RParen, "Expected ')'")?;
        VariantPayload::Tuple(tys)
    } else if p.eat(TokenKind::LBrace) {
        let mut fields = Vec::new();
        while p.peek_kind() != TokenKind::RBrace && !p.at_eof() {
            fields.push(parse_field_decl(p, Trivia::default())?);
            if !p.eat(TokenKind::Comma) { break; }
        }
        p.expect(TokenKind::RBrace, "Expected '}'")?;
        VariantPayload::Struct(fields)
    } else { VariantPayload::Unit };
    let discriminant = if p.eat(TokenKind::Equal) { Some(parse_expr(p)?) } else { None };
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(EnumVariant { name, payload, discriminant, trivia: tr })
}

pub(crate) fn parse_fn_decl(p: &mut Parser<'_>, vis: Visibility, is_async: bool, is_static: bool, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    p.expect(TokenKind::Fn, "Expected 'fn'")?;
    let name = p.expect_ident_or_kw("Expected function name")?.lexeme;
    let type_params = parse_type_params(p)?;
    p.expect(TokenKind::LParen, "Expected '('")?;
    let params = parse_param_list(p)?;
    let return_type = if p.eat(TokenKind::Arrow) { Some(parse_type_expr(p)?) } else { None };
    let mut tr = trivia;
    let body = parse_optional_body_with_trivia(p, &mut tr)?;
    Ok(AiceItem::Fn(FnDecl { vis, is_async, is_static, decorators: Vec::new(), name, type_params, params, return_type, body, trivia: tr, span: sp }))
}

pub(crate) fn parse_const_or_var(p: &mut Parser<'_>, vis: Visibility, trivia: Trivia) -> Result<AiceItem, TranspileError> {
    let sp = p.peek().span;
    let mut tr = trivia;
    if p.eat(TokenKind::Const) {
        let name = p.expect_ident_or_kw("Expected const name")?.lexeme;
        let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
        p.expect(TokenKind::Equal, "Expected '='")?;
        let value = parse_expr(p)?;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(AiceItem::Const(ConstDecl { vis, name, ty, value, trivia: tr, span: sp }));
    }
    let mut is_mut = p.eat(TokenKind::Mut);
    if p.eat(TokenKind::Let) { is_mut = p.eat(TokenKind::Mut); } else { p.eat(TokenKind::Val); }
    let name = p.expect_ident_or_kw("Expected binding name")?.lexeme;
    let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
    if p.eat(TokenKind::ColonColonEqual) { is_mut = true; }
    else if p.eat(TokenKind::ColonEqual) || p.eat(TokenKind::Equal) {}
    else { return Err(TranspileError::at("Expected ':=', '::=', or '='", p.peek().span)); }
    let value = parse_expr(p)?;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(AiceItem::Var(VarDecl { vis, is_mut, name, ty, value, trivia: tr, span: sp }))
}

pub(crate) fn parse_param_list(p: &mut Parser<'_>) -> Result<Vec<ParamDecl>, TranspileError> {
    let mut params = Vec::new();
    while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
        let vis = p.parse_visibility();
        let is_readonly = p.peek().lexeme == "readonly" && { p.advance(); true };
        let is_mut = p.eat(TokenKind::Mut);
        let is_rest = p.eat(TokenKind::Ellipsis);
        let name = if p.peek_kind() == TokenKind::Dollar {
            p.advance(); format!("${}", p.expect_ident_or_kw("Expected param name")?.lexeme)
        } else if p.peek_kind() == TokenKind::Amp {
            p.advance();
            if p.eat(TokenKind::Mut) { format!("&mut {}", p.expect_ident_or_kw("Expected param")?.lexeme) }
            else { format!("&{}", p.expect_ident_or_kw("Expected param")?.lexeme) }
        } else { p.expect_ident_or_kw("Expected parameter name")?.lexeme };
        let is_optional = p.eat(TokenKind::Question);
        let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
        let default = if p.eat(TokenKind::Equal) { Some(parse_expr(p)?) } else { None };
        params.push(ParamDecl { name, vis, is_readonly, is_mut, is_optional, is_rest, ty, default, trivia: Trivia::default() });
        if !p.eat(TokenKind::Comma) { break; }
    }
    p.expect(TokenKind::RParen, "Expected ')'")?;
    Ok(params)
}

fn parse_field_decl(p: &mut Parser<'_>, trivia: Trivia) -> Result<FieldDecl, TranspileError> {
    let vis = p.parse_visibility();
    let is_readonly = p.peek().lexeme == "readonly" && { p.advance(); true };
    let name = p.expect_ident_or_kw("Expected field name")?.lexeme;
    let sigil = if p.peek_kind() == TokenKind::Sigil {
        match p.advance().lexeme.as_str() {
            "!s" => FieldSigil::RequiredStr, "!i" => FieldSigil::RequiredInt,
            "!f" => FieldSigil::RequiredFloat, "!b" => FieldSigil::RequiredBool,
            _ => FieldSigil::Required,
        }
    } else if p.eat(TokenKind::Bang) { FieldSigil::Required }
    else if p.eat(TokenKind::Question) { FieldSigil::Optional }
    else { FieldSigil::None };
    let is_optional = sigil == FieldSigil::Optional;
    let ty = if p.eat(TokenKind::Colon) { Some(parse_type_expr(p)?) } else { None };
    let default = if p.eat(TokenKind::Equal) { Some(parse_expr(p)?) } else { None };
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    Ok(FieldDecl { name, vis, is_readonly, is_optional, sigil, ty, default, trivia: tr })
}
