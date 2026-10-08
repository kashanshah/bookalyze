CREATE TABLE "cogs_periods" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"month" char(7) NOT NULL,
	"units" integer NOT NULL,
	"cost" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"journal_entry_id" uuid,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "cogs_periods_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "cogs_periods_channel_month_key" UNIQUE("organization_id","channel_id","month"),
	CONSTRAINT "cogs_periods_month_valid" CHECK ("cogs_periods"."month" ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
	CONSTRAINT "cogs_periods_units_valid" CHECK ("cogs_periods"."units" >= 0 and "cogs_periods"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cogs_periods" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "lot_consumptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"cogs_period_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"cost" numeric(20, 4) NOT NULL,
	CONSTRAINT "lot_consumptions_period_lot_key" UNIQUE("cogs_period_id","lot_id"),
	CONSTRAINT "lot_consumptions_quantity_positive" CHECK ("lot_consumptions"."quantity" > 0 and "lot_consumptions"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "lot_consumptions" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_valid";--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "inventory_lots" ALTER COLUMN "receipt_line_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "source" text DEFAULT 'receipt' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "notes" text;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_period_fk" FOREIGN KEY ("organization_id","cogs_period_id") REFERENCES "public"."cogs_periods"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_lot_fk" FOREIGN KEY ("organization_id","lot_id") REFERENCES "public"."inventory_lots"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "lot_consumptions_lot_idx" ON "lot_consumptions" USING btree ("lot_id");--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_valid" CHECK ("accounts"."system_key" is null or "accounts"."system_key" in ('accounts_receivable', 'accounts_payable', 'retained_earnings', 'uncategorized_income', 'uncategorized_expense', 'fx_gain', 'fx_loss', 'inventory', 'cost_of_goods_sold', 'opening_balance_equity'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock'));--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_valid" CHECK (("inventory_lots"."source" = 'receipt' and "inventory_lots"."receipt_line_id" is not null) or ("inventory_lots"."source" = 'opening' and "inventory_lots"."receipt_line_id" is null));--> statement-breakpoint
CREATE POLICY "cogs_periods_tenant_isolation" ON "cogs_periods" AS PERMISSIVE FOR ALL TO public USING ("cogs_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("cogs_periods"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "lot_consumptions_tenant_isolation" ON "lot_consumptions" AS PERMISSIVE FOR ALL TO public USING ("lot_consumptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("lot_consumptions"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);