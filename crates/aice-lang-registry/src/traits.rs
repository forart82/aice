use std::path::Path;

use crate::ast_dto::{
    AstSlice, DepEdge, FirewallVerdict, IntraBlockSelector, OutlineView, ParseError, SliceError,
    SymbolNode, SymbolSelector,
};
use crate::cst::ParsedTree;
use crate::lang_id::LanguageId;

/// 1. Language identity, CST parsing, and symbol/dependency extraction.
pub trait LanguageAdapter: Send + Sync {
    fn id(&self) -> LanguageId;
    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError>;
    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode>;
    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge>;
}

/// 2. Granular AST & intra-function control-flow/CTE slicing.
pub trait AstSlicer: Send + Sync {
    fn slice_symbol(
        &self,
        tree: &ParsedTree,
        src: &str,
        selector: &SymbolSelector,
    ) -> Result<AstSlice, SliceError>;

    fn slice_intra_block(
        &self,
        tree: &ParsedTree,
        src: &str,
        block_sel: &IntraBlockSelector,
    ) -> Result<AstSlice, SliceError>;

    fn outline(
        &self,
        tree: &ParsedTree,
        src: &str,
        depth: usize,
        include_types: bool,
    ) -> OutlineView;
}

/// 4. Pre-write syntax & structural verification firewall.
///
/// Intentionally accepts NO bypass parameter (closes B-W1 at the type level).
pub trait SyntaxFirewall: Send + Sync {
    fn verify(
        &self,
        candidate_native: &str,
        path: &Path,
        lang: LanguageId,
    ) -> FirewallVerdict;

    fn verify_incremental(
        &self,
        baseline_native: Option<&str>,
        candidate_native: &str,
        path: &Path,
        lang: LanguageId,
    ) -> FirewallVerdict;
}

/// Adapter lookup abstraction so Layer 2 crates avoid depending on grammar crates directly.
pub trait AdapterLookup: Send + Sync {
    fn adapter(&self, lang: LanguageId) -> Option<&dyn LanguageAdapter>;
    fn slicer(&self, lang: LanguageId) -> Option<&dyn AstSlicer>;
}
