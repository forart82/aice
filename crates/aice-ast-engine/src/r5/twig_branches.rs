use std::collections::HashSet;

use crate::r5::twig_branch_expand::expand_if_plan;
use crate::r5::twig_html_tree::{TagEvent, normalize_cond, scan_html_events};
use crate::r5::twig_lexer::{TwigTok, TwigTokKind};

#[derive(Clone, Default)]
pub struct VariantPlan {
    pub masks: Vec<(usize, usize)>,
    pub resolved_tags: Vec<usize>,
}

pub struct InTagIfPlan {
    pub variants: Vec<VariantPlan>,
    pub has_unexpanded_ctrl: bool,
}

pub(crate) struct IfBranch {
    pub start: usize,
    pub end: usize,
    pub cond: Option<String>,
    pub children: Vec<usize>,
}

pub(crate) struct IfBlock {
    pub start_byte: usize,
    pub end_byte: usize,
    pub has_else: bool,
    pub needs_expand: bool,
    pub tag_bytes: Vec<usize>,
    pub branches: Vec<IfBranch>,
}

pub(crate) struct IfArena {
    pub blocks: Vec<IfBlock>,
    pub roots: Vec<usize>,
}

struct Frame {
    start_byte: usize,
    cur_start: usize,
    cur_cond: Option<String>,
    has_else: bool,
    in_tag: bool,
    tag_bytes: Vec<usize>,
    branches: Vec<IfBranch>,
    children: Vec<usize>,
}

enum StackEntry {
    If(Frame),
    For,
}

pub fn build_twig_if_plan(
    masked: &str,
    tokens: &[TwigTok],
    is_in_tag: fn(&str, usize) -> bool,
) -> InTagIfPlan {
    let mut arena = build_if_tree(masked, tokens, is_in_tag);
    if arena.roots.is_empty() {
        return InTagIfPlan { variants: Vec::new(), has_unexpanded_ctrl: false };
    }
    let (events, _) = scan_html_events(masked);
    mark_crossing(&mut arena, &events, masked, is_in_tag);
    let mut shared = HashSet::new();
    collect_expand_conds(&arena, &mut shared);
    if !shared.is_empty() {
        propagate_shared_conds(&mut arena, &shared);
    }
    let has_for = tokens.iter().any(|t| {
        matches!(&t.kind, TwigTokKind::Tag { keyword, .. } if keyword == "for")
    });
    let has_unexp = arena.blocks.iter().any(|b| !b.needs_expand);
    let expand_roots: Vec<usize> = arena
        .roots
        .iter()
        .copied()
        .filter(|&r| arena.blocks[r].needs_expand)
        .collect();
    let mut plan = expand_if_plan(&arena, &expand_roots);
    plan.has_unexpanded_ctrl |= has_for || has_unexp;
    plan
}

