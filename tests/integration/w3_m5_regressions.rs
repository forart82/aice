use super::*;

#[test]
fn w3_m5_deep_4500_cli_reads_succeed() {
    let tw = TempWorkspace::new("w3m5_deep_4500");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");

    let mut ts = String::from("export function deep(x: number): number {\n");
    for _ in 0..4_500 { ts.push_str("if (x > 0) {\n"); }
    ts.push_str("return x;\n");
    for _ in 0..4_500 { ts.push_str("}\n"); }
    ts.push_str("return 0;\n}\n");
    tw.write_file("src/deep_4500.ts", &ts);

    let mut js = String::from("export function deep(x) {\n");
    for _ in 0..4_500 { js.push_str("if (x) {\n"); }
    js.push_str("return 1;\n");
    for _ in 0..4_500 { js.push_str("}\n"); }
    js.push_str("}\n");
    tw.write_file("src/deep_4500.js", &js);

    let mut twig = String::new();
    for _ in 0..4_500 { twig.push_str("{% if flag %}<div>"); }
    twig.push_str("ok");
    for _ in 0..4_500 { twig.push_str("</div>{% endif %}"); }
    tw.write_file("src/deep_4500.twig", &twig);

    let mut json = String::new();
    for _ in 0..4_500 { json.push_str("{\"a\":"); }
    json.push('1');
    for _ in 0..4_500 { json.push('}'); }
    tw.write_file("src/deep_4500.json", &json);

    let mut tsql = String::from("CREATE PROCEDURE dbo.deep_proc AS\nBEGIN\n");
    for _ in 0..4_500 { tsql.push_str("BEGIN\n"); }
    tsql.push_str("SELECT 1;\n");
    for _ in 0..4_500 { tsql.push_str("END\n"); }
    tsql.push_str("END;\n");
    tw.write_file("src/deep_4500.sql", &tsql);

    for args in [
        &["read", "src/deep_4500.ts"][..],
        &["read", "--full", "src/deep_4500.ts"][..],
        &["read", "src/deep_4500.ts:deep"][..],
        &["read", "src/deep_4500.ts:L1-L5"][..],
        &["read", "--full", "src/deep_4500.js"][..],
        &["read", "--full", "src/deep_4500.twig"][..],
        &["read", "--full", "src/deep_4500.json"][..],
        &["read", "--full", "src/deep_4500.sql"][..],
    ] {
        let out = tw.run_with_empty_path(args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(!txt.is_empty(), "empty output for {args:?}");
    }
}

#[test]
fn w3_m5_intra_block_aice_ir_and_cls_preservation() {
    let tw = TempWorkspace::new("w3m5_cls_intra");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/py_cls.py",
        "class Config:\n    @classmethod\n    def from_flag(cls, flag: bool):\n        # build config\n        if flag:\n            return cls(\n                flag\n            )\n        return cls(False)\n",
    );
    tw.write_file(
        "src/ts_cls.ts",
        "export class Builder {\n  static fromFlag(cls: Builder, flag: boolean): Builder {\n    // return cls\n    if (flag) {\n      return cls;\n    }\n    return cls;\n  }\n}\n",
    );

    let py_intra = tw.run_isolated(&["read", "src/py_cls.py:from_flag@cls"], true);
    assert_eq!(py_intra.status.code(), Some(0), "{}", stderr_str(&py_intra));
    let py_txt = stdout_str(&py_intra);
    assert!(py_txt.contains("ret cls"), "expected AICE IR 'ret cls':\n{py_txt}");
    assert!(!py_txt.contains("def from_flag("), "must not emit raw python:\n{py_txt}");
    assert!(!py_txt.contains("return class("), "must not corrupt cls->class:\n{py_txt}");

    let ts_intra = tw.run_isolated(&["read", "src/ts_cls.ts:fromFlag@cls"], true);
    assert_eq!(ts_intra.status.code(), Some(0), "{}", stderr_str(&ts_intra));
    let ts_txt = stdout_str(&ts_intra);
    assert!(ts_txt.contains("ret cls"), "expected AICE IR 'ret cls':\n{ts_txt}");
    assert!(!ts_txt.contains("return class"), "must not corrupt cls->class:\n{ts_txt}");
    assert!(!ts_txt.contains("if (flag) {"), "must not emit raw TS braces:\n{ts_txt}");

    let srch = tw.run_isolated(&["search", "-C", "1", "cls", "src/py_cls.py"], true);
    assert_eq!(srch.status.code(), Some(0), "{}", stderr_str(&srch));
    let srch_txt = stdout_str(&srch);
    assert!(srch_txt.contains("cls("), "search missing cls(:\n{srch_txt}");
    assert!(!srch_txt.contains("class("), "search corrupted cls->class:\n{srch_txt}");
}

