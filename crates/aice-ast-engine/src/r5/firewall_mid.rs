use std::path::Path; use aice_lang_registry::LanguageId; use crate::ts_pool::ParserPool;
use crate::r5::{checks::{ErrorSpan, collect_r5_error_spans}, firewall_delta::EofDeltaCtx, snippet_blk::rust_type_container_insert_verdict,
    snippet_cache::{PrefixCache, last_code_line_idx}, snippet_container::{PrefixContainer, classify_prefix_container_with_openers},
    snippet_cst::{collect_masked_ranges, cst_defect_profile, line_delim_detail}, snippet_ctx_scan::collect_opener_hdr,
    snippet_eof::{edit_slice_has_error_cached, has_incomplete_continuation_tail, is_pure_code_comment},
    snippet_hdr_ts::{is_ts_unrecoverable_missing_arrow_group_at, ts_kw_method_probe_ctx}, snippet_lex::is_code_lang,
    snippet_ops::trailing_binary_op, snippet_probe::min_snippet_errors, snippet_rs_attr::{rust_attr_tail_is_open, rust_unclosed_attr_tail},
    snippet_semi_op::{find_semi_broken_opener_line, is_py_lambda_colon, is_semi_terminated_broken_opener, is_ts_kw_shorthand_method, mask_rust_midfile_semi_brack_prefix, py_rb_ctrl_paren_ln, rust_brace_has_depth0_semi, strip_code_trailing_comment},
    snippet_synth::strip_comments_strings, snippet_ts_gen_ambig::is_ts_invalid_kw_lt_opener, snippet_type_body::{TB_ENUM, TB_STRUCT}};

