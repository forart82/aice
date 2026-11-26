CREATE TABLE accounts (
    account_id VARCHAR(64) PRIMARY KEY,
    merchant_id VARCHAR(64) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    balance_minor BIGINT NOT NULL DEFAULT 0,
    status VARCHAR(24) NOT NULL DEFAULT 'active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE ledger_entries (
    entry_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL REFERENCES accounts(account_id),
    direction VARCHAR(10) NOT NULL CHECK (direction IN ('debit', 'credit')),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reference_code VARCHAR(128) NOT NULL,
    posted_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

WITH account_totals AS (
    SELECT
        e.account_id,
        SUM(CASE WHEN e.direction = 'credit' THEN e.amount_minor ELSE -e.amount_minor END) AS net_delta,
        COUNT(*) AS entry_count
    FROM ledger_entries e
    GROUP BY e.account_id
)
SELECT
    a.account_id,
    a.merchant_id,
    a.currency_code,
    a.balance_minor,
    COALESCE(t.net_delta, 0) AS computed_delta,
    COALESCE(t.entry_count, 0) AS entry_count
FROM accounts a
LEFT JOIN account_totals t ON t.account_id = a.account_id
WHERE a.status = 'active';

CREATE TABLE dispute_holds (
    hold_id VARCHAR(64) PRIMARY KEY,
    account_id VARCHAR(64) NOT NULL REFERENCES accounts(account_id),
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0),
    reason_code VARCHAR(32) NOT NULL,
    hold_state VARCHAR(24) NOT NULL DEFAULT 'open',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_dispute_holds_account
    ON dispute_holds (account_id, hold_state);

SELECT
    d.account_id,
    COUNT(*) AS open_hold_count,
    SUM(d.amount_minor) AS held_minor
FROM dispute_holds d
WHERE d.hold_state = 'open'
GROUP BY d.account_id;
