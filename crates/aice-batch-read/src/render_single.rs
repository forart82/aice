use aice_aice_ir::DefaultAiceTranspiler;
use aice_aice_ir::ir::TranspileOpts;
use aice_ast_engine::EngineRegistry;
use aice_governance::ReadOp;
use aice_governance::binary_probe::DEFAULT_MAX_TEXT_FILE_BYTES;
use aice_lang_registry::{AdapterLookup, LanguageId, SymbolNode};

use crate::budget::count_lines_exact;
use crate::matcher::ResolvedTarget;
use crate::render_selector::{SelectorCtx, render_selector_part};
use crate::selector::TargetSelector;
use crate::transpile::{parse_for_read, render_outline_aice, transpile_full_aice};

pub struct SingleRenderResult {
    pub header: String,
    pub raw_baseline: String,
    pub realistic_native: Option<String>,
    pub emitted: String,
    pub outline_text: String,
    pub lang: LanguageId,
    pub error: Option<String>,
    pub wasted_payload: Option<String>,
}

pub fn render_resolved_target(
    target: &ResolvedTarget,
    registry: &EngineRegistry,
    transpiler: &DefaultAiceTranspiler,
    op: &ReadOp,
) -> SingleRenderResult {
    if target.is_binary {
        let bytes = std::fs::metadata(&target.canonical).map_or(0, |m| m.len());
        return SingleRenderResult {
            header: String::new(),
            raw_baseline: String::new(),
            realistic_native: None,
            emitted: format!("// [binary file skipped: {} ({bytes} bytes)]\n", target.rel_path),
            outline_text: String::new(),
            lang: LanguageId::PlainText,
            error: None,
            wasted_payload: None,
        };
    }

    let meta = match std::fs::metadata(&target.canonical) {
        Ok(m) => m,
        Err(e) => return err_result(format!("Failed to stat {}: {e}", target.rel_path), None),
    };
    if meta.len() > DEFAULT_MAX_TEXT_FILE_BYTES {
        return err_result(
            format!(
                "File {} exceeds maximum text size ({} > {} bytes)",
                target.rel_path,
                meta.len(),
                DEFAULT_MAX_TEXT_FILE_BYTES
            ),
            None,
        );
    }
    let src = match std::fs::read_to_string(&target.canonical) {
        Ok(s) if !s.as_bytes().contains(&0) => s,
        Ok(_) => return binary_skip_result(&target.rel_path, meta.len()),
        Err(e) if e.kind() == std::io::ErrorKind::InvalidData => {
            return binary_skip_result(&target.rel_path, meta.len());
        }
        Err(e) => return err_result(format!("Failed reading {}: {e}", target.rel_path), None),
    };

    let is_empty_ok = target
        .spec
        .selectors
        .iter()
        .all(|s| matches!(s, TargetSelector::Full | TargetSelector::Outline));
    if src.is_empty() && is_empty_ok {
        let header = format!("// file: {}\n", target.rel_path);
        return SingleRenderResult {
            header: header.clone(),
            raw_baseline: String::new(),
            realistic_native: None,
            emitted: header,
            outline_text: String::new(),
            lang: LanguageId::PlainText,
            error: None,
            wasted_payload: None,
        };
    }

    let (lang, tree) = parse_for_read(registry, &target.canonical, &src);
    let opts = TranspileOpts {
        compact: op.compact,
        include_types: op.include_types,
        preserve_docs: true,
    };
    let total_lines = count_lines_exact(&src);
    let syms: Vec<SymbolNode> = tree
        .as_ref()
        .and_then(|t| registry.adapter(lang).map(|a| a.extract_symbols(t, &src)))
        .unwrap_or_default();
    let outline_view = registry
        .slicer(lang)
        .and_then(|s| tree.as_ref().map(|t| s.outline(t, &src, op.depth.unwrap_or(0), op.include_types)));
    let outline_text = outline_view
        .as_ref()
        .filter(|ov| !ov.entries.is_empty())
        .map(|ov| render_outline_aice(ov, &target.rel_path, false))
        .unwrap_or_default();

    let mut header = format!("// file: {}\n", target.rel_path);
    if let Some(note) = &target.fuzzy_note {
        header.push_str(note);
    }
    let mut emitted = header.clone();

    let is_full_only = target.spec.selectors.len() == 1
        && matches!(target.spec.selectors[0], TargetSelector::Full);
    let force_outline = op.outline || (op.outline_target && !target.is_expanded);
    let auto_outline = is_full_only && !op.full && total_lines > 120 && lang != LanguageId::PlainText;
    if force_outline || (auto_outline && outline_view.as_ref().is_some_and(|ov| !ov.entries.is_empty())) {
        if let Some(ov) = outline_view.as_ref() {
            emitted.push_str(&render_outline_aice(ov, &target.rel_path, !force_outline));
        } else {
            emitted.push_str(&transpile_full_aice(transpiler, tree.as_ref(), lang, &src, &opts));
        }
        return SingleRenderResult {
            header,
            raw_baseline: src,
            realistic_native: None,
            emitted,
            outline_text,
            lang,
            error: None,
            wasted_payload: None,
        };
    }

    let ctx = SelectorCtx {
        target,
        src: &src,
        total_lines,
        lang,
        tree: tree.as_ref(),
        syms: &syms,
        registry,
        transpiler,
        opts: &opts,
        op,
    };
    let mut realistic_parts = Vec::new();
    for sel in &target.spec.selectors {
        if let Err(msg) = render_selector_part(sel, &ctx, &mut emitted, &mut realistic_parts) {
            return err_result(msg, Some(src));
        }
        if !emitted.ends_with('\n') {
            emitted.push('\n');
        }
    }

    if !emitted.ends_with('\n') {
        emitted.push('\n');
    }
    let realistic_native = if realistic_parts.is_empty() {
        None
    } else {
        Some(realistic_parts.join("\n"))
    };
    SingleRenderResult {
        header,
        raw_baseline: src,
        realistic_native,
        emitted,
        outline_text,
        lang,
        error: None,
        wasted_payload: None,
    }
}

fn binary_skip_result(rel_path: &str, bytes: u64) -> SingleRenderResult {
    SingleRenderResult {
        header: String::new(),
        raw_baseline: String::new(),
        realistic_native: None,
        emitted: format!("// [binary file skipped: {rel_path} ({bytes} bytes)]\n"),
        outline_text: String::new(),
        lang: LanguageId::PlainText,
        error: None,
        wasted_payload: None,
    }
}

fn err_result(msg: String, wasted: Option<String>) -> SingleRenderResult {
    SingleRenderResult {
        header: String::new(),
        raw_baseline: String::new(),
        realistic_native: None,
        emitted: String::new(),
        outline_text: String::new(),
        lang: LanguageId::PlainText,
        error: Some(msg),
        wasted_payload: wasted,
    }
}
