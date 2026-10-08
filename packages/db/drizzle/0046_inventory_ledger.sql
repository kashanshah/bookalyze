CREATE TABLE "inventory_ledger_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"channel_id" uuid NOT NULL,
	"event_date" date NOT NULL,
	"sku" text NOT NULL,
	"fnsku" text,
	"asin" text,
	"event_type" text NOT NULL,
	"reference_id" text,
	"quantity" integer NOT NULL,
	"fulfillment_center" text,
	"disposition" text,
	"reason" text,
	"key" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_ledger_events_channel_key" UNIQUE("organization_id","channel_id","key")
);
--> statement-breakpoint
ALTER TABLE "inventory_ledger_events" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "lot_consumptions" DROP CONSTRAINT "lot_consumptions_period_lot_key";--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_valid";--> statement-breakpoint
ALTER TABLE "cogs_periods" DROP CONSTRAINT "cogs_periods_units_valid";--> statement-breakpoint
ALTER TABLE "inventory_lots" DROP CONSTRAINT "inventory_lots_source_valid";--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "ledger_synced_through" date;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "ledger_report_id" text;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "ledger_report_from" date;--> statement-breakpoint
ALTER TABLE "sales_channels" ADD COLUMN "ledger_report_to" date;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "returned_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "returned_cost" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "lost_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "lost_cost" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "found_units" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD COLUMN "found_cost" numeric(20, 4) DEFAULT '0' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD COLUMN "cogs_period_id" uuid;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD COLUMN "kind" text DEFAULT 'sale' NOT NULL;--> statement-breakpoint
ALTER TABLE "inventory_ledger_events" ADD CONSTRAINT "inventory_ledger_events_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_ledger_events" ADD CONSTRAINT "inventory_ledger_events_channel_fk" FOREIGN KEY ("organization_id","channel_id") REFERENCES "public"."sales_channels"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_ledger_events_channel_date_idx" ON "inventory_ledger_events" USING btree ("organization_id","channel_id","event_date");--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_cogs_period_fk" FOREIGN KEY ("organization_id","cogs_period_id") REFERENCES "public"."cogs_periods"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_period_lot_kind_key" UNIQUE("cogs_period_id","lot_id","kind");--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_valid" CHECK ("accounts"."system_key" is null or "accounts"."system_key" in ('accounts_receivable', 'accounts_payable', 'retained_earnings', 'uncategorized_income', 'uncategorized_expense', 'fx_gain', 'fx_loss', 'inventory', 'cost_of_goods_sold', 'opening_balance_equity', 'inventory_write_offs'));--> statement-breakpoint
ALTER TABLE "cogs_periods" ADD CONSTRAINT "cogs_periods_units_valid" CHECK ("cogs_periods"."units" >= 0 and "cogs_periods"."cost" >= 0 and "cogs_periods"."returned_units" >= 0 and "cogs_periods"."returned_cost" >= 0 and "cogs_periods"."lost_units" >= 0 and "cogs_periods"."lost_cost" >= 0 and "cogs_periods"."found_units" >= 0 and "cogs_periods"."found_cost" >= 0);--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_source_valid" CHECK (("inventory_lots"."source" = 'receipt') = ("inventory_lots"."receipt_line_id" is not null) and ("inventory_lots"."source" in ('return', 'found')) = ("inventory_lots"."cogs_period_id" is not null));--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_kind_valid" CHECK ("lot_consumptions"."kind" in ('sale', 'write_off'));--> statement-breakpoint
CREATE POLICY "inventory_ledger_events_tenant_isolation" ON "inventory_ledger_events" AS PERMISSIVE FOR ALL TO public USING ("inventory_ledger_events"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("inventory_ledger_events"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);