use crate::ir::{AiceItem, TranspileError, Trivia};
use crate::ir_domain::{DocBlock, DocSection};
use crate::lexer_tokens::TokenKind;
use crate::parser::Parser;
pub(crate) use crate::parser_domain_sh::parse_sh;

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
    flat: bool,
}

fn close_doc_frame(stack: &mut Vec<DocFrame>) -> Option<DocSection> {
    let cur = stack.pop()?;
    let sec = DocSection {
        level: cur.level, heading: cur.heading, blocks: cur.blocks, children: cur.children, trivia: cur.tr,
    };
    if let Some(parent) = stack.last_mut() { parent.children.push(sec); None } else { Some(sec) }
}

fn is_table_sep_row(line: &str) -> bool {
    let t = line.trim().trim_matches('|').trim();
    !t.is_empty() && t.bytes().all(|b| matches!(b, b'-' | b':' | b'|' | b' '))
}

fn split_table_cells(line: &str) -> Vec<String> {
    line.trim().trim_matches('|').split('|').map(|c| c.trim().to_string()).collect()
}

fn parse_compact_md_body(root_level: u8, root_heading: String, tr: Trivia, body: &str) -> DocSection {
    let mut stack = vec![DocFrame {
        level: root_level, heading: root_heading, blocks: Vec::new(), children: Vec::new(),
        tr, has_indent: false, flat: false,
    }];
    let lines: Vec<&str> = body.split('\n').collect();
    let mut i = 0usize;
    if let Some(&first) = lines.first()
        && (first.trim() == "---" || first.trim() == "+++")
        && let Some(end) = lines[1..].iter().position(|l| l.trim() == first.trim())
    {
        let fm_body = lines[1..1 + end].join("\n");
        stack[0].blocks.push(DocBlock::Frontmatter { marker: first.trim().into(), body: fm_body });
        i = end + 2;
    }
    let mut para_buf: Vec<&str> = Vec::new();
    let flush_para = |buf: &mut Vec<&str>, st: &mut Vec<DocFrame>| {
        if !buf.is_empty() {
            let txt = buf.join("\n");
            buf.clear();
            if let Some(cur) = st.last_mut() { cur.blocks.push(DocBlock::Paragraph(txt)); }
        }
    };
    while i < lines.len() {
        let line = lines[i];
        let trimmed = line.trim();
        if trimmed.is_empty() {
            flush_para(&mut para_buf, &mut stack);
            i += 1;
            continue;
        }
        if let Some(rest) = trimmed.strip_prefix("```") {
            flush_para(&mut para_buf, &mut stack);
            let lang = rest.trim().to_string();
            i += 1;
            let mut code_lines = Vec::new();
            while i < lines.len() && !lines[i].trim().starts_with("```") {
                code_lines.push(lines[i]);
                i += 1;
            }
            if i < lines.len() { i += 1; }
            if let Some(cur) = stack.last_mut() {
                cur.blocks.push(DocBlock::CodeFence { lang, code: code_lines.join("\n") });
            }
            continue;
        }
        let hashes = trimmed.bytes().take_while(|&b| b == b'#').count();
        let compact_h = trimmed.as_bytes().first() == Some(&b'h')
            && trimmed.as_bytes().get(1).is_some_and(|b| (b'1'..=b'6').contains(b))
            && trimmed.get(2..4) == Some(": ");
        if ((1..=6).contains(&hashes) && trimmed.as_bytes().get(hashes) == Some(&b' ')) || compact_h {
            flush_para(&mut para_buf, &mut stack);
            let (lvl, heading) = if compact_h {
                (trimmed.as_bytes()[1] - b'0', trimmed[4..].trim().to_string())
            } else {
                (hashes as u8, trimmed[hashes + 1..].trim().to_string())
            };
            while stack.last().is_some_and(|f| f.flat && f.level >= lvl) {
                let _ = close_doc_frame(&mut stack);
            }
            stack.push(DocFrame {
                level: lvl, heading, blocks: Vec::new(), children: Vec::new(),
                tr: Trivia::default(), has_indent: false, flat: true,
            });
            i += 1;
            continue;
        }
        if trimmed == "---" || trimmed == "***" || trimmed == "___" {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::ThematicBreak); }
            i += 1;
            continue;
        }
        if let Some(q) = trimmed.strip_prefix("> ") {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::Quote(q.to_string())); }
            i += 1;
            continue;
        }
        if trimmed.starts_with('|') && trimmed.ends_with('|') && trimmed.len() > 2 {
            flush_para(&mut para_buf, &mut stack);
            let headers = split_table_cells(trimmed);
            i += 1;
            if i < lines.len() && is_table_sep_row(lines[i]) { i += 1; }
            let mut rows = Vec::new();
            while i < lines.len() {
                let rt = lines[i].trim();
                if rt.starts_with('|') && rt.ends_with('|') && rt.len() > 2 {
                    rows.push(split_table_cells(rt));
                    i += 1;
                } else { break; }
            }
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::Table { headers, rows }); }
            continue;
        }
        if let Some(t) = trimmed.strip_prefix("- [x] ").or_else(|| trimmed.strip_prefix("- [X] ")).or_else(|| trimmed.strip_prefix("[x] ")).or_else(|| trimmed.strip_prefix("[X] ")) {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::ListItem { ordered: false, checked: Some(true), text: t.into() }); }
            i += 1;
            continue;
        }
        if let Some(t) = trimmed.strip_prefix("- [ ] ").or_else(|| trimmed.strip_prefix("[ ] ")) {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::ListItem { ordered: false, checked: Some(false), text: t.into() }); }
            i += 1;
            continue;
        }
        if let Some(t) = trimmed.strip_prefix("li: ").or_else(|| trimmed.strip_prefix("- ")).or_else(|| trimmed.strip_prefix("* ")) {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::ListItem { ordered: false, checked: None, text: t.into() }); }
            i += 1;
            continue;
        }
        let dcnt = trimmed.bytes().take_while(u8::is_ascii_digit).count();
        if dcnt > 0 && trimmed[dcnt..].starts_with(". ") {
            flush_para(&mut para_buf, &mut stack);
            let t = trimmed[dcnt + 2..].to_string();
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::ListItem { ordered: true, checked: None, text: t }); }
            i += 1;
            continue;
        }
        if trimmed.starts_with('[') && let Some((lbl, dst)) = trimmed[1..].split_once("]: ") {
            flush_para(&mut para_buf, &mut stack);
            if let Some(cur) = stack.last_mut() { cur.blocks.push(DocBlock::LinkRef { label: lbl.into(), dest: dst.into() }); }
            i += 1;
            continue;
        }
        para_buf.push(line);
        i += 1;
    }
    flush_para(&mut para_buf, &mut stack);
    while stack.len() > 1 { let _ = close_doc_frame(&mut stack); }
    close_doc_frame(&mut stack).expect("root doc")
}

