use super::*;

#[test]
fn w3_m5_prefix_dec_and_dart_unary_cli() {
    let tw = TempWorkspace::new("w3m5_r4_dec");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/dec.ts", "export function dec(n: number): number { let s = 0; for (let i = n; i > 0; --i) { s += i; } return s; }\n");
    tw.write_file("src/dec.js", "export function dec(n) { let s = 0; for (let i = n; i > 0; --i) { s += i; } return s; }\n");
    tw.write_file("src/dec.c", "int dec(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; }\n");
    tw.write_file("src/comma.cpp", "int dec(int n) { int s = 0, i = 0, j = n; for (i = 0, j = n; i < j; ++i, --j) { s += j; } return s; }\n");
    tw.write_file("src/Dec.java", "public class Dec { public int run(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; } }\n");
    tw.write_file("src/Dec.cs", "public class Dec { public int Run(int n) { int s = 0; for (int i = n; i > 0; --i) { s += i; } return s; } }\n");
    tw.write_file("src/edge.php", "<?php\nfunction dec($n) { $s = 0; $a = -$n; for ($i = 0, $j = $n; $i < $j; $i++, --$j) { $s += $j; } return $s; }\n");
    tw.write_file("src/dec.dart", "int dec(int n, bool b) {\n  var s = -n;\n  var f = !b;\n  for (var i = n; i > 0; --i) { s += i; }\n  return s;\n}\n");

    for (path, must, forbid) in [
        ("src/dec.ts", &["--i"][..], &["\n    -i"][..]),
        ("src/dec.js", &["--i"][..], &["\n    -i"][..]),
        ("src/dec.c", &["--i"][..], &["\n    -i"][..]),
        ("src/comma.cpp", &["++i", "--j"][..], &["\n    -j"][..]),
        ("src/Dec.java", &["--i"][..], &["\n      -i"][..]),
        ("src/Dec.cs", &["i:int ::= n", "--i"][..], &["\n      -i", "::= nil"][..]),
        ("src/edge.php", &["-$n", "$i++", "--$j"][..], &["\n    -$j"][..]),
        ("src/dec.dart", &["-n", "not b", "--i"][..], &["---", "not !"][..]),
    ] {
        let out = tw.run_with_empty_path(&["read", path]);
        assert_eq!(out.status.code(), Some(0), "{path}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        for m in must {
            assert!(txt.contains(m), "missing {m:?} in {path}:\n{txt}");
        }
        for bad in forbid {
            assert!(!txt.contains(bad), "unexpected {bad:?} in {path}:\n{txt}");
        }
    }
}

#[test]
fn w3_m5_cpp_else_and_else_if_no_dummy_leak_cli() {
    let tw = TempWorkspace::new("w3m5_r4_cpp_if");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/wb.cpp",
        "int check_cpp(int x) {\n  int y = x + 1;\n  if (x > 0) {\n    return y;\n  } else if (x == 0) {\n    return 0;\n  } else {\n    return -1;\n  }\n}\n",
    );
    let e_out = tw.run_with_empty_path(&["read", "src/wb.cpp:check_cpp@else"]);
    assert_eq!(e_out.status.code(), Some(0), "{}", stderr_str(&e_out));
    let e_txt = stdout_str(&e_out);
    assert!(e_txt.contains("else:") && e_txt.contains("ret -1"), "{e_txt}");
    assert!(e_txt.contains("// ... [L"), "{e_txt}");
    assert!(!e_txt.contains("if (false)") && !e_txt.contains("if false") && !e_txt.contains("pass"), "{e_txt}");

    let ei_out = tw.run_with_empty_path(&["read", "src/wb.cpp:check_cpp@else_if"]);
    assert_eq!(ei_out.status.code(), Some(0), "{}", stderr_str(&ei_out));
    let ei_txt = stdout_str(&ei_out);
    assert!(ei_txt.contains("elif x == 0:") && ei_txt.contains("ret 0"), "{ei_txt}");
    assert!(!ei_txt.contains("if (false)") && !ei_txt.contains("pass"), "{ei_txt}");
}

