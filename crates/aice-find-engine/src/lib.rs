pub mod fuzzy_rank;
mod fuzzy_score;
mod ignore_paths;
pub mod ignore_rules;
pub mod symbol_rank;
pub mod trigram;
mod utf8_stream;
pub mod walker;
mod walker_classify;
mod walker_pool;
mod walker_probe;
mod walker_queue;
mod walker_seed;

pub use fuzzy_rank::{
    FuzzyMatch, FuzzyResolution, FuzzyResolveOpts, format_did_you_mean, rank_candidates,
    resolve_target, score_candidate,
};
pub use ignore_rules::{
    DEFAULT_IGNORED_DIRS, IgnorePolicy, LOCKFILE_SKIP_NAMES, is_lockfile_name, should_ignore_name,
};
pub use symbol_rank::{
    SymbolFuzzyMatch, SymbolResolution, extract_symbols_via_lookup, format_symbol_suggestions,
    rank_ast_symbols, resolve_ast_symbols, resolve_symbol_via_lookup,
};
pub use walker::{
    DiscoveredFile, FindWalkOpts, WalkOutput, WalkedFile, walk_governed,
    walk_governed_with_opts,
};
pub use walker_classify::count_lines_fast;
