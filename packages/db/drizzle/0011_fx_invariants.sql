-- Entries may now mix currencies (a USD → CAD transfer). Every entry still balances in the base
-- currency; amounts must also balance when all of an entry's lines share one currency.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  line_count integer;
  currency_count integer;
  amount_total numeric;
  base_total numeric;
BEGIN
  IF TG_TABLE_NAME = 'journal_entries' THEN
    target := NEW.id;
  ELSIF TG_OP = 'DELETE' THEN
    target := OLD.journal_entry_id;
  ELSE
    target := NEW.journal_entry_id;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = target) THEN
    RETURN NULL;
  END IF;

  SELECT count(*), count(DISTINCT currency), coalesce(sum(amount), 0), coalesce(sum(base_amount), 0)
    INTO line_count, currency_count, amount_total, base_total
    FROM journal_lines WHERE journal_entry_id = target;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % needs at least two lines', target
      USING ERRCODE = 'check_violation';
  END IF;
  IF base_total <> 0 OR (currency_count = 1 AND amount_total <> 0) THEN
    RAISE EXCEPTION 'Journal entry % does not balance (amount %, base %)', target, amount_total, base_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
-- A line on a single-currency account (bank, card) must be in that currency.
CREATE OR REPLACE FUNCTION assert_line_currency_matches_account() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  account_currency char(3);
BEGIN
  SELECT currency INTO account_currency FROM accounts WHERE id = NEW.account_id;
  IF account_currency IS NOT NULL AND account_currency <> NEW.currency THEN
    RAISE EXCEPTION 'Account % only holds %, not %', NEW.account_id, account_currency, NEW.currency
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_lines_currency_matches_account
  BEFORE INSERT ON journal_lines
  FOR EACH ROW EXECUTE FUNCTION assert_line_currency_matches_account();
--> statement-breakpoint
-- Exchange rates are public data: the app may add and refresh them, never delete.
REVOKE DELETE ON "fx_rates" FROM app_runtime;
