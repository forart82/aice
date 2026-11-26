use std::path::Path;

use aice_aice_ir::ir::{
    AiceItem, AiceModule, AiceType, FnBody, FnDecl, ParamDecl, PrimitiveType, RecordTypeField,
    Span, Trivia, Visibility,
};
use aice_aice_ir::parser::parse_aice;
use aice_aice_ir::printer::print_aice;
use aice_aice_ir::{AiceTranspiler, DefaultAiceTranspiler, TranspileOpts, TranspileOutcome};
use aice_ast_engine::{DefaultSyntaxFirewall, EngineRegistry};
use aice_lang_registry::{AdapterLookup, FirewallVerdict, LanguageId, SyntaxFirewall};

fn make_param(name: &str, ty: AiceType) -> ParamDecl {
    ParamDecl {
        name: name.to_string(),
        vis: Visibility::Default,
        is_readonly: false,
        is_mut: false,
        is_optional: false,
        is_rest: false,
        ty: Some(ty),
        default: None,
        trivia: Trivia::default(),
    }
}

fn make_fn(name: &str, params: Vec<ParamDecl>, ret: Option<AiceType>) -> AiceItem {
    AiceItem::Fn(FnDecl {
        vis: Visibility::Public,
        is_async: false,
        is_static: false,
        decorators: Vec::new(),
        name: name.to_string(),
        type_params: Vec::new(),
        params,
        return_type: ret,
        body: FnBody::Block(Vec::new()),
        trivia: Trivia::default(),
        span: Span::empty(),
    })
}

fn compile_single_fn_to_c(params: Vec<(&str, AiceType)>, ret: AiceType) -> String {
    let mut m = AiceModule::new(LanguageId::Aice, "m");
    let ps = params.into_iter().map(|(n, t)| make_param(n, t)).collect();
    m.items.push(make_fn("probe", ps, Some(ret)));
    let c = DefaultAiceTranspiler.to_native(&m, LanguageId::C).unwrap();
    assert_eq!(
        DefaultSyntaxFirewall.verify(&c, Path::new("probe.c"), LanguageId::C),
        FirewallVerdict::Valid,
        "Invalid C emitted:\n{c}"
    );
    c
}

#[test]
fn iter9_c_scalar_normalization_and_native_pointers_preserved() {
    let c_scalars = compile_single_fn_to_c(
        vec![
            ("a", AiceType::Raw("&mut [i32]".into())),
            ("b", AiceType::Raw("*const str".into())),
            ("c", AiceType::Raw("&()".into())),
            ("d", AiceType::Raw("list[str]".into())),
            ("e", AiceType::Named { path: vec!["Vec".into()], args: vec![AiceType::named("i32")] }),
            ("f", AiceType::Named { path: vec!["Vec".into()], args: vec![AiceType::named("String")] }),
            ("g", AiceType::Named { path: vec!["Vec".into()], args: vec![AiceType::Raw("()".into())] }),
            ("h", AiceType::Named { path: vec!["Option".into()], args: vec![AiceType::named("u32")] }),
        ],
        AiceType::Raw("()".into()),
    );
    assert!(c_scalars.contains("void probe("), "{c_scalars}");
    assert!(c_scalars.contains("int* a"), "{c_scalars}");
    assert!(c_scalars.contains("const char** b"), "{c_scalars}");
    assert!(c_scalars.contains("const void* c"), "{c_scalars}");
    assert!(c_scalars.contains("const char** d"), "{c_scalars}");
    assert!(c_scalars.contains("int* e"), "{c_scalars}");
    assert!(c_scalars.contains("const char** f"), "{c_scalars}");
    assert!(c_scalars.contains("void* g"), "{c_scalars}");
    assert!(c_scalars.contains("unsigned int h"), "{c_scalars}");

    let c_native = compile_single_fn_to_c(
        vec![
            ("s", AiceType::Raw("const char*".into())),
            ("v", AiceType::Raw("void*".into())),
            ("pp", AiceType::Raw("int**".into())),
            ("hdr", AiceType::Raw("const PacketHeader*".into())),
        ],
        AiceType::Raw("void*".into()),
    );
    assert!(c_native.contains("void* probe("), "{c_native}");
    assert!(c_native.contains("const char* s"), "{c_native}");
    assert!(c_native.contains("void* v"), "{c_native}");
    assert!(c_native.contains("int** pp"), "{c_native}");
    assert!(c_native.contains("const PacketHeader* hdr"), "{c_native}");
}

