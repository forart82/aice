#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum WalrusKind {
    StandaloneHybrid,
    Illegal,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct WalrusHit {
    pub line: usize,
    pub col: usize,
    pub byte_offset: usize,
    pub kind: WalrusKind,
}

macro_rules! child_field {
    ($parent:expr, $child:expr) => {{
        let p = $parent;
        let cid = $child.id();
        (0..p.child_count())
            .find(|&i| p.child(i).is_some_and(|c| c.id() == cid))
            .and_then(|i| p.field_name_for_child(i as u32))
    }};
}

fn is_line_leading_ws(src: &str, byte_pos: usize) -> bool {
    let ls = src[..byte_pos].rfind('\n').map_or(0, |p| p + 1);
    src[ls..byte_pos].bytes().all(|b| matches!(b, b' ' | b'\t'))
}

fn in_walrus_scope(hit_line: usize, scope: Option<(usize, usize)>, overlaps: bool) -> bool {
    match scope {
        None => true,
        Some((es, ee)) => (hit_line >= es && hit_line <= ee) || overlaps,
    }
}

fn fstr_prefix_valid(src: &str, expr_sb: usize, colon_byte: usize) -> bool {
    let Some(prefix) = src.get(expr_sb..colon_byte) else {
        return false;
    };
    if prefix.trim().is_empty() {
        return false;
    }
    let wrapped = format!("({prefix})");
    aice_ast_engine::parse_slot(aice_ast_engine::GrammarSlot::Python, &wrapped)
        .is_ok_and(|t| !t.root_node().has_error())
}

fn match_err_walrus(src: &str, sb: usize, txt: &str, row: usize, col: usize) -> Option<(usize, usize, usize)> {
    if matches!(txt, ":=" | "::=") || (txt == ":" && src.get(sb..sb + 2) == Some(":=")) {
        Some((row + 1, col + 1, sb))
    } else if txt == "=" && sb > 0 && src.get(sb - 1..sb + 1) == Some(":=") {
        Some((row + 1, col, sb - 1))
    } else {
        None
    }
}

