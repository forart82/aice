use std::collections::BTreeSet;
use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::{count_cl100k, count_o200k};

#[path = "golden_parity_ab.rs"]
mod anti_bypass;

static GOLDEN_SEQ: AtomicU64 = AtomicU64::new(1);

pub(crate) struct GoldenSandbox {
    pub(crate) root: PathBuf,
    pub(crate) ws: PathBuf,
    pub(crate) home: PathBuf,
    pub(crate) telemetry_path: PathBuf,
}

impl GoldenSandbox {
    pub(crate) fn new(tag: &str, copy_src: bool, copy_bin: bool, config: &str) -> Self {
        let seq = GOLDEN_SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_nanos());
        let root = std::env::temp_dir().join(format!("aice_golden_{tag}_{}_{seq}_{nanos}", std::process::id()));
        let ws = root.join("ws");
        let home = root.join("home");
        let tel_dir = home.join(".aice").join("telemetry");
        fs::create_dir_all(&ws).expect("mkdir ws");
        fs::create_dir_all(&tel_dir).expect("mkdir telemetry");
        let fixtures = repo_root().join("tests/golden/fixtures");
        if copy_src {
            copy_dir_all(&fixtures.join("src"), &ws.join("src"));
        }
        if copy_bin {
            copy_dir_all(&fixtures.join("bin"), &ws.join("bin"));
            fs::create_dir_all(ws.join(".git")).expect("mkdir .git");
            fs::write(ws.join(".git/HEAD"), "ref: refs/heads/main\n").expect("write HEAD");
            fs::create_dir_all(ws.join("node_modules/dummy")).expect("mkdir node_modules");
            fs::write(ws.join("node_modules/dummy/index.js"), "export const ignored = true;\n").expect("write dummy");
        }
        let cfg_dir = fixtures.join("configs");
        match config {
            "enabled" => { fs::copy(cfg_dir.join("enabled.aice.config.json"), ws.join("aice.config.json")).unwrap(); }
            "disabled" => { fs::copy(cfg_dir.join("disabled.aice.config.json"), ws.join("aice.config.json")).unwrap(); }
            "idioms" => { fs::copy(cfg_dir.join("idioms.aice.config.json"), ws.join("aice.config.json")).unwrap(); }
            "legacy_aicerc" => { fs::copy(cfg_dir.join("legacy.aicerc"), ws.join(".aicerc")).unwrap(); }
            _ => {}
        }
        Self { root, ws, home, telemetry_path: tel_dir.join("gains.jsonl") }
    }

    pub(crate) fn run_cli(&self, args: &[&str], stdin_data: Option<&str>, unset_tel_env: bool) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_aice"));
        cmd.args(args)
            .current_dir(&self.ws)
            .env("HOME", &self.home)
            .env("AICE_AGENT_HOME", &self.home)
            .env_remove("AICE_HOME")
            .env_remove("AICE_TELEMETRY_DIR")
            .env_remove("AICE_TELEMETRY_ERRORS_PATH")
            .env_remove("AICE_TELEMETRY_PATH");
        if !unset_tel_env {
            cmd.env("AICE_TELEMETRY_PATH", &self.telemetry_path);
        }
        if let Some(input) = stdin_data {
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd.spawn().expect("spawn aice");
            child.stdin.as_mut().expect("stdin").write_all(input.as_bytes()).expect("write stdin");
            child.wait_with_output().expect("wait aice")
        } else {
            cmd.output().expect("run aice")
        }
    }

    pub(crate) fn run_mcp(&self, reqs: &[JsonValue]) -> (i32, Vec<JsonValue>) {
        let mut lines = Vec::new();
        let mut next_id = 1i64;
        for req in reqs {
            let obj = req.as_object().expect("mcp request object");
            let method = obj.get("method").and_then(JsonValue::as_str).unwrap_or("");
            let is_notif = method.starts_with("notifications/");
            let params = obj.get("params").map(JsonValue::to_compact_string).unwrap_or_else(|| "{}".to_string());
            if is_notif {
                lines.push(format!(r#"{{"jsonrpc":"2.0","method":"{method}","params":{params}}}"#));
            } else {
                lines.push(format!(r#"{{"jsonrpc":"2.0","id":{next_id},"method":"{method}","params":{params}}}"#));
                next_id += 1;
            }
        }
        let payload = format!("{}\n", lines.join("\n"));
        let out = self.run_cli(&["mcp"], Some(&payload), false);
        let code = out.status.code().unwrap_or(-1);
        let stdout = String::from_utf8_lossy(&out.stdout);
        let resps = stdout.lines().filter(|l| !l.trim().is_empty()).map(|l| parse_json(l).expect("mcp json")).collect();
        (code, resps)
    }
}

impl Drop for GoldenSandbox {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

pub(crate) fn repo_root() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).parent().unwrap().parent().unwrap().to_path_buf()
}

fn copy_dir_all(src: &Path, dst: &Path) {
    fs::create_dir_all(dst).expect("mkdir dst");
    for entry in fs::read_dir(src).expect("read_dir") {
        let entry = entry.expect("dir entry");
        let ty = entry.file_type().expect("file_type");
        let dst_p = dst.join(entry.file_name());
        if ty.is_dir() { copy_dir_all(&entry.path(), &dst_p); } else { fs::copy(entry.path(), dst_p).expect("copy"); }
    }
}

pub(crate) fn s_out(out: &Output) -> String { String::from_utf8_lossy(&out.stdout).into_owned() }
pub(crate) fn s_err(out: &Output) -> String { String::from_utf8_lossy(&out.stderr).into_owned() }
pub(crate) fn field<'a>(v: &'a JsonValue, k: &str) -> Option<&'a JsonValue> { v.as_object().and_then(|m| m.get(k)) }

fn read_suite(file: &str) -> Vec<JsonValue> {
    let raw = fs::read_to_string(repo_root().join("tests/golden/cases").join(file)).expect("read suite json");
    let root = parse_json(&raw).expect("parse suite json");
    field(&root, "cases").and_then(JsonValue::as_array).expect("cases array").to_vec()
}

fn case_setup(c: &JsonValue) -> (String, bool, bool, String) {
    let id = field(c, "id").and_then(JsonValue::as_str).unwrap().to_string();
    let fs_obj = field(c, "fixtureSetup").unwrap();
    let copy_src = field(fs_obj, "copySrc").and_then(JsonValue::as_bool).unwrap_or(true);
    let copy_bin = field(fs_obj, "copyBin").and_then(JsonValue::as_bool).unwrap_or(false);
    let cfg = field(fs_obj, "config").and_then(JsonValue::as_str).unwrap_or("enabled").to_string();
    (id, copy_src, copy_bin, cfg)
}

fn str_args(v: &JsonValue, strip_dsl: bool) -> Vec<String> {
    v.as_array().unwrap().iter().filter_map(|x| x.as_str().map(str::to_string))
        .filter(|a| !strip_dsl || a != "--dsl")
        .collect()
}

fn verify_disk_after(ws: &Path, c: &JsonValue, id: &str) {
    let disk = field(c, "observedTs0953").and_then(|o| field(o, "diskFilesAfter")).and_then(JsonValue::as_object).unwrap();
    for (rel, exp_v) in disk {
        let exp = exp_v.as_str().unwrap();
        let path = ws.join(rel);
        if exp == "[ABSENT]" {
            assert!(!path.exists(), "{id}: expected {rel} to be absent");
        } else if exp.starts_with("[BINARY ") {
            let actual_bytes = fs::read(&path).unwrap_or_else(|e| panic!("{id}: read {rel}: {e}"));
            let orig_bytes = fs::read(repo_root().join("tests/golden/fixtures").join(rel)).unwrap();
            assert_eq!(actual_bytes, orig_bytes, "{id}: binary file {rel} modified");
            assert!(exp.contains(&format!("bytes={}]", actual_bytes.len())), "{id}: {exp}");
        } else {
            let actual = fs::read_to_string(&path).unwrap_or_else(|e| panic!("{id}: read {rel}: {e}"));
            assert_eq!(actual, exp, "{id}: disk mismatch on {rel}");
        }
    }
}

fn run_suite_01(seen: &mut BTreeSet<String>) {
    for c in read_suite("01_governance_config.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let inv = field(&c, "invocation").unwrap();
        match id.as_str() {
            "GOV-01" | "GOV-05" => {
                let args = str_args(field(inv, "args").unwrap(), false);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let out = sb.run_cli(&refs, None, false);
                assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
                let j = parse_json(&s_out(&out)).expect("status json");
                assert_eq!(field(&j, "enabled").and_then(JsonValue::as_bool), Some(true));
                let canon_ws = fs::canonicalize(&sb.ws).unwrap().to_string_lossy().into_owned();
                assert_eq!(field(&j, "projectRoot").and_then(JsonValue::as_str), Some(canon_ws.as_str()));
            }
            "GOV-02" => {
                for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
                    let args = str_args(field(cmd, "args").unwrap(), false);
                    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                    let out = sb.run_cli(&refs, None, false);
                    assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
                }
                let cfg_j = parse_json(&fs::read_to_string(sb.ws.join("aice.config.json")).unwrap()).unwrap();
                assert_eq!(field(&cfg_j, "enabled").and_then(JsonValue::as_bool), Some(true));
                let agents = fs::read_to_string(sb.ws.join("AGENTS.md")).unwrap();
                assert_eq!(agents.matches("<!-- AICE:START").count(), 1);
                assert!(count_cl100k(&agents) <= 650 && count_o200k(&agents) <= 650);
            }
            "GOV-03" => {
                // R7 VERDICT: KILL retired --idioms-on / --idioms-off cleanly; config remains intact
                for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
                    let args = str_args(field(cmd, "args").unwrap(), false);
                    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                    let out = sb.run_cli(&refs, None, false);
                    assert_eq!(out.status.code(), Some(1), "{id}: retired idiom flag must exit 1");
                    assert!(s_err(&out).contains("unknown option"), "{id}: {}", s_err(&out));
                }
            }
            "GOV-04" => {
                let before_app = fs::read(sb.ws.join("src/app.ts")).unwrap();
                for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
                    let args = str_args(field(cmd, "args").unwrap(), false);
                    let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                    let out = sb.run_cli(&refs, None, false);
                    assert_eq!(out.status.code(), Some(1), "{id}: disabled op must exit 1");
                    let combined = format!("{}{}", s_out(&out), s_err(&out));
                    assert!(combined.contains("aice.config.json") && combined.contains("enabled"), "{id}: {combined}");
                }
                assert_eq!(fs::read(sb.ws.join("src/app.ts")).unwrap(), before_app);
            }
            "GOV-06" => {
                let cmds = field(inv, "commands").unwrap().as_array().unwrap();
                let a0 = str_args(field(&cmds[0], "args").unwrap(), false);
                let r0: Vec<&str> = a0.iter().map(String::as_str).collect();
                let o0 = sb.run_cli(&r0, None, false);
                assert_eq!(o0.status.code(), Some(0));
                assert_eq!(field(&parse_json(&s_out(&o0)).unwrap(), "enabled").and_then(JsonValue::as_bool), Some(false));
                let a1 = str_args(field(&cmds[1], "args").unwrap(), false);
                let r1: Vec<&str> = a1.iter().map(String::as_str).collect();
                let o1 = sb.run_cli(&r1, None, false);
                assert_eq!(o1.status.code(), Some(0));
                assert_eq!(field(&parse_json(&s_out(&o1)).unwrap(), "enabled").and_then(JsonValue::as_bool), Some(true));
                let cfg_j = parse_json(&fs::read_to_string(sb.ws.join("aice.config.json")).unwrap()).unwrap();
                assert!(field(&cfg_j, "idioms").and_then(|m| field(m, "$clamp")).is_some(), "must preserve idioms.$clamp");
            }
            _ => panic!("unexpected suite 01 case {id}"),
        }
    }
}

