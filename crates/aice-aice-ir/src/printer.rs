use crate::ir::{AiceItem, AiceModule, ImportDecl, TranspileOpts, Trivia, TriviaKind};
use crate::ir_code::AssignOp;
use crate::ir_types::ParamDecl;
use crate::printer_decl::{print_class_decl, print_enum_decl, print_fn_decl, print_type_decl};
use crate::printer_domain::{print_data, print_doc, print_sh, print_tokens};
use crate::printer_domain_db::{print_db_migration, print_db_query, print_db_schema};
use crate::printer_domain_ui::{print_component, print_style};
use crate::printer_expr::{escape_str, print_expr, print_type};

pub fn print_aice(module: &AiceModule) -> String {
    print_aice_with_opts(module, &TranspileOpts::default())
}

pub fn print_aice_with_opts(module: &AiceModule, opts: &TranspileOpts) -> String {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return module.raw_fallback.clone();
    }
    let mut ctx = PrintCtx::new(opts);
    ctx.emit_trivia(&module.module_trivia, 0);
    ctx.line(0, &format!("module {}", module.module_name));
    for (idx, item) in module.items.iter().enumerate() {
        if !opts.compact && idx > 0 {
            ctx.out.push('\n');
        }
        print_item(&mut ctx, item, 0);
    }
    ctx.emit_trivia(&module.trailing_trivia, 0);
    if ctx.opts.preserve_docs
        && let Some(ref t) = module.trailing_trivia.trailing
    {
        let clean: Vec<&str> = t.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
        if !clean.is_empty() {
            ctx.line(0, &format!("# {}", clean.join(" ")));
        }
    }
    ctx.out
}

pub(crate) struct PrintCtx<'a> {
    pub opts: &'a TranspileOpts,
    pub out: String,
}

impl<'a> PrintCtx<'a> {
    fn new(opts: &'a TranspileOpts) -> Self {
        Self { opts, out: String::new() }
    }

    pub fn indent(&mut self, depth: usize) {
        for _ in 0..depth {
            self.out.push_str("  ");
        }
    }

    pub fn line(&mut self, depth: usize, s: &str) {
        self.indent(depth);
        self.out.push_str(s);
        self.out.push('\n');
    }

    pub fn line_tr(&mut self, depth: usize, s: &str, tr: &Trivia) {
        self.indent(depth);
        self.out.push_str(s);
        if self.opts.preserve_docs
            && let Some(ref t) = tr.trailing
        {
            let clean: Vec<&str> = t.lines().map(str::trim).filter(|l| !l.is_empty()).collect();
            if !clean.is_empty() {
                self.out.push_str(" # ");
                self.out.push_str(&clean.join(" "));
            }
        }
        self.out.push('\n');
    }

    pub fn emit_comment_lines(&mut self, depth: usize, text: &str) {
        let norm = text.replace("\r\n", "\n").replace('\r', "\n");
        for line in norm.split('\n') {
            let trimmed = line.trim();
            self.indent(depth);
            if trimmed.is_empty() {
                self.out.push_str("#\n");
            } else {
                self.out.push_str("# ");
                self.out.push_str(trimmed);
                self.out.push('\n');
            }
        }
    }

    pub fn emit_trivia(&mut self, tr: &Trivia, depth: usize) {
        if self.opts.preserve_docs && !self.opts.compact && tr.blank_lines_before > 0 {
            self.out.push('\n');
        }
        for c in &tr.leading {
            if c.kind == TriviaKind::Attribute {
                if c.text.starts_with("#[") || c.text.starts_with('@') {
                    self.line(depth, &c.text);
                } else {
                    self.line(depth, &format!("@{}", c.text));
                }
            } else if self.opts.preserve_docs {
                self.emit_comment_lines(depth, &c.text);
            }
        }
    }

    pub fn colon_sep(&self) -> &'static str {
        if self.opts.compact { ":" } else { ": " }
    }
}

