use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};
use std::process::{Command, Output, Stdio};
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::{SystemTime, UNIX_EPOCH};

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::{count_cl100k, count_o200k};

static TEMP_SEQ: AtomicU64 = AtomicU64::new(1);

struct TempWorkspace {
    root: PathBuf,
    home: PathBuf,
    ws: PathBuf,
    telemetry_path: PathBuf,
    errors_path: PathBuf,
}

impl TempWorkspace {
    fn new(tag: &str) -> Self {
        let seq = TEMP_SEQ.fetch_add(1, Ordering::Relaxed);
        let nanos = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map(|d| d.as_nanos())
            .unwrap_or(0);
        let root = std::env::temp_dir().join(format!(
            "aice_w2m4_{tag}_{}_{}_{nanos}",
            std::process::id(),
            seq
        ));
        let home = root.join("home");
        let ws = root.join("ws");
        let telemetry_dir = root.join("telemetry");
        fs::create_dir_all(&home).expect("create temp home");
        fs::create_dir_all(&ws).expect("create temp ws");
        fs::create_dir_all(&telemetry_dir).expect("create temp telemetry dir");
        Self {
            root,
            home,
            ws,
            telemetry_path: telemetry_dir.join("gains.jsonl"),
            errors_path: telemetry_dir.join("errors.jsonl"),
        }
    }

    fn ws(&self) -> &Path {
        &self.ws
    }

    fn write_file(&self, rel: &str, content: &str) {
        let p = self.ws.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(p, content).expect("write fixture");
    }

    fn write_bytes(&self, rel: &str, bytes: &[u8]) {
        let p = self.ws.join(rel);
        if let Some(parent) = p.parent() {
            fs::create_dir_all(parent).expect("create parent");
        }
        fs::write(p, bytes).expect("write bytes");
    }

    fn run_isolated(&self, args: &[&str], with_telemetry_env: bool) -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_aice"));
        cmd.args(args)
            .current_dir(&self.ws)
            .env("HOME", &self.home)
            .env("AICE_AGENT_HOME", &self.home)
            .env_remove("AICE_HOME")
            .env_remove("AICE_TELEMETRY_DIR")
            .env_remove("AICE_TELEMETRY_ERRORS_PATH")
            .env_remove("AICE_TELEMETRY_PATH");
        if with_telemetry_env {
            cmd.env("AICE_TELEMETRY_PATH", &self.telemetry_path);
        }
        cmd.output().expect("run aice binary")
    }

    fn run_with_empty_path(&self, args: &[&str]) -> Output {
        Command::new(env!("CARGO_BIN_EXE_aice"))
            .args(args)
            .current_dir(&self.ws)
            .env("PATH", "")
            .env("HOME", &self.home)
            .env("AICE_AGENT_HOME", &self.home)
            .env("AICE_TELEMETRY_PATH", &self.telemetry_path)
            .env_remove("AICE_HOME")
            .env_remove("AICE_TELEMETRY_DIR")
            .output()
            .expect("run aice with empty PATH")
    }
}

impl Drop for TempWorkspace {
    fn drop(&mut self) {
        let _ = fs::remove_dir_all(&self.root);
    }
}

fn stdout_str(out: &Output) -> String {
    String::from_utf8_lossy(&out.stdout).into_owned()
}

fn stderr_str(out: &Output) -> String {
    String::from_utf8_lossy(&out.stderr).into_owned()
}

fn field<'a>(v: &'a JsonValue, k: &str) -> Option<&'a JsonValue> {
    v.as_object().and_then(|m| m.get(k))
}

#[test]
fn version_help_and_retired_commands_b_s2() {
    let tw = TempWorkspace::new("help_bs2");
    for flag in ["-V", "--version"] {
        let out = tw.run_isolated(&[flag], true);
        assert_eq!(out.status.code(), Some(0));
        assert_eq!(stdout_str(&out).trim(), "0.9.53");
        assert!(!tw.ws().join("aice.config.json").exists());
        assert!(!tw.telemetry_path.exists());
    }

    for args in [&[][..], &["-h"], &["--help"], &["read", "--help"]] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(0));
        let txt = stdout_str(&out);
        for cmd in [
            "read", "search", "find", "splice", "enable", "disable", "config", "agents", "gain",
            "analyze", "mcp", "benchmark",
        ] {
            assert!(txt.contains(cmd), "Help missing canonical command '{cmd}'");
        }
    }

    // `--` stops `--help` flag detection so `search -- --help` runs search.
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/flags.txt", "usage: --help\n");
    let dashdash = tw.run_isolated(&["search", "--", "--help"], true);
    assert_eq!(dashdash.status.code(), Some(0));
    let dd_out = stdout_str(&dashdash);
    assert!(!dd_out.contains("USAGE:"), "--help after -- must not trigger CLI help");
    assert!(dd_out.contains("src/flags.txt") && dd_out.contains("--help"));

    for retired in [
        "fmt", "diff", "create", "new", "compile", "compile-all", "decompile", "roundtrip",
        "verify", "outline", "tokens", "verify-tokenomics", "patch", "fix", "idioms", "bogus",
    ] {
        let out = tw.run_isolated(&[retired], true);
        assert_eq!(out.status.code(), Some(1), "Retired '{retired}' must fail");
        assert!(stdout_str(&out).is_empty());
        assert!(!stderr_str(&out).is_empty());
    }

    for bad_flag in [
        &["read", "src/a.rs", "--bogus-flag"][..],
        &["gain", "--bogus-flag"][..],
        &["splice", "src/a.rs", "--bogus-flag"][..],
    ] {
        let out = tw.run_isolated(bad_flag, true);
        assert_eq!(out.status.code(), Some(1), "Unknown flag must fail: {bad_flag:?}");
    }
}

#[test]
fn governance_lifecycle_gov01_through_gov06() {
    let tw = TempWorkspace::new("gov01_06");
    tw.write_file("src/app.ts", "export const x = 1;\n");

    // GOV-01: missing config defaults
    let gov01 = tw.run_isolated(&["status", "--json"], false);
    assert_eq!(gov01.status.code(), Some(0));
    let v01 = parse_json(&stdout_str(&gov01)).expect("valid json GOV-01");
    assert_eq!(field(&v01, "enabled").and_then(JsonValue::as_bool), Some(true));

    // GOV-02: enable --json + idempotent enable + AGENTS.md marker <= 650 BPE tokens
    let en1 = tw.run_isolated(&["enable", "--json"], false);
    assert_eq!(en1.status.code(), Some(0));
    let en2 = tw.run_isolated(&["enable"], false);
    assert_eq!(en2.status.code(), Some(0));
    assert!(stdout_str(&en2).contains("AICE ENABLED"));
    let agents_md = fs::read_to_string(tw.ws().join("AGENTS.md")).expect("read AGENTS.md");
    assert_eq!(agents_md.matches("<!-- AICE:START").count(), 1);
    assert!(count_cl100k(&agents_md) <= 650);
    assert!(count_o200k(&agents_md) <= 650);

    // GOV-03: retired idiom flags are cleanly rejected post-R7 Kill
    for retired in [
        &["config", "--idioms-on"][..],
        &["config", "--idioms-off"][..],
        &["read", "src/app.ts", "--idioms"][..],
        &["read", "src/app.ts", "--no-idioms"][..],
        &["splice", "src/app.ts", "--idiom", "x", "-c", "export const x = 2;"][..],
    ] {
        let rej = tw.run_isolated(retired, false);
        assert_eq!(rej.status.code(), Some(1), "Retired flag must fail: {retired:?}");
        assert!(stdout_str(&rej).is_empty());
        assert!(!stderr_str(&rej).is_empty());
    }

    // GOV-04: disabled blocks read/find/search/splice with exit 1, zero telemetry, admin still ok
    let dis = tw.run_isolated(&["disable", "--json"], true);
    assert_eq!(dis.status.code(), Some(0));
    for blocked in [
        &["read", "src/app.ts"][..],
        &["read", "--files"][..],
        &["find"][..],
        &["tree"][..],
        &["search", "export"][..],
        &["grep", "export"][..],
        &["splice", "src/app.ts", "-c", "export const y = 2;"][..],
        &["write", "src/app.ts", "-c", "export const y = 2;"][..],
    ] {
        let res = tw.run_isolated(blocked, true);
        assert_eq!(res.status.code(), Some(1), "Disabled must block {blocked:?}");
        assert!(stdout_str(&res).is_empty());
        let err = stderr_str(&res);
        assert!(err.contains("aice.config.json") && err.contains("\"enabled\": false"));
    }
    assert!(!tw.telemetry_path.exists(), "Disabled ops must not write telemetry");
    assert_eq!(
        fs::read_to_string(tw.ws().join("src/app.ts")).unwrap(),
        "export const x = 1;\n"
    );

    for admin in [
        &["status", "--json"][..],
        &["config", "--json"][..],
        &["agents", "status", "--json"][..],
        &["gain", "--json"][..],
        &["analyze", "--json"][..],
        &["--version"][..],
        &["--help"][..],
    ] {
        let res = tw.run_isolated(admin, true);
        assert_eq!(res.status.code(), Some(0), "Admin {admin:?} must run when disabled");
    }

    // GOV-06: disable + enable preserves idioms + extra fields
    let tw6 = TempWorkspace::new("gov06");
    tw6.write_file(
        "aice.config.json",
        "{\n  \"enabled\": true,\n  \"idiomsEnabled\": true,\n  \"customKeep\": 42,\n  \"idioms\": {\"$id\": {\"name\": \"$id\"}}\n}\n",
    );
    assert_eq!(tw6.run_isolated(&["disable", "--json"], false).status.code(), Some(0));
    let re = tw6.run_isolated(&["enable", "--json"], false);
    assert_eq!(re.status.code(), Some(0));
    let vre = parse_json(&stdout_str(&re)).expect("json gov06");
    assert_eq!(field(&vre, "enabled").and_then(JsonValue::as_bool), Some(true));
    let cfg_disk = fs::read_to_string(tw6.ws().join("aice.config.json")).unwrap();
    assert!(cfg_disk.contains("\"customKeep\": 42"));
    assert!(cfg_disk.contains("\"idiomsEnabled\": true"));
    assert!(cfg_disk.contains("\"$id\""));

    // GOV-05: legacy .aicerc discovery
    let tw5 = TempWorkspace::new("gov05");
    tw5.write_file(".aicerc", "{\"enabled\": true, \"idiomsEnabled\": false}\n");
    let st5 = tw5.run_isolated(&["status", "--json"], false);
    assert_eq!(st5.status.code(), Some(0));
    let v5 = parse_json(&stdout_str(&st5)).expect("json gov05");
    assert_eq!(field(&v5, "enabled").and_then(JsonValue::as_bool), Some(true));
}

