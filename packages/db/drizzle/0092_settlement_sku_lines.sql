CREATE TABLE "settlement_sku_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"settlement_id" uuid NOT NULL,
	"order_ref" text,
	"sku" text,
	"posted_date" date,
	"transaction_type" text NOT NULL,
	"amount_type" text NOT NULL,
	"amount_description" text NOT NULL,
	"amount" numeric(20, 4) NOT NULL,
	"quantity" integer DEFAULT 0 NOT NULL,
	"count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "settlement_sku_lines_quantity_valid" CHECK ("settlement_sku_lines"."quantity" >= 0 and "settlement_sku_lines"."count" >= 0)
);
--> statement-breakpoint
ALTER TABLE "settlement_sku_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "settlements" ADD COLUMN "sku_detail_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "settlement_sku_lines" ADD CONSTRAINT "settlement_sku_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "settlement_sku_lines" ADD CONSTRAINT "settlement_sku_lines_settlement_fk" FOREIGN KEY ("organization_id","settlement_id") REFERENCES "public"."settlements"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "settlement_sku_lines_settlement_idx" ON "settlement_sku_lines" USING btree ("organization_id","settlement_id");--> statement-breakpoint
CREATE INDEX "settlement_sku_lines_order_idx" ON "settlement_sku_lines" USING btree ("organization_id","order_ref");--> statement-breakpoint
CREATE POLICY "settlement_sku_lines_tenant_isolation" ON "settlement_sku_lines" AS PERMISSIVE FOR ALL TO public USING ("settlement_sku_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("settlement_sku_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);