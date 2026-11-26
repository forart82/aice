use aice_aice_ir::ir::{AiceItem, AiceModule, Trivia};
use aice_aice_ir::ir_code::{Expr, FnBody, Stmt};
use aice_aice_ir::ir_expr::LiteralVal;
use aice_lang_registry::LanguageId;

#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub(crate) enum DummyWrapper {
    IfFalse,
    Try,
}

impl DummyWrapper {
    pub(crate) fn header_line(self) -> &'static str {
        match self {
            Self::IfFalse => "if false:",
            Self::Try => "try:",
        }
    }
}

fn starts_with_kw(s: &str, kw: &str) -> bool {
    s.strip_prefix(kw).is_some_and(|rest| {
        rest.is_empty()
            || (!rest.as_bytes()[0].is_ascii_alphanumeric() && rest.as_bytes()[0] != b'_')
    })
}

fn classify_continuation(lang: LanguageId, s: &str) -> Option<DummyWrapper> {
    let t = s.trim_start();
    if ["else", "elif", "elsif", "elseif"].iter().any(|kw| starts_with_kw(t, kw)) {
        return Some(DummyWrapper::IfFalse);
    }
    let is_try = ["catch", "except", "finally", "rescue", "ensure"]
        .iter()
        .any(|kw| starts_with_kw(t, kw))
        || (lang == LanguageId::Dart
            && t.strip_prefix("on").is_some_and(|r| {
                r.starts_with(char::is_whitespace)
                    && !r.trim_start().starts_with(['=', ';', '.', ','])
            }));
    is_try.then_some(DummyWrapper::Try)
}

pub(crate) fn skip_rust_char_or_lifetime(s: &str, i: usize) -> usize {
    let b = s.as_bytes();
    if b.get(i + 1) == Some(&b'\\') {
        let mut j = i + 3;
        while j < b.len() && j < i + 14 && b[j] != b'\n' {
            if b[j] == b'\'' {
                return j + 1;
            }
            j += 1;
        }
        return (i + 1).min(b.len());
    }
    if let Some(ch) = s[i + 1..].chars().next()
        && ch != '\n'
        && ch != '\''
    {
        let after_ch = i + 1 + ch.len_utf8();
        if b.get(after_ch) == Some(&b'\'') {
            return after_ch + 1;
        }
    }
    i + 1
}

pub(crate) fn skip_rust_raw_string(b: &[u8], i: usize) -> Option<usize> {
    if i > 0 && (b[i - 1].is_ascii_alphanumeric() || b[i - 1] == b'_') {
        return None;
    }
    let r_pos = match b[i] {
        b'r' => i,
        b'b' | b'c' if b.get(i + 1) == Some(&b'r') => i + 1,
        _ => return None,
    };
    let mut j = r_pos + 1;
    while b.get(j) == Some(&b'#') { j += 1; }
    if b.get(j) != Some(&b'"') { return None; }
    let hashes = j - (r_pos + 1);
    j += 1;
    while j < b.len() {
        if b[j] == b'"' && b.get(j + 1..j + 1 + hashes).is_some_and(|s| s.iter().all(|&c| c == b'#')) {
            return Some(j + 1 + hashes);
        }
        j += 1;
    }
    Some(b.len())
}

pub(crate) fn brace_net_depth(lang: LanguageId, s: &str) -> isize {
    let (b, mut i, mut d, mut q, mut lc, mut bc) = (s.as_bytes(), 0usize, 0isize, None, false, false);
    while i < b.len() {
        if lc {
            if b[i] == b'\n' { lc = false; }
            i += 1;
        } else if bc {
            if b[i] == b'*' && b.get(i + 1) == Some(&b'/') { bc = false; i += 2; } else { i += 1; }
        } else if let Some(qc) = q {
            if b[i] == b'\\' { i += 2; } else { if b[i] == qc { q = None; } i += 1; }
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'/') {
            lc = true; i += 2;
        } else if b[i] == b'/' && b.get(i + 1) == Some(&b'*') {
            bc = true; i += 2;
        } else if lang == LanguageId::Rust && let Some(next_i) = skip_rust_raw_string(b, i) {
            i = next_i;
        } else if lang == LanguageId::Rust && b[i] == b'\'' {
            i = skip_rust_char_or_lifetime(s, i);
        } else {
            match b[i] { b'"' | b'\'' | b'`' => q = Some(b[i]), b'{' => d += 1, b'}' => d -= 1, _ => {} }
            i += 1;
        }
    }
    d
}

pub(crate) fn prepare_intra_block_input(
    lang: LanguageId,
    ded: &str,
) -> (String, Option<DummyWrapper>) {
    let is_brace = !matches!(lang, LanguageId::Python | LanguageId::Ruby);
    let mut body = ded.to_string();
    if is_brace {
        let t = body.trim_start();
        if let Some(after) = t.strip_prefix('}') {
            let clean = after.trim_start();
            if classify_continuation(lang, clean).is_some() {
                body = clean.to_string();
            }
        }
        if brace_net_depth(lang, &body) == 1 {
            let mut lines: Vec<&str> = body.lines().collect();
            if let Some(pos) = lines.iter().rposition(|l| !l.trim().is_empty()) {
                let lt = lines[pos].trim();
                if let Some(after) = lt.strip_prefix('}')
                    && lt.ends_with('{')
                    && classify_continuation(lang, after).is_some()
                {
                    lines[pos] = "}";
                    body = lines.join("\n");
                }
            }
        }
    }
    let dummy = classify_continuation(lang, &body);
    (body, dummy)
}