#[test]
fn admin_commands_reject_nonexistent_and_file_targets_without_disk_writes() {
    let tw = TempWorkspace::new("admin_bad_target");
    tw.write_file("aice.config.json", "{\"enabled\": false}\n");
    tw.write_file("src/app.ts", "export const x = 1;\n");
    let cfg_before = fs::read_to_string(tw.ws().join("aice.config.json")).expect("read cfg");

    for target in ["nonexistent_subdir_xyz", "src/app.ts"] {
        for args in [
            &["enable", target][..],
            &["disable", target][..],
            &["status", target][..],
            &["config", target][..],
            &["config", "--enable", target][..],
            &["config", "--disable", target][..],
        ] {
            let out = tw.run_isolated(args, false);
            assert_eq!(
                out.status.code(),
                Some(1),
                "Admin command {args:?} on '{target}' must fail with exit 1"
            );
            assert!(
                stdout_str(&out).is_empty(),
                "Admin command {args:?} failure must emit empty stdout"
            );
            assert!(
                !stderr_str(&out).is_empty(),
                "Admin command {args:?} failure must emit diagnostic on stderr"
            );
        }
    }

    assert!(!tw.ws().join("nonexistent_subdir_xyz").exists());
    assert_eq!(
        fs::read_to_string(tw.ws().join("aice.config.json")).expect("read cfg after"),
        cfg_before
    );
}

#[test]
fn admin_commands_reject_empty_and_whitespace_targets_without_disk_writes() {
    // 1. Existing disabled config: empty/whitespace targets must fail (exit 1) and never mutate cwd.
    let tw = TempWorkspace::new("admin_empty_target");
    tw.write_file("aice.config.json", "{\"enabled\": false}\n");
    let cfg_before = fs::read_to_string(tw.ws().join("aice.config.json")).expect("read cfg");

    for target in ["", "   "] {
        for args in [
            &["enable", target][..],
            &["enable", "--", target][..],
            &["disable", target][..],
            &["status", target][..],
            &["config", target][..],
            &["config", "--enable", target][..],
            &["config", "--disable", target][..],
        ] {
            let out = tw.run_isolated(args, false);
            assert_eq!(
                out.status.code(),
                Some(1),
                "Admin command {args:?} on {target:?} must fail with exit 1"
            );
            assert!(
                stdout_str(&out).is_empty(),
                "Admin command {args:?} on {target:?} failure must emit empty stdout, got: {:?}",
                stdout_str(&out)
            );
            assert!(
                !stderr_str(&out).is_empty(),
                "Admin command {args:?} on {target:?} failure must emit diagnostic on stderr"
            );
        }
    }
    assert_eq!(
        fs::read_to_string(tw.ws().join("aice.config.json")).expect("read cfg after"),
        cfg_before
    );
    assert!(!tw.ws().join("AGENTS.md").exists());

    // 2. Unmarked directory (no aice.config.json): empty targets must not create config or AGENTS.md.
    let tw_clean = TempWorkspace::new("admin_empty_clean");
    for args in [
        &["enable", ""][..],
        &["disable", ""][..],
        &["status", ""][..],
        &["config", ""][..],
        &["config", "--enable", ""][..],
        &["config", "--disable", ""][..],
    ] {
        let out = tw_clean.run_isolated(args, false);
        assert_eq!(out.status.code(), Some(1), "clean {args:?} must exit 1");
        assert!(stdout_str(&out).is_empty(), "clean {args:?} stdout must be empty");
        assert!(!stderr_str(&out).is_empty(), "clean {args:?} stderr must be non-empty");
    }
    assert!(!tw_clean.ws().join("aice.config.json").exists());
    assert!(!tw_clean.ws().join("AGENTS.md").exists());

    // 3. Omitting positional [dir] still defaults to cwd cleanly.
    let st_def = tw_clean.run_isolated(&["status"], false);
    assert_eq!(st_def.status.code(), Some(0), "omitted dir status must default to cwd");
    let en_def = tw_clean.run_isolated(&["enable"], false);
    assert_eq!(en_def.status.code(), Some(0), "omitted dir enable must default to cwd");
    assert!(tw_clean.ws().join("aice.config.json").is_file());
    let dis_def = tw_clean.run_isolated(&["disable"], false);
    assert_eq!(dis_def.status.code(), Some(0), "omitted dir disable must default to cwd");

    // 4. gain/analyze empty -p/--project/positional/--transcripts-dir also reject cleanly.
    for args in [
        &["gain", "-p", ""][..],
        &["gain", "--project="][..],
        &["gain", ""][..],
        &["analyze", "-p", ""][..],
        &["analyze", "--project="][..],
        &["analyze", ""][..],
        &["analyze", "--transcripts-dir", ""][..],
        &["analyze", "--transcripts-dir="][..],
    ] {
        let out = tw.run_isolated(args, false);
        assert_eq!(
            out.status.code(),
            Some(1),
            "Telemetry admin command {args:?} must reject empty target with exit 1"
        );
        assert!(stdout_str(&out).is_empty());
        assert!(!stderr_str(&out).is_empty());
    }
}

#[test]
fn agents_cli_setup_status_and_remove_in_isolated_home() {
    let tw = TempWorkspace::new("agents");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");

    let st = tw.run_isolated(&["agents", "status", "--json"], false);
    assert_eq!(st.status.code(), Some(0));
    let vst = parse_json(&stdout_str(&st)).expect("agents status json");
    assert_eq!(field(&vst, "agents").and_then(JsonValue::as_array).map(|a| a.len()), Some(7));

    // Flag before action (`-a gemini status`) must filter cleanly to `agy`.
    let filt = tw.run_isolated(&["agents", "-a", "gemini", "status", "--json"], false);
    assert_eq!(filt.status.code(), Some(0));
    let vfilt = parse_json(&stdout_str(&filt)).expect("agents filtered json");
    let arr = field(&vfilt, "agents").and_then(JsonValue::as_array).unwrap();
    assert_eq!(arr.len(), 1);
    assert_eq!(field(&arr[0], "id").and_then(JsonValue::as_str), Some("agy"));

    let setup = tw.run_isolated(&["agents", "setup", "-a", "claude", "--global-rules", "--json"], false);
    assert_eq!(setup.status.code(), Some(0));
    let vsetup = parse_json(&stdout_str(&setup)).expect("agents setup json");
    let claude = &field(&vsetup, "agents").and_then(JsonValue::as_array).unwrap()[0];
    assert_eq!(field(claude, "mcpConfigured").and_then(JsonValue::as_bool), Some(true));
    assert_eq!(field(claude, "promptConfigured").and_then(JsonValue::as_bool), Some(true));
    assert!(tw.home.join(".claude.json").is_file());
    assert!(tw.home.join(".claude/CLAUDE.md").is_file());

    let rm = tw.run_isolated(&["agents", "remove", "-a", "claude", "--json"], false);
    assert_eq!(rm.status.code(), Some(0));
    let vrm = parse_json(&stdout_str(&rm)).expect("agents remove json");
    let claude_after = &field(&vrm, "agents").and_then(JsonValue::as_array).unwrap()[0];
    assert_eq!(field(claude_after, "mcpConfigured").and_then(JsonValue::as_bool), Some(false));

    let bad = tw.run_isolated(&["agents", "-a", "nonexistent_agent", "status"], false);
    assert_eq!(bad.status.code(), Some(1));
}

