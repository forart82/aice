use aice_find_engine::trigram::{
    extract_boundary_initials, levenshtein_distance, levenshtein_similarity,
    padded_trigram_similarity, subsequence_boundary_score, trigram_similarity, trigrams,
};
use aice_find_engine::{
    FuzzyResolution, FuzzyResolveOpts, SymbolResolution, extract_symbols_via_lookup,
    format_did_you_mean, format_symbol_suggestions, rank_ast_symbols, rank_candidates,
    resolve_ast_symbols, resolve_symbol_via_lookup, resolve_target, score_candidate,
};
use aice_lang_registry::{
    AdapterLookup, AstSlicer, DepEdge, LanguageAdapter, LanguageId, ParseError, ParsedTree,
    SymbolKind, SymbolNode,
};

struct MockRustAdapter;

impl LanguageAdapter for MockRustAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Rust
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        Ok(ParsedTree::PlainText {
            line_count: src.lines().count(),
        })
    }

    fn extract_symbols(&self, _tree: &ParsedTree, _src: &str) -> Vec<SymbolNode> {
        vec![
            SymbolNode {
                name: "Calculator".into(),
                qualified_name: "Calculator".into(),
                kind: SymbolKind::Struct,
                start_line: 1,
                end_line: 5,
                start_byte: 0,
                end_byte: 50,
                signature: Some("pub struct Calculator".into()),
            },
            SymbolNode {
                name: "add".into(),
                qualified_name: "Calculator::add".into(),
                kind: SymbolKind::Method,
                start_line: 7,
                end_line: 10,
                start_byte: 51,
                end_byte: 100,
                signature: Some("pub fn add(&self, a: i32, b: i32) -> i32".into()),
            },
            SymbolNode {
                name: "multiply".into(),
                qualified_name: "Calculator::multiply".into(),
                kind: SymbolKind::Method,
                start_line: 12,
                end_line: 15,
                start_byte: 101,
                end_byte: 160,
                signature: Some("pub fn multiply(&self, a: i32, b: i32) -> i32".into()),
            },
            SymbolNode {
                name: "run_batch_pipeline".into(),
                qualified_name: "run_batch_pipeline".into(),
                kind: SymbolKind::Function,
                start_line: 17,
                end_line: 25,
                start_byte: 161,
                end_byte: 250,
                signature: Some("pub fn run_batch_pipeline()".into()),
            },
        ]
    }

    fn extract_dependencies(&self, _tree: &ParsedTree, _src: &str) -> Vec<DepEdge> {
        Vec::new()
    }
}

struct MockLookup {
    rust: MockRustAdapter,
}

impl AdapterLookup for MockLookup {
    fn adapter(&self, lang: LanguageId) -> Option<&dyn LanguageAdapter> {
        match lang {
            LanguageId::Rust => Some(&self.rust),
            _ => None,
        }
    }

    fn slicer(&self, _lang: LanguageId) -> Option<&dyn AstSlicer> {
        None
    }
}

#[test]
fn trigram_levenshtein_and_subsequence_primitives() {
    assert!(trigrams("ab").is_empty());
    assert_eq!(trigram_similarity("ab", "abc"), 0.0);
    assert!(padded_trigram_similarity("fn", "fn_walk") > 0.15);
    assert_eq!(levenshtein_distance("kitten", "sitting"), 3);
    assert!(levenshtein_similarity("worker", "wroker") > 0.5);
    assert_eq!(extract_boundary_initials("runBatchPipeline"), "rbp");
    assert_eq!(extract_boundary_initials("find_walk"), "fw");
    assert!(subsequence_boundary_score("rBP", "runBatchPipeline") >= 0.80);
    assert!(subsequence_boundary_score("f_wlk", "find_walk") > 0.55);
}