impl<'a> EofDeltaCtx<'a> {
    fn pre_err_line(&self) -> Option<usize> { self.base_spans.iter().filter(|b| !b.message.starts_with("Missing syntax element:") && b.line <= self.prefix).map(|b| b.line).min() }
    fn semi_pre_err_line(&self, path: &Path, pool: &mut ParserPool) -> Option<usize> { find_semi_broken_opener_line(self.lang, &self.base_lines[..self.prefix], &self.base_lines[self.base_edit_end..], self.base_spans, path, pool) }
    fn eof_cmt_pre_err_line(&self, base_edit_is_cmt: bool) -> Option<usize> { (base_edit_is_cmt && self.base_edit_end == self.base_lines.len()).then(|| self.base_spans.iter().map(|b| b.line).min().map(|l| l.min(self.prefix.max(1)))).flatten() }
    fn is_midfile_split_span_with_bl(&self, sp: &ErrorSpan, pre_bl: usize) -> bool { !self.is_eof_append && is_code_lang(self.lang) && self.cand_edit_end >= self.cand_edit_start && pre_bl <= sp.end_line && sp.line <= self.cand_edit_end && sp.end_line >= self.cand_edit_start }
    pub(crate) fn is_pure_del_suffix_span(&self, sp: &ErrorSpan) -> bool { crate::r5::snippet_del::is_pure_del_suffix_span(self, sp) }
    pub(crate) fn allow_midfile_span_split(&self, raw_cand: &[&str], cand_spans: &[ErrorSpan], path: &Path, pool: &mut ParserPool) -> bool {
        if self.is_eof_append { return false; }
        if self.cand_edit_end < self.cand_edit_start { return crate::r5::snippet_del::pure_del_allow_span_split(self, cand_spans, path, pool); }
        if self.lang == LanguageId::Twig {
            let pfx_stk = crate::r5::snippet_del_lang::scan_twig_blocks(&self.base_lines[..self.prefix].join("\n")).0;
            let (vc_stk, vc_u) = crate::r5::snippet_del_lang::scan_twig_blocks(&format!("{{% verbatim %}}\n{}", raw_cand.join("\n")));
            if !(pfx_stk.last().is_some_and(|(_, k, _, _)| k == "verbatim") && vc_u == 0 && vc_stk.len() == 1 && vc_stk[0].1 == "verbatim") { return false; }
            let mut d = false;
            return cand_spans.iter().all(|sp| if sp.end_line <= self.prefix { self.is_covered_prefix_span(sp, &mut d) }
                else if sp.line > self.cand_edit_end { let (sl, se) = ((sp.line as isize - self.line_delta).max(1) as usize, (sp.end_line as isize - self.line_delta).max(1) as usize); self.base_spans.iter().any(|b| b.line == sl && b.end_line == se && b.message == sp.message) }
                else { true });
        }
        if !is_code_lang(self.lang) { return false; }
        let base_edit_is_cmt = self.base_edit_end < self.base_edit_start || is_pure_code_comment(self.lang, &self.base_lines[(self.base_edit_start - 1)..self.base_edit_end].join("\n"), pool);
        if self.base_edit_end == self.base_lines.len() && self.base_spans.iter().any(|b| !b.message.starts_with("Missing syntax element:") && b.end_line >= self.base_edit_start) && self.check_cand_closers(raw_cand, path, pool).is_some()
            && cand_spans.iter().all(|sp| sp.end_line <= self.prefix || (sp.line >= self.eff_cand_eof && matches!(sp.message.as_str(), "Missing syntax element: '}'" | "Missing syntax element: ')'" | "Missing syntax element: ']'"))) { return true; }
        if !base_edit_is_cmt {
            let (pfx, suf, base_sl) = (&self.base_lines[..self.prefix], &self.base_lines[self.base_edit_end..], &self.base_lines[(self.base_edit_start - 1)..self.base_edit_end]);
            if self.lang != LanguageId::Rust || self.base_edit_end < self.base_edit_start || rust_type_container_insert_verdict(self.lang, pfx, base_sl, suf, path, pool) != Some(true) || rust_type_container_insert_verdict(self.lang, pfx, raw_cand, suf, path, pool) != Some(true) { return false; }
        }
        let Some(pre_bl) = self.pre_err_line().or_else(|| self.semi_pre_err_line(path, pool)).or_else(|| self.eof_cmt_pre_err_line(base_edit_is_cmt)) else { return false; };
        let Some(c_unm) = self.check_cand_closers(raw_cand, path, pool) else { return false; }; let mut dummy = false;
        cand_spans.iter().all(|sp| if sp.end_line <= self.prefix { self.is_covered_prefix_span(sp, &mut dummy) || pre_bl <= sp.line }
            else if sp.line > self.cand_edit_end { c_unm.is_empty() || { let (sl, se) = ((sp.line as isize - self.line_delta).max(1) as usize, (sp.end_line as isize - self.line_delta).max(1) as usize); self.base_spans.iter().any(|b| b.line == sl && b.end_line == se && b.message == sp.message) || (sp.line >= self.eff_cand_eof && sp.message.starts_with("Missing syntax element:")) } }
            else { self.is_midfile_split_span_with_bl(sp, pre_bl) })
    }
    pub(crate) fn is_existing_span(&self, sp: &ErrorSpan) -> bool {
        let (pure_ins, pure_del) = (!self.is_eof_append && is_code_lang(self.lang) && self.base_edit_end < self.base_edit_start && self.cand_edit_end >= self.cand_edit_start, self.base_edit_end >= self.base_edit_start && self.cand_edit_end < self.cand_edit_start);
        self.skip_edit_span(sp) || self.base_spans.iter().any(|b| b.line == sp.line && b.column == sp.column && b.message == sp.message && {
            let exp_end = if b.end_line < self.base_edit_start { b.end_line } else { (b.end_line as isize + self.line_delta).max(b.line as isize) as usize };
            sp.end_line <= exp_end || (pure_ins && b.end_line <= self.prefix && sp.end_line <= self.cand_edit_end) || (pure_del && sp.line <= self.prefix && b.end_line >= self.base_edit_start && b.end_line <= self.base_edit_end && sp.end_line == self.cand_edit_start)
        })
    }
    pub(crate) fn skip_edit_span(&self, sp: &ErrorSpan) -> bool {
        self.is_shifted_eof(sp) || (self.midfile_split_ok && !self.is_eof_append
            && ((is_code_lang(self.lang) && self.cand_edit_end >= self.cand_edit_start && sp.line <= self.cand_edit_end && sp.end_line >= self.cand_edit_start)
                || (self.cand_edit_end < self.cand_edit_start && sp.line <= self.cand_edit_start && sp.end_line >= self.cand_edit_start)))
    }
    pub(crate) fn try_midfile_split(&mut self, raw_cand: &[&str], cand_spans: &[ErrorSpan], path: &Path, pool: &mut ParserPool) -> bool { if !self.midfile_split_ok && self.allow_midfile_span_split(raw_cand, cand_spans, path, pool) { self.midfile_split_ok = true; } self.midfile_split_ok }
    pub(crate) fn allow_span_split(&mut self, raw_cand: &[&str], cand_spans: &[ErrorSpan], path: &Path, pool: &mut ParserPool) -> bool { self.allow_eof_span_split(raw_cand, cand_spans, path, pool) || self.try_midfile_split(raw_cand, cand_spans, path, pool) }
    pub(crate) fn cand_in_edit_count(&self, cand_spans: &[ErrorSpan]) -> usize {
        cand_spans.iter().filter(|sp| !self.skip_edit_span(sp) && if self.cand_edit_end < self.cand_edit_start {
            let (sl, se) = ((sp.line as isize - self.line_delta).max(1) as usize, (sp.end_line as isize - self.line_delta).max(1) as usize);
            !(sp.line >= self.cand_edit_start && self.base_spans.iter().any(|b| b.line == sl && b.end_line == se && b.message == sp.message)) && sp.line <= self.cand_edit_start && sp.end_line >= self.cand_edit_start
        } else { sp.line <= self.cand_edit_end && sp.end_line >= self.cand_edit_start }).count()
    }
    pub(crate) fn needs_scoped_edit_check(&self, cache: &PrefixCache, raw_base: &[&str], raw_cand: &[&str], last_code_idx: Option<usize>, path: &Path, pool: &mut ParserPool) -> bool {
        let (pfx, base_joined) = (&self.base_lines[..self.prefix], raw_base.join("\n"));
        let base_is_cmt = is_pure_code_comment(self.lang, &base_joined, pool);
        if !raw_base.is_empty() && (self.cand_edit_end < self.cand_edit_start || (!raw_cand.is_empty() && !base_is_cmt && is_pure_code_comment(self.lang, &raw_cand.join("\n"), pool)))
            && (is_code_lang(self.lang) || matches!(self.lang, LanguageId::Toml | LanguageId::Twig | LanguageId::Html | LanguageId::Xml | LanguageId::Css)) { return true; }
        if crate::r5::snippet_del::non_code_needs_scoped_check(self.lang, pfx, &base_joined, raw_base, raw_cand) { return true; }
        if base_is_cmt && ((self.base_edit_end == self.base_lines.len() && cache.prefix_ctx.is_scoped_non_stmt())
            || (self.lang == LanguageId::Rust && rust_unclosed_attr_tail(pfx, &cache.joined, &cache.openers).is_some_and(|t| rust_attr_tail_is_open(&t, cache.prefix_ctx == PrefixContainer::TypeBody(TB_ENUM))))) { return true; }
        if base_is_cmt && matches!(self.lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && cache.openers.iter().enumerate().any(|(idx, &(d, ln, _))| d == b'{' && {
            let hdr = collect_opener_hdr(self.lang, pfx, ln, 0, path, pool);
            is_ts_unrecoverable_missing_arrow_group_at(self.lang, &cache.joined, &cache.openers, idx, &hdr) || is_ts_invalid_kw_lt_opener(self.lang, &cache.joined, &cache.openers, idx, &hdr)
        }) { return true; }
        cache.prefix_ctx.is_scoped_non_stmt() && last_code_idx.is_some_and(|i| strip_code_trailing_comment(self.lang, pfx[i]).ends_with(';')
            && self.base_spans.iter().any(|b| b.end_line <= self.prefix && b.line <= i + 1)) && (base_is_cmt || line_delim_detail(self.lang, &base_joined, path, pool).0.is_empty())
    }
    fn push_suf_or_close(lang: LanguageId, s: &mut String, suf: &[&str], path: &Path, pool: &mut ParserPool) {
        if !suf.is_empty() { s.push('\n'); s.push_str(&suf.join("\n")); return; }
        let cl: String = line_delim_detail(lang, s, path, pool).0.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
        if !cl.is_empty() { s.push('\n'); s.push_str(&cl); }
    }
    fn midfile_encl_ok(lang: LanguageId, pfx: &[&str], raw_cand: &[&str], suf: &[&str], openers: &[(u8, usize, usize)], path: &Path, pool: &mut ParserPool) -> bool {
        let Some(&(_, ln0, _)) = openers.first() else { return false; };
        let s0 = (ln0 + 1).saturating_sub(collect_opener_hdr(lang, pfx, ln0, 0, path, pool).len());
        let mut encl = format!("{}\n{}", pfx[s0..].join("\n"), raw_cand.join("\n"));
        Self::push_suf_or_close(lang, &mut encl, suf, path, pool);
        collect_r5_error_spans(lang, &encl, path, pool).is_ok_and(|e| e.is_empty())
    }
    pub(crate) fn rust_brace_wrap(pfx: &[&str], joined: &str, openers: &[(u8, usize, usize)], idx: usize, prev_wrap: &mut u8) -> &'static str {
        let (ln_txt, ctx) = (pfx[openers[idx].1], classify_prefix_container_with_openers(LanguageId::Rust, joined, &openers[..=idx]));
        let pw = std::mem::replace(prev_wrap, match ctx { PrefixContainer::MatchOrSwitch => 1, PrefixContainer::StructLit => 2, _ => 0 });
        match (pw, ctx) {
            (1, PrefixContainer::StructLit) => "_ => _Aice {\n", (2, PrefixContainer::StructLit) => "_f: _Aice {\n", (_, PrefixContainer::StructLit) => "_Aice {\n",
            (_, PrefixContainer::TypeBody(TB_STRUCT)) => "struct _Aice {\n", (_, PrefixContainer::TypeBody(_)) => "enum _Aice {\n",
            (1, PrefixContainer::MatchOrSwitch) => "_ => match _aice_ {\n", (2, PrefixContainer::MatchOrSwitch) => "_f: match _aice_ {\n", (_, PrefixContainer::MatchOrSwitch) => "match _aice_ {\n",
            (1, _) => "_ => {\n", (2, _) => "_f: {\n", (0, PrefixContainer::ValueBrace) => "{\n",
            (0, PrefixContainer::ClassOrTraitBody) => if ln_txt.contains("trait ") { "trait _Aice {\n" } else if ln_txt.contains("mod ") { "mod _aice_ {\n" } else { "impl _Aice {\n" },
            _ => "fn _aice_() {\n",
        }
    }
    fn rust_match_arms_end(pfx: &[&str], min_ln: usize, stmt_ln: usize, path: &Path, pool: &mut ParserPool) -> usize {
        if min_ln >= stmt_ln { return min_ln; }
        let seg = pfx[min_ln..stmt_ln].join("\n");
        let (b, masked) = (seg.as_bytes(), collect_masked_ranges(LanguageId::Rust, &seg, path, pool));
        let (mut out, mut ln, mut depth, mut last, mut m, mut i) = (min_ln, min_ln, 0usize, 0u8, 0usize, 0usize);
        while i < b.len() {
            while m < masked.len() && masked[m].1 <= i { m += 1; }
            if m < masked.len() && i >= masked[m].0 { ln += b[i..masked[m].1].iter().filter(|&&c| c == b'\n').count(); i = masked[m].1; continue; }
            match b[i] {
                b'\n' => { if depth == 0 && matches!(last, b',' | b'}') { out = ln + 1; } ln += 1; last = 0; }
                b'(' | b'[' | b'{' => { depth += 1; last = b[i]; }
                b')' | b']' | b'}' => { depth = depth.saturating_sub(1); last = b[i]; }
                c if !c.is_ascii_whitespace() => last = c, _ => {}
            }
            i += 1;
        }
        if depth == 0 && matches!(last, b',' | b'}') { ln + 1 } else { out }
    }
    #[allow(clippy::too_many_arguments)]
    fn rust_midfile_encl_ok(pfx: &[&str], joined: &str, raw_cand: &[&str], suf: &[&str], openers: &[(u8, usize, usize)], cand_unm: &[u8], path: &Path, pool: &mut ParserPool) -> bool {
        if Self::midfile_encl_ok(LanguageId::Rust, pfx, raw_cand, suf, openers, path, pool) { return true; }
        let non_b: Vec<(u8, usize)> = openers.iter().rev().take_while(|&&(d, _, _)| d != b'{').map(|&(d, l, _)| (d, l)).collect();
        let nb_len = cand_unm.iter().rposition(|&c| c != b'}').map_or(0, |i| i + 1);
        if non_b.is_empty() || nb_len == 0 || openers.len() < cand_unm.len() || !openers.iter().rev().zip(cand_unm).all(|(&(op, _, _), &cl)| matches!((op, cl), (b'(', b')') | (b'[', b']') | (b'{', b'}'))) { return false; }
        let mut upto = nb_len.min(non_b.len());
        while upto < non_b.len() && !strip_code_trailing_comment(LanguageId::Rust, pfx[non_b[upto].1]).ends_with(';') { upto += 1; }
        let cs = openers.len() - cand_unm.len();
        let ol = openers[cs..].iter().enumerate().find_map(|(off, &(d, l, _))| (d != b'{' || classify_prefix_container_with_openers(LanguageId::Rust, joined, &openers[..=cs + off]) == PrefixContainer::StructLit).then_some(l));
        let stmt_ln = ol.map_or(non_b[upto - 1].1, |l| l.min(non_b[upto - 1].1));
        let b_op = openers.iter().enumerate().rev().find(|&(_, &(d, l, _))| d == b'{' && l < stmt_ln);
        let mut min_ln = b_op.map_or(0, |(_, &(_, l, _))| l + 1);
        if let Some((bi, _)) = b_op && classify_prefix_container_with_openers(LanguageId::Rust, joined, &openers[..=bi]) == PrefixContainer::MatchOrSwitch { min_ln = Self::rust_match_arms_end(pfx, min_ln, stmt_ln, path, pool); }
        let st = (stmt_ln + 1).saturating_sub(collect_opener_hdr(LanguageId::Rust, pfx, stmt_ln, min_ln, path, pool).len());
        let (mut wrap, mut bc, mut prev_wrap) = (String::new(), 0usize, 0u8);
        for (idx, &(d, ln, _)) in openers.iter().enumerate().take_while(|&(_, &(_, l, _))| l < st) {
            if matches!(d, b'(' | b'[') {
                if strip_code_trailing_comment(LanguageId::Rust, pfx[ln]).ends_with(';') { return false; }
                let pw = std::mem::replace(&mut prev_wrap, 0);
                wrap.push_str(match (pw, d) { (1, b'(') => "_ => (\n", (1, _) => "_ => [\n", (2, b'(') => "_f: (\n", (2, _) => "_f: [\n", (_, b'(') => "(\n", _ => "[\n" });
                continue;
            }
            bc += 1; wrap.push_str(Self::rust_brace_wrap(pfx, joined, openers, idx, &mut prev_wrap));
        }
        let mut probe = format!("{wrap}{}\n{}", pfx[st..].join("\n"), raw_cand.join("\n"));
        if !suf.is_empty() || bc > 0 { Self::push_suf_or_close(LanguageId::Rust, &mut probe, suf, path, pool); } else { probe = format!("fn _aice_() {{\n{probe}\n}}"); }
        collect_r5_error_spans(LanguageId::Rust, &probe, path, pool).is_ok_and(|e| e.is_empty())
    }
    pub(crate) fn del_drops_matched_closer(lang: LanguageId, openers: &[(u8, usize, usize)], b_stk: &[u8], b_unm: &[u8], suf: &[&str], path: &Path, pool: &mut ParserPool) -> bool {
        let apply = |stk: &mut Vec<u8>, unm: &[u8], add: &[u8]| {
            for &cl in unm { let want = match cl { b')' => b'(', b']' => b'[', _ => b'{' }; if let Some(p) = stk.iter().rposition(|&c| c == want) { stk.remove(p); } }
            stk.extend_from_slice(add);
        };
        let (s_stk, s_unm) = if suf.is_empty() { (Vec::new(), Vec::new()) } else { line_delim_detail(lang, &suf.join("\n"), path, pool) };
        let mut sb: Vec<u8> = openers.iter().map(|&(d, _, _)| d).collect(); let mut sc = sb.clone();
        apply(&mut sb, b_unm, b_stk); apply(&mut sb, &s_unm, &s_stk); apply(&mut sc, &s_unm, &s_stk); sc.len() > sb.len()
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn pure_del_local_errs(&self, pfx: &[&str], slice: &[&str], suf: &[&str], last_code_idx: Option<usize>, cache: &PrefixCache, path: &Path, pool: &mut ParserPool) -> Option<usize> {
        let lci = last_code_idx?;
        let b_idx = cache.openers.iter().rposition(|&(d, _, _)| d == b'{');
        let min_ln = b_idx.map_or(0, |i| cache.openers[i].1 + 1);
        let stmt_ln = cache.openers.iter().find(|&&(d, l, _)| l >= min_ln && matches!(d, b'(' | b'[')).map_or(lci, |&(_, l, _)| l);
        let s0 = (stmt_ln + 1).saturating_sub(collect_opener_hdr(self.lang, pfx, stmt_ln, min_ln, path, pool).len());
        let wrap: String = match b_idx {
            Some(bi) if self.lang == LanguageId::Rust => {
                let mut pw = bi.checked_sub(1).map_or(0, |p| if cache.openers[p].0 != b'{' { 0 } else {
                    match classify_prefix_container_with_openers(LanguageId::Rust, &cache.joined, &cache.openers[..=p]) {
                        PrefixContainer::MatchOrSwitch => 1, PrefixContainer::StructLit => 2, _ => 0,
                    }
                });
                match Self::rust_brace_wrap(pfx, &cache.joined, &cache.openers, bi, &mut pw) {
                    "_Aice {\n" => "let _v = _Aice {\n".to_string(),
                    w if w.starts_with("_ => ") => format!("match _aice_ {{\n{w}"),
                    w if w.starts_with("_f: ") => format!("let _v = _Aice {{\n{w}"),
                    w => w.to_string(),
                }
            }
            Some(bi) => {
                let ctx = classify_prefix_container_with_openers(self.lang, &cache.joined, &cache.openers[..=bi]);
                let cls = ctx == PrefixContainer::ClassOrTraitBody;
                match self.lang {
                    LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx => match ctx { PrefixContainer::ClassOrTraitBody => "class _aice_ {\n", PrefixContainer::ValueBrace => "const _aice_ = {\n", PrefixContainer::TypeBody(_) => "interface _aice_ {\n", _ => "function _aice_() {\n" },
                    LanguageId::Java | LanguageId::CSharp => if cls { "class _Aice_ {\n" } else { "class _Aice_ { void _m_() {\n" },
                    LanguageId::C | LanguageId::Cpp | LanguageId::Dart => if cls { "class _Aice_ {\n" } else { "void _aice_() {\n" },
                    LanguageId::Kotlin => if cls { "class _Aice_ {\n" } else { "fun _aice_() {\n" }, LanguageId::Go => "package _aice\nfunc _aice_() {\n", LanguageId::Php => "<?php\nfunction _aice_() {\n", _ => "",
                }.to_string()
            } None => String::new(),
        };
        let body = if slice.is_empty() { pfx[s0..].join("\n") } else { format!("{}\n{}", pfx[s0..].join("\n"), slice.join("\n")) };
        let mut probe = format!("{wrap}{body}\n{}", suf.join("\n"));
        let cl: String = line_delim_detail(self.lang, &probe, path, pool).0.iter().rev().map(|&c| match c { b'(' => ')', b'[' => ']', _ => '}' }).collect();
        if !cl.is_empty() { probe.push('\n'); probe.push_str(&cl); }
        Some(if wrap.is_empty() { min_snippet_errors(self.lang, &probe, path, pool) } else { collect_r5_error_spans(self.lang, &probe, path, pool).map_or(1, |e| e.len()) })
    }
    #[allow(clippy::too_many_arguments)]
    fn py_rb_mid_err(lang: LanguageId, pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], ln: usize, path: &Path, pool: &mut ParserPool) -> bool {
        let mut s0 = ln; while s0 > 0 && (pfx[s0 - 1].trim_end().ends_with('\\') || pfx[s0].trim_start().starts_with('(')) { s0 -= 1; }
        let (pfx_tail, suf_j) = (pfx[s0..].join("\n"), suf.join("\n"));
        let pre = if lang == LanguageId::Python {
            let ind0: String = pfx[s0].chars().take_while(|c| c.is_whitespace()).collect();
            let mut p = if ind0.is_empty() { String::new() } else { pfx[s0..].iter().chain(raw_cand).chain(suf).filter(|l| { let t = l.trim_start(); !t.is_empty() && !t.starts_with('#') })
                .map(|l| l.chars().take_while(|c| c.is_whitespace()).collect::<String>()).filter(|w| !w.is_empty() && w.len() < ind0.len())
                .min_by_key(String::len).map_or_else(|| "def _aice_():\n".to_string(), |m| format!("def _aice_():\n{m}if _aice_:\n")) };
            if pfx[s0].trim_start().strip_prefix("elif").is_some_and(|r| r.starts_with(|c: char| c.is_whitespace() || c == '(')) { p.push_str(&format!("{ind0}if _aice_:\n{ind0}  pass\n")); } p
        } else { "def _aice_\n".repeat((0..=6).min_by_key(|&n| collect_r5_error_spans(lang, &format!("{}{pfx_tail}\n_aice_\n{suf_j}", "def _aice_\n".repeat(n)), path, pool).map_or(99, |e| e.len())).unwrap_or(0)) };
        let (wrap_ln, pre_cnt, cand_end) = (pre.lines().count() + pfx.len() - s0, pre.lines().count(), pre.lines().count() + pfx.len() - s0 + raw_cand.len());
        let Ok(c_errs) = collect_r5_error_spans(lang, &if raw_cand.is_empty() { format!("{pre}{pfx_tail}\n{suf_j}") } else { format!("{pre}{pfx_tail}\n{}\n{suf_j}", raw_cand.join("\n")) }, path, pool) else { return true; };
        if c_errs.is_empty() { return false; }
        let a_errs = collect_r5_error_spans(lang, &format!("{pre}{pfx_tail}\n_aice_\n{suf_j}"), path, pool).unwrap_or_default();
        let (suf_has_rp, suf0_has_rp) = (line_delim_detail(lang, &suf_j, path, pool).1.contains(&b')'), suf.first().is_some_and(|s| line_delim_detail(lang, s, path, pool).1.contains(&b')')));
        let (cand_has_rp, suf_has_code) = (line_delim_detail(lang, &raw_cand.join("\n"), path, pool).1.contains(&b')'), !is_pure_code_comment(lang, &suf_j, pool));
        let ((b_stk, b_unm), (c_stk, c_unm)) = (line_delim_detail(lang, &crate::r5::snippet_del_lang::join_slices(&pfx[s0..], raw_base, suf), path, pool), line_delim_detail(lang, &crate::r5::snippet_del_lang::join_slices(&pfx[s0..], raw_cand, suf), path, pool));
        if c_unm.len() > b_unm.len() || c_stk.len() > b_stk.len() { return true; }
        if !cand_has_rp && !suf_has_rp && suf_has_code && c_errs.iter().any(|e| e.line <= cand_end + 1) { return true; }
        if !suf_has_code && !cand_has_rp { return false; }
        let (base_cond_ok, cand_cond_ok) = if suf_has_rp {
            (crate::r5::snippet_del_win::py_rb_cond_clean_ok(lang, &pre, pfx, s0, raw_base, &suf_j, path, pool),
             crate::r5::snippet_del_win::py_rb_cond_clean_ok(lang, &pre, pfx, s0, raw_cand, &suf_j, path, pool))
        } else { (false, false) };
        if base_cond_ok && !cand_cond_ok { return true; } else if raw_cand.is_empty() && cand_cond_ok { return false; }
        c_errs.iter().any(|e| if e.line <= cand_end { !(e.line <= wrap_ln && (cand_cond_ok || e.line > pre_cnt + 1) && suf_has_rp && a_errs.iter().any(|ae| ae.line == e.line && ae.column == e.column && ae.message == e.message)) }
            else if e.line == cand_end + 1 { !suf0_has_rp || e.message == "Missing syntax element: ')'" || !a_errs.iter().any(|ae| ae.line + raw_cand.len() == e.line + 1 && ae.column == e.column && ae.message == e.message) } else { !cand_cond_ok && !a_errs.iter().any(|ae| ae.line + raw_cand.len() == e.line + 1 && ae.column == e.column && ae.message == e.message) })
    }
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn edit_slice_has_error_midfile(&self, path: &Path, pool: &mut ParserPool, pfx: &[&str], raw_base: &[&str], raw_cand: &[&str], suf: &[&str], last_code_idx: Option<usize>, cache: &mut PrefixCache) -> Option<bool> {
        let er = match crate::r5::snippet_del::check_edit_slice_has_error_midfile(self, path, pool, pfx, raw_base, raw_cand, suf, last_code_idx, cache) {
            (er, true) => return er,
            (er, false) => er,
        };
        let cand_unm = if is_code_lang(self.lang) { line_delim_detail(self.lang, &raw_cand.join("\n"), path, pool).1 } else { Vec::new() };
        let ts_wrap = |op_idx: usize| match cache.openers[..op_idx].iter().rposition(|&(d, _, _)| d == b'{').map_or(PrefixContainer::TopLevel, |pb| classify_prefix_container_with_openers(self.lang, &cache.joined, &cache.openers[..=pb])) {
            PrefixContainer::ClassOrTraitBody => "class _aice_ {", PrefixContainer::ValueBrace => "const _aice_ = {", PrefixContainer::TypeBody(_) => "interface _aice_ {", _ => "function _aice_() {",
        };
        if er == Some(false) && matches!(self.lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && !is_pure_code_comment(self.lang, &raw_cand.join("\n"), pool)
            && let Some((op_idx, &(_, ln, _))) = cache.openers.iter().enumerate().rev().find(|&(i, &(d, l, _))| d == b'{' && is_ts_unrecoverable_missing_arrow_group_at(self.lang, &cache.joined, &cache.openers, i, &collect_opener_hdr(self.lang, pfx, l, 0, path, pool))) {
            let s0 = (cache.openers[0].1 + 1).saturating_sub(collect_opener_hdr(self.lang, pfx, cache.openers[0].1, 0, path, pool).len());
            let mut full = format!("{}\n{}", pfx[s0..].join("\n"), raw_cand.join("\n")); Self::push_suf_or_close(self.lang, &mut full, suf, path, pool);
            if !collect_r5_error_spans(self.lang, &full, path, pool).is_ok_and(|e| e.is_empty()) {
                let sl = (ln + 1).saturating_sub(collect_opener_hdr(self.lang, pfx, ln, 0, path, pool).len());
                let mut fp = format!("{}\n{}\n{}", ts_wrap(op_idx), pfx[sl..].join("\n"), raw_cand.join("\n")); Self::push_suf_or_close(self.lang, &mut fp, &[], path, pool);
                if !collect_r5_error_spans(self.lang, &fp, path, pool).is_ok_and(|e| e.is_empty()) { return Some(true); }
            }
        }
        if er == Some(true) && matches!(self.lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) && !last_code_idx.is_some_and(|i| trailing_binary_op(self.lang, strip_code_trailing_comment(self.lang, pfx[i])).is_some()) {
            let fp_ok = |mut fp: String, p: &mut ParserPool| { Self::push_suf_or_close(self.lang, &mut fp, suf, path, p); let prof = cst_defect_profile(self.lang, &fp, path, p); prof.min_errs == 0 && prof.unclosed_quotes == 0 };
            if let Some(m_ctx) = ts_kw_method_probe_ctx(self.lang, &cache.joined, &cache.openers) {
                let (tb, mb) = (cache.openers.iter().filter(|&&(d, _, _)| d == b'{').count(), line_delim_detail(self.lang, &m_ctx.join("\n"), path, pool).0.iter().filter(|&&d| d == b'{').count());
                if fp_ok(format!("{}{}\n{}", "function _aice_o_() {\n".repeat(tb.saturating_sub(mb)), m_ctx.join("\n"), raw_cand.join("\n")), pool) { return Some(false); }
            }
            if is_pure_code_comment(self.lang, &raw_base.join("\n"), pool) && let Some(&(b'{', op_ln, _)) = cache.openers.last() {
                let min_ln = cache.openers.get(cache.openers.len().saturating_sub(2)).map_or(0, |&(_, l, _)| l + 1);
                let hdr_j = collect_opener_hdr(self.lang, pfx, op_ln, min_ln, path, pool).join("\n");
                let (w, clean_hdr) = (ts_wrap(cache.openers.len() - 1), strip_comments_strings(self.lang, &hdr_j, true));
                let (clean_tail, raw_tail) = crate::r5::snippet_ts_cls::ts_class_member_tail(&clean_hdr, &hdr_j);
                let (tail, chk) = if w == "const _aice_ = {" { (crate::r5::snippet_ts_type::tail_after_depth0_comma(raw_tail).trim(), crate::r5::snippet_ts_type::tail_after_depth0_comma(clean_tail).trim()) } else { (raw_tail.trim(), clean_tail.trim()) };
                if is_ts_kw_shorthand_method(chk) && matches!(w, "class _aice_ {" | "const _aice_ = {") && fp_ok(format!("{w}\n{tail}\n{}", raw_cand.join("\n")), pool) { return Some(false); }
            }
        }
        let cand_is_cmt = !raw_cand.is_empty() && is_code_lang(self.lang) && is_pure_code_comment(self.lang, &raw_cand.join("\n"), pool);
        let py_rb_ctrl_ln = py_rb_ctrl_paren_ln(self.lang, pfx, &cache.joined, &cache.openers);
        if er == Some(false) && is_code_lang(self.lang) {
            if crate::r5::snippet_ctx_bash::midfile_er_false_adds_err(self, pfx, raw_base, raw_cand, suf, cand_is_cmt, cache, path, pool) { return Some(true); }
            if matches!(self.lang, LanguageId::Python | LanguageId::Ruby) && !cand_is_cmt && !suf.is_empty() && let Some(ln) = py_rb_ctrl_ln.or_else(|| (!raw_base.is_empty() && is_pure_code_comment(self.lang, &raw_base.join("\n"), pool)).then(|| cache.openers.last().and_then(|&(d, ln, _)| (d == b'(').then_some(ln))).flatten()) && Self::py_rb_mid_err(self.lang, pfx, raw_base, raw_cand, suf, ln, path, pool) { return Some(true); }
            if self.lang == LanguageId::Rust && matches!(cache.prefix_ctx, PrefixContainer::ValueBrace | PrefixContainer::StructLit) && !cand_is_cmt && let Some(&(b'{', op_ln, op_byte)) = cache.openers.last() && !is_semi_terminated_broken_opener(LanguageId::Rust, &cache.joined, b'{', op_byte, pfx[op_ln]) {
                let ab = cache.joined.get(op_byte + 1..).unwrap_or("");
                if rust_brace_has_depth0_semi(ab) && !collect_r5_error_spans(LanguageId::Rust, &format!("{{\n{ab}\n}}"), path, pool).is_ok_and(|e| e.is_empty()) && !Self::rust_midfile_encl_ok(pfx, &cache.joined, raw_cand, suf, &cache.openers, &cand_unm, path, pool) { return Some(true); }
            }
            if cand_unm.iter().any(|c| matches!(c, b']' | b')')) && let Some(&(b'[' | b'(', _, _)) = cache.openers.last() && cache.openers.iter().rev().take_while(|&&(d, _, _)| d != b'{').take(cand_unm.len()).any(|&(d, ln, byte)| match self.lang {
                LanguageId::Rust => strip_code_trailing_comment(LanguageId::Rust, pfx[ln]).ends_with(';'), LanguageId::Python => strip_code_trailing_comment(LanguageId::Python, pfx[ln]).ends_with(':') && !is_py_lambda_colon(pfx[ln]),
                _ => is_semi_terminated_broken_opener(self.lang, &cache.joined, d, byte, pfx[ln]),
            }) && !if self.lang == LanguageId::Rust { Self::rust_midfile_encl_ok(pfx, &cache.joined, raw_cand, suf, &cache.openers, &cand_unm, path, pool) } else { Self::midfile_encl_ok(self.lang, pfx, raw_cand, suf, &cache.openers, path, pool) } { return Some(true); }
        }
        if er == Some(true) && matches!(self.lang, LanguageId::Python | LanguageId::Ruby) && !cand_is_cmt && !suf.is_empty() && let Some(&(b'(' | b'[', ln, _)) = cache.openers.last() && !Self::py_rb_mid_err(self.lang, pfx, raw_base, raw_cand, suf, py_rb_ctrl_ln.unwrap_or(ln), path, pool) { return Some(false); }
        if er == Some(true) && matches!(self.lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Java) && !cand_unm.is_empty() && !cand_is_cmt
            && line_delim_detail(self.lang, &raw_cand.join("\n"), path, pool).0.is_empty() && !raw_cand.last().is_some_and(|l| has_incomplete_continuation_tail(self.lang, l, path, pool)) && Self::midfile_encl_ok(self.lang, pfx, raw_cand, suf, &cache.openers, path, pool) { return Some(false); }
        if er == Some(true) && self.lang == LanguageId::Rust {
            if !cand_unm.is_empty() && Self::rust_midfile_encl_ok(pfx, &cache.joined, raw_cand, suf, &cache.openers, &cand_unm, path, pool) { return Some(false); }
            if !self.is_eof_append && !cand_unm.contains(&b']') && cache.openers.iter().any(|&(d, _, _)| d == b'[') && let Some(masked) = mask_rust_midfile_semi_brack_prefix(pfx, &cache.joined, &cache.openers, suf, path, pool) {
                let refs: Vec<&str> = masked.iter().map(String::as_str).collect();
                let (mut m_cache, m_last) = (PrefixCache::new(self.lang, &refs, "", false, None, path, pool), last_code_line_idx(self.lang, &refs, pool));
                return edit_slice_has_error_cached(self.lang, path, pool, &refs, raw_base, raw_cand, suf, self.is_eof_append, m_last, &mut m_cache);
            }
        }
        er
    }
}
