use std::collections::HashMap;

use crate::r5::checks::ErrorSpan;
use crate::r5::checks_tags::check_html;
use crate::r5::twig_html_eval::eval_all;
use crate::r5::twig_html_scan::{ScanMode, SegOp, scan_html_segment};
use crate::r5::twig_html_tree::{CtrlArena, CtrlKind, build_ctrl_tree, pos_to_line_col};
use crate::r5::twig_lexer::TwigTok;

pub(crate) const MAX_SIM_STATES: usize = 256;

#[derive(Default)]
pub(crate) struct Interner {
    items: Vec<String>,
    map: HashMap<String, usize>,
}

impl Interner {
    pub(crate) fn intern(&mut self, s: &str) -> usize {
        if let Some(&id) = self.map.get(s) {
            return id;
        }
        let id = self.items.len();
        self.items.push(s.to_string());
        self.map.insert(s.to_string(), id);
        id
    }
    pub(crate) fn get_id(&self, s: &str) -> Option<usize> { self.map.get(s).copied() }
    pub(crate) fn name(&self, id: usize) -> &str { &self.items[id] }
}

#[derive(Clone, PartialEq, Eq, Hash)]
pub(crate) struct SimState {
    pub stack: Vec<usize>,
    pub env: Vec<(usize, bool)>,
    pub mode: ScanMode,
    pub skip_until: usize,
}

#[derive(Clone, Default)]
pub(crate) struct StateMeta {
    pub open_pos: Vec<usize>,
    pub comment_pos: Option<usize>,
}

pub(crate) type StateMap = HashMap<SimState, StateMeta>;

pub(crate) struct ScopeCtx<'a> {
    pub slice: &'a str,
    pub line_starts: &'a [usize],
    pub tags: Interner,
    pub conds: Interner,
    pub counts: HashMap<usize, usize>,
    pub last_end: HashMap<usize, usize>,
    pub errs: Vec<ErrorSpan>,
}

pub fn check_control_html_balance(slice: &str, tokens: &[TwigTok], base_line: usize) -> Vec<ErrorSpan> {
    if !slice.contains('<') {
        return Vec::new();
    }
    let mut errs: Vec<ErrorSpan> = check_html(slice)
        .into_iter()
        .filter(|e| {
            !e.message.starts_with("Unclosed tag '<")
                && !e.message.starts_with("Unexpected closing tag '</")
                && e.message != "Unterminated comment '<!--'"
        })
        .collect();
    let arena = build_ctrl_tree(slice.len(), tokens, 0);
    let mut line_starts = vec![0usize];
    for (idx, &byte) in slice.as_bytes().iter().enumerate() {
        if byte == b'\n' {
            line_starts.push(idx + 1);
        }
    }
    let mut ctx = ScopeCtx {
        slice,
        line_starts: &line_starts,
        tags: Interner::default(),
        conds: Interner::default(),
        counts: HashMap::new(),
        last_end: HashMap::new(),
        errs: Vec::new(),
    };
    eval_all(&arena, arena.root_branch, &mut ctx);
    errs.extend(ctx.errs);
    errs.sort_by(|a, b| (a.line, a.column, &a.message).cmp(&(b.line, b.column, &b.message)));
    errs.dedup_by(|a, b| a.line == b.line && a.column == b.column && a.message == b.message);
    errs.into_iter()
        .map(|mut e| {
            e.line += base_line;
            e.end_line += base_line;
            e
        })
        .collect()
}

