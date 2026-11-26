use aice_lang_registry::{DepEdge, DepKind};

use crate::r5::bash_abort_bounds::is_bang_command_wrapper;
use crate::r5::bash_hd_meta::HdSlot;
use crate::r5::bash_heredoc::unescape_bash_word;
use crate::r5::cst_helpers::node_text;

pub(super) fn is_bash_assign_lhs(lhs: &str) -> bool {
    let b = lhs.as_bytes();
    let mut end = b.len();
    if end > 0 && b[end - 1] == b'+' {
        end -= 1;
    }
    if end > 1
        && b[end - 1] == b']'
        && let Some(lb) = b[..end - 1].iter().position(|&c| c == b'[')
        && lb + 1 < end - 1
    {
        end = lb;
    }
    let name = &b[..end];
    !name.is_empty()
        && (name[0].is_ascii_alphabetic() || name[0] == b'_')
        && name[1..].iter().all(|&c| c.is_ascii_alphanumeric() || c == b'_')
}

pub(super) fn is_bash_env_assign_node(n: tree_sitter::Node<'_>, src: &str) -> bool {
    let raw = node_text(n, src).trim();
    let Some((lhs, _)) = raw.split_once('=') else { return false };
    if !is_bash_assign_lhs(lhs) {
        return false;
    }
    match n.kind() {
        "word" => true,
        "concatenation" => n.named_child(0).is_some_and(|c0| {
            c0.start_byte() == n.start_byte() && c0.kind() == "word"
        }),
        _ => false,
    }
}

pub(super) fn peel_time_wrapper_words<'a>(
    words: &mut Vec<tree_sitter::Node<'a>>,
    assigns: &mut Vec<tree_sitter::Node<'a>>,
    first_redir_start: usize,
    src: &str,
) {
    let mut wi = 0usize;
    let mut peeled_wrap = false;
    while wi < words.len() && words[wi].start_byte() < first_redir_start {
        let wt = node_text(words[wi], src).trim();
        if wt == "!" {
            peeled_wrap = true;
            wi += 1;
            continue;
        }
        if wt == "time" {
            peeled_wrap = true;
            wi += 1;
            let mut saw_p = false;
            while wi < words.len() {
                let w = words[wi];
                let raw_t = node_text(w, src).trim();
                if w.start_byte() < first_redir_start {
                    if !saw_p && raw_t == "-p" {
                        saw_p = true;
                        wi += 1;
                        continue;
                    }
                    if raw_t == "--" {
                        wi += 1;
                        break;
                    }
                }
                break;
            }
            continue;
        }
        break;
    }
    if let Some(&w) = words.get(wi) {
        let t = node_text(w, src).trim();
        if !t.is_empty() && t.bytes().all(|b| b.is_ascii_digit()) && w.end_byte() == first_redir_start {
            wi += 1;
        }
    }
    let after_redir = words.get(wi).is_some_and(|w| w.start_byte() > first_redir_start);
    if wi > 0 {
        words.drain(..wi);
    }
    if peeled_wrap || wi > 0 || after_redir {
        let mut split_at = 0usize;
        while split_at < words.len() && is_bash_env_assign_node(words[split_at], src) {
            split_at += 1;
        }
        if split_at > 0 {
            assigns.extend(words.drain(..split_at));
            assigns.sort_by_key(|n| n.start_byte());
        }
    }
}

pub(super) fn unwrap_bang_command<'a>(
    mut n: tree_sitter::Node<'a>,
    src: &str,
) -> Option<tree_sitter::Node<'a>> {
    loop {
        if n.kind() == "negated_command" {
            n = (0..n.named_child_count())
                .filter_map(|i| n.named_child(i as u32))
                .find(|c| c.kind() != "comment")?;
        } else if is_bang_command_wrapper(n, src) {
            let Some(next) = (0..n.named_child_count())
                .filter_map(|i| n.named_child(i as u32))
                .find(|c| {
                    !matches!(c.kind(), "command_name" | "comment")
                        && !(c.kind() == "word" && node_text(*c, src).trim() == "!")
                })
            else {
                break;
            };
            if matches!(next.kind(), "command" | "negated_command") {
                n = next;
            } else {
                return Some(n);
            }
        } else {
            break;
        }
    }
    (n.kind() == "command").then_some(n)
}

pub(super) fn find_hd_slot_pos(
    word_txt: &str,
    hd_slots: &[(String, Vec<HdSlot>)],
) -> Option<(usize, usize)> {
    let t = word_txt.trim();
    for (si, (pfx, slots)) in hd_slots.iter().enumerate() {
        if let Some(rest) = t.strip_prefix(pfx.as_str())
            && let Some(num_s) = rest.strip_suffix('_')
            && let Ok(idx) = num_s.parse::<usize>()
            && idx < slots.len()
        {
            return Some((si, idx));
        }
    }
    None
}

pub(super) fn is_hd_slot_aborted(word_txt: &str, hd_slots: &[(String, Vec<HdSlot>)]) -> bool {
    find_hd_slot_pos(word_txt, hd_slots).is_some_and(|(si, idx)| hd_slots[si].1[idx].aborted)
}