#[test]
fn w3_m5_csharp_multivar_comma_for_and_ident_init_cli() {
    let tw = TempWorkspace::new("w3m5_r4_cs_for");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/Edge.cs",
        "public class Edge {\n  public int Run(int n) {\n    int s = 0;\n    for (int j = 0, k = n; j < k; j++, k--) { s += j; }\n    for (int i = n; i > 0; --i) { s += i; }\n    return s;\n  }\n}\n",
    );
    tw.write_file(
        "src/multi.ts",
        "export function m(n: number): number {\n  let a = 1, b = n, s = 0;\n  for (let i = 0, j = n; i < j; i++, j--) { s += i; }\n  return s + a + b;\n}\n",
    );
    let cs_out = tw.run_with_empty_path(&["read", "src/Edge.cs"]);
    assert_eq!(cs_out.status.code(), Some(0), "{}", stderr_str(&cs_out));
    let cs_txt = stdout_str(&cs_out);
    assert!(!cs_txt.lines().any(|l| l.trim() == ","), "bare comma:\n{cs_txt}");
    assert!(!cs_txt.contains("::= nil"), "nil init:\n{cs_txt}");
    for needle in ["j:int ::= 0", "k:int ::= n", "i:int ::= n", "--i"] {
        assert!(cs_txt.contains(needle), "missing {needle:?}:\n{cs_txt}");
    }

    let ts_out = tw.run_with_empty_path(&["read", "src/multi.ts"]);
    assert_eq!(ts_out.status.code(), Some(0), "{}", stderr_str(&ts_out));
    let ts_txt = stdout_str(&ts_out);
    for needle in ["a ::= 1", "b ::= n", "i ::= 0", "j ::= n"] {
        assert!(ts_txt.contains(needle), "missing {needle:?}:\n{ts_txt}");
    }
}

#[test]
fn w3_m5_try_catch_shorter_finally_cli() {
    let tw = TempWorkspace::new("w3m5_r4_catch");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file("src/TryClean.java", "class TryClean {\n  int f() {\n    try {\n      work();\n    } catch (Exception e) {\n      log(e);\n      return -1;\n    } finally {\n      y = 1;\n    }\n    return 0;\n  }\n}\n");
    tw.write_file("src/TryClean.cs", "class TryClean {\n  int F() {\n    try {\n      work();\n    } catch (Exception e) {\n      log(e);\n      return -1;\n    } finally {\n      y = 1;\n    }\n    return 0;\n  }\n}\n");
    tw.write_file("src/try_clean.php", "<?php\nfunction f() {\n  try {\n    work();\n  } catch (Exception $e) {\n    log($e);\n    return -1;\n  } finally {\n    $y = 1;\n  }\n}\n");
    tw.write_file("src/try_clean.ts", "export function f(): number {\n  try {\n    work();\n  } catch (err) {\n    log(err);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n");
    tw.write_file("src/try_clean.py", "def f():\n    try:\n        work()\n    except ValueError as err:\n        log(err)\n        return -1\n    finally:\n        y = 1\n");
    tw.write_file("src/try_clean.rb", "def f\n  begin\n    work\n  rescue => e\n    log(e)\n    return -1\n  ensure\n    y = 1\n  end\nend\n");

    for sel in [
        "src/TryClean.java:f@catch",
        "src/TryClean.cs:F@catch",
        "src/try_clean.php:f@catch",
        "src/try_clean.ts:f@catch",
        "src/try_clean.py:f@catch",
        "src/try_clean.py:f@except",
        "src/try_clean.rb:f@catch",
        "src/try_clean.rb:f@rescue",
    ] {
        let out = tw.run_with_empty_path(&["read", sel]);
        assert_eq!(out.status.code(), Some(0), "{sel}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        assert!(txt.contains("catch ") && txt.contains("ret -1"), "{sel}:\n{txt}");
        assert!(!txt.contains("finally:") && !txt.contains("y = 1"), "{sel} leaked finally:\n{txt}");
    }
}

#[test]
fn w3_m5_rust_lifetime_intra_block_cli() {
    let tw = TempWorkspace::new("w3m5_r4_rs_lt");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/lt.rs",
        "pub fn pick<'a>(flag: bool, x: &'a str, y: &'a str) -> &'a str {\n    let _s: &'static str = \"ok\";\n    let tag: char = '}';\n    if flag && tag == '}' {\n        let _r: &'a str = x;\n        return _r;\n    } else {\n        let _r: &'a str = y;\n        return _r;\n    }\n}\n",
    );
    let out_else = tw.run_with_empty_path(&["read", "src/lt.rs:pick@else"]);
    assert_eq!(out_else.status.code(), Some(0), "{}", stderr_str(&out_else));
    let txt_else = stdout_str(&out_else);
    assert!(txt_else.contains("else:") && txt_else.contains("ret _r"), "{txt_else}");
    assert!(!txt_else.contains("} else {") && !txt_else.contains("return _r"), "{txt_else}");

    let out_if = tw.run_with_empty_path(&["read", "src/lt.rs:pick@if"]);
    assert_eq!(out_if.status.code(), Some(0), "{}", stderr_str(&out_if));
    let txt_if = stdout_str(&out_if);
    assert!(txt_if.contains("if flag and tag == \"}\":") && txt_if.contains("ret _r"), "{txt_if}");
    assert!(!txt_if.contains("} else {") && !txt_if.contains("return _r"), "{txt_if}");
}

