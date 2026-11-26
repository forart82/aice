-- +goose Up
CREATE TABLE ledger_audit (
  id BIGINT PRIMARY KEY,
  delta NUMERIC(12, 2) NOT NULL,
);

-- +goose Down
DROP TABLE ;
