use crate::r5::bash_abort_bounds::is_bang_command_wrapper;
use crate::r5::bash_deps_hd_case::next_non_comment_sibling;
use crate::r5::bash_time_brace::{
    close_brace_starts_pipeline, count_open_brace_word, open_braces_in_node,
    time_brace_is_bang_negated,
};

pub(super) fn prev_non_comment_sibling<'a>(node: tree_sitter::Node<'a>) -> Option<tree_sitter::Node<'a>> {
    let mut sib = node.prev_named_sibling();
    while let Some(s) = sib {
        if s.kind() != "comment" {
            return Some(s);
        }
        sib = s.prev_named_sibling();
    }
    None
}

fn is_bang_brace_body(mut cur: tree_sitter::Node<'_>, src: &str) -> bool {
    loop {
        if cur.kind() == "negated_command" {
            let Some(c) = (0..cur.named_child_count())
                .filter_map(|i| cur.named_child(i as u32))
                .find(|c| c.kind() != "comment")
            else {
                return false;
            };
            cur = c;
        } else if is_bang_command_wrapper(cur, src) {
            let mut found = None;
            for i in 0..cur.named_child_count() {
                if let Some(c) = cur.named_child(i as u32)
                    && !matches!(c.kind(), "command_name" | "comment")
                {
                    let t = src[c.start_byte()..c.end_byte()].trim();
                    if c.kind() == "word" && count_open_brace_word(t).is_some() {
                        return true;
                    }
                    if c.kind() == "word" && t == "!" {
                        continue;
                    }
                    found = Some(c);
                    break;
                }
            }
            let Some(next_c) = found else { return false };
            cur = next_c;
        } else {
            break;
        }
    }
    cur.kind() == "command"
        && cur.child_by_field_name("name").is_some_and(|nm| {
            count_open_brace_word(src[nm.start_byte()..nm.end_byte()].trim()).is_some()
        })
}

pub(super) fn is_split_bang_brace_open(n: tree_sitter::Node<'_>, src: &str) -> bool {
    n.kind() == "negated_command" && is_bang_brace_body(n, src)
}

pub(super) fn split_brace_starts_pipe(mut n: tree_sitter::Node<'_>, src: &str) -> bool {
    if n.parent().is_some_and(|p| p.kind() == "redirected_statement")
        && next_non_comment_sibling(n).is_some_and(|s| s.kind().ends_with("redirect"))
    {
        n = n.parent().unwrap();
    }
    let mut depth = open_braces_in_node(n, src);
    if depth == 0 {
        return false;
    }
    let mut sib = next_non_comment_sibling(n);
    while let Some(s) = sib {
        let o = open_braces_in_node(s, src);
        if o > 0 {
            depth += o;
        } else if let Some(close_cmd) = is_close_brace_node(s, src) {
            depth -= 1;
            if depth == 0 {
                if close_brace_starts_pipeline(close_cmd, s) {
                    return true;
                }
                let after = src[close_cmd.end_byte()..].trim_start_matches([' ', '\t']);
                return after.starts_with('|') && !after.starts_with("||");
            }
        }
        sib = next_non_comment_sibling(s);
    }
    false
}

pub(super) fn is_split_bang_brace_prev_pipe(pipeline: tree_sitter::Node<'_>, src: &str) -> bool {
    let Some(first) = (0..pipeline.named_child_count())
        .filter_map(|i| pipeline.named_child(i as u32))
        .find(|c| c.kind() != "comment")
    else {
        return false;
    };
    if first.kind() != "command" || src[first.start_byte()..first.end_byte()].trim() != "}" {
        return false;
    }
    let mut cur = if prev_non_comment_sibling(pipeline).is_none()
        && let Some(lp) = pipeline.parent().filter(|p| p.kind() == "list")
    {
        lp
    } else {
        pipeline
    };
    let mut close_cnt = 1usize;
    while let Some(p) = prev_non_comment_sibling(cur) {
        let o = open_braces_in_node(p, src);
        if o > 0 {
            if o >= close_cnt {
                let is_open = is_split_bang_brace_open(p, src)
                    || is_time_brace_open_node(p, src)
                    || (p.kind() == "redirected_statement" && is_split_bang_brace_redir(p, src));
                return is_open && time_brace_is_bang_negated(p, src);
            }
            close_cnt -= o;
        } else if is_close_brace_node(p, src).is_some() {
            close_cnt += 1;
        }
        cur = p;
    }
    false
}

