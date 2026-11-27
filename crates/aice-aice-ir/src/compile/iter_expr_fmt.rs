use aice_lang_registry::LanguageId;

use crate::compile::type_map::emit_type;
use crate::ir_code::{Expr, RecordEntry, UnaryOp};
use crate::ir_types::{AiceType, ParamDecl};

pub(crate) fn needs_walrus_parens(e: &Expr) -> bool {
    matches!(e, Expr::Ident(s) if s.contains(":=") && !(s.starts_with('(') && s.ends_with(')')))
}

pub(crate) fn unary_op_native(op: UnaryOp, lang: LanguageId) -> &'static str {
    match (op, lang) {
        (UnaryOp::Not, LanguageId::Python) => "not ",
        (UnaryOp::Not, _) => "!",
        (UnaryOp::Neg, _) => "-",
        (UnaryOp::Pos, _) => "+",
        (UnaryOp::BitNot, LanguageId::Rust) => "!",
        (UnaryOp::BitNot, LanguageId::Go) => "^",
        (UnaryOp::BitNot, _) => "~",
        (UnaryOp::Inc, _) => "++",
        (UnaryOp::Dec, _) => "--",
        (UnaryOp::Spread, _) => "...",
        (UnaryOp::Ref, LanguageId::Rust | LanguageId::Go | LanguageId::Cpp | LanguageId::C | LanguageId::Php) => "&",
        (UnaryOp::RefMut, LanguageId::Rust) => "&mut ",
        (UnaryOp::RefMut, LanguageId::Go | LanguageId::Cpp | LanguageId::C) => "&",
        (UnaryOp::Deref, LanguageId::Rust | LanguageId::Go | LanguageId::Cpp | LanguageId::C) => "*",
        (UnaryOp::Typeof, _) => "typeof ",
        (UnaryOp::Void, _) => "void ",
        (UnaryOp::Delete, _) => "delete ",
        (UnaryOp::Yield, _) => "yield ",
        (UnaryOp::YieldStar, LanguageId::Python) => "yield from ",
        (UnaryOp::YieldStar, _) => "yield* ",
        (UnaryOp::Generator, _) => "",
        (UnaryOp::Move, LanguageId::Rust) => "move ",
        _ => "",
    }
}

pub(crate) fn format_template(quasis: &[String], exs: &[String], lang: LanguageId) -> String {
    let (head, tail, op) = match lang {
        LanguageId::Python => ("f\"", "\"", ""),
        LanguageId::CSharp => ("$\"", "\"", ""),
        LanguageId::Kotlin | LanguageId::Dart => ("\"", "\"", "$"),
        LanguageId::Ruby => ("\"", "\"", "#"),
        _ => ("`", "`", "$"),
    };
    let mut s = String::from(head);
    for (i, q) in quasis.iter().enumerate() {
        if matches!(lang, LanguageId::Python | LanguageId::CSharp | LanguageId::Kotlin | LanguageId::Dart | LanguageId::Ruby) {
            let esc = crate::printer_expr::escape_str(q);
            match lang {
                LanguageId::CSharp | LanguageId::Python => s.push_str(&esc.replace('{', "{{").replace('}', "}}")),
                LanguageId::Kotlin | LanguageId::Dart => s.push_str(&esc.replace('$', "\\$")),
                LanguageId::Ruby => s.push_str(&esc.replace("#{", "\\#{")),
                _ => s.push_str(&esc),
            }
        } else {
            s.push_str(q);
        }
        if let Some(ex) = exs.get(i) {
            s.push_str(&format!("{op}{{{ex}}}"));
        }
    }
    s.push_str(tail);
    s
}

pub(crate) fn format_closure_param(p: &ParamDecl, def: Option<&str>, lang: LanguageId) -> String {
    let d = def.map(|x| format!(" = {x}")).unwrap_or_default();
    let rest = if p.is_rest { "..." } else { "" };
    match lang {
        LanguageId::TypeScript | LanguageId::Tsx => {
            let opt = if p.is_optional && def.is_none() { "?" } else { "" };
            let ty = p.ty.as_ref().map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default();
            format!("{rest}{}{opt}{ty}{d}", p.name)
        }
        LanguageId::Rust | LanguageId::Kotlin => {
            let ty = p.ty.as_ref().map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default();
            format!("{}{ty}", p.name)
        }
        LanguageId::Go => {
            let dots = if p.is_rest { "..." } else { "" };
            let ty = p.ty.as_ref().map(|t| format!(" {dots}{}", emit_type(t, lang))).unwrap_or_default();
            format!("{}{ty}", p.name)
        }
        LanguageId::Cpp => {
            let ty = p.ty.as_ref().map(|t| emit_type(t, lang)).unwrap_or_else(|| "auto".into());
            format!("{ty} {}{d}", p.name)
        }
        LanguageId::Php => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            let nm = if p.name.starts_with('$') { p.name.clone() } else { format!("${}", p.name) };
            format!("{ty}{nm}{d}")
        }
        LanguageId::CSharp => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            format!("{ty}{}{d}", p.name)
        }
        LanguageId::Dart => {
            let ty = p.ty.as_ref().map(|t| format!("{} ", emit_type(t, lang))).unwrap_or_default();
            format!("{ty}{}{d}", p.name)
        }
        _ => format!("{rest}{}{d}", p.name),
    }
}

