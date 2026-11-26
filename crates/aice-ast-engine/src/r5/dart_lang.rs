use aice_lang_registry::{
    AstSlice, AstSlicer, DepEdge, DepKind, IntraBlockSelector, LanguageAdapter, LanguageId,
    OutlineView, ParseError, ParsedTree, SliceError, SymbolKind, SymbolNode, SymbolSelector,
};

use crate::r5::cst_helpers::{
    child_kind_text, field_text, first_line_sig, node_text, outline_from_symbols, push_sym,
    qualified, slice_symbol_from_list, visit_named_preorder, with_ts_root,
};
use crate::r5::dep_helpers::augment_r5_deps;
use crate::ts_pool::parse_tree_sitter;

pub struct DartAdapter;

impl LanguageAdapter for DartAdapter {
    fn id(&self) -> LanguageId {
        LanguageId::Dart
    }

    fn parse_cst(&self, src: &str) -> Result<ParsedTree, ParseError> {
        parse_tree_sitter(LanguageId::Dart, src)
    }

    fn extract_symbols(&self, tree: &ParsedTree, src: &str) -> Vec<SymbolNode> {
        with_ts_root(tree, Vec::new(), |root| {
            let mut out = Vec::new();
            let mut scope = Vec::new();
            walk_dart(root, src, &mut scope, &mut out);
            out
        })
    }

    fn extract_dependencies(&self, tree: &ParsedTree, src: &str) -> Vec<DepEdge> {
        let syms = self.extract_symbols(tree, src);
        with_ts_root(tree, Vec::new(), |root| {
            let mut deps = Vec::new();
            walk_dart_deps(root, src, &mut deps);
            augment_r5_deps(LanguageId::Dart, root, src, &syms, &mut deps);
            deps
        })
    }
}

impl AstSlicer for DartAdapter {
    fn slice_symbol(
        &self,
        tree: &ParsedTree,
        src: &str,
        sel: &SymbolSelector,
    ) -> Result<AstSlice, SliceError> {
        slice_symbol_from_list(&self.extract_symbols(tree, src), src, sel)
    }

    fn slice_intra_block(
        &self,
        tree: &ParsedTree,
        src: &str,
        sel: &IntraBlockSelector,
    ) -> Result<AstSlice, SliceError> {
        crate::intra_ast::slice_intra_block(tree, &self.extract_symbols(tree, src), src, sel)
    }

    fn outline(
        &self,
        tree: &ParsedTree,
        src: &str,
        depth: usize,
        include_types: bool,
    ) -> OutlineView {
        outline_from_symbols(&self.extract_symbols(tree, src), src, depth, include_types)
    }
}

fn walk_dart(root: tree_sitter::Node<'_>, src: &str, scope: &mut Vec<String>, out: &mut Vec<SymbolNode>) {
    enum Step<'a> { Node(tree_sitter::Node<'a>), Pop }
    let mut stack = vec![Step::Node(root)];
    while let Some(step) = stack.pop() {
        let Step::Node(node) = step else { scope.pop(); continue; };
        let type_kind = match node.kind() {
            "class_declaration" => Some(SymbolKind::Class),
            "mixin_declaration" => Some(SymbolKind::Trait),
            "extension_declaration" => Some(SymbolKind::Module),
            "extension_type_declaration" => Some(SymbolKind::Struct),
            "enum_declaration" => Some(SymbolKind::Enum),
            _ => None,
        };
        if let Some(kind) = type_kind && let Some(name) = dart_type_name(node, src) {
            push_sym(out, name, qualified(scope, name, "."), kind, node, src);
            scope.push(name.to_string());
            if node.kind() == "extension_type_declaration" {
                push_ext_primary_ctor(node, scope, out, src);
            }
            stack.push(Step::Pop);
            for i in (0..node.named_child_count()).rev() {
                if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
            }
            continue;
        }
        match node.kind() {
            "function_signature" | "getter_signature" | "setter_signature" => {
                if let Some(name) = field_text(node, "name", src)
                    .or_else(|| child_kind_text(node, "identifier", src))
                {
                    let kind = if scope.is_empty() { SymbolKind::Function } else { SymbolKind::Method };
                    push_dart_sym(out, name, qualified(scope, name, "."), kind, node, src);
                }
                continue;
            }
            "constructor_signature"
            | "constant_constructor_signature"
            | "factory_constructor_signature"
            | "redirecting_factory_constructor_signature" => {
                if let Some(name) = dart_ctor_name(node, scope, src) {
                    push_dart_sym(out, &name, qualified(scope, &name, "."), SymbolKind::Method, node, src);
                }
                continue;
            }
            "operator_signature" => {
                if let Some(op) = field_text(node, "operator", src) {
                    push_dart_sym(out, op, qualified(scope, op, "."), SymbolKind::Method, node, src);
                }
                continue;
            }
            _ => {}
        }
        for i in (0..node.named_child_count()).rev() {
            if let Some(c) = node.named_child(i as u32) { stack.push(Step::Node(c)); }
        }
    }
}

