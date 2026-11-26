use aice_lang_registry::LanguageId;

use crate::ir_code::{FnBody, MatchCase, Pattern};

pub(crate) fn format_assembled_match(
    subj: &str,
    cases: &[MatchCase],
    subjectless: bool,
    if_low: bool,
    lang: LanguageId,
    arms: Vec<(Vec<String>, Option<String>)>,
) -> String {
    match lang {
        LanguageId::Rust if !if_low => {
            let s: Vec<String> = cases.iter().zip(arms).map(|(mc, (hv, bv))| {
                let g = if hv.len() > 1 { format!(" if {}", hv[1]) } else { String::new() };
                let rhs = match (&mc.body, bv) {
                    (FnBody::Expr(_), Some(v)) => v,
                    (FnBody::Block(_), Some(v)) => format!("{{ {} }}", v.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" ")),
                    _ => "()".into(),
                };
                format!("{}{g} => {rhs}", hv[0])
            }).collect();
            format!("match {subj} {{ {} }}", s.join(", "))
        }
        LanguageId::Kotlin if !if_low => {
            let s: Vec<String> = cases.iter().zip(arms).map(|(mc, (hv, bv))| {
                let pat = hv.into_iter().next().unwrap_or_else(|| "else".into());
                let rhs = match (&mc.body, bv) {
                    (FnBody::Expr(_), Some(v)) => v,
                    (FnBody::Block(_), Some(v)) => {
                        let b = v.trim_end();
                        if b.contains('\n') { format!("{{\n{b}\n}}") } else { format!("{{ {} }}", b.trim()) }
                    }
                    _ => "Unit".into(),
                };
                format!("{pat} -> {rhs}")
            }).collect();
            if subjectless { format!("when {{ {} }}", s.join("; ")) } else { format!("when ({subj}) {{ {} }}", s.join("; ")) }
        }
        LanguageId::Rust | LanguageId::Kotlin => {
            let bare = lang == LanguageId::Rust;
            let (mut out, mut started) = (String::new(), false);
            for (mc, (hv, bv)) in cases.iter().zip(arms) {
                let body_s = match (&mc.body, bv) {
                    (FnBody::Expr(_), Some(v)) => v,
                    (FnBody::Block(_), Some(v)) => v.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join("; "),
                    _ => if bare { "()".into() } else { "Unit".into() },
                };
                if let Some(cond) = hv.into_iter().next() {
                    let hdr = match (started, bare) {
                        (false, true) => { started = true; format!("if {cond}") }
                        (false, false) => { started = true; format!("if ({cond})") }
                        (true, true) => format!(" else if {cond}"),
                        (true, false) => format!(" else if ({cond})"),
                    };
                    out.push_str(&format!("{hdr} {{ {body_s} }}"));
                } else if !started {
                    started = true;
                    out.push_str(&format!("{} {{ {body_s} }}", if bare { "if true" } else { "if (true)" }));
                } else { out.push_str(&format!(" else {{ {body_s} }}")); }
            }
            out
        }
        LanguageId::Python => {
            let mut expr = "None".to_string();
            for (idx, (mc, (hv, bv))) in cases.iter().zip(arms).enumerate().rev() {
                let val = bv.unwrap_or_else(|| "None".into());
                if idx + 1 == cases.len() && matches!(mc.pattern, Pattern::Wildcard) && mc.guard.is_none() {
                    expr = val; continue;
                }
                let cond = hv.into_iter().next().unwrap_or_else(|| "True".into());
                expr = format!("{val} if {cond} else {expr}");
            }
            expr
        }
        LanguageId::TypeScript | LanguageId::Tsx | LanguageId::JavaScript => {
            let bstr = |mc: &MatchCase, bv: Option<String>| match (&mc.body, bv) {
                (FnBody::Expr(_), Some(v)) => format!("return {v};"),
                (FnBody::Block(_), Some(v)) => v.lines().map(str::trim).filter(|l| !l.is_empty()).collect::<Vec<_>>().join(" "),
                _ => "return null;".into(),
            };
            if subjectless || if_low {
                let mut s = String::from("(() => { ");
                for (idx, (mc, (hv, bv))) in cases.iter().zip(arms).enumerate() {
                    let body = bstr(mc, bv);
                    if let Some(c) = hv.into_iter().next() {
                        s.push_str(&format!("{} ({c}) {{ {body} }} ", if idx == 0 { "if" } else { "else if" }));
                    } else if idx == 0 { s.push_str(&format!("if (true) {{ {body} }} ")); }
                    else { s.push_str(&format!("else {{ {body} }} ")); }
                }
                s.push_str("})()"); s
            } else {
                let list: Vec<String> = cases.iter().zip(arms).map(|(mc, (hv, bv))| {
                    let lbl = match &mc.pattern {
                        Pattern::Wildcard => "default:".into(),
                        Pattern::Or(_) => hv.into_iter().map(|p| format!("case {p}:")).collect::<Vec<_>>().join(" "),
                        _ => format!("case {}:", hv.into_iter().next().unwrap_or_default()),
                    };
                    format!("{lbl} {}", bstr(mc, bv))
                }).collect();
                format!("(() => {{ switch ({subj}) {{ {} }} }})()", list.join(" "))
            }
        }
        LanguageId::Go => {
            let mut lines = vec!["func() any {".to_string(), if subjectless || if_low { "switch {".into() } else { format!("switch {subj} {{") }];
            for (mc, (hv, bv)) in cases.iter().zip(arms) {
                let hdr = if subjectless || if_low { hv.into_iter().next().map(|c| format!("case {c}:")).unwrap_or_else(|| "default:".into()) }
                else if matches!(mc.pattern, Pattern::Wildcard) { "default:".into() }
                else { format!("case {}:", hv.into_iter().next().unwrap_or_default()) };
                lines.push(hdr);
                lines.push(match (&mc.body, bv) {
                    (FnBody::Expr(_), Some(v)) => format!("return {v}"),
                    (FnBody::Block(_), Some(v)) => v.trim_end().to_string(),
                    _ => "return nil".into(),
                });
            }
            lines.push("}".into()); lines.push("}()".into()); lines.join("\n")
        }
        LanguageId::Ruby => {
            let use_if = subjectless || if_low;
            let mut lines = if use_if { Vec::new() } else { vec![format!("case {subj}")] };
            for (idx, (mc, (hv, bv))) in cases.iter().zip(arms).enumerate() {
                if use_if {
                    match (hv.into_iter().next(), idx) {
                        (Some(c), 0) => lines.push(format!("if {c}")),
                        (Some(c), _) => lines.push(format!("elsif {c}")),
                        (None, 0) => lines.push("if true".into()),
                        (None, _) => lines.push("else".into()),
                    }
                } else if matches!(mc.pattern, Pattern::Wildcard) { lines.push("else".into()); }
                else { lines.push(format!("when {}", hv.into_iter().next().unwrap_or_default())); }
                lines.push(match (&mc.body, bv) {
                    (FnBody::Expr(_), Some(v)) => format!("  {v}"),
                    (FnBody::Block(_), Some(v)) => v.trim_end().to_string(),
                    _ => "  nil".into(),
                });
            }
            lines.push("end".into());
            let j = lines.join("\n");
            if use_if { format!("({j})") } else { j }
        }
        _ => {
            let fb = if matches!(lang, LanguageId::C | LanguageId::Cpp) { "0" } else { "null" };
            let mut expr = fb.to_string();
            for (idx, (mc, (hv, bv))) in cases.iter().zip(arms).enumerate().rev() {
                let val = bv.unwrap_or_else(|| fb.into());
                if idx + 1 == cases.len() && matches!(mc.pattern, Pattern::Wildcard) && mc.guard.is_none() {
                    expr = val; continue;
                }
                let cond = hv.into_iter().next().unwrap_or_else(|| "true".into());
                expr = format!("({cond} ? {val} : {expr})");
            }
            expr
        }
    }
}
