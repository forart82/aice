use std::path::Path;

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall, detect_language};

use crate::aice_lower::{lower_for_splice, lower_snippet};
use crate::ast_splice::{apply_ast_splice, apply_insert_relative, resolve_symbol_node};
use crate::diagnostics::format_firewall_diagnostics;
use crate::hunk::{extract_hunk_blocks, has_hunk_markers};
use crate::hunk_match::{EnclosingContext, apply_hunk_blocks};
use crate::imports_splice::apply_imports_splice;
use crate::line_splice::{apply_line_range, parse_line_range_selector};
use crate::types::{BatchSpliceItem, EditSummary, VirtualFile};

fn is_eof_sel(s: &str) -> bool {
    matches!(s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(), "eof" | "end" | "append")
}

fn is_imports_sel(s: &str) -> bool {
    matches!(s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(), "imports")
}

fn is_create_sel(s: &str) -> bool {
    matches!(s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(), "create")
}

fn is_overwrite_sel(s: &str) -> bool {
    matches!(s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(), "overwrite" | "*")
}

fn is_hunk_sel(s: &str) -> bool {
    matches!(s.trim().trim_start_matches(':').to_ascii_lowercase().as_str(), "hunk")
}

fn apply_clone(
    vf: &VirtualFile,
    lang: LanguageId,
    clone_sym: &str,
    target_sym: Option<&str>,
    payload: &str,
    insert_after: Option<&str>,
    insert_before: Option<&str>,
) -> Result<(String, usize, usize, String), String> {
    if insert_after.is_some() && insert_before.is_some() {
        return Err("Cannot combine --insert-after and --insert-before with @clone".into());
    }
    let reg = EngineRegistry::new();
    let adapter = reg.adapter(lang).ok_or_else(|| format!("@clone unsupported for {}", lang.canonical_name()))?;
    let tree = adapter.parse_cst(&vf.current).map_err(|e| format!("Parse error: {e}"))?;
    let syms = adapter.extract_symbols(&tree, &vf.current);
    let src_sym = resolve_symbol_node(&syms, clone_sym, None)?;
    let mut cloned = vf.current.get(src_sym.start_byte..src_sym.end_byte).unwrap_or("").to_string();
    if let Some(t) = target_sym {
        let old_short = clone_sym.rsplit(['.', ':']).next().unwrap_or(clone_sym);
        let new_short = t.rsplit(['.', ':']).next().unwrap_or(t);
        cloned = cloned.replace(old_short, new_short);
    }
    if has_hunk_markers(payload) {
        let hunks = extract_hunk_blocks(payload)?;
        let fb = format!("{}{}", &vf.current[..src_sym.end_byte], vf.eol.repeat(2));
        let ctx = EnclosingContext { full_before: &fb, full_after: &vf.current[src_sym.end_byte..], orig_disk: vf.original_disk.as_deref() };
        cloned = apply_hunk_blocks(&cloned, &hunks, &vf.canonical, lang, vf.eol, src_sym.start_line, &ctx)?;
    }
    if let Some(anchor) = insert_after.or(insert_before) {
        let out = apply_insert_relative(&vf.current, vf.original_disk.as_deref(), &vf.canonical, lang, vf.eol, anchor, insert_after.is_some(), &cloned, false)?;
        return Ok((out.new_src, out.start_line, out.end_line, out.new_snippet));
    }
    let next = format!("{}{}{}{}", &vf.current[..src_sym.end_byte], vf.eol.repeat(2), cloned, &vf.current[src_sym.end_byte..]);
    Ok((next, src_sym.start_line, src_sym.end_line, cloned))
}

#[allow(clippy::too_many_arguments)]
fn mk_summary(
    vf: &VirtualFile,
    symbol_label: String,
    verb: &'static str,
    start_line: usize,
    end_line: usize,
    original_snippet: String,
    new_snippet: String,
) -> EditSummary {
    EditSummary {
        file_canonical: vf.canonical.clone(),
        file_rel: vf.rel_label.clone(),
        file_abs: vf.display.clone(),
        symbol_label,
        verb,
        start_line,
        end_line,
        original_snippet,
        new_snippet,
    }
}

fn check_delete_payload_firewall(item: &BatchSpliceItem, vf: &VirtualFile, lang: LanguageId) -> Result<(), String> {
    if !item.payload.trim().is_empty() {
        let fw = DefaultSyntaxFirewall;
        if let FirewallVerdict::Invalid { diagnostics } = fw.verify(&item.payload, &vf.canonical, lang) {
            return Err(format_firewall_diagnostics(Path::new(&item.requested_display), lang, &item.payload, &diagnostics));
        }
    }
    Ok(())
}

