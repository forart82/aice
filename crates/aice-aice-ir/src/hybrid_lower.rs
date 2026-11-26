use aice_lang_registry::LanguageId;

use crate::hybrid_lex::{LexSpanKind, is_ident_byte, lex_hybrid};
use crate::hybrid_lower_guards::{find_binding_insert_pos, has_stmt_decl_kw, is_fn_kw, is_ret_stmt, is_vis_modifier, prev_non_ws};
use crate::hybrid_lower_types::{CodeTok, PunctKind, lower_type_sigils_in_tokens};

#[derive(Debug, Clone, Default)]
pub struct HybridLowerOpts {
    pub inside_class: bool,
    pub go_receiver: Option<String>,
}

pub fn lower_hybrid_sigils(src: &str) -> String {
    lower_hybrid_sigils_for(src, LanguageId::TypeScript)
}

pub fn lower_hybrid_sigils_for(src: &str, target: LanguageId) -> String {
    lower_hybrid_sigils_with_opts(src, target, &HybridLowerOpts::default())
}

pub fn lower_hybrid_sigils_with_opts(
    src: &str,
    target: LanguageId,
    opts: &HybridLowerOpts,
) -> String {
    if !is_imperative_target(target) {
        return src.to_string();
    }
    let spans = lex_hybrid(src, target);
    let mut out = String::with_capacity(src.len());
    let mut brace_depth = 0usize;
    let mut class_depths: Vec<usize> = if opts.inside_class { vec![0] } else { Vec::new() };

    let mut tokens: Vec<CodeTok<'_>> = Vec::new();
    for sp in &spans {
        if sp.kind == LexSpanKind::Code {
            tokenize_code_span(&src[sp.start..sp.end], &mut tokens);
        } else {
            tokens.push(CodeTok::Masked(&src[sp.start..sp.end]));
        }
    }

    let mut line_toks: Vec<CodeTok<'_>> = Vec::new();
    for tok in tokens {
        if let CodeTok::Ws(ws) = tok && ws.contains('\n') {
            let mut start = 0usize;
            for (idx, b) in ws.bytes().enumerate() {
                if b == b'\n' {
                    if idx > start { line_toks.push(CodeTok::Ws(&ws[start..idx])); }
                    let in_cls = class_depths.last().is_some_and(|&cd| brace_depth == cd + 1);
                    let lowered = lower_line(&line_toks, target, in_cls, opts);
                    out.push_str(&lowered);
                    out.push('\n');
                    update_depths(&line_toks, &mut brace_depth, &mut class_depths);
                    line_toks.clear();
                    start = idx + 1;
                }
            }
            if start < ws.len() { line_toks.push(CodeTok::Ws(&ws[start..])); }
            continue;
        }
        line_toks.push(tok);
    }
    if !line_toks.is_empty() {
        let in_cls = class_depths.last().is_some_and(|&cd| brace_depth == cd + 1);
        out.push_str(&lower_line(&line_toks, target, in_cls, opts));
    }
    out
}

fn is_imperative_target(t: LanguageId) -> bool {
    matches!(
        t,
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::Python
            | LanguageId::Rust | LanguageId::Go | LanguageId::C | LanguageId::Cpp
            | LanguageId::CSharp | LanguageId::Java | LanguageId::Kotlin | LanguageId::Dart
            | LanguageId::Php | LanguageId::Ruby
    )
}

