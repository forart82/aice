#[derive(Clone, Copy, PartialEq, Eq)]
enum CmdKind {
    Read,
    Search,
    Find,
    Splice,
    Other,
}

fn detect_cmd_kind(raw_args: &[String]) -> CmdKind {
    for arg in raw_args {
        if arg == "--" {
            break;
        }
        if matches!(
            arg.as_str(),
            "--color" | "--no-color" | "--color=true" | "--color=false"
        ) {
            continue;
        }
        if arg.starts_with('-') {
            if matches!(arg.as_str(), "-V" | "--version" | "-h" | "--help") {
                return CmdKind::Other;
            }
            continue;
        }
        return match arg.as_str() {
            "read" | "context" | "ctx" => CmdKind::Read,
            "search" | "grep" => CmdKind::Search,
            "find" | "tree" => CmdKind::Find,
            "splice" | "write" => CmdKind::Splice,
            _ => CmdKind::Other,
        };
    }
    CmdKind::Other
}

fn flag_takes_separate_value(kind: CmdKind, arg: &str) -> bool {
    if arg.contains('=') {
        return false;
    }
    match kind {
        CmdKind::Read => matches!(
            arg,
            "-d" | "--depth"
                | "-L"
                | "--maxDepth"
                | "--max-depth"
                | "-C"
                | "--context"
                | "-c"
                | "--context-lines"
                | "--contextLines"
                | "--max-tokens"
                | "--maxTokens"
                | "-s"
                | "--symbol"
                | "--search"
        ),
        CmdKind::Search => matches!(
            arg,
            "-C" | "--context"
                | "-c"
                | "--context-lines"
                | "--contextLines"
                | "--max-tokens"
                | "--maxTokens"
                | "-s"
                | "--symbol"
                | "--search"
        ),
        CmdKind::Find => matches!(
            arg,
            "-d" | "--depth"
                | "-L"
                | "--maxDepth"
                | "--max-depth"
                | "--max-tokens"
                | "--maxTokens"
                | "--search"
        ),
        CmdKind::Splice => matches!(
            arg,
            "-f"
                | "--file"
                | "-s"
                | "--symbol"
                | "-c"
                | "--code"
                | "-t"
                | "--template"
                | "-b"
                | "--body"
                | "--from"
                | "--insert-after"
                | "--insert-before"
                | "--edits"
                | "--batch"
        ),
        CmdKind::Other => matches!(
            arg,
            "-a" | "--agent" | "-p" | "--project" | "--transcripts-dir" | "--transcriptsDir"
        ),
    }
}

