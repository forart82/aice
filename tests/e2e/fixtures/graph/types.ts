export interface AccountId {
  readonly raw: string;
}

export interface LedgerRecord {
  id: AccountId;
  balance: number;
  currency: "USD" | "EUR";
}

export interface ServiceResult {
  ok: boolean;
  nextBalance: number;
}
