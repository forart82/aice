use aice_lang_registry::{LanguageId, ParsedTree};

use crate::compile;
use crate::decompile;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

/// Only LanguageId::PlainText may yield UnsupportedPassthrough (Law 3).
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum TranspileOutcome {
    Transpiled(AiceModule),
    UnsupportedPassthrough { lang: LanguageId, raw_text: String },
}

/// 3. Bidirectional Native <-> AICE IR transformation.
pub trait AiceTranspiler: Send + Sync {
    fn to_aice(
        &self,
        tree: &ParsedTree,
        src: &str,
        opts: &TranspileOpts,
    ) -> Result<TranspileOutcome, TranspileError>;

    fn to_native(
        &self,
        aice: &AiceModule,
        target: LanguageId,
    ) -> Result<String, TranspileError>;
}

#[derive(Debug, Default)]
pub struct DefaultAiceTranspiler;

impl AiceTranspiler for DefaultAiceTranspiler {
    fn to_aice(
        &self,
        tree: &ParsedTree,
        src: &str,
        opts: &TranspileOpts,
    ) -> Result<TranspileOutcome, TranspileError> {
        let lang = tree.language();
        if lang == LanguageId::PlainText {
            return Ok(TranspileOutcome::UnsupportedPassthrough {
                lang,
                raw_text: src.to_string(),
            });
        }
        let module = decompile::decompile_tree(tree, src, opts)?;
        Ok(TranspileOutcome::Transpiled(module))
    }

    fn to_native(&self, aice: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
        compile::compile_module(aice, target)
    }
}
