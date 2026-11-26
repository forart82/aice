use std::fmt;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum StorageError {
    TruncatedFrame { expected: usize, actual: usize },
    InvalidMagic(u32),
    ChecksumMismatch { expected: u32, actual: u32 },
    CapacityExceeded { requested: u64, available: u64 },
    InvalidRefillRate,
}

impl fmt::Display for StorageError {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        match self {
            Self::TruncatedFrame { expected, actual } => {
                write!(f, "truncated WAL frame: expected {expected} bytes, got {actual}")
            }
            Self::InvalidMagic(magic) => write!(f, "invalid WAL magic 0x{magic:08x}"),
            Self::ChecksumMismatch { expected, actual } => {
                write!(f, "checksum mismatch: expected 0x{expected:08x}, got 0x{actual:08x}")
            }
            Self::CapacityExceeded { requested, available } => {
                write!(f, "bucket capacity exceeded: requested {requested}, available {available}")
            }
            Self::InvalidRefillRate => write!(f, "refill rate must be positive"),
        }
    }
}

impl std::error::Error for StorageError {}

pub fn crc32_ieee(bytes: &[u8]) -> u32 {
    let mut crc = 0xFFFF_FFFFu32;
    for &b in bytes {
        crc ^= b as u32;
        for _ in 0..8 {
            let mask = (crc & 1).wrapping_neg();
            crc = (crc >> 1) ^ (0xEDB8_8320 & mask);
        }
    }
    !crc
}
