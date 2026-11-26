from typing import Callable, List, Tuple

from models import BatchDispatchSummary, DeliveryAttempt, JobPayload
from retry_policy import RetryPolicy, sign_webhook_payload

TransportFn = Callable[[str, dict, str], Tuple[int, float, str]]


def dispatch_single(
    job: JobPayload,
    transport: TransportFn,
    policy: RetryPolicy,
    timestamp: str,
) -> DeliveryAttempt:
    issues = job.validate()
    if issues:
        return DeliveryAttempt(
            job_id=job.job_id,
            attempt_number=job.attempt + 1,
            status_code=422,
            succeeded=False,
            latency_ms=0.0,
            error_detail="; ".join(issues),
            next_retry_ms=None,
        )

    signature = sign_webhook_payload(job.secret_key, timestamp, job.body_json)
    headers = dict(job.headers)
    headers["X-Webhook-Signature"] = signature
    headers["X-Webhook-Event"] = job.event_type
    headers["Content-Type"] = "application/json"

    status_code, latency_ms, err_text = transport(job.endpoint_url, headers, job.body_json)
    if 200 <= status_code < 300:
        return DeliveryAttempt(
            job_id=job.job_id,
            attempt_number=job.attempt + 1,
            status_code=status_code,
            succeeded=True,
            latency_ms=latency_ms,
        )

    next_ms = None
    if policy.should_retry(status_code, job.attempt + 1, job.max_attempts):
        next_ms = policy.compute_backoff_ms(job.attempt + 1, len(job.job_id))
    return DeliveryAttempt(
        job_id=job.job_id,
        attempt_number=job.attempt + 1,
        status_code=status_code,
        succeeded=False,
        latency_ms=latency_ms,
        error_detail=err_text or f"HTTP {status_code}",
        next_retry_ms=next_ms,
    )


def dispatch_batch(
    jobs: List[JobPayload],
    transport: TransportFn,
    policy: RetryPolicy,
    timestamp: str,
) -> BatchDispatchSummary:
    summary = BatchDispatchSummary(
        total_jobs=len(jobs),
        delivered=0,
        retried=0,
        dead_lettered=0,
    )
    for job in jobs:
        attempt = dispatch_single(job, transport, policy, timestamp)
        summary.attempts.append(attempt)
        if attempt.succeeded:
            summary.delivered += 1
        elif attempt.next_retry_ms is not None:
            summary.retried += 1
        else:
            summary.dead_lettered += 1
    return summary


def filter_retryable_jobs(jobs: List[JobPayload], summary: BatchDispatchSummary) -> List[JobPayload]:
    retry_ids = {a.job_id for a in summary.attempts if a.next_retry_ms is not None}
    updated: List[JobPayload] = []
    for job in jobs:
        if job.job_id not in retry_ids:
            continue
        updated.append(
            JobPayload(
                job_id=job.job_id,
                endpoint_url=job.endpoint_url,
                secret_key=job.secret_key,
                event_type=job.event_type,
                body_json=job.body_json,
                attempt=job.attempt + 1,
                max_attempts=job.max_attempts,
                headers=dict(job.headers),
            )
        )
    return updated


def build_dead_letter_report(summary: BatchDispatchSummary) -> List[dict]:
    report: List[dict] = []
    for attempt in summary.attempts:
        if not attempt.succeeded and attempt.next_retry_ms is None:
            report.append(
                {
                    "job_id": attempt.job_id,
                    "status_code": attempt.status_code,
                    "attempts": attempt.attempt_number,
                    "error": attempt.error_detail or "unknown",
                }
            )
    return report