fn update_depths(toks: &[CodeTok<'_>], brace_depth: &mut usize, class_depths: &mut Vec<usize>) {
    let has_class = toks.iter().any(|t| matches!(t, CodeTok::Word("class" | "@cls")));
    for t in toks {
        match t {
            CodeTok::Punct(PunctKind::LBrace) => {
                if has_class && class_depths.last().copied() != Some(*brace_depth) {
                    class_depths.push(*brace_depth);
                }
                *brace_depth += 1;
            }
            CodeTok::Punct(PunctKind::RBrace) => {
                *brace_depth = brace_depth.saturating_sub(1);
                if class_depths.last().copied() == Some(*brace_depth) {
                    class_depths.pop();
                }
            }
            _ => {}
        }
    }
}

fn tokenize_code_span<'a>(s: &'a str, out: &mut Vec<CodeTok<'a>>) {
    let b = s.as_bytes();
    let mut i = 0usize;
    while i < b.len() {
        let c = b[i];
        if c.is_ascii_whitespace() {
            let st = i;
            while i < b.len() && b[i].is_ascii_whitespace() { i += 1; }
            out.push(CodeTok::Ws(&s[st..i]));
            continue;
        }
        if c.is_ascii_digit() {
            let st = i;
            while i < b.len() && (b[i].is_ascii_alphanumeric() || b[i] == b'_' || b[i] == b'.') { i += 1; }
            out.push(CodeTok::Num(&s[st..i]));
            continue;
        }
        if c.is_ascii_alphabetic() || c == b'_' || !c.is_ascii() {
            let st = i;
            while i < b.len() {
                if is_ident_byte(b[i]) { i += 1; }
                else if !b[i].is_ascii() {
                    let cl = s[i..].chars().next().map(char::len_utf8).unwrap_or(1);
                    i += cl;
                } else { break; }
            }
            out.push(CodeTok::Word(&s[st..i]));
            continue;
        }
        let rest = &s[i..];
        let p = match () {
            _ if rest.starts_with("::=") => { i += 3; PunctKind::ColonColonEq }
            _ if rest.starts_with("::") => { i += 2; PunctKind::ColonColon }
            _ if rest.starts_with(":=") => { i += 2; PunctKind::ColonEq }
            _ if rest.starts_with("->") => { i += 2; PunctKind::Arrow }
            _ if rest.starts_with("=>") => { i += 2; PunctKind::FatArrow }
            _ if rest.starts_with("<-") => { i += 2; PunctKind::LeftArrow }
            _ => {
                i += 1;
                match c {
                    b':' => PunctKind::Colon, b'#' => PunctKind::Hash, b'$' => PunctKind::Dollar,
                    b'?' => PunctKind::Question, b'@' => PunctKind::At, b'^' => PunctKind::Caret,
                    b';' => PunctKind::Semi, b',' => PunctKind::Comma, b'{' => PunctKind::LBrace,
                    b'}' => PunctKind::RBrace, b'(' => PunctKind::LParen, b')' => PunctKind::RParen,
                    b'[' => PunctKind::LBrack, b']' => PunctKind::RBrack, b'=' => PunctKind::Eq,
                    b'*' => PunctKind::Star, _ => PunctKind::Other(c as char),
                }
            }
        };
        out.push(CodeTok::Punct(p));
    }
}

