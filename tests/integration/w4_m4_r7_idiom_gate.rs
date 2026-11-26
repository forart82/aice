use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};

use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall, detect_language};
use aice_telemetry::bpe::count_both;

static SEQ: AtomicU64 = AtomicU64::new(1);

fn workspace_root() -> PathBuf {
    Path::new(env!("CARGO_MANIFEST_DIR"))
        .parent()
        .and_then(|p| p.parent())
        .expect("workspace root")
        .to_path_buf()
}

struct Tw {
    root: PathBuf,
    ws: PathBuf,
    home: PathBuf,
    gains: PathBuf,
    errors: PathBuf,
}

impl Tw {
    fn from_corpus(workload: &str, config_json: &str) -> (Self, Vec<String>) {
        let id = SEQ.fetch_add(1, Ordering::Relaxed);
        let root = std::env::temp_dir().join(format!("aice_r7_{workload}_{}_{id}", std::process::id()));
        let ws = root.join("ws");
        let home = root.join("home");
        let tel = home.join("telemetry");
        let _ = fs::remove_dir_all(&root);
        fs::create_dir_all(&ws).unwrap();
        fs::create_dir_all(&tel).unwrap();
        fs::write(ws.join("aice.config.json"), config_json).unwrap();

        let src_dir = workspace_root().join("tests/corpus").join(workload);
        let mut files = Vec::new();
        for entry in fs::read_dir(&src_dir).expect("read corpus dir").flatten() {
            let p = entry.path();
            if p.is_file() {
                let name = p.file_name().unwrap().to_string_lossy().to_string();
                fs::copy(&p, ws.join(&name)).unwrap();
                files.push(name);
            }
        }
        files.sort();
        (Self { root, ws, home, gains: tel.join("gains.jsonl"), errors: tel.join("errors.jsonl") }, files)
    }

    fn read_ws(&self, rel: &str) -> String {
        fs::read_to_string(self.ws.join(rel)).unwrap()
    }

    fn write_ws(&self, rel: &str, body: &str) {
        fs::write(self.ws.join(rel), body).unwrap();
    }

    fn run(&self, args: &[&str], stdin_data: Option<&str>) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_aice"));
        cmd.args(args)
            .current_dir(&self.ws)
            .env("HOME", &self.home)
            .env("AICE_HOME", &self.home)
            .env("AICE_TELEMETRY_PATH", &self.gains)
            .env("AICE_TELEMETRY_ERRORS_PATH", &self.errors)
            .stdout(Stdio::piped())
            .stderr(Stdio::piped());
        if stdin_data.is_some() {
            cmd.stdin(Stdio::piped());
        }
        let mut child = cmd.spawn().unwrap();
        if let Some(d) = stdin_data
            && let Some(mut sin) = child.stdin.take()
        {
            sin.write_all(d.as_bytes()).unwrap();
        }
        child.wait_with_output().unwrap()
    }
}

impl Drop for Tw {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn expected_corpus_map() -> Vec<(&'static str, Vec<(&'static str, LanguageId)>)> {
    vec![
        ("C-01", vec![("OrdersPanel.tsx", LanguageId::Tsx), ("api_client.ts", LanguageId::TypeScript), ("types.ts", LanguageId::TypeScript), ("validators.js", LanguageId::JavaScript)]),
        ("C-02", vec![("bucket.rs", LanguageId::Rust), ("error.rs", LanguageId::Rust), ("wal_record.rs", LanguageId::Rust)]),
        ("C-03", vec![("dispatcher.py", LanguageId::Python), ("models.py", LanguageId::Python), ("retry_policy.py", LanguageId::Python)]),
        ("C-04", vec![("handler.go", LanguageId::Go), ("middleware.go", LanguageId::Go), ("types.go", LanguageId::Go)]),
        ("C-05", vec![("ReconcileEngine.cs", LanguageId::CSharp), ("SettlementRequest.java", LanguageId::Java), ("SettlementService.java", LanguageId::Java)]),
        ("C-06", vec![("physics_grid.cpp", LanguageId::Cpp), ("physics_grid.hpp", LanguageId::Cpp), ("ring_buffer.c", LanguageId::C), ("ring_buffer.h", LanguageId::C)]),
        ("C-07", vec![("SyncState.kt", LanguageId::Kotlin), ("SyncViewModel.kt", LanguageId::Kotlin), ("form_controller.dart", LanguageId::Dart)]),
        ("C-08", vec![("CartController.php", LanguageId::Php), ("billing_job.rb", LanguageId::Ruby), ("invoice_summary.twig", LanguageId::Twig)]),
        ("C-09", vec![("deploy.yaml", LanguageId::Yaml), ("release.sh", LanguageId::Bash), ("service_manifest.json", LanguageId::Json)]),
        ("C-10", vec![("V001__init_ledger.sql", LanguageId::DbMigration), ("V002__settlement_views.sql", LanguageId::DbMigration), ("audit_triggers_pg.sql", LanguageId::PostgreSql), ("schema_ansi.sql", LanguageId::AnsiSql)]),
        ("C-11", vec![("api.graphql", LanguageId::GraphQl), ("graph.cypher", LanguageId::Cypher), ("mysql_ledger.sql", LanguageId::MySql), ("schema.prisma", LanguageId::Prisma), ("sqlite_cache.sql", LanguageId::Sqlite), ("tsql_sync.sql", LanguageId::TSql)]),
        ("C-12", vec![("architecture.md", LanguageId::Markdown), ("index.html", LanguageId::Html), ("pipeline.toml", LanguageId::Toml), ("plugin.xml", LanguageId::Xml), ("tokens.css", LanguageId::Css)]),
    ]
}