fn run_suite_02_03(seen: &mut BTreeSet<String>) {
    for c in read_suite("02_find_discovery.json") {
        let (id, cs, _cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, true, &cfg);
        let args = str_args(field(&c, "invocation").and_then(|i| field(i, "args")).unwrap(), false);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = sb.run_cli(&refs, None, false);
        assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
        let txt = s_out(&out);
        assert!(!txt.contains("logo.png") && !txt.contains("data.bin") && !txt.contains(".git/HEAD") && !txt.contains("node_modules"));
        match id.as_str() {
            "FIND-01" | "FIND-02" | "FIND-08" => {
                assert!(txt.contains("app.ts") && txt.contains("L)"), "{id}: {txt}");
            }
            "FIND-03" | "FIND-04" | "FIND-05" => {
                assert!(txt.contains("src/") && !txt.contains("app.ts"), "{id}: {txt}");
            }
            "FIND-06" => {
                assert!(txt.contains("worker.py") && !txt.contains("math.ts"), "{id}: {txt}");
            }
            "FIND-07" => {
                let j = parse_json(&txt).expect("find --json");
                assert!(j.as_object().is_some());
                assert!(txt.contains("src/"));
            }
            _ => panic!("unexpected {id}"),
        }
    }

    let mut srch01_out = String::new();
    for c in read_suite("03_search_ranking.json") {
        let (id, cs, _cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, true, &cfg);
        let args = str_args(field(&c, "invocation").and_then(|i| field(i, "args")).unwrap(), false);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = sb.run_cli(&refs, None, false);
        assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
        let txt = s_out(&out);
        match id.as_str() {
            "SRCH-01" => {
                assert!(txt.contains("src/math.ts") && txt.contains("src/app.ts"));
                let pos_app = txt.find("src/app.ts").unwrap();
                let pos_spec = txt.find("src/app.spec.ts").unwrap_or(usize::MAX);
                assert!(pos_app < pos_spec, "prod must rank before test: {txt}");
                srch01_out = txt;
            }
            "SRCH-02" => assert_eq!(txt, srch01_out),
            "SRCH-03" => assert!(txt.contains("src/app.ts") && txt.contains("inc(")),
            "SRCH-04" => {
                assert!(txt.contains("src/math.ts") && txt.contains("src/app.ts"));
                assert!(!txt.contains("this.offset"), "search -l must not emit bodies: {txt}");
            }
            "SRCH-05" => assert!(txt.contains("src/notes.txt") && txt.contains("[a+b]*(c?)")),
            "SRCH-06" => {
                let j = parse_json(&txt).expect("search --json");
                assert!(j.as_object().is_some() || j.as_array().is_some());
                assert!(txt.contains("schema_ansi.sql") && txt.contains("app.ts"));
            }
            _ => panic!("unexpected {id}"),
        }
    }
}

