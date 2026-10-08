CREATE TABLE "inventory_lots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"product_id" uuid NOT NULL,
	"receipt_line_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"quantity" integer NOT NULL,
	"currency" char(3) NOT NULL,
	"product_cost" numeric(20, 4) NOT NULL,
	"landed_cost" numeric(20, 4) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "inventory_lots_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "inventory_lots_receipt_line_key" UNIQUE("receipt_line_id"),
	CONSTRAINT "inventory_lots_quantity_positive" CHECK ("inventory_lots"."quantity" > 0),
	CONSTRAINT "inventory_lots_costs_valid" CHECK ("inventory_lots"."product_cost" >= 0 and "inventory_lots"."landed_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "inventory_lots" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_receipt_costs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"kind" text NOT NULL,
	"description" text,
	"amount" numeric(20, 4) NOT NULL,
	"currency" char(3) NOT NULL,
	"exchange_rate" numeric(20, 10),
	"allocation" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipt_costs_line_key" UNIQUE("receipt_id","line_no"),
	CONSTRAINT "purchase_receipt_costs_kind_valid" CHECK ("purchase_receipt_costs"."kind" in ('freight', 'duty', 'brokerage', 'prep', 'other')),
	CONSTRAINT "purchase_receipt_costs_allocation_valid" CHECK ("purchase_receipt_costs"."allocation" in ('units', 'value', 'weight')),
	CONSTRAINT "purchase_receipt_costs_amount_positive" CHECK ("purchase_receipt_costs"."amount" > 0),
	CONSTRAINT "purchase_receipt_costs_rate_positive" CHECK ("purchase_receipt_costs"."exchange_rate" is null or "purchase_receipt_costs"."exchange_rate" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "products" ADD COLUMN "unit_weight" numeric(12, 4);--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD COLUMN "exchange_rate" numeric(20, 10);--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_org_id_key" UNIQUE("organization_id","id");--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "inventory_lots" ADD CONSTRAINT "inventory_lots_receipt_line_fk" FOREIGN KEY ("organization_id","receipt_line_id") REFERENCES "public"."purchase_receipt_lines"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_costs" ADD CONSTRAINT "purchase_receipt_costs_receipt_fk" FOREIGN KEY ("organization_id","receipt_id") REFERENCES "public"."purchase_receipts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "inventory_lots_product_idx" ON "inventory_lots" USING btree ("organization_id","product_id","received_on");--> statement-breakpoint
ALTER TABLE "products" ADD CONSTRAINT "products_weight_positive" CHECK ("products"."unit_weight" is null or "products"."unit_weight" > 0);--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_rate_positive" CHECK ("purchase_receipts"."exchange_rate" is null or "purchase_receipts"."exchange_rate" > 0);--> statement-breakpoint
CREATE POLICY "inventory_lots_tenant_isolation" ON "inventory_lots" AS PERMISSIVE FOR ALL TO public USING ("inventory_lots"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("inventory_lots"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "purchase_receipt_costs_tenant_isolation" ON "purchase_receipt_costs" AS PERMISSIVE FOR ALL TO public USING ("purchase_receipt_costs"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_receipt_costs"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);