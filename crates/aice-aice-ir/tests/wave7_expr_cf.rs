use std::path::Path;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) =
        tr.to_aice(&tree, src, &TranspileOpts::default()).unwrap()
    else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice(&m);
    let reparsed = parse_aice(&aice).unwrap_or_else(|e| {
        panic!("parse_aice failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let native = tr.to_native(&reparsed, lang).unwrap_or_else(|e| {
        panic!("to_native failed for {vname}: {e}\n--- AICE ---\n{aice}")
    });
    let verdict = fw.verify(&native, Path::new(vname), lang);
    assert_eq!(
        verdict,
        FirewallVerdict::Valid,
        "firewall rejected {vname}:\n--- NATIVE ---\n{native}\n--- AICE ---\n{aice}"
    );
    (aice, native)
}

#[test]
fn v7_sweep_01_cpp_and_csharp_subscripts_no_double_bracketing() {
    let cpp = "int f(int* a, int i) { return a[i] + a[0]; }\n";
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "sub.cpp", cpp);
    assert!(cpp_aice.contains("a[i] + a[0]"), "C++ AICE:\n{cpp_aice}");
    assert!(!cpp_aice.contains("a[["), "C++ double-bracketed:\n{cpp_aice}");
    assert!(cpp_nat.contains("a[i] + a[0]"), "C++ native:\n{cpp_nat}");
    assert!(!cpp_nat.contains("std::vector"), "C++ emitted std::vector:\n{cpp_nat}");

    let cs = r#"public class Arr {
    public int Get(int[] a, int i) => a[i] + a[0];
    public int Grid(int[,] m, int i, int j) => m[i, j] + m[i + 1, 0];
    public int Safe(int[] a) => a?[0] ?? 0;
}
"#;
    let (cs_aice, cs_nat) = roundtrip(LanguageId::CSharp, "Arr.cs", cs);
    assert!(cs_aice.contains("a[i] + a[0]"), "C# AICE:\n{cs_aice}");
    assert!(!cs_aice.contains("a[["), "C# double-bracketed:\n{cs_aice}");
    assert!(cs_aice.contains("m[i, j] + m[i + 1, 0]"), "C# multi-arg AICE:\n{cs_aice}");
    assert!(cs_aice.contains("a?.[0] ?? 0"), "C# safe-index AICE:\n{cs_aice}");
    assert!(cs_nat.contains("a[i] + a[0]"), "C# native:\n{cs_nat}");
    assert!(!cs_nat.contains("a[["), "C# native double-bracketed:\n{cs_nat}");
    assert!(cs_nat.contains("m[i, j] + m[i + 1, 0]"), "C# native multi-arg:\n{cs_nat}");
    assert!(cs_nat.contains("a?[0] ?? 0"), "C# native safe-index:\n{cs_nat}");
}

