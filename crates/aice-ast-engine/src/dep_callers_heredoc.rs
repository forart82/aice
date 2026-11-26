use aice_lang_registry::LanguageId;

use crate::dep_callers_bash_ansi::unescape_bash_bt_layers;

#[derive(Clone)]
pub(crate) struct HeredocEntry {
    pub(crate) delim: String,
    pub(crate) strip_ws: bool,
    pub(crate) quoted: bool,
    pub(crate) bt_depth: usize,
    pub(crate) bt_mask: u32,
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum HeredocLine {
    NotActive,
    DelimiterOrQuoted,
    UnquotedBody,
}

#[derive(Default, Clone)]
pub(crate) struct HeredocTracker {
    pub(crate) in_ruby_pod: bool,
    pub(crate) active: Vec<HeredocEntry>,
    pub(crate) pending: Vec<HeredocEntry>,
    cont_line: bool,
    cont_delim_prefix_ok: bool,
    cont_bt_prefix: Option<String>,
    cont_carry_bs: usize,
}

fn trailing_bs(raw: &str) -> usize {
    raw.as_bytes().iter().rev().take_while(|&&c| c == b'\\').count()
}

fn prepend_bs<'a>(carry: usize, raw: &'a str, buf: &'a mut String) -> &'a str {
    if carry == 0 {
        raw
    } else {
        *buf = format!("{}{raw}", "\\".repeat(carry));
        buf.as_str()
    }
}

impl HeredocTracker {
    pub(crate) fn clear_cont_carry(&mut self) {
        self.cont_carry_bs = 0;
    }

    fn update_cont(&mut self, raw: &str, strip_ws: bool, bt_depth: usize, quoted: bool, outer_bt: Option<usize>) {
        let carry = if self.cont_line { std::mem::take(&mut self.cont_carry_bs) } else { self.cont_carry_bs = 0; 0 };
        let mut buf = String::new();
        let eff = prepend_bs(carry, raw, &mut buf);
        let bs = trailing_bs(eff);
        let own_cont = crate::dep_callers_bash_cont::bash_eol_continues(bs, bt_depth, quoted);
        let outer_cont = outer_bt.is_some_and(|obt| crate::dep_callers_bash_cont::bash_eol_continues(bs, obt, false));
        let cont = own_cont || outer_cont;
        let prefix_ok = !self.cont_line || self.cont_delim_prefix_ok;
        let surv = if let Some(obt) = outer_bt.filter(|_| outer_cont) {
            crate::dep_callers_bash_cont::bash_eol_surviving_bs(bs, obt, false)
        } else {
            crate::dep_callers_bash_cont::bash_eol_surviving_bs(bs, bt_depth, quoted)
        };
        let prefix_ok_now = if strip_ws { eff[..eff.len() - bs].bytes().all(|b| b == b'\t') } else { eff.len() == bs };
        let prev_bt_p = self.cont_bt_prefix.take();
        if cont && (!self.cont_line || self.cont_delim_prefix_ok || prev_bt_p.is_some()) {
            let bt_mask = self.active.first().map_or(0, |h| h.bt_mask);
            let raw_part = if prev_bt_p.is_some() || !strip_ws { &eff[..eff.len() - bs] } else { eff[..eff.len() - bs].trim_start_matches('\t') };
            let part = unescape_bash_bt_layers(raw_part, bt_depth, bt_mask);
            let joined = match prev_bt_p {
                Some(p) => format!("{p}{part}"),
                None => part.into_owned(),
            };
            if !joined.is_empty() && self.active.first().is_some_and(|h| h.delim.starts_with(&joined)) {
                self.cont_bt_prefix = Some(joined);
            }
        }
        self.cont_line = cont;
        self.cont_delim_prefix_ok = cont && prefix_ok && prefix_ok_now;
        self.cont_carry_bs = if cont { surv } else { 0 };
    }

    pub(crate) fn is_cont_bt0_unquoted(&self) -> bool {
        self.cont_line && self.active.first().is_some_and(|h| h.bt_depth == 0 && !h.quoted)
    }

    pub(crate) fn in_cont_delim(&self) -> bool {
        self.cont_line && (self.cont_delim_prefix_ok || self.cont_bt_prefix.is_some())
    }

