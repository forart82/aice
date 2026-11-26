use crate::ir::{TranspileError, Trivia};
use crate::ir_code::Expr;
use crate::ir_domain::{LayoutAttr, LayoutNode, TemplateCtrlKind};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
use crate::parser_expr::parse_expr;

enum LayoutOwner {
    Elem { tag: String, attrs: Vec<LayoutAttr>, text: Option<String>, child_expr: Option<Expr>, tr: Trivia },
    CtrlChildren { kind: TemplateCtrlKind, arg: String, tr: Trivia },
    CtrlBranch {
        kind: TemplateCtrlKind, arg: String, children: Vec<LayoutNode>,
        branches: Vec<(String, Vec<LayoutNode>)>, barg: String, tr: Trivia,
    },
}

pub(crate) fn parse_layout_nodes(p: &mut Parser<'_>) -> Result<Vec<LayoutNode>, TranspileError> {
    let mut blocks: Vec<Vec<LayoutNode>> = vec![Vec::new()];
    let mut owners: Vec<LayoutOwner> = Vec::new();
    loop {
        if p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            finish_layout_block(p, &mut blocks, &mut owners)?;
            if owners.is_empty() && blocks.len() == 1 && (p.at_eof() || p.peek_kind() == TokenKind::Dedent) {
                return Ok(blocks.pop().unwrap_or_default());
            }
            continue;
        }
        let tr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() {
            if let Some(cur) = blocks.last_mut() {
                for c in tr.leading { cur.push(LayoutNode::Comment(c.text)); }
            }
            finish_layout_block(p, &mut blocks, &mut owners)?;
            if owners.is_empty() && blocks.len() == 1 && (p.at_eof() || p.peek_kind() == TokenKind::Dedent) {
                return Ok(blocks.pop().unwrap_or_default());
            }
            continue;
        }
        if p.eat(TokenKind::At) {
            step_template_ctrl(p, tr, &mut blocks, &mut owners)?;
        } else {
            step_layout_elem(p, tr, &mut blocks, &mut owners)?;
        }
    }
}

struct CtrlState {
    kind: TemplateCtrlKind,
    arg: String,
    children: Vec<LayoutNode>,
    branches: Vec<(String, Vec<LayoutNode>)>,
    tr: Trivia,
}

fn finish_layout_block(
    p: &mut Parser<'_>,
    blocks: &mut Vec<Vec<LayoutNode>>,
    owners: &mut Vec<LayoutOwner>,
) -> Result<(), TranspileError> {
    let Some(owner) = owners.pop() else { return Ok(()); };
    let finished = blocks.pop().unwrap_or_default();
    p.eat(TokenKind::Dedent);
    match owner {
        LayoutOwner::Elem { tag, attrs, text, child_expr, mut tr } => {
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            if let Some(cur) = blocks.last_mut() {
                cur.push(LayoutNode::Element { tag, attrs, text, child_expr, children: finished, trivia: tr });
            }
            p.eat_stmt_end();
        }
        LayoutOwner::CtrlChildren { kind, arg, tr } => {
            continue_ctrl_branches(p, CtrlState { kind, arg, children: finished, branches: Vec::new(), tr }, blocks, owners)?;
        }
        LayoutOwner::CtrlBranch { kind, arg, children, mut branches, barg, tr } => {
            branches.push((barg, finished));
            continue_ctrl_branches(p, CtrlState { kind, arg, children, branches, tr }, blocks, owners)?;
        }
    }
    Ok(())
}

fn continue_ctrl_branches(
    p: &mut Parser<'_>,
    mut st: CtrlState,
    blocks: &mut Vec<Vec<LayoutNode>>,
    owners: &mut Vec<LayoutOwner>,
) -> Result<(), TranspileError> {
    while !p.at_eof() {
        let saved = p.pos;
        p.skip_newlines();
        if p.eat(TokenKind::At) && matches!(p.peek().lexeme.as_str(), "elif" | "elseif" | "else") {
            let bkw = p.advance().lexeme;
            let barg = if bkw == "else" { "else".into() } else { p.line_rest_raw_until_colon() };
            p.eat(TokenKind::Colon);
            let _ = p.take_trailing_comment();
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                blocks.push(Vec::new());
                owners.push(LayoutOwner::CtrlBranch {
                    kind: st.kind, arg: st.arg, children: st.children, branches: st.branches, barg, tr: st.tr,
                });
                return Ok(());
            }
            st.branches.push((barg, Vec::new()));
            continue;
        }
        p.pos = saved;
        break;
    }
    if st.tr.trailing.is_none() { st.tr.trailing = p.take_trailing_comment(); }
    if let Some(cur) = blocks.last_mut() {
        cur.push(LayoutNode::TemplateCtrl {
            kind: st.kind, arg: st.arg, children: st.children, branches: st.branches, trivia: st.tr,
        });
    }
    p.eat_stmt_end();
    Ok(())
}

