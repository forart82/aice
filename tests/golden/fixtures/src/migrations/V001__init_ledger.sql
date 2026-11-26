-- +goose Up
CREATE TABLE ledger_entries (
  id BIGINT PRIMARY KEY,
  account_id BIGINT NOT NULL,
  amount_cents BIGINT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX idx_ledger_entries_account ON ledger_entries (account_id);

-- +goose Down
DROP INDEX IF EXISTS idx_ledger_entries_account;
DROP TABLE IF EXISTS ledger_entries;
