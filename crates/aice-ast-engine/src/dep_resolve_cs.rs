use std::path::Path;

use crate::dep_callers_other_ext::strip_balanced_angles;
use crate::dep_resolve::{WorkspaceIndex, probe_contained};

pub(crate) fn resolve_csharp(spec: &str, idx: &WorkspaceIndex, root: &Path) -> Vec<String> {
    let mut out = Vec::new();
    let trimmed = spec.trim().trim_start_matches("global::");
    let has_args = trimmed.contains('<') || trimmed.contains('(');
    if !trimmed.starts_with('(') {
        resolve_csharp_part(&strip_balanced_angles(trimmed), !has_args, idx, root, &mut out);
    }
    let open = [trimmed.find('<'), trimmed.find('(')].into_iter().flatten().min();
    let close = [trimmed.rfind('>'), trimmed.rfind(')')].into_iter().flatten().max();
    if let (Some(o), Some(c)) = (open, close)
        && o < c
    {
        for part in split_csharp_type_args(&trimmed[o + 1..c]) {
            resolve_csharp_part(part, false, idx, root, &mut out);
        }
    }
    out
}

fn push_cs_seg<'a>(seg: &'a str, out: &mut Vec<&'a str>) {
    let p = seg.trim().trim_start_matches("global::").trim();
    if let Some(tok) = p.split_whitespace().next()
        && !tok.is_empty()
    {
        out.push(tok);
    }
}

fn split_csharp_type_args(s: &str) -> Vec<&str> {
    let mut out = Vec::new();
    let (mut start, mut after_rparen) = (0usize, false);
    for (idx, ch) in s.char_indices() {
        if matches!(ch, '<' | '>' | ',' | '(' | ')') {
            if !after_rparen {
                push_cs_seg(&s[start..idx], &mut out);
            }
            after_rparen = ch == ')';
            start = idx + ch.len_utf8();
        }
    }
    if !after_rparen && start < s.len() {
        push_cs_seg(&s[start..], &mut out);
    }
    out
}

fn resolve_csharp_part(
    clean: &str,
    mut allow_module: bool,
    idx: &WorkspaceIndex,
    root: &Path,
    out: &mut Vec<String>,
) {
    let mut cand = clean
        .trim_end_matches(|c: char| c.is_whitespace() || matches!(c, '?' | '[' | ']' | '*'))
        .trim();
    while !cand.is_empty() {
        if cand.contains('.')
            && let Some(list) = idx.type_definers.get(cand)
        {
            for &ti in list {
                if let Some(p) = idx.path_for_idx(ti)
                    && !out.contains(&p)
                {
                    out.push(p);
                }
            }
            return;
        }
        if allow_module && let Some(list) = idx.module_definers.get(cand) {
            for &ti in list {
                if let Some(p) = idx.path_for_idx(ti)
                    && !out.contains(&p)
                {
                    out.push(p);
                }
            }
            return;
        }
        if let Some(p) = probe_contained("", &format!("{}.cs", cand.replace('.', "/")), idx, root) {
            if !out.contains(&p) {
                out.push(p);
            }
            return;
        }
        allow_module = false;
        cand = match cand.rsplit_once('.') {
            Some((parent, _)) => parent,
            None => break,
        };
    }
}
