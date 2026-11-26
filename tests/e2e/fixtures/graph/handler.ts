import { LedgerService } from "./service.js";
import type { LedgerRecord } from "./types.js";

export function handleTransfer(record: LedgerRecord, delta: number): number {
  const svc = new LedgerService();
  const res = svc.applyDelta(record, delta);
  if (!res.ok) {
    throw new Error(`Insufficient balance for ${record.id.raw}`);
  }
  return res.nextBalance;
}