fn dart_type_name<'a>(node: tree_sitter::Node<'_>, src: &'a str) -> Option<&'a str> {
    if let Some(n) = node.child_by_field_name("name") {
        if n.kind() == "extension_type_name"
            && let Some(id) = child_kind_text(n, "identifier", src)
        {
            return Some(id);
        }
        let t = node_text(n, src).trim();
        if !t.is_empty() {
            return Some(t);
        }
    }
    child_kind_text(node, "identifier", src)
}

fn dart_ctor_name(node: tree_sitter::Node<'_>, scope: &[String], src: &str) -> Option<String> {
    let mut cursor = node.walk();
    let parts: Vec<&str> = node
        .children_by_field_name("name", &mut cursor)
        .map(|n| node_text(n, src).trim())
        .filter(|t| !t.is_empty() && *t != ".")
        .collect();
    match parts.as_slice() {
        [] => {
            if node.kind().contains("factory") {
                scope.last().cloned()
            } else {
                Some("new".to_string())
            }
        }
        [single] => Some((*single).to_string()),
        [cls, rest @ ..] => {
            if scope.last().map(String::as_str) == Some(*cls) {
                Some(rest.join("."))
            } else {
                Some(parts.join("."))
            }
        }
    }
}

fn push_ext_primary_ctor(
    node: tree_sitter::Node<'_>,
    scope: &[String],
    out: &mut Vec<SymbolNode>,
    src: &str,
) {
    let Some(name_node) = node.child_by_field_name("name") else { return };
    if name_node.kind() != "extension_type_name" {
        return;
    }
    let mut saw_dot = false;
    let mut ctor = None;
    for i in 0..name_node.child_count() {
        let Some(c) = name_node.child(i) else { continue };
        if !saw_dot {
            saw_dot = c.kind() == ".";
        } else if !c.is_extra() {
            if !c.is_error() && !c.is_missing() && matches!(c.kind(), "identifier" | "new") {
                ctor = Some(node_text(c, src).trim()).filter(|s| !s.is_empty());
            }
            break;
        }
    }
    let Some(ctor) = ctor else { return };
    let end_node = node.child_by_field_name("representation").unwrap_or(node);
    let start = node.start_position();
    let end = end_node.end_position();
    let end_row = if end.column == 0 && end.row > start.row { end.row - 1 } else { end.row };
    out.push(SymbolNode {
        name: ctor.to_string(),
        qualified_name: qualified(scope, ctor, "."),
        kind: SymbolKind::Method,
        start_line: start.row + 1,
        end_line: (end_row + 1).max(start.row + 1),
        start_byte: node.start_byte(),
        end_byte: end_node.end_byte(),
        signature: first_line_sig(node, src),
    });
}

fn push_dart_sym(
    out: &mut Vec<SymbolNode>,
    name: &str,
    qname: String,
    kind: SymbolKind,
    sig: tree_sitter::Node<'_>,
    src: &str,
) {
    let prev_len = out.len();
    push_sym(out, name, qname, kind, dart_fn_span(sig), src);
    if out.len() > prev_len
        && let Some(last) = out.last_mut()
    {
        last.signature = first_line_sig(dart_sig_node(sig), src);
    }
}
fn dart_fn_span(sig: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    let Some(p) = sig.parent() else { return sig };
    if matches!(p.kind(), "method_signature" | "declaration")
        && let Some(gp) = p.parent()
        && matches!(
            gp.kind(),
            "method_declaration" | "member_declaration" | "class_member_definition"
                | "constructor_declaration" | "function_declaration"
        )
    {
        return gp;
    }
    if matches!(
        p.kind(),
        "function_declaration" | "getter_declaration" | "setter_declaration"
            | "external_function_declaration" | "external_getter_declaration"
            | "external_setter_declaration" | "local_function_declaration"
            | "method_declaration" | "constructor_declaration" | "method_signature" | "declaration"
    ) {
        return p;
    }
    sig
}

fn dart_sig_node(sig: tree_sitter::Node<'_>) -> tree_sitter::Node<'_> {
    if let Some(p) = sig.parent()
        && matches!(p.kind(), "method_signature" | "declaration")
    {
        return p;
    }
    sig
}

fn walk_dart_deps(root: tree_sitter::Node<'_>, src: &str, deps: &mut Vec<DepEdge>) {
    visit_named_preorder(root, |node| {
        if node.kind() == "import_or_export" {
            let text = node_text(node, src);
            if let Some(uri) = text.split(['\'', '"']).nth(1).filter(|s| !s.is_empty()) {
                deps.push(DepEdge { source: "dart".to_string(), target: uri.to_string(), kind: DepKind::Import });
            }
        }
    });
}
