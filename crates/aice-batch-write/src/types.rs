use std::path::PathBuf;

use aice_lang_registry::LanguageId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchSpliceItem {
    pub file_path: PathBuf,
    pub requested_display: String,
    pub symbol: Option<String>,
    pub payload: String,
    pub force_aice_ir: bool,
    pub delete: bool,
    pub insert_after: Option<String>,
    pub insert_before: Option<String>,
    pub clone_from: Option<String>,
    pub create: bool,
    pub explicit_create_flag: bool,
    pub overwrite: bool,
    pub force: bool,
    pub preserve_docs: bool,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonBatchEdit {
    pub file_path: String,
    pub symbol: String,
    pub start_line: usize,
    pub end_line: usize,
    pub original_snippet: String,
    pub new_snippet: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct JsonSpliceInfo {
    pub success: bool,
    pub file_path: String,
    pub symbol: String,
    pub start_line: usize,
    pub end_line: usize,
    pub original_snippet: String,
    pub new_snippet: String,
    pub modified_code: String,
    pub new_aice_source: String,
    pub preserved_trivia_text: String,
    pub dry_run: bool,
    pub modified_files: Vec<String>,
    pub batch_edits: Vec<JsonBatchEdit>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct BatchWriteReport {
    pub raw_baseline: String,
    pub emitted_output: String,
    pub file_label: String,
    pub exit_code: i32,
    pub multi_files: Vec<String>,
    pub primary_lang: Option<LanguageId>,
    pub realistic_native_payload: Option<String>,
    pub preserved_trivia_text: String,
    pub is_batch_rollback: bool,
    pub banner_needs_tokens: bool,
    pub json_info: Option<JsonSpliceInfo>,
}

#[derive(Debug, Clone)]
pub struct EditSummary {
    pub file_canonical: PathBuf,
    pub file_rel: String,
    pub file_abs: String,
    pub symbol_label: String,
    pub verb: &'static str,
    pub start_line: usize,
    pub end_line: usize,
    pub original_snippet: String,
    pub new_snippet: String,
}

#[derive(Debug, Clone)]
pub struct VirtualFile {
    pub canonical: PathBuf,
    pub display: String,
    pub rel_label: String,
    pub original_disk: Option<String>,
    pub current: String,
    pub existed_on_disk: bool,
    pub eol: &'static str,
    pub replaced_baselines: Vec<String>,
    pub preserved_trivia: Vec<String>,
}

impl VirtualFile {
    pub fn has_changed(&self) -> bool {
        match &self.original_disk {
            Some(orig) => orig != &self.current,
            None => true,
        }
    }
}

pub fn split_lines_keep(src: &str) -> (Vec<String>, bool) {
    let trailing = src.ends_with('\n');
    let mut lines: Vec<String> = src
        .split('\n')
        .map(|l| l.strip_suffix('\r').unwrap_or(l).to_string())
        .collect();
    if trailing && lines.last().is_some_and(String::is_empty) {
        lines.pop();
    }
    if src.is_empty() {
        lines.clear();
    }
    (lines, trailing)
}

pub fn join_lines_keep(lines: &[String], trailing_nl: bool, eol: &str) -> String {
    if lines.is_empty() {
        return String::new();
    }
    let mut out = lines.join(eol);
    if trailing_nl {
        out.push_str(eol);
    }
    out
}

pub fn detect_eol(src: &str) -> &'static str {
    if src.contains("\r\n") { "\r\n" } else { "\n" }
}
