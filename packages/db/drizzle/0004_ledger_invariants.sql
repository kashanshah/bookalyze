-- Every journal entry balances: at least two lines, summing to zero in the entry currency and
-- in the base currency. Checked at commit (deferred), so an entry and its lines can be inserted
-- in any order within one transaction. Runs as the owner so it sees every line of the entry.
CREATE OR REPLACE FUNCTION assert_journal_entry_balanced() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid;
  line_count integer;
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

  -- The entry itself was deleted in this transaction (e.g. its organization was removed).
  IF NOT EXISTS (SELECT 1 FROM journal_entries WHERE id = target) THEN
    RETURN NULL;
  END IF;

  SELECT count(*), coalesce(sum(amount), 0), coalesce(sum(base_amount), 0)
    INTO line_count, amount_total, base_total
    FROM journal_lines WHERE journal_entry_id = target;

  IF line_count < 2 THEN
    RAISE EXCEPTION 'Journal entry % needs at least two lines', target
      USING ERRCODE = 'check_violation';
  END IF;
  IF amount_total <> 0 OR base_total <> 0 THEN
    RAISE EXCEPTION 'Journal entry % does not balance (amount %, base %)', target, amount_total, base_total
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_balanced
  AFTER INSERT ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_lines_balanced
  AFTER INSERT OR UPDATE OR DELETE ON journal_lines
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION assert_journal_entry_balanced();
--> statement-breakpoint
-- Posted entries are immutable for the app: corrections are reversing entries. The only change
-- allowed is linking an entry to the entry that reversed it.
REVOKE UPDATE, DELETE ON "journal_entries", "journal_lines" FROM app_runtime;
--> statement-breakpoint
GRANT UPDATE ("reversed_by_entry_id") ON "journal_entries" TO app_runtime;
--> statement-breakpoint
-- An entry can be reversed once, and the link can't be removed or changed afterwards.
CREATE OR REPLACE FUNCTION guard_journal_entry_reversal() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.reversed_by_entry_id IS NOT NULL
     AND NEW.reversed_by_entry_id IS DISTINCT FROM OLD.reversed_by_entry_id THEN
    RAISE EXCEPTION 'Journal entry % has already been reversed', OLD.id
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_reversal_guard
  BEFORE UPDATE ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_journal_entry_reversal();
