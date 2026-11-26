import hashlib
import hmac
from typing import Tuple


class RetryPolicy:
    def __init__(
        self,
        base_delay_ms: int = 250,
        max_delay_ms: int = 30_000,
        jitter_ratio: float = 0.15,
    ) -> None:
        if base_delay_ms <= 0:
            raise ValueError("base_delay_ms must be positive")
        if max_delay_ms < base_delay_ms:
            raise ValueError("max_delay_ms must be >= base_delay_ms")
        self.base_delay_ms = base_delay_ms
        self.max_delay_ms = max_delay_ms
        self.jitter_ratio = max(0.0, min(0.5, jitter_ratio))

    def compute_backoff_ms(self, attempt: int, jitter_seed: int = 0) -> int:
        exponent = max(0, min(attempt, 10))
        raw_delay = min(self.max_delay_ms, self.base_delay_ms * (2 ** exponent))
        spread = int(raw_delay * self.jitter_ratio)
        if spread == 0:
            return raw_delay
        offset = ((jitter_seed * 1103515245 + 12345) & 0x7FFF) % (2 * spread + 1) - spread
        return max(self.base_delay_ms, min(self.max_delay_ms, raw_delay + offset))

    def should_retry(self, status_code: int, attempt: int, max_attempts: int) -> bool:
        if attempt >= max_attempts:
            return False
        if status_code in (408, 425, 429):
            return True
        return 500 <= status_code <= 599


def sign_webhook_payload(secret_key: str, timestamp: str, body_json: str) -> str:
    signed_content = f"{timestamp}.{body_json}".encode("utf-8")
    digest = hmac.new(secret_key.encode("utf-8"), signed_content, hashlib.sha256).hexdigest()
    return f"t={timestamp},v1={digest}"


def verify_webhook_signature(secret_key: str, header_value: str, body_json: str) -> Tuple[bool, str]:
    parts = dict(item.split("=", 1) for item in header_value.split(",") if "=" in item)
    ts = parts.get("t", "")
    sig = parts.get("v1", "")
    if not ts or not sig:
        return False, "malformed signature header"
    expected = sign_webhook_payload(secret_key, ts, body_json)
    expected_sig = expected.split("v1=", 1)[1]
    if not hmac.compare_digest(expected_sig, sig):
        return False, "signature mismatch"
    return True, "ok"
