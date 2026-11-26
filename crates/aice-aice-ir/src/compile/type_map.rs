use aice_lang_registry::LanguageId;

use crate::compile::type_map_c::{emit_c_raw_type, map_c_scalar};
use crate::ir_types::{AiceType, PrimitiveType};

enum TyEmit<'a> {
    Eval(&'a AiceType),
    Array { wrap_ts: bool },
    Tuple(usize),
    Option { wrap_ts: bool },
    Result,
    Union { flags: Vec<bool> },
    Inter { flags: Vec<bool> },
    Record(Vec<(String, bool)>),
    Fn { n_params: usize },
    Named { base: String, n_args: usize },
    CPtr,
}

pub(crate) fn emit_type(root: &AiceType, lang: LanguageId) -> String {
    let mut tasks = vec![TyEmit::Eval(root)];
    let mut vals: Vec<String> = Vec::new();
    while let Some(task) = tasks.pop() {
        match task {
            TyEmit::Eval(ty) => step_eval_type(ty, lang, &mut tasks, &mut vals),
            TyEmit::Array { wrap_ts } => {
                let t = vals.pop().unwrap();
                let s = match lang {
                    LanguageId::TypeScript | LanguageId::Tsx => if wrap_ts { format!("({t})[]") } else { format!("{t}[]") },
                    LanguageId::CSharp => format!("{t}[]"),
                    LanguageId::Python => format!("list[{t}]"),
                    LanguageId::Rust => format!("Vec<{t}>"),
                    LanguageId::Go => format!("[]{t}"),
                    LanguageId::Cpp => format!("std::vector<{t}>"),
                    LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart => format!("List<{t}>"),
                    LanguageId::Php => "array".to_string(),
                    LanguageId::C => format!("{t}*"),
                    _ => format!("{t}[]"),
                };
                vals.push(s);
            }
            TyEmit::Tuple(n) => {
                let start = vals.len() - n;
                let ps: Vec<String> = vals.drain(start..).collect();
                let s = match lang {
                    LanguageId::TypeScript | LanguageId::Tsx => format!("[{}]", ps.join(", ")),
                    LanguageId::Python => format!("tuple[{}]", ps.join(", ")),
                    _ => format!("({})", ps.join(", ")),
                };
                vals.push(s);
            }
            TyEmit::Option { wrap_ts } => {
                let t = vals.pop().unwrap();
                let s = match lang {
                    LanguageId::TypeScript | LanguageId::Tsx => if wrap_ts { format!("({t}) | null") } else { format!("{t} | null") },
                    LanguageId::Python => format!("{t} | None"),
                    LanguageId::Rust => format!("Option<{t}>"),
                    LanguageId::Go => format!("*{t}"),
                    LanguageId::Cpp => format!("std::optional<{t}>"),
                    LanguageId::CSharp | LanguageId::Kotlin | LanguageId::Dart => format!("{t}?"),
                    LanguageId::Php => format!("?{t}"),
                    _ => t,
                };
                vals.push(s);
            }
            TyEmit::Result => {
                let e = vals.pop().unwrap();
                let o = vals.pop().unwrap();
                let s = match lang {
                    LanguageId::Rust | LanguageId::TypeScript | LanguageId::Tsx => format!("Result<{o}, {e}>"),
                    _ => o,
                };
                vals.push(s);
            }
            TyEmit::Union { flags } => {
                let start = vals.len() - flags.len();
                let ps: Vec<String> = vals.drain(start..).zip(flags).map(|(s, w)| if w { format!("({s})") } else { s }).collect();
                vals.push(ps.join(" | "));
            }
            TyEmit::Inter { flags } => {
                let start = vals.len() - flags.len();
                let ps: Vec<String> = vals.drain(start..).zip(flags).map(|(s, w)| if w { format!("({s})") } else { s }).collect();
                vals.push(ps.join(" & "));
            }
            TyEmit::Record(metas) => {
                let start = vals.len() - metas.len();
                let fs: Vec<String> = metas.into_iter().zip(vals.drain(start..)).map(|((nm, opt), t)| {
                    format!("{nm}{}: {t}", if opt { "?" } else { "" })
                }).collect();
                vals.push(format!("{{ {} }}", fs.join("; ")));
            }
            TyEmit::Fn { n_params } => {
                let r = vals.pop().unwrap();
                let start = vals.len() - n_params;
                let ps: Vec<String> = vals.drain(start..).collect();
                let s = match lang {
                    LanguageId::TypeScript | LanguageId::Tsx => {
                        let ts_ps: Vec<String> = ps.into_iter().enumerate().map(|(i, p)| format!("p{i}: {p}")).collect();
                        format!("({}) => {r}", ts_ps.join(", "))
                    }
                    LanguageId::Rust => format!("fn({}) -> {r}", ps.join(", ")),
                    LanguageId::Go => format!("func({}) {r}", ps.join(", ")),
                    _ => format!("({}) -> {r}", ps.join(", ")),
                };
                vals.push(s);
            }
            TyEmit::Named { base, n_args } => {
                let start = vals.len() - n_args;
                let ps: Vec<String> = vals.drain(start..).collect();
                let s = match lang {
                    LanguageId::Python | LanguageId::Go => format!("{base}[{}]", ps.join(", ")),
                    LanguageId::Php => base,
                    _ => format!("{base}<{}>", ps.join(", ")),
                };
                vals.push(s);
            }
            TyEmit::CPtr => {
                let inner = vals.pop().unwrap();
                vals.push(format!("{inner}*"));
            }
        }
    }
    vals.pop().unwrap_or_default()
}

