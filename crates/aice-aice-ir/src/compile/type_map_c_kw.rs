pub(crate) fn is_c_non_type_kw(w: &str) -> bool {
    matches!(
        w,
        "const"
            | "volatile"
            | "restrict"
            | "struct"
            | "union"
            | "enum"
            | "auto"
            | "extern"
            | "register"
            | "static"
            | "typedef"
            | "_Thread_local"
            | "thread_local"
            | "inline"
            | "_Noreturn"
            | "_Alignas"
            | "_Alignof"
            | "_Atomic"
            | "_Generic"
            | "_Static_assert"
            | "alignas"
            | "alignof"
            | "static_assert"
            | "typeof"
            | "typeof_unqual"
            | "constexpr"
            | "nullptr"
            | "break"
            | "case"
            | "continue"
            | "default"
            | "do"
            | "else"
            | "for"
            | "goto"
            | "if"
            | "return"
            | "sizeof"
            | "switch"
            | "while"
    )
}

pub(crate) fn is_c_prefix_kw(w: &str) -> bool {
    matches!(
        w,
        "const"
            | "volatile"
            | "struct"
            | "union"
            | "enum"
            | "unsigned"
            | "signed"
            | "short"
            | "long"
    )
}

fn is_c_any_kw(w: &str) -> bool {
    is_c_non_type_kw(w) || is_c_prefix_kw(w)
        || matches!(w, "void" | "char" | "int" | "float" | "double" | "_Bool" | "bool" | "_Complex")
}

pub(crate) fn validate_c_specifiers(words: &[&str]) -> bool {
    if words.is_empty() {
        return false;
    }
    let last = words[words.len() - 1];
    if last == "_" || is_c_non_type_kw(last) {
        return false;
    }
    if words.len() == 1 {
        return true;
    }
    if !words[..words.len() - 1]
        .iter()
        .all(|w| is_c_prefix_kw(w) || (last == "void" && *w == "restrict"))
    {
        return false;
    }
    let (mut n_const, mut n_vol, mut n_rest) = (0u8, 0u8, 0u8);
    let (mut n_sign, mut n_short, mut n_long, mut n_tag) = (0u8, 0u8, 0u8, 0u8);
    for (idx, &w) in words[..words.len() - 1].iter().enumerate() {
        match w {
            "const" => n_const += 1,
            "volatile" => n_vol += 1,
            "restrict" => n_rest += 1,
            "signed" | "unsigned" => n_sign += 1,
            "short" => n_short += 1,
            "long" => n_long += 1,
            "struct" | "union" | "enum" => {
                n_tag += 1;
                if idx + 2 != words.len() {
                    return false;
                }
            }
            _ => {}
        }
    }
    if n_const > 1 || n_vol > 1 || n_rest > 1 || n_sign > 1 || n_tag > 1 {
        return false;
    }
    if n_tag == 1 {
        return n_sign == 0 && n_short == 0 && n_long == 0 && !is_c_any_kw(last);
    }
    if (n_short > 0 && n_long > 0) || n_short > 1 || n_long > 2 {
        return false;
    }
    if last == "long" {
        return n_short == 0 && n_long <= 1;
    }
    if last == "short" {
        return n_short == 0 && n_long == 0;
    }
    if matches!(last, "signed" | "unsigned") {
        return n_sign == 0;
    }
    if n_long == 2 {
        return last == "int";
    }
    if n_short == 1 {
        return last == "int";
    }
    if n_long == 1 {
        return (n_sign == 0 && matches!(last, "double" | "_Complex")) || last == "int";
    }
    if n_sign == 1 {
        return matches!(last, "char" | "int");
    }
    true
}
