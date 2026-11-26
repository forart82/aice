use std::time::Instant;

use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::EngineRegistry;
use aice_governance::{AdminGoverned, escape_json_str};
use aice_lang_registry::{AdapterLookup, LanguageId};
use aice_telemetry::count_both;

use crate::admin_flow::seal_simple;
use crate::state::{Executed, PipelineError, PipelineResult};

struct BenchSample {
    name: &'static str,
    lang: LanguageId,
    source: &'static str,
}

struct BenchRow {
    name: &'static str,
    lang: &'static str,
    raw_bytes: usize,
    aice_bytes: usize,
    raw_cl100k: usize,
    aice_cl100k: usize,
    raw_o200k: usize,
    aice_o200k: usize,
    elapsed_ms: f64,
}

const SAMPLES: &[BenchSample] = &[
    BenchSample {
        name: "api_client.ts",
        lang: LanguageId::TypeScript,
        source: "export interface Order { id: string; cents: number; }\nexport async function fetchOrder(baseUrl: string, id: string): Promise<Order> {\n  if (!id.trim()) { throw new Error('missing id'); }\n  const res = await fetch(`${baseUrl}/orders/${id}`);\n  return (await res.json()) as Order;\n}\n",
    },
    BenchSample {
        name: "bucket.rs",
        lang: LanguageId::Rust,
        source: "pub struct Bucket { pub tokens: u64, pub cap: u64 }\nimpl Bucket {\n    pub fn acquire(&mut self, cost: u64) -> bool {\n        if cost > self.tokens { return false; }\n        self.tokens -= cost;\n        true\n    }\n}\n",
    },
    BenchSample {
        name: "dispatch.py",
        lang: LanguageId::Python,
        source: "def dispatch_batch(jobs: list[dict[str, str]]) -> int:\n    processed = 0\n    for job in jobs:\n        if job.get('enabled') == 'true':\n            processed += 1\n    return processed\n",
    },
    BenchSample {
        name: "handler.go",
        lang: LanguageId::Go,
        source: "package ledger\n\ntype Entry struct { ID string; Amount int64 }\n\nfunc NetTotal(items []Entry) int64 {\n\tvar sum int64\n\tfor _, it := range items {\n\t\tsum += it.Amount\n\t}\n\treturn sum\n}\n",
    },
    BenchSample {
        name: "grid.cpp",
        lang: LanguageId::Cpp,
        source: "#include <vector>\nstruct Grid { int width; int step(const std::vector<int>& cells) const { int acc = 0; for (int c : cells) { acc += c; } return acc + width; } };\n",
    },
    BenchSample {
        name: "Settlement.java",
        lang: LanguageId::Java,
        source: "public class Settlement {\n    public long settle(long gross, long feeBps) {\n        long fee = (gross * feeBps) / 10000L;\n        return gross - fee;\n    }\n}\n",
    },
    BenchSample {
        name: "release.sh",
        lang: LanguageId::Bash,
        source: "#!/usr/bin/env bash\ndeploy_service() {\n  local env_name=\"${1:-prod}\"\n  if [[ -z \"$env_name\" ]]; then return 1; fi\n  printf 'deploy=%s\\n' \"$env_name\"\n}\n",
    },
    BenchSample {
        name: "service.json",
        lang: LanguageId::Json,
        source: "{\n  \"service\": \"aice-worker\",\n  \"replicas\": 3,\n  \"limits\": { \"memoryMb\": 512, \"timeoutMs\": 2500 }\n}\n",
    },
    BenchSample {
        name: "ledger_pg.sql",
        lang: LanguageId::PostgreSql,
        source: "CREATE TABLE accounts (id BIGINT PRIMARY KEY, balance_cents BIGINT NOT NULL);\nCREATE VIEW active_accounts AS SELECT id, balance_cents FROM accounts WHERE balance_cents > 0;\n",
    },
    BenchSample {
        name: "schema.graphql",
        lang: LanguageId::GraphQl,
        source: "type Account { id: ID! balanceCents: Int! }\ntype Query { account(id: ID!): Account }\n",
    },
    BenchSample {
        name: "notes.md",
        lang: LanguageId::Markdown,
        source: "# Architecture Overview\n\n## Pipeline\n- Authorize request\n- Transform AST to AICE IR\n",
    },
    BenchSample {
        name: "index.html",
        lang: LanguageId::Html,
        source: "<section class=\"card\"><h1>Status</h1><p>Healthy</p></section>\n",
    },
];