pub(crate) fn print_item(c: &mut PrintCtx<'_>, item: &AiceItem, d: usize) {
    match item {
        AiceItem::Import(imp) => print_import(c, imp, d),
        AiceItem::Type(td) => print_type_decl(c, td, d),
        AiceItem::Enum(ed) => print_enum_decl(c, ed, d),
        AiceItem::Class(cd) => print_class_decl(c, cd, d),
        AiceItem::Fn(fd) => print_fn_decl(c, fd, d),
        AiceItem::Const(cd) => {
            c.emit_trivia(&cd.trivia, d);
            let ty = if c.opts.include_types {
                cd.ty.as_ref().map(|t| format!("{}{}", c.colon_sep(), print_type(t))).unwrap_or_default()
            } else { String::new() };
            c.line_tr(d, &format!("{}const {}{} = {}", cd.vis.aice_prefix(), cd.name, ty, print_expr(&cd.value)), &cd.trivia);
        }
        AiceItem::Var(vd) => {
            c.emit_trivia(&vd.trivia, d);
            let ty = if c.opts.include_types {
                vd.ty.as_ref().map(|t| format!("{}{}", c.colon_sep(), print_type(t))).unwrap_or_default()
            } else { String::new() };
            let op = if vd.is_mut { "::=" } else { ":=" };
            c.line_tr(d, &format!("{}{}{} {} {}", vd.vis.aice_prefix(), vd.name, ty, op, print_expr(&vd.value)), &vd.trivia);
        }
        AiceItem::Component(comp) => print_component(c, comp, d),
        AiceItem::Style(st) => print_style(c, st, d),
        AiceItem::TokenSheet(ts) => print_tokens(c, ts, d),
        AiceItem::Data(dd) => print_data(c, dd, d),
        AiceItem::DbSchema(ds) => print_db_schema(c, ds, d),
        AiceItem::DbQuery(dq) => print_db_query(c, dq, d),
        AiceItem::DbMigration(dm) => print_db_migration(c, dm, d),
        AiceItem::Doc(doc) => print_doc(c, doc, d),
        AiceItem::Shell(sh) => print_sh(c, sh, d),
        AiceItem::Directive { text, trivia, .. } => {
            c.emit_trivia(trivia, d);
            c.line_tr(d, &format!("directive {text}"), trivia);
        }
    }
}

fn print_import(c: &mut PrintCtx<'_>, imp: &ImportDecl, d: usize) {
    c.emit_trivia(&imp.trivia, d);
    let src = format!("\"{}\"", escape_str(&imp.source));
    if imp.specifiers.is_empty() {
        c.line_tr(d, &format!("{}import {}", imp.vis.aice_prefix(), src), &imp.trivia);
        return;
    }
    if imp.specifiers.len() == 1 && imp.specifiers[0].is_wildcard && imp.specifiers[0].alias.is_some() {
        let a = imp.specifiers[0].alias.as_deref().unwrap_or("");
        c.line_tr(d, &format!("{}from {} import * as {}", imp.vis.aice_prefix(), src, a), &imp.trivia);
        return;
    }
    let parts: Vec<String> = imp.specifiers.iter().map(|s| {
        let mut out = if s.is_type { "type ".to_string() } else { String::new() };
        out.push_str(&s.name);
        if let Some(ref a) = s.alias { out.push_str(" as "); out.push_str(a); }
        out
    }).collect();
    c.line_tr(d, &format!("{}from {} import {}", imp.vis.aice_prefix(), src, parts.join(", ")), &imp.trivia);
}

pub(crate) fn format_params(c: &PrintCtx<'_>, params: &[ParamDecl]) -> String {
    params.iter().map(|p| {
        let mut s = String::new();
        s.push_str(p.vis.aice_prefix());
        if p.is_readonly { s.push_str("readonly "); }
        if p.is_mut { s.push_str("mut "); }
        if p.is_rest { s.push_str("..."); }
        s.push_str(&p.name);
        if p.is_optional { s.push('?'); }
        if c.opts.include_types && let Some(ref ty) = p.ty {
            s.push_str(c.colon_sep());
            s.push_str(&print_type(ty));
        }
        if let Some(ref def) = p.default { s.push_str(&format!(" = {}", print_expr(def))); }
        s
    }).collect::<Vec<_>>().join(", ")
}

pub(crate) fn assign_op_str(op: AssignOp) -> &'static str {
    match op {
        AssignOp::Assign => "=", AssignOp::AddAssign => "+=", AssignOp::SubAssign => "-=",
        AssignOp::MulAssign => "*=", AssignOp::DivAssign => "/=", AssignOp::ModAssign => "%=",
        AssignOp::PowAssign => "**=", AssignOp::BitAndAssign => "&=", AssignOp::BitOrAssign => "|=",
        AssignOp::BitXorAssign => "^=", AssignOp::ShlAssign => "<<=", AssignOp::ShrAssign => ">>=",
        AssignOp::UshrAssign => ">>>=",
    }
}
