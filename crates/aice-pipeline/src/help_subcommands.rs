pub(crate) fn render_core_subcommand_help(cmd: &str) -> Option<&'static str> {
    match cmd {
        "read" => Some(READ_HELP),
        "search" => Some(SEARCH_HELP),
        "find" => Some(FIND_HELP),
        "splice" => Some(SPLICE_HELP),
        _ => None,
    }
}

const READ_HELP: &str = "\
aice read - Read files, symbols, intra-blocks, or ranges in universal AICE IR

USAGE:
  aice read [OPTIONS] <TARGETS>...
  aice read --files [OPTIONS] [TARGETS]...

ALIASES:
  context, ctx

ARGS:
  <TARGETS>...           Paths, globs, or unified selectors (f:sym, f#Struct::m, f:L1-L50)

OPTIONS:
  --outline              Emit structural AST outline across targets
  --outline-target       Emit outline for the primary target only
  --full                 Expand 120L auto-outline threshold (still emits AICE IR)
  --files                List matched workspace files (optional filter pattern)
  --compact              Compact AICE IR output (default)
  --no-compact           Disable compact formatting in AICE IR
  --no-types             Omit type signatures in outlines
  --deps / --no-deps     Include or exclude dependency-ordered files
  --callers / --no-callers  Include or exclude caller files
  -d, --depth <N>        Dependency traversal depth
  -s, --symbol <SEL>     Selector to slice (symbol, @first, @if/@loop, L10-L45)
  --search <PAT>         Filter targets or match pattern inside read
  -C, --context <N>      Context lines around search matches
  --max-tokens <N>       Water-filling token budget across targets
  --json                 Emit JSON response
  --stats                Print BPE byte/token telemetry footer
  -h, --help             Show this help and exit

SELECTORS:
  file.rs:Sym            Symbol slice (also file.rs#Struct::method)
  file.rs:Sym@first|@1   Overload disambiguation; Sym@<block> for intra-AST focus
  file.rs:L10-L45        1-based inclusive line range
  'file.rs:/pat/'        Regex match inside target (quote regex args)
  file.rs:outline        File structural outline (:imports for imports only)
  f:s1,s2,L10-L20        Comma-separated multi-selectors on one file

EXAMPLES:
  aice read src/lib.rs src/util.rs --deps
  aice read src/engine.rs#Engine::step src/engine.rs:L1-L30 --stats
";

const SEARCH_HELP: &str = "\
aice search - 4-tier ranked search with AICE IR transformation

USAGE:
  aice search [OPTIONS] <PATTERN> [TARGETS]...

ALIASES:
  grep

ARGS:
  <PATTERN>              Literal or /regex/ pattern (use -- before leading '-')
  [TARGETS]...           Files, directories, or globs to search (default: .)

OPTIONS:
  -n, --line-number      Include 1-based line numbers
  -l, --files-with-matches  List matching file paths only
  -C, --context <N>      Context lines around each match
  -s, --symbol <SEL>     Scope search to symbol or selector
  --search <PAT>         Explicit search pattern flag
  --full                 Expand match output threshold
  --max-tokens <N>       Water-filling token budget
  --json                 Emit JSON response
  --stats                Print BPE byte/token telemetry footer
  -h, --help             Show this help and exit

EXAMPLES:
  aice search validateToken src -C 3
  aice search -- --help docs/
";

const FIND_HELP: &str = "\
aice find - Parallel ignore-aware file discovery

USAGE:
  aice find [OPTIONS] [PATTERN] [TARGETS]...

ALIASES:
  tree

ARGS:
  [PATTERN]              Filename, glob, or fuzzy query
  [TARGETS]...           Root directories or paths to search (default: .)

OPTIONS:
  -d, --depth, -L <N>    Maximum directory traversal depth
  --search <PAT>         Explicit filter pattern
  --full                 Include full uncollapsed match list
  --max-tokens <N>       Token budget cap for results
  --json                 Emit JSON response
  -h, --help             Show this help and exit

EXAMPLES:
  aice find -d 2
  aice find '*.rs' crates/
";

const SPLICE_HELP: &str = "\
aice splice - Atomic AST, hunk, range, and multi-file batch write engine

USAGE:
  aice splice [OPTIONS] [PATH] [SYMBOL]
  aice splice --stdin << 'EOF'

ALIASES:
  write

ARGS:
  [PATH]                 Target file path or file:selector
  [SYMBOL]               Target symbol or selector

OPTIONS:
  -f, --file <PATH>      Target file path or file:selector
  -s, --symbol <SEL>     Target symbol, L10-L25, :eof, or :overwrite
  -c, --code <CODE>      Replacement code or <<< === >>> hunk
  -t, --template <CODE>  Code template payload
  -b, --body <CODE>      Replacement body payload
  --from <FILE>          Read replacement payload from file
  --stdin                Read single payload or === file:sel === stream from stdin
  -d, --delete [SEL]     Delete target symbol or line range
  --insert-after <SEL>   Insert payload after selector
  --insert-before <SEL>  Insert payload before selector
  --edits <JSON_OR_FILE> JSON array of edits on one file ('-' for stdin)
  --batch <JSON_OR_FILE> JSON array of multi-file edits ('-' for stdin)
  --create               Allow creating new target files
  --overwrite            Overwrite existing file content
  --force                Allow >25L full overwrite or empty truncation (never skips AST firewall)
  --in-place             Modify files in place (default behavior)
  --no-preserve-docs     Allow replacing attached doc comments
  --dry-run              Validate through pre-write syntax firewall without writing disk
  --diff                 Show unified diff preview
  --json                 Emit JSON response
  -h, --help             Show this help and exit

HEREDOC & HUNKS:
  === path/to/file.rs:Sym ===         Target file + selector header
  === path/to/file.rs:Sym === --delete  Delete target section
  <<< ... === ... >>>                 Contextual search/replace hunk block

EXAMPLES:
  aice splice src/app.rs -s greet -c 'pub fn greet() -> i32 { 42 }'
  aice splice --stdin << 'EOF'
  === src/a.rs:foo ===
  <<<
    let x = 1;
  ===
    let x = 2;
  >>>
  EOF
";
