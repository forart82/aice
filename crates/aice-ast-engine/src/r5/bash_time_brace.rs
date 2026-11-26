use crate::r5::bash_deps_hd_case::next_non_comment_sibling;
use crate::r5::bash_time_bounds::{
    is_close_brace_node, is_time_brace_open_node, prev_non_comment_sibling,
};

pub(super) fn count_open_brace_word(t: &str) -> Option<usize> {
    let mut cnt = 0usize;
    for part in t.split_ascii_whitespace() {
        if part != "{" {
            return None;
        }
        cnt += 1;
    }
    (cnt > 0).then_some(cnt)
}

pub(super) fn body_is_bang_negated(mut n: tree_sitter::Node<'_>, src: &str) -> bool {
    let mut neg = false;
    loop {
        if n.kind() == "negated_command" {
            let Some(c) = (0..n.named_child_count())
                .filter_map(|i| n.named_child(i as u32))
                .find(|c| c.kind() != "comment")
            else {
                break;
            };
            if !src[n.start_byte()..c.start_byte()].contains('\n') {
                neg = !neg;
            }
            n = c;
        } else if n.kind() == "command" {
            let kids: Vec<_> = (0..n.named_child_count())
                .filter_map(|i| n.named_child(i as u32))
                .filter(|c| c.kind() != "comment" && !c.kind().ends_with("redirect"))
                .collect();
            let (mut in_time, mut saw_p, mut saw_dd, mut next_node) = (false, false, false, None);
            for (idx, &c) in kids.iter().enumerate() {
                let t = src[c.start_byte()..c.end_byte()].trim();
                if (c.kind() == "command_name" || c.kind() == "word") && t == "!" {
                    in_time = false;
                    if let Some(&nxt) = kids.get(idx + 1)
                        && !src[c.end_byte()..nxt.start_byte()].contains('\n')
                    {
                        neg = !neg;
                    } else {
                        break;
                    }
                } else if c.kind() == "command_name" && t == "time" {
                    in_time = true;
                } else if c.kind() == "word" && in_time && !saw_dd && t == "-p" && !saw_p {
                    saw_p = true;
                } else if c.kind() == "word" && in_time && !saw_dd && t == "--" {
                    saw_dd = true;
                } else if c.kind() == "word" && t == "time" {
                    (in_time, saw_p, saw_dd) = (true, false, false);
                } else {
                    if c.kind() != "command_name" {
                        next_node = Some(c);
                    }
                    break;
                }
            }
            let Some(c) = next_node else { break };
            n = c;
        } else {
            break;
        }
    }
    neg
}

pub(super) fn time_brace_is_bang_negated(mut n: tree_sitter::Node<'_>, src: &str) -> bool {
    if n.kind() == "redirected_statement" {
        let Some(b) = (0..n.named_child_count())
            .filter_map(|i| n.named_child(i as u32))
            .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment")
        else {
            return false;
        };
        n = b;
    }
    body_is_bang_negated(n, src)
}

pub(super) fn open_braces_in_node(mut n: tree_sitter::Node<'_>, src: &str) -> usize {
    if n.kind() == "redirected_statement" {
        let Some(b) = (0..n.named_child_count())
            .filter_map(|i| n.named_child(i as u32))
            .find(|c| !c.kind().ends_with("redirect") && c.kind() != "comment")
        else {
            return 0;
        };
        n = b;
    }
    while n.kind() == "negated_command" {
        let Some(c) = (0..n.named_child_count())
            .filter_map(|i| n.named_child(i as u32))
            .find(|c| c.kind() != "comment")
        else {
            return 0;
        };
        n = c;
    }
    if n.kind() != "command" {
        return 0;
    }
    let Some(nm) = n.child_by_field_name("name") else { return 0 };
    let nm_txt = src[nm.start_byte()..nm.end_byte()].trim();
    let mut cnt = count_open_brace_word(nm_txt).unwrap_or(0);
    let mut in_prefix = matches!(nm_txt, "!" | "time") || cnt > 0;
    if !in_prefix {
        return 0;
    }
    let (mut saw_p, mut saw_dd) = (false, false);
    for i in 0..n.named_child_count() {
        let Some(c) = n.named_child(i as u32) else { continue };
        if matches!(c.kind(), "command_name" | "comment") || c.kind().ends_with("redirect") {
            continue;
        }
        let t = src[c.start_byte()..c.end_byte()].trim();
        if c.kind() == "word" && let Some(oc) = count_open_brace_word(t) {
            cnt += oc;
            in_prefix = true;
            (saw_p, saw_dd) = (false, false);
        } else if cnt == 0 && in_prefix && c.kind() == "word" {
            if t == "!" {
                (saw_p, saw_dd) = (true, true);
                continue;
            }
            if t == "time" {
                (saw_p, saw_dd) = (false, false);
                continue;
            }
            if !saw_dd && !saw_p && t == "-p" {
                saw_p = true;
                continue;
            }
            if !saw_dd && t == "--" {
                saw_dd = true;
                continue;
            }
            break;
        } else {
            break;
        }
    }
    cnt
}

pub(super) fn close_brace_starts_pipeline(
    close_cmd: tree_sitter::Node<'_>,
    root_sib: tree_sitter::Node<'_>,
) -> bool {
    let mut cur = close_cmd;
    while cur.id() != root_sib.id() {
        let Some(p) = cur.parent() else { break };
        if p.kind() == "pipeline" && next_non_comment_sibling(cur).is_some() {
            return true;
        }
        cur = p;
    }
    false
}

