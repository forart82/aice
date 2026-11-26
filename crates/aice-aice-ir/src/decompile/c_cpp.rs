use aice_lang_registry::{LanguageId, ParsedTree};

use crate::decompile::c_lang;
use crate::decompile::cpp_lang;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::C => c_lang::decompile(tree, src, opts),
        _ => cpp_lang::decompile(tree, src, opts),
    }
}