#[test]
fn w3_m5_c_style_for_loops_and_continue_cli() {
    let tw = TempWorkspace::new("w3m5_c_for");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/loop.ts", "export function sumTo(n: number): number {\n  let acc = 0;\n  for (let i = 0; i < n; i++) {\n    acc += i;\n  }\n  return acc;\n}\n");
    tw.write_file("src/loop.js", "export function sumTo(n) {\n  let acc = 0;\n  for (let i = 0; i < n; i++) {\n    acc += i;\n  }\n  return acc;\n}\n");
    tw.write_file("src/loop.c", "int sum_to(int n) {\n  int s = 0;\n  for (int i = 0; i < n; i++) {\n    s += i;\n  }\n  return s;\n}\n");
    tw.write_file("src/Loop.java", "public class Loop {\n  public int sumTo(int n) {\n    int s = 0;\n    for (int i = 0; i < n; i++) {\n      s += i;\n    }\n    return s;\n  }\n}\n");
    tw.write_file("src/Loop.cs", "public class Loop {\n  public int SumTo(int n) {\n    int s = 0;\n    for (int i = 0; i < n; i++) {\n      s += i;\n    }\n    return s;\n  }\n}\n");
    tw.write_file("src/loop.go", "package p\nfunc f(n int) int {\n  acc := 0\n  for acc < n {\n    acc++\n  }\n  for {\n    break\n  }\n  return acc\n}\n");
    tw.write_file("src/loop.kt", "fun sumEach(xs: List<Int>): Int {\n  var acc = 0\n  for (x in xs) {\n    acc += x\n  }\n  return acc\n}\n");
    tw.write_file("src/loop_cont.ts", "export function sumOdd(n: number): number {\n  let acc = 0;\n  for (let i = 0; i < n; i++) {\n    if (i % 2 === 0) {\n      continue;\n    }\n    acc += i;\n  }\n  return acc;\n}\n");

    for (args, expected) in [
        (&["read", "src/loop.ts"][..], &["i ::= 0", "while i < n:", "i++"][..]),
        (&["read", "src/loop.ts:sumTo@loop"][..], &["while i < n:"][..]),
        (&["read", "src/loop.js"][..], &["i ::= 0", "while i < n:", "i++"][..]),
        (&["read", "src/loop.c"][..], &["i:int ::= 0", "while i < n:", "i++"][..]),
        (&["read", "src/Loop.java"][..], &["i:int ::= 0", "while i < n:", "i++"][..]),
        (&["read", "src/Loop.cs"][..], &["i:int ::= 0", "while i < n:", "i++"][..]),
        (&["read", "src/loop.go"][..], &["while acc < n:", "loop:"][..]),
        (&["read", "src/loop.kt"][..], &["for x in xs:"][..]),
    ] {
        let out = tw.run_with_empty_path(args);
        assert_eq!(out.status.code(), Some(0), "{args:?}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(!txt.contains("for item in"), "fabricated for-in for {args:?}:\n{txt}");
        for needle in expected {
            assert!(txt.contains(needle), "missing {needle:?} in {args:?}:\n{txt}");
        }
    }

    let cont = tw.run_with_empty_path(&["read", "src/loop_cont.ts"]);
    assert_eq!(cont.status.code(), Some(0), "{}", stderr_str(&cont));
    let cont_txt = stdout_str(&cont);
    assert!(!cont_txt.contains("for item in"), "{cont_txt}");
    assert!(cont_txt.matches("i++").count() >= 2, "missing i++ before continue:\n{cont_txt}");
}

#[test]
fn w3_m5_python_elif_else_except_finally_no_dummy_leak() {
    let tw = TempWorkspace::new("w3m5_py_dummy");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/elif.py",
        "def branch_test(cls: int, ret: int) -> int:\n    x = 1\n    if cls > 0:\n        return cls\n    elif ret > 0:\n        return ret\n    else:\n        return 0\n",
    );
    tw.write_file(
        "src/try_py.py",
        "def try_test(fn) -> int:\n    x = 1\n    try:\n        return fn()\n    except ValueError as err:\n        return -1\n    finally:\n        x = 0\n",
    );

    for (sel, expected) in [
        ("src/elif.py:branch_test@elif", &["elif ret > 0:", "ret ret"][..]),
        ("src/elif.py:branch_test@else", &["else:", "ret 0"][..]),
        ("src/elif.py:branch_test@branch", &["else:", "ret 0"][..]),
        ("src/try_py.py:try_test@except", &["catch err:", "ret -1"][..]),
        ("src/try_py.py:try_test@finally", &["finally:", "x = 0"][..]),
    ] {
        let out = tw.run_with_empty_path(&["read", sel]);
        assert_eq!(out.status.code(), Some(0), "{sel}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(!txt.contains("if false") && !txt.contains("if False"), "dummy leaked in {sel}:\n{txt}");
        assert!(!txt.contains("try:"), "dummy try leaked in {sel}:\n{txt}");
        assert!(!txt.contains("pass"), "dummy pass leaked in {sel}:\n{txt}");
        assert!(!txt.contains("return "), "raw return in {sel}:\n{txt}");
        assert!(txt.contains("// ... [L"), "missing skip marker in {sel}:\n{txt}");
        for needle in expected {
            assert!(txt.contains(needle), "missing {needle:?} in {sel}:\n{txt}");
        }
    }
}

#[test]
fn w3_m5_brace_php_ruby_else_catch_intra_blocks_emit_aice_ir() {
    let tw = TempWorkspace::new("w3m5_brace_intra");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/cls_bug.ts",
        "export function check(cls: number, a: number): number {\n  const b = a + 1;\n  if (cls > 0) {\n    return cls;\n  } else {\n    return a - cls;\n  }\n}\nexport function checkElif(cls: number, a: number): number {\n  const b = a + 1;\n  if (cls > 0) {\n    return cls;\n  } else if (a > 0) {\n    return a;\n  } else {\n    return 0;\n  }\n}\nexport function withHandlers(cls: number): number {\n  let x = 1;\n  try {\n    return cls;\n  } catch (err) {\n    return -1;\n  }\n}\nexport function withFinally(cls: number): number {\n  let x = 1;\n  try {\n    return cls;\n  } finally {\n    x = 0;\n  }\n}\n",
    );
    tw.write_file(
        "src/m.rs",
        "pub fn step(cls: i32) -> i32 {\n    let y = cls + 1;\n    if cls > 0 {\n        return cls;\n    } else {\n        return y;\n    }\n}\n",
    );
    tw.write_file(
        "src/t.php",
        "<?php\nfunction step($x) {\n  $y = $x + 1;\n  if ($x > 0) {\n    return 1;\n  } elseif ($x == 0) {\n    return 2;\n  } else {\n    return 3;\n  }\n}\n",
    );
    tw.write_file(
        "src/t.rb",
        "def step(x)\n  y = x + 1\n  if x > 0\n    return 1\n  elsif x == 0\n    return 2\n  else\n    return 3\n  end\nend\ndef err_fn\n  x = 1\n  begin\n    return 1\n  rescue => e\n    return -1\n  ensure\n    x = 0\n  end\nend\n",
    );

    for (sel, expected) in [
        ("src/cls_bug.ts:check@else", &["else:", "ret a - cls"][..]),
        ("src/cls_bug.ts:checkElif@else", &["else:", "ret 0"][..]),
        ("src/cls_bug.ts:withHandlers@catch", &["catch err:", "ret -1"][..]),
        ("src/cls_bug.ts:withFinally@finally", &["finally:", "x = 0"][..]),
        ("src/m.rs:step@else", &["else:", "ret y"][..]),
        ("src/t.php:step@elseif", &["elif $x == 0:", "ret 2"][..]),
        ("src/t.rb:step@elsif", &["elif x == 0:", "ret 2"][..]),
        ("src/t.rb:step@else", &["else:", "ret 3"][..]),
        ("src/t.rb:err_fn@rescue", &["catch e:", "ret -1"][..]),
        ("src/t.rb:err_fn@ensure", &["finally:", "x = 0"][..]),
    ] {
        let out = tw.run_with_empty_path(&["read", sel]);
        assert_eq!(out.status.code(), Some(0), "{sel}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(!txt.contains("} else {"), "raw }} else {{ in {sel}:\n{txt}");
        assert!(!txt.contains("} catch"), "raw }} catch in {sel}:\n{txt}");
        assert!(!txt.contains("return "), "raw return in {sel}:\n{txt}");
        assert!(!txt.contains("if false") && !txt.contains("try:\n  pass"), "dummy leaked in {sel}:\n{txt}");
        assert!(txt.contains("// ... [L"), "missing skip marker in {sel}:\n{txt}");
        for needle in expected {
            assert!(txt.contains(needle), "missing {needle:?} in {sel}:\n{txt}");
        }
    }
}

#[test]
fn w3_m5_sql_cte_slice_projects_aice_ir() {
    let tw = TempWorkspace::new("w3m5_sql_cte");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/q.sql",
        "WITH active_cls AS (\n  SELECT id, name\n  FROM users\n  WHERE active = 1\n)\nSELECT * FROM active_cls;\n",
    );
    let out = tw.run_with_empty_path(&["read", "src/q.sql:active_cls"]);
    assert_eq!(out.status.code(), Some(0), "{}", stderr_str(&out));
    let txt = stdout_str(&out);
    assert!(txt.contains("module sql"), "expected module sql:\n{txt}");
    assert!(txt.contains("query \"sql\" \"select\":"), "expected query header:\n{txt}");
    assert!(txt.contains("with \"active_cls\"|"), "expected CTE AICE IR:\n{txt}");
    assert!(!txt.contains("// aice L"), "unexpected raw SQL fallback:\n{txt}");
}
