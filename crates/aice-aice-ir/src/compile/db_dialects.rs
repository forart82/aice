use aice_lang_registry::LanguageId;

use crate::compile::db_sql::compile_sql_or_migration;
use crate::compile::emit_ctx::{CommentStyle, EmitCtx};
use crate::ir::{AiceItem, AiceModule, TranspileError};
use crate::ir_domain_db::DbSchemaDecl;

pub fn compile(module: &AiceModule, target: LanguageId) -> Result<String, TranspileError> {
    if module.items.is_empty() && !module.raw_fallback.is_empty() {
        return Ok(module.raw_fallback.clone());
    }
    match target {
        LanguageId::Prisma => emit_prisma(module),
        LanguageId::GraphQl => emit_graphql(module),
        LanguageId::Cypher => emit_cypher(module),
        _ => compile_sql_or_migration(module, target),
    }
}

fn emit_prisma(module: &AiceModule) -> Result<String, TranspileError> {
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    for it in &module.items {
        if let AiceItem::DbSchema(DbSchemaDecl::PrismaBlock { kind, name, fields, attrs, trivia }) = it {
            ec.blank();
            ec.emit_trivia(trivia, CommentStyle::Slash);
            ec.line(&format!("{kind} {name} {{"));
            ec.push();
            for f in fields {
                if kind == "datasource" || kind == "generator" {
                    ec.line(&format!("{} = {}", f.name, f.field_type));
                } else if kind == "enum" {
                    ec.line(&f.name);
                } else {
                    let a = if f.attrs.is_empty() { String::new() } else { format!(" {}", f.attrs.join(" ")) };
                    ec.line(&format!("{} {}{a}", f.name, f.field_type));
                }
            }
            for a in attrs { ec.line(a); }
            ec.pop();
            ec.line("}");
        }
    }
    Ok(ec.out)
}

fn emit_graphql(module: &AiceModule) -> Result<String, TranspileError> {
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Hash);
    for it in &module.items {
        match it {
            AiceItem::DbSchema(DbSchemaDecl::GraphQlType { kind, name, implements, fields, trivia, .. }) => {
                ec.blank();
                ec.emit_trivia(trivia, CommentStyle::Hash);
                let imp = if implements.is_empty() { String::new() } else { format!(" implements {}", implements.join(" & ")) };
                let kw = match kind.as_str() {
                    "object" => "type",
                    "input_object" => "input",
                    other => other,
                };
                if kw == "scalar" && fields.is_empty() {
                    ec.line(&format!("scalar {name}"));
                    continue;
                }
                ec.line(&format!("{kw} {name}{imp} {{"));
                ec.push();
                for f in fields {
                    if kw == "enum" || f.field_type.is_empty() {
                        ec.line(&f.name);
                    } else {
                        let args = if f.args.is_empty() { String::new() } else { format!("({})", f.args.join(", ")) };
                        ec.line(&format!("{}{args}: {}", f.name, f.field_type));
                    }
                }
                ec.pop();
                ec.line("}");
            }
            AiceItem::DbQuery(dq) => {
                ec.blank();
                ec.emit_trivia(&dq.trivia, CommentStyle::Hash);
                for (_, body) in &dq.clauses { ec.line(body); }
            }
            _ => {}
        }
    }
    Ok(ec.out)
}

fn emit_cypher(module: &AiceModule) -> Result<String, TranspileError> {
    let mut ec = EmitCtx::new("  ");
    ec.emit_trivia(&module.module_trivia, CommentStyle::Slash);
    for it in &module.items {
        if let AiceItem::DbQuery(dq) = it {
            ec.emit_trivia(&dq.trivia, CommentStyle::Slash);
            let lines: Vec<&str> = dq.clauses.iter().map(|(_, v)| v.as_str()).collect();
            for (i, l) in lines.iter().enumerate() {
                if i + 1 == lines.len() {
                    let t = l.trim();
                    if t.ends_with(';') { ec.line(t); } else { ec.line(&format!("{t};")); }
                } else {
                    ec.line(l.trim());
                }
            }
        }
    }
    Ok(ec.out)
}