fn run_suite_04(seen: &mut BTreeSet<String>) {
    for c in read_suite("04_read_pipeline.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let args = str_args(field(&c, "invocation").and_then(|i| field(i, "args")).unwrap(), true);
        let refs: Vec<&str> = args.iter().map(String::as_str).collect();
        let out = sb.run_cli(&refs, None, false);
        assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
        let txt = s_out(&out);
        match id.as_str() {
            "READ-01" | "READ-02" => {
                assert!(txt.contains("CalcResult") && txt.contains("Calculator") && txt.contains("fn add") && txt.contains("fn mul"), "{id}: {txt}");
                assert!(!txt.contains("export interface"), "{id} must emit AICE IR: {txt}");
            }
            "READ-03" => assert!(txt.contains("runBatchPipeline") && txt.contains("clampMetric") && txt.contains("summarizeMetrics")),
            "READ-04" => assert!(txt.contains("add(") && (txt.contains("mul") || txt.contains("offset")), "{txt}"),
            "READ-05" => assert!(txt.contains("PipelineMetrics") && txt.contains("runBatchPipeline") && !txt.contains("summarizeMetrics"), "{txt}"),
            "READ-06" => assert!(txt.contains("divisible") || txt.contains("total += i"), "{txt}"),
            "READ-07" => assert!(txt.contains("class App") && txt.contains("add(") && txt.contains("mul(")),
            "READ-08" => {
                assert!(txt.contains("logo.png") && txt.contains("data.bin") && txt.contains("binary"));
                assert!(!out.stdout.contains(&0u8));
            }
            "READ-09" => assert!(txt.contains("notes.txt") && txt.contains("[a+b]*(c?)")),
            "READ-10" => {
                let expected = [
                    ("worker.py", &["module python", "pub class TaskJob", "pub fn run_job("][..]),
                    ("engine.rs", &["module rust", "pub class Engine", "pub fn step("]),
                    ("server.go", &["module server", "pub type Config", "pub fn StartServer("]),
                    ("config.toml", &["module toml", "data toml:", "section \"package\""]),
                    ("widget.dart", &["module dart", "pub class StatusBadge", "pub fn renderText()"]),
                    ("jobs.rb", &["module Jobs", "pub class Runner", "pub fn execute("]),
                    ("schema_ansi.sql", &["module sql", "table \"accounts\"", "query \"sql\" \"select\""]),
                    ("schema.prisma", &["module prisma", "datasource \"db\"", "model \"Account\""]),
                    ("api.graphql", &["module graphql", "gql \"object\" \"Account\"", "query \"graphql\" \"gql\" \"GetAccount\""]),
                    ("graph.cypher", &["module cypher", "cypher:", "clause \"MATCH\""]),
                ];
                for (f, toks) in expected {
                    assert!(txt.contains(f), "{id} missing {f}");
                    for tok in toks {
                        assert!(txt.contains(tok), "{id} missing AICE IR token {tok:?} for {f}: {txt}");
                    }
                }
                assert!(!txt.contains("CREATE TABLE accounts"), "{id} emitted raw SQL");
                assert!(!txt.contains("def run_job("), "{id} emitted raw Python");
            }
            "READ-11" => assert!(txt.contains("App") && txt.contains("inc") && txt.contains("reset")),
            "READ-12" => {
                let j = parse_json(&txt).expect("read --json");
                for k in ["targetPath", "targetContent", "targetOutline", "dependencies", "tokenCount"] {
                    assert!(field(&j, k).is_some(), "{id} missing {k}");
                }
            }
            "READ-13" => {
                let expected = [
                    ("component.tsx", &["module tsx", "pub component StatusCard("][..]),
                    ("helper.js", &["module javascript", "pub fn formatMetric("]),
                    ("native.c", &["module c", "pub type Point2D", "pub fn dot_product("]),
                    ("matrix.cpp", &["module math", "pub class Matrix2", "pub fn trace()"]),
                    ("billing.cs", &["module Billing", "pub class Invoice", "pub fn WithTax("]),
                    ("Service.java", &["module com.aice.golden", "pub class Service", "pub fn greet("]),
                    ("Handler.kt", &["module com.aice.golden", "pub class Handler", "pub fn handle("]),
                    ("controller.php", &["module php", "pub class Controller", "pub fn index("]),
                    ("page.html", &["module html", "pub component Page"]),
                    ("styles.css", &["module css", "style \".status-card\""]),
                    ("card.twig", &["module twig", "pub component Template"]),
                ];
                for (f, toks) in expected {
                    assert!(txt.contains(f), "{id} missing {f}");
                    for tok in toks {
                        assert!(txt.contains(tok), "{id} missing AICE IR token {tok:?} for {f}: {txt}");
                    }
                }
                assert!(!txt.contains("export function formatMetric"), "{id} emitted raw JS");
                assert!(!txt.contains("typedef struct"), "{id} emitted raw C");
            }
            "READ-14" => {
                let expected = [
                    ("manifest.json", &["module json", "data json:"][..]),
                    ("deploy.yaml", &["module yaml", "data yaml:"]),
                    ("config.xml", &["module xml", "xml settings("]),
                    ("diagram.svg", &["module xml", "xml svg("]),
                    ("build.sh", &["module bash", "sh fn run_check:"]),
                    ("guide.md", &["module markdown", "doc 1 \"Golden Architecture Guide\""]),
                ];
                for (f, toks) in expected {
                    assert!(txt.contains(f), "{id} missing {f}");
                    for tok in toks {
                        assert!(txt.contains(tok), "{id} missing AICE IR token {tok:?} for {f}: {txt}");
                    }
                }
                assert!(!txt.contains("<settings version=\"1\">"), "{id} emitted raw XML");
                assert!(!txt.contains("# Golden Architecture Guide"), "{id} emitted raw Markdown");
            }
            "READ-15" => {
                let expected = [
                    ("trigger_pg.sql", &["module postgresql", "proc \"postgresql\" fn \"audit_balance_change\""][..]),
                    ("proc_mysql.sql", &["module mysql", "proc \"mysql\" \"record_invoice\""]),
                    ("local_sqlite.sql", &["module sqlite", "table \"cache_entries\""]),
                    ("report_tsql.sql", &["module tsql", "proc \"tsql\" \"dbo.usp_SyncLedger\""]),
                    ("V001__init_ledger.sql", &["module migration", "migration \"goose\""]),
                ];
                for (f, toks) in expected {
                    assert!(txt.contains(f), "{id} missing {f}");
                    for tok in toks {
                        assert!(txt.contains(tok), "{id} missing AICE IR token {tok:?} for {f}: {txt}");
                    }
                }
            }
            _ => panic!("unexpected {id}"),
        }
    }
}

