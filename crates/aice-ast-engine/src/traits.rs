pub use aice_lang_registry::{
    AdapterLookup, AstSlicer, FirewallDiagnostic, LanguageAdapter, SyntaxFirewall,
};

pub type SyntaxIssue = FirewallDiagnostic;

pub trait AdapterBundle: LanguageAdapter + AstSlicer {}
impl<T: LanguageAdapter + AstSlicer> AdapterBundle for T {}