pub(crate) fn format_closure(
    is_async: bool,
    ps: &[String],
    ret: Option<&AiceType>,
    bk: u8,
    body: Option<&str>,
    lang: LanguageId,
) -> String {
    let asy = if is_async { "async " } else { "" };
    if lang == LanguageId::Python {
        return format!("lambda {}: {}", ps.join(", "), body.unwrap_or("None"));
    }
    if lang == LanguageId::Ruby {
        let p_s = ps.join(", ");
        return match bk {
            1 => format!("->({p_s}) {{ {} }}", body.unwrap()),
            2 => {
                let inner = body.unwrap().trim_end();
                if inner.is_empty() { format!("->({p_s}) {{}}") }
                else if !inner.contains('\n') { format!("->({p_s}) {{ {} }}", inner.trim()) }
                else { format!("->({p_s}) {{\n{inner}\n}}") }
            }
            _ => format!("->({p_s}) {{ nil }}"),
        };
    }
    let trimmed = body.map(|b| b.trim_end()).unwrap_or("");
    let rhs = match bk {
        1 => body.unwrap().to_string(),
        2 => {
            if lang == LanguageId::Kotlin {
                let p_hdr = if ps.is_empty() { String::new() } else { format!("{} -> ", ps.join(", ")) };
                let inner_k = if trimmed.is_empty() { String::new() } else { format!("\n{trimmed}\n") };
                return format!("{{ {p_hdr}{inner_k} }}");
            }
            if trimmed.is_empty() { "{}".into() }
            else if !trimmed.contains('\n') { format!("{{ {} }}", trimmed.trim()) }
            else { format!("{{\n{trimmed}\n}}") }
        }
        _ => "null".into(),
    };
    match lang {
        LanguageId::Rust => {
            let rt = ret.map(|t| format!(" -> {}", emit_type(t, lang))).unwrap_or_default();
            if rt.is_empty() || bk != 2 { format!("{asy}|{}| {rhs}", ps.join(", ")) }
            else { format!("{asy}|{}|{rt} {rhs}", ps.join(", ")) }
        }
        LanguageId::Php if bk == 1 => format!("fn({}) => {rhs}", ps.join(", ")),
        LanguageId::Php => format!("function({}) {rhs}", ps.join(", ")),
        LanguageId::Go => {
            let rt = ret.map(|t| format!(" {}", emit_type(t, lang))).unwrap_or_default();
            let b = if bk == 2 { rhs } else { format!("{{ return {rhs} }}") };
            format!("func({}){rt} {b}", ps.join(", "))
        }
        LanguageId::Java => format!("({}) -> {rhs}", ps.join(", ")),
        LanguageId::Kotlin => format!("{{ {}{rhs} }}", if ps.is_empty() { String::new() } else { format!("{} -> ", ps.join(", ")) }),
        LanguageId::Dart if bk == 2 => format!("({}) {rhs}", ps.join(", ")),
        LanguageId::Dart => format!("({}) => {rhs}", ps.join(", ")),
        LanguageId::Cpp => {
            let rt = ret.map(|t| format!(" -> {}", emit_type(t, lang))).unwrap_or_default();
            let b = if bk == 2 { rhs } else { format!("{{ return {rhs}; }}") };
            format!("[&]({}){rt} {b}", ps.join(", "))
        }
        _ => {
            let rt = if matches!(lang, LanguageId::TypeScript | LanguageId::Tsx) {
                ret.map(|t| format!(": {}", emit_type(t, lang))).unwrap_or_default()
            } else { String::new() };
            format!("{asy}({}){rt} => {rhs}", ps.join(", "))
        }
    }
}

