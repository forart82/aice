CREATE TABLE mysql_payouts (
    id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    merchant_key VARCHAR(64) NOT NULL,
    amount_cents BIGINT NOT NULL,
    status VARCHAR(24) NOT NULL DEFAULT 'queued',
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE KEY uq_merchant_key (merchant_key)
) ENGINE=InnoDB;

DELIMITER //
CREATE PROCEDURE upsert_payout(IN p_key VARCHAR(64), IN p_amount BIGINT)
BEGIN
    INSERT INTO mysql_payouts (merchant_key, amount_cents, status)
    VALUES (p_key, p_amount, 'queued')
    ON DUPLICATE KEY UPDATE
        amount_cents = VALUES(amount_cents),
        status = 'queued';
END //
DELIMITER ;

CREATE TABLE mysql_payout_events (
    event_id BIGINT NOT NULL AUTO_INCREMENT PRIMARY KEY,
    merchant_key VARCHAR(64) NOT NULL,
    event_kind VARCHAR(32) NOT NULL,
    delta_cents BIGINT NOT NULL,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    KEY idx_payout_events_merchant (merchant_key, created_at)
) ENGINE=InnoDB;

DELIMITER //
CREATE PROCEDURE mark_payout_settled(IN p_key VARCHAR(64))
BEGIN
    UPDATE mysql_payouts
    SET status = 'settled',
        updated_at = CURRENT_TIMESTAMP
    WHERE merchant_key = p_key
      AND status = 'queued';
    INSERT INTO mysql_payout_events (merchant_key, event_kind, delta_cents)
    SELECT merchant_key, 'settled', amount_cents
    FROM mysql_payouts
    WHERE merchant_key = p_key;
END //
DELIMITER ;
