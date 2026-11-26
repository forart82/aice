use std::collections::BTreeSet;
use std::fs;

use aice_governance::{JsonValue, parse_json};
use aice_telemetry::{count_cl100k, count_o200k};

use super::{GoldenSandbox, field, repo_root, s_err, s_out};

fn read_ledger(path: &std::path::Path) -> Vec<JsonValue> {
    fs::read_to_string(path)
        .unwrap()
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| parse_json(l).unwrap())
        .collect()
}

pub(crate) fn run_suite_09(seen: &mut BTreeSet<String>) {
    let raw = fs::read_to_string(repo_root().join("tests/golden/cases/09_anti_bypass.json")).expect("read 09");
    let root = parse_json(&raw).expect("parse 09");
    let cases = field(&root, "cases").and_then(JsonValue::as_array).expect("cases");
    assert_eq!(cases.len(), 23);
    for c in cases {
        let id = field(c, "id").and_then(JsonValue::as_str).unwrap().to_string();
        seen.insert(id.clone());
        verify_anti_bypass(&id);
    }
}

fn verify_anti_bypass(id: &str) {
    let sb = GoldenSandbox::new(id, true, true, "enabled");
    match id {
        "B-R1" => {
            let out = sb.run_cli(&["read", "src/math.ts"], None, false);
            assert_eq!(out.status.code(), Some(0));
            let s = s_out(&out);
            assert!(s.contains("module typescript") && !s.contains("export interface"), "{s}");
        }
        "B-R2" => {
            let out = sb.run_cli(&["search", "Calculator"], None, false);
            assert_eq!(out.status.code(), Some(0));
            assert!(!s_out(&out).contains("export class Calculator"));
        }
        "B-R3" => {
            let mut big = String::new();
            for i in 0..1600 { big.push_str(&format!("export const k_{i}: number = {i};\n")); }
            big.push_str("export function lateTarget(v: number): number {\n  return v + 9;\n}\n");
            fs::write(sb.ws.join("src/huge.ts"), big).unwrap();
            let out = sb.run_cli(&["read", "src/huge.ts:lateTarget"], None, false);
            assert_eq!(out.status.code(), Some(0));
            assert!(s_out(&out).contains("lateTarget"));
        }
        "B-R4" => {
            let out = sb.run_cli(&["read", "src/card.twig", "src/config.toml", "src/schema_ansi.sql"], None, false);
            assert_eq!(out.status.code(), Some(0));
            let s = s_out(&out);
            assert!(s.contains("module twig") && s.contains("module toml") && s.contains("module sql"), "{s}");
        }
        "B-R5" => {
            fs::write(sb.ws.join("src/tiny.ts"), "export const x = 1;\n").unwrap();
            let out = sb.run_cli(&["read", "src/tiny.ts"], None, false);
            assert_eq!(out.status.code(), Some(0));
            assert!(s_out(&out).contains("module typescript"));
        }
        "B-R6" => {
            let out = sb.run_cli(&["read", "src/app.ts:missingSym"], None, false);
            assert_eq!(out.status.code(), Some(1));
            assert!(!s_out(&out).contains("[AICE AST Fallback]"));
        }
        "B-R7" => {
            let out = sb.run_cli(&["read", "src/Service.java", "src/build.sh", "src/config.xml", "src/guide.md"], None, false);
            assert_eq!(out.status.code(), Some(0));
            let s = s_out(&out);
            assert!(s.contains("module com.aice.golden") && s.contains("pub class Service") && s.contains("module bash") && s.contains("module xml") && s.contains("module markdown"), "{s}");
        }
        "B-R8" => {
            fs::write(sb.ws.join("src/tiny.ts"), "export const x = 1;\n").unwrap();
            let out = sb.run_cli(&["read", "src/tiny.ts"], None, false);
            assert!(s_out(&out).starts_with("// file: src/tiny.ts"));
        }
        "B-W1" => {
            let orig = fs::read_to_string(sb.ws.join("src/app.ts")).unwrap();
            let out = sb.run_cli(&["splice", "src/app.ts", "-s", "App.inc", "-c", "public inc(: { broken ===", "--force"], None, false);
            assert_eq!(out.status.code(), Some(1));
            assert_eq!(fs::read_to_string(sb.ws.join("src/app.ts")).unwrap(), orig);
        }
        "B-W2" => {
            let broken = "export function broken( {\n  return 1;\n}\nexport function ok(): number {\n  return 2;\n}\n";
            fs::write(sb.ws.join("src/broken.ts"), broken).unwrap();
            let out = sb.run_cli(&["splice", "src/broken.ts", "-s", "ok", "-c", "export function ok(): number {\n  return {\n"], None, false);
            assert_eq!(out.status.code(), Some(1));
            assert_eq!(fs::read_to_string(sb.ws.join("src/broken.ts")).unwrap(), broken);
        }
        "B-W3" => {
            let rs = sb.run_cli(&["splice", "src/engine.rs", "--overwrite", "-c", "pub fn broken( { } -> ;"], None, false);
            let go = sb.run_cli(&["splice", "src/server.go", "--overwrite", "-c", "package main\nfunc ( { }"], None, false);
            assert_eq!(rs.status.code(), Some(1));
            assert_eq!(go.status.code(), Some(1));
        }
        "B-W4" => {
            let mut cmd = std::process::Command::new(env!("CARGO_BIN_EXE_aice"));
            cmd.args(["splice", "src/worker.py", "--overwrite", "-c", "def bad(:\n    pass"])
                .current_dir(&sb.ws).env("PATH", "").env("HOME", &sb.home).env("AICE_TELEMETRY_PATH", &sb.telemetry_path);
            assert_eq!(cmd.output().unwrap().status.code(), Some(1));
            let toml = sb.run_cli(&["splice", "src/config.toml", "--overwrite", "-c", "bad = [1, 2"], None, false);
            assert_eq!(toml.status.code(), Some(1));
        }
        "B-W5" => {
            fs::write(sb.ws.join("src/ch.go"), "package main\nfunc drain(ch <-chan string) string {\n\treturn \"<-ok\"\n}\n").unwrap();
            let out = sb.run_cli(&["splice", "src/ch.go", "-s", "drain", "-c", "func drain(ch <-chan string) string {\n\ts := \"ret <-chan lit\"\n\tmsg := <-ch\n\treturn msg + s\n}"], None, false);
            assert_eq!(out.status.code(), Some(0), "{}", s_err(&out));
            let disk = fs::read_to_string(sb.ws.join("src/ch.go")).unwrap();
            assert!(disk.contains("<-ch") && disk.contains("\"ret <-chan lit\""));
        }
        "B-S1" => {
            let out = sb.run_cli(&["read", "src/big.ts", "--max-tokens", "40"], None, false);
            assert_eq!(out.status.code(), Some(0));
            assert!(count_cl100k(&s_out(&out)) <= 40);
        }
        "B-S2" => {
            for retired in ["fmt", "diff", "create", "new", "compile", "decompile", "roundtrip"] {
                let out = sb.run_cli(&[retired, "src/app.ts"], None, false);
                assert_eq!(out.status.code(), Some(1), "retired command {retired} must exit 1");
            }
        }
        "B-S3" => {
            let reqs = vec![
                parse_json(r#"{"method":"initialize","params":{}}"#).unwrap(),
                parse_json(r#"{"method":"tools/call","params":{"name":"aice_context","arguments":{"path":"src/app.ts"}}}"#).unwrap(),
                parse_json(r#"{"method":"tools/call","params":{"name":"aice_create","arguments":{"filePath":"src/x.ts","code":"export const x=1;"}}}"#).unwrap(),
            ];
            let (code, resps) = sb.run_mcp(&reqs);
            assert_eq!(code, 0);
            assert!(field(&resps[1], "error").is_some() && field(&resps[2], "error").is_some());
        }
        "B-S4" => {
            let sb_dis = GoldenSandbox::new("B_S4_dis", true, true, "disabled");
            assert_eq!(sb_dis.run_cli(&["find"], None, false).status.code(), Some(1));
            assert_eq!(sb_dis.run_cli(&["search", "Calculator"], None, false).status.code(), Some(1));
            assert_eq!(sb.run_cli(&["find", "/etc"], None, false).status.code(), Some(1));
            assert_eq!(sb.run_cli(&["search", "root", "/etc"], None, false).status.code(), Some(1));
        }
        "B-T1" => {
            let r_math = sb.run_cli(&["read", "src/math.ts"], None, false);
            let r_find = sb.run_cli(&["find"], None, false);
            assert_eq!(r_math.status.code(), Some(0));
            assert_eq!(r_find.status.code(), Some(0));
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 2);
            let math_raw = fs::read_to_string(sb.ws.join("src/math.ts")).unwrap();
            assert_eq!(field(&rows[0], "n1").and_then(JsonValue::as_u64), Some(count_cl100k(&math_raw) as u64));
            assert_eq!(field(&rows[0], "n2").and_then(JsonValue::as_u64), Some(count_o200k(&math_raw) as u64));
            let f_out = s_out(&r_find);
            assert_eq!(field(&rows[1], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&f_out) as u64));
            assert_eq!(field(&rows[1], "a2").and_then(JsonValue::as_u64), Some(count_o200k(&f_out) as u64));
            assert_ne!(field(&rows[1], "n1"), field(&rows[1], "n2"), "o200k must run independently from cl100k");
        }
        "B-T2" => {
            let r_math = sb.run_cli(&["read", "src/math.ts"], None, false);
            let r_spl = sb.run_cli(&["splice", "src/app.ts", "-s", "App.reset", "-c", "public reset(): number {\n  return 0;\n}", "--json"], None, false);
            assert_eq!(r_math.status.code(), Some(0));
            assert_eq!(r_spl.status.code(), Some(0), "{}", s_err(&r_spl));
            let spl_j = parse_json(&s_out(&r_spl)).expect("splice --json");
            assert_eq!(field(&spl_j, "success").and_then(JsonValue::as_bool), Some(true));
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 2);
            let math_raw = fs::read_to_string(sb.ws.join("src/math.ts")).unwrap();
            assert_eq!(field(&rows[0], "n1").and_then(JsonValue::as_u64), Some(count_cl100k(&math_raw) as u64));
            assert_eq!(field(&rows[0], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&s_out(&r_math)) as u64));
            let spl_n1 = field(&rows[1], "n1").and_then(JsonValue::as_u64).unwrap() as i64;
            let spl_a1 = field(&rows[1], "a1").and_then(JsonValue::as_u64).unwrap() as i64;
            assert_eq!(spl_a1, count_cl100k(&s_out(&r_spl)) as i64);
            assert_eq!(field(&rows[1], "a2").and_then(JsonValue::as_u64), Some(count_o200k(&s_out(&r_spl)) as u64));
            assert_eq!(field(&spl_j, "tokensSaved").and_then(JsonValue::as_i64), Some(spl_n1 - spl_a1));
        }
        "B-T3" => {
            let r_find = sb.run_cli(&["find"], None, false);
            let r_srch = sb.run_cli(&["search", "Calculator"], None, false);
            assert_eq!(r_find.status.code(), Some(0));
            assert_eq!(r_srch.status.code(), Some(0));
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 2);
            assert_eq!(field(&rows[0], "f").and_then(JsonValue::as_str), Some("<workspace-files>"));
            assert_eq!(field(&rows[0], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&s_out(&r_find)) as u64));
            assert!(field(&rows[0], "n1").and_then(JsonValue::as_u64).unwrap() < 1000, "find baseline must not sum unread corpus");
            assert_eq!(field(&rows[1], "f").and_then(JsonValue::as_str), Some("<directory>"));
            assert_eq!(field(&rows[1], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&s_out(&r_srch)) as u64));
            assert!(field(&rows[1], "n1").and_then(JsonValue::as_u64).unwrap() < 1000, "search baseline must not sum unread corpus");
        }
        "B-T4" => {
            let r_tiny = sb.run_cli(&["read", "src/notes.txt"], None, false);
            assert_eq!(r_tiny.status.code(), Some(0));
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 1);
            let tiny_n1 = field(&rows[0], "n1").and_then(JsonValue::as_u64).unwrap();
            let tiny_a1 = field(&rows[0], "a1").and_then(JsonValue::as_u64).unwrap();
            assert!(tiny_n1 < tiny_a1, "B-T4: notes.txt wrapper must have negative token delta ({tiny_n1} < {tiny_a1})");
            assert_eq!(field(&rows[0], "rs").and_then(JsonValue::as_i64), Some(tiny_n1 as i64 - tiny_a1 as i64));
        }
        "B-T5" => {
            let r_multi = sb.run_cli(&["read", "src/math.ts", "src/app.ts"], None, false);
            assert_eq!(r_multi.status.code(), Some(0));
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 1);
            let combined_raw = format!(
                "{}\n{}",
                fs::read_to_string(sb.ws.join("src/math.ts")).unwrap(),
                fs::read_to_string(sb.ws.join("src/app.ts")).unwrap()
            );
            assert_eq!(field(&rows[0], "n1").and_then(JsonValue::as_u64), Some(count_cl100k(&combined_raw) as u64));
            assert_eq!(field(&rows[0], "rn").and_then(JsonValue::as_u64), Some(count_cl100k(&combined_raw) as u64));
            assert_eq!(field(&rows[0], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&s_out(&r_multi)) as u64));
        }
        "B-T6" => {
            let r_stats = sb.run_cli(&["read", "src/app.ts", "--stats"], None, false);
            let r_json = sb.run_cli(&["read", "src/app.ts", "--json"], None, false);
            assert_eq!(r_stats.status.code(), Some(0));
            assert_eq!(r_json.status.code(), Some(0));
            let stats_out = s_out(&r_stats);
            let json_out = s_out(&r_json);
            assert!(stats_out.contains("Context Pack Token Telemetry"), "{stats_out}");
            let parsed = parse_json(&json_out).expect("B-T6 --json");
            assert!(field(&parsed, "tokenCount").and_then(JsonValue::as_u64).unwrap() > 0);
            let rows = read_ledger(&sb.telemetry_path);
            assert_eq!(rows.len(), 2);
            assert_eq!(field(&rows[0], "ac").and_then(JsonValue::as_u64), Some(stats_out.len() as u64));
            assert_eq!(field(&rows[0], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&stats_out) as u64));
            assert_eq!(field(&rows[1], "ac").and_then(JsonValue::as_u64), Some(json_out.len() as u64));
            assert_eq!(field(&rows[1], "a1").and_then(JsonValue::as_u64), Some(count_cl100k(&json_out) as u64));
        }
        _ => panic!("unknown anti-bypass id {id}"),
    }
}