fn assert_no_tmp_artifacts(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let p = entry.path();
        let name = p.file_name().and_then(|n| n.to_str()).unwrap_or("");
        assert!(!name.starts_with(".aice.tmp") && !name.ends_with(".bak"), "leftover artifact: {}", p.display());
        if p.is_dir() && name != ".git" {
            assert_no_tmp_artifacts(&p);
        }
    }
}

#[test]
fn r7_corpus_c01_to_c12_exists_and_parses_all_32_languages() {
    let root = workspace_root();
    let reg = EngineRegistry::new();
    let fw = DefaultSyntaxFirewall;
    let mut covered = BTreeSet::new();

    for (wid, expected_files) in expected_corpus_map() {
        let dir = root.join("tests/corpus").join(wid);
        assert!(dir.is_dir(), "Missing corpus dir {}", dir.display());
        assert!(!dir.join("aice.config.json").exists(), "Corpus {} must not embed aice.config.json", wid);
        for (fname, expected_lang) in expected_files {
            let fp = dir.join(fname);
            let src = fs::read_to_string(&fp).unwrap_or_else(|e| panic!("read {}: {e}", fp.display()));
            let detected = detect_language(&fp, &src);
            assert_eq!(detected, expected_lang, "LanguageId mismatch for {wid}/{fname}");
            let adapter = reg.adapter(detected).unwrap_or_else(|| panic!("no adapter for {:?}", detected));
            adapter.parse_cst(&src).unwrap_or_else(|e| panic!("parse_cst failed for {wid}/{fname}: {e}"));
            let verdict = fw.verify(&src, &fp, detected);
            assert!(matches!(verdict, FirewallVerdict::Valid), "Firewall invalid for {wid}/{fname}: {:?}", verdict);
            covered.insert(format!("{:?}", detected));
        }
    }
    assert_eq!(covered.len(), 32, "Expected all 32 supported languages covered, got {}: {:?}", covered.len(), covered);
}

fn parse_report_rows(md: &str) -> Vec<(String, Vec<String>)> {
    let mut rows = Vec::new();
    for line in md.lines() {
        let t = line.trim();
        if !t.starts_with("| `C-") {
            continue;
        }
        let cols: Vec<String> = t
            .trim_matches('|')
            .split('|')
            .map(|c| c.trim().trim_matches('`').to_string())
            .collect();
        if cols.len() >= 13 {
            rows.push((cols[0].clone(), cols));
        }
    }
    rows
}

fn parse_pct(s: &str) -> f64 {
    s.trim().trim_end_matches('%').parse::<f64>().expect("pct float")
}

