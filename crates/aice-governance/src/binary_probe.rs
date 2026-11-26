use std::io::Read;
use std::path::Path;

pub const DEFAULT_BINARY_PROBE_BYTES: usize = 8192;
pub const DEFAULT_MAX_TEXT_FILE_BYTES: u64 = 2 * 1024 * 1024;

const BINARY_EXTENSIONS: &[&str] = &[
    // Raster / binary images (explicitly NOT .svg)
    "png", "jpg", "jpeg", "gif", "webp", "avif", "ico", "bmp", "tiff", "tif", "heic", "heif",
    "psd", "icns", "dds", "tga", "exr", "hdr", "cur", "jp2", "jxl",
    // Fonts
    "woff", "woff2", "ttf", "eot", "otf", "ttc", "pfb", "pfm",
    // Binary documents & office packages
    "pdf", "doc", "docx", "xls", "xlsx", "ppt", "pptx", "odt", "ods", "odp", "epub", "mobi",
    // Archives, disk images & compressed payloads
    "zip", "tar", "gz", "tgz", "bz2", "tbz2", "xz", "txz", "7z", "rar", "zst", "lz4", "lzma",
    "cab", "dmg", "iso", "img", "deb", "rpm", "msi", "pkg", "nupkg", "whl", "egg", "crx", "xpi",
    "vsix",
    // Executables, bytecode, object files, native libs & mobile bundles
    "wasm", "pyc", "pyo", "pyd", "class", "jar", "war", "ear", "jmod", "apk", "aab", "dex",
    "odex", "vdex", "ipa", "exe", "dll", "so", "dylib", "o", "obj", "a", "lib", "bin", "elf",
    "sys", "drv", "node", "beam", "rlib", "rmeta", "pdb", "ilk",
    // Audio
    "mp3", "wav", "ogg", "oga", "opus", "flac", "aac", "m4a", "wma", "mid", "midi", "aiff",
    "aif",
    // Video (explicitly NOT .ts)
    "mp4", "m4v", "webm", "mkv", "avi", "mov", "wmv", "flv", "mpg", "mpeg", "3gp",
    // Databases, binary lockfiles, ML weights & binary 3D/game assets
    "sqlite", "sqlite3", "db", "db3", "sdb", "mdb", "accdb", "ldb", "lockb", "parquet", "arrow",
    "feather", "avro", "orc", "h5", "hdf5", "npy", "npz", "pkl", "pickle", "pt", "pth", "onnx",
    "safetensors", "gguf", "ggml", "tflite", "glb", "fbx", "blend", "unitypackage", "uasset",
    "pak", "vpk", "wad", "swf",
];

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum BinaryProbeResult {
    Text,
    BinaryExtension,
    NulByteOrInvalidUtf8,
    ExceedsMaxBytes(u64),
}

pub fn is_binary_extension(path: &Path) -> bool {
    path.extension()
        .and_then(|e| e.to_str())
        .map(|ext| {
            let lower = ext.to_ascii_lowercase();
            BINARY_EXTENSIONS.contains(&lower.as_str())
        })
        .unwrap_or(false)
}

fn trim_incomplete_trailing_utf8(slice: &[u8]) -> &[u8] {
    let len = slice.len();
    if len == 0 {
        return slice;
    }
    let mut i = len - 1;
    let mut cont_count = 0usize;
    while (slice[i] & 0xC0) == 0x80 && cont_count < 3 {
        if i == 0 {
            return slice;
        }
        i -= 1;
        cont_count += 1;
    }
    if (slice[i] & 0xC0) == 0x80 {
        return slice;
    }
    let lead = slice[i];
    let expected_len = if (0xC2..=0xDF).contains(&lead) {
        2
    } else if (0xE0..=0xEF).contains(&lead) {
        3
    } else if (0xF0..=0xF4).contains(&lead) {
        4
    } else {
        return slice;
    };
    let actual_len = len - i;
    if actual_len >= expected_len {
        return slice;
    }
    if actual_len >= 2 {
        let b2 = slice[i + 1];
        if (lead == 0xE0 && b2 < 0xA0)
            || (lead == 0xED && b2 > 0x9F)
            || (lead == 0xF0 && b2 < 0x90)
            || (lead == 0xF4 && b2 > 0x8F)
        {
            return slice;
        }
    }
    if i > 0 { &slice[..i] } else { slice }
}

pub fn probe_bytes_with_partial(sample: &[u8], allow_partial_trailing: bool) -> BinaryProbeResult {
    if sample.is_empty() {
        return BinaryProbeResult::Text;
    }
    let truncated = sample.len() > DEFAULT_BINARY_PROBE_BYTES;
    let slice = &sample[..sample.len().min(DEFAULT_BINARY_PROBE_BYTES)];
    let mut suspicious_controls = 0usize;
    for &b in slice {
        if b == 0 {
            return BinaryProbeResult::NulByteOrInvalidUtf8;
        }
        if (b < 0x20 && !matches!(b, 0x09..=0x0D | 0x1B)) || b == 0x7F {
            suspicious_controls += 1;
        }
    }
    if suspicious_controls > 0 && suspicious_controls * 10 > slice.len() {
        return BinaryProbeResult::NulByteOrInvalidUtf8;
    }
    let candidate = if allow_partial_trailing || truncated {
        trim_incomplete_trailing_utf8(slice)
    } else {
        slice
    };
    if std::str::from_utf8(candidate).is_err() {
        return BinaryProbeResult::NulByteOrInvalidUtf8;
    }
    BinaryProbeResult::Text
}

pub fn probe_bytes(sample: &[u8]) -> BinaryProbeResult {
    probe_bytes_with_partial(sample, sample.len() > DEFAULT_BINARY_PROBE_BYTES)
}

pub fn probe_binary(bytes: &[u8], path: &Path) -> BinaryProbeResult {
    if is_binary_extension(path) {
        return BinaryProbeResult::BinaryExtension;
    }
    if bytes.len() as u64 > DEFAULT_MAX_TEXT_FILE_BYTES {
        return BinaryProbeResult::ExceedsMaxBytes(bytes.len() as u64);
    }
    probe_bytes(bytes)
}

pub fn probe_file(path: &Path) -> BinaryProbeResult {
    if is_binary_extension(path) {
        return BinaryProbeResult::BinaryExtension;
    }
    let Ok(meta) = std::fs::metadata(path) else {
        return BinaryProbeResult::Text;
    };
    let file_len = meta.len();
    if file_len > DEFAULT_MAX_TEXT_FILE_BYTES {
        return BinaryProbeResult::ExceedsMaxBytes(file_len);
    }
    if file_len == 0 {
        return BinaryProbeResult::Text;
    }
    let Ok(mut file) = std::fs::File::open(path) else {
        return BinaryProbeResult::Text;
    };
    let to_read = (file_len as usize).min(DEFAULT_BINARY_PROBE_BYTES);
    let mut buf = vec![0u8; to_read];
    let Ok(n) = file.read(&mut buf) else {
        return BinaryProbeResult::Text;
    };
    probe_bytes_with_partial(&buf[..n], file_len > n as u64)
}