#[test]
fn v7_tsw_01_js_ts_tagged_templates_and_string_backslashes() {
    let ts = r#"export function buildQueries(col: string, id: number) {
  const q = sql`SELECT ${col} FROM users WHERE id = ${id}`;
  const raw = String.raw`C:\Users\dev\aice`;
  const box = styled.div`color: ${id > 0 ? "green" : "red"}; padding: 8px;`;
  const btn = styled(Button)`margin: ${id}px;`;
  const reStr = "^\\d+\\.\\d+$";
  const win = "C:\\\\Users\\\\dev";
  const esc = "a\nb\tc\"d'e\\f";
  const single = 'pat\\w+';
  return { q, raw, box, btn, reStr, win, esc, single };
}
"#;
    for (lang, name) in [
        (LanguageId::TypeScript, "tagged.ts"),
        (LanguageId::Tsx, "tagged.tsx"),
    ] {
        let (aice, nat) = roundtrip(lang, name, ts);
        assert!(
            aice.contains("q := sql`SELECT ${col} FROM users WHERE id = ${id}`"),
            "{lang:?} sql tagged template corrupted:\n{aice}"
        );
        assert!(
            aice.contains(r"raw := String.raw`C:\\Users\\dev\\aice`"),
            "{lang:?} String.raw tagged template corrupted:\n{aice}"
        );
        assert!(
            aice.contains(r#"box := styled.div`color: ${id > 0 ? "green" : "red"}; padding: 8px;`"#),
            "{lang:?} styled.div tagged template corrupted:\n{aice}"
        );
        assert!(
            aice.contains("btn := styled(Button)`margin: ${id}px;`"),
            "{lang:?} call-tag template corrupted:\n{aice}"
        );
        assert!(
            aice.contains(r#"reStr := "^\\d+\\.\\d+$""#),
            "{lang:?} regular string backslash double-escaped:\n{aice}"
        );
        assert!(
            aice.contains(r#"win := "C:\\\\Users\\\\dev""#),
            "{lang:?} quad backslash corrupted:\n{aice}"
        );
        assert!(
            !aice.contains(r#"\\\\d+"#),
            "{lang:?} still double-escaping \\\\:\n{aice}"
        );
        assert!(
            aice.contains(r#"esc := "a\nb\tc\"d'e\\f""#),
            "{lang:?} standard escapes corrupted:\n{aice}"
        );
        assert!(
            aice.contains(r#"single := "pat\\w+""#),
            "{lang:?} single-quoted escape corrupted:\n{aice}"
        );

        assert!(
            nat.contains("const q = sql`SELECT ${col} FROM users WHERE id = ${id}`;"),
            "{lang:?} native sql tagged template:\n{nat}"
        );
        assert!(
            nat.contains(r"const raw = String.raw`C:\Users\dev\aice`;"),
            "{lang:?} native String.raw:\n{nat}"
        );
        assert!(
            nat.contains(r#"const box = styled.div`color: ${id > 0 ? "green" : "red"}; padding: 8px;`;"#),
            "{lang:?} native styled.div:\n{nat}"
        );
        assert!(
            nat.contains("const btn = styled(Button)`margin: ${id}px;`;"),
            "{lang:?} native call-tag template:\n{nat}"
        );
        assert!(
            nat.contains(r#"const reStr = "^\\d+\\.\\d+$";"#),
            "{lang:?} native reStr:\n{nat}"
        );
        assert!(
            nat.contains(r#"const win = "C:\\\\Users\\\\dev";"#),
            "{lang:?} native win:\n{nat}"
        );
        assert!(
            nat.contains(r#"const esc = "a\nb\tc\"d'e\\f";"#),
            "{lang:?} native esc:\n{nat}"
        );
    }

    let js = r#"export function buildJs(col, id) {
  const q = sql`SELECT ${col} FROM t WHERE id = ${id}`;
  const raw = String.raw`C:\Users\dev\aice`;
  const reStr = "^\\d+\\.\\d+$";
  return [q, raw, reStr];
}
"#;
    let (js_aice, js_nat) = roundtrip(LanguageId::JavaScript, "tagged.mjs", js);
    assert!(js_aice.contains("sql`SELECT ${col} FROM t WHERE id = ${id}`"), "{js_aice}");
    assert!(js_aice.contains(r#"reStr := "^\\d+\\.\\d+$""#), "{js_aice}");
    assert!(js_nat.contains(r"const raw = String.raw`C:\Users\dev\aice`;"), "{js_nat}");
    assert!(js_nat.contains(r#"const reStr = "^\\d+\\.\\d+$";"#), "{js_nat}");
}

#[test]
fn v7_sweep_05_python_dict_spread_except_else_raise_from() {
    let py = r#"def f(m):
    try:
        return {**m, 'k': 1}
    except ValueError as e:
        raise RuntimeError(str(e)) from e
    except (KeyError, TypeError) as ke:
        raise RuntimeError(str(ke)) from None
    except OSError:
        return {'err': 1}
    else:
        return {'ok': 0}
    finally:
        cleanup()
"#;
    let (aice, nat) = roundtrip(LanguageId::Python, "py_cf.py", py);
    assert!(aice.contains("ret { ...m, k: 1 }"), "Py dict spread AICE:\n{aice}");
    assert!(aice.contains("catch e: ValueError:"), "Py except ValueError as e AICE:\n{aice}");
    assert!(!aice.contains("catch err:"), "Py renamed e -> err:\n{aice}");
    assert!(
        aice.contains("throw RuntimeError(str(e)) from e"),
        "Py raise ... from e AICE:\n{aice}"
    );
    assert!(
        aice.contains("catch ke: \"(KeyError, TypeError)\":"),
        "Py tuple except AICE:\n{aice}"
    );
    assert!(
        aice.contains("throw RuntimeError(str(ke)) from nil"),
        "Py raise ... from None AICE:\n{aice}"
    );
    assert!(aice.contains("catch (): OSError:"), "Py type-only except AICE:\n{aice}");
    assert!(aice.contains("\n  else:\n    ret { ok: 0 }"), "Py try/else AICE:\n{aice}");
    assert!(aice.contains("\n  finally:\n    cleanup()"), "Py finally AICE:\n{aice}");

    assert!(nat.contains("return { **m, \"k\": 1 }"), "Py native dict spread:\n{nat}");
    assert!(nat.contains("except ValueError as e:"), "Py native except ValueError as e:\n{nat}");
    assert!(
        nat.contains("raise RuntimeError(str(e)) from e"),
        "Py native raise from e:\n{nat}"
    );
    assert!(
        nat.contains("except (KeyError, TypeError) as ke:"),
        "Py native tuple except:\n{nat}"
    );
    assert!(
        nat.contains("raise RuntimeError(str(ke)) from None"),
        "Py native raise from None:\n{nat}"
    );
    assert!(nat.contains("except OSError:"), "Py native type-only except:\n{nat}");
    assert!(nat.contains("else:\n            return { \"ok\": 0 }") || nat.contains("else:\n        return { \"ok\": 0 }"), "Py native else:\n{nat}");
    assert!(nat.contains("finally:\n"), "Py native finally:\n{nat}");
}

#[test]
fn v7_sweep_06_kotlin_destructuring_val_and_var() {
    let kt = r#"fun f(p: Pair<Int, String>): String {
    val (a, b) = p
    var (x, y) = p
    val (k: Int, v: String) = p
    return b + y + v
}
"#;
    let (aice, nat) = roundtrip(LanguageId::Kotlin, "destr.kt", kt);
    assert!(aice.contains("(a, b) := p"), "Kotlin val destructure AICE:\n{aice}");
    assert!(aice.contains("(x, y) ::= p"), "Kotlin var destructure AICE:\n{aice}");
    assert!(aice.contains("(k, v) := p"), "Kotlin typed destructure AICE:\n{aice}");
    assert!(!aice.contains("p := p"), "Kotlin corrupted destructure to p := p:\n{aice}");
    assert!(nat.contains("val (a, b) = p"), "Kotlin native val destructure:\n{nat}");
    assert!(nat.contains("var (x, y) = p"), "Kotlin native var destructure:\n{nat}");
    assert!(nat.contains("val (k, v) = p"), "Kotlin native typed destructure:\n{nat}");
}

#[test]
fn v7_sweep_08_php_catch_var_and_concat_operator() {
    let php = r#"<?php
class C {
    public function f(string $a, string $b, int $n): string {
        try {
            $sum = $n + 1;
            $both = $a . $b;
            return $both . ":ok:" . $b;
        } catch (\RuntimeException $e) {
            throw new \LogicException($e->getMessage());
        } catch (\InvalidArgumentException | \DomainException $e2) {
            return $e2->getMessage();
        } catch (\Throwable) {
            return "err";
        }
    }
}
"#;
    let (aice, nat) = roundtrip(LanguageId::Php, "catch_concat.php", php);
    assert!(aice.contains("$sum = $n + 1"), "PHP numeric + AICE:\n{aice}");
    assert!(aice.contains("$both = $a <> $b"), "PHP var-var concat <> AICE:\n{aice}");
    assert!(aice.contains("$both <> \":ok:\" <> $b"), "PHP concat <> AICE:\n{aice}");
    assert!(!aice.contains("$a + $b"), "PHP var concat collapsed to +:\n{aice}");
    assert!(aice.contains("catch $e: \"\\\\RuntimeException\":"), "PHP catch $e AICE:\n{aice}");
    assert!(!aice.contains("catch (): \"\\\\RuntimeException\":"), "PHP dropped $e:\n{aice}");
    assert!(
        aice.contains("catch $e2: \"\\\\InvalidArgumentException | \\\\DomainException\":"),
        "PHP multi-catch AICE:\n{aice}"
    );
    assert!(aice.contains("catch (): \"\\\\Throwable\":"), "PHP non-capturing catch AICE:\n{aice}");

    assert!(nat.contains("$sum = $n + 1;"), "PHP native numeric +:\n{nat}");
    assert!(nat.contains("$both = $a . $b;"), "PHP native var-var concat .:\n{nat}");
    assert!(nat.contains("return $both . \":ok:\" . $b;"), "PHP native concat .:\n{nat}");
    assert!(nat.contains("} catch (\\RuntimeException $e) {"), "PHP native catch $e:\n{nat}");
    assert!(nat.contains("$e->getMessage()"), "PHP native method call ->:\n{nat}");
    assert!(
        nat.contains("} catch (\\InvalidArgumentException | \\DomainException $e2) {"),
        "PHP native multi-catch:\n{nat}"
    );
    assert!(nat.contains("} catch (\\Throwable) {"), "PHP native non-capturing catch:\n{nat}");
}

#[test]
fn v7_sweep_09_c_local_pointer_declarators() {
    let c_src = r#"int f(const int *a) {
    const int *p = &a[0];
    int *q = 0;
    int **pp = &q;
    int x = 1, *px = &x;
    return *p + *px + (pp != 0);
}
"#;
    let (aice, nat) = roundtrip(LanguageId::C, "ptr.c", c_src);
    assert!(aice.contains("p:\"const int*\" := &a[0]"), "C const int* AICE:\n{aice}");
    assert!(!aice.contains("p:int := &a[0]"), "C dropped * on p:\n{aice}");
    assert!(aice.contains("q:\"int*\" ::= 0"), "C int* AICE:\n{aice}");
    assert!(aice.contains("pp:\"int**\" ::= &q"), "C int** AICE:\n{aice}");
    assert!(aice.contains("x:int ::= 1"), "C non-ptr sibling x AICE:\n{aice}");
    assert!(aice.contains("px:\"int*\" ::= &x"), "C ptr sibling px AICE:\n{aice}");

    assert!(nat.contains("const int* p = &a[0];"), "C native const int*:\n{nat}");
    assert!(nat.contains("int* q = 0;"), "C native int*:\n{nat}");
    assert!(nat.contains("int** pp = &q;"), "C native int**:\n{nat}");
    assert!(nat.contains("int x = 1;"), "C native x:\n{nat}");
    assert!(nat.contains("int* px = &x;"), "C native px:\n{nat}");

    let cpp_src = "int g(const int* a) { const int *p = &a[0]; const int &r = a[0]; return *p + r; }\n";
    let (cpp_aice, cpp_nat) = roundtrip(LanguageId::Cpp, "ptr.cpp", cpp_src);
    assert!(cpp_aice.contains("p:\"const int*\" := &a[0]"), "C++ const int* AICE:\n{cpp_aice}");
    assert!(cpp_aice.contains("r:\"const int&\" := a[0]"), "C++ const int& AICE:\n{cpp_aice}");
    assert!(cpp_nat.contains("const int* p = &a[0];"), "C++ native const int*:\n{cpp_nat}");
    assert!(cpp_nat.contains("const int& r = a[0];"), "C++ native const int&:\n{cpp_nat}");
}

#[test]
fn v7_sweep_15_ruby_safe_navigation_operator() {
    let rb = r#"class Base
  def f(cur)
    x = cur&.to_s || 'nil'
    y = cur&.fetch(:k, 1)
    z = cur&.a&.b
    w = cur&.nil?
    e = cur&.empty?
    x
  end
end
"#;
    let (aice, nat) = roundtrip(LanguageId::Ruby, "safenav.rb", rb);
    assert!(aice.contains("cur?.to_s() or \"nil\""), "Ruby &. AICE:\n{aice}");
    assert!(!aice.contains("cur.to_s()"), "Ruby downgraded &. to .:\n{aice}");
    assert!(aice.contains("cur?.fetch(:k, 1)"), "Ruby &. with args AICE:\n{aice}");
    assert!(aice.contains("cur?.a()?.b()"), "Ruby chained &. AICE:\n{aice}");
    assert!(aice.contains("w = cur?.nil?()"), "Ruby &.nil? must stay safe-nav:\n{aice}");
    assert!(aice.contains("e = cur?.empty?()"), "Ruby &.empty? must stay safe-nav:\n{aice}");

    assert!(nat.contains("cur&.to_s() || \"nil\""), "Ruby native &.:\n{nat}");
    assert!(!nat.contains("cur?.to_s"), "Ruby emitted invalid ?.:\n{nat}");
    assert!(nat.contains("cur&.fetch(:k, 1)"), "Ruby native &. args:\n{nat}");
    assert!(nat.contains("cur&.a()&.b()"), "Ruby native chained &.:\n{nat}");
    assert!(nat.contains("w = cur&.nil?()"), "Ruby native &.nil?:\n{nat}");
    assert!(nat.contains("e = cur&.empty?()"), "Ruby native &.empty?:\n{nat}");
}
