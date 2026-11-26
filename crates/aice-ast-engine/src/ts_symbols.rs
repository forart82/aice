use aice_lang_registry::{
    AstSlice, IntraBlockSelector, OutlineView, ParsedTree, SliceError, SymbolNode, SymbolSelector,
};

pub fn default_extract_symbols(_tree: &ParsedTree, _src: &str) -> Vec<SymbolNode> {
    Vec::new()
}

pub fn default_slice_symbol(
    _tree: &ParsedTree,
    src: &str,
    selector: &SymbolSelector,
) -> Result<AstSlice, SliceError> {
    if selector.name.is_empty() {
        return Err(SliceError {
            message: "Empty symbol selector".to_string(),
        });
    }
    Ok(AstSlice {
        start_line: 1,
        end_line: src.lines().count().max(1),
        content: src.to_string(),
    })
}

pub fn default_slice_intra_block(
    _tree: &ParsedTree,
    src: &str,
    block_sel: &IntraBlockSelector,
) -> Result<AstSlice, SliceError> {
    if block_sel.symbol.is_empty() || block_sel.pattern.is_empty() {
        return Err(SliceError {
            message: "Empty intra-block selector".to_string(),
        });
    }
    Ok(AstSlice {
        start_line: 1,
        end_line: src.lines().count().max(1),
        content: src.to_string(),
    })
}

pub fn default_outline(_tree: &ParsedTree, src: &str) -> OutlineView {
    OutlineView {
        entries: Vec::new(),
        total_lines: src.lines().count(),
    }
}