fn pct_saved(raw: usize, aice: usize) -> f64 {
    if raw == 0 {
        return 0.0;
    }
    ((raw as f64 - aice as f64) / raw as f64) * 100.0
}

fn measure_samples() -> Result<Vec<BenchRow>, String> {
    let registry = EngineRegistry::new();
    let transpiler = DefaultAiceTranspiler;
    let opts = TranspileOpts::default();
    let mut rows = Vec::with_capacity(SAMPLES.len());

    for sample in SAMPLES {
        let adapter = registry
            .adapter(sample.lang)
            .ok_or_else(|| format!("missing adapter for {}", sample.lang.canonical_name()))?;
        let t0 = Instant::now();
        let tree = adapter
            .parse_cst(sample.source)
            .map_err(|e| format!("parse failed for {}: {e}", sample.name))?;
        let aice_out = match transpiler
            .to_aice(&tree, sample.source, &opts)
            .map_err(|e| format!("transpile failed for {}: {e}", sample.name))?
        {
            TranspileOutcome::Transpiled(module) => print_aice(&module),
            TranspileOutcome::UnsupportedPassthrough { raw_text, .. } => raw_text,
        };
        let elapsed_ms = t0.elapsed().as_secs_f64() * 1000.0;
        let raw_bpe = count_both(sample.source);
        let aice_bpe = count_both(&aice_out);
        rows.push(BenchRow {
            name: sample.name,
            lang: sample.lang.canonical_name(),
            raw_bytes: sample.source.len(),
            aice_bytes: aice_out.len(),
            raw_cl100k: raw_bpe.cl100k,
            aice_cl100k: aice_bpe.cl100k,
            raw_o200k: raw_bpe.o200k,
            aice_o200k: aice_bpe.o200k,
            elapsed_ms,
        });
    }
    Ok(rows)
}

fn format_json(rows: &[BenchRow]) -> String {
    let (mut rb, mut ab, mut r1, mut a1, mut r2, mut a2, mut ms) = (0, 0, 0, 0, 0, 0, 0.0);
    for r in rows {
        rb += r.raw_bytes;
        ab += r.aice_bytes;
        r1 += r.raw_cl100k;
        a1 += r.aice_cl100k;
        r2 += r.raw_o200k;
        a2 += r.aice_o200k;
        ms += r.elapsed_ms;
    }
    let mut out = String::from("{\n  \"status\": \"ok\",\n  \"suite\": \"benchmark\",\n  \"version\": ");
    escape_json_str(env!("CARGO_PKG_VERSION"), &mut out);
    out.push_str(&format!(
        ",\n  \"totals\": {{\n    \"cases\": {},\n    \"rawBytes\": {rb},\n    \"aiceBytes\": {ab},\n    \"rawCl100k\": {r1},\n    \"aiceCl100k\": {a1},\n    \"savedCl100k\": {},\n    \"savedCl100kPct\": {:.2},\n    \"rawO200k\": {r2},\n    \"aiceO200k\": {a2},\n    \"savedO200k\": {},\n    \"savedO200kPct\": {:.2},\n    \"elapsedMs\": {ms:.3}\n  }},\n  \"cases\": [\n",
        rows.len(),
        r1 as isize - a1 as isize,
        pct_saved(r1, a1),
        r2 as isize - a2 as isize,
        pct_saved(r2, a2),
    ));
    for (idx, r) in rows.iter().enumerate() {
        out.push_str("    {\"name\": ");
        escape_json_str(r.name, &mut out);
        out.push_str(", \"lang\": ");
        escape_json_str(r.lang, &mut out);
        out.push_str(&format!(
            ", \"rawBytes\": {}, \"aiceBytes\": {}, \"rawCl100k\": {}, \"aiceCl100k\": {}, \"savedCl100k\": {}, \"rawO200k\": {}, \"aiceO200k\": {}, \"savedO200k\": {}, \"elapsedMs\": {:.3}}}",
            r.raw_bytes,
            r.aice_bytes,
            r.raw_cl100k,
            r.aice_cl100k,
            r.raw_cl100k as isize - r.aice_cl100k as isize,
            r.raw_o200k,
            r.aice_o200k,
            r.raw_o200k as isize - r.aice_o200k as isize,
            r.elapsed_ms,
        ));
        if idx + 1 < rows.len() {
            out.push(',');
        }
        out.push('\n');
    }
    out.push_str("  ]\n}\n");
    out
}

