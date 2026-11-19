CREATE TABLE "transaction_notes" (
	"organization_id" uuid NOT NULL,
	"journal_entry_id" uuid PRIMARY KEY NOT NULL,
	"notes" text NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transaction_notes_present" CHECK (length(trim("transaction_notes"."notes")) > 0),
	CONSTRAINT "transaction_notes_length" CHECK (length("transaction_notes"."notes") <= 5000)
);
--> statement-breakpoint
ALTER TABLE "transaction_notes" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transaction_notes" ADD CONSTRAINT "transaction_notes_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_notes" ADD CONSTRAINT "transaction_notes_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transaction_notes" ADD CONSTRAINT "transaction_notes_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE POLICY "transaction_notes_tenant_isolation" ON "transaction_notes" AS PERMISSIVE FOR ALL TO public USING ("transaction_notes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("transaction_notes"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);