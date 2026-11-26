CREATE OR REPLACE FUNCTION audit_balance_change()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
DECLARE
  delta NUMERIC;
BEGIN
  delta := NEW.balance - OLD.balance;
  IF delta <> 0 THEN
    INSERT INTO balance_audit(account_id, delta_amount)
    VALUES (NEW.id, delta);
  END IF;
  RETURN NEW;
END;
$$;
