CREATE TABLE "stock_removals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"lot_id" uuid NOT NULL,
	"removed_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"cost" numeric(20, 4) NOT NULL,
	"account_id" uuid NOT NULL,
	"journal_entry_id" uuid,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "stock_removals_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "stock_removals_quantity_positive" CHECK ("stock_removals"."quantity" > 0 and "stock_removals"."cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "stock_removals" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "journal_entries" DROP CONSTRAINT "journal_entries_source_valid";--> statement-breakpoint
ALTER TABLE "lot_consumptions" DROP CONSTRAINT "lot_consumptions_kind_valid";--> statement-breakpoint
ALTER TABLE "lot_consumptions" ALTER COLUMN "cogs_period_id" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD COLUMN "removal_id" uuid;--> statement-breakpoint
ALTER TABLE "stock_removals" ADD CONSTRAINT "stock_removals_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_removals" ADD CONSTRAINT "stock_removals_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_removals" ADD CONSTRAINT "stock_removals_lot_fk" FOREIGN KEY ("organization_id","lot_id") REFERENCES "public"."inventory_lots"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_removals" ADD CONSTRAINT "stock_removals_account_fk" FOREIGN KEY ("organization_id","account_id") REFERENCES "public"."accounts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "stock_removals" ADD CONSTRAINT "stock_removals_entry_fk" FOREIGN KEY ("organization_id","journal_entry_id") REFERENCES "public"."journal_entries"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "stock_removals_lot_idx" ON "stock_removals" USING btree ("organization_id","lot_id");--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_removal_fk" FOREIGN KEY ("organization_id","removal_id") REFERENCES "public"."stock_removals"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "lot_consumptions_removal_key" ON "lot_consumptions" USING btree ("removal_id");--> statement-breakpoint
ALTER TABLE "journal_entries" ADD CONSTRAINT "journal_entries_source_valid" CHECK ("journal_entries"."source" in ('manual', 'reversal', 'bank_import', 'wave_import', 'import', 'settlement', 'cogs', 'opening_stock', 'noon', 'purchase', 'ebay', 'stock_removal'));--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_source_valid" CHECK (("lot_consumptions"."kind" = 'removal' and "lot_consumptions"."removal_id" is not null and "lot_consumptions"."cogs_period_id" is null) or ("lot_consumptions"."kind" <> 'removal' and "lot_consumptions"."cogs_period_id" is not null and "lot_consumptions"."removal_id" is null));--> statement-breakpoint
ALTER TABLE "lot_consumptions" ADD CONSTRAINT "lot_consumptions_kind_valid" CHECK ("lot_consumptions"."kind" in ('sale', 'write_off', 'removal'));--> statement-breakpoint
CREATE POLICY "stock_removals_tenant_isolation" ON "stock_removals" AS PERMISSIVE FOR ALL TO public USING ("stock_removals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("stock_removals"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);