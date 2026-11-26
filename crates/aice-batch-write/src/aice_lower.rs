use std::path::Path;

use aice_aice_ir::compile::compile_module;
use aice_aice_ir::decompile::decompile_tree;
use aice_aice_ir::hybrid_lower::{HybridLowerOpts, lower_hybrid_sigils_with_opts};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::TranspileOpts;
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

use crate::aice_unwrap::{
    has_explicit_aice_module_header, looks_like_full_aice_module, unwrap_module_wrappers,
};

fn supports_module_header_aice_ir(lang: LanguageId) -> bool {
    matches!(
        lang,
        LanguageId::TypeScript
            | LanguageId::Tsx
            | LanguageId::JavaScript
            | LanguageId::Python
            | LanguageId::Rust
            | LanguageId::Go
            | LanguageId::C
            | LanguageId::Cpp
            | LanguageId::CSharp
            | LanguageId::Java
            | LanguageId::Kotlin
            | LanguageId::Dart
            | LanguageId::Php
            | LanguageId::Ruby
            | LanguageId::GraphQl
            | LanguageId::MySql
            | LanguageId::PostgreSql
            | LanguageId::Sqlite
            | LanguageId::TSql
            | LanguageId::AnsiSql
            | LanguageId::DbMigration
            | LanguageId::Prisma
            | LanguageId::Cypher
            | LanguageId::Html
            | LanguageId::Css
    )
}

fn resolve_aice_target_lang(module_name: &str, lang: LanguageId) -> LanguageId {
    if !matches!(
        lang,
        LanguageId::AnsiSql
            | LanguageId::MySql
            | LanguageId::PostgreSql
            | LanguageId::Sqlite
            | LanguageId::TSql
            | LanguageId::DbMigration
    ) {
        return lang;
    }
    match module_name.to_ascii_lowercase().as_str() {
        "mysql" => LanguageId::MySql,
        "postgresql" | "postgres" | "plpgsql" | "pg" => LanguageId::PostgreSql,
        "sqlite" | "sqlite3" => LanguageId::Sqlite,
        "tsql" | "mssql" => LanguageId::TSql,
        "migration" | "dbmigration" | "db_migration" => LanguageId::DbMigration,
        _ => lang,
    }
}

pub(crate) fn is_explicit_aice_module(raw: &str, lang: LanguageId) -> bool {
    supports_module_header_aice_ir(lang)
        && has_explicit_aice_module_header(raw)
        && parse_aice(raw).is_ok_and(|m| {
            let eff = resolve_aice_target_lang(&m.module_name, lang);
            !m.items.is_empty()
                && compile_module(&m, eff)
                    .is_ok_and(|c| raw.trim().is_empty() || !c.trim().is_empty())
        })
}

pub fn lower_snippet(
    raw: &str,
    lang: LanguageId,
    force_aice_ir: bool,
    inside_class: bool,
    go_receiver: Option<String>,
    firewall: &DefaultSyntaxFirewall,
    path: &Path,
) -> Result<String, String> {
    lower_snippet_with_scope(raw, lang, force_aice_ir, inside_class, go_receiver, firewall, path, true, false)
}

