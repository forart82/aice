use crate::ir_code::{FnBody, Stmt};

pub(crate) fn insert_updates_before_continue(stmts: &mut Vec<Stmt>, upds: &[Stmt]) {
    if upds.is_empty() {
        return;
    }
    let mut work: Vec<&mut Vec<Stmt>> = vec![stmts];
    while let Some(list) = work.pop() {
        let mut i = 0usize;
        while i < list.len() {
            if matches!(list[i], Stmt::Continue { label: None, .. }) {
                list.splice(i..i, upds.iter().cloned());
                i += upds.len() + 1;
            } else {
                i += 1;
            }
        }
        for s in list.iter_mut() {
            match s {
                Stmt::If { then_body, elifs, else_body, .. } => {
                    if let Some(eb) = else_body { work.push(eb); }
                    for (_, b) in elifs.iter_mut().rev() { work.push(b); }
                    work.push(then_body);
                }
                Stmt::Match { cases, .. } => {
                    for mc in cases.iter_mut().rev() {
                        if let FnBody::Block(b) = &mut mc.body { work.push(b); }
                    }
                }
                Stmt::Try { try_body, catches, finally_body, .. } => {
                    if let Some(fb) = finally_body { work.push(fb); }
                    for cc in catches.iter_mut().rev() { work.push(&mut cc.body); }
                    work.push(try_body);
                }
                _ => {}
            }
        }
    }
}
