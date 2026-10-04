-- Reconciliation lines reference journal lines by (organization, id), like every tenant FK.
ALTER TABLE "journal_lines" ADD CONSTRAINT "journal_lines_org_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
CREATE TABLE "reconciliation_lines" (
	"organization_id" uuid NOT NULL,
	"journal_line_id" uuid PRIMARY KEY NOT NULL,
	"reconciliation_id" uuid NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "reconciliations" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"statement_date" date NOT NULL,
	"statement_balance" numeric(20, 4) NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"created_by" uuid,
	"completed_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reconciliations_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "reconciliations_status_valid" CHECK ("reconciliations"."status" in ('in_progress', 'completed'))
);
--> statement-breakpoint
ALTER TABLE "reconciliations" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_reconciliation_fk" FOREIGN KEY ("organization_id","reconciliation_id") REFERENCES "public"."reconciliations"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliation_lines" ADD CONSTRAINT "reconciliation_lines_line_fk" FOREIGN KEY ("organization_id","journal_line_id") REFERENCES "public"."journal_lines"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_completed_by_user_id_fk" FOREIGN KEY ("completed_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reconciliations" ADD CONSTRAINT "reconciliations_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "reconciliation_lines_reconciliation_idx" ON "reconciliation_lines" USING btree ("reconciliation_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reconciliations_account_in_progress_key" ON "reconciliations" USING btree ("organization_id","account_id") WHERE "reconciliations"."status" = 'in_progress';--> statement-breakpoint
CREATE INDEX "reconciliations_account_date_idx" ON "reconciliations" USING btree ("organization_id","account_id","statement_date");--> statement-breakpoint
CREATE POLICY "reconciliation_lines_tenant_isolation" ON "reconciliation_lines" AS PERMISSIVE FOR ALL TO public USING ("reconciliation_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("reconciliation_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "reconciliations_tenant_isolation" ON "reconciliations" AS PERMISSIVE FOR ALL TO public USING ("reconciliations"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("reconciliations"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- A reconciled transaction can't be edited or removed (both reverse it) until its
-- reconciliation is undone: the statement it was matched to would no longer agree.
CREATE OR REPLACE FUNCTION guard_reconciled_entry() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  IF NEW.reversed_by_entry_id IS NOT NULL AND OLD.reversed_by_entry_id IS NULL AND EXISTS (
    SELECT 1 FROM journal_lines l
      JOIN reconciliation_lines rl ON rl.journal_line_id = l.id
      JOIN reconciliations r ON r.id = rl.reconciliation_id
    WHERE l.journal_entry_id = OLD.id AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Journal entry % is reconciled', OLD.id
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  RETURN NEW;
END
$$;
--> statement-breakpoint
CREATE TRIGGER journal_entries_reconciled_guard
  BEFORE UPDATE OF reversed_by_entry_id ON journal_entries
  FOR EACH ROW EXECUTE FUNCTION guard_reconciled_entry();
--> statement-breakpoint
-- Ticks only change while a reconciliation is in progress.
CREATE OR REPLACE FUNCTION guard_reconciliation_lines() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  target uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.reconciliation_id ELSE NEW.reconciliation_id END;
BEGIN
  IF EXISTS (SELECT 1 FROM reconciliations WHERE id = target AND status = 'completed') THEN
    RAISE EXCEPTION 'Reconciliation % is completed', target
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END
$$;
--> statement-breakpoint
CREATE TRIGGER reconciliation_lines_guard
  BEFORE INSERT OR DELETE ON reconciliation_lines
  FOR EACH ROW EXECUTE FUNCTION guard_reconciliation_lines();
--> statement-breakpoint
-- Undoing an import is also refused while any of its entries are in a completed reconciliation.
CREATE OR REPLACE FUNCTION undo_import_batch(target uuid) RETURNS integer
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  org uuid := nullif(current_setting('app.org_id', true), '')::uuid;
  locked date;
  removed integer;
BEGIN
  IF org IS NULL OR NOT EXISTS (
    SELECT 1 FROM import_batches WHERE id = target AND organization_id = org AND status <> 'undone'
  ) THEN
    RAISE EXCEPTION 'Import % not found', target USING ERRCODE = 'no_data_found';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = org AND import_batch_id = target AND reversed_by_entry_id IS NOT NULL
  ) THEN
    RAISE EXCEPTION 'Imported entries have been changed since'
      USING ERRCODE = 'check_violation', HINT = 'import_changed';
  END IF;
  IF EXISTS (
    SELECT 1 FROM journal_entries e
      JOIN journal_lines l ON l.journal_entry_id = e.id
      JOIN reconciliation_lines rl ON rl.journal_line_id = l.id
      JOIN reconciliations r ON r.id = rl.reconciliation_id
    WHERE e.organization_id = org AND e.import_batch_id = target AND r.status = 'completed'
  ) THEN
    RAISE EXCEPTION 'Imported entries are reconciled'
      USING ERRCODE = 'check_violation', HINT = 'reconciled';
  END IF;
  SELECT books_locked_through INTO locked FROM organization_profiles WHERE organization_id = org;
  IF locked IS NOT NULL AND EXISTS (
    SELECT 1 FROM journal_entries
    WHERE organization_id = org AND import_batch_id = target AND date <= locked
  ) THEN
    RAISE EXCEPTION 'Books are closed through %', locked
      USING ERRCODE = 'check_violation', HINT = 'period_locked';
  END IF;

  -- Receipts attached to imported entries go back to the inbox.
  DELETE FROM attachment_links
    WHERE organization_id = org AND entity_type = 'journal_entry'
      AND entity_id IN (SELECT id FROM journal_entries WHERE organization_id = org AND import_batch_id = target);
  DELETE FROM journal_entries WHERE organization_id = org AND import_batch_id = target;
  GET DIAGNOSTICS removed = ROW_COUNT;
  DELETE FROM accounts a
    WHERE a.organization_id = org AND a.import_batch_id = target
      AND NOT EXISTS (SELECT 1 FROM journal_lines l WHERE l.account_id = a.id)
      AND NOT EXISTS (SELECT 1 FROM tax_rates r WHERE r.account_id = a.id);
  UPDATE accounts SET import_batch_id = NULL WHERE organization_id = org AND import_batch_id = target;
  DELETE FROM contacts c
    WHERE c.organization_id = org AND c.import_batch_id = target
      AND NOT EXISTS (SELECT 1 FROM journal_entries e WHERE e.contact_id = c.id);
  UPDATE contacts SET import_batch_id = NULL WHERE organization_id = org AND import_batch_id = target;
  UPDATE import_batches SET status = 'undone', undone_at = now() WHERE id = target;
  RETURN removed;
END
$$;
