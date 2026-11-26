import { handleTransfer } from "./handler.js";
import type { LedgerRecord } from "./types.js";

export function verifyTransferSpec(): boolean {
  const rec: LedgerRecord = {
    id: { raw: "acct-1" },
    balance: 100,
    currency: "USD",
  };
  return handleTransfer(rec, 25) === 125;
}
