export interface AccountSnapshot {
  id: string;
  balance: number;
}

export function applyCredit(account: AccountSnapshot, delta: number): AccountSnapshot {
  return {
    id: account.id,
    balance: account.balance + delta,
  };
}
