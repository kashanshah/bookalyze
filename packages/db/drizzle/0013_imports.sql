CREATE TABLE "import_batches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"source" text NOT NULL,
	"file_name" text NOT NULL,
	"status" text DEFAULT 'in_progress' NOT NULL,
	"entry_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"account_count" integer DEFAULT 0 NOT NULL,
	"contact_count" integer DEFAULT 0 NOT NULL,
	"first_date" date,
	"last_date" date,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"undone_at" timestamp with time zone,
	CONSTRAINT "import_batches_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "import_batches_status_valid" CHECK ("import_batches"."status" in ('in_progress', 'completed', 'undone'))
);
--> statement-breakpoint
ALTER TABLE "import_batches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "accounts" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "contacts" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD COLUMN "import_batch_id" uuid;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "import_batches" ADD CONSTRAINT "import_batches_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_import_batch_fk" FOREIGN KEY ("organization_id","import_batch_id") REFERENCES "public"."import_batches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "contacts" ADD CONSTRAINT "contacts_import_batch_fk" FOREIGN KEY ("organization_id","import_batch_id") REFERENCES "public"."import_batches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_import_batch_fk" FOREIGN KEY ("organization_id","import_batch_id") REFERENCES "public"."import_batches"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "journal_entries_import_batch_idx" ON "journal_entries" USING btree ("import_batch_id");--> statement-breakpoint
CREATE UNIQUE INDEX "journal_entries_org_import_source_key" ON "journal_entries" USING btree ("organization_id","source_id") WHERE "journal_entries"."source" = 'import';--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import'));--> statement-breakpoint
CREATE POLICY "import_batches_tenant_isolation" ON "import_batches" AS PERMISSIVE FOR ALL TO public USING ("import_batches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("import_batches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
-- Undoing an import removes what it created, which posted entries otherwise never allow. Only
-- this function can do it, for the current organization, and only while nothing depends on the
-- imported entries: none changed or removed since (reversed), none in a closed period. Accounts
-- and contacts the import created go too, unless something else uses them now.
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
--> statement-breakpoint
REVOKE ALL ON FUNCTION undo_import_batch(uuid) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION undo_import_batch(uuid) TO app_runtime;