#[allow(clippy::too_many_arguments)]
pub fn lower_snippet_with_scope(
    raw: &str,
    lang: LanguageId,
    force_aice_ir: bool,
    inside_class: bool,
    go_receiver: Option<String>,
    firewall: &DefaultSyntaxFirewall,
    path: &Path,
    whole_file: bool,
    unwrap_enclosing_class: bool,
) -> Result<String, String> {
    if matches!(lang, LanguageId::Aice | LanguageId::PlainText) {
        return Ok(raw.to_string());
    }
    if force_aice_ir {
        let module = parse_aice(raw).map_err(|e| format!("AICE IR parse error: {e}"))?;
        let eff = resolve_aice_target_lang(&module.module_name, lang);
        let compiled = compile_module(&module, eff).map_err(|e| format!("AICE IR compile error: {e}"))?;
        if !raw.trim().is_empty() && compiled.trim().is_empty() {
            return Err(format!("AICE IR produced empty output for {}", eff.canonical_name()));
        }
        return Ok(if whole_file {
            compiled
        } else {
            unwrap_module_wrappers(&compiled, &module, eff, unwrap_enclosing_class)
        });
    }
    let py_hybrid_walrus =
        lang == LanguageId::Python && crate::py_walrus::has_standalone_hybrid_walrus(raw);
    let walrus_lowered;
    let fast_raw = if py_hybrid_walrus {
        walrus_lowered = crate::py_walrus::lower_standalone_walrus(raw);
        walrus_lowered.as_str()
    } else {
        raw
    };
    let explicit_aice_mod = is_explicit_aice_module(raw, lang);
    if !explicit_aice_mod && matches!(firewall.verify(fast_raw, path, lang), FirewallVerdict::Valid) {
        return Ok(fast_raw.to_string());
    }
    if (!has_explicit_aice_module_header(raw) || supports_module_header_aice_ir(lang))
        && looks_like_full_aice_module(raw)
        && let Ok(module) = parse_aice(raw)
        && !module.items.is_empty()
    {
        let eff = resolve_aice_target_lang(&module.module_name, lang);
        if let Ok(compiled) = compile_module(&module, eff)
            && (raw.trim().is_empty() || !compiled.trim().is_empty())
            && matches!(firewall.verify(&compiled, path, eff), FirewallVerdict::Valid)
        {
            return Ok(if whole_file {
                compiled
            } else {
                unwrap_module_wrappers(&compiled, &module, eff, unwrap_enclosing_class)
            });
        }
    }
    if lang == LanguageId::Python && crate::py_walrus::has_illegal_walrus(raw) {
        return Ok(raw.to_string());
    }
    let opts = HybridLowerOpts {
        inside_class,
        go_receiver,
    };
    Ok(lower_hybrid_sigils_with_opts(raw, lang, &opts))
}

#[allow(clippy::too_many_arguments)]
pub fn lower_for_splice<T>(
    raw: &str,
    lang: LanguageId,
    force_aice_ir: bool,
    inside_class: bool,
    unwrap_enclosing_class: bool,
    orig_disk: Option<&str>,
    firewall: &DefaultSyntaxFirewall,
    path: &Path,
    mut build_cand: impl FnMut(&str) -> (String, T),
) -> Result<(String, T), String> {
    if !force_aice_ir && !is_explicit_aice_module(raw, lang) {
        if lang == LanguageId::Python && raw.contains(":=") {
            let (unlowered_cand, _) = build_cand(raw);
            if crate::py_walrus::has_illegal_walrus_in_delta(orig_disk, &unlowered_cand) {
                return Ok(build_cand(raw));
            }
            let py_hybrid_walrus = crate::py_walrus::has_standalone_hybrid_walrus(raw)
                && crate::py_walrus::has_standalone_hybrid_in_delta(orig_disk, &unlowered_cand);
            let walrus_lowered;
            let fast_raw = if py_hybrid_walrus {
                walrus_lowered = crate::py_walrus::lower_standalone_walrus(raw);
                walrus_lowered.as_str()
            } else {
                raw
            };
            let (raw_cand, raw_meta) = build_cand(fast_raw);
            if matches!(firewall.verify_incremental(orig_disk, &raw_cand, path, lang), FirewallVerdict::Valid) {
                return Ok((raw_cand, raw_meta));
            }
        } else {
            let (raw_cand, raw_meta) = build_cand(raw);
            if matches!(firewall.verify_incremental(orig_disk, &raw_cand, path, lang), FirewallVerdict::Valid) {
                return Ok((raw_cand, raw_meta));
            }
        }
    }
    let lowered = lower_snippet_with_scope(
        raw,
        lang,
        force_aice_ir,
        inside_class,
        None,
        firewall,
        path,
        false,
        unwrap_enclosing_class,
    )?;
    Ok(build_cand(&lowered))
}

pub fn decompile_to_aice(src: &str, lang: LanguageId) -> String {
    if matches!(lang, LanguageId::PlainText | LanguageId::Aice) {
        return src.to_string();
    }
    let reg = EngineRegistry::new();
    let Some(adapter) = reg.adapter(lang) else {
        return src.to_string();
    };
    let Ok(tree) = adapter.parse_cst(src) else {
        return src.to_string();
    };
    let opts = TranspileOpts::default();
    match decompile_tree(&tree, src, &opts) {
        Ok(module) => print_aice(&module),
        Err(_) => src.to_string(),
    }
}