#[test]
fn cutoff_guard_rejects_unrelated_queries() {
    let candidates: Vec<String> = [
        "src/alpha.rs",
        "src/beta.rs",
        "src/gamma.rs",
        "src/delta.rs",
        "src/needle.rs",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    let ranked = rank_candidates("definitely_absent_token_xyz", &candidates);
    assert!(
        ranked.iter().all(|m| m.score == 0.0),
        "unrelated query must score 0.0: {ranked:?}"
    );
    assert_eq!(
        resolve_target("definitely_absent_token_xyz", &candidates, &FuzzyResolveOpts::default()),
        FuzzyResolution::NotFound
    );
}

#[test]
fn short_queries_typos_acronyms_and_auto_resolve() {
    let candidates: Vec<String> = [
        "src/engine.rs",
        "src/worker.py",
        "src/user_id.rs",
        "src/runBatchPipeline.ts",
        "src/user_read.rs",
        "src/user_write.rs",
    ]
    .into_iter()
    .map(String::from)
    .collect();

    // Short <3-char query
    let id_ranked = rank_candidates("id", &candidates);
    assert_eq!(id_ranked[0].target, "src/user_id.rs");
    assert!(id_ranked[0].score > 0.5);

    // Basename typo
    let w_ranked = rank_candidates("wroker", &candidates);
    assert_eq!(w_ranked[0].target, "src/worker.py");
    assert!(w_ranked[0].score >= 0.25);

    // Path typo
    let e_ranked = rank_candidates("engnie.rs", &candidates);
    assert_eq!(e_ranked[0].target, "src/engine.rs");
    assert!(e_ranked[0].score > 0.5);

    // CamelCase acronym
    let rbp_ranked = rank_candidates("rBP", &candidates);
    assert_eq!(rbp_ranked[0].target, "src/runBatchPipeline.ts");
    assert!(rbp_ranked[0].score > 0.35);

    // Unambiguous high-confidence auto-resolve
    let res = resolve_target("engine.rs", &candidates, &FuzzyResolveOpts::default());
    assert!(matches!(res, FuzzyResolution::AutoResolved { ref target, .. } if target == "src/engine.rs"));

    // Ambiguous close tie returns <= 5 compact suggestions
    let amb = resolve_target("user_", &candidates, &FuzzyResolveOpts::default());
    match amb {
        FuzzyResolution::Ambiguous(list) => {
            assert!(list.len() <= 5 && list.len() >= 2);
            let msg = format_did_you_mean(&list, false);
            assert!(msg.starts_with("\nDid you mean: "));
            assert!(msg.contains("src/user_read.rs"));
        }
        other => panic!("expected Ambiguous, got {other:?}"),
    }

    assert!(score_candidate("Calcualtor.add", "Calculator.add") > 0.6);
}

#[test]
fn ast_symbol_fuzzy_guessing_via_adapter_lookup() {
    let lookup = MockLookup {
        rust: MockRustAdapter,
    };
    let src = "pub struct Calculator {}\n";

    // PlainText returns empty cleanly with zero panic or regex fallback
    assert!(extract_symbols_via_lookup(&lookup, LanguageId::PlainText, src).is_empty());
    assert_eq!(
        resolve_symbol_via_lookup(&lookup, LanguageId::PlainText, src, "Calculator"),
        SymbolResolution::NotFound
    );

    // Dot vs :: normalization resolves Calculator.add -> Calculator::add
    match resolve_symbol_via_lookup(&lookup, LanguageId::Rust, src, "Calculator.add") {
        SymbolResolution::Exact(sym) => assert_eq!(sym.qualified_name, "Calculator::add"),
        other => panic!("expected Exact match, got {other:?}"),
    }

    // Typo auto-resolves Calculator::multply -> Calculator::multiply
    match resolve_symbol_via_lookup(&lookup, LanguageId::Rust, src, "Calculator::multply") {
        SymbolResolution::AutoResolved { symbol, .. } => {
            assert_eq!(symbol.qualified_name, "Calculator::multiply");
        }
        other => panic!("expected AutoResolved, got {other:?}"),
    }

    // Ambiguous/partial ranking
    let syms = extract_symbols_via_lookup(&lookup, LanguageId::Rust, src);
    let ranked = rank_ast_symbols("Calc", &syms);
    assert!(!ranked.is_empty());
    let hint = format_symbol_suggestions(&ranked, false);
    assert!(hint.contains("Calculator [L1-L5]"));
    assert!(!hint.contains("[AICE AST Fallback]"));
}

#[test]
fn zero_overlap_short_queries_return_not_found_and_honors_min_score() {
    let opts = FuzzyResolveOpts::default();
    assert_eq!(resolve_target("a", &["b".into()], &opts), FuzzyResolution::NotFound);
    assert_eq!(resolve_target("ab", &["cd".into()], &opts), FuzzyResolution::NotFound);
    assert_eq!(
        resolve_target("xyz", &["src/abc".into(), "src/def".into()], &opts),
        FuzzyResolution::NotFound
    );
    assert_eq!(resolve_target("foo", &["src/bar".into()], &opts), FuzzyResolution::NotFound);

    // Single-edit 2-char typo passes default threshold but respects higher suggest_min_score
    let tight = FuzzyResolveOpts {
        suggest_min_score: 0.90,
        ..FuzzyResolveOpts::default()
    };
    assert_eq!(resolve_target("ab", &["ac".into()], &tight), FuzzyResolution::NotFound);
}

#[test]
fn exact_case_precedence_unicode_case_folding_and_symbol_trimming() {
    let opts = FuzzyResolveOpts::default();

    // Unique 1.0 case-sensitive match beats 0.98 case-insensitive match
    assert_eq!(
        resolve_target("src/foo.rs", &["src/foo.rs".into(), "src/FOO.rs".into()], &opts),
        FuzzyResolution::Exact("src/foo.rs".into())
    );

    // Unicode case folding across trigrams and resolve_target
    assert!((trigram_similarity("CAFÉ", "café") - 1.0).abs() < 1e-9);
    assert_eq!(
        resolve_target("CAFÉ", &["café".into()], &opts),
        FuzzyResolution::Exact("café".into())
    );

    // AST symbol exact 1.0 precedence and whitespace trimming
    let lookup = MockLookup {
        rust: MockRustAdapter,
    };
    let src = "pub struct Calculator {}\n";
    match resolve_symbol_via_lookup(&lookup, LanguageId::Rust, src, "  Calculator::add  ") {
        SymbolResolution::Exact(sym) => assert_eq!(sym.qualified_name, "Calculator::add"),
        other => panic!("expected Exact after trim, got {other:?}"),
    }

    let case_syms = vec![
        SymbolNode {
            name: "parse".into(),
            qualified_name: "parse".into(),
            kind: SymbolKind::Function,
            start_line: 1,
            end_line: 3,
            start_byte: 0,
            end_byte: 20,
            signature: None,
        },
        SymbolNode {
            name: "Parse".into(),
            qualified_name: "Parse".into(),
            kind: SymbolKind::Struct,
            start_line: 5,
            end_line: 8,
            start_byte: 21,
            end_byte: 50,
            signature: None,
        },
    ];
    match resolve_ast_symbols("parse", &case_syms, &opts) {
        SymbolResolution::Exact(sym) => assert_eq!(sym.qualified_name, "parse"),
        other => panic!("expected Exact(parse) over 0.98 Parse, got {other:?}"),
    }
}
