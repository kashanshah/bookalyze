-- Reconciled transactions can be edited where the statement doesn't care: the category, the
-- description, the customer or vendor. An edit replaces the entry (reverse + post), so the
-- reconciliation's tick moves from the old money line to the new one, which must be the same
-- money: same account, amount and currency, dated within the same statement period.

-- A reversed entry may not keep ticks in a completed reconciliation. Checked at commit, so an
-- edit can reverse the entry, post the corrected one and move its ticks in between. The old
-- check (before the update) now lets it through; the deferred one below does the checking.
CREATE OR REPLACE FUNCTION guard_reconciled_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE OR REPLACE FUNCTION guard_reconciled_entry_at_commit() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reversed_by_entry_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM journal_lines l
      JOIN reconciliation_lines rl ON rl.journal_line_id = l.id
      JOIN reconciliations r ON r.id = rl.reconciliation_id
    WHERE l.journal_entry_id = NEW.id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Journal entry % is reconciled', NEW.id
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  RETURN NULL;
END
$$;
--> statement-breakpoint
CREATE CONSTRAINT TRIGGER journal_entries_reconciled_commit_guard
  AFTER UPDATE OF reversed_by_entry_id ON journal_entries
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION guard_reconciled_entry_at_commit();
--> statement-breakpoint
-- A tick in a completed reconciliation can only move to a line that is the same money.
CREATE OR REPLACE FUNCTION guard_reconciliation_line_move() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reconciliation_id IS DISTINCT FROM OLD.reconciliation_id THEN
    RAISE EXCEPTION 'A tick stays in its reconciliation'
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  IF NEW.journal_line_id = OLD.journal_line_id OR NOT EXISTS (
    SELECT 1 FROM reconciliations WHERE id = NEW.reconciliation_id AND status = 'completed'
  ) THEN
    RETURN NEW;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM journal_lines o, journal_lines n, journal_entries ne, reconciliations r
    WHERE o.id = OLD.journal_line_id AND n.id = NEW.journal_line_id
      AND ne.id = n.journal_entry_id AND r.id = NEW.reconciliation_id
      AND n.account_id = o.account_id AND n.amount = o.amount AND n.currency = o.currency
      AND ne.reversed_by_entry_id IS NULL AND ne.reverses_entry_id IS NULL
      AND ne.date <= r.statement_date
      AND ne.date > coalesce((
        SELECT max(p.statement_date) FROM reconciliations p
        WHERE p.account_id = r.account_id AND p.status = 'completed'
          AND p.statement_date < r.statement_date
      ), '-infinity'::date)
  ) THEN
    RAISE EXCEPTION 'Reconciliation % is completed', NEW.reconciliation_id
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_lines_move_guard
  BEFORE UPDATE ON reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_line_move();