#[test]
fn iter9_c_pointer_to_generic_and_balanced_delimiters() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // C++ std::vector<int>* -> C (no < or >)
    let cpp_src = "void f(std::vector<int>* pv) {}\n";
    let cpp_tree = reg.adapter(LanguageId::Cpp).unwrap().parse_cst(cpp_src).unwrap();
    let TranspileOutcome::Transpiled(cpp_m) =
        transpiler.to_aice(&cpp_tree, cpp_src, &TranspileOpts::default()).unwrap()
    else {
        panic!("expected Transpiled C++");
    };
    let c_from_cpp = transpiler.to_native(&parse_aice(&print_aice(&cpp_m)).unwrap(), LanguageId::C).unwrap();
    assert!(!c_from_cpp.contains('<') && !c_from_cpp.contains('>'), "{c_from_cpp}");
    assert!(c_from_cpp.contains("int** pv"), "{c_from_cpp}");
    assert_eq!(fw.verify(&c_from_cpp, Path::new("cpp_ptr.c"), LanguageId::C), FirewallVerdict::Valid, "{c_from_cpp}");

    // Direct Raw pointer-to-generic & balanced compound checks
    let c_ptrs = compile_single_fn_to_c(
        vec![
            ("p1", AiceType::Raw("Pkg::Type<T>*".into())),
            ("p2", AiceType::Raw("Vec<int>*".into())),
            ("p3", AiceType::Raw("Vec<Pkg::Type>*".into())),
            ("p4", AiceType::Raw("[int] | [str]".into())),
            ("p5", AiceType::Raw("Vec<A> | Vec<B>".into())),
        ],
        AiceType::Primitive(PrimitiveType::Void),
    );
    assert!(!c_ptrs.contains('<') && !c_ptrs.contains('>') && !c_ptrs.contains('|') && !c_ptrs.contains('['), "{c_ptrs}");
    assert!(c_ptrs.contains("Pkg_Type* p1"), "{c_ptrs}");
    assert!(c_ptrs.contains("int** p2"), "{c_ptrs}");
    assert!(c_ptrs.contains("Pkg_Type** p3"), "{c_ptrs}");
    assert!(c_ptrs.contains("void* p4") && c_ptrs.contains("void* p5"), "{c_ptrs}");
}

#[test]
fn iter9_c_compound_raw_and_structured_aice_types() {
    let reg = EngineRegistry::default();
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    // TypeScript tuple [number, string] -> C
    let ts_src = "export function f(t: [number, string]): number { return 0; }\n";
    let ts_tree = reg.adapter(LanguageId::TypeScript).unwrap().parse_cst(ts_src).unwrap();
    let TranspileOutcome::Transpiled(ts_m) =
        transpiler.to_aice(&ts_tree, ts_src, &TranspileOpts::default()).unwrap()
    else {
        panic!("expected Transpiled TS");
    };
    let c_from_ts = transpiler.to_native(&parse_aice(&print_aice(&ts_m)).unwrap(), LanguageId::C).unwrap();
    assert!(!c_from_ts.contains("number, string"), "{c_from_ts}");
    assert_eq!(fw.verify(&c_from_ts, Path::new("ts_tup.c"), LanguageId::C), FirewallVerdict::Valid, "{c_from_ts}");

    // Rust (i32, i32), [u8; 16], fn(i32) -> i32 -> C
    let rs_src = "pub fn f(t: (i32, i32), buf: [u8; 16], cb: fn(i32) -> i32) -> () {}\n";
    let rs_tree = reg.adapter(LanguageId::Rust).unwrap().parse_cst(rs_src).unwrap();
    let TranspileOutcome::Transpiled(rs_m) =
        transpiler.to_aice(&rs_tree, rs_src, &TranspileOpts::default()).unwrap()
    else {
        panic!("expected Transpiled Rust");
    };
    let c_from_rs = transpiler.to_native(&parse_aice(&print_aice(&rs_m)).unwrap(), LanguageId::C).unwrap();
    assert!(c_from_rs.contains("unsigned int* buf"), "{c_from_rs}");
    assert!(c_from_rs.contains("void* t") && c_from_rs.contains("void* cb"), "{c_from_rs}");
    assert_eq!(fw.verify(&c_from_rs, Path::new("rs_cmp.c"), LanguageId::C), FirewallVerdict::Valid, "{c_from_rs}");

    // Raw Go/Python compounds + Structured AiceType Tuple/Union/Intersection/Record/Fn -> C
    let c_struct = compile_single_fn_to_c(
        vec![
            ("u", AiceType::Raw("str | None".into())),
            ("m", AiceType::Raw("map[string]int".into())),
            ("g", AiceType::Raw("func(int) int".into())),
            ("tup", AiceType::Tuple(vec![AiceType::Primitive(PrimitiveType::Int), AiceType::Primitive(PrimitiveType::Str)])),
            ("uni", AiceType::Union(vec![AiceType::Primitive(PrimitiveType::Int), AiceType::Primitive(PrimitiveType::Str)])),
            ("inter", AiceType::Intersection(vec![AiceType::named("A"), AiceType::named("B")])),
            ("rec", AiceType::Record(vec![RecordTypeField { name: "a".into(), optional: false, ty: AiceType::Primitive(PrimitiveType::Int) }])),
            ("cb", AiceType::Fn { params: vec![AiceType::Primitive(PrimitiveType::Int)], ret: Box::new(AiceType::Primitive(PrimitiveType::Int)) }),
        ],
        AiceType::Primitive(PrimitiveType::Void),
    );
    assert!(c_struct.contains("void* u") && c_struct.contains("void* m") && c_struct.contains("void* g"), "{c_struct}");
    assert!(c_struct.contains("void* tup") && c_struct.contains("void* uni") && c_struct.contains("void* rec") && c_struct.contains("void* cb"), "{c_struct}");
}

#[test]
fn iter9_ts_fn_type_emits_named_synthetic_params() {
    let transpiler = DefaultAiceTranspiler;
    let fw = DefaultSyntaxFirewall;

    let aice = "\
module m
pub fn apply(x: int, cb: fn(int) -> int, ping: fn() -> void) -> int:
  ret cb(x)
";
    let m = parse_aice(aice).unwrap();
    let ts = transpiler.to_native(&m, LanguageId::TypeScript).unwrap();
    assert!(ts.contains("cb: (p0: number) => number"), "TS missing named fn params:\n{ts}");
    assert!(ts.contains("ping: () => void"), "TS zero-arg fn broken:\n{ts}");
    assert_eq!(fw.verify(&ts, Path::new("fn_type.ts"), LanguageId::TypeScript), FirewallVerdict::Valid, "{ts}");
}
