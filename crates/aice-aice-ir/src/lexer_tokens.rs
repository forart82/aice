use crate::ir::Span;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum TokenKind {
    // Structural
    Newline, Indent, Dedent, Eof, Comment, RawLine,
    // Identifiers & Literals
    Ident, Number, String, TripleString, Boolean, Nil, HexColor, Regex,
    TemplateHead, TemplateMiddle, TemplateTail, TemplateNoSubst,
    // Keywords
    Module, From, Import, As, Type, Enum, Struct, Interface, Trait, Class,
    Extends, Implements, Fn, Async, Await, Const, Let, Mut, Val,
    Pub, Priv, Prot, Pkg, Component, Style, Tokens,
    If, Elif, Else, Match, For, In, Instanceof, While, Loop,
    Ret, Try, Catch, Finally, Throw, Break, Continue, Pass, And, Or, Not,
    // Operators & Delimiters
    Plus, Minus, PlusPlus, MinusMinus, Tilde, Star, Slash, Percent, StarStar,
    Amp, Caret, Pipe, Shl, Shr, Ushr, EqEq, NotEq, Lt, LtEq, Gt, GtEq,
    AmpAmp, PipePipe, QuestionQuestion, QuestionDot,
    Equal, PlusEq, MinusEq, StarEq, SlashEq, PercentEq, StarStarEq,
    AmpEq, PipeEq, CaretEq, ShlEq, ShrEq, UshrEq,
    ColonEqual, ColonColonEqual, Arrow, FatArrow, ColonColon,
    LParen, RParen, LBracket, RBracket, LBrace, RBrace,
    Colon, Comma, Dot, Ellipsis, Question, Bang, Hash, Dollar, Semicolon, At, Sigil,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct Token {
    pub kind: TokenKind,
    pub lexeme: String,
    pub line: usize,
    pub span: Span,
}

impl Token {
    pub fn is_keyword(&self) -> bool {
        matches!(
            self.kind,
            TokenKind::Module | TokenKind::From | TokenKind::Import | TokenKind::As
                | TokenKind::Type | TokenKind::Enum | TokenKind::Struct | TokenKind::Interface
                | TokenKind::Trait | TokenKind::Class | TokenKind::Extends | TokenKind::Implements
                | TokenKind::Fn | TokenKind::Async | TokenKind::Await | TokenKind::Const
                | TokenKind::Let | TokenKind::Mut | TokenKind::Val | TokenKind::Pub
                | TokenKind::Priv | TokenKind::Prot | TokenKind::Pkg | TokenKind::Component
                | TokenKind::Style | TokenKind::Tokens | TokenKind::If | TokenKind::Elif
                | TokenKind::Else | TokenKind::Match | TokenKind::For | TokenKind::In
                | TokenKind::Instanceof | TokenKind::While | TokenKind::Loop | TokenKind::Ret
                | TokenKind::Try | TokenKind::Catch | TokenKind::Finally | TokenKind::Throw
                | TokenKind::Break | TokenKind::Continue | TokenKind::Pass
                | TokenKind::And | TokenKind::Or | TokenKind::Not
        )
    }

    pub fn is_literal(&self) -> bool {
        matches!(
            self.kind,
            TokenKind::Number | TokenKind::String | TokenKind::TripleString
                | TokenKind::Boolean | TokenKind::Nil | TokenKind::HexColor
                | TokenKind::Regex | TokenKind::TemplateNoSubst
        )
    }
}

pub fn keyword_kind(word: &str) -> Option<TokenKind> {
    match word {
        "module" => Some(TokenKind::Module),
        "from" => Some(TokenKind::From),
        "import" => Some(TokenKind::Import),
        "as" => Some(TokenKind::As),
        "type" => Some(TokenKind::Type),
        "enum" => Some(TokenKind::Enum),
        "struct" => Some(TokenKind::Struct),
        "interface" => Some(TokenKind::Interface),
        "trait" => Some(TokenKind::Trait),
        "class" => Some(TokenKind::Class),
        "extends" => Some(TokenKind::Extends),
        "implements" => Some(TokenKind::Implements),
        "fn" => Some(TokenKind::Fn),
        "async" => Some(TokenKind::Async),
        "await" => Some(TokenKind::Await),
        "const" => Some(TokenKind::Const),
        "let" => Some(TokenKind::Let),
        "mut" => Some(TokenKind::Mut),
        "val" => Some(TokenKind::Val),
        "pub" => Some(TokenKind::Pub),
        "priv" => Some(TokenKind::Priv),
        "prot" => Some(TokenKind::Prot),
        "pkg" => Some(TokenKind::Pkg),
        "component" => Some(TokenKind::Component),
        "style" => Some(TokenKind::Style),
        "tokens" => Some(TokenKind::Tokens),
        "if" => Some(TokenKind::If),
        "elif" => Some(TokenKind::Elif),
        "else" => Some(TokenKind::Else),
        "match" => Some(TokenKind::Match),
        "for" => Some(TokenKind::For),
        "in" => Some(TokenKind::In),
        "instanceof" => Some(TokenKind::Instanceof),
        "while" => Some(TokenKind::While),
        "loop" => Some(TokenKind::Loop),
        "ret" | "return" => Some(TokenKind::Ret),
        "try" => Some(TokenKind::Try),
        "catch" => Some(TokenKind::Catch),
        "finally" => Some(TokenKind::Finally),
        "throw" => Some(TokenKind::Throw),
        "break" => Some(TokenKind::Break),
        "continue" => Some(TokenKind::Continue),
        "pass" => Some(TokenKind::Pass),
        "and" => Some(TokenKind::And),
        "or" => Some(TokenKind::Or),
        "not" => Some(TokenKind::Not),
        "true" | "false" => Some(TokenKind::Boolean),
        "nil" => Some(TokenKind::Nil),
        _ => None,
    }
}
