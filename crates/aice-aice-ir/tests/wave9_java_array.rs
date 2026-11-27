use std::path::Path;
use std::process::Command;

use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice_with_opts;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn roundtrip(lang: LanguageId, vname: &str, src: &str) -> (String, String) {
    let reg = EngineRegistry::default();
    let tr = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;
    let opts = TranspileOpts::default();
    let tree = reg.adapter(lang).unwrap().parse_cst(src).unwrap();
    let TranspileOutcome::Transpiled(m) = tr.to_aice(&tree, src, &opts).unwrap() else {
        panic!("expected Transpiled for {lang:?}");
    };
    let aice = print_aice_with_opts(&m, &opts);
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
fn f110_java_array_types_compile_as_brackets_and_pass_javac() {
    let java_src = r#"import java.util.List;

public class JavaArrRoundtrip {
    private final int[] weights;
    private final byte[][] matrix;
    private final List<String> tags;

    public JavaArrRoundtrip(int[] weights, byte[][] matrix, List<String> tags) {
        this.weights = weights;
        this.matrix = matrix;
        this.tags = tags;
    }

    public static int first(int[] xs) {
        return xs[0];
    }

    public static byte[][] cloneRef(byte[][] grid) {
        return grid;
    }

    public static java.util.List<String> keepQualified(java.util.List<String> items) {
        return items;
    }

    public int summary(String[] labels) {
        return weights.length + matrix.length + tags.size() + labels.length;
    }

    public static void main(String[] args) {
        int v = first(new int[] { 7, 8 });
        byte[][] g = cloneRef(new byte[][] { new byte[] { 1, 2 } });
        java.util.List<String> list = keepQualified(List.of("a", "b"));
        JavaArrRoundtrip obj = new JavaArrRoundtrip(new int[] { v }, g, list);
        System.out.println(v + ":" + obj.summary(args));
    }
}
"#;
    let (_aice, native) = roundtrip(LanguageId::Java, "JavaArrRoundtrip.java", java_src);

    for exp in [
        "private final int[] weights;",
        "private final byte[][] matrix;",
        "private final List<String> tags;",
        "public JavaArrRoundtrip(int[] weights, byte[][] matrix, List<String> tags)",
        "public static int first(int[] xs)",
        "public static byte[][] cloneRef(byte[][] grid)",
        "public static java.util.List<String> keepQualified(java.util.List<String> items)",
        "public int summary(String[] labels)",
        "public static void main(String[] args)",
    ] {
        assert!(native.contains(exp), "Java native missing `{exp}`:\n{native}");
    }
    for bad in ["List<int>", "List<byte>", "List<List<byte>>", "main(List<String>"] {
        assert!(!native.contains(bad), "Java native emitted buggy `{bad}`:\n{native}");
    }

    let Ok(which_javac) = Command::new("which").arg("javac").output() else { return };
    if !which_javac.status.success() { return; }

    let dir = std::env::temp_dir().join(format!("aice_w9_java_arr_{}", std::process::id()));
    let _ = std::fs::remove_dir_all(&dir);
    std::fs::create_dir_all(&dir).expect("mkdir tmp");
    let src_path = dir.join("JavaArrRoundtrip.java");
    std::fs::write(&src_path, &native).expect("write JavaArrRoundtrip.java");

    let compile = Command::new("javac").arg(&src_path).output().expect("run javac");
    assert!(
        compile.status.success(),
        "javac failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
        String::from_utf8_lossy(&compile.stdout),
        String::from_utf8_lossy(&compile.stderr),
    );

    if let Ok(which_java) = Command::new("which").arg("java").output()
        && which_java.status.success()
    {
        let run = Command::new("java")
            .arg("-cp")
            .arg(&dir)
            .arg("JavaArrRoundtrip")
            .arg("arg1")
            .output()
            .expect("run java");
        assert!(
            run.status.success(),
            "java runtime failed:\nstdout: {}\nstderr: {}\n--- JAVA ---\n{native}",
            String::from_utf8_lossy(&run.stdout),
            String::from_utf8_lossy(&run.stderr),
        );
        assert_eq!(String::from_utf8_lossy(&run.stdout).trim(), "7:5");
    }
    let _ = std::fs::remove_dir_all(&dir);
}

#[test]
fn f110_java_array_ir_cross_compile_targets_unchanged() {
    let ir = "module demo\npub fn count(xs:[int], tags:[str], grid:[[byte]], kept:List[str]) -> int:\n  ret 0\n";
    let parsed = parse_aice(ir).expect("parse IR");
    let tr = DefaultAiceTranspiler;

    let java = tr.to_native(&parsed, LanguageId::Java).expect("java compile");
    assert!(
        java.contains("int[] xs, String[] tags, byte[][] grid, List<String> kept"),
        "Java signature mismatch:\n{java}"
    );

    let csharp = tr.to_native(&parsed, LanguageId::CSharp).expect("csharp compile");
    assert!(
        csharp.contains("int[] xs, string[] tags, byte[][] grid, List<string> kept"),
        "CSharp signature mismatch:\n{csharp}"
    );

    let kotlin = tr.to_native(&parsed, LanguageId::Kotlin).expect("kotlin compile");
    assert!(
        kotlin.contains("xs: List<Int>, tags: List<String>"),
        "Kotlin signature mismatch:\n{kotlin}"
    );

    let dart = tr.to_native(&parsed, LanguageId::Dart).expect("dart compile");
    assert!(
        dart.contains("List<int> xs, List<String> tags"),
        "Dart signature mismatch:\n{dart}"
    );
}
