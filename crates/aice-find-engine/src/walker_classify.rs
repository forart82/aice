use std::path::Path;

use aice_lang_registry::LanguageId;

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(crate) enum ExtClass {
    Lang(LanguageId),
    PlainProbe,
    Other,
}

#[inline]
pub(crate) fn fast_ext_classify(path: &Path) -> ExtClass {
    let Some(ext) = path.extension().and_then(|e| e.to_str()) else {
        return ExtClass::Other;
    };
    let bytes = ext.as_bytes();
    if bytes.iter().all(|b| !b.is_ascii_uppercase()) {
        return match_lower_ext(bytes);
    }
    if bytes.len() > 16 {
        return ExtClass::Other;
    }
    let mut buf = [0u8; 16];
    buf[..bytes.len()].copy_from_slice(bytes);
    buf[..bytes.len()].make_ascii_lowercase();
    match_lower_ext(&buf[..bytes.len()])
}

#[inline]
fn match_lower_ext(ext: &[u8]) -> ExtClass {
    let lang = match ext {
        b"rs" => LanguageId::Rust,
        b"ts" | b"mts" | b"cts" => LanguageId::TypeScript,
        b"tsx" => LanguageId::Tsx,
        b"js" | b"mjs" | b"cjs" | b"jsx" => LanguageId::JavaScript,
        b"json" | b"jsonc" | b"webmanifest" => LanguageId::Json,
        b"yaml" | b"yml" => LanguageId::Yaml,
        b"toml" => LanguageId::Toml,
        b"md" | b"markdown" => LanguageId::Markdown,
        b"html" | b"htm" => LanguageId::Html,
        b"css" => LanguageId::Css,
        b"xml" | b"svg" | b"xsd" | b"dtd" | b"xsl" | b"xslt" => LanguageId::Xml,
        b"sh" | b"bash" | b"zsh" => LanguageId::Bash,
        b"py" | b"pyi" | b"pyw" => LanguageId::Python,
        b"go" => LanguageId::Go,
        b"c" => LanguageId::C,
        b"cc" | b"cpp" | b"cxx" | b"hpp" | b"hxx" | b"hh" => LanguageId::Cpp,
        b"cs" => LanguageId::CSharp,
        b"java" => LanguageId::Java,
        b"kt" | b"kts" => LanguageId::Kotlin,
        b"dart" => LanguageId::Dart,
        b"php" => LanguageId::Php,
        b"rb" => LanguageId::Ruby,
        b"prisma" => LanguageId::Prisma,
        b"graphql" | b"gql" => LanguageId::GraphQl,
        b"cypher" | b"cyp" | b"cql" => LanguageId::Cypher,
        b"aice" => LanguageId::Aice,
        b"twig" => LanguageId::Twig,
        b"txt" => return ExtClass::PlainProbe,
        _ => return ExtClass::Other,
    };
    ExtClass::Lang(lang)
}

#[inline]
pub(crate) fn count_lf_swar(bytes: &[u8]) -> usize {
    const HI: u64 = 0x8080_8080_8080_8080;
    const NL: u64 = 0x0A0A_0A0A_0A0A_0A0A;
    const M7F: u64 = 0x7F7F_7F7F_7F7F_7F7F;
    const MASK16: u64 = 0x00FF_00FF_00FF_00FF;
    const MUL16: u64 = 0x0001_0001_0001_0001;

    let mut total = 0usize;
    for block in bytes.chunks(63 * 32) {
        let mut acc0 = 0u64;
        let mut acc1 = 0u64;
        let mut acc2 = 0u64;
        let mut acc3 = 0u64;
        let mut chunks = block.chunks_exact(32);
        for c in &mut chunks {
            let v0 = u64::from_ne_bytes([c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7]]) ^ NL;
            let v1 = u64::from_ne_bytes([c[8], c[9], c[10], c[11], c[12], c[13], c[14], c[15]]) ^ NL;
            let v2 = u64::from_ne_bytes([c[16], c[17], c[18], c[19], c[20], c[21], c[22], c[23]]) ^ NL;
            let v3 = u64::from_ne_bytes([c[24], c[25], c[26], c[27], c[28], c[29], c[30], c[31]]) ^ NL;
            acc0 += (!(((v0 & M7F).wrapping_add(M7F)) | v0 | M7F) & HI) >> 7;
            acc1 += (!(((v1 & M7F).wrapping_add(M7F)) | v1 | M7F) & HI) >> 7;
            acc2 += (!(((v2 & M7F).wrapping_add(M7F)) | v2 | M7F) & HI) >> 7;
            acc3 += (!(((v3 & M7F).wrapping_add(M7F)) | v3 | M7F) & HI) >> 7;
        }
        let lane_sum = acc0 + acc1 + acc2 + acc3;
        let s16 = (lane_sum & MASK16) + ((lane_sum >> 8) & MASK16);
        total += (s16.wrapping_mul(MUL16) >> 48) as usize;
        for &b in chunks.remainder() {
            total += usize::from(b == b'\n');
        }
    }
    total
}

