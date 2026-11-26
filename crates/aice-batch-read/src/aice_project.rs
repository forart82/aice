use aice_aice_ir::AiceTranspiler;
use aice_aice_ir::ir::{AiceItem, AiceModule, TranspileOpts};
use aice_aice_ir::ir_code::ClassDecl;
use aice_aice_ir::ir_domain_db::{DbQueryDecl, DbSchemaDecl};
use aice_ast_engine::EngineRegistry;
use aice_lang_registry::{SymbolKind, SymbolNode};

use crate::aice_project_domain::{project_db_migration, project_doc_section, project_shell_item};
use crate::aice_project_slice::{
    MidSliceResult, project_fn_head, slice_fn_mid, slice_method_mid, trim_method_tail,
};
use crate::aice_project_util::{
    contains_ident, find_sym_span, find_text_span, item_line_range, slice_lines_range, span_lines,
};

pub struct ProjectWindowArgs<'a> {
    pub module: &'a AiceModule,
    pub full_src: &'a str,
    pub starts: &'a [usize],
    pub syms: &'a [SymbolNode],
    pub registry: &'a EngineRegistry,
    pub transpiler: &'a dyn AiceTranspiler,
    pub opts: &'a TranspileOpts,
    pub start_line: usize,
    pub end_line: usize,
    pub sym_hint: Option<&'a str>,
}

pub fn project_module_window(args: &ProjectWindowArgs<'_>) -> Option<AiceModule> {
    project_module_window_opts(args, true)
}

pub(crate) fn project_module_window_opts(
    args: &ProjectWindowArgs<'_>,
    slice_mid_body: bool,
) -> Option<AiceModule> {
    let win_src = slice_lines_range(args.full_src, args.starts, args.start_line, args.end_line);
    let short_hint = args.sym_hint.map(|s| s.rsplit(['.', ':']).next().unwrap_or(s));
    let mut items = Vec::new();
    let mut unrepresentable_mid = false;

    for item in &args.module.items {
        let Some((is, ie)) = item_line_range(item, args.starts, args.syms, args.full_src) else {
            continue;
        };
        if ie < args.start_line || is > args.end_line {
            continue;
        }
        if is >= args.start_line && ie <= args.end_line {
            items.push(item.clone());
            continue;
        }
        match item {
            AiceItem::Class(cls) => {
                if let Some(c) = project_class(
                    cls,
                    is,
                    win_src,
                    short_hint,
                    args,
                    slice_mid_body,
                    &mut unrepresentable_mid,
                ) {
                    items.push(AiceItem::Class(c));
                }
            }
            AiceItem::Fn(fd) if is >= args.start_line => {
                if let Some(f) = project_fn_head(fd, is, args) {
                    items.push(AiceItem::Fn(f));
                }
            }
            AiceItem::Fn(fd) if slice_mid_body => match slice_fn_mid(fd, ie, args) {
                MidSliceResult::Sliced(f) => items.push(AiceItem::Fn(f)),
                MidSliceResult::Trivial => {}
                MidSliceResult::Unrepresentable => unrepresentable_mid = true,
            },
            AiceItem::DbSchema(ds) => {
                items.push(AiceItem::DbSchema(project_db_schema(ds, win_src)));
            }
            AiceItem::DbQuery(dq) => {
                if let Some(q) = project_db_query(dq, is, win_src, short_hint, args) {
                    items.push(AiceItem::DbQuery(q));
                }
            }
            AiceItem::Type(td) => {
                let mut t = td.clone();
                t.fields.retain(|f| contains_ident(win_src, &f.name, false));
                t.methods.retain(|m| {
                    span_lines(m.span, args.starts)
                        .is_some_and(|(ms, me)| me >= args.start_line && ms <= args.end_line)
                });
                items.push(AiceItem::Type(t));
            }
            AiceItem::Enum(ed) => {
                let mut e = ed.clone();
                e.variants.retain(|v| contains_ident(win_src, &v.name, false));
                items.push(AiceItem::Enum(e));
            }
            AiceItem::Shell(sh) => {
                if let Some(s) = project_shell_item(sh, is, win_src, args) {
                    items.push(AiceItem::Shell(s));
                }
            }
            AiceItem::DbMigration(dm) => {
                if let Some(m) = project_db_migration(dm, args) {
                    items.push(AiceItem::DbMigration(m));
                }
            }
            AiceItem::Doc(doc) => {
                if let Some(d) = project_doc_section(doc, args) {
                    items.push(AiceItem::Doc(d));
                }
            }
            _ => {
                if is >= args.start_line {
                    items.push(item.clone());
                }
            }
        }
    }

    if unrepresentable_mid || items.is_empty() {
        return None;
    }
    let mut sub = AiceModule::new(args.module.source_lang, args.module.module_name.clone());
    sub.items = items;
    Some(sub)
}