fn step_template_ctrl(
    p: &mut Parser<'_>,
    mut tr: Trivia,
    blocks: &mut Vec<Vec<LayoutNode>>,
    owners: &mut Vec<LayoutOwner>,
) -> Result<(), TranspileError> {
    let kw = p.expect_ident_or_kw("Expected template directive")?.lexeme;
    let kind = match kw.as_str() {
        "extends" => TemplateCtrlKind::Extends, "include" => TemplateCtrlKind::Include,
        "use" => TemplateCtrlKind::Use, "import" => TemplateCtrlKind::Import,
        "from" => TemplateCtrlKind::From, "block" => TemplateCtrlKind::Block,
        "if" => TemplateCtrlKind::If, "for" => TemplateCtrlKind::For,
        "set" => TemplateCtrlKind::Set, "macro" => TemplateCtrlKind::Macro,
        "apply" => TemplateCtrlKind::Apply, "filter" => TemplateCtrlKind::Filter,
        "embed" => TemplateCtrlKind::Embed, "verbatim" => TemplateCtrlKind::Verbatim,
        "do" => TemplateCtrlKind::Do, "flush" => TemplateCtrlKind::Flush,
        "out" => TemplateCtrlKind::ExprOut, _ => TemplateCtrlKind::RawTag,
    };
    let arg = if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
        p.advance().lexeme
    } else {
        p.line_rest_raw_until_colon()
    };
    let mut children = Vec::new();
    if p.eat(TokenKind::Colon) {
        if !matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof) {
            let txt = if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString)
                && matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof)
            {
                p.advance().lexeme
            } else {
                p.line_rest_raw()
            };
            children.push(LayoutNode::Element {
                tag: "#text".into(), attrs: Vec::new(), text: Some(txt),
                child_expr: None, children: Vec::new(), trivia: Trivia::default(),
            });
            continue_ctrl_branches(p, CtrlState { kind, arg, children, branches: Vec::new(), tr }, blocks, owners)?;
            return Ok(());
        }
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        p.skip_newlines();
        if p.eat(TokenKind::Indent) {
            blocks.push(Vec::new());
            owners.push(LayoutOwner::CtrlChildren { kind, arg, tr });
            return Ok(());
        }
        continue_ctrl_branches(p, CtrlState { kind, arg, children, branches: Vec::new(), tr }, blocks, owners)?;
        return Ok(());
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    if let Some(cur) = blocks.last_mut() {
        cur.push(LayoutNode::TemplateCtrl { kind, arg, children, branches: Vec::new(), trivia: tr });
    }
    p.eat_stmt_end();
    Ok(())
}

fn parse_layout_ident(p: &mut Parser<'_>, msg: &str) -> Result<String, TranspileError> {
    if p.peek_kind() == TokenKind::String {
        return Ok(p.advance().lexeme);
    }
    let mut s = p.expect_ident_or_kw(msg)?.lexeme;
    while p.eat(TokenKind::Minus) {
        s.push('-');
        s.push_str(&p.expect_ident_or_kw(msg)?.lexeme);
    }
    Ok(s)
}

fn parse_layout_attr_str(p: &mut Parser<'_>) -> Expr {
    if p.peek_kind() == TokenKind::String {
        return Expr::Literal(crate::ir_code::LiteralVal::Str { value: p.advance().lexeme, multiline: false });
    }
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
    let val = s.map(|st| p.src[st..e].trim().to_string()).unwrap_or_default();
    Expr::Literal(crate::ir_code::LiteralVal::Str { value: val, multiline: false })
}

fn step_layout_elem(
    p: &mut Parser<'_>,
    mut tr: Trivia,
    blocks: &mut Vec<Vec<LayoutNode>>,
    owners: &mut Vec<LayoutOwner>,
) -> Result<(), TranspileError> {
    let tag = parse_layout_ident(p, "Expected tag")?;
    let mut attrs = Vec::new();
    if p.eat(TokenKind::LParen) {
        while p.peek_kind() != TokenKind::RParen && !p.at_eof() {
            let name = parse_layout_ident(p, "Expected attr")?;
            let value = if p.eat(TokenKind::Equal) {
                Some(parse_layout_attr_str(p))
            } else if p.eat(TokenKind::Colon) {
                Some(parse_expr(p)?)
            } else {
                None
            };
            attrs.push(LayoutAttr { name, value });
            p.eat(TokenKind::Comma);
        }
        p.expect(TokenKind::RParen, "Expected ')'")?;
    }
    let (mut text, mut child_expr) = (None, None);
    if p.eat(TokenKind::Equal) {
        text = Some(if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString)
            && matches!(p.peek_n(1).kind, TokenKind::Newline | TokenKind::Comment | TokenKind::Dedent | TokenKind::Eof)
        {
            p.advance().lexeme
        } else {
            p.line_rest_raw()
        });
    } else if p.eat(TokenKind::Colon) {
        if matches!(p.peek_kind(), TokenKind::String | TokenKind::TripleString) {
            text = Some(p.advance().lexeme);
        } else if matches!(p.peek_kind(), TokenKind::Newline | TokenKind::Comment) {
            if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
            p.skip_newlines();
            if p.eat(TokenKind::Indent) {
                blocks.push(Vec::new());
                owners.push(LayoutOwner::Elem { tag, attrs, text, child_expr, tr });
                return Ok(());
            }
        } else {
            child_expr = Some(parse_expr(p)?);
        }
    }
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    if let Some(cur) = blocks.last_mut() {
        cur.push(LayoutNode::Element { tag, attrs, text, child_expr, children: Vec::new(), trivia: tr });
    }
    p.eat_stmt_end();
    Ok(())
}