    fn step_bash_line_inner(&mut self, raw: &str, outer_bt: Option<usize>) -> HeredocLine {
        let Some(head) = self.active.first() else {
            return HeredocLine::NotActive;
        };
        let (strip_ws, quoted, bt_depth, bt_mask) = (head.strip_ws, head.quoted, head.bt_depth, head.bt_mask);
        if !self.cont_line || self.cont_delim_prefix_ok || self.cont_bt_prefix.is_some() {
            let mut buf = String::new();
            let eff = prepend_bs(if self.cont_line { self.cont_carry_bs } else { 0 }, raw, &mut buf);
            let matched = if let Some(p) = self.cont_bt_prefix.as_deref() {
                let bs = trailing_bs(eff);
                let own_cont = crate::dep_callers_bash_cont::bash_eol_continues(bs, bt_depth, quoted);
                let outer_cont = outer_bt.is_some_and(|obt| crate::dep_callers_bash_cont::bash_eol_continues(bs, obt, false));
                let tail = unescape_bash_bt_layers(eff, bt_depth, bt_mask);
                !(own_cont || outer_cont)
                    && tail.len() + p.len() == head.delim.len()
                    && head.delim.starts_with(p)
                    && &head.delim[p.len()..] == tail.as_ref()
            } else {
                let raw_cand = if strip_ws { eff.trim_start_matches('\t') } else { eff };
                let cand = unescape_bash_bt_layers(raw_cand, bt_depth, bt_mask);
                cand.as_ref() == head.delim
            };
            if matched {
                self.active.remove(0);
                (self.cont_line, self.cont_delim_prefix_ok, self.cont_bt_prefix, self.cont_carry_bs) = (false, false, None, 0);
                return HeredocLine::DelimiterOrQuoted;
            }
        }
        self.update_cont(raw, strip_ws, bt_depth, quoted, outer_bt);
        if quoted { HeredocLine::DelimiterOrQuoted } else { HeredocLine::UnquotedBody }
    }

    pub(crate) fn consume_line_if_active(&mut self, lang: LanguageId, raw: &str) -> bool {
        if self.in_ruby_pod {
            if is_ruby_pod_marker(raw, "=end") {
                self.in_ruby_pod = false;
            }
            return true;
        }
        if let Some(head) = self.active.first() {
            let cand = if head.strip_ws {
                if lang == LanguageId::Bash {
                    raw.trim_start_matches('\t')
                } else {
                    raw.trim_start_matches([' ', '\t'])
                }
            } else {
                raw
            };
            if cand == head.delim {
                self.active.remove(0);
            }
            return true;
        }
        if lang == LanguageId::Ruby && is_ruby_pod_marker(raw, "=begin") {
            self.in_ruby_pod = true;
            return true;
        }
        false
    }

    pub(crate) fn flush_pending(&mut self) {
        if !self.pending.is_empty() {
            self.active.append(&mut self.pending);
        }
    }

    pub(crate) fn prune_bt_above(&mut self, bt_depth: usize) {
        self.pending.retain(|e| e.bt_depth <= bt_depth);
        if self.active.iter().any(|e| e.bt_depth > bt_depth) {
            let head_pruned = self.active.first().is_some_and(|e| e.bt_depth > bt_depth);
            self.active.retain(|e| e.bt_depth <= bt_depth);
            if head_pruned || self.active.is_empty() {
                (self.cont_line, self.cont_delim_prefix_ok, self.cont_bt_prefix, self.cont_carry_bs) = (false, false, None, 0);
            }
        }
    }

    pub(crate) fn step_bash_line_bt(&mut self, raw: &str) -> (HeredocLine, Option<usize>) {
        self.step_bash_line_bt_outer(raw, None)
    }

    pub(crate) fn step_bash_line_bt_outer(&mut self, raw: &str, outer_bt: Option<usize>) -> (HeredocLine, Option<usize>) {
        let (hl, cut) = self.step_bash_line_bt_core(raw, outer_bt);
        (hl, cut.map(|(j, _)| j))
    }