fn format_markdown(rows: &[BenchRow]) -> String {
    let mut out = format!(
        "# AICE Benchmark (v{})\n\n| Case | Language | Raw Bytes | AICE Bytes | cl100k (Raw -> AICE) | o200k (Raw -> AICE) | Time (ms) |\n|---|---|---:|---:|---:|---:|---:|\n",
        env!("CARGO_PKG_VERSION")
    );
    let (mut rb, mut ab, mut r1, mut a1, mut r2, mut a2, mut ms) = (0, 0, 0, 0, 0, 0, 0.0);
    for r in rows {
        rb += r.raw_bytes;
        ab += r.aice_bytes;
        r1 += r.raw_cl100k;
        a1 += r.aice_cl100k;
        r2 += r.raw_o200k;
        a2 += r.aice_o200k;
        ms += r.elapsed_ms;
        out.push_str(&format!(
            "| {} | {} | {} | {} | {} -> {} ({:+.1}%) | {} -> {} ({:+.1}%) | {:.2} |\n",
            r.name, r.lang, r.raw_bytes, r.aice_bytes, r.raw_cl100k, r.aice_cl100k,
            pct_saved(r.raw_cl100k, r.aice_cl100k), r.raw_o200k, r.aice_o200k,
            pct_saved(r.raw_o200k, r.aice_o200k), r.elapsed_ms
        ));
    }
    out.push_str(&format!(
        "| **Total** | {} langs | {rb} | {ab} | {r1} -> {a1} ({:+.1}%) | {r2} -> {a2} ({:+.1}%) | {ms:.2} |\n",
        rows.len(),
        pct_saved(r1, a1),
        pct_saved(r2, a2),
    ));
    out
}

fn format_text(rows: &[BenchRow]) -> String {
    let mut out = format!("=== AICE Benchmark (v{}, {} cases) ===\n", env!("CARGO_PKG_VERSION"), rows.len());
    let (mut rb, mut ab, mut r1, mut a1, mut r2, mut a2, mut ms) = (0, 0, 0, 0, 0, 0, 0.0);
    for r in rows {
        rb += r.raw_bytes;
        ab += r.aice_bytes;
        r1 += r.raw_cl100k;
        a1 += r.aice_cl100k;
        r2 += r.raw_o200k;
        a2 += r.aice_o200k;
        ms += r.elapsed_ms;
        out.push_str(&format!(
            "  {:<18} {:<11} cl100k {:>3}->{:<3} ({:+5.1}%)  o200k {:>3}->{:<3}  {:.2}ms\n",
            r.name, r.lang, r.raw_cl100k, r.aice_cl100k,
            pct_saved(r.raw_cl100k, r.aice_cl100k), r.raw_o200k, r.aice_o200k, r.elapsed_ms
        ));
    }
    out.push_str(&format!(
        "Totals: {} -> {} bytes | cl100k {} -> {} ({:+.1}%) | o200k {} -> {} ({:+.1}%) | {:.2}ms\n",
        rb, ab, r1, a1, pct_saved(r1, a1), r2, a2, pct_saved(r2, a2), ms
    ));
    out
}

pub(crate) fn run_benchmark(
    governed: &AdminGoverned,
    json: bool,
    markdown: bool,
) -> Result<PipelineResult<Executed>, PipelineError> {
    let rows = measure_samples().map_err(PipelineError::Execution)?;
    let out = if json {
        format_json(&rows)
    } else if markdown {
        format_markdown(&rows)
    } else {
        format_text(&rows)
    };
    Ok(seal_simple(governed, out, String::new(), 0))
}
