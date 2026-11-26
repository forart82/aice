use std::collections::HashMap;

use crate::r5::checks::ErrorSpan;
use crate::r6::sql_lex::{SqlTok, SqlTokKind, sp};
use crate::r6::sql_pratt::validate_pratt_expr;

pub(super) enum MyFrame {
    Begin(usize, usize, Option<String>, bool),
    If(usize, usize, bool, bool),
    Loop(usize, usize, Option<String>, bool),
    While(usize, usize, Option<String>, bool),
    Repeat(usize, usize, bool, Option<String>, bool),
    Case(usize, usize, bool, bool, bool),
}

pub(super) fn mark_has_stmt(stack: &mut [MyFrame]) {
    match stack.last_mut() {
        Some(MyFrame::Begin(_, _, _, has))
        | Some(MyFrame::If(_, _, _, has))
        | Some(MyFrame::Loop(_, _, _, has))
        | Some(MyFrame::While(_, _, _, has))
        | Some(MyFrame::Repeat(_, _, _, _, has))
        | Some(MyFrame::Case(_, _, _, _, has)) => *has = true,
        None => {}
    }
}

impl MyFrame {
    pub(super) fn label(&self) -> Option<&str> {
        match self {
            Self::Begin(_, _, l, _)
            | Self::Loop(_, _, l, _)
            | Self::While(_, _, l, _)
            | Self::Repeat(_, _, _, l, _) => l.as_deref(),
            _ => None,
        }
    }

    pub(super) fn is_loop(&self) -> bool {
        matches!(self, Self::Loop(..) | Self::While(..) | Self::Repeat(..))
    }
}

pub(super) fn is_ident_tok(t: &SqlTok) -> bool {
    matches!(t.kind, SqlTokKind::Word | SqlTokKind::BacktickIdent | SqlTokKind::QuotedIdent)
}

pub(super) fn is_block_kw(t: &SqlTok, src: &str) -> bool {
    t.kind == SqlTokKind::Word
        && [
            "BEGIN", "END", "IF", "THEN", "ELSE", "ELSEIF", "LOOP", "WHILE", "REPEAT", "UNTIL",
            "CASE", "WHEN",
        ]
        .iter()
        .any(|k| t.is_kw(src, k))
}

pub(super) fn is_labeled_compound(toks: &[SqlTok], i: usize, src: &str) -> bool {
    is_ident_tok(&toks[i])
        && !is_block_kw(&toks[i], src)
        && toks.get(i + 1).is_some_and(|c| c.is_op(src, ":"))
        && toks.get(i + 2).is_some_and(|k| {
            k.is_kw(src, "BEGIN")
                || k.is_kw(src, "LOOP")
                || k.is_kw(src, "WHILE")
                || k.is_kw(src, "REPEAT")
        })
}

pub(super) fn validate_mysql_cond(
    cond: &[SqlTok],
    src: &str,
    kw: &SqlTok,
    empty_msg: &str,
    trail_msg: &str,
    errs: &mut Vec<ErrorSpan>,
) {
    if cond.is_empty() {
        errs.push(sp(kw.line, kw.col, empty_msg));
        return;
    }
    let mut idx = 0;
    if let Err(e) = validate_pratt_expr(cond, src, &mut idx, 0, &[]) {
        errs.push(e);
    } else if idx < cond.len() {
        let u = &cond[idx];
        errs.push(sp(u.line, u.col, trail_msg));
    }
}

pub(super) fn validate_mysql_jump(
    stmt: &[SqlTok],
    src: &str,
    labels: &HashMap<String, (usize, usize)>,
    errs: &mut Vec<ErrorSpan>,
) {
    if stmt.len() < 2 {
        errs.push(sp(stmt[0].line, stmt[0].col, "Incomplete MySQL control statement"));
        return;
    }
    if stmt.len() != 2 || !is_ident_tok(&stmt[1]) || is_block_kw(&stmt[1], src) {
        let a = stmt.get(2).unwrap_or(&stmt[1]);
        errs.push(sp(a.line, a.col, "Invalid label in MySQL LEAVE/ITERATE statement"));
        return;
    }
    let lbl = stmt[1].ident_name(src);
    let key = lbl.to_ascii_lowercase();
    if stmt[0].is_kw(src, "LEAVE") {
        if !labels.contains_key(&key) {
            errs.push(sp(stmt[1].line, stmt[1].col, format!("Unknown label '{lbl}' in MySQL LEAVE")));
        }
    } else if !labels.get(&key).is_some_and(|&(_, loops)| loops > 0) {
        errs.push(sp(
            stmt[1].line,
            stmt[1].col,
            format!("Unknown or non-loop label '{lbl}' in MySQL ITERATE"),
        ));
    }
}

