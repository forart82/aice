package dev.aice.ledger

data class AccountState(val id: String, val balance: Long)

class LedgerEngine {
    fun credit(state: AccountState, amount: Long): AccountState {
        return state.copy(balance = state.balance + amount)
    }
}
