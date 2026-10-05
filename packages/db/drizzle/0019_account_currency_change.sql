-- An account's currency may change without changing any amount already recorded: earlier lines
-- keep the currency they were written in. Reversing one of them (to edit or remove it) must undo
-- it in that same currency, so reversal lines are exempt from the account-currency check.
CREATE OR REPLACE FUNCTION assert_line_currency_matches_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  account_currency char(3);
  is_reversal boolean;
BEGIN
  SELECT currency INTO account_currency FROM accounts WHERE id = NEW.account_id;
  IF account_currency IS NOT NULL AND account_currency <> NEW.currency THEN
    SELECT reverses_entry_id IS NOT NULL INTO is_reversal
      FROM journal_entries WHERE id = NEW.journal_entry_id;
    IF NOT coalesce(is_reversal, false) THEN
      RAISE EXCEPTION 'Account % only holds %, not %', NEW.account_id, account_currency, NEW.currency
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END
$$;
