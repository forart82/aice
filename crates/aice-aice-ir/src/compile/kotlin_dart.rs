use aice_lang_registry::LanguageId;

use crate::compile::dart;
use crate::compile::kotlin;
use crate::ir::{AiceModule, TranspileError};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::Kotlin => kotlin::compile(module),
        _ => dart::compile(module),
    }
}