fn lower_line(toks: &[CodeTok<'_>], target: LanguageId, in_cls: bool, opts: &HybridLowerOpts) -> String {
    let mut rewritten = Vec::with_capacity(toks.len());
    let mut at_stmt_start = true;
    let mut i = 0usize;
    while i < toks.len() {
        let tok = &toks[i];
        if matches!(tok, CodeTok::Ws(_)) { rewritten.push(tok.clone()); i += 1; continue; }
        if at_stmt_start {
            if matches!(tok, CodeTok::Word("ret")) && is_ret_stmt(toks, i + 1) {
                rewritten.push(CodeTok::Word("return")); at_stmt_start = false; i += 1; continue;
            }
            if matches!(tok, CodeTok::Punct(PunctKind::LeftArrow)) && target != LanguageId::Go {
                rewritten.push(CodeTok::Word("return")); at_stmt_start = false; i += 1; continue;
            }
            if matches!(tok, CodeTok::Word("elif")) {
                let rep = match target { LanguageId::Python => "elif", LanguageId::Php => "elseif", LanguageId::Ruby => "elsif", _ => "else if" };
                rewritten.push(CodeTok::Word(rep)); at_stmt_start = false; i += 1; continue;
            }
        }
        if matches!(tok, CodeTok::Punct(PunctKind::At | PunctKind::Caret))
            && matches!(toks.get(i + 1), Some(CodeTok::Word("fn" | "cls" | "type" | "class")))
        {
            if matches!(tok, CodeTok::Punct(PunctKind::Caret)) {
                let pub_kw = match target {
                    LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript if !in_cls => "export ",
                    LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::CSharp | LanguageId::Java | LanguageId::Kotlin | LanguageId::Php => "public ",
                    LanguageId::Rust => "pub ",
                    _ => "",
                };
                if !pub_kw.is_empty() { rewritten.push(CodeTok::Masked(pub_kw)); }
            }
            i += 1;
            continue;
        }
        if let CodeTok::Word(vis @ ("pub" | "priv" | "prot")) = tok
            && is_vis_modifier(toks, i, prev_non_ws(&rewritten))
        {
            let rep = match (*vis, target) {
                ("pub", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript) if !in_cls => "export",
                ("pub", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript | LanguageId::CSharp | LanguageId::Java | LanguageId::Kotlin | LanguageId::Php) => "public",
                ("priv", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::CSharp | LanguageId::Java | LanguageId::Kotlin | LanguageId::Php | LanguageId::Ruby) => "private",
                ("prot", LanguageId::TypeScript | LanguageId::Tsx | LanguageId::CSharp | LanguageId::Java | LanguageId::Kotlin | LanguageId::Php | LanguageId::Ruby) => "protected",
                ("pub", LanguageId::Rust) => "pub",
                ("prot", LanguageId::Rust) => "pub(super)",
                _ => "",
            };
            if !rep.is_empty() { rewritten.push(CodeTok::Word(rep)); }
            else if matches!(toks.get(i + 1), Some(CodeTok::Ws(_))) { i += 1; }
            at_stmt_start = false; i += 1; continue;
        }
        if matches!(tok, CodeTok::Word("fn")) && is_fn_kw(toks, i, prev_non_ws(&rewritten), target) {
            let rep = match target {
                LanguageId::Python | LanguageId::Ruby => "def", LanguageId::Go => "func",
                LanguageId::Kotlin => "fun", LanguageId::Php => "function",
                LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript if !in_cls => "function",
                LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => "",
                _ => "fn",
            };
            if !rep.is_empty() { rewritten.push(CodeTok::Word(rep)); }
            else if matches!(toks.get(i + 1), Some(CodeTok::Ws(_))) { i += 1; }
            if target == LanguageId::Go && let Some(ref recv) = opts.go_receiver {
                rewritten.push(CodeTok::Ws(" ")); rewritten.push(CodeTok::Masked(recv));
            }
            at_stmt_start = false; i += 1; continue;
        }
        if matches!(tok, CodeTok::Word("cls")) {
            rewritten.push(CodeTok::Word(if target == LanguageId::Rust { "struct" } else { "class" }));
            at_stmt_start = false; i += 1; continue;
        }
        at_stmt_start = matches!(tok, CodeTok::Punct(PunctKind::Semi | PunctKind::LBrace | PunctKind::FatArrow | PunctKind::RParen) | CodeTok::Word("else"));
        rewritten.push(tok.clone()); i += 1;
    }
    lower_bindings_and_types(rewritten, target)
}

fn lower_bindings_and_types(toks: Vec<CodeTok<'_>>, target: LanguageId) -> String {
    let mut out = Vec::with_capacity(toks.len());
    let mut i = 0usize;
    while i < toks.len() {
        if matches!(toks[i], CodeTok::Punct(PunctKind::ColonEq | PunctKind::ColonColonEq))
            && target != LanguageId::Go
        {
            let is_mut = matches!(toks[i], CodeTok::Punct(PunctKind::ColonColonEq));
            if !has_stmt_decl_kw(&out)
                && let Some(ins_pos) = find_binding_insert_pos(&out)
            {
                let prefix = match (target, is_mut) {
                    (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, false) => "const ",
                    (LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript, true) => "let ",
                    (LanguageId::Rust, false) => "let ",
                    (LanguageId::Rust, true) => "let mut ",
                    (LanguageId::Kotlin, false) => "val ",
                    (LanguageId::Kotlin, true) => "var ",
                    (LanguageId::Dart, false) => "final ",
                    (LanguageId::Dart, true) => "var ",
                    (LanguageId::CSharp, _) => "var ",
                    (LanguageId::Java, false) => "final var ",
                    (LanguageId::Java, true) => "var ",
                    (LanguageId::Cpp, false) => "const auto ",
                    (LanguageId::Cpp, true) => "auto ",
                    (LanguageId::Php, _) => "$",
                    _ => "",
                };
                if !prefix.is_empty() {
                    out.insert(ins_pos, CodeTok::Masked(prefix));
                }
            }
            out.push(CodeTok::Punct(PunctKind::Eq));
            i += 1;
            continue;
        }
        out.push(toks[i].clone());
        i += 1;
    }
    lower_type_sigils_in_tokens(out, target).concat()
}