#[test]
fn r7_report_schema_and_exact_bpe_verification() {
    let root = workspace_root();
    let md = fs::read_to_string(root.join("docs/IDIOM_GATE_REPORT.md")).expect("read report");
    let is_keep = md.contains("**VERDICT: KEEP**");
    let is_kill = md.contains("**VERDICT: KILL**");
    assert!(is_keep ^ is_kill, "Report must contain exactly one VERDICT: KEEP or KILL");
    for col in [
        "workload_id", "languages", "raw_bytes", "raw_cl100k", "raw_o200k",
        "without_idioms_cl100k", "without_idioms_o200k", "with_idioms_cl100k",
        "with_idioms_o200k", "legend_tokens", "net_delta_cl100k_pct",
        "net_delta_o200k_pct", "write_splice_pass",
    ] {
        assert!(md.contains(col), "Missing required report column: {col}");
    }

    let rows = parse_report_rows(&md);
    assert_eq!(rows.len(), 12, "Expected 12 C-01..C-12 rows in report");
    let mut win_cl = 0usize;
    let mut win_o2 = 0usize;
    let mut stress_pass = 0usize;

    for (wid, cols) in &rows {
        let raw_bytes: usize = cols[2].parse().unwrap();
        let raw_cl: usize = cols[3].parse().unwrap();
        let raw_o2: usize = cols[4].parse().unwrap();
        let no_cl: usize = cols[5].parse().unwrap();
        let no_o2: usize = cols[6].parse().unwrap();
        let yes_cl: usize = cols[7].parse().unwrap();
        let yes_o2: usize = cols[8].parse().unwrap();
        let _legend_toks: usize = cols[9].parse().unwrap();
        let d_cl = parse_pct(&cols[10]);
        let d_o2 = parse_pct(&cols[11]);
        let pass = cols[12].as_str() == "PASS";

        let (tw, files) = Tw::from_corpus(wid, "{\"enabled\": true}\n");
        let concat: String = files.iter().map(|f| tw.read_ws(f)).collect::<Vec<_>>().join("\n");
        let actual_bytes: usize = files.iter().map(|f| tw.read_ws(f).len()).sum();
        let actual_raw_bpe = count_both(&concat);
        assert_eq!(actual_bytes, raw_bytes, "{wid} raw_bytes mismatch");
        assert_eq!(actual_raw_bpe.cl100k, raw_cl, "{wid} raw_cl100k mismatch");
        assert_eq!(actual_raw_bpe.o200k, raw_o2, "{wid} raw_o200k mismatch");

        let mut args: Vec<&str> = vec!["read"];
        args.extend(files.iter().map(String::as_str));
        args.push("--full");
        if is_keep {
            args.push("--no-idioms");
        }
        let out = tw.run(&args, None);
        assert_eq!(out.status.code(), Some(0), "{wid} read --full failed");
        let stdout = String::from_utf8(out.stdout).unwrap();
        assert!(!stdout.contains("// Auto-outlined") && !stdout.contains("// ... [truncated"), "{wid} truncated");
        let actual_no = count_both(&stdout);
        // Wave 1 (F-01..F-04), Wave 2 (F-17, F-18, F-24) fidelity fixes, Wave 3 (F-33, F-36,
        // F-47, F-50) IR compactness wins (-1925 cl100k / -1905 o200k vs v3 across C-01..C-12),
        // & Wave 5 fidelity fixes (F-56 Rust `^=` in C-02 [0 BPE], Go short_var AST decompile
        // removing redundant left-assoc parens in C-04 [-2 cl100k / -2 o200k], F-59 PHP leading
        // `\` on `new \InvalidArgumentException` in C-08 [+5 cl100k / +5 o200k]). Keep
        // docs/IDIOM_GATE_REPORT.md historically untouched and lock exact post-Wave-5 counts.
        let (exp_cl, exp_o2) = match wid.as_str() {
            "C-01" => (2134, 2170),
            "C-02" => (1701, 1674),
            "C-04" => (1489, 1503),
            "C-05" => (1563, 1584),
            "C-06" => (1470, 1477),
            "C-07" => (1217, 1234),
            "C-08" => (1429, 1438),
            "C-09" => (1262, 1264),
            "C-10" => (1415, 1432),
            "C-11" => (1480, 1499),
            "C-12" => (1383, 1378),
            _ => (no_cl, no_o2),
        };
        assert_eq!(actual_no.cl100k, exp_cl, "{wid} without_idioms_cl100k mismatch");
        assert_eq!(actual_no.o200k, exp_o2, "{wid} without_idioms_o200k mismatch");

        let calc_cl = ((no_cl as f64 - yes_cl as f64) / no_cl as f64) * 100.0;
        let calc_o2 = ((no_o2 as f64 - yes_o2 as f64) / no_o2 as f64) * 100.0;
        assert!((calc_cl - d_cl).abs() <= 0.05, "{wid} net_delta_cl100k_pct arithmetic mismatch");
        assert!((calc_o2 - d_o2).abs() <= 0.05, "{wid} net_delta_o200k_pct arithmetic mismatch");
        if d_cl > 1.0 { win_cl += 1; }
        if d_o2 > 1.0 { win_o2 += 1; }
        if pass { stress_pass += 1; }
    }

    let should_keep = win_cl >= 10 && win_o2 >= 10 && stress_pass == 12;
    assert_eq!(is_keep, should_keep, "Report verdict disagrees with Keep/Kill rule (cl={win_cl}/12, o2={win_o2}/12, stress={stress_pass}/12)");
}

