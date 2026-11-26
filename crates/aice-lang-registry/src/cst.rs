use std::sync::Mutex;

use crate::lang_id::LanguageId;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RdNode {
    pub kind: String,
    pub label: Option<String>,
    pub start_line: usize,
    pub end_line: usize,
    pub start_byte: usize,
    pub end_byte: usize,
    pub children: Vec<RdNode>,
}

impl Drop for RdNode {
    fn drop(&mut self) {
        while let Some(mut node) = self.children.pop() {
            self.children.append(&mut node.children);
        }
    }
}
pub struct RdTree {
    pub lang: LanguageId,
    pub root: RdNode,
    pub errors: Vec<String>,
}

pub enum ParsedTree {
    TreeSitter {
        lang: LanguageId,
        tree: Mutex<tree_sitter::Tree>,
    },
    Rd(RdTree),
    PlainText {
        line_count: usize,
    },
}

impl ParsedTree {
    pub fn from_tree_sitter(lang: LanguageId, tree: tree_sitter::Tree) -> Self {
        Self::TreeSitter {
            lang,
            tree: Mutex::new(tree),
        }
    }

    pub fn language(&self) -> LanguageId {
        match self {
            Self::TreeSitter { lang, .. } => *lang,
            Self::Rd(rd) => rd.lang,
            Self::PlainText { .. } => LanguageId::PlainText,
        }
    }

    pub fn has_error(&self) -> bool {
        match self {
            Self::TreeSitter { tree, .. } => tree
                .lock()
                .map(|t| t.root_node().has_error())
                .unwrap_or(true),
            Self::Rd(rd) => !rd.errors.is_empty(),
            Self::PlainText { .. } => false,
        }
    }
}