pub(super) fn is_time_brace_open_node(mut n: tree_sitter::Node<'_>, src: &str) -> bool {
    if n.kind() == "redirected_statement" {
        let Some(b) = (0..n.named_child_count())
            .filter_map(|i| n.named_child(i as u32))
            .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment")
        else {
            return false;
        };
        n = b;
    }
    while n.kind() == "negated_command" || is_bang_command_wrapper(n, src) {
        let Some(c) = (0..n.named_child_count())
            .filter_map(|i| n.named_child(i as u32))
            .find(|c| !matches!(c.kind(), "command_name" | "comment"))
        else {
            return false;
        };
        n = c;
    }
    if n.kind() != "command" {
        return false;
    }
    let Some(nm) = n.child_by_field_name("name") else { return false };
    if src[nm.start_byte()..nm.end_byte()].trim() != "time" {
        return false;
    }
    let (mut saw_brace, mut saw_p, mut saw_dd) = (false, false, false);
    for i in 0..n.named_child_count() {
        let Some(c) = n.named_child(i as u32) else { continue };
        if c.kind() == "command_name" || c.kind() == "comment" || c.kind().ends_with("redirect") {
            continue;
        }
        let t = src[c.start_byte()..c.end_byte()].trim();
        if count_open_brace_word(t).is_some() {
            saw_brace = true;
            break;
        }
        if t == "!" {
            (saw_p, saw_dd) = (true, true);
            continue;
        }
        if !saw_dd {
            if !saw_p && t == "-p" { saw_p = true; continue; }
            if t == "--" { saw_dd = true; continue; }
            if t == "time" { (saw_p, saw_dd) = (false, false); continue; }
        } else if t == "time" {
            (saw_p, saw_dd) = (false, false);
            continue;
        }
        return false;
    }
    saw_brace
}

pub(super) fn is_close_brace_node<'a>(n: tree_sitter::Node<'a>, src: &str) -> Option<tree_sitter::Node<'a>> {
    let mut cur = n;
    loop {
        if cur.kind() == "command" && src[cur.start_byte()..cur.end_byte()].trim() == "}" {
            return Some(cur);
        }
        if matches!(cur.kind(), "list" | "pipeline" | "redirected_statement")
            && let Some(c0) = (0..cur.named_child_count())
                .filter_map(|i| cur.named_child(i as u32))
                .find(|c| c.kind() != "comment")
        {
            cur = c0;
            continue;
        }
        return None;
    }
}

pub(super) fn find_brace_close_pair<'a>(
    open_node: tree_sitter::Node<'a>,
    src: &str,
) -> Option<(tree_sitter::Node<'a>, tree_sitter::Node<'a>)> {
    let mut depth = open_braces_in_node(open_node, src).max(1);
    let mut sib = next_non_comment_sibling(open_node);
    while let Some(s) = sib {
        let o = open_braces_in_node(s, src);
        if o > 0 {
            depth += o;
        } else if let Some(c0) = is_close_brace_node(s, src) {
            depth -= 1;
            if depth == 0 {
                return Some((c0, s));
            }
        }
        sib = next_non_comment_sibling(s);
    }
    None
}

pub(super) fn find_time_brace_close<'a>(open_node: tree_sitter::Node<'a>, src: &str) -> Option<tree_sitter::Node<'a>> {
    find_brace_close_pair(open_node, src).map(|(c0, _)| c0)
}

pub(super) fn is_open_brace_command(node: tree_sitter::Node<'_>, src: &str, child: tree_sitter::Node<'_>) -> bool {
    node.kind() == "command"
        && node.child_by_field_name("name").is_some_and(|nm| {
            nm.id() != child.id() && src[nm.start_byte()..nm.end_byte()].trim() == "{"
        })
}

pub(super) fn peel_time_command_wrapper(
    node: tree_sitter::Node<'_>,
    src: &str,
    child: tree_sitter::Node<'_>,
) -> Option<bool> {
    if node.kind() != "command" {
        return None;
    }
    let nm = node.child_by_field_name("name")?;
    if nm.id() == child.id() || src[nm.start_byte()..nm.end_byte()].trim() != "time" {
        return None;
    }
    let (mut saw_p, mut saw_dd, mut neg) = (false, false, false);
    for i in 0..node.named_child_count() {
        let Some(c) = node.named_child(i as u32) else { continue };
        if c.id() == child.id() {
            return Some(neg);
        }
        if c.kind() == "command_name" || c.kind() == "comment" {
            continue;
        }
        let t = src[c.start_byte()..c.end_byte()].trim();
        if t == "!" {
            (saw_p, saw_dd) = (true, true);
            if !src[c.end_byte()..child.start_byte()].contains('\n') {
                neg = !neg;
            }
            continue;
        }
        if !saw_dd {
            if !saw_p && t == "-p" { saw_p = true; continue; }
            if t == "--" { saw_dd = true; continue; }
            if t == "time" { (saw_p, saw_dd) = (false, false); continue; }
        } else if t == "time" {
            (saw_p, saw_dd) = (false, false);
            continue;
        }
        return None;
    }
    None
}

pub(super) fn is_split_bang_brace_redir(node: tree_sitter::Node<'_>, src: &str) -> bool {
    (0..node.named_child_count())
        .filter_map(|i| node.named_child(i as u32))
        .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment")
        .is_some_and(|b| is_bang_brace_body(b, src))
}

pub(super) fn split_bang_brace_next<'a>(cur: tree_sitter::Node<'a>, src: &str) -> Option<tree_sitter::Node<'a>> {
    let (c0, sib) = find_brace_close_pair(cur, src)?;
    (!close_brace_starts_pipeline(c0, sib)).then_some(c0)
}
