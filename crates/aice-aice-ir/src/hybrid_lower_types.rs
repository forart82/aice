use aice_lang_registry::LanguageId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum PunctKind {
    ColonColonEq, ColonColon, ColonEq, Colon, Arrow, FatArrow, LeftArrow,
    Hash, Dollar, Question, At, Caret, Semi, Comma,
    LBrace, RBrace, LParen, RParen, LBrack, RBrack, Eq, Star, Other(char),
}

#[derive(Debug, Clone)]
pub(crate) enum CodeTok<'a> {
    Word(&'a str),
    Num(&'a str),
    Ws(&'a str),
    Punct(PunctKind),
    Masked(&'a str),
}

impl<'a> CodeTok<'a> {
    pub fn text(&self) -> String {
        match self {
            Self::Word(s) | Self::Num(s) | Self::Ws(s) | Self::Masked(s) => (*s).to_string(),
            Self::Punct(p) => match p {
                PunctKind::ColonColonEq => "::=".into(), PunctKind::ColonColon => "::".into(),
                PunctKind::ColonEq => ":=".into(), PunctKind::Colon => ":".into(),
                PunctKind::Arrow => "->".into(), PunctKind::FatArrow => "=>".into(),
                PunctKind::LeftArrow => "<-".into(), PunctKind::Hash => "#".into(),
                PunctKind::Dollar => "$".into(), PunctKind::Question => "?".into(),
                PunctKind::At => "@".into(), PunctKind::Caret => "^".into(),
                PunctKind::Semi => ";".into(), PunctKind::Comma => ",".into(),
                PunctKind::LBrace => "{".into(), PunctKind::RBrace => "}".into(),
                PunctKind::LParen => "(".into(), PunctKind::RParen => ")".into(),
                PunctKind::LBrack => "[".into(), PunctKind::RBrack => "]".into(),
                PunctKind::Eq => "=".into(), PunctKind::Star => "*".into(),
                PunctKind::Other(c) => c.to_string(),
            },
        }
    }
}

pub(crate) fn map_compact_sigil(sig: &str, dim: usize, target: LanguageId) -> Option<String> {
    let base = match (sig, target) {
        ("#", LanguageId::TypeScript | LanguageId::Tsx) => "number",
        ("$", LanguageId::TypeScript | LanguageId::Tsx) => "string",
        ("?", LanguageId::TypeScript | LanguageId::Tsx) => "boolean",
        ("_", LanguageId::TypeScript | LanguageId::Tsx) => "void",
        ("*", LanguageId::TypeScript | LanguageId::Tsx) => "any",
        ("#", LanguageId::Python) => "float", ("$", LanguageId::Python) => "str",
        ("?", LanguageId::Python) => "bool", ("_", LanguageId::Python) => "None",
        ("*", LanguageId::Python) => "Any",
        ("#", LanguageId::Rust) => "f64", ("$", LanguageId::Rust) => "String",
        ("?", LanguageId::Rust) => "bool", ("_", LanguageId::Rust) => "()",
        ("#", LanguageId::Go) => "float64", ("$", LanguageId::Go) => "string",
        ("?", LanguageId::Go) => "bool", ("_", LanguageId::Go) => "",
        ("*", LanguageId::Go) => "any",
        ("#", LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Dart) => "double",
        ("$", LanguageId::Cpp) => "std::string",
        ("$", LanguageId::C) => "const char*",
        ("$", LanguageId::CSharp) => "string",
        ("$", LanguageId::Dart) => "String",
        ("?", LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Dart) => "bool",
        ("_", LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Dart) => "void",
        ("*", LanguageId::Cpp) => "auto", ("*", LanguageId::CSharp) => "object", ("*", LanguageId::Dart) => "dynamic",
        ("#", LanguageId::Java) => "double", ("$", LanguageId::Java) => "String",
        ("?", LanguageId::Java) => "boolean", ("_", LanguageId::Java) => "void", ("*", LanguageId::Java) => "Object",
        ("#", LanguageId::Kotlin) => "Double", ("$", LanguageId::Kotlin) => "String",
        ("?", LanguageId::Kotlin) => "Boolean", ("_", LanguageId::Kotlin) => "Unit", ("*", LanguageId::Kotlin) => "Any",
        ("#", LanguageId::Php) => "float", ("$", LanguageId::Php) => "string",
        ("?", LanguageId::Php) => "bool", ("_", LanguageId::Php) => "void", ("*", LanguageId::Php) => "mixed",
        ("i", LanguageId::Rust) => "i64",
        ("i", LanguageId::TypeScript | LanguageId::Tsx) => "number",
        ("i", LanguageId::Kotlin) => "Int",
        ("i", LanguageId::Python | LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart | LanguageId::Php) => "int",
        _ => return None,
    };
    let mut ty = base.to_string();
    for _ in 0..dim {
        ty = match target {
            LanguageId::TypeScript | LanguageId::Tsx | LanguageId::CSharp => format!("{ty}[]"),
            LanguageId::Python => format!("list[{ty}]"),
            LanguageId::Rust => format!("Vec<{ty}>"),
            LanguageId::Go => format!("[]{ty}"),
            LanguageId::Cpp => format!("std::vector<{ty}>"),
            LanguageId::Java | LanguageId::Kotlin => {
                let boxed = match ty.as_str() { "double" => "Double", "boolean" => "Boolean", o => o };
                format!("List<{boxed}>")
            }
            LanguageId::Dart => format!("List<{ty}>"),
            LanguageId::Php => "array".to_string(),
            _ => format!("{ty}[]"),
        };
    }
    Some(ty)
}

pub(crate) fn lower_type_sigils_in_tokens(toks: Vec<CodeTok<'_>>, target: LanguageId) -> Vec<String> {
    let type_first = matches!(
        target,
        LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart | LanguageId::Php
    );
    let mut out: Vec<String> = Vec::with_capacity(toks.len());
    let mut i = 0usize;
    while i < toks.len() {
        // Check `param: <sigil>` or `$param: <sigil>` in type-first languages
        if type_first {
            let is_php_var = target == LanguageId::Php
                && matches!(toks[i], CodeTok::Punct(PunctKind::Dollar))
                && matches!(toks.get(i + 1), Some(CodeTok::Word(_)));
            let name_idx = if is_php_var { Some(i + 1) } else if matches!(toks[i], CodeTok::Word(_)) { Some(i) } else { None };
            if let Some(n_i) = name_idx {
                let mut k = n_i + 1;
                while k < toks.len() && matches!(toks[k], CodeTok::Ws(_)) { k += 1; }
                if matches!(toks.get(k), Some(CodeTok::Punct(PunctKind::Colon))) {
                    let mut j = k + 1;
                    while j < toks.len() && matches!(toks[j], CodeTok::Ws(_)) { j += 1; }
                    let mut had_sigil_colon = false;
                    if matches!(toks.get(j), Some(CodeTok::Punct(PunctKind::Colon))) {
                        had_sigil_colon = true;
                        j += 1;
                        while j < toks.len() && matches!(toks[j], CodeTok::Ws(_)) { j += 1; }
                    }
                    if let Some((sig, dim, end_j)) = parse_compact_sigil(&toks, j, had_sigil_colon)
                        && let Some(mapped) = map_compact_sigil(sig, dim, target)
                    {
                        let pname = if is_php_var { format!("${}", toks[n_i].text()) } else { toks[n_i].text() };
                        out.push(format!("{mapped} {pname}"));
                        i = end_j;
                        continue;
                    }
                }
            }
        }
        let is_colon_or_arrow = matches!(toks[i], CodeTok::Punct(PunctKind::Colon | PunctKind::Arrow));
        if is_colon_or_arrow {
            let sep = if matches!(toks[i], CodeTok::Punct(PunctKind::Arrow)) { "->" } else { ":" };
            let mut j = i + 1;
            while j < toks.len() && matches!(toks[j], CodeTok::Ws(_)) { j += 1; }
            let mut had_sigil_colon = false;
            if j < toks.len() && matches!(toks[j], CodeTok::Punct(PunctKind::Colon)) {
                had_sigil_colon = true;
                j += 1;
                while j < toks.len() && matches!(toks[j], CodeTok::Ws(_)) { j += 1; }
            }
            if let Some((sig, dim, end_j)) = parse_compact_sigil(&toks, j, had_sigil_colon)
                && let Some(mapped) = map_compact_sigil(sig, dim, target)
            {
                if target == LanguageId::JavaScript { i = end_j; continue; }
                if sep == ":" {
                    if matches!(target, LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart) {
                        out.push(format!(" {mapped}"));
                    } else {
                        out.push(format!(": {mapped}"));
                    }
                } else {
                    match target {
                        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::Php => {
                            if !mapped.is_empty() {
                                if out.last().is_some_and(|s| s == " ") { out.pop(); }
                                out.push(format!(": {mapped}"));
                            }
                        }
                        LanguageId::Go | LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart => {
                            if !mapped.is_empty() { out.push(mapped); }
                        }
                        _ => {
                            if !mapped.is_empty() { out.push(format!("-> {mapped}")); }
                        }
                    }
                }
                i = end_j;
                continue;
            }
        }
        out.push(toks[i].text());
        i += 1;
    }
    if matches!(target, LanguageId::C | LanguageId::Cpp | LanguageId::CSharp | LanguageId::Java | LanguageId::Dart) {
        return rewrite_c_style_fn_header(out, target);
    }
    out
}

fn rewrite_c_style_fn_header(mut toks: Vec<String>, target: LanguageId) -> Vec<String> {
    let fn_pos = toks.iter().position(|t| t == "fn");
    let Some(fi) = fn_pos else { return toks; };
    let mut name_i = fi + 1;
    while name_i < toks.len() && toks[name_i].trim().is_empty() { name_i += 1; }
    let mut lp = name_i + 1;
    while lp < toks.len() && toks[lp].trim().is_empty() { lp += 1; }
    if lp >= toks.len() || toks[lp] != "(" { return toks; }
    let mut depth = 0isize;
    let mut rp = lp;
    while rp < toks.len() {
        if toks[rp] == "(" { depth += 1; }
        else if toks[rp] == ")" { depth -= 1; if depth == 0 { break; } }
        rp += 1;
    }
    if rp >= toks.len() { return toks; }
    let mut k = rp + 1;
    while k < toks.len() && toks[k] != "{" && toks[k] != ";" {
        k += 1;
    }
    if k >= toks.len() || (toks[k] != "{" && toks[k] != ";") { return toks; }
    let raw_ret: String = toks[rp + 1..k].concat();
    let trimmed_ret = raw_ret.trim();
    let stripped_ret = trimmed_ret.strip_prefix("->").unwrap_or(trimmed_ret).trim();
    let ret = if stripped_ret.is_empty() { "void".to_string() } else { stripped_ret.to_string() };
    let mut res = Vec::new();
    for t in &toks[..fi] {
        if matches!(target, LanguageId::C | LanguageId::Cpp | LanguageId::Dart)
            && matches!(t.as_str(), "public" | "private" | "protected")
        {
            continue;
        }
        res.push(t.clone());
    }
    // Trim extra leading whitespace if visibility was stripped
    if matches!(target, LanguageId::C | LanguageId::Cpp | LanguageId::Dart) {
        while res.last().is_some_and(|x| x.trim().is_empty()) && res.len() > 1 {
            res.pop();
        }
    }
    res.push(format!("{ret} "));
    res.extend(toks.drain(name_i..=rp));
    res.push(" ".to_string());
    res.extend(toks.drain(k - (rp - name_i + 1)..));
    res
}

fn parse_compact_sigil<'a>(toks: &[CodeTok<'a>], mut j: usize, allow_i: bool) -> Option<(&'static str, usize, usize)> {
    let mut dim = 0usize;
    while j < toks.len() && matches!(toks[j], CodeTok::Punct(PunctKind::LBrack)) && dim < 3 {
        dim += 1;
        j += 1;
    }
    if j >= toks.len() { return None; }
    let sig = match &toks[j] {
        CodeTok::Punct(PunctKind::Hash) => "#",
        CodeTok::Punct(PunctKind::Dollar) => "$",
        CodeTok::Punct(PunctKind::Question) => "?",
        CodeTok::Word("_") => "_",
        CodeTok::Word("i") if allow_i => "i",
        CodeTok::Punct(PunctKind::Star) => "*",
        _ => return None,
    };
    j += 1;
    for _ in 0..dim {
        if j >= toks.len() || !matches!(toks[j], CodeTok::Punct(PunctKind::RBrack)) { return None; }
        j += 1;
    }
    Some((sig, dim, j))
}