fn step_eval_type<'a>(
    ty: &'a AiceType,
    lang: LanguageId,
    tasks: &mut Vec<TyEmit<'a>>,
    vals: &mut Vec<String>,
) {
    match ty {
        AiceType::Primitive(p) => vals.push(emit_prim(*p, lang).to_string()),
        AiceType::Array(inner) => {
            let wrap_ts = matches!(inner.as_ref(), AiceType::Fn { .. } | AiceType::Union(_) | AiceType::Intersection(_) | AiceType::Option(_));
            tasks.push(TyEmit::Array { wrap_ts });
            tasks.push(TyEmit::Eval(inner));
        }
        AiceType::Tuple(items) => {
            if lang == LanguageId::C { vals.push("void*".to_string()); return; }
            tasks.push(TyEmit::Tuple(items.len()));
            for it in items.iter().rev() { tasks.push(TyEmit::Eval(it)); }
        }
        AiceType::Option(inner) => {
            let wrap_ts = matches!(inner.as_ref(), AiceType::Fn { .. });
            tasks.push(TyEmit::Option { wrap_ts });
            tasks.push(TyEmit::Eval(inner));
        }
        AiceType::Result { ok, err } => {
            tasks.push(TyEmit::Result);
            tasks.push(TyEmit::Eval(err));
            tasks.push(TyEmit::Eval(ok));
        }
        AiceType::Union(parts) => {
            if lang == LanguageId::C { vals.push("void*".to_string()); return; }
            let is_ts = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx);
            let flags = parts.iter().map(|x| is_ts && matches!(x, AiceType::Fn { .. })).collect();
            tasks.push(TyEmit::Union { flags });
            for p in parts.iter().rev() { tasks.push(TyEmit::Eval(p)); }
        }
        AiceType::Intersection(parts) => {
            if lang == LanguageId::C { vals.push("void*".to_string()); return; }
            let is_ts = matches!(lang, LanguageId::TypeScript | LanguageId::Tsx);
            let flags = parts.iter().map(|x| is_ts && matches!(x, AiceType::Fn { .. } | AiceType::Union(_) | AiceType::Option(_))).collect();
            tasks.push(TyEmit::Inter { flags });
            for p in parts.iter().rev() { tasks.push(TyEmit::Eval(p)); }
        }
        AiceType::Record(fields) => {
            if lang == LanguageId::C { vals.push("void*".to_string()); return; }
            let metas = fields.iter().map(|f| (f.name.clone(), f.optional)).collect();
            tasks.push(TyEmit::Record(metas));
            for f in fields.iter().rev() { tasks.push(TyEmit::Eval(&f.ty)); }
        }
        AiceType::Refinement { base, .. } => vals.push(emit_prim(*base, lang).to_string()),
        AiceType::Fn { params, ret } => {
            if lang == LanguageId::C { vals.push("void*".to_string()); return; }
            tasks.push(TyEmit::Fn { n_params: params.len() });
            tasks.push(TyEmit::Eval(ret));
            for p in params.iter().rev() { tasks.push(TyEmit::Eval(p)); }
        }
        AiceType::Named { path, args } => step_eval_named(path, args, lang, tasks, vals),
        AiceType::Raw(s) if lang == LanguageId::C => vals.push(emit_c_raw_type(s)),
        AiceType::Raw(s) => vals.push(s.clone()),
    }
}

