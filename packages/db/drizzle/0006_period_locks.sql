-- Closed periods: no journal entry may be dated on or before the organization's
-- books_locked_through date. Runs as the owner so it can always read the setting.
CREATE OR REPLACE FUNCTION assert_period_open() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  locked date;
BEGIN
  SELECT books_locked_through INTO locked
    FROM organization_profiles WHERE organization_id = NEW.organization_id;
  IF locked IS NOT NULL AND NEW.date <= locked THEN
    RAISE EXCEPTION 'Books are closed through %', locked
      USING ERRCODE = 'check_violation', HINT = 'period_locked';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_period_open
  BEFORE INSERT ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION assert_period_open();
--> statement-breakpoint
-- The main currency can't change once the ledger has entries: every base amount is in it.
CREATE OR REPLACE FUNCTION guard_base_currency() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.base_currency IS DISTINCT FROM OLD.base_currency
     AND EXISTS (SELECT 1 FROM journal_entries WHERE organization_id = OLD.organization_id) THEN
    RAISE EXCEPTION 'The main currency can''t change once there are journal entries'
      USING ERRCODE = 'check_violation', HINT = 'base_currency_locked';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER organization_profiles_base_currency_guard
  BEFORE UPDATE ON organization_profiles
  FOR EACH ROW EXECUTE FUNCTION guard_base_currency();
