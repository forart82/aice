CREATE TABLE settlement_batches (
    batch_id VARCHAR(64) PRIMARY KEY,
    merchant_id VARCHAR(64) NOT NULL,
    currency_code CHAR(3) NOT NULL,
    gross_minor BIGINT NOT NULL CHECK (gross_minor >= 0),
    fee_minor BIGINT NOT NULL CHECK (fee_minor >= 0),
    net_minor BIGINT NOT NULL,
    batch_state VARCHAR(24) NOT NULL DEFAULT 'pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_settlement_batches_merchant
    ON settlement_batches (merchant_id, batch_state);

CREATE TABLE settlement_batch_items (
    item_id VARCHAR(64) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL REFERENCES settlement_batches(batch_id),
    entry_id VARCHAR(64) NOT NULL,
    amount_minor BIGINT NOT NULL CHECK (amount_minor > 0)
);

CREATE TABLE payout_transfers (
    transfer_id VARCHAR(64) PRIMARY KEY,
    batch_id VARCHAR(64) NOT NULL REFERENCES settlement_batches(batch_id),
    destination_iban VARCHAR(64) NOT NULL,
    transfer_minor BIGINT NOT NULL CHECK (transfer_minor > 0),
    transfer_state VARCHAR(24) NOT NULL DEFAULT 'queued',
    initiated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_payout_transfers_batch
    ON payout_transfers (batch_id, transfer_state);

CREATE TABLE webhook_outbox (
    event_id VARCHAR(64) PRIMARY KEY,
    aggregate_id VARCHAR(64) NOT NULL,
    event_type VARCHAR(64) NOT NULL,
    payload_text VARCHAR(2000) NOT NULL,
    published_flag SMALLINT NOT NULL DEFAULT 0,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
