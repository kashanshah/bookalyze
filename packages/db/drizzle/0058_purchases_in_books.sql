CREATE TABLE "purchase_settings" (
	"organization_id" uuid PRIMARY KEY NOT NULL,
	"post_from" date NOT NULL,
	"updated_by" uuid,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "purchase_settings" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "accounts" DROP CONSTRAINT "accounts_system_key_valid";--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD COLUMN "settlement_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "journal_entry_id" uuid;--> statement-breakpoint
ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_settings" ADD CONSTRAINT "purchase_settings_updated_by_user_id_fk" FOREIGN KEY ("updated_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "accounts" ADD CONSTRAINT "accounts_system_key_valid" CHECK ("accounts"."system_key" is null or "accounts"."system_key" in ('accounts_receivable', 'accounts_payable', 'retained_earnings', 'uncategorized_income', 'uncategorized_expense', 'fx_gain', 'fx_loss', 'inventory', 'cost_of_goods_sold', 'opening_balance_equity', 'inventory_write_offs', 'supplier_deposits'));--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock', 'noon', 'purchase'));--> statement-breakpoint
CREATE POLICY "purchase_settings_tenant_isolation" ON "purchase_settings" AS PERMISSIVE FOR ALL TO public USING ("purchase_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_settings"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);