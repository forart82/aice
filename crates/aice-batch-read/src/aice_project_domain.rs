use aice_aice_ir::ir::AiceItem;
use aice_aice_ir::ir_domain::{DocBlock, DocSection, ShellDecl};
use aice_aice_ir::ir_domain_db::DbMigrationDecl;
use aice_lang_registry::SymbolNode;

use crate::aice_project::ProjectWindowArgs;
use crate::aice_project_util::{find_sym_span, find_text_span, item_line_range};

fn merge_rng(cur: &mut Option<(usize, usize)>, next: Option<(usize, usize)>) {
    if let Some((s, e)) = next {
        *cur = Some(match *cur { Some((a, b)) => (a.min(s), b.max(e)), None => (s, e) });
    }
}

pub(crate) fn shell_line_range(sh: &ShellDecl, syms: &[SymbolNode], src: &str) -> Option<(usize, usize)> {
    match sh {
        ShellDecl::Shebang(s) => find_text_span(src, s),
        ShellDecl::SetFlags(f) => find_text_span(src, &format!("set {f}")).or_else(|| find_text_span(src, f)),
        ShellDecl::Var { name, value, .. } => find_sym_span(name, syms)
            .or_else(|| find_text_span(src, &format!("{name}={value}")))
            .or_else(|| find_text_span(src, name)),
        ShellDecl::Fn { name, body_lines, .. } => find_sym_span(name, syms)
            .or_else(|| find_text_span(src, name).map(|(s, _)| (s, s + body_lines.len() + 1))),
        ShellDecl::Cmd { text, .. } => find_text_span(src, text),
    }
}

pub(crate) fn db_migration_line_range(
    dm: &DbMigrationDecl,
    starts: &[usize],
    syms: &[SymbolNode],
    src: &str,
) -> Option<(usize, usize)> {
    let mut rng = None;
    for (label, subs) in &dm.sections {
        merge_rng(&mut rng, find_sym_span(label, syms));
        for sub in subs { merge_rng(&mut rng, item_line_range(sub, starts, syms, src)); }
    }
    rng
}

pub(crate) fn doc_section_line_range(doc: &DocSection, syms: &[SymbolNode], src: &str) -> Option<(usize, usize)> {
    let mut rng = None;
    if !doc.heading.is_empty() {
        merge_rng(&mut rng, find_sym_span(&doc.heading, syms).or_else(|| find_text_span(src, &doc.heading)));
    }
    for blk in &doc.blocks { merge_rng(&mut rng, doc_block_span(blk, src)); }
    for ch in &doc.children { merge_rng(&mut rng, doc_section_line_range(ch, syms, src)); }
    rng
}

fn doc_block_span(blk: &DocBlock, src: &str) -> Option<(usize, usize)> {
    match blk {
        DocBlock::Paragraph(t) | DocBlock::Quote(t) => find_text_span(src, t),
        DocBlock::ListItem { text, .. } => find_text_span(src, text),
        DocBlock::CodeFence { code, .. } => find_text_span(src, code).or_else(|| find_text_span(src, "```")),
        DocBlock::Table { headers, rows } => {
            let mut rng = headers.first().and_then(|h| find_text_span(src, h));
            if let Some(last) = rows.last().and_then(|r| r.first()) { merge_rng(&mut rng, find_text_span(src, last)); }
            rng
        }
        DocBlock::ThematicBreak => find_text_span(src, "---"),
        DocBlock::LinkRef { label, dest } => find_text_span(src, &format!("[{label}]:")).or_else(|| find_text_span(src, dest)),
        DocBlock::Frontmatter { marker, body } => find_text_span(src, body).or_else(|| find_text_span(src, marker)),
    }
}

pub(crate) fn project_shell_item(
    sh: &ShellDecl,
    is: usize,
    win_src: &str,
    args: &ProjectWindowArgs<'_>,
) -> Option<ShellDecl> {
    match sh {
        ShellDecl::Fn { name, body_lines, trivia } => {
            let hdr_in_win = is >= args.start_line && is <= args.end_line;
            let kept: Vec<String> = body_lines
                .iter()
                .filter(|bl| { let t = bl.trim(); !t.is_empty() && win_src.lines().any(|wl| wl.trim().contains(t)) })
                .cloned()
                .collect();
            (hdr_in_win || !kept.is_empty()).then(|| ShellDecl::Fn {
                name: name.clone(),
                body_lines: kept,
                trivia: trivia.clone(),
            })
        }
        other => {
            let hit = is >= args.start_line
                || shell_line_range(other, args.syms, args.full_src)
                    .is_some_and(|(s, e)| e >= args.start_line && s <= args.end_line);
            hit.then(|| other.clone())
        }
    }
}

pub(crate) fn project_db_migration(dm: &DbMigrationDecl, args: &ProjectWindowArgs<'_>) -> Option<DbMigrationDecl> {
    let mut sections = Vec::new();
    for (label, subs) in &dm.sections {
        let kept_subs: Vec<AiceItem> = subs
            .iter()
            .filter(|sub| {
                item_line_range(sub, args.starts, args.syms, args.full_src)
                    .is_some_and(|(s, e)| e >= args.start_line && s <= args.end_line)
            })
            .cloned()
            .collect();
        let label_in_win = find_sym_span(label, args.syms).is_some_and(|(s, _)| s >= args.start_line && s <= args.end_line);
        if !kept_subs.is_empty() || label_in_win {
            sections.push((label.clone(), kept_subs));
        }
    }
    (!sections.is_empty()).then(|| DbMigrationDecl { tool: dm.tool.clone(), sections, trivia: dm.trivia.clone() })
}

pub(crate) fn project_doc_section(doc: &DocSection, args: &ProjectWindowArgs<'_>) -> Option<DocSection> {
    let heading_in_win = !doc.heading.is_empty()
        && find_text_span(args.full_src, &doc.heading).is_some_and(|(s, _)| s >= args.start_line && s <= args.end_line);
    let kept_blocks: Vec<DocBlock> = doc
        .blocks
        .iter()
        .filter(|b| doc_block_span(b, args.full_src).is_some_and(|(s, e)| e >= args.start_line && s <= args.end_line))
        .cloned()
        .collect();
    let kept_children: Vec<DocSection> = doc.children.iter().filter_map(|c| project_doc_section(c, args)).collect();
    (heading_in_win || !kept_blocks.is_empty() || !kept_children.is_empty()).then(|| DocSection {
        level: doc.level,
        heading: doc.heading.clone(),
        blocks: kept_blocks,
        children: kept_children,
        trivia: doc.trivia.clone(),
    })
}
