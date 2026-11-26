use aice_lang_registry::{LanguageId, ParsedTree};

use crate::decompile::sql_rd_scan::scan_rd_sql_items;
use crate::decompile::sql_ts::decompile_ansi_sql;
use crate::ir::{AiceModule, TranspileError, TranspileOpts};

pub fn decompile(tree: &ParsedTree, src: &str, opts: &TranspileOpts) -> Result<AiceModule, TranspileError> {
    let lang = tree.language();
    if lang == LanguageId::AnsiSql {
        return decompile_ansi_sql(tree, src, opts);
    }
    let ParsedTree::Rd(rd) = tree else {
        return Err(TranspileError::new("Expected Rd ParsedTree for SQL dialect"));
    };
    let mut m = AiceModule::new(lang, lang.canonical_name());
    let (items, trailing_trivia) = scan_rd_sql_items(lang, &rd.root, src, opts);
    m.items = items;
    m.trailing_trivia = trailing_trivia;
    Ok(m)
}