fn build_if_tree(
    masked: &str,
    tokens: &[TwigTok],
    is_in_tag: fn(&str, usize) -> bool,
) -> IfArena {
    let mut stack: Vec<StackEntry> = Vec::new();
    let mut arena = IfArena { blocks: Vec::new(), roots: Vec::new() };
    for tok in tokens {
        let TwigTokKind::Tag { keyword, rest } = &tok.kind else {
            continue;
        };
        match keyword.as_str() {
            "if" => stack.push(StackEntry::If(Frame {
                start_byte: tok.start_byte,
                cur_start: tok.end_byte,
                cur_cond: normalize_cond(rest),
                has_else: false,
                in_tag: is_in_tag(masked, tok.start_byte),
                tag_bytes: vec![tok.start_byte],
                branches: Vec::new(),
                children: Vec::new(),
            })),
            "for" => stack.push(StackEntry::For),
            "endfor" if matches!(stack.last(), Some(StackEntry::For)) => {
                stack.pop();
            }
            "elseif" | "else" => {
                if let Some(StackEntry::If(top)) = stack.last_mut() {
                    if keyword == "else" {
                        top.has_else = true;
                    }
                    top.tag_bytes.push(tok.start_byte);
                    let children = std::mem::take(&mut top.children);
                    top.branches.push(IfBranch {
                        start: top.cur_start,
                        end: tok.start_byte,
                        cond: top.cur_cond.take(),
                        children,
                    });
                    top.cur_cond = if keyword == "elseif" { normalize_cond(rest) } else { None };
                    top.cur_start = tok.end_byte;
                }
            }
            "endif" => {
                while matches!(stack.last(), Some(StackEntry::For)) {
                    stack.pop();
                }
                if let Some(StackEntry::If(mut top)) = stack.pop() {
                    top.tag_bytes.push(tok.start_byte);
                    let children = std::mem::take(&mut top.children);
                    top.branches.push(IfBranch {
                        start: top.cur_start,
                        end: tok.start_byte,
                        cond: top.cur_cond.take(),
                        children,
                    });
                    let idx = arena.blocks.len();
                    arena.blocks.push(IfBlock {
                        start_byte: top.start_byte,
                        end_byte: tok.end_byte,
                        has_else: top.has_else,
                        needs_expand: top.in_tag,
                        tag_bytes: top.tag_bytes,
                        branches: top.branches,
                    });
                    if let Some(parent) = stack.iter_mut().rev().find_map(|e| match e {
                        StackEntry::If(f) => Some(f),
                        StackEntry::For => None,
                    }) {
                        parent.children.push(idx);
                    } else {
                        arena.roots.push(idx);
                    }
                }
            }
            _ => {}
        }
    }
    arena
}

fn mark_crossing(
    arena: &mut IfArena,
    events: &[TagEvent],
    masked: &str,
    is_in_tag: fn(&str, usize) -> bool,
) {
    for idx in 0..arena.blocks.len() {
        let mut extra = false;
        for b_i in 0..arena.blocks[idx].branches.len() {
            let br = &arena.blocks[idx].branches[b_i];
            extra |= br.children.iter().any(|&c| arena.blocks[c].needs_expand);
            if !extra && direct_branch_crosses(br, &arena.blocks, events, masked, is_in_tag) {
                extra = true;
            }
        }
        arena.blocks[idx].needs_expand |= extra;
    }
}

fn direct_branch_crosses(
    br: &IfBranch,
    blocks: &[IfBlock],
    events: &[TagEvent],
    masked: &str,
    is_in_tag: fn(&str, usize) -> bool,
) -> bool {
    if !is_in_tag(masked, br.start) && is_in_tag(masked, br.end) {
        return true;
    }
    let idx = events.partition_point(|ev| ev.pos < br.start);
    let mut stack: Vec<&str> = Vec::new();
    for ev in &events[idx..] {
        if ev.pos >= br.end {
            break;
        }
        if br.children.iter().any(|&c| ev.pos >= blocks[c].start_byte && ev.pos < blocks[c].end_byte) {
            continue;
        }
        if ev.is_open {
            stack.push(&ev.name);
        } else if stack.last() == Some(&ev.name.as_str()) {
            stack.pop();
        } else {
            return true;
        }
    }
    !stack.is_empty()
}

fn collect_expand_conds(arena: &IfArena, shared: &mut HashSet<String>) {
    for b in &arena.blocks {
        if b.needs_expand {
            for br in &b.branches {
                if let Some(c) = &br.cond {
                    shared.insert(c.clone());
                }
            }
        }
    }
}

fn propagate_shared_conds(arena: &mut IfArena, shared: &HashSet<String>) {
    for idx in 0..arena.blocks.len() {
        let b = &arena.blocks[idx];
        let has_shared = b.branches.iter().any(|br| br.cond.as_ref().is_some_and(|c| shared.contains(c)));
        let sub_any = b.branches.iter().any(|br| br.children.iter().any(|&c| arena.blocks[c].needs_expand));
        arena.blocks[idx].needs_expand |= has_shared || sub_any;
    }
}