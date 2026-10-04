CREATE TABLE "bank_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"feed_id" uuid NOT NULL,
	"external_id" text NOT NULL,
	"pair_key" text,
	"date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"fee" numeric(20, 4) DEFAULT '0' NOT NULL,
	"description" text NOT NULL,
	"counterparty" text,
	"reference" text,
	"kind" text NOT NULL,
	"conversion" jsonb,
	"status" text DEFAULT 'pending' NOT NULL,
	"journal_entry_id" uuid,
	"suggested_entry_id" uuid,
	"match_declined" boolean DEFAULT false NOT NULL,
	"reason" text,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_lines_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_lines_org_external_key" UNIQUE("organization_id","external_id"),
	CONSTRAINT "bank_lines_status_valid" CHECK ("bank_lines"."status" in ('pending', 'posted', 'matched', 'suggested')),
	CONSTRAINT "bank_lines_status_links" CHECK (("bank_lines"."status" in ('posted', 'matched')) = ("bank_lines"."journal_entry_id" is not null)
        and ("bank_lines"."status" = 'suggested') = ("bank_lines"."suggested_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "bank_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_feed_fk" FOREIGN KEY ("organization_id","feed_id") REFERENCES "public"."bank_feeds"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_journal_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_suggested_entry_fk" FOREIGN KEY ("organization_id","suggested_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "bank_lines_org_status_idx" ON "bank_lines" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "bank_lines_journal_entry_idx" ON "bank_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE INDEX "bank_lines_suggested_entry_idx" ON "bank_lines" USING btree ("suggested_entry_id");--> statement-breakpoint
CREATE POLICY "bank_lines_tenant_isolation" ON "bank_lines" AS PERMISSIVE FOR ALL TO public USING ("bank_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("bank_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);