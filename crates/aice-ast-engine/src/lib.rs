mod dep_callers;
mod dep_callers_bash;
mod dep_callers_bash_abort;
mod dep_callers_bash_abort_bt;
mod dep_callers_bash_abort_case;
mod dep_callers_bash_abort_code;
mod dep_callers_bash_abort_list;
mod dep_callers_bash_ansi;
mod dep_callers_bash_bs;
mod dep_callers_bash_bt;
mod dep_callers_bash_bt_bs;
mod dep_callers_bash_cmd;
mod dep_callers_bash_code;
mod dep_callers_bash_cont;
mod dep_callers_bash_delim;
mod dep_callers_bash_dq;
mod dep_callers_bash_dq_lex;
mod dep_callers_bash_dq_state;
mod dep_callers_bash_dq_step;
mod dep_callers_bash_hd;
mod dep_callers_bash_hd_line;
mod dep_callers_bash_hd_tail;
mod dep_callers_bash_kw;
mod dep_callers_bash_kw_char;
mod dep_callers_bash_lines;
mod dep_callers_bash_mask;
mod dep_callers_bash_param;
mod dep_callers_bash_span;
mod dep_callers_bash_sq;
mod dep_callers_bash_strip;
mod dep_callers_bash_strip_hd;
mod dep_callers_cjs;
mod dep_callers_heredoc;
mod dep_callers_js_lex;
mod dep_callers_js_scan;
mod dep_callers_lang;
mod dep_callers_lang_scan;
mod dep_callers_other;
mod dep_callers_other_ext;
mod dep_callers_other_match;
mod dep_callers_quote;
mod dep_callers_quote_bt;
mod dep_callers_quote_q;
mod dep_callers_quote_step;
mod dep_callers_scan;
mod dep_callers_span;
mod dep_callers_strip;
mod dep_callers_strip_code;
mod dep_callers_tsx_lex;
mod dep_callers_tsx_step;
pub mod dep_graph;
pub mod dep_resolve;
mod dep_resolve_cs;
mod dep_resolve_jvm;
mod dep_resolve_lang;
mod dep_resolve_rust;
mod dep_resolve_rust_idx;
mod dep_tarjan;
pub mod firewall;
mod firewall_delim;
mod firewall_span;
pub mod intra_ast;
mod intra_ast_kinds;
mod intra_ast_match;
mod intra_ast_rd;
mod intra_ast_rd_sql;
mod intra_ast_rd_sql_end;
mod intra_ast_rd_twig;
mod intra_ast_struct;
mod intra_ast_ts;
pub mod r5;
pub mod r6;
pub mod traits;
pub mod ts_pool;
pub mod ts_symbols;

use aice_lang_registry::{AdapterLookup, AstSlicer, LanguageAdapter, LanguageId};

pub use firewall::DefaultSyntaxFirewall;
pub use traits::{AdapterBundle, SyntaxIssue};
pub use ts_pool::{ALL_GRAMMAR_SLOTS, GrammarSlot, ParserPool, parse_slot, parse_tree_sitter};

pub struct EngineRegistry {
    adapters: Vec<Box<dyn AdapterBundle>>,
}

impl Default for EngineRegistry {
    fn default() -> Self {
        Self::new()
    }
}

impl EngineRegistry {
    pub fn new() -> Self {
        let mut adapters = r5::all_adapters();
        adapters.extend(r6::all_adapters());
        Self { adapters }
    }
}

impl AdapterLookup for EngineRegistry {
    fn adapter(&self, lang: LanguageId) -> Option<&dyn LanguageAdapter> {
        self.adapters
            .iter()
            .find(|a| a.id() == lang)
            .map(|a| a.as_ref() as &dyn LanguageAdapter)
    }

    fn slicer(&self, lang: LanguageId) -> Option<&dyn AstSlicer> {
        self.adapters
            .iter()
            .find(|a| a.id() == lang)
            .map(|a| a.as_ref() as &dyn AstSlicer)
    }
}
