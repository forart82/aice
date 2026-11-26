use std::fs;
use std::path::{Path, PathBuf};

const PROHIBITED_CRATES: [&str; 10] = [
    "clap",
    "serde",
    "serde_json",
    "sqlparser",
    "pg_query",
    "graphql-parser",
    "regex",
    "ignore",
    "toml",
    "tiktoken-rs",
];

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

fn collect_rs_files(dir: &Path, out: &mut Vec<PathBuf>) {
    let Ok(entries) = fs::read_dir(dir) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        if path.is_dir() {
            collect_rs_files(&path, out);
        } else if path.extension().and_then(|e| e.to_str()) == Some("rs") {
            out.push(path);
        }
    }
}

fn strip_comments(src: &str) -> String {
    let mut out = String::with_capacity(src.len());
    let chars: Vec<char> = src.chars().collect();
    let mut i = 0;
    let mut in_str = false;
    let mut block_depth = 0usize;
    while i < chars.len() {
        if block_depth > 0 {
            if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
                block_depth += 1;
                i += 2;
            } else if chars[i] == '*' && i + 1 < chars.len() && chars[i + 1] == '/' {
                block_depth -= 1;
                i += 2;
                if block_depth == 0 {
                    out.push(' ');
                }
            } else {
                i += 1;
            }
            continue;
        }
        if in_str {
            out.push(chars[i]);
            if chars[i] == '\\' && i + 1 < chars.len() {
                i += 1;
                out.push(chars[i]);
            } else if chars[i] == '"' {
                in_str = false;
            }
            i += 1;
            continue;
        }
        if chars[i] == '\'' {
            // Skip char literal like '"' or '\n' without confusing string state.
            if i + 2 < chars.len() && chars[i + 1] != '\\' && chars[i + 2] == '\'' {
                out.push(chars[i]);
                out.push(chars[i + 1]);
                out.push(chars[i + 2]);
                i += 3;
                continue;
            }
            if i + 3 < chars.len() && chars[i + 1] == '\\' && chars[i + 3] == '\'' {
                out.push(chars[i]);
                out.push(chars[i + 1]);
                out.push(chars[i + 2]);
                out.push(chars[i + 3]);
                i += 4;
                continue;
            }
        }
        if chars[i] == '"' {
            in_str = true;
            out.push(chars[i]);
            i += 1;
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '/' {
            while i < chars.len() && chars[i] != '\n' {
                i += 1;
            }
        } else if chars[i] == '/' && i + 1 < chars.len() && chars[i + 1] == '*' {
            block_depth = 1;
            i += 2;
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    out
}

fn normalize_ws(src: &str) -> String {
    let mut collapsed = String::with_capacity(src.len());
    let mut prev_ws = false;
    for ch in src.chars() {
        if ch.is_ascii_whitespace() {
            if !prev_ws {
                collapsed.push(' ');
                prev_ws = true;
            }
        } else {
            collapsed.push(ch);
            prev_ws = false;
        }
    }
    collapsed
        .replace(" :: ", "::")
        .replace(":: ", "::")
        .replace(" ::", "::")
        .replace(" . ", ".")
        .replace(". ", ".")
        .replace(" .", ".")
        .replace(" (", "(")
}

fn strip_toml_comment(line: &str) -> &str {
    let mut in_dq = false;
    let mut in_sq = false;
    let bytes = line.as_bytes();
    let mut i = 0;
    while i < bytes.len() {
        let b = bytes[i];
        if in_dq {
            if b == b'\\' && i + 1 < bytes.len() {
                i += 2;
                continue;
            }
            if b == b'"' {
                in_dq = false;
            }
        } else if in_sq {
            if b == b'\'' {
                in_sq = false;
            }
        } else if b == b'"' {
            in_dq = true;
        } else if b == b'\'' {
            in_sq = true;
        } else if b == b'#' {
            return &line[..i];
        }
        i += 1;
    }
    line
}

fn extract_package_aliases(line: &str) -> Vec<String> {
    let mut out = Vec::new();
    let bytes = line.as_bytes();
    let mut i = 0;
    while i + 7 < bytes.len() {
        if &bytes[i..i + 7] == b"package" {
            let prev_ok =
                i == 0 || !(bytes[i - 1].is_ascii_alphanumeric() || bytes[i - 1] == b'_' || bytes[i - 1] == b'-');
            let mut j = i + 7;
            while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                j += 1;
            }
            if prev_ok && j < bytes.len() && bytes[j] == b'=' {
                j += 1;
                while j < bytes.len() && bytes[j].is_ascii_whitespace() {
                    j += 1;
                }
                if j < bytes.len() && (bytes[j] == b'"' || bytes[j] == b'\'') {
                    let q = bytes[j];
                    j += 1;
                    let start = j;
                    while j < bytes.len() && bytes[j] != q {
                        j += 1;
                    }
                    if j < bytes.len() {
                        out.push(line[start..j].to_string());
                        i = j + 1;
                        continue;
                    }
                }
            }
        }
        i += 1;
    }
    out
}

#[test]
fn prohibited_dependencies_absent() {
    let root = workspace_root();
    let mut manifests = vec![root.join("Cargo.toml")];
    for entry in fs::read_dir(root.join("crates")).expect("read crates").flatten() {
        let m = entry.path().join("Cargo.toml");
        if m.is_file() {
            manifests.push(m);
        }
    }

    for manifest in manifests {
        let raw = fs::read_to_string(&manifest).expect("read Cargo.toml");
        let mut in_dep_section = false;
        for (line_no, raw_line) in raw.lines().enumerate() {
            let line = strip_toml_comment(raw_line).trim();
            if line.is_empty() {
                continue;
            }
            if line.starts_with('[') && line.ends_with(']') {
                let section = &line[1..line.len() - 1];
                in_dep_section = section.ends_with("dependencies")
                    || section.contains("dependencies.");
                continue;
            }
            if !in_dep_section {
                continue;
            }
            if let Some((lhs, _)) = line.split_once('=') {
                let dep = lhs
                    .trim()
                    .trim_matches('"')
                    .trim_matches('\'')
                    .split('.')
                    .next()
                    .unwrap_or("");
                assert!(
                    !PROHIBITED_CRATES.contains(&dep),
                    "Prohibited dependency '{dep}' in {} at line {}",
                    manifest.display(),
                    line_no + 1
                );
            }
            for pkg in extract_package_aliases(line) {
                assert!(
                    !PROHIBITED_CRATES.contains(&pkg.as_str()),
                    "Prohibited aliased dependency '{pkg}' in {} at line {}",
                    manifest.display(),
                    line_no + 1
                );
            }
        }
    }
}

fn contains_ident_call(code: &str, pat: &str) -> bool {
    let mut start = 0;
    while let Some(idx) = code[start..].find(pat) {
        let abs = start + idx;
        let prev_ok = abs == 0
            || !code[..abs]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if prev_ok {
            return true;
        }
        start = abs + pat.len();
    }
    false
}

fn contains_exact_ident(code: &str, ident: &str) -> bool {
    let mut start = 0;
    while let Some(idx) = code[start..].find(ident) {
        let abs = start + idx;
        let prev_ok = abs == 0
            || !code[..abs]
                .chars()
                .next_back()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        let end = abs + ident.len();
        let next_ok = end == code.len()
            || !code[end..]
                .chars()
                .next()
                .is_some_and(|c| c.is_ascii_alphanumeric() || c == '_');
        if prev_ok && next_ok {
            return true;
        }
        start = abs + ident.len();
    }
    false
}

#[test]
fn stdout_and_disk_write_bypass_guard() {
    let root = workspace_root();
    let mut files = Vec::new();
    for entry in fs::read_dir(root.join("crates")).expect("read crates").flatten() {
        collect_rs_files(&entry.path().join("src"), &mut files);
    }

    let authorized_disk_write_prefixes = [
        "crates/aice-batch-write/src/",
        "crates/aice-telemetry/src/ledger.rs",
        "crates/aice-telemetry/src/error_log.rs",
        "crates/aice-governance/src/config.rs",
        "crates/aice-governance/src/rules_sync.rs",
    ];

    for path in files {
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let stripped = strip_comments(&fs::read_to_string(&path).expect("read source"));
        let norm = normalize_ws(&stripped);

        if rel != "crates/aice-pipeline/src/writer.rs" {
            for pat in ["println!", "print!", "io::stdout", "stdout("] {
                assert!(
                    !contains_ident_call(&norm, pat),
                    "Forbidden stdout reference '{pat}' in {rel}"
                );
            }
            for ident in ["Stdout", "from_raw_fd"] {
                assert!(
                    !contains_exact_ident(&norm, ident),
                    "Forbidden stdout identifier '{ident}' in {rel}"
                );
            }
        }

        let is_authorized_writer = authorized_disk_write_prefixes
            .iter()
            .any(|prefix| rel.starts_with(prefix));
        if !is_authorized_writer {
            for pat in [
                "fs::write",
                "OpenOptions",
                "File::create",
                "File::options",
                "fs::copy",
                "fs::rename",
                "fs::remove_file",
                "fs::remove_dir",
                "fs::remove_dir_all",
                "fs::create_dir",
                "fs::hard_link",
                "symlink",
            ] {
                assert!(
                    !norm.contains(pat),
                    "Forbidden disk write '{pat}' in {rel}"
                );
            }
        }

        assert!(
            !contains_exact_ident(&norm, "ExecutedOutcome"),
            "Unsealed ExecutedOutcome trait must not exist anywhere ({rel})"
        );
    }
}

#[test]
fn typestate_seal_and_firewall_integrity() {
    let root = workspace_root();

    let typestate = strip_comments(
        &fs::read_to_string(root.join("crates/aice-governance/src/typestate.rs"))
            .expect("read typestate.rs"),
    );
    let gov_block = extract_struct_body(&typestate, "pub struct Governed");
    assert!(gov_block.contains("_sealed: ()"));
    assert!(!gov_block.contains("pub "), "Governed must have zero pub fields");
    assert!(
        !has_derive_clone(&typestate, "pub struct Governed"),
        "Governed must not derive Clone"
    );

    let admin_gov_block = extract_struct_body(&typestate, "pub struct AdminGoverned");
    assert!(admin_gov_block.contains("_sealed: ()"));
    assert!(
        !admin_gov_block.contains("pub "),
        "AdminGoverned must have zero pub fields"
    );
    assert!(
        !has_derive_clone(&typestate, "pub struct AdminGoverned"),
        "AdminGoverned must not derive Clone"
    );

    let req_block = extract_struct_body(&typestate, "pub struct PipelineRequest");
    assert!(
        !req_block.contains("pub "),
        "PipelineRequest<S, Op> must have zero pub fields"
    );

    let state = strip_comments(
        &fs::read_to_string(root.join("crates/aice-pipeline/src/state.rs"))
            .expect("read state.rs"),
    );
    let exec_block = extract_struct_body(&state, "pub struct Executed");
    assert!(exec_block.contains("_sealed: ()"));
    assert!(!exec_block.contains("pub "), "Executed must have zero pub fields");

    let seal = strip_comments(
        &fs::read_to_string(root.join("crates/aice-pipeline/src/seal.rs"))
            .expect("read seal.rs"),
    );
    let metered_block = extract_struct_body(&seal, "pub struct MeteredOutput");
    assert!(metered_block.contains("_sealed: ()"));
    assert!(
        !metered_block.contains("pub "),
        "MeteredOutput must have zero pub fields"
    );

    assert!(
        !root.join("crates/aice-telemetry/src/writer.rs").exists(),
        "aice-telemetry must not contain writer.rs"
    );
    assert!(
        !root.join("crates/aice-telemetry/src/seal.rs").exists(),
        "aice-telemetry must not contain legacy unsealed seal.rs"
    );

    for rel in [
        "crates/aice-lang-registry/src/traits.rs",
        "crates/aice-ast-engine/src/firewall.rs",
    ] {
        let src = fs::read_to_string(root.join(rel)).expect("read firewall source");
        assert!(
            !src.contains("force"),
            "SyntaxFirewall must never accept a force parameter ({rel})"
        );
    }

    let pipeline_lib = normalize_ws(&strip_comments(
        &fs::read_to_string(root.join("crates/aice-pipeline/src/lib.rs"))
            .expect("read aice-pipeline/src/lib.rs"),
    ));
    for flow_mod in [
        "admin_flow",
        "find_flow",
        "read_flow",
        "search_flow",
        "write_flow",
    ] {
        assert!(
            !pipeline_lib.contains(&format!("pub mod {flow_mod}")),
            "aice-pipeline flow module '{flow_mod}' must be private, not pub mod"
        );
    }
    let mut rest = pipeline_lib.as_str();
    while let Some(idx) = rest.find("pub mod ") {
        let after = &rest[idx + "pub mod ".len()..];
        let ident: String = after
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_')
            .collect();
        assert!(
            !ident.ends_with("_flow"),
            "aice-pipeline/src/lib.rs must not expose pub mod {ident}"
        );
        rest = after;
    }
}

#[test]
fn mcp_surface_lock() {
    let root = workspace_root();
    let mcp = fs::read_to_string(root.join("crates/aice-cli/src/mcp_server.rs"))
        .expect("read mcp_server.rs");
    assert!(
        mcp.contains("[\"aice_read\", \"aice_splice\"]"),
        "MCP_EXPOSED_TOOLS must strictly expose [\"aice_read\", \"aice_splice\"]"
    );
    for legacy in [
        "aice_context",
        "aice_outline",
        "aice_idioms",
        "aice_create",
        "aice_gain",
        "aice_project_config",
        "aice_write",
        "aice_read_file",
        "aice_find",
        "aice_search",
        "aice_status",
    ] {
        assert!(
            !mcp.contains(legacy),
            "Legacy hidden MCP tool '{legacy}' must not appear in mcp_server.rs"
        );
    }
}

#[test]
fn watch1_comma_selector_symmetry_and_no_process_spawn() {
    let root = workspace_root();
    let cmd_write = strip_comments(
        &fs::read_to_string(root.join("crates/aice-cli/src/cmd_write.rs"))
            .expect("read cmd_write.rs"),
    );
    assert!(
        cmd_write.contains("has_regex_selector_part"),
        "cmd_write.rs must use has_regex_selector_part for Watch #1 comma-selector symmetry"
    );
    assert!(
        !cmd_write.contains(".starts_with('/')"),
        "cmd_write.rs must not regress to single-part .starts_with('/') selector check"
    );

    let mut files = Vec::new();
    for entry in fs::read_dir(root.join("crates")).expect("read crates").flatten() {
        collect_rs_files(&entry.path().join("src"), &mut files);
    }
    for path in files {
        let rel = path
            .strip_prefix(&root)
            .unwrap_or(&path)
            .to_string_lossy()
            .replace('\\', "/");
        let stripped = normalize_ws(&strip_comments(
            &fs::read_to_string(&path).expect("read source"),
        ));
        assert!(
            !stripped.contains("process::Command"),
            "External process spawn (std::process::Command) is forbidden in {rel}"
        );
    }
}

fn extract_struct_body<'a>(src: &'a str, marker: &str) -> &'a str {
    let start = src.find(marker).expect("struct marker");
    let rest = &src[start..];
    let open = rest.find('{').expect("struct open brace");
    let close = rest[open..].find('}').expect("struct close brace");
    &rest[open + 1..open + close]
}

fn has_derive_clone(src: &str, marker: &str) -> bool {
    let Some(pos) = src.find(marker) else {
        return false;
    };
    let mut rest = src[..pos].trim_end();
    let mut attr_block = String::new();
    while rest.ends_with(']') {
        let Some(open_idx) = rest.rfind("#[") else {
            break;
        };
        attr_block.push_str(&rest[open_idx..]);
        attr_block.push('\n');
        rest = rest[..open_idx].trim_end();
    }
    attr_block.contains("derive") && contains_exact_ident(&attr_block, "Clone")
}
