use crate::error::{StorageError, crc32_ieee};

pub const WAL_MAGIC: u32 = 0x4149_4345;
pub const WAL_HEADER_LEN: usize = 20;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct WalFrame {
    pub seq: u64,
    pub flags: u16,
    pub payload: Vec<u8>,
}

impl WalFrame {
    pub fn new(seq: u64, flags: u16, payload: Vec<u8>) -> Self {
        Self { seq, flags, payload }
    }

    /// Encodes this WAL frame into a length-prefixed binary buffer with CRC32 footer.
    pub fn encode(&self) -> Result<Vec<u8>, StorageError> {
        if self.payload.len() > u32::MAX as usize {
            return Err(StorageError::CapacityExceeded {
                requested: self.payload.len() as u64,
                available: u32::MAX as u64,
            });
        }
        let payload_len = self.payload.len() as u32;
        let mut out = Vec::with_capacity(WAL_HEADER_LEN + self.payload.len() + 4);
        out.extend_from_slice(&WAL_MAGIC.to_le_bytes());
        out.extend_from_slice(&self.seq.to_le_bytes());
        out.extend_from_slice(&self.flags.to_le_bytes());
        out.extend_from_slice(&payload_len.to_le_bytes());
        out.extend_from_slice(&[0u8; 2]);
        out.extend_from_slice(&self.payload);
        let crc = crc32_ieee(&out);
        out.extend_from_slice(&crc.to_le_bytes());
        Ok(out)
    }

    pub fn decode(buf: &[u8]) -> Result<(Self, usize), StorageError> {
        if buf.len() < WAL_HEADER_LEN + 4 {
            return Err(StorageError::TruncatedFrame {
                expected: WAL_HEADER_LEN + 4,
                actual: buf.len(),
            });
        }
        let magic = u32::from_le_bytes([buf[0], buf[1], buf[2], buf[3]]);
        if magic != WAL_MAGIC {
            return Err(StorageError::InvalidMagic(magic));
        }
        let seq = u64::from_le_bytes(buf[4..12].try_into().unwrap_or([0; 8]));
        let flags = u16::from_le_bytes([buf[12], buf[13]]);
        let len = u32::from_le_bytes([buf[14], buf[15], buf[16], buf[17]]) as usize;
        let total = WAL_HEADER_LEN + len + 4;
        if buf.len() < total {
            return Err(StorageError::TruncatedFrame {
                expected: total,
                actual: buf.len(),
            });
        }
        let expected_crc = crc32_ieee(&buf[..WAL_HEADER_LEN + len]);
        let actual_crc = u32::from_le_bytes([
            buf[WAL_HEADER_LEN + len],
            buf[WAL_HEADER_LEN + len + 1],
            buf[WAL_HEADER_LEN + len + 2],
            buf[WAL_HEADER_LEN + len + 3],
        ]);
        if expected_crc != actual_crc {
            return Err(StorageError::ChecksumMismatch {
                expected: expected_crc,
                actual: actual_crc,
            });
        }
        Ok((
            Self {
                seq,
                flags,
                payload: buf[WAL_HEADER_LEN..WAL_HEADER_LEN + len].to_vec(),
            },
            total,
        ))
    }
}
