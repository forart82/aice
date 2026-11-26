CREATE VIEW v_pending_settlements AS
SELECT
    b.batch_id,
    b.merchant_id,
    b.currency_code,
    b.gross_minor,
    b.fee_minor,
    b.net_minor,
    COUNT(i.item_id) AS item_count
FROM settlement_batches b
LEFT JOIN settlement_batch_items i ON i.batch_id = b.batch_id
WHERE b.batch_state = 'pending'
GROUP BY
    b.batch_id,
    b.merchant_id,
    b.currency_code,
    b.gross_minor,
    b.fee_minor,
    b.net_minor;

CREATE VIEW v_merchant_balances AS
SELECT
    merchant_id,
    currency_code,
    SUM(balance_minor) AS total_balance_minor
FROM accounts
WHERE status = 'active'
GROUP BY merchant_id, currency_code;

CREATE VIEW v_open_dispute_exposure AS
SELECT
    a.merchant_id,
    a.currency_code,
    COUNT(d.hold_id) AS open_holds,
    COALESCE(SUM(d.amount_minor), 0) AS total_held_minor
FROM accounts a
LEFT JOIN dispute_holds d
    ON d.account_id = a.account_id
    AND d.hold_state = 'open'
GROUP BY a.merchant_id, a.currency_code;

CREATE VIEW v_queued_payouts AS
SELECT
    p.transfer_id,
    p.batch_id,
    b.merchant_id,
    b.currency_code,
    p.transfer_minor,
    p.initiated_at
FROM payout_transfers p
INNER JOIN settlement_batches b ON b.batch_id = p.batch_id
WHERE p.transfer_state = 'queued';