#[test]
fn flag_normalization_watch1_symmetry_and_governance_guards() {
    let tw = TempWorkspace::new("norm_watch1");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/app.ts", "export class App {\n  inc(): number { return 1; }\n  reset(): number { return 0; }\n}\n");
    tw.write_bytes("bin/logo.png", b"\x89PNG\r\n\x1a\n\x00\x00\x00\rIHDR");
    tw.write_bytes("bin/data.bin", b"\x00\x01\x02\x03\xff");

    // Read context-aware flags normalize cleanly
    let r = tw.run_isolated(
        &[
            "read", "src/app.ts", "-c", "3", "--filesOnly", "--includeDeps=false",
            "--includeCallers=true", "--maxDepth=2", "--outlineTarget", "--types=false",
        ],
        true,
    );
    assert_eq!(r.status.code(), Some(0));

    // Splice keeps `-c` as `--code` (never `-C`)
    let s_ok = tw.run_isolated(
        &["splice", "src/app.ts", "-s", "App.inc", "-c", "  inc(): number { return 2; }"],
        true,
    );
    assert_eq!(s_ok.status.code(), Some(0));

    // Watch #1 comma-selector symmetry: regex anywhere in comma selector rejected on splice
    for bad_sel in [
        "src/app.ts:/broken/,App.inc",
        "src/app.ts:App.inc,/broken/",
        "src/app.ts:App.inc,/broken/i",
    ] {
        let out = tw.run_isolated(&["splice", bad_sel, "-c", "export const ok = 1;"], true);
        assert_eq!(out.status.code(), Some(1), "Regex selector '{bad_sel}' must fail on splice");
    }
    let sym_ok = tw.run_isolated(
        &["splice", "src/app.ts:App.reset", "-c", "  reset(): number { return 42; }"],
        true,
    );
    assert_eq!(sym_ok.status.code(), Some(0));

    // Path escapes blocked across read/search/find/splice
    for bad in [
        &["read", "../../etc/passwd"][..],
        &["read", "/etc/shadow"][..],
        &["read", "safe:/../../../etc/shadow"][..],
        &["search", "root", "../../etc"][..],
        &["find", "../../etc"][..],
        &["splice", "../../etc/passwd", "-c", "evil"][..],
    ] {
        let out = tw.run_isolated(bad, true);
        assert_eq!(out.status.code(), Some(1), "Path escape must fail: {bad:?}");
    }

    // FW-03: binary files remain byte-identical
    let png_before = fs::read(tw.ws().join("bin/logo.png")).unwrap();
    let bin_before = fs::read(tw.ws().join("bin/data.bin")).unwrap();
    assert_eq!(tw.run_isolated(&["splice", "bin/logo.png", "-c", "corrupt"], true).status.code(), Some(1));
    assert_eq!(tw.run_isolated(&["splice", "bin/data.bin", "--overwrite", "-c", "corrupt"], true).status.code(), Some(1));
    assert_eq!(fs::read(tw.ws().join("bin/logo.png")).unwrap(), png_before);
    assert_eq!(fs::read(tw.ws().join("bin/data.bin")).unwrap(), bin_before);

    // --from firewall rejection & allowedReadRoots read-vs-splice asymmetry
    tw.write_file("src/bad_patch.ts", "export function broken(: {");
    assert_eq!(
        tw.run_isolated(&["splice", "src/app.ts", "--from", "src/bad_patch.ts"], true).status.code(),
        Some(1)
    );
    let ext_dir = tw.root.join("ext_docs");
    fs::create_dir_all(&ext_dir).unwrap();
    fs::write(ext_dir.join("notes.txt"), "external note\n").unwrap();
    tw.write_file(
        "aice.config.json",
        &format!("{{\"enabled\": true, \"allowedReadRoots\": [\"{}\"]}}\n", ext_dir.display()),
    );
    let ext_file = ext_dir.join("notes.txt").display().to_string();
    assert_eq!(tw.run_isolated(&["read", &ext_file], true).status.code(), Some(0));
    assert_eq!(
        tw.run_isolated(&["splice", &ext_file, "-c", "overwrite"], true).status.code(),
        Some(1)
    );
}

#[test]
fn prewrite_firewall_bw1_bw3_bw4_and_failure_telemetry() {
    let tw = TempWorkspace::new("fw_cli");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/app.ts", "export function ok(): number { return 1; }\n");
    tw.write_file("src/engine.rs", "pub fn step() -> i32 { 1 }\n");
    tw.write_file("src/server.go", "package p\nfunc Start() int { return 1 }\n");
    tw.write_file("src/worker.py", "def run_job():\n    return 1\n");
    tw.write_file("src/build.sh", "#!/usr/bin/env bash\necho ok\n");
    tw.write_file("src/schema.sql", "CREATE TABLE t (id INT PRIMARY KEY);\n");
    tw.write_file("src/card.twig", "{% if ok %}<p>{{ x }}</p>{% endif %}\n");

    let cases = [
        ("src/app.ts", "public inc(): { broken ==="),
        ("src/engine.rs", "pub fn step() { let = ; }"),
        ("src/server.go", "package p\nfunc Start() { var = 1 }"),
        ("src/worker.py", "def run_job(:\n    return 1"),
        ("src/build.sh", "if then\nfi"),
        ("src/schema.sql", "SELECT FROM accounts;"),
        ("src/card.twig", "{% if unclosed %}"),
    ];
    for (file, bad_code) in cases {
        let before = fs::read(tw.ws().join(file)).unwrap();
        let out = tw.run_isolated(&["splice", file, "--force", "-c", bad_code], true);
        assert_eq!(out.status.code(), Some(1), "B-W1 --force must not bypass {file}");
        assert!(stdout_str(&out).is_empty(), "Firewall rejection stdout must be empty for {file}");
        assert!(!stderr_str(&out).is_empty(), "Firewall rejection must write stderr for {file}");
        assert_eq!(fs::read(tw.ws().join(file)).unwrap(), before, "Disk mutated for {file}");
    }

    // B-W4: empty PATH still blocks invalid Python & Bash in-process
    for (file, bad_code) in [
        ("src/worker.py", "def run_job():\n    if x > :\n        return 1"),
        ("src/build.sh", "#!/usr/bin/env bash\nif then\nfi"),
    ] {
        let before = fs::read(tw.ws().join(file)).unwrap();
        let out = tw.run_with_empty_path(&["splice", file, "-c", bad_code]);
        assert_eq!(out.status.code(), Some(1));
        assert_eq!(fs::read(tw.ws().join(file)).unwrap(), before);
    }

    // Failure telemetry recorded to errors.jsonl & <cli-error>, never as a Splice win
    assert!(tw.errors_path.is_file(), "errors.jsonl must record firewall failures");
    let gains_raw = fs::read_to_string(&tw.telemetry_path).expect("read gains.jsonl");
    assert!(gains_raw.contains("\"<cli-error>\""));
    assert!(!gains_raw.contains("\"f\":\"src/app.ts\""));

    let gain = tw.run_isolated(&["gain", "--json"], true);
    assert_eq!(gain.status.code(), Some(0));
    let vgain = parse_json(&stdout_str(&gain)).expect("gain json");
    let by_cmd = field(&vgain, "byCommand").and_then(JsonValue::as_array).unwrap();
    let splice_row = by_cmd
        .iter()
        .find(|r| field(r, "command").and_then(JsonValue::as_str) == Some("splice/write"))
        .unwrap();
    assert_eq!(field(splice_row, "winCalls").and_then(JsonValue::as_u64), Some(0));
    assert!(field(splice_row, "errorCalls").and_then(JsonValue::as_u64).unwrap_or(0) >= 1);
}

