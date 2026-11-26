use aice_lang_registry::{LanguageId, ParsedTree};

use crate::decompile::csharp;
use crate::decompile::java_lang;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    match tree.language() {
        LanguageId::CSharp => csharp::decompile(tree, src, opts),
        _ => java_lang::decompile(tree, src, opts),
    }
}