fn start_doc_section(p: &mut Parser<'_>, trivia: Trivia) -> Result<DocFrame, TranspileError> {
    p.advance(); // "doc"
    let (level, heading) = if p.peek_kind() == TokenKind::Colon {
        (0u8, String::new())
    } else {
        let lvl = p.expect(TokenKind::Number, "Expected heading level")?.lexeme.parse::<u8>().unwrap_or(1);
        let h = p.expect(TokenKind::String, "Expected heading text")?.lexeme;
        (lvl, h)
    };
    p.expect(TokenKind::Colon, "Expected ':'")?;
    let mut tr = trivia;
    if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
    p.skip_newlines();
    let has_indent = p.eat(TokenKind::Indent);
    Ok(DocFrame { level, heading, blocks: Vec::new(), children: Vec::new(), tr, has_indent, flat: false })
}

fn parse_doc_section(p: &mut Parser<'_>, trivia: Trivia) -> Result<DocSection, TranspileError> {
    let saved = p.pos;
    p.advance(); // "doc"
    let (level, heading) = if p.peek_kind() == TokenKind::Colon {
        (0u8, String::new())
    } else {
        let lvl = p.expect(TokenKind::Number, "Expected heading level")?.lexeme.parse::<u8>().unwrap_or(1);
        let h = p.expect(TokenKind::String, "Expected heading text")?.lexeme;
        (lvl, h)
    };
    if p.eat(TokenKind::Colon) && p.peek_kind() == TokenKind::TripleString {
        let body = p.advance().lexeme;
        let mut tr = trivia;
        if tr.trailing.is_none() { tr.trailing = p.take_trailing_comment(); }
        return Ok(parse_compact_md_body(level, heading, tr, &body));
    }
    p.pos = saved;
    let mut stack = vec![start_doc_section(p, trivia)?];
    loop {
        let has_indent = stack.iter().any(|f| f.has_indent);
        if !has_indent || p.at_eof() || p.peek_kind() == TokenKind::Dedent {
            while stack.last().is_some_and(|f| f.flat) { let _ = close_doc_frame(&mut stack); }
            if stack.last().is_some_and(|f| f.has_indent) { p.eat(TokenKind::Dedent); }
            if let Some(done) = close_doc_frame(&mut stack) { return Ok(done); }
            p.eat_stmt_end();
            continue;
        }
        let btr = p.collect_leading_trivia();
        if p.peek_kind() == TokenKind::Dedent || p.at_eof() { continue; }
        if p.peek().lexeme == "doc" {
            stack.push(start_doc_section(p, btr)?);
            continue;
        }
        let blk = parse_doc_block_legacy(p)?;
        if let Some(cur) = stack.last_mut() { cur.blocks.push(blk); }
        p.eat_stmt_end();
    }
}

fn parse_doc_block_legacy(p: &mut Parser<'_>) -> Result<DocBlock, TranspileError> {
    if p.peek_kind() == TokenKind::RawLine {
        return Ok(DocBlock::Paragraph(p.advance().lexeme));
    }
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
