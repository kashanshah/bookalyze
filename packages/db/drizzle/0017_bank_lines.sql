CREATE TABLE "duplicate_suggestions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"entry_id" uuid NOT NULL,
	"duplicate_of_entry_id" uuid NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"decided_by" uuid,
	"decided_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "duplicate_suggestions_pair_key" UNIQUE("organization_id","entry_id","duplicate_of_entry_id"),
	CONSTRAINT "duplicate_suggestions_status_valid" CHECK ("duplicate_suggestions"."status" in ('open', 'merged', 'dismissed')),
	CONSTRAINT "duplicate_suggestions_distinct" CHECK ("duplicate_suggestions"."entry_id" <> "duplicate_suggestions"."duplicate_of_entry_id")
);
--> statement-breakpoint
ALTER TABLE "duplicate_suggestions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
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
	"reason" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "bank_lines_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "bank_lines_org_external_key" UNIQUE("organization_id","external_id"),
	CONSTRAINT "bank_lines_status_valid" CHECK ("bank_lines"."status" in ('pending', 'posted')),
	CONSTRAINT "bank_lines_status_links" CHECK (("bank_lines"."status" = 'posted') = ("bank_lines"."journal_entry_id" is not null))
);
--> statement-breakpoint
ALTER TABLE "bank_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "duplicate_suggestions" ADD CONSTRAINT "duplicate_suggestions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_suggestions" ADD CONSTRAINT "duplicate_suggestions_decided_by_user_id_fk" FOREIGN KEY ("decided_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_suggestions" ADD CONSTRAINT "duplicate_suggestions_entry_fk" FOREIGN KEY ("organization_id","entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "duplicate_suggestions" ADD CONSTRAINT "duplicate_suggestions_duplicate_of_fk" FOREIGN KEY ("organization_id","duplicate_of_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_feed_fk" FOREIGN KEY ("organization_id","feed_id") REFERENCES "public"."bank_feeds"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "bank_lines" ADD CONSTRAINT "bank_lines_journal_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "duplicate_suggestions_org_status_idx" ON "duplicate_suggestions" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "duplicate_suggestions_entry_idx" ON "duplicate_suggestions" USING btree ("entry_id");--> statement-breakpoint
CREATE INDEX "duplicate_suggestions_duplicate_of_idx" ON "duplicate_suggestions" USING btree ("duplicate_of_entry_id");--> statement-breakpoint
CREATE INDEX "bank_lines_org_status_idx" ON "bank_lines" USING btree ("organization_id","status");--> statement-breakpoint
CREATE INDEX "bank_lines_journal_entry_idx" ON "bank_lines" USING btree ("journal_entry_id");--> statement-breakpoint
CREATE POLICY "duplicate_suggestions_tenant_isolation" ON "duplicate_suggestions" AS PERMISSIVE FOR ALL TO public USING ("duplicate_suggestions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("duplicate_suggestions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "bank_lines_tenant_isolation" ON "bank_lines" AS PERMISSIVE FOR ALL TO public USING ("bank_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("bank_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);