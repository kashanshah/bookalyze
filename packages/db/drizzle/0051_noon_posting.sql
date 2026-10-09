CREATE TABLE "noon_accounts" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noon_accounts_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "noon_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "noon_deposit_dismissals" (
	"organization_id" uuid NOT NULL,
	"transaction_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noon_deposit_dismissals_transaction_id_journal_entry_id_pk" PRIMARY KEY("transaction_id","journal_entry_id")
);
--> statement-breakpoint
ALTER TABLE "noon_deposit_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "noon_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"currency" char(3) NOT NULL,
	"earned" numeric(20, 4) NOT NULL,
	"rows" integer NOT NULL,
	"journal_entry_id" uuid,
	"posted_fx_rate" numeric(20, 10),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "noon_periods_channel_month_key" UNIQUE("organization_id","channel_id","month"),
	CONSTRAINT "noon_periods_month_valid" CHECK ("noon_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "noon_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "noon_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"post_from" date NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "noon_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD COLUMN "deposit_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD COLUMN "deposit_original_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD CONSTRAINT "noon_transactions_org_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "noon_accounts" ADD CONSTRAINT "noon_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_accounts" ADD CONSTRAINT "noon_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_deposit_dismissals" ADD CONSTRAINT "noon_deposit_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_deposit_dismissals" ADD CONSTRAINT "noon_deposit_dismissals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_deposit_dismissals" ADD CONSTRAINT "noon_deposit_dismissals_transaction_fk" FOREIGN KEY ("organization_id","transaction_id") REFERENCES "public"."noon_transactions"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_deposit_dismissals" ADD CONSTRAINT "noon_deposit_dismissals_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_periods" ADD CONSTRAINT "noon_periods_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_periods" ADD CONSTRAINT "noon_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_periods" ADD CONSTRAINT "noon_periods_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_periods" ADD CONSTRAINT "noon_periods_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_settings" ADD CONSTRAINT "noon_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_settings" ADD CONSTRAINT "noon_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD CONSTRAINT "noon_transactions_deposit_entry_fk" FOREIGN KEY ("organization_id","deposit_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "noon_transactions" ADD CONSTRAINT "noon_transactions_deposit_original_entry_fk" FOREIGN KEY ("organization_id","deposit_original_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock', 'noon'));--> statement-breakpoint
CREATE POLICY "noon_accounts_tenant_isolation" ON "noon_accounts" AS PERMISSIVE FOR ALL TO public USING ("noon_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "noon_deposit_dismissals_tenant_isolation" ON "noon_deposit_dismissals" AS PERMISSIVE FOR ALL TO public USING ("noon_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "noon_periods_tenant_isolation" ON "noon_periods" AS PERMISSIVE FOR ALL TO public USING ("noon_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "noon_settings_tenant_isolation" ON "noon_settings" AS PERMISSIVE FOR ALL TO public USING ("noon_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("noon_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);