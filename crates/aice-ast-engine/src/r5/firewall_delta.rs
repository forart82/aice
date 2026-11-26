use std::path::Path;

use aice_lang_registry::LanguageId;

use crate::r5::checks::ErrorSpan;
use crate::r5::snippet_cache::last_code_line_idx;
use crate::r5::snippet_cst::line_delim_detail;
use crate::r5::snippet_lex::is_code_lang;
use crate::ts_pool::ParserPool;

pub(crate) struct EofDeltaCtx<'a> {
    pub(crate) lang: LanguageId,
    pub(crate) base_lines: &'a [&'a str],
    pub(crate) base_spans: &'a [ErrorSpan],
    pub(crate) is_eof_append: bool,
    pub(crate) prefix: usize,
    pub(crate) base_edit_start: usize,
    pub(crate) base_edit_end: usize,
    pub(crate) cand_edit_start: usize,
    pub(crate) cand_edit_end: usize,
    pub(crate) eff_base_eof: usize,
    pub(crate) eff_cand_eof: usize,
    pub(crate) line_delta: isize,
    pub(crate) prefix_ends_incomplete: bool,
    pub(crate) midfile_split_ok: bool,
    pub(crate) cand_line0_has_bom: bool,
    pub(crate) outer_unclosed_hdr_line: Option<usize>,
}