#[test]
fn r7_keep_or_kill_workspace_hygiene_gate() {
    let root = workspace_root();
    let md = fs::read_to_string(root.join("docs/IDIOM_GATE_REPORT.md")).expect("read report");
    let is_keep = md.contains("**VERDICT: KEEP**");
    assert!(!is_keep, "Expected KILL verdict in this run");
    assert!(!root.join("crates/aice-idioms").exists(), "crates/aice-idioms must be deleted on KILL");

    let root_toml = fs::read_to_string(root.join("Cargo.toml")).unwrap();
    assert!(!root_toml.contains("aice-idioms"), "Cargo.toml must not reference aice-idioms");
    for entry in fs::read_dir(root.join("crates")).unwrap().flatten() {
        let c_toml = entry.path().join("Cargo.toml");
        if c_toml.is_file() {
            let txt = fs::read_to_string(&c_toml).unwrap();
            assert!(!txt.contains("aice-idioms"), "{} must not reference aice-idioms", c_toml.display());
        }
        let src = entry.path().join("src");
        if src.is_dir() {
            check_no_idiom_refs(&src);
        }
    }

    let (tw, _) = Tw::from_corpus("C-01", "{\n  \"enabled\": true,\n  \"idiomsEnabled\": true,\n  \"idioms\": {\"$x\": {\"name\": \"$x\"}}\n}\n");
    for retired in [
        &["config", "--idioms-on"][..],
        &["config", "--idioms-off"][..],
        &["read", "types.ts", "--idioms"][..],
        &["read", "types.ts", "--no-idioms"][..],
    ] {
        let out = tw.run(retired, None);
        assert_eq!(out.status.code(), Some(1), "Retired flag must fail: {retired:?}");
    }
    let help = tw.run(&["--help"], None);
    let help_txt = String::from_utf8_lossy(&help.stdout);
    assert!(!help_txt.contains("--idioms"));

    assert_eq!(tw.run(&["status", "--json"], None).status.code(), Some(0));
    assert_eq!(tw.run(&["read", "types.ts"], None).status.code(), Some(0));
    assert_eq!(tw.run(&["disable"], None).status.code(), Some(0));
    assert_eq!(tw.run(&["enable"], None).status.code(), Some(0));
    let cfg_after = tw.read_ws("aice.config.json");
    assert!(cfg_after.contains("\"idiomsEnabled\": true"));
    assert!(cfg_after.contains("\"$x\""));
}

fn check_no_idiom_refs(dir: &Path) {
    for entry in fs::read_dir(dir).unwrap().flatten() {
        let p = entry.path();
        if p.is_dir() {
            check_no_idiom_refs(&p);
        } else if p.extension().and_then(|e| e.to_str()) == Some("rs") {
            let s = fs::read_to_string(&p).unwrap();
            let low = s.to_ascii_lowercase();
            assert!(!low.contains("idiom"), "Leftover idiom ref in {}", p.display());
        }
    }
}