pub(super) fn handle_mysql_end(
    toks: &[SqlTok],
    src: &str,
    i: usize,
    stack: &mut Vec<MyFrame>,
    labels: &mut HashMap<String, (usize, usize)>,
    errs: &mut Vec<ErrorSpan>,
) -> usize {
    let (t, n) = (&toks[i], toks.get(i + 1));
    let popped = stack.pop();
    if let Some(ref f) = popped
        && let Some(lbl) = f.label()
    {
        let key = lbl.to_ascii_lowercase();
        if let Some(counts) = labels.get_mut(&key) {
            counts.0 = counts.0.saturating_sub(1);
            if f.is_loop() {
                counts.1 = counts.1.saturating_sub(1);
            }
            if counts.0 == 0 {
                labels.remove(&key);
            }
        }
    }
    let mut cur = i + 1;
    let (ok, expects_lbl, popped_lbl) = if n.is_some_and(|x| x.is_kw(src, "IF")) {
        cur += 1;
        match popped {
            Some(MyFrame::If(_, _, _, has)) => {
                if !has { errs.push(sp(t.line, t.col, "Empty branch in MySQL IF statement")); }
                (true, false, None)
            }
            _ => (false, false, None),
        }
    } else if n.is_some_and(|x| x.is_kw(src, "CASE")) {
        cur += 1;
        match popped {
            Some(MyFrame::Case(_, _, seen_when, _, has)) => {
                if !seen_when { errs.push(sp(t.line, t.col, "Missing WHEN before END CASE")); }
                else if !has { errs.push(sp(t.line, t.col, "Empty branch in MySQL CASE statement")); }
                (true, false, None)
            }
            _ => (false, false, None),
        }
    } else if n.is_some_and(|x| x.is_kw(src, "WHILE")) {
        cur += 1;
        match popped {
            Some(MyFrame::While(_, _, l, has)) => {
                if !has { errs.push(sp(t.line, t.col, "Empty MySQL WHILE body")); }
                (true, true, l)
            }
            _ => (false, true, None),
        }
    } else if n.is_some_and(|x| x.is_kw(src, "LOOP")) {
        cur += 1;
        match popped {
            Some(MyFrame::Loop(_, _, l, has)) => {
                if !has { errs.push(sp(t.line, t.col, "Empty MySQL LOOP body")); }
                (true, true, l)
            }
            _ => (false, true, None),
        }
    } else if n.is_some_and(|x| x.is_kw(src, "REPEAT")) {
        cur += 1;
        match popped {
            Some(MyFrame::Repeat(_, _, seen, l, has)) => {
                if !seen { errs.push(sp(t.line, t.col, "Missing UNTIL before END REPEAT")); }
                else if !has { errs.push(sp(t.line, t.col, "Empty MySQL REPEAT body")); }
                (true, true, l)
            }
            _ => (false, true, None),
        }
    } else if let Some(MyFrame::Begin(_, _, l, has)) = popped {
        if !has { errs.push(sp(t.line, t.col, "Empty MySQL BEGIN block")); }
        (true, true, l)
    } else {
        (false, true, None)
    };
    if !ok {
        errs.push(sp(t.line, t.col, "Unmatched END in MySQL block"));
    }
    if expects_lbl
        && let Some(et) = toks.get(cur)
        && is_ident_tok(et)
        && !is_block_kw(et, src)
        && toks.get(cur + 1).is_none_or(|x| x.kind == SqlTokKind::Semi)
    {
        let end_lbl = et.ident_name(src);
        if ok {
            match popped_lbl {
                Some(ref open_lbl) if !open_lbl.eq_ignore_ascii_case(&end_lbl) => {
                    errs.push(sp(
                        et.line,
                        et.col,
                        format!("Mismatched END label '{end_lbl}', expected '{open_lbl}'"),
                    ));
                }
                None => errs.push(sp(
                    et.line,
                    et.col,
                    format!("End label '{end_lbl}' without matching start label"),
                )),
                _ => {}
            }
        }
        cur += 1;
    }
    if toks.get(cur).is_some_and(|x| x.kind == SqlTokKind::Semi) {
        return cur + 1;
    }
    if cur < toks.len() {
        errs.push(sp(toks[cur].line, toks[cur].col, "Expected ';' after END"));
    }
    cur
}

pub(super) fn scan_cond_to_kw(
    toks: &[SqlTok], src: &str, mut i: usize, kw: &SqlTok, target: &str, msg: &str, errs: &mut Vec<ErrorSpan>,
) -> usize {
    let start = i;
    let (mut d, mut c) = (0usize, 0usize);
    while i < toks.len() {
        let not_dot = i == 0 || toks[i - 1].kind != SqlTokKind::Dot;
        if toks[i].kind == SqlTokKind::LParen { d += 1; }
        else if toks[i].kind == SqlTokKind::RParen { d = d.saturating_sub(1); }
        else if not_dot && toks[i].is_kw(src, "CASE") { c += 1; }
        else if not_dot && toks[i].is_kw(src, "END") && c > 0 { c -= 1; }
        else if d == 0 && c == 0 && (toks[i].kind == SqlTokKind::Semi
            || (not_dot && (toks[i].is_kw(src, target) || toks[i].is_kw(src, "END")
                || (target == "THEN" && (toks[i].is_kw(src, "ELSE") || toks[i].is_kw(src, "ELSEIF")
                    || (kw.is_kw(src, "WHEN") && toks[i].is_kw(src, "WHEN")))))))
        {
            break;
        }
        i += 1;
    }
    if !toks.get(i).is_some_and(|n| n.is_kw(src, target)) {
        errs.push(sp(kw.line, kw.col, msg));
        return i;
    }
    validate_mysql_cond(
        &toks[start..i],
        src,
        kw,
        &format!("Empty condition in MySQL {}", kw.slice(src)),
        &format!("Unexpected trailing token in MySQL {} condition", kw.slice(src)),
        errs,
    );
    i + 1
}
