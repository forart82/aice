# Settlement Engine Architecture

## Context

The settlement service decouples ingress idempotency checks from asynchronous ledger posting.
Every inbound request passes schema validation and currency normalization before entering the WAL.

## Operational Runbook

### Replay Recovery

1. Verify `WAL_MAGIC` integrity across trailing segments.
2. Drain pending items from `settlement_batches` where `batch_state = 'pending'`.
3. Reconcile posted balances against `v_merchant_balances`.

### Circuit Breaker Policy

- Trip after 5 consecutive upstream timeouts within a 15-second window.
- Emit structured diagnostics without mutating downstream state.

### Telemetry & Audit Invariants

- All write transactions pass `SyntaxFirewall::verify_incremental` before disk commit.
- Token savings reports count full emitted stdout via `cl100k_base` and `o200k_base`.
- Rollback restores previous bytes, removes newly created files, and preserves file permissions.

## Escalation Matrix

| Severity | Symptom | First Responder |
|---|---|---|
| SEV-1 | WAL checksum mismatch | Storage On-Call |
| SEV-2 | Webhook dead-letter spike | Platform Integrations |
| SEV-3 | Elevated latency on `/v1/orders` | Core API |
