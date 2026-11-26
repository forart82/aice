use aice_lang_registry::LanguageId;

use crate::compile::csharp;
use crate::compile::java_lang;
use crate::ir::{AiceModule, TranspileError};

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    match target {
        LanguageId::CSharp => csharp::compile(module),
        _ => java_lang::compile(module),
    }
}
