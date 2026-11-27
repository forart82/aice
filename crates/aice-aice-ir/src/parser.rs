use aice_lang_registry::LanguageId;

use crate::ir::{
    AiceItem, AiceModule, Span, TranspileError, Trivia, TriviaComment, TriviaKind, Visibility,
};
use crate::ir_types::TypeKind;
use crate::lexer::lex_with_trivia;
use crate::lexer_tokens::{Token, TokenKind};
use crate::parser_class::{parse_class_decl, parse_directive_or_decorated};
use crate::parser_decl::{parse_const_or_var, parse_enum_decl, parse_fn_decl, parse_import, parse_type_decl};
use crate::parser_nil::resolve_bound_nil_in_module;
use crate::parser_stmt::is_walrus_ahead;
use crate::parser_domain::{parse_component, parse_style, parse_tokens};
use crate::parser_domain_data::{parse_data, parse_doc, parse_sh};
use crate::parser_domain_db::parse_db_item;

pub fn parse_aice(src: &str) -> Result<AiceModule, TranspileError> {
    let tokens = lex_with_trivia(src)?;
    let mut p = Parser::new(src, tokens);
    p.parse_module()
}

pub(crate) struct Parser<'a> {
    pub src: &'a str,
    pub tokens: Vec<Token>,
    pub pos: usize,
}

impl<'a> Parser<'a> {
    pub fn new(src: &'a str, tokens: Vec<Token>) -> Self {
        Self { src, tokens, pos: 0 }
    }

    pub fn peek(&self) -> &Token {
        self.tokens.get(self.pos).unwrap_or_else(|| self.tokens.last().expect("EOF"))
    }

    pub fn peek_n(&self, n: usize) -> &Token {
        self.tokens.get(self.pos + n).unwrap_or_else(|| self.tokens.last().expect("EOF"))
    }

    pub fn peek_kind(&self) -> TokenKind {
        self.peek().kind
    }

    pub fn at_eof(&self) -> bool {
        self.peek_kind() == TokenKind::Eof
    }

    pub fn advance(&mut self) -> Token {
        let tok = self.peek().clone();
        if !self.at_eof() { self.pos += 1; }
        tok
    }

    pub fn eat(&mut self, kind: TokenKind) -> bool {
        if self.peek_kind() == kind { self.advance(); true } else { false }
    }

    pub fn expect(&mut self, kind: TokenKind, msg: &str) -> Result<Token, TranspileError> {
        if self.peek_kind() == kind {
            Ok(self.advance())
        } else {
            let tok = self.peek();
            Err(TranspileError::at(format!("{msg} (got {:?} '{}')", tok.kind, tok.lexeme), tok.span))
        }
    }

    pub fn skip_newlines(&mut self) {
        while matches!(self.peek_kind(), TokenKind::Newline | TokenKind::Semicolon) {
            self.advance();
        }
    }

    pub fn eat_stmt_end(&mut self) {
        self.skip_newlines();
    }

    pub fn collect_leading_trivia(&mut self) -> Trivia {
        let mut trivia = Trivia::default();
        let mut blanks = 0u16;
        loop {
            match self.peek_kind() {
                TokenKind::Newline => { self.advance(); blanks = blanks.saturating_add(1); }
                TokenKind::Comment => {
                    let tok = self.advance();
                    let kind = if tok.lexeme.starts_with('!') { TriviaKind::Directive } else { TriviaKind::Line };
                    trivia.leading.push(TriviaComment { kind, text: tok.lexeme });
                    if self.peek_kind() == TokenKind::Newline { self.advance(); }
                    blanks = 0;
                }
                _ => break,
            }
        }
        trivia.blank_lines_before = blanks;
        trivia
    }

