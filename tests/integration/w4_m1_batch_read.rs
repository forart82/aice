use super::*;

#[test]
fn w4_m1_cli_batch_read_coalesce_glob_budget_and_caveats() {
    let tw = TempWorkspace::new("w4m1_cli");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/app.ts",
        "export class App {\n  private count = 0;\n  public inc(n: number): number { return this.count + n; }\n  public reset(): number { this.count = 0; return 0; }\n}\n",
    );
    tw.write_file(
        "src/math.ts",
        "export function add(a: number, b: number): number { return a + b; }\n",
    );
    tw.write_file("src/sub/deep.ts", "export const deepVal = 1;\n");

    let coal = tw.run_isolated(&["read", "src/app.ts:App.inc", "src/app.ts:App.reset"], true);
    assert_eq!(coal.status.code(), Some(0), "{}", stderr_str(&coal));
    let coal_out = stdout_str(&coal);
    assert_eq!(coal_out.matches("// file: src/app.ts").count(), 1);
    assert!(coal_out.contains("inc("));
    assert!(coal_out.contains("reset("));

    let glob = tw.run_isolated(&["read", "src/**/*.ts:L1"], true);
    assert_eq!(glob.status.code(), Some(0), "{}", stderr_str(&glob));
    let glob_out = stdout_str(&glob);
    assert!(glob_out.contains("// file: src/app.ts"));
    assert!(glob_out.contains("// file: src/sub/deep.ts"));

    let find_dot = tw.run_isolated(&["find", "./src", "sub/*.ts"], true);
    assert_eq!(find_dot.status.code(), Some(0), "{}", stderr_str(&find_dot));
    assert!(stdout_str(&find_dot).contains("deep.ts"));

    let search_zero = tw.run_isolated(&["search", "deepVal", "--max-tokens", "0"], true);
    assert_eq!(search_zero.status.code(), Some(0), "{}", stderr_str(&search_zero));
    assert!(stdout_str(&search_zero).contains("// +1 more matching files"));
    assert!(!stdout_str(&search_zero).contains("deepVal = 1"));

    // Iteration 2 CLI hardening checks
    let long_rel = "src/deeply/nested/very_long_component_filename_alpha.ts";
    tw.write_file(long_rel, "export function alphaLong(a: number, b: number): number { return a + b + 1 + 2; }\n");
    tw.write_file("src/small.ts", "export const smallVal = 42;\n");

    let r15 = tw.run_isolated(&["read", long_rel, "src/small.ts", "--max-tokens", "15"], true);
    assert_eq!(r15.status.code(), Some(0));
    assert!(count_cl100k(&stdout_str(&r15)) <= 15, "{}", stdout_str(&r15));
    assert!(!stdout_str(&r15).contains("// ... [truncated]"));

    let r0 = tw.run_isolated(&["read", long_rel, "src/small.ts", "--max-tokens", "0"], true);
    assert_eq!(r0.status.code(), Some(0));
    assert_eq!(count_cl100k(&stdout_str(&r0)), 0, "{}", stdout_str(&r0));

    let s15 = tw.run_isolated(&["search", "app", "--max-tokens", "15"], true);
    assert_eq!(s15.status.code(), Some(0));
    assert!(count_cl100k(&stdout_str(&s15)) <= 15, "{}", stdout_str(&s15));

    let f15 = tw.run_isolated(&["find", "--max-tokens", "15"], true);
    assert_eq!(f15.status.code(), Some(0));
    assert!(count_cl100k(&stdout_str(&f15)) <= 15, "{}", stdout_str(&f15));

    let f0 = tw.run_isolated(&["find", "--max-tokens", "0"], true);
    assert_eq!(f0.status.code(), Some(0));
    assert_eq!(count_cl100k(&stdout_str(&f0)), 0, "{}", stdout_str(&f0));

    let f_win = tw.run_isolated(&["find", ".\\src\\"], true);
    assert_eq!(f_win.status.code(), Some(0));
    assert!(stdout_str(&f_win).contains("deep.ts"), "{}", stdout_str(&f_win));

    tw.write_file(".github/ci.yml", "name: ci\n");
    tw.write_file("ci/deploy.yml", "name: deploy\n");
    let dot_b = tw.run_isolated(&["read", "{.github,ci}/*.yml"], true);
    assert_eq!(dot_b.status.code(), Some(0), "{}", stderr_str(&dot_b));
    assert!(stdout_str(&dot_b).contains(".github/ci.yml"));
    assert!(stdout_str(&dot_b).contains("ci/deploy.yml"));

    let q_u = tw.run_isolated(&["read", "src/app.ts:App.inc", "src/app.ts:inc", "--no-deps"], true);
    assert_eq!(q_u.status.code(), Some(0));
    assert_eq!(stdout_str(&q_u).matches("fn inc(").count(), 1, "{}", stdout_str(&q_u));
}
