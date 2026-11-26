use aice_lang_registry::{LanguageId, ParsedTree};

use crate::decompile::dart;
use crate::decompile::kotlin;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::Kotlin => kotlin::decompile(tree, src, opts),
        _ => dart::decompile(tree, src, opts),
    }
}
