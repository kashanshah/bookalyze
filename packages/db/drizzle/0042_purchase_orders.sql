CREATE TABLE "purchase_order_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"line_no" integer NOT NULL,
	"product_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	"unit_cost" numeric(20, 4) NOT NULL,
	CONSTRAINT "purchase_order_lines_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_order_lines_po_line_key" UNIQUE("purchase_order_id","line_no"),
	CONSTRAINT "purchase_order_lines_quantity_valid" CHECK ("purchase_order_lines"."quantity" between 1 and 10000000),
	CONSTRAINT "purchase_order_lines_cost_valid" CHECK ("purchase_order_lines"."unit_cost" >= 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_orders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"number" integer NOT NULL,
	"supplier_id" uuid NOT NULL,
	"status" text DEFAULT 'draft' NOT NULL,
	"currency" char(3) NOT NULL,
	"order_date" date NOT NULL,
	"expected_date" date,
	"reference" text,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_orders_org_id_key" UNIQUE("organization_id","id"),
	CONSTRAINT "purchase_orders_org_number_key" UNIQUE("organization_id","number"),
	CONSTRAINT "purchase_orders_status_valid" CHECK ("purchase_orders"."status" in ('draft', 'ordered', 'partial', 'received', 'cancelled')),
	CONSTRAINT "purchase_orders_number_positive" CHECK ("purchase_orders"."number" > 0),
	CONSTRAINT "purchase_orders_expected_after_order" CHECK ("purchase_orders"."expected_date" is null or "purchase_orders"."expected_date" >= "purchase_orders"."order_date")
);
--> statement-breakpoint
ALTER TABLE "purchase_orders" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_receipt_lines" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"receipt_id" uuid NOT NULL,
	"purchase_order_line_id" uuid NOT NULL,
	"quantity" integer NOT NULL,
	CONSTRAINT "purchase_receipt_lines_receipt_line_key" UNIQUE("receipt_id","purchase_order_line_id"),
	CONSTRAINT "purchase_receipt_lines_quantity_positive" CHECK ("purchase_receipt_lines"."quantity" > 0)
);
--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
CREATE TABLE "purchase_receipts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"organization_id" uuid NOT NULL,
	"purchase_order_id" uuid NOT NULL,
	"received_on" date NOT NULL,
	"notes" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "purchase_receipts_org_id_key" UNIQUE("organization_id","id")
);
--> statement-breakpoint
ALTER TABLE "purchase_receipts" ENABLE ROW LEVEL SECURITY;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_po_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_order_lines" ADD CONSTRAINT "purchase_order_lines_product_fk" FOREIGN KEY ("organization_id","product_id") REFERENCES "public"."products"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_currency_currencies_code_fk" FOREIGN KEY ("currency") REFERENCES "public"."currencies"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_orders" ADD CONSTRAINT "purchase_orders_supplier_fk" FOREIGN KEY ("organization_id","supplier_id") REFERENCES "public"."contacts"("organization_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_receipt_fk" FOREIGN KEY ("organization_id","receipt_id") REFERENCES "public"."purchase_receipts"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipt_lines" ADD CONSTRAINT "purchase_receipt_lines_po_line_fk" FOREIGN KEY ("organization_id","purchase_order_line_id") REFERENCES "public"."purchase_order_lines"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_organization_id_organization_id_fk" FOREIGN KEY ("organization_id") REFERENCES "public"."organization"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "purchase_receipts" ADD CONSTRAINT "purchase_receipts_po_fk" FOREIGN KEY ("organization_id","purchase_order_id") REFERENCES "public"."purchase_orders"("organization_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "purchase_order_lines_product_idx" ON "purchase_order_lines" USING btree ("organization_id","product_id");--> statement-breakpoint
CREATE INDEX "purchase_orders_supplier_idx" ON "purchase_orders" USING btree ("organization_id","supplier_id");--> statement-breakpoint
CREATE INDEX "purchase_receipt_lines_po_line_idx" ON "purchase_receipt_lines" USING btree ("purchase_order_line_id");--> statement-breakpoint
CREATE INDEX "purchase_receipts_po_idx" ON "purchase_receipts" USING btree ("purchase_order_id");--> statement-breakpoint
CREATE POLICY "purchase_order_lines_tenant_isolation" ON "purchase_order_lines" AS PERMISSIVE FOR ALL TO public USING ("purchase_order_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_order_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "purchase_orders_tenant_isolation" ON "purchase_orders" AS PERMISSIVE FOR ALL TO public USING ("purchase_orders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_orders"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "purchase_receipt_lines_tenant_isolation" ON "purchase_receipt_lines" AS PERMISSIVE FOR ALL TO public USING ("purchase_receipt_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_receipt_lines"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);--> statement-breakpoint
CREATE POLICY "purchase_receipts_tenant_isolation" ON "purchase_receipts" AS PERMISSIVE FOR ALL TO public USING ("purchase_receipts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid) WITH CHECK ("purchase_receipts"."organization_id" = nullif(current_setting('app.org_id', true), '')::uuid);