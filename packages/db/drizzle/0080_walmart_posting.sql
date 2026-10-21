CREATE TABLE "walmart_accounts" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walmart_accounts_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "walmart_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "walmart_deposit_dismissals" (
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "walmart_deposit_dismissals_settlement_id_journal_entry_id_pk" PRIMARY KEY("settlement_id","journal_entry_id")
);
--> statement-breakpoint
ALTER TABLE "walmart_deposit_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "walmart_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"post_from" date NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "walmart_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "totals" jsonb;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "totals_version" integer;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "posted_net" numeric(20, 4);--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "posted_rows" integer;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "posted_fx_rate" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "deposit_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD COLUMN "deposit_original_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "walmart_accounts" ADD CONSTRAINT "walmart_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_accounts" ADD CONSTRAINT "walmart_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_deposit_dismissals" ADD CONSTRAINT "walmart_deposit_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_deposit_dismissals" ADD CONSTRAINT "walmart_deposit_dismissals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_deposit_dismissals" ADD CONSTRAINT "walmart_deposit_dismissals_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."walmart_settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_deposit_dismissals" ADD CONSTRAINT "walmart_deposit_dismissals_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settings" ADD CONSTRAINT "walmart_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settings" ADD CONSTRAINT "walmart_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD CONSTRAINT "walmart_settlements_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD CONSTRAINT "walmart_settlements_deposit_entry_fk" FOREIGN KEY ("organization_id","deposit_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "walmart_settlements" ADD CONSTRAINT "walmart_settlements_deposit_original_entry_fk" FOREIGN KEY ("organization_id","deposit_original_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock', 'noon', 'purchase', 'ebay', 'stock_removal', 'walmart'));--> statement-breakpoint
CREATE POLICY "walmart_accounts_tenant_isolation" ON "walmart_accounts" AS PERMISSIVE FOR ALL TO public USING ("walmart_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("walmart_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "walmart_deposit_dismissals_tenant_isolation" ON "walmart_deposit_dismissals" AS PERMISSIVE FOR ALL TO public USING ("walmart_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("walmart_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "walmart_settings_tenant_isolation" ON "walmart_settings" AS PERMISSIVE FOR ALL TO public USING ("walmart_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("walmart_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);