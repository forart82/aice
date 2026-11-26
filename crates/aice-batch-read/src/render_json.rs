use aice_governance::escape_json_str;
use aice_lang_registry::LanguageId;

use crate::budget::count_cl100k_exact;

pub struct ReadJsonInput<'a> {
    pub target_path: &'a str,
    pub target_content: &'a str,
    pub target_outline: &'a str,
    pub dependencies: &'a [String],
    pub callers: &'a [String],
    pub formatted_bundle: &'a str,
}

pub fn format_read_json(input: &ReadJsonInput<'_>) -> String {
    let token_count = count_cl100k_exact(input.formatted_bundle);
    let mut out = String::from("{\n  \"targetPath\": ");
    escape_json_str(input.target_path, &mut out);
    out.push_str(",\n  \"targetContent\": ");
    escape_json_str(input.target_content, &mut out);
    out.push_str(",\n  \"targetOutline\": ");
    escape_json_str(input.target_outline, &mut out);
    out.push_str(",\n  \"dependencies\": ");
    push_str_array(input.dependencies, &mut out);
    out.push_str(",\n  \"callers\": ");
    push_str_array(input.callers, &mut out);
    out.push_str(",\n  \"formattedBundle\": ");
    escape_json_str(input.formatted_bundle, &mut out);
    out.push_str(&format!(",\n  \"tokenCount\": {token_count}\n}}\n"));
    out
}

pub fn format_context_stats_footer(
    bundle: &str,
    dep_count: usize,
    caller_count: usize,
    target_chars: usize,
) -> String {
    let pack_tokens = count_cl100k_exact(bundle);
    format!(
        "\n📊 Context Pack Token Telemetry:\n  Total pack tokens: {pack_tokens}\n  Dependencies:      {dep_count}\n  Downstream callers:{caller_count}\n  Target characters: {target_chars}\n"
    )
}

pub fn estimate_stats_footer_tokens(
    max_tokens: usize,
    dep_count: usize,
    caller_count: usize,
    est_chars: usize,
) -> usize {
    let sample_pack = max_tokens.max(999);
    let sample = format!(
        "\n📊 Context Pack Token Telemetry:\n  Total pack tokens: {sample_pack}\n  Dependencies:      {dep_count}\n  Downstream callers:{caller_count}\n  Target characters: {}\n",
        est_chars.max(9999)
    );
    count_cl100k_exact(&sample) + 2
}

pub fn resolve_stats_fill_budget(
    raw_budget: usize,
    stats: bool,
    json: bool,
    explicit_max_tokens: Option<usize>,
    dep_count: usize,
    caller_count: usize,
    est_chars: usize,
) -> (usize, bool) {
    if !stats || json || explicit_max_tokens.is_none() {
        return (raw_budget, false);
    }
    let reserve = estimate_stats_footer_tokens(raw_budget, dep_count, caller_count, est_chars);
    if raw_budget > reserve {
        (raw_budget - reserve, true)
    } else {
        (raw_budget, false)
    }
}

pub fn append_stats_footer_within_budget(
    emitted_output: &mut String,
    dep_count: usize,
    caller_count: usize,
    target_chars: usize,
    explicit_max_tokens: Option<usize>,
) {
    if let Some(mt) = explicit_max_tokens {
        if mt == 0 || emitted_output.is_empty() {
            return;
        }
        let footer = format_context_stats_footer(emitted_output, dep_count, caller_count, target_chars);
        let with_footer = format!("{emitted_output}{footer}");
        if count_cl100k_exact(&with_footer) <= mt {
            emitted_output.push_str(&footer);
        }
    } else {
        let footer = format_context_stats_footer(emitted_output, dep_count, caller_count, target_chars);
        emitted_output.push_str(&footer);
    }
}

fn push_str_array(items: &[String], out: &mut String) {
    out.push('[');
    for (idx, item) in items.iter().enumerate() {
        if idx > 0 {
            out.push_str(", ");
        }
        escape_json_str(item, out);
    }
    out.push(']');
}

pub fn resolve_pack_language(langs: &[LanguageId]) -> Option<String> {
    if langs.is_empty() {
        return Some("PlainText".to_string());
    }
    let first = langs[0];
    if langs.iter().all(|l| *l == first) {
        Some(telemetry_lang(first).to_string())
    } else {
        Some("Multi".to_string())
    }
}

fn telemetry_lang(lang: LanguageId) -> &'static str {
    match lang {
        LanguageId::Json => "JSON",
        LanguageId::Yaml => "YAML",
        LanguageId::Toml => "TOML",
        LanguageId::Markdown => "Markdown",
        LanguageId::Html => "HTML",
        LanguageId::Css => "CSS",
        LanguageId::Xml => "XML",
        LanguageId::Bash => "Shell",
        LanguageId::Rust => "Rust",
        LanguageId::TypeScript => "TypeScript",
        LanguageId::Tsx => "TSX",
        LanguageId::JavaScript => "JavaScript",
        LanguageId::Python => "Python",
        LanguageId::Go => "Go",
        LanguageId::C => "C",
        LanguageId::Cpp => "C++",
        LanguageId::CSharp => "C#",
        LanguageId::Java => "Java",
        LanguageId::Kotlin => "Kotlin",
        LanguageId::Dart => "Dart",
        LanguageId::Php => "PHP",
        LanguageId::Ruby => "Ruby",
        LanguageId::Twig => "Twig",
        LanguageId::AnsiSql
        | LanguageId::PostgreSql
        | LanguageId::MySql
        | LanguageId::Sqlite
        | LanguageId::TSql
        | LanguageId::DbMigration => "SQL",
        LanguageId::Prisma => "Prisma",
        LanguageId::GraphQl => "GraphQL",
        LanguageId::Cypher => "Cypher",
        LanguageId::Aice => "AICE",
        LanguageId::PlainText => "PlainText",
    }
}