fn run_suite_05_06(seen: &mut BTreeSet<String>) {
    for c in read_suite("05_splice_write.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let inv = field(&c, "invocation").unwrap();
        let orig_app = fs::read(sb.ws.join("src/app.ts")).unwrap();
        let last_out = if field(inv, "kind").and_then(JsonValue::as_str) == Some("cli_sequence") {
            let mut last = None;
            for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
                let args = str_args(field(cmd, "args").unwrap(), false);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let out = sb.run_cli(&refs, None, false);
                assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
                last = Some(out);
            }
            last.unwrap()
        } else {
            let args = str_args(field(inv, "args").unwrap(), false);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let stdin_s = field(inv, "stdin").and_then(JsonValue::as_str);
            let out = sb.run_cli(&refs, stdin_s, false);
            assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
            out
        };
        if id == "SPL-06" || id == "SPL-09" {
            let math = fs::read_to_string(sb.ws.join("src/math.ts")).unwrap();
            assert!(!math.contains("mul(") && math.contains("public add("), "{id}: {math}");
            if id == "SPL-09" {
                let disk = field(&c, "observedTs0953").and_then(|o| field(o, "diskFilesAfter")).and_then(JsonValue::as_object).unwrap();
                for rel in ["src/batch_helper.ts", "src/app.ts"] {
                    assert_eq!(fs::read_to_string(sb.ws.join(rel)).unwrap(), disk.get(rel).unwrap().as_str().unwrap());
                }
            }
        } else {
            verify_disk_after(&sb.ws, &c, &id);
        }
        if id == "SPL-10" {
            assert_eq!(fs::read(sb.ws.join("src/app.ts")).unwrap(), orig_app);
            let txt = s_out(&last_out);
            assert!(txt.contains("-    this.count = 0;") && txt.contains("+    this.count = 42;"), "{txt}");
        }
        if id == "SPL-11" {
            let j = parse_json(&s_out(&last_out)).expect("SPL-11 json");
            assert_eq!(field(&j, "success").and_then(JsonValue::as_bool), Some(true));
        }
    }

    for c in read_suite("06_firewalls_rollback.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let inv = field(&c, "invocation").unwrap();
        if id == "FW-04" {
            let cmds = field(inv, "commands").unwrap().as_array().unwrap();
            let orig_app = fs::read(sb.ws.join("src/app.ts")).unwrap();
            let a0 = str_args(field(&cmds[0], "args").unwrap(), false);
            let r0: Vec<&str> = a0.iter().map(String::as_str).collect();
            let o0 = sb.run_cli(&r0, None, false);
            assert_eq!(o0.status.code(), Some(1), "FW-04 cmd 0 must exit 1");
            assert_eq!(fs::read(sb.ws.join("src/app.ts")).unwrap(), orig_app);
            let a1 = str_args(field(&cmds[1], "args").unwrap(), false);
            let r1: Vec<&str> = a1.iter().map(String::as_str).collect();
            let o1 = sb.run_cli(&r1, None, false);
            if o1.status.code() == Some(0) {
                verify_disk_after(&sb.ws, &c, &id);
            } else {
                assert_eq!(o1.status.code(), Some(1), "FW-04 cmd 1 unexpected exit: {}", s_err(&o1));
                assert_eq!(fs::read(sb.ws.join("src/app.ts")).unwrap(), orig_app);
            }
        } else if field(inv, "kind").and_then(JsonValue::as_str) == Some("cli_sequence") {
            for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
                let args = str_args(field(cmd, "args").unwrap(), false);
                let refs: Vec<&str> = args.iter().map(String::as_str).collect();
                let out = sb.run_cli(&refs, None, false);
                assert_eq!(out.status.code(), Some(1), "{id}: must exit 1");
            }
            verify_disk_after(&sb.ws, &c, &id);
        } else {
            let args = str_args(field(inv, "args").unwrap(), false);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let stdin_s = field(inv, "stdin").and_then(JsonValue::as_str);
            let out = sb.run_cli(&refs, stdin_s, false);
            assert_eq!(out.status.code(), Some(1), "{id}: must exit 1");
            verify_disk_after(&sb.ws, &c, &id);
        }
    }
}

