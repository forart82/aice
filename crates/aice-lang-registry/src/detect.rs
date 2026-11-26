use std::path::Path;

use crate::detect_heuristics::detect_c_or_cpp;
use crate::detect_sql::detect_sql_dialect;
use crate::lang_id::LanguageId;

pub fn detect_language(path: &Path, sample: &str) -> LanguageId {
    let ext = path
        .extension()
        .and_then(|e| e.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    let file_name = path
        .file_name()
        .and_then(|n| n.to_str())
        .map(|s| s.to_ascii_lowercase())
        .unwrap_or_default();

    if file_name.ends_with(".twig") || ext == "twig" {
        return LanguageId::Twig;
    }

    if ext.is_empty()
        && matches!(
            file_name.as_str(),
            ".bashrc" | ".zshrc" | ".bash_profile" | ".zshenv" | ".profile"
        )
    {
        return LanguageId::Bash;
    }

    match ext.as_str() {
        "json" | "jsonc" | "webmanifest" => LanguageId::Json,
        "yaml" | "yml" => LanguageId::Yaml,
        "toml" => LanguageId::Toml,
        "md" | "markdown" => LanguageId::Markdown,
        "html" | "htm" => LanguageId::Html,
        "css" => LanguageId::Css,
        "xml" | "svg" | "xsd" | "dtd" | "xsl" | "xslt" | "csproj" | "vbproj" | "fsproj"
        | "props" | "targets" | "xaml" | "axaml" | "nuspec" | "plist" | "resx" => LanguageId::Xml,
        "sh" | "bash" | "zsh" => LanguageId::Bash,
        "rs" => LanguageId::Rust,
        "ts" | "mts" | "cts" => LanguageId::TypeScript,
        "tsx" => LanguageId::Tsx,
        "js" | "mjs" | "cjs" | "jsx" => LanguageId::JavaScript,
        "py" | "pyi" | "pyw" => LanguageId::Python,
        "go" => LanguageId::Go,
        "c" => LanguageId::C,
        "cc" | "cpp" | "cxx" | "hpp" | "hxx" | "hh" | "h" => detect_c_or_cpp(&ext, sample),
        "cs" => LanguageId::CSharp,
        "java" => LanguageId::Java,
        "kt" | "kts" => LanguageId::Kotlin,
        "dart" => LanguageId::Dart,
        "php" => LanguageId::Php,
        "rb" => LanguageId::Ruby,
        "prisma" => LanguageId::Prisma,
        "graphql" | "gql" => LanguageId::GraphQl,
        "cypher" | "cyp" | "cql" => LanguageId::Cypher,
        "aice" => LanguageId::Aice,
        "sql" => detect_sql_dialect(&file_name, sample),
        _ => detect_shebang(sample),
    }
}

fn detect_shebang(sample: &str) -> LanguageId {
    let trimmed = sample.strip_prefix('\u{FEFF}').unwrap_or(sample);
    let first = trimmed.lines().next().unwrap_or_default().trim();
    let Some(rest) = first.strip_prefix("#!") else {
        return LanguageId::PlainText;
    };
    let mut tokens = rest.split_whitespace();
    let Some(first_tok) = tokens.next() else {
        return LanguageId::PlainText;
    };
    let first_bin = first_tok.rsplit('/').next().unwrap_or(first_tok);
    let interp = if first_bin == "env" {
        let mut found = None;
        let mut skip_next = false;
        for tok in tokens {
            if skip_next {
                skip_next = false;
                continue;
            }
            if matches!(tok, "-u" | "-C" | "--unset" | "--chdir") {
                skip_next = true;
                continue;
            }
            if tok.starts_with('-') || tok.contains('=') {
                continue;
            }
            found = Some(tok.rsplit('/').next().unwrap_or(tok));
            break;
        }
        match found {
            Some(bin) => bin,
            None => return LanguageId::PlainText,
        }
    } else {
        first_bin
    };
    match interp.to_ascii_lowercase().as_str() {
        s if s.starts_with("python") => LanguageId::Python,
        "bash" | "sh" | "zsh" | "dash" | "ksh" | "ash" => LanguageId::Bash,
        "node" | "nodejs" | "bun" => LanguageId::JavaScript,
        "deno" | "tsx" | "ts-node" => LanguageId::TypeScript,
        s if s.starts_with("ruby") => LanguageId::Ruby,
        s if s.starts_with("php") => LanguageId::Php,
        _ => LanguageId::PlainText,
    }
}