    fn step_bash_line_bt_core(&mut self, raw: &str, outer_bt: Option<usize>) -> (HeredocLine, Option<(usize, bool)>) {
        if let Some(head) = self.active.first()
            && head.bt_depth > 0
        {
            let carry = if self.cont_line { self.cont_carry_bs } else { 0 };
            let mut buf = String::new();
            let eff = prepend_bs(carry, raw, &mut buf);
            if let Some(j_eff) = crate::dep_callers_bash_cont::bash_find_bt_after_hash(
                head.bt_depth, eff, eff.as_bytes(), 0,
            ) {
                let bs = eff.as_bytes()[j_eff..].iter().take_while(|&&c| c == b'\\').count();
                let layer = (bs + 1).trailing_zeros() as usize + 1;
                let prefix = &eff[..j_eff];
                let matched = j_eff >= carry && if let Some(p) = self.cont_bt_prefix.as_deref() {
                    let tail = unescape_bash_bt_layers(prefix, head.bt_depth, head.bt_mask);
                    tail.len() + p.len() == head.delim.len()
                        && head.delim.starts_with(p)
                        && &head.delim[p.len()..] == tail.as_ref()
                } else {
                    let raw_cand = if head.strip_ws { prefix.trim_start_matches('\t') } else { prefix };
                    let cand = unescape_bash_bt_layers(raw_cand, head.bt_depth, head.bt_mask);
                    (!self.cont_line || self.cont_delim_prefix_ok) && cand.as_ref() == head.delim
                };
                let hl = if head.quoted || matched {
                    HeredocLine::DelimiterOrQuoted
                } else {
                    HeredocLine::UnquotedBody
                };
                self.active.retain(|e| e.bt_depth < layer);
                (self.cont_line, self.cont_delim_prefix_ok, self.cont_bt_prefix, self.cont_carry_bs) = (false, false, None, 0);
                return (hl, Some((j_eff.saturating_sub(carry), matched)));
            }
        }
        (self.step_bash_line_inner(raw, outer_bt), None)
    }

    pub(crate) fn cont_chain_closes(&self, src: &str, mut pos: usize) -> bool {
        let mut probe = self.clone();
        let active_before = probe.active.len();
        while pos < src.len() && probe.in_cont_delim() {
            let nl = src[pos..].find('\n');
            let end = nl.map_or(src.len(), |p| pos + p);
            match probe.step_bash_line_bt_core(&src[pos..end], None) {
                (_, Some((_, matched))) => return matched,
                (_, None) if probe.active.len() < active_before => return true,
                _ => {}
            }
            let Some(p) = nl else { break; };
            pos += p + 1;
        }
        false
    }
}

fn is_ruby_pod_marker(raw: &str, kw: &str) -> bool {
    raw == kw
        || (raw.starts_with(kw) && raw[kw.len()..].starts_with(char::is_whitespace))
}

pub(crate) use crate::dep_callers_bash_delim::try_parse_heredoc;

pub(crate) fn try_parse_bash_heredoc_in_bt(
    line: &str,
    start: usize,
    bt_depth: usize,
    bt_mask: u32,
) -> Option<(HeredocEntry, usize)> {
    if bt_depth == 0 {
        return try_parse_heredoc(LanguageId::Bash, line, line.as_bytes(), start);
    }
    let mut cur = line[start..].to_string();
    let mut map: Vec<usize> = (0..=cur.len()).collect();
    for layer in 0..bt_depth.min(8) {
        let unesc_dq = ((bt_mask >> layer) & 1) == 1;
        let (b, mut next_s, mut next_map, mut p) = (cur.as_bytes(), String::with_capacity(cur.len()), vec![0usize], 0usize);
        while p < b.len() {
            if b[p] == b'\\' && p + 1 < b.len() {
                let nch = cur[p + 1..].chars().next().unwrap();
                let p_end = p + 1 + nch.len_utf8();
                if !(matches!(nch, '`' | '\\' | '$') || (unesc_dq && nch == '"')) {
                    next_s.push('\\');
                    next_map.push(map[p + 1]);
                }
                next_s.push(nch);
                for _ in 0..nch.len_utf8() { next_map.push(map[p_end]); }
                p = p_end;
            } else if b[p] == b'`' {
                break;
            } else {
                let ch = cur[p..].chars().next().unwrap();
                let p_end = p + ch.len_utf8();
                next_s.push(ch);
                for _ in 0..ch.len_utf8() { next_map.push(map[p_end]); }
                p = p_end;
            }
        }
        cur = next_s;
        map = next_map;
    }
    let (mut entry, end_unesc) = try_parse_heredoc(LanguageId::Bash, &cur, cur.as_bytes(), 0)?;
    entry.bt_depth = bt_depth;
    entry.bt_mask = bt_mask;
    Some((entry, start + map[end_unesc]))
}