pub(crate) fn collect_scope_conds(
    arena: &CtrlArena,
    root_br: usize,
    conds: &mut Interner,
    counts: &mut HashMap<usize, usize>,
    last_end: &mut HashMap<usize, usize>,
) {
    let mut stack = vec![root_br];
    while let Some(br_idx) = stack.pop() {
        let br = &arena.branches[br_idx];
        for &ch_idx in &br.children {
            let child = &arena.blocks[ch_idx];
            if child.kind != CtrlKind::If {
                continue;
            }
            for &sub_idx in &child.branches {
                if let Some(c) = &arena.branches[sub_idx].cond {
                    let cid = conds.intern(c);
                    *counts.entry(cid).or_insert(0) += 1;
                    let le = last_end.entry(cid).or_insert(0);
                    *le = (*le).max(child.end);
                }
            }
        }
        for &ch_idx in br.children.iter().rev() {
            let child = &arena.blocks[ch_idx];
            if child.kind == CtrlKind::If {
                stack.extend(child.branches.iter().rev().copied());
            }
        }
    }
}

pub(crate) fn apply_range(from: usize, to: usize, states: StateMap, ctx: &mut ScopeCtx<'_>) -> StateMap {
    if states.is_empty() || from >= to {
        return states;
    }
    let mut cache: HashMap<(ScanMode, usize), (Vec<SegOp>, ScanMode, usize)> = HashMap::new();
    let mut next = StateMap::with_capacity(states.len());
    for (mut st, mut meta) in states {
        let (ops, end_mode, end_skip) = cache
            .entry((st.mode, st.skip_until))
            .or_insert_with(|| scan_html_segment(ctx.slice, from, to, st.mode, st.skip_until));
        for op in ops {
            match op {
                SegOp::StartComment(pos) => meta.comment_pos = Some(*pos),
                SegOp::EndComment => meta.comment_pos = None,
                SegOp::Open { pos, name } => {
                    let tid = ctx.tags.intern(name);
                    st.stack.push(tid);
                    meta.open_pos.push(*pos);
                }
                SegOp::Close { pos, name } => {
                    let tid = ctx.tags.intern(name);
                    if st.stack.last() == Some(&tid) {
                        st.stack.pop();
                        meta.open_pos.pop();
                    } else if let Some(p) = st.stack.iter().rposition(|&id| id == tid) {
                        for (&tid_open, &op_pos) in st.stack[(p + 1)..].iter().zip(&meta.open_pos[(p + 1)..]) {
                            let (line, col) = pos_to_line_col(ctx.line_starts, op_pos);
                            ctx.errs.push(err_at(line, col, format!("Unclosed tag '<{}>' before '</{}>'", ctx.tags.name(tid_open), name)));
                        }
                        st.stack.truncate(p);
                        meta.open_pos.truncate(p);
                    } else {
                        let (line, col) = pos_to_line_col(ctx.line_starts, *pos);
                        ctx.errs.push(err_at(line, col, format!("Unexpected closing tag '</{name}>'")));
                    }
                }
            }
        }
        st.mode = *end_mode;
        st.skip_until = if *end_skip <= to { 0 } else { *end_skip };
        next.entry(st).or_insert(meta);
    }
    next
}

pub(crate) fn merge_pruned(dst: &mut StateMap, src: StateMap, block_end: usize, last_end: &HashMap<usize, usize>) {
    for (mut st, meta) in src {
        st.env.retain(|(cid, _)| last_end.get(cid).copied().unwrap_or(0) > block_end);
        if dst.len() < MAX_SIM_STATES || dst.contains_key(&st) {
            dst.entry(st).or_insert(meta);
        }
    }
}

pub(crate) fn lookup_env(env: &[(usize, bool)], cid: usize) -> Option<bool> {
    env.iter().find(|&&(k, _)| k == cid).map(|&(_, v)| v)
}

pub(crate) fn set_env(env: &mut Vec<(usize, bool)>, cid: usize, val: bool) {
    if let Some(entry) = env.iter_mut().find(|(k, _)| *k == cid) {
        entry.1 = val;
    } else {
        env.push((cid, val));
        env.sort_unstable_by_key(|&(k, _)| k);
    }
}

pub(crate) fn err_at(line: usize, column: usize, message: String) -> ErrorSpan {
    ErrorSpan { line, column, end_line: line, message }
}