use aice_aice_ir::ir::{AiceItem, AiceModule};
use aice_lang_registry::LanguageId;

use crate::aice_unwrap_cls::{strip_first_matching_line, unwrap_class_wrappers, unwrap_outer_block};

fn strip_ir_prefixes(s: &str) -> &str {
    let mut cur = s;
    for vis in ["pub ", "priv ", "prot ", "pkg "] {
        if let Some(rest) = cur.strip_prefix(vis) { cur = rest; break; }
    }
    for kw in ["abstract ", "async "] {
        if let Some(rest) = cur.strip_prefix(kw) { cur = rest; break; }
    }
    cur
}

fn is_aice_hash_comment(line: &str) -> bool {
    line == "#"
        || line.starts_with("# ")
        || line.starts_with("#\t")
        || line.starts_with("##")
        || (line.starts_with("#!") && !line.starts_with("#!["))
}

fn is_hybrid_at_sigil(line: &str) -> bool {
    let Some(rest) = line.strip_prefix('@') else { return false; };
    ["fn", "cls", "type", "class"].iter().any(|kw| {
        rest.strip_prefix(kw).is_some_and(|tail| {
            tail.is_empty()
                || tail
                    .bytes()
                    .next()
                    .is_some_and(|b| !b.is_ascii_alphanumeric() && b != b'_')
        })
    })
}

fn is_aice_header_prefix(line: &str) -> bool {
    let bare = strip_ir_prefixes(line);
    bare.starts_with("import ")
        || bare.starts_with("from ")
        || line.starts_with("directive ")
        || (line.starts_with('@') && !is_hybrid_at_sigil(line))
}

pub(crate) fn first_ir_header_line(raw: &str) -> &str {
    let mut rest = raw;
    loop {
        rest = rest.trim_start();
        if rest.starts_with("//") {
            rest = rest.split_once('\n').map_or("", |(_, r)| r);
            continue;
        }
        if rest.starts_with("/*") {
            let Some((_, after)) = rest[2..].split_once("*/") else {
                return "";
            };
            rest = after;
            continue;
        }
        let line = rest.lines().next().unwrap_or("").trim();
        if is_aice_hash_comment(line) || is_aice_header_prefix(line) {
            rest = rest.split_once('\n').map_or("", |(_, r)| r);
            continue;
        }
        return line;
    }
}

pub(crate) fn has_explicit_aice_module_header(raw: &str) -> bool {
    let first = first_ir_header_line(raw);
    first.starts_with("module ") && !first.contains('{') && !first.contains(';')
}

pub(crate) fn looks_like_full_aice_module(raw: &str) -> bool {
    let first = first_ir_header_line(raw);
    if first.starts_with("module ") {
        return true;
    }
    let head = strip_ir_prefixes(first);
    let has_ir_head = [
        "fn ", "class ", "struct ", "type ", "interface ", "trait ", "enum ",
        "component ", "style ", "tokens ", "table ", "view ", "model ",
        "query ", "cypher ", "data ", "proc ", "trig ", "index ", "dbtype ", "migration ",
    ]
    .iter()
    .any(|kw| head.starts_with(kw));
    has_ir_head && first.ends_with(':') && !first.contains('{') && !first.contains(';')
}

pub(crate) fn has_custom_module_name(module: &AiceModule, lang_tag: &str) -> bool {
    !module.module_name.is_empty() && module.module_name != "module" && module.module_name != lang_tag
}

fn strip_top_imports(text: &str, go_block: bool, pred: impl Fn(&str) -> bool) -> String {
    let (mut out, mut in_head, mut in_blk) = (Vec::new(), true, false);
    for line in text.lines() {
        let t = line.trim();
        if in_blk { if t == ")" { in_blk = false; } continue; }
        if in_head {
            if t.is_empty() { continue; }
            if go_block && t == "import (" { in_blk = true; continue; }
            if pred(t) { continue; }
            if t.starts_with("//") || t.starts_with('#') { out.push(line); continue; }
            in_head = false;
        }
        out.push(line);
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) { out.pop(); }
    if out.is_empty() { String::new() } else { format!("{}\n", out.join("\n")) }
}

pub(crate) fn unwrap_module_wrappers(compiled: &str, module: &AiceModule, lang: LanguageId, unwrap_enclosing_class: bool) -> String {
    let mut out = compiled.to_string();
    match lang {
        LanguageId::Go => out = strip_first_matching_line(&out, |t| t.starts_with("package ") && !t.contains('{')),
        LanguageId::Php => {
            out = strip_first_matching_line(&out, |t| t == "<?php");
            if has_custom_module_name(module, "php") {
                out = strip_first_matching_line(&out, |t| t.starts_with("namespace ") && t.ends_with(';'));
            }
        }
        LanguageId::Kotlin if has_custom_module_name(module, "kotlin") => {
            out = strip_first_matching_line(&out, |t| t.starts_with("package ") && !t.contains('{'));
        }
        LanguageId::Java if has_custom_module_name(module, "java") => {
            out = strip_first_matching_line(&out, |t| t.starts_with("package ") && t.ends_with(';'));
        }
        LanguageId::Ruby if has_custom_module_name(module, "ruby") => {
            out = unwrap_outer_block(&out, |t| t.starts_with("module "), "end", 2);
        }
        _ => {}
    }
    let has_imports = module.items.iter().any(|it| matches!(it, AiceItem::Import(_)));
    let has_non_imports = module.items.iter().any(|it| !matches!(it, AiceItem::Import(_)));
    if has_imports && has_non_imports {
        out = match lang {
            LanguageId::Go => strip_top_imports(&out, true, |t| t.starts_with("import ") && !t.contains('{')),
            LanguageId::Php => strip_top_imports(&out, false, |t| t.starts_with("use ") && t.ends_with(';')),
            LanguageId::Kotlin => strip_top_imports(&out, false, |t| t.starts_with("import ")),
            LanguageId::Java | LanguageId::Dart | LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript =>
                strip_top_imports(&out, false, |t| t.starts_with("import ") && t.ends_with(';')),
            LanguageId::CSharp => strip_top_imports(&out, false, |t| t.starts_with("using ") && t.ends_with(';')),
            LanguageId::C | LanguageId::Cpp => strip_top_imports(&out, false, |t| t.starts_with("#include ")),
            LanguageId::Python => strip_top_imports(&out, false, |t| t.starts_with("import ") || (t.starts_with("from ") && t.contains(" import "))),
            LanguageId::Ruby => strip_top_imports(&out, false, |t| t.starts_with("require ")),
            LanguageId::Rust => strip_top_imports(&out, false, |t| (t.starts_with("use ") || t.starts_with("pub use ")) && t.ends_with(';')),
            _ => out,
        };
    }
    unwrap_class_wrappers(out, module, lang, unwrap_enclosing_class)
}
