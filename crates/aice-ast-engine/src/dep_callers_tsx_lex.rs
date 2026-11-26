#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum JsxTagStage {
    TagName { has_name: bool },
    Attrs { attr_count: usize, expect_attr_val: bool, pending_extends: bool },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum JsxFrame {
    OpenTag { stage: JsxTagStage, type_arg_depth: usize },
    Children,
    CloseTag,
    Expr { brace_depth: usize },
}

#[derive(Clone, Copy, PartialEq, Eq)]
pub(crate) enum TagPunctOutcome {
    HandledRegexAllowed,
    HandledExprEnd,
    Fallthrough,
}

pub(crate) struct JsxLexState {
    pub(crate) stack: Vec<JsxFrame>,
}

impl JsxLexState {
    pub(crate) fn new() -> Self {
        Self { stack: Vec::new() }
    }

    pub(crate) fn in_jsx_text(&self) -> bool {
        matches!(self.stack.last(), Some(JsxFrame::Children))
    }

    pub(crate) fn in_jsx_tag(&self) -> bool {
        matches!(self.stack.last(), Some(JsxFrame::OpenTag { .. } | JsxFrame::CloseTag))
    }

    pub(crate) fn in_jsx_open_tag(&self) -> bool {
        matches!(self.stack.last(), Some(JsxFrame::OpenTag { .. }))
    }

    pub(crate) fn on_newline(&mut self) {
        if let Some(JsxFrame::OpenTag { stage, type_arg_depth: 0 }) = self.stack.last_mut()
            && matches!(*stage, JsxTagStage::TagName { has_name: true })
        {
            *stage = JsxTagStage::Attrs {
                attr_count: 0,
                expect_attr_val: false,
                pending_extends: false,
            };
        }
    }

    pub(crate) fn on_before_quote(&mut self, is_backtick: bool) {
        if let Some(JsxFrame::OpenTag { stage, type_arg_depth: 0 }) = self.stack.last_mut() {
            match stage {
                JsxTagStage::Attrs { expect_attr_val, pending_extends, .. }
                    if *expect_attr_val && !is_backtick =>
                {
                    *expect_attr_val = false;
                    *pending_extends = false;
                }
                _ => {
                    self.stack.pop();
                }
            }
        }
    }

    pub(crate) fn on_lbrace(&mut self) -> bool {
        match self.stack.last_mut() {
            Some(JsxFrame::Expr { brace_depth }) => {
                *brace_depth += 1;
                false
            }
            Some(JsxFrame::OpenTag { stage, type_arg_depth }) => {
                if *type_arg_depth == 0
                    && matches!(stage, JsxTagStage::Attrs { pending_extends: true, .. })
                {
                    self.stack.pop();
                    return false;
                }
                if let JsxTagStage::Attrs { expect_attr_val, .. } = stage {
                    *expect_attr_val = false;
                }
                self.stack.push(JsxFrame::Expr { brace_depth: 1 });
                true
            }
            _ => false,
        }
    }

    pub(crate) fn on_rbrace(&mut self) -> bool {
        if let Some(JsxFrame::Expr { brace_depth }) = self.stack.last_mut() {
            *brace_depth -= 1;
            if *brace_depth == 0 {
                self.stack.pop();
            }
            return true;
        }
        false
    }

    pub(crate) fn on_tag_ws(&mut self) {
        self.on_newline();
    }

    pub(crate) fn on_tag_arrow(&mut self) {
        if let Some(JsxFrame::OpenTag { type_arg_depth: 0, .. }) = self.stack.last() {
            self.stack.pop();
        }
    }

    pub(crate) fn on_tag_ident(&mut self, ident: &str) {
        let Some(JsxFrame::OpenTag { stage, type_arg_depth: 0 }) = self.stack.last_mut() else {
            return;
        };
        match stage {
            JsxTagStage::TagName { has_name } => {
                if !*has_name && ident == "const" {
                    self.stack.pop();
                } else {
                    *has_name = true;
                }
            }
            JsxTagStage::Attrs { attr_count, expect_attr_val, pending_extends } => {
                if *pending_extends {
                    self.stack.pop();
                } else if ident == "extends" && *attr_count == 0 && !*expect_attr_val {
                    *pending_extends = true;
                } else {
                    *attr_count += 1;
                    *expect_attr_val = false;
                }
            }
        }
    }

    pub(crate) fn try_open_from_js(&mut self, raw: &str, b: &[u8], i: usize) -> Option<usize> {
        if b[i] != b'<' {
            return None;
        }
        if b.get(i + 1) == Some(&b'>') {
            self.stack.push(JsxFrame::Children);
            return Some(i + 2);
        }
        if raw[i + 1..]
            .chars()
            .next()
            .is_some_and(|c| c.is_alphabetic() || c == '_' || c == '$')
        {
            self.stack.push(JsxFrame::OpenTag {
                stage: JsxTagStage::TagName { has_name: false },
                type_arg_depth: 0,
            });
            return Some(i + 1);
        }
        None
    }

    pub(crate) fn step_tag_punct(&mut self, byte: u8) -> TagPunctOutcome {
        match self.stack.last_mut() {
            Some(JsxFrame::CloseTag) => {
                if byte == b'>' {
                    self.stack.pop();
                    if matches!(self.stack.last(), Some(JsxFrame::Children)) {
                        self.stack.pop();
                    }
                    if self.in_jsx_text() {
                        TagPunctOutcome::HandledRegexAllowed
                    } else {
                        TagPunctOutcome::HandledExprEnd
                    }
                } else {
                    TagPunctOutcome::HandledExprEnd
                }
            }
            Some(JsxFrame::OpenTag { stage, type_arg_depth }) => {
                if *type_arg_depth > 0 {
                    return match byte {
                        b'<' => {
                            *type_arg_depth += 1;
                            TagPunctOutcome::HandledRegexAllowed
                        }
                        b'>' => {
                            *type_arg_depth -= 1;
                            TagPunctOutcome::HandledRegexAllowed
                        }
                        b';' => {
                            self.stack.pop();
                            TagPunctOutcome::Fallthrough
                        }
                        _ => TagPunctOutcome::HandledRegexAllowed,
                    };
                }
                match byte {
                    b'>' => {
                        self.stack.pop();
                        self.stack.push(JsxFrame::Children);
                        TagPunctOutcome::HandledRegexAllowed
                    }
                    b'<' => {
                        if matches!(stage, JsxTagStage::Attrs { pending_extends: true, .. }) {
                            self.stack.pop();
                            TagPunctOutcome::Fallthrough
                        } else {
                            *type_arg_depth = 1;
                            TagPunctOutcome::HandledRegexAllowed
                        }
                    }
                    b'=' => match stage {
                        JsxTagStage::Attrs { attr_count, expect_attr_val, pending_extends }
                            if *attr_count > 0 || *pending_extends =>
                        {
                            *expect_attr_val = true;
                            *pending_extends = false;
                            TagPunctOutcome::HandledRegexAllowed
                        }
                        _ => {
                            self.stack.pop();
                            TagPunctOutcome::Fallthrough
                        }
                    },
                    b'.' | b'-' | b':' => TagPunctOutcome::HandledExprEnd,
                    _ => {
                        self.stack.pop();
                        TagPunctOutcome::Fallthrough
                    }
                }
            }
            _ => TagPunctOutcome::Fallthrough,
        }
    }
}
