-- +goose Up
CREATE TABLE ledger_audit (
  id BIGINT PRIMARY KEY,
  account_id BIGINT NOT NULL,
  delta NUMERIC(12, 2) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- +goose Down
DROP TABLE IF EXISTS ledger_audit;