    pub fn collect_member_attrs(&mut self, tr: &mut Trivia) {
        loop {
            if self.eat(TokenKind::At) {
                let rest = self.line_rest_raw();
                tr.leading.push(TriviaComment { kind: TriviaKind::Attribute, text: format!("@{rest}") });
                self.eat_stmt_end();
                tr.leading.extend(self.collect_leading_trivia().leading);
            } else if self.peek_kind() == TokenKind::Hash && self.peek_n(1).kind == TokenKind::LBracket {
                let rest = self.line_rest_raw();
                tr.leading.push(TriviaComment { kind: TriviaKind::Attribute, text: rest });
                self.eat_stmt_end();
                tr.leading.extend(self.collect_leading_trivia().leading);
            } else {
                break;
            }
        }
    }

    pub fn take_trailing_comment(&mut self) -> Option<String> {
        if self.peek_kind() == TokenKind::Comment { Some(self.advance().lexeme) } else { None }
    }

    pub fn is_binding_tok(t: &Token) -> bool {
        t.kind == TokenKind::Ident || t.is_keyword() || t.kind == TokenKind::Nil
    }

    pub fn expect_ident_or_kw(&mut self, msg: &str) -> Result<Token, TranspileError> {
        let t = self.peek().clone();
        if Self::is_binding_tok(&t) {
            self.advance();
            Ok(t)
        } else {
            Err(TranspileError::at(format!("{msg} (got {:?} '{}')", t.kind, t.lexeme), t.span))
        }
    }

    pub fn line_rest_raw(&mut self) -> String {
        let (mut start, mut end) = (None, 0usize);
        while !matches!(self.peek_kind(), TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment) {
            let tok = self.advance();
            if tok.span.end_byte > tok.span.start_byte {
                if start.is_none() { start = Some(tok.span.start_byte); }
                end = tok.span.end_byte;
            }
        }
        start.map(|s| self.src[s..end].trim().to_string()).unwrap_or_default()
    }

    pub fn line_rest_raw_until_colon(&mut self) -> String {
        let (mut start, mut end) = (None, 0usize);
        while !matches!(
            self.peek_kind(),
            TokenKind::Colon | TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment
        ) {
            let t = self.advance();
            if t.span.end_byte > t.span.start_byte {
                if start.is_none() { start = Some(t.span.start_byte); }
                end = t.span.end_byte;
            }
        }
        start.map(|s| self.src[s..end].trim().to_string()).unwrap_or_default()
    }

    pub fn parse_visibility(&mut self) -> Visibility {
        match self.peek_kind() {
            TokenKind::Pub => { self.advance(); Visibility::Public }
            TokenKind::Priv => { self.advance(); Visibility::Private }
            TokenKind::Prot => { self.advance(); Visibility::Protected }
            TokenKind::Pkg => { self.advance(); Visibility::Package }
            _ => Visibility::Default,
        }
    }

    pub fn parse_module(&mut self) -> Result<AiceModule, TranspileError> {
        let module_trivia = self.collect_leading_trivia();
        let mut module_name = "module".to_string();
        if self.peek_kind() == TokenKind::Module && !is_walrus_ahead(self) {
            self.advance();
            let mut parts = vec![self.expect_ident_or_kw("Expected module name")?.lexeme];
            while self.eat(TokenKind::Slash) || self.eat(TokenKind::Dot) || self.eat(TokenKind::ColonColon) {
                parts.push(self.expect_ident_or_kw("Expected module path segment")?.lexeme);
            }
            module_name = parts.join("/");
            self.eat_stmt_end();
        }
        let mut m = AiceModule::new(LanguageId::Aice, module_name);
        m.module_trivia = module_trivia;
        while !self.at_eof() {
            let trivia = self.collect_leading_trivia();
            if self.at_eof() { m.trailing_trivia = trivia; break; }
            if self.eat(TokenKind::Dedent) { continue; }
            m.items.push(self.parse_item(trivia)?);
            self.eat_stmt_end();
        }
        resolve_bound_nil_in_module(&mut m);
        Ok(m)
    }