pub fn normalize_ingress_flags(raw_args: &[String]) -> Vec<String> {
    let kind = detect_cmd_kind(raw_args);
    let mut out = Vec::with_capacity(raw_args.len() + 2);
    let (mut passthrough, mut seen_cmd, mut expect_val) = (false, false, false);

    for arg in raw_args {
        if passthrough || arg == "--" {
            passthrough = true;
            out.push(arg.clone());
            continue;
        }
        if expect_val {
            out.push(arg.clone());
            expect_val = false;
            continue;
        }
        if matches!(
            arg.as_str(),
            "--color" | "--no-color" | "--color=true" | "--color=false"
        ) {
            continue;
        }
        if !seen_cmd {
            if !arg.starts_with('-') {
                seen_cmd = true;
            }
            out.push(arg.clone());
            continue;
        }
        expect_val = flag_takes_separate_value(kind, arg);

        if let Some(val) = arg
            .strip_prefix("--maxDepth=")
            .or_else(|| arg.strip_prefix("--max-depth="))
            && matches!(kind, CmdKind::Read | CmdKind::Find)
        {
            out.push("-d".to_string());
            out.push(val.to_string());
            continue;
        }
        if let Some(rest) = arg.strip_prefix("-L").or_else(|| arg.strip_prefix("-d"))
            && !rest.is_empty()
            && rest.bytes().all(|b| b.is_ascii_digit())
            && matches!(kind, CmdKind::Read | CmdKind::Find)
        {
            out.push("-d".to_string());
            out.push(rest.to_string());
            continue;
        }

        if matches!(kind, CmdKind::Read | CmdKind::Search) {
            if let Some(val) = arg
                .strip_prefix("--context-lines=")
                .or_else(|| arg.strip_prefix("--contextLines="))
            {
                out.push("-C".to_string());
                out.push(val.to_string());
                continue;
            }
            if let Some(rest) = arg.strip_prefix("-c").or_else(|| arg.strip_prefix("-C"))
                && !rest.is_empty()
                && rest.bytes().all(|b| b.is_ascii_digit())
            {
                out.push("-C".to_string());
                out.push(rest.to_string());
                continue;
            }
            if matches!(arg.as_str(), "-c" | "--context-lines" | "--contextLines") {
                out.push("-C".to_string());
                continue;
            }
        }

        if let Some(val) = arg.strip_prefix("--maxTokens=") {
            out.push("--max-tokens".to_string());
            out.push(val.to_string());
            continue;
        }
        if let Some(val) = arg.strip_prefix("--transcriptsDir=") {
            out.push(format!("--transcripts-dir={val}"));
            continue;
        }
        if let Some(val) = arg.strip_prefix("--generateSchemas=") {
            out.push(format!("--generate-schemas={val}"));
            continue;
        }

        match arg.as_str() {
            "--filesOnly" | "--files-only" | "--files=true" | "--filesWithMatches"
            | "--files-with-matches=true" => {
                if kind == CmdKind::Search {
                    out.push("--files-with-matches".to_string());
                } else if kind == CmdKind::Read {
                    out.push("--files".to_string());
                } else {
                    out.push(arg.clone());
                }
            }
            "--files" if kind == CmdKind::Search => {
                out.push("--files-with-matches".to_string());
            }
            "--includeDeps=true"
            | "--include-deps=true"
            | "--includeDeps"
            | "--include-deps"
            | "--deps=true" => {
                out.push("--deps".to_string());
            }
            "--includeDeps=false" | "--include-deps=false" | "--deps=false" => {
                out.push("--no-deps".to_string());
            }
            "--includeCallers=true"
            | "--include-callers=true"
            | "--includeCallers"
            | "--include-callers"
            | "--callers=true" => {
                out.push("--callers".to_string());
            }
            "--includeCallers=false" | "--include-callers=false" | "--callers=false" => {
                out.push("--no-callers".to_string());
            }
            "--maxDepth" | "--max-depth" if matches!(kind, CmdKind::Read | CmdKind::Find) => {
                out.push("-d".to_string());
            }
            "-L" if matches!(kind, CmdKind::Read | CmdKind::Find) => {
                out.push("-d".to_string());
            }
            "--outlineTarget" | "--outlineTarget=true" | "--outline-target=true" => {
                out.push("--outline-target".to_string());
            }
            "--types=false" | "--includeTypes=false" | "--include-types=false" => {
                out.push("--no-types".to_string());
            }
            "--compact=true" => out.push("--compact".to_string()),
            "--compact=false" => out.push("--no-compact".to_string()),
            "--outline=true" => out.push("--outline".to_string()),
            "--full=true" => out.push("--full".to_string()),
            "--json=true" => out.push("--json".to_string()),
            "--stats=true" => out.push("--stats".to_string()),
            "--lineNumber" | "--lineNumber=true" | "--line-number=true" => {
                out.push("-n".to_string());
            }
            "--maxTokens" => out.push("--max-tokens".to_string()),
            "--preserve-docs=false" | "--preserveDocs=false" => {
                out.push("--no-preserve-docs".to_string());
            }
            "--dryRun" | "--dryRun=true" => out.push("--dry-run".to_string()),
            "--inPlace" | "--inPlace=true" => out.push("--in-place".to_string()),
            "--globalRules" | "--globalRules=true" => out.push("--global-rules".to_string()),
            "--transcriptsDir" => out.push("--transcripts-dir".to_string()),
            "--generateSchemas" => out.push("--generate-schemas".to_string()),
            _ => out.push(arg.clone()),
        }
    }
    out
}