pub(super) fn initial_program_brace_depth(cur: tree_sitter::Node<'_>, src: &str) -> usize {
    let mut depth = open_braces_in_node(cur, src);
    let mut close_cnt = 0usize;
    let mut sib = prev_non_comment_sibling(cur);
    while let Some(s) = sib {
        let o = open_braces_in_node(s, src);
        if o > 0 {
            if o > close_cnt {
                depth += o - close_cnt;
                close_cnt = 0;
            } else {
                close_cnt -= o;
            }
        } else if is_close_brace_node(s, src).is_some() {
            close_cnt += 1;
        }
        sib = prev_non_comment_sibling(s);
    }
    depth
}

pub(super) fn find_enclosing_time_brace_open<'a>(
    cur: tree_sitter::Node<'a>,
    src: &str,
) -> Option<tree_sitter::Node<'a>> {
    let mut close_cnt = 0usize;
    let mut sib = prev_non_comment_sibling(cur);
    while let Some(s) = sib {
        let o = open_braces_in_node(s, src);
        if o > 0 {
            if close_cnt == 0 {
                return (o >= 1 && is_time_brace_open_node(s, src)).then_some(s);
            }
            if o > close_cnt {
                return None;
            }
            close_cnt -= o;
        } else if is_close_brace_node(s, src).is_some() {
            close_cnt += 1;
        }
        sib = prev_non_comment_sibling(s);
    }
    None
}

pub(super) fn is_fd0_input_redir_without_cmd<'a>(
    node: tree_sitter::Node<'a>,
    src: &str,
) -> Option<(tree_sitter::Node<'a>, bool)> {
    let mut cur = node;
    while let Some(p) = cur.parent() && matches!(p.kind(), "string" | "concatenation") {
        cur = p;
    }
    let redir = cur.parent().filter(|p| p.kind() == "file_redirect")?;
    let mut first_non_fd = None;
    for i in 0..redir.named_child_count() {
        let Some(c) = redir.named_child(i as u32) else { continue };
        if c.kind() == "file_descriptor" {
            if src[c.start_byte()..c.end_byte()].trim() != "0" { return None; }
        } else {
            first_non_fd = Some(c);
            break;
        }
    }
    if first_non_fd?.id() != cur.id() { return None; }
    let op_start = (0..redir.named_child_count())
        .filter_map(|i| redir.named_child(i as u32))
        .find(|c| c.kind() == "file_descriptor")
        .map_or(redir.start_byte(), |fd| fd.end_byte());
    let op_txt = src[op_start..cur.start_byte()].trim();
    let is_split_rw = op_txt == ">"
        && redir.start_byte() > 0
        && src[..redir.start_byte()].ends_with('<')
        && !src[..redir.start_byte()].ends_with("<<");
    if !matches!(op_txt, "<" | "<>") && !is_split_rw { return None; }
    let rp = redir.parent()?;
    if rp.kind() == "ERROR" && is_split_rw {
        let valid_err = src[rp.start_byte()..redir.start_byte()].trim() == "<"
            && (0..rp.named_child_count()).filter_map(|i| rp.named_child(i as u32)).all(|c| {
                c.id() == redir.id() || c.kind() == "comment" || c.kind().ends_with("redirect")
            });
        return valid_err.then_some((rp, false));
    }
    let rs = Some(rp).filter(|p| p.kind() == "redirected_statement")?;
    let (mut body, mut extra_redirs) = (None, Vec::new());
    for i in 0..rs.named_child_count() {
        let Some(c) = rs.named_child(i as u32) else { continue };
        if c.kind().ends_with("redirect") { extra_redirs.push(c); }
        else if c.kind() != "comment" && body.is_none() { body = Some(c); }
    }
    let Some(b) = body else {
        return is_split_rw.then_some((rs, false));
    };
    let cmd = crate::r5::bash_cmd_helpers::unwrap_bang_command(b, src)?;
    let (mut words, mut assigns, mut redirs) = (Vec::new(), Vec::new(), Vec::new());
    for i in 0..cmd.named_child_count() {
        if let Some(c) = cmd.named_child(i as u32) {
            match c.kind() {
                "variable_assignment" => assigns.push(c),
                "command_name" if !src[c.start_byte()..c.end_byte()].is_empty() => words.push(c),
                "file_redirect" | "herestring_redirect" | "heredoc_redirect" => {
                    crate::r5::bash_cmd_helpers::push_redir_children(c, src, &mut words, &mut redirs);
                }
                "comment" => {}
                _ => words.push(c),
            }
        }
    }
    for &r in &extra_redirs {
        crate::r5::bash_cmd_helpers::push_redir_children(r, src, &mut words, &mut redirs);
    }
    words.sort_by_key(|n| n.start_byte());
    let fr = crate::r5::bash_deps::first_redirect_start(cmd, &extra_redirs, src);
    crate::r5::bash_cmd_helpers::peel_time_wrapper_words(&mut words, &mut assigns, fr, src);
    if is_split_rw
        && words.len() == 1
        && words[0].end_byte() + 1 == redir.start_byte()
        && src[words[0].start_byte()..words[0].end_byte()].trim() == "0"
    {
        words.clear();
    }
    words.is_empty().then(|| (rs, body_is_bang_negated(b, src)))
}