#[test]
fn w3_m5_dart_try_on_catch_finally_cli() {
    let tw = TempWorkspace::new("w3m5_r5_dart_try");
    tw.write_file("aice.config.json", "{\"enabled\": true}\n");
    tw.write_file(
        "src/tc.dart",
        "int f() {\n  try {\n    work();\n  } catch (e) {\n    log(e);\n    return -1;\n  } finally {\n    y = 1;\n  }\n  return 0;\n}\n",
    );
    tw.write_file(
        "src/dart_try.dart",
        "int f() {\n  try {\n    work();\n  } on FormatException catch (e, st) {\n    log(e, st);\n    return -1;\n  } catch (e) {\n    fallback(e);\n    return -2;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n",
    );
    tw.write_file(
        "src/dart_on_only.dart",
        "int f() {\n  try {\n    work();\n  } on FormatException {\n    log(\"fmt\");\n    return -1;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\nint g() {\n  try {\n    work();\n  } on StateError {\n    recover();\n    return -3;\n  } finally {\n    cleanup();\n  }\n  return 0;\n}\n",
    );

    let cases: &[(&str, &[&str], &[&str])] = &[
        (
            "src/tc.dart",
            &["try:", "catch e:", "log(e)", "ret -1", "finally:", "y = 1"],
            &["catch err:", "pass"],
        ),
        (
            "src/dart_try.dart",
            &["try:", "catch (e, st): FormatException:", "log(e, st)", "ret -1", "catch e:", "fallback(e)", "ret -2", "finally:", "cleanup()"],
            &["catch err:", "pass"],
        ),
        (
            "src/dart_on_only.dart",
            &["catch (): FormatException:", "log(\"fmt\")", "ret -1", "catch (): StateError:", "recover()", "ret -3", "finally:", "cleanup()"],
            &["catch err:", "pass"],
        ),
        (
            "src/tc.dart:f@catch",
            &["catch e:", "log(e)", "ret -1", "// ... [L"],
            &["finally:", "y = 1", "} catch (e) {", "catch err:", "pass"],
        ),
        (
            "src/tc.dart:f@finally",
            &["finally:", "y = 1"],
            &["ret -1", "log(e)"],
        ),
        (
            "src/dart_try.dart:f@catch",
            &["catch e:", "fallback(e)", "ret -2"],
            &["cleanup()", "try:", "pass"],
        ),
        (
            "src/dart_try.dart:f@on",
            &["catch (e, st): FormatException:", "log(e, st)", "ret -1"],
            &["try:", "cleanup()", "pass"],
        ),
        (
            "src/dart_try.dart:f@FormatException",
            &["catch (e, st): FormatException:", "log(e, st)", "ret -1"],
            &["try:", "cleanup()", "pass"],
        ),
        (
            "src/dart_on_only.dart:f@on",
            &["catch (): FormatException:", "log(\"fmt\")", "ret -1"],
            &["try:", "cleanup()", "pass"],
        ),
        (
            "src/dart_on_only.dart:f@FormatException",
            &["catch (): FormatException:", "log(\"fmt\")", "ret -1"],
            &["try:", "cleanup()", "pass"],
        ),
        (
            "src/dart_on_only.dart:g@StateError",
            &["catch (): StateError:", "recover()", "ret -3"],
            &["try:", "cleanup()", "pass"],
        ),
        (
            "src/dart_on_only.dart:g@catch",
            &["catch (): StateError:", "recover()", "ret -3"],
            &["try:", "cleanup()", "pass"],
        ),
    ];

    for (target, must, forbid) in cases {
        let out = tw.run_with_empty_path(&["read", target]);
        assert_eq!(out.status.code(), Some(0), "{target}: {}", stderr_str(&out));
        let txt = stdout_str(&out);
        for m in *must {
            assert!(txt.contains(m), "{target} missing {m:?}:\n{txt}");
        }
        for bad in *forbid {
            assert!(!txt.contains(bad), "{target} unexpected {bad:?}:\n{txt}");
        }
    }
}