fn run_suite_07_08(seen: &mut BTreeSet<String>) {
    for c in read_suite("07_mcp_surface.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let reqs = field(&c, "invocation").and_then(|i| field(i, "mcpRequests")).unwrap().as_array().unwrap();
        let (code, resps) = sb.run_mcp(reqs);
        assert_eq!(code, 0, "{id}: mcp exited {code}");
        if id == "MCP-01" {
            let tools = field(&resps[1], "result").and_then(|r| field(r, "tools")).unwrap().as_array().unwrap();
            let names: Vec<&str> = tools.iter().map(|t| field(t, "name").unwrap().as_str().unwrap()).collect();
            assert_eq!(names, vec!["aice_read", "aice_splice"]);
            assert_ne!(field(&resps[2], "result").and_then(|r| field(r, "isError")).and_then(JsonValue::as_bool), Some(true));
            let read_txt = field(&resps[2], "result").and_then(|r| field(r, "content")).unwrap().as_array().unwrap()[0].as_object().unwrap().get("text").unwrap().as_str().unwrap();
            assert!(read_txt.contains("src/math.ts") && read_txt.contains("pub class Calculator") && read_txt.contains("fn add(") && read_txt.contains("siblings in Calculator:") && read_txt.contains("mul") && !read_txt.contains("public add("), "MCP-01 read_txt: {read_txt}");
            let bin_txt = field(&resps[3], "result").and_then(|r| field(r, "content")).unwrap().as_array().unwrap()[0].as_object().unwrap().get("text").unwrap().as_str().unwrap();
            assert!(bin_txt.contains("binary file skipped"));
            assert_ne!(field(&resps[4], "result").and_then(|r| field(r, "isError")).and_then(JsonValue::as_bool), Some(true));
            assert_eq!(field(&resps[5], "result").and_then(|r| field(r, "isError")).and_then(JsonValue::as_bool), Some(true));
            verify_disk_after(&sb.ws, &c, &id);
        } else {
            for r in &resps[1..] {
                assert_eq!(field(r, "result").and_then(|x| field(x, "isError")).and_then(JsonValue::as_bool), Some(true));
                let txt = r.to_compact_string();
                assert!(txt.contains("enabled") && txt.contains("false"), "{id}: {txt}");
            }
        }
    }

    for c in read_suite("08_telemetry_gain.json") {
        let (id, cs, cb, cfg) = case_setup(&c);
        seen.insert(id.clone());
        let sb = GoldenSandbox::new(&id, cs, cb, &cfg);
        let inv = field(&c, "invocation").unwrap();
        let unset = field(inv, "env").is_some();
        let mut last = None;
        for cmd in field(inv, "commands").unwrap().as_array().unwrap() {
            let args = str_args(field(cmd, "args").unwrap(), true);
            let refs: Vec<&str> = args.iter().map(String::as_str).collect();
            let out = sb.run_cli(&refs, None, unset);
            assert_eq!(out.status.code(), Some(0), "{id}: {}", s_err(&out));
            last = Some(out);
        }
        if id == "TEL-01" {
            let j = parse_json(&s_out(&last.unwrap())).expect("TEL-01 gain json");
            assert_eq!(field(&j, "totalOperations").and_then(JsonValue::as_u64), Some(3));
            assert_eq!(field(&j, "readOperations").and_then(JsonValue::as_u64), Some(2));
            assert_eq!(field(&j, "writeOperations").and_then(JsonValue::as_u64), Some(1));
            assert!(field(&j, "nativeCl100k").and_then(JsonValue::as_u64).unwrap() > 0);
            assert!(field(&j, "nativeO200k").and_then(JsonValue::as_u64).unwrap() > 0);
        } else {
            assert!(!sb.telemetry_path.exists(), "TEL-02: /tmp sandbox must not create default gains.jsonl");
        }
    }
}

#[test]
fn golden_baseline_81_of_81_parity() {
    let manifest_raw = fs::read_to_string(repo_root().join("tests/golden/MANIFEST.json")).expect("read MANIFEST.json");
    let manifest = parse_json(&manifest_raw).expect("parse MANIFEST.json");
    assert_eq!(field(&manifest, "totalCases").and_then(JsonValue::as_u64), Some(81));

    let mut seen = BTreeSet::new();
    run_suite_01(&mut seen);
    run_suite_02_03(&mut seen);
    run_suite_04(&mut seen);
    run_suite_05_06(&mut seen);
    run_suite_07_08(&mut seen);
    anti_bypass::run_suite_09(&mut seen);

    assert_eq!(seen.len(), 81, "expected 81 golden cases executed, got {}: {seen:?}", seen.len());
}