pub(crate) fn scan_cst_raw(
    src: &str,
    scope: Option<(usize, usize)>,
    check_stmt_overlap: bool,
) -> Vec<WalrusHit> {
    if !src.contains(":=") {
        return Vec::new();
    }
    let Ok(tree) = aice_ast_engine::parse_slot(aice_ast_engine::GrammarSlot::Python, src) else {
        return Vec::new();
    };
    let mut hits = Vec::new();
    let mut stack = vec![tree.root_node()];

    while let Some(n) = stack.pop() {
        let kind = n.kind();
        if matches!(kind, "comment" | "string_start" | "string_content" | "string_end" | "escape_sequence") {
            continue;
        }
        if n.is_error() {
            let mut check_tok = |sb: usize, txt: &str, row: usize, col: usize| {
                if let Some((line, c1, off)) = match_err_walrus(src, sb, txt, row, col)
                    && in_walrus_scope(line, scope, false)
                {
                    hits.push(WalrusHit { line, col: c1, byte_offset: off, kind: WalrusKind::Illegal });
                }
            };
            if n.child_count() == 0 {
                let sp = n.start_position();
                check_tok(n.start_byte(), src.get(n.byte_range()).unwrap_or(""), sp.row, sp.column);
            } else {
                for i in 0..n.child_count() {
                    if let Some(c) = n.child(i) && !c.is_named() {
                        let sp = c.start_position();
                        check_tok(c.start_byte(), src.get(c.byte_range()).unwrap_or(""), sp.row, sp.column);
                    }
                }
            }
        } else if kind == "named_expression" {
            let mut op_pos = (n.start_position().row + 1, n.start_position().column + 1, n.start_byte());
            for i in 0..n.child_count() {
                if let Some(c) = n.child(i) && !c.is_named() && src.get(c.byte_range()) == Some(":=") {
                    let sp = c.start_position();
                    op_pos = (sp.row + 1, sp.column + 1, c.start_byte());
                    break;
                }
            }
            let mut is_fstr_fmt_spec = false;
            let (mut cur, mut anc) = (n, n.parent());
            while let Some(p) = anc {
                match p.kind() {
                    "interpolation" | "format_expression" => {
                        if let Some(expr) = p.child_by_field_name("expression") {
                            let is_direct = cur.id() == expr.id()
                                && n.id() == expr.id()
                                && !n.has_error()
                                && n.child_by_field_name("name")
                                    .is_some_and(|nm| nm.kind() == "identifier" && !nm.has_error());
                            is_fstr_fmt_spec =
                                is_direct || fstr_prefix_valid(src, expr.start_byte(), op_pos.2);
                        }
                        break;
                    }
                    "parenthesized_expression" | "tuple" | "list" | "set" | "dictionary"
                    | "list_comprehension" | "set_comprehension" | "dictionary_comprehension"
                    | "generator_expression" | "argument_list" | "subscript" | "lambda"
                    | "module" | "block" => break,
                    _ => {
                        cur = p;
                        anc = p.parent();
                    }
                }
            }
            if !is_fstr_fmt_spec {
                let mut overlaps = false;
                if check_stmt_overlap && let Some((es, ee)) = scope {
                    let mut ap = n.parent();
                    while let Some(a) = ap {
                        let ak = a.kind();
                        if matches!(ak, "module" | "block" | "function_definition" | "class_definition") { break; }
                        if matches!(
                            ak,
                            "list_comprehension" | "set_comprehension" | "dictionary_comprehension"
                            | "generator_expression" | "assignment" | "augmented_assignment"
                            | "return_statement" | "expression_statement" | "delete_statement"
                            | "assert_statement" | "raise_statement" | "argument_list"
                            | "dictionary" | "list" | "set" | "tuple" | "subscript" | "slice"
                            | "parenthesized_expression"
                        ) && (a.start_position().row + 1) <= ee && (a.end_position().row + 1) >= es {
                            overlaps = true;
                            break;
                        }
                        ap = a.parent();
                    }
                }
                if in_walrus_scope(op_pos.0, scope, overlaps) {
                    let name_node = n.child_by_field_name("name");
                    let val_node = n.child_by_field_name("value");
                    let malformed = n.has_error()
                        || name_node.is_none_or(|nm| nm.kind() != "identifier")
                        || val_node.is_none_or(|v| v.is_missing() || v.has_error());
                    let mut has_err_anc = false;
                    let mut ap = n.parent();
                    while let Some(a) = ap {
                        if a.is_error() { has_err_anc = true; break; }
                        ap = a.parent();
                    }
                    let parent = n.parent();
                    let is_standalone = !malformed
                        && !has_err_anc
                        && parent.is_some_and(|p| p.kind() == "expression_statement" && p.child_count() == 1)
                        && is_line_leading_ws(src, n.start_byte())
                        && val_node.is_some_and(|v| v.kind() != "named_expression");
                    if is_standalone {
                        hits.push(WalrusHit { line: op_pos.0, col: op_pos.1, byte_offset: op_pos.2, kind: WalrusKind::StandaloneHybrid });
                    } else {
                        let mut illegal = malformed || has_err_anc;
                        if !illegal {
                            let mut cur = n;
                            while let Some(p) = cur.parent() {
                                if matches!(p.kind(), "parenthesized_expression" | "tuple" | "list" | "expression_list"
                                    | "tuple_pattern" | "list_pattern" | "pattern_list" | "list_splat_pattern") {
                                    cur = p;
                                } else { break; }
                            }
                            if let Some(top_p) = cur.parent() {
                                let top_fld = child_field!(top_p, cur);
                                if top_p.kind() == "delete_statement"
                                    || (matches!(top_p.kind(), "assignment" | "augmented_assignment" | "for_statement" | "for_in_clause") && top_fld == Some("left"))
                                    || (top_p.kind() == "binary_operator" && (0..top_p.child_count()).any(|i| top_p.child(i).is_some_and(|c| c.is_error())))
                                {
                                    illegal = true;
                                }
                            }
                        }
                        if !illegal {
                            let ne_name = name_node.and_then(|nm| src.get(nm.byte_range())).unwrap_or("");
                            let (mut crossed_scope, mut in_comp, mut cur_child) = (false, false, n);
                            while let Some(a) = cur_child.parent() {
                                let ak = a.kind();
                                if matches!(ak, "type_alias_statement" | "type_parameter" | "as_pattern_target" | "case_pattern" | "for_in_clause") {
                                    illegal = true;
                                    break;
                                }
                                if matches!(ak, "lambda" | "function_definition") && child_field!(a, cur_child) == Some("body") {
                                    crossed_scope = true;
                                } else if matches!(ak, "list_comprehension" | "set_comprehension" | "dictionary_comprehension" | "generator_expression") {
                                    in_comp = true;
                                    if !crossed_scope {
                                        for i in 0..a.child_count() {
                                            if let Some(fc) = a.child(i) && fc.kind() == "for_in_clause" && let Some(left) = fc.child_by_field_name("left") {
                                                let mut tst = vec![left];
                                                while let Some(tn) = tst.pop() {
                                                    let tk = tn.kind();
                                                    if tk == "identifier" {
                                                        if src.get(tn.byte_range()) == Some(ne_name) { illegal = true; break; }
                                                    } else if matches!(tk, "tuple_pattern" | "list_pattern" | "pattern_list" | "list_splat_pattern" | "dictionary_splat_pattern" | "parenthesized_expression") {
                                                        for j in 0..tn.child_count() { if let Some(tc) = tn.child(j) { tst.push(tc); } }
                                                    }
                                                }
                                                if illegal { break; }
                                            }
                                        }
                                        if illegal { break; }
                                    }
                                } else if ak == "class_definition" && in_comp && !crossed_scope && child_field!(a, cur_child) == Some("body") {
                                    illegal = true;
                                    break;
                                }
                                cur_child = a;
                            }
                        }
                        if !illegal {
                            let allowed = parent.is_some_and(|p| {
                                let fld = child_field!(p, n);
                                match p.kind() {
                                    "parenthesized_expression" | "decorator" | "list" | "set" | "tuple" => true,
                                    "if_statement" | "elif_clause" | "while_statement" => fld == Some("condition"),
                                    "if_clause" => p.parent().is_some_and(|gp| gp.kind() == "case_clause"),
                                    "match_statement" => fld == Some("subject"),
                                    "list_comprehension" | "set_comprehension" | "generator_expression" => fld == Some("body"),
                                    "subscript" => fld == Some("subscript"),
                                    "interpolation" | "format_expression" => fld == Some("expression"),
                                    "argument_list" => !(0..p.child_count()).any(|i| p.child(i).is_some_and(|s| s.start_byte() < n.start_byte() && matches!(s.kind(), "keyword_argument" | "dictionary_splat"))),
                                    _ => false,
                                }
                            });
                            if !allowed { illegal = true; }
                        }
                        if illegal {
                            hits.push(WalrusHit { line: op_pos.0, col: op_pos.1, byte_offset: op_pos.2, kind: WalrusKind::Illegal });
                        }
                    }
                }
            }
        }
        for i in (0..n.child_count()).rev() {
            if let Some(c) = n.child(i) { stack.push(c); }
        }
    }
    hits.sort_unstable_by_key(|h| (h.byte_offset, h.kind == WalrusKind::Illegal));
    hits.dedup_by_key(|h| (h.byte_offset, h.kind));
    hits
}
