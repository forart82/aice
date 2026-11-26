use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Mutex, OnceLock};
use std::time::SystemTime;

use aice_ast_engine::EngineRegistry;
use aice_ast_engine::dep_graph::FileDepInput;
use aice_governance::binary_probe::{DEFAULT_MAX_TEXT_FILE_BYTES, is_binary_extension};
use aice_lang_registry::{AdapterLookup, DepEdge, LanguageId, SymbolNode, detect_language};

const MAX_CACHE_ENTRIES: usize = 16_384;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
struct FileStamp {
    mtime: Option<SystemTime>,
    byte_len: u64,
    inode: u64,
}

#[derive(Clone)]
struct CachedDepEntry {
    stamp: FileStamp,
    parsed: Option<ParsedDepData>,
}

#[derive(Clone)]
struct ParsedDepData {
    lang: LanguageId,
    symbols: Vec<SymbolNode>,
    edges: Vec<DepEdge>,
}

#[derive(Default)]
struct DepCacheState {
    entries: HashMap<PathBuf, CachedDepEntry>,
    hits: usize,
    misses: usize,
}

static DEP_CACHE: OnceLock<Mutex<DepCacheState>> = OnceLock::new();

fn cache_lock() -> &'static Mutex<DepCacheState> {
    DEP_CACHE.get_or_init(|| Mutex::new(DepCacheState::default()))
}

fn file_stamp(meta: &std::fs::Metadata) -> FileStamp {
    #[cfg(unix)]
    let inode = {
        use std::os::unix::fs::MetadataExt;
        meta.ino()
    };
    #[cfg(not(unix))]
    let inode = 0;
    FileStamp {
        mtime: meta.modified().ok(),
        byte_len: meta.len(),
        inode,
    }
}

pub fn get_or_parse_dep_input(
    rel: &str,
    abs: &Path,
    registry: &EngineRegistry,
) -> Option<FileDepInput> {
    if is_binary_extension(abs) {
        return None;
    }
    let meta = std::fs::metadata(abs).ok()?;
    if !meta.is_file() || meta.len() > DEFAULT_MAX_TEXT_FILE_BYTES {
        return None;
    }
    let stamp = file_stamp(&meta);
    let key = abs.to_path_buf();

    {
        let mut guard = cache_lock().lock().unwrap_or_else(|e| e.into_inner());
        if let Some(entry) = guard.entries.get(&key)
            && entry.stamp == stamp
        {
            let parsed = entry.parsed.clone();
            guard.hits += 1;
            return parsed.map(|d| FileDepInput {
                path: rel.to_string(),
                lang: d.lang,
                symbols: d.symbols,
                edges: d.edges,
            });
        }
        guard.misses += 1;
    }

    let parsed = parse_dep_data(abs, registry);
    {
        let mut guard = cache_lock().lock().unwrap_or_else(|e| e.into_inner());
        if guard.entries.len() >= MAX_CACHE_ENTRIES && !guard.entries.contains_key(&key) {
            guard.entries.clear();
        }
        guard.entries.insert(key, CachedDepEntry { stamp, parsed: parsed.clone() });
    }

    parsed.map(|d| FileDepInput {
        path: rel.to_string(),
        lang: d.lang,
        symbols: d.symbols,
        edges: d.edges,
    })
}

fn parse_dep_data(abs: &Path, registry: &EngineRegistry) -> Option<ParsedDepData> {
    let src = std::fs::read_to_string(abs).ok()?;
    if src.as_bytes().contains(&0) {
        return None;
    }
    let lang = detect_language(abs, &src);
    if lang == LanguageId::PlainText {
        return Some(ParsedDepData { lang, symbols: Vec::new(), edges: Vec::new() });
    }
    let adapter = registry.adapter(lang)?;
    let tree = adapter.parse_cst(&src).ok()?;
    let symbols = adapter.extract_symbols(&tree, &src);
    let edges = adapter.extract_dependencies(&tree, &src);
    Some(ParsedDepData { lang, symbols, edges })
}

pub fn dep_cache_stats() -> (usize, usize) {
    let guard = cache_lock().lock().unwrap_or_else(|e| e.into_inner());
    (guard.hits, guard.misses)
}

pub fn clear_dep_cache() {
    let mut guard = cache_lock().lock().unwrap_or_else(|e| e.into_inner());
    guard.entries.clear();
    guard.hits = 0;
    guard.misses = 0;
}