pub(crate) fn wrap_intra_block_for_lang(
    lang: LanguageId,
    ded: &str,
) -> Option<(String, Option<DummyWrapper>)> {
    let (clean, dummy) = prepare_intra_block_input(lang, ded);
    if matches!(lang, LanguageId::C | LanguageId::Rust | LanguageId::Go)
        && dummy == Some(DummyWrapper::Try)
    {
        return None;
    }
    let c_pfx = match dummy {
        Some(DummyWrapper::IfFalse) => "if (false) {} ",
        Some(DummyWrapper::Try) => "try {} ",
        None => "",
    };
    let wrapped = match lang {
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            format!("function __aice_blk__() {{\n{c_pfx}{clean}\n}}")
        }
        LanguageId::Python => {
            let pfx = match dummy {
                Some(DummyWrapper::IfFalse) => "if False:\n    pass\n",
                Some(DummyWrapper::Try) => "try:\n    pass\n",
                None => "",
            };
            let ind: String = format!("{pfx}{clean}")
                .lines()
                .map(|l| format!("    {l}\n"))
                .collect();
            format!("def __aice_blk__():\n{ind}")
        }
        LanguageId::Rust => format!(
            "fn __aice_blk__() {{\n{}{clean}\n}}",
            if dummy == Some(DummyWrapper::IfFalse) { "if false {} " } else { "" }
        ),
        LanguageId::Go => format!(
            "func __aice_blk__() {{\n{}{clean}\n}}",
            if dummy == Some(DummyWrapper::IfFalse) { "if false {} " } else { "" }
        ),
        LanguageId::Java | LanguageId::CSharp => {
            format!("class _W {{\nvoid __aice_blk__() {{\n{c_pfx}{clean}\n}}\n}}")
        }
        LanguageId::C | LanguageId::Cpp | LanguageId::Dart => {
            format!("void __aice_blk__() {{\n{c_pfx}{clean}\n}}")
        }
        LanguageId::Kotlin => format!("fun __aice_blk__() {{\n{c_pfx}{clean}\n}}"),
        LanguageId::Php => format!("<?php\nfunction __aice_blk__() {{\n{c_pfx}{clean}\n}}"),
        LanguageId::Ruby => {
            let pfx = match dummy {
                Some(DummyWrapper::IfFalse) => "if false\n",
                Some(DummyWrapper::Try) => "begin\n",
                None => "",
            };
            let tail = if dummy.is_some() { "\nend" } else { "" };
            format!("def __aice_blk__\n{pfx}{clean}{tail}\nend")
        }
        _ => return None,
    };
    Some((wrapped, dummy))
}

pub(crate) fn strip_dummy_ast_trivia_and_body(module: &mut AiceModule, dummy: DummyWrapper) {
    let mut stmts_opt = None;
    for it in &mut module.items {
        match it {
            AiceItem::Fn(fd) if fd.name == "__aice_blk__" => {
                if let FnBody::Block(ref mut s) = fd.body {
                    stmts_opt = Some(s);
                }
                break;
            }
            AiceItem::Class(cd) if cd.name == "_W" => {
                if let Some(m) = cd.methods.iter_mut().find(|m| m.name == "__aice_blk__")
                    && let FnBody::Block(ref mut s) = m.body
                {
                    stmts_opt = Some(s);
                }
                break;
            }
            _ => {}
        }
    }
    let Some(stmts) = stmts_opt else { return };
    let empty_or_pass = |b: &[Stmt]| b.is_empty() || (b.len() == 1 && matches!(b[0], Stmt::Pass));
    match (dummy, stmts.first_mut()) {
        (DummyWrapper::IfFalse, Some(Stmt::If { cond, then_body, trivia, .. }))
            if matches!(cond, Expr::Literal(LiteralVal::Bool(false))) && empty_or_pass(then_body) =>
        {
            then_body.clear();
            *trivia = Trivia::default();
        }
        (DummyWrapper::Try, Some(Stmt::Try { try_body, trivia, .. }))
            if empty_or_pass(try_body) =>
        {
            try_body.clear();
            *trivia = Trivia::default();
        }
        _ => {}
    }
}

pub(crate) fn strip_printed_dummy_prefix(body_lines: &mut Vec<String>, dummy: DummyWrapper) {
    if body_lines.len() >= 2
        && body_lines[0].trim() == dummy.header_line()
        && body_lines[1].trim() == "pass"
    {
        body_lines.drain(0..2);
    }
}

#[cfg(test)]
mod tests {
    use super::{brace_net_depth, prepare_intra_block_input};
    use aice_lang_registry::LanguageId;

    #[test]
    fn rust_lifetimes_and_char_literals_preserve_brace_depth() {
        let s1 = "if let Some(x): Option<&'a str> = opt {\n    use_it(x);\n} else {";
        assert_eq!(brace_net_depth(LanguageId::Rust, s1), 1);
        let (clean, dummy) = prepare_intra_block_input(LanguageId::Rust, s1);
        assert!(clean.ends_with("\n}"), "expected stripped trailing else: {clean}");
        assert!(dummy.is_none());

        let s2 = "if x == '}' || x == '\\'' || x == '🦀' {\n    let s: &'static str = \"a\";\n} else {";
        assert_eq!(brace_net_depth(LanguageId::Rust, s2), 1);

        let ts = "if (s === '}') {\n    return 1;\n} else {";
        assert_eq!(brace_net_depth(LanguageId::TypeScript, ts), 1);
    }
}
