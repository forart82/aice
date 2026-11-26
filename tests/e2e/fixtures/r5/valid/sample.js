export class BalanceTracker {
  constructor(initial = 0) {
    this.balance = initial;
  }

  deposit(amount) {
    if (amount <= 0) {
      throw new Error("amount must be positive");
    }
    this.balance += amount;
    return this.balance;
  }
}
