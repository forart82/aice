use aice_lang_registry::{LanguageId, ParsedTree};
use tree_sitter::Node;

use crate::decompile::cst_util::{field_text, named_children, node_text, with_ts_root};
use crate::decompile::trivia::{collect_trivia, is_comment_kind};
use crate::ir::{AiceItem, AiceModule, TranspileError, TranspileOpts, Trivia};
use crate::ir_domain::{DocBlock, DocSection, ShellDecl};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    with_ts_root(tree, |root| match lang {
        LanguageId::Markdown => decompile_md(root, src),
        _ => decompile_bash(root, src, opts),
    })
}

fn decompile_md(root: Node<'_>, src: &str) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Markdown, "markdown");
    let mut top = DocSection { level: 0, heading: String::new(), blocks: Vec::new(), children: Vec::new(), trivia: Trivia::default() };
    for ch in named_children(root) {
        match ch.kind() {
            "minus_metadata" => {
                let raw = node_text(ch, src).trim();
                let body = raw.strip_prefix("---").and_then(|s| s.strip_suffix("---")).unwrap_or(raw).trim().to_string();
                top.blocks.push(DocBlock::Frontmatter { marker: "---".into(), body });
            }
            "plus_metadata" => {
                let raw = node_text(ch, src).trim();
                let body = raw.strip_prefix("+++").and_then(|s| s.strip_suffix("+++")).unwrap_or(raw).trim().to_string();
                top.blocks.push(DocBlock::Frontmatter { marker: "+++".into(), body });
            }
            "section" => top.children.push(decompile_md_section(ch, src)),
            _ => {}
        }
    }
    if top.blocks.is_empty() && top.children.len() == 1 {
        m.items.push(AiceItem::Doc(top.children.remove(0)));
    } else {
        m.items.push(AiceItem::Doc(top));
    }
    Ok(m)
}

fn decompile_md_section(root: Node<'_>, src: &str) -> DocSection {
    enum MTask<'a> {
        Enter(Node<'a>),
        Finish { level: u8, heading: String, blocks: Vec<DocBlock>, len: usize },
    }
    let mut tasks = vec![MTask::Enter(root)];
    let mut out: Vec<DocSection> = Vec::new();
    while let Some(t) = tasks.pop() {
        match t {
            MTask::Enter(node) => {
                let (mut level, mut heading) = (1u8, String::new());
                let mut blocks = Vec::new();
                let mut child_secs = Vec::new();
                for ch in named_children(node) {
                    match ch.kind() {
                        "atx_heading" => {
                            let raw = node_text(ch, src).trim();
                            level = raw.bytes().take_while(|b| *b == b'#').count().clamp(1, 6) as u8;
                            heading = field_text(ch, "heading_content", src).unwrap_or_else(|| raw.trim_start_matches('#')).trim().to_string();
                        }
                        "setext_heading" => {
                            level = if node_text(ch, src).contains('=') { 1 } else { 2 };
                            heading = field_text(ch, "heading_content", src).unwrap_or("").trim().to_string();
                        }
                        "paragraph" => {
                            let txt = node_text(ch, src).trim();
                            if !txt.is_empty() { blocks.push(DocBlock::Paragraph(txt.into())); }
                        }
                        "fenced_code_block" => {
                            let lang = field_text(ch, "info_string", src).unwrap_or("").trim().to_string();
                            let code = named_children(ch).into_iter().find(|c| c.kind() == "code_fence_content")
                                .map(|c| node_text(c, src).trim_end_matches('\n').to_string()).unwrap_or_default();
                            blocks.push(DocBlock::CodeFence { lang, code });
                        }
                        "list" => {
                            for li in named_children(ch) {
                                if li.kind() == "list_item" {
                                    let raw = node_text(li, src).trim();
                                    let ordered = raw.chars().next().is_some_and(|c| c.is_ascii_digit());
                                    let text = raw.trim_start_matches(|c: char| c.is_ascii_digit() || matches!(c, '.' | ')' | '-' | '*' | '+')).trim().to_string();
                                    blocks.push(DocBlock::ListItem { ordered, checked: None, text });
                                }
                            }
                        }
                        "block_quote" => blocks.push(DocBlock::Quote(node_text(ch, src).trim().trim_start_matches('>').trim().into())),
                        "thematic_break" => blocks.push(DocBlock::ThematicBreak),
                        "pipe_table" => {
                            let mut headers = Vec::new();
                            let mut rows = Vec::new();
                            for r in named_children(ch) {
                                let cells: Vec<String> = named_children(r).into_iter().filter(|c| c.kind() == "pipe_table_cell")
                                    .map(|c| node_text(c, src).trim().to_string()).collect();
                                if r.kind() == "pipe_table_header" { headers = cells; }
                                else if r.kind() == "pipe_table_row" { rows.push(cells); }
                            }
                            blocks.push(DocBlock::Table { headers, rows });
                        }
                        "section" => child_secs.push(ch),
                        _ => {}
                    }
                }
                tasks.push(MTask::Finish { level, heading, blocks, len: child_secs.len() });
                for ch in child_secs.into_iter().rev() { tasks.push(MTask::Enter(ch)); }
            }
            MTask::Finish { level, heading, blocks, len } => {
                let children = out.split_off(out.len() - len);
                out.push(DocSection { level, heading, blocks, children, trivia: Trivia::default() });
            }
        }
    }
    out.pop().expect("md section")
}

fn decompile_bash(root: Node<'_>, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let mut m = AiceModule::new(LanguageId::Bash, "bash");
    for ch in named_children(root) {
        let tr = collect_trivia(ch, src, opts);
        let raw = node_text(ch, src).trim();
        match ch.kind() {
            "comment" => {
                if let Some(sb) = raw.strip_prefix("#!") {
                    m.items.push(AiceItem::Shell(ShellDecl::Shebang(sb.trim().into())));
                }
            }
            "function_definition" => {
                let name = field_text(ch, "name", src).unwrap_or("fn").trim().to_string();
                let body = ch.child_by_field_name("body").map(|b| node_text(b, src)).unwrap_or("");
                let inner = body.trim().strip_prefix('{').and_then(|s| s.strip_suffix('}')).unwrap_or(body);
                let body_lines = inner.lines().map(|l| l.trim().to_string()).filter(|l| !l.is_empty()).collect();
                m.items.push(AiceItem::Shell(ShellDecl::Fn { name, body_lines, trivia: tr }));
            }
            "variable_assignment" | "declaration_command" => {
                let exported = raw.starts_with("export ");
                let readonly = raw.starts_with("readonly ");
                let rest = raw.trim_start_matches("export ").trim_start_matches("readonly ").trim();
                if let Some((k, v)) = rest.split_once('=') {
                    m.items.push(AiceItem::Shell(ShellDecl::Var { name: k.trim().into(), value: v.trim().into(), exported, readonly, trivia: tr }));
                } else {
                    m.items.push(AiceItem::Shell(ShellDecl::Cmd { text: raw.into(), trivia: tr }));
                }
            }
            "command" if raw.starts_with("set ") => {
                m.items.push(AiceItem::Shell(ShellDecl::SetFlags(raw.trim_start_matches("set ").trim().into())));
            }
            _ if !is_comment_kind(ch.kind()) => m.items.push(AiceItem::Shell(ShellDecl::Cmd { text: raw.into(), trivia: tr })),
            _ => {}
        }
    }
    Ok(m)
}
