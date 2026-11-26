use crate::r5::checks_tags::{find_rawtext_close, find_tag_end, is_html_void, scan_tag_name};
use crate::r5::twig_lexer::{TwigTok, TwigTokKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CtrlKind {
    Root,
    If,
    For,
}

pub(crate) struct CtrlBranch {
    pub start: usize,
    pub end: usize,
    pub cond: Option<String>,
    pub children: Vec<usize>,
}

pub(crate) struct CtrlBlock {
    pub kind: CtrlKind,
    pub start: usize,
    pub end: usize,
    pub has_else: bool,
    pub branches: Vec<usize>,
}

pub(crate) struct CtrlArena {
    pub blocks: Vec<CtrlBlock>,
    pub branches: Vec<CtrlBranch>,
    pub root_branch: usize,
}

struct CtrlFrame {
    kind: CtrlKind,
    start: usize,
    cur_start: usize,
    cur_cond: Option<String>,
    has_else: bool,
    branches: Vec<usize>,
    children: Vec<usize>,
}

pub(crate) struct TagEvent {
    pub pos: usize,
    pub name: String,
    pub is_open: bool,
}

pub(crate) fn normalize_cond(rest: &str) -> Option<String> {
    let s = rest.split_whitespace().collect::<Vec<_>>().join(" ");
    if s.is_empty() { None } else { Some(s) }
}

pub(crate) fn pos_to_line_col(line_starts: &[usize], pos: usize) -> (usize, usize) {
    let idx = line_starts.partition_point(|&s| s <= pos).saturating_sub(1);
    (idx + 1, pos.saturating_sub(line_starts[idx]) + 1)
}

pub(crate) fn build_ctrl_tree(len: usize, tokens: &[TwigTok], base_offset: usize) -> CtrlArena {
    let mut arena = CtrlArena { blocks: Vec::new(), branches: Vec::new(), root_branch: 0 };
    let mut stack = vec![CtrlFrame {
        kind: CtrlKind::Root,
        start: 0,
        cur_start: 0,
        cur_cond: None,
        has_else: false,
        branches: Vec::new(),
        children: Vec::new(),
    }];
    for tok in tokens {
        let TwigTokKind::Tag { keyword, rest } = &tok.kind else {
            continue;
        };
        let s = tok.start_byte.saturating_sub(base_offset).min(len);
        let e = tok.end_byte.saturating_sub(base_offset).min(len);
        match keyword.as_str() {
            "if" => stack.push(CtrlFrame {
                kind: CtrlKind::If,
                start: s,
                cur_start: e,
                cur_cond: normalize_cond(rest),
                has_else: false,
                branches: Vec::new(),
                children: Vec::new(),
            }),
            "for" => stack.push(CtrlFrame {
                kind: CtrlKind::For,
                start: s,
                cur_start: e,
                cur_cond: None,
                has_else: false,
                branches: Vec::new(),
                children: Vec::new(),
            }),
            "elseif" if stack.len() > 1 && stack.last().is_some_and(|t| t.kind == CtrlKind::If) => {
                let top = stack.last_mut().expect("len > 1");
                let children = std::mem::take(&mut top.children);
                let br_idx = arena.branches.len();
                arena.branches.push(CtrlBranch {
                    start: top.cur_start,
                    end: s.max(top.cur_start),
                    cond: top.cur_cond.take(),
                    children,
                });
                top.branches.push(br_idx);
                top.cur_cond = normalize_cond(rest);
                top.cur_start = e;
            }
            "else" if stack.len() > 1 && stack.last().is_some_and(|t| !t.has_else) => {
                let top = stack.last_mut().expect("len > 1");
                top.has_else = true;
                let children = std::mem::take(&mut top.children);
                let br_idx = arena.branches.len();
                arena.branches.push(CtrlBranch {
                    start: top.cur_start,
                    end: s.max(top.cur_start),
                    cond: top.cur_cond.take(),
                    children,
                });
                top.branches.push(br_idx);
                top.cur_start = e;
            }
            "endif" | "endfor" if stack.len() > 1 => {
                let top = stack.pop().expect("len > 1");
                let blk_idx = finish_frame(&mut arena, top, s, e);
                stack.last_mut().expect("root").children.push(blk_idx);
            }
            _ => {}
        }
    }
    while stack.len() > 1 {
        let top = stack.pop().expect("non-empty");
        let blk_idx = finish_frame(&mut arena, top, len, len);
        stack.last_mut().expect("root").children.push(blk_idx);
    }
    let mut root = stack.pop().expect("root");
    let children = std::mem::take(&mut root.children);
    let root_br = arena.branches.len();
    arena.branches.push(CtrlBranch {
        start: root.cur_start,
        end: len.max(root.cur_start),
        cond: None,
        children,
    });
    arena.root_branch = root_br;
    arena
}

fn finish_frame(arena: &mut CtrlArena, mut top: CtrlFrame, end_s: usize, end_e: usize) -> usize {
    let children = std::mem::take(&mut top.children);
    let br_idx = arena.branches.len();
    arena.branches.push(CtrlBranch {
        start: top.cur_start,
        end: end_s.max(top.cur_start),
        cond: top.cur_cond.take(),
        children,
    });
    top.branches.push(br_idx);
    let blk_idx = arena.blocks.len();
    arena.blocks.push(CtrlBlock {
        kind: top.kind,
        start: top.start,
        end: end_e,
        has_else: top.has_else,
        branches: top.branches,
    });
    blk_idx
}

pub(crate) fn scan_html_events(slice: &str) -> (Vec<TagEvent>, Vec<usize>) {
    let b = slice.as_bytes();
    let mut line_starts = vec![0usize];
    for (idx, &byte) in b.iter().enumerate() {
        if byte == b'\n' {
            line_starts.push(idx + 1);
        }
    }
    let mut events = Vec::new();
    let (mut i, mut in_comment, mut saw_comment) = (0usize, false, false);
    while i < b.len() {
        if in_comment {
            if let Some(rel) = slice[i..].find("-->") {
                events.push(TagEvent { pos: i + rel, name: "!--".to_string(), is_open: false });
                in_comment = false;
                i += rel + 3;
            } else {
                break;
            }
            continue;
        }
        if saw_comment && b[i..].starts_with(b"-->") {
            events.push(TagEvent { pos: i, name: "!--".to_string(), is_open: false });
            i += 3;
            continue;
        }
        if b[i] != b'<' {
            i += 1;
            continue;
        }
        if slice[i..].starts_with("<!--") {
            events.push(TagEvent { pos: i, name: "!--".to_string(), is_open: true });
            in_comment = true;
            saw_comment = true;
            i += 4;
            continue;
        }
        if slice[i..].starts_with("<![CDATA[") {
            let Some(rel) = slice[i + 9..].find("]]>") else { break };
            i += 9 + rel + 3;
            continue;
        }
        if slice[i..].starts_with("<?") {
            let Some(rel) = slice[i + 2..].find('>') else { break };
            i += 2 + rel + 1;
            continue;
        }
        if slice[i..].starts_with("<!") {
            let Some(end) = find_tag_end(b, i + 2) else { break };
            i = end + 1;
            continue;
        }
        if slice[i..].starts_with("</") {
            let name_start = i + 2;
            let name_end = scan_tag_name(b, name_start);
            if name_end == name_start {
                i += 1;
                continue;
            }
            let norm = slice[name_start..name_end].to_ascii_lowercase();
            let Some(end) = find_tag_end(b, name_end) else { break };
            events.push(TagEvent { pos: i, name: norm, is_open: false });
            i = end + 1;
            continue;
        }
        let name_start = i + 1;
        let name_end = scan_tag_name(b, name_start);
        if name_end == name_start {
            i += 1;
            continue;
        }
        let norm = slice[name_start..name_end].to_ascii_lowercase();
        let Some(end) = find_tag_end(b, name_end) else { break };
        let open_pos = i;
        let self_closing = slice[name_end..end].trim_end().ends_with('/');
        i = end + 1;
        if !self_closing && matches!(norm.as_str(), "script" | "style" | "textarea" | "title") {
            if let Some(end_rel) = find_rawtext_close(&slice[i..], &norm) {
                i += end_rel;
            }
            continue;
        }
        if !self_closing && !is_html_void(&norm) {
            events.push(TagEvent { pos: open_pos, name: norm, is_open: true });
        }
    }
    (events, line_starts)
}