#[test]
fn honest_bpe_telemetry_tel01_tel02_search_classification_gain_analyze() {
    // TEL-02: ephemeral /tmp workspace without override env creates ZERO gains.jsonl
    let tw_ephem = TempWorkspace::new("tel02");
    tw_ephem.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw_ephem.write_file("src/big.ts", "export const greeting = 'hello world';\n");
    assert_eq!(tw_ephem.run_isolated(&["read", "src/big.ts"], false).status.code(), Some(0));
    assert!(!tw_ephem.home.join(".aice/telemetry/gains.jsonl").exists());
    let g0 = tw_ephem.run_isolated(&["gain", "--json"], false);
    assert_eq!(g0.status.code(), Some(0));
    let vg0 = parse_json(&stdout_str(&g0)).unwrap();
    assert_eq!(field(&vg0, "totalOperations").and_then(JsonValue::as_u64), Some(0));

    // TEL-01 + B-T1..B-T6: exact cl100k/o200k, negative deltas, search classification, gain/analyze
    let tw = TempWorkspace::new("tel01");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/cjk.rs", "// 日本語テスト\npub fn greet() -> &'static str { \"こんにちは\" }\n");

    let r_out = tw.run_isolated(&["read", "src/cjk.rs"], true);
    assert_eq!(r_out.status.code(), Some(0));
    let s_out = tw.run_isolated(&["search", "greet"], true);
    assert_eq!(s_out.status.code(), Some(0));
    let f_out = tw.run_isolated(&["find"], true);
    assert_eq!(f_out.status.code(), Some(0));

    let ledger_lines: Vec<String> = fs::read_to_string(&tw.telemetry_path)
        .expect("read gains.jsonl")
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(ledger_lines.len(), 3);

    let r_row = parse_json(&ledger_lines[0]).unwrap();
    let r_stdout = stdout_str(&r_out);
    assert_eq!(field(&r_row, "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&r_stdout) as u64));
    assert_eq!(field(&r_row, "a2").and_then(JsonValue::as_u64), Some(count_o200k(&r_stdout) as u64));
    assert_eq!(field(&r_row, "l").and_then(JsonValue::as_str), Some("Rust"));

    let s_row = parse_json(&ledger_lines[1]).unwrap();
    assert_eq!(field(&s_row, "sm").and_then(JsonValue::as_u64), Some(1));
    assert_eq!(field(&s_row, "f").and_then(JsonValue::as_str), Some("<directory>"));

    // Verify honest rg search telemetry and un-clamped negative delta on tiny TS read (B-T4)
    let f_row = parse_json(&ledger_lines[2]).unwrap();
    assert_eq!(field(&f_row, "f").and_then(JsonValue::as_str), Some("<workspace-files>"));
    let s_n1 = field(&s_row, "n1").and_then(JsonValue::as_u64).unwrap();
    let s_a1 = field(&s_row, "a1").and_then(JsonValue::as_u64).unwrap();
    assert!(s_n1 > 0, "Expected non-zero honest rg baseline for search");
    assert_eq!(s_a1, count_cl100k(&stdout_str(&s_out)) as u64);

    tw.write_file("src/tiny.ts", "export const x = 1;\n");
    let tiny_out = tw.run_isolated(&["read", "src/tiny.ts"], true);
    assert_eq!(tiny_out.status.code(), Some(0));
    let ledger_after: Vec<String> = fs::read_to_string(&tw.telemetry_path)
        .expect("read gains.jsonl")
        .lines()
        .map(str::to_string)
        .collect();
    let tiny_row = parse_json(&ledger_after[3]).unwrap();
    let t_n1 = field(&tiny_row, "n1").and_then(JsonValue::as_i64).unwrap();
    let t_a1 = field(&tiny_row, "a1").and_then(JsonValue::as_i64).unwrap();
    assert!(t_n1 - t_a1 < 0, "Expected un-clamped negative delta on tiny.ts (B-T4)");

    let g_all = tw.run_isolated(&["gain", "--json"], true);
    assert_eq!(g_all.status.code(), Some(0));
    let vg = parse_json(&stdout_str(&g_all)).expect("gain --json");
    assert_eq!(field(&vg, "totalOperations").and_then(JsonValue::as_u64), Some(4));
    let by_cmd = field(&vg, "byCommand").and_then(JsonValue::as_array).unwrap();
    let search_calls = by_cmd
        .iter()
        .find(|r| field(r, "command").and_then(JsonValue::as_str) == Some("search"))
        .and_then(|r| field(r, "calls"))
        .and_then(JsonValue::as_u64);
    assert_eq!(search_calls, Some(1));

    // Project detail gain -p . --json
    let g_proj = tw.run_isolated(&["gain", "-p", ".", "--json"], true);
    assert_eq!(g_proj.status.code(), Some(0));
    let vgp = parse_json(&stdout_str(&g_proj)).expect("gain -p . --json");
    assert!(field(&vgp, "project").is_some());

    // Analyze with isolated transcripts dir
    let tdir = tw.root.join("transcripts");
    fs::create_dir_all(&tdir).unwrap();
    fs::write(tdir.join("session.jsonl"), "{\"type\":\"assistant\"}\n").unwrap();
    let an = tw.run_isolated(
        &["analyze", "-p", ".", "--transcripts-dir", &tdir.display().to_string(), "--json"],
        true,
    );
    assert_eq!(an.status.code(), Some(0));
    let van = parse_json(&stdout_str(&an)).expect("analyze --json");
    for key in ["workspaceStats", "bpeSavings", "frictionAudit", "endToEndEconomics"] {
        assert!(field(&van, key).is_some(), "analyze --json missing '{key}'");
    }

    // Reset requires -y
    assert_eq!(tw.run_isolated(&["gain", "--reset"], true).status.code(), Some(1));
    assert!(tw.telemetry_path.exists());
    let reset_ok = tw.run_isolated(&["gain", "--reset", "-y", "--json"], true);
    assert_eq!(reset_ok.status.code(), Some(0));
    assert!(!tw.telemetry_path.exists());
}

#[test]
fn filtered_find_telemetry_honesty_and_option_value_help_and_watch1_vectors() {
    // 1. Filtered find & 0-match find telemetry honesty
    let tw_find = TempWorkspace::new("find_honest");
    tw_find.write_file("aice.config.json", "{\"enabled\": true}\n");
    for rel in [
        "src/alpha.rs",
        "src/beta.rs",
        "src/gamma.rs",
        "src/delta.rs",
        "src/needle.rs",
    ] {
        tw_find.write_file(rel, "pub fn f() {}\n");
    }
    let f_match = tw_find.run_isolated(&["find", "needle"], true);
    assert_eq!(f_match.status.code(), Some(0));
    let f_stdout = stdout_str(&f_match);
    assert_eq!(f_stdout.trim(), "src/needle.rs (1L)");

    let f_zero = tw_find.run_isolated(&["find", "definitely_absent_token_xyz"], true);
    assert_eq!(f_zero.status.code(), Some(0));
    assert!(stdout_str(&f_zero).is_empty());

    let find_rows: Vec<String> = fs::read_to_string(&tw_find.telemetry_path)
        .expect("read find gains.jsonl")
        .lines()
        .map(str::to_string)
        .collect();
    assert_eq!(find_rows.len(), 2);
    let match_row = parse_json(&find_rows[0]).unwrap();
    let fd_baseline = "src/needle.rs\n";
    assert_eq!(
        field(&match_row, "n1").and_then(JsonValue::as_u64),
        Some(count_cl100k(fd_baseline) as u64)
    );
    assert_eq!(
        field(&match_row, "n2").and_then(JsonValue::as_u64),
        Some(count_o200k(fd_baseline) as u64)
    );
    assert_eq!(
        field(&match_row, "nc").and_then(JsonValue::as_u64),
        Some(fd_baseline.chars().count() as u64)
    );
    assert_eq!(
        field(&match_row, "a1").and_then(JsonValue::as_u64),
        Some(count_cl100k(&f_stdout) as u64)
    );
    let zero_row = parse_json(&find_rows[1]).unwrap();
    assert_eq!(field(&zero_row, "n1").and_then(JsonValue::as_u64), Some(0));
    assert_eq!(field(&zero_row, "n2").and_then(JsonValue::as_u64), Some(0));
    assert_eq!(field(&zero_row, "nc").and_then(JsonValue::as_u64), Some(0));
    assert_eq!(field(&zero_row, "a1").and_then(JsonValue::as_u64), Some(0));
    assert_eq!(field(&zero_row, "a2").and_then(JsonValue::as_u64), Some(0));

    // 2. Option-value -h / --help must NOT trigger help text
    let tw = TempWorkspace::new("w2m4_r2_guards");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("file.rs", "pub fn Sym() {}\npub fn Other() {}\n");

    for read_args in [
        &["read", "--search", "-h", "file.rs"][..],
        &["read", "--search", "--help", "file.rs"][..],
    ] {
        let out = tw.run_isolated(read_args, true);
        assert_eq!(out.status.code(), Some(0), "{read_args:?} failed");
        let txt = stdout_str(&out);
        assert!(!txt.contains("USAGE:"), "Help hijacked option value: {read_args:?}");
        assert!(txt.contains("file.rs"));
    }
    let find_h = tw.run_isolated(&["find", "--search", "-h"], true);
    assert_eq!(find_h.status.code(), Some(0));
    assert!(!stdout_str(&find_h).contains("USAGE:"));

    for splice_args in [
        &["splice", "file.rs", "-c", "-h"][..],
        &["splice", "file.rs", "--code", "--help"][..],
    ] {
        let out = tw.run_isolated(splice_args, true);
        assert_eq!(out.status.code(), Some(1), "Syntax firewall must reject '-h' payload");
        assert!(stdout_str(&out).is_empty(), "Must not print USAGE on {splice_args:?}");
        assert!(!stderr_str(&out).is_empty());
    }

    // 3. All Watch #1 + firewall bypass vectors must exit 1 with empty stdout
    let blocked_splice_vectors: &[&[&str]] = &[
        &["splice", "-s", "Sym", "file.rs:Sym,/evil/", "-c", "pub fn BROKEN( {"],
        &["splice", "file.rs:Sym,/evil/", "Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "-f", "file.rs:Sym,/evil/", "-d", "Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "-s", "Sym", "file.rs:nonexistent", "-c", "pub fn BROKEN( {"],
        &["splice", "-s", "Sym", "file.rs:Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "file.rs:Sym, /evil/", "-c", "pub fn BROKEN( {"],
        &["splice", "file.rs", "-s", "Sym, /evil/", "-c", "pub fn ok() {}"],
        &["splice", "file.rs", "--delete=Sym,/evil/"],
        &["splice", "file.rs", "-d", "Sym, /evil/"],
        &["splice", "--batch", "=== file.rs:Sym,/evil/ ===\npub fn ok() {}\n"],
        &["splice", "--batch", "=== file.rs:/evil/ ===\npub fn ok() {}\n"],
        &["splice", "--batch", "=== file.rs:Sym, /evil/ ===\npub fn ok() {}\n"],
        &["splice", "--edits", "[{\"path\":\"file.rs:Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs:/evil/\",\"code\":\"pub fn BROKEN( {\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs:Sym, /evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs\",\"symbol\":\"/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "file.rs", "--maxDepth", "2", "-c", "pub fn ok() {}"],
    ];
    for vec_args in blocked_splice_vectors {
        let out = tw.run_isolated(vec_args, true);
        assert_eq!(
            out.status.code(),
            Some(1),
            "Vector must exit 1: {vec_args:?} (stdout={:?}, stderr={:?})",
            stdout_str(&out),
            stderr_str(&out)
        );
        assert!(stdout_str(&out).is_empty(), "Vector must have empty stdout: {vec_args:?}");
        assert!(!stderr_str(&out).is_empty(), "Vector must write stderr: {vec_args:?}");
    }

    // 4. Space-separated `-s <sym> --delete <other>` parses cleanly
    let del_ok = tw.run_isolated(
        &["splice", "file.rs", "-s", "Sym", "--delete", "Other", "-c", "pub fn Sym() {}"],
        true,
    );
    assert_eq!(del_ok.status.code(), Some(0));
}

#[test]
fn delete_before_file_and_json_insert_anchor_watch1_regressions() {
    let tw = TempWorkspace::new("w2m4_r3_regressions");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("file.rs", "pub fn Sym() {}\npub fn Other() {}\n");
    tw.write_file("src/sub.rs", "pub fn Sub() {}\n");

    // Probes 1-3 + JSON insert_after/insertAfter/insert_before/insertBefore Watch #1
    let blocked: &[&[&str]] = &[
        &["splice", "--delete", "Other,/evil/", "file.rs", "-c", "pub fn BROKEN( {"],
        &["splice", "-d", "Other,/evil/", "file.rs", "-c", "pub fn BROKEN( {"],
        &["splice", "--delete", "Sym", "file.rs", "-c", "pub fn BROKEN( {"],
        &["splice", "-d", "Sym", "file.rs", "-c", "pub fn BROKEN( {"],
        &["splice", "--edits", "[{\"path\":\"file.rs\",\"insert_after\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs\",\"insertAfter\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs\",\"insert_before\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--edits", "[{\"path\":\"file.rs\",\"insertBefore\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--batch", "[{\"path\":\"file.rs\",\"insert_after\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--batch", "[{\"path\":\"file.rs\",\"insertAfter\":\"Sym, /evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--batch", "[{\"path\":\"file.rs\",\"insert_before\":\"Sym,/evil/\",\"code\":\"pub fn ok() {}\"}]"],
        &["splice", "--batch", "[{\"path\":\"file.rs\",\"insertBefore\":\"Sym, /evil/\",\"code\":\"pub fn ok() {}\"}]"],
    ];
    for vec_args in blocked {
        let out = tw.run_isolated(vec_args, true);
        assert_eq!(
            out.status.code(),
            Some(1),
            "Expected exit 1 for {vec_args:?}, got stdout={:?} stderr={:?}",
            stdout_str(&out),
            stderr_str(&out)
        );
        assert!(stdout_str(&out).is_empty(), "Expected empty stdout for {vec_args:?}");
        assert!(!stderr_str(&out).is_empty(), "Expected stderr diagnostic for {vec_args:?}");
    }

    // Verify Probe 3 specifically triggered Rust SyntaxFirewall (not PlainText)
    let probe3 = tw.run_isolated(
        &["splice", "--delete", "Sym", "file.rs", "-c", "pub fn BROKEN( {"],
        true,
    );
    assert!(
        stderr_str(&probe3).contains("SyntaxFirewall rejected file.rs"),
        "Expected SyntaxFirewall diagnostic on file.rs, got: {:?}",
        stderr_str(&probe3)
    );

    // Probe 4 + valid flag-only / reordered --delete forms (and symbolless --delete rejection)
    let passing: &[&[&str]] = &[
        &["splice", "-s", "Sym", "--delete", "Other", "file.rs", "-c", "pub fn ok() {}"],
        &["splice", "--delete", "Sym", "-c", "pub fn ok() {}", "-f", "file.rs"],
        &["splice", "--delete", "Other", "-c", "pub fn ok() {}", "file.rs"],
        &["splice", "-s", "Sym", "--delete", "file.rs"],
    ];
    for ok_args in passing {
        tw.write_file("file.rs", "pub fn Sym() {}\npub fn Other() {}\n");
        let out = tw.run_isolated(ok_args, true);
        assert_eq!(
            out.status.code(),
            Some(0),
            "Expected exit 0 for {ok_args:?}, stderr={:?}",
            stderr_str(&out)
        );
        assert!(!stdout_str(&out).is_empty(), "Expected non-empty stdout for {ok_args:?}");
    }
    tw.write_file("file.rs", "pub fn Sym() {}\npub fn Other() {}\n");
    for symbolless_del in [&["splice", "--delete", "file.rs"][..], &["splice", "--delete", "src/sub.rs"][..]] {
        let out = tw.run_isolated(symbolless_del, true);
        assert_eq!(out.status.code(), Some(1), "Symbolless --delete must exit 1: {symbolless_del:?}");
        assert!(stdout_str(&out).is_empty());
        assert!(!stderr_str(&out).is_empty());
    }

    // Help consistency with optional-arity -d / --delete
    for help_args in [&["splice", "-d", "-h"][..], &["splice", "-f", "file.rs", "-d", "-h"][..]] {
        let out = tw.run_isolated(help_args, true);
        assert_eq!(out.status.code(), Some(0));
        assert!(stdout_str(&out).contains("USAGE:"));
    }
    let sym_dash_h = tw.run_isolated(&["splice", "-d", "-s", "-h", "file.rs"], true);
    assert!(!stdout_str(&sym_dash_h).contains("USAGE:"));
}

#[cfg(unix)]
#[test]
fn find_blocks_symlink_escapes_and_loops() {
    use std::os::unix::fs::symlink;

    let tw = TempWorkspace::new("find_symlinks");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/app.rs", "pub fn app() {}\n");
    tw.write_file("src/sub/mod.rs", "pub fn sub() {}\n");

    let outside = tw.root.join("outside");
    fs::create_dir_all(&outside).expect("create outside");
    fs::write(outside.join("secret.txt"), "TOP_SECRET\n").expect("write secret");

    symlink("../../outside", tw.ws().join("src/leak_dir")).expect("symlink leak_dir");
    symlink(
        "../../outside/secret.txt",
        tw.ws().join("src/leak_file.txt"),
    )
    .expect("symlink leak_file");
    symlink(".", tw.ws().join("src/loop_dot")).expect("symlink loop_dot");
    symlink("../..", tw.ws().join("src/sub/loop_root")).expect("symlink loop_root");

    for args in [&["find"][..], &["find", "-d", "3"][..], &["find", "--json"][..]] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(0), "find {args:?} failed: {:?}", stderr_str(&out));
        let s = stdout_str(&out);
        assert!(s.contains("src/app.rs"), "missing src/app.rs in {args:?}: {s}");
        assert!(s.contains("src/sub/mod.rs"), "missing src/sub/mod.rs in {args:?}: {s}");
        for forbidden in ["leak_dir", "leak_file.txt", "secret.txt", "loop_dot", "loop_root"] {
            assert!(!s.contains(forbidden), "leaked '{forbidden}' in {args:?}: {s}");
        }
        if args.contains(&"--json") {
            let parsed = parse_json(&s).expect("valid find --json");
            assert_eq!(field(&parsed, "count").and_then(JsonValue::as_u64), Some(2));
        } else {
            assert!(s.lines().count() <= 10, "unexpected line expansion in {args:?}: {s}");
        }
    }

    for blocked in [&["find", "src/leak_dir"][..], &["find", "src/leak_file.txt"][..]] {
        let out = tw.run_isolated(blocked, true);
        assert_eq!(out.status.code(), Some(1), "escaped target {blocked:?} must fail");
        assert!(stdout_str(&out).is_empty(), "escaped target {blocked:?} must have empty stdout");
    }

    let allowed_shared = tw.root.join("allowed_shared");
    fs::create_dir_all(&allowed_shared).expect("create allowed_shared");
    fs::write(allowed_shared.join("lib.rs"), "pub fn shared() {}\n").expect("write shared lib");
    symlink("../outside/secret.txt", allowed_shared.join("shared_leak.txt"))
        .expect("symlink shared_leak");
    tw.write_file(
        "aice.config.json",
        "{\"enabled\": true, \"allowedReadRoots\": [\"../allowed_shared\"]}\n",
    );

    let f_root = tw.run_isolated(&["find"], true);
    assert_eq!(f_root.status.code(), Some(0));
    assert!(!stdout_str(&f_root).contains("secret.txt"));

    let f_shared = tw.run_isolated(&["find", "../allowed_shared"], true);
    assert_eq!(f_shared.status.code(), Some(0), "stderr: {:?}", stderr_str(&f_shared));
    let shared_out = stdout_str(&f_shared);
    assert!(shared_out.contains("lib.rs"), "expected lib.rs in {shared_out}");
    assert!(!shared_out.contains("shared_leak.txt"));
    assert!(!shared_out.contains("secret.txt"));

    let ledger_lines: Vec<String> = fs::read_to_string(&tw.telemetry_path)
        .expect("read gains.jsonl")
        .lines()
        .map(str::to_string)
        .collect();
    let last_row = parse_json(ledger_lines.last().expect("last telemetry row")).expect("valid json");
    assert_eq!(
        field(&last_row, "a1").and_then(JsonValue::as_u64),
        Some(count_cl100k(&shared_out) as u64)
    );
    assert_eq!(
        field(&last_row, "a2").and_then(JsonValue::as_u64),
        Some(count_o200k(&shared_out) as u64)
    );
}

#[test]
fn targetless_splice_rejected_while_heredoc_code_preserved() {
    let tw = TempWorkspace::new("targetless_splice");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("file.rs", "pub fn Sym() {}\n");

    let blocked_cli: &[&[&str]] = &[
        &["splice", "-c", "pub fn BROKEN( {"],
        &["splice", "--code", "pub fn BROKEN( {"],
        &["splice", "--code=pub fn BROKEN( {"],
        &["splice", "-c", ""],
        &["splice", "-s", "Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "--delete", "-c", "pub fn BROKEN( {"],
        &["splice", "--insert-after", "Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "--insert-before", "Sym", "-c", "pub fn BROKEN( {"],
        &["splice", "--create", "--force", "--dry-run", "-c", "pub fn BROKEN( {"],
        &["splice", "-b", "pub fn BROKEN( {"],
        &["splice", "-t", "pub fn BROKEN( {"],
        &["splice", "--from", "file.rs"],
        &["splice", "--edits", "[]"],
        &["splice", "--edits", "{}"],
        &["splice", "--edits", "[{\"code\":\"pub fn BROKEN( {\"}]"],
        &["splice", "--batch", ""],
        &["splice", "--batch", "[]"],
        &["splice", "--batch", "pub fn BROKEN( {"],
        &["splice", "-c", "=======\npub fn BROKEN( {"],
        &["splice", "-c", "===  ===\npub fn BROKEN( {"],
    ];
    for args in blocked_cli {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(1), "expected exit 1 for {args:?}");
        assert!(stdout_str(&out).is_empty(), "expected empty stdout for {args:?}");
        assert!(!stderr_str(&out).is_empty(), "expected stderr for {args:?}");
    }

    for (args, stdin_payload) in [
        (&["splice", "--stdin"][..], "pub fn BROKEN( {"),
        (&["splice", "--stdin"][..], ""),
        (&["splice", "--stdin", "-c", "pub fn BROKEN( {"][..], ""),
    ] {
        let mut child = Command::new(env!("CARGO_BIN_EXE_aice"))
            .args(args)
            .current_dir(tw.ws())
            .env("HOME", &tw.home)
            .env("AICE_AGENT_HOME", &tw.home)
            .env("AICE_TELEMETRY_PATH", &tw.telemetry_path)
            .env_remove("AICE_HOME")
            .env_remove("AICE_TELEMETRY_DIR")
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::piped())
            .spawn()
            .expect("spawn aice stdin test");
        if let Some(mut sin) = child.stdin.take() {
            sin.write_all(stdin_payload.as_bytes()).expect("write stdin");
        }
        let out = child.wait_with_output().expect("wait aice stdin test");
        assert_eq!(out.status.code(), Some(1), "expected exit 1 for stdin {args:?}");
        assert!(stdout_str(&out).is_empty(), "expected empty stdout for stdin {args:?}");
        assert!(!stderr_str(&out).is_empty(), "expected stderr for stdin {args:?}");
    }

    for ok_args in [
        &["splice", "--code", "=== file.rs:Sym ===\npub fn ok() {}\n"][..],
        &["splice", "-c", "=== file.rs ===\npub fn ok() {}\n"][..],
    ] {
        let out = tw.run_isolated(ok_args, true);
        assert_eq!(out.status.code(), Some(0), "expected exit 0 for {ok_args:?}: {:?}", stderr_str(&out));
        assert!(stderr_str(&out).is_empty(), "unexpected stderr for {ok_args:?}");
    }

    for bad_heredoc in [
        &["splice", "-c", "=== file.rs:/evil/ ===\npub fn ok() {}\n"][..],
        &["splice", "-c", "=== /etc/passwd ===\npub fn ok() {}\n"][..],
    ] {
        let out = tw.run_isolated(bad_heredoc, true);
        assert_eq!(out.status.code(), Some(1), "expected exit 1 for {bad_heredoc:?}");
        assert!(stdout_str(&out).is_empty());
        assert!(!stderr_str(&out).is_empty());
    }

    let del_no_sym = tw.run_isolated(&["splice", "--delete", "file.rs"], true);
    assert_eq!(del_no_sym.status.code(), Some(1));
    tw.write_file("file.rs", "pub fn Sym() {}\npub fn Other() {}\n");
    let del_ok = tw.run_isolated(&["splice", "--delete", "file.rs:Sym"], true);
    assert_eq!(del_ok.status.code(), Some(0), "stderr={:?}", stderr_str(&del_ok));
    assert!(!stdout_str(&del_ok).is_empty());
    assert!(!fs::read_to_string(tw.ws().join("file.rs")).unwrap().contains("fn Sym"));
}

#[test]
fn delete_subdir_target_selectors_and_abs_paths() {
    let tw = TempWorkspace::new("delete_subdir_abs");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/sub.rs", "pub fn Sym() {}\npub fn Other() {}\n");

    let abs_sub_rs = tw.ws().join("src/sub.rs").display().to_string();
    let abs_sub_colon_sym = format!("{abs_sub_rs}:Sym");
    let abs_sub_colon_syms = format!("{abs_sub_rs}:Sym,Other");
    let abs_sub_colon_evil = format!("{abs_sub_rs}:Sym,/evil/");

    let passing: &[&[&str]] = &[
        &["splice", "--delete", "src/sub.rs:Sym,Other", "-c", "pub fn ok() {}"],
        &["splice", "-d", "src/sub.rs#Sym,Other", "-c", "pub fn ok() {}"],
        &["splice", "--delete", "src/sub.rs:1-2", "-c", "pub fn ok() {}"],
        &["splice", "--delete", &abs_sub_colon_sym],
        &["splice", "--delete", &abs_sub_colon_syms, "-c", "pub fn ok() {}"],
        &["splice", "--delete", "--", "src/sub.rs:Sym,Other"],
        &["splice", "--delete", "--", &abs_sub_colon_sym],
        &["splice", "--delete", "Sym", &abs_sub_rs, "-c", "pub fn ok() {}"],
    ];
    for args in passing {
        tw.write_file("src/sub.rs", "pub fn Sym() {}\npub fn Other() {}\n");
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(0), "expected exit 0 for {args:?}, stderr={:?}", stderr_str(&out));
        assert!(!stdout_str(&out).is_empty(), "expected non-empty stdout for {args:?}");
    }
    tw.write_file("src/sub.rs", "pub fn Sym() {}\npub fn Other() {}\n");
    assert_eq!(tw.run_isolated(&["splice", "--delete", &abs_sub_rs], true).status.code(), Some(1));

    let fw_subdir = tw.run_isolated(
        &["splice", "--delete", "src/sub.rs:Sym,Other", "-c", "pub fn BROKEN( {"],
        true,
    );
    assert_eq!(fw_subdir.status.code(), Some(1));
    assert!(stdout_str(&fw_subdir).is_empty());
    assert!(stderr_str(&fw_subdir).contains("SyntaxFirewall rejected src/sub.rs"));

    let fw_abs = tw.run_isolated(
        &["splice", "--delete", &abs_sub_rs, "-c", "pub fn BROKEN( {"],
        true,
    );
    assert_eq!(fw_abs.status.code(), Some(1));
    assert!(stdout_str(&fw_abs).is_empty());
    assert!(stderr_str(&fw_abs).contains("SyntaxFirewall rejected"));

    let etc_out = tw.run_isolated(&["splice", "--delete", "/etc/passwd"], true);
    assert_eq!(etc_out.status.code(), Some(1));
    assert!(stdout_str(&etc_out).is_empty());
    assert!(!stderr_str(&etc_out).is_empty());

    for args in [
        &["splice", "--delete", "src/sub.rs:Sym,/evil/", "-c", "pub fn ok() {}"][..],
        &["splice", "--delete", &abs_sub_colon_evil, "-c", "pub fn ok() {}"][..],
        &["splice", "--delete", "/evil/"][..],
        &["splice", "--delete", "/evil/i"][..],
        &["splice", "--delete", "Other,/evil/"][..],
        &["splice", "--delete", "Sym, /evil/"][..],
        &["splice", "--delete", "/evil/,Other"][..],
        &["splice", "--delete", "/a,b/"][..],
    ] {
        let out = tw.run_isolated(args, true);
        assert_eq!(out.status.code(), Some(1), "expected exit 1 for {args:?}");
        assert!(stdout_str(&out).is_empty(), "expected empty stdout for {args:?}");
        assert!(stderr_str(&out).contains("regex selector"), "expected regex selector error for {args:?}, got {:?}", stderr_str(&out));
    }

    let spaced_sub = tw.run_isolated(
        &["splice", "--delete", "src/sub.rs:Sym, /evil/", "-c", "pub fn ok() {}"],
        true,
    );
    assert_eq!(spaced_sub.status.code(), Some(1));
    assert!(stdout_str(&spaced_sub).is_empty());
    assert!(!stderr_str(&spaced_sub).is_empty());
}

#[test]
fn w4_m4_budget_omitted_read_does_not_pollute_multi_files_or_repeat_reads() {
    let long_rel = "src/deeply/nested/very_long_component_filename_alpha.ts";
    let long_src = "export function alphaLong(a: number, b: number): number {\n  return a + b + 1 + 2 + 3 + 4 + 5;\n}\n";
    let small_src = "export const smallVal = 42;\n";

    let tw1 = TempWorkspace::new("w4_m4_budget15");
    tw1.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw1.write_file(long_rel, long_src);
    tw1.write_file("src/small.ts", small_src);

    let r15 = tw1.run_isolated(&["read", long_rel, "src/small.ts", "--max-tokens", "15"], true);
    assert_eq!(r15.status.code(), Some(0), "stderr={:?}", stderr_str(&r15));
    assert!(
        stdout_str(&r15).contains("omitted (budget)"),
        "expected budget-omitted notice, got {:?}",
        stdout_str(&r15)
    );
    let gains15 = fs::read_to_string(&tw1.telemetry_path).expect("read gains15");
    let lines15: Vec<&str> = gains15.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines15.len(), 1, "expected 1 telemetry line: {gains15}");
    let ev15 = parse_json(lines15[0]).expect("parse gains15 row");
    assert!(
        field(&ev15, "mf").is_none(),
        "budget-omitted read must not emit mf key: {}",
        lines15[0]
    );
    let f15 = field(&ev15, "f").and_then(JsonValue::as_str);
    assert_ne!(f15, Some("<multi-context>"), "row={}", lines15[0]);
    assert_eq!(f15, Some("<budget-omitted>"), "row={}", lines15[0]);

    let r_small = tw1.run_isolated(&["read", "src/small.ts"], true);
    assert_eq!(r_small.status.code(), Some(0), "stderr={:?}", stderr_str(&r_small));
    assert!(stdout_str(&r_small).contains("smallVal"));

    let gain1 = tw1.run_isolated(&["gain", "--json"], true);
    assert_eq!(gain1.status.code(), Some(0), "stderr={:?}", stderr_str(&gain1));
    let gain1_json = parse_json(&stdout_str(&gain1)).expect("parse gain1 json");
    assert_eq!(
        field(&gain1_json, "repeatReadCalls").and_then(JsonValue::as_f64),
        Some(0.0),
        "gain={}",
        stdout_str(&gain1)
    );
    assert_eq!(
        field(&gain1_json, "parallelSliceCalls").and_then(JsonValue::as_f64),
        Some(0.0),
        "gain={}",
        stdout_str(&gain1)
    );

    let tw2 = TempWorkspace::new("w4_m4_budget0_json");
    tw2.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw2.write_file(long_rel, long_src);
    tw2.write_file("src/small.ts", small_src);

    let r0 = tw2.run_isolated(&["read", long_rel, "src/small.ts", "--max-tokens", "0"], true);
    assert_eq!(r0.status.code(), Some(0), "stderr={:?}", stderr_str(&r0));
    assert!(stdout_str(&r0).is_empty(), "expected empty stdout: {:?}", stdout_str(&r0));

    let r15_json = tw2.run_isolated(
        &["read", long_rel, "src/small.ts", "--max-tokens", "15", "--json"],
        true,
    );
    assert_eq!(r15_json.status.code(), Some(0), "stderr={:?}", stderr_str(&r15_json));

    let gains2 = fs::read_to_string(&tw2.telemetry_path).expect("read gains2");
    let lines2: Vec<&str> = gains2.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(lines2.len(), 2, "expected 2 telemetry lines: {gains2}");
    for line in lines2 {
        let ev = parse_json(line).expect("parse gains2 row");
        assert!(field(&ev, "mf").is_none(), "must not emit mf key: {line}");
        let f = field(&ev, "f").and_then(JsonValue::as_str);
        assert_ne!(f, Some("<multi-context>"), "row={line}");
        assert_eq!(f, Some("<budget-omitted>"), "row={line}");
    }

    let r_small2 = tw2.run_isolated(&["read", "src/small.ts"], true);
    assert_eq!(r_small2.status.code(), Some(0));
    let r_long2 = tw2.run_isolated(&["read", long_rel], true);
    assert_eq!(r_long2.status.code(), Some(0));

    let gain2 = tw2.run_isolated(&["gain", "--json"], true);
    assert_eq!(gain2.status.code(), Some(0), "stderr={:?}", stderr_str(&gain2));
    let gain2_json = parse_json(&stdout_str(&gain2)).expect("parse gain2 json");
    assert_eq!(
        field(&gain2_json, "repeatReadCalls").and_then(JsonValue::as_f64),
        Some(0.0),
        "gain={}",
        stdout_str(&gain2)
    );
    assert_eq!(
        field(&gain2_json, "parallelSliceCalls").and_then(JsonValue::as_f64),
        Some(0.0),
        "gain={}",
        stdout_str(&gain2)
    );
}

#[test]
fn w5_m1_short_path_budget_omitted_logs_cleanly_with_zero_repeat_reads() {
    let tw = TempWorkspace::new("w5_m1_short_budget15");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/a.ts",
        "export function computeTotalValue(alpha: number, beta: number, gamma: number): number {\n  return alpha + beta + gamma;\n}\n",
    );

    let r15 = tw.run_isolated(&["read", "src/a.ts", "--max-tokens", "15"], true);
    assert_eq!(r15.status.code(), Some(0), "stderr={:?}", stderr_str(&r15));
    let out15 = stdout_str(&r15);
    assert!(!out15.contains("// file: src/a.ts"), "0-content stub leaked: {out15:?}");
    assert!(out15.contains("omitted"), "expected omitted notice: {out15:?}");

    let gains = fs::read_to_string(&tw.telemetry_path).expect("read gains");
    let rows: Vec<&str> = gains.lines().filter(|l| !l.trim().is_empty()).collect();
    assert_eq!(rows.len(), 1, "expected 1 row: {gains}");
    let ev = parse_json(rows[0]).expect("parse row");
    assert!(field(&ev, "mf").is_none(), "must not log mf: {}", rows[0]);
    assert_eq!(field(&ev, "f").and_then(JsonValue::as_str), Some("<budget-omitted>"));

    let follow = tw.run_isolated(&["read", "src/a.ts"], true);
    assert_eq!(follow.status.code(), Some(0), "stderr={:?}", stderr_str(&follow));
    assert!(stdout_str(&follow).contains("computeTotalValue"));

    let gain = tw.run_isolated(&["gain", "--json"], true);
    assert_eq!(gain.status.code(), Some(0), "stderr={:?}", stderr_str(&gain));
    let gain_json = parse_json(&stdout_str(&gain)).expect("parse gain json");
    assert_eq!(
        field(&gain_json, "repeatReadCalls").and_then(JsonValue::as_f64),
        Some(0.0),
        "gain={}",
        stdout_str(&gain)
    );
}

#[test]
fn w5_m3_gain_analyze_relative_symlink_zero_event_and_splice_stdin_collision() {
    // 1. C1-G2 & C1-G3: gain -p ../ws, gain -p ./symlink, analyze -p ../ws, and 0-event gain -p <ws> --json
    let tw = TempWorkspace::new("gain_rel_sym");
    let proj_a = tw.root.join("proj_a");
    let proj_b = tw.root.join("proj_b");
    let sibling = tw.root.join("sibling");
    fs::create_dir_all(proj_a.join("src")).unwrap();
    fs::create_dir_all(proj_b.join("src")).unwrap();
    fs::create_dir_all(&sibling).unwrap();
    fs::write(proj_a.join("aice.config.json"), r#"{"enabled":true}"#).unwrap();
    fs::write(proj_a.join("src/a.rs"), "pub fn alpha() -> i32 { 1 }\n").unwrap();
    fs::write(proj_b.join("aice.config.json"), r#"{"enabled":false}"#).unwrap();

    let run_in = |dir: &Path, args: &[&str], stdin_data: Option<&str>| -> Output {
        let mut cmd = Command::new(env!("CARGO_BIN_EXE_aice"));
        cmd.args(args)
            .current_dir(dir)
            .env("HOME", &tw.home)
            .env("AICE_AGENT_HOME", &tw.home)
            .env("AICE_TELEMETRY_PATH", &tw.telemetry_path)
            .env_remove("AICE_HOME")
            .env_remove("AICE_TELEMETRY_DIR");
        if let Some(payload) = stdin_data {
            cmd.stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
            let mut child = cmd.spawn().expect("spawn aice");
            child.stdin.take().unwrap().write_all(payload.as_bytes()).unwrap();
            child.wait_with_output().expect("wait aice")
        } else {
            cmd.output().expect("run aice")
        }
    };

    assert_eq!(run_in(&proj_a, &["read", "src/a.rs"], None).status.code(), Some(0));

    let g_rel = run_in(&sibling, &["gain", "-p", "../proj_a", "--json"], None);
    assert_eq!(g_rel.status.code(), Some(0), "{}", stderr_str(&g_rel));
    let g_rel_json = parse_json(&stdout_str(&g_rel)).expect("gain -p ../proj_a json");
    let proj_obj = field(&g_rel_json, "project").expect("expected project detail schema");
    let calls = field(proj_obj, "summary").and_then(|s| field(s, "calls")).and_then(JsonValue::as_f64);
    assert_eq!(calls, Some(1.0), "{}", stdout_str(&g_rel));

    #[cfg(unix)]
    {
        std::os::unix::fs::symlink(&proj_a, sibling.join("ws_link")).unwrap();
        let g_sym = run_in(&sibling, &["gain", "-p", "./ws_link", "--json"], None);
        assert_eq!(g_sym.status.code(), Some(0));
        let g_sym_json = parse_json(&stdout_str(&g_sym)).expect("gain -p ./ws_link json");
        let sym_calls = field(&g_sym_json, "project")
            .and_then(|p| field(p, "summary"))
            .and_then(|s| field(s, "calls"))
            .and_then(JsonValue::as_f64);
        assert_eq!(sym_calls, Some(1.0), "{}", stdout_str(&g_sym));
    }

    let a_rel = run_in(&sibling, &["analyze", "-p", "../proj_a", "--json"], None);
    assert_eq!(a_rel.status.code(), Some(0), "{}", stderr_str(&a_rel));
    let a_rel_json = parse_json(&stdout_str(&a_rel)).expect("analyze -p ../proj_a json");
    let a_calls = field(&a_rel_json, "bpeSavings")
        .and_then(|b| field(b, "totalCalls"))
        .and_then(JsonValue::as_f64);
    assert_eq!(a_calls, Some(1.0), "{}", stdout_str(&a_rel));

    let g_zero = run_in(&sibling, &["gain", "-p", "../proj_b", "--json"], None);
    assert_eq!(g_zero.status.code(), Some(0), "{}", stderr_str(&g_zero));
    let g_zero_json = parse_json(&stdout_str(&g_zero)).expect("gain -p ../proj_b json");
    let zero_proj = field(&g_zero_json, "project").expect("0-event project detail schema");
    assert_eq!(
        field(zero_proj, "summary").and_then(|s| field(s, "calls")).and_then(JsonValue::as_f64),
        Some(0.0)
    );
    assert_eq!(
        field(zero_proj, "configStatus")
            .and_then(|c| field(c, "enabled"))
            .and_then(JsonValue::as_bool),
        Some(false)
    );

    // 2. C1-G5: conflicting stdin splice flags rejected at CLI parse time
    let stdin_json = r#"[{"path":"src/a.rs","symbol":"alpha","code":"pub fn alpha() -> i32 { 2 }"}]"#;
    for args in [
        &["splice", "--edits", "-", "--batch", "-", "--dry-run"][..],
        &["splice", "--edits=-", "--batch=-", "--dry-run"][..],
        &["splice", "--edits", "-", "--edits", "-", "--dry-run"][..],
        &["splice", "--edits", "-", "--stdin", "--dry-run"][..],
    ] {
        let out = run_in(&proj_a, args, Some(stdin_json));
        assert_eq!(out.status.code(), Some(1), "args={args:?}");
        assert!(stderr_str(&out).contains("stdin"), "args={args:?}, err={}", stderr_str(&out));
    }
}

#[test]
fn w5_m5_subcommand_help_mcp_schemas_and_benchmark() {
    let tw = TempWorkspace::new("w5_m5_cli");
    let canonical = [
        "read", "search", "find", "splice", "enable", "disable", "config", "agents", "gain",
        "analyze", "mcp", "benchmark",
    ];
    for (invoked, expected_title) in [
        ("read", "aice read"),
        ("ctx", "aice read"),
        ("search", "aice search"),
        ("grep", "aice search"),
        ("find", "aice find"),
        ("tree", "aice find"),
        ("splice", "aice splice"),
        ("write", "aice splice"),
        ("enable", "aice enable"),
        ("disable", "aice disable"),
        ("config", "aice config"),
        ("status", "aice config"),
        ("agents", "aice agents"),
        ("gain", "aice gain"),
        ("stats", "aice gain"),
        ("analyze", "aice analyze"),
        ("mcp", "aice mcp"),
        ("benchmark", "aice benchmark"),
        ("bench", "aice benchmark"),
    ] {
        let out = tw.run_isolated(&[invoked, "--help"], true);
        assert_eq!(out.status.code(), Some(0), "help failed for {invoked}");
        let txt = stdout_str(&out);
        assert!(txt.contains(expected_title), "{invoked} --help missing '{expected_title}':\n{txt}");
        for cmd in canonical {
            assert!(txt.contains(cmd), "{invoked} --help missing '{cmd}'");
        }
        let low = txt.to_ascii_lowercase();
        for forbidden in ["--dsl", "--compile", "--idiom"] {
            assert!(!low.contains(forbidden), "{invoked} --help leaked '{forbidden}'");
        }
    }

    // 1. Default schema dir uses AICE_AGENT_HOME / HOME
    let default_out = tw.run_isolated(&["mcp", "--generate-schemas"], true);
    assert_eq!(default_out.status.code(), Some(0), "{}", stderr_str(&default_out));
    assert!(stdout_str(&default_out).contains("Generated 2 MCP tool schema files"));
    let default_dir = tw.home.join(".gemini/antigravity-cli/mcp/aice");
    for fname in ["aice_read.json", "aice_splice.json", "tools.json"] {
        let p = default_dir.join(fname);
        assert!(p.is_file(), "missing schema file {}", p.display());
        let raw = fs::read_to_string(&p).unwrap();
        assert!(!raw.contains("\"dsl\""), "dead dsl in {}", p.display());
        assert!(parse_json(&raw).is_ok(), "invalid json in {}", p.display());
    }
    let inst_path = default_dir.join("instructions.md");
    assert!(inst_path.is_file(), "missing instructions.md in {}", default_dir.display());
    let inst_md = fs::read_to_string(&inst_path).unwrap();
    assert!(inst_md.lines().count() <= 30, "instructions.md exceeds 30 lines: {}", inst_md.lines().count());
    assert!(inst_md.len() < 1600, "instructions.md exceeds 1.6KB: {} bytes", inst_md.len());
    assert!(inst_md.contains("aice_read") && inst_md.contains("aice_splice") && inst_md.contains("output.txt"));

    // 2. Explicit schema dir + stale file pruning
    let custom_dir = tw.root.join("custom_schemas");
    fs::create_dir_all(&custom_dir).unwrap();
    fs::write(custom_dir.join("aice_stale_legacy.json"), "{}").unwrap();
    let custom_out = tw.run_isolated(
        &["mcp", "--generate-schemas", custom_dir.to_str().unwrap()],
        true,
    );
    assert_eq!(custom_out.status.code(), Some(0), "{}", stderr_str(&custom_out));
    assert!(custom_dir.join("tools.json").is_file());
    assert!(custom_dir.join("instructions.md").is_file());
    assert!(!custom_dir.join("aice_stale_legacy.json").exists());

    // 3. Empty schema dir rejected
    for bad in [
        &["mcp", "--generate-schemas", ""][..],
        &["mcp", "--generate-schemas="][..],
    ] {
        let out = tw.run_isolated(bad, true);
        assert_eq!(out.status.code(), Some(1));
        assert!(!stderr_str(&out).is_empty());
    }

    // 4. Real benchmark command (default, --json, --markdown) without gains.jsonl pollution
    let b_txt = tw.run_isolated(&["benchmark"], true);
    assert_eq!(b_txt.status.code(), Some(0), "{}", stderr_str(&b_txt));
    assert!(stdout_str(&b_txt).contains("Totals:"));

    let b_json = tw.run_isolated(&["bench", "--json"], true);
    assert_eq!(b_json.status.code(), Some(0), "{}", stderr_str(&b_json));
    let bj = parse_json(&stdout_str(&b_json)).expect("valid benchmark json");
    assert_eq!(field(&bj, "status").and_then(JsonValue::as_str), Some("ok"));
    let cases = field(&bj, "cases").and_then(JsonValue::as_array).unwrap();
    assert!(cases.len() >= 10);

    let b_md = tw.run_isolated(&["benchmark", "--markdown"], true);
    assert_eq!(b_md.status.code(), Some(0), "{}", stderr_str(&b_md));
    assert!(stdout_str(&b_md).contains("| **Total** |"));
    assert!(!tw.telemetry_path.exists(), "benchmark must not pollute gains.jsonl");
}

#[path = "w3_m4_read_search_find.rs"]
mod w3_m4_read_search_find;

#[path = "w3_m5_regressions.rs"]
mod w3_m5_regressions;

#[path = "w3_m5_regressions_r4.rs"]
mod w3_m5_regressions_r4;

#[path = "w4_m1_batch_read.rs"]
mod w4_m1_batch_read;
