CREATE TABLE "transfer_matches" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"out_entry_id" uuid NOT NULL,
	"in_entry_id" uuid NOT NULL,
	"transfer_entry_id" uuid,
	"status" text NOT NULL,
	"decided_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "transfer_matches_pair_key" UNIQUE("organization_id","out_entry_id","in_entry_id"),
	CONSTRAINT "transfer_matches_status_valid" CHECK ("transfer_matches"."status" in ('matched', 'dismissed', 'unmatched')),
	CONSTRAINT "transfer_matches_distinct" CHECK ("transfer_matches"."out_entry_id" <> "transfer_matches"."in_entry_id"),
	CONSTRAINT "transfer_matches_transfer_when_matched" CHECK (("transfer_matches"."status" = 'matched') = ("transfer_matches"."transfer_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "transfer_matches" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_out_fk" FOREIGN KEY ("organization_id","out_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_in_fk" FOREIGN KEY ("organization_id","in_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "transfer_matches" ADD CONSTRAINT "transfer_matches_transfer_fk" FOREIGN KEY ("organization_id","transfer_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "transfer_matches_out_idx" ON "transfer_matches" USING btree ("out_entry_id");--> statement-breakpoint
CREATE INDEX "transfer_matches_in_idx" ON "transfer_matches" USING btree ("in_entry_id");--> statement-breakpoint
CREATE INDEX "transfer_matches_transfer_idx" ON "transfer_matches" USING btree ("transfer_entry_id");--> statement-breakpoint
CREATE POLICY "transfer_matches_tenant_isolation" ON "transfer_matches" AS PERMISSIVE FOR ALL TO public USING ("transfer_matches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("transfer_matches"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);