fn project_class(
    cls: &ClassDecl,
    cls_start: usize,
    win_src: &str,
    short_hint: Option<&str>,
    args: &ProjectWindowArgs<'_>,
    slice_mid_body: bool,
    unrepresentable_mid: &mut bool,
) -> Option<ClassDecl> {
    let mut trimmed = cls.clone();
    let cls_def_overlaps = span_lines(cls.span, args.starts)
        .is_none_or(|(cs, ce)| ce >= args.start_line && cs <= args.end_line);
    let inside_single_method = cls.methods.iter().any(|m| {
        span_lines(m.span, args.starts)
            .is_some_and(|(ms, me)| ms < args.start_line && me >= args.end_line)
    });
    if (cls_start < args.start_line && short_hint.is_some())
        || !cls_def_overlaps
        || inside_single_method
    {
        trimmed.props.clear();
        trimmed.static_blocks.clear();
    } else {
        trimmed.props.retain(|p| contains_ident(win_src, &p.name, false));
        if cls_start < args.start_line {
            trimmed.static_blocks.clear();
        }
    }

    let mut kept_methods = Vec::new();
    for m in &cls.methods {
        let Some((ms, me)) = span_lines(m.span, args.starts) else {
            continue;
        };
        let hint_hit = short_hint.is_some_and(|h| m.name == h && cls_start <= args.start_line);
        if hint_hit || (ms >= args.start_line && me <= args.end_line) {
            kept_methods.push(m.clone());
        } else if ms >= args.start_line && ms <= args.end_line {
            kept_methods.push(trim_method_tail(m, ms, args));
        } else if slice_mid_body && ms < args.start_line && me >= args.start_line {
            match slice_method_mid(m, me, args) {
                MidSliceResult::Sliced(sm) => kept_methods.push(sm),
                MidSliceResult::Trivial => {}
                MidSliceResult::Unrepresentable => *unrepresentable_mid = true,
            }
        }
    }
    trimmed.methods = kept_methods;

    let header_in_win = cls_start >= args.start_line && cls_start <= args.end_line;
    let impl_in_win = contains_ident(win_src, &cls.name, true) && win_src.contains("impl ");
    if !header_in_win && !impl_in_win && trimmed.props.is_empty() && trimmed.methods.is_empty() {
        return None;
    }
    Some(trimmed)
}

fn project_db_schema(ds: &DbSchemaDecl, win_src: &str) -> DbSchemaDecl {
    match ds {
        DbSchemaDecl::Table { name, if_not_exists, columns, constraints, options, trivia } => {
            DbSchemaDecl::Table {
                name: name.clone(),
                if_not_exists: *if_not_exists,
                columns: columns.iter().filter(|c| contains_ident(win_src, &c.name, false)).cloned().collect(),
                constraints: constraints.iter().filter(|c| win_src.contains(c.as_str())).cloned().collect(),
                options: options.iter().filter(|o| win_src.contains(o.as_str())).cloned().collect(),
                trivia: trivia.clone(),
            }
        }
        DbSchemaDecl::PrismaBlock { kind, name, fields, attrs, trivia } => DbSchemaDecl::PrismaBlock {
            kind: kind.clone(),
            name: name.clone(),
            fields: fields.iter().filter(|f| contains_ident(win_src, &f.name, false)).cloned().collect(),
            attrs: attrs.iter().filter(|a| win_src.contains(a.as_str())).cloned().collect(),
            trivia: trivia.clone(),
        },
        DbSchemaDecl::GraphQlType { kind, name, implements, directives, fields, trivia } => {
            DbSchemaDecl::GraphQlType {
                kind: kind.clone(),
                name: name.clone(),
                implements: implements.clone(),
                directives: directives.clone(),
                fields: fields.iter().filter(|f| contains_ident(win_src, &f.name, false)).cloned().collect(),
                trivia: trivia.clone(),
            }
        }
        other => other.clone(),
    }
}

fn project_db_query(
    dq: &DbQueryDecl,
    is: usize,
    win_src: &str,
    short_hint: Option<&str>,
    args: &ProjectWindowArgs<'_>,
) -> Option<DbQueryDecl> {
    let mut q = dq.clone();
    if !dq.ctes.is_empty() {
        q.ctes.retain(|(cname, body)| {
            short_hint.is_some_and(|h| h == cname)
                || find_sym_span(cname, args.syms)
                    .or_else(|| find_text_span(args.full_src, body))
                    .is_some_and(|(s, e)| e >= args.start_line && s <= args.end_line)
                || contains_ident(win_src, cname, false)
        });
        q.clauses.retain(|(_, v)| {
            find_text_span(args.full_src, v)
                .is_some_and(|(s, e)| e >= args.start_line && s <= args.end_line)
        });
        return (!q.ctes.is_empty() || !q.clauses.is_empty()).then_some(q);
    }
    let cte_hit = short_hint.and_then(|h| {
        args.syms.iter().find(|s| s.kind == SymbolKind::Query && s.name == h)
    });
    if cte_hit.is_some() && !win_src.trim().is_empty() {
        q.clauses = vec![("sql".into(), win_src.trim().to_string())];
        return Some(q);
    }
    (is >= args.start_line || !win_src.trim().is_empty()).then_some(q)
}