pub fn apply_item_to_vfs(vf: &mut VirtualFile, item: &BatchSpliceItem) -> Result<EditSummary, String> {
    let lang = detect_language(&vf.canonical, if vf.current.is_empty() { &item.payload } else { &vf.current });
    let fw = DefaultSyntaxFirewall;
    let eol = vf.eol;

    if let Some(ref clone_sym) = item.clone_from {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let (next, sl, el, snippet) = apply_clone(vf, lang, clone_sym, item.symbol.as_deref(), &item.payload, item.insert_after.as_deref(), item.insert_before.as_deref())?;
        vf.current = next;
        let lbl = item.symbol.clone().unwrap_or_else(|| clone_sym.clone());
        return Ok(mk_summary(vf, lbl, "Spliced", sl, el, String::new(), snippet));
    }

    if item.insert_after.is_some() && item.insert_before.is_some() {
        return Err("Cannot combine --insert-after and --insert-before on the same edit".into());
    }
    if let Some(ref anchor) = item.insert_after {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let out = apply_insert_relative(&vf.current, vf.original_disk.as_deref(), &vf.canonical, lang, eol, anchor, true, &item.payload, item.force_aice_ir)?;
        vf.current = out.new_src;
        return Ok(mk_summary(vf, anchor.clone(), "Inserted after", out.start_line, out.end_line, String::new(), out.new_snippet));
    }
    if let Some(ref anchor) = item.insert_before {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let out = apply_insert_relative(&vf.current, vf.original_disk.as_deref(), &vf.canonical, lang, eol, anchor, false, &item.payload, item.force_aice_ir)?;
        vf.current = out.new_src;
        return Ok(mk_summary(vf, anchor.clone(), "Inserted before", out.start_line, out.end_line, String::new(), out.new_snippet));
    }

    if item.delete {
        check_delete_payload_firewall(item, vf, lang)?;
        let Some(ref sym_raw) = item.symbol else {
            return Err("Must specify target symbol with --symbol when splicing native file".into());
        };
        if is_eof_sel(sym_raw) { return Err("Cannot delete 'eof'".into()); }
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let parts: Vec<&str> = sym_raw.split(',').map(str::trim).filter(|s| !s.is_empty()).collect();
        let (mut line_ranges, mut ast_parts) = (Vec::new(), Vec::new());
        for (idx, part) in parts.into_iter().enumerate() {
            if let Some(lr) = parse_line_range_selector(part) {
                let (s, e) = lr?;
                line_ranges.push((idx, s, e));
            } else {
                ast_parts.push((idx, part));
            }
        }
        line_ranges.sort_by_key(|&(_, s, e)| (s, e));
        for w in line_ranges.windows(2) {
            if w[0].2 >= w[1].1 {
                return Err(format!("Overlapping line ranges L{}-L{} and L{}-L{} in --delete", w[0].1, w[0].2, w[1].1, w[1].2));
            }
        }
        line_ranges.sort_by_key(|b| std::cmp::Reverse(b.1));
        let mut collected = Vec::new();
        for (idx, s, e) in line_ranges {
            let o = apply_line_range(&vf.current, vf.original_disk.as_deref(), Path::new(&item.requested_display), &vf.canonical, lang, eol, s, e, "", true, false)?;
            vf.current = o.new_src;
            collected.push((idx, o.original_snippet, o.start_line, o.end_line));
        }
        for (idx, part) in ast_parts {
            let o = apply_ast_splice(&vf.current, vf.original_disk.as_deref(), &vf.canonical, lang, eol, part, "", true, item.preserve_docs, false)?;
            vf.current = o.new_src;
            collected.push((idx, o.original_snippet, o.start_line, o.end_line));
        }
        collected.sort_by_key(|c| c.0);
        let sl = collected.iter().map(|c| c.2).min().unwrap_or(1);
        let el = collected.iter().map(|c| c.3).max().unwrap_or(1);
        let joined_orig = collected.into_iter().map(|c| c.1).collect::<Vec<_>>().join(eol);
        vf.replaced_baselines.push(joined_orig.clone());
        return Ok(mk_summary(vf, sym_raw.clone(), "Deleted", sl, el, joined_orig, String::new()));
    }

    let sym_str = item.symbol.as_deref().unwrap_or("");
    let is_hunk = is_hunk_sel(sym_str) || (sym_str.is_empty() && has_hunk_markers(&item.payload));
    if is_hunk {
        if !vf.existed_on_disk {
            return Err(format!("Source file not found: {} (cannot apply <<< === >>> hunk to a non-existent file)", item.requested_display));
        }
        let hunks = extract_hunk_blocks(&item.payload)?;
        let orig = vf.current.clone();
        let ctx = EnclosingContext::full_file(vf.original_disk.as_deref());
        vf.current = apply_hunk_blocks(&vf.current, &hunks, &vf.canonical, lang, eol, 1, &ctx)?;
        vf.replaced_baselines.push(hunks.iter().map(|h| h.search.as_str()).collect::<Vec<_>>().join("\n"));
        let lc = orig.lines().count().max(1);
        return Ok(mk_summary(vf, ":hunk".into(), "Spliced", 1, lc, String::new(), item.payload.clone()));
    }

    if is_eof_sel(sym_str) {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        if item.payload.trim().is_empty() { return Err("Cannot append empty payload to :eof".into()); }
        let (next_src, body) = lower_for_splice(
            &item.payload, lang, item.force_aice_ir, false, false, vf.original_disk.as_deref(), &fw, &vf.canonical,
            |txt| {
                let body = txt.trim_end_matches(['\r', '\n']).to_string();
                let mut cand = vf.current.clone();
                if !cand.is_empty() && !cand.ends_with('\n') { cand.push_str(eol); }
                cand.push_str(&body);
                cand.push_str(eol);
                (cand, body)
            },
        )?;
        vf.current = next_src;
        let lc = vf.current.lines().count().max(1);
        return Ok(mk_summary(vf, "eof".into(), "Spliced", lc, lc, String::new(), body));
    }

    if is_imports_sel(sym_str) {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let (next, orig, sl, el) = apply_imports_splice(&vf.current, lang, eol, &item.payload);
        vf.current = next;
        vf.replaced_baselines.push(orig.clone());
        return Ok(mk_summary(vf, "imports".into(), "Spliced", sl, el, orig, item.payload.clone()));
    }

    if let Some(lr) = parse_line_range_selector(sym_str) {
        if !vf.existed_on_disk { return Err(format!("Source file not found: {}", item.requested_display)); }
        let (s, e) = lr?;
        let out = apply_line_range(&vf.current, vf.original_disk.as_deref(), Path::new(&item.requested_display), &vf.canonical, lang, eol, s, e, &item.payload, false, item.force_aice_ir)?;
        vf.current = out.new_src;
        vf.replaced_baselines.push(out.original_snippet.clone());
        return Ok(mk_summary(vf, sym_str.to_string(), "Spliced", out.start_line, out.end_line, out.original_snippet, out.new_snippet));
    }

    let is_create_or_overwrite = sym_str.is_empty() || is_create_sel(sym_str) || is_overwrite_sel(sym_str);
    if is_create_or_overwrite {
        if !vf.existed_on_disk && !item.create && !is_create_sel(sym_str) {
            return Err(format!("Source file not found: {} (pass --create to create a new file)", item.requested_display));
        }
        if vf.existed_on_disk && (item.explicit_create_flag || is_create_sel(sym_str)) && !item.overwrite && !item.force {
            return Err(format!("Target file '{}' already exists (pass --overwrite to replace)", item.requested_display));
        }
        let orig_ref = vf.original_disk.as_deref().unwrap_or(&vf.current);
        if vf.existed_on_disk && !orig_ref.is_empty() && item.payload.is_empty() && !item.force {
            return Err(format!("Refusing to truncate non-empty file '{}' to empty without --force", item.requested_display));
        }
        let exp_ow = is_overwrite_sel(sym_str) || item.overwrite;
        if vf.existed_on_disk && item.payload.is_empty() && !exp_ow && !item.force && !item.create {
            return Err(format!("Refusing to overwrite existing file '{}' with empty content without --overwrite", item.requested_display));
        }
        if vf.existed_on_disk && orig_ref.lines().count() > 25 && !item.force {
            return Err(format!("Target file '{}' already exists (>25 lines); pass --force to overwrite or splice surgically", item.requested_display));
        }
        let lowered = lower_snippet(&item.payload, lang, item.force_aice_ir, false, None, &fw, &vf.canonical)?;
        let orig = vf.original_disk.clone().unwrap_or_default();
        let was_new = !vf.existed_on_disk;
        vf.current = lowered.clone();
        vf.existed_on_disk = true;
        let sym_lbl = if is_create_sel(sym_str) || was_new { ":create" } else { "*" };
        let lc = vf.current.lines().count().max(1);
        return Ok(mk_summary(vf, sym_lbl.into(), "Spliced", 1, lc, orig, lowered));
    }

    if !vf.existed_on_disk {
        return Err(format!("Source file not found: {}", item.requested_display));
    }
    let out = apply_ast_splice(&vf.current, vf.original_disk.as_deref(), &vf.canonical, lang, eol, sym_str, &item.payload, false, item.preserve_docs, item.force_aice_ir)?;
    vf.current = out.new_src;
    vf.replaced_baselines.push(out.original_snippet.clone());
    if !out.preserved_trivia.is_empty() { vf.preserved_trivia.push(out.preserved_trivia); }
    Ok(mk_summary(vf, sym_str.to_string(), "Spliced", out.start_line, out.end_line, out.original_snippet, out.new_snippet))
}
