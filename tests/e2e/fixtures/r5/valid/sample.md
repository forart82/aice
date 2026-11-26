# Service Overview

The `ledger` module validates transactions before persisting.

## Endpoints

- `GET /healthz`: returns readiness status
- `POST /entries`: appends a validated ledger row

```ts
export function checkBalance(amount: number): boolean {
  return amount >= 0;
}
```
