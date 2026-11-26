use aice_aice_ir::ir::{AiceItem, AiceModule};
use aice_lang_registry::LanguageId;

use crate::aice_unwrap::has_custom_module_name;

fn is_slash_cmt(t: &str) -> bool {
    t.starts_with("//") || t.starts_with("/*") || t.starts_with('*')
}

pub(crate) fn strip_first_matching_line(text: &str, pred: impl Fn(&str) -> bool) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let Some(idx) = lines.iter().position(|l| pred(l.trim())) else {
        return text.to_string();
    };
    let mut after = idx + 1;
    while after < lines.len() && lines[after].trim().is_empty() {
        after += 1;
    }
    let mut kept: Vec<&str> = Vec::with_capacity(lines.len());
    kept.extend_from_slice(&lines[..idx]);
    while kept.last().is_some_and(|l| l.trim().is_empty()) && after < lines.len() {
        kept.pop();
    }
    kept.extend_from_slice(&lines[after..]);
    while kept.last().is_some_and(|l| l.trim().is_empty()) {
        kept.pop();
    }
    if kept.is_empty() { String::new() } else { format!("{}\n", kept.join("\n")) }
}

fn join_unwrapped(
    lines: &[&str],
    head_end: usize,
    start: usize,
    end: usize,
    tail_start: usize,
    dedent: usize,
) -> String {
    let mut out: Vec<String> = Vec::new();
    for l in &lines[..head_end] {
        if !l.trim().is_empty() || !out.is_empty() {
            out.push((*l).to_string());
        }
    }
    for l in &lines[start..end] {
        let strip = l.bytes().take(dedent).take_while(|&b| b == b' ').count();
        out.push(l[strip..].to_string());
    }
    for l in &lines[tail_start..] {
        if !l.trim().is_empty() {
            out.push((*l).to_string());
        }
    }
    while out.last().is_some_and(|l| l.trim().is_empty()) {
        out.pop();
    }
    if out.is_empty() { String::new() } else { format!("{}\n", out.join("\n")) }
}

pub(crate) fn unwrap_outer_block(
    text: &str,
    open_pred: impl Fn(&str) -> bool,
    close_tok: &str,
    dedent: usize,
) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let Some(open_idx) = lines.iter().position(|l| open_pred(l.trim())) else {
        return text.to_string();
    };
    let Some(close_idx) = lines.iter().rposition(|l| l.trim() == close_tok) else {
        return text.to_string();
    };
    if close_idx <= open_idx {
        return text.to_string();
    }
    let mut start = open_idx + 1;
    while start < close_idx && lines[start].trim().is_empty() {
        start += 1;
    }
    let mut end = close_idx;
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    join_unwrapped(&lines, open_idx, start, end, close_idx + 1, dedent)
}

fn unwrap_cpp_class(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let Some(open_idx) = lines.iter().position(|l| {
        let t = l.trim();
        !is_slash_cmt(t) && (t.starts_with("class ") || t.starts_with("struct ")) && t.ends_with('{')
    }) else {
        return text.to_string();
    };
    let Some(close_idx) = lines.iter().rposition(|l| l.trim() == "};") else {
        return text.to_string();
    };
    if close_idx <= open_idx {
        return text.to_string();
    }
    let mut start = open_idx + 1;
    while start < close_idx && lines[start].trim().is_empty() {
        start += 1;
    }
    if start < close_idx && matches!(lines[start].trim(), "public:" | "protected:" | "private:") {
        start += 1;
        while start < close_idx && lines[start].trim().is_empty() {
            start += 1;
        }
    }
    let mut end = close_idx;
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    join_unwrapped(&lines, open_idx, start, end, close_idx + 1, 4)
}

fn unwrap_python_class(text: &str) -> String {
    let lines: Vec<&str> = text.lines().collect();
    let Some(open_idx) = lines.iter().position(|l| {
        let t = l.trim();
        !l.starts_with(' ') && !l.starts_with('\t') && t.starts_with("class ") && t.ends_with(':')
    }) else {
        return text.to_string();
    };
    let mut head_end = open_idx;
    while head_end > 0 && lines[head_end - 1].trim_start().starts_with('@') {
        head_end -= 1;
    }
    let mut close_idx = open_idx + 1;
    while close_idx < lines.len() {
        let l = lines[close_idx];
        if l.trim().is_empty() || l.starts_with(' ') || l.starts_with('\t') {
            close_idx += 1;
        } else {
            break;
        }
    }
    let mut start = open_idx + 1;
    while start < close_idx && lines[start].trim().is_empty() {
        start += 1;
    }
    let mut end = close_idx;
    while end > start && lines[end - 1].trim().is_empty() {
        end -= 1;
    }
    join_unwrapped(&lines, head_end, start, end, close_idx, 4)
}