fn step_eval_named<'a>(
    path: &[String],
    args: &'a [AiceType],
    lang: LanguageId,
    tasks: &mut Vec<TyEmit<'a>>,
    vals: &mut Vec<String>,
) {
    if lang == LanguageId::C {
        if path.len() == 1 && args.is_empty() && let Some(mapped) = map_c_scalar(&path[0]) {
            vals.push(mapped.to_string());
            return;
        }
        if path.len() == 2 && path[0] == "std" && path[1] == "string" && args.is_empty() {
            vals.push("const char*".to_string());
            return;
        }
        if args.len() == 1 {
            if (path.len() == 1 && matches!(path[0].as_str(), "Option" | "Nullable")) || (path.len() == 2 && path[0] == "std" && path[1] == "optional") {
                tasks.push(TyEmit::Eval(&args[0]));
                return;
            }
            if (path.len() == 1 && matches!(path[0].as_str(), "Vec" | "Box" | "List" | "Array" | "Slice" | "Rc" | "Arc"))
                || (path.len() == 2 && path[0] == "std" && matches!(path[1].as_str(), "vector" | "unique_ptr" | "shared_ptr"))
            {
                tasks.push(TyEmit::CPtr);
                tasks.push(TyEmit::Eval(&args[0]));
                return;
            }
        }
    }
    let sep = match lang {
        LanguageId::Rust | LanguageId::Cpp | LanguageId::Ruby => "::",
        LanguageId::Php => "\\",
        LanguageId::C => "_",
        _ => ".",
    };
    let base = path.join(sep);
    if lang == LanguageId::C {
        if path.is_empty() || path.iter().all(|p| p.trim().is_empty()) { vals.push("void*".to_string()); }
        else { vals.push(emit_c_raw_type(&base)); }
        return;
    }
    if args.is_empty() {
        vals.push(base);
    } else {
        tasks.push(TyEmit::Named { base, n_args: args.len() });
        for a in args.iter().rev() { tasks.push(TyEmit::Eval(a)); }
    }
}

fn emit_prim(p: PrimitiveType, lang: LanguageId) -> &'static str {
    match (p, lang) {
        (PrimitiveType::Num, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) => "number",
        (PrimitiveType::Num, LanguageId::Rust) => "f64",
        (PrimitiveType::Num, LanguageId::Python | LanguageId::Php) => "float",
        (PrimitiveType::Num, LanguageId::Go) => "float64",
        (PrimitiveType::Num, LanguageId::Kotlin) => "Double",
        (PrimitiveType::Num, _) => "double",
        (PrimitiveType::Int, LanguageId::TypeScript | LanguageId::Tsx) => "number",
        (PrimitiveType::Int, LanguageId::Rust) => "i64",
        (PrimitiveType::Int, LanguageId::Kotlin) => "Int",
        (PrimitiveType::Int, _) => "int",
        (PrimitiveType::Float, LanguageId::TypeScript | LanguageId::Tsx) => "number",
        (PrimitiveType::Float, LanguageId::Rust) => "f64",
        (PrimitiveType::Float, LanguageId::Python | LanguageId::Php) => "float",
        (PrimitiveType::Float, LanguageId::Go) => "float64",
        (PrimitiveType::Float, LanguageId::Kotlin) => "Double",
        (PrimitiveType::Float, _) => "double",
        (PrimitiveType::Str, LanguageId::Python) => "str",
        (PrimitiveType::Str, LanguageId::Rust | LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart) => "String",
        (PrimitiveType::Str, LanguageId::Cpp) => "std::string",
        (PrimitiveType::Str, LanguageId::C) => "const char*",
        (PrimitiveType::Str, _) => "string",
        (PrimitiveType::Bool, LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Java) => "boolean",
        (PrimitiveType::Bool, LanguageId::Kotlin) => "Boolean",
        (PrimitiveType::Bool, _) => "bool",
        (PrimitiveType::Byte, LanguageId::Rust) => "u8",
        (PrimitiveType::Byte, _) => "byte",
        (PrimitiveType::Char, _) => "char",
        (PrimitiveType::Void, LanguageId::Python) => "None",
        (PrimitiveType::Void, LanguageId::Rust) => "()",
        (PrimitiveType::Void, LanguageId::Kotlin) => "Unit",
        (PrimitiveType::Void, LanguageId::Go) => "",
        (PrimitiveType::Void, _) => "void",
        (PrimitiveType::Nil, LanguageId::Python | LanguageId::Rust) => "None",
        (PrimitiveType::Nil, LanguageId::Go) => "nil",
        (PrimitiveType::Nil, _) => "null",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::TypeScript | LanguageId::Tsx) => "any",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Python) => "Any",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Go) => "any",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Cpp) => "auto",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::CSharp) => "object",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Java) => "Object",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Kotlin) => "Any",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Dart) => "dynamic",
        (PrimitiveType::Any | PrimitiveType::Unknown, LanguageId::Php) => "mixed",
        (PrimitiveType::Any | PrimitiveType::Unknown, _) => "void",
    }
}
