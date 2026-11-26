/// Streaming UTF-8 validator that carries incomplete multi-byte sequences (up to 3 bytes)
/// across arbitrary chunk boundaries and verifies no incomplete tail remains at EOF.
#[derive(Default)]
pub(crate) struct Utf8StreamValidator {
    pending: [u8; 4],
    pending_len: usize,
}

impl Utf8StreamValidator {
    pub(crate) fn new() -> Self {
        Self::default()
    }

    pub(crate) fn push(&mut self, chunk: &[u8]) -> bool {
        if chunk.is_empty() {
            return true;
        }
        let mut rest = chunk;
        if self.pending_len > 0 {
            let take = rest.len().min(4 - self.pending_len);
            self.pending[self.pending_len..self.pending_len + take].copy_from_slice(&rest[..take]);
            let combined_len = self.pending_len + take;
            match std::str::from_utf8(&self.pending[..combined_len]) {
                Ok(_) => {
                    self.pending_len = 0;
                    rest = &rest[take..];
                }
                Err(e) => {
                    if e.error_len().is_some() {
                        return false;
                    }
                    let valid = e.valid_up_to();
                    if valid > 0 {
                        let used = valid - self.pending_len;
                        self.pending_len = 0;
                        rest = &rest[used..];
                    } else {
                        self.pending_len = combined_len;
                        return true;
                    }
                }
            }
        }
        match std::str::from_utf8(rest) {
            Ok(_) => true,
            Err(e) => {
                if e.error_len().is_some() {
                    return false;
                }
                let tail = &rest[e.valid_up_to()..];
                self.pending[..tail.len()].copy_from_slice(tail);
                self.pending_len = tail.len();
                true
            }
        }
    }

    pub(crate) fn finish(&self) -> bool {
        self.pending_len == 0
    }
}

#[cfg(test)]
mod tests {
    use super::Utf8StreamValidator;

    #[test]
    fn validates_multibyte_chars_across_arbitrary_chunk_splits() {
        let text = "hello🦀world€日本語";
        let bytes = text.as_bytes();
        for chunk_sz in [1usize, 2, 3, 4, 7] {
            let mut v = Utf8StreamValidator::new();
            for c in bytes.chunks(chunk_sz) {
                assert!(v.push(c), "failed on valid UTF-8 chunk size {chunk_sz}");
            }
            assert!(v.finish());
        }
    }

    #[test]
    fn rejects_invalid_utf8_and_truncated_eof_tail() {
        let mut v_bad = Utf8StreamValidator::new();
        assert!(v_bad.push(&[0xF0, 0x9F]));
        assert!(!v_bad.push(&[0x20, 0x80]));

        let mut v_eof = Utf8StreamValidator::new();
        assert!(v_eof.push(b"abc"));
        assert!(v_eof.push(&[0xE2, 0x82]));
        assert!(!v_eof.finish());
    }
}