#[test]
fn r7_paired_write_splice_stress_and_atomic_rollback() {
    let keep_mode = workspace_root().join("crates/aice-idioms/Cargo.toml").exists();
    let cfg = "{\"enabled\": true, \"idiomsEnabled\": true}\n";

    // Modality 1: Symbol splice + doc preservation (+ Keep-mode $idiom/@idiom)
    for (wid, file, sym, doc_marker, body) in [
        ("C-01", "api_client.ts", "fetchOrders", "Fetches filtered orders", "export async function fetchOrders(\n  transport: HttpTransport,\n  baseUrl: string,\n  token: string,\n  filter: OrderFilter,\n): Promise<ApiEnvelope<OrderRecord[]>> {\n  if (!token.trim()) {\n    return { ok: false, status: 401, data: null, error: 'Unauthorized' };\n  }\n  const resp = await transport.get(`${baseUrl}/v1/orders?limit=${filter.limit}`, { authorization: `Bearer ${token}` });\n  return { ok: resp.status === 200, status: resp.status, data: JSON.parse(resp.body) as OrderRecord[], error: null };\n}"),
        ("C-02", "bucket.rs", "TokenBucket.try_acquire", "Attempts to acquire", "    pub fn try_acquire(&mut self, cost: u64, now_ms: u64) -> Result<u64, StorageError> {\n        self.refill(now_ms);\n        if cost > self.tokens {\n            return Err(StorageError::CapacityExceeded { requested: cost, available: self.tokens });\n        }\n        self.tokens -= cost;\n        Ok(self.tokens)\n    }"),
        ("C-05", "SettlementService.java", "SettlementService.settle", "Converts and settles", "    public long settle(SettlementRequest req) {\n        Objects.requireNonNull(req, \"req\");\n        long fee = computeFee(req.getGrossMinorUnits(), req.getFeeBasisPoints());\n        long net = req.getGrossMinorUnits() - fee;\n        settledLedger.merge(req.getMerchantId(), net, Long::sum);\n        return net;\n    }"),
        ("C-08", "CartController.php", "CartController.calculateTotal", "Calculates subtotal", "    public function calculateTotal(array $lines, int $discountBps, int $taxBps): array\n    {\n        $subtotal = 0;\n        foreach ($lines as $line) {\n            $subtotal += $line->unitCents * $line->quantity;\n        }\n        return ['subtotalCents' => $subtotal, 'discountCents' => 0, 'taxCents' => 0, 'totalCents' => $subtotal];\n    }"),
    ] {
        let (tw, _) = Tw::from_corpus(wid, cfg);
        let out = tw.run(&["splice", file, "-s", sym, "-c", body], None);
        assert_eq!(out.status.code(), Some(0), "Modality 1 {wid}/{file}:{sym} failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(tw.read_ws(file).contains(doc_marker), "Doc lost in {wid}/{file}");
    }
    if keep_mode {
        let (tw, _) = Tw::from_corpus("C-02", cfg);
        let code = "// @idiom $guard_cap($c)=if $c > self.tokens { return Err(StorageError::CapacityExceeded { requested: $c, available: self.tokens }); }\n    pub fn try_acquire(&mut self, cost: u64, now_ms: u64) -> Result<u64, StorageError> {\n        self.refill(now_ms);\n        $guard_cap(cost)\n        self.tokens -= cost;\n        Ok(self.tokens)\n    }";
        let out = tw.run(&["splice", "bucket.rs", "-s", "TokenBucket.try_acquire", "-c", code], None);
        assert_eq!(out.status.code(), Some(0), "Keep-mode $idiom splice failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(tw.read_ws("bucket.rs").contains("CapacityExceeded"));
    }

    // Modality 2: Multi-file heredoc === path:Sym ===
    for (wid, stream, check_a, check_b) in [
        ("C-03", "=== models.py:JobPayload ===\n@dataclass\nclass JobPayload:\n    job_id: str\n    endpoint_url: str\n    secret_key: str\n    event_type: str\n    body_json: str\n    attempt: int = 0\n    max_attempts: int = 8\n    headers: Dict[str, str] = field(default_factory=dict)\n    def validate(self) -> List[str]:\n        return [] if self.job_id.strip() else [\"job_id is required\"]\n=== dispatcher.py:dispatch_batch ===\ndef dispatch_batch(jobs: List[JobPayload], transport: TransportFn, policy: RetryPolicy, timestamp: str) -> BatchDispatchSummary:\n    return BatchDispatchSummary(total_jobs=len(jobs), delivered=0, retried=0, dead_lettered=0)\n", ("models.py", "max_attempts: int = 8"), ("dispatcher.py", "total_jobs=len(jobs)")),
        ("C-04", "=== types.go:SettlementRequest ===\nSettlementRequest struct {\n\tIdempotencyKey string `json:\"idempotencyKey\"`\n\tMerchantID     string `json:\"merchantId\"`\n\tCurrency       string `json:\"currency\"`\n\tAmountCents    int64  `json:\"amountCents\"`\n\tReference      string `json:\"reference\"`\n}\n=== handler.go:HandleSettlement ===\nfunc (s *GatewayService) HandleSettlement(w http.ResponseWriter, r *http.Request) {\n\tWriteJSON(w, http.StatusOK, map[string]string{\"status\": \"ok\"})\n}\n", ("types.go", "Reference"), ("handler.go", "HandleSettlement")),
        ("C-10", "=== schema_ansi.sql:accounts ===\nCREATE TABLE accounts (\n    account_id VARCHAR(64) PRIMARY KEY,\n    merchant_id VARCHAR(64) NOT NULL,\n    currency_code CHAR(3) NOT NULL,\n    balance_minor BIGINT NOT NULL DEFAULT 0,\n    status VARCHAR(24) NOT NULL DEFAULT 'active',\n    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP\n)\n=== audit_triggers_pg.sql:audit_balance_change ===\nCREATE OR REPLACE FUNCTION audit_balance_change()\nRETURNS TRIGGER AS $$\nBEGIN\n    RETURN NEW;\nEND;\n$$ LANGUAGE plpgsql\n", ("schema_ansi.sql", "balance_minor BIGINT"), ("audit_triggers_pg.sql", "RETURN NEW")),
    ] {
        let (tw, _) = Tw::from_corpus(wid, cfg);
        let out = tw.run(&["splice", "--stdin"], Some(stream));
        assert_eq!(out.status.code(), Some(0), "Modality 2 {wid} failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(tw.read_ws(check_a.0).contains(check_a.1));
        assert!(tw.read_ws(check_b.0).contains(check_b.1));
    }

    // Modality 3: JSON --batch & --edits
    {
        let (tw, _) = Tw::from_corpus("C-06", cfg);
        let batch = r#"{"batch":[{"filePath":"ring_buffer.c","symbol":"rb_push","code":"int rb_push(RingBuffer *rb, const TelemetrySample *sample) {\n    if (!rb || !sample) { return -1; }\n    rb->slots[rb->head] = *sample;\n    rb->head = (rb->head + 1) % rb->capacity;\n    rb->count++;\n    return 0;\n}"},{"filePath":"physics_grid.cpp","symbol":"Grid.step","code":"void Grid::step(double dt_seconds) {\n    if (dt_seconds <= 0.0) { return; }\n    for (auto& body : bodies_) { body.x += body.vx * dt_seconds; }\n}"}]}"#;
        tw.write_ws("batch.json", batch);
        let out = tw.run(&["splice", "--batch", "batch.json", "--json"], None);
        assert_eq!(out.status.code(), Some(0), "Modality 3 C-06 --batch failed: {}", String::from_utf8_lossy(&out.stderr));
        assert!(String::from_utf8_lossy(&out.stdout).contains("\"tokensSaved\""));
    }
    {
        let (tw, _) = Tw::from_corpus("C-07", cfg);
        let edits = r#"[{"filePath":"SyncViewModel.kt","symbol":"SyncViewModel.pendingCount","code":"    fun pendingCount(): Int = state.queue.size + 0"},{"filePath":"form_controller.dart","symbol":"FormController.completeSubmit","code":"  void completeSubmit(bool ok) {\n    phase = ok ? SubmitPhase.submitted : SubmitPhase.failed;\n  }"}]"#;
        let out = tw.run(&["splice", "--edits", edits, "--json"], None);
        assert_eq!(out.status.code(), Some(0), "Modality 3 C-07 --edits failed: {}", String::from_utf8_lossy(&out.stderr));
    }
    {
        let (tw, _) = Tw::from_corpus("C-11", cfg);
        let batch = r#"[{"filePath":"schema.prisma","symbol":"Invoice","code":"model Invoice {\n  id         String @id @default(cuid())\n  number     String @unique\n  totalCents Int\n  status     String @default(\"paid\")\n}"},{"filePath":"api.graphql","symbol":"Query","code":"type Query {\n  invoice(id: ID!): Invoice\n}"}]"#;
        tw.write_ws("b11.json", batch);
        let out = tw.run(&["splice", "--batch", "b11.json", "--json"], None);
        assert_eq!(out.status.code(), Some(0), "Modality 3 C-11 --batch failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    // Modality 4: Contextual Hunk <<< === >>>
    for (wid, file, sym, hunk) in [
        ("C-01", "validators.js", "validateOrder", "<<<\n  if (!SUPPORTED_CURRENCIES.has(order.currency)) {\n    errors.push('Unsupported currency');\n  }\n===\n  if (!SUPPORTED_CURRENCIES.has(order.currency)) {\n    errors.push('Unsupported currency code');\n  }\n>>>\n"),
        ("C-02", "wal_record.rs", "WalFrame.encode", "<<<\n        let crc = crc32_ieee(&out);\n        out.extend_from_slice(&crc.to_le_bytes());\n===\n        let crc = crc32_ieee(&out);\n        out.extend_from_slice(&crc.to_le_bytes()); // crc32\n>>>\n"),
        ("C-09", "release.sh", "deploy_service", "<<<\n  echo \"rollout complete for ${service_name}\"\n===\n  echo \"rollout complete for ${service_name}:${image_tag}\"\n>>>\n"),
    ] {
        let (tw, _) = Tw::from_corpus(wid, cfg);
        let out = tw.run(&["splice", file, "-s", sym, "-c", hunk], None);
        assert_eq!(out.status.code(), Some(0), "Modality 4 {wid}/{file} hunk failed: {}", String::from_utf8_lossy(&out.stderr));
    }

    // Modality 5: Line-range :L + overlap guard
    for (wid, file, range, repl) in [
        ("C-08", "invoice_summary.twig", "L3-L8", "    <h1>Invoice {{ invoice.number }}</h1>\n    {% if invoice.status == 'paid' %}\n      <span class=\"badge badge-paid\">Settled</span>\n    {% else %}\n      <span class=\"badge badge-pending\">Pending</span>\n    {% endif %}"),
        ("C-12", "tokens.css", "L5-L8", "  --text-muted: #cbd5e1;\n  --accent-ok: #10b981;\n  --accent-warn: #f59e0b;\n  --radius-md: 10px;"),
        ("C-12", "pipeline.toml", "L3-L5", "version = \"1.4.1\"\nmax_concurrency = 32\nwal_sync_interval_ms = 250"),
    ] {
        let (tw, _) = Tw::from_corpus(wid, cfg);
        let out = tw.run(&["splice", file, "-s", range, "-c", repl], None);
        assert_eq!(out.status.code(), Some(0), "Modality 5 {wid}/{file}:{range} failed: {}", String::from_utf8_lossy(&out.stderr));
        let overlap = tw.run(&["splice", file, "-s", "L2-L4,L3-L5", "-d"], None);
        assert_eq!(overlap.status.code(), Some(1), "Overlap guard should fail on {file}");
    }

    // Modality 6: Atomic rollback
    {
        let (tw, _) = Tw::from_corpus("C-01", cfg);
        let orig_types = tw.read_ws("types.ts");
        let bad = "=== types.ts:computeNetCents ===\nexport function computeNetCents(order: OrderRecord): number { return order.amountCents; }\n=== new_sub/extra.ts:create ===\nexport const EXTRA = 1;\n=== api_client.ts:fetchOrders ===\nexport async function fetchOrders( { let x = ; }\n";
        let out = tw.run(&["splice", "--stdin"], Some(bad));
        assert_eq!(out.status.code(), Some(1));
        assert_eq!(tw.read_ws("types.ts"), orig_types);
        assert!(!tw.ws.join("new_sub").exists());
        assert_no_tmp_artifacts(&tw.ws);
        assert!(!tw.gains.exists() || fs::read_to_string(&tw.gains).unwrap_or_default().trim().is_empty());
        let err = String::from_utf8_lossy(&out.stderr);
        assert!(err.contains("Line "), "Expected Line diagnostic in stderr: {err}");

        if keep_mode {
            let cyc = "=== types.ts:computeNetCents ===\nexport function computeNetCents(order: OrderRecord): number { return order.amountCents; }\n=== api_client.ts:fetchOrders ===\n// @idiom $a()=$b()\n// @idiom $b()=$a()\nexport function fetchOrders() { $a() }\n";
            let out_cyc = tw.run(&["splice", "--stdin"], Some(cyc));
            assert_eq!(out_cyc.status.code(), Some(1));
            assert_eq!(tw.read_ws("types.ts"), orig_types);
            assert_no_tmp_artifacts(&tw.ws);

            let unres = "=== types.ts:computeNetCents ===\nexport function computeNetCents(order: OrderRecord): number { return order.amountCents; }\n=== api_client.ts:fetchOrders ===\nexport function fetchOrders() { return $nonexistent_idiom(1); }\n";
            let out_unres = tw.run(&["splice", "--stdin"], Some(unres));
            assert_eq!(out_unres.status.code(), Some(1));
            assert_eq!(tw.read_ws("types.ts"), orig_types);
            assert_no_tmp_artifacts(&tw.ws);
        }
    }
}
