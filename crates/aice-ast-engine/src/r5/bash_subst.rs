use crate::dep_callers_bash_param::ParamHdr;
pub(super) use crate::r5::bash_comment::{char_len, try_skip_bash_hash_comment};
pub(super) use crate::r5::bash_subst_scan::{
    ansi_close_escapes_brace_in_exp, is_ws_followed_by_dollar, scan_bt_in_exp, scan_cmdsub_in_exp,
    unescape_backtick_layer, unescape_bt_body,
};

#[derive(Clone, Copy, PartialEq, Eq)]
pub(super) enum ExpAbort {
    None,
    ClosedBadSub,
    BadSub,
    UnclosedSq,
}

impl ExpAbort {
    pub(super) fn is_parse_or_unclosed(self) -> bool {
        matches!(self, Self::BadSub | Self::UnclosedSq)
    }
}

pub(super) fn extract_expansion_substitutions_checked(
    exp_text: &str,
    outer_in_dq: bool,
    in_heredoc: bool,
) -> (Vec<String>, ExpAbort) {
    extract_expansion_substitutions_with_tail(exp_text, outer_in_dq, in_heredoc, "")
}

pub(super) fn extract_expansion_substitutions_with_tail(
    exp_text: &str,
    outer_in_dq: bool,
    in_heredoc: bool,
    outer_dq_tail: &str,
) -> (Vec<String>, ExpAbort) {
    let trimmed = exp_text.trim_start_matches(|c: char| c.is_ascii_whitespace());
    let Some(s) = trimmed.strip_prefix("${").and_then(|r| r.strip_suffix('}')) else {
        return (Vec::new(), ExpAbort::None);
    };
    if s.trim().is_empty() {
        return (Vec::new(), ExpAbort::ClosedBadSub);
    }
    let mut out = Vec::new();
    let b = s.as_bytes();
    let mut i = 0usize;
    let mut in_sq = false;
    let mut in_ansi_sq = 0u8;
    let mut prev_dollar = false;
    let mut in_param_dq = outer_in_dq;
    let mut in_inner_dq = false;
    let mut outer_hdr = ParamHdr::Init;
    let mut param_stack: Vec<(bool, bool, ParamHdr)> = Vec::new();

    while i < b.len() {
        if in_sq {
            if in_ansi_sq == 1 {
                if b[i] == b'\\' && i + 1 < b.len() {
                    i += 1 + char_len(s, i + 1);
                } else if b[i] == b'\'' {
                    in_sq = false;
                    in_ansi_sq = 0;
                    i += 1;
                } else {
                    i += char_len(s, i);
                }
                continue;
            }
            if b[i] == b'\'' {
                prev_dollar = false;
                in_sq = false;
                in_ansi_sq = 0;
                i += 1;
            } else if in_ansi_sq == 2 && b[i] == b'\\' {
                let mut bs = 0usize;
                while i + bs < b.len() && b[i + bs] == b'\\' {
                    bs += 1;
                }
                if i + bs < b.len() && b[i + bs] == b'\'' {
                    let after = i + bs;
                    if bs.is_multiple_of(2) {
                        if bs % 4 == 2 && !in_heredoc
                            && (after + 1 == b.len() || b[after + 1] == b'}')
                        {
                            let mut need = 1usize;
                            for &(_, p_inner, _) in param_stack.iter().rev() {
                                if p_inner { break; }
                                need += 1;
                            }
                            let at_end = after + 1 == b.len();
                            let s_tail = if at_end { "" } else { &s[after + 2..] };
                            if ansi_close_escapes_brace_in_exp(s_tail, outer_dq_tail, need, at_end) {
                                return (Vec::new(), ExpAbort::BadSub);
                            }
                        }
                        i = after;
                    } else if bs % 4 == 1 {
                        return (Vec::new(), ExpAbort::UnclosedSq);
                    } else {
                        prev_dollar = false;
                        i = after + 1;
                    }
                } else if i + bs < b.len() && matches!(b[i + bs], b'$' | b'`') {
                    prev_dollar = false;
                    i += bs + usize::from(matches!(bs % 4, 1 | 2));
                } else if i + bs < b.len() && bs % 2 == 1 {
                    if !in_heredoc || b[i + bs] != b'\n' {
                        prev_dollar = false;
                    }
                    i += bs + char_len(s, i + bs);
                } else {
                    prev_dollar = false;
                    i += bs;
                }
            } else if (in_param_dq || in_inner_dq)
                && b[i] == b'\\'
                && i + 1 < b.len()
                && b[i + 1] != b'\''
            {
                if !in_heredoc || b[i + 1] != b'\n' {
                    prev_dollar = false;
                }
                i += 1 + char_len(s, i + 1);
            } else if (in_param_dq || in_inner_dq) && b[i] == b'`' {
                prev_dollar = false;
                let (body, next_i, bad_sub) = scan_bt_in_exp(s, i, false, Some(in_ansi_sq == 2));
                if bad_sub {
                    return (Vec::new(), ExpAbort::UnclosedSq);
                }
                if !body.trim().is_empty() {
                    out.push(body);
                }
                i = next_i;
            } else if (in_param_dq || in_inner_dq) && prev_dollar && b[i] == b'(' {
                prev_dollar = false;
                let (body, next_i) = scan_cmdsub_in_exp(s, i + 1);
                if !body.trim().is_empty() {
                    out.push(body);
                }
                i = next_i;
            } else if (in_param_dq || in_inner_dq) && b[i] == b'$' {
                prev_dollar = !prev_dollar;
                i += 1;
            } else {
                prev_dollar = false;
                i += char_len(s, i);
            }
            continue;
        }
        if b[i] == b'\\' && i + 1 < b.len() {
            if b[i + 1] != b'\n' {
                prev_dollar = false;
                param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_backslash();
            }
            i += 1 + char_len(s, i + 1);
        } else if b[i] == b'\'' && !in_inner_dq {
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            in_sq = true;
            in_ansi_sq = if !prev_dollar || in_heredoc { 0 } else if !in_param_dq { 1 } else { 2 };
            prev_dollar = false;
            i += 1;
        } else if b[i] == b'"' {
            if !in_inner_dq {
                param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            }
            prev_dollar = false;
            in_inner_dq = !in_inner_dq;
            i += 1;
        } else if b[i] == b'`' {
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            prev_dollar = false;
            let unescape_dq = in_inner_dq && !in_param_dq;
            let (body, next_i, _) = scan_bt_in_exp(s, i, unescape_dq, None);
            if !body.trim().is_empty() {
                out.push(body);
            }
            i = next_i;
        } else if prev_dollar && b[i] == b'$' {
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            prev_dollar = false;
            i += 1;
        } else if prev_dollar && b[i] == b'(' {
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            prev_dollar = false;
            let (body, next_i) = scan_cmdsub_in_exp(s, i + 1);
            if !body.trim().is_empty() {
                out.push(body);
            }
            i = next_i;
        } else if prev_dollar && b[i] == b'{' {
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).on_quote_or_dollar_open();
            prev_dollar = false;
            param_stack.push((in_param_dq, in_inner_dq, ParamHdr::Init));
            in_param_dq = in_param_dq || in_inner_dq;
            in_inner_dq = false;
            i += 1;
        } else if b[i] == b'}' && !in_inner_dq {
            prev_dollar = false;
            if let Some((prev_param_dq, prev_inner_dq, hdr)) = param_stack.pop() {
                if !hdr.is_valid_end() {
                    return (out, ExpAbort::ClosedBadSub);
                }
                in_param_dq = prev_param_dq;
                in_inner_dq = prev_inner_dq;
            } else {
                outer_hdr.step_char('}');
            }
            i += 1;
        } else {
            let ch = s[i..].chars().next().unwrap();
            param_stack.last_mut().map_or(&mut outer_hdr, |t| &mut t.2).step_char(ch);
            prev_dollar = b[i] == b'$';
            i += ch.len_utf8();
        }
    }
    if in_sq || in_inner_dq {
        return (Vec::new(), ExpAbort::UnclosedSq);
    }
    if !outer_hdr.is_valid_end() {
        return (Vec::new(), ExpAbort::ClosedBadSub);
    }
    (out, ExpAbort::None)
}