impl<'a> EofDeltaCtx<'a> {
    #[allow(clippy::too_many_arguments)]
    pub(crate) fn new(
        lang: LanguageId, base_lines: &'a [&'a str], cand_lines: &[&str], base_spans: &'a [ErrorSpan],
        is_eof_append: bool, prefix: usize, base_edit_start: usize, base_edit_end: usize,
        cand_edit_start: usize, cand_edit_end: usize, line_delta: isize,
        last_code_idx: Option<usize>, prefix_ends_incomplete: bool, pool: &mut ParserPool,
    ) -> Self {
        let eff_base_eof = if is_eof_append { last_code_idx.map_or(base_lines.len(), |i| i + 1) } else { base_lines.len() };
        let eff_cand_eof = if is_eof_append { last_code_line_idx(lang, cand_lines, pool).map_or(cand_lines.len(), |i| i + 1) } else { cand_lines.len() };
        let cand_line0_has_bom = cand_lines.first().is_some_and(|l| l.starts_with('\u{FEFF}'));
        let outer_unclosed_hdr_line = (is_eof_append && matches!(lang, LanguageId::TypeScript | LanguageId::Tsx))
            .then(|| {
                let pfx = &base_lines[..prefix];
                let ops = crate::r5::snippet_ctx_scan::prefix_unclosed_openers(lang, pfx, Path::new("a.ts"), pool);
                let mut hdr = ops.first()?.1;
                while hdr > 0 {
                    let prev = pfx[hdr - 1].trim();
                    if prev.is_empty() || prev.ends_with([';', '{', '}']) { break; }
                    hdr -= 1;
                }
                Some(hdr + 1)
            })
            .flatten();
        Self {
            lang, base_lines, base_spans, is_eof_append, prefix, base_edit_start, base_edit_end,
            cand_edit_start, cand_edit_end, eff_base_eof, eff_cand_eof, line_delta,
            prefix_ends_incomplete, midfile_split_ok: false, cand_line0_has_bom, outer_unclosed_hdr_line,
        }
    }

    pub(crate) fn base_at_eof(&self, b: &ErrorSpan) -> bool {
        b.end_line >= self.eff_base_eof
            || (b.line >= self.eff_base_eof && b.message.starts_with("Missing syntax element:"))
    }

    pub(crate) fn base_non_missing_at_eof(&self, b: &ErrorSpan) -> bool {
        !b.message.starts_with("Missing syntax element:")
            && (self.base_at_eof(b)
                || ((b.end_line + 1 >= self.eff_base_eof
                    || self.outer_unclosed_hdr_line.is_some_and(|hl| b.end_line >= hl))
                    && self.base_spans.iter().any(|eb| self.base_at_eof(eb))))
    }
    pub(crate) fn is_xml_bom_line1_span(&self, sp: &ErrorSpan) -> bool {
        if self.lang != LanguageId::Xml || self.prefix != 0 || sp.line != 1 {
            return false;
        }
        let base_bom = self.base_lines.first().is_some_and(|l| l.starts_with('\u{FEFF}'));
        if base_bom == self.cand_line0_has_bom {
            return false;
        }
        let (exp_c_col, exp_b_col) = if self.cand_line0_has_bom { (4, 1) } else { (1, 4) };
        sp.column == exp_c_col
            && self.base_spans.iter().any(|b| {
                b.line == 1
                    && b.column == exp_b_col
                    && b.message == sp.message
                    && sp.end_line <= (b.end_line as isize + self.line_delta).max(1) as usize
            })
    }
    pub(crate) fn is_shifted_eof(&self, sp: &ErrorSpan) -> bool {
        if !self.is_eof_append {
            return false;
        }
        let any_non_missing_eof = self
            .base_spans
            .iter()
            .any(|b| self.base_non_missing_at_eof(b));
        if any_non_missing_eof
            && sp.end_line <= self.cand_edit_end
            && (sp.line >= self.cand_edit_start
                || self.base_spans.iter().any(|b| {
                    self.base_non_missing_at_eof(b) && (b.line <= sp.line || sp.end_line >= self.eff_cand_eof)
                }))
        {
            return true;
        }
        if !(sp.end_line >= self.eff_cand_eof
            || (sp.line >= self.eff_cand_eof && sp.message.starts_with("Missing syntax element:")))
        {
            return false;
        }
        let any_eof = self.base_spans.iter().any(|b| self.base_at_eof(b));
        self.base_spans.iter().any(|b| {
            (b.message == sp.message
                && self.base_at_eof(b)
                && ((b.line == sp.line && b.column == sp.column)
                    || (b.line >= self.eff_base_eof
                        && sp.line >= self.eff_cand_eof
                        && (b.message.starts_with("Missing syntax element:")
                            || !self.prefix_ends_incomplete))))
                || ((b.line == sp.line
                    || (sp.line >= self.eff_cand_eof
                        && sp.message.starts_with("Missing syntax element:")))
                    && any_eof)
                || (self.base_at_eof(b)
                    && !b.message.starts_with("Missing syntax element:")
                    && !sp.message.starts_with("Missing syntax element:")
                    && b.line <= sp.line
                    && sp.line <= self.base_lines.len()
                    && sp.end_line >= self.eff_cand_eof)
        })
    }
    pub(crate) fn is_covered_prefix_span(
        &self,
        sp: &ErrorSpan,
        need_edit_check: &mut bool,
    ) -> bool {
        let covered = self.base_spans.iter().any(|b| {
            let is_eof_msg_ok = self.is_eof_append
                && !b.message.starts_with("Missing syntax element:")
                && !sp.message.starts_with("Missing syntax element:");
            if b.line <= sp.line && sp.end_line <= b.end_line {
                let shrank = (sp.end_line - sp.line) < (b.end_line - b.line)
                    || (sp.message.starts_with("Missing syntax element:")
                        && b.message.starts_with("Syntax error:"));
                if shrank && b.end_line >= self.base_edit_start {
                    *need_edit_check = true;
                }
                return b.message == sp.message || shrank || is_eof_msg_ok;
            }
            if is_eof_msg_ok
                && b.line <= sp.line
                && b.end_line < sp.end_line
                && self.base_spans.iter().any(|eb| {
                    self.base_at_eof(eb)
                        && (eb.line <= sp.end_line + 1 || sp.end_line <= eb.line)
                        && b.end_line <= eb.line
                })
            {
                *need_edit_check = true;
                return true;
            }
            false
        });
        if covered
            && !self.base_spans.iter().any(|b| {
                b.line == sp.line
                    && b.column == sp.column
                    && b.end_line == sp.end_line
                    && b.message == sp.message
            })
        {
            *need_edit_check = true;
        }
        covered
    }
    pub(crate) fn check_cand_closers(
        &self,
        raw_cand: &[&str],
        path: &Path,
        pool: &mut ParserPool,
    ) -> Option<Vec<u8>> {
        let (_, c_unm) = line_delim_detail(self.lang, &raw_cand.join("\n"), path, pool);
        if c_unm.is_empty() {
            return Some(c_unm);
        }
        let (mut p_stk, p_unm) = line_delim_detail(
            self.lang,
            &self.base_lines[..self.prefix].join("\n"),
            path,
            pool,
        );
        if !p_unm.is_empty() {
            return None;
        }
        for &cl in &c_unm {
            let open = match cl {
                b')' => b'(',
                b']' => b'[',
                b'}' => b'{',
                _ => return None,
            };
            let pos = p_stk.iter().rposition(|&d| d == open)?;
            p_stk.remove(pos);
        }
        Some(c_unm)
    }

    pub(crate) fn allow_eof_span_split(
        &self,
        raw_cand: &[&str],
        cand_spans: &[ErrorSpan],
        path: &Path,
        pool: &mut ParserPool,
    ) -> bool {
        if !self.is_eof_append || !is_code_lang(self.lang) {
            return false;
        }
        if !self
            .base_spans
            .iter()
            .any(|b| self.base_non_missing_at_eof(b))
        {
            return false;
        }
        if self.check_cand_closers(raw_cand, path, pool).is_none() {
            return false;
        }
        let mut dummy = false;
        cand_spans.iter().all(|sp| {
            (sp.line >= self.eff_cand_eof && sp.message.starts_with("Missing syntax element:"))
                || (sp.end_line <= self.prefix && self.is_covered_prefix_span(sp, &mut dummy))
                || self.is_shifted_eof(sp)
        })
    }
}