    pub fn parse_item(&mut self, trivia: Trivia) -> Result<AiceItem, TranspileError> {
        if Self::is_binding_tok(self.peek()) && is_walrus_ahead(self) {
            return parse_const_or_var(self, Visibility::Default, trivia);
        }
        let vis = self.parse_visibility();
        if Self::is_binding_tok(self.peek()) && is_walrus_ahead(self) {
            return parse_const_or_var(self, vis, trivia);
        }
        let sp = self.peek().span;
        match self.peek_kind() {
            TokenKind::From | TokenKind::Import => parse_import(self, vis, trivia),
            TokenKind::Type | TokenKind::Struct => parse_type_decl(self, vis, TypeKind::Struct, trivia),
            TokenKind::Interface => parse_type_decl(self, vis, TypeKind::Interface, trivia),
            TokenKind::Trait => parse_type_decl(self, vis, TypeKind::Trait, trivia),
            TokenKind::Enum => parse_enum_decl(self, vis, trivia),
            TokenKind::Class => parse_class_decl(self, vis, false, trivia),
            TokenKind::Fn => parse_fn_decl(self, vis, false, false, trivia),
            TokenKind::Async => {
                self.advance();
                if self.peek_kind() == TokenKind::Fn { parse_fn_decl(self, vis, true, false, trivia) }
                else { Err(TranspileError::at("Expected 'fn' after 'async'", sp)) }
            }
            TokenKind::Const | TokenKind::Let | TokenKind::Mut | TokenKind::Val => parse_const_or_var(self, vis, trivia),
            TokenKind::Component => parse_component(self, vis, trivia),
            TokenKind::Style => parse_style(self, trivia),
            TokenKind::Tokens => parse_tokens(self, trivia),
            TokenKind::At => parse_directive_or_decorated(self, vis, trivia),
            TokenKind::Hash if self.peek_n(1).kind == TokenKind::LBracket => parse_directive_or_decorated(self, vis, trivia),
            TokenKind::Ident => self.parse_ident_led_item(vis, trivia, sp),
            _ => Err(TranspileError::at(format!("Unexpected token {:?} '{}' at module level", self.peek_kind(), self.peek().lexeme), sp)),
        }
    }

    fn parse_ident_led_item(&mut self, vis: Visibility, trivia: Trivia, sp: Span) -> Result<AiceItem, TranspileError> {
        match self.peek().lexeme.as_str() {
            "abstract" => {
                self.advance();
                if self.peek_kind() == TokenKind::Class { parse_class_decl(self, vis, true, trivia) }
                else { Err(TranspileError::at("Expected 'class' after 'abstract'", sp)) }
            }
            "data" => parse_data(self, trivia),
            "doc" => parse_doc(self, trivia),
            "sh" => parse_sh(self, trivia),
            "shebang" | "set" | "var" | "cmd" if self.peek_n(1).kind == TokenKind::RawLine => {
                parse_sh(self, trivia)
            }
            "pragma" if self.peek_n(1).kind == TokenKind::RawLine => parse_db_item(self, trivia),
            "sql"
                if self.peek_n(1).kind == TokenKind::Colon
                    && matches!(self.peek_n(2).kind, TokenKind::RawLine | TokenKind::TripleString) =>
            {
                parse_db_item(self, trivia)
            }
            "table" | "view" | "index" | "proc" | "trig" | "dbtype" | "ddl" | "model"
            | "datasource" | "generator" | "prisma_enum" | "gql" | "query" | "cypher"
            | "migration" => parse_db_item(self, trivia),
            "directive" => {
                self.advance();
                let text = if self.peek_kind() == TokenKind::TripleString
                    || (self.peek_kind() == TokenKind::String
                        && matches!(
                            self.peek_n(1).kind,
                            TokenKind::Newline | TokenKind::Dedent | TokenKind::Eof | TokenKind::Comment
                        ))
                {
                    self.advance().lexeme
                } else {
                    self.line_rest_raw()
                };
                let mut tr = trivia;
                tr.trailing = self.take_trailing_comment();
                Ok(AiceItem::Directive { text, trivia: tr, span: sp })
            }
            _ => parse_const_or_var(self, vis, trivia),
        }
    }
}
