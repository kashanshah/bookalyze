CREATE TABLE "ebay_accounts" (
	"organization_id" uuid NOT NULL,
	"key" text NOT NULL,
	"account_id" uuid NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_accounts_organization_id_key_pk" PRIMARY KEY("organization_id","key")
);
--> statement-breakpoint
ALTER TABLE "ebay_accounts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ebay_deposit_dismissals" (
	"organization_id" uuid NOT NULL,
	"payout_id" uuid NOT NULL,
	"journal_entry_id" uuid NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_deposit_dismissals_payout_id_journal_entry_id_pk" PRIMARY KEY("payout_id","journal_entry_id")
);
--> statement-breakpoint
ALTER TABLE "ebay_deposit_dismissals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ebay_payouts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"payout_id" text NOT NULL,
	"status" text NOT NULL,
	"payout_at" timestamp with time zone NOT NULL,
	"payout_date" date NOT NULL,
	"currency" char(3) NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"account_last4" text,
	"deposit_entry_id" uuid,
	"deposit_original_entry_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_payouts_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "ebay_payouts_ebay_key" UNIQUE("organization_id","payout_id")
);
--> statement-breakpoint
ALTER TABLE "ebay_payouts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ebay_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"currency" char(3) NOT NULL,
	"net" numeric(20, 4) NOT NULL,
	"rows" integer NOT NULL,
	"journal_entry_id" uuid,
	"posted_fx_rate" numeric(20, 10),
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "ebay_periods_channel_month_key" UNIQUE("organization_id","channel_id","month"),
	CONSTRAINT "ebay_periods_month_valid" CHECK ("ebay_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$')
);
--> statement-breakpoint
ALTER TABLE "ebay_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "ebay_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"post_from" date NOT NULL,
	"auto_post" boolean DEFAULT false NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "ebay_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "ebay_accounts" ADD CONSTRAINT "ebay_accounts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_accounts" ADD CONSTRAINT "ebay_accounts_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_deposit_dismissals" ADD CONSTRAINT "ebay_deposit_dismissals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_deposit_dismissals" ADD CONSTRAINT "ebay_deposit_dismissals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_deposit_dismissals" ADD CONSTRAINT "ebay_deposit_dismissals_payout_fk" FOREIGN KEY ("organization_id","payout_id") REFERENCES "public"."ebay_payouts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_deposit_dismissals" ADD CONSTRAINT "ebay_deposit_dismissals_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_payouts" ADD CONSTRAINT "ebay_payouts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_payouts" ADD CONSTRAINT "ebay_payouts_deposit_entry_fk" FOREIGN KEY ("organization_id","deposit_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_payouts" ADD CONSTRAINT "ebay_payouts_deposit_original_entry_fk" FOREIGN KEY ("organization_id","deposit_original_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_periods" ADD CONSTRAINT "ebay_periods_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_periods" ADD CONSTRAINT "ebay_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_periods" ADD CONSTRAINT "ebay_periods_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_periods" ADD CONSTRAINT "ebay_periods_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_settings" ADD CONSTRAINT "ebay_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ebay_settings" ADD CONSTRAINT "ebay_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock', 'noon', 'purchase', 'ebay'));--> statement-breakpoint
CREATE POLICY "ebay_accounts_tenant_isolation" ON "ebay_accounts" AS PERMISSIVE FOR ALL TO public USING ("ebay_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_accounts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ebay_deposit_dismissals_tenant_isolation" ON "ebay_deposit_dismissals" AS PERMISSIVE FOR ALL TO public USING ("ebay_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_deposit_dismissals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ebay_payouts_tenant_isolation" ON "ebay_payouts" AS PERMISSIVE FOR ALL TO public USING ("ebay_payouts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_payouts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ebay_periods_tenant_isolation" ON "ebay_periods" AS PERMISSIVE FOR ALL TO public USING ("ebay_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "ebay_settings_tenant_isolation" ON "ebay_settings" AS PERMISSIVE FOR ALL TO public USING ("ebay_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("ebay_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);