import type { LedgerRecord, ServiceResult } from "./types.js";

export class LedgerService {
  public applyDelta(record: LedgerRecord, delta: number): ServiceResult {
    const nextBalance = record.balance + delta;
    if (nextBalance < 0) {
      return { ok: false, nextBalance: record.balance };
    }
    return { ok: true, nextBalance };
  }
}
