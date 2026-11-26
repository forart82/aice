CREATE TABLE ledger_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    account_id TEXT NOT NULL,
    previous_balance BIGINT NOT NULL,
    next_balance BIGINT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_balance_change()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.balance_minor IS DISTINCT FROM OLD.balance_minor THEN
        INSERT INTO ledger_audit_log (
            account_id,
            previous_balance,
            next_balance,
            changed_at
        ) VALUES (
            NEW.account_id,
            OLD.balance_minor,
            NEW.balance_minor,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_accounts_balance_audit
AFTER UPDATE ON accounts
FOR EACH ROW
EXECUTE FUNCTION audit_balance_change();

CREATE TABLE hold_audit_log (
    audit_id BIGSERIAL PRIMARY KEY,
    hold_id TEXT NOT NULL,
    previous_state TEXT NOT NULL,
    next_state TEXT NOT NULL,
    changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE OR REPLACE FUNCTION audit_hold_transition()
RETURNS TRIGGER AS $$
BEGIN
    IF NEW.hold_state IS DISTINCT FROM OLD.hold_state THEN
        INSERT INTO hold_audit_log (
            hold_id,
            previous_state,
            next_state,
            changed_at
        ) VALUES (
            NEW.hold_id,
            OLD.hold_state,
            NEW.hold_state,
            NOW()
        );
    END IF;
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_holds_state_audit
AFTER UPDATE ON dispute_holds
FOR EACH ROW
EXECUTE FUNCTION audit_hold_transition();
