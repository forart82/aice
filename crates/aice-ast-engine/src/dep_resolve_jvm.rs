use std::collections::HashMap;
use std::path::Path;

use aice_lang_registry::{LanguageId, SymbolKind};

use crate::dep_graph::FileDepInput;
use crate::dep_resolve::{WorkspaceIndex, probe_contained};
use crate::r5::java_lang::strip_jvm_comments;

fn push_unique_idx(map: &mut HashMap<String, Vec<usize>>, key: String, file_idx: usize) {
    let list = map.entry(key).or_default();
    if !list.contains(&file_idx) {
        list.push(file_idx);
    }
}

pub(crate) fn index_jvm_file(
    file: &FileDepInput,
    file_idx: usize,
    jvm_defs: &mut HashMap<String, Vec<usize>>,
) {
    if !matches!(file.lang, LanguageId::Java | LanguageId::Kotlin) {
        return;
    }
    let pkgs: Vec<&str> = file
        .symbols
        .iter()
        .filter(|s| s.kind == SymbolKind::Module)
        .map(|s| s.name.as_str())
        .collect();
    for sym in &file.symbols {
        if sym.kind == SymbolKind::Module {
            continue;
        }
        if pkgs.is_empty() {
            push_unique_idx(jvm_defs, sym.qualified_name.clone(), file_idx);
            if file.lang == LanguageId::Kotlin && sym.qualified_name.contains(".Companion.") {
                push_unique_idx(jvm_defs, sym.qualified_name.replace(".Companion.", "."), file_idx);
            }
        } else {
            for pkg in &pkgs {
                push_unique_idx(jvm_defs, format!("{pkg}.{}", sym.qualified_name), file_idx);
                if file.lang == LanguageId::Kotlin && sym.qualified_name.contains(".Companion.") {
                    push_unique_idx(
                        jvm_defs,
                        format!("{pkg}.{}", sym.qualified_name.replace(".Companion.", ".")),
                        file_idx,
                    );
                }
            }
        }
    }
}

fn clean_jvm_spec(lang: LanguageId, spec: &str) -> String {
    let no_comments = strip_jvm_comments(spec);
    let mut tokens: Vec<&str> = no_comments.split_whitespace().collect();
    if lang == LanguageId::Kotlin
        && let Some(as_pos) = tokens.iter().position(|&t| t == "as")
    {
        tokens.truncate(as_pos);
    }
    tokens.concat()
}

pub(crate) fn resolve_jvm(
    lang: LanguageId,
    spec: &str,
    idx: &WorkspaceIndex,
    root: &Path,
) -> Vec<String> {
    let clean = clean_jvm_spec(lang, spec);
    if clean.is_empty() {
        return Vec::new();
    }
    let ext = if lang == LanguageId::Java { "java" } else { "kt" };
    let is_star = clean.ends_with(".*");
    let no_star = clean.strip_suffix(".*").unwrap_or(&clean);
    let path_str = no_star.replace('.', "/");
    for r in ["", "src/main/java", "src/main/kotlin", "src"] {
        if let Some(p) = probe_contained(r, &format!("{path_str}.{ext}"), idx, root) {
            return vec![p];
        }
        if !is_star
            && let Some((parent, _)) = path_str.rsplit_once('/')
            && let Some(p) = probe_contained(r, &format!("{parent}.{ext}"), idx, root)
        {
            return vec![p];
        }
    }
    let mut out = Vec::new();
    let mut collect_from = |map: &HashMap<String, Vec<usize>>, key: &str| {
        if let Some(list) = map.get(key) {
            for &ti in list {
                if let Some(p) = idx.path_for_idx(ti)
                    && !out.contains(&p)
                {
                    out.push(p);
                }
            }
        }
    };
    if is_star {
        collect_from(&idx.jvm_defs, no_star);
        collect_from(&idx.module_definers, no_star);
    } else {
        collect_from(&idx.jvm_defs, &clean);
    }
    out
}
