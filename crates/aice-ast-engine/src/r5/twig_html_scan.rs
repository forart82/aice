use crate::r5::checks_tags::{find_tag_end, is_html_void, scan_tag_name};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum RawKind {
    Script,
    Style,
    Textarea,
    Title,
}

impl RawKind {
    pub(crate) fn from_str(s: &str) -> Option<Self> {
        match s {
            "script" => Some(Self::Script),
            "style" => Some(Self::Style),
            "textarea" => Some(Self::Textarea),
            "title" => Some(Self::Title),
            _ => None,
        }
    }
    pub(crate) fn as_str(self) -> &'static str {
        match self {
            Self::Script => "script",
            Self::Style => "style",
            Self::Textarea => "textarea",
            Self::Title => "title",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub(crate) enum ScanMode {
    Normal,
    Comment,
    Raw(RawKind),
}

pub(crate) enum SegOp {
    Open { pos: usize, name: String },
    Close { pos: usize, name: String },
    StartComment(usize),
    EndComment,
}

fn find_rawtext_close_span(haystack: &str, name: &str) -> Option<(usize, usize)> {
    let hb = haystack.as_bytes();
    let prefix = format!("</{name}");
    let pb = prefix.as_bytes();
    if hb.len() <= pb.len() {
        return None;
    }
    let mut pos = 0;
    while let Some(rel) = hb[pos..].windows(pb.len()).position(|w| w.eq_ignore_ascii_case(pb)) {
        let mut end = pos + rel + pb.len();
        while end < hb.len() && hb[end].is_ascii_whitespace() {
            end += 1;
        }
        if end < hb.len() && hb[end] == b'>' {
            return Some((pos + rel, end + 1));
        }
        pos += rel + 1;
    }
    None
}

pub(crate) fn scan_html_segment(
    slice: &str,
    from: usize,
    to: usize,
    mut mode: ScanMode,
    skip_until: usize,
) -> (Vec<SegOp>, ScanMode, usize) {
    let mut i = from.max(skip_until);
    if i >= to {
        return (Vec::new(), mode, skip_until);
    }
    let (b, mut ops, mut new_skip) = (slice.as_bytes(), Vec::new(), 0usize);
    while i < to {
        match mode {
            ScanMode::Comment => {
                if let Some(rel) = slice[i..to].find("-->") {
                    ops.push(SegOp::EndComment);
                    i += rel + 3;
                    mode = ScanMode::Normal;
                } else {
                    break;
                }
            }
            ScanMode::Raw(raw) => {
                if let Some((cs, ce)) = find_rawtext_close_span(&slice[i..to], raw.as_str()) {
                    ops.push(SegOp::Close { pos: i + cs, name: raw.as_str().to_string() });
                    i += ce;
                    mode = ScanMode::Normal;
                } else {
                    break;
                }
            }
            ScanMode::Normal => {
                if b[i] != b'<' {
                    i += 1;
                    continue;
                }
                if slice[i..to].starts_with("<!--") {
                    if let Some(rel) = slice[i + 4..to].find("-->") {
                        i += 4 + rel + 3;
                    } else {
                        ops.push(SegOp::StartComment(i));
                        mode = ScanMode::Comment;
                        break;
                    }
                } else if slice[i..to].starts_with("<![CDATA[") {
                    if let Some(rel) = slice[i + 9..to].find("]]>") { i += 9 + rel + 3; } else { break; }
                } else if slice[i..to].starts_with("<?") {
                    if let Some(rel) = slice[i + 2..to].find('>') { i += 2 + rel + 1; } else { break; }
                } else if slice[i..to].starts_with("<!") {
                    if let Some(e) = find_tag_end(b, i + 2).filter(|&e| e < to) { i = e + 1; } else { break; }
                } else if slice[i..to].starts_with("</") {
                    let ns = i + 2;
                    let ne = scan_tag_name(b, ns).min(to);
                    if ne == ns { i += 1; continue; }
                    let Some(e) = find_tag_end(b, ne).filter(|&e| e < to) else { break; };
                    ops.push(SegOp::Close { pos: i, name: slice[ns..ne].to_ascii_lowercase() });
                    i = e + 1;
                } else {
                    let ns = i + 1;
                    let ne = scan_tag_name(b, ns).min(to);
                    if ne == ns { i += 1; continue; }
                    let Some(e) = find_tag_end(b, ne) else { break; };
                    let norm = slice[ns..ne].to_ascii_lowercase();
                    let self_closing = slice[ne..e].trim_end().ends_with('/');
                    if !self_closing {
                        if let Some(raw) = RawKind::from_str(&norm) {
                            ops.push(SegOp::Open { pos: i, name: norm });
                            mode = ScanMode::Raw(raw);
                        } else if !is_html_void(&norm) {
                            ops.push(SegOp::Open { pos: i, name: norm });
                        }
                    }
                    if e >= to { new_skip = e + 1; break; }
                    i = e + 1;
                }
            }
        }
    }
    (ops, mode, new_skip)
}
