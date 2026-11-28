use crate::ir::{Trivia, TriviaKind};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum CommentStyle {
    Slash,
    CssBlock,
    Hash,
    SqlDash,
    Html,
    Twig,
}

pub(crate) struct EmitCtx {
    pub out: String,
    pub indent: usize,
    pub tab: &'static str,
}

impl EmitCtx {
    pub fn new(tab: &'static str) -> Self {
        Self { out: String::new(), indent: 0, tab }
    }

    pub fn push(&mut self) {
        self.indent += 1;
    }

    pub fn pop(&mut self) {
        self.indent = self.indent.saturating_sub(1);
    }

    pub fn write_indent(&mut self) {
        for _ in 0..self.indent {
            self.out.push_str(self.tab);
        }
    }

    pub fn line(&mut self, s: &str) {
        self.write_indent();
        self.out.push_str(s);
        self.out.push('\n');
    }

    pub fn emit_raw_block(&mut self, text: &str) {
        for line in text.split('\n') {
            let clean = line.strip_suffix('\r').unwrap_or(line);
            if clean.trim().is_empty() {
                self.out.push('\n');
            } else {
                self.line(clean);
            }
        }
    }

    pub fn blank(&mut self) {
        if !self.out.is_empty() && !self.out.ends_with("\n\n") {
            self.out.push('\n');
        }
    }

    pub fn emit_trivia(&mut self, tr: &Trivia, style: CommentStyle) {
        let (pfx, sfx) = match style {
            CommentStyle::Slash => ("// ", ""),
            CommentStyle::CssBlock => ("/* ", " */"),
            CommentStyle::Hash => ("# ", ""),
            CommentStyle::SqlDash => ("-- ", ""),
            CommentStyle::Html => ("<!-- ", " -->"),
            CommentStyle::Twig => ("{# ", " #}"),
        };
        for c in &tr.leading {
            if c.kind == TriviaKind::Attribute {
                continue;
            }
            if matches!(style, CommentStyle::Html | CommentStyle::Twig | CommentStyle::CssBlock) {
                let sanitized = c.text.replace("-->", "-- >").replace("#}", "# }").replace("*/", "* /");
                self.line(&format!("{pfx}{sanitized}{sfx}"));
            } else {
                let norm = c.text.replace("\r\n", "\n");
                for line in norm.split('\n') {
                    let trimmed = line.trim();
                    if trimmed.is_empty() {
                        self.line(pfx.trim_end());
                    } else {
                        self.line(&format!("{pfx}{trimmed}"));
                    }
                }
            }
        }
    }

    pub fn emit_attrs(&mut self, tr: &Trivia) {
        for c in &tr.leading {
            if c.kind == TriviaKind::Attribute {
                self.line(&c.text);
            }
        }
    }
}
