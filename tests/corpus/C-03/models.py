from dataclasses import dataclass, field
from typing import Dict, List, Optional


@dataclass
class JobPayload:
    job_id: str
    endpoint_url: str
    secret_key: str
    event_type: str
    body_json: str
    attempt: int = 0
    max_attempts: int = 5
    headers: Dict[str, str] = field(default_factory=dict)

    def validate(self) -> List[str]:
        issues: List[str] = []
        if not self.job_id.strip():
            issues.append("job_id is required")
        if not self.endpoint_url.startswith(("https://", "http://")):
            issues.append("endpoint_url must be http or https")
        if not self.secret_key:
            issues.append("secret_key is required")
        if self.max_attempts < 1 or self.max_attempts > 12:
            issues.append("max_attempts must be between 1 and 12")
        return issues


@dataclass
class DeliveryAttempt:
    job_id: str
    attempt_number: int
    status_code: int
    succeeded: bool
    latency_ms: float
    error_detail: Optional[str] = None
    next_retry_ms: Optional[int] = None


@dataclass
class BatchDispatchSummary:
    total_jobs: int
    delivered: int
    retried: int
    dead_lettered: int
    attempts: List[DeliveryAttempt] = field(default_factory=list)
