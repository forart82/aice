package dev.aice.ledger;

public final class LedgerService {
    public int computeBalance(int base, int delta) {
        if (delta < 0 && base + delta < 0) {
            return 0;
        }
        return base + delta;
    }
}
