use aice_lang_registry::LanguageId;

use crate::compile::php;
use crate::compile::ruby;
use crate::ir::{AiceModule, TranspileError};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::Php => php::compile(module),
        _ => ruby::compile(module),
    }
}