pub(super) fn has_subscript_lhs(n: tree_sitter::Node<'_>, src: &str) -> bool {
    if n.kind() == "variable_assignment"
        && let Some(lhs) = n.child_by_field_name("name")
    {
        return lhs.kind() == "subscript" || node_text(lhs, src).contains('[');
    }
    let raw = node_text(n, src).trim();
    raw.split_once('=').is_some_and(|(lhs, _)| lhs.contains('['))
}

pub(super) fn is_bare_unquoted_cmdsub(n: tree_sitter::Node<'_>, src: &str) -> bool {
    (n.kind() == "command_substitution" && !node_text(n, src).starts_with('`'))
        || (n.kind() == "command_name"
            && n.named_child_count() == 1
            && n.named_child(0).is_some_and(|c| c.kind() == "command_substitution" && !node_text(c, src).starts_with('`')))
}

pub(super) fn bare_cmdsub_node(mut n: tree_sitter::Node<'_>) -> Option<tree_sitter::Node<'_>> {
    if n.kind() == "command_name" && n.named_child_count() == 1 {
        n = n.named_child(0)?;
    }
    if n.kind() == "command_substitution" {
        return Some(n);
    }
    (n.kind() == "string" && n.named_child_count() == 1)
        .then(|| n.named_child(0))
        .flatten()
        .filter(|c| c.kind() == "command_substitution")
}

pub(super) fn push_redir_children<'a>(
    r: tree_sitter::Node<'a>,
    src: &str,
    words: &mut Vec<tree_sitter::Node<'a>>,
    redirs: &mut Vec<tree_sitter::Node<'a>>,
) {
    if r.kind() == "file_redirect" {
        let mut first_child = None;
        for i in 0..r.named_child_count() {
            if let Some(c) = r.named_child(i as u32) && c.kind() != "file_descriptor" {
                first_child = Some(c);
                break;
            }
        }
        let close_fd = first_child.is_some_and(|c0| {
            let pfx = src[r.start_byte()..c0.start_byte()].trim_end();
            pfx.ends_with(">&-") || pfx.ends_with("<&-")
        });
        let mut first = !close_fd;
        for i in 0..r.named_child_count() {
            if let Some(c) = r.named_child(i as u32) && c.kind() != "file_descriptor" {
                if first { redirs.push(c); first = false; } else { words.push(c); }
            }
        }
    } else if r.kind() == "heredoc_redirect" {
        redirs.push(r);
        let right_start = r.child_by_field_name("right").map_or(usize::MAX, |n| n.start_byte());
        let mut body_start = usize::MAX;
        for i in 0..r.named_child_count() {
            if let Some(c) = r.named_child(i as u32) && matches!(c.kind(), "heredoc_body" | "heredoc_end") {
                body_start = body_start.min(c.start_byte());
            }
        }
        let limit = body_start.min(right_start);
        for i in 0..r.named_child_count() {
            if let Some(c) = r.named_child(i as u32)
                && c.start_byte() < limit
                && !matches!(c.kind(), "heredoc_start" | "heredoc_body" | "heredoc_end" | "comment" | "list" | "pipeline" | "command" | "redirected_statement")
                && !c.kind().ends_with("redirect")
            {
                words.push(c);
            }
        }
    } else {
        redirs.push(r);
    }
}

fn is_glued_source_arg(arg: tree_sitter::Node<'_>, src: &str) -> bool {
    let glued_sib = |n: tree_sitter::Node<'_>| {
        !matches!(
            n.kind(),
            "file_redirect" | "herestring_redirect" | "heredoc_redirect" | "comment"
                | "command_name" | "variable_assignment"
        )
    };
    let has_glued_bt = arg.kind() == "concatenation"
        && (0..arg.named_child_count()).any(|i| {
            arg.named_child(i as u32).is_some_and(|c| {
                c.kind() == "command_substitution" && node_text(c, src).starts_with('`')
            })
        });
    has_glued_bt
        || arg.next_named_sibling().is_some_and(|n| n.start_byte() == arg.end_byte() && glued_sib(n))
        || arg.prev_named_sibling().is_some_and(|n| n.end_byte() == arg.start_byte() && glued_sib(n))
}

pub(super) fn extract_bash_command_dep_words(
    _cmd: tree_sitter::Node<'_>,
    words: &[tree_sitter::Node<'_>],
    first_redir: usize,
    src: &str,
    deps: &mut Vec<DepEdge>,
) {
    if !words.is_empty() && words[0].start_byte() >= first_redir {
        let mut wi = 0usize;
        while wi < words.len() {
            let t = unescape_bash_word(node_text(words[wi], src).trim());
            if t == "command" {
                wi += 1;
                while wi < words.len() && node_text(words[wi], src).trim() == "-p" { wi += 1; }
                if wi < words.len() && node_text(words[wi], src).trim() == "--" { wi += 1; }
                continue;
            }
            if t == "builtin" {
                wi += 1;
                if wi < words.len() && node_text(words[wi], src).trim() == "--" { wi += 1; }
                continue;
            }
            if matches!(t.as_str(), "source" | ".")
                && let Some(&arg) = words.get(wi + 1)
                && !is_glued_source_arg(arg, src)
            {
                let target = unescape_bash_word(node_text(arg, src).trim());
                if !target.is_empty()
                    && !deps.iter().any(|d| d.kind == DepKind::Import && d.target == target && d.source == "script")
                {
                    deps.push(DepEdge { source: "script".to_string(), target, kind: DepKind::Import });
                }
            }
            break;
        }
    }
}