pub fn count_lines_fast(bytes: &[u8]) -> usize {
    if bytes.is_empty() {
        return 0;
    }
    let lf = count_lf_swar(bytes);
    if bytes[bytes.len() - 1] == b'\n' {
        lf
    } else {
        lf + 1
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use aice_governance::binary_probe::is_binary_extension;
    use aice_lang_registry::detect_language;

    #[test]
    fn fast_ext_classify_matches_detect_language_and_binary_probe() {
        let exts = [
            "rs", "RS", "ts", "mts", "cts", "tsx", "TSX", "js", "mjs", "cjs", "jsx", "json",
            "jsonc", "webmanifest", "yaml", "yml", "toml", "md", "markdown", "html", "htm",
            "css", "xml", "svg", "xsd", "dtd", "xsl", "xslt", "sh", "bash", "zsh", "py", "pyi",
            "pyw", "go", "c", "cc", "cpp", "cxx", "hpp", "hxx", "hh", "cs", "java", "kt", "kts",
            "dart", "php", "rb", "prisma", "graphql", "gql", "cypher", "cyp", "cql", "aice",
            "twig", "Twig",
        ];
        for ext in exts {
            let p = Path::new("dir").join(format!("sample.{ext}"));
            assert!(!is_binary_extension(&p), "must not be binary: {ext}");
            assert_eq!(fast_ext_classify(&p), ExtClass::Lang(detect_language(&p, "")));
        }
        assert_eq!(fast_ext_classify(Path::new("notes.txt")), ExtClass::PlainProbe);
        assert_eq!(fast_ext_classify(Path::new("notes.TXT")), ExtClass::PlainProbe);
        for other in ["hdr.h", "q.sql", "img.png", "mod.wasm", ".bashrc", "Makefile"] {
            assert_eq!(fast_ext_classify(Path::new(other)), ExtClass::Other);
        }
    }

    #[test]
    fn swar_line_count_handles_all_boundaries_and_dense_newlines() {
        for len in [0usize, 1, 15, 31, 32, 33, 63, 64, 2015, 2016, 2017, 4096] {
            let all_nl = vec![b'\n'; len];
            assert_eq!(count_lf_swar(&all_nl), len, "all_nl len={len}");
            assert_eq!(count_lines_fast(&all_nl), len, "lines all_nl len={len}");
        }
        let mut mixed = Vec::new();
        for i in 0..3000 {
            mixed.push(if i % 7 == 0 { b'\n' } else if i % 11 == 0 { b'\r' } else { b'x' });
        }
        let expected_lf = mixed.iter().filter(|&&b| b == b'\n').count();
        assert_eq!(count_lf_swar(&mixed), expected_lf);
        assert_eq!(count_lines_fast(&mixed), expected_lf + 1);
        mixed.push(b'\r');
        mixed.push(b'\n');
        assert_eq!(count_lines_fast(&mixed), expected_lf + 1);
    }
}