pub(crate) fn format_record_entry(entry: &RecordEntry, val: String, lang: LanguageId) -> String {
    match entry {
        RecordEntry::Spread(_) => match lang {
            LanguageId::Rust => format!("..{val}"),
            LanguageId::Python | LanguageId::Ruby => format!("**{val}"),
            _ => format!("...{val}"),
        },
        RecordEntry::Field { key: None, .. } => val,
        RecordEntry::Field { key: Some(k), value } => match lang {
            LanguageId::Python | LanguageId::Dart => format!("\"{k}\": {val}"),
            LanguageId::Php => format!("\"{k}\" => {val}"),
            LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
                if matches!(value, Expr::Unary { op: UnaryOp::Generator, .. })
                    && let Some(gm) = format_js_gen_method_entry(k, &val)
                {
                    return gm;
                }
                if matches!(value, Expr::Closure { .. })
                    && let Some(acc) = format_js_accessor_entry(k, &val)
                {
                    return acc;
                }
                if is_js_prop_key(k) {
                    format!("{k}: {val}")
                } else {
                    format!("\"{}\": {val}", crate::printer_expr::escape_str(k))
                }
            }
            _ => format!("{k}: {val}"),
        },
    }
}

fn is_js_prop_key(k: &str) -> bool {
    if k.starts_with('[') && k.ends_with(']') && k.len() >= 3 {
        return true;
    }
    let b = k.as_bytes();
    !b.is_empty()
        && (b[0].is_ascii_alphabetic() || b[0] == b'_' || b[0] == b'$')
        && b.iter().all(|c| c.is_ascii_alphanumeric() || *c == b'_' || *c == b'$')
}

fn split_arrow_fn(rest: &str) -> Option<(&str, &str, String)> {
    let rest = rest.trim_start();
    if !rest.starts_with('(') { return None; }
    let mut depth = 0usize;
    let mut close_idx = None;
    for (i, ch) in rest.char_indices() {
        match ch {
            '(' => depth += 1,
            ')' => {
                depth -= 1;
                if depth == 0 { close_idx = Some(i); break; }
            }
            _ => {}
        }
    }
    let ci = close_idx?;
    let params = &rest[..=ci];
    let after = &rest[ci + 1..];
    let (ret_part, body_raw) = after.split_once(" => ")?;
    let body_tr = body_raw.trim();
    let body = if body_tr.starts_with('{') {
        body_tr.to_string()
    } else {
        format!("{{ return {body_tr}; }}")
    };
    Some((params, ret_part, body))
}

pub(crate) fn format_js_generator_fn(raw: &str, lang: LanguageId) -> String {
    if !matches!(lang, LanguageId::JavaScript | LanguageId::TypeScript | LanguageId::Tsx) {
        return raw.to_string();
    }
    let trimmed = raw.trim_start();
    let (is_async, rest) = match trimmed.strip_prefix("async ") {
        Some(r) => (true, r.trim_start()),
        None => (false, trimmed),
    };
    let Some((params, ret_part, body)) = split_arrow_fn(rest) else {
        return raw.to_string();
    };
    let asy = if is_async { "async " } else { "" };
    format!("{asy}function*{params}{ret_part} {body}")
}

pub(crate) fn format_rust_move_closure(raw: &str, lang: LanguageId) -> String {
    if lang != LanguageId::Rust { return raw.to_string(); }
    if let Some(rest) = raw.strip_prefix("async ") { format!("async move {rest}") } else { format!("move {raw}") }
}

fn format_js_gen_method_entry(key: &str, val: &str) -> Option<String> {
    let (pfx, rest) = val
        .strip_prefix("async function*")
        .map(|r| ("async *", r))
        .or_else(|| val.strip_prefix("function*").map(|r| ("*", r)))?;
    let prop = if is_js_prop_key(key) {
        key.to_string()
    } else {
        format!("\"{}\"", crate::printer_expr::escape_str(key))
    };
    Some(format!("{pfx}{prop}{rest}"))
}

fn format_js_accessor_entry(key: &str, val: &str) -> Option<String> {
    let (acc, name) = key.strip_prefix("get ").map(|n| ("get", n))
        .or_else(|| key.strip_prefix("set ").map(|n| ("set", n)))?;
    let name = name.trim();
    if name.is_empty() { return None; }
    let (params, ret_part, body) = split_arrow_fn(val)?;
    let prop = if is_js_prop_key(name) {
        name.to_string()
    } else {
        format!("\"{}\"", crate::printer_expr::escape_str(name))
    };
    Some(format!("{acc} {prop}{params}{ret_part} {body}"))
}
