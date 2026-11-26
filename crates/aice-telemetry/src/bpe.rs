#[derive(Debug, Clone, Copy, Default, PartialEq, Eq)]
pub struct BpeCounts {
    pub cl100k: usize,
    pub o200k: usize,
}

pub fn count_cl100k(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    bpe_openai::cl100k_base().count(text)
}

pub fn count_o200k(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    bpe_openai::o200k_base().count(text)
}

pub fn count_both(text: &str) -> BpeCounts {
    if text.is_empty() {
        return BpeCounts {
            cl100k: 0,
            o200k: 0,
        };
    }
    BpeCounts {
        cl100k: count_cl100k(text),
        o200k: count_o200k(text),
    }
}

pub fn count_lines(text: &str) -> usize {
    if text.is_empty() {
        return 0;
    }
    let stripped = text
        .strip_suffix("\r\n")
        .or_else(|| text.strip_suffix('\n'))
        .unwrap_or(text);
    if stripped.is_empty() {
        return 1;
    }
    1 + stripped.bytes().filter(|&b| b == b'\n').count()
}
