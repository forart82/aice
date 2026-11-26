use crate::help_subcommands::render_core_subcommand_help;

const ALL_COMMANDS_FOOTER: &str =
    "\nALL COMMANDS: read | search | find | splice | enable | disable | config | agents | gain | analyze | mcp | benchmark\n";

pub(crate) fn render_help() -> String {
    concat!(
        "aice ",
        env!("CARGO_PKG_VERSION"),
        " - AI Co-Engine\n\n",
        "USAGE:\n",
        "  aice <COMMAND> [OPTIONS]\n\n",
        "GLOBAL FLAGS:\n",
        "  -V, --version  Print version and exit\n",
        "  -h, --help     Print help and exit\n",
        "  --color        Force ANSI colors\n",
        "  --no-color     Disable ANSI colors\n\n",
        "COMMANDS:\n",
        "  read       (context, ctx)          Read files, symbols, intra-blocks, or ranges in AICE IR\n",
        "  search     (grep)                  4-tier ranked search with AICE transformation\n",
        "  find       (tree)                  Parallel file & symbol discovery\n",
        "  splice     (write)                 Atomic AST/hunk/range write & batch splice\n",
        "  enable                             Enable AICE in aice.config.json\n",
        "  disable                            Disable AICE in aice.config.json\n",
        "  config     (status)                Inspect or update project configuration\n",
        "  agents                             Configure MCP and agent integration rules\n",
        "  gain       (gains, stats, telemetry)  Show honest BPE tokenomics ledger\n",
        "  analyze                            Cross-verify telemetry against transcripts\n",
        "  mcp                                Start strict 2-tool stdio MCP server\n",
        "  benchmark  (bench)                 Run multi-language tokenomics benchmark\n\n",
        "SELECTORS:\n",
        "  file:Sym | file#Struct::method | Sym@first|@1 | Sym@<block> | file:L10-L45\n",
        "  'file:/regex/' | :outline | :imports | :eof | :overwrite | f:s1,s2,L1-L20\n\n",
        "BATCH STREAM:\n",
        "  aice splice --stdin << 'EOF'  (=== file:sel ===, --delete, <<< ... === ... >>>)\n\n",
        "Run 'aice <COMMAND> --help' for command options and examples.\n",
    )
    .to_string()
}

pub(crate) fn render_subcommand_help(cmd: &str) -> String {
    if let Some(body) = render_core_subcommand_help(cmd) {
        return format!("{body}{ALL_COMMANDS_FOOTER}");
    }
    let body = match cmd {
        "enable" => ENABLE_HELP,
        "disable" => DISABLE_HELP,
        "config" => CONFIG_HELP,
        "agents" => AGENTS_HELP,
        "gain" => GAIN_HELP,
        "analyze" => ANALYZE_HELP,
        "mcp" => MCP_HELP,
        "benchmark" => BENCHMARK_HELP,
        _ => return render_help(),
    };
    format!("{body}{ALL_COMMANDS_FOOTER}")
}

const ENABLE_HELP: &str = "\
aice enable - Enable AICE in aice.config.json and sync AGENTS.md

USAGE:
  aice enable [OPTIONS] [DIR]

ARGS:
  [DIR]                  Target project directory (default: .)

OPTIONS:
  -f, --force            Overwrite AGENTS.md even if > 22 KB cap
  --json                 Emit JSON status report
  -h, --help             Show this help and exit
";

const DISABLE_HELP: &str = "\
aice disable - Disable AICE in aice.config.json

USAGE:
  aice disable [OPTIONS] [DIR]

ARGS:
  [DIR]                  Target project directory (default: .)

OPTIONS:
  --json                 Emit JSON status report
  -h, --help             Show this help and exit
";

const CONFIG_HELP: &str = "\
aice config - Inspect or update project configuration

USAGE:
  aice config [OPTIONS] [DIR]

ALIASES:
  status

ARGS:
  [DIR]                  Target project directory (default: .)

OPTIONS:
  --enable               Set \"enabled\": true and sync AGENTS.md
  --disable              Set \"enabled\": false
  -f, --force            Force AGENTS.md sync when combined with --enable
  --json                 Emit JSON status report
  -h, --help             Show this help and exit
";

const AGENTS_HELP: &str = "\
aice agents - Configure MCP and agent integration rules

USAGE:
  aice agents [ACTION] [OPTIONS]

ARGS:
  [ACTION]               status (list), setup (install), or remove (uninstall) [default: status]

OPTIONS:
  -a, --agent <NAME>     Target one agent (claude, agy, gemini, codex, opencode, aider, goose, cursor)
  --all                  Apply to all supported agents
  --global-rules         Include global agent markdown rules
  --json                 Emit JSON status report
  -h, --help             Show this help and exit
";

const GAIN_HELP: &str = "\
aice gain - Show honest signed BPE tokenomics ledger

USAGE:
  aice gain [OPTIONS] [PROJECT]

ALIASES:
  gains, stats, telemetry

ARGS:
  [PROJECT]              Optional project name or path filter

OPTIONS:
  -p, --project <VAL>    Filter by project path or name
  --unique               Count unique files only
  --all                  Include full per-project breakdown
  -i, --interactive      Enable interactive formatting
  --json                 Emit JSON telemetry report
  --reset                Reset telemetry history (requires -y/--yes)
  -y, --yes              Confirm telemetry reset
  -h, --help             Show this help and exit
";

const ANALYZE_HELP: &str = "\
aice analyze - Cross-verify telemetry ledger against session transcripts

USAGE:
  aice analyze [OPTIONS] [PROJECT]

ARGS:
  [PROJECT]              Optional project name or path filter

OPTIONS:
  -p, --project <VAL>    Filter by project path or name
  --transcripts-dir <D>  Explicit directory containing session transcripts
  --json                 Emit JSON analysis report
  -h, --help             Show this help and exit
";

const MCP_HELP: &str = "\
aice mcp - Start strict 2-tool stdio JSON-RPC 2.0 MCP server

USAGE:
  aice mcp [OPTIONS]

OPTIONS:
  --generate-schemas [DIR]  Write aice_read.json, aice_splice.json, tools.json
                            (default: ${AICE_AGENT_HOME:-$HOME}/.gemini/antigravity-cli/mcp/aice)
  -h, --help                Show this help and exit

MCP TOOLS:
  aice_read, aice_splice
";

const BENCHMARK_HELP: &str = "\
aice benchmark - Run in-process multi-language AICE IR & BPE benchmark suite

USAGE:
  aice benchmark [OPTIONS]

ALIASES:
  bench

OPTIONS:
  --json                 Emit JSON benchmark report
  --markdown             Emit GitHub-flavored Markdown report
  -h, --help             Show this help and exit
";
