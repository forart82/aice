use aice_lang_registry::{LanguageId, ParsedTree};

use crate::decompile::php;
use crate::decompile::ruby;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::Php => php::decompile(tree, src, opts),
        _ => ruby::decompile(tree, src, opts),
    }
}
