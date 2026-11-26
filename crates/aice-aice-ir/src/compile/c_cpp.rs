use aice_lang_registry::LanguageId;

use crate::compile::c_lang;
use crate::compile::cpp_lang;
use crate::ir::{AiceModule, TranspileError};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::C => c_lang::compile(module),
        _ => cpp_lang::compile(module),
    }
}