pub(crate) fn has_single_wrapper_class(module: &AiceModule) -> bool {
    let mut non_imports = module.items.iter().filter(|it| !matches!(it, AiceItem::Import(_)));
    let Some(first) = non_imports.next() else {
        return false;
    };
    if non_imports.next().is_some() {
        return false;
    }
    matches!(
        first,
        AiceItem::Class(cd)
            if cd.props.is_empty()
                && cd.primary_ctor.is_empty()
                && cd.static_blocks.is_empty()
                && cd.type_params.is_empty()
                && cd.methods.len() == 1
    )
}

pub(crate) fn unwrap_class_wrappers(
    mut out: String,
    module: &AiceModule,
    lang: LanguageId,
    unwrap_enclosing_class: bool,
) -> String {
    let single_cls = unwrap_enclosing_class && has_single_wrapper_class(module);
    match lang {
        LanguageId::Go if single_cls => {
            out = strip_first_matching_line(&out, |t| t.starts_with("type ") && t.ends_with("struct {}"));
        }
        LanguageId::Php if single_cls => {
            out = unwrap_outer_block(&out, |t| t.starts_with("class ") && t.ends_with('{'), "}", 4);
        }
        LanguageId::Kotlin if single_cls => {
            out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.contains("class ") && t.ends_with('{'), "}", 4);
        }
        LanguageId::Java => {
            let has_top_fns = module.items.iter().any(|it| matches!(it, AiceItem::Fn(_)));
            let has_explicit_types = module.items.iter().any(|it| {
                matches!(it, AiceItem::Class(_) | AiceItem::Enum(_) | AiceItem::Type(_))
            });
            if has_top_fns && !has_explicit_types {
                out = unwrap_outer_block(&out, |t| t.starts_with("public class ") && t.ends_with('{'), "}", 4);
            } else if single_cls {
                out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.contains("class ") && t.ends_with('{'), "}", 4);
            }
        }
        LanguageId::CSharp => {
            if has_custom_module_name(module, "csharp") {
                out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.starts_with("namespace ") && t.ends_with('{'), "}", 0);
            }
            if single_cls {
                out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.contains("class ") && t.ends_with('{'), "}", 4);
            }
        }
        LanguageId::Cpp => {
            if has_custom_module_name(module, "cpp") {
                out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.starts_with("namespace ") && t.ends_with('{'), "}", 0);
            }
            if single_cls {
                out = unwrap_cpp_class(&out);
            }
        }
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript if single_cls => {
            out = unwrap_outer_block(
                &out,
                |t| {
                    !is_slash_cmt(t)
                        && (t.starts_with("class ")
                            || t.starts_with("export class ")
                            || t.starts_with("abstract class ")
                            || t.starts_with("export abstract class "))
                        && t.ends_with('{')
                },
                "}",
                2,
            );
        }
        LanguageId::Dart if single_cls => {
            out = unwrap_outer_block(&out, |t| !is_slash_cmt(t) && t.starts_with("class ") && t.ends_with('{'), "}", 2);
        }
        LanguageId::Python if single_cls => {
            out = unwrap_python_class(&out);
        }
        LanguageId::Rust if single_cls => {
            out = strip_first_matching_line(
                &out,
                |t| {
                    !is_slash_cmt(t)
                        && !t.contains('{')
                        && t.ends_with(';')
                        && (t.starts_with("struct ") || (t.starts_with("pub") && t.contains(" struct ")))
                },
            );
            out = unwrap_outer_block(
                &out,
                |t| !is_slash_cmt(t) && (t.starts_with("impl ") || t.starts_with("impl<")) && t.ends_with('{'),
                "}",
                4,
            );
        }
        LanguageId::Ruby if single_cls => {
            out = unwrap_outer_block(&out, |t| !t.starts_with('#') && t.starts_with("class "), "end", 2);
        }
        _ => {}
    }
    out
}
